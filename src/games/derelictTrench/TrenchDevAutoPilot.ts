import type { F16FlightInput, TrenchSimulation } from './TrenchSimulation';
import { TRENCH_CONSTANTS, type CanyonTarget } from './types';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function wrapAngle(a: number): number {
  let out = a;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out < -Math.PI) out += Math.PI * 2;
  return out;
}

/**
 * Lightweight Dev-Only Terrain-Following + Target-Tracking AutoPilot for `window.__TRENCH_DEBUG__`.
 * Only instantiated inside `if (import.meta.env.DEV)` so Rollup/Vite strips 100% of this file
 * from production bundles.
 */
export class TrenchDevAutoPilot {
  private enabled = false;
  private breakTurnTimer = 0;
  private breakTurnSign: -1 | 1 = 1;
  private missileCooldown = 0;

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(on: boolean): void {
    this.enabled = on;
    this.breakTurnTimer = 0;
    this.missileCooldown = 0;
  }

  public computeInput(sim: TrenchSimulation, dt: number): F16FlightInput {
    if (this.breakTurnTimer > 0) this.breakTurnTimer = Math.max(0, this.breakTurnTimer - dt);
    if (this.missileCooldown > 0) this.missileCooldown = Math.max(0, this.missileCooldown - dt);

    const terrain = sim.terrain;
    const lookZ = sim.z + 520;
    const centerAhead = terrain.getCanyonCenterX(lookZ);
    const halfW = terrain.getCanyonHalfWidth(lookZ);

    // 1. Choose safe lateral valley corridor (steering cleanly around central mesas!)
    const curGroundY = terrain.sampleHeight(sim.x, sim.z);
    let desiredX = centerAhead;
    const nearMesaIdx = Math.max(0, Math.round((sim.z + 480 - 2100) / terrain.mesaSpacingZ));
    for (let mIdx = Math.max(0, nearMesaIdx - 1); mIdx <= nearMesaIdx + 1; mIdx++) {
      const m = terrain.getMesaByIndex(mIdx);
      if (m.z > sim.z + 60 && m.z < sim.z + 960) {
        const dxMesa = desiredX - m.x;
        if (Math.abs(dxMesa) < m.radius * 1.65) {
          const mCenter = terrain.getCanyonCenterX(m.z);
          const openSide = m.x >= mCenter ? -1 : 1;
          desiredX = m.x + openSide * (m.radius * 1.85);
        }
      }
    }

    // Check overhead valley arches ahead so we pass cleanly centered & well beneath their deck!
    let archDeckLimitY = Infinity;
    const arches = terrain.getArchesInRange(sim.z - 30, sim.z + 1150);
    for (const arch of arches) {
      archDeckLimitY = Math.min(archDeckLimitY, arch.deckY - arch.thicknessY * 0.5 - 34);
      if (arch.z > sim.z + 40 && arch.z < sim.z + 950) {
        // Gently align toward open arch center when approaching
        desiredX = desiredX * 0.45 + arch.centerX * 0.55;
      }
    }

    // Sample terrain elevation along our planned forward path (not into outer mountain flanks)
    let maxAheadGroundY = curGroundY;
    const probeDists = [120, 260, 440, 650];
    for (const d of probeDists) {
      const frac = Math.min(1, d / 520);
      const px = sim.x + (desiredX - sim.x) * frac;
      const pz = sim.z + d;
      const h = terrain.sampleHeight(px, pz);
      if (h > maxAheadGroundY) maxAheadGroundY = h;
    }

    // Stay strictly under sector radar ceiling & arch decks while maintaining safe ground clearance
    const minSafeY = Math.max(curGroundY + 46, maxAheadGroundY + 38);
    const ceilingCapY = curGroundY + sim.sectorRadarCeilingM - 26;
    const upperCapY = Math.min(ceilingCapY, archDeckLimitY);
    let desiredY =
      archDeckLimitY < Infinity
        ? Math.min(upperCapY, Math.max(curGroundY + 56, maxAheadGroundY + 32))
        : clamp(curGroundY + 86, minSafeY, Math.max(minSafeY, upperCapY));

    // 2. Incoming SAM Evasion: deploy CMDS flares + initiate crisp break-turn!
    let deployCmdsPressed = false;
    const primarySam = sim.getPrimaryIncomingSamTelemetry();
    if (primarySam) {
      if (
        primarySam.distM <= TRENCH_CONSTANTS.CMDS_DECOY_RANGE_M - 40 &&
        sim.cmdsCooldown <= 0 &&
        sim.cmdsRemaining > 0
      ) {
        deployCmdsPressed = true;
        this.breakTurnTimer = 0.78;
        this.breakTurnSign = sim.x > centerAhead ? -1 : 1;
      } else if (primarySam.distM < 900 && this.breakTurnTimer <= 0) {
        this.breakTurnTimer = 0.65;
        this.breakTurnSign = sim.x > centerAhead ? -1 : 1;
      }
    }

    // 3. Target Tracking (SAM sites & Bandits, or Cyan Resupply when stores dip)
    let activeTarget: CanyonTarget | null = null;
    const needStores =
      sim.missilesRemaining <= 2 || sim.gunAmmo < 180 || sim.cmdsRemaining <= 3;

    let bestScore = Infinity;
    for (const t of sim.targets) {
      if (t.destroyed) continue;
      if (t.kind === 'RESUPPLY_CACHE' && !needStores) continue;
      const dz = t.z - sim.z;
      if (dz < 220 || dz > 2400) continue;
      const dist = Math.hypot(t.x - sim.x, t.y - sim.y, dz);
      const latFromCenter = Math.abs(t.x - terrain.getCanyonCenterX(t.z));
      if (latFromCenter > terrain.getCanyonHalfWidth(t.z) * 0.95) continue;
      const kindBias = t.kind === 'SAM_SITE' ? -250 : t.kind === 'RESUPPLY_CACHE' ? -300 : 0;
      const score = dist + kindBias;
      if (score < bestScore) {
        bestScore = score;
        activeTarget = t;
      }
    }

    if (activeTarget && this.breakTurnTimer <= 0 && archDeckLimitY === Infinity) {
      const targetDZ = Math.max(220, activeTarget.z - sim.z);
      const blend = clamp(1 - targetDZ / 2400, 0.25, 0.85);
      const clampedTgtX = clamp(
        activeTarget.x,
        centerAhead - halfW * 0.56,
        centerAhead + halfW * 0.56
      );
      desiredX = desiredX * (1 - blend) + clampedTgtX * blend;
      const tgtDesiredY = clamp(activeTarget.y + 8, minSafeY, Math.max(minSafeY, upperCapY));
      desiredY = desiredY * 0.35 + tgtDesiredY * 0.65;
    }

    // Clamp lateral target strictly within safe open valley floor
    desiredX = clamp(desiredX, centerAhead - halfW * 0.58, centerAhead + halfW * 0.58);

    // 4. Weapons Fire Logic (AIM-9 Missile on Lock + 20mm Vulcan on Nose Alignment)
    let launchMissilePressed = false;
    const lockedTgt = sim.getLockedTarget();
    if (
      sim.lockState === 'LOCKED' &&
      lockedTgt &&
      lockedTgt.kind !== 'RESUPPLY_CACHE' &&
      sim.missilesRemaining > 0 &&
      this.missileCooldown <= 0 &&
      !sim.missiles.some((m) => m.targetId === lockedTgt.id)
    ) {
      launchMissilePressed = true;
      this.missileCooldown = 0.65;
    }

    let firingGun = false;
    if (sim.gunAmmo > 0) {
      const gunTarget = activeTarget ?? lockedTgt;
      if (gunTarget && !gunTarget.destroyed) {
        const dx = gunTarget.x - sim.x;
        const dy = gunTarget.y - sim.y;
        const dz = gunTarget.z - sim.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist >= 120 && dist <= 1350) {
          const dot =
            (dx * sim.basis.forward.x + dy * sim.basis.forward.y + dz * sim.basis.forward.z) / dist;
          if (dot >= 0.992) {
            firingGun = true;
          }
        }
      }
    }

