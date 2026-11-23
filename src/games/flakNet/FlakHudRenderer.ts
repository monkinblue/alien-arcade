import { COLORS } from '../../constants';
import type { CrtInteractiveButton } from '../../render/HudRenderer';
import { drawRankedHudPill, drawRankedTitleRibbon } from '../../render/RankedBadge';
import type { ViewportRect } from '../../types';
import type { DemoTelemetryState } from './FlakDemoDirector';
import type { FlakLeaderboardService } from './FlakLeaderboard';
import type { FlakSimulation } from './FlakSimulation';
import type { DefenseBattery, FlakLastSubmittedRun } from './types';

export interface FlakHudLayout {
  hudScale: number;
  topBarH: number;
  leftPanel: ViewportRect;
  rightPanel: ViewportRect;
  bottomLog: ViewportRect;
  scopeViewport: ViewportRect;
}

export interface FlakHudRenderParams {
  width: number;
  height: number;
  timeSec: number;
  sim: FlakSimulation;
  leaderboard: FlakLeaderboardService;
  hoveredButtonId: string | null;
  audioMuted: boolean;
  isFullscreen: boolean;
  osdMenuOpen: boolean;
  manifestOpen: boolean;
  callsignDraft: string;
  callsignEditing: boolean;
  scoreSubmitted: boolean;
  submittingScore: boolean;
  submitResultBanner: string | null;
  lastSubmittedRun: FlakLastSubmittedRun | null;
  demoState?: DemoTelemetryState | null;
}

export class FlakHudRenderer {
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

  public computeLayout(width: number, height: number): FlakHudLayout {
    const w = Math.max(320, width);
    const h = Math.max(240, height);
    const margin = 6;
    const topBarH = 46;

    // Asymmetric tactical framing: rich Fire-Control Breech + Kill-CLI Left Console (282px)
    // paired with sleek Right Telemetry Strip (222px), preserving a huge wide-angle Radar Scope!
    const baseLeftW = 282;
    const baseRightW = 222;
    const basePanelH = 680;
    const scaleW = (w * 0.31) / (baseLeftW + baseRightW);
    const scaleH = (h - topBarH - margin - 8) / basePanelH;
    const hudScale = Math.max(0.62, Math.min(1.12, Math.min(scaleW, scaleH)));

    const leftW = Math.round(baseLeftW * hudScale);
    const rightW = Math.round(baseRightW * hudScale);
    const panelH = Math.max(240, h - topBarH - margin - 6);

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

    const centerX = leftPanel.x + leftPanel.width + 8;
    const centerW = Math.max(240, rightPanel.x - 8 - centerX);
    const logH = Math.max(58, Math.round(68 * hudScale));

    const bottomLog: ViewportRect = {
      x: centerX,
      y: h - margin - logH - 2,
      width: centerW,
      height: logH,
    };

    const scopeViewport: ViewportRect = {
      x: centerX,
      y: topBarH + 4,
      width: centerW,
      height: Math.max(160, bottomLog.y - 6 - (topBarH + 4)),
    };

    return {
      hudScale,
      topBarH,
      leftPanel,
      rightPanel,
      bottomLog,
      scopeViewport,
    };
  }

  public render(
    ctx: CanvasRenderingContext2D,
    params: FlakHudRenderParams,
    layout: FlakHudLayout
  ): void {
    this.buttons = [];

    this.drawTopHeader(ctx, params, layout);
    this.drawLeftFireControlConsole(ctx, params, layout);
    this.drawRightTelemetryStrip(ctx, params, layout);
    this.drawBottomTelemetryBar(ctx, params, layout);

    if (params.sim.phase === 'TITLE') {
      this.drawTitleOverlay(ctx, params, layout);
    } else if (params.sim.phase === 'WAVE_AUDIT' && params.sim.waveAudit && !params.sim.isDemoMode) {
      this.drawWaveAuditBanner(ctx, params, layout);
    } else if (params.sim.phase === 'GAME_OVER' && !params.sim.isDemoMode) {
      this.drawGameOverOverlay(ctx, params);
    }

    if (params.osdMenuOpen) {
      this.drawOsdMenuModal(ctx, params);
    } else if (params.manifestOpen) {
      this.drawManifestModal(ctx, params);
    }
  }

  // ===========================================================================
  // TOP HEADER BAR
  // ===========================================================================
  private drawTopHeader(
    ctx: CanvasRenderingContext2D,
    params: FlakHudRenderParams,
    layout: FlakHudLayout
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

    const compact = w < 1180;
    ctx.font = compact
      ? 'bold 15px "Share Tech Mono", monospace'
      : 'bold 17.5px "Share Tech Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#44FF77';
    const titleStr = 'ORBITAL INTERCEPT // FLAK NET';
    ctx.fillText(titleStr, 14, 30);

    const pillX = Math.round(14 + ctx.measureText(titleStr).width + 10);
    let badgeX: number;
    if (sim.isDemoMode) {
      const demoW = compact ? 132 : 156;
      ctx.fillStyle = 'rgba(42, 26, 4, 0.92)';
      ctx.fillRect(pillX, 10, demoW, 26);
      ctx.strokeStyle = '#FFB000';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(pillX, 10, demoW, 26);
      ctx.textAlign = 'center';
      ctx.font = compact
        ? 'bold 11.5px "Share Tech Mono", monospace'
        : 'bold 12.5px "Share Tech Mono", monospace';
      ctx.fillStyle = '#FFF6CC';
      ctx.fillText('DEMO // UNRANKED', pillX + demoW * 0.5, 27);
      ctx.textAlign = 'left';
      ctx.font = compact
        ? 'bold 15px "Share Tech Mono", monospace'
        : 'bold 17.5px "Share Tech Mono", monospace';
      badgeX = pillX + demoW + 10;
    } else {
      const rankedPillW = drawRankedHudPill(
        ctx,
        pillX,
        10,
        26,
        params.timeSec,
        true,
        compact
      );
      badgeX = pillX + rankedPillW + 10;
    }
    ctx.fillStyle = '#FFB000';
    const waveStr = sim.isDemoMode && params.demoState?.active
      ? `// STAGE 0${params.demoState.stageIndex}/0${params.demoState.totalStages} // SCORE ${sim.score.toLocaleString()}`
      : `// WAVE ${String(sim.waveNumber).padStart(2, '0')} // SCORE ${sim.score.toLocaleString()}`;
    ctx.fillText(waveStr, badgeX, 30);
    const titleRightEdge = Math.round(badgeX + ctx.measureText(waveStr).width + 14);

    const pills: Array<{ id: string; label: string; w: number; active: boolean; accent: string }> =
      [
        sim.isDemoMode
          ? {
              id: 'flak-exit-demo',
              label: '[ESC] EXIT DEMO',
              w: compact ? 114 : 128,
              active: true,
              accent: '#FFB000',
            }
          : {
              id: 'flak-pause',
              label: sim.paused ? '❚❚ PAUSED' : '[P] PAUSE',
              w: compact ? 92 : 104,
              active: sim.paused,
              accent: '#FFB000',
            },
        {
          id: 'flak-manifest',
          label: 'MANIFEST',
          w: compact ? 86 : 96,
          active: params.manifestOpen,
          accent: COLORS.GREEN_BRIGHT,
        },
        {
          id: 'flak-mute',
          label: params.audioMuted ? 'AUDIO: OFF' : 'AUDIO: ON',
          w: compact ? 88 : 96,
          active: !params.audioMuted,
          accent: params.audioMuted ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY,
        },
        {
          id: 'flak-fullscreen',
          label: params.isFullscreen ? 'EXIT FL' : 'FULLSCR',
          w: compact ? 76 : 84,
          active: params.isFullscreen,
          accent: COLORS.AMBER_BRIGHT,
        },
        {
          id: 'flak-osd',
          label: '[TAB] MENU',
          w: compact ? 94 : 104,
          active: params.osdMenuOpen,
          accent: '#FFB000',
        },
        {
          id: 'flak-exit-os',
          label: 'MU-TH-UR OS',
          w: compact ? 104 : 112,
          active: false,
          accent: '#FFB000',
        },
      ];

    let px = w - 12;
    for (let i = pills.length - 1; i >= 0; i--) {
      const p = pills[i];
      px -= p.w;
      if (px < titleRightEdge) break;
      this.addButton(
        ctx,
        p.id,
        { x: px, y: 7, width: p.w, height: 32 },
        p.label,
        p.active,
        params.hoveredButtonId,
        p.accent,
        compact ? 12.5 : 13.5
      );
      px -= 6;
    }

    ctx.restore();
  }

