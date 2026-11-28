import {
  CONTROLS_STRIP_HEIGHT,
  draw1979RankedBonusBanner,
  drawChromeButton,
  drawControlsCardModal,
  drawCornerBrackets,
  drawEllipsizedText,
  drawGameOverDebriefModal,
  drawGlobalManifestModal,
  drawModalFrame,
  drawPauseBanner,
  drawPersistentControlsStrip,
  drawStatusToast,
  drawSystemMenuModal,
  drawTopChromeBar,
  font,
  hitTestChromeButtons,
  SEMIOTIC_ICONS,
  THEME,
  TOP_CHROME_BAR_HEIGHT,
  wrapTextLines,
  type ChromeButtonHitbox,
  type ControlsCardSpec,
  type ControlsStripItem,
  type DebriefStatCard,
  type ManifestRowData,
  type UplinkStatus,
} from '../../render/chrome';
import { drawRankedTitleRibbon } from '../../render/RankedBadge';
import { isCrt1979Typography } from '../../render/theme';
import type { CrtPreset, PhosphorTheme } from '../../shell/Cartridge';
import type { Vec2, ViewportRect } from '../../types';
import type { RadioTransmissionInfo } from './ApproachAudio';
import type { ApproachLeaderboardService } from './ApproachLeaderboard';
import type { ApproachSimulation } from './ApproachSimulation';
import {
  APPROACH_CONSTANTS,
  HOLD_ALTITUDE_SLOTS_FT,
  type ApproachLastSubmittedRun,
  type FlightStripData,
} from './types';

export const APPROACH_UI_IDS = {
  LAUNCH_SHIFT: 'approach-start',
  TRAINING_DRILL: 'approach-training-drill',
  TITLE_CONTROLS: 'approach-title-controls',
  TITLE_LEADERBOARD: 'approach-title-leaderboard',
  OPEN_MANUAL: 'approach-open-manual',
  MANUAL_CLOSE: 'approach-manual-close',
  MANUAL_TAB_PREFIX: 'approach-manual-tab-',
  CLEAR_DEPARTURE: 'approach-clear-departure',
  TUTORIAL_NEXT: 'approach-tutorial-next',
  TUTORIAL_SKIP: 'approach-tutorial-skip',
  TUTORIAL_LAUNCH_RANKED: 'approach-tutorial-launch-ranked',
  TUTORIAL_REPLAY: 'approach-tutorial-replay',
  TUTORIAL_BRIEFING_MENU: 'approach-tutorial-briefing-menu',
  STRIP_PREFIX: 'approach-strip-',
  SPEED_PREFIX: 'approach-speed-',
} as const;

export interface ApproachTutorialScoringBreakdown {
  basePoints: Array<{ label: string; value: string; tone: 'green' | 'cyan' | 'amber' | 'red' }>;
  multiplierSummary: string;
  bonuses: Array<{ tag: string; detail: string; tone: 'green' | 'cyan' | 'amber' }>;
  efficiencyNote: string;
}

export interface ApproachTutorialOverlayState {
  active: boolean;
  stepIndex: number;
  totalSteps: number;
  stepTag: string;
  headline: string;
  instruction: string;
  subHint?: string;
  guideArrows: Array<{ fromNm: Vec2; toNm: Vec2; color: string; label?: string }>;
  highlightRings: Array<{ posNm: Vec2; radiusNm: number; color: string; label?: string }>;
  highlightRestrictedZone?: boolean;
  highlightDepartureButton?: boolean;
  showNextButton?: boolean;
  nextButtonLabel?: string;
  scoringBreakdown?: ApproachTutorialScoringBreakdown;
  graduated?: boolean;
  graduationLockoutSec?: number;
}

export interface ApproachHudLayout {
  hudScale: number;
  topBarH: number;
  controlsStripH: number;
  controlsStripY: number;
  leftPanel: ViewportRect;
  scopeViewport: ViewportRect;
  rightPanel: ViewportRect;
}

export interface ApproachStatusToast {
  text: string;
  tone: 'green' | 'amber' | 'red' | 'cyan';
  alpha: number;
}

export interface ApproachHudRenderParams {
  width: number;
  height: number;
  timeSec: number;
  sim: ApproachSimulation;
  leaderboard: ApproachLeaderboardService;
  hoveredButtonId: string | null;
  selectedCraftId?: number | null;
  hoveredCraftId?: number | null;
  audioMuted: boolean;
  musicEnabled: boolean;
  atcMuted: boolean;
  masterVolume: number;
  crtPreset: CrtPreset;
  crtModeLocked: boolean;
  phosphorTheme: PhosphorTheme;
  isFullscreen: boolean;
  confirmExitPending: boolean;
  confirmGameMenuPending: boolean;
  osdMenuOpen: boolean;
  manifestOpen: boolean;
  controlsOpen: boolean;
  manualOpen?: boolean;
  manualTab?: number;
  /** Time-domain samples in [-1, 1] from ApproachAudio.getRadioOscilloscopeSamples() */
  radioWaveform?: Float32Array | null;
  /** Normalized radio output level [0, 1] */
  radioLevel?: number;
  /** True while a VHF/UHF transmission is actively keying the 254.30 MHz bus */
  radioTransmitting?: boolean;
  /** Current active radio voice transmission metadata (callsign + caption + urgency) */
  activeTransmission?: RadioTransmissionInfo | null;
  callsignDraft: string;
  callsignEditing: boolean;
  scoreSubmitted: boolean;
  submittingScore: boolean;
  submitResultBanner: string | null;
  submitResultTone: 'green' | 'amber' | 'red';
  lastSubmittedRun: ApproachLastSubmittedRun | null;
  statusToast?: ApproachStatusToast | null;
  tutorialState?: ApproachTutorialOverlayState | null;
  isFirstVisit?: boolean;
}

const APPROACH_CONTROLS_STRIP: readonly ControlsStripItem[] = [
  { key: 'DRAG', label: 'Vector/Snap', accent: 'green' },
  { key: 'RMB/W', label: 'Smart Hold', accent: 'cyan' },
  { key: 'D', label: 'Clear Dep', accent: 'cyan' },
  { key: 'SCROLL/S', label: 'Speed', accent: 'cyan' },
  { key: 'P', label: 'Pause', accent: 'amber' },
  { key: 'H', label: 'Controls', accent: 'cyan' },
  { key: 'ESC', label: 'Menu', accent: 'amber' },
];

/**
 * 3-Column 1979 LV-118 RAPCON Console, Interactive Training Drill UI,
 * and Unified Shared Modals Renderer for Program #5:
 * BOREALIS APPROACH // LV-118 RAPCON (v2.0).
 */
export class ApproachHudRenderer {
  public buttons: ChromeButtonHitbox[] = [];

  public hitTestButton(cx: number, cy: number): string | null {
    return hitTestChromeButtons(this.buttons, cx, cy);
  }

  /**
   * Computes the 3-column 1979 RAPCON terminal layout (Left Telemetry ~256px | Center Scope | Right Strips ~274px)
   * sandwiched cleanly between the 46px Top Chrome Bar and 22px Persistent Controls Strip.
   */
  public computeLayout(width: number, height: number): ApproachHudLayout {
    const w = Math.max(320, width);
    const h = Math.max(240, height);
    const margin = 6;
    const gap = 6;
    const topBarH = TOP_CHROME_BAR_HEIGHT;
    const controlsStripH = CONTROLS_STRIP_HEIGHT;
    const controlsStripY = h - controlsStripH;

    const panelTop = topBarH + 4;
    const panelH = Math.max(220, controlsStripY - 4 - panelTop);

    const leftW = Math.round(Math.max(216, Math.min(260, w * 0.178)));
    const rightW = Math.round(Math.max(236, Math.min(280, w * 0.19)));

    const leftPanel: ViewportRect = {
      x: margin,
      y: panelTop,
      width: leftW,
      height: panelH,
    };

    const rightPanel: ViewportRect = {
      x: w - margin - rightW,
      y: panelTop,
      width: rightW,
      height: panelH,
    };

    const scopeX = leftPanel.x + leftPanel.width + gap;
    const scopeW = Math.max(240, rightPanel.x - gap - scopeX);
    const scopeViewport: ViewportRect = {
      x: scopeX,
      y: panelTop,
      width: scopeW,
      height: panelH,
    };

    const hudScale = Math.max(0.85, Math.min(1.12, Math.min(w / 1440, h / 900)));

    return {
      hudScale,
      topBarH,
      controlsStripH,
      controlsStripY,
      leftPanel,
      scopeViewport,
      rightPanel,
    };
  }

  public render(
    ctx: CanvasRenderingContext2D,
    params: ApproachHudRenderParams,
    layout: ApproachHudLayout
  ): void {
    this.buttons = [];
    const { width: w, height: h, sim } = params;

    // 1. Unified 46px Top Chrome Bar
    this.drawTopBar(ctx, params);

    // 2. Left Column (Wind Rose, ATIS/Field, ICC Seals + Multiplier + Phase, 254.30 MHz Oscilloscope)
    this.drawLeftRapconColumn(ctx, params, layout.leftPanel);

    // 3. Right Column (Dedicated [CLEAR DEPARTURE] + Clickable Flight Strips + 4-Line Comms Teletype)
    this.drawRightFlightStripColumn(ctx, params, layout.rightPanel);

    // 4. Persistent 22px Bottom Controls Strip
    drawPersistentControlsStrip(ctx, w, h, APPROACH_CONTROLS_STRIP, layout.controlsStripY);

    // 5. Exclusive Shared Modal Stack & Interactive Training Drill UI
    if (params.osdMenuOpen) {
      this.drawUnifiedSystemMenu(ctx, params);
    } else if (params.manifestOpen) {
      this.drawGlobalLeaderboardModal(ctx, params);
    } else if (params.manualOpen) {
      this.drawRapconFieldManualModal(ctx, params, 'MANUAL');
      // Keep the 46px Top Chrome Bar 100% bright & clickable over the Field Manual scrim!
      this.drawTopBar(ctx, params);
    } else if (params.controlsOpen) {
      this.drawControlsQuickCard(ctx, params);
    } else if (sim.phase === 'ACTIVE_SHIFT' && sim.paused) {
      const pauseMetrics = drawPauseBanner(
        ctx,
        w,
        h,
        'RAPCON scope frozen. Press [P] to resume shift, [H] for Controls, or [ESC] for System Menu.',
        this.buttons,
        params.hoveredButtonId,
        params.timeSec
      );
      // Direct 1-click access to the 3-Tab Scoring & RAPCON Field Manual from the Pause overlay
      const manBtnW = Math.min(340, pauseMetrics.boxW);
      const manBtnH = 34;
      const manBtnX = Math.round(pauseMetrics.bx + (pauseMetrics.boxW - manBtnW) * 0.5);
      const manBtnY = Math.min(h - layout.controlsStripH - manBtnH - 8, pauseMetrics.by + pauseMetrics.boxH + 10);
      drawChromeButton(
        ctx,
        { x: manBtnX, y: manBtnY, width: manBtnW, height: manBtnH },
        `${SEMIOTIC_ICONS.DIAMOND} OPEN SCORING & FIELD MANUAL`,
        {
          id: APPROACH_UI_IDS.OPEN_MANUAL,
          accent: 'cyan',
          hovered: params.hoveredButtonId === APPROACH_UI_IDS.OPEN_MANUAL,
          fontPx: 13,
        },
        this.buttons
      );
    } else if (sim.phase === 'GAME_OVER') {
      this.drawGameOverDebrief(ctx, params);
    } else if (sim.phase === 'TITLE') {
      this.drawBriefingOverlay(ctx, params);
      // Keep the 46px Top Chrome Bar 100% bright & clickable over the Pre-Launch Briefing scrim!
      this.drawTopBar(ctx, params);
    } else if (sim.phase === 'ACTIVE_SHIFT' && params.tutorialState?.active) {
      this.drawTutorialOverlay(ctx, params, layout);
    }

    // 6. Transient Status Toast (offset clear of top Tutorial Directive Card when drill is active!)
    if (params.statusToast && params.statusToast.alpha > 0.01) {
      const tutorialTopCardVisible = Boolean(
        sim.phase === 'ACTIVE_SHIFT' &&
          !sim.paused &&
          !params.osdMenuOpen &&
          !params.manifestOpen &&
          !params.manualOpen &&
          !params.controlsOpen &&
          params.tutorialState?.active &&
          !params.tutorialState.graduated &&
          !params.tutorialState.scoringBreakdown
      );
      const toastY = tutorialTopCardVisible ? layout.controlsStripY - 40 : layout.topBarH + 10;
      drawStatusToast(
        ctx,
        w,
        toastY,
        params.statusToast.text,
        params.statusToast.tone,
        params.statusToast.alpha
      );
    }
  }

  // ===========================================================================
  // TOP 46PX UNIFIED CHROME BAR (with Cyan TRAINING DRILL Badge in trainingMode)
  // ===========================================================================
  private drawTopBar(ctx: CanvasRenderingContext2D, params: ApproachHudRenderParams): void {
    const { width: w, sim } = params;
    const isTraining = sim.trainingMode;
    const telemetryText = isTraining
      ? undefined
      : `INFO ${sim.atisLetter} · ${String(sim.landedCount).padStart(2, '0')} LND · ${sim.multiplier.toFixed(1)}X · ${sim.score.toLocaleString()} PTS${sim.ranked1979Bonus ? ' · 1.5X' : ''}`;

    const barMetrics = drawTopChromeBar(
      ctx,
      w,
      {
        title: 'BOREALIS APPROACH',
        timeSec: params.timeSec,
        isRanked: !isTraining,
        showRankedBadge: !isTraining,
        telemetryText,
        crt1979Enabled: params.crtPreset === 'CLASSIC_1979',
        crtModeLocked: params.crtModeLocked,
        controlsLabel: '[H] CONTROLS',
        audioMuted: params.audioMuted,
        musicEnabled: params.musicEnabled,
        atcMuted: params.atcMuted,
        hoveredButtonId: params.hoveredButtonId,
        confirmExitPending: params.confirmExitPending,
      },
      this.buttons
    );

    // Draw crisp cyan `TRAINING DRILL` badge + step telemetry when in interactive training mode
    if (isTraining) {
      const compact = w < 1060;
      const ultraCompact = w < 860;
      const padSide = compact ? 8 : 12;
      const pillFontPx = ultraCompact ? 12 : 13;
      const hubText = params.confirmExitPending
        ? '[CONFIRM EXIT?]'
        : ultraCompact
          ? '◄ OS'
          : '◄ MU-TH-UR OS';
      const hubMinW = params.confirmExitPending ? 128 : ultraCompact ? 54 : 118;

      ctx.save();
      ctx.font = pillFontPx >= 13 ? font('button', pillFontPx) : font('micro', 12);
      const hubW = Math.max(hubMinW, Math.ceil(ctx.measureText(hubText).width) + 24);
      let leftX = padSide + hubW + (compact ? 10 : 14);
      const maxLeftX = barMetrics.rightRailX - 12;
      const midY = TOP_CHROME_BAR_HEIGHT * 0.5 + 0.5;

      ctx.font = font('head', compact ? 14 : 16);
      const titleAvail = Math.max(40, maxLeftX - leftX);
      const titleUsed = Math.min(titleAvail, ctx.measureText('BOREALIS APPROACH').width);
      leftX += Math.ceil(titleUsed) + 12;

      if (maxLeftX - leftX >= 96) {
        const badgeLabel = compact ? 'TRAINING' : `${SEMIOTIC_ICONS.DIAMOND} TRAINING DRILL`;
        const badgeH = 26;
        const badgeY = Math.round((TOP_CHROME_BAR_HEIGHT - badgeH) * 0.5);
        ctx.font = compact ? font('micro', 12) : font('button', 13);
        const badgeW = Math.min(
          maxLeftX - leftX,
          Math.ceil(ctx.measureText(badgeLabel).width) + 20
        );
        const pulse = 0.55 + 0.45 * Math.sin(params.timeSec * 5.2);

        ctx.fillStyle = `rgba(8, 38, 48, ${(0.88 + pulse * 0.1).toFixed(3)})`;
        ctx.fillRect(leftX, badgeY, badgeW, badgeH);
        ctx.strokeStyle = pulse > 0.5 ? '#88F4FF' : THEME.ACCENT_CYAN;
        ctx.lineWidth = 1.7;
        ctx.strokeRect(leftX + 0.5, badgeY + 0.5, badgeW - 1, badgeH - 1);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = THEME.ACCENT_CYAN;
        drawEllipsizedText(ctx, badgeLabel, leftX + badgeW * 0.5, midY, badgeW - 10);

        leftX += badgeW + 12;
      }

      const trainTele = params.tutorialState?.stepTag
        ? `${params.tutorialState.stepTag} · UNRANKED`
        : 'UNRANKED SIM';
      if (maxLeftX - leftX >= 72) {
        ctx.strokeStyle = THEME.BORDER_SUBTLE;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(leftX - 6, 12);
        ctx.lineTo(leftX - 6, TOP_CHROME_BAR_HEIGHT - 12);
        ctx.stroke();

        ctx.font = font('data', compact ? 12 : 13);
        ctx.fillStyle = THEME.TEXT_BRIGHT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        drawEllipsizedText(ctx, trainTele, leftX + 2, midY, maxLeftX - leftX - 4);
      }

      ctx.restore();
    }
  }

