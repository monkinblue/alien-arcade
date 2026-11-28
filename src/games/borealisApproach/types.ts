import type { Vec2 } from '../../types';

/**
 * Program #5: BOREALIS APPROACH // LV-118 RAPCON (v2.0)
 *
 * Coordinate System Convention (Geographic Nautical Miles, centered on LV-118 Borealis Basin):
 * - Origin (0, 0) = Airfield reference center (midpoint of Primary Runway 09/27).
 * - +x = East (090°), -x = West (270°).
 * - +y = North (000°/360°), -y = South (180°).
 * - Screen conversion in renderers:
 *     sx = scopeCenterX + nmX * pxPerNm
 *     sy = scopeCenterY - nmY * pxPerNm
 * - Magnetic headings are 0°..360° clockwise from North (positive delta = right-hand / clockwise turn).
 */
export const APPROACH_CONSTANTS = {
  SCOPE_RADIUS_NM: 15,
  DEFAULT_AIRSPACE_HALF_WIDTH_NM: 16.8,
  DEFAULT_AIRSPACE_HALF_HEIGHT_NM: 15.0,
  RANGE_RINGS_NM: [5, 10, 15] as const,

  // Tactical time compression: 9x real speed (KT * 9 / 3600 = 0.0025 NM/s per knot)
  // Heavy 150 KT = 0.375 NM/s, Tug 175 KT = 0.4375 NM/s, Dropship 220 KT = 0.55 NM/s, MAYDAY 260 KT = 0.65 NM/s
  KT_TO_NM_PER_SEC: 0.0025,

  // Primary Runway 09/27 & Secondary Crosswind Runway 36/18 ILS Localizer parameters
  RUNWAY_HALF_LENGTH_NM: 1.1,
  RUNWAY_WIDTH_NM: 0.36,
  SECONDARY_RUNWAY_HALF_LENGTH_NM: 1.1,
  SECONDARY_RUNWAY_WIDTH_NM: 0.34,
  ILS_FEATHER_LENGTH_NM: 10.0,
  SECONDARY_ILS_FEATHER_LENGTH_NM: 9.0,
  ILS_FAF_DIST_NM: 5.0,
  ILS_IDEAL_INTERCEPT_DEG: 30,
  ILS_MAX_INTERCEPT_DEG: 45,
  ILS_CORRIDOR_HALF_WIDTH_NM: 1.45,
  ILS_SNAP_TOLERANCE_NM: 1.85,
  RWY_DECISION_HEIGHT_NM: 2.5,

  // VTOL Pad Alpha & Orbital Salvage Cradle capture envelopes
  PAD_ALPHA_CAPTURE_RADIUS_NM: 1.55,
  CRADLE_CAPTURE_RADIUS_NM: 1.6,
  CRADLE_CORRIDOR_LENGTH_NM: 7.5,
  CRADLE_CORRIDOR_HALF_WIDTH_NM: 1.35,
  CRADLE_MAX_INTERCEPT_DEG: 62,

  // Holding fix capture radius, vertical altitude stacking & endurance fuel conservation
  HOLD_SNAP_RADIUS_NM: 1.7,
  HOLD_FUEL_BURN_RATE: 0.35,
  HOLD_STACK_MAX_SLOTS: 3,
  HOLD_STACK_BASE_ALT_FT: 3500,
  HOLD_STACK_STEP_ALT_FT: 1000,
  HOLD_STACK_EXEMPT_RADIUS_NM: 2.8,
  HOLD_ALT_CLIMB_RATE_FT_PER_SEC: 280,

  // Separation, Conflict Alert hysteresis & ICC Safety Seal parameters
  SEPARATION_MIN_NM: 3.0,
  COLLISION_RADIUS_NM: 0.85,
  CA_MULTIPLIER_PENALTY_COOLDOWN_SEC: 2.5,
  INITIAL_SAFETY_SEALS: 3,
  INCIDENT_FREEZE_SEC: 1.2,
  ANTI_DOUBLE_STRIKE_SEC: 2.0,
  GAME_OVER_LOCKOUT_SEC: 1.2,

  // Restricted Live-Fire MOA (R-118 // HOT)
  RESTRICTED_ZONE_BREACH_SEC: 2.8,
  RESTRICTED_ZONE_PENALTY_COOLDOWN_SEC: 2.5,

  // Outbound Launch / Departure Sequencing
  DEPARTURE_BASE_SCORE: 450,
  GAP_LAUNCH_BONUS: 300,
  GAP_LAUNCH_WINDOW_SEC: 6.0,
  DEPARTURE_FINAL_SCAN_NM: 5.5,
  DEPARTURE_ROLL_SEC: 1.4,
  DEPARTURE_CA_EXEMPT_SEC: 1.0,
  DEPARTURE_CLEAR_DIST_NM: 11.5,
  DEPARTURE_MAX_WAIT_SEC: 38.0,
  DEPARTURE_DELAY_PENALTY: 0.25,
  DEPARTURE_DELAY_RESET_SEC: 18.0,

  // Dynamic weather, ATIS, and scoring parameters
  RUNWAY_FLIP_WARNING_SEC: 10.0,
  TIGHT_SEQUENCE_WINDOW_SEC: 9.5,
  TIGHT_SEQUENCE_WINDOW_RWY_SEC: 9.5,
  TIGHT_SEQUENCE_WINDOW_CRADLE_SEC: 8.2,
  TIGHT_SEQUENCE_WINDOW_PAD_SEC: 6.0,
  TIGHT_SEQUENCE_BONUS: 500,
  TEXTBOOK_ILS_BONUS: 250,
  TEXTBOOK_ILS_MIN_DEG: 12,
  TEXTBOOK_ILS_MAX_DEG: 36,
  FUMES_SAVE_BONUS: 750,
  FUMES_SAVE_THRESHOLD_SEC: 5.0,
  MEDEVAC_EXPRESS_TIMER_SEC: 25.0,
  MEDEVAC_EXPRESS_BONUS: 800,
  CLEAN_MULTIPLIER_MIN: 1.0,
  CLEAN_MULTIPLIER_MAX: 5.0,
  CLEAN_MULTIPLIER_STEP: 0.25,
  CONFLICT_MULTIPLIER_PENALTY: 0.5,
  MAYDAY_FUEL_SEC: 30.0,
  MAYDAY_SCORE_MULTIPLIER: 3,
  RANKED_1979_MULTIPLIER: 1.5,

  // Radar & console telemetry constants
  RADAR_SWEEP_RPM: 15, // 4.0s per full 360° ASR-9 revolution
  ALTIMETER_INHG: 29.92,
  RADIO_FREQ_MHZ: '254.30',
  WAYPOINT_ARRIVAL_NM: 0.42,
  MAX_COMMS_LOG: 24,
  CRAFT_PING_DURATION_SEC: 2.5,
} as const;