  // ===========================================================================
  // INNOVATIVE LEFT HUD:
  // 1) LIVE MECHANICAL BREECH CHAMBERS & HV EMP CAPACITOR BANK + SUBSYSTEM BUFFS
  // 2) SCROLLING COMMAND-LINE DESTROYED-UNIT KILL LOG (`KILL_LOG.SYS`) W/ COORDS
  // 3) COMPACT 4-CELL GEODESIC HABITAT PRESSURE SCHEMATIC
  // ===========================================================================
  private drawLeftFireControlConsole(
    ctx: CanvasRenderingContext2D,
    params: FlakHudRenderParams,
    layout: FlakHudLayout
  ): void {
    const { leftPanel: rect, hudScale: s } = layout;
    const { sim, timeSec } = params;
    const baseW = 282;
    const baseH = Math.round(rect.height / s);

    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.scale(s, s);

    ctx.fillStyle = 'rgba(3, 8, 5, 0.95)';
    ctx.fillRect(0, 0, baseW, baseH);
    this.drawCornerBrackets(ctx, 0, 0, baseW, baseH, 14, COLORS.GREEN_DIM, 2.2);

    // -------------------------------------------------------------------------
    // MODULE 1: LIVE MECHANICAL BREECH RACK & HV EMP CAPACITOR BANK + BUFFS
    // -------------------------------------------------------------------------
    ctx.textAlign = 'left';
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText('FIRE-CONTROL // BREECH BUS', 11, 21);

    ctx.textAlign = 'right';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('LV-426 NET', baseW - 11, 20);

    const rackX = 10;
    const rackW = baseW - 20;
    let curY = 28;

    // A) Twin M90 Flak Mechanical Breech Chambers ([A] Left & [D] Right)
    const batA = sim.batteries[0];
    const batD = sim.batteries[2];
    const batS = sim.batteries[1];
    const overclocked = sim.liveChain >= 4;

    if (batA) {
      this.drawFlakBreechChamber(ctx, batA, rackX, curY, rackW, 38, timeSec, overclocked);
      curY += 43;
    }
    if (batD) {
      this.drawFlakBreechChamber(ctx, batD, rackX, curY, rackW, 38, timeSec, overclocked);
      curY += 43;
    }
    if (batS) {
      this.drawEmpCapacitorBank(
        ctx,
        batS,
        rackX,
        curY,
        rackW,
        54,
        timeSec,
        sim.dangerCloseRechargeProgress,
        sim.empRechargeFlashTimer
      );
      curY += 59;
    }

    // B) Active Buff & Tactical Subsystem Status Bus (2X Predictor Wave | ECM | Drop-Pod)
    this.drawSubsystemBuffMatrix(ctx, sim, rackX, curY, rackW, 72, timeSec);
    curY += 80;

    // -------------------------------------------------------------------------
    // MODULE 3 (anchored at bottom): 4-CELL HABITAT PRESSURE SCHEMATIC
    // -------------------------------------------------------------------------
    const habH = 82;
    const habY = baseH - habH - 10;

    // -------------------------------------------------------------------------
    // MODULE 2 (fills middle): SCROLLING COMMAND-LINE KILL LOG (`KILL_LOG.SYS`)
    // -------------------------------------------------------------------------
    const cliY = curY;
    const cliH = Math.max(120, habY - cliY - 8);
    this.drawKillCommandLineLog(ctx, sim, rackX, cliY, rackW, cliH, timeSec);

    // Draw anchored 4-cell habitat pressure schematic at bottom
    this.drawHabitatPressureSchematic(ctx, sim, rackX, habY, rackW, habH, timeSec);

    ctx.restore();
  }

  private drawFlakBreechChamber(
    ctx: CanvasRenderingContext2D,
    bat: DefenseBattery,
    x: number,
    y: number,
    w: number,
    h: number,
    timeSec: number,
    overclocked = false
  ): void {
    const empty = bat.ammo <= 0;
    const firing = bat.recoil > 1.5;
    const borderCol = empty
      ? Math.sin(timeSec * 14) > 0
        ? COLORS.RED_KLAXON
        : '#6B1206'
      : firing
        ? '#FFF6CC'
        : overclocked
          ? '#FFB000'
          : 'rgba(68, 255, 119, 0.55)';

    ctx.save();
    ctx.fillStyle = firing
      ? 'rgba(42, 34, 8, 0.65)'
      : overclocked && !empty
        ? 'rgba(22, 18, 5, 0.92)'
        : 'rgba(5, 16, 10, 0.94)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = firing || empty || overclocked ? 1.8 : 1.3;
    ctx.strokeRect(x, y, w, h);

    // Left callsign tag
    ctx.textAlign = 'left';
    ctx.font = 'bold 12.5px "Share Tech Mono", monospace';
    ctx.fillStyle = empty ? COLORS.RED_KLAXON : overclocked ? '#FFE082' : '#44FF77';
    ctx.fillText(`[${bat.id}] M90`, x + 7, y + 15);

    ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
    ctx.fillStyle = firing || overclocked ? '#FFB000' : empty ? '#FF5538' : COLORS.GREEN_MID;
    ctx.fillText(
      firing
        ? 'RECOIL!'
        : bat.ammo < bat.maxAmmo
          ? overclocked
            ? 'OVERCLK!'
            : 'CYCLING'
          : overclocked
            ? 'OVCL RDY'
            : 'LOCKED',
      x + 7,
      y + 30
    );

    // 3 Physical Cartridge Breech Slots with vertical animated brass autoloader piston!
    const slotsX = x + 74;
    const slotsW = w - 120;
    const gap = 5;
    const slotW = (slotsW - gap * (bat.maxAmmo - 1)) / Math.max(1, bat.maxAmmo);
    const slotH = h - 12;
    const slotY = y + 6;

    for (let i = 0; i < bat.maxAmmo; i++) {
      const sx = slotsX + i * (slotW + gap);
      ctx.fillStyle = 'rgba(2, 8, 5, 0.95)';
      ctx.fillRect(sx, slotY, slotW, slotH);

      if (i < bat.ammo) {
        // Chambered live 90mm shell graphic (pointed brass/phosphor casing!)
        ctx.fillStyle = 'rgba(68, 255, 119, 0.28)';
        ctx.fillRect(sx + 1, slotY + 1, slotW - 2, slotH - 2);
        ctx.fillStyle = '#44FF77';
        ctx.fillRect(sx + 4, slotY + 7, slotW - 8, slotH - 10);
        // Shell warhead tip
        ctx.fillStyle = '#FFB000';
        ctx.fillRect(sx + 7, slotY + 3, slotW - 14, 4);
        ctx.strokeStyle = '#8EF5AB';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(sx, slotY, slotW, slotH);
      } else if (i === bat.ammo && bat.reloadProgress > 0) {
        // Animated autoloader piston pushing next shell up into breech!
        const fillH = Math.max(2, (slotH - 2) * bat.reloadProgress);
        ctx.fillStyle = 'rgba(255, 176, 0, 0.65)';
        ctx.fillRect(sx + 2, slotY + slotH - 1 - fillH, slotW - 4, fillH);
        ctx.strokeStyle = '#FFB000';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(sx, slotY, slotW, slotH);
      } else {
        ctx.strokeStyle = 'rgba(35, 100, 56, 0.45)';
        ctx.lineWidth = 1.1;
        ctx.strokeRect(sx, slotY, slotW, slotH);
      }
    }

    // Right-side digital chamber readout
    ctx.textAlign = 'right';
    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    ctx.fillStyle = empty ? COLORS.RED_KLAXON : '#8EF5AB';
    ctx.fillText(`${bat.ammo}/${bat.maxAmmo}`, x + w - 7, y + 23);
    ctx.restore();
  }

