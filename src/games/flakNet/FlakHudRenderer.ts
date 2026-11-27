import {
  CONTROLS_STRIP_HEIGHT,
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
  type ChromeButtonHitbox,
  type ControlsStripItem,
  type ManifestRowData,
} from '../../render/chrome';
import { drawRankedTitleRibbon } from '../../render/RankedBadge';
import type { CrtPreset, PhosphorTheme } from '../../shell/Cartridge';
import type { ViewportRect } from '../../types';
import type { DemoTelemetryState } from './FlakDemoDirector';
import type { FlakLeaderboardService } from './FlakLeaderboard';
import type { FlakSimulation } from './FlakSimulation';
import type { DefenseBattery, FlakLastSubmittedRun } from './types';

export interface FlakHudLayout {
  hudScale: number;
  topBarH: number;
  rightPanel: ViewportRect;
  bottomDock: ViewportRect;
  bottomTicker: ViewportRect;
  controlsStripY: number;
  scopeViewport: ViewportRect;
}

export interface FlakStatusToast {
  text: string;
  tone: 'green' | 'amber' | 'red' | 'cyan';
  alpha: number;
}

export interface FlakHudRenderParams {
  width: number;
  height: number;
  timeSec: number;
  sim: FlakSimulation;
  leaderboard: FlakLeaderboardService;
  hoveredButtonId: string | null;
  audioMuted: boolean;
  masterVolume: number;
  crtPreset: CrtPreset;
  crtModeLocked: boolean;
  phosphorTheme: PhosphorTheme;
  isFullscreen: boolean;
  isTouchDevice: boolean;
  confirmExitPending: boolean;
  osdMenuOpen: boolean;
  manifestOpen: boolean;
  controlsOpen: boolean;
  empTouchArmed: boolean;
  callsignDraft: string;
  callsignEditing: boolean;
  scoreSubmitted: boolean;
  submittingScore: boolean;
  submitResultBanner: string | null;
  submitResultTone: 'green' | 'amber' | 'red';
  lastSubmittedRun: FlakLastSubmittedRun | null;
  statusToast?: FlakStatusToast | null;
  demoState?: DemoTelemetryState | null;
}

const FLAK_CONTROLS_STRIP: readonly ControlsStripItem[] = [
  { key: 'LMB/A/D', label: 'Flak', accent: 'green' },
  { key: 'RMB/SPACE/S', label: 'EMP', accent: 'amber' },
  { key: 'P', label: 'Pause', accent: 'amber' },
  { key: 'H', label: 'Controls', accent: 'cyan' },
  { key: 'ESC', label: 'Menu', accent: 'amber' },
];

export class FlakHudRenderer {
  public buttons: ChromeButtonHitbox[] = [];

  public hitTestButton(cx: number, cy: number): string | null {
    return hitTestChromeButtons(this.buttons, cx, cy);
  }

  /**
   * Expanded Scope Layout:
   * - Single slim Right Fire-Control Rail (~210px)
   * - Single-line Telemetry Ticker (22px) + Bottom Breech/EMP/Dome Status Dock (~74px)
   * - Persistent 22px Controls Strip anchored cleanly along bottom edge
   * Eliminates the old 34.5% dual-console pinch & 21-32.5% black letterboxing!
   */
  public computeLayout(width: number, height: number): FlakHudLayout {
    const w = Math.max(320, width);
    const h = Math.max(240, height);
    const margin = 6;
    const topBarH = TOP_CHROME_BAR_HEIGHT;
    const controlsStripY = h - CONTROLS_STRIP_HEIGHT;

    const rightW = Math.round(Math.max(176, Math.min(216, w * 0.165)));
    const dockH = h < 660 ? 68 : 74;
    const tickerH = 22;

    const rightPanel: ViewportRect = {
      x: w - margin - rightW,
      y: topBarH + 4,
      width: rightW,
      height: Math.max(180, controlsStripY - 4 - (topBarH + 4)),
    };

    const scopeX = margin;
    const scopeW = Math.max(240, rightPanel.x - 6 - scopeX);

    const bottomDock: ViewportRect = {
      x: scopeX,
      y: controlsStripY - 4 - dockH,
      width: scopeW,
      height: dockH,
    };

    const bottomTicker: ViewportRect = {
      x: scopeX,
      y: bottomDock.y - 4 - tickerH,
      width: scopeW,
      height: tickerH,
    };

    const scopeViewport: ViewportRect = {
      x: scopeX,
      y: topBarH + 4,
      width: scopeW,
      height: Math.max(140, bottomTicker.y - 4 - (topBarH + 4)),
    };

    const hudScale = Math.max(0.85, Math.min(1.1, Math.min(w / 1280, h / 800)));

    return {
      hudScale,
      topBarH,
      rightPanel,
      bottomDock,
      bottomTicker,
      controlsStripY,
      scopeViewport,
    };
  }

