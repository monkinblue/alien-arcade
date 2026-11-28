import type { CartridgeProgramId } from '../shell/Cartridge';
import type { AudioEngine } from './AudioEngine';

export type MusicTrackId =
  | 'approach-and-trench'
  | 'lander-and-orbital-defense'
  | 'perimeter';

export type MusicPlaybackState =
  | 'STOPPED'
  | 'LOADING'
  | 'WAITING_UNLOCK'
  | 'PLAYING'
  | 'FADING_OUT';

export interface MusicTrackMetaSnapshot {
  durationSec: number;
  trimStartSec: number;
  trimEndSec: number;
  playableDurationSec: number;
  crossfadeSec: number;
  rms: number;
  trimGain: number;
}

export interface MusicDebugState {
  enabled: boolean;
  muted: boolean;
  desiredActive: boolean;
  desiredProgramId: CartridgeProgramId | null;
  desiredTrackId: MusicTrackId | null;
  playingTrackId: MusicTrackId | null;
  playbackState: MusicPlaybackState;
  activeVoiceCount: number;
  retiringSessionCount: number;
  crossfadeSec: number;
  nominalGain: number;
  ducked: boolean;
  duckGain: number;
  fadeGain: number;
  effectiveGain: number;
  contextState: string;
  loadedTracks: MusicTrackId[];
  decodedTracks: MusicTrackId[];
  trackMeta: Partial<Record<MusicTrackId, MusicTrackMetaSnapshot>>;
}

export const PROGRAM_MUSIC_TRACK: Readonly<Record<CartridgeProgramId, MusicTrackId>> = {
  approach: 'approach-and-trench',
  trench: 'approach-and-trench',
  lander: 'lander-and-orbital-defense',
  flak: 'lander-and-orbital-defense',
  perimeter: 'perimeter',
};

const TRACK_FILENAMES: Readonly<Record<MusicTrackId, string>> = {
  'approach-and-trench': 'approach-and-trench.mp3',
  'lander-and-orbital-defense': 'lander-and-orbital-defense.mp3',
  perimeter: 'perimeter.mp3',
};

export function getMusicTrackForProgram(programId: CartridgeProgramId): MusicTrackId {
  return PROGRAM_MUSIC_TRACK[programId];
}

interface DecodedMusicTrack {
  trackId: MusicTrackId;
  buffer: AudioBuffer;
  trimStartSec: number;
  trimEndSec: number;
  playableDurationSec: number;
  crossfadeSec: number;
  rms: number;
  trimGain: number;
}

interface LoopVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  startCtxTime: number;
  endCtxTime: number;
  initialOffsetSec: number;
}

interface TrackSession {
  trackId: MusicTrackId;
  fadeGain: GainNode;
  trimGain: GainNode;
  voices: Set<LoopVoice>;
  nextLoopStartCtxTime: number;
  fadingOut: boolean;
  stopAtCtxTime: number;
  fadeStartVal: number;
  fadeTargetVal: number;
  fadeStartCtxTime: number;
  fadeDurationSec: number;
}

function buildEqualPowerCurves(steps = 65): {
  fadeIn: Float32Array;
  fadeOut: Float32Array;
} {
  const fadeIn = new Float32Array(steps);
  const fadeOut = new Float32Array(steps);
  const denom = Math.max(1, steps - 1);
  for (let i = 0; i < steps; i++) {
    const theta = (i / denom) * Math.PI * 0.5;
    fadeIn[i] = Math.sin(theta);
    fadeOut[i] = Math.cos(theta);
  }
  fadeIn[0] = 0;
  fadeIn[steps - 1] = 1;
  fadeOut[0] = 1;
  fadeOut[steps - 1] = 0;
  return { fadeIn, fadeOut };
}

const EQUAL_POWER_CURVES = buildEqualPowerCurves(65);

/**
 * Shared MU-TH-UR 6000 Background Music Manager.
 *
 * - Routes strictly through `AudioEngine`'s shared `AudioContext` and `masterGain`
 *   so global AUDIO mute, master volume, limiter, and background-tab suspend govern
 *   SFX and music as a single bus.
 * - Strictly in-game playback only: stays silent on Hub, Boot, Transitions, Briefings,
 *   Pause/System Menu, and Game Over unless a cartridge explicitly activates gameplay music.
 * - Decodes MP3 tracks once, trims leading & trailing MP3 encoder silence, applies gentle
 *   RMS loudness balance, and loops seamlessly via dual-voice 2.5s equal-power crossfades.
 * - Supports smooth VHF/conflict ducking (~28% attenuation, 0.12s attack / 0.45s release).
 */
