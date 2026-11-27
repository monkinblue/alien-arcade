import { THEME } from '../../render/theme';
import type { ViewportRect } from '../../types';
import type { TrenchSimulation } from './TrenchSimulation';
import {
  TRENCH_CONSTANTS,
  type CanyonArch,
  type CanyonTarget,
  type WireframeExplosion,
} from './types';

interface ProjPt {
  sx: number;
  sy: number;
  cz: number;
  scale: number;
}

type DepthDrawable =
  | {
      kind: 'QUAD';
      depth: number;
      p0: ProjPt;
      p1: ProjPt;
      p2: ProjPt;
      p3: ProjPt;
      avgH: number;
      slope: number;
    }
  | {
      kind: 'TARGET';
      depth: number;
      target: CanyonTarget;
    }
  | {
      kind: 'ARCH';
      depth: number;
      arch: CanyonArch;
    }
  | {
      kind: 'EXPLOSION';
      depth: number;
      explosion: WireframeExplosion;
    };

interface SkyStar {
  dx: number;
  dy: number;
  dz: number;
  brightness: number;
}

/**
 * First-Person F-16 3D Wireframe Open-Valley Terrain & Strike Renderer.
 * - True 1st-person perspective camera (~75° FOV, dynamic stretch on Afterburner) with 4,000m sightlines.
 * - World-snapped heightmap mesh with strict **hidden-line / painter's-algorithm occlusion**
 *   (solid `#020804` terrain quad fills behind crisp P39 `#44FF77` edges -> `#061C0E` horizon fog)
 *   so distant alpine peaks NEVER bleed through foreground mesas & ridges!
 * - Zero-clutter 3-class unmistakable silhouettes:
 *   1. `SAM_SITE` (#FF3322 Red-Amber): Tall rotating radar tower + twin launcher rails
 *   2. `BANDIT_DRONE` (#FFB000 Bright Amber): Delta-wing fighter-drone + glowing phosphor contrails
 *   3. `RESUPPLY_CACHE` (#00F0FF Electric Cyan): Glowing 3D hexagonal supply pod
 */
export class TrenchRenderer {
  private focalLen = 900;
  private cx = 960;
  private cy = 420;
  private stars: SkyStar[] = [];

