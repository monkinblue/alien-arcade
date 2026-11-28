import type { MusicDebugState } from '../../audio/MusicManager';
import type { HostEnvironment } from '../../shell/Cartridge';
import type { Vec2 } from '../../types';
import type {
  ApproachAudio,
  ApproachRadioClipId,
  RadioQueueOptions,
} from './ApproachAudio';
import type {
  ApproachHudLayout,
  ApproachHudRenderer,
  ApproachTutorialOverlayState,
} from './ApproachHudRenderer';
import { nmToScreen } from './ApproachScopeRenderer';
import { ApproachSimulation } from './ApproachSimulation';
import type { ApproachTutorialDirector } from './ApproachTutorial';
import {
  AIRFIELD_GEOMETRY,
  APPROACH_CONSTANTS,
  distanceToRestrictedZoneNm,
  getCraftMinTurnRadiusNm,
  type ActiveRunwayId,
  type AircraftKind,
  type ApproachAircraft,
  type ApproachAudioCallbacks,
  type ApproachDebugHandle,
  type ApproachDebugSnapshot,
  type HoldingFixId,
  type MishapReason,
  type SpeedMode,
} from './types';

export interface ApproachSpawnSafetyReport {
  trials: number;
  passed: number;
  failed: number;
  minSpawnDistNm: number;
  minFlightDistNm: number;
  violations: Array<{
    trial: number;
    kind: AircraftKind;
    spawnPos: Vec2;
    headingDeg: number;
    minDistNm: number;
    enteredMoa: boolean;
  }>;
}

export interface ApproachCraftTurnRadiusInfo {
  id: number;
  callsign: string;
  kind: AircraftKind;
  speedMode: SpeedMode;
  speedKt: number;
  speedNmPerSec: number;
  turnRateDegPerSec: number;
  minTurnRadiusNm: number;
}

export interface ApproachRuntimeDebugHandle extends Omit<ApproachDebugHandle, 'getAudioDebug'> {
  startTutorial: () => void;
  advanceTutorialStep: () => void;
  jumpTutorialStep: (stepIdx: number) => void;
  getTutorialState: () => ApproachTutorialOverlayState | null;
  getRestrictedZone: () => typeof AIRFIELD_GEOMETRY.restrictedZone;
  testSpawnSafety: (trials?: number) => ApproachSpawnSafetyReport;
  getCraftTurnRadius: (id: number) => ApproachCraftTurnRadiusInfo | null;
  queueRadioClip: (id: ApproachRadioClipId, opts?: RadioQueueOptions) => boolean;
  getMusicDebug: () => MusicDebugState;
  isAtcMuted: () => boolean;
  setAtcMuted: (muted: boolean) => void;
  getAudioDebug: () => ReturnType<ApproachDebugHandle['getAudioDebug']> & {
    atcMuted: boolean;
    atcOutputGain: number;
  };
}

declare global {
  interface Window {
    __APPROACH_DEBUG__?: ApproachRuntimeDebugHandle;
  }
}

// Lazy-initialized WeakSet so this module has ZERO top-level side effects and
// tree-shakes 100% out of production `dist/` bundles.
let taintedSessions: WeakSet<ApproachSimulation> | null = null;

export function markSessionTainted(sim: ApproachSimulation): void {
  if (!taintedSessions) {
    taintedSessions = new WeakSet<ApproachSimulation>();
  }
  taintedSessions.add(sim);
}

export function clearSessionTainted(sim: ApproachSimulation): void {
  taintedSessions?.delete(sim);
}

export function isSessionTainted(sim: ApproachSimulation): boolean {
  return taintedSessions ? taintedSessions.has(sim) : false;
}

/**
 * DEV-ONLY Debug & Headless Verification Helpers for Borealis Approach 2.0.
 *
 * Isolated from `ApproachSimulation.ts` so production `dist/` bundles (which strip
 * `if (import.meta.env.DEV)` branches via Vite tree-shaking) contain ZERO debug-only
 * cheat/force-breach method strings.
 */

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Jumps `landedCount` to `n` and immediately syncs shift phase, ATIS letter & secondary runway. */
export function jumpToLandedCount(sim: ApproachSimulation, n: number): void {
  sim.landedCount = clamp(Math.floor(n), 0, 999);
  sim.syncShiftPhase(true);
}

