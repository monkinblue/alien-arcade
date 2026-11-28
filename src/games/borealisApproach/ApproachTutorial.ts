import type { Vec2 } from '../../types';
import type { ApproachTutorialOverlayState } from './ApproachHudRenderer';
import type { ApproachSimulation } from './ApproachSimulation';
import {
  AIRFIELD_GEOMETRY,
  getHoldingFixById,
  getRunwayFafNm,
  getRunwayHoldShortNm,
  getRunwayThresholdNm,
} from './types';

const DRILL_COMPLETED_STORAGE_KEY = 'muthur_approach_drill_done_v1';
const TOTAL_DRILL_STEPS = 6;
const GRADUATION_LOCKOUT_SEC = 0.8;

const STEP1_SPAWN_POS: Vec2 = { x: 11.6, y: 2.0 };
const STEP1_SPAWN_HDG = 245;
const STEP1_TARGET_ILS: Vec2 = { x: 8.0, y: 0 };

const STEP2_VIPER_POS: Vec2 = { x: -1.5, y: 10.5 };
const STEP2_VIPER_HDG = 155;
const STEP2_HAWK_POS: Vec2 = { x: 11.4, y: 3.4 };
const STEP2_HAWK_HDG = 335;
const STEP2_STACK_MULE_POS: Vec2 = { x: 7.9, y: 8.6 };
const STEP2_STACK_MULE_HDG = 30;

const STEP3_STORM_POS: Vec2 = { x: 8.6, y: 0.2 };
const STEP3_ATLAS_POS: Vec2 = { x: 10.6, y: 0.0 };
const STEP3_ATLAS_LOOP_POS: Vec2 = { x: 11.4, y: 0.0 };
const STEP3_VIPER_POS: Vec2 = { x: -5.6, y: -5.6 };
const STEP3_VIPER_HDG = 25;

const STEP4_DEMO_ATLAS_POS: Vec2 = { x: 8.6, y: 0.0 };

const STEP5_DEMO_HEAVY_POS: Vec2 = { x: 9.8, y: 0 };
const STEP5_DEMO_MEDEVAC_POS: Vec2 = { x: 3.6, y: 8.6 };

function readCompletedFlag(): boolean {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(DRILL_COMPLETED_STORAGE_KEY) === '1';
    }
  } catch {
    // Ignore storage access errors in private/restricted contexts
  }
  return false;
}

function writeCompletedFlag(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(DRILL_COMPLETED_STORAGE_KEY, '1');
    }
  } catch {
    // Ignore storage access errors in private/restricted contexts
  }
}

function clearSimEntities(sim: ApproachSimulation): void {
  sim.aircraft = [];
  sim.departureQueue = [];
  sim.storms = [];
  sim.bogeys = [];
  sim.conflictPairs = [];
  sim.conflictActive = false;
  sim.minSeparationNm = 99;
  sim.incidentFreezeTimer = 0;
  sim.incidentPos = null;
  sim.incidentReason = null;
  sim.incidentCallout = '';
  sim.safetySeals = sim.maxSafetySeals;
}

function topUpFuel(sim: ApproachSimulation): void {
  for (const craft of sim.aircraft) {
    if (craft.isDeparture) continue;
    const floor = Math.max(120, craft.maxFuelSec * 0.85);
    if (craft.fuelSec < floor) {
      craft.fuelSec = floor;
      craft.fuelPct = Math.min(100, (craft.fuelSec / Math.max(1, craft.maxFuelSec)) * 100);
      craft.fuelStatus = 'NOMINAL';
    }
  }
}

function spawnStep3DioramaStorm(sim: ApproachSimulation): void {
  const storm = sim.spawnStormNow({ ...STEP3_STORM_POS });
  storm.vx = 0;
  storm.vy = 0;
  storm.ageSec = 5.0;
  storm.intensity = 1.0;
  storm.maxLifeSec = 9999;
}

/**
 * Unbreakable 6-Step Interactive RAPCON Training Drill Director for Borealis Approach 2.0.
 *
 * Runs strictly with `sim.trainingMode = true` so it NEVER posts to `approach_scores`,
 * NEVER triggers Game Over, slows/freezes `sim.timeScale`, gently recovers bad drags,
 * teaches Smart Hold stacking, Lethal Red vs Safe Violet Ion Static, Gap Launches,
 * Comeback Streak Seals, and resolves cleanly into the self-paced 3-Tab RAPCON Field
 * Manual & Certification modal on Step 6 with an 0.8s arrival input guard.
 */
export class ApproachTutorialDirector {
  private active = false;
  private stepIndex = 0;
  private completedSessionFlag = false;

  private lastSim: ApproachSimulation | null = null;
  private stepCompleted = false;
  private celebrateTimer = 0;
  private goAroundRecoverTimer = 0;
  private graduationLockoutSec = 0;
  private hintOverride: string | null = null;

  // Step-specific tracked craft IDs & completion latches
  private step1CraftId: number | null = null;
  private step2ViperId: number | null = null;
  private step2HawkId: number | null = null;
  private step2StackMuleId: number | null = null;
  private step2PadDone = false;
  private step2HoldDone = false;
  private step3ViperId: number | null = null;
  private step3AtlasId: number | null = null;
  private step4DepartureCleared = false;
  private step4LaunchedCraftId: number | null = null;
  private step4DemoAtlasId: number | null = null;
  private step4RespawnDelaySec = 0;

  constructor() {
    this.completedSessionFlag = readCompletedFlag();
  }

  public isFirstVisit(): boolean {
    if (this.completedSessionFlag) return false;
    if (readCompletedFlag()) {
      this.completedSessionFlag = true;
      return false;
    }
    return true;
  }