export const HOLD_FUEL_BURN_RATE = APPROACH_CONSTANTS.HOLD_FUEL_BURN_RATE;
export const HOLD_ALTITUDE_SLOTS_FT = [3500, 4500, 5500] as const;
export const MAX_HOLD_STACK_SLOTS = APPROACH_CONSTANTS.HOLD_STACK_MAX_SLOTS;

export type ApproachPhase = 'TITLE' | 'ACTIVE_SHIFT' | 'GAME_OVER';

export type PrimaryRunwayId = '27' | '09';

export type SecondaryRunwayId = '36' | '18';

export type ActiveRunwayId = PrimaryRunwayId | SecondaryRunwayId;

export type RunwayId = ActiveRunwayId;

export type LandingZoneId =
  | 'RWY_27'
  | 'RWY_09'
  | 'RWY_36'
  | 'RWY_18'
  | 'PAD_ALPHA'
  | 'SALVAGE_CRADLE';

export type HoldingFixId = 'KRATO' | 'BOREA' | 'VEXIS';

export type HoldAltitudeSlot = 0 | 1 | 2;

export interface HoldFixStackOccupancy {
  fixId: HoldingFixId;
  count: number;
  max: number;
  slots: (string | null)[];
  craftIds: (number | null)[];
}

export type SmartHoldRejectReason =
  | 'NOT_FOUND'
  | 'JAMMED'
  | 'DEPARTING'
  | 'ALREADY_HOLDING'
  | 'FLARING'
  | 'ALL_FULL';

export interface SmartHoldResult {
  ok: boolean;
  reason?: SmartHoldRejectReason;
  fixId?: HoldingFixId;
  slot?: HoldAltitudeSlot;
  altitudeFt?: number;
}

export interface DepartureRunwayStatus {
  clear: boolean;
  nearestInboundNm: number | null;
  gapWindowActive: boolean;
  gapSecondsLeft: number;
}

export type AircraftKind = 'DROPSHIP' | 'HEAVY' | 'TUG' | 'MAYDAY';

export type SpeedMode = 'SLOW' | 'STD' | 'FAST';

export type FuelStatus = 'NOMINAL' | 'JOKER' | 'BINGO' | 'FLAMEOUT';

export type MishapReason = 'COLLISION' | 'FLAMEOUT' | 'RESTRICTED_ZONE';

export type AircraftFlightState =
  | 'APPROACH'
  | 'VECTORING'
  | 'HOLDING'
  | 'ESTABLISHED'
  | 'LANDING'
  | 'GO_AROUND'
  | 'DEPARTING';

export type ShiftPhaseId = 'ALPHA' | 'BRAVO' | 'CHARLIE' | 'DELTA' | 'ECHO';

export type VectorSnapKind =
  | 'NONE'
  | 'ILS_LOCK'
  | 'PAD_LOCK'
  | 'CRADLE_LOCK'
  | 'HOLD_FIX'
  | 'UNSTABLE_REJECT';

export interface SpeedModeProfile {
  mode: SpeedMode;
  label: string;
  shortLabel: string;
  speedMult: number;
  fuelBurnMult: number;
}

export const SPEED_MODE_PROFILES: Readonly<Record<SpeedMode, SpeedModeProfile>> = {
  SLOW: {
    mode: 'SLOW',
    label: 'SLOW',
    shortLabel: 'SLW',
    speedMult: 0.76,
    fuelBurnMult: 0.85,
  },
  STD: {
    mode: 'STD',
    label: 'STD',
    shortLabel: 'STD',
    speedMult: 1.0,
    fuelBurnMult: 1.0,
  },
  FAST: {
    mode: 'FAST',
    label: 'FAST',
    shortLabel: 'FST',
    speedMult: 1.22,
    fuelBurnMult: 1.22,
  },
};

export interface HoldingFixDef {
  id: HoldingFixId;
  name: string;
  pos: Vec2;
  /** Published inbound leg magnetic heading toward the fix (deg, 0=N clockwise) */
  inboundHeadingDeg: number;
  /** Straight leg length of the published racetrack pattern (NM) */
  legLengthNm: number;
  /** Standard right-hand turn radius (NM) */
  turnRadiusNm: number;
  turnDirection: 'RIGHT';
  snapRadiusNm: number;
}

export interface RestrictedZoneDef {
  id: string;
  label: string;
  subLabel: string;
  center: Vec2;
  vertices: readonly Vec2[];
}

export interface AirfieldGeometry {
  runway: {
    id: 'RWY_09_27';
    label: string;
    threshold09: Vec2;
    threshold27: Vec2;
    heading09Deg: 90;
    heading27Deg: 270;
    lengthNm: number;
    widthNm: number;
    ilsLengthNm: number;
    fafDistNm: number;
  };
  secondaryRunway: {
    id: 'RWY_36_18';
    label: string;
    center: Vec2;
    threshold36: Vec2;
    threshold18: Vec2;
    heading36Deg: 0;
    heading18Deg: 180;
    lengthNm: number;
    widthNm: number;
    ilsLengthNm: number;
    fafDistNm: number;
  };
  padAlpha: {
    id: 'PAD_ALPHA';
    label: string;
    fullName: string;
    pos: Vec2;
    radiusNm: number;
    captureRadiusNm: number;
  };
  salvageCradle: {
    id: 'SALVAGE_CRADLE';
    label: string;
    fullName: string;
    pos: Vec2;
    /** Heading flown BY aircraft entering the cradle (SW, 240°) */
    approachHeadingDeg: number;
    /** Direction the approach corridor extends OUTWARD from the cradle (ENE, 060°) */
    corridorOutHeadingDeg: number;
    corridorLengthNm: number;
    captureRadiusNm: number;
    /** Exact NM point where the cradle corridor crosses RWY 09/27 extended centerline (y = 0) */
    corridorCrossPointNm: Vec2;
  };
  restrictedZone: RestrictedZoneDef;
  holdingFixes: readonly HoldingFixDef[];
}

