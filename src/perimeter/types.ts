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
  SCRAP_REACTOR_KW_HARD_CAP: 295, // Scrap reactor expansions stop at 295 kW; ONLY AUX_BUS pushes 295 -> 375 kW!
  MAX_REACTOR_KW_HARD_CAP: 375,
  MAX_BULKHEAD_SEALS: 3,

  CORE_BASELINE_SWEEP_INTERVAL: 2.15,
  CORE_BASELINE_SWEEP_RADIUS: 500, // ~16.7m baseline perimeter tracker from Core (compressed for real fog-of-war)
  CORE_LIT_RADIUS: 135, // Inner sterile lit chamber around Reactor Core

  WELD_COST_SCRAP: 65,
  DOOR_MAX_HP: 480,
  MAX_ACTIVE_DOOR_SEALS: 3,
  WELD_DURATION_SEC: 1.5,
  DOOR_MIDWAVE_WELD_SEC: 1.5,
  WELD_REPAIR_COOLDOWN_SEC: 4.0,

  CLAYMORE_COST_SCRAP: 50,
  CLAYMORE_MAX_ACTIVE: 6,
  CLAYMORE_STOCK_PER_WAVE: 6,
  CLAYMORE_PREP_ARM_SEC: 0.5,
  CLAYMORE_MIDWAVE_ARM_SEC: 1.5,
  CLAYMORE_TRIGGER_RADIUS_PX: 54,
  CLAYMORE_BLAST_RADIUS_PX: 152,
  CLAYMORE_DAMAGE: 195,

  REARM_COST_SCRAP: 45,
  REARM_DURATION_SEC: 2.8,

  REACTOR_EXPAND_BASE_COST: 220,
  REACTOR_EXPAND_STEP_COST: 120,
  REACTOR_EXPAND_KW_STEP: 15,
  SEAL_REBUILD_COST_SCRAP: 480,

  TURRET_POWER_SPINUP_SEC: 2.5,

  PROTOCOL_REROLL_BASE_COST: 150,
  PROTOCOL_REROLL_STEP_COST: 150,

  MK4_REFIT_COSTS: [450, 700, 1000] as const,
  MK4_DMG_PER_LEVEL: 0.1,
  MK4_KW_PER_LEVEL: 1,

  RESUPPLY_BASE_COST: 250,
  RESUPPLY_STEP_COST: 100,

  DARK_CORRIDOR_RANGE_MULT: 0.55,
  DARK_CORRIDOR_MISS_CHANCE: 0.2,
  RAIL_DARK_MISS_CHANCE: 0.1,
  ILLUMINATED_CRIT_MULT: 1.2,

  REACTOR_OVERLOAD_TRIP_SEC: 4.0,
  REACTOR_BLACKOUT_SEC: 3.5,
  GRATE_TELEGRAPH_SEC: 5.0,

  FLARE_COOLDOWN_SEC: 18,
  FLARE_DURATION_SEC: 12,
  FLARE_RADIUS_PX: 255,
  FLARE_SURGE_KW: 0,
  FLARE_SURGE_SEC: 0,

  OVERCLOCK_COOLDOWN_SEC: 22,
  OVERCLOCK_DURATION_SEC: 8,
  OVERCLOCK_RADIUS_PX: 265,
  OVERCLOCK_SURGE_KW: 22,

  FLOODLIGHT_BATTERY_COST: 40, // Consumes 40% Reactor Reserve Battery for 7.5s map-wide light + crit + jam purge!
  FLOODLIGHT_DURATION_SEC: 7.5,
  FLOODLIGHT_COOLDOWN_SEC: 20,

  COOLANT_FLUSH_COOLDOWN_SEC: 20,
  COOLANT_FLUSH_SURGE_KW: 10,
  COOLANT_FLUSH_SURGE_SEC: 1.6,

  PURGE_PUSH_PX: 290,
} as const;

export interface GridCoord {
  col: number;
  row: number;
}

export type SectorId = 'SEC-01' | 'SEC-02' | 'SEC-03';

