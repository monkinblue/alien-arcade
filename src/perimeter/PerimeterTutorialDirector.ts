import type { Vec2 } from '../types';
import type { PerimeterSimulation } from './PerimeterSimulation';
import {
  HARDWARE_SPECS,
  PERIMETER_CONSTANTS,
  type BuildToolId,
  type CommandAbilityId,
} from './types';

export type TutorialTier = 'CORE' | 'ADVANCED';

export interface TutorialMapBeacon {
  pos: Vec2;
  label: string;
  color: string;
  radiusPx?: number;
}

export interface TutorialPlacementRule {
  buildId: Exclude<BuildToolId, 'NONE'>;
  col: number;
  row: number;
  /** Required center aim angle in radians (omitted for omni units like Cryo Valve / Shock Coil / Claymore / Door Weld) */
  targetAngle?: number;
  /** Max allowed angular deviation in radians */
  angleToleranceRad?: number;
  /** Short plain-English direction cue shown on drag & rejection toasts */
  aimHint?: string;
  /** Optional specific blast door ID for ARC_WELDER */
  doorId?: string;
}

export interface TutorialAbilityZoneRule {
  abilityId: CommandAbilityId;
  center: Vec2;
  radiusPx: number;
  label: string;
  airlockId?: string;
}

export interface TutorialObjectiveItem {
  text: string;
  done: boolean;
}

export interface TutorialDirectiveSnapshot {
  active: boolean;
  graduated: boolean;
  tier: TutorialTier;
  canStartAdvancedLab: boolean;
  stepIndex: number; // 0..3
  totalSteps: number; // 4
  code: string;
  title: string;
  briefingLines: string[];
  objectives: TutorialObjectiveItem[];
  beacons: TutorialMapBeacon[];
  highlightButtonIds: string[];
  /** Strict per-substep allowlists so trainees can ONLY grab what this step requires */
  allowedBuildIds: Array<Exclude<BuildToolId, 'NONE'>>;
  allowedAbilityIds: CommandAbilityId[];
  allowRearm: boolean;
  allowUpgrade: boolean;
  allowDoorInspect: boolean;
  /** Active placement constraint (enforces exact pad/grate/door & reasonable firing angle!) */
  activePlacementRule: TutorialPlacementRule | null;
  /** Active targeted ability constraint (e.g. Flare in West Junction, Purge on Airlock W-01) */
  activeAbilityZone: TutorialAbilityZoneRule | null;
  wikiChapterIdx: number;
  showContinueBtn: boolean;
  continueLabel: string;
}

function normalizeAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/**
 * 2-Tier Interactive USCM Tactical Combat Training Drill for Hadley's Perimeter:
 *
 * TIER 1 — 4-Stage Core Certification (~90s):
 *   1. Deploy & Aim UA 571-C Sentry at (12, 8) aimed WEST (180°) down West Approach
 *   2. Live Contact (3 Drones), Tactical Pause [SPACE/P], and Sentry Rearm [E]
 *   3. Vision [6] M314 Relay Tripwire at (9, 7) SOUTH + [4] Cryo Valve (9, 9) + [3] M99 Rail (5, 8) EAST -> Stalker + Praetorian
 *   4. Blast Doors [7] D-04 (tempo/diversion) + Turret Upgrade MK-II [U] & MK-III Branch [A/B]
 *
 * TIER 2 — Optional 4-Stage Advanced Systems Lab (launched from Stage 4 Graduation):
 *   1. [5] Arc-Shock Coil on Grate (15, 4) & [8] M18 Claymore on Corridor (8, 8) -> Sub-Floor Skitterer Ambush
 *   2. [2] M240 Incinerator at (9, 10) NORTH to sterilize Acid (+15S) + [C] Coolant Flush
 *   3. Reserve Battery [L] Emergency Floodlight & [O] Overclock Surge
 *   4. [V] Airlock Vent Purge on AIRLOCK W-01 (2X Score decompression flush)
 */
export class PerimeterTutorialDirector {
  public active = false;
  public graduated = false;
  public tier: TutorialTier = 'CORE';
  private stepIdx = 0;
  private readonly totalSteps = 4;

  // Per-stage milestone trackers
  private stepElapsedSec = 0;
  private dronesSpawned = false;
  private ammoDrainTriggered = false;
  private rearmCompleted = false;
  private visionAmbushSpawned = false;
  private doorWeldedInStep = false;
  private initialSealedDoorsCount = 0;
  private claymorePlacedInStep = false;
  private initialClaymoreCount = 0;
  private labSkitterersSpawned = false;
  private acidDemoSpawned = false;
  private coolantUsedInStep = false;
  private floodUsedInStep = false;
  private overclockUsedInStep = false;
  private purgeSwarmSpawned = false;
  private purgeUsedInStep = false;
  private stepAdvanceDelaySec = 0;

  private tileCenter(col: number, row: number): Vec2 {
    const ts = PERIMETER_CONSTANTS.TILE_SIZE;
    return { x: col * ts + ts * 0.5, y: row * ts + ts * 0.5 };
  }

  public start(sim: PerimeterSimulation): void {
    this.active = true;
    this.graduated = false;
    this.tier = 'CORE';
    this.stepIdx = 0;
    this.resetStageTrackers();

    sim.resetRun('ENDLESS_SIEGE', false);
    sim.trainingMode = true;
    sim.phase = 'TACTICAL_PREP';
    sim.scrap = 220;
    sim.maxReactorKw = 115;
    sim.reserveBattery = 45;
    sim.eventLogs = [
      'LOG> ★ USCM CORE CERTIFICATION DRILL (4 STAGES) — UNRANKED SIMULATOR ★',
      'LOG> CORE 01/04: SELECT [1] UA 571-C -> CLICK PULSING PAD & DRAG LEFT TO AIM.',
    ];
  }

  public startAdvancedLab(sim: PerimeterSimulation): void {
    this.active = true;
    this.graduated = false;
    this.tier = 'ADVANCED';
    this.stepIdx = 0;
    this.resetStageTrackers();

    // Ensure clean Sector 01 training state with core killbox intact
    if (!sim.trainingMode || sim.turrets.length === 0) {
      sim.resetRun('ENDLESS_SIEGE', false);
      sim.trainingMode = true;
    }
    sim.hostiles = [];
    sim.acidSpits = [];
    sim.eggSacs = [];
    sim.clearPendingSpawns();
    sim.tacticalPaused = false;
    sim.blackoutTimer = 0;
    sim.overloadTimer = 0;
    sim.maxReactorKw = Math.max(sim.maxReactorKw, 260);

    // Seed core killbox units if missing so Advanced Lab always plays cleanly
    this.ensureCoreKillboxSeeded(sim);
    this.setupStage(sim, 0);
  }

  public stop(sim: PerimeterSimulation): void {
    this.active = false;
    this.graduated = false;
    this.tier = 'CORE';
    sim.trainingMode = false;
  }

