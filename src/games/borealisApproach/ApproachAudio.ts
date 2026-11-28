import type { AudioEngine } from '../../audio/AudioEngine';
import {
  compassSectorSpoken,
  type ActiveRunwayId,
  type AircraftKind,
  type ApproachAudioCallbacks,
  type CompassSector,
  type SecondaryRunwayId,
} from './types';

type CompassSectorLower = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

export type ApproachRadioClipId =
  // Shift-start iconic check-ins
  | 'checkin_viper_21_n'
  | 'checkin_atlas_7_e'
  // Dropship -> Pad Alpha (8 sectors)
  | `checkin_pad_${CompassSectorLower}`
  // Heavy -> ILS Runways 27, 09, 36, 18 (8 sectors each)
  | `checkin_rwy27_${CompassSectorLower}`
  | `checkin_rwy09_${CompassSectorLower}`
  | `checkin_rwy36_${CompassSectorLower}`
  | `checkin_rwy18_${CompassSectorLower}`
  // Salvage Tug -> Salvage Cradle (8 sectors)
  | `checkin_cradle_${CompassSectorLower}`
  // MEDEVAC Priority (8 sectors)
  | `checkin_medevac_${CompassSectorLower}`
  // Two-Ship Dropship Element (8 sectors)
  | `checkin_twoship_${CompassSectorLower}`
  // Vector acknowledgments (6 voice-matched clips)
  | 'vector_ack_viper'
  | 'vector_ack_scott'
  | 'vector_ack_bushfire'
  | 'vector_ack_baxter'
  | 'vector_ack_lisa'
  | 'vector_ack_campbell'
  // Localizer / Approach locks (all 4 runways + Pad Alpha + Salvage Cradle)
  | 'loc_rwy_27'
  | 'loc_rwy_27_aus'
  | 'loc_rwy_09'
  | 'loc_rwy_09_aus'
  | 'loc_rwy_36'
  | 'loc_rwy_18'
  | 'loc_pad_alpha'
  | 'loc_pad_alpha_aus'
  | 'loc_cradle'
  // RNAV Holding Fixes (KRATO, BOREA, VEXIS)
  | 'hold_krato'
  | 'hold_borea'
  | 'hold_vexis'
  // Outbound Departures / Launches (all 4 runways + airborne handoff)
  | 'dep_rolling_27'
  | 'dep_rolling_09'
  | 'dep_rolling_36'
  | 'dep_rolling_18'
  | 'dep_airborne'
  // Go-Arounds (unstable, missed approach, manual wave-off)
  | 'go_around_unstable'
  | 'go_around_missed'
  | 'go_around_waveoff'
  // Weather, Restricted MOA R-118, and Bogey advisories
  | 'wx_ion_storm'
  | 'warn_moa_r118'
  | 'warn_bogey'
  // ATIS Runway flips & crosswind openings (all single + dual active combinations)
  | 'atis_flip_27'
  | 'atis_flip_09'
  | 'atis_flip_36'
  | 'atis_flip_18'
  | 'atis_flip_27_36'
  | 'atis_flip_09_18'
  | 'atis_flip_27_18'
  | 'atis_flip_09_36'
  // Fuel & Emergency calls
  | 'joker_fuel_1'
  | 'joker_fuel_2'
  | 'mayday_bingo_1'
  | 'mayday_bingo_2'
  // Brief landings — strictly "[Callsign], clear of the active."
  | 'clear_viper'
  | 'clear_hawk'
  | 'clear_atlas'
  | 'clear_mule'
  | 'clear_tug'
  | 'clear_rig'
  | 'clear_dustoff'
  | 'clear_medevac'
  | 'clear_lifeguard'
  | 'clear_casevac'
  | 'clear_talon'
  | 'clear_saber'
  | 'clear_raven'
  | 'clear_falcon'
  | 'clear_mayday';

export type ApproachSfxClipId = 'mishap_explosion';

type ApproachAssetId = ApproachRadioClipId | ApproachSfxClipId;

export type RadioPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

export interface RadioQueueOptions {
  callsign?: string;
  caption?: string;
  force?: boolean;
  priority?: RadioPriority;
}

export interface RadioTransmissionInfo {
  id: ApproachRadioClipId;
  text: string;
  callsign: string | null;
  priority: RadioPriority;
  urgent: boolean;
}

export interface ApproachLoadedAudioStats {
  fetched: number;
  decoded: number;
  expected: number;
  contextState: string;
}

interface ApproachManifestEntry {
  path: string;
  category?: 'voice' | 'sfx' | 'loop';
  role?: string;
  voiceId?: string;
  text?: string;
  bytes: number;
}

interface ApproachManifestData {
  version: number;
  generatedAt?: string | null;
  assets?: Record<string, ApproachManifestEntry>;
}

interface QueuedRadioItem {
  id: ApproachRadioClipId;
  priority: RadioPriority;
  callsign: string | null;
  text: string;
  urgent: boolean;
  enqueuedAtMs: number;
  seq: number;
}

interface ActiveRadioTx {
  id: ApproachRadioClipId;
  priority: RadioPriority;
  callsign: string | null;
  text: string;
  urgent: boolean;
  startedAtMs: number;
  durationSec: number;
  voiceSource: AudioBufferSourceNode | null;
  voiceGain: GainNode | null;
  fallbackOscs: AudioScheduledSourceNode[];
  scheduledCloseSources: AudioScheduledSourceNode[];
}

const COMPASS_KEYS: readonly CompassSectorLower[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

const SECTOR_SPOKEN_BY_LOWER: Readonly<Record<CompassSectorLower, string>> = {
  n: 'north',
  ne: 'northeast',
  e: 'east',
  se: 'southeast',
  s: 'south',
  sw: 'southwest',
  w: 'west',
  nw: 'northwest',
};

function runwaySpoken(runway: ActiveRunwayId): string {
  switch (runway) {
    case '27':
      return 'Two-Seven';
    case '09':
      return 'Zero-Niner';
    case '36':
      return 'Three-Six';
    case '18':
      return 'One-Eight';
  }
}

function buildDirectionalCaptions(): Record<ApproachRadioClipId, string> {
  const map: Partial<Record<ApproachRadioClipId, string>> = {
    checkin_viper_21_n: 'Viper Two-One, north, inbound, Pad Alpha.',
    checkin_atlas_7_e: 'Atlas Seven, east, inbound, ILS Two-Seven.',

    vector_ack_viper: 'Roger, turning.',
    vector_ack_scott: 'Wilco, new heading.',
    vector_ack_bushfire: 'Copy, on the vector.',
    vector_ack_baxter: 'Roger, tracking vector.',
    vector_ack_lisa: 'Copy, turning inbound.',
    vector_ack_campbell: 'Wilco, coming around.',

    loc_rwy_27: 'Established, Two-Seven.',
    loc_rwy_27_aus: 'Established, Two-Seven.',
    loc_rwy_09: 'Established, Zero-Niner.',
    loc_rwy_09_aus: 'Established, Zero-Niner.',
    loc_rwy_36: 'Established, Three-Six.',
    loc_rwy_18: 'Established, One-Eight.',
    loc_pad_alpha: 'Inbound final, Pad Alpha.',
    loc_pad_alpha_aus: 'Locked on, Pad Alpha.',
    loc_cradle: 'Locked on, Salvage Cradle.',

    hold_krato: 'Holding Krato, right turns.',
    hold_borea: 'Holding Borea, right turns.',
    hold_vexis: 'Holding Vexis, right turns.',

    dep_rolling_27: 'Cleared takeoff, Two-Seven, rolling.',
    dep_rolling_09: 'Cleared takeoff, Zero-Niner, rolling.',
    dep_rolling_36: 'Cleared takeoff, Three-Six, rolling.',
    dep_rolling_18: 'Cleared takeoff, One-Eight, rolling.',
    dep_airborne: 'Airborne, switching departure.',

    go_around_unstable: 'Going around, unstable!',
    go_around_missed: 'Missed approach, going around!',
    go_around_waveoff: 'Copy wave-off, climbing out.',

    wx_ion_storm: 'All aircraft, ion static on scope, expect comms jam.',
    warn_moa_r118: 'Warning! Restricted zone Romeo One-Eighteen, turn out immediately!',
    warn_bogey: 'All aircraft, primary target, no transponder, watch separation.',

    atis_flip_27: 'Borealis ATIS, wind 270, Runway 27 active.',
    atis_flip_09: 'Borealis ATIS, wind 090, Runway 09 active.',
    atis_flip_36: 'Borealis ATIS, crosswind ops, Runway 36 now active.',
    atis_flip_18: 'Borealis ATIS, crosswind ops, Runway 18 now active.',
    atis_flip_27_36: 'Borealis ATIS, wind 305, Runways 27 and 36 active.',
    atis_flip_09_18: 'Borealis ATIS, wind 125, Runways 09 and 18 active.',
    atis_flip_27_18: 'Borealis ATIS, wind 235, Runways 27 and 18 active.',
    atis_flip_09_36: 'Borealis ATIS, wind 055, Runways 09 and 36 active.',

    joker_fuel_1: 'Borealis, Joker fuel, need vectors.',
    joker_fuel_2: 'Advise Joker fuel, requesting priority.',
    mayday_bingo_1: 'Mayday, Mayday! Bingo fuel, priority landing!',
    mayday_bingo_2: 'Mayday! Bingo fuel, need nearest open pad!',

    clear_viper: 'Viper, clear of the active.',
    clear_hawk: 'Hawk, clear of the active.',
    clear_atlas: 'Atlas, clear of the active.',
    clear_mule: 'Mule, clear of the active.',
    clear_tug: 'Tug, clear of the active.',
    clear_rig: 'Rig, clear of the active.',
    clear_dustoff: 'Dustoff, clear of the active.',
    clear_medevac: 'Medevac, clear of the active.',
    clear_lifeguard: 'Lifeguard, clear of the active.',
    clear_casevac: 'Casevac, clear of the active.',
    clear_talon: 'Talon, clear of the active.',
    clear_saber: 'Saber, clear of the active.',
    clear_raven: 'Raven, clear of the active.',
    clear_falcon: 'Falcon, clear of the active.',
    clear_mayday: 'Mayday, clear of the active.',
  };

  for (const s of COMPASS_KEYS) {
    const dir = SECTOR_SPOKEN_BY_LOWER[s];
    map[`checkin_pad_${s}`] = `Dropship, ${dir}, inbound, Pad Alpha.`;
    map[`checkin_rwy27_${s}`] = `Heavy, ${dir}, inbound, ILS Two-Seven.`;
    map[`checkin_rwy09_${s}`] = `Heavy, ${dir}, inbound, ILS Zero-Niner.`;
    map[`checkin_rwy36_${s}`] = `Heavy, ${dir}, inbound, ILS Three-Six.`;
    map[`checkin_rwy18_${s}`] = `Heavy, ${dir}, inbound, ILS One-Eight.`;
    map[`checkin_cradle_${s}`] = `Salvage tug, ${dir}, inbound, Salvage Cradle.`;
    map[`checkin_medevac_${s}`] = `Medevac, ${dir}, priority inbound.`;
    map[`checkin_twoship_${s}`] = `Two-ship, ${dir}, inbound, Pad Alpha.`;
  }

  return map as Record<ApproachRadioClipId, string>;
}

export const APPROACH_RADIO_CAPTIONS: Readonly<Record<ApproachRadioClipId, string>> =
  buildDirectionalCaptions();

const EXPECTED_VOICE_CLIP_COUNT = Object.keys(APPROACH_RADIO_CAPTIONS).length;
const EXPECTED_SFX_CLIP_COUNT = 1;
const EXPECTED_CLIP_COUNT = EXPECTED_VOICE_CLIP_COUNT + EXPECTED_SFX_CLIP_COUNT;

const ATC_MUTED_STORAGE_KEY = 'muthur_approach_atc_muted_v1';
const ATC_NOMINAL_OUTPUT_GAIN = 0.125; // -18 dB relative to original radio bus output (calm background ATC under music)

function readPersistedAtcMuted(): boolean {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(ATC_MUTED_STORAGE_KEY) === 'true';
    }
  } catch {
    // Ignore storage access errors in private/restricted contexts
  }
  return false;
}

function writePersistedAtcMuted(muted: boolean): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(ATC_MUTED_STORAGE_KEY, muted ? 'true' : 'false');
    }
  } catch {
    // Ignore storage access errors
  }
}

const PRIORITY_RANK: Readonly<Record<RadioPriority, number>> = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  CRITICAL: 3,
};

function getDefaultClipPriority(id: ApproachRadioClipId): RadioPriority {
  if (
    id.startsWith('mayday_bingo_') ||
    id === 'warn_moa_r118' ||
    id.startsWith('go_around_')
  ) {
    return 'CRITICAL';
  }
  if (
    id.startsWith('atis_flip_') ||
    id.startsWith('joker_fuel_') ||
    id.startsWith('checkin_medevac_')
  ) {
    return 'HIGH';
  }
  if (id.startsWith('vector_ack_') || id === 'dep_airborne') {
    return 'LOW';
  }
  return 'NORMAL';
}

function getDefaultClipCooldownSec(id: ApproachRadioClipId): number {
  if (id.startsWith('vector_ack_')) return 3.2;
  if (id === 'dep_airborne') return 6.0;
  if (id.startsWith('dep_rolling_')) return 1.5;
  if (id.startsWith('hold_')) return 2.4;
  if (id.startsWith('loc_')) return 2.0;
  if (id.startsWith('clear_')) return 1.0;
  if (id.startsWith('checkin_')) return 1.0;
  if (id.startsWith('joker_fuel_')) return 6.0;
  if (id.startsWith('mayday_bingo_')) return 6.0;
  if (id.startsWith('atis_flip_')) return 4.5;
  if (id.startsWith('go_around_')) return 1.8;
  if (id === 'warn_moa_r118') return 4.0;
  if (id === 'wx_ion_storm' || id === 'warn_bogey') return 8.0;
  return 2.0;
}

function isUrgentClip(id: ApproachRadioClipId, priority: RadioPriority): boolean {
  return (
    priority === 'CRITICAL' ||
    id.startsWith('joker_fuel_') ||
    id.startsWith('atis_flip_') ||
    id.startsWith('checkin_medevac_')
  );
}

function getCallsignPrefix(callsign: string): string {
  return callsign.trim().toUpperCase().split(/[-\s]/)[0] ?? '';
}

function resolveVectorAckClip(callsign: string): ApproachRadioClipId {
  switch (getCallsignPrefix(callsign)) {
    case 'VIPER':
    case 'FALCON':
      return 'vector_ack_viper';
    case 'HAWK':
    case 'RIG':
      return 'vector_ack_scott';
    case 'TUG':
    case 'ATLAS':
      return 'vector_ack_bushfire';
    case 'TALON':
    case 'MAYDAY':
      return 'vector_ack_baxter';
    case 'MULE':
    case 'RAVEN':
    case 'CASEVAC':
      return 'vector_ack_lisa';
    case 'DUSTOFF':
    case 'MEDEVAC':
    case 'LIFEGUARD':
    case 'SABER':
      return 'vector_ack_campbell';
    default:
      return 'vector_ack_scott';
  }
}

function resolveClearActiveClip(callsign: string, kind: AircraftKind): ApproachRadioClipId {
  switch (getCallsignPrefix(callsign)) {
    case 'VIPER':
      return 'clear_viper';
    case 'HAWK':
      return 'clear_hawk';
    case 'ATLAS':
      return 'clear_atlas';
    case 'MULE':
      return 'clear_mule';
    case 'TUG':
      return 'clear_tug';
    case 'RIG':
      return 'clear_rig';
    case 'DUSTOFF':
      return 'clear_dustoff';
    case 'MEDEVAC':
      return 'clear_medevac';
    case 'LIFEGUARD':
      return 'clear_lifeguard';
    case 'CASEVAC':
      return 'clear_casevac';
    case 'TALON':
      return 'clear_talon';
    case 'SABER':
      return 'clear_saber';
    case 'RAVEN':
      return 'clear_raven';
    case 'FALCON':
      return 'clear_falcon';
    case 'MAYDAY':
      return 'clear_mayday';
    default:
      if (kind === 'HEAVY') return 'clear_atlas';
      if (kind === 'TUG') return 'clear_tug';
      if (kind === 'MAYDAY') return 'clear_mayday';
      return 'clear_viper';
  }
}

function resolveAtisFlipClip(
  primaryRunway: ActiveRunwayId,
  secondaryRunway?: SecondaryRunwayId | null
): ApproachRadioClipId {
  if (secondaryRunway) {
    if (primaryRunway === '27' && secondaryRunway === '36') return 'atis_flip_27_36';
    if (primaryRunway === '09' && secondaryRunway === '18') return 'atis_flip_09_18';
    if (primaryRunway === '27' && secondaryRunway === '18') return 'atis_flip_27_18';
    if (primaryRunway === '09' && secondaryRunway === '36') return 'atis_flip_09_36';
  }
  switch (primaryRunway) {
    case '09':
      return 'atis_flip_09';
    case '36':
      return 'atis_flip_36';
    case '18':
      return 'atis_flip_18';
    case '27':
    default:
      return 'atis_flip_27';
  }
}

const VALID_CLIP_IDS = new Set<string>(Object.keys(APPROACH_RADIO_CAPTIONS));
const VALID_SFX_IDS = new Set<string>(['mishap_explosion']);
const VALID_ASSET_IDS = new Set<string>([...VALID_CLIP_IDS, ...VALID_SFX_IDS]);

/**
 * VHF/UHF RAPCON Audio & Grounded 1979 Station-Hardware Sound Engine for Program #5
 * (BOREALIS APPROACH // LV-118 RAPCON).
 *
 * - Shares `host.audio` (`AudioEngine`) unlocked `AudioContext` and `masterGain` (mute/volume/limiter).
 * - Authentic 1979 tactical military UHF/VHF radio bus: steep cascaded 380/420 Hz HPF + 2650/2450 Hz LPF,
 *   carbon-mic formant EQ (-3.5 dB @ 640 Hz, +5.8 dB @ 1680 Hz, +2.5 dB @ 2250 Hz), pre-AGC TX-gated
 *   modulated VHF static & micro-crackle bed, aggressive -22 dB / 8:1 radio AGC feeding an asymmetric
 *   soft-hard diode WaveShaper, plus electromechanical PTT clack & gritty VHF squelch open/close (`kssht`).
 * - Live `AnalyserNode` tapped on the radio bus driving the Left Column 254.30 MHz Oscilloscope.
 * - Strict non-overlapping priority voice queue (CRITICAL > HIGH > NORMAL > LOW) with per-event cooldowns.
 * - Grounded station-hardware acoustics: ElevenLabs bunker `mishap_explosion.mp3` (with offline procedural
 *   fallback), bunker HVAC ambience, mechanical CRT/trackball/rotary-switch ticks, ILS/hold relay latches,
 *   low-fatigue 485 Hz RAPCON conflict annunciator pulse, ATIS teletype bell double-taps, MU-TH-UR printer
 *   confirm pulses, distant muffled runway turbine rumble, and magnetic deck-arresting hardware.
 */
