import type { Vec2, ViewportRect } from '../types';

export const PERIMETER_CONSTANTS = {
  VIRTUAL_W: 1920,
  VIRTUAL_H: 1080,
  TILE_SIZE: 60,
  GRID_COLS: 32,
  GRID_ROWS: 18,
  PX_PER_METER: 30, // 1920x1080 = 64.0m x 36.0m tactical schematic
  FIXED_DT: 1 / 60,

  INITIAL_SCRAP: 280,
  BASE_REACTOR_KW: 115,
  AUTO_REACTOR_KW_CAP: 205, // Auto wave unlocks cap here; players can still expand with Scrap!
  MAX_REACTOR_KW_HARD_CAP: 360,
  MAX_BULKHEAD_SEALS: 3,

  CORE_BASELINE_SWEEP_INTERVAL: 2.15,
  CORE_BASELINE_SWEEP_RADIUS: 690, // ~23m baseline perimeter tracker from Core
  CORE_LIT_RADIUS: 135, // Inner sterile lit chamber around Reactor Core

  WELD_COST_SCRAP: 55,
  DOOR_MAX_HP: 380,
  MAX_ACTIVE_DOOR_SEALS: 3,
  WELD_DURATION_SEC: 2.0,
  WELD_REPAIR_COOLDOWN_SEC: 4.0,

  CLAYMORE_COST_SCRAP: 35,
  CLAYMORE_MAX_ACTIVE: 8,
  CLAYMORE_TRIGGER_RADIUS_PX: 54,
  CLAYMORE_BLAST_RADIUS_PX: 152,
  CLAYMORE_DAMAGE: 195,

  REARM_COST_SCRAP: 45,
  REARM_DURATION_SEC: 2.8,

  REACTOR_EXPAND_BASE_COST: 220,
  REACTOR_EXPAND_STEP_COST: 120,
  REACTOR_EXPAND_KW_STEP: 15,
  SEAL_REBUILD_COST_SCRAP: 480,

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

  FLOODLIGHT_BATTERY_COST: 60, // Consumes 60% Reactor Reserve Battery for 7.5s map-wide light!
  FLOODLIGHT_DURATION_SEC: 7.5,
  FLOODLIGHT_COOLDOWN_SEC: 20,

  COOLANT_FLUSH_COOLDOWN_SEC: 20,
  COOLANT_FLUSH_SURGE_KW: 10,
  COOLANT_FLUSH_SURGE_SEC: 1.6,

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

export type TurretKind =
  | 'SENTRY_PULSE'
  | 'INCINERATOR'
  | 'RAIL_LANCE'
  | 'CRYO_VALVE'
  | 'SHOCK_COIL'
  | 'MOTION_RELAY';

export type BuildToolId =
  | 'NONE'
  | TurretKind
  | 'ARC_WELDER'
  | 'CLAYMORE';

export type CommandAbilityId = 'FLARE' | 'OVERCLOCK' | 'PURGE' | 'FLOODLIGHT' | 'COOLANT_FLUSH';

export type Mk3BranchId = 'A' | 'B';

export interface Mk3BranchSpec {
  id: Mk3BranchId;
  code: string;
  costScrap: number;
  extraKw: number;
  summary: string;
}

export const MK3_BRANCH_SPECS: Record<TurretKind, Record<Mk3BranchId, Mk3BranchSpec>> = {
  SENTRY_PULSE: {
    A: {
      id: 'A',
      code: 'AP SABOT',
      costScrap: 240,
      extraKw: 4,
      summary: '+45% DMG · PIERCES 65% ARMOR',
    },
    B: {
      id: 'B',
      code: 'TWIN-LINK',
      costScrap: 240,
      extraKw: 4,
      summary: '640 DRUM · +35% ROF · KNOCKBACK',
    },
  },
  INCINERATOR: {
    A: {
      id: 'A',
      code: 'THERMITE',
      costScrap: 250,
      extraKw: 4,
      summary: '+65% BURN DPS · MELTS BOSSES',
    },
    B: {
      id: 'B',
      code: 'FIREWALL',
      costScrap: 250,
      extraKw: 4,
      summary: '+45% RADIUS · 5.2S FLAME WALL',
    },
  },
  RAIL_LANCE: {
    A: {
      id: 'A',
      code: 'OVERPEN',
      costScrap: 280,
      extraKw: 6,
      summary: 'INFINITE HALL PIERCE · +40% DMG',
    },
    B: {
      id: 'B',
      code: 'CAPACITOR',
      costScrap: 280,
      extraKw: 4,
      summary: '-35% RECHARGE · STAGGERS BOSSES',
    },
  },
  CRYO_VALVE: {
    A: {
      id: 'A',
      code: 'DEEP FREEZE',
      costScrap: 190,
      extraKw: 2,
      summary: '72% SLOW · +55% SHATTER VULN',
    },
    B: {
      id: 'B',
      code: 'CRYO COOLER',
      costScrap: 190,
      extraKw: 0,
      summary: '2X GUN COOLING AURA & RADIUS',
    },
  },
  SHOCK_COIL: {
    A: {
      id: 'A',
      code: 'TESLA CHAIN',
      costScrap: 210,
      extraKw: 4,
      summary: 'CHAINS 7 TARGETS · +35% ARC DMG',
    },
    B: {
      id: 'B',
      code: 'EMP PULSE',
      costScrap: 210,
      extraKw: 2,
      summary: '1.2S STUN · SLOWS CRUSHER/QUEEN',
    },
  },
  MOTION_RELAY: {
    A: {
      id: 'A',
      code: 'FLOODLIGHT',
      costScrap: 175,
      extraKw: 4,
      summary: 'PERMANENT 240PX LIT HALO AURA',
    },
    B: {
      id: 'B',
      code: 'TGT MATRIX',
      costScrap: 175,
      extraKw: 2,
      summary: '+32% CRIT & +32% RNG TO LINKED',
    },
  },
};

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
    name: 'UA 571-C SENTRY',
    costScrap: 100,
    powerKw: 22,
    upgradeCostScrap: 90,
    rangePx: 350, // 11.7m full illuminated range (55% in dark corridors!)
    coneHalfAngleRad: (30 * Math.PI) / 180, // 60° directional firing cone
    maxAmmo: 320,
    summary: 'PAD · 320-RD DRUM · +100% RNG LIT',
  },
  INCINERATOR: {
    id: 'INCINERATOR',
    shortKey: '2',
    code: 'M240 INCIN',
    name: 'M240 INCINERATOR',
    costScrap: 125,
    powerKw: 26,
    upgradeCostScrap: 100,
    rangePx: 204, // 6.8m choke-point projector
    coneHalfAngleRad: (38 * Math.PI) / 180, // 76° flame arc
    maxAmmo: 0,
    summary: 'PAD · NAPALM LIGHTS & STERILIZES ACID',
  },
  RAIL_LANCE: {
    id: 'RAIL_LANCE',
    shortKey: '3',
    code: 'M99 RAIL',
    name: 'M99 RAIL-LANCE',
    costScrap: 150,
    powerKw: 30,
    upgradeCostScrap: 125,
    rangePx: 540, // 18.0m long-hallway corridor sniper!
    coneHalfAngleRad: (16 * Math.PI) / 180, // Focused 32° corridor sniper lane
    maxAmmo: 0,
    summary: 'PAD · PIERCES ARMOR & 4 LINED FOES',
  },
  CRYO_VALVE: {
    id: 'CRYO_VALVE',
    shortKey: '4',
    code: 'CRYO-VLV',
    name: 'CRYO-STASIS VALVE',
    costScrap: 80,
    powerKw: 14,
    upgradeCostScrap: 75,
    rangePx: 142, // 4.7m duct grate plume
    coneHalfAngleRad: 0,
    maxAmmo: 0,
    summary: 'GRATE · SLOWS 58% · SHATTER +35%',
  },
  SHOCK_COIL: {
    id: 'SHOCK_COIL',
    shortKey: '5',
    code: 'ARC-COIL',
    name: 'ARC-SHOCK COIL',
    costScrap: 95,
    powerKw: 18,
    upgradeCostScrap: 85,
    rangePx: 168, // 5.6m Tesla arc discharge
    coneHalfAngleRad: 0,
    maxAmmo: 0,
    summary: 'GRATE · CHAIN STUN · DECLOAKS STALKER',
  },
  MOTION_RELAY: {
    id: 'MOTION_RELAY',
    shortKey: '6',
    code: 'M314 RLY',
    name: 'M314 MOTION RELAY',
    costScrap: 65,
    powerKw: 10,
    upgradeCostScrap: 60,
    rangePx: 465, // 15.5m radar sweep
    coneHalfAngleRad: 0,
    maxAmmo: 0,
    summary: 'PAD · ILLUMINATES & +24% LINKED RNG',
  },
  ARC_WELDER: {
    id: 'ARC_WELDER',
    shortKey: '7',
    code: 'ARC-WELD',
    name: 'ARC-WELD DOOR SEAL',
    costScrap: 55,
    powerKw: 0,
    upgradeCostScrap: 0,
    rangePx: 0,
    coneHalfAngleRad: 0,
    maxAmmo: 0,
    summary: 'DOOR · 2.0S TORCH · REROUTES PATHS',
  },
  CLAYMORE: {
    id: 'CLAYMORE',
    shortKey: '8',
    code: 'M18 MINE',
    name: 'PROXIMITY CLAYMORE',
    costScrap: 35,
    powerKw: 0,
    upgradeCostScrap: 0,
    rangePx: 152,
    coneHalfAngleRad: 0,
    maxAmmo: 0,
    summary: 'CORRIDOR · 0 kW · 195 BLAST + ACID CLEAR',
  },
};

