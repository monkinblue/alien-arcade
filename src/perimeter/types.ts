import type { Vec2, ViewportRect } from '../types';

export const PERIMETER_CONSTANTS = {
  VIRTUAL_W: 1920,
  VIRTUAL_H: 1080,
  TILE_SIZE: 60,
  GRID_COLS: 32,
  GRID_ROWS: 18,
  PX_PER_METER: 30, // 1920x1080 = 64.0m x 36.0m tactical schematic
  FIXED_DT: 1 / 60,

  INITIAL_SCRAP: 265,
  BASE_REACTOR_KW: 110,
  MAX_REACTOR_KW_CAP: 185,
  MAX_BULKHEAD_SEALS: 3,

  CORE_BASELINE_SWEEP_INTERVAL: 2.15,
  CORE_BASELINE_SWEEP_RADIUS: 690, // ~23m baseline perimeter tracker from Core
  CORE_LIT_RADIUS: 135, // Inner sterile lit chamber around Reactor Core

  WELD_COST_SCRAP: 55,
  DOOR_MAX_HP: 380,
  MAX_ACTIVE_DOOR_SEALS: 3,
  WELD_DURATION_SEC: 2.0,
  WELD_REPAIR_COOLDOWN_SEC: 4.0,

  REARM_COST_SCRAP: 45,
  REARM_DURATION_SEC: 2.8,

  DARK_CORRIDOR_RANGE_MULT: 0.55,
  DARK_CORRIDOR_MISS_CHANCE: 0.2,
  ILLUMINATED_CRIT_MULT: 1.2,

  REACTOR_OVERLOAD_TRIP_SEC: 4.0,
  REACTOR_BLACKOUT_SEC: 3.5,
  GRATE_TELEGRAPH_SEC: 5.0,

  FLARE_COOLDOWN_SEC: 15,
  FLARE_DURATION_SEC: 12,
  FLARE_RADIUS_PX: 255,
  FLARE_SURGE_KW: 0,
  FLARE_SURGE_SEC: 0,

  OVERCLOCK_COOLDOWN_SEC: 22,
  OVERCLOCK_DURATION_SEC: 8,
  OVERCLOCK_RADIUS_PX: 265,
  OVERCLOCK_SURGE_KW: 22,

  PURGE_PUSH_PX: 290,
} as const;

export type TileKind =
  | 'BULKHEAD'
  | 'AIR_SHAFT'
  | 'CORRIDOR'
  | 'MOUNT_PAD'
  | 'DUCT_GRATE'
  | 'BLAST_DOOR'
  | 'AIRLOCK'
  | 'CORE';

export type TurretKind = 'SENTRY_PULSE' | 'INCINERATOR' | 'CRYO_VALVE' | 'MOTION_RELAY';

export type BuildToolId =
  | 'NONE'
  | 'SENTRY_PULSE'
  | 'INCINERATOR'
  | 'CRYO_VALVE'
  | 'MOTION_RELAY'
  | 'ARC_WELDER';

export type CommandAbilityId = 'FLARE' | 'OVERCLOCK' | 'PURGE';

export type ActiveCursorTool =
  | { kind: 'INSPECT' }
  | { kind: 'BUILD'; buildId: Exclude<BuildToolId, 'NONE'>; previewAngle: number }
  | { kind: 'ABILITY'; abilityId: CommandAbilityId }
  | { kind: 'ROTATE_TURRET'; turretId: string };

export interface HardwareSpec {
  id: Exclude<BuildToolId, 'NONE'>;
  shortKey: string;
  code: string;
  name: string;
  costScrap: number;
  powerKw: number;
  upgradeCostScrap: number;
  rangePx: number;
  coneHalfAngleRad: number; // 0 for omni
  maxAmmo: number; // 0 if non-ammo
  summary: string;
}