export class ApproachAudio {
  private hostAudio: AudioEngine;
  private ctx: AudioContext | null = null;

  // Main cartridge output bus -> hostAudio.getMasterOutputNode()
  private busOutput: GainNode | null = null;
  private sfxInput: GainNode | null = null;

  // Dedicated 1979 Military UHF/VHF Radio Processing Bus -> radioAnalyser -> radioAtcOutputGain -> busOutput
  private radioVoiceInput: GainNode | null = null;
  private radioSquelchInput: GainNode | null = null;
  private radioAtcOutputGain: GainNode | null = null;
  private radioHandsetInput: GainNode | null = null;
  private radioCarrierSrc: AudioBufferSourceNode | null = null;
  private radioCarrierLfo: OscillatorNode | null = null;
  private radioCarrierGain: GainNode | null = null;
  private radioCrackleSrc: AudioBufferSourceNode | null = null;
  private radioCrackleGain: GainNode | null = null;
  private radioAnalyser: AnalyserNode | null = null;
  private radioTimeDomainData: Float32Array<ArrayBuffer> | null = null;
  private radioBusNodes: AudioNode[] = [];
  private atcMuted: boolean;

  // Continuous RAPCON Bunker HVAC & Conflict Tension Ambient Bed
  private hvacNoiseSrc: AudioBufferSourceNode | null = null;
  private hvacLpFilter: BiquadFilterNode | null = null;
  private hvacGain: GainNode | null = null;
  private hvacHumOscA: OscillatorNode | null = null;
  private hvacHumOscB: OscillatorNode | null = null;
  private hvacHumGain: GainNode | null = null;
  private tensionOsc: OscillatorNode | null = null;
  private tensionLfo: OscillatorNode | null = null;
  private tensionGain: GainNode | null = null;
  private ambienceNodes: AudioNode[] = [];

  // Smoothed ambience state (frame-rate independent exponential smoothing)
  private curHvacGain = 0;
  private curHumGain = 0;
  private curTensionGain = 0;
  private curHvacCutoff = 148;

  // Shared synthesized noise & diode/clip waveshaper buffers
  private whiteNoiseBuffer: AudioBuffer | null = null;
  private pinkNoiseBuffer: AudioBuffer | null = null;
  private brownNoiseBuffer: AudioBuffer | null = null;
  private radioCrackleBuffer: AudioBuffer | null = null;
  private radioDiodeCurve: Float32Array<ArrayBuffer> | null = null;
  private heavySoftClipCurve: Float32Array<ArrayBuffer> | null = null;

  // Prefetched & decoded ElevenLabs VHF/UHF radio voice + bunker SFX assets (122 voice + 1 SFX = 123)
  private rawBuffers = new Map<ApproachAssetId, ArrayBuffer>();
  private decodedBuffers = new Map<ApproachAssetId, AudioBuffer>();
  private bufferOnsets = new Map<ApproachRadioClipId, number>();
  private bufferEnds = new Map<ApproachRadioClipId, number>();
  private prefetchStarted = false;
  private decodeInFlight = false;

  // Tracked transient Web Audio sources for instant clean stop on silenceAll()/unmount()
  private activeSources = new Set<AudioScheduledSourceNode>();

  // Non-overlapping Priority Radio Queue state
  private radioQueue: QueuedRadioItem[] = [];
  private activeTx: ActiveRadioTx | null = null;
  private pendingPreemptSources: AudioScheduledSourceNode[] = [];
  private radioSeqCounter = 0;
  private lastClipTriggerMs = new Map<ApproachRadioClipId, number>();
  private lastVectorAckMs = -1e9;
  private lastLocLockMs = -1e9;
  private lastJokerMs = -1e9;
  private lastMaydayMs = -1e9;
  private maydayToggle = false;
  private txEndTimer: number | null = null;
  private txNextTimer: number | null = null;

  // Oscilloscope visual metering state
  private smoothedRadioLevel = 0.03;

  // Procedural cooldowns & conflict alert pulse cadence
  private lastSweepTickMs = 0;
  private lastDragTickMs = 0;
  private lastLocChirpMs = 0;
  private lastRestrictedWarnMs = 0;
  private lastSpeedClickMs = 0;
  private conflictPulseTimer = 0;
  private conflictWasActive = false;
  private conflictActiveVoices = new Set<{ src: AudioScheduledSourceNode; gain: GainNode }>();

  private mounted = false;

  constructor(hostAudio: AudioEngine) {
    this.hostAudio = hostAudio;
    this.atcMuted = readPersistedAtcMuted();
  }

  public mount(): void {
    this.mounted = true;
    this.atcMuted = readPersistedAtcMuted();
    if (!this.prefetchStarted) {
      this.prefetchStarted = true;
      void this.prefetchApproachAssets();
    }
    this.ensureGraph();
    this.applyAtcOutputGain(false);
  }

  public unmount(): void {
    this.mounted = false;
    this.silenceAll();
    this.teardownGraph();
  }

  public getLoadedAudioStats(): ApproachLoadedAudioStats {
    return {
      fetched: this.rawBuffers.size,
      decoded: this.decodedBuffers.size,
      expected: EXPECTED_CLIP_COUNT,
      contextState: this.ctx?.state ?? 'uninitialized',
    };
  }

  public isConflictToneActive(): boolean {
    return this.conflictWasActive;
  }

  public getRadioQueueIds(): string[] {
    return this.radioQueue.map((q) => q.id);
  }

  public getRadioQueueLength(): number {
    return this.radioQueue.length;
  }

  public getSmoothedRadioLevel(): number {
    return Number(this.smoothedRadioLevel.toFixed(3));
  }

  public isMuted(): boolean {
    return this.hostAudio.isMuted();
  }

  public isAtcMuted(): boolean {
    return this.atcMuted;
  }

  public setAtcMuted(muted: boolean): void {
    const next = Boolean(muted);
    this.atcMuted = next;
    writePersistedAtcMuted(next);
    this.applyAtcOutputGain(true);
  }

  public toggleAtcMuted(): boolean {
    this.setAtcMuted(!this.atcMuted);
    return this.atcMuted;
  }

  public getAtcOutputGain(): number {
    if (this.radioAtcOutputGain) {
      return Number(this.radioAtcOutputGain.gain.value.toFixed(3));
    }
    return this.atcMuted ? 0 : ATC_NOMINAL_OUTPUT_GAIN;
  }

