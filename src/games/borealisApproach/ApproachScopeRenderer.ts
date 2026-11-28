import {
  drawCornerBrackets,
  drawEllipsizedText,
  font,
  SEMIOTIC_ICONS,
  THEME,
} from '../../render/chrome';
import { isCrt1979Typography } from '../../render/theme';
import type { Vec2, ViewportRect } from '../../types';
import type { ApproachTutorialOverlayState } from './ApproachHudRenderer';
import type { ApproachSimulation } from './ApproachSimulation';
import {
  AIRFIELD_GEOMETRY,
  APPROACH_CONSTANTS,
  HOLD_ALTITUDE_SLOTS_FT,
  getRunwayFafNm,
  getRunwayIlsLengthNm,
  getRunwayIlsOuterNm,
  getRunwayOutwardUnitVec,
  getRunwayThresholdNm,
  headingDegToUnitVec,
  type ActiveRunwayId,
  type ApproachAircraft,
  type DepartureQueueItem,
  type HoldingFixDef,
  type IonStormCell,
  type PrimaryBogey,
  type VectorPreviewResult,
} from './types';

export interface ApproachScopeProjection {
  cx: number;
  cy: number;
  radiusPx: number;
  pxPerNm: number;
  halfWidthNm: number;
  halfHeightNm: number;
  viewport: ViewportRect;
}

export interface ApproachDragVisualState {
  craftId: number;
  rawWaypointsNm: readonly Vec2[];
  preview: VectorPreviewResult | null;
  cursorNm: Vec2 | null;
}

export interface ApproachScopeRenderParams {
  sim: ApproachSimulation;
  viewport: ViewportRect;
  timeSec: number;
  hoveredCraftId?: number | null;
  selectedCraftId?: number | null;
  dragState?: ApproachDragVisualState | null;
  cursorNm?: Vec2 | null;
  cursorInsideScope?: boolean;
  tutorialState?: ApproachTutorialOverlayState | null;
}

interface PlacedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Computes the expanded full-rectangular PPI radar scope projection fitted inside `viewport`.
 * The 15 NM vertical reference ring fills top-to-bottom cleanly while horizontal airspace
 * expands across the full rectangular center panel width.
 */
export function computeApproachScopeProjection(viewport: ViewportRect): ApproachScopeProjection {
  const cx = viewport.x + viewport.width * 0.5;
  const cy = viewport.y + viewport.height * 0.5;
  const pxPerNm = Math.max(10, (viewport.height * 0.475) / APPROACH_CONSTANTS.SCOPE_RADIUS_NM);
  const radiusPx = APPROACH_CONSTANTS.SCOPE_RADIUS_NM * pxPerNm;
  const halfWidthNm = viewport.width / (2 * pxPerNm);
  const halfHeightNm = viewport.height / (2 * pxPerNm);
  return { cx, cy, radiusPx, pxPerNm, halfWidthNm, halfHeightNm, viewport };
}

/**
 * Converts geographic NM coordinates (+x=East, +y=North) into screen canvas pixels.
 */
export function nmToScreen(nmX: number, nmY: number, viewport: ViewportRect): Vec2 {
  const proj = computeApproachScopeProjection(viewport);
  return {
    x: proj.cx + nmX * proj.pxPerNm,
    y: proj.cy - nmY * proj.pxPerNm,
  };
}

/**
 * Converts screen canvas pixels into geographic NM coordinates (+x=East, +y=North),
 * plus radial distance from scope center and whether the point lies inside the rectangular scope.
 */
export function screenToNm(
  sx: number,
  sy: number,
  viewport: ViewportRect
): { x: number; y: number; distNm: number; inside: boolean } {
  const proj = computeApproachScopeProjection(viewport);
  const x = (sx - proj.cx) / Math.max(0.0001, proj.pxPerNm);
  const y = (proj.cy - sy) / Math.max(0.0001, proj.pxPerNm);
  const distNm = Math.hypot(x, y);
  const inside =
    sx >= viewport.x &&
    sx <= viewport.x + viewport.width &&
    sy >= viewport.y &&
    sy <= viewport.y + viewport.height;
  return { x, y, distNm, inside };
}

/** Converts magnetic heading (0°=N clockwise) into Canvas 2D polar angle (0=East, +CW). */
function magneticDegToCanvasRad(deg: number): number {
  return ((deg - 90) * Math.PI) / 180;
}

// Deterministic LV-118 Borealis Basin glacial crater & ridge topographic contours (in NM)
const BOREALIS_TOPO_CONTOURS: ReadonlyArray<ReadonlyArray<Vec2>> = [
  // Outer NW Borealis Basin glacial escarpment
  [
    { x: -16.4, y: 7.4 },
    { x: -13.8, y: 5.4 },
    { x: -11.6, y: 7.4 },
    { x: -9.8, y: 9.2 },
    { x: -7.1, y: 11.4 },
    { x: -4.2, y: 12.8 },
    { x: -1.1, y: 13.6 },
  ],
  [
    { x: -15.6, y: 4.2 },
    { x: -12.6, y: 3.1 },
    { x: -10.5, y: 5.5 },
    { x: -8.9, y: 7.8 },
    { x: -6.4, y: 9.8 },
    { x: -3.2, y: 11.4 },
  ],
  // SW basalt shelf ridge
  [
    { x: -15.8, y: -2.8 },
    { x: -12.8, y: -4.8 },
    { x: -10.4, y: -6.8 },
    { x: -7.6, y: -8.6 },
    { x: -4.8, y: -10.4 },
    { x: -1.9, y: -12.2 },
  ],
  [
    { x: -10.8, y: -3.6 },
    { x: -8.5, y: -5.4 },
    { x: -6.2, y: -7.0 },
    { x: -3.5, y: -8.6 },
  ],
  // NE cryo-mesa terrace
  [
    { x: 4.4, y: 12.8 },
    { x: 7.4, y: 10.6 },
    { x: 10.2, y: 8.2 },
    { x: 12.6, y: 5.8 },
    { x: 15.8, y: 3.6 },
  ],
  // SE basin rim contour
  [
    { x: 4.8, y: -12.6 },
    { x: 7.8, y: -10.2 },
    { x: 10.6, y: -7.8 },
    { x: 13.4, y: -4.8 },
    { x: 16.4, y: -2.6 },
  ],
  [
    { x: 3.6, y: -10.2 },
    { x: 6.4, y: -8.4 },
    { x: 9.2, y: -5.8 },
    { x: 12.2, y: -3.6 },
  ],
];

function rectOverlapArea(a: PlacedRect, b: PlacedRect): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}

/**
 * Center Full-Rectangular 1979 PPI Radar Scope Renderer for Program #5:
 * BOREALIS APPROACH // LV-118 RAPCON (v2.0).
 */
export class ApproachScopeRenderer {
  /** Per-craft direction-slot stability bias so ATC data blocks never jitter when contacts cross. */
  private lastBlockDir = new Map<number, number>();

  public getProjection(viewport: ViewportRect): ApproachScopeProjection {
    return computeApproachScopeProjection(viewport);
  }

  public nmToScreen(nmX: number, nmY: number, viewport: ViewportRect): Vec2 {
    return nmToScreen(nmX, nmY, viewport);
  }

  public screenToNm(
    sx: number,
    sy: number,
    viewport: ViewportRect
  ): { x: number; y: number; distNm: number; inside: boolean } {
    return screenToNm(sx, sy, viewport);
  }

  public render(ctx: CanvasRenderingContext2D, params: ApproachScopeRenderParams): void {
    const {
      sim,
      viewport,
      timeSec,
      hoveredCraftId = null,
      selectedCraftId = null,
      dragState = null,
      tutorialState = null,
    } = params;

    const proj = computeApproachScopeProjection(viewport);
    const shakeMag = sim.screenShake > 0.05 ? sim.screenShake * 5.2 : 0;
    const shakeX =
      shakeMag > 0 ? (Math.sin(timeSec * 78) + Math.cos(timeSec * 124)) * shakeMag * 0.5 : 0;
    const shakeY =
      shakeMag > 0 ? (Math.cos(timeSec * 91) - Math.sin(timeSec * 107)) * shakeMag * 0.5 : 0;

    const cx = proj.cx + shakeX;
    const cy = proj.cy + shakeY;
    const R = proj.radiusPx;
    const pxPerNm = proj.pxPerNm;
    const cornerR = Math.hypot(viewport.width * 0.5, viewport.height * 0.5) + 8;

    const toPt = (nmX: number, nmY: number): Vec2 => ({
      x: cx + nmX * pxPerNm,
      y: cy - nmY * pxPerNm,
    });

    const draggedCraft =
      dragState !== null ? sim.getAircraftById(dragState.craftId) ?? null : null;

    // Collect static airfield & alert label boxes so ATC data blocks NEVER occlude them!
    const staticObstacles: PlacedRect[] = [];
    if (tutorialState?.active && !tutorialState.graduated) {
      if (tutorialState.scoringBreakdown) {
        const cardW = Math.min(844, viewport.width - 24);
        const cardH = Math.min(486, viewport.height - 24);
        staticObstacles.push({
          x: Math.round(viewport.x + (viewport.width - cardW) * 0.5) - 6,
          y: Math.round(viewport.y + (viewport.height - cardH) * 0.5) - 6,
          w: cardW + 12,
          h: cardH + 12,
        });
      } else {
        const cardW = Math.min(780, viewport.width - 24);
        const cardEstH = tutorialState.showNextButton ? 142 : 114;
        staticObstacles.push({
          x: Math.round(viewport.x + (viewport.width - cardW) * 0.5) - 4,
          y: viewport.y + 4,
          w: cardW + 8,
          h: cardEstH,
        });
      }
    }

    ctx.save();
    // Clip to the ENTIRE rectangular center scope viewport (full tactical airspace!)
    ctx.beginPath();
    ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height);
    ctx.clip();

