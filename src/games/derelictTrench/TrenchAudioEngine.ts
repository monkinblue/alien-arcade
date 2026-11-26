import type { AudioEngine } from '../../audio/AudioEngine';
import type { MissileLockState } from './types';

type TrenchRealismSfxId =
  | 'f16_turbine_loop'
  | 'f16_afterburner_roar'
  | 'm61_vulcan_burst'
  | 'aim9_missile_launch'
  | 'cmds_flare_pop'
  | 'cmds_flare_thud'
  | 'betty_chaff_flare'
  | 'hull_impact_thud'
  | 'trench_conduit_blast';

const REALISM_ASSET_IDS = new Set<TrenchRealismSfxId>([
  'f16_turbine_loop',
  'f16_afterburner_roar',
  'm61_vulcan_burst',
  'aim9_missile_launch',
  'cmds_flare_pop',
  'cmds_flare_thud',
  'betty_chaff_flare',
  'hull_impact_thud',
  'trench_conduit_blast',
]);

interface TrenchManifestData {
  version: number;
  assets?: Record<string, { path: string; category?: 'loop' | 'sfx' | 'voice'; bytes: number }>;
}

/**
 * Realism-First F-16C Cockpit Audio Engine (ElevenLabs HD Assets + Warm Canopy DSP):
 * - Pressurized canopy mastering chain + dedicated Pilot Helmet-Headset Bandpass Bus (400Hz–3200Hz).
 * - Muffled Pratt & Whitney F100 turbine + Afterburner crossfade tied to throttle % + AB ignition thump.
 * - Low-frequency Aerodynamic G-Buffet (>5.5G) & Stall Shudder (<180 KCAS) rumble bus.
 * - M61A1 20mm Vulcan rotary cannon ("BRRRT") + muffled barrel spin-down / propellant gas-vent tail.
 * - Authentic F-16 ALR-56M RWR radar-spike chirps, missile-launch warble, and AIM-9 Sidewinder seeker tone
 *   routed through the helmet-headset bandpass filter (clean, non-fatiguing, zero arcade beeps).
 * - CMDS pneumatic flare/chaff dispenser pop & deep muffled structural airframe hull impact thud.
 */
export class TrenchAudioEngine {
  private hostAudio: AudioEngine;
  private ctx: AudioContext | null = null;

  private busInput: GainNode | null = null;
  private busOutput: GainNode | null = null;

  // Pilot Helmet-Headset Bandpass Bus (400Hz - 3200Hz) for RWR & Sidewinder avionics tones
  private headsetInput: GainNode | null = null;

  // 1. Muffled Turbine + Afterburner Crossfade + G/Stall Buffet
  private turbineOscA: OscillatorNode | null = null;
  private turbineOscB: OscillatorNode | null = null;
  private turbineFilter: BiquadFilterNode | null = null;
  private turbineSynthGain: GainNode | null = null;
  private turbineSampleSrc: AudioBufferSourceNode | null = null;
  private turbineSampleGain: GainNode | null = null;

  private airflowSource: AudioBufferSourceNode | null = null;
  private airflowFilter: BiquadFilterNode | null = null;
  private airflowGain: GainNode | null = null;

  private burnerSource: AudioBufferSourceNode | null = null;
  private burnerFilter: BiquadFilterNode | null = null;
  private burnerGain: GainNode | null = null;
  private burnerSampleAttached = false;
  private turbineSampleAttached = false;
  private wasAfterburning = false;

  // Low-frequency aerodynamic G-buffet & stall shudder bus (24-68Hz)
  private buffetSource: AudioBufferSourceNode | null = null;
  private buffetFilter: BiquadFilterNode | null = null;
  private buffetGain: GainNode | null = null;

  // 2. Continuous Gated M61A1 Vulcan 20mm Rotary Cannon ("BRRRT") + Sub-Bass Thump + WaveShaper Punch
  private vulcanOscBuzz: OscillatorNode | null = null;
  private vulcanOscSub: OscillatorNode | null = null;
  private vulcanSubThumpOsc: OscillatorNode | null = null;
  private vulcanSubThumpGain: GainNode | null = null;
  private vulcanPulseLfo: OscillatorNode | null = null;
  private vulcanPulseDepth: GainNode | null = null;
  private vulcanModGain: GainNode | null = null;
  private vulcanNoiseSrc: AudioBufferSourceNode | null = null;
  private vulcanNoiseFilter: BiquadFilterNode | null = null;
  private vulcanNoiseGain: GainNode | null = null;
  private vulcanMasterGain: GainNode | null = null;
  private vulcanPunchBus: GainNode | null = null;
  private vulcanSaturator: WaveShaperNode | null = null;
  private vulcanSampleLoop: AudioBufferSourceNode | null = null;
  private vulcanFiringActive = false;

  // 3. Authentic Physical-Model F-16 AIM-9M Sidewinder IR Seeker Synthesizer
  //    (Spinning reticle chopper AM/FM + warm InSb detector noise -> 350–1950Hz helmet headset bus)
  private seekerOscA: OscillatorNode | null = null;
  private seekerOscB: OscillatorNode | null = null;
  private seekerOscBGain: GainNode | null = null;
  private seekerModOsc: OscillatorNode | null = null;
  private seekerModGain: GainNode | null = null;
  private seekerAmOsc: OscillatorNode | null = null;
  private seekerAmDepth: GainNode | null = null;
  private seekerAmGain: GainNode | null = null;
  private seekerNoiseSrc: AudioBufferSourceNode | null = null;
  private seekerNoiseGain: GainNode | null = null;
  private seekerFilter: BiquadFilterNode | null = null;
  private seekerLowpass: BiquadFilterNode | null = null;
  private seekerGain: GainNode | null = null;
  private lastSeekerState: MissileLockState = 'NONE';

  // 4. F-16 ALR-56M RWR Missile-Launch Warble Bus (routed into Helmet-Headset Bus)
  private rwrWarbleOsc: OscillatorNode | null = null;
  private rwrWarbleLfo: OscillatorNode | null = null;
  private rwrWarbleLfoDepth: GainNode | null = null;
  private rwrWarbleGain: GainNode | null = null;

  private brownNoiseBuffer: AudioBuffer | null = null;
  private rawBuffers = new Map<TrenchRealismSfxId, ArrayBuffer>();
  private decodedBuffers = new Map<TrenchRealismSfxId, AudioBuffer>();
  private bufferOnsets = new Map<TrenchRealismSfxId, number>();
  private activeSources = new Set<AudioScheduledSourceNode>();

  private mounted = false;
  private prefetchStarted = false;
  private decodeInFlight = false;
  private lastRaltCautionTime = 0;
  private lastRwrSpikeTime = 0;
  private lastGunHitTime = 0;

  constructor(hostAudio: AudioEngine) {
    this.hostAudio = hostAudio;
  }

  public mount(): void {
    this.mounted = true;
    if (!this.prefetchStarted) {
      this.prefetchStarted = true;
      void this.prefetchAssets();
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
      expected: REALISM_ASSET_IDS.size,
      contextState: this.ctx?.state ?? 'uninitialized',
    };
  }

  public unmount(): void {
    this.mounted = false;
    this.vulcanFiringActive = false;
    this.wasAfterburning = false;
    this.silenceAll();
    this.teardownGraph();
  }

  public silenceAll(): void {
    this.vulcanFiringActive = false;
    this.stopVulcanSampleLoop();
    for (const src of this.activeSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore
      }
    }
    this.activeSources.clear();