export interface DynamicBreachDef {
  id: string;
  /** Explicit waves on which this breach triggers (e.g., [5] or [15, 25]) */
  triggerWaves: number[];
  /** Optional modulo-10 trigger (e.g. 5 -> fires on W5, W15, W25... when cycling back to this sector) */
  triggerWaveMod10?: 5 | 15 | 25;
  label: string;
  /** AIR_SHAFT / BULKHEAD cells that collapse into walkable 'CORRIDOR' upon breach */
  tiles: GridCoord[];
  /** Optional CAD fracture lines in virtual pixel coordinates for Prep telegraph rendering */
  previewLines?: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}

export type TileKind =
  | 'BULKHEAD'
  | 'AIR_SHAFT'
  | 'CORRIDOR'
  | 'MOUNT_PAD'
  | 'DUCT_GRATE'
  | 'SPAWN_GRATE'
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
      summary: '640 DRUM · +35% ROF · LOW HEAT · 2-TARGET SPLASH',
    },
  },
  INCINERATOR: {
    A: {
      id: 'A',
      code: 'THERMITE',
      costScrap: 250,
      extraKw: 4,
      summary: '+65% BURN DPS · -35% ARMOR MELT (4S)',
    },
    B: {
      id: 'B',
      code: 'FIREWALL',
      costScrap: 250,
      extraKw: 4,
      summary: '+45% RADIUS · -25% SLOW · EGG TARGETING',
    },
  },
  RAIL_LANCE: {
    A: {
      id: 'A',
      code: 'OVERPEN',
      costScrap: 280,
      extraKw: 6,
      summary: 'PIERCES 12 FOES · +40% DMG · 10% DARK MISS',
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
      summary: '72% SLOW (36% BOSS) · +55% SHATTER VULN',
    },
    B: {
      id: 'B',
      code: 'CRYO COOLER',
      costScrap: 190,
      extraKw: 0,
      summary: '320PX 2X COOL AURA · -20% HEAT · +15% ROF',
    },
  },
  SHOCK_COIL: {
    A: {
      id: 'A',
      code: 'TESLA CHAIN',
      costScrap: 210,
      extraKw: 4,
      summary: '7-CHAIN · WAVE SCALING + 5% MAX-HP SHOCK',
    },
    B: {
      id: 'B',
      code: 'EMP PULSE',
      costScrap: 210,
      extraKw: 2,
      summary: '1.2S STUN · -50% ARMOR SHRED · 4S SILENCE',
    },
  },
  MOTION_RELAY: {
    A: {
      id: 'A',
      code: 'FLOODLIGHT',
      costScrap: 175,
      extraKw: 2,
      summary: '280PX JAM-IMMUNE OPTICAL HALO · +15% CRIT',
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
    summary: 'PAD · NAPALM REVEALS & STERILIZES ACID',
  },
  RAIL_LANCE: {
    id: 'RAIL_LANCE',
    shortKey: '3',
    code: 'M99 RAIL',
    name: 'M99 RAIL-LANCE',
    costScrap: 150,
    powerKw: 30,
    upgradeCostScrap: 125,
    rangePx: 460, // 15.3m compressed corridor sniper lane
    coneHalfAngleRad: (16 * Math.PI) / 180, // Focused 32° corridor sniper lane
    maxAmmo: 0,
    summary: 'PAD · PIERCES ARMOR & 4 FOES · 10% DARK MISS',
  },
  CRYO_VALVE: {
    id: 'CRYO_VALVE',
    shortKey: '4',
    code: 'CRYO-VLV',
    name: 'CRYO-STASIS VALVE',
    costScrap: 80,
    powerKw: 14,
    upgradeCostScrap: 75,
    rangePx: 142, // 4.7m LOS-bound duct grate plume
    coneHalfAngleRad: 0,
    maxAmmo: 0,
    summary: 'GRATE · LOS SLOW 58% · SHATTER +35%',
  },
  SHOCK_COIL: {
    id: 'SHOCK_COIL',
    shortKey: '5',
    code: 'ARC-COIL',
    name: 'ARC-SHOCK COIL',
    costScrap: 95,
    powerKw: 18,
    upgradeCostScrap: 85,
    rangePx: 168, // 5.6m LOS-bound Tesla arc discharge
    coneHalfAngleRad: 0,
    maxAmmo: 0,
    summary: 'GRATE · WAVE-SCALING ARC · DECLOAKS STALKER',
  },
  MOTION_RELAY: {
    id: 'MOTION_RELAY',
    shortKey: '6',
    code: 'M314 RLY',
    name: 'M314 MOTION RELAY',
    costScrap: 65,
    powerKw: 10,
    upgradeCostScrap: 60,
    rangePx: 390, // 13.0m radar sweep (MK-II ~430px)
    coneHalfAngleRad: 0,
    maxAmmo: 0,
    summary: 'PAD · ILLUMINATES & +24% LINKED RNG',
  },
  ARC_WELDER: {
    id: 'ARC_WELDER',
    shortKey: '7',
    code: 'ARC-WELD',
    name: 'ARC-WELD DOOR SEAL',
    costScrap: 65,
    powerKw: 0,
    upgradeCostScrap: 0,
    rangePx: 0,
    coneHalfAngleRad: 0,
    maxAmmo: 0,
    summary: 'DOOR · 1.5S TORCH · 480 HP · REROUTES PATHS',
  },
  CLAYMORE: {
    id: 'CLAYMORE',
    shortKey: '8',
    code: 'M18 MINE',
    name: 'PROXIMITY CLAYMORE',
    costScrap: 50,
    powerKw: 0,
    upgradeCostScrap: 0,
    rangePx: 152,
    coneHalfAngleRad: 0,
    maxAmmo: 0,
    summary: 'CORRIDOR · 6/WAVE · WAVE-SCALED BLAST + ACID CLEAR',
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
    baseHp: 960,
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
  | 'AEGIS_SHIELD';

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
    desc: '+15% SENTRY/RAIL DMG · +25% AP (100% CAP, EXCESS -> BOSS DMG)',
    accent: '#FFB000',
    maxStacks: 3,
  },
  AUTOLOADER: {
    id: 'AUTOLOADER',
    code: 'AUTO-BELT',
    title: 'AUTOLOADER BELT FEEDS',
    desc: '-45% REARM TIME/COST · AUTO-REARMS · +20% DRUM · -15% SENTRY HEAT',
    accent: '#44FF77',
    maxStacks: 2,
  },
  AUX_BUS: {
    id: 'AUX_BUS',
    code: '+20kW BUS',
    title: 'AUXILIARY REACTOR CAPACITOR',
    desc: '+20 kW NOW & +20 kW TO HARD CAP (295 -> 375 kW)',
    accent: '#00F0FF',
    maxStacks: 4,
  },
  CRYO_SHATTER: {
    id: 'CRYO_SHATTER',
    code: 'SHATTER+',
    title: 'CRYO-SHATTER RESONANCE',
    desc: '+20% SHATTER DMG · +15% LOS-BOUND CRYO & SHOCK RADIUS',
    accent: '#9BF8FF',
    maxStacks: 2,
  },
  THERMITE_CATALYST: {
    id: 'THERMITE_CATALYST',
    code: 'THERMITE',
    title: 'THERMITE NAPALM CATALYST',
    desc: '+25% BURN DPS · +12 FLAT STERILIZE SCRAP (NO DECAY)',
    accent: '#FF7733',
    maxStacks: 2,
  },
  OPTICS_GAIN: {
    id: 'OPTICS_GAIN',
    code: 'OPTICS+',
    title: 'HIGH-GAIN THERMAL OPTICS',
    desc: '+15% LIT CRIT DMG · +2.5S FLARE & FLOODLIGHT',
    accent: '#FFF6CC',
    maxStacks: 2,
  },
  CAPACITOR_DRIVE: {
    id: 'CAPACITOR_DRIVE',
    code: 'CAP-DRIVE',
    title: 'RESERVE BATTERY OVERDRIVE',
    desc: '+40% BATTERY CHARGE · +2.0S OVERCLOCK · -20% OC SURGE kW',
    accent: '#44FFDD',
    maxStacks: 2,
  },
  SALVAGE_BONUS: {
    id: 'SALVAGE_BONUS',
    code: 'SALVAGE+',
    title: 'WEYLAND SALVAGE REQUISITION',
    desc: '+25% ALL SCRAP (INCL. ACID/EGGS) · +1 FREE DRAFT REROLL',
    accent: '#FFB000',
    maxStacks: 2,
  },
  BULKHEAD_ARMOR: {
    id: 'BULKHEAD_ARMOR',
    code: 'DOOR-ARMOR',
    title: 'ELECTRIFIED BULKHEAD PLATING',
    desc: '+50% DOOR HP · +1 SEAL · 55 DPS RECOIL · 50% ACID REFLECT',
    accent: '#8EF5AB',
    maxStacks: 2,
  },
  AEGIS_SHIELD: {
    id: 'AEGIS_SHIELD',
    code: 'AEGIS-SHD',
    title: 'AEGIS CORE ENERGY BARRIER',
    desc: '+1 CORE SEAL NOW · 1-HIT CORE BARRIER (RECHARGES EVERY 5 WAVES)',
    accent: '#00F0FF',
    maxStacks: 2,
  },
};