  private resetStageTrackers(): void {
    this.stepElapsedSec = 0;
    this.dronesSpawned = false;
    this.ammoDrainTriggered = false;
    this.rearmCompleted = false;
    this.visionAmbushSpawned = false;
    this.doorWeldedInStep = false;
    this.claymorePlacedInStep = false;
    this.labSkitterersSpawned = false;
    this.acidDemoSpawned = false;
    this.coolantUsedInStep = false;
    this.floodUsedInStep = false;
    this.overclockUsedInStep = false;
    this.purgeSwarmSpawned = false;
    this.purgeUsedInStep = false;
    this.stepAdvanceDelaySec = 0;
  }

  private ensureCoreKillboxSeeded(sim: PerimeterSimulation): void {
    sim.maxReactorKw = Math.max(sim.maxReactorKw, 240);
    if (!sim.turrets.some((t) => t.kind === 'SENTRY_PULSE')) {
      sim.scrap = Math.max(sim.scrap, 120);
      sim.deployHardware('SENTRY_PULSE', 12, 8, Math.PI);
    }
    if (!sim.turrets.some((t) => t.kind === 'MOTION_RELAY')) {
      sim.scrap = Math.max(sim.scrap, 80);
      sim.deployHardware('MOTION_RELAY', 9, 7, Math.PI * 0.5);
    }
    if (!sim.turrets.some((t) => t.kind === 'CRYO_VALVE')) {
      sim.scrap = Math.max(sim.scrap, 100);
      sim.deployHardware('CRYO_VALVE', 9, 9, 0);
    }
    if (!sim.turrets.some((t) => t.kind === 'RAIL_LANCE')) {
      sim.scrap = Math.max(sim.scrap, 170);
      sim.deployHardware('RAIL_LANCE', 5, 8, 0);
    }
  }

  /** Called when player clicks [SKIP STEP] or stage auto-advances */
  public advanceStep(sim: PerimeterSimulation): void {
    if (!this.active || this.graduated) return;

    this.ensurePrerequisitesBeforeLeavingStep(sim, this.stepIdx);

    sim.hostiles = [];
    sim.acidSpits = [];
    sim.eggSacs = [];
    sim.clearPendingSpawns();
    sim.tacticalPaused = false;

    this.stepIdx += 1;
    if (this.stepIdx >= this.totalSteps) {
      this.graduated = true;
      sim.phase = 'TACTICAL_PREP';
      sim.pushLog(
        this.tier === 'CORE'
          ? '★ CORE CERTIFICATION PASSED — DEPLOY RANKED SIEGE OR CONTINUE TO ADVANCED LAB! ★'
          : '★ ADVANCED SYSTEMS LAB COMPLETE — FULL USCM COMMANDER CERTIFICATION EARNED! ★'
      );
      return;
    }

    this.setupStage(sim, this.stepIdx);
  }

  private ensurePrerequisitesBeforeLeavingStep(sim: PerimeterSimulation, leavingIdx: number): void {
    if (this.tier === 'CORE') {
      if (leavingIdx === 0 && !sim.turrets.some((t) => t.kind === 'SENTRY_PULSE')) {
        sim.scrap = Math.max(sim.scrap, 120);
        sim.deployHardware('SENTRY_PULSE', 12, 8, Math.PI);
      } else if (leavingIdx === 2) {
        this.ensureCoreKillboxSeeded(sim);
      }
    }
  }

  private getPrimarySentry(sim: PerimeterSimulation) {
    return sim.turrets.find((t) => t.kind === 'SENTRY_PULSE') ?? sim.turrets[0] ?? null;
  }

  private setupStage(sim: PerimeterSimulation, idx: number): void {
    this.resetStageTrackers();
    sim.tacticalPaused = false;
    sim.blackoutTimer = 0;
    sim.overloadTimer = 0;

    if (this.tier === 'CORE') {
      switch (idx) {
        case 0: {
          sim.phase = 'TACTICAL_PREP';
          sim.scrap = Math.max(sim.scrap, 200);
          sim.pushLog('CORE 01/04 // SELECT [1] UA 571-C -> CLICK PAD (12,8) & DRAG LEFT TO AIM.');
          break;
        }
        case 1: {
          // Stage 2: Live Contact (3 Drones) + Tactical Pause tip + [E] Rearm
          sim.phase = 'WAVE_ACTIVE';
          const basePos = this.tileCenter(6, 8);
          for (let i = 0; i < 3; i++) {
            const h = sim.spawnTrainingHostile('VENT-01', 'DRONE', {
              x: basePos.x - i * 54,
              y: basePos.y + (i - 1) * 16,
            });
            h.hp = 62;
            h.maxHp = 62;
          }
          this.dronesSpawned = true;
          sim.pushLog('CORE 02/04 // 3 DRONES INBOUND! TEST [SPACE] PAUSE, THEN PRESS [E] TO REARM.');
          break;
        }
        case 2: {
          // Stage 3: Vision (M314 Relay), Cryo Valve & M99 Rail-Lance vs Stalker + Praetorian
          sim.phase = 'WAVE_ACTIVE';
          sim.scrap = Math.max(sim.scrap, 420);
          sim.maxReactorKw = Math.max(sim.maxReactorKw, 195);
          sim.flareCooldown = 0;
          sim.pushLog('CORE 03/04 // DEPLOY [6] M314 RELAY, [4] CRYO VALVE & [3] M99 RAIL-LANCE!');
          break;
        }
        case 3: {
          // Stage 4: Blast Door D-04 + MK-II [U] & MK-III [A/B] Specialization
          sim.phase = 'TACTICAL_PREP';
          sim.scrap = Math.max(sim.scrap, 650);
          sim.maxReactorKw = Math.max(sim.maxReactorKw, 250);
          this.initialSealedDoorsCount = sim.getActiveSealedDoorCount();
          if (sim.turrets.length === 0) {
            sim.deployHardware('SENTRY_PULSE', 12, 8, Math.PI);
          }
          sim.pushLog('CORE 04/04 // WELD DOOR D-04 [7], THEN UPGRADE A TURRET TO MK-III [U -> A/B]!');
          break;
        }
      }
      return;
    }

    // TIER 2: ADVANCED SYSTEMS LAB (4 Stages)
    switch (idx) {
      case 0: {
        // Lab 1: Arc-Shock Coil [5] + M18 Claymore [8] vs Skitterer breach
        sim.phase = 'WAVE_ACTIVE';
        sim.scrap = Math.max(sim.scrap, 260);
        sim.maxReactorKw = Math.max(sim.maxReactorKw, 270);
        sim.claymoresRemainingThisWave = Math.max(sim.claymoresRemainingThisWave, 6);
        this.initialClaymoreCount = sim.claymores.length;
        sim.pushLog('LAB 01/04 // MOUNT [5] ARC COIL ON NORTH GRATE & ARM [8] M18 CLAYMORE BY GRATE-02!');
        break;
      }
      case 1: {
        // Lab 2: M240 Incinerator [2] (+15S Acid Sterilization) + [C] Coolant Flush
        sim.phase = 'WAVE_ACTIVE';
        sim.scrap = Math.max(sim.scrap, 240);
        sim.maxReactorKw = Math.max(sim.maxReactorKw, 290);
        sim.coolantFlushCooldown = 0;
        for (const t of sim.turrets) {
          if (t.kind === 'SENTRY_PULSE' || t.kind === 'RAIL_LANCE') {
            t.heat = Math.max(t.heat, 72);
          }
        }
        sim.pushLog('LAB 02/04 // DEPLOY [2] M240 INCINERATOR AIMED UP (+15S ACID STERILIZE), THEN [C] FLUSH!');
        break;
      }
      case 2: {
        // Lab 3: Reserve Battery [L] Floodlight & [O] Overclock Surge
        sim.phase = 'WAVE_ACTIVE';
        sim.reserveBattery = 88;
        sim.floodlightCooldown = 0;
        sim.overclockCooldown = 0;
        sim.pushLog('LAB 03/04 // TRIGGER [L] FLOODLIGHT (40% BAT) & [O] OVERCLOCK ON YOUR KILLBOX!');
        break;
      }
      case 3: {
        // Lab 4: [V] Airlock Vent Purge on AIRLOCK W-01 (2X Score decompression flush)
        sim.phase = 'WAVE_ACTIVE';
        sim.purgeChargesRemaining = Math.max(1, sim.purgeChargesRemaining);
        sim.purgeAvailableThisWave = true;
        const al = sim.blueprint.airlocks[0];
        if (al) {
          for (let i = 0; i < 6; i++) {
            const sk = sim.spawnTrainingHostile('VENT-01', 'SKITTERER', {
              x: al.bounds.x + 28 + (i % 2) * 44,
              y: al.bounds.y + 34 + Math.floor(i / 2) * 34,
            });
            sk.speedPxS = 8;
            sk.hp = 26;
            sk.maxHp = 26;
          }
          this.purgeSwarmSpawned = true;
        }
        sim.pushLog('LAB 04/04 // SWARM TRAPPED IN AIRLOCK W-01 — PRESS [V] & CLICK AIRLOCK TO PURGE!');
        break;
      }
    }
  }

