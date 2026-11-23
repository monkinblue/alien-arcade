import type { Vec2 } from '../../types';
import type { FlakSimulation } from './FlakSimulation';
import { FLAK_CONSTANTS, type OrbitalThreat, type ThreatKind } from './types';

export type AiWeaponMode = 'FLAK' | 'EMP' | 'HOLD' | 'DEFLECT_AIM';

export interface DemoTelemetryState {
  active: boolean;
  stageIndex: number; // 1..5
  totalStages: number; // 5
  stageTitle: string;
  calloutText: string;
  stageElapsedSec: number;
  stageTargetSec: number;
  aiCursor: Vec2;
  aiWeaponMode: AiWeaponMode;
  aiLockedThreatId: number | null;
  stageMilestoneHit: boolean;
  milestoneBanner: string | null;
  completedLoopCount: number;
}

interface ScriptedDemoSpawn {
  delaySec: number;
  kind: ThreatKind;
  spawnX: number;
  targetX: number;
  flightSec: number;
  orbitalDriftAx?: number;
}

interface DemoStageMeta {
  stageIndex: number;
  stageWaveNumber: number;
  empAmmo: number;
  empMax: number;
  stageTitle: string;
  calloutText: string;
  maxDurationSec: number;
  spawns: ScriptedDemoSpawn[];
}

/**
 * Iterative curved-trajectory ballistic lead solver.
 * Accounts for shell speed, battery position, orbital gravity-well acceleration,
 * and Coriolis lateral drift to converge to sub-pixel intercept accuracy in 5 passes.
 */
export function solveCurvedIntercept(
  sim: FlakSimulation,
  threat: OrbitalThreat,
  isEmp: boolean,
  extraLeadSec = 0.035
): { x: number; y: number; tofSec: number } {
  const bat = isEmp
    ? sim.batteries[1]
    : sim.pickNearestReadyFlakBattery(threat.x) ??
      (Math.abs(threat.x - sim.batteries[0].x) <= Math.abs(threat.x - sim.batteries[2].x)
        ? sim.batteries[0]
        : sim.batteries[2]);

  const speed = isEmp ? FLAK_CONSTANTS.EMP_SHELL_SPEED : FLAK_CONSTANTS.FLAK_SHELL_SPEED;
  const g = FLAK_CONSTANTS.GRAVITY * threat.gravityScale;

  let tof = Math.hypot(threat.x - bat.x, threat.y - bat.y) / speed;
  let px = threat.x;
  let py = threat.y;

  for (let iter = 0; iter < 5; iter++) {
    const tLead = tof + extraLeadSec;
    px = threat.x + threat.vx * tLead + 0.5 * threat.orbitalDriftAx * tLead * tLead;
    py = threat.y + threat.vy * tLead + 0.5 * g * tLead * tLead;
    tof = Math.hypot(px - bat.x, py - bat.y) / speed;
  }

  return {
    x: Math.max(36, Math.min(FLAK_CONSTANTS.VIRTUAL_W - 36, px)),
    y: Math.max(36, Math.min(FLAK_CONSTANTS.HORIZON_Y - 40, py)),
    tofSec: tof,
  };
}

/**
 * Predicts a threat's curved orbital position `dtSec` into the future.
 */
function predictThreatAt(t: OrbitalThreat, dtSec: number): Vec2 {
  const g = FLAK_CONSTANTS.GRAVITY * t.gravityScale;
  return {
    x: t.x + t.vx * dtSec + 0.5 * t.orbitalDriftAx * dtSec * dtSec,
    y: t.y + t.vy * dtSec + 0.5 * g * dtSec * dtSec,
  };
}

