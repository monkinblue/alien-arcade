import type { AudioEngine } from '../../audio/AudioEngine';
import type { OrbitalThreat } from './types';
import { FLAK_CONSTANTS } from './types';

type FlakSfxId =
  | 'flak_launch_light_01'
  | 'flak_launch_light_02'
  | 'flak_launch_light_03'
  | 'flak_launch_emp'
  | 'flak_detonate_airburst_01'
  | 'flak_detonate_airburst_02'
  | 'flak_detonate_airburst_03'
  | 'flak_detonate_emp'
  | 'battery_reload_clank'
  | 'battery_reload_clank_02'
  | 'dome_breach_impact'
  | 'radar_ping_lock'
  | 'dome_lock_alarm'
  | 'mirv_split_warning'
  | 'wave_incoming_klaxon'
  | 'ion_jammer_loop'
  | 'meteor_deflect_impact'
  | 'orbital_droppod_restore'
  | 'boss_arrival_horn'
  | 'boss_salvo_fire'
  | 'boss_hull_hit'
  | 'boss_destroyed';

interface FlakManifestData {
  version: number;
  assets?: Record<string, { path: string; category?: 'loop' | 'sfx'; bytes: number }>;
}

interface DopplerVoice {
  osc: OscillatorNode;
  subOsc: OscillatorNode;
  bp: BiquadFilterNode;
  gain: GainNode;
  panner: StereoPannerNode;
  curGain: number;
  curFreq: number;
  curPan: number;
}

/**
 * Cinema-Grade Spatial Web Audio DSP Engine for Program #3 (ORBITAL INTERCEPT // FLAK NET).
 * - Shares the host AudioEngine's unlocked AudioContext & Master Limiter/Mute bus.
 * - Prefetches & decodes 16 custom HD ElevenLabs movie-quality SFX from `/audio/flak/`:
 *   multi-variant 90mm flak launches & airburst explosions, seismic EMP mortar launch & blast,
 *   autoloader breech clank, dome breach explosion, urgent lock-on / MIRV / wave klaxons,
 *   seamless Ion Jammer interference loop, armored meteor deflection crunch, and drop-pod touchdown.
 * - Automatically trims MP3 encoder lead-in silence (`detectTransientOnsetSec`) so every shot
 *   and explosion hits with instant IMAX transient punch.
 * - Routes through a dedicated Cinema Mastering Bus (low-end chest shelf + crisp presence shelf +
 *   concussion low-pass ducker + transparent bus punch compressor).
 */
export class FlakAudioEngine {
  private hostAudio: AudioEngine;
  private ctx: AudioContext | null = null;
  private busInput: GainNode | null = null;
  private ordnanceInput: GainNode | null = null;
  private preDuckInput: GainNode | null = null;
  private concussionFilter: BiquadFilterNode | null = null;
  private busCompressor: DynamicsCompressorNode | null = null;
  private busOutput: GainNode | null = null;

  private brownNoiseBuffer: AudioBuffer | null = null;
  private softClipCurve: Float32Array<ArrayBuffer> | null = null;

  private rawBuffers = new Map<FlakSfxId, { data: ArrayBuffer; isLoop: boolean }>();
  private decodedBuffers = new Map<FlakSfxId, AudioBuffer>();
  private bufferOnsets = new Map<FlakSfxId, number>();
  private prefetchStarted = false;
  private decodeInFlight = false;

  private activeSources = new Set<AudioScheduledSourceNode>();
  private dopplerVoices: DopplerVoice[] = [];

  // Continuous stereo-panned Ion Storm Radar Jammer Interference Loop
  private jammerSource: AudioBufferSourceNode | null = null;
  private jammerFilter: BiquadFilterNode | null = null;
  private jammerPanner: StereoPannerNode | null = null;
  private jammerGain: GainNode | null = null;
  private curJammerGain = 0;
  private curJammerPan = 0;

  private mounted = false;

  // Round-robin variant cursors so rapid salvos never sound repetitive
  private launchLightCursor = 0;
  private airburstCursor = 0;
  private reloadCursor = 0;

  // Polyphony / cadence throttles
  private lastPingTime = 0;
  private lastDeflectTime = 0;
  private lastComboTime = 0;
  private lastDomeLockAlarmTime = 0;
  private lastMirvWarnTime = 0;
  private lastReloadTime = 0;

  constructor(hostAudio: AudioEngine) {
    this.hostAudio = hostAudio;
  }

  public mount(): void {
    this.mounted = true;
    if (!this.prefetchStarted) {
      this.prefetchStarted = true;
      void this.prefetchFlakAssets();
    }
    this.ensureGraph();
  }

  public getLoadedAudioStats(): {
    fetched: number;
    decoded: number;
    expected: number;
    contextState: string;
  } {
    return {
      fetched: this.rawBuffers.size,
      decoded: this.decodedBuffers.size,
      expected: 22,
      contextState: this.ctx?.state ?? 'uninitialized',
    };
  }

  /**
   * Immediately stops every scheduled source, Doppler oscillator, and Ion Jammer loop
   * so ZERO audio ever leaks back into MU-TH-UR OS or other cartridges!
   */
  public unmount(): void {
    this.mounted = false;
    this.silenceAll();
    this.teardownGraph();
  }

  public silenceAll(): void {
    for (const src of this.activeSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already stopped sources
      }
    }
    this.activeSources.clear();

