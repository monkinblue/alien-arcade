import { CanyonTerrain } from './CanyonTerrain';
import {
  TRENCH_CONSTANTS,
  type AircraftBasis,
  type CannonRound,
  type CanyonTarget,
  type CmdsFlare,
  type EnemyFlakBurst,
  type EnemySamMissile,
  type MissileLockState,
  type RwrContact,
  type TacticalMissile,
  type TrenchCrtShockwave,
  type TrenchPhase,
  type TrenchPopup,
  type TrenchSpark,
  type Vec3,
  type WireframeExplosion,
} from './types';

export interface TrenchAudioCallbacks {
  onVulcanFiring(firing: boolean): void;
  onGunHitConfirm(pan: number): void;
  onBonusChime(isResupply: boolean): void;
  onMissileLaunch(side: -1 | 1): void;
  onCmdsVoice(): void;
  onCmdsPop(pan: number, beatIndex: number): void;
  onHullImpactThud(pan: number): void;
  onRwrSpikeChirp(urgent: boolean): void;
  onMuffledExplosion(pan: number, heavy: boolean): void;
  onTerrainSparkHit(pan: number): void;
  onPullUpWarning(): void;
  onSyncGlitch(intensity: number): void;
}

export interface F16FlightInput {
  stickRoll: number;
  stickPitch: number;
  throttleDelta: number;
  rudderInput: number;
  firingGun: boolean;
  launchMissilePressed: boolean;
  deployCmdsPressed: boolean;
}

export interface BallisticPipperSolution {
  mode: 'CCIP' | 'LCOS';
  worldPoint: Vec3;
  distM: number;
  hitTerrain: boolean;
  isResupplyCue?: boolean;
}

export interface IncomingSamTelemetry {
  id: number;
  /** Relative camera-space direction (cx right, cy up, cz forward) */
  camX: number;
  camY: number;
  camZ: number;
  /** Bearing angle in HUD screen-plane radians (0 = right, -PI/2 = up) */
  hudAngleRad: number;
  distM: number;
  ttiSec: number;
  inFront: boolean;
}

const PYLON_LAUNCH_ORDER = [0, 5, 1, 4, 2, 3] as const;

export class TrenchSimulation {
  public readonly terrain = new CanyonTerrain();

  public phase: TrenchPhase = 'TITLE';
  public paused = false;

  // Aircraft 3D World Position (meters: +X East, +Y Up, +Z North)
  public x = 0;
  public y = 110;
  public z = 0;

  // Aircraft 3D Velocity Vector (m/s)
  public vx = 0;
  public vy = 0;
  public vz = 250;

  // F-16 Orientation (radians) — FULL FLCS ATTITUDE HOLD (ZERO AUTO-LEVEL!)
  public yaw = 0;
  public pitch = 0;
  public roll = 0;
  public rollRateRadS = 0;
  public pitchRateRadS = 0;
  public yawRateRadS = 0;

  public basis: AircraftBasis = {
    forward: { x: 0, y: 0, z: 1 },
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
  };

  // Live Flight Telemetry & Persistent Throttle (0.0 IDLE .. 1.0 MIL .. 1.2 AFTERBURNER)
  public airspeedMps = 250;
  public kcas = 485;
  public mach = 0.74;
  public maxMach = 0.8;
  public throttle = 0.68;
  public afterburning = false;
  public gLoad = 1.0;
  public peakGLoad = 1.0;
  public aoaDeg = 1.4;
  public raltM = 95;
  public vviMps = 0;
  public pullUpWarning = false;
  public isStalling = false;
  public stallFactor = 0;
  public buffetIntensity = 0;
  public cameraFovDeg: number = TRENCH_CONSTANTS.BASE_FOV_DEG;

  public invertPitch = false;

  // 6km Sector Strike Progression Loop (`SEC-01`, `SEC-02`, `SEC-03`...)
  public sectorNumber = 1;
  public sectorId = 'SEC-01';
  public sectorStartZ = 0;
  public sectorEndZ: number = TRENCH_CONSTANTS.SECTOR_LENGTH_M;
  public sectorSamsTotal = 3;
  public sectorSamsRemaining = 3;
  public sectorBanditsTotal = 2;
  public sectorBanditsRemaining = 2;
  public sectorRadarCeilingM: number = TRENCH_CONSTANTS.RADAR_CEILING_RALT_M;
  public sectorsCleared = 0;

  // Advancing Atmospheric Purge Wave (Tail Pressure)
  public purgeWaveZ = -1400;
  public purgeMach = 0.62;
  public purgeDistanceM = 1400;
  public purgeThermalAlert = false;

  // Fair, Cinematic SAM Defense (3.5s RWR Lock Warning -> 4.5s Flight Time)
  public ceilingBreached = false;
  public samLockTimerMax = 0; // Highest active SAM tracking progress (0..3.5s)
  public samLockCountdownSec = 0; // Remaining seconds before SAM launch
  public samLockActive = false;
  public samIncomingActive = false;

  // Fixed-Forward M61A1 20mm Rotary Cannon
  public gunAmmo: number = TRENCH_CONSTANTS.GUN_MAX_AMMO;
  public gunCooldown = 0;
  public gunFiringNow = false;
  public gunMuzzleFlashTimer = 0;
  public hitConfirmTimer = 0;

  // Limited Tactical Missiles (6x AGM/AIM-9) — Snappy 0.35s Locks & Hostile Priority!
  public missileSlots: boolean[] = [true, true, true, true, true, true];
  public missilesRemaining: number = TRENCH_CONSTANTS.MISSILE_MAX_COUNT;
  public lockedTargetId: number | null = null;
  public lockState: MissileLockState = 'NONE';
  public lockProgress = 0;
  public lockedSlantRangeM = 0;
  public lockedTargetInSeeker = false;
  public weaponCueText: string | null = null;
  public weaponCueTimer = 0;

  // Chaff / Flare Countermeasure Dispenser System (CMDS)
  public cmdsRemaining: number = TRENCH_CONSTANTS.CMDS_MAX_COUNT;
  public cmdsCooldown = 0;
  public cmdsActiveTimer = 0;

  // Hull, Scoring, NOE Multiplier & Game Over Input Lockout
  public hull: number = TRENCH_CONSTANTS.HULL_MAX;
  public lastDeathCause = 'TERRAIN IMPACT';
  public score = 0;
  public noeActive = false;
  public noeStreakSec = 0;
  public noeMultiplier = 1.0;
  public distanceFlownM = 0;
  public targetsDestroyed = 0;
  public hitFlashTimer = 0;
  public screenShake = 0;
  public gameOverLockoutTimer = 0;

  // Live 3D World Entities
  public targets: CanyonTarget[] = [];
  public rounds: CannonRound[] = [];
  public missiles: TacticalMissile[] = [];
  public enemySams: EnemySamMissile[] = [];
  public flakBursts: EnemyFlakBurst[] = [];
  public flares: CmdsFlare[] = [];
  public sparks: TrenchSpark[] = [];
  public explosions: WireframeExplosion[] = [];
  public popups: TrenchPopup[] = [];
  public crtShockwaves: TrenchCrtShockwave[] = [];

  private audioCb: TrenchAudioCallbacks;
  private nextIdRef = { value: 1 };
  private spawnedSectorMax = 0;
  private scoreCarry = 0;
  private elapsedSec = 0;
  private milDetentHoldTimer = 0;
  private prevThrottleUp = false;
  private ceilingSamTimer = 0;
  private purgeDamageSoundTimer = 0;
  private terrainMaskBonusCooldown = 0;
  private cmdsBurstRemaining = 0;
  private cmdsBurstBeatTimer = 0;
  private cmdsBurstBeatIndex = 0;
  private cmdsBurstDecoyedTotal = 0;

  constructor(audioCb: TrenchAudioCallbacks) {
    this.audioCb = audioCb;
    this.resetToTitle();
  }

  public resetToTitle(): void {
    this.phase = 'TITLE';
    this.paused = false;
    this.z = 0;
    this.x = this.terrain.getCanyonCenterX(0);
    const groundY = this.terrain.sampleHeight(this.x, this.z);
    this.y = groundY + 115;
    this.yaw = this.terrain.getCanyonHeadingRad(0);
    this.pitch = 0.0;
    this.roll = 0;
    this.rollRateRadS = 0;
    this.pitchRateRadS = 0;
    this.yawRateRadS = 0;
    this.basis = this.computeBasis(this.yaw, this.pitch, this.roll);

    this.throttle = 0.68;
    this.afterburning = false;
    this.milDetentHoldTimer = 0;
    this.prevThrottleUp = false;

    this.airspeedMps = this.throttleToTargetSpeed(this.throttle);
    this.vx = this.basis.forward.x * this.airspeedMps;
    this.vy = this.basis.forward.y * this.airspeedMps;
    this.vz = this.basis.forward.z * this.airspeedMps;

    this.mach = this.airspeedMps / 340;
    this.maxMach = Math.round(this.mach * 10) / 10;
    this.kcas = Math.round(this.airspeedMps * 1.94384);
    this.gLoad = 1.0;
    this.peakGLoad = 1.0;
    this.aoaDeg = 1.4;
    this.raltM = Math.max(0, this.y - groundY);
    this.vviMps = 0;
    this.pullUpWarning = false;
    this.isStalling = false;
    this.stallFactor = 0;
    this.buffetIntensity = 0;
    this.cameraFovDeg = TRENCH_CONSTANTS.BASE_FOV_DEG;

    this.sectorNumber = 1;
    this.sectorId = 'SEC-01';
    this.sectorStartZ = 0;
    this.sectorEndZ = TRENCH_CONSTANTS.SECTOR_LENGTH_M;
    this.sectorsCleared = 0;
    this.applySectorDifficulty(1);

    this.purgeWaveZ = -1450;
    this.purgeDistanceM = 1450;
    this.purgeThermalAlert = false;
    this.purgeDamageSoundTimer = 0;

    this.ceilingBreached = false;
    this.ceilingSamTimer = 0;
    this.samLockTimerMax = 0;
    this.samLockCountdownSec = 0;
    this.samLockActive = false;
    this.samIncomingActive = false;

    this.gunAmmo = TRENCH_CONSTANTS.GUN_MAX_AMMO;
    this.gunCooldown = 0;
    this.gunFiringNow = false;
    this.gunMuzzleFlashTimer = 0;
    this.hitConfirmTimer = 0;
    this.audioCb.onVulcanFiring(false);

    this.missileSlots = [true, true, true, true, true, true];
    this.missilesRemaining = TRENCH_CONSTANTS.MISSILE_MAX_COUNT;
    this.lockedTargetId = null;
    this.lockState = 'NONE';
    this.lockProgress = 0;
    this.lockedSlantRangeM = 0;
    this.lockedTargetInSeeker = false;
    this.weaponCueText = null;
    this.weaponCueTimer = 0;

    this.cmdsRemaining = TRENCH_CONSTANTS.CMDS_MAX_COUNT;
    this.cmdsCooldown = 0;
    this.cmdsActiveTimer = 0;
    this.cmdsBurstRemaining = 0;
    this.cmdsBurstBeatTimer = 0;
    this.cmdsBurstBeatIndex = 0;
    this.cmdsBurstDecoyedTotal = 0;

    this.hull = TRENCH_CONSTANTS.HULL_MAX;
    this.lastDeathCause = 'TERRAIN IMPACT';
    this.score = 0;
    this.scoreCarry = 0;
    this.noeActive = false;
    this.noeStreakSec = 0;
    this.noeMultiplier = 1.0;
    this.terrainMaskBonusCooldown = 0;
    this.distanceFlownM = 0;
    this.targetsDestroyed = 0;
    this.hitFlashTimer = 0;
    this.screenShake = 0;
    this.gameOverLockoutTimer = 0;
    this.elapsedSec = 0;

    this.targets = [];
    this.rounds = [];
    this.missiles = [];
    this.enemySams = [];
    this.flakBursts = [];
    this.flares = [];
    this.sparks = [];
    this.explosions = [];
    this.popups = [];
    this.crtShockwaves = [];
    this.spawnedSectorMax = 0;

    this.spawnSectorIfNeeded(1, 0);
    this.refreshSectorObjectiveCounts();
  }

  public startNewFlight(): void {
    this.resetToTitle();
    this.phase = 'FLYING';
  }