  public markCompleted(): void {
    this.completedSessionFlag = true;
    writeCompletedFlag();
  }

  public isActive(): boolean {
    return this.active;
  }

  public isGraduated(): boolean {
    return this.active && this.stepIndex >= TOTAL_DRILL_STEPS - 1;
  }

  public getGraduationLockoutSec(): number {
    return this.isGraduated() ? Math.max(0, this.graduationLockoutSec) : 0;
  }

  public isGraduationLocked(): boolean {
    return this.isGraduated() && this.graduationLockoutSec > 0;
  }

  public getStepIndex(): number {
    return this.stepIndex;
  }

  public start(sim: ApproachSimulation): void {
    this.active = true;
    this.lastSim = sim;
    this.enterStep(sim, 0);
  }

  public stop(sim: ApproachSimulation): void {
    this.active = false;
    this.stepIndex = 0;
    this.stepCompleted = false;
    this.celebrateTimer = 0;
    this.goAroundRecoverTimer = 0;
    this.graduationLockoutSec = 0;
    this.hintOverride = null;
    this.lastSim = null;
    sim.trainingMode = false;
    sim.timeScale = 1.0;
  }

  public jumpToStep(sim: ApproachSimulation, stepIdx: number): void {
    const clamped = Math.max(0, Math.min(TOTAL_DRILL_STEPS - 1, Math.floor(stepIdx)));
    if (!this.active || !sim.trainingMode || sim.phase !== 'ACTIVE_SHIFT') {
      sim.startTrainingSession();
    }
    this.active = true;
    this.lastSim = sim;
    this.enterStep(sim, clamped);
  }

  public advanceStep(sim: ApproachSimulation): void {
    if (!this.active) {
      this.start(sim);
      return;
    }
    if (this.stepIndex < TOTAL_DRILL_STEPS - 1) {
      this.enterStep(sim, this.stepIndex + 1);
    }
  }

  public notifyNext(): boolean {
    if (!this.active) return false;
    if (this.stepIndex === 2) {
      if (this.lastSim) {
        this.enterStep(this.lastSim, 3);
        return true;
      }
      this.stepCompleted = true;
      return true;
    }
    if (this.stepIndex === 4) {
      if (this.lastSim) {
        this.enterStep(this.lastSim, 5);
        return true;
      }
      this.stepCompleted = true;
      return true;
    }
    return false;
  }

  public notifyDepartureCleared(): void {
    if (!this.active || this.stepIndex !== 3) return;
    this.step4DepartureCleared = true;
    if (this.lastSim && !this.stepCompleted) {
      const launched = this.lastSim.aircraft.find((c) => c.isDeparture);
      if (launched) {
        this.step4LaunchedCraftId = launched.id;
      }
      this.stepCompleted = true;
      this.celebrateTimer = 2.2;
      this.lastSim.timeScale = 1.2;
    }
  }

