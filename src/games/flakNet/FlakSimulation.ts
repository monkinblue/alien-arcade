import type { Vec2 } from '../../types';
import {
  FLAK_CONSTANTS,
  type ActiveCrtShockwave,
  type BatteryId,
  type ColonyDome,
  type DefenseBattery,
  type FlakParticle,
  type FlakPhase,
  type InterceptorShell,
  type KillLogEntry,
  type OrbitalBoss,
  type OrbitalBossHardpoint,
  type OrbitalDropPod,
  type OrbitalThreat,
  type ScorePopup,
  type ShockwaveBlast,
  type TelemetryLogEntry,
  type ThreatKind,
  type WaveAuditState,
} from './types';

export interface FlakAudioCallbacks {
  onLaunchLight(screenXNorm: number): void;
  onLaunchEmp(screenXNorm: number): void;
  onDetonateAirburst(screenXNorm: number, altitudeNorm: number): void;
  onDetonateEmp(screenXNorm: number, altitudeNorm: number): void;
  onBatteryReload(screenXNorm: number): void;
  onDomeBreach(screenXNorm: number): void;
  onWaveIncoming(): void;
  onDomeLockAlarm(screenXNorm: number): void;
  onMirvSplitWarning(screenXNorm: number): void;
  onRadarPing(screenXNorm: number, pitchScale?: number, volume?: number): void;
  onHarmonicCombo(chainMultiplier: number, isDangerClose: boolean, screenXNorm: number): void;
  onDeflectionClank(screenXNorm: number, isCollisionKill?: boolean): void;
  onTallyClick(stepIndex: number): void;
  onDropPodRestore(screenXNorm: number): void;
  onBossArrival(screenXNorm: number): void;
  onBossSalvo(screenXNorm: number): void;
  onBossHullHit(screenXNorm: number, hardpointDestroyed: boolean): void;
  onBossDestroyed(screenXNorm: number): void;
  onSyncGlitch(intensity: number): void;
}

interface WaveSpawnEvent {
  delaySec: number;
  kind: ThreatKind;
  spawnX: number;
  targetX: number;
  flightSec: number;
  orbitalDriftAx: number;
}

const CHAIN_LADDER = [1, 2, 3, 4, 6, 8, 12, 16] as const;

export interface DeflectionPreview {
  meteorId: number;
  originX: number;
  originY: number;
  arc: Vec2[];
  hitsOtherThreat: boolean;
}