export const HARDWARE_SPECS: Record<Exclude<BuildToolId, 'NONE'>, HardwareSpec> = {
  SENTRY_PULSE: {
    id: 'SENTRY_PULSE',
    shortKey: '1',
    code: 'UA 571-C',
    name: 'HEAVY PULSE SENTRY',
    costScrap: 100,
    powerKw: 22,
    upgradeCostScrap: 90,
    rangePx: 350, // 11.7m full illuminated range (55% in dark corridors!)
    coneHalfAngleRad: (30 * Math.PI) / 180, // 60° directional firing cone
    maxAmmo: 320,
    summary: 'PAD MOUNT • 320-RD DRUM • +100% RNG LIT',
  },
  INCINERATOR: {
    id: 'INCINERATOR',
    shortKey: '2',
    code: 'M240 INCIN',
    name: 'INCINERATOR UNIT',
    costScrap: 125,
    powerKw: 26,
    upgradeCostScrap: 100,
    rangePx: 204, // 6.8m choke-point projector
    coneHalfAngleRad: (38 * Math.PI) / 180, // 76° flame arc
    maxAmmo: 0,
    summary: 'PAD MOUNT • NAPALM LIGHTS & STERILIZES ACID',
  },
  CRYO_VALVE: {
    id: 'CRYO_VALVE',
    shortKey: '3',
    code: 'CRYO-VLV',
    name: 'CRYO-STASIS VALVE',
    costScrap: 80,
    powerKw: 14,
    upgradeCostScrap: 75,
    rangePx: 142, // 4.7m duct grate plume
    coneHalfAngleRad: 0,
    maxAmmo: 0,
    summary: 'DUCT GRATE • SLOWS 58% • SHATTER +35% ARMOR',
  },
  MOTION_RELAY: {
    id: 'MOTION_RELAY',
    shortKey: '4',
    code: 'M314 RELAY',
    name: 'MOTION + TRIPWIRE',
    costScrap: 65,
    powerKw: 10,
    upgradeCostScrap: 60,
    rangePx: 465, // 15.5m radar sweep
    coneHalfAngleRad: 0,
    maxAmmo: 0,
    summary: 'PAD MOUNT • ILLUMINATES TARGETS • +24% RNG',
  },
  ARC_WELDER: {
    id: 'ARC_WELDER',
    shortKey: '5',
    code: 'ARC-WELD',
    name: 'BULKHEAD DOOR SEAL',
    costScrap: 55,
    powerKw: 0,
    upgradeCostScrap: 0,
    rangePx: 0,
    coneHalfAngleRad: 0,
    maxAmmo: 0,
    summary: 'MAX 3 SEALS • 2.0S TORCH • REROUTES PATHS',
  },
};

export type HostileKind = 'SKITTERER' | 'DRONE' | 'PRAETORIAN' | 'BURSTER' | 'STALKER';

export interface HostileSpec {
  kind: HostileKind;
  name: string;
  baseHp: number;
  speedPxS: number;
  radiusPx: number;
  scrapReward: number;
  scoreValue: number;
  doorDps: number;
}

export const HOSTILE_SPECS: Record<HostileKind, HostileSpec> = {
  SKITTERER: {
    kind: 'SKITTERER',
    name: 'SKITTERER SWARMER',
    baseHp: 26,
    speedPxS: 120,
    radiusPx: 8,
    scrapReward: 3,
    scoreValue: 45,
    doorDps: 12,
  },
  DRONE: {
    kind: 'DRONE',
    name: 'XENO DRONE',
    baseHp: 90,
    speedPxS: 88,
    radiusPx: 13,
    scrapReward: 8,
    scoreValue: 110,
    doorDps: 24,
  },
  PRAETORIAN: {
    kind: 'PRAETORIAN',
    name: 'PRAETORIAN CRUSHER',
    baseHp: 460,
    speedPxS: 48,
    radiusPx: 21,
    scrapReward: 32,
    scoreValue: 420,
    doorDps: 68,
  },
  BURSTER: {
    kind: 'BURSTER',
    name: 'ACID BURSTER',
    baseHp: 118,
    speedPxS: 68,
    radiusPx: 14,
    scrapReward: 13,
    scoreValue: 175,
    doorDps: 28,
  },
  STALKER: {
    kind: 'STALKER',
    name: 'SIGNAL STALKER',
    baseHp: 98,
    speedPxS: 96,
    radiusPx: 12,
    scrapReward: 15,
    scoreValue: 210,
    doorDps: 26,
  },
};

export interface BreachVentDef {
  id: string;
  label: string;
  col: number;
  row: number;
  pos: Vec2;
  isAuxGrate?: boolean;
}

export interface BlastDoorDef {
  id: string;
  label: string;
  tiles: Array<{ col: number; row: number }>;
  center: Vec2;
  orientation: 'HORIZONTAL' | 'VERTICAL';
}

export interface AirlockChamberDef {
  id: string;
  label: string;
  tiles: Array<{ col: number; row: number }>;
  bounds: ViewportRect;
  center: Vec2;
  flushDir: Vec2; // Unit vector pointing outward away from Core
}

export interface RoomLabelDef {
  text: string;
  subText?: string;
  x: number;
  y: number;
}

export interface BlastDoorState {
  def: BlastDoorDef;
  welded: boolean;
  hp: number;
  maxHp: number;
  underAttackTimer: number;
  acidCorrodingTimer: number;
  /** >0 while mid-wave 2.0s Arc-Weld torch sequence is actively running */
  weldingTimer: number;
  weldingDuration: number;
  /** Brief cooldown after a weld/repair completes to prevent mid-wave repair spam */
  repairCooldown: number;
}