  private applyAtcOutputGain(smooth: boolean): void {
    const target = this.atcMuted ? 0 : ATC_NOMINAL_OUTPUT_GAIN;
    const now = this.ctx?.currentTime ?? 0;
    for (const node of [this.radioAtcOutputGain, this.radioHandsetInput]) {
      if (!node) continue;
      try {
        node.gain.cancelScheduledValues(now);
        if (smooth && this.ctx && this.ctx.state === 'running') {
          node.gain.setValueAtTime(node.gain.value, now);
          node.gain.linearRampToValueAtTime(target, now + 0.025);
        } else {
          node.gain.setValueAtTime(target, now);
        }
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Returns a ready-to-pass `ApproachAudioCallbacks` adapter for `ApproachSimulation`,
   * routing all 122 VHF/UHF radio clips and procedural RAPCON SFX with zero boilerplate.
   */
  public createSimulationCallbacks(): ApproachAudioCallbacks {
    return {
      onCheckin: (kind, activeRunway, callsign, meta) => {
        const sector: CompassSector = meta?.sector ?? 'N';
        const secLower = sector.toLowerCase() as CompassSectorLower;
        const secWord = compassSectorSpoken(sector);

        if (kind === 'MAYDAY') {
          this.maydayToggle = !this.maydayToggle;
          const clip: ApproachRadioClipId = this.maydayToggle
            ? 'mayday_bingo_1'
            : 'mayday_bingo_2';
          this.queueRadio(clip, {
            callsign,
            caption: `${callsign}: Mayday! Bingo fuel, priority landing!`,
            force: true,
          });
          return;
        }

        if (meta?.isMedevac) {
          this.queueRadio(`checkin_medevac_${secLower}`, {
            callsign,
            caption: `${callsign}, ${secWord}, priority inbound.`,
            force: meta.force ?? true,
          });
          return;
        }

        if (meta?.isTwoShip) {
          this.queueRadio(`checkin_twoship_${secLower}`, {
            callsign,
            caption: `${callsign} flight, ${secWord}, inbound, Pad Alpha.`,
            force: meta.force,
          });
          return;
        }

        if (callsign === 'VIPER-21' && sector === 'N' && kind === 'DROPSHIP') {
          this.queueRadio('checkin_viper_21_n', {
            callsign,
            caption: 'VIPER-21, north, inbound, Pad Alpha.',
            force: meta?.force,
          });
          return;
        }

        if (
          callsign === 'ATLAS-7' &&
          sector === 'E' &&
          kind === 'HEAVY' &&
          activeRunway === '27'
        ) {
          this.queueRadio('checkin_atlas_7_e', {
            callsign,
            caption: 'ATLAS-7, east, inbound, ILS Two-Seven.',
            force: meta?.force,
          });
          return;
        }

        if (kind === 'HEAVY') {
          const clip: ApproachRadioClipId = `checkin_rwy${activeRunway}_${secLower}`;
          this.queueRadio(clip, {
            callsign,
            caption: `${callsign}, ${secWord}, inbound, ILS ${runwaySpoken(activeRunway)}.`,
            force: meta?.force,
          });
          return;
        }

        if (kind === 'TUG') {
          this.queueRadio(`checkin_cradle_${secLower}`, {
            callsign,
            caption: `${callsign}, ${secWord}, inbound, Salvage Cradle.`,
            force: meta?.force,
          });
          return;
        }

        this.queueRadio(`checkin_pad_${secLower}`, {
          callsign,
          caption: `${callsign}, ${secWord}, inbound, Pad Alpha.`,
          force: meta?.force,
        });
      },
      onVectorAck: (callsign) => {
        const clip = resolveVectorAckClip(callsign);
        this.queueRadio(clip, {
          callsign,
          caption: `${callsign}: ${APPROACH_RADIO_CAPTIONS[clip]}`,
        });
      },
      onLocalizerLock: (target, pan, callsign) => {
        this.playLocalizerLockChirp(pan);
        const prefix = getCallsignPrefix(callsign);
        if (target === 'RWY_27') {
          const clip: ApproachRadioClipId = prefix === 'MULE' ? 'loc_rwy_27_aus' : 'loc_rwy_27';
          this.queueRadio(clip, { callsign, caption: `${callsign}: Established, Two-Seven.` });
        } else if (target === 'RWY_09') {
          const clip: ApproachRadioClipId = prefix === 'ATLAS' ? 'loc_rwy_09_aus' : 'loc_rwy_09';
          this.queueRadio(clip, { callsign, caption: `${callsign}: Established, Zero-Niner.` });
        } else if (target === 'RWY_36') {
          this.queueRadio('loc_rwy_36', {
            callsign,
            caption: `${callsign}: Established, Three-Six.`,
          });
        } else if (target === 'RWY_18') {
          this.queueRadio('loc_rwy_18', {
            callsign,
            caption: `${callsign}: Established, One-Eight.`,
          });
        } else if (target === 'PAD_ALPHA') {
          const useFemale =
            prefix === 'DUSTOFF' ||
            prefix === 'MEDEVAC' ||
            prefix === 'LIFEGUARD' ||
            prefix === 'CASEVAC' ||
            prefix === 'SABER';
          this.queueRadio(useFemale ? 'loc_pad_alpha_aus' : 'loc_pad_alpha', {
            callsign,
            caption: `${callsign}: Inbound, Pad Alpha.`,
          });
        } else {
          this.queueRadio('loc_cradle', {
            callsign,
            caption: `${callsign}: Locked on, Salvage Cradle.`,
          });
        }
      },
      onHoldEntered: (fixId, callsign) => {
        const pan = fixId === 'KRATO' ? -0.42 : fixId === 'BOREA' ? 0.4 : 0.35;
        this.playHoldSnapChirp(pan);
        const clip: ApproachRadioClipId =
          fixId === 'KRATO' ? 'hold_krato' : fixId === 'BOREA' ? 'hold_borea' : 'hold_vexis';
        this.queueRadio(clip, {
          callsign,
          caption: `${callsign}: Holding ${fixId}, right turns.`,
        });
      },
      onGoAround: (callsign, manual, reason) => {
        this.playGoAroundTone(0);
        const prefix = getCallsignPrefix(callsign);
        const clip: ApproachRadioClipId = manual
          ? 'go_around_waveoff'
          : reason?.startsWith('RWY SHIFT') || prefix === 'ATLAS' || prefix === 'MULE'
            ? 'go_around_missed'
            : 'go_around_unstable';
        this.queueRadio(clip, {
          callsign,
          caption: manual
            ? `${callsign}: Copy wave-off, climbing out.`
            : clip === 'go_around_missed'
              ? `${callsign}: Missed approach, going around!`
              : `${callsign}: Going around, unstable!`,
          force: manual,
        });
      },
      onJokerFuel: (callsign) => {
        const prefix = getCallsignPrefix(callsign);
        const useFemale =
          prefix === 'MULE' ||
          prefix === 'DUSTOFF' ||
          prefix === 'MEDEVAC' ||
          prefix === 'LIFEGUARD' ||
          prefix === 'CASEVAC' ||
          prefix === 'SABER' ||
          prefix === 'RAVEN';
        this.queueRadio(useFemale ? 'joker_fuel_2' : 'joker_fuel_1', {
          callsign,
          caption: `${callsign}: Joker fuel, need vectors.`,
        });
      },
      onMaydayBingo: (callsign) => {
        this.maydayToggle = !this.maydayToggle;
        const clip: ApproachRadioClipId = this.maydayToggle ? 'mayday_bingo_1' : 'mayday_bingo_2';
        this.queueRadio(clip, {
          callsign,
          caption: `${callsign}: Mayday! Bingo fuel, priority landing!`,
          force: true,
        });
      },
      onRunwayFlipWarning: (_pendingRunway, _pendingSecondary) => {
        this.playRunwayFlipWarningChime();
      },
      onAtisFlip: (newRunway, atisLetter, secondaryRunway) => {
        this.playRunwayReversalChime();
        const clip = resolveAtisFlipClip(newRunway, secondaryRunway);
        const rwyLabel = secondaryRunway
          ? `Runways ${newRunway} and ${secondaryRunway}`
          : `Runway ${newRunway}`;
        this.queueRadio(clip, {
          callsign: `ATIS ${atisLetter}`,
          caption: `INFO ${atisLetter} — Wind shift, ${rwyLabel} active.`,
          force: true,
        });
      },
      onSecondaryRunwayOpen: (secondaryRunway, atisLetter) => {
        this.playRunwayReversalChime();
        const clip: ApproachRadioClipId =
          secondaryRunway === '36' ? 'atis_flip_36' : 'atis_flip_18';
        this.queueRadio(clip, {
          callsign: `ATIS ${atisLetter}`,
          caption: `INFO ${atisLetter} — Crosswind ops, Runway ${secondaryRunway} active.`,
          force: true,
        });
      },
      onIonStormSpawn: (storm) => {
        this.queueRadio('wx_ion_storm', {
          callsign: 'RAPCON WX',
          caption: `All aircraft, ion static ${storm.label} on scope, expect comms jam.`,
        });
      },
      onBogeySpawn: (bogey) => {
        this.queueRadio('warn_bogey', {
          callsign: 'RAPCON',
          caption: `Primary target ${bogey.trackCode}, no transponder, watch separation.`,
        });
      },
      onConflictAlert: () => {
        // Zero spoken voiceover on Conflict Alerts; warm 1979 RAPCON console
        // 485 Hz annunciator pulse runs continuously via updateConflictAlertTone().
      },
      onConflictCleared: () => {
        this.stopConflictToneImmediately();
      },
      onRestrictedZoneAlert: (callsign) => {
        this.playRestrictedZoneWarning();
        this.queueRadio('warn_moa_r118', {
          callsign: 'RAPCON',
          caption: `Warning! ${callsign}, restricted zone R-118 — turn out immediately!`,
          force: true,
        });
      },
      onDepartureCleared: (callsign, runway, pan) => {
        this.playDepartureLaunchSfx(pan);
        const clip: ApproachRadioClipId = `dep_rolling_${runway}`;
        this.queueRadio(clip, {
          callsign,
          caption: `${callsign}: Cleared takeoff, ${runwaySpoken(runway)}, rolling.`,
        });
      },
      onDepartureComplete: (callsign) => {
        this.playBonusChime('departure');
        this.queueRadio('dep_airborne', {
          callsign,
          caption: `${callsign}: Airborne, switching departure.`,
        });
      },
      onSpeedChanged: (_callsign, mode) => {
        this.playSpeedAdjustClick(mode);
      },
      onTextbookIlsBonus: (_callsign) => {
        this.playBonusChime('ils');
      },
      onFumesSaveBonus: (_callsign) => {
        this.playBonusChime('fumes');
      },
      onStreakCommendation: (_streak, _title, sealRestored) => {
        this.playBonusChime(sealRestored ? 'seal_restored' : 'streak');
      },
      onGapLaunchBonus: (_callsign) => {
        this.playBonusChime('gap');
      },
      onMedevacBonus: (_callsign) => {
        this.playBonusChime('medevac');
      },
      onTouchdown: (kind, _target, pan, callsign, isSequenced) => {
        this.playTouchdownArrest(pan, kind === 'HEAVY');
        if (isSequenced) {
          this.playSequencedBonusChime();
        }
        const clip = resolveClearActiveClip(callsign, kind);
        this.queueRadio(clip, {
          callsign,
          caption: `${callsign}, clear of the active.`,
        });
      },
      onMishapBreach: (reason) => {
        // Zero spoken voiceover on Mishaps — clear low-priority chatter and play
        // ElevenLabs concrete-bunker concussive explosion synced to the 1.2s slow-mo freeze.
        this.stopConflictToneImmediately();
        this.clearLowPriorityRadioChatter();
        this.playMishapExplosion(reason);
      },
      onRadarSweepTick: () => {
        this.playRadarSweepTick();
      },
    };
  }

  /**
   * Immediately halts all active SFX, clears the radio transmission queue & timers,
   * and silences the RAPCON HVAC ambience and conflict alert tones.
   */
  public silenceAll(): void {
    this.clearRadioQueue(true);
    this.stopConflictToneImmediately();

    for (const src of this.activeSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already stopped sources
      }
    }
    this.activeSources.clear();
    this.conflictActiveVoices.clear();

    this.curHvacGain = 0;
    this.curHumGain = 0;
    this.curTensionGain = 0;
    this.conflictPulseTimer = 0;
    this.conflictWasActive = false;
    this.smoothedRadioLevel = 0.025;

    const now = this.ctx?.currentTime ?? 0;
    const gains = [
      this.hvacGain,
      this.hvacHumGain,
      this.tensionGain,
      this.radioCarrierGain,
      this.radioCrackleGain,
    ];
    for (const g of gains) {
      if (!g) continue;
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(0, now);
      } catch {
        // Ignore
      }
    }
  }

  public clearRadioQueue(stopActive = false): void {
    this.radioQueue = [];
    this.clearRadioTimers();

    if (stopActive) {
      this.cancelScheduledSources(this.pendingPreemptSources);
      this.pendingPreemptSources = [];

      if (this.activeTx) {
        const tx = this.activeTx;
        this.activeTx = null;
        const now = this.ctx?.currentTime ?? 0;
        try {
          if (tx.voiceGain) {
            tx.voiceGain.gain.cancelScheduledValues(now);
            tx.voiceGain.gain.setValueAtTime(0, now);
          }
          tx.voiceSource?.stop();
          tx.voiceSource?.disconnect();
        } catch {
          // Ignore
        }
        this.cancelScheduledSources(tx.fallbackOscs);
        this.cancelScheduledSources(tx.scheduledCloseSources);
        this.silenceRadioStaticBeds(now);
      }
    }
  }

  // ===========================================================================
  // PUBLIC RADIO QUEUE & OSCILLOSCOPE TELEMETRY API
  // ===========================================================================

  /**
   * Enqueues a VHF/UHF radio transmission with strict non-overlapping priority scheduling
   * and per-event cooldowns. Returns `true` if accepted into queue / started immediately.
   */
  public queueRadio(id: ApproachRadioClipId, options?: RadioQueueOptions): boolean {
    if (!this.mounted) return false;
    const nowMs = performance.now();
    const priority = options?.priority ?? getDefaultClipPriority(id);
    const force = options?.force ?? false;
    const callsign = options?.callsign ?? null;

    // 1. Per-event & category cooldown enforcement (prevents drag/alert spam while never silencing spawns)
    if (!force) {
      if (id.startsWith('vector_ack_') && nowMs - this.lastVectorAckMs < 3000) {
        return false;
      }
      if (id.startsWith('loc_') && nowMs - this.lastLocLockMs < 1400) {
        return false;
      }
      if (id.startsWith('joker_fuel_') && nowMs - this.lastJokerMs < 5500) {
        return false;
      }
      if (id.startsWith('mayday_bingo_') && nowMs - this.lastMaydayMs < 5500) {
        return false;
      }
      const cooldownSec = getDefaultClipCooldownSec(id);
      const lastMs = this.lastClipTriggerMs.get(id) ?? -1e9;
      if (nowMs - lastMs < cooldownSec * 1000) {
        return false;
      }
    }

    // 2. Drop LOW-priority chatter if queue already has >= 2 items so routine chatter never lags gameplay
    if (priority === 'LOW') {
      if (this.radioQueue.length >= 2) {
        return false;
      }
      if (this.activeTx?.id.startsWith('vector_ack_') && id.startsWith('vector_ack_')) {
        return false;
      }
      if (this.activeTx?.id === id) {
        return false;
      }
    }

    // 3. Deduplicate already queued identical clip ID (for check-ins & landings, keep distinct callsigns!)
    const existing = this.radioQueue.find((item) => {
      if (item.id !== id) return false;
      if (id.startsWith('checkin_') || id.startsWith('clear_')) {
        return item.callsign === callsign;
      }
      return true;
    });
    if (existing) {
      if (options?.callsign) existing.callsign = options.callsign;
      if (options?.caption) existing.text = options.caption;
      return false;
    }

    const item: QueuedRadioItem = {
      id,
      priority,
      callsign,
      text: options?.caption ?? APPROACH_RADIO_CAPTIONS[id],
      urgent: isUrgentClip(id, priority),
      enqueuedAtMs: nowMs,
      seq: ++this.radioSeqCounter,
    };

    this.lastClipTriggerMs.set(id, nowMs);
    if (id.startsWith('vector_ack_')) {
      this.lastVectorAckMs = nowMs;
    } else if (id.startsWith('loc_')) {
      this.lastLocLockMs = nowMs;
    } else if (id.startsWith('joker_fuel_')) {
      this.lastJokerMs = nowMs;
    } else if (id.startsWith('mayday_bingo_')) {
      this.lastMaydayMs = nowMs;
    }

    // 4. Priority-sorted insertion (CRITICAL > HIGH > NORMAL > LOW, FIFO within same tier)
    const itemRank = PRIORITY_RANK[item.priority];
    let insertIdx = this.radioQueue.length;
    for (let i = 0; i < this.radioQueue.length; i++) {
      if (itemRank > PRIORITY_RANK[this.radioQueue[i].priority]) {
        insertIdx = i;
        break;
      }
    }
    this.radioQueue.splice(insertIdx, 0, item);

    // 5. Cap queue depth at 6 by shedding lowest-priority tail entries (never drop CRITICAL/HIGH)
    while (this.radioQueue.length > 6) {
      let dropIdx = -1;
      for (let i = this.radioQueue.length - 1; i >= 0; i--) {
        if (this.radioQueue[i].priority === 'LOW') {
          dropIdx = i;
          break;
        }
      }
      if (dropIdx < 0) {
        for (let i = this.radioQueue.length - 1; i >= 0; i--) {
          if (this.radioQueue[i].priority === 'NORMAL') {
            dropIdx = i;
            break;
          }
        }
      }
      if (dropIdx >= 0) {
        this.radioQueue.splice(dropIdx, 1);
      } else {
        break;
      }
    }

    // 6. Start immediately ONLY if channel is completely idle (no active TX and no pending gap timer),
    //    or gracefully preempt routine chatter on CRITICAL
    if (!this.activeTx && this.txNextTimer === null) {
      this.clearRadioTimers();
      this.startNextRadioTx();
    } else if (this.activeTx && item.priority === 'CRITICAL') {
      const canPreemptLow = this.activeTx.priority === 'LOW';
      const canPreemptNormalForEmergency =
        this.activeTx.priority === 'NORMAL' &&
        (item.id.startsWith('mayday_bingo_') || item.id === 'warn_moa_r118');
      if (canPreemptLow || canPreemptNormalForEmergency) {
        this.preemptActiveTxForCritical();
      }
    }

    return true;
  }

  /**
   * Clears low-priority / routine chatter during high-impact incidents (e.g., mishap explosion)
   * while preserving any queued HIGH/CRITICAL advisories for post-freeze playback.
   */
  private clearLowPriorityRadioChatter(): void {
    this.radioQueue = this.radioQueue.filter(
      (item) => item.priority === 'CRITICAL' || item.priority === 'HIGH'
    );

    if (
      this.activeTx &&
      (this.activeTx.priority === 'LOW' || this.activeTx.priority === 'NORMAL')
    ) {
      const prev = this.activeTx;
      this.clearRadioTimers();
      this.activeTx = null;

      this.cancelScheduledSources(prev.scheduledCloseSources);

      if (this.ctx) {
        const now = this.ctx.currentTime;
        try {
          if (prev.voiceGain) {
            prev.voiceGain.gain.cancelScheduledValues(now);
            prev.voiceGain.gain.setValueAtTime(Math.max(0.0005, prev.voiceGain.gain.value), now);
            prev.voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
          }
          prev.voiceSource?.stop(now + 0.028);
        } catch {
          // Ignore
        }
        for (const osc of prev.fallbackOscs) {
          try {
            osc.stop(now + 0.022);
          } catch {
            // Ignore
          }
        }
        this.silenceRadioStaticBeds(now + 0.025);
      }

      // Always hold the post-mishap gap timer while the aborted voice fades out so incoming
      // transmissions never overlap `prev.voiceSource` or talk over the bunker explosion freeze.
      if (this.mounted) {
        this.txNextTimer = window.setTimeout(() => {
          this.txNextTimer = null;
          if (this.mounted && !this.activeTx && this.radioQueue.length > 0) {
            this.startNextRadioTx();
          }
        }, 1050);
      }
    }
  }

  public isRadioTransmitting(): boolean {
    return this.activeTx !== null;
  }

  public getActiveTransmission(): RadioTransmissionInfo | null {
    if (!this.activeTx) return null;
    return {
      id: this.activeTx.id,
      text: this.activeTx.text,
      callsign: this.activeTx.callsign,
      priority: this.activeTx.priority,
      urgent: this.activeTx.urgent,
    };
  }

  public getRadioOutputLevel(): number {
    if (this.radioAnalyser && this.radioTimeDomainData && this.ctx?.state === 'running') {
      this.radioAnalyser.getFloatTimeDomainData(this.radioTimeDomainData);
      let sumSq = 0;
      const buf = this.radioTimeDomainData;
      for (let i = 0; i < buf.length; i++) {
        sumSq += buf[i] * buf[i];
      }
      const rms = Math.sqrt(sumSq / buf.length);
      const liveLevel = Math.min(1, rms * 4.4);
      if (liveLevel > 0.012 || !this.activeTx) {
        const floor = this.activeTx ? 0.08 : 0.028;
        const target = Math.max(floor, liveLevel);
        this.smoothedRadioLevel += (target - this.smoothedRadioLevel) * 0.35;
        return this.smoothedRadioLevel;
      }
    }

    // Clean visual envelope fallback when audio context isn't unlocked yet
    if (this.activeTx) {
      const elapsedSec = (performance.now() - this.activeTx.startedAtMs) / 1000;
      const syllable =
        0.5 +
        0.3 * Math.sin(elapsedSec * 23.0) +
        0.2 * Math.sin(elapsedSec * 41.3 + 1.1);
      const target = Math.max(0.16, Math.min(0.92, syllable * (this.activeTx.urgent ? 0.95 : 0.78)));
      this.smoothedRadioLevel += (target - this.smoothedRadioLevel) * 0.35;
      return this.smoothedRadioLevel;
    }

    this.smoothedRadioLevel += (0.028 - this.smoothedRadioLevel) * 0.25;
    return this.smoothedRadioLevel;
  }

  /**
   * Fills `out` with normalized time-domain waveform samples in `[-1, 1]` from the
   * 254.30 MHz VHF/UHF radio bus `AnalyserNode` (or realistic carrier floor when idle)
   * and returns the current normalized radio output level `[0, 1]`.
   */
  public getRadioOscilloscopeSamples(out: Float32Array): number {
    const outLen = out.length;
    if (outLen === 0) return this.getRadioOutputLevel();

    const nowSec = performance.now() * 0.001;

    if (this.radioAnalyser && this.radioTimeDomainData && this.ctx?.state === 'running') {
      this.radioAnalyser.getFloatTimeDomainData(this.radioTimeDomainData);
      const src = this.radioTimeDomainData;
      let sumSq = 0;
      let peak = 0;
      for (let i = 0; i < src.length; i++) {
        const v = src[i];
        sumSq += v * v;
        const av = Math.abs(v);
        if (av > peak) peak = av;
      }
      const rms = Math.sqrt(sumSq / src.length);

      if (peak > 0.0035) {
        // Active live radio waveform (voice + squelch + carrier hiss)
        const boost = 2.4;
        for (let i = 0; i < outLen; i++) {
          const srcPos = (i / Math.max(1, outLen - 1)) * (src.length - 1);
          const idx0 = Math.floor(srcPos);
          const idx1 = Math.min(src.length - 1, idx0 + 1);
          const frac = srcPos - idx0;
          const sample = src[idx0] * (1 - frac) + src[idx1] * frac;
          out[i] = Math.max(-1, Math.min(1, sample * boost));
        }
        const level = Math.max(0.08, Math.min(1, rms * 4.4));
        this.smoothedRadioLevel += (level - this.smoothedRadioLevel) * 0.38;
        return this.smoothedRadioLevel;
      }
    }

    if (this.activeTx) {
      // Visual-only fallback when AudioContext is suspended prior to user gesture
      const elapsed = (performance.now() - this.activeTx.startedAtMs) * 0.001;
      const env =
        0.48 +
        0.28 * Math.sin(elapsed * 21.7) +
        0.18 * Math.sin(elapsed * 37.9 + 0.7);
      const amp = Math.max(0.18, Math.min(0.88, env * (this.activeTx.urgent ? 0.96 : 0.76)));
      for (let i = 0; i < outLen; i++) {
        const u = i / Math.max(1, outLen - 1);
        const carrier =
          Math.sin(u * Math.PI * 10 + nowSec * 48) * 0.55 +
          Math.sin(u * Math.PI * 23 - nowSec * 76) * 0.3 +
          Math.sin(u * Math.PI * 41 + nowSec * 112) * 0.15;
        const windowEnv = Math.sin(u * Math.PI);
        out[i] = Math.max(-1, Math.min(1, carrier * amp * (0.35 + 0.65 * windowEnv)));
      }
      this.smoothedRadioLevel += (amp - this.smoothedRadioLevel) * 0.35;
      return this.smoothedRadioLevel;
    }

    // Idle 254.30 MHz receiver squelch carrier baseline micro-noise
    for (let i = 0; i < outLen; i++) {
      const u = i / Math.max(1, outLen - 1);
      const phase = u * 29.0 + nowSec * 34.0;
      const micro =
        Math.sin(phase) * 0.018 +
        Math.sin(phase * 2.73 + 1.4) * 0.012 +
        Math.sin(phase * 5.91 - nowSec * 52.0) * 0.009;
      out[i] = micro;
    }
    this.smoothedRadioLevel += (0.028 - this.smoothedRadioLevel) * 0.25;
    return this.smoothedRadioLevel;
  }

  // ===========================================================================
  // PROCEDURAL RAPCON AUDIO LAYER
  // ===========================================================================

  /**
   * Updates the continuous subterranean RAPCON bunker HVAC air-handler hum,
   * warm 60Hz/120Hz CRT console transformer bed, and conflict sub-bass tension pulse.
   * Starts cleanly on user gesture and silences smoothly when paused/inactive/muted.
   */
  public updateAmbience(active: boolean, conflictActive: boolean, dt: number): void {
    if (!this.mounted) return;
    if (!active) {
      if (!this.ctx) return;
      const safeDt = Math.max(0.001, Math.min(0.1, dt));
      const fadeAlpha = 1 - Math.exp(-safeDt * 14);
      this.curHvacGain += (0 - this.curHvacGain) * fadeAlpha;
      this.curHumGain += (0 - this.curHumGain) * fadeAlpha;
      this.curTensionGain += (0 - this.curTensionGain) * fadeAlpha;
      if (this.curHvacGain < 0.0005) this.curHvacGain = 0;
      if (this.curHumGain < 0.0005) this.curHumGain = 0;
      if (this.curTensionGain < 0.0005) this.curTensionGain = 0;

      const now = this.ctx.currentTime;
      this.hvacGain?.gain.setValueAtTime(this.curHvacGain, now);
      this.hvacHumGain?.gain.setValueAtTime(this.curHumGain, now);
      this.tensionGain?.gain.setValueAtTime(this.curTensionGain, now);
      return;
    }

    if (!this.ensureGraph() || !this.ctx) return;

    const safeDt = Math.max(0.001, Math.min(0.1, dt));
    const smoothAlpha = 1 - Math.exp(-safeDt * 4.2);

    const targetHvac = conflictActive ? 0.165 : 0.135;
    const targetHum = conflictActive ? 0.044 : 0.036;
    const targetTension = conflictActive ? 0.052 : 0;
    const targetCutoff = conflictActive ? 195 : 148;

    this.curHvacGain += (targetHvac - this.curHvacGain) * smoothAlpha;
    this.curHumGain += (targetHum - this.curHumGain) * smoothAlpha;
    this.curTensionGain += (targetTension - this.curTensionGain) * (1 - Math.exp(-safeDt * 6.5));
    this.curHvacCutoff += (targetCutoff - this.curHvacCutoff) * smoothAlpha;

    const now = this.ctx.currentTime;
    this.hvacGain?.gain.setValueAtTime(this.curHvacGain, now);
    this.hvacHumGain?.gain.setValueAtTime(this.curHumGain, now);
    this.tensionGain?.gain.setValueAtTime(this.curTensionGain, now);
    this.hvacLpFilter?.frequency.setValueAtTime(this.curHvacCutoff, now);
  }

  /**
   * Subtle mechanical CRT deflection-yoke / sweep-index hardware tick on each radar revolution.
   */
  public playRadarSweepTick(intensity = 1.0): void {
    if (!this.mounted || this.hostAudio.isMuted()) return;
    const nowMs = performance.now();
    if (nowMs - this.lastSweepTickMs < 110) return;
    this.lastSweepTickMs = nowMs;

    if (!this.ensureGraph() || !this.ctx || !this.sfxInput) return;
    const now = this.ctx.currentTime;
    const level = Math.max(0.25, Math.min(1.4, intensity));

    // Grounded CRT phosphor yoke index tick (short filtered noise transient + damped low-mid body)
    this.playMechanicalClick(this.sfxInput, now, {
      noiseFreq: 1120,
      noiseQ: 1.5,
      noiseDur: 0.008,
      noiseAmp: 0.048 * level,
      bodyStartFreq: 275,
      bodyEndFreq: 112,
      bodyLpFreq: 620,
      bodyDur: 0.015,
      bodyAmp: 0.038 * level,
    });
  }

  /**
   * Authentic avionics relay latch + single muted 1020 Hz ILS marker carrier blip on localizer / pad lock.
   */
  public playLocalizerLockChirp(pan = 0): void {
    if (!this.mounted || this.hostAudio.isMuted()) return;
    const nowMs = performance.now();
    if (nowMs - this.lastLocChirpMs < 90) return;
    this.lastLocChirpMs = nowMs;

    if (!this.ensureGraph() || !this.ctx || !this.sfxInput) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(this.clampPan(pan), now);
    panner.connect(this.sfxInput);

    // 1. Physical CRT annunciator solenoid relay latch
    this.playMechanicalClick(panner, now, {
      noiseFreq: 1680,
      noiseQ: 1.4,
      noiseDur: 0.012,
      noiseAmp: 0.125,
      bodyStartFreq: 330,
      bodyEndFreq: 118,
      bodyLpFreq: 700,
      bodyDur: 0.019,
      bodyAmp: 0.115,
    });

    // 2. Single muted 1020 Hz damped ILS marker carrier blip (45ms, soft lowpass)
    this.playDampedCarrierPip(panner, now + 0.012, {
      freq: 1020,
      lpFreq: 1380,
      attackSec: 0.004,
      decaySec: 0.045,
      peakGain: 0.095,
      squareMix: 0.2,
    });
  }

  /**
   * Realistic, low-fatigue 1979 RAPCON console Conflict Alert annunciator pulse.
   * Warm, heavily damped electromechanical terminal alert (485 Hz band-limited square/sine
   * blend through 1050 Hz LPF, 14ms soft attack / 85ms decay, 0.065–0.115 gain).
   * Calm double-pulse cadence tightens from 0.90s at 3.0 NM to 0.50s at <= 1.0 NM and
   * cuts off instantaneously when separation restores.
   */
  public updateConflictAlertTone(active: boolean, minSepNm: number, dt: number): void {
    if (!this.mounted || !active || !Number.isFinite(minSepNm) || minSepNm >= 3.0) {
      if (this.conflictWasActive || this.conflictActiveVoices.size > 0) {
        this.stopConflictToneImmediately();
      } else {
        this.conflictPulseTimer = 0;
      }
      return;
    }

    const urgency = Math.max(0, Math.min(1, (3.0 - minSepNm) / 2.0));
    // Calm double-pulse cadence: 0.90s at 3.0 NM tightening smoothly to 0.50s at <= 1.0 NM
    const interval = 0.9 - urgency * 0.4;

    if (!this.conflictWasActive) {
      this.conflictWasActive = true;
      this.conflictPulseTimer = 0;
      this.playConflictAlertPip(urgency);
      return;
    }

    this.conflictPulseTimer += Math.max(0, Math.min(0.1, dt));
    if (this.conflictPulseTimer >= interval) {
      this.conflictPulseTimer = 0;
      this.playConflictAlertPip(urgency);
    }
  }

  private stopConflictToneImmediately(): void {
    this.conflictWasActive = false;
    this.conflictPulseTimer = 0;

    if (this.conflictActiveVoices.size === 0) return;
    const now = this.ctx?.currentTime ?? 0;
    const mutedGates = new Set<GainNode>();
    for (const voice of this.conflictActiveVoices) {
      if (!mutedGates.has(voice.gain)) {
        mutedGates.add(voice.gain);
        try {
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
          voice.gain.gain.linearRampToValueAtTime(0.0001, now + 0.009);
          voice.gain.gain.setValueAtTime(0, now + 0.01);
        } catch {
          // Ignore
        }
      }
      try {
        voice.src.stop(now + 0.011);
      } catch {
        // Ignore already-stopped oscillators
      }
    }
    this.conflictActiveVoices.clear();
  }

  private playConflictAlertPip(urgency: number): void {
    if (this.hostAudio.isMuted()) return;
    if (!this.ensureGraph() || !this.ctx || !this.sfxInput) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Restrained, low-fatigue gain: 0.065 at 3.0 NM -> 0.115 at <= 1.0 NM
    const peakGain = 0.065 + urgency * 0.05;
    const attackSec = 0.014;
    const holdSec = 0.016;
    const decaySec = 0.085;
    const secondPulseOffset = 0.145 - urgency * 0.025;

    // Warm, heavily damped console annunciator LPF at 1050 Hz (zero piercing harmonics)
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1050, now);
    lp.Q.value = 0.72;
    lp.connect(this.sfxInput);

    // Master pulse gate for instant click-free cutoff on stopConflictToneImmediately()
    const pulseGate = ctx.createGain();
    pulseGate.gain.setValueAtTime(1.0, now);
    pulseGate.connect(lp);

    // Calm double-pulse at a single grounded electromechanical 485 Hz carrier (no musical interval)
    for (let idx = 0; idx < 2; idx++) {
      const t0 = now + idx * secondPulseOffset;
      const tAttackEnd = t0 + attackSec;
      const tHoldEnd = tAttackEnd + holdSec;
      const tEnd = tHoldEnd + decaySec;
      const pulseScale = idx === 0 ? 1.0 : 0.88;

      const oscSine = ctx.createOscillator();
      const oscSq = ctx.createOscillator();
      oscSine.type = 'sine';
      oscSq.type = 'square';
      oscSine.frequency.setValueAtTime(485, t0);
      oscSq.frequency.setValueAtTime(485, t0);

      const gSine = ctx.createGain();
      gSine.gain.setValueAtTime(0.0001, t0);
      gSine.gain.linearRampToValueAtTime(peakGain * 0.72 * pulseScale, tAttackEnd);
      gSine.gain.setValueAtTime(peakGain * 0.68 * pulseScale, tHoldEnd);
      gSine.gain.exponentialRampToValueAtTime(0.0001, tEnd);

      const gSq = ctx.createGain();
      gSq.gain.setValueAtTime(0.0001, t0);
      gSq.gain.linearRampToValueAtTime(peakGain * 0.28 * pulseScale, tAttackEnd);
      gSq.gain.setValueAtTime(peakGain * 0.25 * pulseScale, tHoldEnd);
      gSq.gain.exponentialRampToValueAtTime(0.0001, tEnd);

      oscSine.connect(gSine);
      oscSq.connect(gSq);
      gSine.connect(pulseGate);
      gSq.connect(pulseGate);

      this.trackSource(oscSine);
      this.trackSource(oscSq);

      const voiceSine = { src: oscSine, gain: pulseGate };
      const voiceSq = { src: oscSq, gain: pulseGate };
      this.conflictActiveVoices.add(voiceSine);
      this.conflictActiveVoices.add(voiceSq);
      oscSine.addEventListener('ended', () => {
        this.conflictActiveVoices.delete(voiceSine);
      });
      oscSq.addEventListener('ended', () => {
        this.conflictActiveVoices.delete(voiceSq);
      });

      oscSine.start(t0);
      oscSq.start(t0);
      oscSine.stop(tEnd + 0.015);
      oscSq.stop(tEnd + 0.015);

      // Subtle electromechanical annunciator relay contact micro-tick on each pulse
      if (this.whiteNoiseBuffer) {
        const tickSrc = ctx.createBufferSource();
        tickSrc.buffer = this.whiteNoiseBuffer;

        const tickBp = ctx.createBiquadFilter();
        tickBp.type = 'bandpass';
        tickBp.frequency.setValueAtTime(1250, t0);
        tickBp.Q.value = 1.6;

        const tickG = ctx.createGain();
        tickG.gain.setValueAtTime(0.0001, t0);
        tickG.gain.linearRampToValueAtTime(0.026 * pulseScale, t0 + 0.002);
        tickG.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.01);

        tickSrc.connect(tickBp);
        tickBp.connect(tickG);
        tickG.connect(pulseGate);
        this.trackSource(tickSrc);

        const voiceTick = { src: tickSrc, gain: pulseGate };
        this.conflictActiveVoices.add(voiceTick);
        tickSrc.addEventListener('ended', () => {
          this.conflictActiveVoices.delete(voiceTick);
        });
        tickSrc.start(t0, Math.random() * 0.7, 0.014);
      }
    }
  }

  /**
   * Heavy magnetic arresting / docking CLUNK + steel clank + pressurized pneumatic hiss
   * + subtle mechanical deck-lock relay click on touchdown (zero musical chime).
   */
  public playTouchdownArrest(pan = 0, isHeavy = false): void {
    if (!this.mounted || this.hostAudio.isMuted()) return;
    if (!this.ensureGraph() || !this.ctx || !this.sfxInput) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(this.clampPan(pan), now);
    panner.connect(this.sfxInput);

    // 1. Heavy magnetic arresting clamp structural THUNK
    const thunk = ctx.createOscillator();
    thunk.type = 'triangle';
    thunk.frequency.setValueAtTime(isHeavy ? 114 : 148, now);
    thunk.frequency.exponentialRampToValueAtTime(isHeavy ? 28 : 42, now + (isHeavy ? 0.28 : 0.19));

    const shaper = ctx.createWaveShaper();
    shaper.curve = this.heavySoftClipCurve;

    const thunkLp = ctx.createBiquadFilter();
    thunkLp.type = 'lowpass';
    thunkLp.frequency.setValueAtTime(isHeavy ? 340 : 480, now);

    const thunkGain = ctx.createGain();
    thunkGain.gain.setValueAtTime(0.0001, now);
    thunkGain.gain.linearRampToValueAtTime(isHeavy ? 0.42 : 0.31, now + 0.006);
    thunkGain.gain.exponentialRampToValueAtTime(0.0001, now + (isHeavy ? 0.34 : 0.23));

    thunk.connect(shaper);
    shaper.connect(thunkLp);
    thunkLp.connect(thunkGain);
    thunkGain.connect(panner);
    this.trackSource(thunk);
    thunk.start(now);
    thunk.stop(now + (isHeavy ? 0.37 : 0.26));

    // 2. Metallic steel cradle / arresting hook CLANK (+8ms)
    const tLatch = now + 0.008;
    for (const [freq, amp] of [
      [isHeavy ? 285 : 370, 0.14],
      [isHeavy ? 690 : 880, 0.08],
    ] as const) {
      const metal = ctx.createOscillator();
      metal.type = 'square';
      metal.frequency.setValueAtTime(freq, tLatch);
      metal.frequency.exponentialRampToValueAtTime(freq * 0.72, tLatch + 0.055);

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(freq * 1.15, tLatch);
      bp.Q.value = 3.2;

      const mg = ctx.createGain();
      mg.gain.setValueAtTime(0.0001, tLatch);
      mg.gain.linearRampToValueAtTime(amp, tLatch + 0.003);
      mg.gain.exponentialRampToValueAtTime(0.0001, tLatch + 0.068);

      metal.connect(bp);
      bp.connect(mg);
      mg.connect(panner);
      this.trackSource(metal);
      metal.start(tLatch);
      metal.stop(tLatch + 0.08);
    }

    // 3. Pressurized pneumatic gear-compression / hydraulic bleed HISS (+24ms)
    if (this.pinkNoiseBuffer) {
      const tHiss = now + 0.024;
      const hissDur = isHeavy ? 0.36 : 0.22;
      const nSrc = ctx.createBufferSource();
      nSrc.buffer = this.pinkNoiseBuffer;

      const nBp = ctx.createBiquadFilter();
      nBp.type = 'bandpass';
      nBp.frequency.setValueAtTime(isHeavy ? 1850 : 2300, tHiss);
      nBp.frequency.exponentialRampToValueAtTime(620, tHiss + hissDur);
      nBp.Q.value = 1.15;

      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.0001, tHiss);
      nGain.gain.linearRampToValueAtTime(isHeavy ? 0.2 : 0.15, tHiss + 0.018);
      nGain.gain.exponentialRampToValueAtTime(0.0001, tHiss + hissDur);

      nSrc.connect(nBp);
      nBp.connect(nGain);
      nGain.connect(panner);
      this.trackSource(nSrc);
      nSrc.start(tHiss, Math.random() * 0.8, hissDur + 0.02);
    }

    // 4. Subtle mechanical deck-lock solenoid relay click (+95ms, zero musical chime)
    this.playMechanicalClick(panner, now + 0.095, {
      noiseFreq: 1420,
      noiseQ: 1.5,
      noiseDur: 0.011,
      noiseAmp: 0.095,
      bodyStartFreq: isHeavy ? 265 : 315,
      bodyEndFreq: isHeavy ? 105 : 128,
      bodyLpFreq: 740,
      bodyDur: 0.019,
      bodyAmp: 0.085,
    });
  }

  /**
   * Grounded concrete-bunker concussive mishap explosion synchronized to the 1.2s slow-mo freeze.
   * Plays the decoded ElevenLabs `mishap_explosion.mp3` through a dedicated punchy 120 Hz low-shelf
   * bus with a light bunker sub-bass rumble tail; uses procedural multi-layer synthesis strictly as
   * an offline fallback when the MP3 is not decoded yet. Zero spoken voiceover.
   */
  public playMishapExplosion(reason?: 'COLLISION' | 'FLAMEOUT' | 'RESTRICTED_ZONE'): void {
    if (!this.mounted || this.hostAudio.isMuted()) return;
    if (!this.ensureGraph() || !this.ctx || !this.sfxInput) return;

    const mishapBuf = this.decodedBuffers.get('mishap_explosion');
    if (!mishapBuf) {
      this.playProceduralMishapExplosionFallback(reason);
      return;
    }

    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 1. ElevenLabs concrete-bunker explosion routed through punchy 120 Hz low-shelf bus
    const src = ctx.createBufferSource();
    src.buffer = mishapBuf;
    const rate = reason === 'COLLISION' ? 0.97 : reason === 'RESTRICTED_ZONE' ? 1.03 : 0.94;
    src.playbackRate.setValueAtTime(rate, now);

    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.setValueAtTime(120, now);
    lowShelf.gain.setValueAtTime(4.5, now);

    const sfxGain = ctx.createGain();
    sfxGain.gain.setValueAtTime(0.001, now);
    sfxGain.gain.linearRampToValueAtTime(0.96, now + 0.008);

    src.connect(lowShelf);
    lowShelf.connect(sfxGain);
    sfxGain.connect(this.sfxInput);

    this.trackSource(src);
    src.start(now);

    // 2. Light concrete-bunker sub-bass rumble tail underneath the shockwave
    const tTailStart = now + 0.05;
    const tTailPeak = now + 0.24;
    const tTailEnd = now + 1.45;

    const tailLp = ctx.createBiquadFilter();
    tailLp.type = 'lowpass';
    tailLp.frequency.setValueAtTime(96, tTailStart);
    tailLp.frequency.exponentialRampToValueAtTime(44, tTailEnd);
    tailLp.Q.value = 0.95;

    const tailGain = ctx.createGain();
    tailGain.gain.setValueAtTime(0.0001, tTailStart);
    tailGain.gain.linearRampToValueAtTime(0.18, tTailPeak);
    tailGain.gain.setValueAtTime(0.14, tTailPeak + 0.25);
    tailGain.gain.exponentialRampToValueAtTime(0.0001, tTailEnd);

    tailLp.connect(tailGain);
    tailGain.connect(this.sfxInput);

    const subTail = ctx.createOscillator();
    subTail.type = 'sine';
    subTail.frequency.setValueAtTime(52, tTailStart);
    subTail.frequency.exponentialRampToValueAtTime(32, tTailEnd);
    const subTailMix = ctx.createGain();
    subTailMix.gain.value = 0.65;
    subTail.connect(subTailMix);
    subTailMix.connect(tailLp);
    this.trackSource(subTail);
    subTail.start(tTailStart);
    subTail.stop(tTailEnd + 0.03);

    if (this.brownNoiseBuffer) {
      const rumbleNoise = ctx.createBufferSource();
      rumbleNoise.buffer = this.brownNoiseBuffer;
      rumbleNoise.loop = true;
      const rumbleMix = ctx.createGain();
      rumbleMix.gain.value = 0.55;
      rumbleNoise.connect(rumbleMix);
      rumbleMix.connect(tailLp);
      this.trackSource(rumbleNoise);
      rumbleNoise.start(tTailStart, Math.random() * 1.2, tTailEnd - tTailStart + 0.03);
    }
  }

  /**
   * Offline procedural 4-layer bunker explosion fallback used ONLY if `mishap_explosion.mp3`
   * has not been decoded yet.
   */
  private playProceduralMishapExplosionFallback(
    reason?: 'COLLISION' | 'FLAMEOUT' | 'RESTRICTED_ZONE'
  ): void {
    if (!this.ctx || !this.sfxInput) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Layer 1 (Sub-Bass Seismic Drop): 98 Hz -> 22 Hz sine+triangle through heavySoftClipCurve + 220 Hz LPF (0.95s)
    const subSine = ctx.createOscillator();
    subSine.type = 'sine';
    subSine.frequency.setValueAtTime(98, now);
    subSine.frequency.exponentialRampToValueAtTime(22, now + 0.86);

    const subTri = ctx.createOscillator();
    subTri.type = 'triangle';
    subTri.frequency.setValueAtTime(98, now);
    subTri.frequency.exponentialRampToValueAtTime(22, now + 0.82);

    const subTriMix = ctx.createGain();
    subTriMix.gain.value = 0.44;

    const subShaper = ctx.createWaveShaper();
    subShaper.curve = this.heavySoftClipCurve;
    subShaper.oversample = '2x';

    const subLp = ctx.createBiquadFilter();
    subLp.type = 'lowpass';
    subLp.frequency.setValueAtTime(220, now);
    subLp.Q.value = 0.85;

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.linearRampToValueAtTime(0.58, now + 0.006);
    subGain.gain.setValueAtTime(0.52, now + 0.048);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);

    subSine.connect(subShaper);
    subTri.connect(subTriMix);
    subTriMix.connect(subShaper);
    subShaper.connect(subLp);
    subLp.connect(subGain);
    subGain.connect(this.sfxInput);

    this.trackSource(subSine);
    this.trackSource(subTri);
    subSine.start(now);
    subTri.start(now);
    subSine.stop(now + 0.98);
    subTri.stop(now + 0.98);

    // Layer 2 (Concussive Blast Roar): Brown + pink noise burst through sweeping resonant LPF (1200 Hz -> 130 Hz over 1.15s)
    if (this.brownNoiseBuffer && this.pinkNoiseBuffer) {
      const stereoSides: Array<{ pan: number; delay: number; startFreq: number; q: number }> = [
        { pan: -0.26, delay: 0.004, startFreq: 1220, q: 2.0 },
        { pan: 0.26, delay: 0.011, startFreq: 1180, q: 2.15 },
      ];
      for (const side of stereoSides) {
        const t0 = now + side.delay;
        const roarPanner = ctx.createStereoPanner();
        roarPanner.pan.setValueAtTime(side.pan, t0);
        roarPanner.connect(this.sfxInput);

        const roarLp = ctx.createBiquadFilter();
        roarLp.type = 'lowpass';
        roarLp.frequency.setValueAtTime(side.startFreq, t0);
        roarLp.frequency.exponentialRampToValueAtTime(130, t0 + 1.15);
        roarLp.Q.value = side.q;

        const roarEnv = ctx.createGain();
        roarEnv.gain.setValueAtTime(0.0001, t0);
        roarEnv.gain.linearRampToValueAtTime(0.86, t0 + 0.012);
        roarEnv.gain.setValueAtTime(0.76, t0 + 0.11);
        roarEnv.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.15);

        roarLp.connect(roarEnv);
        roarEnv.connect(roarPanner);

        const brownSrc = ctx.createBufferSource();
        brownSrc.buffer = this.brownNoiseBuffer;
        brownSrc.loop = true;
        const brownMix = ctx.createGain();
        brownMix.gain.value = 0.28;
        brownSrc.connect(brownMix);
        brownMix.connect(roarLp);
        this.trackSource(brownSrc);
        brownSrc.start(t0, Math.random() * 1.4, 1.18);

        const pinkSrc = ctx.createBufferSource();
        pinkSrc.buffer = this.pinkNoiseBuffer;
        pinkSrc.loop = true;
        const pinkMix = ctx.createGain();
        pinkMix.gain.value = 0.19;
        pinkSrc.connect(pinkMix);
        pinkMix.connect(roarLp);
        this.trackSource(pinkSrc);
        pinkSrc.start(t0, Math.random() * 0.9, 1.18);
      }
    }

    // Layer 3 (Metallic Bulkhead Rattle): staggered bandpassed metallic clangs
    const clangs: Array<{
      offset: number;
      freq: number;
      overtone: number;
      dur: number;
      amp: number;
      pan: number;
    }> = [
      { offset: 0.022, freq: 290, overtone: 421, dur: 0.25, amp: 0.24, pan: -0.24 },
      { offset: 0.058, freq: 610, overtone: 868, dur: 0.2, amp: 0.19, pan: 0.24 },
    ];
    if (reason === 'RESTRICTED_ZONE') {
      clangs.push({ offset: 0.082, freq: 465, overtone: 692, dur: 0.17, amp: 0.16, pan: -0.08 });
    }
    for (const c of clangs) {
      const t0 = now + c.offset;
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(c.pan, t0);
      panner.connect(this.sfxInput);

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(c.freq, t0);
      bp.Q.value = 3.8;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(c.amp, t0 + 0.003);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + c.dur);

      bp.connect(env);
      env.connect(panner);

      const oscMain = ctx.createOscillator();
      oscMain.type = 'sawtooth';
      oscMain.frequency.setValueAtTime(c.freq, t0);
      oscMain.frequency.exponentialRampToValueAtTime(c.freq * 0.84, t0 + c.dur);

      const oscOver = ctx.createOscillator();
      oscOver.type = 'square';
      oscOver.frequency.setValueAtTime(c.overtone, t0);
      oscOver.frequency.exponentialRampToValueAtTime(c.overtone * 0.88, t0 + c.dur * 0.85);

      const overMix = ctx.createGain();
      overMix.gain.value = 0.55;

      oscMain.connect(bp);
      oscOver.connect(overMix);
      overMix.connect(bp);

      this.trackSource(oscMain);
      this.trackSource(oscOver);
      oscMain.start(t0);
      oscOver.start(t0);
      oscMain.stop(t0 + c.dur + 0.018);
      oscOver.stop(t0 + c.dur + 0.018);
    }

    if (this.whiteNoiseBuffer) {
      const shards: Array<{ offset: number; freq: number; dur: number; amp: number; pan: number }> = [
        { offset: 0.02, freq: 2680, dur: 0.036, amp: 0.36, pan: -0.18 },
        { offset: 0.05, freq: 3760, dur: 0.028, amp: 0.29, pan: 0.2 },
        { offset: 0.084, freq: 3180, dur: 0.042, amp: 0.25, pan: -0.06 },
      ];
      for (const sh of shards) {
        const t0 = now + sh.offset;
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(sh.pan, t0);
        panner.connect(this.sfxInput);

        const nSrc = ctx.createBufferSource();
        nSrc.buffer = this.whiteNoiseBuffer;
        nSrc.loop = true;

        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(sh.freq, t0);
        bp.Q.value = 1.85;

        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.0001, t0);
        ng.gain.linearRampToValueAtTime(sh.amp, t0 + 0.002);
        ng.gain.exponentialRampToValueAtTime(0.0001, t0 + sh.dur);

        nSrc.connect(bp);
        bp.connect(ng);
        ng.connect(panner);
        this.trackSource(nSrc);
        nSrc.start(t0, Math.random() * 0.7, sh.dur + 0.012);
      }
    }

    // Layer 4 (Muffled Bunker Pressure Wave Tail): Low-pass filtered sub rumble tail (55 Hz, 0.35s..1.25s)
    const tTailStart = now + 0.16;
    const tTailPeak = now + 0.35;
    const tTailEnd = now + 1.25;

    const tailLp = ctx.createBiquadFilter();
    tailLp.type = 'lowpass';
    tailLp.frequency.setValueAtTime(84, tTailStart);
    tailLp.frequency.exponentialRampToValueAtTime(52, tTailEnd);
    tailLp.Q.value = 1.05;

    const tailGain = ctx.createGain();
    tailGain.gain.setValueAtTime(0.0001, tTailStart);
    tailGain.gain.linearRampToValueAtTime(0.28, tTailPeak);
    tailGain.gain.setValueAtTime(0.24, tTailPeak + 0.18);
    tailGain.gain.exponentialRampToValueAtTime(0.0001, tTailEnd);

    tailLp.connect(tailGain);
    tailGain.connect(this.sfxInput);

    const tailOsc = ctx.createOscillator();
    tailOsc.type = 'sine';
    tailOsc.frequency.setValueAtTime(55, tTailStart);
    tailOsc.frequency.exponentialRampToValueAtTime(42, tTailEnd);
    const tailOscMix = ctx.createGain();
    tailOscMix.gain.value = 0.75;
    tailOsc.connect(tailOscMix);
    tailOscMix.connect(tailLp);
    this.trackSource(tailOsc);
    tailOsc.start(tTailStart);
    tailOsc.stop(tTailEnd + 0.03);

    if (this.brownNoiseBuffer) {
      const tailNoise = ctx.createBufferSource();
      tailNoise.buffer = this.brownNoiseBuffer;
      tailNoise.loop = true;
      const tailNoiseMix = ctx.createGain();
      tailNoiseMix.gain.value = 0.65;
      tailNoise.connect(tailNoiseMix);
      tailNoiseMix.connect(tailLp);
      this.trackSource(tailNoise);
      tailNoise.start(tTailStart, Math.random() * 1.2, tTailEnd - tTailStart + 0.03);
    }
  }

  /**
   * Authentic avionics relay latch + single muted 820 Hz damped carrier blip on RNAV hold capture (`KRATO`/`VEXIS`).
   */
  public playHoldSnapChirp(pan = 0): void {
    if (!this.mounted || this.hostAudio.isMuted()) return;
    if (!this.ensureGraph() || !this.ctx || !this.sfxInput) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(this.clampPan(pan), now);
    panner.connect(this.sfxInput);

    // 1. Physical CRT annunciator relay latch
    this.playMechanicalClick(panner, now, {
      noiseFreq: 1380,
      noiseQ: 1.45,
      noiseDur: 0.012,
      noiseAmp: 0.115,
      bodyStartFreq: 280,
      bodyEndFreq: 106,
      bodyLpFreq: 640,
      bodyDur: 0.019,
      bodyAmp: 0.105,
    });

    // 2. Single muted 820 Hz damped hold-fix carrier blip (45ms, soft lowpass)
    this.playDampedCarrierPip(panner, now + 0.012, {
      freq: 820,
      lpFreq: 1140,
      attackSec: 0.004,
      decaySec: 0.045,
      peakGain: 0.09,
      squareMix: 0.18,
    });
  }

  /**
   * Grounded Flight Progress Strip plastic holder / CRT trackball select click (zero high-pitched sine bleep).
   */
  public playStripPing(pan = 0): void {
    if (!this.mounted || this.hostAudio.isMuted()) return;
    if (!this.ensureGraph() || !this.ctx || !this.sfxInput) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(this.clampPan(pan), now);
    panner.connect(this.sfxInput);

    // Tactile plastic strip holder / console select switch detent click
    this.playMechanicalClick(panner, now, {
      noiseFreq: 1520,
      noiseQ: 1.35,
      noiseDur: 0.01,
      noiseAmp: 0.105,
      bodyStartFreq: 410,
      bodyEndFreq: 150,
      bodyLpFreq: 900,
      bodyDur: 0.018,
      bodyAmp: 0.095,
    });
  }

  /**
   * Authentic ATIS wind-shift station status-board relay double-latch + teletype bell striker tap.
   */
  public playRunwayReversalChime(): void {
    if (!this.mounted || this.hostAudio.isMuted()) return;
    if (!this.ensureGraph() || !this.ctx || !this.sfxInput) return;

    const now = this.ctx.currentTime;

    // 1. Heavy station status-board split-flap solenoid double-latch
    this.playMechanicalClick(this.sfxInput, now, {
      noiseFreq: 1450,
      noiseQ: 1.3,
      noiseDur: 0.014,
      noiseAmp: 0.14,
      bodyStartFreq: 310,
      bodyEndFreq: 108,
      bodyLpFreq: 720,
      bodyDur: 0.022,
      bodyAmp: 0.13,
    });
    this.playMechanicalClick(this.sfxInput, now + 0.085, {
      noiseFreq: 1620,
      noiseQ: 1.35,
      noiseDur: 0.012,
      noiseAmp: 0.125,
      bodyStartFreq: 350,
      bodyEndFreq: 122,
      bodyLpFreq: 780,
      bodyDur: 0.02,
      bodyAmp: 0.115,
    });

    // 2. Damped ATIS teletype bell striker tap (inharmonic metallic bell resonance, zero melody)
    this.playTeletypeBellStrike(this.sfxInput, now + 0.14, 0.115);
  }

  /**
   * Crisp two-pulse muted station caution relay buzz (580 Hz damped lowpass + switch click) on Go-Around.
   */
  public playGoAroundTone(pan = 0): void {
    if (!this.mounted || this.hostAudio.isMuted()) return;
    if (!this.ensureGraph() || !this.ctx || !this.sfxInput) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(this.clampPan(pan), now);
    panner.connect(this.sfxInput);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1120, now);
    lp.Q.value = 0.78;
    lp.connect(panner);

    for (let i = 0; i < 2; i++) {
      const t0 = now + i * 0.115;

      // Mechanical caution switch relay click
      this.playMechanicalClick(panner, t0, {
        noiseFreq: 1460,
        noiseQ: 1.45,
        noiseDur: 0.009,
        noiseAmp: 0.095,
        bodyStartFreq: 315,
        bodyEndFreq: 118,
        bodyLpFreq: 680,
        bodyDur: 0.016,
        bodyAmp: 0.085,
      });

      // Muted 580 Hz damped caution relay buzz
      const tBuzz = t0 + 0.004;
      const dur = 0.068;
      const oscSq = ctx.createOscillator();
      const oscSaw = ctx.createOscillator();
      oscSq.type = 'square';
      oscSaw.type = 'sawtooth';
      oscSq.frequency.setValueAtTime(580, tBuzz);
      oscSaw.frequency.setValueAtTime(580 * 0.5, tBuzz);

      const gSq = ctx.createGain();
      gSq.gain.setValueAtTime(0.0001, tBuzz);
      gSq.gain.linearRampToValueAtTime(0.072, tBuzz + 0.007);
      gSq.gain.setValueAtTime(0.064, tBuzz + 0.026);
      gSq.gain.exponentialRampToValueAtTime(0.0001, tBuzz + dur);

      const gSaw = ctx.createGain();
      gSaw.gain.setValueAtTime(0.0001, tBuzz);
      gSaw.gain.linearRampToValueAtTime(0.032, tBuzz + 0.007);
      gSaw.gain.exponentialRampToValueAtTime(0.0001, tBuzz + dur);

      oscSq.connect(gSq);
      oscSaw.connect(gSaw);
      gSq.connect(lp);
      gSaw.connect(lp);

      this.trackSource(oscSq);
      this.trackSource(oscSaw);
      oscSq.start(tBuzz);
      oscSaw.start(tBuzz);
      oscSq.stop(tBuzz + dur + 0.015);
      oscSaw.stop(tBuzz + dur + 0.015);
    }
  }

  /**
   * Authentic ATIS Model-33 teletype bell / station status relay double-tap right at T-10s
   * before an impending runway reversal (metallic damped striker resonance + mechanical relay clicks).
   */
  public playRunwayFlipWarningChime(): void {
    if (!this.mounted || this.hostAudio.isMuted()) return;
    if (!this.ensureGraph() || !this.ctx || !this.sfxInput) return;

    const now = this.ctx.currentTime;
    const tapOffsets = [0.0, 0.145];

    for (let i = 0; i < tapOffsets.length; i++) {
      const t0 = now + tapOffsets[i];
      // Crisp station-status solenoid relay click
      this.playMechanicalClick(this.sfxInput, t0, {
        noiseFreq: 1650,
        noiseQ: 1.4,
        noiseDur: 0.011,
        noiseAmp: 0.115,
        bodyStartFreq: 340,
        bodyEndFreq: 125,
        bodyLpFreq: 760,
        bodyDur: 0.018,
        bodyAmp: 0.095,
      });

      // Damped metallic teletype bell striker resonance
      this.playTeletypeBellStrike(this.sfxInput, t0 + 0.006, i === 0 ? 0.105 : 0.12);
    }
  }

  /**
   * Grounded low electromechanical perimeter warning relay buzzer (285 Hz + 355 Hz reed beat,
   * bandpassed 480 Hz / LPF 980 Hz dual-pulse) for R-118 Restricted Zone violation.
   */
  public playRestrictedZoneWarning(): void {
    if (!this.mounted || this.hostAudio.isMuted()) return;
    const nowMs = performance.now();
    if (nowMs - this.lastRestrictedWarnMs < 420) return;
    this.lastRestrictedWarnMs = nowMs;

    if (!this.ensureGraph() || !this.ctx || !this.sfxInput) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(480, now);
    bp.Q.value = 1.45;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(980, now);
    lp.Q.value = 0.75;

    bp.connect(lp);
    lp.connect(this.sfxInput);

    // Non-musical electromechanical reed buzzer dual-pulse (285 Hz + 355 Hz)
    for (let idx = 0; idx < 2; idx++) {
      const t0 = now + idx * 0.165;
      const dur = 0.115;

      this.playMechanicalClick(this.sfxInput, t0, {
        noiseFreq: 1280,
        noiseQ: 1.5,
        noiseDur: 0.008,
        noiseAmp: 0.075,
        bodyStartFreq: 250,
        bodyEndFreq: 105,
        bodyLpFreq: 560,
        bodyDur: 0.015,
        bodyAmp: 0.068,
      });

      const oscLow = ctx.createOscillator();
      const oscReed = ctx.createOscillator();
      oscLow.type = 'sawtooth';
      oscReed.type = 'square';
      oscLow.frequency.setValueAtTime(285, t0);
      oscReed.frequency.setValueAtTime(355, t0);

      const gLow = ctx.createGain();
      gLow.gain.setValueAtTime(0.0001, t0);
      gLow.gain.linearRampToValueAtTime(0.105, t0 + 0.008);
      gLow.gain.setValueAtTime(0.095, t0 + dur - 0.026);
      gLow.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      const gReed = ctx.createGain();
      gReed.gain.setValueAtTime(0.0001, t0);
      gReed.gain.linearRampToValueAtTime(0.062, t0 + 0.008);
      gReed.gain.setValueAtTime(0.056, t0 + dur - 0.026);
      gReed.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      oscLow.connect(gLow);
      oscReed.connect(gReed);
      gLow.connect(bp);
      gReed.connect(bp);

      this.trackSource(oscLow);
      this.trackSource(oscReed);
      oscLow.start(t0);
      oscReed.start(t0);
      oscLow.stop(t0 + dur + 0.015);
      oscReed.stop(t0 + dur + 0.015);
    }
  }

  /**
   * Crisp mic PTT latch + muffled distant runway turbine/thruster rumble heard through concrete
   * bunker walls (lowpass-filtered brown+pink noise swell 180 -> 440 -> 160 Hz over 0.65s).
   */
  public playDepartureLaunchSfx(pan = 0): void {
    if (!this.mounted || this.hostAudio.isMuted()) return;
    if (!this.ensureGraph() || !this.ctx || !this.sfxInput) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(this.clampPan(pan), now);
    panner.connect(this.sfxInput);

    // 1. Crisp electromechanical mic PTT clearance latch (zero musical pips)
    this.playMechanicalClick(panner, now, {
      noiseFreq: 1850,
      noiseQ: 1.4,
      noiseDur: 0.011,
      noiseAmp: 0.13,
      bodyStartFreq: 420,
      bodyEndFreq: 155,
      bodyLpFreq: 860,
      bodyDur: 0.017,
      bodyAmp: 0.105,
    });

    // 2. Muffled distant runway turbine/thruster rumble through concrete bunker (0.65s swell)
    const tRumble = now + 0.028;
    const rumbleDur = 0.65;

    const concreteLp = ctx.createBiquadFilter();
    concreteLp.type = 'lowpass';
    concreteLp.frequency.setValueAtTime(180, tRumble);
    concreteLp.frequency.exponentialRampToValueAtTime(440, tRumble + 0.25);
    concreteLp.frequency.exponentialRampToValueAtTime(160, tRumble + rumbleDur);
    concreteLp.Q.value = 1.15;

    const rumbleEnv = ctx.createGain();
    rumbleEnv.gain.setValueAtTime(0.0001, tRumble);
    rumbleEnv.gain.linearRampToValueAtTime(0.32, tRumble + 0.21);
    rumbleEnv.gain.setValueAtTime(0.25, tRumble + 0.36);
    rumbleEnv.gain.exponentialRampToValueAtTime(0.0001, tRumble + rumbleDur);

    concreteLp.connect(rumbleEnv);
    rumbleEnv.connect(panner);

    if (this.brownNoiseBuffer) {
      const brownSrc = ctx.createBufferSource();
      brownSrc.buffer = this.brownNoiseBuffer;
      brownSrc.loop = true;
      const brownMix = ctx.createGain();
      brownMix.gain.value = 0.72;
      brownSrc.connect(brownMix);
      brownMix.connect(concreteLp);
      this.trackSource(brownSrc);
      brownSrc.start(tRumble, Math.random() * 1.4, rumbleDur + 0.03);
    }

    if (this.pinkNoiseBuffer) {
      const pinkSrc = ctx.createBufferSource();
      pinkSrc.buffer = this.pinkNoiseBuffer;
      pinkSrc.loop = true;
      const pinkMix = ctx.createGain();
      pinkMix.gain.value = 0.34;
      pinkSrc.connect(pinkMix);
      pinkMix.connect(concreteLp);
      this.trackSource(pinkSrc);
      pinkSrc.start(tRumble, Math.random() * 0.9, rumbleDur + 0.03);
    }

    // Subtle muffled structural sub-thrum from distant exhaust wave
    const subThrum = ctx.createOscillator();
    subThrum.type = 'sine';
    subThrum.frequency.setValueAtTime(66, tRumble);
    subThrum.frequency.exponentialRampToValueAtTime(92, tRumble + 0.24);
    subThrum.frequency.exponentialRampToValueAtTime(56, tRumble + rumbleDur);
    const subMix = ctx.createGain();
    subMix.gain.value = 0.14;
    subThrum.connect(subMix);
    subMix.connect(concreteLp);
    this.trackSource(subThrum);
    subThrum.start(tRumble);
    subThrum.stop(tRumble + rumbleDur + 0.03);
  }

  /**
   * Grounded 3-position military rotary-detent switch click when adjusting airspeed (`SLOW` / `STD` / `FAST`).
   * Short filtered noise transients + damped low-mid body clicks, zero high-pitched sine bleeps.
   */
  public playSpeedAdjustClick(mode: 'SLOW' | 'STD' | 'FAST'): void {
    if (!this.mounted || this.hostAudio.isMuted()) return;
    const nowMs = performance.now();
    if (nowMs - this.lastSpeedClickMs < 40) return;
    this.lastSpeedClickMs = nowMs;

    if (!this.ensureGraph() || !this.ctx || !this.sfxInput) return;
    const now = this.ctx.currentTime;

    const noiseFreq = mode === 'SLOW' ? 1160 : mode === 'FAST' ? 1920 : 1520;
    const bodyStart = mode === 'SLOW' ? 275 : mode === 'FAST' ? 495 : 380;
    const bodyEnd = mode === 'SLOW' ? 108 : mode === 'FAST' ? 188 : 146;

    // Primary rotary-switch detent snap
    this.playMechanicalClick(this.sfxInput, now, {
      noiseFreq,
      noiseQ: 1.55,
      noiseDur: 0.009,
      noiseAmp: 0.115,
      bodyStartFreq: bodyStart,
      bodyEndFreq: bodyEnd,
      bodyLpFreq: 860,
      bodyDur: 0.017,
      bodyAmp: 0.105,
    });

    // Subtle secondary spring-detent settle micro-click on extreme stops (SLOW / FAST)
    if (mode !== 'STD') {
      this.playMechanicalClick(this.sfxInput, now + 0.017, {
        noiseFreq: mode === 'FAST' ? 2150 : 980,
        noiseQ: 1.7,
        noiseDur: 0.007,
        noiseAmp: 0.06,
        bodyStartFreq: mode === 'FAST' ? 390 : 215,
        bodyEndFreq: mode === 'FAST' ? 160 : 95,
        bodyLpFreq: 720,
        bodyDur: 0.012,
        bodyAmp: 0.048,
      });
    }
  }

  /**
   * Understated 1979 MU-TH-UR terminal teletype/printer confirm pulses for tactical bonuses
   * (crisp mechanical key/relay clicks + short damped 960 Hz telemetry acknowledgment pip —
   * distinct subtle rhythm/timbre per bonus type, zero musical triads or video-game melodies).
   */
  public playBonusChime(
    kind: 'ils' | 'fumes' | 'departure' | 'sequenced' | 'streak' | 'seal_restored' | 'medevac' | 'gap'
  ): void {
    if (!this.mounted || this.hostAudio.isMuted()) return;
    if (!this.ensureGraph() || !this.ctx || !this.sfxInput) return;

    const now = this.ctx.currentTime;

    if (kind === 'departure' || kind === 'gap') {
      // Single mechanical terminal key click + crisp 960 Hz handoff acknowledgment pip
      this.playMechanicalClick(this.sfxInput, now, {
        noiseFreq: kind === 'gap' ? 1760 : 1620,
        noiseQ: 1.45,
        noiseDur: 0.009,
        noiseAmp: 0.095,
        bodyStartFreq: kind === 'gap' ? 385 : 350,
        bodyEndFreq: 135,
        bodyLpFreq: 780,
        bodyDur: 0.015,
        bodyAmp: 0.08,
      });
      this.playDampedCarrierPip(this.sfxInput, now + 0.014, {
        freq: kind === 'gap' ? 1020 : 960,
        lpFreq: 1460,
        attackSec: 0.004,
        decaySec: 0.048,
        peakGain: 0.078,
        squareMix: 0.18,
      });
      if (kind === 'gap') {
        this.playDampedCarrierPip(this.sfxInput, now + 0.072, {
          freq: 1020,
          lpFreq: 1460,
          attackSec: 0.004,
          decaySec: 0.04,
          peakGain: 0.068,
          squareMix: 0.18,
        });
      }
      return;
    }

    if (kind === 'medevac') {
      // Crisp double-detent emergency-priority teletype ack + 1040 Hz damped telemetry pip
      this.playMechanicalClick(this.sfxInput, now, {
        noiseFreq: 1720,
        noiseQ: 1.5,
        noiseDur: 0.009,
        noiseAmp: 0.095,
        bodyStartFreq: 370,
        bodyEndFreq: 140,
        bodyLpFreq: 800,
        bodyDur: 0.015,
        bodyAmp: 0.078,
      });
      this.playMechanicalClick(this.sfxInput, now + 0.036, {
        noiseFreq: 1840,
        noiseQ: 1.5,
        noiseDur: 0.008,
        noiseAmp: 0.09,
        bodyStartFreq: 395,
        bodyEndFreq: 152,
        bodyLpFreq: 840,
        bodyDur: 0.014,
        bodyAmp: 0.072,
      });
      this.playDampedCarrierPip(this.sfxInput, now + 0.048, {
        freq: 1040,
        lpFreq: 1540,
        attackSec: 0.004,
        decaySec: 0.062,
        peakGain: 0.084,
        squareMix: 0.2,
      });
      return;
    }

    if (kind === 'streak' || kind === 'seal_restored') {
      // MU-TH-UR station commendation relay latch + crisp printer burst + authoritative confirm pip
      this.playMechanicalClick(this.sfxInput, now, {
        noiseFreq: 1480,
        noiseQ: 1.35,
        noiseDur: 0.012,
        noiseAmp: 0.115,
        bodyStartFreq: 310,
        bodyEndFreq: 112,
        bodyLpFreq: 700,
        bodyDur: 0.019,
        bodyAmp: 0.1,
      });
      const taps = kind === 'seal_restored' ? [0.028, 0.056, 0.084] : [0.03, 0.06];
      for (const tapOffset of taps) {
        this.playMechanicalClick(this.sfxInput, now + tapOffset, {
          noiseFreq: 1800,
          noiseQ: 1.55,
          noiseDur: 0.007,
          noiseAmp: 0.075,
          bodyStartFreq: 370,
          bodyEndFreq: 146,
          bodyLpFreq: 800,
          bodyDur: 0.012,
          bodyAmp: 0.06,
        });
      }
      this.playDampedCarrierPip(this.sfxInput, now + (kind === 'seal_restored' ? 0.1 : 0.074), {
        freq: kind === 'seal_restored' ? 880 : 960,
        lpFreq: 1440,
        attackSec: 0.005,
        decaySec: 0.064,
        peakGain: 0.084,
        squareMix: 0.22,
        subOctaveMix: kind === 'seal_restored' ? 0.2 : 0.12,
      });
      if (kind === 'seal_restored') {
        this.playDampedCarrierPip(this.sfxInput, now + 0.175, {
          freq: 1080,
          lpFreq: 1580,
          attackSec: 0.005,
          decaySec: 0.085,
          peakGain: 0.088,
          squareMix: 0.22,
          subOctaveMix: 0.18,
        });
      }
      return;
    }

    if (kind === 'ils') {
      // Rapid 2-click teletype verification punch + tight 960 Hz lock-verified telemetry pip
      this.playMechanicalClick(this.sfxInput, now, {
        noiseFreq: 1740,
        noiseQ: 1.5,
        noiseDur: 0.008,
        noiseAmp: 0.09,
        bodyStartFreq: 375,
        bodyEndFreq: 142,
        bodyLpFreq: 800,
        bodyDur: 0.014,
        bodyAmp: 0.072,
      });
      this.playMechanicalClick(this.sfxInput, now + 0.04, {
        noiseFreq: 1860,
        noiseQ: 1.5,
        noiseDur: 0.008,
        noiseAmp: 0.095,
        bodyStartFreq: 390,
        bodyEndFreq: 150,
        bodyLpFreq: 820,
        bodyDur: 0.014,
        bodyAmp: 0.076,
      });
      this.playDampedCarrierPip(this.sfxInput, now + 0.052, {
        freq: 960,
        lpFreq: 1520,
        attackSec: 0.004,
        decaySec: 0.054,
        peakGain: 0.082,
        squareMix: 0.22,
      });
      return;
    }

    if (kind === 'fumes') {
      // Authoritative MU-TH-UR carriage relay latch + 3-tap teletype print burst + warm 960 Hz confirm pip
      this.playMechanicalClick(this.sfxInput, now, {
        noiseFreq: 1420,
        noiseQ: 1.3,
        noiseDur: 0.013,
        noiseAmp: 0.12,
        bodyStartFreq: 295,
        bodyEndFreq: 108,
        bodyLpFreq: 680,
        bodyDur: 0.02,
        bodyAmp: 0.11,
      });
      for (const tapOffset of [0.028, 0.054, 0.08]) {
        this.playMechanicalClick(this.sfxInput, now + tapOffset, {
          noiseFreq: 1780,
          noiseQ: 1.6,
          noiseDur: 0.007,
          noiseAmp: 0.072,
          bodyStartFreq: 360,
          bodyEndFreq: 145,
          bodyLpFreq: 780,
          bodyDur: 0.011,
          bodyAmp: 0.055,
        });
      }
      this.playDampedCarrierPip(this.sfxInput, now + 0.096, {
        freq: 960,
        lpFreq: 1360,
        attackSec: 0.006,
        decaySec: 0.088,
        peakGain: 0.088,
        squareMix: 0.24,
        subOctaveMix: 0.22,
      });
      return;
    }

    // Default ('sequenced'): rapid 2-click printer stamp + crisp double-pulse 960 Hz telemetry confirm
    this.playMechanicalClick(this.sfxInput, now, {
      noiseFreq: 1650,
      noiseQ: 1.45,
      noiseDur: 0.008,
      noiseAmp: 0.088,
      bodyStartFreq: 345,
      bodyEndFreq: 132,
      bodyLpFreq: 760,
      bodyDur: 0.014,
      bodyAmp: 0.075,
    });
    this.playMechanicalClick(this.sfxInput, now + 0.035, {
      noiseFreq: 1740,
      noiseQ: 1.5,
      noiseDur: 0.008,
      noiseAmp: 0.085,
      bodyStartFreq: 365,
      bodyEndFreq: 140,
      bodyLpFreq: 780,
      bodyDur: 0.014,
      bodyAmp: 0.07,
    });
    this.playDampedCarrierPip(this.sfxInput, now + 0.046, {
      freq: 960,
      lpFreq: 1380,
      attackSec: 0.004,
      decaySec: 0.038,
      peakGain: 0.072,
      squareMix: 0.2,
    });
    this.playDampedCarrierPip(this.sfxInput, now + 0.104, {
      freq: 960,
      lpFreq: 1380,
      attackSec: 0.004,
      decaySec: 0.044,
      peakGain: 0.076,
      squareMix: 0.2,
    });
  }

  /**
   * Understated MU-TH-UR terminal printer confirmation for `+500 SEQUENCED` bonus.
   */
  public playSequencedBonusChime(): void {
    this.playBonusChime('sequenced');
  }

  /**
   * Ultra-subtle mechanical CRT trackball / optical-encoder detent tick while plotting a flight path.
   */
  public playDragWaypointTick(): void {
    if (!this.mounted || this.hostAudio.isMuted()) return;
    const nowMs = performance.now();
    if (nowMs - this.lastDragTickMs < 85) return;
    this.lastDragTickMs = nowMs;

    if (!this.ensureGraph() || !this.ctx || !this.sfxInput) return;
    const now = this.ctx.currentTime;

    this.playMechanicalClick(this.sfxInput, now, {
      noiseFreq: 1360,
      noiseQ: 1.55,
      noiseDur: 0.007,
      noiseAmp: 0.046,
      bodyStartFreq: 315,
      bodyEndFreq: 130,
      bodyLpFreq: 680,
      bodyDur: 0.011,
      bodyAmp: 0.028,
    });
  }

  // ===========================================================================
  // GROUNDED 1979 STATION-HARDWARE SYNTHESIS PRIMITIVES
  // ===========================================================================

  private playMechanicalClick(
    dest: AudioNode,
    startTime: number,
    cfg: {
      noiseFreq: number;
      noiseQ: number;
      noiseDur: number;
      noiseAmp: number;
      bodyStartFreq: number;
      bodyEndFreq: number;
      bodyLpFreq: number;
      bodyDur: number;
      bodyAmp: number;
    }
  ): AudioScheduledSourceNode[] {
    const created: AudioScheduledSourceNode[] = [];
    if (!this.ctx) return created;
    const ctx = this.ctx;

    // 1. Short bandpassed mechanical contact snap transient
    if (this.whiteNoiseBuffer && cfg.noiseAmp > 0) {
      const nSrc = ctx.createBufferSource();
      nSrc.buffer = this.whiteNoiseBuffer;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(cfg.noiseFreq, startTime);
      bp.Q.value = cfg.noiseQ;

      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, startTime);
      ng.gain.linearRampToValueAtTime(cfg.noiseAmp, startTime + 0.0015);
      ng.gain.exponentialRampToValueAtTime(0.0001, startTime + cfg.noiseDur);

      nSrc.connect(bp);
      bp.connect(ng);
      ng.connect(dest);
      this.trackSource(nSrc);
      nSrc.start(startTime, Math.random() * 0.7, cfg.noiseDur + 0.008);
      created.push(nSrc);
    }

    // 2. Damped low-mid solenoid / chassis body thud
    if (cfg.bodyAmp > 0) {
      const body = ctx.createOscillator();
      body.type = 'triangle';
      body.frequency.setValueAtTime(cfg.bodyStartFreq, startTime);
      body.frequency.exponentialRampToValueAtTime(cfg.bodyEndFreq, startTime + cfg.bodyDur);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(cfg.bodyLpFreq, startTime);
      lp.Q.value = 0.75;

      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, startTime);
      bg.gain.linearRampToValueAtTime(cfg.bodyAmp, startTime + 0.002);
      bg.gain.exponentialRampToValueAtTime(0.0001, startTime + cfg.bodyDur);

      body.connect(lp);
      lp.connect(bg);
      bg.connect(dest);
      this.trackSource(body);
      body.start(startTime);
      body.stop(startTime + cfg.bodyDur + 0.008);
      created.push(body);
    }

    return created;
  }

  private playDampedCarrierPip(
    dest: AudioNode,
    startTime: number,
    cfg: {
      freq: number;
      lpFreq: number;
      attackSec: number;
      decaySec: number;
      peakGain: number;
      squareMix: number;
      subOctaveMix?: number;
    }
  ): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const tPeak = startTime + cfg.attackSec;
    const tEnd = tPeak + cfg.decaySec;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cfg.lpFreq, startTime);
    lp.Q.value = 0.72;
    lp.connect(dest);

    const oscSine = ctx.createOscillator();
    oscSine.type = 'sine';
    oscSine.frequency.setValueAtTime(cfg.freq, startTime);

    const gSine = ctx.createGain();
    gSine.gain.setValueAtTime(0.0001, startTime);
    gSine.gain.linearRampToValueAtTime(cfg.peakGain * (1 - cfg.squareMix), tPeak);
    gSine.gain.exponentialRampToValueAtTime(0.0001, tEnd);

    oscSine.connect(gSine);
    gSine.connect(lp);
    this.trackSource(oscSine);
    oscSine.start(startTime);
    oscSine.stop(tEnd + 0.012);

    if (cfg.squareMix > 0) {
      const oscSq = ctx.createOscillator();
      oscSq.type = 'square';
      oscSq.frequency.setValueAtTime(cfg.freq, startTime);

      const gSq = ctx.createGain();
      gSq.gain.setValueAtTime(0.0001, startTime);
      gSq.gain.linearRampToValueAtTime(cfg.peakGain * cfg.squareMix, tPeak);
      gSq.gain.exponentialRampToValueAtTime(0.0001, tEnd);

      oscSq.connect(gSq);
      gSq.connect(lp);
      this.trackSource(oscSq);
      oscSq.start(startTime);
      oscSq.stop(tEnd + 0.012);
    }

    if (cfg.subOctaveMix && cfg.subOctaveMix > 0) {
      const oscSub = ctx.createOscillator();
      oscSub.type = 'sine';
      oscSub.frequency.setValueAtTime(cfg.freq * 0.5, startTime);

      const gSub = ctx.createGain();
      gSub.gain.setValueAtTime(0.0001, startTime);
      gSub.gain.linearRampToValueAtTime(cfg.peakGain * cfg.subOctaveMix, tPeak);
      gSub.gain.exponentialRampToValueAtTime(0.0001, tEnd);

      oscSub.connect(gSub);
      gSub.connect(lp);
      this.trackSource(oscSub);
      oscSub.start(startTime);
      oscSub.stop(tEnd + 0.012);
    }
  }

  /**
   * Metallic damped ATIS teletype bell striker resonance (inharmonic brass bell partials + hammer tap).
   */
  private playTeletypeBellStrike(dest: AudioNode, startTime: number, level: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2200, startTime);
    lp.Q.value = 0.75;
    lp.connect(dest);

    // Metallic hammer impact transient
    if (this.whiteNoiseBuffer) {
      const hitSrc = ctx.createBufferSource();
      hitSrc.buffer = this.whiteNoiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2400, startTime);
      bp.Q.value = 2.4;
      const hg = ctx.createGain();
      hg.gain.setValueAtTime(0.0001, startTime);
      hg.gain.linearRampToValueAtTime(level * 0.85, startTime + 0.0015);
      hg.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.012);
      hitSrc.connect(bp);
      bp.connect(hg);
      hg.connect(lp);
      this.trackSource(hitSrc);
      hitSrc.start(startTime, Math.random() * 0.7, 0.018);
    }

    // Inharmonic damped brass striker partials (Model-33 TTY bell ring — zero musical scale)
    const partials: Array<{ freq: number; amp: number; dur: number }> = [
      { freq: 1110, amp: level * 0.62, dur: 0.115 },
      { freq: 1742, amp: level * 0.34, dur: 0.088 },
      { freq: 2615, amp: level * 0.16, dur: 0.056 },
    ];
    for (const p of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(p.freq, startTime);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, startTime);
      g.gain.linearRampToValueAtTime(p.amp, startTime + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, startTime + p.dur);

      osc.connect(g);
      g.connect(lp);
      this.trackSource(osc);
      osc.start(startTime);
      osc.stop(startTime + p.dur + 0.012);
    }
  }

  // ===========================================================================
  // INTERNAL RADIO PLAYBACK, SQUELCH & QUEUE SCHEDULER
  // ===========================================================================

  private clearRadioTimers(): void {
    if (this.txEndTimer !== null) {
      window.clearTimeout(this.txEndTimer);
      this.txEndTimer = null;
    }
    if (this.txNextTimer !== null) {
      window.clearTimeout(this.txNextTimer);
      this.txNextTimer = null;
    }
  }

  private cancelScheduledSources(sources: AudioScheduledSourceNode[]): void {
    for (const src of sources) {
      try {
        src.stop();
      } catch {
        // Ignore already-stopped sources
      }
      try {
        src.disconnect();
      } catch {
        // Ignore already-disconnected sources
      }
      this.activeSources.delete(src);
    }
  }

  private preemptActiveTxForCritical(): void {
    const prev = this.activeTx;
    if (!prev) return;

    this.clearRadioTimers();
    this.activeTx = null;

    // Cancel any future pre-scheduled squelch-close sources from the preempted TX
    this.cancelScheduledSources(prev.scheduledCloseSources);
    this.cancelScheduledSources(this.pendingPreemptSources);
    this.pendingPreemptSources = [];

    if (this.ctx) {
      const now = this.ctx.currentTime;
      try {
        if (prev.voiceGain) {
          prev.voiceGain.gain.cancelScheduledValues(now);
          prev.voiceGain.gain.setValueAtTime(Math.max(0.001, prev.voiceGain.gain.value), now);
          prev.voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
        }
        prev.voiceSource?.stop(now + 0.03);
      } catch {
        // Ignore
      }
      for (const osc of prev.fallbackOscs) {
        try {
          osc.stop(now + 0.025);
        } catch {
          // Ignore
        }
      }
      this.pendingPreemptSources = this.triggerSquelchClose(now + 0.018, 0.78);
      this.silenceRadioStaticBeds(now + 0.042);
    }

    // 95ms preemption gap ensures prev.voiceSource (30ms) + preemption squelch-close (~92ms)
    // finish completely before the CRITICAL transmission opens squelch.
    this.txNextTimer = window.setTimeout(() => {
      this.txNextTimer = null;
      this.pendingPreemptSources = [];
      if (this.mounted && !this.activeTx) {
        this.startNextRadioTx();
      }
    }, 95);
  }

  private silenceRadioStaticBeds(atTime: number): void {
    for (const bed of [this.radioCarrierGain, this.radioCrackleGain]) {
      if (!bed) continue;
      try {
        bed.gain.cancelScheduledValues(atTime);
        bed.gain.setValueAtTime(0, atTime);
      } catch {
        // Ignore
      }
    }
  }

  private startNextRadioTx(): void {
    if (!this.mounted || this.activeTx || this.radioQueue.length === 0) return;

    const item = this.radioQueue.shift()!;
    const graphReady = this.ensureGraph();
    const ctx = this.ctx;

    if (!graphReady || !ctx || !this.radioVoiceInput || !this.radioSquelchInput) {
      // Visual-only oscilloscope fallback before AudioContext is unlocked
      const fallbackDurSec = 1.55;
      this.activeTx = {
        id: item.id,
        priority: item.priority,
        callsign: item.callsign,
        text: item.text,
        urgent: item.urgent,
        startedAtMs: performance.now(),
        durationSec: fallbackDurSec,
        voiceSource: null,
        voiceGain: null,
        fallbackOscs: [],
        scheduledCloseSources: [],
      };
      this.scheduleTxCompletion(fallbackDurSec * 1000);
      return;
    }

    const now = ctx.currentTime;
    const tOpen = now + 0.004;
    const decoded = this.decodedBuffers.get(item.id);

    // 1. Sharp electromechanical PTT handset clack + gritty VHF squelch break (`kssht`)
    this.triggerSquelchOpen(tOpen, item.urgent ? 1.12 : 0.96);

    if (decoded) {
      const onset = this.bufferOnsets.get(item.id) ?? 0;
      const activeEnd = this.bufferEnds.get(item.id) ?? decoded.duration;
      const speechDur = Math.max(0.22, activeEnd - onset);
      const tSpeech = tOpen + 0.056;
      const tClose = tSpeech + speechDur - 0.012;
      const totalDurSec = Math.max(0.34, tClose + 0.095 - now);

      // Gate authentic modulated VHF static bed (0.055–0.068) + micro-crackle ON pre-AGC/shaper
      const staticLevel = item.urgent ? 0.068 : 0.055;
      this.gateCarrierHiss(tOpen, tClose + 0.062, staticLevel);

      const src = ctx.createBufferSource();
      src.buffer = decoded;
      // Subtle radio rate micro-variation on routine acks so repeated calls stay natural
      if (item.id.startsWith('vector_ack_') || item.id.startsWith('loc_')) {
        src.playbackRate.setValueAtTime(0.985 + Math.random() * 0.035, tSpeech);
      }

      const vGain = ctx.createGain();
      const baseVol = item.priority === 'CRITICAL' ? 1.14 : item.priority === 'HIGH' ? 1.05 : 0.98;
      vGain.gain.setValueAtTime(0.0001, tSpeech);
      vGain.gain.linearRampToValueAtTime(baseVol, tSpeech + 0.01);
      vGain.gain.setValueAtTime(baseVol, Math.max(tSpeech + 0.02, tClose - 0.016));
      vGain.gain.linearRampToValueAtTime(0.0001, tClose + 0.012);

      src.connect(vGain);
      vGain.connect(this.radioVoiceInput);

      this.trackSource(src);
      src.start(tSpeech, onset, speechDur + 0.02);

      // 2. Unmistakable VHF squelch tail (`kssht`) + handset mic switch release thunk right after speech
      const scheduledCloseSources = this.triggerSquelchClose(tClose, item.urgent ? 1.1 : 0.94);

      this.activeTx = {
        id: item.id,
        priority: item.priority,
        callsign: item.callsign,
        text: item.text,
        urgent: item.urgent,
        startedAtMs: performance.now(),
        durationSec: totalDurSec,
        voiceSource: src,
        voiceGain: vGain,
        fallbackOscs: [],
        scheduledCloseSources,
      };

      this.scheduleTxCompletion(totalDurSec * 1000 + 25);
    } else {
      // Graceful procedural VHF carrier telemetry burst if MP3 clip isn't decoded yet
      const { durationSec, oscs } = this.playProceduralRadioFallback(item, tOpen + 0.054);
      const tClose = tOpen + 0.054 + durationSec;
      const totalDurSec = Math.max(0.34, tClose + 0.09 - now);

      this.gateCarrierHiss(tOpen, tClose + 0.058, 0.058);
      const scheduledCloseSources = this.triggerSquelchClose(tClose, 0.96);

      this.activeTx = {
        id: item.id,
        priority: item.priority,
        callsign: item.callsign,
        text: item.text,
        urgent: item.urgent,
        startedAtMs: performance.now(),
        durationSec: totalDurSec,
        voiceSource: null,
        voiceGain: null,
        fallbackOscs: oscs,
        scheduledCloseSources,
      };

      this.scheduleTxCompletion(totalDurSec * 1000 + 25);
    }
  }

  private scheduleTxCompletion(delayMs: number): void {
    this.clearRadioTimers();
    this.txEndTimer = window.setTimeout(() => {
      this.txEndTimer = null;
      this.activeTx = null;
      if (!this.mounted || this.radioQueue.length === 0) return;

      // Crisp 85ms inter-transmission breathing gap so calls never blur together
      this.txNextTimer = window.setTimeout(() => {
        this.txNextTimer = null;
        if (this.mounted && !this.activeTx) {
          this.startNextRadioTx();
        }
      }, 85);
    }, Math.max(80, Math.round(delayMs)));
  }

  private gateCarrierHiss(startTime: number, endTime: number, level: number): void {
    const safeEnd = Math.max(startTime + 0.03, endTime);
    if (this.radioCarrierGain) {
      const g = this.radioCarrierGain.gain;
      try {
        g.cancelScheduledValues(startTime);
        g.setValueAtTime(0.0001, startTime);
        g.linearRampToValueAtTime(level, startTime + 0.012);
        g.setValueAtTime(level, Math.max(startTime + 0.018, safeEnd - 0.016));
        g.linearRampToValueAtTime(0.0001, safeEnd);
        g.setValueAtTime(0, safeEnd + 0.005);
      } catch {
        // Ignore
      }
    }
    if (this.radioCrackleGain) {
      const cg = this.radioCrackleGain.gain;
      const crackleLevel = level * 0.62;
      try {
        cg.cancelScheduledValues(startTime);
        cg.setValueAtTime(0.0001, startTime);
        cg.linearRampToValueAtTime(crackleLevel, startTime + 0.014);
        cg.setValueAtTime(crackleLevel, Math.max(startTime + 0.02, safeEnd - 0.018));
        cg.linearRampToValueAtTime(0.0001, safeEnd);
        cg.setValueAtTime(0, safeEnd + 0.005);
      } catch {
        // Ignore
      }
    }
  }

  private triggerSquelchOpen(startTime: number, intensity = 1.0): void {
    if (!this.ctx || !this.radioSquelchInput || !this.whiteNoiseBuffer) return;
    const ctx = this.ctx;

    // 1. Sharp electromechanical PTT handset relay clack at tOpen
    this.playMechanicalClick(this.radioSquelchInput, startTime, {
      noiseFreq: 1950,
      noiseQ: 1.45,
      noiseDur: 0.01,
      noiseAmp: 0.15 * intensity,
      bodyStartFreq: 820,
      bodyEndFreq: 260,
      bodyLpFreq: 1700,
      bodyDur: 0.014,
      bodyAmp: 0.11 * intensity,
    });
    if (this.radioHandsetInput) {
      // Subtle physical console handset housing clack below the radio HPF cutoff (routed via ATC mute/gain bus)
      this.playMechanicalClick(this.radioHandsetInput, startTime, {
        noiseFreq: 1450,
        noiseQ: 1.5,
        noiseDur: 0.008,
        noiseAmp: 0.045 * intensity,
        bodyStartFreq: 310,
        bodyEndFreq: 118,
        bodyLpFreq: 540,
        bodyDur: 0.014,
        bodyAmp: 0.058 * intensity,
      });
    }

    // 2. Smooth, non-fatiguing VHF squelch break ("kssht") feeding into the military radio bandpass + diode
    const tBreak = startTime + 0.007;
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = this.whiteNoiseBuffer;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1750, tBreak);
    bp.frequency.exponentialRampToValueAtTime(1180, tBreak + 0.046);
    bp.Q.value = 1.15;

    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, tBreak);
    ng.gain.linearRampToValueAtTime(0.18 * intensity, tBreak + 0.004);
    ng.gain.setValueAtTime(0.13 * intensity, tBreak + 0.016);
    ng.gain.exponentialRampToValueAtTime(0.0001, tBreak + 0.048);

    nSrc.connect(bp);
    bp.connect(ng);
    ng.connect(this.radioSquelchInput);
    this.trackSource(nSrc);
    nSrc.start(tBreak, Math.random() * 0.7, 0.056);
  }

  private triggerSquelchClose(startTime: number, intensity = 1.0): AudioScheduledSourceNode[] {
    const created: AudioScheduledSourceNode[] = [];
    if (!this.ctx || !this.radioSquelchInput || !this.whiteNoiseBuffer) return created;
    const ctx = this.ctx;

    // 1. Restrained VHF squelch tail ("kssht")
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = this.whiteNoiseBuffer;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1240, startTime);
    bp.frequency.exponentialRampToValueAtTime(1920, startTime + 0.048);
    bp.Q.value = 1.25;

    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, startTime);
    ng.gain.linearRampToValueAtTime(0.16 * intensity, startTime + 0.004);
    ng.gain.setValueAtTime(0.12 * intensity, startTime + 0.018);
    ng.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.052);

    nSrc.connect(bp);
    bp.connect(ng);
    ng.connect(this.radioSquelchInput);
    this.trackSource(nSrc);
    nSrc.start(startTime, Math.random() * 0.7, 0.06);
    created.push(nSrc);

    // 2. Electromechanical PTT mic switch release clack + handset thunk (+44ms)
    const tRelease = startTime + 0.044;
    created.push(
      ...this.playMechanicalClick(this.radioSquelchInput, tRelease, {
        noiseFreq: 1780,
        noiseQ: 1.5,
        noiseDur: 0.009,
        noiseAmp: 0.15 * intensity,
        bodyStartFreq: 1180,
        bodyEndFreq: 400,
        bodyLpFreq: 1850,
        bodyDur: 0.014,
        bodyAmp: 0.11 * intensity,
      })
    );
    if (this.radioHandsetInput) {
      // Grounded handset PTT release switch thunk (routed via ATC mute/gain bus)
      created.push(
        ...this.playMechanicalClick(this.radioHandsetInput, tRelease, {
          noiseFreq: 1280,
          noiseQ: 1.4,
          noiseDur: 0.009,
          noiseAmp: 0.055 * intensity,
          bodyStartFreq: 350,
          bodyEndFreq: 130,
          bodyLpFreq: 560,
          bodyDur: 0.022,
          bodyAmp: 0.075 * intensity,
        })
      );
    }

    return created;
  }

  /**
   * Graceful zero-error procedural VHF carrier/SELCAL telemetry fallback when an MP3 clip
   * is unavailable or still decoding (strictly grounded radio bursts, no melodic synths).
   */
  private playProceduralRadioFallback(
    item: QueuedRadioItem,
    startTime: number
  ): { durationSec: number; oscs: AudioScheduledSourceNode[] } {
    const oscs: AudioScheduledSourceNode[] = [];
    if (!this.ctx || !this.radioVoiceInput) {
      return { durationSec: 0.42, oscs };
    }

    const ctx = this.ctx;
    const pulseCount = item.priority === 'CRITICAL' ? 3 : 2;
    const carrierFreq = item.priority === 'CRITICAL' ? 1040 : 920;

    let maxEnd = 0.22;
    for (let i = 0; i < pulseCount; i++) {
      const offset = i * 0.125;
      const dur = 0.075;
      const t0 = startTime + offset;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(carrierFreq, t0);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.14, t0 + 0.006);
      g.gain.setValueAtTime(0.12, t0 + dur * 0.68);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(g);
      g.connect(this.radioVoiceInput);
      this.trackSource(osc);
      osc.start(t0);
      osc.stop(t0 + dur + 0.014);
      oscs.push(osc);
      maxEnd = Math.max(maxEnd, offset + dur);
    }

    return { durationSec: maxEnd + 0.04, oscs };
  }

  // ===========================================================================
  // WEB AUDIO GRAPH SETUP & TEARDOWN
  // ===========================================================================

  private ensureGraph(): boolean {
    if (!this.mounted) return false;
    const ctx = this.hostAudio.getAudioContext();
    const masterOut = this.hostAudio.getMasterOutputNode();
    if (!ctx || !masterOut) return false;

    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }

    if (this.ctx === ctx && this.busOutput && this.radioVoiceInput && this.sfxInput) {
      if (this.rawBuffers.size > this.decodedBuffers.size && !this.decodeInFlight) {
        void this.decodePrefetched();
      }
      return true;
    }

    this.teardownGraph();
    this.ctx = ctx;

    this.buildSharedNoiseAndCurves(ctx);

    // Master cartridge output node connected to host AudioEngine masterGain (inherits mute & volume)
    this.busOutput = ctx.createGain();
    this.busOutput.gain.value = 0.95;
    this.busOutput.connect(masterOut);

    // Procedural SFX mastering bus (clean gentle lowpass + headroom glue)
    this.sfxInput = ctx.createGain();
    this.sfxInput.gain.value = 1.0;

    const sfxLp = ctx.createBiquadFilter();
    sfxLp.type = 'lowpass';
    sfxLp.frequency.value = 5400;
    sfxLp.Q.value = 0.65;

    this.sfxInput.connect(sfxLp);
    sfxLp.connect(this.busOutput);
    this.radioBusNodes.push(sfxLp);

    this.buildRadioProcessingBus(ctx);
    this.buildBunkerAmbienceGraph(ctx);

    if (this.rawBuffers.size > 0 && !this.decodeInFlight) {
      void this.decodePrefetched();
    }
    return true;
  }

  private buildRadioProcessingBus(ctx: AudioContext): void {
    if (
      !this.busOutput ||
      !this.pinkNoiseBuffer ||
      !this.radioCrackleBuffer ||
      !this.radioDiodeCurve
    ) {
      return;
    }

    this.radioVoiceInput = ctx.createGain();
    this.radioVoiceInput.gain.value = 1.0;

    this.radioSquelchInput = ctx.createGain();
    this.radioSquelchInput.gain.value = 1.0;

    // 1. Steep Cascaded 1979 Military Aviation Bandpass:
    //    2x Highpass (380 Hz Q=0.85 -> 420 Hz Q=0.75) + 2x Lowpass (2650 Hz Q=0.95 -> 2450 Hz Q=0.85)
    const hp380 = ctx.createBiquadFilter();
    hp380.type = 'highpass';
    hp380.frequency.value = 380;
    hp380.Q.value = 0.85;

    const hp420 = ctx.createBiquadFilter();
    hp420.type = 'highpass';
    hp420.frequency.value = 420;
    hp420.Q.value = 0.75;

    const lp2650 = ctx.createBiquadFilter();
    lp2650.type = 'lowpass';
    lp2650.frequency.value = 2650;
    lp2650.Q.value = 0.95;

    const lp2450 = ctx.createBiquadFilter();
    lp2450.type = 'lowpass';
    lp2450.frequency.value = 2450;
    lp2450.Q.value = 0.85;

    // 2. Carbon-Mic / Tactical Military Headset Formant Shaping (low-fatigue curve):
    //    -3.0 dB @ 640 Hz (Q=1.1), +3.2 dB @ 1680 Hz (Q=1.4), +1.0 dB @ 2250 Hz (Q=1.6)
    const lowMidCut = ctx.createBiquadFilter();
    lowMidCut.type = 'peaking';
    lowMidCut.frequency.value = 640;
    lowMidCut.Q.value = 1.1;
    lowMidCut.gain.value = -3.0;

    const tacticalPeak = ctx.createBiquadFilter();
    tacticalPeak.type = 'peaking';
    tacticalPeak.frequency.value = 1680;
    tacticalPeak.Q.value = 1.4;
    tacticalPeak.gain.value = 3.2;

    const secondaryBite = ctx.createBiquadFilter();
    secondaryBite.type = 'peaking';
    secondaryBite.frequency.value = 2250;
    secondaryBite.Q.value = 1.6;
    secondaryBite.gain.value = 1.0;

    // Pre-AGC summing bus so VHF static & crackle duck/pump organically under pilot syllables
    const preAgcSum = ctx.createGain();
    preAgcSum.gain.value = 1.0;

    // 3. Modulated VHF Static/Hiss Bed (1450 Hz BP, 0.085–0.115 gated ON during TX) + Micro-Crackle Grit
    this.radioCarrierSrc = ctx.createBufferSource();
    this.radioCarrierSrc.buffer = this.pinkNoiseBuffer;
    this.radioCarrierSrc.loop = true;

    const carrierBp = ctx.createBiquadFilter();
    carrierBp.type = 'bandpass';
    carrierBp.frequency.value = 1450;
    carrierBp.Q.value = 0.85;

    const carrierModGain = ctx.createGain();
    carrierModGain.gain.value = 1.0;

    this.radioCarrierLfo = ctx.createOscillator();
    this.radioCarrierLfo.type = 'triangle';
    this.radioCarrierLfo.frequency.value = 6.8;

    const carrierLfoDepth = ctx.createGain();
    carrierLfoDepth.gain.value = 0.22;
    this.radioCarrierLfo.connect(carrierLfoDepth);
    carrierLfoDepth.connect(carrierModGain.gain);

    this.radioCarrierGain = ctx.createGain();
    this.radioCarrierGain.gain.value = 0;

    this.radioCarrierSrc.connect(carrierBp);
    carrierBp.connect(carrierModGain);
    carrierModGain.connect(this.radioCarrierGain);
    this.radioCarrierGain.connect(preAgcSum);
    this.radioCarrierSrc.start();
    this.radioCarrierLfo.start();

    this.radioCrackleSrc = ctx.createBufferSource();
    this.radioCrackleSrc.buffer = this.radioCrackleBuffer;
    this.radioCrackleSrc.loop = true;

    const crackleBp = ctx.createBiquadFilter();
    crackleBp.type = 'bandpass';
    crackleBp.frequency.value = 1920;
    crackleBp.Q.value = 1.3;

    this.radioCrackleGain = ctx.createGain();
    this.radioCrackleGain.gain.value = 0;

    this.radioCrackleSrc.connect(crackleBp);
    crackleBp.connect(this.radioCrackleGain);
    this.radioCrackleGain.connect(preAgcSum);
    this.radioCrackleSrc.start();

    // 4. Controlled Military Radio Limiter / AGC (-18 dB, knee 6, ratio 5:1, 3ms atk / 95ms rel)
    const agc = ctx.createDynamicsCompressor();
    agc.threshold.value = -18;
    agc.knee.value = 6;
    agc.ratio.value = 5.0;
    agc.attack.value = 0.003;
    agc.release.value = 0.095;

    // 5. Moderate pre-diode drive -> Warm Asymmetric Diode WaveShaper (makeRadioDiodeCurve(2.2))
    const preDiodeDrive = ctx.createGain();
    preDiodeDrive.gain.value = 1.45;

    const shaper = ctx.createWaveShaper();
    shaper.curve = this.radioDiodeCurve;
    shaper.oversample = '4x';

    // Post-diode DC blocker & HF harmonic containment (smooths fizz above speech formants)
    const postDiodeHp = ctx.createBiquadFilter();
    postDiodeHp.type = 'highpass';
    postDiodeHp.frequency.value = 340;
    postDiodeHp.Q.value = 0.7;

    const postDiodeLp = ctx.createBiquadFilter();
    postDiodeLp.type = 'lowpass';
    postDiodeLp.frequency.value = 2500;
    postDiodeLp.Q.value = 0.72;

    const radioOut = ctx.createGain();
    radioOut.gain.value = 0.92;

    // Live AnalyserNode driving the Left Column 254.30 MHz Radio Oscilloscope (pre-attenuation so trace stays lively!)
    this.radioAnalyser = ctx.createAnalyser();
    this.radioAnalyser.fftSize = 256;
    this.radioAnalyser.smoothingTimeConstant = 0.55;
    this.radioTimeDomainData = new Float32Array(new ArrayBuffer(this.radioAnalyser.fftSize * 4));

    // Dedicated ATC output attenuator (-18 dB / 0.125x nominal) & smooth ATC mute gate (0.0 when atcMuted)
    const atcGain = this.atcMuted ? 0 : ATC_NOMINAL_OUTPUT_GAIN;
    this.radioAtcOutputGain = ctx.createGain();
    this.radioAtcOutputGain.gain.value = atcGain;

    // Console handset PTT housing clack sub-bus (shares exact -18 dB / 0.125x attenuation & ATC mute gate)
    this.radioHandsetInput = ctx.createGain();
    this.radioHandsetInput.gain.value = atcGain;
    if (this.sfxInput) {
      this.radioHandsetInput.connect(this.sfxInput);
    }

    this.radioVoiceInput.connect(hp380);
    this.radioSquelchInput.connect(hp380);
    hp380.connect(hp420);
    hp420.connect(lp2650);
    lp2650.connect(lp2450);
    lp2450.connect(lowMidCut);
    lowMidCut.connect(tacticalPeak);
    tacticalPeak.connect(secondaryBite);
    secondaryBite.connect(preAgcSum);
    preAgcSum.connect(agc);
    agc.connect(preDiodeDrive);
    preDiodeDrive.connect(shaper);
    shaper.connect(postDiodeHp);
    postDiodeHp.connect(postDiodeLp);
    postDiodeLp.connect(radioOut);
    radioOut.connect(this.radioAnalyser);
    this.radioAnalyser.connect(this.radioAtcOutputGain);
    this.radioAtcOutputGain.connect(this.busOutput);

    this.radioBusNodes.push(
      hp380,
      hp420,
      lp2650,
      lp2450,
      lowMidCut,
      tacticalPeak,
      secondaryBite,
      preAgcSum,
      carrierBp,
      carrierModGain,
      carrierLfoDepth,
      crackleBp,
      agc,
      preDiodeDrive,
      shaper,
      postDiodeHp,
      postDiodeLp,
      radioOut,
      this.radioAnalyser
    );
  }

  private buildBunkerAmbienceGraph(ctx: AudioContext): void {
    if (!this.busOutput || !this.brownNoiseBuffer) return;

    // 1. Deep subterranean RAPCON HVAC air-handler bed
    this.hvacNoiseSrc = ctx.createBufferSource();
    this.hvacNoiseSrc.buffer = this.brownNoiseBuffer;
    this.hvacNoiseSrc.loop = true;

    this.hvacLpFilter = ctx.createBiquadFilter();
    this.hvacLpFilter.type = 'lowpass';
    this.hvacLpFilter.frequency.value = 148;
    this.hvacLpFilter.Q.value = 0.72;

    this.hvacGain = ctx.createGain();
    this.hvacGain.gain.value = 0;

    this.hvacNoiseSrc.connect(this.hvacLpFilter);
    this.hvacLpFilter.connect(this.hvacGain);
    this.hvacGain.connect(this.busOutput);
    this.hvacNoiseSrc.start();

    // 2. Warm 1979 CRT console transformer hum (60 Hz + subtle 120 Hz harmonic)
    this.hvacHumOscA = ctx.createOscillator();
    this.hvacHumOscA.type = 'sine';
    this.hvacHumOscA.frequency.value = 60;

    this.hvacHumOscB = ctx.createOscillator();
    this.hvacHumOscB.type = 'triangle';
    this.hvacHumOscB.frequency.value = 120;

    const humBMix = ctx.createGain();
    humBMix.gain.value = 0.24;

    const humLp = ctx.createBiquadFilter();
    humLp.type = 'lowpass';
    humLp.frequency.value = 210;
    humLp.Q.value = 0.65;

    this.hvacHumGain = ctx.createGain();
    this.hvacHumGain.gain.value = 0;

    this.hvacHumOscA.connect(humLp);
    this.hvacHumOscB.connect(humBMix);
    humBMix.connect(humLp);
    humLp.connect(this.hvacHumGain);
    this.hvacHumGain.connect(this.busOutput);
    this.hvacHumOscA.start();
    this.hvacHumOscB.start();

    // 3. Subtle low-frequency bunker tension pulse during active Conflict Alert
    this.tensionOsc = ctx.createOscillator();
    this.tensionOsc.type = 'sine';
    this.tensionOsc.frequency.value = 46;

    const tensionModGain = ctx.createGain();
    tensionModGain.gain.value = 0.68;

    this.tensionLfo = ctx.createOscillator();
    this.tensionLfo.type = 'sine';
    this.tensionLfo.frequency.value = 2.4;

    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.32;
    this.tensionLfo.connect(lfoDepth);
    lfoDepth.connect(tensionModGain.gain);

    this.tensionGain = ctx.createGain();
    this.tensionGain.gain.value = 0;

    this.tensionOsc.connect(tensionModGain);
    tensionModGain.connect(this.tensionGain);
    this.tensionGain.connect(this.busOutput);
    this.tensionOsc.start();
    this.tensionLfo.start();

    this.ambienceNodes.push(humBMix, humLp, tensionModGain, lfoDepth);
  }

  private teardownGraph(): void {
    const stoppable: Array<AudioScheduledSourceNode | null> = [
      this.radioCarrierSrc,
      this.radioCarrierLfo,
      this.radioCrackleSrc,
      this.hvacNoiseSrc,
      this.hvacHumOscA,
      this.hvacHumOscB,
      this.tensionOsc,
      this.tensionLfo,
    ];
    for (const s of stoppable) {
      try {
        s?.stop();
      } catch {
        // Ignore
      }
    }

    const nodes: Array<AudioNode | null> = [
      this.radioCarrierSrc,
      this.radioCarrierLfo,
      this.radioCarrierGain,
      this.radioCrackleSrc,
      this.radioCrackleGain,
      this.radioVoiceInput,
      this.radioSquelchInput,
      this.radioAtcOutputGain,
      this.radioHandsetInput,
      this.hvacNoiseSrc,
      this.hvacLpFilter,
      this.hvacGain,
      this.hvacHumOscA,
      this.hvacHumOscB,
      this.hvacHumGain,
      this.tensionOsc,
      this.tensionLfo,
      this.tensionGain,
      this.sfxInput,
      this.busOutput,
      ...this.radioBusNodes,
      ...this.ambienceNodes,
    ];
    for (const n of nodes) {
      try {
        n?.disconnect();
      } catch {
        // Ignore
      }
    }

    this.radioCarrierSrc = null;
    this.radioCarrierLfo = null;
    this.radioCarrierGain = null;
    this.radioCrackleSrc = null;
    this.radioCrackleGain = null;
    this.radioVoiceInput = null;
    this.radioSquelchInput = null;
    this.radioAtcOutputGain = null;
    this.radioHandsetInput = null;
    this.radioAnalyser = null;
    this.radioTimeDomainData = null;
    this.radioBusNodes = [];

    this.hvacNoiseSrc = null;
    this.hvacLpFilter = null;
    this.hvacGain = null;
    this.hvacHumOscA = null;
    this.hvacHumOscB = null;
    this.hvacHumGain = null;
    this.tensionOsc = null;
    this.tensionLfo = null;
    this.tensionGain = null;
    this.ambienceNodes = [];

    this.sfxInput = null;
    this.busOutput = null;
    this.ctx = null;
  }

  private buildSharedNoiseAndCurves(ctx: AudioContext): void {
    const sr = ctx.sampleRate;
    const len = sr * 2;

    // White noise (squelch bursts & mechanical contact transients)
    const whiteBuf = ctx.createBuffer(1, len, sr);
    const wd = whiteBuf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      wd[i] = Math.random() * 2 - 1;
    }
    this.whiteNoiseBuffer = whiteBuf;

    // Pink noise (Paul Kellet filter — smooth authentic VHF carrier hiss & pneumatic bleed)
    const pinkBuf = ctx.createBuffer(1, len, sr);
    const pd = pinkBuf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
      pd[i] = Math.max(-1, Math.min(1, pink));
    }
    this.pinkNoiseBuffer = pinkBuf;

    // Brown noise (deep RAPCON subterranean HVAC air-handler bed & distant concrete turbine rumble)
    const brownBuf = ctx.createBuffer(1, sr * 3, sr);
    const bd = brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bd.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.025 * w) / 1.025;
      bd[i] = Math.max(-1, Math.min(1, last * 3.1));
    }
    this.brownNoiseBuffer = brownBuf;

    // Sparse VHF atmospheric micro-crackle buffer (organic RF static pops & impulse grit)
    const crackleLen = sr * 3;
    const crackleBuf = ctx.createBuffer(1, crackleLen, sr);
    const cd = crackleBuf.getChannelData(0);
    let crackleEnv = 0;
    for (let i = 0; i < crackleLen; i++) {
      const r = Math.random();
      if (r < 0.0022) {
        // Sharp atmospheric RF micro-crackle spike
        crackleEnv = (Math.random() * 2 - 1) * (0.45 + Math.random() * 0.55);
      } else if (r < 0.012) {
        // Subtle grainy carrier flutter
        crackleEnv += (Math.random() * 2 - 1) * 0.12;
      }
      cd[i] = Math.max(-1, Math.min(1, crackleEnv));
      crackleEnv *= 0.78;
    }
    this.radioCrackleBuffer = crackleBuf;

    this.radioDiodeCurve = this.makeRadioDiodeCurve(2.2);
    this.heavySoftClipCurve = this.makeSoftClipCurve(2.6);
  }

  /**
   * Asymmetric soft-hard diode transfer curve for 1979 military UHF transceiver grit
   * (silicon-diode positive clamp + softer asymmetric negative knee -> authentic 2nd/3rd harmonics).
   */
  private makeRadioDiodeCurve(drive: number): Float32Array<ArrayBuffer> {
    const samples = 1024;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    const posNorm = Math.tanh(drive * 1.18);
    const negNorm = Math.tanh(drive * 0.84);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1;
      if (x >= 0) {
        const shaped = Math.tanh(x * drive * 1.18) / posNorm;
        const hardKnee = Math.min(0.92, shaped * 1.06);
        curve[i] = shaped * 0.68 + hardKnee * 0.32;
      } else {
        const shaped = Math.tanh(x * drive * 0.84) / negNorm;
        curve[i] = shaped * 0.96;
      }
    }
    return curve;
  }

  private makeSoftClipCurve(drive: number): Float32Array<ArrayBuffer> {
    const samples = 512;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    const norm = Math.tanh(drive);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = Math.tanh(x * drive) / norm;
    }
    return curve;
  }

  // ===========================================================================
  // ASSET MANIFEST PREFETCH, TRIMMING & DECODING
  // ===========================================================================

  private async prefetchApproachAssets(): Promise<void> {
    try {
      const base = import.meta.env.BASE_URL || './';
      const prefix = base === '/' ? '.' : base.replace(/\/$/, '');
      const res = await fetch(`${prefix}/audio/approach/manifest.json`, { cache: 'no-cache' });
      if (!res.ok) return;
      const data = (await res.json()) as ApproachManifestData;
      if (!data || !data.assets || typeof data.assets !== 'object') return;

      const entries = Object.entries(data.assets).filter(([id]) => VALID_ASSET_IDS.has(id));
      let cursor = 0;
      const concurrency = 12;
      const workers = Array.from(
        { length: Math.min(concurrency, entries.length) },
        async () => {
          while (cursor < entries.length) {
            const [id, meta] = entries[cursor++];
            try {
              const mp3Res = await fetch(`${prefix}${meta.path}?v=${meta.bytes}`, {
                cache: 'default',
              });
              if (!mp3Res.ok) continue;
              const arr = await mp3Res.arrayBuffer();
              if (arr.byteLength > 512) {
                this.rawBuffers.set(id as ApproachAssetId, arr);
              }
            } catch {
              // Individual clip fallback handled cleanly by procedural radio/SFX fallback
            }
          }
        }
      );
      await Promise.all(workers);

      if (this.ctx) {
        await this.decodePrefetched();
      }
    } catch {
      // Zero-error procedural fallback remains active
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
        pending.map(async ([id, raw]) => {
          try {
            const decoded = await ctx.decodeAudioData(raw.slice(0));
            if (VALID_CLIP_IDS.has(id)) {
              this.normalizePeak(decoded, 0.9);
              const bounds = this.detectSpeechBoundsSec(decoded);
              this.decodedBuffers.set(id, decoded);
              this.bufferOnsets.set(id as ApproachRadioClipId, bounds.startSec);
              this.bufferEnds.set(id as ApproachRadioClipId, bounds.endSec);
            } else {
              // One-shot bunker SFX (e.g., mishap_explosion.mp3): preserve full transient & tail
              this.normalizePeak(decoded, 0.94);
              this.decodedBuffers.set(id, decoded);
            }
          } catch {
            // Keep graceful procedural fallback
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

  /**
   * Trims leading & trailing MP3 silence padding so squelch open/close (`kssht`)
   * hugs the pilot voice tightly with authentic military radio punch.
   */
  private detectSpeechBoundsSec(buf: AudioBuffer): { startSec: number; endSec: number } {
    const ch = buf.getChannelData(0);
    const sr = buf.sampleRate;
    let peak = 0;
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
    const thresh = Math.max(0.015, peak * 0.045);

    let startIdx = 0;
    for (let i = 0; i < ch.length; i++) {
      if (Math.abs(ch[i]) >= thresh) {
        startIdx = Math.max(0, i - Math.floor(sr * 0.014));
        break;
      }
    }

    let endIdx = ch.length;
    for (let i = ch.length - 1; i >= startIdx; i--) {
      if (Math.abs(ch[i]) >= thresh) {
        endIdx = Math.min(ch.length, i + Math.floor(sr * 0.045));
        break;
      }
    }

    const startSec = startIdx / sr;
    const endSec = Math.max(startSec + 0.18, endIdx / sr);
    return { startSec, endSec: Math.min(buf.duration, endSec) };
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

  private clampPan(pan: number): number {
    if (!Number.isFinite(pan)) return 0;
    return Math.max(-0.85, Math.min(0.85, pan));
  }
}