  public render(
    ctx: CanvasRenderingContext2D,
    params: FlakHudRenderParams,
    layout: FlakHudLayout
  ): void {
    this.buttons = [];
    const { width: w, height: h, sim } = params;

    // 1. Unified 46px Top Chrome Bar (4 pills: [H] CONTROLS | AUDIO | [ESC] MENU | MU-TH-UR OS)
    const telemetryText =
      sim.isDemoMode && params.demoState?.active
        ? `STAGE 0${params.demoState.stageIndex}/0${params.demoState.totalStages} · ${sim.score.toLocaleString()} PTS`
        : `WAVE ${String(sim.waveNumber).padStart(2, '0')} · ${sim.score.toLocaleString()} PTS${sim.ranked1979Bonus && !sim.isDemoMode ? ' · 1.5X' : ''}`;

    drawTopChromeBar(
      ctx,
      w,
      {
        title: w < 1060 ? 'FLAK NET' : 'ORBITAL INTERCEPT // FLAK NET',
        timeSec: params.timeSec,
        isRanked: !sim.isDemoMode,
        telemetryText,
        crt1979Enabled: params.crtPreset === 'CLASSIC_1979',
        crtModeLocked: params.crtModeLocked,
        controlsLabel: '[H] CONTROLS',
        audioMuted: params.audioMuted,
        hoveredButtonId: params.hoveredButtonId,
        confirmExitPending: params.confirmExitPending,
        demoModeActive: sim.isDemoMode,
      },
      this.buttons
    );

    // 2. Slim Right Fire-Control Rail (~210px)
    this.drawRightFireControlRail(ctx, params, layout);

    // 3. Single-line Bottom Telemetry Ticker
    this.drawBottomTickerBar(ctx, params, layout);

    // 4. Bottom Breech / EMP Touch Button / Habitat Seals Dock (~74px)
    this.drawBottomBreechDomeDock(ctx, params, layout);

    // 5. Persistent 22px Controls Strip
    drawPersistentControlsStrip(ctx, w, h, FLAK_CONTROLS_STRIP, layout.controlsStripY);

    // 6. Phase-Specific Overlays inside Scope Viewport
    if (sim.phase === 'TITLE') {
      this.drawTitleOverlay(ctx, params, layout);
    } else if (sim.phase === 'WAVE_AUDIT' && sim.waveAudit && !sim.isDemoMode) {
      this.drawWaveAuditBanner(ctx, params, layout);
    } else if (sim.phase === 'GAME_OVER' && !sim.isDemoMode) {
      this.drawGameOverDebrief(ctx, params);
    }

    // 7. Top-Priority Unified Modals (each calls drawModalFrame -> clears underlying hitboxes!)
    if (params.osdMenuOpen) {
      drawSystemMenuModal(
        ctx,
        w,
        h,
        {
          programTitle: 'FLAK NET',
          activeProgramId: 'flak',
          crtPreset: params.crtPreset,
          crtModeLocked: params.crtModeLocked,
          phosphorTheme: params.phosphorTheme,
          masterVolume: params.masterVolume,
          audioMuted: params.audioMuted,
          isFullscreen: params.isFullscreen,
          hoveredButtonId: params.hoveredButtonId,
          restartLabel: `${SEMIOTIC_ICONS.REPLAY} RESTART WAVE 01`,
          confirmExitPending: params.confirmExitPending,
          extraRows: [
            {
              id: 'flak-sys-demo',
              label: '[T] LAUNCH TACTICAL DEMO',
              value: sim.isDemoMode ? 'EXIT DEMO' : 'START BRIEFING ►',
              accent: 'amber',
            },
          ],
        },
        this.buttons
      );
    } else if (params.manifestOpen) {
      this.drawGlobalLeaderboardModal(ctx, params);
    } else if (params.controlsOpen) {
      this.drawControlsQuickCard(ctx, params);
    } else if (sim.phase === 'ACTIVE_WAVE' && sim.paused && !sim.isDemoMode) {
      drawPauseBanner(
        ctx,
        w,
        h,
        'Radar tracking halted. Press [P] to resume intercept, [H] for Controls, or [ESC] for System Menu.',
        this.buttons,
        params.hoveredButtonId,
        params.timeSec
      );
    }

    // 8. Transient Status Toast (Mute toggle / Exit latch / EMP arm feedback)
    if (params.statusToast && params.statusToast.alpha > 0.01) {
      drawStatusToast(
        ctx,
        w,
        layout.topBarH + 10,
        params.statusToast.text,
        params.statusToast.tone,
        params.statusToast.alpha
      );
    }
  }