export type HostileKind =
  | 'SKITTERER'
  | 'DRONE'
  | 'PRAETORIAN'
  | 'BURSTER'
  | 'STALKER'
  | 'SPITTER'
  | 'SCREAMER'
  | 'CRUSHER'
  | 'QUEEN';

export interface HostileSpec {
  kind: HostileKind;
  name: string;
  shortCode: string;
  baseHp: number;
  speedPxS: number;
  radiusPx: number;
  scrapReward: number;
  scoreValue: number;
  doorDps: number;
  isBoss?: boolean;
}

export const HOSTILE_SPECS: Record<HostileKind, HostileSpec> = {
  SKITTERER: {
    kind: 'SKITTERER',
    name: 'SKITTERER SWARMER',
    shortCode: 'SKT',
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
    shortCode: 'DRN',
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
    shortCode: 'PRT',
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
    shortCode: 'BRS',
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
    shortCode: 'STK',
    baseHp: 98,
    speedPxS: 96,
    radiusPx: 12,
    scrapReward: 15,
    scoreValue: 210,
    doorDps: 26,
  },
  SPITTER: {
    kind: 'SPITTER',
    name: 'ACID SPITTER',
    shortCode: 'SPT',
    baseHp: 128,
    speedPxS: 64,
    radiusPx: 13,
    scrapReward: 18,
    scoreValue: 240,
    doorDps: 36,
  },
  SCREAMER: {
    kind: 'SCREAMER',
    name: 'BIO-SCREAMER JAMMER',
    shortCode: 'SCR',
    baseHp: 142,
    speedPxS: 74,
    radiusPx: 14,
    scrapReward: 22,
    scoreValue: 280,
    doorDps: 24,
  },
  CRUSHER: {
    kind: 'CRUSHER',
    name: 'JUGGERNAUT CRUSHER',
    shortCode: 'CRSH',
    baseHp: 1120,
    speedPxS: 44,
    radiusPx: 26,
    scrapReward: 95,
    scoreValue: 1150,
    doorDps: 135,
    isBoss: true,
  },
  QUEEN: {
    kind: 'QUEEN',
    name: 'XENO MATRIARCH QUEEN',
    shortCode: 'QUEEN',
    baseHp: 2650,
    speedPxS: 34,
    radiusPx: 32,
    scrapReward: 240,
    scoreValue: 2800,
    doorDps: 210,
    isBoss: true,
  },
};

