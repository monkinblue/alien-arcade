import type { Vec2 } from '../../types';
import {
  AIRCRAFT_PROFILES,
  AIRFIELD_GEOMETRY,
  APPROACH_CONSTANTS,
  SHIFT_PHASES,
  SHIFT_PHASE_BY_ID,
  SPEED_MODE_PROFILES,
  distanceToRestrictedZoneNm,
  getAlignedWindHeadingDeg,
  getCraftMinTurnRadiusNm,
  getDepartureHeadingDeg,
  getHoldingFixById,
  getMissedApproachHeadingDeg,
  getRunwayFafNm,
  getRunwayHoldShortNm,
  getRunwayIlsLengthNm,
  getRunwayLandingHeadingDeg,
  getRunwayOutwardUnitVec,
  getRunwayThresholdNm,
  getTightSequenceWindowSec,
  headingDegToUnitVec,
  isPointInRestrictedZone,
  landingZoneToRunway,
  normalizeHeadingDeg,
  polylineIntersectsRestrictedZone,
  posToCompassSector,
  runwayToLandingZone,
  segmentIntersectsRestrictedZone,
  segmentNearRestrictedZone,
  shortestHeadingDiffDeg,
  vecToHeadingDeg,
  type ActiveRunwayId,
  type AircraftKind,
  type ApproachAircraft,
  type ApproachAudioCallbacks,
  type ApproachCrtShockwave,
  type ApproachPhase,
  type ApproachPopup,
  type CommsLogEntry,
  type ConflictPair,
  type DepartureQueueItem,
  type DepartureRunwayStatus,
  type FlightStripData,
  type HoldAltitudeSlot,
  type HoldFixStackOccupancy,
  type HoldingFixDef,
  type HoldingFixId,
  type IonStormCell,
  type LandingZoneId,
  type MishapReason,
  type PrimaryBogey,
  type PrimaryRunwayId,
  type SecondaryRunwayId,
  type ShiftPhaseConfig,
  type ShiftPhaseId,
  type SmartHoldResult,
  type SpeedMode,
  type VectorPreviewResult,
} from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function distNm(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

function formatClock(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function getHoldingFixDef(id: HoldingFixId): HoldingFixDef {
  return getHoldingFixById(id);
}

function computePhaseForLanded(landed: number): ShiftPhaseId {
  if (landed >= 42) return 'ECHO';
  if (landed >= 27) return 'DELTA';
  if (landed >= 15) return 'CHARLIE';
  if (landed >= 6) return 'BRAVO';
  return 'ALPHA';
}

const MEDEVAC_CALLSIGNS = ['DUSTOFF-1', 'MEDEVAC-4', 'LIFEGUARD-2', 'CASEVAC-7'] as const;
const TWO_SHIP_ELEMENT_BASES = ['TALON', 'SABER', 'RAVEN', 'FALCON'] as const;

const OUTER_STORM_TRACKS: readonly { x: number; y: number; vx: number; vy: number }[] = [
  { x: 11.8, y: 9.8, vx: -0.28, vy: -0.06 },
  { x: 12.6, y: -3.2, vx: -0.2, vy: 0.25 },
  { x: -1.8, y: -11.4, vx: 0.26, vy: 0.14 },
  { x: -12.6, y: 3.4, vx: 0.22, vy: 0.24 },
];

const OUTER_BOGEY_LANES: readonly { start: Vec2; end: Vec2 }[] = [
  { start: { x: 8.8, y: 13.8 }, end: { x: 7.2, y: -13.8 } },
  { start: { x: 15.5, y: 8.8 }, end: { x: -15.5, y: 7.4 } },
  { start: { x: 15.5, y: -6.8 }, end: { x: -4.5, y: -13.8 } },
];

function nextAtisChar(letter: string): string {
  const code = letter.charCodeAt(0);
  if (code < 65 || code >= 90) return 'A';
  return String.fromCharCode(code + 1);
}

const SPEED_MODE_ORDER: readonly SpeedMode[] = ['SLOW', 'STD', 'FAST'];

/**
 * Core RAPCON Radar Approach Control Simulation for Program #5:
 * BOREALIS APPROACH // LV-118 RAPCON (v2.0).
 *
 * Pure headless simulation — zero DOM or Canvas dependencies.
 */
export class ApproachSimulation {
  public phase: ApproachPhase = 'TITLE';
  public paused = false;
  public trainingMode = false;
  public timeScale = 1.0;

  // Expanded rectangular radar airspace bounds (in NM from origin)
  public airspaceHalfWidthNm: number = APPROACH_CONSTANTS.DEFAULT_AIRSPACE_HALF_WIDTH_NM;
  public airspaceHalfHeightNm: number = APPROACH_CONSTANTS.DEFAULT_AIRSPACE_HALF_HEIGHT_NM;

  // Score & streak telemetry
  public score = 0;
  /** True when launched in 1979 CRT Mode (grants baseline 1.5x Ranked score multiplier). */
  public ranked1979Bonus = false;
  public landedCount = 0;
  public departuresCleared = 0;
  public cleanStreak = 0;
  public bestCleanStreak = 0;
  public sealsRestored = 0;
  public multiplier: number = APPROACH_CONSTANTS.CLEAN_MULTIPLIER_MIN;
  public maxMultiplier: number = APPROACH_CONSTANTS.CLEAN_MULTIPLIER_MIN;
  public sequencedCount = 0;
  public textbookIlsCount = 0;
  public fumesSavesCount = 0;
  public gapLaunchesCount = 0;
  public medevacExpressCount = 0;
  public maydaysSaved = 0;
  public goAroundCount = 0;
  public firstIonStormSpawned = false;
  /** Optional one-time hook fired on the first live Ion Static spawn of a shift. */
  public onFirstIonStorm: ((storm: IonStormCell) => void) | null = null;

  // ICC Safety Seals (3-strikes)
  public safetySeals: number = APPROACH_CONSTANTS.INITIAL_SAFETY_SEALS;
  public readonly maxSafetySeals: number = APPROACH_CONSTANTS.INITIAL_SAFETY_SEALS;

  // Airfield weather, ATIS, and dual-runway state
  public shiftPhase: ShiftPhaseId = 'ALPHA';
  public atisLetter = 'A';
  /** Backward-compatible alias synced to `primaryRunway` ('27' | '09'). */
  public activeRunway: PrimaryRunwayId = '27';
  public primaryRunway: PrimaryRunwayId = '27';
  public secondaryRunwayOpen = false;
  public activeSecondaryRunway: SecondaryRunwayId | null = null;
  /** Backward-compatible alias synced to `pendingPrimaryRunway ?? pendingSecondaryRunway`. */
  public pendingRunway: ActiveRunwayId | null = null;
  public pendingPrimaryRunway: PrimaryRunwayId | null = null;
  public pendingSecondaryRunway: SecondaryRunwayId | null = null;
  public runwayFlipCountdownSec = 0;
  public windHeadingDeg = 270;
  public windDisplayHeadingDeg = 270;
  public windSpeedKt = 18;
  public windGustKt = 24;
  public altimeterInHg: number = APPROACH_CONSTANTS.ALTIMETER_INHG;

  // Radar & timing telemetry
  public radarSweepDeg = 0;
  public shiftElapsedSec = 0;
  public gameOverLockoutTimer = 0;
  public gameOverReason = '';

  // Separation, Conflict Alert (CA), and Incident Freeze state
  public conflictActive = false;
  public minSeparationNm = 99;
  public conflictPairs: ConflictPair[] = [];
  public incidentFreezeTimer = 0;
  public incidentPos: Vec2 | null = null;
  public incidentReason: MishapReason | null = null;
  public incidentCallout = '';
  public antiDoubleStrikeTimer = 0;

  // Live tactical entities & feedback queues
  public aircraft: ApproachAircraft[] = [];
  public departureQueue: DepartureQueueItem[] = [];
  public storms: IonStormCell[] = [];
  public bogeys: PrimaryBogey[] = [];
  public commsLog: CommsLogEntry[] = [];
  public popups: ApproachPopup[] = [];
  public crtShockwaves: ApproachCrtShockwave[] = [];

  // Visual juice / HUD pulse state
  public screenShake = 0;
  public sealBreachFlashTimer = 0;
  public runwayFlipFlashTimer = 0;
  public lastTxCaption = '';
  public lastTxTimer = 0;

  private audioCb: ApproachAudioCallbacks;
  private nextEntityId = 1;
  private nextDepartureId = 1;
  private nextLogId = 1;
  private nextPopupId = 1;
  private nextStormNum = 1;
  private nextBogeyNum = 1;
  private callsignCounters: Record<string, number> = {};

  private spawnTimerSec = 0;
  private departureSpawnTimerSec = 14;
  private stormSpawnTimerSec = 26;
  private windFlipTimerSec = 24;
  private maydayTimerSec = 24;
  private bogeyTimerSec = 14;
  private caAudioCooldownSec = 0;
  private caMultiplierPenaltyCooldownSec = 0;
  private restrictedPenaltyCooldownSec = 0;
  private trailSampleAccum = 0;
  private lastTouchdownByZone: Partial<Record<LandingZoneId, number>> = {};

  constructor(audioCb: ApproachAudioCallbacks) {
    this.audioCb = audioCb;
    this.resetToTitle();
  }

  /** Updates the live rectangular radar airspace bounds in NM (persists across shift resets). */
  public setAirspaceBounds(halfW: number, halfH: number): void {
    if (Number.isFinite(halfW) && halfW >= 10) {
      this.airspaceHalfWidthNm = clamp(halfW, 10, 32);
    }
    if (Number.isFinite(halfH) && halfH >= 10) {
      this.airspaceHalfHeightNm = clamp(halfH, 10, 24);
    }
  }

  /** Baseline Ranked score multiplier: 1.5x in 1979 CRT Mode, 1.0x in Clean Mode. */
  public getBaseScoreMultiplier(): number {
    return this.ranked1979Bonus ? APPROACH_CONSTANTS.RANKED_1979_MULTIPLIER : 1.0;
  }

  public getShiftPhaseConfig(): ShiftPhaseConfig {
    return SHIFT_PHASE_BY_ID[this.shiftPhase];
  }

  /** Returns the human-readable shift phase title (e.g. 'NIGHT WATCH') cleanly separate from `atisLetter`. */
  public getShiftPhaseTitle(): string {
    return SHIFT_PHASE_BY_ID[this.shiftPhase].title;
  }

  /** Returns all currently active runways (primary plus open secondary crosswind runway). */
  public getActiveRunways(): ActiveRunwayId[] {
    if (this.secondaryRunwayOpen && this.activeSecondaryRunway !== null) {
      return [this.primaryRunway, this.activeSecondaryRunway];
    }
    return [this.primaryRunway];
  }

  public isRunwayActive(runway: ActiveRunwayId): boolean {
    if (runway === this.primaryRunway) return true;
    return this.secondaryRunwayOpen && runway === this.activeSecondaryRunway;
  }

  public getShiftProgress(): {
    current: number;
    phaseMin: number;
    phaseNext: number | null;
    ratio: number;
  } {
    const cfg = this.getShiftPhaseConfig();
    if (cfg.nextLanded === null) {
      return {
        current: this.landedCount,
        phaseMin: cfg.minLanded,
        phaseNext: null,
        ratio: 1,
      };
    }
    const span = Math.max(1, cfg.nextLanded - cfg.minLanded);
    return {
      current: this.landedCount,
      phaseMin: cfg.minLanded,
      phaseNext: cfg.nextLanded,
      ratio: clamp((this.landedCount - cfg.minLanded) / span, 0, 1),
    };
  }

  public getAircraftById(id: number): ApproachAircraft | undefined {
    return this.aircraft.find((c) => c.id === id);
  }

  /**
   * Finds the best controllable aircraft within `hitRadiusNm` of `(nmX, nmY)`.
   * Ladder-Down Quick-Release: when multiple craft are within hit radius AND clustered near
   * an occupied holding fix (<= 2.6 NM), tie-breaks in favor of lowest `fuelSec`, then lowest
   * `holdAltitudeSlot`, so dragging off a stack effortlessly grabs the ship needing to land next.
   */
  public findAircraftAtNm(nmX: number, nmY: number, hitRadiusNm = 1.35): ApproachAircraft | null {
    const candidates: Array<{ craft: ApproachAircraft; dist: number }> = [];
    for (const craft of this.aircraft) {
      if (craft.state === 'LANDING') continue;
      if (craft.isDeparture && craft.departureRollSec < APPROACH_CONSTANTS.DEPARTURE_ROLL_SEC) {
        continue;
      }
      const d = distNm(nmX, nmY, craft.x, craft.y);
      if (d <= hitRadiusNm) {
        candidates.push({ craft, dist: d });
      }
    }
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].craft;

    // Check if multiple candidates are clustered near any occupied hold fix (<= 2.6 NM)
    for (const fix of AIRFIELD_GEOMETRY.holdingFixes) {
      const occ = this.getFixStackOccupancy(fix.id);
      if (occ.count === 0) continue;
      const clustered = candidates.filter(
        (entry) => distNm(entry.craft.x, entry.craft.y, fix.pos.x, fix.pos.y) <= 2.6
      );
      if (clustered.length >= 2) {
        clustered.sort((a, b) => {
          if (Math.abs(a.craft.fuelSec - b.craft.fuelSec) > 0.05) {
            return a.craft.fuelSec - b.craft.fuelSec;
          }
          const slotA = a.craft.holdAltitudeSlot ?? 99;
          const slotB = b.craft.holdAltitudeSlot ?? 99;
          if (slotA !== slotB) return slotA - slotB;
          return a.dist - b.dist;
        });
        return clustered[0].craft;
      }
    }

    candidates.sort((a, b) => a.dist - b.dist);
    return candidates[0].craft;
  }

  /** Returns live vertical stack occupancy (max 3 slots: 3500 / 4500 / 5500 ft) for a holding fix. */
  public getFixStackOccupancy(fixId: HoldingFixId): HoldFixStackOccupancy {
    const max = APPROACH_CONSTANTS.HOLD_STACK_MAX_SLOTS;
    const slots: (string | null)[] = [null, null, null];
    const craftIds: (number | null)[] = [null, null, null];
    let count = 0;

    for (const c of this.aircraft) {
      if (c.assignedHoldFix !== fixId || c.holdAltitudeSlot === null) continue;
      const s = c.holdAltitudeSlot;
      if (s >= 0 && s < max && slots[s] === null) {
        slots[s] = c.callsign;
        craftIds[s] = c.id;
        count++;
      }
    }
    return { fixId, count, max, slots, craftIds };
  }

  private claimHoldAltitudeSlot(
    fixId: HoldingFixId,
    craft: ApproachAircraft
  ): HoldAltitudeSlot | null {
    if (craft.assignedHoldFix === fixId && craft.holdAltitudeSlot !== null) {
      return craft.holdAltitudeSlot;
    }
    const used = new Set<number>();
    for (const other of this.aircraft) {
      if (
        other.id !== craft.id &&
        other.assignedHoldFix === fixId &&
        other.holdAltitudeSlot !== null
      ) {
        used.add(other.holdAltitudeSlot);
      }
    }
    for (const slot of [0, 1, 2] as const) {
      if (!used.has(slot)) return slot;
    }
    return null;
  }

  /**
   * Scans inbound traffic within 5.5 NM of `runwayId`'s threshold/final/climb-out corridor
   * and evaluates whether the 6.0s post-landing Gap Launch bonus window is active.
   */
  public getDepartureRunwayStatus(runwayId: ActiveRunwayId): DepartureRunwayStatus {
    const th = getRunwayThresholdNm(runwayId);
    const out = getRunwayOutwardUnitVec(runwayId);
    const perpOutX = -out.y;
    const perpOutY = out.x;
    const depU = headingDegToUnitVec(getDepartureHeadingDeg(runwayId));
    const perpDepX = -depU.y;
    const perpDepY = depU.x;
    const zone = runwayToLandingZone(runwayId);
    const scanNm = APPROACH_CONSTANTS.DEPARTURE_FINAL_SCAN_NM;

    let nearestInboundNm: number | null = null;
    for (const c of this.aircraft) {
      if (c.isDeparture) continue;
      const dTh = distNm(c.x, c.y, th.x, th.y);
      const dx = c.x - th.x;
      const dy = c.y - th.y;
      const alongFinal = dx * out.x + dy * out.y;
      const crossFinal = Math.abs(dx * perpOutX + dy * perpOutY);
      const alongClimb = dx * depU.x + dy * depU.y;
      const crossClimb = Math.abs(dx * perpDepX + dy * perpDepY);

      const landingOnRunway = c.state === 'LANDING' && c.lockedTarget === zone;
      const lockedFinal = c.lockedTarget === zone && dTh <= scanNm;
      const inFinalCorridor = alongFinal >= -1.5 && alongFinal <= scanNm && crossFinal <= 2.2;
      const inClimbCorridor = alongClimb >= 0 && alongClimb <= scanNm && crossClimb <= 2.3;
      const overThreshold = dTh <= 3.5;

      if (landingOnRunway || lockedFinal || inFinalCorridor || inClimbCorridor || overThreshold) {
        if (nearestInboundNm === null || dTh < nearestInboundNm) {
          nearestInboundNm = dTh;
        }
      }
    }

    const lastLanding = this.lastTouchdownByZone[zone];
    const elapsedSinceLanding =
      lastLanding !== undefined ? this.shiftElapsedSec - lastLanding : Infinity;
    const gapWindowActive =
      elapsedSinceLanding >= 0 && elapsedSinceLanding <= APPROACH_CONSTANTS.GAP_LAUNCH_WINDOW_SEC;
    const gapSecondsLeft = gapWindowActive
      ? Math.max(0, APPROACH_CONSTANTS.GAP_LAUNCH_WINDOW_SEC - elapsedSinceLanding)
      : 0;

    return {
      clear: nearestInboundNm === null,
      nearestInboundNm: nearestInboundNm !== null ? Number(nearestInboundNm.toFixed(1)) : null,
      gapWindowActive,
      gapSecondsLeft: Number(gapSecondsLeft.toFixed(1)),
    };
  }

  /** Pings an aircraft (e.g. when clicking its Right-Column ATC Flight Progress Strip). */
  public pingAircraft(craftId: number): boolean {
    const craft = this.getAircraftById(craftId);
    if (!craft) return false;
    craft.pingTimer = APPROACH_CONSTANTS.CRAFT_PING_DURATION_SEC;
    return true;
  }

  /** Sets tactical speed mode ('SLOW' | 'STD' | 'FAST') on an aircraft. */
  public setCraftSpeedMode(craftId: number, mode: SpeedMode): boolean {
    const craft = this.getAircraftById(craftId);
    if (!craft || craft.state === 'LANDING' || craft.inStorm) return false;

    const prevMode = craft.speedMode;
    const speedCfg = SPEED_MODE_PROFILES[mode];
    const prof = AIRCRAFT_PROFILES[craft.kind];
    craft.speedMode = mode;
    craft.speedKt = Math.round(prof.speedKt * speedCfg.speedMult);
    craft.speedNmPerSec = prof.speedNmPerSec * speedCfg.speedMult;

    if (prevMode !== mode) {
      this.audioCb.onSpeedChanged(craft.callsign, mode);
      this.setTxCaption(`${craft.callsign}: SPD ${mode} (${craft.speedKt}KT)`);
      this.pushLog(craft.callsign, `${craft.callsign}: SPD ${mode} (${craft.speedKt}KT)`, 'cyan');
      this.spawnPopup(
        craft.x,
        craft.y + 0.72,
        `${speedCfg.label} ${craft.speedKt}KT`,
        undefined,
        mode === 'FAST' ? '#ffbb44' : mode === 'SLOW' ? '#55eeff' : '#66ff99',
        1.15
      );
    }
    return true;
  }

  /** Steps an aircraft's speed mode up (+1) or down (-1) across SLOW <-> STD <-> FAST. */
  public cycleCraftSpeed(craftId: number, delta: 1 | -1): SpeedMode | null {
    const craft = this.getAircraftById(craftId);
    if (!craft || craft.state === 'LANDING' || craft.inStorm) return null;
    const curIdx = SPEED_MODE_ORDER.indexOf(craft.speedMode);
    const nextIdx = clamp(curIdx + delta, 0, SPEED_MODE_ORDER.length - 1);
    const nextMode = SPEED_MODE_ORDER[nextIdx];
    this.setCraftSpeedMode(craftId, nextMode);
    return nextMode;
  }

  /** Returns urgency-sorted Flight Progress Strip records for the Right-Column ATC bay. */
  public getFlightStrips(): FlightStripData[] {
    const strips: FlightStripData[] = this.aircraft.map((c) => {
      let destLabel: string;
      if (c.isDeparture) {
        destLabel = `DEP ${c.departureRunway ?? this.primaryRunway}`;
      } else if (c.lockedTarget === 'RWY_27') destLabel = 'RWY 27';
      else if (c.lockedTarget === 'RWY_09') destLabel = 'RWY 09';
      else if (c.lockedTarget === 'RWY_36') destLabel = 'RWY 36';
      else if (c.lockedTarget === 'RWY_18') destLabel = 'RWY 18';
      else if (c.lockedTarget === 'PAD_ALPHA') destLabel = 'PAD α';
      else if (c.lockedTarget === 'SALVAGE_CRADLE') destLabel = 'CRADLE';
      else if (c.kind === 'HEAVY') {
        destLabel =
          this.secondaryRunwayOpen && this.activeSecondaryRunway
            ? `RWY ${this.primaryRunway}/${this.activeSecondaryRunway}`
            : `RWY ${this.primaryRunway}`;
      } else if (c.isMedevac) destLabel = 'PAD/RWY';
      else if (c.kind === 'DROPSHIP') destLabel = 'PAD α';
      else if (c.kind === 'TUG') destLabel = 'CRADLE';
      else destLabel = 'ANY OPEN';

      let statusTag = 'INBOUND';
      let urgencyRank = 6;
      if (c.isEmergency) {
        statusTag = c.lockedTarget ? 'EMRG LOCK' : 'MAYDAY';
        urgencyRank = 0;
      } else if (c.inRestrictedZone) {
        statusTag = 'R-118!';
        urgencyRank = 1;
      } else if (c.fuelStatus === 'BINGO') {
        statusTag = 'BINGO';
        urgencyRank = 1;
      } else if (c.inConflict) {
        statusTag = 'CA!';
        urgencyRank = 2;
      } else if (c.isMedevac && c.medevacExpressTimerSec > 0) {
        statusTag = `MEDEVAC ${Math.ceil(c.medevacExpressTimerSec)}S`;
        urgencyRank = 2;
      } else if (c.fuelStatus === 'JOKER') {
        statusTag = 'JOKER';
        urgencyRank = 3;
      } else if (c.inStorm) {
        statusTag = 'RF JAM';
        urgencyRank = 4;
      } else if (c.state === 'GO_AROUND') {
        statusTag = 'GO AROUND';
        urgencyRank = 5;
      } else if (c.isDeparture) {
        statusTag = 'DEPARTING';
        urgencyRank = 7;
      } else if (c.state === 'ESTABLISHED' || c.state === 'LANDING') {
        statusTag =
          landingZoneToRunway(c.lockedTarget) !== null
            ? 'ILS LOCK'
            : c.lockedTarget === 'PAD_ALPHA'
              ? 'PAD LOCK'
              : 'CRADLE LOCK';
        urgencyRank = 9;
      } else if (c.state === 'HOLDING' && c.assignedHoldFix) {
        statusTag = `HOLD ${c.assignedHoldFix}`;
        urgencyRank = 7;
      } else if (c.state === 'VECTORING') {
        statusTag = c.assignedHoldFix
          ? `TO ${c.assignedHoldFix}`
          : c.lockedTarget
            ? 'LOCKED'
            : 'VECTORS';
        urgencyRank = 8;
      }

      return {
        craftId: c.id,
        callsign: c.callsign,
        kind: c.kind,
        typeCode: c.isMedevac ? 'MED' : AIRCRAFT_PROFILES[c.kind].code,
        speedMode: c.speedMode,
        speedKt: c.speedKt,
        altitudeFt: Math.round(c.altitudeFt / 100) * 100,
        destLabel,
        fuelPct: Math.round(c.fuelPct),
        fuelSec: c.fuelSec,
        fuelStatus: c.fuelStatus,
        state: c.state,
        statusTag,
        urgencyRank,
        inStorm: c.inStorm,
        inConflict: c.inConflict,
        inRestrictedZone: c.inRestrictedZone,
        isDeparture: c.isDeparture,
        isMedevac: c.isMedevac,
        medevacExpressTimerSec: c.medevacExpressTimerSec,
        isPinged: c.pingTimer > 0,
        lockedTarget: c.lockedTarget,
        assignedHoldFix: c.assignedHoldFix,
        holdAltitudeSlot: c.holdAltitudeSlot,
      };
    });

    strips.sort((a, b) => {
      if (a.urgencyRank !== b.urgencyRank) return a.urgencyRank - b.urgencyRank;
      if (Math.abs(a.fuelSec - b.fuelSec) > 0.5) return a.fuelSec - b.fuelSec;
      return a.craftId - b.craftId;
    });
    return strips;
  }

  /** Resets simulation to the live ambient Title / Pre-Launch Briefing radar screen. */
  public resetToTitle(): void {
    this.phase = 'TITLE';
    this.paused = false;
    this.trainingMode = false;
    this.timeScale = 1.0;
    this.clearShiftState();

    // Seed calm ambient radar traffic for background atmosphere behind the Briefing overlay
    const c1 = this.createAircraft('HEAVY', { x: 11.2, y: 1.4 }, 258, 'ATLAS-7');
    c1.lockedTarget = 'RWY_27';
    c1.state = 'ESTABLISHED';
    c1.waypoints = [{ x: 8.0, y: 0 }, getRunwayFafNm('27'), getRunwayThresholdNm('27')];

    const c2 = this.createAircraft('DROPSHIP', { x: -8.6, y: 9.8 }, 135, 'VIPER-21');
    c2.assignedHoldFix = 'KRATO';
    c2.holdAltitudeSlot = 0;
    c2.altitudeFt = 3500;
    c2.state = 'HOLDING';
    c2.holdLegPhase = 'OUTBOUND';

    const c3 = this.createAircraft('TUG', { x: 8.4, y: -6.4 }, 330, 'RIG-3');
    c3.assignedHoldFix = 'VEXIS';
    c3.holdAltitudeSlot = 0;
    c3.altitudeFt = 3500;
    c3.state = 'HOLDING';
    c3.holdLegPhase = 'INBOUND';

    this.aircraft.push(c1, c2, c3);
    this.pushLog('ATIS', 'INFO A · WIND 270/18 · RWY 27', 'bright');
  }

  /** Starts a fresh Ranked RAPCON shift at INFO ALPHA — NIGHT WATCH. */
  public startNewShift(opts?: { ranked1979Bonus?: boolean }): void {
    this.clearShiftState();
    this.phase = 'ACTIVE_SHIFT';
    this.paused = false;
    this.trainingMode = false;
    this.timeScale = 1.0;
    this.ranked1979Bonus = Boolean(opts?.ranked1979Bonus);

    this.pushLog('ATIS', 'INFO A · WIND 270/18 · RWY 27', 'bright');
    this.pushLog('RAPCON', 'SHIFT ACTIVE — 3 NM MIN SEP', 'green');

    // Immediate well-spaced starter traffic: 1 Dropship (N) + 1 Heavy Hauler (E-SE outside FAF)
    this.callsignCounters['VIPER'] = 1;
    this.callsignCounters['ATLAS'] = 7;

    const viper = this.createAircraft('DROPSHIP', { x: -1.8, y: 12.6 }, 162, 'VIPER-21');
    this.aircraft.push(viper);
    this.announceCheckin(viper);

    const atlas = this.createAircraft('HEAVY', { x: 12.4, y: -3.2 }, 292, 'ATLAS-7');
    this.aircraft.push(atlas);
    this.announceCheckin(atlas);

    this.spawnTimerSec = 4.6;
  }

  /** Starts a clean interactive Training Mode shift (random schedulers paused, Game Over disabled). */
  public startTrainingSession(): void {
    this.clearShiftState();
    this.phase = 'ACTIVE_SHIFT';
    this.paused = false;
    this.trainingMode = true;
    this.timeScale = 1.0;
    this.ranked1979Bonus = false;
    this.pushLog('TRAIN', 'RAPCON TRAINING SIM ACTIVE', 'cyan');
  }

  /** Spawns a deterministic aircraft for training scenarios or scripted events. */
  public spawnScenarioCraft(
    kind: AircraftKind,
    pos: Vec2,
    headingDeg: number,
    opts?: { callsign?: string; fuelSec?: number; speedMode?: SpeedMode }
  ): ApproachAircraft {
    const craft = this.createAircraft(kind, pos, headingDeg, opts?.callsign, opts?.fuelSec);
    if (opts?.speedMode && opts.speedMode !== 'STD') {
      const speedCfg = SPEED_MODE_PROFILES[opts.speedMode];
      const prof = AIRCRAFT_PROFILES[kind];
      craft.speedMode = opts.speedMode;
      craft.speedKt = Math.round(prof.speedKt * speedCfg.speedMult);
      craft.speedNmPerSec = prof.speedNmPerSec * speedCfg.speedMult;
    }
    this.aircraft.push(craft);
    return craft;
  }

  /** Opens Secondary Crosswind Runway 36/18 and shifts wind to matching quartering headwind. */
  public unlockSecondaryRunway(explicitSecondary?: SecondaryRunwayId): void {
    if (this.secondaryRunwayOpen && !explicitSecondary) return;
    const nextSec: SecondaryRunwayId =
      explicitSecondary ?? (this.primaryRunway === '27' ? '36' : '18');
    this.secondaryRunwayOpen = true;
    this.activeSecondaryRunway = nextSec;
    this.windHeadingDeg = getAlignedWindHeadingDeg(this.primaryRunway, this.activeSecondaryRunway);
    this.windSpeedKt = 20;
    this.windGustKt = 26;
    this.runwayFlipFlashTimer = Math.max(this.runwayFlipFlashTimer, 2.6);

    const center = AIRFIELD_GEOMETRY.secondaryRunway.center;
    this.spawnShockwave(center.x, center.y, 8.5, 'amber', 0.95);
    this.spawnPopup(center.x, center.y + 1.4, `RWY ${nextSec} OPEN`, 'CROSSWIND OPS', '#55eeff', 2.4);
    this.pushLog('ATIS', `RWY ${nextSec} OPEN — CROSSWIND OPS`, 'bright');
    if (this.phase === 'ACTIVE_SHIFT' && !this.trainingMode) {
      this.audioCb.onSecondaryRunwayOpen?.(nextSec, this.atisLetter);
    }
  }

  /** Syncs shift phase, ATIS letter, and secondary runway progression against `landedCount`. */
  public syncShiftPhase(allowDowngrade = false): void {
    const nextPhase = computePhaseForLanded(this.landedCount);
    const prevCfg = SHIFT_PHASE_BY_ID[this.shiftPhase];
    const nextCfg = SHIFT_PHASE_BY_ID[nextPhase];

    if (allowDowngrade && nextCfg.index < prevCfg.index) {
      this.shiftPhase = nextPhase;
      this.atisLetter = nextCfg.defaultAtisLetter;
      if (!nextCfg.allowSecondaryRunway) {
        this.secondaryRunwayOpen = false;
        this.activeSecondaryRunway = null;
        this.pendingSecondaryRunway = null;
        this.windHeadingDeg = getAlignedWindHeadingDeg(this.primaryRunway, null);
      }
      return;
    }

    if (nextPhase !== this.shiftPhase) {
      this.shiftPhase = nextPhase;
      if (nextCfg.index > prevCfg.index && this.atisLetter < nextCfg.defaultAtisLetter) {
        this.atisLetter = nextCfg.defaultAtisLetter;
      }
      this.pushLog('RAPCON', `PHASE ${nextCfg.id} — ${nextCfg.title}`, 'bright');

      if (nextPhase === 'BRAVO' && this.storms.length === 0) {
        this.stormSpawnTimerSec = Math.min(this.stormSpawnTimerSec, 5.0);
      } else if (nextPhase === 'CHARLIE') {
        this.maydayTimerSec = 24.0;
      } else if (nextPhase === 'DELTA') {
        this.windFlipTimerSec = 24.0;
        this.bogeyTimerSec = Math.min(this.bogeyTimerSec, 12.0);
      }
    }

    if (nextCfg.allowSecondaryRunway && !this.secondaryRunwayOpen) {
      this.unlockSecondaryRunway();
    }
  }

  private clearShiftState(): void {
    this.score = 0;
    this.landedCount = 0;
    this.departuresCleared = 0;
    this.cleanStreak = 0;
    this.bestCleanStreak = 0;
    this.sealsRestored = 0;
    this.multiplier = APPROACH_CONSTANTS.CLEAN_MULTIPLIER_MIN;
    this.maxMultiplier = APPROACH_CONSTANTS.CLEAN_MULTIPLIER_MIN;
    this.sequencedCount = 0;
    this.textbookIlsCount = 0;
    this.fumesSavesCount = 0;
    this.gapLaunchesCount = 0;
    this.medevacExpressCount = 0;
    this.maydaysSaved = 0;
    this.goAroundCount = 0;
    this.firstIonStormSpawned = false;

    this.safetySeals = this.maxSafetySeals;
    this.shiftPhase = 'ALPHA';
    this.atisLetter = 'A';
    this.primaryRunway = '27';
    this.activeRunway = '27';
    this.secondaryRunwayOpen = false;
    this.activeSecondaryRunway = null;
    this.pendingRunway = null;
    this.pendingPrimaryRunway = null;
    this.pendingSecondaryRunway = null;
    this.runwayFlipCountdownSec = 0;
    this.windHeadingDeg = 270;
    this.windDisplayHeadingDeg = 270;
    this.windSpeedKt = 18;
    this.windGustKt = 24;
    this.altimeterInHg = APPROACH_CONSTANTS.ALTIMETER_INHG;

    this.shiftElapsedSec = 0;
    this.gameOverLockoutTimer = 0;
    this.gameOverReason = '';

    this.conflictActive = false;
    this.minSeparationNm = 99;
    this.conflictPairs = [];
    this.incidentFreezeTimer = 0;
    this.incidentPos = null;
    this.incidentReason = null;
    this.incidentCallout = '';
    this.antiDoubleStrikeTimer = 0;

    this.aircraft = [];
    this.departureQueue = [];
    this.storms = [];
    this.bogeys = [];
    this.commsLog = [];
    this.popups = [];
    this.crtShockwaves = [];

    this.screenShake = 0;
    this.sealBreachFlashTimer = 0;
    this.runwayFlipFlashTimer = 0;
    this.lastTxCaption = '';
    this.lastTxTimer = 0;

    this.nextEntityId = 1;
    this.nextDepartureId = 1;
    this.nextLogId = 1;
    this.nextPopupId = 1;
    this.nextStormNum = 1;
    this.nextBogeyNum = 1;
    this.callsignCounters = {};
    this.spawnTimerSec = 5.0;
    this.departureSpawnTimerSec = 14.0;
    this.stormSpawnTimerSec = 26.0;
    this.windFlipTimerSec = 24.0;
    this.maydayTimerSec = 24.0;
    this.bogeyTimerSec = 14.0;
    this.caAudioCooldownSec = 0;
    this.caMultiplierPenaltyCooldownSec = 0;
    this.restrictedPenaltyCooldownSec = 0;
    this.trailSampleAccum = 0;
    this.lastTouchdownByZone = {};
  }

  /**
   * Evaluates a raw dragged NM polyline for `craftId`, returning smoothed waypoints
   * and live magnetic snap status (`ILS_LOCK`, `PAD_LOCK`, `CRADLE_LOCK`, `HOLD_FIX`,
   * `UNSTABLE_REJECT`, or `NONE`) without mutating simulation state.
   */
  public previewAndSnapPath(craftId: number, rawWaypoints: readonly Vec2[]): VectorPreviewResult {
    const craft = this.getAircraftById(craftId);
    if (!craft || craft.state === 'LANDING') {
      return {
        valid: false,
        blockedByStorm: false,
        entersRestrictedZone: false,
        snapKind: 'NONE',
        lockedTarget: null,
        holdFix: null,
        waypoints: [],
        snapPoint: null,
        interceptAngleDeg: null,
        rejectReason: 'TARGET UNAVAILABLE',
      };
    }

    if (craft.inStorm) {
      return {
        valid: false,
        blockedByStorm: true,
        entersRestrictedZone: false,
        snapKind: 'NONE',
        lockedTarget: null,
        holdFix: null,
        waypoints: [],
        snapPoint: null,
        interceptAngleDeg: null,
        rejectReason: 'ION JAMMED — NO VECTORS',
      };
    }

    const cleaned = this.sanitizeWaypoints(craft, rawWaypoints);
    if (cleaned.length === 0) {
      return {
        valid: false,
        blockedByStorm: false,
        entersRestrictedZone: false,
        snapKind: 'NONE',
        lockedTarget: null,
        holdFix: null,
        waypoints: [],
        snapPoint: null,
        interceptAngleDeg: null,
      };
    }

    const withRestrictedFlag = (res: Omit<VectorPreviewResult, 'entersRestrictedZone'>): VectorPreviewResult => ({
      ...res,
      entersRestrictedZone: polylineIntersectsRestrictedZone([
        { x: craft.x, y: craft.y },
        ...res.waypoints,
      ]),
    });

    // Departing craft accept free tactical avoidance vectors without snapping to landing gates
    if (craft.isDeparture) {
      return withRestrictedFlag({
        valid: true,
        blockedByStorm: false,
        snapKind: 'NONE',
        lockedTarget: null,
        holdFix: null,
        waypoints: this.smoothPathForTurnRadius(craft, cleaned),
        snapPoint: null,
        interceptAngleDeg: null,
      });
    }

    const endPt = cleaned[cleaned.length - 1];
    const approachDir = this.computeEndingHeadingDeg(craft, cleaned);

    // 1. Check Named RNAV Holding Fixes (KRATO / BOREA / VEXIS) — available for ANY arrival craft!
    for (const fix of AIRFIELD_GEOMETRY.holdingFixes) {
      if (distNm(endPt.x, endPt.y, fix.pos.x, fix.pos.y) <= fix.snapRadiusNm) {
        const availableSlot = this.claimHoldAltitudeSlot(fix.id, craft);
        if (availableSlot === null) {
          return {
            valid: false,
            blockedByStorm: false,
            entersRestrictedZone: false,
            holdFixFull: true,
            snapKind: 'NONE',
            lockedTarget: null,
            holdFix: fix.id,
            waypoints: [],
            snapPoint: { ...fix.pos },
            interceptAngleDeg: null,
            rejectReason: `HOLD ${fix.id} FULL (3/3) — USE ANOTHER FIX`,
          };
        }
        const snapped = [...cleaned.slice(0, -1), { x: fix.pos.x, y: fix.pos.y }];
        return withRestrictedFlag({
          valid: true,
          blockedByStorm: false,
          snapKind: 'HOLD_FIX',
          lockedTarget: null,
          holdFix: fix.id,
          waypoints: this.smoothPathForTurnRadius(craft, snapped),
          snapPoint: { ...fix.pos },
          interceptAngleDeg: null,
        });
      }
    }

    // 2. Check VTOL Pad Alpha (valid for DROPSHIP, MEDEVAC, and MAYDAY)
    const padPos = AIRFIELD_GEOMETRY.padAlpha.pos;
    if (
      (craft.kind === 'DROPSHIP' || craft.kind === 'MAYDAY') &&
      distNm(endPt.x, endPt.y, padPos.x, padPos.y) <= AIRFIELD_GEOMETRY.padAlpha.captureRadiusNm
    ) {
      const snapped = [...cleaned.slice(0, -1), { x: padPos.x, y: padPos.y }];
      return withRestrictedFlag({
        valid: true,
        blockedByStorm: false,
        snapKind: 'PAD_LOCK',
        lockedTarget: 'PAD_ALPHA',
        holdFix: null,
        waypoints: this.smoothPathForTurnRadius(craft, snapped),
        snapPoint: { ...padPos },
        interceptAngleDeg: 0,
      });
    }

    // 3. Check Active Runway(s) ILS Localizers (Primary 27/09 + open Secondary 36/18)
    // Evaluated BEFORE Salvage Cradle so MAYDAY / MEDEVAC dragged onto RWY short final locks the runway.
    // ILS intercept angle & 5 NM FAF checks run on the user's intended `cleaned` path BEFORE smoothing!
    if (craft.kind === 'HEAVY' || craft.kind === 'MAYDAY' || craft.isMedevac) {
      const ilsSnap = this.evaluateRunwayIlsSnap(
        craft,
        cleaned,
        endPt,
        approachDir,
        craft.kind === 'MAYDAY' || craft.isMedevac
      );
      if (ilsSnap) {
        return withRestrictedFlag({
          ...ilsSnap,
          waypoints: this.smoothPathForTurnRadius(craft, ilsSnap.waypoints),
        });
      }
    }

    // 4. Check Orbital Salvage Cradle (valid for TUG and MAYDAY)
    if (craft.kind === 'TUG' || craft.kind === 'MAYDAY') {
      const cradleSnap = this.evaluateCradleSnap(cleaned, endPt, approachDir, craft.kind === 'MAYDAY');
      if (cradleSnap) {
        return withRestrictedFlag({
          ...cradleSnap,
          waypoints: this.smoothPathForTurnRadius(craft, cradleSnap.waypoints),
        });
      }
    }

    // 5. Ordinary free vector path
    return withRestrictedFlag({
      valid: true,
      blockedByStorm: false,
      snapKind: 'NONE',
      lockedTarget: null,
      holdFix: null,
      waypoints: this.smoothPathForTurnRadius(craft, cleaned),
      snapPoint: null,
      interceptAngleDeg: null,
    });
  }

  /**
   * Commits a vector path for `craftId`. Handles magnetic lock to ILS/Pad/Cradle,
   * RNAV holding fix assignment, storm re-vector lockouts, Textbook 30° ILS bonus,
   * and unstable Heavy ILS Go-Arounds.
   */
  public assignVectorPath(craftId: number, rawWaypoints: readonly Vec2[]): VectorPreviewResult {
    const craft = this.getAircraftById(craftId);
    const preview = this.previewAndSnapPath(craftId, rawWaypoints);
    if (!craft) return preview;

    if (preview.blockedByStorm) {
      this.pushLog(craft.callsign, `${craft.callsign}: ION JAM — NO VECTORS`, 'amber');
      this.spawnPopup(craft.x, craft.y + 0.8, 'ION JAMMED', undefined, '#ffaa22', 1.3);
      return preview;
    }

    if (preview.holdFixFull && preview.holdFix) {
      const fix = getHoldingFixDef(preview.holdFix);
      const msg = preview.rejectReason ?? `HOLD ${preview.holdFix} FULL (3/3) — USE ANOTHER FIX`;
      this.setTxCaption(msg);
      this.pushLog('RAPCON', msg, 'amber');
      this.spawnPopup(fix.pos.x, fix.pos.y + 0.9, `HOLD ${preview.holdFix} FULL`, '3/3 — USE ANOTHER FIX', '#ffaa22', 1.8);
      return preview;
    }

    if (preview.snapKind === 'UNSTABLE_REJECT') {
      this.executeGoAround(craft, false, preview.rejectReason ?? 'UNSTABLE APPROACH');
      return preview;
    }

    if (!preview.valid || preview.waypoints.length === 0) {
      return preview;
    }

    let claimedHoldSlot: HoldAltitudeSlot | null = null;
    if (preview.snapKind === 'HOLD_FIX' && preview.holdFix) {
      claimedHoldSlot = this.claimHoldAltitudeSlot(preview.holdFix, craft);
      if (claimedHoldSlot === null) {
        const fix = getHoldingFixDef(preview.holdFix);
        const msg = `HOLD ${preview.holdFix} FULL (3/3) — USE ANOTHER FIX`;
        this.setTxCaption(msg);
        this.pushLog('RAPCON', msg, 'amber');
        this.spawnPopup(fix.pos.x, fix.pos.y + 0.9, `HOLD ${preview.holdFix} FULL`, '3/3 — USE ANOTHER FIX', '#ffaa22', 1.8);
        return { ...preview, valid: false, holdFixFull: true, rejectReason: msg };
      }
    }

    craft.waypoints = preview.waypoints.map((p) => ({ x: p.x, y: p.y }));
    craft.lockedTarget = preview.lockedTarget;
    craft.assignedHoldFix = preview.holdFix;
    craft.holdAltitudeSlot = claimedHoldSlot;
    craft.goAroundTimer = 0;

    const pan = clamp(craft.x / Math.max(1, this.airspaceHalfWidthNm), -1, 1);

    if (preview.snapKind === 'HOLD_FIX' && preview.holdFix && claimedHoldSlot !== null) {
      const fix = getHoldingFixDef(preview.holdFix);
      const assignedAltFt =
        APPROACH_CONSTANTS.HOLD_STACK_BASE_ALT_FT +
        claimedHoldSlot * APPROACH_CONSTANTS.HOLD_STACK_STEP_ALT_FT;
      craft.holdLegPhase = 'ENTRY';
      craft.holdLegDistNm = 0;
      craft.holdTurnAccumDeg = 0;
      if (distNm(craft.x, craft.y, fix.pos.x, fix.pos.y) <= 1.15) {
        craft.state = 'HOLDING';
        craft.holdLegPhase = 'TURN_OUTBOUND';
        craft.waypoints = [];
      } else {
        craft.state = 'VECTORING';
      }
      this.audioCb.onHoldEntered(preview.holdFix, craft.callsign);
      this.setTxCaption(`${craft.callsign}: HOLD ${preview.holdFix} @ ${assignedAltFt}FT`);
      this.pushLog(
        craft.callsign,
        `${craft.callsign}, CLIMB MAINTAIN ${assignedAltFt}, PROCEED DIRECT ${preview.holdFix} AND HOLD`,
        'cyan'
      );
      this.spawnPopup(
        fix.pos.x,
        fix.pos.y + 0.9,
        `HOLD ${preview.holdFix}`,
        `${assignedAltFt} FT · 0.35× FUEL`,
        '#44ddbb',
        1.6
      );
    } else if (
      (preview.snapKind === 'ILS_LOCK' ||
        preview.snapKind === 'PAD_LOCK' ||
        preview.snapKind === 'CRADLE_LOCK') &&
      preview.lockedTarget
    ) {
      const lockedRwy = landingZoneToRunway(preview.lockedTarget);
      craft.state =
        preview.waypoints.length <= 2 && preview.snapKind !== 'ILS_LOCK'
          ? 'ESTABLISHED'
          : 'VECTORING';
      if (preview.snapKind === 'ILS_LOCK' && lockedRwy !== null) {
        const cross = this.getCrossTrackToRunwayNm(craft.x, craft.y, lockedRwy);
        const hdgDiff = Math.abs(
          shortestHeadingDiffDeg(craft.headingDeg, getRunwayLandingHeadingDeg(lockedRwy))
        );
        if (cross <= 1.2 && (craft.waypoints.length <= 3 || hdgDiff <= 50)) {
          craft.state = 'ESTABLISHED';
        }
      }

      this.audioCb.onLocalizerLock(preview.lockedTarget, pan, craft.callsign);
      const lockMsg =
        preview.snapKind === 'ILS_LOCK' && lockedRwy
          ? `ESTABLISHED, RWY ${lockedRwy}`
          : preview.snapKind === 'PAD_LOCK'
            ? 'INBOUND, PAD α'
            : 'LOCKED, SALVAGE CRADLE';
      this.setTxCaption(`${craft.callsign}: ${lockMsg}`);
      this.pushLog(craft.callsign, `${craft.callsign}: ${lockMsg}`, 'green');

      // Micro-scoring hook: +250 TEXTBOOK 30° ILS when Heavy locks outside FAF at 12°..36°!
      let awardedTextbook = false;
      if (
        preview.snapKind === 'ILS_LOCK' &&
        craft.kind === 'HEAVY' &&
        !craft.textbookIlsAwarded &&
        preview.interceptAngleDeg !== null &&
        preview.interceptAngleDeg >= APPROACH_CONSTANTS.TEXTBOOK_ILS_MIN_DEG &&
        preview.interceptAngleDeg <= APPROACH_CONSTANTS.TEXTBOOK_ILS_MAX_DEG
      ) {
        awardedTextbook = true;
        this.awardTextbookIlsBonus(
          craft,
          preview.interceptAngleDeg,
          preview.snapPoint ?? { x: craft.x, y: craft.y }
        );
      }

      if (preview.snapPoint && !awardedTextbook) {
        this.spawnPopup(
          preview.snapPoint.x,
          preview.snapPoint.y + 0.85,
          preview.snapKind === 'ILS_LOCK' && lockedRwy
            ? `ILS ${lockedRwy} LOCK`
            : preview.snapKind === 'PAD_LOCK'
              ? 'PAD α LOCK'
              : 'CRADLE LOCK',
          undefined,
          '#44ff88',
          1.25
        );
      }
    } else {
      if (!craft.isDeparture) {
        craft.state = 'VECTORING';
      }
      this.audioCb.onVectorAck(craft.callsign);
      this.setTxCaption(`${craft.callsign}: ROGER, TURNING`);
    }

    return preview;
  }

  /**
   * 1-Click Smart Hold / Safe Wave-Off (RMB or `[W]`):
   * Evaluates every holding fix (`KRATO`, `BOREA`, `VEXIS`) with an open vertical altitude slot
   * across 3 entry trajectories (`direct`, `+35°` dogleg, `-35°` dogleg), hard-rejecting any
   * path within 0.5 NM of `R-118 // HOT`, simulating 8.0s kinematic separation vs all traffic
   * & bogeys, and preferring storm-free shortest safe routes.
   */
  public commandSmartHold(craftId: number | string): SmartHoldResult {
    const craft =
      typeof craftId === 'number'
        ? this.getAircraftById(craftId)
        : this.aircraft.find((c) => c.callsign === craftId || String(c.id) === craftId);
    if (!craft) return { ok: false, reason: 'NOT_FOUND' };
    if (craft.inStorm) return { ok: false, reason: 'JAMMED' };
    if (craft.isDeparture) return { ok: false, reason: 'DEPARTING' };
    if (craft.state === 'HOLDING' && craft.assignedHoldFix) {
      return {
        ok: false,
        reason: 'ALREADY_HOLDING',
        fixId: craft.assignedHoldFix,
        slot: craft.holdAltitudeSlot ?? undefined,
      };
    }
    if (
      craft.state === 'LANDING' ||
      (craft.lockedTarget !== null &&
        distNm(
          craft.x,
          craft.y,
          this.getLandingZonePos(craft.lockedTarget).x,
          this.getLandingZonePos(craft.lockedTarget).y
        ) < 0.85)
    ) {
      return { ok: false, reason: 'FLARING' };
    }

    const openFixes: Array<{ fix: HoldingFixDef; slot: HoldAltitudeSlot; occCount: number }> = [];
    for (const fix of AIRFIELD_GEOMETRY.holdingFixes) {
      const slot = this.claimHoldAltitudeSlot(fix.id, craft);
      if (slot !== null) {
        openFixes.push({
          fix,
          slot,
          occCount: this.getFixStackOccupancy(fix.id).count,
        });
      }
    }
    if (openFixes.length === 0) {
      return { ok: false, reason: 'ALL_FULL' };
    }

    const maxX = Math.max(4, this.airspaceHalfWidthNm - 0.5);
    const maxY = Math.max(4, this.airspaceHalfHeightNm - 0.5);

    interface SmartHoldCandidate {
      fix: HoldingFixDef;
      slot: HoldAltitudeSlot;
      waypoints: Vec2[];
      score: number;
    }

    const evaluateCandidates = (moaBufferNm: number): SmartHoldCandidate | null => {
      let best: SmartHoldCandidate | null = null;
      const doglegAngles = [0, 35, -35] as const;

      for (const entry of openFixes) {
        const { fix, slot, occCount } = entry;
        const directDist = distNm(craft.x, craft.y, fix.pos.x, fix.pos.y);
        const directHdg =
          directDist > 0.05
            ? vecToHeadingDeg(fix.pos.x - craft.x, fix.pos.y - craft.y)
            : craft.headingDeg;

        for (const offsetDeg of doglegAngles) {
          let rawGuide: Vec2[];
          if (offsetDeg === 0 || directDist <= 1.25) {
            rawGuide = [{ x: fix.pos.x, y: fix.pos.y }];
          } else {
            const dogDist = Math.min(3.5, Math.max(1.8, directDist * 0.55));
            const u = headingDegToUnitVec(normalizeHeadingDeg(directHdg + offsetDeg));
            const midPt: Vec2 = {
              x: clamp(craft.x + u.x * dogDist, -maxX, maxX),
              y: clamp(craft.y + u.y * dogDist, -maxY, maxY),
            };
            rawGuide = [midPt, { x: fix.pos.x, y: fix.pos.y }];
          }

          const smoothPts = this.smoothPathForTurnRadius(craft, rawGuide);
          const poly: Vec2[] = [{ x: craft.x, y: craft.y }, ...smoothPts];

          // Hard-reject any route crossing or coming within `moaBufferNm` of R-118 // HOT
          let violatesMoa = false;
          for (let k = 0; k < poly.length - 1; k++) {
            if (
              moaBufferNm > 0
                ? segmentNearRestrictedZone(poly[k], poly[k + 1], moaBufferNm)
                : segmentIntersectsRestrictedZone(poly[k], poly[k + 1])
            ) {
              violatesMoa = true;
              break;
            }
          }
          if (violatesMoa) continue;

          // Compute path length and Ion Storm overlap
          let pathLen = 0;
          let hitsStormOuter = false;
          let hitsStormCore = false;
          for (let k = 0; k < poly.length - 1; k++) {
            pathLen += distNm(poly[k].x, poly[k].y, poly[k + 1].x, poly[k + 1].y);
            const mx = (poly[k].x + poly[k + 1].x) * 0.5;
            const my = (poly[k].y + poly[k + 1].y) * 0.5;
            for (const s of this.storms) {
              if (s.intensity < 0.45) continue;
              const ds = Math.min(
                distNm(poly[k + 1].x, poly[k + 1].y, s.x, s.y),
                distNm(mx, my, s.x, s.y)
              );
              if (ds <= s.coreRadiusNm) hitsStormCore = true;
              else if (ds <= s.radiusNm) hitsStormOuter = true;
            }
          }

          // 8.0s kinematic lookahead vs all active non-exempt traffic + Primary Bogeys
          let minSepNm = 99;
          const stepDt = 0.4;
          const steps = 20; // 8.0s lookahead
          for (let sIdx = 1; sIdx <= steps; sIdx++) {
            const t = sIdx * stepDt;
            const myPos = this.samplePolylineAtDist(poly, craft.speedNmPerSec * t);
            const myNearFix =
              distNm(myPos.x, myPos.y, fix.pos.x, fix.pos.y) <=
              APPROACH_CONSTANTS.HOLD_STACK_EXEMPT_RADIUS_NM;

            for (const other of this.aircraft) {
              if (other.id === craft.id) continue;
              if (other.state === 'LANDING') continue;
              if (
                other.isDeparture &&
                other.departureRollSec + t < APPROACH_CONSTANTS.DEPARTURE_CA_EXEMPT_SEC
              ) {
                continue;
              }
              const oPos = this.predictCraftPosAt(other, t);
              // Vertically separated peers stacked at the destination fix are exempt within 2.8 NM
              if (
                myNearFix &&
                other.assignedHoldFix === fix.id &&
                other.holdAltitudeSlot !== null &&
                other.holdAltitudeSlot !== slot &&
                distNm(oPos.x, oPos.y, fix.pos.x, fix.pos.y) <=
                  APPROACH_CONSTANTS.HOLD_STACK_EXEMPT_RADIUS_NM
              ) {
                continue;
              }
              const sep = distNm(myPos.x, myPos.y, oPos.x, oPos.y);
              if (sep < minSepNm) minSepNm = sep;
            }

            for (const bogey of this.bogeys) {
              const bu = headingDegToUnitVec(bogey.headingDeg);
              const bx = bogey.x + bu.x * bogey.speedNmPerSec * t;
              const by = bogey.y + bu.y * bogey.speedNmPerSec * t;
              const sep = distNm(myPos.x, myPos.y, bx, by);
              if (sep < minSepNm) minSepNm = sep;
            }
          }

          let score = -pathLen * 1.4 - occCount * 1.2 - (offsetDeg === 0 ? 0 : 1.5);
          if (minSepNm < 1.8) {
            score -= 2200 + (1.8 - minSepNm) * 1600;
          } else if (minSepNm < 3.2) {
            score -= 280 + (3.2 - minSepNm) * 190;
          } else {
            score += Math.min(minSepNm, 5.5) * 6;
          }
          if (hitsStormCore) score -= 95;
          else if (hitsStormOuter) score -= 48;

          if (!best || score > best.score) {
            best = { fix, slot, waypoints: smoothPts, score };
          }
        }
      }
      return best;
    };

    // Prefer strict >= 0.5 NM MOA buffer; fall back to >= 0.0 NM only if craft is already grazing R-118
    const chosen = evaluateCandidates(0.5) ?? evaluateCandidates(0.0);
    if (!chosen) {
      return { ok: false, reason: 'ALL_FULL' };
    }

    const assignedAltFt =
      APPROACH_CONSTANTS.HOLD_STACK_BASE_ALT_FT +
      chosen.slot * APPROACH_CONSTANTS.HOLD_STACK_STEP_ALT_FT;

    craft.lockedTarget = null;
    craft.landingProgress = 0;
    craft.goAroundTimer = 0;
    craft.assignedHoldFix = chosen.fix.id;
    craft.holdAltitudeSlot = chosen.slot;
    craft.holdLegPhase = 'ENTRY';
    craft.holdLegDistNm = 0;
    craft.holdTurnAccumDeg = 0;

    if (distNm(craft.x, craft.y, chosen.fix.pos.x, chosen.fix.pos.y) <= 1.15) {
      craft.state = 'HOLDING';
      craft.holdLegPhase = 'TURN_OUTBOUND';
      craft.waypoints = [];
    } else {
      craft.waypoints = chosen.waypoints.map((p) => ({ x: p.x, y: p.y }));
      craft.state = 'VECTORING';
    }

    this.audioCb.onHoldEntered(chosen.fix.id, craft.callsign);
    this.setTxCaption(`${craft.callsign}: HOLD ${chosen.fix.id} @ ${assignedAltFt}FT`);
    this.pushLog(
      craft.callsign,
      `${craft.callsign}, CLIMB MAINTAIN ${assignedAltFt}, PROCEED DIRECT ${chosen.fix.id} AND HOLD`,
      'cyan'
    );
    this.spawnPopup(
      chosen.fix.pos.x,
      chosen.fix.pos.y + 0.9,
      `HOLD ${chosen.fix.id}`,
      `${assignedAltFt} FT · 0.35× FUEL`,
      '#44ddbb',
      1.65
    );

    return {
      ok: true,
      fixId: chosen.fix.id,
      slot: chosen.slot,
      altitudeFt: assignedAltFt,
    };
  }

  private samplePolylineAtDist(poly: readonly Vec2[], targetDistNm: number): Vec2 {
    if (poly.length === 0) return { x: 0, y: 0 };
    if (poly.length === 1 || targetDistNm <= 0) return poly[0];
    let remaining = targetDistNm;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i];
      const b = poly[i + 1];
      const segLen = distNm(a.x, a.y, b.x, b.y);
      if (segLen <= 1e-6) continue;
      if (remaining <= segLen) {
        const frac = remaining / segLen;
        return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
      }
      remaining -= segLen;
    }
    return poly[poly.length - 1];
  }

  private predictCraftPosAt(other: ApproachAircraft, tSec: number): Vec2 {
    const travel = other.speedNmPerSec * tSec;
    if (other.state === 'HOLDING' && other.assignedHoldFix) {
      const fix = getHoldingFixDef(other.assignedHoldFix);
      // Approximate holding orbit bounded near the fix's racetrack center
      const u = headingDegToUnitVec(other.headingDeg);
      const px = other.x + u.x * Math.min(travel, 1.8);
      const py = other.y + u.y * Math.min(travel, 1.8);
      const dx = px - fix.pos.x;
      const dy = py - fix.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > 2.1) {
        const s = 2.1 / d;
        return { x: fix.pos.x + dx * s, y: fix.pos.y + dy * s };
      }
      return { x: px, y: py };
    }
    if (other.waypoints.length > 0) {
      const poly: Vec2[] = [{ x: other.x, y: other.y }, ...other.waypoints];
      let total = 0;
      for (let i = 0; i < poly.length - 1; i++) {
        total += distNm(poly[i].x, poly[i].y, poly[i + 1].x, poly[i + 1].y);
      }
      if (travel <= total) {
        return this.samplePolylineAtDist(poly, travel);
      }
      const last = poly[poly.length - 1];
      const prev = poly[poly.length - 2];
      const tailLen = distNm(prev.x, prev.y, last.x, last.y);
      const tailHdg =
        tailLen > 1e-4 ? vecToHeadingDeg(last.x - prev.x, last.y - prev.y) : other.headingDeg;
      const u = headingDegToUnitVec(tailHdg);
      const extra = travel - total;
      return { x: last.x + u.x * extra, y: last.y + u.y * extra };
    }
    const u = headingDegToUnitVec(other.headingDeg);
    return { x: other.x + u.x * travel, y: other.y + u.y * travel };
  }

  /**
   * Executes a Missed Approach / Wave-Off, clearing any vector/lock onto a traffic+MOA-aware
   * safe climb-out heading.
   */
  public commandGoAround(craftId: number): boolean {
    const craft = this.getAircraftById(craftId);
    if (!craft || craft.state === 'LANDING' || craft.isDeparture) return false;
    this.executeGoAround(craft, true, 'WAVE-OFF');
    return true;
  }

  private executeGoAround(
    craft: ApproachAircraft,
    manual: boolean,
    reason: string,
    explicitRunway?: ActiveRunwayId
  ): void {
    // Capture runway context BEFORE clearing `lockedTarget` so missed approach diverges forward!
    const lockedRwy = explicitRunway ?? landingZoneToRunway(craft.lockedTarget);

    craft.waypoints = [];
    craft.lockedTarget = null;
    craft.assignedHoldFix = null;
    craft.holdAltitudeSlot = null;
    craft.landingProgress = 0;
    craft.state = 'GO_AROUND';
    craft.goAroundTimer = 3.5;

    let nominalHdg: number;
    if (lockedRwy !== null) {
      nominalHdg = getMissedApproachHeadingDeg(lockedRwy);
    } else if (craft.kind === 'HEAVY') {
      const bestRwy = this.pickClosestActiveRunwayForHeading(craft);
      nominalHdg = getMissedApproachHeadingDeg(bestRwy);
    } else if (Math.abs(craft.y) < 2.2) {
      nominalHdg = getMissedApproachHeadingDeg(this.primaryRunway);
    } else {
      const awayHdg =
        Math.hypot(craft.x, craft.y) > 0.6
          ? vecToHeadingDeg(craft.x, craft.y)
          : normalizeHeadingDeg(craft.headingDeg + 25);
      nominalHdg = normalizeHeadingDeg(awayHdg);
    }

    const climbHdg = this.pickSafeGoAroundHeading(craft, nominalHdg);
    craft.targetHeadingDeg = climbHdg;
    this.goAroundCount++;

    const hdgStr = String(Math.round(climbHdg)).padStart(3, '0');
    this.audioCb.onGoAround(craft.callsign, manual, reason);
    this.setTxCaption(
      manual
        ? `${craft.callsign}: WAVE-OFF HDG ${hdgStr}°`
        : `${craft.callsign}: GOING AROUND!`
    );
    this.pushLog(
      craft.callsign,
      manual
        ? `${craft.callsign}: WAVE-OFF HDG ${hdgStr}°`
        : `${craft.callsign}: GO AROUND (${reason})`,
      'amber'
    );
    this.spawnPopup(
      craft.x,
      craft.y + 0.9,
      'GO AROUND!',
      manual ? `CLIMB HDG ${hdgStr}°` : reason,
      '#ffaa22',
      1.9
    );
  }

  /**
   * 15°-sweep traffic + R-118 MOA + perimeter clearance scanner (10s kinematic lookahead)
   * over `0°, ±15°, ±30°, ..., ±165°, 180°` around `nominalHdg`.
   */
  private pickSafeGoAroundHeading(craft: ApproachAircraft, nominalHdg: number): number {
    const offsets: number[] = [0];
    for (let deg = 15; deg < 180; deg += 15) {
      offsets.push(deg, -deg);
    }
    offsets.push(180);

    const softX = Math.max(6, this.airspaceHalfWidthNm - 1.2);
    const softY = Math.max(6, this.airspaceHalfHeightNm - 1.2);
    const stepDt = 0.5;
    const steps = 20; // 10.0s kinematic lookahead

    let bestHdg = nominalHdg;
    let bestScore = -Infinity;

    for (const offset of offsets) {
      const candHdg = normalizeHeadingDeg(nominalHdg + offset);
      let simX = craft.x;
      let simY = craft.y;
      let simHdg = craft.headingDeg;
      let minMoaDist = distanceToRestrictedZoneNm(simX, simY);
      let enteredMoa = minMoaDist <= 0;
      let clippedMoaBuf = minMoaDist < 0.6;
      let minTrafficSep = 99;
      let maxPerimOver = 0;

      for (let sIdx = 1; sIdx <= steps; sIdx++) {
        const diff = shortestHeadingDiffDeg(simHdg, candHdg);
        const maxTurn = craft.turnRateDegPerSec * stepDt;
        if (Math.abs(diff) <= maxTurn) {
          simHdg = candHdg;
        } else {
          simHdg = normalizeHeadingDeg(simHdg + Math.sign(diff) * maxTurn);
        }
        const u = headingDegToUnitVec(simHdg);
        const prevPos: Vec2 = { x: simX, y: simY };
        simX += u.x * craft.speedNmPerSec * stepDt;
        simY += u.y * craft.speedNmPerSec * stepDt;
        const curPos: Vec2 = { x: simX, y: simY };

        if (segmentIntersectsRestrictedZone(prevPos, curPos)) {
          enteredMoa = true;
          minMoaDist = 0;
        } else {
          const dMoa = distanceToRestrictedZoneNm(simX, simY);
          if (dMoa < minMoaDist) minMoaDist = dMoa;
          if (dMoa < 0.6 || segmentNearRestrictedZone(prevPos, curPos, 0.6)) {
            clippedMoaBuf = true;
          }
        }

        const overX = Math.max(0, Math.abs(simX) - softX);
        const overY = Math.max(0, Math.abs(simY) - softY);
        const over = Math.max(overX, overY);
        if (over > maxPerimOver) maxPerimOver = over;

        const t = sIdx * stepDt;
        for (const other of this.aircraft) {
          if (other.id === craft.id || other.state === 'LANDING') continue;
          if (
            other.isDeparture &&
            other.departureRollSec + t < APPROACH_CONSTANTS.DEPARTURE_CA_EXEMPT_SEC
          ) {
            continue;
          }
          const oPos = this.predictCraftPosAt(other, t);
          const sep = distNm(simX, simY, oPos.x, oPos.y);
          if (sep < minTrafficSep) minTrafficSep = sep;
        }
        for (const bogey of this.bogeys) {
          const bu = headingDegToUnitVec(bogey.headingDeg);
          const bx = bogey.x + bu.x * bogey.speedNmPerSec * t;
          const by = bogey.y + bu.y * bogey.speedNmPerSec * t;
          const sep = distNm(simX, simY, bx, by);
          if (sep < minTrafficSep) minTrafficSep = sep;
        }
      }

      let score = -Math.abs(offset) * 1.2 - maxPerimOver * 220;
      if (enteredMoa) {
        score -= 100000;
      } else if (clippedMoaBuf) {
        score -= 20000 + Math.max(0, 0.6 - minMoaDist) * 10000;
      }

      if (minTrafficSep < 1.2) {
        score -= 8000 + (1.2 - minTrafficSep) * 5000;
      } else if (minTrafficSep < 3.2) {
        score -= 1200 + (3.2 - minTrafficSep) * 500;
      } else {
        score += Math.min(minTrafficSep, 6.0) * 40;
      }

      if (score > bestScore) {
        bestScore = score;
        bestHdg = candHdg;
      }
    }

    return bestHdg;
  }

  private pickClosestActiveRunwayForHeading(craft: ApproachAircraft): ActiveRunwayId {
    const active = this.getActiveRunways();
    let best = active[0];
    let bestScore = Infinity;
    for (const rwy of active) {
      const th = getRunwayThresholdNm(rwy);
      const rwyHdg = getRunwayLandingHeadingDeg(rwy);
      const angDiff = Math.abs(shortestHeadingDiffDeg(craft.headingDeg, rwyHdg));
      const d = distNm(craft.x, craft.y, th.x, th.y);
      const score = angDiff * 0.1 + d;
      if (score < bestScore) {
        bestScore = score;
        best = rwy;
      }
    }
    return best;
  }

  private getCrossTrackToRunwayNm(x: number, y: number, runway: ActiveRunwayId): number {
    const th = getRunwayThresholdNm(runway);
    const out = getRunwayOutwardUnitVec(runway);
    const perpX = -out.y;
    const perpY = out.x;
    return Math.abs((x - th.x) * perpX + (y - th.y) * perpY);
  }

  private evaluateRunwayIlsSnap(
    craft: ApproachAircraft,
    cleaned: Vec2[],
    endPt: Vec2,
    approachDirDeg: number,
    isMayday: boolean
  ): Omit<VectorPreviewResult, 'entersRestrictedZone'> | null {
    const activeRunways = this.getActiveRunways();
    let bestLock: {
      res: Omit<VectorPreviewResult, 'entersRestrictedZone'>;
      interceptDeg: number;
      crossNm: number;
    } | null = null;
    let firstReject: Omit<VectorPreviewResult, 'entersRestrictedZone'> | null = null;

    for (const rwy of activeRunways) {
      const evalRes = this.evaluateSingleRunwayIlsSnap(
        rwy,
        craft,
        cleaned,
        endPt,
        approachDirDeg,
        isMayday
      );
      if (!evalRes) continue;
      if (evalRes.snapKind === 'ILS_LOCK') {
        const crossNm = this.getCrossTrackToRunwayNm(endPt.x, endPt.y, rwy);
        const angle = evalRes.interceptAngleDeg ?? 0;
        if (
          !bestLock ||
          angle < bestLock.interceptDeg - 4 ||
          (Math.abs(angle - bestLock.interceptDeg) <= 4 && crossNm < bestLock.crossNm)
        ) {
          bestLock = { res: evalRes, interceptDeg: angle, crossNm };
        }
      } else if (evalRes.snapKind === 'UNSTABLE_REJECT' && !firstReject) {
        firstReject = evalRes;
      }
    }

    if (bestLock) return bestLock.res;
    if (firstReject) return firstReject;

    // Check if a HEAVY is deliberately aimed straight onto a CLOSED opposite runway threshold
    if (!isMayday) {
      const closedOpposites: ActiveRunwayId[] = [this.primaryRunway === '27' ? '09' : '27'];
      if (this.secondaryRunwayOpen && this.activeSecondaryRunway !== null) {
        closedOpposites.push(this.activeSecondaryRunway === '36' ? '18' : '36');
      }
      for (const closedRwy of closedOpposites) {
        const th = getRunwayThresholdNm(closedRwy);
        const out = getRunwayOutwardUnitVec(closedRwy);
        const perpX = -out.y;
        const perpY = out.x;
        const along = (endPt.x - th.x) * out.x + (endPt.y - th.y) * out.y;
        const cross = Math.abs((endPt.x - th.x) * perpX + (endPt.y - th.y) * perpY);
        const closedHdg = getRunwayLandingHeadingDeg(closedRwy);
        const aimedAtClosed = Math.abs(shortestHeadingDiffDeg(approachDirDeg, closedHdg)) <= 55;
        if (aimedAtClosed && cross <= 0.85 && along >= -0.4 && along <= 3.0) {
          const useRwy =
            closedRwy === '27' || closedRwy === '09'
              ? this.primaryRunway
              : (this.activeSecondaryRunway ?? this.primaryRunway);
          return {
            valid: false,
            blockedByStorm: false,
            snapKind: 'UNSTABLE_REJECT',
            lockedTarget: null,
            holdFix: null,
            waypoints: cleaned,
            snapPoint: { ...endPt },
            interceptAngleDeg: 180,
            rejectReason: `WRONG RWY — USE ${useRwy}`,
          };
        }
      }
    }

    return null;
  }

  private evaluateSingleRunwayIlsSnap(
    rwy: ActiveRunwayId,
    craft: ApproachAircraft,
    cleaned: Vec2[],
    endPt: Vec2,
    approachDirDeg: number,
    isMayday: boolean
  ): Omit<VectorPreviewResult, 'entersRestrictedZone'> | null {
    const th = getRunwayThresholdNm(rwy);
    const out = getRunwayOutwardUnitVec(rwy);
    const perpX = -out.y;
    const perpY = out.x;
    const rwyHdg = getRunwayLandingHeadingDeg(rwy);
    const ilsLen = getRunwayIlsLengthNm(rwy);
    const fafDist = APPROACH_CONSTANTS.ILS_FAF_DIST_NM;
    const fafPt = getRunwayFafNm(rwy);
    const targetZone = runwayToLandingZone(rwy);

    // Measure end point relative to runway extended centerline
    const alongNm = (endPt.x - th.x) * out.x + (endPt.y - th.y) * out.y;
    const crossTrackNm = Math.abs((endPt.x - th.x) * perpX + (endPt.y - th.y) * perpY);

    const inActiveCorridor =
      crossTrackNm <= APPROACH_CONSTANTS.ILS_SNAP_TOLERANCE_NM &&
      alongNm >= -2.2 &&
      alongNm <= ilsLen + 2.2;

    if (!inActiveCorridor) {
      return null;
    }

    const interceptDeg = Math.abs(shortestHeadingDiffDeg(approachDirDeg, rwyHdg));

    if (isMayday) {
      // Emergency priority clearance: MAYDAY can lock any active RWY from any angle/distance
      const clampedAlong = clamp(alongNm, 0.2, ilsLen);
      const snapPt: Vec2 = { x: th.x + out.x * clampedAlong, y: th.y + out.y * clampedAlong };
      const tail: Vec2[] = [snapPt];
      if (clampedAlong > fafDist + 0.5) {
        tail.push({ ...fafPt });
      }
      tail.push({ ...th });
      return {
        valid: true,
        blockedByStorm: false,
        snapKind: 'ILS_LOCK',
        lockedTarget: targetZone,
        holdFix: null,
        waypoints: [...cleaned.slice(0, -1), ...tail],
        snapPoint: snapPt,
        interceptAngleDeg: interceptDeg,
      };
    }

    // P0 Downwind/Base Safety Gate:
    // NEVER reject normal downwind or outbound vectors as UNSTABLE_REJECT!
    // Only evaluate ILS lock/rejection when vector is aimed inbound (<= 95° of runway heading)
    // OR ends directly inside the tight threshold box (crossTrack <= 0.75 NM, along ∈ [-0.5, 3.0]).
    const inTightThresholdBox = crossTrackNm <= 0.75 && alongNm >= -0.5 && alongNm <= 3.0;
    const aimedInbound = interceptDeg <= 95;
    if (!aimedInbound && !inTightThresholdBox) {
      return null;
    }

    // HEAVY Ore Hauler strict <=45° ILS intercept discipline OUTSIDE 5 NM FAF.
    // Also accepts smooth full-length drags inside the visual 1.45 NM outer green gate down to threshold!
    const outsideFaf = alongNm >= fafDist - 0.15;
    if (!outsideFaf) {
      const fullPts: Vec2[] = [{ x: craft.x, y: craft.y }, ...cleaned];
      const beamHalfNm = APPROACH_CONSTANTS.ILS_CORRIDOR_HALF_WIDTH_NM; // 1.45 NM!
      let entryIdx = fullPts.length - 1;
      const endCross = Math.abs(
        (fullPts[entryIdx].x - th.x) * perpX + (fullPts[entryIdx].y - th.y) * perpY
      );
      if (endCross <= beamHalfNm) {
        let prevAlong = (fullPts[entryIdx].x - th.x) * out.x + (fullPts[entryIdx].y - th.y) * out.y;
        for (let k = entryIdx - 1; k >= 0; k--) {
          const p = fullPts[k];
          const pCross = Math.abs((p.x - th.x) * perpX + (p.y - th.y) * perpY);
          const pAlong = (p.x - th.x) * out.x + (p.y - th.y) * out.y;
          if (pCross <= beamHalfNm && pAlong >= prevAlong - 0.35 && pAlong <= ilsLen + 2.2) {
            entryIdx = k;
            prevAlong = pAlong;
          } else {
            break;
          }
        }
      }

      const entryPt = fullPts[entryIdx];
      const entryAlong = (entryPt.x - th.x) * out.x + (entryPt.y - th.y) * out.y;
      if (entryAlong >= fafDist - 0.15) {
        let entryHeadingDeg: number;
        if (entryIdx === 0) {
          // Craft is already inside the 1.45 NM outer gate: measure drawn heading forward from craft
          let aheadPt = fullPts[fullPts.length - 1];
          for (let k = 1; k < fullPts.length; k++) {
            if (distNm(fullPts[0].x, fullPts[0].y, fullPts[k].x, fullPts[k].y) >= 1.15) {
              aheadPt = fullPts[k];
              break;
            }
          }
          const adx = aheadPt.x - fullPts[0].x;
          const ady = aheadPt.y - fullPts[0].y;
          entryHeadingDeg =
            Math.hypot(adx, ady) >= 0.2 ? vecToHeadingDeg(adx, ady) : craft.headingDeg;
        } else {
          let refPt = fullPts[0];
          for (let k = entryIdx - 1; k >= 0; k--) {
            const d = distNm(fullPts[k].x, fullPts[k].y, entryPt.x, entryPt.y);
            if (d >= 1.15) {
              refPt = fullPts[k];
              break;
            }
            if (k === 0 && d >= 0.2) {
              refPt = fullPts[0];
            }
          }
          const edx = entryPt.x - refPt.x;
          const edy = entryPt.y - refPt.y;
          entryHeadingDeg =
            Math.hypot(edx, edy) >= 0.05 ? vecToHeadingDeg(edx, edy) : craft.headingDeg;
        }

        const entryInterceptDeg = Math.abs(shortestHeadingDiffDeg(entryHeadingDeg, rwyHdg));
        if (entryInterceptDeg > APPROACH_CONSTANTS.ILS_MAX_INTERCEPT_DEG) {
          return {
            valid: false,
            blockedByStorm: false,
            snapKind: 'UNSTABLE_REJECT',
            lockedTarget: null,
            holdFix: null,
            waypoints: cleaned,
            snapPoint: { ...entryPt },
            interceptAngleDeg: entryInterceptDeg,
            rejectReason: `INTERCEPT ${Math.round(entryInterceptDeg)}° > 45°`,
          };
        }

        const clampedEntryAlong = clamp(entryAlong, fafDist, ilsLen + 1.2);
        const snapPt: Vec2 = {
          x: th.x + out.x * clampedEntryAlong,
          y: th.y + out.y * clampedEntryAlong,
        };
        const prefixWaypoints = entryIdx > 1 ? cleaned.slice(0, entryIdx - 1) : [];
        const snappedWaypoints: Vec2[] = [...prefixWaypoints, snapPt];
        if (clampedEntryAlong > fafDist + 0.45) {
          snappedWaypoints.push({ ...fafPt });
        }
        snappedWaypoints.push({ ...th });

        return {
          valid: true,
          blockedByStorm: false,
          snapKind: 'ILS_LOCK',
          lockedTarget: targetZone,
          holdFix: null,
          waypoints: snappedWaypoints,
          snapPoint: snapPt,
          interceptAngleDeg: entryInterceptDeg,
        };
      }

      return {
        valid: false,
        blockedByStorm: false,
        snapKind: 'UNSTABLE_REJECT',
        lockedTarget: null,
        holdFix: null,
        waypoints: cleaned,
        snapPoint: { ...endPt },
        interceptAngleDeg: interceptDeg,
        rejectReason: 'INSIDE 5NM FAF',
      };
    }

    if (interceptDeg > APPROACH_CONSTANTS.ILS_MAX_INTERCEPT_DEG) {
      return {
        valid: false,
        blockedByStorm: false,
        snapKind: 'UNSTABLE_REJECT',
        lockedTarget: null,
        holdFix: null,
        waypoints: cleaned,
        snapPoint: { ...endPt },
        interceptAngleDeg: interceptDeg,
        rejectReason: `INTERCEPT ${Math.round(interceptDeg)}° > 45°`,
      };
    }

    // Clean, authentic ILS Localizer capture outside the 5 NM FAF!
    const clampedAlong = clamp(alongNm, fafDist, ilsLen + 1.2);
    const snapPt: Vec2 = { x: th.x + out.x * clampedAlong, y: th.y + out.y * clampedAlong };
    const snappedWaypoints: Vec2[] = [...cleaned.slice(0, -1), snapPt];
    if (clampedAlong > fafDist + 0.45) {
      snappedWaypoints.push({ ...fafPt });
    }
    snappedWaypoints.push({ ...th });

    return {
      valid: true,
      blockedByStorm: false,
      snapKind: 'ILS_LOCK',
      lockedTarget: targetZone,
      holdFix: null,
      waypoints: snappedWaypoints,
      snapPoint: snapPt,
      interceptAngleDeg: interceptDeg,
    };
  }

  private evaluateCradleSnap(
    cleaned: Vec2[],
    endPt: Vec2,
    approachDirDeg: number,
    isMayday: boolean
  ): Omit<VectorPreviewResult, 'entersRestrictedZone'> | null {
    const cradle = AIRFIELD_GEOMETRY.salvageCradle;
    const uOut = headingDegToUnitVec(cradle.corridorOutHeadingDeg); // ENE 060°
    const dx = endPt.x - cradle.pos.x;
    const dy = endPt.y - cradle.pos.y;
    const distToCradle = Math.hypot(dx, dy);

    const along = dx * uOut.x + dy * uOut.y;
    const perp = Math.abs(dx * -uOut.y + dy * uOut.x);
    const angleDiff = Math.abs(shortestHeadingDiffDeg(approachDirDeg, cradle.approachHeadingDeg));

    const hitCradleRing = distToCradle <= cradle.captureRadiusNm;
    const hitCorridor =
      !isMayday &&
      along >= 0.4 &&
      along <= cradle.corridorLengthNm + 0.8 &&
      perp <= APPROACH_CONSTANTS.CRADLE_CORRIDOR_HALF_WIDTH_NM &&
      angleDiff <= APPROACH_CONSTANTS.CRADLE_MAX_INTERCEPT_DEG + 18;

    if (!hitCradleRing && !hitCorridor) {
      return null;
    }

    const snapAlong = hitCorridor ? clamp(along, 0.8, cradle.corridorLengthNm) : 0;
    const snapPt: Vec2 =
      snapAlong > 0.5
        ? { x: cradle.pos.x + uOut.x * snapAlong, y: cradle.pos.y + uOut.y * snapAlong }
        : { ...cradle.pos };

    const snappedWaypoints: Vec2[] = [...cleaned.slice(0, -1), snapPt];
    if (snapAlong > 0.5) {
      snappedWaypoints.push({ ...cradle.pos });
    }

    return {
      valid: true,
      blockedByStorm: false,
      snapKind: 'CRADLE_LOCK',
      lockedTarget: 'SALVAGE_CRADLE',
      holdFix: null,
      waypoints: snappedWaypoints,
      snapPoint: snapPt,
      interceptAngleDeg: angleDiff,
    };
  }

  /**
   * Sanitizes raw dragged waypoints:
   * 1. Clamps to the expanded rectangular radar airspace.
   * 2. Prunes stale leading waypoints that fast ships (220–260+ KT) moved past during the drag
   *    so Dropships & MAYDAYs NEVER hook backward on release!
   * 3. Smoothly resamples remaining points while always preserving the exact drag endpoint.
   */
  private sanitizeWaypoints(craft: ApproachAircraft, raw: readonly Vec2[]): Vec2[] {
    if (!raw || raw.length === 0) return [];

    const maxX = Math.max(4, this.airspaceHalfWidthNm - 0.35);
    const maxY = Math.max(4, this.airspaceHalfHeightNm - 0.35);

    const clamped: Vec2[] = [];
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i];
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const cx = clamp(p.x, -maxX, maxX);
      const cy = clamp(p.y, -maxY, maxY);
      const prev = clamped[clamped.length - 1];
      if (!prev || distNm(prev.x, prev.y, cx, cy) >= 0.05 || i === raw.length - 1) {
        clamped.push({ x: cx, y: cy });
      }
    }
    if (clamped.length === 0) return [];
    if (clamped.length === 1) return clamped;

    // P0 Stale Drag Start Pruning:
    // (a) Advance past initial polyline segments the craft has already progressed along during the drag.
    let startIdx = 0;
    let prefixArc = 0;
    for (let i = 0; i < clamped.length - 1; i++) {
      const a = clamped[i];
      const b = clamped[i + 1];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const abLenSq = abx * abx + aby * aby;
      const abLen = Math.sqrt(abLenSq);
      if (abLen < 1e-4) {
        startIdx = Math.max(startIdx, i + 1);
        continue;
      }
      if (prefixArc > 3.2) break;
      prefixArc += abLen;

      if (distNm(craft.x, craft.y, a.x, a.y) <= 2.4) {
        const acx = craft.x - a.x;
        const acy = craft.y - a.y;
        const t = (acx * abx + acy * aby) / abLenSq;
        const tClamped = clamp(t, 0, 1);
        const projX = a.x + abx * tClamped;
        const projY = a.y + aby * tClamped;
        const perpDist = distNm(craft.x, craft.y, projX, projY);
        if (t > 0.15 && perpDist <= 1.25) {
          startIdx = Math.max(startIdx, i + 1);
        }
      }
    }

    // (b) Drop any remaining leading point that sits on top of craft, opposes the next segment,
    //     or lies within 0.85 NM behind the craft's nose (never dropping the final drag endpoint).
    const nose = headingDegToUnitVec(craft.headingDeg);
    while (startIdx < clamped.length - 1) {
      const p = clamped[startIdx];
      const next = clamped[startIdx + 1];
      const vcx = p.x - craft.x;
      const vcy = p.y - craft.y;
      const d = Math.hypot(vcx, vcy);
      const segX = next.x - p.x;
      const segY = next.y - p.y;
      const opposesPath = vcx * segX + vcy * segY < 0;
      const behindNose = vcx * nose.x + vcy * nose.y < 0;

      if (d < 0.42 || (d <= 1.35 && opposesPath) || (d <= 0.85 && behindNose)) {
        startIdx++;
        continue;
      }
      break;
    }

    const out: Vec2[] = [];
    let lastX = craft.x;
    let lastY = craft.y;
    for (let i = startIdx; i < clamped.length; i++) {
      const p = clamped[i];
      const isLast = i === clamped.length - 1;
      if (isLast || distNm(lastX, lastY, p.x, p.y) >= 0.32) {
        out.push({ x: p.x, y: p.y });
        lastX = p.x;
        lastY = p.y;
      }
    }
    return out;
  }

  /**
   * Dynamically redraws a sanitized/snapped polyline into a flyable kinematic curve
   * that respects the aircraft's actual physical minimum turn radius `R_min` (with 1.08x margin)
   * so sharp turns/hairpins never cause unreachable waypoints or endless orbiting loops.
   */
  public smoothPathForTurnRadius(craft: ApproachAircraft, pts: readonly Vec2[]): Vec2[] {
    if (!pts || pts.length === 0) return [];

    const endPt = pts[pts.length - 1];
    const endX = endPt.x;
    const endY = endPt.y;
    const d0x = endX - craft.x;
    const d0y = endY - craft.y;
    if (
      pts.length === 1 &&
      d0x * d0x + d0y * d0y <=
        APPROACH_CONSTANTS.WAYPOINT_ARRIVAL_NM * APPROACH_CONSTANTS.WAYPOINT_ARRIVAL_NM
    ) {
      return [{ x: endX, y: endY }];
    }

    const minTurnR = getCraftMinTurnRadiusNm(craft.speedNmPerSec, craft.turnRateDegPerSec);
    if (!Number.isFinite(minTurnR) || minTurnR <= 0.05) {
      return pts.map((p) => ({ x: p.x, y: p.y }));
    }

    const maxX = Math.max(4, this.airspaceHalfWidthNm - 0.35);
    const maxY = Math.max(4, this.airspaceHalfHeightNm - 0.35);

    const guideX: number[] = [craft.x];
    const guideY: number[] = [craft.y];
    const cumLen: number[] = [0];
    let totalLen = 0;
    let lastGx = craft.x;
    let lastGy = craft.y;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const dx = p.x - lastGx;
      const dy = p.y - lastGy;
      const segSq = dx * dx + dy * dy;
      if (segSq >= 0.0016 || i === pts.length - 1) {
        const segLen = Math.sqrt(segSq);
        guideX.push(p.x);
        guideY.push(p.y);
        totalLen += segLen;
        cumLen.push(totalLen);
        lastGx = p.x;
        lastGy = p.y;
      }
    }
    const guideCount = guideX.length;
    if (guideCount < 2 || totalLen <= 0.05) {
      return [{ x: endX, y: endY }];
    }

    const effTurnR = Math.max(0.25, minTurnR * 1.08);
    const ds = 0.25;
    const DEG_TO_RAD = Math.PI / 180;
    const RAD_TO_DEG = 180 / Math.PI;
    const dThetaMaxDeg = (ds / effTurnR) * RAD_TO_DEG;
    const lookaheadL = Math.max(1.25 * minTurnR, 0.95);
    const lookaheadSq = lookaheadL * lookaheadL;
    const cursorCircleSq = (effTurnR * 1.02) * (effTurnR * 1.02);
    const endEnterSq = (effTurnR * 0.99) * (effTurnR * 0.99);
    const endExitSq = (effTurnR * 1.08) * (effTurnR * 1.08);
    const arrivePreSq = Math.max(0.35, ds * 1.45) * Math.max(0.35, ds * 1.45);
    const arrivePostSq = Math.max(0.32, ds * 1.3) * Math.max(0.32, ds * 1.3);
    const maxSteps = 160;
    const maxWaypoints = 48;

    let simX = craft.x;
    let simY = craft.y;
    let simHdg = normalizeHeadingDeg(craft.headingDeg);
    let cursorS = 0;
    let segHint = 0;
    let targetX = guideX[0];
    let targetY = guideY[0];
    let wideningToEnd = false;

    const sampleGuideIntoTarget = (s: number): void => {
      if (s <= 0) {
        targetX = guideX[0];
        targetY = guideY[0];
        return;
      }
      if (s >= totalLen) {
        targetX = endX;
        targetY = endY;
        return;
      }
      while (segHint < guideCount - 2 && cumLen[segHint + 1] < s) {
        segHint++;
      }
      const segStart = cumLen[segHint];
      const segSpan = cumLen[segHint + 1] - segStart;
      const t = segSpan > 1e-6 ? (s - segStart) / segSpan : 0;
      const ax = guideX[segHint];
      const ay = guideY[segHint];
      targetX = ax + (guideX[segHint + 1] - ax) * t;
      targetY = ay + (guideY[segHint + 1] - ay) * t;
    };

    const emitted: Vec2[] = [];
    let distSinceEmit = 0;
    let turnSinceEmitDeg = 0;
    let reachedEnd = false;

    for (let step = 0; step < maxSteps; step++) {
      // Precompute left & right turning-circle centers once per outer step (zero allocations)
      const hdgRad = simHdg * DEG_TO_RAD;
      const ux = Math.sin(hdgRad);
      const uy = Math.cos(hdgRad);
      const cRx = simX + uy * effTurnR;
      const cRy = simY - ux * effTurnR;
      const cLx = simX - uy * effTurnR;
      const cLy = simY + ux * effTurnR;

      // Advance monotonic lookahead cursor along guide polyline
      sampleGuideIntoTarget(cursorS);
      while (cursorS < totalLen) {
        const tdx = targetX - simX;
        const tdy = targetY - simY;
        if (tdx * tdx + tdy * tdy < lookaheadSq) {
          cursorS = cursorS + 0.18 < totalLen ? cursorS + 0.18 : totalLen;
          sampleGuideIntoTarget(cursorS);
          continue;
        }
        const rdx = targetX - cRx;
        const rdy = targetY - cRy;
        const ldx = targetX - cLx;
        const ldy = targetY - cLy;
        if (rdx * rdx + rdy * rdy < cursorCircleSq || ldx * ldx + ldy * ldy < cursorCircleSq) {
          cursorS = cursorS + 0.18 < totalLen ? cursorS + 0.18 : totalLen;
          sampleGuideIntoTarget(cursorS);
          continue;
        }
        break;
      }

      const atFinalTarget = cursorS >= totalLen - 1e-4;
      const edx = endX - simX;
      const edy = endY - simY;
      const dToEndSq = edx * edx + edy * edy;

      if (atFinalTarget && step > 0 && dToEndSq <= arrivePreSq) {
        reachedEnd = true;
        break;
      }

      let dTurn = 0;
      if (atFinalTarget) {
        const erdx = endX - cRx;
        const erdy = endY - cRy;
        const eldx = endX - cLx;
        const eldy = endY - cLy;
        const dRSq = erdx * erdx + erdy * erdy;
        const dLSq = eldx * eldx + eldy * eldy;
        if (!wideningToEnd && (dRSq < endEnterSq || dLSq < endEnterSq)) {
          wideningToEnd = true;
        } else if (wideningToEnd && dRSq >= endExitSq && dLSq >= endExitSq) {
          wideningToEnd = false;
        }

        if (wideningToEnd) {
          dTurn = (dRSq <= dLSq ? -1 : 1) * dThetaMaxDeg * 0.2;
        } else {
          let desiredHdg = Math.atan2(edx, edy) * RAD_TO_DEG;
          if (desiredHdg < 0) desiredHdg += 360;
          let diff = desiredHdg - simHdg;
          if (diff > 180) diff -= 360;
          else if (diff <= -180) diff += 360;
          dTurn = diff > dThetaMaxDeg ? dThetaMaxDeg : diff < -dThetaMaxDeg ? -dThetaMaxDeg : diff;
        }
      } else {
        let desiredHdg = Math.atan2(targetX - simX, targetY - simY) * RAD_TO_DEG;
        if (desiredHdg < 0) desiredHdg += 360;
        let diff = desiredHdg - simHdg;
        if (diff > 180) diff -= 360;
        else if (diff <= -180) diff += 360;
        dTurn = diff > dThetaMaxDeg ? dThetaMaxDeg : diff < -dThetaMaxDeg ? -dThetaMaxDeg : diff;
      }

      const midRad = (simHdg + dTurn * 0.5) * DEG_TO_RAD;
      const stepLen =
        atFinalTarget && !wideningToEnd && dToEndSq < ds * ds ? Math.sqrt(dToEndSq) : ds;
      const prevX = simX;
      const prevY = simY;
      simX = clamp(simX + Math.sin(midRad) * stepLen, -maxX, maxX);
      simY = clamp(simY + Math.cos(midRad) * stepLen, -maxY, maxY);
      simHdg += dTurn;
      if (simHdg >= 360) simHdg -= 360;
      else if (simHdg < 0) simHdg += 360;

      const mvx = simX - prevX;
      const mvy = simY - prevY;
      distSinceEmit += Math.sqrt(mvx * mvx + mvy * mvy);
      turnSinceEmitDeg += dTurn < 0 ? -dTurn : dTurn;

      if (atFinalTarget) {
        const ndx = endX - simX;
        const ndy = endY - simY;
        if (ndx * ndx + ndy * ndy <= arrivePostSq) {
          reachedEnd = true;
          break;
        }
      }

      const spacingThreshold = turnSinceEmitDeg >= 8 ? 0.55 : 0.72;
      if (distSinceEmit >= spacingThreshold) {
        emitted.push({ x: simX, y: simY });
        distSinceEmit = 0;
        turnSinceEmitDeg = 0;
      }
    }

    if (!reachedEnd) {
      for (let i = 1; i < guideCount - 1; i++) {
        if (cumLen[i] > cursorS) {
          const px = guideX[i];
          const py = guideY[i];
          const last = emitted[emitted.length - 1];
          if (!last || (px - last.x) * (px - last.x) + (py - last.y) * (py - last.y) >= 0.2025) {
            emitted.push({ x: px, y: py });
          }
        }
      }
    }

    const last = emitted[emitted.length - 1];
    if (!last) {
      emitted.push({ x: endX, y: endY });
    } else if ((endX - last.x) * (endX - last.x) + (endY - last.y) * (endY - last.y) < 0.1225) {
      emitted[emitted.length - 1] = { x: endX, y: endY };
    } else {
      emitted.push({ x: endX, y: endY });
    }

    if (emitted.length <= maxWaypoints) {
      return emitted;
    }

    const capped: Vec2[] = [];
    const lastIdx = emitted.length - 1;
    for (let k = 0; k < maxWaypoints; k++) {
      const idx = k === maxWaypoints - 1 ? lastIdx : Math.round((k * lastIdx) / (maxWaypoints - 1));
      capped.push(emitted[idx]);
    }
    return capped;
  }

  /** Computes the approach heading of the final ~1.8 NM segment leading into the end waypoint. */
  private computeEndingHeadingDeg(craft: ApproachAircraft, pts: readonly Vec2[]): number {
    const end = pts[pts.length - 1];
    let refX = craft.x;
    let refY = craft.y;
    for (let i = pts.length - 2; i >= 0; i--) {
      const d = distNm(pts[i].x, pts[i].y, end.x, end.y);
      if (d >= 1.15) {
        refX = pts[i].x;
        refY = pts[i].y;
        break;
      }
      if (i === 0 && d >= 0.25) {
        refX = pts[0].x;
        refY = pts[0].y;
      }
    }
    const dx = end.x - refX;
    const dy = end.y - refY;
    if (Math.hypot(dx, dy) < 0.05) {
      return craft.headingDeg;
    }
    return vecToHeadingDeg(dx, dy);
  }

  /** Main fixed/variable timestep update. */
  public update(rawDt: number): void {
    const baseDt = clamp(Number.isFinite(rawDt) ? rawDt : 0, 0, 0.1);
    if (baseDt <= 0) return;

    // Fade visual flashes & popups smoothly in real time
    this.screenShake = Math.max(0, this.screenShake - baseDt * 2.8);
    this.sealBreachFlashTimer = Math.max(0, this.sealBreachFlashTimer - baseDt);
    this.runwayFlipFlashTimer = Math.max(0, this.runwayFlipFlashTimer - baseDt);
    this.lastTxTimer = Math.max(0, this.lastTxTimer - baseDt);
    this.updatePopupsAndShockwaves(baseDt);

    if (this.paused) return;

    const scale = clamp(Number.isFinite(this.timeScale) ? this.timeScale : 1.0, 0, 4.0);
    const dt = baseDt * scale;
    if (dt <= 0) return;

    // Advance radar sweep arm (15 RPM = 90°/sec clockwise)
    const prevSweep = this.radarSweepDeg;
    this.radarSweepDeg =
      (this.radarSweepDeg + (APPROACH_CONSTANTS.RADAR_SWEEP_RPM * 360 * dt) / 60) % 360;
    this.applySweepHighlights(prevSweep, this.radarSweepDeg, dt);
    if (this.phase === 'ACTIVE_SHIFT' && this.radarSweepDeg < prevSweep) {
      this.audioCb.onRadarSweepTick();
    }

    if (this.phase === 'GAME_OVER') {
      this.gameOverLockoutTimer = Math.max(0, this.gameOverLockoutTimer - baseDt);
      return;
    }

    if (this.phase === 'TITLE') {
      this.updateTitleDemo(dt);
      return;
    }

    // ACTIVE_SHIFT: check 1.2s slow-mo incident freeze
    let simDt = dt;
    if (this.incidentFreezeTimer > 0) {
      this.incidentFreezeTimer = Math.max(0, this.incidentFreezeTimer - baseDt);
      simDt = dt * 0.18;
      if (this.incidentFreezeTimer <= 0) {
        this.incidentPos = null;
        this.incidentReason = null;
        this.incidentCallout = '';
        if (this.safetySeals <= 0 && !this.trainingMode) {
          this.phase = 'GAME_OVER';
          this.gameOverLockoutTimer = APPROACH_CONSTANTS.GAME_OVER_LOCKOUT_SEC;
          this.gameOverReason = 'SHIFT TERMINATED // ICC MISHAP BOARD';
          this.pushLog('ICC-BOARD', 'SHIFT OVER — 0 SEALS LEFT', 'red');
          return;
        }
      }
    }

    this.shiftElapsedSec += simDt;
    this.antiDoubleStrikeTimer = Math.max(0, this.antiDoubleStrikeTimer - simDt);
    this.caAudioCooldownSec = Math.max(0, this.caAudioCooldownSec - simDt);
    this.caMultiplierPenaltyCooldownSec = Math.max(0, this.caMultiplierPenaltyCooldownSec - simDt);
    this.restrictedPenaltyCooldownSec = Math.max(0, this.restrictedPenaltyCooldownSec - simDt);

    // Subtle realistic live wind gust oscillation on dial
    this.windDisplayHeadingDeg = normalizeHeadingDeg(
      this.windHeadingDeg + Math.sin(this.shiftElapsedSec * 0.7) * 4.5
    );

    // 1. Update Runway Reversal advisory countdown
    this.updateRunwayReversal(simDt);

    // 2. Update weather storms, primary bogeys & outbound departure queue timers
    this.updateStorms(simDt);
    this.updateBogeys(simDt);
    if (this.incidentFreezeTimer <= 0) {
      this.updateDepartureQueue(simDt);
    }

    // 3. Run traffic / weather / emergency schedulers (paused during incident freeze or training mode)
    if (this.incidentFreezeTimer <= 0 && !this.trainingMode) {
      this.updateSchedulers(simDt);
    }

    // 4. Update all aircraft physics, fuel, R-118 exposure, holding patterns, departures, ILS & touchdowns
    this.trailSampleAccum += simDt;
    const shouldSampleTrail = this.trailSampleAccum >= 0.35;
    if (shouldSampleTrail) this.trailSampleAccum = 0;

    this.updateAircraft(simDt, shouldSampleTrail);

    // 5. Evaluate 3 NM lateral separation, Conflict Alerts, CA clear callback & 0.85 NM collisions
    this.evaluateSeparationAndCollisions();
  }

  private applySweepHighlights(prevDeg: number, currDeg: number, dt: number): void {
    const wrapped = currDeg < prevDeg;
    const isSwept = (x: number, y: number): boolean => {
      const az = vecToHeadingDeg(x, y);
      return wrapped ? az >= prevDeg || az <= currDeg : az >= prevDeg && az <= currDeg;
    };

    for (const c of this.aircraft) {
      c.sweptHighlight = Math.max(0, c.sweptHighlight - dt * 0.55);
      if (isSwept(c.x, c.y)) c.sweptHighlight = 1;
    }
    for (const b of this.bogeys) {
      b.sweptHighlight = Math.max(0, b.sweptHighlight - dt * 0.55);
      if (isSwept(b.x, b.y)) b.sweptHighlight = 1;
    }
  }

  private updateTitleDemo(dt: number): void {
    this.shiftElapsedSec += dt;
    this.windDisplayHeadingDeg = normalizeHeadingDeg(270 + Math.sin(this.shiftElapsedSec * 0.5) * 4);
    this.trailSampleAccum += dt;
    const sample = this.trailSampleAccum >= 0.4;
    if (sample) this.trailSampleAccum = 0;

    for (const craft of this.aircraft) {
      craft.ageSec += dt;
      if (craft.state === 'HOLDING' && craft.assignedHoldFix) {
        this.stepHoldingPattern(craft, dt);
      } else {
        this.stepWaypointOrHeading(craft, dt);
        if (craft.waypoints.length === 0) {
          craft.x = 12.2;
          craft.y = 0;
          craft.headingDeg = 270;
          craft.targetHeadingDeg = 270;
          craft.trail = [];
          craft.waypoints = [getRunwayFafNm('27'), getRunwayThresholdNm('27')];
        }
      }
      if (sample) this.pushTrailPoint(craft.trail, craft.x, craft.y, 14);
    }
  }

  private updateRunwayReversal(dt: number): void {
    if (this.pendingPrimaryRunway === null && this.pendingSecondaryRunway === null) return;
    this.runwayFlipCountdownSec -= dt;
    if (this.runwayFlipCountdownSec > 0) return;

    // P0 Integrity: Capture PREVIOUS runway(s) BEFORE flipping!
    const prevPrimary = this.primaryRunway;
    const prevSecondary = this.activeSecondaryRunway;
    const nextPrimary = this.pendingPrimaryRunway ?? prevPrimary;
    const nextSecondary = this.secondaryRunwayOpen
      ? (this.pendingSecondaryRunway ?? prevSecondary)
      : null;

    const closedRunways: Array<{ rwy: ActiveRunwayId; zone: LandingZoneId; replacement: ActiveRunwayId }> = [];
    if (nextPrimary !== prevPrimary) {
      closedRunways.push({
        rwy: prevPrimary,
        zone: runwayToLandingZone(prevPrimary),
        replacement: nextPrimary,
      });
    }
    if (prevSecondary !== null && nextSecondary !== null && nextSecondary !== prevSecondary) {
      closedRunways.push({
        rwy: prevSecondary,
        zone: runwayToLandingZone(prevSecondary),
        replacement: nextSecondary,
      });
    }

    // Commit runway flip & aligned wind
    this.primaryRunway = nextPrimary;
    this.activeRunway = nextPrimary;
    if (this.secondaryRunwayOpen && nextSecondary !== null) {
      this.activeSecondaryRunway = nextSecondary;
    }
    this.pendingRunway = null;
    this.pendingPrimaryRunway = null;
    this.pendingSecondaryRunway = null;
    this.runwayFlipCountdownSec = 0;

    this.windHeadingDeg = getAlignedWindHeadingDeg(this.primaryRunway, this.activeSecondaryRunway);
    this.windSpeedKt = 22;
    this.windGustKt = 28;
    this.atisLetter = nextAtisChar(this.atisLetter);
    this.runwayFlipFlashTimer = 3.0;

    const activeStr =
      this.secondaryRunwayOpen && this.activeSecondaryRunway
        ? `RWY ${this.primaryRunway}+${this.activeSecondaryRunway}`
        : `RWY ${this.primaryRunway}`;
    const windStr = String(this.windHeadingDeg).padStart(3, '0');

    this.audioCb.onAtisFlip(
      this.primaryRunway,
      this.atisLetter,
      this.secondaryRunwayOpen ? this.activeSecondaryRunway : null
    );
    this.setTxCaption(`ATIS ${this.atisLetter}: ${activeStr} ACTIVE`);
    this.pushLog('ATIS', `INFO ${this.atisLetter}: ${activeStr} · W${windStr}/22`, 'amber');
    this.spawnShockwave(0, 0, 12, 'amber', 1.1);

    // Reassign any hold-short departures waiting on a now-closed runway
    for (const dep of this.departureQueue) {
      const closed = closedRunways.find((c) => c.rwy === dep.runway);
      if (closed) {
        dep.runway = closed.replacement;
        dep.holdShortPos = { ...getRunwayHoldShortNm(closed.replacement) };
        dep.departureHeadingDeg = getDepartureHeadingDeg(closed.replacement);
      }
    }

    // Wave off Heavies locked onto a now-closed runway UNLESS already established inside 2.5 NM DH!
    for (const craft of this.aircraft) {
      if (craft.kind !== 'HEAVY' || craft.state === 'LANDING' || craft.isDeparture) continue;
      const closed = closedRunways.find((c) => c.zone === craft.lockedTarget);
      if (!closed) continue;

      const prevTh = getRunwayThresholdNm(closed.rwy);
      const distToTh = distNm(craft.x, craft.y, prevTh.x, prevTh.y);
      if (
        craft.state === 'ESTABLISHED' &&
        distToTh <= APPROACH_CONSTANTS.RWY_DECISION_HEIGHT_NM
      ) {
        // Past Decision Height (<= 2.5 NM) — let this Heavy complete landing cleanly!
        continue;
      }

      // Climb out forward-divergent on the PREVIOUS runway's missed-approach heading!
      this.executeGoAround(craft, false, `RWY SHIFT TO ${closed.replacement}`, closed.rwy);
    }
  }

  private updateStorms(dt: number): void {
    const limX = this.airspaceHalfWidthNm + 5.5;
    const limY = this.airspaceHalfHeightNm + 5.5;
    for (let i = this.storms.length - 1; i >= 0; i--) {
      const s = this.storms[i];
      s.ageSec += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      const fadeIn = clamp(s.ageSec / 3.0, 0, 1);
      const fadeOut = clamp((s.maxLifeSec - s.ageSec) / 4.0, 0, 1);
      s.intensity = Math.min(fadeIn, fadeOut);

      if (s.ageSec >= s.maxLifeSec || Math.abs(s.x) > limX || Math.abs(s.y) > limY) {
        this.storms.splice(i, 1);
      }
    }
  }

  private updateBogeys(dt: number): void {
    const sample = this.trailSampleAccum === 0;
    const limX = this.airspaceHalfWidthNm + 1.5;
    const limY = this.airspaceHalfHeightNm + 1.5;
    for (let i = this.bogeys.length - 1; i >= 0; i--) {
      const b = this.bogeys[i];
      b.ageSec += dt;
      b.inConflict = false;
      const u = headingDegToUnitVec(b.headingDeg);
      b.x += u.x * b.speedNmPerSec * dt;
      b.y += u.y * b.speedNmPerSec * dt;
      if (sample) this.pushTrailPoint(b.trail, b.x, b.y, 12);

      if (b.ageSec > 6 && (Math.abs(b.x) > limX || Math.abs(b.y) > limY)) {
        this.bogeys.splice(i, 1);
      }
    }
  }

  private updateDepartureQueue(dt: number): void {
    for (const dep of this.departureQueue) {
      dep.waitSec += dt;
      dep.urgent = dep.waitSec >= dep.maxWaitSec * 0.65;
      if (dep.waitSec >= dep.maxWaitSec) {
        this.multiplier = Math.max(
          APPROACH_CONSTANTS.CLEAN_MULTIPLIER_MIN,
          Math.round((this.multiplier - APPROACH_CONSTANTS.DEPARTURE_DELAY_PENALTY) * 100) / 100
        );
        this.pushLog('GROUND', `DEP DELAY: ${dep.callsign} (-0.25X)`, 'amber');
        this.spawnPopup(
          dep.holdShortPos.x,
          dep.holdShortPos.y + 0.85,
          'DEP DELAY',
          '-0.25X MULT',
          '#ffaa33',
          1.6
        );
        dep.waitSec = Math.max(0, dep.maxWaitSec - APPROACH_CONSTANTS.DEPARTURE_DELAY_RESET_SEC);
      }
    }
  }

  private updateSchedulers(dt: number): void {
    const cfg = this.getShiftPhaseConfig();

    // Regular arrivals (exclude departing craft from arrival cap)
    this.spawnTimerSec -= dt;
    const activeArrivals = this.aircraft.filter((c) => !c.isDeparture).length;
    const minActive = this.shiftPhase === 'ALPHA' ? 2 : 3;
    if (
      (this.spawnTimerSec <= 0 && activeArrivals < cfg.maxConcurrentAircraft) ||
      activeArrivals < minActive - 1
    ) {
      this.spawnScheduledArrival(cfg);
      this.spawnTimerSec =
        cfg.spawnIntervalMinSec +
        Math.random() * (cfg.spawnIntervalMaxSec - cfg.spawnIntervalMinSec);
    }

    // Outbound Departures (begins organically once landedCount >= 2)
    if (this.landedCount >= 2) {
      const maxDepQueue = this.shiftPhase === 'ALPHA' || this.shiftPhase === 'BRAVO' ? 1 : 2;
      if (this.departureQueue.length < maxDepQueue) {
        this.departureSpawnTimerSec -= dt;
        if (this.departureSpawnTimerSec <= 0) {
          this.queueDepartureNow();
          if (this.shiftPhase === 'ALPHA' || this.shiftPhase === 'BRAVO') {
            this.departureSpawnTimerSec = 20 + Math.random() * 8;
          } else if (this.shiftPhase === 'CHARLIE') {
            this.departureSpawnTimerSec = 16 + Math.random() * 6;
          } else {
            this.departureSpawnTimerSec = 13 + Math.random() * 5;
          }
        }
      }
    }

    // Ion Storm cells (INFO BRAVO+, max 1 in BRAVO/CHARLIE, max 2 non-overlapping in DELTA/ECHO)
    if (cfg.maxStorms > 0) {
      this.stormSpawnTimerSec -= dt;
      if (this.stormSpawnTimerSec <= 0 && this.storms.length < cfg.maxStorms) {
        this.spawnStormNow();
        this.stormSpawnTimerSec = this.shiftPhase === 'ECHO' ? 20 : 26;
      }
    }

    // Periodic Runway Reversals (INFO DELTA+, 56s DELTA / 48s ECHO)
    if (cfg.allowWindFlip && this.pendingRunway === null) {
      this.windFlipTimerSec -= dt;
      if (this.windFlipTimerSec <= 0) {
        this.triggerRunwayFlipNow();
        this.windFlipTimerSec = this.shiftPhase === 'ECHO' ? 48 : 56;
      }
    }

    // MAYDAY / BINGO FUEL Emergencies (INFO CHARLIE+, 42s CHARLIE / 38s DELTA / 30s ECHO)
    if (cfg.allowMayday) {
      this.maydayTimerSec -= dt;
      const activeMaydays = this.aircraft.filter((c) => c.isEmergency).length;
      const maxMaydays = this.shiftPhase === 'ECHO' ? 2 : 1;
      if (this.maydayTimerSec <= 0 && activeMaydays < maxMaydays) {
        this.spawnMaydayNow();
        this.maydayTimerSec =
          this.shiftPhase === 'ECHO' ? 30 : this.shiftPhase === 'DELTA' ? 38 : 42;
      }
    }

    // Primary-Only Bogeys (INFO DELTA+, 34s DELTA / 28s ECHO)
    if (cfg.allowBogeys) {
      this.bogeyTimerSec -= dt;
      const maxBogeys = this.shiftPhase === 'ECHO' ? 2 : 1;
      if (this.bogeyTimerSec <= 0 && this.bogeys.length < maxBogeys) {
        this.spawnBogeyNow();
        this.bogeyTimerSec = this.shiftPhase === 'ECHO' ? 28 : 34;
      }
    }
  }

  private spawnScheduledArrival(cfg: ShiftPhaseConfig): void {
    const r = Math.random();
    let kind: AircraftKind;
    if (!cfg.allowTugs) {
      kind = r < 0.54 ? 'DROPSHIP' : 'HEAVY';
    } else {
      kind = r < 0.35 ? 'DROPSHIP' : r < 0.7 ? 'HEAVY' : 'TUG';
    }

    if (kind === 'DROPSHIP') {
      // BRAVO+: ~18% MEDEVAC PRIORITY upgrade when no active MEDEVAC exists
      if (cfg.allowMedevac && !this.aircraft.some((c) => c.isMedevac) && Math.random() < 0.18) {
        this.spawnMedevacNow();
        return;
      }
      // DELTA+: ~22% 2-Ship Dropship Element when capacity allows >= 2 new craft
      const activeArrivals = this.aircraft.filter((c) => !c.isDeparture).length;
      if (
        cfg.allowTwoShipElements &&
        activeArrivals <= cfg.maxConcurrentAircraft - 2 &&
        Math.random() < 0.22
      ) {
        this.spawnTwoShipElementNow();
        return;
      }
    }

    const spawn = this.pickSafePerimeterSpawn(kind);
    const craft = this.createAircraft(kind, spawn.pos, spawn.headingDeg);
    this.aircraft.push(craft);
    this.announceCheckin(craft);
  }

  /**
   * Samples a safe perimeter spawn position and inbound heading guaranteed to stay
   * >= 2.8 NM from R-118 at spawn and >= 2.0 NM clear along its initial 16 NM flight ray.
   */
  public sampleSafePerimeterSpawn(kind: AircraftKind): { pos: Vec2; headingDeg: number } {
    return this.pickSafePerimeterSpawn(kind);
  }

  private isSpawnRayClearOfRestrictedZone(
    pos: Vec2,
    headingDeg: number,
    bufferNm = 2.0
  ): boolean {
    const u = headingDegToUnitVec(headingDeg);
    const ray8: Vec2 = { x: pos.x + u.x * 8, y: pos.y + u.y * 8 };
    const ray12: Vec2 = { x: pos.x + u.x * 12, y: pos.y + u.y * 12 };
    const ray16: Vec2 = { x: pos.x + u.x * 16, y: pos.y + u.y * 16 };
    return (
      !segmentNearRestrictedZone(pos, ray8, bufferNm) &&
      !segmentNearRestrictedZone(pos, ray12, bufferNm) &&
      !segmentNearRestrictedZone(pos, ray16, bufferNm)
    );
  }

  private pickSafeInboundHeading(pos: Vec2, bufferNm = 2.0): number | null {
    const halfW = Math.max(8, this.airspaceHalfWidthNm - 1.0);
    const halfH = Math.max(8, this.airspaceHalfHeightNm - 1.0);

    const pointsInward = (hdg: number): boolean => {
      const u = headingDegToUnitVec(hdg);
      const nx = pos.x + u.x * 2.5;
      const ny = pos.y + u.y * 2.5;
      return Math.abs(nx) <= halfW + 0.1 && Math.abs(ny) <= halfH + 0.1;
    };

    // 1. Try slight organic aim offsets near (0,0) biased gently NE clear of R-118
    for (let t = 0; t < 3; t++) {
      const aimX = (Math.random() - 0.35) * 4.5;
      const aimY = (Math.random() - 0.35) * 4.5;
      const hdg = vecToHeadingDeg(aimX - pos.x, aimY - pos.y);
      if (pointsInward(hdg) && this.isSpawnRayClearOfRestrictedZone(pos, hdg, bufferNm)) {
        return hdg;
      }
    }

    // 2. Fallback to deterministic NE/E/N aim points safely clear of R-118
    const safeAims: readonly Vec2[] = [
      { x: 2.5, y: 2.5 },
      { x: 0.0, y: 3.5 },
      { x: 4.0, y: 1.5 },
      { x: 1.5, y: 5.5 },
      { x: 5.5, y: -1.0 },
      { x: -1.5, y: 6.5 },
    ];
    for (const aim of safeAims) {
      const hdg = vecToHeadingDeg(aim.x - pos.x, aim.y - pos.y);
      if (pointsInward(hdg) && this.isSpawnRayClearOfRestrictedZone(pos, hdg, bufferNm)) {
        return hdg;
      }
    }

    return null;
  }

  private pickSafePerimeterSpawn(kind: AircraftKind): { pos: Vec2; headingDeg: number } {
    const halfW = Math.max(8, Math.min(this.airspaceHalfWidthNm - 1.1, 18.0));
    const halfH = Math.max(8, this.airspaceHalfHeightNm - 1.1);
    let bestSpawn: { pos: Vec2; headingDeg: number } | null = null;
    let bestClearance = -1;

    for (let attempt = 0; attempt < 40; attempt++) {
      let bearingDeg = Math.random() * 360;
      if (kind === 'HEAVY' && attempt < 18) {
        // Feed both primary and open secondary crosswind runways organically
        const useSecondary =
          this.secondaryRunwayOpen && this.activeSecondaryRunway !== null && attempt % 2 === 1;
        const targetRwy: ActiveRunwayId = useSecondary
          ? this.activeSecondaryRunway!
          : this.primaryRunway;
        const base =
          targetRwy === '27'
            ? 90
            : targetRwy === '09'
              ? 270
              : targetRwy === '36'
                ? 180
                : 0;
        bearingDeg = normalizeHeadingDeg(base + (Math.random() - 0.5) * 130);
      } else if (kind === 'TUG' && attempt < 10) {
        bearingDeg = normalizeHeadingDeg(70 + (Math.random() - 0.5) * 150);
      }

      const u = headingDegToUnitVec(bearingDeg);
      const tx = Math.abs(u.x) > 1e-5 ? halfW / Math.abs(u.x) : 1e9;
      const ty = Math.abs(u.y) > 1e-5 ? halfH / Math.abs(u.y) : 1e9;
      const dist = Math.min(tx, ty);
      const px = u.x * dist;
      const py = u.y * dist;

      // Strict MOA spawn buffer: never materialize within 2.8 NM of any R-118 edge/vertex
      if (distanceToRestrictedZoneNm(px, py) < 2.8) {
        continue;
      }

      // Strict 16 NM initial trajectory guard: reject any heading grazing within 2.0 NM of R-118
      const candidatePos: Vec2 = { x: px, y: py };
      const safeHeadingDeg = this.pickSafeInboundHeading(candidatePos, 2.0);
      if (safeHeadingDeg === null) {
        continue;
      }

      let minD = 99;
      for (const c of this.aircraft) {
        minD = Math.min(minD, distNm(px, py, c.x, c.y));
      }
      for (const b of this.bogeys) {
        minD = Math.min(minD, distNm(px, py, b.x, b.y));
      }
      if (minD > bestClearance) {
        bestClearance = minD;
        bestSpawn = { pos: candidatePos, headingDeg: safeHeadingDeg };
      }
      if (minD >= 5.2) break;
    }

    if (bestSpawn) {
      return bestSpawn;
    }

    // Provably safe perimeter fallbacks (N / E / NE / SE) clear of R-118
    const fallbacks: readonly Vec2[] = [
      { x: 0, y: halfH },
      { x: halfW, y: 2.0 },
      { x: halfW * 0.7, y: halfH },
      { x: 3.0, y: -halfH },
    ];
    for (const fb of fallbacks) {
      if (distanceToRestrictedZoneNm(fb.x, fb.y) < 2.8) continue;
      const hdg = this.pickSafeInboundHeading(fb, 2.0);
      if (hdg !== null) {
        return { pos: { ...fb }, headingDeg: hdg };
      }
    }

    return { pos: { x: 0, y: halfH }, headingDeg: 175 };
  }

  private nextCallsign(kind: AircraftKind): string {
    const prefixes = AIRCRAFT_PROFILES[kind].callsignPrefixes;
    const usedCallsigns = new Set<string>([
      ...this.aircraft.map((c) => c.callsign),
      ...this.departureQueue.map((d) => d.callsign),
    ]);
    const prefix = prefixes[this.nextEntityId % prefixes.length];

    for (let attempt = 0; attempt < 32; attempt++) {
      const nextNum = (this.callsignCounters[prefix] ?? 0) + 1;
      this.callsignCounters[prefix] = nextNum;
      const candidate =
        kind === 'MAYDAY'
          ? `MAYDAY-${nextNum}`
          : `${prefix}-${kind === 'DROPSHIP' ? 20 + nextNum : nextNum}`;
      if (!usedCallsigns.has(candidate)) {
        return candidate;
      }
    }
    return `${prefix}-${this.nextEntityId}`;
  }

  private createAircraft(
    kind: AircraftKind,
    pos: Vec2,
    headingDeg: number,
    explicitCallsign?: string,
    explicitFuelSec?: number
  ): ApproachAircraft {
    const prof = AIRCRAFT_PROFILES[kind];
    const maxFuel = explicitFuelSec ?? prof.initialFuelSec;
    const isEmergency = kind === 'MAYDAY';
    return {
      id: this.nextEntityId++,
      callsign: explicitCallsign ?? this.nextCallsign(kind),
      kind,
      x: pos.x,
      y: pos.y,
      headingDeg: normalizeHeadingDeg(headingDeg),
      targetHeadingDeg: normalizeHeadingDeg(headingDeg),
      baseSpeedKt: prof.speedKt,
      speedMode: 'STD',
      speedKt: prof.speedKt,
      speedNmPerSec: prof.speedNmPerSec,
      turnRateDegPerSec: prof.turnRateDegPerSec,
      altitudeFt: kind === 'HEAVY' ? 4500 : kind === 'DROPSHIP' ? 3500 : 4000,
      fuelSec: maxFuel,
      maxFuelSec: maxFuel,
      fuelPct: 100,
      fuelStatus: isEmergency ? 'BINGO' : 'NOMINAL',
      state: 'APPROACH',
      waypoints: [],
      trail: [{ x: pos.x, y: pos.y }],
      lockedTarget: null,
      assignedHoldFix: null,
      holdAltitudeSlot: null,
      holdLegPhase: 'ENTRY',
      holdLegDistNm: 0,
      holdTurnAccumDeg: 0,
      goAroundTimer: 0,
      inStorm: false,
      inConflict: false,
      inRestrictedZone: false,
      restrictedExposureSec: 0,
      minSeparationNm: 99,
      landingProgress: 0,
      pingTimer: isEmergency ? 4.0 : 1.5,
      checkinFlashTimer: 2.0,
      ageSec: 0,
      jokerAnnounced: isEmergency,
      bingoAnnounced: isEmergency,
      sweptHighlight: 1.0,
      isHeavy: kind === 'HEAVY',
      isEmergency,
      isMedevac: false,
      medevacExpressTimerSec: 0,
      isDeparture: false,
      departureRollSec: 0,
      departureRunway: null,
      gapLaunchEligible: false,
      hadConflictWhileDeparting: false,
      textbookIlsAwarded: false,
    };
  }

  private announceCheckin(craft: ApproachAircraft): void {
    let announcedRwy: ActiveRunwayId = this.primaryRunway;
    if (craft.kind === 'HEAVY' && this.secondaryRunwayOpen && this.activeSecondaryRunway) {
      const secOut = getRunwayOutwardUnitVec(this.activeSecondaryRunway);
      const priOut = getRunwayOutwardUnitVec(this.primaryRunway);
      const dotSec = craft.x * secOut.x + craft.y * secOut.y;
      const dotPri = craft.x * priOut.x + craft.y * priOut.y;
      if (dotSec > dotPri) {
        announcedRwy = this.activeSecondaryRunway;
      }
    }

    const sector = posToCompassSector(craft.x, craft.y);
    this.audioCb.onCheckin(craft.kind, announcedRwy, craft.callsign, {
      sector,
      isMedevac: craft.isMedevac,
    });
    const shortMsg =
      craft.kind === 'HEAVY'
        ? `${craft.callsign}: ${sector}, INBOUND ILS ${announcedRwy}`
        : craft.kind === 'DROPSHIP'
          ? `${craft.callsign}: ${sector}, INBOUND PAD α`
          : craft.kind === 'TUG'
            ? `${craft.callsign}: ${sector}, INBOUND CRADLE`
            : `${craft.callsign}: BINGO! ANY PAD`;
    this.setTxCaption(shortMsg);
    this.pushLog(
      craft.callsign,
      shortMsg,
      craft.isEmergency ? 'red' : craft.kind === 'HEAVY' ? 'amber' : craft.kind === 'TUG' ? 'cyan' : 'green'
    );
  }

  private updateAircraft(dt: number, sampleTrail: boolean): void {
    for (let i = this.aircraft.length - 1; i >= 0; i--) {
      const craft = this.aircraft[i];
      if (!craft) continue;
      craft.ageSec += dt;
      craft.pingTimer = Math.max(0, craft.pingTimer - dt);
      craft.checkinFlashTimer = Math.max(0, craft.checkinFlashTimer - dt);
      craft.inConflict = false;
      craft.minSeparationNm = 99;

      // Ion Static transponder scramble & vector lock check (activates at intensity >= 0.45 for ~1.4s warning)
      craft.inStorm = false;
      for (const s of this.storms) {
        if (s.intensity >= 0.45 && distNm(craft.x, craft.y, s.x, s.y) <= s.radiusNm) {
          craft.inStorm = true;
          break;
        }
      }

      // Tick MEDEVAC express bonus timer (zero penalty on expiry)
      if (craft.isMedevac && craft.medevacExpressTimerSec > 0 && craft.state !== 'LANDING') {
        craft.medevacExpressTimerSec = Math.max(0, craft.medevacExpressTimerSec - dt);
      }

      // Restricted / Do-Not-Fly Live-Fire MOA (R-118 // HOT) exposure check
      const wasInRestricted = craft.inRestrictedZone;
      craft.inRestrictedZone = craft.state !== 'LANDING' && isPointInRestrictedZone(craft.x, craft.y);
      if (craft.inRestrictedZone) {
        craft.restrictedExposureSec += dt;
        if (!wasInRestricted) {
          if (this.restrictedPenaltyCooldownSec <= 0) {
            this.multiplier = Math.max(
              APPROACH_CONSTANTS.CLEAN_MULTIPLIER_MIN,
              Math.round((this.multiplier - APPROACH_CONSTANTS.CONFLICT_MULTIPLIER_PENALTY) * 100) /
                100
            );
            this.restrictedPenaltyCooldownSec =
              APPROACH_CONSTANTS.RESTRICTED_ZONE_PENALTY_COOLDOWN_SEC;
          }
          this.audioCb.onRestrictedZoneAlert(craft.callsign);
          this.setTxCaption(`R-118 VIOLATION: ${craft.callsign}`);
          this.pushLog('R-118', `R-118 VIOLATION! ${craft.callsign}`, 'red');
          this.spawnPopup(
            craft.x,
            craft.y + 0.9,
            'R-118 VIOLATION!',
            'EXIT MOA IMMEDIATELY',
            '#ff3344',
            1.8
          );
        }
        if (craft.restrictedExposureSec >= APPROACH_CONSTANTS.RESTRICTED_ZONE_BREACH_SEC) {
          this.triggerMishapBreach(
            'RESTRICTED_ZONE',
            { x: craft.x, y: craft.y },
            [craft.id],
            craft.callsign
          );
          continue;
        }
      } else {
        craft.restrictedExposureSec = Math.max(0, craft.restrictedExposureSec - dt * 1.5);
      }

      // Fuel burn & progression (NOMINAL -> JOKER -> BINGO -> FLAMEOUT)
      // Tactical holding burns at 0.35x max-endurance rate; departures do not flame out.
      if (craft.state !== 'LANDING' && !craft.isDeparture) {
        const prof = AIRCRAFT_PROFILES[craft.kind];
        const burnRate =
          craft.state === 'HOLDING'
            ? APPROACH_CONSTANTS.HOLD_FUEL_BURN_RATE
            : SPEED_MODE_PROFILES[craft.speedMode].fuelBurnMult;
        craft.fuelSec = Math.max(0, craft.fuelSec - dt * burnRate);
        craft.fuelPct = clamp((craft.fuelSec / craft.maxFuelSec) * 100, 0, 100);

        if (craft.fuelSec <= 0) {
          craft.fuelStatus = 'FLAMEOUT';
          this.triggerMishapBreach('FLAMEOUT', { x: craft.x, y: craft.y }, [craft.id], craft.callsign);
          continue;
        } else if (craft.isEmergency || craft.fuelSec <= prof.bingoFuelSec) {
          craft.fuelStatus = 'BINGO';
          if (!craft.bingoAnnounced) {
            craft.bingoAnnounced = true;
            craft.jokerAnnounced = true;
            this.audioCb.onMaydayBingo(craft.callsign);
            this.setTxCaption(`${craft.callsign}: BINGO FUEL!`);
            this.pushLog(
              craft.callsign,
              `${craft.callsign}: BINGO FUEL (${Math.ceil(craft.fuelSec)}S)!`,
              'red'
            );
          }
        } else if (craft.fuelSec <= prof.jokerFuelSec) {
          craft.fuelStatus = 'JOKER';
          if (!craft.jokerAnnounced) {
            craft.jokerAnnounced = true;
            this.audioCb.onJokerFuel(craft.callsign);
            this.setTxCaption(`${craft.callsign}: JOKER FUEL`);
            this.pushLog(
              craft.callsign,
              `${craft.callsign}: JOKER FUEL (${Math.ceil(craft.fuelSec)}S)`,
              'amber'
            );
          }
        } else {
          craft.fuelStatus = 'NOMINAL';
        }
      }

      // Smooth vertical altitude stacking (3500 / 4500 / 5500 ft @ 280 ft/s) while inbound or holding
      if (
        !craft.isDeparture &&
        craft.state !== 'LANDING' &&
        craft.assignedHoldFix !== null &&
        craft.holdAltitudeSlot !== null
      ) {
        const targetHoldAlt =
          APPROACH_CONSTANTS.HOLD_STACK_BASE_ALT_FT +
          craft.holdAltitudeSlot * APPROACH_CONSTANTS.HOLD_STACK_STEP_ALT_FT;
        const maxDelta = APPROACH_CONSTANTS.HOLD_ALT_CLIMB_RATE_FT_PER_SEC * dt;
        craft.altitudeFt += clamp(targetHoldAlt - craft.altitudeFt, -maxDelta, maxDelta);
      } else if (
        !craft.isDeparture &&
        craft.state !== 'LANDING' &&
        craft.state !== 'GO_AROUND' &&
        craft.lockedTarget === null
      ) {
        const cruiseAlt = craft.kind === 'HEAVY' ? 4500 : craft.kind === 'DROPSHIP' ? 3500 : 4000;
        const maxDelta = 180 * dt;
        craft.altitudeFt += clamp(cruiseAlt - craft.altitudeFt, -maxDelta, maxDelta);
      }

      // Flight guidance state machine
      if (craft.isDeparture) {
        const departedCleanly = this.stepDepartureCraft(craft, dt);
        if (departedCleanly) {
          this.completeDeparture(craft, i);
          continue;
        }
      } else if (craft.state === 'LANDING') {
        this.stepLandingFlare(craft, dt);
        if (craft.landingProgress >= 1) {
          this.completeTouchdown(craft, i);
          continue;
        }
      } else if (craft.state === 'HOLDING' && craft.assignedHoldFix) {
        this.stepHoldingPattern(craft, dt);
      } else if (craft.state === 'GO_AROUND') {
        craft.goAroundTimer -= dt;
        craft.altitudeFt += (3800 - craft.altitudeFt) * Math.min(1, dt * 1.8);
        this.stepHeadingMove(craft, dt);
        this.keepInsidePerimeter(craft);
        if (craft.goAroundTimer <= 0) {
          craft.state = 'APPROACH';
        }
      } else {
        this.stepWaypointOrHeading(craft, dt);
        this.checkArrivalAndCapture(craft, dt);
        this.keepInsidePerimeter(craft);
      }

      if (sampleTrail && craft.state !== 'LANDING') {
        this.pushTrailPoint(craft.trail, craft.x, craft.y, 16);
      }
    }
  }

  private stepDepartureCraft(craft: ApproachAircraft, dt: number): boolean {
    const prevRoll = craft.departureRollSec;
    craft.departureRollSec += dt;

    if (craft.departureRollSec < APPROACH_CONSTANTS.DEPARTURE_ROLL_SEC) {
      // Accelerating takeoff roll straight down runway centerline
      const rollFrac = clamp(craft.departureRollSec / APPROACH_CONSTANTS.DEPARTURE_ROLL_SEC, 0, 1);
      const u = headingDegToUnitVec(craft.headingDeg);
      const rollSpeed = craft.speedNmPerSec * (0.45 + 0.55 * rollFrac);
      craft.x += u.x * rollSpeed * dt;
      craft.y += u.y * rollSpeed * dt;
      craft.altitudeFt = rollFrac * 500;
    } else {
      if (
        prevRoll < APPROACH_CONSTANTS.DEPARTURE_ROLL_SEC &&
        craft.waypoints.length === 0 &&
        craft.departureRunway !== null
      ) {
        // Rotate & turn onto diverging departure heading (+22° off runway heading)
        craft.targetHeadingDeg = getDepartureHeadingDeg(craft.departureRunway);
      }
      craft.altitudeFt += (4500 - craft.altitudeFt) * Math.min(1, dt * 0.9);
      this.stepWaypointOrHeading(craft, dt);
      craft.state = 'DEPARTING';
    }

    const r = Math.hypot(craft.x, craft.y);
    return (
      r >= APPROACH_CONSTANTS.DEPARTURE_CLEAR_DIST_NM ||
      Math.abs(craft.x) >= this.airspaceHalfWidthNm - 0.6 ||
      Math.abs(craft.y) >= this.airspaceHalfHeightNm - 0.6
    );
  }

  private completeDeparture(craft: ApproachAircraft, index: number): void {
    const crtMult = this.getBaseScoreMultiplier();
    const cleanDep = !this.conflictActive && !craft.hadConflictWhileDeparting;
    const gapBonusEligible = Boolean(craft.gapLaunchEligible && cleanDep);

    const baseAwarded = Math.round(
      APPROACH_CONSTANTS.DEPARTURE_BASE_SCORE * this.multiplier * crtMult
    );
    const gapAwarded = gapBonusEligible
      ? Math.round(APPROACH_CONSTANTS.GAP_LAUNCH_BONUS * this.multiplier * crtMult)
      : 0;
    const awarded = baseAwarded + gapAwarded;

    this.score += awarded;
    this.departuresCleared++;
    if (gapBonusEligible) {
      this.gapLaunchesCount++;
    }

    if (cleanDep) {
      this.cleanStreak++;
      if (this.cleanStreak > this.bestCleanStreak) {
        this.bestCleanStreak = this.cleanStreak;
      }
      this.multiplier = Math.min(
        APPROACH_CONSTANTS.CLEAN_MULTIPLIER_MAX,
        Math.round((this.multiplier + APPROACH_CONSTANTS.CLEAN_MULTIPLIER_STEP) * 100) / 100
      );
      if (this.multiplier > this.maxMultiplier) {
        this.maxMultiplier = this.multiplier;
      }
    }

    this.audioCb.onDepartureComplete(craft.callsign);
    this.setTxCaption(`${craft.callsign}: DEPARTURE HANDOFF`);
    this.spawnPopup(
      craft.x,
      craft.y,
      `+${awarded} CLEAN DEP`,
      gapBonusEligible ? `+300 GAP LAUNCH · ${craft.callsign}` : `${craft.callsign} HANDOFF`,
      '#55ffee',
      1.85
    );
    if (gapBonusEligible) {
      this.audioCb.onGapLaunchBonus?.(craft.callsign);
      this.spawnPopup(
        craft.x,
        craft.y + 0.9,
        '+300 GAP LAUNCH',
        `+${gapAwarded} TIMED GAP`,
        '#66ffff',
        2.0
      );
      this.pushLog(craft.callsign, `${craft.callsign}: GAP LAUNCH +${gapAwarded}`, 'bright');
    }
    this.spawnShockwave(craft.x, craft.y, gapBonusEligible ? 3.2 : 2.2, gapBonusEligible ? 'gold' : 'green', 0.55);
    this.pushLog(craft.callsign, `${craft.callsign}: DEP HANDOFF +${awarded}`, 'cyan');

    if (cleanDep) {
      this.checkCleanStreakCommendation({ x: craft.x, y: craft.y });
    }

    this.aircraft.splice(index, 1);
  }

  /**
   * Standard Right-Hand Racetrack Holding Pattern around `KRATO` or `VEXIS`.
   * Outbound-aligned entry (within <= 12° of outboundHdg) transitions directly to OUTBOUND
   * without spinning an unnecessary extra 360° loop!
   */
  private stepHoldingPattern(craft: ApproachAircraft, dt: number): void {
    const fix = getHoldingFixDef(craft.assignedHoldFix!);
    const inboundHdg = fix.inboundHeadingDeg;
    const outboundHdg = normalizeHeadingDeg(inboundHdg + 180);
    const uIn = headingDegToUnitVec(inboundHdg);
    const uOut = { x: -uIn.x, y: -uIn.y };
    const uRight = headingDegToUnitVec(inboundHdg + 90);
    const R = fix.turnRadiusNm;
    const L = fix.legLengthNm;

    // Published right-hand racetrack turn rate for exact radius R: omega = (v / R) in deg/s
    const trackTurnRateDeg = (craft.speedNmPerSec / R) * (180 / Math.PI);
    const stepDist = craft.speedNmPerSec * dt;

    if (craft.holdLegPhase === 'ENTRY') {
      const dToFix = distNm(craft.x, craft.y, fix.pos.x, fix.pos.y);
      if (dToFix <= 0.75) {
        craft.holdLegPhase = 'TURN_OUTBOUND';
        craft.holdTurnAccumDeg = 0;
      } else {
        craft.targetHeadingDeg = vecToHeadingDeg(fix.pos.x - craft.x, fix.pos.y - craft.y);
        this.stepHeadingMove(craft, dt);
        return;
      }
    }

    if (craft.holdLegPhase === 'TURN_OUTBOUND') {
      // P0 Outbound-Aligned Entry Fix: if already aligned within <= 12° of outboundHdg, snap & go straight OUTBOUND!
      if (
        craft.holdTurnAccumDeg === 0 &&
        Math.abs(shortestHeadingDiffDeg(craft.headingDeg, outboundHdg)) <= 12
      ) {
        craft.headingDeg = outboundHdg;
        craft.targetHeadingDeg = outboundHdg;
        craft.holdLegPhase = 'OUTBOUND';
        craft.holdLegDistNm = stepDist;
        const u = headingDegToUnitVec(outboundHdg);
        craft.x += u.x * stepDist;
        craft.y += u.y * stepDist;
        return;
      }

      // Strictly RIGHT-HAND (positive clockwise) turn onto outbound heading
      const remainingRight = normalizeHeadingDeg(outboundHdg - craft.headingDeg);
      const maxTurn = trackTurnRateDeg * dt;
      const dTurn = Math.min(maxTurn, remainingRight > 0.5 ? remainingRight : maxTurn);
      craft.headingDeg = normalizeHeadingDeg(craft.headingDeg + dTurn);
      craft.targetHeadingDeg = outboundHdg;
      craft.holdTurnAccumDeg += dTurn;

      const u = headingDegToUnitVec(craft.headingDeg);
      craft.x += u.x * stepDist;
      craft.y += u.y * stepDist;

      const newRemaining = normalizeHeadingDeg(outboundHdg - craft.headingDeg);
      if (
        newRemaining <= Math.max(4, maxTurn) ||
        Math.abs(shortestHeadingDiffDeg(craft.headingDeg, outboundHdg)) <= Math.max(3, maxTurn * 0.75)
      ) {
        craft.headingDeg = outboundHdg;
        craft.holdLegPhase = 'OUTBOUND';
        craft.holdLegDistNm = 0;
      }
      return;
    }

    if (craft.holdLegPhase === 'OUTBOUND') {
      const outEndX = fix.pos.x + uRight.x * (2 * R) + uOut.x * L;
      const outEndY = fix.pos.y + uRight.y * (2 * R) + uOut.y * L;
      craft.targetHeadingDeg = outboundHdg;
      this.stepHeadingMove(craft, dt);
      craft.holdLegDistNm += stepDist;

      if (craft.holdLegDistNm >= L || distNm(craft.x, craft.y, outEndX, outEndY) <= 0.55) {
        craft.holdLegPhase = 'TURN_INBOUND';
        craft.holdTurnAccumDeg = 0;
      }
      return;
    }

    if (craft.holdLegPhase === 'TURN_INBOUND') {
      if (
        craft.holdTurnAccumDeg === 0 &&
        Math.abs(shortestHeadingDiffDeg(craft.headingDeg, inboundHdg)) <= 12
      ) {
        craft.headingDeg = inboundHdg;
        craft.targetHeadingDeg = inboundHdg;
        craft.holdLegPhase = 'INBOUND';
        craft.holdLegDistNm = 0;
        const u = headingDegToUnitVec(inboundHdg);
        craft.x += u.x * stepDist;
        craft.y += u.y * stepDist;
        return;
      }

      // Strictly RIGHT-HAND (positive clockwise) turn back onto inbound heading
      const remainingRight = normalizeHeadingDeg(inboundHdg - craft.headingDeg);
      const maxTurn = trackTurnRateDeg * dt;
      const dTurn = Math.min(maxTurn, remainingRight > 0.5 ? remainingRight : maxTurn);
      craft.headingDeg = normalizeHeadingDeg(craft.headingDeg + dTurn);
      craft.targetHeadingDeg = inboundHdg;
      craft.holdTurnAccumDeg += dTurn;

      const u = headingDegToUnitVec(craft.headingDeg);
      craft.x += u.x * stepDist;
      craft.y += u.y * stepDist;

      const newRemaining = normalizeHeadingDeg(inboundHdg - craft.headingDeg);
      if (
        newRemaining <= Math.max(4, maxTurn) ||
        Math.abs(shortestHeadingDiffDeg(craft.headingDeg, inboundHdg)) <= Math.max(3, maxTurn * 0.75)
      ) {
        craft.headingDeg = inboundHdg;
        craft.holdLegPhase = 'INBOUND';
        craft.holdLegDistNm = 0;
      }
      return;
    }

    // INBOUND leg: home smoothly onto exact published fix coordinates to zero out any drift
    const dToFix = distNm(craft.x, craft.y, fix.pos.x, fix.pos.y);
    craft.targetHeadingDeg = vecToHeadingDeg(fix.pos.x - craft.x, fix.pos.y - craft.y);
    this.stepHeadingMove(craft, dt);
    if (dToFix <= Math.max(0.45, stepDist * 1.4)) {
      craft.holdLegPhase = 'TURN_OUTBOUND';
      craft.holdTurnAccumDeg = 0;
    }
  }

  private finishCraftWaypoints(craft: ApproachAircraft): void {
    if (craft.isDeparture) {
      craft.state = 'DEPARTING';
    } else if (craft.assignedHoldFix) {
      craft.state = 'HOLDING';
      craft.holdLegPhase = 'TURN_OUTBOUND';
      craft.holdTurnAccumDeg = 0;
    } else if (craft.lockedTarget) {
      craft.state = 'ESTABLISHED';
    } else {
      craft.state = 'APPROACH';
    }
  }

  private checkUnreachableTurningCircle(
    craft: ApproachAircraft,
    target: Vec2
  ): { inside: boolean; inRight: boolean; minTurnR: number } {
    const minTurnR = getCraftMinTurnRadiusNm(craft.speedNmPerSec, craft.turnRateDegPerSec);
    if (!Number.isFinite(minTurnR) || minTurnR <= 0.1) {
      return { inside: false, inRight: false, minTurnR: 0 };
    }
    const uFwd = headingDegToUnitVec(craft.headingDeg);
    const turnCenterR = { x: craft.x + uFwd.y * minTurnR, y: craft.y - uFwd.x * minTurnR };
    const turnCenterL = { x: craft.x - uFwd.y * minTurnR, y: craft.y + uFwd.x * minTurnR };
    const dR = distNm(target.x, target.y, turnCenterR.x, turnCenterR.y);
    const dL = distNm(target.x, target.y, turnCenterL.x, turnCenterL.y);
    const unreachableR = minTurnR * 0.92;
    return {
      inside: dR < unreachableR || dL < unreachableR,
      inRight: dR <= dL,
      minTurnR,
    };
  }

  private stepWaypointOrHeading(craft: ApproachAircraft, dt: number): void {
    // Runtime Anti-Orbit Safety Guard: protect against mid-turn FAST speed jumps
    // or programmatically assigned sharp waypoints falling inside the unreachable turning circle.
    while (craft.waypoints.length > 0) {
      const wp = craft.waypoints[0];
      const d = distNm(craft.x, craft.y, wp.x, wp.y);
      const arrivalDist =
        craft.waypoints.length === 1 && craft.lockedTarget
          ? 0.62
          : APPROACH_CONSTANTS.WAYPOINT_ARRIVAL_NM;
      const hitRadius = Math.max(arrivalDist, craft.speedNmPerSec * dt * 1.35);

      if (d <= hitRadius) {
        craft.waypoints.shift();
        if (craft.waypoints.length === 0) {
          this.finishCraftWaypoints(craft);
        }
        continue;
      }

      const circleCheck = this.checkUnreachableTurningCircle(craft, wp);
      if (circleCheck.inside) {
        if (craft.waypoints.length > 1) {
          // Immediately skip interior unreachable waypoint to the next reachable point
          craft.waypoints.shift();
          continue;
        }

        // Single remaining waypoint lies inside the unreachable turning circle:
        if (craft.assignedHoldFix && d <= 1.15) {
          craft.waypoints.shift();
          this.finishCraftWaypoints(craft);
          break;
        }

        if (craft.lockedTarget !== null || craft.assignedHoldFix !== null) {
          // Locked landing target (PAD_ALPHA / SALVAGE_CRADLE / RWY) or hold fix:
          // widen approach turn smoothly away from the inner circle so the craft arcs out
          // slightly and comes right onto the target instead of orbiting forever.
          craft.targetHeadingDeg = normalizeHeadingDeg(
            craft.headingDeg + (circleCheck.inRight ? -20 : 20)
          );
          break;
        }

        // Lone free vector waypoint: once closest approach passes (abeam or behind nose),
        // finish the vector cleanly; otherwise expand gently away until clear.
        const uFwd = headingDegToUnitVec(craft.headingDeg);
        const dotFwd = (wp.x - craft.x) * uFwd.x + (wp.y - craft.y) * uFwd.y;
        if (dotFwd <= 0) {
          craft.waypoints.shift();
          craft.targetHeadingDeg = craft.headingDeg;
          this.finishCraftWaypoints(craft);
        } else {
          craft.targetHeadingDeg = normalizeHeadingDeg(
            craft.headingDeg + (circleCheck.inRight ? -20 : 20)
          );
        }
        break;
      }

      craft.targetHeadingDeg = vecToHeadingDeg(wp.x - craft.x, wp.y - craft.y);
      break;
    }

    this.stepHeadingMove(craft, dt);
  }

  private stepHeadingMove(craft: ApproachAircraft, dt: number): void {
    const diff = shortestHeadingDiffDeg(craft.headingDeg, craft.targetHeadingDeg);
    const maxTurn = craft.turnRateDegPerSec * dt;
    if (Math.abs(diff) <= maxTurn) {
      craft.headingDeg = normalizeHeadingDeg(craft.targetHeadingDeg);
    } else {
      craft.headingDeg = normalizeHeadingDeg(craft.headingDeg + Math.sign(diff) * maxTurn);
    }
    const u = headingDegToUnitVec(craft.headingDeg);
    craft.x += u.x * craft.speedNmPerSec * dt;
    craft.y += u.y * craft.speedNmPerSec * dt;
  }

  private checkArrivalAndCapture(craft: ApproachAircraft, dt: number): void {
    // 1. Check transition into LANDING flare if locked onto a valid landing zone
    if (craft.lockedTarget) {
      const targetPos = this.getLandingZonePos(craft.lockedTarget);
      const d = distNm(craft.x, craft.y, targetPos.x, targetPos.y);

      // Smooth glideslope descent while established/inbound to locked zone
      const targetAlt = clamp(d * 380, 200, 3500);
      craft.altitudeFt += (targetAlt - craft.altitudeFt) * Math.min(1, dt * 2.2);

      // Promote VECTORING -> ESTABLISHED once aligned near final approach of any locked runway
      const lockedRwy = landingZoneToRunway(craft.lockedTarget);
      if (
        craft.state === 'VECTORING' &&
        lockedRwy !== null &&
        this.getCrossTrackToRunwayNm(craft.x, craft.y, lockedRwy) <= 0.75
      ) {
        craft.state = 'ESTABLISHED';
      }

      if (craft.state === 'ESTABLISHED' && craft.waypoints.length === 0) {
        const circleCheck = this.checkUnreachableTurningCircle(craft, targetPos);
        if (circleCheck.inside) {
          craft.targetHeadingDeg = normalizeHeadingDeg(
            craft.headingDeg + (circleCheck.inRight ? -20 : 20)
          );
        } else {
          craft.targetHeadingDeg = vecToHeadingDeg(targetPos.x - craft.x, targetPos.y - craft.y);
        }
      }

      if (d <= 0.72) {
        craft.state = 'LANDING';
        craft.assignedHoldFix = null;
        craft.holdAltitudeSlot = null;
        craft.waypoints = [];
        craft.landingProgress = 0;
        return;
      }
      return;
    }

    // 2. Passive capture when a player manually flies a craft cleanly onto its valid gate
    if (craft.kind === 'DROPSHIP' || craft.kind === 'MAYDAY') {
      const pad = AIRFIELD_GEOMETRY.padAlpha.pos;
      if (distNm(craft.x, craft.y, pad.x, pad.y) <= 0.85) {
        craft.lockedTarget = 'PAD_ALPHA';
        craft.assignedHoldFix = null;
        craft.holdAltitudeSlot = null;
        craft.state = 'LANDING';
        craft.waypoints = [];
        craft.landingProgress = 0;
        return;
      }
    }

    if (craft.kind === 'TUG' || craft.kind === 'MAYDAY') {
      const cr = AIRFIELD_GEOMETRY.salvageCradle.pos;
      if (distNm(craft.x, craft.y, cr.x, cr.y) <= 0.85) {
        craft.lockedTarget = 'SALVAGE_CRADLE';
        craft.assignedHoldFix = null;
        craft.holdAltitudeSlot = null;
        craft.state = 'LANDING';
        craft.waypoints = [];
        craft.landingProgress = 0;
        return;
      }
    }

    if (craft.kind === 'HEAVY' || craft.kind === 'MAYDAY' || craft.isMedevac) {
      for (const rwy of this.getActiveRunways()) {
        const th = getRunwayThresholdNm(rwy);
        const out = getRunwayOutwardUnitVec(rwy);
        const perpX = -out.y;
        const perpY = out.x;
        const rwyHdg = getRunwayLandingHeadingDeg(rwy);
        const ilsLen = getRunwayIlsLengthNm(rwy);
        const along = (craft.x - th.x) * out.x + (craft.y - th.y) * out.y;
        const cross = Math.abs((craft.x - th.x) * perpX + (craft.y - th.y) * perpY);
        const angleDiff = Math.abs(shortestHeadingDiffDeg(craft.headingDeg, rwyHdg));

        // Auto-capture outer ILS localizer when cleanly aligned outside 5 NM FAF
        if (
          craft.kind === 'HEAVY' &&
          along >= APPROACH_CONSTANTS.ILS_FAF_DIST_NM - 0.1 &&
          along <= ilsLen &&
          cross <= 0.55 &&
          angleDiff <= APPROACH_CONSTANTS.ILS_MAX_INTERCEPT_DEG &&
          craft.waypoints.length === 0
        ) {
          const zone = runwayToLandingZone(rwy);
          craft.lockedTarget = zone;
          craft.assignedHoldFix = null;
          craft.holdAltitudeSlot = null;
          craft.state = 'ESTABLISHED';
          craft.waypoints = [getRunwayFafNm(rwy), { ...th }];
          const pan = clamp(craft.x / Math.max(1, this.airspaceHalfWidthNm), -1, 1);
          this.audioCb.onLocalizerLock(zone, pan, craft.callsign);
          this.pushLog(craft.callsign, `${craft.callsign}: LOC RWY ${rwy} LOCK`, 'green');

          if (
            !craft.textbookIlsAwarded &&
            angleDiff >= APPROACH_CONSTANTS.TEXTBOOK_ILS_MIN_DEG &&
            angleDiff <= APPROACH_CONSTANTS.TEXTBOOK_ILS_MAX_DEG
          ) {
            this.awardTextbookIlsBonus(craft, angleDiff, { x: craft.x, y: craft.y });
          }
          return;
        }

        // Unestablished Heavy slamming across threshold -> Go-Around!
        if (craft.kind === 'HEAVY' && distNm(craft.x, craft.y, th.x, th.y) <= 1.1) {
          this.executeGoAround(craft, false, 'UNESTABLISHED FINAL', rwy);
          return;
        }

        // MAYDAY & MEDEVAC can land immediately upon reaching any active runway threshold
        if ((craft.kind === 'MAYDAY' || craft.isMedevac) && distNm(craft.x, craft.y, th.x, th.y) <= 0.95) {
          craft.lockedTarget = runwayToLandingZone(rwy);
          craft.assignedHoldFix = null;
          craft.holdAltitudeSlot = null;
          craft.state = 'LANDING';
          craft.waypoints = [];
          craft.landingProgress = 0;
          return;
        }
      }
    }
  }

  private awardTextbookIlsBonus(
    craft: ApproachAircraft,
    interceptAngleDeg: number,
    pos: Vec2
  ): void {
    craft.textbookIlsAwarded = true;
    this.textbookIlsCount++;
    const bonus = Math.round(APPROACH_CONSTANTS.TEXTBOOK_ILS_BONUS * this.getBaseScoreMultiplier());
    this.score += bonus;
    this.audioCb.onTextbookIlsBonus(craft.callsign);
    this.spawnPopup(
      pos.x,
      pos.y + 0.95,
      '+250 TEXTBOOK 30°',
      this.ranked1979Bonus
        ? `+${bonus} (1.5X CRT)`
        : `${Math.round(interceptAngleDeg)}° INTERCEPT`,
      '#44eeff',
      1.75
    );
    this.pushLog(craft.callsign, `${craft.callsign}: TEXTBOOK ILS +${bonus}`, 'cyan');
  }

  private stepLandingFlare(craft: ApproachAircraft, dt: number): void {
    const zone = craft.lockedTarget ?? 'PAD_ALPHA';
    const target = this.getLandingZonePos(zone);
    craft.landingProgress = Math.min(1, craft.landingProgress + dt * 1.15);
    craft.altitudeFt = Math.max(0, craft.altitudeFt * (1 - dt * 3.5));

    const rwy = landingZoneToRunway(zone);
    if (rwy !== null) {
      const rwyHdg = getRunwayLandingHeadingDeg(rwy);
      const th = getRunwayThresholdNm(rwy);
      const u = headingDegToUnitVec(rwyHdg);
      const perpX = -u.y;
      const perpY = u.x;
      craft.headingDeg = rwyHdg;
      craft.x += u.x * craft.speedNmPerSec * 0.65 * dt;
      craft.y += u.y * craft.speedNmPerSec * 0.65 * dt;
      // Smoothly pull any residual lateral cross-track offset onto runway centerline
      const crossErr = (craft.x - th.x) * perpX + (craft.y - th.y) * perpY;
      const corr = crossErr * Math.min(1, dt * 6);
      craft.x -= perpX * corr;
      craft.y -= perpY * corr;
    } else {
      craft.x += (target.x - craft.x) * Math.min(1, dt * 4.2);
      craft.y += (target.y - craft.y) * Math.min(1, dt * 4.2);
    }
  }

  private completeTouchdown(craft: ApproachAircraft, index: number): void {
    const zone: LandingZoneId = craft.lockedTarget ?? 'PAD_ALPHA';
    const prof = AIRCRAFT_PROFILES[craft.kind];
    const lastTime = this.lastTouchdownByZone[zone];
    const seqWindowSec = getTightSequenceWindowSec(zone);
    const isSequenced =
      lastTime !== undefined &&
      this.shiftElapsedSec - lastTime <= seqWindowSec &&
      !this.conflictActive;
    this.lastTouchdownByZone[zone] = this.shiftElapsedSec;

    // Micro-scoring hook: +750 FUMES SAVE on MAYDAY or BINGO craft with <= 5.0s fuel left!
    const isFumesSave =
      (craft.isEmergency || craft.fuelStatus === 'BINGO') &&
      craft.fuelSec <= APPROACH_CONSTANTS.FUMES_SAVE_THRESHOLD_SEC;

    // Positive risk-reward hook: +800 MEDEVAC EXPRESS (* cleanMultiplier) while express timer > 0
    const isMedevacExpress = Boolean(craft.isMedevac && craft.medevacExpressTimerSec > 0);

    const emergencyMult = craft.isEmergency ? APPROACH_CONSTANTS.MAYDAY_SCORE_MULTIPLIER : 1;
    const crtMult = this.getBaseScoreMultiplier();
    const landingBase = prof.baseScore * emergencyMult * this.multiplier;
    const seqBonus = isSequenced ? APPROACH_CONSTANTS.TIGHT_SEQUENCE_BONUS : 0;
    const fumesBonus = isFumesSave ? APPROACH_CONSTANTS.FUMES_SAVE_BONUS : 0;
    const medevacBonus = isMedevacExpress
      ? APPROACH_CONSTANTS.MEDEVAC_EXPRESS_BONUS * this.multiplier
      : 0;
    const awarded = Math.round((landingBase + seqBonus + fumesBonus + medevacBonus) * crtMult);

    this.score += awarded;
    this.landedCount++;
    if (craft.isEmergency) this.maydaysSaved++;
    if (isSequenced) this.sequencedCount++;
    if (isFumesSave) this.fumesSavesCount++;
    if (isMedevacExpress) this.medevacExpressCount++;

    const cleanLanding = !this.conflictActive;
    // Advance Clean Shift Multiplier & Streak Commendations on conflict-free touchdowns
    if (cleanLanding) {
      this.cleanStreak++;
      if (this.cleanStreak > this.bestCleanStreak) {
        this.bestCleanStreak = this.cleanStreak;
      }
      this.multiplier = Math.min(
        APPROACH_CONSTANTS.CLEAN_MULTIPLIER_MAX,
        Math.round((this.multiplier + APPROACH_CONSTANTS.CLEAN_MULTIPLIER_STEP) * 100) / 100
      );
      if (this.multiplier > this.maxMultiplier) {
        this.maxMultiplier = this.multiplier;
      }
    }

    const pos = this.getLandingZonePos(zone);
    const pan = clamp(pos.x / Math.max(1, this.airspaceHalfWidthNm), -1, 1);
    this.audioCb.onTouchdown(craft.kind, zone, pan, craft.callsign, isSequenced);
    this.setTxCaption(`${craft.callsign}, clear of the active.`);

    const subParts: string[] = [];
    if (craft.isEmergency) subParts.push('MAYDAY 3X!');
    if (isMedevacExpress) subParts.push('+800 MEDEVAC');
    if (isSequenced) subParts.push('+500 SEQUENCED');
    if (this.ranked1979Bonus) subParts.push('1.5X CRT');
    this.spawnPopup(
      pos.x,
      pos.y + 0.75,
      `+${awarded.toLocaleString()}`,
      subParts.length > 0 ? subParts.join(' · ') : `${craft.callsign} DOWN`,
      craft.isEmergency ? '#ffdd55' : isMedevacExpress || isSequenced ? '#55ffee' : '#55ff88',
      1.85
    );

    if (isMedevacExpress) {
      this.audioCb.onMedevacBonus?.(craft.callsign);
      this.spawnPopup(
        pos.x,
        pos.y + 1.55,
        '+800 MEDEVAC EXPRESS',
        `${craft.medevacExpressTimerSec.toFixed(1)}S LEFT`,
        '#66ffff',
        2.15
      );
      this.spawnShockwave(pos.x, pos.y, 4.0, 'gold', 0.8);
      this.pushLog(
        craft.callsign,
        `MEDEVAC EXPRESS! ${craft.callsign} +${Math.round(medevacBonus * crtMult)}`,
        'bright'
      );
    }

    if (isFumesSave) {
      this.audioCb.onFumesSaveBonus(craft.callsign);
      this.spawnPopup(
        pos.x,
        pos.y + 1.55,
        'FUMES SAVE +750',
        `${craft.fuelSec.toFixed(1)}S FUEL LEFT`,
        '#ffdd44',
        2.2
      );
      this.spawnShockwave(pos.x, pos.y, 4.4, 'gold', 0.88);
      this.pushLog(craft.callsign, `FUMES SAVE! ${craft.callsign} +${awarded}`, 'bright');
    } else if (!isMedevacExpress) {
      this.spawnShockwave(pos.x, pos.y, 2.4, 'green', 0.55);
      this.pushLog(
        craft.callsign,
        `${craft.callsign}: ${this.formatZoneLabel(zone)} +${awarded}${isSequenced ? ' SEQ' : ''}`,
        craft.isEmergency ? 'bright' : 'green'
      );
    }

    if (cleanLanding) {
      this.checkCleanStreakCommendation(pos);
    }

    this.aircraft.splice(index, 1);
    this.syncShiftPhase(false);
  }

  /**
   * Awards Clean Streak Commendations (`5 / 10 / 15`) and ICC Reserve Seal Restoration
   * (every `20` clean ops: restores +1 Seal if `< 3/3` + `+2,000`, else `+2,500 FLAWLESS WATCH`).
   */
  private checkCleanStreakCommendation(pos: Vec2): void {
    const s = this.cleanStreak;
    const crtMult = this.getBaseScoreMultiplier();
    let baseBonus = 0;
    let title = '';
    let popupText = '';
    let subText = '';
    let color = '#55eeff';
    let sealRestored = false;

    if (s === 5) {
      baseBonus = 500;
      title = 'VECTOR ACE';
      popupText = '+500 VECTOR ACE';
      subText = '5 CLEAN OPS STREAK';
      color = '#55eeff';
    } else if (s === 10) {
      baseBonus = 1000;
      title = 'SECTOR WATCH';
      popupText = '+1,000 SECTOR WATCH';
      subText = '10 CLEAN OPS STREAK';
      color = '#55ff99';
    } else if (s === 15) {
      baseBonus = 1500;
      title = 'RAPCON MASTER';
      popupText = '+1,500 RAPCON MASTER';
      subText = '15 CLEAN OPS STREAK';
      color = '#ffdd55';
    } else if (s >= 20 && s % 20 === 0) {
      if (this.safetySeals < this.maxSafetySeals) {
        this.safetySeals = Math.min(this.maxSafetySeals, this.safetySeals + 1);
        this.sealsRestored += 1;
        baseBonus = 2000;
        title = 'ICC SEAL RESTORED (+1 SEAL)';
        popupText = '+2,000 ICC SEAL RESTORED';
        subText = `+1 SEAL (${this.safetySeals}/${this.maxSafetySeals}) · ${s} STREAK`;
        color = '#ffdd44';
        sealRestored = true;
      } else {
        baseBonus = 2500;
        title = 'FLAWLESS WATCH';
        popupText = '+2,500 FLAWLESS WATCH';
        subText = `${s} CLEAN OPS · 3/3 SEALS`;
        color = '#ffdd44';
      }
    } else {
      return;
    }

    const awarded = Math.round(baseBonus * crtMult);
    this.score += awarded;
    this.audioCb.onStreakCommendation?.(s, title, sealRestored);
    this.setTxCaption(`COMMENDATION: ${title} (+${awarded.toLocaleString()})`);
    this.pushLog('RAPCON', `★ ${s} STREAK: ${title} +${awarded.toLocaleString()}`, 'bright');
    this.spawnPopup(
      clamp(pos.x, -this.airspaceHalfWidthNm + 3, this.airspaceHalfWidthNm - 3),
      clamp(pos.y + 2.1, -this.airspaceHalfHeightNm + 2, this.airspaceHalfHeightNm - 2),
      popupText,
      subText,
      color,
      2.4
    );
    if (s >= 20) {
      this.spawnShockwave(pos.x, pos.y, sealRestored ? 5.2 : 4.6, 'gold', 1.0);
    }
  }

  private evaluateSeparationAndCollisions(): void {
    const prevConflict = this.conflictActive;
    const pairs: ConflictPair[] = [];
    let minSep = 99;
    let collisionPair: { pos: Vec2; craftIds: number[]; desc: string } | null = null;

    const isCaExempt = (c: ApproachAircraft): boolean =>
      c.state === 'LANDING' ||
      (c.isDeparture && c.departureRollSec < APPROACH_CONSTANTS.DEPARTURE_CA_EXEMPT_SEC);

    // Authentic IFR Vertical Altitude Stacking Exemption:
    // Two craft sharing the same holding fix, on DIFFERENT altitude slots (1,000+ ft vertical sep),
    // and both within 2.8 NM of that fix's center are exempt from 2D CA and Collision with each other!
    const areVerticallyStackedInHold = (a: ApproachAircraft, b: ApproachAircraft): boolean => {
      if (
        a.assignedHoldFix === null ||
        a.assignedHoldFix !== b.assignedHoldFix ||
        a.holdAltitudeSlot === null ||
        b.holdAltitudeSlot === null ||
        a.holdAltitudeSlot === b.holdAltitudeSlot
      ) {
        return false;
      }
      const fix = getHoldingFixDef(a.assignedHoldFix);
      return (
        distNm(a.x, a.y, fix.pos.x, fix.pos.y) <= APPROACH_CONSTANTS.HOLD_STACK_EXEMPT_RADIUS_NM &&
        distNm(b.x, b.y, fix.pos.x, fix.pos.y) <= APPROACH_CONSTANTS.HOLD_STACK_EXEMPT_RADIUS_NM
      );
    };

    // Aircraft-vs-Aircraft separation
    for (let i = 0; i < this.aircraft.length; i++) {
      const a = this.aircraft[i];
      if (isCaExempt(a)) continue;
      for (let j = i + 1; j < this.aircraft.length; j++) {
        const b = this.aircraft[j];
        if (isCaExempt(b)) continue;
        if (areVerticallyStackedInHold(a, b)) continue;
        const d = distNm(a.x, a.y, b.x, b.y);
        if (d < a.minSeparationNm) a.minSeparationNm = d;
        if (d < b.minSeparationNm) b.minSeparationNm = d;
        if (d < minSep) minSep = d;

        if (d < APPROACH_CONSTANTS.SEPARATION_MIN_NM) {
          a.inConflict = true;
          b.inConflict = true;
          if (a.isDeparture) a.hadConflictWhileDeparting = true;
          if (b.isDeparture) b.hadConflictWhileDeparting = true;
          const severity = clamp(
            (APPROACH_CONSTANTS.SEPARATION_MIN_NM - d) /
              (APPROACH_CONSTANTS.SEPARATION_MIN_NM - APPROACH_CONSTANTS.COLLISION_RADIUS_NM),
            0,
            1
          );
          pairs.push({
            idA: a.id,
            idB: b.id,
            isBogeyB: false,
            ax: a.x,
            ay: a.y,
            bx: b.x,
            by: b.y,
            distanceNm: d,
            severity,
          });
          if (d < APPROACH_CONSTANTS.COLLISION_RADIUS_NM && !collisionPair) {
            collisionPair = {
              pos: { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 },
              craftIds: [a.id, b.id],
              desc: `${a.callsign}/${b.callsign}`,
            };
          }
        }
      }

      // Aircraft-vs-Primary Bogey separation
      for (const bogey of this.bogeys) {
        const d = distNm(a.x, a.y, bogey.x, bogey.y);
        if (d < a.minSeparationNm) a.minSeparationNm = d;
        if (d < minSep) minSep = d;

        if (d < APPROACH_CONSTANTS.SEPARATION_MIN_NM) {
          a.inConflict = true;
          if (a.isDeparture) a.hadConflictWhileDeparting = true;
          bogey.inConflict = true;
          const severity = clamp(
            (APPROACH_CONSTANTS.SEPARATION_MIN_NM - d) /
              (APPROACH_CONSTANTS.SEPARATION_MIN_NM - APPROACH_CONSTANTS.COLLISION_RADIUS_NM),
            0,
            1
          );
          pairs.push({
            idA: a.id,
            idB: bogey.id,
            isBogeyB: true,
            ax: a.x,
            ay: a.y,
            bx: bogey.x,
            by: bogey.y,
            distanceNm: d,
            severity,
          });
          if (d < APPROACH_CONSTANTS.COLLISION_RADIUS_NM && !collisionPair) {
            collisionPair = {
              pos: { x: (a.x + bogey.x) * 0.5, y: (a.y + bogey.y) * 0.5 },
              craftIds: [a.id],
              desc: `${a.callsign}/${bogey.trackCode}`,
            };
          }
        }
      }
    }

    this.conflictPairs = pairs;
    this.conflictActive = pairs.length > 0;
    this.minSeparationNm = minSep;

    if (this.conflictActive) {
      if (!prevConflict && this.caMultiplierPenaltyCooldownSec <= 0) {
        // P0 2.5s CA hysteresis cooldown prevents double-docking when oscillating across 2.99 <-> 3.01 NM
        this.multiplier = Math.max(
          APPROACH_CONSTANTS.CLEAN_MULTIPLIER_MIN,
          Math.round((this.multiplier - APPROACH_CONSTANTS.CONFLICT_MULTIPLIER_PENALTY) * 100) / 100
        );
        this.caMultiplierPenaltyCooldownSec = APPROACH_CONSTANTS.CA_MULTIPLIER_PENALTY_COOLDOWN_SEC;
        this.pushLog('TCAS', `CA! SEP ${minSep.toFixed(1)} NM (<3.0 NM)`, 'red');
      }
      if (this.caAudioCooldownSec <= 0) {
        this.audioCb.onConflictAlert(minSep);
        this.setTxCaption(`CA ALERT: ${minSep.toFixed(1)} NM`);
        this.caAudioCooldownSec = 3.6;
      }
    } else if (prevConflict) {
      // P0 Audio Clear Callback immediately when separation restores!
      this.audioCb.onConflictCleared();
    }

    if (collisionPair && this.antiDoubleStrikeTimer <= 0 && this.incidentFreezeTimer <= 0) {
      this.triggerMishapBreach(
        'COLLISION',
        collisionPair.pos,
        collisionPair.craftIds,
        collisionPair.desc
      );
    }
  }

  private triggerMishapBreach(
    reason: MishapReason,
    pos: Vec2,
    involvedCraftIds: number[],
    subjectLabel: string
  ): void {
    if (involvedCraftIds.length > 0) {
      const removeSet = new Set(involvedCraftIds);
      this.aircraft = this.aircraft.filter((c) => !removeSet.has(c.id));
    }

    if (this.antiDoubleStrikeTimer > 0) return;

    if (!this.trainingMode) {
      this.safetySeals = Math.max(0, this.safetySeals - 1);
    } else {
      this.safetySeals = Math.max(1, this.safetySeals);
    }
    this.multiplier = APPROACH_CONSTANTS.CLEAN_MULTIPLIER_MIN;
    this.cleanStreak = 0;

    this.incidentFreezeTimer = APPROACH_CONSTANTS.INCIDENT_FREEZE_SEC;
    this.incidentPos = { ...pos };
    this.incidentReason = reason;
    this.incidentCallout =
      reason === 'COLLISION'
        ? 'LOSS OF SEPARATION'
        : reason === 'FLAMEOUT'
          ? 'FUEL FLAMEOUT'
          : 'R-118 MOA BREACH';
    this.antiDoubleStrikeTimer = APPROACH_CONSTANTS.ANTI_DOUBLE_STRIKE_SEC;
    this.screenShake = 1.0;
    this.sealBreachFlashTimer = 1.6;

    this.audioCb.onMishapBreach(reason, this.safetySeals);
    this.setTxCaption(`MISHAP: ${this.incidentCallout}`);
    this.spawnShockwave(pos.x, pos.y, 7.5, 'red', 1.25);
    this.spawnPopup(
      pos.x,
      pos.y + 0.9,
      this.incidentCallout,
      this.trainingMode
        ? 'TRAINING RESET'
        : `SEAL BREACHED (${this.safetySeals}/${this.maxSafetySeals})`,
      '#ff4444',
      2.2
    );

    const shortLog =
      reason === 'RESTRICTED_ZONE'
        ? `R-118 BREACH: ${subjectLabel}!`
        : reason === 'FLAMEOUT'
          ? `FLAMEOUT: ${subjectLabel} (${this.safetySeals} LEFT)`
          : `COLLISION: ${subjectLabel} (${this.safetySeals})`;
    this.pushLog('MISHAP', shortLog, 'red');
  }

  private keepInsidePerimeter(craft: ApproachAircraft): void {
    if (craft.isDeparture) return;

    const softW = Math.max(6, this.airspaceHalfWidthNm - 0.85);
    const softH = Math.max(6, this.airspaceHalfHeightNm - 0.85);
    if (
      (Math.abs(craft.x) > softW || Math.abs(craft.y) > softH) &&
      craft.waypoints.length === 0 &&
      craft.state !== 'HOLDING'
    ) {
      const pos: Vec2 = { x: craft.x, y: craft.y };
      const directInward = vecToHeadingDeg(-craft.x, -craft.y);
      const curMoaDist = distanceToRestrictedZoneNm(craft.x, craft.y);
      const desiredBuf = Math.min(2.2, Math.max(0.5, curMoaDist - 0.15));

      const isPerimeterRaySafe = (hdg: number, buf: number): boolean => {
        const u = headingDegToUnitVec(hdg);
        const rayEnd: Vec2 = { x: pos.x + u.x * 14, y: pos.y + u.y * 14 };
        return !segmentNearRestrictedZone(pos, rayEnd, buf);
      };

      if (isPerimeterRaySafe(directInward, desiredBuf)) {
        craft.targetHeadingDeg = directInward;
      } else {
        // Steer cleanly around R-118 instead of turning straight into the MOA from the SW perimeter
        const candidates: number[] = [];
        const bypassAims: readonly Vec2[] = [
          { x: -4.0, y: 5.0 },
          { x: 2.5, y: 2.5 },
          { x: 0.0, y: 6.5 },
          { x: 4.5, y: -9.5 },
          { x: 2.0, y: -12.0 },
          { x: -13.5, y: 5.5 },
        ];
        for (const aim of bypassAims) {
          candidates.push(vecToHeadingDeg(aim.x - craft.x, aim.y - craft.y));
        }
        for (const offset of [30, -30, 50, -50, 70, -70, 90, -90]) {
          candidates.push(normalizeHeadingDeg(directInward + offset));
        }

        let chosenHdg: number | null = null;
        let bestScore = -Infinity;
        for (const cand of candidates) {
          const u = headingDegToUnitVec(cand);
          const nx = craft.x + u.x * 2.5;
          const ny = craft.y + u.y * 2.5;
          const movesInward =
            Math.abs(nx) <= Math.max(softW + 0.35, Math.abs(craft.x) + 0.15) &&
            Math.abs(ny) <= Math.max(softH + 0.35, Math.abs(craft.y) + 0.15) &&
            (Math.abs(nx) < Math.abs(craft.x) - 0.1 || Math.abs(ny) < Math.abs(craft.y) - 0.1);
          if (!movesInward) continue;
          if (!isPerimeterRaySafe(cand, desiredBuf)) continue;

          const probeDist = distanceToRestrictedZoneNm(craft.x + u.x * 4, craft.y + u.y * 4);
          const turnCost = Math.abs(shortestHeadingDiffDeg(directInward, cand)) * 0.03;
          const score = probeDist - turnCost;
          if (score > bestScore) {
            bestScore = score;
            chosenHdg = cand;
          }
        }

        craft.targetHeadingDeg = chosenHdg ?? directInward;
      }
    }

    const hardW = Math.max(6, this.airspaceHalfWidthNm - 0.15);
    const hardH = Math.max(6, this.airspaceHalfHeightNm - 0.15);
    craft.x = clamp(craft.x, -hardW, hardW);
    craft.y = clamp(craft.y, -hardH, hardH);
  }

  private getLandingZonePos(zone: LandingZoneId): Vec2 {
    if (zone === 'RWY_27') return AIRFIELD_GEOMETRY.runway.threshold27;
    if (zone === 'RWY_09') return AIRFIELD_GEOMETRY.runway.threshold09;
    if (zone === 'RWY_36') return AIRFIELD_GEOMETRY.secondaryRunway.threshold36;
    if (zone === 'RWY_18') return AIRFIELD_GEOMETRY.secondaryRunway.threshold18;
    if (zone === 'PAD_ALPHA') return AIRFIELD_GEOMETRY.padAlpha.pos;
    return AIRFIELD_GEOMETRY.salvageCradle.pos;
  }

  private formatZoneLabel(zone: LandingZoneId): string {
    if (zone === 'RWY_27') return 'RWY 27';
    if (zone === 'RWY_09') return 'RWY 09';
    if (zone === 'RWY_36') return 'RWY 36';
    if (zone === 'RWY_18') return 'RWY 18';
    if (zone === 'PAD_ALPHA') return 'PAD α';
    return 'CRADLE';
  }

  private pushTrailPoint(trail: Vec2[], x: number, y: number, maxLen: number): void {
    trail.push({ x, y });
    if (trail.length > maxLen) {
      trail.shift();
    }
  }

  private pushLog(sender: string, text: string, tone: CommsLogEntry['tone']): void {
    this.commsLog.push({
      id: this.nextLogId++,
      timestamp: formatClock(this.shiftElapsedSec),
      sender,
      text,
      tone,
    });
    if (this.commsLog.length > APPROACH_CONSTANTS.MAX_COMMS_LOG) {
      this.commsLog.shift();
    }
  }

  private setTxCaption(caption: string): void {
    this.lastTxCaption = caption;
    this.lastTxTimer = 3.2;
  }

  private spawnPopup(
    x: number,
    y: number,
    text: string,
    subText: string | undefined,
    color: string,
    duration = 1.6
  ): void {
    this.popups.push({
      id: this.nextPopupId++,
      x,
      y,
      text,
      subText,
      color,
      age: 0,
      duration,
    });
  }

  private spawnShockwave(
    x: number,
    y: number,
    maxRadiusNm: number,
    tone: ApproachCrtShockwave['tone'],
    duration: number
  ): void {
    this.crtShockwaves.push({ x, y, age: 0, duration, maxRadiusNm, tone });
  }

  private updatePopupsAndShockwaves(dt: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      this.popups[i].age += dt;
      if (this.popups[i].age >= this.popups[i].duration) {
        this.popups.splice(i, 1);
      }
    }
    for (let i = this.crtShockwaves.length - 1; i >= 0; i--) {
      this.crtShockwaves[i].age += dt;
      if (this.crtShockwaves[i].age >= this.crtShockwaves[i].duration) {
        this.crtShockwaves.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Active Gameplay Event & Departure Controls
  // ---------------------------------------------------------------------------

  /** Queues an outbound craft holding short at an active runway awaiting [CLEAR DEPARTURE]. */
  public queueDepartureNow(opts?: {
    kind?: 'DROPSHIP' | 'HEAVY';
    runway?: ActiveRunwayId;
    callsign?: string;
  }): DepartureQueueItem {
    const active = this.getActiveRunways();
    let chosenRwy: ActiveRunwayId;
    if (opts?.runway && this.isRunwayActive(opts.runway)) {
      chosenRwy = opts.runway;
    } else {
      const busyRunways = new Set(this.departureQueue.map((d) => d.runway));
      const free = active.filter((r) => !busyRunways.has(r));
      const pool = free.length > 0 ? free : active;
      chosenRwy = pool[this.nextDepartureId % pool.length];
    }

    const kind: 'DROPSHIP' | 'HEAVY' =
      opts?.kind ?? (this.nextDepartureId % 2 === 1 ? 'DROPSHIP' : 'HEAVY');
    const callsign = opts?.callsign ?? this.nextCallsign(kind);
    const item: DepartureQueueItem = {
      id: this.nextDepartureId++,
      callsign,
      kind,
      runway: chosenRwy,
      holdShortPos: { ...getRunwayHoldShortNm(chosenRwy) },
      departureHeadingDeg: getDepartureHeadingDeg(chosenRwy),
      waitSec: 0,
      maxWaitSec: APPROACH_CONSTANTS.DEPARTURE_MAX_WAIT_SEC,
      urgent: false,
    };
    this.departureQueue.push(item);
    this.pushLog('GROUND', `HOLD SHORT RWY ${chosenRwy}: ${callsign}`, 'cyan');
    return item;
  }

  /** Clears a queued departure for takeoff roll and climb-out (`depId` defaults to oldest queued). */
  public clearDeparture(depId?: number): ApproachAircraft | null {
    if (this.departureQueue.length === 0) return null;
    const idx =
      depId !== undefined ? this.departureQueue.findIndex((d) => d.id === depId) : 0;
    if (idx < 0) return null;

    const dep = this.departureQueue.splice(idx, 1)[0];
    const rwyStatus = this.getDepartureRunwayStatus(dep.runway);
    const th = getRunwayThresholdNm(dep.runway);
    const rwyHdg = getRunwayLandingHeadingDeg(dep.runway);
    const craft = this.createAircraft(dep.kind, { ...th }, rwyHdg, dep.callsign);
    craft.state = 'DEPARTING';
    craft.isDeparture = true;
    craft.departureRollSec = 0;
    craft.departureRunway = dep.runway;
    craft.gapLaunchEligible = rwyStatus.gapWindowActive && rwyStatus.clear;
    craft.hadConflictWhileDeparting = false;
    craft.altitudeFt = 0;
    craft.pingTimer = 2.0;
    this.aircraft.push(craft);

    const pan = clamp(th.x / Math.max(1, this.airspaceHalfWidthNm), -1, 1);
    this.audioCb.onDepartureCleared(craft.callsign, dep.runway, pan);
    this.setTxCaption(`T/O RWY ${dep.runway}: ${craft.callsign}`);
    this.pushLog('TOWER', `T/O RWY ${dep.runway}: ${craft.callsign}`, 'cyan');
    this.spawnPopup(
      th.x,
      th.y + 0.9,
      `T/O RWY ${dep.runway}`,
      craft.gapLaunchEligible ? `${craft.callsign} · GAP WINDOW` : craft.callsign,
      '#55ffee',
      1.5
    );
    return craft;
  }

  /** Initiates an authentic 10-second Runway Reversal wind-shift advisory countdown immediately. */
  public triggerRunwayFlipNow(): void {
    const nextPrimary: PrimaryRunwayId = this.primaryRunway === '27' ? '09' : '27';
    let nextSecondary: SecondaryRunwayId | null = null;

    if (this.secondaryRunwayOpen && this.activeSecondaryRunway !== null) {
      // Cycle smoothly through all 4 authentic quartering headwinds (305° -> 125° -> 235° -> 055°):
      // (27,36)->(09,18), (09,18)->(27,18), (27,18)->(09,36), (09,36)->(27,36)
      if (this.primaryRunway === '27' && this.activeSecondaryRunway === '36') {
        nextSecondary = '18';
      } else if (this.primaryRunway === '27' && this.activeSecondaryRunway === '18') {
        nextSecondary = '36';
      } else {
        nextSecondary = null; // secondary remains active while primary flips
      }
    }

    this.pendingPrimaryRunway = nextPrimary;
    this.pendingSecondaryRunway = nextSecondary;
    this.pendingRunway = nextPrimary;
    this.runwayFlipCountdownSec = APPROACH_CONSTANTS.RUNWAY_FLIP_WARNING_SEC;
    this.runwayFlipFlashTimer = APPROACH_CONSTANTS.RUNWAY_FLIP_WARNING_SEC;

    // P0 Fix: Fire audio advisory warning immediately at T-10s!
    this.audioCb.onRunwayFlipWarning(nextPrimary, nextSecondary);
    const label = nextSecondary ? `RWY ${nextPrimary}+${nextSecondary}` : `RWY ${nextPrimary}`;
    this.setTxCaption(`${label} ACTIVE IN 10S`);
    this.pushLog('ATIS', `${label} ACTIVE IN 10S`, 'amber');
  }

  /** Spawns a non-lethal drifting outer-corridor Ion Static cell with 3.0s visible ramp-in. */
  public spawnStormNow(pos?: Vec2): IonStormCell {
    const id = this.nextEntityId++;
    const num = this.nextStormNum++;

    // Pick a non-overlapping outer-corridor drift track (>= 6.5 NM clear of active storms)
    let chosenTrack = OUTER_STORM_TRACKS[(num - 1) % OUTER_STORM_TRACKS.length];
    if (!pos) {
      let bestTrack = chosenTrack;
      let bestMinDist = -1;
      for (let offset = 0; offset < OUTER_STORM_TRACKS.length; offset++) {
        const track = OUTER_STORM_TRACKS[(num - 1 + offset) % OUTER_STORM_TRACKS.length];
        let minD = 99;
        for (const existing of this.storms) {
          minD = Math.min(minD, distNm(track.x, track.y, existing.x, existing.y));
        }
        if (minD >= 6.5) {
          bestTrack = track;
          break;
        }
        if (minD > bestMinDist) {
          bestMinDist = minD;
          bestTrack = track;
        }
      }
      chosenTrack = bestTrack;
    }

    const sx = pos?.x ?? chosenTrack.x;
    const sy = pos?.y ?? chosenTrack.y;
    const radiusNm = 2.3;
    const contourScales: number[] = [];
    for (let k = 0; k < 12; k++) {
      contourScales.push(0.84 + 0.24 * Math.abs(Math.sin((num * 3.1 + k * 1.7) * 1.1)));
    }
    const storm: IonStormCell = {
      id,
      label: `ION-${String(num).padStart(2, '0')}`,
      x: sx,
      y: sy,
      vx: chosenTrack.vx,
      vy: chosenTrack.vy,
      radiusNm,
      coreRadiusNm: radiusNm * 0.56,
      intensity: 0,
      ageSec: 0,
      maxLifeSec: 24 + Math.random() * 4,
      contourScales,
    };
    this.storms.push(storm);
    this.pushLog('WX', `ION STATIC ${storm.label} — COMMS JAM (NO DMG)`, 'cyan');

    if (this.phase === 'ACTIVE_SHIFT' && !this.trainingMode) {
      this.audioCb.onIonStormSpawn?.(storm);
      if (!this.firstIonStormSpawned) {
        this.firstIonStormSpawned = true;
        this.onFirstIonStorm?.(storm);
        this.audioCb.onFirstIonStorm?.(storm);
      }
    }

    return storm;
  }

  /**
   * Computes the minimum R-118-safe flight distance (minus 0.72 NM flare capture)
   * from `fromPos` to any currently open landing zone (Pad Alpha, active runways, Salvage Cradle).
   */
  private computeMinSafeDistanceToOpenZoneNm(fromPos: Vec2): number {
    const openTargets: Vec2[] = [
      AIRFIELD_GEOMETRY.padAlpha.pos,
      AIRFIELD_GEOMETRY.salvageCradle.pos,
      ...this.getActiveRunways().map((rwy) => getRunwayThresholdNm(rwy)),
    ];

    const moa = AIRFIELD_GEOMETRY.restrictedZone;
    const detourCorners: Vec2[] = moa.vertices.map((v) => {
      const dx = v.x - moa.center.x;
      const dy = v.y - moa.center.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: v.x + (dx / len) * 1.25, y: v.y + (dy / len) * 1.25 };
    });

    let minSafeDist = Infinity;
    for (const target of openTargets) {
      const directDist = distNm(fromPos.x, fromPos.y, target.x, target.y);
      let safeLegDist = directDist;
      if (segmentNearRestrictedZone(fromPos, target, 0.35)) {
        let bestDetour = directDist + 3.5;
        for (const corner of detourCorners) {
          if (
            !segmentIntersectsRestrictedZone(fromPos, corner) &&
            !segmentIntersectsRestrictedZone(corner, target)
          ) {
            const d =
              distNm(fromPos.x, fromPos.y, corner.x, corner.y) +
              distNm(corner.x, corner.y, target.x, target.y);
            if (d < bestDetour) bestDetour = d;
          }
        }
        safeLegDist = bestDetour;
      }
      const captureAdjusted = Math.max(0, safeLegDist - 0.72);
      if (captureAdjusted < minSafeDist) {
        minSafeDist = captureAdjusted;
      }
    }
    return Number.isFinite(minSafeDist) ? minSafeDist : 12.0;
  }

  /** Spawns a high-priority MAYDAY emergency pod with dynamic R-118-safe BINGO fuel. */
  public spawnMaydayNow(spawnPos?: Vec2): ApproachAircraft {
    let spawn: { pos: Vec2; headingDeg: number };
    if (spawnPos) {
      const posCopy: Vec2 = { x: spawnPos.x, y: spawnPos.y };
      const safeHdg =
        this.pickSafeInboundHeading(posCopy, 2.0) ?? vecToHeadingDeg(-posCopy.x, -posCopy.y);
      spawn = { pos: posCopy, headingDeg: safeHdg };
    } else {
      spawn = this.pickSafePerimeterSpawn('MAYDAY');
    }
    const prof = AIRCRAFT_PROFILES.MAYDAY;
    const minDistToOpenZoneNm = this.computeMinSafeDistanceToOpenZoneNm(spawn.pos);
    const initialFuel = Math.ceil(
      Math.max(30, (minDistToOpenZoneNm / prof.speedNmPerSec) * 1.65)
    );
    const craft = this.createAircraft('MAYDAY', spawn.pos, spawn.headingDeg, undefined, initialFuel);
    this.aircraft.push(craft);
    this.audioCb.onMaydayBingo(craft.callsign, true);
    this.setTxCaption(`${craft.callsign}: MAYDAY! BINGO FUEL!`);
    this.pushLog(craft.callsign, `${craft.callsign}: BINGO (${initialFuel}S)!`, 'red');
    this.spawnShockwave(craft.x, craft.y, 4.0, 'red', 0.85);
    return craft;
  }

  /** Spawns a MEDEVAC PRIORITY Dropship (normal 115s fuel, lands PAD α or ANY active RWY, 25s +800 express timer). */
  public spawnMedevacNow(spawnPos?: Vec2): ApproachAircraft {
    let spawn: { pos: Vec2; headingDeg: number };
    if (spawnPos) {
      const posCopy: Vec2 = { x: spawnPos.x, y: spawnPos.y };
      const safeHdg =
        this.pickSafeInboundHeading(posCopy, 2.0) ?? vecToHeadingDeg(-posCopy.x, -posCopy.y);
      spawn = { pos: posCopy, headingDeg: safeHdg };
    } else {
      spawn = this.pickSafePerimeterSpawn('DROPSHIP');
    }

    const used = new Set(this.aircraft.map((c) => c.callsign));
    const callsign =
      MEDEVAC_CALLSIGNS.find((cs) => !used.has(cs)) ?? `MEDEVAC-${this.nextEntityId}`;
    const craft = this.createAircraft('DROPSHIP', spawn.pos, spawn.headingDeg, callsign);
    craft.isMedevac = true;
    craft.medevacExpressTimerSec = APPROACH_CONSTANTS.MEDEVAC_EXPRESS_TIMER_SEC;
    craft.pingTimer = 3.0;
    this.aircraft.push(craft);

    const sector = posToCompassSector(craft.x, craft.y);
    this.audioCb.onCheckin('DROPSHIP', this.primaryRunway, craft.callsign, {
      sector,
      isMedevac: true,
      force: true,
    });
    this.setTxCaption(`${craft.callsign}: ${sector}, PRIORITY INBOUND`);
    this.pushLog(
      craft.callsign,
      `${craft.callsign}: ${sector}, MEDEVAC PRIORITY — PAD α / ANY RWY (25S)`,
      'cyan'
    );
    this.spawnShockwave(craft.x, craft.y, 3.4, 'green', 0.75);
    return craft;
  }

  /**
   * Spawns a 2-Ship Dropship Element (`<CALLSIGN>-1` and `<CALLSIGN>-2`) on parallel inbound
   * headings spaced 3.6 NM laterally apart, both clear of R-118 and > 3.2 NM from existing traffic.
   */
  public spawnTwoShipElementNow(): ApproachAircraft[] {
    const halfW = Math.max(8, Math.min(this.airspaceHalfWidthNm - 1.1, 18.0));
    const halfH = Math.max(8, this.airspaceHalfHeightNm - 1.1);
    const lateralSpacingNm = 3.6;

    const isClearOfTraffic = (p: Vec2): boolean => {
      for (const c of this.aircraft) {
        if (distNm(p.x, p.y, c.x, c.y) <= 3.2) return false;
      }
      for (const b of this.bogeys) {
        if (distNm(p.x, p.y, b.x, b.y) <= 3.2) return false;
      }
      return true;
    };

    let pair: { leadPos: Vec2; wingPos: Vec2; headingDeg: number } | null = null;
    for (let attempt = 0; attempt < 24; attempt++) {
      const lead = this.pickSafePerimeterSpawn('DROPSHIP');
      if (!isClearOfTraffic(lead.pos)) continue;

      const right = headingDegToUnitVec(lead.headingDeg + 90);
      for (const sign of [1, -1]) {
        const wingPos: Vec2 = {
          x: lead.pos.x + right.x * lateralSpacingNm * sign,
          y: lead.pos.y + right.y * lateralSpacingNm * sign,
        };
        if (Math.abs(wingPos.x) > halfW + 0.5 || Math.abs(wingPos.y) > halfH + 0.5) continue;
        if (distanceToRestrictedZoneNm(wingPos.x, wingPos.y) < 2.8) continue;
        if (!this.isSpawnRayClearOfRestrictedZone(wingPos, lead.headingDeg, 2.0)) continue;
        if (!isClearOfTraffic(wingPos)) continue;
        pair = { leadPos: lead.pos, wingPos, headingDeg: lead.headingDeg };
        break;
      }
      if (pair) break;
    }

    if (!pair) {
      // Deterministic safe NE corridor fallback (3.6 NM lateral separation, far from R-118)
      const hdg = 225;
      const right = headingDegToUnitVec(hdg + 90);
      const leadPos: Vec2 = { x: Math.min(halfW - 1.5, 13.0), y: Math.min(halfH - 1.5, 12.2) };
      const wingPos: Vec2 = {
        x: leadPos.x - right.x * lateralSpacingNm,
        y: leadPos.y - right.y * lateralSpacingNm,
      };
      pair = { leadPos, wingPos, headingDeg: hdg };
    }

    const used = new Set(this.aircraft.map((c) => c.callsign));
    let base: string = TWO_SHIP_ELEMENT_BASES[this.nextEntityId % TWO_SHIP_ELEMENT_BASES.length];
    for (const cand of TWO_SHIP_ELEMENT_BASES) {
      if (!used.has(`${cand}-1`) && !used.has(`${cand}-2`)) {
        base = cand;
        break;
      }
    }
    const cs1 = !used.has(`${base}-1`) ? `${base}-1` : `${base}${this.nextEntityId}-1`;
    const cs2 = !used.has(`${base}-2`) ? `${base}-2` : `${base}${this.nextEntityId}-2`;

    const leadCraft = this.createAircraft('DROPSHIP', pair.leadPos, pair.headingDeg, cs1);
    const wingCraft = this.createAircraft('DROPSHIP', pair.wingPos, pair.headingDeg, cs2);
    this.aircraft.push(leadCraft, wingCraft);

    const sector = posToCompassSector(leadCraft.x, leadCraft.y);
    this.audioCb.onCheckin('DROPSHIP', this.primaryRunway, leadCraft.callsign, {
      sector,
      isTwoShip: true,
    });
    this.setTxCaption(`${base} FLIGHT (2-SHIP): ${sector}, INBOUND PAD α`);
    this.pushLog(
      leadCraft.callsign,
      `${leadCraft.callsign} & ${wingCraft.callsign}: ${sector}, 2-SHIP INBOUND PAD α`,
      'green'
    );
    return [leadCraft, wingCraft];
  }

  /** Spawns an uncontrollable Primary-Only Bogey along verified outer-approach crossing lanes. */
  public spawnBogeyNow(spawnPos?: Vec2, explicitHeadingDeg?: number): PrimaryBogey {
    const id = this.nextEntityId++;
    const num = this.nextBogeyNum++;
    const lane = OUTER_BOGEY_LANES[(num - 1) % OUTER_BOGEY_LANES.length];
    const maxX = Math.max(10, this.airspaceHalfWidthNm - 0.8);
    const maxY = Math.max(10, this.airspaceHalfHeightNm - 0.8);
    const laneStart: Vec2 = {
      x: clamp(lane.start.x, -maxX, maxX),
      y: clamp(lane.start.y, -maxY, maxY),
    };
    const start: Vec2 =
      spawnPos && distanceToRestrictedZoneNm(spawnPos.x, spawnPos.y) >= 1.0
        ? { x: spawnPos.x, y: spawnPos.y }
        : laneStart;
    const defaultHeading = vecToHeadingDeg(lane.end.x - start.x, lane.end.y - start.y);
    const headingDeg =
      explicitHeadingDeg ??
      (this.isSpawnRayClearOfRestrictedZone(start, defaultHeading, 2.0)
        ? defaultHeading
        : (this.pickSafeInboundHeading(start, 2.0) ?? defaultHeading));
    const speedKt = 175;
    const bogey: PrimaryBogey = {
      id,
      trackCode: `PRIM-${String(num).padStart(2, '0')}`,
      x: start.x,
      y: start.y,
      headingDeg: normalizeHeadingDeg(headingDeg),
      speedKt,
      speedNmPerSec: speedKt * APPROACH_CONSTANTS.KT_TO_NM_PER_SEC,
      trail: [{ ...start }],
      inConflict: false,
      ageSec: 0,
      sweptHighlight: 1.0,
    };
    this.bogeys.push(bogey);
    this.pushLog('RADAR', `${bogey.trackCode} — NO XPDR BOGEY`, 'amber');
    if (this.phase === 'ACTIVE_SHIFT' && !this.trainingMode) {
      this.audioCb.onBogeySpawn?.(bogey);
    }
    return bogey;
  }
}

export { SHIFT_PHASES };