export const AIRFIELD_GEOMETRY: AirfieldGeometry = {
  runway: {
    id: 'RWY_09_27',
    label: 'RWY 09/27',
    threshold09: { x: -APPROACH_CONSTANTS.RUNWAY_HALF_LENGTH_NM, y: 0 },
    threshold27: { x: APPROACH_CONSTANTS.RUNWAY_HALF_LENGTH_NM, y: 0 },
    heading09Deg: 90,
    heading27Deg: 270,
    lengthNm: APPROACH_CONSTANTS.RUNWAY_HALF_LENGTH_NM * 2,
    widthNm: APPROACH_CONSTANTS.RUNWAY_WIDTH_NM,
    ilsLengthNm: APPROACH_CONSTANTS.ILS_FEATHER_LENGTH_NM,
    fafDistNm: APPROACH_CONSTANTS.ILS_FAF_DIST_NM,
  },
  secondaryRunway: {
    id: 'RWY_36_18',
    label: 'RWY 36/18',
    center: { x: -5.0, y: 0.2 },
    threshold36: { x: -5.0, y: -0.9 },
    threshold18: { x: -5.0, y: 1.3 },
    heading36Deg: 0,
    heading18Deg: 180,
    lengthNm: APPROACH_CONSTANTS.SECONDARY_RUNWAY_HALF_LENGTH_NM * 2,
    widthNm: APPROACH_CONSTANTS.SECONDARY_RUNWAY_WIDTH_NM,
    ilsLengthNm: APPROACH_CONSTANTS.SECONDARY_ILS_FEATHER_LENGTH_NM,
    fafDistNm: APPROACH_CONSTANTS.ILS_FAF_DIST_NM,
  },
  padAlpha: {
    id: 'PAD_ALPHA',
    label: 'PAD α',
    fullName: 'VTOL PAD ALPHA',
    pos: { x: 3.6, y: 4.4 },
    radiusNm: 0.56,
    captureRadiusNm: APPROACH_CONSTANTS.PAD_ALPHA_CAPTURE_RADIUS_NM,
  },
  salvageCradle: {
    id: 'SALVAGE_CRADLE',
    label: 'CRADLE',
    fullName: 'ORBITAL SALVAGE CRADLE',
    pos: { x: -1.6, y: -3.0 },
    approachHeadingDeg: 240,
    corridorOutHeadingDeg: 60,
    corridorLengthNm: APPROACH_CONSTANTS.CRADLE_CORRIDOR_LENGTH_NM,
    captureRadiusNm: APPROACH_CONSTANTS.CRADLE_CAPTURE_RADIUS_NM,
    // (-1.6, -3.0) + t*(sin 60°, cos 60°) crosses y=0 at t=6.0 NM -> x = -1.6 + 6.0*0.866025 = +3.60 NM
    corridorCrossPointNm: { x: 3.6, y: 0 },
  },
  restrictedZone: {
    id: 'R-118',
    label: 'R-118 // HOT',
    subLabel: 'LIVE-FIRE MOA',
    center: { x: -11.6, y: -6.3 },
    vertices: [
      { x: -14.2, y: -3.2 },
      { x: -9.2, y: -3.2 },
      { x: -8.4, y: -7.8 },
      { x: -11.6, y: -10.2 },
      { x: -14.6, y: -7.0 },
    ],
  },
  holdingFixes: [
    {
      id: 'KRATO',
      name: 'KRATO',
      pos: { x: -9.8, y: 9.2 },
      inboundHeadingDeg: 135,
      legLengthNm: 1.8,
      turnRadiusNm: 0.72,
      turnDirection: 'RIGHT',
      snapRadiusNm: APPROACH_CONSTANTS.HOLD_SNAP_RADIUS_NM,
    },
    {
      id: 'BOREA',
      name: 'BOREA',
      pos: { x: 9.0, y: 7.6 },
      inboundHeadingDeg: 210,
      legLengthNm: 1.8,
      turnRadiusNm: 0.72,
      turnDirection: 'RIGHT',
      snapRadiusNm: APPROACH_CONSTANTS.HOLD_SNAP_RADIUS_NM,
    },
    {
      id: 'VEXIS',
      name: 'VEXIS',
      pos: { x: 7.8, y: -5.8 },
      inboundHeadingDeg: 330,
      legLengthNm: 1.8,
      turnRadiusNm: 0.72,
      turnDirection: 'RIGHT',
      snapRadiusNm: APPROACH_CONSTANTS.HOLD_SNAP_RADIUS_NM,
    },
  ],
};

export const HOLDING_FIXES = AIRFIELD_GEOMETRY.holdingFixes;

export function getHoldingFixById(id: HoldingFixId): HoldingFixDef {
  return (
    AIRFIELD_GEOMETRY.holdingFixes.find((fix) => fix.id === id) ??
    AIRFIELD_GEOMETRY.holdingFixes[0]
  );
}

export interface AircraftProfile {
  kind: AircraftKind;
  code: string;
  displayName: string;
  callsignPrefixes: readonly string[];
  speedKt: number;
  speedNmPerSec: number;
  turnRateDegPerSec: number;
  initialFuelSec: number;
  jokerFuelSec: number;
  bingoFuelSec: number;
  baseScore: number;
  requiredTargetLabel: string;
  colorKey: 'green' | 'amber' | 'cyan' | 'red';
  requiresIlsIntercept: boolean;
}

export const AIRCRAFT_PROFILES: Readonly<Record<AircraftKind, AircraftProfile>> = {
  DROPSHIP: {
    kind: 'DROPSHIP',
    code: 'UD-4',
    displayName: 'UD-4 DROPSHIP',
    callsignPrefixes: ['VIPER', 'HAWK'],
    speedKt: 220,
    speedNmPerSec: 220 * APPROACH_CONSTANTS.KT_TO_NM_PER_SEC,
    turnRateDegPerSec: 66,
    initialFuelSec: 115,
    jokerFuelSec: 40,
    bingoFuelSec: 18,
    baseScore: 350,
    requiredTargetLabel: 'PAD α',
    colorKey: 'green',
    requiresIlsIntercept: false,
  },
  HEAVY: {
    kind: 'HEAVY',
    code: 'HVY',
    displayName: 'HEAVY ORE HAULER',
    callsignPrefixes: ['MULE', 'ATLAS'],
    speedKt: 150,
    speedNmPerSec: 150 * APPROACH_CONSTANTS.KT_TO_NM_PER_SEC,
    turnRateDegPerSec: 26,
    initialFuelSec: 165,
    jokerFuelSec: 52,
    bingoFuelSec: 24,
    baseScore: 500,
    requiredTargetLabel: 'ILS RWY',
    colorKey: 'amber',
    requiresIlsIntercept: true,
  },
  TUG: {
    kind: 'TUG',
    code: 'TUG',
    displayName: 'ORBITAL SALVAGE TUG',
    callsignPrefixes: ['TUG', 'RIG'],
    speedKt: 175,
    speedNmPerSec: 175 * APPROACH_CONSTANTS.KT_TO_NM_PER_SEC,
    turnRateDegPerSec: 42,
    initialFuelSec: 135,
    jokerFuelSec: 45,
    bingoFuelSec: 20,
    baseScore: 425,
    requiredTargetLabel: 'CRADLE',
    colorKey: 'cyan',
    requiresIlsIntercept: false,
  },
  MAYDAY: {
    kind: 'MAYDAY',
    code: 'EMRG',
    displayName: 'EMERGENCY POD // MAYDAY',
    callsignPrefixes: ['MAYDAY'],
    speedKt: 260,
    speedNmPerSec: 260 * APPROACH_CONSTANTS.KT_TO_NM_PER_SEC,
    turnRateDegPerSec: 72,
    initialFuelSec: APPROACH_CONSTANTS.MAYDAY_FUEL_SEC,
    jokerFuelSec: APPROACH_CONSTANTS.MAYDAY_FUEL_SEC,
    bingoFuelSec: APPROACH_CONSTANTS.MAYDAY_FUEL_SEC,
    baseScore: 400, // Multiplied by MAYDAY_SCORE_MULTIPLIER (3x) -> 1200 base!
    requiredTargetLabel: 'ANY OPEN',
    colorKey: 'red',
    requiresIlsIntercept: false,
  },
};