  /**
   * Jumps cleanly to the start of any Sector (1..N) at safe cruise altitude & speed.
   */
  public jumpToSector(secNum: number): void {
    const targetSec = Math.max(1, Math.floor(secNum));
    this.startNewFlight();

    const startZ = (targetSec - 1) * TRENCH_CONSTANTS.SECTOR_LENGTH_M;
    this.sectorNumber = targetSec;
    this.sectorStartZ = startZ;
    this.sectorEndZ = startZ + TRENCH_CONSTANTS.SECTOR_LENGTH_M;
    this.sectorsCleared = Math.max(0, targetSec - 1);
    this.applySectorDifficulty(targetSec);

    this.z = startZ;
    this.x = this.terrain.getCanyonCenterX(startZ);
    const groundY = this.terrain.sampleHeight(this.x, this.z);
    const aheadX = this.terrain.getCanyonCenterX(startZ + 380);
    const aheadGroundY = this.terrain.sampleHeight(aheadX, startZ + 380);
    const maxSafeY = groundY + this.sectorRadarCeilingM - 22;
    const minSafeY = Math.max(groundY + 95, aheadGroundY + 52);
    this.y = Math.min(Math.max(minSafeY, groundY + 105), Math.max(minSafeY, maxSafeY));

    this.yaw = this.terrain.getCanyonHeadingRad(startZ);
    this.pitch = 0;
    this.roll = 0;
    this.rollRateRadS = 0;
    this.pitchRateRadS = 0;
    this.yawRateRadS = 0;
    this.basis = this.computeBasis(this.yaw, this.pitch, this.roll);

    this.throttle = 0.76;
    this.afterburning = false;
    this.airspeedMps = this.throttleToTargetSpeed(this.throttle);
    this.vx = this.basis.forward.x * this.airspeedMps;
    this.vy = this.basis.forward.y * this.airspeedMps;
    this.vz = this.basis.forward.z * this.airspeedMps;
    this.mach = this.airspeedMps / 340;
    this.kcas = Math.round(this.airspeedMps * 1.94384);
    this.raltM = Math.max(0, this.y - groundY);

    this.purgeWaveZ = startZ - 1450;
    this.purgeDistanceM = 1450;
    this.purgeThermalAlert = false;

    this.targets = [];
    this.rounds = [];
    this.missiles = [];
    this.enemySams = [];
    this.flakBursts = [];
    this.flares = [];
    this.spawnedSectorMax = targetSec - 1;
    this.spawnSectorIfNeeded(targetSec, startZ);
    this.refreshSectorObjectiveCounts();
  }

  /**
   * Finds the closest intact SAM_SITE structure within maxRangeM (strongly preferring sites
   * visible ahead of the aircraft so launches originate visibly off launcher rails).
   */
  private findNearestIntactSamSite(maxRangeM: number, requireReady = false): CanyonTarget | null {
    let bestSite: CanyonTarget | null = null;
    let bestScore = Infinity;

    for (const t of this.targets) {
      if (t.destroyed || t.kind !== 'SAM_SITE') continue;
      if (requireReady && (t.fireCooldown ?? 0) > 0) continue;
      const dist = Math.hypot(t.x - this.x, t.y - this.y, t.z - this.z);
      if (dist < 180 || dist > maxRangeM) continue;
      const isBehind = t.z < this.z - 220;
      const score = dist + (isBehind ? 1100 : 0);
      if (score < bestScore) {
        bestScore = score;
        bestSite = t;
      }
    }

    return bestSite;
  }

  /**
   * Immediately launches an authentic incoming SAM missile from the nearest intact SAM site
   * for RWR / CMDS / break-turn testing (never spawns phantom flank missiles).
   */
  public triggerSamLaunchNow(): { launched: boolean; samId: number | null; source: string } {
    if (this.phase !== 'FLYING') {
      return { launched: false, samId: null, source: 'NOT_FLYING' };
    }

    let bestSite = this.findNearestIntactSamSite(3800, false);
    if (!bestSite) {
      let fallbackDist = Infinity;
      for (const t of this.targets) {
        if (t.destroyed || t.kind !== 'SAM_SITE') continue;
        const d = Math.hypot(t.x - this.x, t.y - this.y, t.z - this.z);
        if (d < fallbackDist) {
          fallbackDist = d;
          bestSite = t;
        }
      }
    }

    if (bestSite) {
      bestSite.muzzleFlashTimer = 0.55;
      this.spawnEnemySamFrom(bestSite.x, bestSite.y + 18, bestSite.z, bestSite.id);
      this.samIncomingActive = true;
      const latest = this.enemySams[this.enemySams.length - 1];
      return { launched: true, samId: latest?.id ?? null, source: `SAM_SITE_${bestSite.id}` };
    }

    return { launched: false, samId: null, source: 'NO_INTACT_SAM_SITES' };
  }

  private applySectorDifficulty(secNum: number): void {
    this.sectorId = `SEC-${String(secNum).padStart(2, '0')}`;
    if (secNum === 1) {
      this.sectorRadarCeilingM = 190;
      this.purgeMach = 0.52;
    } else if (secNum === 2) {
      this.sectorRadarCeilingM = 165;
      this.purgeMach = 0.64;
    } else if (secNum === 3) {
      this.sectorRadarCeilingM = 148;
      this.purgeMach = 0.76;
    } else {
      this.sectorRadarCeilingM = 138;
      this.purgeMach = Math.min(0.96, 0.82 + (secNum - 4) * 0.05);
    }
  }

  private spawnSectorIfNeeded(secNum: number, startZ: number): void {
    if (secNum <= this.spawnedSectorMax) return;
    this.spawnedSectorMax = secNum;
    const created = this.terrain.createSectorTargets(secNum, startZ, this.nextIdRef);
    for (const t of created.targets) {
      this.targets.push(t);
    }
    if (secNum === this.sectorNumber) {
      this.sectorSamsTotal = created.samCount;
      this.sectorBanditsTotal = created.banditCount;
      this.sectorSamsRemaining = created.samCount;
      this.sectorBanditsRemaining = created.banditCount;
    }
  }

  private refreshSectorObjectiveCounts(): void {
    let samsRem = 0;
    let banditsRem = 0;
    for (const t of this.targets) {
      if (t.destroyed || t.sectorNumber !== this.sectorNumber) continue;
      if (t.kind === 'SAM_SITE') samsRem++;
      else if (t.kind === 'BANDIT_DRONE') banditsRem++;
    }
    this.sectorSamsRemaining = samsRem;
    this.sectorBanditsRemaining = banditsRem;
  }

  private advanceToNextSector(clearedAllObjectives: boolean): void {
    const prevId = this.sectorId;
    if (clearedAllObjectives) {
      this.sectorsCleared++;
      const bonus = 2000 + this.sectorNumber * 500;
      this.score += bonus;
      this.popups.push({
        text: `★ ${prevId} CLEAR // +${bonus.toLocaleString()} PTS ★`,
        subText: `ROLLING INTO SEC-${String(this.sectorNumber + 1).padStart(2, '0')} — ESCALATING THREATS`,
        nx: 0,
        ny: -0.22,
        color: '#44FF77',
        age: 0,
        duration: 2.8,
      });
    } else {
      this.popups.push({
        text: `ENTERING SEC-${String(this.sectorNumber + 1).padStart(2, '0')}`,
        subText: `RADAR CEIL ${this.sectorNumber === 1 ? 165 : this.sectorNumber === 2 ? 148 : 138}M // PURGE ACCELERATING`,
        nx: 0,
        ny: -0.22,
        color: '#FFB000',
        age: 0,
        duration: 2.3,
      });
    }

    this.sectorNumber++;
    this.sectorStartZ = Math.max(this.sectorEndZ, this.z + 650);
    this.sectorEndZ = this.sectorStartZ + TRENCH_CONSTANTS.SECTOR_LENGTH_M;
    this.applySectorDifficulty(this.sectorNumber);
    this.spawnSectorIfNeeded(this.sectorNumber, this.sectorStartZ);

    // Recalculate totals for the newly active sector cleanly
    let sCount = 0;
    let bCount = 0;
    for (const t of this.targets) {
      if (t.sectorNumber === this.sectorNumber) {
        if (t.kind === 'SAM_SITE') sCount++;
        else if (t.kind === 'BANDIT_DRONE') bCount++;
      }
    }
    this.sectorSamsTotal = Math.max(1, sCount);
    this.sectorBanditsTotal = Math.max(1, bCount);
    this.refreshSectorObjectiveCounts();
  }

  private throttleToTargetSpeed(th: number): number {
    if (th <= 1.0) {
      return (
        TRENCH_CONSTANTS.IDLE_SPEED_MPS +
        Math.max(0, th) * (TRENCH_CONSTANTS.MIL_SPEED_MPS - TRENCH_CONSTANTS.IDLE_SPEED_MPS)
      );
    }
    const abFrac = Math.min(1, (th - 1.0) / (TRENCH_CONSTANTS.MAX_THROTTLE - 1.0));
    return (
      TRENCH_CONSTANTS.MIL_SPEED_MPS +
      abFrac * (TRENCH_CONSTANTS.BURNER_SPEED_MPS - TRENCH_CONSTANTS.MIL_SPEED_MPS)
    );
  }

  public computeBasis(yaw: number, pitch: number, roll: number): AircraftBasis {
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const sp = Math.sin(pitch);
    const cp = Math.cos(pitch);
    const sr = Math.sin(roll);
    const cr = Math.cos(roll);

    const fwd0x = sy;
    const fwd0z = cy;
    const right0x = cy;
    const right0z = -sy;

    const forward: Vec3 = {
      x: fwd0x * cp,
      y: sp,
      z: fwd0z * cp,
    };
    const up0: Vec3 = {
      x: -fwd0x * sp,
      y: cp,
      z: -fwd0z * sp,
    };

    const right: Vec3 = {
      x: right0x * cr - up0.x * sr,
      y: -up0.y * sr,
      z: right0z * cr - up0.z * sr,
    };
    const up: Vec3 = {
      x: up0.x * cr + right0x * sr,
      y: up0.y * cr,
      z: up0.z * cr + right0z * sr,
    };

    return { forward, right, up };
  }

  public getFlightPathMarkerCameraDir(): { cx: number; cy: number; cz: number } {
    const speed = Math.max(1, Math.hypot(this.vx, this.vy, this.vz));
    const ux = this.vx / speed;
    const uy = this.vy / speed;
    const uz = this.vz / speed;
    const { right, up, forward } = this.basis;
    return {
      cx: ux * right.x + uy * right.y + uz * right.z,
      cy: ux * up.x + uy * up.y + uz * up.z,
      cz: Math.max(0.15, ux * forward.x + uy * forward.y + uz * forward.z),
    };
  }

  public getCompassHeadingDeg(): number {
    const deg = ((this.yaw * 180) / Math.PI) % 360;
    return deg < 0 ? deg + 360 : deg;
  }

  public getCanyonWaypointHeadingDeg(): number {
    const lookZ = this.z + 650;
    const targetX = this.terrain.getCanyonCenterX(lookZ);
    const rad = Math.atan2(targetX - this.x, lookZ - this.z);
    const deg = ((rad * 180) / Math.PI) % 360;
    return deg < 0 ? deg + 360 : deg;
  }

  public getLockedTarget(): CanyonTarget | null {
    if (this.lockedTargetId === null) return null;
    const found = this.targets.find((t) => t.id === this.lockedTargetId && !t.destroyed);
    return found ?? null;
  }

  /**
   * Builds live F-16 ALR-56M RWR Scope contacts oriented relative to aircraft nose!
   * - `M`: Incoming active SAM missile (flashing lethal inner ring)
   * - `S`: Hostile SAM sites & ceiling radar exposure
   * - `B`: Airborne Bandit Drones within 3,200m
   */
  public getRwrContacts(): RwrContact[] {
    const contacts: RwrContact[] = [];
    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);

    const worldToRelBearing = (wx: number, wz: number): { bearingRad: number; distM: number } => {
      const dx = wx - this.x;
      const dz = wz - this.z;
      const rx = dx * cosY - dz * sinY;
      const rz = dx * sinY + dz * cosY;
      return {
        bearingRad: Math.atan2(rx, rz),
        distM: Math.hypot(dx, dz),
      };
    };

    // 1. Incoming Enemy SAM Missiles -> Flashing `M` in inner lethal ring!
    for (const sam of this.enemySams) {
      if (sam.decoyedByFlareId !== null) continue;
      const rel = worldToRelBearing(sam.x, sam.z);
      contacts.push({
        id: `sam-${sam.id}`,
        symbol: 'M',
        bearingRad: rel.bearingRad,
        rangeNorm: Math.max(0.22, Math.min(0.64, (rel.distM / 2200) * 0.64)),
        lethal: true,
        flashing: true,
      });
    }

    // 2. Hostile SAM Sites & Airborne Bandits within 3,800m
    //    (Ceiling breach radar spikes also map directly to the real tracking SAM_SITE!)
    const ceilingTrackingSite =
      this.ceilingBreached && this.ceilingSamTimer > 0.15
        ? this.findNearestIntactSamSite(3800, false)
        : null;