export type ProtocolId =
  | 'DU_ROUNDS'
  | 'AUTOLOADER'
  | 'AUX_BUS'
  | 'CRYO_SHATTER'
  | 'THERMITE_CATALYST'
  | 'OPTICS_GAIN'
  | 'CAPACITOR_DRIVE'
  | 'SALVAGE_BONUS'
  | 'BULKHEAD_ARMOR'
  | 'SEAL_FABRICATION';

export interface TacticalProtocolSpec {
  id: ProtocolId;
  code: string;
  title: string;
  desc: string;
  accent: string;
  maxStacks: number;
}

export const TACTICAL_PROTOCOLS: Record<ProtocolId, TacticalProtocolSpec> = {
  DU_ROUNDS: {
    id: 'DU_ROUNDS',
    code: 'DU-10MM',
    title: 'DEPLETED URANIUM ROUNDS',
    desc: '+18% SENTRY & RAIL DMG · +25% ARMOR PIERCE',
    accent: '#FFB000',
    maxStacks: 4,
  },
  AUTOLOADER: {
    id: 'AUTOLOADER',
    code: 'AUTO-BELT',
    title: 'AUTOLOADER BELT FEEDS',
    desc: '-45% REARM TIME · -35% REARM SCRAP COST',
    accent: '#44FF77',
    maxStacks: 2,
  },
  AUX_BUS: {
    id: 'AUX_BUS',
    code: '+20kW BUS',
    title: 'AUXILIARY REACTOR CAPACITOR',
    desc: '+20 kW MAX POWER CAPACITY IMMEDIATELY',
    accent: '#00F0FF',
    maxStacks: 5,
  },
  CRYO_SHATTER: {
    id: 'CRYO_SHATTER',
    code: 'SHATTER+',
    title: 'CRYO-SHATTER RESONANCE',
    desc: '+25% SHATTER CRIT DMG · +20% CRYO & SHOCK RADIUS',
    accent: '#9BF8FF',
    maxStacks: 3,
  },
  THERMITE_CATALYST: {
    id: 'THERMITE_CATALYST',
    code: 'THERMITE',
    title: 'THERMITE NAPALM CATALYST',
    desc: '+30% BURN DPS · +20 EXTRA SCRAP PER STERILIZE',
    accent: '#FF7733',
    maxStacks: 3,
  },
  OPTICS_GAIN: {
    id: 'OPTICS_GAIN',
    code: 'OPTICS+',
    title: 'HIGH-GAIN THERMAL OPTICS',
    desc: '+18% ILLUMINATED CRIT · +4S FLARE & FLOODLIGHT',
    accent: '#FFF6CC',
    maxStacks: 3,
  },
  CAPACITOR_DRIVE: {
    id: 'CAPACITOR_DRIVE',
    code: 'CAP-DRIVE',
    title: 'RESERVE BATTERY OVERDRIVE',
    desc: '+50% BATTERY CHARGE RATE · +2.5S OVERCLOCK',
    accent: '#44FFDD',
    maxStacks: 3,
  },
  SALVAGE_BONUS: {
    id: 'SALVAGE_BONUS',
    code: 'SALVAGE+',
    title: 'WEYLAND SALVAGE REQUISITION',
    desc: '+22% SCRAP FROM ALL KILLS & WAVE BONUSES',
    accent: '#FFB000',
    maxStacks: 3,
  },
  BULKHEAD_ARMOR: {
    id: 'BULKHEAD_ARMOR',
    code: 'DOOR-ARMOR',
    title: 'REINFORCED BULKHEAD PLATING',
    desc: '+45% DOOR SEAL HP · +1 MAX SIMULTANEOUS SEAL',
    accent: '#8EF5AB',
    maxStacks: 2,
  },
  SEAL_FABRICATION: {
    id: 'SEAL_FABRICATION',
    code: '+1 SEAL',
    title: 'EMERGENCY CORE SEAL FABRICATION',
    desc: 'IMMEDIATELY RESTORES +1 BLOWN REACTOR CORE SEAL',
    accent: '#44FF77',
    maxStacks: 99,
  },
};

