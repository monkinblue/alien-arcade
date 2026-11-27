import {
  CONTROLS_CARD_IDS,
  CONTROLS_STRIP_HEIGHT,
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
  SEMIOTIC_ICONS,
  THEME,
  TOP_CHROME_BAR_HEIGHT,
  wrapTextLines,
  type ChromeButtonHitbox,
  type ControlsCardSpec,
  type ControlsStripItem,
  type DebriefStatCard,
  type ManifestRowData,
  type SystemMenuExtraRow,
  type UplinkStatus,
} from '../render/chrome';
import { drawRankedTitleRibbon } from '../render/RankedBadge';
import type { CrtPreset, PhosphorTheme } from '../shell/Cartridge';
import type { ViewportRect } from '../types';
import type { PerimeterManifest } from './PerimeterManifest';
import type { PerimeterSimulation } from './PerimeterSimulation';
import type { TutorialDirectiveSnapshot } from './PerimeterTutorialDirector';
import { PerimeterWikiRenderer } from './PerimeterWikiRenderer';
import {
  ENDGAME_DIRECTIVES,
  HARDWARE_SPECS,
  MK3_BRANCH_SPECS,
  OMEGA_DIRECTIVES,
  PERIMETER_CONSTANTS,
  TACTICAL_PROTOCOLS,
  WAVE_MUTATORS,
  type ActiveCursorTool,
  type BuildToolId,
  type EndgameDirectiveId,
  type OmegaDirectiveId,
  type PerimeterLastSubmittedRun,
  type PlacedTurret,
  type ProtocolId,
} from './types';

export interface PerimeterLayout {
  hudScale: number;
  topBarH: number;
  controlsStripH: number;
  leftPanel: ViewportRect;
  rightPanel: ViewportRect;
  bottomLog: ViewportRect;
  blueprintViewport: ViewportRect;
}

export interface PerimeterHudRenderParams {
  width: number;
  height: number;
  timeSec: number;
  sim: PerimeterSimulation;
  manifest: PerimeterManifest;
  activeTool: ActiveCursorTool;
  selectedTurretId: string | null;
  selectedDoorId: string | null;
  hoveredButtonId: string | null;
  audioMuted: boolean;
  isFullscreen: boolean;
  crtPreset: CrtPreset;
  phosphorTheme: PhosphorTheme;
  masterVolume: number;
  confirmExitPending: boolean;
  osdMenuOpen: boolean;
  manifestOpen: boolean;
  wikiOpen: boolean;
  controlsCardOpen: boolean;
  pauseBannerOpen: boolean;
  draftPeekMap: boolean;
  wikiChapterIdx: number;
  wikiScrollPx: number;
  tutorialDirective: TutorialDirectiveSnapshot;
  callsignDraft: string;
  callsignEditing: boolean;
  postRunKeylockSec: number;
  scoreSubmitted: boolean;
  submittingScore: boolean;
  submitResultBanner: string | null;
  submitResultTone: 'green' | 'amber' | 'red';
  lastSubmittedRun: PerimeterLastSubmittedRun | null;
  statusToast: string | null;
}

const PERIMETER_CONTROLS_STRIP: readonly ControlsStripItem[] = [
  { key: '1-8', label: 'Build', accent: 'green' },
  { key: 'DRAG', label: 'Aim', accent: 'amber' },
  { key: 'E', label: 'Rearm', accent: 'amber' },
  { key: 'R', label: 'Rotate', accent: 'green' },
  { key: 'SPACE/P', label: 'Pause', accent: 'amber' },
  { key: 'H', label: 'Controls', accent: 'cyan' },
  { key: 'ESC', label: 'Menu', accent: 'cyan' },
];

export class PerimeterHudRenderer {
  public buttons: ChromeButtonHitbox[] = [];
  private wikiRenderer = new PerimeterWikiRenderer();
  public wikiMaxScrollPx = 0;
  public wikiContentViewport: ViewportRect | null = null;
  public wikiScrollbarTrack: ViewportRect | null = null;

  public computeLayout(w: number, h: number): PerimeterLayout {
    const margin = Math.max(6, Math.round(w * 0.005));
    const topBarH = TOP_CHROME_BAR_HEIGHT;
    const controlsStripH = CONTROLS_STRIP_HEIGHT;

    const baseLeftW = 264;
    const baseRightW = 356;
    const basePanelH = 744;

    const availPanelH = Math.max(240, h - topBarH - controlsStripH - margin - 6);
    const scaleW = (w * 0.415) / (baseLeftW + baseRightW);
    const scaleH = availPanelH / basePanelH;
    // Lift hudScale floor to 0.80 on desktop widths (>=1080px); fonts also scale-compensate >=12px effective!
    const minScale = w >= 1080 ? 0.8 : 0.72;
    const hudScale = Math.max(minScale, Math.min(1.18, Math.min(scaleW, scaleH)));

    const leftW = Math.round(baseLeftW * hudScale);
    const rightW = Math.round(baseRightW * hudScale);
    const panelH = Math.max(240, h - topBarH - controlsStripH - 8);

    const leftPanel: ViewportRect = {
      x: margin,
      y: topBarH + 4,
      width: leftW,
      height: panelH,
    };

    const rightPanel: ViewportRect = {
      x: w - margin - rightW,
      y: topBarH + 4,
      width: rightW,
      height: panelH,
    };

    const centerX = leftPanel.x + leftPanel.width + 6;
    const centerW = Math.max(240, rightPanel.x - 6 - centerX);
    const logH = Math.max(46, Math.round(50 * hudScale));

    const bottomLog: ViewportRect = {
      x: centerX,
      y: h - controlsStripH - logH - 4,
      width: centerW,
      height: logH,
    };

    const blueprintViewport: ViewportRect = {
      x: centerX,
      y: topBarH + 4,
      width: centerW,
      height: Math.max(180, bottomLog.y - 5 - (topBarH + 4)),
    };

    return {
      hudScale,
      topBarH,
      controlsStripH,
      leftPanel,
      rightPanel,
      bottomLog,
      blueprintViewport,
    };
  }

  public render(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams,
    layout: PerimeterLayout
  ): void {
    this.buttons = [];

    // 1. Standardized 46px 4-Pill Top Chrome Bar
    this.drawTopBar(ctx, params);

    // 2. Left & Right CAD Instrument Consoles + Bottom Event Log
    this.drawLeftTelemetryPanel(ctx, params, layout);
    this.drawRightRequisitionPanel(ctx, params, layout);
    this.drawBottomEventLog(ctx, params, layout);

    // 3. Persistent 22px Bottom Controls Strip
    drawPersistentControlsStrip(ctx, params.width, params.height, PERIMETER_CONTROLS_STRIP);

    const blockingModalOpen =
      params.wikiOpen ||
      params.controlsCardOpen ||
      params.osdMenuOpen ||
      params.manifestOpen ||
      params.pauseBannerOpen;

    // Highlight targeted HUD buttons during Interactive Training Drill
    if (
      params.tutorialDirective.active &&
      !params.tutorialDirective.graduated &&
      !blockingModalOpen &&
      params.tutorialDirective.highlightButtonIds.length > 0
    ) {
      this.drawTutorialButtonHighlights(
        ctx,
        params.tutorialDirective.highlightButtonIds,
        params.timeSec
      );
    }

    // Active Training Drill Directive Banner (wrapped cleanly, no squashing!)
    if (
      params.tutorialDirective.active &&
      !params.tutorialDirective.graduated &&
      !blockingModalOpen
    ) {
      this.drawTutorialDirectiveBanner(ctx, params, layout.blueprintViewport);
    }

    // Transient Status Toast (positioned cleanly above bottom log / drill banner)
    if (params.statusToast && !params.wikiOpen && !params.controlsCardOpen && !params.osdMenuOpen) {
      const toastY =
        params.tutorialDirective.active && !params.tutorialDirective.graduated
          ? layout.blueprintViewport.y + 34
          : layout.blueprintViewport.y + layout.blueprintViewport.height - 46;
      drawStatusToast(ctx, params.width, toastY, params.statusToast, 'amber', 1);
    }

    // 4. Exclusive Modal Stack (EVERY modal clears `this.buttons` via ModalFrame for zero click-through!)
    if (params.wikiOpen) {
      const wr = this.wikiRenderer.render(ctx, {
        width: params.width,
        height: params.height,
        timeSec: params.timeSec,
        chapterIdx: params.wikiChapterIdx,
        scrollPx: params.wikiScrollPx,
        hoveredButtonId: params.hoveredButtonId,
        trainingActive: params.tutorialDirective.active,
      });
      this.wikiMaxScrollPx = wr.maxScrollPx;
      this.wikiContentViewport = wr.contentViewport;
      this.wikiScrollbarTrack = wr.scrollbarTrack;
      this.buttons = wr.buttons;
      return;
    }

    if (params.controlsCardOpen) {
      this.drawPerimeterControlsCard(ctx, params);
      return;
    }

    if (params.osdMenuOpen) {
      this.drawPerimeterSystemMenu(ctx, params);
      return;
    }

    if (params.manifestOpen) {
      this.drawPerimeterManifest(ctx, params);
      return;
    }

    if (params.pauseBannerOpen) {
      drawPauseBanner(
        ctx,
        params.width,
        params.height,
        'Simulation frozen. Press [P] to resume, [H] for Controls Quick-Card, or [ESC] for System Menu. (Tip: Use [SPACE] during waves for interactive Tactical Pause!)',
        this.buttons,
        params.hoveredButtonId,
        params.timeSec
      );
      return;
    }

    if (params.tutorialDirective.active && params.tutorialDirective.graduated) {
      this.drawTutorialGraduationModal(ctx, params);
      return;
    }

    if (params.sim.phase === 'BRIEFING') {
      this.drawBriefingOverlay(ctx, params);
      return;
    }

    if (params.sim.phase === 'PROTOCOL_DRAFT') {
      if (params.draftPeekMap) {
        this.drawProtocolPeekBar(ctx, params, layout.blueprintViewport);
      } else {
        this.drawProtocolDraftModal(ctx, params);
      }
      return;
    }

    if (params.sim.phase === 'CORE_BREACHED' || params.sim.phase === 'CALLSIGN_ENTRY') {
      this.drawUnifiedDebrief(ctx, params);
    }
  }

  // ===========================================================================
  // TOP CHROME BAR (SHARED 46PX, 4 PILLS)
  // ===========================================================================

  private drawTopBar(ctx: CanvasRenderingContext2D, params: PerimeterHudRenderParams): void {
    const { sim, width: w } = params;
    const parts: string[] = [];
    if (sim.trainingMode) {
      parts.push(params.tutorialDirective.code || 'SIM DRILL');
      parts.push(sim.blueprint.sectorId);
    } else {
      parts.push(`W-${String(sim.waveNumber).padStart(2, '0')}`);
      parts.push(sim.blueprint.sectorId);
      parts.push(`${sim.score.toLocaleString()} PTS`);
      if (sim.perfectWaveStreak >= 1) {
        parts.push(`${sim.getStreakMultiplier().toFixed(2)}X`);
      }
      if (sim.aegisBarrierReady) {
        parts.push(
          sim.aegisBarrierCharges > 1
            ? `${SEMIOTIC_ICONS.SHIELD} AEGIS×${sim.aegisBarrierCharges}`
            : `${SEMIOTIC_ICONS.SHIELD} AEGIS`
        );
      }
      if (sim.activeMutator !== 'NONE') {
        parts.push(WAVE_MUTATORS[sim.activeMutator].label);
      }
    }

    drawTopChromeBar(
      ctx,
      w,
      {
        title: "HADLEY'S PERIMETER",
        timeSec: params.timeSec,
        isRanked: !sim.trainingMode,
        telemetryText: parts.join(' · '),
        crt1979Enabled: params.crtPreset === 'CLASSIC_1979',
        controlsLabel: '[H] MANUAL',
        audioMuted: params.audioMuted,
        hoveredButtonId: params.hoveredButtonId,
        confirmExitPending: params.confirmExitPending,
      },
      this.buttons
    );
  }

  // ===========================================================================
  // LEFT PANEL: REACTOR DIAL, 3-CELL CORE SEAL BREAKER BANK & WEAPONS RACK
  // ===========================================================================

  private drawLeftTelemetryPanel(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams,
    layout: PerimeterLayout
  ): void {
    const { leftPanel: rect, hudScale: s } = layout;
    const { sim } = params;
    const baseW = 264;
    const baseH = Math.round(rect.height / s);

    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.scale(s, s);

    ctx.fillStyle = THEME.BG_PANEL;
    ctx.fillRect(0, 0, baseW, baseH);
    drawCornerBrackets(ctx, 0, 0, baseW, baseH, 14, THEME.BORDER_SUBTLE, 2.2);

    // Header + Score Readout
    ctx.textAlign = 'left';
    ctx.font = font('head', 15, s);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.fillText('REACTOR & WEAPONS', 10, 22);

    ctx.textAlign = 'right';
    ctx.font = font('data', 14, s);
    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.fillText(`${String(sim.score).padStart(6, '0')}`, baseW - 10, 22);

    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(10, 30);
    ctx.lineTo(baseW - 10, 30);
    ctx.stroke();

    // 1. Top Row: Single REACTOR kW Analog Dial (Left) + 3-Cell USCM Core Seal Breaker Bank (Right)
    const usedKw = sim.getTotalLoadKw();
    const maxKw = sim.maxReactorKw;
    const kwRatio = Math.min(1.15, usedKw / Math.max(1, maxKw));
    const kwOver = usedKw > maxKw || sim.blackoutTimer > 0;
    const kwSub =
      sim.blackoutTimer > 0
        ? `TRIP ${sim.blackoutTimer.toFixed(1)}S`
        : sim.overloadTimer > 0.1
          ? `OVR ${usedKw}kW`
          : `${usedKw}/${maxKw} kW`;

    this.drawAnalogWedgeNeedleDial(
      ctx,
      62,
      74,
      33,
      sim.blackoutTimer > 0 ? 0 : Math.min(1, kwRatio),
      sim.blackoutTimer > 0 ? 'BLACKOUT!' : 'REACTOR kW',
      kwSub,
      kwOver ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER,
      s
    );

    // 3-Cell USCM Core Seal Breaker Bank (replaces redundant 2nd dial + S01..S03 strip!)
    const bankX = 118;
    const bankY = 38;
    const bankW = baseW - bankX - 10;
    const bankH = 104;
    this.drawCoreSealBreakerBank(ctx, bankX, bankY, bankW, bankH, sim, s);

    // 1B. Reactor Reserve Battery Gauge
    const batY = 148;
    const batH = 22;
    const batRatio = Math.max(0, Math.min(1, sim.reserveBattery / 100));
    const batReady = sim.reserveBattery >= PERIMETER_CONSTANTS.FLOODLIGHT_BATTERY_COST;
    ctx.fillStyle = 'rgba(5, 16, 12, 0.94)';
    ctx.fillRect(10, batY, baseW - 20, batH);
    ctx.strokeStyle = batReady ? THEME.ACCENT_CYAN : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(10, batY, baseW - 20, batH);

    const batBarX = 76;
    const batBarW = baseW - 132;
    ctx.fillStyle = 'rgba(10, 30, 26, 0.9)';
    ctx.fillRect(batBarX, batY + 4, batBarW, batH - 8);
    ctx.fillStyle = batReady ? THEME.ACCENT_CYAN : THEME.TEXT_PRIMARY;
    ctx.fillRect(batBarX + 1, batY + 5, (batBarW - 2) * batRatio, batH - 10);

    const threshX =
      batBarX + Math.round(batBarW * (PERIMETER_CONSTANTS.FLOODLIGHT_BATTERY_COST / 100));
    ctx.strokeStyle = THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(threshX, batY + 2);
    ctx.lineTo(threshX, batY + batH - 2);
    ctx.stroke();

    ctx.font = font('micro', 12, s);
    ctx.textAlign = 'left';
    ctx.fillStyle = batReady ? THEME.ACCENT_CYAN : THEME.TEXT_BRIGHT;
    ctx.fillText(batReady ? `${SEMIOTIC_ICONS.DIAMOND} BAT` : 'RES BAT', 14, batY + 15);
    ctx.textAlign = 'right';
    ctx.fillStyle = batReady ? THEME.ACCENT_CYAN : THEME.ACCENT_AMBER_HI;
    ctx.fillText(`${Math.round(sim.reserveBattery)}%`, baseW - 14, batY + 15);

    // 1C. Engineering Row: +15kW Expand (and contextual +1 SEAL in Prep if damaged — NO duplicate [X] SHED AUX!)
    const engY = 175;
    const engH = 26;
    const canFabSeal = sim.phase === 'TACTICAL_PREP' && sim.bulkheadSeals < 3;
    const engGap = 6;
    const fullEngW = baseW - 20;
    const expandW = canFabSeal ? (fullEngW - engGap) * 0.5 : fullEngW;

    const expandCost = sim.getReactorExpandCost();
    const effectiveCap = sim.getEffectiveMaxReactorCap();
    const expandCapped = sim.maxReactorKw >= effectiveCap;
    const atHardCap = effectiveCap >= PERIMETER_CONSTANTS.MAX_REACTOR_KW_HARD_CAP;
    const canExpand = !expandCapped && sim.scrap >= expandCost;
    const expandHov = params.hoveredButtonId === 'reactor-expand';

    this.buttons.push({
      id: 'reactor-expand',
      rect: {
        x: rect.x + 10 * s,
        y: rect.y + engY * s,
        width: expandW * s,
        height: engH * s,
      },
      label: 'EXPAND REACTOR BUS',
    });
    ctx.fillStyle = expandHov
      ? 'rgba(76, 238, 255, 0.24)'
      : canExpand
        ? THEME.ACCENT_CYAN_BG
        : 'rgba(6, 14, 10, 0.92)';
    ctx.fillRect(10, engY, expandW, engH);
    ctx.strokeStyle = expandHov
      ? '#FFFFFF'
      : canExpand
        ? THEME.ACCENT_CYAN
        : expandCapped && !atHardCap
          ? THEME.ACCENT_AMBER
          : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(10, engY, expandW, engH);
    ctx.textAlign = 'center';
    ctx.font = font('micro', 12, s);
    ctx.fillStyle = canExpand
      ? THEME.ACCENT_CYAN
      : expandCapped && !atHardCap
        ? THEME.ACCENT_AMBER_HI
        : THEME.TEXT_MUTED;
    const expLabel = expandCapped
      ? atHardCap
        ? `MAX ${PERIMETER_CONSTANTS.MAX_REACTOR_KW_HARD_CAP}kW`
        : `${effectiveCap}kW (AUX+)`
      : `${SEMIOTIC_ICONS.CROSS} +15kW BUS (${expandCost}S)`;
    drawEllipsizedText(ctx, expLabel, 10 + expandW * 0.5, engY + 17, expandW - 8);

    if (canFabSeal) {
      const sealBtnX = 10 + expandW + engGap;
      const sealHov = params.hoveredButtonId === 'seal-fabricate';
      const sealReady = sim.scrap >= PERIMETER_CONSTANTS.SEAL_REBUILD_COST_SCRAP;
      this.buttons.push({
        id: 'seal-fabricate',
        rect: {
          x: rect.x + sealBtnX * s,
          y: rect.y + engY * s,
          width: expandW * s,
          height: engH * s,
        },
        label: 'FABRICATE CORE SEAL',
      });
      ctx.fillStyle = sealHov
        ? 'rgba(255, 176, 0, 0.28)'
        : sealReady
          ? 'rgba(16, 44, 24, 0.94)'
          : 'rgba(6, 16, 10, 0.92)';
      ctx.fillRect(sealBtnX, engY, expandW, engH);
      ctx.strokeStyle = sealHov ? '#FFFFFF' : sealReady ? THEME.TEXT_PRIMARY : THEME.BORDER_SUBTLE;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(sealBtnX, engY, expandW, engH);
      ctx.fillStyle = sealReady ? THEME.TEXT_BRIGHT : THEME.TEXT_MUTED;
      drawEllipsizedText(
        ctx,
        `+1 SEAL (${PERIMETER_CONSTANTS.SEAL_REBUILD_COST_SCRAP}S)`,
        sealBtnX + expandW * 0.5,
        engY + 17,
        expandW - 8
      );
    }

    // 2. Compact Bio-Threat & Sector Telemetry Strip (reinvests ~60px height into >=56px Weapon Cards!)
    const statY = 207;
    const statH = 52;
    ctx.fillStyle = 'rgba(4, 12, 8, 0.94)';
    ctx.fillRect(10, statY, baseW - 20, statH);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(10, statY, baseW - 20, statH);

    const verifiedCount = sim.hostiles.filter((h) => h.verified).length;
    const sealedDoors = sim.getActiveSealedDoorCount();
    const maxDoorSeals = sim.getMaxDoorSeals();
    const onlineUnits = sim.turrets.filter((t) => t.powered).length;
    const halfStatW = (baseW - 28) * 0.5;

    ctx.font = font('micro', 12, s);
    // Row A: HOSTILES | KILLS
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.fillText('FOES:', 16, statY + 18);
    ctx.fillStyle = sim.hostiles.length > 16 ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER_HI;
    ctx.fillText(`${sim.hostiles.length} (${verifiedCount})`, 58, statY + 18);

    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.fillText('KILLS:', 16 + halfStatW + 4, statY + 18);
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.TEXT_PRIMARY;
    ctx.fillText(`${sim.totalKills}`, baseW - 16, statY + 18);

    // Row B: DOORS | ONLINE
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.fillText('DOORS:', 16, statY + 40);
    ctx.fillStyle = sealedDoors >= maxDoorSeals ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER_HI;
    ctx.fillText(`${sealedDoors}/${maxDoorSeals}`, 68, statY + 40);

    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.fillText('UNITS:', 16 + halfStatW + 4, statY + 40);
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.fillText(`${onlineUnits}/${sim.turrets.length}`, baseW - 16, statY + 40);

    // 3. Tall >=56px Deployed Weapons Telemetry Matrix
    const scopeTop = 266;
    const scopeH = Math.max(220, baseH - scopeTop - 8);
    this.drawDeployedWeaponsMatrix(ctx, rect, s, 10, scopeTop, baseW - 20, scopeH, params);

    ctx.restore();
  }

