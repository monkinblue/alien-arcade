export const TRENCH_CONSTANTS = {
  VIRTUAL_W: 1920,
  VIRTUAL_H: 1080,
  BASE_FOV_DEG: 75,
  AFTERBURNER_FOV_DEG: 86,
  NEAR_CLIP: 3.0,
  VIEW_DISTANCE: 4000, // 4,000m open-valley sightlines (6-8s reaction window!)
  TERRAIN_CELL_SIZE: 92, // World-snapped alpine heightmap pitch (blazing 60+ FPS across 4km!)
  SECTOR_LENGTH_M: 6000, // 6km Valley Strike Run per Sector

  // F-16 Fly-By-Wire (FLCS) Realistic Sea-Level Flight Envelope & Anti-Slow-Play Physics
  IDLE_SPEED_MPS: 78, // 0% IDLE (~152 KCAS — drops into stall below 180 KCAS!)
  MIL_SPEED_MPS: 255, // 100% MIL (~495 KCAS / Mach 0.75)
  BURNER_SPEED_MPS: 405, // 120% AFTERBURNER (~787 KCAS / Mach 1.19 sea-level!)
  MAX_THROTTLE: 1.2, // 0.0 .. 1.0 MIL detent .. 1.2 AFTERBURNER
  STALL_SPEED_KCAS: 180,
  CORNER_SPEED_MIN_KCAS: 310,
  CORNER_SPEED_MAX_KCAS: 460,
  NOE_ALTITUDE_RALT_M: 60, // Nap-Of-The-Earth (<60M RALT) score multiplier threshold!
  RESUPPLY_FLYTHROUGH_RADIUS_M: 55, // Generous high-speed fly-through OR gun pickup ring!
  MAX_PITCH_DEG: 72,
  COCKPIT_CLEARANCE_M: 5.0,
  HULL_MAX: 100,
  GAME_OVER_LOCKOUT_SEC: 1.2,

  // Fair, Cinematic SAM Defense & Dynamic Sector Radar Ceiling
  RADAR_CEILING_RALT_M: 190, // SEC-01 default; steps down cleanly in SEC-02+
  SAM_LOCK_WARNING_SEC: 3.5, // Clear 3.5-second RWR lock warning before SAM launch!
  SAM_FLIGHT_TIME_SEC: 4.5, // Cinematic 4.5-second SAM missile flight time
  SAM_ENGAGE_RANGE_M: 2800,

  // Fixed-Forward M61A1 20mm Rotary Cannon & Ballistics (Drag + Gravity)
  GUN_MAX_AMMO: 510,
  GUN_MUZZLE_SPEED_MPS: 960,
  GUN_GRAVITY_MPS2: 32.0,
  GUN_DRAG_PER_SEC: 0.28,
  GUN_MAX_AGE_SEC: 2.35,

  // Tactical Missiles (6x AGM / AIM-9) — Snappy 0.35s Locks & +40% Wider Seeker Cone!
  MISSILE_MAX_COUNT: 6,
  MISSILE_LOCK_TIME_SEC: 0.35,
  MISSILE_SEEKER_HALF_ANGLE_DEG: 22.0,
  MISSILE_MAX_LOCK_RANGE_M: 2800,

  // Chaff / Flare Countermeasure Dispenser System (CMDS)
  CMDS_MAX_COUNT: 8,
  CMDS_COOLDOWN_SEC: 2.0,
  CMDS_DECOY_RANGE_M: 1100,
  CMDS_SALVO_BEATS: 4, // 4 rhythmic cartridge pops ("thud-thud-thud-thud")
  CMDS_BEAT_INTERVAL_SEC: 0.23, // 0.00s, 0.23s, 0.46s, 0.69s
  CMDS_ACTIVE_PROTECTION_SEC: 2.5, // Continuous 2.5s chaff/flare immunity & lock suppression
} as const;

export type TrenchPhase = 'TITLE' | 'FLYING' | 'GAME_OVER';