/** Opens Secondary Crosswind Runway 36/18 immediately for testing. */
export function unlockSecondaryRunway(sim: ApproachSimulation): void {
  sim.unlockSecondaryRunway();
}

/** Spawns a deterministic aircraft at `(pos, headingDeg)` for QA scripts. */
export function spawnCraftAt(
  sim: ApproachSimulation,
  kind: AircraftKind,
  pos: Vec2,
  headingDeg: number,
  opts?: { callsign?: string; fuelSec?: number; speedMode?: SpeedMode }
): ApproachAircraft {
  return sim.spawnScenarioCraft(kind, pos, headingDeg, opts);
}

/** Queues an outbound departure immediately. */
export function queueDeparture(
  sim: ApproachSimulation,
  opts?: { kind?: 'DROPSHIP' | 'HEAVY'; runway?: ActiveRunwayId; callsign?: string }
): number {
  return sim.queueDepartureNow(opts).id;
}

/** Clears a queued departure immediately, returning the launched aircraft id or null. */
export function clearDeparture(sim: ApproachSimulation, depId?: number): number | null {
  const craft = sim.clearDeparture(depId);
  return craft ? craft.id : null;
}

/** Sets tactical speed mode on a craft. */
export function setCraftSpeedMode(
  sim: ApproachSimulation,
  craftId: number,
  mode: SpeedMode
): boolean {
  return sim.setCraftSpeedMode(craftId, mode);
}

/** Cycles tactical speed mode up/down on a craft. */
export function cycleCraftSpeed(
  sim: ApproachSimulation,
  craftId: number,
  delta: 1 | -1
): SpeedMode | null {
  return sim.cycleCraftSpeed(craftId, delta);
}

/** Clears all active entities & conflict state without resetting score/phase. */
export function clearEntities(sim: ApproachSimulation): void {
  sim.aircraft = [];
  sim.departureQueue = [];
  sim.storms = [];
  sim.bogeys = [];
  sim.conflictPairs = [];
  sim.conflictActive = false;
  sim.minSeparationNm = 99;
}

/** Sets remaining fuel seconds on a specific aircraft. */
export function setFuel(sim: ApproachSimulation, craftId: number, fuelSec: number): boolean {
  const craft = sim.getAircraftById(craftId);
  if (!craft) return false;
  craft.fuelSec = Math.max(0.05, fuelSec);
  craft.fuelPct = clamp((craft.fuelSec / craft.maxFuelSec) * 100, 0, 100);
  return true;
}

/** Sets the Clean Shift Multiplier cleanly within [1.0, 5.0]. */
export function setMultiplier(sim: ApproachSimulation, mult: number): void {
  sim.multiplier = clamp(mult, APPROACH_CONSTANTS.CLEAN_MULTIPLIER_MIN, APPROACH_CONSTANTS.CLEAN_MULTIPLIER_MAX);
  sim.maxMultiplier = Math.max(sim.maxMultiplier, sim.multiplier);
}

/** Sets `cleanStreak` deterministically for QA testing streak commendations and ICC Seal restoration. */
export function setCleanStreak(sim: ApproachSimulation, n: number): void {
  const val = Math.max(0, Math.floor(n));
  sim.cleanStreak = val;
  sim.bestCleanStreak = Math.max(sim.bestCleanStreak, val);
}

/** Sets `safetySeals` deterministically within `[0, maxSafetySeals]` for QA testing. */
export function setSafetySeals(sim: ApproachSimulation, n: number): void {
  sim.safetySeals = clamp(Math.floor(n), 0, sim.maxSafetySeals);
}

/**
 * Forces an immediate Conflict Alert (<3.0 NM, >0.85 NM) between two craft
 * through the genuine simulation separation pipeline.
 */