export class MusicManager {
  public static readonly STORAGE_KEY = 'muthur_music_enabled_v1';
  public static readonly CROSSFADE_SEC = 2.5;
  public static readonly FADE_IN_SEC = 0.5;
  public static readonly FADE_OUT_SEC = 0.75;
  public static readonly NOMINAL_GAIN = 0.34;
  public static readonly DUCK_MULTIPLIER = 0.72;

  private static readonly DUCK_ATTACK_TAU = 0.04; // ~0.12s to 95%
  private static readonly DUCK_RELEASE_TAU = 0.15; // ~0.45s to 95%
  private static readonly SCHEDULE_LOOKAHEAD_SEC = 0.85;
  private static readonly TARGET_ACTIVE_RMS = 0.17;

  private hostAudio: AudioEngine;
  private ctx: AudioContext | null = null;
  private duckGain: GainNode | null = null;
  private musicBusGain: GainNode | null = null;

  private enabled = true;
  private desiredActive = false;
  private desiredProgramId: CartridgeProgramId | null = null;
  private desiredTrackId: MusicTrackId | null = null;
  private pendingFadeInSec = MusicManager.FADE_IN_SEC;

  private ducked = false;
  private smoothedDuckGain = 1.0;

  private rawBuffers = new Map<MusicTrackId, ArrayBuffer>();
  private fetchPromises = new Map<MusicTrackId, Promise<ArrayBuffer | null>>();
  private decodedTracks = new Map<MusicTrackId, DecodedMusicTrack>();
  private decodePromises = new Map<MusicTrackId, Promise<DecodedMusicTrack | null>>();

  private activeSession: TrackSession | null = null;
  private retiringSessions = new Set<TrackSession>();
  private resumeOffsets = new Map<MusicTrackId, number>();
  private unsubscribeUnlock: (() => void) | null = null;

  constructor(hostAudio: AudioEngine) {
    this.hostAudio = hostAudio;
    this.enabled = this.loadPersistedEnabled();
    this.unsubscribeUnlock = this.hostAudio.onUnlock(() => {
      this.handleAudioContextReady();
    });
  }

  public dispose(): void {
    if (this.unsubscribeUnlock) {
      this.unsubscribeUnlock();
      this.unsubscribeUnlock = null;
    }
    this.stopAllImmediately();
    this.teardownGraph();
  }

  public getTrackForProgram(programId: CartridgeProgramId): MusicTrackId {
    return getMusicTrackForProgram(programId);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    const next = Boolean(enabled);
    if (next === this.enabled) return;
    this.enabled = next;
    this.savePersistedEnabled(next);

    if (!next) {
      this.beginFadeOutActiveSession(MusicManager.FADE_OUT_SEC);
    } else if (this.desiredActive && this.desiredTrackId) {
      this.pendingFadeInSec = MusicManager.FADE_IN_SEC;
      void this.ensureTrackReady(this.desiredTrackId);
      this.syncPlayback();
    }
  }