/** Zero-Clutter Target Clarity: EXACTLY 3 unmistakable visual & tactical classes! */
export type CanyonTargetKind = 'SAM_SITE' | 'BANDIT_DRONE' | 'RESUPPLY_CACHE';

export type MissileLockState = 'NONE' | 'TRACKING' | 'LOCKED';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AircraftBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export interface CanyonArch {
  id: number;
  z: number;
  centerX: number;
  halfSpan: number;
  deckY: number;
  thicknessY: number;
  depthZ: number;
}

export interface CanyonTarget {
  id: number;
  kind: CanyonTargetKind;
  /** Sector number (1 = SEC-01, 2 = SEC-02, ...) that owns this objective */
  sectorNumber: number;
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Smoothed 3D acceleration (m/s^2) for weaving Bandit Drone lead prediction */
  ax?: number;
  ay?: number;
  az?: number;
  baseY: number;
  radius: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  hitFlashTimer: number;
  bobPhase: number;
  patrolAmp: number;
  baseX: number;
  /** Cruise speed along +Z for airborne Bandit Drones */
  cruiseSpeedMps?: number;
  /** Glowing phosphor wingtip/engine contrail history for Bandits */
  trail?: Vec3[];
  /** Per-site SAM tracking timer (launches at SAM_LOCK_WARNING_SEC = 3.5s) */
  samLockTimer?: number;
  /** True once SAM lock exceeded 1.1s so ducking behind a mesa awards TERRAIN MASKED! */
  samWasLocking?: boolean;
  /** Cooldown between SAM launches or AAA warning flak */
  fireCooldown?: number;
  /** Brief flash when firing */
  muzzleFlashTimer?: number;
}

export interface CannonRound {
  id: number;
  /** Exact world-space launch muzzle origin (analytical drag+gravity integration) */
  originX: number;
  originY: number;
  originZ: number;
  /** Exact initial launch velocity vector (jet momentum + muzzle along bore) */
  v0x: number;
  v0y: number;
  v0z: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  maxAge: number;
}

export interface TacticalMissile {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  speed: number;
  targetId: number | null;
  age: number;
  maxAge: number;
  trail: Vec3[];
}

export interface EnemySamMissile {
  id: number;
  sourceSiteId?: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  speed: number;
  maxSpeed: number;
  age: number;
  maxAge: number;
  decoyedByFlareId: number | null;
  evadedByHighG?: boolean;
  evadedByMask?: boolean;
  trail: Vec3[];
}

export interface EnemyFlakBurst {
  id: number;
  x: number;
  y: number;
  z: number;
  age: number;
  fuseTime: number;
  duration: number;
  radius: number;
  detonated: boolean;
  hitPlayer: boolean;
}

export interface CmdsFlare {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  maxAge: number;
  isChaff: boolean;
  trail: Vec3[];
}

export interface RwrContact {
  id: string;
  symbol: 'S' | 'B' | 'M';
  /** Relative bearing in radians from nose (0 = 12 o'clock, +PI/2 = 3 o'clock, PI = 6 o'clock) */
  bearingRad: number;
  /** Normalized scope radius (0.24 inner lethal ring .. 0.88 outer search ring) */
  rangeNorm: number;
  lethal: boolean;
  flashing: boolean;
}

export interface TrenchSpark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface WireframeExplosion {
  x: number;
  y: number;
  z: number;
  age: number;
  duration: number;
  maxRadius: number;
  color: string;
}

export interface TrenchPopup {
  text: string;
  subText?: string;
  nx: number;
  ny: number;
  color: string;
  age: number;
  duration: number;
}

export interface TrenchCrtShockwave {
  uvX: number;
  uvY: number;
  age: number;
  duration: number;
  maxRadiusNorm: number;
  peakIntensity: number;
}

export interface TrenchScoreEntry {
  id: string;
  callsign: string;
  score: number;
  distance: number;
  maxMach: number;
  grazes: number;
  date: string;
  isArchiveFallback: boolean;
}

export interface TrenchLastSubmittedRun {
  docId?: string;
  callsign: string;
  score: number;
  distance: number;
  maxMach: number;
  grazes: number;
  rank: number;
}