export function forceConflictNow(sim: ApproachSimulation): void {
  while (sim.aircraft.length < 2) {
    sim.spawnScenarioCraft('DROPSHIP', { x: -2, y: 6 }, 90);
  }
  const a = sim.aircraft[0];
  const b = sim.aircraft[1];

  a.state = 'APPROACH';
  a.isDeparture = false;
  a.lockedTarget = null;
  a.assignedHoldFix = null;
  a.holdAltitudeSlot = null;
  a.waypoints = [];
  a.x = -1.0;
  a.y = 6.2;
  a.headingDeg = 90;
  a.targetHeadingDeg = 90;

  b.state = 'APPROACH';
  b.isDeparture = false;
  b.lockedTarget = null;
  b.assignedHoldFix = null;
  b.holdAltitudeSlot = null;
  b.waypoints = [];
  b.x = 1.1;
  b.y = 6.2;
  b.headingDeg = 270;
  b.targetHeadingDeg = 270;

  const prevPaused = sim.paused;
  const prevScale = sim.timeScale;
  sim.paused = false;
  sim.timeScale = 1.0;
  sim.update(0.001);
  sim.paused = prevPaused;
  sim.timeScale = prevScale;
}

/**
 * Forces an immediate ICC Safety Seal breach (with genuine 1.2s slow-mo incident freeze
 * and concussive mishap audio) via the real simulation physics pipeline.
 */
export function forceSealBreachNow(
  sim: ApproachSimulation,
  reason: MishapReason = 'COLLISION'
): void {
  sim.antiDoubleStrikeTimer = 0;
  sim.incidentFreezeTimer = 0;

  const prevPaused = sim.paused;
  const prevScale = sim.timeScale;
  sim.paused = false;
  sim.timeScale = 1.0;

  if (reason === 'FLAMEOUT') {
    const target =
      sim.aircraft.find((c) => !c.isDeparture && c.state !== 'LANDING') ??
      sim.spawnScenarioCraft('DROPSHIP', { x: 0, y: 4.5 }, 180);
    target.fuelSec = 0.001;
    sim.update(0.016);
  } else if (reason === 'RESTRICTED_ZONE') {
    const target =
      sim.aircraft.find((c) => c.state !== 'LANDING') ??
      sim.spawnScenarioCraft('DROPSHIP', { ...AIRFIELD_GEOMETRY.restrictedZone.center }, 270);
    target.x = AIRFIELD_GEOMETRY.restrictedZone.center.x;
    target.y = AIRFIELD_GEOMETRY.restrictedZone.center.y;
    target.inRestrictedZone = true;
    target.restrictedExposureSec = APPROACH_CONSTANTS.RESTRICTED_ZONE_BREACH_SEC + 0.1;
    sim.update(0.016);
  } else {
    // COLLISION: pair aircraft[0] (or a fresh craft) with a colliding partner at 0.1 NM
    const primary =
      sim.aircraft.find((c) => c.state !== 'LANDING') ??
      sim.spawnScenarioCraft('DROPSHIP', { x: 0, y: 4.5 }, 90);
    primary.state = 'APPROACH';
    primary.isDeparture = false;
    const partner = sim.spawnScenarioCraft(
      'DROPSHIP',
      { x: primary.x + 0.1, y: primary.y },
      270,
      { callsign: 'MISHAP-X' }
    );
    partner.state = 'APPROACH';
    sim.update(0.001);
  }

  sim.paused = prevPaused;
  sim.timeScale = prevScale;
}

/** Returns live kinematic turn-radius telemetry for aircraft `id` (or `null` if not found). */
export function getCraftTurnRadius(
  sim: ApproachSimulation,
  id: number
): ApproachCraftTurnRadiusInfo | null {
  const craft = sim.getAircraftById(id);
  if (!craft) return null;
  return {
    id: craft.id,
    callsign: craft.callsign,
    kind: craft.kind,
    speedMode: craft.speedMode,
    speedKt: craft.speedKt,
    speedNmPerSec: Number(craft.speedNmPerSec.toFixed(4)),
    turnRateDegPerSec: craft.turnRateDegPerSec,
    minTurnRadiusNm: Number(
      getCraftMinTurnRadiusNm(craft.speedNmPerSec, craft.turnRateDegPerSec).toFixed(3)
    ),
  };
}

/**
 * Runs `trials` headless perimeter spawns across all aircraft kinds + MAYDAYs and simulates
 * 20 seconds of unvectored flight each, verifying zero R-118 MOA entries or `< 2.0 NM` grazes.
 */