  public validatePlacement(
    sim: PerimeterSimulation,
    buildId: Exclude<BuildToolId, 'NONE'>,
    col: number,
    row: number,
    angle: number
  ): { ok: boolean; reason?: string } {
    if (!this.active || this.graduated) return { ok: true };
    const snap = this.getSnapshot(sim);

    if (!snap.allowedBuildIds.includes(buildId)) {
      const req = snap.allowedBuildIds[0];
      const reqName = req ? `[${HARDWARE_SPECS[req].shortKey}] ${HARDWARE_SPECS[req].code}` : 'CURRENT OBJECTIVE';
      return { ok: false, reason: `DRILL LOCK: USE ${reqName} FOR THIS STEP` };
    }

    const rule = snap.activePlacementRule;
    if (!rule || rule.buildId !== buildId) return { ok: true };

    if (buildId === 'ARC_WELDER' && rule.doorId) {
      const door = sim.findDoorAtTile(col, row);
      if (!door || door.def.id !== rule.doorId) {
        return { ok: false, reason: `CLICK GLOWING BLAST DOOR ${rule.doorId} TO WELD IT!` };
      }
      return { ok: true };
    }

    if (buildId === 'CLAYMORE') {
      const dist = Math.hypot(col - rule.col, row - rule.row);
      if (dist > 1.5) {
        return { ok: false, reason: 'PLACE [8] M18 CLAYMORE ON THE PULSING CORRIDOR BY GRATE-02!' };
      }
      return { ok: true };
    }

    if (col !== rule.col || row !== rule.row) {
      return {
        ok: false,
        reason:
          buildId === 'CRYO_VALVE' || buildId === 'SHOCK_COIL'
            ? 'MOUNT ON THE PULSING DUCT GRATE!'
            : 'DEPLOY ON THE PULSING TARGET PAD!',
      };
    }

    if (rule.targetAngle !== undefined && rule.angleToleranceRad !== undefined) {
      const diff = Math.abs(normalizeAngle(angle - rule.targetAngle));
      if (diff > rule.angleToleranceRad) {
        return {
          ok: false,
          reason: `AIM ${rule.aimHint ?? 'ALONG THE GUIDE CONE'}! HOLD & DRAG INTO THE CORRIDOR`,
        };
      }
    }

    return { ok: true };
  }

  public isAngleWithinActiveRule(
    sim: PerimeterSimulation,
    buildId: Exclude<BuildToolId, 'NONE'>,
    col: number,
    row: number,
    angle: number
  ): { enforced: boolean; valid: boolean; hint?: string } {
    if (!this.active || this.graduated) return { enforced: false, valid: true };
    const rule = this.getSnapshot(sim).activePlacementRule;
    if (!rule || rule.buildId !== buildId) return { enforced: false, valid: true };
    if (buildId === 'CLAYMORE') {
      const ok = Math.hypot(col - rule.col, row - rule.row) <= 1.5;
      return { enforced: true, valid: ok, hint: 'BY GRATE-02' };
    }
    if (col !== rule.col || row !== rule.row) return { enforced: true, valid: false, hint: 'USE PULSING PAD' };
    if (rule.targetAngle === undefined || rule.angleToleranceRad === undefined) {
      return { enforced: false, valid: true };
    }
    const diff = Math.abs(normalizeAngle(angle - rule.targetAngle));
    return {
      enforced: true,
      valid: diff <= rule.angleToleranceRad,
      hint: rule.aimHint,
    };
  }

  public validateTargetedAbility(
    sim: PerimeterSimulation,
    abilityId: CommandAbilityId,
    targetPos: Vec2
  ): { ok: boolean; reason?: string } {
    if (!this.active || this.graduated) return { ok: true };
    const snap = this.getSnapshot(sim);

    if (!snap.allowedAbilityIds.includes(abilityId)) {
      return { ok: false, reason: 'DRILL LOCK: COMPLETE CURRENT OBJECTIVE FIRST' };
    }

    const zone = snap.activeAbilityZone;
    if (!zone || zone.abilityId !== abilityId) return { ok: true };

    if (zone.airlockId) {
      const chamber = sim.findAirlockAt(targetPos);
      if (!chamber || chamber.id !== zone.airlockId) {
        return { ok: false, reason: `CLICK PULSING ${zone.label} TO PURGE THE SWARM!` };
      }
      return { ok: true };
    }

    const d = Math.hypot(targetPos.x - zone.center.x, targetPos.y - zone.center.y);
    if (d > zone.radiusPx) {
      return { ok: false, reason: `CLICK INSIDE THE PULSING ${zone.label} ZONE!` };
    }
    return { ok: true };
  }

