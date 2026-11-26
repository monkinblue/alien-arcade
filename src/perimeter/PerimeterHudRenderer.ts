import { COLORS } from '../constants';
import type { CrtInteractiveButton } from '../render/HudRenderer';
import { drawRankedHudPill, drawRankedTitleRibbon } from '../render/RankedBadge';
import type { ViewportRect } from '../types';
import type { PerimeterManifest } from './PerimeterManifest';
import type { PerimeterSimulation } from './PerimeterSimulation';
import type { TutorialDirectiveSnapshot } from './PerimeterTutorialDirector';
import { PerimeterWikiRenderer } from './PerimeterWikiRenderer';
import {
  HARDWARE_SPECS,
  MK3_BRANCH_SPECS,
  PERIMETER_CONSTANTS,
  TACTICAL_PROTOCOLS,
  WAVE_MUTATORS,
  type ActiveCursorTool,
  type BuildToolId,
  type PerimeterLastSubmittedRun,
  type PlacedTurret,
} from './types';

export interface PerimeterLayout {
  hudScale: number;
  topBarH: number;
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
  osdMenuOpen: boolean;
  manifestOpen: boolean;
  wikiOpen: boolean;
  wikiChapterIdx: number;
  wikiScrollPx: number;
  tutorialDirective: TutorialDirectiveSnapshot;
  callsignDraft: string;
  scoreSubmitted: boolean;
  submittingScore: boolean;
  submitResultBanner: string | null;
  lastSubmittedRun: PerimeterLastSubmittedRun | null;
  statusToast: string | null;
}

export class PerimeterHudRenderer {
  public buttons: CrtInteractiveButton[] = [];
  private wikiRenderer = new PerimeterWikiRenderer();
  public wikiMaxScrollPx = 0;
  public wikiContentViewport: ViewportRect | null = null;
  public wikiScrollbarTrack: ViewportRect | null = null;

  public computeLayout(w: number, h: number): PerimeterLayout {
    const margin = Math.max(6, Math.round(w * 0.006));
    const topBarH = 46;
    // Widescreen CAD layout: slim sidebars (~34.5% combined width) give the 16:9 blueprint massive visual area!
    const baseLeftW = 274;
    const baseRightW = 368;
    const basePanelH = 744;

    const scaleW = (w * 0.382) / (baseLeftW + baseRightW);
    const scaleH = (h - topBarH - margin - 6) / basePanelH;
    const hudScale = Math.max(0.70, Math.min(1.18, Math.min(scaleW, scaleH)));

    const leftW = Math.round(baseLeftW * hudScale);
    const rightW = Math.round(baseRightW * hudScale);
    const panelH = Math.max(240, h - topBarH - margin - 4);

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
    const centerW = Math.max(260, rightPanel.x - 6 - centerX);
    const logH = Math.max(46, Math.round(52 * hudScale));

    const bottomLog: ViewportRect = {
      x: centerX,
      y: h - margin - logH - 2,
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

    this.drawTopHeader(ctx, params, layout);
    this.drawLeftTelemetryPanel(ctx, params, layout);
    this.drawRightRequisitionPanel(ctx, params, layout);
    this.drawBottomEventLog(ctx, params, layout);

    // Highlight targeted HUD buttons during Interactive Training Drill
    if (
      params.tutorialDirective.active &&
      !params.tutorialDirective.graduated &&
      !params.wikiOpen &&
      !params.osdMenuOpen &&
      !params.manifestOpen &&
      params.tutorialDirective.highlightButtonIds.length > 0
    ) {
      this.drawTutorialButtonHighlights(
        ctx,
        params.tutorialDirective.highlightButtonIds,
        params.timeSec
      );
    }

    if (params.statusToast && !params.wikiOpen) {
      const toastVp =
        params.tutorialDirective.active && !params.tutorialDirective.graduated
          ? {
              ...layout.blueprintViewport,
              height: Math.max(100, layout.blueprintViewport.height - 134),
            }
          : layout.blueprintViewport;
      this.drawToastBanner(ctx, params.statusToast, toastVp);
    }

    if (
      params.tutorialDirective.active &&
      !params.wikiOpen &&
      !params.osdMenuOpen &&
      !params.manifestOpen
    ) {
      if (params.tutorialDirective.graduated) {
        this.drawTutorialGraduationModal(ctx, params);
      } else {
        this.drawTutorialDirectiveBanner(ctx, params, layout.blueprintViewport);
      }
    }

    if (params.sim.phase === 'BRIEFING' && !params.wikiOpen) {
      this.drawBriefingOverlay(ctx, params);
    } else if (params.sim.phase === 'PROTOCOL_DRAFT' && !params.wikiOpen) {
      this.drawProtocolDraftModal(ctx, params);
    } else if (params.sim.phase === 'CORE_BREACHED' && !params.wikiOpen) {
      this.drawEndOfRunOverlay(ctx, params);
    } else if (params.sim.phase === 'CALLSIGN_ENTRY' && !params.wikiOpen) {
      this.drawCallsignEntryModal(ctx, params);
    }

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
      // Wiki modal captures all foreground clicks
      this.buttons = wr.buttons;
    } else if (params.osdMenuOpen) {
      this.drawCommandOsdModal(ctx, params);
    } else if (params.manifestOpen) {
      this.drawManifestModal(ctx, params);
    }
  }

  private drawTopHeader(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams,
    layout: PerimeterLayout
  ): void {
    const { width: w, sim } = params;
    ctx.save();

    ctx.fillStyle = 'rgba(3, 9, 5, 0.94)';
    ctx.fillRect(0, 0, w, layout.topBarH);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(8, layout.topBarH - 1);
    ctx.lineTo(w - 8, layout.topBarH - 1);
    ctx.stroke();

    const compactHeader = w < 1340;
    const modeBadge = sim.trainingMode
      ? `${params.tutorialDirective.code || 'SIM DRILL'} // UNRANKED`
      : compactHeader
        ? `ENDLESS // W-${String(sim.waveNumber).padStart(2, '0')}`
        : `ENDLESS HIVE SIEGE // WAVE ${String(sim.waveNumber).padStart(2, '0')}`;

    ctx.font = compactHeader
      ? 'bold 15px "Share Tech Mono", monospace'
      : 'bold 17px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.textAlign = 'left';
    const brandStr = 'HADLEY PERIMETER';
    ctx.fillText(brandStr, 14, 30);

    const pillX = Math.round(14 + ctx.measureText(brandStr).width + 10);
    let badgePillW = 0;
    if (sim.trainingMode) {
      const tLbl = '● SIM DRILL';
      ctx.font = 'bold 12px "Share Tech Mono", monospace';
      badgePillW = Math.ceil(ctx.measureText(tLbl).width) + 14;
      ctx.fillStyle = 'rgba(6, 34, 42, 0.94)';
      ctx.fillRect(pillX, 10, badgePillW, 26);
      ctx.strokeStyle = '#00F0FF';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(pillX, 10, badgePillW, 26);
      ctx.fillStyle = '#70F8FF';
      ctx.textAlign = 'center';
      ctx.fillText(tLbl, pillX + badgePillW * 0.5, 27);
      ctx.textAlign = 'left';
      ctx.font = compactHeader
        ? 'bold 15px "Share Tech Mono", monospace'
        : 'bold 17px "Share Tech Mono", monospace';
    } else {
      badgePillW = drawRankedHudPill(
        ctx,
        pillX,
        10,
        26,
        params.timeSec,
        true,
        compactHeader
      );
    }
    const titleOffset = pillX + badgePillW + 10;
    const badgeText = `// ${modeBadge}`;
    ctx.fillStyle = sim.trainingMode ? '#00F0FF' : '#FFB000';
    ctx.fillText(badgeText, titleOffset, 30);
    let titleRightEdge = Math.round(titleOffset + ctx.measureText(badgeText).width + 12);

    // Optional Perfect Wave Streak Pill (when space permits before top-right buttons)
    const minRightButtonsWidth = compactHeader ? 640 : 715;
    if (sim.perfectWaveStreak >= 1 && titleRightEdge + 112 < w - minRightButtonsWidth) {
      const sTxt = `STREAK ${sim.getStreakMultiplier().toFixed(2)}X`;
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      const sw = Math.ceil(ctx.measureText(sTxt).width) + 12;
      ctx.fillStyle = 'rgba(42, 28, 4, 0.92)';
      ctx.fillRect(titleRightEdge, 11, sw, 24);
      ctx.strokeStyle = '#FFB000';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(titleRightEdge, 11, sw, 24);
      ctx.fillStyle = '#FFE082';
      ctx.textAlign = 'center';
      ctx.fillText(sTxt, titleRightEdge + sw * 0.5, 27);
      ctx.textAlign = 'left';
      titleRightEdge += sw + 8;
    }

    // Optional Active Mutator Pill
    if (sim.activeMutator !== 'NONE' && titleRightEdge + 135 < w - minRightButtonsWidth) {
      const mut = WAVE_MUTATORS[sim.activeMutator];
      const mTxt = `⚡ ${mut.label}`;
      ctx.font = 'bold 12px "Share Tech Mono", monospace';
      const mw = Math.ceil(ctx.measureText(mTxt).width) + 12;
      ctx.fillStyle = 'rgba(42, 12, 8, 0.92)';
      ctx.fillRect(titleRightEdge, 11, mw, 24);
      ctx.strokeStyle = mut.color;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(titleRightEdge, 11, mw, 24);
      ctx.fillStyle = mut.color;
      ctx.textAlign = 'center';
      ctx.fillText(mTxt, titleRightEdge + mw * 0.5, 27);
      ctx.textAlign = 'left';
      titleRightEdge += mw + 8;
    }

    // Top-Right Control Strip (including [EXIT TO MU-TH-UR OS])
    const pills: Array<{ id: string; label: string; w: number; active: boolean; accent: string }> =
      [
        {
          id: 'perim-pause-toggle',
          label: sim.tacticalPaused ? '❚❚ PAUSED' : '[SPACE] PAUSE',
          w: compactHeader ? 102 : 114,
          active: sim.tacticalPaused,
          accent: '#FFB000',
        },
        {
          id: 'perim-wiki-open',
          label: 'WIKI [H]',
          w: compactHeader ? 76 : 84,
          active: params.wikiOpen,
          accent: '#00F0FF',
        },
        {
          id: 'perim-manifest',
          label: 'MANIFEST',
          w: compactHeader ? 78 : 88,
          active: params.manifestOpen,
          accent: COLORS.GREEN_BRIGHT,
        },
        {
          id: 'perim-mute',
          label: params.audioMuted ? 'AUDIO: OFF' : 'AUDIO: ON',
          w: compactHeader ? 84 : 92,
          active: !params.audioMuted,
          accent: params.audioMuted ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY,
        },
        {
          id: 'perim-fullscreen',
          label: params.isFullscreen ? 'EXIT FL' : 'FULLSCR',
          w: compactHeader ? 72 : 80,
          active: params.isFullscreen,
          accent: COLORS.AMBER_BRIGHT,
        },
        {
          id: 'perim-osd',
          label: '[TAB] MENU',
          w: compactHeader ? 90 : 98,
          active: params.osdMenuOpen,
          accent: '#FFB000',
        },
        {
          id: 'perim-exit-os',
          label: 'MU-TH-UR OS',
          w: compactHeader ? 100 : 108,
          active: false,
          accent: '#FFB000',
        },
      ];

    let px = w - 12;
    for (let i = pills.length - 1; i >= 0; i--) {
      const p = pills[i];
      px -= p.w;
      if (px < titleRightEdge) break;
      this.addScaledButton(
        ctx,
        p.id,
        { x: px, y: 7, width: p.w, height: 33 },
        p.label,
        p.active,
        params.hoveredButtonId,
        p.accent,
        compactHeader ? 12.5 : 13.5
      );
      px -= 6;
    }

    ctx.restore();
  }

  // ===========================================================================
  // LEFT PANEL: REACTOR & MOTION TELEMETRY (3 ANALOG DIALS + M314 SUB-SCOPE)
  // ===========================================================================