/** Deterministic PRNG keyed per wave so every leaderboard player faces identical wave choreography */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class FlakSimulation {
  public phase: FlakPhase = 'TITLE';
  public waveNumber = 1;
  public score = 0;
  /** True when this Ranked run was launched in 1979 CRT Mode (grants baseline 1.5x score!) */
  public ranked1979Bonus = false;
  public highChain = 1;
  public liveChain = 1;
  public liveChainDecayTimer = 0;
  /** Temporary Ballistic Path & Lead-Circle Predictor Boost earned by landing a 2x+ chain! */
  public predictorBoostTimer = 0;
  public readonly predictorBoostMaxSec = 14.0;
  public shotsFired = 0;
  public shotsHit = 0;
  public totalKills = 0;
  public deflectionKills = 0;
  public dangerCloseKills = 0;
  public dangerCloseRechargeProgress = 0;
  public empRechargeFlashTimer = 0;
  public gameOverLockoutTimer = 0;
  public isDemoMode = false;
  public paused = false;

  public domes: ColonyDome[] = [];
  public batteries: DefenseBattery[] = [];
  public horizonProfile: Vec2[] = [];

  public threats: OrbitalThreat[] = [];
  public shells: InterceptorShell[] = [];
  public blasts: ShockwaveBlast[] = [];
  public crtShockwaves: ActiveCrtShockwave[] = [];
  public particles: FlakParticle[] = [];
  public popups: ScorePopup[] = [];
  public dropPod: OrbitalDropPod | null = null;
  public boss: OrbitalBoss | null = null;
  public logs: TelemetryLogEntry[] = [];
  public killLogs: KillLogEntry[] = [];
  public waveAudit: WaveAuditState | null = null;

  public screenShake = 0;
  public domeHitFlashTimer = 0;
  public radarSweepAngle = -Math.PI;
  public waveElapsedSec = 0;

  private audioCb: FlakAudioCallbacks;
  private spawnQueue: WaveSpawnEvent[] = [];
  private nextEntityId = 1;
  private missionElapsedSec = 0;
  private radarPingCooldown = 0;

  constructor(audioCb: FlakAudioCallbacks) {
    this.audioCb = audioCb;
    this.buildHorizonProfile();
    this.initStaticInstallations();
    this.resetToTitle();
  }

  private buildHorizonProfile(): void {
    // Rugged deterministic LV-426 basalt mountain ridge framing the 4 domes & 3 batteries
    const rng = mulberry32(4262037);
    const pts: Vec2[] = [];
    const steps = 48;
    const flatZones = [180, 420, 710, 960, 1210, 1500, 1740];

    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * FLAK_CONSTANTS.VIRTUAL_W;
      let nearFlat = false;
      for (const fx of flatZones) {
        if (Math.abs(x - fx) < 76) {
          nearFlat = true;
          break;
        }
      }
      const ridgeH = nearFlat
        ? 0
        : 16 + rng() * 54 + Math.sin(i * 0.65) * 14;
      pts.push({ x, y: FLAK_CONSTANTS.HORIZON_Y - ridgeH });
    }
    this.horizonProfile = pts;
  }

  private initStaticInstallations(): void {
    const hy = FLAK_CONSTANTS.HORIZON_Y;
    this.domes = [
      {
        id: 'HAB-01',
        label: 'HAB-01',
        x: 420,
        y: hy,
        radius: FLAK_CONSTANTS.DOME_RADIUS,
        intact: true,
        breachFlashTimer: 0,
        restoreFlashTimer: 0,
        savedFlashTimer: 0,
      },
      {
        id: 'HAB-02',
        label: 'HAB-02',
        x: 710,
        y: hy,
        radius: FLAK_CONSTANTS.DOME_RADIUS,
        intact: true,
        breachFlashTimer: 0,
        restoreFlashTimer: 0,
        savedFlashTimer: 0,
      },
      {
        id: 'HAB-03',
        label: 'HAB-03',
        x: 1210,
        y: hy,
        radius: FLAK_CONSTANTS.DOME_RADIUS,
        intact: true,
        breachFlashTimer: 0,
        restoreFlashTimer: 0,
        savedFlashTimer: 0,
      },
      {
        id: 'HAB-04',
        label: 'HAB-04',
        x: 1500,
        y: hy,
        radius: FLAK_CONSTANTS.DOME_RADIUS,
        intact: true,
        breachFlashTimer: 0,
        restoreFlashTimer: 0,
        savedFlashTimer: 0,
      },
    ];

    this.batteries = [
      {
        id: 'A',
        label: 'BAT-A [M90 FLAK]',
        weaponType: 'M90_FLAK',
        x: 180,
        y: FLAK_CONSTANTS.BATTERY_Y,
        aimAngle: -Math.PI * 0.35,
        recoil: 0,
        ammo: FLAK_CONSTANTS.FLAK_MAG_MAX,
        maxAmmo: FLAK_CONSTANTS.FLAK_MAG_MAX,
        reloadProgress: 0,
        reloadDuration: FLAK_CONSTANTS.FLAK_RELOAD_SEC,
        cooldownTimer: 0,
        muzzleFlashTimer: 0,
      },
      {
        id: 'S',
        label: 'BAT-S [MK-IV EMP]',
        weaponType: 'MK4_EMP',
        x: 960,
        y: FLAK_CONSTANTS.BATTERY_Y,
        aimAngle: -Math.PI * 0.5,
        recoil: 0,
        ammo: 4,
        maxAmmo: 4,
        reloadProgress: 0,
        reloadDuration: 0,
        cooldownTimer: 0,
        muzzleFlashTimer: 0,
      },
      {
        id: 'D',
        label: 'BAT-D [M90 FLAK]',
        weaponType: 'M90_FLAK',
        x: 1740,
        y: FLAK_CONSTANTS.BATTERY_Y,
        aimAngle: -Math.PI * 0.65,
        recoil: 0,
        ammo: FLAK_CONSTANTS.FLAK_MAG_MAX,
        maxAmmo: FLAK_CONSTANTS.FLAK_MAG_MAX,
        reloadProgress: 0,
        reloadDuration: FLAK_CONSTANTS.FLAK_RELOAD_SEC,
        cooldownTimer: 0,
        muzzleFlashTimer: 0,
      },
    ];
  }

  public resetToTitle(): void {
    this.phase = 'TITLE';
    this.waveNumber = 1;
    this.score = 0;
    this.ranked1979Bonus = false;
    this.highChain = 1;
    this.liveChain = 1;
    this.liveChainDecayTimer = 0;
    this.predictorBoostTimer = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.totalKills = 0;
    this.deflectionKills = 0;
    this.dangerCloseKills = 0;
    this.dangerCloseRechargeProgress = 0;
    this.empRechargeFlashTimer = 0;
    this.gameOverLockoutTimer = 0;
    this.isDemoMode = false;
    this.paused = false;
    this.threats = [];
    this.shells = [];
    this.blasts = [];
    this.crtShockwaves = [];
    this.particles = [];
    this.popups = [];
    this.dropPod = null;
    this.boss = null;
    this.waveAudit = null;
    this.spawnQueue = [];
    this.screenShake = 0;
    this.domeHitFlashTimer = 0;
    this.missionElapsedSec = 0;
    this.initStaticInstallations();
    this.logs = [];
    this.killLogs = [];
    this.pushLog('SURFACE-TO-ORBIT RADAR 03 // FLAK NET STANDBY.', 'green');
    this.pushLog('LMB: NEAREST M90 FLAK | RMB/SPACE: MK-IV EMP MORTAR | A/S/D: MANUAL.', 'amber');
  }

  public startNewGame(options?: { ranked1979Bonus?: boolean }): void {
    this.resetToTitle();
    this.isDemoMode = false;
    this.ranked1979Bonus = Boolean(options?.ranked1979Bonus);
    this.phase = 'ACTIVE_WAVE';
    this.waveNumber = 1;
    this.beginWave(1);
  }

  public getBaseScoreMultiplier(): number {
    return this.ranked1979Bonus && !this.isDemoMode ? 1.5 : 1.0;
  }

  /**
   * Initializes an unranked Interactive Tactical Demo sandbox (hard-locked from Game Over & flak_scores).
   */
  public startDemoSandbox(): void {
    this.resetToTitle();
    this.isDemoMode = true;
    this.phase = 'ACTIVE_WAVE';
    this.waveNumber = 1;
    this.spawnQueue = [];
    this.threats = [];
    this.shells = [];
    this.blasts = [];
    this.boss = null;
    this.logs = [];
    this.killLogs = [];
    this.pushLog('MU-TH-UR TACTICAL BRIEFING // DEMO MODE ACTIVE (UNRANKED).', 'amber');
  }

  /**
   * Prepares a clean slate for each scripted Demo stage without wiping total score or kill logs.
   */
  public resetDemoStageState(stageWaveNumber: number, empAmmo: number, empMax = 3): void {
    this.isDemoMode = true;
    this.phase = 'ACTIVE_WAVE';
    this.waveNumber = stageWaveNumber;
    this.waveElapsedSec = 0;
    this.waveAudit = null;
    this.spawnQueue = [];
    this.threats = [];
    this.shells = [];
    this.blasts = [];
    this.boss = null;
    this.dropPod = null;

    for (const d of this.domes) {
      d.intact = true;
      d.breachFlashTimer = 0;
    }
    for (const b of this.batteries) {
      if (b.weaponType === 'M90_FLAK') {
        b.ammo = b.maxAmmo;
        b.reloadProgress = 0;
        b.cooldownTimer = 0;
      } else {
        b.maxAmmo = empMax;
        b.ammo = Math.max(0, Math.min(empMax, empAmmo));
        b.cooldownTimer = 0;
      }
    }
  }

  public setEmpAmmo(ammo: number, maxAmmo?: number): void {
    const empBat = this.batteries[1];
    if (!empBat) return;
    if (typeof maxAmmo === 'number' && maxAmmo >= 1) {
      empBat.maxAmmo = maxAmmo;
    }
    empBat.ammo = Math.max(0, Math.min(empBat.maxAmmo, ammo));
    empBat.cooldownTimer = 0;
  }

  /**
   * Spawns a deterministic curved orbital threat directly into active airspace (used by Tactical Demo Director).
   */
  public spawnScriptedThreat(params: {
    kind: ThreatKind;
    spawnX: number;
    targetX: number;
    flightSec: number;
    orbitalDriftAx?: number;
  }): OrbitalThreat {
    this.spawnThreatFromEvent({
      delaySec: 0,
      kind: params.kind,
      spawnX: params.spawnX,
      targetX: params.targetX,
      flightSec: Math.max(2.4, params.flightSec),
      orbitalDriftAx: params.orbitalDriftAx ?? 0,
    });
    return this.threats[this.threats.length - 1];
  }

  public pushTelemetryLog(text: string, tone: TelemetryLogEntry['tone'] = 'amber'): void {
    this.pushLog(text, tone);
  }

  /**
   * Jumps directly to any wave number (1..N) with intact domes for testing/verification.
   */
  public jumpToWave(wave: number): void {
    const targetWave = Math.max(1, Math.floor(wave));
    this.isDemoMode = false;
    this.paused = false;
    this.gameOverLockoutTimer = 0;
    if (this.getIntactDomeCount() <= 0 || this.phase === 'TITLE' || this.phase === 'GAME_OVER') {
      this.initStaticInstallations();
    }
    this.beginWave(targetWave);
  }

  public getAccuracyPercent(): number {
    if (this.shotsFired <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((this.shotsHit / this.shotsFired) * 100)));
  }

  public getIntactDomeCount(): number {
    let n = 0;
    for (const d of this.domes) if (d.intact) n++;
    return n;
  }

  public getThreatDensityNormalized(): number {
    let weight = 0;
    for (const t of this.threats) {
      const altBoost = t.y >= FLAK_CONSTANTS.DANGER_CLOSE_Y ? 1.55 : 1.0;
      const typeW =
        t.kind === 'HEAVY_METEOR'
          ? 1.5
          : t.kind === 'MIRV_POD'
            ? 1.4
            : t.kind === 'ION_JAMMER'
              ? 1.25
              : 1.0;
      weight += typeW * altBoost;
    }
    return Math.max(0, Math.min(1, weight / 14));
  }

  public isPositionJammed(x: number, y: number): boolean {
    for (const t of this.threats) {
      if (t.kind === 'ION_JAMMER') {
        if (Math.hypot(x - t.x, y - t.y) <= t.jamRadius) {
          return true;
        }
      }
    }
    return false;
  }

  public getActiveJammerIntensity(): number {
    let count = 0;
    for (const t of this.threats) {
      if (t.kind === 'ION_JAMMER') count++;
    }
    return Math.min(1, count * 0.45);
  }

  private pushLog(text: string, tone: TelemetryLogEntry['tone'] = 'green'): void {
    const mins = Math.floor(this.missionElapsedSec / 60);
    const secs = Math.floor(this.missionElapsedSec % 60);
    const ts = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    this.logs.unshift({ timestamp: ts, text, tone });
    if (this.logs.length > 10) {
      this.logs.length = 10;
    }
  }

  private pushKillLog(
    t: OrbitalThreat,
    methodTag: string,
    tone: KillLogEntry['tone']
  ): void {
    const mins = Math.floor(this.missionElapsedSec / 60);
    const secs = Math.floor(this.missionElapsedSec % 60);
    const ts = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    const prefix =
      t.kind === 'HEAVY_METEOR'
        ? 'HVY'
        : t.kind === 'MIRV_POD'
          ? 'MRV'
          : t.kind === 'ION_JAMMER'
            ? 'JAM'
            : t.isSubMunition
              ? 'SUB'
              : 'ROD';
    const altKm = Math.max(
      0,
      Math.round(((FLAK_CONSTANTS.HORIZON_Y - t.y) / FLAK_CONSTANTS.HORIZON_Y) * 98)
    );
    this.killLogs.push({
      seq: this.totalKills,
      timestamp: ts,
      unitCode: `${prefix}-${String(t.id % 100).padStart(2, '0')}`,
      coordX: Math.max(0, Math.min(FLAK_CONSTANTS.VIRTUAL_W, Math.round(t.x))),
      altKm,
      methodTag,
      tone,
    });
    if (this.killLogs.length > 32) {
      this.killLogs.shift();
    }
  }

  // ===========================================================================
  // DETERMINISTIC WAVE CHOREOGRAPHY (mulberry32 seeded by wave number!)
  // ===========================================================================
  private beginWave(wave: number): void {
    this.waveNumber = wave;
    this.phase = 'ACTIVE_WAVE';
    this.waveAudit = null;
    this.waveElapsedSec = 0;
    this.threats = [];
    this.shells = [];
    this.blasts = [];
    this.boss = null;

    // Replenish batteries (Flak full, Center EMP Mortar scales 3..6 capacitor rounds per wave)
    const isBossWave = wave % 5 === 0;
    const empMax = Math.min(6, (isBossWave ? 5 : 3) + Math.floor((wave - 1) / 3));
    for (const b of this.batteries) {
      if (b.weaponType === 'M90_FLAK') {
        b.ammo = b.maxAmmo;
        b.reloadProgress = 0;
        b.cooldownTimer = 0;
      } else {
        b.maxAmmo = empMax;
        b.ammo = empMax;
        b.cooldownTimer = 0;
      }
    }

    const rng = mulberry32(Math.imul(wave, 2654435761) ^ 0x4c563432);
    const queue: WaveSpawnEvent[] = [];

    // Steeper difficulty ramp: denser salvos, higher speeds, earlier MIRV & Jammer pressure!
    const totalContacts = isBossWave
      ? Math.min(20, 6 + Math.floor(wave * 0.9))
      : Math.min(54, 9 + wave * 4);
    const waveSpanSec = isBossWave
      ? Math.min(24, 14 + wave * 0.5)
      : Math.min(24.5, 11.0 + wave * 0.85);
    const domeXs = this.domes.map((d) => d.x);

    // Build deterministic threat budget for this wave
    const meteorCount = isBossWave
      ? Math.min(4, 1 + Math.floor(wave / 5))
      : Math.min(14, 2 + Math.floor(wave * 1.1));
    const mirvCount =
      wave >= 2
        ? isBossWave
          ? Math.min(4, 1 + Math.floor(wave / 5))
          : Math.min(10, Math.floor((wave - 1) * 1.15) + 1)
        : 0;
    const jammerCount =
      wave >= 3
        ? isBossWave
          ? Math.min(2, Math.floor(wave / 5))
          : Math.min(4, Math.floor((wave - 1) / 2))
        : 0;
    const rodCount = Math.max(4, totalContacts - meteorCount - mirvCount - jammerCount);

    const kinds: ThreatKind[] = [];
    for (let i = 0; i < rodCount; i++) kinds.push('KINETIC_ROD');
    for (let i = 0; i < meteorCount; i++) kinds.push('HEAVY_METEOR');
    for (let i = 0; i < mirvCount; i++) kinds.push('MIRV_POD');
    for (let i = 0; i < jammerCount; i++) kinds.push('ION_JAMMER');

    // Deterministic Fisher-Yates shuffle
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = kinds[i];
      kinds[i] = kinds[j];
      kinds[j] = tmp;
    }

    // Steeper speed scaling + tighter overlapping salvo clusters
    const speedFactor = 1 + Math.min(1.55, (wave - 1) * 0.115);
    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i];
      const baseFrac = i / Math.max(1, kinds.length);
      // Salvo burst grouping creates sudden high-pressure waves
      const clusterJitter = (rng() - 0.5) * 1.35;
      const delaySec = Math.max(0.3, (isBossWave ? 2.2 : 0.45) + baseFrac * waveSpanSec + clusterJitter);

      const spawnX = 95 + rng() * (FLAK_CONSTANTS.VIRTUAL_W - 190);

      // 84% target Colony Domes directly for relentless pressure
      let targetX: number;
      if (rng() < 0.84) {
        const idx = Math.floor(rng() * domeXs.length);
        targetX = domeXs[idx] + (rng() - 0.5) * 28;
      } else {
        targetX = 240 + rng() * (FLAK_CONSTANTS.VIRTUAL_W - 480);
      }

      let flightSec: number;
      if (kind === 'KINETIC_ROD') {
        flightSec = (6.3 + rng() * 2.1) / speedFactor;
      } else if (kind === 'HEAVY_METEOR') {
        flightSec = (9.2 + rng() * 2.6) / speedFactor;
      } else if (kind === 'MIRV_POD') {
        flightSec = (10.6 + rng() * 2.2) / speedFactor;
      } else {
        flightSec = (11.8 + rng() * 2.4) / speedFactor;
      }

      // Curved orbital re-entry lateral drift (Coriolis bend!)
      const driftSign = rng() < 0.5 ? -1 : 1;
      const driftMag =
        kind === 'KINETIC_ROD'
          ? 18 + rng() * 32
          : kind === 'HEAVY_METEOR'
            ? 10 + rng() * 18
            : 8 + rng() * 14;

      queue.push({
        delaySec,
        kind,
        spawnX,
        targetX,
        flightSec: Math.max(2.55, flightSec),
        orbitalDriftAx: driftSign * driftMag,
      });
    }

    queue.sort((a, b) => a.delaySec - b.delaySec);
    this.spawnQueue = queue;

    if (isBossWave) {
      this.spawnOrbitalBoss(wave);
    } else {
      this.pushLog(
        `WAVE ${String(wave).padStart(2, '0')} // ${queue.length} ORBITAL SIGNATURES TRACKED — MK-IV EMP ARMED (${empMax}).`,
        'amber'
      );
      this.audioCb.onWaveIncoming();
      this.audioCb.onRadarPing(0.5, 1.0, 0.34);
    }
  }

  private spawnOrbitalBoss(wave: number): void {
    const tier = Math.max(1, Math.floor(wave / 5));
    const roman = tier === 1 ? 'MK-I' : tier === 2 ? 'MK-II' : tier === 3 ? 'MK-III' : `MK-${tier}`;
    const flankHp = 4 + (tier - 1) * 2;
    const coreHp = 6 + (tier - 1) * 3;
    const hardpoints: OrbitalBossHardpoint[] = [
      {
        id: 'PORT',
        label: 'PORT RAIL',
        offsetX: -124,
        offsetY: 16,
        radius: 34,
        hp: flankHp,
        maxHp: flankHp,
        destroyed: false,
        hitFlashTimer: 0,
      },
      {
        id: 'CORE',
        label: 'REACTOR CORE',
        offsetX: 0,
        offsetY: 4,
        radius: 44,
        hp: coreHp,
        maxHp: coreHp,
        destroyed: false,
        hitFlashTimer: 0,
      },
      {
        id: 'STBD',
        label: 'STBD RAIL',
        offsetX: 124,
        offsetY: 16,
        radius: 34,
        hp: flankHp,
        maxHp: flankHp,
        destroyed: false,
        hitFlashTimer: 0,
      },
    ];
    const maxHp = hardpoints.reduce((acc, h) => acc + h.maxHp, 0);

    this.boss = {
      id: this.nextEntityId++,
      tier,
      designation: `SIEGE DREADNOUGHT ${roman}`,
      x: FLAK_CONSTANTS.VIRTUAL_W * 0.5,
      y: -90,
      targetY: 208,
      vx: 105 + tier * 24,
      halfWidth: 184,
      halfHeight: 54,
      age: 0,
      hp: maxHp,
      maxHp,
      hardpoints,
      salvoCooldown: 3.1,
      chargeTimer: 0,
      chargeDuration: Math.max(0.95, 1.4 - (tier - 1) * 0.12),
      targetDomeIds: [],
      empStunTimer: 0,
      hitFlashTimer: 0,
      dyingTimer: 0,
      deathBlastStage: 0,
    };

    this.screenShake = Math.max(this.screenShake, 8);
    this.pushCrtShockwave(FLAK_CONSTANTS.VIRTUAL_W * 0.5, 110, 0.35, 0.65, 0.85);
    this.audioCb.onBossArrival(0.5);
    this.audioCb.onSyncGlitch(0.45);
    this.pushLog(
      `CRITICAL // WAVE ${String(wave).padStart(2, '0')} BOSS EVENT: ${this.boss.designation} ENTERING ORBIT!`,
      'red'
    );
    this.pushLog(
      'DESTROY PORT/STBD RAIL HARDPOINTS + REACTOR CORE — EMP STUNS SALVO CHARGE!',
      'amber'
    );
  }

  private spawnThreatFromEvent(ev: WaveSpawnEvent): void {
    const y0 = -24;
    const hy = FLAK_CONSTANTS.HORIZON_Y;
    const T = ev.flightSec;
    const gravScale =
      ev.kind === 'KINETIC_ROD'
        ? 1.18
        : ev.kind === 'HEAVY_METEOR'
          ? 0.92
          : ev.kind === 'MIRV_POD'
            ? 0.65
            : 0.58;
    const g = FLAK_CONSTANTS.GRAVITY * gravScale;
    const ax = ev.orbitalDriftAx;

    // Exact curved orbital kinematics so contact tracks onto ev.targetX at time T!
    const vx = (ev.targetX - ev.spawnX - 0.5 * ax * T * T) / T;
    const vy = Math.max(24, (hy - y0 - 0.5 * g * T * T) / T);

    // Deterministic polygon for Heavy Armored Meteor
    const polyRadii: number[] = [];
    if (ev.kind === 'HEAVY_METEOR') {
      const mRng = mulberry32(this.nextEntityId * 7919 + this.waveNumber * 131);
      const verts = 8;
      for (let k = 0; k < verts; k++) {
        polyRadii.push(0.74 + mRng() * 0.42);
      }
    }

    const hp =
      ev.kind === 'HEAVY_METEOR'
        ? this.waveNumber >= 5
          ? 4
          : 3
        : 1;

    const threat: OrbitalThreat = {
      id: this.nextEntityId++,
      kind: ev.kind,
      x: ev.spawnX,
      y: y0,
      vx,
      vy,
      orbitalDriftAx: ax,
      gravityScale: gravScale,
      radius:
        ev.kind === 'HEAVY_METEOR'
          ? 24
          : ev.kind === 'MIRV_POD'
            ? 18
            : ev.kind === 'ION_JAMMER'
              ? 20
              : 10,
      mass: ev.kind === 'HEAVY_METEOR' ? 2.15 : 1.0,
      hp,
      maxHp: hp,
      angle: Math.atan2(vy, vx),
      angVel: ev.kind === 'HEAVY_METEOR' ? (ev.orbitalDriftAx >= 0 ? 1.15 : -1.15) : 0,
      polyRadii,
      trail: [{ x: ev.spawnX, y: y0 }],
      hasSplit: false,
      empScrambled: false,
      jamRadius: ev.kind === 'ION_JAMMER' ? 290 : 0,
      deflectedTimer: 0,
      deflectedByBlastId: null,
      deflectionSaveAwarded: false,
      wasTargetingDomeId: null,
      predictedArc: [],
      predictedImpactX: ev.targetX,
      predictedImpactY: hy,
      lockedDomeId: null,
      hitFlashTimer: 0,
      age: 0,
    };

    this.recomputeBallisticPrediction(threat);
    threat.wasTargetingDomeId = threat.lockedDomeId;
    this.threats.push(threat);

    if (this.radarPingCooldown <= 0) {
      this.radarPingCooldown = 1.35;
      const pitch =
        ev.kind === 'HEAVY_METEOR'
          ? 0.92
          : ev.kind === 'MIRV_POD'
            ? 1.04
            : ev.kind === 'ION_JAMMER'
              ? 0.95
              : 0.98;
      this.audioCb.onRadarPing(threat.x / FLAK_CONSTANTS.VIRTUAL_W, pitch, 0.22);
    }

    if (ev.kind === 'ION_JAMMER') {
      this.pushLog('WARNING // ION STORM JAMMER ENTERING UPPER ATMOSPHERE.', 'amber');
    } else if (ev.kind === 'MIRV_POD') {
      this.pushLog('BIO-POD MIRV SIGNATURE DETECTED — INTERCEPT ABOVE SPLIT LINE.', 'amber');
    }
  }

  /**
   * Computes exact curved gravity-well trajectory down to LV-426 horizon and identifies
   * whether the contact is locked onto any intact Colony Dome.
   */
  public recomputeBallisticPrediction(t: OrbitalThreat): void {
    const g = FLAK_CONSTANTS.GRAVITY * t.gravityScale;
    const dy = FLAK_CONSTANTS.HORIZON_Y - t.y;
    let tImpact = 0;

    if (dy <= 0) {
      tImpact = 0;
    } else if (g > 0.001) {
      // Solve 0.5*g*T^2 + vy*T - dy = 0 for positive root T
      const disc = t.vy * t.vy + 2 * g * dy;
      if (disc >= 0) {
        tImpact = (-t.vy + Math.sqrt(disc)) / g;
      }
    } else if (t.vy > 0.1) {
      tImpact = dy / t.vy;
    }

    // Cap lookahead time if deflected violently upward
    const clampedT = Math.max(0, Math.min(18, tImpact));
    const samples = 14;
    const arc: Vec2[] = [];
    for (let i = 1; i <= samples; i++) {
      const dt = (clampedT * i) / samples;
      const px = t.x + t.vx * dt + 0.5 * t.orbitalDriftAx * dt * dt;
      const py = t.y + t.vy * dt + 0.5 * g * dt * dt;
      arc.push({ x: px, y: Math.min(FLAK_CONSTANTS.HORIZON_Y, py) });
    }

    const impactX = t.x + t.vx * clampedT + 0.5 * t.orbitalDriftAx * clampedT * clampedT;
    t.predictedArc = arc;
    t.predictedImpactX = impactX;
    t.predictedImpactY = FLAK_CONSTANTS.HORIZON_Y;

    let locked: string | null = null;
    if (impactX > 20 && impactX < FLAK_CONSTANTS.VIRTUAL_W - 20) {
      for (const d of this.domes) {
        if (!d.intact) continue;
        if (Math.abs(impactX - d.x) <= d.radius + t.radius + 12) {
          locked = d.id;
          break;
        }
      }
    }
    t.lockedDomeId = locked;
  }

  // ===========================================================================
  // BATTERY AIMING & FIRING CONTROLS (Smart Flak, EMP Mortar, Manual A/S/D)
  // ===========================================================================
  public updateBatteryTurretAim(cursorVirtual: Vec2): void {
    const cx = Math.max(20, Math.min(FLAK_CONSTANTS.VIRTUAL_W - 20, cursorVirtual.x));
    const cy = Math.max(20, Math.min(FLAK_CONSTANTS.HORIZON_Y - 36, cursorVirtual.y));

    for (const b of this.batteries) {
      const rawAng = Math.atan2(cy - b.y, cx - b.x);
      // Clamp barrel elevation cleanly above horizon
      b.aimAngle = Math.max(-Math.PI + 0.16, Math.min(-0.16, rawAng));
    }
  }

  public pickNearestReadyFlakBattery(targetX: number): DefenseBattery | null {
    const flaks = this.batteries.filter(
      (b) => b.weaponType === 'M90_FLAK' && b.ammo > 0 && b.cooldownTimer <= 0
    );
    if (flaks.length === 0) return null;
    flaks.sort((a, b) => Math.abs(a.x - targetX) - Math.abs(b.x - targetX));
    return flaks[0];
  }

  public fireSmartFlak(targetX: number, targetY: number): boolean {
    if (this.phase !== 'ACTIVE_WAVE' || this.paused) return false;
    const bat = this.pickNearestReadyFlakBattery(targetX);
    if (!bat) return false;
    return this.fireBattery(bat.id, targetX, targetY);
  }

  public fireEmpMortar(targetX: number, targetY: number): boolean {
    if (this.phase !== 'ACTIVE_WAVE' || this.paused) return false;
    return this.fireBattery('S', targetX, targetY);
  }

  public fireBattery(batteryId: BatteryId, rawTargetX: number, rawTargetY: number): boolean {
    if (this.phase !== 'ACTIVE_WAVE' || this.paused) return false;
    const bat = this.batteries.find((b) => b.id === batteryId);
    if (!bat || bat.ammo <= 0 || bat.cooldownTimer > 0) return false;

    const tx = Math.max(24, Math.min(FLAK_CONSTANTS.VIRTUAL_W - 24, rawTargetX));
    const ty = Math.max(24, Math.min(FLAK_CONSTANTS.HORIZON_Y - 34, rawTargetY));

    const dx = tx - bat.x;
    const dy = ty - bat.y;
    const dist = Math.max(12, Math.hypot(dx, dy));
    const isEmp = bat.weaponType === 'MK4_EMP';
    const speed = isEmp ? FLAK_CONSTANTS.EMP_SHELL_SPEED : FLAK_CONSTANTS.FLAK_SHELL_SPEED;

    bat.ammo--;
    bat.cooldownTimer = isEmp
      ? FLAK_CONSTANTS.EMP_FIRE_COOLDOWN
      : FLAK_CONSTANTS.FLAK_FIRE_COOLDOWN;
    bat.recoil = isEmp ? 14 : 9;
    bat.muzzleFlashTimer = isEmp ? 0.16 : 0.1;
    bat.aimAngle = Math.max(-Math.PI + 0.16, Math.min(-0.16, Math.atan2(dy, dx)));
    this.shotsFired++;

    const muzzleX = bat.x + Math.cos(bat.aimAngle) * 24;
    const muzzleY = bat.y + Math.sin(bat.aimAngle) * 24;

    this.shells.push({
      id: this.nextEntityId++,
      batteryId: bat.id,
      isEmp,
      startX: muzzleX,
      startY: muzzleY,
      x: muzzleX,
      y: muzzleY,
      targetX: tx,
      targetY: ty,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      speed,
      distRemaining: dist,
      trail: [{ x: muzzleX, y: muzzleY }],
    });

    const xNorm = bat.x / FLAK_CONSTANTS.VIRTUAL_W;
    if (isEmp) {
      this.audioCb.onLaunchEmp(xNorm);
      this.screenShake = Math.max(this.screenShake, 5);
    } else {
      this.audioCb.onLaunchLight(xNorm);
      this.screenShake = Math.max(this.screenShake, 2.2);
    }
    return true;
  }

  /**
   * Computes time-of-flight and active battery telemetry for the vector Lead-Computing Reticle.
   */
  public getReticleInfo(cursor: Vec2): {
    activeFlakBattery: DefenseBattery | null;
    empReady: boolean;
    flakTofSec: number;
    empTofSec: number;
  } {
    const flak = this.pickNearestReadyFlakBattery(cursor.x);
    const fallbackFlak =
      flak ??
      (Math.abs(cursor.x - this.batteries[0].x) <= Math.abs(cursor.x - this.batteries[2].x)
        ? this.batteries[0]
        : this.batteries[2]);
    const empBat = this.batteries[1];

    const flakDist = Math.hypot(cursor.x - fallbackFlak.x, cursor.y - fallbackFlak.y);
    const empDist = Math.hypot(cursor.x - empBat.x, cursor.y - empBat.y);

    return {
      activeFlakBattery: flak,
      empReady: empBat.ammo > 0 && empBat.cooldownTimer <= 0,
      flakTofSec: flakDist / FLAK_CONSTANTS.FLAK_SHELL_SPEED,
      empTofSec: empDist / FLAK_CONSTANTS.EMP_SHELL_SPEED,
    };
  }

  /**
   * Computes a live billiard deflection vector preview whenever the player's reticle hovers
   * in the off-center shockwave push ring beside a Heavy Armored Meteor!
   */
  public getDeflectionPreview(cursor: Vec2): DeflectionPreview | null {
    const cx = Math.max(24, Math.min(FLAK_CONSTANTS.VIRTUAL_W - 24, cursor.x));
    const cy = Math.max(24, Math.min(FLAK_CONSTANTS.HORIZON_Y - 34, cursor.y));

    let best: OrbitalThreat | null = null;
    let bestDist = Infinity;
    for (const t of this.threats) {
      if (t.kind !== 'HEAVY_METEOR') continue;
      const d = Math.hypot(t.x - cx, t.y - cy);
      // Off-center push zone: outside tight vaporization core, inside outer shockwave ring!
      const minPush = FLAK_CONSTANTS.FLAK_CORE_RADIUS + t.radius * 0.45;
      const maxPush = FLAK_CONSTANTS.FLAK_BLAST_RADIUS + t.radius;
      if (d > minPush && d <= maxPush && d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    if (!best) return null;

    const dx = best.x - cx;
    const dy = best.y - cy;
    const nx = bestDist > 0.001 ? dx / bestDist : 1;
    const ny = bestDist > 0.001 ? dy / bestDist : -0.5;
    const radialFalloff = Math.max(
      0.48,
      1 - (bestDist / Math.max(1, FLAK_CONSTANTS.FLAK_BLAST_RADIUS)) * 0.44
    );
    const dv = (FLAK_CONSTANTS.FLAK_IMPULSE_FORCE / best.mass) * radialFalloff;

    const pvx = best.vx + nx * dv * 1.45;
    const pvy = best.vy + ny * dv * 0.85 - 48;
    const g = FLAK_CONSTANTS.GRAVITY * best.gravityScale;
    const arc: Vec2[] = [];
    let hitsOtherThreat = false;

    const steps = 10;
    const horizonSec = 0.9;
    for (let i = 1; i <= steps; i++) {
      const tSec = (horizonSec * i) / steps;
      const px = best.x + pvx * tSec + 0.5 * best.orbitalDriftAx * tSec * tSec;
      const py = best.y + pvy * tSec + 0.5 * g * tSec * tSec;
      arc.push({ x: px, y: py });
      if (!hitsOtherThreat) {
        for (const other of this.threats) {
          if (other.id === best.id) continue;
          const ox = other.x + other.vx * tSec + 0.5 * other.orbitalDriftAx * tSec * tSec;
          const oy =
            other.y +
            other.vy * tSec +
            0.5 * (FLAK_CONSTANTS.GRAVITY * other.gravityScale) * tSec * tSec;
          if (Math.hypot(px - ox, py - oy) <= best.radius + other.radius + 22) {
            hitsOtherThreat = true;
            break;
          }
        }
      }
      if (py >= FLAK_CONSTANTS.HORIZON_Y) break;
    }

    return {
      meteorId: best.id,
      originX: best.x,
      originY: best.y,
      arc,
      hitsOtherThreat,
    };
  }

  private advanceChainLadder(steps: number): number {
    let idx = CHAIN_LADDER.findIndex((v) => v >= this.liveChain);
    if (idx < 0) idx = CHAIN_LADDER.length - 1;
    const nextIdx = Math.min(CHAIN_LADDER.length - 1, idx + Math.max(1, steps));
    this.liveChain = CHAIN_LADDER[nextIdx];
    this.liveChainDecayTimer = 3.2;
    if (this.liveChain > this.highChain) {
      this.highChain = this.liveChain;
    }
    if (this.liveChain >= 2) {
      this.grantPredictorBoost(this.liveChain);
    }
    return this.liveChain;
  }

  private tryRechargeEmpShell(sourceLabel: string, x: number, y: number): void {
    const empBat = this.batteries[1];
    if (!empBat || empBat.ammo >= empBat.maxAmmo) return;
    empBat.ammo = Math.min(empBat.maxAmmo, empBat.ammo + 1);
    this.empRechargeFlashTimer = 1.65;
    this.popups.push({
      x,
      y: y - 34,
      text: '+1 MK-IV EMP RECHARGED',
      subText: `${sourceLabel} CAPACITOR SURGE`,
      color: '#8EF5AB',
      age: 0,
      duration: 1.65,
    });
    this.pushLog(`EMP CAPACITOR RECHARGED (+1 SHELL) // ${sourceLabel}!`, 'bright');
    this.audioCb.onHarmonicCombo(8, true, x / FLAK_CONSTANTS.VIRTUAL_W);
  }

  // ===========================================================================
  // MAIN SIMULATION STEP
  // ===========================================================================
  public step(rawDt: number): void {
    const dt = Math.max(0, Math.min(0.05, rawDt));
    if (this.paused) return;

    this.missionElapsedSec += dt;
    this.radarSweepAngle += dt * 0.95;
    if (this.radarSweepAngle > 0) {
      this.radarSweepAngle = -Math.PI;
    }

    if (this.radarPingCooldown > 0) this.radarPingCooldown -= dt;
    if (this.screenShake > 0) this.screenShake = Math.max(0, this.screenShake - dt * 26);
    if (this.domeHitFlashTimer > 0) this.domeHitFlashTimer = Math.max(0, this.domeHitFlashTimer - dt);
    if (this.empRechargeFlashTimer > 0) {
      this.empRechargeFlashTimer = Math.max(0, this.empRechargeFlashTimer - dt);
    }
    if (this.gameOverLockoutTimer > 0) {
      this.gameOverLockoutTimer = Math.max(0, this.gameOverLockoutTimer - dt);
    }

    if (this.liveChainDecayTimer > 0) {
      this.liveChainDecayTimer -= dt;
      if (this.liveChainDecayTimer <= 0) {
        this.liveChain = 1;
      }
    }

    // Update domes & batteries cooldowns / continuous M90 Flak autoloaders
    for (const d of this.domes) {
      if (d.breachFlashTimer > 0) d.breachFlashTimer = Math.max(0, d.breachFlashTimer - dt);
      if (d.restoreFlashTimer > 0) d.restoreFlashTimer = Math.max(0, d.restoreFlashTimer - dt);
      if (d.savedFlashTimer > 0) d.savedFlashTimer = Math.max(0, d.savedFlashTimer - dt);
    }

    for (const b of this.batteries) {
      if (b.cooldownTimer > 0) b.cooldownTimer = Math.max(0, b.cooldownTimer - dt);
      if (b.recoil > 0) b.recoil = Math.max(0, b.recoil - dt * 42);
      if (b.muzzleFlashTimer > 0) b.muzzleFlashTimer = Math.max(0, b.muzzleFlashTimer - dt);

      if (this.phase === 'ACTIVE_WAVE' && b.weaponType === 'M90_FLAK' && b.ammo < b.maxAmmo) {
        // Flow-state Autoloader Overclock: x4+ Chain gives +25% reload speed (-20% time); 2X Boost gives +18%!
        const reloadSpeedMult =
          this.liveChain >= 4 ? 1.25 : this.predictorBoostTimer > 0 ? 1.18 : 1.0;
        b.reloadProgress += (dt / b.reloadDuration) * reloadSpeedMult;
        if (b.reloadProgress >= 1) {
          b.reloadProgress -= 1;
          b.ammo = Math.min(b.maxAmmo, b.ammo + 1);
          if (b.ammo >= b.maxAmmo) b.reloadProgress = 0;
          this.audioCb.onBatteryReload(b.x / FLAK_CONSTANTS.VIRTUAL_W);
        }
      }
    }

    // Update particles, popups, and WebGL CRT shockwave ripples regardless of sub-phase
    this.stepVisualEffects(dt);

    if (this.phase === 'ACTIVE_WAVE') {
      this.stepActiveWave(dt);
    } else if (this.phase === 'WAVE_AUDIT') {
      this.stepWaveAudit(dt);
    }
  }

  private stepVisualEffects(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 48 * dt;
      p.vx *= 1 - dt * 1.1;
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pop = this.popups[i];
      pop.age += dt;
      pop.y -= 28 * dt;
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

  private stepActiveWave(dt: number): void {
    this.waveElapsedSec += dt;
    if (this.predictorBoostTimer > 0) {
      this.predictorBoostTimer = Math.max(0, this.predictorBoostTimer - dt);
    }

    // 1. Drain deterministic wave spawn queue
    while (this.spawnQueue.length > 0 && this.spawnQueue[0].delaySec <= this.waveElapsedSec) {
      const ev = this.spawnQueue.shift()!;
      this.spawnThreatFromEvent(ev);
    }

    // 1b. Step Every-5-Rounds Orbital Siege Dreadnought Boss Event!
    if (this.boss) {
      this.stepOrbitalBoss(dt);
    }

    // 2. Advance outgoing interceptor shells & detonate at target coordinate
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      const stepDist = s.speed * dt;
      if (stepDist >= s.distRemaining) {
        this.detonateShell(s);
        this.shells.splice(i, 1);
      } else {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.distRemaining -= stepDist;
        s.trail.push({ x: s.x, y: s.y });
        if (s.trail.length > 14) s.trail.shift();
      }
    }

    // 3. Expand physical shockwave blasts & apply vaporization / billiard-ball deflection physics!
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.age += dt;
      const p = Math.min(1, b.age / b.duration);
      // Fast front shockwave expansion, brief luminous hold
      b.currentRadius = b.maxRadius * Math.pow(Math.min(1, p * 1.38), 0.42);

      // Only apply active shockwave pressure during first 72% of blast lifetime
      if (p <= 0.72) {
        this.applyBlastPhysics(b);
      }

      if (b.age >= b.duration) {
        if (b.killCount > 0 || b.deflectionCount > 0) {
          this.shotsHit++;
        } else if (this.liveChain > 1) {
          // Whiffing an entire shot resets active sequential chain (precision risk-reward!)
          this.liveChain = 1;
          this.liveChainDecayTimer = 0;
        }
        this.blasts.splice(i, 1);
      }
    }

    // 4. Advance curved orbital threats, MIRV splitting, billiard collisions, and horizon impacts
    for (let i = this.threats.length - 1; i >= 0; i--) {
      const t = this.threats[i];
      t.age += dt;
      if (t.hitFlashTimer > 0) t.hitFlashTimer = Math.max(0, t.hitFlashTimer - dt);
      if (t.deflectedTimer > 0) t.deflectedTimer = Math.max(0, t.deflectedTimer - dt);

      const g = FLAK_CONSTANTS.GRAVITY * t.gravityScale;
      t.vx += t.orbitalDriftAx * dt;
      t.vy += g * dt;
      t.x += t.vx * dt;
      t.y += t.vy * dt;

      if (t.kind === 'HEAVY_METEOR') {
        t.angle += t.angVel * dt;
      } else {
        t.angle = Math.atan2(t.vy, t.vx);
      }

      t.trail.push({ x: t.x, y: t.y });
      const maxTrail = t.y >= FLAK_CONSTANTS.DANGER_CLOSE_Y ? 26 : 16;
      while (t.trail.length > maxTrail) t.trail.shift();

      // Recompute live dotted ballistic prediction arc smoothly
      this.recomputeBallisticPrediction(t);

      // Urgent collision alarm when a dome-locked contact plunges into Danger Close!
      if (t.lockedDomeId && t.y >= FLAK_CONSTANTS.DANGER_CLOSE_Y) {
        this.audioCb.onDomeLockAlarm(t.x / FLAK_CONSTANTS.VIRTUAL_W);
      }

      // MIRV Bio-Pod splits into 3–4 fast sub-munitions when crossing MIRV_SPLIT_Y (unless EMP scrambled!)
      if (
        t.kind === 'MIRV_POD' &&
        !t.hasSplit &&
        !t.empScrambled &&
        t.y >= FLAK_CONSTANTS.MIRV_SPLIT_Y
      ) {
        this.splitMirvPod(t);
        this.threats.splice(i, 1);
        continue;
      }

      // Discard threats violently deflected completely out of orbital bounds (score deflection save!)
      if (t.x < -140 || t.x > FLAK_CONSTANTS.VIRTUAL_W + 140 || t.y < -180) {
        if (t.deflectedTimer > 0) {
          this.awardDeflectionEscapeBonus(t);
        }
        this.threats.splice(i, 1);
        continue;
      }

      // Check LV-426 horizon / Colony Dome impact
      if (t.y >= FLAK_CONSTANTS.HORIZON_Y - 4) {
        this.handleHorizonImpact(t);
        this.threats.splice(i, 1);
      }
    }

    // 5. Check Billiard-Ball Meteor-vs-Threat Deflection Kill Collisions!
    this.resolveMeteorDeflectionCollisions();

    // 6. Check Game Over (all 4 Colony Domes breached — hard-locked off during Tactical Demo Mode!)
    if (!this.isDemoMode && this.getIntactDomeCount() <= 0) {
      this.phase = 'GAME_OVER';
      this.gameOverLockoutTimer = FLAK_CONSTANTS.GAME_OVER_LOCKOUT_SEC;
      this.spawnQueue = [];
      this.pushLog('CRITICAL // ALL FOUR COLONY DOMES BREACHED. ATMOSPHERIC LOSS.', 'red');
      this.audioCb.onSyncGlitch(0.95);
      return;
    }

    // 7. Check Wave Cleared -> enter End-of-Wave Audit once boss & final blast finish (skipped in Demo Mode)
    if (
      !this.isDemoMode &&
      this.spawnQueue.length === 0 &&
      this.threats.length === 0 &&
      this.shells.length === 0 &&
      this.blasts.length === 0 &&
      this.boss === null
    ) {
      this.beginWaveAudit();
    }
  }

  private stepOrbitalBoss(dt: number): void {
    const boss = this.boss;
    if (!boss) return;

    boss.age += dt;
    if (boss.hitFlashTimer > 0) boss.hitFlashTimer = Math.max(0, boss.hitFlashTimer - dt);
    if (boss.empStunTimer > 0) boss.empStunTimer = Math.max(0, boss.empStunTimer - dt);
    for (const hp of boss.hardpoints) {
      if (hp.hitFlashTimer > 0) hp.hitFlashTimer = Math.max(0, hp.hitFlashTimer - dt);
    }

    // Cascading multi-stage destruction sequence!
    if (boss.dyingTimer > 0) {
      boss.dyingTimer -= dt;
      boss.y += dt * 28;
      const stageTarget = boss.dyingTimer < 0.9 ? (boss.dyingTimer < 0.45 ? 3 : 2) : 1;
      if (stageTarget > boss.deathBlastStage) {
        boss.deathBlastStage = stageTarget;
        const bx = boss.x + (stageTarget === 1 ? -110 : stageTarget === 2 ? 110 : 0);
        const by = boss.y + (stageTarget === 3 ? 0 : 12);
        this.spawnSparks(bx, by, '#FFF6CC', stageTarget === 3 ? 46 : 24);
        this.pushCrtShockwave(bx, by, stageTarget === 3 ? 0.42 : 0.22, stageTarget === 3 ? 0.95 : 0.48, 0.72);
        this.screenShake = Math.max(this.screenShake, stageTarget === 3 ? 13 : 7);
      }

      if (boss.dyingTimer <= 0) {
        const reward = Math.round(5000 * boss.tier * this.getBaseScoreMultiplier());
        this.score += reward;
        this.totalKills++;
        const mins = Math.floor(this.missionElapsedSec / 60);
        const secs = Math.floor(this.missionElapsedSec % 60);
        this.killLogs.push({
          seq: this.totalKills,
          timestamp: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
          unitCode: `DRD-M${boss.tier}`,
          coordX: Math.round(boss.x),
          altKm: Math.max(10, Math.round(((FLAK_CONSTANTS.HORIZON_Y - boss.y) / FLAK_CONSTANTS.HORIZON_Y) * 98)),
          methodTag: 'BOSS!',
          tone: 'amber',
        });
        if (this.killLogs.length > 32) this.killLogs.shift();

        this.popups.push({
          x: boss.x,
          y: boss.y,
          text: `+${reward.toLocaleString()} // DREADNOUGHT DESTROYED`,
          subText: `${boss.designation} NEUTRALIZED`,
          color: '#FFF6CC',
          age: 0,
          duration: 2.6,
        });
        this.pushLog(
          `CONFIRMED // ${boss.designation} DESTROYED! (+${reward.toLocaleString()} PTS)`,
          'bright'
        );
        this.boss = null;
      }
      return;
    }

    // 1. Descend smoothly into firing envelope
    if (boss.y < boss.targetY) {
      boss.y = Math.min(boss.targetY, boss.y + dt * 118);
    } else {
      boss.y = boss.targetY + Math.sin(boss.age * 1.45) * 18;
    }

    // 2. Patrol smoothly horizontally across upper-mid radar arc (slowed if EMP stunned)
    const moveScale = boss.empStunTimer > 0 ? 0.25 : 1.0;
    boss.x += boss.vx * moveScale * dt;
    const minX = 290;
    const maxX = FLAK_CONSTANTS.VIRTUAL_W - 290;
    if (boss.x < minX) {
      boss.x = minX;
      boss.vx = Math.abs(boss.vx);
    } else if (boss.x > maxX) {
      boss.x = maxX;
      boss.vx = -Math.abs(boss.vx);
    }

    if (boss.y < boss.targetY - 24) return;
    if (boss.empStunTimer > 0) {
      boss.chargeTimer = 0;
      boss.targetDomeIds = [];
      return;
    }

    // 3. Telegraph & fire coordinated Orbital Bombardment Salvos at intact Colony Domes!
    if (boss.chargeTimer > 0) {
      boss.chargeTimer -= dt;
      if (boss.chargeTimer <= 0) {
        this.fireBossSalvo(boss);
        const intactFlanks = boss.hardpoints.filter((h) => h.id !== 'CORE' && !h.destroyed).length;
        const baseCd = Math.max(2.6, 4.35 - (boss.tier - 1) * 0.42);
        // Slightly faster panic salvo cadence once flank railguns are torn off!
        boss.salvoCooldown = intactFlanks === 0 ? baseCd * 0.82 : baseCd;
        boss.targetDomeIds = [];
      }
    } else {
      boss.salvoCooldown -= dt;
      if (boss.salvoCooldown <= 0) {
        const intactDomes = this.domes.filter((d) => d.intact);
        if (intactDomes.length > 0) {
          boss.chargeTimer = boss.chargeDuration;
          const picks = Math.min(intactDomes.length, 2 + (boss.tier >= 2 ? 1 : 0));
          boss.targetDomeIds = [];
          for (let k = 0; k < picks; k++) {
            const idx = Math.floor((boss.age * 13 + k * 2) % intactDomes.length);
            const id = intactDomes[idx].id;
            if (!boss.targetDomeIds.includes(id)) boss.targetDomeIds.push(id);
          }
          this.audioCb.onDomeLockAlarm(boss.x / FLAK_CONSTANTS.VIRTUAL_W);
        }
      }
    }
  }

  private fireBossSalvo(boss: OrbitalBoss): void {
    const intactDomes = this.domes.filter((d) => d.intact);
    if (intactDomes.length === 0) return;

    this.audioCb.onBossSalvo(boss.x / FLAK_CONSTANTS.VIRTUAL_W);
    this.screenShake = Math.max(this.screenShake, 4.5);

    const activeHardpoints = boss.hardpoints.filter((h) => !h.destroyed);
    const emitters = activeHardpoints.length > 0 ? activeHardpoints : [boss.hardpoints[1]];
    const speedFactor = 1 + Math.min(1.4, (this.waveNumber - 1) * 0.1);

    emitters.forEach((hp, idx) => {
      const originX = boss.x + hp.offsetX;
      const originY = boss.y + hp.offsetY + 14;
      const dome = intactDomes[(idx + Math.floor(boss.age)) % intactDomes.length];
      const targetX = dome.x + (Math.random() - 0.5) * 32;

      // Center core fires Heavy Meteors / MIRVs; flank rails fire fast curved Kinetic Rods!
      let kind: ThreatKind = 'KINETIC_ROD';
      if (hp.id === 'CORE') {
        kind = boss.tier >= 2 && Math.floor(boss.age) % 2 === 0 ? 'MIRV_POD' : 'HEAVY_METEOR';
      }

      const T =
        kind === 'KINETIC_ROD'
          ? Math.max(2.7, 5.0 / speedFactor)
          : kind === 'HEAVY_METEOR'
            ? Math.max(4.4, 7.6 / speedFactor)
            : Math.max(4.8, 8.2 / speedFactor);

      const gravScale = kind === 'KINETIC_ROD' ? 1.18 : kind === 'HEAVY_METEOR' ? 0.92 : 0.65;
      const g = FLAK_CONSTANTS.GRAVITY * gravScale;
      const driftAx = (hp.offsetX < 0 ? -1 : hp.offsetX > 0 ? 1 : idx % 2 === 0 ? -1 : 1) * (20 + boss.tier * 6);
      const hy = FLAK_CONSTANTS.HORIZON_Y;
      const vx = (targetX - originX - 0.5 * driftAx * T * T) / T;
      const vy = Math.max(36, (hy - originY - 0.5 * g * T * T) / T);

      const polyRadii: number[] = [];
      if (kind === 'HEAVY_METEOR') {
        for (let k = 0; k < 8; k++) polyRadii.push(0.76 + ((k * 37) % 10) * 0.04);
      }

      const threat: OrbitalThreat = {
        id: this.nextEntityId++,
        kind,
        x: originX,
        y: originY,
        vx,
        vy,
        orbitalDriftAx: driftAx,
        gravityScale: gravScale,
        radius: kind === 'HEAVY_METEOR' ? 23 : kind === 'MIRV_POD' ? 18 : 10,
        mass: kind === 'HEAVY_METEOR' ? 2.15 : 1.0,
        hp: kind === 'HEAVY_METEOR' ? 2 + Math.min(2, boss.tier - 1) : 1,
        maxHp: kind === 'HEAVY_METEOR' ? 2 + Math.min(2, boss.tier - 1) : 1,
        angle: Math.atan2(vy, vx),
        angVel: kind === 'HEAVY_METEOR' ? 1.4 : 0,
        polyRadii,
        trail: [{ x: originX, y: originY }],
        hasSplit: false,
        empScrambled: false,
        jamRadius: 0,
        deflectedTimer: 0,
        deflectedByBlastId: null,
        deflectionSaveAwarded: false,
        wasTargetingDomeId: null,
        predictedArc: [],
        predictedImpactX: targetX,
        predictedImpactY: hy,
        lockedDomeId: null,
        hitFlashTimer: 0,
        age: 0,
      };
      this.recomputeBallisticPrediction(threat);
      threat.wasTargetingDomeId = threat.lockedDomeId;
      this.threats.push(threat);
      this.spawnSparks(originX, originY, '#FFB000', 8);
    });
  }

  private detonateShell(shell: InterceptorShell): void {
    const coreRadius = shell.isEmp
      ? FLAK_CONSTANTS.EMP_CORE_RADIUS
      : FLAK_CONSTANTS.FLAK_CORE_RADIUS;
    const maxRadius = shell.isEmp
      ? FLAK_CONSTANTS.EMP_BLAST_RADIUS
      : FLAK_CONSTANTS.FLAK_BLAST_RADIUS;
    const impulseForce = shell.isEmp
      ? FLAK_CONSTANTS.EMP_IMPULSE_FORCE
      : FLAK_CONSTANTS.FLAK_IMPULSE_FORCE;
    const duration = shell.isEmp
      ? FLAK_CONSTANTS.EMP_BLAST_DURATION
      : FLAK_CONSTANTS.FLAK_BLAST_DURATION;

    this.blasts.push({
      id: this.nextEntityId++,
      x: shell.targetX,
      y: shell.targetY,
      isEmp: shell.isEmp,
      age: 0,
      duration,
      currentRadius: coreRadius * 0.45,
      coreRadius,
      maxRadius,
      impulseForce,
      hitThreatIds: new Set<number>(),
      killCount: 0,
      deflectionCount: 0,
      hadDangerCloseKill: false,
    });

    // Trigger WebGL CRT Shockwave Ripple (heavy bulge for EMP Mortar, subtle crisp pulse for Flak!)
    if (shell.isEmp) {
      this.pushCrtShockwave(shell.targetX, shell.targetY, 0.34, 0.92, 0.72);
      this.screenShake = Math.max(this.screenShake, 9.5);
    } else {
      this.pushCrtShockwave(shell.targetX, shell.targetY, 0.14, 0.24, 0.36);
      this.screenShake = Math.max(this.screenShake, 3.2);
    }

    // Burst phosphor shrapnel sparks
    const sparkCount = shell.isEmp ? 28 : 16;
    for (let k = 0; k < sparkCount; k++) {
      const a = (k / sparkCount) * Math.PI * 2 + Math.random() * 0.25;
      const spd = (shell.isEmp ? 160 : 120) + Math.random() * 240;
      this.particles.push({
        x: shell.targetX,
        y: shell.targetY,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        life: 0.35 + Math.random() * 0.35,
        maxLife: 0.7,
        color: shell.isEmp
          ? k % 2 === 0
            ? '#8EF5AB'
            : '#FFF6CC'
          : k % 3 === 0
            ? '#FFF6CC'
            : '#FFB000',
        size: shell.isEmp ? 3.2 : 2.4,
      });
    }

    // Speed-of-sound blast delay audio: altitudeNorm = 1 at top of sky, 0 at horizon
    const xNorm = shell.targetX / FLAK_CONSTANTS.VIRTUAL_W;
    const altitudeNorm = Math.max(
      0,
      Math.min(1, 1 - shell.targetY / Math.max(1, FLAK_CONSTANTS.HORIZON_Y))
    );
    if (shell.isEmp) {
      this.audioCb.onDetonateEmp(xNorm, altitudeNorm);
    } else {
      this.audioCb.onDetonateAirburst(xNorm, altitudeNorm);
    }
  }

  private applyBlastPhysics(blast: ShockwaveBlast): void {
    // 0. Check direct flak / EMP shockwave hits against active Orbital Siege Dreadnought Boss!
    if (this.boss && this.boss.dyingTimer <= 0) {
      const boss = this.boss;
      for (const hp of boss.hardpoints) {
        if (hp.destroyed) continue;
        const hitKey = -(boss.id * 10 + (hp.id === 'PORT' ? 1 : hp.id === 'CORE' ? 2 : 3));
        if (blast.hitThreatIds.has(hitKey)) continue;
        const hpx = boss.x + hp.offsetX;
        const hpy = boss.y + hp.offsetY;
        const dist = Math.hypot(hpx - blast.x, hpy - blast.y);
        if (dist > blast.currentRadius + hp.radius) continue;

        blast.hitThreatIds.add(hitKey);
        blast.killCount++;

        const flanksRemaining = boss.hardpoints.some((h) => h.id !== 'CORE' && !h.destroyed);
        const inCore = dist <= blast.coreRadius + hp.radius * 0.65;
        let dmg = blast.isEmp ? 3 : inCore ? 2 : 1;
        // Core armor resists half damage until at least one flank railgun is breached (unless EMP!)
        if (hp.id === 'CORE' && flanksRemaining && !blast.isEmp) {
          dmg = Math.max(1, Math.floor(dmg * 0.6));
        }

        hp.hp = Math.max(0, hp.hp - dmg);
        hp.hitFlashTimer = 0.28;
        boss.hitFlashTimer = 0.22;
        if (blast.isEmp) {
          boss.empStunTimer = Math.max(boss.empStunTimer, 2.4);
          boss.chargeTimer = 0;
          boss.targetDomeIds = [];
        }

        boss.hp = boss.hardpoints.reduce((sum, node) => sum + Math.max(0, node.hp), 0);

        if (hp.hp <= 0) {
          hp.destroyed = true;
          const hpBonus = Math.round((hp.id === 'CORE' ? 2200 : 1400) * this.getBaseScoreMultiplier());
          this.score += hpBonus;
          this.spawnSparks(hpx, hpy, '#FFF6CC', 30);
          this.pushCrtShockwave(hpx, hpy, 0.24, 0.62, 0.55);
          this.screenShake = Math.max(this.screenShake, 7.5);
          this.audioCb.onBossHullHit(hpx / FLAK_CONSTANTS.VIRTUAL_W, true);
          this.popups.push({
            x: hpx,
            y: hpy - 18,
            text: `+${hpBonus.toLocaleString()} // ${hp.label} SHATTERED`,
            color: '#FFF6CC',
            age: 0,
            duration: 1.65,
          });
          this.pushLog(`BOSS HARDPOINT DESTROYED: ${hp.label} (+${hpBonus})`, 'amber');
        } else {
          this.spawnSparks(hpx, hpy, blast.isEmp ? '#8EF5AB' : '#FFB000', 10);
          this.audioCb.onBossHullHit(hpx / FLAK_CONSTANTS.VIRTUAL_W, false);
          this.popups.push({
            x: hpx,
            y: hpy - 12,
            text: blast.isEmp ? `EMP STUN -${dmg}` : `HULL HIT -${dmg}`,
            color: blast.isEmp ? '#8EF5AB' : '#FFB000',
            age: 0,
            duration: 0.75,
          });
        }

        if (boss.hp <= 0 && boss.dyingTimer <= 0) {
          boss.dyingTimer = 1.35;
          boss.deathBlastStage = 0;
          boss.chargeTimer = 0;
          boss.targetDomeIds = [];
          this.audioCb.onBossDestroyed(boss.x / FLAK_CONSTANTS.VIRTUAL_W);
          this.audioCb.onSyncGlitch(0.68);
          break;
        }
      }
    }

    for (let i = this.threats.length - 1; i >= 0; i--) {
      const t = this.threats[i];
      if (blast.hitThreatIds.has(t.id)) continue;

      const dx = t.x - blast.x;
      const dy = t.y - blast.y;
      const dist = Math.hypot(dx, dy);
      if (dist > blast.currentRadius + t.radius) continue;

      blast.hitThreatIds.add(t.id);

      // HEAVY ARMORED METEOR: Physical Billiard-Ball Shockwave Deflection OR Core Vaporization!
      if (t.kind === 'HEAVY_METEOR') {
        const inCore = blast.isEmp
          ? dist <= blast.coreRadius + 5
          : dist <= blast.coreRadius + t.radius * 0.45;
        const dmg = inCore ? (blast.isEmp ? 4 : 2) : 1;
        t.hp -= dmg;
        t.hitFlashTimer = 0.24;

        if (t.hp <= 0) {
          this.destroyThreat(t, i, blast, false);
        } else {
          // Real radial pressure impulse shoving the Heavy Meteor violently off course!
          const nx = dist > 0.001 ? dx / dist : Math.random() < 0.5 ? -1 : 1;
          const ny = dist > 0.001 ? dy / dist : -0.7;
          const radialFalloff = Math.max(
            0.48,
            1 - (dist / Math.max(1, blast.maxRadius)) * 0.44
          );
          const dv = (blast.impulseForce / t.mass) * radialFalloff;

          // Strong lateral kick so side-detonation billiard deflections sling cleanly across the sky!
          t.vx += nx * dv * 1.45;
          t.vy += ny * dv * 0.85 - 48;
          t.angVel += (nx >= 0 ? 1 : -1) * 4.4;
          t.deflectedTimer = 4.2;
          t.deflectedByBlastId = blast.id;
          blast.deflectionCount++;

          const prevLockedDome = t.lockedDomeId ?? t.wasTargetingDomeId;
          this.recomputeBallisticPrediction(t);

          this.audioCb.onDeflectionClank(t.x / FLAK_CONSTANTS.VIRTUAL_W, false);
          this.spawnSparks(t.x, t.y, '#FFB000', 14);

          // Did the player's physical deflection just shove a meteor away from an intact Colony Dome?
          if (prevLockedDome && !t.lockedDomeId && !t.deflectionSaveAwarded) {
            t.deflectionSaveAwarded = true;
            const chain = this.advanceChainLadder(1);
            const savePts = Math.round(450 * chain * this.getBaseScoreMultiplier());
            this.score += savePts;
            const dome = this.domes.find((d) => d.id === prevLockedDome);
            if (dome) dome.savedFlashTimer = 1.4;
            this.popups.push({
              x: t.x,
              y: t.y - 24,
              text: `+${savePts.toLocaleString()} // DEFLECTED`,
              subText: `${prevLockedDome} SAVED · x${chain} CHAIN`,
              color: '#8EF5AB',
              age: 0,
              duration: 1.5,
            });
            this.pushLog(`SHOCKWAVE DEFLECTION — ${prevLockedDome} SPARED (+${savePts.toLocaleString()})!`, 'bright');
            this.audioCb.onHarmonicCombo(chain, false, t.x / FLAK_CONSTANTS.VIRTUAL_W);
          } else {
            this.popups.push({
              x: t.x,
              y: t.y - 18,
              text: 'DEFLECTED!',
              color: '#FFB000',
              age: 0,
              duration: 0.95,
            });
          }
        }
        continue;
      }

      // MIRV BIO-POD: EMP scrambles warheads + vaporizes cleanly
      if (t.kind === 'MIRV_POD' && blast.isEmp) {
        t.empScrambled = true;
        this.pushLog('EMP SCRAMBLED MIRV BIO-POD PRIOR TO SEPARATION!', 'bright');
      }

      // Light threats vaporize immediately inside blast radius
      this.destroyThreat(t, i, blast, false);
    }
  }

  private resolveMeteorDeflectionCollisions(): void {
    // Check deflected Heavy Armored Meteors slamming into adjacent threats (billiard deflection kill!)
    for (let i = this.threats.length - 1; i >= 0; i--) {
      const meteor = this.threats[i];
      if (!meteor || meteor.kind !== 'HEAVY_METEOR' || meteor.deflectedTimer <= 0) continue;

      for (let j = this.threats.length - 1; j >= 0; j--) {
        if (i === j) continue;
        const other = this.threats[j];
        if (!other) continue;
        const dist = Math.hypot(meteor.x - other.x, meteor.y - other.y);
        if (dist <= meteor.radius + other.radius + 18) {
          // BILLIARD DEFLECTION KILL!
          this.deflectionKills++;
          const midX = (meteor.x + other.x) * 0.5;
          const midY = (meteor.y + other.y) * 0.5;
          this.spawnSparks(midX, midY, '#FFF6CC', 24);
          this.pushCrtShockwave(midX, midY, 0.2, 0.45, 0.45);
          this.audioCb.onDeflectionClank(midX / FLAK_CONSTANTS.VIRTUAL_W, true);

          // Advance sequential live chain multiplier (+2 ladder steps!) & trigger Predictor Boost!
          const chain = this.advanceChainLadder(2);

          const isDangerClose = midY >= FLAK_CONSTANTS.DANGER_CLOSE_Y;
          const dcMult = isDangerClose ? 3 : 1;
          const pts = Math.round(600 * chain * dcMult * this.getBaseScoreMultiplier());
          this.score += pts;
          this.totalKills++;
          this.pushKillLog(other, `DFL-x${chain}`, 'bright');

          this.popups.push({
            x: midX,
            y: midY - 12,
            text: `+${pts.toLocaleString()} // DEFLECTION KILL`,
            subText: `x${chain} CHAIN${isDangerClose ? ' // DANGER CLOSE 3X' : ''}`,
            color: '#FFF6CC',
            age: 0,
            duration: 1.8,
          });
          this.pushLog(
            `SHOCKWAVE BILLIARD DEFLECTION KILL x${chain} (+${pts.toLocaleString()})`,
            'amber'
          );
          this.audioCb.onHarmonicCombo(
            chain,
            isDangerClose,
            midX / FLAK_CONSTANTS.VIRTUAL_W
          );

          // Active EMP Recharge reward for landing a skilled billiard Deflection Kill!
          this.tryRechargeEmpShell('DEFLECTION KILL', midX, midY);

          // Remove struck target (deflected meteor plows cleanly through light threats without losing HP!)
          const otherWasHeavy = other.kind === 'HEAVY_METEOR';
          this.threats.splice(j, 1);
          if (j < i) i--;
          if (otherWasHeavy) {
            this.totalKills++;
            this.pushKillLog(meteor, 'CRUSH', 'amber');
            this.threats.splice(i, 1);
            break;
          }
        }
      }
    }
  }

  private destroyThreat(
    t: OrbitalThreat,
    index: number,
    blast: ShockwaveBlast,
    isDeflectionKill: boolean
  ): void {
    this.threats.splice(index, 1);
    this.totalKills++;
    blast.killCount++;

    const isDangerClose = t.y >= FLAK_CONSTANTS.DANGER_CLOSE_Y;
    if (isDangerClose) {
      this.dangerCloseKills++;
      blast.hadDangerCloseKill = true;
      this.dangerCloseRechargeProgress++;
      if (this.dangerCloseRechargeProgress >= 3) {
        this.dangerCloseRechargeProgress = 0;
        this.tryRechargeEmpShell('3X DANGER CLOSE', t.x, t.y);
      }
    }

    // True Sequential LIVE CHAIN Multiplier:
    // First single kill starts/holds x1 with a 3.2s window; every subsequent kill within 3.2s
    // (or multi-kill / Danger Close / Deflection) steps up the ladder: 1x -> 2x -> 3x -> 4x -> 6x -> 8x -> 12x -> 16x!
    const hadActiveWindow = this.liveChainDecayTimer > 0;
    const bonusJump = blast.killCount >= 2 || isDeflectionKill;
    let effectiveChain = this.liveChain;
    if (hadActiveWindow || bonusJump) {
      const steps = blast.killCount >= 3 ? 2 : bonusJump || isDangerClose ? 2 : 1;
      effectiveChain = this.advanceChainLadder(steps);
    } else {
      // Arm sequential chain timer on first kill (Danger Close immediately kicks off x2!)
      if (isDangerClose) {
        effectiveChain = this.advanceChainLadder(1);
      } else {
        this.liveChain = 1;
        this.liveChainDecayTimer = 3.2;
        effectiveChain = 1;
      }
    }

    const basePts =
      t.kind === 'HEAVY_METEOR'
        ? 350
        : t.kind === 'MIRV_POD'
          ? 400
          : t.kind === 'ION_JAMMER'
            ? 320
            : t.isSubMunition
              ? 150
              : 180;

    const dcMult = isDangerClose ? 3 : 1;
    const awarded = Math.round(basePts * effectiveChain * dcMult * this.getBaseScoreMultiplier());
    this.score += awarded;

    const killMethod = isDangerClose
      ? '3X-DC'
      : blast.isEmp
        ? 'EMP!'
        : effectiveChain >= 2
          ? `CH-x${effectiveChain}`
          : 'FLAK';
    const killTone =
      isDangerClose ? 'amber' : blast.isEmp || effectiveChain >= 2 ? 'bright' : 'green';
    this.pushKillLog(t, killMethod, killTone);

    const sparkCol =
      isDangerClose || effectiveChain >= 2
        ? '#FFF6CC'
        : t.kind === 'ION_JAMMER'
          ? '#8EF5AB'
          : '#FFB000';
    this.spawnSparks(t.x, t.y, sparkCol, t.kind === 'HEAVY_METEOR' ? 22 : 13);

    const tags: string[] = [];
    if (effectiveChain >= 2) tags.push(`x${effectiveChain} CHAIN`);
    if (isDangerClose) tags.push('DANGER CLOSE 3X');

    this.popups.push({
      x: t.x,
      y: t.y - 10,
      text: `+${awarded.toLocaleString()}`,
      subText: tags.length > 0 ? tags.join(' // ') : undefined,
      color: isDangerClose || effectiveChain >= 4 ? '#FFF6CC' : '#FFB000',
      age: 0,
      duration: tags.length > 0 ? 1.55 : 0.95,
    });

    // Rising harmonic pentatonic chime on chains OR Danger Close intercepts!
    if (effectiveChain >= 2 || isDangerClose) {
      this.audioCb.onHarmonicCombo(
        effectiveChain,
        isDangerClose,
        t.x / FLAK_CONSTANTS.VIRTUAL_W
      );
    }

    if (isDangerClose && t.lockedDomeId) {
      const dome = this.domes.find((d) => d.id === t.lockedDomeId);
      if (dome) dome.savedFlashTimer = 1.1;
      this.pushLog(`DANGER CLOSE INTERCEPT — ${t.lockedDomeId} SAVED (+${awarded.toLocaleString()})`, 'amber');
    } else if (effectiveChain >= 4) {
      this.pushLog(
        `${blast.isEmp ? 'EMP ' : ''}MULTI-INTERCEPT x${effectiveChain} CHAIN (+${awarded.toLocaleString()})`,
        'bright'
      );
    } else if (t.kind === 'ION_JAMMER') {
      this.pushLog('ION JAMMER NEUTRALIZED — BALLISTIC RADAR LOCK RESTORED.', 'green');
    }
  }

  private grantPredictorBoost(chainMult: number): void {
    const wasOff = this.predictorBoostTimer <= 0.05;
    const baseAward = chainMult >= 4 ? 12.0 : 10.0;
    this.predictorBoostTimer = wasOff
      ? baseAward
      : Math.min(this.predictorBoostMaxSec, Math.max(this.predictorBoostTimer + 5.0, baseAward));

    if (wasOff) {
      this.pushLog(
        `x${chainMult} CHAIN REWARD // BALLISTIC PATH & LEAD PREDICTOR ONLINE (${baseAward.toFixed(0)}S)!`,
        'bright'
      );
    }
  }

  private awardDeflectionEscapeBonus(t: OrbitalThreat): void {
    const pts = Math.round((t.kind === 'HEAVY_METEOR' ? 350 : 250) * this.getBaseScoreMultiplier());
    this.score += pts;
    this.totalKills++;
    this.pushKillLog(t, 'FLUNG', 'bright');
    this.pushLog(`ORBITAL METEOR FLUNG OUT OF SECTOR (+${pts})`, 'bright');
  }

  private splitMirvPod(pod: OrbitalThreat): void {
    pod.hasSplit = true;
    const subCount: number = this.waveNumber >= 5 ? 4 : 3;
    const intactDomes = this.domes.filter((d) => d.intact);
    const rng = mulberry32(pod.id * 9973 + this.waveNumber * 313);

    this.spawnSparks(pod.x, pod.y, '#FFB000', 18);
    this.pushLog(`ALERT // MIRV BIO-POD SEPARATED INTO ${subCount} WARHEADS!`, 'red');
    this.audioCb.onMirvSplitWarning(pod.x / FLAK_CONSTANTS.VIRTUAL_W);

    for (let k = 0; k < subCount; k++) {
      const spreadFrac = k / Math.max(1, subCount - 1) - 0.5;
      const targetDome =
        intactDomes.length > 0
          ? intactDomes[(k + pod.id) % intactDomes.length]
          : null;
      const targetX = targetDome
        ? targetDome.x + spreadFrac * 180 + (rng() - 0.5) * 40
        : pod.x + spreadFrac * 420;
      const flightSec = 3.2 + rng() * 1.1;
      const g = FLAK_CONSTANTS.GRAVITY * 1.25;
      const ax = spreadFrac * 24;
      const vx = (targetX - pod.x - 0.5 * ax * flightSec * flightSec) / flightSec;
      const vy = Math.max(
        75,
        (FLAK_CONSTANTS.HORIZON_Y - pod.y - 0.5 * g * flightSec * flightSec) / flightSec
      );

      const sub: OrbitalThreat = {
        id: this.nextEntityId++,
        kind: 'KINETIC_ROD',
        x: pod.x + spreadFrac * 18,
        y: pod.y,
        vx,
        vy,
        orbitalDriftAx: ax,
        gravityScale: 1.25,
        radius: 9,
        mass: 0.85,
        hp: 1,
        maxHp: 1,
        angle: Math.atan2(vy, vx),
        angVel: 0,
        polyRadii: [],
        trail: [{ x: pod.x, y: pod.y }],
        hasSplit: true,
        empScrambled: false,
        jamRadius: 0,
        deflectedTimer: 0,
        deflectedByBlastId: null,
        deflectionSaveAwarded: false,
        wasTargetingDomeId: null,
        predictedArc: [],
        predictedImpactX: targetX,
        predictedImpactY: FLAK_CONSTANTS.HORIZON_Y,
        lockedDomeId: null,
        hitFlashTimer: 0,
        age: 0,
        isSubMunition: true,
      };
      this.recomputeBallisticPrediction(sub);
      sub.wasTargetingDomeId = sub.lockedDomeId;
      this.threats.push(sub);
    }
  }

  private handleHorizonImpact(t: OrbitalThreat): void {
    const impactX = Math.max(10, Math.min(FLAK_CONSTANTS.VIRTUAL_W - 10, t.x));
    const impactY = FLAK_CONSTANTS.HORIZON_Y;

    // Check if an intact Colony Dome took the hit!
    let hitDome: ColonyDome | null = null;
    for (const d of this.domes) {
      if (!d.intact) continue;
      if (Math.abs(impactX - d.x) <= d.radius + t.radius + 14) {
        hitDome = d;
        break;
      }
    }

    if (hitDome) {
      hitDome.intact = false;
      hitDome.breachFlashTimer = 2.0;
      this.domeHitFlashTimer = 0.85;
      this.screenShake = 18;
      this.liveChain = 1;
      this.liveChainDecayTimer = 0;

      // Huge tactile WebGL CRT Shockwave Ripple centered on the breached dome!
      this.pushCrtShockwave(hitDome.x, hitDome.y - 16, 0.56, 1.0, 0.92);
      this.spawnSparks(hitDome.x, hitDome.y - 14, '#FF3318', 38);
      this.spawnSparks(hitDome.x, hitDome.y - 14, '#FFB000', 24);

      this.pushLog(`CRITICAL // ${hitDome.label} BREACHED BY ${t.kind.replace('_', ' ')}!`, 'red');
      this.audioCb.onDomeBreach(hitDome.x / FLAK_CONSTANTS.VIRTUAL_W);
      this.audioCb.onSyncGlitch(0.85);
    } else {
      // Harmless basalt surface impact
      this.spawnSparks(impactX, impactY - 4, '#FFB000', 12);
      this.screenShake = Math.max(this.screenShake, 4.5);
      this.pushCrtShockwave(impactX, impactY, 0.14, 0.32, 0.38);
      this.audioCb.onDetonateAirburst(impactX / FLAK_CONSTANTS.VIRTUAL_W, 0.04);
    }
  }

  // ===========================================================================
  // END-OF-WAVE AUDIT & EVERY-3-WAVES ORBITAL DROP-POD DOME RESTORATION
  // ===========================================================================
  private beginWaveAudit(): void {
    this.phase = 'WAVE_AUDIT';
    const survivingDomes = this.getIntactDomeCount();
    const empBat = this.batteries[1];
    const unusedEmpRounds = empBat ? empBat.ammo : 0;
    const baseMult = this.getBaseScoreMultiplier();
    const domeBonusPerUnit = Math.round((400 + this.waveNumber * 100) * baseMult);
    const empBonusPerUnit = Math.round(350 * baseMult);

    // Every 3 waves OR after defeating an Every-5-Rounds Boss, dispatch an Orbital Drop-Pod to restore 1 dome!
    let restoringLabel: string | null = null;
    if (this.waveNumber % 3 === 0 || this.waveNumber % 5 === 0) {
      const breached = this.domes.find((d) => !d.intact);
      if (breached) {
        restoringLabel = breached.label;
        this.dropPod = {
          x: breached.x + 220,
          y: -40,
          targetDomeId: breached.id,
          targetX: breached.x,
          targetY: breached.y - 12,
          progress: 0,
        };
      }
    }

    this.waveAudit = {
      completedWave: this.waveNumber,
      survivingDomes,
      unusedEmpRounds,
      domeBonusPerUnit,
      empBonusPerUnit,
      talliedDomes: 0,
      talliedEmp: 0,
      totalWaveBonus: 0,
      dropPodRestoringDomeLabel: restoringLabel,
      stepTimer: 0.45,
      completeHoldTimer: 1.55,
      done: false,
    };

    this.pushLog(
      `WAVE ${String(this.waveNumber).padStart(2, '0')} CLEARED // RUNNING ORDNANCE & HABITAT AUDIT...`,
      'bright'
    );
  }

  private stepWaveAudit(dt: number): void {
    const audit = this.waveAudit;
    if (!audit) return;

    // Animate orbital drop-pod descending smoothly onto breached dome
    if (this.dropPod) {
      this.dropPod.progress = Math.min(1, this.dropPod.progress + dt * 0.65);
      const u = this.dropPod.progress;
      const ease = 1 - Math.pow(1 - u, 3);
      this.dropPod.x = this.dropPod.targetX + (1 - ease) * 240;
      this.dropPod.y = -40 + ease * (this.dropPod.targetY + 40);
      if (this.dropPod.progress >= 1) {
        const dome = this.domes.find((d) => d.id === this.dropPod!.targetDomeId);
        if (dome && !dome.intact) {
          dome.intact = true;
          dome.restoreFlashTimer = 2.0;
          this.spawnSparks(dome.x, dome.y - 18, '#8EF5AB', 28);
          this.pushLog(`ORBITAL DROP-POD TOUCHDOWN — ${dome.label} PRESSURIZED & ONLINE!`, 'bright');
          this.audioCb.onDropPodRestore(dome.x / FLAK_CONSTANTS.VIRTUAL_W);
        }
        this.dropPod = null;
      }
    }

    if (!audit.done) {
      audit.stepTimer -= dt;
      if (audit.stepTimer <= 0) {
        if (audit.talliedDomes < audit.survivingDomes) {
          audit.talliedDomes++;
          audit.totalWaveBonus += audit.domeBonusPerUnit;
          this.score += audit.domeBonusPerUnit;
          this.audioCb.onTallyClick(audit.talliedDomes);
          audit.stepTimer = 0.22;
        } else if (audit.talliedEmp < audit.unusedEmpRounds) {
          audit.talliedEmp++;
          audit.totalWaveBonus += audit.empBonusPerUnit;
          this.score += audit.empBonusPerUnit;
          this.audioCb.onTallyClick(audit.survivingDomes + audit.talliedEmp);
          audit.stepTimer = 0.18;
        } else {
          audit.done = true;
        }
      }
    } else if (!this.dropPod) {
      audit.completeHoldTimer -= dt;
      if (audit.completeHoldTimer <= 0) {
        this.beginWave(this.waveNumber + 1);
      }
    }
  }

  private pushCrtShockwave(
    x: number,
    y: number,
    maxRadiusNorm: number,
    peakIntensity: number,
    duration: number
  ): void {
    this.crtShockwaves.push({
      x,
      y,
      age: 0,
      duration,
      maxRadiusNorm,
      peakIntensity,
    });
    if (this.crtShockwaves.length > 4) {
      this.crtShockwaves.shift();
    }
  }

  private spawnSparks(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 230;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 35,
        life: 0.28 + Math.random() * 0.42,
        maxLife: 0.7,
        color,
        size: 2 + Math.random() * 2,
      });
    }
  }
}
