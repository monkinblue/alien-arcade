import { PHYSICS } from '../constants';
import {
  evaluateLanderAvionics,
  evaluateLandingEnvelope,
  type LanderAvionicsSnapshot,
} from '../physics/avionics';
import type { CrtPreset, PhosphorTheme } from '../shell/Cartridge';
import type {
  BezelState,
  CrewManifestEntry,
  GamePhase,
  LanderState,
  LandingEvaluation,
  LandingPad,
  LastSubmittedRun,
  LeaderboardMode,
  MenuModeSelection,
  SafeAreaInsets,
  SectorConfig,
  SectorScoreBreakdown,
  TouchdownSnapshot,
  ViewportRect,
} from '../types';
import { BootLogoRenderer } from './BootLogoRenderer';
import { CampaignMapRenderer } from './CampaignMapRenderer';
import {
  CONTROLS_STRIP_HEIGHT,
  drawChromeButton,
  drawControlsCardModal,
  drawGameOverDebriefModal,
  drawGlobalManifestModal,
  drawModalFrame,
  drawPauseBanner,
  drawPersistentControlsStrip,
  drawStatusToast,
  drawSystemMenuModal,
  draw1979RankedBonusBanner,
  drawTopChromeBar,
  TOP_CHROME_BAR_HEIGHT,
  type ChromeButtonHitbox,
  type ControlsCardSpec,
  type ControlsStripItem,
  type DebriefStatCard,
  type ManifestColumnDef,
  type ManifestRowData,
  type SystemMenuExtraRow,
  type UplinkStatus,
} from './chrome';
import { MobileHudRenderer, type MobileActiveTouchState } from './MobileHudRenderer';
import { drawRankedTitleRibbon } from './RankedBadge';
import {
  drawAnnunciatorStrip,
  drawCornerBrackets,
  drawEllipsizedText,
  font,
  SEMIOTIC_ICONS,
  THEME,
  wrapTextLines,
  type AnnunciatorLamp,
} from './theme';

export interface CrtInteractiveButton {
  id: string;
  rect: ViewportRect;
  label: string;
  disabled?: boolean;
}

export interface HudLayoutMetrics {
  hudScale: number;
  centerScale: number;
  marginX: number;
  topHeaderY: number;
  sidePanelW: number;
  sidePanelH: number;
  safeLeftPx: number;
  safeRightPx: number;
  safeWidthPx: number;
  safeTopPx: number;
  safeBottomPx: number;
  safeHeightPx: number;
}

export interface AvionicsWarningItem {
  text: string;
  critical: boolean;
}

export interface HudRenderContext {
  phase: GamePhase;
  width: number;
  height: number;
  timeSec: number;
  sector: SectorConfig;
  lander: LanderState;
  bezel: BezelState;
  crtPreset: CrtPreset;
  crtModeLocked: boolean;
  ranked1979BonusActive: boolean;
  phosphorTheme: PhosphorTheme;
  masterVolume: number;
  musicEnabled: boolean;
  controlsCardOpen: boolean;
  confirmExitPending: boolean;
  confirmGameMenuPending: boolean;
  inlineTeletypeHold: boolean;
  pulseSafetyLockSec: number;
  debriefKeylockSec: number;
  debriefOutcome: 'BREACH' | 'VICTORY' | 'ABORT';
  callsignEditing: boolean;
  manifestOpenedPostRun: boolean;
  mobileRadarHintTimer: number;
  statusBannerTone: 'green' | 'amber' | 'red' | 'cyan';
  cameraZoom: number;
  sectorElapsedSec: number;
  missionScore: number;
  displayedScore: number;
  dropStreak: number;
  lives: number;
  maxLives: number;
  lifeLostFlashTimer: number;
  isPracticeRun: boolean;
  endlessMode: boolean;
  highestSectorCode: string;
  avgAccuracyPercent: number;
  avgAccuracyRating: string;
  selectedMenuMode: MenuModeSelection;
  selectedStartSector: number;
  menuCursor: number;
  mobileMode: boolean;
  isFullscreen: boolean;
  safeAreaInsets: SafeAreaInsets;
  mobileTouchState: MobileActiveTouchState;
  bootPoweredOn: boolean;
  bootElapsedSec: number;
  crtWarmupProgress: number;
  bootProgressChars: number;
  briefingProgressChars: number;
  tallyAnimProgress: number;
  lastBreakdown: SectorScoreBreakdown | null;
  lastFailure: LandingEvaluation | null;
  touchdownSnapshot: TouchdownSnapshot | null;
  emBlackoutActive: boolean;
  activeCalloutText: string | null;
  activeCalloutTimer: number;
  statusBannerText: string | null;
  statusBannerTimer: number;
  callsignDraft: string;
  playerSavedCallsign: string;
  uplinkConnectionStatus: 'LOADING' | 'LIVE' | 'OFFLINE';
  campaignLeader: CrewManifestEntry | null;
  endlessLeader: CrewManifestEntry | null;
  manifestTab: LeaderboardMode;
  manifestEntries: readonly CrewManifestEntry[];
  manifestShowingArchive: boolean;
  lastSubmittedRun: LastSubmittedRun | null;
  uplinkSubmitState: 'IDLE' | 'TRANSMITTING' | 'CONFIRMED' | 'OFFLINE_SAVED';
  uplinkConfirmText: string | null;
  sessionLogs: readonly string[];
  hoveredButtonId: string | null;
}

export const BOOT_LINES = [
  'USCSS NOSTROMO // REG. 180924609 // COMMERCIAL TOWING VEHICLE',
  'MU-TH-UR 6000 MAINFRAME // 2.1 TB CORE AWAKENING SEQUENCE',
  'MOUNTING MAGNETIC TAPE REELS 01-04 ............. LOCKED',
  'DECODING ACOUSTIC BEACON // ZETA II RETICULI ... LV-426',
  'SPECIAL ORDER 937 // PRIORITY ONE: ORBITAL DESCENT SURVEY',
  'CALIBRATING NARCISSUS DROP-SHUTTLE TELEMETRY ... NOMINAL',
  'INTERFACE 2037 READY // AWAITING FLIGHT OFFICER DIRECTIVE.',
];

const LANDER_FLIGHT_CONTROLS_STRIP: readonly ControlsStripItem[] = [
  { key: 'W', label: 'Thrust', accent: 'amber' },
  { key: 'A/D', label: 'Roll', accent: 'green' },
  { key: 'S', label: 'Retro', accent: 'green' },
  { key: 'LMB', label: 'Radar', accent: 'cyan' },
  { key: 'SPACE', label: '1X Pulse', accent: 'amber' },
  { key: 'H', label: 'Controls', accent: 'cyan' },
  { key: 'ESC', label: 'Menu', accent: 'amber' },
];

const LANDER_TITLE_CONTROLS_STRIP: readonly ControlsStripItem[] = [
  { key: '1-3', label: 'Mode', accent: 'amber' },
  { key: '←/→', label: 'Practice Sector', accent: 'green' },
  { key: 'ENTER', label: 'Launch', accent: 'amber' },
  { key: 'H', label: 'Controls', accent: 'cyan' },
  { key: 'M', label: 'Mute', accent: 'green' },
  { key: 'ESC', label: 'System Menu', accent: 'amber' },
];

export const LANDER_CONTROLS_SPEC: Omit<ControlsCardSpec, 'hoveredButtonId'> = {
  programTitle: 'LV-426 LUNAR LANDER',
  leftColumnTitle: 'SHUTTLE FLIGHT CONTROLS',
  rightColumnTitle: 'SYSTEM & ARCADE KEYS',
  leftControls: [
    { keys: 'W / ↑', action: 'Main Thruster (+SHIFT: Overdrive)' },
    { keys: 'A / D', action: 'RCS Roll Left / Right' },
    { keys: 'S / ↓', action: 'Retro-Brake Stabilizer' },
    { keys: 'LMB', action: 'Aim & Ping Directional Radar' },
    { keys: 'SPACE', action: '1X Emergency Pulse (0.6s Arm)' },
    { keys: 'SCROLL', action: 'Manual Camera Zoom (1X–3.5X)' },
  ],
  rightControls: [
    { keys: 'P', action: 'Quick Pause / Resume' },
    { keys: 'H / ?', action: 'Toggle Controls Quick-Card' },
    { keys: 'M', action: 'Toggle Master Audio Mute' },
    { keys: 'ESC', action: 'System Menu (CRT / SAS / Quit)' },
    { keys: 'TAB', action: 'Switch Campaign / Endless Tab' },
    { keys: 'R / ENT', action: 'Instant Replay (Post-Run)' },
  ],
  coreRules: [
    `Touchdown GO limits: Descent ≤ ${PHYSICS.SAFE_VS_MAX.toFixed(1)} m/s, Drift ≤ ${PHYSICS.SAFE_HS_MAX.toFixed(1)} m/s, Attitude ≤ ${PHYSICS.SAFE_ANGLE_DEG.toFixed(0)}° inside the landing pad.`,
    `Soft Kiss (+1,500 bonus): V/S ≤ ${PHYSICS.KISS_VS_MAX.toFixed(1)}, H/S ≤ ${PHYSICS.KISS_HS_MAX.toFixed(1)}, ATT ≤ ${PHYSICS.KISS_ANGLE_DEG.toFixed(0)}° inside the green ILS centerline window.`,
    'Refill propellant on ✚ Fuel Depots and ping Radar [LMB] to map pitch-black caverns & EM blackouts.',
  ],
};

const LANDER_MANIFEST_COLUMNS: readonly ManifestColumnDef[] = [
  { header: 'SECTOR', widthFrac: 0.30, align: 'center' },
  { header: 'ACC', widthFrac: 0.34, align: 'center' },
  { header: 'DATE', widthFrac: 0.36, align: 'right' },
];

export class HudRenderer {
  public buttons: CrtInteractiveButton[] = [];
  public touchControls: CrtInteractiveButton[] = [];
  private bootLogoRenderer = new BootLogoRenderer();
  private campaignMapRenderer = new CampaignMapRenderer();
  private mobileHudRenderer = new MobileHudRenderer();

  /**
   * Slimmed ~210px Nostromo side racks (+240px central flight corridor!) with lifted hudScale
   * floor (>=0.80) guaranteeing >=12px effective typography across every display size.
   */
  public static computeLayoutMetrics(crtWidth: number, crtHeight: number): HudLayoutMetrics {
    const baseSideW = 210;
    const baseSideH = 600;
    const marginX = Math.max(8, Math.round(crtWidth * 0.01));
    const topHeaderY = TOP_CHROME_BAR_HEIGHT + 6; // 52px
    const bottomReservedH = CONTROLS_STRIP_HEIGHT + 10; // 32px

    const scaleW = (crtWidth * 0.18) / baseSideW;
    const scaleH = (crtHeight - topHeaderY - bottomReservedH) / baseSideH;
    const hudScale = Math.max(0.80, Math.min(1.04, Math.min(scaleW, scaleH)));

    const sidePanelW = Math.round(baseSideW * hudScale);
    const sidePanelH = Math.round(baseSideH * hudScale);
    const safeLeftPx = marginX + sidePanelW + 10;
    const safeRightPx = crtWidth - marginX - sidePanelW - 10;
    const safeWidthPx = Math.max(220, safeRightPx - safeLeftPx);

    const centerScale = Math.max(
      0.80,
      Math.min(1.06, Math.min(safeWidthPx / 620, hudScale * 1.04))
    );
    const safeTopPx = topHeaderY + Math.round(166 * centerScale);
    const safeBottomPx = crtHeight - CONTROLS_STRIP_HEIGHT - 38;
    const safeHeightPx = Math.max(140, safeBottomPx - safeTopPx);

    return {
      hudScale,
      centerScale,
      marginX,
      topHeaderY,
      sidePanelW,
      sidePanelH,
      safeLeftPx,
      safeRightPx,
      safeWidthPx,
      safeTopPx,
      safeBottomPx,
      safeHeightPx,
    };
  }

  public static computeAvionicsWarnings(
    lander: LanderState,
    emBlackoutActive = false,
    sector: SectorConfig | null = null
  ): AvionicsWarningItem[] {
    const snap = evaluateLanderAvionics(lander, sector, emBlackoutActive);
    return snap.alerts.map((a) => ({ text: a.text, critical: a.critical }));
  }