  public toggleEnabled(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  /**
   * Silently prefetches (and decodes if AudioContext is already live) the track for a
   * cartridge program without starting playback. Ideal on cartridge mount/briefing so
   * gameplay launch fades in instantaneously.
   */
  public preloadForProgram(programId: CartridgeProgramId): void {
    if (!this.enabled) return;
    const trackId = getMusicTrackForProgram(programId);
    void this.ensureTrackReady(trackId);
  }

  /**
   * Activates background music for active gameplay in the given program.
   * Safe and idempotent to call on state transitions or every frame.
   */
  public startGameplayMusic(
    programId: CartridgeProgramId,
    fadeInSec = MusicManager.FADE_IN_SEC
  ): void {
    const trackId = getMusicTrackForProgram(programId);
    const clampedFadeIn = Math.max(0.05, Math.min(2.0, fadeInSec));
    const trackChanged = this.desiredTrackId !== trackId;
    const wasDesired = this.desiredActive;

    this.desiredActive = true;
    this.desiredProgramId = programId;
    this.desiredTrackId = trackId;
    if (trackChanged) {
      // Clear stale resume offsets for other tracks when switching to a different soundtrack
      for (const key of Array.from(this.resumeOffsets.keys())) {
        if (key !== trackId) this.resumeOffsets.delete(key);
      }
    }
    if (!wasDesired || trackChanged) {
      this.pendingFadeInSec = clampedFadeIn;
    }

    if (!this.enabled) {
      return;
    }

    if (!this.decodedTracks.has(trackId)) {
      void this.ensureTrackReady(trackId);
    }
    this.syncPlayback();
  }

  /**
   * Clears saved pause/resume playback position (for one program or all tracks)
   * so the next fresh run starts cleanly from the beginning of the track.
   * Also detaches any matching active/fading-out session into `retiringSessions`
   * so completing its fade-out never re-writes the stale offset into `resumeOffsets`
   * and a fast restart never resurrects the old mid-track session.
   */
  public resetTrackPosition(programId?: CartridgeProgramId): void {
    const targetTrack = programId ? getMusicTrackForProgram(programId) : null;
    if (targetTrack) {
      this.resumeOffsets.delete(targetTrack);
    } else {
      this.resumeOffsets.clear();
    }

    if (
      this.activeSession &&
      (!targetTrack || this.activeSession.trackId === targetTrack)
    ) {
      const prev = this.activeSession;
      this.activeSession = null;
      if (prev.fadingOut) {
        this.retiringSessions.add(prev);
      } else {
        this.retireSession(prev, this.desiredActive ? 0.35 : MusicManager.FADE_OUT_SEC);
      }
    }
  }

  /**
   * Smoothly fades out and stops gameplay music (default 0.75s).
   * Safe and idempotent to call repeatedly.
   */
  public stopGameplayMusic(fadeOutSec = MusicManager.FADE_OUT_SEC): void {
    const wasActive = this.desiredActive;
    this.desiredActive = false;
    if (!wasActive && (!this.activeSession || this.activeSession.fadingOut)) {
      return;
    }
    this.beginFadeOutActiveSession(Math.max(0.05, Math.min(2.0, fadeOutSec)));
  }

  /**
   * Declarative helper for cartridges that want a single idempotent sync call:
   * - `active === true` starts/maintains gameplay music for `programId`
   * - `active === false` smoothly fades gameplay music out
   */
  public setGameplayMusicActive(
    active: boolean,
    programId?: CartridgeProgramId,
    opts?: { fadeInSec?: number; fadeOutSec?: number }
  ): void {
    if (active) {
      const targetProgram = programId ?? this.desiredProgramId;
      if (!targetProgram) return;
      this.startGameplayMusic(targetProgram, opts?.fadeInSec ?? MusicManager.FADE_IN_SEC);
    } else {
      this.stopGameplayMusic(opts?.fadeOutSec ?? MusicManager.FADE_OUT_SEC);
    }
  }

  /**
   * Smoothly ducks music by ~28% (0.72x gain, ~0.12s attack / ~0.45s release) while
   * VHF/UHF radio transmissions or conflict alarms are active.
   */
  public setVhfDuck(active: boolean): void {
    const next = Boolean(active);
    if (next === this.ducked) return;
    this.ducked = next;

    if (this.ctx && this.duckGain) {
      const now = this.ctx.currentTime;
      const target = next ? MusicManager.DUCK_MULTIPLIER : 1.0;
      const tau = next ? MusicManager.DUCK_ATTACK_TAU : MusicManager.DUCK_RELEASE_TAU;
      try {
        this.duckGain.gain.cancelScheduledValues(now);
        this.duckGain.gain.setTargetAtTime(target, now, tau);
      } catch {
        // Ignore automation errors during context teardown
      }
    }
  }

  /** Alias for `setVhfDuck(active)`. */
  public setDucked(active: boolean): void {
    this.setVhfDuck(active);
  }

  public isDucked(): boolean {
    return this.ducked;
  }

  /**
   * Driven every frame from `CartridgeHost.updateAndRender(dt)` to maintain seamless
   * 2.5s dual-voice crossfade scheduling, fade-out cleanup, unlock recovery, and telemetry.
   */
  public update(dt: number): void {
    const clampedDt = Math.min(0.1, Math.max(0, dt));

    // Mirror smooth ducking gain for deterministic diagnostics
    const duckTarget = this.ducked ? MusicManager.DUCK_MULTIPLIER : 1.0;
    const duckTau = this.ducked ? MusicManager.DUCK_ATTACK_TAU : MusicManager.DUCK_RELEASE_TAU;
    const duckAlpha = 1 - Math.exp(-clampedDt / duckTau);
    this.smoothedDuckGain += (duckTarget - this.smoothedDuckGain) * duckAlpha;
    if (Math.abs(this.smoothedDuckGain - duckTarget) < 0.0005) {
      this.smoothedDuckGain = duckTarget;
    }

    // Attempt graph bind / decode / start if playback is desired
    if (this.shouldPlay()) {
      this.syncPlayback();
    }

    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') {
      return;
    }

    const now = ctx.currentTime;

    // 1. Clean up completed retiring sessions
    for (const session of Array.from(this.retiringSessions)) {
      this.pruneEndedVoices(session, now);
      if (now >= session.stopAtCtxTime || session.voices.size === 0) {
        this.destroySession(session);
        this.retiringSessions.delete(session);
      }
    }

    // 2. Manage active session fade-out completion or dual-voice crossfade lookahead
    const active = this.activeSession;
    if (!active) return;

    this.pruneEndedVoices(active, now);

    if (active.fadingOut) {
      if (now >= active.stopAtCtxTime || active.voices.size === 0) {
        this.saveSessionResumeOffset(active, now);
        this.destroySession(active);
        this.activeSession = null;
      }
      return;
    }

    // Active playing session: keep the next 2.5s equal-power crossfade voice scheduled ahead
    const decoded = this.decodedTracks.get(active.trackId);
    if (!decoded) return;

    const loopStride = Math.max(0.25, decoded.playableDurationSec - decoded.crossfadeSec);
    let safety = 0;
    while (
      now + MusicManager.SCHEDULE_LOOKAHEAD_SEC >= active.nextLoopStartCtxTime &&
      active.voices.size < 4 &&
      safety < 2
    ) {
      safety++;
      const startAt = Math.max(now + 0.015, active.nextLoopStartCtxTime);
      this.spawnLoopVoice(active, decoded, startAt, true);
      active.nextLoopStartCtxTime = startAt + loopStride;
    }

    // Recovery if all voices somehow ended (e.g. extreme browser throttling)
    if (active.voices.size === 0) {
      const startAt = now + 0.02;
      this.spawnLoopVoice(active, decoded, startAt, false);
      active.nextLoopStartCtxTime = startAt + loopStride;
    }
  }