  public notifyAbilityUsed(abilityId: CommandAbilityId): void {
    if (!this.active || this.graduated) return;
    if (this.tier === 'ADVANCED') {
      if (this.stepIdx === 1 && abilityId === 'COOLANT_FLUSH') {
        this.coolantUsedInStep = true;
      } else if (this.stepIdx === 2 && abilityId === 'FLOODLIGHT') {
        this.floodUsedInStep = true;
      } else if (this.stepIdx === 2 && abilityId === 'OVERCLOCK') {
        this.overclockUsedInStep = true;
      } else if (this.stepIdx === 3 && abilityId === 'PURGE') {
        this.purgeUsedInStep = true;
      }
    }
  }

  public notifyRearmTriggered(): void {
    if (!this.active || this.graduated) return;
    if (this.tier === 'CORE' && this.stepIdx === 1 && this.ammoDrainTriggered) {
      this.rearmCompleted = true;
    }
  }

  public notifyClaymorePlaced(): void {
    if (!this.active || this.graduated) return;
    if (this.tier === 'ADVANCED' && this.stepIdx === 0) {
      this.claymorePlacedInStep = true;
    }
  }

  public step(sim: PerimeterSimulation, dt: number): void {
    if (!this.active || this.graduated) return;
    this.stepElapsedSec += dt;

    if (this.stepAdvanceDelaySec > 0) {
      this.stepAdvanceDelaySec -= dt;
      if (this.stepAdvanceDelaySec <= 0) {
        this.advanceStep(sim);
      }
      return;
    }

    if (this.tier === 'CORE') {
      this.stepCore(sim);
    } else {
      this.stepAdvanced(sim);
    }
  }

  private stepCore(sim: PerimeterSimulation): void {
    // Keep Scrap topped up gently so trainees can never soft-lock
    if (this.stepIdx === 0 && sim.scrap < 100 && !sim.turrets.some((t) => t.kind === 'SENTRY_PULSE')) {
      sim.scrap = 140;
    } else if (this.stepIdx === 2 && sim.scrap < 200) {
      const hasRelay = sim.turrets.some((t) => t.kind === 'MOTION_RELAY');
      const hasCryo = sim.turrets.some((t) => t.kind === 'CRYO_VALVE');
      const hasRail = sim.turrets.some((t) => t.kind === 'RAIL_LANCE');
      if (!hasRelay || !hasCryo || !hasRail) sim.scrap = Math.max(sim.scrap, 340);
    } else if (this.stepIdx === 3 && sim.scrap < 360 && !sim.turrets.some((t) => t.level === 3)) {
      sim.scrap = 560;
    }

    switch (this.stepIdx) {
      case 0: {
        if (sim.turrets.some((t) => t.kind === 'SENTRY_PULSE')) {
          this.triggerStageSuccess(sim, 'UA 571-C SENTRY LOCKED ON WEST APPROACH — LAUNCHING LIVE CONTACT!');
        }
        break;
      }

      case 1: {
        if (this.dronesSpawned && !this.ammoDrainTriggered && sim.hostiles.length === 0) {
          this.ammoDrainTriggered = true;
          const s = this.getPrimarySentry(sim);
          if (s && s.kind === 'SENTRY_PULSE') {
            s.ammo = Math.min(s.ammo, 68);
            sim.scrap = Math.max(sim.scrap, 120);
            sim.pushLog('CORE 02/04 // DRONES DOWN! SENTRY LOW AMMO — PRESS [E] TO REARM!');
          } else {
            this.rearmCompleted = true;
          }
        }
        const sCheck = this.getPrimarySentry(sim);
        if (
          this.ammoDrainTriggered &&
          (this.rearmCompleted ||
            (sCheck && (sCheck.rearmTimer > 0 || sCheck.ammo >= sCheck.maxAmmo)))
        ) {
          this.rearmCompleted = true;
          this.triggerStageSuccess(sim, 'BELT-LOADER REARM VERIFIED — ADVANCING TO VISION & KILLBOX DRILL!');
        }
        break;
      }

      case 2: {
        const hasRelay = sim.turrets.some((t) => t.kind === 'MOTION_RELAY');
        const hasCryo = sim.turrets.some((t) => t.kind === 'CRYO_VALVE');
        const hasRail = sim.turrets.some((t) => t.kind === 'RAIL_LANCE');

        if (hasRelay && hasCryo && hasRail && !this.visionAmbushSpawned) {
          this.visionAmbushSpawned = true;
          const spawnPos = this.tileCenter(6, 8);
          const stalker = sim.spawnTrainingHostile('VENT-01', 'STALKER', {
            x: spawnPos.x + 22,
            y: spawnPos.y - 12,
          });
          stalker.hp = 72;
          stalker.maxHp = 72;

          const prt = sim.spawnTrainingHostile('VENT-01', 'PRAETORIAN', {
            x: spawnPos.x - 16,
            y: spawnPos.y + 8,
          });
          prt.hp = 295;
          prt.maxHp = 295;
          sim.pushLog('CORE 03/04 // CLOAKED STALKER & ARMORED PRAETORIAN INBOUND — WATCH TRIPWIRE + RAIL SHATTER THEM!');
        }

        if (hasRelay && hasCryo && hasRail && this.visionAmbushSpawned && sim.hostiles.length === 0) {
          this.triggerStageSuccess(sim, 'VISION + CRYO + RAIL KILLBOX CONFIRMED — FINAL CORE MODULE READY!');
        }
        break;
      }

      case 3: {
        if (sim.getActiveSealedDoorCount() > this.initialSealedDoorsCount) {
          this.doorWeldedInStep = true;
        }
        const hasMk3 = sim.turrets.some((t) => t.level === 3);
        if (this.doorWeldedInStep && hasMk3) {
          this.triggerStageSuccess(sim, 'DOOR SEAL & MK-III SPECIALIZATION VERIFIED — CORE CERTIFICATION COMPLETE!');
        }
        break;
      }
    }
  }