export type OmegaDirectiveId =
  | 'VOLATILE_OVERPRESSURE'
  | 'THERMAL_SHOCK'
  | 'BREACH_SAPPER'
  | 'NIGHT_HUNTER_OPTICS';

export interface OmegaDirectiveSpec {
  id: OmegaDirectiveId;
  code: string;
  title: string;
  upside: string;
  downside: string;
  desc: string;
  accent: string;
}

export const OMEGA_DIRECTIVES: Record<OmegaDirectiveId, OmegaDirectiveSpec> = {
  VOLATILE_OVERPRESSURE: {
    id: 'VOLATILE_OVERPRESSURE',
    code: 'Ω-OVERPRES',
    title: 'VOLATILE OVERPRESSURE',
    upside: '+30% ALL TURRET FIRE RATE',
    downside: '+35% BARREL HEAT BUILDUP',
    desc: '+30% ALL TURRET ROF · BUT +35% HEAT BUILDUP',
    accent: '#FF6622',
  },
  THERMAL_SHOCK: {
    id: 'THERMAL_SHOCK',
    code: 'Ω-THRMSHK',
    title: 'THERMAL SHOCK DETONATION',
    upside: 'CRYO/RAIL ON BURNING FOE = 8% MAX-HP BLAST (4S ICD)',
    downside: 'CONSUMES & CLEARS BURN + CRYO ON TRIGGER',
    desc: 'CRYO/RAIL VS BURNING: 8% MAX-HP BLAST (4S ICD) · CLEARS BURN & CRYO',
    accent: '#00F0FF',
  },
  BREACH_SAPPER: {
    id: 'BREACH_SAPPER',
    code: 'Ω-SAPPER',
    title: 'BREACH SAPPER PROTOCOL',
    upside: '+4 MINES/WAVE · +50% BLAST DMG · 4S NAPALM · AUTO-SEEDS GRATES',
    downside: 'DEDICATES BOSS OMEGA SLOT TO CORRIDOR ORDNANCE',
    desc: '+4 MINES/WAVE · +50% BLAST · 4S NAPALM · AUTO-SEEDS RATTLING GRATES',
    accent: '#FFB000',
  },
  NIGHT_HUNTER_OPTICS: {
    id: 'NIGHT_HUNTER_OPTICS',
    code: 'Ω-NIGHTOPT',
    title: 'NIGHT-HUNTER OPTICS',
    upside: '+35% DMG IN DARKNESS · 0% DARK MISS CHANCE',
    downside: 'DISABLES [L] EMERGENCY FLOODLIGHT',
    desc: '+35% DMG IN DARKNESS · 0% DARK MISS · DISABLES [L] FLOODLIGHT',
    accent: '#D477FF',
  },
};