  public render(ctx: CanvasRenderingContext2D, state: HudRenderContext): void {
    this.buttons = [];
    this.touchControls = [];
    const w = state.width;
    const h = state.height;

    if (state.phase === 'BOOT') {
      this.bootLogoRenderer.render(ctx, {
        width: w,
        height: h,
        timeSec: state.timeSec,
        bootPoweredOn: state.bootPoweredOn,
        mobileMode: state.mobileMode,
        bootElapsedSec: state.bootElapsedSec,
        bootProgressChars: state.bootProgressChars,
        bootLines: BOOT_LINES,
        hoveredButtonId: state.hoveredButtonId,
        buttonsOut: this.buttons,
      });
      return;
    }

    // Dedicated Space-Preserving Mobile (Phone) Flight Deck & Touch UI
    if (state.mobileMode) {
      this.mobileHudRenderer.render(
        ctx,
        state,
        state.safeAreaInsets,
        this.campaignMapRenderer.getSectorSummaries(),
        state.mobileTouchState,
        this.buttons,
        this.touchControls
      );
      return;
    }

    if (state.phase === 'TITLE_MENU') {
      const menuBox = this.getTitleMenuBoxRect(w, h);
      this.campaignMapRenderer.render(ctx, {
        width: w,
        height: h,
        topHeaderY: TOP_CHROME_BAR_HEIGHT + 6,
        menuBox,
        selectedMenuMode: state.selectedMenuMode,
        selectedStartSector: state.selectedStartSector,
        hoveredButtonId: state.hoveredButtonId,
        buttonsOut: this.buttons,
        timeSec: state.timeSec,
      });
      this.drawSharedTopBar(ctx, w, state);
      this.drawTitleMenu(ctx, w, h, state, menuBox);
      drawPersistentControlsStrip(ctx, w, h, LANDER_TITLE_CONTROLS_STRIP);
    } else {
      this.drawSharedTopBar(ctx, w, state);

      const isModalBriefing = state.phase === 'SECTOR_BRIEFING' && !state.inlineTeletypeHold;
      this.drawFlightTelemetryHud(ctx, w, h, state, isModalBriefing);

      // Persistent 22px bottom controls strip during flight / active deck
      drawPersistentControlsStrip(ctx, w, h, LANDER_FLIGHT_CONTROLS_STRIP);

      if (isModalBriefing) {
        this.drawSectorBriefingOverlay(ctx, w, h, state);
      } else if (state.phase === 'PAUSED' && !state.bezel.osdMenuOpen && !state.controlsCardOpen) {
        drawPauseBanner(
          ctx,
          w,
          h,
          'Press [P] to resume descent, [H] for Controls Quick-Card, or [ESC] for System Menu.',
          this.buttons as ChromeButtonHitbox[],
          state.hoveredButtonId,
          state.timeSec
        );
      } else if (state.phase === 'SECTOR_TALLY' && state.lastBreakdown) {
        this.drawSectorTallyOverlay(ctx, w, h, state, state.lastBreakdown);
      } else if (state.phase === 'HULL_BREACH' && state.lives > 0) {
        this.drawHullBreachOverlay(ctx, w, h, state);
      } else if (
        state.phase === 'CALLSIGN_ENTRY' ||
        state.phase === 'CAMPAIGN_COMPLETE' ||
        (state.phase === 'HULL_BREACH' && state.lives <= 0)
      ) {
        this.drawUnifiedDebriefOverlay(ctx, w, h, state);
      }
    }

    // Transient status toast when no top-level modal covers screen
    if (
      state.statusBannerText &&
      state.statusBannerTimer > 0 &&
      !state.bezel.osdMenuOpen &&
      !state.controlsCardOpen &&
      !state.bezel.flightLogsOpen
    ) {
      const toastY =
        state.phase === 'TITLE_MENU'
          ? TOP_CHROME_BAR_HEIGHT + 12
          : h - CONTROLS_STRIP_HEIGHT - 30 - 44;
      const alpha = Math.min(1, state.statusBannerTimer / 0.25);
      drawStatusToast(ctx, w, toastY, state.statusBannerText, state.statusBannerTone, alpha);
    }

    // Top-level Shared Modals (always isolate hitboxes via drawModalFrame!)
    if (state.bezel.osdMenuOpen) {
      this.drawSharedSystemMenu(ctx, w, h, state);
    } else if (state.controlsCardOpen) {
      drawControlsCardModal(
        ctx,
        w,
        h,
        {
          ...LANDER_CONTROLS_SPEC,
          hoveredButtonId: state.hoveredButtonId,
        },
        this.buttons as ChromeButtonHitbox[]
      );
    } else if (state.bezel.flightLogsOpen) {
      this.drawSharedGlobalManifest(ctx, w, h, state);
    }
  }

  private drawSharedTopBar(
    ctx: CanvasRenderingContext2D,
    w: number,
    state: HudRenderContext
  ): void {
    const inRun = state.phase !== 'TITLE_MENU' && state.phase !== 'BOOT';
    const telemetryText = inRun
      ? `${state.sector.code} · ${Math.round(state.displayedScore).toLocaleString()} PTS${state.ranked1979BonusActive ? ' · 1.5X' : ''}`
      : '6 SECTORS · 3 SHUTTLES';

    drawTopChromeBar(
      ctx,
      w,
      {
        title: 'LUNAR LANDER',
        timeSec: state.timeSec,
        isRanked: !state.isPracticeRun,
        showRankedBadge: inRun,
        telemetryText,
        crt1979Enabled: state.crtPreset === 'CLASSIC_1979',
        crtModeLocked: state.crtModeLocked,
        controlsLabel: '[H] CONTROLS',
        audioMuted: state.bezel.audioMuted,
        musicEnabled: state.musicEnabled,
        hoveredButtonId: state.hoveredButtonId,
        confirmExitPending: state.confirmExitPending,
      },
      this.buttons as ChromeButtonHitbox[]
    );
  }

  // =========================================================================
  // SLIM ~210PX NOSTROMO INSTRUMENTATION + 7-LAMP BACKLIT ANNUNCIATOR STRIP
  // =========================================================================

  private drawFlightTelemetryHud(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    dimmed: boolean
  ): void {
    ctx.save();
    if (dimmed) ctx.globalAlpha = 0.42;

    const lander = state.lander;
    const sector = state.sector;
    const layout = HudRenderer.computeLayoutMetrics(w, h);
    const s = layout.hudScale;

    const targetPadInfo = this.findClosestTargetPad(lander, sector.pads);
    const inFinalApproach = Boolean(
      targetPadInfo && targetPadInfo.dist <= PHYSICS.APPROACH_PROXIMITY_M
    );
    const padDx = targetPadInfo
      ? (targetPadInfo.pad.x1 + targetPadInfo.pad.x2) * 0.5 - lander.pos.x
      : 0;
    const padBearingStr = targetPadInfo
      ? `${Math.abs(padDx).toFixed(0)}M ${padDx >= 0 ? 'E' : 'W'} ${targetPadInfo.pad.type === 'DEPOT' ? SEMIOTIC_ICONS.CROSS : `${targetPadInfo.pad.multiplier}X`}`
      : '---';

    const ttiStr =
      lander.groundedPad !== null
        ? 'CONTACT'
        : lander.vel.y < -0.25
          ? `${Math.min(99.9, lander.agl / Math.abs(lander.vel.y)).toFixed(1)}S`
          : 'CLIMB';

    // Subtle outer viewport corner brackets below top bar & above bottom controls strip
    const activeRankedFlight = !state.isPracticeRun;
    drawCornerBrackets(
      ctx,
      4,
      TOP_CHROME_BAR_HEIGHT + 3,
      w - 8,
      h - TOP_CHROME_BAR_HEIGHT - CONTROLS_STRIP_HEIGHT - 6,
      16,
      activeRankedFlight ? THEME.ACCENT_AMBER : THEME.BORDER_SUBTLE,
      1.8
    );

    // ---------------------------------------------------------------------
    // RIGHT INSTRUMENT CLUSTER (~210px): ANALOG DIALS + AGL VERNIER + STATUS
    // (Duplicated 7-row FLIGHT DATA prose block removed -> +240px flight corridor!)
    // ---------------------------------------------------------------------
    const baseW = 210;
    const baseH = 600;
    const rightScreenX = w - layout.marginX - layout.sidePanelW;
    const rightScreenY = layout.topHeaderY;

    ctx.save();
    ctx.translate(rightScreenX, rightScreenY);
    ctx.scale(s, s);

    ctx.fillStyle = 'rgba(3, 8, 5, 0.90)';
    ctx.fillRect(0, 0, baseW, baseH);
    drawCornerBrackets(ctx, 0, 0, baseW, baseH, 12, THEME.BORDER_SUBTLE, 2.0);

    // Compact Rack Header
    ctx.textAlign = 'left';
    ctx.font = font('head', 14, s);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.fillText('AVIONICS', 10, 20);

    const totalMass = lander.dryMassKg + lander.fuelKg;
    const currentTwr = PHYSICS.MAIN_THRUST_N / (totalMass * sector.gravity);
    ctx.textAlign = 'right';
    ctx.font = font('micro', 12, s);
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.fillText(`TWR ${currentTwr.toFixed(1)}`, baseW - 10, 20);

    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(10, 27);
    ctx.lineTo(baseW - 10, 27);
    ctx.stroke();

    const leftColCx = 60;
    const rightColCx = 154;
    const dialR = 37;

    // Gauge A: FUEL Wedge Dial (top-left)
    const fuelRatio = Math.max(0, Math.min(1, lander.fuelKg / Math.max(1, lander.maxFuelKg)));
    this.drawChunkyFuelWedgeDial(
      ctx,
      leftColCx,
      78,
      dialR,
      fuelRatio,
      `${lander.fuelKg.toFixed(0)} KG`,
      'FUEL',
      s
    );

    // Compute single authoritative avionics state for dials, compass, and 7-lamp annunciator
    const avionics = evaluateLanderAvionics(lander, sector, state.emBlackoutActive);

    // Gauge B: SPEED Needle Dial (mid-left — 0..30 m/s scale for aggressive flying!)
    const speedMaxScale = PHYSICS.SPEED_DIAL_MAX_MPS;
    const speedMag = Math.hypot(lander.vel.x, lander.vel.y);
    const speedNorm = Math.min(1, speedMag / speedMaxScale);
    const speedIsRed =
      speedMag >= 26.0 || avionics.pullUpCrit || avionics.sinkState === 'CRITICAL';
    const speedIsAmber = !speedIsRed && (speedMag >= 18.0 || avionics.sinkState === 'CAUTION');
    this.drawChunkyNeedleDial(
      ctx,
      leftColCx,
      218,
      dialR,
      speedNorm,
      PHYSICS.SAFE_VS_MAX / speedMaxScale,
      'SPEED',
      speedIsRed
        ? THEME.ALERT_RED_STROKE
        : speedIsAmber
          ? THEME.ACCENT_AMBER
          : THEME.TEXT_PRIMARY,
      false,
      s,
      `${speedMag.toFixed(1)} M/S`
    );

    // Gauge C: DRIFT Needle Dial (lower-left — ±20 m/s scale for aggressive lateral burns!)
    const driftMaxScale = PHYSICS.DRIFT_DIAL_MAX_MPS;
    const absVx = Math.abs(lander.vel.x);
    const driftIsRed = absVx >= 17.5 || avionics.driftState === 'CRITICAL';
    const driftIsAmber = !driftIsRed && (absVx >= 12.0 || avionics.driftState === 'CAUTION');
    const driftSigned = Math.max(-1, Math.min(1, lander.vel.x / driftMaxScale));
    this.drawChunkyNeedleDial(
      ctx,
      leftColCx,
      362,
      dialR,
      driftSigned,
      undefined,
      'DRIFT',
      driftIsRed
        ? THEME.ALERT_RED_STROKE
        : driftIsAmber
          ? THEME.ACCENT_AMBER
          : THEME.TEXT_PRIMARY,
      true,
      s,
      `${lander.vel.x >= 0 ? '+' : ''}${lander.vel.x.toFixed(1)}`
    );

    // Gauge D: Tall Stepped Vertical Green Vernier Scale (AGL M, top-right)
    this.drawSteppedVerticalVernier(ctx, rightColCx, 38, 250, lander.agl, 200, 'AGL M', s);

    // Gauge E: THRUST Needle Dial (lower-right)
    const thrustNorm = Math.min(1, lander.throttle / PHYSICS.OVERDRIVE_MULTIPLIER);
    this.drawChunkyNeedleDial(
      ctx,
      rightColCx,
      362,
      dialR,
      thrustNorm,
      1.0 / PHYSICS.OVERDRIVE_MULTIPLIER,
      'THRUST',
      lander.overdrive ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER,
      false,
      s,
      lander.overdrive ? 'OVR' : `${Math.round(lander.throttle * 100)}%`
    );

    // Compact Non-Duplicated Tactical Readout Footer (Pad Bearing, TTI, Hull, Bus)
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(10, 444);
    ctx.lineTo(baseW - 10, 444);
    ctx.stroke();

    const footerRows: Array<{ label: string; val: string; col: string }> = [
      { label: 'PAD', val: padBearingStr, col: THEME.ACCENT_AMBER_HI },
      {
        label: 'IMPACT',
        val: ttiStr,
        col: lander.vel.y < -3.2 && lander.agl < 24 ? THEME.ALERT_RED_TEXT : THEME.TEXT_PRIMARY,
      },
      {
        label: 'HULL',
        val: `${Math.round(lander.hullIntegrity)}%${lander.strutDamaged ? ' GEAR' : lander.rcsDamaged ? ' RCS' : ''}`,
        col: lander.strutDamaged || lander.rcsDamaged ? THEME.ALERT_RED_TEXT : THEME.TEXT_PRIMARY,
      },
      {
        label: 'SAS / ZM',
        val: `${state.bezel.sasEnabled ? '50%' : '100%'} · ${state.cameraZoom.toFixed(1)}X`,
        col: state.bezel.sasEnabled ? THEME.TEXT_BRIGHT : THEME.ACCENT_AMBER,
      },
    ];

    ctx.font = font('micro', 12, s);
    footerRows.forEach((row, idx) => {
      const ry = 468 + idx * 28;
      ctx.textAlign = 'left';
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      ctx.fillText(row.label, 10, ry);
      ctx.textAlign = 'right';
      ctx.fillStyle = row.col;
      drawEllipsizedText(ctx, row.val, baseW - 10, ry, baseW - 80);
    });

    // Subtle MU-TH-UR Bus Hex Ticker — PAUSED during final approach to eliminate distraction!
    const regSeed = inFinalApproach ? 0 : Math.floor(state.timeSec * 6);
    const hexA = ((regSeed * 4919 + 0x2037) & 0xffff).toString(16).toUpperCase().padStart(4, '0');
    const hexB = ((regSeed * 7907 + 0x42) & 0xff).toString(16).toUpperCase().padStart(2, '0');
    ctx.textAlign = 'center';
    ctx.font = font('micro', 12, s);
    ctx.fillStyle = THEME.TEXT_MUTED;
    ctx.fillText(
      inFinalApproach ? 'BUS LOCK // APPROACH' : `BUS ${hexA}:${hexB}`,
      baseW * 0.5,
      baseH - 12
    );
    ctx.restore();

    // ---------------------------------------------------------------------
    // LEFT TACTICAL STACK (~210px):
    // 1) SCORE + 3-SHUTTLE RESERVES + [SPACE] 1X PULSE (0.6s FLIP COVER) + RADAR
    // 2) INERTIAL ATTITUDE GYRO + WIND COMPASS
    // 3) 2D LANDING PAD TOPOGRAPHY & GLIDE-SLOPE MAP
    // ---------------------------------------------------------------------
    ctx.save();
    ctx.translate(layout.marginX, layout.topHeaderY);
    ctx.scale(s, s);

    this.drawScoreAndRadarRack(
      ctx,
      0,
      0,
      baseW,
      state.displayedScore,
      state.dropStreak,
      state.lives,
      state.maxLives,
      state.lifeLostFlashTimer,
      state.isPracticeRun,
      state.sectorElapsedSec,
      state.pulseSafetyLockSec,
      lander,
      state.timeSec,
      s
    );

    this.drawAttitudeAndWindPod(ctx, 0, 224, baseW, lander, sector, avionics, s);

    if (targetPadInfo && lander.alive && (state.phase === 'FLIGHT' || state.phase === 'PAUSED')) {
      this.drawProximityApproachSubWindow(
        ctx,
        0,
        384,
        baseW,
        216,
        sector,
        lander,
        targetPadInfo.pad,
        targetPadInfo.dist,
        s
      );
    }
    ctx.restore();

    // ---------------------------------------------------------------------
    // LIVE 1-LINE TELETYPE HAZARD STRIP (SECTORS 2-6 & REPLAYS)
    // ---------------------------------------------------------------------
    if (state.phase === 'SECTOR_BRIEFING' && state.inlineTeletypeHold) {
      this.drawInlineTeletypeHazardStrip(ctx, w, layout, state);
    }

    // ---------------------------------------------------------------------
    // TOP-CENTER GO / NO-GO + CENTERLINE SOFT-KISS ILS HUD
    // ---------------------------------------------------------------------
    if (
      (state.phase === 'SECTOR_TALLY' || state.phase === 'HULL_BREACH') &&
      state.touchdownSnapshot
    ) {
      this.drawTopGoNoGoHud(
        ctx,
        w,
        layout,
        state.touchdownSnapshot.pad,
        state.touchdownSnapshot.dist,
        state.touchdownSnapshot.vs,
        state.touchdownSnapshot.hs,
        state.touchdownSnapshot.deg,
        state.touchdownSnapshot.offsetM,
        state.touchdownSnapshot.grade,
        state.timeSec
      );
    } else if (
      targetPadInfo &&
      targetPadInfo.dist <= PHYSICS.APPROACH_PROXIMITY_M &&
      lander.alive &&
      (state.phase === 'FLIGHT' || state.phase === 'PAUSED')
    ) {
      const padCenter = (targetPadInfo.pad.x1 + targetPadInfo.pad.x2) * 0.5;
      this.drawTopGoNoGoHud(
        ctx,
        w,
        layout,
        targetPadInfo.pad,
        targetPadInfo.dist,
        Math.abs(Math.min(0, lander.vel.y)),
        Math.abs(lander.vel.x),
        Math.abs((lander.angle * 180) / Math.PI),
        lander.pos.x - padCenter,
        null,
        state.timeSec
      );
    }

    // ---------------------------------------------------------------------
    // NOSTROMO 7-LAMP BACKLIT GLASS ANNUNCIATOR STRIP (DARK CALM UNTIL TRIPPED!)
    // Replaces colliding bottom Airbus warning bars!
    // ---------------------------------------------------------------------
    this.drawNostromoAnnunciator(ctx, w, h, layout, avionics, state.timeSec);

    ctx.restore();
  }