  private enterStep(sim: ApproachSimulation, idx: number): void {
    this.stepIndex = idx;
    this.stepCompleted = false;
    this.celebrateTimer = 0;
    this.goAroundRecoverTimer = 0;
    this.graduationLockoutSec = 0;
    this.hintOverride = null;

    this.step1CraftId = null;
    this.step2ViperId = null;
    this.step2HawkId = null;
    this.step2StackMuleId = null;
    this.step2PadDone = false;
    this.step2HoldDone = false;
    this.step3ViperId = null;
    this.step3AtlasId = null;
    this.step4DepartureCleared = false;
    this.step4LaunchedCraftId = null;
    this.step4DemoAtlasId = null;
    this.step4RespawnDelaySec = 0;

    if (idx === 0) {
      sim.startTrainingSession();
      const atlas = sim.spawnScenarioCraft('HEAVY', { ...STEP1_SPAWN_POS }, STEP1_SPAWN_HDG, {
        callsign: 'ATLAS-1',
        fuelSec: 180,
      });
      this.step1CraftId = atlas.id;
      sim.timeScale = 0.12;
      return;
    }

    if (!sim.trainingMode || sim.phase !== 'ACTIVE_SHIFT') {
      sim.startTrainingSession();
    }
    clearSimEntities(sim);

    if (idx === 1) {
      // Seed MULE-2 already holding at BOREA FL35 (slot 0) so player sees live vertical altitude stacking!
      const mule = sim.spawnScenarioCraft(
        'HEAVY',
        { ...STEP2_STACK_MULE_POS },
        STEP2_STACK_MULE_HDG,
        {
          callsign: 'MULE-2',
          fuelSec: 180,
        }
      );
      mule.assignedHoldFix = 'BOREA';
      mule.holdAltitudeSlot = 0;
      mule.altitudeFt = 3500;
      mule.state = 'HOLDING';
      mule.holdLegPhase = 'OUTBOUND';
      mule.holdLegDistNm = 0.3;

      const viper = sim.spawnScenarioCraft('DROPSHIP', { ...STEP2_VIPER_POS }, STEP2_VIPER_HDG, {
        callsign: 'VIPER-1',
        fuelSec: 180,
      });
      const hawk = sim.spawnScenarioCraft('DROPSHIP', { ...STEP2_HAWK_POS }, STEP2_HAWK_HDG, {
        callsign: 'HAWK-2',
        fuelSec: 180,
      });
      this.step2StackMuleId = mule.id;
      this.step2ViperId = viper.id;
      this.step2HawkId = hawk.id;
      sim.timeScale = 0.14;
      return;
    }

    if (idx === 2) {
      // Side-by-side Lethal Crimson R-118 (SW) vs Non-Lethal Violet ION STATIC (East ILS) diorama
      spawnStep3DioramaStorm(sim);

      const atlas4 = sim.spawnScenarioCraft('HEAVY', { ...STEP3_ATLAS_POS }, 270, {
        callsign: 'ATLAS-4',
        fuelSec: 180,
      });
      atlas4.lockedTarget = 'RWY_27';
      atlas4.state = 'ESTABLISHED';
      atlas4.waypoints = [getRunwayFafNm('27'), getRunwayThresholdNm('27')];
      atlas4.inStorm = true;

      const viper3 = sim.spawnScenarioCraft('DROPSHIP', { ...STEP3_VIPER_POS }, STEP3_VIPER_HDG, {
        callsign: 'VIPER-3',
        fuelSec: 180,
      });

      this.step3AtlasId = atlas4.id;
      this.step3ViperId = viper3.id;
      sim.timeScale = 0.45;
      return;
    }

    if (idx === 3) {
      // Queued departure holding short RWY 27 + outer-approach craft (>5.5 NM = FINAL CLEAR · SAFE)
      sim.queueDepartureNow({
        callsign: 'VIPER-9',
        kind: 'DROPSHIP',
        runway: '27',
      });
      const atlas8 = sim.spawnScenarioCraft('HEAVY', { ...STEP4_DEMO_ATLAS_POS }, 270, {
        callsign: 'ATLAS-8',
        fuelSec: 180,
      });
      atlas8.lockedTarget = 'RWY_27';
      atlas8.state = 'ESTABLISHED';
      atlas8.waypoints = [getRunwayFafNm('27'), getRunwayThresholdNm('27')];
      this.step4DemoAtlasId = atlas8.id;
      sim.timeScale = 0.28;
      return;
    }

    if (idx === 4) {
      // Step 5: Scoring, Emergencies & Comeback Mechanics tactical briefing (calm 0.08× backdrop)
      const hvy = sim.spawnScenarioCraft('HEAVY', { ...STEP5_DEMO_HEAVY_POS }, 270, {
        callsign: 'ATLAS-5',
        fuelSec: 180,
      });
      hvy.lockedTarget = 'RWY_27';
      hvy.state = 'ESTABLISHED';
      hvy.waypoints = [getRunwayFafNm('27'), getRunwayThresholdNm('27')];

      const med = sim.spawnScenarioCraft('DROPSHIP', { ...STEP5_DEMO_MEDEVAC_POS }, 180, {
        callsign: 'DUSTOFF-1',
        fuelSec: 180,
      });
      med.isMedevac = true;
      med.medevacExpressTimerSec = 25;
      med.lockedTarget = 'PAD_ALPHA';
      med.state = 'ESTABLISHED';
      sim.timeScale = 0.08;
      return;
    }

    // Step 6 (idx === 5): Certification Complete — Self-Paced 3-Tab RAPCON Field Manual
    sim.timeScale = 0;
    this.graduationLockoutSec = GRADUATION_LOCKOUT_SEC;
    this.markCompleted();
  }

  public update(sim: ApproachSimulation, dt: number): void {
    if (!this.active) return;
    this.lastSim = sim;

    // Guarantee training safety invariants on every tick
    sim.trainingMode = true;
    sim.safetySeals = sim.maxSafetySeals;
    if (sim.incidentFreezeTimer > 0) {
      sim.incidentFreezeTimer = 0;
    }

    if (this.stepIndex === 0) {
      this.updateStep1(sim, dt);
    } else if (this.stepIndex === 1) {
      this.updateStep2(sim, dt);
    } else if (this.stepIndex === 2) {
      this.updateStep3(sim);
    } else if (this.stepIndex === 3) {
      this.updateStep4(sim, dt);
    } else if (this.stepIndex === 4) {
      this.updateStep5(sim);
    } else {
      sim.timeScale = 0;
      if (this.graduationLockoutSec > 0) {
        this.graduationLockoutSec = Math.max(0, this.graduationLockoutSec - dt);
      }
    }
  }

  private updateStep1(sim: ApproachSimulation, dt: number): void {
    topUpFuel(sim);
    let atlas =
      (this.step1CraftId !== null ? sim.getAircraftById(this.step1CraftId) : undefined) ??
      sim.aircraft.find((c) => c.kind === 'HEAVY');

    if (this.stepCompleted) {
      sim.timeScale = 1.1;
      this.celebrateTimer -= dt;
      if (this.celebrateTimer <= 0) {
        this.enterStep(sim, 1);
      }
      return;
    }

    sim.timeScale = 0.12;

    if (atlas && atlas.lockedTarget === 'RWY_27') {
      this.stepCompleted = true;
      this.celebrateTimer = 1.6;
      this.hintOverride = null;
      this.goAroundRecoverTimer = 0;
      sim.timeScale = 1.1;
      return;
    }

    if (!atlas) {
      atlas = sim.spawnScenarioCraft('HEAVY', { ...STEP1_SPAWN_POS }, STEP1_SPAWN_HDG, {
        callsign: 'ATLAS-1',
        fuelSec: 180,
      });
      this.step1CraftId = atlas.id;
      this.hintOverride =
        'Intercept the glowing green funnel OUTSIDE the 5 NM FAF at a shallow angle (<=45°)!';
      return;
    }

    // Gently reposition ATLAS-1 if player triggers a Go-Around or drags inside FAF / far away
    if (atlas.state === 'GO_AROUND') {
      this.hintOverride =
        'Intercept the glowing green funnel OUTSIDE the 5 NM FAF at a shallow angle (<=45°)!';
      this.goAroundRecoverTimer += dt;
      if (this.goAroundRecoverTimer >= 0.45) {
        this.resetStep1Craft(atlas);
        this.goAroundRecoverTimer = 0;
      }
      return;
    }

    this.goAroundRecoverTimer = 0;
    const driftedPastFaf = atlas.x < 5.8;
    const driftedTooFar =
      Math.hypot(atlas.x - STEP1_SPAWN_POS.x, atlas.y - STEP1_SPAWN_POS.y) > 7.8;
    if (driftedPastFaf || driftedTooFar) {
      this.hintOverride =
        'Intercept the glowing green funnel OUTSIDE the 5 NM FAF at a shallow angle (<=45°)!';
      this.resetStep1Craft(atlas);
    }
  }

