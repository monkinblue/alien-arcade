import type { SfxId, VoiceCalloutId } from '../types';

export type XenomorphScreechContext = 'SWARM' | 'HIT' | 'DEATH' | 'BURNING' | 'DOOR_CLAW';
export type XenomorphScreechSpecies =
  | 'SKITTERER'
  | 'DRONE'
  | 'PRAETORIAN'
  | 'BURSTER'
  | 'STALKER'
  | 'SPITTER'
  | 'SCREAMER'
  | 'CRUSHER'
  | 'QUEEN';

export type PerimeterVoiceId =
  | 'grate_breach'
  | 'sentry_dry'
  | 'door_failing'
  | 'overload'
  | 'queen'
  | 'protocol';

interface ManifestFileEntry {
  path: string;
  category: 'loop' | 'sfx' | 'voice';
  bytes: number;
}

interface AudioManifestData {
  version: number;
  generatedAt: string | null;
  voiceId: string | null;
  assets: Record<string, ManifestFileEntry>;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array<ArrayBuffer> | null = null;

  private intercomInput: GainNode | null = null;
  // Dedicated warm dampened ASMR keyboard bus (rolls off harsh highs, boosts 210Hz thock body)
  private asmrKeyBus: GainNode | null = null;

  // Dedicated "Heavy Machine Gun in Adjacent Metallic Hallway Through Bulkhead" Acoustic Bus
  private sentryDirectWallInput: GainNode | null = null;
  private sentryWarehouseWetInput: GainNode | null = null;
  private sentryRollingTailBus: GainNode | null = null;
  // Cancel-and-replace last-shot rolling echo wave (fires ONLY once when a burst stops!)
  private activeSentryTail: {
    src: AudioBufferSourceNode;
    gain: GainNode;
    startTime: number;
    rampEndTime: number;
    peakGain: number;
  } | null = null;
  private sentryLastScheduledShotTime = 0;
  private sentryRollingTailBuffers: AudioBuffer[] = [];
  private sentryRollingTailCursor = 0;
  private sentryRoundBuffers: AudioBuffer[] = [];
  private sentryRoundCursor = 0;

  // Whisper-quiet, deeply muffled M240 Napalm / Flamethrower Bulkhead Bus + Continuous Burn Bed
  private napalmBulkheadInput: GainNode | null = null;
  private napalmLoopSource: AudioBufferSourceNode | null = null;
  private napalmLoopPanner: StereoPannerNode | null = null;
  private napalmLoopGain: GainNode | null = null;
  private curNapalmGain = 0;
  private curNapalmPan = 0;

  // Dynamic Colony Reactor Core Hum & High-Load Electrical Strain Bed (Hadley's Perimeter 2.0)
  private reactorLoopSource: AudioBufferSourceNode | null = null;
  private reactorFilter: BiquadFilterNode | null = null;
  private reactorGain: GainNode | null = null;
  private reactorStrainOsc: OscillatorNode | null = null;
  private reactorStrainGain: GainNode | null = null;
  private curReactorGain = 0;
  private curReactorCutoff = 260;
  private curReactorRate = 0.94;
  private curReactorStrain = 0;
  private lastPerimVoiceById = new Map<string, number>();
  private lastShatterTime = 0;
  private lastShockCoilTime = 0;
  private lastSteamTime = 0;

  // Non-repeating 1986 Aliens Xenomorph Screech Shuffle-Bag & Polyphony Governor
  private recentScreechIds: string[] = [];
  private activeScreechEndTimes: number[] = [];
  private lastScreechTime = 0;

  // Continuous DSP loop nodes (Dual-Layer Muted Flame Rumble + RCS + Space Ambience + Wind)
  private mainThrusterSource: AudioBufferSourceNode | null = null;
  private synthFlameRumbleSource: AudioBufferSourceNode | null = null;
  private mainThrusterFilter: BiquadFilterNode | null = null;
  private mainThrusterPostLp: BiquadFilterNode | null = null;
  private mainThrusterGain: GainNode | null = null;

  // Smoothed per-frame DSP state (prevents Web Audio setTargetAtTime automation queue lockup)
  private curMainFlameGain = 0;
  private curMainFlameCutoff = 340;
  private curMainFlameRate = 0.86;
  private curRcsGain = 0;
  private curRcsPan = 0;
  private curWindGain = 0;
  private curWindFreq = 450;
  private curEerieGain = 0.11;
  private curSpaceGain = 0.15;

  private rcsThrusterSource: AudioBufferSourceNode | null = null;
  private rcsPanner: StereoPannerNode | null = null;
  private rcsFilter: BiquadFilterNode | null = null;
  private rcsGain: GainNode | null = null;

  private eerieAmbienceSource: AudioBufferSourceNode | null = null;
  private eerieAmbienceFilter: BiquadFilterNode | null = null;
  private eerieAmbienceGain: GainNode | null = null;
  private deepSpaceBusGain: GainNode | null = null;

  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  private buffers = new Map<string, AudioBuffer>();
  private decodedRealAssets = new Set<string>();
  private bufferOnsets = new Map<string, number>();
  private rawPrefetched = new Map<string, { data: ArrayBuffer; category: 'loop' | 'sfx' | 'voice' }>();
  private bootStartPromise: Promise<void> | null = null;
  private prefetchPromise: Promise<void> | null = null;
  private decodePromise: Promise<void> | null = null;
  private bootStartupSource: AudioBufferSourceNode | null = null;
  private bootStartupGain: GainNode | null = null;

  private muted = false;
  private unlocked = false;
  private activeVoiceSource: AudioBufferSourceNode | null = null;
  private lastVoiceTime = 0;
  private lastKlaxonTime = 0;
  private lastKeyclickTime = 0;
  private keyAltToggle = false;

  // Throttles for rapid tactical sentry & perimeter SFX so polyphony stays clean & punchy
  private lastPulseBurstTime = 0;
  private lastAmmoTickTime = 0;
  private lastDryFireTime = 0;
  private lastIncineratorTime = 0;
  private lastCryoHissTime = 0;
  private lastRicochetTime = 0;
  private lastAcidSizzleTime = 0;
  private lastDoorThudTime = 0;
  private lastServoWhirTime = 0;
  private lastLowAmmoChimeTime = 0;

  constructor() {
    this.bootStartPromise = this.prefetchBootStartAudio();
    this.prefetchPromise = this.prefetchManifestAndMp3s();
  }

  private async prefetchBootStartAudio(): Promise<void> {
    try {
      const base = import.meta.env.BASE_URL || './';
      const prefix = base === '/' ? '.' : base.replace(/\/$/, '');
      const res = await fetch(`${prefix}/audio/homeade_computer_start.m4a`);
      if (!res.ok) return;
      const arr = await res.arrayBuffer();
      if (arr.byteLength > 512) {
        this.rawPrefetched.set('homeade_computer_start', { data: arr, category: 'sfx' });
      }
    } catch {
      // Fallback handled gracefully if offline
    }
  }

  private async ensureBootStartDecoded(): Promise<void> {
    if (!this.ctx || this.decodedRealAssets.has('homeade_computer_start')) return;
    if (this.bootStartPromise) {
      await this.bootStartPromise;
    }
    const item = this.rawPrefetched.get('homeade_computer_start');
    if (!item || !this.ctx || this.decodedRealAssets.has('homeade_computer_start')) return;
    try {
      const copy = item.data.slice(0);
      const decoded = await this.ctx.decodeAudioData(copy);
      this.decodedRealAssets.add('homeade_computer_start');
      this.buffers.set('homeade_computer_start', decoded);
      this.bufferOnsets.set('homeade_computer_start', 0);
    } catch {
      // Fallback if browser codec fails
    }
  }

  private async prefetchManifestAndMp3s(): Promise<void> {
    try {
      const base = import.meta.env.BASE_URL || './';
      const prefix = base === '/' ? '.' : base.replace(/\/$/, '');
      const manifestUrl = `${prefix}/audio/manifest.json`;
      const res = await fetch(manifestUrl, { cache: 'no-cache' });
      if (!res.ok) return;
      const data = (await res.json()) as Partial<AudioManifestData>;
      if (!data || typeof data.assets !== 'object' || data.assets === null) return;

      const entries = Object.entries(data.assets).filter(
        ([id]) => id !== 'ambient_crt_buzz' && id !== 'homeade_computer_start'
      );
      await Promise.all(
        entries.map(async ([id, meta]) => {
          try {
            const assetUrl = `${prefix}${meta.path}`;
            const mp3Res = await fetch(assetUrl);
            if (!mp3Res.ok) return;
            const arr = await mp3Res.arrayBuffer();
            if (arr.byteLength > 512) {
              this.rawPrefetched.set(id, { data: arr, category: meta.category });
            }
          } catch {
            // Individual asset fallback to synth if unreachable
          }
        })
      );

      if (this.ctx) {
        await this.decodePrefetchedBuffers();
      }
    } catch {
      // Silent fallback to procedural synthesis if offline
    }
  }

  /**
   * Finds exact transient onset timestamp inside an AudioBuffer so rapid ASMR
   * scrolling text clacks have zero leading silence lag.
   */
  private detectTransientOnsetSec(buf: AudioBuffer): number {
    const ch = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
    const thresh = Math.max(0.02, peak * 0.16);
    for (let i = 0; i < ch.length; i++) {
      if (Math.abs(ch[i]) >= thresh) {
        return Math.max(0, i / buf.sampleRate - 0.003);
      }
    }
    return 0;
  }

  /**
   * Trims MP3 encoder boundary padding and builds a mathematically continuous
   * overlap-cut loop (where sample L-1 transitions directly into sample L at wrap-around)
   * so looped ambience/thruster/wind tracks NEVER exhibit periodic clicks or reset seams!
   */
  private createSeamlessOverlapLoop(srcBuf: AudioBuffer, crossfadeSec = 1.1): AudioBuffer {
    if (!this.ctx) return srcBuf;
    const sr = srcBuf.sampleRate;
    const trim = Math.min(Math.floor(sr * 0.055), Math.floor(srcBuf.length * 0.05));
    const trimmedLen = srcBuf.length - trim * 2;
    if (trimmedLen < sr * 1.2) return srcBuf;

    const fadeSamples = Math.min(Math.floor(sr * crossfadeSec), Math.floor(trimmedLen * 0.24));
    const outLen = trimmedLen - fadeSamples;
    const outBuf = this.ctx.createBuffer(srcBuf.numberOfChannels, outLen, sr);

    for (let ch = 0; ch < srcBuf.numberOfChannels; ch++) {
      const src = srcBuf.getChannelData(ch);
      const dst = outBuf.getChannelData(ch);
      for (let i = 0; i < fadeSamples; i++) {
        const theta = (i / fadeSamples) * (Math.PI * 0.5);
        const wHead = Math.sin(theta);
        const wTail = Math.cos(theta);
        dst[i] = src[trim + i] * wHead + src[trim + outLen + i] * wTail;
      }
      for (let i = fadeSamples; i < outLen; i++) {
        dst[i] = src[trim + i];
      }
    }
    return outBuf;
  }

