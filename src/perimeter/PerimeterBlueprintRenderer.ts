import { COLORS } from '../constants';
import type { Vec2, ViewportRect } from '../types';
import type { PerimeterSimulation } from './PerimeterSimulation';
import type { TutorialMapBeacon } from './PerimeterTutorialDirector';
import {
  HARDWARE_SPECS,
  HOSTILE_SPECS,
  MK3_BRANCH_SPECS,
  PERIMETER_CONSTANTS,
  WAVE_MUTATORS,
  type ActiveCursorTool,
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
  selectedDoorId: string | null;
  dragBuildAnchor: { col: number; row: number; angle: number } | null;
  tutorialBeacons?: TutorialMapBeacon[];
}

export class PerimeterBlueprintRenderer {
  /**
   * Computes transform scale & top-left screen origin mapping 1920x1080 virtual space into `viewport`.
   */
  public computeTransform(
    viewport: ViewportRect,
    camera: BlueprintCamera
  ): { scale: number; originX: number; originY: number } {
    const fitScale = Math.min(
      viewport.width / PERIMETER_CONSTANTS.VIRTUAL_W,
      viewport.height / PERIMETER_CONSTANTS.VIRTUAL_H
    );
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
    screenY: number
  ): Vec2 {
    const tf = this.computeTransform(viewport, camera);
    return {
      x: (screenX - tf.originX) / tf.scale,
      y: (screenY - tf.originY) / tf.scale,
    };
  }

  public virtualToScreen(
    viewport: ViewportRect,
    camera: BlueprintCamera,
    virt: Vec2
  ): Vec2 {
    const tf = this.computeTransform(viewport, camera);
    return {
      x: tf.originX + virt.x * tf.scale,
      y: tf.originY + virt.y * tf.scale,
    };
  }