export type EndgameDirectiveId =
  | 'EMERGENCY_ORDNANCE'
  | 'REACTOR_OVERDRIVE'
  | 'COMBAT_TELEMETRY';

export interface EndgameDirectiveSpec {
  id: EndgameDirectiveId;
  code: string;
  title: string;
  desc: string;
  accent: string;
}

export const ENDGAME_DIRECTIVES: Record<EndgameDirectiveId, EndgameDirectiveSpec> = {
  EMERGENCY_ORDNANCE: {
    id: 'EMERGENCY_ORDNANCE',
    code: 'END-ORD',
    title: 'EMERGENCY ORDNANCE DROP',
    desc: '+1 AIRLOCK PURGE CHARGE · +250 SCRAP IMMEDIATELY',
    accent: '#FFB000',
  },
  REACTOR_OVERDRIVE: {
    id: 'REACTOR_OVERDRIVE',
    code: 'END-OVR',
    title: 'REACTOR OVERDRIVE TUNING',
    desc: '+5% GLOBAL OVERCLOCK & TURRET DMG (STACKABLE)',
    accent: '#00F0FF',
  },
  COMBAT_TELEMETRY: {
    id: 'COMBAT_TELEMETRY',
    code: 'END-TLM',
    title: 'COMBAT TELEMETRY UPLINK',
    desc: '+15% PERMANENT SCORE MULTIPLIER (STACKABLE)',
    accent: '#44FF77',
  },
};

