import type { Vec2 } from '../types';
import type { PerimeterSimulation } from './PerimeterSimulation';
import {
  HARDWARE_SPECS,
  PERIMETER_CONSTANTS,
  type BuildToolId,
  type CommandAbilityId,
} from './types';

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
  /** Required center aim angle in radians (omitted for omni units like Cryo Valve / Door Weld) */
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
  stepIndex: number; // 0..8
  totalSteps: number; // 9
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
 * Idiot-proof Interactive 9-Stage USCM Tactical Combat Training Drill for Hadley's Perimeter.
 *
 * Verified unobstructed West Junction killbox geometry (Sector01Blueprint):
 * - (14, 8) MOUNT_PAD  -> Aim WEST (180°)  straight down open row 8 (cols 14..3, ZERO walls!)
 * - ( 9, 7) MOUNT_PAD  -> Aim SOUTH (90°)  vertical red M314 Laser Tripwire across cols 9, rows 7..10!
 *                         (Also within 247px <= 255px Relay Link range of Rail (5,8) & Incin (9,10)!)
 * - ( 9, 9) DUCT_GRATE -> Omni Cryo-Stasis plume blankets ALL of West Junction (rows 7..10, cols 7..11)!
 * - ( 5, 8) MOUNT_PAD  -> Aim EAST (0°)    straight down open row 8 (cols 5..15 = 10 full tiles, ZERO walls!)
 * - ( 9,10) MOUNT_PAD  -> Aim NORTH (-90°) straight up across (9,9) & (9,8) West Junction (ZERO walls!)
 * - D-04    BLAST_DOOR -> Col 11, rows 8..9 (welding instantly reroutes West paths North & South!)
 * - AIRLOCK W-01       -> Cols 3..4, rows 6..9 (safely West of Rail (5,8) so trapped swarm waits for Purge!)
 */
export class PerimeterTutorialDirector {
  public active = false;
  public graduated = false;
  private stepIdx = 0;
  private readonly totalSteps = 9;

  // Per-stage milestone trackers
  private stepElapsedSec = 0;
  private dronesSpawned = false;
  private ammoDrainTriggered = false;
  private rearmCompleted = false;
  private stalkersSpawned = false;
  private flareUsedInStep = false;
  private praetorianSpawned = false;
  private acidDemoSpawned = false;
  private coolantUsedInStep = false;
  private doorWeldedInStep = false;
  private purgeSwarmSpawned = false;
  private purgeUsedInStep = false;
  private floodUsedInStep = false;
  private overclockUsedInStep = false;
  private initialSealedDoorsCount = 0;
  private stepAdvanceDelaySec = 0;

  private tileCenter(col: number, row: number): Vec2 {
    const ts = PERIMETER_CONSTANTS.TILE_SIZE;
    return { x: col * ts + ts * 0.5, y: row * ts + ts * 0.5 };
  }

  public start(sim: PerimeterSimulation): void {
    this.active = true;
    this.graduated = false;
    this.stepIdx = 0;
    this.resetStageTrackers();

    sim.resetRun('ENDLESS_SIEGE', false);
    sim.trainingMode = true;
    sim.phase = 'TACTICAL_PREP';
    sim.scrap = 320;
    sim.maxReactorKw = 115;
    sim.reserveBattery = 45;
    sim.eventLogs = [
      'LOG> ★ USCM TACTICAL SIMULATOR INITIALIZED — UNRANKED TRAINING DRILL ★',
      'LOG> REACTOR CORE SHIELDS ENGAGED: YOU CANNOT FAIL THIS ORIENTATION.',
      'LOG> ONLY THE REQUIRED TOOL FOR EACH STEP IS UNLOCKED — FOLLOW THE GUIDES!',
    ];
  }

  public stop(sim: PerimeterSimulation): void {
    this.active = false;
    this.graduated = false;
    sim.trainingMode = false;
  }

  private resetStageTrackers(): void {
    this.stepElapsedSec = 0;
    this.dronesSpawned = false;
    this.ammoDrainTriggered = false;
    this.rearmCompleted = false;
    this.stalkersSpawned = false;
    this.flareUsedInStep = false;
    this.praetorianSpawned = false;
    this.acidDemoSpawned = false;
    this.coolantUsedInStep = false;
    this.doorWeldedInStep = false;
    this.purgeSwarmSpawned = false;
    this.purgeUsedInStep = false;
    this.floodUsedInStep = false;
    this.overclockUsedInStep = false;
    this.stepAdvanceDelaySec = 0;
  }

  /** Called when player clicks [BEGIN DRILL] or [SKIP STEP] */
  public advanceStep(sim: PerimeterSimulation): void {
    if (!this.active || this.graduated) return;

    // If trainee skips a placement stage, auto-ensure the prerequisite hardware exists in the killbox
    // so downstream stages (like Cryo+Rail, Overclock, MK-III) always work smoothly!
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
      sim.pushLog('★ USCM PERIMETER COMMAND DRILL COMPLETE — CLEARED FOR RANKED ENDLESS SIEGE! ★');
      return;
    }