const DEMO_STAGES: DemoStageMeta[] = [
  {
    stageIndex: 1,
    stageWaveNumber: 1,
    empAmmo: 3,
    empMax: 3,
    stageTitle: 'STAGE 01 // BALLISTIC LEAD & OVERCLOCK',
    calloutText: '>> TACTICAL AI: CHAINING HITS FOR x4+ AUTOLOADER OVERCLOCK',
    maxDurationSec: 13.5,
    spawns: [
      { delaySec: 0.15, kind: 'KINETIC_ROD', spawnX: 340, targetX: 420, flightSec: 6.7, orbitalDriftAx: 34 },
      { delaySec: 1.35, kind: 'KINETIC_ROD', spawnX: 1580, targetX: 1500, flightSec: 6.7, orbitalDriftAx: -36 },
      { delaySec: 2.55, kind: 'KINETIC_ROD', spawnX: 620, targetX: 710, flightSec: 6.6, orbitalDriftAx: 38 },
      { delaySec: 3.75, kind: 'KINETIC_ROD', spawnX: 1320, targetX: 1210, flightSec: 6.6, orbitalDriftAx: -34 },
      { delaySec: 4.95, kind: 'KINETIC_ROD', spawnX: 480, targetX: 420, flightSec: 6.4, orbitalDriftAx: 40 },
      { delaySec: 6.15, kind: 'KINETIC_ROD', spawnX: 1460, targetX: 1500, flightSec: 6.4, orbitalDriftAx: -38 },
    ],
  },
  {
    stageIndex: 2,
    stageWaveNumber: 2,
    empAmmo: 2, // 2/3 HV so 3 Danger Close kills visibly flash "+1 RECHARGED!"
    empMax: 3,
    stageTitle: 'STAGE 02 // DANGER CLOSE 3X & EMP RECHARGE',
    calloutText: '>> TACTICAL AI: HOLDING FIRE FOR 3X BAND — RECHARGING EMP CAPACITOR',
    maxDurationSec: 14.2,
    spawns: [
      { delaySec: 0.1, kind: 'KINETIC_ROD', spawnX: 460, targetX: 420, flightSec: 5.7, orbitalDriftAx: -18 },
      { delaySec: 1.75, kind: 'KINETIC_ROD', spawnX: 1440, targetX: 1500, flightSec: 5.7, orbitalDriftAx: 18 },
      { delaySec: 3.4, kind: 'KINETIC_ROD', spawnX: 760, targetX: 710, flightSec: 5.6, orbitalDriftAx: -16 },
      { delaySec: 5.05, kind: 'KINETIC_ROD', spawnX: 1170, targetX: 1210, flightSec: 5.6, orbitalDriftAx: 16 },
    ],
  },
  {
    stageIndex: 3,
    stageWaveNumber: 3,
    empAmmo: 2, // 2/3 HV so Billiard Deflection Kill visibly triggers instant "+1 RECHARGED!"
    empMax: 3,
    stageTitle: 'STAGE 03 // HEAVY METEOR BILLIARDS',
    calloutText: '>> TACTICAL AI: OFF-CENTER SHOVE — EXECUTING BILLIARD DEFLECTION KILL',
    maxDurationSec: 14.0,
    spawns: [
      // Heavy Armored Meteor descending cleanly toward HAB-02 (left-center)
      { delaySec: 0.1, kind: 'HEAVY_METEOR', spawnX: 640, targetX: 710, flightSec: 7.6, orbitalDriftAx: 0 },
      // 4 Bowling-pin Kinetic Rods aligned straight across the post-shove rightward billiard arc!
      { delaySec: 0.65, kind: 'KINETIC_ROD', spawnX: 835, targetX: 870, flightSec: 6.8, orbitalDriftAx: 0 },
      { delaySec: 0.78, kind: 'KINETIC_ROD', spawnX: 920, targetX: 955, flightSec: 6.8, orbitalDriftAx: 0 },
      { delaySec: 0.91, kind: 'KINETIC_ROD', spawnX: 1005, targetX: 1040, flightSec: 6.8, orbitalDriftAx: 0 },
      { delaySec: 1.04, kind: 'KINETIC_ROD', spawnX: 1090, targetX: 1125, flightSec: 6.8, orbitalDriftAx: 0 },
    ],
  },
  {
    stageIndex: 4,
    stageWaveNumber: 4,
    empAmmo: 3,
    empMax: 3,
    stageTitle: 'STAGE 04 // MIRV SNIPING & ION JAMMERS',
    calloutText: '>> TACTICAL AI: NEUTRALIZING ION JAMMER — SNIPING MIRV ABOVE 48KM',
    maxDurationSec: 14.0,
    spawns: [
      // Ion Jammer arrives first with 2 escort rods inside its 290px ECM scramble zone!
      { delaySec: 0.1, kind: 'ION_JAMMER', spawnX: 770, targetX: 810, flightSec: 10.6, orbitalDriftAx: 8 },
      { delaySec: 0.25, kind: 'KINETIC_ROD', spawnX: 675, targetX: 710, flightSec: 8.3, orbitalDriftAx: 10 },
      { delaySec: 0.4, kind: 'KINETIC_ROD', spawnX: 860, targetX: 900, flightSec: 8.4, orbitalDriftAx: -10 },
      // Twin high-priority MIRV Bio-Pods to snipe well above the 48KM split line
      { delaySec: 1.45, kind: 'MIRV_POD', spawnX: 1270, targetX: 1210, flightSec: 9.8, orbitalDriftAx: -12 },
      { delaySec: 2.85, kind: 'MIRV_POD', spawnX: 520, targetX: 420, flightSec: 9.6, orbitalDriftAx: 14 },
      { delaySec: 3.7, kind: 'KINETIC_ROD', spawnX: 1520, targetX: 1500, flightSec: 6.9, orbitalDriftAx: -18 },
    ],
  },
  {
    stageIndex: 5,
    stageWaveNumber: 5,
    empAmmo: 3,
    empMax: 3,
    stageTitle: 'STAGE 05 // MK-IV EMP MORTAR SWARM WIPE',
    calloutText: '>> TACTICAL AI: DEPLOYING MK-IV EMP MORTAR — 220PX SWARM WIPE',
    maxDurationSec: 14.0,
    spawns: [
      // Dense 9-contact converging orbital swarm crossing right through (960, 445) around t=4.1s!
      { delaySec: 0.1, kind: 'MIRV_POD', spawnX: 960, targetX: 960, flightSec: 8.6, orbitalDriftAx: 0 },
      { delaySec: 0.2, kind: 'HEAVY_METEOR', spawnX: 920, targetX: 980, flightSec: 8.2, orbitalDriftAx: 0 },
      { delaySec: 0.35, kind: 'KINETIC_ROD', spawnX: 690, targetX: 1180, flightSec: 7.4, orbitalDriftAx: 0 },
      { delaySec: 0.42, kind: 'KINETIC_ROD', spawnX: 1230, targetX: 740, flightSec: 7.4, orbitalDriftAx: 0 },
      { delaySec: 0.5, kind: 'KINETIC_ROD', spawnX: 780, targetX: 1120, flightSec: 7.3, orbitalDriftAx: 0 },
      { delaySec: 0.58, kind: 'KINETIC_ROD', spawnX: 1140, targetX: 800, flightSec: 7.3, orbitalDriftAx: 0 },
      { delaySec: 0.65, kind: 'KINETIC_ROD', spawnX: 860, targetX: 1050, flightSec: 7.2, orbitalDriftAx: 0 },
      { delaySec: 0.72, kind: 'KINETIC_ROD', spawnX: 1060, targetX: 870, flightSec: 7.2, orbitalDriftAx: 0 },
      { delaySec: 0.8, kind: 'KINETIC_ROD', spawnX: 965, targetX: 955, flightSec: 7.1, orbitalDriftAx: 0 },
      // Follow-up compact flanking swarm for a 2nd showcase detonation
      { delaySec: 4.8, kind: 'KINETIC_ROD', spawnX: 1120, targetX: 1460, flightSec: 6.4, orbitalDriftAx: 0 },
      { delaySec: 4.9, kind: 'KINETIC_ROD', spawnX: 1520, targetX: 1180, flightSec: 6.4, orbitalDriftAx: 0 },
      { delaySec: 5.0, kind: 'KINETIC_ROD', spawnX: 1220, targetX: 1400, flightSec: 6.3, orbitalDriftAx: 0 },
      { delaySec: 5.1, kind: 'KINETIC_ROD', spawnX: 1420, targetX: 1240, flightSec: 6.3, orbitalDriftAx: 0 },
      { delaySec: 5.2, kind: 'MIRV_POD', spawnX: 1320, targetX: 1320, flightSec: 7.8, orbitalDriftAx: 0 },
    ],
  },
];