  private stepAdvanced(sim: PerimeterSimulation): void {
    if (this.stepIdx === 0 && sim.scrap < 150) {
      sim.scrap = 200;
    } else if (this.stepIdx === 1 && sim.scrap < 140 && !sim.turrets.some((t) => t.kind === 'INCINERATOR')) {
      sim.scrap = 180;
    }

    switch (this.stepIdx) {
      case 0: {
        const hasCoil = sim.turrets.some((t) => t.kind === 'SHOCK_COIL');
        if (sim.claymores.length > this.initialClaymoreCount) {
          this.claymorePlacedInStep = true;
        }
        if (hasCoil && this.claymorePlacedInStep && !this.labSkitterersSpawned) {
          this.labSkitterersSpawned = true;
          const northPt = this.tileCenter(15, 2);
          const gratePt = this.tileCenter(7, 8);
          for (let i = 0; i < 3; i++) {
            const s1 = sim.spawnTrainingHostile('GRATE-01', 'SKITTERER', {
              x: northPt.x + (i - 1) * 18,
              y: northPt.y + 12,
            });
            s1.hp = 24;
            s1.maxHp = 24;
            const s2 = sim.spawnTrainingHostile('GRATE-02', 'SKITTERER', {
              x: gratePt.x + (i - 1) * 12,
              y: gratePt.y + (i - 1) * 10,
            });
            s2.hp = 24;
            s2.maxHp = 24;
          }
          sim.pushLog('LAB 01/04 // SUB-FLOOR SKITTERERS ERUPTING — WATCH ARC COIL & CLAYMORE CLEAR THEM!');
        }
        if (hasCoil && this.claymorePlacedInStep && this.labSkitterersSpawned && sim.hostiles.length === 0) {
          this.triggerStageSuccess(sim, 'ARC COIL & CLAYMORE GRATE DEFENSE VERIFIED!');
        }
        break;
      }

      case 1: {
        const incin = sim.turrets.find((t) => t.kind === 'INCINERATOR');
        if (incin && !this.acidDemoSpawned) {
          this.acidDemoSpawned = true;
          const targetPt = this.tileCenter(9, 9);
          sim.spawnTrainingAcidPool(targetPt, 58);
          for (let i = 0; i < 2; i++) {
            const b = sim.spawnTrainingHostile('VENT-01', 'BURSTER', {
              x: targetPt.x + (i === 0 ? -18 : 18),
              y: targetPt.y - 12,
            });
            b.hp = 195;
            b.maxHp = 195;
          }
          sim.pushLog('LAB 02/04 // NAPALM STERILIZING ACID FOR +15 BONUS SCRAP — TRIGGER [C] COOLANT FLUSH!');
        }
        if (incin && this.coolantUsedInStep && this.acidDemoSpawned && sim.hostiles.length === 0) {
          this.triggerStageSuccess(sim, 'ACID STERILIZATION (+15S) & COOLANT FLUSH MASTERED!');
        }
        break;
      }

      case 2: {
        if (sim.floodlightTimer > 0) this.floodUsedInStep = true;
        if (sim.activeOverclockSurgeTimer > 0) this.overclockUsedInStep = true;
        if (!this.floodUsedInStep && sim.reserveBattery < 65) {
          sim.reserveBattery = 85;
        }
        if (this.floodUsedInStep && this.overclockUsedInStep) {
          this.triggerStageSuccess(sim, 'FLOODLIGHT & OVERCLOCK SURGE MASTERED — FINAL PURGE TEST!');
        }
        break;
      }

      case 3: {
        if (!this.purgeUsedInStep) {
          sim.purgeChargesRemaining = Math.max(1, sim.purgeChargesRemaining);
          sim.purgeAvailableThisWave = true;
        }
        if (this.purgeSwarmSpawned && this.purgeUsedInStep) {
          this.triggerStageSuccess(sim, 'AIRLOCK DECOMPRESSION PURGE EXECUTED — ADVANCED LAB COMPLETE!');
        }
        break;
      }
    }
  }

  private triggerStageSuccess(sim: PerimeterSimulation, msg: string): void {
    if (this.stepAdvanceDelaySec > 0) return;
    sim.audioCb.onUpgradeConfirm(this.stepIdx === this.totalSteps - 1);
    sim.pushLog(`✓ ${msg}`);
    this.stepAdvanceDelaySec = 1.25;
  }