  private resetStep1Craft(atlas: {
    x: number;
    y: number;
    headingDeg: number;
    targetHeadingDeg: number;
    state: string;
    waypoints: Vec2[];
    trail: Vec2[];
    lockedTarget: string | null;
    assignedHoldFix: string | null;
    holdAltitudeSlot: 0 | 1 | 2 | null;
    goAroundTimer: number;
  }): void {
    atlas.x = STEP1_SPAWN_POS.x;
    atlas.y = STEP1_SPAWN_POS.y;
    atlas.headingDeg = STEP1_SPAWN_HDG;
    atlas.targetHeadingDeg = STEP1_SPAWN_HDG;
    atlas.state = 'APPROACH';
    atlas.waypoints = [];
    atlas.trail = [];
    atlas.lockedTarget = null;
    atlas.assignedHoldFix = null;
    atlas.holdAltitudeSlot = null;
    atlas.goAroundTimer = 0;
  }

  private updateStep2(sim: ApproachSimulation, dt: number): void {
    topUpFuel(sim);

    if (this.stepCompleted) {
      sim.timeScale = 1.0;
      this.celebrateTimer -= dt;
      if (this.celebrateTimer <= 0) {
        this.enterStep(sim, 2);
      }
      return;
    }

    sim.timeScale = 0.14;

    let viper =
      this.step2ViperId !== null ? sim.getAircraftById(this.step2ViperId) : undefined;
    let hawk =
      this.step2HawkId !== null ? sim.getAircraftById(this.step2HawkId) : undefined;

    // Accept either craft locking onto PAD α, and either craft entering ANY holding fix (RMB, [W], or drag)
    if (
      (viper && viper.lockedTarget === 'PAD_ALPHA') ||
      (hawk && hawk.lockedTarget === 'PAD_ALPHA')
    ) {
      this.step2PadDone = true;
    }
    if (
      (hawk && hawk.assignedHoldFix !== null) ||
      (viper && viper.assignedHoldFix !== null)
    ) {
      this.step2HoldDone = true;
    }

    // Recover VIPER-1 only if it disappeared before completing PAD α or wandered off unvectored
    if (!viper && !this.step2PadDone) {
      viper = sim.spawnScenarioCraft('DROPSHIP', { ...STEP2_VIPER_POS }, STEP2_VIPER_HDG, {
        callsign: 'VIPER-1',
        fuelSec: 180,
      });
      this.step2ViperId = viper.id;
    } else if (
      viper &&
      viper.lockedTarget !== 'PAD_ALPHA' &&
      viper.assignedHoldFix === null &&
      (viper.state === 'GO_AROUND' ||
        viper.y < 0.5 ||
        Math.hypot(viper.x - STEP2_VIPER_POS.x, viper.y - STEP2_VIPER_POS.y) > 9.5)
    ) {
      viper.x = STEP2_VIPER_POS.x;
      viper.y = STEP2_VIPER_POS.y;
      viper.headingDeg = STEP2_VIPER_HDG;
      viper.targetHeadingDeg = STEP2_VIPER_HDG;
      viper.state = 'APPROACH';
      viper.waypoints = [];
      viper.trail = [];
      viper.goAroundTimer = 0;
    }

    // Recover HAWK-2 only if it disappeared before completing hold or wandered off unvectored
    if (!hawk && !this.step2HoldDone) {
      hawk = sim.spawnScenarioCraft('DROPSHIP', { ...STEP2_HAWK_POS }, STEP2_HAWK_HDG, {
        callsign: 'HAWK-2',
        fuelSec: 180,
      });
      this.step2HawkId = hawk.id;
    } else if (
      hawk &&
      hawk.assignedHoldFix === null &&
      hawk.lockedTarget !== 'PAD_ALPHA' &&
      (hawk.state === 'GO_AROUND' ||
        hawk.y < -2.5 ||
        Math.hypot(hawk.x - STEP2_HAWK_POS.x, hawk.y - STEP2_HAWK_POS.y) > 9.5)
    ) {
      hawk.x = STEP2_HAWK_POS.x;
      hawk.y = STEP2_HAWK_POS.y;
      hawk.headingDeg = STEP2_HAWK_HDG;
      hawk.targetHeadingDeg = STEP2_HAWK_HDG;
      hawk.state = 'APPROACH';
      hawk.waypoints = [];
      hawk.trail = [];
      hawk.goAroundTimer = 0;
    }

    // Keep demo stack anchor MULE-2 safely orbiting BOREA at FL35
    const mule =
      this.step2StackMuleId !== null ? sim.getAircraftById(this.step2StackMuleId) : undefined;
    if (mule && mule.assignedHoldFix === null && mule.lockedTarget === null) {
      mule.x = STEP2_STACK_MULE_POS.x;
      mule.y = STEP2_STACK_MULE_POS.y;
      mule.headingDeg = STEP2_STACK_MULE_HDG;
      mule.targetHeadingDeg = STEP2_STACK_MULE_HDG;
      mule.assignedHoldFix = 'BOREA';
      mule.holdAltitudeSlot = 0;
      mule.altitudeFt = 3500;
      mule.state = 'HOLDING';
      mule.holdLegPhase = 'OUTBOUND';
      mule.waypoints = [];
    }

    if (this.step2PadDone && this.step2HoldDone) {
      this.stepCompleted = true;
      this.celebrateTimer = 1.65;
      sim.timeScale = 1.0;
    }
  }