export class FlakDemoDirector {
  private active = false;
  private stageIdx = 0; // 0..4
  private stageElapsedSec = 0;
  private stageHoldAfterClearSec = 0;
  private completedLoopCount = 0;

  private pendingSpawns: ScriptedDemoSpawn[] = [];
  private inFlightUntil = new Map<number, number>();
  private clockSec = 0;
  private aiFireCooldown = 0;

  // Stage-specific tracking flags
  private stageMilestoneHit = false;
  private milestoneBanner: string | null = null;
  private stage3HoverSec = 0;
  private stage3HoverOffset: Vec2 = { x: -62, y: 8 };
  private stage3ShotFired = false;
  private stage3StartDeflectKills = 0;
  private stage4JammerKilled = false;
  private stage4MirvKilled = false;
  private stage5EmpFiredCount = 0;
  private stage5EmpCooldown = 0;

  // Smooth 60fps interpolated AI Targeter crosshair
  private aiCursor: Vec2 = { x: FLAK_CONSTANTS.VIRTUAL_W * 0.5, y: 420 };
  private desiredCursor: Vec2 = { x: FLAK_CONSTANTS.VIRTUAL_W * 0.5, y: 420 };
  private aiWeaponMode: AiWeaponMode = 'FLAK';
  private aiLockedThreatId: number | null = null;

  public isActive(): boolean {
    return this.active;
  }

  public start(sim: FlakSimulation): void {
    this.active = true;
    this.completedLoopCount = 0;
    this.clockSec = 0;
    this.aiCursor = { x: FLAK_CONSTANTS.VIRTUAL_W * 0.5, y: 420 };
    this.desiredCursor = { x: FLAK_CONSTANTS.VIRTUAL_W * 0.5, y: 420 };
    sim.startDemoSandbox();
    this.beginStage(sim, 0);
  }

  public stop(sim: FlakSimulation): void {
    if (!this.active && !sim.isDemoMode) return;
    this.active = false;
    this.pendingSpawns = [];
    this.inFlightUntil.clear();
    sim.resetToTitle();
  }

  public jumpToStage(sim: FlakSimulation, oneBasedStage: number): void {
    const idx = Math.max(0, Math.min(DEMO_STAGES.length - 1, Math.floor(oneBasedStage) - 1));
    if (!this.active) {
      this.active = true;
      sim.startDemoSandbox();
    }
    this.beginStage(sim, idx);
  }

  public getTelemetry(): DemoTelemetryState {
    const meta = DEMO_STAGES[this.stageIdx] ?? DEMO_STAGES[0];
    return {
      active: this.active,
      stageIndex: meta.stageIndex,
      totalStages: DEMO_STAGES.length,
      stageTitle: meta.stageTitle,
      calloutText: meta.calloutText,
      stageElapsedSec: this.stageElapsedSec,
      stageTargetSec: meta.maxDurationSec,
      aiCursor: { x: this.aiCursor.x, y: this.aiCursor.y },
      aiWeaponMode: this.aiWeaponMode,
      aiLockedThreatId: this.aiLockedThreatId,
      stageMilestoneHit: this.stageMilestoneHit,
      milestoneBanner: this.milestoneBanner,
      completedLoopCount: this.completedLoopCount,
    };
  }