  private drawLeftTelemetryPanel(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams,
    layout: PerimeterLayout
  ): void {
    const { leftPanel: rect, hudScale: s } = layout;
    const { sim } = params;
    const baseW = 274;
    const baseH = Math.round(rect.height / s);

    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.scale(s, s);

    ctx.fillStyle = 'rgba(3, 8, 5, 0.94)';
    ctx.fillRect(0, 0, baseW, baseH);
    this.drawCornerBrackets(ctx, 0, 0, baseW, baseH, 14, COLORS.GREEN_DIM, 2.4);

    // Header + Score Readout
    ctx.textAlign = 'left';
    ctx.font = 'bold 15.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('REACTOR & WEAPONS', 10, 22);

    ctx.textAlign = 'right';
    ctx.font = 'bold 15.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(`${String(sim.score).padStart(6, '0')} PTS`, baseW - 10, 22);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(10, 30);
    ctx.lineTo(baseW - 10, 30);
    ctx.stroke();

    // 1. Top Row Dual Analog Vector Dials: REACTOR LOAD (kW) & CORE BULKHEADS
    const usedKw = sim.getTotalLoadKw();
    const maxKw = sim.maxReactorKw;
    const kwRatio = Math.min(1.15, usedKw / Math.max(1, maxKw));
    const kwOver = usedKw > maxKw || sim.blackoutTimer > 0;
    const kwSub =
      sim.blackoutTimer > 0
        ? `TRIP ${sim.blackoutTimer.toFixed(1)}S`
        : sim.overloadTimer > 0.1
          ? `OVRLD ${usedKw}kW`
          : `${usedKw}/${maxKw} kW`;

    const dialR = 35;
    const row1Cy = 76;
    this.drawAnalogWedgeNeedleDial(
      ctx,
      68,
      row1Cy,
      dialR,
      sim.blackoutTimer > 0 ? 0 : Math.min(1, kwRatio),
      sim.blackoutTimer > 0 ? 'BLACKOUT!' : 'REACTOR kW',
      kwSub,
      kwOver ? COLORS.RED_KLAXON : '#FFB000'
    );

    const sealRatio = sim.bulkheadSeals / PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS;
    const sealCol =
      sim.bulkheadSeals <= 1
        ? COLORS.RED_KLAXON
        : sim.bulkheadSeals === 2
          ? '#FFB000'
          : '#44FF77';
    this.drawAnalogWedgeNeedleDial(
      ctx,
      baseW - 68,
      row1Cy,
      dialR,
      sealRatio,
      'BULKHEADS',
      `${sim.bulkheadSeals}/3 SEALS`,
      sealCol
    );

    // 3 Bulkhead Seal Hardware Blocks Strip
    const sealBarY = 143;
    const sealGap = 5;
    const sealW = (baseW - 20 - sealGap * 2) / 3;
    for (let i = 0; i < 3; i++) {
      const sx = 10 + i * (sealW + sealGap);
      const intact = i < sim.bulkheadSeals;
      ctx.fillStyle = intact ? 'rgba(68, 255, 119, 0.14)' : 'rgba(60, 12, 10, 0.45)';
      ctx.fillRect(sx, sealBarY, sealW, 20);
      ctx.strokeStyle = intact ? sealCol : '#5C1C16';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(sx, sealBarY, sealW, 20);

      ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
      ctx.fillStyle = intact ? sealCol : '#853028';
      ctx.textAlign = 'center';
      ctx.fillText(
        intact ? `S0${i + 1}: LOCK` : `S0${i + 1}: BLOWN`,
        sx + sealW * 0.5,
        sealBarY + 14
      );
    }

    // 1B. Reactor Reserve Battery Gauge + Quick Engineering Controls (+15kW Bus / +1 Seal / Shed Aux)
    const batY = 169;
    const batRatio = Math.max(0, Math.min(1, sim.reserveBattery / 100));
    const batReady = sim.reserveBattery >= PERIMETER_CONSTANTS.FLOODLIGHT_BATTERY_COST;
    ctx.fillStyle = 'rgba(5, 16, 12, 0.94)';
    ctx.fillRect(10, batY, baseW - 20, 18);
    ctx.strokeStyle = batReady ? '#00F0FF' : COLORS.GREEN_DIM;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(10, batY, baseW - 20, 18);

    const batBarX = 64;
    const batBarW = baseW - 134;
    ctx.fillStyle = 'rgba(10, 30, 26, 0.9)';
    ctx.fillRect(batBarX, batY + 3, batBarW, 12);
    ctx.fillStyle = batReady ? '#00F0FF' : '#44FF77';
    ctx.fillRect(batBarX + 1, batY + 4, (batBarW - 2) * batRatio, 10);
    // 60% Floodlight trigger threshold tick mark
    const threshX = batBarX + Math.round(batBarW * (PERIMETER_CONSTANTS.FLOODLIGHT_BATTERY_COST / 100));
    ctx.strokeStyle = '#FFB000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(threshX, batY + 2);
    ctx.lineTo(threshX, batY + 16);
    ctx.stroke();

    ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = batReady ? '#9BF8FF' : '#A6FCC2';
    ctx.fillText('RES BAT', 14, batY + 13);
    ctx.textAlign = 'right';
    ctx.fillStyle = batReady ? '#00F0FF' : '#FFB000';
    ctx.fillText(`${Math.round(sim.reserveBattery)}%`, baseW - 14, batY + 13);

    const engY = 192;
    const engH = 24;
    const engGap = 5;
    const engW = (baseW - 20 - engGap) * 0.5;
    const expandCost = sim.getReactorExpandCost();
    const expandCapped = sim.maxReactorKw >= PERIMETER_CONSTANTS.MAX_REACTOR_KW_HARD_CAP;
    const canExpand = !expandCapped && sim.scrap >= expandCost;
    const expandHov = params.hoveredButtonId === 'reactor-expand';
    this.buttons.push({
      id: 'reactor-expand',
      rect: {
        x: rect.x + 10 * s,
        y: rect.y + engY * s,
        width: engW * s,
        height: engH * s,
      },
      label: 'EXPAND REACTOR BUS',
    });
    ctx.fillStyle = expandHov
      ? 'rgba(0, 240, 255, 0.24)'
      : canExpand
        ? 'rgba(8, 28, 26, 0.94)'
        : 'rgba(6, 14, 10, 0.92)';
    ctx.fillRect(10, engY, engW, engH);
    ctx.strokeStyle = expandHov ? '#FFFFFF' : canExpand ? '#00F0FF' : COLORS.GREEN_DIM;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(10, engY, engW, engH);
    ctx.textAlign = 'center';
    ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
    ctx.fillStyle = canExpand ? '#9BF8FF' : COLORS.GREEN_MID;
    ctx.fillText(
      expandCapped ? 'BUS 360kW MAX' : `+15kW (${expandCost}S)`,
      10 + engW * 0.5,
      engY + 15.5,
      engW - 6
    );

    const canFabSeal = sim.phase === 'TACTICAL_PREP' && sim.bulkheadSeals < 3;
    const rightEngId = canFabSeal ? 'seal-fabricate' : 'aux-shed';
    const rightEngX = 10 + engW + engGap;
    const rightEngHov = params.hoveredButtonId === rightEngId;
    const rightEngReady = canFabSeal
      ? sim.scrap >= PERIMETER_CONSTANTS.SEAL_REBUILD_COST_SCRAP
      : true;
    this.buttons.push({
      id: rightEngId,
      rect: {
        x: rect.x + rightEngX * s,
        y: rect.y + engY * s,
        width: engW * s,
        height: engH * s,
      },
      label: canFabSeal ? 'FABRICATE CORE SEAL' : 'SHED AUX LOAD',
    });
    ctx.fillStyle = rightEngHov
      ? 'rgba(255, 176, 0, 0.28)'
      : sim.auxShedActive && !canFabSeal
        ? 'rgba(255, 176, 0, 0.20)'
        : canFabSeal && rightEngReady
          ? 'rgba(18, 42, 20, 0.94)'
          : 'rgba(6, 16, 10, 0.92)';
    ctx.fillRect(rightEngX, engY, engW, engH);
    ctx.strokeStyle = rightEngHov
      ? '#FFFFFF'
      : canFabSeal
        ? rightEngReady
          ? '#44FF77'
          : COLORS.GREEN_DIM
        : sim.auxShedActive
          ? '#FFB000'
          : '#FFB000';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(rightEngX, engY, engW, engH);
    ctx.fillStyle = canFabSeal
      ? rightEngReady
        ? '#52FF86'
        : COLORS.GREEN_MID
      : '#FFE082';
    ctx.fillText(
      canFabSeal
        ? `+1 SEAL (${PERIMETER_CONSTANTS.SEAL_REBUILD_COST_SCRAP}S)`
        : sim.auxShedActive
          ? `[X] RESTORE (${sim.auxShedTurretIds.length})`
          : '[X] SHED AUX',
      rightEngX + engW * 0.5,
      engY + 15.5,
      engW - 6
    );

    // 2. BIO-THREAT DENSITY Analog Gauge + KILLS / CONTACTS Summary
    const threatCy = 258;
    const densityNorm = Math.min(1, sim.hostiles.length / 28);
    const threatCol =
      densityNorm > 0.72 ? COLORS.RED_KLAXON : densityNorm > 0.35 ? '#FFB000' : '#44FF77';
    this.drawAnalogWedgeNeedleDial(
      ctx,
      62,
      threatCy,
      29,
      densityNorm,
      'BIO-DENSITY',
      `${sim.hostiles.length} ACTIVE`,
      threatCol
    );

    // Tabular Telemetry Readout next to Bio-Density Dial (crisp >=12px numerals!)
    const tabX = 112;
    ctx.textAlign = 'left';
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    const verifiedCount = sim.hostiles.filter((h) => h.verified).length;
    const sealedDoors = sim.getActiveSealedDoorCount();
    const maxDoorSeals = sim.getMaxDoorSeals();
    const stats: Array<[string, string, string]> = [
      ['VERIFIED:', `${verifiedCount}`, '#FFB000'],
      ['KILLS:', `${sim.totalKills}`, '#44FF77'],
      [
        'DOOR SEALS:',
        `${sealedDoors}/${maxDoorSeals}`,
        sealedDoors >= maxDoorSeals ? '#FF5522' : '#FFB000',
      ],
      ['ONLINE:', `${sim.turrets.filter((t) => t.powered).length}/${sim.turrets.length}`, '#44FF77'],
    ];
    stats.forEach(([k, v, c], idx) => {
      const sy = threatCy - 22 + idx * 18;
      ctx.fillStyle = '#8EF5AB';
      ctx.fillText(k, tabX, sy);
      ctx.textAlign = 'right';
      ctx.fillStyle = c;
      ctx.fillText(v, baseW - 10, sy);
      ctx.textAlign = 'left';
    });

    // 3. Live Deployed Weapons Status Matrix (Ammo, Reload Timers, Heat, Kills & 1-Click Rearm)
    const scopeTop = 324;
    const scopeH = Math.max(195, baseH - scopeTop - 10);
    this.drawDeployedWeaponsMatrix(
      ctx,
      rect,
      s,
      10,
      scopeTop,
      baseW - 20,
      scopeH,
      params
    );

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
    accent: string
  ): void {
    ctx.save();
    const startAng = (145 * Math.PI) / 180;
    const sweep = (250 * Math.PI) / 180;
    const endAng = startAng + sweep;
    const clamped = Math.max(0, Math.min(1, normValue));
    const valAng = startAng + clamped * sweep;

    // Glowing Amber/Accent Inner Wedge Fill
    if (clamped > 0.01) {
      ctx.fillStyle =
        accent === COLORS.RED_KLAXON
          ? 'rgba(255, 51, 24, 0.24)'
          : accent === '#44FF77'
            ? 'rgba(68, 255, 119, 0.20)'
            : 'rgba(255, 176, 0, 0.24)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r - 4, startAng, valAng);
      ctx.closePath();
      ctx.fill();
    }

    // Thick Outer Track Arc
    ctx.strokeStyle = COLORS.AMBER_DIM;
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAng, endAng);
    ctx.stroke();