  private drawEmpCapacitorBank(
    ctx: CanvasRenderingContext2D,
    bat: DefenseBattery,
    x: number,
    y: number,
    w: number,
    h: number,
    timeSec: number,
    dcProgress = 0,
    rechargeFlashTimer = 0
  ): void {
    const empty = bat.ammo <= 0;
    const flashing = rechargeFlashTimer > 0;
    const flashBright = flashing && Math.sin(timeSec * 28) > -0.2;
    const borderCol = flashBright ? '#8EF5AB' : empty ? COLORS.RED_KLAXON : '#FFB000';

    ctx.save();
    ctx.fillStyle = flashBright
      ? 'rgba(18, 56, 32, 0.92)'
      : empty
        ? 'rgba(34, 8, 6, 0.85)'
        : 'rgba(28, 19, 4, 0.90)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = flashing ? 2.2 : 1.7;
    ctx.strokeRect(x, y, w, h);

    ctx.textAlign = 'left';
    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.fillStyle = flashBright ? '#FFF6CC' : empty ? COLORS.RED_KLAXON : '#FFB000';
    ctx.fillText('[S] MK-IV EMP CAPACITOR BANK', x + 7, y + 14);

    ctx.textAlign = 'right';
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = flashBright ? '#8EF5AB' : empty ? '#FF5538' : '#FFF6CC';
    ctx.fillText(
      flashing ? '+1 RECHARGED!' : empty ? 'DEPLETED' : `${bat.ammo}/${bat.maxAmmo} HV`,
      x + w - 7,
      y + 14
    );

    // Segmented Glowing Amber High-Voltage Coils + Live Oscilloscope Arc across active cells!
    const bankX = x + 7;
    const bankY = y + 20;
    const bankW = w - 14;
    const bankH = 15;
    const gap = 4;
    const cellW = (bankW - gap * (bat.maxAmmo - 1)) / Math.max(1, bat.maxAmmo);

    for (let i = 0; i < bat.maxAmmo; i++) {
      const cx = bankX + i * (cellW + gap);
      const charged = i < bat.ammo;
      ctx.fillStyle = charged ? 'rgba(255, 176, 0, 0.34)' : 'rgba(18, 12, 6, 0.9)';
      ctx.fillRect(cx, bankY, cellW, bankH);
      ctx.strokeStyle = charged ? (flashBright ? '#8EF5AB' : '#FFB000') : 'rgba(94, 52, 0, 0.6)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(cx, bankY, cellW, bankH);

      if (charged) {
        // Inner glowing capacitor filament bar
        ctx.fillStyle = flashBright ? '#FFF6CC' : '#FFE082';
        ctx.fillRect(cx + 3, bankY + 4.5, cellW - 6, 6);
      }
    }

    // Live crackling high-voltage sine waveform across charged capacitor cells
    if (bat.ammo > 0) {
      const litSpan = bat.ammo * cellW + Math.max(0, bat.ammo - 1) * gap;
      ctx.strokeStyle = '#FFF6CC';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const segs = 22;
      for (let k = 0; k <= segs; k++) {
        const u = k / segs;
        const px = bankX + u * litSpan;
        const py =
          bankY +
          bankH * 0.5 +
          Math.sin(u * 26 + timeSec * 28) * 3.5 * Math.sin(u * Math.PI);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Active EMP Capacitor Recharge Gauge (3 Danger Close kills or 1 Deflection Kill -> +1 HV shell!)
    const gaugeY = y + h - 6;
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    if (bat.ammo >= bat.maxAmmo) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8EF5AB';
      ctx.fillText('CAPACITOR FULL // MAX HV CHARGE', x + 7, gaugeY);
    } else {
      const filled = Math.max(0, Math.min(3, dcProgress));
      const pips = `${'■'.repeat(filled)}${'□'.repeat(3 - filled)}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = filled > 0 ? '#FFB000' : COLORS.GREEN_MID;
      ctx.fillText(`3X CHARGE: ${pips}`, x + 7, gaugeY);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(142, 245, 171, 0.78)';
      ctx.fillText('OR 1 DEFLECT KILL', x + w - 7, gaugeY);
    }

    ctx.restore();
  }

  private drawSubsystemBuffMatrix(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    x: number,
    y: number,
    w: number,
    h: number,
    timeSec: number
  ): void {
    const predOn = sim.predictorBoostTimer > 0;
    const predFrac = Math.max(0, Math.min(1, sim.predictorBoostTimer / sim.predictorBoostMaxSec));
    const jammed = sim.getActiveJammerIntensity() > 0.05;
    const podSteps = sim.waveNumber % 3; // 0 = arrives after this wave if dome down

    ctx.save();
    ctx.fillStyle = 'rgba(4, 14, 8, 0.94)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = predOn ? '#44FF77' : jammed ? '#FFB000' : COLORS.GREEN_DIM;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);

    // Row 1: 2X BALLISTIC PATH PREDICTOR BUFF WITH LIVE OSCILLOSCOPE TRACE!
    const r1Y = y + 5;
    ctx.fillStyle = predOn ? 'rgba(20, 62, 34, 0.65)' : 'rgba(2, 8, 5, 0.85)';
    ctx.fillRect(x + 5, r1Y, w - 10, 32);
    ctx.strokeStyle = predOn ? '#44FF77' : 'rgba(35, 100, 56, 0.4)';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(x + 5, r1Y, w - 10, 32);

    ctx.textAlign = 'left';
    ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
    ctx.fillStyle = predOn ? '#8EF5AB' : COLORS.GREEN_MID;
    ctx.fillText('2X LEAD + FAST LOAD', x + 10, r1Y + 13);

    ctx.textAlign = 'right';
    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    ctx.fillStyle =
      sim.liveChain >= 4 ? '#FFF6CC' : predOn ? '#FFB000' : 'rgba(59, 224, 104, 0.45)';
    ctx.fillText(
      sim.liveChain >= 4
        ? `OVERCLK -20%`
        : predOn
          ? `ONLINE ${sim.predictorBoostTimer.toFixed(1)}S`
          : 'STBY [HIT 2X]',
      x + w - 10,
      r1Y + 13
    );

    // Live Oscilloscope Waveform / Draining Phosphor Capacitor Bar
    const barX = x + 10;
    const barY = r1Y + 19;
    const barW = w - 20;
    ctx.fillStyle = 'rgba(8, 22, 14, 0.95)';
    ctx.fillRect(barX, barY, barW, 8);
    if (predOn) {
      ctx.fillStyle = sim.predictorBoostTimer < 2.5 ? '#FFB000' : '#44FF77';
      ctx.fillRect(barX, barY, barW * predFrac, 8);
      // Oscilloscope carrier wave pulse riding the charge bar
      ctx.strokeStyle = '#FFF6CC';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i <= 18; i++) {
        const u = i / 18;
        const wx = barX + u * barW * predFrac;
        const wy = barY + 4 + Math.sin(u * 18 - timeSec * 22) * 3.0;
        if (i === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
      }
      ctx.stroke();
    }

    // Row 2: Two side-by-side subsystem status cells (ECM RADAR | ORBITAL DROP-POD)
    const r2Y = y + 41;
    const cellGap = 5;
    const cellW = (w - 10 - cellGap) * 0.5;
    const cellH = 26;

    // Left cell: ECM / Radar Integrity
    const jamFlash = jammed && Math.sin(timeSec * 18) > 0;
    ctx.fillStyle = jammed ? 'rgba(64, 24, 8, 0.72)' : 'rgba(5, 16, 10, 0.9)';
    ctx.fillRect(x + 5, r2Y, cellW, cellH);
    ctx.strokeStyle = jamFlash ? COLORS.RED_KLAXON : jammed ? '#FFB000' : COLORS.GREEN_DIM;
    ctx.strokeRect(x + 5, r2Y, cellW, cellH);
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = jamFlash ? '#FFF6CC' : jammed ? '#FFB000' : '#44FF77';
    ctx.fillText(jammed ? '⚠ ECM JAMMED' : '● RADAR CLEAR', x + 5 + cellW * 0.5, r2Y + 17);

    // Right cell: Orbital Drop-Pod 3-Wave Supply Cycle
    const podX = x + 5 + cellW + cellGap;
    const needPod = sim.getIntactDomeCount() < 4;
    ctx.fillStyle = 'rgba(5, 16, 10, 0.9)';
    ctx.fillRect(podX, r2Y, cellW, cellH);
    ctx.strokeStyle = needPod ? '#FFB000' : COLORS.GREEN_DIM;
    ctx.strokeRect(podX, r2Y, cellW, cellH);
    const filledPips = podSteps === 0 ? 3 : podSteps;
    const pipTxt = `${'■'.repeat(filledPips)}${'□'.repeat(3 - filledPips)}`;
    ctx.fillStyle = needPod ? '#FFB000' : '#8EF5AB';
    ctx.fillText(`POD ${pipTxt}`, podX + cellW * 0.5, r2Y + 17);

    ctx.restore();
  }

  /**
   * Authentic 1979 Command-Line Destroyed-Unit Kill Log (`KILL_LOG.SYS`)
   * Prints every neutralized contact with unit ID, grid X coordinate, altitude km & kill method!
   */
  private drawKillCommandLineLog(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    x: number,
    y: number,
    w: number,
    h: number,
    timeSec: number
  ): void {
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 4, 0.98)';
    ctx.fillRect(x, y, w, h);
    this.drawCornerBrackets(ctx, x, y, w, h, 10, COLORS.GREEN_PRIMARY, 1.8);

    // CLI Title Bar
    ctx.fillStyle = 'rgba(14, 40, 22, 0.85)';
    ctx.fillRect(x + 2, y + 2, w - 4, 20);
    ctx.textAlign = 'left';
    ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText('MU-TH-UR // KILL_LOG.SYS', x + 8, y + 16);

    ctx.textAlign = 'right';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(`K:${String(sim.totalKills).padStart(3, '0')}`, x + w - 8, y + 16);

    // Column Header Legend
    const colY = y + 34;
    ctx.textAlign = 'left';
    ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(59, 224, 104, 0.56)';
    ctx.fillText('UNIT    GRID-X  ALT   KILL', x + 8, colY);
    ctx.strokeStyle = 'rgba(35, 110, 60, 0.45)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(x + 6, colY + 4);
    ctx.lineTo(x + w - 6, colY + 4);
    ctx.stroke();

    // Scrolling CLI Kill Rows (newest at bottom, terminal style!)
    const listTop = colY + 17;
    const footerH = 22;
    const availH = Math.max(24, y + h - footerH - listTop);
    const lineStep = 16;
    const maxLines = Math.max(1, Math.floor(availH / lineStep));
    const recentKills = sim.killLogs.slice(-maxLines);

    ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
    if (recentKills.length === 0) {
      ctx.fillStyle = 'rgba(59, 224, 104, 0.42)';
      ctx.fillText('> AWAITING INTERCEPTS...', x + 8, listTop);
      ctx.fillText('> GRID LOCK: 1920x1080', x + 8, listTop + lineStep);
    } else {
      recentKills.forEach((entry, idx) => {
        const ly = listTop + idx * lineStep;
        const isNewest = idx === recentKills.length - 1;
        ctx.globalAlpha = isNewest ? 1.0 : Math.max(0.45, 0.55 + (idx / recentKills.length) * 0.45);
        ctx.fillStyle =
          entry.tone === 'amber'
            ? '#FFB000'
            : entry.tone === 'bright'
              ? '#FFF6CC'
              : '#44FF77';
        const gx = String(entry.coordX).padStart(4, '0');
        const ak = `${String(entry.altKm).padStart(2, '0')}K`;
        const rowTxt = `>${entry.unitCode.padEnd(6, ' ')} X:${gx} ${ak} [${entry.methodTag}]`;
        ctx.fillText(rowTxt, x + 7, ly, w - 14);
      });
      ctx.globalAlpha = 1.0;
    }

    // Bottom Live CLI Prompt Cursor Line
    const promptY = y + h - 7;
    ctx.strokeStyle = 'rgba(35, 110, 60, 0.45)';
    ctx.beginPath();
    ctx.moveTo(x + 6, promptY - 14);
    ctx.lineTo(x + w - 6, promptY - 14);
    ctx.stroke();

    const cursorOn = Math.sin(timeSec * 8) > 0;
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#44FF77';
    ctx.fillText(
      `NET> CONFIRMED:${String(sim.totalKills).padStart(3, '0')} ${cursorOn ? '█' : ' '}`,
      x + 8,
      promptY
    );

    ctx.restore();
  }

  private drawHabitatPressureSchematic(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    x: number,
    y: number,
    w: number,
    h: number,
    timeSec: number
  ): void {
    const intact = sim.getIntactDomeCount();
    const borderCol =
      intact <= 1 ? COLORS.RED_KLAXON : intact <= 2 ? '#FFB000' : COLORS.GREEN_PRIMARY;

    ctx.save();
    ctx.fillStyle = 'rgba(2, 7, 4, 0.96)';
    ctx.fillRect(x, y, w, h);
    this.drawCornerBrackets(ctx, x, y, w, h, 9, borderCol, 1.7);

    ctx.textAlign = 'left';
    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.fillStyle = '#44FF77';
    ctx.fillText('HABITAT SEALS', x + 9, y + 16);

    ctx.textAlign = 'right';
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = borderCol;
    ctx.fillText(`${intact}/4 INTACT`, x + w - 9, y + 16);

    // 4 Compact Horizontal Geodesic Dome Pressure Bays (H1 | H2 | H3 | H4)
    const bayGap = 5;
    const bayW = (w - 16 - bayGap * 3) / 4;
    const bayH = 52;
    const bayY = y + 23;

    sim.domes.forEach((d, idx) => {
      const bx = x + 8 + idx * (bayW + bayGap);
      const breachBlink = !d.intact && Math.sin(timeSec * 12 + idx) > 0;
      ctx.fillStyle = d.intact
        ? 'rgba(14, 42, 24, 0.72)'
        : breachBlink
          ? 'rgba(92, 16, 10, 0.78)'
          : 'rgba(38, 10, 8, 0.75)';
      ctx.fillRect(bx, bayY, bayW, bayH);
      ctx.strokeStyle = d.intact ? COLORS.GREEN_PRIMARY : COLORS.RED_KLAXON;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(bx, bayY, bayW, bayH);

      // Mini Geodesic Dome Wireframe Silhouette
      const dcx = bx + bayW * 0.5;
      const dcy = bayY + 26;
      const dr = 14;
      if (d.intact) {
        ctx.strokeStyle = '#8EF5AB';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(dcx, dcy, dr, Math.PI, Math.PI * 2);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(dcx, dcy - dr);
        ctx.lineTo(dcx, dcy);
        ctx.stroke();
      } else {
        ctx.strokeStyle = COLORS.RED_KLAXON;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(dcx - dr, dcy);
        ctx.lineTo(dcx - 5, dcy - 10);
        ctx.lineTo(dcx + 2, dcy - 4);
        ctx.lineTo(dcx + dr, dcy);
        ctx.stroke();
      }

      ctx.textAlign = 'center';
      ctx.font = 'bold 10.5px "JetBrains Mono", monospace';
      ctx.fillStyle = d.intact ? '#44FF77' : '#FF5538';
      ctx.fillText(`H${idx + 1}`, dcx, bayY + 38);
      ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = d.intact ? '#8EF5AB' : COLORS.RED_KLAXON;
      ctx.fillText(d.intact ? '101KPA' : 'LOST', dcx, bayY + 49);
    });

    ctx.restore();
  }

  // ===========================================================================
  // RIGHT TELEMETRY STRIP: THREAT DENSITY + LIVE CHAIN + STATS + #01 LEADER
  // ===========================================================================
  private drawRightTelemetryStrip(
    ctx: CanvasRenderingContext2D,
    params: FlakHudRenderParams,
    layout: FlakHudLayout
  ): void {
    const { rightPanel: rect, hudScale: s } = layout;
    const { sim, leaderboard, timeSec } = params;
    const baseW = 222;
    const baseH = Math.round(rect.height / s);

    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.scale(s, s);

    ctx.fillStyle = 'rgba(3, 8, 5, 0.94)';
    ctx.fillRect(0, 0, baseW, baseH);
    this.drawCornerBrackets(ctx, 0, 0, baseW, baseH, 14, COLORS.GREEN_DIM, 2.2);

    ctx.textAlign = 'left';
    ctx.font = 'bold 14px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('RADAR TELEMETRY', 12, 22);

    // Dial 1: ATMOSPHERIC THREAT DENSITY
    const density = sim.getThreatDensityNormalized();
    const densCol =
      density > 0.72 ? COLORS.RED_KLAXON : density > 0.42 ? '#FFB000' : '#44FF77';
    this.drawAnalogDial(
      ctx,
      baseW * 0.5,
      104,
      56,
      density,
      'THREAT DENSITY',
      `${sim.threats.length} TRACKED`,
      densCol
    );

    // Live Chain Multiplier & 2x Ballistic Predictor Module
    const chainTop = 210;
    const chainH = 142;
    const hotChain = sim.liveChain >= 2;
    const predOn = sim.predictorBoostTimer > 0;
    const pulse = (hotChain || predOn) && Math.sin(timeSec * 14) > 0;
    ctx.fillStyle = hotChain ? 'rgba(54, 34, 4, 0.72)' : 'rgba(4, 14, 8, 0.94)';
    ctx.fillRect(10, chainTop, baseW - 20, chainH);
    this.drawCornerBrackets(
      ctx,
      10,
      chainTop,
      baseW - 20,
      chainH,
      10,
      hotChain ? '#FFB000' : predOn ? '#44FF77' : COLORS.GREEN_DIM,
      2.0
    );

    ctx.textAlign = 'center';
    ctx.font = 'bold 13px "Share Tech Mono", monospace';
    ctx.fillStyle = hotChain ? '#FFE082' : COLORS.GREEN_MID;
    ctx.fillText('LIVE CHAIN MULTIPLIER', baseW * 0.5, chainTop + 21);

    ctx.font = 'bold 46px "Share Tech Mono", monospace';
    ctx.fillStyle = pulse && hotChain ? '#FFF6CC' : hotChain ? '#FFB000' : '#44FF77';
    ctx.fillText(`x${sim.liveChain}`, baseW * 0.5, chainTop + 72);

    const decayFrac = Math.max(0, Math.min(1, sim.liveChainDecayTimer / 3.2));
    ctx.fillStyle = 'rgba(20, 44, 28, 0.8)';
    ctx.fillRect(20, chainTop + 84, baseW - 40, 6);
    if (decayFrac > 0.01) {
      ctx.fillStyle = '#FFB000';
      ctx.fillRect(20, chainTop + 84, (baseW - 40) * decayFrac, 6);
    }

    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText(
      `PEAK: x${sim.highChain} | ACC: ${sim.getAccuracyPercent()}%`,
      baseW * 0.5,
      chainTop + 108
    );

    ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
    ctx.fillStyle =
      sim.liveChain >= 4
        ? '#FFF6CC'
        : predOn
          ? pulse
            ? '#FFF6CC'
            : '#44FF77'
          : COLORS.GREEN_MID;
    ctx.fillText(
      sim.liveChain >= 4
        ? `OVERCLOCK x${sim.liveChain} (-20% LOAD)`
        : predOn
          ? `LEAD + LOAD: ON (${sim.predictorBoostTimer.toFixed(1)}S)`
          : 'LEAD + LOAD: SCORE 2X',
      baseW * 0.5,
      chainTop + 130
    );

    // Combat Telemetry & Live #01 FLAK NET LEADER Card
    const statTop = chainTop + chainH + 12;
    const statH = Math.max(124, baseH - statTop - 12);
    ctx.fillStyle = 'rgba(2, 7, 4, 0.95)';
    ctx.fillRect(10, statTop, baseW - 20, statH);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(10, statTop, baseW - 20, statH);

    ctx.textAlign = 'left';
    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#44FF77';
    ctx.fillText(`INTERCEPTS : ${sim.totalKills}`, 18, statTop + 24);
    ctx.fillStyle = '#FFB000';
    ctx.fillText(`DANGER 3X  : ${sim.dangerCloseKills}`, 18, statTop + 46);
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText(`DEFLECTIONS: ${sim.deflectionKills}`, 18, statTop + 68);
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(`SHOTS FIRED: ${sim.shotsFired}`, 18, statTop + 90);

    const leader = leaderboard.getReigningLeader();
    if (leader && statH >= 150) {
      const lTop = statTop + 106;
      ctx.strokeStyle = COLORS.AMBER_DIM;
      ctx.beginPath();
      ctx.moveTo(18, lTop);
      ctx.lineTo(baseW - 18, lTop);
      ctx.stroke();

      ctx.font = 'bold 12px "Share Tech Mono", monospace';
      ctx.fillStyle = '#FFB000';
      ctx.fillText('#01 FLAK NET LEADER', 18, lTop + 20);
      ctx.font = 'bold 13px "JetBrains Mono", monospace';
      ctx.fillStyle = '#FFF6CC';
      ctx.fillText(`${leader.callsign}`, 18, lTop + 40, baseW - 36);
      ctx.fillStyle = '#44FF77';
      ctx.fillText(`${leader.score.toLocaleString()} PTS`, 18, lTop + 59);
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
        accent === COLORS.RED_KLAXON
          ? 'rgba(255, 51, 24, 0.28)'
          : 'rgba(255, 176, 0, 0.26)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r - 4, startAng, valAng);
      ctx.closePath();
      ctx.fill();
    }

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
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(label, cx, cy + r + 15);

    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillStyle = accent;
    ctx.fillText(subText, cx, cy + r + 31);
    ctx.restore();
  }

  // ===========================================================================
  // BOTTOM MU-TH-UR TELEMETRY LOG BAR
  // ===========================================================================
  private drawBottomTelemetryBar(
    ctx: CanvasRenderingContext2D,
    params: FlakHudRenderParams,
    layout: FlakHudLayout
  ): void {
    const r = layout.bottomLog;
    const { sim } = params;
    ctx.save();
    ctx.fillStyle = 'rgba(3, 8, 5, 0.95)';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    this.drawCornerBrackets(ctx, r.x, r.y, r.width, r.height, 10, COLORS.GREEN_DIM, 1.8);

    ctx.textAlign = 'left';
    const maxLines = 3;
    const fontPx = Math.max(11.5, Math.min(13.5, Math.round(r.height * 0.21)));
    ctx.font = `bold ${fontPx}px "JetBrains Mono", monospace`;

    for (let i = 0; i < Math.min(maxLines, sim.logs.length); i++) {
      const entry = sim.logs[i];
      const ly = r.y + 19 + i * (fontPx + 6);
      ctx.fillStyle =
        entry.tone === 'red'
          ? COLORS.RED_KLAXON
          : entry.tone === 'amber'
            ? '#FFB000'
            : entry.tone === 'bright'
              ? '#8EF5AB'
              : '#44FF77';
      ctx.globalAlpha = i === 0 ? 1.0 : i === 1 ? 0.72 : 0.45;
      ctx.fillText(`LOG> [${entry.timestamp}] ${entry.text}`, r.x + 12, ly, r.width - 24);
    }

    ctx.restore();
  }

  // ===========================================================================
  // TITLE / READY SCREEN OVERLAY
  // ===========================================================================
  private drawTitleOverlay(
    ctx: CanvasRenderingContext2D,
    params: FlakHudRenderParams,
    layout: FlakHudLayout
  ): void {
    const vp = layout.scopeViewport;
    const leader = params.leaderboard.getReigningLeader();
    const uplinkStatus = params.leaderboard.getStatus();

    const boxW = Math.min(720, vp.width - 36);
    const boxH = Math.min(508, vp.height - 20);
    const bx = vp.x + (vp.width - boxW) * 0.5;
    const by = vp.y + (vp.height - boxH) * 0.5;

    ctx.save();
    ctx.fillStyle = 'rgba(2, 8, 5, 0.94)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 20, '#FFB000', 2.8);

    drawRankedTitleRibbon(
      ctx,
      bx + 26,
      by + 12,
      boxW - 52,
      24,
      '★ OFFICIAL RANKED MODE — HIGH SCORE RECORDED TO FLAK_SCORES ★',
      params.timeSec,
      true
    );

    ctx.textAlign = 'center';
    ctx.font = 'bold 31px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.RED_KLAXON;
    ctx.fillText('ORBITAL INTERCEPT // FLAK NET', bx + boxW * 0.5, by + 72);

    const leadY = by + 88;
    ctx.fillStyle = 'rgba(32, 22, 4, 0.92)';
    ctx.fillRect(bx + 26, leadY, boxW - 52, 44);
    ctx.strokeStyle = '#FFB000';
    ctx.lineWidth = 1.8;
    ctx.strokeRect(bx + 26, leadY, boxW - 52, 44);

    ctx.font = 'bold 15px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    const leaderText = leader
      ? `#01 FLAK NET LEADER: ${leader.callsign} — ${leader.score.toLocaleString()} PTS (WAVE ${String(leader.wave).padStart(2, '0')} | x${leader.maxChain})`
      : uplinkStatus === 'LOADING'
        ? 'SYNCING MU-TH-UR FLAK_SCORES UPLINK...'
        : '#01 FLAK NET LEADER: UNCLAIMED — SET THE FIRST RECORD';
    ctx.fillText(leaderText, bx + boxW * 0.5, leadY + 28, boxW - 68);

    ctx.textAlign = 'left';
    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    const lines = [
      { c: '#44FF77', t: '[LEFT-CLICK / A / D]  M90 FLAK — Airburst; aim BESIDE Heavy Meteors to deflect!' },
      { c: '#FFB000', t: '[RIGHT-CLICK / SPACE] MK-IV EMP MORTAR — Massive wave, stuns Boss & MIRVs' },
      { c: '#FFE082', t: '[DANGER CLOSE // 3X]  Intercept <24KM for 3X; 3 Danger Kills or 1 Deflect = +1 EMP!' },
      { c: '#8EF5AB', t: '[CHAINS & OVERCLOCK]  Chain hits (up to x16) for Lead Circles & Fast Reloads!' },
    ];
    let ly = leadY + 74;
    for (const l of lines) {
      ctx.fillStyle = l.c;
      ctx.fillText(l.t, bx + 28, ly, boxW - 56);
      ly += 30;
    }

    const innerW = boxW - 56;
    const btnY1 = by + boxH - 114;
    const btnY2 = by + boxH - 60;
    const gap = 14;
    const demoW = Math.round((innerW - gap) * 0.58);
    const manW = innerW - gap - demoW;

    this.addButton(
      ctx,
      'flak-start',
      { x: bx + 28, y: btnY1, width: innerW, height: 44 },
      '► ENGAGE RANKED FLAK NET [ENTER] ◄',
      true,
      params.hoveredButtonId,
      '#FFB000',
      16.5
    );
    this.addButton(
      ctx,
      'flak-demo',
      { x: bx + 28, y: btnY2, width: demoW, height: 42 },
      '[T] DEMO // TACTICAL BRIEFING',
      false,
      params.hoveredButtonId,
      '#FFB000',
      14.5
    );
    this.addButton(
      ctx,
      'flak-manifest',
      { x: bx + 28 + demoW + gap, y: btnY2, width: manW, height: 42 },
      'GLOBAL LEADERBOARD',
      false,
      params.hoveredButtonId,
      '#44FF77',
      14.5
    );

    ctx.restore();
  }

  // ===========================================================================
  // END-OF-WAVE AUDIT TALLY OVERLAY
  // ===========================================================================
  private drawWaveAuditBanner(
    ctx: CanvasRenderingContext2D,
    params: FlakHudRenderParams,
    layout: FlakHudLayout
  ): void {
    const audit = params.sim.waveAudit;
    if (!audit) return;
    const vp = layout.scopeViewport;

    const w = Math.min(540, vp.width - 40);
    const h = audit.dropPodRestoringDomeLabel ? 248 : 210;
    const x = vp.x + (vp.width - w) * 0.5;
    const y = vp.y + (vp.height - h) * 0.34;

    ctx.save();
    ctx.fillStyle = 'rgba(2, 9, 5, 0.92)';
    ctx.fillRect(x, y, w, h);
    this.drawCornerBrackets(ctx, x, y, w, h, 16, '#FFB000', 2.4);

    ctx.textAlign = 'center';
    ctx.font = 'bold 24px "Share Tech Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText(
      `WAVE ${String(audit.completedWave).padStart(2, '0')} CLEARED // SECTOR AUDIT`,
      x + w * 0.5,
      y + 38
    );

    ctx.textAlign = 'left';
    ctx.font = 'bold 16px "JetBrains Mono", monospace';
    ctx.fillStyle = '#44FF77';
    ctx.fillText(
      `SURVIVING DOMES (${audit.talliedDomes}/${audit.survivingDomes}):`,
      x + 28,
      y + 82
    );
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FFF6CC';
    ctx.fillText(
      `+${(audit.talliedDomes * audit.domeBonusPerUnit).toLocaleString()}`,
      x + w - 28,
      y + 82
    );

    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(
      `UNUSED EMP ROUNDS (${audit.talliedEmp}/${audit.unusedEmpRounds}):`,
      x + 28,
      y + 116
    );
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FFF6CC';
    ctx.fillText(
      `+${(audit.talliedEmp * audit.empBonusPerUnit).toLocaleString()}`,
      x + w - 28,
      y + 116
    );

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.beginPath();
    ctx.moveTo(x + 28, y + 136);
    ctx.lineTo(x + w - 28, y + 136);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = 'bold 18px "Share Tech Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText('TOTAL WAVE AUDIT BONUS:', x + 28, y + 168);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(`+${audit.totalWaveBonus.toLocaleString()}`, x + w - 28, y + 168);

    if (audit.dropPodRestoringDomeLabel) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px "Share Tech Mono", monospace';
      ctx.fillStyle = '#8EF5AB';
      ctx.fillText(
        `► ORBITAL DROP-POD RESTORING ${audit.dropPodRestoringDomeLabel} ◄`,
        x + w * 0.5,
        y + 214
      );
    }

    ctx.restore();
  }