  private beginStage(sim: FlakSimulation, idx: number): void {
    this.stageIdx = idx % DEMO_STAGES.length;
    const meta = DEMO_STAGES[this.stageIdx];
    this.stageElapsedSec = 0;
    this.stageHoldAfterClearSec = 0;
    this.aiFireCooldown = 0.18;
    this.inFlightUntil.clear();
    this.stageMilestoneHit = false;
    this.milestoneBanner = null;
    this.stage3HoverSec = 0;
    this.stage3HoverOffset = { x: -62, y: 8 };
    this.stage3ShotFired = false;
    this.stage3StartDeflectKills = sim.deflectionKills;
    this.stage4JammerKilled = false;
    this.stage4MirvKilled = false;
    this.stage5EmpFiredCount = 0;
    this.stage5EmpCooldown = 0;
    this.aiLockedThreatId = null;
    this.aiWeaponMode = meta.stageIndex === 5 ? 'EMP' : meta.stageIndex === 2 ? 'HOLD' : 'FLAK';

    sim.resetDemoStageState(meta.stageWaveNumber, meta.empAmmo, meta.empMax);
    if (meta.stageIndex === 1) {
      sim.liveChain = 1;
      sim.liveChainDecayTimer = 0;
      sim.predictorBoostTimer = 0;
    } else if (meta.stageIndex === 2) {
      sim.dangerCloseRechargeProgress = 0;
      sim.empRechargeFlashTimer = 0;
    } else if (meta.stageIndex === 3) {
      sim.empRechargeFlashTimer = 0;
    }

    this.pendingSpawns = meta.spawns.map((s) => ({ ...s })).sort((a, b) => a.delaySec - b.delaySec);
    sim.pushTelemetryLog(`${meta.stageTitle}`, 'amber');
    sim.pushTelemetryLog(meta.calloutText, 'bright');
  }

  public step(sim: FlakSimulation, dt: number): void {
    if (!this.active || sim.paused) return;

    this.clockSec += dt;
    this.stageElapsedSec += dt;
    if (this.aiFireCooldown > 0) this.aiFireCooldown = Math.max(0, this.aiFireCooldown - dt);
    if (this.stage5EmpCooldown > 0) {
      this.stage5EmpCooldown = Math.max(0, this.stage5EmpCooldown - dt);
    }

    // Expire completed in-flight reservations
    for (const [id, until] of this.inFlightUntil.entries()) {
      if (this.clockSec >= until) {
        this.inFlightUntil.delete(id);
      }
    }

    const meta = DEMO_STAGES[this.stageIdx];

    // 1. Drain scripted stage spawns
    while (
      this.pendingSpawns.length > 0 &&
      this.pendingSpawns[0].delaySec <= this.stageElapsedSec
    ) {
      const ev = this.pendingSpawns.shift()!;
      sim.spawnScriptedThreat(ev);
    }

    // 2. Execute stage-specific tactical AI brain
    switch (meta.stageIndex) {
      case 1:
        this.runStage1BallisticChain(sim);
        break;
      case 2:
        this.runStage2DangerCloseRecharge(sim);
        break;
      case 3:
        this.runStage3HeavyBilliards(sim, dt);
        break;
      case 4:
        this.runStage4JammerAndMirv(sim);
        break;
      case 5:
        this.runStage5EmpSwarmWipe(sim);
        break;
    }

    // 3. Smooth 60fps AI Targeter cursor slew & live turret barrel tracking
    const slewRate = this.aiWeaponMode === 'DEFLECT_AIM' ? 18 : 13.5;
    const alpha = 1 - Math.exp(-slewRate * dt);
    this.aiCursor.x += (this.desiredCursor.x - this.aiCursor.x) * alpha;
    this.aiCursor.y += (this.desiredCursor.y - this.aiCursor.y) * alpha;
    this.aiCursor.x = Math.max(40, Math.min(FLAK_CONSTANTS.VIRTUAL_W - 40, this.aiCursor.x));
    this.aiCursor.y = Math.max(40, Math.min(FLAK_CONSTANTS.HORIZON_Y - 40, this.aiCursor.y));
    sim.updateBatteryTurretAim(this.aiCursor);

    // 4. Advance to next stage smoothly once clear (or at max duration cap)
    const skyClear =
      this.pendingSpawns.length === 0 &&
      sim.threats.length === 0 &&
      sim.shells.length === 0 &&
      sim.blasts.length === 0;

    if (skyClear || this.stageElapsedSec >= meta.maxDurationSec) {
      this.stageHoldAfterClearSec += dt;
      const holdTarget = skyClear ? 1.25 : 0.4;
      if (this.stageHoldAfterClearSec >= holdTarget) {
        const nextIdx = (this.stageIdx + 1) % DEMO_STAGES.length;
        if (nextIdx === 0) {
          this.completedLoopCount++;
        }
        this.beginStage(sim, nextIdx);
      }
    }
  }