  public render(ctx: CanvasRenderingContext2D, rc: BlueprintRenderContext): void {
    const { viewport, camera, sim, timeSec } = rc;
    const tf = this.computeTransform(viewport, camera);

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
    this.drawBlueprintArchitecture(ctx, rc);

    // 2. Subtle Tactical Flow-Route Preview Lines (during Prep, Pause, Training, or Arc-Welder tool)
    if (
      sim.phase === 'TACTICAL_PREP' ||
      sim.tacticalPaused ||
      sim.trainingMode ||
      (rc.activeTool.kind === 'BUILD' && rc.activeTool.buildId === 'ARC_WELDER')
    ) {
      this.drawFlowRouteVectors(ctx, sim, timeSec);
    }

    // 3. Illumination & Firing Cones + Laser Tripwires + Strobe Flares + Overclock Rings
    this.drawSensorAndIlluminationZones(ctx, rc);

    // 4. Lingering Environmental Hazards (Acid Pools, Cryo Plumes, Napalm Clouds, Airlock Purge)
    this.drawEnvironmentalZones(ctx, sim, timeSec);

    // 4B. 5-Second Rattling Floor-Grate Breach Telegraphs (`GRATE-01..04`)!
    this.drawGrateTelegraphs(ctx, sim, timeSec);

    // 5. Weldable Corridor Blast Doors (D-01 .. D-06) + 2.0s Arc-Weld Torch Sequences
    this.drawBlastDoors(ctx, rc);

    // 6. Central Reactor Core / Med-Lab Objective & 3 Bulkhead Seals
    this.drawReactorCoreObjective(ctx, sim, timeSec);

    // 7. Placed Defensive Hardware Units (+ 2.8s Reload Progress Arcs)
    this.drawPlacedTurrets(ctx, rc);

    // 8. Expanding Motion-Sensor Sweep Rings
    this.drawMotionSweepWaves(ctx, sim);

    // 9. Hostiles: Fuzzy Range-Gated Radar Blips vs. Sharp Illuminated Vector Bio-Silhouettes!
    this.drawHostilesAndBlips(ctx, sim, timeSec);

    // 10. Caseless Vector Tracer Bursts, Ricochet Sparks & Floating Callouts
    this.drawProjectilesAndCallouts(ctx, sim);

    // 11. Screen-Legible Diegetic Turret Telemetry Tags (`A-01 // 320 RDS`, `RELOAD 2.1S`, `000 DRY`)
    this.drawDiegeticTurretTags(ctx, rc, tf.scale);

    // 11B. Interactive Training Drill Pulsing Map Beacons & Callout Arrows
    if (rc.tutorialBeacons && rc.tutorialBeacons.length > 0) {
      this.drawTutorialBeacons(ctx, rc.tutorialBeacons, timeSec, tf.scale);
    }

    // 12. Interactive Build / Cone-Aiming / Command-Ability Cursor Preview
    this.drawInteractiveCursorPreview(ctx, rc);

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
        ? '#FF3318'
        : sim.overloadTimer > 0.25
          ? '#FFB000'
          : sim.floodlightTimer > 0
            ? '#B6FFF2'
            : COLORS.GREEN_MID;
    ctx.lineWidth =
      sim.blackoutTimer > 0 || sim.overloadTimer > 0.25 || sim.floodlightTimer > 0 ? 2.6 : 2.0;
    ctx.strokeRect(viewport.x + 1, viewport.y + 1, viewport.width - 2, viewport.height - 2);

    // Priority-Exclusive Single-Line Top CAD Banner (ZERO overlap at any screen width!)
    const bannerH = 26;
    if (sim.blackoutTimer > 0) {
      const blink = Math.sin(timeSec * 18) > -0.25;
      ctx.fillStyle = blink ? 'rgba(130, 18, 12, 0.92)' : 'rgba(42, 8, 6, 0.92)';
      ctx.fillRect(viewport.x + 2, viewport.y + 2, viewport.width - 4, bannerH);
      ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
      ctx.fillStyle = '#FFF0CC';
      ctx.textAlign = 'center';
      ctx.fillText(
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
      ctx.font = 'bold 14px "Share Tech Mono", monospace';
      ctx.fillStyle = frac > 0.6 ? '#FFF0CC' : '#FFB000';
      ctx.textAlign = 'center';
      ctx.fillText(
        `⚠ REACTOR OVERLOAD // BREAKER TRIP IN ${rem.toFixed(1)}S — SHED AUX [X] OR UNIT [P] ⚠`,
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
      ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
      ctx.fillStyle = '#FFB000';
      ctx.textAlign = 'center';
      ctx.fillText(
        '❚❚ TACTICAL PAUSE — BUILD / WELD / AIM / REARM ENABLED [SPACE TO RESUME]',
        viewport.x + viewport.width * 0.5,
        viewport.y + 19,
        viewport.width - 20
      );
      ctx.restore();
    } else {
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.fillStyle = COLORS.GREEN_MID;
      ctx.textAlign = 'left';
      ctx.fillText(
        `CAD VIEW // ZOOM ${camera.zoom.toFixed(2)}X [SCROLL / WASD]`,
        viewport.x + 10,
        viewport.y + 18
      );
      if (viewport.width >= 580) {
        ctx.textAlign = 'right';
        if (sim.floodlightTimer > 0) {
          ctx.fillStyle = '#B6FFF2';
          ctx.fillText(
            `☀ SECTOR FLOODLIGHT ACTIVE (${sim.floodlightTimer.toFixed(1)}S) — 100% RANGE + CRIT`,
            viewport.x + viewport.width - 10,
            viewport.y + 18
          );
        } else if (sim.activeMutator !== 'NONE') {
          const mut = WAVE_MUTATORS[sim.activeMutator];
          ctx.fillStyle = mut.color;
          ctx.fillText(
            `⚡ MUTATOR [${mut.label}]: ${mut.desc}`,
            viewport.x + viewport.width - 10,
            viewport.y + 18
          );
        } else {
          ctx.fillStyle = 'rgba(255, 176, 0, 0.78)';
          ctx.fillText(
            'DARK: 55% RNG · LIT (FLARE/M314/FLOOD): 100% +20% CRIT',
            viewport.x + viewport.width - 10,
            viewport.y + 18
          );
        }
      }
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
      ctx.font = 'bold 12.5px "Share Tech Mono", monospace';
      ctx.fillStyle = '#FFF4DC';
      ctx.textAlign = 'center';
      ctx.fillText(
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
    rc: BlueprintRenderContext
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

    // Airlock Purge Chamber Stencils & Hazard Borders
    for (const al of bp.airlocks) {
      const b = al.bounds;
      ctx.save();
      ctx.fillStyle = highlightPurge
        ? `rgba(255, 176, 0, ${(0.14 + buildPulse * 0.16).toFixed(2)})`
        : 'rgba(255, 176, 0, 0.04)';
      ctx.fillRect(b.x + 3, b.y + 3, b.width - 6, b.height - 6);

      ctx.strokeStyle = highlightPurge ? '#FFB000' : 'rgba(255, 176, 0, 0.42)';
      ctx.lineWidth = highlightPurge ? 2.8 : 1.6;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(b.x + 3, b.y + 3, b.width - 6, b.height - 6);
      ctx.setLineDash([]);

      ctx.font = 'bold 13px "Share Tech Mono", monospace';
      ctx.fillStyle = highlightPurge ? '#FFD466' : 'rgba(255, 176, 0, 0.58)';
      ctx.textAlign = 'center';
      ctx.fillText(al.label, al.center.x, al.center.y + 4);
      ctx.restore();
    }

    // Architectural Room Labels
    ctx.save();
    ctx.textAlign = 'center';
    for (const lbl of bp.roomLabels) {
      ctx.font = 'bold 14px "Share Tech Mono", monospace';
      ctx.fillStyle = 'rgba(59, 224, 104, 0.34)';
      ctx.fillText(lbl.text, lbl.x, lbl.y);
      if (lbl.subText) {
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(255, 176, 0, 0.32)';
        ctx.fillText(lbl.subText, lbl.x, lbl.y + 14);
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
          ctx.font = 'bold 11.5px "Share Tech Mono", monospace';
          ctx.fillStyle = '#FFB000';
          ctx.textAlign = 'center';
          ctx.fillText(
            showPrepPreview && summary ? `${vent.id}: ${summary.text}` : vent.id,
            vent.pos.x,
            vent.pos.y - 28
          );
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

      ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
      ctx.fillStyle = summary?.hasBoss
        ? '#FF4466'
        : isWaveActive
          ? '#FFB000'
          : COLORS.GREEN_PRIMARY;
      ctx.textAlign = vent.col < 16 ? 'left' : 'right';
      const labelX = vent.col < 16 ? vent.pos.x - 24 : vent.pos.x + 24;
      ctx.fillText(vent.id, labelX, vent.pos.y - 30);

      // Upcoming Wave Composition Preview Badge during Tactical Prep!
      if (showPrepPreview && summary) {
        ctx.font = 'bold 12px "JetBrains Mono", monospace';
        const previewTxt = summary.text;
        const pw = ctx.measureText(previewTxt).width + 12;
        const px = vent.col < 16 ? vent.pos.x - 24 : vent.pos.x + 24 - pw;
        const py = vent.pos.y + 28;
        ctx.fillStyle = summary.hasBoss ? 'rgba(65, 10, 14, 0.94)' : 'rgba(28, 18, 4, 0.92)';
        ctx.fillRect(px, py, pw, 19);
        ctx.strokeStyle = summary.hasBoss ? '#FF3355' : '#FFB000';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(px, py, pw, 19);
        ctx.textAlign = 'center';
        ctx.fillStyle = summary.hasBoss ? '#FFE0E6' : '#FFE082';
        ctx.fillText(previewTxt, px + pw * 0.5, py + 13.5);
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
    rc: BlueprintRenderContext
  ): void {
    const { sim, timeSec, selectedTurretId } = rc;

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

      // Center flare canister + countdown tag
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(f.pos.x, f.pos.y, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#FFB000';
      ctx.textAlign = 'center';
      ctx.fillText(`M40 FLARE [${f.remainingSec.toFixed(1)}S]`, f.pos.x, f.pos.y - 12);
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

    // 3. Directional Infrared Turret Cones & M314 Laser Tripwires
    for (const t of sim.turrets) {
      const isSelected = t.id === selectedTurretId;
      const spec = HARDWARE_SPECS[t.kind];

      if (t.kind === 'MOTION_RELAY') {
        // MK-III Branch A: Permanent 240px Floodlight Illumination Halo!
        if (t.powered && sim.blackoutTimer <= 0 && t.level === 3 && t.mk3Branch === 'A') {
          const haloR = 240;
          const grad = ctx.createRadialGradient(t.pos.x, t.pos.y, 8, t.pos.x, t.pos.y, haloR);
          grad.addColorStop(0, 'rgba(220, 255, 240, 0.24)');
          grad.addColorStop(0.65, 'rgba(110, 255, 190, 0.08)');
          grad.addColorStop(1, 'rgba(110, 255, 190, 0)');
          ctx.save();
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(t.pos.x, t.pos.y, haloR, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(200, 255, 232, 0.45)';
          ctx.lineWidth = 1.6;
          ctx.setLineDash([7, 6]);
          ctx.beginPath();
          ctx.arc(t.pos.x, t.pos.y, haloR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }

        if (isSelected) {
          const rPx = spec.rangePx * (t.level === 3 ? 1.38 : t.level === 2 ? 1.2 : 1.0);
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

        // Corridor Laser Tripwire Beam!
        if (t.powered && t.tripwireStart && t.tripwireEnd && t.tripwireIntegrity >= 20) {
          ctx.save();
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
          ctx.restore();
        }
        continue;
      }

      if (t.kind === 'CRYO_VALVE' || t.kind === 'SHOCK_COIL') {
        const cryoProto = 1 + sim.getProtocolStacks('CRYO_SHATTER') * 0.2;
        const lvMult =
          t.kind === 'CRYO_VALVE'
            ? t.level === 3 && t.mk3Branch === 'B'
              ? 1.4
              : t.level >= 2
                ? 1.22
                : 1.0
            : t.level === 3
              ? 1.28
              : t.level === 2
                ? 1.15
                : 1.0;
        const rPx = spec.rangePx * lvMult * cryoProto;
        if (isSelected || (t.kind === 'SHOCK_COIL' && t.powered && sim.blackoutTimer <= 0)) {
          ctx.save();
          ctx.strokeStyle =
            t.kind === 'SHOCK_COIL'
              ? isSelected
                ? 'rgba(0, 240, 255, 0.62)'
                : 'rgba(0, 240, 255, 0.16)'
              : 'rgba(142, 245, 171, 0.45)';
          ctx.lineWidth = isSelected ? 1.9 : 1.2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.arc(t.pos.x, t.pos.y, rPx, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
        continue;
      }

      if (!t.powered || sim.blackoutTimer > 0) continue;

      const relayMult = t.relayMatrixBoosted ? 1.32 : t.relayBoosted ? 1.24 : 1.0;
      const lvlMult = t.level === 3 ? 1.22 : t.level === 2 ? 1.12 : 1.0;
      const effRange = spec.rangePx * relayMult * lvlMult;
      const darkRange = effRange * PERIMETER_CONSTANTS.DARK_CORRIDOR_RANGE_MULT;
      const halfArc = spec.coneHalfAngleRad;
      const a1 = t.angle - halfArc;
      const a2 = t.angle + halfArc;

      ctx.save();
      const isRail = t.kind === 'RAIL_LANCE';
      const isAmber = t.kind === 'INCINERATOR' || t.overclockTimer > 0;
      const isDown =
        t.thermalLocked || t.rearmTimer > 0 || (t.kind === 'SENTRY_PULSE' && t.ammo <= 0);
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
        coneGrad.addColorStop(0, 'rgba(0, 240, 255, 0.20)');
        coneGrad.addColorStop(0.55, 'rgba(0, 220, 255, 0.09)');
        coneGrad.addColorStop(1, 'rgba(0, 200, 255, 0.015)');
      } else if (isAmber) {
        coneGrad.addColorStop(0, 'rgba(255, 176, 0, 0.18)');
        coneGrad.addColorStop(0.55, 'rgba(255, 176, 0, 0.09)');
        coneGrad.addColorStop(1, 'rgba(255, 176, 0, 0.015)');
      } else {
        coneGrad.addColorStop(0, 'rgba(68, 255, 119, 0.17)');
        coneGrad.addColorStop(0.55, 'rgba(68, 255, 119, 0.08)');
        coneGrad.addColorStop(1, 'rgba(68, 255, 119, 0.015)');
      }

      // Raycasted wall-occluded full 100% illuminated cone polygon (exact turret LOS!)
      const raySamples = 24;
      const conePts: Array<{ x: number; y: number }> = [];
      const darkPts: Array<{ x: number; y: number }> = [];
      for (let s = 0; s <= raySamples; s++) {
        const ra = a1 + ((a2 - a1) * s) / raySamples;
        conePts.push(sim.castSightRay(t.pos, ra, effRange));
        darkPts.push(sim.castSightRay(t.pos, ra, darkRange));
      }

      ctx.fillStyle = coneGrad;
      ctx.beginPath();
      ctx.moveTo(t.pos.x, t.pos.y);
      for (const pt of conePts) {
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fill();

      // Outer 100% illuminated range border (dashed when unselected so 55% unlit arc stands out!)
      ctx.strokeStyle = isDown
        ? 'rgba(255, 51, 24, 0.45)'
        : isSelected
          ? '#FFB000'
          : isRail && t.overclockTimer <= 0
            ? 'rgba(0, 240, 255, 0.36)'
            : isAmber
              ? 'rgba(255, 176, 0, 0.34)'
              : 'rgba(68, 255, 119, 0.32)';
      ctx.lineWidth = isSelected ? 2.2 : 1.35;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(t.pos.x, t.pos.y);
      for (const pt of conePts) {
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      // Inner 55% passive dark-corridor IR engagement range arc (solid crisp inner arc!)
      ctx.strokeStyle = isDown
        ? 'rgba(255, 51, 24, 0.55)'
        : isRail && t.overclockTimer <= 0
          ? 'rgba(0, 240, 255, 0.62)'
          : isAmber
            ? 'rgba(255, 176, 0, 0.62)'
            : 'rgba(68, 255, 119, 0.58)';
      ctx.lineWidth = 1.65;
      ctx.beginPath();
      for (let i = 0; i < darkPts.length; i++) {
        if (i === 0) ctx.moveTo(darkPts[i].x, darkPts[i].y);
        else ctx.lineTo(darkPts[i].x, darkPts[i].y);
      }
      ctx.stroke();

      // Sweeping internal IR scan ray inside active cone (clipped at walls!)
      if (!isDown) {
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
        ctx.strokeStyle = '#FFB000';
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
    timeSec: number
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

      ctx.font = 'bold 9.5px "Share Tech Mono", monospace';
      ctx.fillStyle = armed ? '#FFD266' : '#8EF5AB';
      ctx.textAlign = 'center';
      ctx.fillText(armed ? 'M18' : 'ARM', 0, -10);
      ctx.restore();
    }

    // 6. Matriarch Queen Hatching Egg Sacs!
    for (const egg of sim.eggSacs) {
      const prog = 1 - egg.hatchTimer / Math.max(0.1, egg.maxHatchTimer);
      const pulse = 1 + 0.12 * Math.sin(timeSec * 14 + egg.id);
      ctx.save();
      ctx.translate(egg.pos.x, egg.pos.y);

      ctx.strokeStyle = prog > 0.7 ? '#FF3344' : '#B8FF3B';
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

      ctx.font = 'bold 10.5px "Share Tech Mono", monospace';
      ctx.fillStyle = '#D4FF66';
      ctx.textAlign = 'center';
      ctx.fillText(`EGG ${egg.hatchTimer.toFixed(1)}S`, 0, -21);
      ctx.restore();
    }
  }

  /**
   * 5-Second Rattling Floor-Grate Breach Telegraphs (`GRATE-01..04`) before Skitterers erupt!
   */
  private drawGrateTelegraphs(
    ctx: CanvasRenderingContext2D,
    sim: PerimeterSimulation,
    timeSec: number
  ): void {
    if (sim.grateTelegraphs.length === 0) return;
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
      ctx.strokeStyle = blink ? '#FFF0B8' : '#FF3318';
      ctx.lineWidth = 3.0;
      ctx.strokeRect(-28 + jx, -28 + jy, 56, 56);

      // High-contrast countdown banner above grate
      const lbl = `⚠ ${gt.ventId} BREACH ${gt.remainingSec.toFixed(1)}S`;
      ctx.font = 'bold 15px "Share Tech Mono", monospace';
      const tw = ctx.measureText(lbl).width + 14;
      ctx.fillStyle = blink ? '#FFB000' : 'rgba(42, 12, 4, 0.94)';
      ctx.fillRect(-tw * 0.5, -54, tw, 22);
      ctx.strokeStyle = '#FF3318';
      ctx.lineWidth = 1.8;
      ctx.strokeRect(-tw * 0.5, -54, tw, 22);
      ctx.fillStyle = blink ? '#040805' : '#FFB000';
      ctx.textAlign = 'center';
      ctx.fillText(lbl, 0, -38);
      ctx.restore();
    }
  }

  private drawBlastDoors(ctx: CanvasRenderingContext2D, rc: BlueprintRenderContext): void {
    const { sim, activeTool, selectedDoorId, timeSec } = rc;
    const ts = sim.blueprint.tileSize;
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

        const barW = 68;
        const barY = -h * 0.5 - 16;
        ctx.fillStyle = '#050D08';
        ctx.fillRect(-barW * 0.5, barY, barW, 8);
        ctx.fillStyle = '#FFB000';
        ctx.fillRect(-barW * 0.5 + 1, barY + 1, (barW - 2) * prog, 6);

        ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
        ctx.fillStyle = '#FFF0B8';
        ctx.textAlign = 'center';
        ctx.fillText(`WELDING ${ds.weldingTimer.toFixed(1)}S`, 0, barY - 4);
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

        // Live Door HP Bar
        const barW = 62;
        const barY = -h * 0.5 - 15;
        ctx.fillStyle = '#050D08';
        ctx.fillRect(-barW * 0.5, barY, barW, 8);
        ctx.fillStyle = doorCol;
        ctx.fillRect(-barW * 0.5 + 1, barY + 1, (barW - 2) * hpRatio, 6);

        ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
        ctx.fillStyle = doorCol;
        ctx.textAlign = 'center';
        ctx.fillText(`${ds.def.id} [${Math.round(hpRatio * 100)}%]`, 0, barY - 4);
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

        ctx.font = 'bold 13px "Share Tech Mono", monospace';
        ctx.fillStyle = highlightWeld ? '#FFB000' : 'rgba(68, 255, 119, 0.72)';
        ctx.textAlign = 'center';
        ctx.fillText(highlightWeld ? `WELD ${ds.def.id}` : ds.def.id, 0, -h * 0.5 - 6);
      }
      ctx.restore();
    }
  }

  private drawReactorCoreObjective(
    ctx: CanvasRenderingContext2D,
    sim: PerimeterSimulation,
    timeSec: number
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

  private drawPlacedTurrets(ctx: CanvasRenderingContext2D, rc: BlueprintRenderContext): void {
    const { sim, selectedTurretId, timeSec } = rc;

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

      // Sweeping Radial Reload Progress Arc when Sentry is running its 2.8s belt-feed cycle!
      if (t.rearmTimer > 0) {
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
      } else if ((isLowAmmo || isDry) && Math.sin(timeSec * (isDry ? 16 : 10)) > -0.1) {
        ctx.strokeStyle = isDry ? '#FF3318' : '#FFB000';
        ctx.lineWidth = 2.0;
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
        ctx.strokeStyle = COLORS.GREEN_MID;
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
        ctx.fillStyle = t.level === 3 ? '#00F0FF' : '#FFB000';
        ctx.font = 'bold 10.5px "Share Tech Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillText(t.level === 3 ? `III${t.mk3Branch ?? ''}` : 'II', 23, 22);
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
    timeSec: number
  ): void {
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
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillStyle = `rgba(224, 102, 255, ${(0.85 * alpha).toFixed(2)})`;
      ctx.fillText('ERR?', jx + 10, jy + 3);
      ctx.restore();
    }

    for (const h of sim.hostiles) {
      if (h.verified) {
        this.drawVerifiedBioSilhouette(ctx, h, timeSec);
      } else if (h.blipTimer > 0) {
        this.drawFuzzyRadarBlip(ctx, h);
      }
    }
  }

  private drawFuzzyRadarBlip(ctx: CanvasRenderingContext2D, h: HostileEntity): void {
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

    // Live Distance Tag (`14.2m`)
    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    ctx.fillStyle = `rgba(180, 255, 200, ${(0.9 * alpha).toFixed(2)})`;
    ctx.textAlign = 'left';
    ctx.fillText(`${h.blipDistM.toFixed(1).padStart(4, '0')}m`, jx + 11, jy + 4);
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
    sim: PerimeterSimulation
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

    // Floating Micro-Callouts (`RICOCHET`, `PURGE FLUSH`, `BREACHED!`)
    for (const c of sim.callouts) {
      const alpha = Math.min(1, (c.life / c.maxLife) * 1.4);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = 'bold 12.5px "Share Tech Mono", monospace';
      ctx.fillStyle = c.color;
      ctx.textAlign = 'center';
      ctx.fillText(c.text, c.pos.x, c.pos.y);
      ctx.restore();
    }
  }

  /**
   * Zoom-Compensated Screen-Legible Diegetic Ammo, Reload & Thermal Tags above every placed turret!
   * Scales inversely with `tfScale` so tags remain razor-sharp (~11 screen px tall) even at 1.0x zoom!
   */
  private drawDiegeticTurretTags(
    ctx: CanvasRenderingContext2D,
    rc: BlueprintRenderContext,
    tfScale: number
  ): void {
    const { sim, timeSec } = rc;
    const blinkFast = Math.sin(timeSec * 14) > -0.15;
    const blinkCaution = Math.sin(timeSec * 9.5) > 0;
    const tagScale = Math.max(1.0, Math.min(1.65, 0.85 / Math.max(0.32, tfScale)));

    for (const t of sim.turrets) {
      let label = '';
      let textCol = '#44FF77';
      let borderCol = 'rgba(59, 224, 104, 0.65)';
      let bgFill = 'rgba(3, 10, 6, 0.92)';

      if (sim.blackoutTimer > 0 && t.powered) {
        label = `⚡ ${t.callsign} // BLACKOUT`;
        textCol = '#FF3318';
        borderCol = '#FF3318';
        bgFill = 'rgba(42, 8, 6, 0.94)';
      } else if (!t.powered) {
        label = `${t.callsign} // OFFLINE`;
        textCol = COLORS.GREEN_MID;
        borderCol = COLORS.GREEN_DIM;
      } else if (t.rearmTimer > 0) {
        label = `⟳ ${t.callsign} // RELOAD ${t.rearmTimer.toFixed(1)}S`;
        textCol = '#040805';
        borderCol = '#FFF0B8';
        bgFill = '#FFB000';
      } else if (t.thermalLocked) {
        label = blinkFast ? `⚠ ${t.callsign} // THERM LOCK` : `${t.callsign} // COOLING`;
        textCol = blinkFast ? '#050906' : '#FF3318';
        borderCol = '#FF3318';
        bgFill = blinkFast ? '#FF3318' : 'rgba(42, 8, 6, 0.92)';
      } else if (t.kind === 'SENTRY_PULSE') {
        const lowThresh = Math.ceil(t.maxAmmo * 0.25);
        if (t.ammo <= 0) {
          label = `⚠ ${t.callsign} // 000 DRY`;
          textCol = blinkFast ? '#050906' : '#FF3318';
          borderCol = '#FF3318';
          bgFill = blinkFast ? '#FF3318' : 'rgba(45, 8, 6, 0.94)';
        } else if (t.ammo <= lowThresh) {
          const rdsStr = String(t.ammo).padStart(3, '0');
          label = blinkCaution ? `⚠ ${t.callsign} // LOW ${rdsStr}` : `${t.callsign} // ${rdsStr} RDS`;
          textCol = blinkCaution ? '#050906' : '#FFB000';
          borderCol = blinkCaution ? '#FF3318' : '#FFB000';
          bgFill = blinkCaution ? '#FFB000' : 'rgba(38, 22, 4, 0.94)';
        } else {
          const rdsStr = String(t.ammo).padStart(3, '0');
          label = `${t.callsign} // ${rdsStr} RDS`;
          textCol = t.firingFlashTimer > 0 ? '#FFB000' : '#44FF77';
          borderCol = t.firingFlashTimer > 0 ? '#FFB000' : 'rgba(59, 224, 104, 0.65)';
        }
      } else if (t.kind === 'INCINERATOR') {
        label =
          t.acidDebuffTimer > 0
            ? `⚠ ${t.callsign} // ACID`
            : `${t.callsign} // NAPALM ${Math.round(t.heat)}%`;
        textCol = t.acidDebuffTimer > 0 ? '#B8FF3B' : t.heat > 75 ? '#FF5522' : '#FFB000';
        borderCol = t.acidDebuffTimer > 0 ? '#B8FF3B' : 'rgba(255, 176, 0, 0.72)';
      } else if (t.kind === 'RAIL_LANCE') {
        const branchTag =
          t.level === 3 && t.mk3Branch ? ` ${MK3_BRANCH_SPECS.RAIL_LANCE[t.mk3Branch].code}` : '';
        label =
          t.acidDebuffTimer > 0
            ? `⚠ ${t.callsign} // ACID`
            : `${t.callsign} // RAIL${branchTag}`;
        textCol = t.acidDebuffTimer > 0 ? '#B8FF3B' : '#00F0FF';
        borderCol = t.acidDebuffTimer > 0 ? '#B8FF3B' : 'rgba(0, 240, 255, 0.72)';
      } else if (t.kind === 'CRYO_VALVE') {
        label = `${t.callsign} // CRYO`;
        textCol = '#8EF5AB';
      } else if (t.kind === 'SHOCK_COIL') {
        label = `${t.callsign} // COIL`;
        textCol = '#00F0FF';
        borderCol = 'rgba(0, 240, 255, 0.65)';
      } else {
        label =
          t.jammedTimer > 0
            ? `⚠ ${t.callsign} // JAMMED`
            : t.tripwireIntegrity < 50
              ? `${t.callsign} // WIRE DMG`
              : `${t.callsign} // M314`;
        textCol =
          t.jammedTimer > 0 ? '#E066FF' : t.tripwireIntegrity < 50 ? '#FFB000' : '#44FF77';
      }

      ctx.save();
      ctx.translate(t.pos.x, t.pos.y - 34);
      ctx.scale(tagScale, tagScale);
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      const tw = ctx.measureText(label).width + 12;
      const bx = -tw * 0.5;
      const by = -18;

      ctx.fillStyle = bgFill;
      ctx.fillRect(bx, by, tw, 18);
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, by, tw, 18);

      ctx.fillStyle = textCol;
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, by + 13);

      // Barrel Thermal Micro-Bar for combat turrets
      if (
        t.powered &&
        (t.kind === 'SENTRY_PULSE' || t.kind === 'INCINERATOR' || t.kind === 'RAIL_LANCE') &&
        t.heat > 2
      ) {
        ctx.fillStyle = '#102418';
        ctx.fillRect(bx, by + 19, tw, 3.5);
        ctx.fillStyle = t.heat > 80 ? '#FF3318' : '#FFB000';
        ctx.fillRect(bx, by + 19, (tw * t.heat) / 100, 3.5);
      }
      ctx.restore();
    }
  }

  private drawInteractiveCursorPreview(
    ctx: CanvasRenderingContext2D,
    rc: BlueprintRenderContext
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

      ctx.save();
      if (resolved.snapped && check.ok && cursorVirtual) {
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cursorVirtual.x, cursorVirtual.y);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.strokeStyle = check.ok ? (resolved.snapped ? '#00F0FF' : '#44FF77') : '#FF3318';
      ctx.fillStyle = check.ok ? 'rgba(68, 255, 119, 0.16)' : 'rgba(255, 51, 24, 0.16)';
      ctx.lineWidth = 2.4;
      ctx.fillRect(col * ts + 6, row * ts + 6, ts - 12, ts - 12);
      ctx.strokeRect(col * ts + 6, row * ts + 6, ts - 12, ts - 12);

      if (resolved.snapped && check.ok && !dragBuildAnchor) {
        ctx.font = 'bold 11px "Share Tech Mono", monospace';
        ctx.fillStyle = '#00F0FF';
        ctx.textAlign = 'center';
        ctx.fillText('SNAP LOCK', cx, cy - 32);
      }

      if (check.ok && spec.rangePx > 0) {
        ctx.strokeStyle =
          activeTool.buildId === 'RAIL_LANCE' || activeTool.buildId === 'SHOCK_COIL'
            ? '#00F0FF'
            : '#FFB000';
        ctx.lineWidth = 2.0;
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
        if (activeTool.buildId === 'CLAYMORE') {
          ctx.strokeStyle = '#FF5522';
          ctx.beginPath();
          ctx.arc(cx, cy, PERIMETER_CONSTANTS.CLAYMORE_TRIGGER_RADIUS_PX, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);

        if (dragBuildAnchor) {
          const deg = Math.round((((ang * 180) / Math.PI) + 360) % 360);
          ctx.font = 'bold 13px "JetBrains Mono", monospace';
          ctx.fillStyle = '#FFB000';
          ctx.textAlign = 'center';
          ctx.fillText(`DRAG AIM: ${deg}° (RELEASE TO LOCK)`, cx, cy - 34);
        }
      }
      ctx.restore();
    }
  }

  private drawTutorialBeacons(
    ctx: CanvasRenderingContext2D,
    beacons: TutorialMapBeacon[],
    timeSec: number,
    scale: number
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

      const fontPx = Math.round(12.5 * invScale);
      ctx.font = `bold ${fontPx}px "Share Tech Mono", monospace`;
      const tw = ctx.measureText(b.label).width;
      const padX = 9 * invScale;
      const pillH = Math.round(21 * invScale);
      const pillW = tw + padX * 2;
      const pillX = Math.max(
        18,
        Math.min(PERIMETER_CONSTANTS.VIRTUAL_W - pillW - 18, b.pos.x - pillW * 0.5)
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
