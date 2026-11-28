import { PHYSICS } from '../constants';
import type { LanderState, LandingGrade, SectorConfig, Vec2 } from '../types';

export interface LandingEnvelopeResult {
  safeBoundM: number;
  kissBoundM: number;
  vsGo: boolean;
  vsKiss: boolean;
  vsFatal: boolean;
  hsGo: boolean;
  hsKiss: boolean;
  hsFatal: boolean;
  attGo: boolean;
  attKiss: boolean;
  attFatal: boolean;
  inSafeAlign: boolean;
  inKissAlign: boolean;
  allGo: boolean;
  allKiss: boolean;
  anyFatal: boolean;
  grade: LandingGrade;
}

/**
 * Single authoritative landing & Soft-Kiss envelope evaluator shared by PhysicsEngine,
 * Desktop HUD, Mobile HUD, and Scoring so GO / CAUTION / NO-GO / SOFT KISS criteria
 * can NEVER disagree between physics and display.
 */
export function evaluateLandingEnvelope(
  vs: number,
  hs: number,
  deg: number,
  offsetM: number,
  padHalfW: number
): LandingEnvelopeResult {
  const safeHalfW = Math.max(1, padHalfW);
  const safeBoundM = Math.max(1.0, safeHalfW - PHYSICS.STRUT_SPAN_HALF_X + 0.85);
  const kissBoundM = Math.min(safeHalfW * PHYSICS.KISS_CENTER_RATIO, safeBoundM);

  const vsGo = vs <= PHYSICS.SAFE_VS_MAX;
  const vsKiss = vs <= PHYSICS.KISS_VS_MAX;
  const vsFatal = vs > PHYSICS.SURVIVAL_VS_MAX;

  const hsGo = hs <= PHYSICS.SAFE_HS_MAX;
  const hsKiss = hs <= PHYSICS.KISS_HS_MAX;
  const hsFatal = hs > PHYSICS.SURVIVAL_HS_MAX;

  const attGo = deg <= PHYSICS.SAFE_ANGLE_DEG;
  const attKiss = deg <= PHYSICS.KISS_ANGLE_DEG;
  const attFatal = deg > PHYSICS.SURVIVAL_ANGLE_DEG;

  const absOffset = Math.abs(offsetM);
  const inSafeAlign = absOffset <= safeBoundM;
  const inKissAlign = absOffset <= kissBoundM;

  const allGo = vsGo && hsGo && attGo && inSafeAlign;
  const allKiss = vsKiss && hsKiss && attKiss && inKissAlign;
  const anyFatal = vsFatal || hsFatal || attFatal;

  let grade: LandingGrade = 'NOMINAL_SAFE';
  if (anyFatal || !inSafeAlign) {
    grade = 'CATASTROPHIC';
  } else if (!vsGo || !hsGo || !attGo) {
    grade = 'HARD_SURVIVAL';
  } else if (allKiss) {
    grade = 'SOFT_KISS';
  }

  return {
    safeBoundM,
    kissBoundM,
    vsGo,
    vsKiss,
    vsFatal,
    hsGo,
    hsKiss,
    hsFatal,
    attGo,
    attKiss,
    attFatal,
    inSafeAlign,
    inKissAlign,
    allGo,
    allKiss,
    anyFatal,
    grade,
  };
}

export type AlertSeverity = 'OFF' | 'CAUTION' | 'CRITICAL';

export interface LanderAvionicsSnapshot {
  active: boolean;
  /** True when trajectory intersects a forward cliff/wall or overhead cavern ceiling within lookahead */
  obstacleCrit: boolean;
  /** True when floor stopping-distance / TTI indicates imminent fatal terrain impact */
  pullUpCrit: boolean;
  sinkState: AlertSeverity;
  bankState: AlertSeverity;
  driftState: AlertSeverity;
  fuelState: AlertSeverity;
  windState: AlertSeverity;
  windIsThermalOnly: boolean;
  windIsShear: boolean;
  windMagMps: number;
  windKnots: number;
  emActive: boolean;
  /** Exact vertical stopping distance in meters at full nominal thrust */
  stopDistM: number;
  /** Live estimated vertical time-to-impact in seconds */
  ttiSec: number;
  /** Prioritized alert list for mobile pill, audio beep cadence, and voice callouts */
  alerts: Array<{
    id: 'obstacle' | 'pull-up' | 'sink' | 'bank' | 'drift' | 'wind' | 'fuel' | 'em';
    text: string;
    critical: boolean;
  }>;
}

function samplePolylineYFast(poly: Vec2[], x: number): number | null {
  if (poly.length === 0) return null;
  if (x <= poly[0].x) return poly[0].y;
  if (x >= poly[poly.length - 1].x) return poly[poly.length - 1].y;
  let lo = 0;
  let hi = poly.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const a = poly[mid];
    const b = poly[mid + 1];
    if (x < a.x) hi = mid - 1;
    else if (x > b.x) lo = mid + 1;
    else {
      const span = b.x - a.x;
      if (span <= 1e-5) return a.y;
      return a.y + ((b.y - a.y) * (x - a.x)) / span;
    }
  }
  return poly[0].y;
}