    const now = this.ctx?.currentTime ?? 0;
    try {
      this.turbineSynthGain?.gain.setTargetAtTime(0, now, 0.03);
      this.turbineSampleGain?.gain.setTargetAtTime(0, now, 0.03);
      this.airflowGain?.gain.setTargetAtTime(0, now, 0.03);
      this.burnerGain?.gain.setTargetAtTime(0, now, 0.03);
      this.buffetGain?.gain.setTargetAtTime(0, now, 0.03);
      this.vulcanMasterGain?.gain.setTargetAtTime(0, now, 0.02);
      this.vulcanSubThumpGain?.gain.setTargetAtTime(0, now, 0.02);
      this.seekerGain?.gain.setTargetAtTime(0, now, 0.02);
      this.rwrWarbleGain?.gain.setTargetAtTime(0, now, 0.02);
      this.lastSeekerState = 'NONE';
    } catch {
      // Ignore
    }
  }

  private ensureGraph(): boolean {
    if (!this.mounted) return false;
    const ctx = this.hostAudio.getAudioContext();
    const masterDest = this.hostAudio.getMasterOutputNode();
    if (!ctx || !masterDest) return false;

    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    if (this.ctx === ctx && this.busInput && this.busOutput) {
      if (this.rawBuffers.size > this.decodedBuffers.size && !this.decodeInFlight) {
        void this.decodePrefetched();
      }
      this.attachDecodedLoopBuffersIfReady();
      return true;
    }

    this.teardownGraph();
    this.ctx = ctx;

    const busInput = ctx.createGain();
    busInput.gain.value = 1.0;

    // Warm pressurized fighter-cockpit mastering chain: chest weight + zero harsh treble
    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 85;
    lowShelf.gain.value = 3.5;

    const canopyLp = ctx.createBiquadFilter();
    canopyLp.type = 'lowpass';
    canopyLp.frequency.value = 4800;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -13;
    comp.knee.value = 10;
    comp.ratio.value = 3.4;
    comp.attack.value = 0.003;
    comp.release.value = 0.14;

    const busOutput = ctx.createGain();
    busOutput.gain.value = 0.92;

    busInput.connect(lowShelf);
    lowShelf.connect(canopyLp);
    canopyLp.connect(comp);
    comp.connect(busOutput);
    busOutput.connect(masterDest);

    this.busInput = busInput;
    this.busOutput = busOutput;

    // Pilot Helmet-Headset Bandpass Bus (350Hz - 3400Hz) routed POST-COMPRESSOR into busOutput
    // so Vulcan gunfire & explosions NEVER duck life-saving RWR or Sidewinder headset audio!
    const hsIn = ctx.createGain();
    hsIn.gain.value = 1.0;
    const hsHp = ctx.createBiquadFilter();
    hsHp.type = 'highpass';
    hsHp.frequency.value = 350;
    hsHp.Q.value = 0.72;
    const hsLp = ctx.createBiquadFilter();
    hsLp.type = 'lowpass';
    hsLp.frequency.value = 3400;
    hsLp.Q.value = 0.72;
    hsIn.connect(hsHp);
    hsHp.connect(hsLp);
    hsLp.connect(busOutput);
    this.headsetInput = hsIn;

    this.buildBrownNoiseBuffer(ctx);
    this.buildTurbineAndBuffetGraph(ctx);
    this.buildVulcanRotaryGraph(ctx);
    this.buildSidewinderSeekerGraph(ctx);
    this.buildRwrWarbleGraph(ctx);

    if (this.rawBuffers.size > 0 && !this.decodeInFlight) {
      void this.decodePrefetched();
    }
    this.attachDecodedLoopBuffersIfReady();
    return true;
  }

  private teardownGraph(): void {
    this.silenceAll();
    const stoppable: Array<AudioScheduledSourceNode | null> = [
      this.turbineOscA,
      this.turbineOscB,
      this.turbineSampleSrc,
      this.airflowSource,
      this.burnerSource,
      this.buffetSource,
      this.vulcanOscBuzz,
      this.vulcanOscSub,
      this.vulcanSubThumpOsc,
      this.vulcanPulseLfo,
      this.vulcanNoiseSrc,
      this.vulcanSampleLoop,
      this.seekerOscA,
      this.seekerOscB,
      this.seekerModOsc,
      this.seekerAmOsc,
      this.seekerNoiseSrc,
      this.rwrWarbleOsc,
      this.rwrWarbleLfo,
    ];
    for (const s of stoppable) {
      try {
        s?.stop();
      } catch {
        // Ignore
      }
    }

    const nodes: Array<AudioNode | null> = [
      this.turbineOscA,
      this.turbineOscB,
      this.turbineFilter,
      this.turbineSynthGain,
      this.turbineSampleSrc,
      this.turbineSampleGain,
      this.airflowSource,
      this.airflowFilter,
      this.airflowGain,
      this.burnerSource,
      this.burnerFilter,
      this.burnerGain,
      this.buffetSource,
      this.buffetFilter,
      this.buffetGain,
      this.vulcanOscBuzz,
      this.vulcanOscSub,
      this.vulcanSubThumpOsc,
      this.vulcanSubThumpGain,
      this.vulcanPulseLfo,
      this.vulcanPulseDepth,
      this.vulcanModGain,
      this.vulcanNoiseSrc,
      this.vulcanNoiseFilter,
      this.vulcanNoiseGain,
      this.vulcanMasterGain,
      this.vulcanPunchBus,
      this.vulcanSaturator,
      this.vulcanSampleLoop,
      this.seekerOscA,
      this.seekerOscB,
      this.seekerOscBGain,
      this.seekerModOsc,
      this.seekerModGain,
      this.seekerAmOsc,
      this.seekerAmDepth,
      this.seekerAmGain,
      this.seekerNoiseSrc,
      this.seekerNoiseGain,
      this.seekerFilter,
      this.seekerLowpass,
      this.seekerGain,
      this.rwrWarbleOsc,
      this.rwrWarbleLfo,
      this.rwrWarbleLfoDepth,
      this.rwrWarbleGain,
      this.headsetInput,
      this.busInput,
      this.busOutput,
    ];
    for (const n of nodes) {
      try {
        n?.disconnect();
      } catch {
        // Ignore
      }
    }

    this.turbineOscA = null;
    this.turbineOscB = null;
    this.turbineFilter = null;
    this.turbineSynthGain = null;
    this.turbineSampleSrc = null;
    this.turbineSampleGain = null;
    this.airflowSource = null;
    this.airflowFilter = null;
    this.airflowGain = null;
    this.burnerSource = null;
    this.burnerFilter = null;
    this.burnerGain = null;
    this.buffetSource = null;
    this.buffetFilter = null;
    this.buffetGain = null;
    this.vulcanOscBuzz = null;
    this.vulcanOscSub = null;
    this.vulcanSubThumpOsc = null;
    this.vulcanSubThumpGain = null;
    this.vulcanPulseLfo = null;
    this.vulcanPulseDepth = null;
    this.vulcanModGain = null;
    this.vulcanNoiseSrc = null;
    this.vulcanNoiseFilter = null;
    this.vulcanNoiseGain = null;
    this.vulcanMasterGain = null;
    this.vulcanPunchBus = null;
    this.vulcanSaturator = null;
    this.vulcanSampleLoop = null;
    this.seekerOscA = null;
    this.seekerOscB = null;
    this.seekerOscBGain = null;
    this.seekerModOsc = null;
    this.seekerModGain = null;
    this.seekerAmOsc = null;
    this.seekerAmDepth = null;
    this.seekerAmGain = null;
    this.seekerNoiseSrc = null;
    this.seekerNoiseGain = null;
    this.seekerFilter = null;
    this.seekerLowpass = null;
    this.seekerGain = null;
    this.rwrWarbleOsc = null;
    this.rwrWarbleLfo = null;
    this.rwrWarbleLfoDepth = null;
    this.rwrWarbleGain = null;
    this.headsetInput = null;
    this.busInput = null;
    this.busOutput = null;
    this.turbineSampleAttached = false;
    this.burnerSampleAttached = false;
    this.lastSeekerState = 'NONE';
    this.ctx = null;
  }

  private buildBrownNoiseBuffer(ctx: AudioContext): void {
    const sr = ctx.sampleRate;
    const len = sr * 4;
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.024 * white) / 1.024;
      data[i] = Math.max(-1, Math.min(1, last * 3.3));
    }
    this.brownNoiseBuffer = buf;
  }

  private buildTurbineAndBuffetGraph(ctx: AudioContext): void {
    if (!this.busInput || !this.brownNoiseBuffer) return;

    // 1a. Warm Heavily Low-Passed Turbine Fallback Synth (smoothly yields if ElevenLabs f16_turbine_loop is loaded!)
    this.turbineOscA = ctx.createOscillator();
    this.turbineOscA.type = 'triangle';
    this.turbineOscA.frequency.value = 52;

    this.turbineOscB = ctx.createOscillator();
    this.turbineOscB.type = 'sawtooth';
    this.turbineOscB.frequency.value = 104.5;
    const oscBGain = ctx.createGain();
    oscBGain.gain.value = 0.16;

    this.turbineFilter = ctx.createBiquadFilter();
    this.turbineFilter.type = 'lowpass';
    this.turbineFilter.frequency.value = 165;
    this.turbineFilter.Q.value = 0.7;

    this.turbineSynthGain = ctx.createGain();
    this.turbineSynthGain.gain.value = 0;

    this.turbineOscA.connect(this.turbineFilter);
    this.turbineOscB.connect(oscBGain);
    oscBGain.connect(this.turbineFilter);
    this.turbineFilter.connect(this.turbineSynthGain);
    this.turbineSynthGain.connect(this.busInput);
    this.turbineOscA.start();
    this.turbineOscB.start();

    // 1b. Pressurized Cockpit Airflow Broadband Hiss
    this.airflowSource = ctx.createBufferSource();
    this.airflowSource.buffer = this.brownNoiseBuffer;
    this.airflowSource.loop = true;

    this.airflowFilter = ctx.createBiquadFilter();
    this.airflowFilter.type = 'lowpass';
    this.airflowFilter.frequency.value = 240;
    this.airflowFilter.Q.value = 0.6;

    this.airflowGain = ctx.createGain();
    this.airflowGain.gain.value = 0;

    this.airflowSource.connect(this.airflowFilter);
    this.airflowFilter.connect(this.airflowGain);
    this.airflowGain.connect(this.busInput);
    this.airflowSource.start();

    // 1c. Dedicated Afterburner Sub-Bass Rumble Layer (upgraded automatically if f16_afterburner_roar.mp3 exists!)
    this.burnerSource = ctx.createBufferSource();
    this.burnerSource.buffer = this.brownNoiseBuffer;
    this.burnerSource.loop = true;

    this.burnerFilter = ctx.createBiquadFilter();
    this.burnerFilter.type = 'lowpass';
    this.burnerFilter.frequency.value = 310;
    this.burnerFilter.Q.value = 0.9;

    this.burnerGain = ctx.createGain();
    this.burnerGain.gain.value = 0;

    this.burnerSource.connect(this.burnerFilter);
    this.burnerFilter.connect(this.burnerGain);
    this.burnerGain.connect(this.busInput);
    this.burnerSource.start();

    // 1d. Aerodynamic G-Buffet (>5.5G) & Stall Shudder (<180 KCAS) Low-Frequency Airframe Rumble
    this.buffetSource = ctx.createBufferSource();
    this.buffetSource.buffer = this.brownNoiseBuffer;
    this.buffetSource.loop = true;

    this.buffetFilter = ctx.createBiquadFilter();
    this.buffetFilter.type = 'bandpass';
    this.buffetFilter.frequency.value = 46;
    this.buffetFilter.Q.value = 1.4;

    this.buffetGain = ctx.createGain();
    this.buffetGain.gain.value = 0;

    this.buffetSource.connect(this.buffetFilter);
    this.buffetFilter.connect(this.buffetGain);
    this.buffetGain.connect(this.busInput);
    this.buffetSource.start();
  }

  /**
   * Automatically attaches ElevenLabs seamless turbine & afterburner loop MP3s once decoded!
   */
  private attachDecodedLoopBuffersIfReady(): void {
    if (!this.ctx || !this.busInput) return;

    const turbBuf = this.decodedBuffers.get('f16_turbine_loop');
    if (turbBuf && !this.turbineSampleAttached) {
      this.turbineSampleAttached = true;
      const src = this.ctx.createBufferSource();
      src.buffer = turbBuf;
      src.loop = true;

      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1100;

      const g = this.ctx.createGain();
      g.gain.value = 0;

      src.connect(lp);
      lp.connect(g);
      g.connect(this.busInput);
      src.start();
      this.turbineSampleSrc = src;
      this.turbineSampleGain = g;
    }

    const abBuf = this.decodedBuffers.get('f16_afterburner_roar');
    if (abBuf && !this.burnerSampleAttached && this.burnerFilter && this.burnerGain) {
      this.burnerSampleAttached = true;
      try {
        this.burnerSource?.stop();
        this.burnerSource?.disconnect();
      } catch {
        // Ignore
      }
      const src = this.ctx.createBufferSource();
      src.buffer = abBuf;
      src.loop = true;
      src.connect(this.burnerFilter);
      src.start();
      this.burnerSource = src;
    }
  }

  private makeSoftClipCurve(drive: number): Float32Array<ArrayBuffer> {
    const samples = 512;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    return curve;
  }

  private buildVulcanRotaryGraph(ctx: AudioContext): void {
    if (!this.busInput || !this.brownNoiseBuffer) return;

    // Dedicated Vulcan Cockpit Punch Bus with subtle WaveShaper soft-clip saturation!
    this.vulcanPunchBus = ctx.createGain();
    this.vulcanPunchBus.gain.value = 1.15;

    this.vulcanSaturator = ctx.createWaveShaper();
    this.vulcanSaturator.curve = this.makeSoftClipCurve(2.15);
    this.vulcanSaturator.oversample = '2x';

    const punchShelf = ctx.createBiquadFilter();
    punchShelf.type = 'lowshelf';
    punchShelf.frequency.value = 95;
    punchShelf.gain.value = 6.0;

    this.vulcanPunchBus.connect(this.vulcanSaturator);
    this.vulcanSaturator.connect(punchShelf);
    punchShelf.connect(this.busInput);

    // Dedicated Close-Proximity 60Hz–90Hz Airframe Sub-Bass Thump (always layered under Vulcan MP3!)
    this.vulcanSubThumpOsc = ctx.createOscillator();
    this.vulcanSubThumpOsc.type = 'triangle';
    this.vulcanSubThumpOsc.frequency.value = 72;
    const subLp = ctx.createBiquadFilter();
    subLp.type = 'lowpass';
    subLp.frequency.value = 125;
    this.vulcanSubThumpGain = ctx.createGain();
    this.vulcanSubThumpGain.gain.value = 0;
    this.vulcanSubThumpOsc.connect(subLp);
    subLp.connect(this.vulcanSubThumpGain);
    this.vulcanSubThumpGain.connect(this.vulcanPunchBus);
    this.vulcanSubThumpOsc.start();

    this.vulcanOscBuzz = ctx.createOscillator();
    this.vulcanOscBuzz.type = 'sawtooth';
    this.vulcanOscBuzz.frequency.value = 102;

    this.vulcanOscSub = ctx.createOscillator();
    this.vulcanOscSub.type = 'triangle';
    this.vulcanOscSub.frequency.value = 51;
    const subMix = ctx.createGain();
    subMix.gain.value = 0.85;

    this.vulcanNoiseSrc = ctx.createBufferSource();
    this.vulcanNoiseSrc.buffer = this.brownNoiseBuffer;
    this.vulcanNoiseSrc.loop = true;

    this.vulcanNoiseFilter = ctx.createBiquadFilter();
    this.vulcanNoiseFilter.type = 'bandpass';
    this.vulcanNoiseFilter.frequency.value = 680;
    this.vulcanNoiseFilter.Q.value = 1.25;

    this.vulcanNoiseGain = ctx.createGain();
    this.vulcanNoiseGain.gain.value = 1.35;

    this.vulcanModGain = ctx.createGain();
    this.vulcanModGain.gain.value = 0.62;

    this.vulcanPulseLfo = ctx.createOscillator();
    this.vulcanPulseLfo.type = 'square';
    this.vulcanPulseLfo.frequency.value = 102;

    this.vulcanPulseDepth = ctx.createGain();
    this.vulcanPulseDepth.gain.value = 0.36;
    this.vulcanPulseLfo.connect(this.vulcanPulseDepth);
    this.vulcanPulseDepth.connect(this.vulcanModGain.gain);

    const bodyLp = ctx.createBiquadFilter();
    bodyLp.type = 'lowpass';
    bodyLp.frequency.value = 1650;
    bodyLp.Q.value = 1.05;

    const chestPeak = ctx.createBiquadFilter();
    chestPeak.type = 'peaking';
    chestPeak.frequency.value = 92;
    chestPeak.Q.value = 1.3;
    chestPeak.gain.value = 6.5;

    this.vulcanMasterGain = ctx.createGain();
    this.vulcanMasterGain.gain.value = 0;

    this.vulcanOscBuzz.connect(this.vulcanModGain);
    this.vulcanOscSub.connect(subMix);
    subMix.connect(this.vulcanModGain);
    this.vulcanNoiseSrc.connect(this.vulcanNoiseFilter);
    this.vulcanNoiseFilter.connect(this.vulcanNoiseGain);
    this.vulcanNoiseGain.connect(this.vulcanModGain);

    this.vulcanModGain.connect(chestPeak);
    chestPeak.connect(bodyLp);
    bodyLp.connect(this.vulcanMasterGain);
    this.vulcanMasterGain.connect(this.vulcanPunchBus);

    this.vulcanOscBuzz.start();
    this.vulcanOscSub.start();
    this.vulcanPulseLfo.start();
    this.vulcanNoiseSrc.start();
  }

  /**
   * Physical-Model F-16 AIM-9M Sidewinder IR Seeker Synthesizer:
   * - Models the real spinning optical reticle chopper (~100Hz AM + subtle FM grit) modulating
   *   a warm analog carrier + subtle InSb infrared detector noise inside the pilot's helmet headset.
   * - Low-passed cleanly at 1,850Hz so it is rock-steady, authentic, and never ear-piercing or intrusive!
   */
  private buildSidewinderSeekerGraph(ctx: AudioContext): void {
    if (!this.headsetInput) return;

    // Warm primary carrier (triangle = clean analog body without harsh digital fizz)
    this.seekerOscA = ctx.createOscillator();
    this.seekerOscA.type = 'triangle';
    this.seekerOscA.frequency.value = 210;

    // Subtle analog grit harmonic (sawtooth blended gently for realistic AIM-9M texture)
    this.seekerOscB = ctx.createOscillator();
    this.seekerOscB.type = 'sawtooth';
    this.seekerOscB.frequency.value = 210;
    this.seekerOscBGain = ctx.createGain();
    this.seekerOscBGain.gain.value = 0.28;

    // Spinning seeker reticle FM grit oscillator (~98Hz nutation wobble)
    this.seekerModOsc = ctx.createOscillator();
    this.seekerModOsc.type = 'sine';
    this.seekerModOsc.frequency.value = 98;

    this.seekerModGain = ctx.createGain();
    this.seekerModGain.gain.value = 18;
    this.seekerModOsc.connect(this.seekerModGain);
    this.seekerModGain.connect(this.seekerOscA.frequency);
    this.seekerModGain.connect(this.seekerOscB.frequency);

    // Spinning reticle AM chopper stage (~102Hz subtle amplitude ripple — iconic Sidewinder buzz!)
    this.seekerAmGain = ctx.createGain();
    this.seekerAmGain.gain.value = 0.86;
    this.seekerAmOsc = ctx.createOscillator();
    this.seekerAmOsc.type = 'sine';
    this.seekerAmOsc.frequency.value = 102;
    this.seekerAmDepth = ctx.createGain();
    this.seekerAmDepth.gain.value = 0.14;
    this.seekerAmOsc.connect(this.seekerAmDepth);
    this.seekerAmDepth.connect(this.seekerAmGain.gain);

    // Subtle analog IR-detector thermal hiss tucked softly under the search growl
    if (this.brownNoiseBuffer) {
      this.seekerNoiseSrc = ctx.createBufferSource();
      this.seekerNoiseSrc.buffer = this.brownNoiseBuffer;
      this.seekerNoiseSrc.loop = true;
      const noiseBp = ctx.createBiquadFilter();
      noiseBp.type = 'bandpass';
      noiseBp.frequency.value = 740;
      noiseBp.Q.value = 1.2;
      this.seekerNoiseGain = ctx.createGain();
      this.seekerNoiseGain.gain.value = 0.12;
      this.seekerNoiseSrc.connect(noiseBp);
      noiseBp.connect(this.seekerNoiseGain);
      this.seekerNoiseGain.connect(this.seekerAmGain);
      this.seekerNoiseSrc.start();
    }

    // Warm headset tone-shaping bandpass + strict 1,850Hz lowpass (zero piercing treble!)
    this.seekerFilter = ctx.createBiquadFilter();
    this.seekerFilter.type = 'bandpass';
    this.seekerFilter.frequency.value = 560;
    this.seekerFilter.Q.value = 1.35;

    this.seekerLowpass = ctx.createBiquadFilter();
    this.seekerLowpass.type = 'lowpass';
    this.seekerLowpass.frequency.value = 1850;
    this.seekerLowpass.Q.value = 0.7;

    this.seekerGain = ctx.createGain();
    this.seekerGain.gain.value = 0;

    this.seekerOscA.connect(this.seekerAmGain);
    this.seekerOscB.connect(this.seekerOscBGain);
    this.seekerOscBGain.connect(this.seekerAmGain);
    this.seekerAmGain.connect(this.seekerFilter);
    this.seekerFilter.connect(this.seekerLowpass);
    this.seekerLowpass.connect(this.seekerGain);
    this.seekerGain.connect(this.headsetInput);

    this.seekerOscA.start();
    this.seekerOscB.start();
    this.seekerModOsc.start();
    this.seekerAmOsc.start();
  }

  /**
   * Authentic F-16 ALR-56M Missile-Launch Warning Warble (filtered through 400–3200Hz headset bus).
   */
  private buildRwrWarbleGraph(ctx: AudioContext): void {
    if (!this.headsetInput) return;

    this.rwrWarbleOsc = ctx.createOscillator();
    this.rwrWarbleOsc.type = 'triangle';
    this.rwrWarbleOsc.frequency.value = 980;

    this.rwrWarbleLfo = ctx.createOscillator();
    this.rwrWarbleLfo.type = 'square';
    this.rwrWarbleLfo.frequency.value = 7.4;

    this.rwrWarbleLfoDepth = ctx.createGain();
    this.rwrWarbleLfoDepth.gain.value = 165;
    this.rwrWarbleLfo.connect(this.rwrWarbleLfoDepth);
    this.rwrWarbleLfoDepth.connect(this.rwrWarbleOsc.frequency);

    this.rwrWarbleGain = ctx.createGain();
    this.rwrWarbleGain.gain.value = 0;

    this.rwrWarbleOsc.connect(this.rwrWarbleGain);
    this.rwrWarbleGain.connect(this.headsetInput);

    this.rwrWarbleOsc.start();
    this.rwrWarbleLfo.start();
  }

  private async prefetchAssets(): Promise<void> {
    try {
      const base = import.meta.env.BASE_URL || './';
      const prefix = base === '/' ? '.' : base.replace(/\/$/, '');
      const res = await fetch(`${prefix}/audio/trench/manifest.json`, { cache: 'no-cache' });
      if (!res.ok) return;
      const data = (await res.json()) as TrenchManifestData;
      if (!data?.assets) return;

      await Promise.all(
        Object.entries(data.assets)
          .filter(([id]) => REALISM_ASSET_IDS.has(id as TrenchRealismSfxId))
          .map(async ([id, meta]) => {
            try {
              const mp3Res = await fetch(`${prefix}${meta.path}?v=${meta.bytes}`, {
                cache: 'no-cache',
              });
              if (!mp3Res.ok) return;
              const arr = await mp3Res.arrayBuffer();
              if (arr.byteLength > 512) {
                this.rawBuffers.set(id as TrenchRealismSfxId, arr);
              }
            } catch {
              // Warm DSP fallback covers seamlessly
            }
          })
      );

      if (this.ctx) {
        await this.decodePrefetched();
      }
    } catch {
      // Warm DSP fallback covers seamlessly
    }
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
        pending.map(async ([id, data]) => {
          try {
            let buf = await ctx.decodeAudioData(data.slice(0));
            // Trim MP3 encoder padding & apply smooth equal-power seam crossfade on continuous loops!
            if (id === 'f16_turbine_loop' || id === 'f16_afterburner_roar') {
              buf = this.makeSeamlessLoopBuffer(ctx, buf, 0.06, 0.14);
            }
            this.normalizePeak(buf, 0.88);
            this.decodedBuffers.set(id, buf);
            this.bufferOnsets.set(id, this.detectTransientOnsetSec(buf));
          } catch {
            // Keep DSP
          }
        })
      );
      this.attachDecodedLoopBuffersIfReady();
    } finally {
      this.decodeInFlight = false;
    }
  }

  /**
   * Strips MP3 LAME encoder start/end silence padding and folds a clean equal-power crossfade
   * over the loop boundary so turbine & afterburner MP3 loops play infinitely with zero clicks!
   */
  private makeSeamlessLoopBuffer(
    ctx: AudioContext,
    src: AudioBuffer,
    trimEdgeSec: number,
    fadeSec: number
  ): AudioBuffer {
    const sr = src.sampleRate;
    const trimSamples = Math.min(Math.floor(trimEdgeSec * sr), Math.floor(src.length * 0.1));
    const usableLen = src.length - trimSamples * 2;
    const fadeSamples = Math.min(Math.floor(fadeSec * sr), Math.floor(usableLen * 0.25));
    const outLen = usableLen - fadeSamples;
    if (outLen <= sr * 0.5) return src;

    const out = ctx.createBuffer(src.numberOfChannels, outLen, sr);
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const inData = src.getChannelData(ch);
      const outData = out.getChannelData(ch);

      // Copy main trimmed body
      for (let i = 0; i < outLen; i++) {
        outData[i] = inData[trimSamples + i];
      }

      // Fold tail segment smoothly into head segment with equal-power sin/cos crossfade
      for (let i = 0; i < fadeSamples; i++) {
        const t = i / fadeSamples;
        const headGain = Math.sin(t * Math.PI * 0.5);
        const tailGain = Math.cos(t * Math.PI * 0.5);
        const tailSample = inData[trimSamples + outLen + i];
        outData[i] = outData[i] * headGain + tailSample * tailGain;
      }
    }
    return out;
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
      for (let i = 0; i < d.length; i++) d[i] *= scale;
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

  /**
   * Updates muffled F100 turbine, Afterburner crossfade (+ ignition thump), airflow hiss,
   * and low-frequency aerodynamic G-buffet (>5.5G) & stall shudder (<180 KCAS).
   */
  public updateCockpitEngine(
    active: boolean,
    throttle: number,
    mach: number,
    gLoad: number,
    stallFactor = 0
  ): void {
    if (active) {
      this.ensureGraph();
    }
    if (!this.mounted || !this.ctx || !this.turbineSynthGain || !this.airflowGain || !this.burnerGain) {
      return;
    }
    const now = this.ctx.currentTime;
    if (!active) {
      this.wasAfterburning = false;
      this.turbineSynthGain.gain.setTargetAtTime(0, now, 0.07);
      this.turbineSampleGain?.gain.setTargetAtTime(0, now, 0.07);
      this.airflowGain.gain.setTargetAtTime(0, now, 0.07);
      this.burnerGain.gain.setTargetAtTime(0, now, 0.07);
      this.buffetGain?.gain.setTargetAtTime(0, now, 0.06);
      return;
    }

    const th = Math.max(0, Math.min(1.2, throttle));
    const abFrac = Math.max(0, (th - 1.0) / 0.2);
    const isAb = abFrac > 0.02;
    if (isAb && !this.wasAfterburning) {
      this.playAfterburnerIgnitionThump();
    }
    this.wasAfterburning = isAb;

    const gBuffet = Math.max(0, Math.min(1, (gLoad - 5.2) / 3.2));
    const buffetTotal = Math.max(gBuffet, Math.min(1, stallFactor * 1.15));
    const machNorm = Math.max(0, Math.min(1, (mach - 0.25) / 1.35));

    // Turbine core (prefer decoded ElevenLabs f16_turbine_loop when loaded)
    if (this.turbineSampleAttached && this.turbineSampleSrc && this.turbineSampleGain) {
      this.turbineSampleSrc.playbackRate.setTargetAtTime(0.84 + th * 0.28, now, 0.09);
      this.turbineSampleGain.gain.setTargetAtTime(0.24 + th * 0.14, now, 0.09);
      this.turbineSynthGain.gain.setTargetAtTime(0.02, now, 0.09);
    } else {
      const baseHz = 46 + th * 26 + abFrac * 8;
      this.turbineOscA?.frequency.setTargetAtTime(baseHz, now, 0.08);
      this.turbineOscB?.frequency.setTargetAtTime(baseHz * 2.01, now, 0.08);
      this.turbineFilter?.frequency.setTargetAtTime(145 + th * 140 + abFrac * 65, now, 0.08);
      this.turbineSynthGain.gain.setTargetAtTime(0.075 + th * 0.05, now, 0.08);
    }

    // Pressurized canopy airflow hiss
    this.airflowFilter?.frequency.setTargetAtTime(180 + machNorm * 240 + gBuffet * 110, now, 0.08);
    this.airflowGain.gain.setTargetAtTime(0.04 + machNorm * 0.095 + gBuffet * 0.04, now, 0.08);

    // Afterburner low-frequency crossfade rumble (uses f16_afterburner_roar.mp3 if decoded!)
    this.burnerFilter?.frequency.setTargetAtTime(
      this.burnerSampleAttached ? 950 + abFrac * 450 : 240 + abFrac * 180,
      now,
      0.08
    );
    this.burnerGain.gain.setTargetAtTime(
      isAb ? (this.burnerSampleAttached ? 0.34 : 0.26) * (0.4 + abFrac * 0.6) : 0,
      now,
      0.09
    );

    // Aerodynamic G-Buffet (>5.5G) & Stall Shudder (<180 KCAS) airframe shake rumble
    this.buffetFilter?.frequency.setTargetAtTime(stallFactor > 0.1 ? 34 : 52, now, 0.06);
    this.buffetGain?.gain.setTargetAtTime(buffetTotal * 0.36, now, 0.06);
  }

  private playAfterburnerIgnitionThump(): void {
    if (!this.ctx || !this.busInput) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(76, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.32, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(g);
    g.connect(this.busInput);
    this.trackSource(osc);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  private stopVulcanSampleLoop(): void {
    if (this.vulcanSampleLoop) {
      try {
        this.vulcanSampleLoop.stop();
        this.vulcanSampleLoop.disconnect();
      } catch {
        // Ignore
      }
      this.vulcanSampleLoop = null;
    }
  }

  public setVulcanFiring(firing: boolean): void {
    if (!this.ensureGraph() || !this.ctx || !this.vulcanMasterGain) return;
    const now = this.ctx.currentTime;

    if (firing) {
      if (!this.vulcanFiringActive) {
        this.vulcanFiringActive = true;
        const sample = this.decodedBuffers.get('m61_vulcan_burst');
        if (sample && this.vulcanPunchBus) {
          this.stopVulcanSampleLoop();
          const src = this.ctx.createBufferSource();
          src.buffer = sample;
          src.loop = true;
          const onset = this.bufferOnsets.get('m61_vulcan_burst') ?? 0;
          src.loopStart = onset + 0.03;
          src.loopEnd = Math.max(onset + 0.35, sample.duration - 0.32);

          const lp = this.ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 3100;
          const g = this.ctx.createGain();
          g.gain.value = 0.94;
          src.connect(lp);
          lp.connect(g);
          g.connect(this.vulcanPunchBus);
          src.start(now, onset);
          this.vulcanSampleLoop = src;
        }

        this.vulcanOscBuzz?.frequency.cancelScheduledValues(now);
        this.vulcanOscBuzz?.frequency.setValueAtTime(92, now);
        this.vulcanOscBuzz?.frequency.linearRampToValueAtTime(104, now + 0.055);
        this.vulcanOscSub?.frequency.cancelScheduledValues(now);
        this.vulcanOscSub?.frequency.setValueAtTime(46, now);
        this.vulcanOscSub?.frequency.linearRampToValueAtTime(52, now + 0.055);
        this.vulcanSubThumpOsc?.frequency.cancelScheduledValues(now);
        this.vulcanSubThumpOsc?.frequency.setValueAtTime(64, now);
        this.vulcanSubThumpOsc?.frequency.linearRampToValueAtTime(78, now + 0.05);
        this.vulcanPulseLfo?.frequency.cancelScheduledValues(now);
        this.vulcanPulseLfo?.frequency.setValueAtTime(94, now);
        this.vulcanPulseLfo?.frequency.linearRampToValueAtTime(106, now + 0.055);
      }
      // Always layer chest-rattling 60Hz–90Hz sub-bass airframe thump beneath Vulcan burst!
      const synthLevel = this.vulcanSampleLoop ? 0.2 : 0.42;
      this.vulcanMasterGain.gain.setTargetAtTime(synthLevel, now, 0.01);
      this.vulcanSubThumpGain?.gain.setTargetAtTime(0.46, now, 0.012);
    } else if (this.vulcanFiringActive) {
      this.vulcanFiringActive = false;
      this.stopVulcanSampleLoop();
      this.vulcanMasterGain.gain.setTargetAtTime(0, now, 0.02);
      this.vulcanSubThumpGain?.gain.setTargetAtTime(0, now, 0.024);
      this.playVulcanSpinDownTail();
    }
  }

  private playVulcanSpinDownTail(): void {
    if (!this.ctx || !this.busInput) return;
    const now = this.ctx.currentTime;

    const coast = this.ctx.createOscillator();
    coast.type = 'sawtooth';
    coast.frequency.setValueAtTime(102, now);
    coast.frequency.exponentialRampToValueAtTime(34, now + 0.27);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(420, now);
    lp.frequency.exponentialRampToValueAtTime(130, now + 0.27);
    const cg = this.ctx.createGain();
    cg.gain.setValueAtTime(0.13, now);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.29);
    coast.connect(lp);
    lp.connect(cg);
    cg.connect(this.busInput);
    this.trackSource(coast);
    coast.start(now);
    coast.stop(now + 0.31);

    if (this.brownNoiseBuffer) {
      const vent = this.ctx.createBufferSource();
      vent.buffer = this.brownNoiseBuffer;
      const vbp = this.ctx.createBiquadFilter();
      vbp.type = 'bandpass';
      vbp.frequency.setValueAtTime(860, now);
      vbp.frequency.exponentialRampToValueAtTime(310, now + 0.24);
      vbp.Q.value = 1.1;
      const vg = this.ctx.createGain();
      vg.gain.setValueAtTime(0.15, now);
      vg.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      vent.connect(vbp);
      vbp.connect(vg);
      vg.connect(this.busInput);
      this.trackSource(vent);
      vent.start(now, Math.random() * 1.2, 0.28);
    }
  }

  /**
   * Authentic F-16 AIM-9M Sidewinder Seeker Tone (non-intrusive, headset-filtered, rock-steady):
   * - Completely SILENT when no target is inside the 22° HUD seeker circle (zero background clutter!).
   * - TRACKING inside seeker circle (0.35s acquire): soft, warm gravelly ~210Hz reticle search growl.
   * - LOCKED: crisp 30ms analog lock-latch chirp -> steady, polite ~840Hz AIM-9M lock tone with
   *   subtle 102Hz spinning-reticle modulation (warm, unmistakable, zero harsh banshee screech).
   */
  public updateSeekerTone(
    active: boolean,
    lockState: MissileLockState,
    inSeekerCone = true,
    lockProgress = 0
  ): void {
    const shouldSound =
      active && (lockState === 'LOCKED' || (lockState === 'TRACKING' && inSeekerCone));

    if (shouldSound) {
      this.ensureGraph();
    }
    if (!this.mounted || !this.ctx || !this.seekerGain) return;
    const now = this.ctx.currentTime;

    if (!shouldSound) {
      this.lastSeekerState = 'NONE';
      this.seekerGain.gain.setTargetAtTime(0, now, 0.024);
      return;
    }

    if (lockState === 'TRACKING') {
      this.lastSeekerState = 'TRACKING';
      const p = Math.max(0, Math.min(1, lockProgress));
      // Warm analog Sidewinder search growl (~205–238Hz) tightening subtly over the 0.35s acquire window
      const growlHz = 205 + p * 34;
      this.seekerOscA?.frequency.setTargetAtTime(growlHz, now, 0.015);
      this.seekerOscB?.frequency.setTargetAtTime(growlHz * 2.0, now, 0.015);
      this.seekerOscBGain?.gain.setTargetAtTime(0.32, now, 0.015);
      this.seekerModOsc?.frequency.setTargetAtTime(96, now, 0.015);
      this.seekerModGain?.gain.setTargetAtTime(16 + p * 8, now, 0.015);
      this.seekerAmOsc?.frequency.setTargetAtTime(28 + p * 24, now, 0.015);
      this.seekerAmDepth?.gain.setTargetAtTime(0.18, now, 0.015);
      this.seekerNoiseGain?.gain.setTargetAtTime(0.14, now, 0.015);
      this.seekerFilter?.frequency.setTargetAtTime(540 + p * 140, now, 0.015);
      this.seekerFilter?.Q.setTargetAtTime(1.3, now, 0.015);
      this.seekerLowpass?.frequency.setTargetAtTime(1450, now, 0.015);
      // Soft, polite, non-intrusive level (headset HPF gently warms the low harmonics)
      this.seekerGain.gain.setTargetAtTime(0.044, now, 0.018);
    } else {
      // LOCKED: subtle tactile analog lock-latch click on entry + steady authentic F-16 AIM-9M 840Hz tone!
      if (this.lastSeekerState !== 'LOCKED') {
        this.playSeekerLockLatchChirp();
      }
      this.lastSeekerState = 'LOCKED';
      this.seekerOscA?.frequency.setTargetAtTime(840, now, 0.008);
      this.seekerOscB?.frequency.setTargetAtTime(840, now, 0.008);
      this.seekerOscBGain?.gain.setTargetAtTime(0.16, now, 0.01);
      // Iconic ~102Hz spinning-reticle chopper texture (clean analog grit without piercing shrillness!)
      this.seekerModOsc?.frequency.setTargetAtTime(102, now, 0.01);
      this.seekerModGain?.gain.setTargetAtTime(11, now, 0.01);
      this.seekerAmOsc?.frequency.setTargetAtTime(102, now, 0.01);
      this.seekerAmDepth?.gain.setTargetAtTime(0.15, now, 0.01);
      this.seekerNoiseGain?.gain.setTargetAtTime(0.025, now, 0.01);
      this.seekerFilter?.frequency.setTargetAtTime(920, now, 0.01);
      this.seekerFilter?.Q.setTargetAtTime(1.35, now, 0.01);
      this.seekerLowpass?.frequency.setTargetAtTime(1850, now, 0.01);
      // Slightly quieter & non-fatiguing — crystal clear over the F100 turbine without ever intruding!
      this.seekerGain.gain.setTargetAtTime(0.031, now, 0.012);
    }
  }

  /** Brief, subtle 35ms analog headset confirmation tick the instant IR lock snaps solid */
  private playSeekerLockLatchChirp(): void {
    if (!this.ctx || !this.headsetInput) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(760, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.028);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.036, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.038);

    osc.connect(g);
    g.connect(this.headsetInput);
    this.trackSource(osc);
    osc.start(now);
    osc.stop(now + 0.042);
  }

  /**
   * Authentic F-16 ALR-56M RWR Radar-Spike Chirp routed through helmet headset bandpass!
   */
  public playRwrSpikeChirp(urgent = false): void {
    if (!this.ensureGraph() || !this.ctx || !this.headsetInput) return;
    const now = this.ctx.currentTime;
    if (now - this.lastRwrSpikeTime < (urgent ? 0.6 : 1.15)) return;
    this.lastRwrSpikeTime = now;

    const count = urgent ? 3 : 2;
    for (let k = 0; k < count; k++) {
      const st = now + k * 0.068;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(urgent ? 1240 : 1060, st);
      osc.frequency.exponentialRampToValueAtTime(urgent ? 1480 : 1180, st + 0.045);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, st);
      g.gain.linearRampToValueAtTime(0.098, st + 0.006);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.052);

      osc.connect(g);
      g.connect(this.headsetInput);
      this.trackSource(osc);
      osc.start(st);
      osc.stop(st + 0.058);
    }
  }

  /**
   * Continuous F-16 ALR-56M Missile-Launch Warning Warble while an incoming SAM is actively tracking!
   */
  public updateRwrMissileWarble(active: boolean): void {
    if (active) {
      this.ensureGraph();
    }
    if (!this.mounted || !this.ctx || !this.rwrWarbleGain) return;
    const now = this.ctx.currentTime;
    this.rwrWarbleGain.gain.setTargetAtTime(active ? 0.092 : 0, now, 0.03);
  }

  /**
   * Crisp, restrained metallic hit-confirm tick when 20mm Vulcan rounds connect with a target.
   * Rate-limited so rapid 35 RPS bursts sound tactile and gratifying without ear fatigue.
   */
  public playGunHitConfirm(pan = 0): void {
    if (!this.ensureGraph() || !this.ctx || !this.headsetInput) return;
    const now = this.ctx.currentTime;
    if (now - this.lastGunHitTime < 0.065) return;
    this.lastGunHitTime = now;

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-0.7, Math.min(0.7, pan)), now);
    panner.connect(this.headsetInput);

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    const baseHz = 1320 + Math.random() * 140;
    osc.frequency.setValueAtTime(baseHz, now);
    osc.frequency.exponentialRampToValueAtTime(baseHz * 0.62, now + 0.036);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.088, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.042);

    osc.connect(g);
    g.connect(panner);
    this.trackSource(osc);
    osc.start(now);
    osc.stop(now + 0.046);
  }

  /**
   * Clean 2-note cockpit avionics confirmation chime for Resupply Pickup, Terrain Masking, or 7G Break Evasion.
   */
  public playTacticalBonusChime(isResupply: boolean): void {
    if (!this.ensureGraph() || !this.ctx || !this.headsetInput) return;
    const now = this.ctx.currentTime;
    const notes = isResupply ? [740, 1110, 1480] : [660, 990];
    notes.forEach((hz, idx) => {
      if (!this.ctx || !this.headsetInput) return;
      const st = now + idx * 0.068;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(hz, st);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, st);
      g.gain.linearRampToValueAtTime(0.075, st + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.11);
      osc.connect(g);
      g.connect(this.headsetInput);
      this.trackSource(osc);
      osc.start(st);
      osc.stop(st + 0.12);
    });
  }

  public playMissileLaunch(side: -1 | 1): void {
    if (!this.ensureGraph() || !this.ctx || !this.busInput) return;
    const now = this.ctx.currentTime;
    const pan = side * 0.35;

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, now);
    panner.connect(this.busInput);

    const buf = this.decodedBuffers.get('aim9_missile_launch');
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.88, now);
      src.connect(g);
      g.connect(panner);
      this.trackSource(src);
      src.start(now, this.bufferOnsets.get('aim9_missile_launch') ?? 0);
      return;
    }

    // Warm realistic pneumatic rail clunk + solid-rocket whoosh fallback
    const clunk = this.ctx.createOscillator();
    clunk.type = 'triangle';
    clunk.frequency.setValueAtTime(138, now);
    clunk.frequency.exponentialRampToValueAtTime(40, now + 0.09);
    const cg = this.ctx.createGain();
    cg.gain.setValueAtTime(0.35, now);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    clunk.connect(cg);
    cg.connect(panner);
    this.trackSource(clunk);
    clunk.start(now);
    clunk.stop(now + 0.12);

    if (this.brownNoiseBuffer) {
      const roar = this.ctx.createBufferSource();
      roar.buffer = this.brownNoiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1060, now + 0.03);
      bp.frequency.exponentialRampToValueAtTime(220, now + 0.95);
      bp.Q.value = 0.85;

      const rg = this.ctx.createGain();
      rg.gain.setValueAtTime(0.001, now);
      rg.gain.linearRampToValueAtTime(0.55, now + 0.07);
      rg.gain.exponentialRampToValueAtTime(0.001, now + 1.05);

      roar.connect(bp);
      bp.connect(rg);
      rg.connect(panner);
      this.trackSource(roar);
      roar.start(now, Math.random() * 1.1, 1.1);
    }
  }

  /**
   * Authentic Fighter-Jet Cockpit VCS ("Betty") Callout: "Chaff, flare."
   * Routed through the Pilot Helmet-Headset Bandpass Bus (350Hz-3400Hz, post-compressor)
   * so cannon fire and afterburner roar never mask the pilot's helmet audio!
   */
  public playCmdsBettyVoice(): void {
    if (!this.ensureGraph() || !this.ctx || !this.headsetInput) return;
    const now = this.ctx.currentTime;

    const buf = this.decodedBuffers.get('betty_chaff_flare');
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.95, now);
      src.connect(g);
      g.connect(this.headsetInput);
      this.trackSource(src);
      src.start(now, this.bufferOnsets.get('betty_chaff_flare') ?? 0);
      return;
    }

    // Brief crisp helmet intercom PTT squelch click fallback if TTS MP3 not yet decoded
    const click = this.ctx.createOscillator();
    click.type = 'triangle';
    click.frequency.setValueAtTime(1180, now);
    click.frequency.exponentialRampToValueAtTime(640, now + 0.045);
    const cg = this.ctx.createGain();
    cg.gain.setValueAtTime(0.08, now);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    click.connect(cg);
    cg.connect(this.headsetInput);
    this.trackSource(click);
    click.start(now);
    click.stop(now + 0.06);
  }

  /**
   * CMDS Chaff/Flare Dispenser Cartridge Beat ("THUD... THUD... THUD... THUD"):
   * Triggered 4 times in rhythm (every 0.23s) synced 1:1 with left/right tail pod flare ejections!
   * Pairs the muffled ElevenLabs cartridge thud sample with a tight pressurized-fuselage low-end thump.
   */
  public playCmdsPop(pan = 0, beatIndex = 0): void {
    if (!this.ensureGraph() || !this.ctx || !this.busInput) return;
    const now = this.ctx.currentTime;

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-0.45, Math.min(0.45, pan)), now);
    panner.connect(this.busInput);

    // Tactile pressurized-fuselage sub-thud on every cartridge squib discharge
    const rateVar = 0.96 + (beatIndex % 2) * 0.055 - (beatIndex >= 2 ? 0.015 : 0);
    const subThud = this.ctx.createOscillator();
    subThud.type = 'sine';
    subThud.frequency.setValueAtTime(112 * rateVar, now);
    subThud.frequency.exponentialRampToValueAtTime(38, now + 0.085);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.001, now);
    sg.gain.linearRampToValueAtTime(0.42, now + 0.006);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.105);
    subThud.connect(sg);
    sg.connect(panner);
    this.trackSource(subThud);
    subThud.start(now);
    subThud.stop(now + 0.115);

    const thudBuf = this.decodedBuffers.get('cmds_flare_thud');
    if (thudBuf) {
      const src = this.ctx.createBufferSource();
      src.buffer = thudBuf;
      src.playbackRate.setValueAtTime(rateVar, now);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.88, now);
      src.connect(g);
      g.connect(panner);
      this.trackSource(src);
      src.start(now, this.bufferOnsets.get('cmds_flare_thud') ?? 0);
      return;
    }

    const popBuf = this.decodedBuffers.get('cmds_flare_pop');
    if (popBuf) {
      const src = this.ctx.createBufferSource();
      src.buffer = popBuf;
      src.playbackRate.setValueAtTime(0.88 * rateVar, now);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1400, now);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.76, now);
      g.gain.setTargetAtTime(0.001, now + 0.18, 0.045);
      src.connect(lp);
      lp.connect(g);
      g.connect(panner);
      this.trackSource(src);
      src.start(now, this.bufferOnsets.get('cmds_flare_pop') ?? 0, 0.34);
      return;
    }

    // Crisp pneumatic cartridge pop + muffled flare hiss fallback
    const pop = this.ctx.createOscillator();
    pop.type = 'triangle';
    pop.frequency.setValueAtTime(215 * rateVar, now);
    pop.frequency.exponentialRampToValueAtTime(48, now + 0.065);
    const pg = this.ctx.createGain();
    pg.gain.setValueAtTime(0.32, now);
    pg.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    pop.connect(pg);
    pg.connect(panner);
    this.trackSource(pop);
    pop.start(now);
    pop.stop(now + 0.09);

    if (this.brownNoiseBuffer) {
      const hiss = this.ctx.createBufferSource();
      hiss.buffer = this.brownNoiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1150, now + 0.015);
      bp.frequency.exponentialRampToValueAtTime(420, now + 0.19);
      bp.Q.value = 0.95;
      const hg = this.ctx.createGain();
      hg.gain.setValueAtTime(0.22, now + 0.015);
      hg.gain.exponentialRampToValueAtTime(0.001, now + 0.21);
      hiss.connect(bp);
      bp.connect(hg);
      hg.connect(panner);
      this.trackSource(hiss);
      hiss.start(now + 0.015, Math.random() * 1.2, 0.22);
    }
  }

  /**
   * Deep muffled structural airframe hull impact thud + brief cockpit vibration rattle (ZERO screech!).
   */
  public playHullImpactThud(pan = 0): void {
    if (!this.ensureGraph() || !this.ctx || !this.busInput) return;
    const now = this.ctx.currentTime;
    const clampedPan = Math.max(-0.8, Math.min(0.8, pan));

    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(clampedPan, now);
    panner.connect(this.busInput);

    const buf = this.decodedBuffers.get('hull_impact_thud');
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.95, now);
      src.connect(g);
      g.connect(panner);
      this.trackSource(src);
      src.start(now, this.bufferOnsets.get('hull_impact_thud') ?? 0);
      return;
    }

    // Heavy low-end structural concussion thump + brief fuselage rattle
    const thud = this.ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(115, now);
    thud.frequency.exponentialRampToValueAtTime(34, now + 0.24);
    const tg = this.ctx.createGain();
    tg.gain.setValueAtTime(0.68, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    thud.connect(tg);
    tg.connect(panner);
    this.trackSource(thud);
    thud.start(now);
    thud.stop(now + 0.3);

    if (this.brownNoiseBuffer) {
      const rattle = this.ctx.createBufferSource();
      rattle.buffer = this.brownNoiseBuffer;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(290, now);
      lp.frequency.exponentialRampToValueAtTime(75, now + 0.36);
      const rg = this.ctx.createGain();
      rg.gain.setValueAtTime(0.45, now);
      rg.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      rattle.connect(lp);
      lp.connect(rg);
      rg.connect(panner);
      this.trackSource(rattle);
      rattle.start(now, Math.random() * 1.1, 0.42);
    }
  }

  public playMuffledExplosion(pan: number, heavy = false): void {
    if (!this.ensureGraph() || !this.ctx || !this.busInput) return;
    const now = this.ctx.currentTime;
    const clampedPan = Math.max(-0.85, Math.min(0.85, pan));

    const buf = this.decodedBuffers.get('trench_conduit_blast');
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.setValueAtTime(heavy ? 0.72 : 0.92 + Math.random() * 0.1, now);

      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(heavy ? 320 : 580, now);
      lp.Q.setValueAtTime(0.7, now);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(heavy ? 1.0 : 0.68, now);

      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(clampedPan, now);

      src.connect(lp);
      lp.connect(gain);
      gain.connect(panner);
      panner.connect(this.busInput);
      this.trackSource(src);
      src.start(now, this.bufferOnsets.get('trench_conduit_blast') ?? 0);
      return;
    }

    if (this.brownNoiseBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.brownNoiseBuffer;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(heavy ? 240 : 390, now);
      lp.frequency.exponentialRampToValueAtTime(60, now + (heavy ? 0.8 : 0.45));
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(heavy ? 0.82 : 0.52, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.88 : 0.5));
      const p = this.ctx.createStereoPanner();
      p.pan.setValueAtTime(clampedPan, now);
      src.connect(lp);
      lp.connect(g);
      g.connect(p);
      p.connect(this.busInput);
      this.trackSource(src);
      src.start(now, Math.random() * 0.8, heavy ? 0.92 : 0.52);
    }
  }

  public playTerrainSparkHit(pan: number): void {
    if (!this.ensureGraph() || !this.ctx || !this.busInput || !this.brownNoiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.brownNoiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(320, now);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.14, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    const p = this.ctx.createStereoPanner();
    p.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, pan)), now);
    src.connect(lp);
    lp.connect(g);
    g.connect(p);
    p.connect(this.busInput);
    this.trackSource(src);
    src.start(now, Math.random() * 1.4, 0.14);
  }

  public playPullUpWarningBeep(): void {
    if (!this.ensureGraph() || !this.ctx || !this.headsetInput) return;
    const now = this.ctx.currentTime;
    if (now - this.lastRaltCautionTime < 1.35) return;
    this.lastRaltCautionTime = now;

    for (let k = 0; k < 2; k++) {
      const st = now + k * 0.14;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(k === 0 ? 780 : 620, st);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, st);
      g.gain.linearRampToValueAtTime(0.085, st + 0.014);
      g.gain.setValueAtTime(0.085, st + 0.075);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.115);
      osc.connect(g);
      g.connect(this.headsetInput);
      this.trackSource(osc);
      osc.start(st);
      osc.stop(st + 0.125);
    }
  }
}