export function testSpawnSafety(
  sim: ApproachSimulation,
  trials = 200
): ApproachSpawnSafetyReport {
  const noopAudio: ApproachAudioCallbacks = {
    onCheckin: () => {},
    onVectorAck: () => {},
    onLocalizerLock: () => {},
    onHoldEntered: () => {},
    onGoAround: () => {},
    onJokerFuel: () => {},
    onMaydayBingo: () => {},
    onRunwayFlipWarning: () => {},
    onAtisFlip: () => {},
    onConflictAlert: () => {},
    onConflictCleared: () => {},
    onRestrictedZoneAlert: () => {},
    onDepartureCleared: () => {},
    onDepartureComplete: () => {},
    onSpeedChanged: () => {},
    onTextbookIlsBonus: () => {},
    onFumesSaveBonus: () => {},
    onTouchdown: () => {},
    onMishapBreach: () => {},
    onRadarSweepTick: () => {},
  };

  const count = clamp(Math.floor(trials), 1, 2000);
  const kinds: readonly AircraftKind[] = ['DROPSHIP', 'HEAVY', 'TUG', 'MAYDAY'];
  const violations: ApproachSpawnSafetyReport['violations'] = [];
  let minSpawnDistNm = Infinity;
  let minFlightDistNm = Infinity;

  const probe = new ApproachSimulation(noopAudio);
  probe.setAirspaceBounds(sim.airspaceHalfWidthNm, sim.airspaceHalfHeightNm);

  for (let i = 0; i < count; i++) {
    const kind = kinds[i % kinds.length];
    probe.startTrainingSession();
    // Alternate active runways (27/09 + crosswind 36/18) so all heavy arrival sectors are exercised
    probe.primaryRunway = i % 2 === 0 ? '27' : '09';
    probe.activeRunway = probe.primaryRunway;
    if (i % 4 >= 2) {
      probe.secondaryRunwayOpen = true;
      probe.activeSecondaryRunway = i % 2 === 0 ? '36' : '18';
    }

    let craft: ApproachAircraft;
    if (kind === 'MAYDAY') {
      craft = probe.spawnMaydayNow();
    } else {
      const spawn = probe.sampleSafePerimeterSpawn(kind);
      craft = probe.spawnScenarioCraft(kind, spawn.pos, spawn.headingDeg);
    }

    const spawnPos: Vec2 = { x: Number(craft.x.toFixed(2)), y: Number(craft.y.toFixed(2)) };
    const spawnHdg = Math.round(craft.headingDeg);
    const spawnDist = distanceToRestrictedZoneNm(craft.x, craft.y);
    if (spawnDist < minSpawnDistNm) minSpawnDistNm = spawnDist;

    let minDist = spawnDist;
    let enteredMoa = craft.inRestrictedZone || spawnDist <= 0;

    // Simulate 20 seconds of unvectored flight (200 steps @ 0.1s)
    for (let step = 0; step < 200; step++) {
      probe.update(0.1);
      const live = probe.getAircraftById(craft.id);
      if (!live) break;
      const d = distanceToRestrictedZoneNm(live.x, live.y);
      if (d < minDist) minDist = d;
      if (live.inRestrictedZone || d <= 0) enteredMoa = true;
    }

    if (minDist < minFlightDistNm) minFlightDistNm = minDist;

    if (enteredMoa || spawnDist < 2.8 || minDist < 2.0) {
      violations.push({
        trial: i,
        kind,
        spawnPos,
        headingDeg: spawnHdg,
        minDistNm: Number(minDist.toFixed(3)),
        enteredMoa,
      });
    }
  }

  return {
    trials: count,
    passed: count - violations.length,
    failed: violations.length,
    minSpawnDistNm: Number((Number.isFinite(minSpawnDistNm) ? minSpawnDistNm : 0).toFixed(3)),
    minFlightDistNm: Number((Number.isFinite(minFlightDistNm) ? minFlightDistNm : 0).toFixed(3)),
    violations,
  };
}