    for (const t of this.targets) {
      if (t.destroyed || t.kind === 'RESUPPLY_CACHE') continue;
      const rel = worldToRelBearing(t.x, t.z);
      const maxScopeM = t.kind === 'SAM_SITE' ? 3800 : 3400;
      if (rel.distM > maxScopeM) continue;
      const locking = (t.samLockTimer ?? 0) > 0.15 || t.id === ceilingTrackingSite?.id;
      contacts.push({
        id: `tgt-${t.id}`,
        symbol: t.kind === 'SAM_SITE' ? 'S' : 'B',
        bearingRad: rel.bearingRad,
        rangeNorm: Math.max(0.28, Math.min(0.88, rel.distM / 3900)),
        lethal: locking || (t.kind === 'SAM_SITE' && rel.distM < 1600),
        flashing: locking,
      });
    }

    return contacts;
  }

  /**
   * Returns 3D camera-space direction & TTI of the closest live non-decoyed incoming SAM
   * for the HUD directional break-turn warning chevron.
   */
  public getPrimaryIncomingSamTelemetry(): IncomingSamTelemetry | null {
    let best: EnemySamMissile | null = null;
    let bestDist = Infinity;
    for (const s of this.enemySams) {
      if (s.decoyedByFlareId !== null) continue;
      const d = Math.hypot(s.x - this.x, s.y - this.y, s.z - this.z);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    if (!best) return null;

    const rx = best.x - this.x;
    const ry = best.y - this.y;
    const rz = best.z - this.z;
    const { right, up, forward } = this.basis;
    const camX = rx * right.x + ry * right.y + rz * right.z;
    const camY = rx * up.x + ry * up.y + rz * up.z;
    const camZ = rx * forward.x + ry * forward.y + rz * forward.z;
    const hudAngleRad = Math.atan2(-camY, camX);

    const invD = 1 / Math.max(1, bestDist);
    const closing = Math.max(
      120,
      ((this.vx - best.vx) * rx + (this.vy - best.vy) * ry + (this.vz - best.vz) * rz) * invD
    );
    return {
      id: best.id,
      camX,
      camY,
      camZ,
      hudAngleRad,
      distM: bestDist,
      ttiSec: Math.max(0.1, bestDist / closing),
      inFront: camZ > 0,
    };
  }

  /**
   * Cycles manually across ALL forward targets (including RESUPPLY_CACHE when the pilot wants one!)
   */
  public cycleTarget(): boolean {
    if (this.phase !== 'FLYING' || this.paused) return false;
    const candidates = this.findForwardTargets(36, TRENCH_CONSTANTS.MISSILE_MAX_LOCK_RANGE_M + 400, true);
    if (candidates.length === 0) {
      this.lockedTargetId = null;
      this.lockState = 'NONE';
      this.lockProgress = 0;
      return false;
    }

    candidates.sort((a, b) => a.target.id - b.target.id);
    const curIdx = candidates.findIndex((c) => c.target.id === this.lockedTargetId);
    const next = candidates[(curIdx + 1) % candidates.length];
    this.lockedTargetId = next.target.id;
    this.lockProgress = 0;
    this.lockedSlantRangeM = next.distM;
    this.lockedTargetInSeeker = next.angleDeg <= TRENCH_CONSTANTS.MISSILE_SEEKER_HALF_ANGLE_DEG;
    this.lockState = 'TRACKING';
    return true;
  }

  public computeBallisticPipper(): BallisticPipperSolution {
    const g = TRENCH_CONSTANTS.GUN_GRAVITY_MPS2;
    const muzzle = TRENCH_CONSTANTS.GUN_MUZZLE_SPEED_MPS;
    const v0x = this.vx + this.basis.forward.x * muzzle;
    const v0y = this.vy + this.basis.forward.y * muzzle;
    const v0z = this.vz + this.basis.forward.z * muzzle;

    // Prefer locked target; if a Cyan Resupply Pod is right on the gun bore (<=14°, <=1,250m), provide an LCOS cue for it!
    let pipperTarget: CanyonTarget | null = this.getLockedTarget();
    let isResupplyCue = pipperTarget?.kind === 'RESUPPLY_CACHE';

    const nearPods = this.findForwardTargets(14, 1250, true).filter(
      (c) => c.target.kind === 'RESUPPLY_CACHE'
    );
    if (nearPods.length > 0) {
      nearPods.sort((a, b) => a.angleDeg - b.angleDeg);
      const pod = nearPods[0];
      if (!pipperTarget || pod.distM < this.lockedSlantRangeM * 0.85 || pod.angleDeg < 8) {
        pipperTarget = pod.target;
        isResupplyCue = true;
      }
    }

    if (pipperTarget) {
      const dx0 = pipperTarget.x - this.x;
      const dy0 = pipperTarget.y - this.y;
      const dz0 = pipperTarget.z - this.z;
      const d0 = Math.hypot(dx0, dy0, dz0);
      if (d0 >= 30 && d0 <= TRENCH_CONSTANTS.MISSILE_MAX_LOCK_RANGE_M) {
        const tvx = pipperTarget.vx ?? 0;
        const tvy = pipperTarget.vy ?? 0;
        const tvz = pipperTarget.vz ?? 0;

        // True relative closing speed along line-of-sight (fixes high-speed Mach 1.0+ over-drop/over-lead!)
        const relVx = v0x - tvx;
        const relVy = v0y - tvy;
        const relVz = v0z - tvz;
        const closing0 = Math.max(
          muzzle * 0.65,
          (relVx * dx0 + relVy * dy0 + relVz * dz0) / d0
        );
        let tof = Math.min(2.1, d0 / closing0);
        for (let iter = 0; iter < 2; iter++) {
          const fx = pipperTarget.x + tvx * tof - this.x;
          const fy = pipperTarget.y + tvy * tof - this.y + 0.5 * g * tof * tof;
          const fz = pipperTarget.z + tvz * tof - this.z;
          const fd = Math.max(30, Math.hypot(fx, fy, fz));
          const closingI = Math.max(
            muzzle * 0.65,
            (relVx * fx + relVy * fy + relVz * fz) / fd
          );
          tof = Math.min(2.1, fd / closingI);
        }

        const pipX = this.x + relVx * tof;
        const pipY = this.y + relVy * tof - 0.5 * g * tof * tof;
        const pipZ = this.z + relVz * tof;

        return {
          mode: 'LCOS',
          worldPoint: { x: pipX, y: pipY, z: pipZ },
          distM: d0,
          hitTerrain: false,
          isResupplyCue,
        };
      }
    }

    // CCIP terrain impact raymarch out to 2.0s (~2,200m!)
    const stepT = 0.04;
    const maxT = 2.0;
    let prevT = 0;
    for (let t = stepT; t <= maxT; t += stepT) {
      const px = this.x + v0x * t;
      const py = this.y + v0y * t - 0.5 * g * t * t;
      const pz = this.z + v0z * t;
      const groundH = this.terrain.sampleHeight(px, pz);
      if (py <= groundH + 0.5) {
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 5; k++) {
          const mid = (lo + hi) * 0.5;
          const mx = this.x + v0x * mid;
          const my = this.y + v0y * mid - 0.5 * g * mid * mid;
          const mz = this.z + v0z * mid;
          if (my <= this.terrain.sampleHeight(mx, mz) + 0.5) hi = mid;
          else lo = mid;
        }
        const hitX = this.x + v0x * hi;
        const hitY = this.y + v0y * hi - 0.5 * g * hi * hi;
        const hitZ = this.z + v0z * hi;
        return {
          mode: 'CCIP',
          worldPoint: { x: hitX, y: hitY, z: hitZ },
          distM: Math.hypot(hitX - this.x, hitY - this.y, hitZ - this.z),
          hitTerrain: true,
        };
      }
      prevT = t;
    }

    const defaultT = 0.72;
    const px = this.x + v0x * defaultT;
    const py = this.y + v0y * defaultT - 0.5 * g * defaultT * defaultT;
    const pz = this.z + v0z * defaultT;
    return {
      mode: 'CCIP',
      worldPoint: { x: px, y: py, z: pz },
      distM: Math.hypot(px - this.x, py - this.y, pz - this.z),
      hitTerrain: false,
    };
  }

  public step(rawDt: number, input: F16FlightInput): void {
    const dt = Math.max(0, Math.min(0.05, rawDt));
    if (this.paused) {
      if (this.gunFiringNow) {
        this.gunFiringNow = false;
        this.audioCb.onVulcanFiring(false);
      }
      return;
    }
    this.elapsedSec += dt;

    if (this.gameOverLockoutTimer > 0) {
      this.gameOverLockoutTimer = Math.max(0, this.gameOverLockoutTimer - dt);
    }

    // Scenic alpine valley autopilot flyover on Launch Title Screen
    if (this.phase === 'TITLE') {
      this.z += 195 * dt;
      const targetX = this.terrain.getCanyonCenterX(this.z);
      const nextX = this.terrain.getCanyonCenterX(this.z + 180);
      this.x += (targetX - this.x) * Math.min(1, dt * 2.4);
      const groundY = this.terrain.sampleHeight(this.x, this.z);
      this.y += (groundY + 115 - this.y) * Math.min(1, dt * 2.4);
      const desiredYaw = Math.atan2(nextX - this.x, 180);
      const yawDiff = this.wrapAngle(desiredYaw - this.yaw);
      this.yaw += yawDiff * Math.min(1, dt * 2.2);
      this.roll = Math.max(-0.45, Math.min(0.45, yawDiff * 1.3));
      this.pitch = -0.03;
      this.rollRateRadS = 0;
      this.basis = this.computeBasis(this.yaw, this.pitch, this.roll);
      this.vx = this.basis.forward.x * 195;
      this.vy = this.basis.forward.y * 195;
      this.vz = this.basis.forward.z * 195;
      this.raltM = Math.max(0, this.y - groundY);
      if (this.z > this.sectorEndZ - 3400) {
        this.spawnSectorIfNeeded(this.spawnedSectorMax + 1, this.spawnedSectorMax * TRENCH_CONSTANTS.SECTOR_LENGTH_M);
      }
      this.stepTargets(dt);
      return;
    }

    if (this.phase === 'GAME_OVER') {
      if (this.gunFiringNow) {
        this.gunFiringNow = false;
        this.audioCb.onVulcanFiring(false);
      }
      this.samIncomingActive = false;
      this.samLockActive = false;
      this.stepEffects(dt);
      if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
      if (this.screenShake > 0) this.screenShake = Math.max(0, this.screenShake - dt * 22);
      return;
    }

    // =========================================================================
    // ACTIVE F-16 FLY-BY-WIRE (FLCS) FLIGHT PHYSICS + OPEN-VALLEY STRIKE LOOP
    // =========================================================================
    if (this.hitFlashTimer > 0) this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
    if (this.hitConfirmTimer > 0) this.hitConfirmTimer = Math.max(0, this.hitConfirmTimer - dt);
    if (this.gunCooldown > 0) this.gunCooldown = Math.max(0, this.gunCooldown - dt);
    if (this.cmdsCooldown > 0) this.cmdsCooldown = Math.max(0, this.cmdsCooldown - dt);
    if (this.cmdsActiveTimer > 0) this.cmdsActiveTimer = Math.max(0, this.cmdsActiveTimer - dt);
    if (this.purgeDamageSoundTimer > 0) {
      this.purgeDamageSoundTimer = Math.max(0, this.purgeDamageSoundTimer - dt);
    }
    if (this.terrainMaskBonusCooldown > 0) {
      this.terrainMaskBonusCooldown = Math.max(0, this.terrainMaskBonusCooldown - dt);
    }
    if (this.gunMuzzleFlashTimer > 0) {
      this.gunMuzzleFlashTimer = Math.max(0, this.gunMuzzleFlashTimer - dt);
    }
    if (this.weaponCueTimer > 0) {
      this.weaponCueTimer = Math.max(0, this.weaponCueTimer - dt);
      if (this.weaponCueTimer <= 0) this.weaponCueText = null;
    }
    if (this.screenShake > 0) this.screenShake = Math.max(0, this.screenShake - dt * 24);

    // 1. Persistent Throttle Control (W / S: 0% IDLE -> 100% MIL detent -> 120% AFTERBURNER)
    const slewRate = 0.56;
    if (input.throttleDelta > 0) {
      if (this.throttle < 1.0) {
        const next = this.throttle + slewRate * dt;
        if (next >= 1.0) {
          this.throttle = 1.0;
          this.milDetentHoldTimer = 0.18;
        } else {
          this.throttle = next;
        }
      } else if (this.throttle === 1.0 && this.milDetentHoldTimer > 0 && this.prevThrottleUp) {
        this.milDetentHoldTimer = Math.max(0, this.milDetentHoldTimer - dt);
      } else {
        this.throttle = Math.min(
          TRENCH_CONSTANTS.MAX_THROTTLE,
          this.throttle + slewRate * 0.85 * dt
        );
      }
      this.prevThrottleUp = true;
    } else if (input.throttleDelta < 0) {
      this.milDetentHoldTimer = 0;
      this.prevThrottleUp = false;
      this.throttle = Math.max(0, this.throttle - slewRate * 1.05 * dt);
    } else {
      this.milDetentHoldTimer = 0;
      this.prevThrottleUp = false;
    }

    this.afterburning = this.throttle > 1.005;
    const targetSpeed = this.throttleToTargetSpeed(this.throttle);

    // Energy management (steep climbs bleed speed; high-G turns induce drag)
    const gDrag = Math.max(0, this.gLoad - 2.5) * 4.2 * dt;
    const energyDelta = -Math.sin(this.pitch) * 74 * dt - gDrag;
    this.airspeedMps +=
      (targetSpeed - this.airspeedMps) * (1 - Math.exp(-dt * 2.0)) + energyDelta;
    this.airspeedMps = Math.max(
      TRENCH_CONSTANTS.IDLE_SPEED_MPS * 0.82,
      Math.min(TRENCH_CONSTANTS.BURNER_SPEED_MPS * 1.05, this.airspeedMps)
    );

    this.mach = this.airspeedMps / 340;
    if (this.mach > this.maxMach) {
      this.maxMach = Math.round(this.mach * 10) / 10;
    }
    this.kcas = Math.round(this.airspeedMps * 1.94384);

    // 2. Aerodynamic Stall Physics (< 180 KCAS)
    this.isStalling = this.kcas < TRENCH_CONSTANTS.STALL_SPEED_KCAS;
    this.stallFactor = this.isStalling
      ? Math.max(0, Math.min(1, (TRENCH_CONSTANTS.STALL_SPEED_KCAS - this.kcas) / 58))
      : 0;
    const controlAuthority = 1 - this.stallFactor * 0.64;

    const abFrac = Math.max(0, (this.throttle - 1.0) / 0.2);
    const targetFov =
      TRENCH_CONSTANTS.BASE_FOV_DEG +
      Math.max(0, this.mach - 0.82) * 3.8 +
      abFrac * (TRENCH_CONSTANTS.AFTERBURNER_FOV_DEG - TRENCH_CONSTANTS.BASE_FOV_DEG - 2.5);
    this.cameraFovDeg += (targetFov - this.cameraFovDeg) * (1 - Math.exp(-dt * 5.2));

    // 3. Pointer-Lock Virtual Flight Stick — TRUE F-16 FLCS ATTITUDE HOLD (ZERO AUTO-LEVEL!)
    const desiredRollRate = input.stickRoll * 2.85 * controlAuthority;
    if (Math.abs(input.stickRoll) < 1e-4) {
      this.rollRateRadS *= Math.exp(-dt * 24);
      if (Math.abs(this.rollRateRadS) < 0.004) this.rollRateRadS = 0;
    } else {
      this.rollRateRadS += (desiredRollRate - this.rollRateRadS) * (1 - Math.exp(-dt * 18));
    }
    this.roll = this.wrapAngle(this.roll + this.rollRateRadS * dt);

    const stickPull = this.invertPitch ? -input.stickPitch : input.stickPitch;
    const maxPitchRad = (TRENCH_CONSTANTS.MAX_PITCH_DEG * Math.PI) / 180;

    const desiredPitchRate = stickPull * 1.54 * Math.cos(this.roll) * controlAuthority;
    if (Math.abs(stickPull) < 1e-4) {
      this.pitchRateRadS *= Math.exp(-dt * 24);
      if (Math.abs(this.pitchRateRadS) < 0.004) this.pitchRateRadS = 0;
    } else {
      this.pitchRateRadS += (desiredPitchRate - this.pitchRateRadS) * (1 - Math.exp(-dt * 16));
    }

    const stallNoseDropRate = this.stallFactor > 0 ? -this.stallFactor * 0.64 : 0;

    // Sweeping 6G-capable bank-to-turn coupling + A/D rudder yaw!
    const turnFromPull = stickPull * 1.72 * Math.sin(this.roll) * controlAuthority;
    const turnFromBank = Math.sin(this.roll) * 0.56;
    const turnFromRudder = input.rudderInput * 0.72 * (0.55 + 0.45 * controlAuthority);
    this.yawRateRadS = turnFromPull + turnFromBank + turnFromRudder;

    this.pitch = Math.max(
      -maxPitchRad,
      Math.min(maxPitchRad, this.pitch + (this.pitchRateRadS + stallNoseDropRate) * dt)
    );
    this.yaw = this.wrapAngle(this.yaw + this.yawRateRadS * dt);

    this.basis = this.computeBasis(this.yaw, this.pitch, this.roll);

    // 4. Aerodynamic Velocity Integration -> FPM, AoA, G-Load & Stall Lift Loss
    const prevVx = this.vx;
    const prevVy = this.vy;
    const prevVz = this.vz;

    const desiredVx = this.basis.forward.x * this.airspeedMps;
    const desiredVy = this.basis.forward.y * this.airspeedMps;
    const desiredVz = this.basis.forward.z * this.airspeedMps;

    const liftRate = 4.8 * (1 - this.stallFactor * 0.68);
    const liftLerp = 1 - Math.exp(-dt * liftRate);
    this.vx += (desiredVx - this.vx) * liftLerp;
    this.vy += (desiredVy - this.vy) * liftLerp;
    this.vz += (desiredVz - this.vz) * liftLerp;

    const sinR = Math.sin(this.roll);
    const bankDrop = sinR * sinR * 2.6 * (stickPull <= 0 ? 1 : 0.2);
    const stallGravitySink = this.stallFactor * 28.0;
    this.vy -= (bankDrop + stallGravitySink) * dt;

    const dx = this.vx * dt;
    const dy = this.vy * dt;
    const dz = this.vz * dt;
    this.x += dx;
    this.y += dy;
    this.z += dz;

    if (this.y > 760) {
      this.y = 760;
      if (this.vy > 0) this.vy *= 0.5;
      if (this.pitch > 0) this.pitch *= 0.85;
    }

    const groundY = this.terrain.sampleHeight(this.x, this.z);
    this.raltM = Math.max(0, this.y - groundY);
    this.vviMps = this.vy;

    // Nap-Of-The-Earth (NOE < 60M RALT at >=260 KCAS) risk/reward score multiplier (1.0x -> 2.5x)!
    if (this.raltM <= TRENCH_CONSTANTS.NOE_ALTITUDE_RALT_M && this.kcas >= 260) {
      this.noeActive = true;
      this.noeStreakSec = Math.min(12, this.noeStreakSec + dt);
      const rawMult = 1.5 + Math.min(1.0, (this.noeStreakSec / 7.5) * 1.0);
      this.noeMultiplier = Math.round(rawMult * 10) / 10;
    } else {
      this.noeActive = false;
      const decayRate = this.raltM > 85 ? 2.4 : 0.85;
      this.noeStreakSec = Math.max(0, this.noeStreakSec - dt * decayRate);
      this.noeMultiplier =
        this.noeStreakSec > 0.4
          ? Math.round((1.0 + Math.min(1.5, (this.noeStreakSec / 8.0) * 1.5)) * 10) / 10
          : 1.0;
    }

    const stepDist = Math.hypot(dx, dy, dz);
    this.distanceFlownM += stepDist;
    this.scoreCarry += stepDist * (this.afterburning ? 0.34 : 0.2) * this.noeMultiplier;
    if (this.scoreCarry >= 1) {
      const add = Math.floor(this.scoreCarry);
      this.score += add;
      this.scoreCarry -= add;
    }

    // Live G-Load, Peak G & Angle of Attack
    const ax = (this.vx - prevVx) / Math.max(0.001, dt);
    const ay = (this.vy - prevVy) / Math.max(0.001, dt);
    const az = (this.vz - prevVz) / Math.max(0.001, dt);
    const normalAccel =
      ax * this.basis.up.x + (ay + 9.81) * this.basis.up.y + az * this.basis.up.z;
    const rawG = Math.max(-1.5, Math.min(9.5, normalAccel / 9.81));
    this.gLoad += (rawG - this.gLoad) * (1 - Math.exp(-dt * 7.5));
    if (this.gLoad > this.peakGLoad) {
      this.peakGLoad = this.gLoad;
    }

    const fpmCam = this.getFlightPathMarkerCameraDir();
    const rawAoa = Math.atan2(-fpmCam.cy, fpmCam.cz) * (180 / Math.PI) + this.stallFactor * 8.5;
    this.aoaDeg += (Math.max(-12, Math.min(28, rawAoa)) - this.aoaDeg) * (1 - Math.exp(-dt * 9));

    const gBuffet = Math.max(0, Math.min(1, (this.gLoad - 5.4) / 3.0));
    this.buffetIntensity = Math.max(this.stallFactor, gBuffet);

    const lowDescending = this.raltM < 44 && this.vy < -7;
    const ultraLow = this.raltM < 19;
    this.pullUpWarning = lowDescending || ultraLow;
    if (this.pullUpWarning) {
      this.audioCb.onPullUpWarning();
    }

    // 5. Terrain & Valley-Arch Instant Airframe Collision
    const hitGround = this.y <= groundY + TRENCH_CONSTANTS.COCKPIT_CLEARANCE_M;
    const hitArch = this.terrain.checkArchCollision(this.x, this.y, this.z, 4.0);
    if (hitGround || hitArch) {
      this.triggerAirframeLoss(hitArch ? 'VALLEY ARCH IMPACT' : 'TERRAIN IMPACT');
      return;
    }

    // 6. Advancing Atmospheric Purge Wave (Tail Pressure)
    const purgeSpeedMps = this.purgeMach * 340;
    this.purgeWaveZ += purgeSpeedMps * dt;
    this.purgeWaveZ = Math.max(this.purgeWaveZ, this.z - 2200);
    this.purgeDistanceM = Math.max(0, this.z - this.purgeWaveZ);
    this.purgeThermalAlert = this.purgeDistanceM < 340;

    if (this.z <= this.purgeWaveZ + 28) {
      this.screenShake = Math.max(this.screenShake, 5.5);
      this.hitFlashTimer = Math.max(this.hitFlashTimer, 0.2);
      if (this.purgeDamageSoundTimer <= 0) {
        this.purgeDamageSoundTimer = 0.48;
        this.audioCb.onHullImpactThud(0);
      }
      this.hull = Math.max(0, this.hull - 40 * dt);
      if (this.hull <= 0) {
        this.triggerAirframeLoss('PURGE WAVE ENGULFMENT');
        return;
      }
    }

    // 7. CMDS Chaff / Flare Deployment ([C] / [F]) + Rhythmic 4-Beat Dispenser Cadence
    if (input.deployCmdsPressed) {
      this.tryDeployCmds();
    }
    this.stepCmdsDispenser(dt);

    // 8. Dynamic Sector Radar Ceiling & Fair 3.5-Second SAM Lock Warning
    //    (100% authentic: launches strictly from real intact SAM_SITE towers — zero phantom spawns!)
    this.ceilingBreached = this.raltM > this.sectorRadarCeilingM;
    const ceilingSite = this.ceilingBreached ? this.findNearestIntactSamSite(3800, true) : null;
    if (this.cmdsActiveTimer > 0) {
      // Active chaff cloud suppresses ceiling radar lock acquisition!
      this.ceilingSamTimer = Math.max(0, this.ceilingSamTimer - dt * 3.5);
    } else if (this.ceilingBreached && ceilingSite) {
      this.ceilingSamTimer += dt;
      if (this.ceilingSamTimer >= TRENCH_CONSTANTS.SAM_LOCK_WARNING_SEC) {
        ceilingSite.samLockTimer = 0;
        ceilingSite.samWasLocking = false;
        ceilingSite.fireCooldown = Math.max(4.4, 6.4 - this.sectorNumber * 0.45);
        ceilingSite.muzzleFlashTimer = 0.55;
        this.spawnEnemySamFrom(ceilingSite.x, ceilingSite.y + 18, ceilingSite.z, ceilingSite.id);
        this.ceilingSamTimer = 0;
      }
    } else {
      this.ceilingSamTimer = Math.max(0, this.ceilingSamTimer - dt * 2.2);
    }

    // 9. Pre-spawn upcoming sector when approaching within 3,600m of sector end
    if (this.z > this.sectorEndZ - 3600) {
      this.spawnSectorIfNeeded(this.sectorNumber + 1, this.sectorEndZ);
    }

    // 10. Step Targets, Seeker (0.35s lock!), Guns, Missiles, Flares & Threats
    this.stepTargets(dt);
    this.stepMissileSeeker(dt);

    // Track highest active SAM lock countdown for crisp fair 3.5s RWR/HUD countdown
    let maxSamLock = this.ceilingBreached && ceilingSite ? this.ceilingSamTimer : 0;
    for (const t of this.targets) {
      if (!t.destroyed && t.kind === 'SAM_SITE' && (t.samLockTimer ?? 0) > maxSamLock) {
        maxSamLock = t.samLockTimer ?? 0;
      }
    }
    this.samLockTimerMax = maxSamLock;
    this.samLockActive = maxSamLock > 0.12;
    this.samLockCountdownSec = Math.max(0, TRENCH_CONSTANTS.SAM_LOCK_WARNING_SEC - maxSamLock);
    if (this.samLockActive) {
      this.audioCb.onRwrSpikeChirp(this.samLockCountdownSec < 1.6);
    }

    // Fixed-Forward M61A1 20mm Rotary Cannon ("BRRRT")
    const canFireGun = input.firingGun && this.gunAmmo > 0;
    if (canFireGun !== this.gunFiringNow) {
      this.gunFiringNow = canFireGun;
      this.audioCb.onVulcanFiring(canFireGun);
    }
    if (input.firingGun && this.gunAmmo <= 0 && this.weaponCueTimer <= 0) {
      this.weaponCueText = 'GUN WINCHESTER // HIT CYAN RESUPPLY CACHE';
      this.weaponCueTimer = 0.9;
    }
    if (canFireGun && this.gunCooldown <= 0) {
      this.fireVulcanRound();
    }

    if (input.launchMissilePressed) {
      this.tryLaunchMissile();
    }

    this.stepCannonRounds(dt);
    this.stepMissiles(dt);
    this.stepCmdsFlares(dt);
    this.stepEnemySams(dt);
    this.stepEnemyFlakBursts(dt);
    this.stepEffects(dt);

    this.samIncomingActive = this.enemySams.some((s) => s.decoyedByFlareId === null);

    // 11. Sector Objective Completion Check -> Seamless Roll into Next Sector!
    this.refreshSectorObjectiveCounts();
    if (this.sectorSamsRemaining === 0 && this.sectorBanditsRemaining === 0) {
      this.advanceToNextSector(true);
    } else if (this.z > this.sectorEndZ + 550) {
      this.advanceToNextSector(false);
    }
  }

  private spawnEnemySamFrom(sx: number, sy: number, sz: number, sourceSiteId?: number): void {
    const dx = this.x - sx;
    const dy = this.y - sy;
    const dz = this.z - sz;
    const len = Math.max(1, Math.hypot(dx, dy, dz));
    const initSpeed = 320;
    const maxSpeed = Math.min(620, 505 + (this.sectorNumber - 1) * 32);

    this.enemySams.push({
      id: this.nextIdRef.value++,
      sourceSiteId,
      x: sx,
      y: sy,
      z: sz,
      vx: (dx / len) * initSpeed,
      vy: Math.max(0.32, dy / len) * initSpeed, // Crisp upward booster launch arc off the SAM rails!
      vz: (dz / len) * initSpeed,
      speed: initSpeed,
      maxSpeed,
      age: 0,
      maxAge: TRENCH_CONSTANTS.SAM_FLIGHT_TIME_SEC, // Cinematic 4.5-second flight time!
      decoyedByFlareId: null,
      trail: [{ x: sx, y: sy, z: sz }],
    });

    // Vivid booster ignition bloom + sparks right at the SAM site launcher rails
    this.explosions.push({
      x: sx,
      y: sy,
      z: sz,
      age: 0,
      duration: 0.42,
      maxRadius: 26,
      color: '#FFB000',
    });
    this.spawnSparks(sx, sy, sz, '#FFF6CC', 16);
    this.spawnSparks(sx, sy, sz, '#FF5522', 12);

    this.weaponCueText = '⚠ SAM LAUNCHED // POP CMDS [C/F] + HARD 7G BREAK ⚠';
    this.weaponCueTimer = 1.85;
  }

  private tryDeployCmds(): void {
    if (this.cmdsCooldown > 0) return;
    if (this.cmdsRemaining <= 0) {
      this.weaponCueText = 'CMDS DEPLETED // HIT CYAN RESUPPLY CACHE';
      this.weaponCueTimer = 0.9;
      return;
    }

    this.cmdsRemaining--;
    this.cmdsCooldown = TRENCH_CONSTANTS.CMDS_COOLDOWN_SEC;
    this.cmdsActiveTimer = TRENCH_CONSTANTS.CMDS_ACTIVE_PROTECTION_SEC;
    this.cmdsBurstRemaining = TRENCH_CONSTANTS.CMDS_SALVO_BEATS;
    this.cmdsBurstBeatTimer = 0;
    this.cmdsBurstBeatIndex = 0;
    this.cmdsBurstDecoyedTotal = 0;

    // Immediately break ALL active SAM radar locks across sites & ceiling!
    this.ceilingSamTimer = 0;
    for (const t of this.targets) {
      if (t.kind === 'SAM_SITE') {
        t.samLockTimer = 0;
        t.samWasLocking = false;
      }
    }

    // Authentic fighter-jet VCS cockpit voice callout: "Chaff, flare."
    this.audioCb.onCmdsVoice();

    // Immediately fire Beat #1 of the 4-beat rhythmic salvo (t = 0.00s, 0.23s, 0.46s, 0.69s)
    this.ejectCmdsSalvoBeat();
  }

  private stepCmdsDispenser(dt: number): void {
    if (this.cmdsBurstRemaining <= 0) return;
    this.cmdsBurstBeatTimer -= dt;
    while (this.cmdsBurstRemaining > 0 && this.cmdsBurstBeatTimer <= 0) {
      this.ejectCmdsSalvoBeat();
    }
  }

  private ejectCmdsSalvoBeat(): void {
    const beatIdx = this.cmdsBurstBeatIndex;
    const primarySide: -1 | 1 = beatIdx % 2 === 0 ? -1 : 1;
    this.cmdsBurstBeatIndex++;
    this.cmdsBurstRemaining--;
    this.cmdsBurstBeatTimer += TRENCH_CONSTANTS.CMDS_BEAT_INTERVAL_SEC;

    // Rhythmic muffled cockpit cartridge thud synced 1:1 with physical flare+chaff ejection!
    this.audioCb.onCmdsPop(primarySide * 0.24, beatIdx);
    this.screenShake = Math.max(this.screenShake, 1.8);

    // Eject 2 blazing IR decoy flares (left & right pods) + 1 shimmering radar-chaff bundle per beat
    const beatSpecs: Array<{ side: -1 | 1; isChaff: boolean }> = [
      { side: primarySide, isChaff: false },
      { side: primarySide === 1 ? -1 : 1, isChaff: false },
      { side: primarySide, isChaff: true },
    ];

    for (const spec of beatSpecs) {
      const spreadSide = spec.side * (24 + Math.random() * 32);
      const spreadDown = -(14 + Math.random() * 18);
      const ejectBack = -(48 + Math.random() * 38);

      const sx =
        this.x +
        this.basis.right.x * (spec.side * 2.4) -
        this.basis.up.x * 1.4 -
        this.basis.forward.x * 3.4;
      const sy =
        this.y +
        this.basis.right.y * (spec.side * 2.4) -
        this.basis.up.y * 1.4 -
        this.basis.forward.y * 3.4;
      const sz =
        this.z +
        this.basis.right.z * (spec.side * 2.4) -
        this.basis.up.z * 1.4 -
        this.basis.forward.z * 3.4;

      const flare: CmdsFlare = {
        id: this.nextIdRef.value++,
        x: sx,
        y: sy,
        z: sz,
        vx:
          this.vx * 0.7 +
          this.basis.right.x * spreadSide +
          this.basis.up.x * spreadDown +
          this.basis.forward.x * ejectBack,
        vy:
          this.vy * 0.7 +
          this.basis.right.y * spreadSide +
          this.basis.up.y * spreadDown +
          this.basis.forward.y * ejectBack,
        vz:
          this.vz * 0.7 +
          this.basis.right.z * spreadSide +
          this.basis.up.z * spreadDown +
          this.basis.forward.z * ejectBack,
        age: 0,
        maxAge: spec.isChaff ? 2.6 : 3.6,
        isChaff: spec.isChaff,
        trail: [{ x: sx, y: sy, z: sz }],
      };
      this.flares.push(flare);
    }

    const newlyDecoyed = this.decoyIncomingSamsWithinRange();
    if (beatIdx === 0 && newlyDecoyed === 0 && this.cmdsBurstDecoyedTotal === 0) {
      this.weaponCueText = `CHAFF, FLARE // SAFE ${TRENCH_CONSTANTS.CMDS_ACTIVE_PROTECTION_SEC.toFixed(1)}S (${this.cmdsRemaining} REM)`;
      this.weaponCueTimer = 1.6;
    }
  }

  private decoyIncomingSamsWithinRange(): number {
    const activeFlares = this.flares.filter((f) => !f.isChaff && f.age < f.maxAge - 0.15);
    if (activeFlares.length === 0) return 0;

    let newlyDecoyed = 0;
    for (let i = 0; i < this.enemySams.length; i++) {
      const sam = this.enemySams[i];
      if (sam.decoyedByFlareId !== null) continue;
      const dist = Math.hypot(sam.x - this.x, sam.y - this.y, sam.z - this.z);
      if (dist <= TRENCH_CONSTANTS.CMDS_DECOY_RANGE_M) {
        const targetFlare = activeFlares[activeFlares.length - 1 - (newlyDecoyed % activeFlares.length)];
        sam.decoyedByFlareId = targetFlare.id;
        newlyDecoyed++;
        this.cmdsBurstDecoyedTotal++;
      }
    }

    if (newlyDecoyed > 0) {
      this.score += newlyDecoyed * 250;
      const total = Math.max(newlyDecoyed, this.cmdsBurstDecoyedTotal);
      this.weaponCueText = `CMDS DECOYED ${total} SAM${total > 1 ? 'S' : ''} // SAFE ${this.cmdsActiveTimer.toFixed(1)}S`;
      this.weaponCueTimer = Math.max(this.weaponCueTimer, 1.55);
    }
    return newlyDecoyed;
  }

  private fireVulcanRound(): void {
    this.gunCooldown = 0.028;
    this.gunAmmo = Math.max(0, this.gunAmmo - 1);
    this.gunMuzzleFlashTimer = 0.055;
    this.screenShake = Math.max(this.screenShake, 1.6);

    const spreadRight = (Math.random() - 0.5) * 0.0038;
    const spreadUp = (Math.random() - 0.5) * 0.0038;
    const dx =
      this.basis.forward.x + this.basis.right.x * spreadRight + this.basis.up.x * spreadUp;
    const dy =
      this.basis.forward.y + this.basis.right.y * spreadRight + this.basis.up.y * spreadUp;
    const dz =
      this.basis.forward.z + this.basis.right.z * spreadRight + this.basis.up.z * spreadUp;
    const len = Math.max(0.0001, Math.hypot(dx, dy, dz));
    const ux = dx / len;
    const uy = dy / len;
    const uz = dz / len;

    const sx =
      this.x -
      this.basis.right.x * 1.15 -
      this.basis.up.x * 0.85 +
      this.basis.forward.x * 5.2;
    const sy =
      this.y -
      this.basis.right.y * 1.15 -
      this.basis.up.y * 0.85 +
      this.basis.forward.y * 5.2;
    const sz =
      this.z -
      this.basis.right.z * 1.15 -
      this.basis.up.z * 0.85 +
      this.basis.forward.z * 5.2;

    const muzzle = TRENCH_CONSTANTS.GUN_MUZZLE_SPEED_MPS;
    this.rounds.push({
      id: this.nextIdRef.value++,
      x: sx,
      y: sy,
      z: sz,
      vx: this.vx + ux * muzzle,
      vy: this.vy + uy * muzzle,
      vz: this.vz + uz * muzzle,
      age: 0,
      maxAge: 2.15,
    });
  }

  private findForwardTargets(
    maxHalfAngleDeg: number,
    maxRangeM: number,
    includeResupply: boolean
  ): Array<{ target: CanyonTarget; distM: number; angleDeg: number }> {
    const minDot = Math.cos((maxHalfAngleDeg * Math.PI) / 180);
    const results: Array<{ target: CanyonTarget; distM: number; angleDeg: number }> = [];
    for (const t of this.targets) {
      if (t.destroyed) continue;
      if (!includeResupply && t.kind === 'RESUPPLY_CACHE') continue;
      const rx = t.x - this.x;
      const ry = t.y - this.y;
      const rz = t.z - this.z;
      const distM = Math.hypot(rx, ry, rz);
      if (distM < 45 || distM > maxRangeM) continue;
      const dot =
        (rx * this.basis.forward.x + ry * this.basis.forward.y + rz * this.basis.forward.z) / distM;
      if (dot < minDot) continue;
      const angleDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
      results.push({ target: t, distM, angleDeg });
    }
    return results;
  }

  /**
   * Snappy 0.35s Missile Seeker:
   * - Widened 22° HUD acquisition circle & 2,800m range
   * - Auto-acquires hostile SAM_SITE and BANDIT_DRONE ONLY (NEVER auto-locks RESUPPLY_CACHE unless cycled via TAB!)
   */
  private stepMissileSeeker(dt: number): void {
    const seekerDeg = TRENCH_CONSTANTS.MISSILE_SEEKER_HALF_ANGLE_DEG;
    const maxRange = TRENCH_CONSTANTS.MISSILE_MAX_LOCK_RANGE_M;

    let current: { target: CanyonTarget; distM: number; angleDeg: number } | null = null;
    if (this.lockedTargetId !== null) {
      const t = this.targets.find((item) => item.id === this.lockedTargetId && !item.destroyed);
      if (t) {
        const rx = t.x - this.x;
        const ry = t.y - this.y;
        const rz = t.z - this.z;
        const distM = Math.hypot(rx, ry, rz);
        const dot =
          distM > 1
            ? (rx * this.basis.forward.x + ry * this.basis.forward.y + rz * this.basis.forward.z) /
              distM
            : 0;
        const angleDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
        if (distM >= 40 && distM <= maxRange + 400 && angleDeg <= 34) {
          current = { target: t, distM, angleDeg };
        }
      }
    }

    // Auto-acquire nearest hostile SAM or Bandit inside forward seeker cone (NEVER auto-locks RESUPPLY_CACHE!).
    // Also snap automatically onto a hostile inside the 22° seeker cone if our current hostile drifted outside it!
    if (
      !current ||
      (current.angleDeg > seekerDeg && current.target.kind !== 'RESUPPLY_CACHE')
    ) {
      const searchDeg = current ? seekerDeg : 30;
      const candidates = this.findForwardTargets(searchDeg, maxRange, false);
      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          const aIn = a.angleDeg <= seekerDeg ? 0 : 1;
          const bIn = b.angleDeg <= seekerDeg ? 0 : 1;
          if (aIn !== bIn) return aIn - bIn;
          return a.angleDeg + a.distM * 0.005 - (b.angleDeg + b.distM * 0.005);
        });
        const best = candidates[0];
        if (!current || best.target.id !== current.target.id) {
          current = best;
          this.lockedTargetId = current.target.id;
          this.lockProgress = 0;
        }
      } else if (!current) {
        this.lockedTargetId = null;
        this.lockState = 'NONE';
        this.lockProgress = 0;
        this.lockedSlantRangeM = 0;
        this.lockedTargetInSeeker = false;
        return;
      }
    }

    this.lockedSlantRangeM = current.distM;
    const inSeeker = current.angleDeg <= seekerDeg && current.distM <= maxRange;
    this.lockedTargetInSeeker = inSeeker;

    if (inSeeker && this.missilesRemaining > 0) {
      this.lockProgress = Math.min(
        1,
        this.lockProgress + dt / TRENCH_CONSTANTS.MISSILE_LOCK_TIME_SEC
      );
      this.lockState = this.lockProgress >= 1 ? 'LOCKED' : 'TRACKING';
    } else {
      this.lockProgress = Math.max(0, this.lockProgress - dt * 1.9);
      this.lockState = 'TRACKING';
    }
  }

  private tryLaunchMissile(): void {
    if (this.missilesRemaining <= 0) {
      this.weaponCueText = 'NO MISSILES REMAINING // HIT CYAN RESUPPLY CACHE';
      this.weaponCueTimer = 0.9;
      return;
    }

    const lockedTarget = this.getLockedTarget();
    if (this.lockState !== 'LOCKED' || !lockedTarget) {
      this.weaponCueText = lockedTarget ? 'HOLD TARGET INSIDE SEEKER CIRCLE' : 'NO RADAR / IR LOCK';
      this.weaponCueTimer = 0.85;
      return;
    }

    const slotIdx = PYLON_LAUNCH_ORDER.find((idx) => this.missileSlots[idx]);
    if (slotIdx === undefined) return;

    this.missileSlots[slotIdx] = false;
    this.missilesRemaining = this.missileSlots.filter(Boolean).length;

    const side: -1 | 1 = slotIdx < 3 ? -1 : 1;
    const pylonRank = slotIdx < 3 ? 2 - slotIdx : slotIdx - 3;
    const lateralOffset = side * (2.5 + pylonRank * 1.15);

    const sx =
      this.x +
      this.basis.right.x * lateralOffset -
      this.basis.up.x * 1.45 +
      this.basis.forward.x * 4.5;
    const sy =
      this.y +
      this.basis.right.y * lateralOffset -
      this.basis.up.y * 1.45 +
      this.basis.forward.y * 4.5;
    const sz =
      this.z +
      this.basis.right.z * lateralOffset -
      this.basis.up.z * 1.45 +
      this.basis.forward.z * 4.5;

    const initSpeed = Math.max(460, this.airspeedMps + 145);
    this.missiles.push({
      id: this.nextIdRef.value++,
      x: sx,
      y: sy,
      z: sz,
      vx: this.basis.forward.x * initSpeed,
      vy: this.basis.forward.y * initSpeed - 3.5,
      vz: this.basis.forward.z * initSpeed,
      speed: initSpeed,
      targetId: lockedTarget.id,
      age: 0,
      maxAge: 5.2,
      trail: [{ x: sx, y: sy, z: sz }],
    });

    this.audioCb.onMissileLaunch(side);
    this.screenShake = Math.max(this.screenShake, 3.6);
    this.weaponCueText = `FOX-2 // AIM-9 LAUNCHED (${this.missilesRemaining} REM)`;
    this.weaponCueTimer = 0.9;
    this.lockProgress = 0.1;
    this.lockState = 'TRACKING';
  }

  private stepTargets(dt: number): void {
    const pruneMinZ = this.z - 1200;
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      if (t.hitFlashTimer > 0) t.hitFlashTimer = Math.max(0, t.hitFlashTimer - dt);
      if (t.muzzleFlashTimer && t.muzzleFlashTimer > 0) {
        t.muzzleFlashTimer = Math.max(0, t.muzzleFlashTimer - dt);
      }
      if (t.destroyed || t.z < pruneMinZ) {
        if (this.lockedTargetId === t.id) {
          this.lockedTargetId = null;
          this.lockState = 'NONE';
          this.lockProgress = 0;
        }
        this.targets.splice(i, 1);
        continue;
      }

      if (t.kind === 'BANDIT_DRONE') {
        const prevX = t.x;
        const prevY = t.y;
        const prevZ = t.z;

        // Cruise & weave down the wide alpine valley ahead of the pilot!
        const cruise = t.cruiseSpeedMps ?? 105;
        const secLimitZ = t.sectorNumber * TRENCH_CONSTANTS.SECTOR_LENGTH_M - 300;
        // Slow gently near the end of its sector so player always catches up for a clean dogfight!
        const effectiveCruise = t.z > secLimitZ ? cruise * 0.25 : cruise;
        t.z += effectiveCruise * dt;
        t.bobPhase += dt * (0.85 + this.sectorNumber * 0.18);

        const valleyCenterX = this.terrain.getCanyonCenterX(t.z);
        t.x = valleyCenterX + Math.sin(t.bobPhase) * t.patrolAmp;
        const groundH = this.terrain.sampleHeight(t.x, t.z);
        const desiredY = Math.max(groundH + 75, t.baseY + Math.cos(t.bobPhase * 1.25) * 32);
        t.y += (desiredY - t.y) * Math.min(1, dt * 2.5);

        if (dt > 0.0005) {
          t.vx = (t.x - prevX) / dt;
          t.vy = (t.y - prevY) / dt;
          t.vz = (t.z - prevZ) / dt;
        }

        // Record glowing amber phosphor contrails!
        if (!t.trail) t.trail = [];
        const last = t.trail[t.trail.length - 1];
        if (!last || Math.hypot(t.x - last.x, t.y - last.y, t.z - last.z) > 14) {
          t.trail.push({ x: t.x, y: t.y, z: t.z });
          if (t.trail.length > 34) t.trail.shift();
        }
      } else {
        t.vx = 0;
        t.vy = 0;
        t.vz = 0;
      }

      // Generous 55m Fly-Through Pickup for Cyan Resupply Pods (shoot OR fly right through!)
      if (t.kind === 'RESUPPLY_CACHE' && this.phase === 'FLYING') {
        const dPod = Math.hypot(t.x - this.x, t.y - this.y, t.z - this.z);
        if (dPod <= TRENCH_CONSTANTS.RESUPPLY_FLYTHROUGH_RADIUS_M) {
          this.destroyTarget(t, false, true);
          continue;
        }
      }

      // Fair, Cinematic SAM Site Tracking (3.5s warning + true 3D mesa/ridge LOS terrain masking!)
      if (t.kind === 'SAM_SITE' && this.phase === 'FLYING') {
        if ((t.fireCooldown ?? 0) > 0) {
          t.fireCooldown = Math.max(0, (t.fireCooldown ?? 0) - dt);
        }

        const dist = Math.hypot(t.x - this.x, t.y - this.y, t.z - this.z);
        const inRange = dist >= 220 && dist <= TRENCH_CONSTANTS.SAM_ENGAGE_RANGE_M;
        const exposedAltitude = this.raltM > this.sectorRadarCeilingM || dist < 1750;

        if (this.cmdsActiveTimer > 0) {
          // Active CMDS chaff cloud jams SAM site radar tracking for the full protection window!
          t.samLockTimer = Math.max(0, (t.samLockTimer ?? 0) - dt * 3.5);
          t.samWasLocking = false;
        } else if (inRange && exposedAltitude && (t.fireCooldown ?? 0) <= 0) {
          const los = this.terrain.hasLineOfSight(
            { x: t.x, y: t.y + 12, z: t.z },
            { x: this.x, y: this.y, z: this.z }
          );
          if (los) {
            t.samLockTimer = (t.samLockTimer ?? 0) + dt;
            if (t.samLockTimer >= 1.1) {
              t.samWasLocking = true;
            }
            if (t.samLockTimer >= TRENCH_CONSTANTS.SAM_LOCK_WARNING_SEC) {
              t.samLockTimer = 0;
              t.samWasLocking = false;
              t.fireCooldown = Math.max(4.4, 6.4 - this.sectorNumber * 0.45);
              t.muzzleFlashTimer = 0.55;
              this.ceilingSamTimer = Math.max(0, this.ceilingSamTimer - 1.5);
              this.spawnEnemySamFrom(t.x, t.y + 18, t.z, t.id);
            }
          } else {
            // Ducking behind a central mesa or ridge breaks SAM radar lock cleanly!
            t.samLockTimer = Math.max(0, (t.samLockTimer ?? 0) - dt * 2.6);
            if (t.samWasLocking && t.samLockTimer <= 0.25) {
              t.samWasLocking = false;
              if (this.terrainMaskBonusCooldown <= 0) {
                this.terrainMaskBonusCooldown = 3.5;
                const bonus = Math.round(300 * this.noeMultiplier);
                this.score += bonus;
                this.audioCb.onBonusChime(false);
                this.weaponCueText = `TERRAIN MASKED! SAM LOCK BROKEN // +${bonus} PTS`;
                this.weaponCueTimer = 1.6;
                this.popups.push({
                  text: `TERRAIN MASKED! +${bonus}`,
                  subText: 'SAM RADAR LOCK BROKEN BEHIND MESA',
                  nx: 0,
                  ny: -0.2,
                  color: '#44FF77',
                  age: 0,
                  duration: 1.6,
                });
              }
            }
          }
        } else {
          t.samLockTimer = Math.max(0, (t.samLockTimer ?? 0) - dt * 2.0);
          if (t.samLockTimer <= 0.1) t.samWasLocking = false;
        }

        // Anti-slow-play AAA flak warning if crawling slowly (< 320 KCAS) within 1,100m of a live SAM site
        if (dist < 1100 && dist > 180 && this.kcas < 325 && Math.random() < dt * 0.65) {
          t.muzzleFlashTimer = 0.22;
          this.fireAaaFlakAtPlayer(dist);
        }
      }
    }
  }

  private fireAaaFlakAtPlayer(distM: number): void {
    const fuseTime = Math.max(0.45, Math.min(1.05, distM / 560));
    const speedEscape = Math.max(0, Math.min(1, (this.kcas - 280) / 160));
    const leadAccuracy = 1.0 - speedEscape * 0.45;
    const scatterR = 8 + speedEscape * 38;

    const theta = Math.random() * Math.PI * 2;
    const phi = (Math.random() - 0.5) * Math.PI * 0.6;
    const bx = this.x + this.vx * fuseTime * leadAccuracy + Math.cos(theta) * Math.cos(phi) * scatterR;
    const by = Math.max(
      this.terrain.sampleHeight(this.x + this.vx * fuseTime * 0.8, this.z + this.vz * fuseTime * 0.8) + 14,
      this.y + this.vy * fuseTime * leadAccuracy + Math.sin(phi) * scatterR
    );
    const bz = this.z + this.vz * fuseTime * leadAccuracy + Math.sin(theta) * Math.cos(phi) * scatterR;

    this.flakBursts.push({
      id: this.nextIdRef.value++,
      x: bx,
      y: by,
      z: bz,
      age: 0,
      fuseTime,
      duration: 0.72,
      radius: 26,
      detonated: false,
      hitPlayer: false,
    });
  }

  private destroyTarget(t: CanyonTarget, viaMissile: boolean, viaFlyThrough = false): void {
    t.destroyed = true;
    this.targetsDestroyed++;
    const basePts =
      t.kind === 'BANDIT_DRONE' ? 850 : t.kind === 'SAM_SITE' ? 750 : 450;
    const rawPts = viaMissile ? basePts + 200 : viaFlyThrough ? basePts + 150 : basePts;
    const pts = Math.round(rawPts * this.noeMultiplier);
    this.score += pts;

    if (this.lockedTargetId === t.id) {
      this.lockedTargetId = null;
      this.lockState = 'NONE';
      this.lockProgress = 0;
    }

    const relX = t.x - this.x;
    const relY = t.y - this.y;
    const relZ = t.z - this.z;
    const camX =
      relX * this.basis.right.x + relY * this.basis.right.y + relZ * this.basis.right.z;
    const camZ = Math.max(
      10,
      relX * this.basis.forward.x + relY * this.basis.forward.y + relZ * this.basis.forward.z
    );
    const pan = Math.max(-0.85, Math.min(0.85, camX / (camZ * 0.7)));

    const isCache = t.kind === 'RESUPPLY_CACHE';
    if (isCache) {
      this.audioCb.onBonusChime(true);
    }
    if (!viaFlyThrough) {
      this.audioCb.onMuffledExplosion(pan, viaMissile || isCache || t.kind === 'SAM_SITE');
    }
    this.explosions.push({
      x: t.x,
      y: t.y,
      z: t.z,
      age: 0,
      duration: viaMissile || isCache ? 0.96 : 0.78,
      maxRadius: t.radius * (viaMissile || isCache ? 4.8 : 3.6),
      color: isCache ? '#00F0FF' : t.kind === 'SAM_SITE' ? '#FF3322' : '#FFB000',
    });
    this.spawnSparks(t.x, t.y, t.z, isCache ? '#00F0FF' : '#FFF6CC', viaMissile ? 36 : 24);
    this.spawnSparks(t.x, t.y, t.z, t.kind === 'SAM_SITE' ? '#FF3322' : '#FFB000', 18);
    this.pushCrtShockwave(
      0.5 + pan * 0.25,
      0.44,
      viaMissile || isCache ? 0.34 : 0.24,
      viaMissile || isCache ? 0.6 : 0.44,
      viaMissile || isCache ? 0.56 : 0.44
    );

    // Electric Cyan Resupply Cache Bonus (+2 MISSILES, +150 GUN RDS, +2 CMDS FLARES)!
    if (isCache) {
      let addedMsl = 0;
      for (const idx of PYLON_LAUNCH_ORDER) {
        if (!this.missileSlots[idx] && addedMsl < 2) {
          this.missileSlots[idx] = true;
          addedMsl++;
        }
      }
      this.missilesRemaining = this.missileSlots.filter(Boolean).length;
      this.gunAmmo = Math.min(TRENCH_CONSTANTS.GUN_MAX_AMMO, this.gunAmmo + 150);
      this.cmdsRemaining = Math.min(TRENCH_CONSTANTS.CMDS_MAX_COUNT, this.cmdsRemaining + 2);

      this.weaponCueText = viaFlyThrough
        ? 'FLY-THRU RESUPPLY // +2 MSL +150 GUN +2 CMDS'
        : 'RESUPPLY // +2 MSL +150 GUN RDS +2 CMDS';
      this.weaponCueTimer = 2.0;
      this.popups.push({
        text: viaFlyThrough ? 'FLY-THRU RESUPPLY // +2 MSL' : 'RESUPPLY // +2 MSL +2 CMDS',
        subText: `+150 20MM RDS · +2 CMDS · +${pts} PTS`,
        nx: 0,
        ny: -0.15,
        color: '#00F0FF',
        age: 0,
        duration: 1.9,
      });
      return;
    }

    const label = t.kind === 'SAM_SITE' ? 'SAM SITE' : 'BANDIT';
    const multTag = this.noeMultiplier > 1.05 ? ` (${this.noeMultiplier.toFixed(1)}X NOE)` : '';
    this.popups.push({
      text: viaMissile ? `SPLASH // ${label} +${pts}${multTag}` : `GUNS! ${label} +${pts}${multTag}`,
      nx: Math.max(-0.32, Math.min(0.32, pan * 0.35)),
      ny: -0.14,
      color: t.kind === 'SAM_SITE' ? '#FF5533' : '#FFB000',
      age: 0,
      duration: 1.45,
    });
  }

  private applyHullDamage(amount: number, cause: string, pan = 0): void {
    this.hull = Math.max(0, this.hull - amount);
    this.hitFlashTimer = Math.max(this.hitFlashTimer, amount >= 40 ? 0.55 : 0.32);
    this.screenShake = Math.max(this.screenShake, amount >= 40 ? 14 : 7.5);
    this.audioCb.onHullImpactThud(pan);
    this.audioCb.onSyncGlitch(amount >= 40 ? 0.68 : 0.32);
    this.pushCrtShockwave(0.5 + pan * 0.25, 0.48, amount >= 40 ? 0.58 : 0.32, 0.55, 0.45);

    if (this.hull <= 0) {
      this.triggerAirframeLoss(cause);
    } else {
      this.popups.push({
        text: `${cause} // HULL ${Math.round(this.hull)}%`,
        nx: 0,
        ny: 0.14,
        color: '#FF3322',
        age: 0,
        duration: 1.4,
      });
    }
  }

  private stepCannonRounds(dt: number): void {
    const g = TRENCH_CONSTANTS.GUN_GRAVITY_MPS2;
    for (let i = this.rounds.length - 1; i >= 0; i--) {
      const r = this.rounds[i];
      r.age += dt;
      const prevX = r.x;
      const prevY = r.y;
      const prevZ = r.z;

      r.vy -= g * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;

      if (r.age >= r.maxAge) {
        this.rounds.splice(i, 1);
        continue;
      }

      let hit = false;
      for (const t of this.targets) {
        if (t.destroyed) continue;
        const hitRad =
          t.kind === 'BANDIT_DRONE' ? t.radius * 2.15 : t.radius * 1.85;
        if (
          this.segmentHitsSphere(
            prevX,
            prevY,
            prevZ,
            r.x,
            r.y,
            r.z,
            t.x,
            t.y,
            t.z,
            hitRad
          )
        ) {
          t.hp -= 1;
          t.hitFlashTimer = 0.14;
          this.hitConfirmTimer = 0.24;
          hit = true;
          const relX = t.x - this.x;
          const relY = t.y - this.y;
          const relZ = t.z - this.z;
          const camX =
            relX * this.basis.right.x + relY * this.basis.right.y + relZ * this.basis.right.z;
          const camZ = Math.max(
            10,
            relX * this.basis.forward.x + relY * this.basis.forward.y + relZ * this.basis.forward.z
          );
          const pan = Math.max(-0.85, Math.min(0.85, camX / (camZ * 0.7)));
          this.audioCb.onGunHitConfirm(pan);
          this.spawnSparks(t.x, t.y, t.z, t.kind === 'RESUPPLY_CACHE' ? '#00F0FF' : '#FFB000', 8);

          if (t.hp <= 0) {
            this.destroyTarget(t, false);
          }
          break;
        }
      }

      if (hit) {
        this.rounds.splice(i, 1);
        continue;
      }

      const h = this.terrain.sampleHeight(r.x, r.z);
      if (r.y <= h + 0.5) {
        this.spawnSparks(r.x, h + 1.5, r.z, '#FFB000', 6);
        const relX = r.x - this.x;
        const relY = r.y - this.y;
        const relZ = r.z - this.z;
        const camX =
          relX * this.basis.right.x + relY * this.basis.right.y + relZ * this.basis.right.z;
        const camZ = Math.max(
          10,
          relX * this.basis.forward.x + relY * this.basis.forward.y + relZ * this.basis.forward.z
        );
        const pan = Math.max(-0.85, Math.min(0.85, camX / (camZ * 0.7)));
        this.audioCb.onTerrainSparkHit(pan);
        this.rounds.splice(i, 1);
      }
    }
  }

  private stepMissiles(dt: number): void {
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.age += dt;
      if (m.age >= m.maxAge) {
        this.missiles.splice(i, 1);
        continue;
      }

      m.speed = Math.min(1140, m.speed + 620 * dt);
      const tgt =
        m.targetId !== null
          ? this.targets.find((item) => item.id === m.targetId && !item.destroyed) ?? null
          : null;

      const curSpeed = Math.max(1, Math.hypot(m.vx, m.vy, m.vz));
      let ux = m.vx / curSpeed;
      let uy = m.vy / curSpeed;
      let uz = m.vz / curSpeed;

      if (tgt && m.age > 0.06) {
        const dx = tgt.x - m.x;
        const dy = tgt.y - m.y;
        const dz = tgt.z - m.z;
        const dist = Math.max(1, Math.hypot(dx, dy, dz));
        const tgo = Math.min(1.4, dist / m.speed);

        const leadX = tgt.x + (tgt.vx ?? 0) * tgo - m.x;
        const leadY = tgt.y + (tgt.vy ?? 0) * tgo - m.y;
        const leadZ = tgt.z + (tgt.vz ?? 0) * tgo - m.z;
        const leadLen = Math.max(1, Math.hypot(leadX, leadY, leadZ));
        const tx = leadX / leadLen;
        const ty = leadY / leadLen;
        const tz = leadZ / leadLen;

        const steerLerp = Math.min(1, (m.age < 0.22 ? 4.5 : 8.2) * dt);
        const nx = ux + (tx - ux) * steerLerp;
        const ny = uy + (ty - uy) * steerLerp;
        const nz = uz + (tz - uz) * steerLerp;
        const nLen = Math.max(0.0001, Math.hypot(nx, ny, nz));
        ux = nx / nLen;
        uy = ny / nLen;
        uz = nz / nLen;
      }

      m.vx = ux * m.speed;
      m.vy = uy * m.speed;
      m.vz = uz * m.speed;

      const prevX = m.x;
      const prevY = m.y;
      const prevZ = m.z;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;

      m.trail.push({ x: m.x, y: m.y, z: m.z });
      if (m.trail.length > 32) m.trail.shift();

      let detonated = false;
      for (const t of this.targets) {
        if (t.destroyed) continue;
        const proxR = t.id === m.targetId ? t.radius * 2.2 + 9.0 : t.radius * 1.5;
        if (this.segmentHitsSphere(prevX, prevY, prevZ, m.x, m.y, m.z, t.x, t.y, t.z, proxR)) {
          this.hitConfirmTimer = 0.4;
          this.destroyTarget(t, true);
          detonated = true;
          break;
        }
      }

      if (detonated) {
        this.missiles.splice(i, 1);
        continue;
      }

      const h = this.terrain.sampleHeight(m.x, m.z);
      if (m.y <= h + 1.0) {
        this.explosions.push({
          x: m.x,
          y: h + 3,
          z: m.z,
          age: 0,
          duration: 0.78,
          maxRadius: 40,
          color: '#FFB000',
        });
        this.spawnSparks(m.x, h + 2.5, m.z, '#FFB000', 22);
        this.audioCb.onMuffledExplosion(0, false);
        this.missiles.splice(i, 1);
      }
    }
  }

  private stepCmdsFlares(dt: number): void {
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.age += dt;
      if (f.age >= f.maxAge) {
        this.flares.splice(i, 1);
        continue;
      }
      const drag = Math.exp(-dt * (f.isChaff ? 2.2 : 1.05));
      f.vx *= drag;
      f.vz *= drag;
      f.vy = f.vy * drag - 18 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;

      f.trail.push({ x: f.x, y: f.y, z: f.z });
      if (f.trail.length > 18) f.trail.shift();
    }
  }

  /**
   * Fair, Cinematic 4.5s Enemy SAM Flight & Evasion Physics:
   * - Visually spot glowing phosphor smoke trail curving across the valley
   * - Defeated cleanly by popping [C/F] CMDS flares, pulling a hard 7G+ break-turn, or masking behind a mesa!
   */
  private stepEnemySams(dt: number): void {
    // Continuous active CMDS protection window: decoy any SAM entering < 1,100m while flares/chaff are live!
    if (this.cmdsActiveTimer > 0 && this.enemySams.length > 0) {
      this.decoyIncomingSamsWithinRange();
    }

    for (let i = this.enemySams.length - 1; i >= 0; i--) {
      const s = this.enemySams[i];
      s.age += dt;
      if (s.age >= s.maxAge) {
        // Motor burn-out / self-destruct flash at end of 4.5s flight time!
        if (s.decoyedByFlareId === null && (s.evadedByHighG || s.evadedByMask)) {
          const bonus = Math.round((s.evadedByHighG ? 400 : 350) * this.noeMultiplier);
          this.score += bonus;
          this.audioCb.onBonusChime(false);
          this.popups.push({
            text: s.evadedByHighG
              ? `7G BREAK EVADED! +${bonus}`
              : `SAM TERRAIN-MASKED! +${bonus}`,
            subText: 'INCOMING SAM MOTOR EXHAUSTED',
            nx: 0,
            ny: -0.2,
            color: '#44FF77',
            age: 0,
            duration: 1.75,
          });
        }
        this.explosions.push({
          x: s.x,
          y: s.y,
          z: s.z,
          age: 0,
          duration: 0.55,
          maxRadius: 28,
          color: '#FFB000',
        });
        this.enemySams.splice(i, 1);
        continue;
      }

      s.speed = Math.min(s.maxSpeed, s.speed + 220 * dt);
      const curSpd = Math.max(1, Math.hypot(s.vx, s.vy, s.vz));
      let ux = s.vx / curSpd;
      let uy = s.vy / curSpd;
      let uz = s.vz / curSpd;

      let goalX = this.x;
      let goalY = this.y;
      let goalZ = this.z;
      let goalVx = this.vx;
      let goalVy = this.vy;
      let goalVz = this.vz;
      let decoyFlare: CmdsFlare | null = null;

      if (s.decoyedByFlareId !== null) {
        decoyFlare = this.flares.find((f) => f.id === s.decoyedByFlareId) ?? null;
        if (decoyFlare) {
          goalX = decoyFlare.x;
          goalY = decoyFlare.y;
          goalZ = decoyFlare.z;
          goalVx = decoyFlare.vx;
          goalVy = decoyFlare.vy;
          goalVz = decoyFlare.vz;
        }
      }

      const dx = goalX - s.x;
      const dy = goalY - s.y;
      const dz = goalZ - s.z;
      const dist = Math.max(1, Math.hypot(dx, dy, dz));

      // Hard 7G break-turn OR mesa terrain masking breaks terminal SAM tracking cleanly!
      const highGDefeat = s.decoyedByFlareId === null && this.gLoad >= 6.8 && dist < 440;
      const mesaMasked =
        s.decoyedByFlareId === null &&
        dist > 280 &&
        s.age > 0.9 &&
        !this.terrain.hasLineOfSight({ x: s.x, y: s.y, z: s.z }, { x: this.x, y: this.y, z: this.z });
      if (highGDefeat) s.evadedByHighG = true;
      if (mesaMasked) s.evadedByMask = true;

      if (!mesaMasked) {
        const tgo = Math.min(0.85, dist / s.speed);
        const lx = goalX + goalVx * tgo - s.x;
        const ly = goalY + goalVy * tgo - s.y;
        const lz = goalZ + goalVz * tgo - s.z;
        const lLen = Math.max(1, Math.hypot(lx, ly, lz));
        const tx = lx / lLen;
        const ty = ly / lLen;
        const tz = lz / lLen;

        const turnRate = s.decoyedByFlareId !== null ? 9.0 : highGDefeat ? 0.65 : 2.65;
        const steer = Math.min(1, turnRate * dt);
        const nx = ux + (tx - ux) * steer;
        const ny = uy + (ty - uy) * steer;
        const nz = uz + (tz - uz) * steer;
        const nLen = Math.max(0.0001, Math.hypot(nx, ny, nz));
        ux = nx / nLen;
        uy = ny / nLen;
        uz = nz / nLen;
      }

      s.vx = ux * s.speed;
      s.vy = uy * s.speed;
      s.vz = uz * s.speed;

      const prevX = s.x;
      const prevY = s.y;
      const prevZ = s.z;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;

      s.trail.push({ x: s.x, y: s.y, z: s.z });
      if (s.trail.length > 42) s.trail.shift();

      if (
        decoyFlare &&
        this.segmentHitsSphere(
          prevX,
          prevY,
          prevZ,
          s.x,
          s.y,
          s.z,
          decoyFlare.x,
          decoyFlare.y,
          decoyFlare.z,
          28
        )
      ) {
        this.explosions.push({
          x: s.x,
          y: s.y,
          z: s.z,
          age: 0,
          duration: 0.82,
          maxRadius: 42,
          color: '#FFB000',
        });
        this.spawnSparks(s.x, s.y, s.z, '#FFF6CC', 22);
        this.audioCb.onMuffledExplosion(0, false);
        this.enemySams.splice(i, 1);
        continue;
      }

      if (
        s.decoyedByFlareId === null &&
        this.segmentHitsSphere(prevX, prevY, prevZ, s.x, s.y, s.z, this.x, this.y, this.z, 16)
      ) {
        this.explosions.push({
          x: s.x,
          y: s.y,
          z: s.z,
          age: 0,
          duration: 0.85,
          maxRadius: 46,
          color: '#FF3322',
        });
        this.audioCb.onMuffledExplosion(0, true);
        this.enemySams.splice(i, 1);
        this.applyHullDamage(50, 'SAM WARHEAD IMPACT', 0);
        if (this.phase === 'GAME_OVER') return;
        continue;
      }

      const h = this.terrain.sampleHeight(s.x, s.z);
      if (s.y <= h + 1.5) {
        if (s.decoyedByFlareId === null && (s.evadedByMask || s.evadedByHighG)) {
          const bonus = Math.round((s.evadedByHighG ? 400 : 350) * this.noeMultiplier);
          this.score += bonus;
          this.audioCb.onBonusChime(false);
          this.popups.push({
            text: s.evadedByHighG
              ? `7G BREAK EVADED! +${bonus}`
              : `SAM TERRAIN-MASKED! +${bonus}`,
            subText: 'SAM IMPACTED VALLEY TERRAIN',
            nx: 0,
            ny: -0.2,
            color: '#44FF77',
            age: 0,
            duration: 1.75,
          });
        }
        this.explosions.push({
          x: s.x,
          y: h + 3,
          z: s.z,
          age: 0,
          duration: 0.72,
          maxRadius: 36,
          color: '#FFB000',
        });
        this.audioCb.onMuffledExplosion(0, false);
        this.enemySams.splice(i, 1);
      }
    }
  }

  private stepEnemyFlakBursts(dt: number): void {
    for (let i = this.flakBursts.length - 1; i >= 0; i--) {
      const f = this.flakBursts[i];
      f.age += dt;
      if (!f.detonated && f.age >= f.fuseTime) {
        f.detonated = true;
        const dist = Math.hypot(f.x - this.x, f.y - this.y, f.z - this.z);
        const relX = f.x - this.x;
        const relY = f.y - this.y;
        const relZ = f.z - this.z;
        const camX =
          relX * this.basis.right.x + relY * this.basis.right.y + relZ * this.basis.right.z;
        const camZ = Math.max(
          10,
          Math.abs(relX * this.basis.forward.x + relY * this.basis.forward.y + relZ * this.basis.forward.z)
        );
        const pan = Math.max(-0.85, Math.min(0.85, camX / (camZ * 0.8)));

        if (dist < 280) {
          this.audioCb.onMuffledExplosion(pan, false);
        }

        if (dist <= f.radius + 9.5 && !f.hitPlayer) {
          f.hitPlayer = true;
          this.applyHullDamage(16, 'AAA FLAK SHRAPNEL', pan);
          if (this.phase === 'GAME_OVER') return;
        }
      }

      if (f.age >= f.fuseTime + f.duration) {
        this.flakBursts.splice(i, 1);
      }
    }
  }

  private triggerAirframeLoss(cause: string): void {
    this.hull = 0;
    this.lastDeathCause = cause;
    this.phase = 'GAME_OVER';
    this.pullUpWarning = false;
    this.isStalling = false;
    this.stallFactor = 0;
    this.buffetIntensity = 0;
    this.samIncomingActive = false;
    this.samLockActive = false;
    this.cmdsActiveTimer = 0;
    this.cmdsBurstRemaining = 0;
    this.cmdsBurstBeatTimer = 0;
    this.hitFlashTimer = 0.65;
    this.screenShake = 15;
    this.gunFiringNow = false;
    this.audioCb.onVulcanFiring(false);
    this.gameOverLockoutTimer = TRENCH_CONSTANTS.GAME_OVER_LOCKOUT_SEC;

    this.audioCb.onHullImpactThud(0);
    this.audioCb.onMuffledExplosion(0, true);
    this.audioCb.onSyncGlitch(0.88);
    this.pushCrtShockwave(0.5, 0.45, 0.42, 0.92, 0.72);
    this.popups.push({
      text: cause,
      subText: 'AIRFRAME LOST // EJECTION SIGNAL TERMINATED',
      nx: 0,
      ny: -0.12,
      color: '#FF3322',
      age: 0,
      duration: 2.5,
    });
  }

  private segmentHitsSphere(
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
    cx: number,
    cy: number,
    cz: number,
    r: number
  ): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    const lenSq = dx * dx + dy * dy + dz * dz;
    if (lenSq < 1e-6) {
      return Math.hypot(x1 - cx, y1 - cy, z1 - cz) <= r;
    }
    const t = Math.max(
      0,
      Math.min(1, ((cx - x1) * dx + (cy - y1) * dy + (cz - z1) * dz) / lenSq)
    );
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    const pz = z1 + dz * t;
    const distSq = (px - cx) * (px - cx) + (py - cy) * (py - cy) + (pz - cz) * (pz - cz);
    return distSq <= r * r;
  }

  private spawnSparks(x: number, y: number, z: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.35) * Math.PI * 0.7;
      const spd = 28 + Math.random() * 78;
      this.sparks.push({
        x,
        y,
        z,
        vx: Math.cos(theta) * Math.cos(phi) * spd,
        vy: Math.sin(phi) * spd + 16,
        vz: Math.sin(theta) * Math.cos(phi) * spd,
        life: 0.35 + Math.random() * 0.45,
        maxLife: 0.8,
        color,
        size: 2.4 + Math.random() * 2.6,
      });
    }
  }

  private pushCrtShockwave(
    uvX: number,
    uvY: number,
    maxRadiusNorm: number,
    peakIntensity: number,
    duration: number
  ): void {
    this.crtShockwaves.push({
      uvX: Math.max(0.05, Math.min(0.95, uvX)),
      uvY: Math.max(0.05, Math.min(0.95, uvY)),
      age: 0,
      duration,
      maxRadiusNorm,
      peakIntensity,
    });
    if (this.crtShockwaves.length > 4) {
      this.crtShockwaves.shift();
    }
  }

  private stepEffects(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.vy -= 42 * dt;
    }

    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i];
      ex.age += dt;
      if (ex.age >= ex.duration) {
        this.explosions.splice(i, 1);
      }
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pop = this.popups[i];
      pop.age += dt;
      pop.ny -= 0.04 * dt;
      if (pop.age >= pop.duration) {
        this.popups.splice(i, 1);
      }
    }

    for (let i = this.crtShockwaves.length - 1; i >= 0; i--) {
      const sw = this.crtShockwaves[i];
      sw.age += dt;
      if (sw.age >= sw.duration) {
        this.crtShockwaves.splice(i, 1);
      }
    }
  }

  private wrapAngle(a: number): number {
    let r = a;
    while (r > Math.PI) r -= Math.PI * 2;
    while (r < -Math.PI) r += Math.PI * 2;
    return r;
  }

  public getElapsedSec(): number {
    return this.elapsedSec;
  }
}
