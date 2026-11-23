import {
  TRENCH_CONSTANTS,
  type CanyonArch,
  type CanyonTarget,
  type Vec3,
} from './types';

function hash2D(ix: number, iz: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function smoothNoise2D(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hash2D(ix, iz);
  const b = hash2D(ix + 1, iz);
  const c = hash2D(ix, iz + 1);
  const d = hash2D(ix + 1, iz + 1);

  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export interface ValleyMesa {
  id: number;
  x: number;
  z: number;
  radius: number;
  height: number;
}

/**
 * Procedural Wide Open Alpine / Glacial Valley Heightmap Generator (3.5x widened basin!).
 * - Broad ~760m valley floor (~1,850m rim-to-rim) enabling sweeping 6G banking dogfights.
 * - Towering 380m–600m terraced alpine mountain flanks + isolated central flat-topped mesas
 *   for genuine 3D terrain masking against SAM radar.
 * - Clean 6km Sector Objective Generator spawning 3 unmistakable classes (SAM_SITE, BANDIT_DRONE,
 *   RESUPPLY_CACHE) spaced 1,200m–1,800m apart with ZERO visual stacking.
 */
export class CanyonTerrain {
  public readonly archSpacingZ = 2700;
  public readonly mesaSpacingZ = 1850;

  /** Smooth grand alpine valley centerline X(z) in world meters */
  public getCanyonCenterX(z: number): number {
    return (
      Math.sin(z * 0.00052) * 620 +
      Math.sin(z * 0.00118 + 1.1) * 210 +
      Math.cos(z * 0.00027 - 0.5) * 340
    );
  }

  /** Instantaneous valley heading (radians, 0 = +Z North, + = East/+X) at world Z */
  public getCanyonHeadingRad(z: number): number {
    const dx =
      Math.cos(z * 0.00052) * 620 * 0.00052 +
      Math.cos(z * 0.00118 + 1.1) * 210 * 0.00118 -
      Math.sin(z * 0.00027 - 0.5) * 340 * 0.00027;
    return Math.atan2(dx, 1);
  }

  /**
   * Local valley floor half-width in meters (~380m in SEC-01 = 3.5x wider than old V-trench!).
   * Tightens slightly in SEC-02+ (~325m) while always keeping sweeping 6G banking room!
   */
  public getCanyonHalfWidth(z: number): number {
    const sectorTighten = Math.min(0.16, Math.max(0, (z - 6000) / 36000) * 0.16);
    const base = 385 * (1 - sectorTighten);
    return base + Math.sin(z * 0.00095 + 0.4) * 58 + Math.cos(z * 0.0021) * 26;
  }

  /** Deterministic isolated central mesa/ridge info for a given mesa index (for terrain masking & caches!) */
  public getMesaByIndex(idx: number): ValleyMesa {
    // Mesa #0 starts cleanly at 2,100m (~7s clear orientation runway from spawn!)
    const z = idx * this.mesaSpacingZ + 2100;
    const side = idx % 2 === 0 ? 1 : -1;
    const offsetFrac = 0.16 + hash2D(idx, 313) * 0.24;
    const x = this.getCanyonCenterX(z) + side * (this.getCanyonHalfWidth(z) * offsetFrac);
    const radius = 120 + hash2D(idx, 419) * 42;
    const height = 112 + hash2D(idx, 521) * 40;
    return { id: idx, x, z, radius, height };
  }

  /**
   * Exact continuous heightmap elevation Y (meters) at any world coordinate (x, z).
   * Features:
   * - Wide glacial valley floor (~12–42m rolling alpine tundra hills)
   * - Isolated central flat-topped mesas (~115–155m tall) you can duck behind for SAM masking
   * - Dramatic outer alpine mountain walls climbing cleanly to 380–620m
   */
  public sampleHeight(x: number, z: number): number {
    const centerX = this.getCanyonCenterX(z);
    const halfW = this.getCanyonHalfWidth(z);
    const lateral = Math.abs(x - centerX);

    // Multi-octave deterministic alpine ridge & glacial floor noise
    const nHuge = smoothNoise2D(x * 0.0014 + 4.7, z * 0.0014 - 9.2);
    const nLarge = smoothNoise2D(x * 0.0036 + 11.3, z * 0.0036 - 7.1);
    const nMid = smoothNoise2D(x * 0.0095 - 3.7, z * 0.0095 + 19.4);

    // Broad glacial valley floor with gentle rolling elevation swells (dramatic on TFR!)
    const floorSwell = Math.max(0, Math.sin(z * 0.0028 + 0.4)) * 24;
    const floorBase = 10 + nLarge * 16 + nMid * 10 + floorSwell;

    // Isolated central flat-topped mesas / glacial buttes for genuine 3D terrain masking!
    let mesaElev = 0;
    if (z > 1400) {
      const nearMesaIdx = Math.max(0, Math.round((z - 2100) / this.mesaSpacingZ));
      for (let mIdx = Math.max(0, nearMesaIdx - 1); mIdx <= nearMesaIdx + 1; mIdx++) {
        const m = this.getMesaByIndex(mIdx);
        const dist = Math.hypot(x - m.x, z - m.z);
        if (dist < m.radius * 1.45) {
          // Flat mesa tabletop inside 0.55*radius, steep cliff walls dropping out to 1.45*radius!
          const t = Math.max(0, Math.min(1, (dist - m.radius * 0.52) / (m.radius * 0.93)));
          const prof = 1 - t * t * (3 - 2 * t);
          mesaElev = Math.max(mesaElev, prof * m.height);
        }
      }
    }

    if (lateral <= halfW * 0.84) {
      return floorBase + mesaElev;
    }

    // Sweeping outer alpine mountain flanks climbing cleanly past 400–620m
    const wallSpan = halfW * 1.32;
    const tRaw = Math.max(0, Math.min(1, (lateral - halfW * 0.84) / wallSpan));
    // Sculpt 2 crisp glacial alpine terraces on the outer flanks
    const stepT = Math.floor(tRaw * 2.5) / 2.5;
    const fracT = (tRaw * 2.5) % 1.0;
    const smoothT = fracT * fracT * (3 - 2 * fracT);
    const terracedT = stepT + smoothT / 2.5;
    const wallProfile = tRaw * 0.58 + terracedT * 0.42;

    const mountainHeight = 320 + nHuge * 210 + nLarge * 95 + nMid * 28;
    const beyondRim = Math.max(0, (lateral - (halfW * 0.84 + wallSpan)) / 360);
    const outerPeaks = beyondRim > 0 ? Math.min(220, beyondRim * (110 + nHuge * 140)) : 0;

    return floorBase + mesaElev + Math.pow(wallProfile, 1.18) * mountainHeight + outerPeaks;
  }

  /**
   * True 3D Line-of-Sight check against valley mountains & central mesas!
   * Allows pilots to duck behind mesas and alpine ridges to break SAM radar lock!
   */
  public hasLineOfSight(a: Vec3, b: Vec3): boolean {
    const steps = 12;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      const pz = a.z + (b.z - a.z) * t;
      if (py < this.sampleHeight(px, pz) + 4) {
        return false;
      }
    }
    return true;
  }

  /** Returns grand valley rock/industrial overhang arches within [minZ .. maxZ] */
  public getArchesInRange(minZ: number, maxZ: number): CanyonArch[] {
    const result: CanyonArch[] = [];
    const firstIdx = Math.max(1, Math.ceil(minZ / this.archSpacingZ));
    const lastIdx = Math.floor(maxZ / this.archSpacingZ);
    for (let idx = firstIdx; idx <= lastIdx; idx++) {
      const z = idx * this.archSpacingZ;
      const centerX = this.getCanyonCenterX(z);
      const halfSpan = Math.min(270, this.getCanyonHalfWidth(z) * 0.72);
      const deckY = 165 + hash2D(idx, 91) * 42;
      result.push({
        id: idx,
        z,
        centerX,
        halfSpan,
        deckY,
        thicknessY: 26 + hash2D(idx, 17) * 12,
        depthZ: 46,
      });
    }
    return result;
  }

  /** Checks if an aircraft point collides with the solid body of a valley arch */
  public checkArchCollision(x: number, y: number, z: number, pad = 4.5): boolean {
    const nearestIdx = Math.round(z / this.archSpacingZ);
    if (nearestIdx < 1) return false;
    const az = nearestIdx * this.archSpacingZ;
    if (Math.abs(z - az) > 23 + pad) return false;

    const centerX = this.getCanyonCenterX(az);
    const halfSpan = Math.min(270, this.getCanyonHalfWidth(az) * 0.72);
    const deckY = 165 + hash2D(nearestIdx, 91) * 42;
    const thicknessY = 26 + hash2D(nearestIdx, 17) * 12;

    if (Math.abs(x - centerX) > halfSpan) return false;
    const spanFrac = Math.min(1, Math.abs(x - centerX) / halfSpan);
    const archCurveDip = spanFrac * spanFrac * 30;
    const localBottomY = deckY - archCurveDip;
    const localTopY = deckY + thicknessY;
    return y + pad > localBottomY && y - pad < localTopY;
  }

  /**
   * 6km Sector Strike Objective Spawner:
   * Spawns ONLY the 3 unmistakable high-contrast target classes spaced 1,200m–1,800m apart:
   * 1. SAM_SITE (#FF3322 Red-Amber Diamonds on valley ridges & mesas)
   * 2. BANDIT_DRONE (#FFB000 Bright Amber Carets cruising & weaving down the valley with contrails)
   * 3. RESUPPLY_CACHE (#00F0FF Electric Cyan Hexagons suspended under arches or atop flat mesas)
   */
  public createSectorTargets(
    sectorNumber: number,
    sectorStartZ: number,
    nextIdRef: { value: number }
  ): { targets: CanyonTarget[]; samCount: number; banditCount: number } {
    const len = TRENCH_CONSTANTS.SECTOR_LENGTH_M; // 6,000m strike run!
    const samCount = Math.min(6, 2 + sectorNumber); // SEC-01: 3, SEC-02: 4, SEC-03: 5, SEC-04+: 6
    const banditCount = Math.min(5, 1 + sectorNumber); // SEC-01: 2, SEC-02: 3, SEC-03: 4, SEC-04+: 5
    const targets: CanyonTarget[] = [];

    // 1. Space Hostile SAM / AAA Sites 1,200m–1,800m apart along valley ridges & overlooks!
    const samSpacing = Math.max(1180, Math.min(1780, (len - 900) / Math.max(1, samCount)));
    for (let i = 0; i < samCount; i++) {
      const r1 = hash2D(sectorNumber * 31 + i, 107);
      const r2 = hash2D(sectorNumber * 37 + i, 223);
      const z = sectorStartZ + 1150 + i * samSpacing + (r1 - 0.5) * 180;
      const centerX = this.getCanyonCenterX(z);
      const halfW = this.getCanyonHalfWidth(z);
      const side = (i + sectorNumber) % 2 === 0 ? -1 : 1;

      // Mount prominently on elevated valley ridge shoulder or foothill shelf (never stacked on centerline!)
      const lateralOffset = halfW * (0.68 + r2 * 0.28);
      const x = centerX + side * lateralOffset;
      const y = this.sampleHeight(x, z) + 16;

      targets.push({
        id: nextIdRef.value++,
        kind: 'SAM_SITE',
        sectorNumber,
        x,
        y,
        z,
        baseX: x,
        baseY: y,
        radius: 22,
        hp: 4,
        maxHp: 4,
        destroyed: false,
        hitFlashTimer: 0,
        bobPhase: r1 * Math.PI * 2,
        patrolAmp: 0,
        samLockTimer: 0,
        fireCooldown: 1.5 + r2 * 1.5,
        muzzleFlashTimer: 0,
      });
    }

    // 2. Airborne Bandit Drones cruising & weaving down the wide open valley with contrails!
    const banditSpacing = (len - 1200) / Math.max(1, banditCount);
    const banditCruise = Math.min(165, 90 + (sectorNumber - 1) * 22); // Realistic sea-level closure for dogfights!
    for (let i = 0; i < banditCount; i++) {
      const r1 = hash2D(sectorNumber * 43 + i, 331);
      const r2 = hash2D(sectorNumber * 47 + i, 449);
      const z = sectorStartZ + 1650 + i * banditSpacing + (r1 - 0.5) * 220;
      const centerX = this.getCanyonCenterX(z);
      const halfW = this.getCanyonHalfWidth(z);
      const side = i % 2 === 0 ? 1 : -1;
      const x = centerX + side * halfW * (0.22 + r2 * 0.24);
      const groundY = this.sampleHeight(x, z);
      const y = groundY + 95 + r1 * 65;

      targets.push({
        id: nextIdRef.value++,
        kind: 'BANDIT_DRONE',
        sectorNumber,
        x,
        y,
        z,
        vx: 0,
        vy: 0,
        vz: banditCruise,
        baseX: x,
        baseY: y,
        radius: 19,
        hp: 4,
        maxHp: 4,
        destroyed: false,
        hitFlashTimer: 0,
        bobPhase: r1 * Math.PI * 2,
        patrolAmp: Math.min(230, 125 + sectorNumber * 28),
        cruiseSpeedMps: banditCruise,
        trail: [{ x, y, z }],
      });
    }

    // 3. Two Unmistakable Electric-Cyan Ordnance Resupply Caches per 6km Sector!
    // Cache A: Perched prominently on top of a flat central mesa near early-mid sector
    const mesaIdx = Math.max(0, Math.round((sectorStartZ + 2200 - 2100) / this.mesaSpacingZ));
    const mesa = this.getMesaByIndex(mesaIdx);
    const mesaTopY = this.sampleHeight(mesa.x, mesa.z) + 18;
    targets.push({
      id: nextIdRef.value++,
      kind: 'RESUPPLY_CACHE',
      sectorNumber,
      x: mesa.x,
      y: mesaTopY,
      z: mesa.z,
      baseX: mesa.x,
      baseY: mesaTopY,
      radius: 21,
      hp: 1,
      maxHp: 1,
      destroyed: false,
      hitFlashTimer: 0,
      bobPhase: 0,
      patrolAmp: 0,
    });

    // Cache B: Suspended visibly under a valley arch (or on a clear flat floor pad near 4.6km mark)
    const archCandidates = this.getArchesInRange(sectorStartZ + 2900, sectorStartZ + len - 300);
    if (archCandidates.length > 0) {
      const arch = archCandidates[0];
      const cx = arch.centerX;
      const cy = Math.max(this.sampleHeight(cx, arch.z) + 46, arch.deckY - 26);
      targets.push({
        id: nextIdRef.value++,
        kind: 'RESUPPLY_CACHE',
        sectorNumber,
        x: cx,
        y: cy,
        z: arch.z,
        baseX: cx,
        baseY: cy,
        radius: 21,
        hp: 1,
        maxHp: 1,
        destroyed: false,
        hitFlashTimer: 0,
        bobPhase: 1.4,
        patrolAmp: 0,
      });
    } else {
      const cz = sectorStartZ + 4550;
      const cx = this.getCanyonCenterX(cz);
      const cy = this.sampleHeight(cx, cz) + 18;
      targets.push({
        id: nextIdRef.value++,
        kind: 'RESUPPLY_CACHE',
        sectorNumber,
        x: cx,
        y: cy,
        z: cz,
        baseX: cx,
        baseY: cy,
        radius: 21,
        hp: 1,
        maxHp: 1,
        destroyed: false,
        hitFlashTimer: 0,
        bobPhase: 1.4,
        patrolAmp: 0,
      });
    }

    return { targets, samCount, banditCount };
  }
}
