import {
  drawCornerBrackets,
  drawEllipsizedText,
  font,
  SEMIOTIC_ICONS,
  THEME,
} from '../../render/chrome';
import type { Vec2, ViewportRect } from '../../types';
import type { DemoTelemetryState } from './FlakDemoDirector';
import type { FlakSimulation } from './FlakSimulation';
import { FLAK_CONSTANTS, type OrbitalThreat } from './types';

export interface ScopeProjection {
  scale: number;
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
}

export interface FlakScopeRenderParams {
  sim: FlakSimulation;
  viewport: ViewportRect;
  timeSec: number;
  cursorVirtual: Vec2 | null;
  cursorInsideScope: boolean;
  demoState?: DemoTelemetryState | null;
  /** True when player clicked the bottom-dock [EMP FIRE] touch/trackpad button */
  empTouchArmed?: boolean;
}

/**
 * Computes exact aspect-preserving projection of the 1920x1080 virtual vector canvas
 * inside the radar scope viewport (letterboxed cleanly inside the Nostromo bezel).
 */
export function computeScopeProjection(viewport: ViewportRect): ScopeProjection {
  const scale = Math.min(
    viewport.width / FLAK_CONSTANTS.VIRTUAL_W,
    viewport.height / FLAK_CONSTANTS.VIRTUAL_H
  );
  const drawW = FLAK_CONSTANTS.VIRTUAL_W * scale;
  const drawH = FLAK_CONSTANTS.VIRTUAL_H * scale;
  const offsetX = viewport.x + (viewport.width - drawW) * 0.5;
  const offsetY = viewport.y + (viewport.height - drawH) * 0.5;
  return { scale, offsetX, offsetY, drawW, drawH };
}

export function screenToVirtualScope(
  sx: number,
  sy: number,
  viewport: ViewportRect
): { x: number; y: number; inside: boolean } {
  const proj = computeScopeProjection(viewport);
  const vx = (sx - proj.offsetX) / Math.max(0.0001, proj.scale);
  const vy = (sy - proj.offsetY) / Math.max(0.0001, proj.scale);
  const inside =
    vx >= 0 &&
    vx <= FLAK_CONSTANTS.VIRTUAL_W &&
    vy >= 0 &&
    vy <= FLAK_CONSTANTS.VIRTUAL_H;
  return {
    x: Math.max(0, Math.min(FLAK_CONSTANTS.VIRTUAL_W, vx)),
    y: Math.max(0, Math.min(FLAK_CONSTANTS.VIRTUAL_H, vy)),
    inside,
  };
}

export function virtualScopeToScreen(
  vx: number,
  vy: number,
  viewport: ViewportRect
): Vec2 {
  const proj = computeScopeProjection(viewport);
  return {
    x: proj.offsetX + vx * proj.scale,
    y: proj.offsetY + vy * proj.scale,
  };
}

interface ScreenTextTarget {
  x: number;
  y: number;
}

export class FlakScopeRenderer {
  public render(ctx: CanvasRenderingContext2D, params: FlakScopeRenderParams): void {
    const {
      sim,
      viewport,
      timeSec,
      cursorVirtual,
      cursorInsideScope,
      demoState,
      empTouchArmed = false,
    } = params;
    const proj = computeScopeProjection(viewport);

    // Subtle localized screen-shake on EMP detonation or Colony Dome impact
    const shakeX =
      sim.screenShake > 0.2
        ? (Math.sin(timeSec * 82) + Math.cos(timeSec * 129)) * sim.screenShake * 0.6
        : 0;
    const shakeY =
      sim.screenShake > 0.2
        ? (Math.cos(timeSec * 94) - Math.sin(timeSec * 111)) * sim.screenShake * 0.5
        : 0;
    const shakeScreenX = shakeX * proj.scale;
    const shakeScreenY = shakeY * proj.scale;

    ctx.save();
    ctx.beginPath();
    ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height);
    ctx.clip();

