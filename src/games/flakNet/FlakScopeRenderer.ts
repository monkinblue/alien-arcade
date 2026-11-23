import { COLORS } from '../../constants';
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

export class FlakScopeRenderer {
  public render(ctx: CanvasRenderingContext2D, params: FlakScopeRenderParams): void {
    const { sim, viewport, timeSec, cursorVirtual, cursorInsideScope, demoState } = params;
    const proj = computeScopeProjection(viewport);

    ctx.save();
    ctx.beginPath();
    ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height);
    ctx.clip();

    // Deep P39 Cathode Radar Scope Backdrop
    ctx.fillStyle = '#020704';
    ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);

    // Subtle localized screen-shake on EMP detonation or Colony Dome impact
    const shakeX =
      sim.screenShake > 0.2 ? (Math.sin(timeSec * 82) + Math.cos(timeSec * 129)) * sim.screenShake * 0.6 : 0;
    const shakeY =
      sim.screenShake > 0.2 ? (Math.cos(timeSec * 94) - Math.sin(timeSec * 111)) * sim.screenShake * 0.5 : 0;

    ctx.translate(proj.offsetX + shakeX * proj.scale, proj.offsetY + shakeY * proj.scale);
    ctx.scale(proj.scale, proj.scale);

    // 1. Atmospheric Radar Grid, Range Arcs, Sweeping Phosphor Beam & Altitude Bands
    this.drawRadarBackdrop(ctx, sim, timeSec);

    // 2. Live Dotted Ballistic Prediction Arcs (always-on baseline trajectories; intensified during 2x+ Boost!)
    this.drawBallisticPredictions(ctx, sim, timeSec);

    // 3. LV-426 Jagged Basalt Mountain Horizon, 4 Colony Domes & 3 Surface Batteries
    this.drawHorizonAndInstallations(ctx, sim, timeSec);

    // 4. Orbital Drop-Pod (if restoring a breached dome on every 3rd wave)
    if (sim.dropPod) {
      this.drawOrbitalDropPod(ctx, sim, timeSec);
    }

    // 5. Outgoing Flak & EMP Mortar Shells + Target Crosshairs
    this.drawInterceptorShells(ctx, sim);

    // 6. Incoming Curved Orbital Threats with Thermal Atmospheric Re-Entry Transition
    this.drawThreats(ctx, sim, timeSec);

    // 6b. Every-5-Rounds Orbital Siege Dreadnought Boss Event!
    if (sim.boss) {
      this.drawOrbitalBoss(ctx, sim, timeSec);
    }

    // 7. Expanding Physical Shockwave Blasts (Flak Airbursts & Massive EMP Rings)
    this.drawShockwaveBlasts(ctx, sim, timeSec);

    // 8. Shrapnel & Thermal Sparks
    this.drawParticles(ctx, sim);

    // 9. Floating Amber CRT Score & Multiplier Telemetry Popups
    this.drawScorePopups(ctx, sim);

    // 9b. Interactive 5-Stage Tactical Demo Callout Ticker Banner (top of scope)
    if (demoState?.active && sim.phase === 'ACTIVE_WAVE') {
      this.drawDemoTacticalTicker(ctx, demoState, timeSec);
    }

    // 9c. Active 2x Ballistic Predictor Boost Top Banner inside Radar Scope
    if (sim.predictorBoostTimer > 0 && sim.phase === 'ACTIVE_WAVE') {
      this.drawPredictorBoostBanner(ctx, sim, timeSec, demoState?.active ? 80 : 18);
    }

    // 10. Precision Vector Lead-Computing Reticle (or Amber AI Targeter during Tactical Demo!)
    if (demoState?.active && sim.phase === 'ACTIVE_WAVE' && !sim.paused) {
      this.drawLeadComputingReticle(ctx, sim, demoState.aiCursor, timeSec, demoState);
    } else if (cursorVirtual && cursorInsideScope && sim.phase === 'ACTIVE_WAVE' && !sim.paused) {
      this.drawLeadComputingReticle(ctx, sim, cursorVirtual, timeSec, null);
    }

    // Red-amber hull concussion rim flash on dome hit
    if (sim.domeHitFlashTimer > 0) {
      const a = Math.min(0.32, sim.domeHitFlashTimer * 0.36);
      ctx.fillStyle = `rgba(255, 51, 24, ${a.toFixed(3)})`;
      ctx.fillRect(0, 0, FLAK_CONSTANTS.VIRTUAL_W, FLAK_CONSTANTS.VIRTUAL_H);
    }

    ctx.restore();

    // Crisp Radar Scope Border Frame
    ctx.save();
    ctx.strokeStyle = sim.domeHitFlashTimer > 0 ? COLORS.RED_KLAXON : COLORS.GREEN_DIM;
    ctx.lineWidth = 2.0;
    ctx.strokeRect(viewport.x + 1, viewport.y + 1, viewport.width - 2, viewport.height - 2);
    ctx.restore();
  }

  private drawRadarBackdrop(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    timeSec: number
  ): void {
    const W = FLAK_CONSTANTS.VIRTUAL_W;
    const H = FLAK_CONSTANTS.VIRTUAL_H;
    const hy = FLAK_CONSTANTS.HORIZON_Y;

    // Subtle atmospheric radial depth gradient (cold upper orbit -> warm ionized lower horizon)
    const skyGrad = ctx.createRadialGradient(W * 0.5, hy, 80, W * 0.5, hy, W * 0.72);
    skyGrad.addColorStop(0, 'rgba(18, 56, 30, 0.24)');
    skyGrad.addColorStop(0.55, 'rgba(9, 30, 17, 0.14)');
    skyGrad.addColorStop(1, 'rgba(2, 7, 4, 0.96)');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // Concentric wide-angle Surface-to-Orbit Radar Range Arcs centered at Battery S (960, 978)
    ctx.save();
    ctx.strokeStyle = 'rgba(27, 94, 52, 0.32)';
    ctx.lineWidth = 1.4;
    const radii = [240, 480, 720, 960, 1180];
    for (const r of radii) {
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

    // Live Sweeping Surface-to-Orbit Radar Phosphor Line + Soft Wedge
    const sweepA = sim.radarSweepAngle;
    const sweepLen = 1220;
    ctx.strokeStyle = 'rgba(68, 255, 119, 0.22)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(W * 0.5, hy);
    ctx.lineTo(W * 0.5 + Math.cos(sweepA) * sweepLen, hy + Math.sin(sweepA) * sweepLen);
    ctx.stroke();

    // Altitude Scale Ticks along left & right scope margins
    ctx.font = 'bold 15px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(59, 224, 104, 0.42)';
    const altMarks = [
      { y: 120, lbl: '90KM' },
      { y: 300, lbl: '68KM' },
      { y: FLAK_CONSTANTS.MIRV_SPLIT_Y, lbl: '48KM' },
      { y: FLAK_CONSTANTS.DANGER_CLOSE_Y, lbl: '24KM' },
      { y: 840, lbl: '10KM' },
    ];
    for (const m of altMarks) {
      ctx.strokeStyle = 'rgba(59, 224, 104, 0.34)';
      ctx.beginPath();
      ctx.moveTo(0, m.y);
      ctx.lineTo(18, m.y);
      ctx.moveTo(W - 18, m.y);
      ctx.lineTo(W, m.y);
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillText(m.lbl, 24, m.y + 5);
      ctx.textAlign = 'right';
      ctx.fillText(m.lbl, W - 24, m.y + 5);
    }

    // MIRV Split Altitude Band (subtle telemetry line)
    ctx.setLineDash([8, 14]);
    ctx.strokeStyle = 'rgba(59, 224, 104, 0.22)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(86, FLAK_CONSTANTS.MIRV_SPLIT_Y);
    ctx.lineTo(W - 86, FLAK_CONSTANTS.MIRV_SPLIT_Y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.font = 'bold 13px "Share Tech Mono", monospace';
    ctx.fillStyle = 'rgba(68, 255, 119, 0.44)';
    ctx.fillText('MIRV SEPARATION THRESHOLD // 48KM', W - 92, FLAK_CONSTANTS.MIRV_SPLIT_Y - 7);

    // DANGER CLOSE // 3X Lower-Atmosphere Thermal Ignition Band!
    const dcY = FLAK_CONSTANTS.DANGER_CLOSE_Y;
    const dcPulse = 0.38 + 0.14 * Math.sin(timeSec * 3.5);
    ctx.setLineDash([16, 10]);
    ctx.strokeStyle = `rgba(255, 176, 0, ${dcPulse.toFixed(2)})`;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(86, dcY);
    ctx.lineTo(W - 86, dcY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Faint warm lower-atmosphere glow below DANGER_CLOSE_Y
    const dcBandGrad = ctx.createLinearGradient(0, dcY, 0, hy);
    dcBandGrad.addColorStop(0, 'rgba(255, 176, 0, 0.045)');
    dcBandGrad.addColorStop(1, 'rgba(255, 112, 24, 0.015)');
    ctx.fillStyle = dcBandGrad;
    ctx.fillRect(0, dcY, W, hy - dcY);

    ctx.textAlign = 'left';
    ctx.font = 'bold 15px "Share Tech Mono", monospace';
    ctx.fillStyle = 'rgba(255, 176, 0, 0.72)';
    ctx.fillText('▼ DANGER CLOSE // 3X THERMAL INTERCEPT BAND ▼', 92, dcY - 8);
    ctx.textAlign = 'right';
    ctx.fillText('THERMAL PLASMA IGNITION // 3X SCORE', W - 92, dcY - 8);

    ctx.restore();
  }

  private drawBallisticPredictions(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    timeSec: number
  ): void {
    const tRem = sim.predictorBoostTimer;
    const boostOn = tRem > 0;

    // Always-on crisp baseline trajectory arcs (0.68 alpha); supercharged to 1.0 during 2x+ Boost!
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
          // Fuzz/scramble prediction arc near active Ion Storm Jammer!
          const jx = Math.sin(timeSec * 38 + i * 2.9 + t.id) * 26;
          const jy = Math.cos(timeSec * 29 + i * 3.7) * 10;
          ctx.lineTo(pt.x + jx, pt.y + jy);
        } else {
          ctx.lineTo(pt.x, pt.y);
        }
      }

      ctx.setLineDash(jammed ? [5, 13] : boostOn ? [10, 8] : [7, 11]);
      if (jammed) {
        ctx.strokeStyle = 'rgba(142, 245, 171, 0.38)';
        ctx.lineWidth = 1.6;
      } else if (isLockedDome) {
        // Warning amber lock-on trajectory onto Colony Dome!
        const pulse = (boostOn ? 0.62 : 0.48) + 0.24 * Math.sin(timeSec * 10 + t.id);
        ctx.strokeStyle = `rgba(255, 176, 0, ${pulse.toFixed(2)})`;
        ctx.lineWidth = boostOn ? 2.3 : 1.85;
      } else {
        // Standard radar computer dotted phosphor trajectory (#1B5E34 -> brighter under boost)
        ctx.strokeStyle = boostOn ? 'rgba(68, 224, 118, 0.56)' : 'rgba(46, 152, 86, 0.42)';
        ctx.lineWidth = boostOn ? 1.8 : 1.45;
      }
      ctx.stroke();

      // Predicted ground impact marker on horizon (unless jammed!)
      if (!jammed && t.predictedImpactX > 20 && t.predictedImpactX < FLAK_CONSTANTS.VIRTUAL_W - 20) {
        ctx.setLineDash([]);
        const ix = t.predictedImpactX;
        const iy = FLAK_CONSTANTS.HORIZON_Y;
        ctx.strokeStyle = isLockedDome
          ? '#FFB000'
          : boostOn
            ? 'rgba(68, 255, 119, 0.58)'
            : 'rgba(59, 224, 104, 0.42)';
        ctx.lineWidth = isLockedDome ? 2.2 : 1.5;
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

  private drawHorizonAndInstallations(
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

      ctx.strokeStyle = '#3BE068';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      for (let i = 0; i < sim.horizonProfile.length; i++) {
        const p = sim.horizonProfile[i];
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      // Secondary technical ground baseline beneath installations
      ctx.strokeStyle = 'rgba(35, 140, 64, 0.42)';
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
        const mainCol = savedGlow ? '#8EF5AB' : '#44FF77';
        const fillCol = savedGlow
          ? 'rgba(142, 245, 171, 0.24)'
          : 'rgba(26, 98, 52, 0.34)';

        // Pressurized geodesic dome shell
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

        // Geodesic rib struts & pressurized interior deck lines
        ctx.strokeStyle = 'rgba(68, 255, 119, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, r * 0.46, r, 0, Math.PI, Math.PI * 2);
        ctx.moveTo(d.x - r * 0.85, d.y - r * 0.48);
        ctx.lineTo(d.x + r * 0.85, d.y - r * 0.48);
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x, d.y - r - 11);
        ctx.stroke();

        // Blinking amber aviation beacon atop dome spire
        const blink = Math.sin(timeSec * 5 + d.x * 0.02) > 0.25;
        ctx.fillStyle = blink ? '#FFB000' : 'rgba(255, 176, 0, 0.35)';
        ctx.beginPath();
        ctx.arc(d.x, d.y - r - 12, 3.6, 0, Math.PI * 2);
        ctx.fill();

        // Reinforced bunker foundation pad
        ctx.fillStyle = '#0B2816';
        ctx.fillRect(d.x - r - 6, d.y, (r + 6) * 2, 12);
        ctx.strokeStyle = mainCol;
        ctx.lineWidth = 2.0;
        ctx.strokeRect(d.x - r - 6, d.y, (r + 6) * 2, 12);

        ctx.textAlign = 'center';
        ctx.font = 'bold 16px "Share Tech Mono", monospace';
        ctx.fillStyle = savedGlow ? '#FFF6CC' : '#8EF5AB';
        ctx.fillText(d.label, d.x, d.y + 34);
      } else {
        // Breached Colony Dome Ruin
        const flash = d.breachFlashTimer > 0 && Math.sin(timeSec * 24) > 0;
        ctx.strokeStyle = flash ? '#FF6644' : '#8A2418';
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

        ctx.textAlign = 'center';
        ctx.font = 'bold 15px "Share Tech Mono", monospace';
        ctx.fillStyle = COLORS.RED_KLAXON;
        ctx.fillText(`${d.label} [LOST]`, d.x, d.y + 34);
      }
      ctx.restore();
    }

    // 3. 3 Surface Defense Batteries (A: Left Flak, S: Center EMP Mortar, D: Right Flak)
    for (const b of sim.batteries) {
      const isEmp = b.weaponType === 'MK4_EMP';
      const accent = isEmp ? '#FFB000' : '#44FF77';
      const ready = b.ammo > 0;

      ctx.save();
      // Armored bunker pedestal
      ctx.fillStyle = isEmp ? 'rgba(42, 26, 6, 0.92)' : 'rgba(10, 32, 18, 0.92)';
      ctx.strokeStyle = ready ? accent : COLORS.GREEN_DIM;
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
        // Wide heavy EMP Mortar tube + glowing capacitor rings
        ctx.fillStyle = '#241706';
        ctx.strokeStyle = ready ? '#FFB000' : '#6E4C08';
        ctx.lineWidth = 2.4;
        ctx.fillRect(0, -8, barrelLen, 16);
        ctx.strokeRect(0, -8, barrelLen, 16);
        ctx.strokeStyle = '#FFF6CC';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(12, -10);
        ctx.lineTo(12, 10);
        ctx.moveTo(22, -10);
        ctx.lineTo(22, 10);
        ctx.stroke();
      } else {
        // Twin M90 Proximity Flak Rail Barrels
        ctx.strokeStyle = ready ? '#8EF5AB' : COLORS.GREEN_MID;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(0, -4.5);
        ctx.lineTo(barrelLen, -4.5);
        ctx.moveTo(0, 4.5);
        ctx.lineTo(barrelLen, 4.5);
        ctx.stroke();
      }

      // Muzzle Flash Vector Flare
      if (b.muzzleFlashTimer > 0) {
        ctx.fillStyle = isEmp ? '#FFF6CC' : '#FFE08A';
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
      const pipY = b.y + 18;
      for (let i = 0; i < pipCount; i++) {
        const px = startX + i * (pipW + pipGap);
        if (i < b.ammo) {
          ctx.fillStyle = accent;
          ctx.fillRect(px, pipY, pipW, 8);
        } else if (i === b.ammo && !isEmp && b.reloadProgress > 0) {
          ctx.fillStyle = 'rgba(20, 52, 30, 0.85)';
          ctx.fillRect(px, pipY, pipW, 8);
          ctx.fillStyle = '#FFB000';
          ctx.fillRect(px, pipY, pipW * b.reloadProgress, 8);
        } else {
          ctx.strokeStyle = 'rgba(68, 255, 119, 0.35)';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(px, pipY, pipW, 8);
        }
      }

      ctx.textAlign = 'center';
      ctx.font = 'bold 16px "Share Tech Mono", monospace';
      ctx.fillStyle = accent;
      ctx.fillText(isEmp ? '[S] MK-IV EMP' : `[${b.id}] M90 FLAK`, b.x, b.y + 48);
      ctx.restore();
    }

    ctx.restore();
  }

  private drawOrbitalDropPod(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    timeSec: number
  ): void {
    const pod = sim.dropPod;
    if (!pod) return;

    ctx.save();
    // Retro-braking thruster trail
    ctx.strokeStyle = 'rgba(142, 245, 171, 0.75)';
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.moveTo(pod.x, pod.y);
    ctx.lineTo(pod.x + 48, pod.y - 84);
    ctx.stroke();

    // Drop-pod diamond capsule + amber retro-plume
    ctx.fillStyle = '#8EF5AB';
    ctx.beginPath();
    ctx.moveTo(pod.x, pod.y - 16);
    ctx.lineTo(pod.x + 12, pod.y);
    ctx.lineTo(pod.x, pod.y + 14);
    ctx.lineTo(pod.x - 12, pod.y);
    ctx.closePath();
    ctx.fill();

    const flame = 18 + Math.sin(timeSec * 55) * 6;
    ctx.strokeStyle = '#FFB000';
    ctx.lineWidth = 4.0;
    ctx.beginPath();
    ctx.moveTo(pod.x, pod.y + 14);
    ctx.lineTo(pod.x, pod.y + 14 + flame);
    ctx.stroke();

    ctx.font = 'bold 15px "Share Tech Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.textAlign = 'left';
    ctx.fillText('ORBITAL DROP-POD // RESTORE', pod.x + 18, pod.y - 4);
    ctx.restore();
  }

  private drawInterceptorShells(ctx: CanvasRenderingContext2D, sim: FlakSimulation): void {
    ctx.save();
    for (const s of sim.shells) {
      // Target detonation marker crosshair
      ctx.strokeStyle = s.isEmp ? 'rgba(255, 176, 0, 0.85)' : 'rgba(142, 245, 171, 0.75)';
      ctx.lineWidth = 2.0;
      const sz = s.isEmp ? 12 : 8;
      ctx.beginPath();
      ctx.moveTo(s.targetX - sz, s.targetY - sz);
      ctx.lineTo(s.targetX + sz, s.targetY + sz);
      ctx.moveTo(s.targetX + sz, s.targetY - sz);
      ctx.lineTo(s.targetX - sz, s.targetY + sz);
      ctx.stroke();

      // Outgoing luminous shell trail
      if (s.trail.length > 1) {
        ctx.strokeStyle = s.isEmp ? '#FFB000' : '#8EF5AB';
        ctx.lineWidth = s.isEmp ? 4.0 : 2.6;
        ctx.beginPath();
        for (let i = 0; i < s.trail.length; i++) {
          const p = s.trail[i];
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }

      // Bright shell warhead core
      ctx.fillStyle = '#FFF6CC';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.isEmp ? 6.5 : 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawThreats(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    timeSec: number
  ): void {
    ctx.save();
    let shownMeteorHint = false;
    let shownDcHint = false;
    for (const t of sim.threats) {
      // Atmospheric Re-Entry Thermal Transition:
      // Upper orbit -> Cold P39 Green (#44FF77); Lower atmosphere (Danger Close) -> Blinding Amber/White Plasma!
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

      // 1. Re-Entry Trail (cold dim green upper orbit -> blazing white-amber plasma streak in lower atm!)
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

      // 2. Threat Vector Geometry by Signature
      ctx.save();
      ctx.translate(t.x, t.y);

      if (t.kind === 'KINETIC_ROD') {
        ctx.rotate(t.angle);
        // Blazing thermal bow-shock arc in lower atmosphere
        if (isHot) {
          ctx.strokeStyle = '#FFF6CC';
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.arc(4, 0, 14, -Math.PI * 0.42, Math.PI * 0.42);
          ctx.stroke();
        }
        ctx.strokeStyle = coreCol;
        ctx.fillStyle = isHot ? '#FFF6CC' : coreCol;
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
        // Rotating armored jagged polygonal meteor vector
        ctx.save();
        ctx.rotate(t.angle);
        ctx.fillStyle =
          t.hitFlashTimer > 0
            ? 'rgba(255, 246, 204, 0.72)'
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

        // Inner armor cross-rib lines (marks it instantly as high-mass deflectable rock!)
        ctx.strokeStyle = isHot ? '#FFF6CC' : 'rgba(142, 245, 171, 0.55)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-t.radius * 0.5, -t.radius * 0.3);
        ctx.lineTo(t.radius * 0.5, t.radius * 0.3);
        ctx.moveTo(t.radius * 0.35, -t.radius * 0.45);
        ctx.lineTo(-t.radius * 0.35, t.radius * 0.45);
        ctx.stroke();
        ctx.restore();

        // Deflected glowing motion halo ring if currently flying off-course from a shockwave!
        if (t.deflectedTimer > 0) {
          ctx.strokeStyle = '#FFF6CC';
          ctx.lineWidth = 1.8;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.arc(0, 0, t.radius + 9, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if (t.kind === 'MIRV_POD') {
        // High-altitude pulsing amber diamond carrying multiple warheads
        const pulse = 1 + Math.sin(timeSec * 12) * 0.1;
        ctx.strokeStyle = '#FFB000';
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

        // 3 Internal sub-munition cores
        ctx.fillStyle = '#FFF6CC';
        for (const ox of [-6, 0, 6]) {
          ctx.beginPath();
          ctx.arc(ox, ox === 0 ? -4 : 4, 2.8, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (t.kind === 'ION_JAMMER') {
        // Pulsing Ion Storm Jammer hex + horizontal interference bars + radius ring
        ctx.strokeStyle = 'rgba(142, 245, 171, 0.24)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([10, 12]);
        ctx.beginPath();
        ctx.arc(0, 0, t.jamRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Horizontal CRT static interference waves radiating from jammer
        ctx.strokeStyle = '#8EF5AB';
        ctx.lineWidth = 2.0;
        for (let wIdx = -2; wIdx <= 2; wIdx++) {
          const wy = wIdx * 9 + Math.sin(timeSec * 24 + wIdx) * 3;
          const half = 28 - Math.abs(wIdx) * 6 + Math.cos(timeSec * 36 + wIdx) * 8;
          ctx.beginPath();
          ctx.moveTo(-half, wy);
          ctx.lineTo(half, wy);
          ctx.stroke();
        }

        ctx.strokeStyle = '#FFF6CC';
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

      // 3. Crisp Diegetic Telemetry Tag next to Threat (altitude km, armor HP, or signature)
      if (t.y > 16) {
        const altKm = Math.max(
          0,
          ((FLAK_CONSTANTS.HORIZON_Y - t.y) / FLAK_CONSTANTS.HORIZON_Y) * 98
        );
        ctx.textAlign = 'left';
        ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
        ctx.fillStyle = isHot
          ? '#FFF6CC'
          : t.kind === 'MIRV_POD'
            ? '#FFB000'
            : t.kind === 'ION_JAMMER'
              ? '#8EF5AB'
              : 'rgba(110, 255, 152, 0.85)';

        let tag = `${altKm.toFixed(1)}KM`;
        if (t.kind === 'HEAVY_METEOR') {
          tag = `HVY [${'█'.repeat(Math.max(1, t.hp))}] ${altKm.toFixed(0)}KM`;
        } else if (t.kind === 'MIRV_POD') {
          tag = `MIRV // ${altKm.toFixed(0)}KM`;
        } else if (t.kind === 'ION_JAMMER') {
          tag = 'ION JAMMER';
        } else if (isHot) {
          tag = `3X ${altKm.toFixed(1)}KM`;
        }
        ctx.fillText(tag, t.x + t.radius + 8, t.y + 4);

        // Wave-1 diegetic micro-hints (unobtrusive, one per mechanic, disappear once executed)
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
            ctx.font = 'bold 12px "Share Tech Mono", monospace';
            ctx.fillStyle = '#FFB000';
            ctx.fillText('◄ AIM BESIDE TO DEFLECT!', t.x + t.radius + 8, t.y + 20);
          } else if (
            !shownDcHint &&
            t.kind === 'KINETIC_ROD' &&
            sim.dangerCloseKills === 0 &&
            t.y > 470 &&
            t.y < FLAK_CONSTANTS.DANGER_CLOSE_Y + 32
          ) {
            shownDcHint = true;
            ctx.font = 'bold 12px "Share Tech Mono", monospace';
            ctx.fillStyle = '#FFE082';
            ctx.fillText('▼ WAIT BELOW 24KM FOR 3X!', t.x + t.radius + 8, t.y + 20);
          }
        }
      }
    }
    ctx.restore();
  }

  private thermalColor(t: OrbitalThreat, thermalT: number, timeSec: number): string {
    if (t.kind === 'MIRV_POD') return '#FFB000';
    if (t.kind === 'ION_JAMMER') {
      return Math.sin(timeSec * 18) > 0 ? '#8EF5AB' : '#44FF77';
    }
    if (thermalT < 0.22) return '#44FF77';
    if (thermalT < 0.65) return '#FFB000';
    return '#FFF6CC';
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
        // Massive Mk-IV EMP Shockwave Blast: white-hot core flash + emerald/amber double wavefront + EM arcs
        const grad = ctx.createRadialGradient(
          b.x,
          b.y,
          b.currentRadius * 0.08,
          b.x,
          b.y,
          b.currentRadius
        );
        grad.addColorStop(0, `rgba(255, 246, 204, ${(0.55 * fade).toFixed(2)})`);
        grad.addColorStop(0.42, `rgba(142, 245, 171, ${(0.32 * fade).toFixed(2)})`);
        grad.addColorStop(0.82, `rgba(255, 176, 0, ${(0.24 * fade).toFixed(2)})`);
        grad.addColorStop(1, 'rgba(68, 255, 119, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.currentRadius, 0, Math.PI * 2);
        ctx.fill();

        // Outer EMP shockwave crest ring
        ctx.strokeStyle = `rgba(255, 246, 204, ${(0.95 * fade).toFixed(2)})`;
        ctx.lineWidth = 4.2 * fade + 1.4;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.currentRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Secondary trailing harmonic oscilloscope ring
        ctx.strokeStyle = `rgba(142, 245, 171, ${(0.78 * fade).toFixed(2)})`;
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
        // M90 Proximity Flak Airburst: blinding flash core + radial pressure ring
        const grad = ctx.createRadialGradient(
          b.x,
          b.y,
          4,
          b.x,
          b.y,
          b.currentRadius
        );
        grad.addColorStop(0, `rgba(255, 250, 224, ${(0.68 * fade).toFixed(2)})`);
        grad.addColorStop(0.45, `rgba(255, 176, 0, ${(0.36 * fade).toFixed(2)})`);
        grad.addColorStop(1, 'rgba(255, 140, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.currentRadius, 0, Math.PI * 2);
        ctx.fill();

        // Crisp pressure-wave outer perimeter ring (shows exact shockwave deflection boundary!)
        ctx.strokeStyle = `rgba(255, 224, 138, ${(0.92 * fade).toFixed(2)})`;
        ctx.lineWidth = 3.0 * fade + 1.0;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.currentRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Inner vaporization core ring during peak flash
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

  private drawScorePopups(ctx: CanvasRenderingContext2D, sim: FlakSimulation): void {
    ctx.save();
    ctx.textAlign = 'center';
    for (const pop of sim.popups) {
      const p = pop.age / pop.duration;
      const alpha = p < 0.15 ? p / 0.15 : Math.max(0, 1 - (p - 0.15) / 0.85);
      ctx.globalAlpha = alpha;
      ctx.font = 'bold 21px "Share Tech Mono", monospace';
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, pop.x, pop.y);
      if (pop.subText) {
        ctx.font = 'bold 14.5px "JetBrains Mono", monospace';
        ctx.fillStyle = '#FFB000';
        ctx.fillText(pop.subText, pop.x, pop.y + 18);
      }
    }
    ctx.restore();
  }

  private drawLeadComputingReticle(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    cursor: Vec2,
    timeSec: number,
    demoState: DemoTelemetryState | null = null
  ): void {
    const info = sim.getReticleInfo(cursor);
    const isAi = Boolean(demoState?.active);
    const cx = cursor.x;
    const cy = Math.min(FLAK_CONSTANTS.HORIZON_Y - 34, cursor.y);

    ctx.save();

    // 1. Faint vector fire-control line from active battery (or EMP battery during AI EMP lock) to reticle
    const lineOrigin =
      isAi && demoState?.aiWeaponMode === 'EMP'
        ? sim.batteries[1]
        : info.activeFlakBattery;
    if (lineOrigin) {
      ctx.strokeStyle = isAi ? 'rgba(255, 176, 0, 0.34)' : 'rgba(68, 255, 119, 0.22)';
      ctx.lineWidth = isAi ? 1.8 : 1.4;
      ctx.setLineDash([6, 10]);
      ctx.beginPath();
      ctx.moveTo(lineOrigin.x, lineOrigin.y - 16);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 2. Lead-Computing Intercept Ghost Pips (ONLY active during 2x+ Ballistic Predictor Boost!)
    if (sim.predictorBoostTimer > 0) {
      const pipFade = sim.predictorBoostTimer < 1.5 ? Math.max(0.2, sim.predictorBoostTimer / 1.5) : 1.0;
      ctx.save();
      ctx.globalAlpha = pipFade;
      for (const t of sim.threats) {
        const distToCursor = Math.hypot(t.x - cx, t.y - cy);
        if (distToCursor > 360) continue;
        if (sim.isPositionJammed(t.x, t.y) && t.kind !== 'ION_JAMMER') continue;

        const tof = info.flakTofSec;
        const g = FLAK_CONSTANTS.GRAVITY * t.gravityScale;
        const lx = t.x + t.vx * tof + 0.5 * t.orbitalDriftAx * tof * tof;
        const ly = t.y + t.vy * tof + 0.5 * g * tof * tof;
        if (ly > FLAK_CONSTANTS.HORIZON_Y - 12 || ly < 10) continue;

        ctx.strokeStyle = 'rgba(255, 176, 0, 0.52)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        ctx.lineTo(lx, ly);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = 'rgba(255, 224, 138, 0.78)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(lx, ly, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2b. Live Billiard Deflection Vector Preview when hovering off-center beside a Heavy Meteor!
    const deflectPrev = sim.getDeflectionPreview({ x: cx, y: cy });
    if (deflectPrev && deflectPrev.arc.length >= 2) {
      const billiard = deflectPrev.hitsOtherThreat;
      const pulse = 0.78 + 0.22 * Math.sin(timeSec * 16);
      const col = billiard ? '#FFF6CC' : '#FFB000';

      ctx.save();
      // Subtle Flak radial shockwave boundary around reticle showing exact shove reach
      ctx.strokeStyle = billiard
        ? `rgba(255, 246, 204, ${(0.48 * pulse).toFixed(2)})`
        : 'rgba(255, 176, 0, 0.34)';
      ctx.lineWidth = billiard ? 1.8 : 1.4;
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      ctx.arc(cx, cy, FLAK_CONSTANTS.FLAK_BLAST_RADIUS, 0, Math.PI * 2);
      ctx.stroke();

      // Predicted post-shove curved billiard trajectory out of the meteor
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

      // Vector arrowhead at tip of predicted deflection arc
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

      // Crisp diegetic deflection callout tag at midpoint/tip
      ctx.textAlign = 'center';
      ctx.font = billiard
        ? 'bold 14.5px "Share Tech Mono", monospace'
        : 'bold 12.5px "Share Tech Mono", monospace';
      ctx.fillStyle = col;
      ctx.fillText(
        billiard ? '★ BILLIARD KILL! ★' : 'DEFLECT VECTOR →',
        Math.max(90, Math.min(FLAK_CONSTANTS.VIRTUAL_W - 90, tip.x)),
        Math.max(28, tip.y - 12)
      );
      ctx.restore();
    }

    // 3. Main Oscilloscope Fire-Control Reticle (or Amber AI Targeter during Tactical Demo!)
    if (isAi && demoState) {
      const mode = demoState.aiWeaponMode;
      const aiPulse = 0.72 + 0.28 * Math.sin(timeSec * 14);
      const primaryCol = mode === 'EMP' ? '#FFF6CC' : '#FFB000';
      const r = mode === 'EMP' ? 32 : 26;

      // Rotating Amber Diamond Targeter Frame
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI * 0.25 + timeSec * (mode === 'DEFLECT_AIM' ? 1.3 : 0.7));
      ctx.strokeStyle = primaryCol;
      ctx.lineWidth = 2.6;
      const dHalf = r * 0.85;
      ctx.strokeRect(-dHalf, -dHalf, dHalf * 2, dHalf * 2);
      ctx.restore();

      // Segmented Outer AI Lock Ring
      ctx.strokeStyle = `rgba(255, 176, 0, ${aiPulse.toFixed(2)})`;
      ctx.lineWidth = 2.4;
      const rot = -timeSec * 1.1;
      for (let k = 0; k < 4; k++) {
        const a0 = rot + k * (Math.PI * 0.5) + 0.22;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 9, a0, a0 + 0.85);
        ctx.stroke();
      }

      // Precision Amber Crosshair Ticks + Hot Center Pip
      ctx.strokeStyle = '#FFF6CC';
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

      ctx.fillStyle = '#FFF6CC';
      ctx.beginPath();
      ctx.arc(cx, cy, 3.4, 0, Math.PI * 2);
      ctx.fill();

      // AI Targeter Telemetry Tag
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
      const tagX = cx > FLAK_CONSTANTS.VIRTUAL_W - 340 ? cx - 38 : cx + 38;
      ctx.textAlign = cx > FLAK_CONSTANTS.VIRTUAL_W - 340 ? 'right' : 'left';
      ctx.font = 'bold 14px "Share Tech Mono", monospace';
      ctx.fillStyle = '#FFB000';
      ctx.fillText(`AI TARGETER // ${modeTag}`, tagX, cy - 8);
      ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#FFF6CC';
      ctx.fillText(`AUTO-SOLVER 60HZ // TOF ${tofStr}S`, tagX, cy + 13);

      ctx.restore();
      return;
    }

    const readyCol = info.activeFlakBattery ? '#44FF77' : '#FFB000';
    const r = 24;
    ctx.strokeStyle = readyCol;
    ctx.lineWidth = 2.2;

    // 4 Corner precision arcs
    const rot = timeSec * 0.65;
    for (let k = 0; k < 4; k++) {
      const a0 = rot + k * (Math.PI * 0.5) + 0.25;
      const a1 = a0 + 0.95;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a1);
      ctx.stroke();
    }

    // Inner precision crosshair ticks
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

    // Center pip
    ctx.fillStyle = '#FFF6CC';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.8, 0, Math.PI * 2);
    ctx.fill();

    // Reticle Live Telemetry Tag (Battery lock + Time-of-Flight + EMP Ready indicator)
    ctx.textAlign = 'left';
    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    ctx.fillStyle = readyCol;
    const batLabel = info.activeFlakBattery ? `BAT-${info.activeFlakBattery.id}` : 'RELOADING';
    ctx.fillText(`${batLabel} // TOF ${info.flakTofSec.toFixed(2)}S`, cx + 32, cy - 6);

    ctx.fillStyle = info.empReady ? '#FFB000' : 'rgba(255, 176, 0, 0.42)';
    ctx.fillText(
      info.empReady ? `[RMB] EMP READY (${info.empTofSec.toFixed(2)}S)` : '[RMB] EMP EMPTY',
      cx + 32,
      cy + 14
    );

    ctx.restore();
  }

  private drawDemoTacticalTicker(
    ctx: CanvasRenderingContext2D,
    demo: DemoTelemetryState,
    timeSec: number
  ): void {
    const bx = 22;
    const by = 10;
    const bw = FLAK_CONSTANTS.VIRTUAL_W - 44;
    const bh = 62;
    const exitPulse = 0.65 + 0.35 * Math.sin(timeSec * 6.5);

    ctx.save();
    ctx.fillStyle = 'rgba(14, 10, 2, 0.76)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = 'rgba(255, 176, 0, 0.88)';
    ctx.lineWidth = 2.0;
    ctx.strokeRect(bx, by, bw, bh);

    // Stage progress pips (1..5) + Stage Title on top-left
    const pips = `${'■'.repeat(demo.stageIndex)}${'□'.repeat(Math.max(0, demo.totalStages - demo.stageIndex))}`;
    ctx.textAlign = 'left';
    ctx.font = 'bold 16.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(
      `MU-TH-UR TACTICAL BRIEFING [${pips}] ${demo.stageTitle}`,
      bx + 18,
      by + 24
    );

    // Pulsing Instant Exit Prompt on top-right
    ctx.textAlign = 'right';
    ctx.font = 'bold 16.5px "Share Tech Mono", monospace';
    ctx.fillStyle = `rgba(255, 246, 204, ${exitPulse.toFixed(2)})`;
    ctx.fillText('[SPACE / ESC / CLICK] EXIT DEMO', bx + bw - 18, by + 24);

    // Live MU-TH-UR Tactical AI Callout Ticker on bottom-left
    ctx.textAlign = 'left';
    ctx.font = 'bold 15.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText(demo.calloutText, bx + 18, by + 49, bw - 560);

    // Milestone confirmation badge on bottom-right once stage objective executes!
    if (demo.milestoneBanner) {
      ctx.textAlign = 'right';
      ctx.font = 'bold 15px "Share Tech Mono", monospace';
      ctx.fillStyle = '#FFF6CC';
      ctx.fillText(`✓ ${demo.milestoneBanner}`, bx + bw - 18, by + 49);
    }

    ctx.restore();
  }

  private drawPredictorBoostBanner(
    ctx: CanvasRenderingContext2D,
    sim: FlakSimulation,
    timeSec: number,
    by = 18
  ): void {
    const bw = 568;
    const bh = 38;
    const bx = (FLAK_CONSTANTS.VIRTUAL_W - bw) * 0.5;
    const frac = Math.max(0, Math.min(1, sim.predictorBoostTimer / sim.predictorBoostMaxSec));
    const lowWarn = sim.predictorBoostTimer < 2.5;
    const overclocked = sim.liveChain >= 4;
    const pulse = (lowWarn || overclocked) && Math.sin(timeSec * 18) > 0;

    ctx.save();
    ctx.fillStyle = overclocked ? 'rgba(28, 22, 5, 0.88)' : 'rgba(4, 18, 9, 0.84)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = overclocked ? '#FFB000' : pulse ? '#FFB000' : '#44FF77';
    ctx.lineWidth = 2.0;
    ctx.strokeRect(bx, by, bw, bh);

    ctx.textAlign = 'center';
    ctx.font = 'bold 16px "Share Tech Mono", monospace';
    ctx.fillStyle = overclocked ? (pulse ? '#FFF6CC' : '#FFB000') : pulse ? '#FFF6CC' : '#8EF5AB';
    const bannerLabel = overclocked
      ? `► x${sim.liveChain} OVERCLOCK // LEAD PIPS + FAST AUTOLOADER (${sim.predictorBoostTimer.toFixed(1)}S) ◄`
      : `► 2X BOOST // LEAD PIPS + FAST AUTOLOADER (${sim.predictorBoostTimer.toFixed(1)}S) ◄`;
    ctx.fillText(bannerLabel, bx + bw * 0.5, by + 21);

    ctx.fillStyle = 'rgba(18, 46, 28, 0.8)';
    ctx.fillRect(bx + 14, by + 28, bw - 28, 5);
    ctx.fillStyle = lowWarn || overclocked ? '#FFB000' : '#44FF77';
    ctx.fillRect(bx + 14, by + 28, (bw - 28) * frac, 5);
    ctx.restore();
  }

  private drawOrbitalBoss(
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
    const jitterX = isDying ? Math.sin(timeSec * 85) * 9 : isStunned ? Math.sin(timeSec * 62) * 3 : 0;
    const jitterY = isDying ? Math.cos(timeSec * 72) * 7 : 0;
    const bx = boss.x + jitterX;
    const by = boss.y + jitterY;

    // 1. Telegraph Laser Lock Sightlines down to targeted Colony Domes during salvo charge!
    if (isCharging && !isDying) {
      const chargeFrac = 1 - boss.chargeTimer / Math.max(0.01, boss.chargeDuration);
      const pulse = 0.45 + 0.45 * Math.sin(timeSec * 36);
      ctx.save();
      ctx.setLineDash([12, 8]);
      ctx.lineWidth = 2.0 + chargeFrac * 2.2;
      ctx.strokeStyle = `rgba(255, 68, 34, ${(0.35 + pulse * 0.55).toFixed(2)})`;
      for (const dId of boss.targetDomeIds) {
        const dome = sim.domes.find((d) => d.id === dId && d.intact);
        if (!dome) continue;
        ctx.beginPath();
        ctx.moveTo(bx, by + 24);
        ctx.lineTo(dome.x, dome.y - dome.radius);
        ctx.stroke();

        // Locking brackets on targeted dome
        ctx.setLineDash([]);
        ctx.strokeStyle = '#FF4422';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(dome.x, dome.y - 10, dome.radius + 14 + (1 - chargeFrac) * 28, Math.PI, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([12, 8]);
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 2. Massive 1979 Vector Warship Chassis Silhouette (Armored Dreadnought Carrier)
    ctx.save();
    ctx.translate(bx, by);
    const hullCol = isDying
      ? '#FFF6CC'
      : boss.hitFlashTimer > 0
        ? '#FFF6CC'
        : isStunned
          ? '#8EF5AB'
          : isCharging
            ? '#FF4422'
            : '#FFB000';

    ctx.fillStyle = isDying
      ? 'rgba(255, 176, 0, 0.32)'
      : isStunned
        ? 'rgba(24, 96, 62, 0.45)'
        : 'rgba(28, 12, 6, 0.88)';

    // Outer armored crescent/wing wireframe hull
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

    // Inner structural ribs & sensor spine
    ctx.strokeStyle = isStunned ? '#44FF77' : 'rgba(255, 176, 0, 0.55)';
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

    // EMP Stun crackling plasma arcs across chassis
    if (isStunned) {
      ctx.strokeStyle = '#8EF5AB';
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

    // 3. Three Targetable Weapon Hardpoints (PORT RAIL | REACTOR CORE | STBD RAIL)
    for (const hp of boss.hardpoints) {
      ctx.save();
      ctx.translate(hp.offsetX, hp.offsetY);
      if (hp.destroyed) {
        // Charred smoking crater X
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
              ? '#FF4422'
              : hp.id === 'CORE'
                ? '#FFF6CC'
                : '#FFB000';
        const r = hp.radius * 0.72;
        ctx.fillStyle = isCharging ? 'rgba(255, 68, 34, 0.38)' : 'rgba(255, 176, 0, 0.22)';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = nodeCol;
        ctx.lineWidth = 2.6;
        ctx.stroke();

        // Pulsing target bracket corners around active hardpoints so players immediately know where to shoot!
        const bPulse = 4 + Math.sin(timeSec * 12) * 3;
        const br = r + bPulse;
        ctx.strokeStyle = hp.id === 'CORE' ? '#FFF6CC' : '#FF4422';
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

        // Micro HP bar beneath hardpoint
        const frac = Math.max(0, hp.hp / Math.max(1, hp.maxHp));
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(-20, r + 8, 40, 6);
        ctx.fillStyle = hp.id === 'CORE' ? '#FFF6CC' : '#FFB000';
        ctx.fillRect(-19, r + 9, 38 * frac, 4);
      }
      ctx.restore();
    }
    ctx.restore();

    // 4. Top-Center BOSS INTEGRITY TELEMETRY BAR (pushed below Predictor banner if both active)
    const barW = 660;
    const barH = 44;
    const barX = (FLAK_CONSTANTS.VIRTUAL_W - barW) * 0.5;
    const barY = sim.predictorBoostTimer > 0 ? 64 : 18;
    const hpFrac = Math.max(0, boss.hp / Math.max(1, boss.maxHp));

    ctx.fillStyle = 'rgba(18, 6, 4, 0.88)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.strokeStyle = isStunned ? '#8EF5AB' : '#FF4422';
    ctx.lineWidth = 2.2;
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.textAlign = 'left';
    ctx.font = 'bold 16px "Share Tech Mono", monospace';
    ctx.fillStyle = isStunned ? '#8EF5AB' : '#FFB000';
    ctx.fillText(`⚠ BOSS CONTACT // ${boss.designation}`, barX + 14, barY + 20);

    ctx.textAlign = 'right';
    ctx.font = 'bold 14.5px "JetBrains Mono", monospace';
    ctx.fillStyle = isStunned ? '#8EF5AB' : isCharging ? '#FF4422' : '#FFF6CC';
    ctx.fillText(
      isDying
        ? 'CORE COLLAPSING...'
        : isStunned
          ? `EMP STUNNED ${boss.empStunTimer.toFixed(1)}S`
          : isCharging
            ? 'SALVO LOCKING!'
            : `HULL ${Math.round(hpFrac * 100)}%`,
      barX + barW - 14,
      barY + 20
    );

    ctx.fillStyle = 'rgba(42, 12, 8, 0.9)';
    ctx.fillRect(barX + 14, barY + 28, barW - 28, 10);
    ctx.fillStyle = isStunned ? '#44FF77' : isCharging ? '#FF4422' : '#FFB000';
    ctx.fillRect(barX + 14, barY + 28, (barW - 28) * hpFrac, 10);

    ctx.restore();
  }
}