export type DraftChoiceId = ProtocolId | EndgameDirectiveId;
export type DraftMode = 'PROTOCOL' | 'OMEGA';

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
  scrapMult: number;
  color: string;
}

export const WAVE_MUTATORS: Record<WaveMutatorId, WaveMutatorSpec> = {
  NONE: {
    id: 'NONE',
    label: 'NOMINAL',
    desc: 'STANDARD STATION CONDITIONS',
    scoreMult: 1.0,
    scrapMult: 1.0,
    color: '#44FF77',
  },
  GRID_BROWNOUT: {
    id: 'GRID_BROWNOUT',
    label: 'GRID BROWNOUT',
    desc: 'CORE LIGHT HALVED · +20% SCRAP · +50% SCORE',
    scoreMult: 1.5,
    scrapMult: 1.2,
    color: '#FFB000',
  },
  ACIDIC_SURGE: {
    id: 'ACIDIC_SURGE',
    label: 'ACIDIC SURGE',
    desc: 'VOLATILE ACID POOLS · 2X STERILIZE · +20% SCRAP · +50% SCORE',
    scoreMult: 1.5,
    scrapMult: 1.2,
    color: '#B8FF3B',
  },
  SUBFLOOR_BREACH: {
    id: 'SUBFLOOR_BREACH',
    label: 'SUB-FLOOR BREACH',
    desc: 'ALL 4 FLOOR GRATES ACTIVE · +20% SCRAP · +50% SCORE',
    scoreMult: 1.5,
    scrapMult: 1.2,
    color: '#FF5522',
  },
  THERMAL_SPIKE: {
    id: 'THERMAL_SPIKE',
    label: 'THERMAL SPIKE',
    desc: '+28% BARREL HEAT · FASTER FLUSH · +20% SCRAP · +50% SCORE',
    scoreMult: 1.5,
    scrapMult: 1.2,
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
  tiles: GridCoord[];
  center: Vec2;
  orientation: 'HORIZONTAL' | 'VERTICAL';
}

export interface AirlockChamberDef {
  id: string;
  label: string;
  tiles: GridCoord[];
  bounds: ViewportRect;
  center: Vec2;
  flushDir: Vec2; // Unit vector pointing strictly outward away from Core
}

export interface RoomLabelDef {
  text: string;
  subText?: string;
  x: number;
  y: number;
}

export interface ColonyBlueprint {
  sectorId: SectorId;
  sectorName: string;
  /** Legacy aliases matching sectorId / sectorName for backwards compatibility */
  code: SectorId;
  name: string;
  cols: number;
  rows: number;
  tileSize: number;
  tiles: TileKind[][];
  coreCenter: Vec2;
  coreTiles: GridCoord[];
  vents: BreachVentDef[];
  blastDoors: BlastDoorDef[];
  airlocks: AirlockChamberDef[];
  roomLabels: RoomLabelDef[];
  dynamicBreaches: DynamicBreachDef[];
}

export type SectorBlueprint = ColonyBlueprint;

export interface BlastDoorState {
  def: BlastDoorDef;
  welded: boolean;
  hp: number;
  maxHp: number;
  underAttackTimer: number;
  acidCorrodingTimer: number;
  /** >0 while mid-wave 1.5s Arc-Weld torch sequence is actively running */
  weldingTimer: number;
  weldingDuration: number;
  /** Brief cooldown after a weld/repair completes to prevent mid-wave repair spam */
  repairCooldown: number;
  /** Tracks HP band (4: >75%, 3: <=75%, 2: <=50%, 1: <=25%) to trigger damaged-door path recompute */
  lastPathHpBand?: number;
}

export type DoorState = BlastDoorState;

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
  /** MK-IV late-game refit level (0..3): +10% DMG / +1 kW per level */
  mk4Level: number;
  /** Mid-wave capacitor spin-up timer (2.5s) when toggled ON mid-wave */
  powerUpTimer: number;
  /** Cumulative Scrap spent on deploy + MK-II/III + MK-IV refits (100% refunded on Sector Extraction) */
  totalInvestedScrap: number;
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
  acidDebuffTimer: number; // Spitter acid glob / acid pool temporarily blinds/heats turret!
  jammedTimer: number; // Screamer jams M314 radar sweeps & relay links!
  // Laser tripwire endpoint for MOTION_RELAY
  tripwireStart?: Vec2;
  tripwireEnd?: Vec2;
  tripwireIntegrity: number; // 0..100 (damaged by acid pools, auto-calibrates when clear)
  kills: number;
}