    // Deep P39 Cathode Radar Scope Backdrop
    ctx.fillStyle = '#020704';
    ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);

    // =========================================================================
    // PASS 1: SCALED 1920x1080 VIRTUAL VECTOR GEOMETRY (ZERO SCALED TEXT!)
    // =========================================================================
    ctx.save();
    ctx.translate(proj.offsetX + shakeScreenX, proj.offsetY + shakeScreenY);
    ctx.scale(proj.scale, proj.scale);

    // 1. Atmospheric Radar Grid, Range Arcs, Sweeping Phosphor Beam & Altitude Band Lines
    this.drawRadarBackdropGeometry(ctx, sim, timeSec);

    // 2. Live Dotted Ballistic Prediction Arcs
    this.drawBallisticPredictions(ctx, sim, timeSec);

    // 3. LV-426 Jagged Basalt Mountain Horizon, 4 Colony Domes & 3 Surface Batteries
    this.drawHorizonAndInstallationsGeometry(ctx, sim, timeSec);

    // 4. Orbital Drop-Pod Geometry
    if (sim.dropPod) {
      this.drawOrbitalDropPodGeometry(ctx, sim, timeSec);
    }

    // 5. Outgoing Flak & EMP Mortar Shells + Target Crosshairs
    this.drawInterceptorShells(ctx, sim);

    // 6. Incoming Curved Orbital Threats Vector Geometry
    this.drawThreatsGeometry(ctx, sim, timeSec);

    // 6b. Every-5-Rounds Orbital Siege Dreadnought Boss Geometry
    if (sim.boss) {
      this.drawOrbitalBossGeometry(ctx, sim, timeSec);
    }

    // 7. Expanding Physical Shockwave Blasts (Flak Airbursts & Massive EMP Rings)
    this.drawShockwaveBlasts(ctx, sim, timeSec);

    // 8. Shrapnel & Thermal Sparks
    this.drawParticles(ctx, sim);

    // 9. Precision Vector Lead-Computing Reticle Geometry (or Amber AI Targeter in Demo)
    if (demoState?.active && sim.phase === 'ACTIVE_WAVE' && !sim.paused) {
      this.drawReticleGeometry(ctx, sim, demoState.aiCursor, timeSec, demoState, false);
    } else if (cursorVirtual && cursorInsideScope && sim.phase === 'ACTIVE_WAVE' && !sim.paused) {
      this.drawReticleGeometry(ctx, sim, cursorVirtual, timeSec, null, empTouchArmed);
    }

    // Red-amber hull concussion rim flash on dome hit
    if (sim.domeHitFlashTimer > 0) {
      const a = Math.min(0.3, sim.domeHitFlashTimer * 0.34);
      ctx.fillStyle = `rgba(255, 51, 24, ${a.toFixed(3)})`;
      ctx.fillRect(0, 0, FLAK_CONSTANTS.VIRTUAL_W, FLAK_CONSTANTS.VIRTUAL_H);
    }

    ctx.restore();

    // =========================================================================
    // PASS 2: UNSCALED SCREEN-SPACE TYPOGRAPHY & BEZEL GAUGES (ALL >=12-13px!)
    // =========================================================================
    const toScreen = (vx: number, vy: number): ScreenTextTarget => {
      const pt = virtualScopeToScreen(vx, vy, viewport);
      return { x: pt.x + shakeScreenX, y: pt.y + shakeScreenY };
    };

    // 2.1 Altitude Ticks, MIRV Separation & Danger Close Band Labels
    this.drawAltitudeAndBandLabelsScreenSpace(ctx, viewport, proj, toScreen);

    // 2.2 Colony Dome & Surface Battery Labels
    this.drawInstallationLabelsScreenSpace(ctx, sim, viewport, toScreen);

    // 2.3 Orbital Drop-Pod Label
    if (sim.dropPod) {
      this.drawDropPodLabelScreenSpace(ctx, sim, viewport, toScreen);
    }

    // 2.4 Threat Telemetry Tags & Wave-1 Micro-Hints (crisp >=13px screen-space!)
    this.drawThreatLabelsScreenSpace(ctx, sim, viewport, proj.scale, toScreen);

    // 2.5 Floating Score & Multiplier Popups (crisp screen-space!)
    this.drawScorePopupsScreenSpace(ctx, sim, viewport, toScreen);

    // 2.6 Reticle Telemetry Tag & Deflection Callout (screen-space, auto left-flipped!)
    if (demoState?.active && sim.phase === 'ACTIVE_WAVE' && !sim.paused) {
      this.drawReticleLabelsScreenSpace(ctx, sim, demoState.aiCursor, viewport, toScreen, demoState, false);
    } else if (cursorVirtual && cursorInsideScope && sim.phase === 'ACTIVE_WAVE' && !sim.paused) {
      this.drawReticleLabelsScreenSpace(ctx, sim, cursorVirtual, viewport, toScreen, null, empTouchArmed);
    }

    // 2.7 Top-of-Scope Overlays (stacked cleanly in screen-space with zero overlap!)
    let topStackY = viewport.y + 8;

    if (demoState?.active && sim.phase === 'ACTIVE_WAVE') {
      topStackY = this.drawDemoTacticalTickerScreenSpace(ctx, viewport, demoState, timeSec, topStackY);
    }

    // Single Consolidated Diegetic Scope-Bezel 2X Boost Gauge (only 2X meter in the entire game!)
    if (sim.phase === 'ACTIVE_WAVE' || sim.phase === 'WAVE_AUDIT') {
      topStackY = this.drawBezelPredictorGaugeScreenSpace(ctx, viewport, sim, timeSec, topStackY);
    }

    // Orbital Siege Dreadnought Boss Integrity Telemetry Bar
    if (sim.boss) {
      this.drawBossTelemetryBarScreenSpace(ctx, viewport, sim, topStackY);
    }

    ctx.restore();

    // Crisp Radar Scope Border Frame
    ctx.save();
    ctx.strokeStyle =
      sim.domeHitFlashTimer > 0
        ? THEME.ALERT_RED_STROKE
        : empTouchArmed
          ? THEME.ACCENT_AMBER
          : THEME.BORDER_SUBTLE;
    ctx.lineWidth = sim.domeHitFlashTimer > 0 || empTouchArmed ? 2.4 : 1.8;
    ctx.strokeRect(viewport.x + 1, viewport.y + 1, viewport.width - 2, viewport.height - 2);
    ctx.restore();
  }

  // ===========================================================================
  // PASS 1: VECTOR GEOMETRY HELPERS
  // ===========================================================================
  private drawRadarBackdropGeometry(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    timeSec: number
  ): void {
    const W = FLAK_CONSTANTS.VIRTUAL_W;
    const H = FLAK_CONSTANTS.VIRTUAL_H;
    const hy = FLAK_CONSTANTS.HORIZON_Y;

    // Subtle atmospheric radial depth gradient
    const skyGrad = ctx.createRadialGradient(W * 0.5, hy, 80, W * 0.5, hy, W * 0.72);
    skyGrad.addColorStop(0, 'rgba(18, 56, 30, 0.24)');
    skyGrad.addColorStop(0.55, 'rgba(9, 30, 17, 0.14)');
    skyGrad.addColorStop(1, 'rgba(2, 7, 4, 0.96)');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    // Concentric wide-angle Surface-to-Orbit Radar Range Arcs centered at Battery S
    ctx.strokeStyle = 'rgba(27, 94, 52, 0.32)';
    ctx.lineWidth = 1.4;
    for (const r of [240, 480, 720, 960, 1180]) {
      ctx.beginPath();
      ctx.arc(W * 0.5, hy, r, Math.PI, Math.PI * 2);
      ctx.stroke();
    }

    // Radial Azimuth Spokes every 30 degrees
    ctx.strokeStyle = 'rgba(27, 94, 52, 0.22)';
    for (let deg = 15; deg <= 165; deg += 30) {
      const a = -((deg * Math.PI) / 180);
      ctx.beginPath();
      ctx.moveTo(W * 0.5 + Math.cos(a) * 160, hy + Math.sin(a) * 160);
      ctx.lineTo(W * 0.5 + Math.cos(a) * 1240, hy + Math.sin(a) * 1240);
      ctx.stroke();
    }

    // Live Sweeping Surface-to-Orbit Radar Phosphor Line
    const sweepA = sim.radarSweepAngle;
    const sweepLen = 1220;
    ctx.strokeStyle = 'rgba(68, 255, 119, 0.22)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(W * 0.5, hy);
    ctx.lineTo(W * 0.5 + Math.cos(sweepA) * sweepLen, hy + Math.sin(sweepA) * sweepLen);
    ctx.stroke();

    // Altitude Scale Tick Marks along left & right scope margins
    const altYs = [120, 300, FLAK_CONSTANTS.MIRV_SPLIT_Y, FLAK_CONSTANTS.DANGER_CLOSE_Y, 840];
    ctx.strokeStyle = 'rgba(68, 255, 119, 0.36)';
    ctx.lineWidth = 1.6;
    for (const y of altYs) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(18, y);
      ctx.moveTo(W - 18, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // MIRV Split Altitude Band (dashed threshold line)
    ctx.setLineDash([8, 14]);
    ctx.strokeStyle = 'rgba(82, 184, 114, 0.30)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(86, FLAK_CONSTANTS.MIRV_SPLIT_Y);
    ctx.lineTo(W - 86, FLAK_CONSTANTS.MIRV_SPLIT_Y);
    ctx.stroke();

    // DANGER CLOSE // 3X Lower-Atmosphere Thermal Ignition Band
    const dcY = FLAK_CONSTANTS.DANGER_CLOSE_Y;
    const dcPulse = 0.42 + 0.16 * Math.sin(timeSec * 3.5);
    ctx.setLineDash([16, 10]);
    ctx.strokeStyle = `rgba(255, 176, 0, ${dcPulse.toFixed(2)})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(86, dcY);
    ctx.lineTo(W - 86, dcY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Faint warm lower-atmosphere glow below DANGER_CLOSE_Y
    const dcBandGrad = ctx.createLinearGradient(0, dcY, 0, hy);
    dcBandGrad.addColorStop(0, 'rgba(255, 176, 0, 0.05)');
    dcBandGrad.addColorStop(1, 'rgba(255, 112, 24, 0.015)');
    ctx.fillStyle = dcBandGrad;
    ctx.fillRect(0, dcY, W, hy - dcY);

    ctx.restore();
  }

  private drawBallisticPredictions(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    timeSec: number
  ): void {
    const tRem = sim.predictorBoostTimer;
    const boostOn = tRem > 0;
    const arcAlpha = !boostOn
      ? 0.68
      : tRem < 1.5
        ? 0.68 + 0.32 * (tRem / 1.5) * (0.78 + 0.22 * Math.sin(timeSec * 20))
        : 1.0;

    ctx.save();
    ctx.globalAlpha = arcAlpha;
    for (const t of sim.threats) {
      if (t.predictedArc.length < 2) continue;

      const isLockedDome = t.lockedDomeId !== null;
      const jammed = sim.isPositionJammed(t.x, t.y) && t.kind !== 'ION_JAMMER';

      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      for (let i = 0; i < t.predictedArc.length; i++) {
        const pt = t.predictedArc[i];
        if (jammed) {
          const jx = Math.sin(timeSec * 38 + i * 2.9 + t.id) * 26;
          const jy = Math.cos(timeSec * 29 + i * 3.7) * 10;
          ctx.lineTo(pt.x + jx, pt.y + jy);
        } else {
          ctx.lineTo(pt.x, pt.y);
        }
      }

      ctx.setLineDash(jammed ? [5, 13] : boostOn ? [10, 8] : [7, 11]);
      if (jammed) {
        ctx.strokeStyle = 'rgba(158, 247, 184, 0.42)';
        ctx.lineWidth = 1.6;
      } else if (isLockedDome) {
        const pulse = (boostOn ? 0.64 : 0.5) + 0.24 * Math.sin(timeSec * 10 + t.id);
        ctx.strokeStyle = `rgba(255, 176, 0, ${pulse.toFixed(2)})`;
        ctx.lineWidth = boostOn ? 2.4 : 1.9;
      } else {
        ctx.strokeStyle = boostOn ? 'rgba(68, 255, 119, 0.58)' : 'rgba(82, 184, 114, 0.46)';
        ctx.lineWidth = boostOn ? 1.9 : 1.5;
      }
      ctx.stroke();

      // Predicted ground impact marker on horizon
      if (!jammed && t.predictedImpactX > 20 && t.predictedImpactX < FLAK_CONSTANTS.VIRTUAL_W - 20) {
        ctx.setLineDash([]);
        const ix = t.predictedImpactX;
        const iy = FLAK_CONSTANTS.HORIZON_Y;
        ctx.strokeStyle = isLockedDome
          ? THEME.ACCENT_AMBER
          : boostOn
            ? 'rgba(68, 255, 119, 0.6)'
            : 'rgba(82, 184, 114, 0.46)';
        ctx.lineWidth = isLockedDome ? 2.2 : 1.6;
        const sz = isLockedDome ? 11 : 7;
        ctx.beginPath();
        ctx.moveTo(ix - sz, iy - sz);
        ctx.lineTo(ix + sz, iy + sz);
        ctx.moveTo(ix + sz, iy - sz);
        ctx.lineTo(ix - sz, iy + sz);
        ctx.stroke();

        if (isLockedDome) {
          ctx.beginPath();
          ctx.arc(ix, iy, 16 + Math.sin(timeSec * 14) * 3, Math.PI, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawHorizonAndInstallationsGeometry(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    timeSec: number
  ): void {
    const W = FLAK_CONSTANTS.VIRTUAL_W;
    const H = FLAK_CONSTANTS.VIRTUAL_H;
    const hy = FLAK_CONSTANTS.HORIZON_Y;

    ctx.save();

    // 1. Rugged LV-426 Vector Basalt Horizon Silhouette
    if (sim.horizonProfile.length > 1) {
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (const p of sim.horizonProfile) {
        ctx.lineTo(p.x, p.y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fillStyle = 'rgba(6, 22, 12, 0.94)';
      ctx.fill();

      ctx.strokeStyle = THEME.TEXT_PRIMARY;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      for (let i = 0; i < sim.horizonProfile.length; i++) {
        const p = sim.horizonProfile[i];
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(28, 92, 49, 0.55)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, hy + 18);
      ctx.lineTo(W, hy + 18);
      ctx.stroke();
    }

    // 2. 4 Pressurized Weyland-Yutani Colony Domes (HAB-01 .. HAB-04)
    for (const d of sim.domes) {
      ctx.save();
      const r = d.radius;
      if (d.intact) {
        const savedGlow = d.savedFlashTimer > 0 || d.restoreFlashTimer > 0;
        const mainCol = savedGlow ? THEME.TEXT_BRIGHT : THEME.TEXT_PRIMARY;
        const fillCol = savedGlow
          ? 'rgba(158, 247, 184, 0.24)'
          : 'rgba(26, 98, 52, 0.34)';

        ctx.fillStyle = fillCol;
        ctx.beginPath();
        ctx.arc(d.x, d.y, r, Math.PI, Math.PI * 2);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = mainCol;
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.arc(d.x, d.y, r, Math.PI, Math.PI * 2);
        ctx.closePath();
        ctx.stroke();

        ctx.strokeStyle = 'rgba(68, 255, 119, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, r * 0.46, r, 0, Math.PI, Math.PI * 2);
        ctx.moveTo(d.x - r * 0.85, d.y - r * 0.48);
        ctx.lineTo(d.x + r * 0.85, d.y - r * 0.48);
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x, d.y - r - 11);
        ctx.stroke();

        const blink = Math.sin(timeSec * 5 + d.x * 0.02) > 0.25;
        ctx.fillStyle = blink ? THEME.ACCENT_AMBER : 'rgba(255, 176, 0, 0.35)';
        ctx.beginPath();
        ctx.arc(d.x, d.y - r - 12, 3.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#0B2816';
        ctx.fillRect(d.x - r - 6, d.y, (r + 6) * 2, 12);
        ctx.strokeStyle = mainCol;
        ctx.lineWidth = 2.0;
        ctx.strokeRect(d.x - r - 6, d.y, (r + 6) * 2, 12);
      } else {
        const flash = d.breachFlashTimer > 0 && Math.sin(timeSec * 24) > 0;
        ctx.strokeStyle = flash ? THEME.ALERT_RED_TEXT : THEME.ALERT_RED_STROKE;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(d.x - r, d.y);
        ctx.lineTo(d.x - r * 0.72, d.y - 24);
        ctx.lineTo(d.x - r * 0.32, d.y - 10);
        ctx.lineTo(d.x - r * 0.08, d.y - 28);
        ctx.lineTo(d.x + r * 0.26, d.y - 8);
        ctx.lineTo(d.x + r * 0.68, d.y - 22);
        ctx.lineTo(d.x + r, d.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. 3 Surface Defense Batteries (A: Left Flak, S: Center EMP Mortar, D: Right Flak)
    for (const b of sim.batteries) {
      const isEmp = b.weaponType === 'MK4_EMP';
      const accent = isEmp ? THEME.ACCENT_AMBER : THEME.TEXT_PRIMARY;
      const ready = b.ammo > 0;

      ctx.save();
      ctx.fillStyle = isEmp ? 'rgba(42, 26, 6, 0.92)' : 'rgba(10, 32, 18, 0.92)';
      ctx.strokeStyle = ready ? accent : THEME.BORDER_SUBTLE;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(b.x - 36, b.y + 10);
      ctx.lineTo(b.x - 24, b.y - 14);
      ctx.lineTo(b.x + 24, b.y - 14);
      ctx.lineTo(b.x + 36, b.y + 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Articulated Turret Barrel tracking cursor + kickback recoil
      ctx.save();
      ctx.translate(b.x, b.y - 12);
      ctx.rotate(b.aimAngle);
      const barrelLen = (isEmp ? 36 : 42) - b.recoil;
      if (isEmp) {
        ctx.fillStyle = '#241706';
        ctx.strokeStyle = ready ? THEME.ACCENT_AMBER : '#6E4C08';
        ctx.lineWidth = 2.4;
        ctx.fillRect(0, -8, barrelLen, 16);
        ctx.strokeRect(0, -8, barrelLen, 16);
        ctx.strokeStyle = THEME.ACCENT_AMBER_HI;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(12, -10);
        ctx.lineTo(12, 10);
        ctx.moveTo(22, -10);
        ctx.lineTo(22, 10);
        ctx.stroke();
      } else {
        ctx.strokeStyle = ready ? THEME.TEXT_BRIGHT : THEME.TEXT_SECONDARY;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(0, -4.5);
        ctx.lineTo(barrelLen, -4.5);
        ctx.moveTo(0, 4.5);
        ctx.lineTo(barrelLen, 4.5);
        ctx.stroke();
      }

      if (b.muzzleFlashTimer > 0) {
        ctx.fillStyle = THEME.ACCENT_AMBER_HI;
        ctx.beginPath();
        ctx.moveTo(barrelLen, 0);
        ctx.lineTo(barrelLen + 26, -11);
        ctx.lineTo(barrelLen + 34, 0);
        ctx.lineTo(barrelLen + 26, 11);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // Magazine Ammo Pips + Autoloader Charge Bar right under battery
      const pipCount = b.maxAmmo;
      const pipW = isEmp ? 12 : 16;
      const pipGap = 5;
      const totalW = pipCount * pipW + (pipCount - 1) * pipGap;
      const startX = b.x - totalW * 0.5;
      const pipY = b.y + 16;
      for (let i = 0; i < pipCount; i++) {
        const px = startX + i * (pipW + pipGap);
        if (i < b.ammo) {
          ctx.fillStyle = accent;
          ctx.fillRect(px, pipY, pipW, 8);
        } else if (i === b.ammo && !isEmp && b.reloadProgress > 0) {
          ctx.fillStyle = 'rgba(20, 52, 30, 0.85)';
          ctx.fillRect(px, pipY, pipW, 8);
          ctx.fillStyle = THEME.ACCENT_AMBER;
          ctx.fillRect(px, pipY, pipW * b.reloadProgress, 8);
        } else {
          ctx.strokeStyle = 'rgba(68, 255, 119, 0.35)';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(px, pipY, pipW, 8);
        }
      }
      ctx.restore();
    }

    ctx.restore();
  }

  private drawOrbitalDropPodGeometry(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    timeSec: number
  ): void {
    const pod = sim.dropPod;
    if (!pod) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(76, 238, 255, 0.78)';
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.moveTo(pod.x, pod.y);
    ctx.lineTo(pod.x + 48, pod.y - 84);
    ctx.stroke();

    // Ron Cobb diamond resupply capsule + inner cross
    ctx.fillStyle = THEME.ACCENT_CYAN;
    ctx.beginPath();
    ctx.moveTo(pod.x, pod.y - 16);
    ctx.lineTo(pod.x + 13, pod.y);
    ctx.lineTo(pod.x, pod.y + 14);
    ctx.lineTo(pod.x - 13, pod.y);
    ctx.closePath();
    ctx.fill();

    const flame = 18 + Math.sin(timeSec * 55) * 6;
    ctx.strokeStyle = THEME.ACCENT_AMBER;
    ctx.lineWidth = 4.0;
    ctx.beginPath();
    ctx.moveTo(pod.x, pod.y + 14);
    ctx.lineTo(pod.x, pod.y + 14 + flame);
    ctx.stroke();
    ctx.restore();
  }

  private drawInterceptorShells(ctx: CanvasRenderingContext2D, sim: FlakSimulation): void {
    ctx.save();
    for (const s of sim.shells) {
      ctx.strokeStyle = s.isEmp ? 'rgba(255, 176, 0, 0.85)' : 'rgba(158, 247, 184, 0.78)';
      ctx.lineWidth = 2.0;
      const sz = s.isEmp ? 12 : 8;
      ctx.beginPath();
      ctx.moveTo(s.targetX - sz, s.targetY - sz);
      ctx.lineTo(s.targetX + sz, s.targetY + sz);
      ctx.moveTo(s.targetX + sz, s.targetY - sz);
      ctx.lineTo(s.targetX - sz, s.targetY + sz);
      ctx.stroke();

      if (s.trail.length > 1) {
        ctx.strokeStyle = s.isEmp ? THEME.ACCENT_AMBER : THEME.TEXT_BRIGHT;
        ctx.lineWidth = s.isEmp ? 4.0 : 2.6;
        ctx.beginPath();
        for (let i = 0; i < s.trail.length; i++) {
          const p = s.trail[i];
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }

      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.isEmp ? 6.5 : 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawThreatsGeometry(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    timeSec: number
  ): void {
    ctx.save();
    for (const t of sim.threats) {
      const thermalT = Math.max(
        0,
        Math.min(
          1,
          (t.y - (FLAK_CONSTANTS.DANGER_CLOSE_Y - 120)) /
            (FLAK_CONSTANTS.HORIZON_Y - (FLAK_CONSTANTS.DANGER_CLOSE_Y - 120))
        )
      );
      const isHot = t.y >= FLAK_CONSTANTS.DANGER_CLOSE_Y;
      const coreCol = this.thermalColor(t, thermalT, timeSec);

      // 1. Re-Entry Trail
      if (t.trail.length > 1) {
        for (let i = 1; i < t.trail.length; i++) {
          const frac = i / t.trail.length;
          const p0 = t.trail[i - 1];
          const p1 = t.trail[i];
          ctx.strokeStyle = isHot
            ? `rgba(255, ${Math.round(176 + frac * 70)}, ${Math.round(40 + frac * 165)}, ${(frac * 0.92).toFixed(2)})`
            : t.kind === 'MIRV_POD'
              ? `rgba(255, 176, 0, ${(frac * 0.65).toFixed(2)})`
              : `rgba(68, 255, 119, ${(frac * 0.62).toFixed(2)})`;
          ctx.lineWidth = (t.kind === 'HEAVY_METEOR' ? 5.2 : 3.2) * frac + (isHot ? 1.8 : 0);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
      }

      // 2. Threat Vector Geometry by Signature (Ron Cobb distinct silhouettes for Amber-CRT safety!)
      ctx.save();
      ctx.translate(t.x, t.y);

      if (t.kind === 'KINETIC_ROD') {
        ctx.rotate(t.angle);
        if (isHot) {
          ctx.strokeStyle = THEME.ACCENT_AMBER_HI;
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.arc(4, 0, 14, -Math.PI * 0.42, Math.PI * 0.42);
          ctx.stroke();
        }
        ctx.strokeStyle = coreCol;
        ctx.fillStyle = isHot ? THEME.ACCENT_AMBER_HI : coreCol;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(15, 0);
        ctx.lineTo(-10, -6);
        ctx.lineTo(-5, 0);
        ctx.lineTo(-10, 6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (t.kind === 'HEAVY_METEOR') {
        ctx.save();
        ctx.rotate(t.angle);
        ctx.fillStyle =
          t.hitFlashTimer > 0
            ? 'rgba(255, 228, 143, 0.72)'
            : isHot
              ? 'rgba(255, 140, 24, 0.28)'
              : 'rgba(14, 52, 28, 0.65)';
        ctx.strokeStyle = t.hitFlashTimer > 0 ? '#FFFFFF' : coreCol;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        const verts = t.polyRadii.length;
        for (let k = 0; k < verts; k++) {
          const a = (k / verts) * Math.PI * 2;
          const r = t.radius * t.polyRadii[k];
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = isHot ? THEME.ACCENT_AMBER_HI : 'rgba(158, 247, 184, 0.58)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-t.radius * 0.5, -t.radius * 0.3);
        ctx.lineTo(t.radius * 0.5, t.radius * 0.3);
        ctx.moveTo(t.radius * 0.35, -t.radius * 0.45);
        ctx.lineTo(-t.radius * 0.35, t.radius * 0.45);
        ctx.stroke();
        ctx.restore();

        if (t.deflectedTimer > 0) {
          ctx.strokeStyle = THEME.ACCENT_AMBER_HI;
          ctx.lineWidth = 1.8;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.arc(0, 0, t.radius + 9, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if (t.kind === 'MIRV_POD') {
        // Distinct double-walled diamond silhouette
        const pulse = 1 + Math.sin(timeSec * 12) * 0.1;
        ctx.strokeStyle = THEME.ACCENT_AMBER;
        ctx.fillStyle = 'rgba(255, 176, 0, 0.22)';
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.moveTo(0, -21 * pulse);
        ctx.lineTo(18 * pulse, 0);
        ctx.lineTo(0, 21 * pulse);
        ctx.lineTo(-18 * pulse, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = THEME.ACCENT_AMBER_HI;
        for (const ox of [-6, 0, 6]) {
          ctx.beginPath();
          ctx.arc(ox, ox === 0 ? -4 : 4, 2.8, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (t.kind === 'ION_JAMMER') {
        // Distinct rotating hexagon + horizontal interference scan bars
        ctx.strokeStyle = 'rgba(76, 238, 255, 0.26)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([10, 12]);
        ctx.beginPath();
        ctx.arc(0, 0, t.jamRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = THEME.ACCENT_CYAN;
        ctx.lineWidth = 2.0;
        for (let wIdx = -2; wIdx <= 2; wIdx++) {
          const wy = wIdx * 9 + Math.sin(timeSec * 24 + wIdx) * 3;
          const half = 28 - Math.abs(wIdx) * 6 + Math.cos(timeSec * 36 + wIdx) * 8;
          ctx.beginPath();
          ctx.moveTo(-half, wy);
          ctx.lineTo(half, wy);
          ctx.stroke();
        }

        ctx.strokeStyle = THEME.ACCENT_AMBER_HI;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + timeSec * 1.4;
          const px = Math.cos(a) * 18;
          const py = Math.sin(a) * 18;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }

      ctx.restore();
    }
    ctx.restore();
  }

  private thermalColor(t: OrbitalThreat, thermalT: number, timeSec: number): string {
    if (t.kind === 'MIRV_POD') return THEME.ACCENT_AMBER;
    if (t.kind === 'ION_JAMMER') {
      return Math.sin(timeSec * 18) > 0 ? THEME.ACCENT_CYAN : THEME.TEXT_BRIGHT;
    }
    if (thermalT < 0.22) return THEME.TEXT_PRIMARY;
    if (thermalT < 0.65) return THEME.ACCENT_AMBER;
    return THEME.ACCENT_AMBER_HI;
  }

  private drawShockwaveBlasts(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    timeSec: number
  ): void {
    ctx.save();
    for (const b of sim.blasts) {
      const p = Math.min(1, b.age / b.duration);
      const fade = Math.max(0, 1 - Math.pow(p, 1.35));

      if (b.isEmp) {
        const grad = ctx.createRadialGradient(
          b.x,
          b.y,
          b.currentRadius * 0.08,
          b.x,
          b.y,
          b.currentRadius
        );
        grad.addColorStop(0, `rgba(255, 228, 143, ${(0.55 * fade).toFixed(2)})`);
        grad.addColorStop(0.42, `rgba(158, 247, 184, ${(0.32 * fade).toFixed(2)})`);
        grad.addColorStop(0.82, `rgba(255, 176, 0, ${(0.24 * fade).toFixed(2)})`);
        grad.addColorStop(1, 'rgba(68, 255, 119, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.currentRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(255, 228, 143, ${(0.95 * fade).toFixed(2)})`;
        ctx.lineWidth = 4.2 * fade + 1.4;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.currentRadius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = `rgba(158, 247, 184, ${(0.78 * fade).toFixed(2)})`;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        const segs = 40;
        for (let k = 0; k <= segs; k++) {
          const a = (k / segs) * Math.PI * 2;
          const jitter = Math.sin(a * 12 + timeSec * 42) * 8 * fade;
          const r = b.currentRadius * 0.78 + jitter;
          const px = b.x + Math.cos(a) * r;
          const py = b.y + Math.sin(a) * r;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      } else {
        const grad = ctx.createRadialGradient(b.x, b.y, 4, b.x, b.y, b.currentRadius);
        grad.addColorStop(0, `rgba(255, 250, 224, ${(0.68 * fade).toFixed(2)})`);
        grad.addColorStop(0.45, `rgba(255, 176, 0, ${(0.36 * fade).toFixed(2)})`);
        grad.addColorStop(1, 'rgba(255, 140, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.currentRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(255, 228, 143, ${(0.92 * fade).toFixed(2)})`;
        ctx.lineWidth = 3.0 * fade + 1.0;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.currentRadius, 0, Math.PI * 2);
        ctx.stroke();

        if (p < 0.45) {
          ctx.strokeStyle = `rgba(255, 255, 255, ${((1 - p / 0.45) * 0.85).toFixed(2)})`;
          ctx.lineWidth = 2.0;
          ctx.beginPath();
          ctx.arc(b.x, b.y, Math.min(b.currentRadius, b.coreRadius), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, sim: FlakSimulation): void {
    ctx.save();
    for (const p of sim.particles) {
      const a = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
    }
    ctx.restore();
  }

  private drawReticleGeometry(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    cursor: Vec2,
    timeSec: number,
    demoState: DemoTelemetryState | null,
    empTouchArmed: boolean
  ): void {
    const info = sim.getReticleInfo(cursor);
    const isAi = Boolean(demoState?.active);
    const cx = cursor.x;
    const cy = Math.min(FLAK_CONSTANTS.HORIZON_Y - 34, cursor.y);

    ctx.save();

    // 1. Faint vector fire-control line from active battery to reticle
    const lineOrigin =
      empTouchArmed || (isAi && demoState?.aiWeaponMode === 'EMP')
        ? sim.batteries[1]
        : info.activeFlakBattery;
    if (lineOrigin) {
      ctx.strokeStyle =
        empTouchArmed || isAi ? 'rgba(255, 176, 0, 0.38)' : 'rgba(68, 255, 119, 0.24)';
      ctx.lineWidth = empTouchArmed || isAi ? 1.8 : 1.4;
      ctx.setLineDash([6, 10]);
      ctx.beginPath();
      ctx.moveTo(lineOrigin.x, lineOrigin.y - 16);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 2. Lead-Computing Intercept Ghost Pips (during 2X+ Ballistic Predictor Boost)
    if (sim.predictorBoostTimer > 0) {
      const pipFade =
        sim.predictorBoostTimer < 1.5 ? Math.max(0.2, sim.predictorBoostTimer / 1.5) : 1.0;
      ctx.save();
      ctx.globalAlpha = pipFade;
      for (const t of sim.threats) {
        const distToCursor = Math.hypot(t.x - cx, t.y - cy);
        if (distToCursor > 360) continue;
        if (sim.isPositionJammed(t.x, t.y) && t.kind !== 'ION_JAMMER') continue;

        const tof = empTouchArmed ? info.empTofSec : info.flakTofSec;
        const g = FLAK_CONSTANTS.GRAVITY * t.gravityScale;
        const lx = t.x + t.vx * tof + 0.5 * t.orbitalDriftAx * tof * tof;
        const ly = t.y + t.vy * tof + 0.5 * g * tof * tof;
        if (ly > FLAK_CONSTANTS.HORIZON_Y - 12 || ly < 10) continue;

        ctx.strokeStyle = 'rgba(255, 176, 0, 0.54)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(lx, ly);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = 'rgba(255, 228, 143, 0.82)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(lx, ly, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2b. Live Billiard Deflection Vector Preview Geometry
    const deflectPrev = sim.getDeflectionPreview({ x: cx, y: cy });
    if (deflectPrev && deflectPrev.arc.length >= 2) {
      const billiard = deflectPrev.hitsOtherThreat;
      const pulse = 0.78 + 0.22 * Math.sin(timeSec * 16);
      const col = billiard ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;

      ctx.save();
      ctx.strokeStyle = billiard
        ? `rgba(255, 228, 143, ${(0.5 * pulse).toFixed(2)})`
        : 'rgba(255, 176, 0, 0.36)';
      ctx.lineWidth = billiard ? 1.8 : 1.4;
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      ctx.arc(cx, cy, FLAK_CONSTANTS.FLAK_BLAST_RADIUS, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = col;
      ctx.lineWidth = billiard ? 2.8 : 2.1;
      ctx.setLineDash(billiard ? [9, 5] : [8, 7]);
      ctx.beginPath();
      ctx.moveTo(deflectPrev.originX, deflectPrev.originY);
      for (const pt of deflectPrev.arc) {
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      const tip = deflectPrev.arc[deflectPrev.arc.length - 1];
      const prev = deflectPrev.arc[deflectPrev.arc.length - 2];
      const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
      const headLen = billiard ? 14 : 11;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - Math.cos(ang - 0.45) * headLen, tip.y - Math.sin(ang - 0.45) * headLen);
      ctx.lineTo(tip.x - Math.cos(ang + 0.45) * headLen, tip.y - Math.sin(ang + 0.45) * headLen);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // 3. Main Reticle Ring & Crosshair Geometry
    if (isAi && demoState) {
      const mode = demoState.aiWeaponMode;
      const aiPulse = 0.72 + 0.28 * Math.sin(timeSec * 14);
      const primaryCol = mode === 'EMP' ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;
      const r = mode === 'EMP' ? 32 : 26;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI * 0.25 + timeSec * (mode === 'DEFLECT_AIM' ? 1.3 : 0.7));
      ctx.strokeStyle = primaryCol;
      ctx.lineWidth = 2.6;
      const dHalf = r * 0.85;
      ctx.strokeRect(-dHalf, -dHalf, dHalf * 2, dHalf * 2);
      ctx.restore();

      ctx.strokeStyle = `rgba(255, 176, 0, ${aiPulse.toFixed(2)})`;
      ctx.lineWidth = 2.4;
      const rot = -timeSec * 1.1;
      for (let k = 0; k < 4; k++) {
        const a0 = rot + k * (Math.PI * 0.5) + 0.22;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 9, a0, a0 + 0.85);
        ctx.stroke();
      }

      ctx.strokeStyle = THEME.ACCENT_AMBER_HI;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(cx - 42, cy);
      ctx.lineTo(cx - 12, cy);
      ctx.moveTo(cx + 12, cy);
      ctx.lineTo(cx + 42, cy);
      ctx.moveTo(cx, cy - 42);
      ctx.lineTo(cx, cy - 12);
      ctx.moveTo(cx, cy + 12);
      ctx.lineTo(cx, cy + 42);
      ctx.stroke();

      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // Touch / Trackpad EMP Armed Blast Radius Preview Ring
    if (empTouchArmed) {
      const empPulse = 0.55 + 0.35 * Math.sin(timeSec * 12);
      ctx.strokeStyle = `rgba(255, 176, 0, ${empPulse.toFixed(2)})`;
      ctx.lineWidth = 2.2;
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.arc(cx, cy, FLAK_CONSTANTS.EMP_CORE_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const readyCol = empTouchArmed
      ? THEME.ACCENT_AMBER
      : info.activeFlakBattery
        ? THEME.TEXT_PRIMARY
        : THEME.ACCENT_AMBER;
    const r = empTouchArmed ? 30 : 24;
    ctx.strokeStyle = readyCol;
    ctx.lineWidth = empTouchArmed ? 2.6 : 2.2;

    const rot = timeSec * (empTouchArmed ? -1.2 : 0.65);
    for (let k = 0; k < 4; k++) {
      const a0 = rot + k * (Math.PI * 0.5) + 0.25;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a0 + 0.95);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(cx - 34, cy);
    ctx.lineTo(cx - 10, cy);
    ctx.moveTo(cx + 10, cy);
    ctx.lineTo(cx + 34, cy);
    ctx.moveTo(cx, cy - 34);
    ctx.lineTo(cx, cy - 10);
    ctx.moveTo(cx, cy + 10);
    ctx.lineTo(cx, cy + 34);
    ctx.stroke();

    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawOrbitalBossGeometry(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    timeSec: number
  ): void {
    const boss = sim.boss;
    if (!boss) return;

    ctx.save();
    const isStunned = boss.empStunTimer > 0;
    const isCharging = boss.chargeTimer > 0;
    const isDying = boss.dyingTimer > 0;
    const jitterX = isDying
      ? Math.sin(timeSec * 85) * 9
      : isStunned
        ? Math.sin(timeSec * 62) * 3
        : 0;
    const jitterY = isDying ? Math.cos(timeSec * 72) * 7 : 0;
    const bx = boss.x + jitterX;
    const by = boss.y + jitterY;

    // 1. Telegraph Laser Lock Sightlines down to targeted Colony Domes
    if (isCharging && !isDying) {
      const chargeFrac = 1 - boss.chargeTimer / Math.max(0.01, boss.chargeDuration);
      const pulse = 0.45 + 0.45 * Math.sin(timeSec * 36);
      ctx.save();
      ctx.setLineDash([12, 8]);
      ctx.lineWidth = 2.0 + chargeFrac * 2.2;
      ctx.strokeStyle = `rgba(255, 51, 24, ${(0.35 + pulse * 0.55).toFixed(2)})`;
      for (const dId of boss.targetDomeIds) {
        const dome = sim.domes.find((d) => d.id === dId && d.intact);
        if (!dome) continue;
        ctx.beginPath();
        ctx.moveTo(bx, by + 24);
        ctx.lineTo(dome.x, dome.y - dome.radius);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.strokeStyle = THEME.ALERT_RED_STROKE;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(
          dome.x,
          dome.y - 10,
          dome.radius + 14 + (1 - chargeFrac) * 28,
          Math.PI,
          Math.PI * 2
        );
        ctx.stroke();
        ctx.setLineDash([12, 8]);
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 2. Massive 1979 Vector Warship Chassis Silhouette
    ctx.save();
    ctx.translate(bx, by);
    const hullCol = isDying
      ? THEME.ACCENT_AMBER_HI
      : boss.hitFlashTimer > 0
        ? THEME.ACCENT_AMBER_HI
        : isStunned
          ? THEME.TEXT_BRIGHT
          : isCharging
            ? THEME.ALERT_RED_STROKE
            : THEME.ACCENT_AMBER;

    ctx.fillStyle = isDying
      ? 'rgba(255, 176, 0, 0.32)'
      : isStunned
        ? 'rgba(24, 96, 62, 0.45)'
        : 'rgba(28, 12, 6, 0.88)';

    ctx.beginPath();
    ctx.moveTo(-184, 8);
    ctx.lineTo(-148, -32);
    ctx.lineTo(-78, -50);
    ctx.lineTo(78, -50);
    ctx.lineTo(148, -32);
    ctx.lineTo(184, 8);
    ctx.lineTo(156, 36);
    ctx.lineTo(76, 26);
    ctx.lineTo(42, 48);
    ctx.lineTo(-42, 48);
    ctx.lineTo(-76, 26);
    ctx.lineTo(-156, 36);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = hullCol;
    ctx.lineWidth = 3.2;
    ctx.stroke();

    ctx.strokeStyle = isStunned ? THEME.TEXT_PRIMARY : 'rgba(255, 176, 0, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-136, -18);
    ctx.lineTo(136, -18);
    ctx.moveTo(-96, 12);
    ctx.lineTo(96, 12);
    ctx.moveTo(-68, -48);
    ctx.lineTo(-68, 28);
    ctx.moveTo(68, -48);
    ctx.lineTo(68, 28);
    ctx.stroke();

    if (isStunned) {
      ctx.strokeStyle = THEME.TEXT_BRIGHT;
      ctx.lineWidth = 2.0;
      for (let a = 0; a < 3; a++) {
        ctx.beginPath();
        const sy = -24 + a * 20;
        ctx.moveTo(-150, sy);
        for (let sx = -120; sx <= 150; sx += 30) {
          ctx.lineTo(sx, sy + Math.sin(timeSec * 42 + sx * 0.1 + a) * 10);
        }
        ctx.stroke();
      }
    }

    // 3. Three Targetable Weapon Hardpoints
    for (const hp of boss.hardpoints) {
      ctx.save();
      ctx.translate(hp.offsetX, hp.offsetY);
      if (hp.destroyed) {
        ctx.strokeStyle = 'rgba(255, 80, 40, 0.45)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(-16, -16);
        ctx.lineTo(16, 16);
        ctx.moveTo(16, -16);
        ctx.lineTo(-16, 16);
        ctx.stroke();
      } else {
        const nodeCol =
          hp.hitFlashTimer > 0
            ? '#FFFFFF'
            : isCharging
              ? THEME.ALERT_RED_STROKE
              : hp.id === 'CORE'
                ? THEME.ACCENT_AMBER_HI
                : THEME.ACCENT_AMBER;
        const r = hp.radius * 0.72;
        ctx.fillStyle = isCharging ? 'rgba(255, 51, 24, 0.38)' : 'rgba(255, 176, 0, 0.22)';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = nodeCol;
        ctx.lineWidth = 2.6;
        ctx.stroke();

        const bPulse = 4 + Math.sin(timeSec * 12) * 3;
        const br = r + bPulse;
        ctx.strokeStyle = hp.id === 'CORE' ? THEME.ACCENT_AMBER_HI : THEME.ALERT_RED_STROKE;
        ctx.lineWidth = 2.0;
        const leg = 8;
        ctx.beginPath();
        ctx.moveTo(-br, -br + leg);
        ctx.lineTo(-br, -br);
        ctx.lineTo(-br + leg, -br);
        ctx.moveTo(br - leg, -br);
        ctx.lineTo(br, -br);
        ctx.lineTo(br, -br + leg);
        ctx.moveTo(-br, br - leg);
        ctx.lineTo(-br, br);
        ctx.lineTo(-br + leg, br);
        ctx.moveTo(br - leg, br);
        ctx.lineTo(br, br);
        ctx.lineTo(br, br - leg);
        ctx.stroke();

        const frac = Math.max(0, hp.hp / Math.max(1, hp.maxHp));
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(-20, r + 8, 40, 6);
        ctx.fillStyle = hp.id === 'CORE' ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;
        ctx.fillRect(-19, r + 9, 38 * frac, 4);
      }
      ctx.restore();
    }

    ctx.restore();
    ctx.restore();
  }

  // ===========================================================================
  // PASS 2: UNSCALED SCREEN-SPACE TYPOGRAPHY (>=12-13px CSS PX EVERYWHERE!)
  // ===========================================================================
  private drawHaloText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color: string
  ): void {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = THEME.HALO_DARK;
    ctx.lineWidth = 3.2;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  private drawAltitudeAndBandLabelsScreenSpace(
    ctx: CanvasRenderingContext2D,
    viewport: ViewportRect,
    proj: ScopeProjection,
    toScreen: (vx: number, vy: number) => ScreenTextTarget
  ): void {
    ctx.save();
    ctx.textBaseline = 'middle';

    // Altitude edge scale ticks (12px crisp JetBrains Mono)
    ctx.font = font('micro', 12);
    const altMarks = [
      { y: 120, lbl: '90KM' },
      { y: 300, lbl: '68KM' },
      { y: FLAK_CONSTANTS.MIRV_SPLIT_Y, lbl: '48KM' },
      { y: FLAK_CONSTANTS.DANGER_CLOSE_Y, lbl: '24KM' },
      { y: 840, lbl: '10KM' },
    ];
    const leftEdgeX = Math.max(viewport.x + 8, proj.offsetX + 12);
    const rightEdgeX = Math.min(viewport.x + viewport.width - 8, proj.offsetX + proj.drawW - 12);

    for (const m of altMarks) {
      const pt = toScreen(0, m.y);
      ctx.textAlign = 'left';
      this.drawHaloText(ctx, m.lbl, leftEdgeX, pt.y, THEME.TEXT_SECONDARY);
      ctx.textAlign = 'right';
      this.drawHaloText(ctx, m.lbl, rightEdgeX, pt.y, THEME.TEXT_SECONDARY);
    }

    // MIRV Separation Threshold Label (13px screen-space)
    const mirvPt = toScreen(FLAK_CONSTANTS.VIRTUAL_W - 92, FLAK_CONSTANTS.MIRV_SPLIT_Y);
    ctx.font = font('data', 13);
    ctx.textAlign = 'right';
    this.drawHaloText(
      ctx,
      `${SEMIOTIC_ICONS.DIAMOND} MIRV SPLIT // 48KM`,
      Math.min(rightEdgeX - 46, mirvPt.x),
      mirvPt.y - 10,
      THEME.TEXT_SECONDARY
    );

    // DANGER CLOSE // 3X Thermal Band Labels (13px screen-space)
    const dcLeftPt = toScreen(92, FLAK_CONSTANTS.DANGER_CLOSE_Y);
    const dcRightPt = toScreen(FLAK_CONSTANTS.VIRTUAL_W - 92, FLAK_CONSTANTS.DANGER_CLOSE_Y);
    ctx.font = font('data', 13);
    ctx.textAlign = 'left';
    this.drawHaloText(
      ctx,
      '▼ DANGER CLOSE // 3X THERMAL BAND',
      Math.max(leftEdgeX + 46, dcLeftPt.x),
      dcLeftPt.y - 10,
      THEME.ACCENT_AMBER
    );
    if (viewport.width >= 760) {
      ctx.textAlign = 'right';
      this.drawHaloText(
        ctx,
        '3X SCORE // +1 EMP PER 3 KILLS',
        Math.min(rightEdgeX - 46, dcRightPt.x),
        dcRightPt.y - 10,
        THEME.ACCENT_AMBER
      );
    }

    ctx.restore();
  }

  private drawInstallationLabelsScreenSpace(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    viewport: ViewportRect,
    toScreen: (vx: number, vy: number) => ScreenTextTarget
  ): void {
    ctx.save();
    ctx.font = font('data', 13);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxY = viewport.y + viewport.height - 10;

    for (const d of sim.domes) {
      const pt = toScreen(d.x, d.y + 34);
      const y = Math.min(maxY, pt.y);
      if (d.intact) {
        const savedGlow = d.savedFlashTimer > 0 || d.restoreFlashTimer > 0;
        this.drawHaloText(
          ctx,
          d.label,
          pt.x,
          y,
          savedGlow ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT
        );
      } else {
        this.drawHaloText(ctx, `${d.label} LOST`, pt.x, y, THEME.ALERT_RED_TEXT);
      }
    }

    for (const b of sim.batteries) {
      const isEmp = b.weaponType === 'MK4_EMP';
      const pt = toScreen(b.x, b.y + 44);
      const y = Math.min(maxY, pt.y);
      const lbl = isEmp ? `${SEMIOTIC_ICONS.DIAMOND} [S] EMP` : `[${b.id}] FLAK`;
      this.drawHaloText(
        ctx,
        lbl,
        Math.max(viewport.x + 42, Math.min(viewport.x + viewport.width - 42, pt.x)),
        y,
        isEmp ? THEME.ACCENT_AMBER : THEME.TEXT_PRIMARY
      );
    }

    ctx.restore();
  }

  private drawDropPodLabelScreenSpace(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    viewport: ViewportRect,
    toScreen: (vx: number, vy: number) => ScreenTextTarget
  ): void {
    const pod = sim.dropPod;
    if (!pod) return;
    const pt = toScreen(pod.x, pod.y);
    const flipLeft = pt.x > viewport.x + viewport.width - 190;
    ctx.save();
    ctx.font = font('data', 13);
    ctx.textAlign = flipLeft ? 'right' : 'left';
    ctx.textBaseline = 'middle';
    this.drawHaloText(
      ctx,
      `${SEMIOTIC_ICONS.DIAMOND} DROP-POD // RESTORE`,
      flipLeft ? pt.x - 16 : pt.x + 16,
      pt.y - 4,
      THEME.ACCENT_CYAN
    );
    ctx.restore();
  }

  private drawThreatLabelsScreenSpace(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    viewport: ViewportRect,
    projScale: number,
    toScreen: (vx: number, vy: number) => ScreenTextTarget
  ): void {
    ctx.save();
    ctx.textBaseline = 'middle';
    let shownMeteorHint = false;
    let shownDcHint = false;

    for (const t of sim.threats) {
      if (t.y <= 16) continue;
      const isHot = t.y >= FLAK_CONSTANTS.DANGER_CLOSE_Y;
      const altKm = Math.max(
        0,
        ((FLAK_CONSTANTS.HORIZON_Y - t.y) / FLAK_CONSTANTS.HORIZON_Y) * 98
      );
      const pt = toScreen(t.x, t.y);
      const radPx = Math.max(10, t.radius * projScale + 6);
      const flipLeft = pt.x > viewport.x + viewport.width - 156;
      const tx = flipLeft ? pt.x - radPx : pt.x + radPx;

      let tag = `${altKm.toFixed(1)}KM`;
      let col: string = THEME.TEXT_BRIGHT;
      if (t.kind === 'HEAVY_METEOR') {
        tag = `${SEMIOTIC_ICONS.TRIANGLE} HVY [${'█'.repeat(Math.max(1, t.hp))}] ${altKm.toFixed(0)}KM`;
        col = isHot ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT;
      } else if (t.kind === 'MIRV_POD') {
        tag = `${SEMIOTIC_ICONS.DIAMOND} MIRV ${altKm.toFixed(0)}KM`;
        col = THEME.ACCENT_AMBER;
      } else if (t.kind === 'ION_JAMMER') {
        tag = `${SEMIOTIC_ICONS.HEX} ION JAM`;
        col = THEME.ACCENT_CYAN;
      } else if (isHot) {
        tag = `${SEMIOTIC_ICONS.STAR} 3X ${altKm.toFixed(1)}KM`;
        col = THEME.ACCENT_AMBER_HI;
      }

      ctx.font = font('data', 13);
      ctx.textAlign = flipLeft ? 'right' : 'left';
      this.drawHaloText(ctx, tag, tx, pt.y, col);

      // Wave-1 diegetic micro-hints (crisp >=13px screen-space pills)
      if (sim.waveNumber === 1) {
        if (
          !shownMeteorHint &&
          t.kind === 'HEAVY_METEOR' &&
          sim.deflectionKills === 0 &&
          t.deflectedTimer <= 0 &&
          t.y > 90 &&
          t.y < 660
        ) {
          shownMeteorHint = true;
          this.drawMicroHintPill(
            ctx,
            flipLeft ? 'AIM BESIDE TO DEFLECT ►' : '◄ AIM BESIDE TO DEFLECT!',
            tx,
            pt.y + 18,
            flipLeft,
            THEME.ACCENT_AMBER,
            THEME.ACCENT_AMBER_HI
          );
        } else if (
          !shownDcHint &&
          t.kind === 'KINETIC_ROD' &&
          sim.dangerCloseKills === 0 &&
          t.y > 470 &&
          t.y < FLAK_CONSTANTS.DANGER_CLOSE_Y + 32
        ) {
          shownDcHint = true;
          this.drawMicroHintPill(
            ctx,
            '▼ WAIT BELOW 24KM FOR 3X!',
            tx,
            pt.y + 18,
            flipLeft,
            THEME.ACCENT_AMBER,
            THEME.ACCENT_AMBER_HI
          );
        }
      }
    }
    ctx.restore();
  }

  private drawMicroHintPill(
    ctx: CanvasRenderingContext2D,
    text: string,
    anchorX: number,
    centerY: number,
    alignRight: boolean,
    borderColor: string,
    textColor: string
  ): void {
    ctx.save();
    ctx.font = font('data', 13);
    const tw = Math.ceil(ctx.measureText(text).width);
    const pw = tw + 12;
    const ph = 20;
    const px = alignRight ? anchorX - pw : anchorX;
    const py = Math.round(centerY - ph * 0.5);

    ctx.fillStyle = 'rgba(18, 12, 3, 0.90)';
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);

    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px + pw * 0.5, centerY + 0.5);
    ctx.restore();
  }

  private drawScorePopupsScreenSpace(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    viewport: ViewportRect,
    toScreen: (vx: number, vy: number) => ScreenTextTarget
  ): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const pop of sim.popups) {
      const p = pop.age / pop.duration;
      const alpha = p < 0.15 ? p / 0.15 : Math.max(0, 1 - (p - 0.15) / 0.85);
      const pt = toScreen(pop.x, pop.y);
      const sx = Math.max(viewport.x + 84, Math.min(viewport.x + viewport.width - 84, pt.x));
      const sy = Math.max(viewport.y + 44, Math.min(viewport.y + viewport.height - 28, pt.y));

      ctx.globalAlpha = alpha;
      ctx.font = font('head', 15);
      this.drawHaloText(ctx, pop.text, sx, sy, pop.color);
      if (pop.subText) {
        ctx.font = font('data', 13);
        this.drawHaloText(ctx, pop.subText, sx, sy + 16, THEME.ACCENT_AMBER);
      }
    }
    ctx.restore();
  }

  private drawReticleLabelsScreenSpace(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    cursor: Vec2,
    viewport: ViewportRect,
    toScreen: (vx: number, vy: number) => ScreenTextTarget,
    demoState: DemoTelemetryState | null,
    empTouchArmed: boolean
  ): void {
    const info = sim.getReticleInfo(cursor);
    const isAi = Boolean(demoState?.active);
    const cx = cursor.x;
    const cy = Math.min(FLAK_CONSTANTS.HORIZON_Y - 34, cursor.y);
    const pt = toScreen(cx, cy);

    // Deflection preview callout tag in crisp >=13px screen-space
    const deflectPrev = sim.getDeflectionPreview({ x: cx, y: cy });
    if (deflectPrev && deflectPrev.arc.length >= 2) {
      const billiard = deflectPrev.hitsOtherThreat;
      const tip = deflectPrev.arc[deflectPrev.arc.length - 1];
      const tipPt = toScreen(tip.x, tip.y);
      const tx = Math.max(viewport.x + 88, Math.min(viewport.x + viewport.width - 88, tipPt.x));
      const ty = Math.max(viewport.y + 24, tipPt.y - 16);

      ctx.save();
      ctx.font = font('data', billiard ? 14 : 13);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      this.drawHaloText(
        ctx,
        billiard ? `${SEMIOTIC_ICONS.STAR} BILLIARD KILL! ${SEMIOTIC_ICONS.STAR}` : 'DEFLECT VECTOR →',
        tx,
        ty,
        billiard ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER
      );
      ctx.restore();
    }

    // Flip player & AI reticle text left when cx > VIRTUAL_W - 340 OR close to right viewport edge!
    const flipLeft = cx > FLAK_CONSTANTS.VIRTUAL_W - 340 || pt.x > viewport.x + viewport.width - 236;
    const tagX = flipLeft ? pt.x - 24 : pt.x + 24;
    const tagY = Math.max(viewport.y + 28, Math.min(viewport.y + viewport.height - 28, pt.y));

    ctx.save();
    ctx.textBaseline = 'middle';

    if (isAi && demoState) {
      const mode = demoState.aiWeaponMode;
      const modeTag =
        mode === 'EMP'
          ? 'MK-IV EMP LOCK'
          : mode === 'HOLD'
            ? 'HOLDING (3X WAIT)'
            : mode === 'DEFLECT_AIM'
              ? 'OFF-CENTER SHOVE'
              : 'M90 BALLISTIC LEAD';
      const tofStr =
        mode === 'EMP' ? info.empTofSec.toFixed(2) : info.flakTofSec.toFixed(2);

      const line1 = `AI TARGETER // ${modeTag}`;
      const line2 = `AUTO-SOLVER // TOF ${tofStr}S`;
      this.drawReticleTagBox(
        ctx,
        tagX,
        tagY,
        flipLeft,
        line1,
        line2,
        THEME.ACCENT_AMBER,
        THEME.ACCENT_AMBER_HI,
        THEME.ACCENT_AMBER
      );
      ctx.restore();
      return;
    }

    const readyCol = empTouchArmed
      ? THEME.ACCENT_AMBER_HI
      : info.activeFlakBattery
        ? THEME.TEXT_PRIMARY
        : THEME.ACCENT_AMBER;
    const batLabel = empTouchArmed
      ? `${SEMIOTIC_ICONS.DIAMOND} EMP ARMED`
      : info.activeFlakBattery
        ? `BAT-${info.activeFlakBattery.id} FLAK`
        : 'RELOADING';
    const primaryTof = empTouchArmed ? info.empTofSec : info.flakTofSec;
    const line1 = `${batLabel} // TOF ${primaryTof.toFixed(2)}S`;
    const line2 = empTouchArmed
      ? 'CLICK / TAP SKY TO FIRE EMP'
      : info.empReady
        ? `[RMB/SPC/S] EMP RDY (${info.empTofSec.toFixed(2)}S)`
        : '[RMB/SPC/S] EMP EMPTY';
    const line2Col = empTouchArmed
      ? THEME.ACCENT_AMBER_HI
      : info.empReady
        ? THEME.ACCENT_AMBER
        : THEME.TEXT_MUTED;

    this.drawReticleTagBox(
      ctx,
      tagX,
      tagY,
      flipLeft,
      line1,
      line2,
      readyCol,
      line2Col,
      empTouchArmed ? THEME.ACCENT_AMBER : THEME.BORDER_SUBTLE
    );
    ctx.restore();
  }

  private drawReticleTagBox(
    ctx: CanvasRenderingContext2D,
    anchorX: number,
    centerY: number,
    alignRight: boolean,
    line1: string,
    line2: string,
    col1: string,
    col2: string,
    borderCol: string
  ): void {
    ctx.font = font('data', 13);
    const w1 = ctx.measureText(line1).width;
    const w2 = ctx.measureText(line2).width;
    const boxW = Math.ceil(Math.max(w1, w2)) + 14;
    const boxH = 38;
    const bx = alignRight ? anchorX - boxW : anchorX;
    const by = Math.round(centerY - boxH * 0.5);

    ctx.fillStyle = 'rgba(3, 10, 6, 0.84)';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1.1;
    ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);

    ctx.textAlign = alignRight ? 'right' : 'left';
    const tx = alignRight ? bx + boxW - 7 : bx + 7;
    ctx.fillStyle = col1;
    ctx.fillText(line1, tx, by + 11);
    ctx.fillStyle = col2;
    ctx.fillText(line2, tx, by + 28);
  }

  private drawDemoTacticalTickerScreenSpace(
    ctx: CanvasRenderingContext2D,
    viewport: ViewportRect,
    demo: DemoTelemetryState,
    timeSec: number,
    topY: number
  ): number {
    const bx = viewport.x + 12;
    const bw = Math.max(240, viewport.width - 24);
    const bh = 54;
    const exitPulse = 0.68 + 0.32 * Math.sin(timeSec * 6.5);

    ctx.save();
    ctx.fillStyle = 'rgba(14, 10, 2, 0.88)';
    ctx.fillRect(bx, topY, bw, bh);
    ctx.strokeStyle = THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(bx + 0.5, topY + 0.5, bw - 1, bh - 1);

    const pips = `${'■'.repeat(demo.stageIndex)}${'□'.repeat(Math.max(0, demo.totalStages - demo.stageIndex))}`;
    ctx.textBaseline = 'middle';

    // Top-right exit cue
    ctx.font = font('button', 13);
    const exitTxt = '[SPACE / ESC / CLICK] EXIT DEMO';
    const exitW = Math.ceil(ctx.measureText(exitTxt).width) + 16;
    ctx.textAlign = 'right';
    ctx.fillStyle = `rgba(255, 228, 143, ${exitPulse.toFixed(2)})`;
    ctx.fillText(exitTxt, bx + bw - 12, topY + 16);

    // Top-left stage title
    ctx.textAlign = 'left';
    ctx.font = font('head', 14);
    ctx.fillStyle = THEME.ACCENT_AMBER;
    drawEllipsizedText(
      ctx,
      `TACTICAL DEMO [${pips}] ${demo.stageTitle}`,
      bx + 12,
      topY + 16,
      Math.max(120, bw - exitW - 24)
    );

    // Bottom-right milestone confirmation badge
    let milestoneW = 0;
    if (demo.milestoneBanner) {
      ctx.font = font('data', 13);
      const msTxt = `✓ ${demo.milestoneBanner}`;
      milestoneW = Math.ceil(ctx.measureText(msTxt).width) + 16;
      ctx.textAlign = 'right';
      ctx.fillStyle = THEME.ACCENT_AMBER_HI;
      ctx.fillText(msTxt, bx + bw - 12, topY + 39);
    }

    // Bottom-left AI callout
    ctx.textAlign = 'left';
    ctx.font = font('data', 13);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    drawEllipsizedText(
      ctx,
      demo.calloutText,
      bx + 12,
      topY + 39,
      Math.max(120, bw - milestoneW - 24)
    );

    ctx.restore();
    return topY + bh + 6;
  }

  /**
   * Single Consolidated Diegetic Scope-Bezel 2X Boost Gauge.
   * Replaces all 3 previous duplicated 2X Boost meters with one crisp screen-space bezel instrument.
   */
  private drawBezelPredictorGaugeScreenSpace(
    ctx: CanvasRenderingContext2D,
    viewport: ViewportRect,
    sim: FlakSimulation,
    timeSec: number,
    topY: number
  ): number {
    const active = sim.predictorBoostTimer > 0;
    const overclocked = sim.liveChain >= 4;
    const bh = active ? 36 : 24;

    ctx.save();
    if (!active) {
      // Calm low-profile bezel readiness pill when 2X Boost is on standby
      const stbyText = `${SEMIOTIC_ICONS.DIAMOND} 2X LEAD PREDICTOR: STBY · CHAIN 2X TO ENGAGE`;
      ctx.font = font('micro', 12);
      const bw = Math.min(
        viewport.width - 24,
        Math.max(340, Math.ceil(ctx.measureText(stbyText).width) + 28)
      );
      const bx = Math.round(viewport.x + (viewport.width - bw) * 0.5);

      ctx.fillStyle = 'rgba(4, 14, 8, 0.80)';
      ctx.fillRect(bx, topY, bw, bh);
      ctx.strokeStyle = THEME.BORDER_SUBTLE;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(bx + 0.5, topY + 0.5, bw - 1, bh - 1);

      ctx.fillStyle = THEME.TEXT_SECONDARY;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      drawEllipsizedText(ctx, stbyText, bx + bw * 0.5, topY + bh * 0.5 + 0.5, bw - 16);
      ctx.restore();
      return topY + bh + 6;
    }

    const label = overclocked
      ? `${SEMIOTIC_ICONS.PLAY} x${sim.liveChain} OVERCLOCK // LEAD PIPS + -20% LOAD (${sim.predictorBoostTimer.toFixed(1)}S)`
      : `${SEMIOTIC_ICONS.PLAY} 2X BOOST // LEAD PIPS + FAST LOAD (${sim.predictorBoostTimer.toFixed(1)}S)`;
    ctx.font = font('data', 13);
    const bw = Math.min(
      viewport.width - 24,
      Math.max(440, Math.ceil(ctx.measureText(label).width) + 28)
    );
    const bx = Math.round(viewport.x + (viewport.width - bw) * 0.5);

    const frac = Math.max(0, Math.min(1, sim.predictorBoostTimer / sim.predictorBoostMaxSec));
    const lowWarn = sim.predictorBoostTimer < 2.5;
    const pulse = (lowWarn || overclocked) && Math.sin(timeSec * 16) > 0;
    const borderCol = overclocked
      ? THEME.ACCENT_AMBER
      : lowWarn
        ? THEME.ACCENT_AMBER
        : THEME.TEXT_PRIMARY;

    ctx.fillStyle = overclocked ? 'rgba(34, 22, 4, 0.90)' : 'rgba(5, 22, 11, 0.90)';
    ctx.fillRect(bx, topY, bw, bh);
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(bx + 0.5, topY + 0.5, bw - 1, bh - 1);
    drawCornerBrackets(ctx, bx, topY, bw, bh, 8, borderCol, 2.0);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = overclocked
      ? pulse
        ? THEME.ACCENT_AMBER_HI
        : THEME.ACCENT_AMBER
      : pulse
        ? THEME.ACCENT_AMBER_HI
        : THEME.TEXT_BRIGHT;

    drawEllipsizedText(ctx, label, bx + bw * 0.5, topY + 13, bw - 18);

    // Draining phosphor bar with live carrier oscilloscope ripple
    const barX = bx + 12;
    const barY = topY + 24;
    const barW = bw - 24;
    const barH = 7;
    ctx.fillStyle = 'rgba(10, 28, 16, 0.92)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = lowWarn || overclocked ? THEME.ACCENT_AMBER : THEME.TEXT_PRIMARY;
    ctx.fillRect(barX, barY, barW * frac, barH);

    ctx.strokeStyle = THEME.ACCENT_AMBER_HI;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const segs = 22;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const wx = barX + u * barW * frac;
      const wy = barY + barH * 0.5 + Math.sin(u * 20 - timeSec * 22) * 2.4;
      if (i === 0) ctx.moveTo(wx, wy);
      else ctx.lineTo(wx, wy);
    }
    ctx.stroke();

    ctx.restore();
    return topY + bh + 6;
  }

  private drawBossTelemetryBarScreenSpace(
    ctx: CanvasRenderingContext2D,
    viewport: ViewportRect,
    sim: FlakSimulation,
    topY: number
  ): void {
    const boss = sim.boss;
    if (!boss) return;

    const isStunned = boss.empStunTimer > 0;
    const isCharging = boss.chargeTimer > 0;
    const isDying = boss.dyingTimer > 0;
    const hpFrac = Math.max(0, boss.hp / Math.max(1, boss.maxHp));

    const barW = Math.min(540, viewport.width - 24);
    const barH = 44;
    const barX = Math.round(viewport.x + (viewport.width - barW) * 0.5);

    ctx.save();
    ctx.fillStyle = 'rgba(22, 8, 5, 0.92)';
    ctx.fillRect(barX, topY, barW, barH);
    ctx.strokeStyle = isStunned ? THEME.TEXT_BRIGHT : THEME.ALERT_RED_STROKE;
    ctx.lineWidth = 2.0;
    ctx.strokeRect(barX + 0.5, topY + 0.5, barW - 1, barH - 1);

    ctx.textBaseline = 'middle';
    ctx.font = font('data', 13);
    const statusText = isDying
      ? 'CORE COLLAPSING...'
      : isStunned
        ? `EMP STUNNED ${boss.empStunTimer.toFixed(1)}S`
        : isCharging
          ? 'SALVO LOCKING!'
          : `HULL ${Math.round(hpFrac * 100)}%`;
    const statusW = Math.ceil(ctx.measureText(statusText).width) + 16;

    ctx.textAlign = 'right';
    ctx.fillStyle = isStunned
      ? THEME.TEXT_BRIGHT
      : isCharging
        ? THEME.ALERT_RED_TEXT
        : THEME.ACCENT_AMBER_HI;
    ctx.fillText(statusText, barX + barW - 12, topY + 15);

    ctx.textAlign = 'left';
    ctx.font = font('head', 14);
    ctx.fillStyle = isStunned ? THEME.TEXT_BRIGHT : THEME.ACCENT_AMBER;
    drawEllipsizedText(
      ctx,
      `${SEMIOTIC_ICONS.TRIANGLE} BOSS // ${boss.designation}`,
      barX + 12,
      topY + 15,
      Math.max(120, barW - statusW - 24)
    );

    ctx.fillStyle = 'rgba(42, 12, 8, 0.9)';
    ctx.fillRect(barX + 12, topY + 28, barW - 24, 9);
    ctx.fillStyle = isStunned
      ? THEME.TEXT_PRIMARY
      : isCharging
        ? THEME.ALERT_RED_STROKE
        : THEME.ACCENT_AMBER;
    ctx.fillRect(barX + 12, topY + 28, (barW - 24) * hpFrac, 9);

    ctx.restore();
  }
}