    const now = this.ctx?.currentTime ?? 0;
    for (const v of this.dopplerVoices) {
      v.curGain = 0;
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(0, now);
      } catch {
        // Ignore
      }
    }

    this.curJammerGain = 0;
    if (this.jammerGain) {
      try {
        this.jammerGain.gain.cancelScheduledValues(now);
        this.jammerGain.gain.setValueAtTime(0, now);
      } catch {
        // Ignore
      }
    }

    if (this.ctx && this.concussionFilter) {
      try {
        this.concussionFilter.frequency.cancelScheduledValues(now);
        this.concussionFilter.frequency.setValueAtTime(20000, now);
      } catch {
        // Ignore
      }
    }
  }

  private ensureGraph(): boolean {
    if (!this.mounted) return false;
    const ctx = this.hostAudio.getAudioContext();
    const masterOut = this.hostAudio.getMasterOutputNode();
    if (!ctx || !masterOut) return false;

    if (this.ctx === ctx && this.busInput && this.ordnanceInput && this.busOutput) {
      if (this.rawBuffers.size > this.decodedBuffers.size && !this.decodeInFlight) {
        void this.decodePrefetched();
      }
      return true;
    }

    this.teardownGraph();
    this.ctx = ctx;

    this.busInput = ctx.createGain();
    this.busInput.gain.value = 1.0;

    // Dedicated Full-Range Cinema Ordnance Bus for realistic cannon shots & C4/artillery airbursts:
    // Full crisp bandwidth (no low-pass muddying!) + clean +2.8 dB 68Hz sub-bass theater weight!
    this.ordnanceInput = ctx.createGain();
    this.ordnanceInput.gain.value = 1.0;

    const ordnanceSubBoost = ctx.createBiquadFilter();
    ordnanceSubBoost.type = 'lowshelf';
    ordnanceSubBoost.frequency.value = 68;
    ordnanceSubBoost.gain.value = 2.8;

    const ordnancePresence = ctx.createBiquadFilter();
    ordnancePresence.type = 'highshelf';
    ordnancePresence.frequency.value = 4200;
    ordnancePresence.gain.value = 1.4;

    this.preDuckInput = ctx.createGain();
    this.preDuckInput.gain.value = 1.0;

    // Cinema Mastering EQ Chain for alerts, alarms, reloads & beds
    const subShelf = ctx.createBiquadFilter();
    subShelf.type = 'lowshelf';
    subShelf.frequency.value = 78;
    subShelf.gain.value = 1.8;

    const presenceShelf = ctx.createBiquadFilter();
    presenceShelf.type = 'highshelf';
    presenceShelf.frequency.value = 3400;
    presenceShelf.gain.value = 1.0;

    // Master Concussion Ducking Filter (20kHz nominal -> sweeps to 300Hz on dome breach!)
    this.concussionFilter = ctx.createBiquadFilter();
    this.concussionFilter.type = 'lowpass';
    this.concussionFilter.frequency.value = 20000;
    this.concussionFilter.Q.value = 0.8;

    // Transparent studio bus limiter/glue compressor so massive real recordings hit clean and loud
    this.busCompressor = ctx.createDynamicsCompressor();
    this.busCompressor.threshold.value = -7.0;
    this.busCompressor.knee.value = 6.0;
    this.busCompressor.ratio.value = 3.8;
    this.busCompressor.attack.value = 0.005;
    this.busCompressor.release.value = 0.14;

    this.busOutput = ctx.createGain();
    this.busOutput.gain.value = 1.24;

    this.busInput.connect(subShelf);
    subShelf.connect(presenceShelf);
    presenceShelf.connect(this.concussionFilter);

    this.ordnanceInput.connect(ordnanceSubBoost);
    ordnanceSubBoost.connect(ordnancePresence);
    ordnancePresence.connect(this.concussionFilter);

    this.concussionFilter.connect(this.busCompressor);
    this.preDuckInput.connect(this.busCompressor);
    this.busCompressor.connect(this.busOutput);
    this.busOutput.connect(masterOut);

    this.buildSharedNoiseAndCurves(ctx);
    this.buildDopplerPool(ctx);
    this.buildIonJammerLoopBus(ctx);

    if (this.rawBuffers.size > 0 && !this.decodeInFlight) {
      void this.decodePrefetched();
    }
    return true;
  }

  private teardownGraph(): void {
    for (const v of this.dopplerVoices) {
      try {
        v.osc.stop();
        v.subOsc.stop();
        v.osc.disconnect();
        v.subOsc.disconnect();
        v.bp.disconnect();
        v.gain.disconnect();
        v.panner.disconnect();
      } catch {
        // Ignore
      }
    }
    this.dopplerVoices = [];

    try {
      this.jammerSource?.stop();
      this.jammerSource?.disconnect();
      this.jammerFilter?.disconnect();
      this.jammerPanner?.disconnect();
      this.jammerGain?.disconnect();
    } catch {
      // Ignore
    }
    this.jammerSource = null;
    this.jammerFilter = null;
    this.jammerPanner = null;
    this.jammerGain = null;
    this.curJammerGain = 0;

    try {
      this.busInput?.disconnect();
      this.ordnanceInput?.disconnect();
      this.preDuckInput?.disconnect();
      this.concussionFilter?.disconnect();
      this.busCompressor?.disconnect();
      this.busOutput?.disconnect();
    } catch {
      // Ignore
    }
    this.busInput = null;
    this.ordnanceInput = null;
    this.preDuckInput = null;
    this.concussionFilter = null;
    this.busCompressor = null;
    this.busOutput = null;
    this.ctx = null;
  }

  private buildSharedNoiseAndCurves(ctx: AudioContext): void {
    const sr = ctx.sampleRate;
    const len = sr * 2;
    const brownBuf = ctx.createBuffer(1, len, sr);
    const bd = brownBuf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < len; i++) {
      const r = Math.random() * 2 - 1;
      brown = (brown + 0.045 * r) / 1.045;
      bd[i] = Math.max(-1, Math.min(1, brown * 2.8));
    }
    this.brownNoiseBuffer = brownBuf;

    const n = 512;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    const drive = 2.4;
    const norm = Math.tanh(drive);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      curve[i] = Math.tanh(x * drive) / norm;
    }
    this.softClipCurve = curve;
  }

  private buildIonJammerLoopBus(ctx: AudioContext): void {
    if (!this.busInput) return;

    this.jammerFilter = ctx.createBiquadFilter();
    this.jammerFilter.type = 'bandpass';
    this.jammerFilter.frequency.value = 1450;
    this.jammerFilter.Q.value = 0.72;

    this.jammerPanner = ctx.createStereoPanner();
    this.jammerPanner.pan.value = 0;

    this.jammerGain = ctx.createGain();
    this.jammerGain.gain.value = 0;

    this.jammerFilter.connect(this.jammerPanner);
    this.jammerPanner.connect(this.jammerGain);
    this.jammerGain.connect(this.busInput);

    // Start procedural fallback buffer right away; seamlessly hot-swaps to ElevenLabs MP3 once decoded!
    const fallbackBuf = this.buildProceduralJammerLoopBuffer(ctx);
    this.startJammerLoopSource(this.decodedBuffers.get('ion_jammer_loop') ?? fallbackBuf);
  }

  private buildProceduralJammerLoopBuffer(ctx: AudioContext): AudioBuffer {
    const sr = ctx.sampleRate;
    const dur = 4;
    const len = sr * dur;
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const hum = Math.sin(2 * Math.PI * 120 * t) * 0.24 + Math.sin(2 * Math.PI * 240 * t) * 0.14;
      const sweep = Math.sin(2 * Math.PI * (640 + 480 * Math.sin(2 * Math.PI * 1.25 * t)) * t) * 0.15;
      const crackle = Math.random() < 0.015 ? (Math.random() * 2 - 1) * 0.85 : (Math.random() * 2 - 1) * 0.09;
      d[i] = Math.tanh((hum + sweep + crackle) * 1.35) * 0.65;
    }
    return buf;
  }

  private startJammerLoopSource(buf: AudioBuffer): void {
    if (!this.ctx || !this.jammerFilter) return;
    try {
      this.jammerSource?.stop();
      this.jammerSource?.disconnect();
    } catch {
      // Ignore
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.jammerFilter);
    src.start();
    this.jammerSource = src;
  }

  private buildDopplerPool(ctx: AudioContext): void {
    if (!this.busInput) return;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 1100;

      const subOsc = ctx.createOscillator();
      subOsc.type = 'triangle';
      subOsc.frequency.value = 550;

      const subMix = ctx.createGain();
      subMix.gain.value = 0.45;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 6.5;

      const gain = ctx.createGain();
      gain.gain.value = 0;

      const panner = ctx.createStereoPanner();
      panner.pan.value = 0;

      osc.connect(bp);
      subOsc.connect(subMix);
      subMix.connect(bp);
      bp.connect(gain);
      gain.connect(panner);
      panner.connect(this.busInput);

      osc.start();
      subOsc.start();

      this.dopplerVoices.push({
        osc,
        subOsc,
        bp,
        gain,
        panner,
        curGain: 0,
        curFreq: 1100,
        curPan: 0,
      });
    }
  }

  private async prefetchFlakAssets(): Promise<void> {
    try {
      const base = import.meta.env.BASE_URL || './';
      const prefix = base === '/' ? '.' : base.replace(/\/$/, '');
      const res = await fetch(`${prefix}/audio/flak/manifest.json`, { cache: 'no-cache' });
      if (!res.ok) return;
      const data = (await res.json()) as FlakManifestData;
      if (!data || !data.assets || typeof data.assets !== 'object') return;

      const entries = Object.entries(data.assets);
      await Promise.all(
        entries.map(async ([id, meta]) => {
          try {
            const mp3Res = await fetch(`${prefix}${meta.path}?v=${meta.bytes}`, {
              cache: 'no-cache',
            });
            if (!mp3Res.ok) return;
            const arr = await mp3Res.arrayBuffer();
            if (arr.byteLength > 512) {
              this.rawBuffers.set(id as FlakSfxId, {
                data: arr,
                isLoop: meta.category === 'loop' || id.endsWith('_loop'),
              });
            }
          } catch {
            // Procedural fallback covers missing assets cleanly
          }
        })
      );

      if (this.ctx) {
        await this.decodePrefetched();
      }
    } catch {
      // Zero-silence procedural fallback active
    }
  }

  private detectTransientOnsetSec(buf: AudioBuffer): number {
    const ch = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
    const thresh = Math.max(0.018, peak * 0.12);
    for (let i = 0; i < ch.length; i++) {
      if (Math.abs(ch[i]) >= thresh) {
        return Math.max(0, i / buf.sampleRate - 0.004);
      }
    }
    return 0;
  }

  private createSeamlessOverlapLoop(srcBuf: AudioBuffer, crossfadeSec = 0.7): AudioBuffer {
    if (!this.ctx) return srcBuf;
    const sr = srcBuf.sampleRate;
    const trim = Math.min(Math.floor(sr * 0.05), Math.floor(srcBuf.length * 0.05));
    const trimmedLen = srcBuf.length - trim * 2;
    if (trimmedLen < sr * 1.2) return srcBuf;

    const fadeSamples = Math.min(Math.floor(sr * crossfadeSec), Math.floor(trimmedLen * 0.22));
    const outLen = trimmedLen - fadeSamples;
    const outBuf = this.ctx.createBuffer(srcBuf.numberOfChannels, outLen, sr);

    for (let ch = 0; ch < srcBuf.numberOfChannels; ch++) {
      const src = srcBuf.getChannelData(ch);
      const dst = outBuf.getChannelData(ch);
      for (let i = 0; i < fadeSamples; i++) {
        const theta = (i / fadeSamples) * (Math.PI * 0.5);
        dst[i] = src[trim + i] * Math.sin(theta) + src[trim + outLen + i] * Math.cos(theta);
      }
      for (let i = fadeSamples; i < outLen; i++) {
        dst[i] = src[trim + i];
      }
    }
    return outBuf;
  }

  private async decodePrefetched(): Promise<void> {
    if (!this.ctx || this.decodeInFlight) return;
    this.decodeInFlight = true;
    const ctx = this.ctx;
    try {
      const pending = Array.from(this.rawBuffers.entries()).filter(
        ([id]) => !this.decodedBuffers.has(id)
      );
      await Promise.all(
        pending.map(async ([id, item]) => {
          try {
            const rawDecoded = await ctx.decodeAudioData(item.data.slice(0));
            const finalBuf = item.isLoop
              ? this.createSeamlessOverlapLoop(rawDecoded, 0.75)
              : rawDecoded;
            this.normalizePeak(finalBuf, 0.94);
            this.decodedBuffers.set(id, finalBuf);
            if (!item.isLoop) {
              this.bufferOnsets.set(id, this.detectTransientOnsetSec(finalBuf));
            } else if (id === 'ion_jammer_loop' && this.mounted) {
              this.startJammerLoopSource(finalBuf);
            }
          } catch {
            // Keep procedural fallback
          }
        })
      );
    } finally {
      this.decodeInFlight = false;
    }
  }

  private normalizePeak(buf: AudioBuffer, targetPeak: number): void {
    let peak = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
      }
    }
    if (peak <= 1e-5) return;
    const scale = targetPeak / peak;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        d[i] *= scale;
      }
    }
  }

  private trackSource(src: AudioScheduledSourceNode): void {
    this.activeSources.add(src);
    src.onended = () => {
      this.activeSources.delete(src);
      try {
        src.disconnect();
      } catch {
        // Ignore
      }
    };
  }

  private panFromScreenX(screenXNorm: number): number {
    return Math.max(-0.85, Math.min(0.85, (screenXNorm * 2 - 1) * 0.85));
  }

  private playDecodedSample(
    id: FlakSfxId,
    startTime: number,
    pan: number,
    volume: number,
    pitch = 1.0,
    route: 'standard' | 'ordnance' | 'preDuck' = 'standard'
  ): boolean {
    if (!this.ctx || !this.busInput || !this.ordnanceInput || !this.preDuckInput) return false;
    const buf = this.decodedBuffers.get(id);
    if (!buf) return false;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(pitch, startTime);

    const onset = this.bufferOnsets.get(id) ?? 0;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, startTime);

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, startTime);

    const dest =
      route === 'preDuck'
        ? this.preDuckInput
        : route === 'ordnance'
          ? this.ordnanceInput
          : this.busInput;

    src.connect(gain);
    gain.connect(panner);
    panner.connect(dest);

    this.trackSource(src);
    src.start(startTime, onset);
    return true;
  }

  private pickLoadedVariant(ids: readonly FlakSfxId[], cursor: number): FlakSfxId | null {
    const loaded = ids.filter((id) => this.decodedBuffers.has(id));
    if (loaded.length === 0) return null;
    return loaded[cursor % loaded.length];
  }

  // ===========================================================================
  // 1. M90 CANNON LAUNCH (3 Pure ElevenLabs Heavy Artillery Field Recordings — Zero Synth Pluck!)
  // ===========================================================================
  public playLaunchLight(screenXNorm: number): void {
    if (!this.ensureGraph() || !this.ctx || !this.ordnanceInput) return;
    const now = this.ctx.currentTime;
    const pan = this.panFromScreenX(screenXNorm);
    const pitchVar = 0.93 + Math.random() * 0.11;

    const variant = this.pickLoadedVariant(
      ['flak_launch_light_01', 'flak_launch_light_02', 'flak_launch_light_03'],
      this.launchLightCursor++
    );
    if (variant && this.playDecodedSample(variant, now, pan, 1.06, pitchVar, 'ordnance')) {
      return;
    }

    // Emergency fallback only if MP3s are still decoding on frame 0
    if (this.brownNoiseBuffer) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(pan, now);
      panner.connect(this.ordnanceInput);
      const nSrc = this.ctx.createBufferSource();
      nSrc.buffer = this.brownNoiseBuffer;
      const nLp = this.ctx.createBiquadFilter();
      nLp.type = 'lowpass';
      nLp.frequency.setValueAtTime(520 * pitchVar, now);
      nLp.frequency.exponentialRampToValueAtTime(110, now + 0.18);
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.62, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      nSrc.connect(nLp);
      nLp.connect(nGain);
      nGain.connect(panner);
      this.trackSource(nSrc);
      nSrc.start(now, Math.random() * 0.8, 0.24);
    }
  }

  // ===========================================================================
  // 2. MK-IV EMP MORTAR LAUNCH (Heavy hydraulic mortar blast + HV capacitor whine)
  // ===========================================================================
  public playLaunchEmp(screenXNorm: number): void {
    if (!this.ensureGraph() || !this.ctx || !this.ordnanceInput) return;
    const now = this.ctx.currentTime;
    const pan = this.panFromScreenX(screenXNorm);

    if (
      this.playDecodedSample(
        'flak_launch_emp',
        now,
        pan,
        1.1,
        0.95 + Math.random() * 0.06,
        'ordnance'
      )
    ) {
      return;
    }

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);
    panner.connect(this.ordnanceInput);

    const thunk = this.ctx.createOscillator();
    thunk.type = 'sine';
    thunk.frequency.setValueAtTime(135, now);
    thunk.frequency.exponentialRampToValueAtTime(26, now + 0.32);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.softClipCurve;
    const thunkGain = this.ctx.createGain();
    thunkGain.gain.setValueAtTime(0.8, now);
    thunkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    thunk.connect(shaper);
    shaper.connect(thunkGain);
    thunkGain.connect(panner);
    this.trackSource(thunk);
    thunk.start(now);
    thunk.stop(now + 0.4);
  }

  // ===========================================================================
  // 3. AIRBURST EXPLOSION (3 Pure Crisp Cinema C4/TNT Airburst Recordings — Zero Typewriter!)
  // ===========================================================================
  public playDetonateAirburst(screenXNorm: number, altitudeNorm: number): void {
    if (!this.ensureGraph() || !this.ctx || !this.ordnanceInput) return;
    const now = this.ctx.currentTime;
    const pan = this.panFromScreenX(screenXNorm);

    // Authentic Speed-of-Sound Blast Delay (28ms..92ms by altitude) for true atmospheric scale
    const clampedAlt = Math.max(0, Math.min(1, altitudeNorm));
    const speedOfSoundDelay = 0.028 + clampedAlt * 0.064;
    const boomTime = now + speedOfSoundDelay;

    const pitchVar = 0.92 + Math.random() * 0.14;
    const variant = this.pickLoadedVariant(
      [
        'flak_detonate_airburst_01',
        'flak_detonate_airburst_02',
        'flak_detonate_airburst_03',
      ],
      this.airburstCursor++
    );

    if (variant && this.playDecodedSample(variant, boomTime, pan, 1.16, pitchVar, 'ordnance')) {
      return;
    }

    // Emergency fallback only if MP3s are still decoding
    if (this.brownNoiseBuffer) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(pan, boomTime);
      panner.connect(this.ordnanceInput);
      const rumble = this.ctx.createBufferSource();
      rumble.buffer = this.brownNoiseBuffer;
      const rumbleLp = this.ctx.createBiquadFilter();
      rumbleLp.type = 'lowpass';
      rumbleLp.frequency.setValueAtTime(480, boomTime);
      rumbleLp.frequency.exponentialRampToValueAtTime(82, boomTime + 0.72);
      const rumbleGain = this.ctx.createGain();
      rumbleGain.gain.setValueAtTime(0.76, boomTime);
      rumbleGain.gain.exponentialRampToValueAtTime(0.001, boomTime + 0.78);
      rumble.connect(rumbleLp);
      rumbleLp.connect(rumbleGain);
      rumbleGain.connect(panner);
      this.trackSource(rumble);
      rumble.start(boomTime, Math.random() * 0.7, 0.82);
    }
  }

  // ===========================================================================
  // 4. EMP SHOCKWAVE DETONATION (Seismic IMAX Bass Drop + EM Shockwave)
  // ===========================================================================
  public playDetonateEmp(screenXNorm: number, altitudeNorm: number): void {
    if (!this.ensureGraph() || !this.ctx || !this.ordnanceInput) return;
    const now = this.ctx.currentTime;
    const pan = this.panFromScreenX(screenXNorm);
    const clampedAlt = Math.max(0, Math.min(1, altitudeNorm));
    const boomTime = now + (0.042 + clampedAlt * 0.068);

    if (
      this.playDecodedSample(
        'flak_detonate_emp',
        boomTime,
        pan,
        1.18,
        0.96 + Math.random() * 0.06,
        'ordnance'
      )
    ) {
      return;
    }

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, boomTime);
    panner.connect(this.ordnanceInput);

    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(92, boomTime);
    sub.frequency.exponentialRampToValueAtTime(20, boomTime + 0.78);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.softClipCurve;
    const subGain = this.ctx.createGain();
    subGain.gain.setValueAtTime(0.92, boomTime);
    subGain.gain.exponentialRampToValueAtTime(0.001, boomTime + 1.0);
    sub.connect(shaper);
    shaper.connect(subGain);
    subGain.connect(panner);
    this.trackSource(sub);
    sub.start(boomTime);
    sub.stop(boomTime + 1.04);
  }

  // ===========================================================================
  // 5. BATTERY AUTOLOADER CHAMBER LOCK (Subtle, muted armored-bulkhead seating)
  // ===========================================================================
  public playBatteryReload(screenXNorm: number): void {
    if (!this.ensureGraph() || !this.ctx || !this.busInput) return;
    const now = this.ctx.currentTime;
    // Prevent overlapping reloads if both batteries finish on nearly the same beat
    if (now - this.lastReloadTime < 0.16) return;
    this.lastReloadTime = now;

    const pan = this.panFromScreenX(screenXNorm);
    const variant = this.pickLoadedVariant(
      ['battery_reload_clank', 'battery_reload_clank_02'],
      this.reloadCursor++
    );

    if (variant) {
      const buf = this.decodedBuffers.get(variant);
      if (buf) {
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.setValueAtTime(0.96 + Math.random() * 0.08, now);

        // Armored-bulkhead acoustic seat: clean low-mid mechanical presence that sits
        // naturally behind gunfire and explosions without harsh clang or sub clutter
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(95, now);

        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2400, now);
        lp.Q.setValueAtTime(0.65, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.22, now + 0.008);
        gain.gain.setValueAtTime(0.22, now + 0.36);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);

        const panner = this.ctx.createStereoPanner();
        panner.pan.setValueAtTime(pan, now);

        src.connect(hp);
        hp.connect(lp);
        lp.connect(gain);
        gain.connect(panner);
        panner.connect(this.busInput);

        const onset = this.bufferOnsets.get(variant) ?? 0;
        this.trackSource(src);
        src.start(now, onset, 0.6);
        return;
      }
    }

    // Subtle damped fallback thuck if MP3s are still decoding
    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);
    panner.connect(this.busInput);

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.045);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 620;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.09, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    osc.connect(lp);
    lp.connect(g);
    g.connect(panner);
    this.trackSource(osc);
    osc.start(now);
    osc.stop(now + 0.065);
  }

  // ===========================================================================
  // 6. CATASTROPHIC BUNKER / DOME DESTRUCTION + SEISMIC SUB + CONCUSSION DUCKING
  // ===========================================================================
  public playDomeBreach(screenXNorm: number): void {
    if (!this.ensureGraph() || !this.ctx || !this.preDuckInput || !this.concussionFilter) return;
    const now = this.ctx.currentTime;
    const pan = this.panFromScreenX(screenXNorm);

    // Master Impact Concussion Ducking (320Hz low-pass for 0.85s -> clean 20kHz recovery)
    const lpFreq = this.concussionFilter.frequency;
    lpFreq.cancelScheduledValues(now);
    lpFreq.setValueAtTime(Math.max(320, lpFreq.value), now);
    lpFreq.exponentialRampToValueAtTime(300, now + 0.025);
    lpFreq.setValueAtTime(300, now + 0.36);
    lpFreq.exponentialRampToValueAtTime(20000, now + 0.88);

    // Subtle 60Hz CRT Power-Sag Transformer Hum during structural blackout shock
    const sagOsc = this.ctx.createOscillator();
    sagOsc.type = 'sawtooth';
    sagOsc.frequency.setValueAtTime(60, now);
    sagOsc.frequency.linearRampToValueAtTime(53, now + 0.42);
    sagOsc.frequency.linearRampToValueAtTime(60, now + 0.92);
    const sagLp = this.ctx.createBiquadFilter();
    sagLp.type = 'lowpass';
    sagLp.frequency.value = 165;
    const sagGain = this.ctx.createGain();
    sagGain.gain.setValueAtTime(0.001, now);
    sagGain.gain.linearRampToValueAtTime(0.28, now + 0.04);
    sagGain.gain.exponentialRampToValueAtTime(0.001, now + 0.96);
    sagOsc.connect(sagLp);
    sagLp.connect(sagGain);
    sagGain.connect(this.preDuckInput);
    this.trackSource(sagOsc);
    sagOsc.start(now);
    sagOsc.stop(now + 1.0);

    // Play the full 5.5s realistic ElevenLabs subterranean bunker collapse purely (zero synth boom!)
    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);
    panner.connect(this.preDuckInput);

    const playedHd = this.playDecodedSample(
      'dome_breach_impact',
      now,
      pan,
      1.26,
      0.98 + Math.random() * 0.04,
      'preDuck'
    );

    // Grim distant muffled bunker distress pulse (~1.1s into collapse) using the loved dome_lock_alarm tone
    const alarmBuf = this.decodedBuffers.get('dome_lock_alarm');
    if (alarmBuf) {
      const distSrc = this.ctx.createBufferSource();
      distSrc.buffer = alarmBuf;
      distSrc.playbackRate.setValueAtTime(0.84, now + 1.05);
      const distLp = this.ctx.createBiquadFilter();
      distLp.type = 'lowpass';
      distLp.frequency.value = 1050;
      const distGain = this.ctx.createGain();
      distGain.gain.setValueAtTime(0.001, now + 1.05);
      distGain.gain.linearRampToValueAtTime(0.24, now + 1.18);
      distGain.gain.exponentialRampToValueAtTime(0.001, now + 2.55);
      distSrc.connect(distLp);
      distLp.connect(distGain);
      distGain.connect(panner);
      this.trackSource(distSrc);
      distSrc.start(now + 1.05, this.bufferOnsets.get('dome_lock_alarm') ?? 0);
    }

    if (playedHd) return;

    // Fallback subterranean rubble rumble if MP3s are still decoding
    if (this.brownNoiseBuffer) {
      const collapse = this.ctx.createBufferSource();
      collapse.buffer = this.brownNoiseBuffer;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(520, now);
      lp.frequency.exponentialRampToValueAtTime(68, now + 2.4);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.85, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 2.6);
      collapse.connect(lp);
      lp.connect(g);
      g.connect(panner);
      this.trackSource(collapse);
      collapse.start(now, 0, 2.7);
    }
  }

  // ===========================================================================
  // 7. ALARMS, WARNINGS & BATTLE-STATIONS KLAXONS (Movie-Quality Control Room!)
  // ===========================================================================
  public playWaveIncomingKlaxon(): void {
    if (!this.ensureGraph() || !this.ctx || !this.busInput) return;
    const now = this.ctx.currentTime;
    if (this.playDecodedSample('wave_incoming_klaxon', now, 0, 0.72, 1.0)) {
      return;
    }
    this.playRadarPing(0.5, 0.85, 0.42);
  }

  public playDomeLockAlarm(screenXNorm: number): void {
    if (!this.ensureGraph() || !this.ctx || !this.busInput) return;
    const now = this.ctx.currentTime;
    if (now - this.lastDomeLockAlarmTime < 3.4) return;
    this.lastDomeLockAlarmTime = now;
    const pan = this.panFromScreenX(screenXNorm);

    if (this.playDecodedSample('dome_lock_alarm', now, pan, 0.56, 1.0)) {
      return;
    }

    // Crisp fallback dual-beep collision alarm
    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);
    panner.connect(this.busInput);
    for (let k = 0; k < 2; k++) {
      const st = now + k * 0.16;
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(k === 0 ? 920 : 1180, st);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200;
      bp.Q.value = 2.4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.18, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.11);
      osc.connect(bp);
      bp.connect(g);
      g.connect(panner);
      this.trackSource(osc);
      osc.start(st);
      osc.stop(st + 0.12);
    }
  }

  public playMirvSplitWarning(screenXNorm: number): void {
    if (!this.ensureGraph() || !this.ctx || !this.busInput) return;
    const now = this.ctx.currentTime;
    if (now - this.lastMirvWarnTime < 1.8) return;
    this.lastMirvWarnTime = now;
    const pan = this.panFromScreenX(screenXNorm);

    if (this.playDecodedSample('mirv_split_warning', now, pan, 0.68, 1.0)) {
      return;
    }
    this.playRadarPing(screenXNorm, 1.5, 0.42);
  }

  // ===========================================================================
  // 8. SUBTLE 1979 MILITARY THREAT-ACQUISITION BLIP (Quieter & tastefully throttled!)
  // ===========================================================================
  public playRadarPing(screenXNorm: number, pitchScale = 1.0, volume = 0.22): void {
    if (!this.ensureGraph() || !this.ctx || !this.busInput) return;
    const now = this.ctx.currentTime;
    if (now - this.lastPingTime < 0.75) return;
    this.lastPingTime = now;
    const pan = this.panFromScreenX(screenXNorm);

    // Subtle, non-fatiguing volume so it adds immersion without ever annoying the player!
    const clampedPitch = Math.max(0.88, Math.min(1.06, pitchScale));
    if (this.playDecodedSample('radar_ping_lock', now, pan, volume * 0.56, clampedPitch)) {
      return;
    }

    // Dry muted dual-pulse analog cockpit radar threat blip (matches dome_lock_alarm aesthetic)
    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);
    panner.connect(this.busInput);
    for (let k = 0; k < 2; k++) {
      const st = now + k * 0.085;
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime((k === 0 ? 740 : 880) * clampedPitch, st);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 980;
      bp.Q.value = 3.0;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, st);
      gain.gain.linearRampToValueAtTime(volume * 0.45, st + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0005, st + 0.068);
      osc.connect(bp);
      bp.connect(gain);
      gain.connect(panner);
      this.trackSource(osc);
      osc.start(st);
      osc.stop(st + 0.075);
    }
  }

  // ===========================================================================
  // 9. HARMONIC COMBO LADDER (Crisp Analog Telemetry Confirmation Pulse — zero bells)
  // ===========================================================================
  public playHarmonicComboChime(
    chainMultiplier: number,
    isDangerClose: boolean,
    screenXNorm: number
  ): void {
    if (!this.ensureGraph() || !this.ctx || !this.preDuckInput) return;
    const now = this.ctx.currentTime;
    if (now - this.lastComboTime < 0.055) return;
    this.lastComboTime = now;

    // Warm lower-mid analog oscilloscope ladder (C4..G5) — crisp tactical lock, zero Christmas bell!
    const ladder = [329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];
    const stepIdx =
      chainMultiplier >= 16
        ? 7
        : chainMultiplier >= 12
          ? 6
          : chainMultiplier >= 8
            ? 5
            : chainMultiplier >= 6
              ? 4
              : chainMultiplier >= 4
                ? 3
                : chainMultiplier >= 3
                  ? 2
                  : chainMultiplier >= 2
                    ? 1
                    : 0;
    const rootHz = ladder[Math.min(ladder.length - 1, stepIdx + (isDangerClose ? 1 : 0))];
    const pan = this.panFromScreenX(screenXNorm);

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);
    panner.connect(this.preDuckInput);

    const notes = isDangerClose ? [rootHz, rootHz * 1.25] : [rootHz];
    notes.forEach((freq, idx) => {
      const start = now + idx * 0.05;
      const osc = this.ctx!.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, start);

      const bp = this.ctx!.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq * 1.45;
      bp.Q.value = 2.8;

      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.001, start);
      g.gain.linearRampToValueAtTime(0.34, start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0008, start + 0.24);

      osc.connect(bp);
      bp.connect(g);
      g.connect(panner);

      this.trackSource(osc);
      osc.start(start);
      osc.stop(start + 0.24);
    });
  }

  // ===========================================================================
  // 10. HEAVY METEOR PHYSICAL SHOCKWAVE DEFLECTION CRUNCH / RICOCHET
  // ===========================================================================
  public playDeflectionClank(screenXNorm: number, isCollisionKill = false): void {
    if (!this.ensureGraph() || !this.ctx || !this.busInput) return;
    const now = this.ctx.currentTime;
    if (now - this.lastDeflectTime < 0.06) return;
    this.lastDeflectTime = now;
    const pan = this.panFromScreenX(screenXNorm);

    if (
      this.playDecodedSample(
        'meteor_deflect_impact',
        now,
        pan,
        isCollisionKill ? 1.12 : 0.88,
        isCollisionKill ? 1.08 : 0.94 + Math.random() * 0.1
      )
    ) {
      return;
    }

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);
    panner.connect(this.busInput);

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isCollisionKill ? 680 : 390, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.18);
    const g1 = this.ctx.createGain();
    g1.gain.setValueAtTime(0.42, now);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(g1);
    g1.connect(panner);
    this.trackSource(osc);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  // ===========================================================================
  // 11. END-OF-WAVE AUDIT TALLY CLICK & ORBITAL DROP-POD DOME RESTORE
  // ===========================================================================
  public playTallyClick(stepIndex: number): void {
    if (!this.ensureGraph() || !this.ctx || !this.busInput) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    const pitch = 740 + Math.min(10, stepIndex) * 58;
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.65, now + 0.032);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1900;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.044);

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(this.busInput);
    this.trackSource(osc);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  public playDropPodRestore(screenXNorm: number): void {
    if (!this.ensureGraph() || !this.ctx || !this.busInput) return;
    const now = this.ctx.currentTime;
    const pan = this.panFromScreenX(screenXNorm);

    if (this.playDecodedSample('orbital_droppod_restore', now, pan, 0.92, 1.0)) {
      return;
    }

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);
    panner.connect(this.busInput);
    const chord = [440, 554.37, 659.25, 880];
    chord.forEach((f, idx) => {
      const st = now + idx * 0.07;
      const osc = this.ctx!.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, st);
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.001, st);
      g.gain.linearRampToValueAtTime(0.2, st + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0008, st + 0.55);
      osc.connect(g);
      g.connect(panner);
      this.trackSource(osc);
      osc.start(st);
      osc.stop(st + 0.58);
    });
  }

  // ===========================================================================
  // 12. REAL-TIME ION STORM JAMMER INTERFERENCE LOOP & DOPPLER SHRIEK POOL
  // ===========================================================================
  public updateContinuousBeds(
    threats: readonly OrbitalThreat[],
    active: boolean,
    dt: number
  ): void {
    this.updateDopplerStreaks(threats, active, dt);
    this.updateJammerLoop(threats, active, dt);
  }

  private updateJammerLoop(
    threats: readonly OrbitalThreat[],
    active: boolean,
    dt: number
  ): void {
    if (!this.mounted || !this.ctx || !this.jammerGain || !this.jammerPanner) return;
    const smoothK = 1 - Math.exp(-Math.max(0.001, Math.min(0.1, dt)) * 8);
    const now = this.ctx.currentTime;

    const jammers = active ? threats.filter((t) => t.kind === 'ION_JAMMER') : [];
    if (jammers.length === 0) {
      this.curJammerGain += (0 - this.curJammerGain) * smoothK;
      this.jammerGain.gain.setTargetAtTime(
        this.curJammerGain < 0.001 ? 0 : this.curJammerGain,
        now,
        0.05
      );
      return;
    }

    // Track weighted average pan & peak intensity of active Ion Storm Jammers
    let panSum = 0;
    let lowestY = 0;
    for (const j of jammers) {
      panSum += this.panFromScreenX(j.x / FLAK_CONSTANTS.VIRTUAL_W);
      if (j.y > lowestY) lowestY = j.y;
    }
    const targetPan = panSum / jammers.length;
    const proximity = Math.max(0.2, Math.min(1, lowestY / Math.max(1, FLAK_CONSTANTS.HORIZON_Y)));
    const targetGain = Math.min(0.42, (0.18 + proximity * 0.16) * Math.min(1.4, 0.8 + jammers.length * 0.25));

    this.curJammerPan += (targetPan - this.curJammerPan) * smoothK;
    this.curJammerGain += (targetGain - this.curJammerGain) * smoothK;

    this.jammerPanner.pan.setTargetAtTime(this.curJammerPan, now, 0.05);
    this.jammerGain.gain.setTargetAtTime(this.curJammerGain, now, 0.05);
  }

  public updateDopplerStreaks(
    threats: readonly OrbitalThreat[],
    active: boolean,
    dt: number
  ): void {
    if (!this.mounted || !this.ctx || this.dopplerVoices.length === 0) return;

    const smoothK = 1 - Math.exp(-Math.max(0.001, Math.min(0.1, dt)) * 12);
    const now = this.ctx.currentTime;

    if (!active) {
      for (const v of this.dopplerVoices) {
        v.curGain += (0 - v.curGain) * smoothK;
        const val = v.curGain < 0.0005 ? 0 : v.curGain;
        v.gain.gain.setTargetAtTime(val, now, 0.03);
      }
      return;
    }

    const candidates = threats
      .filter((t) => t.kind === 'KINETIC_ROD' && t.y > 140 && t.vy > 75)
      .sort((a, b) => b.y + b.vy * 1.4 - (a.y + a.vy * 1.4))
      .slice(0, this.dopplerVoices.length);

    for (let i = 0; i < this.dopplerVoices.length; i++) {
      const v = this.dopplerVoices[i];
      const threat = candidates[i];
      if (!threat) {
        v.curGain += (0 - v.curGain) * smoothK;
        v.gain.gain.setTargetAtTime(v.curGain < 0.0005 ? 0 : v.curGain, now, 0.03);
        continue;
      }

      const altProgress = Math.max(
        0,
        Math.min(1, threat.y / Math.max(1, FLAK_CONSTANTS.HORIZON_Y))
      );
      const speedNorm = Math.max(0, Math.min(1, (threat.vy - 70) / 210));
      const targetFreq = 1720 - altProgress * 1240 + speedNorm * 140;
      const targetPan = this.panFromScreenX(threat.x / FLAK_CONSTANTS.VIRTUAL_W);
      const targetGain = (0.015 + Math.pow(altProgress, 1.5) * 0.042) * (0.5 + 0.5 * speedNorm);

      v.curFreq += (targetFreq - v.curFreq) * smoothK;
      v.curPan += (targetPan - v.curPan) * smoothK;
      v.curGain += (targetGain - v.curGain) * smoothK;

      v.osc.frequency.setTargetAtTime(v.curFreq, now, 0.025);
      v.subOsc.frequency.setTargetAtTime(v.curFreq * 0.5, now, 0.025);
      v.bp.frequency.setTargetAtTime(v.curFreq * 1.12, now, 0.025);
      v.panner.pan.setTargetAtTime(v.curPan, now, 0.025);
      v.gain.gain.setTargetAtTime(v.curGain, now, 0.025);
    }
  }

  // ===========================================================================
  // 11. EVERY-5-WAVES ORBITAL SIEGE DREADNOUGHT BOSS SFX (Unique ElevenLabs Cinema Audio!)
  // ===========================================================================
  public playBossArrival(screenXNorm = 0.5): void {
    if (!this.ensureGraph() || !this.ctx || !this.preDuckInput) return;
    const now = this.ctx.currentTime;
    const pan = this.panFromScreenX(screenXNorm);
    if (this.playDecodedSample('boss_arrival_horn', now, pan, 1.08, 1.0, 'preDuck')) {
      return;
    }
    // Deep cinematic horn fallback
    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);
    panner.connect(this.preDuckInput);
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(64, now);
    osc.frequency.linearRampToValueAtTime(52, now + 2.4);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(240, now);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.45, now + 0.35);
    g.gain.exponentialRampToValueAtTime(0.001, now + 2.6);
    osc.connect(lp);
    lp.connect(g);
    g.connect(panner);
    this.trackSource(osc);
    osc.start(now);
    osc.stop(now + 2.65);
  }

  public playBossSalvo(screenXNorm: number): void {
    if (!this.ensureGraph() || !this.ctx || !this.ordnanceInput) return;
    const now = this.ctx.currentTime;
    const pan = this.panFromScreenX(screenXNorm);
    if (
      this.playDecodedSample(
        'boss_salvo_fire',
        now,
        pan,
        0.96,
        0.95 + Math.random() * 0.1,
        'ordnance'
      )
    ) {
      return;
    }
    this.playLaunchEmp(screenXNorm);
  }

  public playBossHullHit(screenXNorm: number, hardpointDestroyed: boolean): void {
    if (!this.ensureGraph() || !this.ctx || !this.ordnanceInput) return;
    const now = this.ctx.currentTime;
    const pan = this.panFromScreenX(screenXNorm);
    const vol = hardpointDestroyed ? 1.15 : 0.84;
    const pitch = hardpointDestroyed ? 0.92 : 0.96 + Math.random() * 0.12;
    if (this.playDecodedSample('boss_hull_hit', now, pan, vol, pitch, 'ordnance')) {
      return;
    }
    this.playDeflectionClank(screenXNorm, hardpointDestroyed);
  }

  public playBossDestroyed(screenXNorm: number): void {
    if (!this.ensureGraph() || !this.ctx || !this.preDuckInput) return;
    const now = this.ctx.currentTime;
    const pan = this.panFromScreenX(screenXNorm);
    if (this.playDecodedSample('boss_destroyed', now, pan, 1.24, 1.0, 'preDuck')) {
      return;
    }
    this.playDetonateEmp(screenXNorm, 0.75);
  }
}