export type TurretEntity = PlacedTurret;

export interface ProximityClaymore {
  id: string;
  col: number;
  row: number;
  pos: Vec2;
  armTimer: number; // 0.5s prep / 1.5s mid-wave arming delay
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
  /** Carapace stagger-immunity recovery timer (prevents permanent stunlock on bosses & elites!) */
  stunImmuneTimer?: number;
  knockbackVel?: Vec2;
  knockbackTimer?: number;
  knockbackMaxTimer?: number;
  /** EMP PULSE -50% frontal armor shred timer */
  armorShredTimer: number;
  /** EMP PULSE 4.0s caster silence timer (blocks Spitter/Screamer/Queen egg-lay) */
  silenceTimer: number;
  /** THERMAL_SHOCK Omega Directive 4.0s internal cooldown */
  thermalShockIcd: number;
  /** THERMITE Incinerator -35% armor melt timer (4.0s) */
  burnArmorMeltTimer: number;
  /** Seconds continuously battering a welded door (triggers Burster 1.5s acid-detonation / Crusher 5s ram) */
  doorBatterTimer: number;
  /** M314 FLOODLIGHT 6.0s Stalker stealth burn timer */
  stealthBurnTimer?: number;
  /** FIREWALL Incinerator -25% slow timer */
  firewallSlowTimer?: number;
  /** True when revealed by optical/sensor light (Flare, Floodlight, M314, Tripwire, Shock, Core) vs Cryo/Napalm only */
  opticalIlluminated?: boolean;
  /** True when illuminated by Flare, Floodlight, M314 sweep, Tripwire, Core Light, or Relay Flood */
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
  isFirewall?: boolean;
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
  fromBursterDoorBlast?: boolean;
}

export type AcidPool = AcidHazardPool;

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
  /** Optional explicit max HP override for special encounters (e.g., softened W5 Crusher = 960 HP) */
  hpOverride?: number;
}

export interface WaveDefinition {
  waveNumber: number;
  title: string;
  groups: WaveSpawnGroup[];
  scrapBonus: number;
  mutator?: WaveMutatorId;
  hasBoss?: 'CRUSHER' | 'QUEEN';
  /** Smoothed wave HP multiplier computed by Sector01Blueprint / SectorCatalog */
  hpScale?: number;
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