  public getDebugState(): MusicDebugState {
    const ctx = this.ctx;
    const now = ctx?.currentTime ?? 0;
    const active = this.activeSession;

    let playbackState: MusicPlaybackState = 'STOPPED';
    if (active) {
      playbackState = active.fadingOut ? 'FADING_OUT' : 'PLAYING';
    } else if (this.shouldPlay() && this.desiredTrackId) {
      if (!ctx || ctx.state !== 'running') {
        playbackState = 'WAITING_UNLOCK';
      } else if (!this.decodedTracks.has(this.desiredTrackId)) {
        playbackState = 'LOADING';
      } else {
        playbackState = 'WAITING_UNLOCK';
      }
    }

    const fadeGain = active ? this.getSessionFadeGain(active, now) : 0;
    const trimGain = active ? (this.decodedTracks.get(active.trackId)?.trimGain ?? 1.0) : 0;
    const muted = this.hostAudio.isMuted();
    const effectiveGain =
      muted || !active
        ? 0
        : Number(
            (MusicManager.NOMINAL_GAIN * trimGain * this.smoothedDuckGain * fadeGain).toFixed(4)
          );

    const trackMeta: Partial<Record<MusicTrackId, MusicTrackMetaSnapshot>> = {};
    for (const [id, t] of this.decodedTracks.entries()) {
      trackMeta[id] = {
        durationSec: Number(t.buffer.duration.toFixed(3)),
        trimStartSec: Number(t.trimStartSec.toFixed(4)),
        trimEndSec: Number(t.trimEndSec.toFixed(4)),
        playableDurationSec: Number(t.playableDurationSec.toFixed(3)),
        crossfadeSec: Number(t.crossfadeSec.toFixed(3)),
        rms: Number(t.rms.toFixed(4)),
        trimGain: Number(t.trimGain.toFixed(3)),
      };
    }

    let voiceCount = active ? active.voices.size : 0;
    for (const r of this.retiringSessions) {
      voiceCount += r.voices.size;
    }

    return {
      enabled: this.enabled,
      muted,
      desiredActive: this.desiredActive,
      desiredProgramId: this.desiredProgramId,
      desiredTrackId: this.desiredTrackId,
      playingTrackId: active?.trackId ?? null,
      playbackState,
      activeVoiceCount: voiceCount,
      retiringSessionCount: this.retiringSessions.size,
      crossfadeSec: MusicManager.CROSSFADE_SEC,
      nominalGain: MusicManager.NOMINAL_GAIN,
      ducked: this.ducked,
      duckGain: Number(this.smoothedDuckGain.toFixed(4)),
      fadeGain: Number(fadeGain.toFixed(4)),
      effectiveGain,
      contextState: ctx?.state ?? this.hostAudio.getAudioContext()?.state ?? 'uninitialized',
      loadedTracks: Array.from(this.rawBuffers.keys()),
      decodedTracks: Array.from(this.decodedTracks.keys()),
      trackMeta,
    };
  }

  private shouldPlay(): boolean {
    return this.enabled && this.desiredActive && this.desiredTrackId !== null;
  }

  private handleAudioContextReady(): void {
    if (this.shouldPlay() && this.desiredTrackId) {
      void this.ensureTrackReady(this.desiredTrackId);
      this.syncPlayback();
    } else if (this.enabled && this.desiredProgramId) {
      // Decode any track that was prefetched prior to AudioContext creation
      const trackId = getMusicTrackForProgram(this.desiredProgramId);
      if (this.rawBuffers.has(trackId) && !this.decodedTracks.has(trackId)) {
        void this.decodeTrack(trackId);
      }
    }
  }