  private drawInlineTeletypeHazardStrip(
    ctx: CanvasRenderingContext2D,
    w: number,
    layout: HudLayoutMetrics,
    state: HudRenderContext
  ): void {
    const stripW = Math.min(680, layout.safeWidthPx - 12);
    const stripH = 40;
    const sx = Math.round((w - stripW) * 0.5);
    const sy = layout.topHeaderY + 8;

    ctx.save();
    ctx.fillStyle = 'rgba(4, 14, 8, 0.94)';
    ctx.fillRect(sx, sy, stripW, stripH);
    ctx.strokeStyle = THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(sx + 0.5, sy + 0.5, stripW - 1, stripH - 1);

    const dropW = 92;
    drawChromeButton(
      ctx,
      { x: sx + stripW - dropW - 5, y: sy + 5, width: dropW, height: stripH - 10 },
      `${SEMIOTIC_ICONS.PLAY} DROP`,
      {
        id: 'briefing-launch',
        accent: 'amber',
        active: true,
        hovered: state.hoveredButtonId === 'briefing-launch',
        fontPx: 12,
      },
      this.buttons as ChromeButtonHitbox[]
    );

    const hazard = state.sector.subtitle || `GRAV ${state.sector.gravity.toFixed(2)}G`;
    const fullText = `${state.sector.code} // ${state.sector.name} · ${hazard} · [ANY THRUST TO DROP]`;
    const visible = fullText.slice(0, Math.max(14, Math.floor(state.briefingProgressChars)));
    const cursor = Math.sin(state.timeSec * 9) > 0 ? '█' : '';

    ctx.font = font('data', 13);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    drawEllipsizedText(ctx, `${visible}${cursor}`, sx + 12, sy + stripH * 0.5 + 0.5, stripW - dropW - 24);
    ctx.restore();
  }

  /**
   * Nostromo 7-Lamp Backlit Glass Annunciator Strip:
   * PULL UP | SINK | BANK | DRIFT | FUEL | WIND | EM
   * Dark etched glass until triggered — zero collision with HUD or toasts!
   */
  private drawNostromoAnnunciator(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    layout: HudLayoutMetrics,
    avionics: LanderAvionicsSnapshot,
    timeSec: number
  ): void {
    const pullUpActive = avionics.obstacleCrit || avionics.pullUpCrit;
    const windLabel = avionics.windIsThermalOnly
      ? 'THERMAL'
      : avionics.windIsShear
        ? 'SHEAR'
        : 'WIND';

    const lamps: AnnunciatorLamp[] = [
      {
        id: 'pull-up',
        label: avionics.obstacleCrit ? 'OBSTACLE' : 'PULL UP',
        state: pullUpActive ? 'CRITICAL' : 'OFF',
        icon: pullUpActive ? SEMIOTIC_ICONS.TRIANGLE : undefined,
      },
      {
        id: 'sink',
        label: 'SINK',
        state: avionics.sinkState,
        icon: avionics.sinkState === 'CRITICAL' ? SEMIOTIC_ICONS.TRIANGLE : undefined,
      },
      {
        id: 'bank',
        label: 'BANK',
        state: avionics.bankState,
        icon: avionics.bankState === 'CRITICAL' ? SEMIOTIC_ICONS.TRIANGLE : undefined,
      },
      {
        id: 'drift',
        label: 'DRIFT',
        state: avionics.driftState,
        icon: avionics.driftState === 'CRITICAL' ? SEMIOTIC_ICONS.TRIANGLE : undefined,
      },
      {
        id: 'fuel',
        label: 'FUEL',
        state: avionics.fuelState,
        icon: avionics.fuelState === 'CRITICAL' ? SEMIOTIC_ICONS.TRIANGLE : undefined,
      },
      {
        id: 'wind',
        label: windLabel,
        state: avionics.windState,
        icon:
          avionics.windState === 'CRITICAL'
            ? SEMIOTIC_ICONS.TRIANGLE
            : avionics.windState === 'CAUTION'
              ? SEMIOTIC_ICONS.DIAMOND
              : undefined,
      },
      {
        id: 'em',
        label: 'EM',
        state: avionics.emActive ? 'INFO' : 'OFF',
        icon: avionics.emActive ? SEMIOTIC_ICONS.HEX : undefined,
        pulse: avionics.emActive,
      },
    ];

    const stripW = Math.min(620, Math.max(320, layout.safeWidthPx - 12));
    const stripH = 30;
    const stripX = Math.round((w - stripW) * 0.5);
    const stripY = h - CONTROLS_STRIP_HEIGHT - stripH - 4;

    drawAnnunciatorStrip(ctx, lamps, stripX, stripY, stripW, stripH, timeSec);
  }

  /**
   * Slim 210px Score + 3 Drop-Shuttle Reserves + [SPACE] 1X Pulse (with 0.6s flip-cover safety guard!)
   * + 3 Radar Ping Cells Rack.
   */
  private drawScoreAndRadarRack(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    displayedScore: number,
    dropStreak: number,
    lives: number,
    maxLives: number,
    lifeLostFlashTimer: number,
    isPracticeRun: boolean,
    sectorElapsedSec: number,
    pulseSafetyLockSec: number,
    lander: LanderState,
    timeSec: number,
    scale: number
  ): void {
    const h = 216;
    ctx.save();
    ctx.fillStyle = 'rgba(3, 8, 5, 0.90)';
    ctx.fillRect(x, y, w, h);
    drawCornerBrackets(ctx, x, y, w, h, 12, THEME.BORDER_SUBTLE, 2.0);

    // Top Row: Score Label + Streak / Unranked
    ctx.textAlign = 'left';
    ctx.font = font('micro', 12, scale);
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.fillText(isPracticeRun ? 'PRACTICE' : 'SCORE', x + 10, y + 18);

    const streak = Math.max(1, dropStreak);
    ctx.textAlign = 'right';
    ctx.font = font('micro', 12, scale);
    ctx.fillStyle = isPracticeRun
      ? THEME.ACCENT_AMBER
      : streak > 1
        ? THEME.ACCENT_AMBER_HI
        : THEME.TEXT_PRIMARY;
    ctx.fillText(isPracticeRun ? 'UNRANKED' : `STREAK ${streak}X`, x + w - 10, y + 18);

    // Crisp Tabular Score
    ctx.textAlign = 'left';
    ctx.font = font('data', 24, scale);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    const scoreText = Math.round(displayedScore).toString().padStart(7, '0');
    drawEllipsizedText(ctx, scoreText, x + 10, y + 46, w - 20);

    // MET + Delta-V
    const mins = Math.floor(sectorElapsedSec / 60);
    const secs = Math.floor(sectorElapsedSec % 60);
    const totalMass = lander.dryMassKg + lander.fuelKg;
    const vExhaust = PHYSICS.MAIN_THRUST_N / PHYSICS.MAIN_BURN_RATE_KG_S;
    const deltaV = vExhaust * Math.log(totalMass / lander.dryMassKg);

    ctx.font = font('micro', 12, scale);
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.TEXT_PRIMARY;
    ctx.fillText(`MET ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`, x + 10, y + 66);
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.fillText(`ΔV ${deltaV.toFixed(0)}`, x + w - 10, y + 66);

    // Middle Rack: SHUTTLE RESERVES
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 74);
    ctx.lineTo(x + w - 10, y + 74);
    ctx.stroke();

    const finalShuttle = lives === 1;
    const noShuttles = lives <= 0;
    ctx.textAlign = 'left';
    ctx.font = font('micro', 12, scale);
    ctx.fillStyle = noShuttles
      ? THEME.ALERT_RED_TEXT
      : finalShuttle
        ? THEME.ACCENT_AMBER
        : THEME.TEXT_PRIMARY;
    ctx.fillText('SHUTTLES', x + 10, y + 90);

    ctx.textAlign = 'right';
    ctx.fillText(noShuttles ? '0/3 LOST' : `${lives}/${maxLives}`, x + w - 10, y + 90);

    const bayGap = 6;
    const bayW = (w - 20 - bayGap * (maxLives - 1)) / maxLives;
    const bayY = y + 97;
    const bayH = 34;

    for (let i = 0; i < maxLives; i++) {
      const bx = x + 10 + i * (bayW + bayGap);
      const isAlive = i < lives;
      const justLostFlash =
        !isAlive && i === lives && lifeLostFlashTimer > 0 && Math.sin(timeSec * 22) > -0.2;

      if (isAlive) {
        const hullCol = finalShuttle ? THEME.ACCENT_AMBER : THEME.TEXT_PRIMARY;
        ctx.fillStyle = finalShuttle ? 'rgba(255, 176, 0, 0.14)' : 'rgba(68, 255, 119, 0.12)';
        ctx.fillRect(bx, bayY, bayW, bayH);
        ctx.strokeStyle = hullCol;
        ctx.lineWidth = 1.8;
        ctx.strokeRect(bx, bayY, bayW, bayH);
        this.drawMiniShuttleVector(ctx, bx + bayW * 0.5, bayY + bayH * 0.52, hullCol, false, 0.8);
      } else {
        const deadStroke = justLostFlash ? THEME.ALERT_RED_STROKE : '#5A2424';
        ctx.fillStyle = justLostFlash ? 'rgba(255, 51, 24, 0.25)' : '#241414';
        ctx.fillRect(bx, bayY, bayW, bayH);
        ctx.strokeStyle = deadStroke;
        ctx.lineWidth = 1.4;
        ctx.strokeRect(bx, bayY, bayW, bayH);
        this.drawMiniShuttleVector(
          ctx,
          bx + bayW * 0.5,
          bayY + bayH * 0.52,
          justLostFlash ? THEME.ALERT_RED_TEXT : '#6E3232',
          true,
          0.8
        );
        ctx.strokeStyle = justLostFlash ? THEME.ALERT_RED_STROKE : '#8A2828';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bx + 5, bayY + 5);
        ctx.lineTo(bx + bayW - 5, bayY + bayH - 5);
        ctx.moveTo(bx + bayW - 5, bayY + 5);
        ctx.lineTo(bx + 5, bayY + bayH - 5);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 139);
    ctx.lineTo(x + w - 10, y + 139);
    ctx.stroke();

    // Bottom Split Rack: [SPACE] 1X PULSE (with 0.6s flip-cover interlock) | RADAR [LMB]
    const splitX = x + Math.round(w * 0.5);

    const pulseArmed = lander.emergencyPulseAvailable;
    const pulseFiring = lander.emergencyPulseTimer > 0;
    const guardActive = pulseArmed && pulseSafetyLockSec > 0;