  public getSnapshot(sim: PerimeterSimulation): TutorialDirectiveSnapshot {
    if (!this.active) {
      return {
        active: false,
        graduated: false,
        tier: this.tier,
        canStartAdvancedLab: false,
        stepIndex: 0,
        totalSteps: this.totalSteps,
        code: '',
        title: '',
        briefingLines: [],
        objectives: [],
        beacons: [],
        highlightButtonIds: [],
        allowedBuildIds: [],
        allowedAbilityIds: [],
        allowRearm: true,
        allowUpgrade: true,
        allowDoorInspect: true,
        activePlacementRule: null,
        activeAbilityZone: null,
        wikiChapterIdx: 0,
        showContinueBtn: false,
        continueLabel: '',
      };
    }

    if (this.graduated) {
      const isCoreGrad = this.tier === 'CORE';
      return {
        active: true,
        graduated: true,
        tier: this.tier,
        canStartAdvancedLab: isCoreGrad,
        stepIndex: this.totalSteps,
        totalSteps: this.totalSteps,
        code: isCoreGrad ? 'CORE CERTIFIED' : 'LAB MASTERED',
        title: isCoreGrad
          ? 'CORE CERTIFICATION COMPLETE (4/4)'
          : 'ADVANCED SYSTEMS LAB COMPLETE (4/4)',
        briefingLines: isCoreGrad
          ? [
              'You mastered Sentry aiming, Tactical Pause & Rearm, M314 Vision, Cryo + Rail-Lance armor piercing, Blast Doors, and MK-III Specializations.',
              'Launch Ranked Endless Siege now, or continue to the optional 4-Stage Advanced Systems Lab (Arc Coil, Claymore, Acid Sterilize, Overclock & Airlock Purge).',
            ]
          : [
              'You mastered all USCM hardware and reactor engineering systems: Arc Coils, Claymores, +15S Acid Sterilization, Coolant Flush, Floodlight, Overclock, and 2X Airlock Purges.',
              'You are fully cleared for Ranked Endless Hive Siege — watch for Hull Breaches on W5/15/25 and Sector Extractions on W11/21/31!',
            ],
        objectives: [],
        beacons: [],
        highlightButtonIds: [],
        allowedBuildIds: [],
        allowedAbilityIds: [],
        allowRearm: false,
        allowUpgrade: false,
        allowDoorInspect: false,
        activePlacementRule: null,
        activeAbilityZone: null,
        wikiChapterIdx: isCoreGrad ? 2 : 7,
        showContinueBtn: false,
        continueLabel: '',
      };
    }

    const corePos = sim.blueprint.coreCenter;
    const sentryPadPos = this.tileCenter(12, 8);
    const relayPadPos = this.tileCenter(9, 7);
    const cryoGratePos = this.tileCenter(9, 9);
    const railPadPos = this.tileCenter(5, 8);
    const doorD04 = sim.doors.get('D-04')?.def.center ?? this.tileCenter(11, 8);
    const shockGratePos = this.tileCenter(15, 4);
    const claymorePos = this.tileCenter(8, 8);
    const incinPadPos = this.tileCenter(9, 10);
    const airlockW01 = sim.blueprint.airlocks[0]?.center ?? this.tileCenter(4, 8);

    if (this.tier === 'CORE') {
      switch (this.stepIdx) {
        case 0: {
          const placed = sim.turrets.some((t) => t.kind === 'SENTRY_PULSE');
          const rule: TutorialPlacementRule = {
            buildId: 'SENTRY_PULSE',
            col: 12,
            row: 8,
            targetAngle: Math.PI,
            angleToleranceRad: (32 * Math.PI) / 180,
            aimHint: 'LEFT (WEST) DOWN THE CORRIDOR',
          };
          return {
            active: true,
            graduated: false,
            tier: 'CORE',
            canStartAdvancedLab: false,
            stepIndex: 0,
            totalSteps: this.totalSteps,
            code: 'CORE 01/04',
            title: 'DEPLOY & AIM YOUR FIRST UA 571-C SENTRY',
            briefingLines: [
              'Protect the central Reactor Core (3 Bulkhead Seals). Select [1] UA 571-C on the right, click the pulsing [+] pad, HOLD & DRAG LEFT into the corridor guide cone, then release.',
              'Solid inner arc = 55% dark vision; dashed outer arc = 100% range when lit. Turrets cannot shoot through walls or the opaque Core.',
            ],
            objectives: [
              { text: 'Deploy [1] UA 571-C on the pulsing pad aimed LEFT down West Approach', done: placed },
            ],
            beacons: placed
              ? []
              : [
                  { pos: corePos, label: 'CORE (3 SEALS)', color: '#44FF77', radiusPx: 54 },
                  { pos: sentryPadPos, label: 'CLICK & DRAG LEFT', color: '#FFB000', radiusPx: 34 },
                ],
            highlightButtonIds: placed ? [] : ['build-SENTRY_PULSE'],
            allowedBuildIds: placed ? [] : ['SENTRY_PULSE'],
            allowedAbilityIds: [],
            allowRearm: false,
            allowUpgrade: false,
            allowDoorInspect: false,
            activePlacementRule: placed ? null : rule,
            activeAbilityZone: null,
            wikiChapterIdx: 0,
            showContinueBtn: false,
            continueLabel: '',
          };
        }

        case 1: {
          const dronesCleared = this.dronesSpawned && sim.hostiles.length === 0;
          return {
            active: true,
            graduated: false,
            tier: 'CORE',
            canStartAdvancedLab: false,
            stepIndex: 1,
            totalSteps: this.totalSteps,
            code: 'CORE 02/04',
            title: 'LIVE COMBAT, TACTICAL PAUSE [SPACE] & REARM [E]',
            briefingLines: [
              '3 Xeno Drones are rushing West Approach. Watch your Sentry burn rounds on the Left Weapons Rack — press [SPACE] anytime mid-wave to Tactical Pause while still issuing orders.',
              'Once the Drones drop, press [E] (or click [E] REARM ALL on the left) to feed a fresh ammo belt.',
            ],
            objectives: [
              { text: 'Watch your Sentry neutralize all 3 approaching Xeno Drones', done: dronesCleared },
              {
                text: dronesCleared
                  ? 'Press [E] (or click [E] REARM ALL) to reload your Sentry!'
                  : 'Wait for Drones to drop, then rearm your Sentry with [E]',
                done: this.rearmCompleted,
              },
            ],
            beacons: this.getPrimarySentry(sim)
              ? [
                  {
                    pos: this.getPrimarySentry(sim)!.pos,
                    label: dronesCleared ? 'PRESS [E] TO REARM!' : 'ENGAGING WEST LANE',
                    color: dronesCleared ? '#FFB000' : '#44FF77',
                    radiusPx: 34,
                  },
                ]
              : [],
            highlightButtonIds: dronesCleared ? ['rearm-all', 'insp-rearm'] : [],
            allowedBuildIds: [],
            allowedAbilityIds: [],
            allowRearm: dronesCleared,
            allowUpgrade: false,
            allowDoorInspect: false,
            activePlacementRule: null,
            activeAbilityZone: null,
            wikiChapterIdx: 0,
            showContinueBtn: false,
            continueLabel: '',
          };
        }

        case 2: {
          const hasRelay = sim.turrets.some((t) => t.kind === 'MOTION_RELAY');
          const hasCryo = sim.turrets.some((t) => t.kind === 'CRYO_VALVE');
          const hasRail = sim.turrets.some((t) => t.kind === 'RAIL_LANCE');
          const ambushDead = this.visionAmbushSpawned && sim.hostiles.length === 0;

          const relayRule: TutorialPlacementRule = {
            buildId: 'MOTION_RELAY',
            col: 9,
            row: 7,
            targetAngle: Math.PI * 0.5,
            angleToleranceRad: (32 * Math.PI) / 180,
            aimHint: 'DOWN (SOUTH) ACROSS THE CORRIDOR',
          };
          const cryoRule: TutorialPlacementRule = {
            buildId: 'CRYO_VALVE',
            col: 9,
            row: 9,
          };
          const railRule: TutorialPlacementRule = {
            buildId: 'RAIL_LANCE',
            col: 5,
            row: 8,
            targetAngle: 0,
            angleToleranceRad: (24 * Math.PI) / 180,
            aimHint: 'RIGHT (EAST) STRAIGHT DOWN THE HALLWAY',
          };

          const activeRule = !hasRelay ? relayRule : !hasCryo ? cryoRule : !hasRail ? railRule : null;
          return {
            active: true,
            graduated: false,
            tier: 'CORE',
            canStartAdvancedLab: false,
            stepIndex: 2,
            totalSteps: this.totalSteps,
            code: 'CORE 03/04',
            title: 'VISION [6] M314, [4] CRYO VALVE & [3] M99 RAIL-LANCE',
            briefingLines: [
              !hasRelay
                ? 'Step A: Select [6] M314 RELAY on the top pad & DRAG DOWN so its red Laser Tripwire spans the corridor — decloaking Stalkers and linking nearby guns (+24% Range).'
                : !hasCryo
                  ? 'Step B: Heavy Praetorians deflect 70% of frontal Sentry fire. Mount [4] CRYO VALVE on the green Duct Grate (58% slow + 35% Shatter crit!).'
                  : !hasRail
                    ? 'Step C: Deploy [3] M99 RAIL-LANCE on the west-end pad aimed RIGHT (EAST) down the long hallway — 100% armor pierce across 4 lined targets!'
                    : 'Killbox armed! Watch M314 Tripwire decloak the Signal Stalker while Cryo + Rail-Lance shatter the armored Praetorian.',
              'Tip: Optical lighting (M314, [F] Flare, [L] Floodlight) unlocks 100% range, +20% crit, and removes Signal Stalker stealth.',
            ],
            objectives: [
              { text: 'Place [6] M314 Relay aimed DOWN (Laser Tripwire across corridor)', done: hasRelay },
              { text: 'Mount [4] Cryo Valve on Grate & [3] M99 Rail-Lance aimed RIGHT', done: hasCryo && hasRail },
              { text: 'Decloak & shatter the Signal Stalker and Armored Praetorian', done: ambushDead },
            ],
            beacons: !hasRelay
              ? [{ pos: relayPadPos, label: 'M314 -> DRAG DOWN', color: '#44FF77', radiusPx: 34 }]
              : !hasCryo
                ? [{ pos: cryoGratePos, label: '[4] CRYO ON GRATE', color: '#4CEEFF', radiusPx: 34 }]
                : !hasRail
                  ? [{ pos: railPadPos, label: 'RAIL -> DRAG RIGHT', color: '#4CEEFF', radiusPx: 34 }]
                  : [],
            highlightButtonIds: !hasRelay
              ? ['build-MOTION_RELAY']
              : !hasCryo
                ? ['build-CRYO_VALVE']
                : !hasRail
                  ? ['build-RAIL_LANCE']
                  : [],
            allowedBuildIds: !hasRelay
              ? ['MOTION_RELAY']
              : !hasCryo
                ? ['CRYO_VALVE']
                : !hasRail
                  ? ['RAIL_LANCE']
                  : [],
            allowedAbilityIds: hasRelay && hasCryo && hasRail ? ['FLARE'] : [],
            allowRearm: true,
            allowUpgrade: false,
            allowDoorInspect: false,
            activePlacementRule: activeRule,
            activeAbilityZone: null,
            wikiChapterIdx: 1,
            showContinueBtn: false,
            continueLabel: '',
          };
        }

        case 3:
        default: {
          const hasMk2 = sim.turrets.some((t) => t.level >= 2);
          const hasMk3 = sim.turrets.some((t) => t.level === 3);
          const doorRule: TutorialPlacementRule = {
            buildId: 'ARC_WELDER',
            col: 11,
            row: 8,
            doorId: 'D-04',
          };
          const targetT =
            sim.turrets.find((t) => t.level === 2) ??
            sim.turrets.find((t) => t.level < 3) ??
            sim.turrets[0];

          return {
            active: true,
            graduated: false,
            tier: 'CORE',
            canStartAdvancedLab: false,
            stepIndex: 3,
            totalSteps: this.totalSteps,
            code: 'CORE 04/04',
            title: 'BLAST DOORS [7] & MK-II / MK-III UPGRADES [U / A / B]',
            briefingLines: [
              !this.doorWeldedInStep
                ? 'Step A: Select [7] DOOR SEAL and weld Blast Door D-04. Doors shape tempo and divert standard swarms — remember Sappers & Heavies will batter sealed doors, so defend forward lanes!'
                : !hasMk2
                  ? 'Step B: Click a turret on the map (or Left Rack) and press [U] (or click MK-II) for a 0-kW power boost!'
                  : 'Step C: Press [A] or [B] (or click Branch A / B in the Unit Inspector) to lock a permanent MK-III Specialization and graduate!',
              'In Ranked waves, every 3rd wave grants a Protocol Draft — press [SPACE] inside Drafts to peek at your map, or [H] anytime for Controls.',
            ],
            objectives: [
              { text: 'Select [7] DOOR SEAL and click Blast Door D-04', done: this.doorWeldedInStep },
              { text: 'Click a turret -> upgrade MK-II [U] -> pick MK-III Branch [A] or [B]', done: hasMk3 },
            ],
            beacons: !this.doorWeldedInStep
              ? [{ pos: doorD04, label: '[7] WELD DOOR D-04', color: '#FFB000', radiusPx: 38 }]
              : targetT
                ? [
                    {
                      pos: targetT.pos,
                      label: hasMk2 ? 'PICK MK-III [A] / [B]' : 'CLICK -> UPGRADE [U]',
                      color: '#4CEEFF',
                      radiusPx: 36,
                    },
                  ]
                : [],
            highlightButtonIds: !this.doorWeldedInStep
              ? ['build-ARC_WELDER']
              : hasMk2
                ? ['insp-upgrade-a', 'insp-upgrade-b']
                : ['insp-upgrade'],
            allowedBuildIds: !this.doorWeldedInStep ? ['ARC_WELDER'] : [],
            allowedAbilityIds: [],
            allowRearm: true,
            allowUpgrade: this.doorWeldedInStep,
            allowDoorInspect: false,
            activePlacementRule: !this.doorWeldedInStep ? doorRule : null,
            activeAbilityZone: null,
            wikiChapterIdx: 2,
            showContinueBtn: false,
            continueLabel: '',
          };
        }
      }
    }

    // TIER 2: ADVANCED SYSTEMS LAB SNAPSHOTS
    switch (this.stepIdx) {
      case 0: {
        const hasCoil = sim.turrets.some((t) => t.kind === 'SHOCK_COIL');
        const skitsDead = this.labSkitterersSpawned && sim.hostiles.length === 0;
        const coilRule: TutorialPlacementRule = {
          buildId: 'SHOCK_COIL',
          col: 15,
          row: 4,
        };
        const claymoreRule: TutorialPlacementRule = {
          buildId: 'CLAYMORE',
          col: 8,
          row: 8,
        };
        return {
          active: true,
          graduated: false,
          tier: 'ADVANCED',
          canStartAdvancedLab: false,
          stepIndex: 0,
          totalSteps: this.totalSteps,
          code: 'LAB 01/04',
          title: '[5] ARC-SHOCK COIL & [8] M18 CLAYMORE GRATE DEFENSE',
          briefingLines: [
            !hasCoil
              ? 'Step A: Select [5] ARC COIL and mount it on the pulsing North Duct Grate — chains wave-scaling lightning, stuns, and decloaks Stalkers!'
              : !this.claymorePlacedInStep
                ? 'Step B: Select [8] M18 MINE (0 kW!) and arm it on the pulsing corridor beside hazard-striped GRATE-02 to ambush erupting Skitterers!'
                : 'Ambush armed! Watch your Arc Coil and M18 Claymore obliterate the sub-floor Skitterer breach.',
            'Hazard-striped Spawn Grates rattle for 5s before erupting — never build turrets on them, mine or cover them instead!',
          ],
          objectives: [
            { text: 'Mount [5] Arc-Shock Coil on the pulsing North Duct Grate', done: hasCoil },
            { text: 'Arm [8] M18 Claymore on the pulsing corridor beside GRATE-02', done: this.claymorePlacedInStep },
            { text: 'Eliminate both erupting Skitterer packs', done: skitsDead },
          ],
          beacons: !hasCoil
            ? [{ pos: shockGratePos, label: '[5] ARC COIL ON GRATE', color: '#4CEEFF', radiusPx: 34 }]
            : !this.claymorePlacedInStep
              ? [{ pos: claymorePos, label: '[8] ARM CLAYMORE HERE', color: '#FFB000', radiusPx: 34 }]
              : [],
          highlightButtonIds: !hasCoil
            ? ['build-SHOCK_COIL']
            : !this.claymorePlacedInStep
              ? ['build-CLAYMORE']
              : [],
          allowedBuildIds: !hasCoil
            ? ['SHOCK_COIL']
            : !this.claymorePlacedInStep
              ? ['CLAYMORE']
              : [],
          allowedAbilityIds: [],
          allowRearm: true,
          allowUpgrade: false,
          allowDoorInspect: false,
          activePlacementRule: !hasCoil ? coilRule : !this.claymorePlacedInStep ? claymoreRule : null,
          activeAbilityZone: null,
          wikiChapterIdx: 2,
          showContinueBtn: false,
          continueLabel: '',
        };
      }

      case 1: {
        const hasIncin = sim.turrets.some((t) => t.kind === 'INCINERATOR');
        const burstersDead = this.acidDemoSpawned && sim.hostiles.length === 0;
        const incinRule: TutorialPlacementRule = {
          buildId: 'INCINERATOR',
          col: 9,
          row: 10,
          targetAngle: -Math.PI * 0.5,
          angleToleranceRad: (32 * Math.PI) / 180,
          aimHint: 'UP (NORTH) INTO WEST JUNCTION',
        };
        return {
          active: true,
          graduated: false,
          tier: 'ADVANCED',
          canStartAdvancedLab: false,
          stepIndex: 1,
          totalSteps: this.totalSteps,
          code: 'LAB 02/04',
          title: '[2] INCINERATOR ACID STERILIZE (+15S) & [C] COOLANT FLUSH',
          briefingLines: [
            !hasIncin
              ? 'Step A: Select [2] M240 INCIN on the South pad & DRAG UP (NORTH). Napalm melts armor and sterilizes Acid Pools for +15 BONUS SCRAP (+12 flat extra per THERMITE stack)!'
              : 'Step B: Press [C] (or click [C] FLUSH) to instantly vent -78 barrel heat across all guns and wash off Spitter Acid!',
            'Acid Bursters leave corrosive pools that slow nearby guns and block Claymores — Incinerators turn acid hazards into Scrap.',
          ],
          objectives: [
            { text: 'Deploy [2] M240 Incinerator on South pad aimed UP into junction', done: hasIncin },
            { text: 'Trigger [C] COOLANT FLUSH to vent barrel heat & cleanse acid', done: this.coolantUsedInStep },
            { text: 'Incinerate the Acid Bursters & sterilize the pool', done: burstersDead },
          ],
          beacons: !hasIncin
            ? [{ pos: incinPadPos, label: 'INCIN -> DRAG UP', color: '#FFB000', radiusPx: 34 }]
            : [],
          highlightButtonIds: !hasIncin
            ? ['build-INCINERATOR']
            : !this.coolantUsedInStep
              ? ['ability-COOLANT_FLUSH']
              : [],
          allowedBuildIds: !hasIncin ? ['INCINERATOR'] : [],
          allowedAbilityIds: hasIncin && !this.coolantUsedInStep ? ['COOLANT_FLUSH'] : [],
          allowRearm: true,
          allowUpgrade: false,
          allowDoorInspect: false,
          activePlacementRule: !hasIncin ? incinRule : null,
          activeAbilityZone: null,
          wikiChapterIdx: 3,
          showContinueBtn: false,
          continueLabel: '',
        };
      }

      case 2: {
        const ocZone: TutorialAbilityZoneRule = {
          abilityId: 'OVERCLOCK',
          center: this.tileCenter(9, 8),
          radiusPx: 640,
          label: 'TURRET SECTOR',
        };
        return {
          active: true,
          graduated: false,
          tier: 'ADVANCED',
          canStartAdvancedLab: false,
          stepIndex: 2,
          totalSteps: this.totalSteps,
          code: 'LAB 03/04',
          title: 'RESERVE BATTERY [L] FLOODLIGHT & [O] OVERCLOCK SURGE',
          briefingLines: [
            !this.floodUsedInStep
              ? 'Step A: Unused Free kW charges your cyan Reserve Battery. Press [L] to spend 40% Battery for 7.5s map-wide vision, +25% crit, and instant Screamer jam purge!'
              : 'Step B: Press [O] and click near your turrets (or double-tap [O] on a selected turret) for 2X Fire Rate — Reserve Battery buffers the +22 kW surge!',
            'If overload drains Battery to 0%, tap [X] SHED AUX or [K] power off a unit before the 4.0s Breaker Trip causes a 3.5s Blackout.',
          ],
          objectives: [
            { text: 'Press [L] (or click [L] FLOOD) for 7.5s map-wide full vision', done: this.floodUsedInStep },
            { text: 'Press [O] OVERCLOCK & click near any turret (+22 kW · 2X ROF)', done: this.overclockUsedInStep },
          ],
          beacons:
            this.floodUsedInStep && !this.overclockUsedInStep
              ? [{ pos: sentryPadPos, label: 'CLICK [O] OVERCLOCK', color: '#FFB000', radiusPx: 44 }]
              : [],
          highlightButtonIds: !this.floodUsedInStep
            ? ['ability-FLOODLIGHT']
            : !this.overclockUsedInStep
              ? ['ability-OVERCLOCK']
              : [],
          allowedBuildIds: [],
          allowedAbilityIds: !this.floodUsedInStep
            ? ['FLOODLIGHT']
            : !this.overclockUsedInStep
              ? ['OVERCLOCK']
              : [],
          allowRearm: true,
          allowUpgrade: false,
          allowDoorInspect: false,
          activePlacementRule: null,
          activeAbilityZone: this.floodUsedInStep && !this.overclockUsedInStep ? ocZone : null,
          wikiChapterIdx: 5,
          showContinueBtn: false,
          continueLabel: '',
        };
      }

      case 3:
      default: {
        const purgeZone: TutorialAbilityZoneRule = {
          abilityId: 'PURGE',
          center: airlockW01,
          radiusPx: 140,
          label: 'AIRLOCK W-01',
          airlockId: 'AIRLOCK-01',
        };
        return {
          active: true,
          graduated: false,
          tier: 'ADVANCED',
          canStartAdvancedLab: false,
          stepIndex: 3,
          totalSteps: this.totalSteps,
          code: 'LAB 04/04',
          title: '[V] AIRLOCK VENT PURGE DECOMPRESSION FLUSH (2X SCORE)',
          briefingLines: [
            'A Skitterer swarm is trapped inside orange AIRLOCK W-01. Press [V] PURGE and click AIRLOCK W-01 to flush them 290px outward for 35% HP + 100 DMG and 2X kill score!',
            'You get 1 free Purge every wave — when spent, you can buy +1 Purge right on the [V] PURGE button for 250S+.',
          ],
          objectives: [
            { text: 'Press [V] PURGE and click glowing AIRLOCK W-01 to decompress', done: this.purgeUsedInStep },
          ],
          beacons: !this.purgeUsedInStep
            ? [{ pos: airlockW01, label: '[V] PURGE AIRLOCK W-01', color: '#FF6247', radiusPx: 54 }]
            : [],
          highlightButtonIds: !this.purgeUsedInStep ? ['ability-PURGE'] : [],
          allowedBuildIds: [],
          allowedAbilityIds: !this.purgeUsedInStep ? ['PURGE'] : [],
          allowRearm: true,
          allowUpgrade: false,
          allowDoorInspect: false,
          activePlacementRule: null,
          activeAbilityZone: !this.purgeUsedInStep ? purgeZone : null,
          wikiChapterIdx: 5,
          showContinueBtn: false,
          continueLabel: '',
        };
      }
    }
  }
}