export interface ShiftPhaseConfig {
  id: ShiftPhaseId;
  index: number;
  defaultAtisLetter: string;
  minLanded: number;
  nextLanded: number | null;
  code: string;
  title: string;
  fullLabel: string;
  maxConcurrentAircraft: number;
  spawnIntervalMinSec: number;
  spawnIntervalMaxSec: number;
  maxStorms: number;
  allowTugs: boolean;
  allowMedevac: boolean;
  allowSecondaryRunway: boolean;
  allowWindFlip: boolean;
  allowMayday: boolean;
  allowTwoShipElements: boolean;
  allowBogeys: boolean;
}

export const SHIFT_PHASES: readonly ShiftPhaseConfig[] = [
  {
    id: 'ALPHA',
    index: 0,
    defaultAtisLetter: 'A',
    minLanded: 0,
    nextLanded: 6,
    code: 'INFO ALPHA',
    title: 'NIGHT WATCH',
    fullLabel: 'INFO ALPHA — NIGHT WATCH',
    maxConcurrentAircraft: 4,
    spawnIntervalMinSec: 5.8,
    spawnIntervalMaxSec: 8.2,
    maxStorms: 0,
    allowTugs: false,
    allowMedevac: false,
    allowSecondaryRunway: false,
    allowWindFlip: false,
    allowMayday: false,
    allowTwoShipElements: false,
    allowBogeys: false,
  },
  {
    id: 'BRAVO',
    index: 1,
    defaultAtisLetter: 'B',
    minLanded: 6,
    nextLanded: 15,
    code: 'INFO BRAVO',
    title: 'ION SQUALL',
    fullLabel: 'INFO BRAVO — ION SQUALL',
    maxConcurrentAircraft: 5,
    spawnIntervalMinSec: 5.0,
    spawnIntervalMaxSec: 7.2,
    maxStorms: 1,
    allowTugs: true,
    allowMedevac: true,
    allowSecondaryRunway: false,
    allowWindFlip: false,
    allowMayday: false,
    allowTwoShipElements: false,
    allowBogeys: false,
  },
  {
    id: 'CHARLIE',
    index: 2,
    defaultAtisLetter: 'C',
    minLanded: 15,
    nextLanded: 27,
    code: 'INFO CHARLIE',
    title: 'CROSSWIND OPS',
    fullLabel: 'INFO CHARLIE — CROSSWIND OPS',
    maxConcurrentAircraft: 6,
    spawnIntervalMinSec: 4.3,
    spawnIntervalMaxSec: 6.4,
    maxStorms: 1,
    allowTugs: true,
    allowMedevac: true,
    allowSecondaryRunway: true,
    allowWindFlip: false,
    allowMayday: true,
    allowTwoShipElements: false,
    allowBogeys: false,
  },
  {
    id: 'DELTA',
    index: 3,
    defaultAtisLetter: 'D',
    minLanded: 27,
    nextLanded: 42,
    code: 'INFO DELTA',
    title: 'COLONY EVAC',
    fullLabel: 'INFO DELTA — COLONY EVAC',
    maxConcurrentAircraft: 7,
    spawnIntervalMinSec: 3.7,
    spawnIntervalMaxSec: 5.4,
    maxStorms: 2,
    allowTugs: true,
    allowMedevac: true,
    allowSecondaryRunway: true,
    allowWindFlip: true,
    allowMayday: true,
    allowTwoShipElements: true,
    allowBogeys: true,
  },
  {
    id: 'ECHO',
    index: 4,
    defaultAtisLetter: 'E',
    minLanded: 42,
    nextLanded: null,
    code: 'INFO ECHO',
    title: 'AIRSPACE SATURATION',
    fullLabel: 'INFO ECHO — AIRSPACE SATURATION',
    maxConcurrentAircraft: 8,
    spawnIntervalMinSec: 3.4,
    spawnIntervalMaxSec: 5.0,
    maxStorms: 2,
    allowTugs: true,
    allowMedevac: true,
    allowSecondaryRunway: true,
    allowWindFlip: true,
    allowMayday: true,
    allowTwoShipElements: true,
    allowBogeys: true,
  },
] as const;

export const SHIFT_PHASE_BY_ID: Readonly<Record<ShiftPhaseId, ShiftPhaseConfig>> = {
  ALPHA: SHIFT_PHASES[0],
  BRAVO: SHIFT_PHASES[1],
  CHARLIE: SHIFT_PHASES[2],
  DELTA: SHIFT_PHASES[3],
  ECHO: SHIFT_PHASES[4],
};

export type HoldLegPhase =
  | 'ENTRY'
  | 'TURN_OUTBOUND'
  | 'OUTBOUND'
  | 'TURN_INBOUND'
  | 'INBOUND';

export interface DepartureQueueItem {
  id: number;
  callsign: string;
  kind: 'DROPSHIP' | 'HEAVY';
  runway: ActiveRunwayId;
  holdShortPos: Vec2;
  departureHeadingDeg: number;
  waitSec: number;
  maxWaitSec: number;
  urgent: boolean;
}