  private ensureGraph(): boolean {
    const ctx = this.hostAudio.getAudioContext();
    const masterOut = this.hostAudio.getMasterOutputNode();
    if (!ctx || !masterOut) return false;

    if (this.ctx === ctx && this.duckGain && this.musicBusGain) {
      return true;
    }

    this.stopAllImmediately();
    this.teardownGraph();
    this.ctx = ctx;

    const duckGain = ctx.createGain();
    duckGain.gain.value = this.ducked ? MusicManager.DUCK_MULTIPLIER : 1.0;

    const musicBusGain = ctx.createGain();
    musicBusGain.gain.value = MusicManager.NOMINAL_GAIN;

    duckGain.connect(musicBusGain);
    musicBusGain.connect(masterOut);

    this.duckGain = duckGain;
    this.musicBusGain = musicBusGain;
    return true;
  }

  private teardownGraph(): void {
    try {
      this.duckGain?.disconnect();
    } catch {
      // Ignore
    }
    try {
      this.musicBusGain?.disconnect();
    } catch {
      // Ignore
    }
    this.duckGain = null;
    this.musicBusGain = null;
    this.ctx = null;
  }

  private resolveTrackUrl(trackId: MusicTrackId): string {
    const base = import.meta.env.BASE_URL || './';
    const prefix = base === '/' ? '.' : base.replace(/\/$/, '');
    return `${prefix}/audio/music/${TRACK_FILENAMES[trackId]}`;
  }

  private async ensureTrackReady(trackId: MusicTrackId): Promise<DecodedMusicTrack | null> {
    const existing = this.decodedTracks.get(trackId);
    if (existing) return existing;

    const raw = await this.fetchTrackRaw(trackId);
    if (!raw) return null;

    return this.decodeTrack(trackId);
  }