    ctx.textAlign = 'left';
    ctx.font = font('micro', 12, scale);
    ctx.fillStyle = pulseFiring
      ? '#FFFFFF'
      : guardActive
        ? THEME.ALERT_RED_TEXT
        : pulseArmed
          ? THEME.ACCENT_AMBER_HI
          : THEME.TEXT_MUTED;
    ctx.fillText('1X PULSE', x + 10, y + 156);

    const pBoxX = x + 10;
    const pBoxY = y + 164;
    const pBoxW = splitX - pBoxX - 5;
    const pBoxH = 38;

    ctx.strokeStyle = guardActive
      ? THEME.ALERT_RED_STROKE
      : pulseArmed || pulseFiring
        ? THEME.ACCENT_AMBER
        : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(pBoxX, pBoxY, pBoxW, pBoxH);

    if (guardActive) {
      // Animated Nostromo flip-cover safety guard opening over 0.6s!
      const coverFrac = Math.max(0, Math.min(1, pulseSafetyLockSec / 0.6));
      const coverH = Math.round((pBoxH - 4) * coverFrac);
      ctx.fillStyle = 'rgba(130, 26, 16, 0.72)';
      ctx.fillRect(pBoxX + 2, pBoxY + 2, pBoxW - 4, coverH);
      ctx.strokeStyle = THEME.ALERT_RED_TEXT;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(pBoxX + 2, pBoxY + 2 + coverH);
      ctx.lineTo(pBoxX + pBoxW - 2, pBoxY + 2 + coverH);
      ctx.stroke();
    } else if (pulseArmed || pulseFiring) {
      const glow = pulseFiring ? 0.88 : 0.22 + 0.10 * Math.sin(timeSec * 5);
      ctx.fillStyle = `rgba(255, 176, 0, ${glow.toFixed(2)})`;
      ctx.fillRect(pBoxX + 2, pBoxY + 2, pBoxW - 4, pBoxH - 4);
    }

    ctx.textAlign = 'center';
    ctx.font = font('micro', 12, scale);
    ctx.fillStyle = pulseFiring
      ? '#FFFFFF'
      : guardActive
        ? THEME.ALERT_RED_TEXT
        : pulseArmed
          ? THEME.ACCENT_AMBER_HI
          : THEME.TEXT_MUTED;
    drawEllipsizedText(
      ctx,
      pulseFiring ? 'FIRING' : guardActive ? 'GUARD' : pulseArmed ? 'ARMED' : 'USED',
      pBoxX + pBoxW * 0.5,
      pBoxY + 23,
      pBoxW - 6
    );

    // Right Box: RADAR [LMB] 3 Cells
    const maxCells = Math.max(1, lander.maxRadarCharges);
    const remCells = lander.radarCharges;
    const lowCells = remCells <= 1;

    ctx.textAlign = 'left';
    ctx.font = font('micro', 12, scale);
    ctx.fillStyle =
      remCells === 0
        ? THEME.ALERT_RED_TEXT
        : lowCells
          ? THEME.ACCENT_AMBER
          : THEME.ACCENT_CYAN;
    ctx.fillText('RADAR', splitX + 4, y + 156);

    ctx.textAlign = 'right';
    ctx.fillText(`${remCells}/${maxCells}`, x + w - 10, y + 156);

    const rackX = splitX + 4;
    const rackW = x + w - 10 - rackX;
    const rackY = y + 164;
    const cellGap = 4;
    const cellW = (rackW - cellGap * (maxCells - 1)) / maxCells;
    const cellH = 38;

    if (remCells > 0) {
      for (let c = 0; c < maxCells; c++) {
        const cx = rackX + c * (cellW + cellGap);
        const charged = c < remCells;

        ctx.fillStyle = charged
          ? lowCells
            ? THEME.ACCENT_AMBER_HI
            : THEME.ACCENT_CYAN
          : THEME.BORDER_SUBTLE;
        ctx.fillRect(cx + cellW * 0.25, rackY, cellW * 0.5, 4);

        ctx.strokeStyle = charged
          ? lowCells
            ? THEME.ACCENT_AMBER
            : THEME.ACCENT_CYAN
          : THEME.BORDER_SUBTLE;
        ctx.lineWidth = 1.6;
        ctx.strokeRect(cx, rackY + 4, cellW, cellH - 4);

        if (charged) {
          ctx.fillStyle = lowCells ? THEME.ACCENT_AMBER : THEME.TEXT_PRIMARY;
          ctx.fillRect(cx + 2.5, rackY + 7, Math.max(2, cellW - 5), cellH - 10);
        }
      }
    } else {
      const blink = Math.sin(timeSec * 10) > 0;
      ctx.strokeStyle = blink ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(rackX, rackY + 4, rackW, 34);

      const progW = ((rackW - 4) * lander.sensorCapacitor) / 100;
      ctx.fillStyle = 'rgba(255, 176, 0, 0.36)';
      ctx.fillRect(rackX + 2, rackY + 6, progW, 30);

      ctx.textAlign = 'center';
      ctx.font = font('micro', 12, scale);
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      ctx.fillText(`${Math.round(lander.sensorCapacitor)}%`, rackX + rackW * 0.5, rackY + 25);
    }