export interface ApproachAircraft {
  id: number;
  callsign: string;
  kind: AircraftKind;
  x: number;
  y: number;
  headingDeg: number;
  targetHeadingDeg: number;
  baseSpeedKt: number;
  speedMode: SpeedMode;
  speedKt: number;
  speedNmPerSec: number;
  turnRateDegPerSec: number;
  /** Simulated Mode-C altitude in feet (e.g., 4500 down to 0 on flare) */
  altitudeFt: number;
  fuelSec: number;
  maxFuelSec: number;
  fuelPct: number;
  fuelStatus: FuelStatus;
  state: AircraftFlightState;
  waypoints: Vec2[];
  trail: Vec2[];
  lockedTarget: LandingZoneId | null;
  assignedHoldFix: HoldingFixId | null;
  holdAltitudeSlot: HoldAltitudeSlot | null;
  holdLegPhase: HoldLegPhase;
  holdLegDistNm: number;
  holdTurnAccumDeg: number;
  goAroundTimer: number;
  inStorm: boolean;
  inConflict: boolean;
  inRestrictedZone: boolean;
  restrictedExposureSec: number;
  minSeparationNm: number;
  landingProgress: number;
  pingTimer: number;
  checkinFlashTimer: number;
  ageSec: number;
  jokerAnnounced: boolean;
  bingoAnnounced: boolean;
  sweptHighlight: number;
  isHeavy: boolean;
  isEmergency: boolean;
  isMedevac: boolean;
  medevacExpressTimerSec: number;
  isDeparture: boolean;
  departureRollSec: number;
  departureRunway: ActiveRunwayId | null;
  gapLaunchEligible: boolean;
  hadConflictWhileDeparting: boolean;
  textbookIlsAwarded: boolean;
}

export interface IonStormCell {
  id: number;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radiusNm: number;
  coreRadiusNm: number;
  intensity: number;
  ageSec: number;
  maxLifeSec: number;
  /** Deterministic radial vertex scale factors (12 vertices) for NEXRAD return contour */
  contourScales: number[];
}

export interface PrimaryBogey {
  id: number;
  trackCode: string;
  x: number;
  y: number;
  headingDeg: number;
  speedKt: number;
  speedNmPerSec: number;
  trail: Vec2[];
  inConflict: boolean;
  ageSec: number;
  sweptHighlight: number;
}

export interface ConflictPair {
  idA: number;
  idB: number;
  isBogeyB: boolean;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  distanceNm: number;
  /** 0 at 3.0 NM separation minimum -> 1 at 0.85 NM collision threshold */
  severity: number;
}

export interface FlightStripData {
  craftId: number;
  callsign: string;
  kind: AircraftKind;
  typeCode: string;
  speedMode: SpeedMode;
  speedKt: number;
  altitudeFt: number;
  destLabel: string;
  fuelPct: number;
  fuelSec: number;
  fuelStatus: FuelStatus;
  state: AircraftFlightState;
  statusTag: string;
  urgencyRank: number;
  inStorm: boolean;
  inConflict: boolean;
  inRestrictedZone: boolean;
  isDeparture: boolean;
  isMedevac: boolean;
  medevacExpressTimerSec: number;
  isPinged: boolean;
  lockedTarget: LandingZoneId | null;
  assignedHoldFix: HoldingFixId | null;
  holdAltitudeSlot: HoldAltitudeSlot | null;
}

export interface CommsLogEntry {
  id: number;
  timestamp: string;
  sender: string;
  text: string;
  tone: 'green' | 'amber' | 'red' | 'cyan' | 'bright';
}

export interface ApproachPopup {
  id: number;
  x: number;
  y: number;
  text: string;
  subText?: string;
  color: string;
  age: number;
  duration: number;
}

export interface ApproachCrtShockwave {
  x: number;
  y: number;
  age: number;
  duration: number;
  maxRadiusNm: number;
  tone: 'green' | 'amber' | 'red' | 'gold';
}

export interface VectorPreviewResult {
  valid: boolean;
  blockedByStorm: boolean;
  entersRestrictedZone: boolean;
  holdFixFull?: boolean;
  snapKind: VectorSnapKind;
  lockedTarget: LandingZoneId | null;
  holdFix: HoldingFixId | null;
  waypoints: Vec2[];
  snapPoint: Vec2 | null;
  interceptAngleDeg: number | null;
  rejectReason?: string;
}

export type CompassSector = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface CheckinRadioMeta {
  sector?: CompassSector;
  isMedevac?: boolean;
  isTwoShip?: boolean;
  force?: boolean;
}

export interface ApproachAudioCallbacks {
  onCheckin(
    kind: AircraftKind,
    activeRunway: ActiveRunwayId,
    callsign: string,
    meta?: CheckinRadioMeta
  ): void;
  onVectorAck(callsign: string): void;
  onLocalizerLock(target: LandingZoneId, pan: number, callsign: string): void;
  onHoldEntered(fixId: HoldingFixId, callsign: string): void;
  onGoAround(callsign: string, manual: boolean, reason?: string): void;
  onJokerFuel(callsign: string): void;
  onMaydayBingo(callsign: string, isSpawn?: boolean): void;
  onRunwayFlipWarning(
    pendingRunway: ActiveRunwayId,
    pendingSecondary?: SecondaryRunwayId | null
  ): void;
  onAtisFlip(
    newRunway: ActiveRunwayId,
    atisLetter: string,
    secondaryRunway?: SecondaryRunwayId | null
  ): void;
  onSecondaryRunwayOpen?(secondaryRunway: SecondaryRunwayId, atisLetter: string): void;
  onIonStormSpawn?(storm: IonStormCell): void;
  onBogeySpawn?(bogey: PrimaryBogey): void;
  onConflictAlert(minSepNm: number): void;
  onConflictCleared(): void;
  onRestrictedZoneAlert(callsign: string): void;
  onDepartureCleared(callsign: string, runway: ActiveRunwayId, pan: number): void;
  onDepartureComplete(callsign: string): void;
  onSpeedChanged(callsign: string, mode: SpeedMode): void;
  onTextbookIlsBonus(callsign: string): void;
  onFumesSaveBonus(callsign: string): void;
  onStreakCommendation?(streak: number, title: string, sealRestored: boolean): void;
  onGapLaunchBonus?(callsign: string): void;
  onMedevacBonus?(callsign: string): void;
  onFirstIonStorm?(storm: IonStormCell): void;
  onTouchdown(
    kind: AircraftKind,
    target: LandingZoneId,
    pan: number,
    callsign: string,
    isSequenced: boolean
  ): void;
  onMishapBreach(
    reason: 'COLLISION' | 'FLAMEOUT' | 'RESTRICTED_ZONE',
    sealsRemaining: number
  ): void;
  onRadarSweepTick(): void;
}

export interface ApproachScoreEntry {
  id: string;
  callsign: string;
  score: number;
  landed: number;
  maxMult: number;
  phase: ShiftPhaseId;
  date: string;
  isArchiveFallback: boolean;
}

export interface ApproachLastSubmittedRun {
  docId?: string;
  callsign: string;
  score: number;
  landed: number;
  maxMult: number;
  phase: ShiftPhaseId;
  rank: number;
}

