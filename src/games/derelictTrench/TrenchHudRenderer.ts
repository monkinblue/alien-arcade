import {
  CONTROLS_STRIP_HEIGHT,
  drawAnnunciatorStrip,
  drawChromeButton,
  drawControlsCardModal,
  drawCornerBrackets,
  drawEllipsizedText,
  drawGameOverDebriefModal,
  drawGlobalManifestModal,
  drawKeycap,
  drawPauseBanner,
  drawPersistentControlsStrip,
  drawStatusToast,
  drawSystemMenuModal,
  draw1979RankedBonusBanner,
  drawTopChromeBar,
  font,
  hitTestChromeButtons,
  SEMIOTIC_ICONS,
  THEME,
  TOP_CHROME_BAR_HEIGHT,
  type AnnunciatorLamp,
  type ChromeButtonHitbox,
  type ControlsCardSpec,
  type ControlsStripItem,
  type ManifestRowData,
  type SystemMenuExtraRow,
  type UplinkStatus,
} from '../../render/chrome';
import { drawRankedTitleRibbon } from '../../render/RankedBadge';
import type { CrtPreset, PhosphorTheme } from '../../shell/Cartridge';
import type { ViewportRect } from '../../types';
import type { TrenchLeaderboardService } from './TrenchLeaderboard';
import type { TrenchSimulation } from './TrenchSimulation';
import { TRENCH_CONSTANTS, type TrenchLastSubmittedRun } from './types';

export const TRENCH_UI_IDS = {
  START_RANKED: 'trench-start',
  START_DRILL: 'trench-start-drill',
  PITCH_ARCADE: 'trench-pitch-arcade',
  PITCH_SIM: 'trench-pitch-sim',
  TOGGLE_INVERT: 'trench-toggle-invert',
  CYCLE_SENS: 'trench-cycle-sens',
  TITLE_CONTROLS: 'trench-title-controls',
  TITLE_MANIFEST: 'trench-title-manifest',
  TITLE_MENU: 'trench-title-menu',
} as const;

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
  crtPreset: CrtPreset;
  crtModeLocked: boolean;
  phosphorTheme: PhosphorTheme;
  masterVolume: number;
  isTouchDevice: boolean;
  stickSensitivityLabel: 'LOW' | 'MED' | 'HIGH';
  confirmExitPending: boolean;
  confirmGameMenuPending: boolean;
  osdMenuOpen: boolean;
  manifestOpen: boolean;
  controlsCardOpen: boolean;
  statusToastText: string | null;
  statusToastTone: 'green' | 'amber' | 'red' | 'cyan';
  statusToastAlpha: number;
  callsignDraft: string;
  callsignEditing: boolean;
  scoreSubmitted: boolean;
  submittingScore: boolean;
  submitResultBanner: string | null;
  submitResultTone: 'green' | 'amber' | 'red';
  lastSubmittedRun: TrenchLastSubmittedRun | null;
}

const TRENCH_CONTROLS_STRIP: readonly ControlsStripItem[] = [
  { key: 'MOUSE', label: 'Stick', accent: 'amber' },
  { key: 'W/S', label: 'Thr', accent: 'green' },
  { key: 'A/D', label: 'Yaw', accent: 'green' },
  { key: 'LMB', label: 'Gun', accent: 'amber' },
  { key: 'RMB/SPC', label: 'Msl', accent: 'amber' },
  { key: 'C/F', label: 'CMDS', accent: 'cyan' },
  { key: 'TAB/MMB', label: 'Tgt', accent: 'cyan' },
  { key: 'I', label: 'Invert', accent: 'green' },
  { key: 'H', label: 'Controls', accent: 'cyan' },
];

export class TrenchHudRenderer {
  public buttons: ChromeButtonHitbox[] = [];

  public hitTestButton(cx: number, cy: number): string | null {
    return hitTestChromeButtons(this.buttons, cx, cy);
  }

  public getLayout(width: number, height: number): {
    topBarH: number;
    dashH: number;
    controlsStripH: number;
    canopyVp: ViewportRect;
    dashVp: ViewportRect;
    controlsStripY: number;
  } {
    const topBarH = TOP_CHROME_BAR_HEIGHT;
    const controlsStripH = CONTROLS_STRIP_HEIGHT;
    const dashH = Math.max(148, Math.min(216, Math.round(height * 0.20)));
    const canopyH = Math.max(180, height - topBarH - dashH - controlsStripH);
    const w = Math.max(320, width);
    return {
      topBarH,
      dashH,
      controlsStripH,
      canopyVp: { x: 0, y: topBarH, width: w, height: canopyH },
      dashVp: { x: 0, y: topBarH + canopyH, width: w, height: dashH },
      controlsStripY: topBarH + canopyH + dashH,
    };
  }

  public render(ctx: CanvasRenderingContext2D, params: TrenchHudRenderParams): void {
    this.buttons = [];
    const layout = this.getLayout(params.width, params.height);

    // 1. Unified 46px Top Chrome Bar (4 pills: [H] CONTROLS | AUDIO | [ESC] MENU | MU-TH-UR OS)
    drawTopChromeBar(
      ctx,
      params.width,
      {
        title: 'DERELICT TRENCH',
        timeSec: params.timeSec,
        isRanked: !params.sim.freeFlightDrill,
        showRankedBadge: true,
        telemetryText: params.sim.freeFlightDrill
          ? `DRILL · ${params.sim.sectorId} · ${Math.round(params.sim.score).toLocaleString()} PTS`
          : `${params.sim.sectorId} · ${Math.round(params.sim.score).toLocaleString()} PTS${params.sim.ranked1979Bonus ? ' · 1.5X' : ''}`,
        crt1979Enabled: params.crtPreset === 'CLASSIC_1979',
        crtModeLocked: params.crtModeLocked,
        controlsLabel: '[H] CONTROLS',
        audioMuted: params.audioMuted,
        hoveredButtonId: params.hoveredButtonId,
        confirmExitPending: params.confirmExitPending,
      },
      this.buttons
    );

    // 2. Subtle Dark Vector Jet Canopy Frame & HUD Combiner Glass Outline
    this.drawCanopyFrameAndCombinerGlass(ctx, layout.canopyVp, params.sim.phase === 'FLYING');

    // 3. Mil-Spec Vector Jet Canopy HUD (Dark Halo Underpass + De-Duplicated Telemetry!)
    if (params.sim.phase === 'FLYING') {
      this.drawJetCanopyHud(ctx, params, layout.canopyVp);
    }

    // 4. Consolidated 3-Panel Lower Cockpit Cluster + Nostromo Backlit Annunciator Strip
    this.drawLowerCockpitCluster(ctx, params, layout.dashVp, layout.canopyVp);

    // 5. Persistent 22px Bottom Controls Strip (zero mid-game controls amnesia!)
    drawPersistentControlsStrip(
      ctx,
      params.width,
      params.height,
      TRENCH_CONTROLS_STRIP,
      layout.controlsStripY
    );

    // 6. Launch Title Overlay (inside canopy so Top Chrome Bar stays live)
    const anyModal =
      params.osdMenuOpen ||
      params.controlsCardOpen ||
      params.manifestOpen ||
      params.sim.phase === 'GAME_OVER' ||
      (params.sim.phase === 'FLYING' && params.sim.paused);

    if (params.sim.phase === 'TITLE' && !anyModal) {
      this.drawTitleOverlay(ctx, params, layout.canopyVp);
    }

    // 7. Standardized Modals (each isolates hitboxes via ModalFrame `buttons.length = 0`)
    if (params.osdMenuOpen) {
      this.drawUnifiedSystemMenu(ctx, params);
    } else if (params.controlsCardOpen) {
      this.drawUnifiedControlsCard(ctx, params);
    } else if (params.manifestOpen) {
      this.drawUnifiedManifest(ctx, params);
    } else if (params.sim.phase === 'GAME_OVER') {
      this.drawUnifiedGameOverDebrief(ctx, params);
    } else if (params.sim.phase === 'FLYING' && params.sim.paused) {
      drawPauseBanner(
        ctx,
        params.width,
        params.height,
        'Flight stick released. Press [P] or click RESUME to re-engage canopy flight, [H] for Controls, or [ESC] for System Menu.',
        this.buttons,
        params.hoveredButtonId,
        params.timeSec
      );
    }

    // 8. Transient Centered Status Toast ([I] Pitch Axis / [M] Audio Mute feedback)
    if (params.statusToastText && params.statusToastAlpha > 0.01) {
      const toastY = anyModal ? layout.topBarH + 14 : layout.canopyVp.y + 62;
      drawStatusToast(
        ctx,
        params.width,
        toastY,
        params.statusToastText,
        params.statusToastTone,
        params.statusToastAlpha
      );
    }
  }

  // ===========================================================================
  // DARK HALO UNDERPASS HELPERS (2.5px rgba(1,6,3,0.72) contrast shield!)
  // ===========================================================================
  private strokeWithDarkHalo(
    ctx: CanvasRenderingContext2D,
    drawPath: () => void,
    fgStyle: string,
    fgWidth: number,
    dash: number[] = []
  ): void {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(dash);

    ctx.strokeStyle = THEME.HALO_DARK;
    ctx.lineWidth = fgWidth + 2.5;
    ctx.beginPath();
    drawPath();
    ctx.stroke();

    ctx.strokeStyle = fgStyle;
    ctx.lineWidth = fgWidth;
    ctx.beginPath();
    drawPath();
    ctx.stroke();
    ctx.restore();
  }