  // ===========================================================================
  // GAME OVER & FAST PRE-FILLED CALLSIGN SUBMISSION MODAL
  // ===========================================================================
  private drawGameOverOverlay(ctx: CanvasRenderingContext2D, params: FlakHudRenderParams): void {
    const { width: w, height: h, sim, timeSec } = params;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 5, 3, 0.78)';
    ctx.fillRect(0, 0, w, h);

    const bw = Math.min(620, w - 36);
    const bh = 420;
    const bx = (w - bw) * 0.5;
    const by = (h - bh) * 0.5;

    ctx.fillStyle = 'rgba(4, 10, 6, 0.97)';
    ctx.fillRect(bx, by, bw, bh);
    this.drawCornerBrackets(ctx, bx, by, bw, bh, 20, COLORS.RED_KLAXON, 2.8);

    ctx.textAlign = 'center';
    ctx.font = 'bold 28px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.RED_KLAXON;
    ctx.fillText('COLONY ATMOSPHERE LOST // ALL DOMES BREACHED', bx + bw * 0.5, by + 44, bw - 36);

    ctx.fillStyle = 'rgba(18, 28, 20, 0.75)';
    ctx.fillRect(bx + 26, by + 64, bw - 52, 92);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(bx + 26, by + 64, bw - 52, 92);