export interface ApproachDebugSnapshot {
  phase: ApproachPhase;
  score: number;
  landedCount: number;
  departuresCleared: number;
  cleanStreak: number;
  bestCleanStreak: number;
  sealsRestored: number;
  gapLaunchesCount: number;
  medevacExpressCount: number;
  firstIonStormSpawned: boolean;
  safetySeals: number;
  maxSafetySeals: number;
  multiplier: number;
  maxMultiplier: number;
  shiftPhase: ShiftPhaseId;
  atisLetter: string;
  activeRunway: PrimaryRunwayId;
  primaryRunway: PrimaryRunwayId;
  secondaryRunwayOpen: boolean;
  activeSecondaryRunway: SecondaryRunwayId | null;
  pendingRunway: ActiveRunwayId | null;
  pendingPrimaryRunway: PrimaryRunwayId | null;
  pendingSecondaryRunway: SecondaryRunwayId | null;
  runwayFlipCountdownSec: number;
  windHeadingDeg: number;
  windSpeedKt: number;
  windGustKt: number;
  airspaceHalfWidthNm: number;
  airspaceHalfHeightNm: number;
  trainingMode: boolean;
  timeScale: number;
  conflictActive: boolean;
  minSeparationNm: number;
  incidentFreezeTimer: number;
  antiDoubleStrikeTimer: number;
  gameOverLockoutTimer: number;
  ranked1979Bonus: boolean;
  aircraftCount: number;
  stormCount: number;
  bogeyCount: number;
  departureQueueCount: number;
  departureQueue: DepartureQueueItem[];
  aircraft: Array<{
    id: number;
    callsign: string;
    kind: AircraftKind;
    x: number;
    y: number;
    headingDeg: number;
    speedMode: SpeedMode;
    speedKt: number;
    altitudeFt: number;
    state: AircraftFlightState;
    fuelSec: number;
    fuelStatus: FuelStatus;
    lockedTarget: LandingZoneId | null;
    assignedHoldFix: HoldingFixId | null;
    holdAltitudeSlot: HoldAltitudeSlot | null;
    inStorm: boolean;
    inConflict: boolean;
    inRestrictedZone: boolean;
    restrictedExposureSec: number;
    isDeparture: boolean;
    isMedevac: boolean;
    medevacExpressTimerSec: number;
    gapLaunchEligible: boolean;
  }>;
}

export interface ApproachDebugHandle {
  getState: () => ApproachDebugSnapshot;
  startShift: () => void;
  jumpToLanded: (n: number) => void;
  unlockSecondaryRunway: () => void;
  triggerRunwayFlip: () => void;
  setRunwayFlipCountdown: (sec: number) => void;
  spawnStorm: (pos?: Vec2) => void;
  spawnMayday: (pos?: Vec2) => number;
  spawnMedevac: (pos?: Vec2) => number;
  spawnTwoShipElement: () => number[];
  spawnBogey: (pos?: Vec2, headingDeg?: number) => void;
  spawnCraft: (
    kind: AircraftKind,
    pos: Vec2,
    headingDeg: number,
    opts?: { callsign?: string; fuelSec?: number; speedMode?: SpeedMode }
  ) => number;
  queueDeparture: (opts?: { kind?: 'DROPSHIP' | 'HEAVY'; runway?: ActiveRunwayId }) => number;
  clearDeparture: (depId?: number) => number | null;
  getDepartureStatus: (rwyId?: ActiveRunwayId) => DepartureRunwayStatus;
  getHoldStackInfo: (fixId: HoldingFixId) => HoldFixStackOccupancy;
  setCraftSpeedMode: (id: number, mode: SpeedMode) => boolean;
  cycleCraftSpeed: (id: number, delta: 1 | -1) => SpeedMode | null;
  setTrainingMode: (enabled: boolean) => void;
  setTimeScale: (scale: number) => void;
  clearEntities: () => void;
  setFuel: (id: number, fuelSec: number) => boolean;
  setMultiplier: (mult: number) => void;
  setCleanStreak: (n: number) => void;
  setSafetySeals: (n: number) => void;
  commandGoAround: (id?: number) => boolean;
  commandSmartHold: (craftId: number | string) => SmartHoldResult;
  assignPath: (id: number, pts: Vec2[]) => VectorPreviewResult;
  forceSealBreach: (reason?: MishapReason) => void;
  forceConflict: () => void;
  nmToClient: (nmX: number, nmY: number) => { x: number; y: number };
  getHudButtons: () => Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  getAudioDebug: () => {
    fetched: number;
    decoded: number;
    expected: number;
    contextState: string;
    isTransmitting: boolean;
    activeTxId: string | null;
    activeTxPriority: string | null;
    queueLength: number;
    queuedIds: string[];
    radioLevel: number;
    conflictToneActive: boolean;
    muted: boolean;
  };
  getCommsLog: () => CommsLogEntry[];
  getStatusBanner: () => {
    debugTainted: boolean;
    submitResultBanner: string | null;
    scoreSubmitted: boolean;
    crtPreset: string;
    crtModeLocked: boolean;
    osdMenuOpen: boolean;
    manifestOpen: boolean;
    controlsOpen: boolean;
    confirmExitPending: boolean;
    confirmGameMenuPending: boolean;
    runPlaytimeSec: number;
  };
}

// ============================================================================
// Pure Coordinate, Runway, Wind, and Restricted-Zone Geometry Helpers
// ============================================================================

/** Normalizes any angle in degrees into [0, 360). */
export function normalizeHeadingDeg(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

/** Signed shortest angular difference from `fromDeg` to `toDeg` in (-180, 180]. Positive = right/clockwise. */
export function shortestHeadingDiffDeg(fromDeg: number, toDeg: number): number {
  let diff = normalizeHeadingDeg(toDeg) - normalizeHeadingDeg(fromDeg);
  if (diff > 180) diff -= 360;
  if (diff <= -180) diff += 360;
  return diff;
}

/** Converts a magnetic heading (0°=N, 90°=E, clockwise) into a unit NM vector (+x=E, +y=N). */
export function headingDegToUnitVec(deg: number): Vec2 {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.sin(rad), y: Math.cos(rad) };
}

/** Converts a non-zero NM direction vector (+x=E, +y=N) into a magnetic heading in [0, 360). */
export function vecToHeadingDeg(dx: number, dy: number): number {
  return normalizeHeadingDeg((Math.atan2(dx, dy) * 180) / Math.PI);
}

const COMPASS_SECTORS_ORDERED: readonly CompassSector[] = [
  'N',
  'NE',
  'E',
  'SE',
  'S',
  'SW',
  'W',
  'NW',
];