  // ===========================================================================
  // SLIM RIGHT FIRE-CONTROL RAIL (~210px, 1:1 CSS PIXELS, ALL >=12px!)
  // ===========================================================================
  private drawRightFireControlRail(
    ctx: CanvasRenderingContext2D,
    params: FlakHudRenderParams,
    layout: FlakHudLayout
  ): void {
    const r = layout.rightPanel;
    const { sim, leaderboard, timeSec } = params;
    const pad = 9;
    const innerW = r.width - pad * 2;
    const cx = r.x + r.width * 0.5;

    ctx.save();
    ctx.fillStyle = THEME.BG_PANEL;
    ctx.fillRect(r.x, r.y, r.width, r.height);
    drawCornerBrackets(ctx, r.x, r.y, r.width, r.height, 12, THEME.BORDER_SUBTLE, 1.8);

    // Header
    ctx.textBaseline = 'middle';
    ctx.font = font('head', 13);
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    drawEllipsizedText(ctx, 'FIRE-CONTROL', r.x + pad, r.y + 15, innerW - 48);

    ctx.font = font('micro', 12);
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.fillText('LV-426', r.x + r.width - pad, r.y + 15);

    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(r.x + pad, r.y + 26);
    ctx.lineTo(r.x + r.width - pad, r.y + 26);
    ctx.stroke();

    let curY = r.y + 34;

    // 1. Analog Threat Density Dial (compact, crisp >=12px)
    const compactH = r.height < 580;
    const dialR = compactH ? 38 : Math.min(48, Math.floor(innerW * 0.25));
    const dialCy = curY + dialR + 6;
    const density = sim.getThreatDensityNormalized();
    const densCol =
      density > 0.72
        ? THEME.ALERT_RED_TEXT
        : density > 0.42
          ? THEME.ACCENT_AMBER
          : THEME.TEXT_PRIMARY;

    this.drawAnalogDial(
      ctx,
      cx,
      dialCy,
      dialR,
      density,
      'THREAT DENSITY',
      `${sim.threats.length} TRACKED`,
      densCol
    );
    curY = dialCy + dialR + 36;

    // 2. Live Chain Multiplier Module (ZERO duplicated 2X Boost meters here!)
    const chainH = compactH ? 104 : 114;
    const hotChain = sim.liveChain >= 2;
    const overclocked = sim.liveChain >= 4;
    const pulse = hotChain && Math.sin(timeSec * 14) > 0;

    ctx.fillStyle = hotChain ? 'rgba(54, 30, 4, 0.76)' : THEME.BG_ROW_ALT;
    ctx.fillRect(r.x + pad, curY, innerW, chainH);
    drawCornerBrackets(
      ctx,
      r.x + pad,
      curY,
      innerW,
      chainH,
      8,
      hotChain ? THEME.ACCENT_AMBER : THEME.BORDER_SUBTLE,
      1.6
    );

    ctx.textAlign = 'center';
    ctx.font = font('micro', 12);
    ctx.fillStyle = hotChain ? THEME.ACCENT_AMBER_HI : THEME.TEXT_SECONDARY;
    drawEllipsizedText(ctx, 'LIVE CHAIN', cx, curY + 15, innerW - 12);

    ctx.font = font('display', compactH ? 32 : 38);
    ctx.fillStyle =
      pulse && hotChain ? THEME.ACCENT_AMBER_HI : hotChain ? THEME.ACCENT_AMBER : THEME.TEXT_PRIMARY;
    ctx.fillText(`x${sim.liveChain}`, cx, curY + (compactH ? 49 : 53));

    const barX = r.x + pad + 10;
    const barW = innerW - 20;
    const barY = curY + (compactH ? 72 : 78);
    const decayFrac = Math.max(0, Math.min(1, sim.liveChainDecayTimer / 3.2));
    ctx.fillStyle = 'rgba(12, 32, 20, 0.9)';
    ctx.fillRect(barX, barY, barW, 6);
    if (decayFrac > 0.01) {
      ctx.fillStyle = overclocked ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;
      ctx.fillRect(barX, barY, barW * decayFrac, 6);
    }

    ctx.font = font('micro', 12);
    ctx.fillStyle = overclocked ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT;
    drawEllipsizedText(
      ctx,
      overclocked
        ? `${SEMIOTIC_ICONS.STAR} OVERCLK -20% LOAD`
        : `PEAK x${sim.highChain} · ${sim.getAccuracyPercent()}% ACC`,
      cx,
      curY + chainH - 12,
      innerW - 10
    );

    curY += chainH + 8;

    // 3. Tactical Status Lamps (ECM Radar + 3-Wave Drop-Pod Cycle with Ron Cobb semiotic icons!)
    const jammed = sim.getActiveJammerIntensity() > 0.05;
    const jamFlash = jammed && Math.sin(timeSec * 16) > 0;
    const lampH = 26;

    // Lamp A: Radar / ECM
    ctx.fillStyle = jammed ? THEME.ALERT_RED_BG : 'rgba(6, 20, 12, 0.9)';
    ctx.fillRect(r.x + pad, curY, innerW, lampH);
    ctx.strokeStyle = jamFlash
      ? THEME.ALERT_RED_STROKE
      : jammed
        ? THEME.ACCENT_AMBER
        : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(r.x + pad + 0.5, curY + 0.5, innerW - 1, lampH - 1);
    ctx.font = font('micro', 12);
    ctx.textAlign = 'center';
    ctx.fillStyle = jamFlash
      ? THEME.ACCENT_AMBER_HI
      : jammed
        ? THEME.ALERT_RED_TEXT
        : THEME.TEXT_PRIMARY;
    drawEllipsizedText(
      ctx,
      jammed
        ? `${SEMIOTIC_ICONS.HEX} ECM JAMMED`
        : `${SEMIOTIC_ICONS.DOT_LIVE} RADAR LOCK CLEAR`,
      cx,
      curY + lampH * 0.5 + 0.5,
      innerW - 10
    );
    curY += lampH + 5;

    // Lamp B: Orbital Drop-Pod Supply Cycle
    const podSteps = sim.waveNumber % 3;
    const filledPips = podSteps === 0 ? 3 : podSteps;
    const pipTxt = `${'■'.repeat(filledPips)}${'□'.repeat(3 - filledPips)}`;
    const needPod = sim.getIntactDomeCount() < 4;

    ctx.fillStyle = needPod ? THEME.ACCENT_AMBER_BG : 'rgba(6, 20, 12, 0.9)';
    ctx.fillRect(r.x + pad, curY, innerW, lampH);
    ctx.strokeStyle = needPod ? THEME.ACCENT_AMBER : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(r.x + pad + 0.5, curY + 0.5, innerW - 1, lampH - 1);
    ctx.fillStyle = needPod ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_CYAN;
    drawEllipsizedText(
      ctx,
      `${SEMIOTIC_ICONS.DIAMOND} DROP-POD ${pipTxt}`,
      cx,
      curY + lampH * 0.5 + 0.5,
      innerW - 10
    );
    curY += lampH + 8;

    // 4. Compact Combat Counters & #01 Leader Card (fills remaining height cleanly)
    const remH = r.y + r.height - pad - curY;
    if (remH >= 88) {
      ctx.fillStyle = 'rgba(3, 10, 6, 0.94)';
      ctx.fillRect(r.x + pad, curY, innerW, remH);
      ctx.strokeStyle = THEME.BORDER_SUBTLE;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(r.x + pad + 0.5, curY + 0.5, innerW - 1, remH - 1);

      const statRows: Array<{ label: string; val: string; col: string }> = [
        { label: 'INTERCEPTS', val: String(sim.totalKills), col: THEME.TEXT_PRIMARY },
        { label: 'DANGER 3X', val: String(sim.dangerCloseKills), col: THEME.ACCENT_AMBER },
        { label: 'DEFLECTS', val: String(sim.deflectionKills), col: THEME.TEXT_BRIGHT },
        { label: 'ACCURACY', val: `${sim.getAccuracyPercent()}%`, col: THEME.TEXT_SECONDARY },
      ];

      ctx.font = font('micro', 12);
      const rowStep = remH < 140 ? 20 : 22;
      let sy = curY + 16;
      for (const row of statRows) {
        if (sy + 8 > curY + remH) break;
        ctx.textAlign = 'left';
        ctx.fillStyle = THEME.TEXT_SECONDARY;
        ctx.fillText(row.label, r.x + pad + 8, sy);
        ctx.textAlign = 'right';
        ctx.fillStyle = row.col;
        ctx.fillText(row.val, r.x + r.width - pad - 8, sy);
        sy += rowStep;
      }

      // Reigning #01 Leader block at bottom of rail when height permits
      const leader = leaderboard.getReigningLeader();
      const leadStart = sy + 6;
      if (leader && curY + remH - leadStart >= 56) {
        ctx.strokeStyle = THEME.BORDER_SUBTLE;
        ctx.beginPath();
        ctx.moveTo(r.x + pad + 8, leadStart);
        ctx.lineTo(r.x + r.width - pad - 8, leadStart);
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.font = font('micro', 12);
        ctx.fillStyle = THEME.ACCENT_AMBER;
        drawEllipsizedText(
          ctx,
          `${SEMIOTIC_ICONS.STAR} #01 RECORD`,
          r.x + pad + 8,
          leadStart + 15,
          innerW - 16
        );
        ctx.font = font('data', 13);
        ctx.fillStyle = THEME.ACCENT_AMBER_HI;
        drawEllipsizedText(ctx, leader.callsign, r.x + pad + 8, leadStart + 33, innerW - 16);
        ctx.font = font('micro', 12);
        ctx.fillStyle = THEME.TEXT_PRIMARY;
        drawEllipsizedText(
          ctx,
          `${leader.score.toLocaleString()} PTS`,
          r.x + pad + 8,
          leadStart + 50,
          innerW - 16
        );
      }
    }

    ctx.restore();
  }