  private runStage1BallisticChain(sim: FlakSimulation): void {
    if (!this.stageMilestoneHit && (sim.liveChain >= 4 || sim.highChain >= 4)) {
      this.stageMilestoneHit = true;
      this.milestoneBanner = 'x4+ AUTOLOADER OVERCLOCK ONLINE (-20% RELOAD)!';
    }

    const candidates = sim.threats
      .filter((t) => !this.inFlightUntil.has(t.id) && t.y >= 68)
      .sort((a, b) => b.y - a.y);

    if (candidates.length === 0) {
      this.aiLockedThreatId = null;
      this.aiWeaponMode = 'FLAK';
      return;
    }

    const target = candidates[0];
    const lead = solveCurvedIntercept(sim, target, false, 0.035);
    this.desiredCursor = { x: lead.x, y: lead.y };
    this.aiLockedThreatId = target.id;
    this.aiWeaponMode = 'FLAK';

    const aimErr = Math.hypot(this.aiCursor.x - lead.x, this.aiCursor.y - lead.y);
    if (this.aiFireCooldown <= 0 && target.y >= 175 && aimErr < 72) {
      if (sim.fireSmartFlak(lead.x, lead.y)) {
        this.inFlightUntil.set(target.id, this.clockSec + lead.tofSec + 0.35);
        this.aiFireCooldown = 0.32;
      }
    }
  }

  private runStage2DangerCloseRecharge(sim: FlakSimulation): void {
    const empBat = sim.batteries[1];
    if (
      !this.stageMilestoneHit &&
      (sim.empRechargeFlashTimer > 0 || (empBat && empBat.ammo >= empBat.maxAmmo))
    ) {
      this.stageMilestoneHit = true;
      this.milestoneBanner = '+1 MK-IV EMP CAPACITOR RECHARGED (3X DANGER BONUS)!';
    }

    const candidates = sim.threats
      .filter((t) => !this.inFlightUntil.has(t.id) && t.y >= 20)
      .sort((a, b) => b.y - a.y);

    if (candidates.length === 0) {
      this.aiLockedThreatId = null;
      this.aiWeaponMode = 'HOLD';
      return;
    }

    const target = candidates[0];
    const lead = solveCurvedIntercept(sim, target, false, 0.035);
    this.desiredCursor = { x: lead.x, y: lead.y };
    this.aiLockedThreatId = target.id;

    // Deliberately HOLD FIRE until predicted detonation occurs cleanly inside <24KM DANGER CLOSE 3X band!
    const inDangerBandAtDetonation = lead.y >= FLAK_CONSTANTS.DANGER_CLOSE_Y + 26;
    this.aiWeaponMode = inDangerBandAtDetonation ? 'FLAK' : 'HOLD';

    if (this.aiFireCooldown <= 0 && inDangerBandAtDetonation) {
      if (sim.fireSmartFlak(lead.x, lead.y)) {
        this.inFlightUntil.set(target.id, this.clockSec + lead.tofSec + 0.35);
        this.aiFireCooldown = 0.28;
      }
    }
  }

  private runStage3HeavyBilliards(sim: FlakSimulation, dt: number): void {
    if (
      !this.stageMilestoneHit &&
      (sim.deflectionKills > this.stage3StartDeflectKills || sim.empRechargeFlashTimer > 0)
    ) {
      this.stageMilestoneHit = true;
      this.milestoneBanner = 'BILLIARD DEFLECTION KILL + INSTANT EMP RECHARGE!';
    }

    const meteor = sim.threats.find((t) => t.kind === 'HEAVY_METEOR');
    const rods = sim.threats.filter((t) => t.kind !== 'HEAVY_METEOR');

    // Phase A: Hover off-center beside Heavy Meteor to flash live getDeflectionPreview + BILLIARD KILL!
    if (meteor && !this.stage3ShotFired) {
      this.aiWeaponMode = 'DEFLECT_AIM';
      this.aiLockedThreatId = meteor.id;

      // Dynamically scan candidate off-center shove vectors to guarantee live hitsOtherThreat === true!
      let bestOffset = this.stage3HoverOffset;
      let foundBilliard = false;
      const candidateOffsets: Vec2[] = [
        { x: -62, y: 8 },
        { x: -66, y: 12 },
        { x: -58, y: 4 },
        { x: -70, y: 16 },
        { x: -62, y: -4 },
        { x: -56, y: 14 },
        { x: -72, y: 6 },
      ];
      for (const off of candidateOffsets) {
        const probe = { x: meteor.x + off.x, y: meteor.y + off.y };
        const prev = sim.getDeflectionPreview(probe);
        if (prev && prev.meteorId === meteor.id && prev.hitsOtherThreat) {
          bestOffset = off;
          foundBilliard = true;
          break;
        }
      }
      this.stage3HoverOffset = bestOffset;

      // Keep cursor pinned right on the live off-center sweet spot so viewer clearly sees the preview!
      const liveHoverPt = {
        x: Math.max(40, meteor.x + bestOffset.x),
        y: Math.max(40, meteor.y + bestOffset.y),
      };
      this.desiredCursor = liveHoverPt;

      // Accumulate crisp ~1.25s visual showcase beat specifically while BILLIARD KILL preview is live!
      if (foundBilliard && meteor.y >= 175) {
        this.stage3HoverSec += dt;
      }

      // Fire lead-compensated off-center shove shot right after visual showcase beat!
      if (
        this.aiFireCooldown <= 0 &&
        (this.stage3HoverSec >= 1.25 || meteor.y >= 445)
      ) {
        const bat =
          sim.pickNearestReadyFlakBattery(meteor.x + bestOffset.x) ?? sim.batteries[0];
        let tof = Math.hypot(liveHoverPt.x - bat.x, liveHoverPt.y - bat.y) / FLAK_CONSTANTS.FLAK_SHELL_SPEED;
        // 4 iterations solving exact off-center detonation relative to meteor's future position
        let fireX = liveHoverPt.x;
        let fireY = liveHoverPt.y;
        for (let k = 0; k < 4; k++) {
          const fut = predictThreatAt(meteor, tof + 0.065);
          fireX = fut.x + bestOffset.x;
          fireY = fut.y + bestOffset.y;
          tof = Math.hypot(fireX - bat.x, fireY - bat.y) / FLAK_CONSTANTS.FLAK_SHELL_SPEED;
        }

        if (sim.fireSmartFlak(fireX, fireY)) {
          this.stage3ShotFired = true;
          this.aiFireCooldown = 0.55;
        }
      }
      return;
    }

    // Phase B: Meteor has been shoved! Hold off shooting while it bowls through the Kinetic Rods!
    if (meteor && meteor.deflectedTimer > 0) {
      this.aiLockedThreatId = meteor.id;
      this.desiredCursor = { x: meteor.x, y: meteor.y };
      this.aiWeaponMode = 'HOLD';

      // Only snipe a stray rod if it somehow bypassed the meteor and dropped dangerously close to a dome
      const dangerStraggler = rods
        .filter((r) => !this.inFlightUntil.has(r.id) && r.y >= FLAK_CONSTANTS.DANGER_CLOSE_Y + 10)
        .sort((a, b) => b.y - a.y)[0];
      if (dangerStraggler && this.aiFireCooldown <= 0) {
        const lead = solveCurvedIntercept(sim, dangerStraggler, false, 0.035);
        this.desiredCursor = { x: lead.x, y: lead.y };
        this.aiWeaponMode = 'FLAK';
        if (sim.fireSmartFlak(lead.x, lead.y)) {
          this.inFlightUntil.set(dangerStraggler.id, this.clockSec + lead.tofSec + 0.35);
          this.aiFireCooldown = 0.25;
        }
      }
      return;
    }

    // Phase C: Clean up any surviving contacts cleanly after the bowling strike
    const stragglers = sim.threats
      .filter((t) => !this.inFlightUntil.has(t.id) && t.y >= 80)
      .sort((a, b) => b.y - a.y);
    if (stragglers.length > 0) {
      const target = stragglers[0];
      const lead = solveCurvedIntercept(sim, target, false, 0.035);
      this.desiredCursor = { x: lead.x, y: lead.y };
      this.aiLockedThreatId = target.id;
      this.aiWeaponMode = 'FLAK';
      if (this.aiFireCooldown <= 0) {
        if (sim.fireSmartFlak(lead.x, lead.y)) {
          this.inFlightUntil.set(target.id, this.clockSec + lead.tofSec + 0.35);
          this.aiFireCooldown = 0.28;
        }
      }
    }
  }