  /**
   * 3-Cell USCM Core Seal Breaker Bank — tactile illuminated bulkhead lock switches
   * replacing the old duplicated BULKHEADS dial + S01..S03 strip.
   */
  private drawCoreSealBreakerBank(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    sim: PerimeterSimulation,
    hudScale: number
  ): void {
    ctx.save();
    ctx.fillStyle = 'rgba(4, 12, 8, 0.94)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = sim.aegisBarrierReady
      ? THEME.ACCENT_CYAN
      : sim.bulkheadSeals <= 1
        ? THEME.ALERT_RED_STROKE
        : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);

    ctx.font = font('micro', 12, hudScale);
    ctx.textAlign = 'left';
    ctx.fillStyle = sim.aegisBarrierReady ? THEME.ACCENT_CYAN : THEME.TEXT_BRIGHT;
    drawEllipsizedText(
      ctx,
      sim.aegisBarrierReady
        ? `${SEMIOTIC_ICONS.SHIELD} CORE + AEGIS`
        : 'CORE SEAL BANK',
      x + 7,
      y + 15,
      w - 14
    );

    const cellGap = 4;
    const topY = y + 23;
    const cellH = Math.floor((h - 28 - cellGap * 2) / 3);
    const cellW = w - 12;

    for (let i = 0; i < 3; i++) {
      const cy = topY + i * (cellH + cellGap);
      const intact = i < sim.bulkheadSeals;
      const criticalLast = intact && sim.bulkheadSeals === 1;
      const borderCol = !intact
        ? THEME.ALERT_RED_STROKE
        : criticalLast
          ? THEME.ACCENT_AMBER
          : THEME.TEXT_PRIMARY;

      ctx.fillStyle = !intact
        ? 'rgba(56, 12, 8, 0.72)'
        : criticalLast
          ? 'rgba(58, 32, 4, 0.72)'
          : 'rgba(12, 42, 22, 0.76)';
      ctx.fillRect(x + 6, cy, cellW, cellH);
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x + 6, cy, cellW, cellH);

      // Left mechanical breaker latch indicator pip
      ctx.fillStyle = borderCol;
      ctx.fillRect(x + 9, cy + 4, 5, cellH - 8);