  private updateStep3(sim: ApproachSimulation): void {
    if (this.stepCompleted) {
      this.enterStep(sim, 3);
      return;
    }
    sim.timeScale = 0.45;
    topUpFuel(sim);

    // Maintain live stationary violet ION STATIC cloud on East ILS path at full intensity
    if (sim.storms.length === 0) {
      spawnStep3DioramaStorm(sim);
    } else {
      const s = sim.storms[0];
      s.x = STEP3_STORM_POS.x;
      s.y = STEP3_STORM_POS.y;
      s.vx = 0;
      s.vy = 0;
      s.ageSec = 5.0;
      s.intensity = 1.0;
      s.maxLifeSec = 9999;
    }

    // Keep pre-locked ATLAS-4 visibly cruising straight through violet ION STATIC with 0 damage!
    let atlas4 =
      this.step3AtlasId !== null ? sim.getAircraftById(this.step3AtlasId) : undefined;
    if (!atlas4) {
      atlas4 = sim.spawnScenarioCraft('HEAVY', { ...STEP3_ATLAS_LOOP_POS }, 270, {
        callsign: 'ATLAS-4',
        fuelSec: 180,
      });
      this.step3AtlasId = atlas4.id;
    }
    if (atlas4.x < 4.2 || atlas4.lockedTarget !== 'RWY_27' || Math.abs(atlas4.y) > 1.2) {
      atlas4.x = STEP3_ATLAS_LOOP_POS.x;
      atlas4.y = STEP3_ATLAS_LOOP_POS.y;
      atlas4.headingDeg = 270;
      atlas4.targetHeadingDeg = 270;
      atlas4.lockedTarget = 'RWY_27';
      atlas4.assignedHoldFix = null;
      atlas4.holdAltitudeSlot = null;
      atlas4.state = 'ESTABLISHED';
      atlas4.waypoints = [getRunwayFafNm('27'), getRunwayThresholdNm('27')];
      atlas4.trail = [{ x: atlas4.x, y: atlas4.y }];
    }

    // Keep player's SW craft VIPER-3 clear of crimson R-118 and well separated from ATLAS-4
    let viper3 =
      this.step3ViperId !== null ? sim.getAircraftById(this.step3ViperId) : undefined;
    if (!viper3) {
      viper3 = sim.spawnScenarioCraft('DROPSHIP', { ...STEP3_VIPER_POS }, STEP3_VIPER_HDG, {
        callsign: 'VIPER-3',
        fuelSec: 180,
      });
      this.step3ViperId = viper3.id;
      this.hintOverride =
        'CLEAN ROUTE AROUND R-118! Notice ATLAS-4 cruised safely through violet ION STATIC (0 damage). Click NEXT [SPACE]!';
      return;
    }

    if (viper3.inRestrictedZone) {
      viper3.x = STEP3_VIPER_POS.x;
      viper3.y = STEP3_VIPER_POS.y;
      viper3.headingDeg = STEP3_VIPER_HDG;
      viper3.targetHeadingDeg = STEP3_VIPER_HDG;
      viper3.waypoints = [];
      viper3.trail = [{ x: viper3.x, y: viper3.y }];
      viper3.lockedTarget = null;
      viper3.inRestrictedZone = false;
      viper3.restrictedExposureSec = 0;
      this.hintOverride =
        'CRIMSON R-118 IS LETHAL (2.8s breaches Seal!) — route around red R-118; violet ION STATIC does ZERO damage!';
      return;
    }

    const tooCloseToAtlas = Math.hypot(viper3.x - atlas4.x, viper3.y - atlas4.y) < 3.6;
    const unvectoredDrift =
      viper3.lockedTarget === null &&
      viper3.assignedHoldFix === null &&
      viper3.waypoints.length === 0 &&
      (viper3.y > 2.4 || viper3.x > 1.5 || Math.abs(viper3.x) > 13.5 || Math.abs(viper3.y) > 12.0);
    if (tooCloseToAtlas || unvectoredDrift) {
      viper3.x = STEP3_VIPER_POS.x;
      viper3.y = STEP3_VIPER_POS.y;
      viper3.headingDeg = STEP3_VIPER_HDG;
      viper3.targetHeadingDeg = STEP3_VIPER_HDG;
      viper3.waypoints = [];
      viper3.trail = [{ x: viper3.x, y: viper3.y }];
      viper3.lockedTarget = null;
      viper3.assignedHoldFix = null;
      viper3.holdAltitudeSlot = null;
    }
  }