function isXOverAnyPad(sector: SectorConfig, x: number): boolean {
  for (let i = 0; i < sector.pads.length; i++) {
    const p = sector.pads[i];
    if (x >= p.x1 - 1.5 && x <= p.x2 + 1.5) return true;
  }
  return false;
}

/**
 * Single physics-grounded avionics warning evaluator shared by:
 * - Desktop Nostromo 7-lamp Annunciator Strip
 * - Mobile Warning Pill
 * - Audio indicator beeps & GPWS voice callouts
 *
 * Designed so aggressive high-altitude maneuvering NEVER triggers nuisance alerts,
 * while genuine terrain/cliff/ceiling collisions, fatal approach states, and real
 * crosswinds/shears fire early enough to take corrective action.
 */
export function evaluateLanderAvionics(
  lander: LanderState,
  sector: SectorConfig | null,
  emBlackoutActive = false
): LanderAvionicsSnapshot {
  const windMagMps = Math.hypot(lander.currentWindVx, lander.currentWindVy);
  const windKnots = windMagMps * 1.94384;
  const active = lander.alive && lander.groundedPad === null;

  if (!active) {
    return {
      active: false,
      obstacleCrit: false,
      pullUpCrit: false,
      sinkState: 'OFF',
      bankState: 'OFF',
      driftState: 'OFF',
      fuelState: 'OFF',
      windState: 'OFF',
      windIsThermalOnly: false,
      windIsShear: false,
      windMagMps,
      windKnots,
      emActive: false,
      stopDistM: 0,
      ttiSec: Infinity,
      alerts: [],
    };
  }

  const vs = Math.max(0, -lander.vel.y);
  const hs = Math.abs(lander.vel.x);
  const absPitchDeg = Math.abs((lander.angle * 180) / Math.PI);
  const totalMass = lander.dryMassKg + lander.fuelKg;
  const grav = sector ? sector.gravity : 1.62;
  const maxNetUpAccel = Math.max(0.8, PHYSICS.MAIN_THRUST_N / Math.max(200, totalMass) - grav);
  const stopDistM = vs > 0.2 ? (vs * vs) / (2 * maxNetUpAccel) : 0;
  const ttiSec = vs > 0.25 ? lander.agl / vs : Infinity;

  // 1. GPWS OBSTACLE: Overhead cavern ceiling OR forward lateral rock cliff/ridge lookahead
  let obstacleCrit = lander.ceilingClearance < 11 && lander.vel.y > 0.9;
  if (!obstacleCrit && sector) {
    const horizSpeed = Math.abs(lander.vel.x);
    const speedMag = Math.hypot(lander.vel.x, lander.vel.y);
    if (speedMag > 2.2) {
      const lookaheadTimes = [0.45, 0.95, 1.5];
      for (const t of lookaheadTimes) {
        const fx = Math.max(0, Math.min(sector.worldWidth, lander.pos.x + lander.vel.x * t));
        const fy = lander.pos.y + lander.vel.y * t - 0.5 * grav * t * t * (lander.throttle < 0.2 ? 0.5 : 0);

        // Overhead ceiling intercept
        if (sector.ceiling && lander.vel.y > 0.6) {
          const ceilY = samplePolylineYFast(sector.ceiling, fx);
          if (ceilY !== null && fy + PHYSICS.HULL_TOP_Y + 2.5 >= ceilY) {
            obstacleCrit = true;
            break;
          }
        }

        // Forward rock ridge / canyon cliff wall intercept (ignore calm vertical approach over a landing pad!)
        if (horizSpeed > 2.6) {
          const floorY = samplePolylineYFast(sector.terrain, fx);
          if (floorY !== null && fy + PHYSICS.STRUT_REST_BOTTOM_Y <= floorY + 1.5) {
            const overPad = isXOverAnyPad(sector, fx);
            const safePadApproach = overPad && hs <= PHYSICS.SAFE_HS_MAX && vs <= PHYSICS.SAFE_VS_MAX;
            if (!safePadApproach) {
              // Confirm it's lateral/cliff impact (terrain rising ahead or significant forward speed)
              const curFloorY = samplePolylineYFast(sector.terrain, lander.pos.x) ?? floorY;
              const risingWall = floorY > curFloorY + 4.5;
              const fastLowSkim = lander.agl < 26 && horizSpeed > PHYSICS.SURVIVAL_HS_MAX * 1.15;
              if (risingWall || fastLowSkim) {
                obstacleCrit = true;
                break;
              }
            }
          }
        }
      }
    }
  }

  // 2. GPWS PULL UP: Physics stopping-distance & TTI check for imminent fatal vertical ground impact
  const pullUpCrit =
    vs > PHYSICS.SURVIVAL_VS_MAX &&
    ((lander.agl <= stopDistM * 1.45 + 5.5 && lander.agl < 85) ||
      (lander.agl < 32 && ttiSec <= 2.3));

  // 3. SINK RATE: Direct match to SAFE_VS_MAX (2.2) / SURVIVAL_VS_MAX (3.8) in descent zone
  let sinkState: AlertSeverity = 'OFF';
  if (lander.agl < 26 && vs > PHYSICS.SURVIVAL_VS_MAX && lander.throttle < 0.92) {
    sinkState = 'CRITICAL';
  } else if (lander.agl < 48 && vs > PHYSICS.SAFE_VS_MAX && lander.throttle < 0.8) {
    sinkState = 'CAUTION';
  }

  // 4. BANK ANGLE: Zero nuisance alerts during aggressive high-altitude flying;
  //    strictly tied to landing attitude limits (< 42m AGL) or near-inverted tumble (< 110m AGL)
  let bankState: AlertSeverity = 'OFF';
  if (
    (lander.agl < 18 && absPitchDeg > PHYSICS.SURVIVAL_ANGLE_DEG) ||
    (lander.agl < 34 && absPitchDeg > 45.0)
  ) {
    bankState = 'CRITICAL';
  } else if (
    (lander.agl < 38 && absPitchDeg > PHYSICS.SURVIVAL_ANGLE_DEG) ||
    (lander.agl < 16 && absPitchDeg > PHYSICS.SAFE_ANGLE_DEG) ||
    (lander.agl < 110 && absPitchDeg > 95.0)
  ) {
    bankState = 'CAUTION';
  }

  // 5. LATERAL DRIFT: Zero nuisance alerts up high; strictly tied to SAFE_HS_MAX (1.9) / SURVIVAL_HS_MAX (3.0) on approach
  let driftState: AlertSeverity = 'OFF';
  if (lander.agl < 18 && hs > PHYSICS.SURVIVAL_HS_MAX) {
    driftState = 'CRITICAL';
  } else if (lander.agl < 36 && hs > PHYSICS.SAFE_HS_MAX) {
    driftState = 'CAUTION';
  }

  // 6. FUEL
  const fuelRatio = lander.fuelKg / Math.max(1, lander.maxFuelKg);
  let fuelState: AlertSeverity = 'OFF';
  if (lander.fuelKg <= 15 || fuelRatio <= 0.08) {
    fuelState = 'CRITICAL';
  } else if (fuelRatio <= 0.2) {
    fuelState = 'CAUTION';
  }

  // 7. WIND / SHEAR / THERMAL: Based on ACTUAL live wind speed + shear layer + thermal updraft!
  const windIsShear = lander.inWindShear && windMagMps >= PHYSICS.WIND_CAUTION_MPS;
  const windIsThermalOnly = lander.inThermalUpdraft && windMagMps < PHYSICS.WIND_CAUTION_MPS && !windIsShear;
  let windState: AlertSeverity = 'OFF';
  if (windMagMps >= PHYSICS.WIND_CRITICAL_MPS || windIsShear) {
    windState = 'CRITICAL';
  } else if (windMagMps >= PHYSICS.WIND_CAUTION_MPS || lander.inThermalUpdraft) {
    windState = 'CAUTION';
  }

  const emActive = emBlackoutActive;

  // Prioritized alert queue (most urgent first)
  const alerts: LanderAvionicsSnapshot['alerts'] = [];
  if (obstacleCrit) {
    alerts.push({ id: 'obstacle', text: 'OBSTACLE', critical: true });
  }
  if (pullUpCrit) {
    alerts.push({ id: 'pull-up', text: 'PULL UP', critical: true });
  } else if (sinkState === 'CRITICAL') {
    alerts.push({ id: 'sink', text: 'SINK RATE', critical: true });
  } else if (sinkState === 'CAUTION') {
    alerts.push({ id: 'sink', text: 'DESCENT RATE', critical: false });
  }
  if (bankState !== 'OFF') {
    alerts.push({ id: 'bank', text: 'BANK ANGLE', critical: bankState === 'CRITICAL' });
  }
  if (driftState !== 'OFF') {
    alerts.push({ id: 'drift', text: 'LATERAL DRIFT', critical: driftState === 'CRITICAL' });
  }
  if (fuelState !== 'OFF') {
    alerts.push({ id: 'fuel', text: 'LOW FUEL', critical: fuelState === 'CRITICAL' });
  }
  if (windState !== 'OFF') {
    alerts.push({
      id: 'wind',
      text: windIsThermalOnly
        ? 'THERMAL UPDRAFT'
        : windIsShear
          ? 'WIND SHEAR'
          : windState === 'CRITICAL'
            ? `GALE ${Math.round(windKnots)}KT`
            : `CROSSWIND ${Math.round(windKnots)}KT`,
      critical: windState === 'CRITICAL',
    });
  }
  if (emActive) {
    alerts.push({ id: 'em', text: 'EM BLACKOUT // PING RADAR', critical: false });
  }

  return {
    active: true,
    obstacleCrit,
    pullUpCrit,
    sinkState,
    bankState,
    driftState,
    fuelState,
    windState,
    windIsThermalOnly,
    windIsShear,
    windMagMps,
    windKnots,
    emActive,
    stopDistM,
    ttiSec,
    alerts,
  };
}