/** Returns a clean serializable snapshot for `window.__APPROACH_DEBUG__.getState()`. */
export function getDebugSnapshot(sim: ApproachSimulation): ApproachDebugSnapshot {
  return {
    phase: sim.phase,
    score: sim.score,
    landedCount: sim.landedCount,
    departuresCleared: sim.departuresCleared,
    cleanStreak: sim.cleanStreak,
    bestCleanStreak: sim.bestCleanStreak,
    sealsRestored: sim.sealsRestored,
    gapLaunchesCount: sim.gapLaunchesCount,
    medevacExpressCount: sim.medevacExpressCount,
    firstIonStormSpawned: sim.firstIonStormSpawned,
    safetySeals: sim.safetySeals,
    maxSafetySeals: sim.maxSafetySeals,
    multiplier: sim.multiplier,
    maxMultiplier: sim.maxMultiplier,
    shiftPhase: sim.shiftPhase,
    atisLetter: sim.atisLetter,
    activeRunway: sim.activeRunway,
    primaryRunway: sim.primaryRunway,
    secondaryRunwayOpen: sim.secondaryRunwayOpen,
    activeSecondaryRunway: sim.activeSecondaryRunway,
    pendingRunway: sim.pendingRunway,
    pendingPrimaryRunway: sim.pendingPrimaryRunway,
    pendingSecondaryRunway: sim.pendingSecondaryRunway,
    runwayFlipCountdownSec: Number(sim.runwayFlipCountdownSec.toFixed(2)),
    windHeadingDeg: sim.windHeadingDeg,
    windSpeedKt: sim.windSpeedKt,
    windGustKt: sim.windGustKt,
    airspaceHalfWidthNm: Number(sim.airspaceHalfWidthNm.toFixed(2)),
    airspaceHalfHeightNm: Number(sim.airspaceHalfHeightNm.toFixed(2)),
    trainingMode: sim.trainingMode,
    timeScale: Number(sim.timeScale.toFixed(2)),
    conflictActive: sim.conflictActive,
    minSeparationNm: Number(sim.minSeparationNm.toFixed(2)),
    incidentFreezeTimer: Number(sim.incidentFreezeTimer.toFixed(2)),
    antiDoubleStrikeTimer: Number(sim.antiDoubleStrikeTimer.toFixed(2)),
    gameOverLockoutTimer: Number(sim.gameOverLockoutTimer.toFixed(2)),
    ranked1979Bonus: sim.ranked1979Bonus,
    aircraftCount: sim.aircraft.length,
    stormCount: sim.storms.length,
    bogeyCount: sim.bogeys.length,
    departureQueueCount: sim.departureQueue.length,
    departureQueue: sim.departureQueue.map((d) => ({
      ...d,
      holdShortPos: { ...d.holdShortPos },
      waitSec: Number(d.waitSec.toFixed(1)),
    })),
    aircraft: sim.aircraft.map((c) => ({
      id: c.id,
      callsign: c.callsign,
      kind: c.kind,
      x: Number(c.x.toFixed(2)),
      y: Number(c.y.toFixed(2)),
      headingDeg: Math.round(c.headingDeg),
      speedMode: c.speedMode,
      speedKt: c.speedKt,
      altitudeFt: Math.round(c.altitudeFt),
      state: c.state,
      fuelSec: Number(c.fuelSec.toFixed(1)),
      fuelStatus: c.fuelStatus,
      lockedTarget: c.lockedTarget,
      assignedHoldFix: c.assignedHoldFix,
      holdAltitudeSlot: c.holdAltitudeSlot,
      inStorm: c.inStorm,
      inConflict: c.inConflict,
      inRestrictedZone: c.inRestrictedZone,
      restrictedExposureSec: Number(c.restrictedExposureSec.toFixed(2)),
      isDeparture: c.isDeparture,
      isMedevac: c.isMedevac,
      medevacExpressTimerSec: Number(c.medevacExpressTimerSec.toFixed(1)),
      gapLaunchEligible: c.gapLaunchEligible,
    })),
  };
}

export interface ApproachDebugInstallDeps {
  sim: ApproachSimulation;
  audio: ApproachAudio;
  host: HostEnvironment;
  hudRenderer: ApproachHudRenderer;
  tutorial: ApproachTutorialDirector;
  startShift: () => void;
  startTutorial: () => void;
  getCurrentLayout: () => ApproachHudLayout;
  getViewportOffset: () => { x: number; y: number };
  getStatusSnapshot: () => Omit<ReturnType<ApproachDebugHandle['getStatusBanner']>, 'debugTainted'>;
}

