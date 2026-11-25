import { COLORS } from '../constants';
import type { CrtInteractiveButton } from '../render/HudRenderer';
import { drawRankedHudPill, drawRankedTitleRibbon } from '../render/RankedBadge';
import type { ViewportRect } from '../types';
import type { PerimeterManifest } from './PerimeterManifest';
import type { PerimeterSimulation } from './PerimeterSimulation';
import {
  HARDWARE_SPECS,
  PERIMETER_CONSTANTS,
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
  callsignDraft: string;
  scoreSubmitted: boolean;
  submittingScore: boolean;
  submitResultBanner: string | null;
  lastSubmittedRun: PerimeterLastSubmittedRun | null;
  statusToast: string | null;
}

export class PerimeterHudRenderer {
  public buttons: CrtInteractiveButton[] = [];

  public computeLayout(w: number, h: number): PerimeterLayout {
    const margin = Math.max(6, Math.round(w * 0.006));
    const topBarH = 46;
    // Widescreen CAD layout: slim sidebars (~34.5% combined width) give the 16:9 blueprint massive visual area!
    const baseLeftW = 274;
    const baseRightW = 368;
    const basePanelH = 744;

    const scaleW = (w * 0.345) / (baseLeftW + baseRightW);
    const scaleH = (h - topBarH - margin - 6) / basePanelH;
    const hudScale = Math.max(0.62, Math.min(1.18, Math.min(scaleW, scaleH)));

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

    if (params.statusToast) {
      this.drawToastBanner(ctx, params.statusToast, layout.blueprintViewport);
    }

    if (params.sim.phase === 'BRIEFING') {
      this.drawBriefingOverlay(ctx, params);
    } else if (
      params.sim.phase === 'SECTOR_VICTORY' ||
      params.sim.phase === 'CORE_BREACHED'
    ) {
      this.drawEndOfRunOverlay(ctx, params);
    } else if (params.sim.phase === 'CALLSIGN_ENTRY') {
      this.drawCallsignEntryModal(ctx, params);
    }

    if (params.osdMenuOpen) {
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

    const compactHeader = w < 1280;
    const modeBadge =
      sim.mode === 'ENDLESS_SIEGE'
        ? compactHeader
          ? `SIEGE // W-${String(sim.waveNumber).padStart(2, '0')}`
          : `ENDLESS HIVE SIEGE // WAVE ${String(sim.waveNumber).padStart(2, '0')}`
        : compactHeader
          ? `SEC-01 MED-LAB // W-${String(sim.waveNumber).padStart(2, '0')}/10`
          : `SEC-01: HADLEY MED-LAB // WAVE ${String(sim.waveNumber).padStart(2, '0')}/10`;

    ctx.font = compactHeader
      ? 'bold 15px "Share Tech Mono", monospace'
      : 'bold 17px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.textAlign = 'left';
    const brandStr = 'HADLEY PERIMETER';
    ctx.fillText(brandStr, 14, 30);

    const pillX = Math.round(14 + ctx.measureText(brandStr).width + 10);
    const rankedPillW = drawRankedHudPill(
      ctx,
      pillX,
      10,
      26,
      params.timeSec,
      true,
      compactHeader
    );
    const titleOffset = pillX + rankedPillW + 10;
    const badgeText = `// ${modeBadge}`;
    ctx.fillStyle = '#FFB000';
    ctx.fillText(badgeText, titleOffset, 30);
    const titleRightEdge = Math.round(titleOffset + ctx.measureText(badgeText).width + 14);

    // Top-Right Control Strip (including [EXIT TO MU-TH-UR OS])
    const pills: Array<{ id: string; label: string; w: number; active: boolean; accent: string }> =
      [
        {
          id: 'perim-pause-toggle',
          label: sim.tacticalPaused ? '❚❚ PAUSED' : '[SPACE] PAUSE',
          w: compactHeader ? 108 : 118,
          active: sim.tacticalPaused,
          accent: '#FFB000',
        },
        {
          id: 'perim-manifest',
          label: 'MANIFEST',
          w: compactHeader ? 84 : 92,
          active: params.manifestOpen,
          accent: COLORS.GREEN_BRIGHT,
        },
        {
          id: 'perim-mute',
          label: params.audioMuted ? 'AUDIO: OFF' : 'AUDIO: ON',
          w: compactHeader ? 88 : 96,
          active: !params.audioMuted,
          accent: params.audioMuted ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY,
        },
        {
          id: 'perim-fullscreen',
          label: params.isFullscreen ? 'EXIT FL' : 'FULLSCR',
          w: compactHeader ? 78 : 84,
          active: params.isFullscreen,
          accent: COLORS.AMBER_BRIGHT,
        },
        {
          id: 'perim-osd',
          label: '[TAB] MENU',
          w: compactHeader ? 96 : 104,
          active: params.osdMenuOpen,
          accent: '#FFB000',
        },
        {
          id: 'perim-exit-os',
          label: 'MU-TH-UR OS',
          w: compactHeader ? 106 : 114,
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

    const dialR = 38;
    const row1Cy = 82;
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
    const sealBarY = 154;
    const sealGap = 5;
    const sealW = (baseW - 20 - sealGap * 2) / 3;
    for (let i = 0; i < 3; i++) {
      const sx = 10 + i * (sealW + sealGap);
      const intact = i < sim.bulkheadSeals;
      ctx.fillStyle = intact ? 'rgba(68, 255, 119, 0.14)' : 'rgba(60, 12, 10, 0.45)';
      ctx.fillRect(sx, sealBarY, sealW, 22);
      ctx.strokeStyle = intact ? sealCol : '#5C1C16';
      ctx.lineWidth = 1.8;
      ctx.strokeRect(sx, sealBarY, sealW, 22);

      ctx.font = 'bold 12px "Share Tech Mono", monospace';
      ctx.fillStyle = intact ? sealCol : '#853028';
      ctx.textAlign = 'center';
      ctx.fillText(intact ? `S0${i + 1}: LOCK` : `S0${i + 1}: BLOWN`, sx + sealW * 0.5, sealBarY + 15);
    }

    // 2. BIO-THREAT DENSITY Analog Gauge + KILLS / CONTACTS Summary
    const threatCy = 230;
    const densityNorm = Math.min(1, sim.hostiles.length / 28);
    const threatCol =
      densityNorm > 0.72 ? COLORS.RED_KLAXON : densityNorm > 0.35 ? '#FFB000' : '#44FF77';
    this.drawAnalogWedgeNeedleDial(
      ctx,
      62,
      threatCy,
      34,
      densityNorm,
      'BIO-DENSITY',
      `${sim.hostiles.length} ACTIVE`,
      threatCol
    );

    // Tabular Telemetry Readout next to Bio-Density Dial (crisp >=12.5px numerals!)
    const tabX = 114;
    ctx.textAlign = 'left';
    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    const verifiedCount = sim.hostiles.filter((h) => h.verified).length;
    const sealedDoors = sim.getActiveSealedDoorCount();
    const stats: Array<[string, string, string]> = [
      ['VERIFIED:', `${verifiedCount}`, '#FFB000'],
      ['KILLS:', `${sim.totalKills}`, '#44FF77'],
      [
        'DOOR SEALS:',
        `${sealedDoors}/${PERIMETER_CONSTANTS.MAX_ACTIVE_DOOR_SEALS}`,
        sealedDoors >= PERIMETER_CONSTANTS.MAX_ACTIVE_DOOR_SEALS ? '#FF5522' : '#FFB000',
      ],
      ['ONLINE:', `${sim.turrets.filter((t) => t.powered).length}/${sim.turrets.length}`, '#44FF77'],
    ];
    stats.forEach(([k, v, c], idx) => {
      const sy = threatCy - 24 + idx * 19;
      ctx.fillStyle = '#8EF5AB';
      ctx.fillText(k, tabX, sy);
      ctx.textAlign = 'right';
      ctx.fillStyle = c;
      ctx.fillText(v, baseW - 10, sy);
      ctx.textAlign = 'left';
    });

    // 3. Live Deployed Weapons Status Matrix (Ammo, Reload Timers, Heat, Kills & 1-Click Rearm)
    const scopeTop = 304;
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
    let totalAmmo = 0;
    let totalMaxAmmo = 0;
    let liveRpm = 0;
    let maxHeat = 0;

    for (const t of sim.turrets) {
      if (t.heat > maxHeat) maxHeat = t.heat;
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

    // 1. Header + Flashing Alert Pill
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#44FF77';
    ctx.textAlign = 'left';
    ctx.fillText('WEAPONS TELEMETRY', x + 8, y + 18);

    if (anyDry || anyLowAmmo || anyOverheat) {
      const isCrit = anyDry || anyOverheat;
      const flashOn = isCrit ? blinkFast : blinkCaution;
      const badgeTxt = anyDry ? '⚠ 000 DRY' : anyLowAmmo ? '⚠ LOW AMMO' : '⚠ OVERHEAT';
      const badgeW = 92;
      const badgeX = x + w - badgeW - 6;
      ctx.fillStyle = flashOn ? (isCrit ? '#FF3318' : '#FFB000') : 'rgba(36, 12, 6, 0.9)';
      ctx.fillRect(badgeX, y + 5, badgeW, 17);
      ctx.strokeStyle = isCrit ? '#FF3318' : '#FFB000';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(badgeX, y + 5, badgeW, 17);
      ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
      ctx.fillStyle = flashOn ? '#040805' : isCrit ? '#FF3318' : '#FFB000';
      ctx.textAlign = 'center';
      ctx.fillText(badgeTxt, badgeX + badgeW * 0.5, y + 17.5);
    } else {
      ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
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

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = anyDry ? '#FF3318' : anyLowAmmo ? '#FFB000' : '#8EF5AB';
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
        ctx.strokeStyle = 'rgba(38, 102, 58, 0.42)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x + 6, sy, w - 12, slotH);
        ctx.setLineDash([]);

        ctx.textAlign = 'left';
        ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
        ctx.fillStyle = 'rgba(68, 255, 119, 0.42)';
        ctx.fillText(`HARDPOINT 0${i + 1} // UNASSIGNED`, x + 14, sy + 18);
        ctx.font = '10.5px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(59, 224, 104, 0.30)';
        ctx.fillText('SELECT [1-4] TO DEPLOY WEAPON', x + 14, sy + 34);
      }
      ctx.restore();
      return;
    }

    // Prioritize combat turrets if >8 units deployed so sentries/incinerators never scroll off
    const ordered =
      sim.turrets.length <= 7
        ? sim.turrets
        : [...sim.turrets].sort((a, b) => {
            const prio = (u: typeof a) =>
              u.kind === 'SENTRY_PULSE' ? 0 : u.kind === 'INCINERATOR' ? 1 : 2;
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
      const isCryo = t.kind === 'CRYO_VALVE';
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
          : isCryo
            ? 'CRYO'
            : 'M314';
      const mkTag = t.level === 2 ? ' MK2' : '';
      const rlyTag = t.relayBoosted && (isSentry || isIncinerator) ? '+RLY' : '';

      ctx.textAlign = 'left';
      ctx.font = 'bold 12px "Share Tech Mono", monospace';
      ctx.fillStyle = !t.powered
        ? COLORS.GREEN_MID
        : isDry || isTherm
          ? '#FF5538'
          : isLow || isFiring
            ? '#FFB000'
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
        const missingRatio = (t.maxAmmo - t.ammo) / Math.max(1, t.maxAmmo);
        const rearmCost = Math.max(
          12,
          Math.round(PERIMETER_CONSTANTS.REARM_COST_SCRAP * missingRatio)
        );
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
          stTxt = isIncinerator ? '● FLAME' : '● FIRING';
          stCol = '#FFB000';
        } else if (isSentry || isIncinerator) {
          stTxt = `K:${String(t.kills).padStart(2, '0')}`;
          stCol = '#8EF5AB';
        } else if (isCryo) {
          stTxt = t.pulseTimer < 0.45 ? '● VENT' : 'CHILL';
          stCol = '#8EF5AB';
        } else {
          stTxt = t.tripwireIntegrity < 60 ? '⚠ WIRE' : 'SWEEP';
          stCol = t.tripwireIntegrity < 60 ? '#FFB000' : '#44FF77';
        }
        ctx.fillStyle = stCol;
        ctx.fillText(stTxt, rightEdgeX, cy + 14);
      }

      // Row 2: Segmented Primary Bar (AMMO/RELOAD for Sentry, HEAT for Incinerator, CYCLE/WIRE for Support)
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
      } else if (isCryo) {
        row2Label = 'LN2';
        row2Ratio = t.powered ? Math.max(0, Math.min(1, 1 - t.pulseTimer / 2.75)) : 0;
        row2ValTxt = t.powered ? `${Math.round(row2Ratio * 100)}%` : 'OFF';
        row2Col = '#8EF5AB';
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
        if (isSentry || isIncinerator) {
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
          ctx.font = '10.5px "JetBrains Mono", monospace';
          ctx.fillStyle = COLORS.GREEN_MID;
          ctx.fillText(
            isCryo
              ? 'CRYO PLUME // COOLS NEARBY GUNS'
              : `M314 RADAR // ${HARDWARE_SPECS[t.kind].powerKw}kW ACTIVE`,
            cx + 6,
            row3Y + 9
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
    ctx.font = 'bold 17.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('ORDNANCE REQUISITION', 12, 24);

    const netKw = sim.maxReactorKw - sim.getTotalLoadKw();
    ctx.fillStyle = 'rgba(20, 14, 3, 0.90)';
    ctx.fillRect(12, 32, baseW - 24, 38);
    ctx.strokeStyle = netKw < 0 ? COLORS.RED_KLAXON : '#FFB000';
    ctx.lineWidth = 1.8;
    ctx.strokeRect(12, 32, baseW - 24, 38);

    ctx.font = 'bold 18.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.textAlign = 'left';
    ctx.fillText(`SCRAP: ${sim.scrap}`, 20, 57);

    ctx.fillStyle =
      netKw < 0 ? COLORS.RED_KLAXON : netKw < 14 ? COLORS.AMBER_CAUTION : '#44FF77';
    ctx.textAlign = 'right';
    ctx.fillText(
      netKw < 0 ? `OVER: +${Math.abs(netKw)} kW` : `FREE: ${netKw} kW`,
      baseW - 20,
      57
    );

    // 1. Hardware Build Buttons [1-5] — Large, High-Contrast, Zero-Overlap Layout
    let curY = 78;
    const cardW = baseW - 24;
    const cardH = Math.min(60, 53 + Math.floor(extraH * 0.04));
    const cardGap = Math.min(8, 5 + Math.floor(extraH * 0.01));

    const buildRows: Array<{
      id: Exclude<BuildToolId, 'NONE'>;
      title: string;
    }> = [
      { id: 'SENTRY_PULSE', title: 'UA 571-C SENTRY' },
      { id: 'INCINERATOR', title: 'M240 INCINERATOR' },
      { id: 'CRYO_VALVE', title: 'CRYO-STASIS VALVE' },
      { id: 'MOTION_RELAY', title: 'M314 MOTION RELAY' },
      { id: 'ARC_WELDER', title: 'ARC-WELD DOOR SEAL' },
    ];

    for (const row of buildRows) {
      const bId = row.id;
      const spec = HARDWARE_SPECS[bId];
      const isSelected = activeTool.kind === 'BUILD' && activeTool.buildId === bId;
      const isWelderCapped =
        bId === 'ARC_WELDER' &&
        sim.getActiveSealedDoorCount() >= PERIMETER_CONSTANTS.MAX_ACTIVE_DOOR_SEALS;
      const canAfford =
        sim.scrap >= spec.costScrap &&
        sim.getStaticAllocatedKw() + spec.powerKw <= sim.maxReactorKw;
      const btnId = `build-${bId}`;
      const screenRect: ViewportRect = {
        x: rect.x + 12 * s,
        y: rect.y + curY * s,
        width: cardW * s,
        height: cardH * s,
      };
      this.buttons.push({ id: btnId, rect: screenRect, label: spec.name });
      const hov = hoveredButtonId === btnId;

      ctx.fillStyle = isSelected
        ? 'rgba(255, 176, 0, 0.25)'
        : hov
          ? 'rgba(68, 255, 119, 0.18)'
          : 'rgba(6, 18, 11, 0.94)';
      ctx.fillRect(12, curY, cardW, cardH);
      ctx.strokeStyle = isSelected
        ? '#FFB000'
        : hov
          ? '#FFFFFF'
          : canAfford
            ? COLORS.GREEN_PRIMARY
            : COLORS.GREEN_DIM;
      ctx.lineWidth = isSelected ? 2.6 : 1.8;
      ctx.strokeRect(12, curY, cardW, cardH);

      // Right-Side Cost & Power Pill Badge (measured first so left title NEVER overlaps!)
      const costStr =
        bId === 'ARC_WELDER'
          ? `${spec.costScrap}S · ${sim.getActiveSealedDoorCount()}/${PERIMETER_CONSTANTS.MAX_ACTIVE_DOOR_SEALS}`
          : `${spec.costScrap}S · ${spec.powerKw}kW`;
      ctx.font = 'bold 13px "JetBrains Mono", monospace';
      const pillW = Math.ceil(ctx.measureText(costStr).width) + 14;
      const pillX = 12 + cardW - pillW - 7;
      const pillY = curY + 6;
      const pillH = 21;

      ctx.fillStyle =
        canAfford && !isWelderCapped ? 'rgba(34, 24, 4, 0.90)' : 'rgba(42, 10, 8, 0.90)';
      ctx.fillRect(pillX, pillY, pillW, pillH);
      ctx.strokeStyle =
        canAfford && !isWelderCapped ? 'rgba(255, 176, 0, 0.72)' : 'rgba(255, 51, 24, 0.72)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(pillX, pillY, pillW, pillH);

      ctx.textAlign = 'center';
      ctx.fillStyle = canAfford && !isWelderCapped ? '#FFC43D' : COLORS.RED_KLAXON;
      ctx.fillText(costStr, pillX + pillW * 0.5, pillY + 15);

      // Left Title (auto-fitted strictly left of pillX - 8)
      const fullTitle = `[${spec.shortKey}] ${row.title}`;
      const maxTitleW = pillX - 20 - 8;
      let titleFont = 15.5;
      ctx.font = `bold ${titleFont}px "Share Tech Mono", monospace`;
      while (titleFont > 12 && ctx.measureText(fullTitle).width > maxTitleW) {
        titleFont -= 0.5;
        ctx.font = `bold ${titleFont}px "Share Tech Mono", monospace`;
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = isSelected
        ? '#FFE082'
        : hov
          ? '#FFFFFF'
          : canAfford
            ? '#52FF86'
            : '#5D9E71';
      ctx.fillText(fullTitle, 20, curY + 21);

      // High-Legibility Subtitle Summary (strict >=11.5px font floor!)
      let descFont = 12;
      ctx.font = `bold ${descFont}px "JetBrains Mono", monospace`;
      while (descFont > 11 && ctx.measureText(spec.summary).width > cardW - 16) {
        descFont -= 0.5;
        ctx.font = `bold ${descFont}px "JetBrains Mono", monospace`;
      }
      ctx.fillStyle = canAfford ? '#9EF5B8' : '#588C68';
      ctx.fillText(spec.summary, 20, curY + cardH - 9, cardW - 16);

      curY += cardH + cardGap;
    }

    // 2. Active Player Command Abilities ([F] Flare, [O] Overclock, [V] Airlock Purge)
    curY += 3;
    ctx.textAlign = 'left';
    ctx.font = 'bold 14px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('COMMAND ABILITIES [F / O / V]', 12, curY + 13);
    curY += 19;

    const abGap = 6;
    const abW = (cardW - abGap * 2) / 3;
    const abH = 48;
    const abilities: Array<{
      id: string;
      toolId: 'FLARE' | 'OVERCLOCK' | 'PURGE';
      top: string;
      sub: string;
      ready: boolean;
    }> = [
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
    ];

    abilities.forEach((ab, idx) => {
      const ax = 12 + idx * (abW + abGap);
      const isArmed = activeTool.kind === 'ABILITY' && activeTool.abilityId === ab.toolId;
      this.buttons.push({
        id: ab.id,
        rect: { x: rect.x + ax * s, y: rect.y + curY * s, width: abW * s, height: abH * s },
        label: ab.top,
      });
      const hov = hoveredButtonId === ab.id;

      ctx.fillStyle = isArmed
        ? 'rgba(255, 176, 0, 0.28)'
        : hov && ab.ready
          ? 'rgba(68, 255, 119, 0.20)'
          : 'rgba(6, 16, 10, 0.92)';
      ctx.fillRect(ax, curY, abW, abH);
      ctx.strokeStyle = isArmed ? '#FFB000' : ab.ready ? '#FFB000' : COLORS.GREEN_DIM;
      ctx.lineWidth = isArmed ? 2.6 : 1.8;
      ctx.strokeRect(ax, curY, abW, abH);

      ctx.textAlign = 'center';
      ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
      ctx.fillStyle = ab.ready ? '#FFE082' : COLORS.GREEN_MID;
      ctx.fillText(ab.top, ax + abW * 0.5, curY + 20);

      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.fillStyle = ab.ready ? '#52FF86' : COLORS.RED_KLAXON;
      ctx.fillText(ab.sub, ax + abW * 0.5, curY + 38);
    });
    curY += abH + 8;

    // 3. Wave Launch & [WAVE INTERCEPT // 2X SPEED] Controls
    const waveH = 42;
    const speedW = 98;
    const waveBtnW = cardW - speedW - 7;
    const isPrep = sim.phase === 'TACTICAL_PREP';

    this.buttons.push({
      id: isPrep ? 'wave-launch' : 'perim-pause-toggle',
      rect: { x: rect.x + 12 * s, y: rect.y + curY * s, width: waveBtnW * s, height: waveH * s },
      label: isPrep ? 'ENGAGE WAVE' : 'TACTICAL PAUSE',
    });
    const waveHov =
      hoveredButtonId === (isPrep ? 'wave-launch' : 'perim-pause-toggle');
    ctx.fillStyle = isPrep
      ? waveHov
        ? COLORS.AMBER_BRIGHT
        : COLORS.AMBER_CAUTION
      : sim.tacticalPaused
        ? 'rgba(255, 176, 0, 0.25)'
        : 'rgba(12, 34, 20, 0.94)';
    ctx.fillRect(12, curY, waveBtnW, waveH);
    ctx.strokeStyle = isPrep ? '#FFF3CC' : '#FFB000';
    ctx.lineWidth = 2.2;
    ctx.strokeRect(12, curY, waveBtnW, waveH);

    ctx.textAlign = 'center';
    ctx.font = 'bold 16px "Share Tech Mono", monospace';
    ctx.fillStyle = isPrep ? '#040905' : '#FFB000';
    ctx.fillText(
      isPrep
        ? `► LAUNCH WAVE ${String(sim.waveNumber).padStart(2, '0')} ◄`
        : sim.tacticalPaused
          ? '► RESUME [SPACE]'
          : '❚❚ TACTICAL PAUSE',
      12 + waveBtnW * 0.5,
      curY + 27
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
    ctx.font = 'bold 15px "Share Tech Mono", monospace';
    ctx.fillStyle = sim.fastForward2x ? '#9EF5B8' : COLORS.GREEN_BRIGHT;
    ctx.fillText(sim.fastForward2x ? '2X: ON' : '1X -> 2X', speedX + speedW * 0.5, curY + 27);

    curY += waveH + 9;

    // 4. Unit / Bulkhead Door Inspector Sub-Panel
    const inspH = Math.max(165, baseH - curY - 10);
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
      const inBlackout = sim.blackoutTimer > 0 && spec.powerKw > 0;
      const isReloading = t.kind === 'SENTRY_PULSE' && t.rearmTimer > 0;

      ctx.textAlign = 'left';
      ctx.font = 'bold 16px "Share Tech Mono", monospace';
      ctx.fillStyle = inBlackout ? COLORS.RED_KLAXON : '#FFB000';
      ctx.fillText(
        `INSPECTOR // ${t.callsign} (${spec.code} MK-${t.level === 2 ? 'II' : 'I'})`,
        x + 12,
        y + 23,
        w - 24
      );

      ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
      ctx.fillStyle = inBlackout
        ? COLORS.RED_KLAXON
        : isReloading
          ? '#FFD466'
          : '#52FF86';
      const rdsText = inBlackout
        ? `BLACKOUT (${sim.blackoutTimer.toFixed(1)}S)`
        : isReloading
          ? `BELT FEED: ${t.rearmTimer.toFixed(1)}S`
          : t.kind === 'SENTRY_PULSE'
            ? `ROUNDS: ${String(t.ammo).padStart(3, '0')}/${t.maxAmmo}`
            : t.kind === 'MOTION_RELAY'
              ? `WIRE INT: ${Math.round(t.tripwireIntegrity)}%`
              : `PWR: ${t.powered ? `${spec.powerKw} kW` : 'OFFLINE'}`;
      ctx.fillText(`${rdsText}  |  KILLS: ${t.kills}`, x + 12, y + 44, w - 24);

      // BARREL TEMP % or LIVE RELOAD PROGRESS Stepped Vernier Bar
      const barX = x + 64;
      const barW = w - 126;
      if (isReloading) {
        const reloadFrac = Math.max(
          0,
          Math.min(1, 1 - t.rearmTimer / Math.max(0.1, t.rearmDuration))
        );
        ctx.fillStyle = '#FFD466';
        ctx.fillText('FEED:', x + 12, y + 66);
        ctx.strokeStyle = '#FFB000';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(barX, y + 53, barW, 15);
        ctx.fillStyle = '#FFB000';
        ctx.fillRect(barX + 1, y + 54, Math.max(0, (barW - 2) * reloadFrac), 13);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#FFE082';
        ctx.fillText(`${Math.round(reloadFrac * 100)}%`, x + w - 12, y + 66);
      } else {
        ctx.fillStyle = '#9EF5B8';
        ctx.fillText('TEMP:', x + 12, y + 66);
        ctx.strokeStyle = COLORS.GREEN_DIM;
        ctx.lineWidth = 1.4;
        ctx.strokeRect(barX, y + 53, barW, 15);
        const tempCol = t.thermalLocked || t.heat > 80 ? COLORS.RED_KLAXON : '#FFB000';
        ctx.fillStyle = tempCol;
        ctx.fillRect(barX + 1, y + 54, Math.max(0, ((barW - 2) * t.heat) / 100), 13);

        ctx.textAlign = 'right';
        ctx.fillStyle = tempCol;
        ctx.fillText(`${Math.round(t.heat)}%`, x + w - 12, y + 66);
      }

      // Action Buttons Grid inside Inspector (spacious, readable, zero duplicate buttons!)
      const btnGap = 7;
      const innerW = w - 24;
      const halfW = (innerW - btnGap) * 0.5;
      let by = y + 76;
      const rowCount = t.kind === 'CRYO_VALVE' ? 2 : 3;
      const bh = Math.min(36, Math.max(27, Math.floor((h - 86) / rowCount) - 5));

      const addInspBtn = (
        id: string,
        bx: number,
        rowY: number,
        bw: number,
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
            height: bh * s,
          },
          label: lbl,
        });
        const hov = hoveredButtonId === id || active;
        ctx.fillStyle = hov ? 'rgba(255, 176, 0, 0.24)' : 'rgba(8, 24, 14, 0.94)';
        ctx.fillRect(bx, rowY, bw, bh);
        ctx.strokeStyle = hov ? '#FFFFFF' : accent;
        ctx.lineWidth = hov ? 2.0 : 1.7;
        ctx.strokeRect(bx, rowY, bw, bh);
        ctx.textAlign = 'center';
        ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
        ctx.fillStyle = hov ? '#FFFFFF' : accent;
        ctx.fillText(lbl, bx + bw * 0.5, rowY + bh * 0.65, bw - 8);
      };

      const isRotating =
        activeTool.kind === 'ROTATE_TURRET' && activeTool.turretId === t.id;

      // Row 1: Sentry gets [REARM] + [ROTATE]; Directional non-sentry gets full-width [ROTATE ARC]
      if (t.kind === 'SENTRY_PULSE') {
        const missing = (t.maxAmmo - t.ammo) / t.maxAmmo;
        const rCost =
          t.ammo >= t.maxAmmo
            ? 0
            : Math.max(12, Math.round(PERIMETER_CONSTANTS.REARM_COST_SCRAP * missing));
        addInspBtn(
          'insp-rearm',
          x + 12,
          by,
          halfW,
          isReloading
            ? `LOAD ${t.rearmTimer.toFixed(1)}S`
            : rCost > 0
              ? `[E] REARM (${rCost}S)`
              : 'DRUM FULL',
          isReloading
            ? '#FFE082'
            : t.ammo === 0
              ? COLORS.RED_KLAXON
              : '#FFB000',
          isReloading
        );
        addInspBtn(
          'insp-rotate',
          x + 12 + halfW + btnGap,
          by,
          halfW,
          isRotating ? 'AIMING CONE...' : '[R] ROTATE ARC',
          '#52FF86',
          isRotating
        );
        by += bh + 6;
      } else if (t.kind !== 'CRYO_VALVE') {
        addInspBtn(
          'insp-rotate',
          x + 12,
          by,
          innerW,
          isRotating ? 'CLICK CORRIDOR TO SET AIM...' : '[R] ROTATE FIRING / SENSOR ARC',
          '#52FF86',
          isRotating
        );
        by += bh + 6;
      }

      // Row 2: [POWER TOGGLE] & [UPGRADE]
      addInspBtn(
        'insp-power',
        x + 12,
        by,
        halfW,
        t.powered ? `[P] OFFLINE (-${spec.powerKw}kW)` : `[P] ONLINE (+${spec.powerKw}kW)`,
        t.powered ? '#52FF86' : '#FFB000'
      );
      addInspBtn(
        'insp-upgrade',
        x + 12 + halfW + btnGap,
        by,
        halfW,
        t.level < 2 ? `[U] MK-II (${spec.upgradeCostScrap}S)` : 'MK-II MAXED',
        t.level < 2 ? '#FFB000' : COLORS.GREEN_MID
      );
      by += bh + 6;

      // Row 3: [SCRAP / RECYCLE]
      const refund = Math.round(
        (spec.costScrap + (t.level === 2 ? spec.upgradeCostScrap : 0)) * 0.65
      );
      addInspBtn(
        'insp-scrap',
        x + 12,
        by,
        innerW,
        `[DEL] SCRAP / RECYCLE (+${refund} SCRAP)`,
        COLORS.RED_KLAXON
      );
      return;
    }

    // Selected Blast Door Inspector
    if (selectedDoorId) {
      const ds = sim.doors.get(selectedDoorId);
      if (ds) {
        const weldCost = HARDWARE_SPECS.ARC_WELDER.costScrap;
        const activeSeals = sim.getActiveSealedDoorCount();
        const maxSeals = PERIMETER_CONSTANTS.MAX_ACTIVE_DOOR_SEALS;
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

    // Default Tactical Operator Reference inside Inspector
    ctx.textAlign = 'left';
    ctx.font = 'bold 15px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('UNIT INSPECTOR // TACTICAL GUIDE', x + 12, y + 22, w - 24);

    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    const tips = [
      '• CLICK TURRET/DOOR TO INSPECT | [R]/SHIFT+DRAG AIM',
      '• DARK: 55% RNG + 20% MISS | LIT: 100% +20% CRIT',
      '• MID-WAVE: REARM 2.8S & WELD 2.0S (MAX 3 SEALS)',
      '• OVERLOAD > MAX kW TRIPS 3.5S BLACKOUT ([P] SHED)',
      '• COMBOS: CRYO+PULSE SHATTER | FLANK | NAPALM ACID',
      '• [SPACE] TACTICAL PAUSE | [R-CLICK / ESC] CANCEL',
    ];
    tips.forEach((line, i) => {
      ctx.fillStyle = i === 1 || i === 3 ? '#FFC43D' : '#9EF5B8';
      ctx.fillText(line, x + 12, y + 44 + i * 20, w - 24);
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
    const { width: w, height: h, sim, hoveredButtonId } = params;
    const boxW = Math.min(720, w - 48);
    const boxH = Math.min(480, h - 46);
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
      sim.mode === 'ENDLESS_SIEGE'
        ? '★ RANKED ENDLESS SIEGE ARMED — HIGH SCORE RECORDED TO PERIMETER_SCORES ★'
        : '★ RANKED SECTOR 01 CAMPAIGN ARMED — HIGH SCORE RECORDED TO PERIMETER_SCORES ★',
      params.timeSec,
      true
    );

    ctx.textAlign = 'center';
    ctx.font = 'bold 26px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.RED_KLAXON;
    ctx.fillText("HADLEY'S PERIMETER // UA 571-C TACTICAL NET", w * 0.5, by + 62);

    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(
      'SEC-01: HADLEY MED-LAB & SUB-LEVEL DUCTS // REMOTE COLONY DEFENSE CONSOLE',
      w * 0.5,
      by + 82
    );

    // Live Global #01 Perimeter Leader Ticker (from Firestore perimeter_scores)
    const leader = params.manifest.getReigningLeader();
    const uplink = params.manifest.getStatus();
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    const leadBanner = leader
      ? `#01 GLOBAL LEADER: ${leader.callsign} — ${leader.score.toLocaleString()} PTS (W-${String(leader.waves).padStart(2, '0')} | ${leader.kills} KILLS)`
      : uplink === 'LOADING'
        ? 'SYNCING MU-TH-UR PERIMETER_SCORES UPLINK...'
        : '#01 GLOBAL LEADER: UNCLAIMED — BE THE FIRST TO HOLD SECTOR 01';
    ctx.fillText(leadBanner, w * 0.5, by + 102, boxW - 56);

    // Mode Toggle: Both Official Ranked Modes clearly marked ★ RANKED!
    const tabGap = 12;
    const tabW = (boxW - 56 - tabGap) * 0.5;
    this.addScaledButton(
      ctx,
      'mode-sec01',
      { x: bx + 28, y: by + 114, width: tabW, height: 38 },
      '★ RANKED: SECTOR 01 (10 WAVES)',
      sim.mode === 'SECTOR_01',
      hoveredButtonId,
      '#FFB000',
      14.5
    );
    this.addScaledButton(
      ctx,
      'mode-endless',
      { x: bx + 28 + tabW + tabGap, y: by + 114, width: tabW, height: 38 },
      '★ RANKED: ENDLESS HIVE SIEGE',
      sim.mode === 'ENDLESS_SIEGE',
      hoveredButtonId,
      '#FFB000',
      14.5
    );

    const rules = [
      '1. DARKNESS VS ILLUMINATION: UNLIT CORRIDORS CUT TURRET RANGE TO 55% (+20% MISS).',
      '   ILLUMINATE TARGETS WITH [F] STROBE FLARES OR M314 RELAYS FOR 100% RNG + 20% CRIT!',
      '2. TACTICAL LOGISTICS: MID-WAVE REARM (2.8S) & ARC-WELD (2.0S, MAX 3 SEALS) TAKE',
      '   REAL TIME — SETUP DURING PREP IS INSTANT. LISTEN FOR 5S FLOOR-GRATE BREACHES!',
      '3. REACTOR OVERLOAD: [O] OVERCLOCK (+22kW SURGE) CAN EXCEED MAX kW —',
      '   OVERLOAD >4S TRIPS A 3.5S BLACKOUT! SHED POWER WITH [P] OR COMBO CRYO + PULSE.',
    ];

    ctx.textAlign = 'left';
    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    rules.forEach((line, idx) => {
      ctx.fillStyle = idx === 1 || idx === 2 ? '#FFB000' : COLORS.GREEN_PRIMARY;
      ctx.fillText(line, bx + 28, by + 178 + idx * 26, boxW - 56);
    });

    this.addScaledButton(
      ctx,
      'briefing-engage',
      { x: w * 0.5 - 220, y: by + boxH - 62, width: 440, height: 44 },
      '► LAUNCH RANKED DEPLOYMENT [ENTER] ◄',
      true,
      hoveredButtonId,
      '#FFB000',
      17
    );
    ctx.restore();
  }

  private drawEndOfRunOverlay(
    ctx: CanvasRenderingContext2D,
    params: PerimeterHudRenderParams
  ): void {
    const { width: w, height: h, sim, hoveredButtonId } = params;
    const victory = sim.phase === 'SECTOR_VICTORY';
    const boxW = Math.min(640, w - 48);
    const boxH = 280;
    const bx = (w - boxW) * 0.5;
    const by = (h - boxH) * 0.5;

    ctx.save();
    ctx.fillStyle = 'rgba(5, 13, 8, 0.96)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(
      ctx,
      bx,
      by,
      boxW,
      boxH,
      18,
      victory ? '#44FF77' : COLORS.RED_KLAXON,
      2.6
    );

    ctx.textAlign = 'center';
    ctx.font = 'bold 24px "Share Tech Mono", monospace';
    ctx.fillStyle = victory ? '#44FF77' : COLORS.RED_KLAXON;
    ctx.fillText(
      victory
        ? 'SECTOR 01 SECURED // MED-LAB PERIMETER INTACT'
        : 'CRITICAL BREACH // REACTOR CORE OVERRUN',
      w * 0.5,
      by + 44
    );

    ctx.font = 'bold 16px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(
      `WAVES: ${sim.waveNumber}  |  HOSTILES NEUTRALIZED: ${sim.totalKills}  |  SCORE: ${sim.score.toLocaleString()}`,
      w * 0.5,
      by + 92
    );

    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_PRIMARY;
    ctx.fillText(
      victory
        ? `REMAINING CORE SEALS: ${sim.bulkheadSeals}/3 // READY FOR CREW MANIFEST LOGGING`
        : 'ALL 3 BULKHEAD SEALS DESTROYED // TRANSMITTING FINAL TELEMETRY LOG',
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
    const modeLabel = sim.mode === 'ENDLESS_SIEGE' ? 'ENDLESS' : 'CAMPAIGN';
    ctx.fillText(
      `SCORE: ${sim.score.toLocaleString()}  |  WAVES: ${sim.waveNumber}  |  KILLS: ${sim.totalKills}  |  ${modeLabel}`,
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
    ctx.fillText('MODE', bx + 336, headY);
    ctx.fillText('WAVES', bx + 462, headY);
    ctx.fillText('KILLS', bx + 544, headY);
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
        const badgeX = Math.min(bx + 228, bx + 92 + callW);
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

      ctx.fillStyle = isJustAdded
        ? '#FFFFFF'
        : e.mode === 'ENDLESS_SIEGE'
          ? '#FFB000'
          : COLORS.GREEN_PRIMARY;
      ctx.fillText(e.mode === 'ENDLESS_SIEGE' ? 'ENDLESS' : 'CAMPAIGN', bx + 336, ry);
      ctx.fillStyle = isJustAdded ? '#7BFF9E' : '#8EF5AB';
      ctx.fillText(String(e.waves), bx + 462, ry);
      ctx.fillText(String(e.kills), bx + 544, ry);
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
    const boxW = Math.min(700, w - 48);
    const boxH = Math.min(368, h - 40);
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

    // Top 3-Button Mission Command Strip
    const cmdY = by + 54;
    const cmdGap = 10;
    const cmdW = (boxW - 44 - cmdGap * 2) / 3;
    this.addScaledButton(
      ctx,
      'perim-close-modal',
      { x: bx + 22, y: cmdY, width: cmdW, height: 36 },
      '[TAB] RESUME CONSOLE',
      true,
      hoveredButtonId,
      COLORS.GREEN_BRIGHT,
      14.5
    );
    this.addScaledButton(
      ctx,
      'perim-restart-sec01',
      { x: bx + 22 + cmdW + cmdGap, y: cmdY, width: cmdW, height: 36 },
      'RESTART SECTOR 01',
      sim.mode === 'SECTOR_01',
      hoveredButtonId,
      COLORS.AMBER_CAUTION,
      14.5
    );
    this.addScaledButton(
      ctx,
      'perim-restart-endless',
      { x: bx + 22 + (cmdW + cmdGap) * 2, y: cmdY, width: cmdW, height: 36 },
      'ENDLESS HIVE SIEGE',
      sim.mode === 'ENDLESS_SIEGE',
      hoveredButtonId,
      '#FFB000',
      14.5
    );

    // Standardized Hardware & System Toggle Rows
    const rowStartY = cmdY + 50;
    const rowStep = 50;
    const switches = [
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
      ctx.fillRect(bx + 22, sy, boxW - 44, 42);
      ctx.strokeStyle = COLORS.GREEN_DIM;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(bx + 22, sy, boxW - 44, 42);

      ctx.textAlign = 'left';
      ctx.font = 'bold 16px "Share Tech Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_PRIMARY;
      ctx.fillText(sw.name, bx + 34, sy + 27);

      this.addScaledButton(
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
    this.addScaledButton(
      ctx,
      'perim-close-modal',
      { x: bx + 22, y: by + boxH - 48, width: footBtnW, height: 38 },
      '[TAB / ESC] CLOSE MENU',
      true,
      hoveredButtonId,
      COLORS.GREEN_BRIGHT,
      15.5
    );
    this.addScaledButton(
      ctx,
      'perim-exit-os',
      { x: bx + 22 + footBtnW + footGap, y: by + boxH - 48, width: footBtnW, height: 38 },
      '[EXIT TO MU-TH-UR OS]',
      false,
      hoveredButtonId,
      '#FFB000',
      15.5
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