    // =========================================================================
    // 1. DEEP P39 RADIAL CATHODE PHOSPHOR GRADIENT FILLING FULL RECTANGLE
    // =========================================================================
    const ppiGrad = ctx.createRadialGradient(cx, cy, R * 0.04, cx, cy, cornerR);
    ppiGrad.addColorStop(0, '#071B0E');
    ppiGrad.addColorStop(0.56, '#041109');
    ppiGrad.addColorStop(0.86, '#020A05');
    ppiGrad.addColorStop(1, '#010503');
    ctx.fillStyle = ppiGrad;
    ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);

    // 1.2 LV-118 Borealis Basin Topographic Contour Arcs
    this.drawBorealisTopoContours(ctx, toPt);

    // 1.3 Rotating Phosphor Sweep Arm + Decaying ~38° Afterglow Wedge out to corners
    this.drawPhosphorSweep(ctx, cx, cy, cornerR, sim.radarSweepDeg);

    // 1.4 Range Rings (5 / 10 / 15 NM + subtle 20 NM arc) + 360° Compass Rose + Rectangular Bezel Ticks
    this.drawRangeRingsAndCompass(ctx, viewport, cx, cy, R, cornerR, pxPerNm, toPt);

    // 1.5 Restricted Live-Fire Airspace R-118 // HOT (MOA)
    this.drawRestrictedZone(ctx, sim, toPt, timeSec, dragState, tutorialState, staticObstacles);

    // 1.6 Airfield Infrastructure: Salvage Cradle, Pad Alpha, RWY 09/27 & RWY 36/18 + ILS + FAF, RNAV Fixes
    this.drawSalvageCradle(ctx, toPt, pxPerNm, timeSec, draggedCraft, dragState, staticObstacles);
    this.drawVtolPadAlpha(ctx, toPt, pxPerNm, timeSec, draggedCraft, dragState, staticObstacles);
    this.drawPrimaryRunwayAndIls(
      ctx,
      sim,
      toPt,
      pxPerNm,
      timeSec,
      draggedCraft,
      dragState,
      staticObstacles
    );
    if (sim.secondaryRunwayOpen || sim.pendingSecondaryRunway !== null) {
      this.drawSecondaryRunwayAndIls(
        ctx,
        sim,
        toPt,
        pxPerNm,
        timeSec,
        draggedCraft,
        dragState,
        staticObstacles
      );
    }
    this.drawHoldingFixes(ctx, sim, toPt, pxPerNm, timeSec, dragState, staticObstacles);

    // 1.7 Departure Hold-Short Queue Bars & Outbound Blips
    if (sim.departureQueue.length > 0) {
      this.drawDepartureHoldShorts(ctx, sim, toPt, timeSec, tutorialState, staticObstacles);
    }

    // 1.8 NEXRAD Convective Ion Storm Cells (INFO BRAVO+)
    for (const storm of sim.storms) {
      this.drawIonStormCell(ctx, storm, toPt, pxPerNm, timeSec, staticObstacles);
    }

    // 1.9 Expanding Radar Shockwave Rings (touchdowns, wind shifts, gold fumes saves, mishaps)
    this.drawShockwaveRings(ctx, sim, toPt, pxPerNm);

    // 1.10 Interactive Tutorial Scope Guides (pulsing rings + marching vector arrows)
    if (tutorialState?.active) {
      this.drawTutorialScopeGuides(
        ctx,
        tutorialState,
        viewport,
        toPt,
        pxPerNm,
        timeSec,
        staticObstacles
      );
    }

    // 1.11 Committed Vector Paths + Active Dragged Preview Path
    for (const craft of sim.aircraft) {
      if (dragState && dragState.craftId === craft.id) continue;
      this.drawCommittedVectorPath(ctx, craft, toPt, timeSec);
    }
    if (dragState && draggedCraft) {
      this.drawActiveDragVector(ctx, sim, draggedCraft, dragState, viewport, toPt, pxPerNm, timeSec);
    }

    // 1.12 Primary-Only Bogeys (INFO DELTA+)
    for (const bogey of sim.bogeys) {
      this.drawPrimaryBogey(ctx, bogey, toPt, timeSec, staticObstacles);
    }

    // 1.13 Aircraft Trails + Blips + Highlight Rings
    for (const craft of sim.aircraft) {
      const isDragged = dragState?.craftId === craft.id;
      const isHovered = hoveredCraftId === craft.id;
      const isSelected = selectedCraftId === craft.id;
      this.drawAircraftBlip(ctx, craft, toPt, pxPerNm, timeSec, isHovered, isSelected || isDragged);
    }

    // 1.14 Conflict Alert (CA) Flashing Red Rings & Connector Lines (< 3 NM)
    if (sim.conflictPairs.length > 0) {
      this.drawConflictAlerts(ctx, sim, toPt, pxPerNm, timeSec, staticObstacles);
    }

    // 1.15 Smart Non-Overlapping Tethered 2-Line ATC Data Blocks (2 rings, hysteresis, obstacle avoidance)
    const placedDataBlocks = this.drawAtcDataBlocks(
      ctx,
      sim,
      viewport,
      toPt,
      timeSec,
      hoveredCraftId,
      selectedCraftId,
      dragState?.craftId ?? null,
      staticObstacles
    );

    // 1.16 1.2s Slow-Mo Incident Freeze Spotlight (Collision / Fuel Flameout / R-118 MOA Breach)
    if (sim.incidentFreezeTimer > 0 && sim.incidentPos) {
      this.drawIncidentSpotlight(ctx, sim, viewport, toPt, pxPerNm, timeSec);
    }

    // 1.17 Floating Score & Status Popups (nudged clear of placed ATC Data Blocks!)
    this.drawPopups(ctx, sim, viewport, toPt, placedDataBlocks);

    // 1.18 Subtle Rectangular Rim Flash on Seal Breach or Runway Reversal
    if (sim.sealBreachFlashTimer > 0) {
      const a = Math.min(0.24, sim.sealBreachFlashTimer * 0.2);
      ctx.fillStyle = `rgba(255, 51, 24, ${a.toFixed(3)})`;
      ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
    } else if (sim.runwayFlipFlashTimer > 0 && sim.pendingRunway === null) {
      const a = Math.min(0.12, sim.runwayFlipFlashTimer * 0.055);
      ctx.fillStyle = `rgba(255, 176, 0, ${a.toFixed(3)})`;
      ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
    }

    // =========================================================================
    // 2. RECTANGULAR CRT BEZEL FRAME, CORNER STAMPS & ALERT BANNER
    // =========================================================================
    const anyRestricted = sim.aircraft.some((c) => c.inRestrictedZone);
    const bezelAccent =
      sim.sealBreachFlashTimer > 0 || anyRestricted
        ? THEME.ALERT_RED_STROKE
        : sim.conflictActive
          ? Math.sin(timeSec * 14) > 0
            ? THEME.ALERT_RED_STROKE
            : THEME.ACCENT_AMBER
          : sim.pendingRunway !== null
            ? THEME.ACCENT_AMBER
            : THEME.BORDER_SUBTLE;

    // Subtle recessed outer frame line
    ctx.strokeStyle = bezelAccent;
    ctx.lineWidth = sim.conflictActive || anyRestricted || sim.sealBreachFlashTimer > 0 ? 2.0 : 1.3;
    ctx.strokeRect(viewport.x + 0.5, viewport.y + 0.5, viewport.width - 1, viewport.height - 1);

    drawCornerBrackets(
      ctx,
      viewport.x + 2,
      viewport.y + 2,
      viewport.width - 4,
      viewport.height - 4,
      14,
      bezelAccent === THEME.BORDER_SUBTLE ? THEME.TEXT_PRIMARY : bezelAccent,
      2.0
    );

    // Corner scope telemetry stamps (crisp dark backing pills at the 4 corners)
    this.drawHousingCornerStamps(ctx, viewport, proj, sim);

    // Bottom-of-scope alert banner (R-118 Violation / Conflict Alert / Runway Reversal)
    this.drawScopeAlertBanner(ctx, viewport, cx, sim, timeSec);

    ctx.restore();
  }

  // ===========================================================================
  // RECTANGULAR SCOPE CORNER TELEMETRY STAMPS
  // ===========================================================================
  private drawHousingCornerStamps(
    ctx: CanvasRenderingContext2D,
    vp: ViewportRect,
    proj: ApproachScopeProjection,
    sim: ApproachSimulation
  ): void {
    ctx.save();
    ctx.font = font('micro', 12);
    ctx.textBaseline = 'middle';

    const drawStamp = (
      text: string,
      x: number,
      y: number,
      align: 'left' | 'right',
      color: string
    ): void => {
      const tw = ctx.measureText(text).width;
      const bx = align === 'left' ? x - 4 : x - tw - 4;
      ctx.fillStyle = 'rgba(2, 8, 5, 0.78)';
      ctx.fillRect(bx, y - 8, tw + 8, 16);
      ctx.textAlign = align;
      ctx.fillStyle = color;
      ctx.fillText(text, x, y + 0.5);
    };

    const spanNm = `${Math.round(proj.halfWidthNm * 2)}×${Math.round(proj.halfHeightNm * 2)} NM`;
    drawStamp(`ASR-9 PPI · ${spanNm}`, vp.x + 12, vp.y + 15, 'left', THEME.TEXT_SECONDARY);

    const anyRestricted = sim.aircraft.some((c) => c.inRestrictedZone);
    drawStamp(
      anyRestricted
        ? 'R-118 MOA HOT!'
        : sim.conflictActive
          ? `CA MIN ${sim.minSeparationNm.toFixed(1)}NM`
          : 'SEP MIN 3.0 NM',
      vp.x + vp.width - 12,
      vp.y + 15,
      'right',
      anyRestricted || sim.conflictActive ? THEME.ALERT_RED_TEXT : THEME.TEXT_SECONDARY
    );

    drawStamp('LV-118 BOREALIS', vp.x + 12, vp.y + vp.height - 14, 'left', THEME.TEXT_MUTED);
    drawStamp(
      `SWEEP ${String(Math.round(sim.radarSweepDeg)).padStart(3, '0')}°`,
      vp.x + vp.width - 12,
      vp.y + vp.height - 14,
      'right',
      THEME.TEXT_MUTED
    );

    ctx.restore();
  }

  // ===========================================================================
  // TOPOGRAPHY, SWEEP ARM, RANGE RINGS, COMPASS ROSE & RECTANGULAR BEZEL TICKS
  // ===========================================================================
  private drawBorealisTopoContours(
    ctx: CanvasRenderingContext2D,
    toPt: (x: number, y: number) => Vec2
  ): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(42, 134, 74, 0.16)';
    ctx.lineWidth = 1.1;
    ctx.setLineDash([6, 5]);
    for (const contour of BOREALIS_TOPO_CONTOURS) {
      if (contour.length < 2) continue;
      ctx.beginPath();
      const p0 = toPt(contour[0].x, contour[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < contour.length; i++) {
        const p = toPt(contour[i].x, contour[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawPhosphorSweep(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    sweepR: number,
    sweepDeg: number
  ): void {
    const headRad = magneticDegToCanvasRad(sweepDeg);
    const trailDeg = 38;
    const trailRad = (trailDeg * Math.PI) / 180;
    const steps = 18;

    ctx.save();
    for (let i = 0; i < steps; i++) {
      const f0 = i / steps;
      const f1 = (i + 1) / steps;
      const a0 = headRad - trailRad * (1 - f0);
      const a1 = headRad - trailRad * (1 - f1);
      const alpha = 0.005 + f1 * f1 * 0.15;
      ctx.fillStyle = `rgba(68, 255, 119, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, sweepR, a0, a1);
      ctx.closePath();
      ctx.fill();
    }

    // Bright leading phosphor sweep ray all the way to rectangular viewport edges
    ctx.strokeStyle = 'rgba(158, 247, 184, 0.68)';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(headRad) * sweepR, cy + Math.sin(headRad) * sweepR);
    ctx.stroke();
    ctx.restore();
  }

  private drawRangeRingsAndCompass(
    ctx: CanvasRenderingContext2D,
    vp: ViewportRect,
    cx: number,
    cy: number,
    R: number,
    cornerR: number,
    pxPerNm: number,
    toPt: (x: number, y: number) => Vec2
  ): void {
    ctx.save();

    // 1. Subtle Rectangular Bezel Edge Tick Marks along all 4 walls (2 NM intervals)
    ctx.strokeStyle = 'rgba(52, 168, 86, 0.30)';
    ctx.lineWidth = 1.0;
    const maxNmX = Math.floor(vp.width / (2 * pxPerNm));
    const maxNmY = Math.floor(vp.height / (2 * pxPerNm));
    ctx.beginPath();
    for (let nm = -maxNmX; nm <= maxNmX; nm += 2) {
      const sx = cx + nm * pxPerNm;
      const major = nm % 5 === 0 || nm === 0;
      const len = major ? 7 : 4;
      ctx.moveTo(sx, vp.y + 1);
      ctx.lineTo(sx, vp.y + 1 + len);
      ctx.moveTo(sx, vp.y + vp.height - 1);
      ctx.lineTo(sx, vp.y + vp.height - 1 - len);
    }
    for (let nm = -maxNmY; nm <= maxNmY; nm += 2) {
      const sy = cy - nm * pxPerNm;
      const major = nm % 5 === 0 || nm === 0;
      const len = major ? 7 : 4;
      ctx.moveTo(vp.x + 1, sy);
      ctx.lineTo(vp.x + 1 + len, sy);
      ctx.moveTo(vp.x + vp.width - 1, sy);
      ctx.lineTo(vp.x + vp.width - 1 - len, sy);
    }
    ctx.stroke();

    // 2. Subtle Radial Azimuth Guide Spokes every 30° out to viewport corners
    ctx.strokeStyle = 'rgba(28, 92, 49, 0.22)';
    ctx.lineWidth = 1.0;
    for (let deg = 0; deg < 360; deg += 30) {
      const rad = magneticDegToCanvasRad(deg);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(rad) * (pxPerNm * 2.2), cy + Math.sin(rad) * (pxPerNm * 2.2));
      ctx.lineTo(cx + Math.cos(rad) * cornerR, cy + Math.sin(rad) * cornerR);
      ctx.stroke();
    }

    // 3. Concentric 5 / 10 / 15 NM Range Rings + subtle 20 NM arc if visible inside rectangle
    for (const nm of [5, 10, 15, 20] as const) {
      const rr = nm * pxPerNm;
      if (nm === 20 && rr > cornerR) continue;
      ctx.strokeStyle =
        nm === 15
          ? 'rgba(68, 255, 119, 0.44)'
          : nm === 20
            ? 'rgba(52, 168, 86, 0.22)'
            : 'rgba(52, 168, 86, 0.34)';
      ctx.lineWidth = nm === 15 ? 1.4 : 1.15;
      ctx.setLineDash(nm === 5 ? [4, 4] : nm === 20 ? [8, 8] : []);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Crisp NM Ring Labels along South-Southeast clear radial
    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const nm of [5, 10, 15] as const) {
      const pt = toPt(0.45, -nm);
      if (pt.y > vp.y + vp.height - 26) continue;
      const lbl = `${nm}NM`;
      const tw = ctx.measureText(lbl).width;
      ctx.fillStyle = 'rgba(2, 9, 5, 0.78)';
      ctx.fillRect(pt.x - 3, pt.y - 8, tw + 6, 16);
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      ctx.fillText(lbl, pt.x, pt.y + 0.5);
    }

    // 4. 360° Compass Rose Azimuth Ticks around the 15 NM Reference Ring
    for (let deg = 0; deg < 360; deg += 10) {
      const rad = magneticDegToCanvasRad(deg);
      const isCardinal = deg % 90 === 0;
      const isMajor = deg % 30 === 0;
      const len = isCardinal ? 12 : isMajor ? 9 : 4.5;
      ctx.strokeStyle = isCardinal
        ? THEME.TEXT_PRIMARY
        : isMajor
          ? 'rgba(82, 184, 114, 0.72)'
          : 'rgba(42, 128, 68, 0.40)';
      ctx.lineWidth = isCardinal ? 1.9 : isMajor ? 1.3 : 1.0;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(rad) * R, cy + Math.sin(rad) * R);
      ctx.lineTo(cx + Math.cos(rad) * (R - len), cy + Math.sin(rad) * (R - len));
      ctx.stroke();

      if (isCardinal || (isMajor && R >= 245)) {
        const labelR = R - (isCardinal ? 23 : 21);
        const lx = cx + Math.cos(rad) * labelR;
        const ly = cy + Math.sin(rad) * labelR;
        if (
          lx > vp.x + 18 &&
          lx < vp.x + vp.width - 18 &&
          ly > vp.y + 16 &&
          ly < vp.y + vp.height - 16
        ) {
          const lbl = deg === 0 ? 'N' : String(deg).padStart(3, '0');
          ctx.font = isCardinal ? font('data', 12) : font('micro', 12);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = isCardinal ? THEME.TEXT_BRIGHT : 'rgba(82, 184, 114, 0.74)';
          ctx.fillText(lbl, lx, ly + 0.5);
        }
      }
    }

    ctx.restore();
  }

  // ===========================================================================
  // RESTRICTED LIVE-FIRE MOA: R-118 // HOT (SW AIRSPACE)
  // ===========================================================================
  private drawRestrictedZone(
    ctx: CanvasRenderingContext2D,
    sim: ApproachSimulation,
    toPt: (x: number, y: number) => Vec2,
    timeSec: number,
    dragState: ApproachDragVisualState | null,
    tutorialState: ApproachTutorialOverlayState | null,
    staticObstacles: PlacedRect[]
  ): void {
    const rz = AIRFIELD_GEOMETRY.restrictedZone;
    const verts = rz.vertices.map((v) => toPt(v.x, v.y));
    if (verts.length < 3) return;

    const anyCraftInside = sim.aircraft.some((c) => c.inRestrictedZone);
    const dragEnters = Boolean(dragState?.preview?.entersRestrictedZone);
    const tutHighlight = Boolean(tutorialState?.highlightRestrictedZone);
    const isAlert = anyCraftInside || dragEnters || tutHighlight;
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * (isAlert ? 11.0 : 3.2));

    let minX = verts[0].x;
    let maxX = verts[0].x;
    let minY = verts[0].y;
    let maxY = verts[0].y;
    for (const v of verts) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }

    const tracePolygon = (): void => {
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) {
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.closePath();
    };

    ctx.save();

    // 1. Clipped crimson/amber diagonal hazard hatching fill
    ctx.save();
    tracePolygon();
    ctx.fillStyle = isAlert
      ? `rgba(182, 24, 16, ${(0.22 + pulse * 0.18).toFixed(3)})`
      : `rgba(124, 24, 14, ${(0.12 + pulse * 0.05).toFixed(3)})`;
    ctx.fill();
    ctx.clip();

    const step = 11;
    const diagSpan = Math.max(maxX - minX, maxY - minY) + 40;
    ctx.strokeStyle = isAlert
      ? `rgba(255, 76, 48, ${(0.48 + pulse * 0.34).toFixed(3)})`
      : 'rgba(255, 118, 48, 0.28)';
    ctx.lineWidth = isAlert ? 1.6 : 1.2;
    ctx.beginPath();
    for (let d = -diagSpan; d <= diagSpan * 2; d += step) {
      ctx.moveTo(minX + d - diagSpan * 0.5, minY - 12);
      ctx.lineTo(minX + d + diagSpan * 0.5, maxY + 12);
    }
    ctx.stroke();
    ctx.restore();

    // 2. Double-line MOA boundary (outer solid crimson + inner dashed amber)
    tracePolygon();
    ctx.strokeStyle = isAlert
      ? pulse > 0.45
        ? '#FF6A52'
        : THEME.ALERT_RED_STROKE
      : 'rgba(255, 86, 56, 0.78)';
    ctx.lineWidth = isAlert ? 2.4 : 1.7;
    ctx.stroke();

    // Inner dashed warning contour inset slightly toward centroid
    const cPt = toPt(rz.center.x, rz.center.y);
    ctx.beginPath();
    for (let i = 0; i < verts.length; i++) {
      const vx = verts[i].x + (cPt.x - verts[i].x) * 0.08;
      const vy = verts[i].y + (cPt.y - verts[i].y) * 0.08;
      if (i === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
    ctx.strokeStyle = isAlert
      ? `rgba(255, 210, 96, ${(0.65 + pulse * 0.35).toFixed(3)})`
      : 'rgba(255, 176, 0, 0.48)';
    ctx.lineWidth = 1.1;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. Corner caution ticks at every vertex
    ctx.strokeStyle = isAlert ? '#FFE48F' : THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.6;
    for (const v of verts) {
      ctx.beginPath();
      ctx.moveTo(v.x - 4, v.y);
      ctx.lineTo(v.x + 4, v.y);
      ctx.moveTo(v.x, v.y - 4);
      ctx.lineTo(v.x, v.y + 4);
      ctx.stroke();
    }

    // 4. Bold `R-118 // HOT` / `NO-FLY` badge pill at zone centroid
    ctx.font = font('data', 12);
    const titleW = ctx.measureText(rz.label).width;
    const subTag = anyCraftInside ? 'VIOLATION!' : 'NO-FLY · MOA';
    ctx.font = font('micro', 12);
    const subW = ctx.measureText(subTag).width;
    const bw = Math.ceil(Math.max(titleW, subW)) + 16;
    const bh = 34;
    const bx = Math.round(cPt.x - bw * 0.5);
    const by = Math.round(cPt.y - bh * 0.5);

    ctx.fillStyle = isAlert
      ? pulse > 0.5
        ? 'rgba(128, 16, 10, 0.96)'
        : 'rgba(68, 12, 8, 0.94)'
      : 'rgba(42, 10, 8, 0.92)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = isAlert
      ? pulse > 0.5
        ? '#FF947D'
        : THEME.ALERT_RED_STROKE
      : 'rgba(255, 98, 71, 0.85)';
    ctx.lineWidth = isAlert ? 1.8 : 1.3;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font('data', 12);
    ctx.fillStyle = isAlert ? '#FFF0EC' : THEME.ALERT_RED_TEXT;
    ctx.fillText(rz.label, cPt.x, by + 11);

    ctx.font = font('micro', 12);
    ctx.fillStyle = anyCraftInside ? '#FFF0EC' : THEME.ACCENT_AMBER_HI;
    ctx.fillText(subTag, cPt.x, by + 25.5);

    staticObstacles.push({ x: bx - 4, y: by - 4, w: bw + 8, h: bh + 8 });
    ctx.restore();
  }

  // ===========================================================================
  // AIRFIELD: PRIMARY RWY 09/27 & SECONDARY CROSSWIND RWY 36/18 + ILS + FAF
  // ===========================================================================
  private drawPrimaryRunwayAndIls(
    ctx: CanvasRenderingContext2D,
    sim: ApproachSimulation,
    toPt: (x: number, y: number) => Vec2,
    pxPerNm: number,
    timeSec: number,
    draggedCraft: ApproachAircraft | null,
    dragState: ApproachDragVisualState | null,
    staticObstacles: PlacedRect[]
  ): void {
    const rwy = AIRFIELD_GEOMETRY.runway;
    const p09 = toPt(rwy.threshold09.x, rwy.threshold09.y);
    const p27 = toPt(rwy.threshold27.x, rwy.threshold27.y);
    const activeRwy = sim.primaryRunway;
    const pendingRwy = sim.pendingPrimaryRunway;

    const highlightActive = Boolean(
      draggedCraft &&
        (draggedCraft.kind === 'HEAVY' ||
          draggedCraft.kind === 'MAYDAY' ||
          draggedCraft.isMedevac)
    );
    const lockedPrimary =
      dragState?.preview?.snapKind === 'ILS_LOCK' &&
      (dragState.preview.lockedTarget === 'RWY_27' || dragState.preview.lockedTarget === 'RWY_09');

    // 1. Active Primary ILS Localizer Feather + 5 NM FAF Maltese Cross
    this.drawIlsLocalizerFeather(
      ctx,
      activeRwy,
      toPt,
      pxPerNm,
      timeSec,
      'active',
      highlightActive,
      lockedPrimary,
      null,
      sim.secondaryRunwayOpen,
      staticObstacles
    );

    // 2. Pending Primary Wind-Shift Reversal Advisory Feather (10s pulsing amber)
    if (pendingRwy !== null) {
      this.drawIlsLocalizerFeather(
        ctx,
        pendingRwy,
        toPt,
        pxPerNm,
        timeSec,
        'pending',
        false,
        false,
        sim.runwayFlipCountdownSec,
        sim.secondaryRunwayOpen,
        staticObstacles
      );
    }

    // 3. Physical Primary Runway 09/27 Paved Strip
    const rwyWpx = Math.max(9, rwy.widthNm * pxPerNm);
    const rx = Math.min(p09.x, p27.x);
    const ry = p09.y - rwyWpx * 0.5;
    const rw = Math.abs(p27.x - p09.x);

    ctx.save();
    ctx.fillStyle = 'rgba(4, 16, 9, 0.96)';
    ctx.fillRect(rx, ry, rw, rwyWpx);

    ctx.strokeStyle =
      pendingRwy !== null && Math.sin(timeSec * 10) > 0
        ? THEME.ACCENT_AMBER_HI
        : lockedPrimary
          ? '#9EF7B8'
          : THEME.TEXT_PRIMARY;
    ctx.lineWidth = lockedPrimary ? 2.2 : 1.6;
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rwyWpx - 1);

    // Dashed centerline
    ctx.strokeStyle = 'rgba(158, 247, 184, 0.72)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(rx + 8, p09.y);
    ctx.lineTo(rx + rw - 8, p09.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Piano-key threshold markings at both 09 and 27 ends
    ctx.fillStyle = activeRwy === '09' ? THEME.TEXT_BRIGHT : THEME.TEXT_SECONDARY;
    ctx.fillRect(rx + 2, ry + 2, 4, rwyWpx - 4);
    ctx.fillStyle = activeRwy === '27' ? THEME.TEXT_BRIGHT : THEME.TEXT_SECONDARY;
    ctx.fillRect(rx + rw - 6, ry + 2, 4, rwyWpx - 4);

    // Crisp `09` and `27` threshold labels
    ctx.font = font('micro', 12);
    ctx.textBaseline = 'middle';
    const tagY = ry - 11;

    ctx.textAlign = 'left';
    ctx.fillStyle =
      activeRwy === '09'
        ? THEME.TEXT_BRIGHT
        : pendingRwy === '09'
          ? THEME.ACCENT_AMBER_HI
          : THEME.TEXT_MUTED;
    ctx.fillText('09', rx, tagY);

    ctx.textAlign = 'right';
    ctx.fillStyle =
      activeRwy === '27'
        ? THEME.TEXT_BRIGHT
        : pendingRwy === '27'
          ? THEME.ACCENT_AMBER_HI
          : THEME.TEXT_MUTED;
    ctx.fillText('27', rx + rw, tagY);

    // Active landing direction arrow below strip
    const dirSign = activeRwy === '27' ? -1 : 1;
    const midX = (p09.x + p27.x) * 0.5;
    const arrowY = ry + rwyWpx + 10;
    ctx.strokeStyle = THEME.TEXT_PRIMARY;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(midX - dirSign * 14, arrowY);
    ctx.lineTo(midX + dirSign * 14, arrowY);
    ctx.lineTo(midX + dirSign * 8, arrowY - 4);
    ctx.moveTo(midX + dirSign * 14, arrowY);
    ctx.lineTo(midX + dirSign * 8, arrowY + 4);
    ctx.stroke();

    ctx.restore();
  }

  private drawSecondaryRunwayAndIls(
    ctx: CanvasRenderingContext2D,
    sim: ApproachSimulation,
    toPt: (x: number, y: number) => Vec2,
    pxPerNm: number,
    timeSec: number,
    draggedCraft: ApproachAircraft | null,
    dragState: ApproachDragVisualState | null,
    staticObstacles: PlacedRect[]
  ): void {
    const sec = AIRFIELD_GEOMETRY.secondaryRunway;
    const p36 = toPt(sec.threshold36.x, sec.threshold36.y);
    const p18 = toPt(sec.threshold18.x, sec.threshold18.y);
    const activeSec = sim.activeSecondaryRunway;
    const pendingSec = sim.pendingSecondaryRunway;

    const highlightActive = Boolean(
      sim.secondaryRunwayOpen &&
        activeSec !== null &&
        draggedCraft &&
        (draggedCraft.kind === 'HEAVY' ||
          draggedCraft.kind === 'MAYDAY' ||
          draggedCraft.isMedevac)
    );
    const lockedSecondary =
      dragState?.preview?.snapKind === 'ILS_LOCK' &&
      (dragState.preview.lockedTarget === 'RWY_36' || dragState.preview.lockedTarget === 'RWY_18');

    // 1. Active Secondary ILS Feather + 5 NM FAF Maltese Cross
    if (sim.secondaryRunwayOpen && activeSec !== null) {
      this.drawIlsLocalizerFeather(
        ctx,
        activeSec,
        toPt,
        pxPerNm,
        timeSec,
        'active',
        highlightActive,
        lockedSecondary,
        null,
        true,
        staticObstacles
      );
    }

    // 2. Pending Secondary Wind-Shift Reversal Feather (pulsing amber)
    if (pendingSec !== null) {
      this.drawIlsLocalizerFeather(
        ctx,
        pendingSec,
        toPt,
        pxPerNm,
        timeSec,
        'pending',
        false,
        false,
        sim.runwayFlipCountdownSec,
        true,
        staticObstacles
      );
    }

    // 3. Physical Secondary N-S Crosswind Runway 36/18 Paved Strip
    const rwyWpx = Math.max(9, sec.widthNm * pxPerNm);
    const rx = p36.x - rwyWpx * 0.5;
    const topY = Math.min(p18.y, p36.y);
    const botY = Math.max(p18.y, p36.y);
    const rh = Math.abs(botY - topY);

    ctx.save();
    ctx.fillStyle = 'rgba(4, 16, 12, 0.96)';
    ctx.fillRect(rx, topY, rwyWpx, rh);

    ctx.strokeStyle =
      pendingSec !== null && Math.sin(timeSec * 10) > 0
        ? THEME.ACCENT_AMBER_HI
        : lockedSecondary
          ? '#9EF7B8'
          : THEME.TEXT_PRIMARY;
    ctx.lineWidth = lockedSecondary ? 2.2 : 1.6;
    ctx.strokeRect(rx + 0.5, topY + 0.5, rwyWpx - 1, rh - 1);

    // Dashed vertical runway centerline
    ctx.strokeStyle = 'rgba(158, 247, 184, 0.72)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(p36.x, topY + 8);
    ctx.lineTo(p36.x, botY - 8);
    ctx.stroke();
    ctx.setLineDash([]);

    // Piano-key threshold markings at North (18) and South (36) ends
    ctx.fillStyle = activeSec === '18' ? THEME.TEXT_BRIGHT : THEME.TEXT_SECONDARY;
    ctx.fillRect(rx + 2, topY + 2, rwyWpx - 4, 4);
    ctx.fillStyle = activeSec === '36' ? THEME.TEXT_BRIGHT : THEME.TEXT_SECONDARY;
    ctx.fillRect(rx + 2, botY - 6, rwyWpx - 4, 4);

    // Crisp `18` (North/top) and `36` (South/bottom) threshold labels
    ctx.font = font('micro', 12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle =
      activeSec === '18'
        ? THEME.TEXT_BRIGHT
        : pendingSec === '18'
          ? THEME.ACCENT_AMBER_HI
          : THEME.TEXT_MUTED;
    ctx.fillText('18', p18.x, topY - 10);

    ctx.fillStyle =
      activeSec === '36'
        ? THEME.TEXT_BRIGHT
        : pendingSec === '36'
          ? THEME.ACCENT_AMBER_HI
          : THEME.TEXT_MUTED;
    ctx.fillText('36', p36.x, botY + 11);

    // Active vertical landing direction arrow cleanly beside the runway strip
    if (activeSec !== null) {
      const dirY = activeSec === '36' ? -1 : 1; // 36 lands North (up = -Y), 18 lands South (down = +Y)
      const midY = (topY + botY) * 0.5;
      const arrowX = rx - 10;
      ctx.strokeStyle = THEME.TEXT_PRIMARY;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(arrowX, midY - dirY * 13);
      ctx.lineTo(arrowX, midY + dirY * 13);
      ctx.lineTo(arrowX - 4, midY + dirY * 7);
      ctx.moveTo(arrowX, midY + dirY * 13);
      ctx.lineTo(arrowX + 4, midY + dirY * 7);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Vector-general Jeppesen ILS Localizer Feather + 5 NM FAF Maltese Cross supporting
   * both horizontal (09/27) and vertical crosswind (36/18) runways!
   */
  private drawIlsLocalizerFeather(
    ctx: CanvasRenderingContext2D,
    runway: ActiveRunwayId,
    toPt: (x: number, y: number) => Vec2,
    pxPerNm: number,
    timeSec: number,
    mode: 'active' | 'pending',
    highlightOuterGate: boolean,
    lockedIls: boolean,
    countdownSec: number | null,
    multiRunwayActive: boolean,
    staticObstacles: PlacedRect[]
  ): void {
    const thNm = getRunwayThresholdNm(runway);
    const outNm = getRunwayOutwardUnitVec(runway);
    const ilsLenNm = getRunwayIlsLengthNm(runway);
    const fafNm = getRunwayFafNm(runway);
    const outerNm = getRunwayIlsOuterNm(runway);
    const isVertical = runway === '36' || runway === '18';

    const pTh = toPt(thNm.x, thNm.y);
    const pFaf = toPt(fafNm.x, fafNm.y);
    const pOuter = toPt(outerNm.x, outerNm.y);

    // Unit screen-space vectors along feather outward axis and perpendicular
    const uOutScr = { x: outNm.x, y: -outNm.y };
    const uPerpScr = { x: -uOutScr.y, y: uOutScr.x };

    const pulse = 0.5 + 0.5 * Math.sin(timeSec * (mode === 'pending' ? 9.0 : 4.2));
    const halfSpreadNm = Math.tan((4.2 * Math.PI) / 180) * ilsLenNm;
    const halfSpreadPx = Math.max(10, halfSpreadNm * pxPerNm);

    const tipA = {
      x: pOuter.x + uPerpScr.x * halfSpreadPx,
      y: pOuter.y + uPerpScr.y * halfSpreadPx,
    };
    const tipB = {
      x: pOuter.x - uPerpScr.x * halfSpreadPx,
      y: pOuter.y - uPerpScr.y * halfSpreadPx,
    };

    ctx.save();

    // 1. Authentic Jeppesen Localizer Feather Wedge (half shaded, half outline)
    const featherStroke =
      mode === 'pending'
        ? `rgba(255, 176, 0, ${(0.52 + pulse * 0.44).toFixed(3)})`
        : lockedIls
          ? 'rgba(158, 247, 184, 0.95)'
          : highlightOuterGate
            ? `rgba(68, 255, 119, ${(0.58 + pulse * 0.30).toFixed(3)})`
            : 'rgba(68, 255, 119, 0.44)';

    const featherFill =
      mode === 'pending'
        ? `rgba(255, 176, 0, ${(0.12 + pulse * 0.16).toFixed(3)})`
        : lockedIls
          ? 'rgba(68, 255, 119, 0.24)'
          : highlightOuterGate
            ? `rgba(68, 255, 119, ${(0.14 + pulse * 0.10).toFixed(3)})`
            : 'rgba(68, 255, 119, 0.10)';

    ctx.fillStyle = featherFill;
    ctx.beginPath();
    ctx.moveTo(pTh.x, pTh.y);
    ctx.lineTo(tipA.x, tipA.y);
    ctx.lineTo(pOuter.x, pOuter.y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = featherStroke;
    ctx.lineWidth = mode === 'pending' || lockedIls ? 1.8 : 1.25;
    ctx.beginPath();
    ctx.moveTo(pTh.x, pTh.y);
    ctx.lineTo(tipA.x, tipA.y);
    ctx.lineTo(tipB.x, tipB.y);
    ctx.closePath();
    ctx.stroke();

    // Outer Capture Gate Zone highlight (5 NM FAF -> outer end) when dragging Heavy/MAYDAY
    if (mode === 'active' && (highlightOuterGate || lockedIls)) {
      const gateHalfPx = APPROACH_CONSTANTS.ILS_CORRIDOR_HALF_WIDTH_NM * pxPerNm;
      const g1 = { x: pFaf.x + uPerpScr.x * gateHalfPx, y: pFaf.y + uPerpScr.y * gateHalfPx };
      const g2 = { x: pOuter.x + uPerpScr.x * gateHalfPx, y: pOuter.y + uPerpScr.y * gateHalfPx };
      const g3 = { x: pOuter.x - uPerpScr.x * gateHalfPx, y: pOuter.y - uPerpScr.y * gateHalfPx };
      const g4 = { x: pFaf.x - uPerpScr.x * gateHalfPx, y: pFaf.y - uPerpScr.y * gateHalfPx };

      ctx.beginPath();
      ctx.moveTo(g1.x, g1.y);
      ctx.lineTo(g2.x, g2.y);
      ctx.lineTo(g3.x, g3.y);
      ctx.lineTo(g4.x, g4.y);
      ctx.closePath();

      ctx.fillStyle = lockedIls
        ? 'rgba(68, 255, 119, 0.10)'
        : `rgba(68, 255, 119, ${(0.05 + pulse * 0.05).toFixed(3)})`;
      ctx.fill();

      ctx.strokeStyle = lockedIls ? THEME.TEXT_BRIGHT : 'rgba(68, 255, 119, 0.46)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 2. Dashed Extended Localizer Centerline + 1-NM Ticks
    ctx.strokeStyle =
      mode === 'pending'
        ? THEME.ACCENT_AMBER_HI
        : lockedIls
          ? '#FFFFFF'
          : 'rgba(158, 247, 184, 0.72)';
    ctx.lineWidth = lockedIls ? 1.8 : 1.3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(pTh.x, pTh.y);
    ctx.lineTo(pOuter.x, pOuter.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = mode === 'pending' ? THEME.ACCENT_AMBER : 'rgba(68, 255, 119, 0.45)';
    ctx.lineWidth = 1.1;
    const maxTickNm = Math.floor(ilsLenNm) - 1;
    for (let nm = 1; nm <= maxTickNm; nm++) {
      if (nm === 5) continue;
      const pt = toPt(thNm.x + outNm.x * nm, thNm.y + outNm.y * nm);
      ctx.beginPath();
      ctx.moveTo(pt.x - uPerpScr.x * 3.5, pt.y - uPerpScr.y * 3.5);
      ctx.lineTo(pt.x + uPerpScr.x * 3.5, pt.y + uPerpScr.y * 3.5);
      ctx.stroke();
    }

    // 3. 5 NM Final Approach Fix (FAF) Authentic Vector Maltese Cross
    this.drawMalteseCross(
      ctx,
      pFaf.x,
      pFaf.y,
      8.5,
      mode === 'pending' ? THEME.ACCENT_AMBER_HI : lockedIls ? '#FFFFFF' : THEME.TEXT_BRIGHT
    );

    // Crisp FAF label pill (positioned clear of R-118 for vertical secondary runways!)
    ctx.font = font('micro', 12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fafTag = mode === 'pending' || multiRunwayActive ? `FAF ${runway}` : 'FAF 5NM';
    const fafW = Math.ceil(ctx.measureText(fafTag).width);
    const pillW = fafW + 8;
    const pillH = 16;
    const pillCx = isVertical ? pFaf.x + 12 + pillW * 0.5 : pFaf.x;
    const pillCy = isVertical ? pFaf.y : pFaf.y + 19.5;
    const pillX = Math.round(pillCx - pillW * 0.5);
    const pillY = Math.round(pillCy - pillH * 0.5);

    ctx.fillStyle = 'rgba(2, 9, 5, 0.86)';
    ctx.fillRect(pillX, pillY, pillW, pillH);
    ctx.fillStyle = mode === 'pending' ? THEME.ACCENT_AMBER_HI : THEME.TEXT_PRIMARY;
    ctx.fillText(fafTag, pillCx, pillCy + 0.5);

    staticObstacles.push({ x: pillX - 2, y: pillY - 2, w: pillW + 4, h: pillH + 4 });

    // 4. Countdown Callout over Pending Opposite Runway Feather during 10s Reversal Advisory
    if (mode === 'pending' && countdownSec !== null) {
      const midPt = toPt(thNm.x + outNm.x * 6.4, thNm.y + outNm.y * 6.4);
      const secStr = String(Math.max(0, Math.ceil(countdownSec))).padStart(2, '0');
      const warnTxt = `RWY ${runway} IN ${secStr}S`;
      ctx.font = font('data', 12);
      const bw = Math.ceil(ctx.measureText(warnTxt).width) + 14;
      const bh = 22;
      const bx = isVertical ? Math.round(midPt.x + 14) : Math.round(midPt.x - bw * 0.5);
      const by = isVertical ? Math.round(midPt.y - bh * 0.5) : Math.round(midPt.y - 34);

      ctx.fillStyle = pulse > 0.45 ? 'rgba(84, 42, 4, 0.94)' : 'rgba(42, 20, 4, 0.90)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = pulse > 0.45 ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      ctx.fillText(warnTxt, bx + bw * 0.5, by + bh * 0.5 + 0.5);
      staticObstacles.push({ x: bx - 2, y: by - 2, w: bw + 4, h: bh + 4 });
    }

    ctx.restore();
  }

  /** Draws an authentic FAA 4-blade flared Maltese Cross symbol at `(x, y)`. */
  private drawMalteseCross(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    const arm = size;
    const flare = size * 0.42;
    const notch = size * 0.22;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-flare, -arm);
      ctx.lineTo(0, -arm + notch);
      ctx.lineTo(flare, -arm);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(Math.PI * 0.5);
    }
    ctx.restore();
  }

  // ===========================================================================
  // DEPARTURE HOLD-SHORT BAR & QUEUED OUTBOUND BLIPS
  // ===========================================================================
  private drawDepartureHoldShorts(
    ctx: CanvasRenderingContext2D,
    sim: ApproachSimulation,
    toPt: (x: number, y: number) => Vec2,
    timeSec: number,
    tutorialState: ApproachTutorialOverlayState | null,
    staticObstacles: PlacedRect[]
  ): void {
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 8.5);
    const seenByRunway = new Map<ActiveRunwayId, number>();
    const highlightDep = Boolean(tutorialState?.highlightDepartureButton);

    ctx.save();
    for (const dep of sim.departureQueue) {
      const idxOnRwy = seenByRunway.get(dep.runway) ?? 0;
      seenByRunway.set(dep.runway, idxOnRwy + 1);

      const isVertRwy = dep.runway === '36' || dep.runway === '18';
      const stackNmX = dep.holdShortPos.x + (isVertRwy ? idxOnRwy * 0.65 : 0);
      const stackNmY = dep.holdShortPos.y + (isVertRwy ? 0 : idxOnRwy * 0.65);
      const p = toPt(stackNmX, stackNmY);

      const urgentPulse = dep.urgent && Math.sin(timeSec * 14) > 0;
      const barCol = urgentPulse
        ? THEME.ALERT_RED_STROKE
        : highlightDep
          ? THEME.ACCENT_CYAN
          : THEME.ACCENT_AMBER_HI;

      // 1. Glowing Amber FAA Hold-Short Bar (double solid + dashed edge beside runway)
      ctx.save();
      ctx.translate(p.x, p.y);
      if (isVertRwy) ctx.rotate(Math.PI * 0.5);
      ctx.strokeStyle = barCol;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(-11, 7);
      ctx.lineTo(11, 7);
      ctx.stroke();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-11, 10.5);
      ctx.lineTo(11, 10.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // 2. Pulsing Hold-Short Halo + Outbound Blip Chevron
      ctx.strokeStyle = urgentPulse
        ? `rgba(255, 82, 54, ${(0.55 + pulse * 0.45).toFixed(3)})`
        : highlightDep
          ? `rgba(76, 238, 255, ${(0.55 + pulse * 0.45).toFixed(3)})`
          : `rgba(255, 176, 0, ${(0.45 + pulse * 0.45).toFixed(3)})`;
      ctx.lineWidth = highlightDep || dep.urgent ? 2.0 : 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10 + pulse * 4.5, 0, Math.PI * 2);
      ctx.stroke();

      const rotRad = magneticDegToCanvasRad(dep.departureHeadingDeg);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(rotRad);
      ctx.fillStyle = urgentPulse ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER_HI;
      ctx.strokeStyle = '#030805';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(7.5, 0);
      ctx.lineTo(-5, -5.2);
      ctx.lineTo(-2.5, 0);
      ctx.lineTo(-5, 5.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // 3. Crisp `DEP WAIT` tag pill right beside hold-short position
      this.drawDepartureWaitTag(ctx, dep, p, isVertRwy, pulse, highlightDep, staticObstacles);
    }
    ctx.restore();
  }

  private drawDepartureWaitTag(
    ctx: CanvasRenderingContext2D,
    dep: DepartureQueueItem,
    p: Vec2,
    isVertRwy: boolean,
    pulse: number,
    highlightDep: boolean,
    staticObstacles: PlacedRect[]
  ): void {
    const tag = `DEP WAIT`;
    ctx.font = font('micro', 12);
    const tw = Math.ceil(ctx.measureText(tag).width);
    const bw = tw + 10;
    const bh = 17;
    const bx = isVertRwy ? Math.round(p.x + 14) : Math.round(p.x - bw * 0.5);
    const by = isVertRwy ? Math.round(p.y - bh * 0.5) : Math.round(p.y - 28);

    ctx.fillStyle = dep.urgent
      ? pulse > 0.5
        ? 'rgba(116, 18, 10, 0.94)'
        : 'rgba(64, 16, 8, 0.92)'
      : highlightDep
        ? 'rgba(10, 42, 52, 0.94)'
        : 'rgba(56, 30, 4, 0.92)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = dep.urgent
      ? THEME.ALERT_RED_STROKE
      : highlightDep
        ? THEME.ACCENT_CYAN
        : THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = dep.urgent
      ? '#FFF0EC'
      : highlightDep
        ? THEME.ACCENT_CYAN
        : THEME.ACCENT_AMBER_HI;
    ctx.fillText(tag, bx + bw * 0.5, by + bh * 0.5 + 0.5);

    staticObstacles.push({ x: bx - 2, y: by - 2, w: bw + 4, h: bh + 4 });
  }

  // ===========================================================================
  // VTOL PAD ALPHA (NE) & ORBITAL SALVAGE CRADLE (SW)
  // ===========================================================================
  private drawVtolPadAlpha(
    ctx: CanvasRenderingContext2D,
    toPt: (x: number, y: number) => Vec2,
    pxPerNm: number,
    timeSec: number,
    draggedCraft: ApproachAircraft | null,
    dragState: ApproachDragVisualState | null,
    staticObstacles: PlacedRect[]
  ): void {
    const pad = AIRFIELD_GEOMETRY.padAlpha;
    const p = toPt(pad.pos.x, pad.pos.y);
    const padR = Math.max(10, pad.radiusNm * pxPerNm);
    const capR = pad.captureRadiusNm * pxPerNm;
    const highlight = Boolean(
      draggedCraft && (draggedCraft.kind === 'DROPSHIP' || draggedCraft.kind === 'MAYDAY')
    );
    const locked = dragState?.preview?.snapKind === 'PAD_LOCK';
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 5.2);

    ctx.save();

    // Glowing 360° magnetic capture ring
    ctx.strokeStyle = locked
      ? '#9EF7B8'
      : highlight
        ? `rgba(68, 255, 119, ${(0.55 + pulse * 0.35).toFixed(3)})`
        : 'rgba(68, 255, 119, 0.34)';
    ctx.lineWidth = locked ? 2.2 : highlight ? 1.8 : 1.2;
    ctx.setLineDash(locked ? [] : [6, 5]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, capR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (highlight || locked) {
      ctx.fillStyle = locked
        ? 'rgba(68, 255, 119, 0.16)'
        : `rgba(68, 255, 119, ${(0.05 + pulse * 0.06).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, capR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pad deck disc
    ctx.fillStyle = 'rgba(4, 18, 10, 0.94)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, padR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = locked ? '#FFFFFF' : THEME.TEXT_PRIMARY;
    ctx.lineWidth = locked ? 2.2 : 1.7;
    ctx.beginPath();
    ctx.arc(p.x, p.y, padR, 0, Math.PI * 2);
    ctx.stroke();

    // Inner crosshairs
    ctx.strokeStyle = 'rgba(158, 247, 184, 0.55)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(p.x - padR * 0.65, p.y);
    ctx.lineTo(p.x + padR * 0.65, p.y);
    ctx.moveTo(p.x, p.y - padR * 0.65);
    ctx.lineTo(p.x, p.y + padR * 0.65);
    ctx.stroke();

    // Crisp `PAD α` label above pad disc
    ctx.font = font('micro', 12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lbl = pad.label;
    const tw = Math.ceil(ctx.measureText(lbl).width);
    const ly = p.y - padR - 12;
    const rx = Math.round(p.x - tw * 0.5 - 4);
    const ry = Math.round(ly - 8);
    ctx.fillStyle = 'rgba(2, 9, 5, 0.86)';
    ctx.fillRect(rx, ry, tw + 8, 16);
    ctx.fillStyle = locked ? '#FFFFFF' : THEME.TEXT_BRIGHT;
    ctx.fillText(lbl, p.x, ly + 0.5);

    staticObstacles.push({ x: rx - 2, y: ry - 2, w: tw + 12, h: 20 });
    ctx.restore();
  }

  private drawSalvageCradle(
    ctx: CanvasRenderingContext2D,
    toPt: (x: number, y: number) => Vec2,
    pxPerNm: number,
    timeSec: number,
    draggedCraft: ApproachAircraft | null,
    dragState: ApproachDragVisualState | null,
    staticObstacles: PlacedRect[]
  ): void {
    const cr = AIRFIELD_GEOMETRY.salvageCradle;
    const p = toPt(cr.pos.x, cr.pos.y);
    const uOut = headingDegToUnitVec(cr.corridorOutHeadingDeg); // ENE 060°
    const uPerp = { x: -uOut.y, y: uOut.x };

    const endNm = {
      x: cr.pos.x + uOut.x * cr.corridorLengthNm,
      y: cr.pos.y + uOut.y * cr.corridorLengthNm,
    };
    const pEnd = toPt(endNm.x, endNm.y);

    const highlight = Boolean(
      draggedCraft && (draggedCraft.kind === 'TUG' || draggedCraft.kind === 'MAYDAY')
    );
    const locked = dragState?.preview?.snapKind === 'CRADLE_LOCK';
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 5.0);

    ctx.save();

    // 1. Extended Approach Funnel Corridor
    const nearHalfNm = 0.42;
    const farHalfNm = 1.05;
    const f1 = toPt(cr.pos.x + uPerp.x * nearHalfNm, cr.pos.y + uPerp.y * nearHalfNm);
    const f2 = toPt(endNm.x + uPerp.x * farHalfNm, endNm.y + uPerp.y * farHalfNm);
    const f3 = toPt(endNm.x - uPerp.x * farHalfNm, endNm.y - uPerp.y * farHalfNm);
    const f4 = toPt(cr.pos.x - uPerp.x * nearHalfNm, cr.pos.y - uPerp.y * nearHalfNm);

    ctx.fillStyle = locked
      ? 'rgba(76, 238, 255, 0.16)'
      : highlight
        ? `rgba(76, 238, 255, ${(0.07 + pulse * 0.06).toFixed(3)})`
        : 'rgba(76, 238, 255, 0.05)';
    ctx.beginPath();
    ctx.moveTo(f1.x, f1.y);
    ctx.lineTo(f2.x, f2.y);
    ctx.lineTo(f3.x, f3.y);
    ctx.lineTo(f4.x, f4.y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = locked
      ? '#9EF7FF'
      : highlight
        ? `rgba(76, 238, 255, ${(0.56 + pulse * 0.34).toFixed(3)})`
        : 'rgba(76, 238, 255, 0.36)';
    ctx.lineWidth = locked ? 1.8 : 1.2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(f1.x, f1.y);
    ctx.lineTo(f2.x, f2.y);
    ctx.moveTo(f4.x, f4.y);
    ctx.lineTo(f3.x, f3.y);
    ctx.stroke();

    // Corridor centerline
    ctx.strokeStyle = locked ? '#FFFFFF' : 'rgba(76, 238, 255, 0.54)';
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(pEnd.x, pEnd.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Directional inbound chevrons along corridor pointing SW (240° toward Cradle)
    const dirScreen = { x: p.x - pEnd.x, y: p.y - pEnd.y };
    const dirLen = Math.max(1, Math.hypot(dirScreen.x, dirScreen.y));
    const ux = dirScreen.x / dirLen;
    const uy = dirScreen.y / dirLen;
    const px = -uy;
    const py = ux;

    ctx.strokeStyle = locked ? '#FFFFFF' : 'rgba(76, 238, 255, 0.65)';
    ctx.lineWidth = 1.4;
    for (const frac of [0.32, 0.62, 0.86]) {
      const mx = p.x + (pEnd.x - p.x) * frac;
      const my = p.y + (pEnd.y - p.y) * frac;
      ctx.beginPath();
      ctx.moveTo(mx - ux * 5 + px * 5, my - uy * 5 + py * 5);
      ctx.lineTo(mx + ux * 4, my + uy * 4);
      ctx.lineTo(mx - ux * 5 - px * 5, my - uy * 5 - py * 5);
      ctx.stroke();
    }

    // Subtle crossing diamond where Salvage Cradle corridor intersects RWY 09/27 centerline
    const pCross = toPt(cr.corridorCrossPointNm.x, cr.corridorCrossPointNm.y);
    ctx.strokeStyle = 'rgba(255, 176, 0, 0.52)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(pCross.x, pCross.y - 5);
    ctx.lineTo(pCross.x + 5, pCross.y);
    ctx.lineTo(pCross.x, pCross.y + 5);
    ctx.lineTo(pCross.x - 5, pCross.y);
    ctx.closePath();
    ctx.stroke();

    // 2. Angled Orbital Salvage Cradle Docking Gantry Brackets
    const angleRad = magneticDegToCanvasRad(cr.approachHeadingDeg);
    const armLen = Math.max(12, 0.56 * pxPerNm);
    const jawHalf = Math.max(8, 0.34 * pxPerNm);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angleRad);

    ctx.fillStyle = 'rgba(5, 24, 30, 0.94)';
    ctx.fillRect(-armLen * 0.6, -jawHalf, armLen * 1.2, jawHalf * 2);

    ctx.strokeStyle = locked ? '#FFFFFF' : THEME.ACCENT_CYAN;
    ctx.lineWidth = locked ? 2.4 : 2.0;
    ctx.beginPath();
    ctx.moveTo(-armLen * 0.75, -jawHalf);
    ctx.lineTo(armLen * 0.65, -jawHalf);
    ctx.lineTo(armLen * 0.65, jawHalf);
    ctx.lineTo(-armLen * 0.75, jawHalf);
    ctx.stroke();

    ctx.strokeStyle = THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-armLen * 0.75, -jawHalf);
    ctx.lineTo(-armLen * 0.75, -jawHalf * 0.45);
    ctx.moveTo(-armLen * 0.75, jawHalf);
    ctx.lineTo(-armLen * 0.75, jawHalf * 0.45);
    ctx.stroke();
    ctx.restore();

    // Crisp `CRADLE` label cleanly below the docking brackets
    ctx.font = font('micro', 12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lbl = cr.label;
    const tw = Math.ceil(ctx.measureText(lbl).width);
    const ly = p.y + jawHalf + 15;
    const rx = Math.round(p.x - tw * 0.5 - 4);
    const ry = Math.round(ly - 8);
    ctx.fillStyle = 'rgba(2, 9, 5, 0.86)';
    ctx.fillRect(rx, ry, tw + 8, 16);
    ctx.fillStyle = locked ? '#FFFFFF' : THEME.ACCENT_CYAN;
    ctx.fillText(lbl, p.x, ly + 0.5);

    staticObstacles.push({ x: rx - 2, y: ry - 2, w: tw + 12, h: 20 });
    ctx.restore();
  }

  // ===========================================================================
  // NAMED RNAV FIXES (KRATO, BOREA & VEXIS) + VERTICALLY STACKED RACETRACKS
  // ===========================================================================
  private drawHoldingFixes(
    ctx: CanvasRenderingContext2D,
    sim: ApproachSimulation,
    toPt: (x: number, y: number) => Vec2,
    pxPerNm: number,
    timeSec: number,
    dragState: ApproachDragVisualState | null,
    staticObstacles: PlacedRect[]
  ): void {
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 5.8);
    const crt1979 = isCrt1979Typography();
    const mintHoldCol = crt1979 ? '#A4FFE6' : '#7EF0D0';
    const draggedCraft =
      dragState !== null ? sim.getAircraftById(dragState.craftId) ?? null : null;
    const isDraggingArrival = Boolean(
      dragState !== null && (!draggedCraft || !draggedCraft.isDeparture)
    );

    for (const fix of AIRFIELD_GEOMETRY.holdingFixes) {
      const p = toPt(fix.pos.x, fix.pos.y);

      // Compute live vertical stack occupancy from state.aircraft
      const maxSlots = APPROACH_CONSTANTS.HOLD_STACK_MAX_SLOTS;
      const occupiedSlots: boolean[] = [false, false, false];
      let stackCount = 0;
      for (const craft of sim.aircraft) {
        if (craft.assignedHoldFix !== fix.id || craft.holdAltitudeSlot === null) continue;
        const slot = craft.holdAltitudeSlot;
        if (slot >= 0 && slot < maxSlots && !occupiedSlots[slot]) {
          occupiedSlots[slot] = true;
          stackCount++;
        }
      }

      const hasHoldingCraft =
        stackCount > 0 || sim.aircraft.some((c) => c.assignedHoldFix === fix.id);
      const isFull = stackCount >= maxSlots;
      const isDragSnap =
        dragState?.preview?.holdFix === fix.id && dragState?.preview?.snapKind === 'HOLD_FIX';
      const isDragFull =
        dragState?.preview?.holdFix === fix.id && Boolean(dragState?.preview?.holdFixFull);
      const isDragNear =
        dragState?.cursorNm !== null &&
        dragState?.cursorNm !== undefined &&
        Math.hypot(dragState.cursorNm.x - fix.pos.x, dragState.cursorNm.y - fix.pos.y) <=
          fix.snapRadiusNm * 1.45;
      const showBrightRacetrack = hasHoldingCraft || isDraggingArrival || isDragSnap || isDragNear;

      // 1. Published Right-Hand Racetrack Holding Pattern Outline (softly visible at ~0.24 alpha at all times)
      this.drawRightHandRacetrack(
        ctx,
        fix,
        toPt,
        showBrightRacetrack,
        isDraggingArrival && !hasHoldingCraft && !isDragSnap && !isDragNear,
        isDragSnap,
        isFull || isDragFull,
        pulse
      );

      // 2. Snap capture halo when dragging an aircraft
      if (isDragSnap || isDragFull || isDragNear || isDraggingArrival) {
        ctx.save();
        ctx.strokeStyle = isDragFull
          ? pulse > 0.45
            ? THEME.ACCENT_AMBER_HI
            : THEME.ACCENT_AMBER
          : isDragSnap
            ? mintHoldCol
            : isFull
              ? `rgba(255, 176, 0, ${(0.34 + pulse * 0.22).toFixed(3)})`
              : isDragNear
                ? `rgba(126, 240, 208, ${(0.48 + pulse * 0.28).toFixed(3)})`
                : `rgba(126, 240, 208, ${(0.22 + pulse * 0.14).toFixed(3)})`;
        ctx.lineWidth = isDragSnap || isDragFull ? 2.1 : isDragNear ? 1.5 : 1.1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, fix.snapRadiusNm * pxPerNm, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // 3. Authentic FAA RNAV Triangle Symbol
      ctx.save();
      const triR = 7.5;
      ctx.fillStyle = isDragFull
        ? 'rgba(84, 44, 6, 0.95)'
        : isDragSnap
          ? 'rgba(10, 52, 46, 0.95)'
          : isFull
            ? 'rgba(66, 36, 6, 0.94)'
            : hasHoldingCraft
              ? 'rgba(8, 42, 42, 0.94)'
              : isDraggingArrival
                ? 'rgba(8, 30, 26, 0.94)'
                : 'rgba(3, 14, 9, 0.94)';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - triR);
      ctx.lineTo(p.x + triR * 0.9, p.y + triR * 0.65);
      ctx.lineTo(p.x - triR * 0.9, p.y + triR * 0.65);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle =
        isDragFull || isFull
          ? THEME.ACCENT_AMBER_HI
          : isDragSnap || hasHoldingCraft
            ? mintHoldCol
            : isDraggingArrival
              ? THEME.ACCENT_CYAN
              : THEME.TEXT_PRIMARY;
      ctx.lineWidth = isDragSnap || isDragFull || hasHoldingCraft || isDraggingArrival ? 1.8 : 1.4;
      ctx.stroke();

      // Center pin dot
      ctx.fillStyle =
        isDragFull || isFull
          ? THEME.ACCENT_AMBER_HI
          : isDragSnap || hasHoldingCraft
            ? mintHoldCol
            : THEME.TEXT_BRIGHT;
      ctx.beginPath();
      ctx.arc(p.x, p.y + 1, 1.8, 0, Math.PI * 2);
      ctx.fill();

      // 4. Crisp Fix Name Label + Fix Stack Pill directly beneath whenever occupied or dragging
      const showStackPill = stackCount > 0 || isDraggingArrival;
      ctx.font = font('micro', 12);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const nameLabel = showStackPill ? `${fix.name} [${stackCount}/${maxSlots}]` : fix.name;
      const nameTw = Math.ceil(ctx.measureText(nameLabel).width);
      const nameW = nameTw + 10;
      const nameH = 16;
      const nameLy = p.y + 17;
      const nameRx = Math.round(p.x - nameW * 0.5);
      const nameRy = Math.round(nameLy - nameH * 0.5);

      ctx.fillStyle =
        isDragFull || isFull
          ? 'rgba(54, 28, 4, 0.92)'
          : isDragSnap || hasHoldingCraft
            ? 'rgba(5, 24, 24, 0.90)'
            : 'rgba(2, 9, 5, 0.86)';
      ctx.fillRect(nameRx, nameRy, nameW, nameH);
      if (showStackPill) {
        ctx.strokeStyle =
          isDragFull || isFull
            ? THEME.ACCENT_AMBER
            : isDragSnap || hasHoldingCraft
              ? mintHoldCol
              : 'rgba(126, 240, 208, 0.52)';
        ctx.lineWidth = 1.0;
        ctx.strokeRect(nameRx + 0.5, nameRy + 0.5, nameW - 1, nameH - 1);
      }
      ctx.fillStyle =
        isDragFull || isFull
          ? THEME.ACCENT_AMBER_HI
          : isDragSnap || hasHoldingCraft
            ? mintHoldCol
            : isDraggingArrival
              ? THEME.TEXT_BRIGHT
              : THEME.TEXT_SECONDARY;
      ctx.fillText(nameLabel, p.x, nameLy + 0.5);

      let obsMinX = nameRx;
      let obsMaxX = nameRx + nameW;
      let obsMaxY = nameRy + nameH;

      if (showStackPill) {
        const activeAltLabels: string[] = [];
        for (let s = 0; s < maxSlots; s++) {
          if (occupiedSlots[s]) {
            const altFt =
              HOLD_ALTITUDE_SLOTS_FT[s] ??
              APPROACH_CONSTANTS.HOLD_STACK_BASE_ALT_FT +
                s * APPROACH_CONSTANTS.HOLD_STACK_STEP_ALT_FT;
            activeAltLabels.push(`${(altFt / 1000).toFixed(1)}K`);
          }
        }
        const stackText = isFull
          ? 'FULL 3/3'
          : activeAltLabels.length > 0
            ? activeAltLabels.join(' · ')
            : '0.35× · OPEN';

        ctx.font = font('micro', 12);
        const textW = Math.ceil(ctx.measureText(stackText).width);
        const pipsW = maxSlots * 6 + (maxSlots - 1) * 2;
        const pillW = textW + pipsW + 16;
        const pillH = 16;
        const pillX = Math.round(p.x - pillW * 0.5);
        const pillY = nameRy + nameH + 2;

        ctx.fillStyle = isFull
          ? pulse > 0.45
            ? 'rgba(84, 42, 4, 0.94)'
            : 'rgba(56, 28, 4, 0.92)'
          : stackCount > 0
            ? 'rgba(5, 28, 26, 0.92)'
            : 'rgba(4, 18, 16, 0.88)';
        ctx.fillRect(pillX, pillY, pillW, pillH);
        ctx.strokeStyle = isFull
          ? THEME.ACCENT_AMBER_HI
          : stackCount > 0
            ? mintHoldCol
            : 'rgba(126, 240, 208, 0.48)';
        ctx.lineWidth = isFull || isDragSnap ? 1.2 : 1.0;
        ctx.strokeRect(pillX + 0.5, pillY + 0.5, pillW - 1, pillH - 1);

        // Compact 3-level vertical slot pips (3.5K / 4.5K / 5.5K)
        const pipStartX = pillX + 5;
        const pipY = pillY + Math.round((pillH - 6) * 0.5);
        for (let s = 0; s < maxSlots; s++) {
          const px = pipStartX + s * 8;
          if (occupiedSlots[s]) {
            ctx.fillStyle = isFull ? THEME.ACCENT_AMBER_HI : mintHoldCol;
            ctx.fillRect(px, pipY, 5, 6);
          } else {
            ctx.strokeStyle = 'rgba(126, 240, 208, 0.45)';
            ctx.lineWidth = 1.0;
            ctx.strokeRect(px + 0.5, pipY + 0.5, 4, 5);
          }
        }

        ctx.textAlign = 'left';
        ctx.fillStyle = isFull ? THEME.ACCENT_AMBER_HI : mintHoldCol;
        ctx.fillText(stackText, pipStartX + pipsW + 5, pillY + pillH * 0.5 + 0.5);

        obsMinX = Math.min(obsMinX, pillX);
        obsMaxX = Math.max(obsMaxX, pillX + pillW);
        obsMaxY = pillY + pillH;
      }

      staticObstacles.push({
        x: obsMinX - 2,
        y: nameRy - 2,
        w: obsMaxX - obsMinX + 4,
        h: obsMaxY - nameRy + 4,
      });
      ctx.restore();
    }
  }

  private drawRightHandRacetrack(
    ctx: CanvasRenderingContext2D,
    fix: HoldingFixDef,
    toPt: (x: number, y: number) => Vec2,
    active: boolean,
    softDragHighlight: boolean,
    snapped: boolean,
    isFull: boolean,
    pulse: number
  ): void {
    const uIn = headingDegToUnitVec(fix.inboundHeadingDeg);
    const uOut = { x: -uIn.x, y: -uIn.y };
    const uRight = headingDegToUnitVec(fix.inboundHeadingDeg + 90);
    const R = fix.turnRadiusNm;
    const L = fix.legLengthNm;

    const ptsNm: Vec2[] = [];
    const arcSteps = 14;

    const c1 = { x: fix.pos.x + uRight.x * R, y: fix.pos.y + uRight.y * R };
    for (let i = 0; i <= arcSteps; i++) {
      const theta = (i / arcSteps) * Math.PI;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      ptsNm.push({
        x: c1.x - uRight.x * R * cosT + uIn.x * R * sinT,
        y: c1.y - uRight.y * R * cosT + uIn.y * R * sinT,
      });
    }

    const c2 = {
      x: fix.pos.x + uOut.x * L + uRight.x * R,
      y: fix.pos.y + uOut.y * L + uRight.y * R,
    };
    for (let i = 0; i <= arcSteps; i++) {
      const theta = (i / arcSteps) * Math.PI;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      ptsNm.push({
        x: c2.x + uRight.x * R * cosT + uOut.x * R * sinT,
        y: c2.y + uRight.y * R * cosT + uOut.y * R * sinT,
      });
    }

    ctx.save();
    ctx.beginPath();
    ptsNm.forEach((pt, idx) => {
      const s = toPt(pt.x, pt.y);
      if (idx === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();

    const mintAccent = isCrt1979Typography() ? '#A4FFE6' : '#7EF0D0';
    ctx.strokeStyle = isFull
      ? `rgba(255, 176, 0, ${(0.56 + pulse * 0.28).toFixed(3)})`
      : snapped
        ? mintAccent
        : softDragHighlight
          ? `rgba(126, 240, 208, ${(0.40 + pulse * 0.18).toFixed(3)})`
          : active
            ? `rgba(126, 240, 208, ${(0.56 + pulse * 0.28).toFixed(3)})`
            : 'rgba(126, 240, 208, 0.24)';
    ctx.lineWidth = snapped || isFull ? 2.0 : active ? 1.5 : 1.15;
    ctx.setLineDash([6, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (active) {
      const midInNm = { x: fix.pos.x + uOut.x * (L * 0.5), y: fix.pos.y + uOut.y * (L * 0.5) };
      const midOutNm = {
        x: fix.pos.x + uRight.x * (2 * R) + uOut.x * (L * 0.5),
        y: fix.pos.y + uRight.y * (2 * R) + uOut.y * (L * 0.5),
      };
      const arrowCol = isFull
        ? THEME.ACCENT_AMBER_HI
        : snapped
          ? mintAccent
          : softDragHighlight
            ? 'rgba(126, 240, 208, 0.68)'
            : THEME.ACCENT_CYAN;
      this.drawMiniArrowNm(ctx, midInNm, uIn, toPt, arrowCol);
      this.drawMiniArrowNm(ctx, midOutNm, uOut, toPt, arrowCol);
    }

    ctx.restore();
  }

  private drawMiniArrowNm(
    ctx: CanvasRenderingContext2D,
    posNm: Vec2,
    dirNm: Vec2,
    toPt: (x: number, y: number) => Vec2,
    color: string
  ): void {
    const p = toPt(posNm.x, posNm.y);
    const p2 = toPt(posNm.x + dirNm.x * 0.5, posNm.y + dirNm.y * 0.5);
    const dx = p2.x - p.x;
    const dy = p2.y - p.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(p.x - ux * 4 + px * 4, p.y - uy * 4 + py * 4);
    ctx.lineTo(p.x + ux * 4, p.y + uy * 4);
    ctx.lineTo(p.x - ux * 4 - px * 4, p.y - uy * 4 - py * 4);
    ctx.stroke();
    ctx.restore();
  }

  // ===========================================================================
  // NON-LETHAL ION STATIC RF INTERFERENCE CELLS (INFO BRAVO+)
  // Electric violet-indigo + cyan horizontal RF scan-bars & static snow
  // (ZERO crimson/amber fills or diagonal hazard hatching!)
  // ===========================================================================
  private drawIonStormCell(
    ctx: CanvasRenderingContext2D,
    storm: IonStormCell,
    toPt: (x: number, y: number) => Vec2,
    pxPerNm: number,
    timeSec: number,
    staticObstacles: PlacedRect[]
  ): void {
    const alpha = Math.max(0, Math.min(1, storm.intensity));
    if (alpha <= 0.02) return;

    const center = toPt(storm.x, storm.y);
    const outerR = storm.radiusNm * pxPerNm;
    const coreR = storm.coreRadiusNm * pxPerNm;
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 4.5 + storm.id);

    const buildContourPath = (radiusPx: number, phaseOffset: number): void => {
      const n = storm.contourScales.length || 12;
      const pts: Vec2[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + phaseOffset;
        const sc = storm.contourScales[i % storm.contourScales.length] ?? 1;
        const wobble = 1 + 0.035 * Math.sin(timeSec * 2.4 + i * 1.9 + storm.id);
        const r = radiusPx * sc * wobble;
        pts.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r });
      }
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const cur = pts[i];
        const next = pts[(i + 1) % pts.length];
        const midX = (cur.x + next.x) * 0.5;
        const midY = (cur.y + next.y) * 0.5;
        if (i === 0) {
          const prev = pts[pts.length - 1];
          ctx.moveTo((prev.x + cur.x) * 0.5, (prev.y + cur.y) * 0.5);
        }
        ctx.quadraticCurveTo(cur.x, cur.y, midX, midY);
      }
      ctx.closePath();
    };

    ctx.save();

    // 1. Translucent Electric Violet-Indigo Cloud + Clipped Horizontal RF Scan-Bars & Static Snow
    ctx.save();
    buildContourPath(outerR, 0);
    ctx.fillStyle = `rgba(118, 68, 220, ${(0.16 * alpha).toFixed(3)})`;
    ctx.fill();
    ctx.clip();

    // Inner violet-indigo RF core contour
    buildContourPath(coreR, 0.25);
    ctx.fillStyle = `rgba(148, 86, 255, ${(0.24 * alpha).toFixed(3)})`;
    ctx.fill();

    // Oscillating horizontal RF scan-bars (unmistakably electromagnetic static in BOTH Clean & 1979 CRT!)
    const spanY = Math.ceil(outerR * 1.25);
    const spanX = Math.ceil(outerR * 1.25);
    const barStep = 7;
    const scrollPx = (timeSec * 22 + storm.id * 13) % barStep;

    for (let dy = -spanY; dy <= spanY; dy += barStep) {
      const y = center.y + dy + scrollPx;
      const rowIdx = Math.round((dy + spanY) / barStep);
      const wave = 0.5 + 0.5 * Math.sin(timeSec * 6.8 + rowIdx * 1.15 + storm.id);
      const jitterX = Math.sin(timeSec * 11.5 + rowIdx * 2.3 + storm.id) * 10;
      const isCyanBar = rowIdx % 3 === 0;
      const segHalfW = spanX * (0.55 + 0.35 * wave);
      const barAlpha = (isCyanBar ? 0.22 + wave * 0.26 : 0.16 + wave * 0.22) * alpha;

      ctx.strokeStyle = isCyanBar
        ? `rgba(124, 238, 255, ${barAlpha.toFixed(3)})`
        : `rgba(196, 155, 255, ${barAlpha.toFixed(3)})`;
      ctx.lineWidth = isCyanBar ? 1.5 : 1.1;
      ctx.beginPath();
      ctx.moveTo(center.x - segHalfW + jitterX, y);
      ctx.lineTo(center.x + segHalfW + jitterX, y);
      ctx.stroke();
    }

    // 2 bright sweeping horizontal RF interference bands
    for (let b = 0; b < 2; b++) {
      const sweepFrac = ((timeSec * (0.42 + b * 0.19) + storm.id * 0.37 + b * 0.5) % 1) * 2 - 1;
      const bandY = center.y + sweepFrac * outerR * 0.92;
      ctx.fillStyle =
        b === 0
          ? `rgba(124, 238, 255, ${(0.18 * alpha).toFixed(3)})`
          : `rgba(196, 155, 255, ${(0.20 * alpha).toFixed(3)})`;
      ctx.fillRect(center.x - spanX, bandY - 2, spanX * 2, 4);
    }

    // Shimmering cyan-violet RF static snow flecks
    const snowFrame = Math.floor(timeSec * 14);
    const snowCount = Math.max(22, Math.min(46, Math.round(outerR * 0.52)));
    for (let i = 0; i < snowCount; i++) {
      const seed = (i + 1) * 12.9898 + storm.id * 78.233 + snowFrame * 3.17;
      const h1 = Math.abs(Math.sin(seed) * 43758.5453) % 1;
      const h2 = Math.abs(Math.sin(seed * 1.73 + 1.1) * 29713.1731) % 1;
      const h3 = Math.abs(Math.sin(seed * 2.41 + 2.7) * 19381.9123) % 1;
      const angle = h1 * Math.PI * 2;
      const dist = Math.sqrt(h2) * outerR * 1.04;
      const sx = center.x + Math.cos(angle) * dist;
      const sy = center.y + Math.sin(angle) * dist;
      const sw = 3 + h3 * 7;
      ctx.fillStyle =
        i % 2 === 0
          ? `rgba(124, 238, 255, ${((0.36 + h3 * 0.48) * alpha).toFixed(3)})`
          : `rgba(196, 155, 255, ${((0.34 + h3 * 0.46) * alpha).toFixed(3)})`;
      ctx.fillRect(sx - sw * 0.5, sy - 0.8, sw, 1.7);
    }
    ctx.restore();

    // 2. Dashed Electric Violet Outer Contour + Subtle Cyan Core Ring
    ctx.globalAlpha = alpha;
    buildContourPath(outerR, 0);
    ctx.strokeStyle = pulse > 0.5 ? '#C49BFF' : '#B184FF';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    buildContourPath(coreR, 0.25);
    ctx.strokeStyle = `rgba(124, 238, 255, ${(0.45 + pulse * 0.25).toFixed(3)})`;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. Crisp 2-Line Centered Badge: `ION STATIC` / `NO DMG · COMMS JAM`
    const line1 = 'ION STATIC';
    const line2 = 'NO DMG · COMMS JAM';
    ctx.font = font('data', 12);
    const w1 = ctx.measureText(line1).width;
    ctx.font = font('micro', 12);
    const w2 = ctx.measureText(line2).width;
    const bw = Math.ceil(Math.max(w1, w2)) + 16;
    const bh = 34;
    const bx = Math.round(center.x - bw * 0.5);
    const by = Math.round(center.y - bh * 0.5);

    ctx.fillStyle = 'rgba(18, 8, 38, 0.92)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#B184FF';
    ctx.lineWidth = 1.3;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font('data', 12);
    ctx.fillStyle = '#E6D4FF';
    ctx.fillText(line1, center.x, by + 11);

    ctx.font = font('micro', 12);
    ctx.fillStyle = '#7CEEFF';
    ctx.fillText(line2, center.x, by + 25.5);

    staticObstacles.push({ x: bx - 3, y: by - 3, w: bw + 6, h: bh + 6 });
    ctx.restore();
  }

  // ===========================================================================
  // INTERACTIVE TRAINING DRILL SCOPE GUIDES (RINGS + MARCHING VECTOR ARROWS)
  // ===========================================================================
  private drawTutorialScopeGuides(
    ctx: CanvasRenderingContext2D,
    tut: ApproachTutorialOverlayState,
    vp: ViewportRect,
    toPt: (x: number, y: number) => Vec2,
    pxPerNm: number,
    timeSec: number,
    staticObstacles: PlacedRect[]
  ): void {
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 6.0);
    const overlapsObstacle = (rect: PlacedRect): boolean =>
      staticObstacles.some((ob) => rectOverlapArea(rect, ob) > 0);

    ctx.save();

    // 1. Pulsing focus highlight rings
    for (const ring of tut.highlightRings) {
      const p = toPt(ring.posNm.x, ring.posNm.y);
      const r = Math.max(14, ring.radiusNm * pxPerNm);
      const breatheR = r + pulse * 4;

      // Soft outer halo
      ctx.save();
      ctx.strokeStyle = ring.color;
      ctx.globalAlpha = 0.28 + pulse * 0.25;
      ctx.lineWidth = 5.0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, breatheR, 0, Math.PI * 2);
      ctx.stroke();

      // Crisp dashed focus circle
      ctx.globalAlpha = 0.92;
      ctx.lineWidth = 2.0;
      ctx.setLineDash([8, 5]);
      ctx.lineDashOffset = -timeSec * 24;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      if (ring.label) {
        ctx.font = font('micro', 12);
        const tw = Math.ceil(ctx.measureText(ring.label).width);
        const bw = tw + 14;
        const bh = 20;
        const lx = Math.max(vp.x + 8, Math.min(vp.x + vp.width - bw - 8, Math.round(p.x - bw * 0.5)));
        let ly = Math.max(vp.y + 8, Math.min(vp.y + vp.height - bh - 8, Math.round(p.y - r - 26)));

        // If above-ring placement touches the top Tutorial Directive Card or another pill, flip below ring
        if (overlapsObstacle({ x: lx, y: ly, w: bw, h: bh })) {
          const altY = Math.min(vp.y + vp.height - bh - 8, Math.round(p.y + r + 8));
          if (!overlapsObstacle({ x: lx, y: altY, w: bw, h: bh })) {
            ly = altY;
          }
        }

        ctx.fillStyle = 'rgba(4, 18, 22, 0.94)';
        ctx.fillRect(lx, ly, bw, bh);
        ctx.strokeStyle = ring.color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(lx + 0.5, ly + 0.5, bw - 1, bh - 1);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = ring.color;
        ctx.fillText(ring.label, lx + bw * 0.5, ly + bh * 0.5 + 0.5);

        staticObstacles.push({ x: lx - 3, y: ly - 3, w: bw + 6, h: bh + 6 });
      }
    }

    // 2. Animated marching dashed curved/straight guide vector arrows
    for (const arrow of tut.guideArrows) {
      const p0 = toPt(arrow.fromNm.x, arrow.fromNm.y);
      const p1 = toPt(arrow.toNm.x, arrow.toNm.y);
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy);
      if (len < 12) continue;

      const ux = dx / len;
      const uy = dy / len;
      const px = -uy;
      const py = ux;

      // Subtle graceful bow on longer arrows so the guide feels fluid and readable
      const bend = len > 90 ? Math.min(28, len * 0.14) : 0;
      const ctrlX = (p0.x + p1.x) * 0.5 + px * bend;
      const ctrlY = (p0.y + p1.y) * 0.5 + py * bend;

      // Soft outer glow pass
      ctx.save();
      ctx.strokeStyle = arrow.color;
      ctx.globalAlpha = 0.24 + pulse * 0.16;
      ctx.lineWidth = 6.0;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(ctrlX, ctrlY, p1.x, p1.y);
      ctx.stroke();

      // Animated marching dashed stroke
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([10, 7]);
      ctx.lineDashOffset = -timeSec * 48;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(ctrlX, ctrlY, p1.x, p1.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Origin beacon dot
      ctx.fillStyle = arrow.color;
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, 4.0 + pulse * 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Pulsing arrowhead aligned cleanly along curve tangent at endpoint p1
      const tanX = p1.x - ctrlX;
      const tanY = p1.y - ctrlY;
      const tanLen = Math.max(1, Math.hypot(tanX, tanY));
      const tux = tanX / tanLen;
      const tuy = tanY / tanLen;
      const tpx = -tuy;
      const tpy = tux;
      const headLen = 12 + pulse * 2.5;
      const headW = 6.5 + pulse * 1.2;

      ctx.fillStyle = arrow.color;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p1.x - tux * headLen + tpx * headW, p1.y - tuy * headLen + tpy * headW);
      ctx.lineTo(p1.x - tux * headLen * 0.72, p1.y - tuy * headLen * 0.72);
      ctx.lineTo(p1.x - tux * headLen - tpx * headW, p1.y - tuy * headLen - tpy * headW);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      if (arrow.label) {
        // Evaluate quadratic curve midpoint (t = 0.5)
        const midX = 0.25 * p0.x + 0.5 * ctrlX + 0.25 * p1.x;
        const midY = 0.25 * p0.y + 0.5 * ctrlY + 0.25 * p1.y;
        ctx.font = font('micro', 12);
        const tw = Math.ceil(ctx.measureText(arrow.label).width);
        const bw = tw + 14;
        const bh = 20;
        const lx = Math.max(
          vp.x + 8,
          Math.min(vp.x + vp.width - bw - 8, Math.round(midX - bw * 0.5))
        );
        let ly = Math.max(
          vp.y + 8,
          Math.min(vp.y + vp.height - bh - 8, Math.round(midY - bh - 8))
        );

        if (overlapsObstacle({ x: lx, y: ly, w: bw, h: bh })) {
          const altY = Math.min(vp.y + vp.height - bh - 8, Math.round(midY + 12));
          if (!overlapsObstacle({ x: lx, y: altY, w: bw, h: bh })) {
            ly = altY;
          }
        }

        ctx.fillStyle = 'rgba(4, 18, 22, 0.94)';
        ctx.fillRect(lx, ly, bw, bh);
        ctx.strokeStyle = arrow.color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(lx + 0.5, ly + 0.5, bw - 1, bh - 1);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(arrow.label, lx + bw * 0.5, ly + bh * 0.5 + 0.5);

        staticObstacles.push({ x: lx - 3, y: ly - 3, w: bw + 6, h: bh + 6 });
      }
    }

    ctx.restore();
  }

  // ===========================================================================
  // VECTOR PATHS (COMMITTED + ACTIVE DRAGGED MAGNETIC SNAP PREVIEW)
  // ===========================================================================
  private drawCommittedVectorPath(
    ctx: CanvasRenderingContext2D,
    craft: ApproachAircraft,
    toPt: (x: number, y: number) => Vec2,
    timeSec: number
  ): void {
    if (craft.waypoints.length === 0 || craft.state === 'LANDING') return;

    const isLocked = craft.lockedTarget !== null;
    const isHold = craft.assignedHoldFix !== null;
    const nmPts: Vec2[] = [{ x: craft.x, y: craft.y }, ...craft.waypoints];
    const startPt = toPt(craft.x, craft.y);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(startPt.x, startPt.y);
    const screenPts: Vec2[] = [startPt];
    for (const wp of craft.waypoints) {
      const sp = toPt(wp.x, wp.y);
      screenPts.push(sp);
      ctx.lineTo(sp.x, sp.y);
    }

    if (craft.inStorm) {
      // Diegetic reassurance: committed flight path remains clearly visible through Ion Static in dashed electric cyan!
      ctx.strokeStyle = 'rgba(155, 107, 255, 0.30)';
      ctx.lineWidth = 5.0;
      ctx.setLineDash([]);
      ctx.stroke();

      ctx.strokeStyle = '#7CEEFF';
      ctx.lineWidth = 2.1;
      ctx.setLineDash([7, 5]);
    } else if (craft.isDeparture || craft.state === 'DEPARTING') {
      ctx.strokeStyle = 'rgba(85, 255, 238, 0.80)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([7, 5]);
    } else if (isLocked) {
      ctx.strokeStyle = craft.isEmergency
        ? Math.sin(timeSec * 12) > 0
          ? '#FFE48F'
          : '#44FF77'
        : craft.isMedevac
          ? '#8CF8FF'
          : 'rgba(68, 255, 119, 0.86)';
      ctx.lineWidth = 2.0;
      ctx.setLineDash([]);
    } else if (isHold) {
      ctx.strokeStyle = isCrt1979Typography()
        ? 'rgba(164, 255, 230, 0.84)'
        : 'rgba(126, 240, 208, 0.82)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([7, 5]);
    } else {
      ctx.strokeStyle = craft.isMedevac
        ? 'rgba(168, 252, 255, 0.82)'
        : craft.kind === 'HEAVY'
          ? 'rgba(255, 176, 0, 0.68)'
          : craft.kind === 'TUG'
            ? 'rgba(76, 238, 255, 0.68)'
            : 'rgba(158, 247, 184, 0.68)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 6]);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Pre-compute cumulative arc lengths in NM so dense kinematic turn curves never bead with dots!
    const cumNm: number[] = [0];
    for (let i = 1; i < nmPts.length; i++) {
      const segNm = Math.hypot(nmPts[i].x - nmPts[i - 1].x, nmPts[i].y - nmPts[i - 1].y);
      cumNm.push(cumNm[i - 1] + segNm);
    }
    const totalNm = cumNm[cumNm.length - 1];

    const chevronColor = craft.inStorm
      ? '#7CEEFF'
      : craft.isDeparture
        ? '#55FFEE'
        : craft.isMedevac
          ? '#D8FFFF'
          : isLocked
            ? THEME.TEXT_BRIGHT
            : isHold
              ? '#7EF0D0'
              : 'rgba(158, 247, 184, 0.76)';

    const nodeColor = craft.inStorm
      ? '#7CEEFF'
      : craft.isDeparture
        ? '#55FFEE'
        : craft.isMedevac
          ? '#FFFFFF'
          : isLocked
            ? THEME.TEXT_PRIMARY
            : isHold
              ? '#7EF0D0'
              : THEME.TEXT_BRIGHT;

    // 1. Sleek arc-spaced directional chevrons along smooth curves & straight legs (~2.6 NM spacing)
    let nextArrowNm = Math.min(totalNm * 0.5, 2.2);
    if (totalNm >= 1.8) {
      ctx.strokeStyle = chevronColor;
      ctx.lineWidth = 1.4;
      for (let i = 1; i < nmPts.length; i++) {
        const s0 = cumNm[i - 1];
        const s1 = cumNm[i];
        const segNm = s1 - s0;
        if (segNm < 1e-4) continue;
        while (nextArrowNm <= s1 && nextArrowNm <= totalNm - 0.85) {
          const t = (nextArrowNm - s0) / segNm;
          const prev = screenPts[i - 1];
          const cur = screenPts[i];
          const dx = cur.x - prev.x;
          const dy = cur.y - prev.y;
          const segPx = Math.hypot(dx, dy);
          if (segPx >= 2) {
            const mx = prev.x + dx * t;
            const my = prev.y + dy * t;
            const ux = dx / segPx;
            const uy = dy / segPx;
            const px = -uy;
            const py = ux;
            ctx.beginPath();
            ctx.moveTo(mx - ux * 4 + px * 3.5, my - uy * 4 + py * 3.5);
            ctx.lineTo(mx + ux * 3.5, my + uy * 3.5);
            ctx.lineTo(mx - ux * 4 - px * 3.5, my - uy * 4 - py * 3.5);
            ctx.stroke();
          }
          nextArrowNm += 2.6;
        }
      }
    }

    // 2. Subtle spaced node dots (>= 2.2 NM apart or distinct turns) + crisp terminal waypoint dot
    let lastNodeNm = 0;
    ctx.fillStyle = nodeColor;
    for (let i = 1; i < screenPts.length; i++) {
      const isLast = i === screenPts.length - 1;
      const cur = screenPts[i];
      if (isLast) {
        ctx.beginPath();
        ctx.arc(cur.x, cur.y, 3.3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      const arcFromLast = cumNm[i] - lastNodeNm;
      const arcToEnd = totalNm - cumNm[i];
      if (arcToEnd < 1.15) continue;

      let isSharpCorner = false;
      if (arcFromLast >= 1.5) {
        const a = nmPts[i - 1];
        const b = nmPts[i];
        const c = nmPts[i + 1];
        const v1x = b.x - a.x;
        const v1y = b.y - a.y;
        const v2x = c.x - b.x;
        const v2y = c.y - b.y;
        const l1 = Math.hypot(v1x, v1y);
        const l2 = Math.hypot(v2x, v2y);
        if (l1 > 0.05 && l2 > 0.05) {
          const dot = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
          isSharpCorner = Math.acos(dot) >= 0.42; // >= ~24° turn inflection
        }
      }

      if (arcFromLast >= 2.2 || isSharpCorner) {
        ctx.beginPath();
        ctx.arc(cur.x, cur.y, 2.0, 0, Math.PI * 2);
        ctx.fill();
        lastNodeNm = cumNm[i];
      }
    }

    ctx.restore();
  }

  private drawActiveDragVector(
    ctx: CanvasRenderingContext2D,
    sim: ApproachSimulation,
    craft: ApproachAircraft,
    dragState: ApproachDragVisualState,
    vp: ViewportRect,
    toPt: (x: number, y: number) => Vec2,
    pxPerNm: number,
    timeSec: number
  ): void {
    const preview = dragState.preview;
    const ptsNm =
      preview && preview.waypoints.length > 0 ? preview.waypoints : dragState.rawWaypointsNm;
    const startPt = toPt(craft.x, craft.y);
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 12);

    const entersRestricted = Boolean(preview?.entersRestrictedZone);
    const isLandingSnap =
      preview !== null &&
      (preview.snapKind === 'ILS_LOCK' ||
        preview.snapKind === 'PAD_LOCK' ||
        preview.snapKind === 'CRADLE_LOCK');
    const isHoldSnap = preview?.snapKind === 'HOLD_FIX';
    const isHoldFull = Boolean(preview?.holdFixFull);
    const isStormBlocked = Boolean(preview?.blockedByStorm);
    const isRejected = preview?.snapKind === 'UNSTABLE_REJECT';

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (ptsNm.length > 0) {
      const fullNm: Vec2[] = [{ x: craft.x, y: craft.y }, ...ptsNm];
      const screenPts: Vec2[] = [startPt];
      ctx.beginPath();
      ctx.moveTo(startPt.x, startPt.y);
      for (const wp of ptsNm) {
        const sp = toPt(wp.x, wp.y);
        screenPts.push(sp);
        ctx.lineTo(sp.x, sp.y);
      }

      if (entersRestricted) {
        // Urgent crimson/amber warning glow + pulsing hazard stroke whenever path crosses R-118!
        ctx.strokeStyle = 'rgba(255, 51, 24, 0.36)';
        ctx.lineWidth = 7.0;
        ctx.setLineDash([]);
        ctx.stroke();

        ctx.strokeStyle = pulse > 0.45 ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
        ctx.lineWidth = 2.6;
        ctx.setLineDash([8, 4]);
        ctx.stroke();
      } else if (isLandingSnap) {
        ctx.strokeStyle = 'rgba(68, 255, 119, 0.34)';
        ctx.lineWidth = 6.5;
        ctx.setLineDash([]);
        ctx.stroke();

        ctx.strokeStyle = '#6BFF95';
        ctx.lineWidth = 2.6;
        ctx.stroke();
      } else if (isHoldSnap) {
        ctx.strokeStyle = 'rgba(126, 240, 208, 0.32)';
        ctx.lineWidth = 6.0;
        ctx.setLineDash([]);
        ctx.stroke();

        ctx.strokeStyle = pulse > 0.5 ? '#A4FFE6' : '#7EF0D0';
        ctx.lineWidth = 2.4;
        ctx.stroke();
      } else if (isHoldFull) {
        ctx.strokeStyle = pulse > 0.45 ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;
        ctx.lineWidth = 2.4;
        ctx.setLineDash([7, 5]);
        ctx.stroke();
      } else if (isStormBlocked) {
        ctx.strokeStyle = pulse > 0.45 ? '#7CEEFF' : '#B184FF';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([6, 5]);
        ctx.stroke();
      } else if (isRejected) {
        ctx.strokeStyle = pulse > 0.45 ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER;
        ctx.lineWidth = 2.4;
        ctx.setLineDash([7, 5]);
        ctx.stroke();
      } else {
        ctx.strokeStyle = craft.isDeparture
          ? '#55FFEE'
          : craft.isMedevac
            ? '#D8FFFF'
            : THEME.TEXT_BRIGHT;
        ctx.lineWidth = 2.0;
        ctx.setLineDash([8, 6]);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Sleek spaced directional chevrons along the live kinematic turn curve (zero beaded dots!)
      const cumNm: number[] = [0];
      for (let i = 1; i < fullNm.length; i++) {
        cumNm.push(
          cumNm[i - 1] + Math.hypot(fullNm[i].x - fullNm[i - 1].x, fullNm[i].y - fullNm[i - 1].y)
        );
      }
      const totalNm = cumNm[cumNm.length - 1];
      if (totalNm >= 2.0) {
        const chevCol = entersRestricted
          ? '#FF947D'
          : isLandingSnap
            ? '#B8FFCC'
            : isHoldSnap
              ? '#7EF0D0'
              : isHoldFull
                ? THEME.ACCENT_AMBER_HI
                : isStormBlocked
                  ? '#7CEEFF'
                  : isRejected
                    ? THEME.ACCENT_AMBER_HI
                    : craft.isDeparture
                      ? '#55FFEE'
                      : 'rgba(218, 255, 228, 0.85)';
        ctx.strokeStyle = chevCol;
        ctx.lineWidth = 1.5;
        let nextArrowNm = 2.2;
        for (let i = 1; i < fullNm.length; i++) {
          const s0 = cumNm[i - 1];
          const s1 = cumNm[i];
          const segNm = s1 - s0;
          if (segNm < 1e-4) continue;
          while (nextArrowNm <= s1 && nextArrowNm <= totalNm - 0.9) {
            const t = (nextArrowNm - s0) / segNm;
            const prev = screenPts[i - 1];
            const cur = screenPts[i];
            const dx = cur.x - prev.x;
            const dy = cur.y - prev.y;
            const segPx = Math.hypot(dx, dy);
            if (segPx >= 2) {
              const mx = prev.x + dx * t;
              const my = prev.y + dy * t;
              const ux = dx / segPx;
              const uy = dy / segPx;
              const px = -uy;
              const py = ux;
              ctx.beginPath();
              ctx.moveTo(mx - ux * 4.2 + px * 3.6, my - uy * 4.2 + py * 3.6);
              ctx.lineTo(mx + ux * 3.8, my + uy * 3.8);
              ctx.lineTo(mx - ux * 4.2 - px * 3.6, my - uy * 4.2 - py * 3.6);
              ctx.stroke();
            }
            nextArrowNm += 2.6;
          }
        }
      }

      // Subtle terminal waypoint dot when dragging an open tactical vector
      if (!isLandingSnap && !isHoldSnap) {
        const lastSp = screenPts[screenPts.length - 1];
        ctx.fillStyle = entersRestricted
          ? THEME.ALERT_RED_STROKE
          : isHoldFull
            ? THEME.ACCENT_AMBER_HI
            : isStormBlocked
              ? '#7CEEFF'
              : isRejected
                ? THEME.ACCENT_AMBER_HI
                : craft.isDeparture
                  ? '#55FFEE'
                  : THEME.TEXT_BRIGHT;
        ctx.beginPath();
        ctx.arc(lastSp.x, lastSp.y, 3.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Glowing lock ring + crisp status callout badge at snap point or cursor
    const anchorNm =
      preview?.snapPoint ??
      (ptsNm.length > 0 ? ptsNm[ptsNm.length - 1] : dragState.cursorNm ?? { x: craft.x, y: craft.y });
    const anchorPt = toPt(anchorNm.x, anchorNm.y);

    let extraPillOffset = 0;
    if (isLandingSnap) {
      const ringR = Math.max(12, 0.55 * pxPerNm) + pulse * 3.5;
      ctx.strokeStyle = '#9EF7B8';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(anchorPt.x, anchorPt.y, ringR, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = THEME.TEXT_PRIMARY;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(anchorPt.x, anchorPt.y, ringR + 5, 0, Math.PI * 2);
      ctx.stroke();

      const snapLabel =
        preview!.snapKind === 'ILS_LOCK'
          ? preview!.interceptAngleDeg !== null
            ? `ILS LOCK · ${Math.round(preview!.interceptAngleDeg)}°`
            : 'ILS LOCK'
          : preview!.snapKind === 'PAD_LOCK'
            ? 'PAD α LOCK'
            : 'CRADLE LOCK';
      this.drawCursorCalloutPill(ctx, vp, anchorPt.x, anchorPt.y - ringR - 14, snapLabel, 'green');
      extraPillOffset = ringR + 38;
    } else if (isHoldFull) {
      const ringR = Math.max(12, 0.58 * pxPerNm) + pulse * 3;
      ctx.strokeStyle = pulse > 0.45 ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(anchorPt.x, anchorPt.y, ringR, 0, Math.PI * 2);
      ctx.stroke();
      this.drawCursorCalloutPill(
        ctx,
        vp,
        anchorPt.x,
        anchorPt.y - ringR - 14,
        'HOLD FULL 3/3',
        'amber'
      );
      extraPillOffset = ringR + 38;
    } else if (isHoldSnap && preview?.holdFix) {
      const occ = sim.getFixStackOccupancy(preview.holdFix);
      const ringR = Math.max(12, 0.58 * pxPerNm) + pulse * 3;
      ctx.strokeStyle = '#7EF0D0';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(anchorPt.x, anchorPt.y, ringR, 0, Math.PI * 2);
      ctx.stroke();
      this.drawCursorCalloutPill(
        ctx,
        vp,
        anchorPt.x,
        anchorPt.y - ringR - 14,
        `0.35× FUEL · STACK ${occ.count}/${occ.max}`,
        'cyan'
      );
      extraPillOffset = ringR + 38;
    } else if (isStormBlocked) {
      this.drawCursorCalloutPill(
        ctx,
        vp,
        anchorPt.x,
        anchorPt.y - 20,
        'COMMS JAM · NO DMG',
        'violet'
      );
      extraPillOffset = 44;
    } else if (isRejected) {
      const msg = preview?.rejectReason ?? 'UNSTABLE APPROACH';
      this.drawCursorCalloutPill(ctx, vp, anchorPt.x, anchorPt.y - 20, msg, 'red');
      extraPillOffset = 44;
    }

    if (entersRestricted) {
      const cursorPt = dragState.cursorNm ? toPt(dragState.cursorNm.x, dragState.cursorNm.y) : anchorPt;
      const pillY = extraPillOffset > 0 ? anchorPt.y - extraPillOffset : cursorPt.y - 22;
      const pillX = extraPillOffset > 0 ? anchorPt.x : cursorPt.x;
      this.drawCursorCalloutPill(ctx, vp, pillX, pillY, 'R-118 RESTRICTED!', 'red');
    }

    ctx.restore();
  }

  private drawCursorCalloutPill(
    ctx: CanvasRenderingContext2D,
    vp: ViewportRect,
    cx: number,
    cy: number,
    text: string,
    tone: 'green' | 'cyan' | 'amber' | 'violet' | 'red'
  ): void {
    ctx.save();
    ctx.font = font('micro', 12);
    const w = Math.ceil(ctx.measureText(text).width) + 14;
    const h = 20;
    const x = Math.max(vp.x + 6, Math.min(vp.x + vp.width - w - 6, Math.round(cx - w * 0.5)));
    const y = Math.max(vp.y + 6, Math.min(vp.y + vp.height - h - 6, Math.round(cy - h * 0.5)));

    const colors =
      tone === 'green'
        ? { bg: 'rgba(6, 36, 18, 0.94)', border: THEME.TEXT_PRIMARY, fg: THEME.TEXT_BRIGHT }
        : tone === 'cyan'
          ? { bg: 'rgba(6, 34, 36, 0.94)', border: '#7EF0D0', fg: '#A4FFE6' }
          : tone === 'amber'
            ? { bg: THEME.ACCENT_AMBER_BG, border: THEME.ACCENT_AMBER_HI, fg: THEME.ACCENT_AMBER_HI }
            : tone === 'violet'
              ? { bg: 'rgba(22, 10, 46, 0.94)', border: '#B184FF', fg: '#7CEEFF' }
              : { bg: THEME.ALERT_RED_BG, border: THEME.ALERT_RED_STROKE, fg: '#FFE8E2' };

    ctx.fillStyle = colors.bg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colors.fg;
    ctx.fillText(text, x + w * 0.5, y + h * 0.5 + 0.5);
    ctx.restore();
  }

  // ===========================================================================
  // PRIMARY-ONLY BOGEYS (INFO DELTA+)
  // ===========================================================================
  private drawPrimaryBogey(
    ctx: CanvasRenderingContext2D,
    bogey: PrimaryBogey,
    toPt: (x: number, y: number) => Vec2,
    timeSec: number,
    staticObstacles: PlacedRect[]
  ): void {
    const p = toPt(bogey.x, bogey.y);
    const pulse = 0.45 + 0.55 * Math.sin(timeSec * 5.2 + bogey.id);
    const sweepBoost = 0.48 + bogey.sweptHighlight * 0.52;

    ctx.save();

    for (let i = 0; i < bogey.trail.length; i++) {
      const tp = toPt(bogey.trail[i].x, bogey.trail[i].y);
      const frac = (i + 1) / Math.max(1, bogey.trail.length);
      ctx.fillStyle = bogey.inConflict
        ? `rgba(255, 98, 71, ${(frac * 0.36).toFixed(3)})`
        : `rgba(180, 168, 92, ${(frac * 0.32 * sweepBoost).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, 1.8 + frac * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    const rad = magneticDegToCanvasRad(bogey.headingDeg);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(rad);
    ctx.fillStyle = bogey.inConflict
      ? `rgba(255, 68, 42, ${(0.55 + pulse * 0.4).toFixed(3)})`
      : `rgba(220, 198, 108, ${(0.42 + pulse * 0.38 * sweepBoost).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, 7.5, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = bogey.inConflict ? '#FFE4DC' : 'rgba(255, 224, 140, 0.72)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    ctx.font = font('micro', 12);
    const tag = 'PRIM / NO XPDR';
    const tw = Math.ceil(ctx.measureText(tag).width);
    const tx = Math.round(p.x + 12);
    const ty = Math.round(p.y - 12);
    ctx.fillStyle = 'rgba(18, 16, 6, 0.84)';
    ctx.fillRect(tx - 3, ty - 8, tw + 6, 16);
    ctx.fillStyle = bogey.inConflict ? THEME.ALERT_RED_TEXT : 'rgba(226, 204, 122, 0.88)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, tx, ty + 0.5);

    staticObstacles.push({ x: tx - 4, y: ty - 9, w: tw + 8, h: 18 });
    ctx.restore();
  }

  // ===========================================================================
  // 4 DISTINCT AIRCRAFT VECTOR SILHOUETTES + DEPARTURE CLIMB VECTOR + TRAILS
  // ===========================================================================
  private getCraftColor(craft: ApproachAircraft, timeSec: number): string {
    if (craft.isEmergency || craft.inRestrictedZone) {
      return Math.sin(timeSec * 14) > 0 ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER_HI;
    }
    if (craft.isMedevac) {
      return Math.sin(timeSec * 8) > 0 ? '#FFFFFF' : '#8CF8FF';
    }
    if (craft.isDeparture || craft.state === 'DEPARTING') return '#55FFEE';
    if (craft.kind === 'HEAVY') return THEME.ACCENT_AMBER;
    if (craft.kind === 'TUG') return THEME.ACCENT_CYAN;
    return THEME.TEXT_PRIMARY;
  }

  private drawAircraftBlip(
    ctx: CanvasRenderingContext2D,
    craft: ApproachAircraft,
    toPt: (x: number, y: number) => Vec2,
    pxPerNm: number,
    timeSec: number,
    isHovered: boolean,
    isSelected: boolean
  ): void {
    const p = toPt(craft.x, craft.y);
    const baseCol = this.getCraftColor(craft, timeSec);
    const landingScale =
      craft.state === 'LANDING' ? Math.max(0.45, 1 - craft.landingProgress * 0.55) : 1;
    const alpha =
      craft.state === 'LANDING' ? Math.max(0.2, 1 - craft.landingProgress * 0.85) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;

    // 0. Clean cyan-green climb-out heading vector (`DEP`) for departing aircraft
    if (craft.state === 'DEPARTING' || craft.isDeparture) {
      const climbVec = headingDegToUnitVec(craft.targetHeadingDeg);
      const climbLenNm = 2.4;
      const pEnd = toPt(craft.x + climbVec.x * climbLenNm, craft.y + climbVec.y * climbLenNm);
      ctx.save();
      ctx.strokeStyle = 'rgba(85, 255, 238, 0.72)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(pEnd.x, pEnd.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Small climb-out arrowhead + compact `DEP` tag at vector tip
      const dx = pEnd.x - p.x;
      const dy = pEnd.y - p.y;
      const dLen = Math.max(1, Math.hypot(dx, dy));
      const ux = dx / dLen;
      const uy = dy / dLen;
      const px = -uy;
      const py = ux;
      ctx.strokeStyle = '#55FFEE';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pEnd.x - ux * 6 + px * 4, pEnd.y - uy * 6 + py * 4);
      ctx.lineTo(pEnd.x, pEnd.y);
      ctx.lineTo(pEnd.x - ux * 6 - px * 4, pEnd.y - uy * 6 - py * 4);
      ctx.stroke();

      if (pxPerNm >= 14) {
        ctx.font = font('micro', 12);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(4, 24, 26, 0.82)';
        ctx.fillRect(pEnd.x - 14, pEnd.y - 18, 28, 14);
        ctx.fillStyle = '#55FFEE';
        ctx.fillText('DEP', pEnd.x, pEnd.y - 10.5);
      }
      ctx.restore();
    }

    // 1. Phosphor radar history breadcrumb pips
    for (let i = 0; i < craft.trail.length; i++) {
      const tp = toPt(craft.trail[i].x, craft.trail[i].y);
      const frac = (i + 1) / Math.max(1, craft.trail.length);
      ctx.fillStyle = craft.isEmergency || craft.inRestrictedZone
        ? `rgba(255, 98, 71, ${(frac * 0.45).toFixed(3)})`
        : craft.isMedevac
          ? `rgba(176, 252, 255, ${(frac * 0.54).toFixed(3)})`
          : craft.isDeparture
            ? `rgba(85, 255, 238, ${(frac * 0.46).toFixed(3)})`
            : craft.kind === 'HEAVY'
              ? `rgba(255, 176, 0, ${(frac * 0.42).toFixed(3)})`
              : craft.kind === 'TUG'
                ? `rgba(76, 238, 255, ${(frac * 0.42).toFixed(3)})`
                : `rgba(68, 255, 119, ${(frac * 0.44).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, 1.3 + frac * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Priority MAYDAY or R-118 Violation pulsing halo
    if (craft.isEmergency || craft.inRestrictedZone) {
      const pulse = 0.5 + 0.5 * Math.sin(timeSec * 12);
      ctx.strokeStyle = pulse > 0.5 ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14 + pulse * 6, 0, Math.PI * 2);
      ctx.stroke();
    } else if (craft.isMedevac) {
      // Distinct pulsing white-cyan MEDEVAC PRIORITY aura + crisp medical cross (`+`) emblem
      const medExpress = craft.medevacExpressTimerSec > 0;
      const pulse = 0.5 + 0.5 * Math.sin(timeSec * (medExpress ? 8.5 : 4.2));
      ctx.save();
      ctx.fillStyle = `rgba(124, 238, 255, ${(0.08 + pulse * (medExpress ? 0.14 : 0.06)).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13 + pulse * 4.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = medExpress
        ? pulse > 0.45
          ? '#FFFFFF'
          : '#7CEEFF'
        : 'rgba(176, 252, 255, 0.72)';
      ctx.lineWidth = medExpress ? 1.9 : 1.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12.5 + pulse * 3.8, 0, Math.PI * 2);
      ctx.stroke();

      // Upright white-cyan medical cross (`+`) badge at top-right shoulder of the blip
      const cxCross = p.x + 11.5;
      const cyCross = p.y - 11.5;
      ctx.fillStyle = 'rgba(4, 28, 36, 0.94)';
      ctx.beginPath();
      ctx.arc(cxCross, cyCross, 6.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = medExpress ? '#FFFFFF' : '#7CEEFF';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.fillStyle = medExpress && pulse > 0.5 ? '#FFFFFF' : '#8CF8FF';
      ctx.fillRect(cxCross - 1.35, cyCross - 4.2, 2.7, 8.4);
      ctx.fillRect(cxCross - 4.2, cyCross - 1.35, 8.4, 2.7);
      ctx.restore();
    }

    // 2.5 Non-lethal electric violet-cyan RF jam halo while inside Ion Static cloud
    if (craft.inStorm && !craft.inRestrictedZone) {
      const rfPulse = 0.5 + 0.5 * Math.sin(timeSec * 9.0 + craft.id);
      ctx.save();
      ctx.strokeStyle = rfPulse > 0.5 ? '#7CEEFF' : '#B184FF';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13.5 + rfPulse * 2.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 3. Hover / Drag / Strip-Ping / Check-in acquisition highlight ring
    const pingActive = craft.pingTimer > 0;
    const checkinFlash = craft.checkinFlashTimer > 0;
    if (isSelected || isHovered || pingActive || checkinFlash) {
      const pulse = 0.5 + 0.5 * Math.sin(timeSec * 11);
      const ringR = pingActive ? 17 + pulse * 8 : isSelected ? 16 : 14;
      ctx.strokeStyle = pingActive
        ? THEME.ACCENT_AMBER_HI
        : isSelected
          ? '#FFFFFF'
          : THEME.TEXT_BRIGHT;
      ctx.lineWidth = pingActive || isSelected ? 2.2 : 1.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
      ctx.stroke();

      if (pingActive) {
        const waveFrac = (timeSec * 1.8) % 1;
        ctx.strokeStyle = `rgba(255, 228, 143, ${(1 - waveFrac).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 12 + waveFrac * 24, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 4. Sweep phosphor bloom glow
    if (craft.sweptHighlight > 0.15) {
      ctx.fillStyle = `rgba(158, 247, 184, ${(craft.sweptHighlight * 0.22).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11 * landingScale, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Distinct Vector Aircraft Silhouette oriented along headingDeg (local +X = nose forward)
    const rotRad = magneticDegToCanvasRad(craft.headingDeg);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(rotRad);
    ctx.scale(landingScale, landingScale);

    // Subtle velocity vector leader nose tick
    ctx.strokeStyle = baseCol;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(15, 0);
    ctx.stroke();

    ctx.fillStyle = baseCol;
    ctx.strokeStyle = '#030805';
    ctx.lineWidth = 1.2;

    if (craft.kind === 'DROPSHIP') {
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-6, -6.5);
      ctx.lineTo(-3, 0);
      ctx.lineTo(-6, 6.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (craft.kind === 'HEAVY') {
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(2, -4.5);
      ctx.lineTo(-6, -9.5);
      ctx.lineTo(-8.5, -7);
      ctx.lineTo(-5.5, 0);
      ctx.lineTo(-8.5, 7);
      ctx.lineTo(-6, 9.5);
      ctx.lineTo(2, 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (craft.kind === 'TUG') {
      ctx.beginPath();
      ctx.moveTo(8.5, 0);
      ctx.lineTo(0, -6.8);
      ctx.lineTo(-8, 0);
      ctx.lineTo(0, 6.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-6.5, -7.2);
      ctx.lineTo(-3.2, 0);
      ctx.lineTo(-6.5, 7.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
    ctx.restore();
  }

  // ===========================================================================
  // CONFLICT ALERT (CA) RED RINGS & CONNECTOR LINES (< 3 NM)
  // ===========================================================================
  private drawConflictAlerts(
    ctx: CanvasRenderingContext2D,
    sim: ApproachSimulation,
    toPt: (x: number, y: number) => Vec2,
    pxPerNm: number,
    timeSec: number,
    staticObstacles: PlacedRect[]
  ): void {
    const blink = Math.sin(timeSec * 16) > -0.15;
    const wave = (timeSec * 2.2) % 1;
    const minRingR = Math.max(16, 1.45 * pxPerNm);
    const drawnRingKeys = new Set<string>();

    ctx.save();
    for (const pair of sim.conflictPairs) {
      const pA = toPt(pair.ax, pair.ay);
      const pB = toPt(pair.bx, pair.by);

      ctx.strokeStyle = blink ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
      ctx.lineWidth = 2.2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const endpoints: Array<{ key: string; pt: Vec2 }> = [
        { key: `A-${pair.idA}`, pt: pA },
        { key: `${pair.isBogeyB ? 'B' : 'A'}-${pair.idB}`, pt: pB },
      ];
      for (const ep of endpoints) {
        if (drawnRingKeys.has(ep.key)) continue;
        drawnRingKeys.add(ep.key);

        ctx.strokeStyle = blink ? 'rgba(255, 51, 24, 0.92)' : 'rgba(255, 128, 64, 0.55)';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.arc(ep.pt.x, ep.pt.y, minRingR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = `rgba(255, 51, 24, ${((1 - wave) * 0.72).toFixed(3)})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(ep.pt.x, ep.pt.y, 12 + wave * (minRingR * 1.15), 0, Math.PI * 2);
        ctx.stroke();
      }

      // Bold midpoint `CA <dist>NM` pill (registered in staticObstacles so Data Blocks avoid it!)
      const mx = (pA.x + pB.x) * 0.5;
      const my = (pA.y + pB.y) * 0.5;
      const caText = `CA ${pair.distanceNm.toFixed(1)}NM`;
      ctx.font = font('data', 12);
      const bw = Math.ceil(ctx.measureText(caText).width) + 12;
      const bh = 20;
      const bx = Math.round(mx - bw * 0.5);
      const by = Math.round(my - bh * 0.5);

      ctx.fillStyle = blink ? 'rgba(124, 18, 10, 0.96)' : 'rgba(64, 14, 8, 0.92)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = blink ? '#FF947D' : THEME.ALERT_RED_STROKE;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#FFF0EC';
      ctx.fillText(caText, mx, my + 0.5);

      staticObstacles.push({ x: bx - 3, y: by - 3, w: bw + 6, h: bh + 6 });
    }
    ctx.restore();
  }

  // ===========================================================================
  // SMART TETHERED 2-LINE ATC DATA BLOCKS (2 RINGS, HYSTERESIS, ZERO CLUTTER)
  // ===========================================================================
  private drawAtcDataBlocks(
    ctx: CanvasRenderingContext2D,
    sim: ApproachSimulation,
    vp: ViewportRect,
    toPt: (x: number, y: number) => Vec2,
    timeSec: number,
    hoveredCraftId: number | null,
    selectedCraftId: number | null,
    draggedCraftId: number | null,
    staticObstacles: readonly PlacedRect[]
  ): PlacedRect[] {
    const placedDataBlocks: PlacedRect[] = [];
    const blipPts = sim.aircraft.map((c) => ({ id: c.id, pt: toPt(c.x, c.y) }));
    const activeIds = new Set<number>();
    const blinkFast = Math.sin(timeSec * 14) > 0;

    // Sort urgent / selected / hovered craft first so they always win the cleanest slot
    const ordered = [...sim.aircraft].sort((a, b) => {
      const pri = (c: ApproachAircraft): number => {
        if (c.id === draggedCraftId || c.id === selectedCraftId) return 0;
        if (c.isEmergency || c.inRestrictedZone) return 1;
        if (c.inConflict || c.fuelStatus === 'BINGO') return 2;
        if (c.isMedevac && c.medevacExpressTimerSec > 0) return 2;
        if (c.pingTimer > 0 || c.id === hoveredCraftId) return 3;
        return 4;
      };
      return pri(a) - pri(b) || a.id - b.id;
    });

    const crt1979 = isCrt1979Typography();
    const holdMintCol = crt1979 ? '#A4FFE6' : '#7EF0D0';

    ctx.save();
    ctx.font = font('micro', 12);

    const candidateDirs: ReadonlyArray<{ dx: number; dy: number }> = [
      { dx: 1, dy: -0.75 }, // NE
      { dx: 1, dy: 0.75 }, // SE
      { dx: -1, dy: -0.75 }, // NW
      { dx: -1, dy: 0.75 }, // SW
      { dx: 1.15, dy: 0 }, // E
      { dx: -1.15, dy: 0 }, // W
      { dx: 0, dy: -1.15 }, // N
      { dx: 0, dy: 1.15 }, // S
    ];
    const offsetRings = [22, 38] as const;

    const minX = vp.x + 8;
    const maxX = vp.x + vp.width - 8;
    const minY = vp.y + 24;
    const maxY = vp.y + vp.height - 24;

    for (const craft of ordered) {
      if (craft.state === 'LANDING' && craft.landingProgress > 0.65) continue;
      activeIds.add(craft.id);

      const p = toPt(craft.x, craft.y);
      const isHighlight =
        craft.id === hoveredCraftId ||
        craft.id === selectedCraftId ||
        craft.id === draggedCraftId ||
        craft.pingTimer > 0;

      // Format authentic 2-line ATC radar tag
      let destShort: string;
      if (craft.lockedTarget === 'RWY_27') destShort = 'RWY27';
      else if (craft.lockedTarget === 'RWY_09') destShort = 'RWY09';
      else if (craft.lockedTarget === 'RWY_36') destShort = 'RWY36';
      else if (craft.lockedTarget === 'RWY_18') destShort = 'RWY18';
      else if (craft.lockedTarget === 'PAD_ALPHA') destShort = 'PAD α';
      else if (craft.lockedTarget === 'SALVAGE_CRADLE') destShort = 'CRADLE';
      else if (craft.kind === 'HEAVY') {
        destShort =
          sim.secondaryRunwayOpen && sim.activeSecondaryRunway
            ? `RWY${sim.primaryRunway}/${sim.activeSecondaryRunway}`
            : `RWY${sim.primaryRunway}`;
      } else if (craft.isMedevac) destShort = 'PAD/RWY';
      else if (craft.kind === 'DROPSHIP') destShort = 'PAD α';
      else if (craft.kind === 'TUG') destShort = 'CRADLE';
      else destShort = 'ANY PAD';

      const isHolding = craft.state === 'HOLDING' && craft.assignedHoldFix !== null;
      const holdAltFt =
        craft.holdAltitudeSlot !== null
          ? HOLD_ALTITUDE_SLOTS_FT[craft.holdAltitudeSlot] ??
            APPROACH_CONSTANTS.HOLD_STACK_BASE_ALT_FT +
              craft.holdAltitudeSlot * APPROACH_CONSTANTS.HOLD_STACK_STEP_ALT_FT
          : Math.round(craft.altitudeFt / 100) * 100;
      const holdFlTag = `FL${Math.round(holdAltFt / 100)}`;

      // Line 1:
      // - In Ion Static: `<CALLSIGN> | RF JAM`
      // - While Holding: `<CALLSIGN> | FL35` (or FL45/FL55)
      // - Normal: `<CALLSIGN> | <SPD>KT[↓/↑]` (with `✚` prefix on MEDEVAC!)
      const callsignLabel = craft.isMedevac
        ? `${SEMIOTIC_ICONS.CROSS} ${craft.callsign}`
        : craft.callsign;
      let line1Prefix: string;
      let speedSuffix = '';
      if (craft.inStorm && !craft.inRestrictedZone) {
        line1Prefix = `${callsignLabel} | RF JAM`;
      } else if (isHolding) {
        line1Prefix = `${callsignLabel} | ${holdFlTag}`;
      } else {
        line1Prefix = `${callsignLabel} | `;
        speedSuffix =
          craft.speedMode === 'SLOW'
            ? `${craft.speedKt}KT↓`
            : craft.speedMode === 'FAST'
              ? `${craft.speedKt}KT↑`
              : `${craft.speedKt}KT`;
      }
      const line1Full = `${line1Prefix}${speedSuffix}`;

      let line2: string;
      let line2Color: string = THEME.TEXT_SECONDARY;
      if (craft.inRestrictedZone) {
        line2 = 'R-118 VIOLATION!';
        line2Color = blinkFast ? '#FFF0EC' : THEME.ALERT_RED_TEXT;
      } else if (craft.inStorm) {
        const hasCommittedPath = craft.lockedTarget !== null || craft.assignedHoldFix !== null;
        line2 = hasCommittedPath ? 'LOCKED · PATH SAFE' : 'COMMS JAM · NO DMG';
        line2Color = '#7CEEFF';
      } else if (craft.state === 'DEPARTING' || craft.isDeparture) {
        line2 = 'DEP CLIMB';
        line2Color = '#55FFEE';
      } else if (craft.isEmergency || craft.fuelStatus === 'BINGO') {
        line2 = `${destShort} · BINGO ${Math.max(1, Math.ceil(craft.fuelSec))}S`;
        line2Color = blinkFast ? '#FFF0EC' : THEME.ALERT_RED_TEXT;
      } else if (isHolding && craft.assignedHoldFix) {
        line2 =
          craft.fuelStatus === 'JOKER'
            ? `HOLD ${craft.assignedHoldFix} · 0.35× JKR`
            : `HOLD ${craft.assignedHoldFix} · 0.35× F:${Math.round(craft.fuelPct)}%`;
        line2Color = craft.fuelStatus === 'JOKER' ? THEME.ACCENT_AMBER_HI : holdMintCol;
      } else if (craft.fuelStatus === 'JOKER') {
        line2 = `${destShort} · JOKER ${Math.ceil(craft.fuelSec)}S`;
        line2Color = THEME.ACCENT_AMBER_HI;
      } else if (craft.state === 'GO_AROUND') {
        line2 = 'GO AROUND · CLIMB';
        line2Color = THEME.ACCENT_AMBER_HI;
      } else if (craft.isMedevac) {
        if (craft.medevacExpressTimerSec > 0) {
          const medSec = Math.max(1, Math.ceil(craft.medevacExpressTimerSec));
          line2 = craft.lockedTarget
            ? `MED ${medSec}s · ${destShort} LOC`
            : `MED ${medSec}s · ${destShort}`;
          line2Color = blinkFast ? '#FFFFFF' : '#8CF8FF';
        } else {
          // Clean MEDEVAC indicator once express timer expires (ZERO error/penalty styling!)
          line2 = craft.lockedTarget
            ? `MEDEVAC · ${destShort} LOC`
            : `MEDEVAC · ${destShort} F:${Math.round(craft.fuelPct)}%`;
          line2Color = '#B8F8FF';
        }
      } else if (craft.lockedTarget) {
        line2 = `${destShort} LOC · F:${Math.round(craft.fuelPct)}%`;
        line2Color = THEME.TEXT_PRIMARY;
      } else {
        line2 = `${destShort} · F:${Math.round(craft.fuelPct)}%`;
        line2Color =
          craft.kind === 'HEAVY'
            ? THEME.ACCENT_AMBER_HI
            : craft.kind === 'TUG'
              ? THEME.ACCENT_CYAN
              : THEME.TEXT_BRIGHT;
      }

      const w1 = ctx.measureText(line1Full).width;
      const w2 = ctx.measureText(line2).width;
      const padX = 6;
      const boxW = Math.ceil(Math.max(w1, w2)) + padX * 2;
      const boxH = 36;

      // Evaluate 16 placements (2 radial rings × 8 directions) with stability hysteresis
      let bestRect: PlacedRect = { x: Math.round(p.x + 22), y: Math.round(p.y - boxH - 12), w: boxW, h: boxH };
      let bestScore = Number.POSITIVE_INFINITY;
      let bestCandIdx = 0;
      const prevCandIdx = this.lastBlockDir.get(craft.id);

      for (let ringIdx = 0; ringIdx < offsetRings.length; ringIdx++) {
        const offsetDist = offsetRings[ringIdx];
        for (let dirIdx = 0; dirIdx < candidateDirs.length; dirIdx++) {
          const candIdx = ringIdx * candidateDirs.length + dirIdx;
          const dir = candidateDirs[dirIdx];

          const rx =
            dir.dx > 0.2
              ? p.x + offsetDist
              : dir.dx < -0.2
                ? p.x - offsetDist - boxW
                : p.x - boxW * 0.5;
          const ry =
            dir.dy > 0.2
              ? p.y + offsetDist * 0.72
              : dir.dy < -0.2
                ? p.y - offsetDist * 0.72 - boxH
                : p.y - boxH * 0.5;

          const cand: PlacedRect = { x: Math.round(rx), y: Math.round(ry), w: boxW, h: boxH };
          let penalty = ringIdx === 1 ? 140 : 0;

          // Stability bias: prefer keeping the craft's previous slot to eliminate jitter
          if (prevCandIdx === candIdx) {
            penalty -= 350;
          }

          // Penalize protrusion outside rectangular scope bounds
          if (cand.x < minX) penalty += (minX - cand.x) * 180;
          if (cand.x + cand.w > maxX) penalty += (cand.x + cand.w - maxX) * 180;
          if (cand.y < minY) penalty += (minY - cand.y) * 180;
          if (cand.y + cand.h > maxY) penalty += (cand.y + cand.h - maxY) * 180;

          // Penalize overlap with previously placed ATC data blocks
          for (const pr of placedDataBlocks) {
            const area = rectOverlapArea(cand, pr);
            if (area > 0) penalty += 3200 + area * 4.5;
          }

          // Penalize overlap with static airfield labels, R-118 badge, ION CELL, DEP WAIT & CA pills!
          for (const ob of staticObstacles) {
            const area = rectOverlapArea(cand, ob);
            if (area > 0) penalty += 2600 + area * 4.0;
          }

          // Penalize covering any aircraft blip
          for (const bp of blipPts) {
            const blipBox: PlacedRect = { x: bp.pt.x - 14, y: bp.pt.y - 14, w: 28, h: 28 };
            const area = rectOverlapArea(cand, blipBox);
            if (area > 0) penalty += 1800 + area * 3.0;
          }

          if (penalty < bestScore) {
            bestScore = penalty;
            bestRect = cand;
            bestCandIdx = candIdx;
          }
        }
      }

      // Final hard clamp inside rectangular viewport so no block is ever clipped off-screen
      bestRect.x = Math.max(vp.x + 4, Math.min(vp.x + vp.width - bestRect.w - 4, bestRect.x));
      bestRect.y = Math.max(vp.y + 4, Math.min(vp.y + vp.height - bestRect.h - 4, bestRect.y));

      this.lastBlockDir.set(craft.id, bestCandIdx);
      placedDataBlocks.push(bestRect);

      const anchorX = Math.max(bestRect.x, Math.min(bestRect.x + bestRect.w, p.x));
      const anchorY = Math.max(bestRect.y, Math.min(bestRect.y + bestRect.h, p.y));

      const isUrgentRed =
        craft.isEmergency ||
        craft.fuelStatus === 'BINGO' ||
        craft.inConflict ||
        craft.inRestrictedZone;
      const isStormNonLethal = !isUrgentRed && craft.inStorm;
      const borderCol = isHighlight
        ? '#FFFFFF'
        : isUrgentRed
          ? blinkFast
            ? '#FF947D'
            : THEME.ALERT_RED_STROKE
          : isStormNonLethal
            ? blinkFast
              ? '#7CEEFF'
              : '#9B6BFF'
            : craft.isMedevac
              ? craft.medevacExpressTimerSec > 0 && blinkFast
                ? '#FFFFFF'
                : '#8CF8FF'
              : craft.fuelStatus === 'JOKER'
                ? THEME.ACCENT_AMBER
                : isHolding
                  ? holdMintCol
                  : craft.isDeparture
                    ? '#55FFEE'
                    : craft.lockedTarget
                      ? THEME.TEXT_PRIMARY
                      : craft.kind === 'TUG'
                        ? THEME.ACCENT_CYAN
                        : THEME.BORDER_SUBTLE;

      const bgCol = isUrgentRed
        ? blinkFast
          ? 'rgba(74, 14, 10, 0.92)'
          : 'rgba(42, 10, 8, 0.90)'
        : isStormNonLethal
          ? 'rgba(20, 10, 42, 0.92)'
          : isHighlight
            ? 'rgba(12, 36, 20, 0.94)'
            : craft.isMedevac
              ? 'rgba(6, 30, 38, 0.92)'
              : isHolding
                ? 'rgba(4, 22, 20, 0.90)'
                : 'rgba(2, 9, 5, 0.88)';

      // Thin leader tether line
      ctx.strokeStyle = isHighlight ? '#FFFFFF' : borderCol;
      ctx.lineWidth = isHighlight ? 1.4 : 1.0;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(anchorX, anchorY);
      ctx.stroke();

      // Data block container
      ctx.fillStyle = bgCol;
      ctx.fillRect(bestRect.x, bestRect.y, bestRect.w, bestRect.h);
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = isHighlight || isUrgentRed || isStormNonLethal || craft.isMedevac ? 1.5 : 1.0;
      ctx.strokeRect(bestRect.x + 0.5, bestRect.y + 0.5, bestRect.w - 1, bestRect.h - 1);

      // Line 1: Callsign | Speed / FL / RF JAM
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const line1Col = isHighlight
        ? '#FFFFFF'
        : craft.isEmergency || craft.inRestrictedZone
          ? '#FFE8E2'
          : isStormNonLethal
            ? '#E6D4FF'
            : craft.isMedevac
              ? '#F0FFFF'
              : isHolding
                ? holdMintCol
                : craft.isDeparture
                  ? '#55FFEE'
                  : craft.kind === 'HEAVY'
                    ? THEME.ACCENT_AMBER_HI
                    : craft.kind === 'TUG'
                      ? THEME.ACCENT_CYAN
                      : THEME.TEXT_BRIGHT;

      const tx = bestRect.x + padX;
      const ty1 = bestRect.y + 10.5;
      ctx.fillStyle = line1Col;
      ctx.fillText(line1Prefix, tx, ty1);

      if (speedSuffix) {
        const prefixW = ctx.measureText(line1Prefix).width;
        ctx.fillStyle =
          craft.speedMode === 'SLOW'
            ? THEME.ACCENT_CYAN
            : craft.speedMode === 'FAST'
              ? THEME.ACCENT_AMBER
              : line1Col;
        ctx.fillText(speedSuffix, tx + prefixW, ty1);
      }

      // Line 2: Dest + Fuel / Departure / Warning State
      ctx.fillStyle = line2Color;
      ctx.fillText(line2, tx, bestRect.y + 26.5);
    }

    // Prune stale craft IDs from hysteresis cache
    for (const id of this.lastBlockDir.keys()) {
      if (!activeIds.has(id)) {
        this.lastBlockDir.delete(id);
      }
    }

    ctx.restore();
    return placedDataBlocks;
  }

  // ===========================================================================
  // SHOCKWAVE RINGS, 1.2S INCIDENT FREEZE SPOTLIGHT & NON-OVERLAPPING POPUPS
  // ===========================================================================
  private drawShockwaveRings(
    ctx: CanvasRenderingContext2D,
    sim: ApproachSimulation,
    toPt: (x: number, y: number) => Vec2,
    pxPerNm: number
  ): void {
    if (sim.crtShockwaves.length === 0) return;
    ctx.save();
    for (const sw of sim.crtShockwaves) {
      const frac = Math.max(0, Math.min(1, sw.age / Math.max(0.01, sw.duration)));
      const p = toPt(sw.x, sw.y);
      const r = Math.max(4, sw.maxRadiusNm * pxPerNm * frac);
      const a = (1 - frac) * 0.75;
      ctx.strokeStyle =
        sw.tone === 'red'
          ? `rgba(255, 58, 32, ${a.toFixed(3)})`
          : sw.tone === 'gold'
            ? `rgba(255, 224, 96, ${Math.min(1, a * 1.15).toFixed(3)})`
            : sw.tone === 'amber'
              ? `rgba(255, 176, 0, ${a.toFixed(3)})`
              : `rgba(68, 255, 119, ${a.toFixed(3)})`;
      ctx.lineWidth = (sw.tone === 'gold' ? 3.2 : 2.6) * (1 - frac * 0.5);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();

      if (sw.tone === 'gold' && r > 12) {
        ctx.strokeStyle = `rgba(255, 246, 180, ${(a * 0.72).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.78, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawIncidentSpotlight(
    ctx: CanvasRenderingContext2D,
    sim: ApproachSimulation,
    vp: ViewportRect,
    toPt: (x: number, y: number) => Vec2,
    pxPerNm: number,
    timeSec: number
  ): void {
    if (!sim.incidentPos) return;
    const p = toPt(sim.incidentPos.x, sim.incidentPos.y);
    const prog =
      1 - Math.max(0, Math.min(1, sim.incidentFreezeTimer / APPROACH_CONSTANTS.INCIDENT_FREEZE_SEC));
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 18);

    ctx.save();

    for (let k = 0; k < 3; k++) {
      const rf = (prog + k * 0.28) % 1;
      const rad = (0.6 + rf * 3.8) * pxPerNm;
      ctx.strokeStyle = `rgba(255, 51, 24, ${((1 - rf) * 0.92).toFixed(3)})`;
      ctx.lineWidth = 2.6 - rf * 1.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = pulse > 0.5 ? '#FFF0EC' : THEME.ALERT_RED_STROKE;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(p.x - 18, p.y);
    ctx.lineTo(p.x + 18, p.y);
    ctx.moveTo(p.x, p.y - 18);
    ctx.lineTo(p.x, p.y + 18);
    ctx.stroke();

    const title =
      sim.incidentCallout ||
      (sim.incidentReason === 'FLAMEOUT'
        ? 'FUEL FLAMEOUT'
        : sim.incidentReason === 'RESTRICTED_ZONE'
          ? 'R-118 MOA BREACH'
          : 'LOSS OF SEPARATION');
    const sub = sim.trainingMode
      ? 'TRAINING SIMULATION — SEAL PRESERVED'
      : `ICC SAFETY SEAL BREACHED (${sim.safetySeals}/${sim.maxSafetySeals} REMAINING)`;

    ctx.font = font('head', 14);
    const w1 = ctx.measureText(title).width;
    ctx.font = font('micro', 12);
    const w2 = ctx.measureText(sub).width;
    const bw = Math.ceil(Math.max(w1, w2)) + 24;
    const bh = 46;
    const bx = Math.max(vp.x + 10, Math.min(vp.x + vp.width - bw - 10, Math.round(p.x - bw * 0.5)));
    const by = Math.max(
      vp.y + 10,
      Math.min(vp.y + vp.height - bh - 10, Math.round(p.y - bh - 24))
    );

    ctx.fillStyle = 'rgba(72, 10, 6, 0.96)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = pulse > 0.5 ? '#FF947D' : THEME.ALERT_RED_STROKE;
    ctx.lineWidth = 2.2;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font('head', 14);
    ctx.fillStyle = '#FFF0EC';
    ctx.fillText(title, bx + bw * 0.5, by + 16);

    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.fillText(sub, bx + bw * 0.5, by + 34);

    ctx.restore();
  }

  private drawPopups(
    ctx: CanvasRenderingContext2D,
    sim: ApproachSimulation,
    vp: ViewportRect,
    toPt: (x: number, y: number) => Vec2,
    placedDataBlocks: readonly PlacedRect[]
  ): void {
    if (sim.popups.length === 0) return;
    const occupied: PlacedRect[] = [...placedDataBlocks];

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const pop of sim.popups) {
      const frac = Math.max(0, Math.min(1, pop.age / Math.max(0.01, pop.duration)));
      const alpha = frac < 0.72 ? 1 : (1 - frac) / 0.28;
      const p = toPt(pop.x, pop.y);

      ctx.font = font('data', 14);
      const wMain = ctx.measureText(pop.text).width;
      let wSub = 0;
      if (pop.subText) {
        ctx.font = font('micro', 12);
        wSub = ctx.measureText(pop.subText).width;
      }
      const popW = Math.ceil(Math.max(wMain, wSub)) + 14;
      const popH = pop.subText ? 34 : 20;

      const clampedX = Math.max(
        vp.x + popW * 0.5 + 10,
        Math.min(vp.x + vp.width - popW * 0.5 - 10, p.x)
      );
      let clampedY = Math.max(
        vp.y + 30,
        Math.min(vp.y + vp.height - popH - 12, p.y - frac * 28)
      );

      // Nudge floating popups upward so they NEVER cover placed ATC Data Blocks or other popups!
      const overlapsAny = (cyPos: number): boolean => {
        const rect: PlacedRect = {
          x: clampedX - popW * 0.5,
          y: cyPos - 10,
          w: popW,
          h: popH,
        };
        for (const ob of occupied) {
          if (rectOverlapArea(rect, ob) > 0) return true;
        }
        return false;
      };

      for (let attempt = 0; attempt < 6; attempt++) {
        if (!overlapsAny(clampedY)) break;
        const nudgedUp = clampedY - 24;
        if (nudgedUp >= vp.y + 28) {
          clampedY = nudgedUp;
        } else {
          // If near top edge, nudge cleanly below instead
          clampedY = Math.min(vp.y + vp.height - popH - 12, clampedY + 30);
          break;
        }
      }

      occupied.push({
        x: clampedX - popW * 0.5,
        y: clampedY - 10,
        w: popW,
        h: popH,
      });

      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.font = font('data', 14);
      ctx.strokeStyle = THEME.HALO_DARK;
      ctx.lineWidth = 3.4;
      ctx.lineJoin = 'round';
      ctx.strokeText(pop.text, clampedX, clampedY);
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, clampedX, clampedY);

      if (pop.subText) {
        ctx.font = font('micro', 12);
        ctx.strokeText(pop.subText, clampedX, clampedY + 16);
        ctx.fillStyle = THEME.TEXT_BRIGHT;
        ctx.fillText(pop.subText, clampedX, clampedY + 16);
      }
    }

    ctx.restore();
  }

  private drawScopeAlertBanner(
    ctx: CanvasRenderingContext2D,
    vp: ViewportRect,
    cx: number,
    sim: ApproachSimulation,
    timeSec: number
  ): void {
    if (sim.phase !== 'ACTIVE_SHIFT') return;
    let bannerText: string | null = null;
    let tone: 'red' | 'amber' = 'amber';

    const restrictedCraft = sim.aircraft.find((c) => c.inRestrictedZone);
    if (restrictedCraft) {
      bannerText = `${SEMIOTIC_ICONS.TRIANGLE} R-118 MOA VIOLATION — ${restrictedCraft.callsign} EXIT IMMEDIATELY`;
      tone = 'red';
    } else if (sim.conflictActive) {
      bannerText = `${SEMIOTIC_ICONS.TRIANGLE} CONFLICT ALERT — MIN SEP ${sim.minSeparationNm.toFixed(1)} NM`;
      tone = 'red';
    } else if (sim.pendingPrimaryRunway !== null || sim.pendingSecondaryRunway !== null) {
      const rwyList =
        sim.pendingPrimaryRunway && sim.pendingSecondaryRunway
          ? `${sim.pendingPrimaryRunway}+${sim.pendingSecondaryRunway}`
          : (sim.pendingPrimaryRunway ?? sim.pendingSecondaryRunway ?? sim.pendingRunway ?? '');
      bannerText = `${SEMIOTIC_ICONS.TRIANGLE} WIND SHIFT ADVISORY — RWY ${rwyList} IN ${Math.max(0, Math.ceil(sim.runwayFlipCountdownSec))}S`;
      tone = 'amber';
    }

    if (!bannerText) return;

    const pulse = Math.sin(timeSec * 12) > 0;
    ctx.save();
    ctx.font = font('data', 12);
    const pillW = Math.min(vp.width - 28, Math.ceil(ctx.measureText(bannerText).width) + 22);
    const pillH = 24;
    const px = Math.round(cx - pillW * 0.5);
    const py = Math.round(vp.y + vp.height - pillH - 28);

    ctx.fillStyle =
      tone === 'red'
        ? pulse
          ? 'rgba(116, 18, 10, 0.94)'
          : 'rgba(62, 12, 8, 0.92)'
        : pulse
          ? 'rgba(84, 44, 4, 0.94)'
          : 'rgba(46, 24, 4, 0.90)';
    ctx.fillRect(px, py, pillW, pillH);
    ctx.strokeStyle =
      tone === 'red'
        ? pulse
          ? '#FF947D'
          : THEME.ALERT_RED_STROKE
        : pulse
          ? THEME.ACCENT_AMBER_HI
          : THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(px + 0.5, py + 0.5, pillW - 1, pillH - 1);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = tone === 'red' ? '#FFF0EC' : THEME.ACCENT_AMBER_HI;
    drawEllipsizedText(ctx, bannerText, px + pillW * 0.5, py + pillH * 0.5 + 0.5, pillW - 12);
    ctx.restore();
  }
}