  // ===========================================================================
  // LEFT COLUMN: WIND ROSE, ATIS/FIELD, ICC SEALS + MULT + PHASE, OSCILLOSCOPE
  // ===========================================================================
  private drawLeftRapconColumn(
    ctx: CanvasRenderingContext2D,
    params: ApproachHudRenderParams,
    rect: ViewportRect
  ): void {
    const { sim, timeSec } = params;
    const pad = 8;
    const innerW = rect.width - pad * 2;
    const compact = rect.height < 710;
    const gap = compact ? 6 : 8;

    ctx.save();
    ctx.fillStyle = THEME.BG_PANEL;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    drawCornerBrackets(
      ctx,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      12,
      sim.sealBreachFlashTimer > 0
        ? THEME.ALERT_RED_STROKE
        : sim.conflictActive
          ? THEME.ACCENT_AMBER
          : THEME.BORDER_SUBTLE,
      1.8
    );

    // Header
    ctx.textBaseline = 'middle';
    ctx.font = font('head', 13);
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    drawEllipsizedText(ctx, 'LV-118 RAPCON', rect.x + pad, rect.y + 15, innerW - 64);

    ctx.font = font('micro', 12);
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.fillText('BOREALIS', rect.x + rect.width - pad, rect.y + 15);

    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(rect.x + pad, rect.y + 26);
    ctx.lineTo(rect.x + rect.width - pad, rect.y + 26);
    ctx.stroke();

    let curY = rect.y + 32;

    // 1. Rotating Wind Rose Dial (outer inward wind barb + clean inner multi-runway chevrons!)
    const windH = compact ? 122 : 144;
    this.drawWindRoseModule(ctx, sim, rect.x + pad, curY, innerW, windH, timeSec, compact);
    curY += windH + gap;

    // 2. ATIS Information Letter + Shift Phase Title + Altimeter + Active Runway(s) Strip
    const atisH = compact ? 92 : 104;
    this.drawAtisFieldModule(ctx, sim, rect.x + pad, curY, innerW, atisH, timeSec);
    curY += atisH + gap;

    // 3. ICC Safety Seals (3-Strikes) + Clean Shift Multiplier + Shift Phase Progress
    const sealsH = compact ? 154 : 174;
    this.drawSealsMultiplierPhaseModule(ctx, sim, rect.x + pad, curY, innerW, sealsH, timeSec, compact);
    curY += sealsH + gap;

    // 4. Live VHF/UHF 254.30 MHz Radio Oscilloscope (3-line caption below tube!)
    const oscH = Math.max(114, rect.y + rect.height - pad - curY);
    this.drawRadioOscilloscopeModule(ctx, params, rect.x + pad, curY, innerW, oscH);

    ctx.restore();
  }

  private drawWindRoseModule(
    ctx: CanvasRenderingContext2D,
    sim: ApproachSimulation,
    x: number,
    y: number,
    w: number,
    h: number,
    timeSec: number,
    compact: boolean
  ): void {
    const flipping = sim.pendingPrimaryRunway !== null || sim.pendingSecondaryRunway !== null;
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 8);

    ctx.save();
    ctx.fillStyle = flipping ? 'rgba(42, 22, 4, 0.72)' : 'rgba(3, 10, 6, 0.94)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = flipping ? THEME.ACCENT_AMBER : THEME.BORDER_SUBTLE;
    ctx.lineWidth = flipping ? 1.5 : 1.1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // Module title + gust pill
    ctx.textBaseline = 'middle';
    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = flipping ? THEME.ACCENT_AMBER_HI : THEME.TEXT_SECONDARY;
    drawEllipsizedText(ctx, 'WIND ROSE', x + 7, y + 12, w * 0.55);

    ctx.textAlign = 'right';
    ctx.fillStyle = flipping ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;
    ctx.fillText(flipping ? 'SHIFT!' : `G${sim.windGustKt}KT`, x + w - 7, y + 12);

    // Circular Wind Rose Compass Dial (sized so outer wind barb stays cleanly inside module)
    const dialR = compact ? 29 : 37;
    const cx = x + w * 0.5;
    const cy = y + 20 + (h - 42) * 0.5;

