import { COLORS } from '../../constants';
import type { CrtInteractiveButton } from '../../render/HudRenderer';
import { drawRankedHudPill, drawRankedTitleRibbon } from '../../render/RankedBadge';
import type { ViewportRect } from '../../types';
import type { TrenchLeaderboardService } from './TrenchLeaderboard';
import type { TrenchSimulation } from './TrenchSimulation';
import { TRENCH_CONSTANTS, type TrenchLastSubmittedRun } from './types';

export interface ProjectedHudPoint {
  sx: number;
  sy: number;
  cz: number;
  scale: number;
}

export interface TrenchHudRenderParams {
  width: number;
  height: number;
  timeSec: number;
  sim: TrenchSimulation;
  leaderboard: TrenchLeaderboardService;
  hoveredButtonId: string | null;
  mouseScreenX: number;
  mouseScreenY: number;
  mouseInsideCanopy: boolean;
  /** Clamped virtual flight stick deflection (-1..+1, Pointer Lock accumulated) */
  stickNormX: number;
  stickNormY: number;
  /** Radius in px of the 4% center deadzone ring */
  stickDeadzonePx: number;
  /** True when browser Pointer Lock is engaged on the canopy */
  pointerLocked: boolean;
  /** Exact 3D->2D camera projection callback from TrenchRenderer (pixel-locked to terrain/targets) */
  projectWorld: (wx: number, wy: number, wz: number) => ProjectedHudPoint | null;
  audioMuted: boolean;
  isFullscreen: boolean;
  osdMenuOpen: boolean;
  manifestOpen: boolean;
  callsignDraft: string;
  callsignEditing: boolean;
  scoreSubmitted: boolean;
  submittingScore: boolean;
  submitResultBanner: string | null;
  lastSubmittedRun: TrenchLastSubmittedRun | null;
}

export class TrenchHudRenderer {
  public buttons: CrtInteractiveButton[] = [];