  private drawAnalogDial(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    valueNorm: number,
    label: string,
    subText: string,
    accent: string
  ): void {
    const startAng = Math.PI * 0.78;
    const endAng = Math.PI * 2.22;
    const sweep = endAng - startAng;
    const clamped = Math.max(0, Math.min(1, valueNorm));
    const valAng = startAng + sweep * clamped;

    ctx.save();
    if (clamped > 0.01) {
      ctx.fillStyle =
        accent === THEME.ALERT_RED_TEXT
          ? 'rgba(255, 51, 24, 0.24)'
          : 'rgba(255, 176, 0, 0.22)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r - 3, startAng, valAng);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(94, 52, 0, 0.85)';
    ctx.lineWidth = 3.8;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAng, endAng);
    ctx.stroke();

    if (clamped > 0.01) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4.4;
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAng, valAng);
      ctx.stroke();
    }

    for (let i = 0; i <= 8; i++) {
      const f = i / 8;
      const a = startAng + f * sweep;
      const len = i % 2 === 0 ? 7 : 4;
      ctx.strokeStyle = f <= clamped + 0.02 ? THEME.ACCENT_AMBER_HI : THEME.BORDER_SUBTLE;
      ctx.lineWidth = i % 2 === 0 ? 1.8 : 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2));
      ctx.lineTo(cx + Math.cos(a) * (r - 2 - len), cy + Math.sin(a) * (r - 2 - len));
      ctx.stroke();
    }

    ctx.strokeStyle = THEME.ACCENT_AMBER_HI;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(valAng) * 4, cy - Math.sin(valAng) * 4);
    ctx.lineTo(cx + Math.cos(valAng) * (r - 4), cy + Math.sin(valAng) * (r - 4));
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(cx, cy, 3.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.fillText(label, cx, cy + r + 11);

    ctx.font = font('data', 12);
    ctx.fillStyle = accent;
    ctx.fillText(subText, cx, cy + r + 26);
    ctx.restore();
  }

  // ===========================================================================
  // SINGLE-LINE BOTTOM TELEMETRY TICKER
  // ===========================================================================
  private drawBottomTickerBar(
    ctx: CanvasRenderingContext2D,
    params: FlakHudRenderParams,
    layout: FlakHudLayout
  ): void {
    const r = layout.bottomTicker;
    const { sim } = params;
    const latest = sim.logs[0];

    ctx.save();
    ctx.fillStyle = 'rgba(3, 10, 6, 0.94)';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width - 1, r.height - 1);

    ctx.font = font('micro', 12);
    ctx.textBaseline = 'middle';
    const midY = r.y + r.height * 0.5 + 0.5;

    if (latest) {
      const col =
        latest.tone === 'red'
          ? THEME.ALERT_RED_TEXT
          : latest.tone === 'amber'
            ? THEME.ACCENT_AMBER_HI
            : latest.tone === 'bright'
              ? THEME.TEXT_BRIGHT
              : THEME.TEXT_PRIMARY;
      ctx.textAlign = 'left';
      ctx.fillStyle = col;
      drawEllipsizedText(
        ctx,
        `NET> [${latest.timestamp}] ${latest.text}`,
        r.x + 10,
        midY,
        r.width - 20
      );
    } else {
      ctx.textAlign = 'left';
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      drawEllipsizedText(
        ctx,
        'NET> SURFACE-TO-ORBIT RADAR BUS ONLINE — AWAITING CONTACTS',
        r.x + 10,
        midY,
        r.width - 20
      );
    }

    ctx.restore();
  }

  // ===========================================================================
  // BOTTOM BREECH / TOUCH EMP BUTTON / HABITAT SEALS DOCK (~74px, 1:1 CSS PX)
  // ===========================================================================
  private drawBottomBreechDomeDock(
    ctx: CanvasRenderingContext2D,
    params: FlakHudRenderParams,
    layout: FlakHudLayout
  ): void {
    const r = layout.bottomDock;
    const { sim, timeSec } = params;
    const gap = 6;
    const flakW = Math.round((r.width - gap * 2) * 0.34);
    const empW = Math.round((r.width - gap * 2) * 0.36);
    const domeW = Math.max(120, r.width - gap * 2 - flakW - empW);

    const flakRect: ViewportRect = { x: r.x, y: r.y, width: flakW, height: r.height };
    const empRect: ViewportRect = {
      x: flakRect.x + flakRect.width + gap,
      y: r.y,
      width: empW,
      height: r.height,
    };
    const domeRect: ViewportRect = {
      x: empRect.x + empRect.width + gap,
      y: r.y,
      width: domeW,
      height: r.height,
    };

    // Bay 1: Twin M90 Proximity Flak Breech Chambers ([A] & [D] — LMB / A / D = FLAK)
    this.drawDockFlakBay(ctx, sim, flakRect, timeSec);

    // Bay 2: Mk-IV EMP Capacitor Bank + Crisp Interactive Touch/Trackpad [EMP FIRE] Button!
    this.drawDockEmpBay(ctx, params, empRect);

    // Bay 3: 4-Cell Habitat Seals Schematic (H1..H4)
    this.drawDockHabitatBay(ctx, sim, domeRect, timeSec);
  }

  private drawDockFlakBay(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    rect: ViewportRect,
    timeSec: number
  ): void {
    const batA = sim.batteries[0];
    const batD = sim.batteries[2];
    const overclocked = sim.liveChain >= 4;

    ctx.save();
    ctx.fillStyle = THEME.BG_PANEL;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    drawCornerBrackets(
      ctx,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      9,
      overclocked ? THEME.ACCENT_AMBER : THEME.BORDER_SUBTLE,
      1.6
    );

    const pad = 6;
    const rowGap = 4;
    const rowH = Math.floor((rect.height - pad * 2 - rowGap) * 0.5);

    if (batA) {
      this.drawCompactFlakChamber(
        ctx,
        batA,
        rect.x + pad,
        rect.y + pad,
        rect.width - pad * 2,
        rowH,
        timeSec,
        overclocked
      );
    }
    if (batD) {
      this.drawCompactFlakChamber(
        ctx,
        batD,
        rect.x + pad,
        rect.y + pad + rowH + rowGap,
        rect.width - pad * 2,
        rowH,
        timeSec,
        overclocked
      );
    }

    ctx.restore();
  }

  private drawCompactFlakChamber(
    ctx: CanvasRenderingContext2D,
    bat: DefenseBattery,
    x: number,
    y: number,
    w: number,
    h: number,
    timeSec: number,
    overclocked: boolean
  ): void {
    const empty = bat.ammo <= 0;
    const firing = bat.recoil > 1.5;
    const borderCol = empty
      ? Math.sin(timeSec * 14) > 0
        ? THEME.ALERT_RED_STROKE
        : THEME.BORDER_SUBTLE
      : firing
        ? THEME.ACCENT_AMBER_HI
        : overclocked
          ? THEME.ACCENT_AMBER
          : THEME.BORDER_SUBTLE;

    ctx.fillStyle = firing
      ? 'rgba(46, 34, 8, 0.72)'
      : overclocked && !empty
        ? 'rgba(26, 18, 4, 0.90)'
        : 'rgba(4, 14, 8, 0.94)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = firing || empty || overclocked ? 1.5 : 1.1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    const midY = y + h * 0.5 + 0.5;
    ctx.textBaseline = 'middle';
    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = empty
      ? THEME.ALERT_RED_TEXT
      : overclocked
        ? THEME.ACCENT_AMBER_HI
        : THEME.TEXT_PRIMARY;
    ctx.fillText(`[${bat.id}] FLAK`, x + 7, midY);

    ctx.textAlign = 'right';
    ctx.fillStyle = empty ? THEME.ALERT_RED_TEXT : THEME.TEXT_BRIGHT;
    ctx.fillText(`${bat.ammo}/${bat.maxAmmo}`, x + w - 7, midY);

    // Physical cartridge breech slots in center
    const slotsX = x + 76;
    const slotsW = Math.max(42, w - 118);
    const gap = 4;
    const slotW = (slotsW - gap * (bat.maxAmmo - 1)) / Math.max(1, bat.maxAmmo);
    const slotH = Math.max(12, h - 8);
    const slotY = Math.round(y + (h - slotH) * 0.5);

    for (let i = 0; i < bat.maxAmmo; i++) {
      const sx = slotsX + i * (slotW + gap);
      ctx.fillStyle = 'rgba(2, 8, 5, 0.96)';
      ctx.fillRect(sx, slotY, slotW, slotH);

      if (i < bat.ammo) {
        ctx.fillStyle = 'rgba(68, 255, 119, 0.30)';
        ctx.fillRect(sx + 1, slotY + 1, slotW - 2, slotH - 2);
        ctx.fillStyle = THEME.TEXT_PRIMARY;
        ctx.fillRect(sx + 3, slotY + 4, slotW - 6, Math.max(4, slotH - 6));
        ctx.fillStyle = THEME.ACCENT_AMBER;
        ctx.fillRect(sx + 5, slotY + 2, Math.max(3, slotW - 10), 3);
        ctx.strokeStyle = THEME.TEXT_BRIGHT;
        ctx.lineWidth = 1.0;
        ctx.strokeRect(sx + 0.5, slotY + 0.5, slotW - 1, slotH - 1);
      } else if (i === bat.ammo && bat.reloadProgress > 0) {
        const fillW = Math.max(2, (slotW - 2) * bat.reloadProgress);
        ctx.fillStyle = 'rgba(255, 176, 0, 0.72)';
        ctx.fillRect(sx + 1, slotY + 2, fillW, slotH - 4);
        ctx.strokeStyle = THEME.ACCENT_AMBER;
        ctx.lineWidth = 1.0;
        ctx.strokeRect(sx + 0.5, slotY + 0.5, slotW - 1, slotH - 1);
      } else {
        ctx.strokeStyle = THEME.BORDER_SUBTLE;
        ctx.lineWidth = 1.0;
        ctx.strokeRect(sx + 0.5, slotY + 0.5, slotW - 1, slotH - 1);
      }
    }
  }

  private drawDockEmpBay(
    ctx: CanvasRenderingContext2D,
    params: FlakHudRenderParams,
    rect: ViewportRect
  ): void {
    const { sim, timeSec, empTouchArmed, hoveredButtonId } = params;
    const bat = sim.batteries[1];
    if (!bat) return;

    const empty = bat.ammo <= 0;
    const flashing = sim.empRechargeFlashTimer > 0;
    const flashBright = flashing && Math.sin(timeSec * 24) > -0.2;
    const borderCol = flashBright
      ? THEME.TEXT_BRIGHT
      : empTouchArmed
        ? THEME.ACCENT_AMBER_HI
        : empty
          ? THEME.ALERT_RED_STROKE
          : THEME.ACCENT_AMBER;

    ctx.save();
    ctx.fillStyle = flashBright
      ? 'rgba(14, 52, 28, 0.92)'
      : empty
        ? 'rgba(34, 8, 6, 0.90)'
        : 'rgba(28, 18, 4, 0.92)';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    drawCornerBrackets(ctx, rect.x, rect.y, rect.width, rect.height, 9, borderCol, 1.8);

    // Right side: Crisp Interactive Touch/Trackpad [EMP FIRE] Button!
    const btnW = Math.min(138, Math.max(106, Math.round(rect.width * 0.38)));
    const btnH = rect.height - 12;
    const btnRect: ViewportRect = {
      x: rect.x + rect.width - btnW - 6,
      y: rect.y + 6,
      width: btnW,
      height: btnH,
    };
    const canFire =
      !empty && sim.phase === 'ACTIVE_WAVE' && !sim.paused && !sim.isDemoMode;

    drawChromeButton(
      ctx,
      btnRect,
      empTouchArmed
        ? `${SEMIOTIC_ICONS.DIAMOND} EMP ARMED`
        : empty
          ? 'EMP EMPTY'
          : `${SEMIOTIC_ICONS.DIAMOND} EMP FIRE`,
      {
        id: 'flak-emp-arm',
        accent: empty ? 'red' : empTouchArmed ? 'green' : 'amber',
        active: empTouchArmed || canFire,
        disabled: !canFire,
        hovered: hoveredButtonId === 'flak-emp-arm',
        fontPx: 13,
        subLabel: empTouchArmed ? 'TAP SKY!' : empty ? '3X DC / DFL' : 'RMB/SPC/S',
      },
      this.buttons
    );

    // Left side: HV Capacitor Cells + Recharge Progress
    const leftX = rect.x + 8;
    const leftW = Math.max(80, btnRect.x - 8 - leftX);

    ctx.textBaseline = 'middle';
    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = flashBright
      ? THEME.ACCENT_AMBER_HI
      : empty
        ? THEME.ALERT_RED_TEXT
        : THEME.ACCENT_AMBER;
    drawEllipsizedText(
      ctx,
      flashing ? '+1 EMP RECHARGED!' : `${SEMIOTIC_ICONS.DIAMOND} MK-IV EMP`,
      leftX,
      rect.y + 15,
      leftW - 44
    );

    ctx.textAlign = 'right';
    ctx.fillStyle = flashBright
      ? THEME.TEXT_BRIGHT
      : empty
        ? THEME.ALERT_RED_TEXT
        : THEME.ACCENT_AMBER_HI;
    ctx.fillText(`${bat.ammo}/${bat.maxAmmo}`, leftX + leftW, rect.y + 15);

    // Segmented Glowing HV Capacitor Coils
    const cellY = rect.y + 26;
    const cellH = 18;
    const gap = 4;
    const cellW = (leftW - gap * (bat.maxAmmo - 1)) / Math.max(1, bat.maxAmmo);

    for (let i = 0; i < bat.maxAmmo; i++) {
      const cx = leftX + i * (cellW + gap);
      const charged = i < bat.ammo;
      ctx.fillStyle = charged ? 'rgba(255, 176, 0, 0.34)' : 'rgba(18, 12, 6, 0.92)';
      ctx.fillRect(cx, cellY, cellW, cellH);
      ctx.strokeStyle = charged
        ? flashBright
          ? THEME.TEXT_BRIGHT
          : THEME.ACCENT_AMBER
        : 'rgba(94, 52, 0, 0.72)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(cx + 0.5, cellY + 0.5, cellW - 1, cellH - 1);

      if (charged) {
        ctx.fillStyle = flashBright ? THEME.TEXT_BRIGHT : THEME.ACCENT_AMBER_HI;
        ctx.fillRect(cx + 3, cellY + 5, Math.max(2, cellW - 6), cellH - 10);
      }
    }

    // High-voltage carrier arc across charged cells
    if (bat.ammo > 0) {
      const litSpan = bat.ammo * cellW + Math.max(0, bat.ammo - 1) * gap;
      ctx.strokeStyle = THEME.ACCENT_AMBER_HI;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let k = 0; k <= 18; k++) {
        const u = k / 18;
        const px = leftX + u * litSpan;
        const py =
          cellY +
          cellH * 0.5 +
          Math.sin(u * 22 + timeSec * 26) * 3.2 * Math.sin(u * Math.PI);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Bottom Recharge Progress Readout (12px crisp JetBrains Mono)
    const gaugeY = rect.y + rect.height - 13;
    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    if (bat.ammo >= bat.maxAmmo) {
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      drawEllipsizedText(ctx, 'HV CAPACITOR FULL', leftX, gaugeY, leftW);
    } else {
      const filled = Math.max(0, Math.min(3, sim.dangerCloseRechargeProgress));
      const pips = `${'■'.repeat(filled)}${'□'.repeat(3 - filled)}`;
      ctx.fillStyle = filled > 0 ? THEME.ACCENT_AMBER_HI : THEME.TEXT_SECONDARY;
      drawEllipsizedText(ctx, `3X DC ${pips} · 1 DFL=+1`, leftX, gaugeY, leftW);
    }

    ctx.restore();
  }

  private drawDockHabitatBay(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    rect: ViewportRect,
    timeSec: number
  ): void {
    const intact = sim.getIntactDomeCount();
    const borderCol =
      intact <= 1
        ? THEME.ALERT_RED_STROKE
        : intact <= 2
          ? THEME.ACCENT_AMBER
          : THEME.BORDER_SUBTLE;

    ctx.save();
    ctx.fillStyle = THEME.BG_PANEL;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    drawCornerBrackets(ctx, rect.x, rect.y, rect.width, rect.height, 9, borderCol, 1.6);

    ctx.textBaseline = 'middle';
    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.TEXT_PRIMARY;
    drawEllipsizedText(ctx, 'HABITAT SEALS', rect.x + 8, rect.y + 14, rect.width - 70);

    ctx.textAlign = 'right';
    ctx.fillStyle =
      intact <= 1
        ? THEME.ALERT_RED_TEXT
        : intact <= 2
          ? THEME.ACCENT_AMBER
          : THEME.TEXT_BRIGHT;
    ctx.fillText(`${intact}/4`, rect.x + rect.width - 8, rect.y + 14);

    // 4 Horizontal Geodesic Habitat Cells (H1..H4)
    const gap = 4;
    const cellW = (rect.width - 14 - gap * 3) / 4;
    const cellH = rect.height - 28;
    const cellY = rect.y + 23;

    sim.domes.forEach((d, idx) => {
      const bx = rect.x + 7 + idx * (cellW + gap);
      const breachBlink = !d.intact && Math.sin(timeSec * 12 + idx) > 0;
      ctx.fillStyle = d.intact
        ? 'rgba(12, 38, 22, 0.78)'
        : breachBlink
          ? 'rgba(92, 16, 10, 0.82)'
          : 'rgba(42, 10, 8, 0.78)';
      ctx.fillRect(bx, cellY, cellW, cellH);
      ctx.strokeStyle = d.intact ? THEME.TEXT_PRIMARY : THEME.ALERT_RED_STROKE;
      ctx.lineWidth = 1.3;
      ctx.strokeRect(bx + 0.5, cellY + 0.5, cellW - 1, cellH - 1);

      const dcx = bx + cellW * 0.5;
      const dcy = cellY + Math.min(20, cellH * 0.44);
      const dr = Math.min(11, cellW * 0.24);
      if (d.intact) {
        ctx.strokeStyle = THEME.TEXT_BRIGHT;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(dcx, dcy, dr, Math.PI, Math.PI * 2);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.strokeStyle = THEME.ALERT_RED_STROKE;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(dcx - dr, dcy);
        ctx.lineTo(dcx - dr * 0.35, dcy - 7);
        ctx.lineTo(dcx + dr * 0.2, dcy - 3);
        ctx.lineTo(dcx + dr, dcy);
        ctx.stroke();
      }

      ctx.font = font('micro', 12);
      ctx.textAlign = 'center';
      ctx.fillStyle = d.intact ? THEME.TEXT_BRIGHT : THEME.ALERT_RED_TEXT;
      ctx.fillText(d.intact ? `H${idx + 1}` : 'LOST', dcx, cellY + cellH - 10);
    });

    ctx.restore();
  }

  // ===========================================================================
  // TITLE / READY SCREEN OVERLAY (Clean Scannable Card, >=13px, Zero Leaks!)
  // ===========================================================================
  private drawTitleOverlay(
    ctx: CanvasRenderingContext2D,
    params: FlakHudRenderParams,
    layout: FlakHudLayout
  ): void {
    const vp = layout.scopeViewport;
    const leader = params.leaderboard.getReigningLeader();
    const uplinkStatus = params.leaderboard.getStatus();

    const boxW = Math.min(720, vp.width - 28);
    const boxH = Math.min(498, vp.height - 12);
    const bx = Math.round(vp.x + (vp.width - boxW) * 0.5);
    const by = Math.round(vp.y + (vp.height - boxH) * 0.5);

    ctx.save();
    ctx.fillStyle = 'rgba(3, 10, 6, 0.95)';
    ctx.fillRect(bx, by, boxW, boxH);
    drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, THEME.ACCENT_AMBER, 2.4);

    drawRankedTitleRibbon(
      ctx,
      bx + 22,
      by + 12,
      boxW - 44,
      24,
      `${SEMIOTIC_ICONS.STAR} OFFICIAL RANKED MODE — RECORD LOGGED TO ORBITAL RELAY ${SEMIOTIC_ICONS.STAR}`,
      params.timeSec,
      true
    );

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font('display', boxW < 540 ? 22 : 28);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    drawEllipsizedText(ctx, 'ORBITAL INTERCEPT // FLAK NET', bx + boxW * 0.5, by + 62, boxW - 36);

    // Reigning Leader Strip
    const leadY = by + 84;
    ctx.fillStyle = THEME.ACCENT_AMBER_BG;
    ctx.fillRect(bx + 22, leadY, boxW - 44, 38);
    ctx.strokeStyle = THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx + 22.5, leadY + 0.5, boxW - 45, 37);

    ctx.font = font('data', 14);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    const leaderText = leader
      ? `#01 RECORD: ${leader.callsign} — ${leader.score.toLocaleString()} PTS (W-${String(leader.wave).padStart(2, '0')} | x${leader.maxChain})`
      : uplinkStatus === 'LOADING'
        ? 'SYNCING ORBITAL LEADERBOARD...'
        : '#01 RECORD: UNCLAIMED — SET THE FIRST HIGH SCORE';
    drawEllipsizedText(ctx, leaderText, bx + boxW * 0.5, leadY + 19.5, boxW - 60);

    // 4 Tactile Keycap + Unified Weapon Briefing Rows
    const briefRows: Array<{
      cap: string;
      text: string;
      capAccent: string;
      textCol: string;
    }> = [
      {
        cap: 'LMB / A / D',
        text: 'M90 Flak — Airburst shells; aim beside Heavy Meteors to deflect!',
        capAccent: THEME.TEXT_PRIMARY,
        textCol: THEME.TEXT_BRIGHT,
      },
      {
        cap: 'RMB / SPACE / S',
        text: 'Mk-IV EMP — Massive pulse; stuns Boss salvos & scrambles MIRVs.',
        capAccent: THEME.ACCENT_AMBER,
        textCol: THEME.ACCENT_AMBER_HI,
      },
      {
        cap: '3X DANGER CLOSE',
        text: 'Intercept below 24KM for 3X; 3 Danger Kills or 1 Deflect = +1 EMP.',
        capAccent: THEME.ACCENT_AMBER,
        textCol: THEME.TEXT_BRIGHT,
      },
      {
        cap: 'CHAINS & OVERCLK',
        text: 'Chain up to x16 for 2X Lead Pips & -20% autoloader reload time.',
        capAccent: THEME.ACCENT_CYAN,
        textCol: THEME.TEXT_BRIGHT,
      },
    ];

    const footerBtnY2 = by + boxH - 48;
    const footerBtnY1 = footerBtnY2 - 48;
    const bonusH = 32;
    const bonusY = footerBtnY1 - bonusH - 8;
    const crt1979On = params.crtPreset === 'CLASSIC_1979';
    const rowsStartY = leadY + 48;
    const rowsAvailH = Math.max(90, bonusY - 8 - rowsStartY);
    const rowStep = Math.min(32, Math.floor(rowsAvailH / briefRows.length));

    briefRows.forEach((row, idx) => {
      const ry = rowsStartY + idx * rowStep + 12;
      const capW = drawKeycap(ctx, row.cap, bx + 24, ry, {
        height: 22,
        fontPx: 12,
        padX: 7,
        accent: row.capAccent,
        textColor: row.capAccent === THEME.TEXT_PRIMARY ? THEME.TEXT_BRIGHT : row.capAccent,
        centerY: true,
      });
      const textX = bx + 24 + Math.max(capW, 138) + 10;
      const textW = Math.max(100, bx + boxW - 24 - textX);
      ctx.font = font('prose', 13);
      ctx.fillStyle = row.textCol;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      drawEllipsizedText(ctx, row.text, textX, ry + 0.5, textW);
    });

    // Primary & Secondary Launch Actions + Super-Obvious 1979 1.5X Challenge Banner
    const innerW = boxW - 44;
    const gap = 12;
    const demoW = Math.round((innerW - gap) * 0.54);
    const manW = innerW - gap - demoW;

    draw1979RankedBonusBanner(
      ctx,
      { x: bx + 22, y: bonusY, width: innerW, height: bonusH },
      crt1979On,
      params.hoveredButtonId,
      params.timeSec,
      this.buttons
    );

    drawChromeButton(
      ctx,
      { x: bx + 22, y: footerBtnY1, width: innerW, height: 42 },
      crt1979On
        ? `${SEMIOTIC_ICONS.PLAY} ENGAGE RANKED FLAK NET [1.5X 1979 BONUS]`
        : `${SEMIOTIC_ICONS.PLAY} ENGAGE RANKED FLAK NET [ENTER]`,
      {
        id: 'flak-start',
        accent: 'amber',
        active: true,
        hovered: params.hoveredButtonId === 'flak-start',
        fontPx: 15,
      },
      this.buttons
    );

    drawChromeButton(
      ctx,
      { x: bx + 22, y: footerBtnY2, width: demoW, height: 38 },
      '[T] LAUNCH TACTICAL DEMO',
      {
        id: 'flak-demo',
        accent: 'cyan',
        hovered: params.hoveredButtonId === 'flak-demo',
        fontPx: 13,
      },
      this.buttons
    );

    drawChromeButton(
      ctx,
      { x: bx + 22 + demoW + gap, y: footerBtnY2, width: manW, height: 38 },
      `${SEMIOTIC_ICONS.STAR} LEADERBOARD`,
      {
        id: 'flak-manifest',
        accent: 'green',
        hovered: params.hoveredButtonId === 'flak-manifest',
        fontPx: 13,
      },
      this.buttons
    );

    ctx.restore();
  }

  // ===========================================================================
  // END-OF-WAVE AUDIT TALLY OVERLAY (Detailed Stats + Click/Space Fast-Forward!)
  // ===========================================================================
  private drawWaveAuditBanner(
    ctx: CanvasRenderingContext2D,
    params: FlakHudRenderParams,
    layout: FlakHudLayout
  ): void {
    const audit = params.sim.waveAudit;
    if (!audit) return;
    const vp = layout.scopeViewport;
    const sim = params.sim;

    const w = Math.min(560, vp.width - 32);
    const h = audit.dropPodRestoringDomeLabel ? 292 : 258;
    const x = Math.round(vp.x + (vp.width - w) * 0.5);
    const y = Math.round(vp.y + (vp.height - h) * 0.42);

    ctx.save();
    ctx.fillStyle = 'rgba(3, 11, 6, 0.94)';
    ctx.fillRect(x, y, w, h);
    drawCornerBrackets(ctx, x, y, w, h, 16, THEME.ACCENT_AMBER, 2.2);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = font('display', 20);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    drawEllipsizedText(
      ctx,
      `WAVE ${String(audit.completedWave).padStart(2, '0')} CLEARED // SECTOR AUDIT`,
      x + w * 0.5,
      y + 28,
      w - 32
    );

    // Combat Summary Strip (crisp wave debrief stats)
    const stripY = y + 48;
    ctx.fillStyle = THEME.BG_ROW_ALT;
    ctx.fillRect(x + 20, stripY, w - 40, 26);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.0;
    ctx.strokeRect(x + 20.5, stripY + 0.5, w - 41, 25);
    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    drawEllipsizedText(
      ctx,
      `KILLS ${sim.totalKills}  ·  ACC ${sim.getAccuracyPercent()}%  ·  PEAK x${sim.highChain}  ·  3X DC ${sim.dangerCloseKills}  ·  DFL ${sim.deflectionKills}`,
      x + w * 0.5,
      stripY + 13.5,
      w - 52
    );

    // Tally Rows
    ctx.font = font('data', 14);
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.TEXT_PRIMARY;
    ctx.fillText(
      `SURVIVING DOMES (${audit.talliedDomes}/${audit.survivingDomes}):`,
      x + 24,
      y + 100
    );
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.fillText(
      `+${(audit.talliedDomes * audit.domeBonusPerUnit).toLocaleString()}`,
      x + w - 24,
      y + 100
    );

    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.fillText(
      `UNUSED EMP ROUNDS (${audit.talliedEmp}/${audit.unusedEmpRounds}):`,
      x + 24,
      y + 128
    );
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.fillText(
      `+${(audit.talliedEmp * audit.empBonusPerUnit).toLocaleString()}`,
      x + w - 24,
      y + 128
    );

    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x + 24, y + 148);
    ctx.lineTo(x + w - 24, y + 148);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = font('head', 16);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.fillText('TOTAL WAVE AUDIT BONUS:', x + 24, y + 172);
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.fillText(`+${audit.totalWaveBonus.toLocaleString()}`, x + w - 24, y + 172);

    if (audit.dropPodRestoringDomeLabel) {
      ctx.textAlign = 'center';
      ctx.font = font('data', 13);
      ctx.fillStyle = THEME.ACCENT_CYAN;
      drawEllipsizedText(
        ctx,
        `${SEMIOTIC_ICONS.DIAMOND} ORBITAL DROP-POD RESTORING ${audit.dropPodRestoringDomeLabel}`,
        x + w * 0.5,
        y + 206,
        w - 40
      );
    }

    // Interactive Fast-Forward / Continue Button
    const skipBtnW = Math.min(300, w - 48);
    drawChromeButton(
      ctx,
      {
        x: Math.round(x + (w - skipBtnW) * 0.5),
        y: y + h - 46,
        width: skipBtnW,
        height: 34,
      },
      audit.done
        ? `${SEMIOTIC_ICONS.PLAY} NEXT WAVE [SPACE / CLICK]`
        : `${SEMIOTIC_ICONS.PLAY} FAST-FORWARD TALLY [SPACE / CLICK]`,
      {
        id: 'flak-audit-skip',
        accent: audit.done ? 'green' : 'amber',
        active: audit.done,
        hovered: params.hoveredButtonId === 'flak-audit-skip',
        fontPx: 13,
      },
      this.buttons
    );

    ctx.restore();
  }

  // ===========================================================================
  // UNIFIED SHARED POST-RUN DEBRIEF MODAL (PostRunFlow)
  // ===========================================================================
  private drawGameOverDebrief(ctx: CanvasRenderingContext2D, params: FlakHudRenderParams): void {
    const { width: w, height: h, sim } = params;
    drawGameOverDebriefModal(
      ctx,
      w,
      h,
      {
        title: 'COLONY ATMOSPHERE LOST // ALL DOMES BREACHED',
        subtitle: `ORBITAL INTERCEPT DEBRIEF · 3X DANGER: ${sim.dangerCloseKills} · DEFLECTIONS: ${sim.deflectionKills}`,
        outcomeTone: 'red',
        timeSec: params.timeSec,
        keylockRemainingSec: sim.gameOverLockoutTimer,
        stats: [
          { label: 'FINAL SCORE', value: sim.score.toLocaleString(), accent: 'amber' },
          { label: 'WAVE REACHED', value: `W-${String(sim.waveNumber).padStart(2, '0')}`, accent: 'green' },
          { label: 'MAX CHAIN', value: `x${sim.highChain}`, accent: 'cyan' },
          { label: 'ACC / KILLS', value: `${sim.getAccuracyPercent()}% (${sim.totalKills})`, accent: 'green' },
        ],
        isRanked: !sim.isDemoMode,
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

  // ===========================================================================
  // UNIFIED SHARED GLOBAL LEADERBOARD MODAL (PostRunFlow)
  // ===========================================================================
  private drawGlobalLeaderboardModal(
    ctx: CanvasRenderingContext2D,
    params: FlakHudRenderParams
  ): void {
    const { width: w, height: h, leaderboard, lastSubmittedRun, sim } = params;
    const { entries, showingArchiveFallback } = leaderboard.getEntries();
    const rawStatus = leaderboard.getStatus();
    const uplinkStatus =
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
            e.wave === lastSubmittedRun.wave
        );
      }
    }

    const rows: ManifestRowData[] = entries.slice(0, 12).map((e, i) => ({
      rank: i + 1,
      callsign: e.callsign,
      score: e.score,
      stats: [`W-${String(e.wave).padStart(2, '0')}`, `x${e.maxChain}`, `${e.accuracy}%`],
      isJustAdded: i === matchedJustIdx,
      isLocalFallback: e.isArchiveFallback,
    }));

    let justAddedBanner: string | null = null;
    if (lastSubmittedRun) {
      const dispRank = matchedJustIdx >= 0 ? matchedJustIdx + 1 : lastSubmittedRun.rank;
      const rankTag = `#${String(dispRank).padStart(2, '0')}`;
      justAddedBanner = `${SEMIOTIC_ICONS.STAR} RECORD LOGGED: RANK ${rankTag} — ${lastSubmittedRun.callsign} // ${lastSubmittedRun.score.toLocaleString()} PTS (W-${String(lastSubmittedRun.wave).padStart(2, '0')} | x${lastSubmittedRun.maxChain}) ${SEMIOTIC_ICONS.STAR}`;
    }

    drawGlobalManifestModal(
      ctx,
      w,
      h,
      {
        title: 'ORBITAL INTERCEPT // LEADERBOARD',
        uplinkStatus,
        timeSec: params.timeSec,
        columns: [
          { header: 'WAVE', widthFrac: 1, align: 'right' },
          { header: 'CHAIN', widthFrac: 1, align: 'right' },
          { header: 'ACC', widthFrac: 1, align: 'right' },
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

  // ===========================================================================
  // UNIFIED [H] / [?] 1-GLANCE CONTROLS QUICK-CARD (ControlsOverlay)
  // ===========================================================================
  private drawControlsQuickCard(ctx: CanvasRenderingContext2D, params: FlakHudRenderParams): void {
    drawControlsCardModal(
      ctx,
      params.width,
      params.height,
      {
        programTitle: 'FLAK NET',
        leftColumnTitle: 'WEAPONS & FIRE-CONTROL',
        rightColumnTitle: 'TACTICAL & SYSTEM KEYS',
        leftControls: [
          { keys: 'LMB / A / D', action: 'Fire M90 Proximity Flak' },
          { keys: 'RMB / SPACE / S', action: 'Fire Mk-IV EMP Mortar' },
          { keys: 'AIM BESIDE', action: 'Deflect Heavy Meteor (Billiard)' },
          { keys: 'EMP FIRE BTN', action: 'Touch / Trackpad Arm & Tap Sky' },
        ],
        rightControls: [
          { keys: 'P', action: 'Pause / Resume Simulation' },
          { keys: 'H / ?', action: 'Toggle Controls Quick-Card' },
          { keys: 'M', action: 'Mute / Unmute Audio Bus' },
          { keys: 'ESC', action: 'Unified System & Pause Menu' },
          { keys: 'SPACE / CLICK', action: 'Fast-Forward Wave Audit Tally' },
        ],
        coreRules: [
          'Intercept below 24KM (Danger Close) for 3X score; 3 Danger Kills or 1 Meteor Deflection Kill recharges +1 EMP round.',
          'Chain kills up to x16 to engage the 2X Ballistic Lead Predictor and -20% Overclock autoloader speed.',
          'Snipe MIRV Bio-Pods above 48KM before split, destroy Ion Jammers to clear radar, and EMP-stun Boss salvos.',
        ],
        hoveredButtonId: params.hoveredButtonId,
      },
      this.buttons
    );
  }
}