  private normalizeAudioBufferPeak(buf: AudioBuffer, targetPeak: number): void {
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

  private async decodePrefetchedBuffers(): Promise<void> {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const pending = Array.from(this.rawPrefetched.entries()).filter(
      ([id]) => id !== 'ambient_crt_buzz' && !this.decodedRealAssets.has(id)
    );
    if (pending.length === 0) return;

    await Promise.all(
      pending.map(async ([id, item]) => {
        try {
          const copy = item.data.slice(0);
          const rawDecoded = await ctx.decodeAudioData(copy);
          const finalBuf =
            item.category === 'loop'
              ? this.createSeamlessOverlapLoop(
                  rawDecoded,
                  id === 'alien_eerie_ambience' ? 1.6 : 0.65
                )
              : rawDecoded;

          if (id === 'sentry_rearm_belt') {
            this.normalizeAudioBufferPeak(finalBuf, 0.95);
          } else if (
            id === 'core_breach_alert' ||
            id === 'perim_queen_roar' ||
            id === 'perim_breaker_blackout' ||
            id === 'perim_airlock_purge' ||
            id === 'perim_rail_lance' ||
            id === 'perim_claymore_blast'
          ) {
            this.normalizeAudioBufferPeak(finalBuf, 0.92);
          } else if (id.startsWith('perim_voice_')) {
            this.normalizeAudioBufferPeak(finalBuf, 0.9);
          } else if (id.startsWith('perim_')) {
            this.normalizeAudioBufferPeak(finalBuf, 0.84);
          } else if (
            id.startsWith('alien_screech_') ||
            id === 'incinerator_whoosh' ||
            id === 'napalm_burn_loop' ||
            id === 'sentry_deploy_tripod' ||
            id === 'hardware_deploy_mount'
          ) {
            this.normalizeAudioBufferPeak(finalBuf, 0.72);
          }

          this.decodedRealAssets.add(id);
          this.buffers.set(id, finalBuf);
          if (item.category === 'sfx') {
            this.bufferOnsets.set(id, this.detectTransientOnsetSec(finalBuf));
          }
          if (item.category === 'loop') {
            this.restartLoopSource(id);
          }
        } catch {
          // Keep procedural fallback only if decoding fails
        }
      })
    );
  }

  public isUnlocked(): boolean {
    return this.unlocked;
  }

  public getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  public getMasterOutputNode(): GainNode | null {
    return this.masterGain;
  }

  public async unlock(): Promise<void> {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.setupGraph();
      this.buildProceduralLoopFallbacks();
      this.startContinuousLoops();
    }

    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // Will retry on next user gesture
      }
    }
    this.unlocked = this.ctx.state === 'running';

    // Immediately decode homeade_computer_start.m4a so CRT tube ignition plays with zero lag,
    // while decoding the remaining 35 assets in the background!
    await this.ensureBootStartDecoded();

    if (!this.decodePromise) {
      this.decodePromise = (async () => {
        if (this.prefetchPromise) {
          await this.prefetchPromise;
        }
        await this.decodePrefetchedBuffers();
      })();
    }
  }

  private setupGraph(): void {
    const ctx = this.ctx!;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.88;

    // Transparent slow-envelope safety ceiling (-1.5 dBFS, 6ms attack so it never rides
    // bass cycles into audio-rate static fuzz, while preventing any 0 dBFS DAC clip)
    const masterLimiter = ctx.createDynamicsCompressor();
    masterLimiter.threshold.value = -1.5;
    masterLimiter.knee.value = 4.0;
    masterLimiter.ratio.value = 12;
    masterLimiter.attack.value = 0.006;
    masterLimiter.release.value = 0.16;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 64;
    this.analyserData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

    this.masterGain.connect(masterLimiter);
    masterLimiter.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // 1. Dedicated ASMR Dull Muted Keyboard Bus:
    // Warm low-mid body boost (205Hz) + gentle muffled lowpass (1080Hz) to strip all tinny clickiness
    this.asmrKeyBus = ctx.createGain();
    this.asmrKeyBus.gain.value = 1.0;

    const thockBody = ctx.createBiquadFilter();
    thockBody.type = 'peaking';
    thockBody.frequency.value = 205;
    thockBody.Q.value = 1.1;
    thockBody.gain.value = 5.2;

    const dullLowpass = ctx.createBiquadFilter();
    dullLowpass.type = 'lowpass';
    dullLowpass.frequency.value = 1080;
    dullLowpass.Q.value = 0.65;

    this.asmrKeyBus.connect(thockBody);
    thockBody.connect(dullLowpass);
    dullLowpass.connect(this.masterGain);

    // 2. Authentic 1979 Nostromo Shipboard Intercom Chain (350Hz–3400Hz + soft-clip WaveShaper)
    this.intercomInput = ctx.createGain();
    this.intercomInput.gain.value = 1.0;

    const hp350 = ctx.createBiquadFilter();
    hp350.type = 'highpass';
    hp350.frequency.value = 350;
    hp350.Q.value = 0.85;

    const lp3400 = ctx.createBiquadFilter();
    lp3400.type = 'lowpass';
    lp3400.frequency.value = 3400;
    lp3400.Q.value = 0.9;

    const presencePeak = ctx.createBiquadFilter();
    presencePeak.type = 'peaking';
    presencePeak.frequency.value = 1650;
    presencePeak.Q.value = 1.35;
    presencePeak.gain.value = 3.2;

    const shaper = ctx.createWaveShaper();
    shaper.curve = this.createSoftClipCurve(2.0);
    shaper.oversample = '2x';

    const intercomOut = ctx.createGain();
    intercomOut.gain.value = 0.92;

    this.intercomInput.connect(hp350);
    hp350.connect(lp3400);
    lp3400.connect(presencePeak);
    presencePeak.connect(shaper);
    shaper.connect(intercomOut);
    intercomOut.connect(this.masterGain);

    // 3. Dedicated "Loud Heavy Machine Gun in Adjacent Metallic Warehouse" Acoustic Chain
    // Models 1986 Aliens UA 571-C sentry fire booming inside a steel warehouse in the next room!
    this.setupSentryWarehouseAcoustics();
  }

  /**
   * Builds a Studio-Headroom, Static-Free "Adjacent Metallic Hallway + Last-Shot Rolling Echo" Bus:
   * - Path A (Linear Bulkhead Wall Transmission): 42Hz infrasonic cut + 92Hz chest punch + 310Hz/660Hz
   *   bulkhead body + steep 36dB/oct (3-stage) 1180Hz/1520Hz/1980Hz wall lowpass so zero top-end static leaks.
   * - Path B (True L2-Normalized 0dB Tight Hallway Convolver — 0.58s IR): Unit-energy normalized
   *   convolution (eliminating +21dB RMS-normalization overdrive) for tight hallway reflections.
   * - Rolling Tail Bus (Cancel-and-Replace Last-Shot Echo): Plays a transient-free 4.5s stereo
   *   multi-swell rolling tunnel echo wave ONLY after the final round of a burst stops firing!
   */
  private setupSentryWarehouseAcoustics(): void {
    const ctx = this.ctx!;
    if (!this.masterGain) return;

    this.sentryDirectWallInput = ctx.createGain();
    this.sentryDirectWallInput.gain.value = 1.0;

    this.sentryWarehouseWetInput = ctx.createGain();
    this.sentryWarehouseWetInput.gain.value = 1.0;

    this.sentryRollingTailBus = ctx.createGain();
    this.sentryRollingTailBus.gain.value = 1.0;

    // Slow-attack optical-style bus glue (22ms attack NEVER modulates 50–120Hz bass cycles into fuzz!)
    const busComp = ctx.createDynamicsCompressor();
    busComp.threshold.value = -11;
    busComp.knee.value = 12;
    busComp.ratio.value = 2.2;
    busComp.attack.value = 0.022;
    busComp.release.value = 0.22;

    // Dedicated post-compressor bulkhead lowpass strips 100% of any high-frequency static
    const postBusWallLp = ctx.createBiquadFilter();
    postBusWallLp.type = 'lowpass';
    postBusWallLp.frequency.value = 1360;
    postBusWallLp.Q.value = 0.6;

    const busOut = ctx.createGain();
    busOut.gain.value = 0.88;
    busComp.connect(postBusWallLp);
    postBusWallLp.connect(busOut);
    busOut.connect(this.masterGain);

    // --- PATH A: Clean Linear Through-Bulkhead Structural Punch ---
    const wallHp = ctx.createBiquadFilter();
    wallHp.type = 'highpass';
    wallHp.frequency.value = 42;
    wallHp.Q.value = 0.65;

    const wallSubPunch = ctx.createBiquadFilter();
    wallSubPunch.type = 'peaking';
    wallSubPunch.frequency.value = 92;
    wallSubPunch.Q.value = 0.85;
    wallSubPunch.gain.value = 3.0;

    const wallBoxRes = ctx.createBiquadFilter();
    wallBoxRes.type = 'peaking';
    wallBoxRes.frequency.value = 310;
    wallBoxRes.Q.value = 0.9;
    wallBoxRes.gain.value = 2.6;

    const wallMidBark = ctx.createBiquadFilter();
    wallMidBark.type = 'peaking';
    wallMidBark.frequency.value = 660;
    wallMidBark.Q.value = 1.1;
    wallMidBark.gain.value = 1.5;

    // 36 dB/oct steep steel-bulkhead lowpass eliminates all top-end fizz/static during rumble
    const wallLp1 = ctx.createBiquadFilter();
    wallLp1.type = 'lowpass';
    wallLp1.frequency.value = 1180;
    wallLp1.Q.value = 0.65;

    const wallLp2 = ctx.createBiquadFilter();
    wallLp2.type = 'lowpass';
    wallLp2.frequency.value = 1520;
    wallLp2.Q.value = 0.6;

    const wallLp3 = ctx.createBiquadFilter();
    wallLp3.type = 'lowpass';
    wallLp3.frequency.value = 1980;
    wallLp3.Q.value = 0.55;

    const directOut = ctx.createGain();
    directOut.gain.value = 0.68;

    this.sentryDirectWallInput.connect(wallHp);
    wallHp.connect(wallSubPunch);
    wallSubPunch.connect(wallBoxRes);
    wallBoxRes.connect(wallMidBark);
    wallMidBark.connect(wallLp1);
    wallLp1.connect(wallLp2);
    wallLp2.connect(wallLp3);
    wallLp3.connect(directOut);
    directOut.connect(busComp);

    // --- PATH B: True Unit-Energy (0 dB L2) Tight Hallway Convolution Reverb ---
    const convolver = ctx.createConvolver();
    convolver.normalize = false;
    convolver.buffer = this.buildMetallicWarehouseIr(ctx);

    const whHp = ctx.createBiquadFilter();
    whHp.type = 'highpass';
    whHp.frequency.value = 135;
    whHp.Q.value = 0.7;

    const whHallBody = ctx.createBiquadFilter();
    whHallBody.type = 'peaking';
    whHallBody.frequency.value = 480;
    whHallBody.Q.value = 1.0;
    whHallBody.gain.value = 2.4;

    const whLp1 = ctx.createBiquadFilter();
    whLp1.type = 'lowpass';
    whLp1.frequency.value = 1150;
    whLp1.Q.value = 0.65;

    const whLp2 = ctx.createBiquadFilter();
    whLp2.type = 'lowpass';
    whLp2.frequency.value = 1500;
    whLp2.Q.value = 0.6;

    const wetOut = ctx.createGain();
    wetOut.gain.value = 0.56;

    this.sentryWarehouseWetInput.connect(convolver);
    convolver.connect(whHp);
    whHp.connect(whHallBody);
    whHallBody.connect(whLp1);
    whLp1.connect(whLp2);
    whLp2.connect(wetOut);
    wetOut.connect(busComp);

    // --- PATH C: Dedicated Clean Linear Bus for Last-Shot Rolling Echo Waves ---
    const tailLp1 = ctx.createBiquadFilter();
    tailLp1.type = 'lowpass';
    tailLp1.frequency.value = 1120;
    tailLp1.Q.value = 0.62;

    const tailLp2 = ctx.createBiquadFilter();
    tailLp2.type = 'lowpass';
    tailLp2.frequency.value = 1550;
    tailLp2.Q.value = 0.58;

    this.sentryRollingTailBus.connect(tailLp1);
    tailLp1.connect(tailLp2);
    tailLp2.connect(busOut);

    // --- PATH D: Whisper-Subtle, Deeply Muffled M240 Napalm / Flamethrower Bulkhead Bus ---
    // 36 dB/oct steep 420Hz/640Hz/920Hz bulkhead wall muffling + warm 130Hz liquid-fuel bloom
    // so napalm sounds barely audible, velvety, and sealed behind heavy steel corridor walls.
    this.napalmBulkheadInput = ctx.createGain();
    this.napalmBulkheadInput.gain.value = 1.0;

    const napHp = ctx.createBiquadFilter();
    napHp.type = 'highpass';
    napHp.frequency.value = 46;
    napHp.Q.value = 0.65;

    const napWarmth = ctx.createBiquadFilter();
    napWarmth.type = 'peaking';
    napWarmth.frequency.value = 132;
    napWarmth.Q.value = 0.85;
    napWarmth.gain.value = 2.8;

    const napLp1 = ctx.createBiquadFilter();
    napLp1.type = 'lowpass';
    napLp1.frequency.value = 420;
    napLp1.Q.value = 0.65;

    const napLp2 = ctx.createBiquadFilter();
    napLp2.type = 'lowpass';
    napLp2.frequency.value = 640;
    napLp2.Q.value = 0.6;

    const napLp3 = ctx.createBiquadFilter();
    napLp3.type = 'lowpass';
    napLp3.frequency.value = 920;
    napLp3.Q.value = 0.55;

    const napHallwaySend = ctx.createGain();
    napHallwaySend.gain.value = 0.24;

    this.napalmBulkheadInput.connect(napHp);
    napHp.connect(napWarmth);
    napWarmth.connect(napLp1);
    napLp1.connect(napLp2);
    napLp2.connect(napLp3);
    napLp3.connect(this.masterGain);
    napLp3.connect(napHallwaySend);
    napHallwaySend.connect(this.sentryWarehouseWetInput);

    // Pre-synthesize 8 clean ballistic round buffers + 3 stereo 4.5s rolling corridor echo tails!
    this.sentryRoundBuffers = this.buildHeavyMachineGunRoundVariations(ctx, 8);
    this.sentryRollingTailBuffers = this.buildRollingCorridorTailBuffers(ctx, 3);
  }

  /**
   * Synthesizes a tight stereo 0.58s "Enclosed Metallic Colony Hallway" Impulse Response
   * normalized by TRUE L2 UNIT ENERGY (sum of squares = 1.0, 0 dB gain) so convolution
   * never overdrives or adds high-frequency static during sustained gunfire.
   */
  private buildMetallicWarehouseIr(ctx: AudioContext): AudioBuffer {
    const sr = ctx.sampleRate;
    const durSec = 0.58;
    const len = Math.floor(sr * durSec);
    const ir = ctx.createBuffer(2, len, sr);
    const chL = ir.getChannelData(0);
    const chR = ir.getChannelData(1);

    let seed = 20370571;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    // 1. Smooth Narrow-Hallway Steel Wall/Ceiling Early Reflections (7ms..56ms)
    const earlyTaps: Array<{ ms: number; ampL: number; ampR: number }> = [
      { ms: 7.2, ampL: 0.72, ampR: 0.32 },
      { ms: 11.8, ampL: 0.30, ampR: 0.70 },
      { ms: 17.4, ampL: -0.56, ampR: 0.38 },
      { ms: 24.0, ampL: 0.40, ampR: -0.54 },
      { ms: 32.5, ampL: 0.42, ampR: 0.38 },
      { ms: 43.0, ampL: -0.32, ampR: 0.34 },
      { ms: 55.5, ampL: 0.24, ampR: -0.26 },
    ];

    let tapBrownL = 0;
    let tapBrownR = 0;
    for (const tap of earlyTaps) {
      const idx = Math.floor((tap.ms / 1000) * sr);
      const smearLen = Math.floor(sr * 0.006);
      for (let k = 0; k < smearLen && idx + k < len; k++) {
        const u = k / Math.max(1, smearLen - 1);
        const w = Math.sin(u * Math.PI) * Math.exp(-u * 1.8);
        tapBrownL = (tapBrownL + 0.14 * rand()) / 1.14;
        tapBrownR = (tapBrownR + 0.14 * rand()) / 1.14;
        chL[idx + k] += tap.ampL * w * tapBrownL * 2.4;
        chR[idx + k] += tap.ampR * w * tapBrownR * 2.4;
      }
    }

    // 2. Warm Brown/Pink Enclosed Steel-Corridor Decay (zero raw white-noise static)
    let brownL = 0;
    let brownR = 0;
    let lpBoomL = 0;
    let lpBoomR = 0;
    let lpMidL = 0;
    let lpMidR = 0;
    const alphaBoom = 1 - Math.exp((-2 * Math.PI * 480) / sr);
    const alphaMid = 1 - Math.exp((-2 * Math.PI * 1350) / sr);

    const preDelaySamp = Math.floor(sr * 0.007);
    const fadeSamples = Math.floor(sr * 0.14);

    for (let i = preDelaySamp; i < len; i++) {
      const t = (i - preDelaySamp) / sr;
      const buildUp = 1 - Math.exp(-t / 0.008);
      const endFade =
        i > len - fadeSamples
          ? 0.5 * (1 + Math.cos(((i - (len - fadeSamples)) / fadeSamples) * Math.PI))
          : 1.0;

      brownL = (brownL + 0.12 * rand()) / 1.12;
      brownR = (brownR + 0.12 * rand()) / 1.12;

      lpBoomL += alphaBoom * (brownL - lpBoomL);
      lpBoomR += alphaBoom * (brownR - lpBoomR);
      lpMidL += alphaMid * (brownL - lpMidL);
      lpMidR += alphaMid * (brownR - lpMidR);

      const midBandL = lpMidL - lpBoomL;
      const midBandR = lpMidR - lpBoomR;

      const envBoom = Math.exp(-t / 0.105) * buildUp * endFade;
      const envMid = Math.exp(-t / 0.068) * buildUp * endFade;

      chL[i] += lpBoomL * envBoom * 1.2 + midBandL * envMid * 0.85;
      chR[i] += lpBoomR * envBoom * 1.2 + midBandR * envMid * 0.85;
    }

    // 2-pole smooth rolloff at 1450Hz + TRUE L2 Unit-Energy Normalization!
    let s1L = 0;
    let s1R = 0;
    let s2L = 0;
    let s2R = 0;
    const alphaLp = 1 - Math.exp((-2 * Math.PI * 1450) / sr);
    let sumSq = 0;
    for (let i = 0; i < len; i++) {
      s1L += alphaLp * (chL[i] - s1L);
      s1R += alphaLp * (chR[i] - s1R);
      s2L += alphaLp * (s1L - s2L);
      s2R += alphaLp * (s1R - s2R);
      chL[i] = s2L;
      chR[i] = s2R;
      sumSq += s2L * s2L + s2R * s2R;
    }

    // True L2 norm per channel = sqrt(sumSq / 2) -> exact 0 dB broadband convolution gain!
    const l2Norm = Math.sqrt(Math.max(1e-12, sumSq * 0.5));
    const gainScale = 0.9 / l2Norm;
    for (let i = 0; i < len; i++) {
      chL[i] *= gainScale;
      chR[i] *= gainScale;
    }
    chL[0] = 0;
    chR[0] = 0;
    chL[len - 1] = 0;
    chR[len - 1] = 0;

    return ir;
  }

  /**
   * Pre-synthesizes 3 stereo 4.50s "Last-Shot Rolling Colony Corridor Echo" waveforms:
   * - Triggered ONLY once when a gunfire burst stops (cancel-and-replace), so it NEVER
   *   repeats rhythmic "bap-bap-bap" gunfire chatter!
   * - Built from 6 soft, transient-free overlapping tunnel reflection swells (90ms..420ms rise)
   *   that bounce across L/R corridor junctions, pass through a damped 3D steel-tunnel waveguide,
   *   and glide through a 4-pole (24 dB/oct) lowpass from 880Hz down to 185Hz over 4.5 seconds.
   */
  private buildRollingCorridorTailBuffers(ctx: AudioContext, count: number): AudioBuffer[] {
    const sr = ctx.sampleRate;
    const durSec = 4.5;
    const len = Math.floor(sr * durSec);
    const out: AudioBuffer[] = [];

    let seed = 19860571;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    // 6 soft, transient-free rolling corridor swells ("whoooom... ooooom... mmmmm...")
    // Minimum rise is 95ms so zero sharp percussive gunshot transients ever occur!
    const swells: Array<{
      onsetSec: number;
      riseSec: number;
      decaySec: number;
      ampL: number;
      ampR: number;
    }> = [
      { onsetSec: 0.0, riseSec: 0.095, decaySec: 0.34, ampL: 0.92, ampR: 0.80 },
      { onsetSec: 0.18, riseSec: 0.165, decaySec: 0.46, ampL: 0.44, ampR: 0.78 },
      { onsetSec: 0.52, riseSec: 0.22, decaySec: 0.58, ampL: 0.64, ampR: 0.36 },
      { onsetSec: 0.98, riseSec: 0.29, decaySec: 0.72, ampL: 0.30, ampR: 0.50 },
      { onsetSec: 1.56, riseSec: 0.36, decaySec: 0.86, ampL: 0.36, ampR: 0.24 },
      { onsetSec: 2.25, riseSec: 0.44, decaySec: 1.05, ampL: 0.20, ampR: 0.23 },
    ];

    const fadeSamples = Math.floor(sr * 0.95);
    const d1 = Math.max(1, Math.floor(sr * 0.0184));
    const d2 = Math.max(1, Math.floor(sr * 0.0297));
    const alphaWgDamp = 1 - Math.exp((-2 * Math.PI * 760) / sr);
    const alphaHp = 1 - Math.exp((-2 * Math.PI * 82) / sr);

    for (let v = 0; v < count; v++) {
      const buf = ctx.createBuffer(2, len, sr);
      const chL = buf.getChannelData(0);
      const chR = buf.getChannelData(1);

      let b0L = 0, b1L = 0, b2L = 0, brownL = 0;
      let b0R = 0, b1R = 0, b2R = 0, brownR = 0;
      let lp1L = 0, lp2L = 0, lp3L = 0, lp4L = 0, hpL = 0;
      let lp1R = 0, lp2R = 0, lp3R = 0, lp4R = 0, hpR = 0;

      const timeShift = 1.0 + (v - 1) * 0.05;

      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const wL = rand();
        const wR = rand();

        // Smooth decorrelated stereo pink + brown air turbulence (zero raw white static!)
        b0L = 0.99765 * b0L + wL * 0.099046;
        b1L = 0.963 * b1L + wL * 0.2965164;
        b2L = 0.57 * b2L + wL * 1.0526913;
        const pinkL = (b0L + b1L + b2L) * 0.18;
        brownL = (brownL + 0.048 * wL) / 1.048;

        b0R = 0.99765 * b0R + wR * 0.099046;
        b1R = 0.963 * b1R + wR * 0.2965164;
        b2R = 0.57 * b2R + wR * 1.0526913;
        const pinkR = (b0R + b1R + b2R) * 0.18;
        brownR = (brownR + 0.048 * wR) / 1.048;

        // Evaluate sum of soft rolling corridor swells
        let envL = 0;
        let envR = 0;
        for (let s = 0; s < swells.length; s++) {
          const sw = swells[s];
          const ts = t - sw.onsetSec * timeShift;
          if (ts <= 0) continue;
          const rise =
            ts < sw.riseSec
              ? 0.5 * (1 - Math.cos((ts / sw.riseSec) * Math.PI))
              : 1.0;
          const fall =
            ts < sw.riseSec
              ? 1.0
              : Math.exp(-(ts - sw.riseSec) / (sw.decaySec * timeShift));
          const wEnv = rise * fall;
          // Alternate L/R slightly on odd variation for organic variety
          envL += (v === 1 ? sw.ampR : sw.ampL) * wEnv;
          envR += (v === 1 ? sw.ampL : sw.ampR) * wEnv;
        }

        const srcL = (brownL * 1.85 + pinkL * 0.95) * envL;
        const srcR = (brownR * 1.85 + pinkR * 0.95) * envR;

        // Time-darkening 4-pole (24 dB/oct) distance lowpass: 880Hz near -> 185Hz deep shaft!
        const cutoff = 185 + 695 * Math.exp(-t / 1.35);
        const alphaLp = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);

        lp1L += alphaLp * (srcL - lp1L);
        lp2L += alphaLp * (lp1L - lp2L);
        lp3L += alphaLp * (lp2L - lp3L);
        lp4L += alphaLp * (lp3L - lp4L);
        hpL += alphaHp * (lp4L - hpL);

        lp1R += alphaLp * (srcR - lp1R);
        lp2R += alphaLp * (lp1R - lp2R);
        lp3R += alphaLp * (lp2R - lp3R);
        lp4R += alphaLp * (lp3R - lp4R);
        hpR += alphaHp * (lp4R - hpR);

        chL[i] = lp4L - hpL;
        chR[i] = lp4R - hpR;
      }

      // Pass through cross-coupled damped steel-tunnel waveguide (18.4ms & 29.7ms) for
      // unmistakable hollow metallic corridor body + smooth 0.95s end fade into silence!
      let wgLpL = 0;
      let wgLpR = 0;
      let peak = 0;
      for (let i = 0; i < len; i++) {
        const fbInL = (i >= d1 ? chR[i - d1] * 0.62 : 0) + (i >= d2 ? chL[i - d2] * 0.45 : 0);
        const fbInR = (i >= d1 ? chL[i - d1] * 0.62 : 0) + (i >= d2 ? chR[i - d2] * 0.45 : 0);
        wgLpL += alphaWgDamp * (fbInL - wgLpL);
        wgLpR += alphaWgDamp * (fbInR - wgLpR);

        let endWin = 1.0;
        if (i > len - fadeSamples) {
          const u = (i - (len - fadeSamples)) / fadeSamples;
          endWin = 0.5 * (1 + Math.cos(u * Math.PI));
        }

        const outL = (chL[i] + wgLpL * 0.30) * endWin;
        const outR = (chR[i] + wgLpR * 0.30) * endWin;
        chL[i] = outL;
        chR[i] = outR;

        const a = Math.max(Math.abs(outL), Math.abs(outR));
        if (a > peak) peak = a;
      }

      // Normalize to clean -9.6 dBFS (0.33 peak) so rolling tail never overloads any bus!
      const norm = peak > 1e-5 ? 0.33 / peak : 1.0;
      for (let i = 0; i < len; i++) {
        chL[i] *= norm;
        chR[i] *= norm;
      }
      chL[0] = 0;
      chR[0] = 0;
      chL[len - 1] = 0;
      chR[len - 1] = 0;

      out.push(buf);
    }

    return out;
  }

  /**
   * Pre-bakes 8 100% linear, static-free heavy ballistic machine-gun round waveforms (0.20s each):
   * - Zero nonlinear tanh/clipping and zero raw white-noise static!
   * - Staggered sub-bass initial phases + tight 27ms sub-envelope so rapid 24ms/44ms bursts
   *   never constructively stack 46Hz sub-bass into runaway rumble!
   */
  private buildHeavyMachineGunRoundVariations(ctx: AudioContext, count: number): AudioBuffer[] {
    const sr = ctx.sampleRate;
    const durSec = 0.2;
    const len = Math.floor(sr * durSec);
    const out: AudioBuffer[] = [];

    let seed = 937571;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    for (let v = 0; v < count; v++) {
      const buf = ctx.createBuffer(1, len, sr);
      const dst = buf.getChannelData(0);
      const raw = new Float32Array(len);

      const pressureVar = 0.94 + (v / Math.max(1, count - 1)) * 0.12;
      const bodyCutoff = (700 + ((v * 47) % 150)) * pressureVar;
      const alphaBlastLp = 1 - Math.exp((-2 * Math.PI * bodyCutoff) / sr);
      const alphaBlastHp = 1 - Math.exp((-2 * Math.PI * 135) / sr);

      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let brown = 0;
      let lp1 = 0;
      let lp2 = 0;
      let lp3 = 0;
      let lp4 = 0;
      let hpState = 0;
      // Stagger initial phase across variations so consecutive rapid shots never stack sub-bass in-phase!
      let subPhase = (v / Math.max(1, count)) * Math.PI * 2;
      const baseSubHz = 50 + (v % 4) * 4;

      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const white = rand();

        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        const pink = (b0 + b1 + b2) * 0.19;
        brown = (brown + 0.05 * white) / 1.05;

        // 1. Smooth 1.8ms Raised-Cosine Propellant Detonation Envelope
        const attack =
          t < 0.0018 ? 0.5 * (1 - Math.cos((t / 0.0018) * Math.PI)) : 1.0;
        const plateau = t < 0.0065 ? 1.0 : Math.exp(-(t - 0.0065) / 0.022);
        const hallwayBloom = 0.18 * Math.exp(-t / 0.044);
        const blastEnv = attack * (plateau + hallwayBloom);

        // 4-pole (24 dB/oct) low-pass on smooth brown/pink gas — zero high-end static
        const gasInput = (brown * 2.0 + pink * 1.1) * blastEnv;
        lp1 += alphaBlastLp * (gasInput - lp1);
        lp2 += alphaBlastLp * (lp1 - lp2);
        lp3 += alphaBlastLp * (lp2 - lp3);
        lp4 += alphaBlastLp * (lp3 - lp4);
        hpState += alphaBlastHp * (lp4 - hpState);
        const midBark = (lp4 - hpState * 0.55) * 1.9;

        // 2. Tight, Clean Linear Sub-Bass Thump (142Hz -> 50..62Hz, clears cleanly in ~55ms!)
        const subAttack =
          t < 0.002 ? 0.5 * (1 - Math.cos((t / 0.002) * Math.PI)) : 1.0;
        const subFreq = (baseSubHz + 92 * Math.exp(-t / 0.018)) * pressureVar;
        subPhase += (2 * Math.PI * subFreq) / sr;
        const subWin = t < 0.07 ? Math.cos((t / 0.07) * Math.PI * 0.5) : 0;
        const subEnv = subAttack * Math.exp(-t / 0.027) * subWin;
        const subThump = (Math.sin(subPhase) * 0.85 + Math.sin(subPhase * 2) * 0.15) * subEnv;

        // 3. Warm Damped Steel Roller-Bolt Mass (smooth 1.8ms onset, <950Hz)
        let mechClank = 0;
        if (t >= 0.003) {
          const tb = t - 0.003;
          const bOnset = tb < 0.0018 ? 0.5 * (1 - Math.cos((tb / 0.0018) * Math.PI)) : 1.0;
          const bEnv = bOnset * Math.exp(-tb / 0.0095);
          mechClank +=
            (Math.sin(2 * Math.PI * 390 * pressureVar * tb) * 0.56 +
              Math.sin(2 * Math.PI * 680 * pressureVar * tb) * 0.32 +
              Math.sin(2 * Math.PI * 940 * pressureVar * tb) * 0.12) *
            bEnv *
            0.22;
        }
        if (t >= 0.021) {
          const tr = t - 0.021;
          const rOnset = tr < 0.0018 ? 0.5 * (1 - Math.cos((tr / 0.0018) * Math.PI)) : 1.0;
          const rEnv = rOnset * Math.exp(-tr / 0.0085);
          mechClank +=
            (Math.sin(2 * Math.PI * 480 * pressureVar * tr) * 0.58 +
              Math.sin(2 * Math.PI * 810 * pressureVar * tr) * 0.26) *
            rEnv *
            0.14;
        }

        // 100% pure linear summation (zero tanh intermodulation!)
        raw[i] = midBark * 0.85 + subThump * 0.88 + mechClank;
      }

      // 4. Close-corridor wall slapbacks (6.8ms and 13.8ms) + smooth 38ms cosine fadeout
      const tap1 = Math.floor(sr * (0.0068 + (v % 3) * 0.0006));
      const tap2 = Math.floor(sr * (0.0138 + (v % 4) * 0.0008));
      const tailFadeSamples = Math.floor(sr * 0.038);
      let peak = 0;
      for (let i = 0; i < len; i++) {
        let s = raw[i];
        if (i >= tap1) s -= raw[i - tap1] * 0.25;
        if (i >= tap2) s += raw[i - tap2] * 0.16;
        if (i > len - tailFadeSamples) {
          const u = (i - (len - tailFadeSamples)) / tailFadeSamples;
          s *= 0.5 * (1 + Math.cos(u * Math.PI));
        }
        dst[i] = s;
        const a = Math.abs(s);
        if (a > peak) peak = a;
      }

      // Normalize to 0.38 (-8.4 dBFS) for effortless multi-turret clean headroom!
      const norm = peak > 1e-4 ? 0.38 / peak : 1.0;
      for (let i = 0; i < len; i++) {
        dst[i] *= norm;
      }
      dst[0] = 0;
      dst[len - 1] = 0;

      out.push(buf);
    }

    return out;
  }

  private createSoftClipCurve(drive: number): Float32Array<ArrayBuffer> {
    const samples = 1024;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    const norm = Math.tanh(drive);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = Math.tanh(x * drive) / norm;
    }
    return curve;
  }

  private buildProceduralLoopFallbacks(): void {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;

    // Dedicated always-active 6.0s turbulent muted combustion rumble buffer (translates on both subwoofers & phone speakers)
    if (!this.buffers.has('muted_flame_rumble_core')) {
      const durSec = 6;
      const len = sr * durSec;
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let brown = 0;
      let lp1 = 0;
      let lp2 = 0;
      const alphaLp = 1 - Math.exp((-2 * Math.PI * 360) / sr);
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        const pink = (b0 + b1 + b2 + white * 0.1848) * 0.16;
        brown = (brown + 0.042 * white) / 1.042;

        // Prime-harmonic loop-periodic combustion chamber flutter (13Hz, 21Hz, 34Hz, 53Hz)
        const u = i / len;
        const tau = Math.PI * 2 * u;
        const chamberFlutter =
          0.78 +
          0.11 * Math.sin(tau * (13 * durSec)) +
          0.09 * Math.sin(tau * (21 * durSec) + 0.7) +
          0.07 * Math.cos(tau * (34 * durSec) + 1.9) +
          0.05 * Math.sin(tau * (53 * durSec) + 2.8);

        // Warm low-frequency hull-coupled combustion resonance (72Hz + 138Hz)
        const hullFlameTone =
          0.09 * Math.sin(tau * (72 * durSec) + Math.sin(tau * (7 * durSec)) * 0.8) +
          0.06 * Math.sin(tau * (138 * durSec) + Math.cos(tau * (11 * durSec)) * 0.6);

        const rawPlume = (brown * 3.1 + pink * 1.15) * chamberFlutter + hullFlameTone;
        const saturated = Math.tanh(rawPlume * 1.55);
        lp1 += alphaLp * (saturated - lp1);
        lp2 += alphaLp * (lp1 - lp2);
        data[i] = lp2 * 0.92;
      }
      this.buffers.set('muted_flame_rumble_core', this.createSeamlessOverlapLoop(buf, 0.55));
    }

    if (!this.buffers.has('thruster_main_loop')) {
      const len = sr * 4;
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let brown = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        const pink = (b0 + b1 + b2 + white * 0.1848) * 0.14;
        brown = (brown + 0.035 * white) / 1.035;
        const t = i / len;
        const rumbleMod =
          0.82 +
          0.12 * Math.sin(2 * Math.PI * 38 * t * 4) +
          0.08 * Math.sin(2 * Math.PI * 71 * t * 4);
        data[i] = Math.tanh((brown * 2.8 + pink * 0.85) * rumbleMod * 1.3);
      }
      this.buffers.set('thruster_main_loop', this.createSeamlessOverlapLoop(buf, 0.35));
    }

    if (!this.buffers.has('thruster_rcs_loop')) {
      const len = Math.floor(sr * 2.5);
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        const hp = white - 0.72 * prev;
        prev = white;
        data[i] = Math.max(-0.95, Math.min(0.95, hp * 0.48));
      }
      this.buffers.set('thruster_rcs_loop', this.createSeamlessOverlapLoop(buf, 0.2));
    }

    if (!this.buffers.has('alien_eerie_ambience')) {
      const len = sr * 12;
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const lfo = 0.72 + 0.28 * Math.sin((2 * Math.PI * t) / 12);
        const d1 = Math.sin(2 * Math.PI * 55 * t) * 0.10;
        const d2 = Math.sin(2 * Math.PI * 77.78 * t + Math.sin((2 * Math.PI * t) / 12) * 0.35) * 0.06;
        const d3 = Math.sin(2 * Math.PI * 164.81 * t) * 0.025;
        data[i] = (d1 + d2 + d3) * lfo;
      }
      this.buffers.set('alien_eerie_ambience', buf);
    }

    if (!this.buffers.has('lv426_wind_loop')) {
      const len = sr * 6;
      const buf = ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      let y1 = 0;
      let y2 = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const white = Math.random() * 2 - 1;
        const f = 320 + 140 * Math.sin((2 * Math.PI * t) / 6) + 75 * Math.cos((4 * Math.PI * t) / 6);
        const c = 2 * Math.sin((Math.PI * f) / sr);
        const q = 0.09;
        y1 += c * y2;
        const hp = white - y1 - q * y2;
        y2 += c * hp;
        data[i] = Math.tanh(y2 * 0.28 + white * 0.04);
      }
      this.buffers.set('lv426_wind_loop', this.createSeamlessOverlapLoop(buf, 0.5));
    }
  }

  private startContinuousLoops(): void {
    const ctx = this.ctx!;
    if (!this.masterGain) return;

    // Dual-Stage Muted Flame Rumble Bus (warm 80–480Hz combustion body, steep roll-off above ~620Hz = zero hiss!)
    this.mainThrusterFilter = ctx.createBiquadFilter();
    this.mainThrusterFilter.type = 'lowpass';
    this.mainThrusterFilter.frequency.value = 340;
    this.mainThrusterFilter.Q.value = 0.62;

    const subBassShelf = ctx.createBiquadFilter();
    subBassShelf.type = 'lowshelf';
    subBassShelf.frequency.value = 135;
    subBassShelf.gain.value = 5.5;

    const combustionBody = ctx.createBiquadFilter();
    combustionBody.type = 'peaking';
    combustionBody.frequency.value = 195;
    combustionBody.Q.value = 0.85;
    combustionBody.gain.value = 5.0;

    this.mainThrusterPostLp = ctx.createBiquadFilter();
    this.mainThrusterPostLp.type = 'lowpass';
    this.mainThrusterPostLp.frequency.value = 560;
    this.mainThrusterPostLp.Q.value = 0.54;

    this.mainThrusterGain = ctx.createGain();
    this.mainThrusterGain.gain.value = 0;

    this.mainThrusterFilter.connect(subBassShelf);
    subBassShelf.connect(combustionBody);
    combustionBody.connect(this.mainThrusterPostLp);
    this.mainThrusterPostLp.connect(this.mainThrusterGain);
    this.mainThrusterGain.connect(this.masterGain);

    // Start dedicated turbulent muted combustion core + sample texture layer
    const coreBuf = this.buffers.get('muted_flame_rumble_core');
    if (coreBuf) {
      const coreSrc = ctx.createBufferSource();
      coreSrc.buffer = coreBuf;
      coreSrc.loop = true;
      coreSrc.playbackRate.value = 0.92;
      const coreMix = ctx.createGain();
      coreMix.gain.value = 0.88;
      coreSrc.connect(coreMix);
      coreMix.connect(this.mainThrusterFilter);
      coreSrc.start();
      this.synthFlameRumbleSource = coreSrc;
    }
    this.restartLoopSource('thruster_main_loop');

    this.rcsFilter = ctx.createBiquadFilter();
    this.rcsFilter.type = 'bandpass';
    this.rcsFilter.frequency.value = 2600;
    this.rcsFilter.Q.value = 0.65;

    this.rcsPanner = ctx.createStereoPanner();
    this.rcsPanner.pan.value = 0;

    this.rcsGain = ctx.createGain();
    this.rcsGain.gain.value = 0;

    this.rcsFilter.connect(this.rcsPanner);
    this.rcsPanner.connect(this.rcsGain);
    this.rcsGain.connect(this.masterGain);
    this.restartLoopSource('thruster_rcs_loop');

    // Continuous, non-repeating 1979 ALIEN deep-space ambience (replaces old static CRT buzz!)
    this.startAlienDeepSpaceAmbience();

    // Seamlessly crossfaded & low-passed (480Hz, zero hiss/static) hull resonance layer
    this.eerieAmbienceFilter = ctx.createBiquadFilter();
    this.eerieAmbienceFilter.type = 'lowpass';
    this.eerieAmbienceFilter.frequency.value = 480;
    this.eerieAmbienceFilter.Q.value = 0.65;

    this.eerieAmbienceGain = ctx.createGain();
    this.eerieAmbienceGain.gain.value = 0.11;
    this.eerieAmbienceFilter.connect(this.eerieAmbienceGain);
    this.eerieAmbienceGain.connect(this.masterGain);
    this.restartLoopSource('alien_eerie_ambience');

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 950;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    this.restartLoopSource('lv426_wind_loop');

    // Continuous whisper-subtle muffled M240 Napalm burn bed (silent at 0 until napalmClouds burn)
    if (this.napalmBulkheadInput) {
      this.napalmLoopPanner = ctx.createStereoPanner();
      this.napalmLoopPanner.pan.value = 0;
      this.napalmLoopGain = ctx.createGain();
      this.napalmLoopGain.gain.value = 0;
      this.napalmLoopPanner.connect(this.napalmLoopGain);
      this.napalmLoopGain.connect(this.napalmBulkheadInput);

      // Start with procedural muted combustion core immediately; seamlessly swaps to napalm_burn_loop MP3 on decode!
      const fallbackFlame = this.buffers.get('muted_flame_rumble_core');
      if (fallbackFlame) {
        const src = ctx.createBufferSource();
        src.buffer = fallbackFlame;
        src.loop = true;
        src.playbackRate.value = 0.78;
        src.connect(this.napalmLoopPanner);
        src.start();
        this.napalmLoopSource = src;
      }
      this.restartLoopSource('napalm_burn_loop');
    }

    // Dynamic Hadley's Perimeter Reactor Core Hum & Electrical Strain Bus (silent at 0 until Perimeter active)
    this.reactorFilter = ctx.createBiquadFilter();
    this.reactorFilter.type = 'lowpass';
    this.reactorFilter.frequency.value = 260;
    this.reactorFilter.Q.value = 0.8;
    this.reactorGain = ctx.createGain();
    this.reactorGain.gain.value = 0;
    this.reactorFilter.connect(this.reactorGain);
    this.reactorGain.connect(this.masterGain);

    // Subtle 118Hz transformer strain harmonic that wakes up above 82% load / Overclock
    this.reactorStrainOsc = ctx.createOscillator();
    this.reactorStrainOsc.type = 'sawtooth';
    this.reactorStrainOsc.frequency.value = 118;
    const strainBp = ctx.createBiquadFilter();
    strainBp.type = 'bandpass';
    strainBp.frequency.value = 340;
    strainBp.Q.value = 1.6;
    this.reactorStrainGain = ctx.createGain();
    this.reactorStrainGain.gain.value = 0;
    this.reactorStrainOsc.connect(strainBp);
    strainBp.connect(this.reactorStrainGain);
    this.reactorStrainGain.connect(this.masterGain);
    this.reactorStrainOsc.start();

    this.restartLoopSource('perim_reactor_hum_loop');
  }

  /**
   * Infinite, non-repeating 1979 ALIEN ("Nostromo in Deep Space") synthesizer bed:
   * Uses prime-ratio ultra-slow LFOs (21s, 29s, 37s, 43s) modulating deep cosmic fifths,
   * distant hollow minor/tritone hull harmonics, and stereo drift — zero static, zero loop seams.
   */
  private startAlienDeepSpaceAmbience(): void {
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    this.deepSpaceBusGain = ctx.createGain();
    this.deepSpaceBusGain.gain.value = 0.16;
    this.deepSpaceBusGain.connect(this.masterGain);

    // 1. Deep Cosmic Void Sub-Fifth (D1 36.71Hz + A1 55.00Hz)
    const sub1 = ctx.createOscillator();
    const sub2 = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub1.type = 'sine';
    sub2.type = 'sine';
    sub1.frequency.value = 36.71;
    sub2.frequency.value = 55.04;
    subGain.gain.value = 0.24;

    const subLfo = ctx.createOscillator();
    const subLfoGain = ctx.createGain();
    subLfo.type = 'sine';
    subLfo.frequency.value = 0.034; // ~29.4s breath
    subLfoGain.gain.value = 0.07;
    subLfo.connect(subLfoGain);
    subLfoGain.connect(subGain.gain);

    sub1.connect(subGain);
    sub2.connect(subGain);
    subGain.connect(this.deepSpaceBusGain);
    sub1.start();
    sub2.start();
    subLfo.start();

    // 2. Haunting Jerry Goldsmith / Alan Splet Deep-Space Harmonic Shimmer (incommensurate LFOs)
    const voices = [
      { freq: 82.41, lfoHz: 0.047, pan: -0.35, amp: 0.09 }, // E2
      { freq: 116.54, lfoHz: 0.027, pan: 0.35, amp: 0.065 }, // Bb2 eerie tritone
      { freq: 164.81, lfoHz: 0.021, pan: -0.18, amp: 0.045 }, // E3 hollow fifth
      { freq: 220.0, lfoHz: 0.017, pan: 0.22, amp: 0.028 }, // A3 distant starlight
    ];

    for (const v of voices) {
      const osc = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const vGain = ctx.createGain();
      const panner = ctx.createStereoPanner();

      osc.type = 'triangle';
      osc.frequency.value = v.freq;

      // Tiny slow pitch drift (+/- 0.35 Hz) for organic tape-flutter space warmth
      const pitchLfo = ctx.createOscillator();
      const pitchDepth = ctx.createGain();
      pitchLfo.type = 'sine';
      pitchLfo.frequency.value = v.lfoHz * 1.37;
      pitchDepth.gain.value = 0.35;
      pitchLfo.connect(pitchDepth);
      pitchDepth.connect(osc.frequency);

      lp.type = 'lowpass';
      lp.frequency.value = 290;
      lp.Q.value = 1.4;

      const filterLfo = ctx.createOscillator();
      const filterDepth = ctx.createGain();
      filterLfo.type = 'sine';
      filterLfo.frequency.value = v.lfoHz;
      filterDepth.gain.value = 115;
      filterLfo.connect(filterDepth);
      filterDepth.connect(lp.frequency);

      vGain.gain.value = v.amp;
      const ampLfo = ctx.createOscillator();
      const ampDepth = ctx.createGain();
      ampLfo.type = 'sine';
      ampLfo.frequency.value = v.lfoHz * 0.79;
      ampDepth.gain.value = v.amp * 0.65;
      ampLfo.connect(ampDepth);
      ampDepth.connect(vGain.gain);

      panner.pan.value = v.pan;

      osc.connect(lp);
      lp.connect(vGain);
      vGain.connect(panner);
      panner.connect(this.deepSpaceBusGain);

      osc.start();
      pitchLfo.start();
      filterLfo.start();
      ampLfo.start();
    }

    // 3. Sparse, non-repeating 1979 ALIEN lonely deep-space ionosphere / cosmic hull swells
    const cosmicHarmonics = [110.0, 130.81, 146.83, 155.56, 196.0, 233.08, 293.66];
    const scheduleDeepSpaceSwell = (): void => {
      if (!this.ctx || !this.deepSpaceBusGain) return;
      if (this.ctx.state === 'running' && !this.muted) {
        const now = this.ctx.currentTime;
        const dur = 5.5 + Math.random() * 3.5;
        const baseFreq =
          cosmicHarmonics[Math.floor(Math.random() * cosmicHarmonics.length)] ?? 146.83;
        const driftRatio = Math.random() < 0.5 ? 0.986 : 1.014;

        const oscA = this.ctx.createOscillator();
        const oscB = this.ctx.createOscillator();
        const lp = this.ctx.createBiquadFilter();
        const env = this.ctx.createGain();
        const pan = this.ctx.createStereoPanner();

        oscA.type = 'sine';
        oscB.type = 'triangle';
        oscA.frequency.setValueAtTime(baseFreq, now);
        oscA.frequency.linearRampToValueAtTime(baseFreq * driftRatio, now + dur);
        oscB.frequency.setValueAtTime(baseFreq * 1.502, now);
        oscB.frequency.linearRampToValueAtTime(baseFreq * 1.502 * driftRatio, now + dur);

        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(220, now);
        lp.frequency.linearRampToValueAtTime(420, now + dur * 0.45);
        lp.frequency.linearRampToValueAtTime(180, now + dur);
        lp.Q.value = 2.2;

        const startPan = (Math.random() * 2 - 1) * 0.6;
        pan.pan.setValueAtTime(startPan, now);
        pan.pan.linearRampToValueAtTime(-startPan * 0.7, now + dur);

        env.gain.setValueAtTime(0.0001, now);
        env.gain.linearRampToValueAtTime(0.042, now + dur * 0.42);
        env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        const subMix = this.ctx.createGain();
        subMix.gain.value = 0.35;

        oscA.connect(lp);
        oscB.connect(subMix);
        subMix.connect(lp);
        lp.connect(env);
        env.connect(pan);
        pan.connect(this.deepSpaceBusGain);

        oscA.start(now);
        oscB.start(now);
        oscA.stop(now + dur + 0.05);
        oscB.stop(now + dur + 0.05);
      }

      const nextDelayMs = (9.5 + Math.random() * 8.5) * 1000;
      window.setTimeout(scheduleDeepSpaceSwell, nextDelayMs);
    };

    window.setTimeout(scheduleDeepSpaceSwell, 4500);
  }

  private restartLoopSource(id: string): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(id);
    if (!ctx || !buf) return;

    const makeSource = (): AudioBufferSourceNode => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      return src;
    };

    if (id === 'thruster_main_loop' && this.mainThrusterFilter) {
      try {
        this.mainThrusterSource?.stop();
      } catch {
        /* ignore */
      }
      this.mainThrusterSource = makeSource();
      this.mainThrusterSource.playbackRate.value = 0.84;
      const sampleMix = ctx.createGain();
      sampleMix.gain.value = 0.62;
      this.mainThrusterSource.connect(sampleMix);
      sampleMix.connect(this.mainThrusterFilter);
      this.mainThrusterSource.start();
    } else if (id === 'thruster_rcs_loop' && this.rcsFilter) {
      try {
        this.rcsThrusterSource?.stop();
      } catch {
        /* ignore */
      }
      this.rcsThrusterSource = makeSource();
      this.rcsThrusterSource.connect(this.rcsFilter);
      this.rcsThrusterSource.start();
    } else if (id === 'alien_eerie_ambience' && this.eerieAmbienceFilter) {
      try {
        this.eerieAmbienceSource?.stop();
      } catch {
        /* ignore */
      }
      this.eerieAmbienceSource = makeSource();
      this.eerieAmbienceSource.playbackRate.value = 0.78;
      this.eerieAmbienceSource.connect(this.eerieAmbienceFilter);
      this.eerieAmbienceSource.start();
    } else if (id === 'lv426_wind_loop' && this.windFilter) {
      try {
        this.windSource?.stop();
      } catch {
        /* ignore */
      }
      this.windSource = makeSource();
      this.windSource.connect(this.windFilter);
      this.windSource.start();
    } else if (id === 'napalm_burn_loop' && this.napalmLoopPanner) {
      try {
        this.napalmLoopSource?.stop();
      } catch {
        /* ignore */
      }
      this.napalmLoopSource = makeSource();
      this.napalmLoopSource.playbackRate.value = 0.88;
      this.napalmLoopSource.connect(this.napalmLoopPanner);
      this.napalmLoopSource.start();
    } else if (id === 'perim_reactor_hum_loop' && this.reactorFilter) {
      try {
        this.reactorLoopSource?.stop();
      } catch {
        /* ignore */
      }
      this.reactorLoopSource = makeSource();
      this.reactorLoopSource.playbackRate.value = this.curReactorRate;
      this.reactorLoopSource.connect(this.reactorFilter);
      this.reactorLoopSource.start();
    }
  }

  private setSmoothParam(param: AudioParam | undefined | null, value: number): void {
    if (!param || !this.ctx) return;
    if (Math.abs(param.value - value) < 0.0004) return;
    param.cancelScheduledValues(this.ctx.currentTime);
    param.value = value;
  }

  public updateFlightDsp(
    throttle: number,
    rcsDirection: number,
    rcsIntensity: number,
    windSpeedMps: number,
    flightActive: boolean,
    caveDarkness = 0,
    dt = 1 / 60
  ): void {
    if (!this.ctx || !this.unlocked) return;

    const clampedDt = Math.max(0.001, Math.min(0.1, dt));
    const fastK = 1 - Math.exp(-clampedDt * 20);
    const medK = 1 - Math.exp(-clampedDt * 9);
    const slowK = 1 - Math.exp(-clampedDt * 2.5);

    // Tastefully swell deep-space & eerie hull resonance inside dark caverns
    const targetEerie = 0.09 + caveDarkness * 0.09;
    const targetSpace = 0.15 + caveDarkness * 0.06;
    this.curEerieGain += (targetEerie - this.curEerieGain) * slowK;
    this.curSpaceGain += (targetSpace - this.curSpaceGain) * slowK;
    this.setSmoothParam(this.eerieAmbienceGain?.gain, this.curEerieGain);
    this.setSmoothParam(this.deepSpaceBusGain?.gain, this.curSpaceGain);

    if (!flightActive) {
      this.curMainFlameGain += (0 - this.curMainFlameGain) * fastK;
      this.curRcsGain += (0 - this.curRcsGain) * fastK;
      this.curWindGain += (0 - this.curWindGain) * medK;
      this.setSmoothParam(this.mainThrusterGain?.gain, this.curMainFlameGain < 0.002 ? 0 : this.curMainFlameGain);
      this.setSmoothParam(this.rcsGain?.gain, this.curRcsGain < 0.002 ? 0 : this.curRcsGain);
      this.setSmoothParam(this.windGain?.gain, this.curWindGain < 0.002 ? 0 : this.curWindGain);
      return;
    }

    // Sustained Muted Flame Rumble: warm muffled combustion roar (280Hz..650Hz) with zero harsh hiss
    const clampedNorm = Math.max(0, Math.min(1, throttle));
    const overdriveExtra = Math.max(0, throttle - 1);
    const targetRate = 0.78 + clampedNorm * 0.22 + overdriveExtra * 0.10;
    const targetCutoff = 280 + Math.pow(clampedNorm, 0.9) * 340 + overdriveExtra * 190;
    const targetPostCutoff = 480 + clampedNorm * 210 + overdriveExtra * 160;
    const targetMainGain =
      throttle > 0.01 ? Math.min(0.92, 0.36 + clampedNorm * 0.44 + overdriveExtra * 0.14) : 0;

    this.curMainFlameRate += (targetRate - this.curMainFlameRate) * fastK;
    this.curMainFlameCutoff += (targetCutoff - this.curMainFlameCutoff) * fastK;
    this.curMainFlameGain += (targetMainGain - this.curMainFlameGain) * fastK;

    this.setSmoothParam(this.mainThrusterSource?.playbackRate, this.curMainFlameRate);
    this.setSmoothParam(this.synthFlameRumbleSource?.playbackRate, this.curMainFlameRate * 0.96);
    this.setSmoothParam(this.mainThrusterFilter?.frequency, this.curMainFlameCutoff);
    this.setSmoothParam(this.mainThrusterPostLp?.frequency, targetPostCutoff);
    this.setSmoothParam(
      this.mainThrusterGain?.gain,
      this.curMainFlameGain < 0.002 ? 0 : this.curMainFlameGain
    );

    const targetPan = Math.max(-0.6, Math.min(0.6, rcsDirection * 0.52));
    const targetRcsGain = rcsIntensity > 0.01 ? Math.min(0.38, rcsIntensity * 0.30) : 0;
    this.curRcsPan += (targetPan - this.curRcsPan) * fastK;
    this.curRcsGain += (targetRcsGain - this.curRcsGain) * fastK;
    this.setSmoothParam(this.rcsPanner?.pan, this.curRcsPan);
    this.setSmoothParam(this.rcsGain?.gain, this.curRcsGain < 0.002 ? 0 : this.curRcsGain);

    const windNorm = Math.min(1, windSpeedMps / 14);
    const targetWindGain = windNorm * 0.34;
    const targetWindFreq = 420 + windNorm * 1350;
    this.curWindGain += (targetWindGain - this.curWindGain) * medK;
    this.curWindFreq += (targetWindFreq - this.curWindFreq) * medK;
    this.setSmoothParam(this.windGain?.gain, this.curWindGain < 0.002 ? 0 : this.curWindGain);
    this.setSmoothParam(this.windFilter?.frequency, this.curWindFreq);
  }

  /**
   * Drives the barely-audible, ultra-high-quality muffled liquid-napalm combustion bed
   * behind the colony bulkheads whenever 1 or more M240 napalm clouds are burning.
   */
  public updatePerimeterNapalmBed(
    activeCloudIntensity: number,
    avgPan = 0,
    dt = 1 / 60
  ): void {
    if (!this.ctx || !this.unlocked || !this.napalmLoopGain || !this.napalmLoopPanner) return;
    const clampedDt = Math.max(0.001, Math.min(0.1, dt));
    const smoothK = 1 - Math.exp(-clampedDt * 5.5);

    // Barely hearable (-28 dBFS to -23.5 dBFS), silky muffled oil-flame presence behind steel walls
    const targetGain =
      activeCloudIntensity > 0.02
        ? Math.min(0.068, 0.036 + Math.min(3, activeCloudIntensity) * 0.01)
        : 0;
    const targetPan = Math.max(-0.72, Math.min(0.72, avgPan));

    this.curNapalmGain += (targetGain - this.curNapalmGain) * smoothK;
    this.curNapalmPan += (targetPan - this.curNapalmPan) * smoothK;

    this.setSmoothParam(
      this.napalmLoopGain.gain,
      this.curNapalmGain < 0.0008 ? 0 : this.curNapalmGain
    );
    this.setSmoothParam(this.napalmLoopPanner.pan, this.curNapalmPan);
  }

  /**
   * Drives the dynamic Hadley's Perimeter Reactor Core turbine hum & transformer strain bus:
   * - Scales pitch/cutoff with live kW load ratio
   * - Ramps 118Hz transformer strain above 82% load or during Overclock / Overload
   * - Cuts sharply to eerie silence during Reactor Blackout!
   */
  public updatePerimeterReactorBed(
    active: boolean,
    loadRatio: number,
    overloadFrac: number,
    blackoutActive: boolean,
    dt = 1 / 60
  ): void {
    if (!this.ctx || !this.unlocked || !this.reactorGain || !this.reactorFilter) return;
    const clampedDt = Math.max(0.001, Math.min(0.1, dt));
    const clampedLoad = Math.max(0, Math.min(1.3, loadRatio));
    const clampedOver = Math.max(0, Math.min(1, overloadFrac));

    const targetGain =
      !active || blackoutActive
        ? 0
        : 0.055 + Math.min(1, clampedLoad) * 0.068 + clampedOver * 0.075;
    const targetCutoff = 220 + Math.min(1, clampedLoad) * 340 + clampedOver * 640;
    const targetRate = 0.9 + Math.min(1.15, clampedLoad) * 0.14 + clampedOver * 0.22;
    const targetStrain =
      !active || blackoutActive
        ? 0
        : clampedOver > 0.02
          ? 0.025 + clampedOver * 0.055
          : clampedLoad > 0.82
            ? ((clampedLoad - 0.82) / 0.2) * 0.022
            : 0;

    const kGain = 1 - Math.exp(-clampedDt * (blackoutActive ? 14 : 4.2));
    const kSlow = 1 - Math.exp(-clampedDt * 3.8);

    this.curReactorGain += (targetGain - this.curReactorGain) * kGain;
    this.curReactorCutoff += (targetCutoff - this.curReactorCutoff) * kSlow;
    this.curReactorRate += (targetRate - this.curReactorRate) * kSlow;
    this.curReactorStrain += (targetStrain - this.curReactorStrain) * kGain;

    this.setSmoothParam(
      this.reactorGain.gain,
      this.curReactorGain < 0.0008 ? 0 : this.curReactorGain
    );
    this.setSmoothParam(this.reactorFilter.frequency, this.curReactorCutoff);
    if (this.reactorLoopSource) {
      this.setSmoothParam(this.reactorLoopSource.playbackRate, this.curReactorRate);
    }
    if (this.reactorStrainGain && this.reactorStrainOsc) {
      this.setSmoothParam(
        this.reactorStrainGain.gain,
        this.curReactorStrain < 0.0005 ? 0 : this.curReactorStrain
      );
      this.setSmoothParam(this.reactorStrainOsc.frequency, 118 + clampedOver * 44);
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.02);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public suspendForBackground(paused: boolean): void {
    if (!this.ctx) return;
    if (paused && this.ctx.state === 'running') {
      void this.ctx.suspend();
    } else if (!paused && this.ctx.state === 'suspended' && this.unlocked) {
      void this.ctx.resume();
    }
  }

  /**
   * Immediately silences all cartridge-specific continuous audio loops and active voice callouts
   * when switching between Terminal <-> Lunar Lander <-> Hadley's Perimeter so zero sounds leak.
   */
  public stopCartridgeLoops(): void {
    this.curMainFlameGain = 0;
    this.curRcsGain = 0;
    this.curWindGain = 0;
    this.curNapalmGain = 0;
    this.curReactorGain = 0;
    this.curReactorStrain = 0;
    this.setSmoothParam(this.mainThrusterGain?.gain, 0);
    this.setSmoothParam(this.rcsGain?.gain, 0);
    this.setSmoothParam(this.windGain?.gain, 0);
    this.setSmoothParam(this.napalmLoopGain?.gain, 0);
    this.setSmoothParam(this.reactorGain?.gain, 0);
    this.setSmoothParam(this.reactorStrainGain?.gain, 0);
    try {
      this.activeVoiceSource?.stop();
    } catch {
      /* ignore */
    }
    this.activeVoiceSource = null;
    if (this.activeSentryTail) {
      try {
        this.activeSentryTail.src.stop();
        this.activeSentryTail.gain.disconnect();
      } catch {
        /* ignore */
      }
      this.activeSentryTail = null;
    }
    this.fadeOutBootStartupAudio(0.45);
  }

  public getBusActivityLevel(): number {
    if (this.muted || !this.analyser || !this.analyserData || !this.unlocked) return 0;
    this.analyser.getByteFrequencyData(this.analyserData);
    let sum = 0;
    for (let i = 0; i < this.analyserData.length; i++) {
      sum += this.analyserData[i];
    }
    return Math.min(1, sum / (this.analyserData.length * 115));
  }

  /**
   * Plays `homeade_computer_start.m4a` simultaneously with the distorted 1979 CRT
   * tube turn-on flash (completely replacing the old `screen_power_on.mp3`).
   */
  public playAlienBootAwakening(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    const startBuf = this.buffers.get('homeade_computer_start');
    if (startBuf) {
      try {
        this.bootStartupSource?.stop();
      } catch {
        /* ignore */
      }
      const src = this.ctx.createBufferSource();
      src.buffer = startBuf;
      src.playbackRate.value = 1.0;

      // Trim the leading 1.0s dead air so the CRT tube snap aligns instantaneously with the flash
      const startOffset = startBuf.duration > 1.5 ? 1.0 : 0;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.96, now + 0.012);
      src.connect(gain);
      gain.connect(this.masterGain);
      src.start(now, startOffset);

      this.bootStartupSource = src;
      this.bootStartupGain = gain;
      src.onended = () => {
        if (this.bootStartupSource === src) {
          this.bootStartupSource = null;
          this.bootStartupGain = null;
        }
      };
      return;
    }

    if (!this.muted) {
      this.synthScreenPowerOn(now, 0.75);
    }
  }

  /**
   * Smoothly fades out the startup computer audio once active drop-shuttle flight engages.
   */
  public fadeOutBootStartupAudio(fadeSec = 1.1): void {
    if (!this.ctx || !this.bootStartupSource || !this.bootStartupGain) return;
    const now = this.ctx.currentTime;
    const src = this.bootStartupSource;
    const g = this.bootStartupGain;
    this.bootStartupSource = null;
    this.bootStartupGain = null;

    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + fadeSec);
    window.setTimeout(() => {
      try {
        src.stop();
      } catch {
        /* ignore */
      }
    }, Math.ceil((fadeSec + 0.1) * 1000));
  }

  /**
   * Plays lower-pitched, warm, infrequent 1979 Nostromo computer thinking tones.
   */
  public playAlienComputerActivity(intensity = 0.45): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (this.buffers.has('computer_telemetry_chirp')) {
      this.playLowComputerBuffer(
        'computer_telemetry_chirp',
        intensity * 0.85,
        0.62 + Math.random() * 0.14
      );
    } else if (this.buffers.has('tape_drive_servo')) {
      this.playLowComputerBuffer(
        'tape_drive_servo',
        intensity * 0.7,
        0.78 + Math.random() * 0.12
      );
    } else {
      this.synth1979MainframeCascade(this.ctx.currentTime, 3, intensity * 0.42);
    }
  }

  private playLowComputerBuffer(id: string, volume: number, pitch: number): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(id);
    if (!ctx || !buf || !this.masterGain) return;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch;

    // Warm 780Hz lowpass so computer bleeps are deep, dark, and never piercing
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 780;
    lp.Q.value = 0.7;

    const g = ctx.createGain();
    g.gain.value = 0.68 * volume;

    src.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain);
    src.start(ctx.currentTime);
  }

  /**
   * Satisfying heavy mechanical / industrial cockpit latch engaging sound for buttons & switches.
   */
  /**
   * Classic 1979 ALIEN Motion Tracker Proximity Ping for Landing Sequence:
   * Hollow, slightly creepy electromechanical pulse + faint solenoid flutter whose
   * repetition rate and tension rise smoothly as the lander nears the ground.
   * @param closeness 0.0 (far ~68m AGL) to 1.0 (contact imminent <3m AGL)
   */
  public playAlienMotionTrackerPing(closeness: number, pan = 0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const c = Math.max(0, Math.min(1, closeness));

    // 1. Subtle mechanical Ash-tracker micro-flutter tick 22ms before pulse
    const tickOsc = ctx.createOscillator();
    const tickGain = ctx.createGain();
    tickOsc.type = 'triangle';
    tickOsc.frequency.setValueAtTime(340 + c * 90, now);
    tickOsc.frequency.exponentialRampToValueAtTime(110, now + 0.016);
    tickGain.gain.setValueAtTime(0.08 + c * 0.06, now);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
    tickOsc.connect(tickGain);
    tickGain.connect(this.masterGain);
    tickOsc.start(now);
    tickOsc.stop(now + 0.02);

    // 2. Layer ElevenLabs alien_motion_ping buffer (if loaded) + signature hollow 1979 resonant FM blip
    const buf = this.buffers.get('alien_motion_ping');
    if (buf) {
      const onset = this.bufferOnsets.get('alien_motion_ping') ?? 0;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.86 + c * 0.24;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1120 + c * 320;
      bp.Q.value = 1.6;

      const env = ctx.createGain();
      const vol = 0.22 + c * 0.24;
      env.gain.setValueAtTime(0.001, now + 0.02);
      env.gain.linearRampToValueAtTime(vol, now + 0.028);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-0.5, Math.min(0.5, pan));

      src.connect(bp);
      bp.connect(env);
      env.connect(panner);
      panner.connect(this.masterGain);
      src.start(now + 0.02, onset, 0.26);
    }

    // Hollow 1979 movie motion-tracker resonant carrier (gives that exact eerie metallic ring)
    const ping = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modG = ctx.createGain();
    const pingEnv = ctx.createGain();

    const baseF = 935 + c * 215;
    ping.type = 'sine';
    ping.frequency.setValueAtTime(baseF * 1.04, now + 0.022);
    ping.frequency.exponentialRampToValueAtTime(baseF * 0.96, now + 0.16);

    mod.type = 'sine';
    mod.frequency.value = 58; // Creepy 58Hz warble flutter inside the blip!
    modG.gain.value = 18 + c * 14;

    pingEnv.gain.setValueAtTime(0.0001, now + 0.022);
    pingEnv.gain.linearRampToValueAtTime(0.11 + c * 0.11, now + 0.030);
    pingEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);

    mod.connect(modG);
    modG.connect(ping.frequency);
    ping.connect(pingEnv);
    pingEnv.connect(this.masterGain);

    mod.start(now + 0.022);
    ping.start(now + 0.022);
    mod.stop(now + 0.18);
    ping.stop(now + 0.18);
  }

  /**
   * EPIC Solid-Rocket Emergency Thrust Pulse ([SPACEBAR]):
   * Explosive pyrotechnic ignition + chest-shaking sub-bass rocket blast wave.
   */
  public playEmergencyThrustPulse(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const buf = this.buffers.get('emergency_thrust_pulse');
    if (buf) {
      const onset = this.bufferOnsets.get('emergency_thrust_pulse') ?? 0;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.92;

      const subShelf = ctx.createBiquadFilter();
      subShelf.type = 'lowshelf';
      subShelf.frequency.value = 120;
      subShelf.gain.value = 6.5;

      const g = ctx.createGain();
      g.gain.setValueAtTime(1.0, now);

      src.connect(subShelf);
      subShelf.connect(g);
      g.connect(this.masterGain);
      src.start(now, onset);
    } else {
      this.synthHullExplosion(now, 0.85);
    }
  }

  /**
   * Definitive, weighty multi-ton industrial spaceship touchdown "THUD":
   * Layers the HD heavy landing thud sample (+8dB sub-bass shelf), a phase-locked
   * structural hull shock transient (118Hz -> 29Hz), and delayed hydraulic clamp lock (+80ms).
   */
  private lastTouchdownThudTime = -10;
  public playIndustrialTouchdownThud(impactVs: number, isHard: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastTouchdownThudTime < 0.35) return;
    this.lastTouchdownThudTime = now;

    const ctx = this.ctx;
    const velScale = Math.max(0.72, Math.min(1.15, 0.72 + impactVs / 3.8));

    // 1. Primary HD Heavy Industrial Thud Sample (onset-trimmed + sub-bass boosted)
    const thudBuf = this.buffers.get('landing_hard_thud');
    if (thudBuf) {
      const onset = this.bufferOnsets.get('landing_hard_thud') ?? 0;
      const src = ctx.createBufferSource();
      src.buffer = thudBuf;
      src.playbackRate.value = isHard ? 0.86 : 0.93;

      const subShelf = ctx.createBiquadFilter();
      subShelf.type = 'lowshelf';
      subShelf.frequency.value = 98;
      subShelf.gain.value = 8.0;

      const hullBody = ctx.createBiquadFilter();
      hullBody.type = 'peaking';
      hullBody.frequency.value = 175;
      hullBody.Q.value = 1.1;
      hullBody.gain.value = 4.2;

      const g = ctx.createGain();
      g.gain.setValueAtTime((isHard ? 1.0 : 0.88) * velScale, now);

      src.connect(subShelf);
      subShelf.connect(hullBody);
      hullBody.connect(g);
      g.connect(this.masterGain);
      src.start(now, onset);
    }

    // 2. Phase-Locked Physical Multi-Ton Sub-Bass Hull Drop + Damped Steel Deck Slam
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(isHard ? 128 : 112, now);
    subOsc.frequency.exponentialRampToValueAtTime(28, now + 0.29);
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.linearRampToValueAtTime(0.68 * velScale, now + 0.006);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(now);
    subOsc.stop(now + 0.36);

    const crunchLen = Math.floor(ctx.sampleRate * 0.14);
    const crunchBuf = ctx.createBuffer(1, crunchLen, ctx.sampleRate);
    const cd = crunchBuf.getChannelData(0);
    for (let i = 0; i < crunchLen; i++) {
      const env = Math.exp(-i / (ctx.sampleRate * 0.028));
      cd[i] = (Math.random() * 2 - 1) * env;
    }
    const crunchSrc = ctx.createBufferSource();
    crunchSrc.buffer = crunchBuf;
    const crunchLp = ctx.createBiquadFilter();
    crunchLp.type = 'lowpass';
    crunchLp.frequency.value = isHard ? 520 : 380;
    const crunchGain = this.createGainWithMaster(0.55 * velScale);
    crunchSrc.connect(crunchLp);
    crunchLp.connect(crunchGain);
    crunchSrc.start(now);

    // 3. Delayed (+80ms) Pneumatic Strut Compression & Magnetic Clamp Lock
    const mechBuf = this.buffers.get('landing_soft_mech');
    if (mechBuf) {
      const onset = this.bufferOnsets.get('landing_soft_mech') ?? 0;
      const mSrc = ctx.createBufferSource();
      mSrc.buffer = mechBuf;
      mSrc.playbackRate.value = 0.92;
      const mGain = this.createGainWithMaster(0.66);
      mSrc.connect(mGain);
      mSrc.start(now + 0.08, onset);
    }

    const latchBuf = this.buffers.get('button_latch_lock');
    if (latchBuf) {
      const onset = this.bufferOnsets.get('button_latch_lock') ?? 0;
      const lSrc = ctx.createBufferSource();
      lSrc.buffer = latchBuf;
      lSrc.playbackRate.value = 0.72;
      const lGain = this.createGainWithMaster(0.72);
      lSrc.connect(lGain);
      lSrc.start(now + 0.095, onset);
    }
  }

  /**
   * Scary, ominous 1979 computer transition sound effects replacing non-warning voice intros/transitions.
   */
  public playScaryComputerTransition(
    kind: 'dark' | 'engage' | 'confirm',
    delaySeconds = 0,
    gainVal = 0.82
  ): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const startAt = this.ctx.currentTime + Math.max(0, delaySeconds);
    const idMap: Record<'dark' | 'engage' | 'confirm', SfxId> = {
      dark: 'computer_transition_dark',
      engage: 'computer_sector_engage',
      confirm: 'computer_touchdown_confirm',
    };
    const id = idMap[kind];
    const buf = this.buffers.get(id);
    if (buf) {
      const onset = this.bufferOnsets.get(id) ?? 0;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = kind === 'dark' ? 0.88 : 0.92;

      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1850;

      const sub = this.ctx.createBiquadFilter();
      sub.type = 'lowshelf';
      sub.frequency.value = 110;
      sub.gain.value = 4.5;

      const g = this.createGainWithMaster(gainVal);
      src.connect(lp);
      lp.connect(sub);
      sub.connect(g);
      src.start(startAt, onset);
    } else {
      this.synth1979MainframeCascade(startAt, 6, 0.45);
    }
  }

  private createGainWithMaster(val: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = val;
    g.connect(this.masterGain!);
    return g;
  }

  /**
   * Soft, warm, muted flight-deck indicator pulse whenever bottom Airbus warnings are active.
   * Heavily low-passed (620-760 Hz) with rounded envelopes so it adds tactile cockpit awareness
   * without ever sounding shrill or fatiguing.
   */
  public playMutedAvionicsIndicatorBeep(isCritical: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = isCritical ? 740 : 580;
    lp.Q.value = 0.7;
    lp.connect(this.masterGain);

    if (isCritical) {
      // Muted dual-tone Airbus-style low chime (420 Hz -> 335 Hz)
      const notes = [
        { freq: 420, offset: 0, dur: 0.075 },
        { freq: 335, offset: 0.088, dur: 0.095 },
      ];
      for (const n of notes) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n.freq, now + n.offset);
        g.gain.setValueAtTime(0.0001, now + n.offset);
        g.gain.linearRampToValueAtTime(0.19, now + n.offset + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, now + n.offset + n.dur);
        osc.connect(g);
        g.connect(lp);
        osc.start(now + n.offset);
        osc.stop(now + n.offset + n.dur + 0.015);
      }
    } else {
      // Soft single muted amber caution pulse (330 Hz)
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.exponentialRampToValueAtTime(312, now + 0.11);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.14, now + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.115);
      osc.connect(g);
      g.connect(lp);
      osc.start(now);
      osc.stop(now + 0.13);
    }
  }

  public playButtonLatchLock(pitch = 0.94, volume = 0.95): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (this.buffers.has('button_latch_lock')) {
      this.playSfx('button_latch_lock', {
        pitch: pitch * (0.96 + Math.random() * 0.08),
        volume,
      });
    } else {
      this.playSfx('keypress_return', { pitch: pitch * 0.85, volume });
    }
  }

  /**
   * Dedicated ASMR dull, muted, cushioned PBT mechanical keyboard clack for scrolling text.
   * Alternates samples, trims leading silence, pitches down slightly for deep thock,
   * shapes a clean 115ms envelope, and routes through the 1080Hz dampened ASMR filter bus.
   */
  public playAsmrScrollClack(volume = 0.78): void {
    if (!this.ctx || !this.asmrKeyBus || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastKeyclickTime < 0.036) return;
    this.lastKeyclickTime = now;

    this.keyAltToggle = !this.keyAltToggle;
    const chosenId =
      this.keyAltToggle && this.buffers.has('ui_keyclick_alt')
        ? 'ui_keyclick_alt'
        : 'ui_keyclick';

    const buf = this.buffers.get(chosenId);
    const pitch = 0.76 + Math.random() * 0.18; // Lower pitch = deeper, duller, cushiony thock

    if (buf) {
      const onset = this.bufferOnsets.get(chosenId) ?? 0;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = pitch;

      const env = this.ctx.createGain();
      const dur = 0.125;
      env.gain.setValueAtTime(0.001, now);
      env.gain.linearRampToValueAtTime(0.95 * volume, now + 0.005);
      env.gain.exponentialRampToValueAtTime(0.001, now + dur);

      const pan = this.ctx.createStereoPanner();
      pan.pan.value = (Math.random() - 0.5) * 0.18;

      src.connect(env);
      env.connect(pan);
      pan.connect(this.asmrKeyBus);
      src.start(now, onset, dur + 0.03);
    } else {
      this.synthAsmrDullThock(now, pitch, volume);
    }
  }

  public playSfx(id: SfxId, options?: { pitch?: number; pan?: number; volume?: number }): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    if (id === 'ui_keyclick' || id === 'ui_keyclick_alt') {
      this.playAsmrScrollClack(options?.volume ?? 0.82);
      return;
    }

    const now = this.ctx.currentTime;
    if (id === 'proximity_klaxon') {
      if (now - this.lastKlaxonTime < 0.38) return;
      this.lastKlaxonTime = now;
    }

    const pitch = options?.pitch ?? 1.0;
    const pan = options?.pan ?? 0;
    const volume = options?.volume ?? 1.0;

    const lookupKey =
      id === 'ui_toggle_switch' && !this.buffers.has('ui_toggle_switch')
        ? 'keypress_return'
        : id;
    const loadedBuf = this.buffers.get(lookupKey);

    if (loadedBuf) {
      const onset = this.bufferOnsets.get(lookupKey) ?? 0;
      const src = this.ctx.createBufferSource();
      src.buffer = loadedBuf;
      src.playbackRate.value = pitch;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.74 * volume;

      if (pan !== 0) {
        const panner = this.ctx.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        src.connect(panner);
        panner.connect(gain);
      } else {
        src.connect(gain);
      }
      gain.connect(this.masterGain);
      // Start near transient onset for crisp response on snappy mechanical switches
      const startOffset =
        lookupKey === 'button_latch_lock' ||
        lookupKey === 'keypress_return' ||
        lookupKey === 'thruster_ignite' ||
        lookupKey === 'landing_hard_thud' ||
        lookupKey === 'landing_soft_mech'
          ? onset
          : 0;
      src.start(now, startOffset);
      return;
    }

    switch (id) {
      case 'homeade_computer_start':
        this.synthScreenPowerOn(now, volume);
        break;
      case 'nostromo_boot_sequence':
      case 'computer_telemetry_chirp':
      case 'tape_drive_servo':
        this.synth1979MainframeCascade(now, 5, volume * 0.4);
        break;
      case 'button_latch_lock':
      case 'keypress_return':
      case 'ui_toggle_switch':
        this.synthToggleSwitch(now, pitch * 0.8, volume);
        break;
      case 'thruster_ignite':
        this.synthLandingThud(now, 0.7, volume * 0.6);
        break;
      case 'emergency_thrust_pulse':
        this.synthHullExplosion(now, volume * 0.85);
        break;
      case 'computer_transition_dark':
      case 'computer_sector_engage':
      case 'computer_touchdown_confirm':
        this.synth1979MainframeCascade(now, 6, volume * 0.45);
        break;
      case 'lidar_ping':
        this.synthLidarPing(now, pitch, pan, volume);
        break;
      case 'alien_motion_ping':
        this.playAlienMotionTrackerPing(0.5, pan);
        break;
      case 'proximity_klaxon':
        this.synthProximityKlaxon(now, pitch, volume);
        break;
      case 'landing_soft_mech':
      case 'landing_hard_thud':
      case 'landing_strut_thud':
        this.synthLandingThud(now, pitch, volume);
        break;
      case 'hull_explosion':
        this.synthHullExplosion(now, volume);
        break;
      case 'sentry_pulse_burst':
        this.playPulseSentryBurst(pan, pitch > 1.05, volume);
        break;
      case 'sentry_ammo_tick':
        this.playAmmoCounterTick(0.5, volume);
        break;
      case 'sentry_dry_fire':
        this.playSentryDryFire(pan, volume);
        break;
      case 'incinerator_whoosh':
        this.playIncineratorWhoosh(pan, volume);
        break;
      case 'cryo_valve_hiss':
        this.playCryoVentHiss(pan, volume);
        break;
      case 'arc_welder_seal':
        this.playArcWelderSeal(pan, volume);
        break;
      case 'door_batter_thud':
        this.playDoorBatterThud(pan, volume);
        break;
      case 'armor_ricochet':
        this.playArmorRicochet(pan, volume);
        break;
      case 'acid_sizzle':
        this.playAcidCorrosionSizzle(pan, volume);
        break;
      case 'airlock_purge_roar':
        this.playAirlockDecompression(pan, volume);
        break;
      case 'bulkhead_breach_klaxon':
        this.playBulkheadBreachKlaxon(volume);
        break;
      case 'strobe_flare_pop':
        this.playStrobeFlareIgnite(pan, volume);
        break;
      case 'overclock_surge':
        this.playOverclockSurge(pan, volume);
        break;
      case 'turret_servo_whir':
        this.playTurretServoStep(pan, volume);
        break;
    }
  }

  public playVoiceCallout(id: VoiceCalloutId, force = false): void {
    if (!this.ctx || !this.intercomInput || this.muted) return;
    const now = this.ctx.currentTime;
    if (!force && now - this.lastVoiceTime < 2.2) return;
    this.lastVoiceTime = now;

    try {
      this.activeVoiceSource?.stop();
    } catch {
      /* ignore */
    }

    this.synthIntercomPreChime(now);

    const voiceBuf = this.buffers.get(id);
    if (voiceBuf) {
      const src = this.ctx.createBufferSource();
      src.buffer = voiceBuf;
      src.connect(this.intercomInput);
      src.start(now + 0.22);
      this.activeVoiceSource = src;
    } else {
      this.synthMuthurTelemetryCadence(now + 0.22, id);
    }
  }

  /**
   * Synthesizes muted 1979 ALIEN ("Mother" / Mn7A1vfs8m0) rhythmic analog mainframe
   * telemetry bleeps routed through the warm band-limited cockpit speaker chain.
   */
  private synth1979MainframeCascade(t: number, steps = 9, gainScale = 0.36): void {
    const ctx = this.ctx!;
    const dest = this.intercomInput ?? this.masterGain!;
    // Deep low-register baritone 1979 mainframe telemetry tones (146Hz - 329Hz)
    const registers = [164.8, 220.0, 246.9, 196.0, 293.7, 146.8, 261.6, 329.6];

    let cursor = t;
    for (let i = 0; i < steps; i++) {
      const dur = i % 3 === 2 ? 0.11 : 0.065;
      const gap = i % 4 === 3 ? 0.16 : 0.085;
      const freq = registers[(i * 3 + Math.floor(i / 2)) % registers.length];

      const osc = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, cursor);

      lp.type = 'lowpass';
      lp.frequency.value = 680;

      g.gain.setValueAtTime(0.0001, cursor);
      g.gain.linearRampToValueAtTime(0.11 * gainScale, cursor + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, cursor + dur);

      osc.connect(lp);
      lp.connect(g);
      g.connect(dest);

      osc.start(cursor);
      osc.stop(cursor + dur + 0.005);
      cursor += gap;
    }
  }

  /**
   * Warm, dull, muted PBT keycap bottom-out fallback synthesizer (zero bright click).
   */
  private synthAsmrDullThock(t: number, pitch: number, volume: number): void {
    const ctx = this.ctx!;
    // Low cushioned plastic housing thump (195Hz -> 58Hz)
    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(195 * pitch, t);
    body.frequency.exponentialRampToValueAtTime(56 * pitch, t + 0.038);

    bodyGain.gain.setValueAtTime(0.28 * volume, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.046);

    body.connect(bodyGain);
    bodyGain.connect(this.asmrKeyBus!);
    body.start(t);
    body.stop(t + 0.05);

    // Soft muted felt/PBT impact transient (filtered below 750Hz)
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 0.025);
    const nBuf = ctx.createBuffer(1, len, sr);
    const d = nBuf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.006));
    }
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = nBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 720 * pitch;
    const nGain = ctx.createGain();
    nGain.gain.value = 0.24 * volume;

    nSrc.connect(lp);
    lp.connect(nGain);
    nGain.connect(this.asmrKeyBus!);
    nSrc.start(t);
  }

  private synthScreenPowerOn(t: number, volume: number): void {
    const ctx = this.ctx!;
    this.synthToggleSwitch(t, 0.85, volume);
    const whine = ctx.createOscillator();
    const g = ctx.createGain();
    whine.type = 'sine';
    whine.frequency.setValueAtTime(1800, t + 0.05);
    whine.frequency.exponentialRampToValueAtTime(9800, t + 1.1);
    g.gain.setValueAtTime(0.0001, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.08 * volume, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    whine.connect(g);
    g.connect(this.masterGain!);
    whine.start(t + 0.05);
    whine.stop(t + 1.25);
  }

  private synthIntercomPreChime(t: number): void {
    const ctx = this.ctx!;
    const dest = this.intercomInput!;
    const freqs = [440, 554.37];
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const start = t + idx * 0.09;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.14, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.095);
      osc.connect(g);
      g.connect(dest);
      osc.start(start);
      osc.stop(start + 0.105);
    });
  }

  private synthMuthurTelemetryCadence(t: number, id: VoiceCalloutId): void {
    const ctx = this.ctx!;
    const dest = this.intercomInput!;
    const seed = id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const baseFreq = id === 'voice_hull_breach' ? 520 : id === 'voice_touchdown' ? 780 : 660;
    for (let i = 0; i < 6; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = baseFreq + ((seed + i * 37) % 5) * 75;
      const start = t + i * 0.055;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.11, start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.048);
      osc.connect(g);
      g.connect(dest);
      osc.start(start);
      osc.stop(start + 0.052);
    }
  }

  private synthToggleSwitch(t: number, pitch: number, volume: number): void {
    const ctx = this.ctx!;
    [0, 0.026].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const bp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime((i === 0 ? 1150 : 1550) * pitch, t + offset);
      osc.frequency.exponentialRampToValueAtTime(260, t + offset + 0.026);
      bp.type = 'bandpass';
      bp.frequency.value = 1200 * pitch;
      bp.Q.value = 1.6;
      g.gain.setValueAtTime(0.28 * volume, t + offset);
      g.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.03);
      osc.connect(bp);
      bp.connect(g);
      g.connect(this.masterGain!);
      osc.start(t + offset);
      osc.stop(t + offset + 0.034);
    });
  }

  private synthLidarPing(t: number, pitch: number, pan: number, volume: number): void {
    const ctx = this.ctx!;
    const carrier = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const env = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));

    const f0 = 1280 * pitch;
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(f0 * 1.03, t);
    carrier.frequency.exponentialRampToValueAtTime(f0, t + 0.045);
    carrier.frequency.exponentialRampToValueAtTime(f0 * 0.985, t + 1.35);

    mod.type = 'sine';
    mod.frequency.value = f0 * 2.41;
    modGain.gain.setValueAtTime(240, t);
    modGain.gain.exponentialRampToValueAtTime(4, t + 0.18);

    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.32 * volume, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.045 * volume, t + 0.28);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.45);

    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(env);
    env.connect(panner);
    panner.connect(this.masterGain!);

    mod.start(t);
    carrier.start(t);
    mod.stop(t + 1.5);
    carrier.stop(t + 1.5);
  }

  private synthProximityKlaxon(t: number, pitch: number, volume: number): void {
    const ctx = this.ctx!;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(880 * pitch, t);
    osc1.frequency.setValueAtTime(740 * pitch, t + 0.09);
    osc2.frequency.setValueAtTime(887 * pitch, t);
    osc2.frequency.setValueAtTime(746 * pitch, t + 0.09);

    lp.type = 'lowpass';
    lp.frequency.value = 2600;

    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22 * volume, t + 0.008);
    g.gain.setValueAtTime(0.22 * volume, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.21);

    osc1.connect(lp);
    osc2.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain!);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 0.22);
    osc2.stop(t + 0.22);
  }

  private synthLandingThud(t: number, pitch: number, volume: number): void {
    const ctx = this.ctx!;
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(125 * pitch, t);
    sub.frequency.exponentialRampToValueAtTime(34, t + 0.26);
    subGain.gain.setValueAtTime(0.55 * volume, t);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    sub.connect(subGain);
    subGain.connect(this.masterGain!);
    sub.start(t);
    sub.stop(t + 0.36);
  }

  private synthHullExplosion(t: number, volume: number): void {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const dur = 2.4;
    const len = Math.floor(sr * dur);
    const noiseBuf = ctx.createBuffer(1, len, sr);
    const d = noiseBuf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      brown = (brown + 0.05 * w) / 1.05;
      d[i] = Math.tanh(brown * 3.4 + w * 0.35);
    }
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2800, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 2.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.75 * volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    noiseSrc.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain!);
    noiseSrc.start(t);
  }

  // ===========================================================================
  // HADLEY'S PERIMETER // TACTICAL SENTRY DEFENSE PROCEDURAL AUDIO SUITE
  // Automatically uses decoded ElevenLabs manifest MP3s if present, with rich
  // tactile Web Audio synthesis right out of the box!
  // ===========================================================================

  /**
   * Pitch-accelerating M314 Motion Tracker ping scaling dynamically with closest
   * hostile distance to the Reactor Core / Sensor node.
   */
  public playPerimeterMotionPing(
    distanceMeters: number,
    maxRangeMeters = 28,
    pan = 0,
    closeSwarmCount = 1
  ): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const closeness = 1 - Math.max(0, Math.min(1, distanceMeters / Math.max(4, maxRangeMeters)));
    this.playAlienMotionTrackerPing(closeness, pan);
    // Swarm cluster double-chirp ("They're inside the perimeter!") when 5+ hostiles converge < 14m
    if (closeSwarmCount >= 5 && distanceMeters < 14) {
      const jitterPan = Math.max(-0.75, Math.min(0.75, pan + (Math.random() - 0.5) * 0.28));
      window.setTimeout(() => {
        if (!this.muted && this.ctx && this.ctx.state === 'running') {
          this.playAlienMotionTrackerPing(Math.min(1, closeness + 0.1), jitterPan);
        }
      }, 95);
    }
  }

  /**
   * AAA Cancel-and-Replace Last-Shot Rolling Echo Scheduler:
   * - While gunfire continues, any unstarted tail is silently canceled before sample 0 plays,
   *   so rapid bursts NEVER pile up volume and NEVER echo rhythmic "bap-bap-bap" gunfire chatter!
   * - The moment the final shot of a burst finishes, a transient-free 4.5s stereo multi-swell
   *   tunnel echo rolls cleanly down the colony corridors into silence.
   */
  private scheduleSentryBurstEndRoll(
    now: number,
    lastShotTime: number,
    pan: number,
    clampedDist: number,
    overclocked: boolean,
    volume: number
  ): void {
    if (!this.ctx || !this.sentryRollingTailBus || this.sentryRollingTailBuffers.length === 0) {
      return;
    }
    const ctx = this.ctx;
    this.sentryLastScheduledShotTime = Math.max(this.sentryLastScheduledShotTime, lastShotTime);

    // 1. Cancel unstarted tail OR smoothly fade out a previously rolling tail
    if (this.activeSentryTail) {
      const prev = this.activeSentryTail;
      this.activeSentryTail = null;
      if (now < prev.startTime) {
        try {
          prev.src.stop();
          prev.gain.disconnect();
        } catch {
          /* ignore */
        }
      } else {
        const gParam = prev.gain.gain;
        const curApprox =
          now < prev.rampEndTime
            ? prev.peakGain *
              Math.max(0, (now - prev.startTime) / Math.max(1e-4, prev.rampEndTime - prev.startTime))
            : prev.peakGain;
        const maybeCancelHold = gParam as AudioParam & {
          cancelAndHoldAtTime?: (cancelTime: number) => AudioParam;
        };
        if (typeof maybeCancelHold.cancelAndHoldAtTime === 'function') {
          maybeCancelHold.cancelAndHoldAtTime(now);
        } else {
          gParam.cancelScheduledValues(now);
          gParam.setValueAtTime(curApprox, now);
        }
        gParam.linearRampToValueAtTime(0, now + 0.065);
        try {
          prev.src.stop(now + 0.08);
        } catch {
          /* ignore */
        }
      }
    }

    // 2. Schedule fresh 4.5s stereo rolling corridor tail right after the final round's hallway slap
    this.sentryRollingTailCursor =
      (this.sentryRollingTailCursor + 1) % this.sentryRollingTailBuffers.length;
    const tailBuf = this.sentryRollingTailBuffers[this.sentryRollingTailCursor];

    const src = ctx.createBufferSource();
    src.buffer = tailBuf;
    src.playbackRate.value = 0.96 + Math.random() * 0.07;

    const tailPan = ctx.createStereoPanner();
    // Subtle opposite-corridor bounce while preserving wide stereo tunnel image
    tailPan.pan.value = Math.max(-0.4, Math.min(0.4, -pan * 0.32));

    const gain = ctx.createGain();
    const startTime = this.sentryLastScheduledShotTime + (overclocked ? 0.048 : 0.076);
    const rampEndTime = startTime + 0.09;
    const peakGain = (0.78 + clampedDist * 0.34) * volume;

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, rampEndTime);

    src.connect(tailPan);
    tailPan.connect(gain);
    gain.connect(this.sentryRollingTailBus);
    src.start(startTime);

    this.activeSentryTail = {
      src,
      gain,
      startTime,
      rampEndTime,
      peakGain,
    };
  }

  /**
   * Loud, clean, heavy UA 571-C / MG42 machine-gun burst booming inside an adjacent metallic
   * steel hallway heard through heavy bulkhead walls, followed by a transient-free ~4.5s
   * rolling corridor echo ONLY after the final round stops!
   * @param pan Stereo pan (-0.85 .. +0.85) from blueprint X coordinate
   * @param overclocked True when Overclock Power Bus doubles cyclic ROF
   * @param volume Burst gain scalar
   * @param distanceNorm 0.0 = right outside Med-Lab bulkhead, 1.0 = far outer corridor shaft
   */
  public playPulseSentryBurst(
    pan = 0,
    overclocked = false,
    volume = 1.0,
    distanceNorm = 0.45,
    tier: 1 | 2 | 3 = 1
  ): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Allow staggered multi-turret overlapping bursts (~40 bursts/s cap prevents 20-gun CPU spikes)
    if (now - this.lastPulseBurstTime < 0.022) return;
    this.lastPulseBurstTime = now;

    const ctx = this.ctx;
    const clampedDist = Math.max(0, Math.min(1, distanceNorm));
    const tierGain = tier === 3 ? 1.16 : tier === 2 ? 1.07 : 1.0;
    const tierRate = tier === 3 ? 0.89 : tier === 2 ? 0.95 : 1.0;

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.78, Math.min(0.78, pan));

    const directSend = ctx.createGain();
    directSend.gain.value = (0.88 - clampedDist * 0.18) * volume * tierGain;

    const warehouseWetSend = ctx.createGain();
    warehouseWetSend.gain.value = (0.44 + clampedDist * 0.24) * volume * tierGain;

    panner.connect(directSend);
    panner.connect(warehouseWetSend);

    if (this.sentryDirectWallInput && this.sentryWarehouseWetInput) {
      directSend.connect(this.sentryDirectWallInput);
      warehouseWetSend.connect(this.sentryWarehouseWetInput);
    } else {
      directSend.connect(this.masterGain);
    }

    if (this.sentryRoundBuffers.length === 0) return;

    // Schedule 2 heavy cyclic 10mm/MG42 shells spaced across the burst window (~1,300 RPM cyclic roar!)
    const roundCount = 2;
    const baseSpacing = overclocked ? 0.024 : 0.044;
    let latestShotTime = now;
    for (let r = 0; r < roundCount; r++) {
      const boltJitter = r === 0 ? Math.random() * 0.002 : (Math.random() - 0.5) * 0.004;
      const shotTime = now + Math.max(0, r * baseSpacing + boltJitter);
      if (shotTime > latestShotTime) latestShotTime = shotTime;

      // Cycle across all 8 distinct physical gunshot buffers so consecutive shots never comb-filter
      this.sentryRoundCursor =
        (this.sentryRoundCursor + 1 + (Math.random() < 0.35 ? 1 : 0)) %
        this.sentryRoundBuffers.length;
      const roundBuf = this.sentryRoundBuffers[this.sentryRoundCursor];

      const src = ctx.createBufferSource();
      src.buffer = roundBuf;
      src.playbackRate.value =
        (overclocked ? 1.04 : 0.93) * tierRate * (0.97 + Math.random() * 0.06);

      const shotGain = ctx.createGain();
      shotGain.gain.value = r === 0 ? 1.0 : 0.94 + Math.random() * 0.06;

      src.connect(shotGain);
      shotGain.connect(panner);
      src.start(shotTime);
    }

    this.scheduleSentryBurstEndRoll(now, latestShotTime, pan, clampedDist, overclocked, volume * tierGain);
  }

  /**
   * Subtle CRT low-ammo warning pip on the operator's console — only sounds when drum
   * drops below 25% so normal bursts stay 100% pure, un-cluttered cinema gunfire.
   */
  public playAmmoCounterTick(ammoRatio: number, volume = 0.4): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (ammoRatio > 0.25) return;
    const now = this.ctx.currentTime;
    if (now - this.lastAmmoTickTime < 0.18) return;
    this.lastAmmoTickTime = now;

    // Slightly duck console low-ammo pip when heavy multi-sentry gunfire is firing simultaneously
    const underFireDuck = now - this.lastPulseBurstTime < 0.085 ? 0.72 : 1.0;

    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const f = 1520 + (0.25 - ammoRatio) * 1400;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, now);
    osc.frequency.exponentialRampToValueAtTime(f * 0.82, now + 0.024);

    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.052 * volume * underFireDuck, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);

    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.032);
  }

  /**
   * Hollow dry-fire metallic bolt clatter at 000 RDS echoing inside the adjacent steel corridor.
   */
  public playSentryDryFire(pan = 0, volume = 0.9): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastDryFireTime < 0.22) return;
    this.lastDryFireTime = now;

    const ctx = this.ctx;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.8, Math.min(0.8, pan));

    if (this.sentryDirectWallInput && this.sentryWarehouseWetInput) {
      const drySend = ctx.createGain();
      drySend.gain.value = 0.85;
      const wetSend = ctx.createGain();
      wetSend.gain.value = 0.55;
      panner.connect(drySend);
      panner.connect(wetSend);
      drySend.connect(this.sentryDirectWallInput);
      wetSend.connect(this.sentryWarehouseWetInput);
    } else {
      panner.connect(this.masterGain);
    }

    [0, 0.044].forEach((off, idx) => {
      const osc = ctx.createOscillator();
      const bp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(idx === 0 ? 780 : 540, now + off);
      osc.frequency.exponentialRampToValueAtTime(155, now + off + 0.032);
      bp.type = 'bandpass';
      bp.frequency.value = idx === 0 ? 1180 : 880;
      bp.Q.value = 2.2;
      g.gain.setValueAtTime(0.32 * volume, now + off);
      g.gain.exponentialRampToValueAtTime(0.0001, now + off + 0.038);
      osc.connect(bp);
      bp.connect(g);
      g.connect(panner);
      osc.start(now + off);
      osc.stop(now + off + 0.042);
    });
  }

  /**
   * Barely-hearable, ultra-high-quality muffled M240 Incinerator liquid-napalm ignition
   * whoosh heard through thick steel colony bulkheads (zero harsh static or un-muffled hiss!).
   */
  public playIncineratorWhoosh(pan = 0, distanceNorm = 0.45, volume = 1.0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastIncineratorTime < 0.28) return;
    this.lastIncineratorTime = now;

    const ctx = this.ctx;
    const clampedDist = Math.max(0, Math.min(1, distanceNorm));
    const dest = this.napalmBulkheadInput ?? this.masterGain;

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.78, Math.min(0.78, pan));

    // Whisper-subtle (-22 dBFS), warm muffled thermal pressure pulse behind heavy steel walls
    const peakGain = (0.115 - clampedDist * 0.035) * volume;
    const env = ctx.createGain();
    panner.connect(env);
    env.connect(dest);

    const flameBuf =
      this.buffers.get('incinerator_whoosh') ?? this.buffers.get('thruster_ignite');
    if (flameBuf) {
      const onset = this.bufferOnsets.get('incinerator_whoosh') ?? 0;
      const src = ctx.createBufferSource();
      src.buffer = flameBuf;
      const rate = 0.84 + Math.random() * 0.16;
      src.playbackRate.value = rate;
      const playDur = Math.min(1.45, (flameBuf.duration - onset) / rate);

      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(peakGain, now + 0.038);
      env.gain.setValueAtTime(peakGain * 0.92, now + Math.max(0.08, playDur * 0.45));
      env.gain.linearRampToValueAtTime(0, now + playDur);

      src.connect(panner);
      src.start(now, onset, playDur + 0.05);
      return;
    }

    // Silky procedural deep brown-combustion fallback (if MP3 still decoding)
    const sr = ctx.sampleRate;
    const dur = 0.72;
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let brown = 0;
    let lp = 0;
    const alpha = 1 - Math.exp((-2 * Math.PI * 380) / sr);
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      brown = (brown + 0.045 * w) / 1.045;
      lp += alpha * (brown * 2.2 - lp);
      d[i] = lp;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peakGain, now + 0.055);
    env.gain.linearRampToValueAtTime(0, now + dur);

    src.connect(panner);
    src.start(now);
  }

  /**
   * Non-repetitive 1986 Aliens Xenomorph screeching, hissing, and siege chaos outside the
   * Med-Lab bulkheads:
   * - Cycles through 8 distinct HD organic vocalizations using a 5-clip anti-repeat shuffle queue
   * - Applies species-specific vocal-tract pitch & throat-formant shifting + micro-offset slicing
   * - Spatializes into the corridor via distance-coupled bulkhead muffling + metallic hallway reverb
   * - Strictly gain-staged ~10–14 dB quieter than UA 571-C sentry gunfire (plus gunfire ducking).
   */
  public playXenomorphScreech(
    context: XenomorphScreechContext,
    species: XenomorphScreechSpecies,
    pan = 0,
    distanceNorm = 0.5,
    volume = 1.0
  ): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // Prune finished overlapping screeches and enforce clean 3-voice chaotic polyphony cap
    this.activeScreechEndTimes = this.activeScreechEndTimes.filter((t) => t > now);
    if (this.activeScreechEndTimes.length >= 3) return;
    if (now - this.lastScreechTime < 0.15) return;
    this.lastScreechTime = now;

    const ctx = this.ctx;
    const clampedDist = Math.max(0, Math.min(1, distanceNorm));

    // Context & species loudness scaling — ALWAYS clearly quieter than sentry gunfire!
    const contextMult =
      context === 'DEATH'
        ? 1.04
        : context === 'BURNING'
          ? 0.98
          : context === 'HIT'
            ? 0.9
            : context === 'DOOR_CLAW'
              ? 0.86
              : 0.78;
    const speciesMult = species === 'PRAETORIAN' ? 1.12 : species === 'SKITTERER' ? 0.86 : 1.0;
    // Duck screeches slightly whenever sentry gunfire is actively roaring so guns always dominate
    const gunActiveDuck = now - this.lastPulseBurstTime < 0.16 ? 0.74 : 1.0;
    const targetPeak =
      (0.205 - clampedDist * 0.085) * contextMult * speciesMult * gunActiveDuck * volume;

    // Species-specific vocal-tract playbackRate & formant center
    let rate = 1.0;
    let formantHz = 1220;
    switch (species) {
      case 'SKITTERER':
        rate = 1.12 + Math.random() * 0.22;
        formantHz = 1480 + Math.random() * 340;
        break;
      case 'QUEEN':
        rate = 0.62 + Math.random() * 0.1;
        formantHz = 620 + Math.random() * 160;
        break;
      case 'CRUSHER':
      case 'PRAETORIAN':
        rate = 0.72 + Math.random() * 0.14;
        formantHz = 760 + Math.random() * 210;
        break;
      case 'SCREAMER':
        rate = 1.18 + Math.random() * 0.24;
        formantHz = 1650 + Math.random() * 360;
        break;
      case 'STALKER':
        rate = 0.94 + Math.random() * 0.22;
        formantHz = 1280 + Math.random() * 320;
        break;
      case 'SPITTER':
      case 'BURSTER':
        rate = 0.88 + Math.random() * 0.18;
        formantHz = 980 + Math.random() * 260;
        break;
      case 'DRONE':
      default:
        rate = 0.9 + Math.random() * 0.22;
        formantHz = 1140 + Math.random() * 300;
        break;
    }

    // Distance-coupled bulkhead occlusion + hallway reverb chain (lives outside in the steel corridor!)
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = species === 'PRAETORIAN' ? 145 : 215;
    hp.Q.value = 0.7;

    const formant = ctx.createBiquadFilter();
    formant.type = 'peaking';
    formant.frequency.value = formantHz;
    formant.Q.value = 1.35;
    formant.gain.value = 2.4;

    const wallCutoff = 2050 - clampedDist * 920;
    const wallLp1 = ctx.createBiquadFilter();
    wallLp1.type = 'lowpass';
    wallLp1.frequency.value = wallCutoff;
    wallLp1.Q.value = 0.7;

    const wallLp2 = ctx.createBiquadFilter();
    wallLp2.type = 'lowpass';
    wallLp2.frequency.value = wallCutoff * 1.32;
    wallLp2.Q.value = 0.62;

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.82, Math.min(0.82, pan + (Math.random() - 0.5) * 0.12));

    const env = ctx.createGain();
    hp.connect(formant);
    formant.connect(wallLp1);
    wallLp1.connect(wallLp2);
    wallLp2.connect(panner);
    panner.connect(env);
    env.connect(this.masterGain);

    if (this.sentryWarehouseWetInput) {
      const hallSend = ctx.createGain();
      hallSend.gain.value = 0.56 + clampedDist * 0.3;
      env.connect(hallSend);
      hallSend.connect(this.sentryWarehouseWetInput);
    }

    // Candidate pool prioritized by context & species, strictly filtered by 5-clip anti-repeat history
    const allIds = [
      'alien_screech_01',
      'alien_screech_02',
      'alien_screech_03',
      'alien_screech_04',
      'alien_screech_05',
      'alien_screech_06',
      'alien_screech_07',
      'alien_screech_08',
    ].filter((id) => this.buffers.has(id));

    if (allIds.length > 0) {
      let preferred: string[];
      if (species === 'PRAETORIAN') {
        preferred = ['alien_screech_06', 'alien_screech_05', 'alien_screech_04', 'alien_screech_07'];
      } else if (species === 'SKITTERER') {
        preferred = ['alien_screech_03', 'alien_screech_08', 'alien_screech_02', 'alien_screech_07'];
      } else if (context === 'DEATH' || context === 'BURNING') {
        preferred = ['alien_screech_04', 'alien_screech_02', 'alien_screech_07', 'alien_screech_01'];
      } else if (context === 'SWARM') {
        preferred = ['alien_screech_07', 'alien_screech_03', 'alien_screech_05', 'alien_screech_08', 'alien_screech_01'];
      } else {
        preferred = allIds;
      }

      const freshPreferred = preferred.filter(
        (id) => this.buffers.has(id) && !this.recentScreechIds.includes(id)
      );
      const freshAny = allIds.filter((id) => !this.recentScreechIds.includes(id));
      const pool =
        freshPreferred.length > 0 ? freshPreferred : freshAny.length > 0 ? freshAny : allIds;

      const chosenId = pool[Math.floor(Math.random() * pool.length)]!;
      this.recentScreechIds.push(chosenId);
      if (this.recentScreechIds.length > 5) {
        this.recentScreechIds.shift();
      }

      const buf = this.buffers.get(chosenId)!;
      const baseOnset = this.bufferOnsets.get(chosenId) ?? 0;
      const extraSlice =
        chosenId === 'alien_screech_03' || chosenId === 'alien_screech_07'
          ? Math.random() * Math.min(0.22, buf.duration * 0.15)
          : Math.random() * 0.03;
      const startOffset = Math.min(buf.duration * 0.4, baseOnset + extraSlice);
      const availDur = Math.max(0.25, (buf.duration - startOffset) / rate);
      const playDur = availDur * (0.76 + Math.random() * 0.24);

      const attackSec = 0.016 + Math.random() * 0.028;
      const releaseSec = Math.min(0.16, playDur * 0.32);

      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(targetPeak, now + attackSec);
      env.gain.setValueAtTime(targetPeak * 0.9, now + Math.max(attackSec + 0.02, playDur - releaseSec));
      env.gain.linearRampToValueAtTime(0, now + playDur);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      src.connect(hp);
      src.start(now, startOffset, playDur + 0.04);

      this.activeScreechEndTimes.push(now + playDur * 0.82);
      return;
    }

    // Procedural FM + vocal-formant shriek fallback if MP3s are still decoding
    this.synthProceduralXenomorphScreech(ctx, hp, env, now, rate, targetPeak, context === 'DEATH');
    this.activeScreechEndTimes.push(now + 0.55);
  }

  private synthProceduralXenomorphScreech(
    ctx: AudioContext,
    dest: AudioNode,
    env: GainNode,
    now: number,
    rate: number,
    peakGain: number,
    descending: boolean
  ): void {
    const dur = 0.55 + Math.random() * 0.35;
    const carrier = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();

    const baseF = (descending ? 1420 : 1180) * rate;
    carrier.type = 'sawtooth';
    carrier.frequency.setValueAtTime(baseF * 0.85, now);
    carrier.frequency.exponentialRampToValueAtTime(baseF * 1.24, now + dur * 0.22);
    carrier.frequency.exponentialRampToValueAtTime(
      descending ? baseF * 0.52 : baseF * 0.88,
      now + dur
    );

    mod.type = 'sine';
    mod.frequency.setValueAtTime(58 + Math.random() * 34, now);
    modGain.gain.setValueAtTime(260 * rate, now);

    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peakGain * 0.65, now + 0.03);
    env.gain.linearRampToValueAtTime(0, now + dur);

    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(dest);

    mod.start(now);
    carrier.start(now);
    mod.stop(now + dur + 0.03);
    carrier.stop(now + dur + 0.03);
  }

  /**
   * Helper: Plays a spatialized HD Perimeter corridor foley clip coupled cleanly into the
   * metallic hallway reverb bus (`sentryWarehouseWetInput`) so every station sound lives in one acoustic space.
   */
  private playCorridorBuffer(
    assetId: string,
    pan: number,
    gainVal: number,
    rate: number,
    wetSendVal = 0.42,
    lowpassHz = 4200
  ): boolean {
    if (!this.ctx || !this.masterGain || this.muted) return false;
    const buf = this.buffers.get(assetId);
    if (!buf) return false;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const onset = this.bufferOnsets.get(assetId) ?? 0;

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.82, Math.min(0.82, pan));

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = lowpassHz;
    lp.Q.value = 0.68;

    const g = ctx.createGain();
    g.gain.value = gainVal;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;

    src.connect(lp);
    lp.connect(g);
    g.connect(panner);
    panner.connect(this.masterGain);

    if (this.sentryWarehouseWetInput && wetSendVal > 0.01) {
      const wet = ctx.createGain();
      wet.gain.value = wetSendVal;
      panner.connect(wet);
      wet.connect(this.sentryWarehouseWetInput);
    }

    src.start(now, onset);
    return true;
  }

  /**
   * Cryo-Stasis Valve liquid-nitrogen pressurized hiss (HD ElevenLabs foley + corridor reverb).
   */
  public playCryoVentHiss(pan = 0, volume = 0.78): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastCryoHissTime < 0.45) return;
    this.lastCryoHissTime = now;

    if (
      this.playCorridorBuffer(
        'perim_cryo_blast',
        pan,
        0.46 * volume,
        0.95 + Math.random() * 0.1,
        0.45,
        3800
      )
    ) {
      return;
    }

    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const dur = 0.55;
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.65;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3400, now);
    bp.frequency.exponentialRampToValueAtTime(1650, now + dur);
    bp.Q.value = 1.6;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(0.24 * volume, now + 0.025);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));

    src.connect(bp);
    bp.connect(env);
    env.connect(panner);
    panner.connect(this.masterGain);
    src.start(now);
  }

  /**
   * Arc-Welder electrical sizzle + heavy steel bulkhead clang (HD ElevenLabs foley).
   */
  public playArcWelderSeal(pan = 0, volume = 0.9): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (
      this.playCorridorBuffer(
        'perim_arc_weld',
        pan,
        0.64 * volume,
        0.96 + Math.random() * 0.08,
        0.42,
        4600
      )
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    const ctx = this.ctx;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));
    panner.connect(this.masterGain);

    // 1. Heavy steel blast door slam clang
    this.synthLandingThud(now, 0.92, volume * 0.78);
    this.playButtonLatchLock(0.76, volume * 0.85);

    // 2. Electric welding arc 120Hz buzz + high-voltage crackle sizzle
    const dur = 0.52;
    const buzz = ctx.createOscillator();
    const buzzBp = ctx.createBiquadFilter();
    const buzzG = ctx.createGain();
    buzz.type = 'sawtooth';
    buzz.frequency.setValueAtTime(118, now + 0.05);
    buzz.frequency.linearRampToValueAtTime(132, now + dur);

    buzzBp.type = 'bandpass';
    buzzBp.frequency.value = 1480;
    buzzBp.Q.value = 1.9;

    buzzG.gain.setValueAtTime(0.0001, now + 0.05);
    buzzG.gain.linearRampToValueAtTime(0.20 * volume, now + 0.08);
    buzzG.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    buzz.connect(buzzBp);
    buzzBp.connect(buzzG);
    buzzG.connect(panner);
    buzz.start(now + 0.05);
    buzz.stop(now + dur + 0.02);

    const sr = ctx.sampleRate;
    const nLen = Math.floor(sr * 0.44);
    const nBuf = ctx.createBuffer(1, nLen, sr);
    const nd = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) {
      const gate = Math.random() > 0.35 ? 1 : 0.15;
      nd[i] = (Math.random() * 2 - 1) * gate * Math.exp(-i / (sr * 0.24));
    }
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = nBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2100;
    const nG = ctx.createGain();
    nG.gain.value = 0.18 * volume;
    nSrc.connect(hp);
    hp.connect(nG);
    nG.connect(panner);
    nSrc.start(now + 0.05);
  }

  /**
   * Heavy metallic hull-thud when hostiles batter a welded blast door (HD ElevenLabs foley + hallway reverb).
   */
  public playDoorBatterThud(pan = 0, volume = 0.85): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastDoorThudTime < 0.24) return;
    this.lastDoorThudTime = now;

    if (
      this.playCorridorBuffer(
        'perim_door_batter',
        pan,
        0.58 * volume,
        0.92 + Math.random() * 0.16,
        0.58,
        2800
      )
    ) {
      return;
    }

    const ctx = this.ctx;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));
    panner.connect(this.masterGain);
    if (this.sentryWarehouseWetInput) {
      const wet = ctx.createGain();
      wet.gain.value = 0.55;
      panner.connect(wet);
      wet.connect(this.sentryWarehouseWetInput);
    }

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(138 + Math.random() * 24, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.21);
    g.gain.setValueAtTime(0.46 * volume, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(g);
    g.connect(panner);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  /**
   * Metallic frontal carapace armor ricochet ping echoing inside the adjacent steel corridor.
   */
  public playArmorRicochet(pan = 0, volume = 0.78): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastRicochetTime < 0.2) return;
    this.lastRicochetTime = now;

    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));

    const fStart = 2150 + Math.random() * 750;
    const fEnd = 780 + Math.random() * 420;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(fStart, now);
    osc.frequency.exponentialRampToValueAtTime(fEnd, now + 0.09);

    // Slight bulkhead muffling + warehouse reverb send so ricochets live inside the same room as the sentry!
    lp.type = 'lowpass';
    lp.frequency.value = 2300;

    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.19 * volume, now + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

    osc.connect(lp);
    lp.connect(g);
    g.connect(panner);
    panner.connect(this.masterGain);
    if (this.sentryWarehouseWetInput) {
      const wet = ctx.createGain();
      wet.gain.value = 0.65;
      panner.connect(wet);
      wet.connect(this.sentryWarehouseWetInput);
    }
    osc.start(now);
    osc.stop(now + 0.13);
  }

  /**
   * Corrosive molecular acid pool sizzle & detonation pop (HD ElevenLabs foley).
   */
  public playAcidCorrosionSizzle(pan = 0, volume = 0.78): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastAcidSizzleTime < 0.28) return;
    this.lastAcidSizzleTime = now;

    if (
      this.playCorridorBuffer(
        'perim_acid_sizzle',
        pan,
        0.48 * volume,
        0.94 + Math.random() * 0.14,
        0.38,
        3600
      )
    ) {
      return;
    }

    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const dur = 0.42;
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const bubble = 0.65 + 0.35 * Math.sin(i * 0.045);
      d[i] = (Math.random() * 2 - 1) * bubble * Math.exp(-i / (sr * 0.26));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2650, now);
    bp.frequency.exponentialRampToValueAtTime(1450, now + dur);
    bp.Q.value = 2.8;

    const g = ctx.createGain();
    g.gain.value = 0.28 * volume;

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));

    src.connect(bp);
    bp.connect(g);
    g.connect(panner);
    panner.connect(this.masterGain);
    src.start(now);
  }

  /**
   * Emergency Airlock Vent Purge violent decompression roar (HD ElevenLabs foley + corridor reverb).
   */
  public playAirlockDecompression(pan = 0, volume = 0.95): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (
      this.playCorridorBuffer('perim_airlock_purge', pan, 0.88 * volume, 0.98, 0.55, 4200)
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    const ctx = this.ctx;

    this.playButtonLatchLock(0.68, volume);
    const sr = ctx.sampleRate;
    const dur = 1.45;
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      brown = (brown + 0.048 * w) / 1.048;
      d[i] = Math.tanh(brown * 3.0 + w * 0.42);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(2900, now);
    bp.frequency.exponentialRampToValueAtTime(240, now + dur);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(0.68 * volume, now + 0.04);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));

    src.connect(bp);
    bp.connect(env);
    env.connect(panner);
    panner.connect(this.masterGain);
    src.start(now);
  }

  /**
   * Deep, resonant shipboard containment system alert when an alien breaches the Reactor Core.
   */
  public playBulkheadBreachKlaxon(volume = 0.98): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const ctx = this.ctx;

    // Warm low-shelf + resonant chamber bus so the system alert sits deep and authoritative
    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 160;
    lowShelf.gain.value = 4.5;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3400;
    lp.Q.value = 0.85;

    const outGain = ctx.createGain();
    outGain.gain.value = 1.08 * volume;

    lowShelf.connect(lp);
    lp.connect(outGain);
    outGain.connect(this.masterGain);

    if (this.sentryWarehouseWetInput) {
      const hallSend = ctx.createGain();
      hallSend.gain.value = 0.44;
      outGain.connect(hallSend);
      hallSend.connect(this.sentryWarehouseWetInput);
    }

    if (this.buffers.has('core_breach_alert')) {
      const buf = this.buffers.get('core_breach_alert')!;
      const onset = this.bufferOnsets.get('core_breach_alert') ?? 0;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(lowShelf);
      src.start(now, onset);

      // Subtle sub-bass hull resonance reinforcement under the ElevenLabs alert
      const sub = ctx.createOscillator();
      const subGain = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(76, now);
      sub.frequency.exponentialRampToValueAtTime(64, now + 1.8);
      subGain.gain.setValueAtTime(0.0001, now);
      subGain.gain.linearRampToValueAtTime(0.18 * volume, now + 0.08);
      subGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.9);
      sub.connect(subGain);
      subGain.connect(this.masterGain);
      sub.start(now);
      sub.stop(now + 1.95);
      return;
    }

    // Procedural fallback: deep resonant two-pulse baritone shipboard containment alert
    const pulseStarts = [0.0, 1.08];
    for (const off of pulseStarts) {
      const t0 = now + off;
      const freqs = [110, 165, 220];
      const amps = [0.34, 0.22, 0.12];
      freqs.forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const filt = ctx.createBiquadFilter();
        const env = ctx.createGain();
        osc.type = idx === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(f, t0);
        osc.frequency.exponentialRampToValueAtTime(f * 0.94, t0 + 0.92);
        filt.type = 'lowpass';
        filt.frequency.value = 540;
        filt.Q.value = 2.2;
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.linearRampToValueAtTime(amps[idx], t0 + 0.045);
        env.gain.setValueAtTime(amps[idx] * 0.85, t0 + 0.36);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.96);
        osc.connect(filt);
        filt.connect(env);
        env.connect(lowShelf);
        osc.start(t0);
        osc.stop(t0 + 1.0);
      });
    }
  }

  /**
   * M40 Strobe Flare pyrotechnic pop & magnesium hiss (HD ElevenLabs foley).
   */
  public playStrobeFlareIgnite(pan = 0, volume = 0.82): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (
      this.playCorridorBuffer(
        'perim_flare_ignite',
        pan,
        0.6 * volume,
        0.96 + Math.random() * 0.08,
        0.4,
        4600
      )
    ) {
      return;
    }
    const now = this.ctx.currentTime;
    const ctx = this.ctx;
    this.synthToggleSwitch(now, 1.35, volume * 0.9);

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1650, now + 0.02);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.24);
    g.gain.setValueAtTime(0.22 * volume, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    osc.connect(g);
    g.connect(panner);
    panner.connect(this.masterGain);
    osc.start(now + 0.02);
    osc.stop(now + 0.28);
  }

  /**
   * Overclock Power Bus capacitor surge hum (HD ElevenLabs foley).
   */
  public playOverclockSurge(pan = 0, volume = 0.85): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (this.playCorridorBuffer('perim_overclock_surge', pan, 0.72 * volume, 1.0, 0.28, 4200)) {
      return;
    }
    const now = this.ctx.currentTime;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.36);
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.26 * volume, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

    osc.connect(lp);
    lp.connect(g);
    g.connect(panner);
    panner.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.45);
  }

  /**
   * Mechanical turret servo rotation step whir.
   */
  public playTurretServoStep(pan = 0, volume = 0.65): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastServoWhirTime < 0.14) return;
    this.lastServoWhirTime = now;

    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.linearRampToValueAtTime(265, now + 0.09);
    lp.type = 'bandpass';
    lp.frequency.value = 540;
    lp.Q.value = 2.0;
    g.gain.setValueAtTime(0.11 * volume, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

    osc.connect(lp);
    lp.connect(g);
    g.connect(panner);
    panner.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  /**
   * Authentic 1979/1986 Weyland-Yutani Console Low-Ammo / Drum-Dry Alert Chime:
   * - Low Ammo (<=25%): Crisp 3-tone amber avionics caution bell (D6 -> A5 -> D6)
   * - Drum Dry (000): Urgent descending 3-tone red alert chime (G6 -> C6 -> G5)
   */
  public playLowAmmoAlertChime(pan = 0, isCriticalEmpty = false, volume = 0.85): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastLowAmmoChimeTime < 0.65) return;
    this.lastLowAmmoChimeTime = now;

    const ctx = this.ctx;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.55, Math.min(0.55, pan * 0.5));

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2650;
    lp.Q.value = 0.8;
    lp.connect(panner);
    panner.connect(this.masterGain);

    const notes = isCriticalEmpty
      ? [
          { f: 1567.98, off: 0.0, dur: 0.12 },
          { f: 1046.5, off: 0.095, dur: 0.12 },
          { f: 783.99, off: 0.19, dur: 0.22 },
        ]
      : [
          { f: 1174.66, off: 0.0, dur: 0.13 },
          { f: 880.0, off: 0.095, dur: 0.13 },
          { f: 1174.66, off: 0.19, dur: 0.22 },
        ];

    for (const n of notes) {
      const t0 = now + n.off;
      const oscMain = ctx.createOscillator();
      const oscSub = ctx.createOscillator();
      const g = ctx.createGain();
      const subMix = ctx.createGain();

      oscMain.type = 'triangle';
      oscMain.frequency.setValueAtTime(n.f, t0);
      oscSub.type = 'sine';
      oscSub.frequency.setValueAtTime(n.f * 2, t0);
      subMix.gain.value = 0.22;

      const peak = (isCriticalEmpty ? 0.19 : 0.16) * volume;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peak, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);

      oscMain.connect(g);
      oscSub.connect(subMix);
      subMix.connect(g);
      g.connect(lp);

      oscMain.start(t0);
      oscSub.start(t0);
      oscMain.stop(t0 + n.dur + 0.02);
      oscSub.stop(t0 + n.dur + 0.02);
    }
  }

  /**
   * Heavy machine-gun re-arm foley: clanging brass/steel ammo belt chain links feeding into
   * the receiver tray, top cover slamming shut, and heavy charging bolt racking & locking!
   */
  public playSentryRearmBeltLock(pan = 0, volume = 1.0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const ctx = this.ctx;

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.78, Math.min(0.78, pan));

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6800;
    lp.Q.value = 0.7;

    const g = ctx.createGain();
    g.gain.value = 1.18 * volume;

    panner.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain);

    if (this.sentryWarehouseWetInput) {
      const hallSend = ctx.createGain();
      hallSend.gain.value = 0.38;
      g.connect(hallSend);
      hallSend.connect(this.sentryWarehouseWetInput);
    }

    if (this.buffers.has('sentry_rearm_belt')) {
      const buf = this.buffers.get('sentry_rearm_belt')!;
      const onset = this.bufferOnsets.get('sentry_rearm_belt') ?? 0;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.98 + Math.random() * 0.04;
      src.connect(panner);
      src.start(now, onset);
      return;
    }

    // Procedural fallback: 5 metallic belt-link clangs -> feed tray slam -> charging bolt rack-lock!
    const linkTimes = [0.0, 0.048, 0.094, 0.145, 0.195];
    linkTimes.forEach((off, idx) => {
      const t0 = now + off;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const bp = ctx.createBiquadFilter();
      const lg = ctx.createGain();

      const fBase = 1650 + ((idx * 310) % 720);
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(fBase, t0);
      osc2.type = 'square';
      osc2.frequency.setValueAtTime(fBase * 1.47, t0);

      bp.type = 'bandpass';
      bp.frequency.value = fBase * 1.15;
      bp.Q.value = 3.2;

      lg.gain.setValueAtTime(0.0001, t0);
      lg.gain.linearRampToValueAtTime(0.24, t0 + 0.002);
      lg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.055);

      osc1.connect(bp);
      osc2.connect(bp);
      bp.connect(lg);
      lg.connect(panner);
      osc1.start(t0);
      osc2.start(t0);
      osc1.stop(t0 + 0.065);
      osc2.stop(t0 + 0.065);
    });

    // Heavy feed-tray cover slam (0.28s) + twin bolt rack-and-lock clacks (0.42s & 0.54s)
    const clacks = [
      { off: 0.28, fStart: 420, fEnd: 110, dur: 0.09, amp: 0.52 },
      { off: 0.42, fStart: 920, fEnd: 280, dur: 0.06, amp: 0.38 },
      { off: 0.53, fStart: 1240, fEnd: 340, dur: 0.075, amp: 0.46 },
    ];
    for (const c of clacks) {
      const t0 = now + c.off;
      const osc = ctx.createOscillator();
      const cg = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(c.fStart, t0);
      osc.frequency.exponentialRampToValueAtTime(c.fEnd, t0 + c.dur);
      cg.gain.setValueAtTime(0.0001, t0);
      cg.gain.linearRampToValueAtTime(c.amp, t0 + 0.003);
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + c.dur);
      osc.connect(cg);
      cg.connect(panner);
      osc.start(t0);
      osc.stop(t0 + c.dur + 0.02);
    }
  }

  /**
   * Subtle initial tripod touch-down thud when clicking down to anchor & drag-aim a weapon cone.
   */
  public playTurretTripodTouchdown(pan = 0, volume = 0.65): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const ctx = this.ctx;

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.78, Math.min(0.78, pan));

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(165, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.075);

    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.24 * volume, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);

    osc.connect(g);
    g.connect(panner);
    panner.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.095);
  }

  /**
   * Heavy tripod machine-gun & tactical ordnance emplacement foley when locking a weapon
   * or sensor unit onto a colony corridor tile!
   */
  public playWeaponDeployEmplace(
    kind: 'SENTRY_PULSE' | 'INCINERATOR' | 'RAIL_LANCE' | 'CRYO_VALVE' | 'SHOCK_COIL' | 'MOTION_RELAY',
    pan = 0,
    volume = 0.92
  ): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const ctx = this.ctx;

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.78, Math.min(0.78, pan));

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    lp.Q.value = 0.72;

    const g = ctx.createGain();
    g.gain.value = 0.60 * volume;

    panner.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain);

    if (this.sentryWarehouseWetInput) {
      const hallSend = ctx.createGain();
      hallSend.gain.value = 0.36;
      g.connect(hallSend);
      hallSend.connect(this.sentryWarehouseWetInput);
    }

    const isHeavyGun = kind === 'SENTRY_PULSE' || kind === 'INCINERATOR' || kind === 'RAIL_LANCE';
    const assetId = isHeavyGun ? 'sentry_deploy_tripod' : 'hardware_deploy_mount';
    const fallbackAssetId = isHeavyGun ? 'hardware_deploy_mount' : 'sentry_deploy_tripod';
    const chosenId = this.buffers.has(assetId)
      ? assetId
      : this.buffers.has(fallbackAssetId)
        ? fallbackAssetId
        : null;

    if (chosenId) {
      const buf = this.buffers.get(chosenId)!;
      const onset = this.bufferOnsets.get(chosenId) ?? 0;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const baseRate =
        kind === 'SENTRY_PULSE'
          ? 0.98
          : kind === 'RAIL_LANCE'
            ? 0.82
            : kind === 'INCINERATOR'
              ? 0.87
              : kind === 'SHOCK_COIL'
                ? 1.02
                : kind === 'CRYO_VALVE'
                  ? 0.92
                  : 1.06;
      src.playbackRate.value = baseRate + (Math.random() - 0.5) * 0.06;
      src.connect(panner);
      src.start(now, onset);
      return;
    }

    // Procedural fallback: heavy tripod thud + mounting clamp clunk + locking pin snap
    this.synthLandingThud(now, isHeavyGun ? 0.95 : 1.15, volume * 0.55);
    this.playButtonLatchLock(isHeavyGun ? 0.82 : 1.04, volume * 0.78);
  }

  /**
   * MU-TH-UR 6000 Intercom Tactical Voice Callouts (350Hz-3400Hz Nostromo shipboard bandpass bus).
   * Rate-limited per callout ID so urgent warnings cut cleanly through gunfire without ever overlapping!
   */
  public playPerimeterIntercomVoice(id: PerimeterVoiceId, minCooldownSec = 7.0): void {
    if (!this.ctx || !this.intercomInput || this.muted) return;
    const now = this.ctx.currentTime;
    const lastForId = this.lastPerimVoiceById.get(id) ?? -99;
    if (now - lastForId < minCooldownSec) return;
    if (now - this.lastVoiceTime < 2.2 && id !== 'queen') return;

    const bufKey = `perim_voice_${id}`;
    const buf = this.buffers.get(bufKey);
    if (!buf) return;

    this.lastPerimVoiceById.set(id, now);
    this.lastVoiceTime = now;

    try {
      this.activeVoiceSource?.stop();
    } catch {
      /* ignore */
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = id === 'queen' ? 1.05 : 0.92;
    src.connect(g);
    g.connect(this.intercomInput);
    src.start(now, this.bufferOnsets.get(bufKey) ?? 0);
    this.activeVoiceSource = src;
  }

  /** Heavy industrial breaker trip into blackout OR contactor slam power restoration. */
  public playReactorBreakerEvent(tripped: boolean): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const asset = tripped ? 'perim_breaker_blackout' : 'perim_breaker_restore';
    if (this.playCorridorBuffer(asset, 0, tripped ? 0.92 : 0.78, 1.0, 0.48, 3800)) {
      return;
    }
    this.playButtonLatchLock(tripped ? 0.55 : 1.15, 0.95);
  }

  /**
   * M99 Rail-Lance single thunderous anti-materiel detonation + long ~5.8s rolling corridor echo:
   * Shares the UA 571-C machine-gun's exact bulkhead acoustic bus (`sentryDirectWallInput` +
   * `sentryWarehouseWetInput` + `sentryRollingTailBus`), pitched much deeper and layered with
   * a chest-shaking concussive shockwave so every shot booms like heavy artillery down the hall!
   */
  public playRailLanceShot(pan = 0, tier: 1 | 2 | 3 = 1, distanceNorm = 0.42): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const clampedDist = Math.max(0, Math.min(1, distanceNorm));
    const tierGain = tier === 3 ? 1.18 : tier === 2 ? 1.09 : 1.0;
    const tierRate = tier === 3 ? 0.88 : tier === 2 ? 0.94 : 1.0;
    const clampedPan = Math.max(-0.78, Math.min(0.78, pan));

    // Shared bulkhead acoustic panner -> same room & walls as the UA 571-C machine gun!
    const panner = ctx.createStereoPanner();
    panner.pan.value = clampedPan;

    const directSend = ctx.createGain();
    directSend.gain.value = (1.18 - clampedDist * 0.2) * tierGain;
    const hallWetSend = ctx.createGain();
    hallWetSend.gain.value = (0.92 + clampedDist * 0.34) * tierGain;

    panner.connect(directSend);
    panner.connect(hallWetSend);
    if (this.sentryDirectWallInput && this.sentryWarehouseWetInput) {
      directSend.connect(this.sentryDirectWallInput);
      hallWetSend.connect(this.sentryWarehouseWetInput);
    } else {
      directSend.connect(this.masterGain);
    }

    // 1. Primary HD Thunderous Detonation Sample (low-shelf sub boost + bulkhead wall coupling)
    const railBuf = this.buffers.get('perim_rail_lance');
    if (railBuf) {
      const onset = this.bufferOnsets.get('perim_rail_lance') ?? 0;
      const src = ctx.createBufferSource();
      src.buffer = railBuf;
      src.playbackRate.value = (0.86 + Math.random() * 0.06) * tierRate;

      const subShelf = ctx.createBiquadFilter();
      subShelf.type = 'lowshelf';
      subShelf.frequency.value = 125;
      subShelf.gain.value = 7.5;

      const bodyLp = ctx.createBiquadFilter();
      bodyLp.type = 'lowpass';
      bodyLp.frequency.value = 2600 - clampedDist * 550;
      bodyLp.Q.value = 0.72;

      const bufGain = ctx.createGain();
      bufGain.gain.value = 0.95 * tierGain;

      src.connect(subShelf);
      subShelf.connect(bodyLp);
      bodyLp.connect(bufGain);
      bufGain.connect(panner);
      src.start(now, onset);
    }

    // 2. Deepened Ballistic Pressure-Wave Core (same physical DNA as the machine gun, ~1 octave deeper!)
    if (this.sentryRoundBuffers.length > 0) {
      this.sentryRoundCursor = (this.sentryRoundCursor + 1) % this.sentryRoundBuffers.length;
      const roundSrc = ctx.createBufferSource();
      roundSrc.buffer = this.sentryRoundBuffers[this.sentryRoundCursor];
      roundSrc.playbackRate.value = (0.56 + Math.random() * 0.05) * tierRate;

      const roundGain = ctx.createGain();
      roundGain.gain.value = 1.15 * tierGain;
      roundSrc.connect(roundGain);
      roundGain.connect(panner);
      roundSrc.start(now);
    }

    // 3. Chest-Thumping Concussive Sub-Bass Shockwave (122Hz -> 24Hz) rattling the control room
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(122 * tierRate, now);
    subOsc.frequency.exponentialRampToValueAtTime(24, now + 0.44);
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.linearRampToValueAtTime(0.54 * tierGain, now + 0.006);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.52);
    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(now);
    subOsc.stop(now + 0.56);

    // 4. Long ~5.8s Deep Rolling Steel-Corridor Thunder Echo (pitched-down stereo tunnel tail!)
    if (this.sentryRollingTailBus && this.sentryRollingTailBuffers.length > 0) {
      this.sentryRollingTailCursor =
        (this.sentryRollingTailCursor + 1) % this.sentryRollingTailBuffers.length;
      const tailSrc = ctx.createBufferSource();
      tailSrc.buffer = this.sentryRollingTailBuffers[this.sentryRollingTailCursor];
      // Lower playback rate deepens & stretches the 4.5s tunnel echo to ~5.8s of booming cavern roll!
      tailSrc.playbackRate.value = (0.74 + Math.random() * 0.05) * tierRate;

      const tailSub = ctx.createBiquadFilter();
      tailSub.type = 'lowshelf';
      tailSub.frequency.value = 160;
      tailSub.gain.value = 5.5;

      const tailPan = ctx.createStereoPanner();
      tailPan.pan.value = Math.max(-0.45, Math.min(0.45, -clampedPan * 0.35));

      const tailGain = ctx.createGain();
      const tailStart = now + 0.055;
      const peakTail = (1.22 + clampedDist * 0.35) * tierGain;
      tailGain.gain.setValueAtTime(0, tailStart);
      tailGain.gain.linearRampToValueAtTime(peakTail, tailStart + 0.095);

      tailSrc.connect(tailSub);
      tailSub.connect(tailPan);
      tailPan.connect(tailGain);
      tailGain.connect(this.sentryRollingTailBus);
      tailSrc.start(tailStart);
    }
  }

  /** Arc-Shock Coil Tesla discharge snap. */
  public playShockCoilArc(pan = 0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastShockCoilTime < 0.25) return;
    this.lastShockCoilTime = now;
    if (
      this.playCorridorBuffer(
        'perim_shock_coil',
        pan,
        0.52,
        0.92 + Math.random() * 0.16,
        0.4,
        4600
      )
    ) {
      return;
    }
    this.playButtonLatchLock(1.4, 0.45);
  }

  /** M18 Proximity Claymore directional corridor detonation. */
  public playClaymoreDetonation(pan = 0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    if (
      this.playCorridorBuffer(
        'perim_claymore_blast',
        pan,
        0.9,
        0.94 + Math.random() * 0.1,
        0.65,
        3400
      )
    ) {
      return;
    }
    this.synthLandingThud(this.ctx.currentTime, 0.52, 0.95);
  }

  /** Xeno Queen Matriarch / Crusher Boss arrival roar with brief gunfire duck & sub-bass hull tremor! */
  public playQueenMatriarchRoar(pan = 0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Brief dramatic gunfire dip so Crusher / Queen arrival cuts unmistakably through active barrages
    if (this.sentryDirectWallInput) {
      const gParam = this.sentryDirectWallInput.gain;
      gParam.cancelScheduledValues(now);
      gParam.setValueAtTime(Math.max(0.42, gParam.value), now);
      gParam.linearRampToValueAtTime(0.42, now + 0.06);
      gParam.setValueAtTime(0.42, now + 0.48);
      gParam.linearRampToValueAtTime(1.0, now + 1.15);
    }

    // Sub-bass structural deck tremor (74Hz -> 29Hz) underneath the echoing boss roar
    const sub = ctx.createOscillator();
    const subG = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(74, now);
    sub.frequency.exponentialRampToValueAtTime(29, now + 0.85);
    subG.gain.setValueAtTime(0.0001, now);
    subG.gain.linearRampToValueAtTime(0.32, now + 0.04);
    subG.gain.exponentialRampToValueAtTime(0.0001, now + 0.92);
    sub.connect(subG);
    subG.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.96);

    if (this.playCorridorBuffer('perim_queen_roar', pan, 0.95, 0.96, 0.72, 3200)) {
      return;
    }
    this.playXenomorphScreech('SWARM', 'QUEEN', pan, 0.25, 1.15);
  }

  /** Crystalline Cryo+Pulse SHATTER impact crunch! */
  public playCryoShatterCrunch(pan = 0): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastShatterTime < 0.2) return;
    this.lastShatterTime = now;
    this.playCorridorBuffer(
      'perim_shatter_crunch',
      pan,
      0.5,
      0.95 + Math.random() * 0.14,
      0.32,
      5200
    );
  }

  /** Superheated gun barrel thermal lock OR Coolant Flush pressurized steam vent hiss! */
  public playThermalSteamVent(pan = 0, volume = 0.75): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastSteamTime < 0.35) return;
    this.lastSteamTime = now;
    this.playCorridorBuffer(
      'perim_thermal_steam',
      pan,
      0.56 * volume,
      0.95 + Math.random() * 0.1,
      0.38,
      4400
    );
  }

  /**
   * Satisfying Nostromo console / station wave-clear siren & lock chime with subtle
   * metallic corridor reverb and soft dual-tap hallway echo!
   */
  public playWaveClearedChime(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const buf = this.buffers.get('perim_wave_clear');
    if (!buf) {
      this.playButtonLatchLock(1.12, 0.85);
      return;
    }

    const onset = this.bufferOnsets.get('perim_wave_clear') ?? 0;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1.0;

    // Warm station-speaker lowpass + main dry send
    const mainLp = ctx.createBiquadFilter();
    mainLp.type = 'lowpass';
    mainLp.frequency.value = 4400;
    mainLp.Q.value = 0.7;

    const dryGain = ctx.createGain();
    dryGain.gain.value = 0.74;

    src.connect(mainLp);
    mainLp.connect(dryGain);
    dryGain.connect(this.masterGain);

    // Metallic corridor hall convolution reverb send
    if (this.sentryWarehouseWetInput) {
      const hallSend = ctx.createGain();
      hallSend.gain.value = 0.56;
      mainLp.connect(hallSend);
      hallSend.connect(this.sentryWarehouseWetInput);
    }

    // Subtle dual-tap corridor echo (+220ms left, +490ms right) filtered warm so it sits naturally in the station
    const echoLp = ctx.createBiquadFilter();
    echoLp.type = 'lowpass';
    echoLp.frequency.value = 2150;
    echoLp.Q.value = 0.7;
    mainLp.connect(echoLp);

    const taps = [
      { delaySec: 0.22, gain: 0.24, pan: -0.24 },
      { delaySec: 0.49, gain: 0.11, pan: 0.26 },
    ];
    for (const tap of taps) {
      const delay = ctx.createDelay(1.0);
      delay.delayTime.value = tap.delaySec;
      const g = ctx.createGain();
      g.gain.value = tap.gain;
      const p = ctx.createStereoPanner();
      p.pan.value = tap.pan;

      echoLp.connect(delay);
      delay.connect(g);
      g.connect(p);
      p.connect(this.masterGain);

      if (this.sentryWarehouseWetInput) {
        const tapWet = ctx.createGain();
        tapWet.gain.value = 0.34;
        p.connect(tapWet);
        tapWet.connect(this.sentryWarehouseWetInput);
      }
    }

    src.start(now, onset);
  }

  /** Tactile hardware upgrade confirmation (richer harmonic chord for MK-III specialization!). */
  public playUpgradeConfirmChime(isMk3 = false): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.playButtonLatchLock(isMk3 ? 1.15 : 1.02, 0.85);
    const notes = isMk3 ? [523.25, 659.25, 1046.5] : [440, 659.25];
    notes.forEach((hz, idx) => {
      const t0 = now + 0.04 + idx * 0.065;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(hz, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(isMk3 ? 0.13 : 0.095, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      osc.connect(g);
      g.connect(this.masterGain!);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    });
  }
}