  private fetchTrackRaw(trackId: MusicTrackId): Promise<ArrayBuffer | null> {
    const cached = this.rawBuffers.get(trackId);
    if (cached) return Promise.resolve(cached);

    const inflight = this.fetchPromises.get(trackId);
    if (inflight) return inflight;

    const url = this.resolveTrackUrl(trackId);
    const promise = (async (): Promise<ArrayBuffer | null> => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          this.fetchPromises.delete(trackId);
          return null;
        }
        const arr = await res.arrayBuffer();
        if (arr.byteLength < 1024) {
          this.fetchPromises.delete(trackId);
          return null;
        }
        this.rawBuffers.set(trackId, arr);
        return arr;
      } catch {
        this.fetchPromises.delete(trackId);
        return null;
      }
    })();

    this.fetchPromises.set(trackId, promise);
    return promise;
  }

  private decodeTrack(trackId: MusicTrackId): Promise<DecodedMusicTrack | null> {
    const existing = this.decodedTracks.get(trackId);
    if (existing) return Promise.resolve(existing);

    const inflight = this.decodePromises.get(trackId);
    if (inflight) return inflight;

    const raw = this.rawBuffers.get(trackId);
    if (!raw) return Promise.resolve(null);

    if (!this.ensureGraph() || !this.ctx) {
      return Promise.resolve(null);
    }

    const ctx = this.ctx;
    const promise = (async (): Promise<DecodedMusicTrack | null> => {
      try {
        const decodedBuf = await ctx.decodeAudioData(raw.slice(0));
        const analyzed = this.analyzeTrackBuffer(trackId, decodedBuf);
        this.decodedTracks.set(trackId, analyzed);
        this.decodePromises.delete(trackId);
        if (this.shouldPlay() && this.desiredTrackId === trackId) {
          this.syncPlayback();
        }
        return analyzed;
      } catch {
        this.decodePromises.delete(trackId);
        return null;
      }
    })();

    this.decodePromises.set(trackId, promise);
    return promise;
  }

  /**
   * Detects and trims leading & trailing MP3 encoder silence (so the crossfade loop
   * seam has zero silent gap) and calculates a gentle clamped RMS trim so all 3 tracks
   * sit consistently beneath game SFX and VHF radio.
   */
  private analyzeTrackBuffer(trackId: MusicTrackId, buffer: AudioBuffer): DecodedMusicTrack {
    const sr = buffer.sampleRate;
    const len = buffer.length;
    const numCh = buffer.numberOfChannels;
    const channels: Float32Array[] = [];
    for (let c = 0; c < numCh; c++) {
      channels.push(buffer.getChannelData(c));
    }

    // 10ms RMS blocks (strided by 4 samples inside each block for fast ~3ms decode analysis)
    const blockSamples = Math.max(1, Math.floor(sr * 0.01));
    const blockCount = Math.max(1, Math.ceil(len / blockSamples));
    const blockRms = new Float32Array(blockCount);
    let maxBlockRms = 0;

    for (let b = 0; b < blockCount; b++) {
      const start = b * blockSamples;
      const end = Math.min(len, start + blockSamples);
      let sumSq = 0;
      let count = 0;
      for (let i = start; i < end; i += 4) {
        let chSq = 0;
        for (let c = 0; c < numCh; c++) {
          const s = channels[c][i];
          chSq += s * s;
        }
        sumSq += chSq / numCh;
        count++;
      }
      const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
      blockRms[b] = rms;
      if (rms > maxBlockRms) maxBlockRms = rms;
    }

    // Silence boundary threshold (~-42 dB below peak RMS, cleanly stripping LAME padding + dead silence)
    const silenceThresh = Math.max(0.0015, maxBlockRms * 0.008);
    let firstActiveBlock = 0;
    while (firstActiveBlock < blockCount && blockRms[firstActiveBlock] < silenceThresh) {
      firstActiveBlock++;
    }
    let lastActiveBlock = blockCount - 1;
    while (lastActiveBlock > firstActiveBlock && blockRms[lastActiveBlock] < silenceThresh) {
      lastActiveBlock--;
    }

    // Refine start/end to exact sample level inside the boundary block
    const sampleThresh = silenceThresh * 0.5;
    let startSample = Math.max(0, (firstActiveBlock - 1) * blockSamples);
    const startSearchEnd = Math.min(len, (firstActiveBlock + 1) * blockSamples);
    for (let i = startSample; i < startSearchEnd; i++) {
      let amp = 0;
      for (let c = 0; c < numCh; c++) {
        const a = Math.abs(channels[c][i]);
        if (a > amp) amp = a;
      }
      if (amp >= sampleThresh) {
        startSample = i;
        break;
      }
    }

    let endSample = Math.min(len, (lastActiveBlock + 2) * blockSamples);
    const endSearchMin = Math.max(startSample, lastActiveBlock * blockSamples);
    for (let i = endSample - 1; i >= endSearchMin; i--) {
      let amp = 0;
      for (let c = 0; c < numCh; c++) {
        const a = Math.abs(channels[c][i]);
        if (a > amp) amp = a;
      }
      if (amp >= sampleThresh) {
        endSample = i + 1;
        break;
      }
    }

    let trimStartSec = startSample / sr;
    let trimEndSec = endSample / sr;
    if (trimEndSec - trimStartSec < 2.0) {
      trimStartSec = 0;
      trimEndSec = buffer.duration;
    }

    // Compute active RMS (blocks above -32 dB of peak RMS) for consistent loudness across all 3 tracks
    const activeThresh = Math.max(0.004, maxBlockRms * 0.025);
    let activeSumSq = 0;
    let activeCount = 0;
    for (let b = firstActiveBlock; b <= lastActiveBlock; b++) {
      const r = blockRms[b];
      if (r >= activeThresh) {
        activeSumSq += r * r;
        activeCount++;
      }
    }
    const activeRms = activeCount > 0 ? Math.sqrt(activeSumSq / activeCount) : MusicManager.TARGET_ACTIVE_RMS;
    const rawTrim = activeRms > 0.01 ? MusicManager.TARGET_ACTIVE_RMS / activeRms : 1.0;
    const trimGain = Math.max(0.76, Math.min(1.2, rawTrim));

    const playableDurationSec = Math.max(1.0, trimEndSec - trimStartSec);
    // Use exact 2.5s equal-power crossfade on normal-length tracks; safely clamp for ultra-short buffers
    const crossfadeSec = Math.min(
      MusicManager.CROSSFADE_SEC,
      Math.max(0.05, (playableDurationSec - 0.1) * 0.4)
    );

    return {
      trackId,
      buffer,
      trimStartSec,
      trimEndSec,
      playableDurationSec,
      crossfadeSec,
      rms: activeRms,
      trimGain,
    };
  }

  private syncPlayback(): void {
    if (!this.shouldPlay() || !this.desiredTrackId) {
      return;
    }

    const trackId = this.desiredTrackId;
    if (!this.ensureGraph() || !this.ctx || !this.duckGain) {
      return;
    }
    if (this.ctx.state !== 'running') {
      return;
    }

    // Trigger decode if raw bytes are ready but not yet decoded
    if (!this.decodedTracks.has(trackId)) {
      if (this.rawBuffers.has(trackId)) {
        void this.decodeTrack(trackId);
      } else {
        void this.ensureTrackReady(trackId);
      }
      return;
    }

    const decoded = this.decodedTracks.get(trackId)!;

    // Already have an active session for this exact track?
    if (this.activeSession && this.activeSession.trackId === trackId) {
      if (this.activeSession.fadingOut) {
        // Smoothly cancel fade-out and swell back to full nominal level (no jarring restart!)
        this.activeSession.fadingOut = false;
        this.activeSession.stopAtCtxTime = Number.POSITIVE_INFINITY;
        this.rampSessionFade(this.activeSession, 1.0, Math.min(0.45, this.pendingFadeInSec));
      }
      return;
    }

    // Switching from a different track: smoothly retire old session so transitions never pop
    if (this.activeSession) {
      this.retireSession(this.activeSession, 0.45);
      this.activeSession = null;
    }

    // Start new session cleanly with fade-in
    this.startNewSession(decoded, this.pendingFadeInSec);
  }

  private startNewSession(decoded: DecodedMusicTrack, fadeInSec: number): void {
    const ctx = this.ctx;
    const duckGain = this.duckGain;
    if (!ctx || !duckGain) return;

    const now = ctx.currentTime;
    const fadeGain = ctx.createGain();
    fadeGain.gain.setValueAtTime(0.0, now);

    const trimGain = ctx.createGain();
    trimGain.gain.value = decoded.trimGain;

    fadeGain.connect(trimGain);
    trimGain.connect(duckGain);

    const startAt = now + 0.015;
    const savedOffset = this.resumeOffsets.get(decoded.trackId) ?? 0;
    const initialOffsetSec =
      savedOffset >= 0.5 && decoded.playableDurationSec - savedOffset >= decoded.crossfadeSec + 3.0
        ? savedOffset
        : 0;
    this.resumeOffsets.delete(decoded.trackId);

    const remainingPlayable = Math.max(0.25, decoded.playableDurationSec - initialOffsetSec);
    const loopStride = Math.max(0.25, remainingPlayable - decoded.crossfadeSec);

    const session: TrackSession = {
      trackId: decoded.trackId,
      fadeGain,
      trimGain,
      voices: new Set<LoopVoice>(),
      nextLoopStartCtxTime: startAt + loopStride,
      fadingOut: false,
      stopAtCtxTime: Number.POSITIVE_INFINITY,
      fadeStartVal: 0,
      fadeTargetVal: 0,
      fadeStartCtxTime: now,
      fadeDurationSec: 0,
    };

    this.spawnLoopVoice(session, decoded, startAt, false, initialOffsetSec);
    this.rampSessionFade(session, 1.0, fadeInSec);
    this.activeSession = session;
  }

  private spawnLoopVoice(
    session: TrackSession,
    decoded: DecodedMusicTrack,
    startAt: number,
    isLoopOverlap: boolean,
    initialOffsetSec = 0
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const src = ctx.createBufferSource();
    src.buffer = decoded.buffer;
    src.loop = false;

    const voiceGain = ctx.createGain();
    const xfade = decoded.crossfadeSec;
    const effectiveOffset = isLoopOverlap ? 0 : initialOffsetSec;
    const playableForVoice = Math.max(0.2, decoded.playableDurationSec - effectiveOffset);
    const fadeOutStart = startAt + Math.max(0.05, playableForVoice - xfade);
    const endCtxTime = startAt + playableForVoice;

    if (isLoopOverlap) {
      // Initial gain 0 before startAt; strictly non-overlapping equal-power fade-in & fade-out curves
      voiceGain.gain.value = 0;
      voiceGain.gain.setValueCurveAtTime(EQUAL_POWER_CURVES.fadeIn, startAt, xfade);
      voiceGain.gain.setValueCurveAtTime(EQUAL_POWER_CURVES.fadeOut, fadeOutStart, xfade);
    } else {
      // First voice starts at unity (session fadeGain performs the smooth 0.5s gameplay fade-in)
      voiceGain.gain.value = 1;
      voiceGain.gain.setValueCurveAtTime(EQUAL_POWER_CURVES.fadeOut, fadeOutStart, xfade);
    }

    src.connect(voiceGain);
    voiceGain.connect(session.fadeGain);

    const bufOffset = decoded.trimStartSec + effectiveOffset;
    const remainingInBuffer = Math.max(0.05, decoded.buffer.duration - bufOffset);
    const playDur = Math.min(playableForVoice + 0.03, remainingInBuffer);

    const voice: LoopVoice = {
      source: src,
      gain: voiceGain,
      startCtxTime: startAt,
      endCtxTime: endCtxTime + 0.04,
      initialOffsetSec: effectiveOffset,
    };

    src.onended = () => {
      session.voices.delete(voice);
      try {
        src.disconnect();
      } catch {
        // Ignore
      }
      try {
        voiceGain.disconnect();
      } catch {
        // Ignore
      }
    };

    session.voices.add(voice);
    src.start(startAt, bufOffset, playDur);
  }

  private saveSessionResumeOffset(session: TrackSession, now: number): void {
    const decoded = this.decodedTracks.get(session.trackId);
    if (!decoded) return;

    let latestVoice: LoopVoice | null = null;
    for (const v of session.voices) {
      if (v.startCtxTime <= now && (!latestVoice || v.startCtxTime > latestVoice.startCtxTime)) {
        latestVoice = v;
      }
    }
    if (!latestVoice) return;

    const elapsed = Math.max(0, now - latestVoice.startCtxTime);
    const pos = (latestVoice.initialOffsetSec + elapsed) % decoded.playableDurationSec;
    if (pos >= 0.5 && decoded.playableDurationSec - pos >= decoded.crossfadeSec + 3.0) {
      this.resumeOffsets.set(session.trackId, pos);
    } else {
      this.resumeOffsets.delete(session.trackId);
    }
  }

  private getSessionFadeGain(session: TrackSession, now: number): number {
    if (session.fadeDurationSec <= 0 || now >= session.fadeStartCtxTime + session.fadeDurationSec) {
      return session.fadeTargetVal;
    }
    if (now <= session.fadeStartCtxTime) {
      return session.fadeStartVal;
    }
    const u = (now - session.fadeStartCtxTime) / session.fadeDurationSec;
    return session.fadeStartVal + (session.fadeTargetVal - session.fadeStartVal) * u;
  }

  private rampSessionFade(session: TrackSession, target: number, durationSec: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const cur = this.getSessionFadeGain(session, now);
    const dur = Math.max(0.02, durationSec);

    try {
      session.fadeGain.gain.cancelScheduledValues(now);
      session.fadeGain.gain.setValueAtTime(cur, now);
      session.fadeGain.gain.linearRampToValueAtTime(target, now + dur);
    } catch {
      // Ignore automation errors
    }

    session.fadeStartVal = cur;
    session.fadeTargetVal = target;
    session.fadeStartCtxTime = now;
    session.fadeDurationSec = dur;
  }

  private beginFadeOutActiveSession(fadeOutSec: number): void {
    const session = this.activeSession;
    if (!session) return;

    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') {
      this.destroySession(session);
      this.activeSession = null;
      return;
    }

    const now = ctx.currentTime;
    const dur = Math.max(0.05, fadeOutSec);
    if (session.fadingOut && session.stopAtCtxTime <= now + dur + 0.04) {
      return;
    }
    session.fadingOut = true;
    session.stopAtCtxTime = now + dur + 0.04;
    this.rampSessionFade(session, 0.0, dur);
  }

  private retireSession(session: TrackSession, fadeOutSec: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') {
      this.destroySession(session);
      return;
    }
    const now = ctx.currentTime;
    const dur = Math.max(0.05, fadeOutSec);
    session.fadingOut = true;
    session.stopAtCtxTime = now + dur + 0.04;
    this.rampSessionFade(session, 0.0, dur);
    this.retiringSessions.add(session);
  }

  private pruneEndedVoices(session: TrackSession, now: number): void {
    for (const voice of Array.from(session.voices)) {
      if (now >= voice.endCtxTime + 0.1) {
        session.voices.delete(voice);
        try {
          voice.source.stop();
        } catch {
          // Ignore
        }
        try {
          voice.source.disconnect();
          voice.gain.disconnect();
        } catch {
          // Ignore
        }
      }
    }
  }

  private destroySession(session: TrackSession): void {
    const now = this.ctx?.currentTime ?? 0;
    for (const voice of Array.from(session.voices)) {
      voice.source.onended = null;
      try {
        voice.gain.gain.cancelScheduledValues(now);
      } catch {
        // Ignore
      }
      try {
        voice.source.stop();
      } catch {
        // Ignore
      }
      try {
        voice.source.disconnect();
        voice.gain.disconnect();
      } catch {
        // Ignore
      }
    }
    session.voices.clear();
    try {
      session.fadeGain.gain.cancelScheduledValues(now);
      session.fadeGain.disconnect();
      session.trimGain.disconnect();
    } catch {
      // Ignore
    }
  }

  private stopAllImmediately(): void {
    if (this.activeSession) {
      this.destroySession(this.activeSession);
      this.activeSession = null;
    }
    for (const session of Array.from(this.retiringSessions)) {
      this.destroySession(session);
    }
    this.retiringSessions.clear();
  }

  private loadPersistedEnabled(): boolean {
    try {
      const raw = window.localStorage.getItem(MusicManager.STORAGE_KEY);
      if (raw === 'false' || raw === '0') return false;
      if (raw === 'true' || raw === '1') return true;
    } catch {
      // Ignore storage restrictions
    }
    return true;
  }

  private savePersistedEnabled(enabled: boolean): void {
    try {
      window.localStorage.setItem(MusicManager.STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      // Ignore storage restrictions
    }
  }
}