  private runStage4JammerAndMirv(sim: FlakSimulation): void {
    const jammer = sim.threats.find((t) => t.kind === 'ION_JAMMER');
    const mirvs = sim.threats.filter((t) => t.kind === 'MIRV_POD' && !this.inFlightUntil.has(t.id));

    if (!jammer && this.stageElapsedSec > 1.2) {
      this.stage4JammerKilled = true;
    }
    if (
      this.stage4JammerKilled &&
      this.pendingSpawns.every((s) => s.kind !== 'MIRV_POD') &&
      sim.threats.every((t) => t.kind !== 'MIRV_POD')
    ) {
      this.stage4MirvKilled = true;
    }
    if (!this.stageMilestoneHit && this.stage4JammerKilled && this.stage4MirvKilled) {
      this.stageMilestoneHit = true;
      this.milestoneBanner = 'ION JAMMER CLEARED & MIRV SNIPED ABOVE 48KM!';
    }

    // Priority 1: Track Ion Jammer for ~1.1s so viewer sees scrambled arcs, then destroy it first!
    if (jammer && !this.inFlightUntil.has(jammer.id)) {
      const lead = solveCurvedIntercept(sim, jammer, false, 0.035);
      this.desiredCursor = { x: lead.x, y: lead.y };
      this.aiLockedThreatId = jammer.id;
      if (this.stageElapsedSec < 1.15) {
        this.aiWeaponMode = 'HOLD';
        return;
      }
      this.aiWeaponMode = 'FLAK';
      if (this.aiFireCooldown <= 0) {
        if (sim.fireSmartFlak(lead.x, lead.y)) {
          this.inFlightUntil.set(jammer.id, this.clockSec + lead.tofSec + 0.35);
          this.aiFireCooldown = 0.34;
        }
      }
      return;
    }

    // Priority 2: Snipe MIRV Bio-Pods well above 48KM separation threshold!
    if (mirvs.length > 0) {
      mirvs.sort((a, b) => b.y - a.y);
      const pod = mirvs[0];
      const lead = solveCurvedIntercept(sim, pod, false, 0.035);
      this.desiredCursor = { x: lead.x, y: lead.y };
      this.aiLockedThreatId = pod.id;
      this.aiWeaponMode = 'FLAK';
      if (this.aiFireCooldown <= 0 && pod.y >= 110) {
        if (sim.fireSmartFlak(lead.x, lead.y)) {
          this.inFlightUntil.set(pod.id, this.clockSec + lead.tofSec + 0.35);
          this.aiFireCooldown = 0.32;
        }
      }
      return;
    }

    // Priority 3: Sweep remaining escort rods
    const rods = sim.threats
      .filter((t) => !this.inFlightUntil.has(t.id) && t.y >= 70)
      .sort((a, b) => b.y - a.y);
    if (rods.length > 0) {
      const target = rods[0];
      const lead = solveCurvedIntercept(sim, target, false, 0.035);
      this.desiredCursor = { x: lead.x, y: lead.y };
      this.aiLockedThreatId = target.id;
      this.aiWeaponMode = 'FLAK';
      if (this.aiFireCooldown <= 0) {
        if (sim.fireSmartFlak(lead.x, lead.y)) {
          this.inFlightUntil.set(target.id, this.clockSec + lead.tofSec + 0.35);
          this.aiFireCooldown = 0.28;
        }
      }
    }
  }