  constructor() {
    // Deterministic upper-hemisphere LV-426 starfield
    let s = 0x9e3779b9;
    const rand = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 85; i++) {
      const az = rand() * Math.PI * 2;
      const el = 0.04 + rand() * 0.92;
      this.stars.push({
        dx: Math.sin(az) * Math.cos(el),
        dy: Math.sin(el),
        dz: Math.cos(az) * Math.cos(el),
        brightness: 0.25 + rand() * 0.65,
      });
    }
  }

  public projectWorld(sim: TrenchSimulation, wx: number, wy: number, wz: number): ProjPt | null {
    const rx = wx - sim.x;
    const ry = wy - sim.y;
    const rz = wz - sim.z;

    const { right, up, forward } = sim.basis;
    const cz = rx * forward.x + ry * forward.y + rz * forward.z;
    if (cz < TRENCH_CONSTANTS.NEAR_CLIP) return null;

    const cx = rx * right.x + ry * right.y + rz * right.z;
    const cy = rx * up.x + ry * up.y + rz * up.z;
    const scale = this.focalLen / cz;
    return {
      sx: this.cx + cx * scale,
      sy: this.cy - cy * scale,
      cz,
      scale,
    };
  }

  /** Projects a world direction vector (at infinity) onto canopy for stars & true horizon */
  private projectDirection(sim: TrenchSimulation, dx: number, dy: number, dz: number): ProjPt | null {
    const { right, up, forward } = sim.basis;
    const cz = dx * forward.x + dy * forward.y + dz * forward.z;
    if (cz <= 0.04) return null;
    const cx = dx * right.x + dy * right.y + dz * right.z;
    const cy = dx * up.x + dy * up.y + dz * up.z;
    const scale = this.focalLen / cz;
    return {
      sx: this.cx + cx * scale,
      sy: this.cy - cy * scale,
      cz,
      scale,
    };
  }

  public render(
    ctx: CanvasRenderingContext2D,
    sim: TrenchSimulation,
    canopyVp: ViewportRect,
    timeSec: number
  ): void {
    const w = canopyVp.width;
    const h = canopyVp.height;

    const fovRad = (sim.cameraFovDeg * Math.PI) / 180;
    this.focalLen = (h * 0.5) / Math.tan(fovRad * 0.5);

    const shakeMag =
      sim.screenShake * 0.9 +
      (sim.afterburning ? 1.4 : 0) +
      sim.buffetIntensity * 4.2;
    const shakeX =
      shakeMag > 0.2
        ? Math.sin(timeSec * 82) * shakeMag * 0.65 + Math.sin(timeSec * 37) * sim.buffetIntensity * 2.4
        : 0;
    const shakeY =
      shakeMag > 0.2
        ? Math.cos(timeSec * 97) * shakeMag * 0.55 + Math.cos(timeSec * 43) * sim.buffetIntensity * 2.6
        : 0;

    this.cx = canopyVp.x + w * 0.5 + shakeX;
    this.cy = canopyVp.y + h * 0.5 + shakeY;

    ctx.save();
    ctx.beginPath();
    ctx.rect(canopyVp.x, canopyVp.y, w, h);
    ctx.clip();

    // 1. Deep Atmospheric Cathode Sky + Subtle Horizon Line & Starfield
    ctx.fillStyle = '#010603';
    ctx.fillRect(canopyVp.x, canopyVp.y, w, h);
    this.drawStarfieldAndHorizon(ctx, sim, canopyVp);

    // 2. Build World-Snapped Heightmap Mesh Quads + Arches + Targets -> Depth-Sorted Painter's Pass!
    const drawList: DepthDrawable[] = [];
    this.collectTerrainQuads(sim, canopyVp, drawList);

    // Collect rock arches in view range (full 4,000m open-valley draw distance)
    const arches = sim.terrain.getArchesInRange(
      sim.z - 120,
      sim.z + TRENCH_CONSTANTS.VIEW_DISTANCE + 160
    );
    for (const arch of arches) {
      const p = this.projectWorld(sim, arch.centerX, arch.deckY, arch.z);
      if (p && p.cz < TRENCH_CONSTANTS.VIEW_DISTANCE + 160) {
        drawList.push({ kind: 'ARCH', depth: p.cz, arch });
      }
    }

    // Collect live valley targets (SAM_SITE, BANDIT_DRONE, RESUPPLY_CACHE) across 4,000m sightlines
    for (const target of sim.targets) {
      if (target.destroyed) continue;
      const p = this.projectWorld(sim, target.x, target.y, target.z);
      if (p && p.cz < TRENCH_CONSTANTS.VIEW_DISTANCE + 160) {
        drawList.push({ kind: 'TARGET', depth: p.cz, target });
      }
    }

    // Collect 3D wireframe explosions
    for (const ex of sim.explosions) {
      const p = this.projectWorld(sim, ex.x, ex.y, ex.z);
      if (p && p.cz < TRENCH_CONSTANTS.VIEW_DISTANCE) {
        drawList.push({ kind: 'EXPLOSION', depth: p.cz - 8, explosion: ex });
      }
    }

    // Strictly sort back-to-front (painter's algorithm) -> 100% crisp hidden-line occlusion!
    drawList.sort((a, b) => b.depth - a.depth);

    for (const item of drawList) {
      if (item.kind === 'QUAD') {
        this.drawTerrainQuad(ctx, item);
      } else if (item.kind === 'ARCH') {
        this.drawRockArch(ctx, sim, item.arch, item.depth);
      } else if (item.kind === 'TARGET') {
        this.drawTargetSilhouette(ctx, sim, item.target, item.depth, timeSec);
      } else {
        this.drawWireframeExplosion(ctx, sim, item.explosion);
      }
    }

    // 3. Fixed-Forward M61A1 20mm Tracers, AIM-9 Missiles, Enemy SAMs, AAA Flak & CMDS Flares!
    this.drawCannonRounds(ctx, sim);
    this.drawTacticalMissiles(ctx, sim);
    this.drawEnemySams(ctx, sim);
    this.drawFlakBursts(ctx, sim);
    this.drawCmdsFlares(ctx, sim);

    // 4. Amber Impact & Detonation Sparks
    this.drawSparks(ctx, sim);

    // 5. Atmospheric Purge Wave creeping thermal edge glow when tail proximity < 320m!
    if (sim.phase === 'FLYING' && sim.purgeDistanceM < 320) {
      const prox = 1 - Math.max(0, sim.purgeDistanceM / 320);
      const pulse = 0.7 + 0.3 * Math.sin(timeSec * (8 + prox * 12));
      const edgeA = Math.min(0.42, prox * prox * 0.45 * pulse);
      const grad = ctx.createRadialGradient(
        canopyVp.x + w * 0.5,
        canopyVp.y + h * 0.5,
        Math.min(w, h) * 0.28,
        canopyVp.x + w * 0.5,
        canopyVp.y + h * 0.5,
        Math.max(w, h) * 0.65
      );
      grad.addColorStop(0, 'rgba(255, 130, 20, 0)');
      grad.addColorStop(1, `rgba(255, 118, 22, ${edgeA.toFixed(3)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(canopyVp.x, canopyVp.y, w, h);
    }

    // 6. Concussion flash on hull / terrain impact
    if (sim.hitFlashTimer > 0) {
      const a = Math.min(0.45, sim.hitFlashTimer * 0.72);
      ctx.fillStyle = `rgba(255, 62, 26, ${a.toFixed(3)})`;
      ctx.fillRect(canopyVp.x, canopyVp.y, w, h);
    }

    ctx.restore();
  }

  private drawStarfieldAndHorizon(
    ctx: CanvasRenderingContext2D,
    sim: TrenchSimulation,
    vp: ViewportRect
  ): void {
    // True sky horizon line (world horizontal plane y = 0 direction)
    const leftDir = { x: Math.sin(sim.yaw - 1.15), y: 0, z: Math.cos(sim.yaw - 1.15) };
    const midDir = { x: Math.sin(sim.yaw), y: 0, z: Math.cos(sim.yaw) };
    const rightDir = { x: Math.sin(sim.yaw + 1.15), y: 0, z: Math.cos(sim.yaw + 1.15) };
    const pL = this.projectDirection(sim, leftDir.x, leftDir.y, leftDir.z);
    const pM = this.projectDirection(sim, midDir.x, midDir.y, midDir.z);
    const pR = this.projectDirection(sim, rightDir.x, rightDir.y, rightDir.z);

    ctx.save();
    // Subtle deep phosphor stars
    for (const st of this.stars) {
      const p = this.projectDirection(sim, st.dx, st.dy, st.dz);
      if (!p) continue;
      if (p.sx < vp.x || p.sx > vp.x + vp.width || p.sy < vp.y || p.sy > vp.y + vp.height) {
        continue;
      }
      ctx.fillStyle = `rgba(142, 245, 171, ${(st.brightness * 0.52).toFixed(2)})`;
      ctx.fillRect(p.sx, p.sy, 1.8, 1.8);
    }

    // Subtle atmospheric horizon line
    if (pL && pM && pR) {
      ctx.strokeStyle = 'rgba(26, 98, 52, 0.42)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(pL.sx, pL.sy);
      ctx.lineTo(pM.sx, pM.sy);
      ctx.lineTo(pR.sx, pR.sy);
      ctx.stroke();
    }
    ctx.restore();
  }

  private collectTerrainQuads(
    sim: TrenchSimulation,
    vp: ViewportRect,
    out: DepthDrawable[]
  ): void {
    const cell = TRENCH_CONSTANTS.TERRAIN_CELL_SIZE;
    const viewDist = TRENCH_CONSTANTS.VIEW_DISTANCE;

    // Anchor snapped world grid centered ahead of camera along horizontal heading!
    const fwdHx = Math.sin(sim.yaw);
    const fwdHz = Math.cos(sim.yaw);
    const rightHx = Math.cos(sim.yaw);
    const rightHz = -Math.sin(sim.yaw);
    const anchorX = sim.x + fwdHx * (viewDist * 0.45);
    const anchorZ = sim.z + fwdHz * (viewDist * 0.45);

    const gridRadius = Math.ceil((viewDist * 0.56) / cell);
    const minIx = Math.floor(anchorX / cell) - gridRadius;
    const minIz = Math.floor(anchorZ / cell) - gridRadius;
    const dim = gridRadius * 2 + 1;

    // Pre-project only forward-cone vertices so 4,000m wide alpine valley runs locked at 60+ FPS!
    const heights = new Float32Array(dim * dim);
    const proj: Array<ProjPt | null> = new Array(dim * dim).fill(null);
    const maxDistSq = (viewDist + cell * 2.5) * (viewDist + cell * 2.5);
    const backCull = -cell * 2.2;
    const latPad = cell * 5.2;

    for (let gz = 0; gz < dim; gz++) {
      const wz = (minIz + gz) * cell;
      const dz = wz - sim.z;
      const rowOff = gz * dim;
      for (let gx = 0; gx < dim; gx++) {
        const wx = (minIx + gx) * cell;
        const dx = wx - sim.x;

        // Early forward-cone cull before sampling heightmap!
        const fwdDot = dx * fwdHx + dz * fwdHz;
        if (fwdDot < backCull) continue;
        const distSq = dx * dx + dz * dz;
        if (distSq > maxDistSq) continue;
        const latDot = Math.abs(dx * rightHx + dz * rightHz);
        if (latDot > Math.max(0, fwdDot) * 1.65 + latPad) continue;

        const wy = sim.terrain.sampleHeight(wx, wz);
        heights[rowOff + gx] = wy;
        proj[rowOff + gx] = this.projectWorld(sim, wx, wy, wz);
      }
    }

    const pad = 180;
    const minSx = vp.x - pad;
    const maxSx = vp.x + vp.width + pad;
    const minSy = vp.y - pad;
    const maxSy = vp.y + vp.height + pad;

    for (let gz = 0; gz < dim - 1; gz++) {
      const row0 = gz * dim;
      const row1 = (gz + 1) * dim;
      for (let gx = 0; gx < dim - 1; gx++) {
        const i00 = row0 + gx;
        const i10 = row0 + gx + 1;
        const i11 = row1 + gx + 1;
        const i01 = row1 + gx;

        const p0 = proj[i00];
        const p1 = proj[i10];
        const p2 = proj[i11];
        const p3 = proj[i01];
        if (!p0 || !p1 || !p2 || !p3) continue;

        const avgDepth = (p0.cz + p1.cz + p2.cz + p3.cz) * 0.25;
        if (avgDepth > viewDist) continue;

        // Frustum cull completely off-screen quads
        if (
          (p0.sx < minSx && p1.sx < minSx && p2.sx < minSx && p3.sx < minSx) ||
          (p0.sx > maxSx && p1.sx > maxSx && p2.sx > maxSx && p3.sx > maxSx) ||
          (p0.sy < minSy && p1.sy < minSy && p2.sy < minSy && p3.sy < minSy) ||
          (p0.sy > maxSy && p1.sy > maxSy && p2.sy > maxSy && p3.sy > maxSy)
        ) {
          continue;
        }

        const h0 = heights[i00];
        const h1 = heights[i10];
        const h2 = heights[i11];
        const h3 = heights[i01];
        const avgH = (h0 + h1 + h2 + h3) * 0.25;
        const slope =
          Math.max(h0, h1, h2, h3) - Math.min(h0, h1, h2, h3);

        out.push({
          kind: 'QUAD',
          depth: avgDepth,
          p0,
          p1,
          p2,
          p3,
          avgH,
          slope,
        });
      }
    }
  }

  private drawTerrainQuad(
    ctx: CanvasRenderingContext2D,
    q: Extract<DepthDrawable, { kind: 'QUAD' }>
  ): void {
    const fog = 1 - Math.max(0, Math.min(1, q.depth / TRENCH_CONSTANTS.VIEW_DISTANCE));
    if (fog <= 0.015) return;

    // Smooth atmospheric fogging from bright crisp #44FF77 nearby -> dark alpine emerald at 4km horizon
    // Tall alpine walls & sharp mesa cliffs get extra ridge luminance for instant 3D depth reading!
    const ridgeBoost = Math.min(1, q.slope / 55) * 0.34 + Math.min(1, q.avgH / 460) * 0.28;
    const f = Math.pow(fog, 1.05);
    const r = Math.round(6 + f * (56 + ridgeBoost * 38));
    const g = Math.round(28 + f * (202 + ridgeBoost * 46));
    const b = Math.round(14 + f * (96 + ridgeBoost * 26));
    const alpha = Math.min(0.98, 0.20 + f * 0.78);

    ctx.beginPath();
    ctx.moveTo(q.p0.sx, q.p0.sy);
    ctx.lineTo(q.p1.sx, q.p1.sy);
    ctx.lineTo(q.p2.sx, q.p2.sy);
    ctx.lineTo(q.p3.sx, q.p3.sy);
    ctx.closePath();

    // CRITICAL HIDDEN-LINE OCCLUSION: Solid dark black fill blocks distant ridges & targets behind mesas!
    ctx.fillStyle = '#020804';
    ctx.fill();

    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 0.8 + f * 0.95;
    ctx.stroke();
  }

  /**
   * Renders grand vaulted 3D alpine rock/industrial valley arches spanning across the basin!
   */
  private drawRockArch(
    ctx: CanvasRenderingContext2D,
    sim: TrenchSimulation,
    arch: CanyonArch,
    depth: number
  ): void {
    const fog = 1 - Math.max(0, Math.min(1, depth / TRENCH_CONSTANTS.VIEW_DISTANCE));
    if (fog <= 0.025) return;

    const segs = 10;
    const zFront = arch.z - arch.depthZ * 0.5;
    const zBack = arch.z + arch.depthZ * 0.5;
    const f = Math.pow(fog, 1.05);
    const stroke = `rgba(${Math.round(38 + f * 64)}, ${Math.round(115 + f * 140)}, ${Math.round(60 + f * 78)}, ${(0.28 + f * 0.7).toFixed(3)})`;

    ctx.save();
    for (let i = 0; i < segs; i++) {
      const u0 = -1 + (2 * i) / segs;
      const u1 = -1 + (2 * (i + 1)) / segs;
      const x0 = arch.centerX + u0 * arch.halfSpan;
      const x1 = arch.centerX + u1 * arch.halfSpan;
      const bot0 = arch.deckY - u0 * u0 * 36;
      const bot1 = arch.deckY - u1 * u1 * 36;
      const top0 = arch.deckY + arch.thicknessY;
      const top1 = arch.deckY + arch.thicknessY;

      // Front face quad (solid black fill + green wireframe)
      const f0 = this.projectWorld(sim, x0, bot0, zFront);
      const f1 = this.projectWorld(sim, x1, bot1, zFront);
      const f2 = this.projectWorld(sim, x1, top1, zFront);
      const f3 = this.projectWorld(sim, x0, top0, zFront);
      if (f0 && f1 && f2 && f3) {
        ctx.fillStyle = '#020804';
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.1 + f * 1.15;
        ctx.beginPath();
        ctx.moveTo(f0.sx, f0.sy);
        ctx.lineTo(f1.sx, f1.sy);
        ctx.lineTo(f2.sx, f2.sy);
        ctx.lineTo(f3.sx, f3.sy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // Underside clearance span face (subtle emerald-cyan rib highlights framing suspended caches!)
      const b0 = this.projectWorld(sim, x0, bot0, zBack);
      const b1 = this.projectWorld(sim, x1, bot1, zBack);
      if (f0 && f1 && b1 && b0) {
        ctx.fillStyle = '#010503';
        ctx.strokeStyle = `rgba(0, 240, 255, ${(0.14 + f * 0.34).toFixed(3)})`;
        ctx.lineWidth = 1.0 + f * 0.75;
        ctx.beginPath();
        ctx.moveTo(f0.sx, f0.sy);
        ctx.lineTo(f1.sx, f1.sy);
        ctx.lineTo(b1.sx, b1.sy);
        ctx.lineTo(b0.sx, b0.sy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Zero-Clutter 3-Class Unmistakable Target Silhouettes across 4,000m sightlines:
   * 1. `SAM_SITE` (#FF3322 Red-Amber): Tall rotating radar tower + twin angled SAM launcher rails
   * 2. `BANDIT_DRONE` (#FFB000 Bright Amber): Delta-wing fighter-drone + glowing phosphor contrails
   * 3. `RESUPPLY_CACHE` (#00F0FF Electric Cyan): Glowing 3D Hexagonal Supply Pod
   */
  private drawTargetSilhouette(
    ctx: CanvasRenderingContext2D,
    sim: TrenchSimulation,
    t: CanyonTarget,
    depth: number,
    timeSec: number
  ): void {
    const p = this.projectWorld(sim, t.x, t.y, t.z);
    if (!p) return;

    const fog = 1 - Math.max(0, Math.min(1, depth / TRENCH_CONSTANTS.VIEW_DISTANCE));
    const isLocked = sim.lockedTargetId === t.id;
    const hitFlash = t.hitFlashTimer > 0;
    // Crisp minimum size so distant targets stay readable silhouettes out to 3,800m–4,000m!
    const r = Math.max(6.5, Math.min(82, t.radius * p.scale));

    ctx.save();

    if (t.kind === 'BANDIT_DRONE') {
      // 1. Glowing Phosphor Contrail Ribbon trailing behind weaving Bandit Drone!
      const trail = t.trail;
      if (trail && trail.length >= 2) {
        for (let i = 1; i < trail.length; i++) {
          const p0 = this.projectWorld(sim, trail[i - 1].x, trail[i - 1].y, trail[i - 1].z);
          const p1 = this.projectWorld(sim, trail[i].x, trail[i].y, trail[i].z);
          if (!p0 || !p1) continue;
          const frac = i / (trail.length - 1);
          const a = Math.pow(frac, 1.25) * (0.28 + fog * 0.65);
          ctx.strokeStyle =
            frac > 0.78
              ? `rgba(255, 246, 204, ${a.toFixed(3)})`
              : `rgba(255, 176, 0, ${(a * 0.88).toFixed(3)})`;
          ctx.lineWidth = Math.max(1.2, Math.min(4.8, (0.7 + frac * 1.9) * Math.min(2.0, p1.scale * 0.06)));
          ctx.beginPath();
          ctx.moveTo(p0.sx, p0.sy);
          ctx.lineTo(p1.sx, p1.sy);
          ctx.stroke();
        }
      }

      // 2. Sleek Delta-Wing Hostile Vector Fighter-Drone Silhouette (#FFB000 Bright Amber)
      const vx = t.vx ?? 0;
      const vy = t.vy ?? 0;
      const vz = t.vz ?? 120;
      const spd = Math.max(1, Math.hypot(vx, vy, vz));
      const fx = vx / spd;
      const fy = vy / spd;
      const fz = vz / spd;

      // Local right vector with subtle realistic weaving bank angle!
      const bank = Math.max(-0.65, Math.min(0.65, -vx / 75));
      const cosB = Math.cos(bank);
      const sinB = Math.sin(bank);
      let rx = fz;
      let ry = 0;
      let rz = -fx;
      const rLen = Math.max(0.001, Math.hypot(rx, rz));
      rx /= rLen;
      rz /= rLen;
      // Rotate right/up by bank angle
      const ux0 = 0;
      const uy0 = 1;
      const uz0 = 0;
      const wrx = rx * cosB + ux0 * sinB;
      const wry = ry * cosB + uy0 * sinB;
      const wrz = rz * cosB + uz0 * sinB;
      const wux = -rx * sinB + ux0 * cosB;
      const wuy = -ry * sinB + uy0 * cosB;
      const wuz = -rz * sinB + uz0 * cosB;

      const worldScale = Math.max(t.radius * 0.92, (r / Math.max(0.01, p.scale)) * 0.95);
      const nose = this.projectWorld(sim, t.x + fx * worldScale * 1.45, t.y + fy * worldScale * 1.45, t.z + fz * worldScale * 1.45);
      const tail = this.projectWorld(sim, t.x - fx * worldScale * 1.05, t.y - fy * worldScale * 1.05, t.z - fz * worldScale * 1.05);
      const wingL = this.projectWorld(
        sim,
        t.x - fx * worldScale * 0.85 - wrx * worldScale * 1.35,
        t.y - fy * worldScale * 0.85 - wry * worldScale * 1.35,
        t.z - fz * worldScale * 0.85 - wrz * worldScale * 1.35
      );
      const wingR = this.projectWorld(
        sim,
        t.x - fx * worldScale * 0.85 + wrx * worldScale * 1.35,
        t.y - fy * worldScale * 0.85 + wry * worldScale * 1.35,
        t.z - fz * worldScale * 0.85 + wrz * worldScale * 1.35
      );
      const finTop = this.projectWorld(
        sim,
        t.x - fx * worldScale * 0.9 + wux * worldScale * 0.65,
        t.y - fy * worldScale * 0.9 + wuy * worldScale * 0.65,
        t.z - fz * worldScale * 0.9 + wuz * worldScale * 0.65
      );

      ctx.strokeStyle = hitFlash
        ? '#FFFFFF'
        : isLocked
          ? '#FFF6CC'
          : `rgba(255, 176, 0, ${(0.65 + fog * 0.35).toFixed(3)})`;
      ctx.fillStyle = hitFlash ? 'rgba(255, 246, 204, 0.65)' : 'rgba(38, 22, 4, 0.86)';
      ctx.lineWidth = isLocked ? 2.4 : 1.7 + fog * 0.9;

      if (nose && tail && wingL && wingR) {
        // Swept delta airframe fuselage & wings
        ctx.beginPath();
        ctx.moveTo(nose.sx, nose.sy);
        ctx.lineTo(wingR.sx, wingR.sy);
        ctx.lineTo(tail.sx, tail.sy);
        ctx.lineTo(wingL.sx, wingL.sy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Center fuselage spine + dorsal tail fin
        ctx.beginPath();
        ctx.moveTo(nose.sx, nose.sy);
        ctx.lineTo(tail.sx, tail.sy);
        if (finTop) {
          ctx.moveTo(tail.sx, tail.sy);
          ctx.lineTo(finTop.sx, finTop.sy);
          ctx.lineTo(p.sx, p.sy);
        }
        ctx.stroke();

        // Glowing amber engine afterburner core
        ctx.fillStyle = '#FFF6CC';
        ctx.beginPath();
        ctx.arc(tail.sx, tail.sy, Math.max(2.6, r * 0.24), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Crisp distant delta fallback
        ctx.beginPath();
        ctx.moveTo(p.sx, p.sy - r);
        ctx.lineTo(p.sx + r * 1.15, p.sy + r * 0.65);
        ctx.lineTo(p.sx, p.sy + r * 0.2);
        ctx.lineTo(p.sx - r * 1.15, p.sy + r * 0.65);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else if (t.kind === 'SAM_SITE') {
      // Unmistakable Tall Rotating Red-Amber Radar Dish Tower + Twin Launcher Rails (#FF3322)
      const locking = (t.samLockTimer ?? 0) > 0.25;
      const lockBlink = locking && Math.sin(timeSec * 18) > 0;
      const strokeCol = hitFlash
        ? '#FFFFFF'
        : lockBlink
          ? '#FFF6CC'
          : isLocked
            ? '#FF8844'
            : `rgba(255, 51, 34, ${(0.68 + fog * 0.32).toFixed(3)})`;

      const groundY = t.y - 26;
      const dishY = t.y + 22;
      const botP = this.projectWorld(sim, t.x, groundY, t.z);
      const topP = this.projectWorld(sim, t.x, dishY, t.z);

      ctx.strokeStyle = strokeCol;
      ctx.fillStyle = hitFlash ? 'rgba(255, 220, 190, 0.55)' : 'rgba(36, 8, 5, 0.88)';
      ctx.lineWidth = isLocked || locking ? 2.4 : 1.7 + fog * 0.9;

      if (botP && topP) {
        const bw = Math.max(7, r * 0.95);
        const tw = Math.max(3.5, r * 0.42);
        const towerH = Math.max(11, botP.sy - topP.sy);
        const topY = botP.sy - towerH;

        // Tapered armored radar tower pylon
        ctx.beginPath();
        ctx.moveTo(botP.sx - bw, botP.sy);
        ctx.lineTo(topP.sx - tw, topY);
        ctx.lineTo(topP.sx + tw, topY);
        ctx.lineTo(botP.sx + bw, botP.sy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Cross-bracing lattice inside tower
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(botP.sx - bw * 0.78, botP.sy - towerH * 0.25);
        ctx.lineTo(topP.sx + tw * 0.85, topY + towerH * 0.32);
        ctx.moveTo(botP.sx + bw * 0.78, botP.sy - towerH * 0.25);
        ctx.lineTo(topP.sx - tw * 0.85, topY + towerH * 0.32);
        ctx.stroke();

        // Twin angled SAM launcher rails flanking tower base
        const firingFlash = (t.muzzleFlashTimer ?? 0) > 0;
        const flashFrac = Math.min(1, (t.muzzleFlashTimer ?? 0) / 0.55);
        ctx.strokeStyle = firingFlash ? '#FFF6CC' : '#FFB000';
        ctx.lineWidth = Math.max(1.5, (firingFlash ? 2.4 : 1.3) + fog * 0.9);
        const railLTipX = botP.sx - bw * 1.48;
        const railLTipY = botP.sy - towerH * 0.72;
        const railRTipX = botP.sx + bw * 1.48;
        const railRTipY = botP.sy - towerH * 0.72;
        ctx.beginPath();
        ctx.moveTo(botP.sx - bw * 0.92, botP.sy - towerH * 0.15);
        ctx.lineTo(railLTipX, railLTipY);
        ctx.moveTo(botP.sx + bw * 0.92, botP.sy - towerH * 0.15);
        ctx.lineTo(railRTipX, railRTipY);
        ctx.stroke();

        // Dramatic SAM booster ignition flare bursting directly off the launcher rails!
        if (firingFlash) {
          const flareR = Math.max(7, r * (0.85 + flashFrac * 1.15));
          ctx.fillStyle = `rgba(255, 176, 0, ${(0.35 + flashFrac * 0.5).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(railLTipX, railLTipY, flareR, 0, Math.PI * 2);
          ctx.arc(railRTipX, railRTipY, flareR, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(railLTipX, railLTipY, flareR * 0.48, 0, Math.PI * 2);
          ctx.arc(railRTipX, railRTipY, flareR * 0.48, 0, Math.PI * 2);
          ctx.fill();
        }

        // Large rotating parabolic radar dish sweeping atop tower!
        const spin = Math.cos(timeSec * (locking ? 8.5 : 3.2) + t.id);
        const dishHalfW = Math.max(6.5, r * 1.12 * (0.28 + 0.72 * Math.abs(spin)));
        const dishH = Math.max(4.5, r * 0.52);
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = 2.0 + fog * 0.8;
        ctx.beginPath();
        ctx.ellipse(topP.sx, topY - dishH * 0.6, dishHalfW, dishH, 0, Math.PI * 0.85, Math.PI * 2.15);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(topP.sx - dishHalfW, topY - dishH * 0.55);
        ctx.lineTo(topP.sx + dishHalfW, topY - dishH * 0.55);
        ctx.stroke();

        // Hot glowing red/white radar emitter core
        ctx.fillStyle = lockBlink || (t.muzzleFlashTimer ?? 0) > 0 ? '#FFFFFF' : '#FF3322';
        ctx.beginPath();
        ctx.arc(
          topP.sx,
          topY - dishH * 0.65,
          Math.max(3.0, r * ((t.muzzleFlashTimer ?? 0) > 0 ? 0.65 : 0.24)),
          0,
          Math.PI * 2
        );
        ctx.fill();
      } else {
        // Fallback red-amber tower diamond
        ctx.beginPath();
        ctx.moveTo(p.sx, p.sy - r * 1.25);
        ctx.lineTo(p.sx + r * 0.9, p.sy + r * 0.6);
        ctx.lineTo(p.sx - r * 0.9, p.sy + r * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else {
      // `RESUPPLY_CACHE`: Electric Cyan (#4CEEFF) Hexagonal Pod paired with Ron Cobb Diamond + Cross (◈ / ✚)
      // so P3 AMBER monochrome phosphor mode retains 100% unmistakable supply silhouette clarity!
      const strokeCol = hitFlash
        ? '#FFFFFF'
        : isLocked
          ? '#D8FFFF'
          : `rgba(76, 238, 255, ${(0.76 + fog * 0.24).toFixed(3)})`;

      // Optional overhead cable suspension tether when hanging beneath an arch
      const groundAt = sim.terrain.sampleHeight(t.x, t.z);
      if (t.y - groundAt > 48) {
        const anchorTop = this.projectWorld(sim, t.x, t.y + 42, t.z);
        if (anchorTop) {
          ctx.strokeStyle = 'rgba(76, 238, 255, 0.56)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(p.sx, p.sy - r * 0.85);
          ctx.lineTo(anchorTop.sx, anchorTop.sy);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Outer 3D Hexagonal Pod Shell with dark halo underpass for crisp separation
      const hexR = Math.max(8.5, r * 1.12);
      ctx.strokeStyle = strokeCol;
      ctx.fillStyle = hitFlash ? 'rgba(200, 255, 255, 0.65)' : 'rgba(2, 34, 42, 0.90)';
      ctx.lineWidth = isLocked ? 2.6 : 2.0 + fog * 0.9;

      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        const hx = p.sx + Math.cos(a) * hexR;
        const hy = p.sy + Math.sin(a) * hexR;
        if (k === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Ron Cobb Semiotic Inner Diamond (◈) framing the Supply Cross (✚)
      const diaR = hexR * 0.66;
      ctx.strokeStyle = THEME.HALO_DARK;
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      ctx.moveTo(p.sx, p.sy - diaR);
      ctx.lineTo(p.sx + diaR, p.sy);
      ctx.lineTo(p.sx, p.sy + diaR);
      ctx.lineTo(p.sx - diaR, p.sy);
      ctx.closePath();
      ctx.stroke();

      ctx.strokeStyle = '#C8FFFF';
      ctx.lineWidth = 1.65;
      ctx.beginPath();
      ctx.moveTo(p.sx, p.sy - diaR);
      ctx.lineTo(p.sx + diaR, p.sy);
      ctx.lineTo(p.sx, p.sy + diaR);
      ctx.lineTo(p.sx - diaR, p.sy);
      ctx.closePath();
      ctx.stroke();

      // Bold Ron Cobb Medical/Supply Cross (✚) inside the diamond — unmistakable in P3 AMBER!
      const crossR = Math.max(3.6, hexR * 0.36);
      const pulseOn = Math.sin(timeSec * 8 + t.id) > -0.2;
      ctx.strokeStyle = THEME.HALO_DARK;
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.moveTo(p.sx - crossR, p.sy);
      ctx.lineTo(p.sx + crossR, p.sy);
      ctx.moveTo(p.sx, p.sy - crossR);
      ctx.lineTo(p.sx, p.sy + crossR);
      ctx.stroke();

      ctx.strokeStyle = pulseOn ? '#FFFFFF' : THEME.ACCENT_CYAN;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(p.sx - crossR, p.sy);
      ctx.lineTo(p.sx + crossR, p.sy);
      ctx.moveTo(p.sx, p.sy - crossR);
      ctx.lineTo(p.sx, p.sy + crossR);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawWireframeExplosion(
    ctx: CanvasRenderingContext2D,
    sim: TrenchSimulation,
    ex: WireframeExplosion
  ): void {
    const p = this.projectWorld(sim, ex.x, ex.y, ex.z);
    if (!p) return;
    const prog = Math.min(1, ex.age / Math.max(0.01, ex.duration));
    const r = ex.maxRadius * Math.pow(prog, 0.48) * p.scale;
    const alpha = Math.max(0, 1 - prog);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = prog < 0.25 ? '#FFF6CC' : ex.color;
    ctx.lineWidth = 2.4 * (1 - prog * 0.5);

    // Expanding wireframe octagon + radiating burst vectors
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + prog * 0.8;
      const px = p.sx + Math.cos(a) * r;
      const py = p.sy + Math.sin(a) * r;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + prog * 1.4;
      ctx.moveTo(p.sx + Math.cos(a) * r * 0.35, p.sy + Math.sin(a) * r * 0.35);
      ctx.lineTo(p.sx + Math.cos(a) * r * 1.35, p.sy + Math.sin(a) * r * 1.35);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawCannonRounds(ctx: CanvasRenderingContext2D, sim: TrenchSimulation): void {
    ctx.save();
    for (const r of sim.rounds) {
      const head = this.projectWorld(sim, r.x, r.y, r.z);
      const tail = this.projectWorld(
        sim,
        r.x - r.vx * 0.022,
        r.y - r.vy * 0.022,
        r.z - r.vz * 0.022
      );
      if (!head || !tail) continue;

      ctx.strokeStyle = '#FFB000';
      ctx.lineWidth = Math.max(1.8, Math.min(4.4, head.scale * 0.19));
      ctx.beginPath();
      ctx.moveTo(tail.sx, tail.sy);
      ctx.lineTo(head.sx, head.sy);
      ctx.stroke();

      ctx.strokeStyle = '#FFF6CC';
      ctx.lineWidth = Math.max(1.0, Math.min(2.2, head.scale * 0.085));
      ctx.beginPath();
      ctx.moveTo(tail.sx, tail.sy);
      ctx.lineTo(head.sx, head.sy);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Renders launched AGM/AIM-9 Tactical Missiles:
   * - Bright multi-segment phosphor-persistence exhaust ribbon trail
   * - 3D wireframe missile dart body & stabilizer fins + glowing solid-rocket motor plume!
   */
  private drawTacticalMissiles(ctx: CanvasRenderingContext2D, sim: TrenchSimulation): void {
    if (sim.missiles.length === 0) return;
    ctx.save();

    for (const m of sim.missiles) {
      // 1. Phosphor-persistence glowing exhaust ribbon trail
      const pts = m.trail;
      if (pts.length >= 2) {
        for (let i = 1; i < pts.length; i++) {
          const p0 = this.projectWorld(sim, pts[i - 1].x, pts[i - 1].y, pts[i - 1].z);
          const p1 = this.projectWorld(sim, pts[i].x, pts[i].y, pts[i].z);
          if (!p0 || !p1) continue;
          const frac = i / (pts.length - 1); // 0 = old tail .. 1 = hot motor nozzle
          const alpha = Math.pow(frac, 1.35) * 0.88;
          ctx.strokeStyle =
            frac > 0.72
              ? `rgba(255, 246, 204, ${alpha.toFixed(3)})`
              : frac > 0.35
                ? `rgba(255, 176, 0, ${(alpha * 0.92).toFixed(3)})`
                : `rgba(68, 255, 119, ${(alpha * 0.65).toFixed(3)})`;
          ctx.lineWidth = Math.max(1.2, Math.min(6.5, (0.6 + frac * 2.2) * Math.min(2.2, p1.scale * 0.09)));
          ctx.beginPath();
          ctx.moveTo(p0.sx, p0.sy);
          ctx.lineTo(p1.sx, p1.sy);
          ctx.stroke();
        }
      }

      // 2. 3D Wireframe Missile Body & Fins oriented along velocity vector
      const spd = Math.max(1, Math.hypot(m.vx, m.vy, m.vz));
      const fx = m.vx / spd;
      const fy = m.vy / spd;
      const fz = m.vz / spd;

      const nose = this.projectWorld(sim, m.x + fx * 3.8, m.y + fy * 3.8, m.z + fz * 3.8);
      const tail = this.projectWorld(sim, m.x - fx * 3.2, m.y - fy * 3.2, m.z - fz * 3.2);
      if (!nose || !tail) continue;

      // Cross-fin perpendicular vectors
      const rx = sim.basis.right.x * 1.4;
      const ry = sim.basis.right.y * 1.4;
      const rz = sim.basis.right.z * 1.4;
      const finL = this.projectWorld(sim, m.x - fx * 2.6 - rx, m.y - fy * 2.6 - ry, m.z - fz * 2.6 - rz);
      const finR = this.projectWorld(sim, m.x - fx * 2.6 + rx, m.y - fy * 2.6 + ry, m.z - fz * 2.6 + rz);

      ctx.strokeStyle = '#FFF6CC';
      ctx.lineWidth = Math.max(1.8, Math.min(4.2, nose.scale * 0.14));
      ctx.beginPath();
      ctx.moveTo(tail.sx, tail.sy);
      ctx.lineTo(nose.sx, nose.sy);
      if (finL && finR) {
        ctx.moveTo(finL.sx, finL.sy);
        ctx.lineTo(nose.sx, nose.sy);
        ctx.lineTo(finR.sx, finR.sy);
        ctx.lineTo(finL.sx, finL.sy);
      }
      ctx.stroke();

      // Glowing white-amber rocket exhaust flare
      const flareR = Math.max(2.6, Math.min(9.5, tail.scale * 0.28));
      ctx.fillStyle = '#FFF6CC';
      ctx.beginPath();
      ctx.arc(tail.sx, tail.sy, flareR * 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFB000';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(tail.sx, tail.sy, flareR * 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Renders incoming Enemy Surface-to-Air Missiles (SAMs) with cinematic glowing phosphor smoke trails
   * visible across the open valley during their 4.5-second intercept flight!
   */
  private drawEnemySams(ctx: CanvasRenderingContext2D, sim: TrenchSimulation): void {
    if (sim.enemySams.length === 0) return;
    ctx.save();
    for (const m of sim.enemySams) {
      const pts = m.trail;
      if (pts.length >= 2) {
        // Outer glowing smoke plume ribbon
        for (let i = 1; i < pts.length; i++) {
          const p0 = this.projectWorld(sim, pts[i - 1].x, pts[i - 1].y, pts[i - 1].z);
          const p1 = this.projectWorld(sim, pts[i].x, pts[i].y, pts[i].z);
          if (!p0 || !p1) continue;
          const frac = i / (pts.length - 1);
          const alpha = Math.pow(frac, 0.95) * 0.94;
          ctx.strokeStyle =
            frac > 0.78
              ? `rgba(255, 250, 224, ${alpha.toFixed(3)})`
              : frac > 0.42
                ? `rgba(255, 138, 42, ${(alpha * 0.92).toFixed(3)})`
                : `rgba(255, 51, 34, ${(alpha * 0.78).toFixed(3)})`;
          ctx.lineWidth = Math.max(
            2.0,
            Math.min(9.5, (1.1 + frac * 3.0) * Math.min(2.6, Math.max(0.85, p1.scale * 0.08)))
          );
          ctx.beginPath();
          ctx.moveTo(p0.sx, p0.sy);
          ctx.lineTo(p1.sx, p1.sy);
          ctx.stroke();

          // Bright hot-white core thread near rocket nozzle
          if (frac > 0.55) {
            ctx.strokeStyle = `rgba(255, 248, 220, ${(alpha * 0.85).toFixed(3)})`;
            ctx.lineWidth = Math.max(1.1, Math.min(3.4, frac * 2.4));
            ctx.beginPath();
            ctx.moveTo(p0.sx, p0.sy);
            ctx.lineTo(p1.sx, p1.sy);
            ctx.stroke();
          }
        }
      }

      const head = this.projectWorld(sim, m.x, m.y, m.z);
      if (!head) continue;
      const r = Math.max(5.5, Math.min(22, head.scale * 0.42));
      ctx.strokeStyle = '#FF3322';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(head.sx, head.sy - r);
      ctx.lineTo(head.sx + r, head.sy);
      ctx.lineTo(head.sx, head.sy + r);
      ctx.lineTo(head.sx - r, head.sy);
      ctx.closePath();
      ctx.stroke();

      ctx.fillStyle = '#FFF8DC';
      ctx.beginPath();
      ctx.arc(head.sx, head.sy, Math.max(3.2, r * 0.48), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Renders predictive canyon-floor AAA flak detonations (high-contrast amber bursts + shrapnel)!
   */
  private drawFlakBursts(ctx: CanvasRenderingContext2D, sim: TrenchSimulation): void {
    if (sim.flakBursts.length === 0) return;
    ctx.save();
    for (const f of sim.flakBursts) {
      const p = this.projectWorld(sim, f.x, f.y, f.z);
      if (!p) continue;
      if (!f.detonated) {
        // Subtle incoming flak point-of-detonation telegraph glint
        const prog = Math.min(1, f.age / Math.max(0.05, f.fuseTime));
        if (prog > 0.55) {
          ctx.strokeStyle = `rgba(255, 176, 0, ${((prog - 0.55) * 1.4).toFixed(2)})`;
          ctx.lineWidth = 1.4;
          const sz = Math.max(3, Math.min(14, (1.1 - prog) * 18));
          ctx.beginPath();
          ctx.moveTo(p.sx - sz, p.sy);
          ctx.lineTo(p.sx + sz, p.sy);
          ctx.moveTo(p.sx, p.sy - sz);
          ctx.lineTo(p.sx, p.sy + sz);
          ctx.stroke();
        }
        continue;
      }

      const dAge = f.age - f.fuseTime;
      const prog = Math.max(0, Math.min(1, dAge / Math.max(0.05, f.duration)));
      const rad = Math.max(8, Math.min(110, f.radius * Math.pow(prog, 0.36) * p.scale));
      const alpha = Math.max(0, 1 - prog);

      ctx.globalAlpha = alpha;
      // Dark flak smoke core + crisp amber detonation burst polygon
      ctx.fillStyle = 'rgba(24, 12, 4, 0.72)';
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, rad * 0.72, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = prog < 0.22 ? '#FFF6CC' : '#FFB000';
      ctx.lineWidth = Math.max(1.4, 2.8 * (1 - prog * 0.5));
      ctx.beginPath();
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + f.id * 0.7;
        const rRay = rad * (k % 2 === 0 ? 1.15 : 0.72);
        const px = p.sx + Math.cos(a) * rRay;
        const py = p.sy + Math.sin(a) * rRay;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Renders glowing amber phosphor-persistence CMDS Flares & shimmering Chaff streaming aft!
   */
  private drawCmdsFlares(ctx: CanvasRenderingContext2D, sim: TrenchSimulation): void {
    if (sim.flares.length === 0) return;
    ctx.save();
    for (const fl of sim.flares) {
      const pts = fl.trail;
      const lifeFrac = Math.max(0, 1 - fl.age / fl.maxAge);

      if (!fl.isChaff && pts.length >= 2) {
        for (let i = 1; i < pts.length; i++) {
          const p0 = this.projectWorld(sim, pts[i - 1].x, pts[i - 1].y, pts[i - 1].z);
          const p1 = this.projectWorld(sim, pts[i].x, pts[i].y, pts[i].z);
          if (!p0 || !p1) continue;
          const segFrac = i / (pts.length - 1);
          const a = segFrac * lifeFrac * 0.85;
          ctx.strokeStyle =
            segFrac > 0.7
              ? `rgba(255, 246, 204, ${a.toFixed(3)})`
              : `rgba(255, 176, 0, ${(a * 0.85).toFixed(3)})`;
          ctx.lineWidth = Math.max(1.2, Math.min(5.0, segFrac * 3.2));
          ctx.beginPath();
          ctx.moveTo(p0.sx, p0.sy);
          ctx.lineTo(p1.sx, p1.sy);
          ctx.stroke();
        }
      }

      const p = this.projectWorld(sim, fl.x, fl.y, fl.z);
      if (!p) continue;
      ctx.globalAlpha = lifeFrac;
      if (fl.isChaff) {
        // Shimmering metallic radar-chaff cloud glints
        ctx.strokeStyle = '#8EF5AB';
        ctx.lineWidth = 1.4;
        const sz = Math.max(2.5, Math.min(8, p.scale * 0.14));
        ctx.beginPath();
        ctx.moveTo(p.sx - sz, p.sy - sz * 0.5);
        ctx.lineTo(p.sx + sz, p.sy + sz * 0.5);
        ctx.stroke();
      } else {
        // Blazing white-amber IR decoy flare star!
        const sz = Math.max(3.5, Math.min(13, p.scale * 0.22));
        ctx.fillStyle = '#FFF6CC';
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, sz * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFB000';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(p.sx - sz * 1.4, p.sy);
        ctx.lineTo(p.sx + sz * 1.4, p.sy);
        ctx.moveTo(p.sx, p.sy - sz * 1.4);
        ctx.lineTo(p.sx, p.sy + sz * 1.4);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawSparks(ctx: CanvasRenderingContext2D, sim: TrenchSimulation): void {
    ctx.save();
    for (const s of sim.sparks) {
      const p = this.projectWorld(sim, s.x, s.y, s.z);
      if (!p) continue;
      ctx.globalAlpha = Math.max(0, s.life / s.maxLife);
      ctx.fillStyle = s.color;
      const sz = Math.max(1.8, Math.min(6.5, s.size * (p.scale / 22)));
      ctx.fillRect(p.sx - sz * 0.5, p.sy - sz * 0.5, sz, sz);
    }
    ctx.restore();
  }
}