    ctx.restore();
  }

  private drawMiniShuttleVector(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    color: string,
    breached: boolean,
    scale = 1.0
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.strokeStyle = color;
    ctx.lineWidth = breached ? 1.4 : 1.9;

    ctx.beginPath();
    ctx.moveTo(-7, -10);
    ctx.lineTo(7, -10);
    ctx.lineTo(11, -3);
    ctx.lineTo(9, 4);
    ctx.lineTo(-9, 4);
    ctx.lineTo(-11, -3);
    ctx.closePath();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-5, -5);
    ctx.lineTo(5, -5);
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 4);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-8, 3);
    ctx.lineTo(-16, 11);
    ctx.moveTo(-19, 11);
    ctx.lineTo(-12, 11);

    ctx.moveTo(8, 3);
    ctx.lineTo(16, 11);
    ctx.moveTo(12, 11);
    ctx.lineTo(19, 11);

    ctx.moveTo(-3.5, 4);
    ctx.lineTo(-5.5, 9);
    ctx.lineTo(5.5, 9);
    ctx.lineTo(3.5, 4);
    ctx.stroke();
    ctx.restore();
  }

  private drawChunkyFuelWedgeDial(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    fuelRatio: number,
    subValue: string,
    label: string,
    scale: number
  ): void {
    ctx.save();
    const startAng = (140 * Math.PI) / 180;
    const endAng = (400 * Math.PI) / 180;
    const isCritical = fuelRatio <= 0.18;
    const activeCol = isCritical ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
    const textCol = isCritical ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER;

    ctx.strokeStyle = 'rgba(255, 176, 0, 0.25)';
    ctx.lineWidth = 3.8;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAng, endAng);
    ctx.stroke();

    const activeEnd = startAng + (endAng - startAng) * fuelRatio;
    if (fuelRatio > 0.01) {
      ctx.strokeStyle = activeCol;
      ctx.lineWidth = 4.6;
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAng, activeEnd);
      ctx.stroke();
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
    ctx.clip();

    const innerTop = cy - (r - 8);
    const innerBot = cy + (r - 8);
    const fillTop = innerBot - (innerBot - innerTop) * fuelRatio;

    ctx.fillStyle = activeCol;
    ctx.beginPath();
    ctx.moveTo(cx - r + 5, innerBot);
    ctx.lineTo(cx - r + 7, fillTop);
    ctx.lineTo(cx + r - 6 - (1 - fuelRatio) * 4, fillTop);
    ctx.lineTo(cx + r - 9, innerBot);
    ctx.closePath();
    ctx.fill();

    if (fuelRatio > 0.04) {
      ctx.strokeStyle = isCritical ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER_HI;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(cx - r + 7, fillTop);
      ctx.lineTo(cx + r - 6, fillTop);
      ctx.stroke();
    }
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.font = font('micro', 12, scale);
    ctx.fillStyle = textCol;
    ctx.fillText(label, cx, cy + r + 15);

    ctx.font = font('micro', 12, scale);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.fillText(subValue, cx, cy + r + 31);
    ctx.restore();
  }

  private drawChunkyNeedleDial(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    value: number,
    safeTickRatio: number | undefined,
    label: string,
    activeCol: string,
    centerZero: boolean,
    scale: number,
    subValue?: string
  ): void {
    ctx.save();
    const startAng = (150 * Math.PI) / 180;
    const sweep = (240 * Math.PI) / 180;
    const endAng = startAng + sweep;

    ctx.strokeStyle = 'rgba(255, 176, 0, 0.25)';
    ctx.lineWidth = 3.8;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAng, endAng);
    ctx.stroke();

    let needleAng = startAng;
    ctx.strokeStyle = activeCol;
    ctx.lineWidth = 4.6;
    ctx.beginPath();
    if (centerZero) {
      const midAng = startAng + sweep * 0.5;
      needleAng = midAng + Math.max(-1, Math.min(1, value)) * (sweep * 0.5);
      if (needleAng >= midAng) {
        ctx.arc(cx, cy, r, midAng, needleAng);
      } else {
        ctx.arc(cx, cy, r, needleAng, midAng);
      }
    } else {
      const clamped = Math.max(0, Math.min(1, value));
      needleAng = startAng + clamped * sweep;
      if (clamped > 0.01) {
        ctx.arc(cx, cy, r, startAng, needleAng);
      }
    }
    ctx.stroke();

    const ticks = 8;
    for (let i = 0; i <= ticks; i++) {
      const frac = i / ticks;
      const a = startAng + frac * sweep;
      const innerLen = i % 2 === 0 ? 7 : 4;
      const lit = centerZero
        ? Math.abs(frac - 0.5) <= Math.abs(value) * 0.5 + 0.02
        : frac <= value + 0.02;
      ctx.strokeStyle = lit ? THEME.ACCENT_AMBER_HI : 'rgba(255, 176, 0, 0.32)';
      ctx.lineWidth = i % 2 === 0 ? 2.0 : 1.3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 2.5), cy + Math.sin(a) * (r - 2.5));
      ctx.lineTo(
        cx + Math.cos(a) * (r - 2.5 - innerLen),
        cy + Math.sin(a) * (r - 2.5 - innerLen)
      );
      ctx.stroke();
    }

    if (safeTickRatio !== undefined) {
      const sa = startAng + Math.max(0, Math.min(1, safeTickRatio)) * sweep;
      ctx.strokeStyle = THEME.TEXT_PRIMARY;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(sa) * (r - 5), cy + Math.sin(sa) * (r - 5));
      ctx.lineTo(cx + Math.cos(sa) * (r + 4), cy + Math.sin(sa) * (r + 4));
      ctx.stroke();
    }

    ctx.strokeStyle = THEME.ACCENT_AMBER_HI;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(needleAng) * 4, cy - Math.sin(needleAng) * 4);
    ctx.lineTo(cx + Math.cos(needleAng) * (r - 6), cy + Math.sin(needleAng) * (r - 6));
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.fillStyle = activeCol;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.font = font('micro', 12, scale);
    ctx.fillStyle =
      activeCol === THEME.ALERT_RED_STROKE ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER;
    ctx.fillText(label, cx, cy + r + 15);
    if (subValue) {
      ctx.font = font('micro', 12, scale);
      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      ctx.fillText(subValue, cx, cy + r + 31);
    }
    ctx.restore();
  }

  private drawSteppedVerticalVernier(
    ctx: CanvasRenderingContext2D,
    cx: number,
    topY: number,
    totalH: number,
    aglMeters: number,
    maxScaleM: number,
    topLabel: string,
    scale: number
  ): void {
    ctx.save();
    const ladderTop = topY + 22;
    const ladderH = totalH - 46;
    const ladderBot = ladderTop + ladderH;
    const colHalfW = 5;

    ctx.textAlign = 'center';
    ctx.font = font('micro', 12, scale);
    ctx.fillStyle = THEME.TEXT_PRIMARY;
    ctx.fillText(topLabel, cx, topY + 14);

    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 2.0;
    ctx.strokeRect(cx - colHalfW, ladderTop, colHalfW * 2, ladderH);

    const norm = Math.max(0, Math.min(1, aglMeters / maxScaleM));
    const fillH = ladderH * norm;
    if (fillH > 1) {
      ctx.fillStyle = THEME.TEXT_PRIMARY;
      ctx.fillRect(cx - colHalfW + 1.5, ladderBot - fillH, colHalfW * 2 - 3, fillH);
    }

    const rungs = 10;
    for (let i = 0; i <= rungs; i++) {
      const frac = i / rungs;
      const ry = ladderBot - frac * ladderH;
      const isMajor = i % 5 === 0 || i === 4;
      const rungSpan = isMajor ? 14 : 9;
      const lit = frac <= norm + 0.02;

      ctx.strokeStyle = lit ? THEME.TEXT_PRIMARY : THEME.TEXT_SECONDARY;
      ctx.lineWidth = isMajor ? 2.2 : 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - colHalfW - rungSpan, ry);
      ctx.lineTo(cx - colHalfW - 1, ry);
      ctx.moveTo(cx + colHalfW + 1, ry);
      ctx.lineTo(cx + colHalfW + rungSpan, ry);
      ctx.stroke();

      if (i === 4) {
        ctx.font = font('micro', 12, scale);
        ctx.fillStyle = THEME.TEXT_BRIGHT;
        ctx.textAlign = 'right';
        ctx.fillText('80', cx - colHalfW - rungSpan - 3, ry + 4);
      }
    }

    const bugY = ladderBot - fillH;
    ctx.strokeStyle = THEME.TEXT_BRIGHT;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(cx - 14, bugY);
    ctx.lineTo(cx + 14, bugY);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = font('data', 13, scale);
    ctx.fillStyle = aglMeters < 25 ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT;
    ctx.fillText(`${aglMeters.toFixed(1)}M`, cx, topY + totalH - 4);
    ctx.restore();
  }

  private drawAttitudeAndWindPod(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    lander: LanderState,
    sector: SectorConfig,
    avionics: LanderAvionicsSnapshot,
    scale: number
  ): void {
    const h = 152;
    const windKnots = avionics.windKnots;
    ctx.save();
    ctx.fillStyle = 'rgba(3, 8, 5, 0.90)';
    ctx.fillRect(x, y, w, h);
    drawCornerBrackets(ctx, x, y, w, h, 12, THEME.BORDER_SUBTLE, 2.0);

    const gyroCx = x + w * 0.27;
    const gyroCy = y + 54;
    const gyroR = 34;
    const pitchDeg = (lander.angle * 180) / Math.PI;
    const attSafe = Math.abs(pitchDeg) <= PHYSICS.SAFE_ANGLE_DEG;
    const attRingCol =
      avionics.bankState === 'CRITICAL'
        ? THEME.ALERT_RED_STROKE
        : avionics.bankState === 'CAUTION' || !attSafe
          ? THEME.ACCENT_AMBER
          : THEME.TEXT_PRIMARY;

    ctx.strokeStyle = attRingCol;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(gyroCx, gyroCy, gyroR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(gyroCx - gyroR - 3, gyroCy);
    ctx.lineTo(gyroCx - gyroR + 5, gyroCy);
    ctx.moveTo(gyroCx + gyroR - 5, gyroCy);
    ctx.lineTo(gyroCx + gyroR + 3, gyroCy);
    ctx.stroke();

    ctx.save();
    ctx.translate(gyroCx, gyroCy);
    ctx.rotate(lander.angle);
    ctx.strokeStyle =
      avionics.bankState === 'CRITICAL'
        ? THEME.ALERT_RED_STROKE
        : attSafe
          ? THEME.TEXT_BRIGHT
          : THEME.ACCENT_AMBER_HI;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(-gyroR + 6, 0);
    ctx.lineTo(-6, 0);
    ctx.lineTo(0, -8);
    ctx.lineTo(6, 0);
    ctx.lineTo(gyroR - 6, 0);
    ctx.stroke();
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.font = font('micro', 12, scale);
    ctx.fillStyle =
      avionics.bankState === 'CRITICAL'
        ? THEME.ALERT_RED_TEXT
        : attSafe
          ? THEME.TEXT_PRIMARY
          : THEME.ACCENT_AMBER_HI;
    ctx.fillText(`ATT ${pitchDeg >= 0 ? '+' : ''}${pitchDeg.toFixed(0)}°`, gyroCx, gyroCy + gyroR + 18);

    const windCx = x + w * 0.73;
    const windCy = y + 54;
    const windR = 34;
    const windCol =
      avionics.windState === 'CRITICAL'
        ? THEME.ALERT_RED_TEXT
        : avionics.windState === 'CAUTION'
          ? THEME.ACCENT_AMBER
          : THEME.TEXT_PRIMARY;

    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(windCx, windCy, windR, 0, Math.PI * 2);
    ctx.stroke();

    if (windKnots > 0.4) {
      const wAng = Math.atan2(-lander.currentWindVy, lander.currentWindVx);
      const tipX = windCx + Math.cos(wAng) * (windR - 6);
      const tipY = windCy + Math.sin(wAng) * (windR - 6);
      const tailX = windCx - Math.cos(wAng) * (windR - 10);
      const tailY = windCy - Math.sin(wAng) * (windR - 10);

      ctx.strokeStyle = windCol;
      ctx.lineWidth = 3.0;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(wAng - 0.5) * 8, tipY - Math.sin(wAng - 0.5) * 8);
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(wAng + 0.5) * 8, tipY - Math.sin(wAng + 0.5) * 8);
      ctx.stroke();
    } else {
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      ctx.font = font('micro', 12, scale);
      ctx.fillText('VAC', windCx, windCy + 4);
    }

    ctx.font = font('micro', 12, scale);
    ctx.fillStyle = windCol;
    ctx.fillText(`WND ${windKnots.toFixed(0)}KT`, windCx, windCy + windR + 18);

    const slopeAbs = Math.abs(lander.surfaceSlopeDeg);
    ctx.font = font('micro', 12, scale);
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.fillText(`G ${sector.gravity.toFixed(2)}`, x + 10, y + h - 10);
    ctx.textAlign = 'right';
    ctx.fillStyle = slopeAbs > 8 ? THEME.ACCENT_AMBER : THEME.TEXT_PRIMARY;
    ctx.fillText(`SLP ${slopeAbs.toFixed(1)}°`, x + w - 10, y + h - 10);
    ctx.restore();
  }

  private findClosestTargetPad(
    lander: LanderState,
    pads: LandingPad[]
  ): { pad: LandingPad; dist: number } | null {
    let best: LandingPad | null = null;
    let bestDist = Infinity;
    for (const p of pads) {
      const cx = (p.x1 + p.x2) * 0.5;
      const dist = Math.hypot(lander.pos.x - cx, lander.pos.y + PHYSICS.STRUT_REST_BOTTOM_Y - p.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
    return best ? { pad: best, dist: bestDist } : null;
  }

  private drawProximityApproachSubWindow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    boxH: number,
    sector: SectorConfig,
    lander: LanderState,
    pad: LandingPad,
    distM: number,
    scale: number
  ): void {
    const inApproachGate = distM <= PHYSICS.APPROACH_PROXIMITY_M;
    ctx.save();
    ctx.fillStyle = 'rgba(3, 8, 5, 0.90)';
    ctx.fillRect(x, y, w, boxH);
    drawCornerBrackets(
      ctx,
      x,
      y,
      w,
      boxH,
      12,
      inApproachGate ? THEME.ACCENT_AMBER : THEME.BORDER_SUBTLE,
      2.0
    );

    ctx.font = font('micro', 12, scale);
    ctx.fillStyle = inApproachGate ? THEME.ACCENT_AMBER_HI : THEME.TEXT_PRIMARY;
    ctx.textAlign = 'left';
    const badge = pad.type === 'DEPOT' ? `${SEMIOTIC_ICONS.CROSS}FUEL` : `${pad.multiplier}X`;
    drawEllipsizedText(ctx, `${pad.label} [${badge}]`, x + 8, y + 18, w - 58);

    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.textAlign = 'right';
    ctx.fillText(`${distM.toFixed(0)}M`, x + w - 8, y + 18);

    const vs = Math.abs(Math.min(0, lander.vel.y));
    const hs = Math.abs(lander.vel.x);
    const padCenter = (pad.x1 + pad.x2) * 0.5;
    const padHalfW = (pad.x2 - pad.x1) * 0.5;
    const aligned =
      Math.abs(lander.pos.x - padCenter) + PHYSICS.STRUT_SPAN_HALF_X <= padHalfW + 0.85;
    const vsGo = vs <= PHYSICS.SAFE_VS_MAX;
    const hsGo = hs <= PHYSICS.SAFE_HS_MAX;

    const offsetM = lander.pos.x - padCenter;
    ctx.font = font('micro', 12, scale);
    ctx.textAlign = 'left';
    ctx.fillStyle = aligned ? THEME.TEXT_BRIGHT : THEME.ACCENT_AMBER;
    drawEllipsizedText(
      ctx,
      `ALIGN ${offsetM >= 0 ? '+' : ''}${offsetM.toFixed(1)}M [${aligned ? 'LOCK' : 'OFF'}]`,
      x + 8,
      y + 36,
      w - 16
    );

    // Live 2D Topographic Approach & Glide-Slope Map Window
    const mapX = x + 8;
    const mapY = y + 44;
    const mapW = w - 16;
    const mapH = Math.max(80, boxH - 52);

    ctx.fillStyle = 'rgba(2, 6, 3, 0.94)';
    ctx.fillRect(mapX, mapY, mapW, mapH);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(mapX, mapY, mapW, mapH);

    const viewHalfX = inApproachGate ? 34 : 95;
    const viewMaxY = inApproachGate ? 85 : 185;

    const toMapX = (wx: number) =>
      mapX + mapW * Math.max(0.02, Math.min(0.98, 0.5 + (wx - padCenter) / (viewHalfX * 2)));
    const toMapY = (wy: number) =>
      mapY + mapH - 10 - (mapH - 16) * Math.max(-0.08, Math.min(0.96, (wy - pad.y) / viewMaxY));

    ctx.save();
    ctx.beginPath();
    ctx.rect(mapX + 1, mapY + 1, mapW - 2, mapH - 2);
    ctx.clip();

    const pLeftX = toMapX(pad.x1);
    const pRightX = toMapX(pad.x2);
    const pBaseY = toMapY(pad.y);
    ctx.strokeStyle = 'rgba(68, 255, 119, 0.24)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(pLeftX, pBaseY);
    ctx.lineTo(toMapX(padCenter - viewHalfX * 0.65), mapY + 4);
    ctx.moveTo(pRightX, pBaseY);
    ctx.lineTo(toMapX(padCenter + viewHalfX * 0.65), mapY + 4);
    ctx.moveTo(toMapX(padCenter), pBaseY);
    ctx.lineTo(toMapX(padCenter), mapY + 4);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = THEME.TEXT_SECONDARY;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (const pt of sector.terrain) {
      if (pt.x < padCenter - viewHalfX * 1.15 || pt.x > padCenter + viewHalfX * 1.15) continue;
      const mx = toMapX(pt.x);
      const my = toMapY(pt.y);
      if (!started) {
        ctx.moveTo(mx, my);
        started = true;
      } else {
        ctx.lineTo(mx, my);
      }
    }
    ctx.stroke();

    ctx.strokeStyle = pad.type === 'DEPOT' ? THEME.ACCENT_CYAN : THEME.ACCENT_AMBER_HI;
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.moveTo(pLeftX, pBaseY);
    ctx.lineTo(pRightX, pBaseY);
    ctx.stroke();

    const shipX = toMapX(lander.pos.x);
    const shipY = toMapY(lander.pos.y + PHYSICS.STRUT_REST_BOTTOM_Y);
    const spanPx = Math.max(4, (PHYSICS.STRUT_SPAN_HALF_X / (viewHalfX * 2)) * mapW);

    const velEndX = toMapX(lander.pos.x + lander.vel.x * 2.5);
    const velEndY = toMapY(lander.pos.y + PHYSICS.STRUT_REST_BOTTOM_Y + lander.vel.y * 2.5);
    ctx.strokeStyle = vsGo && hsGo ? THEME.TEXT_PRIMARY : THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(shipX, shipY);
    ctx.lineTo(velEndX, velEndY);
    ctx.stroke();

    ctx.strokeStyle = aligned && vsGo && hsGo ? THEME.TEXT_BRIGHT : THEME.ACCENT_AMBER_HI;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(shipX - spanPx, shipY);
    ctx.lineTo(shipX + spanPx, shipY);
    ctx.moveTo(shipX, shipY - 5);
    ctx.lineTo(shipX, shipY + 2);
    ctx.stroke();

    ctx.restore();
    ctx.restore();
  }

  /**
   * TOP-CENTER GO / NO-GO LANDING ENVELOPE HUD + CENTERLINE SOFT-KISS ILS BAR
   * Enforces >=12px effective typography via `font(..., cs)` at every viewport scale.
   */
  private drawTopGoNoGoHud(
    ctx: CanvasRenderingContext2D,
    w: number,
    layout: HudLayoutMetrics,
    pad: LandingPad,
    distM: number,
    vs: number,
    hs: number,
    deg: number,
    offsetM: number,
    lockedGrade: TouchdownSnapshot['grade'] | null,
    timeSec: number
  ): void {
    const cs = layout.centerScale;
    const basePanelW = 612;
    const basePanelH = 160;
    const cx = w * 0.5;
    const topY = layout.topHeaderY;

    const padHalfW = Math.max(1, (pad.x2 - pad.x1) * 0.5);
    const env = evaluateLandingEnvelope(vs, hs, deg, offsetM, padHalfW);
    const {
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
    } = env;
    const anyFatal =
      env.anyFatal || (!inSafeAlign && lockedGrade === 'CATASTROPHIC');

    ctx.save();
    ctx.translate(cx - basePanelW * cs * 0.5, topY);
    ctx.scale(cs, cs);

    ctx.fillStyle = 'rgba(3, 9, 5, 0.94)';
    ctx.fillRect(0, 0, basePanelW, basePanelH);

    const frameCol =
      lockedGrade === 'CATASTROPHIC'
        ? THEME.ALERT_RED_STROKE
        : lockedGrade === 'HARD_SURVIVAL'
          ? THEME.ACCENT_AMBER
          : allGo
            ? THEME.TEXT_PRIMARY
            : anyFatal
              ? THEME.ALERT_RED_STROKE
              : THEME.ACCENT_AMBER;
    drawCornerBrackets(ctx, 0, 0, basePanelW, basePanelH, 14, frameCol, 2.4);

    // Header Bar
    const padTag = pad.type === 'DEPOT' ? `${SEMIOTIC_ICONS.CROSS} FUEL DEPOT` : `${pad.multiplier}X`;
    ctx.textAlign = 'left';
    ctx.font = font('head', 15, cs);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    const headerLeft = lockedGrade
      ? `TOUCHDOWN REPORT // ${pad.label} [${padTag}]`
      : `LANDING GATE // ${pad.label} [${padTag}] // ${distM.toFixed(0)}M`;
    drawEllipsizedText(ctx, headerLeft, 14, 21, 355);

    ctx.textAlign = 'right';
    ctx.font = font('head', 15, cs);
    const blink = lockedGrade ? 1.0 : 0.8 + 0.2 * Math.sin(timeSec * 12);
    ctx.globalAlpha = allGo ? 1 : blink;

    let rightStatus = '';
    if (lockedGrade === 'SOFT_KISS') {
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      rightStatus = `${SEMIOTIC_ICONS.STAR} SOFT KISS ACHIEVED`;
    } else if (lockedGrade === 'NOMINAL_SAFE') {
      ctx.fillStyle = THEME.TEXT_PRIMARY;
      rightStatus = `${SEMIOTIC_ICONS.DOT_LIVE} SAFE GO`;
    } else if (lockedGrade === 'HARD_SURVIVAL') {
      ctx.fillStyle = THEME.ACCENT_AMBER;
      rightStatus = `${SEMIOTIC_ICONS.TRIANGLE} HARD LANDING`;
    } else if (lockedGrade === 'CATASTROPHIC') {
      ctx.fillStyle = THEME.ALERT_RED_TEXT;
      rightStatus = '✖ HULL BREACH (NO-GO)';
    } else {
      ctx.fillStyle = allGo
        ? THEME.TEXT_BRIGHT
        : anyFatal
          ? THEME.ALERT_RED_TEXT
          : THEME.ACCENT_AMBER_HI;
      rightStatus = allKiss
        ? `${SEMIOTIC_ICONS.STAR} SOFT KISS: GO`
        : allGo
          ? `${SEMIOTIC_ICONS.DOT_LIVE} TOUCHDOWN: GO`
          : anyFatal
            ? '✖ TOUCHDOWN: NO-GO'
            : `${SEMIOTIC_ICONS.TRIANGLE} CAUTION`;
    }
    ctx.fillText(rightStatus, basePanelW - 14, 21);
    ctx.globalAlpha = 1;

    // 3 Criteria Modules (100% synced to PHYSICS + evaluateLandingEnvelope!)
    const criteria = [
      {
        title: 'V/S',
        valueStr: `${vs.toFixed(1)} M/S`,
        limitStr: vsGo ? `KISS≤${PHYSICS.KISS_VS_MAX.toFixed(1)}` : `GO≤${PHYSICS.SAFE_VS_MAX.toFixed(1)}`,
        go: vsGo,
        kiss: vsKiss,
        fatal: vsFatal,
      },
      {
        title: 'H/S',
        valueStr: `${hs.toFixed(1)} M/S`,
        limitStr: hsGo ? `KISS≤${PHYSICS.KISS_HS_MAX.toFixed(1)}` : `GO≤${PHYSICS.SAFE_HS_MAX.toFixed(1)}`,
        go: hsGo,
        kiss: hsKiss,
        fatal: hsFatal,
      },
      {
        title: 'ATT',
        valueStr: `${deg.toFixed(1)}°`,
        limitStr: attGo
          ? `KISS≤${PHYSICS.KISS_ANGLE_DEG.toFixed(0)}°`
          : `GO≤${PHYSICS.SAFE_ANGLE_DEG.toFixed(0)}°`,
        go: attGo,
        kiss: attKiss,
        fatal: attFatal,
      },
    ];

    const gap = 10;
    const cardW = (basePanelW - 24 - gap * 2) / 3;
    const cardY = 29;
    const cardH = 60;

    criteria.forEach((c, idx) => {
      const cardX = 12 + idx * (cardW + gap);
      const strokeCol = c.go
        ? THEME.TEXT_PRIMARY
        : c.fatal
          ? THEME.ALERT_RED_STROKE
          : THEME.ACCENT_AMBER;
      const textCol = c.go
        ? THEME.TEXT_PRIMARY
        : c.fatal
          ? THEME.ALERT_RED_TEXT
          : THEME.ACCENT_AMBER;
      const brightCol = c.go
        ? THEME.TEXT_BRIGHT
        : c.fatal
          ? THEME.ALERT_RED_TEXT
          : THEME.ACCENT_AMBER_HI;

      ctx.fillStyle = c.go
        ? 'rgba(68, 255, 119, 0.10)'
        : c.fatal
          ? 'rgba(255, 51, 24, 0.16)'
          : 'rgba(255, 176, 0, 0.12)';
      ctx.fillRect(cardX, cardY, cardW, cardH);

      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = 2.0;
      ctx.strokeRect(cardX, cardY, cardW, cardH);

      ctx.textAlign = 'left';
      ctx.font = font('micro', 12, cs);
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      ctx.fillText(c.title, cardX + 7, cardY + 17);

      ctx.textAlign = 'right';
      ctx.font = font('micro', 12, cs);
      ctx.fillStyle = textCol;
      ctx.fillText(c.limitStr, cardX + cardW - 7, cardY + 17);

      ctx.textAlign = 'left';
      ctx.font = font('data', 18, cs);
      ctx.fillStyle = brightCol;
      ctx.fillText(c.valueStr, cardX + 7, cardY + 47);

      const statusText = c.kiss ? 'KISS' : c.go ? 'GO' : c.fatal ? 'NO-GO' : 'CAUT';
      const pillW = c.fatal ? 64 : 56;
      const pillH = 24;
      const pillX = cardX + cardW - pillW - 6;
      const pillY = cardY + 29;

      ctx.fillStyle = strokeCol;
      ctx.fillRect(pillX, pillY, pillW, pillH);

      ctx.textAlign = 'center';
      ctx.font = font('micro', 12, cs);
      ctx.fillStyle = THEME.INK_INVERSE;
      ctx.fillText(statusText, pillX + pillW * 0.5, pillY + 16);
    });

    // Horizontal ILS Centerline Indicator
    const ilsX = 12;
    const ilsW = basePanelW - 24;
    const ilsCaptionY = 107;
    const barY = 115;
    const barH = 34;
    const midBarX = ilsX + ilsW * 0.5;

    const maxRangeM = Math.max(15, padHalfW * 1.85);
    const toIlsX = (m: number) =>
      ilsX + ilsW * (0.5 + Math.max(-0.485, Math.min(0.485, m / (maxRangeM * 2))));

    ctx.textAlign = 'left';
    ctx.font = font('micro', 12, cs);
    ctx.fillStyle = THEME.TEXT_PRIMARY;
    ctx.fillText(`ILS SOFT KISS (±${kissBoundM.toFixed(1)}M)`, ilsX + 2, ilsCaptionY);

    ctx.textAlign = 'right';
    ctx.font = font('micro', 12, cs);
    if (inKissAlign) {
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      ctx.fillText(
        `OFFSET ${offsetM >= 0 ? '+' : ''}${offsetM.toFixed(1)}M [${SEMIOTIC_ICONS.STAR} KISS LOCK]`,
        ilsX + ilsW - 2,
        ilsCaptionY
      );
    } else if (inSafeAlign) {
      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      ctx.fillText(
        `OFFSET ${offsetM >= 0 ? '+' : ''}${offsetM.toFixed(1)}M [STEER ${offsetM > 0 ? '◄' : '►'}]`,
        ilsX + ilsW - 2,
        ilsCaptionY
      );
    } else {
      ctx.fillStyle = THEME.ALERT_RED_TEXT;
      ctx.fillText(
        `OFFSET ${offsetM >= 0 ? '+' : ''}${offsetM.toFixed(1)}M [OFF PAD ${offsetM > 0 ? '◄◄' : '►►'}]`,
        ilsX + ilsW - 2,
        ilsCaptionY
      );
    }

    ctx.fillStyle = 'rgba(2, 6, 4, 0.96)';
    ctx.fillRect(ilsX, barY, ilsW, barH);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ilsX, barY, ilsW, barH);

    const safeLeftX = toIlsX(-safeBoundM);
    const safeRightX = toIlsX(safeBoundM);
    ctx.fillStyle = 'rgba(255, 176, 0, 0.08)';
    ctx.fillRect(safeLeftX, barY + 2, safeRightX - safeLeftX, barH - 4);
    ctx.strokeStyle = 'rgba(255, 176, 0, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(safeLeftX, barY + 2);
    ctx.lineTo(safeLeftX, barY + barH - 2);
    ctx.moveTo(safeRightX, barY + 2);
    ctx.lineTo(safeRightX, barY + barH - 2);
    ctx.stroke();

    const kissLeftX = toIlsX(-kissBoundM);
    const kissRightX = toIlsX(kissBoundM);
    ctx.fillStyle = inKissAlign ? 'rgba(68, 255, 119, 0.24)' : 'rgba(68, 255, 119, 0.14)';
    ctx.fillRect(kissLeftX, barY + 2, kissRightX - kissLeftX, barH - 4);

    ctx.strokeStyle = THEME.TEXT_BRIGHT;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(kissLeftX + 6, barY + 3);
    ctx.lineTo(kissLeftX, barY + 3);
    ctx.lineTo(kissLeftX, barY + barH - 3);
    ctx.lineTo(kissLeftX + 6, barY + barH - 3);

    ctx.moveTo(kissRightX - 6, barY + 3);
    ctx.lineTo(kissRightX, barY + 3);
    ctx.lineTo(kissRightX, barY + barH - 3);
    ctx.lineTo(kissRightX - 6, barY + barH - 3);
    ctx.stroke();

    ctx.strokeStyle = THEME.TEXT_PRIMARY;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(midBarX, barY + 2);
    ctx.lineTo(midBarX, barY + barH - 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = font('micro', 12, cs);
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.textAlign = 'right';
    ctx.fillText('PAD L', safeLeftX - 5, barY + 22);
    ctx.textAlign = 'left';
    ctx.fillText('PAD R', safeRightX + 5, barY + 22);

    const bugX = toIlsX(offsetM);
    const bugY = barY + barH * 0.5;
    const bugCol = inKissAlign
      ? THEME.TEXT_BRIGHT
      : inSafeAlign
        ? THEME.ACCENT_AMBER_HI
        : THEME.ALERT_RED_STROKE;

    ctx.fillStyle = bugCol;
    ctx.strokeStyle = THEME.BG_VOID;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bugX, bugY - 9);
    ctx.lineTo(bugX + 8, bugY);
    ctx.lineTo(bugX, bugY + 9);
    ctx.lineTo(bugX - 8, bugY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  // =========================================================================
  // DESKTOP TITLE MENU (NO DUPLICATED SEC-01..06 INNER BUTTONS, AMBER TITLE)
  // =========================================================================

  private formatMainMenuLeader(
    leader: CrewManifestEntry | null,
    status: 'LOADING' | 'LIVE' | 'OFFLINE'
  ): string {
    if (status === 'LOADING') return 'SYNCING RELAY...';
    if (!leader) return status === 'OFFLINE' ? 'LOCAL ARCHIVE // UNCLAIMED' : 'UNCLAIMED';
    return `${leader.callsign} — ${leader.score.toLocaleString()} PTS (${leader.highestSector})`;
  }

  private getTitleMenuBoxRect(w: number, h: number): ViewportRect {
    const boxW = Math.min(720, Math.max(520, Math.floor(w * 0.46)));
    const boxH = Math.min(590, Math.max(500, h - TOP_CHROME_BAR_HEIGHT - CONTROLS_STRIP_HEIGHT - 44));
    const bx = Math.round((w - boxW) * 0.5);
    const by = Math.round(
      Math.max(TOP_CHROME_BAR_HEIGHT + 10, (h - CONTROLS_STRIP_HEIGHT - boxH) * 0.5 + 14)
    );
    return { x: bx, y: by, width: boxW, height: boxH };
  }

  private drawTitleMenu(
    ctx: CanvasRenderingContext2D,
    w: number,
    _h: number,
    state: HudRenderContext,
    menuBox: ViewportRect
  ): void {
    ctx.save();
    const { x: bx, y: by, width: boxW, height: boxH } = menuBox;
    const isRanked = state.selectedMenuMode === 'RANKED_CAMPAIGN';
    const isPractice = state.selectedMenuMode === 'PRACTICE';
    const isEndless = state.selectedMenuMode === 'ENDLESS';
    const isRankedSelection = isRanked || isEndless;

    ctx.fillStyle = THEME.BG_PANEL;
    ctx.fillRect(bx, by, boxW, boxH);
    drawCornerBrackets(
      ctx,
      bx,
      by,
      boxW,
      boxH,
      20,
      isRankedSelection ? THEME.ACCENT_AMBER : THEME.TEXT_PRIMARY,
      2.4
    );

    drawRankedTitleRibbon(
      ctx,
      bx + 20,
      by + 10,
      boxW - 40,
      24,
      isRanked
        ? `${SEMIOTIC_ICONS.STAR} RANKED CAMPAIGN ARMED — 6 SECTORS · 3 SHUTTLES · GLOBAL RECORD ${SEMIOTIC_ICONS.STAR}`
        : isEndless
          ? `${SEMIOTIC_ICONS.STAR} RANKED ENDLESS ARMED — PROCEDURAL DEEP-SURVEY ${SEMIOTIC_ICONS.STAR}`
          : `PRACTICE MODE — SEC-0${state.selectedStartSector} OF 06 (UNRANKED · NOT RECORDED)`,
      state.timeSec,
      isRankedSelection
    );

    // Header Title: Weyland-Yutani Amber Gold (THEME.ACCENT_AMBER) in Ranked Mode!
    ctx.textAlign = 'center';
    ctx.font = font('display', 32);
    ctx.fillStyle = isRankedSelection ? THEME.ACCENT_AMBER : THEME.TEXT_PRIMARY;
    drawEllipsizedText(ctx, 'LV-426 LUNAR LANDER', w * 0.5, by + 64, boxW - 40);

    // Reigning Champions Strip
    const stripX = bx + 20;
    const stripW = boxW - 40;
    const stripY = by + 76;
    const stripH = 54;

    ctx.fillStyle = 'rgba(22, 14, 3, 0.80)';
    ctx.fillRect(stripX, stripY, stripW, stripH);
    ctx.strokeStyle = THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(stripX, stripY, stripW, stripH);

    ctx.font = font('data', 13);
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.TEXT_PRIMARY;
    ctx.fillText('CAMPAIGN #01:', stripX + 12, stripY + 21);
    ctx.fillText('ENDLESS  #01:', stripX + 12, stripY + 42);

    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    drawEllipsizedText(
      ctx,
      this.formatMainMenuLeader(state.campaignLeader, state.uplinkConnectionStatus),
      stripX + 136,
      stripY + 21,
      stripW - 148
    );
    drawEllipsizedText(
      ctx,
      this.formatMainMenuLeader(state.endlessLeader, state.uplinkConnectionStatus),
      stripX + 136,
      stripY + 42,
      stripW - 148
    );

    const btnW = boxW - 40;
    const btnX = bx + 20;
    let curY = stripY + stripH + 8;

    // Super-Obvious Optional 1979 CRT 1.5X Ranked Challenge Banner (1-click toggle)
    const crt1979On = state.crtPreset === 'CLASSIC_1979';
    draw1979RankedBonusBanner(
      ctx,
      { x: btnX, y: curY, width: btnW, height: 32 },
      crt1979On,
      state.hoveredButtonId,
      state.timeSec,
      this.buttons as ChromeButtonHitbox[]
    );
    curY += 38;

    // 1. 1-Click RANKED CAMPAIGN Launch Button
    drawChromeButton(
      ctx,
      { x: btnX, y: curY, width: btnW, height: 40 },
      crt1979On
        ? `${SEMIOTIC_ICONS.PLAY} RANKED CAMPAIGN — 6 SECTORS [1.5X 1979 BONUS]`
        : `${SEMIOTIC_ICONS.PLAY} RANKED CAMPAIGN — ALL 6 SECTORS (CLICK OR [ENTER])`,
      {
        id: 'menu-select-ranked',
        accent: 'amber',
        active: isRanked,
        hovered: state.hoveredButtonId === 'menu-select-ranked',
        fontPx: 15,
      },
      this.buttons as ChromeButtonHitbox[]
    );
    curY += 46;

    // 2. PRACTICE MODE (Single Clean Row — NO duplicated 6 inner SEC-01..06 buttons! Flanking topo cards select/launch!)
    drawChromeButton(
      ctx,
      { x: btnX, y: curY, width: btnW, height: 38 },
      `PRACTICE SEC-0${state.selectedStartSector} — CLICK ANY FLANKING SECTOR MAP OR PRESS [←/→]`,
      {
        id: 'menu-select-practice',
        accent: 'green',
        active: isPractice,
        hovered: state.hoveredButtonId === 'menu-select-practice',
        fontPx: 13,
      },
      this.buttons as ChromeButtonHitbox[]
    );
    curY += 44;

    // 3. ENDLESS DEEP-SURVEY + GLOBAL LEADERBOARD + TOUCH DECK Row
    const rowGap = 8;
    const endW = Math.floor(btnW * 0.45);
    const logW = Math.floor((btnW - endW - rowGap * 2) * 0.54);
    const mobW = btnW - endW - logW - rowGap * 2;

    drawChromeButton(
      ctx,
      { x: btnX, y: curY, width: endW, height: 38 },
      crt1979On
        ? `${SEMIOTIC_ICONS.STAR} ENDLESS SURVEY [1.5X]`
        : `${SEMIOTIC_ICONS.STAR} ENDLESS SURVEY (RANKED)`,
      {
        id: 'menu-select-endless',
        accent: 'amber',
        active: isEndless,
        hovered: state.hoveredButtonId === 'menu-select-endless',
        fontPx: 13,
      },
      this.buttons as ChromeButtonHitbox[]
    );
    drawChromeButton(
      ctx,
      { x: btnX + endW + rowGap, y: curY, width: logW, height: 38 },
      `${SEMIOTIC_ICONS.STAR} LEADERBOARD`,
      {
        id: 'menu-logs',
        accent: 'cyan',
        hovered: state.hoveredButtonId === 'menu-logs',
        fontPx: 13,
      },
      this.buttons as ChromeButtonHitbox[]
    );
    drawChromeButton(
      ctx,
      { x: btnX + endW + logW + rowGap * 2, y: curY, width: mobW, height: 38 },
      'MOBILE MODE',
      {
        id: 'menu-toggle-mobile',
        accent: 'muted',
        hovered: state.hoveredButtonId === 'menu-toggle-mobile',
        fontPx: 12,
      },
      this.buttons as ChromeButtonHitbox[]
    );
    curY += 46;

    // 4. Clean 2-Column Scannable Flight Deck Controls + SAS Note
    const legY = curY;
    const legH = Math.max(150, boxH - (legY - by) - 14);
    const legX = bx + 20;
    const legW = boxW - 40;

    ctx.fillStyle = 'rgba(3, 10, 6, 0.90)';
    ctx.fillRect(legX, legY, legW, legH);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(legX, legY, legW, legH);

    ctx.font = font('head', 14);
    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.textAlign = 'left';
    drawEllipsizedText(
      ctx,
      'FLIGHT DECK CONTROLS // [H] QUICK-CARD · [ESC] SYSTEM MENU',
      legX + 12,
      legY + 21,
      legW - 24
    );

    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(legX + 12, legY + 29);
    ctx.lineTo(legX + legW - 12, legY + 29);
    ctx.stroke();

    const leftControls: Array<[string, string]> = [
      ['[W / ↑]', 'Main Thrust (+SHIFT OVR)'],
      ['[A / D]', 'RCS Roll Thrusters'],
      ['[S / ↓]', 'Retro-Brake Stabilizer'],
      ['[SPACE]', '1X Pulse (0.6s Arm)'],
    ];
    const rightControls: Array<[string, string]> = [
      ['[LMB]', 'Ping Directional Radar'],
      ['[SCROLL]', 'Manual Zoom (1X–3.5X)'],
      ['[P] / [M]', 'Pause · Master Mute'],
      ['[ESC]', 'System Menu / CRT / SAS'],
    ];

    const sasStripH = 30;
    const rowsAvailH = Math.max(84, legH - 38 - sasStripH - 10);
    const lineStep = Math.min(28, Math.max(20, Math.floor(rowsAvailH / 4)));
    const keyOffset = legW < 560 ? 74 : 84;
    const rightColX = legX + Math.floor(legW * 0.52);

    ctx.font = font('data', 13);
    leftControls.forEach(([key, desc], i) => {
      const ry = legY + 49 + i * lineStep;
      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      ctx.fillText(key, legX + 12, ry);
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      drawEllipsizedText(ctx, desc, legX + 12 + keyOffset, ry, rightColX - legX - keyOffset - 18);
    });

    rightControls.forEach(([key, desc], i) => {
      const ry = legY + 49 + i * lineStep;
      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      ctx.fillText(key, rightColX, ry);
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      drawEllipsizedText(
        ctx,
        desc,
        rightColX + keyOffset,
        ry,
        legX + legW - rightColX - keyOffset - 12
      );
    });

    // Accurate SAS Status Strip pointing to [ESC] System Menu
    const sasY = legY + legH - sasStripH - 8;
    const sasOn = state.bezel.sasEnabled;
    ctx.fillStyle = sasOn ? 'rgba(20, 56, 30, 0.85)' : 'rgba(26, 18, 5, 0.85)';
    ctx.fillRect(legX + 10, sasY, legW - 20, sasStripH);
    ctx.strokeStyle = sasOn ? THEME.TEXT_PRIMARY : THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(legX + 10, sasY, legW - 20, sasStripH);

    const sasInfo = sasOn
      ? 'SAS [ON]: 50% GENTLE ROLL ASSIST · CONFIGURE IN [ESC] MENU'
      : 'SAS [OFF]: 100% RAW RCS TORQUE · ENABLE 50% ASSIST IN [ESC] MENU';
    ctx.font = font('micro', 12);
    ctx.fillStyle = sasOn ? THEME.TEXT_BRIGHT : THEME.ACCENT_AMBER_HI;
    ctx.textAlign = 'center';
    drawEllipsizedText(ctx, sasInfo, legX + legW * 0.5, sasY + 19, legW - 32);

    ctx.restore();
  }

  // =========================================================================
  // MISSION MODALS (ALL ISOLATED THROUGH drawModalFrame + SHARED CHROME!)
  // =========================================================================

  private drawSectorBriefingOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    const m = drawModalFrame(
      ctx,
      w,
      h,
      {
        title: `${state.sector.code} // ${state.sector.name}`,
        subtitle: state.sector.subtitle,
        maxWidth: 680,
        maxHeight: 330,
        accentColor: THEME.ACCENT_AMBER,
        rightBadge: { text: 'ORBITAL DROP', tone: 'amber' },
      },
      this.buttons as ChromeButtonHitbox[]
    );

    ctx.save();
    ctx.font = font('prose', 14);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.textAlign = 'left';
    let rem = state.briefingProgressChars;
    let cy = m.contentY + 10;
    for (const line of state.sector.briefingLines) {
      if (rem <= 0 || cy > m.footerY - 16) break;
      const shown = line.slice(0, rem);
      rem -= line.length;
      const wrapped = wrapTextLines(ctx, `> ${shown}`, m.contentW - 8, 2);
      for (const wl of wrapped) {
        if (cy > m.footerY - 16) break;
        ctx.fillText(wl, m.contentX, cy);
        cy += 22;
      }
      cy += 6;
    }
    ctx.restore();

    const btnW = Math.min(390, m.contentW);
    drawChromeButton(
      ctx,
      {
        x: m.contentX + Math.round((m.contentW - btnW) * 0.5),
        y: m.footerY,
        width: btnW,
        height: 40,
      },
      `${SEMIOTIC_ICONS.PLAY} ENGAGE LATCH & DROP [W / SPACE / ENTER]`,
      {
        id: 'briefing-launch',
        accent: 'amber',
        active: true,
        hovered: state.hoveredButtonId === 'briefing-launch',
        fontPx: 14,
      },
      this.buttons as ChromeButtonHitbox[]
    );
  }

  private drawSectorTallyOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    bd: SectorScoreBreakdown
  ): void {
    const gradeColor =
      bd.grade === 'SOFT_KISS'
        ? THEME.TEXT_PRIMARY
        : bd.grade === 'HARD_SURVIVAL'
          ? THEME.ACCENT_AMBER
          : THEME.TEXT_PRIMARY;
    const gradeBanner =
      bd.grade === 'SOFT_KISS'
        ? 'TOUCHDOWN CONFIRMED // PRECISION KISS LANDING'
        : bd.grade === 'HARD_SURVIVAL'
          ? 'SURVIVAL TOUCHDOWN // HULL & GEAR DAMAGED'
          : 'TOUCHDOWN CONFIRMED // EXTRACTION NOMINAL';

    const m = drawModalFrame(
      ctx,
      w,
      h,
      {
        title: gradeBanner,
        subtitle: `V/S ${bd.touchdownVs.toFixed(2)} M/S · H/S ${bd.touchdownHs.toFixed(2)} M/S · ATT ${bd.touchdownDeg.toFixed(1)}° · RATING ${bd.accuracyRating} (${bd.accuracyPercent}%)`,
        maxWidth: 680,
        maxHeight: 400,
        accentColor: gradeColor,
        rightBadge: {
          text: `${bd.accuracyRating} (${bd.accuracyPercent}%)`,
          tone: bd.grade === 'HARD_SURVIVAL' ? 'amber' : 'live',
        },
      },
      this.buttons as ChromeButtonHitbox[]
    );

    const anim = Math.max(0, Math.min(1, state.tallyAnimProgress));
    const rows: Array<[string, string, string]> = [
      [
        `EXTRACTION PAD [${bd.padLabel}]`,
        `${bd.basePadValue} × ${bd.padMultiplier}X`,
        `+${Math.round(bd.padScore * anim).toLocaleString()}`,
      ],
      [
        'REMAINING PROPELLANT RESERVE',
        `${bd.remainingFuelKg.toFixed(0)} KG × 15`,
        `+${Math.round(bd.fuelBonus * anim).toLocaleString()}`,
      ],
      [
        'PRECISION KISS-LANDING BONUS',
        bd.precisionKissBonus > 0 ? 'CENTERED / SOFT' : 'NONE',
        `+${Math.round(bd.precisionKissBonus * anim).toLocaleString()}`,
      ],
      [
        'NO-DAMAGE INTEGRITY BONUS',
        bd.noDamageBonus > 0 ? '100% HULL INTACT' : 'DAMAGE PENALTY',
        `+${Math.round(bd.noDamageBonus * anim).toLocaleString()}`,
      ],
      [
        'CONSECUTIVE SAFE DROP STREAK',
        `SUBTOTAL × ${bd.streakMultiplier}X`,
        `${bd.streakMultiplier}X`,
      ],
    ];

    ctx.save();
    rows.forEach(([title, formula, pts], i) => {
      const ry = m.contentY + 14 + i * 28;
      ctx.font = font('data', 13);
      ctx.textAlign = 'left';
      ctx.fillStyle = THEME.TEXT_PRIMARY;
      ctx.fillText(title, m.contentX, ry);

      ctx.textAlign = 'center';
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      ctx.fillText(formula, m.contentX + m.contentW * 0.64, ry);

      ctx.textAlign = 'right';
      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      ctx.fillText(pts, m.contentX + m.contentW, ry);
    });

    const sumLineY = m.contentY + 162;
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(m.contentX, sumLineY);
    ctx.lineTo(m.contentX + m.contentW, sumLineY);
    ctx.stroke();

    ctx.font = font('display', 19);
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.fillText('SECTOR TELEMETRY SCORE', m.contentX, sumLineY + 28);

    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.fillText(
      `+${Math.round(bd.sectorTotal * anim).toLocaleString()} PTS`,
      m.contentX + m.contentW,
      sumLineY + 28
    );

    ctx.font = font('data', 13);
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.fillText(
      state.isPracticeRun
        ? 'PRACTICE TARGET EXTRACTED — RETRY SECTOR OR RETURN TO MENU'
        : `CUMULATIVE MISSION TOTAL: ${Math.round(state.missionScore).toLocaleString()} PTS`,
      m.contentX + m.contentW,
      sumLineY + 54
    );
    ctx.restore();

    if (state.isPracticeRun) {
      const gap = 10;
      const halfW = Math.floor((m.contentW - gap) * 0.5);
      drawChromeButton(
        ctx,
        { x: m.contentX, y: m.footerY, width: halfW, height: 40 },
        `${SEMIOTIC_ICONS.REPLAY} RETRY SECTOR [R]`,
        {
          id: 'tally-retry',
          accent: 'amber',
          active: true,
          hovered: state.hoveredButtonId === 'tally-retry',
          fontPx: 14,
        },
        this.buttons as ChromeButtonHitbox[]
      );
      drawChromeButton(
        ctx,
        { x: m.contentX + halfW + gap, y: m.footerY, width: m.contentW - halfW - gap, height: 40 },
        '[ENTER] MAIN MENU',
        {
          id: 'tally-next',
          accent: 'green',
          hovered: state.hoveredButtonId === 'tally-next',
          fontPx: 14,
        },
        this.buttons as ChromeButtonHitbox[]
      );
    } else {
      const isFinalCampaignSector = !state.sector.endlessMode && state.sector.index >= 6;
      const btnW = Math.min(420, m.contentW);
      drawChromeButton(
        ctx,
        {
          x: m.contentX + Math.round((m.contentW - btnW) * 0.5),
          y: m.footerY,
          width: btnW,
          height: 40,
        },
        isFinalCampaignSector
          ? `${SEMIOTIC_ICONS.STAR} COMPLETE CAMPAIGN DEBRIEF [ENTER]`
          : `${SEMIOTIC_ICONS.PLAY} PROCEED TO NEXT SECTOR [ENTER]`,
        {
          id: 'tally-next',
          accent: 'green',
          active: true,
          hovered: state.hoveredButtonId === 'tally-next',
          fontPx: 14,
        },
        this.buttons as ChromeButtonHitbox[]
      );
    }
  }

  /**
   * Mid-Run Hull Breach Overlay (ONLY shown while `lives > 0`!).
   * When `lives <= 0`, game transitions directly into unified `GameOverDebriefModal`!
   */
  private drawHullBreachOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    const m = drawModalFrame(
      ctx,
      w,
      h,
      {
        title: `HULL BREACH // ${state.lives} SHUTTLE${state.lives === 1 ? '' : 'S'} REMAINING`,
        subtitle: state.lastFailure?.reason ?? 'CATASTROPHIC STRUCTURAL IMPACT',
        maxWidth: 640,
        maxHeight: 260,
        accentColor: THEME.ALERT_RED_STROKE,
        rightBadge: { text: `${state.lives}/${state.maxLives} LEFT`, tone: 'red' },
      },
      this.buttons as ChromeButtonHitbox[]
    );

    ctx.save();
    ctx.textAlign = 'center';
    if (state.lastFailure) {
      ctx.font = font('data', 14);
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      ctx.fillText(
        `IMPACT — V/S: ${state.lastFailure.impactVs.toFixed(1)} M/S  |  H/S: ${state.lastFailure.impactHs.toFixed(1)} M/S  |  ATT: ${state.lastFailure.impactDeg.toFixed(1)}°`,
        m.contentX + m.contentW * 0.5,
        m.contentY + 24
      );
    }

    ctx.font = font('data', 13);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.fillText(
      `RUN SCORE PRESERVED: ${Math.round(state.missionScore).toLocaleString()} PTS  ·  DROP STREAK RESET TO 1X`,
      m.contentX + m.contentW * 0.5,
      m.contentY + 56
    );
    ctx.restore();

    const gap = 12;
    const leftW = Math.floor(m.contentW * 0.55);
    const rightW = m.contentW - leftW - gap;
    drawChromeButton(
      ctx,
      { x: m.contentX, y: m.footerY, width: leftW, height: 40 },
      `${SEMIOTIC_ICONS.PLAY} REDEPLOY SHUTTLE (${state.lives} LEFT) [SPACE / R]`,
      {
        id: 'breach-retry',
        accent: 'amber',
        active: true,
        hovered: state.hoveredButtonId === 'breach-retry',
        fontPx: 13,
      },
      this.buttons as ChromeButtonHitbox[]
    );
    drawChromeButton(
      ctx,
      { x: m.contentX + leftW + gap, y: m.footerY, width: rightW, height: 40 },
      state.isPracticeRun ? '[Q] END PRACTICE' : '[Q] END RUN & DEBRIEF',
      {
        id: 'breach-end',
        accent: 'muted',
        hovered: state.hoveredButtonId === 'breach-end',
        fontPx: 13,
      },
      this.buttons as ChromeButtonHitbox[]
    );
  }

  /**
   * Unified Post-Run Debrief + Inline Opt-In Callsign Modal (shared `PostRunFlow`).
   * Merges Game Over (`lives <= 0`), Campaign Complete, and Callsign Entry into ONE screen!
   */
  private drawUnifiedDebriefOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    const isVictory = state.debriefOutcome === 'VICTORY';
    const isAbort = state.debriefOutcome === 'ABORT';
    const canSubmit = !state.isPracticeRun && state.missionScore > 0;
    const isDone =
      state.uplinkSubmitState === 'CONFIRMED' || state.uplinkSubmitState === 'OFFLINE_SAVED';
    const isSending = state.uplinkSubmitState === 'TRANSMITTING';

    const title = isVictory
      ? 'CAMPAIGN COMPLETE // ALL 6 SECTORS EXTRACTED'
      : isAbort
        ? 'MISSION ABORTED // FINAL TELEMETRY DEBRIEF'
        : 'GAME OVER // ALL 3 DROP-SHUTTLES LOST';

    const subtitle = isVictory
      ? 'USCSS Nostromo orbital docking complete — telemetry ready for Leaderboard uplink.'
      : state.lastFailure
        ? `${state.lastFailure.reason} (V/S ${state.lastFailure.impactVs.toFixed(1)} · H/S ${state.lastFailure.impactHs.toFixed(1)} · ATT ${state.lastFailure.impactDeg.toFixed(0)}°)`
        : 'Orbital descent telemetry finalized.';

    const stats: DebriefStatCard[] = [
      {
        label: 'FINAL SCORE',
        value: `${Math.round(state.missionScore).toLocaleString()}`,
        accent: 'amber',
      },
      {
        label: 'HIGHEST SECTOR',
        value: state.highestSectorCode,
        accent: 'green',
      },
      {
        label: 'ACCURACY',
        value: `${state.avgAccuracyRating} (${state.avgAccuracyPercent}%)`,
        accent: 'cyan',
      },
      {
        label: 'SORTIE MODE',
        value: state.isPracticeRun ? 'PRACTICE' : state.endlessMode ? 'ENDLESS' : 'CAMPAIGN',
        accent: state.isPracticeRun ? 'green' : 'amber',
      },
    ];

    const statusBannerTone: 'green' | 'amber' | 'red' = isDone
      ? 'green'
      : isSending
        ? 'amber'
        : state.uplinkConfirmText
          ? 'red'
          : 'amber';

    const statusBanner = canSubmit
      ? state.uplinkConfirmText
      : state.isPracticeRun
        ? 'Practice sortie complete. Launch Ranked Campaign or Endless Survey to post Leaderboard records.'
        : 'Score 0 PTS — safely extract at least 1 sector to submit a Ranked Leaderboard record.';

    drawGameOverDebriefModal(
      ctx,
      w,
      h,
      {
        title,
        subtitle,
        outcomeTone: isVictory ? 'green' : isAbort ? 'amber' : 'red',
        timeSec: state.timeSec,
        keylockRemainingSec: state.debriefKeylockSec,
        stats,
        isRanked: canSubmit,
        score: Math.round(state.missionScore),
        callsignDraft: state.callsignDraft,
        callsignEditing: state.callsignEditing,
        scoreSubmitted: isDone,
        submittingScore: isSending,
        statusBanner,
        statusBannerTone,
        hoveredButtonId: state.hoveredButtonId,
        playAgainLabel: state.isPracticeRun
          ? `${SEMIOTIC_ICONS.REPLAY} RETRY SECTOR [R]`
          : `${SEMIOTIC_ICONS.REPLAY} PLAY AGAIN [R]`,
      },
      this.buttons as ChromeButtonHitbox[]
    );
  }

  /**
   * Unified `[ESC]` System & Pause Menu (shared `SystemMenuModal`).
   */
  private drawSharedSystemMenu(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    const inRun =
      state.phase === 'FLIGHT' ||
      state.phase === 'PAUSED' ||
      state.phase === 'SECTOR_BRIEFING' ||
      state.phase === 'SECTOR_TALLY';

    const extraRows: SystemMenuExtraRow[] = [
      {
        id: 'lander-sas-toggle',
        label: 'SAS 50% ROLL',
        value: state.bezel.sasEnabled ? '● ON (50% GENTLE)' : '○ OFF (100% RAW)',
        accent: state.bezel.sasEnabled ? 'green' : 'amber',
      },
      {
        id: 'lander-zoom-toggle',
        label: 'AUTO-ZOOM APPROACH',
        value: state.bezel.autoZoomEnabled ? '● ENGAGED (≤95M)' : '○ MANUAL SCROLL',
        accent: state.bezel.autoZoomEnabled ? 'green' : 'amber',
      },
    ];

    if (inRun) {
      extraRows.push({
        id: 'lander-jettison',
        label: 'JETTISON SHUTTLE',
        value:
          state.lives > 1
            ? `REDEPLOY (-1 HULL · ${state.lives - 1} LEFT)`
            : 'LOCKED (FINAL SHUTTLE)',
        accent: state.lives > 1 ? 'red' : 'muted',
        disabled: state.lives <= 1,
      });
    } else {
      extraRows.push({
        id: 'menu-toggle-mobile',
        label: 'CONTROL MODE',
        value: state.mobileMode ? 'MOBILE MODE' : 'DESKTOP MODE',
        accent: 'cyan',
      });
    }

    drawSystemMenuModal(
      ctx,
      w,
      h,
      {
        programTitle: 'LUNAR LANDER',
        activeProgramId: 'lander',
        crtPreset: state.crtPreset,
        crtModeLocked: state.crtModeLocked,
        phosphorTheme: state.phosphorTheme,
        masterVolume: state.masterVolume,
        audioMuted: state.bezel.audioMuted,
        musicEnabled: state.musicEnabled,
        isFullscreen: state.isFullscreen,
        hoveredButtonId: state.hoveredButtonId,
        extraRows,
        canRestart: inRun,
        canReturnToGameMenu: state.phase !== 'TITLE_MENU' && state.phase !== 'BOOT',
        confirmGameMenuPending: state.confirmGameMenuPending,
        restartLabel: state.isPracticeRun
          ? `${SEMIOTIC_ICONS.REPLAY} RESTART SECTOR`
          : `${SEMIOTIC_ICONS.REPLAY} RESTART RUN`,
        confirmExitPending: state.confirmExitPending,
      },
      this.buttons as ChromeButtonHitbox[]
    );
  }

  /**
   * Unified Global Leaderboard Manifest (shared `PostRunFlow`).
   * Proportional columns: RNK | CALLSIGN | SCORE | SECTOR | ACC | DATE + boxed ★ JUST ADDED + PLAY AGAIN [R / ENTER]!
   */
  private drawSharedGlobalManifest(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext
  ): void {
    const uplinkStatus: UplinkStatus =
      state.uplinkConnectionStatus === 'LOADING'
        ? 'SYNCING'
        : state.manifestShowingArchive
          ? 'LOCAL'
          : 'LIVE';

    const recentRun =
      state.lastSubmittedRun && state.lastSubmittedRun.mode === state.manifestTab
        ? state.lastSubmittedRun
        : null;

    let matchedIdx = -1;
    if (recentRun) {
      if (recentRun.docId) {
        matchedIdx = state.manifestEntries.findIndex((e) => e.id === recentRun.docId);
      }
      if (matchedIdx === -1) {
        matchedIdx = state.manifestEntries.findIndex(
          (e) =>
            e.callsign.toUpperCase() === recentRun.callsign.toUpperCase() &&
            e.score === recentRun.score &&
            e.sector === recentRun.sector
        );
      }
    }

    const rows: ManifestRowData[] = state.manifestEntries.map((entry, idx) => ({
      rank: idx + 1,
      callsign: entry.callsign,
      score: entry.score,
      stats: [
        entry.highestSector,
        `${entry.accuracyRating} (${entry.accuracyPercent}%)`,
        entry.isArchiveFallback ? 'ARCHIVE' : entry.date,
      ],
      isJustAdded: idx === matchedIdx,
      isLocalFallback: entry.isArchiveFallback,
    }));

    const justAddedBanner = recentRun
      ? `${SEMIOTIC_ICONS.STAR} RUN LOGGED: RANK #${String(matchedIdx >= 0 ? matchedIdx + 1 : recentRun.rank).padStart(2, '0')} — ${recentRun.callsign} · ${recentRun.score.toLocaleString()} PTS (${recentRun.highestSector}) ${SEMIOTIC_ICONS.STAR}`
      : null;

    const inMidRunPeek =
      !state.manifestOpenedPostRun &&
      (state.phase === 'FLIGHT' ||
        state.phase === 'PAUSED' ||
        state.phase === 'SECTOR_BRIEFING' ||
        state.phase === 'SECTOR_TALLY');

    drawGlobalManifestModal(
      ctx,
      w,
      h,
      {
        title: 'LV-426 LUNAR LANDER // LEADERBOARD',
        uplinkStatus,
        timeSec: state.timeSec,
        columns: LANDER_MANIFEST_COLUMNS,
        rows,
        tabs: [
          {
            id: 'CAMPAIGN',
            label: 'CAMPAIGN (6 SECTORS)',
            active: state.manifestTab === 'CAMPAIGN',
          },
          {
            id: 'ENDLESS',
            label: 'ENDLESS SURVEY',
            active: state.manifestTab === 'ENDLESS',
          },
        ],
        justAddedBanner,
        showPlayAgain: !inMidRunPeek,
        playAgainLabel: state.manifestOpenedPostRun
          ? `${SEMIOTIC_ICONS.PLAY} PLAY AGAIN [R / ENTER]`
          : `${SEMIOTIC_ICONS.PLAY} LAUNCH SORTIE [R / ENTER]`,
        hoveredButtonId: state.hoveredButtonId,
      },
      this.buttons as ChromeButtonHitbox[]
    );
  }
}