  private runStage5EmpSwarmWipe(sim: FlakSimulation): void {
    const empBat = sim.batteries[1];
    const empReady = empBat && empBat.ammo > 0 && empBat.cooldownTimer <= 0;

    if (!this.stageMilestoneHit && this.stage5EmpFiredCount >= 1 && sim.totalKills >= 4) {
      this.stageMilestoneHit = true;
      this.milestoneBanner = '220PX MK-IV EMP SWARM WIPE // CRT SHOCKWAVE CONFIRMED!';
    }

    // Check if an EMP shell is already flying
    const empInFlight = sim.shells.some((s) => s.isEmp);
    if (empInFlight) {
      const flyingEmp = sim.shells.find((s) => s.isEmp)!;
      this.desiredCursor = { x: flyingEmp.targetX, y: flyingEmp.targetY };
      this.aiWeaponMode = 'EMP';
      return;
    }

    // Find densest converging cluster for a 220px Mk-IV EMP detonation!
    if (empReady && this.stage5EmpCooldown <= 0 && sim.threats.length >= 3) {
      const active = sim.threats.filter((t) => t.y >= 60);
      if (active.length >= 3) {
        // Compute centroid and predict forward by EMP TOF
        let bestCenter: Vec2 = { x: 960, y: 450 };
        let bestCount = 0;

        for (const anchor of active) {
          const anchorLead = solveCurvedIntercept(sim, anchor, true, 0.05);
          let count = 0;
          let sumX = 0;
          let sumY = 0;
          for (const other of active) {
            const p = predictThreatAt(other, anchorLead.tofSec + 0.05);
            if (Math.hypot(p.x - anchorLead.x, p.y - anchorLead.y) <= 200) {
              count++;
              sumX += p.x;
              sumY += p.y;
            }
          }
          if (count > bestCount) {
            bestCount = count;
            bestCenter = { x: sumX / count, y: sumY / count };
          }
        }

        this.desiredCursor = {
          x: Math.max(120, Math.min(FLAK_CONSTANTS.VIRTUAL_W - 120, bestCenter.x)),
          y: Math.max(160, Math.min(FLAK_CONSTANTS.HORIZON_Y - 120, bestCenter.y)),
        };
        this.aiWeaponMode = 'EMP';
        this.aiLockedThreatId = active[0].id;

        // Fire EMP right as the converging cluster tightens inside the 220px blast radius!
        const minHitsNeeded = this.stage5EmpFiredCount === 0 ? 5 : 4;
        if (
          (bestCount >= minHitsNeeded && this.desiredCursor.y >= 340) ||
          (bestCount >= 3 && this.desiredCursor.y >= 540)
        ) {
          if (sim.fireEmpMortar(this.desiredCursor.x, this.desiredCursor.y)) {
            this.stage5EmpFiredCount++;
            this.stage5EmpCooldown = 1.65;
            this.aiFireCooldown = 0.65;
            return;
          }
        }
        return;
      }
    }

    // Sweep any surviving stragglers cleanly with overclocked M90 Flak
    const stragglers = sim.threats
      .filter((t) => !this.inFlightUntil.has(t.id) && t.y >= 80)
      .sort((a, b) => b.y - a.y);
    if (stragglers.length > 0) {
      const target = stragglers[0];
      const lead = solveCurvedIntercept(sim, target, false, 0.035);
      this.desiredCursor = { x: lead.x, y: lead.y };
      this.aiLockedThreatId = target.id;
      this.aiWeaponMode = 'FLAK';
      if (this.aiFireCooldown <= 0) {
        if (sim.fireSmartFlak(lead.x, lead.y)) {
          this.inFlightUntil.set(target.id, this.clockSec + lead.tofSec + 0.35);
          this.aiFireCooldown = 0.25;
        }
      }
    }
  }
}

/**
 * Reusable 60fps Tactical AutoBot for Dev Debugging (`window.__FLAK_DEBUG__.setAutoBot(true)`).
 * Autonomously plays live Waves 1-5+ including Ion Jammers, MIRVs, Heavy Meteors, EMP clusters,
 * and Orbital Siege Dreadnought Boss hardpoints.
 */
export class FlakTacticalAutoBot {
  private enabled = false;
  private clockSec = 0;
  private fireCooldown = 0;
  private inFlightUntil = new Map<number, number>();

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(on: boolean): void {
    this.enabled = on;
    this.inFlightUntil.clear();
    this.fireCooldown = 0;
  }

