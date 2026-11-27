import {
  drawEllipsizedText,
  font,
  SEMIOTIC_ICONS,
  THEME,
} from '../render/chrome';
import type { Vec2, ViewportRect } from '../types';
import type { PerimeterSimulation } from './PerimeterSimulation';
import type {
  TutorialMapBeacon,
  TutorialPlacementRule,
} from './PerimeterTutorialDirector';
import {
  HARDWARE_SPECS,
  HOSTILE_SPECS,
  MK3_BRANCH_SPECS,
  PERIMETER_CONSTANTS,
  WAVE_MUTATORS,
  type ActiveCursorTool,
  type BuildToolId,
  type HostileEntity,
} from './types';

export interface BlueprintCamera {
  centerX: number; // In 1920x1080 virtual coordinates
  centerY: number;
  zoom: number; // 1.0 .. 2.5
}

export interface BlueprintRenderContext {
  sim: PerimeterSimulation;
  viewport: ViewportRect; // Screen-space rectangle inside CRT canvas
  camera: BlueprintCamera;
  timeSec: number;
  activeTool: ActiveCursorTool;
  cursorVirtual: Vec2 | null;
  selectedTurretId: string | null;
  hoveredTurretId?: string | null;
  selectedDoorId: string | null;
  dragBuildAnchor: { col: number; row: number; angle: number } | null;
  tutorialBeacons?: TutorialMapBeacon[];
  tutorialPlacementRule?: TutorialPlacementRule | null;
  tutorialAngleCheck?: (
    buildId: Exclude<BuildToolId, 'NONE'>,
    col: number,
    row: number,
    angle: number
  ) => { enforced: boolean; valid: boolean; hint?: string };
}

export class PerimeterBlueprintRenderer {
  /**
   * Computes a zoom-compensated world-space font size so critical map labels
   * stay >= 12px effective on screen regardless of blueprint fit scale.
   */
  private worldFontPx(minScreenPx: number, tfScale: number, maxWorldPx = 36): number {
    const safeScale = Math.max(0.32, tfScale);
    return Math.min(maxWorldPx, Math.max(minScreenPx, Math.ceil(minScreenPx / safeScale)));
  }
  /**
   * Computes transform scale & top-left screen origin mapping blueprint virtual space
   * (32x18 = 1920x1080 or 36x20 = 2160x1200) cleanly into `viewport`.
   */
  public computeTransform(
    viewport: ViewportRect,
    camera: BlueprintCamera,
    worldWidth: number = PERIMETER_CONSTANTS.VIRTUAL_W,
    worldHeight: number = PERIMETER_CONSTANTS.VIRTUAL_H
  ): { scale: number; originX: number; originY: number } {
    const fitScale = Math.min(viewport.width / worldWidth, viewport.height / worldHeight);
    const scale = fitScale * camera.zoom;
    const screenCx = viewport.x + viewport.width * 0.5;
    const screenCy = viewport.y + viewport.height * 0.5;
    const originX = screenCx - camera.centerX * scale;
    const originY = screenCy - camera.centerY * scale;
    return { scale, originX, originY };
  }

  public screenToVirtual(
    viewport: ViewportRect,
    camera: BlueprintCamera,
    screenX: number,
    screenY: number,
    worldWidth: number = PERIMETER_CONSTANTS.VIRTUAL_W,
    worldHeight: number = PERIMETER_CONSTANTS.VIRTUAL_H
  ): Vec2 {
    const tf = this.computeTransform(viewport, camera, worldWidth, worldHeight);
    return {
      x: (screenX - tf.originX) / tf.scale,
      y: (screenY - tf.originY) / tf.scale,
    };
  }

  public virtualToScreen(
    viewport: ViewportRect,
    camera: BlueprintCamera,
    virt: Vec2,
    worldWidth: number = PERIMETER_CONSTANTS.VIRTUAL_W,
    worldHeight: number = PERIMETER_CONSTANTS.VIRTUAL_H
  ): Vec2 {
    const tf = this.computeTransform(viewport, camera, worldWidth, worldHeight);
    return {
      x: tf.originX + virt.x * tf.scale,
      y: tf.originY + virt.y * tf.scale,
    };
  }

  public render(ctx: CanvasRenderingContext2D, rc: BlueprintRenderContext): void {
    const { viewport, camera, sim, timeSec } = rc;
    const worldW = sim.blueprint.cols * sim.blueprint.tileSize;
    const worldH = sim.blueprint.rows * sim.blueprint.tileSize;
    const tf = this.computeTransform(viewport, camera, worldW, worldH);

    ctx.save();
    // Clip strictly to the central CAD schematic viewport frame
    ctx.beginPath();
    ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height);
    ctx.clip();