/** Maps an airfield-relative `(x, y)` NM coordinate to its exact 8-point compass sector. */
export function posToCompassSector(x: number, y: number): CompassSector {
  const deg = vecToHeadingDeg(x, y);
  const idx = Math.floor(((deg + 22.5) % 360) / 45);
  return COMPASS_SECTORS_ORDERED[idx] ?? 'N';
}

/** Spoken lowercase compass sector name matching radio audio clips. */
export function compassSectorSpoken(sector: CompassSector): string {
  switch (sector) {
    case 'N':
      return 'north';
    case 'NE':
      return 'northeast';
    case 'E':
      return 'east';
    case 'SE':
      return 'southeast';
    case 'S':
      return 'south';
    case 'SW':
      return 'southwest';
    case 'W':
      return 'west';
    case 'NW':
      return 'northwest';
  }
}

/**
 * Computes an aircraft's exact physical minimum turning radius in NM:
 * `R_min = speedNmPerSec / (turnRateDegPerSec * PI / 180)`.
 */
export function getCraftMinTurnRadiusNm(
  speedNmPerSec: number,
  turnRateDegPerSec: number
): number {
  if (!Number.isFinite(speedNmPerSec) || speedNmPerSec <= 0) return 0;
  const omegaRadPerSec = (Math.max(1e-3, turnRateDegPerSec) * Math.PI) / 180;
  return speedNmPerSec / omegaRadPerSec;
}

/** Returns the landing course magnetic heading for any active runway ('27'->270, '09'->90, '36'->0, '18'->180). */
export function getRunwayLandingHeadingDeg(runway: ActiveRunwayId): number {
  switch (runway) {
    case '09':
      return 90;
    case '27':
      return 270;
    case '36':
      return 0;
    case '18':
      return 180;
  }
}

/** Returns the outward unit vector pointing from threshold out along the runway's ILS localizer feather. */
export function getRunwayOutwardUnitVec(runway: ActiveRunwayId): Vec2 {
  switch (runway) {
    case '27':
      return { x: 1, y: 0 };
    case '09':
      return { x: -1, y: 0 };
    case '36':
      return { x: 0, y: -1 };
    case '18':
      return { x: 0, y: 1 };
  }
}

/** Returns the threshold coordinate in NM for any runway ('27', '09', '36', '18'). */
export function getRunwayThresholdNm(runway: ActiveRunwayId): Vec2 {
  switch (runway) {
    case '09':
      return AIRFIELD_GEOMETRY.runway.threshold09;
    case '27':
      return AIRFIELD_GEOMETRY.runway.threshold27;
    case '36':
      return AIRFIELD_GEOMETRY.secondaryRunway.threshold36;
    case '18':
      return AIRFIELD_GEOMETRY.secondaryRunway.threshold18;
  }
}

/** Returns the ILS localizer feather length in NM for the specified runway. */
export function getRunwayIlsLengthNm(runway: ActiveRunwayId): number {
  return runway === '36' || runway === '18'
    ? AIRFIELD_GEOMETRY.secondaryRunway.ilsLengthNm
    : AIRFIELD_GEOMETRY.runway.ilsLengthNm;
}

/** Returns the 5 NM Final Approach Fix (FAF) coordinate in NM for the specified runway. */
export function getRunwayFafNm(runway: ActiveRunwayId): Vec2 {
  const th = getRunwayThresholdNm(runway);
  const out = getRunwayOutwardUnitVec(runway);
  const fafDist =
    runway === '36' || runway === '18'
      ? AIRFIELD_GEOMETRY.secondaryRunway.fafDistNm
      : AIRFIELD_GEOMETRY.runway.fafDistNm;
  return { x: th.x + out.x * fafDist, y: th.y + out.y * fafDist };
}

/** Returns the outer ILS localizer feather endpoint in NM for the specified runway. */
export function getRunwayIlsOuterNm(runway: ActiveRunwayId): Vec2 {
  const th = getRunwayThresholdNm(runway);
  const out = getRunwayOutwardUnitVec(runway);
  const ilsLen = getRunwayIlsLengthNm(runway);
  return { x: th.x + out.x * ilsLen, y: th.y + out.y * ilsLen };
}

/** Maps a runway ID to its corresponding LandingZoneId. */
export function runwayToLandingZone(runway: ActiveRunwayId): LandingZoneId {
  switch (runway) {
    case '27':
      return 'RWY_27';
    case '09':
      return 'RWY_09';
    case '36':
      return 'RWY_36';
    case '18':
      return 'RWY_18';
  }
}

/** Maps a LandingZoneId back to its runway ID, or null for Pad Alpha / Salvage Cradle. */
export function landingZoneToRunway(zone: LandingZoneId | null): ActiveRunwayId | null {
  switch (zone) {
    case 'RWY_27':
      return '27';
    case 'RWY_09':
      return '09';
    case 'RWY_36':
      return '36';
    case 'RWY_18':
      return '18';
    default:
      return null;
  }
}

/** Forward-divergent missed-approach climb-out heading for each runway (never reverses over final). */
export function getMissedApproachHeadingDeg(runway: ActiveRunwayId): number {
  switch (runway) {
    case '27':
      return 302;
    case '09':
      return 58;
    case '36':
      return 28;
    case '18':
      return 208;
  }
}

/** Hold-short queue pad position in NM beside each runway threshold. */
export function getRunwayHoldShortNm(runway: ActiveRunwayId): Vec2 {
  switch (runway) {
    case '27':
      return { x: 1.15, y: 0.55 };
    case '09':
      return { x: -1.15, y: 0.55 };
    case '36':
      return { x: -4.45, y: -0.95 };
    case '18':
      return { x: -4.45, y: 1.35 };
  }
}

/** Initial climb-out departure heading diverging cleanly off runway heading clear of terminals, R-118, and holding fixes. */
export function getDepartureHeadingDeg(runway: ActiveRunwayId): number {
  switch (runway) {
    case '27':
      return 292;
    case '09':
      return 98;
    case '36':
      return 22;
    case '18':
      return 175;
  }
}

/** Returns authentic direct or quartering headwind heading matching the currently open runway(s). */
export function getAlignedWindHeadingDeg(
  primary: PrimaryRunwayId,
  secondary: SecondaryRunwayId | null
): number {
  if (secondary === null) {
    return primary === '27' ? 270 : 90;
  }
  if (primary === '27' && secondary === '36') return 305;
  if (primary === '09' && secondary === '18') return 125;
  if (primary === '27' && secondary === '18') return 235;
  return 55; // primary === '09' && secondary === '36'
}