  public step(sim: FlakSimulation, dt: number, cursorOut: Vec2): void {
    if (!this.enabled || sim.phase !== 'ACTIVE_WAVE' || sim.paused) return;

    this.clockSec += dt;
    if (this.fireCooldown > 0) this.fireCooldown = Math.max(0, this.fireCooldown - dt);

    for (const [id, until] of this.inFlightUntil.entries()) {
      if (this.clockSec >= until) this.inFlightUntil.delete(id);
    }

    // 1. Check dense EMP cluster (>= 4 threats within 200px or charging Boss!)
    const empBat = sim.batteries[1];
    const empReady = empBat && empBat.ammo > 0 && empBat.cooldownTimer <= 0;
    const empFlying = sim.shells.some((s) => s.isEmp);

    if (empReady && !empFlying && this.fireCooldown <= 0) {
      // Stun charging Orbital Dreadnought Boss!
      if (sim.boss && sim.boss.dyingTimer <= 0 && sim.boss.chargeTimer > 0.25 && sim.boss.empStunTimer <= 0) {
        const bx = Math.max(120, Math.min(FLAK_CONSTANTS.VIRTUAL_W - 120, sim.boss.x + sim.boss.vx * 0.45));
        const by = sim.boss.y;
        cursorOut.x = bx;
        cursorOut.y = by;
        sim.updateBatteryTurretAim(cursorOut);
        if (sim.fireEmpMortar(bx, by)) {
          this.fireCooldown = 0.55;
          return;
        }
      }

      // Or wipe a dense cluster of 4+ incoming contacts!
      if (sim.threats.length >= 4) {
        let bestCluster = { x: 0, y: 0, count: 0 };
        for (const anchor of sim.threats) {
          if (anchor.y < 220) continue;
          const lead = solveCurvedIntercept(sim, anchor, true, 0.04);
          let count = 0;
          let sx = 0;
          let sy = 0;
          for (const other of sim.threats) {
            const p = predictThreatAt(other, lead.tofSec + 0.04);
            if (Math.hypot(p.x - lead.x, p.y - lead.y) <= 195) {
              count++;
              sx += p.x;
              sy += p.y;
            }
          }
          if (count > bestCluster.count) {
            bestCluster = { x: sx / count, y: sy / count, count };
          }
        }
        if (bestCluster.count >= 4) {
          cursorOut.x = bestCluster.x;
          cursorOut.y = bestCluster.y;
          sim.updateBatteryTurretAim(cursorOut);
          if (sim.fireEmpMortar(bestCluster.x, bestCluster.y)) {
            this.fireCooldown = 0.55;
            return;
          }
        }
      }
    }

    // 2. Prioritize threats: Urgent low dome-locked > MIRV > Ion Jammer > Heavy Meteor > Rods
    const scored = sim.threats
      .filter((t) => {
        if (t.y < 55) return false;
        // Allow re-firing on Heavy Meteors once previous shot arrives
        if (t.kind !== 'HEAVY_METEOR' && this.inFlightUntil.has(t.id)) return false;
        if (t.kind === 'HEAVY_METEOR' && this.inFlightUntil.has(t.id)) return false;
        return true;
      })
      .map((t) => {
        let prio = t.y;
        if (t.lockedDomeId) prio += 260;
        if (t.kind === 'MIRV_POD' && t.y > 140) prio += 380;
        if (t.kind === 'ION_JAMMER') prio += 340;
        if (t.kind === 'HEAVY_METEOR' && t.lockedDomeId) prio += 180;
        return { t, prio };
      })
      .sort((a, b) => b.prio - a.prio);

    if (scored.length > 0) {
      const target = scored[0].t;
      const lead = solveCurvedIntercept(sim, target, false, 0.035);
      cursorOut.x = lead.x;
      cursorOut.y = lead.y;
      sim.updateBatteryTurretAim(cursorOut);

      if (this.fireCooldown <= 0 && sim.fireSmartFlak(lead.x, lead.y)) {
        const lockSec = target.kind === 'HEAVY_METEOR' ? lead.tofSec * 0.65 : lead.tofSec + 0.32;
        this.inFlightUntil.set(target.id, this.clockSec + lockSec);
        this.fireCooldown = 0.2;
      }
      return;
    }

    // 3. Target Orbital Siege Dreadnought Boss hardpoints when sky is clear!
    if (sim.boss && sim.boss.dyingTimer <= 0 && sim.boss.y >= sim.boss.targetY - 30) {
      const activeHp = sim.boss.hardpoints.find((h) => !h.destroyed);
      if (activeHp) {
        const moveScale = sim.boss.empStunTimer > 0 ? 0.25 : 1.0;
        const rawX = sim.boss.x + activeHp.offsetX;
        const rawY = sim.boss.y + activeHp.offsetY;
        const bat = sim.pickNearestReadyFlakBattery(rawX) ?? sim.batteries[0];
        const tof = Math.hypot(rawX - bat.x, rawY - bat.y) / FLAK_CONSTANTS.FLAK_SHELL_SPEED;
        const aimX = Math.max(
          160,
          Math.min(FLAK_CONSTANTS.VIRTUAL_W - 160, rawX + sim.boss.vx * moveScale * tof)
        );
        const aimY = rawY;
        cursorOut.x = aimX;
        cursorOut.y = aimY;
        sim.updateBatteryTurretAim(cursorOut);
        if (this.fireCooldown <= 0 && sim.fireSmartFlak(aimX, aimY)) {
          this.fireCooldown = 0.26;
        }
      }
    }
  }
}
