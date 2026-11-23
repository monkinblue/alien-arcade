import type { Vec2 } from '../../types';

export const FLAK_CONSTANTS = {
  VIRTUAL_W: 1920,
  VIRTUAL_H: 1080,
  HORIZON_Y: 978,
  DANGER_CLOSE_Y: 672,
  MIRV_SPLIT_Y: 468,
  GRAVITY: 26, // Orbital gravity-well downward acceleration (virtual px/s^2)
  DOME_RADIUS: 46,
  BATTERY_Y: 972,

  // Left & Right M90 Proximity Flak Batteries (precision core + generous billiard shockwave ring!)
  FLAK_SHELL_SPEED: 1080,
  FLAK_MAG_MAX: 3,
  FLAK_RELOAD_SEC: 0.78,
  FLAK_FIRE_COOLDOWN: 0.14,
  FLAK_CORE_RADIUS: 28,
  FLAK_BLAST_RADIUS: 96,
  FLAK_IMPULSE_FORCE: 680,
  FLAK_BLAST_DURATION: 0.46,

  // Center Mk-IV EMP Shockwave Mortar Battery
  EMP_SHELL_SPEED: 640,
  EMP_FIRE_COOLDOWN: 0.44,
  EMP_CORE_RADIUS: 80,
  EMP_BLAST_RADIUS: 220,
  EMP_IMPULSE_FORCE: 950,
  EMP_BLAST_DURATION: 0.8,
  GAME_OVER_LOCKOUT_SEC: 1.0,
} as const;

export type FlakPhase = 'TITLE' | 'ACTIVE_WAVE' | 'WAVE_AUDIT' | 'GAME_OVER';

export type BatteryId = 'A' | 'S' | 'D';

export type ThreatKind = 'KINETIC_ROD' | 'HEAVY_METEOR' | 'MIRV_POD' | 'ION_JAMMER';

export interface ColonyDome {
  id: string;
  label: string;
  x: number;
  y: number;
  radius: number;
  intact: boolean;
  breachFlashTimer: number;
  restoreFlashTimer: number;
  savedFlashTimer: number;
}

export interface DefenseBattery {
  id: BatteryId;
  label: string;
  weaponType: 'M90_FLAK' | 'MK4_EMP';
  x: number;
  y: number;
  aimAngle: number;
  recoil: number;
  ammo: number;
  maxAmmo: number;
  reloadProgress: number; // 0..1 when cycling next shell
  reloadDuration: number;
  cooldownTimer: number;
  muzzleFlashTimer: number;
}

export interface OrbitalThreat {
  id: number;
  kind: ThreatKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Subtle lateral orbital drift / Coriolis acceleration (virtual px/s^2) */
  orbitalDriftAx: number;
  /** Gravity multiplier (kinetic rods & meteors accelerate slightly differently) */
  gravityScale: number;
  radius: number;
  mass: number;
  hp: number;
  maxHp: number;
  angle: number;
  angVel: number;
  /** Polygonal vertex offsets for Heavy Armored Meteors */
  polyRadii: number[];
  trail: Vec2[];
  hasSplit: boolean;
  empScrambled: boolean;
  jamRadius: number;
  /** Set when physically shoved by a flak/EMP shockwave for billiard deflection kills */
  deflectedTimer: number;
  deflectedByBlastId: number | null;
  deflectionSaveAwarded: boolean;
  wasTargetingDomeId: string | null;
  /** Cached live dotted ballistic prediction arc & impact coordinate */
  predictedArc: Vec2[];
  predictedImpactX: number;
  predictedImpactY: number;
  lockedDomeId: string | null;
  hitFlashTimer: number;
  age: number;
  isSubMunition?: boolean;
}

export interface InterceptorShell {
  id: number;
  batteryId: BatteryId;
  isEmp: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  speed: number;
  distRemaining: number;
  trail: Vec2[];
}

export interface ShockwaveBlast {
  id: number;
  x: number;
  y: number;
  isEmp: boolean;
  age: number;
  duration: number;
  currentRadius: number;
  coreRadius: number;
  maxRadius: number;
  impulseForce: number;
  hitThreatIds: Set<number>;
  killCount: number;
  deflectionCount: number;
  hadDangerCloseKill: boolean;
}

export interface ActiveCrtShockwave {
  x: number;
  y: number;
  age: number;
  duration: number;
  maxRadiusNorm: number;
  peakIntensity: number;
}

export interface FlakParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface ScorePopup {
  x: number;
  y: number;
  text: string;
  subText?: string;
  color: string;
  age: number;
  duration: number;
}

export interface OrbitalDropPod {
  x: number;
  y: number;
  targetDomeId: string;
  targetX: number;
  targetY: number;
  progress: number;
}

export interface OrbitalBossHardpoint {
  id: 'PORT' | 'CORE' | 'STBD';
  label: string;
  offsetX: number;
  offsetY: number;
  radius: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  hitFlashTimer: number;
}

export interface OrbitalBoss {
  id: number;
  tier: number; // 1 at Wave 5, 2 at Wave 10, 3 at Wave 15...
  designation: string; // e.g. "DERELICT DREADNOUGHT MK-I"
  x: number;
  y: number;
  targetY: number;
  vx: number;
  halfWidth: number;
  halfHeight: number;
  age: number;
  hp: number;
  maxHp: number;
  hardpoints: OrbitalBossHardpoint[];
  salvoCooldown: number;
  chargeTimer: number; // > 0 when telegraphing incoming salvo!
  chargeDuration: number;
  targetDomeIds: string[];
  empStunTimer: number;
  hitFlashTimer: number;
  dyingTimer: number; // > 0 during cascading death detonation before removal
  deathBlastStage: number;
}

export interface TelemetryLogEntry {
  timestamp: string;
  text: string;
  tone: 'green' | 'amber' | 'red' | 'bright';
}

export interface KillLogEntry {
  seq: number;
  timestamp: string;
  unitCode: string; // e.g. ROD-04, HVY-07, MIRV-11, JAM-16, SUB-19
  coordX: number; // Virtual X coordinate 0..1920
  altKm: number; // Altitude in km at time of intercept
  methodTag: string; // e.g. FLAK, EMP!, 3X-DC, DFL-x4, FLUNG
  tone: 'green' | 'amber' | 'bright';
}

export interface FlakLastSubmittedRun {
  docId?: string;
  callsign: string;
  score: number;
  wave: number;
  maxChain: number;
  accuracy: number;
  rank: number;
}

export interface WaveAuditState {
  completedWave: number;
  survivingDomes: number;
  unusedEmpRounds: number;
  domeBonusPerUnit: number;
  empBonusPerUnit: number;
  talliedDomes: number;
  talliedEmp: number;
  totalWaveBonus: number;
  dropPodRestoringDomeLabel: string | null;
  stepTimer: number;
  completeHoldTimer: number;
  done: boolean;
}

export interface FlakScoreEntry {
  id: string;
  callsign: string;
  score: number;
  wave: number;
  maxChain: number;
  accuracy: number;
  date: string;
  isArchiveFallback: boolean;
}