    ctx.font = 'bold 26px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(`FINAL SCORE: ${sim.score.toLocaleString()}`, bx + bw * 0.5, by + 102);

    ctx.font = 'bold 14.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText(
      `WAVE ${String(sim.waveNumber).padStart(2, '0')}  |  MAX CHAIN x${sim.highChain}  |  ACCURACY ${sim.getAccuracyPercent()}%  |  KILLS ${sim.totalKills}`,
      bx + bw * 0.5,
      by + 136,
      bw - 68
    );

    const lockedOut = sim.gameOverLockoutTimer > 0;
    const csTop = by + 174;
    ctx.textAlign = 'left';
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = lockedOut ? '#FFB000' : params.callsignEditing ? '#44FF77' : '#8EF5AB';
    const csPrompt = lockedOut
      ? `KEYLOCK ACTIVE (${sim.gameOverLockoutTimer.toFixed(1)}S) — RELEASE FIRING KEYS...`
      : params.callsignEditing && !params.scoreSubmitted
        ? 'EDITING CALLSIGN — TYPE NAME, [ENTER] SUBMIT, [ESC] DONE:'
        : params.scoreSubmitted
          ? 'OPERATOR CALLSIGN TRANSMITTED TO MU-TH-UR FLAK_SCORES:'
          : 'CLICK CALLSIGN (OR [C]) TO EDIT · [ENTER] SUBMIT · [SPACE/R] REDEPLOY:';
    ctx.fillText(csPrompt, bx + 28, csTop, bw - 56);

    const inputRect: ViewportRect = { x: bx + 28, y: csTop + 12, width: bw - 56, height: 46 };
    ctx.fillStyle =
      params.callsignEditing && !params.scoreSubmitted && !lockedOut
        ? 'rgba(12, 42, 22, 0.96)'
        : 'rgba(2, 12, 7, 0.96)';
    ctx.fillRect(inputRect.x, inputRect.y, inputRect.width, inputRect.height);
    ctx.strokeStyle = lockedOut
      ? COLORS.GREEN_DIM
      : params.scoreSubmitted
        ? '#8EF5AB'
        : params.callsignEditing
          ? '#44FF77'
          : '#FFB000';
    ctx.lineWidth = params.callsignEditing ? 2.6 : 2.1;
    ctx.strokeRect(inputRect.x, inputRect.y, inputRect.width, inputRect.height);

    const cursorBlink =
      !lockedOut && !params.scoreSubmitted && params.callsignEditing && Math.sin(timeSec * 8) > 0;
    ctx.font = 'bold 22px "JetBrains Mono", monospace';
    ctx.fillStyle = lockedOut ? COLORS.GREEN_MID : '#FFF6CC';
    ctx.fillText(
      `> ${params.callsignDraft}${cursorBlink ? '█' : ''}`,
      inputRect.x + 14,
      inputRect.y + 31
    );

    if (!lockedOut && !params.scoreSubmitted) {
      this.buttons.push({
        id: 'flak-callsign-focus',
        rect: inputRect,
        label: 'EDIT CALLSIGN',
      });
    }

    if (params.submitResultBanner) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px "JetBrains Mono", monospace';
      ctx.fillStyle = '#8EF5AB';
      ctx.fillText(params.submitResultBanner, bx + bw * 0.5, csTop + 82, bw - 56);
    }

    const btnY = by + bh - 122;
    if (!params.scoreSubmitted) {
      this.addButton(
        ctx,
        lockedOut ? 'flak-locked' : 'flak-submit-score',
        { x: bx + 28, y: btnY, width: bw - 56, height: 44 },
        lockedOut
          ? `KEYLOCK ACTIVE (${sim.gameOverLockoutTimer.toFixed(1)}S)...`
          : params.submittingScore
            ? 'TRANSMITTING TELEMETRY TO MU-TH-UR...'
            : '► TRANSMIT SCORE TO GLOBAL FLAK_SCORES [ENTER] ◄',
        !lockedOut,
        params.hoveredButtonId,
        lockedOut ? COLORS.GREEN_DIM : '#FFB000',
        15.5
      );
    } else {
      this.addButton(
        ctx,
        'flak-manifest',
        { x: bx + 28, y: btnY, width: bw - 56, height: 44 },
        'VIEW GLOBAL FLAK_SCORES LEADERBOARD',
        false,
        params.hoveredButtonId,
        '#8EF5AB',
        15.5
      );
    }

    const bottomBtnY = by + bh - 64;
    const halfW = (bw - 56 - 14) * 0.5;
    this.addButton(
      ctx,
      lockedOut ? 'flak-locked-restart' : 'flak-restart',
      { x: bx + 28, y: bottomBtnY, width: halfW, height: 42 },
      lockedOut ? 'REDEPLOY WAVE 01 (LOCKED)' : 'REDEPLOY WAVE 01 [SPACE / R]',
      false,
      params.hoveredButtonId,
      lockedOut ? COLORS.GREEN_DIM : '#44FF77',
      14.5
    );
    this.addButton(
      ctx,
      'flak-exit-os',
      { x: bx + 28 + halfW + 14, y: bottomBtnY, width: halfW, height: 42 },
      'EXIT TO MU-TH-UR OS',
      false,
      params.hoveredButtonId,
      '#FFB000',
      15.5
    );

    ctx.restore();
  }

  // ===========================================================================
  // GLOBAL LEADERBOARD MODAL (`flak_scores`) WITH ★ JUST ADDED HIGHLIGHT!
  // ===========================================================================
  private drawManifestModal(ctx: CanvasRenderingContext2D, params: FlakHudRenderParams): void {
    const { width: w, height: h, leaderboard, lastSubmittedRun, timeSec } = params;
    const { entries, showingArchiveFallback } = leaderboard.getEntries();
    const status = leaderboard.getStatus();

    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 4, 0.84)';
    ctx.fillRect(0, 0, w, h);

    const bw = Math.min(780, w - 36);
    const bh = Math.min(620, h - 44);
    const bx = (w - bw) * 0.5;
    const by = (h - bh) * 0.5;

    ctx.fillStyle = 'rgba(3, 9, 5, 0.98)';
    ctx.fillRect(bx, by, bw, bh);
    this.drawCornerBrackets(ctx, bx, by, bw, bh, 20, '#44FF77', 2.6);

    ctx.textAlign = 'left';
    ctx.font = 'bold 21px "Share Tech Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText('MU-TH-UR // FLAK_SCORES GLOBAL TELEMETRY', bx + 22, by + 34);

    ctx.textAlign = 'right';
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle =
      status === 'LIVE' && !showingArchiveFallback ? '#44FF77' : '#FFB000';
    ctx.fillText(
      status === 'LIVE' && !showingArchiveFallback
        ? '● UPLINK: LIVE FIRESTORE'
        : '● LOCAL ARCHIVE FALLBACK',
      bx + bw - 22,
      by + 33
    );

    const headY = by + 64;
    ctx.fillStyle = 'rgba(18, 44, 26, 0.72)';
    ctx.fillRect(bx + 18, headY - 18, bw - 36, 26);

    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.textAlign = 'left';
    ctx.fillText('RK', bx + 26, headY);
    ctx.fillText('CALLSIGN', bx + 84, headY);
    ctx.textAlign = 'right';
    ctx.fillText('SCORE', bx + bw * 0.65, headY);
    ctx.fillText('WAVE', bx + bw * 0.76, headY);
    ctx.fillText('CHAIN', bx + bw * 0.87, headY);
    ctx.fillText('ACC', bx + bw - 26, headY);

    const availRowsH = bh - 196;
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
            e.wave === lastSubmittedRun.wave
        );
      }
    }

    const pulseNew = 0.5 + 0.5 * Math.sin(timeSec * 8.5);
    let ry = headY + 28;
    visibleEntries.forEach((e, i) => {
      const isJustAdded = i === matchedJustIdx;
      if (isJustAdded) {
        ctx.fillStyle = `rgba(68, 255, 119, ${(0.18 + pulseNew * 0.14).toFixed(3)})`;
        ctx.fillRect(bx + 16, ry - 18, bw - 32, 27);
        ctx.strokeStyle = '#44FF77';
        ctx.lineWidth = 2.2;
        ctx.strokeRect(bx + 16, ry - 18, bw - 32, 27);
      } else if (i % 2 === 1) {
        ctx.fillStyle = 'rgba(16, 36, 22, 0.35)';
        ctx.fillRect(bx + 18, ry - 18, bw - 36, 26);
      }

      ctx.font = 'bold 14px "JetBrains Mono", monospace';
      ctx.fillStyle = isJustAdded ? '#FFFFFF' : i === 0 ? '#FFB000' : i < 3 ? '#8EF5AB' : '#44FF77';
      ctx.textAlign = 'left';
      ctx.fillText(
        isJustAdded ? `►#${String(i + 1).padStart(2, '0')}` : `#${String(i + 1).padStart(2, '0')}`,
        isJustAdded ? bx + 20 : bx + 26,
        ry
      );
      ctx.fillText(e.callsign, bx + 84, ry);

      if (isJustAdded) {
        const callW = ctx.measureText(e.callsign).width;
        const badgeX = Math.min(bx + 258, bx + 92 + callW);
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
      }

      ctx.textAlign = 'right';
      ctx.fillStyle = isJustAdded ? '#FFFFFF' : i === 0 ? '#FFB000' : '#44FF77';
      ctx.fillText(e.score.toLocaleString(), bx + bw * 0.65, ry);
      ctx.fillStyle = isJustAdded ? '#7BFF9E' : '#8EF5AB';
      ctx.fillText(`W-${String(e.wave).padStart(2, '0')}`, bx + bw * 0.76, ry);
      ctx.fillText(`x${e.maxChain}`, bx + bw * 0.87, ry);
      ctx.fillText(`${e.accuracy}%`, bx + bw - 26, ry);
      ry += 28;
    });

    // Bottom ★ YOUR JUST-COMPLETED RUN banner (matching Lunar Lander & Perimeter!)
    const bannerY = by + bh - 96;
    if (lastSubmittedRun) {
      const dispRank = matchedJustIdx >= 0 ? matchedJustIdx + 1 : lastSubmittedRun.rank;
      const rankTag = `#${String(dispRank).padStart(2, '0')}`;
      ctx.fillStyle = 'rgba(26, 78, 42, 0.55)';
      ctx.fillRect(bx + 22, bannerY, bw - 44, 28);
      ctx.strokeStyle = '#44FF77';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(bx + 22, bannerY, bw - 44, 28);
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px "Share Tech Mono", monospace';
      ctx.fillStyle = '#7BFF9E';
      ctx.fillText(
        `★ YOUR JUST-COMPLETED RUN: RANK ${rankTag} — ${lastSubmittedRun.callsign} // ${lastSubmittedRun.score.toLocaleString()} PTS (W-${String(lastSubmittedRun.wave).padStart(2, '0')} | x${lastSubmittedRun.maxChain}) ★`,
        w * 0.5,
        bannerY + 19,
        bw - 60
      );
    }

    const btnGap = 12;
    const halfW = (bw - 44 - btnGap) * 0.5;
    this.addButton(
      ctx,
      'flak-restart',
      { x: bx + 22, y: by + bh - 54, width: halfW, height: 38 },
      'REDEPLOY WAVE 01',
      false,
      params.hoveredButtonId,
      '#44FF77',
      15.5
    );
    this.addButton(
      ctx,
      'flak-close-modal',
      { x: bx + 22 + halfW + btnGap, y: by + bh - 54, width: halfW, height: 38 },
      '[ESC] CLOSE MANIFEST',
      true,
      params.hoveredButtonId,
      '#FFB000',
      15.5
    );

    ctx.restore();
  }

  // ===========================================================================
  // STANDARDIZED MU-TH-UR 6000 SYSTEM & COMMAND MENU [TAB] (Unified Programs 1-3!)
  // ===========================================================================
  private drawOsdMenuModal(ctx: CanvasRenderingContext2D, params: FlakHudRenderParams): void {
    const { width: w, height: h, sim, hoveredButtonId } = params;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 6, 4, 0.78)';
    ctx.fillRect(0, 0, w, h);

    const boxW = Math.min(700, w - 48);
    const boxH = Math.min(368, h - 40);
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

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

    // Top 3-Button Mission Command Strip
    const cmdY = by + 54;
    const cmdGap = 10;
    const cmdW = (boxW - 44 - cmdGap * 2) / 3;
    this.addButton(
      ctx,
      'flak-close-modal',
      { x: bx + 22, y: cmdY, width: cmdW, height: 36 },
      '[TAB] RESUME INTERCEPT',
      true,
      hoveredButtonId,
      COLORS.GREEN_BRIGHT,
      14.5
    );
    this.addButton(
      ctx,
      'flak-restart',
      { x: bx + 22 + cmdW + cmdGap, y: cmdY, width: cmdW, height: 36 },
      'RESTART WAVE 01',
      false,
      hoveredButtonId,
      COLORS.AMBER_CAUTION,
      14.5
    );
    this.addButton(
      ctx,
      'flak-manifest',
      { x: bx + 22 + (cmdW + cmdGap) * 2, y: cmdY, width: cmdW, height: 36 },
      'GLOBAL LEADERBOARD',
      false,
      hoveredButtonId,
      '#8EF5AB',
      14.5
    );

    // Standardized Hardware & System Toggle Rows
    const rowStartY = cmdY + 50;
    const rowStep = 50;
    const switches = [
      {
        id: 'flak-pause',
        name: 'RADAR SIMULATION PAUSE [P]',
        status: sim.paused ? '❚❚ PAUSED' : '● LIVE SIMULATION',
        active: sim.paused,
        accent: sim.paused ? '#FFB000' : COLORS.GREEN_BRIGHT,
      },
      {
        id: 'flak-mute',
        name: 'INTERCOM & AUDIO BUS',
        status: params.audioMuted ? '▲ BUS MUTED [OFF]' : '● BUS ACTIVE [ON]',
        active: !params.audioMuted,
        accent: params.audioMuted ? COLORS.RED_KLAXON : COLORS.GREEN_BRIGHT,
      },
      {
        id: 'flak-fullscreen',
        name: 'FULLSCREEN DISPLAY MODE',
        status: params.isFullscreen ? '● FULLSCREEN [ON]' : '○ WINDOWED [OFF]',
        active: params.isFullscreen,
        accent: params.isFullscreen ? COLORS.GREEN_BRIGHT : COLORS.AMBER_BRIGHT,
      },
      {
        id: 'flak-manifest',
        name: 'MU-TH-UR FLAK_SCORES MANIFEST',
        status: 'VIEW GLOBAL LEADERBOARD',
        active: false,
        accent: COLORS.GREEN_PRIMARY,
      },
    ];

    switches.forEach((sw, idx) => {
      const sy = rowStartY + idx * rowStep;
      ctx.fillStyle = 'rgba(8, 22, 13, 0.72)';
      ctx.fillRect(bx + 22, sy, boxW - 44, 42);
      ctx.strokeStyle = COLORS.GREEN_DIM;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(bx + 22, sy, boxW - 44, 42);

      ctx.textAlign = 'left';
      ctx.font = 'bold 16px "Share Tech Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_PRIMARY;
      ctx.fillText(sw.name, bx + 34, sy + 27);

      this.addButton(
        ctx,
        sw.id,
        { x: bx + boxW - 268, y: sy + 4, width: 234, height: 34 },
        sw.status,
        sw.active,
        hoveredButtonId,
        sw.accent,
        14
      );
    });

    // Standardized 2-Column Footer Row
    const footGap = 12;
    const footBtnW = Math.floor((boxW - 44 - footGap) * 0.5);
    this.addButton(
      ctx,
      'flak-close-modal',
      { x: bx + 22, y: by + boxH - 48, width: footBtnW, height: 38 },
      '[TAB / ESC] CLOSE MENU',
      true,
      hoveredButtonId,
      COLORS.GREEN_BRIGHT,
      15.5
    );
    this.addButton(
      ctx,
      'flak-exit-os',
      { x: bx + 22 + footBtnW + footGap, y: by + boxH - 48, width: footBtnW, height: 38 },
      '[EXIT TO MU-TH-UR OS]',
      false,
      hoveredButtonId,
      '#FFB000',
      15.5
    );

    ctx.restore();
  }

  private addButton(
    ctx: CanvasRenderingContext2D,
    id: string,
    rect: ViewportRect,
    label: string,
    active: boolean,
    hoveredButtonId: string | null,
    accent: string,
    fontPx: number
  ): void {
    this.buttons.push({ id, rect, label });
    const hov = hoveredButtonId === id;
    ctx.save();
    ctx.fillStyle = hov
      ? 'rgba(255, 176, 0, 0.28)'
      : active
        ? 'rgba(255, 176, 0, 0.16)'
        : 'rgba(6, 16, 10, 0.94)';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = hov ? '#FFFFFF' : accent;
    ctx.lineWidth = hov || active ? 2.1 : 1.6;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    ctx.textAlign = 'center';
    ctx.font = `bold ${fontPx}px "Share Tech Mono", monospace`;
    ctx.fillStyle = hov ? '#FFFFFF' : accent;
    ctx.fillText(label, rect.x + rect.width * 0.5, rect.y + rect.height * 0.65);
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