  private updateStep4(sim: ApproachSimulation, dt: number): void {
    topUpFuel(sim);

    if (this.stepCompleted) {
      sim.timeScale = 1.2;
      this.celebrateTimer -= dt;
      if (this.celebrateTimer <= 0) {
        this.enterStep(sim, 4);
      }
      return;
    }

    // Keep queued departure patient while controller reads instructions
    for (const dep of sim.departureQueue) {
      if (dep.waitSec > 8) {
        dep.waitSec = 8;
      }
      dep.urgent = false;
    }

    const launched = sim.aircraft.find((c) => c.isDeparture);
    if (this.step4DepartureCleared || (sim.departureQueue.length === 0 && launched)) {
      this.step4DepartureCleared = true;
      if (launched) this.step4LaunchedCraftId = launched.id;
      this.stepCompleted = true;
      this.celebrateTimer = 2.2;
      sim.timeScale = 1.2;
      return;
    }

    if (sim.departureQueue.length === 0) {
      sim.queueDepartureNow({
        callsign: 'VIPER-9',
        kind: 'DROPSHIP',
        runway: '27',
      });
    }

    // Respawn demo approach craft gently after the 6s Gap Window expires if player hasn't launched yet
    const demoAtlas =
      this.step4DemoAtlasId !== null ? sim.getAircraftById(this.step4DemoAtlasId) : undefined;
    if (!demoAtlas) {
      this.step4RespawnDelaySec += dt;
      if (this.step4RespawnDelaySec >= 7.0) {
        this.step4RespawnDelaySec = 0;
        const fresh = sim.spawnScenarioCraft('HEAVY', { ...STEP4_DEMO_ATLAS_POS }, 270, {
          callsign: 'ATLAS-8',
          fuelSec: 180,
        });
        fresh.lockedTarget = 'RWY_27';
        fresh.state = 'ESTABLISHED';
        fresh.waypoints = [getRunwayFafNm('27'), getRunwayThresholdNm('27')];
        this.step4DemoAtlasId = fresh.id;
      }
    } else {
      this.step4RespawnDelaySec = 0;
    }

    sim.timeScale = 0.28;
  }

  private updateStep5(sim: ApproachSimulation): void {
    if (this.stepCompleted) {
      this.enterStep(sim, 5);
      return;
    }
    sim.timeScale = 0.08;
    topUpFuel(sim);
    for (const c of sim.aircraft) {
      if (c.isMedevac && c.medevacExpressTimerSec < 12) {
        c.medevacExpressTimerSec = 25;
      }
    }
  }