export type WaveMutatorId =
  | 'NONE'
  | 'GRID_BROWNOUT'
  | 'ACIDIC_SURGE'
  | 'SUBFLOOR_BREACH'
  | 'THERMAL_SPIKE';

export interface WaveMutatorSpec {
  id: WaveMutatorId;
  label: string;
  desc: string;
  scoreMult: number;
  color: string;
}

export const WAVE_MUTATORS: Record<WaveMutatorId, WaveMutatorSpec> = {
  NONE: {
    id: 'NONE',
    label: 'NOMINAL',
    desc: 'STANDARD STATION CONDITIONS',
    scoreMult: 1.0,
    color: '#44FF77',
  },
  GRID_BROWNOUT: {
    id: 'GRID_BROWNOUT',
    label: 'GRID BROWNOUT',
    desc: 'CORE LIGHT HALVED · +50% WAVE SCORE',
    scoreMult: 1.5,
    color: '#FFB000',
  },
  ACIDIC_SURGE: {
    id: 'ACIDIC_SURGE',
    label: 'ACIDIC SURGE',
    desc: 'VOLATILE ACID POOLS · 2X STERILIZE SCRAP · +50% SCORE',
    scoreMult: 1.5,
    color: '#B8FF3B',
  },
  SUBFLOOR_BREACH: {
    id: 'SUBFLOOR_BREACH',
    label: 'SUB-FLOOR BREACH',
    desc: 'ALL 4 FLOOR GRATES ACTIVE · +50% WAVE SCORE',
    scoreMult: 1.5,
    color: '#FF5522',
  },
  THERMAL_SPIKE: {
    id: 'THERMAL_SPIKE',
    label: 'THERMAL SPIKE',
    desc: '+28% BARREL HEAT · FASTER COOLANT FLUSH · +50% SCORE',
    scoreMult: 1.5,
    color: '#FF8833',
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
  callsign: string; // e.g. 'A-01', 'F-01', 'R-01', 'C-01', 'S-01', 'M-01'
  kind: TurretKind;
  col: number;
  row: number;
  pos: Vec2;
  powered: boolean;
  level: 1 | 2 | 3;
  mk3Branch?: Mk3BranchId;
  angle: number; // Current mechanical barrel/emitter heading (radians)
  targetAngle: number; // Desired heading (servo slews toward this)
  ammo: number;
  maxAmmo: number;
  /** >0 while mid-wave automated ammo belt reload cycle is running (turret offline) */
  rearmTimer: number;
  rearmDuration: number;
  heat: number; // 0 .. 100
  thermalLocked: boolean;
  fireCooldown: number;
  pulseTimer: number; // For M314 sweep / Cryo vent / Shock coil cycle
  firingFlashTimer: number;
  dryFireTimer: number;
  overclockTimer: number;
  relayBoosted: boolean;
  relayMatrixBoosted: boolean;
  acidDebuffTimer: number; // Spitter acid glob temporarily blinds/heats turret!
  jammedTimer: number; // Screamer jams M314 radar sweeps!
  // Laser tripwire endpoint for MOTION_RELAY
  tripwireStart?: Vec2;
  tripwireEnd?: Vec2;
  tripwireIntegrity: number; // 0..100 (damaged by acid pools, auto-calibrates when clear)
  kills: number;
}

export interface ProximityClaymore {
  id: string;
  col: number;
  row: number;
  pos: Vec2;
  armTimer: number; // 0.6s arming delay
}

export interface AcidSpitProjectile {
  id: number;
  pos: Vec2;
  targetPos: Vec2;
  vel: Vec2;
  life: number;
  maxLife: number;
  targetDoorId?: string;
  targetTurretId?: string;
}

export interface QueenEggSac {
  id: number;
  pos: Vec2;
  hp: number;
  maxHp: number;
  hatchTimer: number;
  maxHatchTimer: number;
}

export interface ShockArcBolt {
  points: Vec2[];
  life: number;
  maxLife: number;
}

export interface RailBeamBolt {
  p1: Vec2;
  p2: Vec2;
  life: number;
  maxLife: number;
  tier: 1 | 2 | 3;
}

export interface PhantomBlip {
  pos: Vec2;
  life: number;
  maxLife: number;
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
  cryoDeepFreeze: boolean; // True if hit by MK-III Deep Freeze Cryo
  napalmBurnTimer: number;
  stunTimer: number;
  /** True when illuminated by Flare, Floodlight, M314 sweep, Tripwire, Cryo, Core Light, or Napalm */
  illuminated: boolean;
  verified: boolean; // True when illuminated OR inside turret's short 55% unlit IR cone
  batteringDoorId: string | null;
  abilityCooldown: number; // Spitter spit, Screamer jam, Crusher charge, Queen egg lay
  chargeTelegraphTimer: number; // Crusher pre-charge telegraph
  chargeActiveTimer: number; // Crusher high-speed corridor charge
  lastBurnTurretId?: string;
  queenEggStage?: number; // 0 -> 1 at 75% HP, 1 -> 2 at 40% HP
  isBoss?: boolean;
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
  isThermite?: boolean;
  sourceTurretId?: string;
}

export interface CryoPlume {
  pos: Vec2;
  radius: number;
  remainingSec: number;
  maxSec: number;
  isDeepFreeze?: boolean;
  isCooler?: boolean;
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
  mutator?: WaveMutatorId;
  hasBoss?: 'CRUSHER' | 'QUEEN';
}

export type PerimeterMode = 'ENDLESS_SIEGE';

export type PerimeterPhase =
  | 'BRIEFING'
  | 'TACTICAL_PREP'
  | 'WAVE_ACTIVE'
  | 'PROTOCOL_DRAFT'
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