  public hitTestButton(cx: number, cy: number): string | null {
    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const b = this.buttons[i];
      if (
        cx >= b.rect.x &&
        cx <= b.rect.x + b.rect.width &&
        cy >= b.rect.y &&
        cy <= b.rect.y + b.rect.height
      ) {
        return b.id;
      }
    }
    return null;
  }

  public getLayout(width: number, height: number): {
    topBarH: number;
    dashH: number;
    canopyVp: ViewportRect;
    dashVp: ViewportRect;
  } {
    const topBarH = 44;
    const dashH = Math.max(176, Math.min(256, Math.round(height * 0.245)));
    const canopyH = Math.max(180, height - topBarH - dashH);
    return {
      topBarH,
      dashH,
      canopyVp: { x: 0, y: topBarH, width: Math.max(320, width), height: canopyH },
      dashVp: { x: 0, y: topBarH + canopyH, width: Math.max(320, width), height: dashH },
    };
  }

  public render(ctx: CanvasRenderingContext2D, params: TrenchHudRenderParams): void {
    this.buttons = [];
    const layout = this.getLayout(params.width, params.height);

    // 1. Standardized Top Hardware Strip
    this.drawTopBar(ctx, params, layout.topBarH);

    // 2. Subtle Dark Vector Jet Canopy Frame & HUD Combiner Glass Outline
    this.drawCanopyFrameAndCombinerGlass(ctx, layout.canopyVp, params.sim.phase === 'FLYING');

    // 3. Mil-Spec Vector Jet Canopy HUD (Boresight, FPM, Pitch Ladder, Tapes, Heading, EEGS/LCOS, TD Box)
    if (params.sim.phase === 'FLYING') {
      this.drawJetCanopyHud(ctx, params, layout.canopyVp);
    }

    // 4. Lower Cockpit Instrument Cluster (Angled Glare-Shield + 4 Live Vector MFDs!)
    this.drawLowerCockpitCluster(ctx, params, layout.dashVp, layout.canopyVp);

    // 4. Phase Overlays, Pointer-Lock Pause Overlay & Standardized Modals
    if (params.sim.phase === 'TITLE') {
      this.drawTitleOverlay(ctx, params, layout.canopyVp);
    } else if (params.sim.phase === 'GAME_OVER') {
      this.drawGameOverOverlay(ctx, params);
    } else if (params.sim.paused && !params.osdMenuOpen && !params.manifestOpen) {
      this.drawPausedOverlay(ctx, params, layout.canopyVp);
    }

    if (params.osdMenuOpen) {
      this.drawOsdMenuModal(ctx, params);
    } else if (params.manifestOpen) {
      this.drawManifestModal(ctx, params);
    }
  }

  // ===========================================================================
  // TOP HARDWARE STRIP
  // ===========================================================================
  private drawTopBar(
    ctx: CanvasRenderingContext2D,
    params: TrenchHudRenderParams,
    topBarH: number
  ): void {
    const { width: w, sim } = params;
    ctx.save();
    ctx.fillStyle = 'rgba(3, 9, 5, 0.95)';
    ctx.fillRect(0, 0, w, topBarH);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(8, topBarH - 1);
    ctx.lineTo(w - 8, topBarH - 1);
    ctx.stroke();

    const compact = w < 1180;
    ctx.font = compact
      ? 'bold 14px "Share Tech Mono", monospace'
      : 'bold 17px "Share Tech Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#44FF77';
    const titleStr = 'DERELICT TRENCH // VECTOR RUN';
    ctx.fillText(titleStr, 14, 28);

    const pillX = Math.round(14 + ctx.measureText(titleStr).width + 10);
    const rankedPillW = drawRankedHudPill(
      ctx,
      pillX,
      9,
      25,
      params.timeSec,
      true,
      compact
    );
    const badgeX = pillX + rankedPillW + 10;
    ctx.fillStyle = '#FFB000';
    const scoreStr = `// ${sim.sectorId} // ${sim.score.toLocaleString()} PTS`;
    ctx.fillText(scoreStr, badgeX, 28);
    const titleRight = Math.round(badgeX + ctx.measureText(scoreStr).width + 14);

    const pills: Array<{ id: string; label: string; w: number; active: boolean; accent: string }> =
      [
        {
          id: 'trench-pause',
          label: sim.paused ? '❚❚ PAUSED' : '[P] PAUSE',
          w: compact ? 86 : 100,
          active: sim.paused,
          accent: '#FFB000',
        },
        {
          id: 'trench-manifest',
          label: 'MANIFEST',
          w: compact ? 82 : 94,
          active: params.manifestOpen,
          accent: COLORS.GREEN_BRIGHT,
        },
        {
          id: 'trench-mute',
          label: params.audioMuted ? 'AUDIO: OFF' : 'AUDIO: ON',
          w: compact ? 86 : 96,
          active: !params.audioMuted,
          accent: params.audioMuted ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY,
        },
        {
          id: 'trench-fullscreen',
          label: params.isFullscreen ? 'EXIT FL' : 'FULLSCR',
          w: compact ? 74 : 84,
          active: params.isFullscreen,
          accent: COLORS.AMBER_BRIGHT,
        },
        {
          id: 'trench-osd',
          label: '[M] MENU',
          w: compact ? 84 : 96,
          active: params.osdMenuOpen,
          accent: '#FFB000',
        },
        {
          id: 'trench-exit-os',
          label: 'MU-TH-UR OS',
          w: compact ? 100 : 112,
          active: false,
          accent: '#FFB000',
        },
      ];

    let px = w - 12;
    for (let i = pills.length - 1; i >= 0; i--) {
      const p = pills[i];
      px -= p.w;
      if (px < titleRight) break;
      this.addButton(
        ctx,
        p.id,
        { x: px, y: 6, width: p.w, height: 31 },
        p.label,
        p.active,
        params.hoveredButtonId,
        p.accent,
        compact ? 12 : 13.5
      );
      px -= 6;
    }
    ctx.restore();
  }

  // ===========================================================================
  // SUBTLE DARK F-16 CANOPY FRAME & HUD COMBINER GLASS OUTLINE
  // ===========================================================================
  private drawCanopyFrameAndCombinerGlass(
    ctx: CanvasRenderingContext2D,
    vp: ViewportRect,
    showCombiner: boolean
  ): void {
    const { x, y, width: w, height: h } = vp;
    const cx = x + w * 0.5;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    // 1. Subtle dark angled F-16 bubble-canopy upper arch & corner gussets (completely unobtrusive!)
    const cornerW = Math.min(115, w * 0.085);
    const cornerH = Math.min(72, h * 0.13);
    ctx.fillStyle = 'rgba(2, 8, 5, 0.84)';

    // Upper-left canopy bow gusset
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + cornerW, y);
    ctx.quadraticCurveTo(x + cornerW * 0.25, y + cornerH * 0.28, x, y + cornerH);
    ctx.closePath();
    ctx.fill();

    // Upper-right canopy bow gusset
    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w - cornerW, y);
    ctx.quadraticCurveTo(x + w - cornerW * 0.25, y + cornerH * 0.28, x + w, y + cornerH);
    ctx.closePath();
    ctx.fill();

    // Thin dark upper canopy bow trim line + subtle interior phosphor edge highlight
    ctx.strokeStyle = 'rgba(34, 122, 62, 0.34)';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(x, y + cornerH);
    ctx.quadraticCurveTo(x + cornerW * 0.25, y + cornerH * 0.28, x + cornerW, y + 3);
    ctx.lineTo(x + w - cornerW, y + 3);
    ctx.quadraticCurveTo(x + w - cornerW * 0.25, y + cornerH * 0.28, x + w, y + cornerH);
    ctx.stroke();

    // 2. Authentic Block-50 F-16 HUD Combiner Glass Outline framing central HUD projection zone!
    if (showCombiner) {
      const combW = Math.min(w * 0.46, Math.max(380, h * 0.92));
      const combTopY = y + Math.max(12, h * 0.03);
      const combBotY = y + h + 4;
      const halfTop = combW * 0.44;
      const halfBot = combW * 0.54;

      // Ultra-subtle emerald optical glass tint on combiner pane
      ctx.fillStyle = 'rgba(22, 92, 46, 0.045)';
      ctx.beginPath();
      ctx.moveTo(cx - halfBot, combBotY);
      ctx.lineTo(cx - halfTop, combTopY + 14);
      ctx.lineTo(cx - halfTop + 18, combTopY);
      ctx.lineTo(cx + halfTop - 18, combTopY);
      ctx.lineTo(cx + halfTop, combTopY + 14);
      ctx.lineTo(cx + halfBot, combBotY);
      ctx.closePath();
      ctx.fill();

      // Delicate beveled twin combiner glass struts & top glass rim edge
      ctx.strokeStyle = 'rgba(68, 255, 119, 0.16)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx - halfBot, combBotY);
      ctx.lineTo(cx - halfTop, combTopY + 14);
      ctx.lineTo(cx - halfTop + 18, combTopY);
      ctx.lineTo(cx + halfTop - 18, combTopY);
      ctx.lineTo(cx + halfTop, combTopY + 14);
      ctx.lineTo(cx + halfBot, combBotY);
      ctx.stroke();

      // Subtle darker structural mounting stanchions near lower glare-shield join
      ctx.strokeStyle = 'rgba(4, 16, 9, 0.85)';
      ctx.lineWidth = 5.5;
      ctx.beginPath();
      ctx.moveTo(cx - halfBot - 2, combBotY);
      ctx.lineTo(cx - halfBot + 14, combBotY - Math.min(82, h * 0.15));
      ctx.moveTo(cx + halfBot + 2, combBotY);
      ctx.lineTo(cx + halfBot - 14, combBotY - Math.min(82, h * 0.15));
      ctx.stroke();

      ctx.strokeStyle = 'rgba(52, 168, 86, 0.34)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(cx - halfBot + 1, combBotY);
      ctx.lineTo(cx - halfBot + 15, combBotY - Math.min(82, h * 0.15));
      ctx.moveTo(cx + halfBot - 1, combBotY);
      ctx.lineTo(cx + halfBot - 15, combBotY - Math.min(82, h * 0.15));
      ctx.stroke();
    }

    ctx.restore();
  }

  // ===========================================================================
  // AUTHENTIC VECTOR JET CANOPY HUD
  // ===========================================================================
  private drawJetCanopyHud(
    ctx: CanvasRenderingContext2D,
    params: TrenchHudRenderParams,
    vp: ViewportRect
  ): void {
    const { sim, timeSec } = params;
    const cx = vp.x + vp.width * 0.5;
    const cy = vp.y + vp.height * 0.5;
    const fovRad = (sim.cameraFovDeg * Math.PI) / 180;
    const focalLen = (vp.height * 0.5) / Math.tan(fovRad * 0.5);
    const hudScale = Math.max(0.7, Math.min(1.1, Math.min(vp.width / 1380, vp.height / 640)));

    ctx.save();
    ctx.beginPath();
    ctx.rect(vp.x, vp.y, vp.width, vp.height);
    ctx.clip();

    // -------------------------------------------------------------------------
    // 1. TOP HEADING COMPASS TAPE (000°–360°) + CANYON CENTERLINE CARET
    // -------------------------------------------------------------------------
    const hdgW = Math.min(vp.width - 280, Math.round(460 * hudScale));
    const hdgX = cx - hdgW * 0.5;
    const hdgY = vp.y + 10;
    const headingDeg = sim.getCompassHeadingDeg();
    const canyonDeg = sim.getCanyonWaypointHeadingDeg();
    const pxPerDeg = hdgW / 64;

    ctx.fillStyle = 'rgba(2, 10, 5, 0.45)';
    ctx.fillRect(hdgX, hdgY, hdgW, 34);
    ctx.strokeStyle = 'rgba(68, 255, 119, 0.65)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(hdgX, hdgY + 34);
    ctx.lineTo(hdgX + hdgW, hdgY + 34);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(hdgX, hdgY, hdgW, 34);
    ctx.clip();
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';

    const startDeg = Math.floor((headingDeg - 36) / 5) * 5;
    const endDeg = Math.ceil((headingDeg + 36) / 5) * 5;
    for (let d = startDeg; d <= endDeg; d += 5) {
      const tx = cx + (d - headingDeg) * pxPerDeg;
      const major = d % 10 === 0;
      ctx.strokeStyle = major ? '#44FF77' : 'rgba(68, 255, 119, 0.5)';
      ctx.lineWidth = major ? 1.6 : 1.1;
      ctx.beginPath();
      ctx.moveTo(tx, hdgY + 34);
      ctx.lineTo(tx, hdgY + (major ? 22 : 27));
      ctx.stroke();

      if (major) {
        const normD = ((d % 360) + 360) % 360;
        const lbl =
          normD === 0
            ? 'N'
            : normD === 90
              ? 'E'
              : normD === 180
                ? 'S'
                : normD === 270
                  ? 'W'
                  : String(Math.round(normD / 10)).padStart(2, '0');
        ctx.fillStyle = '#8EF5AB';
        ctx.fillText(lbl, tx, hdgY + 17);
      }
    }
    ctx.restore();

    // Canyon Centerline Waypoint Caret (amber diamond/chevron along heading tape!)
    let relWpt = canyonDeg - headingDeg;
    while (relWpt > 180) relWpt -= 360;
    while (relWpt < -180) relWpt += 360;
    const caretX = Math.max(hdgX + 8, Math.min(hdgX + hdgW - 8, cx + relWpt * pxPerDeg));
    ctx.fillStyle = '#FFB000';
    ctx.beginPath();
    ctx.moveTo(caretX, hdgY + 35);
    ctx.lineTo(caretX - 6, hdgY + 44);
    ctx.lineTo(caretX + 6, hdgY + 44);
    ctx.closePath();
    ctx.fill();

    // Center Digital Heading Box
    ctx.fillStyle = 'rgba(2, 14, 7, 0.92)';
    ctx.fillRect(cx - 26, hdgY + 36, 52, 20);
    ctx.strokeStyle = '#44FF77';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - 26, hdgY + 36, 52, 20);
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = '#44FF77';
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(headingDeg) % 360).padStart(3, '0'), cx, hdgY + 51);

    // -------------------------------------------------------------------------
    // 1B. TOP-HUD SECTOR STRIKE OBJECTIVE COUNTER (`SEC-01 OBJ: 3 SAM // 2 BANDITS`)
    // -------------------------------------------------------------------------
    this.drawSectorObjectiveStrip(ctx, sim, vp, hdgX, hdgY, hdgW, hudScale);

    // -------------------------------------------------------------------------
    // 2. PITCH LADDER & ARTIFICIAL HORIZON (rotates -sim.roll to match 3D world!)
    // -------------------------------------------------------------------------
    const ladderClipR = Math.min(vp.height * 0.42, 240 * hudScale);
    const pxPerRad = focalLen;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, ladderClipR, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(cx, cy);
    ctx.rotate(-sim.roll);

    const pitchPxOffset = sim.pitch * pxPerRad;
    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';

    for (let deg = -40; deg <= 40; deg += 10) {
      const degRad = (deg * Math.PI) / 180;
      const ry = pitchPxOffset - degRad * pxPerRad;
      if (Math.abs(ry) > ladderClipR + 30) continue;

      if (deg === 0) {
        // Wide 0° Artificial Horizon Bar with center nose gap
        ctx.strokeStyle = 'rgba(68, 255, 119, 0.85)';
        ctx.lineWidth = 1.9;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(-165 * hudScale, ry);
        ctx.lineTo(-34 * hudScale, ry);
        ctx.moveTo(34 * hudScale, ry);
        ctx.lineTo(165 * hudScale, ry);
        ctx.stroke();
      } else {
        const inner = 30 * hudScale;
        const outer = 88 * hudScale;
        const tickDir = deg > 0 ? 1 : -1;
        ctx.strokeStyle = 'rgba(68, 255, 119, 0.68)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash(deg < 0 ? [7, 5] : []);

        ctx.beginPath();
        // Left rung + vertical horizon-facing tick
        ctx.moveTo(-outer, ry);
        ctx.lineTo(-inner, ry);
        ctx.lineTo(-inner, ry + tickDir * 9 * hudScale);
        // Right rung + vertical horizon-facing tick
        ctx.moveTo(outer, ry);
        ctx.lineTo(inner, ry);
        ctx.lineTo(inner, ry + tickDir * 9 * hudScale);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(142, 245, 171, 0.78)';
        ctx.textAlign = 'right';
        ctx.fillText(`${deg > 0 ? '+' : ''}${deg}`, -outer - 6, ry + 4);
        ctx.textAlign = 'left';
        ctx.fillText(`${deg > 0 ? '+' : ''}${deg}`, outer + 6, ry + 4);
      }
    }
    ctx.restore();

    // -------------------------------------------------------------------------
    // 3. FIXED BORESIGHT GUN CROSS + TRUE PROJECTED FLIGHT PATH MARKER (FPM!)
    // -------------------------------------------------------------------------
    ctx.strokeStyle = '#44FF77';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(cx - 11, cy);
    ctx.lineTo(cx - 3, cy);
    ctx.moveTo(cx + 3, cy);
    ctx.lineTo(cx + 11, cy);
    ctx.moveTo(cx, cy - 11);
    ctx.lineTo(cx, cy - 3);
    ctx.moveTo(cx, cy + 3);
    ctx.lineTo(cx, cy + 11);
    ctx.stroke();

    // True 3D Projected Velocity Vector (FPM) — shows exact path through canyon ridges!
    const fpmCam = sim.getFlightPathMarkerCameraDir();
    const fpmScale = focalLen / Math.max(0.2, fpmCam.cz);
    const fpmX = Math.max(vp.x + 80, Math.min(vp.x + vp.width - 80, cx + fpmCam.cx * fpmScale));
    const fpmY = Math.max(vp.y + 60, Math.min(vp.y + vp.height - 45, cy - fpmCam.cy * fpmScale));

    ctx.save();
    ctx.translate(fpmX, fpmY);
    ctx.strokeStyle = sim.pullUpWarning ? '#FFB000' : '#8EF5AB';
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.arc(0, 0, 9.5 * hudScale, 0, Math.PI * 2);
    ctx.moveTo(-25 * hudScale, 0);
    ctx.lineTo(-9.5 * hudScale, 0);
    ctx.moveTo(9.5 * hudScale, 0);
    ctx.lineTo(25 * hudScale, 0);
    ctx.moveTo(0, -18 * hudScale);
    ctx.lineTo(0, -9.5 * hudScale);
    ctx.stroke();
    ctx.restore();

    // -------------------------------------------------------------------------
    // 4. LEFT HUD TAPE: AIRSPEED (KCAS + MACH), G-LOAD & AoA
    // -------------------------------------------------------------------------
    const tapeW = Math.round(92 * hudScale);
    const tapeH = Math.min(vp.height - 135, Math.round(256 * hudScale));
    const leftX = vp.x + Math.max(20, Math.round(vp.width * 0.04));
    const tapeTop = cy - tapeH * 0.5;

    ctx.fillStyle = 'rgba(2, 10, 5, 0.44)';
    ctx.fillRect(leftX, tapeTop, tapeW, tapeH);
    ctx.strokeStyle = sim.afterburning ? '#FFB000' : 'rgba(68, 255, 119, 0.62)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(leftX + tapeW, tapeTop);
    ctx.lineTo(leftX + tapeW, tapeTop + tapeH);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(leftX, tapeTop + 4, tapeW, tapeH - 8);
    ctx.clip();
    const pxPerKt = 0.52 * hudScale;
    const minKt = Math.floor((sim.kcas - 240) / 50) * 50;
    const maxKt = Math.ceil((sim.kcas + 240) / 50) * 50;
    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    for (let k = minKt; k <= maxKt; k += 50) {
      if (k < 0) continue;
      const ty = cy - (k - sim.kcas) * pxPerKt;
      const major = k % 100 === 0;
      ctx.strokeStyle = major ? '#44FF77' : 'rgba(68, 255, 119, 0.5)';
      ctx.lineWidth = major ? 1.6 : 1.1;
      ctx.beginPath();
      ctx.moveTo(leftX + tapeW - (major ? 14 : 8), ty);
      ctx.lineTo(leftX + tapeW, ty);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = 'rgba(142, 245, 171, 0.78)';
        ctx.fillText(String(k), leftX + tapeW - 18, ty + 4);
      }
    }
    ctx.restore();

    // KCAS Current Box (flashes amber/red when stalling below 180 KCAS!)
    const stallFlash = sim.isStalling && Math.sin(timeSec * 16) > -0.2;
    ctx.fillStyle = stallFlash ? 'rgba(68, 18, 6, 0.94)' : 'rgba(2, 14, 7, 0.95)';
    ctx.fillRect(leftX - 4, cy - 16, tapeW + 8, 32);
    ctx.strokeStyle = stallFlash
      ? COLORS.RED_KLAXON
      : sim.afterburning
        ? '#FFB000'
        : '#44FF77';
    ctx.lineWidth = 2.0;
    ctx.strokeRect(leftX - 4, cy - 16, tapeW + 8, 32);
    ctx.textAlign = 'center';
    ctx.font = 'bold 18px "JetBrains Mono", monospace';
    ctx.fillStyle = stallFlash ? '#FFF6CC' : sim.afterburning ? '#FFF6CC' : '#44FF77';
    ctx.fillText(`${sim.kcas}`, leftX + tapeW * 0.5, cy + 6);

    ctx.textAlign = 'left';
    ctx.font = 'bold 14px "Share Tech Mono", monospace';
    ctx.fillStyle = sim.isStalling ? COLORS.RED_KLAXON : '#8EF5AB';
    ctx.fillText(sim.isStalling ? 'KCAS STALL' : 'KCAS', leftX + 2, tapeTop - 8);

    // AoA Indexer Brackets (left of pitch ladder: top ▼ slow/high AoA, center ○ corner speed, bottom ▲ fast!)
    const idxX = leftX + tapeW + Math.round(30 * hudScale);
    const idxY = cy;
    const isSlowAoA = sim.isStalling || sim.kcas < TRENCH_CONSTANTS.CORNER_SPEED_MIN_KCAS || sim.aoaDeg > 9.5;
    const isFastAoA = !isSlowAoA && sim.kcas > TRENCH_CONSTANTS.CORNER_SPEED_MAX_KCAS;
    const isOptimalAoA = !isSlowAoA && !isFastAoA;

    ctx.save();
    ctx.strokeStyle = 'rgba(68, 255, 119, 0.35)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(idxX - 9, idxY - 26);
    ctx.lineTo(idxX - 13, idxY - 26);
    ctx.lineTo(idxX - 13, idxY + 26);
    ctx.lineTo(idxX - 9, idxY + 26);
    ctx.stroke();

    ctx.strokeStyle = isSlowAoA ? (sim.isStalling ? COLORS.RED_KLAXON : '#FFB000') : 'rgba(68, 255, 119, 0.22)';
    ctx.lineWidth = isSlowAoA ? 2.6 : 1.2;
    ctx.beginPath();
    ctx.moveTo(idxX - 7, idxY - 22);
    ctx.lineTo(idxX, idxY - 13);
    ctx.lineTo(idxX + 7, idxY - 22);
    ctx.stroke();

    ctx.strokeStyle = isOptimalAoA ? '#44FF77' : 'rgba(68, 255, 119, 0.22)';
    ctx.lineWidth = isOptimalAoA ? 2.6 : 1.2;
    ctx.beginPath();
    ctx.arc(idxX, idxY, 6.4, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = isFastAoA ? '#44FFDD' : 'rgba(68, 255, 119, 0.22)';
    ctx.lineWidth = isFastAoA ? 2.6 : 1.2;
    ctx.beginPath();
    ctx.moveTo(idxX - 7, idxY + 22);
    ctx.lineTo(idxX, idxY + 13);
    ctx.lineTo(idxX + 7, idxY + 22);
    ctx.stroke();
    ctx.restore();

    // Below Left Tape: High-Contrast Crisp Telemetry Block (`THR`, `MACH`, `G // MAX`, `α`)!
    const blockTopY = Math.min(vp.y + vp.height - 96, tapeTop + tapeH + 8);
    const leftBlockW = Math.round(196 * Math.max(0.85, hudScale));
    ctx.save();
    ctx.fillStyle = 'rgba(2, 9, 5, 0.72)';
    ctx.fillRect(leftX - 6, blockTopY, leftBlockW, 88);
    ctx.strokeStyle = 'rgba(68, 255, 119, 0.28)';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(leftX - 6, blockTopY, leftBlockW, 88);

    const metaY = blockTopY + 18;
    const thrPct = Math.round(sim.throttle * 100);
    const thrLabel =
      thrPct > 100
        ? `THR ${thrPct}% AB`
        : thrPct === 100
          ? 'THR 100% MIL'
          : thrPct === 0
            ? 'THR 0% IDLE'
            : `THR ${String(thrPct).padStart(3, '0')}%`;
    ctx.textAlign = 'left';
    ctx.font = 'bold 15.5px "JetBrains Mono", monospace';
    ctx.fillStyle = sim.afterburning ? '#FFB000' : '#44FF77';
    ctx.fillText(thrLabel, leftX + 2, metaY);
    ctx.fillStyle = sim.afterburning ? '#FFF6CC' : '#8EF5AB';
    ctx.fillText(`M ${sim.mach.toFixed(2)}`, leftX + 2, metaY + 21);
    if (sim.noeMultiplier > 1.05) {
      ctx.fillStyle = sim.noeActive ? '#44FF77' : '#FFB000';
      ctx.fillText(`NOE ${sim.noeMultiplier.toFixed(1)}X`, leftX + 86, metaY + 21);
    }
    ctx.fillStyle = sim.gLoad >= 6.0 ? '#FFB000' : '#8EF5AB';
    ctx.fillText(`${sim.gLoad.toFixed(1)}G // MAX ${sim.peakGLoad.toFixed(1)}G`, leftX + 2, metaY + 42);
    ctx.fillStyle = sim.isStalling ? COLORS.RED_KLAXON : '#44FF77';
    ctx.fillText(`α ${sim.aoaDeg.toFixed(1)}°`, leftX + 2, metaY + 63);
    ctx.restore();

    // -------------------------------------------------------------------------
    // 5. RIGHT HUD TAPE: RADAR ALTIMETER (RALT) + DYNAMIC SECTOR CEILING BAR + VVI CARET
    // -------------------------------------------------------------------------
    const ceilM = sim.sectorRadarCeilingM;
    const rightX = vp.x + vp.width - Math.max(22, Math.round(vp.width * 0.04)) - tapeW;

    ctx.fillStyle = 'rgba(2, 10, 5, 0.52)';
    ctx.fillRect(rightX, tapeTop, tapeW, tapeH);
    ctx.strokeStyle =
      sim.pullUpWarning || sim.ceilingBreached ? '#FFB000' : 'rgba(68, 255, 119, 0.65)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(rightX, tapeTop);
    ctx.lineTo(rightX, tapeTop + tapeH);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(rightX, tapeTop + 4, tapeW, tapeH - 8);
    ctx.clip();
    const pxPerM = 1.15 * hudScale;
    const minAlt = Math.floor((sim.raltM - 140) / 20) * 20;
    const maxAlt = Math.ceil((sim.raltM + 140) / 20) * 20;
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    for (let m = minAlt; m <= maxAlt; m += 20) {
      if (m < 0) continue;
      const ty = cy - (m - sim.raltM) * pxPerM;
      const major = m % 40 === 0;
      ctx.strokeStyle = major ? '#44FF77' : 'rgba(68, 255, 119, 0.5)';
      ctx.lineWidth = major ? 1.6 : 1.1;
      ctx.beginPath();
      ctx.moveTo(rightX, ty);
      ctx.lineTo(rightX + (major ? 14 : 8), ty);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = 'rgba(142, 245, 171, 0.85)';
        ctx.fillText(`${m}`, rightX + 18, ty + 4);
      }
    }

    // Explicit Hard Radar Ceiling Bar (`CEIL 190`) & Exposure Zone Shading above 190M!
    const ceilY = cy - (ceilM - sim.raltM) * pxPerM;
    if (ceilY > tapeTop) {
      ctx.fillStyle = sim.ceilingBreached ? 'rgba(255, 76, 36, 0.28)' : 'rgba(255, 176, 0, 0.14)';
      ctx.fillRect(rightX, tapeTop, tapeW, Math.min(tapeH, ceilY - tapeTop));
    }
    if (ceilY >= tapeTop - 10 && ceilY <= tapeTop + tapeH + 10) {
      ctx.strokeStyle = '#FFB000';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(rightX, ceilY);
      ctx.lineTo(rightX + tapeW, ceilY);
      ctx.stroke();
      ctx.fillStyle = '#FFB000';
      ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
      ctx.fillText(`CEIL ${ceilM}`, rightX + 10, ceilY - 5);
    }
    ctx.restore();

    // RALT Current Box
    const raltDanger = sim.pullUpWarning || sim.ceilingBreached;
    ctx.fillStyle = raltDanger ? 'rgba(68, 22, 6, 0.95)' : 'rgba(2, 14, 7, 0.95)';
    ctx.fillRect(rightX - 4, cy - 16, tapeW + 8, 32);
    ctx.strokeStyle = sim.pullUpWarning
      ? COLORS.RED_KLAXON
      : sim.ceilingBreached
        ? '#FFB000'
        : '#44FF77';
    ctx.lineWidth = 2.0;
    ctx.strokeRect(rightX - 4, cy - 16, tapeW + 8, 32);
    ctx.textAlign = 'center';
    ctx.font = 'bold 17.5px "JetBrains Mono", monospace';
    ctx.fillStyle = raltDanger ? '#FFF6CC' : '#44FF77';
    ctx.fillText(`${Math.round(sim.raltM)}M`, rightX + tapeW * 0.5, cy + 6);

    ctx.textAlign = 'right';
    ctx.font = 'bold 14px "Share Tech Mono", monospace';
    ctx.fillStyle = raltDanger ? '#FFB000' : '#8EF5AB';
    ctx.fillText(
      sim.ceilingBreached ? `CEIL >${ceilM}M` : `RALT // C${ceilM}`,
      rightX + tapeW - 2,
      tapeTop - 8
    );

    // Live Vertical Velocity (VVI) Caret along outside edge of RALT tape
    const vviNorm = Math.max(-1, Math.min(1, sim.vviMps / 110));
    const vviY = cy - vviNorm * (tapeH * 0.44);
    ctx.fillStyle = sim.vviMps < -15 && sim.raltM < 60 ? '#FFB000' : '#44FF77';
    ctx.beginPath();
    ctx.moveTo(rightX - 3, vviY);
    ctx.lineTo(rightX - 13, vviY - 5.5);
    ctx.lineTo(rightX - 13, vviY + 5.5);
    ctx.closePath();
    ctx.fill();

    // Below Right Tape: High-Contrast Crisp Weapons & CMDS Stores Block (`VVI`, `GUN`, `MSL`, `CMDS`)!
    const rightBlockW = Math.round(184 * Math.max(0.85, hudScale));
    const rightBlockX = rightX + tapeW - rightBlockW + 6;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 9, 5, 0.72)';
    ctx.fillRect(rightBlockX, blockTopY, rightBlockW, 88);
    ctx.strokeStyle = 'rgba(68, 255, 119, 0.28)';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(rightBlockX, blockTopY, rightBlockW, 88);

    ctx.textAlign = 'right';
    ctx.font = 'bold 14.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    const vviSign = sim.vviMps >= 0 ? '+' : '';
    ctx.fillText(`VVI ${vviSign}${Math.round(sim.vviMps)}`, rightX + tapeW - 2, metaY);

    const gunCol =
      sim.gunAmmo <= 0
        ? COLORS.RED_KLAXON
        : sim.gunAmmo <= 80
          ? '#FFB000'
          : sim.gunFiringNow
            ? '#FFF6CC'
            : '#44FF77';
    const mslCol =
      sim.missilesRemaining <= 0
        ? COLORS.RED_KLAXON
        : sim.lockState === 'LOCKED'
          ? '#FFB000'
          : '#8EF5AB';
    const cmdsCol =
      sim.cmdsRemaining <= 0
        ? COLORS.RED_KLAXON
        : sim.cmdsCooldown > 0
          ? 'rgba(255, 176, 0, 0.78)'
          : '#44FFDD';

    ctx.font = 'bold 15.5px "JetBrains Mono", monospace';
    ctx.fillStyle = gunCol;
    ctx.fillText(`GUN: ${String(sim.gunAmmo).padStart(3, '0')} RDS`, rightX + tapeW - 2, metaY + 21);
    ctx.fillStyle = mslCol;
    ctx.fillText(
      sim.lockState === 'LOCKED'
        ? `MSL: ${sim.missilesRemaining} [RDY]`
        : `MSL: ${sim.missilesRemaining}`,
      rightX + tapeW - 2,
      metaY + 42
    );
    ctx.fillStyle = cmdsCol;
    ctx.fillText(
      sim.cmdsCooldown > 0
        ? `CMDS: ${sim.cmdsRemaining} (${sim.cmdsCooldown.toFixed(1)}S)`
        : `CMDS: ${sim.cmdsRemaining} [C/F]`,
      rightX + tapeW - 2,
      metaY + 63
    );
    ctx.restore();

    // -------------------------------------------------------------------------
    // 6. DYNAMIC F-16 EEGS GUN FUNNEL (curves with roll rate & G-load!)
    // -------------------------------------------------------------------------
    this.drawEegsGunFunnel(ctx, sim, cx, cy, focalLen, hudScale);

    // -------------------------------------------------------------------------
    // 7. LIVE BALLISTIC IMPACT / LEAD-COMPUTING PIPPER (CCIP / LCOS)
    // -------------------------------------------------------------------------
    this.drawBallisticPipper(ctx, params, vp, hudScale);

    // -------------------------------------------------------------------------
    // 7B. ZERO-CLUTTER 3-CLASS TARGET HUD BRACKETS (SAM DIAMOND, BANDIT CARET, CYAN RESUPPLY HEX)
    // -------------------------------------------------------------------------
    this.drawTargetClassBrackets(ctx, params, vp, timeSec);

    // -------------------------------------------------------------------------
    // 8. SIDEWINDER IR SEEKER CONE (+40% WIDER / 0.35s LOCK), TD BOX & SHOOT CUE
    // -------------------------------------------------------------------------
    this.drawMissileSeekerAndTdBox(ctx, params, vp, cx, cy, focalLen, hudScale, timeSec);

    // -------------------------------------------------------------------------
    // 8B. 3D DIRECTIONAL INCOMING-SAM BREAK-TURN CHEVRON & EDGE THREAT VIGNETTES
    // -------------------------------------------------------------------------
    const samTel = sim.getPrimaryIncomingSamTelemetry();
    if (samTel) {
      const ringR = Math.min(vp.height * 0.36, 175 * hudScale);
      const ang = samTel.hudAngleRad;
      const tipX = cx + Math.cos(ang) * (ringR + 18);
      const tipY = cy + Math.sin(ang) * (ringR + 18);
      const baseX = cx + Math.cos(ang) * (ringR - 4);
      const baseY = cy + Math.sin(ang) * (ringR - 4);
      const perpX = -Math.sin(ang);
      const perpY = Math.cos(ang);
      const pulse = Math.sin(timeSec * 20) > -0.25;

      ctx.save();
      ctx.strokeStyle = pulse ? COLORS.RED_KLAXON : '#FFB000';
      ctx.fillStyle = pulse ? 'rgba(255, 51, 34, 0.35)' : 'rgba(255, 176, 0, 0.25)';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(baseX + perpX * 13, baseY + perpY * 13);
      ctx.lineTo(baseX + Math.cos(ang) * 5, baseY + Math.sin(ang) * 5);
      ctx.lineTo(baseX - perpX * 13, baseY - perpY * 13);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const lblR = ringR - 26;
      const lx = cx + Math.cos(ang) * lblR;
      const ly = cy + Math.sin(ang) * lblR;
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.fillStyle = pulse ? '#FFF6CC' : '#FFB000';
      ctx.fillText(`SAM ${Math.round(samTel.distM)}M`, lx, ly + 4);
      ctx.restore();
    }

    if (sim.ceilingBreached) {
      const a = 0.14 + 0.1 * Math.sin(timeSec * 12);
      const grad = ctx.createLinearGradient(0, vp.y, 0, vp.y + 42);
      grad.addColorStop(0, `rgba(255, 48, 24, ${a.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255, 48, 24, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(vp.x, vp.y, vp.width, 42);
    }
    if (sim.purgeThermalAlert) {
      const a = 0.14 + 0.1 * Math.sin(timeSec * 10);
      const grad = ctx.createLinearGradient(0, vp.y + vp.height, 0, vp.y + vp.height - 38);
      grad.addColorStop(0, `rgba(255, 160, 0, ${a.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255, 160, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(vp.x, vp.y + vp.height - 38, vp.width, 38);
    }

    // -------------------------------------------------------------------------
    // 9. SUBTLE POINTER-LOCK VIRTUAL STICK DEADZONE RING (4%) & DEFLECTION PIP
    // -------------------------------------------------------------------------
    if (!params.osdMenuOpen && !params.manifestOpen) {
      const dzR = Math.max(12, params.stickDeadzonePx);
      const stickSpan = Math.min(vp.width, vp.height) * 0.28;
      const normMag = Math.hypot(params.stickNormX, params.stickNormY);
      const insideDz = normMag <= 0.04;
      const visualR = insideDz
        ? (normMag / 0.04) * dzR
        : dzR + ((Math.min(1, normMag) - 0.04) / 0.96) * (stickSpan - dzR);
      const dotX = normMag > 0.0005 ? cx + (params.stickNormX / normMag) * visualR : cx;
      const dotY = normMag > 0.0005 ? cy + (params.stickNormY / normMag) * visualR : cy;

      ctx.save();
      ctx.strokeStyle = insideDz ? 'rgba(68, 255, 119, 0.36)' : 'rgba(68, 255, 119, 0.22)';
      ctx.lineWidth = 1.15;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, dzR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Subtle deflection tether & virtual stick pip
      if (!insideDz) {
        ctx.strokeStyle = 'rgba(142, 245, 171, 0.24)';
        ctx.lineWidth = 1.0;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(dotX, dotY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = insideDz ? 'rgba(142, 245, 171, 0.78)' : '#FFB000';
      ctx.beginPath();
      ctx.arc(dotX, dotY, insideDz ? 2.4 : 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = insideDz ? 'rgba(68, 255, 119, 0.48)' : 'rgba(255, 246, 204, 0.8)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(dotX, dotY, insideDz ? 4.8 : 6.0, 0, Math.PI * 2);
      ctx.stroke();

      // Subtle non-blocking prompt if flying in unlocked cursor-stick mode!
      if (!params.pointerLocked && !sim.paused) {
        ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(142, 245, 171, 0.82)';
        ctx.fillText(
          '[ CURSOR STICK ACTIVE · CLICK CANOPY FOR FULL LOCK · ARROWS PITCH/ROLL ]',
          cx,
          vp.y + 82
        );
      }
      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // 10. CRITICAL FLIGHT WARNINGS: SAM LAUNCH / 3.5S SAM LOCK, STALL, PULL UP, WEAPON CUE
    // -------------------------------------------------------------------------
    let warnY = vp.y + 104;
    ctx.textAlign = 'center';

    if (sim.samIncomingActive && Math.sin(timeSec * 18) > -0.3) {
      ctx.font = 'bold 19px "Share Tech Mono", monospace';
      ctx.fillStyle = COLORS.RED_KLAXON;
      ctx.fillText('⚠ SAM INBOUND // POP CMDS [C / F] OR 7G BREAK ⚠', cx, warnY);
      warnY += 24;
    } else if (sim.samLockActive && Math.sin(timeSec * 14) > -0.3) {
      const remSec = Math.max(0, sim.samLockCountdownSec);
      ctx.font = 'bold 18.5px "Share Tech Mono", monospace';
      ctx.fillStyle = '#FFB000';
      ctx.fillText(
        sim.ceilingBreached
          ? `▲ TERRAIN MASK LOST (>${sim.sectorRadarCeilingM}M) // SAM LAUNCH ${remSec.toFixed(1)}S ▲`
          : `▲ SAM RADAR LOCK (${remSec.toFixed(1)}S) // MASK BEHIND MESA OR CMDS ▲`,
        cx,
        warnY
      );
      warnY += 23;
    }

    if (sim.isStalling && Math.sin(timeSec * 15) > -0.25) {
      ctx.font = 'bold 18px "Share Tech Mono", monospace';
      ctx.fillStyle = COLORS.RED_KLAXON;
      ctx.fillText('▼ STALL // LOW SPEED (<180 KCAS) — ADD THROTTLE [W] ▼', cx, warnY);
      warnY += 22;
    }

    if (sim.pullUpWarning && Math.sin(timeSec * 18) > -0.25) {
      const py = cy + 68 * hudScale;
      ctx.strokeStyle = '#FFB000';
      ctx.lineWidth = 3.0;
      for (let k = 0; k < 2; k++) {
        const yOff = py + k * 14;
        ctx.beginPath();
        ctx.moveTo(cx - 48, yOff + 14);
        ctx.lineTo(cx, yOff);
        ctx.lineTo(cx + 48, yOff + 14);
        ctx.stroke();
      }
      ctx.font = 'bold 20px "Share Tech Mono", monospace';
      ctx.fillStyle = '#FFB000';
      ctx.fillText('▲ PULL UP // LOW RALT ▲', cx, py + 48);
    }

    if (sim.weaponCueText && sim.weaponCueTimer > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, sim.weaponCueTimer * 2.2);
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px "Share Tech Mono", monospace';
      ctx.fillStyle = sim.weaponCueText.includes('RESUPPLY')
        ? '#00F0FF'
        : sim.weaponCueText.includes('SECTOR CLEAR')
          ? '#44FF77'
          : sim.weaponCueText.includes('FOX-2') || sim.weaponCueText.includes('DECOYED')
            ? '#FFF6CC'
            : '#FFB000';
      ctx.fillText(sim.weaponCueText, cx, vp.y + vp.height - 38);
      ctx.restore();
    }

    // Floating score / impact popups
    for (const pop of sim.popups) {
      const a = Math.max(0, 1 - pop.age / pop.duration);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = 'bold 18px "Share Tech Mono", monospace';
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, cx + pop.nx * vp.width * 0.5, cy + pop.ny * vp.height * 0.5);
      if (pop.subText) {
        ctx.font = 'bold 12px "JetBrains Mono", monospace';
        ctx.fillStyle = '#8EF5AB';
        ctx.fillText(pop.subText, cx + pop.nx * vp.width * 0.5, cy + pop.ny * vp.height * 0.5 + 17);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Authentic F-16 Enhanced Envelope Gun Sight (EEGS) Funnel below boresight.
   * Curves dynamically with aircraft roll rate (`sim.rollRateRadS`) and G-load (`sim.gLoad`)!
   */
  private drawEegsGunFunnel(
    ctx: CanvasRenderingContext2D,
    sim: TrenchSimulation,
    cx: number,
    cy: number,
    focalLen: number,
    hudScale: number
  ): void {
    const muzzle = TRENCH_CONSTANTS.GUN_MUZZLE_SPEED_MPS;
    const g = TRENCH_CONSTANTS.GUN_GRAVITY_MPS2;
    const wingspanHalfM = 6.2; // Target wingspan reference for stadiametric funnel width
    const steps = 12;
    const tMin = 0.14;
    const tMax = 0.74;

    const leftPts: Array<{ x: number; y: number }> = [];
    const rightPts: Array<{ x: number; y: number }> = [];

    const rollCurve = sim.rollRateRadS; // rad/s
    const gAccel = Math.max(-1.0, sim.gLoad - 1.0) * 9.81;

    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const t = tMin + f * (tMax - tMin);
      const dist = Math.max(40, muzzle * t);

      // Apparent downward deflection in cockpit frame due to G-load pull + ballistic gravity drop
      const dropM = 0.5 * (g + gAccel * 0.85) * t * t;
      // Lateral sweep due to active aircraft roll & yaw turning during round time-of-flight
      const driftX = -rollCurve * dropM * 0.72 - sim.yawRateRadS * dist * t * 0.14;

      const scale = focalLen / dist;
      const px = cx + driftX * scale;
      const py = cy + dropM * scale + 16 * hudScale;
      const halfW = Math.max(7 * hudScale, Math.min(82 * hudScale, wingspanHalfM * scale));

      // Bank funnel ribs subtly with active roll curvature
      const twist = Math.max(-0.55, Math.min(0.55, -rollCurve * t * 0.55));
      const cosT = Math.cos(twist);
      const sinT = Math.sin(twist);

      leftPts.push({ x: px - halfW * cosT, y: py - halfW * sinT });
      rightPts.push({ x: px + halfW * cosT, y: py + halfW * sinT });
    }

    ctx.save();
    ctx.strokeStyle = sim.gunFiringNow
      ? 'rgba(255, 198, 72, 0.72)'
      : 'rgba(68, 255, 119, 0.48)';
    ctx.lineWidth = sim.gunFiringNow ? 1.85 : 1.35;

    // Left funnel rail
    ctx.beginPath();
    leftPts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();

    // Right funnel rail
    ctx.beginPath();
    rightPts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();

    // Subtle stadiametric range ticks along funnel rails (300m / 500m / 700m)
    ctx.strokeStyle = 'rgba(142, 245, 171, 0.42)';
    ctx.lineWidth = 1.1;
    for (const idx of [3, 7, 11]) {
      const lp = leftPts[idx];
      const rp = rightPts[idx];
      const mx = (lp.x + rp.x) * 0.5;
      const my = (lp.y + rp.y) * 0.5;
      ctx.beginPath();
      ctx.moveTo(lp.x, lp.y);
      ctx.lineTo(lp.x + (mx - lp.x) * 0.28, lp.y + (my - lp.y) * 0.28);
      ctx.moveTo(rp.x, rp.y);
      ctx.lineTo(rp.x + (mx - rp.x) * 0.28, rp.y + (my - rp.y) * 0.28);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Classic F-16 Circular Gun Reticle with Winding Range Arc:
   * - LCOS (amber/gold) when a target is tracked/locked — putting pipper on target guarantees hits!
   * - CCIP (P39 green) when untracked — shows live ballistic canyon floor/wall impact point!
   */
  private drawBallisticPipper(
    ctx: CanvasRenderingContext2D,
    params: TrenchHudRenderParams,
    vp: ViewportRect,
    hudScale: number
  ): void {
    const { sim } = params;
    const sol = sim.computeBallisticPipper();
    const p = params.projectWorld(sol.worldPoint.x, sol.worldPoint.y, sol.worldPoint.z);
    if (!p) return;

    // Clamp gently inside canopy bounds so pipper never disappears awkwardly at screen rim
    const pad = 28;
    const px = Math.max(vp.x + pad, Math.min(vp.x + vp.width - pad, p.sx));
    const py = Math.max(vp.y + pad, Math.min(vp.y + vp.height - pad, p.sy));

    const isLcos = sol.mode === 'LCOS';
    const isPodCue = Boolean(sol.isResupplyCue);
    const r = Math.round((isLcos ? 19 : 16) * hudScale);
    const col = sim.gunFiringNow
      ? '#FFF6CC'
      : isPodCue
        ? '#00F0FF'
        : isLcos
          ? '#FFB000'
          : sol.hitTerrain
            ? '#8EF5AB'
            : 'rgba(68, 255, 119, 0.72)';

    ctx.save();
    // Outer thin reticle ring
    ctx.strokeStyle = isPodCue
      ? 'rgba(0, 240, 255, 0.5)'
      : isLcos
        ? 'rgba(255, 176, 0, 0.45)'
        : 'rgba(68, 255, 119, 0.38)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.stroke();

    // Winding F-16 Range Arc (sweeps clockwise from 12 o'clock representing 0..950m slant range!)
    const rngFrac = Math.max(0.06, Math.min(1, sol.distM / 950));
    const startA = -Math.PI * 0.5;
    const endA = startA + rngFrac * Math.PI * 2;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(px, py, r, startA, endA);
    ctx.stroke();

    // Range-arc tip tick & 4 cardinal mil-spec ticks
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 4; k++) {
      const a = k * (Math.PI * 0.5);
      ctx.beginPath();
      ctx.moveTo(px + Math.cos(a) * (r - 3), py + Math.sin(a) * (r - 3));
      ctx.lineTo(px + Math.cos(a) * (r + 5), py + Math.sin(a) * (r + 5));
      ctx.stroke();
    }

    // Center precision ballistic pip dot
    ctx.fillStyle = isLcos ? '#FFF6CC' : col;
    ctx.beginPath();
    ctx.arc(px, py, 2.3, 0, Math.PI * 2);
    ctx.fill();

    // Crisp hit-confirm diagonal X right over pipper when 20mm rounds strike target!
    if (sim.hitConfirmTimer > 0) {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      const h = 11;
      ctx.beginPath();
      ctx.moveTo(px - h, py - h);
      ctx.lineTo(px - 4, py - 4);
      ctx.moveTo(px + h, py - h);
      ctx.lineTo(px + 4, py - 4);
      ctx.moveTo(px - h, py + h);
      ctx.lineTo(px - 4, py + 4);
      ctx.moveTo(px + h, py + h);
      ctx.lineTo(px + 4, py + 4);
      ctx.stroke();
    }

    // Mode & Slant Range tag beside reticle
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = col;
    const distStr =
      sol.distM >= 1000 ? `${(sol.distM / 1000).toFixed(1)}KM` : `${Math.round(sol.distM)}M`;
    const modeTag = isPodCue ? 'POD' : sol.mode;
    ctx.fillText(`${modeTag} ${distStr}`, px + r + 8, py + 4);
    ctx.restore();
  }

  /**
   * Clean Top-HUD Sector Strike Objective Counter (`SEC-01 OBJ: 3 SAM // 2 BANDITS`) + 6km progress gauge!
   */
  private drawSectorObjectiveStrip(
    ctx: CanvasRenderingContext2D,
    sim: TrenchSimulation,
    vp: ViewportRect,
    hdgX: number,
    hdgY: number,
    hdgW: number,
    hudScale: number
  ): void {
    const leftSpace = hdgX - (vp.x + 18);
    const wide = leftSpace >= 265;
    const boxW = wide ? Math.min(315, Math.round(285 * Math.max(0.92, hudScale))) : 272;
    const boxH = 42;
    const bx = wide ? vp.x + Math.max(18, Math.round(vp.width * 0.036)) : Math.round(hdgX + (hdgW - boxW) * 0.5);
    const by = wide ? hdgY : hdgY + 60;

    const allDone = sim.sectorSamsRemaining === 0 && sim.sectorBanditsRemaining === 0;
    const sectorFrac = Math.max(
      0,
      Math.min(1, (sim.z - sim.sectorStartZ) / Math.max(1, TRENCH_CONSTANTS.SECTOR_LENGTH_M))
    );
    const remKm = Math.max(0, (sim.sectorEndZ - sim.z) / 1000).toFixed(1);

    ctx.save();
    ctx.fillStyle = 'rgba(2, 11, 6, 0.78)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = allDone ? '#44FF77' : 'rgba(68, 255, 119, 0.45)';
    ctx.lineWidth = allDone ? 1.8 : 1.3;
    ctx.strokeRect(bx, by, boxW, boxH);

    // Top row: `SEC-01 OBJ: 3 SAM // 2 BANDITS` with color-coded counts!
    ctx.textAlign = 'left';
    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    let tx = bx + 9;
    const ty = by + 18;
    const secHead = `${sim.sectorId} OBJ: `;
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText(secHead, tx, ty);
    tx += ctx.measureText(secHead).width;

    const samStr = `${sim.sectorSamsRemaining} SAM`;
    ctx.fillStyle = sim.sectorSamsRemaining > 0 ? '#FF5533' : '#44FF77';
    ctx.fillText(samStr, tx, ty);
    tx += ctx.measureText(samStr).width;

    const sep = ' // ';
    ctx.fillStyle = 'rgba(142, 245, 171, 0.65)';
    ctx.fillText(sep, tx, ty);
    tx += ctx.measureText(sep).width;

    const banStr = `${sim.sectorBanditsRemaining} BANDIT${sim.sectorBanditsRemaining === 1 ? '' : 'S'}`;
    ctx.fillStyle = sim.sectorBanditsRemaining > 0 ? '#FFB000' : '#44FF77';
    ctx.fillText(banStr, tx, ty);

    // Bottom thin 6km sector progress track + remaining km readout
    const barX = bx + 9;
    const barY = by + 29;
    const barW = boxW - 88;
    ctx.fillStyle = 'rgba(14, 34, 20, 0.9)';
    ctx.fillRect(barX, barY, barW, 6);
    ctx.fillStyle = allDone ? '#44FF77' : '#FFB000';
    ctx.fillRect(barX, barY, Math.max(3, barW * sectorFrac), 6);

    ctx.textAlign = 'right';
    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    ctx.fillStyle = allDone ? '#44FF77' : '#8EF5AB';
    ctx.fillText(allDone ? 'CLEAR!' : `${remKm}KM`, bx + boxW - 8, by + 35);
    ctx.restore();
  }

  /**
   * Zero-Clutter 3-Class Unmistakable Target HUD Brackets across 3,800m–4,000m sightlines:
   * 1. `SAM_SITE`: Red-Amber Diamond (#FF3322) + pulsing lock-ring if actively locking player
   * 2. `BANDIT_DRONE`: Bright Amber Caret (`^`, #FFB000)
   * 3. `RESUPPLY_CACHE`: Electric Cyan Hexagon (#00F0FF) clearly labeled `RESUPPLY` from 3,000m away!
   */
  private drawTargetClassBrackets(
    ctx: CanvasRenderingContext2D,
    params: TrenchHudRenderParams,
    vp: ViewportRect,
    timeSec: number
  ): void {
    const { sim } = params;
    const pad = 22;

    ctx.save();
    for (const t of sim.targets) {
      if (t.destroyed) continue;
      // Active TD-boxed/locked target gets its upgraded lock symbology in drawMissileSeekerAndTdBox
      if (t.id === sim.lockedTargetId) continue;

      const pt = params.projectWorld(t.x, t.y, t.z);
      if (!pt || pt.cz > TRENCH_CONSTANTS.VIEW_DISTANCE + 80) continue;
      if (
        pt.sx < vp.x + pad ||
        pt.sx > vp.x + vp.width - pad ||
        pt.sy < vp.y + pad ||
        pt.sy > vp.y + vp.height - pad
      ) {
        continue;
      }

      const slantM = Math.hypot(t.x - sim.x, t.y - sim.y, t.z - sim.z);
      const distStr = slantM >= 1000 ? `${(slantM / 1000).toFixed(1)}KM` : `${Math.round(slantM)}M`;
      const baseR = Math.max(12, Math.min(26, t.radius * pt.scale + 7));

      if (t.kind === 'SAM_SITE') {
        const locking = (t.samLockTimer ?? 0) > 0.25;
        const blink = locking && Math.sin(timeSec * 16) > 0;
        const col = blink ? '#FFF6CC' : '#FF3322';
        ctx.strokeStyle = col;
        ctx.lineWidth = locking ? 2.2 : 1.75;
        ctx.beginPath();
        ctx.moveTo(pt.sx, pt.sy - baseR);
        ctx.lineTo(pt.sx + baseR, pt.sy);
        ctx.lineTo(pt.sx, pt.sy + baseR);
        ctx.lineTo(pt.sx - baseR, pt.sy);
        ctx.closePath();
        ctx.stroke();

        if (locking) {
          const outer = baseR + 5;
          ctx.strokeStyle = 'rgba(255, 51, 34, 0.85)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(pt.sx, pt.sy - outer);
          ctx.lineTo(pt.sx + outer, pt.sy);
          ctx.lineTo(pt.sx, pt.sy + outer);
          ctx.lineTo(pt.sx - outer, pt.sy);
          ctx.closePath();
          ctx.stroke();
        }

        if (locking || slantM <= 1800) {
          ctx.textAlign = 'center';
          ctx.font = 'bold 12px "JetBrains Mono", monospace';
          ctx.fillStyle = col;
          ctx.fillText(locking ? 'SAM!' : 'SAM', pt.sx, pt.sy - baseR - 5);
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          ctx.fillStyle = 'rgba(255, 160, 128, 0.9)';
          ctx.fillText(distStr, pt.sx, pt.sy + baseR + 13);
        }
      } else if (t.kind === 'BANDIT_DRONE') {
        // Bright Amber Caret (`^`) HUD Bracket!
        ctx.strokeStyle = '#FFB000';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(pt.sx - baseR * 1.05, pt.sy + baseR * 0.45);
        ctx.lineTo(pt.sx, pt.sy - baseR * 0.92);
        ctx.lineTo(pt.sx + baseR * 1.05, pt.sy + baseR * 0.45);
        ctx.stroke();

        // Subtle wing-level base ticks beneath caret
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(pt.sx - baseR * 0.72, pt.sy + baseR * 0.65);
        ctx.lineTo(pt.sx - baseR * 0.25, pt.sy + baseR * 0.65);
        ctx.moveTo(pt.sx + baseR * 0.25, pt.sy + baseR * 0.65);
        ctx.lineTo(pt.sx + baseR * 0.72, pt.sy + baseR * 0.65);
        ctx.stroke();

        if (slantM <= 1800) {
          ctx.textAlign = 'center';
          ctx.font = 'bold 12px "JetBrains Mono", monospace';
          ctx.fillStyle = '#FFB000';
          ctx.fillText('BANDIT', pt.sx, pt.sy - baseR - 4);
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          ctx.fillStyle = 'rgba(255, 224, 150, 0.88)';
          ctx.fillText(distStr, pt.sx, pt.sy + baseR + 14);
        }
      } else {
        // `RESUPPLY_CACHE`: Electric Cyan Hexagon (#00F0FF) — Shoot OR Fly-Through (55m pickup ring)!
        const hexR = Math.max(14, baseR + 2);
        ctx.strokeStyle = '#00F0FF';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const hx = pt.sx + Math.cos(a) * hexR;
          const hy = pt.sy + Math.sin(a) * hexR;
          if (k === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.stroke();

        if (slantM <= 2200) {
          ctx.textAlign = 'center';
          ctx.font = 'bold 12.5px "Share Tech Mono", monospace';
          ctx.fillStyle = '#00F0FF';
          ctx.fillText(
            slantM <= 1050 ? 'RESUPPLY [GUN / FLY]' : 'RESUPPLY',
            pt.sx,
            pt.sy - hexR - 6
          );
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          ctx.fillStyle = '#B8FFFF';
          ctx.fillText(distStr, pt.sx, pt.sy + hexR + 14);
        }
      }
    }
    ctx.restore();
  }

  /**
   * Sidewinder IR Seeker Cone Circle (+40% wider 22° cone) + Snappy 0.35s TD Box:
   * - TRACKING: Class-coded dashed TD Bracket + slant range + lock-build bar
   * - LOCKED (0.35s inside seeker circle): Solid glowing amber/red Diamond + `SHOOT` HUD cue!
   */
  private drawMissileSeekerAndTdBox(
    ctx: CanvasRenderingContext2D,
    params: TrenchHudRenderParams,
    vp: ViewportRect,
    cx: number,
    cy: number,
    focalLen: number,
    hudScale: number,
    timeSec: number
  ): void {
    const { sim } = params;

    // 1. Widened (+40%) HUD IR Seeker Cone Circle centered on boresight when missiles are loaded
    if (sim.missilesRemaining > 0) {
      const seekerRad = (TRENCH_CONSTANTS.MISSILE_SEEKER_HALF_ANGLE_DEG * Math.PI) / 180;
      const seekerPx = Math.min(vp.height * 0.42, Math.tan(seekerRad) * focalLen);
      ctx.save();
      ctx.strokeStyle =
        sim.lockState === 'LOCKED'
          ? 'rgba(255, 176, 0, 0.56)'
          : sim.lockedTargetInSeeker
            ? 'rgba(68, 255, 119, 0.38)'
            : 'rgba(68, 255, 119, 0.18)';
      ctx.lineWidth = sim.lockState === 'LOCKED' ? 1.8 : 1.15;
      ctx.setLineDash(sim.lockState === 'LOCKED' ? [] : [8, 10]);
      ctx.beginPath();
      ctx.arc(cx, cy, seekerPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    const lockedTarget = sim.getLockedTarget();
    if (!lockedTarget) return;

    const pt = params.projectWorld(lockedTarget.x, lockedTarget.y, lockedTarget.z);
    if (!pt) return;

    const pad = 26;
    const tx = Math.max(vp.x + pad, Math.min(vp.x + vp.width - pad, pt.sx));
    const ty = Math.max(vp.y + pad, Math.min(vp.y + vp.height - pad, pt.sy));
    const isLocked = sim.lockState === 'LOCKED';
    const distKmStr =
      sim.lockedSlantRangeM >= 1000
        ? `${(sim.lockedSlantRangeM / 1000).toFixed(1)} KM`
        : `${Math.round(sim.lockedSlantRangeM)} M`;
    const kindShort =
      lockedTarget.kind === 'SAM_SITE'
        ? 'SAM'
        : lockedTarget.kind === 'BANDIT_DRONE'
          ? 'BANDIT'
          : 'RESUPPLY';
    const classCol =
      lockedTarget.kind === 'SAM_SITE'
        ? '#FF3322'
        : lockedTarget.kind === 'BANDIT_DRONE'
          ? '#FFB000'
          : '#00F0FF';

    ctx.save();
    if (isLocked) {
      // LOCKED: Solid glowing amber/red diamond snapping onto target + flashing SHOOT cue!
      const pulse = 0.55 + 0.45 * Math.sin(timeSec * 16);
      const d = Math.max(20, Math.min(46, lockedTarget.radius * pt.scale + 12));
      const diaCol =
        lockedTarget.kind === 'RESUPPLY_CACHE'
          ? pulse > 0.5
            ? '#00F0FF'
            : '#FFF6CC'
          : pulse > 0.55
            ? '#FFB000'
            : COLORS.RED_KLAXON;

      ctx.strokeStyle = diaCol;
      ctx.lineWidth = 2.7;
      ctx.beginPath();
      ctx.moveTo(tx, ty - d);
      ctx.lineTo(tx + d, ty);
      ctx.lineTo(tx, ty + d);
      ctx.lineTo(tx - d, ty);
      ctx.closePath();
      ctx.stroke();

      // Inner bright hot-lock diamond outline
      ctx.strokeStyle = '#FFF6CC';
      ctx.lineWidth = 1.45;
      const dIn = d * 0.72;
      ctx.beginPath();
      ctx.moveTo(tx, ty - dIn);
      ctx.lineTo(tx + dIn, ty);
      ctx.lineTo(tx, ty + dIn);
      ctx.lineTo(tx - dIn, ty);
      ctx.closePath();
      ctx.stroke();

      // Slant Range & LOCK tag above diamond
      ctx.font = 'bold 13px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFF6CC';
      ctx.fillText(`LOCK // ${kindShort}`, tx, ty - d - 8);
      ctx.fillStyle = diaCol;
      ctx.fillText(distKmStr, tx, ty + d + 16);

      // Iconic Flashing `SHOOT` Cue on HUD!
      if (Math.sin(timeSec * 14) > -0.35) {
        ctx.font = `bold ${Math.round(21 * hudScale)}px "Share Tech Mono", monospace`;
        ctx.fillStyle = pulse > 0.5 ? '#FFB000' : COLORS.RED_KLAXON;
        ctx.fillText('◆ SHOOT ◆', cx, cy - 52 * hudScale);
        ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
        ctx.fillStyle = '#FFF6CC';
        ctx.fillText('[RMB / SPACE] FOX-2', cx, cy - 35 * hudScale);
      }
    } else {
      // TRACKING: Class-coded Target Designator (TD) Box + live slant range + snappy 0.35s lock bar!
      const b = Math.max(18, Math.min(44, lockedTarget.radius * pt.scale + 10));
      const boxCol =
        sim.lockedTargetInSeeker && sim.missilesRemaining > 0 ? '#FFB000' : classCol;

      ctx.strokeStyle = boxCol;
      ctx.lineWidth = 2.1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(tx - b, ty - b, b * 2, b * 2);
      ctx.setLineDash([]);

      // Lock-acquire fill gauge along bottom of TD Box
      if (sim.lockProgress > 0.02 && sim.missilesRemaining > 0) {
        const barW = b * 2;
        ctx.fillStyle = 'rgba(2, 12, 6, 0.8)';
        ctx.fillRect(tx - b, ty + b + 4, barW, 4);
        ctx.fillStyle = '#FFB000';
        ctx.fillRect(tx - b, ty + b + 4, barW * sim.lockProgress, 4);
      }

      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = boxCol;
      ctx.fillText(`TRK ${kindShort}`, tx, ty - b - 6);
      ctx.fillStyle = '#8EF5AB';
      ctx.fillText(distKmStr, tx, ty + b + 20);
    }
    ctx.restore();
  }

  // ===========================================================================
  // LOWER COCKPIT INSTRUMENT CLUSTER (ANGLED GLARE-SHIELD + 4-PANEL F-16 MFDS!)
  // ===========================================================================
  private drawLowerCockpitCluster(
    ctx: CanvasRenderingContext2D,
    params: TrenchHudRenderParams,
    dashVp: ViewportRect,
    canopyVp: ViewportRect
  ): void {
    const { sim, timeSec } = params;
    const { x, y, width: w, height: h } = dashVp;

    ctx.save();

    // Subtle Angled Outer Canopy Bow Struts rising up from cockpit dash corners
    ctx.strokeStyle = 'rgba(35, 140, 64, 0.32)';
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.moveTo(0, y + 6);
    ctx.lineTo(Math.min(54, w * 0.04), canopyVp.y);
    ctx.moveTo(w, y + 6);
    ctx.lineTo(w - Math.min(54, w * 0.04), canopyVp.y);
    ctx.stroke();

    // Physical 1979 F-16 / Nostromo Angled Glare-Shield Console Chassis
    const centerCrownRise = 14;
    ctx.fillStyle = '#030A06';
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + 8);
    ctx.lineTo(x + w * 0.24, y);
    ctx.lineTo(x + w * 0.38, y - centerCrownRise);
    ctx.lineTo(x + w * 0.62, y - centerCrownRise);
    ctx.lineTo(x + w * 0.76, y);
    ctx.lineTo(x + w, y + 8);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = COLORS.GREEN_MID;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Glare-Shield Master Caution Annunciator strip neatly centered inside raised crown!
    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    const criticalAlert =
      sim.samIncomingActive ||
      sim.samLockActive ||
      sim.isStalling ||
      sim.pullUpWarning ||
      sim.ceilingBreached;
    const warnFlash = criticalAlert && Math.sin(timeSec * 18) > -0.2;
    ctx.fillStyle = warnFlash ? COLORS.RED_KLAXON : 'rgba(68, 255, 119, 0.88)';
    const crownMsg = sim.samIncomingActive
      ? '⚠ MASTER CAUTION // SAM INBOUND — CMDS [C/F] OR 7G BREAK ⚠'
      : sim.samLockActive
        ? `⚠ SAM RADAR LOCK (${sim.samLockCountdownSec.toFixed(1)}S) — MASK OR CMDS ⚠`
        : sim.isStalling
          ? '⚠ MASTER CAUTION // STALL (<180 KCAS) ⚠'
          : sim.ceilingBreached
            ? `⚠ CEILING BREACH (>${sim.sectorRadarCeilingM}M) — DESCEND ⚠`
            : sim.pullUpWarning
              ? '⚠ MASTER CAUTION // LOW RALT TERRAIN ⚠'
              : params.pointerLocked
                ? 'VECTOR JET // HOTAS LOCKED'
                : 'VECTOR JET // CURSOR STICK';
    ctx.fillText(crownMsg, x + w * 0.5, y - 3, Math.round(w * 0.44));

    // 4 Dedicated F-16 Cockpit MFDs:
    // 1. RWR SCOPE | 2. TFR & PURGE WAVE | 3. ADI & ENGINE DED | 4. SMS STORES (6x MSL + 8x CMDS) & CANYON RADAR
    const padX = Math.max(10, Math.round(w * 0.014));
    const gap = Math.max(8, Math.round(w * 0.009));
    const mfdY = y + 10;
    const mfdH = Math.max(114, h - 18);
    const totalInnerW = w - padX * 2 - gap * 3;

    const w1 = Math.floor(totalInnerW * 0.21);
    const w2 = Math.floor(totalInnerW * 0.24);
    const w3 = Math.floor(totalInnerW * 0.23);
    const w4 = totalInnerW - w1 - w2 - w3;

    const mfd1: ViewportRect = { x: x + padX, y: mfdY, width: w1, height: mfdH };
    const mfd2: ViewportRect = { x: mfd1.x + w1 + gap, y: mfdY, width: w2, height: mfdH };
    const mfd3: ViewportRect = { x: mfd2.x + w2 + gap, y: mfdY, width: w3, height: mfdH };
    const mfd4: ViewportRect = { x: mfd3.x + w3 + gap, y: mfdY, width: w4, height: mfdH };

    this.drawMfd1RwrScope(ctx, sim, mfd1, timeSec);
    this.drawMfd2TfrAndPurge(ctx, sim, mfd2, timeSec);
    this.drawMfd3AdiAndEngineDed(ctx, sim, mfd3);
    this.drawMfd4StoresCmdsAndRadar(ctx, sim, mfd4, timeSec);

    ctx.restore();
  }

  /**
   * LEFT MFD (MFD-1): Authentic Circular F-16 ALR-56M RWR (Radar Warning Receiver) Scope
   * Inner lethal ring, outer search ring, directional emitter symbols (`S`, `A`, flashing `M`) relative to nose!
   */
  private drawMfd1RwrScope(
    ctx: CanvasRenderingContext2D,
    sim: TrenchSimulation,
    r: ViewportRect,
    timeSec: number
  ): void {
    ctx.save();
    ctx.fillStyle = '#020804';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    const alertBorder = sim.samIncomingActive || sim.samLockActive || sim.ceilingBreached;
    ctx.strokeStyle =
      sim.samIncomingActive && Math.sin(timeSec * 16) > 0
        ? COLORS.RED_KLAXON
        : alertBorder
          ? '#FFB000'
          : COLORS.GREEN_DIM;
    ctx.lineWidth = alertBorder ? 1.9 : 1.5;
    ctx.strokeRect(r.x, r.y, r.width, r.height);

    // Crisp MFD Header Bar (+20% readability through CRT bloom)
    ctx.fillStyle = 'rgba(8, 24, 14, 0.88)';
    ctx.fillRect(r.x + 1, r.y + 1, r.width - 2, 20);
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.textAlign = 'left';
    ctx.fillText('MFD-1 // RWR', r.x + 7, r.y + 16);
    ctx.textAlign = 'right';
    ctx.fillStyle = sim.samIncomingActive
      ? COLORS.RED_KLAXON
      : sim.samLockActive || sim.ceilingBreached
        ? '#FFB000'
        : '#44FF77';
    ctx.fillText(
      sim.samIncomingActive
        ? 'MISSILE!'
        : sim.samLockActive
          ? `LOCK ${sim.samLockCountdownSec.toFixed(1)}S`
          : sim.ceilingBreached
            ? 'EXPOSED'
            : 'SEARCH',
      r.x + r.width - 7,
      r.y + 16
    );

    const scopeR = Math.max(30, Math.min((r.height - 30) * 0.47, (r.width - 18) * 0.46));
    const scx = r.x + r.width * 0.5;
    const scy = r.y + 22 + (r.height - 24) * 0.5;

    // Outer search ring & inner lethal ring
    ctx.strokeStyle = 'rgba(68, 255, 119, 0.58)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(scx, scy, scopeR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 176, 0, 0.48)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(scx, scy, scopeR * 0.46, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(68, 255, 119, 0.28)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(scx - scopeR, scy);
    ctx.lineTo(scx + scopeR, scy);
    ctx.moveTo(scx, scy - scopeR);
    ctx.lineTo(scx, scy + scopeR);
    ctx.stroke();

    ctx.strokeStyle = '#8EF5AB';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(scx - 4.5, scy);
    ctx.lineTo(scx + 4.5, scy);
    ctx.moveTo(scx, scy - 5.5);
    ctx.lineTo(scx, scy + 4.5);
    ctx.stroke();

    const contacts = sim.getRwrContacts();
    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    for (const c of contacts) {
      const ex = scx + Math.sin(c.bearingRad) * (c.rangeNorm * scopeR);
      const ey = scy - Math.cos(c.bearingRad) * (c.rangeNorm * scopeR);
      const blinkOn = !c.flashing || Math.sin(timeSec * 16) > -0.25;
      if (!blinkOn && c.symbol === 'M') continue;

      const col =
        c.symbol === 'M'
          ? COLORS.RED_KLAXON
          : c.symbol === 'S'
            ? c.lethal
              ? '#FF3322'
              : '#FF6633'
            : '#FFB000';

      if (c.symbol === 'M' || c.lethal) {
        ctx.strokeStyle = col;
        ctx.lineWidth = c.symbol === 'M' ? 2.0 : 1.4;
        ctx.beginPath();
        ctx.moveTo(ex, ey - 10);
        ctx.lineTo(ex + 10, ey);
        ctx.lineTo(ex, ey + 10);
        ctx.lineTo(ex - 10, ey);
        ctx.closePath();
        ctx.stroke();
      }

      ctx.fillStyle = col;
      ctx.fillText(c.symbol, ex, ey + 4.5);
    }

    ctx.restore();
  }

  /**
   * CENTER-LEFT MFD (MFD-2): Vertically Rescaled Dramatic TFR Side-Profile (1.8KM) + Bridges + Purge Bar!
   */
  private drawMfd2TfrAndPurge(
    ctx: CanvasRenderingContext2D,
    sim: TrenchSimulation,
    r: ViewportRect,
    timeSec: number
  ): void {
    const ceilM = sim.sectorRadarCeilingM;
    ctx.save();
    ctx.fillStyle = '#020804';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = sim.purgeThermalAlert ? '#FFB000' : COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(r.x, r.y, r.width, r.height);

    ctx.fillStyle = 'rgba(8, 24, 14, 0.88)';
    ctx.fillRect(r.x + 1, r.y + 1, r.width - 2, 20);
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.textAlign = 'left';
    ctx.fillText('MFD-2 // TFR SCAN', r.x + 7, r.y + 16);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(`1.8KM / C${ceilM}`, r.x + r.width - 7, r.y + 16);

    const purgeAreaH = 38;
    const plotX = r.x + 8;
    const plotY = r.y + 24;
    const plotW = r.width - 16;
    const plotH = Math.max(46, r.height - 28 - purgeAreaH);

    // Pre-sample 48 terrain points ahead across 1,800m so approaching central mesas & mountain ridges pop!
    const fwdX = Math.sin(sim.yaw);
    const fwdZ = Math.cos(sim.yaw);
    const rightX = Math.cos(sim.yaw);
    const rightZ = -Math.sin(sim.yaw);
    const samples = 48;
    const scanRange = 1800;

    const heights: number[] = new Array(samples + 1);
    let minH = Infinity;
    let maxTerrainH = 0;
    for (let i = 0; i <= samples; i++) {
      const f = i / samples;
      const dist = f * scanRange;
      const cxPt = sim.x + fwdX * dist;
      const czPt = sim.z + fwdZ * dist;
      const hCenter = sim.terrain.sampleHeight(cxPt, czPt);
      const hSideA = sim.terrain.sampleHeight(cxPt + rightX * 32, czPt + rightZ * 32);
      const hSideB = sim.terrain.sampleHeight(cxPt - rightX * 32, czPt - rightZ * 32);
      const h = Math.max(hCenter, (hCenter + Math.max(hSideA, hSideB)) * 0.5);
      heights[i] = h;
      if (h < minH) minH = h;
      if (h > maxTerrainH) maxTerrainH = h;
    }

    // Collect upcoming overhead rock bridges along forward heading to plot right on the TFR scope!
    const zMin = Math.min(sim.z, sim.z + fwdZ * scanRange) - 40;
    const zMax = Math.max(sim.z, sim.z + fwdZ * scanRange) + 40;
    const arches = sim.terrain.getArchesInRange(zMin, zMax);
    const visibleArches: Array<{ f: number; deckY: number; topY: number }> = [];
    for (const arch of arches) {
      const dx = arch.centerX - sim.x;
      const dz = arch.z - sim.z;
      const along = dx * fwdX + dz * fwdZ;
      const across = Math.abs(dx * rightX + dz * rightZ);
      if (along > 10 && along < scanRange && across < arch.halfSpan * 1.15) {
        visibleArches.push({
          f: along / scanRange,
          deckY: arch.deckY,
          topY: arch.deckY + arch.thicknessY,
        });
      }
    }

    // Dynamic vertical rescaling! Keeps hills, mesas, canyon floor rises & bridges crisp & dramatic!
    const floorRef = heights[0];
    const baseElev = Math.max(0, Math.min(minH, sim.y - 25) - 6);
    const archPeak = visibleArches.reduce((acc, a) => Math.max(acc, a.topY), 0);
    const desiredTop = Math.max(
      baseElev + 125,
      maxTerrainH * 1.32,
      sim.y + 42,
      archPeak > 0 ? archPeak + 18 : 0
    );
    const topElev = Math.min(460, desiredTop);
    const elevSpan = Math.max(90, topElev - baseElev);
    const elevToY = (elev: number): number =>
      plotY + plotH - Math.max(-0.15, Math.min(1.15, (elev - baseElev) / elevSpan)) * plotH;

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotW, plotH);
    ctx.clip();

    // Subtle elevation grid lines (every 50m) & distance grid lines (300m, 600m)
    ctx.strokeStyle = 'rgba(27, 94, 52, 0.36)';
    ctx.lineWidth = 1.0;
    const gridStart = Math.ceil(baseElev / 50) * 50;
    for (let elev = gridStart; elev < topElev; elev += 50) {
      const gy = elevToY(elev);
      ctx.beginPath();
      ctx.moveTo(plotX, gy);
      ctx.lineTo(plotX + plotW, gy);
      ctx.stroke();
    }
    for (const frac of [1 / 3, 2 / 3]) {
      const gx = plotX + plotW * frac;
      ctx.beginPath();
      ctx.moveTo(gx, plotY);
      ctx.lineTo(gx, plotY + plotH);
      ctx.stroke();
    }

    // Filled dramatic elevation terrain silhouette
    ctx.beginPath();
    ctx.moveTo(plotX, plotY + plotH);
    for (let i = 0; i <= samples; i++) {
      const px = plotX + (i / samples) * plotW;
      const py = elevToY(heights[i]);
      ctx.lineTo(px, py);
    }
    ctx.lineTo(plotX + plotW, plotY + plotH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(26, 102, 52, 0.44)';
    ctx.fill();
    ctx.strokeStyle = '#44FF77';
    ctx.lineWidth = 2.0;
    ctx.stroke();

    // Plot overhead rock bridges / arches as distinct glowing amber span blocks!
    for (const a of visibleArches) {
      const ax = plotX + a.f * plotW;
      const yTop = elevToY(a.topY);
      const yBot = elevToY(a.deckY);
      const aw = Math.max(8, (36 / scanRange) * plotW);
      ctx.fillStyle = 'rgba(255, 176, 0, 0.34)';
      ctx.fillRect(ax - aw * 0.5, yTop, aw, Math.max(4, yBot - yTop));
      ctx.strokeStyle = '#FFB000';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ax - aw * 0.5, yTop, aw, Math.max(4, yBot - yTop));
    }

    // Dashed Radar Ceiling Reference Line (190M RALT above canyon floor!)
    const ceilLineY = elevToY(floorRef + ceilM);
    if (ceilLineY >= plotY + 2 && ceilLineY <= plotY + plotH - 4) {
      ctx.strokeStyle = sim.ceilingBreached ? COLORS.RED_KLAXON : 'rgba(255, 176, 0, 0.72)';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(plotX, ceilLineY);
      ctx.lineTo(plotX + plotW, ceilLineY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Live Aircraft Altitude Marker & Projected Velocity Glide Slope
    const shipPy = elevToY(sim.y);
    const horizSpd = Math.max(20, Math.hypot(sim.vx, sim.vz));
    const endAlt = sim.y + (sim.vy / horizSpd) * scanRange;
    const endPy = elevToY(endAlt);

    ctx.strokeStyle = sim.pullUpWarning ? COLORS.RED_KLAXON : '#FFB000';
    ctx.lineWidth = 1.7;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(plotX + 9, shipPy);
    ctx.lineTo(plotX + plotW, endPy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#FFF6CC';
    ctx.beginPath();
    ctx.moveTo(plotX + 12, shipPy);
    ctx.lineTo(plotX + 3, shipPy - 5);
    ctx.lineTo(plotX + 3, shipPy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Horizontal Atmospheric Purge Wave Tail Proximity Bar (`PURGE: -420M`)!
    const barTop = plotY + plotH + 6;
    const distM = Math.round(sim.purgeDistanceM);
    const proxNorm = Math.max(0, Math.min(1, 1 - distM / 1200));
    const dangerFlash = distM < 220 && Math.sin(timeSec * 15) > 0;
    const pCol = dangerFlash ? COLORS.RED_KLAXON : distM < 450 ? '#FFB000' : '#44FF77';

    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = pCol;
    ctx.fillText(`PURGE: -${distM}M`, plotX, barTop + 11);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(`WAVE M${sim.purgeMach.toFixed(2)}`, plotX + plotW, barTop + 11);

    const barH = 9;
    const barY = Math.min(r.y + r.height - barH - 6, barTop + 16);
    ctx.fillStyle = 'rgba(12, 26, 16, 0.92)';
    ctx.fillRect(plotX, barY, plotW, barH);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.1;
    ctx.strokeRect(plotX, barY, plotW, barH);
    ctx.fillStyle = pCol;
    ctx.fillRect(plotX + 1, barY + 1, Math.max(2, (plotW - 2) * proxNorm), barH - 2);

    ctx.restore();
  }

  /**
   * CENTER-RIGHT MFD (MFD-3): Attitude & Engine DED (Artificial Horizon Ball, RPM/Nozzle/AB Bar, Hull Integrity!)
   */
  private drawMfd3AdiAndEngineDed(
    ctx: CanvasRenderingContext2D,
    sim: TrenchSimulation,
    r: ViewportRect
  ): void {
    ctx.save();
    ctx.fillStyle = '#020804';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = sim.hull <= 35 ? COLORS.RED_KLAXON : COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(r.x, r.y, r.width, r.height);

    ctx.fillStyle = 'rgba(8, 24, 14, 0.88)';
    ctx.fillRect(r.x + 1, r.y + 1, r.width - 2, 20);
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.textAlign = 'left';
    ctx.fillText('MFD-3 // ADI & DED', r.x + 7, r.y + 16);
    ctx.textAlign = 'right';
    ctx.fillStyle = sim.afterburning ? '#FFB000' : '#44FF77';
    const thrPct = Math.round(sim.throttle * 100);
    ctx.fillText(sim.afterburning ? `AB ${thrPct}%` : `RPM ${thrPct}%`, r.x + r.width - 7, r.y + 16);

    const ballR = Math.max(26, Math.min((r.height - 26) * 0.38, r.width * 0.19));
    const bcx = r.x + r.width * 0.48;
    const bcy = r.y + 24 + (r.height - 28) * 0.5;

    ctx.save();
    ctx.beginPath();
    ctx.arc(bcx, bcy, ballR, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(bcx, bcy);
    ctx.rotate(-sim.roll);
    const pitchOff = (sim.pitch / (Math.PI * 0.4)) * ballR;

    ctx.fillStyle = 'rgba(18, 68, 36, 0.38)';
    ctx.fillRect(-ballR * 1.6, -ballR * 2.2, ballR * 3.2, ballR * 2.2 + pitchOff);
    ctx.fillStyle = 'rgba(34, 18, 6, 0.65)';
    ctx.fillRect(-ballR * 1.6, pitchOff, ballR * 3.2, ballR * 2.2);

    ctx.strokeStyle = '#44FF77';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(-ballR * 1.4, pitchOff);
    ctx.lineTo(ballR * 1.4, pitchOff);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(142, 245, 171, 0.65)';
    ctx.lineWidth = 1.1;
    for (const off of [-ballR * 0.38, ballR * 0.38]) {
      ctx.beginPath();
      ctx.moveTo(-ballR * 0.34, pitchOff + off);
      ctx.lineTo(ballR * 0.34, pitchOff + off);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = '#44FF77';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(bcx, bcy, ballR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#FFB000';
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(bcx - 14, bcy);
    ctx.lineTo(bcx - 4, bcy);
    ctx.lineTo(bcx - 4, bcy + 4);
    ctx.moveTo(bcx + 14, bcy);
    ctx.lineTo(bcx + 4, bcy);
    ctx.lineTo(bcx + 4, bcy + 4);
    ctx.stroke();

    const thX = r.x + 10;
    const thY = r.y + 28;
    const thW = Math.max(15, Math.min(22, Math.round(r.width * 0.078)));
    const thH = r.height - 38;

    ctx.fillStyle = 'rgba(10, 26, 16, 0.9)';
    ctx.fillRect(thX, thY, thW, thH);
    ctx.strokeStyle = sim.afterburning ? '#FFB000' : COLORS.GREEN_MID;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(thX, thY, thW, thH);

    const milFrac = 1.0 / TRENCH_CONSTANTS.MAX_THROTTLE;
    const milY = thY + thH * (1 - milFrac);
    const fillFrac = Math.max(0, Math.min(1, sim.throttle / TRENCH_CONSTANTS.MAX_THROTTLE));
    const fillH = Math.max(2, thH * fillFrac);
    const milPixels = thH * milFrac;
    const greenH = Math.min(fillH, milPixels);

    ctx.fillStyle = '#44FF77';
    ctx.fillRect(thX + 2, thY + thH - greenH, thW - 4, greenH);
    if (fillH > milPixels) {
      ctx.fillStyle = '#FFB000';
      ctx.fillRect(thX + 2, thY + thH - fillH, thW - 4, fillH - milPixels);
    }

    ctx.strokeStyle = '#FFF6CC';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(thX - 2, milY);
    ctx.lineTo(thX + thW + 2, milY);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = sim.afterburning ? '#FFB000' : '#8EF5AB';
    ctx.fillText(sim.afterburning ? 'AB' : 'NOZ', thX + thW + 5, milY + 4);
    ctx.fillStyle = '#44FF77';
    ctx.fillText(`M${sim.mach.toFixed(1)}`, thX + thW + 5, thY + thH - 4);

    const infoX = r.x + r.width - 8;
    const hullPct = Math.round((sim.hull / TRENCH_CONSTANTS.HULL_MAX) * 100);
    const hullCol = hullPct <= 35 ? COLORS.RED_KLAXON : hullPct <= 65 ? '#FFB000' : '#44FF77';
    ctx.textAlign = 'right';
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = hullCol;
    ctx.fillText(`HULL ${hullPct}%`, infoX, thY + 13);

    const hBarW = Math.min(68, Math.round(r.width * 0.25));
    ctx.fillStyle = 'rgba(12, 28, 18, 0.9)';
    ctx.fillRect(infoX - hBarW, thY + 20, hBarW, 10);
    ctx.fillStyle = hullCol;
    ctx.fillRect(infoX - hBarW + 1, thY + 21, Math.max(0, (hBarW - 2) * (hullPct / 100)), 8);

    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(sim.sectorId, infoX, thY + 50);

    // De-duplicated DED telemetry: NOE Score Multiplier & SAM Radar Ceiling Margin!
    ctx.fillStyle = sim.noeActive
      ? '#44FF77'
      : sim.noeMultiplier > 1.05
        ? '#FFB000'
        : 'rgba(142, 245, 171, 0.72)';
    ctx.fillText(`NOE ${sim.noeMultiplier.toFixed(1)}X`, infoX, thY + 70);

    const ceilMargin = Math.round(sim.sectorRadarCeilingM - sim.raltM);
    ctx.fillStyle =
      ceilMargin < 0 ? COLORS.RED_KLAXON : ceilMargin < 30 ? '#FFB000' : '#8EF5AB';
    ctx.fillText(
      ceilMargin < 0 ? `CEIL +${Math.abs(ceilMargin)}M` : `CEIL -${ceilMargin}M`,
      infoX,
      thY + 90
    );

    ctx.restore();
  }

  /**
   * RIGHT MFD (MFD-4): Tactical Stores (6x Wing-Pylon Missiles + 8x CMDS Pips) & Top-Down Canyon Radar!
   */
  private drawMfd4StoresCmdsAndRadar(
    ctx: CanvasRenderingContext2D,
    sim: TrenchSimulation,
    r: ViewportRect,
    timeSec: number
  ): void {
    ctx.save();
    ctx.fillStyle = '#020804';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = sim.lockState === 'LOCKED' ? '#FFB000' : COLORS.GREEN_DIM;
    ctx.lineWidth = sim.lockState === 'LOCKED' ? 1.8 : 1.6;
    ctx.strokeRect(r.x, r.y, r.width, r.height);

    ctx.fillStyle = 'rgba(8, 24, 14, 0.88)';
    ctx.fillRect(r.x + 1, r.y + 1, r.width - 2, 20);
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.textAlign = 'left';
    ctx.fillText('MFD-4 // SMS & RADAR', r.x + 7, r.y + 16);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(
      `MSL ${sim.missilesRemaining}/6 · CMDS ${sim.cmdsRemaining}/8`,
      r.x + r.width - 7,
      r.y + 16
    );

    const innerY = r.y + 24;
    const innerH = r.height - 30;
    const splitX = Math.round(r.x + r.width * 0.54);

    ctx.strokeStyle = 'rgba(42, 130, 68, 0.35)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(splitX, innerY);
    ctx.lineTo(splitX, innerY + innerH);
    ctx.stroke();

    // --- LEFT HALF: 6x Individual Wing-Pylon Missile Silhouettes + 8x CMDS Charge Pips! ---
    const smsW = splitX - r.x - 10;
    const scx = r.x + 5 + smsW * 0.5;
    const wingY = innerY + Math.round(innerH * 0.34);
    const wingSpan = Math.min(smsW * 0.46, 98);

    ctx.strokeStyle = 'rgba(68, 255, 119, 0.44)';
    ctx.fillStyle = 'rgba(14, 48, 26, 0.24)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(scx, wingY - 17);
    ctx.lineTo(scx + 7, wingY - 4);
    ctx.lineTo(scx + wingSpan, wingY + 10);
    ctx.lineTo(scx + wingSpan, wingY + 15);
    ctx.lineTo(scx + 9, wingY + 13);
    ctx.lineTo(scx + 5, wingY + 21);
    ctx.lineTo(scx - 5, wingY + 21);
    ctx.lineTo(scx - 9, wingY + 13);
    ctx.lineTo(scx - wingSpan, wingY + 15);
    ctx.lineTo(scx - wingSpan, wingY + 10);
    ctx.lineTo(scx - 7, wingY - 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const pylonXs = [
      -wingSpan * 0.88,
      -wingSpan * 0.58,
      -wingSpan * 0.29,
      wingSpan * 0.29,
      wingSpan * 0.58,
      wingSpan * 0.88,
    ];
    const pylonYs = [12, 9, 6, 6, 9, 12];
    const mLen = Math.max(18, Math.min(26, innerH * 0.24));
    const lockPulse = sim.lockState === 'LOCKED' && Math.sin(timeSec * 14) > 0;

    for (let idx = 0; idx < 6; idx++) {
      const loaded = sim.missileSlots[idx];
      const mx = scx + pylonXs[idx];
      const my = wingY + pylonYs[idx];
      const topY = my - mLen * 0.35;
      const botY = my + mLen * 0.72;
      const col = loaded
        ? lockPulse
          ? '#FFF6CC'
          : idx === 0 || idx === 5
            ? '#FFB000'
            : '#44FF77'
        : 'rgba(68, 115, 80, 0.3)';

      ctx.strokeStyle = col;
      ctx.fillStyle = loaded ? 'rgba(68, 255, 119, 0.2)' : 'transparent';
      ctx.lineWidth = loaded ? 1.65 : 1.0;

      ctx.beginPath();
      ctx.moveTo(mx, topY);
      ctx.lineTo(mx + 2.4, topY + 5);
      ctx.lineTo(mx + 2.4, botY);
      ctx.lineTo(mx - 2.4, botY);
      ctx.lineTo(mx - 2.4, topY + 5);
      ctx.closePath();
      if (loaded) ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(mx - 4.4, topY + 7.5);
      ctx.lineTo(mx + 4.4, topY + 7.5);
      ctx.moveTo(mx - 5.2, botY - 1.5);
      ctx.lineTo(mx + 5.2, botY - 1.5);
      ctx.stroke();

      if (!loaded) {
        ctx.strokeStyle = 'rgba(255, 76, 48, 0.82)';
        ctx.lineWidth = 1.45;
        ctx.beginPath();
        ctx.moveTo(mx - 6, topY + 1);
        ctx.lineTo(mx + 6, botY + 1);
        ctx.moveTo(mx + 6, topY + 1);
        ctx.lineTo(mx - 6, botY + 1);
        ctx.stroke();
      }
    }

    // 8x Live CMDS Chaff / Flare Charge Pips along bottom of SMS half!
    const cmdsY = innerY + innerH - 30;
    const cmdsX0 = r.x + 8;
    const cmdsAvailW = smsW - 6;
    ctx.font = 'bold 11.8px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = sim.cmdsRemaining > 0 ? '#44FFDD' : COLORS.RED_KLAXON;
    ctx.fillText('CMDS [C/F]', cmdsX0, cmdsY);
    ctx.textAlign = 'right';
    ctx.fillStyle = sim.gunAmmo <= 80 ? '#FFB000' : '#8EF5AB';
    ctx.fillText(`20MM:${sim.gunAmmo}`, cmdsX0 + cmdsAvailW, cmdsY);

    const pipGap = 3;
    const pipW = Math.max(8, Math.floor((cmdsAvailW - pipGap * 7) / 8));
    for (let k = 0; k < TRENCH_CONSTANTS.CMDS_MAX_COUNT; k++) {
      const px = cmdsX0 + k * (pipW + pipGap);
      const charged = k < sim.cmdsRemaining;
      ctx.fillStyle = charged
        ? sim.cmdsCooldown > 0
          ? 'rgba(255, 176, 0, 0.55)'
          : '#FFB000'
        : 'rgba(18, 36, 24, 0.85)';
      ctx.fillRect(px, cmdsY + 5, pipW, 11);
      ctx.strokeStyle = charged ? '#FFF6CC' : 'rgba(68, 120, 82, 0.35)';
      ctx.lineWidth = 1.1;
      ctx.strokeRect(px, cmdsY + 5, pipW, 11);
    }

    // --- RIGHT HALF: Live Heading-Up Top-Down Open-Valley Radar (3-Class Symbology!) ---
    const plotX = splitX + 6;
    const plotY = innerY;
    const plotW = r.x + r.width - splitX - 12;
    const plotH = innerH;
    const mapCx = plotX + plotW * 0.5;
    const mapCy = plotY + plotH * 0.82;
    const scale = Math.min(plotW / 1850, plotH / 3200);

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotW, plotH);
    ctx.clip();

    ctx.strokeStyle = 'rgba(27, 94, 52, 0.38)';
    ctx.lineWidth = 1.0;
    for (const rng of [1000, 2200]) {
      ctx.beginPath();
      ctx.arc(mapCx, mapCy, rng * scale, Math.PI, Math.PI * 2);
      ctx.stroke();
    }

    const cosY = Math.cos(sim.yaw);
    const sinY = Math.sin(sim.yaw);
    const toRadar = (wx: number, wz: number): { x: number; y: number } => {
      const dx = wx - sim.x;
      const dz = wz - sim.z;
      const rx = dx * cosY - dz * sinY;
      const rz = dx * sinY + dz * cosY;
      return {
        x: mapCx + rx * scale,
        y: mapCy - rz * scale,
      };
    };

    const zStart = Math.floor((sim.z - 500) / 110) * 110;
    const zEnd = sim.z + 3200;
    for (const side of [-1, 1]) {
      ctx.strokeStyle = '#3BE068';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      let started = false;
      for (let z = zStart; z <= zEnd; z += 110) {
        const cxWall = sim.terrain.getCanyonCenterX(z) + side * sim.terrain.getCanyonHalfWidth(z);
        const pt = toRadar(cxWall, z);
        if (!started) {
          ctx.moveTo(pt.x, pt.y);
          started = true;
        } else {
          ctx.lineTo(pt.x, pt.y);
        }
      }
      ctx.stroke();
    }

    const blipPulse = 0.68 + 0.32 * Math.sin(timeSec * 12);
    for (const t of sim.targets) {
      if (t.destroyed) continue;
      const pt = toRadar(t.x, t.z);
      if (
        pt.x < plotX - 5 ||
        pt.x > plotX + plotW + 5 ||
        pt.y < plotY - 5 ||
        pt.y > plotY + plotH + 5
      ) {
        continue;
      }
      const isLocked = sim.lockedTargetId === t.id;
      if (t.kind === 'RESUPPLY_CACHE') {
        // Electric Cyan Hexagon blip
        ctx.fillStyle = '#00F0FF';
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          const hx = pt.x + Math.cos(a) * 3.8;
          const hy = pt.y + Math.sin(a) * 3.8;
          if (k === 0) ctx.moveTo(hx, hy);
          else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.fill();
      } else if (t.kind === 'SAM_SITE') {
        // Red-Amber Diamond blip
        ctx.fillStyle = isLocked ? '#FFF6CC' : `rgba(255, 51, 34, ${blipPulse.toFixed(2)})`;
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y - 3.6);
        ctx.lineTo(pt.x + 3.6, pt.y);
        ctx.lineTo(pt.x, pt.y + 3.6);
        ctx.lineTo(pt.x - 3.6, pt.y);
        ctx.closePath();
        ctx.fill();
      } else {
        // Bright Amber Caret (`^`) blip for Bandit Drone
        ctx.strokeStyle = isLocked ? '#FFF6CC' : '#FFB000';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(pt.x - 3.6, pt.y + 2.5);
        ctx.lineTo(pt.x, pt.y - 3.4);
        ctx.lineTo(pt.x + 3.6, pt.y + 2.5);
        ctx.stroke();
      }

      if (isLocked) {
        ctx.strokeStyle = sim.lockState === 'LOCKED' ? COLORS.RED_KLAXON : '#FFB000';
        ctx.lineWidth = 1.3;
        ctx.strokeRect(pt.x - 5.5, pt.y - 5.5, 11, 11);
      }
    }

    for (const m of sim.missiles) {
      const pt = toRadar(m.x, m.z);
      ctx.fillStyle = '#FFF6CC';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of sim.enemySams) {
      const pt = toRadar(s.x, s.z);
      ctx.fillStyle = COLORS.RED_KLAXON;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = '#FFF6CC';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(mapCx, mapCy - 6);
    ctx.lineTo(mapCx - 4.5, mapCy + 4.5);
    ctx.lineTo(mapCx, mapCy + 1.5);
    ctx.lineTo(mapCx + 4.5, mapCy + 4.5);
    ctx.closePath();
    ctx.stroke();

    ctx.restore();
    ctx.restore();
  }

  /**
   * Crisp Pointer-Lock Pause Overlay shown when pressing ESC releases Pointer Lock!
   * Clicking RESUME immediately re-engages Pointer Lock on the canopy.
   */
  private drawPausedOverlay(
    ctx: CanvasRenderingContext2D,
    params: TrenchHudRenderParams,
    vp: ViewportRect
  ): void {
    const cx = vp.x + vp.width * 0.5;
    const cy = vp.y + vp.height * 0.5;
    const boxW = Math.min(480, vp.width - 40);
    const boxH = 205;
    const bx = Math.round(cx - boxW * 0.5);
    const by = Math.round(cy - boxH * 0.5);

    ctx.save();
    ctx.fillStyle = 'rgba(2, 7, 4, 0.72)';
    ctx.fillRect(vp.x, vp.y, vp.width, vp.height);

    ctx.fillStyle = 'rgba(4, 13, 8, 0.96)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 16, '#FFB000', 2.4);

    ctx.textAlign = 'center';
    ctx.font = 'bold 23px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('FLIGHT PAUSED // STICK RELEASED', cx, by + 44);

    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText('CLICK RESUME TO RE-ENGAGE POINTER LOCK FLIGHT STICK', cx, by + 72);

    this.addButton(
      ctx,
      'trench-resume-lock',
      { x: bx + 32, y: by + 92, width: boxW - 64, height: 42 },
      '► RESUME FLIGHT (LOCK STICK) ◄',
      true,
      params.hoveredButtonId,
      '#44FF77',
      15.5
    );

    const halfW = Math.floor((boxW - 76) * 0.5);
    this.addButton(
      ctx,
      'trench-osd',
      { x: bx + 32, y: by + 146, width: halfW, height: 36 },
      'SYSTEM MENU [M]',
      false,
      params.hoveredButtonId,
      '#FFB000',
      13.5
    );
    this.addButton(
      ctx,
      'trench-exit-os',
      { x: bx + 44 + halfW, y: by + 146, width: halfW, height: 36 },
      'EXIT TO MU-TH-UR OS',
      false,
      params.hoveredButtonId,
      '#8EF5AB',
      13.5
    );

    ctx.restore();
  }

  // ===========================================================================
  // LAUNCH TITLE OVERLAY (inside upper canopy!)
  // ===========================================================================
  private drawTitleOverlay(
    ctx: CanvasRenderingContext2D,
    params: TrenchHudRenderParams,
    vp: ViewportRect
  ): void {
    const cx = vp.x + vp.width * 0.5;
    const cy = vp.y + vp.height * 0.5;
    const boxW = Math.min(740, vp.width - 40);
    const boxH = Math.min(436, vp.height - 20);
    const bx = Math.round(cx - boxW * 0.5);
    const by = Math.round(cy - boxH * 0.5);

    ctx.save();
    ctx.fillStyle = 'rgba(2, 9, 5, 0.88)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, '#FFB000', 2.8);

    drawRankedTitleRibbon(
      ctx,
      bx + 26,
      by + 10,
      boxW - 52,
      24,
      '★ OFFICIAL RANKED SORTIE — HIGH SCORE RECORDED TO TRENCH_SCORES ★',
      params.timeSec,
      true
    );

    ctx.textAlign = 'center';
    ctx.font = 'bold 26px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.RED_KLAXON;
    ctx.fillText('DERELICT TRENCH // OPEN-VALLEY STRIKE SIM', cx, by + 64);

    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('VECTOR JET FLCS STICK · M61A1 20MM VULCAN · 0.35S AIM-9 LOCKS', cx, by + 86);

    // Live #01 Global Leader Strip
    const top = params.leaderboard.getTopLeader();
    const st = params.leaderboard.getStatus();
    ctx.fillStyle = 'rgba(22, 16, 4, 0.84)';
    ctx.fillRect(bx + 26, by + 98, boxW - 52, 32);
    ctx.strokeStyle = '#FFB000';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(bx + 26, by + 98, boxW - 52, 32);
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFF6CC';
    ctx.fillText(
      top
        ? `★ #01 LEADER: ${top.callsign} // ${top.score.toLocaleString()} PTS (${top.distance.toLocaleString()}M · M${top.maxMach.toFixed(1)})`
        : st === 'LOADING'
          ? 'SYNCING GLOBAL TRENCH_SCORES TELEMETRY...'
          : 'RECORD UNCLAIMED — FIRST FLIGHT OPEN!',
      cx,
      by + 118,
      boxW - 70
    );

    const pitchTxt = params.sim.invertPitch
      ? 'INVERTED (UP = ↑)'
      : 'FLIGHT-SIM (PULL DOWN = ↑)';
    const lines = [
      `• [FLIGHT STICK]   MOUSE OR ARROWS ROLL/PITCH (${pitchTxt}) · CLICK LOCK · ESC PAUSE`,
      '• [W / S] & [A / D] THROTTLE (0–120% AB · STALL <180 KCAS) & RUDDER YAW',
      '• [WEAPONS]         [LMB] 20MM VULCAN · [RMB / SPACE] 0.35S AIM-9 (TAB CYCLE)',
      '• [CEIL & PURGE]    STAY BELOW CEIL 190M (AVOID SAMS) & OUTRUN THE PURGE WAVE (MFD-2)!',
      '• [NOE & MASKING]   FLY FAST <60M FOR 2.5X NOE BONUS · DUCK BEHIND MESAS / 7G BREAK / [C/F] CMDS',
      '• [CYAN RESUPPLY]   SHOOT OR FLY THROUGH CYAN ⬡ PODS FOR +2 MSL, +150 GUN & +2 CMDS!',
    ];
    ctx.textAlign = 'left';
    ctx.font = 'bold 11.8px "JetBrains Mono", monospace';
    const lineStep = boxH < 410 ? 19 : 22;
    let ly = by + 148;
    for (const ln of lines) {
      ctx.fillStyle = ln.includes('CYAN')
        ? '#00F0FF'
        : ln.includes('CEIL') || ln.includes('[WEAPONS]')
          ? '#FFB000'
          : '#8EF5AB';
      ctx.fillText(ln, bx + 26, ly, boxW - 52);
      ly += lineStep;
    }

    const startW = Math.min(370, boxW - 80);
    this.addButton(
      ctx,
      'trench-start',
      { x: Math.round(cx - startW * 0.5), y: by + boxH - 102, width: startW, height: 44 },
      '► LAUNCH RANKED SORTIE [ENTER] ◄',
      true,
      params.hoveredButtonId,
      '#FFB000',
      16.5
    );

    const halfW = Math.floor((boxW - 72) * 0.5);
    const subY = by + boxH - 48;
    this.addButton(
      ctx,
      'trench-toggle-invert',
      { x: bx + 28, y: subY, width: halfW, height: 34 },
      params.sim.invertPitch ? 'PITCH: INVERTED [I]' : 'PITCH: FLIGHT-SIM [I]',
      params.sim.invertPitch,
      params.hoveredButtonId,
      '#FFB000',
      13.5
    );
    this.addButton(
      ctx,
      'trench-manifest',
      { x: bx + 44 + halfW, y: subY, width: halfW, height: 34 },
      'GLOBAL FLIGHT MANIFEST',
      false,
      params.hoveredButtonId,
      '#8EF5AB',
      13.5
    );

    ctx.restore();
  }

  // ===========================================================================
  // GAME OVER OVERLAY WITH STRICT 1.2S INPUT LOCKOUT INDICATOR!
  // ===========================================================================
  private drawGameOverOverlay(ctx: CanvasRenderingContext2D, params: TrenchHudRenderParams): void {
    const { width: w, height: h, sim, timeSec } = params;
    const boxW = Math.min(620, w - 40);
    const boxH = 415;
    const bx = Math.round((w - boxW) * 0.5);
    const by = Math.round((h - boxH) * 0.5);
    const lockedOut = sim.gameOverLockoutTimer > 0;

    ctx.save();
    ctx.fillStyle = 'rgba(1, 5, 3, 0.82)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(14, 5, 4, 0.96)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.RED_KLAXON, 2.5);

    ctx.textAlign = 'center';
    ctx.font = 'bold 27px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.RED_KLAXON;
    ctx.fillText(`AIRFRAME LOST // ${sim.lastDeathCause}`, bx + boxW * 0.5, by + 46);

    const statY = by + 76;
    const stats = [
      { lbl: 'FINAL SCORE', val: sim.score.toLocaleString(), col: '#FFF6CC' },
      { lbl: 'DISTANCE', val: `${Math.round(sim.distanceFlownM).toLocaleString()}M`, col: '#44FF77' },
      { lbl: 'MAX MACH', val: `M ${sim.maxMach.toFixed(1)}`, col: '#FFB000' },
      { lbl: 'TARGETS', val: String(sim.targetsDestroyed), col: '#8EF5AB' },
    ];
    const colW = (boxW - 48) / 4;
    stats.forEach((st, idx) => {
      const sx = bx + 24 + idx * colW;
      ctx.fillStyle = 'rgba(6, 18, 10, 0.86)';
      ctx.fillRect(sx + 4, statY, colW - 8, 66);
      ctx.strokeStyle = 'rgba(68, 255, 119, 0.45)';
      ctx.lineWidth = 1.3;
      ctx.strokeRect(sx + 4, statY, colW - 8, 66);
      ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
      ctx.fillStyle = '#8EF5AB';
      ctx.fillText(st.lbl, sx + colW * 0.5, statY + 22);
      ctx.font = 'bold 20px "JetBrains Mono", monospace';
      ctx.fillStyle = st.col;
      ctx.fillText(st.val, sx + colW * 0.5, statY + 50);
    });

    const inputY = by + 170;
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = lockedOut
      ? '#FFB000'
      : params.callsignEditing
        ? '#44FF77'
        : '#8EF5AB';
    ctx.fillText(
      lockedOut
        ? `KEYLOCK ACTIVE (${sim.gameOverLockoutTimer.toFixed(1)}S) — RELEASE FLIGHT CONTROLS...`
        : params.callsignEditing
          ? 'TYPE NEW CALLSIGN · [ENTER] SUBMIT · [ESC] DONE EDITING:'
          : 'CLICK CALLSIGN (OR [C]) TO EDIT · [ENTER] SUBMIT · [SPACE/R] FLY AGAIN:',
      bx + boxW * 0.5,
      inputY,
      boxW - 44
    );

    const fieldW = Math.min(390, boxW - 80);
    const fieldX = Math.round(bx + (boxW - fieldW) * 0.5);
    const fieldY = inputY + 12;
    ctx.fillStyle = params.callsignEditing ? 'rgba(8, 28, 14, 0.98)' : 'rgba(3, 14, 8, 0.96)';
    ctx.fillRect(fieldX, fieldY, fieldW, 42);
    ctx.strokeStyle = lockedOut
      ? 'rgba(255, 176, 0, 0.45)'
      : params.scoreSubmitted
        ? '#44FF77'
        : params.callsignEditing
          ? '#44FF77'
          : '#FFB000';
    ctx.lineWidth = params.callsignEditing ? 2.6 : 2.0;
    ctx.strokeRect(fieldX, fieldY, fieldW, 42);

    if (!lockedOut) {
      this.buttons.push({
        id: 'trench-callsign-field',
        rect: { x: fieldX, y: fieldY, width: fieldW, height: 42 },
        label: 'CALLSIGN',
      });
    }

    const blink =
      !lockedOut && !params.scoreSubmitted && params.callsignEditing && Math.sin(timeSec * 9) > 0
        ? '█'
        : '';
    ctx.font = 'bold 20px "JetBrains Mono", monospace';
    ctx.fillStyle = lockedOut ? 'rgba(255, 246, 204, 0.5)' : '#FFF6CC';
    ctx.fillText(`CALLSIGN: ${params.callsignDraft}${blink}`, bx + boxW * 0.5, fieldY + 28);

    if (params.submitResultBanner) {
      ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#8EF5AB';
      ctx.fillText(params.submitResultBanner, bx + boxW * 0.5, fieldY + 62);
    }

    const btnY = by + boxH - 116;
    const halfBtnW = Math.floor((boxW - 60) * 0.5);
    this.addButton(
      ctx,
      lockedOut ? 'trench-locked' : 'trench-submit-score',
      { x: bx + 24, y: btnY, width: halfBtnW, height: 42 },
      lockedOut
        ? `WAIT ${sim.gameOverLockoutTimer.toFixed(1)}S...`
        : params.scoreSubmitted
          ? '✓ RECORD TRANSMITTED'
          : params.submittingScore
            ? 'TRANSMITTING...'
            : 'TRANSMIT SCORE [ENTER]',
      !lockedOut && !params.scoreSubmitted,
      params.hoveredButtonId,
      '#FFB000',
      15
    );
    this.addButton(
      ctx,
      lockedOut ? 'trench-locked-retry' : 'trench-retry',
      { x: bx + 36 + halfBtnW, y: btnY, width: halfBtnW, height: 42 },
      'RELAUNCH [SPACE / R]',
      false,
      params.hoveredButtonId,
      '#44FF77',
      15
    );

    const botY = by + boxH - 60;
    this.addButton(
      ctx,
      'trench-manifest',
      { x: bx + 24, y: botY, width: halfBtnW, height: 38 },
      'OPEN GLOBAL MANIFEST',
      false,
      params.hoveredButtonId,
      '#8EF5AB',
      14
    );
    this.addButton(
      ctx,
      'trench-exit-os',
      { x: bx + 36 + halfBtnW, y: botY, width: halfBtnW, height: 38 },
      'EXIT TO MU-TH-UR OS',
      false,
      params.hoveredButtonId,
      '#FFB000',
      14
    );

    ctx.restore();
  }

  // ===========================================================================
  // STANDARDIZED [TAB] SYSTEM & COMMAND MENU (Unified Across Programs 1–4)
  // ===========================================================================
  private drawOsdMenuModal(ctx: CanvasRenderingContext2D, params: TrenchHudRenderParams): void {
    const { width: w, height: h, sim } = params;
    const boxW = Math.min(700, w - 48);
    const boxH = Math.min(416, h - 48);
    const bx = Math.round((w - boxW) * 0.5);
    const by = Math.round((h - boxH) * 0.5);

    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 4, 0.78)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(4, 12, 7, 0.97)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 16, '#FFB000', 2.4);

    ctx.textAlign = 'left';
    ctx.font = 'bold 20px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('MU-TH-UR 6000 // SYSTEM & COMMAND MENU [M]', bx + 24, by + 38);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(bx + 24, by + 50);
    ctx.lineTo(bx + boxW - 24, by + 50);
    ctx.stroke();

    const topBtnY = by + 64;
    const topBtnW = Math.floor((boxW - 68) / 3);
    this.addButton(
      ctx,
      'trench-osd-close',
      { x: bx + 24, y: topBtnY, width: topBtnW, height: 38 },
      '► RESUME FLIGHT',
      true,
      params.hoveredButtonId,
      '#44FF77',
      14.5
    );
    this.addButton(
      ctx,
      'trench-retry',
      { x: bx + 34 + topBtnW, y: topBtnY, width: topBtnW, height: 38 },
      'RESTART SORTIE',
      false,
      params.hoveredButtonId,
      '#FFB000',
      14.5
    );
    this.addButton(
      ctx,
      'trench-manifest',
      { x: bx + 44 + topBtnW * 2, y: topBtnY, width: topBtnW, height: 38 },
      'GLOBAL MANIFEST',
      false,
      params.hoveredButtonId,
      '#8EF5AB',
      14.5
    );

    const rows: Array<{ id: string; label: string; value: string; accent: string }> = [
      {
        id: 'trench-pause',
        label: 'FLIGHT SIMULATION PAUSE [P]',
        value: sim.paused ? 'PAUSED' : 'RUNNING',
        accent: sim.paused ? '#FFB000' : '#44FF77',
      },
      {
        id: 'trench-toggle-invert',
        label: 'MOUSE STICK PITCH AXIS [I]',
        value: sim.invertPitch ? 'INVERTED (UP=↑)' : 'FLIGHT-SIM (DOWN=↑)',
        accent: sim.invertPitch ? '#FFB000' : '#8EF5AB',
      },
      {
        id: 'trench-mute',
        label: 'INTERCOM & FLIGHT AUDIO BUS',
        value: params.audioMuted ? 'MUTED' : 'ACTIVE',
        accent: params.audioMuted ? COLORS.RED_KLAXON : '#44FF77',
      },
      {
        id: 'trench-fullscreen',
        label: 'FULLSCREEN DISPLAY MODE',
        value: params.isFullscreen ? 'ENABLED' : 'WINDOWED',
        accent: params.isFullscreen ? '#FFB000' : '#44FF77',
      },
    ];

    let ry = topBtnY + 52;
    const rowH = 42;
    for (const r of rows) {
      const rect: ViewportRect = { x: bx + 24, y: ry, width: boxW - 48, height: rowH };
      this.buttons.push({ id: r.id, rect, label: r.label });
      const hov = params.hoveredButtonId === r.id;

      ctx.fillStyle = hov ? 'rgba(68, 255, 119, 0.16)' : 'rgba(6, 20, 11, 0.88)';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = hov ? '#FFFFFF' : 'rgba(59, 224, 104, 0.45)';
      ctx.lineWidth = hov ? 2.0 : 1.3;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

      ctx.textAlign = 'left';
      ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
      ctx.fillStyle = hov ? '#FFFFFF' : '#8EF5AB';
      ctx.fillText(r.label, rect.x + 14, rect.y + 26);

      ctx.textAlign = 'right';
      ctx.font = 'bold 14.5px "JetBrains Mono", monospace';
      ctx.fillStyle = r.accent;
      ctx.fillText(`[ ${r.value} ]`, rect.x + rect.width - 14, rect.y + 26);
      ry += rowH + 8;
    }

    const footY = by + boxH - 54;
    const halfFootW = Math.floor((boxW - 60) * 0.5);
    this.addButton(
      ctx,
      'trench-osd-close',
      { x: bx + 24, y: footY, width: halfFootW, height: 38 },
      '[M / ESC] CLOSE MENU',
      false,
      params.hoveredButtonId,
      '#44FF77',
      14
    );
    this.addButton(
      ctx,
      'trench-exit-os',
      { x: bx + 36 + halfFootW, y: footY, width: halfFootW, height: 38 },
      '[EXIT TO MU-TH-UR OS]',
      false,
      params.hoveredButtonId,
      '#FFB000',
      14
    );

    ctx.restore();
  }

  // ===========================================================================
  // GLOBAL TRENCH_SCORES MANIFEST MODAL WITH `★ JUST ADDED` HIGHLIGHT
  // ===========================================================================
  private drawManifestModal(ctx: CanvasRenderingContext2D, params: TrenchHudRenderParams): void {
    const { width: w, height: h, leaderboard, lastSubmittedRun, timeSec } = params;
    const boxW = Math.min(780, w - 40);
    const boxH = Math.min(580, h - 44);
    const bx = Math.round((w - boxW) * 0.5);
    const by = Math.round((h - boxH) * 0.5);

    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 4, 0.82)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(4, 12, 7, 0.97)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, '#44FF77', 2.4);

    ctx.textAlign = 'left';
    ctx.font = 'bold 21px "Share Tech Mono", monospace';
    ctx.fillStyle = '#44FF77';
    ctx.fillText('DERELICT TRENCH // GLOBAL FLIGHT MANIFEST', bx + 24, by + 38);

    const st = leaderboard.getStatus();
    ctx.textAlign = 'right';
    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    ctx.fillStyle = st === 'LIVE' ? '#44FF77' : st === 'LOADING' ? '#FFB000' : COLORS.RED_KLAXON;
    ctx.fillText(
      st === 'LIVE' ? '● FIRESTORE UPLINK LIVE' : st === 'LOADING' ? '◌ SYNCING...' : '○ LOCAL ARCHIVE',
      bx + boxW - 24,
      by + 36
    );

    const headY = by + 72;
    ctx.fillStyle = 'rgba(18, 52, 28, 0.72)';
    ctx.fillRect(bx + 20, headY - 18, boxW - 40, 26);
    ctx.font = 'bold 13px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.textAlign = 'left';
    ctx.fillText('RNK', bx + 30, headY);
    ctx.fillText('CALLSIGN', bx + 84, headY);
    ctx.textAlign = 'right';
    ctx.fillText('SCORE', bx + boxW - 290, headY);
    ctx.fillText('DIST', bx + boxW - 195, headY);
    ctx.fillText('MAX M', bx + boxW - 115, headY);
    ctx.fillText('KILLS', bx + boxW - 34, headY);

    const entries = leaderboard.getEntries();
    const bannerReserve = lastSubmittedRun ? 48 : 0;
    const footerReserve = 62;
    const listTop = headY + 14;
    const rowH = 26;
    const maxRows = Math.max(
      4,
      Math.floor((by + boxH - footerReserve - bannerReserve - listTop) / rowH)
    );
    const visible = entries.slice(0, maxRows);

    const isRunMatch = (e: (typeof visible)[number]): boolean => {
      if (!lastSubmittedRun) return false;
      if (lastSubmittedRun.docId && e.id === lastSubmittedRun.docId) return true;
      return (
        e.callsign === lastSubmittedRun.callsign &&
        e.score === lastSubmittedRun.score &&
        e.distance === lastSubmittedRun.distance
      );
    };

    const pulse = 0.55 + 0.45 * Math.sin(timeSec * 8.5);
    visible.forEach((e, idx) => {
      const ry = listTop + idx * rowH;
      const matched = isRunMatch(e);
      if (matched) {
        ctx.fillStyle = `rgba(68, 255, 119, ${(0.18 + pulse * 0.14).toFixed(3)})`;
        ctx.fillRect(bx + 20, ry - 4, boxW - 40, rowH - 2);
        ctx.strokeStyle = `rgba(255, 246, 204, ${(0.55 + pulse * 0.45).toFixed(3)})`;
        ctx.lineWidth = 1.6;
        ctx.strokeRect(bx + 20, ry - 4, boxW - 40, rowH - 2);
      } else if (idx % 2 === 1) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.fillRect(bx + 20, ry - 4, boxW - 40, rowH - 2);
      }

      const rankStr = `${matched ? '►' : ''}#${String(idx + 1).padStart(2, '0')}`;
      const rowCol = matched ? '#FFFFFF' : idx === 0 ? '#FFB000' : '#44FF77';
      ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
      ctx.fillStyle = rowCol;
      ctx.textAlign = 'left';
      ctx.fillText(rankStr, bx + 28, ry + 14);
      ctx.fillText(
        matched ? `${e.callsign}  ★ JUST ADDED` : e.callsign,
        bx + 84,
        ry + 14,
        boxW - 420
      );

      ctx.textAlign = 'right';
      ctx.fillText(e.score.toLocaleString(), bx + boxW - 290, ry + 14);
      ctx.fillText(`${e.distance.toLocaleString()}M`, bx + boxW - 195, ry + 14);
      ctx.fillText(`M${e.maxMach.toFixed(1)}`, bx + boxW - 115, ry + 14);
      ctx.fillText(String(e.grazes), bx + boxW - 34, ry + 14);
    });

    if (lastSubmittedRun) {
      const banY = by + boxH - footerReserve - 42;
      ctx.fillStyle = 'rgba(14, 48, 24, 0.88)';
      ctx.fillRect(bx + 20, banY, boxW - 40, 34);
      ctx.strokeStyle = '#FFB000';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(bx + 20, banY, boxW - 40, 34);
      ctx.textAlign = 'center';
      ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#FFF6CC';
      ctx.fillText(
        `★ YOUR JUST-COMPLETED RUN: #${lastSubmittedRun.rank} ${lastSubmittedRun.callsign} — ${lastSubmittedRun.score.toLocaleString()} PTS (${lastSubmittedRun.distance.toLocaleString()}M · M${lastSubmittedRun.maxMach.toFixed(1)})`,
        bx + boxW * 0.5,
        banY + 21,
        boxW - 60
      );
    }

    this.addButton(
      ctx,
      'trench-manifest-close',
      { x: Math.round(bx + (boxW - 220) * 0.5), y: by + boxH - 50, width: 220, height: 36 },
      '[ESC] CLOSE MANIFEST',
      true,
      params.hoveredButtonId,
      '#44FF77',
      14.5
    );

    ctx.restore();
  }

  private addButton(
    ctx: CanvasRenderingContext2D,
    id: string,
    rect: ViewportRect,
    label: string,
    active: boolean,
    hoveredId: string | null,
    accent: string,
    fontPx: number
  ): void {
    this.buttons.push({ id, rect, label });
    const hov = hoveredId === id;
    ctx.save();
    ctx.fillStyle = hov
      ? 'rgba(255, 176, 0, 0.25)'
      : active
        ? 'rgba(34, 118, 58, 0.34)'
        : 'rgba(6, 18, 10, 0.90)';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = hov ? '#FFFFFF' : accent;
    ctx.lineWidth = hov ? 2.2 : 1.6;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    ctx.font = `bold ${fontPx}px "Share Tech Mono", monospace`;
    ctx.fillStyle = hov ? '#FFFFFF' : accent;
    ctx.textAlign = 'center';
    ctx.fillText(
      label,
      rect.x + rect.width * 0.5,
      rect.y + rect.height * 0.5 + fontPx * 0.34,
      rect.width - 12
    );
    ctx.restore();
  }

  private drawCornerBrackets(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    len: number,
    color: string,
    lw: number
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x, y + len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.moveTo(x + w - len, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + len);
    ctx.moveTo(x, y + h - len);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + len, y + h);
    ctx.moveTo(x + w - len, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - len);
    ctx.stroke();
  }
}