/** Returns the tight-sequence `+500 SEQUENCED` touchdown time window (seconds) for a landing zone. */
export function getTightSequenceWindowSec(zone: LandingZoneId): number {
  if (zone === 'PAD_ALPHA') return APPROACH_CONSTANTS.TIGHT_SEQUENCE_WINDOW_PAD_SEC;
  if (zone === 'SALVAGE_CRADLE') return APPROACH_CONSTANTS.TIGHT_SEQUENCE_WINDOW_CRADLE_SEC;
  return APPROACH_CONSTANTS.TIGHT_SEQUENCE_WINDOW_RWY_SEC;
}

/** Returns true when `(x, y)` in NM lies inside or on the boundary of the R-118 live-fire restricted MOA. */
export function isPointInRestrictedZone(x: number, y: number): boolean {
  const verts = AIRFIELD_GEOMETRY.restrictedZone.vertices;
  const n = verts.length;
  if (n < 3) return false;

  // Quick AABB reject
  let minX = verts[0].x;
  let maxX = verts[0].x;
  let minY = verts[0].y;
  let maxY = verts[0].y;
  for (let i = 1; i < n; i++) {
    const v = verts[i];
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  if (x < minX - 1e-6 || x > maxX + 1e-6 || y < minY - 1e-6 || y > maxY + 1e-6) {
    return false;
  }

  // Exact ray-casting + boundary check
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = verts[i].x;
    const yi = verts[i].y;
    const xj = verts[j].x;
    const yj = verts[j].y;

    // Boundary check
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (
      Math.abs(cross) <= 1e-6 &&
      x >= Math.min(xi, xj) - 1e-6 &&
      x <= Math.max(xi, xj) + 1e-6 &&
      y >= Math.min(yi, yj) - 1e-6 &&
      y <= Math.max(yi, yj) + 1e-6
    ) {
      return true;
    }

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentsIntersect2D(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const orient = (p: Vec2, q: Vec2, r: Vec2): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);

  const onSegment = (p: Vec2, q: Vec2, r: Vec2): boolean =>
    r.x >= Math.min(p.x, q.x) - 1e-6 &&
    r.x <= Math.max(p.x, q.x) + 1e-6 &&
    r.y >= Math.min(p.y, q.y) - 1e-6 &&
    r.y <= Math.max(p.y, q.y) + 1e-6;

  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);

  if (((o1 > 1e-7 && o2 < -1e-7) || (o1 < -1e-7 && o2 > 1e-7)) &&
      ((o3 > 1e-7 && o4 < -1e-7) || (o3 < -1e-7 && o4 > 1e-7))) {
    return true;
  }
  if (Math.abs(o1) <= 1e-7 && onSegment(a, b, c)) return true;
  if (Math.abs(o2) <= 1e-7 && onSegment(a, b, d)) return true;
  if (Math.abs(o3) <= 1e-7 && onSegment(c, d, a)) return true;
  if (Math.abs(o4) <= 1e-7 && onSegment(c, d, b)) return true;
  return false;
}

function pointToSegmentDistNm(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 1e-12) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Computes the exact Euclidean distance in NM from `(x, y)` to the R-118 live-fire MOA polygon:
 * returns `0` if inside or on the boundary, else the minimum distance to all polygon edges.
 */
export function distanceToRestrictedZoneNm(x: number, y: number): number {
  if (isPointInRestrictedZone(x, y)) return 0;
  const verts = AIRFIELD_GEOMETRY.restrictedZone.vertices;
  const n = verts.length;
  if (n < 3) return Infinity;
  let minD = Infinity;
  for (let i = 0; i < n; i++) {
    const v1 = verts[i];
    const v2 = verts[(i + 1) % n];
    const d = pointToSegmentDistNm(x, y, v1.x, v1.y, v2.x, v2.y);
    if (d < minD) minD = d;
  }
  return minD;
}

/**
 * Returns true when segment `a -> b` (in NM) enters, crosses, or comes within `bufferNm`
 * of any vertex or edge of the R-118 live-fire restricted MOA polygon.
 */
export function segmentNearRestrictedZone(a: Vec2, b: Vec2, bufferNm: number): boolean {
  if (segmentIntersectsRestrictedZone(a, b)) return true;
  const buf = Math.max(0, bufferNm);
  if (buf <= 0) return false;
  const verts = AIRFIELD_GEOMETRY.restrictedZone.vertices;
  const n = verts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const v1 = verts[i];
    const v2 = verts[(i + 1) % n];
    if (pointToSegmentDistNm(a.x, a.y, v1.x, v1.y, v2.x, v2.y) <= buf) return true;
    if (pointToSegmentDistNm(b.x, b.y, v1.x, v1.y, v2.x, v2.y) <= buf) return true;
    if (pointToSegmentDistNm(v1.x, v1.y, a.x, a.y, b.x, b.y) <= buf) return true;
  }
  return false;
}

/** Returns true when segment `a -> b` (in NM) enters or crosses the R-118 live-fire restricted MOA. */
export function segmentIntersectsRestrictedZone(a: Vec2, b: Vec2): boolean {
  const verts = AIRFIELD_GEOMETRY.restrictedZone.vertices;
  const n = verts.length;
  if (n < 3) return false;

  // Fast AABB reject against the R-118 polygon bounding box
  let minX = verts[0].x;
  let maxX = verts[0].x;
  let minY = verts[0].y;
  let maxY = verts[0].y;
  for (let i = 1; i < n; i++) {
    const v = verts[i];
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  const segMinX = a.x < b.x ? a.x : b.x;
  const segMaxX = a.x > b.x ? a.x : b.x;
  const segMinY = a.y < b.y ? a.y : b.y;
  const segMaxY = a.y > b.y ? a.y : b.y;
  if (
    segMaxX < minX - 1e-6 ||
    segMinX > maxX + 1e-6 ||
    segMaxY < minY - 1e-6 ||
    segMinY > maxY + 1e-6
  ) {
    return false;
  }

  if (isPointInRestrictedZone(a.x, a.y) || isPointInRestrictedZone(b.x, b.y)) {
    return true;
  }
  for (let i = 0; i < n; i++) {
    const v1 = verts[i];
    const v2 = verts[(i + 1) % n];
    if (segmentsIntersect2D(a, b, v1, v2)) {
      return true;
    }
  }
  return false;
}

/** Returns true when any segment of `pts` enters or crosses the R-118 live-fire restricted MOA. */
export function polylineIntersectsRestrictedZone(pts: readonly Vec2[]): boolean {
  if (pts.length === 0) return false;
  if (pts.length === 1) return isPointInRestrictedZone(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    if (segmentIntersectsRestrictedZone(pts[i], pts[i + 1])) {
      return true;
    }
  }
  return false;
}