  public getOverlayState(sim: ApproachSimulation): ApproachTutorialOverlayState | null {
    if (!this.active) return null;

    // Step 1: Heavy ILS Localizer Snap
    if (this.stepIndex === 0) {
      const atlas =
        (this.step1CraftId !== null ? sim.getAircraftById(this.step1CraftId) : undefined) ??
        sim.aircraft.find((c) => c.kind === 'HEAVY');

      if (this.stepCompleted) {
        return {
          active: true,
          stepIndex: 0,
          totalSteps: TOTAL_DRILL_STEPS,
          stepTag: 'DRILL 1/6 · ILS LOCALIZER SNAP',
          headline: 'LOCKED GREEN! ESTABLISHED ON ILS!',
          instruction:
            'ATLAS-1 snapped onto the RWY 27 Localizer outside the 5 NM FAF and is tracking the glidepath down!',
          subHint: 'Intercepting between 12°–36° outside the FAF earns +250 TEXTBOOK 30° ILS!',
          guideArrows: [],
          highlightRings: atlas
            ? [{ posNm: { x: atlas.x, y: atlas.y }, radiusNm: 1.45, color: '#44ff88', label: 'ILS LOCK' }]
            : [],
        };
      }

      const atlasPos: Vec2 = atlas ? { x: atlas.x, y: atlas.y } : { ...STEP1_SPAWN_POS };
      return {
        active: true,
        stepIndex: 0,
        totalSteps: TOTAL_DRILL_STEPS,
        stepTag: 'DRILL 1/6 · ILS LOCALIZER SNAP',
        headline: 'VECTOR ATLAS-1 INTO THE RWY 27 ILS FUNNEL',
        instruction:
          'Drag ATLAS-1 into the glowing green RWY 27 beam OUTSIDE the 5 NM FAF cross at a shallow angle (<=45°).',
        subHint:
          this.hintOverride ??
          'Release when the path snaps bright green (ILS 27 LOCK). Time is slowed while you practice.',
        guideArrows: [
          {
            fromNm: atlasPos,
            toNm: { ...STEP1_TARGET_ILS },
            color: '#44ff88',
            label: 'DRAG TO ILS FUNNEL',
          },
        ],
        highlightRings: [
          { posNm: atlasPos, radiusNm: 1.4, color: '#ffbb44', label: 'ATLAS-1' },
          { posNm: { ...STEP1_TARGET_ILS }, radiusNm: 1.55, color: '#44ff88', label: 'OUTER ILS' },
        ],
      };
    }

    // Step 2: Dropship PAD α + RMB / [W] Smart Hold & Vertical Altitude Stacking
    if (this.stepIndex === 1) {
      const viper = this.step2ViperId !== null ? sim.getAircraftById(this.step2ViperId) : undefined;
      const hawk = this.step2HawkId !== null ? sim.getAircraftById(this.step2HawkId) : undefined;
      const padPos = AIRFIELD_GEOMETRY.padAlpha.pos;
      const boreaFix = getHoldingFixById('BOREA');
      const boreaOcc = sim.getFixStackOccupancy('BOREA');

      const guideArrows: ApproachTutorialOverlayState['guideArrows'] = [];
      const highlightRings: ApproachTutorialOverlayState['highlightRings'] = [];

      if (!this.step2PadDone && viper) {
        guideArrows.push({
          fromNm: { x: viper.x, y: viper.y },
          toNm: { ...padPos },
          color: '#44ff88',
          label: 'DRAG VIPER-1 → PAD α',
        });
        highlightRings.push(
          { posNm: { x: viper.x, y: viper.y }, radiusNm: 1.35, color: '#44ff88', label: 'VIPER-1' },
          { posNm: { ...padPos }, radiusNm: 1.55, color: '#44ff88', label: 'PAD α' }
        );
      }

      if (!this.step2HoldDone && hawk) {
        guideArrows.push({
          fromNm: { x: hawk.x, y: hawk.y },
          toNm: { ...boreaFix.pos },
          color: '#44eeff',
          label: 'RMB / [W] → SMART HOLD',
        });
        highlightRings.push(
          { posNm: { x: hawk.x, y: hawk.y }, radiusNm: 1.35, color: '#44eeff', label: 'HAWK-2 (RMB/[W])' },
          {
            posNm: { ...boreaFix.pos },
            radiusNm: 1.85,
            color: '#44eeff',
            label: `BOREA STACK ${boreaOcc.count}/3`,
          }
        );
      } else {
        highlightRings.push({
          posNm: { ...boreaFix.pos },
          radiusNm: 1.85,
          color: '#44eeff',
          label: `BOREA ${boreaOcc.count}/3 · ZERO CA`,
        });
      }

      const headline = this.stepCompleted
        ? 'PAD α LOCKED & VERTICAL HOLD STACK ESTABLISHED!'
        : !this.step2PadDone && !this.step2HoldDone
          ? 'LAND VIPER-1 AT PAD α · RMB/[W] SMART HOLD HAWK-2'
          : !this.step2PadDone
            ? 'GREAT! NOW DRAG VIPER-1 ONTO PAD α'
            : 'GREAT! NOW RMB OR [W] HAWK-2 TO SMART HOLD';

      const instruction = this.stepCompleted
        ? 'VIPER-1 lands at PAD α while HAWK-2 stacks safely at 4,500 ft above MULE-2 (zero CA!) burning only 0.35× fuel!'
        : 'Drag VIPER-1 to PAD α. Right-click HAWK-2 (blip or Flight Strip) or select + press [W] for 1-Click Smart Hold into BOREA / KRATO / VEXIS.';

      return {
        active: true,
        stepIndex: 1,
        totalSteps: TOTAL_DRILL_STEPS,
        stepTag: 'DRILL 2/6 · PAD α & SMART HOLD STACK',
        headline,
        instruction,
        subHint:
          'Fixes stack 3 ships vertically (3.5K / 4.5K / 5.5K ft — zero CA!) at 0.35× endurance fuel burn. Drag off any stack to release lowest fuel first.',
        guideArrows,
        highlightRings,
      };
    }

    // Step 3: Side-by-Side LETHAL R-118 vs NON-LETHAL VIOLET ION STATIC Diorama
    if (this.stepIndex === 2) {
      const viper3 =
        (this.step3ViperId !== null ? sim.getAircraftById(this.step3ViperId) : undefined) ??
        sim.aircraft.find((c) => c.kind === 'DROPSHIP');
      const viperPos: Vec2 = viper3 ? { x: viper3.x, y: viper3.y } : { ...STEP3_VIPER_POS };
      const storm = sim.storms[0];
      const stormPos: Vec2 = storm ? { x: storm.x, y: storm.y } : { ...STEP3_STORM_POS };

      return {
        active: true,
        stepIndex: 2,
        totalSteps: TOTAL_DRILL_STEPS,
        stepTag: 'DRILL 3/6 · RED LETHAL vs VIOLET SAFE',
        headline: 'RED = LETHAL (R-118 / CA) · VIOLET = SAFE ION STATIC',
        instruction:
          'Watch ATLAS-4 cruise safely RIGHT THROUGH the violet ION STATIC cloud (0 damage — comms jam only, pre-locked paths fly straight through!). Route VIPER-3 around crimson R-118 // HOT (breaches Seal!) & keep 3.0 NM sep.',
        subHint:
          this.hintOverride ??
          'RED = LETHAL (R-118, <3 NM CA, BINGO) · VIOLET = NON-LETHAL ION STATIC (pre-lock paths or RMB/[W] hold before entry!).',
        guideArrows: [],
        highlightRings: [
          {
            posNm: { ...AIRFIELD_GEOMETRY.restrictedZone.center },
            radiusNm: 3.4,
            color: '#ff4444',
            label: 'RED = LETHAL · BREACHES SEAL',
          },
          {
            posNm: stormPos,
            radiusNm: 2.55,
            color: '#b184ff',
            label: 'VIOLET = NO DMG · PATH SAFE',
          },
          {
            posNm: viperPos,
            radiusNm: 3.0,
            color: '#ffbb44',
            label: '3.0 NM MIN SEP',
          },
        ],
        highlightRestrictedZone: true,
        showNextButton: true,
        nextButtonLabel: 'GOT IT · NEXT [SPACE]',
      };
    }

    // Step 4: Departure Sequencing, Live Final Clear / Gap Launch & Speed Control
    if (this.stepIndex === 3) {
      const holdPos = getRunwayHoldShortNm('27');
      const launched =
        (this.step4LaunchedCraftId !== null
          ? sim.getAircraftById(this.step4LaunchedCraftId)
          : undefined) ?? sim.aircraft.find((c) => c.isDeparture);
      const demoAtlas =
        this.step4DemoAtlasId !== null ? sim.getAircraftById(this.step4DemoAtlasId) : undefined;
      const rwyStatus = sim.getDepartureRunwayStatus('27');

      if (this.stepCompleted) {
        return {
          active: true,
          stepIndex: 3,
          totalSteps: TOTAL_DRILL_STEPS,
          stepTag: 'DRILL 4/6 · DEPARTURES & SPEED',
          headline: 'VIPER-9 AIRBORNE — CLIMBING OUT RWY 27!',
          instruction:
            'VIPER-9 is climbing out on heading 292°! Clean departures earn +450 base (× Clean Mult), plus +300 GAP LAUNCH when launched within 6s after a landing.',
          subHint:
            'Combine SLOW / STD / FAST speed spacing with live FINAL CLEAR / GAP WINDOW launches to keep your runway flowing!',
          guideArrows: [],
          highlightRings: launched
            ? [
                {
                  posNm: { x: launched.x, y: launched.y },
                  radiusNm: 1.4,
                  color: '#55ffee',
                  label: 'VIPER-9 DEP',
                },
              ]
            : [],
          highlightDepartureButton: false,
        };
      }

      const statusNote = rwyStatus.gapWindowActive
        ? 'GAP WINDOW ACTIVE (+300)! Press [D] or click [CLEAR DEP] now!'
        : rwyStatus.clear
          ? 'Button shows emerald FINAL CLEAR · SAFE — press [D] or click [CLEAR DEP] to launch VIPER-9!'
          : `Button shows amber FINAL BUSY (${rwyStatus.nearestInboundNm?.toFixed(1) ?? '<5.5'} NM) — launch now or wait for +300 GAP WINDOW after touchdown!`;

      return {
        active: true,
        stepIndex: 3,
        totalSteps: TOTAL_DRILL_STEPS,
        stepTag: 'DRILL 4/6 · DEPARTURES & SPEED',
        headline: 'CLEAR VIPER-9 [D] · GAP LAUNCH & SPEED CONTROL',
        instruction: `${statusNote} Launching within 6s after a touchdown earns +300 GAP LAUNCH!`,
        subHint:
          'Hover/select ATLAS-8 and use Scroll Wheel, [S]/[F], or the Flight Strip speed pill to adjust SLOW · STD · FAST spacing.',
        guideArrows: [],
        highlightRings: [
          {
            posNm: holdPos,
            radiusNm: 1.4,
            color: '#ffbb44',
            label: 'HOLD SHORT RWY 27',
          },
          ...(demoAtlas
            ? [
                {
                  posNm: { x: demoAtlas.x, y: demoAtlas.y },
                  radiusNm: 1.35,
                  color: '#55eeff',
                  label: 'SPEED [S]/[F]',
                },
              ]
            : []),
        ],
        highlightDepartureButton: true,
      };
    }

    // Step 5: Scoring, Emergencies & Comeback Mechanics (explicit self-paced advance!)
    if (this.stepIndex === 4) {
      return {
        active: true,
        stepIndex: 4,
        totalSteps: TOTAL_DRILL_STEPS,
        stepTag: 'DRILL 5/6 · SCORING & COMEBACKS',
        headline: 'SCORING, EMERGENCIES & SEAL COMEBACKS',
        instruction:
          'Score scales from base landings/departures × Clean Mult (1.00×–5.00×) + skill & priority bonuses — 1979 CRT adds 1.5× to everything.',
        subHint:
          'Build Clean Streaks (5 / 10 / 15 / 20): every 20 clean ops restores +1 ICC SAFETY SEAL (+2,000) or +2,500 FLAWLESS WATCH!',
        guideArrows: [],
        highlightRings: [],
        showNextButton: true,
        nextButtonLabel: 'OPEN FIELD MANUAL / NEXT [SPACE]',
        scoringBreakdown: {
          basePoints: [
            { label: 'DROPSHIP', value: '350', tone: 'green' },
            { label: 'TUG', value: '425', tone: 'cyan' },
            { label: 'HEAVY', value: '500', tone: 'amber' },
            { label: 'MAYDAY', value: '1,200 (3×)', tone: 'red' },
            { label: 'DEPARTURE', value: '450', tone: 'cyan' },
          ],
          multiplierSummary:
            'CLEAN MULT 1.00× → 5.00×: +0.25× per clean op · -0.50× on <3 NM CA or R-118 · -0.25× dep delay >38s · Resets on Seal loss (1979 CRT = 1.5× ALL!).',
          bonuses: [
            {
              tag: '+500 SEQUENCED',
              detail: 'Same-zone landing w/o CA (9.5s RWY · 8.2s Cr · 6.0s Pad)',
              tone: 'cyan',
            },
            {
              tag: '+800 MEDEVAC EXPRESS',
              detail: 'MEDEVAC in 25s (PAD α / ANY RWY · × mult · 0 penalty)',
              tone: 'cyan',
            },
            {
              tag: '+300 GAP LAUNCH',
              detail: 'Launch departure within 6s of landing (× mult · clean)',
              tone: 'green',
            },
            {
              tag: '+750 FUMES / +250 ILS',
              detail: 'BINGO/MAYDAY <=5s (+750) · Heavy 12°–36° ILS (+250)',
              tone: 'amber',
            },
          ],
          efficiencyNote:
            'STREAK COMEBACKS: 5 (+500 ACE) · 10 (+1,000 WATCH) · 15 (+1,500 MASTER) · EVERY 20 CLEAN OPS RESTORES +1 ICC SAFETY SEAL (+2,000) or +2,500 FLAWLESS WATCH! Use 0.35× stacked holds & speed to keep streaks alive.',
        },
      };
    }

    // Step 6: Certification Complete — Self-Paced 3-Tab RAPCON Field Manual
    return {
      active: true,
      stepIndex: 5,
      totalSteps: TOTAL_DRILL_STEPS,
      stepTag: 'DRILL 6/6 · RAPCON FIELD MANUAL',
      headline: 'CERTIFICATION COMPLETE // RAPCON FIELD MANUAL',
      instruction:
        'Review all 3 tabs at your own pace ([1–3] or [←]/[→]) covering stacked 0.35× holds, non-lethal violet Ion Static, MEDEVAC, Gap Launches & Seal comebacks — then launch a Live Ranked Shift!',
      subHint:
        'You can reopen this 3-Tab Field Manual anytime from the Briefing Screen, Pause Menu, or [H] Controls card.',
      guideArrows: [],
      highlightRings: [],
      graduated: true,
      graduationLockoutSec: this.getGraduationLockoutSec(),
    };
  }
}