    // 5. Smooth Bank-to-Turn + Pitch Autopilot Control Law
    const desiredYaw = Math.atan2(desiredX - sim.x, Math.max(180, lookZ - sim.z));
    const yawErr = wrapAngle(desiredYaw - sim.yaw);
    const desiredPitch = clamp(Math.atan2(desiredY - sim.y, 440), -0.34, 0.38);
    const pitchErr = desiredPitch - sim.pitch;

    const desiredRoll =
      this.breakTurnTimer > 0
        ? this.breakTurnSign * 1.05
        : clamp(yawErr * 1.45, -0.78, 0.78);
    const rollErr = wrapAngle(desiredRoll - sim.roll);

    const stickRoll = clamp(rollErr * 1.35 - sim.rollRateRadS * 0.28, -1, 1);

    // In TrenchSimulation: stickPull = invertPitch ? -stickPitch : stickPitch;
    // positive stickPull pitches nose UP when upright (cos(roll) > 0) and turns in direction of bank!
    const desiredPull =
      this.breakTurnTimer > 0
        ? clamp(0.65 + pitchErr * 1.6, -0.85, 0.95)
        : clamp(pitchErr * 2.2 - sim.pitchRateRadS * 0.32 + Math.abs(Math.sin(sim.roll)) * 0.22, -0.9, 0.95);
    const stickPitch = sim.invertPitch ? -desiredPull : desiredPull;

    const rudderInput = clamp(yawErr * 1.1, -0.65, 0.65);

    // Keep fast corner-speed cruise (~440 KCAS), lighting afterburner if Purge Wave closes in!
    const targetThrottle =
      sim.purgeDistanceM < 560 || sim.kcas < 300
        ? 1.14
        : sim.raltM < 35
          ? 0.95
          : 0.84;
    const throttleDelta =
      sim.throttle < targetThrottle - 0.03 ? 1 : sim.throttle > targetThrottle + 0.03 ? -1 : 0;

    return {
      stickRoll,
      stickPitch,
      throttleDelta,
      rudderInput,
      firingGun,
      launchMissilePressed,
      deployCmdsPressed,
    };
  }
}