    this.setupStage(sim, this.stepIdx);
  }

  private ensurePrerequisitesBeforeLeavingStep(sim: PerimeterSimulation, leavingIdx: number): void {
    if (leavingIdx === 1 && !sim.turrets.some((t) => t.kind === 'SENTRY_PULSE')) {
      sim.scrap = Math.max(sim.scrap, 120);
      sim.deployHardware('SENTRY_PULSE', 14, 8, Math.PI);
    } else if (leavingIdx === 3 && !sim.turrets.some((t) => t.kind === 'MOTION_RELAY')) {
      sim.scrap = Math.max(sim.scrap, 80);
      sim.maxReactorKw = Math.max(sim.maxReactorKw, 130);
      sim.deployHardware('MOTION_RELAY', 9, 7, Math.PI * 0.5);
    } else if (leavingIdx === 4) {
      sim.maxReactorKw = Math.max(sim.maxReactorKw, 185);
      if (!sim.turrets.some((t) => t.kind === 'CRYO_VALVE')) {
        sim.scrap = Math.max(sim.scrap, 100);
        sim.deployHardware('CRYO_VALVE', 9, 9, 0);
      }
      if (!sim.turrets.some((t) => t.kind === 'RAIL_LANCE')) {
        sim.scrap = Math.max(sim.scrap, 170);
        sim.deployHardware('RAIL_LANCE', 5, 8, 0);
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

    switch (idx) {
      case 1: {
        // Stage 2: Deploy & Aim UA 571-C Sentry at (14, 8) aimed WEST (180°)
        sim.phase = 'TACTICAL_PREP';
        sim.scrap = Math.max(sim.scrap, 180);
        sim.pushLog('DRILL 02/09 // CLICK [1] UA 571-C -> CLICK PAD (14,8) & DRAG LEFT DOWN THE CORRIDOR.');
        break;
      }
      case 2: {
        // Stage 3: Live Contact (3 Drones walking West->East down row 8) & [E] Rearm
        sim.phase = 'WAVE_ACTIVE';
        const basePos = this.tileCenter(6, 8);
        for (let i = 0; i < 3; i++) {
          const h = sim.spawnTrainingHostile('VENT-01', 'DRONE', {
            x: basePos.x - i * 54,
            y: basePos.y + (i - 1) * 16,
          });
          h.hp = 64;
          h.maxHp = 64;
        }
        this.dronesSpawned = true;
        sim.pushLog('DRILL 03/09 // 3 XENO DRONES INBOUND! WATCH SENTRY ENGAGE — THEN PRESS [E] TO REARM.');
        break;
      }
      case 3: {
        // Stage 4: M314 Relay at (9, 7) aimed SOUTH (90° vertical tripwire!) + [F] Flare -> 2 Cloaked Stalkers
        sim.phase = 'WAVE_ACTIVE';
        sim.scrap = Math.max(sim.scrap, 180);
        sim.maxReactorKw = Math.max(sim.maxReactorKw, 130);
        sim.flareCooldown = 0;
        sim.pushLog('DRILL 04/09 // DEPLOY [6] M314 RELAY AT TOP PAD & DRAG DOWN TO CAST A LASER TRIPWIRE!');
        break;
      }
      case 4: {
        // Stage 5: Cryo Valve at (9, 9) + M99 Rail-Lance at (5, 8) aimed EAST (0° unobstructed 10-tile lane!)
        sim.phase = 'WAVE_ACTIVE';
        sim.scrap = Math.max(sim.scrap, 340);
        sim.maxReactorKw = Math.max(sim.maxReactorKw, 185);
        sim.pushLog('DRILL 05/09 // PLACE [4] CRYO VALVE ON GRATE, THEN [3] M99 RAIL-LANCE AIMED RIGHT!');
        break;
      }
      case 5: {
        // Stage 6: M240 Incinerator at (9, 10) aimed NORTH (-90°) + [C] Coolant Flush
        sim.phase = 'WAVE_ACTIVE';
        sim.scrap = Math.max(sim.scrap, 240);
        sim.maxReactorKw = Math.max(sim.maxReactorKw, 220);
        sim.coolantFlushCooldown = 0;
        for (const t of sim.turrets) {
          if (t.kind === 'SENTRY_PULSE' || t.kind === 'RAIL_LANCE') {
            t.heat = Math.max(t.heat, 68);
          }
        }
        sim.pushLog('DRILL 06/09 // DEPLOY [2] M240 INCINERATOR AIMED UP TO STERILIZE ACID, THEN [C] FLUSH!');
        break;
      }
      case 6: {
        // Stage 7: Weld Blast Door D-04 [7] -> Reroute -> [V] Airlock Purge on Airlock W-01!
        sim.phase = 'WAVE_ACTIVE';
        sim.scrap = Math.max(sim.scrap, 180);
        sim.purgeAvailableThisWave = true;
        this.initialSealedDoorsCount = sim.getActiveSealedDoorCount();
        sim.pushLog('DRILL 07/09 // WELD BLAST DOOR D-04 [7] TO REROUTE PATHS, THEN [V] PURGE AIRLOCK W-01!');
        break;
      }
      case 7: {
        // Stage 8: Reserve Battery [L] Floodlight & [O] Overclock
        sim.phase = 'WAVE_ACTIVE';
        sim.reserveBattery = 88;
        sim.floodlightCooldown = 0;
        sim.overclockCooldown = 0;
        sim.pushLog('DRILL 08/09 // FIRE [L] EMERGENCY FLOODLIGHT (60% BAT) & [O] OVERCLOCK ON YOUR TURRETS!');
        break;
      }
      case 8: {
        // Stage 9: Upgrade any turret MK-I -> MK-II -> MK-III Branch A/B
        sim.phase = 'TACTICAL_PREP';
        sim.scrap = Math.max(sim.scrap, 650);
        sim.maxReactorKw = Math.max(sim.maxReactorKw, 260);
        if (sim.turrets.length === 0) {
          sim.deployHardware('SENTRY_PULSE', 14, 8, Math.PI);
        }
        sim.pushLog('DRILL 09/09 // CLICK ANY TURRET -> UPGRADE MK-II [U] -> PICK MK-III BRANCH A OR B!');
        break;
      }
    }
  }

  /**
   * Validates whether a hardware build click/drag satisfies the current drill step's exact
   * pad/grate/door location AND reasonable firing angle (never letting trainees point into a wall!).
   */
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

    if (col !== rule.col || row !== rule.row) {
      return {
        ok: false,
        reason:
          buildId === 'CRYO_VALVE'
            ? 'PLACE CRYO VALVE ON THE PULSING WEST JUNCTION GRATE!'
            : 'DEPLOY ON THE PULSING TARGET PAD IN WEST JUNCTION!',
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

  /** Helper used by BlueprintRenderer during live mouse-drag so the cone flashes GREEN (good) vs RED (bad angle)! */
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

  /** Validates whether a targeted ability click ([F] Flare, [V] Purge, [O] Overclock) hits the guided zone! */
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
    if (this.stepIdx === 3 && abilityId === 'FLARE') {
      this.flareUsedInStep = true;
    } else if (this.stepIdx === 5 && abilityId === 'COOLANT_FLUSH') {
      this.coolantUsedInStep = true;
    } else if (this.stepIdx === 6 && abilityId === 'PURGE') {
      this.purgeUsedInStep = true;
    } else if (this.stepIdx === 7 && abilityId === 'FLOODLIGHT') {
      this.floodUsedInStep = true;
    } else if (this.stepIdx === 7 && abilityId === 'OVERCLOCK') {
      this.overclockUsedInStep = true;
    }
  }

  public notifyRearmTriggered(): void {
    if (!this.active || this.graduated) return;
    if (this.stepIdx === 2 && this.ammoDrainTriggered) {
      this.rearmCompleted = true;
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

    // Keep Scrap topped up gently so a trainee can never run dry mid-drill
    if (this.stepIdx === 1 && sim.scrap < 100 && !sim.turrets.some((t) => t.kind === 'SENTRY_PULSE')) {
      sim.scrap = 120;
    } else if (this.stepIdx === 3 && sim.scrap < 65 && !sim.turrets.some((t) => t.kind === 'MOTION_RELAY')) {
      sim.scrap = 85;
    } else if (this.stepIdx === 4 && sim.scrap < 160) {
      const hasCryo = sim.turrets.some((t) => t.kind === 'CRYO_VALVE');
      const hasRail = sim.turrets.some((t) => t.kind === 'RAIL_LANCE');
      if (!hasCryo || !hasRail) sim.scrap = Math.max(sim.scrap, 240);
    } else if (this.stepIdx === 5 && sim.scrap < 130 && !sim.turrets.some((t) => t.kind === 'INCINERATOR')) {
      sim.scrap = 150;
    } else if (this.stepIdx === 6 && sim.scrap < 60 && !this.doorWeldedInStep) {
      sim.scrap = 75;
    } else if (this.stepIdx === 8 && sim.scrap < 300 && !sim.turrets.some((t) => t.level === 3)) {
      sim.scrap = 520;
    }

    switch (this.stepIdx) {
      case 0:
        break;

      case 1: {
        if (sim.turrets.some((t) => t.kind === 'SENTRY_PULSE')) {
          this.triggerStageSuccess(sim, 'UA 571-C SENTRY LOCKED ON WEST APPROACH — PREPARING LIVE CONTACT!');
        }
        break;
      }

      case 2: {
        if (this.dronesSpawned && !this.ammoDrainTriggered && sim.hostiles.length === 0) {
          this.ammoDrainTriggered = true;
          const s = this.getPrimarySentry(sim);
          if (s && s.kind === 'SENTRY_PULSE') {
            s.ammo = Math.min(s.ammo, 68);
            sim.scrap = Math.max(sim.scrap, 120);
            sim.pushLog('DRILL // DRONES DOWN! SENTRY LOW AMMO — PRESS [E] OR CLICK [E] REARM ALL!');
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
          this.triggerStageSuccess(sim, 'BELT-LOADER REARM VERIFIED — ADVANCING TO DARKNESS & TRIPWIRE DRILL!');
        }
        break;
      }

      case 3: {
        // Substep 4A: Place M314 Relay at (9, 7) aimed SOUTH -> Substep 4B: Drop [F] Flare -> Stalkers!
        const hasRelay = sim.turrets.some((t) => t.kind === 'MOTION_RELAY');
        if (sim.flares.length > 0) this.flareUsedInStep = true;

        if (hasRelay && this.flareUsedInStep && !this.stalkersSpawned) {
          this.stalkersSpawned = true;
          const basePos = this.tileCenter(6, 8);
          for (let i = 0; i < 2; i++) {
            const st = sim.spawnTrainingHostile('VENT-01', 'STALKER', {
              x: basePos.x - i * 56,
              y: basePos.y + (i === 0 ? -12 : 12),
            });
            st.hp = 78;
            st.maxHp = 78;
          }
          sim.pushLog('DRILL // 2 CLOAKED STALKERS EXPOSED BY FLARE & TRIPWIRE — SENTRY ENGAGING!');
        }

        if (hasRelay && this.flareUsedInStep && this.stalkersSpawned && sim.hostiles.length === 0) {
          this.triggerStageSuccess(sim, 'STALKERS DECLOAKED & ELIMINATED — SENSOR COVERAGE MASTERED!');
        }
        break;
      }

      case 4: {
        // Substep 5A: Cryo at (9,9) -> Substep 5B: Rail-Lance at (5,8) aimed EAST -> Armored Praetorian!
        const hasCryo = sim.turrets.some((t) => t.kind === 'CRYO_VALVE');
        const hasRail = sim.turrets.some((t) => t.kind === 'RAIL_LANCE');
        if (hasCryo && hasRail && !this.praetorianSpawned) {
          this.praetorianSpawned = true;
          const spawnPos = this.tileCenter(6, 8);
          const prt = sim.spawnTrainingHostile('VENT-01', 'PRAETORIAN', spawnPos);
          prt.hp = 310;
          prt.maxHp = 310;
          sim.pushLog('DRILL // ARMORED PRAETORIAN IN WEST JUNCTION! WATCH RAIL-LANCE + CRYO SHATTER IT!');
        }
        if (hasCryo && hasRail && this.praetorianSpawned && sim.hostiles.length === 0) {
          this.triggerStageSuccess(sim, 'ARMORED PRAETORIAN SHATTERED — KILLBOX SYNERGY CONFIRMED!');
        }
        break;
      }

      case 5: {
        // Substep 6A: Incinerator at (9,10) aimed NORTH -> Bursters & Acid Pool at (9,9) -> Substep 6B: [C] Flush
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
            b.hp = 210;
            b.maxHp = 210;
          }
          sim.pushLog('DRILL // ACID BURSTERS & POOL IN WEST JUNCTION — NAPALM STERILIZING FOR BONUS SCRAP!');
        }
        if (
          incin &&
          this.coolantUsedInStep &&
          this.acidDemoSpawned &&
          sim.hostiles.length === 0
        ) {
          this.triggerStageSuccess(sim, 'ACID STERILIZED & COOLANT MANIFOLD FLUSHED!');
        }
        break;
      }

      case 6: {
        // Substep 7A: Weld D-04 -> Substep 7B: Spawn 6 trapped Skitterers in Airlock W-01 -> [V] Purge!
        if (sim.getActiveSealedDoorCount() > this.initialSealedDoorsCount) {
          this.doorWeldedInStep = true;
        }
        if (this.doorWeldedInStep && !this.purgeSwarmSpawned) {
          this.purgeSwarmSpawned = true;
          const al = sim.blueprint.airlocks[0]; // AIRLOCK W-01 (cols 3..4, rows 6..9)
          if (al) {
            // Spawn in upper chamber of Airlock W-01, safely West of Rail (5,8) so they wait for Purge!
            for (let i = 0; i < 6; i++) {
              const sk = sim.spawnTrainingHostile('VENT-01', 'SKITTERER', {
                x: al.bounds.x + 28 + (i % 2) * 44,
                y: al.bounds.y + 34 + Math.floor(i / 2) * 34,
              });
              sk.speedPxS = 8;
              sk.hp = 26;
              sk.maxHp = 26;
            }
            sim.pushLog('DRILL // DOOR D-04 SEALED (PATHS REROUTED!) — NOW PRESS [V] & CLICK AIRLOCK W-01!');
          }
        }
        if (!this.purgeUsedInStep) {
          sim.purgeAvailableThisWave = true;
        }
        if (this.doorWeldedInStep && this.purgeUsedInStep) {
          this.triggerStageSuccess(sim, 'DOOR SEALED & AIRLOCK DECOMPRESSION PURGE EXECUTED!');
        }
        break;
      }

      case 7: {
        // Substep 8A: [L] Floodlight -> Substep 8B: [O] Overclock
        if (sim.floodlightTimer > 0) this.floodUsedInStep = true;
        if (sim.activeOverclockSurgeTimer > 0) this.overclockUsedInStep = true;
        if (!this.floodUsedInStep && sim.reserveBattery < 65) {
          sim.reserveBattery = 85;
        }
        if (this.floodUsedInStep && this.overclockUsedInStep) {
          this.triggerStageSuccess(sim, 'REACTOR FLOODLIGHT & OVERCLOCK SURGE MASTERED!');
        }
        break;
      }

      case 8: {
        // Stage 9: Upgrade any turret to MK-III Branch A or B
        if (sim.turrets.some((t) => t.level === 3)) {
          this.triggerStageSuccess(sim, 'MK-III SPECIALIZATION INSTALLED — CERTIFICATION EARNED!');
        }
        break;
      }
    }
  }

  private triggerStageSuccess(sim: PerimeterSimulation, msg: string): void {
    if (this.stepAdvanceDelaySec > 0) return;
    sim.audioCb.onUpgradeConfirm(this.stepIdx === this.totalSteps - 1);
    sim.pushLog(`✓ ${msg}`);
    this.stepAdvanceDelaySec = 1.35;
  }

  public getSnapshot(sim: PerimeterSimulation): TutorialDirectiveSnapshot {
    if (!this.active) {
      return {
        active: false,
        graduated: false,
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
      return {
        active: true,
        graduated: true,
        stepIndex: this.totalSteps,
        totalSteps: this.totalSteps,
        code: 'CERTIFIED',
        title: 'USCM PERIMETER COMMAND CERTIFICATION COMPLETE!',
        briefingLines: [
          'You have mastered Hardpoints, Vision & Tripwires, Unobstructed Rail Lanes, Cryo-Shatter, Acid Sterilization, Door Rerouting, Airlock Purges, Reactor Systems, and MK-III Branches!',
          'You are cleared for RANKED ENDLESS HIVE SIEGE. Watch for Protocol Drafts every 3 waves, Crushers on Wave 5, and the Matriarch Queen on Wave 10!',
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
        wikiChapterIdx: 7,
        showContinueBtn: false,
        continueLabel: '',
      };
    }

    const corePos = sim.blueprint.coreCenter;
    const sentryPadPos = this.tileCenter(14, 8);
    const relayPadPos = this.tileCenter(9, 7);
    const cryoGratePos = this.tileCenter(9, 9);
    const railPadPos = this.tileCenter(5, 8);
    const incinPadPos = this.tileCenter(9, 10);
    const flareZonePos = this.tileCenter(7, 8);
    const doorD04 = sim.doors.get('D-04')?.def.center ?? this.tileCenter(11, 8);
    const airlockW01 = sim.blueprint.airlocks[0]?.center ?? this.tileCenter(4, 8);

    switch (this.stepIdx) {
      case 0:
        return {
          active: true,
          graduated: false,
          stepIndex: 0,
          totalSteps: this.totalSteps,
          code: 'DRILL 01/09',
          title: 'ORIENTATION — PROTECT THE CORE & READ THE BLUEPRINT',
          briefingLines: [
            'Protect the glowing REACTOR CORE (center) — if 3 aliens breach it, all 3 Bulkhead Seals blow and the colony falls.',
            'Aliens follow the dashed lines from VENTS to the Core. Guns mount on [+] PADS; Cryo/Arc mount on striped GRATES. Only needed tools unlock each step!',
          ],
          objectives: [
            { text: 'LEFT: Reactor kW, 3 Seals, Reserve Battery & Live Weapons Rack', done: true },
            { text: 'RIGHT: Hardware Arsenal [1-8], Command Skills & Unit Inspector', done: true },
          ],
          beacons: [
            { pos: corePos, label: 'REACTOR CORE (3 SEALS)', color: '#44FF77', radiusPx: 54 },
            { pos: this.tileCenter(1, 2), label: 'ALIEN BREACH VENT', color: '#FFB000', radiusPx: 36 },
            { pos: relayPadPos, label: '[+] MOUNT PAD', color: '#00F0FF', radiusPx: 30 },
          ],
          highlightButtonIds: [],
          allowedBuildIds: [],
          allowedAbilityIds: [],
          allowRearm: false,
          allowUpgrade: false,
          allowDoorInspect: false,
          activePlacementRule: null,
          activeAbilityZone: null,
          wikiChapterIdx: 0,
          showContinueBtn: true,
          continueLabel: '► BEGIN DRILL [ENTER]',
        };

      case 1: {
        const placed = sim.turrets.some((t) => t.kind === 'SENTRY_PULSE');
        const rule: TutorialPlacementRule = {
          buildId: 'SENTRY_PULSE',
          col: 14,
          row: 8,
          targetAngle: Math.PI, // Straight WEST down open row 8!
          angleToleranceRad: (32 * Math.PI) / 180,
          aimHint: 'LEFT (WEST) DOWN THE CORRIDOR',
        };
        return {
          active: true,
          graduated: false,
          stepIndex: 1,
          totalSteps: this.totalSteps,
          code: 'DRILL 02/09',
          title: 'DEPLOY & AIM YOUR FIRST UA 571-C PULSE SENTRY',
          briefingLines: [
            'Click [1] UA 571-C on the right (or press 1). Click the pulsing pad beside the Core, HOLD & DRAG LEFT into the glowing corridor guide cone, then release!',
            'Solid inner arc = 55% dark vision · Dashed outer arc = 100% range when lit. Turrets CANNOT shoot through walls — always aim down open hallways!',
          ],
          objectives: [
            { text: 'Deploy [1] UA 571-C on the pulsing pad aimed LEFT down West Approach', done: placed },
          ],
          beacons: placed ? [] : [{ pos: sentryPadPos, label: 'CLICK & DRAG LEFT (WEST)', color: '#FFB000', radiusPx: 34 }],
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

      case 2: {
        const dronesCleared = this.dronesSpawned && sim.hostiles.length === 0;
        return {
          active: true,
          graduated: false,
          stepIndex: 2,
          totalSteps: this.totalSteps,
          code: 'DRILL 03/09',
          title: 'LIVE COMBAT, TACTICAL PAUSE [SPACE] & AMMO REARM [E]',
          briefingLines: [
            '3 Xeno Drones are charging straight down West Approach! Watch your Sentry tear them up while burning its 320-rd drum on the Left Weapons Rack.',
            'Tip: Press [SPACE] anytime to PAUSE calmly! Once the Drones drop, press [E] (or click [E] REARM ALL on the left) to reload your Sentry.',
          ],
          objectives: [
            { text: 'Watch your Sentry eliminate all 3 approaching Xeno Drones', done: dronesCleared },
            {
              text: dronesCleared
                ? 'Press [E] (or click [E] REARM ALL on left) to feed a fresh ammo belt!'
                : 'Wait for Drones to drop, then test Sentry Rearm',
              done: this.rearmCompleted,
            },
          ],
          beacons: this.getPrimarySentry(sim)
            ? [
                {
                  pos: this.getPrimarySentry(sim)!.pos,
                  label: dronesCleared ? 'PRESS [E] TO REARM!' : 'ENGAGING WEST CORRIDOR',
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

      case 3: {
        const hasRelay = sim.turrets.some((t) => t.kind === 'MOTION_RELAY');
        const stalkersDead = this.stalkersSpawned && sim.hostiles.length === 0;
        const relayRule: TutorialPlacementRule = {
          buildId: 'MOTION_RELAY',
          col: 9,
          row: 7,
          targetAngle: Math.PI * 0.5, // Straight SOUTH across West Junction corridor!
          angleToleranceRad: (32 * Math.PI) / 180,
          aimHint: 'DOWN (SOUTH) ACROSS THE CORRIDOR',
        };
        const flareZone: TutorialAbilityZoneRule = {
          abilityId: 'FLARE',
          center: flareZonePos,
          radiusPx: 230,
          label: 'WEST JUNCTION FLARE ZONE',
        };
        return {
          active: true,
          graduated: false,
          stepIndex: 3,
          totalSteps: this.totalSteps,
          code: 'DRILL 04/09',
          title: 'DARKNESS, CLOAKED STALKERS & M314 LASER TRIPWIRE',
          briefingLines: [
            !hasRelay
              ? 'Step A: Select [6] M314 RELAY, click the pulsing North Alcove pad & DRAG DOWN (SOUTH) so its RED LASER TRIPWIRE spans across the entire hallway!'
              : 'Step B: Now press [F] M40 FLARE (0 kW!) and click the pulsing West Junction corridor — lighting up 2 incoming cloaked SIGNAL STALKERS!',
            'Any alien crossing the red Tripwire (even invisible Stalkers!) is full-lit for 5.0s (+20% CRIT & 100% range), AND M314 boosts nearby guns +24% Range!',
          ],
          objectives: [
            { text: 'Place [6] M314 Relay on top pad & drag DOWN so red Tripwire blocks hallway', done: hasRelay },
            { text: 'Press [F] FLARE and click inside the pulsing West Junction zone', done: this.flareUsedInStep },
            { text: 'Decloak & eliminate both approaching Signal Stalkers', done: stalkersDead },
          ],
          beacons: !hasRelay
            ? [{ pos: relayPadPos, label: 'M314 -> DRAG DOWN (SOUTH)', color: '#44FF77', radiusPx: 34 }]
            : !this.flareUsedInStep
              ? [{ pos: flareZonePos, label: 'DROP [F] FLARE HERE', color: '#FFF0B8', radiusPx: 48 }]
              : [],
          highlightButtonIds: !hasRelay
            ? ['build-MOTION_RELAY']
            : !this.flareUsedInStep
              ? ['ability-FLARE']
              : [],
          allowedBuildIds: !hasRelay ? ['MOTION_RELAY'] : [],
          allowedAbilityIds: hasRelay && !this.flareUsedInStep ? ['FLARE'] : [],
          allowRearm: true,
          allowUpgrade: false,
          allowDoorInspect: false,
          activePlacementRule: !hasRelay ? relayRule : null,
          activeAbilityZone: hasRelay && !this.flareUsedInStep ? flareZone : null,
          wikiChapterIdx: 1,
          showContinueBtn: false,
          continueLabel: '',
        };
      }

      case 4: {
        const hasCryo = sim.turrets.some((t) => t.kind === 'CRYO_VALVE');
        const hasRail = sim.turrets.some((t) => t.kind === 'RAIL_LANCE');
        const prtDead = this.praetorianSpawned && sim.hostiles.length === 0;
        const cryoRule: TutorialPlacementRule = {
          buildId: 'CRYO_VALVE',
          col: 9,
          row: 9,
        };
        const railRule: TutorialPlacementRule = {
          buildId: 'RAIL_LANCE',
          col: 5,
          row: 8,
          targetAngle: 0, // Straight EAST down unobstructed 10-tile West Approach!
          angleToleranceRad: (24 * Math.PI) / 180,
          aimHint: 'RIGHT (EAST) STRAIGHT DOWN THE HALLWAY',
        };
        return {
          active: true,
          graduated: false,
          stepIndex: 4,
          totalSteps: this.totalSteps,
          code: 'DRILL 05/09',
          title: 'ARMOR PIERCING [3] RAIL-LANCE & [4] CRYO-SHATTER KILLBOX',
          briefingLines: [
            !hasCryo
              ? 'Step A: Heavy PRAETORIANS deflect 70% of frontal Sentry fire! Click [4] CRYO VALVE and mount it on the striped DUCT GRATE in West Junction (slows 58% + 35% SHATTER CRIT!).'
              : !hasRail
                ? 'Step B: Click [3] M99 RAIL-LANCE, click the pulsing WEST-END PAD, and DRAG RIGHT (EAST) straight down the long hallway! Rail ignores 100% armor & pierces 4 foes!'
                : 'KILLBOX ARMED! Watch your unobstructed Rail-Lance + Cryo-Shatter + M314 link obliterate the armored Praetorian!',
            'Notice how M99 Rail-Lance at the hallway mouth has a clear 18-meter straight shot down the corridor — NEVER mount a sniper behind a corner wall!',
          ],
          objectives: [
            { text: 'Mount [4] Cryo-Stasis Valve on the pulsing West Junction Duct Grate', done: hasCryo },
            { text: 'Deploy [3] M99 Rail-Lance at hallway mouth aimed RIGHT (EAST)', done: hasRail },
            { text: 'Shatter the approaching armored Praetorian Crusher', done: prtDead },
          ],
          beacons: !hasCryo
            ? [{ pos: cryoGratePos, label: 'CLICK [4] CRYO ON GRATE', color: '#9BF8FF', radiusPx: 34 }]
            : !hasRail
              ? [{ pos: railPadPos, label: 'M99 RAIL -> DRAG RIGHT (EAST)', color: '#00F0FF', radiusPx: 34 }]
              : [],
          highlightButtonIds: !hasCryo
            ? ['build-CRYO_VALVE']
            : !hasRail
              ? ['build-RAIL_LANCE']
              : [],
          allowedBuildIds: !hasCryo ? ['CRYO_VALVE'] : !hasRail ? ['RAIL_LANCE'] : [],
          allowedAbilityIds: [],
          allowRearm: true,
          allowUpgrade: false,
          allowDoorInspect: false,
          activePlacementRule: !hasCryo ? cryoRule : !hasRail ? railRule : null,
          activeAbilityZone: null,
          wikiChapterIdx: 3,
          showContinueBtn: false,
          continueLabel: '',
        };
      }

      case 5: {
        const hasIncin = sim.turrets.some((t) => t.kind === 'INCINERATOR');
        const burstersDead = this.acidDemoSpawned && sim.hostiles.length === 0;
        const incinRule: TutorialPlacementRule = {
          buildId: 'INCINERATOR',
          col: 9,
          row: 10,
          targetAngle: -Math.PI * 0.5, // Straight NORTH up into West Junction choke!
          angleToleranceRad: (32 * Math.PI) / 180,
          aimHint: 'UP (NORTH) INTO WEST JUNCTION',
        };
        return {
          active: true,
          graduated: false,
          stepIndex: 5,
          totalSteps: this.totalSteps,
          code: 'DRILL 06/09',
          title: 'ACID POOLS, [2] INCINERATOR STERILIZE & [C] COOLANT FLUSH',
          briefingLines: [
            !hasIncin
              ? 'Step A: Select [2] M240 INCIN, click the pulsing South Alcove pad & DRAG UP (NORTH) into the junction! Napalm burns armor & STERILIZES Acid Pools for +15 BONUS SCRAP!'
              : 'Step B: Press [C] (or click [C] FLUSH) to instantly vent -78 barrel HEAT across all turrets and cleanse Spitter Acid!',
            'Acid Bursters explode into green corrosive pools that melt Blast Doors & M314 Tripwires — Incinerators turn acid hazards into free Scrap!',
          ],
          objectives: [
            { text: 'Deploy [2] M240 Incinerator on South pad aimed UP (NORTH) into junction', done: hasIncin },
            { text: 'Trigger [C] COOLANT FLUSH to vent barrel heat', done: this.coolantUsedInStep },
            { text: 'Incinerate the Acid Bursters & sterilize the corrosive pool', done: burstersDead },
          ],
          beacons: !hasIncin
            ? [{ pos: incinPadPos, label: 'INCINERATOR -> DRAG UP (NORTH)', color: '#FFB000', radiusPx: 34 }]
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

      case 6: {
        const doorRule: TutorialPlacementRule = {
          buildId: 'ARC_WELDER',
          col: 11,
          row: 8,
          doorId: 'D-04',
        };
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
          stepIndex: 6,
          totalSteps: this.totalSteps,
          code: 'DRILL 07/09',
          title: 'FUNNELING WITH [7] DOOR SEALS & [V] AIRLOCK PURGE',
          briefingLines: [
            !this.doorWeldedInStep
              ? 'Step A: Click [7] DOOR SEAL and click Blast Door D-04! Watch the dashed green alien path lines INSTANTLY reroute around the sealed corridor!'
              : 'Step B: A Skitterer swarm is trapped in orange AIRLOCK W-01! Press [V] PURGE and click AIRLOCK W-01 to blow them back for 2X DECOMPRESSION KILL score!',
            'You can keep up to 3 Blast Doors welded at once to funnel 4 enemy corridors into 2 concentrated killboxes! Airlock Purge recharges every wave.',
          ],
          objectives: [
            { text: 'Select [7] DOOR SEAL and click glowing Blast Door D-04', done: this.doorWeldedInStep },
            { text: 'Press [V] PURGE and click orange AIRLOCK W-01', done: this.purgeUsedInStep },
          ],
          beacons: !this.doorWeldedInStep
            ? [{ pos: doorD04, label: 'CLICK [7] WELD DOOR D-04', color: '#FFB000', radiusPx: 38 }]
            : !this.purgeUsedInStep
              ? [{ pos: airlockW01, label: 'CLICK [V] PURGE AIRLOCK W-01', color: '#FF5522', radiusPx: 54 }]
              : [],
          highlightButtonIds: !this.doorWeldedInStep
            ? ['build-ARC_WELDER']
            : !this.purgeUsedInStep
              ? ['ability-PURGE']
              : [],
          allowedBuildIds: !this.doorWeldedInStep ? ['ARC_WELDER'] : [],
          allowedAbilityIds: this.doorWeldedInStep && !this.purgeUsedInStep ? ['PURGE'] : [],
          allowRearm: true,
          allowUpgrade: false,
          allowDoorInspect: false,
          activePlacementRule: !this.doorWeldedInStep ? doorRule : null,
          activeAbilityZone: this.doorWeldedInStep && !this.purgeUsedInStep ? purgeZone : null,
          wikiChapterIdx: 7,
          showContinueBtn: false,
          continueLabel: '',
        };
      }

      case 7: {
        const ocZone: TutorialAbilityZoneRule = {
          abilityId: 'OVERCLOCK',
          center: this.tileCenter(9, 8),
          radiusPx: 640,
          label: 'TURRET SECTOR',
        };
        return {
          active: true,
          graduated: false,
          stepIndex: 7,
          totalSteps: this.totalSteps,
          code: 'DRILL 08/09',
          title: 'REACTOR BATTERY, [L] FLOODLIGHT & [O] OVERCLOCK SURGE',
          briefingLines: [
            !this.floodUsedInStep
              ? 'Step A: Unused kW charges your cyan RESERVE BATTERY (left panel). Press [L] (or click [L] FLOOD) to spend 60% Battery for 7.5s MAP-WIDE FULL ILLUMINATION!'
              : 'Step B: Press [O] (or click [O] OVRCLK) and click near your turrets for 2X FIRE RATE! Reserve Battery automatically buffers the +22 kW surge!',
            'If Reactor Overload ever drains Battery to 0%, tap [X] SHED AUX to drop support kW before the 4.0s Breaker Trip triggers a 3.5s Blackout!',
          ],
          objectives: [
            { text: 'Press [L] (or click [L] FLOOD) for 7.5s map-wide full vision', done: this.floodUsedInStep },
            { text: 'Press [O] OVERCLOCK & click near any turret (+22 kW · 2X ROF)', done: this.overclockUsedInStep },
          ],
          beacons:
            this.floodUsedInStep && !this.overclockUsedInStep
              ? [{ pos: sentryPadPos, label: 'CLICK [O] OVERCLOCK HERE', color: '#FFB000', radiusPx: 44 }]
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

      case 8:
      default: {
        const hasMk2 = sim.turrets.some((t) => t.level >= 2);
        const hasMk3 = sim.turrets.some((t) => t.level === 3);
        const targetT =
          sim.turrets.find((t) => t.level === 2) ??
          sim.turrets.find((t) => t.level < 3) ??
          sim.turrets[0];
        return {
          active: true,
          graduated: false,
          stepIndex: 8,
          totalSteps: this.totalSteps,
          code: 'DRILL 09/09',
          title: 'MK-II & BRANCHING MK-III SPECIALIZATIONS — FINAL CHECK!',
          briefingLines: [
            !hasMk2
              ? 'Step A: Click the pulsing turret on the map (or Left Weapons Rack), then click [U] MK-II in the bottom-right Unit Inspector (+12% range, +33% power, 0 extra kW)!'
              : 'Step B: Now pick EITHER permanent MK-III Specialization (Branch III-A or Branch III-B) in the bottom-right Unit Inspector to graduate!',
            'In Endless Hive Siege, you also draft permanent MU-TH-UR Protocols every 3 waves — press [H] anytime to inspect all 12 MK-III branches & formulas!',
          ],
          objectives: [
            { text: 'Click a turret & upgrade it to MK-II ([U] or Inspector button)', done: hasMk2 },
            { text: 'Choose a permanent MK-III Specialization (Branch III-A or III-B)', done: hasMk3 },
          ],
          beacons: targetT
            ? [
                {
                  pos: targetT.pos,
                  label: hasMk2 ? 'CLICK -> PICK MK-III A / B' : 'CLICK -> UPGRADE MK-II',
                  color: '#00F0FF',
                  radiusPx: 36,
                },
              ]
            : [],
          highlightButtonIds: hasMk2 ? ['insp-upgrade-a', 'insp-upgrade-b'] : ['insp-upgrade'],
          allowedBuildIds: [],
          allowedAbilityIds: [],
          allowRearm: true,
          allowUpgrade: true,
          allowDoorInspect: false,
          activePlacementRule: null,
          activeAbilityZone: null,
          wikiChapterIdx: 2,
          showContinueBtn: false,
          continueLabel: '',
        };
      }
    }
  }
}