    if (clamped > 0.01) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 5.0;
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAng, valAng);
      ctx.stroke();
    }

    // Tick Marks
    const ticks = 8;
    for (let i = 0; i <= ticks; i++) {
      const f = i / ticks;
      const a = startAng + f * sweep;
      const len = i % 2 === 0 ? 8 : 5;
      ctx.strokeStyle = f <= clamped + 0.02 ? '#FFE08A' : COLORS.GREEN_DIM;
      ctx.lineWidth = i % 2 === 0 ? 2.0 : 1.4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2));
      ctx.lineTo(cx + Math.cos(a) * (r - 2 - len), cy + Math.sin(a) * (r - 2 - len));
      ctx.stroke();
    }

    // Mechanical Pointer Needle
    ctx.strokeStyle = '#FFF2CC';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(valAng) * 5, cy - Math.sin(valAng) * 5);
    ctx.lineTo(cx + Math.cos(valAng) * (r - 5), cy + Math.sin(valAng) * (r - 5));
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.font = 'bold 13px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(label, cx, cy + r + 14);

    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillStyle = accent;
    ctx.fillText(subText, cx, cy + r + 28);
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
    const blinkCaution = Math.sin(timeSec * 9.5) > 0;

    // Inspect overall ordnance health for top-level flashing console warning state
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

    const frameCol =
      anyDry || anyOverheat
        ? blinkFast
          ? '#FF3318'
          : '#7A1C12'
        : anyLowAmmo
          ? blinkCaution
            ? '#FFB000'
            : '#6E4C08'
          : '#44FF77';

    ctx.save();
    ctx.fillStyle = 'rgba(2, 7, 4, 0.96)';
    ctx.fillRect(x, y, w, h);
    this.drawCornerBrackets(ctx, x, y, w, h, 12, frameCol, 2.0);

    // 1. Header + 1-Click [REARM ALL] Button or Alert Pill
    ctx.font = 'bold 13px "Share Tech Mono", monospace';
    ctx.fillStyle = '#44FF77';
    ctx.textAlign = 'left';
    ctx.fillText('WEAPONS TELEMETRY', x + 8, y + 18);

    if (anyNeedRearm) {
      const badgeW = 94;
      const badgeX = x + w - badgeW - 6;
      const rearmAllHov = hoveredButtonId === 'rearm-all';
      this.buttons.push({
        id: 'rearm-all',
        rect: {
          x: panelScreenRect.x + badgeX * hudScale,
          y: panelScreenRect.y + (y + 4) * hudScale,
          width: badgeW * hudScale,
          height: 18 * hudScale,
        },
        label: 'REARM ALL SENTRIES',
      });
      const urgent = (anyDry && blinkFast) || (anyLowAmmo && blinkCaution);
      ctx.fillStyle = rearmAllHov
        ? '#FFE08A'
        : urgent
          ? anyDry
            ? '#FF3318'
            : '#FFB000'
          : 'rgba(26, 44, 22, 0.94)';
      ctx.fillRect(badgeX, y + 4, badgeW, 18);
      ctx.strokeStyle = anyDry ? '#FF3318' : '#FFB000';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(badgeX, y + 4, badgeW, 18);
      ctx.font = 'bold 11px "Share Tech Mono", monospace';
      ctx.fillStyle = rearmAllHov || urgent ? '#040805' : '#FFE082';
      ctx.textAlign = 'center';
      ctx.fillText('[E] REARM ALL', badgeX + badgeW * 0.5, y + 16.5);
    } else if (anyOverheat) {
      const badgeW = 92;
      const badgeX = x + w - badgeW - 6;
      ctx.fillStyle = blinkFast ? '#FF3318' : 'rgba(36, 12, 6, 0.9)';
      ctx.fillRect(badgeX, y + 5, badgeW, 17);
      ctx.strokeStyle = '#FF3318';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(badgeX, y + 5, badgeW, 17);
      ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
      ctx.fillStyle = blinkFast ? '#040805' : '#FF3318';
      ctx.textAlign = 'center';
      ctx.fillText('⚠ OVERHEAT', badgeX + badgeW * 0.5, y + 17.5);
    } else {
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.textAlign = 'right';
      ctx.fillText(`[${sim.turrets.length} ACTIVE]`, x + w - 8, y + 18);
    }

    // 2. Fun Live Aggregate Firepower Strip (Total Reserve Rounds | Live Cyclic RPM | Peak Temp)
    const stripY = y + 25;
    ctx.fillStyle = 'rgba(10, 24, 15, 0.86)';
    ctx.fillRect(x + 6, stripY, w - 12, 22);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x + 6, stripY, w - 12, 22);

    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = anyDry ? '#FF3318' : anyLowAmmo ? '#FFB000' : '#A6FCC2';
    const rdsSummary =
      totalMaxAmmo > 0 ? `RDS:${String(totalAmmo).padStart(4, '0')}` : 'RDS:----';
    ctx.fillText(rdsSummary, x + 11, stripY + 15);

    ctx.textAlign = 'center';
    ctx.fillStyle = liveRpm > 0 ? '#FFB000' : COLORS.GREEN_MID;
    ctx.fillText(`RPM:${String(liveRpm).padStart(4, '0')}`, x + w * 0.5 + 4, stripY + 15);

    ctx.textAlign = 'right';
    ctx.fillStyle = maxHeat > 80 ? '#FF3318' : maxHeat > 50 ? '#FFB000' : '#44FF77';
    ctx.fillText(`PK:${String(Math.round(maxHeat)).padStart(3, '0')}°`, x + w - 11, stripY + 15);

    // 3. Deployed Weapon Cards List
    const listTop = stripY + 28;
    const availH = Math.max(60, y + h - listTop - 6);

    if (sim.turrets.length === 0) {
      // Diegetic empty ordnance slots when no weapons are placed yet
      const slotH = 44;
      const maxSlots = Math.min(4, Math.max(1, Math.floor(availH / (slotH + 6))));
      for (let i = 0; i < maxSlots; i++) {
        const sy = listTop + i * (slotH + 6);
        ctx.strokeStyle = 'rgba(56, 138, 82, 0.52)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x + 6, sy, w - 12, slotH);
        ctx.setLineDash([]);

        ctx.textAlign = 'left';
        ctx.font = 'bold 12px "Share Tech Mono", monospace';
        ctx.fillStyle = 'rgba(104, 248, 148, 0.72)';
        ctx.fillText(`HARDPOINT 0${i + 1} // UNASSIGNED`, x + 14, sy + 18);
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(84, 214, 124, 0.62)';
        ctx.fillText('SELECT [1-8] TO DEPLOY WEAPON', x + 14, sy + 34);
      }
      ctx.restore();
      return;
    }

    // Prioritize combat turrets if >7 units deployed so sentries/railguns/incinerators never scroll off
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

    const gap = 5;
    const minCardH = 44;
    const maxVisible = Math.max(1, Math.min(ordered.length, Math.floor((availH + gap) / (minCardH + gap))));
    const shown = ordered.slice(0, maxVisible);
    const reserveFooter = ordered.length > maxVisible ? 16 : 0;
    const cardH = Math.min(
      68,
      Math.max(
        minCardH,
        Math.floor((availH - reserveFooter - gap * Math.max(0, shown.length - 1)) / shown.length)
      )
    );
    const showThirdRow = cardH >= 56;

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
      const isFiring = t.powered && !isReloading && sim.blackoutTimer <= 0 && t.firingFlashTimer > 0 && !isDry && !isTherm;

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

      // Card background & strobing alert frame
      if (isDry || isTherm) {
        ctx.fillStyle = blinkFast ? 'rgba(120, 18, 12, 0.52)' : 'rgba(24, 6, 5, 0.92)';
        ctx.strokeStyle = blinkFast ? '#FF3318' : '#8A2418';
      } else if (isLow) {
        ctx.fillStyle = blinkCaution ? 'rgba(96, 58, 6, 0.46)' : 'rgba(22, 14, 4, 0.92)';
        ctx.strokeStyle = blinkCaution ? '#FFB000' : '#8C5E0A';
      } else if (isSelected) {
        ctx.fillStyle = 'rgba(48, 36, 8, 0.42)';
        ctx.strokeStyle = '#FFB000';
      } else if (selectHov) {
        ctx.fillStyle = 'rgba(20, 52, 30, 0.48)';
        ctx.strokeStyle = '#8EF5AB';
      } else {
        ctx.fillStyle = 'rgba(5, 15, 9, 0.90)';
        ctx.strokeStyle = t.powered ? 'rgba(59, 224, 104, 0.45)' : 'rgba(35, 78, 48, 0.4)';
      }
      ctx.lineWidth = isSelected || isDry || isLow || isTherm ? 1.9 : 1.3;
      ctx.fillRect(cx, cy, cw, cardH);
      ctx.strokeRect(cx, cy, cw, cardH);

      // Row 1: Callsign + Class + Upgrades on Left | Status / Quick [REARM] on Right
      const kindTag = isSentry
        ? 'PULSE'
        : isIncinerator
          ? 'NAPALM'
          : isRail
            ? 'RAIL'
            : isCryo
              ? 'CRYO'
              : isShock
                ? 'COIL'
                : 'M314';
      const mkTag = t.level === 3 ? ` III${t.mk3Branch ?? ''}` : t.level === 2 ? ' MK2' : '';
      const rlyTag = t.relayBoosted && (isSentry || isIncinerator || isRail) ? '+RLY' : '';

      ctx.textAlign = 'left';
      ctx.font = 'bold 12px "Share Tech Mono", monospace';
      ctx.fillStyle = !t.powered
        ? COLORS.GREEN_MID
        : isDry || isTherm
          ? '#FF5538'
          : isLow || isFiring
            ? '#FFB000'
            : isRail || isShock
              ? '#00F0FF'
              : '#44FF77';
      ctx.fillText(`${t.callsign} ${kindTag}${mkTag}${rlyTag}`, cx + 6, cy + 14);

      // Inline 1-Click [REARM] button on Sentries missing ammo (or live RELOADING badge!)
      let rightEdgeX = cx + cw - 6;
      if (isReloading) {
        ctx.textAlign = 'right';
        ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
        ctx.fillStyle = '#FFB000';
        ctx.fillText(`LOAD ${t.rearmTimer.toFixed(1)}S`, rightEdgeX, cy + 14);
      } else if (isSentry && t.ammo < t.maxAmmo) {
        const rearmCost = sim.getRearmCostFor(t);
        const canRearm = sim.scrap >= rearmCost;
        const rearmId = `rack-rearm-${t.id}`;
        const rearmHov = hoveredButtonId === rearmId;
        const rw = 68;
        const rh = 16;
        const rx = cx + cw - rw - 4;
        const ry = cy + 2;

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

        const urgentFlash = (isDry && blinkFast) || (isLow && blinkCaution);
        ctx.fillStyle = rearmHov
          ? '#FFE08A'
          : urgentFlash && canRearm
            ? isDry
              ? '#FF3318'
              : '#FFB000'
            : 'rgba(16, 34, 20, 0.95)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = !canRearm
          ? COLORS.GREEN_DIM
          : isDry
            ? '#FF3318'
            : '#FFB000';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(rx, ry, rw, rh);

        ctx.font = 'bold 11px "Share Tech Mono", monospace';
        ctx.fillStyle =
          rearmHov || (urgentFlash && canRearm)
            ? '#040805'
            : canRearm
              ? '#FFB000'
              : COLORS.GREEN_MID;
        ctx.textAlign = 'center';
        ctx.fillText(`REARM -${rearmCost}`, rx + rw * 0.5, ry + 12);
        rightEdgeX = rx - 5;
      } else {
        // Right status label when full / non-ammo weapon
        ctx.textAlign = 'right';
        ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
        let stTxt = 'ARMED';
        let stCol = '#44FF77';
        if (sim.blackoutTimer > 0 && t.powered) {
          stTxt = 'BLACKOUT';
          stCol = '#FF3318';
        } else if (!t.powered) {
          stTxt = 'OFFLINE';
          stCol = COLORS.GREEN_MID;
        } else if (isTherm) {
          stTxt = '⚠ LOCKED';
          stCol = '#FF3318';
        } else if (isFiring) {
          stTxt = isIncinerator ? '● FLAME' : isRail ? '● LANCE' : '● FIRING';
          stCol = isRail ? '#00F0FF' : '#FFB000';
        } else if (isSentry || isIncinerator || isRail) {
          stTxt = `K:${String(t.kills).padStart(2, '0')}`;
          stCol = isRail ? '#9BF8FF' : '#8EF5AB';
        } else if (isCryo) {
          stTxt = t.pulseTimer < 0.45 ? '● VENT' : 'CHILL';
          stCol = '#8EF5AB';
        } else if (isShock) {
          stTxt = t.pulseTimer < 0.4 ? '⚡ ARC' : `K:${String(t.kills).padStart(2, '0')}`;
          stCol = '#00F0FF';
        } else {
          stTxt = t.jammedTimer > 0 ? '⚠ JAM' : t.tripwireIntegrity < 60 ? '⚠ WIRE' : 'SWEEP';
          stCol = t.jammedTimer > 0 ? '#E066FF' : t.tripwireIntegrity < 60 ? '#FFB000' : '#44FF77';
        }
        ctx.fillStyle = stCol;
        ctx.fillText(stTxt, rightEdgeX, cy + 14);
      }

      // Row 2: Segmented Primary Bar (AMMO/RELOAD for Sentry, CAP for Rail/Shock, NOZL for Incin, LN2/WIRE)
      const row2Y = cy + 20;
      let row2Label = 'AMMO';
      let row2Ratio = 1;
      let row2ValTxt = '';
      let row2Col = '#44FF77';

      if (isSentry) {
        if (isReloading) {
          row2Label = 'LOAD';
          row2Ratio = Math.max(0, Math.min(1, 1 - t.rearmTimer / Math.max(0.1, t.rearmDuration)));
          row2ValTxt = `${t.rearmTimer.toFixed(1)}S`;
          row2Col = '#FFB000';
        } else {
          row2Label = isDry ? '⚠DRY' : isLow ? '⚠LOW' : 'AMMO';
          row2Ratio = Math.max(0, Math.min(1, t.ammo / Math.max(1, t.maxAmmo)));
          row2ValTxt = `${String(t.ammo).padStart(3, '0')}/${t.maxAmmo}`;
          row2Col = isDry
            ? '#FF3318'
            : isLow
              ? blinkCaution
                ? '#FF3318'
                : '#FFB000'
              : row2Ratio < 0.5
                ? '#FFB000'
                : '#44FF77';
        }
      } else if (isIncinerator) {
        row2Label = 'NOZL';
        const cdMax = sim.activeOverclockSurgeTimer > 0 || t.overclockTimer > 0 ? 0.34 : 0.62;
        row2Ratio = t.powered ? Math.max(0, Math.min(1, 1 - t.fireCooldown / cdMax)) : 0;
        row2ValTxt = t.powered ? (t.firingFlashTimer > 0 ? 'BURN' : 'PRESS') : 'OFF';
        row2Col = '#FFB000';
      } else if (isRail) {
        row2Label = 'CAP';
        const cdMax = t.level === 3 && t.mk3Branch === 'B' ? 1.05 : 1.65;
        row2Ratio = t.powered ? Math.max(0, Math.min(1, 1 - t.fireCooldown / cdMax)) : 0;
        row2ValTxt = t.powered ? (row2Ratio >= 0.98 ? 'READY' : `${Math.round(row2Ratio * 100)}%`) : 'OFF';
        row2Col = '#00F0FF';
      } else if (isCryo) {
        row2Label = 'LN2';
        row2Ratio = t.powered ? Math.max(0, Math.min(1, 1 - t.pulseTimer / 2.75)) : 0;
        row2ValTxt = t.powered ? `${Math.round(row2Ratio * 100)}%` : 'OFF';
        row2Col = '#8EF5AB';
      } else if (isShock) {
        row2Label = 'ARC';
        row2Ratio = t.powered ? Math.max(0, Math.min(1, 1 - t.pulseTimer / 2.2)) : 0;
        row2ValTxt = t.powered ? `${Math.round(row2Ratio * 100)}%` : 'OFF';
        row2Col = '#00F0FF';
      } else {
        row2Label = 'WIRE';
        row2Ratio = Math.max(0, Math.min(1, t.tripwireIntegrity / 100));
        row2ValTxt = `${Math.round(t.tripwireIntegrity)}%`;
        row2Col = t.tripwireIntegrity < 50 ? '#FFB000' : '#44FF77';
      }

      this.drawWeaponSegmentedBar(
        ctx,
        cx + 6,
        row2Y,
        cw - 12,
        10,
        row2Label,
        row2Ratio,
        row2ValTxt,
        row2Col,
        (isDry && blinkFast) || (isLow && !blinkCaution && isSentry && rightEdgeX < cx + cw - 10)
      );

      // Row 3: Barrel / Chamber HEAT Bar + Kills Badge (when cardH >= 56)
      if (showThirdRow) {
        const row3Y = cy + 36;
        if (isSentry || isIncinerator || isRail) {
          const heatRatio = Math.max(0, Math.min(1, t.heat / 100));
          const heatCol =
            isTherm || isHot ? '#FF3318' : t.heat >= 52 ? '#FFB000' : '#44FF77';
          const heatVal = isTherm
            ? 'LOCK!'
            : `${String(Math.round(t.heat)).padStart(3, '0')}% K:${t.kills}`;
          this.drawWeaponSegmentedBar(
            ctx,
            cx + 6,
            row3Y,
            cw - 12,
            9,
            'HEAT',
            heatRatio,
            heatVal,
            heatCol,
            isTherm && blinkFast
          );
        } else {
          ctx.textAlign = 'left';
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          ctx.fillStyle = COLORS.GREEN_MID;
          ctx.fillText(
            isCryo
              ? 'CRYO PLUME // COOLS NEARBY GUNS'
              : isShock
                ? 'TESLA ARC // STUNS & DECLOAKS'
                : `M314 RADAR // ${sim.getTurretPowerKw(t)}kW ACTIVE`,
            cx + 6,
            row3Y + 9,
            cw - 12
          );
        }
      }
    });

    if (ordered.length > maxVisible) {
      ctx.font = 'bold 11px "Share Tech Mono", monospace';
      ctx.fillStyle = '#FFB000';
      ctx.textAlign = 'center';
      ctx.fillText(
        `+ ${ordered.length - maxVisible} ADDITIONAL SUPPORT UNITS ACTIVE`,
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
    flashEmptyAlert = false
  ): void {
    const labelW = 36;
    const valW = 66;
    const barX = x + labelW;
    const barW = Math.max(32, w - labelW - valW);

    ctx.textAlign = 'left';
    ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
    ctx.fillStyle = flashEmptyAlert ? '#FF3318' : color;
    ctx.fillText(label, x, y + h - 1);

    const segs = 10;
    const segGap = 2;
    const segW = (barW - segGap * (segs - 1)) / segs;
    const litCount = Math.round(Math.max(0, Math.min(1, ratio)) * segs);

    for (let s = 0; s < segs; s++) {
      const sx = barX + s * (segW + segGap);
      if (s < litCount) {
        ctx.fillStyle = color;
      } else {
        ctx.fillStyle = flashEmptyAlert ? 'rgba(255, 51, 24, 0.28)' : 'rgba(18, 46, 28, 0.55)';
      }
      ctx.fillRect(sx, y + 1, segW, h - 2);
    }

    ctx.textAlign = 'right';
    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    ctx.fillStyle = color;
    ctx.fillText(rightText, x + w, y + h - 1);
  }

  // ===========================================================================
  // RIGHT PANEL: ORDNANCE REQUISITION [1-5], ABILITIES & UNIT INSPECTOR
  // ===========================================================================

  private drawRightRequisitionPanel(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams,
    layout: PerimeterLayout
  ): void {
    const { rightPanel: rect, hudScale: s } = layout;
    const { sim, activeTool, hoveredButtonId } = params;
    const baseW = 368;
    const baseH = Math.round(rect.height / s);
    const extraH = Math.max(0, baseH - 744);

    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.scale(s, s);

    ctx.fillStyle = 'rgba(3, 8, 5, 0.94)';
    ctx.fillRect(0, 0, baseW, baseH);
    this.drawCornerBrackets(ctx, 0, 0, baseW, baseH, 16, COLORS.GREEN_DIM, 2.4);

    // Top Economy Block: ORDNANCE SCRAP & FREE REACTOR kW
    ctx.textAlign = 'left';
    ctx.font = 'bold 17px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('ORDNANCE REQUISITION', 12, 23);

    const activeProtoCount = Object.values(sim.activeProtocols).reduce((acc, v) => acc + (v ?? 0), 0);
    if (activeProtoCount > 0) {
      ctx.textAlign = 'right';
      ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#00F0FF';
      ctx.fillText(`PROTOCOLS: ${activeProtoCount}`, baseW - 12, 22);
    }

    const netKw = sim.maxReactorKw - sim.getTotalLoadKw();
    ctx.fillStyle = 'rgba(20, 14, 3, 0.90)';
    ctx.fillRect(12, 29, baseW - 24, 34);
    ctx.strokeStyle = netKw < 0 ? COLORS.RED_KLAXON : '#FFB000';
    ctx.lineWidth = 1.8;
    ctx.strokeRect(12, 29, baseW - 24, 34);

    ctx.font = 'bold 17.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.textAlign = 'left';
    ctx.fillText(`SCRAP: ${sim.scrap}`, 20, 52);

    ctx.fillStyle =
      netKw < 0 ? COLORS.RED_KLAXON : netKw < 14 ? COLORS.AMBER_CAUTION : '#44FF77';
    ctx.textAlign = 'right';
    ctx.fillText(
      netKw < 0 ? `OVER: +${Math.abs(netKw)} kW` : `FREE: ${netKw} kW`,
      baseW - 20,
      52
    );

    // 1. 8-Hardware Tactical Grid [1-8] — Crisp 2-Column × 4-Row Zero-Overlap Layout!
    let curY = 69;
    const cardW = baseW - 24;
    const gridGapX = 6;
    const gridGapY = 5;
    const cellW = (cardW - gridGapX) * 0.5;
    const cellH = Math.min(58, 53 + Math.floor(extraH * 0.03));
    const maxDoorSeals = sim.getMaxDoorSeals();
    const sealedDoors = sim.getActiveSealedDoorCount();

    const buildGrid: Array<{
      id: Exclude<BuildToolId, 'NONE'>;
      shortTitle: string;
      line2: string;
      line3: string;
      cyan?: boolean;
    }> = [
      {
        id: 'SENTRY_PULSE',
        shortTitle: 'UA 571-C',
        line2: 'PAD · 320-RD DRUM',
        line3: '22 kW · +100% LIT',
      },
      {
        id: 'INCINERATOR',
        shortTitle: 'M240 INCIN',
        line2: 'PAD · NAPALM AOE',
        line3: '26 kW · BURNS ACID',
      },
      {
        id: 'RAIL_LANCE',
        shortTitle: 'M99 RAIL',
        line2: 'PAD · 4X PIERCE',
        line3: '30 kW · 18M SNIPER',
        cyan: true,
      },
      {
        id: 'CRYO_VALVE',
        shortTitle: 'CRYO VALVE',
        line2: 'GRATE · 58% SLOW',
        line3: '14 kW · +35% SHAT',
      },
      {
        id: 'SHOCK_COIL',
        shortTitle: 'ARC COIL',
        line2: 'GRATE · CHAIN STUN',
        line3: '18 kW · DECLOAKS',
        cyan: true,
      },
      {
        id: 'MOTION_RELAY',
        shortTitle: 'M314 RELAY',
        line2: 'PAD · RADAR & LIT',
        line3: '10 kW · +24% LINK',
      },
      {
        id: 'ARC_WELDER',
        shortTitle: 'DOOR SEAL',
        line2: `DOOR · ${sealedDoors}/${maxDoorSeals} SEALS`,
        line3: '0 kW · 2.0S TORCH',
      },
      {
        id: 'CLAYMORE',
        shortTitle: 'M18 MINE',
        line2: `FLOOR · ${sim.claymores.length}/${PERIMETER_CONSTANTS.CLAYMORE_MAX_ACTIVE} ARMED`,
        line3: '0 kW · 195 BLAST',
      },
    ];

    const drillRestricting =
      params.tutorialDirective.active && !params.tutorialDirective.graduated;

    buildGrid.forEach((item, idx) => {
      const bId = item.id;
      const spec = HARDWARE_SPECS[bId];
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const cx = 12 + col * (cellW + gridGapX);
      const cy = curY + row * (cellH + gridGapY);

      const drillLocked =
        drillRestricting && !params.tutorialDirective.allowedBuildIds.includes(bId);
      const isSelected = !drillLocked && activeTool.kind === 'BUILD' && activeTool.buildId === bId;
      const isCapped =
        (bId === 'ARC_WELDER' && sealedDoors >= maxDoorSeals) ||
        (bId === 'CLAYMORE' && sim.claymores.length >= PERIMETER_CONSTANTS.CLAYMORE_MAX_ACTIVE);
      const canAfford =
        !drillLocked &&
        !isCapped &&
        sim.scrap >= spec.costScrap &&
        sim.getStaticAllocatedKw() + spec.powerKw <= sim.maxReactorKw;
      const btnId = `build-${bId}`;
      this.buttons.push({
        id: btnId,
        rect: { x: rect.x + cx * s, y: rect.y + cy * s, width: cellW * s, height: cellH * s },
        label: spec.name,
      });
      const hov = !drillLocked && hoveredButtonId === btnId;

      ctx.fillStyle = drillLocked
        ? 'rgba(3, 9, 5, 0.96)'
        : isSelected
          ? 'rgba(255, 176, 0, 0.25)'
          : hov
            ? 'rgba(68, 255, 119, 0.18)'
            : 'rgba(6, 18, 11, 0.94)';
      ctx.fillRect(cx, cy, cellW, cellH);
      ctx.strokeStyle = drillLocked
        ? 'rgba(32, 68, 44, 0.42)'
        : isSelected
          ? '#FFB000'
          : hov
            ? '#FFFFFF'
            : canAfford
              ? item.cyan
                ? '#00D8EE'
                : COLORS.GREEN_PRIMARY
              : COLORS.GREEN_DIM;
      ctx.lineWidth = isSelected ? 2.4 : drillLocked ? 1.0 : 1.5;
      ctx.strokeRect(cx, cy, cellW, cellH);

      // Right Cost Pill
      const costTxt = drillLocked ? 'LOCK' : `${spec.costScrap}S`;
      ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
      const pillW = Math.ceil(ctx.measureText(costTxt).width) + 10;
      const pillX = cx + cellW - pillW - 5;
      const pillY = cy + 4;
      ctx.fillStyle = drillLocked
        ? 'rgba(12, 22, 16, 0.8)'
        : canAfford
          ? 'rgba(34, 24, 4, 0.92)'
          : 'rgba(42, 10, 8, 0.92)';
      ctx.fillRect(pillX, pillY, pillW, 17);
      ctx.strokeStyle = drillLocked
        ? 'rgba(44, 78, 56, 0.45)'
        : canAfford
          ? 'rgba(255, 176, 0, 0.72)'
          : 'rgba(255, 51, 24, 0.72)';
      ctx.lineWidth = 1.0;
      ctx.strokeRect(pillX, pillY, pillW, 17);
      ctx.textAlign = 'center';
      ctx.fillStyle = drillLocked ? '#426B4E' : canAfford ? '#FFC43D' : COLORS.RED_KLAXON;
      ctx.fillText(costTxt, pillX + pillW * 0.5, pillY + 12.5);

      // Left Short Title strictly left of cost pill
      ctx.textAlign = 'left';
      ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
      ctx.fillStyle = drillLocked
        ? '#4D7D5C'
        : isSelected
          ? '#FFE082'
          : hov
            ? '#FFFFFF'
            : canAfford
              ? item.cyan
                ? '#7CF9FF'
                : '#5EFF90'
              : '#7FC494';
      ctx.fillText(`[${spec.shortKey}] ${item.shortTitle}`, cx + 6, cy + 17, pillX - cx - 10);

      // Line 2 & Line 3 compact technical telemetry
      ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
      ctx.fillStyle = drillLocked ? '#406B4F' : canAfford ? '#B8FCD0' : '#7FB590';
      ctx.fillText(item.line2, cx + 6, cy + 33, cellW - 12);
      ctx.fillStyle = drillLocked
        ? '#385E45'
        : canAfford
          ? item.cyan
            ? '#A8FAFF'
            : '#FFBE2E'
          : '#7A9E84';
      ctx.fillText(item.line3, cx + 6, cy + cellH - 6, cellW - 12);
    });

    curY += 4 * cellH + 3 * gridGapY + 5;

    // 2. Active Player Command Abilities (2-Row × 3-Col Strip: [F/O/V] + [L/C/X])
    ctx.textAlign = 'left';
    ctx.font = 'bold 13px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('COMMAND ABILITIES [F / O / V / L / C / X]', 12, curY + 11);
    curY += 16;

    const abGap = 6;
    const abW = (cardW - abGap * 2) / 3;
    const abH = 40;
    const floodReady =
      sim.blackoutTimer <= 0 &&
      sim.floodlightCooldown <= 0 &&
      sim.reserveBattery >= PERIMETER_CONSTANTS.FLOODLIGHT_BATTERY_COST;
    const coolantReady = sim.blackoutTimer <= 0 && sim.coolantFlushCooldown <= 0;

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
          sub: sim.overclockCooldown > 0 ? `${sim.overclockCooldown.toFixed(0)}S CD` : '+22kW 2X',
          ready: sim.overclockCooldown <= 0 && sim.blackoutTimer <= 0,
        },
        {
          id: 'ability-PURGE',
          toolId: 'PURGE',
          top: '[V] PURGE',
          sub: sim.purgeAvailableThisWave ? '1X READY' : 'SPENT',
          ready: sim.purgeAvailableThisWave,
        },
      ],
      [
        {
          id: 'ability-FLOODLIGHT',
          top: '[L] FLOOD',
          sub:
            sim.floodlightTimer > 0
              ? `LIT ${sim.floodlightTimer.toFixed(1)}S`
              : sim.floodlightCooldown > 0
                ? `${sim.floodlightCooldown.toFixed(0)}S CD`
                : `${Math.round(sim.reserveBattery)}/60% BAT`,
          ready: floodReady || sim.floodlightTimer > 0,
          accent: '#00F0FF',
          active: sim.floodlightTimer > 0,
        },
        {
          id: 'ability-COOLANT_FLUSH',
          top: '[C] FLUSH',
          sub:
            sim.coolantFlushCooldown > 0
              ? `${sim.coolantFlushCooldown.toFixed(0)}S CD`
              : 'VENT HEAT',
          ready: coolantReady,
          accent: '#9BF8FF',
        },
        {
          id: 'aux-shed',
          top: sim.auxShedActive ? `[X] REST (${sim.auxShedTurretIds.length})` : '[X] SHED',
          sub: sim.auxShedActive ? `${sim.auxShedTurretIds.length} AUX OFF` : 'DROP AUX kW',
          ready: true,
          accent: '#FFB000',
          active: sim.auxShedActive,
        },
      ],
    ];

    abilityRows.forEach((rowItems, rowIdx) => {
      const ry = curY + rowIdx * (abH + 5);
      rowItems.forEach((ab, idx) => {
        const ax = 12 + idx * (abW + abGap);
        const abCmd = ab.id.startsWith('ability-')
          ? (ab.id.replace('ability-', '') as 'FLARE' | 'OVERCLOCK' | 'PURGE' | 'FLOODLIGHT' | 'COOLANT_FLUSH')
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
        const acc = ab.accent ?? '#FFB000';

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
              : COLORS.GREEN_DIM;
        ctx.lineWidth = isArmed ? 2.4 : drillLocked ? 1.0 : 1.5;
        ctx.strokeRect(ax, ry, abW, abH);

        ctx.textAlign = 'center';
        ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
        ctx.fillStyle = drillLocked
          ? '#4D7D5C'
          : ab.ready
            ? ab.accent
              ? '#D4FFFF'
              : '#FFE082'
            : COLORS.GREEN_MID;
        ctx.fillText(ab.top, ax + abW * 0.5, ry + 17, abW - 6);

        ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
        ctx.fillStyle = drillLocked ? '#467054' : ab.ready ? '#62FF92' : COLORS.RED_KLAXON;
        ctx.fillText(drillLocked ? 'LOCKED' : ab.sub, ax + abW * 0.5, ry + 33, abW - 6);
      });
    });
    curY += abH * 2 + 12;

    // 3. Wave Launch & [WAVE INTERCEPT // 2X SPEED] Controls
    const waveH = 38;
    const speedW = 96;
    const waveBtnW = cardW - speedW - 7;
    const isLaunchAction = sim.trainingMode
      ? params.tutorialDirective.showContinueBtn
      : sim.phase === 'TACTICAL_PREP';

    this.buttons.push({
      id: isLaunchAction ? 'wave-launch' : 'perim-pause-toggle',
      rect: { x: rect.x + 12 * s, y: rect.y + curY * s, width: waveBtnW * s, height: waveH * s },
      label: isLaunchAction ? 'ENGAGE WAVE' : 'TACTICAL PAUSE',
    });
    const waveHov =
      hoveredButtonId === (isLaunchAction ? 'wave-launch' : 'perim-pause-toggle');
    ctx.fillStyle = isLaunchAction
      ? waveHov
        ? COLORS.AMBER_BRIGHT
        : COLORS.AMBER_CAUTION
      : sim.tacticalPaused
        ? 'rgba(255, 176, 0, 0.25)'
        : 'rgba(12, 34, 20, 0.94)';
    ctx.fillRect(12, curY, waveBtnW, waveH);
    ctx.strokeStyle = isLaunchAction ? '#FFF3CC' : '#FFB000';
    ctx.lineWidth = 2.2;
    ctx.strokeRect(12, curY, waveBtnW, waveH);

    ctx.textAlign = 'center';
    ctx.font = 'bold 15.5px "Share Tech Mono", monospace';
    ctx.fillStyle = isLaunchAction ? '#040905' : '#FFB000';
    ctx.fillText(
      sim.trainingMode
        ? params.tutorialDirective.showContinueBtn
          ? '► BEGIN DRILL [ENTER] ◄'
          : sim.tacticalPaused
            ? '► RESUME [SPACE]'
            : '❚❚ TACTICAL PAUSE'
        : isLaunchAction
          ? `► LAUNCH WAVE ${String(sim.waveNumber).padStart(2, '0')} ◄`
          : sim.tacticalPaused
            ? '► RESUME [SPACE]'
            : '❚❚ TACTICAL PAUSE',
      12 + waveBtnW * 0.5,
      curY + 25
    );

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
    ctx.strokeStyle = sim.fastForward2x ? '#44FF77' : COLORS.GREEN_MID;
    ctx.lineWidth = sim.fastForward2x ? 2.4 : 1.8;
    ctx.strokeRect(speedX, curY, speedW, waveH);
    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    ctx.fillStyle = sim.fastForward2x ? '#9EF5B8' : COLORS.GREEN_BRIGHT;
    ctx.fillText(sim.fastForward2x ? '2X: ON' : '1X -> 2X', speedX + speedW * 0.5, curY + 25);

    curY += waveH + 7;

    // 4. Unit / Bulkhead Door Inspector Sub-Panel
    const inspH = Math.max(195, baseH - curY - 8);
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
    ctx.strokeStyle = COLORS.GREEN_MID;
    ctx.lineWidth = 1.8;
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
      const mkLabel =
        t.level === 3 && t.mk3Branch
          ? `MK-III ${MK3_BRANCH_SPECS[t.kind][t.mk3Branch].code}`
          : t.level === 2
            ? 'MK-II'
            : 'MK-I';

      ctx.textAlign = 'left';
      ctx.font = 'bold 15.5px "Share Tech Mono", monospace';
      ctx.fillStyle = inBlackout ? COLORS.RED_KLAXON : t.level === 3 ? '#00F0FF' : '#FFB000';
      ctx.fillText(
        `INSPECTOR // ${t.callsign} (${spec.code} ${mkLabel})`,
        x + 12,
        y + 21,
        w - 24
      );

      ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
      ctx.fillStyle = inBlackout
        ? COLORS.RED_KLAXON
        : t.acidDebuffTimer > 0
          ? '#B8FF3B'
          : t.jammedTimer > 0
            ? '#E066FF'
            : isReloading
              ? '#FFD466'
              : '#52FF86';
      const rdsText = inBlackout
        ? `BLACKOUT (${sim.blackoutTimer.toFixed(1)}S)`
        : t.acidDebuffTimer > 0
          ? `ACID CORRODED (${t.acidDebuffTimer.toFixed(1)}S)`
          : t.jammedTimer > 0
            ? `RADAR JAMMED (${t.jammedTimer.toFixed(1)}S)`
            : isReloading
              ? `BELT FEED: ${t.rearmTimer.toFixed(1)}S`
              : t.kind === 'SENTRY_PULSE'
                ? `ROUNDS: ${String(t.ammo).padStart(3, '0')}/${t.maxAmmo}`
                : t.kind === 'MOTION_RELAY'
                  ? `WIRE INT: ${Math.round(t.tripwireIntegrity)}%`
                  : `PWR: ${t.powered ? `${liveKw} kW` : 'OFFLINE'}`;
      ctx.fillText(`${rdsText}  |  KILLS: ${t.kills}`, x + 12, y + 40, w - 24);

      // BARREL TEMP % or LIVE RELOAD PROGRESS Stepped Vernier Bar
      const barX = x + 60;
      const barW = w - 118;
      if (isReloading) {
        const reloadFrac = Math.max(
          0,
          Math.min(1, 1 - t.rearmTimer / Math.max(0.1, t.rearmDuration))
        );
        ctx.fillStyle = '#FFD466';
        ctx.fillText('FEED:', x + 12, y + 60);
        ctx.strokeStyle = '#FFB000';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(barX, y + 48, barW, 14);
        ctx.fillStyle = '#FFB000';
        ctx.fillRect(barX + 1, y + 49, Math.max(0, (barW - 2) * reloadFrac), 12);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#FFE082';
        ctx.fillText(`${Math.round(reloadFrac * 100)}%`, x + w - 12, y + 60);
      } else {
        ctx.fillStyle = '#9EF5B8';
        ctx.fillText('TEMP:', x + 12, y + 60);
        ctx.strokeStyle = COLORS.GREEN_DIM;
        ctx.lineWidth = 1.4;
        ctx.strokeRect(barX, y + 48, barW, 14);
        const tempCol = t.thermalLocked || t.heat > 80 ? COLORS.RED_KLAXON : '#FFB000';
        ctx.fillStyle = tempCol;
        ctx.fillRect(barX + 1, y + 49, Math.max(0, ((barW - 2) * t.heat) / 100), 12);

        ctx.textAlign = 'right';
        ctx.fillStyle = tempCol;
        ctx.fillText(`${Math.round(t.heat)}%`, x + w - 12, y + 60);
      }

      // Action Buttons Grid inside Inspector (supports MK-I -> MK-II -> Branching MK-III A/B!)
      const btnGap = 6;
      const innerW = w - 24;
      const halfW = (innerW - btnGap) * 0.5;
      let by = y + 69;
      const bh = t.level === 2 ? 29 : 32;

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
        ctx.lineWidth = hov ? 2.0 : 1.6;
        ctx.strokeRect(bx, rowY, bw, btnH);
        ctx.textAlign = 'center';
        ctx.font = 'bold 12.5px "Share Tech Mono", monospace';
        ctx.fillStyle = hov ? '#FFFFFF' : accent;
        ctx.fillText(lbl, bx + bw * 0.5, rowY + btnH * 0.65, bw - 8);
      };

      const isRotating =
        activeTool.kind === 'ROTATE_TURRET' && activeTool.turretId === t.id;
      const isOmni = t.kind === 'CRYO_VALVE' || t.kind === 'SHOCK_COIL';

      // Row 1: Sentry gets [REARM] + [ROTATE]; Directional non-sentry gets full-width [ROTATE ARC]
      if (t.kind === 'SENTRY_PULSE') {
        const rCost = sim.getRearmCostFor(t);
        addInspBtn(
          'insp-rearm',
          x + 12,
          by,
          halfW,
          bh,
          isReloading
            ? `LOAD ${t.rearmTimer.toFixed(1)}S`
            : rCost > 0
              ? `[E] REARM (${rCost}S)`
              : 'DRUM FULL',
          isReloading ? '#FFE082' : t.ammo === 0 ? COLORS.RED_KLAXON : '#FFB000',
          isReloading
        );
        addInspBtn(
          'insp-rotate',
          x + 12 + halfW + btnGap,
          by,
          halfW,
          bh,
          isRotating ? 'AIMING CONE...' : '[R] ROTATE ARC',
          '#52FF86',
          isRotating
        );
        by += bh + 5;
      } else if (!isOmni) {
        addInspBtn(
          'insp-rotate',
          x + 12,
          by,
          innerW,
          bh,
          isRotating ? 'CLICK CORRIDOR TO SET AIM...' : '[R] ROTATE FIRING / SENSOR ARC',
          '#52FF86',
          isRotating
        );
        by += bh + 5;
      }

      let invested = spec.costScrap + (t.level >= 2 ? spec.upgradeCostScrap : 0);
      if (t.level === 3 && t.mk3Branch) {
        invested += MK3_BRANCH_SPECS[t.kind][t.mk3Branch].costScrap;
      }
      const refund = Math.round(invested * 0.65);

      if (t.level === 1) {
        addInspBtn(
          'insp-power',
          x + 12,
          by,
          halfW,
          bh,
          t.powered ? `[P] OFFLINE (-${liveKw}kW)` : `[P] ONLINE (+${liveKw}kW)`,
          t.powered ? '#52FF86' : '#FFB000'
        );
        addInspBtn(
          'insp-upgrade',
          x + 12 + halfW + btnGap,
          by,
          halfW,
          bh,
          `[U] MK-II (${spec.upgradeCostScrap}S)`,
          '#FFB000'
        );
        by += bh + 5;
        addInspBtn(
          'insp-scrap',
          x + 12,
          by,
          innerW,
          bh,
          `[DEL] SCRAP / RECYCLE (+${refund} SCRAP)`,
          COLORS.RED_KLAXON
        );
      } else if (t.level === 2) {
        // Row 2: Power & Recycle on same row so MK-III Branch A / B cards get generous space!
        addInspBtn(
          'insp-power',
          x + 12,
          by,
          halfW,
          bh,
          t.powered ? `[P] OFF (-${liveKw}kW)` : `[P] ON (+${liveKw}kW)`,
          t.powered ? '#52FF86' : '#FFB000'
        );
        addInspBtn(
          'insp-scrap',
          x + 12 + halfW + btnGap,
          by,
          halfW,
          bh,
          `[DEL] SCRAP (+${refund}S)`,
          COLORS.RED_KLAXON
        );
        by += bh + 6;

        // Branching MK-III Specialization Picker (Branch A vs Branch B!)
        ctx.textAlign = 'left';
        ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
        ctx.fillStyle = '#00F0FF';
        ctx.fillText('★ CHOOSE MK-III SPECIALIZATION:', x + 12, by + 10);
        by += 15;

        const branchH = Math.max(46, Math.min(62, y + h - by - 8));
        const branches: Array<{ id: 'insp-upgrade-a' | 'insp-upgrade-b'; key: 'A' | 'B' }> = [
          { id: 'insp-upgrade-a', key: 'A' },
          { id: 'insp-upgrade-b', key: 'B' },
        ];
        branches.forEach((br, idx) => {
          const bSpec = MK3_BRANCH_SPECS[t.kind][br.key];
          const bx = x + 12 + idx * (halfW + btnGap);
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
            label: `MK-III ${bSpec.code}`,
          });
          ctx.fillStyle = hov
            ? 'rgba(0, 240, 255, 0.24)'
            : canBuy
              ? 'rgba(6, 26, 30, 0.94)'
              : 'rgba(14, 14, 14, 0.92)';
          ctx.fillRect(bx, by, halfW, branchH);
          ctx.strokeStyle = hov ? '#FFFFFF' : canBuy ? '#00F0FF' : COLORS.GREEN_DIM;
          ctx.lineWidth = hov ? 2.0 : 1.5;
          ctx.strokeRect(bx, by, halfW, branchH);

          ctx.textAlign = 'left';
          ctx.font = 'bold 12px "Share Tech Mono", monospace';
          ctx.fillStyle = canBuy ? '#70F8FF' : COLORS.GREEN_MID;
          ctx.fillText(`III-${br.key} ${bSpec.code}`, bx + 6, by + 15, halfW - 12);

          ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
          ctx.fillStyle = canBuy ? '#FFB000' : COLORS.RED_KLAXON;
          ctx.fillText(
            `${bSpec.costScrap}S · +${bSpec.extraKw}kW`,
            bx + 6,
            by + 29,
            halfW - 12
          );

          ctx.fillStyle = canBuy ? '#C2F8FF' : '#588C68';
          ctx.fillText(bSpec.summary, bx + 6, by + branchH - 7, halfW - 12);
        });
      } else {
        // MK-III Installed View
        const bSpec = t.mk3Branch ? MK3_BRANCH_SPECS[t.kind][t.mk3Branch] : null;
        addInspBtn(
          'insp-power',
          x + 12,
          by,
          halfW,
          bh,
          t.powered ? `[P] OFFLINE (-${liveKw}kW)` : `[P] ONLINE (+${liveKw}kW)`,
          t.powered ? '#52FF86' : '#FFB000'
        );
        addInspBtn(
          'insp-scrap',
          x + 12 + halfW + btnGap,
          by,
          halfW,
          bh,
          `[DEL] SCRAP (+${refund}S)`,
          COLORS.RED_KLAXON
        );
        by += bh + 8;

        if (bSpec) {
          ctx.fillStyle = 'rgba(6, 26, 30, 0.92)';
          ctx.fillRect(x + 12, by, innerW, 42);
          ctx.strokeStyle = '#00F0FF';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x + 12, by, innerW, 42);
          ctx.textAlign = 'center';
          ctx.font = 'bold 12.5px "Share Tech Mono", monospace';
          ctx.fillStyle = '#00F0FF';
          ctx.fillText(`★ MK-III ${bSpec.code} SPECIALIZATION ACTIVE ★`, x + w * 0.5, by + 17, innerW - 12);
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          ctx.fillStyle = '#C2F8FF';
          ctx.fillText(bSpec.summary, x + w * 0.5, by + 34, innerW - 12);
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
        ctx.font = 'bold 16px "Share Tech Mono", monospace';
        ctx.fillStyle = '#FFB000';
        ctx.fillText(`BULKHEAD // ${ds.def.label}`, x + 12, y + 23, w - 24);

        ctx.font = 'bold 13px "JetBrains Mono", monospace';
        ctx.fillStyle = isWelding
          ? '#FFE082'
          : ds.welded
            ? '#52FF86'
            : COLORS.AMBER_CAUTION;
        ctx.fillText(
          isWelding
            ? `ARC-WELDING SEAL (${ds.weldingTimer.toFixed(1)}S) · ${activeSeals}/${maxSeals}`
            : ds.welded
              ? `SEALED (${Math.round(ds.hp)}/${ds.maxHp} HP) · SEALS ${activeSeals}/${maxSeals}`
              : `OPEN CORRIDOR · SEALS ${activeSeals}/${maxSeals}`,
          x + 12,
          y + 46,
          w - 24
        );

        const bh = 38;
        if (isWelding) {
          const frac = Math.max(
            0,
            Math.min(1, 1 - ds.weldingTimer / Math.max(0.1, ds.weldingDuration))
          );
          ctx.fillStyle = 'rgba(28, 18, 4, 0.92)';
          ctx.fillRect(x + 12, y + 66, w - 24, 34);
          ctx.fillStyle = 'rgba(255, 176, 0, 0.42)';
          ctx.fillRect(x + 13, y + 67, (w - 26) * frac, 32);
          ctx.strokeStyle = '#FFB000';
          ctx.lineWidth = 2.0;
          ctx.strokeRect(x + 12, y + 66, w - 24, 34);
          ctx.textAlign = 'center';
          ctx.font = 'bold 14px "Share Tech Mono", monospace';
          ctx.fillStyle = '#FFE082';
          ctx.fillText(
            `TORCH SEALING ${Math.round(frac * 100)}% (${ds.weldingTimer.toFixed(1)}S)`,
            x + w * 0.5,
            y + 88,
            w - 32
          );
        } else if (!ds.welded) {
          const sealCapped = activeSeals >= maxSeals;
          const cooling = ds.repairCooldown > 0;
          const canWeldNow = !sealCapped && !cooling;
          this.buttons.push({
            id: 'door-weld',
            rect: {
              x: panelScreenRect.x + (x + 12) * s,
              y: panelScreenRect.y + (y + 66) * s,
              width: (w - 24) * s,
              height: bh * s,
            },
            label: 'WELD SEAL',
          });
          ctx.fillStyle = canWeldNow
            ? 'rgba(255, 176, 0, 0.24)'
            : 'rgba(34, 14, 10, 0.88)';
          ctx.fillRect(x + 12, y + 66, w - 24, bh);
          ctx.strokeStyle = canWeldNow ? '#FFB000' : COLORS.RED_KLAXON;
          ctx.lineWidth = 2.0;
          ctx.strokeRect(x + 12, y + 66, w - 24, bh);
          ctx.textAlign = 'center';
          ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
          ctx.fillStyle = canWeldNow ? '#FFE082' : '#FF7766';
          ctx.fillText(
            sealCapped
              ? `MAX ${maxSeals} SEALS ACTIVE — UNSEAL ONE FIRST`
              : cooling
                ? `TORCH COOLING (${ds.repairCooldown.toFixed(1)}S)`
                : `WELD SEAL (${weldCost}S${sim.phase === 'WAVE_ACTIVE' ? ' · 2.0S' : ''})`,
            x + w * 0.5,
            y + 90,
            w - 32
          );
        } else {
          if (ds.hp < ds.maxHp - 5) {
            const repCost = Math.max(18, Math.round(weldCost * (1 - ds.hp / ds.maxHp)));
            const cooling = ds.repairCooldown > 0;
            this.buttons.push({
              id: 'door-repair',
              rect: {
                x: panelScreenRect.x + (x + 12) * s,
                y: panelScreenRect.y + (y + 62) * s,
                width: (w - 24) * s,
                height: 34 * s,
              },
              label: 'REINFORCE WELD',
            });
            ctx.fillStyle = cooling ? 'rgba(30, 14, 10, 0.9)' : 'rgba(28, 18, 4, 0.9)';
            ctx.fillRect(x + 12, y + 62, w - 24, 34);
            ctx.strokeStyle = cooling ? COLORS.RED_KLAXON : '#FFB000';
            ctx.lineWidth = 1.8;
            ctx.strokeRect(x + 12, y + 62, w - 24, 34);
            ctx.textAlign = 'center';
            ctx.font = 'bold 14px "Share Tech Mono", monospace';
            ctx.fillStyle = cooling ? '#FF7766' : '#FFB000';
            ctx.fillText(
              cooling
                ? `TORCH COOLING (${ds.repairCooldown.toFixed(1)}S)`
                : `REINFORCE WELD (${repCost}S${sim.phase === 'WAVE_ACTIVE' ? ' · 2.0S' : ''})`,
              x + w * 0.5,
              y + 84,
              w - 32
            );
          }

          this.buttons.push({
            id: 'door-unseal',
            rect: {
              x: panelScreenRect.x + (x + 12) * s,
              y: panelScreenRect.y + (y + 104) * s,
              width: (w - 24) * s,
              height: 34 * s,
            },
            label: 'UNSEAL DOOR',
          });
          ctx.fillStyle = 'rgba(6, 22, 12, 0.9)';
          ctx.fillRect(x + 12, y + 104, w - 24, 34);
          ctx.strokeStyle = '#52FF86';
          ctx.lineWidth = 1.8;
          ctx.strokeRect(x + 12, y + 104, w - 24, 34);
          ctx.textAlign = 'center';
          ctx.font = 'bold 14px "Share Tech Mono", monospace';
          ctx.fillStyle = '#52FF86';
          ctx.fillText('UNSEAL BLAST DOOR [OPEN ROUTE]', x + w * 0.5, y + 126, w - 32);
        }
        return;
      }
    }

    // Default Tactical Operator Reference inside Inspector + Quick Wiki & Training Buttons
    ctx.textAlign = 'left';
    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFBE2E';
    ctx.fillText('UNIT INSPECTOR // TACTICAL GUIDE', x + 12, y + 20, w - 24);

    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    const tips = [
      '• [1-8] ARSENAL: RAIL PIERCES · COIL STUNS · M18 MINE',
      '• UPGRADE MK-I -> MK-II -> BRANCHING MK-III (A / B)',
      '• RESERVE BATTERY BUFFERS OVERLOAD OR [L] FLOODLIGHT',
      '• [C] COOLANT FLUSH VENTS HEAT & CLEARS SPITTER ACID',
      '• [X] SHED AUX FREES kW · [E] REARM ALL · [O×2] QUICK',
      '• EVERY 3 WAVES: PROTOCOL DRAFT · BOSSES W5 / W10+',
    ];
    const footerBtnH = 26;
    const availTipsH = Math.max(76, h - 38 - footerBtnH - 12);
    const lineStep = Math.min(18, Math.floor(availTipsH / tips.length));
    tips.forEach((line, i) => {
      ctx.fillStyle = i === 1 || i === 2 || i === 5 ? '#FFD15C' : '#B4FCCC';
      ctx.fillText(line, x + 12, y + 39 + i * lineStep, w - 24);
    });

    // Quick-Launch Wiki [H] & Training Drill [T] Strip inside Inspector
    const qBtnY = y + h - footerBtnH - 8;
    const qGap = 6;
    const qBtnW = (w - 24 - qGap) * 0.5;
    const quickItems: Array<{ id: string; label: string; accent: string }> = [
      { id: 'perim-wiki-open', label: '[H] TACTICAL WIKI', accent: '#00F0FF' },
      {
        id: sim.trainingMode ? 'perim-drill-exit' : 'perim-drill-start',
        label: sim.trainingMode ? 'EXIT SIM DRILL' : '[T] TRAINING DRILL',
        accent: '#FFB000',
      },
    ];
    quickItems.forEach((q, qi) => {
      const qx = x + 12 + qi * (qBtnW + qGap);
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
      ctx.fillStyle = qHov ? 'rgba(0, 240, 255, 0.24)' : 'rgba(6, 20, 14, 0.94)';
      ctx.fillRect(qx, qBtnY, qBtnW, footerBtnH);
      ctx.strokeStyle = qHov ? '#FFFFFF' : q.accent;
      ctx.lineWidth = qHov ? 1.9 : 1.4;
      ctx.strokeRect(qx, qBtnY, qBtnW, footerBtnH);
      ctx.textAlign = 'center';
      ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
      ctx.fillStyle = qHov ? '#FFFFFF' : q.accent;
      ctx.fillText(q.label, qx + qBtnW * 0.5, qBtnY + 17, qBtnW - 8);
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
    this.drawCornerBrackets(ctx, r.x, r.y, r.width, r.height, 10, COLORS.GREEN_DIM, 1.8);

    const recent = sim.eventLogs.slice(-2);
    const fontPx = Math.max(12, Math.min(13.5, Math.floor(r.height / 3.4)));
    ctx.font = `bold ${fontPx}px "JetBrains Mono", monospace`;
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
        ? '#FFB000'
        : isCombo
          ? '#66FF99'
          : isLatest
            ? '#8EF5AB'
            : COLORS.GREEN_MID;

      let clipped = entry;
      while (clipped.length > 12 && ctx.measureText(clipped).width > r.width - 30) {
        clipped = `${clipped.slice(0, -2)}…`;
      }
      ctx.fillText(clipped, r.x + 12, ly);

      if (isLatest && Math.sin(timeSec * 10) > 0) {
        const tw = ctx.measureText(clipped).width;
        ctx.fillStyle = '#44FF77';
        ctx.fillRect(r.x + 15 + tw, ly - fontPx + 2, 8, fontPx);
      }
    });

    ctx.restore();
  }

  private drawToastBanner(
    ctx: CanvasRenderingContext2D,
    text: string,
    vp: ViewportRect
  ): void {
    ctx.save();
    ctx.font = 'bold 15px "Share Tech Mono", monospace';
    const tw = ctx.measureText(text).width + 32;
    const bx = vp.x + (vp.width - tw) * 0.5;
    const by = vp.y + vp.height - 44;

    ctx.fillStyle = 'rgba(12, 22, 14, 0.95)';
    ctx.fillRect(bx, by, tw, 32);
    ctx.strokeStyle = '#FFB000';
    ctx.lineWidth = 2.0;
    ctx.strokeRect(bx, by, tw, 32);
    ctx.fillStyle = '#FFD466';
    ctx.textAlign = 'center';
    ctx.fillText(text, vp.x + vp.width * 0.5, by + 21);
    ctx.restore();
  }

  // ===========================================================================
  // BRIEFING, VICTORY/BREACH, CALLSIGN & SYSTEM OSD MODALS
  // ===========================================================================

  private drawBriefingOverlay(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams
  ): void {
    const { width: w, height: h, hoveredButtonId } = params;
    const boxW = Math.min(740, w - 40);
    const boxH = Math.min(506, h - 34);
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.save();
    ctx.fillStyle = 'rgba(4, 12, 7, 0.96)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 20, '#FFB000', 2.8);

    drawRankedTitleRibbon(
      ctx,
      bx + 24,
      by + 10,
      boxW - 48,
      24,
      '★ RANKED ENDLESS HIVE SIEGE ARMED — HIGH SCORE RECORDED TO PERIMETER_SCORES ★',
      params.timeSec,
      true
    );

    ctx.textAlign = 'center';
    ctx.font = 'bold 26px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.RED_KLAXON;
    ctx.fillText("HADLEY'S PERIMETER // ENDLESS HIVE SIEGE", w * 0.5, by + 62);

    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(
      'SEC-01: HADLEY MED-LAB & SUB-LEVEL DUCTS // SURVIVE INFINITE ESCALATING WAVES',
      w * 0.5,
      by + 84
    );

    // Live Global #01 Perimeter Leader Ticker (from Firestore perimeter_scores)
    const leader = params.manifest.getReigningLeader();
    const uplink = params.manifest.getStatus();
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    const leadBanner = leader
      ? `#01 GLOBAL LEADER: ${leader.callsign} — ${leader.score.toLocaleString()} PTS (WAVE ${String(leader.waves).padStart(2, '0')} | ${leader.kills} KILLS)`
      : uplink === 'LOADING'
        ? 'SYNCING MU-TH-UR PERIMETER_SCORES UPLINK...'
        : '#01 GLOBAL LEADER: UNCLAIMED — HOLD THE MED-LAB AS LONG AS YOU CAN';
    ctx.fillText(leadBanner, w * 0.5, by + 106, boxW - 56);

    // Single-Mode Mission Briefing Divider Strip
    ctx.fillStyle = 'rgba(255, 176, 0, 0.12)';
    ctx.fillRect(bx + 28, by + 118, boxW - 56, 26);
    ctx.strokeStyle = 'rgba(255, 176, 0, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(bx + 28, by + 118, boxW - 56, 26);
    ctx.font = 'bold 13px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFE082';
    ctx.fillText(
      'DIRECTIVE: PROTECT ALL 3 REACTOR CORE BULKHEAD SEALS — NO EXTRACTION',
      w * 0.5,
      by + 135,
      boxW - 72
    );

    const rules = [
      '1. 8-UNIT ARSENAL [1-8] & MK-III BRANCHES: M99 RAIL-LANCE, ARC-SHOCK COIL,',
      '   AND 0 kW M18 CLAYMORES JOIN YOUR SENTRY/NAPALM/CRYO/RELAY LINEUP!',
      '2. REACTOR BATTERY & SYSTEMS: UNUSED kW CHARGES RESERVE BATTERY TO BUFFER',
      '   OVERLOADS OR FIRE [L] FLOODLIGHT. USE [C] COOLANT FLUSH & [X] SHED AUX!',
      '3. BOSSES, MUTATORS & PROTOCOLS: SURVIVE CRUSHER (W5) & QUEEN (W10) BOSSES,',
      '   STATION MUTATORS (+50% SCORE), AND PICK MU-TH-UR PROTOCOLS EVERY 3 WAVES!',
    ];

    ctx.textAlign = 'left';
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    rules.forEach((line, idx) => {
      ctx.fillStyle = idx === 1 || idx === 3 || idx === 5 ? '#FFB000' : COLORS.GREEN_PRIMARY;
      ctx.fillText(line, bx + 28, by + 172 + idx * 25, boxW - 56);
    });

    // Primary Ranked Launch CTA
    const btnPad = 28;
    const fullBtnW = boxW - btnPad * 2;
    this.addScaledButton(
      ctx,
      'briefing-engage',
      { x: bx + btnPad, y: by + boxH - 114, width: fullBtnW, height: 44 },
      '► LAUNCH RANKED ENDLESS SIEGE [ENTER] ◄',
      true,
      hoveredButtonId,
      '#FFB000',
      17
    );

    // Secondary 2-Column Onboarding Row: Live Interactive Training Drill + Full MU-TH-UR Wiki
    const secGap = 12;
    const secW = (fullBtnW - secGap) * 0.5;
    const secY = by + boxH - 58;
    this.addScaledButton(
      ctx,
      'perim-drill-start',
      { x: bx + btnPad, y: secY, width: secW, height: 40 },
      '► INTERACTIVE TRAINING DRILL [T] ◄',
      false,
      hoveredButtonId,
      '#00F0FF',
      14.5
    );
    this.addScaledButton(
      ctx,
      'perim-wiki-open',
      { x: bx + btnPad + secW + secGap, y: secY, width: secW, height: 40 },
      'MU-TH-UR TACTICAL WIKI [H]',
      false,
      hoveredButtonId,
      '#44FF77',
      14.5
    );
    ctx.restore();
  }

  private drawProtocolDraftModal(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams
  ): void {
    const { width: w, height: h, sim, hoveredButtonId } = params;
    const boxW = Math.min(840, w - 40);
    const boxH = Math.min(410, h - 44);
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.save();
    // Dim background CAD slightly so the 3 protocol cards pop unmistakably
    ctx.fillStyle = 'rgba(1, 5, 3, 0.72)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(4, 13, 8, 0.98)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 22, '#00F0FF', 2.8);

    ctx.textAlign = 'center';
    ctx.font = 'bold 23px "Share Tech Mono", monospace';
    ctx.fillStyle = '#00F0FF';
    ctx.fillText('★ MU-TH-UR 6000 // TACTICAL PROTOCOL DRAFT ★', w * 0.5, by + 38);

    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(
      `WAVE ${String(Math.max(1, sim.waveNumber - 1)).padStart(2, '0')} CLEARED — INSTALL ONE PERMANENT DIRECTIVE FOR WAVE ${String(sim.waveNumber).padStart(2, '0')}+ [PRESS 1 / 2 / 3]`,
      w * 0.5,
      by + 64,
      boxW - 44
    );

    const choices = sim.protocolDraftChoices;
    const cardGap = 14;
    const innerW = boxW - 48;
    const cardW = (innerW - cardGap * 2) / 3;
    const cardH = boxH - 152;
    const cardY = by + 84;

    choices.forEach((protoId, idx) => {
      const spec = TACTICAL_PROTOCOLS[protoId];
      const cx = bx + 24 + idx * (cardW + cardGap);
      const btnId = `proto-${idx}`;
      const hov = hoveredButtonId === btnId;
      const curStacks = sim.getProtocolStacks(protoId);

      this.buttons.push({
        id: btnId,
        rect: { x: cx, y: cardY, width: cardW, height: cardH },
        label: spec.title,
      });

      ctx.fillStyle = hov ? 'rgba(0, 240, 255, 0.16)' : 'rgba(6, 20, 14, 0.95)';
      ctx.fillRect(cx, cardY, cardW, cardH);
      ctx.strokeStyle = hov ? '#FFFFFF' : spec.accent;
      ctx.lineWidth = hov ? 2.8 : 2.0;
      ctx.strokeRect(cx, cardY, cardW, cardH);

      // Top key + code badge row
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(cx + 10, cardY + 10, cardW - 20, 28);
      ctx.strokeStyle = spec.accent;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(cx + 10, cardY + 10, cardW - 20, 28);

      ctx.textAlign = 'left';
      ctx.font = 'bold 14px "Share Tech Mono", monospace';
      ctx.fillStyle = '#FFE082';
      ctx.fillText(`[${idx + 1}] ${spec.code}`, cx + 18, cardY + 29);

      ctx.textAlign = 'right';
      ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
      ctx.fillStyle = curStacks > 0 ? '#00F0FF' : '#8EF5AB';
      ctx.fillText(
        curStacks > 0 ? `LVL ${curStacks + 1}/${spec.maxStacks}` : 'NEW',
        cx + cardW - 18,
        cardY + 28
      );

      // Protocol Title (2-line safe wrap)
      ctx.textAlign = 'center';
      ctx.font = 'bold 15.5px "Share Tech Mono", monospace';
      ctx.fillStyle = hov ? '#FFFFFF' : spec.accent;
      const titleWords = spec.title.split(' ');
      let tLine1 = '';
      let tLine2 = '';
      for (const word of titleWords) {
        if ((tLine1 + ' ' + word).trim().length <= 18) {
          tLine1 = (tLine1 + ' ' + word).trim();
        } else {
          tLine2 = (tLine2 + ' ' + word).trim();
        }
      }
      ctx.fillText(tLine1, cx + cardW * 0.5, cardY + 68, cardW - 20);
      if (tLine2) {
        ctx.fillText(tLine2, cx + cardW * 0.5, cardY + 88, cardW - 20);
      }

      // Description lines (split on ' · ' cleanly)
      const parts = spec.desc.split(' · ');
      ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#C6FAD6';
      parts.forEach((part, pIdx) => {
        ctx.fillText(part, cx + cardW * 0.5, cardY + 126 + pIdx * 24, cardW - 20);
      });

      // Bottom install bar
      const actY = cardY + cardH - 42;
      ctx.fillStyle = hov ? spec.accent : 'rgba(18, 42, 28, 0.92)';
      ctx.fillRect(cx + 12, actY, cardW - 24, 30);
      ctx.strokeStyle = spec.accent;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(cx + 12, actY, cardW - 24, 30);
      ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
      ctx.fillStyle = hov ? '#040905' : '#FFFFFF';
      ctx.fillText(`► INSTALL [${idx + 1}] ◄`, cx + cardW * 0.5, actY + 20);
    });

    // Footer listing already active protocols
    const installedList = Object.entries(sim.activeProtocols)
      .filter(([, cnt]) => (cnt ?? 0) > 0)
      .map(([k, cnt]) => {
        const p = TACTICAL_PROTOCOLS[k as keyof typeof TACTICAL_PROTOCOLS];
        return `${p.code}${cnt && cnt > 1 ? `×${cnt}` : ''}`;
      });
    ctx.textAlign = 'center';
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText(
      installedList.length > 0
        ? `INSTALLED PROTOCOLS: ${installedList.join('  |  ')}`
        : 'FIRST TACTICAL DIRECTIVE OF THIS ENDLESS SIEGE DEPLOYMENT',
      w * 0.5,
      by + boxH - 22,
      boxW - 44
    );

    ctx.restore();
  }

  private drawEndOfRunOverlay(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams
  ): void {
    const { width: w, height: h, sim, hoveredButtonId } = params;
    const boxW = Math.min(640, w - 48);
    const boxH = 280;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.save();
    ctx.fillStyle = 'rgba(5, 13, 8, 0.96)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.RED_KLAXON, 2.6);

    ctx.textAlign = 'center';
    ctx.font = 'bold 24px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.RED_KLAXON;
    ctx.fillText('CRITICAL BREACH // REACTOR CORE OVERRUN', w * 0.5, by + 44);

    ctx.font = 'bold 16px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(
      `WAVE REACHED: ${sim.waveNumber}  |  HOSTILES NEUTRALIZED: ${sim.totalKills}  |  SCORE: ${sim.score.toLocaleString()}`,
      w * 0.5,
      by + 92
    );

    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(
      'ALL 3 BULKHEAD SEALS DESTROYED // TRANSMITTING FINAL ENDLESS SIEGE LOG',
      w * 0.5,
      by + 128
    );

    this.addScaledButton(
      ctx,
      'end-to-callsign',
      { x: w * 0.5 - 210, y: by + boxH - 68, width: 420, height: 44 },
      '[ ENTER / SPACE ] LOG RUN TO CREW MANIFEST',
      true,
      hoveredButtonId,
      '#FFB000',
      16.5
    );
    ctx.restore();
  }

  private drawCallsignEntryModal(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams
  ): void {
    const {
      width: w,
      height: h,
      sim,
      callsignDraft,
      scoreSubmitted,
      submittingScore,
      submitResultBanner,
      hoveredButtonId,
      timeSec,
    } = params;
    const boxW = Math.min(640, w - 48);
    const boxH = 382;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.save();
    ctx.fillStyle = 'rgba(5, 13, 8, 0.97)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, '#FFB000', 2.6);

    ctx.textAlign = 'center';
    ctx.font = 'bold 22px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('MU-TH-UR // PERIMETER_SCORES TELEMETRY LOG', w * 0.5, by + 38);

    ctx.font = 'bold 15px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText(
      `SCORE: ${sim.score.toLocaleString()}  |  WAVE: ${sim.waveNumber}  |  KILLS: ${sim.totalKills}  |  ENDLESS SIEGE`,
      w * 0.5,
      by + 68,
      boxW - 44
    );

    ctx.textAlign = 'left';
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#44FF77';
    ctx.fillText(
      'OPERATOR CALLSIGN (A-Z, 0-9, _, -, MAX 12 // [ENTER] SUBMIT):',
      bx + 32,
      by + 104
    );

    const inW = boxW - 64;
    const inX = bx + 32;
    const inY = by + 114;
    ctx.fillStyle = '#020704';
    ctx.fillRect(inX, inY, inW, 48);
    ctx.strokeStyle = scoreSubmitted ? '#44FF77' : '#FFB000';
    ctx.lineWidth = 2.2;
    ctx.strokeRect(inX, inY, inW, 48);

    const cursor = !scoreSubmitted && Math.sin(timeSec * 10) > 0 ? '█' : '';
    ctx.font = 'bold 23px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFF6CC';
    ctx.fillText(`> ${callsignDraft}${cursor}`, inX + 14, inY + 32);

    this.buttons.push({
      id: 'perim-callsign-focus',
      rect: { x: inX, y: inY, width: inW, height: 48 },
      label: 'EDIT CALLSIGN',
    });

    if (submitResultBanner) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#8EF5AB';
      ctx.fillText(submitResultBanner, w * 0.5, inY + 74, boxW - 48);
    }

    const primaryBtnY = by + boxH - 122;
    if (!scoreSubmitted) {
      this.addScaledButton(
        ctx,
        'perim-save-callsign',
        { x: bx + 32, y: primaryBtnY, width: boxW - 64, height: 44 },
        submittingScore
          ? 'TRANSMITTING TO MU-TH-UR UPLINK...'
          : '► TRANSMIT SCORE TO PERIMETER_SCORES [ENTER] ◄',
        true,
        hoveredButtonId,
        '#FFB000',
        15.5
      );
    } else {
      this.addScaledButton(
        ctx,
        'perim-manifest',
        { x: bx + 32, y: primaryBtnY, width: boxW - 64, height: 44 },
        'VIEW GLOBAL PERIMETER_SCORES LEADERBOARD',
        false,
        hoveredButtonId,
        '#8EF5AB',
        15.5
      );
    }

    const footY = by + boxH - 64;
    const footGap = 12;
    const halfW = (boxW - 64 - footGap) * 0.5;
    this.addScaledButton(
      ctx,
      'perim-new-run',
      { x: bx + 32, y: footY, width: halfW, height: 42 },
      'NEW DEPLOYMENT',
      false,
      hoveredButtonId,
      '#44FF77',
      15.5
    );
    this.addScaledButton(
      ctx,
      'perim-exit-os',
      { x: bx + 32 + halfW + footGap, y: footY, width: halfW, height: 42 },
      'EXIT TO MU-TH-UR OS',
      false,
      hoveredButtonId,
      '#FFB000',
      15.5
    );
    ctx.restore();
  }

  private drawManifestModal(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams
  ): void {
    const { width: w, height: h, manifest, hoveredButtonId, lastSubmittedRun, timeSec } = params;
    const boxW = Math.min(780, w - 48);
    const boxH = Math.min(600, h - 44);
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    const { entries, showingArchiveFallback } = manifest.getManifestEntries();
    const uplink = manifest.getStatus();

    ctx.save();
    ctx.fillStyle = 'rgba(4, 12, 7, 0.98)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, '#44FF77', 2.4);

    ctx.textAlign = 'left';
    ctx.font = 'bold 20px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText("HADLEY'S PERIMETER // PERIMETER_SCORES", bx + 22, by + 34);

    ctx.textAlign = 'right';
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = uplink === 'LIVE' && !showingArchiveFallback ? '#44FF77' : '#FFB000';
    ctx.fillText(
      uplink === 'LIVE' && !showingArchiveFallback
        ? '● UPLINK: LIVE FIRESTORE'
        : '● LOCAL ARCHIVE FALLBACK',
      bx + boxW - 22,
      by + 33
    );

    const headY = by + 68;
    ctx.fillStyle = 'rgba(18, 44, 26, 0.72)';
    ctx.fillRect(bx + 18, headY - 18, boxW - 36, 26);

    ctx.textAlign = 'left';
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('RNK', bx + 26, headY);
    ctx.fillText('CALLSIGN', bx + 84, headY);
    ctx.fillText('WAVE', bx + 412, headY);
    ctx.fillText('KILLS', bx + 516, headY);
    ctx.textAlign = 'right';
    ctx.fillText('SCORE', bx + boxW - 26, headY);

    const availRowsH = boxH - 196;
    const maxRows = Math.min(14, Math.max(6, Math.floor(availRowsH / 28)));
    const visibleEntries = entries.slice(0, maxRows);

    let matchedJustIdx = -1;
    if (lastSubmittedRun) {
      if (lastSubmittedRun.docId) {
        matchedJustIdx = visibleEntries.findIndex((e) => e.id === lastSubmittedRun.docId);
      }
      if (matchedJustIdx === -1) {
        matchedJustIdx = visibleEntries.findIndex(
          (e) =>
            e.callsign.toUpperCase() === lastSubmittedRun.callsign.toUpperCase() &&
            e.score === lastSubmittedRun.score &&
            e.waves === lastSubmittedRun.waves
        );
      }
    }

    const pulseNew = 0.5 + 0.5 * Math.sin(timeSec * 8.5);
    visibleEntries.forEach((e, idx) => {
      const ry = headY + 28 + idx * 28;
      const isJustAdded = idx === matchedJustIdx;

      if (isJustAdded) {
        ctx.fillStyle = `rgba(68, 255, 119, ${(0.18 + pulseNew * 0.14).toFixed(3)})`;
        ctx.fillRect(bx + 16, ry - 18, boxW - 32, 27);
        ctx.strokeStyle = '#44FF77';
        ctx.lineWidth = 2.2;
        ctx.strokeRect(bx + 16, ry - 18, boxW - 32, 27);
      } else if (idx % 2 === 1) {
        ctx.fillStyle = 'rgba(16, 36, 22, 0.35)';
        ctx.fillRect(bx + 18, ry - 18, boxW - 36, 26);
      }

      ctx.textAlign = 'left';
      ctx.font = 'bold 14px "JetBrains Mono", monospace';
      ctx.fillStyle = isJustAdded ? '#FFFFFF' : idx === 0 ? '#FFB000' : idx < 3 ? '#8EF5AB' : '#44FF77';
      ctx.fillText(
        isJustAdded ? `►#${String(idx + 1).padStart(2, '0')}` : `#${String(idx + 1).padStart(2, '0')}`,
        isJustAdded ? bx + 20 : bx + 26,
        ry
      );
      ctx.fillText(e.callsign, bx + 84, ry);

      if (isJustAdded) {
        const callW = ctx.measureText(e.callsign).width;
        const badgeX = Math.min(bx + 296, bx + 92 + callW);
        const badgeW = 98;
        ctx.fillStyle = 'rgba(10, 44, 22, 0.96)';
        ctx.fillRect(badgeX, ry - 14, badgeW, 18);
        ctx.strokeStyle = '#44FF77';
        ctx.lineWidth = 1.6;
        ctx.strokeRect(badgeX, ry - 14, badgeW, 18);
        ctx.font = 'bold 12px "Share Tech Mono", monospace';
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.fillText('★ JUST ADDED', badgeX + badgeW * 0.5, ry - 1);
        ctx.font = 'bold 14px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
      }

      ctx.fillStyle = isJustAdded ? '#7BFF9E' : '#8EF5AB';
      ctx.fillText(`W-${String(e.waves).padStart(2, '0')}`, bx + 412, ry);
      ctx.fillText(String(e.kills), bx + 516, ry);
      ctx.textAlign = 'right';
      ctx.fillStyle = isJustAdded ? '#FFFFFF' : '#FFB000';
      ctx.fillText(e.score.toLocaleString(), bx + boxW - 26, ry);
    });

    const bannerY = by + boxH - 96;
    if (lastSubmittedRun) {
      const dispRank = matchedJustIdx >= 0 ? matchedJustIdx + 1 : lastSubmittedRun.rank;
      const rankTag = `#${String(dispRank).padStart(2, '0')}`;
      ctx.fillStyle = 'rgba(26, 78, 42, 0.55)';
      ctx.fillRect(bx + 22, bannerY, boxW - 44, 28);
      ctx.strokeStyle = '#44FF77';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(bx + 22, bannerY, boxW - 44, 28);
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px "Share Tech Mono", monospace';
      ctx.fillStyle = '#7BFF9E';
      ctx.fillText(
        `★ YOUR JUST-COMPLETED RUN: RANK ${rankTag} — ${lastSubmittedRun.callsign} // ${lastSubmittedRun.score.toLocaleString()} PTS (W-${String(lastSubmittedRun.waves).padStart(2, '0')}) ★`,
        w * 0.5,
        bannerY + 19,
        boxW - 60
      );
    }

    const btnGap = 12;
    const halfW = (boxW - 44 - btnGap) * 0.5;
    this.addScaledButton(
      ctx,
      'perim-new-run',
      { x: bx + 22, y: by + boxH - 54, width: halfW, height: 38 },
      'NEW DEPLOYMENT',
      false,
      hoveredButtonId,
      '#44FF77',
      15.5
    );
    this.addScaledButton(
      ctx,
      'perim-close-modal',
      { x: bx + 22 + halfW + btnGap, y: by + boxH - 54, width: halfW, height: 38 },
      '[ESC] CLOSE MANIFEST',
      true,
      hoveredButtonId,
      '#FFB000',
      15.5
    );
    ctx.restore();
  }

  /**
   * Standardized MU-TH-UR 6000 System & Command Menu [TAB] (Unified across Programs 1, 2 & 3)
   */
  private drawCommandOsdModal(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams
  ): void {
    const { width: w, height: h, audioMuted, isFullscreen, sim, hoveredButtonId } = params;
    const boxW = Math.min(720, w - 44);
    const boxH = Math.min(468, h - 30);
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.save();
    ctx.fillStyle = 'rgba(4, 11, 7, 0.97)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, COLORS.AMBER_CAUTION, 2.6);

    ctx.textAlign = 'left';
    ctx.font = 'bold 21.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_BRIGHT;
    ctx.fillText('MU-TH-UR 6000 // SYSTEM & COMMAND MENU [TAB]', bx + 22, by + 34);

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(bx + 22, by + 42);
    ctx.lineTo(bx + boxW - 22, by + 42);
    ctx.stroke();

    // Top 2-Button Mission Command Strip
    const cmdY = by + 52;
    const cmdGap = 12;
    const cmdW = (boxW - 44 - cmdGap) * 0.5;
    this.addScaledButton(
      ctx,
      'perim-close-modal',
      { x: bx + 22, y: cmdY, width: cmdW, height: 34 },
      '[TAB] RESUME CONSOLE',
      true,
      hoveredButtonId,
      COLORS.GREEN_BRIGHT,
      15
    );
    this.addScaledButton(
      ctx,
      'perim-restart-endless',
      { x: bx + 22 + cmdW + cmdGap, y: cmdY, width: cmdW, height: 34 },
      'RESTART ENDLESS SIEGE',
      false,
      hoveredButtonId,
      '#FFB000',
      15
    );

    // Standardized Hardware, Wiki, Training & System Toggle Rows
    const rowStartY = cmdY + 46;
    const rowStep = 47;
    const switches = [
      {
        id: 'perim-wiki-open',
        name: 'MU-TH-UR TACTICAL WIKI / FIELD MANUAL [H]',
        status: 'OPEN FULL DATABASE',
        active: false,
        accent: '#00F0FF',
      },
      {
        id: sim.trainingMode ? 'perim-drill-exit' : 'perim-drill-start',
        name: 'INTERACTIVE TRAINING DRILL (9 LIVE STAGES)',
        status: sim.trainingMode ? 'EXIT TO ENDLESS SIEGE' : '► LAUNCH SIM DRILL',
        active: sim.trainingMode,
        accent: '#00F0FF',
      },
      {
        id: 'perim-pause-toggle',
        name: 'TACTICAL SIMULATION PAUSE [SPACE]',
        status: sim.tacticalPaused ? '❚❚ PAUSED' : '● LIVE SIMULATION',
        active: sim.tacticalPaused,
        accent: sim.tacticalPaused ? '#FFB000' : COLORS.GREEN_BRIGHT,
      },
      {
        id: 'perim-mute',
        name: 'INTERCOM & AUDIO BUS',
        status: audioMuted ? '▲ BUS MUTED [OFF]' : '● BUS ACTIVE [ON]',
        active: !audioMuted,
        accent: audioMuted ? COLORS.RED_KLAXON : COLORS.GREEN_BRIGHT,
      },
      {
        id: 'perim-fullscreen',
        name: 'FULLSCREEN DISPLAY MODE',
        status: isFullscreen ? '● FULLSCREEN [ON]' : '○ WINDOWED [OFF]',
        active: isFullscreen,
        accent: isFullscreen ? COLORS.GREEN_BRIGHT : COLORS.AMBER_BRIGHT,
      },
      {
        id: 'perim-manifest',
        name: 'MU-TH-UR PERIMETER_SCORES MANIFEST',
        status: 'VIEW GLOBAL LEADERBOARD',
        active: false,
        accent: COLORS.GREEN_PRIMARY,
      },
    ];

    switches.forEach((sw, idx) => {
      const sy = rowStartY + idx * rowStep;
      ctx.fillStyle = 'rgba(8, 22, 13, 0.72)';
      ctx.fillRect(bx + 22, sy, boxW - 44, 40);
      ctx.strokeStyle = COLORS.GREEN_DIM;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(bx + 22, sy, boxW - 44, 40);

      ctx.textAlign = 'left';
      ctx.font = 'bold 15px "Share Tech Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_PRIMARY;
      ctx.fillText(sw.name, bx + 34, sy + 25, boxW - 306);

      this.addScaledButton(
        ctx,
        sw.id,
        { x: bx + boxW - 266, y: sy + 4, width: 232, height: 32 },
        sw.status,
        sw.active,
        hoveredButtonId,
        sw.accent,
        13.5
      );
    });

    // Standardized 2-Column Footer Row
    const footGap = 12;
    const footBtnW = Math.floor((boxW - 44 - footGap) * 0.5);
    this.addScaledButton(
      ctx,
      'perim-close-modal',
      { x: bx + 22, y: by + boxH - 46, width: footBtnW, height: 36 },
      '[TAB / ESC] CLOSE MENU',
      true,
      hoveredButtonId,
      COLORS.GREEN_BRIGHT,
      15
    );
    this.addScaledButton(
      ctx,
      'perim-exit-os',
      { x: bx + 22 + footBtnW + footGap, y: by + boxH - 46, width: footBtnW, height: 36 },
      '[EXIT TO MU-TH-UR OS]',
      false,
      hoveredButtonId,
      '#FFB000',
      15
    );

    ctx.restore();
  }

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
      ctx.strokeStyle = `rgba(0, 240, 255, ${(0.55 + pulse * 0.45).toFixed(2)})`;
      ctx.lineWidth = 2.8;
      ctx.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4);
      ctx.fillStyle = `rgba(0, 240, 255, ${(0.08 + pulse * 0.12).toFixed(3)})`;
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

    const cardW = Math.min(860, bpVp.width - 14);
    const objCount = dir.objectives.length;
    const cardH = Math.min(148, 92 + objCount * 18);
    const cx = Math.round(bpVp.x + (bpVp.width - cardW) * 0.5);
    const cy = Math.round(bpVp.y + bpVp.height - cardH - 8);

    ctx.save();
    ctx.fillStyle = 'rgba(2, 11, 8, 0.95)';
    ctx.fillRect(cx, cy, cardW, cardH);
    this.drawCornerBrackets(ctx, cx, cy, cardW, cardH, 14, '#00F0FF', 2.2);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.52)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(cx + 1, cy + 1, cardW - 2, cardH - 2);

    // Header bar
    ctx.fillStyle = 'rgba(6, 30, 34, 0.88)';
    ctx.fillRect(cx + 2, cy + 2, cardW - 4, 26);

    ctx.textAlign = 'left';
    ctx.font = 'bold 14px "Share Tech Mono", monospace';
    ctx.fillStyle = '#5CF4FF';
    ctx.fillText(`◈ ${dir.code} // ${dir.title}`, cx + 12, cy + 19, cardW - 270);

    // Top-right compact drill action pills ([WIKI] [SKIP] [EXIT])
    const btnY = cy + 4;
    const btnH = 21;
    const exitW = 56;
    const skipW = 78;
    const wikiW = 68;
    const bxExit = cx + cardW - exitW - 6;
    const bxSkip = bxExit - skipW - 5;
    const bxWiki = bxSkip - wikiW - 5;

    this.addScaledButton(
      ctx,
      'perim-drill-open-wiki',
      { x: bxWiki, y: btnY, width: wikiW, height: btnH },
      'WIKI [H]',
      false,
      hoveredButtonId,
      '#44FF77',
      11.5
    );
    this.addScaledButton(
      ctx,
      'perim-drill-skip',
      { x: bxSkip, y: btnY, width: skipW, height: btnH },
      'SKIP STEP',
      false,
      hoveredButtonId,
      '#FFB000',
      11.5
    );
    this.addScaledButton(
      ctx,
      'perim-drill-exit',
      { x: bxExit, y: btnY, width: exitW, height: btnH },
      'EXIT',
      false,
      hoveredButtonId,
      '#FF5533',
      11.5
    );

    // Plain-English Coaching Lines (2 concise wrapped lines)
    ctx.textAlign = 'left';
    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    const textMaxW = dir.showContinueBtn ? cardW - 220 : cardW - 24;
    dir.briefingLines.forEach((line, idx) => {
      ctx.fillStyle = idx === 0 ? '#EEFFF4' : '#FFE48F';
      ctx.fillText(line, cx + 12, cy + 45 + idx * 17, textMaxW);
    });

    // Live Auto-Checking Objectives Checklist
    const objStartY = cy + 81;
    dir.objectives.forEach((obj, idx) => {
      const oy = objStartY + idx * 18;
      ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
      ctx.fillStyle = obj.done ? '#5EFF90' : '#8CF9FF';
      const mark = obj.done ? '[✓]' : '[ ]';
      ctx.fillText(`${mark} ${obj.text}`, cx + 14, oy, textMaxW - 6);
    });

    // Optional Continue / Begin Drill button on Stage 1
    if (dir.showContinueBtn) {
      this.addScaledButton(
        ctx,
        'perim-drill-next',
        { x: cx + cardW - 196, y: cy + cardH - 42, width: 184, height: 32 },
        dir.continueLabel,
        true,
        hoveredButtonId,
        '#FFB000',
        13.5
      );
    }

    ctx.restore();
  }

  private drawTutorialGraduationModal(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams
  ): void {
    const { width: w, height: h, hoveredButtonId } = params;
    const dir = params.tutorialDirective;
    const boxW = Math.min(720, w - 44);
    const boxH = 310;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.save();
    ctx.fillStyle = 'rgba(1, 5, 3, 0.72)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(4, 14, 9, 0.98)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 22, '#44FF77', 2.8);

    ctx.textAlign = 'center';
    ctx.font = 'bold 23px "Share Tech Mono", monospace';
    ctx.fillStyle = '#44FF77';
    ctx.fillText(`★ ${dir.title} ★`, w * 0.5, by + 44, boxW - 44);

    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = '#C8FAD8';
    ctx.fillText(
      'ALL 9 USCM TACTICAL DRILL MODULES PASSED // FULL SECTOR 01 CLEARANCE GRANTED',
      w * 0.5,
      by + 74,
      boxW - 48
    );

    ctx.fillStyle = '#FFE082';
    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillText(
      'REMEMBER: FUNNEL WITH DOOR SEALS [7] · LIGHT DARK CORRIDORS [6/F/L] · STERILIZE ACID [2]',
      w * 0.5,
      by + 114,
      boxW - 48
    );
    ctx.fillStyle = '#70F8FF';
    ctx.fillText(
      'PRESS [H] ANYTIME DURING PLAY TO CONSULT THE FULL MU-TH-UR TACTICAL WIKI & STATS',
      w * 0.5,
      by + 140,
      boxW - 48
    );

    const pad = 28;
    const fullW = boxW - pad * 2;
    this.addScaledButton(
      ctx,
      'perim-drill-exit',
      { x: bx + pad, y: by + boxH - 114, width: fullW, height: 44 },
      '► LAUNCH RANKED ENDLESS HIVE SIEGE [ENTER] ◄',
      true,
      hoveredButtonId,
      '#FFB000',
      16.5
    );

    const gap = 12;
    const halfW = (fullW - gap) * 0.5;
    this.addScaledButton(
      ctx,
      'perim-wiki-open',
      { x: bx + pad, y: by + boxH - 58, width: halfW, height: 38 },
      'OPEN FULL TACTICAL WIKI [H]',
      false,
      hoveredButtonId,
      '#00F0FF',
      14.5
    );
    this.addScaledButton(
      ctx,
      'perim-drill-start',
      { x: bx + pad + halfW + gap, y: by + boxH - 58, width: halfW, height: 38 },
      'REPLAY TRAINING DRILL',
      false,
      hoveredButtonId,
      '#44FF77',
      14.5
    );

    ctx.restore();
  }

  private addScaledButton(
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
    ctx.fillStyle = hov
      ? 'rgba(255, 176, 0, 0.28)'
      : active
        ? 'rgba(59, 224, 104, 0.20)'
        : 'rgba(6, 16, 10, 0.92)';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = hov ? '#FFFFFF' : active ? accent : COLORS.GREEN_MID;
    ctx.lineWidth = hov || active ? 2.2 : 1.6;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    ctx.font = `bold ${fontPx}px "Share Tech Mono", monospace`;
    ctx.fillStyle = hov ? '#FFFFFF' : accent;
    ctx.textAlign = 'center';
    ctx.fillText(label, rect.x + rect.width * 0.5, rect.y + rect.height * 0.5 + fontPx * 0.34);
  }

  private drawCornerBrackets(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    len: number,
    color: string,
    lineWidth: number
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
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