/**
 * Installs `window.__APPROACH_DEBUG__` exclusively during `import.meta.env.DEV`.
 * Keeping all debug string literals and taint state inside this module guarantees
 * ZERO dev-helper identifiers leak into production `dist/` bundles.
 */
export function installApproachDebugHandle(deps: ApproachDebugInstallDeps): void {
  const { sim, audio, host, hudRenderer, tutorial } = deps;
  clearSessionTainted(sim);

  const ensureActiveShift = (): void => {
    if (sim.phase !== 'ACTIVE_SHIFT') {
      deps.startShift();
    }
    markSessionTainted(sim);
  };

  window.__APPROACH_DEBUG__ = {
    getState: () => getDebugSnapshot(sim),
    startShift: () => {
      deps.startShift();
      markSessionTainted(sim);
    },
    jumpToLanded: (n: number) => {
      ensureActiveShift();
      jumpToLandedCount(sim, n);
    },
    unlockSecondaryRunway: () => {
      ensureActiveShift();
      unlockSecondaryRunway(sim);
    },
    triggerRunwayFlip: () => {
      ensureActiveShift();
      sim.triggerRunwayFlipNow();
    },
    setRunwayFlipCountdown: (sec: number) => {
      markSessionTainted(sim);
      if (sim.pendingRunway !== null) {
        sim.runwayFlipCountdownSec = Math.max(0.05, sec);
      }
    },
    spawnStorm: (pos?: Vec2) => {
      ensureActiveShift();
      sim.spawnStormNow(pos);
    },
    spawnMayday: (pos?: Vec2) => {
      ensureActiveShift();
      return sim.spawnMaydayNow(pos).id;
    },
    spawnMedevac: (pos?: Vec2) => {
      ensureActiveShift();
      return sim.spawnMedevacNow(pos).id;
    },
    spawnTwoShipElement: () => {
      ensureActiveShift();
      return sim.spawnTwoShipElementNow().map((c) => c.id);
    },
    spawnBogey: (pos?: Vec2, headingDeg?: number) => {
      ensureActiveShift();
      sim.spawnBogeyNow(pos, headingDeg);
    },
    spawnCraft: (kind, pos, headingDeg, opts) => {
      ensureActiveShift();
      return spawnCraftAt(sim, kind, pos, headingDeg, opts).id;
    },
    queueDeparture: (opts?: { kind?: 'DROPSHIP' | 'HEAVY'; runway?: ActiveRunwayId; callsign?: string }) => {
      ensureActiveShift();
      return queueDeparture(sim, opts);
    },
    clearDeparture: (depId?: number) => {
      markSessionTainted(sim);
      const id = clearDeparture(sim, depId);
      if (id !== null) {
        tutorial.notifyDepartureCleared();
      }
      return id;
    },
    getDepartureStatus: (rwyId?: ActiveRunwayId) =>
      sim.getDepartureRunwayStatus(rwyId ?? sim.primaryRunway),
    getHoldStackInfo: (fixId: HoldingFixId) => sim.getFixStackOccupancy(fixId),
    setCraftSpeedMode: (id: number, mode: SpeedMode) => {
      markSessionTainted(sim);
      return setCraftSpeedMode(sim, id, mode);
    },
    cycleCraftSpeed: (id: number, delta: 1 | -1) => {
      markSessionTainted(sim);
      return cycleCraftSpeed(sim, id, delta);
    },
    setTrainingMode: (enabled: boolean) => {
      markSessionTainted(sim);
      sim.trainingMode = Boolean(enabled);
    },
    setTimeScale: (scale: number) => {
      markSessionTainted(sim);
      sim.timeScale = Math.max(0, Math.min(4, scale));
    },
    startTutorial: () => {
      deps.startTutorial();
      markSessionTainted(sim);
    },
    advanceTutorialStep: () => {
      markSessionTainted(sim);
      tutorial.advanceStep(sim);
    },
    jumpTutorialStep: (stepIdx: number) => {
      markSessionTainted(sim);
      tutorial.jumpToStep(sim, stepIdx);
    },
    getTutorialState: () => tutorial.getOverlayState(sim),
    getRestrictedZone: () => ({
      ...AIRFIELD_GEOMETRY.restrictedZone,
      center: { ...AIRFIELD_GEOMETRY.restrictedZone.center },
      vertices: AIRFIELD_GEOMETRY.restrictedZone.vertices.map((v) => ({ ...v })),
    }),
    testSpawnSafety: (trials?: number) => testSpawnSafety(sim, trials),
    getCraftTurnRadius: (id: number) => getCraftTurnRadius(sim, id),
    queueRadioClip: (id: ApproachRadioClipId, opts?: RadioQueueOptions) =>
      audio.queueRadio(id, opts),
    getMusicDebug: () => host.music.getDebugState(),
    isAtcMuted: () => audio.isAtcMuted(),
    setAtcMuted: (muted: boolean) => audio.setAtcMuted(muted),
    clearEntities: () => {
      markSessionTainted(sim);
      clearEntities(sim);
    },
    setFuel: (id: number, fuelSec: number) => {
      markSessionTainted(sim);
      return setFuel(sim, id, fuelSec);
    },
    setMultiplier: (mult: number) => {
      markSessionTainted(sim);
      setMultiplier(sim, mult);
    },
    setCleanStreak: (n: number) => {
      markSessionTainted(sim);
      setCleanStreak(sim, n);
    },
    setSafetySeals: (n: number) => {
      markSessionTainted(sim);
      setSafetySeals(sim, n);
    },
    commandGoAround: (id?: number) => {
      markSessionTainted(sim);
      const targetId = id ?? sim.aircraft[0]?.id;
      if (targetId === undefined) return false;
      return sim.commandGoAround(targetId);
    },
    commandSmartHold: (craftId: number | string) => {
      markSessionTainted(sim);
      return sim.commandSmartHold(craftId);
    },
    assignPath: (id: number, pts: Vec2[]) => {
      markSessionTainted(sim);
      return sim.assignVectorPath(id, pts);
    },
    forceSealBreach: (reason?: MishapReason) => {
      ensureActiveShift();
      forceSealBreachNow(sim, reason);
    },
    forceConflict: () => {
      ensureActiveShift();
      forceConflictNow(sim);
    },
    nmToClient: (nmX: number, nmY: number) => {
      const layout = deps.getCurrentLayout();
      const pt = nmToScreen(nmX, nmY, layout.scopeViewport);
      const off = deps.getViewportOffset();
      return { x: Math.round(off.x + pt.x), y: Math.round(off.y + pt.y) };
    },
    getHudButtons: () => {
      const off = deps.getViewportOffset();
      return hudRenderer.buttons.map((b) => ({
        id: b.id,
        label: b.label ?? '',
        x: Math.round(off.x + b.rect.x),
        y: Math.round(off.y + b.rect.y),
        width: Math.round(b.rect.width),
        height: Math.round(b.rect.height),
      }));
    },
    getAudioDebug: () => {
      const stats = audio.getLoadedAudioStats();
      const activeTx = audio.getActiveTransmission();
      return {
        fetched: stats.fetched,
        decoded: stats.decoded,
        expected: stats.expected,
        contextState: stats.contextState,
        isTransmitting: audio.isRadioTransmitting(),
        activeTxId: activeTx?.id ?? null,
        activeTxPriority: activeTx?.priority ?? null,
        queueLength: audio.getRadioQueueLength(),
        queuedIds: audio.getRadioQueueIds(),
        radioLevel: audio.getSmoothedRadioLevel(),
        conflictToneActive: audio.isConflictToneActive(),
        muted: audio.isMuted(),
        atcMuted: audio.isAtcMuted(),
        atcOutputGain: audio.getAtcOutputGain(),
      };
    },
    getCommsLog: () => sim.commsLog.map((e) => ({ ...e })),
    getStatusBanner: () => ({
      debugTainted: isSessionTainted(sim),
      ...deps.getStatusSnapshot(),
    }),
  };
}

export function uninstallApproachDebugHandle(sim: ApproachSimulation): void {
  delete window.__APPROACH_DEBUG__;
  clearSessionTainted(sim);
}