    // Deep pitch-black CAD backdrop
    ctx.fillStyle = '#020604';
    ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);

    ctx.save();
    ctx.translate(tf.originX, tf.originY);
    ctx.scale(tf.scale, tf.scale);

    // 1. Structural CAD Blueprint Grid, Bulkheads, Shafts, Grates & Rooms
    this.drawBlueprintArchitecture(ctx, rc, tf.scale);

    // 2. Subtle Tactical Flow-Route Preview Lines (during Prep, Pause, Training, or Arc-Welder tool)
    if (
      sim.phase === 'TACTICAL_PREP' ||
      sim.tacticalPaused ||
      sim.trainingMode ||
      (rc.activeTool.kind === 'BUILD' && rc.activeTool.buildId === 'ARC_WELDER')
    ) {
      this.drawFlowRouteVectors(ctx, sim, timeSec);
    }

    // 3. Illumination & Firing Cones (Calm-Mode in WAVE_ACTIVE) + Laser Tripwires + Strobe Flares + Overclock Rings
    this.drawSensorAndIlluminationZones(ctx, rc, tf.scale);

    // 4. Lingering Environmental Hazards (Acid Pools, Cryo Plumes, Napalm Clouds, Airlock Purge)
    this.drawEnvironmentalZones(ctx, sim, timeSec, tf.scale);

    // 4B. 5-Second Rattling Floor-Grate Breach Telegraphs (`GRATE-01..04`)!
    this.drawGrateTelegraphs(ctx, sim, timeSec, tf.scale);

    // 5. Weldable Corridor Blast Doors (D-01 .. D-06) + 1.5s Arc-Weld Torch Sequences
    this.drawBlastDoors(ctx, rc, tf.scale);

    // 6. Central Reactor Core / Med-Lab Objective & 3 Bulkhead Seals
    this.drawReactorCoreObjective(ctx, sim, timeSec, tf.scale);

    // 7. Placed Defensive Hardware Units (+ 2.8s Reload Progress Arcs)
    this.drawPlacedTurrets(ctx, rc, tf.scale);

    // 8. Expanding Motion-Sensor Sweep Rings
    this.drawMotionSweepWaves(ctx, sim);

    // 9. Hostiles: Fuzzy Range-Gated Radar Blips vs. Sharp Illuminated Vector Bio-Silhouettes!
    this.drawHostilesAndBlips(ctx, sim, timeSec, tf.scale);

    // 10. Caseless Vector Tracer Bursts, Ricochet Sparks & Floating Callouts
    this.drawProjectilesAndCallouts(ctx, sim, tf.scale);

    // 11. Screen-Legible Diegetic Turret Telemetry Tags (Compact `A1 320` in Wave Calm-Mode, Expanded on Hover/Alert!)
    this.drawDiegeticTurretTags(ctx, rc, tf.scale);

    // 11B. Interactive Training Drill Directional Guide Cone & Pulsing Map Beacons
    if (rc.tutorialPlacementRule && rc.tutorialPlacementRule.targetAngle !== undefined) {
      this.drawTutorialGuideCone(ctx, sim, rc.tutorialPlacementRule, timeSec);
    }
    if (rc.tutorialBeacons && rc.tutorialBeacons.length > 0) {
      this.drawTutorialBeacons(ctx, rc.tutorialBeacons, timeSec, tf.scale, worldW);
    }

    // 12. Interactive Build / Cone-Aiming / Command-Ability Cursor Preview
    this.drawInteractiveCursorPreview(ctx, rc, tf.scale);

    ctx.restore();

    // Subtle Reactor Blackout Darkness Flicker Tint or Emergency Floodlight Sheen over CAD Viewport
    if (sim.blackoutTimer > 0) {
      const flick = 0.34 + 0.1 * Math.sin(timeSec * 36);
      ctx.fillStyle = `rgba(2, 4, 3, ${flick.toFixed(2)})`;
      ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
    } else if (sim.floodlightTimer > 0) {
      const flAlpha = 0.065 + 0.025 * Math.sin(timeSec * 12);
      ctx.fillStyle = `rgba(205, 255, 240, ${flAlpha.toFixed(3)})`;
      ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
    }

    // Outer CAD Schematic Viewport Border
    ctx.strokeStyle =
      sim.blackoutTimer > 0
        ? THEME.ALERT_RED_STROKE
        : sim.overloadTimer > 0.25
          ? THEME.ACCENT_AMBER
          : sim.floodlightTimer > 0
            ? '#B6FFF2'
            : THEME.BORDER_SUBTLE;
    ctx.lineWidth =
      sim.blackoutTimer > 0 || sim.overloadTimer > 0.25 || sim.floodlightTimer > 0 ? 2.6 : 2.0;
    ctx.strokeRect(viewport.x + 1, viewport.y + 1, viewport.width - 2, viewport.height - 2);

    // Priority-Exclusive Single-Line Top CAD Banner (ZERO overlap at any screen width!)
    const bannerH = 26;
    if (sim.blackoutTimer > 0) {
      const blink = Math.sin(timeSec * 18) > -0.25;
      ctx.fillStyle = blink ? 'rgba(130, 18, 12, 0.92)' : 'rgba(42, 8, 6, 0.92)';
      ctx.fillRect(viewport.x + 2, viewport.y + 2, viewport.width - 4, bannerH);
      ctx.font = font('head', 14);
      ctx.fillStyle = '#FFF0CC';
      ctx.textAlign = 'center';
      drawEllipsizedText(
        ctx,
        `⚡ REACTOR BREAKER TRIPPED — SECTOR BLACKOUT (${sim.blackoutTimer.toFixed(1)}S) ⚡`,
        viewport.x + viewport.width * 0.5,
        viewport.y + 19,
        viewport.width - 20
      );
    } else if (sim.overloadTimer > 0.15) {
      const frac = Math.min(1, sim.overloadTimer / PERIMETER_CONSTANTS.REACTOR_OVERLOAD_TRIP_SEC);
      const rem = Math.max(0, PERIMETER_CONSTANTS.REACTOR_OVERLOAD_TRIP_SEC - sim.overloadTimer);
      ctx.fillStyle = 'rgba(46, 24, 4, 0.92)';
      ctx.fillRect(viewport.x + 2, viewport.y + 2, viewport.width - 4, bannerH);
      ctx.fillStyle = frac > 0.6 ? 'rgba(255, 51, 24, 0.42)' : 'rgba(255, 176, 0, 0.32)';
      ctx.fillRect(viewport.x + 2, viewport.y + 2, (viewport.width - 4) * frac, bannerH);
      ctx.font = font('head', 14);
      ctx.fillStyle = frac > 0.6 ? '#FFF0CC' : THEME.ACCENT_AMBER;
      ctx.textAlign = 'center';
      drawEllipsizedText(
        ctx,
        `⚠ REACTOR OVERLOAD // BREAKER TRIP IN ${rem.toFixed(1)}S — SHED AUX [X] OR UNIT [K] ⚠`,
        viewport.x + viewport.width * 0.5,
        viewport.y + 19,
        viewport.width - 20
      );
    } else if (sim.tacticalPaused) {
      const pulse = 0.78 + 0.22 * Math.sin(timeSec * 8);
      ctx.save();
      ctx.fillStyle = 'rgba(34, 22, 4, 0.90)';
      ctx.fillRect(viewport.x + 2, viewport.y + 2, viewport.width - 4, bannerH);
      ctx.globalAlpha = pulse;
      ctx.font = font('head', 14);
      ctx.fillStyle = THEME.ACCENT_AMBER;
      ctx.textAlign = 'center';
      drawEllipsizedText(
        ctx,
        '❚❚ TACTICAL PAUSE — BUILD / WELD / AIM / REARM ENABLED [SPACE TO RESUME]',
        viewport.x + viewport.width * 0.5,
        viewport.y + 19,
        viewport.width - 20
      );
      ctx.restore();
    } else {
      ctx.font = font('micro', 12);
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      ctx.textAlign = 'left';
      const leftCadText = `${sim.blueprint.sectorId} CAD (${sim.blueprint.cols}×${sim.blueprint.rows}) // ZOOM ${camera.zoom.toFixed(2)}X [SCROLL / WASD]`;
      drawEllipsizedText(
        ctx,
        leftCadText,
        viewport.x + 10,
        viewport.y + 18,
        viewport.width >= 600 ? viewport.width * 0.48 : viewport.width - 20
      );
      if (viewport.width >= 600) {
        ctx.textAlign = 'right';
        const rightMaxW = viewport.width * 0.48;
        if (sim.floodlightTimer > 0) {
          ctx.fillStyle = '#B6FFF2';
          drawEllipsizedText(
            ctx,
            `☀ SECTOR FLOODLIGHT (${sim.floodlightTimer.toFixed(1)}S) — 100% RNG +25% CRIT`,
            viewport.x + viewport.width - 10,
            viewport.y + 18,
            rightMaxW
          );
        } else if (sim.phase === 'TACTICAL_PREP' && sim.pendingBreachIds.length > 0) {
          const blink = Math.sin(timeSec * 10) > -0.2;
          ctx.fillStyle = blink ? THEME.ACCENT_AMBER : THEME.ALERT_RED_TEXT;
          drawEllipsizedText(
            ctx,
            `⚠ HULL FRACTURE — BREACH OPENS ON WAVE ${String(sim.waveNumber).padStart(2, '0')} LAUNCH!`,
            viewport.x + viewport.width - 10,
            viewport.y + 18,
            rightMaxW
          );
        } else if (sim.activeMutator !== 'NONE') {
          const mut = WAVE_MUTATORS[sim.activeMutator];
          ctx.fillStyle = mut.color;
          drawEllipsizedText(
            ctx,
            `⚡ MUTATOR [${mut.label}]: ${mut.desc}`,
            viewport.x + viewport.width - 10,
            viewport.y + 18,
            rightMaxW
          );
        } else {
          ctx.fillStyle = THEME.ACCENT_AMBER;
          drawEllipsizedText(
            ctx,
            'DARK: 55% RNG · LIT (FLARE/M314/FLOOD): 100% +20% CRIT',
            viewport.x + viewport.width - 10,
            viewport.y + 18,
            rightMaxW
          );
        }
      }
    }

    // Wave-1 Frame-1 Diegetic CAD Onboarding Prompt (vanishes as soon as 1st turret is placed!)
    if (
      sim.phase === 'TACTICAL_PREP' &&
      sim.waveNumber === 1 &&
      sim.turrets.length === 0 &&
      !sim.trainingMode
    ) {
      const pulse = 0.72 + 0.28 * Math.sin(timeSec * 5.0);
      const promptH = 30;
      const promptW = Math.min(viewport.width - 24, 660);
      const px = Math.round(viewport.x + (viewport.width - promptW) * 0.5);
      const py = viewport.y + viewport.height - promptH - 10;
      ctx.save();
      ctx.fillStyle = 'rgba(8, 26, 14, 0.94)';
      ctx.fillRect(px, py, promptW, promptH);
      ctx.strokeStyle = pulse > 0.85 ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;
      ctx.lineWidth = 1.8;
      ctx.strokeRect(px + 0.5, py + 0.5, promptW - 1, promptH - 1);
      ctx.font = font('data', 12);
      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      drawEllipsizedText(
        ctx,
        'STEP 1: SELECT [1] SENTRY -> CLICK [+] PAD & DRAG TO AIM -> [ENTER] LAUNCH',
        px + promptW * 0.5,
        py + promptH * 0.5 + 0.5,
        promptW - 18
      );
      ctx.restore();
    }

    // Active Boss Health Bar (QUEEN or CRUSHER) cleanly below top CAD banner
    const activeBoss =
      sim.hostiles.find((h) => h.kind === 'QUEEN') ??
      sim.hostiles.find((h) => h.kind === 'CRUSHER');
    if (activeBoss) {
      const bSpec = HOSTILE_SPECS[activeBoss.kind];
      const barW = Math.min(460, viewport.width - 36);
      const barH = 22;
      const bx = viewport.x + (viewport.width - barW) * 0.5;
      const by = viewport.y + bannerH + 6;
      const hpFrac = Math.max(0, Math.min(1, activeBoss.hp / Math.max(1, activeBoss.maxHp)));
      const isQueen = activeBoss.kind === 'QUEEN';
      ctx.fillStyle = 'rgba(24, 5, 5, 0.92)';
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = isQueen ? 'rgba(255, 42, 68, 0.62)' : 'rgba(255, 136, 36, 0.62)';
      ctx.fillRect(bx + 2, by + 2, (barW - 4) * hpFrac, barH - 4);
      ctx.strokeStyle = isQueen ? '#FF3355' : '#FF9933';
      ctx.lineWidth = 1.8;
      ctx.strokeRect(bx, by, barW, barH);
      ctx.font = font('head', 13);
      ctx.fillStyle = '#FFF4DC';
      ctx.textAlign = 'center';
      drawEllipsizedText(
        ctx,
        `★ ${bSpec.name} — ${Math.ceil(activeBoss.hp)} / ${activeBoss.maxHp} HP ★`,
        bx + barW * 0.5,
        by + 15.5,
        barW - 14
      );
    }

    ctx.restore();
  }

  private drawBlueprintArchitecture(
    ctx: CanvasRenderingContext2D,
    rc: BlueprintRenderContext,
    tfScale: number
  ): void {
    const { sim, activeTool, timeSec } = rc;
    const bp = sim.blueprint;
    const ts = bp.tileSize;

    const highlightMountPads =
      activeTool.kind === 'BUILD' &&
      (activeTool.buildId === 'SENTRY_PULSE' ||
        activeTool.buildId === 'INCINERATOR' ||
        activeTool.buildId === 'RAIL_LANCE' ||
        activeTool.buildId === 'MOTION_RELAY');
    const highlightGrates =
      activeTool.kind === 'BUILD' &&
      (activeTool.buildId === 'CRYO_VALVE' || activeTool.buildId === 'SHOCK_COIL');
    const isShockBuild = activeTool.kind === 'BUILD' && activeTool.buildId === 'SHOCK_COIL';
    const highlightClaymore = activeTool.kind === 'BUILD' && activeTool.buildId === 'CLAYMORE';
    const highlightPurge =
      activeTool.kind === 'ABILITY' && activeTool.abilityId === 'PURGE';
    const buildPulse = 0.55 + 0.45 * Math.sin(timeSec * 7.5);

    // Base CAD Grid Lines across corridors
    ctx.strokeStyle = 'rgba(13, 59, 30, 0.32)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    for (let c = 0; c <= bp.cols; c++) {
      ctx.moveTo(c * ts, 0);
      ctx.lineTo(c * ts, bp.rows * ts);
    }
    for (let r = 0; r <= bp.rows; r++) {
      ctx.moveTo(0, r * ts);
      ctx.lineTo(bp.cols * ts, r * ts);
    }
    ctx.stroke();

    // Tile-by-Tile Structural Bulkheads, Air Shafts, Airlocks, Grates & Mounts
    for (let r = 0; r < bp.rows; r++) {
      for (let c = 0; c < bp.cols; c++) {
        const kind = bp.tiles[r][c];
        const x = c * ts;
        const y = r * ts;

        if (kind === 'BULKHEAD') {
          ctx.fillStyle = '#071B0E';
          ctx.fillRect(x, y, ts, ts);

          // Diagonal CAD structural cross-hatch
          ctx.strokeStyle = '#0D3B1E';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x, y + ts * 0.5);
          ctx.lineTo(x + ts * 0.5, y);
          ctx.moveTo(x + ts * 0.5, y + ts);
          ctx.lineTo(x + ts, y + ts * 0.5);
          ctx.stroke();

          // Thick bright CAD wall edges bordering walkable corridors
          ctx.strokeStyle = '#1B6E39';
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          if (r > 0 && bp.tiles[r - 1][c] !== 'BULKHEAD' && bp.tiles[r - 1][c] !== 'AIR_SHAFT') {
            ctx.moveTo(x, y + 1.5);
            ctx.lineTo(x + ts, y + 1.5);
          }
          if (
            r < bp.rows - 1 &&
            bp.tiles[r + 1][c] !== 'BULKHEAD' &&
            bp.tiles[r + 1][c] !== 'AIR_SHAFT'
          ) {
            ctx.moveTo(x, y + ts - 1.5);
            ctx.lineTo(x + ts, y + ts - 1.5);
          }
          if (c > 0 && bp.tiles[r][c - 1] !== 'BULKHEAD' && bp.tiles[r][c - 1] !== 'AIR_SHAFT') {
            ctx.moveTo(x + 1.5, y);
            ctx.lineTo(x + 1.5, y + ts);
          }
          if (
            c < bp.cols - 1 &&
            bp.tiles[r][c + 1] !== 'BULKHEAD' &&
            bp.tiles[r][c + 1] !== 'AIR_SHAFT'
          ) {
            ctx.moveTo(x + ts - 1.5, y);
            ctx.lineTo(x + ts - 1.5, y + ts);
          }
          ctx.stroke();
        } else if (kind === 'AIR_SHAFT') {
          ctx.fillStyle = '#041109';
          ctx.fillRect(x, y, ts, ts);
          ctx.strokeStyle = '#124B27';
          ctx.lineWidth = 1.4;
          ctx.strokeRect(x + 4, y + 4, ts - 8, ts - 8);
          ctx.beginPath();
          ctx.moveTo(x + 4, y + 4);
          ctx.lineTo(x + ts - 4, y + ts - 4);
          ctx.moveTo(x + ts - 4, y + 4);
          ctx.lineTo(x + 4, y + ts - 4);
          ctx.stroke();
        } else if (kind === 'DUCT_GRATE') {
          const occupied = sim.turrets.some((t) => t.col === c && t.row === r);
          ctx.fillStyle =
            highlightGrates && !occupied
              ? isShockBuild
                ? `rgba(0, 240, 255, ${(0.14 + buildPulse * 0.2).toFixed(2)})`
                : `rgba(68, 255, 119, ${(0.14 + buildPulse * 0.2).toFixed(2)})`
              : 'rgba(13, 59, 30, 0.25)';
          ctx.fillRect(x + 8, y + 8, ts - 16, ts - 16);
          ctx.strokeStyle =
            highlightGrates && !occupied ? (isShockBuild ? '#00F0FF' : '#44FF77') : '#1E6E3B';
          ctx.lineWidth = highlightGrates && !occupied ? 2.4 : 1.5;
          ctx.strokeRect(x + 8, y + 8, ts - 16, ts - 16);

          // Louvered duct bars
          ctx.beginPath();
          for (let k = 15; k <= ts - 15; k += 8) {
            ctx.moveTo(x + 11, y + k);
            ctx.lineTo(x + ts - 11, y + k);
          }
          ctx.stroke();
        } else if (kind === 'SPAWN_GRATE') {
          // Non-buildable sub-floor Skitterer breach hatch: distinct hazard-striped dark steel plating
          ctx.save();
          ctx.fillStyle = '#140906';
          ctx.fillRect(x + 5, y + 5, ts - 10, ts - 10);

          // Clipped diagonal amber/rust hazard chevrons
          ctx.beginPath();
          ctx.rect(x + 7, y + 7, ts - 14, ts - 14);
          ctx.clip();
          ctx.strokeStyle = 'rgba(255, 118, 28, 0.34)';
          ctx.lineWidth = 4.5;
          ctx.beginPath();
          for (let s = -ts; s <= ts * 2; s += 13) {
            ctx.moveTo(x + s, y + ts);
            ctx.lineTo(x + s + ts, y);
          }
          ctx.stroke();
          ctx.restore();

          // Recessed steel hatch double frame + riveted corners + non-build cross bars
          ctx.strokeStyle = '#B84A1C';
          ctx.lineWidth = 2.0;
          ctx.strokeRect(x + 6, y + 6, ts - 12, ts - 12);
          ctx.strokeStyle = 'rgba(255, 176, 0, 0.45)';
          ctx.lineWidth = 1.1;
          ctx.strokeRect(x + 11, y + 11, ts - 22, ts - 22);

          // Corner hatch rivets
          ctx.fillStyle = '#FFB000';
          for (const [rx, ry] of [
            [x + 9, y + 9],
            [x + ts - 9, y + 9],
            [x + 9, y + ts - 9],
            [x + ts - 9, y + ts - 9],
          ]) {
            ctx.fillRect(rx - 1.5, ry - 1.5, 3, 3);
          }

          // Center locked-hatch cross so players never confuse it with buildable green/cyan DUCT_GRATE
          ctx.strokeStyle = 'rgba(255, 96, 36, 0.55)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(x + 18, y + 18);
          ctx.lineTo(x + ts - 18, y + ts - 18);
          ctx.moveTo(x + ts - 18, y + 18);
          ctx.lineTo(x + 18, y + ts - 18);
          ctx.stroke();
        } else if (kind === 'CORE') {
          // Opaque Reactor Core Bulkhead Foundation (visually signals solid LOS obstruction!)
          ctx.fillStyle = '#051A0F';
          ctx.fillRect(x, y, ts, ts);
          ctx.strokeStyle = 'rgba(46, 175, 96, 0.35)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x + 4, y + 4);
          ctx.lineTo(x + ts - 4, y + ts - 4);
          ctx.moveTo(x + ts - 4, y + 4);
          ctx.lineTo(x + 4, y + ts - 4);
          ctx.stroke();

          // Thick bright armored wall rim along exterior edges of the 2x2 opaque Core block
          ctx.strokeStyle = '#3BE078';
          ctx.lineWidth = 3.4;
          ctx.beginPath();
          if (r > 0 && bp.tiles[r - 1][c] !== 'CORE') {
            ctx.moveTo(x, y + 2);
            ctx.lineTo(x + ts, y + 2);
          }
          if (r < bp.rows - 1 && bp.tiles[r + 1][c] !== 'CORE') {
            ctx.moveTo(x, y + ts - 2);
            ctx.lineTo(x + ts, y + ts - 2);
          }
          if (c > 0 && bp.tiles[r][c - 1] !== 'CORE') {
            ctx.moveTo(x + 2, y);
            ctx.lineTo(x + 2, y + ts);
          }
          if (c < bp.cols - 1 && bp.tiles[r][c + 1] !== 'CORE') {
            ctx.moveTo(x + ts - 2, y);
            ctx.lineTo(x + ts - 2, y + ts);
          }
          ctx.stroke();
        } else if (kind === 'CORRIDOR' && highlightClaymore) {
          const hasMine = sim.claymores.some((m) => m.col === c && m.row === r);
          if (!hasMine) {
            ctx.fillStyle = `rgba(255, 176, 0, ${(0.04 + buildPulse * 0.04).toFixed(3)})`;
            ctx.fillRect(x + 16, y + 16, ts - 32, ts - 32);
          }
        } else if (kind === 'MOUNT_PAD') {
          const occupied = sim.turrets.some((t) => t.col === c && t.row === r);
          const padM = 9;
          if (highlightMountPads && !occupied) {
            ctx.fillStyle = `rgba(68, 255, 119, ${(0.12 + buildPulse * 0.18).toFixed(2)})`;
            ctx.fillRect(x + padM, y + padM, ts - padM * 2, ts - padM * 2);
          }
          ctx.strokeStyle =
            highlightMountPads && !occupied ? '#44FF77' : 'rgba(35, 140, 64, 0.48)';
          ctx.lineWidth = highlightMountPads && !occupied ? 2.2 : 1.3;
          const cl = 8;
          ctx.beginPath();
          // Corner reticle brackets + center '+'
          ctx.moveTo(x + padM, y + padM + cl);
          ctx.lineTo(x + padM, y + padM);
          ctx.lineTo(x + padM + cl, y + padM);

          ctx.moveTo(x + ts - padM - cl, y + padM);
          ctx.lineTo(x + ts - padM, y + padM);
          ctx.lineTo(x + ts - padM, y + padM + cl);

          ctx.moveTo(x + padM, y + ts - padM - cl);
          ctx.lineTo(x + padM, y + ts - padM);
          ctx.lineTo(x + padM + cl, y + ts - padM);

          ctx.moveTo(x + ts - padM - cl, y + ts - padM);
          ctx.lineTo(x + ts - padM, y + ts - padM);
          ctx.lineTo(x + ts - padM, y + ts - padM - cl);

          if (!occupied) {
            ctx.moveTo(x + ts * 0.5 - 4, y + ts * 0.5);
            ctx.lineTo(x + ts * 0.5 + 4, y + ts * 0.5);
            ctx.moveTo(x + ts * 0.5, y + ts * 0.5 - 4);
            ctx.lineTo(x + ts * 0.5, y + ts * 0.5 + 4);
          }
          ctx.stroke();
        }
      }
    }

    // Dynamic AIR_SHAFT Hull Breaches: Prep amber fracture telegraphs & collapsed scorched breach edges!
    if (bp.dynamicBreaches && bp.dynamicBreaches.length > 0) {
      const breachPulse = 0.55 + 0.45 * Math.sin(timeSec * 8.5);
      for (const br of bp.dynamicBreaches) {
        const isPending = sim.pendingBreachIds.includes(br.id);
        const isActive = sim.activeBreachIds.includes(br.id);
        if (!isPending && !isActive) continue;
        if (br.tiles.length === 0) continue;

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const t of br.tiles) {
          const tx = t.col * ts;
          const ty = t.row * ts;
          if (tx < minX) minX = tx;
          if (ty < minY) minY = ty;
          if (tx + ts > maxX) maxX = tx + ts;
          if (ty + ts > maxY) maxY = ty + ts;
        }
        const bCx = (minX + maxX) * 0.5;
        const bCy = (minY + maxY) * 0.5;

        ctx.save();
        if (isPending) {
          // Pulsing amber fracture zone during Prep telegraphing W5/15/25 breach!
          for (const t of br.tiles) {
            const tx = t.col * ts;
            const ty = t.row * ts;
            ctx.fillStyle = `rgba(255, 160, 16, ${(0.12 + breachPulse * 0.14).toFixed(3)})`;
            ctx.fillRect(tx + 2, ty + 2, ts - 4, ts - 4);
            ctx.strokeStyle = `rgba(255, 176, 0, ${(0.55 + breachPulse * 0.4).toFixed(2)})`;
            ctx.lineWidth = 2.0;
            ctx.setLineDash([7, 5]);
            ctx.strokeRect(tx + 3, ty + 3, ts - 6, ts - 6);
          }

          // Amber dashed fracture lines across the weakening bulkhead/air-shaft
          ctx.strokeStyle = '#FFD25A';
          ctx.lineWidth = 2.4;
          ctx.setLineDash([8, 5]);
          ctx.lineDashOffset = -timeSec * 24;
          ctx.beginPath();
          if (br.previewLines && br.previewLines.length > 0) {
            for (const ln of br.previewLines) {
              ctx.moveTo(ln.x1, ln.y1);
              ctx.lineTo(ln.x2, ln.y2);
            }
          } else {
            for (const t of br.tiles) {
              const tx = t.col * ts;
              const ty = t.row * ts;
              ctx.moveTo(tx + 8, ty + 8);
              ctx.lineTo(tx + ts - 8, ty + ts - 8);
              ctx.moveTo(tx + ts - 8, ty + 8);
              ctx.lineTo(tx + 8, ty + ts - 8);
            }
          }
          ctx.stroke();
          ctx.setLineDash([]);

          // Zoom-compensated warning glyph & CAD fracture badge (>=12px effective)
          const breachFontPx = this.worldFontPx(12, tfScale, 28);
          const lbl = `⚠ HULL BREACH W-${String(sim.waveNumber).padStart(2, '0')} // ${br.label}`;
          ctx.font = font('data', breachFontPx);
          const tw = ctx.measureText(lbl).width + 18;
          const bh = Math.round(breachFontPx + 10);
          ctx.fillStyle = 'rgba(42, 18, 3, 0.94)';
          ctx.fillRect(bCx - tw * 0.5, minY - bh - 6, tw, bh);
          ctx.strokeStyle = breachPulse > 0.75 ? '#FFF0B8' : THEME.ACCENT_AMBER;
          ctx.lineWidth = 1.8;
          ctx.strokeRect(bCx - tw * 0.5, minY - bh - 6, tw, bh);
          ctx.fillStyle = THEME.ACCENT_AMBER_HI;
          ctx.textAlign = 'center';
          ctx.fillText(lbl, bCx, minY - 12);
        } else if (isActive) {
          // Scorched collapsed breach tunnel edges & jagged debris markings
          const tileSet = new Set(br.tiles.map((t) => `${t.col},${t.row}`));
          for (const t of br.tiles) {
            const tx = t.col * ts;
            const ty = t.row * ts;
            ctx.fillStyle = 'rgba(46, 20, 8, 0.34)';
            ctx.fillRect(tx, ty, ts, ts);

            // Scorched rim along outer sides of breached corridor
            ctx.strokeStyle = 'rgba(255, 118, 32, 0.56)';
            ctx.lineWidth = 2.6;
            ctx.beginPath();
            if (!tileSet.has(`${t.col},${t.row - 1}`)) {
              ctx.moveTo(tx + 2, ty + 2);
              ctx.lineTo(tx + ts * 0.35, ty + 6);
              ctx.lineTo(tx + ts * 0.68, ty + 2);
              ctx.lineTo(tx + ts - 2, ty + 5);
            }
            if (!tileSet.has(`${t.col},${t.row + 1}`)) {
              ctx.moveTo(tx + 2, ty + ts - 2);
              ctx.lineTo(tx + ts * 0.32, ty + ts - 6);
              ctx.lineTo(tx + ts * 0.66, ty + ts - 2);
              ctx.lineTo(tx + ts - 2, ty + ts - 5);
            }
            if (!tileSet.has(`${t.col - 1},${t.row}`)) {
              ctx.moveTo(tx + 2, ty + 2);
              ctx.lineTo(tx + 6, ty + ts * 0.38);
              ctx.lineTo(tx + 2, ty + ts * 0.72);
              ctx.lineTo(tx + 5, ty + ts - 2);
            }
            if (!tileSet.has(`${t.col + 1},${t.row}`)) {
              ctx.moveTo(tx + ts - 2, ty + 2);
              ctx.lineTo(tx + ts - 6, ty + ts * 0.35);
              ctx.lineTo(tx + ts - 2, ty + ts * 0.68);
              ctx.lineTo(tx + ts - 5, ty + ts - 2);
            }
            ctx.stroke();
          }

          const actBreachPx = this.worldFontPx(12, tfScale, 24);
          ctx.font = font('data', actBreachPx);
          ctx.fillStyle = 'rgba(255, 168, 86, 0.72)';
          ctx.textAlign = 'center';
          ctx.fillText('BREACHED', bCx, bCy + 6);
        }
        ctx.restore();
      }
    }

    // Airlock Purge Chamber Stencils & Hazard Borders
    const airlockFontPx = this.worldFontPx(12, tfScale, 26);
    for (const al of bp.airlocks) {
      const b = al.bounds;
      ctx.save();
      ctx.fillStyle = highlightPurge
        ? `rgba(255, 176, 0, ${(0.14 + buildPulse * 0.16).toFixed(2)})`
        : 'rgba(255, 176, 0, 0.04)';
      ctx.fillRect(b.x + 3, b.y + 3, b.width - 6, b.height - 6);

      ctx.strokeStyle = highlightPurge ? THEME.ACCENT_AMBER : 'rgba(255, 176, 0, 0.42)';
      ctx.lineWidth = highlightPurge ? 2.8 : 1.6;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(b.x + 3, b.y + 3, b.width - 6, b.height - 6);
      ctx.setLineDash([]);

      ctx.font = font('head', airlockFontPx);
      ctx.fillStyle = highlightPurge ? THEME.ACCENT_AMBER_HI : 'rgba(255, 176, 0, 0.68)';
      ctx.textAlign = 'center';
      ctx.fillText(al.label, al.center.x, al.center.y + 6);
      ctx.restore();
    }

    // Architectural Room Labels
    ctx.save();
    ctx.textAlign = 'center';
    const roomPx = this.worldFontPx(12, tfScale, 24);
    for (const lbl of bp.roomLabels) {
      ctx.font = font('head', roomPx);
      ctx.fillStyle = 'rgba(82, 184, 114, 0.42)';
      ctx.fillText(lbl.text, lbl.x, lbl.y);
      if (lbl.subText) {
        ctx.font = font('data', Math.max(14, Math.round(roomPx * 0.85)));
        ctx.fillStyle = 'rgba(255, 176, 0, 0.36)';
        ctx.fillText(lbl.subText, lbl.x, lbl.y + Math.round(roomPx * 0.95));
      }
    }
    ctx.restore();

    // 4 Outer Breach Vents (VENT-01 .. VENT-04) + Auxiliary Floor Grates (+ Tactical Prep Wave Previews!)
    const ventSummaries = new Map<string, { text: string; hasBoss: boolean }>();
    for (const grp of sim.currentWaveDef.groups) {
      const existing = ventSummaries.get(grp.ventId);
      const spec = HOSTILE_SPECS[grp.kind];
      const tag = spec.isBoss ? `★${spec.shortCode}` : `${grp.count}×${spec.shortCode}`;
      if (!existing) {
        ventSummaries.set(grp.ventId, { text: tag, hasBoss: Boolean(spec.isBoss) });
      } else {
        existing.text = `${existing.text} ${tag}`;
        if (spec.isBoss) existing.hasBoss = true;
      }
    }
    const showPrepPreview = sim.phase === 'TACTICAL_PREP';
    const ventFontPx = this.worldFontPx(12, tfScale, 30);
    const previewFontPx = this.worldFontPx(12, tfScale, 28);

    for (const vent of bp.vents) {
      const summary = ventSummaries.get(vent.id);
      const isWaveActive = Boolean(summary);
      if (vent.isAuxGrate) {
        if (isWaveActive) {
          ctx.save();
          ctx.strokeStyle = showPrepPreview
            ? `rgba(255, 176, 0, ${(0.55 + buildPulse * 0.4).toFixed(2)})`
            : 'rgba(255, 176, 0, 0.55)';
          ctx.lineWidth = showPrepPreview ? 2.2 : 1.6;
          ctx.strokeRect(vent.pos.x - 24, vent.pos.y - 24, 48, 48);
          ctx.font = font('data', previewFontPx);
          const gTxt = showPrepPreview && summary ? `${vent.id}: ${summary.text}` : vent.id;
          const gw = ctx.measureText(gTxt).width + 14;
          const gh = Math.round(previewFontPx + 8);
          ctx.fillStyle = 'rgba(26, 16, 4, 0.92)';
          ctx.fillRect(vent.pos.x - gw * 0.5, vent.pos.y - 28 - gh, gw, gh);
          ctx.strokeStyle = THEME.ACCENT_AMBER;
          ctx.lineWidth = 1.4;
          ctx.strokeRect(vent.pos.x - gw * 0.5, vent.pos.y - 28 - gh, gw, gh);
          ctx.fillStyle = THEME.ACCENT_AMBER_HI;
          ctx.textAlign = 'center';
          ctx.fillText(gTxt, vent.pos.x, vent.pos.y - 34);
          ctx.restore();
        }
        continue;
      }

      const vPulse = isWaveActive ? 0.65 + 0.35 * Math.sin(timeSec * 6.5) : 0.45;
      ctx.save();
      ctx.strokeStyle = summary?.hasBoss
        ? `rgba(255, 51, 68, ${vPulse.toFixed(2)})`
        : isWaveActive
          ? `rgba(255, 176, 0, ${vPulse.toFixed(2)})`
          : '#238C40';
      ctx.lineWidth = summary?.hasBoss ? 3.2 : 2.4;
      ctx.strokeRect(vent.pos.x - 24, vent.pos.y - 24, 48, 48);

      // Diamond breach reticle
      ctx.beginPath();
      ctx.moveTo(vent.pos.x, vent.pos.y - 16);
      ctx.lineTo(vent.pos.x + 16, vent.pos.y);
      ctx.lineTo(vent.pos.x, vent.pos.y + 16);
      ctx.lineTo(vent.pos.x - 16, vent.pos.y);
      ctx.closePath();
      ctx.stroke();

      ctx.font = font('head', ventFontPx);
      ctx.fillStyle = summary?.hasBoss
        ? THEME.ALERT_RED_TEXT
        : isWaveActive
          ? THEME.ACCENT_AMBER
          : THEME.TEXT_PRIMARY;
      ctx.textAlign = vent.col < bp.cols * 0.5 ? 'left' : 'right';
      const labelX = vent.col < bp.cols * 0.5 ? vent.pos.x - 24 : vent.pos.x + 24;
      ctx.fillText(vent.id, labelX, vent.pos.y - 30);

      // Zoom-Compensated Upcoming Wave Composition Preview Badge during Tactical Prep!
      if (showPrepPreview && summary) {
        ctx.font = font('data', previewFontPx);
        const previewTxt = summary.text;
        const pw = ctx.measureText(previewTxt).width + 18;
        const ph = Math.round(previewFontPx + 10);
        const px = vent.col < bp.cols * 0.5 ? vent.pos.x - 24 : vent.pos.x + 24 - pw;
        const py = vent.pos.y + 28;
        ctx.fillStyle = summary.hasBoss ? 'rgba(65, 10, 14, 0.94)' : 'rgba(28, 18, 4, 0.94)';
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = summary.hasBoss ? '#FF3355' : THEME.ACCENT_AMBER;
        ctx.lineWidth = 1.6;
        ctx.strokeRect(px, py, pw, ph);
        ctx.textAlign = 'center';
        ctx.fillStyle = summary.hasBoss ? '#FFE0E6' : THEME.ACCENT_AMBER_HI;
        ctx.fillText(previewTxt, px + pw * 0.5, py + Math.round(ph * 0.72));
      }
      ctx.restore();
    }
  }

  private drawFlowRouteVectors(
    ctx: CanvasRenderingContext2D,
    sim: PerimeterSimulation,
    timeSec: number
  ): void {
    const activeVentIds = new Set(sim.currentWaveDef.groups.map((g) => g.ventId));
    ctx.save();
    ctx.lineWidth = 1.8;
    ctx.setLineDash([7, 9]);
    ctx.lineDashOffset = -timeSec * 28;

    for (const vent of sim.blueprint.vents) {
      if (!activeVentIds.has(vent.id)) continue;
      const pts = sim.pathfinder.traceRoutePreview(
        sim.blueprint,
        sim.doors,
        vent.col,
        vent.row
      );
      if (pts.length < 2) continue;
      ctx.strokeStyle = vent.isAuxGrate
        ? 'rgba(255, 176, 0, 0.26)'
        : 'rgba(68, 255, 119, 0.25)';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawSensorAndIlluminationZones(
    ctx: CanvasRenderingContext2D,
    rc: BlueprintRenderContext,
    tfScale: number
  ): void {
    const { sim, timeSec, selectedTurretId, hoveredTurretId } = rc;
    const flareFontPx = this.worldFontPx(12, tfScale, 26);

    // 1. M40 Tactical Strobe Flares (12s wide-area target lock!)
    for (const f of sim.flares) {
      const strobe = 0.82 + 0.18 * Math.sin(timeSec * 34);
      const grad = ctx.createRadialGradient(f.pos.x, f.pos.y, 8, f.pos.x, f.pos.y, f.radius);
      grad.addColorStop(0, `rgba(255, 250, 220, ${(0.34 * strobe).toFixed(3)})`);
      grad.addColorStop(0.55, `rgba(68, 255, 119, ${(0.14 * strobe).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(68, 255, 119, 0)');

      ctx.save();
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(f.pos.x, f.pos.y, f.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#FFF0B8';
      ctx.lineWidth = 2.0;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.arc(f.pos.x, f.pos.y, f.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Center flare canister + zoom-compensated countdown tag
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(f.pos.x, f.pos.y, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = font('data', flareFontPx);
      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      ctx.textAlign = 'center';
      ctx.fillText(`M40 FLARE [${f.remainingSec.toFixed(1)}S]`, f.pos.x, f.pos.y - 14);
      ctx.restore();
    }

    // 2. Overclock Power Bus Sector Rings
    for (const oc of sim.overclocks) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 176, 0, 0.55)';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.arc(oc.pos.x, oc.pos.y, oc.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 3. Directional Infrared Turret Cones (Calm-Mode in WAVE_ACTIVE) & M314 Laser Tripwires
    for (const t of sim.turrets) {
      const isSelected = t.id === selectedTurretId;
      const isHovered = Boolean(hoveredTurretId && t.id === hoveredTurretId);
      const spec = HARDWARE_SPECS[t.kind];

      if (t.kind === 'MOTION_RELAY') {
        // MK-III Branch A: Permanent 280px Jam-Immune Optical Floodlight Halo (+15% crit & Stalker burn)!
        if (
          t.powered &&
          t.powerUpTimer <= 0 &&
          sim.blackoutTimer <= 0 &&
          t.level === 3 &&
          t.mk3Branch === 'A'
        ) {
          const haloR = 280;
          const grad = ctx.createRadialGradient(t.pos.x, t.pos.y, 8, t.pos.x, t.pos.y, haloR);
          grad.addColorStop(0, 'rgba(220, 255, 240, 0.24)');
          grad.addColorStop(0.65, 'rgba(110, 255, 190, 0.08)');
          grad.addColorStop(1, 'rgba(110, 255, 190, 0)');
          ctx.save();
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(t.pos.x, t.pos.y, haloR, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(200, 255, 232, 0.48)';
          ctx.lineWidth = 1.7;
          ctx.setLineDash([7, 6]);
          ctx.beginPath();
          ctx.arc(t.pos.x, t.pos.y, haloR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }

        if (isSelected || isHovered) {
          const mk4Mult = 1 + (t.mk4Level ?? 0) * PERIMETER_CONSTANTS.MK4_DMG_PER_LEVEL;
          const rPx = spec.rangePx * (t.level >= 2 ? 1.105 : 1.0) * mk4Mult;
          ctx.save();
          ctx.strokeStyle = 'rgba(68, 255, 119, 0.35)';
          ctx.lineWidth = 1.6;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.arc(t.pos.x, t.pos.y, rPx, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }

        // Corridor Laser Tripwire Beam (disabled visually when Screamer jams relay!)
        if (
          t.powered &&
          t.powerUpTimer <= 0 &&
          t.tripwireStart &&
          t.tripwireEnd &&
          t.tripwireIntegrity >= 20
        ) {
          ctx.save();
          if (t.jammedTimer > 0) {
            ctx.strokeStyle = 'rgba(224, 102, 255, 0.40)';
            ctx.lineWidth = 1.8;
            ctx.setLineDash([5, 6]);
            ctx.beginPath();
            ctx.moveTo(t.tripwireStart.x, t.tripwireStart.y);
            ctx.lineTo(t.tripwireEnd.x, t.tripwireEnd.y);
            ctx.stroke();
            ctx.setLineDash([]);
          } else {
            const damaged = t.tripwireIntegrity < 75;
            const beamAlpha = damaged ? 0.45 + 0.4 * Math.sin(timeSec * 28) : 0.88;
            ctx.strokeStyle = `rgba(255, 68, 36, ${beamAlpha.toFixed(2)})`;
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.moveTo(t.tripwireStart.x, t.tripwireStart.y);
            ctx.lineTo(t.tripwireEnd.x, t.tripwireEnd.y);
            ctx.stroke();

            ctx.fillStyle = '#FF5533';
            ctx.fillRect(t.tripwireEnd.x - 3, t.tripwireEnd.y - 3, 6, 6);
          }
          ctx.restore();
        }
        continue;
      }

      if (t.kind === 'CRYO_VALVE' || t.kind === 'SHOCK_COIL') {
        const cryoProto = 1 + sim.getProtocolStacks('CRYO_SHATTER') * 0.15;
        const lvMult =
          t.kind === 'CRYO_VALVE'
            ? t.level >= 2
              ? 1.22
              : 1.0
            : t.level >= 2
              ? 1.18
              : 1.0;
        const rPx = spec.rangePx * lvMult * cryoProto;
        const isCryoCooler = t.kind === 'CRYO_VALVE' && t.level === 3 && t.mk3Branch === 'B';

        if (
          isSelected ||
          isHovered ||
          (t.kind === 'SHOCK_COIL' && t.powered && t.powerUpTimer <= 0 && sim.blackoutTimer <= 0)
        ) {
          ctx.save();
          ctx.strokeStyle =
            t.kind === 'SHOCK_COIL'
              ? isSelected || isHovered
                ? 'rgba(76, 238, 255, 0.62)'
                : 'rgba(76, 238, 255, 0.14)'
              : 'rgba(142, 245, 171, 0.50)';
          ctx.lineWidth = isSelected || isHovered ? 1.9 : 1.1;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.arc(t.pos.x, t.pos.y, rPx, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }

        // CRYO COOLER MK-III-B: Exact 320px turret cooling & ROF/heat aura ring!
        if (
          isCryoCooler &&
          (isSelected || isHovered || (t.powered && t.powerUpTimer <= 0 && sim.blackoutTimer <= 0))
        ) {
          ctx.save();
          ctx.strokeStyle =
            isSelected || isHovered ? 'rgba(120, 248, 255, 0.52)' : 'rgba(120, 248, 255, 0.12)';
          ctx.lineWidth = isSelected || isHovered ? 1.8 : 1.1;
          ctx.setLineDash([9, 7]);
          ctx.beginPath();
          ctx.arc(t.pos.x, t.pos.y, 320, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          if (isSelected || isHovered) {
            const auraPx = this.worldFontPx(12, tfScale, 24);
            ctx.font = font('data', auraPx);
            ctx.fillStyle = THEME.ACCENT_CYAN;
            ctx.textAlign = 'center';
            ctx.fillText('320PX CRYO COOLER AURA (-20% HEAT / +15% ROF)', t.pos.x, t.pos.y - 328);
          }
          ctx.restore();
        }
        continue;
      }

      if (!t.powered || sim.blackoutTimer > 0 || t.powerUpTimer > 0) continue;

      const relayMult = t.relayMatrixBoosted ? 1.32 : t.relayBoosted ? 1.24 : 1.0;
      const lvlMult = t.level === 3 ? 1.22 : t.level === 2 ? 1.12 : 1.0;
      const effRange = spec.rangePx * relayMult * lvlMult;
      const darkRange = effRange * PERIMETER_CONSTANTS.DARK_CORRIDOR_RANGE_MULT;
      const halfArc = spec.coneHalfAngleRad;
      const a1 = t.angle - halfArc;
      const a2 = t.angle + halfArc;

      // Blueprint Calm-Mode: during WAVE_ACTIVE, draw full shaded cone + IR scan ray ONLY on hovered/selected turret!
      const showFullCone = sim.phase !== 'WAVE_ACTIVE' || isSelected || isHovered;

      ctx.save();
      const isRail = t.kind === 'RAIL_LANCE';
      const isAmber = t.kind === 'INCINERATOR' || t.overclockTimer > 0;
      const isDown =
        t.thermalLocked || t.rearmTimer > 0 || (t.kind === 'SENTRY_PULSE' && t.ammo <= 0);

      // Raycasted wall-occluded full 100% illuminated cone polygon (exact turret LOS!)
      const raySamples = showFullCone ? 24 : 16;
      const conePts: Array<{ x: number; y: number }> = [];
      const darkPts: Array<{ x: number; y: number }> = [];
      for (let s = 0; s <= raySamples; s++) {
        const ra = a1 + ((a2 - a1) * s) / raySamples;
        conePts.push(sim.castSightRay(t.pos, ra, effRange));
        darkPts.push(sim.castSightRay(t.pos, ra, darkRange));
      }

      if (showFullCone) {
        const coneGrad = ctx.createRadialGradient(
          t.pos.x,
          t.pos.y,
          12,
          t.pos.x,
          t.pos.y,
          effRange
        );
        if (isDown) {
          coneGrad.addColorStop(0, 'rgba(255, 51, 24, 0.12)');
          coneGrad.addColorStop(1, 'rgba(255, 51, 24, 0.01)');
        } else if (isRail && t.overclockTimer <= 0) {
          coneGrad.addColorStop(0, 'rgba(76, 238, 255, 0.20)');
          coneGrad.addColorStop(0.55, 'rgba(76, 220, 255, 0.09)');
          coneGrad.addColorStop(1, 'rgba(76, 200, 255, 0.015)');
        } else if (isAmber) {
          coneGrad.addColorStop(0, 'rgba(255, 176, 0, 0.18)');
          coneGrad.addColorStop(0.55, 'rgba(255, 176, 0, 0.09)');
          coneGrad.addColorStop(1, 'rgba(255, 176, 0, 0.015)');
        } else {
          coneGrad.addColorStop(0, 'rgba(68, 255, 119, 0.17)');
          coneGrad.addColorStop(0.55, 'rgba(68, 255, 119, 0.08)');
          coneGrad.addColorStop(1, 'rgba(68, 255, 119, 0.015)');
        }

        ctx.fillStyle = coneGrad;
        ctx.beginPath();
        ctx.moveTo(t.pos.x, t.pos.y);
        for (const pt of conePts) {
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.closePath();
        ctx.fill();
      }

      // Outer 100% illuminated range border (crisp low-alpha outline in Calm-Mode!)
      ctx.strokeStyle = isDown
        ? showFullCone
          ? 'rgba(255, 51, 24, 0.45)'
          : 'rgba(255, 51, 24, 0.24)'
        : isSelected
          ? THEME.ACCENT_AMBER
          : isHovered
            ? THEME.TEXT_BRIGHT
            : isRail && t.overclockTimer <= 0
              ? showFullCone
                ? 'rgba(76, 238, 255, 0.36)'
                : 'rgba(76, 238, 255, 0.18)'
              : isAmber
                ? showFullCone
                  ? 'rgba(255, 176, 0, 0.34)'
                  : 'rgba(255, 176, 0, 0.17)'
                : showFullCone
                  ? 'rgba(68, 255, 119, 0.32)'
                  : 'rgba(68, 255, 119, 0.16)';
      ctx.lineWidth = isSelected ? 2.2 : isHovered ? 1.8 : showFullCone ? 1.35 : 1.05;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(t.pos.x, t.pos.y);
      for (const pt of conePts) {
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      // Inner 55% passive dark-corridor IR engagement range arc
      ctx.strokeStyle = isDown
        ? showFullCone
          ? 'rgba(255, 51, 24, 0.55)'
          : 'rgba(255, 51, 24, 0.28)'
        : isRail && t.overclockTimer <= 0
          ? showFullCone
            ? 'rgba(76, 238, 255, 0.62)'
            : 'rgba(76, 238, 255, 0.28)'
          : isAmber
            ? showFullCone
              ? 'rgba(255, 176, 0, 0.62)'
              : 'rgba(255, 176, 0, 0.28)'
            : showFullCone
              ? 'rgba(68, 255, 119, 0.58)'
              : 'rgba(68, 255, 119, 0.26)';
      ctx.lineWidth = showFullCone ? 1.65 : 1.2;
      ctx.beginPath();
      for (let i = 0; i < darkPts.length; i++) {
        if (i === 0) ctx.moveTo(darkPts[i].x, darkPts[i].y);
        else ctx.lineTo(darkPts[i].x, darkPts[i].y);
      }
      ctx.stroke();

      // Sweeping internal IR scan ray ONLY when showFullCone is true (Prep or Hovered/Selected)!
      if (showFullCone && !isDown) {
        const sweepPhase = Math.sin(timeSec * 3.8 + t.col * 0.7);
        const rayAng = t.angle + sweepPhase * halfArc * 0.92;
        const rayHit = sim.castSightRay(t.pos, rayAng, darkRange);
        ctx.strokeStyle =
          isRail && t.overclockTimer <= 0
            ? 'rgba(130, 248, 255, 0.52)'
            : isAmber
              ? 'rgba(255, 196, 72, 0.48)'
              : 'rgba(142, 245, 171, 0.48)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(t.pos.x, t.pos.y);
        ctx.lineTo(rayHit.x, rayHit.y);
        ctx.stroke();
      }

      // Dashed target-angle ghost cone when servo is slewing to a new heading!
      if (Math.abs(t.targetAngle - t.angle) > 0.04) {
        const ta1 = t.targetAngle - halfArc;
        const ta2 = t.targetAngle + halfArc;
        ctx.strokeStyle = THEME.ACCENT_AMBER;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(t.pos.x, t.pos.y);
        ctx.lineTo(t.pos.x + Math.cos(ta1) * effRange, t.pos.y + Math.sin(ta1) * effRange);
        ctx.arc(t.pos.x, t.pos.y, effRange, ta1, ta2);
        ctx.lineTo(t.pos.x, t.pos.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  private drawEnvironmentalZones(
    ctx: CanvasRenderingContext2D,
    sim: PerimeterSimulation,
    timeSec: number,
    tfScale: number
  ): void {
    // 1. Corrosive Acid Pools (from Acid Bursters)
    for (const pool of sim.acidPools) {
      const alpha = Math.min(1, pool.remainingSec / 1.5);
      ctx.save();
      ctx.fillStyle = `rgba(176, 255, 42, ${(0.22 * alpha).toFixed(2)})`;
      ctx.strokeStyle = `rgba(195, 255, 64, ${(0.82 * alpha).toFixed(2)})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      const verts = 10;
      for (let i = 0; i <= verts; i++) {
        const a = (i / verts) * Math.PI * 2;
        const wob = 0.84 + 0.16 * Math.sin(a * 3 + timeSec * 7);
        const px = pool.pos.x + Math.cos(a) * pool.radius * wob;
        const py = pool.pos.y + Math.sin(a) * pool.radius * wob;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 2. Cryo-Stasis Liquid-Nitrogen Plumes
    for (const cp of sim.cryoPlumes) {
      const alpha = Math.min(1, cp.remainingSec / 0.6);
      ctx.save();
      ctx.fillStyle = `rgba(130, 255, 225, ${(0.16 * alpha).toFixed(2)})`;
      ctx.strokeStyle = `rgba(155, 255, 235, ${(0.72 * alpha).toFixed(2)})`;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2 + timeSec * 1.4;
        const px = cp.pos.x + Math.cos(a) * cp.radius;
        const py = cp.pos.y + Math.sin(a) * cp.radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 3. Lingering Phosphor-Amber M240 Napalm Clouds
    for (const nc of sim.napalmClouds) {
      const alpha = Math.min(1, nc.remainingSec / 0.8);
      ctx.save();
      const grad = ctx.createRadialGradient(
        nc.pos.x,
        nc.pos.y,
        6,
        nc.pos.x,
        nc.pos.y,
        nc.radius
      );
      grad.addColorStop(0, `rgba(255, 220, 90, ${(0.45 * alpha).toFixed(2)})`);
      grad.addColorStop(0.65, `rgba(255, 130, 16, ${(0.28 * alpha).toFixed(2)})`);
      grad.addColorStop(1, 'rgba(255, 60, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(nc.pos.x, nc.pos.y, nc.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(255, 176, 0, ${(0.85 * alpha).toFixed(2)})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      const lobes = 8;
      for (let i = 0; i <= lobes; i++) {
        const a = (i / lobes) * Math.PI * 2 - timeSec * 5;
        const r = nc.radius * (0.78 + 0.22 * Math.sin(i * 2.7 + timeSec * 12));
        const px = nc.pos.x + Math.cos(a) * r;
        const py = nc.pos.y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // 4. Emergency Airlock Decompression Blast Gusts
    for (const pw of sim.purgeWaves) {
      const alpha = Math.min(1, pw.remainingSec);
      ctx.save();
      ctx.strokeStyle = `rgba(180, 255, 210, ${(0.88 * alpha).toFixed(2)})`;
      ctx.lineWidth = 3.0;
      const b = pw.bounds;
      for (let k = 0; k < 6; k++) {
        const frac = (k + 0.5) / 6;
        const sx = b.x + b.width * (pw.flushDir.x === 0 ? frac : 0.5);
        const sy = b.y + b.height * (pw.flushDir.y === 0 ? frac : 0.5);
        const travel = (1.15 - pw.remainingSec) * 260;
        ctx.beginPath();
        ctx.moveTo(sx + pw.flushDir.x * travel * 0.4, sy + pw.flushDir.y * travel * 0.4);
        ctx.lineTo(sx + pw.flushDir.x * (travel + 55), sy + pw.flushDir.y * (travel + 55));
        ctx.stroke();
      }
      ctx.restore();
    }

    // 5. Armed M18 Proximity Claymore Mines
    for (const m of sim.claymores) {
      const armed = m.armTimer <= 0;
      const blink = armed && Math.sin(timeSec * 10 + m.col) > 0;
      ctx.save();
      ctx.translate(m.pos.x, m.pos.y);

      ctx.strokeStyle = armed ? 'rgba(255, 176, 0, 0.30)' : 'rgba(130, 180, 140, 0.24)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, PERIMETER_CONSTANTS.CLAYMORE_TRIGGER_RADIUS_PX, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#1E2C1A';
      ctx.strokeStyle = armed ? '#FFB000' : '#6F9F7A';
      ctx.lineWidth = 2.0;
      ctx.fillRect(-10, -7, 20, 14);
      ctx.strokeRect(-10, -7, 20, 14);

      ctx.fillStyle = blink ? '#FF3318' : armed ? '#FFB000' : '#44FF77';
      ctx.beginPath();
      ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();

      const mineFontPx = this.worldFontPx(12, tfScale, 22);
      ctx.font = font('data', mineFontPx);
      ctx.fillStyle = armed ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT;
      ctx.textAlign = 'center';
      ctx.fillText(armed ? 'M18' : 'ARM', 0, -12);
      ctx.restore();
    }

    // 6. Matriarch Queen Hatching Egg Sacs!
    const eggFontPx = this.worldFontPx(12, tfScale, 26);
    for (const egg of sim.eggSacs) {
      const prog = 1 - egg.hatchTimer / Math.max(0.1, egg.maxHatchTimer);
      const pulse = 1 + 0.12 * Math.sin(timeSec * 14 + egg.id);
      ctx.save();
      ctx.translate(egg.pos.x, egg.pos.y);

      ctx.strokeStyle = prog > 0.7 ? THEME.ALERT_RED_STROKE : '#B8FF3B';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, 0, 17, -Math.PI * 0.5, -Math.PI * 0.5 + prog * Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(42, 60, 18, 0.92)';
      ctx.strokeStyle = '#C8FF44';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.ellipse(0, 0, 11 * pulse, 14 * pulse, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FF5533';
      ctx.beginPath();
      ctx.arc(0, -3, 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = font('data', eggFontPx);
      const eggLbl = `EGG ${egg.hatchTimer.toFixed(1)}S`;
      const ew = ctx.measureText(eggLbl).width + 12;
      const eh = Math.round(eggFontPx + 6);
      ctx.fillStyle = 'rgba(18, 28, 8, 0.92)';
      ctx.fillRect(-ew * 0.5, -24 - eh, ew, eh);
      ctx.strokeStyle = prog > 0.7 ? THEME.ALERT_RED_STROKE : '#B8FF3B';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(-ew * 0.5, -24 - eh, ew, eh);
      ctx.fillStyle = '#D4FF66';
      ctx.textAlign = 'center';
      ctx.fillText(eggLbl, 0, -28);
      ctx.restore();
    }
  }

  /**
   * 5-Second Rattling Floor-Grate Breach Telegraphs (`GRATE-01..04`) before Skitterers erupt!
   */
  private drawGrateTelegraphs(
    ctx: CanvasRenderingContext2D,
    sim: PerimeterSimulation,
    timeSec: number,
    tfScale: number
  ): void {
    if (sim.grateTelegraphs.length === 0) return;
    const grateFontPx = this.worldFontPx(12, tfScale, 30);
    for (const gt of sim.grateTelegraphs) {
      const blink = Math.sin(timeSec * 18) > -0.2;
      const ringProg = (timeSec * 1.4) % 1;
      const ringR = 26 + ringProg * 48;

      ctx.save();
      ctx.translate(gt.pos.x, gt.pos.y);
      ctx.strokeStyle = `rgba(255, 176, 0, ${((1 - ringProg) * 0.85).toFixed(2)})`;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, Math.PI * 2);
      ctx.stroke();

      // Rattling grate caution frame
      const jx = (Math.random() - 0.5) * 4;
      const jy = (Math.random() - 0.5) * 4;
      ctx.fillStyle = blink ? 'rgba(255, 110, 20, 0.32)' : 'rgba(60, 22, 4, 0.5)';
      ctx.fillRect(-28 + jx, -28 + jy, 56, 56);
      ctx.strokeStyle = blink ? '#FFF0B8' : THEME.ALERT_RED_STROKE;
      ctx.lineWidth = 3.0;
      ctx.strokeRect(-28 + jx, -28 + jy, 56, 56);

      // Zoom-compensated high-contrast countdown banner above grate
      const lbl = `⚠ ${gt.ventId} BREACH ${gt.remainingSec.toFixed(1)}S`;
      ctx.font = font('head', grateFontPx);
      const tw = ctx.measureText(lbl).width + 18;
      const bh = Math.round(grateFontPx + 10);
      ctx.fillStyle = blink ? THEME.ACCENT_AMBER : 'rgba(42, 12, 4, 0.94)';
      ctx.fillRect(-tw * 0.5, -36 - bh, tw, bh);
      ctx.strokeStyle = THEME.ALERT_RED_STROKE;
      ctx.lineWidth = 1.8;
      ctx.strokeRect(-tw * 0.5, -36 - bh, tw, bh);
      ctx.fillStyle = blink ? THEME.INK_INVERSE : THEME.ACCENT_AMBER_HI;
      ctx.textAlign = 'center';
      ctx.fillText(lbl, 0, -42);
      ctx.restore();
    }
  }

  private drawBlastDoors(
    ctx: CanvasRenderingContext2D,
    rc: BlueprintRenderContext,
    tfScale: number
  ): void {
    const { sim, activeTool, selectedDoorId, timeSec } = rc;
    const ts = sim.blueprint.tileSize;
    const doorFontPx = this.worldFontPx(12, tfScale, 28);
    const highlightWeld =
      activeTool.kind === 'BUILD' && activeTool.buildId === 'ARC_WELDER';

    for (const ds of sim.doors.values()) {
      const isSelected = ds.def.id === selectedDoorId;
      const cx = ds.def.center.x;
      const cy = ds.def.center.y;
      const isVert = ds.def.orientation === 'VERTICAL';
      const w = isVert ? 26 : ts * 2 - 6;
      const h = isVert ? ts * 2 - 6 : 26;

      ctx.save();
      const shakeX = ds.underAttackTimer > 0 ? (Math.random() - 0.5) * 5 : 0;
      const shakeY = ds.underAttackTimer > 0 ? (Math.random() - 0.5) * 5 : 0;
      ctx.translate(cx + shakeX, cy + shakeY);

      if (ds.weldingTimer > 0) {
        // Active 2.0s Mid-Wave Arc-Weld Torch Sequence!
        const prog = Math.max(
          0,
          Math.min(1, 1 - ds.weldingTimer / Math.max(0.1, ds.weldingDuration))
        );
        const flash = Math.sin(timeSec * 36) > 0;
        ctx.fillStyle = 'rgba(56, 32, 4, 0.72)';
        ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
        ctx.strokeStyle = flash ? '#FFF4CC' : '#FFB000';
        ctx.lineWidth = 3.0;
        ctx.strokeRect(-w * 0.5, -h * 0.5, w, h);

        // Moving arc-weld torch flare along seam
        const seamPos = -0.45 + prog * 0.9;
        const tx = isVert ? 0 : w * seamPos;
        const ty = isVert ? h * seamPos : 0;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(tx, ty, flash ? 6.5 : 4.5, 0, Math.PI * 2);
        ctx.fill();

        const barW = 74;
        const barY = -h * 0.5 - 16;
        ctx.fillStyle = '#050D08';
        ctx.fillRect(-barW * 0.5, barY, barW, 8);
        ctx.fillStyle = THEME.ACCENT_AMBER;
        ctx.fillRect(-barW * 0.5 + 1, barY + 1, (barW - 2) * prog, 6);

        ctx.font = font('data', doorFontPx);
        ctx.fillStyle = THEME.ACCENT_AMBER_HI;
        ctx.textAlign = 'center';
        ctx.fillText(`WELDING ${ds.weldingTimer.toFixed(1)}S`, 0, barY - 6);
      } else if (ds.welded && ds.hp > 0) {
        const hpRatio = Math.max(0, ds.hp / ds.maxHp);
        const doorCol =
          ds.underAttackTimer > 0 || ds.acidCorrodingTimer > 0
            ? '#FF3318'
            : hpRatio < 0.35
              ? '#FF5522'
              : '#FFB000';

        ctx.fillStyle = 'rgba(48, 28, 4, 0.92)';
        ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
        ctx.strokeStyle = isSelected ? '#FFFFFF' : doorCol;
        ctx.lineWidth = isSelected ? 3.2 : 2.6;
        ctx.strokeRect(-w * 0.5, -h * 0.5, w, h);

        // Interlocking welded steel teeth seam
        ctx.strokeStyle = '#FFE08A';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        if (isVert) {
          ctx.moveTo(0, -h * 0.5 + 4);
          ctx.lineTo(0, h * 0.5 - 4);
        } else {
          ctx.moveTo(-w * 0.5 + 4, 0);
          ctx.lineTo(w * 0.5 - 4, 0);
        }
        ctx.stroke();

        // Electrified Bulkhead Plating sparks when BULKHEAD_ARMOR Protocol is active!
        if (sim.getProtocolStacks('BULKHEAD_ARMOR') > 0) {
          const elecAlpha = 0.65 + 0.35 * Math.sin(timeSec * 22 + cx * 0.05);
          ctx.save();
          ctx.strokeStyle = `rgba(0, 240, 255, ${elecAlpha.toFixed(2)})`;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          const steps = 6;
          for (let s = 0; s <= steps; s++) {
            const frac = -0.44 + (s / steps) * 0.88;
            const jitter =
              s === 0 || s === steps
                ? 0
                : Math.sin(timeSec * 42 + s * 3.7 + cy) * 6.5;
            const ex = isVert ? jitter : w * frac;
            const ey = isVert ? h * frac : jitter;
            if (s === 0) ctx.moveTo(ex, ey);
            else ctx.lineTo(ex, ey);
          }
          ctx.stroke();

          // Bright insulator arc nodes on ends
          ctx.fillStyle = '#B8FFFF';
          if (isVert) {
            ctx.fillRect(-3, -h * 0.5 + 2, 6, 4);
            ctx.fillRect(-3, h * 0.5 - 6, 6, 4);
          } else {
            ctx.fillRect(-w * 0.5 + 2, -3, 4, 6);
            ctx.fillRect(w * 0.5 - 6, -3, 4, 6);
          }
          ctx.restore();
        }

        // Live Door HP Bar + Zoom-Compensated Label
        const barW = 70;
        const barY = -h * 0.5 - 16;
        ctx.fillStyle = '#050D08';
        ctx.fillRect(-barW * 0.5, barY, barW, 8);
        ctx.fillStyle = doorCol;
        ctx.fillRect(-barW * 0.5 + 1, barY + 1, (barW - 2) * hpRatio, 6);

        ctx.font = font('data', doorFontPx);
        ctx.fillStyle = doorCol === '#FF3318' ? THEME.ALERT_RED_TEXT : doorCol;
        ctx.textAlign = 'center';
        ctx.fillText(`${ds.def.id} [${Math.round(hpRatio * 100)}%]`, 0, barY - 6);
      } else {
        // Open Doorway Pocket Threshold
        const pulse = highlightWeld ? 0.55 + 0.45 * Math.sin(timeSec * 8) : 0.45;
        ctx.strokeStyle = isSelected
          ? '#FFFFFF'
          : highlightWeld
            ? `rgba(255, 176, 0, ${pulse.toFixed(2)})`
            : 'rgba(59, 224, 104, 0.45)';
        ctx.lineWidth = highlightWeld || isSelected ? 2.6 : 1.6;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(-w * 0.5, -h * 0.5, w, h);
        ctx.setLineDash([]);

        ctx.font = font('data', doorFontPx);
        ctx.fillStyle = highlightWeld ? THEME.ACCENT_AMBER : THEME.TEXT_SECONDARY;
        ctx.textAlign = 'center';
        ctx.fillText(highlightWeld ? `WELD ${ds.def.id}` : ds.def.id, 0, -h * 0.5 - 8);
      }
      ctx.restore();
    }
  }

  private drawReactorCoreObjective(
    ctx: CanvasRenderingContext2D,
    sim: PerimeterSimulation,
    timeSec: number,
    tfScale: number
  ): void {
    const c = sim.blueprint.coreCenter;
    ctx.save();

    // Inner sterile Med-Lab illumination halo (halved during GRID_BROWNOUT mutator!)
    const coreLitR =
      sim.activeMutator === 'GRID_BROWNOUT'
        ? PERIMETER_CONSTANTS.CORE_LIT_RADIUS * 0.5
        : PERIMETER_CONSTANTS.CORE_LIT_RADIUS;
    const grad = ctx.createRadialGradient(c.x, c.y, 12, c.x, c.y, coreLitR);
    grad.addColorStop(0, 'rgba(68, 255, 119, 0.22)');
    grad.addColorStop(1, 'rgba(68, 255, 119, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c.x, c.y, coreLitR, 0, Math.PI * 2);
    ctx.fill();

    // Opaque Reactor Core Armored Bulkhead Ring (clearly signals solid LOS obstruction!)
    ctx.save();
    ctx.fillStyle = 'rgba(4, 22, 12, 0.92)';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 55, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2FD668';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 176, 0, 0.62)';
    ctx.lineWidth = 2.0;
    for (let k = 0; k < 4; k++) {
      const ba = k * (Math.PI * 0.5) + Math.PI * 0.25;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 58, ba - 0.18, ba + 0.18);
      ctx.stroke();
    }
    ctx.restore();

    // Aegis Core Energy Barrier Ring (when AEGIS_SHIELD barrier is charged & ready!)
    if (sim.aegisBarrierReady) {
      const aegisPulse = 0.72 + 0.28 * Math.sin(timeSec * 6.5);
      ctx.save();
      const aGrad = ctx.createRadialGradient(c.x, c.y, 54, c.x, c.y, 70);
      aGrad.addColorStop(0, 'rgba(0, 240, 255, 0.04)');
      aGrad.addColorStop(0.75, `rgba(0, 240, 255, ${(0.22 * aegisPulse).toFixed(3)})`);
      aGrad.addColorStop(1, 'rgba(0, 240, 255, 0)');
      ctx.fillStyle = aGrad;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 70, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(0, 240, 255, ${(0.82 * aegisPulse).toFixed(2)})`;
      ctx.lineWidth = 2.8;
      ctx.setLineDash([14, 7]);
      ctx.lineDashOffset = -timeSec * 26;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 64, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = font('data', this.worldFontPx(12, tfScale, 24));
      ctx.fillStyle = THEME.ACCENT_CYAN;
      ctx.textAlign = 'center';
      const aegisLbl =
        sim.aegisBarrierCharges > 1
          ? `${SEMIOTIC_ICONS.SHIELD} AEGIS ×${sim.aegisBarrierCharges}`
          : `${SEMIOTIC_ICONS.SHIELD} AEGIS READY`;
      ctx.fillText(aegisLbl, c.x, c.y + 84);
      ctx.restore();
    }

    // 3 Concentric Bulkhead Seal Rings (visualizing the 3 Core Seals / Lives!)
    for (let s = 0; s < PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS; s++) {
      const r = 28 + s * 11;
      const intact = s < sim.bulkheadSeals;
      ctx.strokeStyle = intact
        ? sim.bulkheadSeals === 1
          ? '#FFB000'
          : '#44FF77'
        : 'rgba(255, 51, 24, 0.28)';
      ctx.lineWidth = intact ? 2.6 : 1.2;
      if (!intact) ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Rotating Reactor Turbine Crosshair
    ctx.translate(c.x, c.y);
    ctx.rotate(timeSec * 0.7);
    ctx.strokeStyle = '#FFB000';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(18, 0);
    ctx.moveTo(0, -18);
    ctx.lineTo(0, 18);
    ctx.stroke();

    ctx.fillStyle = sim.sealLostFlashTimer > 0 ? '#FF3318' : '#44FF77';
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawPlacedTurrets(
    ctx: CanvasRenderingContext2D,
    rc: BlueprintRenderContext,
    tfScale: number
  ): void {
    const { sim, selectedTurretId, timeSec } = rc;
    const tierFontPx = this.worldFontPx(12, tfScale, 22);

    for (const t of sim.turrets) {
      const isSelected = t.id === selectedTurretId;
      const isLowAmmo =
        t.powered && t.kind === 'SENTRY_PULSE' && t.ammo > 0 && t.ammo <= Math.ceil(t.maxAmmo * 0.25);
      const isDry = t.powered && t.kind === 'SENTRY_PULSE' && t.ammo <= 0;
      ctx.save();
      ctx.translate(t.pos.x, t.pos.y);

      if (isSelected) {
        ctx.strokeStyle = '#FFB000';
        ctx.lineWidth = 2.2;
        ctx.strokeRect(-25, -25, 50, 50);
      }

      // Sweeping Radial Capacitor Spin-Up Arc when toggled ON mid-wave (2.5s powerUpTimer)!
      if (t.powered && t.powerUpTimer > 0) {
        const spinProg = Math.max(
          0,
          Math.min(1, 1 - t.powerUpTimer / PERIMETER_CONSTANTS.TURRET_POWER_SPINUP_SEC)
        );
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
        ctx.lineWidth = 4.0;
        ctx.beginPath();
        ctx.arc(0, 0, 27, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#00F0FF';
        ctx.lineWidth = 4.0;
        ctx.beginPath();
        ctx.arc(0, 0, 27, -Math.PI * 0.5, -Math.PI * 0.5 + spinProg * Math.PI * 2);
        ctx.stroke();
      } else if (t.rearmTimer > 0) {
        // Sweeping Radial Reload Progress Arc when Sentry is running its belt-feed cycle!
        const prog = Math.max(
          0,
          Math.min(1, 1 - t.rearmTimer / Math.max(0.1, t.rearmDuration))
        );
        ctx.strokeStyle = 'rgba(255, 176, 0, 0.30)';
        ctx.lineWidth = 4.2;
        ctx.beginPath();
        ctx.arc(0, 0, 27, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#FFB000';
        ctx.lineWidth = 4.2;
        ctx.beginPath();
        ctx.arc(0, 0, 27, -Math.PI * 0.5, -Math.PI * 0.5 + prog * Math.PI * 2);
        ctx.stroke();
      } else if (isDry && Math.sin(timeSec * 16) > -0.1) {
        // Only critical DRY state strobes red; LOW AMMO uses steady amber diamond!
        ctx.strokeStyle = THEME.ALERT_RED_STROKE;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(0, -28);
        ctx.lineTo(28, 0);
        ctx.lineTo(0, 28);
        ctx.lineTo(-28, 0);
        ctx.closePath();
        ctx.stroke();
      } else if (isLowAmmo) {
        ctx.strokeStyle = THEME.ACCENT_AMBER;
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.moveTo(0, -28);
        ctx.lineTo(28, 0);
        ctx.lineTo(0, 28);
        ctx.lineTo(-28, 0);
        ctx.closePath();
        ctx.stroke();
      }

      const mainCol =
        !t.powered || sim.blackoutTimer > 0
          ? '#355E43'
          : t.rearmTimer > 0
            ? '#FFB000'
            : t.thermalLocked || (t.kind === 'SENTRY_PULSE' && t.ammo <= 0)
              ? '#FF3318'
              : t.overclockTimer > 0
                ? '#FFD266'
                : t.kind === 'INCINERATOR'
                  ? '#FFB000'
                  : t.kind === 'RAIL_LANCE' || t.kind === 'SHOCK_COIL'
                    ? '#00F0FF'
                    : '#44FF77';

      if (t.kind === 'CRYO_VALVE') {
        // Octagonal Duct Valve Assembly
        ctx.fillStyle = '#05150C';
        ctx.strokeStyle = mainCol;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
          const px = Math.cos(a) * 16;
          const py = Math.sin(a) * 16;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.rotate(t.powered ? timeSec * 1.6 : 0);
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.lineTo(10, 0);
        ctx.moveTo(0, -10);
        ctx.lineTo(0, 10);
        ctx.stroke();
      } else if (t.kind === 'SHOCK_COIL') {
        // Concentric Tesla Arc-Shock Coil Tower
        ctx.fillStyle = '#041418';
        ctx.strokeStyle = mainCol;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = t.powered ? '#9BF8FF' : '#2D5E66';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, 10, 0, Math.PI * 2);
        ctx.stroke();

        ctx.rotate(t.powered ? timeSec * 4.5 : 0);
        ctx.strokeStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.moveTo(-13, 0);
        ctx.lineTo(-7, 0);
        ctx.moveTo(7, 0);
        ctx.lineTo(13, 0);
        ctx.moveTo(0, -13);
        ctx.lineTo(0, -7);
        ctx.moveTo(0, 7);
        ctx.lineTo(0, 13);
        ctx.stroke();

        ctx.fillStyle = t.powered ? '#00F0FF' : '#2D5E66';
        ctx.beginPath();
        ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (t.kind === 'MOTION_RELAY') {
        // M314 Dish & Laser Emitter Node
        ctx.fillStyle = '#05150C';
        ctx.strokeStyle = mainCol;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, 0, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.rotate(t.powered ? timeSec * 2.8 : 0);
        ctx.strokeStyle = t.jammedTimer > 0 ? '#E066FF' : '#FFB000';
        ctx.beginPath();
        ctx.arc(0, 0, 9, -0.8, 0.8);
        ctx.stroke();
      } else {
        // UA 571-C Sentry, M240 Incinerator, or M99 Rail-Lance Tripod Base + Rotating Receiver/Barrel!
        ctx.strokeStyle = THEME.TEXT_SECONDARY;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(-14, -12);
        ctx.lineTo(0, 0);
        ctx.lineTo(-14, 12);
        ctx.moveTo(12, 0);
        ctx.lineTo(0, 0);
        ctx.stroke();

        ctx.rotate(t.angle);
        ctx.fillStyle = '#06180D';
        ctx.strokeStyle = mainCol;
        ctx.lineWidth = 2.4;

        // Receiver & Ammo Drum
        ctx.fillRect(-11, -9, 20, 18);
        ctx.strokeRect(-11, -9, 20, 18);

        // Barrel Assembly
        if (t.kind === 'SENTRY_PULSE') {
          ctx.beginPath();
          ctx.moveTo(9, -2.5);
          ctx.lineTo(23, -2.5);
          ctx.lineTo(23, 2.5);
          ctx.lineTo(9, 2.5);
          ctx.stroke();
        } else if (t.kind === 'RAIL_LANCE') {
          ctx.strokeStyle = mainCol;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(9, -5.5);
          ctx.lineTo(29, -3.5);
          ctx.moveTo(9, 5.5);
          ctx.lineTo(29, 3.5);
          ctx.stroke();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(13, -4);
          ctx.lineTo(13, 4);
          ctx.moveTo(20, -3.5);
          ctx.lineTo(20, 3.5);
          ctx.stroke();
        } else {
          // Twin wide nozzle + pilot igniter for M240 Incinerator
          ctx.fillRect(9, -5, 13, 10);
          ctx.strokeRect(9, -5, 13, 10);
        }

        // Muzzle flash star
        if (t.firingFlashTimer > 0) {
          ctx.fillStyle = t.kind === 'RAIL_LANCE' ? '#B6FFFF' : '#FFF6CC';
          ctx.beginPath();
          ctx.arc(t.kind === 'RAIL_LANCE' ? 30 : 25, 0, t.kind === 'RAIL_LANCE' ? 7 : 5.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (t.acidDebuffTimer > 0) {
        ctx.restore();
        ctx.save();
        ctx.translate(t.pos.x, t.pos.y);
        ctx.strokeStyle = '#B8FF3B';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (t.jammedTimer > 0) {
        ctx.restore();
        ctx.save();
        ctx.translate(t.pos.x, t.pos.y);
        ctx.strokeStyle = '#E066FF';
        ctx.lineWidth = 2.0;
        ctx.strokeRect(-22, -22, 44, 44);
      }

      if (t.level >= 2) {
        ctx.restore();
        ctx.save();
        ctx.translate(t.pos.x, t.pos.y);
        const mk4 = t.mk4Level ?? 0;
        ctx.fillStyle = mk4 > 0 ? THEME.ACCENT_AMBER_HI : t.level === 3 ? THEME.ACCENT_CYAN : THEME.ACCENT_AMBER;
        ctx.font = font('data', tierFontPx);
        ctx.textAlign = 'right';
        ctx.fillText(
          t.level === 3 ? (mk4 > 0 ? `IV+${mk4}` : `III${t.mk3Branch ?? ''}`) : 'II',
          26,
          24
        );

        // MK-IV Refit stacked chevron pips along upper-right mount corner (1..3)
        if (mk4 > 0) {
          ctx.strokeStyle = '#FFE066';
          ctx.lineWidth = 2.0;
          for (let p = 0; p < Math.min(3, mk4); p++) {
            const py = -12 - p * 5;
            ctx.beginPath();
            ctx.moveTo(13, py + 3);
            ctx.lineTo(18, py - 2);
            ctx.lineTo(23, py + 3);
            ctx.stroke();
          }
        }
      }

      ctx.restore();
    }
  }

  private drawMotionSweepWaves(ctx: CanvasRenderingContext2D, sim: PerimeterSimulation): void {
    for (const w of sim.motionWaves) {
      const prog = w.radius / Math.max(1, w.maxRadius);
      const alpha = (1 - prog) * (w.fromM314 ? 0.72 : 0.42);
      ctx.save();
      ctx.strokeStyle = w.fromM314
        ? `rgba(110, 255, 160, ${alpha.toFixed(3)})`
        : `rgba(68, 255, 119, ${alpha.toFixed(3)})`;
      ctx.lineWidth = w.fromM314 ? 2.4 : 1.8;
      ctx.beginPath();
      ctx.arc(w.origin.x, w.origin.y, w.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Enforces visual Fog-of-Motion:
   * - Unverified dark corridor contacts ONLY appear when swept (`blipTimer > 0`) as fuzzy,
   *   jittering white/green range-gated radar blips with live distance tags (`14.2m`).
   * - Verified targets (`h.verified`) render as sharp, menacing geometric vector bio-silhouettes!
   */
  private drawHostilesAndBlips(
    ctx: CanvasRenderingContext2D,
    sim: PerimeterSimulation,
    timeSec: number,
    tfScale: number
  ): void {
    const blipFontPx = this.worldFontPx(12, tfScale, 24);
    // Screamer radar-jamming phantom decoys
    for (const pb of sim.phantomBlips) {
      const alpha = Math.max(0, Math.min(1, pb.life / Math.max(0.1, pb.maxLife)));
      const jx = pb.pos.x + (Math.random() - 0.5) * 6;
      const jy = pb.pos.y + (Math.random() - 0.5) * 6;
      ctx.save();
      ctx.strokeStyle = `rgba(224, 102, 255, ${(0.75 * alpha).toFixed(2)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(jx, jy, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = font('data', blipFontPx);
      ctx.fillStyle = `rgba(224, 102, 255, ${(0.85 * alpha).toFixed(2)})`;
      ctx.fillText('ERR?', jx + 12, jy + 5);
      ctx.restore();
    }

    for (const h of sim.hostiles) {
      if (h.verified) {
        this.drawVerifiedBioSilhouette(ctx, h, timeSec);
      } else if (h.blipTimer > 0) {
        this.drawFuzzyRadarBlip(ctx, h, blipFontPx);
      }
    }
  }

  private drawFuzzyRadarBlip(
    ctx: CanvasRenderingContext2D,
    h: HostileEntity,
    blipFontPx: number
  ): void {
    const alpha = Math.min(1, h.blipTimer / 0.85);
    const jx = h.blipPos.x + (Math.random() - 0.5) * 4.5;
    const jy = h.blipPos.y + (Math.random() - 0.5) * 4.5;

    ctx.save();
    // Fuzzy white/green range-gated CRT phosphor cluster
    const glow = ctx.createRadialGradient(jx, jy, 1, jx, jy, 15);
    glow.addColorStop(0, `rgba(235, 255, 242, ${(0.92 * alpha).toFixed(2)})`);
    glow.addColorStop(0.45, `rgba(68, 255, 119, ${(0.55 * alpha).toFixed(2)})`);
    glow.addColorStop(1, 'rgba(68, 255, 119, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(jx, jy, 15, 0, Math.PI * 2);
    ctx.fill();

    // Range-gate arc bracket
    ctx.strokeStyle = `rgba(220, 255, 230, ${(0.85 * alpha).toFixed(2)})`;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.arc(jx, jy, 7, -0.9, 0.9);
    ctx.moveTo(jx - 5, jy);
    ctx.lineTo(jx + 5, jy);
    ctx.stroke();

    // Zoom-Compensated Live Distance Tag (`14.2m`)
    ctx.font = font('data', blipFontPx);
    ctx.fillStyle = `rgba(180, 255, 200, ${(0.92 * alpha).toFixed(2)})`;
    ctx.textAlign = 'left';
    ctx.fillText(`${h.blipDistM.toFixed(1).padStart(4, '0')}m`, jx + 12, jy + 5);
    ctx.restore();
  }

  private drawVerifiedBioSilhouette(
    ctx: CanvasRenderingContext2D,
    h: HostileEntity,
    timeSec: number
  ): void {
    ctx.save();
    ctx.translate(h.pos.x, h.pos.y);

    // Sensor Lock Brackets if tagged by Tripwire or Stalker exposed
    if (h.tripwireTagTimer > 0 || h.kind === 'STALKER') {
      const br = h.radiusPx + 6;
      ctx.strokeStyle = h.kind === 'STALKER' ? '#8EF5AB' : '#FFB000';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(-br, -br, br * 2, br * 2);
    }

    // Crackling Electric Stagger / Stun Halo Ring so Capacitor Rail, Arc Coil & Purge stuns pop clearly!
    if (h.stunTimer > 0) {
      const sr = h.radiusPx + 7 + Math.sin(timeSec * 36 + h.id) * 2;
      ctx.save();
      ctx.strokeStyle = '#00F0FF';
      ctx.lineWidth = h.isBoss ? 2.4 : 1.7;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, sr, timeSec * 7, timeSec * 7 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // 4 crisp crackling shock ticks around stunned silhouette
      ctx.strokeStyle = '#B8FFFF';
      ctx.lineWidth = 1.6;
      for (let k = 0; k < 4; k++) {
        const a = timeSec * 9 + k * (Math.PI * 0.5) + h.id;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (sr - 3), Math.sin(a) * (sr - 3));
        ctx.lineTo(Math.cos(a + 0.14) * (sr + 5), Math.sin(a + 0.14) * (sr + 5));
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.rotate(h.heading);

    const chilled = h.cryoSlowTimer > 0;
    const burning = h.napalmBurnTimer > 0;
    const stunned = h.stunTimer > 0;
    const strokeCol = stunned
      ? '#00F0FF'
      : burning
        ? '#FFB000'
        : chilled
          ? '#9BF8FF'
          : h.kind === 'QUEEN'
            ? '#FF3355'
            : h.kind === 'CRUSHER'
              ? '#FF7722'
              : h.kind === 'SPITTER'
                ? '#B8FF3B'
                : h.kind === 'SCREAMER'
                  ? '#E066FF'
                  : h.kind === 'BURSTER'
                    ? '#C8FF44'
                    : h.kind === 'PRAETORIAN'
                      ? '#FF8C24'
                      : h.kind === 'STALKER'
                        ? '#B6FFE0'
                        : '#44FF77';

    ctx.strokeStyle = strokeCol;
    ctx.fillStyle = 'rgba(6, 22, 12, 0.88)';
    ctx.lineWidth =
      h.kind === 'QUEEN' ? 3.4 : h.kind === 'CRUSHER' || h.kind === 'PRAETORIAN' ? 2.8 : 2.1;

    if (h.kind === 'SKITTERER') {
      // Erratic arachnid dart + 6 legs + whip tail
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-4, -6);
      ctx.lineTo(-8, 0);
      ctx.lineTo(-4, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const legWig = Math.sin(timeSec * 28 + h.id) * 3;
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(-17, legWig);
      for (const lx of [-3, 1, 5]) {
        ctx.moveTo(lx, -4);
        ctx.lineTo(lx - 2, -10 + legWig * 0.4);
        ctx.moveTo(lx, 4);
        ctx.lineTo(lx - 2, 10 - legWig * 0.4);
      }
      ctx.stroke();
    } else if (h.kind === 'DRONE') {
      // Iconic biomechanical elongated skull + twin strike claws + segmented tail
      const tailSway = Math.sin(timeSec * 14 + h.id) * 5;
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(5, -7);
      ctx.lineTo(-11, -5);
      ctx.lineTo(-14, 0);
      ctx.lineTo(-11, 5);
      ctx.lineTo(5, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Claws + Whip Tail
      ctx.beginPath();
      ctx.moveTo(6, -7);
      ctx.lineTo(14, -12);
      ctx.moveTo(6, 7);
      ctx.lineTo(14, 12);
      ctx.moveTo(-14, 0);
      ctx.lineTo(-24, tailSway);
      ctx.stroke();
    } else if (h.kind === 'PRAETORIAN') {
      // Heavy Armored Crusher with thick directional Frontal Carapace Crest!
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(8, -17);
      ctx.lineTo(-14, -13);
      ctx.lineTo(-20, 0);
      ctx.lineTo(-14, 13);
      ctx.lineTo(8, 17);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Thick Frontal Deflector Carapace Shield Arc
      ctx.strokeStyle = '#FFD266';
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.arc(3, 0, 18, -1.05, 1.05);
      ctx.stroke();
    } else if (h.kind === 'BURSTER') {
      // Unstable Pressurized Acid Burster Sac
      const pulseR = 12 + Math.sin(timeSec * 16 + h.id) * 2.2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const px = Math.cos(a) * pulseR;
        const py = Math.sin(a) * pulseR;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#D4FF44';
      ctx.beginPath();
      ctx.arc(-2, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (h.kind === 'SPITTER') {
      // Acid Spitter: Bloated venomous rear sac + wide forward mandibles
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(5, -7);
      ctx.lineTo(-13, -11);
      ctx.lineTo(-17, 0);
      ctx.lineTo(-13, 11);
      ctx.lineTo(5, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#B8FF3B';
      ctx.beginPath();
      ctx.arc(-6, 0, 5.5 + Math.sin(timeSec * 12 + h.id) * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(8, -5);
      ctx.lineTo(18, -10);
      ctx.moveTo(8, 5);
      ctx.lineTo(18, 10);
      ctx.stroke();
    } else if (h.kind === 'SCREAMER') {
      // Bio-Screamer Jammer: Angular violet acoustic crest + pulsing sonic ripples
      const ringR = 14 + ((timeSec * 28 + h.id * 5) % 16);
      ctx.save();
      ctx.strokeStyle = 'rgba(224, 102, 255, 0.52)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(4, -12);
      ctx.lineTo(-14, -7);
      ctx.lineTo(-10, 0);
      ctx.lineTo(-14, 7);
      ctx.lineTo(4, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (h.kind === 'CRUSHER') {
      // Juggernaut Crusher Mini-Boss: Massive armored battering ram + fiery charge aura!
      if (h.chargeTelegraphTimer > 0 || h.chargeActiveTimer > 0) {
        ctx.save();
        ctx.strokeStyle = h.chargeActiveTimer > 0 ? '#FF3318' : '#FFB000';
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.arc(0, 0, 31 + Math.sin(timeSec * 24) * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.moveTo(25, 0);
      ctx.lineTo(14, -22);
      ctx.lineTo(-16, -18);
      ctx.lineTo(-24, 0);
      ctx.lineTo(-16, 18);
      ctx.lineTo(14, 22);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#FFD266';
      ctx.lineWidth = 5.0;
      ctx.beginPath();
      ctx.arc(4, 0, 23, -1.15, 1.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(14, -14);
      ctx.lineTo(30, -9);
      ctx.moveTo(14, 14);
      ctx.lineTo(30, 9);
      ctx.stroke();
    } else if (h.kind === 'QUEEN') {
      // Xeno Matriarch Queen Boss: Splayed Royal Crown Crest + Mantis Scythes + Whip Tail!
      const tailW = Math.sin(timeSec * 9 + h.id) * 10;
      ctx.fillStyle = 'rgba(38, 6, 12, 0.92)';
      ctx.beginPath();
      ctx.moveTo(30, 0);
      ctx.lineTo(10, -14);
      ctx.lineTo(-4, -29);
      ctx.lineTo(-22, -20);
      ctx.lineTo(-16, -8);
      ctx.lineTo(-26, 0);
      ctx.lineTo(-16, 8);
      ctx.lineTo(-22, 20);
      ctx.lineTo(-4, 29);
      ctx.lineTo(10, 14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#FFD266';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(12, -11);
      ctx.lineTo(28, -22);
      ctx.moveTo(12, 11);
      ctx.lineTo(28, 22);
      ctx.moveTo(-26, 0);
      ctx.quadraticCurveTo(-38, tailW, -48, -tailW * 0.6);
      ctx.stroke();
    } else {
      // Signal Stalker: Angular Stealth Mantis with razor scythes
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(0, -10);
      ctx.lineTo(-13, 0);
      ctx.lineTo(0, 10);
      ctx.closePath();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(4, -7);
      ctx.lineTo(18, -13);
      ctx.moveTo(4, 7);
      ctx.lineTo(18, 13);
      ctx.stroke();
    }

    if (stunned) {
      ctx.strokeStyle = '#9BF8FF';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, h.radiusPx + 5, timeSec * 12, timeSec * 12 + Math.PI * 1.2);
      ctx.stroke();
    }

    ctx.restore();

    // Compact HP bar for wounded medium/heavy/boss targets
    if ((h.hp < h.maxHp && h.kind !== 'SKITTERER') || h.isBoss) {
      const bw =
        h.kind === 'QUEEN'
          ? 58
          : h.kind === 'CRUSHER'
            ? 48
            : h.kind === 'PRAETORIAN'
              ? 40
              : 26;
      const bx = h.pos.x - bw * 0.5;
      const by = h.pos.y - h.radiusPx - 11;
      ctx.fillStyle = '#050E08';
      ctx.fillRect(bx, by, bw, 5);
      ctx.fillStyle =
        h.kind === 'QUEEN'
          ? '#FF3355'
          : h.kind === 'CRUSHER' || h.kind === 'PRAETORIAN'
            ? '#FFB000'
            : '#44FF77';
      ctx.fillRect(bx, by, bw * Math.max(0, h.hp / h.maxHp), 5);
    }
  }

  private drawProjectilesAndCallouts(
    ctx: CanvasRenderingContext2D,
    sim: PerimeterSimulation,
    tfScale: number
  ): void {
    // M99 Rail-Lance Piercing Electromagnetic Plasma Beams
    for (const rb of sim.railBeams) {
      const alpha = Math.max(0, rb.life / Math.max(0.05, rb.maxLife));
      ctx.save();
      ctx.strokeStyle = `rgba(0, 240, 255, ${(0.55 * alpha).toFixed(2)})`;
      ctx.lineWidth = rb.tier === 3 ? 11 : rb.tier === 2 ? 8.5 : 7;
      ctx.beginPath();
      ctx.moveTo(rb.p1.x, rb.p1.y);
      ctx.lineTo(rb.p2.x, rb.p2.y);
      ctx.stroke();

      ctx.strokeStyle = `rgba(235, 255, 255, ${(0.95 * alpha).toFixed(2)})`;
      ctx.lineWidth = rb.tier === 3 ? 4.2 : 2.8;
      ctx.beginPath();
      ctx.moveTo(rb.p1.x, rb.p1.y);
      ctx.lineTo(rb.p2.x, rb.p2.y);
      ctx.stroke();
      ctx.restore();
    }

    // Arc-Shock Coil Chain Lightning Bolts
    for (const sa of sim.shockArcs) {
      const alpha = Math.max(0, sa.life / Math.max(0.05, sa.maxLife));
      if (sa.points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = `rgba(0, 240, 255, ${(0.88 * alpha).toFixed(2)})`;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      for (let i = 0; i < sa.points.length; i++) {
        const pt = sa.points[i];
        const jx = i === 0 || i === sa.points.length - 1 ? 0 : (Math.random() - 0.5) * 10;
        const jy = i === 0 || i === sa.points.length - 1 ? 0 : (Math.random() - 0.5) * 10;
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x + jx, pt.y + jy);
      }
      ctx.stroke();
      ctx.strokeStyle = `rgba(235, 255, 255, ${(0.9 * alpha).toFixed(2)})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    }

    // Spitter Corrosive Acid Spit Globs
    for (const spit of sim.acidSpits) {
      ctx.save();
      ctx.fillStyle = '#C8FF44';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(spit.pos.x, spit.pos.y, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Caseless 10mm Vector Tracer Bolts
    for (const tr of sim.tracers) {
      const alpha = Math.max(0.2, tr.life / tr.maxLife);
      ctx.save();
      ctx.strokeStyle = tr.ricochet
        ? `rgba(255, 176, 0, ${alpha.toFixed(2)})`
        : tr.overclocked
          ? `rgba(255, 240, 170, ${alpha.toFixed(2)})`
          : `rgba(180, 255, 200, ${alpha.toFixed(2)})`;
      ctx.lineWidth = tr.overclocked ? 3.0 : 2.3;
      ctx.beginPath();
      ctx.moveTo(tr.p1.x, tr.p1.y);
      ctx.lineTo(tr.p2.x, tr.p2.y);
      ctx.stroke();
      ctx.restore();
    }

    // Vector Sparks
    for (const sp of sim.sparks) {
      const alpha = Math.max(0, sp.life / sp.maxLife);
      ctx.save();
      ctx.strokeStyle = sp.color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(sp.pos.x, sp.pos.y);
      ctx.lineTo(sp.pos.x - sp.vel.x * 0.045, sp.pos.y - sp.vel.y * 0.045);
      ctx.stroke();
      ctx.restore();
    }

    // Zoom-Compensated Floating Micro-Callouts (`RICOCHET`, `PURGE FLUSH`, `BREACHED!`)
    const calloutPx = this.worldFontPx(12, tfScale, 28);
    for (const c of sim.callouts) {
      const alpha = Math.min(1, (c.life / c.maxLife) * 1.4);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = font('head', calloutPx);
      ctx.fillStyle = c.color;
      ctx.textAlign = 'center';
      ctx.fillText(c.text, c.pos.x, c.pos.y);
      ctx.restore();
    }
  }

  /**
   * Zoom-Compensated Screen-Legible Diegetic Turret Tags:
   * - `tagScale` cap raised 1.65 -> 2.2 guaranteeing >=12px effective screen text at 1.0x zoom!
   * - Calm-Mode: during WAVE_ACTIVE, nominal unselected/unhovered turrets compact to `A1 320`
   *   and expand to full informative pills on hover, selection, Prep, or ANY alert!
   * - LOW AMMO uses steady amber (only DRY / THERM LOCK / BLACKOUT strobe red).
   */
  private drawDiegeticTurretTags(
    ctx: CanvasRenderingContext2D,
    rc: BlueprintRenderContext,
    tfScale: number
  ): void {
    const { sim, timeSec, selectedTurretId, hoveredTurretId } = rc;
    const blinkFast = Math.sin(timeSec * 14) > -0.15;
    const tagScale = Math.max(1.0, Math.min(2.2, 0.98 / Math.max(0.32, tfScale)));

    for (const t of sim.turrets) {
      const isSelected = t.id === selectedTurretId;
      const isHovered = Boolean(hoveredTurretId && t.id === hoveredTurretId);
      const lowThresh = Math.ceil(t.maxAmmo * 0.25);
      const isLowAmmo = t.powered && t.kind === 'SENTRY_PULSE' && t.rearmTimer <= 0 && t.ammo > 0 && t.ammo <= lowThresh;
      const isDry = t.powered && t.kind === 'SENTRY_PULSE' && t.rearmTimer <= 0 && t.ammo <= 0;

      const hasAlert =
        (sim.blackoutTimer > 0 && t.powered) ||
        !t.powered ||
        t.powerUpTimer > 0 ||
        t.rearmTimer > 0 ||
        t.thermalLocked ||
        isDry ||
        isLowAmmo ||
        t.acidDebuffTimer > 0 ||
        t.jammedTimer > 0 ||
        (t.kind === 'MOTION_RELAY' && t.tripwireIntegrity < 50);

      const useCompact = sim.phase === 'WAVE_ACTIVE' && !hasAlert && !isSelected && !isHovered;

      let label = '';
      let textCol: string = THEME.TEXT_PRIMARY;
      let borderCol = 'rgba(68, 255, 119, 0.65)';
      let bgFill = 'rgba(3, 10, 6, 0.92)';

      if (sim.blackoutTimer > 0 && t.powered) {
        label = `⚡ ${t.callsign} // BLACKOUT`;
        textCol = THEME.ALERT_RED_TEXT;
        borderCol = THEME.ALERT_RED_STROKE;
        bgFill = 'rgba(42, 8, 6, 0.94)';
      } else if (!t.powered) {
        label = `${t.callsign} // OFFLINE`;
        textCol = THEME.TEXT_SECONDARY;
        borderCol = THEME.BORDER_SUBTLE;
      } else if (t.powerUpTimer > 0) {
        label = `⚡ ${t.callsign} // SPINUP ${t.powerUpTimer.toFixed(1)}S`;
        textCol = THEME.ACCENT_CYAN;
        borderCol = THEME.ACCENT_CYAN;
        bgFill = 'rgba(4, 28, 34, 0.94)';
      } else if (t.rearmTimer > 0) {
        label = `⟳ ${t.callsign} // RELOAD ${t.rearmTimer.toFixed(1)}S`;
        textCol = THEME.INK_INVERSE;
        borderCol = THEME.ACCENT_AMBER_HI;
        bgFill = THEME.ACCENT_AMBER;
      } else if (t.thermalLocked) {
        label = blinkFast ? `⚠ ${t.callsign} // THERM LOCK` : `${t.callsign} // COOLING`;
        textCol = blinkFast ? THEME.INK_INVERSE : THEME.ALERT_RED_TEXT;
        borderCol = THEME.ALERT_RED_STROKE;
        bgFill = blinkFast ? THEME.ALERT_RED_STROKE : 'rgba(42, 8, 6, 0.92)';
      } else if (useCompact) {
        const shortId = t.callsign.replace('-0', '');
        if (t.kind === 'SENTRY_PULSE') {
          label = `${shortId} ${String(t.ammo).padStart(3, '0')}`;
          textCol = t.firingFlashTimer > 0 ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT;
          borderCol = t.firingFlashTimer > 0 ? THEME.ACCENT_AMBER : 'rgba(68, 255, 119, 0.45)';
        } else if (t.kind === 'INCINERATOR') {
          label = `${shortId} ${Math.round(t.heat)}%`;
          textCol = THEME.ACCENT_AMBER_HI;
          borderCol = 'rgba(255, 176, 0, 0.48)';
        } else if (t.kind === 'RAIL_LANCE') {
          label = `${SEMIOTIC_ICONS.DIAMOND} ${shortId}`;
          textCol = THEME.ACCENT_CYAN;
          borderCol = 'rgba(76, 238, 255, 0.48)';
        } else if (t.kind === 'CRYO_VALVE') {
          label = `${shortId} LN2`;
          textCol = THEME.TEXT_BRIGHT;
          borderCol = 'rgba(68, 255, 119, 0.42)';
        } else if (t.kind === 'SHOCK_COIL') {
          label = `${SEMIOTIC_ICONS.HEX} ${shortId}`;
          textCol = THEME.ACCENT_CYAN;
          borderCol = 'rgba(76, 238, 255, 0.48)';
        } else {
          label = shortId;
          textCol = THEME.TEXT_PRIMARY;
          borderCol = 'rgba(68, 255, 119, 0.42)';
        }
        bgFill = 'rgba(3, 10, 6, 0.84)';
      } else if (t.kind === 'SENTRY_PULSE') {
        if (isDry) {
          label = `⚠ ${t.callsign} // 000 DRY`;
          textCol = blinkFast ? THEME.INK_INVERSE : THEME.ALERT_RED_TEXT;
          borderCol = THEME.ALERT_RED_STROKE;
          bgFill = blinkFast ? THEME.ALERT_RED_STROKE : 'rgba(45, 8, 6, 0.94)';
        } else if (isLowAmmo) {
          // Steady Amber for LOW AMMO (never strobes red!)
          const rdsStr = String(t.ammo).padStart(3, '0');
          label = `▲ ${t.callsign} // LOW ${rdsStr}`;
          textCol = THEME.ACCENT_AMBER_HI;
          borderCol = THEME.ACCENT_AMBER;
          bgFill = 'rgba(48, 28, 4, 0.94)';
        } else {
          const rdsStr = String(t.ammo).padStart(3, '0');
          label = `${t.callsign} // ${rdsStr} RDS`;
          textCol = t.firingFlashTimer > 0 ? THEME.ACCENT_AMBER : THEME.TEXT_PRIMARY;
          borderCol = t.firingFlashTimer > 0 ? THEME.ACCENT_AMBER : 'rgba(68, 255, 119, 0.65)';
        }
      } else if (t.kind === 'INCINERATOR') {
        label =
          t.acidDebuffTimer > 0
            ? `⚠ ${t.callsign} // ACID`
            : `${t.callsign} // NAPALM ${Math.round(t.heat)}%`;
        textCol = t.acidDebuffTimer > 0 ? '#B8FF3B' : t.heat > 75 ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER;
        borderCol = t.acidDebuffTimer > 0 ? '#B8FF3B' : 'rgba(255, 176, 0, 0.72)';
      } else if (t.kind === 'RAIL_LANCE') {
        const branchTag =
          t.level === 3 && t.mk3Branch ? ` ${MK3_BRANCH_SPECS.RAIL_LANCE[t.mk3Branch].code}` : '';
        label =
          t.acidDebuffTimer > 0
            ? `⚠ ${t.callsign} // ACID`
            : `${SEMIOTIC_ICONS.DIAMOND} ${t.callsign} // RAIL${branchTag}`;
        textCol = t.acidDebuffTimer > 0 ? '#B8FF3B' : THEME.ACCENT_CYAN;
        borderCol = t.acidDebuffTimer > 0 ? '#B8FF3B' : 'rgba(76, 238, 255, 0.72)';
      } else if (t.kind === 'CRYO_VALVE') {
        label = `${t.callsign} // CRYO`;
        textCol = THEME.TEXT_BRIGHT;
      } else if (t.kind === 'SHOCK_COIL') {
        label = `${SEMIOTIC_ICONS.HEX} ${t.callsign} // COIL`;
        textCol = THEME.ACCENT_CYAN;
        borderCol = 'rgba(76, 238, 255, 0.65)';
      } else {
        label =
          t.jammedTimer > 0
            ? `⚠ ${t.callsign} // JAMMED`
            : t.tripwireIntegrity < 50
              ? `${t.callsign} // WIRE DMG`
              : `${t.callsign} // M314`;
        textCol =
          t.jammedTimer > 0 ? '#E066FF' : t.tripwireIntegrity < 50 ? THEME.ACCENT_AMBER : THEME.TEXT_PRIMARY;
      }

      ctx.save();
      ctx.translate(t.pos.x, t.pos.y - 34);
      ctx.scale(tagScale, tagScale);
      ctx.font = font('data', 13);
      const tw = ctx.measureText(label).width + (useCompact ? 10 : 12);
      const th = 19;
      const bx = -tw * 0.5;
      const by = -th;

      ctx.fillStyle = bgFill;
      ctx.fillRect(bx, by, tw, th);
      ctx.strokeStyle = isSelected ? THEME.ACCENT_AMBER_HI : borderCol;
      ctx.lineWidth = isSelected ? 1.8 : 1.4;
      ctx.strokeRect(bx, by, tw, th);

      ctx.fillStyle = textCol;
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, by + 13.5);

      // Barrel Thermal Micro-Bar for combat turrets
      if (
        t.powered &&
        (t.kind === 'SENTRY_PULSE' || t.kind === 'INCINERATOR' || t.kind === 'RAIL_LANCE') &&
        t.heat > 2
      ) {
        ctx.fillStyle = '#102418';
        ctx.fillRect(bx, by + th + 1, tw, 3.5);
        ctx.fillStyle = t.heat > 80 ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
        ctx.fillRect(bx, by + th + 1, (tw * t.heat) / 100, 3.5);
      }
      ctx.restore();
    }
  }

  private drawInteractiveCursorPreview(
    ctx: CanvasRenderingContext2D,
    rc: BlueprintRenderContext,
    tfScale: number
  ): void {
    const { sim, activeTool, cursorVirtual, dragBuildAnchor } = rc;
    if (!cursorVirtual && !dragBuildAnchor) return;

    const ts = sim.blueprint.tileSize;

    // 1. Rotate-Existing-Turret Aiming Line
    if (activeTool.kind === 'ROTATE_TURRET' && cursorVirtual) {
      const t = sim.turrets.find((u) => u.id === activeTool.turretId);
      if (t) {
        const spec = HARDWARE_SPECS[t.kind];
        const ang = Math.atan2(cursorVirtual.y - t.pos.y, cursorVirtual.x - t.pos.x);
        const r = Math.max(160, spec.rangePx);
        ctx.save();
        ctx.strokeStyle = '#FFB000';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([7, 5]);
        ctx.beginPath();
        ctx.moveTo(t.pos.x, t.pos.y);
        const aimHit = sim.castSightRay(t.pos, ang, r);
        ctx.lineTo(aimHit.x, aimHit.y);
        ctx.stroke();
        if (spec.coneHalfAngleRad > 0) {
          ctx.beginPath();
          ctx.moveTo(t.pos.x, t.pos.y);
          for (let s = 0; s <= 20; s++) {
            const ra = ang - spec.coneHalfAngleRad + ((spec.coneHalfAngleRad * 2) * s) / 20;
            const pt = sim.castSightRay(t.pos, ra, r);
            ctx.lineTo(pt.x, pt.y);
          }
          ctx.closePath();
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
      }
      return;
    }

    // 2. Active Command Ability Targeting Reticle
    if (activeTool.kind === 'ABILITY' && cursorVirtual) {
      ctx.save();
      if (activeTool.abilityId === 'FLARE') {
        ctx.strokeStyle = '#FFF0B8';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.arc(
          cursorVirtual.x,
          cursorVirtual.y,
          PERIMETER_CONSTANTS.FLARE_RADIUS_PX,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      } else if (activeTool.abilityId === 'OVERCLOCK') {
        ctx.strokeStyle = '#FFB000';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.arc(
          cursorVirtual.x,
          cursorVirtual.y,
          PERIMETER_CONSTANTS.OVERCLOCK_RADIUS_PX,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      } else if (activeTool.abilityId === 'PURGE') {
        const chamber = sim.findAirlockAt(cursorVirtual);
        if (chamber) {
          ctx.strokeStyle = '#8EF5AB';
          ctx.lineWidth = 3.2;
          ctx.strokeRect(
            chamber.bounds.x,
            chamber.bounds.y,
            chamber.bounds.width,
            chamber.bounds.height
          );
        }
      }
      ctx.setLineDash([]);
      ctx.restore();
      return;
    }

    // 3. Hardware Build Ghost & Drag-to-Aim Cone Preview (with Magnetic Hardpoint Snapping!)
    if (activeTool.kind === 'BUILD') {
      const resolved = dragBuildAnchor
        ? { col: dragBuildAnchor.col, row: dragBuildAnchor.row, snapped: false }
        : sim.resolveMagneticBuildCell(activeTool.buildId, cursorVirtual!);
      const col = resolved.col;
      const row = resolved.row;
      if (col < 0 || col >= sim.blueprint.cols || row < 0 || row >= sim.blueprint.rows) return;

      const check = sim.canPlaceHardwareAt(activeTool.buildId, col, row);
      const cx = col * ts + ts * 0.5;
      const cy = row * ts + ts * 0.5;
      const ang = dragBuildAnchor ? dragBuildAnchor.angle : activeTool.previewAngle;
      const spec = HARDWARE_SPECS[activeTool.buildId];
      const angleGate = rc.tutorialAngleCheck
        ? rc.tutorialAngleCheck(activeTool.buildId, col, row, ang)
        : { enforced: false, valid: true };
      const placementValid = check.ok && (!angleGate.enforced || angleGate.valid);

      ctx.save();
      if (resolved.snapped && placementValid && cursorVirtual) {
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cursorVirtual.x, cursorVirtual.y);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.strokeStyle = placementValid ? (resolved.snapped ? '#00F0FF' : '#44FF77') : '#FF3318';
      ctx.fillStyle = placementValid ? 'rgba(68, 255, 119, 0.16)' : 'rgba(255, 51, 24, 0.20)';
      ctx.lineWidth = 2.4;
      ctx.fillRect(col * ts + 6, row * ts + 6, ts - 12, ts - 12);
      ctx.strokeRect(col * ts + 6, row * ts + 6, ts - 12, ts - 12);

      if (resolved.snapped && placementValid && !dragBuildAnchor) {
        const snapPx = this.worldFontPx(12, tfScale, 24);
        ctx.font = font('data', snapPx);
        ctx.fillStyle = THEME.ACCENT_CYAN;
        ctx.textAlign = 'center';
        ctx.fillText(`${SEMIOTIC_ICONS.DIAMOND} SNAP LOCK`, cx, cy - 34);
      }

      if (check.ok && spec.rangePx > 0) {
        const coneCol =
          angleGate.enforced && !angleGate.valid
            ? '#FF3318'
            : angleGate.enforced && dragBuildAnchor
              ? '#44FF77'
              : activeTool.buildId === 'RAIL_LANCE' || activeTool.buildId === 'SHOCK_COIL'
                ? '#00F0FF'
                : '#FFB000';
        ctx.strokeStyle = coneCol;
        ctx.lineWidth = angleGate.enforced && !angleGate.valid ? 2.6 : 2.0;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        if (spec.coneHalfAngleRad > 0) {
          const origin = { x: cx, y: cy };
          ctx.moveTo(cx, cy);
          for (let s = 0; s <= 20; s++) {
            const ra = ang - spec.coneHalfAngleRad + ((spec.coneHalfAngleRad * 2) * s) / 20;
            const pt = sim.castSightRay(origin, ra, spec.rangePx);
            ctx.lineTo(pt.x, pt.y);
          }
          ctx.closePath();
        } else {
          ctx.arc(cx, cy, spec.rangePx, 0, Math.PI * 2);
        }
        ctx.stroke();

        // Live Red Laser Tripwire preview beam when placing/aiming M314 Motion Relay!
        if (activeTool.buildId === 'MOTION_RELAY') {
          const beamEnd = sim.castSightRay({ x: cx, y: cy }, ang, 235);
          ctx.setLineDash([]);
          ctx.strokeStyle = angleGate.enforced && !angleGate.valid ? '#FF3318' : '#FF4424';
          ctx.lineWidth = 3.0;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(beamEnd.x, beamEnd.y);
          ctx.stroke();
          ctx.fillStyle = '#FF5533';
          ctx.fillRect(beamEnd.x - 4, beamEnd.y - 4, 8, 8);
        }

        if (activeTool.buildId === 'CLAYMORE') {
          ctx.strokeStyle = '#FF5522';
          ctx.beginPath();
          ctx.arc(cx, cy, PERIMETER_CONSTANTS.CLAYMORE_TRIGGER_RADIUS_PX, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);

        if (dragBuildAnchor) {
          const deg = Math.round((((ang * 180) / Math.PI) + 360) % 360);
          const dragPx = this.worldFontPx(13, tfScale, 30);
          ctx.font = font('data', dragPx);
          ctx.textAlign = 'center';
          const dragMsg =
            angleGate.enforced && !angleGate.valid
              ? `⚠ AIM ${angleGate.hint ?? 'ALONG GUIDE CONE'}!`
              : angleGate.enforced
                ? `✓ GOOD AIM (${deg}°) — RELEASE TO DEPLOY!`
                : `DRAG AIM: ${deg}° (RELEASE TO LOCK)`;
          const dw = ctx.measureText(dragMsg).width + 18;
          const dh = Math.round(dragPx + 10);
          ctx.fillStyle = 'rgba(3, 10, 6, 0.92)';
          ctx.fillRect(cx - dw * 0.5, cy - 36 - dh, dw, dh);
          ctx.strokeStyle =
            angleGate.enforced && !angleGate.valid
              ? THEME.ALERT_RED_STROKE
              : angleGate.enforced
                ? THEME.TEXT_PRIMARY
                : THEME.ACCENT_AMBER;
          ctx.lineWidth = 1.6;
          ctx.strokeRect(cx - dw * 0.5, cy - 36 - dh, dw, dh);
          ctx.fillStyle =
            angleGate.enforced && !angleGate.valid
              ? THEME.ALERT_RED_TEXT
              : angleGate.enforced
                ? THEME.TEXT_PRIMARY
                : THEME.ACCENT_AMBER_HI;
          ctx.fillText(dragMsg, cx, cy - 42);
        }
      }
      ctx.restore();
    }
  }

  /**
   * Draws an unobstructed wall-clipped directional firing-cone / red-tripwire guide ghost
   * during the Interactive Training Drill so new players immediately see the exact corridor aim!
   */
  private drawTutorialGuideCone(
    ctx: CanvasRenderingContext2D,
    sim: PerimeterSimulation,
    rule: TutorialPlacementRule,
    timeSec: number
  ): void {
    if (rule.targetAngle === undefined) return;
    const ts = sim.blueprint.tileSize;
    const origin = { x: rule.col * ts + ts * 0.5, y: rule.row * ts + ts * 0.5 };
    const ang = rule.targetAngle;
    const spec = HARDWARE_SPECS[rule.buildId];
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 6.0);

    ctx.save();
    if (rule.buildId === 'MOTION_RELAY') {
      // Red dashed Laser Tripwire guide beam straight across the hallway!
      const beamEnd = sim.castSightRay(origin, ang, 235);
      ctx.strokeStyle = `rgba(255, 72, 42, ${(0.55 + pulse * 0.4).toFixed(2)})`;
      ctx.lineWidth = 4.0;
      ctx.setLineDash([12, 8]);
      ctx.lineDashOffset = -timeSec * 42;
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(beamEnd.x, beamEnd.y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (spec.coneHalfAngleRad > 0) {
      const guideColor = rule.buildId === 'RAIL_LANCE' ? '0, 240, 255' : '68, 255, 119';
      const maxD = Math.min(spec.rangePx, 480);
      ctx.fillStyle = `rgba(${guideColor}, ${(0.08 + pulse * 0.08).toFixed(3)})`;
      ctx.strokeStyle = `rgba(${guideColor}, ${(0.48 + pulse * 0.36).toFixed(2)})`;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([10, 7]);
      ctx.lineDashOffset = -timeSec * 36;
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      for (let s = 0; s <= 18; s++) {
        const ra = ang - spec.coneHalfAngleRad + ((spec.coneHalfAngleRad * 2) * s) / 18;
        const pt = sim.castSightRay(origin, ra, maxD);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Animated centerline chevrons showing drag direction along the corridor!
    const centerEnd = sim.castSightRay(origin, ang, Math.min(220, spec.rangePx || 220));
    const maxLen = Math.hypot(centerEnd.x - origin.x, centerEnd.y - origin.y);
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const px = -uy;
    const py = ux;
    for (let k = 0; k < 3; k++) {
      const dist = 42 + ((k * 52 + timeSec * 72) % Math.max(60, maxLen - 36));
      if (dist > maxLen - 16) continue;
      const tipX = origin.x + ux * dist;
      const tipY = origin.y + uy * dist;
      ctx.strokeStyle = rule.buildId === 'MOTION_RELAY' ? '#FF5533' : '#FFE082';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(tipX - ux * 12 + px * 10, tipY - uy * 12 + py * 10);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(tipX - ux * 12 - px * 10, tipY - uy * 12 - py * 10);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawTutorialBeacons(
    ctx: CanvasRenderingContext2D,
    beacons: TutorialMapBeacon[],
    timeSec: number,
    scale: number,
    worldWidth: number = PERIMETER_CONSTANTS.VIRTUAL_W
  ): void {
    const invScale = 1 / Math.max(0.35, scale);
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 6.5);
    const expand = (timeSec * 1.15) % 1;

    ctx.save();
    for (const b of beacons) {
      const baseR = b.radiusPx ?? 34;

      // Expanding outer radar ping ring
      ctx.save();
      ctx.globalAlpha = Math.max(0, (1 - expand) * 0.85);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(b.pos.x, b.pos.y, baseR * (0.75 + expand * 1.1), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Rotating dashed inner targeting ring
      ctx.save();
      ctx.translate(b.pos.x, b.pos.y);
      ctx.rotate(timeSec * 1.4);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2.6;
      ctx.setLineDash([10, 7]);
      ctx.beginPath();
      ctx.arc(0, 0, baseR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Bouncing downward tactical pointer chevron + screen-legible pill badge
      const bob = Math.sin(timeSec * 7.5) * 6;
      const tipY = b.pos.y - baseR - 8 + bob;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.moveTo(b.pos.x, tipY);
      ctx.lineTo(b.pos.x - 10, tipY - 14);
      ctx.lineTo(b.pos.x + 10, tipY - 14);
      ctx.closePath();
      ctx.fill();

      const fontPx = Math.max(12, Math.round(13 * invScale));
      ctx.font = font('head', fontPx);
      const tw = ctx.measureText(b.label).width;
      const padX = 9 * invScale;
      const pillH = Math.round(21 * invScale);
      const pillW = tw + padX * 2;
      const pillX = Math.max(
        18,
        Math.min(worldWidth - pillW - 18, b.pos.x - pillW * 0.5)
      );
      const pillY = Math.max(24, tipY - 18 - pillH);

      ctx.fillStyle = `rgba(3, 12, 8, ${(0.9 + pulse * 0.08).toFixed(2)})`;
      ctx.fillRect(pillX, pillY, pillW, pillH);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 1.8 * invScale;
      ctx.strokeRect(pillX, pillY, pillW, pillH);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(b.label, pillX + pillW * 0.5, pillY + pillH * 0.72);
    }
    ctx.restore();
  }
}