export interface PlacedTurret {
  id: string;
  callsign: string; // e.g. 'A-01', 'F-01', 'C-01', 'M-01'
  kind: TurretKind;
  col: number;
  row: number;
  pos: Vec2;
  powered: boolean;
  level: 1 | 2;
  angle: number; // Current mechanical barrel/emitter heading (radians)
  targetAngle: number; // Desired heading (servo slews toward this)
  ammo: number;
  maxAmmo: number;
  /** >0 while mid-wave 2.8s automated ammo belt reload cycle is running (turret offline) */
  rearmTimer: number;
  rearmDuration: number;
  heat: number; // 0 .. 100
  thermalLocked: boolean;
  fireCooldown: number;
  pulseTimer: number; // For M314 sweep / Cryo vent cycle
  firingFlashTimer: number;
  dryFireTimer: number;
  overclockTimer: number;
  relayBoosted: boolean;
  // Laser tripwire endpoint for MOTION_RELAY
  tripwireStart?: Vec2;
  tripwireEnd?: Vec2;
  tripwireIntegrity: number; // 0..100 (damaged by acid pools, auto-calibrates when clear)
  kills: number;
}

export interface HostileEntity {
  id: number;
  kind: HostileKind;
  pos: Vec2;
  vel: Vec2;
  heading: number;
  hp: number;
  maxHp: number;
  speedPxS: number;
  radiusPx: number;
  weavePhase: number;
  // Visibility & Motion-Tracker States
  blipTimer: number; // >0 when recently swept by Motion Sensor pulse ring
  blipPos: Vec2; // Range-gated radar blip position
  blipDistM: number; // Live distance tag in meters
  m314SweepTimer: number; // >0 when actively swept by M314 Wide-Band Relay
  tripwireTagTimer: number; // >0 when tagged by crossing a Laser Tripwire
  cryoSlowTimer: number; // >0 when chilled by Cryo-Stasis plume
  napalmBurnTimer: number;
  stunTimer: number;
  /** True when illuminated by Flare, M314 sweep, Tripwire, Cryo, Core Light, or Napalm (100% range +20% crit!) */
  illuminated: boolean;
  verified: boolean; // True when illuminated OR inside turret's short 55% unlit IR cone
  batteringDoorId: string | null;
}

export interface GrateBreachTelegraph {
  ventId: string;
  label: string;
  pos: Vec2;
  remainingSec: number;
  maxSec: number;
  count: number;
}

export interface MotionSweepWave {
  origin: Vec2;
  radius: number;
  maxRadius: number;
  speed: number;
  fromM314: boolean;
  pingedHostileIds: Set<number>;
}

export interface StrobeFlareZone {
  pos: Vec2;
  radius: number;
  remainingSec: number;
  maxSec: number;
}

export interface OverclockZone {
  pos: Vec2;
  radius: number;
  remainingSec: number;
}

export interface NapalmCloud {
  pos: Vec2;
  radius: number;
  remainingSec: number;
  maxSec: number;
  dps: number;
}

export interface CryoPlume {
  pos: Vec2;
  radius: number;
  remainingSec: number;
  maxSec: number;
}

export interface AcidHazardPool {
  pos: Vec2;
  radius: number;
  remainingSec: number;
  maxSec: number;
}

export interface AirlockPurgeWave {
  chamberId: string;
  bounds: ViewportRect;
  flushDir: Vec2;
  remainingSec: number;
}

export interface TracerBolt {
  p1: Vec2;
  p2: Vec2;
  life: number;
  maxLife: number;
  ricochet: boolean;
  overclocked: boolean;
}

export interface VectorSpark {
  pos: Vec2;
  vel: Vec2;
  color: string;
  life: number;
  maxLife: number;
}

export interface FloatingCallout {
  pos: Vec2;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export interface WaveSpawnGroup {
  ventId: string;
  kind: HostileKind;
  count: number;
  intervalSec: number;
  delaySec: number;
}

export interface WaveDefinition {
  waveNumber: number;
  title: string;
  groups: WaveSpawnGroup[];
  scrapBonus: number;
}

export type PerimeterMode = 'SECTOR_01' | 'ENDLESS_SIEGE';

export type PerimeterPhase =
  | 'BRIEFING'
  | 'TACTICAL_PREP'
  | 'WAVE_ACTIVE'
  | 'SECTOR_VICTORY'
  | 'CORE_BREACHED'
  | 'CALLSIGN_ENTRY';

export interface PerimeterManifestEntry {
  id?: string;
  callsign: string;
  waves: number;
  kills: number;
  score: number;
  mode: PerimeterMode;
  date: string;
}

export interface PerimeterLastSubmittedRun {
  docId?: string;
  callsign: string;
  score: number;
  waves: number;
  kills: number;
  mode: PerimeterMode;
  rank: number;
}