      ctx.textAlign = 'left';
      ctx.font = font('micro', 12, hudScale);
      ctx.fillStyle = !intact
        ? THEME.ALERT_RED_TEXT
        : criticalLast
          ? THEME.ACCENT_AMBER_HI
          : THEME.TEXT_BRIGHT;
      drawEllipsizedText(
        ctx,
        intact ? `S0${i + 1} LOCK` : `S0${i + 1} BLOWN`,
        x + 19,
        cy + cellH * 0.68,
        cellW - 22
      );
    }

    ctx.restore();
  }

  private drawAnalogWedgeNeedleDial(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    normValue: number,
    label: string,
    subText: string,
    accent: string,
    hudScale: number
  ): void {
    ctx.save();
    const startAng = (145 * Math.PI) / 180;
    const sweep = (250 * Math.PI) / 180;
    const endAng = startAng + sweep;
    const clamped = Math.max(0, Math.min(1, normValue));
    const valAng = startAng + clamped * sweep;

    if (clamped > 0.01) {
      ctx.fillStyle =
        accent === THEME.ALERT_RED_STROKE
          ? 'rgba(255, 51, 24, 0.24)'
          : accent === THEME.TEXT_PRIMARY
            ? 'rgba(68, 255, 119, 0.20)'
            : 'rgba(255, 176, 0, 0.24)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r - 4, startAng, valAng);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(120, 74, 14, 0.65)';
    ctx.lineWidth = 4.0;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAng, endAng);
    ctx.stroke();

    if (clamped > 0.01) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4.8;
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAng, valAng);
      ctx.stroke();
    }

    const ticks = 8;
    for (let i = 0; i <= ticks; i++) {
      const f = i / ticks;
      const a = startAng + f * sweep;
      const len = i % 2 === 0 ? 7 : 4.5;
      ctx.strokeStyle = f <= clamped + 0.02 ? THEME.ACCENT_AMBER_HI : THEME.BORDER_SUBTLE;
      ctx.lineWidth = i % 2 === 0 ? 1.8 : 1.3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2));
      ctx.lineTo(cx + Math.cos(a) * (r - 2 - len), cy + Math.sin(a) * (r - 2 - len));
      ctx.stroke();
    }

    ctx.strokeStyle = '#FFF2CC';
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(valAng) * 5, cy - Math.sin(valAng) * 5);
    ctx.lineTo(cx + Math.cos(valAng) * (r - 5), cy + Math.sin(valAng) * (r - 5));
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(cx, cy, 4.0, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.font = font('micro', 12, hudScale);
    ctx.fillStyle = THEME.TEXT_PRIMARY;
    ctx.fillText(label, cx, cy + r + 15);

    ctx.font = font('micro', 12, hudScale);
    ctx.fillStyle = accent === THEME.ALERT_RED_STROKE ? THEME.ALERT_RED_TEXT : accent;
    ctx.fillText(subText, cx, cy + r + 31);
    ctx.restore();
  }

  private drawDeployedWeaponsMatrix(
    ctx: CanvasRenderingContext2D,
    panelScreenRect: ViewportRect,
    hudScale: number,
    x: number,
    y: number,
    w: number,
    h: number,
    params: PerimeterHudRenderParams
  ): void {
    const { sim, selectedTurretId, hoveredButtonId, timeSec } = params;
    const blinkFast = Math.sin(timeSec * 14) > -0.1;

    let anyDry = false;
    let anyLowAmmo = false;
    let anyOverheat = false;
    let anyNeedRearm = false;
    let totalAmmo = 0;
    let totalMaxAmmo = 0;
    let liveRpm = 0;
    let maxHeat = 0;

    for (const t of sim.turrets) {
      if (t.heat > maxHeat) maxHeat = t.heat;
      if (t.kind === 'SENTRY_PULSE' && t.rearmTimer <= 0 && t.ammo < t.maxAmmo) {
        anyNeedRearm = true;
      }
      if (!t.powered) continue;
      if (t.thermalLocked) anyOverheat = true;
      if (t.kind === 'SENTRY_PULSE') {
        totalAmmo += t.ammo;
        totalMaxAmmo += t.maxAmmo;
        if (t.ammo <= 0) anyDry = true;
        else if (t.ammo <= Math.ceil(t.maxAmmo * 0.25)) anyLowAmmo = true;
        if (t.firingFlashTimer > 0 && t.ammo > 0 && !t.thermalLocked) {
          liveRpm += t.overclockTimer > 0 || sim.activeOverclockSurgeTimer > 0 ? 2600 : 1350;
        }
      }
    }

    // Only critical DRY / OVERHEAT strobes red; LOW AMMO is steady calm amber!
    const frameCol =
      anyDry || anyOverheat
        ? blinkFast
          ? THEME.ALERT_RED_STROKE
          : '#7A1C12'
        : anyLowAmmo
          ? THEME.ACCENT_AMBER
          : THEME.TEXT_PRIMARY;

    ctx.save();
    ctx.fillStyle = 'rgba(2, 7, 4, 0.96)';
    ctx.fillRect(x, y, w, h);
    drawCornerBrackets(ctx, x, y, w, h, 12, frameCol, 1.8);

    // 1. Header + 1-Click [E] REARM ALL Button
    ctx.font = font('micro', 12, hudScale);
    ctx.fillStyle = THEME.TEXT_PRIMARY;
    ctx.textAlign = 'left';
    ctx.fillText('WEAPONS RACK', x + 8, y + 18);

    if (anyNeedRearm) {
      const badgeW = 104;
      const badgeX = x + w - badgeW - 6;
      const rearmAllHov = hoveredButtonId === 'rearm-all';
      this.buttons.push({
        id: 'rearm-all',
        rect: {
          x: panelScreenRect.x + badgeX * hudScale,
          y: panelScreenRect.y + (y + 3) * hudScale,
          width: badgeW * hudScale,
          height: 20 * hudScale,
        },
        label: 'REARM ALL SENTRIES',
      });
      const criticalUrgent = anyDry && blinkFast;
      ctx.fillStyle = rearmAllHov
        ? THEME.ACCENT_AMBER_HI
        : criticalUrgent
          ? THEME.ALERT_RED_STROKE
          : anyLowAmmo
            ? THEME.ACCENT_AMBER_BG
            : 'rgba(20, 44, 24, 0.94)';
      ctx.fillRect(badgeX, y + 3, badgeW, 20);
      ctx.strokeStyle = anyDry ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(badgeX, y + 3, badgeW, 20);
      ctx.font = font('micro', 12, hudScale);
      ctx.fillStyle = rearmAllHov || criticalUrgent ? THEME.INK_INVERSE : THEME.ACCENT_AMBER_HI;
      ctx.textAlign = 'center';
      drawEllipsizedText(ctx, '[E] REARM ALL', badgeX + badgeW * 0.5, y + 17, badgeW - 6);
    } else if (anyOverheat) {
      const badgeW = 94;
      const badgeX = x + w - badgeW - 6;
      ctx.fillStyle = blinkFast ? THEME.ALERT_RED_STROKE : 'rgba(36, 12, 6, 0.9)';
      ctx.fillRect(badgeX, y + 4, badgeW, 19);
      ctx.strokeStyle = THEME.ALERT_RED_STROKE;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(badgeX, y + 4, badgeW, 19);
      ctx.font = font('micro', 12, hudScale);
      ctx.fillStyle = blinkFast ? THEME.INK_INVERSE : THEME.ALERT_RED_TEXT;
      ctx.textAlign = 'center';
      ctx.fillText('⚠ OVERHEAT', badgeX + badgeW * 0.5, y + 17);
    } else {
      ctx.font = font('micro', 12, hudScale);
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      ctx.textAlign = 'right';
      ctx.fillText(`[${sim.turrets.length} ACTIVE]`, x + w - 8, y + 18);
    }

    // 2. Aggregate Firepower Strip (Reserve Rounds | RPM | Peak Heat)
    const stripY = y + 27;
    ctx.fillStyle = 'rgba(10, 24, 15, 0.86)';
    ctx.fillRect(x + 6, stripY, w - 12, 22);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x + 6, stripY, w - 12, 22);

    ctx.font = font('micro', 12, hudScale);
    ctx.textAlign = 'left';
    ctx.fillStyle = anyDry
      ? THEME.ALERT_RED_TEXT
      : anyLowAmmo
        ? THEME.ACCENT_AMBER_HI
        : THEME.TEXT_BRIGHT;
    const rdsSummary =
      totalMaxAmmo > 0 ? `RDS:${String(totalAmmo).padStart(4, '0')}` : 'RDS:----';
    ctx.fillText(rdsSummary, x + 10, stripY + 15);

    ctx.textAlign = 'center';
    ctx.fillStyle = liveRpm > 0 ? THEME.ACCENT_AMBER_HI : THEME.TEXT_SECONDARY;
    ctx.fillText(`RPM:${String(liveRpm).padStart(4, '0')}`, x + w * 0.5 + 4, stripY + 15);

    ctx.textAlign = 'right';
    ctx.fillStyle =
      maxHeat > 80 ? THEME.ALERT_RED_TEXT : maxHeat > 50 ? THEME.ACCENT_AMBER_HI : THEME.TEXT_PRIMARY;
    ctx.fillText(`PK:${String(Math.round(maxHeat)).padStart(3, '0')}°`, x + w - 10, stripY + 15);

    // 3. Tall >=56px Deployed Weapon Telemetry Cards
    const listTop = stripY + 28;
    const availH = Math.max(64, y + h - listTop - 6);

    if (sim.turrets.length === 0) {
      const slotH = 56;
      const maxSlots = Math.min(4, Math.max(1, Math.floor(availH / (slotH + 6))));
      for (let i = 0; i < maxSlots; i++) {
        const sy = listTop + i * (slotH + 6);
        ctx.strokeStyle = 'rgba(82, 184, 114, 0.48)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x + 6, sy, w - 12, slotH);
        ctx.setLineDash([]);

        ctx.textAlign = 'left';
        ctx.font = font('micro', 12, hudScale);
        ctx.fillStyle = THEME.TEXT_BRIGHT;
        ctx.fillText(`HARDPOINT 0${i + 1} // OPEN`, x + 14, sy + 22);
        ctx.fillStyle = THEME.TEXT_SECONDARY;
        ctx.fillText('PRESS [1-8] TO DEPLOY', x + 14, sy + 42);
      }
      ctx.restore();
      return;
    }

    const ordered =
      sim.turrets.length <= 7
        ? sim.turrets
        : [...sim.turrets].sort((a, b) => {
            const prio = (u: typeof a) =>
              u.kind === 'SENTRY_PULSE'
                ? 0
                : u.kind === 'RAIL_LANCE'
                  ? 1
                  : u.kind === 'INCINERATOR'
                    ? 2
                    : 3;
            return prio(a) - prio(b);
          });

    const gap = 6;
    const minCardH = 56; // Guaranteed >=56px weapon telemetry cards!
    const maxVisible = Math.max(
      1,
      Math.min(ordered.length, Math.floor((availH + gap) / (minCardH + gap)))
    );
    const shown = ordered.slice(0, maxVisible);
    const reserveFooter = ordered.length > maxVisible ? 18 : 0;
    const cardH = Math.min(
      72,
      Math.max(
        minCardH,
        Math.floor((availH - reserveFooter - gap * Math.max(0, shown.length - 1)) / shown.length)
      )
    );

    shown.forEach((t, idx) => {
      const cy = listTop + idx * (cardH + gap);
      const cx = x + 6;
      const cw = w - 12;
      const isSelected = t.id === selectedTurretId;

      const isSentry = t.kind === 'SENTRY_PULSE';
      const isIncinerator = t.kind === 'INCINERATOR';
      const isRail = t.kind === 'RAIL_LANCE';
      const isCryo = t.kind === 'CRYO_VALVE';
      const isShock = t.kind === 'SHOCK_COIL';
      const isReloading = isSentry && t.rearmTimer > 0;
      const lowThresh = Math.ceil(t.maxAmmo * 0.25);
      const isDry = t.powered && isSentry && !isReloading && t.ammo <= 0;
      const isLow = t.powered && isSentry && !isReloading && t.ammo > 0 && t.ammo <= lowThresh;
      const isTherm = t.powered && t.thermalLocked;
      const isHot = t.powered && t.heat >= 80;
      const isFiring =
        t.powered && !isReloading && sim.blackoutTimer <= 0 && t.firingFlashTimer > 0 && !isDry && !isTherm;

      const selectId = `rack-select-${t.id}`;
      const selectHov = hoveredButtonId === selectId;
      this.buttons.push({
        id: selectId,
        rect: {
          x: panelScreenRect.x + cx * hudScale,
          y: panelScreenRect.y + cy * hudScale,
          width: cw * hudScale,
          height: cardH * hudScale,
        },
        label: `SELECT ${t.callsign}`,
      });

      // Only DRY / THERMAL LOCK strobe red; LOW AMMO uses calm steady amber!
      if (isDry || isTherm) {
        ctx.fillStyle = blinkFast ? 'rgba(120, 18, 12, 0.52)' : 'rgba(24, 6, 5, 0.92)';
        ctx.strokeStyle = blinkFast ? THEME.ALERT_RED_STROKE : '#8A2418';
      } else if (isLow) {
        ctx.fillStyle = 'rgba(54, 32, 4, 0.56)';
        ctx.strokeStyle = THEME.ACCENT_AMBER;
      } else if (isSelected) {
        ctx.fillStyle = 'rgba(48, 36, 8, 0.42)';
        ctx.strokeStyle = THEME.ACCENT_AMBER_HI;
      } else if (selectHov) {
        ctx.fillStyle = 'rgba(20, 52, 30, 0.48)';
        ctx.strokeStyle = THEME.TEXT_BRIGHT;
      } else {
        ctx.fillStyle = 'rgba(5, 15, 9, 0.90)';
        ctx.strokeStyle = t.powered ? 'rgba(68, 255, 119, 0.45)' : THEME.BORDER_SUBTLE;
      }
      ctx.lineWidth = isSelected || isDry || isLow || isTherm ? 1.8 : 1.3;
      ctx.fillRect(cx, cy, cw, cardH);
      ctx.strokeRect(cx, cy, cw, cardH);

      // Row 1: Callsign + Class + Upgrades | Right Status / Quick REARM
      const kindTag = isSentry
        ? 'PULSE'
        : isIncinerator
          ? 'NAPALM'
          : isRail
            ? `${SEMIOTIC_ICONS.DIAMOND}RAIL`
            : isCryo
              ? 'CRYO'
              : isShock
                ? `${SEMIOTIC_ICONS.HEX}COIL`
                : 'M314';
      const mkTag =
        t.level === 3
          ? (t.mk4Level ?? 0) > 0
            ? ` IV+${t.mk4Level}`
            : ` III${t.mk3Branch ?? ''}`
          : t.level === 2
            ? ' MK2'
            : '';

      ctx.textAlign = 'left';
      ctx.font = font('micro', 12, hudScale);
      ctx.fillStyle = !t.powered
        ? THEME.TEXT_MUTED
        : t.powerUpTimer > 0
          ? THEME.ACCENT_CYAN
          : isDry || isTherm
            ? THEME.ALERT_RED_TEXT
            : isLow || isFiring
              ? THEME.ACCENT_AMBER_HI
              : (t.mk4Level ?? 0) > 0
                ? THEME.ACCENT_AMBER_HI
                : isRail || isShock
                  ? THEME.ACCENT_CYAN
                  : THEME.TEXT_PRIMARY;
      drawEllipsizedText(ctx, `${t.callsign} ${kindTag}${mkTag}`, cx + 6, cy + 16, cw - 82);

      const rightEdgeX = cx + cw - 6;
      if (t.powered && t.powerUpTimer > 0) {
        ctx.textAlign = 'right';
        ctx.fillStyle = THEME.ACCENT_CYAN;
        ctx.fillText(`SPIN ${t.powerUpTimer.toFixed(1)}S`, rightEdgeX, cy + 16);
      } else if (isReloading) {
        ctx.textAlign = 'right';
        ctx.fillStyle = THEME.ACCENT_AMBER_HI;
        ctx.fillText(`LOAD ${t.rearmTimer.toFixed(1)}S`, rightEdgeX, cy + 16);
      } else if (isSentry && t.ammo < t.maxAmmo) {
        const rearmCost = sim.getRearmCostFor(t);
        const canRearm = sim.scrap >= rearmCost;
        const rearmId = `rack-rearm-${t.id}`;
        const rearmHov = hoveredButtonId === rearmId;
        const rw = 74;
        const rh = 18;
        const rx = cx + cw - rw - 4;
        const ry = cy + 3;

        this.buttons.push({
          id: rearmId,
          rect: {
            x: panelScreenRect.x + rx * hudScale,
            y: panelScreenRect.y + ry * hudScale,
            width: rw * hudScale,
            height: rh * hudScale,
          },
          label: `REARM ${t.callsign}`,
        });

        const criticalFlash = isDry && blinkFast && canRearm;
        ctx.fillStyle = rearmHov
          ? THEME.ACCENT_AMBER_HI
          : criticalFlash
            ? THEME.ALERT_RED_STROKE
            : isLow && canRearm
              ? THEME.ACCENT_AMBER_BG
              : 'rgba(16, 34, 20, 0.95)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = !canRearm
          ? THEME.BORDER_SUBTLE
          : isDry
            ? THEME.ALERT_RED_STROKE
            : THEME.ACCENT_AMBER;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(rx, ry, rw, rh);

        ctx.font = font('micro', 12, hudScale);
        ctx.fillStyle =
          rearmHov || criticalFlash
            ? THEME.INK_INVERSE
            : canRearm
              ? THEME.ACCENT_AMBER_HI
              : THEME.TEXT_MUTED;
        ctx.textAlign = 'center';
        drawEllipsizedText(ctx, `-${rearmCost}S`, rx + rw * 0.5, ry + 13, rw - 6);
      } else {
        ctx.textAlign = 'right';
        let stTxt = 'ARMED';
        let stCol: string = THEME.TEXT_PRIMARY;
        if (sim.blackoutTimer > 0 && t.powered) {
          stTxt = 'BLCKOUT';
          stCol = THEME.ALERT_RED_TEXT;
        } else if (!t.powered) {
          stTxt = 'OFFLINE';
          stCol = THEME.TEXT_MUTED;
        } else if (isTherm) {
          stTxt = '⚠ LOCK';
          stCol = THEME.ALERT_RED_TEXT;
        } else if (isFiring) {
          stTxt = isIncinerator ? '● FLAME' : isRail ? '● LANCE' : '● FIRE';
          stCol = isRail ? THEME.ACCENT_CYAN : THEME.ACCENT_AMBER_HI;
        } else if (isSentry || isIncinerator || isRail) {
          stTxt = `K:${String(t.kills).padStart(2, '0')}`;
          stCol = isRail ? THEME.ACCENT_CYAN : THEME.TEXT_BRIGHT;
        } else if (isCryo) {
          stTxt = t.pulseTimer < 0.45 ? '● VENT' : 'CHILL';
          stCol = THEME.TEXT_BRIGHT;
        } else if (isShock) {
          stTxt = t.pulseTimer < 0.4 ? '⚡ ARC' : `K:${String(t.kills).padStart(2, '0')}`;
          stCol = THEME.ACCENT_CYAN;
        } else {
          stTxt = t.jammedTimer > 0 ? '⚠ JAM' : t.tripwireIntegrity < 60 ? '⚠ WIRE' : 'SWEEP';
          stCol =
            t.jammedTimer > 0
              ? '#E066FF'
              : t.tripwireIntegrity < 60
                ? THEME.ACCENT_AMBER_HI
                : THEME.TEXT_PRIMARY;
        }
        ctx.fillStyle = stCol;
        ctx.fillText(stTxt, rightEdgeX, cy + 16);
      }

      // Row 2: Segmented Primary Bar
      const row2Y = cy + 23;
      let row2Label = 'AMMO';
      let row2Ratio = 1;
      let row2ValTxt = '';
      let row2Col: string = THEME.TEXT_PRIMARY;

      if (isSentry) {
        if (isReloading) {
          row2Label = 'LOAD';
          row2Ratio = Math.max(0, Math.min(1, 1 - t.rearmTimer / Math.max(0.1, t.rearmDuration)));
          row2ValTxt = `${t.rearmTimer.toFixed(1)}S`;
          row2Col = THEME.ACCENT_AMBER_HI;
        } else {
          row2Label = isDry ? '⚠DRY' : isLow ? '▲LOW' : 'AMMO';
          row2Ratio = Math.max(0, Math.min(1, t.ammo / Math.max(1, t.maxAmmo)));
          row2ValTxt = `${String(t.ammo).padStart(3, '0')}/${t.maxAmmo}`;
          row2Col = isDry
            ? THEME.ALERT_RED_TEXT
            : isLow || row2Ratio < 0.5
              ? THEME.ACCENT_AMBER_HI
              : THEME.TEXT_PRIMARY;
        }
      } else if (isIncinerator) {
        row2Label = 'NOZL';
        const cdMax = sim.activeOverclockSurgeTimer > 0 || t.overclockTimer > 0 ? 0.34 : 0.62;
        row2Ratio = t.powered ? Math.max(0, Math.min(1, 1 - t.fireCooldown / cdMax)) : 0;
        row2ValTxt = t.powered ? (t.firingFlashTimer > 0 ? 'BURN' : 'PRESS') : 'OFF';
        row2Col = THEME.ACCENT_AMBER;
      } else if (isRail) {
        row2Label = 'CAP';
        const cdMax = t.level === 3 && t.mk3Branch === 'B' ? 0.86 : t.level >= 2 ? 1.32 : 1.72;
        row2Ratio = t.powered ? Math.max(0, Math.min(1, 1 - t.fireCooldown / cdMax)) : 0;
        row2ValTxt = t.powered ? (row2Ratio >= 0.98 ? 'READY' : `${Math.round(row2Ratio * 100)}%`) : 'OFF';
        row2Col = THEME.ACCENT_CYAN;
      } else if (isCryo) {
        row2Label = 'LN2';
        row2Ratio = t.powered ? Math.max(0, Math.min(1, 1 - t.pulseTimer / 2.75)) : 0;
        row2ValTxt = t.powered ? `${Math.round(row2Ratio * 100)}%` : 'OFF';
        row2Col = THEME.TEXT_BRIGHT;
      } else if (isShock) {
        row2Label = 'ARC';
        row2Ratio = t.powered ? Math.max(0, Math.min(1, 1 - t.pulseTimer / 2.2)) : 0;
        row2ValTxt = t.powered ? `${Math.round(row2Ratio * 100)}%` : 'OFF';
        row2Col = THEME.ACCENT_CYAN;
      } else {
        row2Label = 'WIRE';
        row2Ratio = Math.max(0, Math.min(1, t.tripwireIntegrity / 100));
        row2ValTxt = `${Math.round(t.tripwireIntegrity)}%`;
        row2Col = t.tripwireIntegrity < 50 ? THEME.ACCENT_AMBER_HI : THEME.TEXT_PRIMARY;
      }

      this.drawWeaponSegmentedBar(
        ctx,
        cx + 6,
        row2Y,
        cw - 12,
        11,
        row2Label,
        row2Ratio,
        row2ValTxt,
        row2Col,
        hudScale,
        isDry && blinkFast
      );

      // Row 3: Barrel HEAT Bar or Support Telemetry (always visible since cardH >= 56!)
      const row3Y = cy + 40;
      if (isSentry || isIncinerator || isRail) {
        const heatRatio = Math.max(0, Math.min(1, t.heat / 100));
        const heatCol =
          isTherm || isHot
            ? THEME.ALERT_RED_TEXT
            : t.heat >= 52
              ? THEME.ACCENT_AMBER_HI
              : THEME.TEXT_PRIMARY;
        const heatVal = isTherm
          ? 'LOCK!'
          : `${String(Math.round(t.heat)).padStart(3, '0')}% K:${t.kills}`;
        this.drawWeaponSegmentedBar(
          ctx,
          cx + 6,
          row3Y,
          cw - 12,
          10,
          'HEAT',
          heatRatio,
          heatVal,
          heatCol,
          hudScale,
          isTherm && blinkFast
        );
      } else {
        ctx.textAlign = 'left';
        ctx.font = font('micro', 12, hudScale);
        ctx.fillStyle = THEME.TEXT_SECONDARY;
        const suppTxt = isCryo
          ? 'CRYO PLUME · COOLS GUNS'
          : isShock
            ? 'TESLA ARC · STUN/DECLOAK'
            : `M314 RADAR · ${sim.getTurretPowerKw(t)}kW`;
        drawEllipsizedText(ctx, suppTxt, cx + 6, row3Y + 9, cw - 12);
      }
    });

    if (ordered.length > maxVisible) {
      ctx.font = font('micro', 12, hudScale);
      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      ctx.textAlign = 'center';
      ctx.fillText(
        `+${ordered.length - maxVisible} MORE UNITS ACTIVE`,
        x + w * 0.5,
        y + h - 5
      );
    }

    ctx.restore();
  }

  private drawWeaponSegmentedBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    ratio: number,
    rightText: string,
    color: string,
    hudScale: number,
    flashEmptyAlert = false
  ): void {
    const labelW = 40;
    const valW = 70;
    const barX = x + labelW;
    const barW = Math.max(24, w - labelW - valW);

    ctx.textAlign = 'left';
    ctx.font = font('micro', 12, hudScale);
    ctx.fillStyle = flashEmptyAlert ? THEME.ALERT_RED_TEXT : color;
    ctx.fillText(label, x, y + h);

    const segs = 8;
    const segGap = 2;
    const segW = (barW - segGap * (segs - 1)) / segs;
    const litCount = Math.round(Math.max(0, Math.min(1, ratio)) * segs);

    for (let s = 0; s < segs; s++) {
      const sx = barX + s * (segW + segGap);
      ctx.fillStyle =
        s < litCount
          ? color
          : flashEmptyAlert
            ? 'rgba(255, 51, 24, 0.28)'
            : 'rgba(18, 46, 28, 0.55)';
      ctx.fillRect(sx, y + 1, segW, h - 2);
    }

    ctx.textAlign = 'right';
    ctx.font = font('micro', 12, hudScale);
    ctx.fillStyle = color;
    ctx.fillText(rightText, x + w, y + h);
  }

  // ===========================================================================
  // RIGHT PANEL: ORDNANCE [1-8], CONTEXTUAL RESUPPLY, ABILITIES & INSPECTOR
  // ===========================================================================

  private drawRightRequisitionPanel(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams,
    layout: PerimeterLayout
  ): void {
    const { rightPanel: rect, hudScale: s } = layout;
    const { sim, activeTool, hoveredButtonId, timeSec } = params;
    const baseW = 356;
    const baseH = Math.round(rect.height / s);
    const extraH = Math.max(0, baseH - 744);

    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.scale(s, s);

    ctx.fillStyle = THEME.BG_PANEL;
    ctx.fillRect(0, 0, baseW, baseH);
    drawCornerBrackets(ctx, 0, 0, baseW, baseH, 16, THEME.BORDER_SUBTLE, 2.2);

    // Top Economy Block: ORDNANCE SCRAP & FREE REACTOR kW
    ctx.textAlign = 'left';
    ctx.font = font('head', 16, s);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.fillText('ORDNANCE REQUISITION', 12, 23);

    const activeProtoCount =
      Object.values(sim.activeProtocols).reduce((acc, v) => acc + (v ?? 0), 0) +
      sim.activeOmegas.length;
    if (activeProtoCount > 0) {
      ctx.textAlign = 'right';
      ctx.font = font('micro', 12, s);
      ctx.fillStyle = sim.activeOmegas.length > 0 ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_CYAN;
      ctx.fillText(
        sim.activeOmegas.length > 0
          ? `PRT:${activeProtoCount - sim.activeOmegas.length} Ω:${sim.activeOmegas.length}`
          : `PROTOCOLS: ${activeProtoCount}`,
        baseW - 12,
        22
      );
    }

    const netKw = sim.maxReactorKw - sim.getTotalLoadKw();
    ctx.fillStyle = 'rgba(20, 14, 3, 0.90)';
    ctx.fillRect(12, 29, baseW - 24, 34);
    ctx.strokeStyle = netKw < 0 ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(12, 29, baseW - 24, 34);

    ctx.font = font('data', 16, s);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.textAlign = 'left';
    ctx.fillText(`SCRAP: ${sim.scrap}`, 18, 51);

    ctx.fillStyle =
      netKw < 0
        ? THEME.ALERT_RED_TEXT
        : netKw < 14
          ? THEME.ACCENT_AMBER
          : THEME.TEXT_PRIMARY;
    ctx.textAlign = 'right';
    ctx.fillText(
      netKw < 0 ? `OVER: +${Math.abs(netKw)} kW` : `FREE: ${netKw} kW`,
      baseW - 18,
      51
    );

    // 1. 8-Hardware Tactical Grid [1-8] (with Wave-1 Pulse on [1] & Contextual Inline +6 MINES on [8]!)
    let curY = 69;
    const cardW = baseW - 24;
    const gridGapX = 6;
    const gridGapY = 5;
    const cellW = (cardW - gridGapX) * 0.5;
    const cellH = Math.min(58, 52 + Math.floor(extraH * 0.02));
    const maxDoorSeals = sim.getMaxDoorSeals();
    const sealedDoors = sim.getActiveSealedDoorCount();
    const claymoreStockMax = sim.getClaymoreStockPerWave();
    const claymoreActiveMax = sim.getClaymoreMaxActive();
    const resupplyCost = sim.getOrdnanceResupplyCost();

    const drillRestricting =
      params.tutorialDirective.active && !params.tutorialDirective.graduated;
    const wave1PulseSentry =
      sim.phase === 'TACTICAL_PREP' &&
      sim.waveNumber === 1 &&
      sim.turrets.length === 0 &&
      !sim.trainingMode;
    const wave1PulseAmt = 0.55 + 0.45 * Math.sin(timeSec * 6.5);

    const buildGrid: Array<{
      id: Exclude<BuildToolId, 'NONE'>;
      shortTitle: string;
      line2: string;
      line3: string;
      cyan?: boolean;
      icon?: string;
    }> = [
      {
        id: 'SENTRY_PULSE',
        shortTitle: 'UA 571-C',
        line2: 'PAD · 320 DRUM',
        line3: '22kW · +100% LIT',
      },
      {
        id: 'INCINERATOR',
        shortTitle: 'M240 INCIN',
        line2: 'PAD · NAPALM AOE',
        line3: '26kW · BURN ACID',
      },
      {
        id: 'RAIL_LANCE',
        shortTitle: 'M99 RAIL',
        line2: 'PAD · 4X PIERCE',
        line3: '30kW · 15M SNIPER',
        cyan: true,
        icon: SEMIOTIC_ICONS.DIAMOND,
      },
      {
        id: 'CRYO_VALVE',
        shortTitle: 'CRYO VALVE',
        line2: 'GRATE · LOS SLOW',
        line3: '14kW · +35% SHAT',
      },
      {
        id: 'SHOCK_COIL',
        shortTitle: 'ARC COIL',
        line2: 'GRATE · SCALE/W',
        line3: '18kW · DECLOAKS',
        cyan: true,
        icon: SEMIOTIC_ICONS.HEX,
      },
      {
        id: 'MOTION_RELAY',
        shortTitle: 'M314 RELAY',
        line2: 'PAD · RADAR/LIT',
        line3: '10kW · +24% LINK',
      },
      {
        id: 'ARC_WELDER',
        shortTitle: 'DOOR SEAL',
        line2: `DOOR · ${sealedDoors}/${maxDoorSeals}`,
        line3: `0kW · ${PERIMETER_CONSTANTS.DOOR_MIDWAVE_WELD_SEC.toFixed(1)}S WELD`,
      },
      {
        id: 'CLAYMORE',
        shortTitle: 'M18 MINE',
        line2: `STK ${sim.claymoresRemainingThisWave}/${claymoreStockMax}`,
        line3: `0kW · ${sim.claymores.length}/${claymoreActiveMax} SET`,
      },
    ];

    buildGrid.forEach((item, idx) => {
      const bId = item.id;
      const spec = HARDWARE_SPECS[bId];
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const cx = 12 + col * (cellW + gridGapX);
      const cy = curY + row * (cellH + gridGapY);

      const drillLocked =
        drillRestricting && !params.tutorialDirective.allowedBuildIds.includes(bId);
      const inlineMineResupply =
        bId === 'CLAYMORE' && !drillRestricting && sim.claymoresRemainingThisWave <= 0;

      const btnId = inlineMineResupply ? 'resupply-mines' : `build-${bId}`;
      const isSelected =
        !drillLocked && !inlineMineResupply && activeTool.kind === 'BUILD' && activeTool.buildId === bId;
      const isCapped =
        (bId === 'ARC_WELDER' && sealedDoors >= maxDoorSeals) ||
        (bId === 'CLAYMORE' && !inlineMineResupply && sim.claymores.length >= claymoreActiveMax);
      const canAfford = inlineMineResupply
        ? sim.scrap >= resupplyCost
        : !drillLocked &&
          !isCapped &&
          sim.scrap >= spec.costScrap &&
          sim.getStaticAllocatedKw() + spec.powerKw <= sim.maxReactorKw;

      this.buttons.push({
        id: btnId,
        rect: { x: rect.x + cx * s, y: rect.y + cy * s, width: cellW * s, height: cellH * s },
        label: inlineMineResupply ? `+6 MINES (${resupplyCost}S)` : spec.name,
      });
      const hov = !drillLocked && hoveredButtonId === btnId;
      const pulseFirst = wave1PulseSentry && bId === 'SENTRY_PULSE' && !isSelected;

      ctx.fillStyle = drillLocked
        ? 'rgba(3, 9, 5, 0.96)'
        : isSelected
          ? 'rgba(255, 176, 0, 0.25)'
          : inlineMineResupply
            ? hov
              ? 'rgba(255, 176, 0, 0.28)'
              : 'rgba(42, 26, 4, 0.94)'
            : pulseFirst
              ? `rgba(255, 176, 0, ${(0.08 + wave1PulseAmt * 0.14).toFixed(3)})`
              : hov
                ? 'rgba(68, 255, 119, 0.18)'
                : 'rgba(6, 18, 11, 0.94)';
      ctx.fillRect(cx, cy, cellW, cellH);
      ctx.strokeStyle = drillLocked
        ? 'rgba(32, 68, 44, 0.42)'
        : isSelected || inlineMineResupply
          ? THEME.ACCENT_AMBER
          : pulseFirst
            ? wave1PulseAmt > 0.78
              ? THEME.ACCENT_AMBER_HI
              : THEME.ACCENT_AMBER
            : hov
              ? '#FFFFFF'
              : canAfford
                ? item.cyan
                  ? THEME.ACCENT_CYAN
                  : THEME.TEXT_PRIMARY
                : THEME.BORDER_SUBTLE;
      ctx.lineWidth = isSelected || pulseFirst ? 2.2 : drillLocked ? 1.0 : 1.4;
      ctx.strokeRect(cx, cy, cellW, cellH);

      if (inlineMineResupply) {
        // Contextual Late-Game Inline Resupply surfaced directly on [8] M18 MINE when stock hits 0!
        ctx.textAlign = 'center';
        ctx.font = font('micro', 12, s);
        ctx.fillStyle = canAfford ? THEME.ACCENT_AMBER_HI : THEME.ALERT_RED_TEXT;
        drawEllipsizedText(ctx, `${SEMIOTIC_ICONS.CROSS} +6 MINES (${resupplyCost}S)`, cx + cellW * 0.5, cy + 22, cellW - 10);
        ctx.fillStyle = canAfford ? THEME.TEXT_BRIGHT : THEME.TEXT_MUTED;
        drawEllipsizedText(ctx, 'STOCK 0 · CLICK TO BUY', cx + cellW * 0.5, cy + 40, cellW - 10);
        return;
      }

      // Right Cost Tag
      const costTxt = drillLocked ? 'LOCK' : `${spec.costScrap}S`;
      ctx.font = font('micro', 12, s);
      const pillW = Math.ceil(ctx.measureText(costTxt).width) + 8;
      const pillX = cx + cellW - pillW - 4;
      const pillY = cy + 4;
      ctx.fillStyle = drillLocked
        ? 'rgba(12, 22, 16, 0.8)'
        : canAfford
          ? 'rgba(34, 24, 4, 0.92)'
          : 'rgba(42, 10, 8, 0.92)';
      ctx.fillRect(pillX, pillY, pillW, 18);
      ctx.strokeStyle = drillLocked
        ? 'rgba(44, 78, 56, 0.45)'
        : canAfford
          ? 'rgba(255, 176, 0, 0.72)'
          : 'rgba(255, 51, 24, 0.72)';
      ctx.lineWidth = 1.0;
      ctx.strokeRect(pillX, pillY, pillW, 18);
      ctx.textAlign = 'center';
      ctx.fillStyle = drillLocked
        ? THEME.TEXT_MUTED
        : canAfford
          ? THEME.ACCENT_AMBER_HI
          : THEME.ALERT_RED_TEXT;
      ctx.fillText(costTxt, pillX + pillW * 0.5, pillY + 13);

      // Left Short Title strictly left of cost pill
      ctx.textAlign = 'left';
      ctx.font = font('button', 13, s);
      ctx.fillStyle = drillLocked
        ? THEME.TEXT_MUTED
        : isSelected || pulseFirst
          ? THEME.ACCENT_AMBER_HI
          : hov
            ? '#FFFFFF'
            : canAfford
              ? item.cyan
                ? THEME.ACCENT_CYAN
                : THEME.TEXT_PRIMARY
              : THEME.TEXT_SECONDARY;
      const titlePrefix = item.icon ? `${item.icon}` : '';
      drawEllipsizedText(
        ctx,
        `[${spec.shortKey}] ${titlePrefix}${item.shortTitle}`,
        cx + 6,
        cy + 17,
        pillX - cx - 8
      );

      // Line 2 & Line 3 compact technical telemetry (>=12px effective)
      ctx.font = font('micro', 12, s);
      ctx.fillStyle = drillLocked
        ? THEME.TEXT_MUTED
        : canAfford
          ? THEME.TEXT_BRIGHT
          : THEME.TEXT_SECONDARY;
      drawEllipsizedText(ctx, item.line2, cx + 6, cy + 34, cellW - 10);
      ctx.fillStyle = drillLocked
        ? THEME.TEXT_MUTED
        : canAfford
          ? item.cyan
            ? THEME.ACCENT_CYAN
            : THEME.ACCENT_AMBER
          : THEME.TEXT_MUTED;
      drawEllipsizedText(ctx, item.line3, cx + 6, cy + cellH - 5, cellW - 10);
    });

    curY += 4 * cellH + 3 * gridGapY + 6;

    // 2. Active Player Command Abilities (2×3 Grid — with Contextual Inline +1 PURGE on [V] when 0 charges!)
    ctx.textAlign = 'left';
    ctx.font = font('micro', 12, s);
    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.fillText('COMMAND ABILITIES [F / O / V / L / C / X]', 12, curY + 11);
    curY += 16;

    const abGap = 6;
    const abW = (cardW - abGap * 2) / 3;
    const abH = 40;
    const nightHunterLocksFlood = sim.hasOmega('NIGHT_HUNTER_OPTICS');
    const floodReady =
      !nightHunterLocksFlood &&
      sim.blackoutTimer <= 0 &&
      sim.floodlightCooldown <= 0 &&
      sim.reserveBattery >= PERIMETER_CONSTANTS.FLOODLIGHT_BATTERY_COST;
    const coolantReady = sim.blackoutTimer <= 0 && sim.coolantFlushCooldown <= 0;
    const ocSurgeKw = sim.getOverclockSurgeKw();
    const inlinePurgeResupply = !drillRestricting && sim.purgeChargesRemaining <= 0;

    const abilityRows: Array<
      Array<{
        id: string;
        toolId?: 'FLARE' | 'OVERCLOCK' | 'PURGE';
        top: string;
        sub: string;
        ready: boolean;
        accent?: string;
        active?: boolean;
      }>
    > = [
      [
        {
          id: 'ability-FLARE',
          toolId: 'FLARE',
          top: '[F] FLARE',
          sub: sim.flareCooldown > 0 ? `${sim.flareCooldown.toFixed(0)}S CD` : '0kW · 12S',
          ready: sim.flareCooldown <= 0,
        },
        {
          id: 'ability-OVERCLOCK',
          toolId: 'OVERCLOCK',
          top: '[O] OVRCLK',
          sub: sim.overclockCooldown > 0 ? `${sim.overclockCooldown.toFixed(0)}S CD` : `+${ocSurgeKw}kW 2X`,
          ready: sim.overclockCooldown <= 0 && sim.blackoutTimer <= 0,
        },
        inlinePurgeResupply
          ? {
              id: 'resupply-purge',
              top: `${SEMIOTIC_ICONS.CROSS}+1 PURGE`,
              sub: `${resupplyCost}S BUY`,
              ready: sim.scrap >= resupplyCost,
              accent: THEME.TEXT_PRIMARY,
            }
          : {
              id: 'ability-PURGE',
              toolId: 'PURGE',
              top: '[V] PURGE',
              sub: sim.purgeChargesRemaining > 0 ? `${sim.purgeChargesRemaining}X READY` : 'SPENT',
              ready: sim.purgeChargesRemaining > 0,
            },
      ],
      [
        {
          id: 'ability-FLOODLIGHT',
          top: `${SEMIOTIC_ICONS.DIAMOND}[L] FLOOD`,
          sub: nightHunterLocksFlood
            ? 'Ω-OFF'
            : sim.floodlightTimer > 0
              ? `LIT ${sim.floodlightTimer.toFixed(1)}S`
              : sim.floodlightCooldown > 0
                ? `${sim.floodlightCooldown.toFixed(0)}S CD`
                : `${Math.round(sim.reserveBattery)}/${PERIMETER_CONSTANTS.FLOODLIGHT_BATTERY_COST}%`,
          ready: floodReady || sim.floodlightTimer > 0,
          accent: THEME.ACCENT_CYAN,
          active: sim.floodlightTimer > 0,
        },
        {
          id: 'ability-COOLANT_FLUSH',
          top: `${SEMIOTIC_ICONS.TRIANGLE}[C] FLUSH`,
          sub: sim.coolantFlushCooldown > 0 ? `${sim.coolantFlushCooldown.toFixed(0)}S CD` : 'COOL',
          ready: coolantReady,
          accent: THEME.ACCENT_CYAN,
        },
        {
          id: 'aux-shed',
          top: sim.auxShedActive ? `[X] RST(${sim.auxShedTurretIds.length})` : '[X] SHED',
          sub: sim.auxShedActive ? 'RESTORE' : 'SHED AUX',
          ready: true,
          accent: THEME.ACCENT_AMBER,
          active: sim.auxShedActive,
        },
      ],
    ];

    abilityRows.forEach((rowItems, rowIdx) => {
      const ry = curY + rowIdx * (abH + 5);
      rowItems.forEach((ab, idx) => {
        const ax = 12 + idx * (abW + abGap);
        const abCmd = ab.id.startsWith('ability-')
          ? (ab.id.replace('ability-', '') as
              | 'FLARE'
              | 'OVERCLOCK'
              | 'PURGE'
              | 'FLOODLIGHT'
              | 'COOLANT_FLUSH')
          : null;
        const drillLocked =
          drillRestricting &&
          (abCmd === null || !params.tutorialDirective.allowedAbilityIds.includes(abCmd));
        const isArmed =
          !drillLocked &&
          (Boolean(ab.active) ||
            (ab.toolId !== undefined &&
              activeTool.kind === 'ABILITY' &&
              activeTool.abilityId === ab.toolId));
        this.buttons.push({
          id: ab.id,
          rect: { x: rect.x + ax * s, y: rect.y + ry * s, width: abW * s, height: abH * s },
          label: ab.top,
        });
        const hov = !drillLocked && hoveredButtonId === ab.id;
        const acc = ab.accent ?? THEME.ACCENT_AMBER;

        ctx.fillStyle = drillLocked
          ? 'rgba(3, 9, 5, 0.96)'
          : isArmed
            ? 'rgba(255, 176, 0, 0.26)'
            : hov && ab.ready
              ? 'rgba(68, 255, 119, 0.20)'
              : 'rgba(6, 16, 10, 0.92)';
        ctx.fillRect(ax, ry, abW, abH);
        ctx.strokeStyle = drillLocked
          ? 'rgba(32, 68, 44, 0.42)'
          : isArmed
            ? acc
            : ab.ready
              ? acc
              : THEME.BORDER_SUBTLE;
        ctx.lineWidth = isArmed ? 2.2 : drillLocked ? 1.0 : 1.4;
        ctx.strokeRect(ax, ry, abW, abH);

        ctx.textAlign = 'center';
        ctx.font = font('micro', 12, s);
        ctx.fillStyle = drillLocked
          ? THEME.TEXT_MUTED
          : ab.ready
            ? ab.accent === THEME.ACCENT_CYAN
              ? THEME.ACCENT_CYAN
              : THEME.ACCENT_AMBER_HI
            : THEME.TEXT_SECONDARY;
        drawEllipsizedText(ctx, ab.top, ax + abW * 0.5, ry + 16, abW - 6);

        ctx.fillStyle = drillLocked
          ? THEME.TEXT_MUTED
          : ab.ready
            ? THEME.TEXT_PRIMARY
            : THEME.ALERT_RED_TEXT;
        drawEllipsizedText(ctx, drillLocked ? 'LOCKED' : ab.sub, ax + abW * 0.5, ry + 34, abW - 6);
      });
    });
    curY += abH * 2 + 11;

    // 3. Wave Launch [ENTER] & [Z] 2X Speed Row
    const waveH = 38;
    const speedW = 104;
    const waveBtnW = cardW - speedW - 7;
    const isLaunchAction = sim.trainingMode
      ? params.tutorialDirective.showContinueBtn
      : sim.phase === 'TACTICAL_PREP';

    this.buttons.push({
      id: isLaunchAction ? 'wave-launch' : 'perim-pause-toggle',
      rect: { x: rect.x + 12 * s, y: rect.y + curY * s, width: waveBtnW * s, height: waveH * s },
      label: isLaunchAction ? 'LAUNCH WAVE' : 'TACTICAL PAUSE',
    });
    const waveHov = hoveredButtonId === (isLaunchAction ? 'wave-launch' : 'perim-pause-toggle');
    ctx.fillStyle = isLaunchAction
      ? waveHov
        ? THEME.ACCENT_AMBER_HI
        : THEME.ACCENT_AMBER
      : sim.tacticalPaused
        ? 'rgba(255, 176, 0, 0.25)'
        : 'rgba(12, 34, 20, 0.94)';
    ctx.fillRect(12, curY, waveBtnW, waveH);
    ctx.strokeStyle = isLaunchAction ? '#FFF3CC' : THEME.ACCENT_AMBER;
    ctx.lineWidth = 2.0;
    ctx.strokeRect(12, curY, waveBtnW, waveH);

    ctx.textAlign = 'center';
    ctx.font = font('button', 14, s);
    ctx.fillStyle = isLaunchAction ? THEME.INK_INVERSE : THEME.ACCENT_AMBER_HI;
    const waveLabel = sim.trainingMode
      ? params.tutorialDirective.showContinueBtn
        ? '► NEXT STEP [ENTER]'
        : sim.tacticalPaused
          ? '► RESUME [SPACE]'
          : '❚❚ PAUSE [SPACE]'
      : isLaunchAction
        ? `► LAUNCH W-${String(sim.waveNumber).padStart(2, '0')} [ENTER]`
        : sim.tacticalPaused
          ? '► RESUME [SPACE]'
          : '❚❚ TACTICAL [SPACE]';
    drawEllipsizedText(ctx, waveLabel, 12 + waveBtnW * 0.5, curY + 24, waveBtnW - 10);

    const speedX = 12 + waveBtnW + 7;
    this.buttons.push({
      id: 'toggle-2x-speed',
      rect: { x: rect.x + speedX * s, y: rect.y + curY * s, width: speedW * s, height: waveH * s },
      label: '2X SPEED',
    });
    const spdHov = hoveredButtonId === 'toggle-2x-speed';
    ctx.fillStyle = sim.fastForward2x
      ? 'rgba(68, 255, 119, 0.28)'
      : spdHov
        ? 'rgba(68, 255, 119, 0.16)'
        : 'rgba(6, 16, 10, 0.94)';
    ctx.fillRect(speedX, curY, speedW, waveH);
    ctx.strokeStyle = sim.fastForward2x ? THEME.TEXT_PRIMARY : THEME.TEXT_SECONDARY;
    ctx.lineWidth = sim.fastForward2x ? 2.2 : 1.6;
    ctx.strokeRect(speedX, curY, speedW, waveH);
    ctx.font = font('button', 13, s);
    ctx.fillStyle = sim.fastForward2x ? THEME.TEXT_BRIGHT : THEME.TEXT_PRIMARY;
    drawEllipsizedText(
      ctx,
      sim.fastForward2x ? '[Z] 2X ON' : '[Z] 1X→2X',
      speedX + speedW * 0.5,
      curY + 24,
      speedW - 8
    );

    curY += waveH + 7;

    // 4. Unit / Bulkhead Door Inspector Sub-Panel (tall, wrapped, zero squashing!)
    const inspH = Math.max(210, baseH - curY - 8);
    this.drawUnitInspector(ctx, 12, curY, cardW, inspH, params, rect, s);

    ctx.restore();
  }

  private drawUnitInspector(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    params: PerimeterHudRenderParams,
    panelScreenRect: ViewportRect,
    s: number
  ): void {
    const { sim, selectedTurretId, selectedDoorId, hoveredButtonId, activeTool } = params;

    ctx.fillStyle = 'rgba(2, 8, 5, 0.96)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(x, y, w, h);

    const selectedTurret: PlacedTurret | undefined = selectedTurretId
      ? sim.turrets.find((u) => u.id === selectedTurretId)
      : undefined;

    if (selectedTurret) {
      const t = selectedTurret;
      const spec = HARDWARE_SPECS[t.kind];
      const liveKw = sim.getTurretPowerKw(t);
      const inBlackout = sim.blackoutTimer > 0 && liveKw > 0;
      const isReloading = t.kind === 'SENTRY_PULSE' && t.rearmTimer > 0;
      const mk4 = t.mk4Level ?? 0;
      const mkLabel =
        t.level === 3 && t.mk3Branch
          ? `III ${MK3_BRANCH_SPECS[t.kind][t.mk3Branch].code}${mk4 > 0 ? ` +IV.${mk4}` : ''}`
          : t.level === 2
            ? 'MK-II'
            : 'MK-I';

      ctx.textAlign = 'left';
      ctx.font = font('head', 14, s);
      ctx.fillStyle = inBlackout
        ? THEME.ALERT_RED_TEXT
        : mk4 > 0
          ? THEME.ACCENT_AMBER_HI
          : t.level === 3
            ? THEME.ACCENT_CYAN
            : THEME.ACCENT_AMBER;
      drawEllipsizedText(ctx, `${t.callsign} // ${spec.code} ${mkLabel}`, x + 10, y + 20, w - 20);

      ctx.font = font('micro', 12, s);
      ctx.fillStyle = inBlackout
        ? THEME.ALERT_RED_TEXT
        : t.powered && t.powerUpTimer > 0
          ? THEME.ACCENT_CYAN
          : t.acidDebuffTimer > 0
            ? '#B8FF3B'
            : t.jammedTimer > 0
              ? '#E066FF'
              : isReloading
                ? THEME.ACCENT_AMBER_HI
                : THEME.TEXT_BRIGHT;
      const rdsText = inBlackout
        ? `BLACKOUT (${sim.blackoutTimer.toFixed(1)}S)`
        : t.powered && t.powerUpTimer > 0
          ? `SPINUP (${t.powerUpTimer.toFixed(1)}S)`
          : t.acidDebuffTimer > 0
            ? `ACID (${t.acidDebuffTimer.toFixed(1)}S)`
            : t.jammedTimer > 0
              ? `JAMMED (${t.jammedTimer.toFixed(1)}S)`
              : isReloading
                ? `RELOAD: ${t.rearmTimer.toFixed(1)}S`
                : t.kind === 'SENTRY_PULSE'
                  ? `RDS: ${String(t.ammo).padStart(3, '0')}/${t.maxAmmo}`
                  : t.kind === 'MOTION_RELAY'
                    ? `WIRE: ${Math.round(t.tripwireIntegrity)}%`
                    : `PWR: ${t.powered ? `${liveKw}kW` : 'OFF'}`;
      drawEllipsizedText(ctx, `${rdsText} · KILLS: ${t.kills}`, x + 10, y + 38, w - 20);

      // Barrel Temp or Reload Bar
      const barX = x + 58;
      const barW = w - 114;
      if (isReloading) {
        const reloadFrac = Math.max(
          0,
          Math.min(1, 1 - t.rearmTimer / Math.max(0.1, t.rearmDuration))
        );
        ctx.fillStyle = THEME.ACCENT_AMBER_HI;
        ctx.fillText('FEED:', x + 10, y + 58);
        ctx.strokeStyle = THEME.ACCENT_AMBER;
        ctx.lineWidth = 1.4;
        ctx.strokeRect(barX, y + 46, barW, 13);
        ctx.fillStyle = THEME.ACCENT_AMBER;
        ctx.fillRect(barX + 1, y + 47, Math.max(0, (barW - 2) * reloadFrac), 11);
        ctx.textAlign = 'right';
        ctx.fillStyle = THEME.ACCENT_AMBER_HI;
        ctx.fillText(`${Math.round(reloadFrac * 100)}%`, x + w - 10, y + 58);
      } else {
        ctx.fillStyle = THEME.TEXT_BRIGHT;
        ctx.fillText('TEMP:', x + 10, y + 58);
        ctx.strokeStyle = THEME.BORDER_SUBTLE;
        ctx.lineWidth = 1.4;
        ctx.strokeRect(barX, y + 46, barW, 13);
        const tempCol =
          t.thermalLocked || t.heat > 80 ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER;
        ctx.fillStyle = tempCol;
        ctx.fillRect(barX + 1, y + 47, Math.max(0, ((barW - 2) * t.heat) / 100), 11);
        ctx.textAlign = 'right';
        ctx.fillStyle = tempCol;
        ctx.fillText(`${Math.round(t.heat)}%`, x + w - 10, y + 58);
      }

      const btnGap = 6;
      const innerW = w - 20;
      const halfW = (innerW - btnGap) * 0.5;
      let by = y + 67;
      const bh = t.level >= 2 ? 28 : 31;

      const addInspBtn = (
        id: string,
        bx: number,
        rowY: number,
        bw: number,
        btnH: number,
        lbl: string,
        accent: string,
        active = false
      ) => {
        this.buttons.push({
          id,
          rect: {
            x: panelScreenRect.x + bx * s,
            y: panelScreenRect.y + rowY * s,
            width: bw * s,
            height: btnH * s,
          },
          label: lbl,
        });
        const hov = hoveredButtonId === id || active;
        ctx.fillStyle = hov ? 'rgba(255, 176, 0, 0.24)' : 'rgba(8, 24, 14, 0.94)';
        ctx.fillRect(bx, rowY, bw, btnH);
        ctx.strokeStyle = hov ? '#FFFFFF' : accent;
        ctx.lineWidth = hov ? 2.0 : 1.5;
        ctx.strokeRect(bx, rowY, bw, btnH);
        ctx.textAlign = 'center';
        ctx.font = font('micro', 12, s);
        ctx.fillStyle = hov ? '#FFFFFF' : accent;
        drawEllipsizedText(ctx, lbl, bx + bw * 0.5, rowY + btnH * 0.66, bw - 8);
      };

      const isRotating = activeTool.kind === 'ROTATE_TURRET' && activeTool.turretId === t.id;
      const isOmni = t.kind === 'CRYO_VALVE' || t.kind === 'SHOCK_COIL';

      if (t.kind === 'SENTRY_PULSE') {
        const rCost = sim.getRearmCostFor(t);
        addInspBtn(
          'insp-rearm',
          x + 10,
          by,
          halfW,
          bh,
          isReloading
            ? `LOAD ${t.rearmTimer.toFixed(1)}S`
            : rCost > 0
              ? `[E] REARM (${rCost}S)`
              : 'DRUM FULL',
          isReloading ? THEME.ACCENT_AMBER_HI : t.ammo === 0 ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER,
          isReloading
        );
        addInspBtn(
          'insp-rotate',
          x + 10 + halfW + btnGap,
          by,
          halfW,
          bh,
          isRotating ? 'CLICK AIM...' : '[R] ROTATE +45°',
          THEME.TEXT_PRIMARY,
          isRotating
        );
        by += bh + 5;
      } else if (!isOmni) {
        addInspBtn(
          'insp-rotate',
          x + 10,
          by,
          innerW,
          bh,
          isRotating ? 'CLICK CORRIDOR TO SET AIM...' : '[R] ROTATE ARC +45° (OR CLICK)',
          THEME.TEXT_PRIMARY,
          isRotating
        );
        by += bh + 5;
      }

      let invested = spec.costScrap + (t.level >= 2 ? spec.upgradeCostScrap : 0);
      if (t.level === 3 && t.mk3Branch) {
        invested += MK3_BRANCH_SPECS[t.kind][t.mk3Branch].costScrap;
      }
      const totalInvested = Math.max(invested, t.totalInvestedScrap ?? 0);
      const refund = Math.round(totalInvested * 0.65);

      if (t.level === 1) {
        addInspBtn(
          'insp-power',
          x + 10,
          by,
          halfW,
          bh,
          t.powered ? `[K] OFF (-${liveKw}kW)` : `[K] ON (+${liveKw}kW)`,
          t.powered ? THEME.TEXT_PRIMARY : THEME.ACCENT_AMBER
        );
        addInspBtn(
          'insp-upgrade',
          x + 10 + halfW + btnGap,
          by,
          halfW,
          bh,
          `[U] MK-II (${spec.upgradeCostScrap}S)`,
          THEME.ACCENT_AMBER_HI
        );
        by += bh + 5;
        addInspBtn(
          'insp-scrap',
          x + 10,
          by,
          innerW,
          bh,
          `[DEL] SCRAP UNIT (+${refund}S)`,
          THEME.ALERT_RED_TEXT
        );
      } else if (t.level === 2) {
        addInspBtn(
          'insp-power',
          x + 10,
          by,
          halfW,
          bh,
          t.powered ? `[K] OFF (-${liveKw}kW)` : `[K] ON (+${liveKw}kW)`,
          t.powered ? THEME.TEXT_PRIMARY : THEME.ACCENT_AMBER
        );
        addInspBtn(
          'insp-scrap',
          x + 10 + halfW + btnGap,
          by,
          halfW,
          bh,
          `[DEL] SCRAP (+${refund}S)`,
          THEME.ALERT_RED_TEXT
        );
        by += bh + 6;

        ctx.textAlign = 'left';
        ctx.font = font('micro', 12, s);
        ctx.fillStyle = THEME.ACCENT_CYAN;
        ctx.fillText(`${SEMIOTIC_ICONS.STAR} PICK MK-III BRANCH ([A] / [B]):`, x + 10, by + 11);
        by += 17;

        // Multi-line wrapped MK-III Branch A & B cards (ZERO horizontal squashing!)
        const branchH = Math.max(74, y + h - by - 8);
        const branches: Array<{ id: 'insp-upgrade-a' | 'insp-upgrade-b'; key: 'A' | 'B' }> = [
          { id: 'insp-upgrade-a', key: 'A' },
          { id: 'insp-upgrade-b', key: 'B' },
        ];
        branches.forEach((br, idx) => {
          const bSpec = MK3_BRANCH_SPECS[t.kind][br.key];
          const bx = x + 10 + idx * (halfW + btnGap);
          const canBuy =
            sim.scrap >= bSpec.costScrap &&
            (!t.powered || sim.getStaticAllocatedKw() + bSpec.extraKw <= sim.maxReactorKw);
          const hov = hoveredButtonId === br.id;
          this.buttons.push({
            id: br.id,
            rect: {
              x: panelScreenRect.x + bx * s,
              y: panelScreenRect.y + by * s,
              width: halfW * s,
              height: branchH * s,
            },
            label: `MK-III [${br.key}] ${bSpec.code}`,
          });
          ctx.fillStyle = hov
            ? 'rgba(76, 238, 255, 0.24)'
            : canBuy
              ? THEME.ACCENT_CYAN_BG
              : 'rgba(12, 16, 14, 0.92)';
          ctx.fillRect(bx, by, halfW, branchH);
          ctx.strokeStyle = hov ? '#FFFFFF' : canBuy ? THEME.ACCENT_CYAN : THEME.BORDER_SUBTLE;
          ctx.lineWidth = hov ? 2.0 : 1.5;
          ctx.strokeRect(bx, by, halfW, branchH);

          ctx.textAlign = 'left';
          ctx.font = font('micro', 12, s);
          ctx.fillStyle = canBuy ? THEME.ACCENT_CYAN : THEME.TEXT_MUTED;
          drawEllipsizedText(ctx, `[${br.key}] ${bSpec.code}`, bx + 6, by + 15, halfW - 12);

          ctx.fillStyle = canBuy ? THEME.ACCENT_AMBER_HI : THEME.ALERT_RED_TEXT;
          drawEllipsizedText(
            ctx,
            `${bSpec.costScrap}S · +${bSpec.extraKw}kW`,
            bx + 6,
            by + 31,
            halfW - 12
          );

          ctx.fillStyle = canBuy ? THEME.TEXT_BRIGHT : THEME.TEXT_MUTED;
          const wrapped = wrapTextLines(ctx, bSpec.summary, halfW - 12, 3);
          wrapped.forEach((ln, li) => {
            const ly = by + 48 + li * 15;
            if (ly <= by + branchH - 5) {
              ctx.fillText(ln, bx + 6, ly);
            }
          });
        });
      } else {
        // MK-III Installed View + MK-IV Overhaul Refit Button (wrapped cleanly!)
        const bSpec = t.mk3Branch ? MK3_BRANCH_SPECS[t.kind][t.mk3Branch] : null;
        addInspBtn(
          'insp-power',
          x + 10,
          by,
          halfW,
          bh,
          t.powered ? `[K] OFF (-${liveKw}kW)` : `[K] ON (+${liveKw}kW)`,
          t.powered ? THEME.TEXT_PRIMARY : THEME.ACCENT_AMBER
        );
        addInspBtn(
          'insp-scrap',
          x + 10 + halfW + btnGap,
          by,
          halfW,
          bh,
          `[DEL] SCRAP (+${refund}S)`,
          THEME.ALERT_RED_TEXT
        );
        by += bh + 6;

        const refitCost = sim.getMk4RefitCost(t);
        const mk4Lvl = t.mk4Level ?? 0;
        if (refitCost !== null) {
          const canRefit =
            sim.scrap >= refitCost &&
            (!t.powered ||
              sim.getStaticAllocatedKw() + PERIMETER_CONSTANTS.MK4_KW_PER_LEVEL <=
                sim.maxReactorKw);
          const refitH = 42;
          const hov = hoveredButtonId === 'insp-refit-mk4';
          this.buttons.push({
            id: 'insp-refit-mk4',
            rect: {
              x: panelScreenRect.x + (x + 10) * s,
              y: panelScreenRect.y + by * s,
              width: innerW * s,
              height: refitH * s,
            },
            label: 'MK-IV OVERHAUL REFIT',
          });
          ctx.fillStyle = hov
            ? 'rgba(255, 176, 0, 0.28)'
            : canRefit
              ? 'rgba(42, 30, 6, 0.92)'
              : 'rgba(10, 18, 13, 0.92)';
          ctx.fillRect(x + 10, by, innerW, refitH);
          ctx.strokeStyle = hov ? '#FFFFFF' : canRefit ? THEME.ACCENT_AMBER_HI : THEME.BORDER_SUBTLE;
          ctx.lineWidth = hov ? 2.0 : 1.5;
          ctx.strokeRect(x + 10, by, innerW, refitH);
          ctx.textAlign = 'center';
          ctx.font = font('micro', 12, s);
          ctx.fillStyle = canRefit ? THEME.ACCENT_AMBER_HI : THEME.TEXT_MUTED;
          drawEllipsizedText(
            ctx,
            `${SEMIOTIC_ICONS.STAR} [U] MK-IV REFIT (${mk4Lvl}→${mk4Lvl + 1}/3) · ${refitCost}S`,
            x + w * 0.5,
            by + 16,
            innerW - 12
          );
          ctx.fillStyle = canRefit ? THEME.TEXT_BRIGHT : THEME.TEXT_MUTED;
          ctx.fillText('+10% DMG (OR M314 RNG) · +1 kW', x + w * 0.5, by + 34);
          by += refitH + 6;
        } else {
          ctx.fillStyle = 'rgba(42, 32, 6, 0.92)';
          ctx.fillRect(x + 10, by, innerW, 30);
          ctx.strokeStyle = THEME.ACCENT_AMBER_HI;
          ctx.lineWidth = 1.4;
          ctx.strokeRect(x + 10, by, innerW, 30);
          ctx.textAlign = 'center';
          ctx.font = font('micro', 12, s);
          ctx.fillStyle = THEME.ACCENT_AMBER_HI;
          drawEllipsizedText(ctx, '★ MK-IV MAXED (3/3 · +30% DMG)', x + w * 0.5, by + 19, innerW - 12);
          by += 36;
        }

        if (bSpec && by + 36 <= y + h - 4) {
          const specBoxH = Math.max(44, y + h - by - 8);
          ctx.fillStyle = THEME.ACCENT_CYAN_BG;
          ctx.fillRect(x + 10, by, innerW, specBoxH);
          ctx.strokeStyle = THEME.ACCENT_CYAN;
          ctx.lineWidth = 1.4;
          ctx.strokeRect(x + 10, by, innerW, specBoxH);
          ctx.textAlign = 'left';
          ctx.font = font('micro', 12, s);
          ctx.fillStyle = THEME.ACCENT_CYAN;
          drawEllipsizedText(
            ctx,
            `${SEMIOTIC_ICONS.DIAMOND} MK-III ${bSpec.code} ACTIVE`,
            x + 18,
            by + 16,
            innerW - 16
          );
          ctx.fillStyle = THEME.TEXT_BRIGHT;
          const wrapped = wrapTextLines(ctx, bSpec.summary, innerW - 16, 2);
          wrapped.forEach((ln, li) => {
            const ly = by + 33 + li * 16;
            if (ly <= by + specBoxH - 5) {
              ctx.fillText(ln, x + 18, ly);
            }
          });
        }
      }
      return;
    }

    // Selected Blast Door Inspector
    if (selectedDoorId) {
      const ds = sim.doors.get(selectedDoorId);
      if (ds) {
        const weldCost = HARDWARE_SPECS.ARC_WELDER.costScrap;
        const activeSeals = sim.getActiveSealedDoorCount();
        const maxSeals = sim.getMaxDoorSeals();
        const isWelding = ds.weldingTimer > 0;

        ctx.textAlign = 'left';
        ctx.font = font('head', 15, s);
        ctx.fillStyle = THEME.ACCENT_AMBER;
        drawEllipsizedText(ctx, `BULKHEAD // ${ds.def.label}`, x + 10, y + 22, w - 20);

        ctx.font = font('micro', 12, s);
        ctx.fillStyle = isWelding
          ? THEME.ACCENT_AMBER_HI
          : ds.welded
            ? THEME.TEXT_PRIMARY
            : THEME.ACCENT_AMBER;
        drawEllipsizedText(
          ctx,
          isWelding
            ? `WELDING (${ds.weldingTimer.toFixed(1)}S) · ${activeSeals}/${maxSeals}`
            : ds.welded
              ? `SEALED ${Math.round(ds.hp)}/${ds.maxHp} HP · ${activeSeals}/${maxSeals}`
              : `OPEN · SEALS ${activeSeals}/${maxSeals}`,
          x + 10,
          y + 43,
          w - 20
        );

        const bh = 36;
        if (isWelding) {
          const frac = Math.max(
            0,
            Math.min(1, 1 - ds.weldingTimer / Math.max(0.1, ds.weldingDuration))
          );
          ctx.fillStyle = 'rgba(28, 18, 4, 0.92)';
          ctx.fillRect(x + 10, y + 62, w - 20, 34);
          ctx.fillStyle = 'rgba(255, 176, 0, 0.42)';
          ctx.fillRect(x + 11, y + 63, (w - 22) * frac, 32);
          ctx.strokeStyle = THEME.ACCENT_AMBER;
          ctx.lineWidth = 1.8;
          ctx.strokeRect(x + 10, y + 62, w - 20, 34);
          ctx.textAlign = 'center';
          ctx.font = font('button', 13, s);
          ctx.fillStyle = THEME.ACCENT_AMBER_HI;
          ctx.fillText(
            `SEALING ${Math.round(frac * 100)}% (${ds.weldingTimer.toFixed(1)}S)`,
            x + w * 0.5,
            y + 84
          );
        } else if (!ds.welded) {
          const sealCapped = activeSeals >= maxSeals;
          const cooling = ds.repairCooldown > 0;
          const canWeldNow = !sealCapped && !cooling;
          this.buttons.push({
            id: 'door-weld',
            rect: {
              x: panelScreenRect.x + (x + 10) * s,
              y: panelScreenRect.y + (y + 62) * s,
              width: (w - 20) * s,
              height: bh * s,
            },
            label: 'WELD SEAL',
          });
          ctx.fillStyle = canWeldNow ? 'rgba(255, 176, 0, 0.24)' : THEME.ALERT_RED_BG;
          ctx.fillRect(x + 10, y + 62, w - 20, bh);
          ctx.strokeStyle = canWeldNow ? THEME.ACCENT_AMBER : THEME.ALERT_RED_STROKE;
          ctx.lineWidth = 1.8;
          ctx.strokeRect(x + 10, y + 62, w - 20, bh);
          ctx.textAlign = 'center';
          ctx.font = font('button', 13, s);
          ctx.fillStyle = canWeldNow ? THEME.ACCENT_AMBER_HI : THEME.ALERT_RED_TEXT;
          drawEllipsizedText(
            ctx,
            sealCapped
              ? `MAX ${maxSeals} SEALS — UNSEAL ONE FIRST`
              : cooling
                ? `TORCH COOLING (${ds.repairCooldown.toFixed(1)}S)`
                : `WELD SEAL (${weldCost}S)`,
            x + w * 0.5,
            y + 85,
            w - 28
          );
        } else {
          if (ds.hp < ds.maxHp - 5) {
            const repCost = Math.max(18, Math.round(weldCost * (1 - ds.hp / ds.maxHp)));
            const cooling = ds.repairCooldown > 0;
            this.buttons.push({
              id: 'door-repair',
              rect: {
                x: panelScreenRect.x + (x + 10) * s,
                y: panelScreenRect.y + (y + 60) * s,
                width: (w - 20) * s,
                height: 34 * s,
              },
              label: 'REINFORCE WELD',
            });
            ctx.fillStyle = cooling ? THEME.ALERT_RED_BG : THEME.ACCENT_AMBER_BG;
            ctx.fillRect(x + 10, y + 60, w - 20, 34);
            ctx.strokeStyle = cooling ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
            ctx.lineWidth = 1.6;
            ctx.strokeRect(x + 10, y + 60, w - 20, 34);
            ctx.textAlign = 'center';
            ctx.font = font('button', 13, s);
            ctx.fillStyle = cooling ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER_HI;
            drawEllipsizedText(
              ctx,
              cooling ? `COOLING (${ds.repairCooldown.toFixed(1)}S)` : `REINFORCE (${repCost}S)`,
              x + w * 0.5,
              y + 82,
              w - 28
            );
          }

          this.buttons.push({
            id: 'door-unseal',
            rect: {
              x: panelScreenRect.x + (x + 10) * s,
              y: panelScreenRect.y + (y + 102) * s,
              width: (w - 20) * s,
              height: 34 * s,
            },
            label: 'UNSEAL DOOR',
          });
          ctx.fillStyle = 'rgba(6, 22, 12, 0.9)';
          ctx.fillRect(x + 10, y + 102, w - 20, 34);
          ctx.strokeStyle = THEME.TEXT_PRIMARY;
          ctx.lineWidth = 1.6;
          ctx.strokeRect(x + 10, y + 102, w - 20, 34);
          ctx.textAlign = 'center';
          ctx.font = font('button', 13, s);
          ctx.fillStyle = THEME.TEXT_BRIGHT;
          drawEllipsizedText(ctx, 'UNSEAL BLAST DOOR', x + w * 0.5, y + 124, w - 28);

          if (sim.getProtocolStacks('BULKHEAD_ARMOR') > 0 && y + 158 <= y + h - 6) {
            ctx.textAlign = 'center';
            ctx.font = font('micro', 12, s);
            ctx.fillStyle = THEME.ACCENT_CYAN;
            const eLines = wrapTextLines(
              ctx,
              '⚡ ELECTRIFIED: 55 DPS RECOIL · 50% ACID REFLECT',
              w - 20,
              2
            );
            eLines.forEach((ln, li) => {
              ctx.fillText(ln, x + w * 0.5, y + 154 + li * 16);
            });
          }
        }
        return;
      }
    }

    // Default Inspector Reference (clean wrapped bullets, hides [T] Drill once past Wave 1 Prep / 1+ turret!)
    ctx.textAlign = 'left';
    ctx.font = font('head', 14, s);
    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.fillText('UNIT INSPECTOR // QUICK GUIDE', x + 10, y + 20);

    const showDrillShortcut =
      sim.trainingMode ||
      (sim.waveNumber === 1 && sim.phase === 'TACTICAL_PREP' && sim.turrets.length === 0);
    const footerBtnH = 28;
    const qBtnY = y + h - footerBtnH - 8;

    ctx.font = font('micro', 12, s);
    const guideItems = [
      'Click any placed turret or Blast Door to upgrade, rotate, power [K], or scrap [DEL].',
      'Upgrade MK-II [U], then press [A] or [B] for MK-III specializations.',
      'Hold SHIFT + [1-8] to multi-deploy; press [SPACE] mid-wave to Tactical Pause.',
      'Protocol Draft every 3 waves — press [SPACE] in Draft to peek at your map!',
    ];
    let gy = y + 40;
    for (let i = 0; i < guideItems.length; i++) {
      ctx.fillStyle = i % 2 === 1 ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT;
      const lines = wrapTextLines(ctx, `• ${guideItems[i]}`, w - 20, 2);
      for (const ln of lines) {
        if (gy > qBtnY - 12) break;
        ctx.fillText(ln, x + 10, gy);
        gy += 16;
      }
      gy += 3;
    }

    // Footer buttons inside Inspector (hides [T] Drill once past Wave 1 Prep or 1+ turret placed!)
    const qGap = 6;
    const quickItems: Array<{ id: string; label: string; accent: string }> = showDrillShortcut
      ? [
          { id: 'perim-wiki-open', label: '[H] FIELD MANUAL', accent: THEME.ACCENT_CYAN },
          {
            id: sim.trainingMode ? 'perim-drill-exit' : 'perim-drill-start',
            label: sim.trainingMode ? 'EXIT SIM DRILL' : '[T] 4-STAGE DRILL',
            accent: THEME.ACCENT_AMBER,
          },
        ]
      : [{ id: 'perim-wiki-open', label: `${SEMIOTIC_ICONS.DIAMOND} OPEN FULL FIELD MANUAL [H]`, accent: THEME.ACCENT_CYAN }];

    const qBtnW =
      quickItems.length === 1 ? w - 20 : (w - 20 - qGap) * 0.5;

    quickItems.forEach((q, qi) => {
      const qx = x + 10 + qi * (qBtnW + qGap);
      const qHov = hoveredButtonId === q.id;
      this.buttons.push({
        id: q.id,
        rect: {
          x: panelScreenRect.x + qx * s,
          y: panelScreenRect.y + qBtnY * s,
          width: qBtnW * s,
          height: footerBtnH * s,
        },
        label: q.label,
      });
      ctx.fillStyle = qHov ? 'rgba(76, 238, 255, 0.24)' : 'rgba(6, 20, 14, 0.94)';
      ctx.fillRect(qx, qBtnY, qBtnW, footerBtnH);
      ctx.strokeStyle = qHov ? '#FFFFFF' : q.accent;
      ctx.lineWidth = qHov ? 1.9 : 1.4;
      ctx.strokeRect(qx, qBtnY, qBtnW, footerBtnH);
      ctx.textAlign = 'center';
      ctx.font = font('micro', 12, s);
      ctx.fillStyle = qHov ? '#FFFFFF' : q.accent;
      drawEllipsizedText(ctx, q.label, qx + qBtnW * 0.5, qBtnY + 18, qBtnW - 8);
    });
  }

  // ===========================================================================
  // BOTTOM TYPEWRITER STREAM: MU-TH-UR 6000 EVENT LOG
  // ===========================================================================

  private drawBottomEventLog(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams,
    layout: PerimeterLayout
  ): void {
    const { bottomLog: r } = layout;
    const { sim, timeSec } = params;

    ctx.save();
    ctx.fillStyle = 'rgba(3, 9, 5, 0.94)';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    drawCornerBrackets(ctx, r.x, r.y, r.width, r.height, 10, THEME.BORDER_SUBTLE, 1.6);

    const recent = sim.eventLogs.slice(-2);
    const fontPx = Math.max(12, Math.min(13, Math.floor(r.height / 3.4)));
    ctx.font = font('data', fontPx);
    ctx.textAlign = 'left';

    const rowGap = Math.max(17, Math.round(r.height * 0.44));
    const baseY =
      recent.length <= 1
        ? r.y + Math.round(r.height * 0.62)
        : r.y + Math.round(r.height * 0.39);

    recent.forEach((entry, idx) => {
      const isLatest = idx === recent.length - 1;
      const ly = baseY + idx * rowGap;
      const isAlert =
        entry.includes('CRITICAL') ||
        entry.includes('BREACH') ||
        entry.includes('BLACKOUT') ||
        entry.includes('OVERLOAD') ||
        entry.includes('DRY') ||
        entry.includes('THERMAL') ||
        entry.includes('ACID');
      const isCombo =
        entry.includes('SHATTER') ||
        entry.includes('STERILIZED') ||
        entry.includes('DECOMPRESSION');

      ctx.fillStyle = isAlert
        ? THEME.ACCENT_AMBER_HI
        : isCombo
          ? THEME.TEXT_PRIMARY
          : isLatest
            ? THEME.TEXT_BRIGHT
            : THEME.TEXT_SECONDARY;

      const drawnW = drawEllipsizedText(ctx, entry, r.x + 12, ly, r.width - 30);

      if (isLatest && Math.sin(timeSec * 10) > 0) {
        ctx.fillStyle = THEME.TEXT_PRIMARY;
        ctx.fillRect(r.x + 15 + drawnW, ly - fontPx + 2, 8, fontPx);
      }
    });

    ctx.restore();
  }

  // ===========================================================================
  // SHARED CHROME MODALS (ALL ROUTE THROUGH ModalFrame -> ZERO CLICK LEAKS!)
  // ===========================================================================

  private drawPerimeterSystemMenu(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams
  ): void {
    const { sim } = params;
    const extraRows: SystemMenuExtraRow[] = [
      {
        id: 'perim-wiki-open',
        label: '[H] FULL FIELD MANUAL',
        value: 'OPEN WIKI DATABASE',
        accent: 'cyan',
      },
      {
        id: sim.trainingMode ? 'perim-drill-to-menu' : 'perim-drill-start',
        label: sim.trainingMode ? 'EXIT TRAINING DRILL' : '[T] TRAINING DRILL',
        value: sim.trainingMode ? 'RETURN TO MAIN MENU' : '4-STAGE CORE DRILL',
        accent: 'amber',
      },
    ];

    drawSystemMenuModal(
      ctx,
      params.width,
      params.height,
      {
        programTitle: "HADLEY'S PERIMETER",
        activeProgramId: 'perimeter',
        crtPreset: params.crtPreset,
        phosphorTheme: params.phosphorTheme,
        masterVolume: params.masterVolume,
        audioMuted: params.audioMuted,
        isFullscreen: params.isFullscreen,
        hoveredButtonId: params.hoveredButtonId,
        extraRows,
        canRestart: true,
        restartLabel: `${SEMIOTIC_ICONS.REPLAY} RESTART WAVE 01`,
        leaderboardLabel: `${SEMIOTIC_ICONS.STAR} LEADERBOARD`,
        confirmExitPending: params.confirmExitPending,
      },
      this.buttons
    );
  }

  private drawPerimeterControlsCard(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams
  ): void {
    const spec: ControlsCardSpec = {
      programTitle: "HADLEY'S PERIMETER",
      subtitle: 'SIMULATION PAUSED — [W] OPEN FULL WIKI · [H / ESC] RESUME',
      leftColumnTitle: 'BUILD, AIM & TURRET OPS',
      rightColumnTitle: 'ABILITIES, PAUSE & SYSTEM',
      leftControls: [
        { keys: '1–8', action: 'Select hardware (SHIFT+Click multi-deploy)' },
        { keys: 'DRAG', action: 'Place & aim cone (SHIFT+Drag re-aims)' },
        { keys: 'R', action: 'Rotate selected turret +45° / Reroll Draft' },
        { keys: 'E', action: 'Rearm selected Sentry (or Rearm ALL)' },
        { keys: 'U / A / B', action: 'Upgrade MK-II/IV · Pick MK-III A/B' },
        { keys: 'K / DEL', action: 'Toggle turret Power / Scrap unit (65%)' },
      ],
      rightControls: [
        { keys: 'F / O / V', action: 'Flare / Overclock (2×O) / Airlock Purge' },
        { keys: 'L / C / X', action: 'Floodlight (40% Bat) / Flush / Shed Aux' },
        { keys: 'SPACE', action: 'Tactical Pause (Wave) / Peek Map (Draft)' },
        { keys: 'ENTER / Z', action: 'Launch Wave (Prep) / Toggle 2X Speed' },
        { keys: 'P / M', action: 'Amber Pause Banner / Mute Audio' },
        { keys: 'ESC / H', action: 'Cancel tool → System Menu / Controls' },
      ],
      coreRules: [
        'Hold the Reactor Core (3 Seals): optical light (M314, Flare, Floodlight) unlocks 100% turret range, +20% crit, and reveals Stalkers.',
        'Flawless waves build a Streak Multiplier up to 2.50x; Blast Doors shape tempo while Sappers & Heavies batter sealed chokes.',
        'Defend dynamic Hull Breaches on W5/15/25 and Boss Sector Extractions on W11/21/31 (100% turret Scrap auto-refunded!).',
      ],
      hoveredButtonId: params.hoveredButtonId,
      wikiButtonLabel: 'OPEN FULL WIKI [W]',
      wikiButtonId: CONTROLS_CARD_IDS.OPEN_WIKI,
      closeButtonId: CONTROLS_CARD_IDS.CLOSE,
    };

    drawControlsCardModal(ctx, params.width, params.height, spec, this.buttons);
  }

  private drawUnifiedDebrief(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams
  ): void {
    const { sim } = params;
    const stats: DebriefStatCard[] = [
      { label: 'FINAL SCORE', value: sim.score.toLocaleString(), accent: 'amber' },
      { label: 'WAVE REACHED', value: `W-${String(sim.waveNumber).padStart(2, '0')}`, accent: 'cyan' },
      { label: 'HOSTILES SLAIN', value: String(sim.totalKills), accent: 'green' },
      { label: 'FINAL SECTOR', value: sim.blueprint.sectorId, accent: 'green' },
    ];

    drawGameOverDebriefModal(
      ctx,
      params.width,
      params.height,
      {
        title: 'CORE BREACHED // PERIMETER OVERRUN',
        subtitle: 'ALL 3 REACTOR BULKHEAD SEALS LOST — ENDLESS HIVE SIEGE DEBRIEF',
        outcomeTone: 'red',
        timeSec: params.timeSec,
        keylockRemainingSec: params.postRunKeylockSec,
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
        submitLabel: `${SEMIOTIC_ICONS.PLAY} TRANSMIT SCORE [ENTER]`,
      },
      this.buttons
    );
  }

  private drawPerimeterManifest(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams
  ): void {
    const { manifest, lastSubmittedRun, sim } = params;
    const { entries, showingArchiveFallback } = manifest.getManifestEntries();
    const rawStatus = manifest.getStatus();
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
            e.waves === lastSubmittedRun.waves
        );
      }
    }

    const rows: ManifestRowData[] = entries.slice(0, 12).map((e, idx) => ({
      rank: idx + 1,
      callsign: e.callsign,
      score: e.score,
      stats: [`W-${String(e.waves).padStart(2, '0')}`, String(e.kills)],
      isJustAdded: idx === matchedJustIdx,
      isLocalFallback: showingArchiveFallback,
    }));

    const dispRank =
      lastSubmittedRun && matchedJustIdx >= 0
        ? matchedJustIdx + 1
        : lastSubmittedRun?.rank ?? 1;
    const justAddedBanner = lastSubmittedRun
      ? `${SEMIOTIC_ICONS.STAR} LOGGED RUN: RANK #${String(dispRank).padStart(2, '0')} — ${lastSubmittedRun.callsign} // ${lastSubmittedRun.score.toLocaleString()} PTS (W-${String(lastSubmittedRun.waves).padStart(2, '0')})`
      : null;

    const isPostRun =
      sim.phase === 'CORE_BREACHED' || sim.phase === 'CALLSIGN_ENTRY' || Boolean(lastSubmittedRun);

    drawGlobalManifestModal(
      ctx,
      params.width,
      params.height,
      {
        title: "HADLEY'S PERIMETER // LEADERBOARD",
        uplinkStatus,
        timeSec: params.timeSec,
        columns: [
          { header: 'WAVE', widthFrac: 0.5, align: 'center' },
          { header: 'KILLS', widthFrac: 0.5, align: 'right' },
        ],
        rows,
        justAddedBanner,
        showPlayAgain: isPostRun,
        playAgainLabel: `${SEMIOTIC_ICONS.PLAY} PLAY AGAIN [R / ENTER]`,
        closeLabel: '[ESC] CLOSE',
        hoveredButtonId: params.hoveredButtonId,
      },
      this.buttons
    );
  }

  /**
   * 70% Briefing Diet — routed through ModalFrame (dimmed scrim + buttons cleared!).
   * 3 punchy Sentence-Case lines (Objective, Core Controls, Sector Evolution) + 3 clean CTAs.
   * Never re-shown on Replay!
   */
  private drawBriefingOverlay(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams
  ): void {
    const { width: w, height: h, hoveredButtonId } = params;
    const metrics = drawModalFrame(
      ctx,
      w,
      h,
      {
        title: "HADLEY'S PERIMETER // ENDLESS HIVE SIEGE",
        subtitle: 'USCM COLONY PERIMETER DEFENSE — SEC-01 MED-LAB',
        maxWidth: 740,
        maxHeight: 468,
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
      '★ RANKED ENDLESS HIVE SIEGE ARMED — TELEMETRY SYNCED TO ORBITAL RELAY ★',
      params.timeSec,
      true
    );
    curY += 32;

    // Live #01 Global Leader Ticker (diegetic copy — zero backend/collection leaks!)
    const leader = params.manifest.getReigningLeader();
    const uplink = params.manifest.getStatus();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = font('data', 12);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    const leadBanner = leader
      ? `#01 GLOBAL LEADER: ${leader.callsign} — ${leader.score.toLocaleString()} PTS (W-${String(leader.waves).padStart(2, '0')} · ${leader.kills} KILLS)`
      : uplink === 'LOADING'
        ? 'SYNCING ORBITAL RELAY LEADERBOARD...'
        : '#01 GLOBAL LEADER: UNCLAIMED — DEFEND THE COLONY REACTOR CORE';
    drawEllipsizedText(ctx, leadBanner, contentX + contentW * 0.5, curY + 10, contentW - 8);
    ctx.restore();
    curY += 24;

    // Primary + Secondary CTA anchors (computed early so cards never collide vertically)
    const secH = 36;
    const priH = 40;
    const priY = footerY - priH - 6;

    // 3 Punchy Sentence-Case Briefing Cards (100% wrapped via wrapTextLines in matching font!)
    const pillars: Array<{ tag: string; accent: string; body: string }> = [
      {
        tag: 'OBJECTIVE',
        accent: THEME.TEXT_PRIMARY,
        body: 'Protect the central Reactor Core and its 3 Bulkhead Seals from endless Xenomorph waves. Flawless waves build up to a 2.50x Score Streak.',
      },
      {
        tag: 'CORE CONTROLS',
        accent: THEME.ACCENT_AMBER_HI,
        body: 'Deploy ordnance [1-8] and drag to aim down open hallways, [E] to rearm Sentries, [SPACE] for Tactical Pause mid-wave, and [H] anytime for Controls.',
      },
      {
        tag: 'SECTOR EVOLUTION',
        accent: THEME.ACCENT_CYAN,
        body: 'Defend telegraphed Hull Breaches on W5/15/25 and extract to new sectors after Boss waves (W11/21/31) with 100% turret Scrap refunded.',
      },
    ];

    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = font('prose', 13);
    const wrappedPillars = pillars.map((p) => ({
      ...p,
      lines: wrapTextLines(ctx, p.body, contentW - 24, 4),
    }));

    const availCardsH = Math.max(150, priY - 10 - curY);
    const totalLines = wrappedPillars.reduce((sum, p) => sum + p.lines.length, 0);
    const cardGap = 7;
    const headerRowH = 18;
    const padV = 10;
    const compact =
      totalLines * 18 + wrappedPillars.length * (headerRowH + padV) + cardGap * 2 > availCardsH;
    const lineH = compact ? 16 : 18;
    const topOffset = compact ? 15 : 17;
    const blockPadBottom = compact ? 7 : 9;

    for (const p of wrappedPillars) {
      const blockH = topOffset + 4 + p.lines.length * lineH + blockPadBottom;

      ctx.fillStyle = THEME.BG_ROW_ALT;
      ctx.fillRect(contentX, curY, contentW, blockH);
      ctx.fillStyle = p.accent;
      ctx.fillRect(contentX, curY, 4, blockH);

      // Colored monospace pillar header on its own clean row (zero font-mismatch overhang!)
      ctx.font = font('micro', 12);
      ctx.fillStyle = p.accent;
      ctx.fillText(p.tag, contentX + 12, curY + topOffset);

      // Wrapped prose body in exact font measured by wrapTextLines()
      ctx.font = font('prose', 13);
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      p.lines.forEach((ln, li) => {
        ctx.fillText(ln, contentX + 12, curY + topOffset + 4 + (li + 1) * lineH);
      });

      curY += blockH + cardGap;
    }
    ctx.restore();

    drawChromeButton(
      ctx,
      { x: contentX, y: priY, width: contentW, height: priH },
      `${SEMIOTIC_ICONS.PLAY} DEPLOY WAVE 01 [ENTER]`,
      {
        id: 'briefing-engage',
        accent: 'amber',
        active: true,
        hovered: hoveredButtonId === 'briefing-engage',
        fontPx: 15,
      },
      this.buttons
    );

    const gap = 8;
    const thirdW = Math.floor((contentW - gap * 2) / 3);
    drawChromeButton(
      ctx,
      { x: contentX, y: footerY, width: thirdW, height: secH },
      'INTERACTIVE DRILL [T]',
      {
        id: 'perim-drill-start',
        accent: 'cyan',
        hovered: hoveredButtonId === 'perim-drill-start',
        fontPx: 13,
      },
      this.buttons
    );
    drawChromeButton(
      ctx,
      { x: contentX + thirdW + gap, y: footerY, width: thirdW, height: secH },
      `${SEMIOTIC_ICONS.STAR} LEADERBOARD`,
      {
        id: 'perim-manifest',
        accent: 'amber',
        hovered: hoveredButtonId === 'perim-manifest',
        fontPx: 13,
      },
      this.buttons
    );
    drawChromeButton(
      ctx,
      { x: contentX + (thirdW + gap) * 2, y: footerY, width: contentW - (thirdW + gap) * 2, height: secH },
      'FIELD MANUAL [H]',
      {
        id: 'perim-wiki-open',
        accent: 'green',
        hovered: hoveredButtonId === 'perim-wiki-open',
        fontPx: 13,
      },
      this.buttons
    );
  }

  /**
   * Floating banner displayed when [SPACE] PEEK MAP is active inside PROTOCOL_DRAFT,
   * letting players inspect turrets, kW, and lanes before returning to pick a directive.
   */
  private drawProtocolPeekBar(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams,
    bpVp: ViewportRect
  ): void {
    const barW = Math.min(540, bpVp.width - 20);
    const barH = 42;
    const bx = Math.round(bpVp.x + (bpVp.width - barW) * 0.5);
    const by = bpVp.y + bpVp.height - barH - 12;

    // Isolate clicks to return-to-draft button, TopChromeBar, and rack turret selection (blocks accidental build/launch!)
    this.buttons = this.buttons.filter(
      (b) => b.id.startsWith('chrome-') || b.id.startsWith('rack-select-')
    );
    drawChromeButton(
      ctx,
      { x: bx, y: by, width: barW, height: barH },
      `${SEMIOTIC_ICONS.PLAY} [SPACE] RETURN TO PROTOCOL DRAFT · [H] CONTROLS`,
      {
        id: 'proto-peek-toggle',
        accent: 'amber',
        active: true,
        hovered: params.hoveredButtonId === 'proto-peek-toggle',
        fontPx: 14,
      },
      this.buttons
    );
  }

  private drawProtocolDraftModal(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams
  ): void {
    const { width: w, height: h, sim, hoveredButtonId } = params;
    const isOmega = sim.draftMode === 'OMEGA';

    const metrics = drawModalFrame(
      ctx,
      w,
      h,
      {
        title: isOmega
          ? 'MU-TH-UR // BOSS-MILESTONE OMEGA DIRECTIVE'
          : 'MU-TH-UR 6000 // TACTICAL PROTOCOL DRAFT',
        subtitle: isOmega
          ? `BOSS WAVE ${String(Math.max(1, sim.waveNumber - 1)).padStart(2, '0')} CLEARED — CHOOSE [1 / 2 / 3] · [SPACE] PEEK MAP · [H] CONTROLS`
          : `WAVE ${String(Math.max(1, sim.waveNumber - 1)).padStart(2, '0')} CLEARED — INSTALL [1 / 2 / 3] · [SPACE] PEEK MAP · [H] CONTROLS`,
        maxWidth: 880,
        maxHeight: 500,
        accentColor: isOmega ? THEME.ALERT_RED_STROKE : THEME.ACCENT_CYAN,
        rightBadge: {
          text: isOmega ? 'Ω OMEGA TRADE-OFF' : `${SEMIOTIC_ICONS.DIAMOND} PROTOCOL DRAFT`,
          tone: isOmega ? 'red' : 'cyan',
        },
      },
      this.buttons
    );

    const { contentX, contentY, contentW, footerY } = metrics;
    const cardGap = 12;
    const cardY = contentY;
    const actionBarY = footerY - 38;
    const cardH = Math.max(210, actionBarY - cardY - 12);

    if (isOmega) {
      const omegaChoices = sim.omegaDraftChoices;
      const count = Math.max(1, omegaChoices.length);
      const cardW = (contentW - cardGap * (count - 1)) / count;

      omegaChoices.forEach((omegaId: OmegaDirectiveId, idx: number) => {
        const spec = OMEGA_DIRECTIVES[omegaId];
        const cx = contentX + idx * (cardW + cardGap);
        const btnId = `proto-${idx}`;
        const hov = hoveredButtonId === btnId;

        this.buttons.push({
          id: btnId,
          rect: { x: cx, y: cardY, width: cardW, height: cardH },
          label: spec.title,
        });

        ctx.save();
        ctx.fillStyle = hov ? 'rgba(255, 110, 32, 0.22)' : 'rgba(24, 10, 6, 0.96)';
        ctx.fillRect(cx, cardY, cardW, cardH);
        ctx.strokeStyle = hov ? '#FFFFFF' : spec.accent;
        ctx.lineWidth = hov ? 2.6 : 2.0;
        ctx.strokeRect(cx, cardY, cardW, cardH);

        // Top badge
        ctx.fillStyle = 'rgba(48, 12, 6, 0.85)';
        ctx.fillRect(cx + 10, cardY + 10, cardW - 20, 26);
        ctx.strokeStyle = spec.accent;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(cx + 10, cardY + 10, cardW - 20, 26);

        ctx.textAlign = 'left';
        ctx.font = font('button', 13);
        ctx.fillStyle = THEME.ACCENT_AMBER_HI;
        ctx.fillText(`[${idx + 1}] ${spec.code}`, cx + 16, cardY + 28);

        ctx.textAlign = 'right';
        ctx.font = font('micro', 12);
        ctx.fillStyle = THEME.ALERT_RED_TEXT;
        ctx.fillText('Ω OMEGA', cx + cardW - 16, cardY + 27);

        // Wrapped Title
        ctx.textAlign = 'center';
        ctx.font = font('head', 15);
        ctx.fillStyle = hov ? '#FFFFFF' : spec.accent;
        const titleLines = wrapTextLines(ctx, spec.title, cardW - 22, 2);
        titleLines.forEach((tl, ti) => {
          ctx.fillText(tl, cx + cardW * 0.5, cardY + 56 + ti * 19);
        });

        // Explicit Wrapped UPSIDE Box
        const boxPadX = cx + 10;
        const boxInnerW = cardW - 20;
        const upY = cardY + 86;
        const upH = Math.floor((cardH - 134) * 0.52);
        ctx.fillStyle = 'rgba(10, 42, 22, 0.78)';
        ctx.fillRect(boxPadX, upY, boxInnerW, upH);
        ctx.strokeStyle = THEME.TEXT_PRIMARY;
        ctx.lineWidth = 1.3;
        ctx.strokeRect(boxPadX, upY, boxInnerW, upH);
        ctx.textAlign = 'left';
        ctx.font = font('micro', 12);
        ctx.fillStyle = THEME.TEXT_PRIMARY;
        ctx.fillText('▲ UPSIDE / GAIN', boxPadX + 8, upY + 16);
        ctx.fillStyle = THEME.TEXT_BRIGHT;
        const upLines = wrapTextLines(ctx, spec.upside, boxInnerW - 16, 3);
        upLines.forEach((ln, li) => {
          const ly = upY + 34 + li * 16;
          if (ly <= upY + upH - 5) ctx.fillText(ln, boxPadX + 8, ly);
        });

        // Explicit Wrapped DOWNSIDE / TRADE-OFF Box (ZERO fillText maxWidth squashing!)
        const dnY = upY + upH + 8;
        const dnH = Math.max(54, cardY + cardH - 42 - dnY);
        ctx.fillStyle = 'rgba(56, 12, 10, 0.82)';
        ctx.fillRect(boxPadX, dnY, boxInnerW, dnH);
        ctx.strokeStyle = THEME.ALERT_RED_STROKE;
        ctx.lineWidth = 1.3;
        ctx.strokeRect(boxPadX, dnY, boxInnerW, dnH);
        ctx.textAlign = 'left';
        ctx.font = font('micro', 12);
        ctx.fillStyle = THEME.ALERT_RED_TEXT;
        ctx.fillText('▼ TRADE-OFF / RISK', boxPadX + 8, dnY + 16);
        ctx.fillStyle = '#FFD4CC';
        const dnLines = wrapTextLines(ctx, spec.downside, boxInnerW - 16, 3);
        dnLines.forEach((ln, li) => {
          const ly = dnY + 34 + li * 16;
          if (ly <= dnY + dnH - 5) ctx.fillText(ln, boxPadX + 8, ly);
        });

        // Bottom Lock Bar
        const actY = cardY + cardH - 34;
        ctx.fillStyle = hov ? spec.accent : 'rgba(56, 20, 10, 0.94)';
        ctx.fillRect(cx + 10, actY, cardW - 20, 26);
        ctx.strokeStyle = spec.accent;
        ctx.lineWidth = 1.4;
        ctx.strokeRect(cx + 10, actY, cardW - 20, 26);
        ctx.textAlign = 'center';
        ctx.font = font('button', 13);
        ctx.fillStyle = hov ? THEME.INK_INVERSE : THEME.ACCENT_AMBER_HI;
        ctx.fillText(`► LOCK OMEGA [${idx + 1}]`, cx + cardW * 0.5, actY + 18);
        ctx.restore();
      });
    } else {
      const choices = sim.protocolDraftChoices;
      const count = Math.max(1, choices.length);
      const cardW = (contentW - cardGap * (count - 1)) / count;

      choices.forEach((choiceId, idx) => {
        const isEndgame = choiceId in ENDGAME_DIRECTIVES;
        const spec = isEndgame
          ? ENDGAME_DIRECTIVES[choiceId as EndgameDirectiveId]
          : TACTICAL_PROTOCOLS[choiceId as ProtocolId];
        const cx = contentX + idx * (cardW + cardGap);
        const btnId = `proto-${idx}`;
        const hov = hoveredButtonId === btnId;

        const levelTag = isEndgame
          ? (() => {
              const st = sim.getEndgameStacks(choiceId as EndgameDirectiveId);
              return st > 0 ? `END ×${st + 1}` : 'ENDGAME';
            })()
          : (() => {
              const protoSpec = TACTICAL_PROTOCOLS[choiceId as ProtocolId];
              const curStacks = sim.getProtocolStacks(choiceId as ProtocolId);
              return curStacks > 0 ? `LVL ${curStacks + 1}/${protoSpec.maxStacks}` : 'NEW';
            })();

        this.buttons.push({
          id: btnId,
          rect: { x: cx, y: cardY, width: cardW, height: cardH },
          label: spec.title,
        });

        ctx.save();
        ctx.fillStyle = hov
          ? isEndgame
            ? 'rgba(255, 196, 42, 0.18)'
            : 'rgba(76, 238, 255, 0.16)'
          : isEndgame
            ? 'rgba(22, 18, 6, 0.95)'
            : 'rgba(6, 20, 14, 0.95)';
        ctx.fillRect(cx, cardY, cardW, cardH);
        ctx.strokeStyle = hov ? '#FFFFFF' : spec.accent;
        ctx.lineWidth = hov ? 2.6 : 1.9;
        ctx.strokeRect(cx, cardY, cardW, cardH);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(cx + 10, cardY + 10, cardW - 20, 26);
        ctx.strokeStyle = spec.accent;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(cx + 10, cardY + 10, cardW - 20, 26);

        ctx.textAlign = 'left';
        ctx.font = font('button', 13);
        ctx.fillStyle = THEME.ACCENT_AMBER_HI;
        ctx.fillText(`[${idx + 1}] ${spec.code}`, cx + 16, cardY + 28);

        ctx.textAlign = 'right';
        ctx.font = font('micro', 12);
        ctx.fillStyle = isEndgame
          ? THEME.ACCENT_AMBER_HI
          : levelTag.startsWith('LVL')
            ? THEME.ACCENT_CYAN
            : THEME.TEXT_BRIGHT;
        ctx.fillText(levelTag, cx + cardW - 16, cardY + 27);

        // Wrapped Title
        ctx.textAlign = 'center';
        ctx.font = font('head', 15);
        ctx.fillStyle = hov ? '#FFFFFF' : spec.accent;
        const titleLines = wrapTextLines(ctx, spec.title, cardW - 22, 2);
        titleLines.forEach((tl, ti) => {
          ctx.fillText(tl, cx + cardW * 0.5, cardY + 60 + ti * 20);
        });

        // Wrapped Description Lines (ZERO horizontal squashing!)
        ctx.textAlign = 'left';
        ctx.font = font('prose', 13);
        ctx.fillStyle = THEME.TEXT_BRIGHT;
        const parts = spec.desc.split(' · ');
        let descY = cardY + 108;
        for (const part of parts) {
          const wrapped = wrapTextLines(ctx, `• ${part}`, cardW - 24, 2);
          for (const wl of wrapped) {
            if (descY > cardY + cardH - 44) break;
            ctx.fillText(wl, cx + 12, descY);
            descY += 18;
          }
          descY += 3;
        }

        // Bottom Install Bar
        const actY = cardY + cardH - 36;
        ctx.fillStyle = hov ? spec.accent : 'rgba(18, 42, 28, 0.92)';
        ctx.fillRect(cx + 10, actY, cardW - 20, 28);
        ctx.strokeStyle = spec.accent;
        ctx.lineWidth = 1.4;
        ctx.strokeRect(cx + 10, actY, cardW - 20, 28);
        ctx.textAlign = 'center';
        ctx.font = font('button', 13);
        ctx.fillStyle = hov ? THEME.INK_INVERSE : '#FFFFFF';
        ctx.fillText(
          isEndgame ? `► EXECUTE [${idx + 1}]` : `► INSTALL [${idx + 1}]`,
          cx + cardW * 0.5,
          actY + 19
        );
        ctx.restore();
      });
    }

    // Bottom Controls Strip inside Protocol Draft: [R] REROLL | [SPACE] PEEK MAP | [H] CONTROLS
    const rerollCost = sim.getProtocolRerollCost();
    const omegaExhausted =
      isOmega &&
      (Object.keys(OMEGA_DIRECTIVES) as OmegaDirectiveId[]).filter(
        (id) => !sim.activeOmegas.includes(id)
      ).length <= sim.omegaDraftChoices.length;
    const canReroll = !omegaExhausted && (rerollCost === 0 || sim.scrap >= rerollCost);
    const rerollLabel = omegaExhausted
      ? 'ALL OMEGAS SHOWN'
      : rerollCost === 0
        ? `↻ REROLL [R] — FREE (${sim.freeDraftRerollsRemaining}) · ${sim.scrap}S`
        : `↻ REROLL [R] — ${rerollCost}S (SCRAP: ${sim.scrap}S)`;

    const btnGap = 10;
    const peekW = 190;
    const helpW = 148;
    const rerollW = Math.max(180, contentW - peekW - helpW - btnGap * 2);

    drawChromeButton(
      ctx,
      { x: contentX, y: actionBarY, width: rerollW, height: 34 },
      rerollLabel,
      {
        id: 'proto-reroll',
        accent: !canReroll ? 'red' : rerollCost === 0 ? 'green' : 'amber',
        disabled: !canReroll,
        hovered: hoveredButtonId === 'proto-reroll',
        fontPx: 13,
      },
      this.buttons
    );

    drawChromeButton(
      ctx,
      { x: contentX + rerollW + btnGap, y: actionBarY, width: peekW, height: 34 },
      '[SPACE] PEEK MAP',
      {
        id: 'proto-peek-toggle',
        accent: 'amber',
        hovered: hoveredButtonId === 'proto-peek-toggle',
        fontPx: 13,
      },
      this.buttons
    );

    drawChromeButton(
      ctx,
      { x: contentX + rerollW + peekW + btnGap * 2, y: actionBarY, width: helpW, height: 34 },
      '[H] CONTROLS',
      {
        id: 'controls-open-quick',
        accent: 'cyan',
        hovered: hoveredButtonId === 'controls-open-quick',
        fontPx: 13,
      },
      this.buttons
    );

    // Installed Directives Footer Summary
    const installedList = Object.entries(sim.activeProtocols)
      .filter(([, cnt]) => (cnt ?? 0) > 0)
      .map(([k, cnt]) => {
        const p = TACTICAL_PROTOCOLS[k as ProtocolId];
        return p ? `${p.code}${cnt && cnt > 1 ? `×${cnt}` : ''}` : k;
      });
    for (const om of sim.activeOmegas) {
      const oSpec = OMEGA_DIRECTIVES[om];
      if (oSpec) installedList.push(oSpec.code);
    }
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = font('micro', 12);
    ctx.fillStyle = isOmega ? THEME.ACCENT_AMBER_HI : THEME.TEXT_SECONDARY;
    drawEllipsizedText(
      ctx,
      installedList.length > 0
        ? `INSTALLED: ${installedList.join(' | ')}`
        : 'FIRST TACTICAL DIRECTIVE OF THIS DEPLOYMENT',
      contentX + contentW * 0.5,
      footerY + 20,
      contentW - 12
    );
    ctx.restore();
  }

  // ===========================================================================
  // TRAINING DRILL OVERLAYS (WRAPPED BANNER + MODAL-FRAME 2-TIER GRADUATION)
  // ===========================================================================

  private drawTutorialButtonHighlights(
    ctx: CanvasRenderingContext2D,
    highlightIds: string[],
    timeSec: number
  ): void {
    const pulse = 0.55 + 0.45 * Math.sin(timeSec * 8.5);
    ctx.save();
    for (const id of highlightIds) {
      const btn = this.buttons.find((b) => b.id === id);
      if (!btn) continue;
      const r = btn.rect;
      ctx.strokeStyle = `rgba(76, 238, 255, ${(0.55 + pulse * 0.45).toFixed(2)})`;
      ctx.lineWidth = 2.8;
      ctx.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4);
      ctx.fillStyle = `rgba(76, 238, 255, ${(0.08 + pulse * 0.12).toFixed(3)})`;
      ctx.fillRect(r.x, r.y, r.width, r.height);
    }
    ctx.restore();
  }

  private drawTutorialDirectiveBanner(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams,
    bpVp: ViewportRect
  ): void {
    const dir = params.tutorialDirective;
    const { hoveredButtonId } = params;

    const cardW = Math.min(820, bpVp.width - 14);
    const textMaxW = cardW - 28;

    // Pre-wrap coaching lines & objectives cleanly using wrapTextLines() (ZERO fillText maxWidth squashing!)
    ctx.save();
    ctx.font = font('prose', 13);
    const wrappedBriefing: Array<{ text: string; color: string }> = [];
    dir.briefingLines.forEach((line, idx) => {
      const col = idx === 0 ? THEME.TEXT_BRIGHT : THEME.ACCENT_AMBER_HI;
      const wrapped = wrapTextLines(ctx, line, textMaxW, 2);
      for (const wLine of wrapped) {
        wrappedBriefing.push({ text: wLine, color: col });
      }
    });

    ctx.font = font('micro', 12);
    const wrappedObjs: Array<{ text: string; done: boolean }> = [];
    for (const obj of dir.objectives) {
      const mark = obj.done ? '[✓]' : '[ ]';
      const wLines = wrapTextLines(ctx, `${mark} ${obj.text}`, textMaxW - 4, 2);
      for (const wl of wLines) {
        wrappedObjs.push({ text: wl, done: obj.done });
      }
    }

    const headerH = 30;
    const cardH = Math.min(
      Math.max(118, bpVp.height * 0.42),
      headerH + 14 + wrappedBriefing.length * 18 + 6 + wrappedObjs.length * 17 + 10
    );
    const cx = Math.round(bpVp.x + (bpVp.width - cardW) * 0.5);
    const cy = Math.round(bpVp.y + bpVp.height - cardH - 8);

    ctx.fillStyle = 'rgba(2, 11, 8, 0.95)';
    ctx.fillRect(cx, cy, cardW, cardH);
    drawCornerBrackets(ctx, cx, cy, cardW, cardH, 14, THEME.ACCENT_CYAN, 2.0);
    ctx.strokeStyle = 'rgba(76, 238, 255, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(cx + 1, cy + 1, cardW - 2, cardH - 2);

    // Header Bar
    ctx.fillStyle = 'rgba(6, 30, 34, 0.88)';
    ctx.fillRect(cx + 2, cy + 2, cardW - 4, headerH - 2);

    const btnY = cy + 4;
    const btnH = 22;
    const exitW = 58;
    const skipW = 86;
    const wikiW = 80;
    const bxExit = cx + cardW - exitW - 6;
    const bxSkip = bxExit - skipW - 5;
    const bxWiki = bxSkip - wikiW - 5;

    ctx.textAlign = 'left';
    ctx.font = font('head', 13);
    ctx.fillStyle = THEME.ACCENT_CYAN;
    drawEllipsizedText(
      ctx,
      `${SEMIOTIC_ICONS.DIAMOND} ${dir.code} // ${dir.title}`,
      cx + 12,
      cy + 20,
      bxWiki - cx - 18
    );

    drawChromeButton(
      ctx,
      { x: bxWiki, y: btnY, width: wikiW, height: btnH },
      'WIKI [H]',
      { id: 'perim-drill-open-wiki', accent: 'green', hovered: hoveredButtonId === 'perim-drill-open-wiki', fontPx: 12 },
      this.buttons
    );
    drawChromeButton(
      ctx,
      { x: bxSkip, y: btnY, width: skipW, height: btnH },
      'SKIP STEP',
      { id: 'perim-drill-skip', accent: 'amber', hovered: hoveredButtonId === 'perim-drill-skip', fontPx: 12 },
      this.buttons
    );
    drawChromeButton(
      ctx,
      { x: bxExit, y: btnY, width: exitW, height: btnH },
      'EXIT',
      { id: 'perim-drill-exit', accent: 'red', hovered: hoveredButtonId === 'perim-drill-exit', fontPx: 12 },
      this.buttons
    );

    // Wrapped Coaching Lines
    let ty = cy + headerH + 16;
    ctx.textAlign = 'left';
    ctx.font = font('prose', 13);
    for (const item of wrappedBriefing) {
      if (ty > cy + cardH - 10) break;
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, cx + 12, ty);
      ty += 18;
    }

    // Wrapped Objectives Checklist
    ty += 4;
    ctx.font = font('micro', 12);
    for (const obj of wrappedObjs) {
      if (ty > cy + cardH - 6) break;
      ctx.fillStyle = obj.done ? THEME.TEXT_PRIMARY : THEME.ACCENT_CYAN;
      ctx.fillText(obj.text, cx + 14, ty);
      ty += 17;
    }

    ctx.restore();
  }

  /**
   * 2-Tier Graduation Modal routed through ModalFrame (dimmed scrim + buttons cleared!).
   * Stage 4 Core Graduation offers optional "Continue to Advanced Systems Lab [A]" CTA!
   */
  private drawTutorialGraduationModal(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams
  ): void {
    const { width: w, height: h, hoveredButtonId } = params;
    const dir = params.tutorialDirective;
    const showLabBtn = dir.canStartAdvancedLab;

    const metrics = drawModalFrame(
      ctx,
      w,
      h,
      {
        title: `${SEMIOTIC_ICONS.STAR} ${dir.title}`,
        subtitle: showLabBtn
          ? 'CORE MODULES 01–04 PASSED — CLEARED FOR RANKED SIEGE OR OPTIONAL ADVANCED LAB'
          : 'ALL ADVANCED SYSTEMS LAB MODULES PASSED — FULL COMMAND CLEARANCE GRANTED',
        maxWidth: 700,
        maxHeight: showLabBtn ? 378 : 326,
        accentColor: THEME.TEXT_PRIMARY,
        rightBadge: { text: dir.code, tone: 'live' },
      },
      this.buttons
    );

    const { contentX, contentY, contentW, footerY } = metrics;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = font('prose', 14);
    let ty = contentY + 14;
    dir.briefingLines.forEach((line, idx) => {
      ctx.fillStyle = idx === 0 ? THEME.TEXT_BRIGHT : THEME.ACCENT_AMBER_HI;
      const wrapped = wrapTextLines(ctx, line, contentW - 12, 3);
      for (const wl of wrapped) {
        ctx.fillText(wl, contentX + 6, ty);
        ty += 21;
      }
      ty += 8;
    });
    ctx.restore();

    const btnH = 38;
    const priY = showLabBtn ? footerY - 94 : footerY - 48;

    drawChromeButton(
      ctx,
      { x: contentX, y: priY, width: contentW, height: 42 },
      `${SEMIOTIC_ICONS.PLAY} LAUNCH RANKED ENDLESS HIVE SIEGE [ENTER]`,
      {
        id: 'perim-drill-exit',
        accent: 'amber',
        active: true,
        hovered: hoveredButtonId === 'perim-drill-exit',
        fontPx: 15,
      },
      this.buttons
    );

    if (showLabBtn) {
      drawChromeButton(
        ctx,
        { x: contentX, y: footerY - 46, width: contentW, height: btnH },
        `${SEMIOTIC_ICONS.DIAMOND} CONTINUE TO ADVANCED SYSTEMS LAB [A] (ARC COIL · MINE · FLUSH · PURGE)`,
        {
          id: 'perim-drill-advanced',
          accent: 'cyan',
          hovered: hoveredButtonId === 'perim-drill-advanced',
          fontPx: 13,
        },
        this.buttons
      );
    }

    const gap = 8;
    const thirdW = Math.floor((contentW - gap * 2) / 3);
    drawChromeButton(
      ctx,
      { x: contentX, y: footerY, width: thirdW, height: btnH },
      '◄ MAIN MENU',
      {
        id: 'perim-drill-to-menu',
        accent: 'amber',
        hovered: hoveredButtonId === 'perim-drill-to-menu',
        fontPx: 13,
      },
      this.buttons
    );
    drawChromeButton(
      ctx,
      { x: contentX + thirdW + gap, y: footerY, width: thirdW, height: btnH },
      'FIELD MANUAL [H]',
      {
        id: 'perim-wiki-open',
        accent: 'green',
        hovered: hoveredButtonId === 'perim-wiki-open',
        fontPx: 13,
      },
      this.buttons
    );
    drawChromeButton(
      ctx,
      { x: contentX + (thirdW + gap) * 2, y: footerY, width: contentW - (thirdW + gap) * 2, height: btnH },
      'REPLAY DRILL',
      {
        id: 'perim-drill-start',
        accent: 'muted',
        hovered: hoveredButtonId === 'perim-drill-start',
        fontPx: 13,
      },
      this.buttons
    );
  }
}