    // Recessed dial ring
    ctx.fillStyle = '#020805';
    ctx.beginPath();
    ctx.arc(cx, cy, dialR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = flipping
      ? `rgba(255, 176, 0, ${(0.65 + pulse * 0.35).toFixed(3)})`
      : 'rgba(52, 168, 86, 0.62)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 12 outer compass ticks
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI * 0.5;
      const major = i % 3 === 0;
      const len = major ? 5.5 : 3;
      ctx.strokeStyle = major ? THEME.TEXT_BRIGHT : THEME.BORDER_SUBTLE;
      ctx.lineWidth = major ? 1.4 : 1.0;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * dialR, cy + Math.sin(a) * dialR);
      ctx.lineTo(cx + Math.cos(a) * (dialR - len), cy + Math.sin(a) * (dialR - len));
      ctx.stroke();
    }

    // Inner Active Runway(s) — cleanly centered with ZERO wind-arrow cross-over!
    const rwyLen = dialR * 0.58;
    const secOpen = sim.secondaryRunwayOpen && sim.activeSecondaryRunway !== null;

    // Secondary N-S Crosswind Runway 36/18 (drawn first when open)
    if (secOpen) {
      const secX = cx - dialR * 0.16;
      const secLen = dialR * 0.56;
      ctx.fillStyle = 'rgba(10, 42, 34, 0.94)';
      ctx.fillRect(secX - 3, cy - secLen * 0.5, 6, secLen);
      ctx.strokeStyle = THEME.TEXT_PRIMARY;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(secX - 3, cy - secLen * 0.5, 6, secLen);

      // Bright green landing chevron for RWY 36 (North/up) or RWY 18 (South/down)
      const secDirY = sim.activeSecondaryRunway === '36' ? -1 : 1;
      const tipY = cy + secDirY * (secLen * 0.5 + 3.5);
      ctx.strokeStyle = '#6BFF95';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(secX, tipY);
      ctx.lineTo(secX - 3.5, tipY - secDirY * 5);
      ctx.moveTo(secX, tipY);
      ctx.lineTo(secX + 3.5, tipY - secDirY * 5);
      ctx.stroke();
    }

    // Primary E-W Runway 09/27 horizontal strip
    const priOffsetX = secOpen ? dialR * 0.08 : 0;
    const priCx = cx + priOffsetX;
    ctx.fillStyle = 'rgba(14, 48, 26, 0.96)';
    ctx.fillRect(priCx - rwyLen * 0.5, cy - 3.5, rwyLen, 7);
    ctx.strokeStyle = THEME.TEXT_PRIMARY;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(priCx - rwyLen * 0.5, cy - 3.5, rwyLen, 7);

    // Bright green landing chevron for RWY 27 (West/left) or RWY 09 (East/right)
    const rwyDir = sim.primaryRunway === '27' ? -1 : 1;
    const priTipX = priCx + rwyDir * (rwyLen * 0.5 + 3.5);
    ctx.strokeStyle = '#6BFF95';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(priTipX, cy);
    ctx.lineTo(priTipX - rwyDir * 5.5, cy - 3.8);
    ctx.moveTo(priTipX, cy);
    ctx.lineTo(priTipX - rwyDir * 5.5, cy + 3.8);
    ctx.stroke();

    // OUTER PERIMETER Amber Wind Direction Barb/Arrow pointing INWARD from windDisplayHeadingDeg
    // Never crosses the center dial or fights the runway chevrons!
    const windFromRad = ((sim.windDisplayHeadingDeg - 90) * Math.PI) / 180;
    const cosW = Math.cos(windFromRad);
    const sinW = Math.sin(windFromRad);
    const tailR = dialR + 9.5;
    const tipR = dialR - 8.5;
    const tailX = cx + cosW * tailR;
    const tailY = cy + sinW * tailR;
    const tipX = cx + cosW * tipR;
    const tipY = cy + sinW * tipR;

    // Inward unit vector (pointing from tail toward dial center) & perpendicular for barbs
    const inX = -cosW;
    const inY = -sinW;
    const perpX = -inY;
    const perpY = inX;

    ctx.strokeStyle = flipping ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Meteorological wind-barb feathers at outer tail
    ctx.strokeStyle = THEME.ACCENT_AMBER_HI;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(tailX + perpX * 6 - inX * 2, tailY + perpY * 6 - inY * 2);
    const barb2X = tailX + inX * 4;
    const barb2Y = tailY + inY * 4;
    ctx.moveTo(barb2X, barb2Y);
    ctx.lineTo(barb2X + perpX * 4.5 - inX * 1.5, barb2Y + perpY * 4.5 - inY * 1.5);
    ctx.stroke();

    // Bold inward-pointing arrowhead on outer compass perimeter
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - inX * 7 + perpX * 4.4, tipY - inY * 7 + perpY * 4.4);
    ctx.lineTo(tipX - inX * 7 - perpX * 4.4, tipY - inY * 7 - perpY * 4.4);
    ctx.closePath();
    ctx.fill();

    // Glowing amber wind-origin beacon dot on outer perimeter
    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.beginPath();
    ctx.arc(tailX, tailY, 2.8, 0, Math.PI * 2);
    ctx.fill();

    // Cardinal W / E markers neatly framing dial outside the wind-barb ring
    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.textAlign = 'center';
    ctx.fillText('W', cx - dialR - 18, cy + 0.5);
    ctx.fillText('E', cx + dialR + 18, cy + 0.5);

    // Bottom crisp wind telemetry string (`WIND 270° @ 18G24 KT`)
    const windStr = `WIND ${String(Math.round(sim.windHeadingDeg)).padStart(3, '0')}° @ ${sim.windSpeedKt}G${sim.windGustKt} KT`;
    ctx.font = font('data', 12);
    ctx.textAlign = 'center';
    ctx.fillStyle = flipping ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT;
    drawEllipsizedText(ctx, windStr, cx, y + h - 12, w - 12);

    ctx.restore();
  }

  private drawAtisFieldModule(
    ctx: CanvasRenderingContext2D,
    sim: ApproachSimulation,
    x: number,
    y: number,
    w: number,
    h: number,
    timeSec: number
  ): void {
    const flipping = sim.pendingPrimaryRunway !== null || sim.pendingSecondaryRunway !== null;
    const blink = Math.sin(timeSec * 12) > 0;

    ctx.save();
    ctx.fillStyle = 'rgba(3, 10, 6, 0.94)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = flipping ? THEME.ACCENT_AMBER : THEME.BORDER_SUBTLE;
    ctx.lineWidth = flipping ? 1.5 : 1.1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // Left Glowing ATIS Information Letter Box
    const letterW = 50;
    const letterH = h - 14;
    const lx = x + 7;
    const ly = y + 7;

    ctx.fillStyle = 'rgba(42, 24, 4, 0.90)';
    ctx.fillRect(lx, ly, letterW, letterH);
    ctx.strokeStyle = THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(lx + 0.5, ly + 0.5, letterW - 1, letterH - 1);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.fillText('ATIS', lx + letterW * 0.5, ly + 13);

    ctx.font = font('display', 32);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.fillText(sim.atisLetter, lx + letterW * 0.5, ly + letterH * 0.62);

    // Right Field Telemetry Stack: SHIFT PHASE TITLE · ALTIMETER · ACTIVE RUNWAY(S)
    // Shows `sim.getShiftPhaseTitle()` (e.g. NIGHT WATCH / ION SQUALL) so ATIS [B] never contradicts INFO ALPHA!
    const rx = lx + letterW + 8;
    const rw = w - letterW - 22;

    ctx.textAlign = 'left';
    ctx.font = font('data', 13);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    drawEllipsizedText(ctx, sim.getShiftPhaseTitle(), rx, ly + 12, rw);

    ctx.font = font('data', 12);
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    drawEllipsizedText(ctx, `ALT ${sim.altimeterInHg.toFixed(2)} inHg`, rx, ly + 33, rw);

    // Active Runway(s) / Flashing Reversal Countdown Pill
    const rwyBoxY = ly + letterH - 28;
    const rwyBoxH = 26;
    ctx.fillStyle = flipping
      ? blink
        ? 'rgba(104, 48, 4, 0.94)'
        : 'rgba(54, 24, 4, 0.92)'
      : 'rgba(10, 34, 18, 0.92)';
    ctx.fillRect(rx, rwyBoxY, rw, rwyBoxH);
    ctx.strokeStyle = flipping
      ? blink
        ? THEME.ACCENT_AMBER_HI
        : THEME.ACCENT_AMBER
      : THEME.TEXT_PRIMARY;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(rx + 0.5, rwyBoxY + 0.5, rw - 1, rwyBoxH - 1);

    ctx.textAlign = 'center';
    ctx.font = font('data', 12);
    ctx.fillStyle = flipping ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT;
    let rwyLabel: string;
    if (flipping) {
      const secStr = String(Math.max(0, Math.ceil(sim.runwayFlipCountdownSec))).padStart(2, '0');
      if (sim.pendingPrimaryRunway && sim.pendingSecondaryRunway) {
        rwyLabel = `FLIP→${sim.pendingPrimaryRunway}+${sim.pendingSecondaryRunway} ${secStr}S`;
      } else {
        const tgt = sim.pendingPrimaryRunway ?? sim.pendingSecondaryRunway ?? sim.pendingRunway ?? '';
        rwyLabel = `FLIP→${tgt} IN ${secStr}S`;
      }
    } else if (sim.secondaryRunwayOpen && sim.activeSecondaryRunway !== null) {
      rwyLabel = `RWY ${sim.primaryRunway} + ${sim.activeSecondaryRunway} ILS`;
    } else {
      rwyLabel = `RWY ${sim.primaryRunway} ILS`;
    }
    drawEllipsizedText(ctx, rwyLabel, rx + rw * 0.5, rwyBoxY + rwyBoxH * 0.5 + 0.5, rw - 8);

    ctx.restore();
  }

  private drawSealsMultiplierPhaseModule(
    ctx: CanvasRenderingContext2D,
    sim: ApproachSimulation,
    x: number,
    y: number,
    w: number,
    h: number,
    timeSec: number,
    compact: boolean
  ): void {
    const blinkFast = Math.sin(timeSec * 12) > 0;
    const cfg = sim.getShiftPhaseConfig();
    const prog = sim.getShiftProgress();

    ctx.save();
    ctx.fillStyle = 'rgba(3, 10, 6, 0.94)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = sim.safetySeals <= 1 ? THEME.ALERT_RED_STROKE : THEME.BORDER_SUBTLE;
    ctx.lineWidth = sim.safetySeals <= 1 ? 1.5 : 1.1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    const cy = y + 13;
    ctx.textBaseline = 'middle';

    // 1. ICC Safety Seals Header + 3 Illuminated Seal Cells
    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = sim.safetySeals <= 1 ? THEME.ALERT_RED_TEXT : THEME.TEXT_SECONDARY;
    drawEllipsizedText(ctx, 'ICC SAFETY SEALS', x + 7, cy, w - 48);

    ctx.textAlign = 'right';
    ctx.fillStyle =
      sim.safetySeals <= 1
        ? THEME.ALERT_RED_TEXT
        : sim.safetySeals === 2
          ? THEME.ACCENT_AMBER_HI
          : THEME.TEXT_BRIGHT;
    ctx.fillText(`${sim.safetySeals}/${sim.maxSafetySeals}`, x + w - 7, cy);

    const sealY = y + 23;
    const sealH = compact ? 24 : 28;
    const sealGap = 5;
    const sealW = (w - 14 - sealGap * 2) / 3;

    for (let i = 0; i < sim.maxSafetySeals; i++) {
      const sx = x + 7 + i * (sealW + sealGap);
      const intact = i < sim.safetySeals;
      const lastWarn = intact && sim.safetySeals === 1;

      ctx.fillStyle = !intact
        ? blinkFast
          ? 'rgba(98, 16, 10, 0.90)'
          : 'rgba(48, 10, 8, 0.86)'
        : lastWarn
          ? 'rgba(62, 34, 4, 0.88)'
          : 'rgba(12, 42, 22, 0.86)';
      ctx.fillRect(sx, sealY, sealW, sealH);
      ctx.strokeStyle = !intact
        ? THEME.ALERT_RED_STROKE
        : lastWarn
          ? THEME.ACCENT_AMBER
          : THEME.TEXT_PRIMARY;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(sx + 0.5, sealY + 0.5, sealW - 1, sealH - 1);

      ctx.font = font('micro', 12);
      ctx.textAlign = 'center';
      ctx.fillStyle = !intact
        ? THEME.ALERT_RED_TEXT
        : lastWarn
          ? THEME.ACCENT_AMBER_HI
          : THEME.TEXT_BRIGHT;
      drawEllipsizedText(
        ctx,
        intact ? `S${i + 1} OK` : 'LOST',
        sx + sealW * 0.5,
        sealY + sealH * 0.5 + 0.5,
        sealW - 6
      );
    }

    // 2. Clean Shift Multiplier + Live Clean Streak Milestone / Comeback Seal Progress
    const multY = sealY + sealH + (compact ? 6 : 8);
    const multH = compact ? 44 : 48;
    const hotMult = sim.multiplier >= 2.5;
    const needSealRestore = sim.safetySeals < sim.maxSafetySeals;
    const mod20 =
      sim.cleanStreak > 0 && sim.cleanStreak % 20 === 0 ? 20 : sim.cleanStreak % 20;
    const streakLabel = needSealRestore
      ? `STK ${mod20}/20 · +SEAL`
      : `STK ${mod20}/20 · BONUS`;

    ctx.fillStyle = sim.conflictActive
      ? 'rgba(62, 14, 10, 0.78)'
      : hotMult
        ? 'rgba(48, 26, 4, 0.78)'
        : needSealRestore && mod20 >= 15
          ? 'rgba(8, 36, 38, 0.84)'
          : THEME.BG_ROW_ALT;
    ctx.fillRect(x + 7, multY, w - 14, multH);
    ctx.strokeStyle = sim.conflictActive
      ? THEME.ALERT_RED_STROKE
      : hotMult
        ? THEME.ACCENT_AMBER
        : needSealRestore && mod20 >= 10
          ? THEME.ACCENT_CYAN
          : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x + 7.5, multY + 0.5, w - 15, multH - 1);

    ctx.textAlign = 'left';
    ctx.font = font('micro', 12);
    ctx.fillStyle = sim.conflictActive ? THEME.ALERT_RED_TEXT : THEME.TEXT_SECONDARY;
    ctx.fillText('CLEAN MULT', x + 13, multY + 12);

    ctx.font = font('micro', 12);
    ctx.fillStyle = sim.conflictActive
      ? THEME.ALERT_RED_TEXT
      : needSealRestore
        ? mod20 >= 15
          ? THEME.ACCENT_AMBER_HI
          : THEME.ACCENT_CYAN
        : mod20 >= 15
          ? THEME.ACCENT_AMBER_HI
          : THEME.TEXT_BRIGHT;
    drawEllipsizedText(ctx, streakLabel, x + 13, multY + multH - 15, w - 90);

    ctx.textAlign = 'right';
    ctx.font = font('display', compact ? 20 : 22);
    ctx.fillStyle = sim.conflictActive
      ? THEME.ALERT_RED_TEXT
      : hotMult
        ? THEME.ACCENT_AMBER_HI
        : THEME.TEXT_PRIMARY;
    ctx.fillText(`${sim.multiplier.toFixed(2)}X`, x + w - 13, multY + (multH - 5) * 0.5 + 1);

    // Subtle 20-op streak milestone bar along bottom of Clean Mult box (notches at 5/10/15)
    const stkBarX = x + 11;
    const stkBarY = multY + multH - 6;
    const stkBarW = w - 22;
    const stkBarH = 3;
    ctx.fillStyle = 'rgba(4, 14, 9, 0.92)';
    ctx.fillRect(stkBarX, stkBarY, stkBarW, stkBarH);
    const stkFillW = Math.round((stkBarW * mod20) / 20);
    if (stkFillW > 0) {
      ctx.fillStyle = needSealRestore
        ? mod20 >= 15
          ? THEME.ACCENT_AMBER_HI
          : THEME.ACCENT_CYAN
        : THEME.TEXT_PRIMARY;
      ctx.fillRect(stkBarX, stkBarY, stkFillW, stkBarH);
    }
    ctx.fillStyle = 'rgba(2, 8, 5, 0.85)';
    for (const frac of [0.25, 0.5, 0.75]) {
      ctx.fillRect(Math.round(stkBarX + stkBarW * frac), stkBarY, 1, stkBarH);
    }

    // 3. Shift Phase Progress Bar
    const phaseY = multY + multH + (compact ? 7 : 9);
    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.ACCENT_CYAN;
    drawEllipsizedText(ctx, `PHASE ${cfg.id}`, x + 7, phaseY + 6, w - 68);

    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    const progTxt = prog.phaseNext !== null ? `${prog.current}/${prog.phaseNext}` : 'MAX';
    ctx.fillText(progTxt, x + w - 7, phaseY + 6);

    const barY = phaseY + 18;
    const barH = 10;
    const barW = w - 14;
    ctx.fillStyle = 'rgba(8, 22, 14, 0.94)';
    ctx.fillRect(x + 7, barY, barW, barH);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.0;
    ctx.strokeRect(x + 7.5, barY + 0.5, barW - 1, barH - 1);

    const fillW = Math.round((barW - 4) * prog.ratio);
    if (fillW > 0) {
      ctx.fillStyle =
        sim.shiftPhase === 'ECHO'
          ? THEME.ALERT_RED_TEXT
          : sim.shiftPhase === 'DELTA' || sim.shiftPhase === 'CHARLIE'
            ? THEME.ACCENT_AMBER
            : THEME.TEXT_PRIMARY;
      ctx.fillRect(x + 9, barY + 2, fillW, barH - 4);
    }

    if (barY + barH + 16 <= y + h - 4) {
      ctx.font = font('micro', 12);
      ctx.textAlign = 'left';
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      ctx.fillText('SCORE', x + 7, y + h - 11);
      ctx.textAlign = 'right';
      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      ctx.fillText(sim.score.toLocaleString(), x + w - 7, y + h - 11);
    }

    ctx.restore();
  }

  // ===========================================================================
  // LIVE VHF/UHF 254.30 MHz RADIO OSCILLOSCOPE (3-LINE CAPTION!)
  // ===========================================================================
  private drawRadioOscilloscopeModule(
    ctx: CanvasRenderingContext2D,
    params: ApproachHudRenderParams,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    const { sim, timeSec } = params;
    const tx = params.activeTransmission ?? null;
    const level = Math.max(0, Math.min(1, params.radioLevel ?? 0));
    const transmitting = Boolean(params.radioTransmitting || level > 0.08 || tx !== null);
    const urgent = Boolean(tx?.urgent || tx?.priority === 'CRITICAL' || sim.conflictActive);
    const highPri = tx?.priority === 'HIGH';

    const traceCol = urgent
      ? THEME.ALERT_RED_TEXT
      : highPri
        ? THEME.ACCENT_AMBER_HI
        : transmitting
          ? THEME.TEXT_PRIMARY
          : 'rgba(68, 255, 119, 0.55)';

    const borderCol =
      urgent && transmitting
        ? THEME.ALERT_RED_STROKE
        : transmitting
          ? THEME.TEXT_PRIMARY
          : THEME.BORDER_SUBTLE;

    ctx.save();
    ctx.fillStyle = 'rgba(3, 10, 6, 0.94)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = transmitting ? 1.5 : 1.1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // Header: `254.30 MHz` + live TX / STBY lamp
    ctx.textBaseline = 'middle';
    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = transmitting ? THEME.TEXT_BRIGHT : THEME.TEXT_SECONDARY;
    drawEllipsizedText(ctx, `UHF ${APPROACH_CONSTANTS.RADIO_FREQ_MHZ} MHz`, x + 7, y + 14, w - 64);

    const lampW = 48;
    const lampH = 18;
    const lampX = x + w - lampW - 6;
    const lampY = y + 5;
    const atcMuted = Boolean(params.atcMuted);
    ctx.fillStyle = atcMuted
      ? 'rgba(54, 14, 10, 0.90)'
      : transmitting
        ? urgent
          ? THEME.ALERT_RED_BG
          : 'rgba(18, 56, 30, 0.94)'
        : 'rgba(8, 18, 12, 0.90)';
    ctx.fillRect(lampX, lampY, lampW, lampH);
    ctx.strokeStyle = atcMuted
      ? THEME.ALERT_RED_STROKE
      : transmitting
        ? urgent
          ? THEME.ALERT_RED_STROKE
          : THEME.TEXT_PRIMARY
        : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(lampX + 0.5, lampY + 0.5, lampW - 1, lampH - 1);

    ctx.textAlign = 'center';
    ctx.fillStyle = atcMuted
      ? THEME.ALERT_RED_TEXT
      : transmitting
        ? urgent
          ? '#FFE8E2'
          : THEME.TEXT_BRIGHT
        : THEME.TEXT_MUTED;
    ctx.fillText(
      atcMuted ? 'MUTE' : transmitting ? '● TX' : 'STBY',
      lampX + lampW * 0.5,
      lampY + lampH * 0.5 + 0.5
    );

    // Reserve clean room for 3-line voice caption below oscilloscope tube when height permits
    const captionReserve = h >= 168 ? 68 : h >= 146 ? 52 : 36;
    const scopeX = x + 7;
    const scopeY = y + 28;
    const scopeW = w - 14;
    const scopeH = Math.max(40, h - 34 - captionReserve);

    ctx.fillStyle = '#010704';
    ctx.fillRect(scopeX, scopeY, scopeW, scopeH);
    ctx.strokeStyle = 'rgba(28, 92, 49, 0.65)';
    ctx.lineWidth = 1.0;
    ctx.strokeRect(scopeX + 0.5, scopeY + 0.5, scopeW - 1, scopeH - 1);

    // Graticule grid lines
    const midY = scopeY + scopeH * 0.5;
    ctx.strokeStyle = 'rgba(28, 92, 49, 0.30)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(scopeX + 1, midY);
    ctx.lineTo(scopeX + scopeW - 1, midY);
    for (let i = 1; i < 6; i++) {
      const gx = scopeX + (scopeW * i) / 6;
      ctx.moveTo(gx, scopeY + 2);
      ctx.lineTo(gx, scopeY + scopeH - 2);
    }
    ctx.stroke();

    // Clipped Live Phosphor Waveform Trace
    ctx.save();
    ctx.beginPath();
    ctx.rect(scopeX + 1, scopeY + 1, scopeW - 2, scopeH - 2);
    ctx.clip();

    const samples = params.radioWaveform;
    const ampPx = scopeH * 0.42;

    const buildWavePath = (): void => {
      ctx.beginPath();
      if (samples && samples.length >= 4) {
        const count = samples.length;
        for (let i = 0; i < count; i++) {
          const px = scopeX + 2 + (i / (count - 1)) * (scopeW - 4);
          const v = Math.max(-1, Math.min(1, samples[i]));
          const py = midY - v * ampPx;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      } else {
        const pts = 48;
        const synthAmp = transmitting ? Math.max(0.28, level) : 0.05;
        for (let i = 0; i < pts; i++) {
          const u = i / (pts - 1);
          const px = scopeX + 2 + u * (scopeW - 4);
          const env = Math.sin(u * Math.PI);
          const s =
            (Math.sin(u * 26 + timeSec * 28) * 0.55 +
              Math.sin(u * 61 - timeSec * 42) * 0.30 +
              Math.cos(u * 97 + timeSec * 19) * 0.15) *
            synthAmp *
            env;
          const py = midY - s * ampPx;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      }
    };

    buildWavePath();
    ctx.strokeStyle = urgent
      ? 'rgba(255, 76, 48, 0.34)'
      : highPri
        ? 'rgba(255, 176, 0, 0.34)'
        : 'rgba(68, 255, 119, 0.28)';
    ctx.lineWidth = 4.2;
    ctx.stroke();

    buildWavePath();
    ctx.strokeStyle = traceCol;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    // Active TX Callsign + 3-Line Compact Wrapped Voice Caption (`lineH = 13.5`)
    const capY = scopeY + scopeH + 7;
    const capAvailH = y + h - 5 - capY;
    const callsignText = tx?.callsign
      ? `TX // ${tx.callsign}`
      : sim.lastTxTimer > 0 && sim.lastTxCaption
        ? 'TX // RAPCON GUARD'
        : 'GUARD // 254.30 MHz';
    const captionText =
      tx?.text ||
      (sim.lastTxTimer > 0 && sim.lastTxCaption
        ? sim.lastTxCaption
        : 'Carrier standby — monitoring LV-118 approach.');

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = font('micro', 12);
    ctx.fillStyle = urgent
      ? THEME.ALERT_RED_TEXT
      : transmitting
        ? THEME.ACCENT_AMBER_HI
        : THEME.TEXT_SECONDARY;
    drawEllipsizedText(ctx, callsignText, scopeX, capY + 5, scopeW);

    if (capAvailH >= 24) {
      ctx.font = font('micro', 12);
      ctx.fillStyle = transmitting ? THEME.TEXT_BRIGHT : THEME.TEXT_MUTED;
      const lineH = 13.5;
      const maxLines = capAvailH >= 54 ? 3 : capAvailH >= 38 ? 2 : 1;
      const lines = wrapTextLines(ctx, captionText, scopeW, maxLines);
      lines.forEach((ln, idx) => {
        ctx.fillText(ln, scopeX, capY + 20 + idx * lineH);
      });
    }

    ctx.restore();
  }

  // ===========================================================================
  // RIGHT COLUMN: [CLEAR DEPARTURE] MODULE + FLIGHT STRIPS + 4-LINE TELETYPE
  // ===========================================================================
  private drawRightFlightStripColumn(
    ctx: CanvasRenderingContext2D,
    params: ApproachHudRenderParams,
    rect: ViewportRect
  ): void {
    const { sim, timeSec } = params;
    const pad = 8;
    const innerW = rect.width - pad * 2;
    const compact = rect.height < 710;

    ctx.save();
    ctx.fillStyle = THEME.BG_PANEL;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    drawCornerBrackets(ctx, rect.x, rect.y, rect.width, rect.height, 12, THEME.BORDER_SUBTLE, 1.8);

    // Header
    ctx.textBaseline = 'middle';
    ctx.font = font('head', 13);
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    drawEllipsizedText(ctx, 'FLIGHT STRIPS', rect.x + pad, rect.y + 15, innerW - 62);

    ctx.font = font('micro', 12);
    ctx.textAlign = 'right';
    ctx.fillStyle = sim.aircraft.length >= 6 ? THEME.ACCENT_AMBER_HI : THEME.TEXT_PRIMARY;
    ctx.fillText(`${sim.aircraft.length} TRK`, rect.x + rect.width - pad, rect.y + 15);

    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(rect.x + pad, rect.y + 26);
    ctx.lineTo(rect.x + rect.width - pad, rect.y + 26);
    ctx.stroke();

    // 1. Dedicated Departure Queue Module at Top of Right Column
    const depTop = rect.y + 32;
    const depH = this.drawDepartureQueueModule(
      ctx,
      params,
      rect.x + pad,
      depTop,
      innerW,
      compact
    );

    // 2. Reserve Bottom 4-Line Scrolling MU-TH-UR Comms Teletype
    const teletypeH = compact ? 126 : 140;
    const teletypeY = rect.y + rect.height - pad - teletypeH;
    this.drawCommsTeletype(ctx, sim, rect.x + pad, teletypeY, innerW, teletypeH, timeSec);

    // 3. Flight Progress Strip Bay (between Departure Module and Teletype)
    const bayTop = depTop + depH + 6;
    const bayH = Math.max(74, teletypeY - 8 - bayTop);
    const strips = sim.getFlightStrips();

    if (strips.length === 0) {
      ctx.fillStyle = 'rgba(3, 10, 6, 0.90)';
      ctx.fillRect(rect.x + pad, bayTop, innerW, Math.min(68, bayH));
      ctx.strokeStyle = THEME.BORDER_SUBTLE;
      ctx.lineWidth = 1.0;
      ctx.strokeRect(rect.x + pad + 0.5, bayTop + 0.5, innerW - 1, Math.min(68, bayH) - 1);

      ctx.font = font('micro', 12);
      ctx.textAlign = 'center';
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      drawEllipsizedText(
        ctx,
        'SECTOR CLEAR — MONITORING',
        rect.x + rect.width * 0.5,
        bayTop + Math.min(68, bayH) * 0.5,
        innerW - 16
      );
    } else {
      const stripGap = compact ? 5 : 6;
      const desiredStripH = compact ? 50 : 56;
      const maxFit = Math.max(1, Math.floor((bayH + stripGap) / (desiredStripH + stripGap)));
      const visibleCount = Math.min(strips.length, maxFit);
      const stripH =
        visibleCount > 0
          ? Math.min(desiredStripH, Math.floor((bayH - stripGap * (visibleCount - 1)) / visibleCount))
          : desiredStripH;

      for (let i = 0; i < visibleCount; i++) {
        const sy = bayTop + i * (stripH + stripGap);
        this.drawSingleFlightStrip(ctx, strips[i], rect.x + pad, sy, innerW, stripH, params);
      }

      if (strips.length > visibleCount) {
        const overflowTxt = `+${strips.length - visibleCount} MORE CONTACTS IN SECTOR`;
        ctx.font = font('micro', 12);
        ctx.textAlign = 'center';
        ctx.fillStyle = THEME.ACCENT_AMBER;
        drawEllipsizedText(
          ctx,
          overflowTxt,
          rect.x + rect.width * 0.5,
          teletypeY - 12,
          innerW - 12
        );
      }
    }

    ctx.restore();
  }

  /**
   * Dedicated Departure Queue module at the top of the Right Column.
   * Returns consumed vertical height (`24px` when clear, `52px`/`48px` when queued).
   */
  private drawDepartureQueueModule(
    ctx: CanvasRenderingContext2D,
    params: ApproachHudRenderParams,
    x: number,
    y: number,
    w: number,
    compact: boolean
  ): number {
    const { sim, timeSec, hoveredButtonId, tutorialState } = params;
    const queue = sim.departureQueue;
    const highlightTut = Boolean(tutorialState?.highlightDepartureButton);

    ctx.save();
    if (queue.length === 0) {
      const h = 24;
      ctx.fillStyle = 'rgba(3, 10, 6, 0.92)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = THEME.BORDER_SUBTLE;
      ctx.lineWidth = 1.0;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      ctx.font = font('micro', 12);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = THEME.TEXT_MUTED;
      drawEllipsizedText(ctx, 'DEPARTURE QUEUE: CLEAR', x + 7, y + h * 0.5 + 0.5, w - 14);
      ctx.restore();
      return h;
    }

    const dep = queue[0];
    const rwyStatus = sim.getDepartureRunwayStatus(dep.runway);
    const isGapWindow = rwyStatus.clear && rwyStatus.gapWindowActive;
    const isFinalClear = rwyStatus.clear;
    const isFinalBusy = !rwyStatus.clear && rwyStatus.nearestInboundNm !== null;

    const h = compact ? 54 : 58;
    const btnId = APPROACH_UI_IDS.CLEAR_DEPARTURE;
    const hovered = hoveredButtonId === btnId;
    const pulse =
      0.5 +
      0.5 *
        Math.sin(
          timeSec * (dep.urgent || isFinalBusy || isGapWindow || highlightTut ? 11.0 : 5.5)
        );
    const waitFrac = Math.max(0, Math.min(1, dep.waitSec / Math.max(1, dep.maxWaitSec)));
    const remSec = Math.max(0, Math.ceil(dep.maxWaitSec - dep.waitSec));

    const queueSuffix = queue.length > 1 ? ` (+${queue.length - 1})` : '';
    const label = `${SEMIOTIC_ICONS.PLAY} CLEAR DEP · ${dep.callsign} RWY ${dep.runway}${queueSuffix}`;

    // Register full-module clickable hitbox (NEVER disabled — experts can always launch!)
    this.buttons.push({
      id: btnId,
      rect: { x, y, width: w, height: h },
      label,
    });

    const bg = hovered
      ? 'rgba(32, 92, 50, 0.94)'
      : dep.urgent
        ? pulse > 0.5
          ? 'rgba(116, 20, 10, 0.94)'
          : 'rgba(68, 22, 8, 0.92)'
        : highlightTut
          ? pulse > 0.5
            ? 'rgba(16, 66, 78, 0.96)'
            : 'rgba(12, 46, 56, 0.92)'
          : isGapWindow
            ? pulse > 0.5
              ? 'rgba(16, 64, 62, 0.95)'
              : 'rgba(54, 42, 8, 0.92)'
            : isFinalClear
              ? 'rgba(10, 44, 24, 0.94)'
              : pulse > 0.5
                ? 'rgba(78, 42, 6, 0.94)'
                : 'rgba(46, 24, 4, 0.92)';

    const border = hovered
      ? '#FFFFFF'
      : dep.urgent
        ? pulse > 0.5
          ? '#FF947D'
          : THEME.ALERT_RED_STROKE
        : highlightTut
          ? pulse > 0.5
            ? '#FFFFFF'
            : THEME.ACCENT_CYAN
          : isGapWindow
            ? pulse > 0.5
              ? THEME.ACCENT_AMBER_HI
              : '#55FFEE'
            : isFinalClear
              ? THEME.TEXT_PRIMARY
              : pulse > 0.5
                ? THEME.ACCENT_AMBER_HI
                : THEME.ACCENT_AMBER;

    const railCol = dep.urgent
      ? THEME.ALERT_RED_STROKE
      : highlightTut
        ? THEME.ACCENT_CYAN
        : isGapWindow
          ? pulse > 0.5
            ? THEME.ACCENT_AMBER_HI
            : '#55FFEE'
          : isFinalClear
            ? THEME.TEXT_PRIMARY
            : THEME.ACCENT_AMBER;

    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);

    // Left live-status accent rail
    ctx.fillStyle = railCol;
    ctx.fillRect(x, y, 4, h);

    ctx.strokeStyle = border;
    ctx.lineWidth = hovered || dep.urgent || isGapWindow || isFinalBusy || highlightTut ? 2.0 : 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // Top row: Primary Action Label (`CLEAR DEP · <CALLSIGN> RWY <X>`)
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font('button', 13);
    ctx.fillStyle = hovered
      ? '#FFFFFF'
      : dep.urgent
        ? '#FFF0EC'
        : highlightTut
          ? THEME.ACCENT_CYAN
          : isGapWindow
            ? THEME.ACCENT_AMBER_HI
            : isFinalClear
              ? THEME.TEXT_BRIGHT
              : THEME.ACCENT_AMBER_HI;
    drawEllipsizedText(ctx, label, x + 9, y + 14, w - 16);

    // Middle row: Live Runway Clear / Busy & Gap Launch Bonus Readout + Wait Countdown
    const statusText = isGapWindow
      ? 'GAP WINDOW · +300 [D]'
      : isFinalClear
        ? 'FINAL CLEAR · SAFE [D]'
        : isFinalBusy && rwyStatus.nearestInboundNm !== null
          ? `FINAL BUSY (${rwyStatus.nearestInboundNm.toFixed(1)} NM)`
          : 'FINAL BUSY';
    const statusColor = isGapWindow
      ? pulse > 0.5
        ? THEME.ACCENT_AMBER_HI
        : '#7CEEFF'
      : isFinalClear
        ? '#6BFF95'
        : pulse > 0.5
          ? THEME.ACCENT_AMBER_HI
          : THEME.ACCENT_AMBER;

    ctx.font = font('data', 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = statusColor;
    drawEllipsizedText(ctx, statusText, x + 9, y + h - 19, w - 48);

    ctx.font = font('micro', 12);
    ctx.textAlign = 'right';
    ctx.fillStyle = dep.urgent ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER_HI;
    ctx.fillText(`${remSec}S`, x + w - 7, y + h - 19);

    // Bottom Live Wait-Time Progress Bar
    const barX = x + 8;
    const barY = y + h - 8;
    const barW = w - 16;
    const barH = 4;
    ctx.fillStyle = 'rgba(4, 12, 8, 0.92)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = railCol;
    ctx.fillRect(barX, barY, Math.round(barW * waitFrac), barH);

    ctx.restore();
    return h;
  }

  private drawSingleFlightStrip(
    ctx: CanvasRenderingContext2D,
    strip: FlightStripData,
    x: number,
    y: number,
    w: number,
    h: number,
    params: ApproachHudRenderParams
  ): void {
    const stripBtnId = `${APPROACH_UI_IDS.STRIP_PREFIX}${strip.craftId}`;
    const speedBtnId = `${APPROACH_UI_IDS.SPEED_PREFIX}${strip.craftId}`;
    const speedDisabled = strip.inStorm || strip.state === 'LANDING';
    const speedHovered = !speedDisabled && params.hoveredButtonId === speedBtnId;
    const hovered =
      params.hoveredButtonId === stripBtnId ||
      speedHovered ||
      params.hoveredCraftId === strip.craftId;
    const selected = params.selectedCraftId === strip.craftId;
    const blinkFast = Math.sin(params.timeSec * 12) > 0;

    // 1. Push main strip hitbox FIRST (hitTestChromeButtons tests in reverse order so the smaller speed pill wins!)
    this.buttons.push({
      id: stripBtnId,
      rect: { x, y, width: w, height: h },
      label: `PING ${strip.callsign}`,
    });

    const isRed =
      strip.kind === 'MAYDAY' ||
      strip.fuelStatus === 'BINGO' ||
      strip.inConflict ||
      strip.inRestrictedZone;
    const isStormJammed = !isRed && strip.inStorm;
    const isMedevac = !isRed && !isStormJammed && strip.isMedevac;
    const isMedExpress = isMedevac && strip.medevacExpressTimerSec > 0;
    const isAmber =
      !isRed &&
      !isStormJammed &&
      (strip.fuelStatus === 'JOKER' || strip.state === 'GO_AROUND');
    const isHolding =
      !isRed &&
      !isStormJammed &&
      (strip.state === 'HOLDING' || strip.holdAltitudeSlot !== null) &&
      strip.assignedHoldFix !== null;
    const isLocked =
      strip.state === 'ESTABLISHED' || strip.state === 'LANDING' || strip.lockedTarget !== null;
    const holdMintCol = isCrt1979Typography() ? '#A4FFE6' : '#7EF0D0';

    const holdFlTag =
      strip.holdAltitudeSlot !== null
        ? `FL${Math.round(
            (HOLD_ALTITUDE_SLOTS_FT[strip.holdAltitudeSlot] ??
              APPROACH_CONSTANTS.HOLD_STACK_BASE_ALT_FT +
                strip.holdAltitudeSlot * APPROACH_CONSTANTS.HOLD_STACK_STEP_ALT_FT) / 100
          )}`
        : null;

    const accentBarCol = isRed
      ? blinkFast
        ? '#FF947D'
        : THEME.ALERT_RED_STROKE
      : isStormJammed
        ? '#B184FF'
        : isMedevac
          ? isMedExpress && blinkFast
            ? '#FFFFFF'
            : '#8CF8FF'
          : isAmber
            ? THEME.ACCENT_AMBER
            : isHolding
              ? holdMintCol
              : strip.isDeparture
                ? '#55FFEE'
                : strip.kind === 'HEAVY'
                  ? THEME.ACCENT_AMBER
                  : strip.kind === 'TUG'
                    ? THEME.ACCENT_CYAN
                    : THEME.TEXT_PRIMARY;

    const bgCol = isRed
      ? blinkFast
        ? 'rgba(92, 16, 10, 0.92)'
        : 'rgba(54, 12, 8, 0.88)'
      : isStormJammed
        ? 'rgba(22, 12, 46, 0.92)'
        : isMedevac
          ? 'rgba(8, 34, 42, 0.92)'
          : isAmber
            ? 'rgba(54, 28, 4, 0.84)'
            : hovered || selected || strip.isPinged
              ? 'rgba(18, 48, 28, 0.92)'
              : isHolding
                ? 'rgba(5, 24, 22, 0.94)'
                : 'rgba(5, 16, 10, 0.94)';

    const borderCol =
      hovered || selected
        ? '#FFFFFF'
        : strip.isPinged
          ? THEME.ACCENT_AMBER_HI
          : isRed
            ? THEME.ALERT_RED_STROKE
            : isStormJammed
              ? blinkFast
                ? '#7CEEFF'
                : '#9B6BFF'
              : isMedevac
                ? isMedExpress && blinkFast
                  ? '#FFFFFF'
                  : '#8CF8FF'
                : isAmber
                  ? THEME.ACCENT_AMBER
                  : isHolding
                    ? holdMintCol
                    : strip.isDeparture
                      ? '#55FFEE'
                      : isLocked
                        ? THEME.TEXT_PRIMARY
                        : THEME.BORDER_SUBTLE;

    ctx.save();
    ctx.fillStyle = bgCol;
    ctx.fillRect(x, y, w, h);

    // Left 4px urgency/profile bar
    ctx.fillStyle = accentBarCol;
    ctx.fillRect(x, y, 4, h);

    ctx.strokeStyle = borderCol;
    ctx.lineWidth =
      hovered || selected || strip.isPinged || isRed || isStormJammed || isMedExpress ? 1.6 : 1.1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    const row1Y = y + Math.round(h * 0.30);
    const row2Y = y + Math.round(h * 0.68);
    ctx.textBaseline = 'middle';

    // Row 1 Right: Status Badge Pill (with live `EXP 18s` countdown on MEDEVAC & `RF JAM` on Ion Static)
    const displayStatusTag = isRed
      ? strip.statusTag
      : isStormJammed
        ? 'RF JAM'
        : isMedExpress
          ? `EXP ${Math.max(1, Math.ceil(strip.medevacExpressTimerSec))}s`
          : isMedevac && !isLocked && !isHolding
            ? 'MEDEVAC'
            : strip.statusTag;

    ctx.font = font('micro', 12);
    const badgeW = Math.min(
      Math.floor(w * 0.44),
      Math.ceil(ctx.measureText(displayStatusTag).width) + 12
    );
    const badgeH = 19;
    const badgeX = x + w - badgeW - 6;
    const badgeY = Math.round(row1Y - badgeH * 0.5);

    ctx.fillStyle = isRed
      ? 'rgba(128, 20, 12, 0.94)'
      : isStormJammed
        ? 'rgba(34, 16, 68, 0.94)'
        : isMedExpress
          ? 'rgba(14, 62, 76, 0.96)'
          : isMedevac
            ? 'rgba(10, 44, 54, 0.94)'
            : isAmber
              ? 'rgba(76, 40, 4, 0.92)'
              : isHolding
                ? 'rgba(6, 38, 36, 0.94)'
                : strip.isDeparture
                  ? THEME.ACCENT_CYAN_BG
                  : isLocked
                    ? 'rgba(12, 46, 24, 0.94)'
                    : 'rgba(8, 24, 16, 0.92)';
    ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
    ctx.strokeStyle = isRed
      ? THEME.ALERT_RED_STROKE
      : isStormJammed
        ? '#B184FF'
        : isMedExpress
          ? '#FFFFFF'
          : isMedevac
            ? '#8CF8FF'
            : isAmber
              ? THEME.ACCENT_AMBER
              : isHolding
                ? holdMintCol
                : strip.isDeparture
                  ? '#55FFEE'
                  : isLocked
                    ? THEME.TEXT_PRIMARY
                    : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.0;
    ctx.strokeRect(badgeX + 0.5, badgeY + 0.5, badgeW - 1, badgeH - 1);

    ctx.textAlign = 'center';
    ctx.fillStyle = isRed
      ? '#FFF0EC'
      : isStormJammed
        ? '#7CEEFF'
        : isMedExpress
          ? '#FFFFFF'
          : isMedevac
            ? '#B8F8FF'
            : isAmber
              ? THEME.ACCENT_AMBER_HI
              : isHolding
                ? holdMintCol
                : strip.isDeparture
                  ? '#55FFEE'
                  : isLocked
                    ? THEME.TEXT_BRIGHT
                    : THEME.TEXT_SECONDARY;
    drawEllipsizedText(ctx, displayStatusTag, badgeX + badgeW * 0.5, row1Y + 0.5, badgeW - 6);

    // Row 1 Left: Callsign + Crisp White-Cyan `MED` Badge (when MEDEVAC) or Type Code
    let leftX = x + 9;
    if (strip.isMedevac) {
      const medTag = `${SEMIOTIC_ICONS.CROSS}MED`;
      ctx.font = font('micro', 12);
      const medW = Math.ceil(ctx.measureText(medTag).width) + 8;
      const medH = 17;
      const medY = Math.round(row1Y - medH * 0.5);
      ctx.fillStyle = 'rgba(18, 72, 86, 0.96)';
      ctx.fillRect(leftX, medY, medW, medH);
      ctx.strokeStyle = isMedExpress ? '#FFFFFF' : '#8CF8FF';
      ctx.lineWidth = 1.0;
      ctx.strokeRect(leftX + 0.5, medY + 0.5, medW - 1, medH - 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(medTag, leftX + medW * 0.5, row1Y + 0.5);

      const csX = leftX + medW + 5;
      const csAvailW = Math.max(36, badgeX - csX - 6);
      ctx.textAlign = 'left';
      ctx.font = font('data', 13);
      ctx.fillStyle = hovered || selected ? '#FFFFFF' : isRed ? '#FFF0EC' : '#E8FFFF';
      drawEllipsizedText(ctx, strip.callsign, csX, row1Y + 0.5, csAvailW);
    } else {
      const leftAvailW = Math.max(48, badgeX - leftX - 6);
      ctx.textAlign = 'left';
      ctx.font = font('data', 13);
      ctx.fillStyle =
        hovered || selected
          ? '#FFFFFF'
          : isRed
            ? '#FFF0EC'
            : isStormJammed
              ? '#E6D4FF'
              : strip.isDeparture
                ? '#55FFEE'
                : strip.kind === 'HEAVY'
                  ? THEME.ACCENT_AMBER_HI
                  : strip.kind === 'TUG'
                    ? THEME.ACCENT_CYAN
                    : THEME.TEXT_BRIGHT;
      drawEllipsizedText(ctx, `${strip.callsign} · ${strip.typeCode}`, leftX, row1Y + 0.5, leftAvailW);
    }

    // Row 2 Right: Fuel / Countdown Readout (non-lethal `LOCKED`/`NO DMG` when RF jammed, `0.35×` when holding)
    const fuelStr = strip.isDeparture
      ? 'CLIMB'
      : isStormJammed
        ? strip.lockedTarget || strip.assignedHoldFix
          ? 'LOCKED'
          : 'NO DMG'
        : strip.fuelStatus === 'BINGO' || strip.kind === 'MAYDAY'
          ? `${Math.max(1, Math.ceil(strip.fuelSec))}S BINGO`
          : strip.fuelStatus === 'JOKER'
            ? `${Math.ceil(strip.fuelSec)}S JOKER`
            : isHolding
              ? `0.35× ${strip.fuelPct}%`
              : `F:${strip.fuelPct}%`;

    ctx.font = font('micro', 12);
    const fuelW = Math.ceil(ctx.measureText(fuelStr).width) + 4;
    ctx.textAlign = 'right';
    ctx.fillStyle = isRed
      ? '#FFF0EC'
      : isStormJammed
        ? '#7CEEFF'
        : isAmber
          ? THEME.ACCENT_AMBER_HI
          : isHolding
            ? holdMintCol
            : strip.isDeparture
              ? '#55FFEE'
              : THEME.TEXT_SECONDARY;
    ctx.fillText(fuelStr, x + w - 7, row2Y + 0.5);

    // Row 2 Middle-Right: Clickable Speed Mode Pill (`SLOW` / `STD` / `FAST`)
    const speedLabel =
      strip.speedMode === 'SLOW' ? 'SLOW↓' : strip.speedMode === 'FAST' ? 'FAST↑' : 'STD';
    const speedW = 48;
    const speedH = 17;
    const speedX = Math.round(x + w - 7 - fuelW - 6 - speedW);
    const speedY = Math.round(row2Y - speedH * 0.5);

    // Register Speed Pill Hitbox AFTER Strip Hitbox so reverse-order hit-test hits speed pill first!
    this.buttons.push({
      id: speedBtnId,
      rect: { x: speedX, y: speedY, width: speedW, height: speedH },
      label: `SPEED ${strip.callsign} (${strip.speedMode})`,
      ...(speedDisabled ? { disabled: true } : {}),
    });

    ctx.fillStyle = speedDisabled
      ? isStormJammed
        ? 'rgba(26, 14, 52, 0.78)'
        : 'rgba(8, 16, 12, 0.72)'
      : speedHovered
        ? 'rgba(30, 74, 52, 0.96)'
        : strip.speedMode === 'SLOW'
          ? 'rgba(8, 42, 52, 0.94)'
          : strip.speedMode === 'FAST'
            ? 'rgba(68, 36, 4, 0.94)'
            : 'rgba(10, 26, 16, 0.90)';
    ctx.fillRect(speedX, speedY, speedW, speedH);
    ctx.strokeStyle = speedDisabled
      ? isStormJammed
        ? 'rgba(177, 132, 255, 0.45)'
        : 'rgba(42, 74, 52, 0.55)'
      : speedHovered
        ? '#FFFFFF'
        : strip.speedMode === 'SLOW'
          ? THEME.ACCENT_CYAN
          : strip.speedMode === 'FAST'
            ? THEME.ACCENT_AMBER
            : THEME.BORDER_SUBTLE;
    ctx.lineWidth = speedHovered || strip.speedMode !== 'STD' ? 1.3 : 1.0;
    ctx.strokeRect(speedX + 0.5, speedY + 0.5, speedW - 1, speedH - 1);

    ctx.textAlign = 'center';
    ctx.fillStyle = speedDisabled
      ? isStormJammed
        ? '#B184FF'
        : THEME.TEXT_MUTED
      : speedHovered
        ? '#FFFFFF'
        : strip.speedMode === 'SLOW'
          ? THEME.ACCENT_CYAN
          : strip.speedMode === 'FAST'
            ? THEME.ACCENT_AMBER_HI
            : THEME.TEXT_BRIGHT;
    ctx.fillText(speedLabel, speedX + speedW * 0.5, row2Y + 0.5);

    // Row 2 Left: Destination Label + FL35/45/55 Hold Indicator when stacked!
    const destText =
      holdFlTag !== null && strip.assignedHoldFix !== null
        ? `${holdFlTag} · ${strip.destLabel}`
        : strip.destLabel;
    const destAvailW = Math.max(36, speedX - leftX - 6);
    ctx.textAlign = 'left';
    ctx.fillStyle = isHolding
      ? holdMintCol
      : isMedevac
        ? '#8CF8FF'
        : isLocked
          ? THEME.TEXT_PRIMARY
          : THEME.TEXT_SECONDARY;
    drawEllipsizedText(ctx, destText, leftX, row2Y + 0.5, destAvailW);

    // Micro Fuel Gauge Bar along bottom inside edge
    const fuelFrac = strip.isDeparture ? 1 : Math.max(0, Math.min(1, strip.fuelPct / 100));
    const barW = w - 12;
    const barY = y + h - 5;
    ctx.fillStyle = 'rgba(4, 12, 8, 0.9)';
    ctx.fillRect(x + 7, barY, barW, 3);
    ctx.fillStyle = isRed
      ? THEME.ALERT_RED_STROKE
      : isStormJammed
        ? '#B184FF'
        : isMedevac
          ? '#8CF8FF'
          : isAmber
            ? THEME.ACCENT_AMBER
            : isHolding
              ? holdMintCol
              : strip.isDeparture
                ? '#55FFEE'
                : THEME.TEXT_PRIMARY;
    ctx.fillRect(x + 7, barY, Math.round(barW * fuelFrac), 3);

    ctx.restore();
  }

  private drawCommsTeletype(
    ctx: CanvasRenderingContext2D,
    sim: ApproachSimulation,
    x: number,
    y: number,
    w: number,
    h: number,
    timeSec: number
  ): void {
    const pulse = Math.sin(timeSec * 5) > 0;

    ctx.save();
    ctx.fillStyle = 'rgba(2, 8, 5, 0.96)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // Header bar
    ctx.fillStyle = 'rgba(8, 22, 13, 0.92)';
    ctx.fillRect(x + 1, y + 1, w - 2, 22);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.beginPath();
    ctx.moveTo(x + 1, y + 23);
    ctx.lineTo(x + w - 1, y + 23);
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    drawEllipsizedText(ctx, 'MU-TH-UR COMMS LOG', x + 7, y + 12.5, w - 34);

    ctx.textAlign = 'right';
    ctx.fillStyle = pulse ? THEME.TEXT_PRIMARY : THEME.TEXT_SECONDARY;
    ctx.fillText(SEMIOTIC_ICONS.DOT_LIVE, x + w - 8, y + 12.5);

    // 4-Line Scrolling Monospace Log
    const entries = sim.commsLog.slice(-4);
    const bodyTop = y + 28;
    const bodyH = h - 32;
    const rowH = Math.floor(bodyH / 4);

    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';

    if (entries.length === 0) {
      ctx.fillStyle = THEME.TEXT_MUTED;
      drawEllipsizedText(ctx, '> COMMS BUS STANDBY...', x + 7, bodyTop + rowH * 0.5, w - 14);
    } else {
      entries.forEach((entry, idx) => {
        const ry = bodyTop + idx * rowH + rowH * 0.5;
        const isLatest = idx === entries.length - 1;
        const col =
          entry.tone === 'red'
            ? THEME.ALERT_RED_TEXT
            : entry.tone === 'amber'
              ? THEME.ACCENT_AMBER_HI
              : entry.tone === 'cyan'
                ? THEME.ACCENT_CYAN
                : entry.tone === 'bright'
                  ? THEME.TEXT_BRIGHT
                  : THEME.TEXT_PRIMARY;

        if (isLatest) {
          ctx.fillStyle = 'rgba(18, 44, 26, 0.36)';
          ctx.fillRect(x + 2, bodyTop + idx * rowH, w - 4, rowH);
        }

        ctx.fillStyle = col;
        const cleanMsg = `${entry.timestamp} ${entry.text}`;
        drawEllipsizedText(ctx, cleanMsg, x + 7, ry + 0.5, w - 14);
      });
    }

    ctx.restore();
  }

  // ===========================================================================
  // INTERACTIVE TRAINING DRILL OVERLAY (STEPS 1–5 + STEP 6 FIELD MANUAL MODAL)
  // ===========================================================================
  private drawTutorialOverlay(
    ctx: CanvasRenderingContext2D,
    params: ApproachHudRenderParams,
    layout: ApproachHudLayout
  ): void {
    const tut = params.tutorialState;
    if (!tut || !tut.active) return;

    if (tut.graduated) {
      this.drawRapconFieldManualModal(ctx, params, 'GRADUATION');
      // Keep the 46px Top Chrome Bar 100% bright & clickable over the Graduation scrim!
      this.drawTopBar(ctx, params);
      return;
    }

    if (tut.scoringBreakdown) {
      this.drawTutorialScoringStepCard(ctx, params, layout, tut);
      return;
    }

    // Sleek, non-blocking top-center tactical directive card pinned inside upper scope margin
    const vp = layout.scopeViewport;
    const cardW = Math.min(780, vp.width - 24);
    const cardX = Math.round(vp.x + (vp.width - cardW) * 0.5);
    const cardY = vp.y + 8;
    const padX = 14;
    const pulse = 0.5 + 0.5 * Math.sin(params.timeSec * 6.5);

    ctx.save();
    const nextLabel = tut.nextButtonLabel ?? `${SEMIOTIC_ICONS.PLAY} GOT IT · NEXT`;
    ctx.font = font('micro', 12);
    const nextBtnW = tut.showNextButton
      ? Math.min(220, Math.max(158, Math.ceil(ctx.measureText(nextLabel).width) + 24))
      : 0;
    const instrAvailW = Math.max(180, cardW - padX * 2 - (nextBtnW > 0 ? nextBtnW + 14 : 0));

    ctx.font = font('prose', 13);
    const instrLines = wrapTextLines(ctx, tut.instruction, instrAvailW, 3);

    ctx.font = font('micro', 12);
    const subLines = tut.subHint ? wrapTextLines(ctx, tut.subHint, instrAvailW, 2) : [];

    const lineH = 16.5;
    const subLineH = 14.5;
    const bodyH =
      instrLines.length * lineH + (subLines.length > 0 ? 4 + subLines.length * subLineH : 0);
    const cardH = Math.max(80, 38 + bodyH + 10);

    // Tactical semi-opaque glass panel
    ctx.fillStyle = 'rgba(3, 15, 13, 0.94)';
    ctx.fillRect(cardX, cardY, cardW, cardH);

    // Left glowing cyan accent rail
    ctx.fillStyle = THEME.ACCENT_CYAN;
    ctx.fillRect(cardX, cardY, 4, cardH);

    // Outer frame + CAD corner brackets
    ctx.strokeStyle = 'rgba(76, 238, 255, 0.65)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(cardX + 0.5, cardY + 0.5, cardW - 1, cardH - 1);
    drawCornerBrackets(ctx, cardX, cardY, cardW, cardH, 10, THEME.ACCENT_CYAN, 1.8);

    // Top-right `[SKIP TO LIVE]` button
    const skipW = 114;
    const skipH = 22;
    const skipX = cardX + cardW - padX - skipW;
    const skipY = cardY + 7;
    drawChromeButton(
      ctx,
      { x: skipX, y: skipY, width: skipW, height: skipH },
      'SKIP TO LIVE',
      {
        id: APPROACH_UI_IDS.TUTORIAL_SKIP,
        accent: 'amber',
        hovered: params.hoveredButtonId === APPROACH_UI_IDS.TUTORIAL_SKIP,
        fontPx: 12,
      },
      this.buttons
    );

    // Top-left concise Step Pill (`DRILL 1/6`) so the full headline always fits cleanly!
    const shortTag = `DRILL ${tut.stepIndex + 1}/${tut.totalSteps}`;
    ctx.font = font('micro', 12);
    ctx.textBaseline = 'middle';
    const tagW = Math.ceil(ctx.measureText(shortTag).width) + 14;
    const tagX = cardX + padX;
    const tagY = cardY + 8;
    const tagH = 20;

    ctx.fillStyle = THEME.ACCENT_CYAN_BG;
    ctx.fillRect(tagX, tagY, tagW, tagH);
    ctx.strokeStyle = THEME.ACCENT_CYAN;
    ctx.lineWidth = 1.1;
    ctx.strokeRect(tagX + 0.5, tagY + 0.5, tagW - 1, tagH - 1);

    ctx.textAlign = 'center';
    ctx.fillStyle = THEME.ACCENT_CYAN;
    ctx.fillText(shortTag, tagX + tagW * 0.5, tagY + tagH * 0.5 + 0.5);

    const headX = tagX + tagW + 10;
    const headAvailW = Math.max(80, skipX - headX - 10);
    ctx.textAlign = 'left';
    ctx.font = font('head', 14);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    drawEllipsizedText(ctx, tut.headline, headX, tagY + tagH * 0.5 + 0.5, headAvailW);

    // Subtle divider below top row
    ctx.strokeStyle = 'rgba(76, 238, 255, 0.24)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(cardX + padX, cardY + 34);
    ctx.lineTo(cardX + cardW - padX, cardY + 34);
    ctx.stroke();

    // Wrapped Instruction lines (up to 3 full lines, zero mid-sentence truncation!)
    ctx.font = font('prose', 13);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#E8FFF0';
    let textY = cardY + 46;
    for (const ln of instrLines) {
      ctx.fillText(ln, cardX + padX, textY);
      textY += lineH;
    }

    // Wrapped Sub-Hint lines (up to 2 full lines!)
    if (subLines.length > 0) {
      textY += 2;
      ctx.font = font('micro', 12);
      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      for (const sln of subLines) {
        ctx.fillText(sln, cardX + padX, textY);
        textY += subLineH;
      }
    }

    // Optional Pulsing `[NEXT / GOT IT]` Button (vertically centered in body right rail!)
    if (tut.showNextButton) {
      const btnW = nextBtnW;
      const btnH = 32;
      const btnX = cardX + cardW - padX - btnW;
      const btnY = Math.round(cardY + 34 + (cardH - 34 - btnH) * 0.5);
      drawChromeButton(
        ctx,
        { x: btnX, y: btnY, width: btnW, height: btnH },
        nextLabel,
        {
          id: APPROACH_UI_IDS.TUTORIAL_NEXT,
          accent: pulse > 0.5 ? 'cyan' : 'green',
          active: true,
          hovered: params.hoveredButtonId === APPROACH_UI_IDS.TUTORIAL_NEXT,
          fontPx: 12,
        },
        this.buttons
      );
    }

    ctx.restore();
  }

  /**
   * Dedicated uncluttered tactical briefing card for DRILL 5/6 · SCORING, BONUSES & EFFICIENCY.
   * Centered cleanly over the slowed 0.08× radar scope — requires explicit [OPEN FIELD MANUAL / NEXT].
   */
  private drawTutorialScoringStepCard(
    ctx: CanvasRenderingContext2D,
    params: ApproachHudRenderParams,
    layout: ApproachHudLayout,
    tut: ApproachTutorialOverlayState
  ): void {
    const sb = tut.scoringBreakdown;
    if (!sb) return;

    const vp = layout.scopeViewport;
    const cardW = Math.min(844, vp.width - 24);
    const cardH = Math.min(486, vp.height - 24);
    const cardX = Math.round(vp.x + (vp.width - cardW) * 0.5);
    const cardY = Math.round(vp.y + (vp.height - cardH) * 0.5);
    const padX = 16;
    const innerW = cardW - padX * 2;
    const pulse = 0.5 + 0.5 * Math.sin(params.timeSec * 6.0);

    const toneColor = (tone: 'green' | 'cyan' | 'amber' | 'red'): string =>
      tone === 'red'
        ? THEME.ALERT_RED_TEXT
        : tone === 'amber'
          ? THEME.ACCENT_AMBER_HI
          : tone === 'cyan'
            ? THEME.ACCENT_CYAN
            : THEME.TEXT_PRIMARY;

    ctx.save();

    // Soft tactical panel backdrop over slowed radar scope
    ctx.fillStyle = 'rgba(3, 14, 12, 0.96)';
    ctx.fillRect(cardX, cardY, cardW, cardH);

    // Left cyan accent rail + crisp corner brackets
    ctx.fillStyle = THEME.ACCENT_CYAN;
    ctx.fillRect(cardX, cardY, 4, cardH);
    ctx.strokeStyle = 'rgba(76, 238, 255, 0.72)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cardX + 0.5, cardY + 0.5, cardW - 1, cardH - 1);
    drawCornerBrackets(ctx, cardX, cardY, cardW, cardH, 12, THEME.ACCENT_CYAN, 2.0);

    // Header Row: [DRILL 5/6] pill + headline + [SKIP TO LIVE]
    const skipW = 116;
    const skipH = 24;
    const skipX = cardX + cardW - padX - skipW;
    const skipY = cardY + 10;
    drawChromeButton(
      ctx,
      { x: skipX, y: skipY, width: skipW, height: skipH },
      'SKIP TO LIVE',
      {
        id: APPROACH_UI_IDS.TUTORIAL_SKIP,
        accent: 'amber',
        hovered: params.hoveredButtonId === APPROACH_UI_IDS.TUTORIAL_SKIP,
        fontPx: 12,
      },
      this.buttons
    );

    const shortTag = `DRILL ${tut.stepIndex + 1}/${tut.totalSteps}`;
    ctx.font = font('micro', 12);
    ctx.textBaseline = 'middle';
    const tagW = Math.ceil(ctx.measureText(shortTag).width) + 16;
    const tagX = cardX + padX;
    const tagY = cardY + 11;
    const tagH = 22;

    ctx.fillStyle = THEME.ACCENT_CYAN_BG;
    ctx.fillRect(tagX, tagY, tagW, tagH);
    ctx.strokeStyle = THEME.ACCENT_CYAN;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(tagX + 0.5, tagY + 0.5, tagW - 1, tagH - 1);
    ctx.textAlign = 'center';
    ctx.fillStyle = THEME.ACCENT_CYAN;
    ctx.fillText(shortTag, tagX + tagW * 0.5, tagY + tagH * 0.5 + 0.5);

    ctx.textAlign = 'left';
    ctx.font = font('head', 15);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    drawEllipsizedText(
      ctx,
      tut.headline,
      tagX + tagW + 10,
      tagY + tagH * 0.5 + 0.5,
      Math.max(80, skipX - (tagX + tagW + 10) - 10)
    );

    // Divider
    ctx.strokeStyle = 'rgba(76, 238, 255, 0.28)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(cardX + padX, cardY + 42);
    ctx.lineTo(cardX + cardW - padX, cardY + 42);
    ctx.stroke();

    const footerBtnH = 36;
    const footerY = cardY + cardH - padX - footerBtnH + 4;
    let curY = cardY + 50;

    // 1. Base Points Row (5 crisp color-coded telemetry tiles)
    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.fillText('BASE POINTS (PER CLEAN LANDING OR DEPARTURE)', cardX + padX, curY + 6);
    curY += 16;

    const tileGap = 6;
    const tileCount = sb.basePoints.length;
    const tileW = Math.floor((innerW - tileGap * (tileCount - 1)) / tileCount);
    const tileH = 44;
    sb.basePoints.forEach((bp, idx) => {
      const tx = cardX + padX + idx * (tileW + tileGap);
      const col = toneColor(bp.tone);
      ctx.fillStyle = 'rgba(6, 20, 14, 0.94)';
      ctx.fillRect(tx, curY, tileW, tileH);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(tx + 0.5, curY + 0.5, tileW - 1, tileH - 1);

      ctx.textAlign = 'center';
      ctx.font = font('micro', 12);
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      drawEllipsizedText(ctx, bp.label, tx + tileW * 0.5, curY + 13, tileW - 8);

      ctx.font = font('data', 14);
      ctx.fillStyle = col;
      drawEllipsizedText(ctx, bp.value, tx + tileW * 0.5, curY + 31, tileW - 8);
    });
    curY += tileH + 10;

    // 2. Clean Shift Multiplier Strip
    ctx.font = font('prose', 12);
    const multLines = wrapTextLines(ctx, sb.multiplierSummary, innerW - 22, 3);
    const multLineH = 17;
    const multBoxH = 12 + multLines.length * multLineH;
    ctx.fillStyle = 'rgba(10, 28, 18, 0.90)';
    ctx.fillRect(cardX + padX, curY, innerW, multBoxH);
    ctx.fillStyle = THEME.TEXT_PRIMARY;
    ctx.fillRect(cardX + padX, curY, 4, multBoxH);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#E8FFF0';
    multLines.forEach((ln, idx) => {
      ctx.fillText(ln, cardX + padX + 12, curY + 13 + idx * multLineH);
    });
    curY += multBoxH + 8;

    // 3. Skill Bonuses List (scales cleanly for 3–5 rows in both Modern Clean and 1979 CRT!)
    const tagColW = Math.min(212, Math.floor(innerW * 0.30));
    const detailX = cardX + padX + 10 + tagColW + 8;
    const detailAvailW = Math.max(120, innerW - tagColW - 28);
    ctx.font = font('prose', 12);
    const wrappedBonuses = sb.bonuses.map((b) => ({
      ...b,
      lines: wrapTextLines(ctx, b.detail, detailAvailW, 2),
    }));
    const reserveEffAndFooter = 86;
    const maxBonusBoxH = Math.max(88, footerY - 8 - reserveEffAndFooter - curY);
    const idealRowH = wrappedBonuses.some((b) => b.lines.length > 1) ? 31 : 25;
    const bonusRowH = Math.max(
      21,
      Math.min(
        idealRowH,
        Math.floor((maxBonusBoxH - 24) / Math.max(1, wrappedBonuses.length))
      )
    );
    const bonusBoxH = 22 + wrappedBonuses.length * bonusRowH + 4;
    ctx.fillStyle = 'rgba(5, 16, 13, 0.92)';
    ctx.fillRect(cardX + padX, curY, innerW, bonusBoxH);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.0;
    ctx.strokeRect(cardX + padX + 0.5, curY + 0.5, innerW - 1, bonusBoxH - 1);

    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.ACCENT_CYAN;
    ctx.fillText('SKILL BONUSES', cardX + padX + 10, curY + 12);

    wrappedBonuses.forEach((b, idx) => {
      const ry = curY + 23 + idx * bonusRowH + bonusRowH * 0.48;
      const col = toneColor(b.tone);
      ctx.font = font('data', 12);
      ctx.fillStyle = col;
      drawEllipsizedText(ctx, b.tag, cardX + padX + 10, ry, tagColW);

      ctx.font = font('prose', 12);
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      if (b.lines.length <= 1 || bonusRowH < 27) {
        drawEllipsizedText(ctx, b.detail, detailX, ry, detailAvailW);
      } else {
        ctx.fillText(b.lines[0], detailX, ry - 6.5);
        ctx.fillText(b.lines[1], detailX, ry + 7.5);
      }
    });
    curY += bonusBoxH + 8;

    // 4. Efficiency Clarification Callout (always shows full 3–4 wrapped lines cleanly above footer CTA!)
    const availEffH = footerY - 8 - curY;
    if (availEffH >= 38) {
      ctx.font = font('prose', 12);
      const effLineH = availEffH >= 74 ? 17.5 : 16;
      const maxEffLines = Math.max(2, Math.min(4, Math.floor((availEffH - 10) / effLineH)));
      const effLines = wrapTextLines(ctx, sb.efficiencyNote, innerW - 22, maxEffLines);
      const effH = Math.min(availEffH, 12 + effLines.length * effLineH);
      ctx.fillStyle = 'rgba(42, 24, 4, 0.72)';
      ctx.fillRect(cardX + padX, curY, innerW, effH);
      ctx.fillStyle = THEME.ACCENT_AMBER;
      ctx.fillRect(cardX + padX, curY, 4, effH);
      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      effLines.forEach((ln, idx) => {
        ctx.fillText(ln, cardX + padX + 12, curY + 13 + idx * effLineH);
      });
    }

    // 5. Explicit Self-Paced Footer Button (NEVER auto-advances!)
    const nextLabel = `${SEMIOTIC_ICONS.PLAY} ${tut.nextButtonLabel ?? 'OPEN FIELD MANUAL / NEXT [SPACE]'}`;
    const btnW = Math.min(innerW, 380);
    const btnX = Math.round(cardX + (cardW - btnW) * 0.5);
    drawChromeButton(
      ctx,
      { x: btnX, y: footerY, width: btnW, height: footerBtnH },
      nextLabel,
      {
        id: APPROACH_UI_IDS.TUTORIAL_NEXT,
        accent: pulse > 0.5 ? 'cyan' : 'green',
        active: true,
        hovered: params.hoveredButtonId === APPROACH_UI_IDS.TUTORIAL_NEXT,
        fontPx: 13,
      },
      this.buttons
    );

    ctx.restore();
  }

  // ===========================================================================
  // 3-TAB WIKI-STYLE RAPCON FIELD MANUAL & SCORING DEBRIEF MODAL
  // (Shared identically by Step 6 Graduation AND standalone Field Manual!)
  // ===========================================================================
  private drawRapconFieldManualModal(
    ctx: CanvasRenderingContext2D,
    params: ApproachHudRenderParams,
    mode: 'GRADUATION' | 'MANUAL'
  ): void {
    const { width: w, height: h, hoveredButtonId, tutorialState } = params;
    const isGrad = mode === 'GRADUATION';
    const lockoutSec = isGrad ? (tutorialState?.graduationLockoutSec ?? 0) : 0;
    const locked = isGrad && lockoutSec > 0.01;
    const activeTab = Math.max(0, Math.min(2, Math.floor(params.manualTab ?? 0)));

    const metrics = drawModalFrame(
      ctx,
      w,
      h,
      {
        title: isGrad
          ? 'CERTIFICATION COMPLETE // RAPCON FIELD MANUAL'
          : 'LV-118 RAPCON FIELD MANUAL & SCORING',
        subtitle: isGrad
          ? 'DRILL 6/6 · SELF-PACED SCORING & OPERATIONS REFERENCE · [1–3] / [← →] TABS'
          : 'SIMULATION PAUSED · [1–3] / [← →] SWITCH TABS · [ESC] CLOSE',
        maxWidth: 900,
        maxHeight: 590,
        scrimTopY: TOP_CHROME_BAR_HEIGHT,
        accentColor: THEME.ACCENT_CYAN,
        rightBadge: isGrad
          ? locked
            ? { text: `LOCKED ${lockoutSec.toFixed(1)}S`, tone: 'amber' }
            : { text: `${SEMIOTIC_ICONS.STAR} QUALIFIED`, tone: 'cyan' }
          : { text: `${SEMIOTIC_ICONS.DIAMOND} FIELD MANUAL`, tone: 'cyan' },
      },
      this.buttons
    );

    const { contentX, contentY, contentW, footerY } = metrics;

    // 1. 3 Clickable Wiki-Style Tabs (`[1] SCORING & BONUSES`, `[2] FLEET, SPEED & HOLDS`, `[3] AIRSPACE, RUNWAYS & SEALS`)
    const tabs: ReadonlyArray<{ idx: number; label: string }> = [
      { idx: 0, label: '[1] SCORING & BONUSES' },
      { idx: 1, label: '[2] FLEET, SPEED & HOLDS' },
      { idx: 2, label: '[3] AIRSPACE, RUNWAYS & SEALS' },
    ];
    const tabY = contentY - 4;
    const tabH = 30;
    const tabGap = 6;
    const tabW = Math.floor((contentW - tabGap * 2) / 3);

    tabs.forEach((t, i) => {
      const tx = contentX + i * (tabW + tabGap);
      const tw = i === 2 ? contentW - (tabW + tabGap) * 2 : tabW;
      const tabId = `${APPROACH_UI_IDS.MANUAL_TAB_PREFIX}${t.idx}`;
      const isSelected = activeTab === t.idx;
      drawChromeButton(
        ctx,
        { x: tx, y: tabY, width: tw, height: tabH },
        t.label,
        {
          id: tabId,
          accent: isSelected ? 'cyan' : 'muted',
          active: isSelected,
          hovered: hoveredButtonId === tabId,
          fontPx: 12,
        },
        this.buttons
      );
    });

    // Active tab content viewport
    const bodyY = tabY + tabH + 8;
    const bodyH = Math.max(180, footerY - 10 - bodyY);

    if (activeTab === 0) {
      this.drawManualTabScoring(ctx, contentX, bodyY, contentW, bodyH);
    } else if (activeTab === 1) {
      this.drawManualTabFleet(ctx, contentX, bodyY, contentW, bodyH);
    } else {
      this.drawManualTabAirspace(ctx, contentX, bodyY, contentW, bodyH);
    }

    // 2. Self-Paced Footer Buttons (NEVER snaps away; 0.8s arrival lockout protects Graduation buttons!)
    const btnH = 36;
    const btnGap = 8;
    if (isGrad) {
      const launchW = Math.floor(contentW * 0.44);
      const remW = contentW - launchW - btnGap * 2;
      const replayW = Math.floor(remW * 0.48);
      const menuW = remW - replayW;

      drawChromeButton(
        ctx,
        { x: contentX, y: footerY, width: launchW, height: btnH },
        locked
          ? `${SEMIOTIC_ICONS.PLAY} LAUNCH LIVE RANKED SHIFT`
          : `${SEMIOTIC_ICONS.PLAY} LAUNCH LIVE RANKED SHIFT [ENTER]`,
        {
          id: APPROACH_UI_IDS.TUTORIAL_LAUNCH_RANKED,
          accent: 'amber',
          active: !locked,
          disabled: locked,
          hovered: hoveredButtonId === APPROACH_UI_IDS.TUTORIAL_LAUNCH_RANKED,
          fontPx: 13,
        },
        this.buttons
      );

      drawChromeButton(
        ctx,
        { x: contentX + launchW + btnGap, y: footerY, width: replayW, height: btnH },
        `${SEMIOTIC_ICONS.REPLAY} REPLAY DRILL`,
        {
          id: APPROACH_UI_IDS.TUTORIAL_REPLAY,
          accent: 'cyan',
          disabled: locked,
          hovered: hoveredButtonId === APPROACH_UI_IDS.TUTORIAL_REPLAY,
          fontPx: 13,
        },
        this.buttons
      );

      drawChromeButton(
        ctx,
        {
          x: contentX + launchW + btnGap + replayW + btnGap,
          y: footerY,
          width: menuW,
          height: btnH,
        },
        '◄ BRIEFING MENU',
        {
          id: APPROACH_UI_IDS.TUTORIAL_BRIEFING_MENU,
          accent: 'green',
          disabled: locked,
          hovered: hoveredButtonId === APPROACH_UI_IDS.TUTORIAL_BRIEFING_MENU,
          fontPx: 13,
        },
        this.buttons
      );
    } else {
      const ctrlW = Math.min(220, Math.floor(contentW * 0.34));
      const closeW = contentW - ctrlW - btnGap;

      drawChromeButton(
        ctx,
        { x: contentX, y: footerY, width: ctrlW, height: btnH },
        '[H] CONTROLS CARD',
        {
          id: APPROACH_UI_IDS.TITLE_CONTROLS,
          accent: 'cyan',
          hovered: hoveredButtonId === APPROACH_UI_IDS.TITLE_CONTROLS,
          fontPx: 13,
        },
        this.buttons
      );

      drawChromeButton(
        ctx,
        { x: contentX + ctrlW + btnGap, y: footerY, width: closeW, height: btnH },
        '[ESC] CLOSE FIELD MANUAL',
        {
          id: APPROACH_UI_IDS.MANUAL_CLOSE,
          accent: 'green',
          active: true,
          hovered: hoveredButtonId === APPROACH_UI_IDS.MANUAL_CLOSE,
          fontPx: 13,
        },
        this.buttons
      );
    }
  }

  private drawManualPanelBox(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    accent: string
  ): void {
    ctx.fillStyle = THEME.BG_ROW_ALT;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.fillStyle = accent;
    ctx.fillRect(x, y, 3, h);

    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = accent;
    drawEllipsizedText(ctx, title, x + 10, y + 13, w - 18);

    ctx.strokeStyle = 'rgba(42, 118, 68, 0.42)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 23);
    ctx.lineTo(x + w - 8, y + 23);
    ctx.stroke();
  }

  private drawManualTabScoring(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    ctx.save();
    const gap = 8;
    const topH = Math.round(Math.min(156, Math.max(134, h * 0.36)));
    const midH = Math.round(Math.min(164, Math.max(134, h * 0.39)));
    const botH = Math.max(72, h - topH - midH - gap * 2);

    const colGap = 10;
    const leftW = Math.floor((w - colGap) * 0.455);
    const rightX = x + leftW + colGap;
    const rightW = w - leftW - colGap;

    // 1. Top-Left: Base Landing & Departure Points Table
    this.drawManualPanelBox(ctx, x, y, leftW, topH, 'BASE LANDING & DEPARTURE POINTS', THEME.TEXT_PRIMARY);
    const baseRows: Array<{ label: string; pts: string; color: string }> = [
      { label: 'UD-4 DROPSHIP (PAD α)', pts: '350 PTS', color: THEME.TEXT_PRIMARY },
      { label: 'SALVAGE TUG (CRADLE)', pts: '425 PTS', color: THEME.ACCENT_CYAN },
      { label: 'HEAVY HAULER (ILS RWY)', pts: '500 PTS', color: THEME.ACCENT_AMBER_HI },
      { label: 'MAYDAY POD (ANY OPEN)', pts: '1,200 (3×)', color: THEME.ALERT_RED_TEXT },
      { label: 'CLEAN DEPARTURE ([D])', pts: '450 PTS', color: '#55FFEE' },
    ];
    const rowAreaH = topH - 28;
    const rowStep = Math.floor(rowAreaH / baseRows.length);
    ctx.textBaseline = 'middle';
    baseRows.forEach((r, idx) => {
      const ry = y + 28 + idx * rowStep + rowStep * 0.46;
      ctx.font = font('micro', 12);
      ctx.textAlign = 'left';
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      drawEllipsizedText(ctx, r.label, x + 10, ry, leftW - 108);

      ctx.font = font('data', 12);
      ctx.textAlign = 'right';
      ctx.fillStyle = r.color;
      ctx.fillText(r.pts, x + leftW - 10, ry);
    });

    // 2. Top-Right: Clean Shift Multiplier & Streak Comeback Commendations
    this.drawManualPanelBox(
      ctx,
      rightX,
      y,
      rightW,
      topH,
      'CLEAN MULT (1–5×) & STREAK COMMENDATIONS',
      THEME.ACCENT_AMBER_HI
    );
    const multRows: Array<{ delta: string; rule: string; color: string }> = [
      { delta: '+0.25×', rule: 'Clean landing or departure (no CA)', color: THEME.TEXT_PRIMARY },
      { delta: '5/10/15', rule: 'Streak bonuses: +500 / +1,000 / +1,500', color: THEME.ACCENT_CYAN },
      { delta: '20 STK', rule: '+1 ICC SEAL +2,000 (+2,500 FLAWLESS at 3/3!)', color: '#7EF0D0' },
      { delta: '-0.50×', rule: '<3 NM CA or R-118 (-0.25× dep >38s)', color: THEME.ALERT_RED_TEXT },
      { delta: '1.50×', rule: '1979 CRT Mode multiplies ALL score!', color: THEME.ACCENT_AMBER_HI },
    ];
    const mStep = Math.floor((topH - 28) / multRows.length);
    const ruleOffset = 78;
    multRows.forEach((m, idx) => {
      const ry = y + 28 + idx * mStep + mStep * 0.46;
      ctx.font = font('data', 12);
      ctx.textAlign = 'left';
      ctx.fillStyle = m.color;
      ctx.fillText(m.delta, rightX + 10, ry);

      ctx.font = font('prose', 12);
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      drawEllipsizedText(ctx, m.rule, rightX + ruleOffset, ry, rightW - ruleOffset - 10);
    });

    // 3. Middle: Skill & Tactical Bonuses Table (all 5 active hooks!)
    const midY = y + topH + gap;
    this.drawManualPanelBox(
      ctx,
      x,
      midY,
      w,
      midH,
      'SKILL & TACTICAL BONUSES (ADDED BEFORE 1.5× 1979 CRT MULT)',
      THEME.ACCENT_CYAN
    );
    const bonuses: Array<{ tag: string; desc: string; color: string }> = [
      {
        tag: '+800 MEDEVAC EXPRESS',
        desc: 'Land MEDEVAC on Pad α or any active RWY within 25s (0 penalty after).',
        color: '#8CF8FF',
      },
      {
        tag: '+300 GAP LAUNCH',
        desc: 'Launch departure [D] within 6.0s of touchdown on clear final (× mult).',
        color: '#55FFEE',
      },
      {
        tag: '+500 SEQUENCED',
        desc: 'Tight same-zone landing w/o CA (9.5s RWY · 8.2s Cradle · 6.0s Pad α).',
        color: THEME.ACCENT_CYAN,
      },
      {
        tag: '+250 TEXTBOOK 30° ILS',
        desc: 'Heavy Hauler outer-FAF localizer lock at 12°–36° angle (1×/Heavy).',
        color: THEME.TEXT_PRIMARY,
      },
      {
        tag: '+750 FUMES SAVE',
        desc: 'Touch down a BINGO or MAYDAY flight with <= 5.0s fuel (gold wave).',
        color: THEME.ACCENT_AMBER_HI,
      },
    ];
    const bStep = Math.floor((midH - 28) / bonuses.length);
    const tagColW = Math.min(216, Math.floor(w * 0.27));
    const descX = x + 10 + tagColW + 10;
    const descAvailW = w - tagColW - 30;
    bonuses.forEach((b, idx) => {
      const ry = midY + 27 + idx * bStep + bStep * 0.46;
      ctx.font = font('data', 12);
      ctx.textAlign = 'left';
      ctx.fillStyle = b.color;
      drawEllipsizedText(ctx, b.tag, x + 10, ry, tagColW);

      ctx.font = font('prose', 12);
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      drawEllipsizedText(ctx, b.desc, descX, ry, descAvailW);
    });

    // 4. Bottom: Speed / Holding Efficiency Clarification Callout
    const botY = midY + midH + gap;
    ctx.fillStyle = 'rgba(42, 24, 4, 0.72)';
    ctx.fillRect(x, botY, w, botH);
    ctx.strokeStyle = THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x + 0.5, botY + 0.5, w - 1, botH - 1);
    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.fillRect(x, botY, 4, botH);

    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.fillText('DOES SPEED OR HOLDING MULTIPLY POINTS?', x + 12, botY + 14);

    ctx.font = font('prose', 12);
    ctx.fillStyle = '#FFF4DA';
    const noteText =
      "Speed (SLOW/STD/FAST) and stacked holds (0.35× fuel) don't multiply points directly — use them to stage waves cleanly, chain +800 MEDEVAC / +300 GAP / +500 SEQ bonuses, and reach 20 Clean Ops to restore +1 ICC Safety Seal.";
    const noteLineH = botH >= 88 ? 17.5 : 15.5;
    const maxNoteLines = Math.max(2, Math.min(3, Math.floor((botH - 24) / noteLineH)));
    const noteLines = wrapTextLines(ctx, noteText, w - 24, maxNoteLines);
    noteLines.forEach((ln, idx) => {
      ctx.fillText(ln, x + 12, botY + 32 + idx * noteLineH);
    });

    ctx.restore();
  }

  private drawManualTabFleet(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    ctx.save();
    const gap = 8;
    const topH = Math.round(Math.min(204, Math.max(170, h * 0.48)));
    const botY = y + topH + gap;
    const botH = Math.max(138, h - topH - gap);

    // 1. Top Full-Width Table: 4 Fleet Profiles + Auto Turn-Radius Smoothing
    this.drawManualPanelBox(
      ctx,
      x,
      y,
      w,
      topH,
      'FLEET PROFILES, TURN ENVELOPES & ENDURANCE',
      THEME.ACCENT_CYAN
    );

    const colCraft = x + 10;
    const colSpd = x + Math.round(w * 0.195);
    const colTurn = x + Math.round(w * 0.295);
    const colGate = x + Math.round(w * 0.575);
    const colFuel = x + Math.round(w * 0.785);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    const hdrY = y + 34;
    ctx.fillText('CRAFT', colCraft, hdrY);
    ctx.fillText('SPEED', colSpd, hdrY);
    ctx.fillText('TURN RATE / RADIUS', colTurn, hdrY);
    ctx.fillText('GATE', colGate, hdrY);
    ctx.fillText('FUEL / JKR / BNG', colFuel, hdrY);

    const profiles: Array<{
      craft: string;
      spd: string;
      turn: string;
      gate: string;
      fuel: string;
      color: string;
    }> = [
      {
        craft: 'UD-4 DROPSHIP',
        spd: '220 KT',
        turn: 'TIGHT · 66°/s (~0.48 NM)',
        gate: 'PAD α (MED: ANY)',
        fuel: '115s · 40s · 18s',
        color: THEME.TEXT_PRIMARY,
      },
      {
        craft: 'SALVAGE TUG',
        spd: '175 KT',
        turn: 'MED · 42°/s (~0.60 NM)',
        gate: 'CRADLE (240°)',
        fuel: '135s · 45s · 20s',
        color: THEME.ACCENT_CYAN,
      },
      {
        craft: 'HEAVY HAULER',
        spd: '150 KT',
        turn: 'WIDE · 26°/s (~0.83 NM)',
        gate: 'ILS >5NM FAF',
        fuel: '165s · 52s · 24s',
        color: THEME.ACCENT_AMBER_HI,
      },
      {
        craft: 'MAYDAY POD',
        spd: '260 KT',
        turn: 'AGILE · 72°/s (~0.52 NM)',
        gate: 'ANY OPEN',
        fuel: '30s+ BINGO!',
        color: THEME.ALERT_RED_TEXT,
      },
    ];

    const smoothNoteH = 42;
    const rowsAvailH = topH - 46 - smoothNoteH;
    const rStep = Math.floor(rowsAvailH / profiles.length);
    profiles.forEach((p, idx) => {
      const ry = y + 48 + idx * rStep + rStep * 0.45;
      if (idx % 2 === 1) {
        ctx.fillStyle = 'rgba(12, 30, 20, 0.45)';
        ctx.fillRect(x + 6, y + 44 + idx * rStep, w - 12, rStep);
      }
      ctx.font = font('data', 12);
      ctx.fillStyle = p.color;
      drawEllipsizedText(ctx, p.craft, colCraft, ry, colSpd - colCraft - 6);

      ctx.font = font('micro', 12);
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      drawEllipsizedText(ctx, p.spd, colSpd, ry, colTurn - colSpd - 6);
      drawEllipsizedText(ctx, p.turn, colTurn, ry, colGate - colTurn - 6);
      drawEllipsizedText(ctx, p.gate, colGate, ry, colFuel - colGate - 6);
      ctx.fillStyle = p.color === THEME.ALERT_RED_TEXT ? THEME.ALERT_RED_TEXT : THEME.TEXT_SECONDARY;
      drawEllipsizedText(ctx, p.fuel, colFuel, ry, x + w - colFuel - 8);
    });

    // Automatic turn-radius path smoothing callout inside Fleet panel (2 wrapped lines — zero ellipsis!)
    const smY = y + topH - smoothNoteH;
    ctx.fillStyle = 'rgba(8, 30, 36, 0.72)';
    ctx.fillRect(x + 6, smY, w - 12, smoothNoteH - 4);
    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.ACCENT_CYAN;
    const smLines = wrapTextLines(
      ctx,
      'AUTO TURN-RADIUS SMOOTHING: Sharp drags dynamically curve to each craft’s real turn radius (wider on Heavy / FAST — zero waypoint orbit loops).',
      w - 24,
      2
    );
    if (smLines.length <= 1) {
      ctx.fillText(smLines[0] ?? '', x + 12, smY + (smoothNoteH - 4) * 0.5 + 0.5);
    } else {
      ctx.fillText(smLines[0], x + 12, smY + 11);
      ctx.fillText(smLines[1], x + 12, smY + 27);
    }

    // 2. Bottom Left: Tactical Speed Modes
    const colGap = 10;
    const leftW = Math.floor((w - colGap) * 0.45);
    const rightX = x + leftW + colGap;
    const rightW = w - leftW - colGap;

    this.drawManualPanelBox(
      ctx,
      x,
      botY,
      leftW,
      botH,
      'SPEED MODES (SCROLL / [S] / [F] / STRIP)',
      THEME.ACCENT_AMBER_HI
    );

    const speedRows: Array<{ pill: string; stats: string; desc: string; color: string }> = [
      {
        pill: 'SLOW',
        stats: '0.76× SPD · 0.85× FUEL',
        desc: 'Opens spacing cleanly & saves endurance.',
        color: THEME.ACCENT_CYAN,
      },
      {
        pill: 'STD',
        stats: '1.00× SPD · 1.00× FUEL',
        desc: 'Standard approach cruise & turn radius.',
        color: THEME.TEXT_PRIMARY,
      },
      {
        pill: 'FAST',
        stats: '1.22× SPD · 1.22× FUEL',
        desc: 'Beat MEDEVAC / BINGO or chain +500 SEQ.',
        color: THEME.ACCENT_AMBER_HI,
      },
    ];
    const spStep = Math.floor((botH - 32) / speedRows.length);
    speedRows.forEach((s, idx) => {
      const sy = botY + 32 + idx * spStep;
      ctx.font = font('data', 12);
      ctx.fillStyle = s.color;
      ctx.fillText(s.pill, x + 10, sy + 8);

      ctx.font = font('micro', 12);
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      drawEllipsizedText(ctx, s.stats, x + 64, sy + 8, leftW - 74);

      ctx.font = font('prose', 12);
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      const dLines = wrapTextLines(ctx, s.desc, leftW - 20, 2);
      if (dLines.length <= 1) {
        ctx.fillText(dLines[0] ?? '', x + 10, sy + 26);
      } else {
        ctx.fillText(dLines[0], x + 10, sy + 24);
        ctx.fillText(dLines[1], x + 10, sy + 40);
      }
    });

    // 3. Bottom Right: 3 Vertically Stacked Holding Fixes & RMB / [W] Smart Hold
    this.drawManualPanelBox(
      ctx,
      rightX,
      botY,
      rightW,
      botH,
      'STACKED HOLDS (KRATO/BOREA/VEXIS) & RMB/[W]',
      '#7EF0D0'
    );
    const holdBullets = [
      '3 Stacked Fixes (KRATO, BOREA, VEXIS): 3.5K/4.5K/5.5K ft (3/3 max), ZERO CA between stacked levels!',
      '0.35× max-endurance fuel burn in hold — stage waves cleanly during flips, storms, or MAYDAYs.',
      'RMB (Blip or Strip) / [W] = Smart Hold / Safe Wave-Off: conflict- & MOA-safe route into nearest open fix.',
      'Ladder-Down Drag: dragging off a stacked fix automatically grabs the lowest-fuel craft first!',
    ];
    ctx.font = font('prose', 12);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    let hy = botY + 33;
    const hLineStep = botH >= 195 ? 16.5 : 15;
    for (const bullet of holdBullets) {
      if (hy > botY + botH - 8) break;
      const lines = wrapTextLines(ctx, `• ${bullet}`, rightW - 20, 2);
      for (const ln of lines) {
        if (hy > botY + botH - 6) break;
        ctx.fillText(ln, rightX + 10, hy);
        hy += hLineStep;
      }
      hy += 4;
    }

    ctx.restore();
  }

  private drawManualTabAirspace(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    ctx.save();
    const gap = 8;
    const topH = Math.round(Math.min(206, Math.max(170, h * 0.49)));
    const botY = y + topH + gap;
    const botH = Math.max(134, h - topH - gap);

    const colGap = 10;
    const leftW = Math.floor((w - colGap) * 0.48);
    const rightX = x + leftW + colGap;
    const rightW = w - leftW - colGap;

    const drawBullets = (
      bx: number,
      by: number,
      bw: number,
      bh: number,
      bullets: Array<{ lead: string; text: string; color: string }>
    ): void => {
      let cy = by + 33;
      const lineStep = bh >= 190 ? 16.5 : 15;
      for (const b of bullets) {
        if (cy > by + bh - 8) break;
        // Measure wrap in bold `data` font so line 0 (`data` lead + `prose` body) NEVER overflows or clips!
        ctx.font = font('data', 12);
        const full = `${b.lead} ${b.text}`;
        const lines = wrapTextLines(ctx, full, bw - 20, 2);
        lines.forEach((ln, idx) => {
          if (cy > by + bh - 6) return;
          if (idx === 0) {
            ctx.font = font('data', 12);
            ctx.fillStyle = b.color;
            const leadW = Math.min(bw - 24, Math.ceil(ctx.measureText(b.lead).width));
            ctx.fillText(b.lead, bx + 10, cy);
            const rest = ln.slice(b.lead.length).trimStart();
            if (rest) {
              ctx.font = font('prose', 12);
              ctx.fillStyle = THEME.TEXT_BRIGHT;
              ctx.fillText(rest, bx + 10 + leadW + 5, cy);
            }
          } else {
            ctx.font = font('prose', 12);
            ctx.fillStyle = THEME.TEXT_BRIGHT;
            ctx.fillText(ln, bx + 10, cy);
          }
          cy += lineStep;
        });
        cy += 4.5;
      }
    };

    // 1. Top-Left: Expanded Airspace & Dual Runways
    this.drawManualPanelBox(
      ctx,
      x,
      y,
      leftW,
      topH,
      'AIRSPACE, DUAL RUNWAYS & REVERSALS',
      THEME.TEXT_PRIMARY
    );
    drawBullets(x, y, leftW, topH, [
      {
        lead: 'RECTANGULAR PPI:',
        text: 'Full ~34×30 NM radar scope with 5/10/15 NM rings.',
        color: THEME.TEXT_PRIMARY,
      },
      {
        lead: 'PRIMARY RWY 27/09:',
        text: 'Heavies lock ILS outside 5 NM FAF at <=45°.',
        color: THEME.ACCENT_AMBER_HI,
      },
      {
        lead: 'CHARLIE RWY 36/18:',
        text: 'Opens at 15 LND with quartering headwinds.',
        color: THEME.ACCENT_CYAN,
      },
      {
        lead: 'DELTA WIND FLIPS:',
        text: '10s warning; <2.5 NM DH lands, outer safe wave-off.',
        color: THEME.ACCENT_AMBER_HI,
      },
    ]);

    // 2. Top-Right: LETHAL RED vs NON-LETHAL VIOLET Hazards & Departures
    this.drawManualPanelBox(
      ctx,
      rightX,
      y,
      rightW,
      topH,
      'HAZARDS: LETHAL RED vs NON-LETHAL VIOLET',
      '#B184FF'
    );
    drawBullets(rightX, y, rightW, topH, [
      {
        lead: 'R-118 // HOT (RED):',
        text: 'LETHAL SW MOA. Entry -0.5×; 2.8s cracks Seal!',
        color: THEME.ALERT_RED_TEXT,
      },
      {
        lead: 'ION STATIC (VIOLET):',
        text: 'NON-LETHAL (0 DMG)! Comms jam only — locked paths fly safely through.',
        color: '#C49BFF',
      },
      {
        lead: 'BOGEYS & 2-SHIPS:',
        text: 'DELTA+. No-XPDR bogeys (>=3 NM) & paired dropships.',
        color: THEME.ACCENT_AMBER_HI,
      },
      {
        lead: 'DEPARTURES [D]:',
        text: 'Live FINAL CLEAR/BUSY (+450; +300 GAP <6s).',
        color: '#55FFEE',
      },
    ]);

    // 3. Bottom Full-Width: 3.0 NM Separation, Comeback Seals & De-Clumped Phase Arc
    this.drawManualPanelBox(
      ctx,
      x,
      botY,
      w,
      botH,
      'SEPARATION, COMEBACK SEALS & 5-PHASE SHIFT ARC',
      THEME.ACCENT_AMBER_HI
    );

    const sealBullets: Array<{ lead: string; text: string; color: string }> = [
      {
        lead: '3.0 NM SEPARATION:',
        text: '<3.0 NM triggers CA (-0.50× mult); <0.85 NM collides. Vertically stacked holds (3.5K/4.5K/5.5K) have ZERO CA!',
        color: THEME.ACCENT_AMBER_HI,
      },
      {
        lead: 'ICC SEALS & COMEBACK:',
        text: 'Collisions, Flameouts, or R-118 crack 1 Seal & reset mult. Reach 20 Clean Ops to restore +1 Seal (+2,000)!',
        color: THEME.ALERT_RED_TEXT,
      },
      {
        lead: '5-PHASE ARC:',
        text: 'ALPHA (0–5) → BRAVO (6–14: Tugs, Violet Ion Static, MEDEVAC) → CHARLIE (15–26: RWY 36/18, MAYDAY) → DELTA (27–41: Flips, 2-Ships, Bogeys) → ECHO (42+: Saturation).',
        color: THEME.ACCENT_CYAN,
      },
    ];
    drawBullets(x, botY, w, botH, sealBullets);

    ctx.restore();
  }

  // ===========================================================================
  // PRE-LAUNCH BRIEFING OVERLAY (keeps 46px Top Chrome Bar bright & clickable!)
  // ===========================================================================
  private drawBriefingOverlay(
    ctx: CanvasRenderingContext2D,
    params: ApproachHudRenderParams
  ): void {
    const { width: w, height: h, hoveredButtonId, leaderboard } = params;
    const metrics = drawModalFrame(
      ctx,
      w,
      h,
      {
        title: 'BOREALIS APPROACH // LV-118 RAPCON',
        subtitle: 'SECTOR 118 TERMINAL RADAR APPROACH CONTROL — BOREALIS BASIN',
        maxWidth: 740,
        maxHeight: 526,
        scrimTopY: TOP_CHROME_BAR_HEIGHT,
        accentColor: THEME.ACCENT_AMBER,
        rightBadge: { text: `${SEMIOTIC_ICONS.STAR} RANKED`, tone: 'amber' },
      },
      this.buttons
    );

    const { contentX, contentY, contentW, footerY } = metrics;
    let curY = contentY - 4;

    drawRankedTitleRibbon(
      ctx,
      contentX,
      curY,
      contentW,
      24,
      `${SEMIOTIC_ICONS.STAR} OFFICIAL RANKED RAPCON SHIFT — LOGGED TO ORBITAL RELAY ${SEMIOTIC_ICONS.STAR}`,
      params.timeSec,
      true
    );
    curY += 32;

    // Live #01 Global Leader Ticker
    const leader = leaderboard.getReigningLeader();
    const uplink = leaderboard.getStatus();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font('data', 12);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    const leadBanner = leader
      ? `#01 GLOBAL LEADER: ${leader.callsign} — ${leader.score.toLocaleString()} PTS (${leader.landed} LND · ${leader.maxMult.toFixed(2)}X · INFO ${leader.phase})`
      : uplink === 'LOADING'
        ? 'SYNCING ORBITAL RELAY LEADERBOARD...'
        : '#01 GLOBAL LEADER: UNCLAIMED — TAKE COMMAND OF LV-118 RAPCON';
    drawEllipsizedText(ctx, leadBanner, contentX + contentW * 0.5, curY + 9, contentW - 8);
    ctx.restore();
    curY += 23;

    const secH = 36;
    const priH = 40;
    const bonusH = 32;
    const priY = footerY - priH - 6;
    const bonusY = priY - bonusH - 6;
    const crt1979On = params.crtPreset === 'CLASSIC_1979';

    // 3 Crisp Briefing Cards (100% wrapped via wrapTextLines in matching font!)
    const cards: Array<{ tag: string; accent: string; body: string }> = [
      {
        tag: 'ILS, MEDEVAC & MULTI-RUNWAY OPS',
        accent: THEME.TEXT_PRIMARY,
        body: 'Drag aircraft to matching gates: Dropships to Pad α, Tugs to Salvage Cradle, MEDEVAC to Pad α OR any RWY (+800 Express), and Heavies onto RWY 09/27 (+ RWY 36/18 at Phase Charlie) outside 5 NM FAF at ≤45°.',
      },
      {
        tag: 'RMB / [W] SMART HOLD, STACKING & DEPARTURES',
        accent: THEME.ACCENT_CYAN,
        body: 'Right-click (Blip or Strip) or press [W] for conflict- & MOA-safe Smart Hold into KRATO, BOREA, or VEXIS (3.5K/4.5K/5.5K ft, 0 CA, 0.35× fuel). Adjust speed (Scroll/[S]/[F]) & launch [D] on FINAL CLEAR (+300 Gap Bonus).',
      },
      {
        tag: 'LETHAL RED vs VIOLET ION STATIC & COMEBACK SEALS',
        accent: THEME.ACCENT_AMBER_HI,
        body: 'Avoid lethal crimson R-118 // HOT & <3 NM CA. Violet ION STATIC deals ZERO damage (comms jam only — locked paths fly safely through). Chain 20 Clean Ops to restore +1 ICC Safety Seal (+2,000)!',
      },
    ];

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font('prose', 13);
    const wrappedCards = cards.map((c) => ({
      ...c,
      lines: wrapTextLines(ctx, c.body, contentW - 24, 4),
    }));

    const availCardsH = Math.max(140, bonusY - 8 - curY);
    const totalLines = wrappedCards.reduce((sum, c) => sum + c.lines.length, 0);
    const cardGap = 6;
    const compact = totalLines * 17 + wrappedCards.length * 26 + cardGap * 2 > availCardsH;
    const lineH = compact ? 15.5 : 17.5;
    const topOffset = compact ? 14 : 16;
    const bottomPad = compact ? 6 : 8;

    for (const c of wrappedCards) {
      const blockH = topOffset + 3 + c.lines.length * lineH + bottomPad;
      if (curY + blockH > bonusY - 2) break;

      ctx.fillStyle = THEME.BG_ROW_ALT;
      ctx.fillRect(contentX, curY, contentW, blockH);
      ctx.fillStyle = c.accent;
      ctx.fillRect(contentX, curY, 4, blockH);

      ctx.font = font('micro', 12);
      ctx.fillStyle = c.accent;
      ctx.fillText(c.tag, contentX + 12, curY + topOffset);

      ctx.font = font('prose', 13);
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      c.lines.forEach((ln, idx) => {
        ctx.fillText(ln, contentX + 12, curY + topOffset + 3 + (idx + 1) * lineH);
      });

      curY += blockH + cardGap;
    }
    ctx.restore();

    // 1979 CRT Challenge 1.5X Banner
    draw1979RankedBonusBanner(
      ctx,
      { x: contentX, y: bonusY, width: contentW, height: bonusH },
      crt1979On,
      hoveredButtonId,
      params.timeSec,
      this.buttons
    );

    // Primary CTA: ► LAUNCH SHIFT [ENTER] (instant Skip to Live Ranked Shift!)
    drawChromeButton(
      ctx,
      { x: contentX, y: priY, width: contentW, height: priH },
      crt1979On
        ? `${SEMIOTIC_ICONS.PLAY} LAUNCH SHIFT [ENTER] · 1.5X 1979 BONUS`
        : `${SEMIOTIC_ICONS.PLAY} LAUNCH SHIFT [ENTER]`,
      {
        id: APPROACH_UI_IDS.LAUNCH_SHIFT,
        accent: 'amber',
        active: true,
        hovered: hoveredButtonId === APPROACH_UI_IDS.LAUNCH_SHIFT,
        fontPx: 15,
      },
      this.buttons
    );

    // Secondary Row: [★ TRAINING DRILL] | [FIELD MANUAL] | [★ LEADERBOARD]
    const gap = 8;
    const firstVisit = Boolean(params.isFirstVisit);
    const pulseFirst = Math.sin(params.timeSec * 6.0) > 0;
    const drillW = Math.floor(contentW * 0.40);
    const remW = contentW - drillW - gap * 2;
    const manualW = Math.floor(remW * 0.48);
    const lbW = remW - manualW;

    drawChromeButton(
      ctx,
      { x: contentX, y: footerY, width: drillW, height: secH },
      firstVisit
        ? `${SEMIOTIC_ICONS.STAR} TRAINING DRILL · NEW`
        : `${SEMIOTIC_ICONS.PLAY} TRAINING DRILL`,
      {
        id: APPROACH_UI_IDS.TRAINING_DRILL,
        accent: firstVisit ? (pulseFirst ? 'amber' : 'cyan') : 'cyan',
        active: firstVisit,
        hovered: hoveredButtonId === APPROACH_UI_IDS.TRAINING_DRILL,
        fontPx: 13,
      },
      this.buttons
    );

    drawChromeButton(
      ctx,
      { x: contentX + drillW + gap, y: footerY, width: manualW, height: secH },
      `${SEMIOTIC_ICONS.DIAMOND} FIELD MANUAL`,
      {
        id: APPROACH_UI_IDS.OPEN_MANUAL,
        accent: 'cyan',
        hovered: hoveredButtonId === APPROACH_UI_IDS.OPEN_MANUAL,
        fontPx: 13,
      },
      this.buttons
    );

    drawChromeButton(
      ctx,
      { x: contentX + drillW + gap + manualW + gap, y: footerY, width: lbW, height: secH },
      `${SEMIOTIC_ICONS.STAR} LEADERBOARD`,
      {
        id: APPROACH_UI_IDS.TITLE_LEADERBOARD,
        accent: 'green',
        hovered: hoveredButtonId === APPROACH_UI_IDS.TITLE_LEADERBOARD,
        fontPx: 13,
      },
      this.buttons
    );
  }

  // ===========================================================================
  // UNIFIED [ESC] SYSTEM & PAUSE MENU
  // ===========================================================================
  private drawUnifiedSystemMenu(
    ctx: CanvasRenderingContext2D,
    params: ApproachHudRenderParams
  ): void {
    const { width: w, height: h, sim } = params;
    drawSystemMenuModal(
      ctx,
      w,
      h,
      {
        programTitle: 'BOREALIS APPROACH',
        activeProgramId: 'approach',
        crtPreset: params.crtPreset,
        crtModeLocked: params.crtModeLocked,
        phosphorTheme: params.phosphorTheme,
        masterVolume: params.masterVolume,
        audioMuted: params.audioMuted,
        musicEnabled: params.musicEnabled,
        atcMuted: params.atcMuted,
        isFullscreen: params.isFullscreen,
        hoveredButtonId: params.hoveredButtonId,
        canRestart: sim.phase !== 'TITLE',
        canReturnToGameMenu: sim.phase !== 'TITLE',
        confirmGameMenuPending: params.confirmGameMenuPending,
        confirmExitPending: params.confirmExitPending,
        restartLabel: `${SEMIOTIC_ICONS.REPLAY} RESTART SHIFT`,
        leaderboardLabel: `${SEMIOTIC_ICONS.STAR} LEADERBOARD`,
      },
      this.buttons
    );
  }

  // ===========================================================================
  // UNIFIED [H] / [?] CONTROLS QUICK-CARD
  // ===========================================================================
  private drawControlsQuickCard(
    ctx: CanvasRenderingContext2D,
    params: ApproachHudRenderParams
  ): void {
    const spec: ControlsCardSpec = {
      programTitle: 'BOREALIS APPROACH',
      leftColumnTitle: 'RADAR VECTORING & SMART HOLD',
      rightColumnTitle: 'DEPARTURES, SPEED & SYSTEM',
      leftControls: [
        { keys: 'DRAG BLIP', action: 'Draw vector path; snap ILS, Pad α, Cradle, or Hold Fix' },
        { keys: 'RMB / [W]', action: 'Smart Hold · Safe Wave-Off (0.35× Fuel, Blip or Strip)' },
        { keys: 'SNAP FIX', action: 'Drop on KRATO, BOREA, or VEXIS (3-level stack, 0 CA)' },
        { keys: 'CLICK STRIP', action: 'Ping contact on radar or toggle speed pill' },
        { keys: 'SCROLL / S / F', action: 'Step craft speed SLOW / STD / FAST' },
      ],
      rightControls: [
        { keys: 'D', action: 'Clear Departure (watch FINAL CLEAR / +300 GAP WINDOW)' },
        { keys: 'P', action: 'Pause / Resume RAPCON Simulation' },
        { keys: 'H / ?', action: 'Toggle Controls Quick-Card' },
        { keys: 'M', action: 'Mute / Unmute VHF/UHF & Ambience Bus' },
        { keys: 'ESC', action: 'Unified System & Pause Menu ([1-5] Switch)' },
      ],
      coreRules: [
        '3 Vertically Stacked Holding Fixes (KRATO, BOREA, VEXIS): 3.5K/4.5K/5.5K ft (3/3 max), ZERO CA between levels, 0.35× fuel; drag grabs lowest fuel first.',
        'RED = LETHAL (R-118 // HOT MOA, <3 NM CA, BINGO). VIOLET ION STATIC = NON-LETHAL (0 DMG — comms jam only; pre-locked paths fly safely through!).',
        'Bonuses: +800 MEDEVAC EXPRESS (25s, 0 penalty), +300 GAP LAUNCH (<6s), +500 SEQ, +750 FUMES, & 20 Clean Ops restores +1 ICC Safety Seal!',
      ],
      wikiButtonLabel: 'OPEN SCORING & FIELD MANUAL',
      wikiButtonId: APPROACH_UI_IDS.OPEN_MANUAL,
      hoveredButtonId: params.hoveredButtonId,
    };

    drawControlsCardModal(ctx, params.width, params.height, spec, this.buttons);
  }

  // ===========================================================================
  // UNIFIED POST-RUN DEBRIEF MODAL (SHIFT TERMINATED // ICC MISHAP BOARD)
  // ===========================================================================
  private drawGameOverDebrief(
    ctx: CanvasRenderingContext2D,
    params: ApproachHudRenderParams
  ): void {
    const { width: w, height: h, sim } = params;
    const stats: DebriefStatCard[] = [
      { label: 'FINAL SCORE', value: sim.score.toLocaleString(), accent: 'amber' },
      { label: 'LANDED', value: String(sim.landedCount), accent: 'green' },
      { label: 'PEAK MULT', value: `${sim.maxMultiplier.toFixed(2)}X`, accent: 'cyan' },
      { label: 'ATIS PHASE', value: `INFO ${sim.shiftPhase}`, accent: 'amber' },
    ];

    drawGameOverDebriefModal(
      ctx,
      w,
      h,
      {
        title: 'SHIFT TERMINATED // ICC MISHAP BOARD',
        subtitle: `LV-118 RAPCON DEBRIEF · DEP: ${sim.departuresCleared} · SEQ: ${sim.sequencedCount} · MED: ${sim.medevacExpressCount} · BEST STK: ${sim.bestCleanStreak}`,
        outcomeTone: 'red',
        timeSec: params.timeSec,
        keylockRemainingSec: sim.gameOverLockoutTimer,
        stats,
        isRanked: !sim.trainingMode,
        score: sim.score,
        callsignDraft: params.callsignDraft,
        callsignEditing: params.callsignEditing,
        scoreSubmitted: params.scoreSubmitted,
        submittingScore: params.submittingScore,
        statusBanner: params.submitResultBanner,
        statusBannerTone: params.submitResultTone,
        hoveredButtonId: params.hoveredButtonId,
        playAgainLabel: `${SEMIOTIC_ICONS.REPLAY} PLAY AGAIN [R]`,
        submitLabel: `${SEMIOTIC_ICONS.PLAY} LOG SCORE [ENTER]`,
      },
      this.buttons
    );
  }

  // ===========================================================================
  // UNIFIED GLOBAL LEADERBOARD MODAL (BOREALIS APPROACH // LEADERBOARD)
  // ===========================================================================
  private drawGlobalLeaderboardModal(
    ctx: CanvasRenderingContext2D,
    params: ApproachHudRenderParams
  ): void {
    const { width: w, height: h, leaderboard, lastSubmittedRun, sim } = params;
    const { entries, showingArchiveFallback } = leaderboard.getEntries();
    const rawStatus = leaderboard.getStatus();
    const uplinkStatus: UplinkStatus =
      rawStatus === 'LIVE' && !showingArchiveFallback
        ? 'LIVE'
        : rawStatus === 'LOADING'
          ? 'SYNCING'
          : 'LOCAL';

    let matchedJustIdx = -1;
    if (lastSubmittedRun) {
      if (lastSubmittedRun.docId) {
        matchedJustIdx = entries.findIndex((e) => e.id === lastSubmittedRun.docId);
      }
      if (matchedJustIdx === -1) {
        matchedJustIdx = entries.findIndex(
          (e) =>
            e.callsign.toUpperCase() === lastSubmittedRun.callsign.toUpperCase() &&
            e.score === lastSubmittedRun.score &&
            e.landed === lastSubmittedRun.landed
        );
      }
    }

    const rows: ManifestRowData[] = entries.slice(0, 12).map((e, idx) => ({
      rank: idx + 1,
      callsign: e.callsign,
      score: e.score,
      stats: [String(e.landed), `${e.maxMult.toFixed(2)}X`, e.phase],
      isJustAdded: idx === matchedJustIdx,
      isLocalFallback: e.isArchiveFallback,
    }));

    let justAddedBanner: string | null = null;
    if (lastSubmittedRun) {
      const dispRank = matchedJustIdx >= 0 ? matchedJustIdx + 1 : lastSubmittedRun.rank;
      const rankTag = `#${String(dispRank).padStart(2, '0')}`;
      justAddedBanner = `${SEMIOTIC_ICONS.STAR} RECORD LOGGED: RANK ${rankTag} — ${lastSubmittedRun.callsign} // ${lastSubmittedRun.score.toLocaleString()} PTS (${lastSubmittedRun.landed} LND · ${lastSubmittedRun.maxMult.toFixed(2)}X · INFO ${lastSubmittedRun.phase}) ${SEMIOTIC_ICONS.STAR}`;
    }

    drawGlobalManifestModal(
      ctx,
      w,
      h,
      {
        title: 'BOREALIS APPROACH // LEADERBOARD',
        uplinkStatus,
        timeSec: params.timeSec,
        columns: [
          { header: 'LANDED', widthFrac: 0.34, align: 'right' },
          { header: 'MULT', widthFrac: 0.30, align: 'right' },
          { header: 'PHASE', widthFrac: 0.36, align: 'right' },
        ],
        rows,
        justAddedBanner,
        showPlayAgain: sim.phase === 'GAME_OVER' || sim.phase === 'TITLE',
        playAgainLabel: `${SEMIOTIC_ICONS.PLAY} PLAY AGAIN [R / ENTER]`,
        closeLabel: '[ESC] CLOSE',
        hoveredButtonId: params.hoveredButtonId,
      },
      this.buttons
    );
  }
}