  private fillTextWithDarkHalo(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    fgStyle: string
  ): void {
    ctx.save();
    ctx.strokeStyle = THEME.HALO_DARK;
    ctx.lineWidth = 3.2;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fgStyle;
    ctx.fillText(text, x, y);
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

    const cornerW = Math.min(115, w * 0.085);
    const cornerH = Math.min(72, h * 0.13);
    ctx.fillStyle = 'rgba(2, 8, 5, 0.84)';

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + cornerW, y);
    ctx.quadraticCurveTo(x + cornerW * 0.25, y + cornerH * 0.28, x, y + cornerH);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w - cornerW, y);
    ctx.quadraticCurveTo(x + w - cornerW * 0.25, y + cornerH * 0.28, x + w, y + cornerH);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(34, 122, 62, 0.34)';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(x, y + cornerH);
    ctx.quadraticCurveTo(x + cornerW * 0.25, y + cornerH * 0.28, x + cornerW, y + 3);
    ctx.lineTo(x + w - cornerW, y + 3);
    ctx.quadraticCurveTo(x + w - cornerW * 0.25, y + cornerH * 0.28, x + w, y + cornerH);
    ctx.stroke();

    if (showCombiner) {
      const combW = Math.min(w * 0.46, Math.max(380, h * 0.92));
      const combTopY = y + Math.max(12, h * 0.03);
      const combBotY = y + h + 4;
      const halfTop = combW * 0.44;
      const halfBot = combW * 0.54;

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
  // AUTHENTIC VECTOR JET CANOPY HUD (WITH DARK HALO UNDERPASS)
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
    const hudScale = Math.max(0.8, Math.min(1.1, Math.min(vp.width / 1360, vp.height / 600)));

    ctx.save();
    ctx.beginPath();
    ctx.rect(vp.x, vp.y, vp.width, vp.height);
    ctx.clip();

    // -------------------------------------------------------------------------
    // 1. TOP HEADING COMPASS TAPE (000°–360°) + CANYON CENTERLINE CARET
    // -------------------------------------------------------------------------
    const hdgW = Math.max(260, Math.min(vp.width - 320, Math.round(430 * hudScale)));
    const hdgX = cx - hdgW * 0.5;
    const hdgY = vp.y + 8;
    const headingDeg = sim.getCompassHeadingDeg();
    const canyonDeg = sim.getCanyonWaypointHeadingDeg();
    const pxPerDeg = hdgW / 64;

    ctx.fillStyle = 'rgba(2, 10, 5, 0.62)';
    ctx.fillRect(hdgX, hdgY, hdgW, 34);
    ctx.strokeStyle = 'rgba(68, 255, 119, 0.68)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(hdgX, hdgY + 34);
    ctx.lineTo(hdgX + hdgW, hdgY + 34);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(hdgX, hdgY, hdgW, 34);
    ctx.clip();
    ctx.font = font('micro', 12);
    ctx.textAlign = 'center';

    const startDeg = Math.floor((headingDeg - 36) / 5) * 5;
    const endDeg = Math.ceil((headingDeg + 36) / 5) * 5;
    for (let d = startDeg; d <= endDeg; d += 5) {
      const tx = cx + (d - headingDeg) * pxPerDeg;
      const major = d % 10 === 0;
      ctx.strokeStyle = major ? THEME.TEXT_PRIMARY : 'rgba(68, 255, 119, 0.52)';
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
        ctx.fillStyle = THEME.TEXT_BRIGHT;
        ctx.fillText(lbl, tx, hdgY + 17);
      }
    }
    ctx.restore();

    let relWpt = canyonDeg - headingDeg;
    while (relWpt > 180) relWpt -= 360;
    while (relWpt < -180) relWpt += 360;
    const caretX = Math.max(hdgX + 8, Math.min(hdgX + hdgW - 8, cx + relWpt * pxPerDeg));
    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.beginPath();
    ctx.moveTo(caretX, hdgY + 35);
    ctx.lineTo(caretX - 6, hdgY + 44);
    ctx.lineTo(caretX + 6, hdgY + 44);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(2, 14, 7, 0.94)';
    ctx.fillRect(cx - 26, hdgY + 36, 52, 20);
    ctx.strokeStyle = THEME.TEXT_PRIMARY;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - 26, hdgY + 36, 52, 20);
    ctx.font = font('data', 13);
    ctx.fillStyle = THEME.TEXT_PRIMARY;
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(headingDeg) % 360).padStart(3, '0'), cx, hdgY + 51);

    // -------------------------------------------------------------------------
    // 1B. TOP-HUD SECTOR STRIKE OBJECTIVE COUNTER (Zero collision at <=1024px!)
    // -------------------------------------------------------------------------
    const objStackBottomY = this.drawSectorObjectiveStrip(ctx, sim, vp, hdgX, hdgY, hdgW, hudScale);

    // -------------------------------------------------------------------------
    // 2. PITCH LADDER & ARTIFICIAL HORIZON (2.5px Dark Halo Underpass!)
    // -------------------------------------------------------------------------
    const ladderClipR = Math.min(vp.height * 0.42, 232 * hudScale);
    const pxPerRad = focalLen;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, ladderClipR, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(cx, cy);
    ctx.rotate(-sim.roll);

    const pitchPxOffset = sim.pitch * pxPerRad;
    ctx.font = font('micro', 12);

    for (let deg = -40; deg <= 40; deg += 10) {
      const degRad = (deg * Math.PI) / 180;
      const ry = pitchPxOffset - degRad * pxPerRad;
      if (Math.abs(ry) > ladderClipR + 30) continue;

      if (deg === 0) {
        this.strokeWithDarkHalo(
          ctx,
          () => {
            ctx.moveTo(-162 * hudScale, ry);
            ctx.lineTo(-34 * hudScale, ry);
            ctx.moveTo(34 * hudScale, ry);
            ctx.lineTo(162 * hudScale, ry);
          },
          'rgba(68, 255, 119, 0.90)',
          2.0
        );
      } else {
        const inner = 30 * hudScale;
        const outer = 86 * hudScale;
        const tickDir = deg > 0 ? 1 : -1;
        this.strokeWithDarkHalo(
          ctx,
          () => {
            ctx.moveTo(-outer, ry);
            ctx.lineTo(-inner, ry);
            ctx.lineTo(-inner, ry + tickDir * 9 * hudScale);
            ctx.moveTo(outer, ry);
            ctx.lineTo(inner, ry);
            ctx.lineTo(inner, ry + tickDir * 9 * hudScale);
          },
          'rgba(68, 255, 119, 0.78)',
          1.6,
          deg < 0 ? [7, 5] : []
        );

        const degTxt = `${deg > 0 ? '+' : ''}${deg}`;
        ctx.textAlign = 'right';
        this.fillTextWithDarkHalo(ctx, degTxt, -outer - 6, ry + 4, THEME.TEXT_BRIGHT);
        ctx.textAlign = 'left';
        this.fillTextWithDarkHalo(ctx, degTxt, outer + 6, ry + 4, THEME.TEXT_BRIGHT);
      }
    }
    ctx.restore();

    // -------------------------------------------------------------------------
    // 3. FIXED BORESIGHT GUN CROSS + PROJECTED FPM (2.5px Dark Halo Underpass!)
    // -------------------------------------------------------------------------
    this.strokeWithDarkHalo(
      ctx,
      () => {
        ctx.moveTo(cx - 12, cy);
        ctx.lineTo(cx - 3.5, cy);
        ctx.moveTo(cx + 3.5, cy);
        ctx.lineTo(cx + 12, cy);
        ctx.moveTo(cx, cy - 12);
        ctx.lineTo(cx, cy - 3.5);
        ctx.moveTo(cx, cy + 3.5);
        ctx.lineTo(cx, cy + 12);
      },
      THEME.TEXT_PRIMARY,
      2.0
    );

    const fpmCam = sim.getFlightPathMarkerCameraDir();
    const fpmScale = focalLen / Math.max(0.2, fpmCam.cz);
    const fpmX = Math.max(vp.x + 80, Math.min(vp.x + vp.width - 80, cx + fpmCam.cx * fpmScale));
    const fpmY = Math.max(vp.y + 60, Math.min(vp.y + vp.height - 45, cy - fpmCam.cy * fpmScale));

    ctx.save();
    ctx.translate(fpmX, fpmY);
    const fpmR = 9.5 * hudScale;
    this.strokeWithDarkHalo(
      ctx,
      () => {
        ctx.arc(0, 0, fpmR, 0, Math.PI * 2);
        ctx.moveTo(-25 * hudScale, 0);
        ctx.lineTo(-fpmR, 0);
        ctx.moveTo(fpmR, 0);
        ctx.lineTo(25 * hudScale, 0);
        ctx.moveTo(0, -18 * hudScale);
        ctx.lineTo(0, -fpmR);
      },
      sim.pullUpWarning ? THEME.ACCENT_AMBER : THEME.TEXT_BRIGHT,
      2.2
    );
    ctx.restore();

    // -------------------------------------------------------------------------
    // 4. LEFT HUD TAPE: AIRSPEED (KCAS · MACH) + COMPACT 2-READOUT BOX (THR% + NOE)
    // -------------------------------------------------------------------------
    const tapeW = Math.round(92 * hudScale);
    const tapeH = Math.min(vp.height - 148, Math.round(244 * hudScale));
    const leftX = vp.x + Math.max(18, Math.round(vp.width * 0.036));
    const tapeTop = cy - tapeH * 0.5 - 8;

    ctx.fillStyle = 'rgba(2, 10, 5, 0.56)';
    ctx.fillRect(leftX, tapeTop, tapeW, tapeH);
    ctx.strokeStyle = sim.afterburning ? THEME.ACCENT_AMBER : 'rgba(68, 255, 119, 0.68)';
    ctx.lineWidth = 1.6;
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
    ctx.font = font('micro', 12);
    ctx.textAlign = 'right';
    for (let k = minKt; k <= maxKt; k += 50) {
      if (k < 0) continue;
      const ty = tapeTop + tapeH * 0.5 - (k - sim.kcas) * pxPerKt;
      const major = k % 100 === 0;
      ctx.strokeStyle = major ? THEME.TEXT_PRIMARY : 'rgba(68, 255, 119, 0.52)';
      ctx.lineWidth = major ? 1.6 : 1.1;
      ctx.beginPath();
      ctx.moveTo(leftX + tapeW - (major ? 14 : 8), ty);
      ctx.lineTo(leftX + tapeW, ty);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = THEME.TEXT_BRIGHT;
        ctx.fillText(String(k), leftX + tapeW - 18, ty + 4);
      }
    }
    ctx.restore();

    const tapeMidY = tapeTop + tapeH * 0.5;
    const stallFlash = sim.isStalling && Math.sin(timeSec * 16) > -0.2;
    ctx.fillStyle = stallFlash ? THEME.ALERT_RED_BG : 'rgba(2, 14, 7, 0.95)';
    ctx.fillRect(leftX - 4, tapeMidY - 16, tapeW + 8, 32);
    ctx.strokeStyle = stallFlash
      ? THEME.ALERT_RED_STROKE
      : sim.afterburning
        ? THEME.ACCENT_AMBER
        : THEME.TEXT_PRIMARY;
    ctx.lineWidth = 2.0;
    ctx.strokeRect(leftX - 4, tapeMidY - 16, tapeW + 8, 32);
    ctx.textAlign = 'center';
    ctx.font = font('data', 18);
    ctx.fillStyle = stallFlash
      ? '#FFF0EC'
      : sim.afterburning
        ? THEME.ACCENT_AMBER_HI
        : THEME.TEXT_PRIMARY;
    ctx.fillText(`${sim.kcas}`, leftX + tapeW * 0.5, tapeMidY + 6);

    ctx.textAlign = 'left';
    ctx.font = font('head', 13);
    this.fillTextWithDarkHalo(
      ctx,
      sim.isStalling ? 'KCAS STALL' : `KCAS · M${sim.mach.toFixed(2)}`,
      leftX,
      tapeTop - 8,
      sim.isStalling ? THEME.ALERT_RED_TEXT : THEME.TEXT_BRIGHT
    );

    // AoA Indexer Brackets (left of pitch ladder)
    const idxX = leftX + tapeW + Math.round(28 * hudScale);
    const idxY = tapeMidY;
    const isSlowAoA =
      sim.isStalling || sim.kcas < TRENCH_CONSTANTS.CORNER_SPEED_MIN_KCAS || sim.aoaDeg > 9.5;
    const isFastAoA = !isSlowAoA && sim.kcas > TRENCH_CONSTANTS.CORNER_SPEED_MAX_KCAS;
    const isOptimalAoA = !isSlowAoA && !isFastAoA;

    ctx.save();
    ctx.strokeStyle = 'rgba(68, 255, 119, 0.38)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(idxX - 9, idxY - 26);
    ctx.lineTo(idxX - 13, idxY - 26);
    ctx.lineTo(idxX - 13, idxY + 26);
    ctx.lineTo(idxX - 9, idxY + 26);
    ctx.stroke();

    ctx.strokeStyle = isSlowAoA
      ? sim.isStalling
        ? THEME.ALERT_RED_STROKE
        : THEME.ACCENT_AMBER
      : 'rgba(68, 255, 119, 0.24)';
    ctx.lineWidth = isSlowAoA ? 2.6 : 1.2;
    ctx.beginPath();
    ctx.moveTo(idxX - 7, idxY - 22);
    ctx.lineTo(idxX, idxY - 13);
    ctx.lineTo(idxX + 7, idxY - 22);
    ctx.stroke();

    ctx.strokeStyle = isOptimalAoA ? THEME.TEXT_PRIMARY : 'rgba(68, 255, 119, 0.24)';
    ctx.lineWidth = isOptimalAoA ? 2.6 : 1.2;
    ctx.beginPath();
    ctx.arc(idxX, idxY, 6.4, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = isFastAoA ? THEME.ACCENT_CYAN : 'rgba(68, 255, 119, 0.24)';
    ctx.lineWidth = isFastAoA ? 2.6 : 1.2;
    ctx.beginPath();
    ctx.moveTo(idxX - 7, idxY + 22);
    ctx.lineTo(idxX, idxY + 13);
    ctx.lineTo(idxX + 7, idxY + 22);
    ctx.stroke();
    ctx.restore();

    // DE-DUPLICATED Left Floating Canopy Box: 2 critical readouts ONLY (THR% + NOE)
    const blockH = 52;
    const blockTopY = Math.min(vp.y + vp.height - blockH - 18, tapeTop + tapeH + 10);
    const leftBlockW = Math.round(162 * Math.max(0.9, hudScale));
    ctx.save();
    ctx.fillStyle = 'rgba(2, 10, 5, 0.80)';
    ctx.fillRect(leftX - 4, blockTopY, leftBlockW, blockH);
    ctx.strokeStyle = sim.afterburning ? THEME.ACCENT_AMBER : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(leftX - 4, blockTopY, leftBlockW, blockH);

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
    ctx.font = font('data', 14);
    ctx.fillStyle = sim.afterburning ? THEME.ACCENT_AMBER_HI : THEME.TEXT_PRIMARY;
    ctx.fillText(thrLabel, leftX + 4, blockTopY + 20);

    ctx.fillStyle = sim.noeActive
      ? THEME.TEXT_PRIMARY
      : sim.noeMultiplier > 1.05
        ? THEME.ACCENT_AMBER
        : THEME.TEXT_SECONDARY;
    ctx.fillText(
      sim.noeActive
        ? `NOE ${sim.noeMultiplier.toFixed(1)}X ACTIVE`
        : `NOE ${sim.noeMultiplier.toFixed(1)}X`,
      leftX + 4,
      blockTopY + 41
    );
    ctx.restore();

    // -------------------------------------------------------------------------
    // 5. RIGHT HUD TAPE: RADAR ALTIMETER (RALT) + COMPACT 2-READOUT BOX (MSL + CMDS)
    // -------------------------------------------------------------------------
    const ceilM = sim.sectorRadarCeilingM;
    const rightX = vp.x + vp.width - Math.max(20, Math.round(vp.width * 0.036)) - tapeW;

    ctx.fillStyle = 'rgba(2, 10, 5, 0.58)';
    ctx.fillRect(rightX, tapeTop, tapeW, tapeH);
    ctx.strokeStyle =
      sim.pullUpWarning || sim.ceilingBreached ? THEME.ACCENT_AMBER : 'rgba(68, 255, 119, 0.68)';
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
    const ceilY = tapeMidY - (ceilM - sim.raltM) * pxPerM;
    const ceilVisible = ceilY >= tapeTop - 10 && ceilY <= tapeTop + tapeH + 10;

    ctx.font = font('data', 12);
    ctx.textAlign = 'left';
    for (let m = minAlt; m <= maxAlt; m += 20) {
      if (m < 0) continue;
      const ty = tapeMidY - (m - sim.raltM) * pxPerM;
      const major = m % 40 === 0;
      ctx.strokeStyle = major ? THEME.TEXT_PRIMARY : 'rgba(68, 255, 119, 0.52)';
      ctx.lineWidth = major ? 1.6 : 1.1;
      ctx.beginPath();
      ctx.moveTo(rightX, ty);
      ctx.lineTo(rightX + (major ? 14 : 8), ty);
      ctx.stroke();
      // Suppress numeric RALT tick labels near the CEIL bar/label so they never overlap (e.g. 200 vs CEIL 190)
      const nearCeil = ceilVisible && ty >= ceilY - 24 && ty <= ceilY + 14;
      if (major && !nearCeil) {
        ctx.fillStyle = THEME.TEXT_BRIGHT;
        ctx.fillText(`${m}`, rightX + 18, ty + 4);
      }
    }

    if (ceilY > tapeTop) {
      ctx.fillStyle = sim.ceilingBreached ? 'rgba(255, 76, 36, 0.28)' : 'rgba(255, 176, 0, 0.14)';
      ctx.fillRect(rightX, tapeTop, tapeW, Math.min(tapeH, ceilY - tapeTop));
    }
    if (ceilVisible) {
      ctx.fillStyle = 'rgba(34, 18, 3, 0.92)';
      ctx.fillRect(rightX + 2, ceilY - 17, tapeW - 4, 16);
      ctx.strokeStyle = THEME.ACCENT_AMBER;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(rightX, ceilY);
      ctx.lineTo(rightX + tapeW, ceilY);
      ctx.stroke();
      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      ctx.font = font('micro', 12);
      ctx.textAlign = 'left';
      ctx.fillText(`CEIL ${ceilM}`, rightX + 8, ceilY - 5);
    }
    ctx.restore();

    const raltDanger = sim.pullUpWarning || sim.ceilingBreached;
    ctx.fillStyle = raltDanger ? THEME.ALERT_RED_BG : 'rgba(2, 14, 7, 0.95)';
    ctx.fillRect(rightX - 4, tapeMidY - 16, tapeW + 8, 32);
    ctx.strokeStyle = sim.pullUpWarning
      ? THEME.ALERT_RED_STROKE
      : sim.ceilingBreached
        ? THEME.ACCENT_AMBER
        : THEME.TEXT_PRIMARY;
    ctx.lineWidth = 2.0;
    ctx.strokeRect(rightX - 4, tapeMidY - 16, tapeW + 8, 32);
    ctx.textAlign = 'center';
    ctx.font = font('data', 17);
    ctx.fillStyle = raltDanger ? THEME.ACCENT_AMBER_HI : THEME.TEXT_PRIMARY;
    ctx.fillText(`${Math.round(sim.raltM)}M`, rightX + tapeW * 0.5, tapeMidY + 6);

    ctx.textAlign = 'right';
    ctx.font = font('head', 13);
    this.fillTextWithDarkHalo(
      ctx,
      sim.ceilingBreached ? `CEIL >${ceilM}M` : `RALT · C${ceilM}`,
      rightX + tapeW,
      tapeTop - 8,
      raltDanger ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT
    );

    const vviNorm = Math.max(-1, Math.min(1, sim.vviMps / 110));
    const vviY = tapeMidY - vviNorm * (tapeH * 0.44);
    ctx.fillStyle = sim.vviMps < -15 && sim.raltM < 60 ? THEME.ACCENT_AMBER : THEME.TEXT_PRIMARY;
    ctx.beginPath();
    ctx.moveTo(rightX - 3, vviY);
    ctx.lineTo(rightX - 13, vviY - 5.5);
    ctx.lineTo(rightX - 13, vviY + 5.5);
    ctx.closePath();
    ctx.fill();

    // DE-DUPLICATED Right Floating Canopy Box: 2 critical readouts ONLY (MSL + CMDS)
    const rightBlockW = Math.round(168 * Math.max(0.9, hudScale));
    const rightBlockX = rightX + tapeW - rightBlockW + 4;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 10, 5, 0.80)';
    ctx.fillRect(rightBlockX, blockTopY, rightBlockW, blockH);
    ctx.strokeStyle =
      sim.cmdsActiveTimer > 0
        ? THEME.TEXT_PRIMARY
        : sim.lockState === 'LOCKED'
          ? THEME.ACCENT_AMBER
          : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(rightBlockX, blockTopY, rightBlockW, blockH);

    const mslCol =
      sim.missilesRemaining <= 0
        ? THEME.ALERT_RED_TEXT
        : sim.lockState === 'LOCKED'
          ? THEME.ACCENT_AMBER_HI
          : THEME.TEXT_BRIGHT;
    const cmdsCol =
      sim.cmdsActiveTimer > 0
        ? THEME.TEXT_PRIMARY
        : sim.cmdsRemaining <= 0
          ? THEME.ALERT_RED_TEXT
          : sim.cmdsCooldown > 0
            ? THEME.ACCENT_AMBER
            : THEME.ACCENT_CYAN;

    ctx.textAlign = 'right';
    ctx.font = font('data', 14);
    ctx.fillStyle = mslCol;
    ctx.fillText(
      sim.lockState === 'LOCKED'
        ? `MSL ${sim.missilesRemaining}/6 [RDY]`
        : `MSL ${sim.missilesRemaining}/6`,
      rightX + tapeW - 4,
      blockTopY + 20
    );
    ctx.fillStyle = cmdsCol;
    ctx.fillText(
      sim.cmdsActiveTimer > 0
        ? `CMDS SAFE ${sim.cmdsActiveTimer.toFixed(1)}S`
        : sim.cmdsCooldown > 0
          ? `CMDS ${sim.cmdsRemaining}/8 (${sim.cmdsCooldown.toFixed(1)}S)`
          : `CMDS ${sim.cmdsRemaining}/8 [C/F]`,
      rightX + tapeW - 4,
      blockTopY + 41
    );
    ctx.restore();

    // -------------------------------------------------------------------------
    // 6. TRUE 3D BALLISTIC EEGS GUN FUNNEL + LIVE LCOS / CCIP PIPPER
    // -------------------------------------------------------------------------
    const ballisticSol = sim.computeBallisticPipper();
    this.drawEegsGunFunnel(ctx, params, ballisticSol, vp, hudScale);
    this.drawBallisticPipper(ctx, params, ballisticSol, vp, hudScale);

    // -------------------------------------------------------------------------
    // 7B. ZERO-CLUTTER 3-CLASS TARGET HUD BRACKETS (Ron Cobb ◈ / ✚ Resupply Pods!)
    // -------------------------------------------------------------------------
    this.drawTargetClassBrackets(ctx, params, vp, timeSec);

    // -------------------------------------------------------------------------
    // 8. SIDEWINDER IR SEEKER CONE, TD BOX & SHOOT CUE
    // -------------------------------------------------------------------------
    this.drawMissileSeekerAndTdBox(ctx, params, vp, cx, cy, focalLen, hudScale, timeSec);

    // -------------------------------------------------------------------------
    // 8B. 3D DIRECTIONAL INCOMING-SAM BREAK-TURN CHEVRON & EDGE VIGNETTES
    // -------------------------------------------------------------------------
    const samTel = sim.getPrimaryIncomingSamTelemetry();
    if (samTel) {
      const ringR = Math.min(vp.height * 0.34, 165 * hudScale);
      const ang = samTel.hudAngleRad;
      const tipX = cx + Math.cos(ang) * (ringR + 18);
      const tipY = cy + Math.sin(ang) * (ringR + 18);
      const baseX = cx + Math.cos(ang) * (ringR - 4);
      const baseY = cy + Math.sin(ang) * (ringR - 4);
      const perpX = -Math.sin(ang);
      const perpY = Math.cos(ang);
      const pulse = Math.sin(timeSec * 20) > -0.25;

      ctx.save();
      ctx.strokeStyle = pulse ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
      ctx.fillStyle = pulse ? 'rgba(255, 51, 24, 0.36)' : 'rgba(255, 176, 0, 0.26)';
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
      ctx.font = font('micro', 12);
      this.fillTextWithDarkHalo(
        ctx,
        `SAM ${Math.round(samTel.distM)}M`,
        lx,
        ly + 4,
        pulse ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER
      );
      ctx.restore();
    }

    if (sim.ceilingBreached) {
      const a = 0.14 + 0.1 * Math.sin(timeSec * 12);
      const grad = ctx.createLinearGradient(0, vp.y, 0, vp.y + 40);
      grad.addColorStop(0, `rgba(255, 51, 24, ${a.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255, 51, 24, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(vp.x, vp.y, vp.width, 40);
    }
    if (sim.purgeThermalAlert) {
      const a = 0.14 + 0.1 * Math.sin(timeSec * 10);
      const grad = ctx.createLinearGradient(0, vp.y + vp.height, 0, vp.y + vp.height - 36);
      grad.addColorStop(0, `rgba(255, 160, 0, ${a.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(255, 160, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(vp.x, vp.y + vp.height - 36, vp.width, 36);
    }

    // -------------------------------------------------------------------------
    // 9. POINTER-LOCK VIRTUAL STICK DEADZONE RING & DEFLECTION PIP
    // -------------------------------------------------------------------------
    if (!params.osdMenuOpen && !params.manifestOpen && !params.controlsCardOpen) {
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
      ctx.strokeStyle = insideDz ? 'rgba(68, 255, 119, 0.38)' : 'rgba(68, 255, 119, 0.24)';
      ctx.lineWidth = 1.15;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, dzR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      if (!insideDz) {
        ctx.strokeStyle = 'rgba(158, 247, 184, 0.28)';
        ctx.lineWidth = 1.0;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(dotX, dotY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = insideDz ? 'rgba(158, 247, 184, 0.84)' : THEME.ACCENT_AMBER;
      ctx.beginPath();
      ctx.arc(dotX, dotY, insideDz ? 2.4 : 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = insideDz ? 'rgba(68, 255, 119, 0.52)' : 'rgba(255, 228, 143, 0.85)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(dotX, dotY, insideDz ? 4.8 : 6.0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // 10. SINGLE HIGHEST-PRIORITY TACTICAL ACTION CUE + PULL-UP CHEVRONS
    //     (Detailed lamp states live cleanly in the Nostromo Annunciator Strip!)
    // -------------------------------------------------------------------------
    const actionCueY = Math.max(vp.y + 84, objStackBottomY + 18);
    ctx.textAlign = 'center';
    if (sim.samIncomingActive && Math.sin(timeSec * 18) > -0.3) {
      ctx.font = font('head', 18);
      this.fillTextWithDarkHalo(
        ctx,
        '▲ SAM INBOUND — POP CMDS [C / F] OR 7G BREAK ▲',
        cx,
        actionCueY,
        THEME.ALERT_RED_TEXT
      );
    } else if (sim.pullUpWarning && Math.sin(timeSec * 18) > -0.25) {
      const py = cy + 62 * hudScale;
      this.strokeWithDarkHalo(
        ctx,
        () => {
          for (let k = 0; k < 2; k++) {
            const yOff = py + k * 14;
            ctx.moveTo(cx - 46, yOff + 14);
            ctx.lineTo(cx, yOff);
            ctx.lineTo(cx + 46, yOff + 14);
          }
        },
        THEME.ACCENT_AMBER,
        3.0
      );
      ctx.font = font('display', 19);
      this.fillTextWithDarkHalo(ctx, '▲ PULL UP // LOW RALT ▲', cx, py + 48, THEME.ACCENT_AMBER_HI);
    }

    // Non-blocking Cursor-Stick pill cleanly anchored at bottom-center of canopy
    // (ZERO collision with Objective Strip at <=1024px or glare-shield crown!)
    let bottomStackY = vp.y + vp.height - 24;
    if (!params.pointerLocked && !sim.paused && !params.osdMenuOpen && !params.manifestOpen && !params.controlsCardOpen) {
      const hintText = 'CURSOR STICK ACTIVE · CLICK CANOPY TO LOCK · [ARROWS] FALLBACK';
      ctx.save();
      ctx.font = font('micro', 12);
      const pillW = Math.min(vp.width - 60, Math.ceil(ctx.measureText(hintText).width + 20));
      const pillX = Math.round(cx - pillW * 0.5);
      const pillY = bottomStackY - 12;
      ctx.fillStyle = 'rgba(2, 11, 6, 0.80)';
      ctx.fillRect(pillX, pillY, pillW, 20);
      ctx.strokeStyle = THEME.BORDER_SUBTLE;
      ctx.lineWidth = 1.1;
      ctx.strokeRect(pillX + 0.5, pillY + 0.5, pillW - 1, 19);
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      drawEllipsizedText(ctx, hintText, cx, pillY + 10.5, pillW - 12);
      ctx.restore();
      bottomStackY -= 26;
    }

    if (sim.weaponCueText && sim.weaponCueTimer > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, sim.weaponCueTimer * 2.2);
      ctx.textAlign = 'center';
      ctx.font = font('head', 14);
      const cueCol = sim.weaponCueText.includes('RESUPPLY')
        ? THEME.ACCENT_CYAN
        : sim.weaponCueText.includes('SECTOR CLEAR')
          ? THEME.TEXT_PRIMARY
          : sim.weaponCueText.includes('FOX-2') || sim.weaponCueText.includes('DECOYED')
            ? THEME.ACCENT_AMBER_HI
            : THEME.ACCENT_AMBER;
      this.fillTextWithDarkHalo(ctx, sim.weaponCueText, cx, bottomStackY, cueCol);
      ctx.restore();
      bottomStackY -= 24;
    }

    if (sim.cmdsActiveTimer > 0) {
      const frac = Math.max(
        0,
        Math.min(1, sim.cmdsActiveTimer / TRENCH_CONSTANTS.CMDS_ACTIVE_PROTECTION_SEC)
      );
      const barW = Math.round(250 * Math.max(0.85, hudScale));
      const barX = cx - barW * 0.5;
      const barY = bottomStackY - 8;
      ctx.save();
      ctx.fillStyle = 'rgba(2, 16, 8, 0.86)';
      ctx.fillRect(barX - 8, barY - 16, barW + 16, 26);
      ctx.strokeStyle = 'rgba(68, 255, 119, 0.78)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(barX - 8, barY - 16, barW + 16, 26);
      ctx.fillStyle = 'rgba(68, 255, 119, 0.22)';
      ctx.fillRect(barX, barY + 2, barW, 4);
      ctx.fillStyle = THEME.TEXT_PRIMARY;
      ctx.fillRect(barX, barY + 2, barW * frac, 4);
      ctx.textAlign = 'center';
      ctx.font = font('micro', 12);
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      ctx.fillText(
        `CHAFF / FLARE ACTIVE · SAFE ${sim.cmdsActiveTimer.toFixed(1)}S`,
        cx,
        barY - 3
      );
      ctx.restore();
    }

    // Floating score / impact popups
    for (const pop of sim.popups) {
      const a = Math.max(0, 1 - pop.age / pop.duration);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = font('head', 18);
      this.fillTextWithDarkHalo(
        ctx,
        pop.text,
        cx + pop.nx * vp.width * 0.5,
        cy + pop.ny * vp.height * 0.5,
        pop.color
      );
      if (pop.subText) {
        ctx.font = font('micro', 12);
        this.fillTextWithDarkHalo(
          ctx,
          pop.subText,
          cx + pop.nx * vp.width * 0.5,
          cy + pop.ny * vp.height * 0.5 + 18,
          THEME.TEXT_BRIGHT
        );
      }
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * True Real-Time Sweeping F-16 EEGS Gun Funnel projected from the aircraft's live motion ring buffer!
   * Every point at age `t` is the exact current 3D world position RIGHT NOW of a 20mm bullet fired `t` seconds ago,
   * so banking and high-G turns whip the funnel across the canopy identically to live 20mm tracers in flight.
   */
  private drawEegsGunFunnel(
    ctx: CanvasRenderingContext2D,
    params: TrenchHudRenderParams,
    sol: ReturnType<TrenchSimulation['computeBallisticPipper']>,
    vp: ViewportRect,
    hudScale: number
  ): void {
    const { sim } = params;
    const wingspanHalfM = 6.2;
    const steps = 13;
    const tMin = 0.06;
    const tMax = Math.max(tMin + 0.1, Math.min(1.45, Math.max(1.05, sol.tofSec)));

    const ages: number[] = [];
    for (let i = 0; i <= steps; i++) {
      ages.push(tMin + (i / steps) * (tMax - tMin));
    }

    const ribbon = sim.sampleHistoricalGunRibbon(ages);
    const leftPts: Array<{ x: number; y: number }> = [];
    const rightPts: Array<{ x: number; y: number }> = [];

    for (const sample of ribbon) {
      const { pos, right } = sample;
      const centerP = params.projectWorld(pos.x, pos.y, pos.z);
      if (!centerP) continue;

      const lp = params.projectWorld(
        pos.x - right.x * wingspanHalfM,
        pos.y - right.y * wingspanHalfM,
        pos.z - right.z * wingspanHalfM
      );
      const rp = params.projectWorld(
        pos.x + right.x * wingspanHalfM,
        pos.y + right.y * wingspanHalfM,
        pos.z + right.z * wingspanHalfM
      );

      if (lp && rp) {
        const dx = rp.sx - lp.sx;
        const dy = rp.sy - lp.sy;
        const span = Math.hypot(dx, dy);
        const clampedHalf = Math.max(6 * hudScale, Math.min(78 * hudScale, span * 0.5));
        const nx = span > 0.01 ? dx / span : 1;
        const ny = span > 0.01 ? dy / span : 0;
        leftPts.push({ x: centerP.sx - nx * clampedHalf, y: centerP.sy - ny * clampedHalf });
        rightPts.push({ x: centerP.sx + nx * clampedHalf, y: centerP.sy + ny * clampedHalf });
      }
    }

    if (leftPts.length < 2) return;

    const railCol = sim.gunFiringNow
      ? 'rgba(255, 228, 143, 0.88)'
      : 'rgba(68, 255, 119, 0.68)';
    const railW = sim.gunFiringNow ? 1.9 : 1.5;

    // Clip funnel cleanly inside the canopy glass below the top heading tape!
    const topClip = vp.y + 58;
    ctx.save();
    ctx.beginPath();
    ctx.rect(vp.x + 6, topClip, vp.width - 12, Math.max(40, vp.y + vp.height - topClip - 4));
    ctx.clip();

    this.strokeWithDarkHalo(
      ctx,
      () => {
        leftPts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      },
      railCol,
      railW
    );

    this.strokeWithDarkHalo(
      ctx,
      () => {
        rightPts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      },
      railCol,
      railW
    );

    this.strokeWithDarkHalo(
      ctx,
      () => {
        const ticks = [
          Math.floor(leftPts.length * 0.25),
          Math.floor(leftPts.length * 0.58),
          leftPts.length - 1,
        ];
        for (const idx of ticks) {
          if (idx < 0 || idx >= leftPts.length) continue;
          const lp = leftPts[idx];
          const rp = rightPts[idx];
          const mx = (lp.x + rp.x) * 0.5;
          const my = (lp.y + rp.y) * 0.5;
          ctx.moveTo(lp.x, lp.y);
          ctx.lineTo(lp.x + (mx - lp.x) * 0.28, lp.y + (my - lp.y) * 0.28);
          ctx.moveTo(rp.x, rp.y);
          ctx.lineTo(rp.x + (mx - rp.x) * 0.28, rp.y + (my - rp.y) * 0.28);
        }
      },
      'rgba(158, 247, 184, 0.65)',
      1.2
    );
    ctx.restore();
  }

  /**
   * Physics-Exact F-16 LCOS / CCIP Gun Pipper + Moving-Target Predicted Intercept Cue (`LEAD`):
   * - The main circular pipper (`LCOS` / `CCIP`) ALWAYS marks the literal 3D world spot where bullets
   *   fired RIGHT NOW will arrive at target time-of-flight (or terrain impact), accounting for airspeed,
   *   jet momentum/AoA, aerodynamic drag, gravity, and terrain/arch obstruction.
   * - For moving targets (Bandit Jets), a dashed lead vector extends ahead of the Bandit to its `LEAD`
   *   intercept ring (where the Bandit will be at `tof`). Put the LCOS pipper on the `LEAD` ring -> HIT!
   */
  private drawBallisticPipper(
    ctx: CanvasRenderingContext2D,
    params: TrenchHudRenderParams,
    sol: ReturnType<TrenchSimulation['computeBallisticPipper']>,
    vp: ViewportRect,
    hudScale: number
  ): void {
    const { sim } = params;
    const pad = 28;

    // 1. Draw Moving Target Lead Vector & Predicted Intercept Ring (`LEAD`) when tracking a moving Bandit!
    if (sol.hasMovingLead && sol.targetPos && sol.targetInterceptPoint) {
      const tp = params.projectWorld(sol.targetPos.x, sol.targetPos.y, sol.targetPos.z);
      const lp = params.projectWorld(
        sol.targetInterceptPoint.x,
        sol.targetInterceptPoint.y,
        sol.targetInterceptPoint.z
      );
      if (lp) {
        const lx = Math.max(vp.x + pad, Math.min(vp.x + vp.width - pad, lp.sx));
        const ly = Math.max(vp.y + pad, Math.min(vp.y + vp.height - pad, lp.sy));
        const leadCol = sol.onSolution ? '#FFF6CC' : THEME.ACCENT_AMBER_HI;

        // Dashed vector tether from current Bandit position -> future intercept point
        if (tp) {
          const tx = Math.max(vp.x + pad, Math.min(vp.x + vp.width - pad, tp.sx));
          const ty = Math.max(vp.y + pad, Math.min(vp.y + vp.height - pad, tp.sy));
          if (Math.hypot(lx - tx, ly - ty) >= 10) {
            ctx.save();
            ctx.setLineDash([5, 4]);
            this.strokeWithDarkHalo(
              ctx,
              () => {
                ctx.moveTo(tx, ty);
                ctx.lineTo(lx, ly);
              },
              sol.onSolution ? 'rgba(255, 246, 204, 0.85)' : 'rgba(255, 176, 0, 0.65)',
              1.4
            );
            ctx.setLineDash([]);
            ctx.restore();
          }
        }

        // Crisp Aim-Here `LEAD` Intercept Diamond/Circle
        const lr = Math.round((sol.onSolution ? 13 : 11) * hudScale);
        this.strokeWithDarkHalo(
          ctx,
          () => {
            ctx.arc(lx, ly, lr, 0, Math.PI * 2);
          },
          leadCol,
          sol.onSolution ? 2.4 : 1.7
        );
        this.strokeWithDarkHalo(
          ctx,
          () => {
            ctx.moveTo(lx - lr - 4, ly);
            ctx.lineTo(lx - lr + 2, ly);
            ctx.moveTo(lx + lr - 2, ly);
            ctx.lineTo(lx + lr + 4, ly);
            ctx.moveTo(lx, ly - lr - 4);
            ctx.lineTo(lx, ly - lr + 2);
            ctx.moveTo(lx, ly + lr - 2);
            ctx.lineTo(lx, ly + lr + 4);
          },
          leadCol,
          1.4
        );

        const leadSepPx = tp ? Math.hypot(lx - tp.sx, ly - tp.sy) : 999;
        if (sol.onSolution || leadSepPx >= 18) {
          ctx.save();
          ctx.font = font('micro', 12);
          const leadText = sol.onSolution ? 'FIRE!' : 'LEAD';
          if (tp && leadSepPx < 62) {
            // Place LEAD label on the outer side away from TRK/LOCK BANDIT box to prevent overlap
            const pushRight = lx >= tp.sx;
            ctx.textAlign = pushRight ? 'left' : 'right';
            this.fillTextWithDarkHalo(
              ctx,
              leadText,
              lx + (pushRight ? lr + 6 : -(lr + 6)),
              ly + 4,
              leadCol
            );
          } else {
            ctx.textAlign = 'center';
            this.fillTextWithDarkHalo(ctx, leadText, lx, ly - lr - 7, leadCol);
          }
          ctx.restore();
        }
      }
    }

    // 2. Draw Literal Bullet-End-Up Pipper (`LCOS` / `CCIP` / `MASKED`)
    const p = params.projectWorld(sol.worldPoint.x, sol.worldPoint.y, sol.worldPoint.z);
    if (!p) return;

    const px = Math.max(vp.x + pad, Math.min(vp.x + vp.width - pad, p.sx));
    const py = Math.max(vp.y + pad, Math.min(vp.y + vp.height - pad, p.sy));

    const isLcos = sol.mode === 'LCOS';
    const isPodCue = Boolean(sol.isResupplyCue);
    const isMasked = Boolean(sol.terrainMaskedTarget);
    const isSolution = Boolean(sol.onSolution);
    const r = Math.round((isLcos ? 19 : 16) * hudScale);
    const col = isSolution
      ? '#FFF6CC'
      : sim.gunFiringNow
        ? THEME.ACCENT_AMBER_HI
        : isPodCue
          ? THEME.ACCENT_CYAN
          : isMasked
            ? THEME.ALERT_RED_TEXT
            : isLcos
              ? THEME.ACCENT_AMBER
              : sol.hitTerrain
                ? THEME.TEXT_BRIGHT
                : 'rgba(68, 255, 119, 0.85)';

    const outerCol = isSolution
      ? 'rgba(255, 246, 204, 0.80)'
      : isPodCue
        ? 'rgba(76, 238, 255, 0.55)'
        : isMasked
          ? 'rgba(255, 98, 71, 0.55)'
          : isLcos
            ? 'rgba(255, 176, 0, 0.52)'
            : 'rgba(68, 255, 119, 0.48)';

    this.strokeWithDarkHalo(
      ctx,
      () => {
        ctx.arc(px, py, r, 0, Math.PI * 2);
      },
      outerCol,
      1.35
    );

    const rngFrac = Math.max(0.06, Math.min(1, sol.distM / 950));
    const startA = -Math.PI * 0.5;
    const endA = startA + rngFrac * Math.PI * 2;
    this.strokeWithDarkHalo(
      ctx,
      () => {
        ctx.arc(px, py, r, startA, endA);
      },
      col,
      2.4
    );

    this.strokeWithDarkHalo(
      ctx,
      () => {
        for (let k = 0; k < 4; k++) {
          const a = k * (Math.PI * 0.5);
          ctx.moveTo(px + Math.cos(a) * (r - 3), py + Math.sin(a) * (r - 3));
          ctx.lineTo(px + Math.cos(a) * (r + 5), py + Math.sin(a) * (r + 5));
        }
      },
      col,
      1.6
    );

    ctx.save();
    ctx.fillStyle = THEME.HALO_DARK;
    ctx.beginPath();
    ctx.arc(px, py, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isLcos ? THEME.ACCENT_AMBER_HI : col;
    ctx.beginPath();
    ctx.arc(px, py, 2.4, 0, Math.PI * 2);
    ctx.fill();

    if (sim.hitConfirmTimer > 0) {
      this.strokeWithDarkHalo(
        ctx,
        () => {
          const h = 11;
          ctx.moveTo(px - h, py - h);
          ctx.lineTo(px - 4, py - 4);
          ctx.moveTo(px + h, py - h);
          ctx.lineTo(px + 4, py - 4);
          ctx.moveTo(px - h, py + h);
          ctx.lineTo(px - 4, py + 4);
          ctx.moveTo(px + h, py + h);
          ctx.lineTo(px + 4, py + 4);
        },
        '#FFFFFF',
        2.5
      );
    }

    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    const distStr =
      sol.distM >= 1000 ? `${(sol.distM / 1000).toFixed(1)}KM` : `${Math.round(sol.distM)}M`;
    const modeTag = isPodCue
      ? `${SEMIOTIC_ICONS.DIAMOND} POD`
      : isMasked
        ? 'MASKED'
        : isSolution
          ? 'IN RNG'
          : isLcos
            ? 'LCOS'
            : sol.hitTerrain
              ? 'CCIP'
              : 'GUN';
    this.fillTextWithDarkHalo(ctx, `${modeTag} ${distStr}`, px + r + 8, py + 4, col);
    ctx.restore();
  }

  /**
   * Top-HUD Sector Strike Objective Counter (`SEC-01 OBJ: 3 SAM // 2 BANDITS`).
   * Returns bottom Y when stacked center on ultra-narrow viewports (0 when tucked cleanly top-left).
   */
  private drawSectorObjectiveStrip(
    ctx: CanvasRenderingContext2D,
    sim: TrenchSimulation,
    vp: ViewportRect,
    hdgX: number,
    hdgY: number,
    hdgW: number,
    hudScale: number
  ): number {
    const leftSpace = hdgX - (vp.x + 14);
    const wide = leftSpace >= 225;
    const boxW = wide
      ? Math.min(295, Math.max(220, Math.min(leftSpace - 10, Math.round(280 * hudScale))))
      : Math.min(280, vp.width - 32);
    const boxH = 44;
    const bx = wide
      ? vp.x + Math.max(14, Math.round(vp.width * 0.02))
      : Math.round(hdgX + (hdgW - boxW) * 0.5);
    const by = wide ? hdgY : hdgY + 60;

    const allDone = sim.sectorSamsRemaining === 0 && sim.sectorBanditsRemaining === 0;
    const sectorFrac = Math.max(
      0,
      Math.min(1, (sim.z - sim.sectorStartZ) / Math.max(1, TRENCH_CONSTANTS.SECTOR_LENGTH_M))
    );
    const remKm = Math.max(0, (sim.sectorEndZ - sim.z) / 1000).toFixed(1);

    ctx.save();
    ctx.fillStyle = 'rgba(2, 11, 6, 0.84)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = allDone ? THEME.TEXT_PRIMARY : 'rgba(68, 255, 119, 0.48)';
    ctx.lineWidth = allDone ? 1.8 : 1.3;
    ctx.strokeRect(bx, by, boxW, boxH);

    ctx.textAlign = 'left';
    ctx.font = font('head', 13);
    let tx = bx + 9;
    const ty = by + 18;
    const secHead = `${sim.sectorId}: `;
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.fillText(secHead, tx, ty);
    tx += ctx.measureText(secHead).width;

    const samStr = `${sim.sectorSamsRemaining} SAM`;
    ctx.fillStyle = sim.sectorSamsRemaining > 0 ? THEME.ALERT_RED_TEXT : THEME.TEXT_PRIMARY;
    ctx.fillText(samStr, tx, ty);
    tx += ctx.measureText(samStr).width;

    const sep = ' · ';
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.fillText(sep, tx, ty);
    tx += ctx.measureText(sep).width;

    const banStr = `${sim.sectorBanditsRemaining} BND`;
    ctx.fillStyle = sim.sectorBanditsRemaining > 0 ? THEME.ACCENT_AMBER : THEME.TEXT_PRIMARY;
    drawEllipsizedText(ctx, banStr, tx, ty, bx + boxW - 8 - tx);

    const barX = bx + 9;
    const barY = by + 30;
    const barW = boxW - 76;
    ctx.fillStyle = 'rgba(14, 34, 20, 0.92)';
    ctx.fillRect(barX, barY, barW, 6);
    ctx.fillStyle = allDone ? THEME.TEXT_PRIMARY : THEME.ACCENT_AMBER;
    ctx.fillRect(barX, barY, Math.max(3, barW * sectorFrac), 6);

    ctx.textAlign = 'right';
    ctx.font = font('micro', 12);
    ctx.fillStyle = allDone ? THEME.TEXT_PRIMARY : THEME.TEXT_BRIGHT;
    ctx.fillText(allDone ? 'CLEAR!' : `${remKm}KM`, bx + boxW - 8, by + 37);
    ctx.restore();

    return wide ? 0 : by + boxH;
  }

  /**
   * 3-Class Target HUD Brackets:
   * - SAM_SITE: Red-Amber Diamond
   * - BANDIT_DRONE: Amber Caret (`^`)
   * - RESUPPLY_CACHE: Cyan Hexagon + Ron Cobb Diamond/Cross (`◈` / `✚`) for Amber-CRT safety!
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
      if (t.destroyed || t.id === sim.lockedTargetId) continue;

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
        const col = blink ? THEME.ACCENT_AMBER_HI : THEME.ALERT_RED_STROKE;
        this.strokeWithDarkHalo(
          ctx,
          () => {
            ctx.moveTo(pt.sx, pt.sy - baseR);
            ctx.lineTo(pt.sx + baseR, pt.sy);
            ctx.lineTo(pt.sx, pt.sy + baseR);
            ctx.lineTo(pt.sx - baseR, pt.sy);
            ctx.closePath();
          },
          col,
          locking ? 2.2 : 1.75
        );

        if (locking) {
          const outer = baseR + 5;
          ctx.strokeStyle = 'rgba(255, 51, 24, 0.85)';
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
          ctx.font = font('micro', 12);
          this.fillTextWithDarkHalo(
            ctx,
            locking ? '▲ SAM!' : 'SAM',
            pt.sx,
            pt.sy - baseR - 6,
            blink ? THEME.ACCENT_AMBER_HI : THEME.ALERT_RED_TEXT
          );
          this.fillTextWithDarkHalo(ctx, distStr, pt.sx, pt.sy + baseR + 14, THEME.ALERT_RED_TEXT);
        }
      } else if (t.kind === 'BANDIT_DRONE') {
        this.strokeWithDarkHalo(
          ctx,
          () => {
            ctx.moveTo(pt.sx - baseR * 1.05, pt.sy + baseR * 0.45);
            ctx.lineTo(pt.sx, pt.sy - baseR * 0.92);
            ctx.lineTo(pt.sx + baseR * 1.05, pt.sy + baseR * 0.45);
          },
          THEME.ACCENT_AMBER,
          2.0
        );

        ctx.strokeStyle = THEME.ACCENT_AMBER;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(pt.sx - baseR * 0.72, pt.sy + baseR * 0.65);
        ctx.lineTo(pt.sx - baseR * 0.25, pt.sy + baseR * 0.65);
        ctx.moveTo(pt.sx + baseR * 0.25, pt.sy + baseR * 0.65);
        ctx.lineTo(pt.sx + baseR * 0.72, pt.sy + baseR * 0.65);
        ctx.stroke();

        if (slantM <= 1800) {
          ctx.textAlign = 'center';
          ctx.font = font('micro', 12);
          this.fillTextWithDarkHalo(ctx, 'BANDIT', pt.sx, pt.sy - baseR - 5, THEME.ACCENT_AMBER);
          this.fillTextWithDarkHalo(ctx, distStr, pt.sx, pt.sy + baseR + 15, THEME.ACCENT_AMBER_HI);
        }
      } else {
        // RESUPPLY_CACHE: Cyan Hexagon + Ron Cobb Diamond/Cross (◈ / ✚) — 100% distinct in P3 AMBER!
        const hexR = Math.max(15, baseR + 2);
        this.strokeWithDarkHalo(
          ctx,
          () => {
            for (let k = 0; k < 6; k++) {
              const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
              const hx = pt.sx + Math.cos(a) * hexR;
              const hy = pt.sy + Math.sin(a) * hexR;
              if (k === 0) ctx.moveTo(hx, hy);
              else ctx.lineTo(hx, hy);
            }
            ctx.closePath();
          },
          THEME.ACCENT_CYAN,
          2.0
        );

        // Distinct corner cross ticks (✚) around bracket for Amber-CRT icon parity
        const crossArm = 4.5;
        this.strokeWithDarkHalo(
          ctx,
          () => {
            ctx.moveTo(pt.sx - crossArm, pt.sy);
            ctx.lineTo(pt.sx + crossArm, pt.sy);
            ctx.moveTo(pt.sx, pt.sy - crossArm);
            ctx.lineTo(pt.sx, pt.sy + crossArm);
          },
          '#D4FFFF',
          1.8
        );

        if (slantM <= 2200) {
          ctx.textAlign = 'center';
          ctx.font = font('micro', 12);
          this.fillTextWithDarkHalo(
            ctx,
            slantM <= 1050
              ? `${SEMIOTIC_ICONS.DIAMOND} RESUPPLY ${SEMIOTIC_ICONS.CROSS}`
              : `${SEMIOTIC_ICONS.DIAMOND} RESUPPLY`,
            pt.sx,
            pt.sy - hexR - 6,
            THEME.ACCENT_CYAN
          );
          this.fillTextWithDarkHalo(ctx, distStr, pt.sx, pt.sy + hexR + 15, '#C8FFFF');
        }
      }
    }
    ctx.restore();
  }

  /**
   * Sidewinder IR Seeker Cone Circle + Snappy 0.35s TD Box & SHOOT cue.
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

    if (sim.missilesRemaining > 0) {
      const seekerRad = (TRENCH_CONSTANTS.MISSILE_SEEKER_HALF_ANGLE_DEG * Math.PI) / 180;
      const seekerPx = Math.min(vp.height * 0.42, Math.tan(seekerRad) * focalLen);
      ctx.save();
      ctx.strokeStyle =
        sim.lockState === 'LOCKED'
          ? 'rgba(255, 176, 0, 0.62)'
          : sim.lockedTargetInSeeker
            ? 'rgba(68, 255, 119, 0.42)'
            : 'rgba(68, 255, 119, 0.22)';
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
          : `${SEMIOTIC_ICONS.DIAMOND} RESUPPLY`;
    const classCol =
      lockedTarget.kind === 'SAM_SITE'
        ? THEME.ALERT_RED_STROKE
        : lockedTarget.kind === 'BANDIT_DRONE'
          ? THEME.ACCENT_AMBER
          : THEME.ACCENT_CYAN;

    ctx.save();
    if (isLocked) {
      const pulse = 0.55 + 0.45 * Math.sin(timeSec * 16);
      const d = Math.max(20, Math.min(46, lockedTarget.radius * pt.scale + 12));
      const diaCol =
        lockedTarget.kind === 'RESUPPLY_CACHE'
          ? pulse > 0.5
            ? THEME.ACCENT_CYAN
            : THEME.ACCENT_AMBER_HI
          : pulse > 0.55
            ? THEME.ACCENT_AMBER
            : THEME.ALERT_RED_STROKE;

      this.strokeWithDarkHalo(
        ctx,
        () => {
          ctx.moveTo(tx, ty - d);
          ctx.lineTo(tx + d, ty);
          ctx.lineTo(tx, ty + d);
          ctx.lineTo(tx - d, ty);
          ctx.closePath();
        },
        diaCol,
        2.7
      );

      ctx.strokeStyle = THEME.ACCENT_AMBER_HI;
      ctx.lineWidth = 1.45;
      const dIn = d * 0.72;
      ctx.beginPath();
      ctx.moveTo(tx, ty - dIn);
      ctx.lineTo(tx + dIn, ty);
      ctx.lineTo(tx, ty + dIn);
      ctx.lineTo(tx - dIn, ty);
      ctx.closePath();
      ctx.stroke();

      ctx.font = font('data', 13);
      ctx.textAlign = 'center';
      this.fillTextWithDarkHalo(ctx, `LOCK // ${kindShort}`, tx, ty - d - 8, THEME.ACCENT_AMBER_HI);
      this.fillTextWithDarkHalo(ctx, distKmStr, tx, ty + d + 16, diaCol);

      if (Math.sin(timeSec * 14) > -0.35) {
        ctx.font = font('display', Math.max(17, Math.round(21 * hudScale)));
        this.fillTextWithDarkHalo(
          ctx,
          '◆ SHOOT ◆',
          cx,
          cy - 54 * hudScale,
          pulse > 0.5 ? THEME.ACCENT_AMBER : THEME.ALERT_RED_TEXT
        );
        ctx.font = font('micro', 12);
        this.fillTextWithDarkHalo(
          ctx,
          '[RMB / SPACE] FOX-2',
          cx,
          cy - 34 * hudScale,
          THEME.ACCENT_AMBER_HI
        );
      }
    } else {
      const b = Math.max(18, Math.min(44, lockedTarget.radius * pt.scale + 10));
      const boxCol =
        sim.lockedTargetInSeeker && sim.missilesRemaining > 0 ? THEME.ACCENT_AMBER : classCol;

      this.strokeWithDarkHalo(
        ctx,
        () => {
          ctx.rect(tx - b, ty - b, b * 2, b * 2);
        },
        boxCol,
        2.1,
        [6, 4]
      );

      if (sim.lockProgress > 0.02 && sim.missilesRemaining > 0) {
        const barW = b * 2;
        ctx.fillStyle = 'rgba(2, 12, 6, 0.85)';
        ctx.fillRect(tx - b, ty + b + 4, barW, 4);
        ctx.fillStyle = THEME.ACCENT_AMBER;
        ctx.fillRect(tx - b, ty + b + 4, barW * sim.lockProgress, 4);
      }

      ctx.font = font('micro', 12);
      ctx.textAlign = 'center';
      this.fillTextWithDarkHalo(ctx, `TRK ${kindShort}`, tx, ty - b - 6, boxCol);
      this.fillTextWithDarkHalo(ctx, distKmStr, tx, ty + b + 20, THEME.TEXT_BRIGHT);
    }
    ctx.restore();
  }

  // ===========================================================================
  // LOWER COCKPIT CLUSTER: NOSTROMO ANNUNCIATOR STRIP + 3 CONSOLIDATED MFDS
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

    // Subtle Angled Outer Canopy Bow Struts
    ctx.strokeStyle = 'rgba(35, 140, 64, 0.32)';
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.moveTo(0, y + 6);
    ctx.lineTo(Math.min(54, w * 0.04), canopyVp.y);
    ctx.moveTo(w, y + 6);
    ctx.lineTo(w - Math.min(54, w * 0.04), canopyVp.y);
    ctx.stroke();

    // Physical 1979 Angled Glare-Shield Console Chassis
    const centerCrownRise = 18;
    ctx.fillStyle = THEME.BG_VOID;
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + 8);
    ctx.lineTo(x + w * 0.22, y);
    ctx.lineTo(x + w * 0.30, y - centerCrownRise);
    ctx.lineTo(x + w * 0.70, y - centerCrownRise);
    ctx.lineTo(x + w * 0.78, y);
    ctx.lineTo(x + w, y + 8);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 2.0;
    ctx.stroke();

    // Nostromo Backlit Glass Annunciator Strip (SAM | STALL | CEIL | PULL UP | CMDS)
    const lamps: AnnunciatorLamp[] = [
      {
        id: 'sam',
        label: sim.samIncomingActive
          ? 'SAM INB'
          : sim.samLockActive
            ? `SAM ${sim.samLockCountdownSec.toFixed(1)}S`
            : 'SAM',
        icon: sim.samIncomingActive || sim.samLockActive ? SEMIOTIC_ICONS.TRIANGLE : undefined,
        state: sim.samIncomingActive ? 'CRITICAL' : sim.samLockActive ? 'CAUTION' : 'OFF',
      },
      {
        id: 'stall',
        label: 'STALL',
        icon: sim.isStalling ? SEMIOTIC_ICONS.TRIANGLE : undefined,
        state: sim.isStalling ? 'CRITICAL' : 'OFF',
      },
      {
        id: 'ceil',
        label: sim.ceilingBreached ? `CEIL >${sim.sectorRadarCeilingM}` : 'CEIL',
        state: sim.ceilingBreached
          ? 'CRITICAL'
          : sim.raltM > sim.sectorRadarCeilingM - 25 && sim.phase === 'FLYING'
            ? 'CAUTION'
            : 'OFF',
      },
      {
        id: 'pullup',
        label: 'PULL UP',
        icon: sim.pullUpWarning ? SEMIOTIC_ICONS.TRIANGLE : undefined,
        state: sim.pullUpWarning ? 'CRITICAL' : 'OFF',
      },
      {
        id: 'cmds',
        label:
          sim.cmdsActiveTimer > 0
            ? `CMDS ${sim.cmdsActiveTimer.toFixed(1)}S`
            : `CMDS ${sim.cmdsRemaining}`,
        icon: sim.cmdsActiveTimer > 0 ? SEMIOTIC_ICONS.SHIELD : undefined,
        state:
          sim.cmdsActiveTimer > 0
            ? 'INFO'
            : sim.cmdsRemaining <= 0 && sim.phase === 'FLYING'
              ? 'CAUTION'
              : 'OFF',
      },
    ];

    const annW = Math.min(540, Math.max(300, Math.round(w * 0.48)));
    const annH = 26;
    const annX = Math.round(x + (w - annW) * 0.5);
    const annY = y - 15;
    drawAnnunciatorStrip(ctx, lamps, annX, annY, annW, annH, timeSec);

    // Consolidated 3 Cleaner, Taller MFDs (sitting cleanly above the 22px Controls Strip!):
    // MFD-1: RWR + SAM Threat | MFD-2: TFR + Purge Wave | MFD-3: THR/HULL Strip + SMS/CMDS + Canyon Radar
    const padX = Math.max(10, Math.round(w * 0.012));
    const gap = Math.max(8, Math.round(w * 0.009));
    const mfdY = y + 15;
    const mfdH = Math.max(118, h - 20);
    const totalInnerW = w - padX * 2 - gap * 2;

    const w1 = Math.floor(totalInnerW * 0.27);
    const w2 = Math.floor(totalInnerW * 0.33);
    const w3 = totalInnerW - w1 - w2;

    const mfd1: ViewportRect = { x: x + padX, y: mfdY, width: w1, height: mfdH };
    const mfd2: ViewportRect = { x: mfd1.x + w1 + gap, y: mfdY, width: w2, height: mfdH };
    const mfd3: ViewportRect = { x: mfd2.x + w2 + gap, y: mfdY, width: w3, height: mfdH };

    this.drawMfd1RwrAndThreat(ctx, sim, mfd1, timeSec);
    this.drawMfd2TfrAndPurge(ctx, sim, mfd2, timeSec);
    this.drawMfd3StoresRadarAndEngines(ctx, sim, mfd3, timeSec);

    ctx.restore();
  }

  /**
   * MFD-1: Circular F-16 ALR-56M RWR Scope + SAM Threat & G/AoA Readout Strip
   */
  private drawMfd1RwrAndThreat(
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
        ? THEME.ALERT_RED_STROKE
        : alertBorder
          ? THEME.ACCENT_AMBER
          : THEME.BORDER_SUBTLE;
    ctx.lineWidth = alertBorder ? 1.9 : 1.5;
    ctx.strokeRect(r.x, r.y, r.width, r.height);

    const hdrH = 22;
    ctx.fillStyle = 'rgba(8, 24, 14, 0.90)';
    ctx.fillRect(r.x + 1, r.y + 1, r.width - 2, hdrH);
    ctx.font = font('head', 13);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.textAlign = 'left';
    ctx.fillText('MFD-1 // RWR', r.x + 7, r.y + 16);
    ctx.textAlign = 'right';
    ctx.fillStyle = sim.samIncomingActive
      ? THEME.ALERT_RED_TEXT
      : sim.samLockActive || sim.ceilingBreached
        ? THEME.ACCENT_AMBER_HI
        : THEME.TEXT_PRIMARY;
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

    const innerH = r.height - hdrH - 6;
    const showSideStats = r.width >= 260;
    const scopeZoneW = showSideStats ? Math.floor(r.width * 0.56) : r.width;
    const scopeR = Math.max(30, Math.min(innerH * 0.46, (scopeZoneW - 14) * 0.46));
    const scx = r.x + scopeZoneW * 0.5;
    const scy = r.y + hdrH + 3 + innerH * 0.5;

    ctx.strokeStyle = 'rgba(68, 255, 119, 0.62)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(scx, scy, scopeR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 176, 0, 0.52)';
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

    ctx.strokeStyle = THEME.TEXT_BRIGHT;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(scx - 4.5, scy);
    ctx.lineTo(scx + 4.5, scy);
    ctx.moveTo(scx, scy - 5.5);
    ctx.lineTo(scx, scy + 4.5);
    ctx.stroke();

    const contacts = sim.getRwrContacts();
    ctx.font = font('data', 13);
    ctx.textAlign = 'center';
    for (const c of contacts) {
      const ex = scx + Math.sin(c.bearingRad) * (c.rangeNorm * scopeR);
      const ey = scy - Math.cos(c.bearingRad) * (c.rangeNorm * scopeR);
      const blinkOn = !c.flashing || Math.sin(timeSec * 16) > -0.25;
      if (!blinkOn && c.symbol === 'M') continue;

      const col =
        c.symbol === 'M'
          ? THEME.ALERT_RED_TEXT
          : c.symbol === 'S'
            ? c.lethal
              ? THEME.ALERT_RED_TEXT
              : '#FF7A45'
            : THEME.ACCENT_AMBER;

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

    if (showSideStats) {
      const sx = r.x + scopeZoneW + 4;
      const sw = r.x + r.width - sx - 8;
      ctx.strokeStyle = 'rgba(28, 92, 49, 0.55)';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(sx - 4, r.y + hdrH + 4);
      ctx.lineTo(sx - 4, r.y + r.height - 6);
      ctx.stroke();

      const rowStep = Math.min(26, Math.floor((innerH - 6) / 4));
      let ty = r.y + hdrH + 18;
      ctx.textAlign = 'left';
      ctx.font = font('micro', 12);

      const liveSams = sim.enemySams.filter((s) => s.decoyedByFlareId === null).length;
      ctx.fillStyle = liveSams > 0 ? THEME.ALERT_RED_TEXT : THEME.TEXT_SECONDARY;
      drawEllipsizedText(ctx, `INB SAM: ${liveSams}`, sx, ty, sw);
      ty += rowStep;

      const ceilMargin = Math.round(sim.sectorRadarCeilingM - sim.raltM);
      ctx.fillStyle =
        ceilMargin < 0
          ? THEME.ALERT_RED_TEXT
          : ceilMargin < 30
            ? THEME.ACCENT_AMBER_HI
            : THEME.TEXT_BRIGHT;
      drawEllipsizedText(
        ctx,
        ceilMargin < 0 ? `CEIL +${Math.abs(ceilMargin)}M` : `CEIL -${ceilMargin}M`,
        sx,
        ty,
        sw
      );
      ty += rowStep;

      ctx.fillStyle = sim.gLoad >= 6.0 ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT;
      drawEllipsizedText(ctx, `G ${sim.gLoad.toFixed(1)} / ${sim.peakGLoad.toFixed(1)}`, sx, ty, sw);
      ty += rowStep;

      ctx.fillStyle = sim.isStalling ? THEME.ALERT_RED_TEXT : THEME.TEXT_PRIMARY;
      drawEllipsizedText(ctx, `AoA ${sim.aoaDeg.toFixed(1)}°`, sx, ty, sw);
    }

    ctx.restore();
  }

  /**
   * MFD-2: Vertically Rescaled TFR Terrain Side-Profile (1.8KM) + Overhead Bridges + Purge Wave Bar
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
    ctx.strokeStyle = sim.purgeThermalAlert ? THEME.ACCENT_AMBER : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(r.x, r.y, r.width, r.height);

    const hdrH = 22;
    ctx.fillStyle = 'rgba(8, 24, 14, 0.90)';
    ctx.fillRect(r.x + 1, r.y + 1, r.width - 2, hdrH);
    ctx.font = font('head', 13);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.textAlign = 'left';
    ctx.fillText('MFD-2 // TFR & PURGE', r.x + 7, r.y + 16);
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.fillText(`1.8KM / C${ceilM}`, r.x + r.width - 7, r.y + 16);

    const purgeAreaH = 34;
    const plotX = r.x + 8;
    const plotY = r.y + hdrH + 4;
    const plotW = r.width - 16;
    const plotH = Math.max(46, r.height - hdrH - 8 - purgeAreaH);

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

    ctx.strokeStyle = 'rgba(28, 92, 49, 0.42)';
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

    ctx.beginPath();
    ctx.moveTo(plotX, plotY + plotH);
    for (let i = 0; i <= samples; i++) {
      const px = plotX + (i / samples) * plotW;
      const py = elevToY(heights[i]);
      ctx.lineTo(px, py);
    }
    ctx.lineTo(plotX + plotW, plotY + plotH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(26, 102, 52, 0.46)';
    ctx.fill();
    ctx.strokeStyle = THEME.TEXT_PRIMARY;
    ctx.lineWidth = 2.0;
    ctx.stroke();

    for (const a of visibleArches) {
      const ax = plotX + a.f * plotW;
      const yTop = elevToY(a.topY);
      const yBot = elevToY(a.deckY);
      const aw = Math.max(8, (36 / scanRange) * plotW);
      ctx.fillStyle = 'rgba(255, 176, 0, 0.34)';
      ctx.fillRect(ax - aw * 0.5, yTop, aw, Math.max(4, yBot - yTop));
      ctx.strokeStyle = THEME.ACCENT_AMBER;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ax - aw * 0.5, yTop, aw, Math.max(4, yBot - yTop));
    }

    const ceilLineY = elevToY(floorRef + ceilM);
    if (ceilLineY >= plotY + 2 && ceilLineY <= plotY + plotH - 4) {
      ctx.strokeStyle = sim.ceilingBreached ? THEME.ALERT_RED_STROKE : 'rgba(255, 176, 0, 0.78)';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(plotX, ceilLineY);
      ctx.lineTo(plotX + plotW, ceilLineY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const shipPy = elevToY(sim.y);
    const horizSpd = Math.max(20, Math.hypot(sim.vx, sim.vz));
    const endAlt = sim.y + (sim.vy / horizSpd) * scanRange;
    const endPy = elevToY(endAlt);

    ctx.strokeStyle = sim.pullUpWarning ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.7;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(plotX + 9, shipPy);
    ctx.lineTo(plotX + plotW, endPy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.beginPath();
    ctx.moveTo(plotX + 12, shipPy);
    ctx.lineTo(plotX + 3, shipPy - 5);
    ctx.lineTo(plotX + 3, shipPy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Horizontal Atmospheric Purge Wave Tail Proximity Bar (Zero 720p clipping!)
    const barTop = plotY + plotH + 4;
    const distM = Math.round(sim.purgeDistanceM);
    const proxNorm = Math.max(0, Math.min(1, 1 - distM / 1200));
    const dangerFlash = distM < 220 && Math.sin(timeSec * 15) > 0;
    const pCol = dangerFlash
      ? THEME.ALERT_RED_TEXT
      : distM < 450
        ? THEME.ACCENT_AMBER
        : THEME.TEXT_PRIMARY;

    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = pCol;
    ctx.fillText(`PURGE -${distM}M`, plotX, barTop + 11);
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.fillText(`WAVE M${sim.purgeMach.toFixed(2)}`, plotX + plotW, barTop + 11);

    const barH = 9;
    const barY = Math.min(r.y + r.height - barH - 5, barTop + 17);
    ctx.fillStyle = 'rgba(12, 26, 16, 0.92)';
    ctx.fillRect(plotX, barY, plotW, barH);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.1;
    ctx.strokeRect(plotX, barY, plotW, barH);
    ctx.fillStyle = pCol;
    ctx.fillRect(plotX + 1, barY + 1, Math.max(2, (plotW - 2) * proxNorm), barH - 2);

    ctx.restore();
  }

  /**
   * MFD-3: Slim Vertical THR/HULL Strip + SMS Stores/CMDS + Top-Down Canyon Radar (Zero 720p clipping!)
   */
  private drawMfd3StoresRadarAndEngines(
    ctx: CanvasRenderingContext2D,
    sim: TrenchSimulation,
    r: ViewportRect,
    timeSec: number
  ): void {
    ctx.save();
    ctx.fillStyle = '#020804';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    const hullPct = Math.round((sim.hull / TRENCH_CONSTANTS.HULL_MAX) * 100);
    ctx.strokeStyle =
      hullPct <= 35
        ? THEME.ALERT_RED_STROKE
        : sim.lockState === 'LOCKED'
          ? THEME.ACCENT_AMBER
          : THEME.BORDER_SUBTLE;
    ctx.lineWidth = hullPct <= 35 || sim.lockState === 'LOCKED' ? 1.8 : 1.6;
    ctx.strokeRect(r.x, r.y, r.width, r.height);

    const hdrH = 22;
    ctx.fillStyle = 'rgba(8, 24, 14, 0.90)';
    ctx.fillRect(r.x + 1, r.y + 1, r.width - 2, hdrH);
    ctx.font = font('head', 13);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.textAlign = 'left';
    ctx.fillText('MFD-3 // SMS · RADAR', r.x + 7, r.y + 16);
    ctx.textAlign = 'right';
    ctx.fillStyle = hullPct <= 35 ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER_HI;
    ctx.fillText(`GUN ${sim.gunAmmo} · HUL ${hullPct}%`, r.x + r.width - 7, r.y + 16);

    const innerY = r.y + hdrH + 4;
    const innerH = r.height - hdrH - 8;

    // --- ZONE A: Slim Vertical THR / HULL Strip on left ---
    const stripW = Math.max(46, Math.min(58, Math.round(r.width * 0.14)));
    const stripX = r.x + 6;
    const barTop = innerY + 2;
    const barH = Math.max(44, innerH - 18);
    const barW = Math.max(14, Math.floor((stripW - 10) * 0.5));
    const thrBarX = stripX + 2;
    const hullBarX = thrBarX + barW + 6;

    // THR vertical bar (MIL detent + AB cap)
    ctx.fillStyle = 'rgba(10, 26, 16, 0.92)';
    ctx.fillRect(thrBarX, barTop, barW, barH);
    ctx.strokeStyle = sim.afterburning ? THEME.ACCENT_AMBER : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(thrBarX, barTop, barW, barH);

    const milFrac = 1.0 / TRENCH_CONSTANTS.MAX_THROTTLE;
    const milY = barTop + barH * (1 - milFrac);
    const fillFrac = Math.max(0, Math.min(1, sim.throttle / TRENCH_CONSTANTS.MAX_THROTTLE));
    const fillH = Math.max(2, barH * fillFrac);
    const milPx = barH * milFrac;
    const greenH = Math.min(fillH, milPx);
    ctx.fillStyle = THEME.TEXT_PRIMARY;
    ctx.fillRect(thrBarX + 2, barTop + barH - greenH, barW - 4, greenH);
    if (fillH > milPx) {
      ctx.fillStyle = THEME.ACCENT_AMBER;
      ctx.fillRect(thrBarX + 2, barTop + barH - fillH, barW - 4, fillH - milPx);
    }
    ctx.strokeStyle = THEME.ACCENT_AMBER_HI;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(thrBarX - 2, milY);
    ctx.lineTo(thrBarX + barW + 2, milY);
    ctx.stroke();

    // HULL vertical bar
    const hullCol =
      hullPct <= 35 ? THEME.ALERT_RED_STROKE : hullPct <= 65 ? THEME.ACCENT_AMBER : THEME.TEXT_PRIMARY;
    ctx.fillStyle = 'rgba(10, 26, 16, 0.92)';
    ctx.fillRect(hullBarX, barTop, barW, barH);
    ctx.strokeStyle = hullPct <= 35 ? THEME.ALERT_RED_STROKE : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(hullBarX, barTop, barW, barH);

    const hullFillH = Math.max(0, (barH - 4) * (hullPct / 100));
    ctx.fillStyle = hullCol;
    ctx.fillRect(hullBarX + 2, barTop + barH - 2 - hullFillH, barW - 4, hullFillH);

    // Bottom labels for slim vertical THR / HUL bars (>=12px!)
    ctx.font = font('micro', 12);
    ctx.textAlign = 'center';
    ctx.fillStyle = sim.afterburning ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT;
    ctx.fillText('T', thrBarX + barW * 0.5, innerY + innerH - 3);
    ctx.fillStyle = hullPct <= 35 ? THEME.ALERT_RED_TEXT : THEME.TEXT_BRIGHT;
    ctx.fillText('H', hullBarX + barW * 0.5, innerY + innerH - 3);

    const afterStripX = stripX + stripW + 4;
    ctx.strokeStyle = 'rgba(28, 92, 49, 0.52)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(afterStripX, innerY);
    ctx.lineTo(afterStripX, innerY + innerH);
    ctx.stroke();

    // --- ZONE B: SMS Wing-Pylon Missiles + 8x CMDS Charge Pips ---
    const remW = r.x + r.width - afterStripX - 6;
    const smsW = Math.floor(remW * 0.52);
    const splitX = afterStripX + smsW;

    ctx.beginPath();
    ctx.moveTo(splitX, innerY);
    ctx.lineTo(splitX, innerY + innerH);
    ctx.stroke();

    const scx = afterStripX + smsW * 0.5;
    const cmdsBlockH = 30;
    const wingZoneH = Math.max(46, innerH - cmdsBlockH);
    const wingY = innerY + Math.round(wingZoneH * 0.42);
    const wingSpan = Math.min((smsW - 14) * 0.48, 88);

    ctx.strokeStyle = 'rgba(68, 255, 119, 0.48)';
    ctx.fillStyle = 'rgba(14, 48, 26, 0.28)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(scx, wingY - 14);
    ctx.lineTo(scx + 6, wingY - 3);
    ctx.lineTo(scx + wingSpan, wingY + 8);
    ctx.lineTo(scx + wingSpan, wingY + 13);
    ctx.lineTo(scx + 8, wingY + 11);
    ctx.lineTo(scx + 4, wingY + 18);
    ctx.lineTo(scx - 4, wingY + 18);
    ctx.lineTo(scx - 8, wingY + 11);
    ctx.lineTo(scx - wingSpan, wingY + 13);
    ctx.lineTo(scx - wingSpan, wingY + 8);
    ctx.lineTo(scx - 6, wingY - 3);
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
    const pylonYs = [10, 7, 4, 4, 7, 10];
    const mLen = Math.max(15, Math.min(24, wingZoneH * 0.34));
    const lockPulse = sim.lockState === 'LOCKED' && Math.sin(timeSec * 14) > 0;

    for (let idx = 0; idx < 6; idx++) {
      const loaded = sim.missileSlots[idx];
      const mx = scx + pylonXs[idx];
      const my = wingY + pylonYs[idx];
      const topY = my - mLen * 0.32;
      const botY = my + mLen * 0.68;
      const col = loaded
        ? lockPulse
          ? THEME.ACCENT_AMBER_HI
          : idx === 0 || idx === 5
            ? THEME.ACCENT_AMBER
            : THEME.TEXT_PRIMARY
        : 'rgba(78, 138, 98, 0.36)';

      ctx.strokeStyle = col;
      ctx.fillStyle = loaded ? 'rgba(68, 255, 119, 0.22)' : 'transparent';
      ctx.lineWidth = loaded ? 1.65 : 1.0;

      ctx.beginPath();
      ctx.moveTo(mx, topY);
      ctx.lineTo(mx + 2.2, topY + 4.5);
      ctx.lineTo(mx + 2.2, botY);
      ctx.lineTo(mx - 2.2, botY);
      ctx.lineTo(mx - 2.2, topY + 4.5);
      ctx.closePath();
      if (loaded) ctx.fill();
      ctx.stroke();

      if (!loaded) {
        ctx.strokeStyle = 'rgba(255, 98, 71, 0.85)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(mx - 5, topY + 1);
        ctx.lineTo(mx + 5, botY + 1);
        ctx.moveTo(mx + 5, topY + 1);
        ctx.lineTo(mx - 5, botY + 1);
        ctx.stroke();
      }
    }

    // 8x CMDS Chaff / Flare Charge Pips cleanly tucked at bottom of Zone B
    const cmdsX0 = afterStripX + 6;
    const cmdsAvailW = Math.max(52, smsW - 12);
    const cmdsLabelY = innerY + innerH - 18;
    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = sim.cmdsRemaining > 0 ? THEME.ACCENT_CYAN : THEME.ALERT_RED_TEXT;
    drawEllipsizedText(ctx, `CMDS ${sim.cmdsRemaining}/8`, cmdsX0, cmdsLabelY, cmdsAvailW);

    const pipGap = 3;
    const pipW = Math.max(6, Math.floor((cmdsAvailW - pipGap * 7) / 8));
    const pipY = innerY + innerH - 12;
    for (let k = 0; k < TRENCH_CONSTANTS.CMDS_MAX_COUNT; k++) {
      const px = cmdsX0 + k * (pipW + pipGap);
      const charged = k < sim.cmdsRemaining;
      ctx.fillStyle = charged
        ? sim.cmdsCooldown > 0
          ? 'rgba(255, 176, 0, 0.55)'
          : THEME.ACCENT_AMBER
        : 'rgba(18, 36, 24, 0.85)';
      ctx.fillRect(px, pipY, pipW, 10);
      ctx.strokeStyle = charged ? THEME.ACCENT_AMBER_HI : 'rgba(78, 138, 98, 0.42)';
      ctx.lineWidth = 1.0;
      ctx.strokeRect(px, pipY, pipW, 10);
    }

    // --- ZONE C: Heading-Up Top-Down Canyon Radar ---
    const plotX = splitX + 5;
    const plotY = innerY;
    const plotW = Math.max(40, r.x + r.width - splitX - 10);
    const plotH = innerH;
    const mapCx = plotX + plotW * 0.5;
    const mapCy = plotY + plotH * 0.82;
    const scale = Math.min(plotW / 1850, plotH / 3200);

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotW, plotH);
    ctx.clip();

    ctx.strokeStyle = 'rgba(28, 92, 49, 0.48)';
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
      ctx.strokeStyle = THEME.TEXT_SECONDARY;
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
        // Ron Cobb Diamond + Cross (◈ / ✚) radar blip (distinct even in P3 AMBER!)
        ctx.strokeStyle = THEME.ACCENT_CYAN;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(pt.x - 4.2, pt.y);
        ctx.lineTo(pt.x + 4.2, pt.y);
        ctx.moveTo(pt.x, pt.y - 4.2);
        ctx.lineTo(pt.x, pt.y + 4.2);
        ctx.stroke();
      } else if (t.kind === 'SAM_SITE') {
        ctx.fillStyle = isLocked
          ? THEME.ACCENT_AMBER_HI
          : `rgba(255, 51, 24, ${blipPulse.toFixed(2)})`;
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y - 3.6);
        ctx.lineTo(pt.x + 3.6, pt.y);
        ctx.lineTo(pt.x, pt.y + 3.6);
        ctx.lineTo(pt.x - 3.6, pt.y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.strokeStyle = isLocked ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(pt.x - 3.6, pt.y + 2.5);
        ctx.lineTo(pt.x, pt.y - 3.4);
        ctx.lineTo(pt.x + 3.6, pt.y + 2.5);
        ctx.stroke();
      }

      if (isLocked) {
        ctx.strokeStyle =
          sim.lockState === 'LOCKED' ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
        ctx.lineWidth = 1.3;
        ctx.strokeRect(pt.x - 5.5, pt.y - 5.5, 11, 11);
      }
    }

    for (const m of sim.missiles) {
      const pt = toRadar(m.x, m.z);
      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of sim.enemySams) {
      const pt = toRadar(s.x, s.z);
      ctx.fillStyle = THEME.ALERT_RED_STROKE;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = THEME.ACCENT_AMBER_HI;
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

  // ===========================================================================
  // TITLE SCREEN DIET: 3-COLUMN KEYCAP CARD + PITCH MODE + FREE-FLIGHT DRILL
  // ===========================================================================
  private drawTitleOverlay(
    ctx: CanvasRenderingContext2D,
    params: TrenchHudRenderParams,
    vp: ViewportRect
  ): void {
    const cx = vp.x + vp.width * 0.5;
    const cy = vp.y + vp.height * 0.5;
    const boxW = Math.min(780, vp.width - 28);
    const boxH = Math.min(486, vp.height - 10);
    const bx = Math.round(cx - boxW * 0.5);
    const by = Math.round(cy - boxH * 0.5);
    const compact = boxH < 448;
    const padX = 20;
    const contentW = boxW - padX * 2;

    ctx.save();
    ctx.fillStyle = THEME.BG_PANEL;
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);
    drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, THEME.ACCENT_AMBER, 2.6);

    // 1. Official Ranked Ribbon (diegetic — zero backend table name leaks!)
    drawRankedTitleRibbon(
      ctx,
      bx + padX,
      by + 10,
      contentW,
      24,
      `${SEMIOTIC_ICONS.STAR} OFFICIAL RANKED SORTIE — ORBITAL RELAY TELEMETRY ACTIVE ${SEMIOTIC_ICONS.STAR}`,
      params.timeSec,
      true
    );

    // 2. Program Title
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font('display', compact ? 21 : 24);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    drawEllipsizedText(ctx, 'DERELICT TRENCH // VECTOR RUN', cx, by + 52, contentW);

    // 3. Touch Device Warning OR #01 Orbital Leader Strip
    const stripY = by + (compact ? 68 : 72);
    const stripH = 28;
    if (params.isTouchDevice) {
      ctx.fillStyle = THEME.ALERT_RED_BG;
      ctx.fillRect(bx + padX, stripY, contentW, stripH);
      ctx.strokeStyle = THEME.ALERT_RED_STROKE;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx + padX + 0.5, stripY + 0.5, contentW - 1, stripH - 1);
      ctx.font = font('head', 13);
      ctx.fillStyle = '#FFF0EC';
      drawEllipsizedText(
        ctx,
        `${SEMIOTIC_ICONS.TRIANGLE} DESKTOP MOUSE + KEYBOARD REQUIRED FOR FULL FLIGHT CONTROL`,
        cx,
        stripY + stripH * 0.5 + 0.5,
        contentW - 16
      );
    } else {
      const top = params.leaderboard.getTopLeader();
      const st = params.leaderboard.getStatus();
      ctx.fillStyle = THEME.ACCENT_AMBER_BG;
      ctx.fillRect(bx + padX, stripY, contentW, stripH);
      ctx.strokeStyle = THEME.ACCENT_AMBER;
      ctx.lineWidth = 1.3;
      ctx.strokeRect(bx + padX + 0.5, stripY + 0.5, contentW - 1, stripH - 1);
      ctx.font = font('data', 13);
      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      const leaderTxt = top
        ? `${SEMIOTIC_ICONS.STAR} #01 LEADER: ${top.callsign} · ${top.score.toLocaleString()} PTS (${top.distance.toLocaleString()}M · M${top.maxMach.toFixed(1)})`
        : st === 'LOADING'
          ? 'SYNCING ORBITAL RELAY TELEMETRY...'
          : 'ORBITAL RECORD UNCLAIMED — FIRST SORTIE OPEN';
      drawEllipsizedText(ctx, leaderTxt, cx, stripY + stripH * 0.5 + 0.5, contentW - 16);
    }

    // 4. Scannable 3-Column Keycap Card (`FLIGHT` | `WEAPONS` | `SURVIVE`)
    const cardY = stripY + stripH + (compact ? 8 : 10);
    const cardH = compact ? 124 : 138;
    const colGap = 10;
    const colW = Math.floor((contentW - colGap * 2) / 3);

    const columns: ReadonlyArray<{
      title: string;
      accent: string;
      rows: ReadonlyArray<{ key: string; label: string; keyAccent?: string }>;
    }> = [
      {
        title: 'FLIGHT',
        accent: THEME.TEXT_PRIMARY,
        rows: [
          { key: 'MOUSE', label: 'Roll & Pitch Stick' },
          { key: 'W / S', label: 'Throttle 0–120% AB' },
          { key: 'A / D', label: 'Yaw · [I] Invert' },
        ],
      },
      {
        title: 'WEAPONS',
        accent: THEME.ACCENT_AMBER,
        rows: [
          { key: 'LMB', label: '20mm Vulcan Gun' },
          { key: 'RMB/SPC', label: '0.35s AIM-9 Lock' },
          { key: 'TAB/MMB', label: 'Cycle Target' },
        ],
      },
      {
        title: 'SURVIVE',
        accent: THEME.ACCENT_CYAN,
        rows: [
          { key: 'C / F', label: 'CMDS Chaff/Flares', keyAccent: THEME.ACCENT_CYAN },
          { key: '<190M', label: 'Stay Under Ceiling', keyAccent: THEME.ACCENT_AMBER },
          {
            key: `${SEMIOTIC_ICONS.DIAMOND}${SEMIOTIC_ICONS.CROSS}`,
            label: 'Shoot/Fly Resupply',
            keyAccent: THEME.ACCENT_CYAN,
          },
        ],
      },
    ];

    columns.forEach((col, ci) => {
      const colX = bx + padX + ci * (colW + colGap);
      const cw = ci === 2 ? contentW - (colW + colGap) * 2 : colW;
      ctx.fillStyle = THEME.BG_ROW_ALT;
      ctx.fillRect(colX, cardY, cw, cardH);
      ctx.strokeStyle = THEME.BORDER_SUBTLE;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(colX + 0.5, cardY + 0.5, cw - 1, cardH - 1);

      ctx.font = font('head', 13);
      ctx.fillStyle = col.accent;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(col.title, colX + 10, cardY + 15);

      ctx.strokeStyle = THEME.BORDER_SUBTLE;
      ctx.beginPath();
      ctx.moveTo(colX + 8, cardY + 26);
      ctx.lineTo(colX + cw - 8, cardY + 26);
      ctx.stroke();

      const rowStep = Math.floor((cardH - 32) / 3);
      col.rows.forEach((row, ri) => {
        const ry = cardY + 42 + ri * rowStep;
        const capW = drawKeycap(ctx, row.key, colX + 8, ry, {
          height: 20,
          fontPx: 12,
          padX: 5,
          accent: row.keyAccent ?? THEME.ACCENT_AMBER,
          textColor: row.keyAccent ?? THEME.ACCENT_AMBER_HI,
          centerY: true,
        });
        ctx.font = font('micro', 12);
        ctx.fillStyle = THEME.TEXT_BRIGHT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const lx = colX + 8 + capW + 7;
        drawEllipsizedText(ctx, row.label, lx, ry + 0.5, Math.max(24, colX + cw - 8 - lx));
      });
    });

    // 5. Upfront Mouse Pitch Selector Row (Default: PULL BACK = UP vs PUSH UP = UP)
    const pitchY = cardY + cardH + (compact ? 8 : 10);
    const pitchH = 34;
    const pitchLabelW = 138;
    const pitchBtnGap = 8;
    const pitchBtnW = Math.floor((contentW - pitchLabelW - pitchBtnGap) * 0.5);

    ctx.fillStyle = 'rgba(6, 18, 11, 0.88)';
    ctx.fillRect(bx + padX, pitchY, contentW, pitchH);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(bx + padX + 0.5, pitchY + 0.5, contentW - 1, pitchH - 1);

    ctx.font = font('data', 12);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('MOUSE PITCH [I]:', bx + padX + 10, pitchY + pitchH * 0.5 + 0.5);

    const isPushUp = params.sim.invertPitch;
    drawChromeButton(
      ctx,
      { x: bx + padX + pitchLabelW, y: pitchY + 3, width: pitchBtnW, height: pitchH - 6 },
      'PULL BACK = UP',
      {
        id: TRENCH_UI_IDS.PITCH_SIM,
        accent: !isPushUp ? 'amber' : 'muted',
        active: !isPushUp,
        hovered: params.hoveredButtonId === TRENCH_UI_IDS.PITCH_SIM,
        fontPx: 12,
      },
      this.buttons
    );
    drawChromeButton(
      ctx,
      {
        x: bx + padX + pitchLabelW + pitchBtnW + pitchBtnGap,
        y: pitchY + 3,
        width: contentW - pitchLabelW - pitchBtnW - pitchBtnGap - 3,
        height: pitchH - 6,
      },
      'PUSH UP = UP',
      {
        id: TRENCH_UI_IDS.PITCH_ARCADE,
        accent: isPushUp ? 'green' : 'muted',
        active: isPushUp,
        hovered: params.hoveredButtonId === TRENCH_UI_IDS.PITCH_ARCADE,
        fontPx: 12,
      },
      this.buttons
    );

    // 6. Super-Obvious 1979 CRT 1.5X Ranked Score Challenge Toggle Banner
    const bonusY = pitchY + pitchH + (compact ? 6 : 8);
    const bonusH = compact ? 30 : 34;
    const crt1979On = params.crtPreset === 'CLASSIC_1979';
    draw1979RankedBonusBanner(
      ctx,
      { x: bx + padX, y: bonusY, width: contentW, height: bonusH },
      crt1979On,
      params.hoveredButtonId,
      params.timeSec,
      this.buttons,
      { compact }
    );

    // 7. Pointer-Lock Handshake Caption
    const handY = bonusY + bonusH + (compact ? 9 : 11);
    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawEllipsizedText(
      ctx,
      params.isTouchDevice
        ? 'Connect a desktop mouse + keyboard for Pointer Lock flight control.'
        : 'Click LAUNCH to engage Pointer Lock flight stick — press [ESC] anytime to unlock & open Menu.',
      cx,
      handY,
      contentW
    );

    // 8. Primary Launch Row: RANKED SORTIE + FREE-FLIGHT DRILL (UNRANKED)
    const launchY = handY + (compact ? 11 : 13);
    const launchH = compact ? 38 : 42;
    const launchGap = 10;
    const rankedW = Math.floor((contentW - launchGap) * 0.54);
    const drillW = contentW - launchGap - rankedW;

    drawChromeButton(
      ctx,
      { x: bx + padX, y: launchY, width: rankedW, height: launchH },
      crt1979On
        ? `${SEMIOTIC_ICONS.PLAY} LAUNCH RANKED [1.5X 1979]`
        : `${SEMIOTIC_ICONS.PLAY} LAUNCH RANKED SORTIE [ENTER]`,
      {
        id: TRENCH_UI_IDS.START_RANKED,
        accent: 'amber',
        active: true,
        hovered: params.hoveredButtonId === TRENCH_UI_IDS.START_RANKED,
        fontPx: 14,
      },
      this.buttons
    );

    drawChromeButton(
      ctx,
      { x: bx + padX + rankedW + launchGap, y: launchY, width: drillW, height: launchH },
      `${SEMIOTIC_ICONS.DIAMOND} FREE-FLIGHT DRILL (UNRANKED)`,
      {
        id: TRENCH_UI_IDS.START_DRILL,
        accent: 'cyan',
        hovered: params.hoveredButtonId === TRENCH_UI_IDS.START_DRILL,
        fontPx: 13,
      },
      this.buttons
    );

    // 8. Secondary Utility Row (Controls Quick-Card | Global Manifest | System Menu)
    const utilY = launchY + launchH + 8;
    const utilH = Math.max(28, Math.min(34, by + boxH - utilY - 10));
    if (utilH >= 28) {
      const utilGap = 8;
      const utilW = Math.floor((contentW - utilGap * 2) / 3);
      drawChromeButton(
        ctx,
        { x: bx + padX, y: utilY, width: utilW, height: utilH },
        '[H] CONTROLS CARD',
        {
          id: TRENCH_UI_IDS.TITLE_CONTROLS,
          accent: 'cyan',
          hovered: params.hoveredButtonId === TRENCH_UI_IDS.TITLE_CONTROLS,
          fontPx: 12,
        },
        this.buttons
      );
      drawChromeButton(
        ctx,
        { x: bx + padX + utilW + utilGap, y: utilY, width: utilW, height: utilH },
        `${SEMIOTIC_ICONS.STAR} LEADERBOARD`,
        {
          id: TRENCH_UI_IDS.TITLE_MANIFEST,
          accent: 'green',
          hovered: params.hoveredButtonId === TRENCH_UI_IDS.TITLE_MANIFEST,
          fontPx: 12,
        },
        this.buttons
      );
      drawChromeButton(
        ctx,
        {
          x: bx + padX + (utilW + utilGap) * 2,
          y: utilY,
          width: contentW - (utilW + utilGap) * 2,
          height: utilH,
        },
        '[ESC] SYSTEM MENU',
        {
          id: TRENCH_UI_IDS.TITLE_MENU,
          accent: 'muted',
          hovered: params.hoveredButtonId === TRENCH_UI_IDS.TITLE_MENU,
          fontPx: 12,
        },
        this.buttons
      );
    }

    ctx.restore();
  }

  // ===========================================================================
  // SHARED MODALS (SystemMenuModal, ControlsOverlay, PostRunFlow)
  // ===========================================================================
  private drawUnifiedSystemMenu(
    ctx: CanvasRenderingContext2D,
    params: TrenchHudRenderParams
  ): void {
    const { sim } = params;
    const extraRows: SystemMenuExtraRow[] = [
      {
        id: TRENCH_UI_IDS.TOGGLE_INVERT,
        label: 'MOUSE PITCH [I]',
        value: sim.invertPitch ? '[ PUSH UP = UP ]' : '[ PULL BACK = UP ]',
        accent: sim.invertPitch ? 'green' : 'amber',
      },
      {
        id: TRENCH_UI_IDS.CYCLE_SENS,
        label: 'STICK SENSITIVITY',
        value: `[ ${params.stickSensitivityLabel} ]`,
        accent: 'cyan',
      },
      {
        id: TRENCH_UI_IDS.START_DRILL,
        label: 'FREE-FLIGHT DRILL (UNRANKED)',
        value: sim.freeFlightDrill ? '[ RESTART DRILL ]' : '[ LAUNCH DRILL ]',
        accent: 'cyan',
      },
    ];

    drawSystemMenuModal(
      ctx,
      params.width,
      params.height,
      {
        programTitle: 'DERELICT TRENCH',
        activeProgramId: 'trench',
        crtPreset: params.crtPreset,
        crtModeLocked: params.crtModeLocked,
        phosphorTheme: params.phosphorTheme,
        masterVolume: params.masterVolume,
        audioMuted: params.audioMuted,
        isFullscreen: params.isFullscreen,
        hoveredButtonId: params.hoveredButtonId,
        extraRows,
        canRestart: sim.phase !== 'TITLE',
        canReturnToGameMenu: sim.phase !== 'TITLE',
        confirmGameMenuPending: params.confirmGameMenuPending,
        restartLabel: `${SEMIOTIC_ICONS.REPLAY} RESTART SORTIE`,
        leaderboardLabel: `${SEMIOTIC_ICONS.STAR} LEADERBOARD`,
        confirmExitPending: params.confirmExitPending,
      },
      this.buttons
    );
  }

  private drawUnifiedControlsCard(
    ctx: CanvasRenderingContext2D,
    params: TrenchHudRenderParams
  ): void {
    const spec: ControlsCardSpec = {
      programTitle: 'DERELICT TRENCH',
      leftColumnTitle: 'FLIGHT & HOTAS STICK',
      leftControls: [
        { keys: 'MOUSE', action: 'Virtual stick Roll & Pitch (Click locks)' },
        { keys: 'ARROWS', action: 'Keyboard Pitch & Roll fallback' },
        { keys: 'W / S', action: 'Throttle (0% IDLE – 100% MIL – 120% AB)' },
        { keys: 'A / D', action: 'Rudder Yaw left / right' },
        { keys: 'I', action: 'Invert Pitch (Pull Back = UP / Push Up = UP)' },
      ],
      rightColumnTitle: 'WEAPONS, CMDS & SYSTEM',
      rightControls: [
        { keys: 'LMB', action: 'Fire M61A1 20mm Vulcan Cannon' },
        { keys: 'RMB / SPC', action: 'Fire locked AIM-9 Missile (0.35s lock)' },
        { keys: 'TAB / MMB', action: 'Cycle Target Lock (SAM / Bandit / Pod)' },
        { keys: 'C / F', action: 'Deploy CMDS Chaff & Flare Salvo (2.5s safe)' },
        { keys: 'P / M / ESC', action: 'Pause · Audio Mute · System Menu' },
      ],
      coreRules: [
        'Stay below the Sector Radar Ceiling (190M in SEC-01) or mask behind mesas to break SAM locks.',
        'Fly fast below 60M RALT for up to 2.5x NOE bonus while staying ahead of the Purge Wave.',
        'Shoot or fly through Cyan ◈✚ Resupply Pods for +2 Missiles, +150 20mm rounds, and +2 CMDS.',
      ],
      hoveredButtonId: params.hoveredButtonId,
    };

    drawControlsCardModal(ctx, params.width, params.height, spec, this.buttons);
  }

  private drawUnifiedGameOverDebrief(
    ctx: CanvasRenderingContext2D,
    params: TrenchHudRenderParams
  ): void {
    const { sim } = params;
    const isRanked = !sim.freeFlightDrill;
    drawGameOverDebriefModal(
      ctx,
      params.width,
      params.height,
      {
        title: isRanked
          ? `AIRFRAME LOST // ${sim.lastDeathCause}`
          : `FREE-FLIGHT DRILL ENDED // ${sim.lastDeathCause}`,
        subtitle: isRanked
          ? `${sim.sectorId} · SECTORS CLEARED: ${sim.sectorsCleared} · PEAK G: ${sim.peakGLoad.toFixed(1)}G`
          : 'UNRANKED FLIGHT DRILL — LAUNCH RANKED SORTIE TO RECORD ORBITAL SCORES',
        outcomeTone: isRanked ? 'red' : 'amber',
        timeSec: params.timeSec,
        keylockRemainingSec: sim.gameOverLockoutTimer,
        stats: [
          {
            label: 'FINAL SCORE',
            value: Math.round(sim.score).toLocaleString(),
            accent: 'amber',
          },
          {
            label: 'DISTANCE',
            value: `${Math.round(sim.distanceFlownM).toLocaleString()}M`,
            accent: 'green',
          },
          {
            label: 'MAX MACH',
            value: `M ${sim.maxMach.toFixed(1)}`,
            accent: 'amber',
          },
          {
            label: 'KILLS',
            value: String(sim.targetsDestroyed),
            accent: 'cyan',
          },
        ],
        isRanked,
        score: Math.round(sim.score),
        callsignDraft: params.callsignDraft,
        callsignEditing: params.callsignEditing,
        scoreSubmitted: params.scoreSubmitted,
        submittingScore: params.submittingScore,
        statusBanner: params.submitResultBanner,
        statusBannerTone: params.submitResultTone,
        hoveredButtonId: params.hoveredButtonId,
        playAgainLabel: isRanked
          ? `${SEMIOTIC_ICONS.REPLAY} PLAY AGAIN [R]`
          : `${SEMIOTIC_ICONS.REPLAY} RETRY DRILL [R]`,
        showViewManifestButton: true,
      },
      this.buttons
    );
  }

  private drawUnifiedManifest(
    ctx: CanvasRenderingContext2D,
    params: TrenchHudRenderParams
  ): void {
    const { leaderboard, lastSubmittedRun } = params;
    const rawStatus = leaderboard.getStatus();
    const uplinkStatus: UplinkStatus =
      rawStatus === 'LIVE' ? 'LIVE' : rawStatus === 'LOADING' ? 'SYNCING' : 'LOCAL';

    const entries = leaderboard.getEntries();
    const rows: ManifestRowData[] = entries.map((e, idx) => {
      const isJustAdded = Boolean(
        lastSubmittedRun &&
          ((lastSubmittedRun.docId && e.id === lastSubmittedRun.docId) ||
            (e.callsign === lastSubmittedRun.callsign &&
              e.score === lastSubmittedRun.score &&
              e.distance === lastSubmittedRun.distance))
      );
      return {
        rank: idx + 1,
        callsign: e.callsign,
        score: e.score,
        stats: [`${e.distance.toLocaleString()}M`, `M${e.maxMach.toFixed(1)}`, String(e.grazes)],
        isJustAdded,
        isLocalFallback: e.isArchiveFallback,
      };
    });

    const justAddedBanner = lastSubmittedRun
      ? `${SEMIOTIC_ICONS.STAR} RECORD LOGGED: #${lastSubmittedRun.rank} ${lastSubmittedRun.callsign} — ${lastSubmittedRun.score.toLocaleString()} PTS (${lastSubmittedRun.distance.toLocaleString()}M · M${lastSubmittedRun.maxMach.toFixed(1)})`
      : null;

    drawGlobalManifestModal(
      ctx,
      params.width,
      params.height,
      {
        title: 'DERELICT TRENCH // LEADERBOARD',
        uplinkStatus,
        timeSec: params.timeSec,
        columns: [
          { header: 'DIST', widthFrac: 0.40, align: 'right' },
          { header: 'MAX M', widthFrac: 0.30, align: 'right' },
          { header: 'KILLS', widthFrac: 0.30, align: 'right' },
        ],
        rows,
        justAddedBanner,
        showPlayAgain: params.sim.phase !== 'FLYING',
        playAgainLabel: `${SEMIOTIC_ICONS.PLAY} PLAY AGAIN [R / ENTER]`,
        closeLabel: '[ESC] CLOSE',
        hoveredButtonId: params.hoveredButtonId,
      },
      this.buttons
    );
  }
}
