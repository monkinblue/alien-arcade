import type { Vec2 } from '../types';
import { FlowFieldPathfinder } from './FlowFieldPathfinder';
import { Sector01Blueprint, type ColonyBlueprint } from './Sector01Blueprint';
import {
  HARDWARE_SPECS,
  HOSTILE_SPECS,
  PERIMETER_CONSTANTS,
  type AcidHazardPool,
  type AirlockChamberDef,
  type AirlockPurgeWave,
  type BlastDoorState,
  type BuildToolId,
  type CommandAbilityId,
  type CryoPlume,
  type FloatingCallout,
  type GrateBreachTelegraph,
  type HostileEntity,
  type HostileKind,
  type MotionSweepWave,
  type NapalmCloud,
  type OverclockZone,
  type PerimeterMode,
  type PerimeterPhase,
  type PlacedTurret,
  type StrobeFlareZone,
  type TracerBolt,
  type TurretKind,
  type VectorSpark,
  type WaveDefinition,
} from './types';

export interface SimulationAudioCallbacks {
  onMotionPing(distMeters: number, maxMeters: number, pan: number): void;
  onPulseBurst(pan: number, overclocked: boolean, distanceNorm: number): void;
  onAmmoTick(ammoRatio: number): void;
  onLowAmmoAlert(pan: number, isCriticalEmpty: boolean): void;
  onRearmSentry(pan: number): void;
  onDryFire(pan: number): void;
  onIncinerator(pan: number, distanceNorm: number): void;
  onAlienScreech(
    context: 'SWARM' | 'HIT' | 'DEATH' | 'BURNING' | 'DOOR_CLAW',
    kind: HostileKind,
    pan: number,
    distanceNorm: number
  ): void;
  onCryoHiss(pan: number): void;
  onArcWeld(pan: number): void;
  onDoorBatter(pan: number): void;
  onRicochet(pan: number): void;
  onAcidSizzle(pan: number): void;
  onAirlockPurge(pan: number): void;
  onBulkheadBreach(): void;
  onFlarePop(pan: number): void;
  onOverclockSurge(pan: number): void;
  onServoStep(pan: number): void;
  onLogClick(): void;
  onSyncGlitch(intensity: number): void;
}

interface PendingSpawnCursor {
  ventId: string;
  kind: HostileKind;
  remaining: number;
  totalCount: number;
  intervalSec: number;
  timerSec: number;
  telegraphSent: boolean;
}

export class PerimeterSimulation {
  public blueprint: ColonyBlueprint;
  public pathfinder: FlowFieldPathfinder;
  public audioCb: SimulationAudioCallbacks;

  public mode: PerimeterMode = 'SECTOR_01';
  public phase: PerimeterPhase = 'BRIEFING';
  public tacticalPaused = false;
  public fastForward2x = false;

  // Economy & Core Health
  public scrap: number = PERIMETER_CONSTANTS.INITIAL_SCRAP;
  public maxReactorKw: number = PERIMETER_CONSTANTS.BASE_REACTOR_KW;
  public bulkheadSeals: number = PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS;
  public sealLostFlashTimer = 0;

  // Score & Wave Progression
  public waveNumber = 1;
  public currentWaveDef: WaveDefinition;
  public totalKills = 0;
  public score = 0;
  public prepCountdownSec = 0; // Optional auto-wave or manual trigger

  // Entities & Tactical Objects
  public turrets: PlacedTurret[] = [];
  public doors = new Map<string, BlastDoorState>();
  public hostiles: HostileEntity[] = [];
  public motionWaves: MotionSweepWave[] = [];
  public flares: StrobeFlareZone[] = [];
  public overclocks: OverclockZone[] = [];
  public napalmClouds: NapalmCloud[] = [];
  public cryoPlumes: CryoPlume[] = [];
  public acidPools: AcidHazardPool[] = [];
  public purgeWaves: AirlockPurgeWave[] = [];
  public tracers: TracerBolt[] = [];
  public sparks: VectorSpark[] = [];
  public callouts: FloatingCallout[] = [];
  public grateTelegraphs: GrateBreachTelegraph[] = [];

  // Active Command Ability Cooldowns, Surges & Real Reactor Overload / Blackout State
  public flareCooldown = 0;
  public overclockCooldown = 0;
  public purgeAvailableThisWave = true;
  public activeFlareSurgeTimer = 0;
  public activeOverclockSurgeTimer = 0;
  public overloadTimer = 0;
  public blackoutTimer = 0;

  // Event Log Stream
  public eventLogs: string[] = [];

  // Internal counters
  private nextHostileId = 1;
  private callsignCounters: Record<TurretKind, number> = {
    SENTRY_PULSE: 0,
    INCINERATOR: 0,
    CRYO_VALVE: 0,
    MOTION_RELAY: 0,
  };
  private spawnQueue: PendingSpawnCursor[] = [];
  private coreSweepTimer = 0.6;
  private trackerAudioTimer = 0.5;
  private swarmScreechTimer = 1.3;
  private hitScreechCooldown = 0;
  private burnScreechCooldown = 0;
  private doorScreechCooldown = 0;
  private deathScreechCooldown = 0;
  private lowAmmoReminderTimer = 0;
  private overloadWarnCooldown = 0;
  private grateRattleCooldown = 0;
  private warnedLowAmmoIds = new Set<string>();
  private warnedDryIds = new Set<string>();
  private warnedAcidDoorIds = new Map<string, number>();

  constructor(audioCb: SimulationAudioCallbacks) {
    this.audioCb = audioCb;
    this.blueprint = Sector01Blueprint.createSector01();
    this.pathfinder = new FlowFieldPathfinder(this.blueprint);
    this.currentWaveDef = Sector01Blueprint.getWaveDefinition(1);
    this.resetRun('SECTOR_01', true);
  }

  public resetRun(mode: PerimeterMode, showBriefing = false): void {
    this.mode = mode;
    this.phase = showBriefing ? 'BRIEFING' : 'TACTICAL_PREP';
    this.tacticalPaused = false;
    this.fastForward2x = false;

    this.scrap = PERIMETER_CONSTANTS.INITIAL_SCRAP;
    this.maxReactorKw = PERIMETER_CONSTANTS.BASE_REACTOR_KW;
    this.bulkheadSeals = PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS;
    this.sealLostFlashTimer = 0;

    this.waveNumber = 1;
    this.currentWaveDef = Sector01Blueprint.getWaveDefinition(1);
    this.totalKills = 0;
    this.score = 0;

    this.turrets = [];
    this.hostiles = [];
    this.motionWaves = [];
    this.flares = [];
    this.overclocks = [];
    this.napalmClouds = [];
    this.cryoPlumes = [];
    this.acidPools = [];
    this.purgeWaves = [];
    this.tracers = [];
    this.sparks = [];
    this.callouts = [];
    this.grateTelegraphs = [];
    this.spawnQueue = [];

    this.flareCooldown = 0;
    this.overclockCooldown = 0;
    this.purgeAvailableThisWave = true;
    this.activeFlareSurgeTimer = 0;
    this.activeOverclockSurgeTimer = 0;
    this.overloadTimer = 0;
    this.blackoutTimer = 0;
    this.overloadWarnCooldown = 0;
    this.grateRattleCooldown = 0;

    this.callsignCounters = {
      SENTRY_PULSE: 0,
      INCINERATOR: 0,
      CRYO_VALVE: 0,
      MOTION_RELAY: 0,
    };
    this.warnedLowAmmoIds.clear();
    this.warnedDryIds.clear();
    this.warnedAcidDoorIds.clear();

    this.doors.clear();
    for (const def of this.blueprint.blastDoors) {
      this.doors.set(def.id, {
        def,
        welded: false,
        hp: 0,
        maxHp: PERIMETER_CONSTANTS.DOOR_MAX_HP,
        underAttackTimer: 0,
        acidCorrodingTimer: 0,
        weldingTimer: 0,
        weldingDuration: PERIMETER_CONSTANTS.WELD_DURATION_SEC,
        repairCooldown: 0,
      });
    }
    this.pathfinder.recompute(this.blueprint, this.doors);

    this.eventLogs = [
      `LOG> MU-TH-UR TACTICAL UPLINK ONLINE // ${this.blueprint.code}: ${this.blueprint.name}`,
      `LOG> REACTOR BUS: ${this.maxReactorKw} kW // ORDNANCE SCRAP: ${this.scrap} // CORE SEALS: 3/3`,
      'LOG> DEPLOY SENTRIES [1-4], WELD DOORS [5], AND ENGAGE WAVE 01.',
    ];
  }

  public pushLog(msg: string, playClick = true): void {
    const formatted = msg.startsWith('LOG>') ? msg : `LOG> ${msg}`;
    if (this.eventLogs[this.eventLogs.length - 1] === formatted) return;
    this.eventLogs.push(formatted);
    if (this.eventLogs.length > 24) {
      this.eventLogs.shift();
    }
    if (playClick) {
      this.audioCb.onLogClick();
    }
  }

  public getStaticAllocatedKw(): number {
    let sum = 0;
    for (const t of this.turrets) {
      if (t.powered) {
        sum += HARDWARE_SPECS[t.kind].powerKw;
      }
    }
    return sum;
  }

  public getTotalLoadKw(): number {
    if (this.blackoutTimer > 0) return 0;
    let kw = this.getStaticAllocatedKw();
    if (this.activeFlareSurgeTimer > 0) kw += PERIMETER_CONSTANTS.FLARE_SURGE_KW;
    if (this.activeOverclockSurgeTimer > 0) kw += PERIMETER_CONSTANTS.OVERCLOCK_SURGE_KW;
    return kw;
  }

  public getActiveSealedDoorCount(): number {
    let count = 0;
    for (const ds of this.doors.values()) {
      if (ds.welded || ds.weldingTimer > 0) count++;
    }
    return count;
  }

  private panFromVirtualX(x: number): number {
    return Math.max(-0.85, Math.min(0.85, (x / PERIMETER_CONSTANTS.VIRTUAL_W - 0.5) * 1.5));
  }

  private distNormFromCore(pos: Vec2): number {
    const d = Math.hypot(pos.x - this.blueprint.coreCenter.x, pos.y - this.blueprint.coreCenter.y);
    return Math.max(0, Math.min(1, (d - 120) / 780));
  }

  public getActiveNapalmAudioState(): { intensity: number; pan: number } {
    if (this.tacticalPaused || this.napalmClouds.length === 0) {
      return { intensity: 0, pan: 0 };
    }
    let totalWeight = 0;
    let weightedPan = 0;
    for (const c of this.napalmClouds) {
      const w = Math.max(0.1, Math.min(1, c.remainingSec / Math.max(0.5, c.maxSec * 0.4)));
      totalWeight += w;
      weightedPan += this.panFromVirtualX(c.pos.x) * w;
    }
    return {
      intensity: totalWeight,
      pan: totalWeight > 1e-4 ? weightedPan / totalWeight : 0,
    };
  }

  // ===========================================================================
  // PLACEMENT, DOOR WELDING, INSPECTOR ACTIONS & ACTIVE COMMAND ABILITIES
  // (All work seamlessly even while SPACEBAR Tactical Pause is active!)
  // ===========================================================================

  public canPlaceHardwareAt(
    buildId: Exclude<BuildToolId, 'NONE'>,
    col: number,
    row: number
  ): { ok: boolean; reason?: string } {
    if (col < 0 || col >= this.blueprint.cols || row < 0 || row >= this.blueprint.rows) {
      return { ok: false, reason: 'OUT OF BOUNDS' };
    }
    const spec = HARDWARE_SPECS[buildId];

    if (buildId === 'ARC_WELDER') {
      const door = this.findDoorAtTile(col, row);
      if (!door) {
        return { ok: false, reason: 'SELECT A CORRIDOR BLAST DOOR [D-01..D-06]' };
      }
      if (door.weldingTimer > 0) {
        return { ok: false, reason: `${door.def.id} ARC-WELD IN PROGRESS (${door.weldingTimer.toFixed(1)}S)` };
      }
      if (door.welded && door.hp >= door.maxHp - 5) {
        return { ok: false, reason: `${door.def.id} ALREADY SEALED AT 100%` };
      }
      if (door.welded && door.repairCooldown > 0) {
        return { ok: false, reason: `${door.def.id} TORCH COOLING (${door.repairCooldown.toFixed(1)}S)` };
      }
      if (!door.welded && this.getActiveSealedDoorCount() >= PERIMETER_CONSTANTS.MAX_ACTIVE_DOOR_SEALS) {
        return {
          ok: false,
          reason: `MAX ${PERIMETER_CONSTANTS.MAX_ACTIVE_DOOR_SEALS} DOOR SEALS ACTIVE — UNSEAL ONE FIRST`,
        };
      }
      const cost = door.welded
        ? Math.max(18, Math.round(spec.costScrap * (1 - door.hp / door.maxHp)))
        : spec.costScrap;
      if (this.scrap < cost) {
        return { ok: false, reason: `INSUFFICIENT SCRAP (${cost} REQ)` };
      }
      return { ok: true };
    }

    const tileKind = this.blueprint.tiles[row][col];
    if (this.turrets.some((t) => t.col === col && t.row === row)) {
      return { ok: false, reason: 'HARDPOINT OCCUPIED' };
    }

    if (buildId === 'CRYO_VALVE') {
      if (tileKind !== 'DUCT_GRATE') {
        return { ok: false, reason: 'MOUNT CRYO VALVE ON FLOOR DUCT GRATE' };
      }
    } else {
      if (tileKind !== 'MOUNT_PAD') {
        return { ok: false, reason: 'DEPLOY ON TACTICAL MOUNT HARDPOINT [+]' };
      }
    }

    if (this.scrap < spec.costScrap) {
      return { ok: false, reason: `INSUFFICIENT SCRAP (${spec.costScrap} REQ)` };
    }
    if (this.getStaticAllocatedKw() + spec.powerKw > this.maxReactorKw) {
      return {
        ok: false,
        reason: `REACTOR CAP EXCEEDED (+${spec.powerKw} kW REQ — TOGGLE UNIT OFFLINE)`,
      };
    }

    return { ok: true };
  }

  public findDoorAtTile(col: number, row: number): BlastDoorState | null {
    for (const ds of this.doors.values()) {
      for (const t of ds.def.tiles) {
        if (t.col === col && t.row === row) return ds;
      }
    }
    return null;
  }

  public findDoorNearPoint(pos: Vec2, maxDistPx = 56): BlastDoorState | null {
    let best: BlastDoorState | null = null;
    let bestDist = maxDistPx;
    for (const ds of this.doors.values()) {
      const d = Math.hypot(ds.def.center.x - pos.x, ds.def.center.y - pos.y);
      if (d < bestDist) {
        bestDist = d;
        best = ds;
      }
    }
    return best;
  }

  public findTurretAt(pos: Vec2, maxDistPx = 38): PlacedTurret | null {
    let best: PlacedTurret | null = null;
    let bestDist = maxDistPx;
    for (const t of this.turrets) {
      const d = Math.hypot(t.pos.x - pos.x, t.pos.y - pos.y);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    return best;
  }

  public findAirlockAt(pos: Vec2): AirlockChamberDef | null {
    for (const al of this.blueprint.airlocks) {
      if (
        pos.x >= al.bounds.x - 24 &&
        pos.x <= al.bounds.x + al.bounds.width + 24 &&
        pos.y >= al.bounds.y - 24 &&
        pos.y <= al.bounds.y + al.bounds.height + 24
      ) {
        return al;
      }
    }
    return null;
  }

  public deployHardware(
    buildId: Exclude<BuildToolId, 'NONE'>,
    col: number,
    row: number,
    aimAngle: number
  ): { ok: boolean; placedTurret?: PlacedTurret; weldedDoor?: BlastDoorState; reason?: string } {
    const check = this.canPlaceHardwareAt(buildId, col, row);
    if (!check.ok) {
      return { ok: false, reason: check.reason };
    }

    if (buildId === 'ARC_WELDER') {
      const door = this.findDoorAtTile(col, row)!;
      const spec = HARDWARE_SPECS.ARC_WELDER;
      const cost = door.welded
        ? Math.max(18, Math.round(spec.costScrap * (1 - door.hp / door.maxHp)))
        : spec.costScrap;
      this.scrap -= cost;
      const wasWelded = door.welded;

      if (this.phase === 'TACTICAL_PREP') {
        // Instant setup during pre-wave tactical prep
        door.welded = true;
        door.weldingTimer = 0;
        door.hp = door.maxHp;
        door.repairCooldown = 0;
        this.pathfinder.recompute(this.blueprint, this.doors);
        this.recomputeRelayLinks();
        this.audioCb.onArcWeld(this.panFromVirtualX(door.def.center.x));
        this.spawnSparks(door.def.center, 14, '#FFB000');
        this.pushLog(
          wasWelded
            ? `REINFORCED BULKHEAD SEAL ${door.def.id} [100% HP]`
            : `ARC-WELDED BULKHEAD ${door.def.id} (${this.getActiveSealedDoorCount()}/${PERIMETER_CONSTANTS.MAX_ACTIVE_DOOR_SEALS}) // HOSTILE FLOW REROUTED`
        );
      } else {
        // Mid-wave: realistic 2.0s arc-weld torch sequence!
        door.weldingTimer = PERIMETER_CONSTANTS.WELD_DURATION_SEC;
        door.weldingDuration = PERIMETER_CONSTANTS.WELD_DURATION_SEC;
        this.audioCb.onArcWeld(this.panFromVirtualX(door.def.center.x));
        this.spawnSparks(door.def.center, 10, '#FFB000');
        this.pushLog(
          wasWelded
            ? `REINFORCING ${door.def.id} [${PERIMETER_CONSTANTS.WELD_DURATION_SEC.toFixed(1)}S TORCH SEQUENCE]...`
            : `ARC-WELDING ${door.def.id} [${PERIMETER_CONSTANTS.WELD_DURATION_SEC.toFixed(1)}S TORCH SEQUENCE]...`
        );
      }
      return { ok: true, weldedDoor: door };
    }

    const spec = HARDWARE_SPECS[buildId];
    this.scrap -= spec.costScrap;

    this.callsignCounters[buildId] += 1;
    const prefix =
      buildId === 'SENTRY_PULSE'
        ? 'A'
        : buildId === 'INCINERATOR'
          ? 'F'
          : buildId === 'CRYO_VALVE'
            ? 'C'
            : 'M';
    const callsign = `${prefix}-${String(this.callsignCounters[buildId]).padStart(2, '0')}`;
    const ts = this.blueprint.tileSize;
    const pos: Vec2 = { x: col * ts + ts * 0.5, y: row * ts + ts * 0.5 };

    const turret: PlacedTurret = {
      id: `turret-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      callsign,
      kind: buildId,
      col,
      row,
      pos,
      powered: true,
      level: 1,
      angle: aimAngle,
      targetAngle: aimAngle,
      ammo: spec.maxAmmo,
      maxAmmo: spec.maxAmmo,
      rearmTimer: 0,
      rearmDuration: PERIMETER_CONSTANTS.REARM_DURATION_SEC,
      heat: 0,
      thermalLocked: false,
      fireCooldown: 0,
      pulseTimer: 0.35,
      firingFlashTimer: 0,
      dryFireTimer: 0,
      overclockTimer: 0,
      relayBoosted: false,
      tripwireIntegrity: 100,
      kills: 0,
    };

    if (buildId === 'MOTION_RELAY') {
      this.computeTripwireBeam(turret, aimAngle);
    }

    this.turrets.push(turret);
    this.recomputeRelayLinks();
    this.pushLog(`DEPLOYED ${spec.code} [${callsign}] // -${spec.costScrap} SCRAP (${spec.powerKw} kW)`);
    return { ok: true, placedTurret: turret };
  }

  public computeDefaultAimAngle(col: number, row: number): number {
    const ts = this.blueprint.tileSize;
    const pos = { x: col * ts + ts * 0.5, y: row * ts + ts * 0.5 };
    // Point toward the nearest open corridor / outer vent direction away from Core
    let bestAng = Math.atan2(pos.y - this.blueprint.coreCenter.y, pos.x - this.blueprint.coreCenter.x);
    let bestClear = -1;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      let clearDist = 0;
      for (let d = 40; d <= 300; d += 30) {
        const tc = Math.floor((pos.x + Math.cos(a) * d) / ts);
        const tr = Math.floor((pos.y + Math.sin(a) * d) / ts);
        if (
          tc >= 0 &&
          tc < this.blueprint.cols &&
          tr >= 0 &&
          tr < this.blueprint.rows &&
          FlowFieldPathfinder.isWalkableKind(this.blueprint.tiles[tr][tc])
        ) {
          clearDist = d;
        } else {
          break;
        }
      }
      if (clearDist > bestClear) {
        bestClear = clearDist;
        bestAng = a;
      }
    }
    return bestAng;
  }

  private computeTripwireBeam(turret: PlacedTurret, preferredAngle: number): void {
    const ts = this.blueprint.tileSize;
    const castRay = (ang: number): { end: Vec2; dist: number } => {
      const maxD = 235;
      let lastPt = { ...turret.pos };
      let dist = 0;
      for (let d = 12; d <= maxD; d += 8) {
        const px = turret.pos.x + Math.cos(ang) * d;
        const py = turret.pos.y + Math.sin(ang) * d;
        const c = Math.floor(px / ts);
        const r = Math.floor(py / ts);
        if (
          c < 0 ||
          c >= this.blueprint.cols ||
          r < 0 ||
          r >= this.blueprint.rows ||
          !FlowFieldPathfinder.isWalkableKind(this.blueprint.tiles[r][c])
        ) {
          return { end: lastPt, dist };
        }
        lastPt = { x: px, y: py };
        dist = d;
      }
      return { end: lastPt, dist };
    };

    let chosen = castRay(preferredAngle);
    let chosenAng = preferredAngle;
    if (chosen.dist < 48) {
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const r = castRay(a);
        if (r.dist > chosen.dist) {
          chosen = r;
          chosenAng = a;
        }
      }
    }
    turret.angle = chosenAng;
    turret.targetAngle = chosenAng;
    turret.tripwireStart = { ...turret.pos };
    turret.tripwireEnd = chosen.end;
  }

  private recomputeRelayLinks(): void {
    const activeRelays = this.turrets.filter((t) => t.kind === 'MOTION_RELAY' && t.powered);
    for (const t of this.turrets) {
      if (t.kind === 'SENTRY_PULSE') {
        t.relayBoosted = activeRelays.some(
          (r) => Math.hypot(r.pos.x - t.pos.x, r.pos.y - t.pos.y) <= 255
        );
      } else {
        t.relayBoosted = false;
      }
    }
  }

  public toggleDoorSeal(doorId: string): { ok: boolean; msg: string } {
    const ds = this.doors.get(doorId);
    if (!ds) return { ok: false, msg: 'DOOR NOT FOUND' };
    if (ds.weldingTimer > 0) {
      return { ok: false, msg: `${ds.def.id} ARC-WELD IN PROGRESS` };
    }
    if (ds.welded) {
      // Tactical unseal!
      ds.welded = false;
      ds.hp = 0;
      ds.weldingTimer = 0;
      this.pathfinder.recompute(this.blueprint, this.doors);
      this.pushLog(`UNSEALED BULKHEAD DOOR ${ds.def.id} // CORRIDOR OPENED`);
      return { ok: true, msg: `${ds.def.id} UNSEALED` };
    }
    const tile = ds.def.tiles[0];
    const res = this.deployHardware('ARC_WELDER', tile.col, tile.row, 0);
    return {
      ok: res.ok,
      msg:
        res.reason ??
        (this.phase === 'WAVE_ACTIVE' ? `${ds.def.id} WELDING (2.0S)...` : `${ds.def.id} WELDED`),
    };
  }

  public repairDoorSeal(doorId: string): { ok: boolean; msg: string } {
    const ds = this.doors.get(doorId);
    if (!ds) return { ok: false, msg: 'DOOR NOT FOUND' };
    const tile = ds.def.tiles[0];
    const res = this.deployHardware('ARC_WELDER', tile.col, tile.row, 0);
    return {
      ok: res.ok,
      msg:
        res.reason ??
        (this.phase === 'WAVE_ACTIVE' ? `${ds.def.id} REINFORCING (2.0S)...` : `${ds.def.id} REINFORCED`),
    };
  }

  public rearmTurret(turretId: string): { ok: boolean; msg: string } {
    const t = this.turrets.find((u) => u.id === turretId);
    if (!t || t.kind !== 'SENTRY_PULSE') return { ok: false, msg: 'NO DRUM MAGAZINE' };
    if (t.rearmTimer > 0) {
      return { ok: false, msg: `${t.callsign} RELOADING (${t.rearmTimer.toFixed(1)}S)` };
    }
    if (t.ammo >= t.maxAmmo) return { ok: false, msg: 'DRUM ALREADY FULL' };
    const missingRatio = (t.maxAmmo - t.ammo) / t.maxAmmo;
    const cost = Math.max(12, Math.round(PERIMETER_CONSTANTS.REARM_COST_SCRAP * missingRatio));
    if (this.scrap < cost) {
      return { ok: false, msg: `INSUFFICIENT SCRAP (${cost} REQ)` };
    }
    this.scrap -= cost;

    if (this.phase === 'TACTICAL_PREP') {
      // Instant top-off during pre-wave tactical prep
      t.ammo = t.maxAmmo;
      t.rearmTimer = 0;
      this.warnedLowAmmoIds.delete(t.id);
      this.warnedDryIds.delete(t.id);
      this.audioCb.onRearmSentry(this.panFromVirtualX(t.pos.x));
      this.pushLog(`REARMED ${t.callsign} [${t.maxAmmo} RDS] // -${cost} SCRAP`);
      return { ok: true, msg: `${t.callsign} REARMED` };
    }

    // Mid-wave: realistic 2.8s automated belt-feed reload cycle (turret offline during reload!)
    // Play the full 2.8s ElevenLabs machine-gun reload foley right as the reload sequence starts!
    t.rearmTimer = PERIMETER_CONSTANTS.REARM_DURATION_SEC;
    t.rearmDuration = PERIMETER_CONSTANTS.REARM_DURATION_SEC;
    this.audioCb.onRearmSentry(this.panFromVirtualX(t.pos.x));
    this.pushLog(
      `RELOADING ${t.callsign} [${PERIMETER_CONSTANTS.REARM_DURATION_SEC.toFixed(1)}S BELT FEED] // -${cost} SCRAP`
    );
    return {
      ok: true,
      msg: `${t.callsign} RELOADING (${PERIMETER_CONSTANTS.REARM_DURATION_SEC.toFixed(1)}S)`,
    };
  }

  public setTurretTargetAngle(turretId: string, newAngle: number): void {
    const t = this.turrets.find((u) => u.id === turretId);
    if (!t) return;
    t.targetAngle = newAngle;
    if (t.kind === 'MOTION_RELAY') {
      this.computeTripwireBeam(t, newAngle);
    } else if (this.phase === 'TACTICAL_PREP') {
      t.angle = newAngle;
    }
    this.audioCb.onServoStep(this.panFromVirtualX(t.pos.x));
  }

  public toggleTurretPower(turretId: string): { ok: boolean; msg: string } {
    const t = this.turrets.find((u) => u.id === turretId);
    if (!t) return { ok: false, msg: 'UNIT NOT FOUND' };
    if (!t.powered) {
      const reqKw = HARDWARE_SPECS[t.kind].powerKw;
      if (this.getStaticAllocatedKw() + reqKw > this.maxReactorKw) {
        return { ok: false, msg: `REACTOR OVERLOAD (${reqKw} kW NEEDED)` };
      }
      t.powered = true;
      this.recomputeRelayLinks();
      this.pushLog(`${t.callsign} POWER ONLINE [+${reqKw} kW]`);
      return { ok: true, msg: `${t.callsign} ONLINE` };
    } else {
      t.powered = false;
      const freed = HARDWARE_SPECS[t.kind].powerKw;
      this.recomputeRelayLinks();
      this.pushLog(`${t.callsign} STANDBY OFFLINE [-${freed} kW FREED]`);
      return { ok: true, msg: `${t.callsign} OFFLINE` };
    }
  }

  public upgradeTurret(turretId: string): { ok: boolean; msg: string } {
    const t = this.turrets.find((u) => u.id === turretId);
    if (!t) return { ok: false, msg: 'UNIT NOT FOUND' };
    if (t.level >= 2) return { ok: false, msg: 'MAX MK-II UPGRADE INSTALLED' };
    const cost = HARDWARE_SPECS[t.kind].upgradeCostScrap;
    if (this.scrap < cost) return { ok: false, msg: `INSUFFICIENT SCRAP (${cost} REQ)` };
    this.scrap -= cost;
    t.level = 2;
    if (t.kind === 'SENTRY_PULSE') {
      t.maxAmmo = 440;
      t.ammo = 440;
      t.rearmTimer = 0;
      this.warnedLowAmmoIds.delete(t.id);
      this.warnedDryIds.delete(t.id);
    }
    this.spawnSparks(t.pos, 10, '#44FF77');
    this.pushLog(`UPGRADED ${t.callsign} TO MK-II SPEC // -${cost} SCRAP`);
    return { ok: true, msg: `${t.callsign} UPGRADED MK-II` };
  }

  public scrapTurret(turretId: string): { ok: boolean; msg: string } {
    const idx = this.turrets.findIndex((u) => u.id === turretId);
    if (idx < 0) return { ok: false, msg: 'UNIT NOT FOUND' };
    const t = this.turrets[idx];
    const spec = HARDWARE_SPECS[t.kind];
    const invested = spec.costScrap + (t.level === 2 ? spec.upgradeCostScrap : 0);
    const refund = Math.round(invested * 0.65);
    this.scrap += refund;
    this.turrets.splice(idx, 1);
    this.recomputeRelayLinks();
    this.pushLog(`RECYCLED ${t.callsign} // +${refund} SCRAP RECOVERED`);
    return { ok: true, msg: `+${refund} SCRAP` };
  }

  public triggerCommandAbility(
    abilityId: CommandAbilityId,
    targetPos: Vec2
  ): { ok: boolean; msg: string } {
    if (this.blackoutTimer > 0 && abilityId === 'OVERCLOCK') {
      return {
        ok: false,
        msg: `REACTOR BLACKOUT — BREAKER RESETTING (${this.blackoutTimer.toFixed(1)}S)`,
      };
    }

    if (abilityId === 'FLARE') {
      if (this.flareCooldown > 0) {
        return { ok: false, msg: `M40 FLARE RECHARGING (${this.flareCooldown.toFixed(1)}S)` };
      }
      const c = Math.floor(targetPos.x / this.blueprint.tileSize);
      const r = Math.floor(targetPos.y / this.blueprint.tileSize);
      if (
        c < 0 ||
        c >= this.blueprint.cols ||
        r < 0 ||
        r >= this.blueprint.rows ||
        !FlowFieldPathfinder.isWalkableKind(this.blueprint.tiles[r][c])
      ) {
        return { ok: false, msg: 'TARGET AN OPEN CORRIDOR FOR M40 FLARE' };
      }
      this.flareCooldown = PERIMETER_CONSTANTS.FLARE_COOLDOWN_SEC;
      this.activeFlareSurgeTimer = 0;
      this.flares.push({
        pos: { ...targetPos },
        radius: PERIMETER_CONSTANTS.FLARE_RADIUS_PX,
        remainingSec: PERIMETER_CONSTANTS.FLARE_DURATION_SEC,
        maxSec: PERIMETER_CONSTANTS.FLARE_DURATION_SEC,
      });
      this.audioCb.onFlarePop(this.panFromVirtualX(targetPos.x));
      this.spawnSparks(targetPos, 14, '#FFFFFF');
      this.pushLog('M40 STROBE FLARE DEPLOYED // 12S FULL RANGE & +20% CRIT (0 kW)');
      return { ok: true, msg: 'STROBE FLARE DEPLOYED (+100% RANGE)' };
    }

    if (abilityId === 'OVERCLOCK') {
      if (this.overclockCooldown > 0) {
        return { ok: false, msg: `BUS CAPACITOR COOLING (${this.overclockCooldown.toFixed(1)}S)` };
      }
      const affected = this.turrets.filter(
        (t) =>
          t.powered &&
          Math.hypot(t.pos.x - targetPos.x, t.pos.y - targetPos.y) <=
            PERIMETER_CONSTANTS.OVERCLOCK_RADIUS_PX
      );
      if (affected.length === 0) {
        return { ok: false, msg: 'NO ACTIVE TURRETS IN TARGET SECTOR' };
      }
      this.overclockCooldown = PERIMETER_CONSTANTS.OVERCLOCK_COOLDOWN_SEC;
      this.activeOverclockSurgeTimer = PERIMETER_CONSTANTS.OVERCLOCK_DURATION_SEC;
      for (const t of affected) {
        t.overclockTimer = PERIMETER_CONSTANTS.OVERCLOCK_DURATION_SEC;
      }
      this.overclocks.push({
        pos: { ...targetPos },
        radius: PERIMETER_CONSTANTS.OVERCLOCK_RADIUS_PX,
        remainingSec: PERIMETER_CONSTANTS.OVERCLOCK_DURATION_SEC,
      });
      this.audioCb.onOverclockSurge(this.panFromVirtualX(targetPos.x));
      const overloadNote =
        this.getTotalLoadKw() > this.maxReactorKw
          ? ' — ⚠ REACTOR OVERLOAD! DROP IDLE TURRET [P]!'
          : ' — WATCH HEAT!';
      this.pushLog(`OVERCLOCK ENGAGED [${affected.length} UNITS] // 2X ROF${overloadNote}`);
      return { ok: true, msg: `OVERCLOCKED ${affected.length} UNIT(S)` };
    }

    if (abilityId === 'PURGE') {
      if (!this.purgeAvailableThisWave) {
        return { ok: false, msg: 'AIRLOCK VENT PURGE EXPENDED THIS WAVE (1X/WAVE)' };
      }
      const chamber = this.findAirlockAt(targetPos);
      if (!chamber) {
        return { ok: false, msg: 'CLICK DESIGNATED AIRLOCK CHAMBER [W-01 / E-02 / S-03]' };
      }
      this.purgeAvailableThisWave = false;
      this.purgeWaves.push({
        chamberId: chamber.id,
        bounds: { ...chamber.bounds },
        flushDir: { ...chamber.flushDir },
        remainingSec: 1.15,
      });
      this.applyAirlockPurgeBlast(chamber);
      this.audioCb.onAirlockPurge(this.panFromVirtualX(chamber.center.x));
      this.audioCb.onSyncGlitch(0.45);
      this.pushLog(`EMERGENCY DECOMPRESSION PURGE IN ${chamber.label} // CORRIDOR FLUSHED!`);
      return { ok: true, msg: `${chamber.label} PURGED` };
    }

    return { ok: false, msg: 'UNKNOWN COMMAND' };
  }

  private applyAirlockPurgeBlast(chamber: AirlockChamberDef): void {
    const padPx = 95;
    const minX = chamber.bounds.x - padPx;
    const maxX = chamber.bounds.x + chamber.bounds.width + padPx;
    const minY = chamber.bounds.y - padPx;
    const maxY = chamber.bounds.y + chamber.bounds.height + padPx;

    // Clear corrosive acid pools in/around the purged airlock corridor
    this.acidPools = this.acidPools.filter(
      (p) => p.pos.x < minX || p.pos.x > maxX || p.pos.y < minY || p.pos.y > maxY
    );

    let flushedCount = 0;
    let purgeKills = 0;
    for (const h of this.hostiles) {
      if (h.pos.x >= minX && h.pos.x <= maxX && h.pos.y >= minY && h.pos.y <= maxY) {
        flushedCount++;
        const pushScale = h.kind === 'PRAETORIAN' ? 0.28 : 1.0;
        const pushDist = PERIMETER_CONSTANTS.PURGE_PUSH_PX * pushScale;
        this.pushHostileAlongCorridor(h, chamber.flushDir, pushDist);
        h.stunTimer = Math.max(h.stunTimer, h.kind === 'PRAETORIAN' ? 0.65 : 1.75);
        h.hp -= h.kind === 'SKITTERER' ? 32 : 28;
        if (h.hp <= 0) {
          purgeKills++;
          this.score += HOSTILE_SPECS[h.kind].scoreValue; // +100% decompression kill bonus!
        }
      }
    }

    this.spawnSparks(chamber.center, 22, '#8EF5AB');
    if (flushedCount > 0) {
      this.callouts.push({
        pos: { ...chamber.center },
        text: purgeKills > 0 ? `DECOMPRESSION KILL ×${purgeKills}` : `PURGE FLUSH ×${flushedCount}`,
        color: purgeKills > 0 ? '#FFB000' : '#8EF5AB',
        life: 1.6,
        maxLife: 1.6,
      });
    }
  }

  private pushHostileAlongCorridor(h: HostileEntity, dir: Vec2, totalPx: number): void {
    const steps = 12;
    const stepD = totalPx / steps;
    const ts = this.blueprint.tileSize;
    for (let i = 0; i < steps; i++) {
      const nx = h.pos.x + dir.x * stepD;
      const ny = h.pos.y + dir.y * stepD;
      const nc = Math.floor(nx / ts);
      const nr = Math.floor(ny / ts);
      if (this.pathfinder.isPassableCell(this.blueprint, this.doors, nc, nr)) {
        h.pos.x = nx;
        h.pos.y = ny;
      } else {
        break;
      }
    }
  }

  // ===========================================================================
  // WAVE FLOW & FIXED-STEP SIMULATION
  // ===========================================================================

  public launchNextWave(): void {
    if (this.phase !== 'TACTICAL_PREP') return;
    this.currentWaveDef = Sector01Blueprint.getWaveDefinition(this.waveNumber);
    this.spawnQueue = this.currentWaveDef.groups.map((g) => ({
      ventId: g.ventId,
      kind: g.kind,
      remaining: g.count,
      totalCount: g.count,
      intervalSec: g.intervalSec,
      timerSec: g.delaySec,
      telegraphSent: false,
    }));
    this.grateTelegraphs = [];
    this.purgeAvailableThisWave = true;
    this.phase = 'WAVE_ACTIVE';
    this.tacticalPaused = false;

    const activeVents = Array.from(new Set(this.currentWaveDef.groups.map((g) => g.ventId))).join(
      ', '
    );
    this.pushLog(
      `WAVE ${String(this.waveNumber).padStart(2, '0')} INBOUND // ${this.currentWaveDef.title} [${activeVents}]`
    );
  }

  public step(rawDt: number): void {
    if (this.sealLostFlashTimer > 0) {
      this.sealLostFlashTimer = Math.max(0, this.sealLostFlashTimer - rawDt);
    }

    if (
      this.phase === 'BRIEFING' ||
      this.phase === 'SECTOR_VICTORY' ||
      this.phase === 'CORE_BREACHED' ||
      this.phase === 'CALLSIGN_ENTRY'
    ) {
      return;
    }

    if (this.tacticalPaused) {
      return;
    }

    const simDt = Math.min(0.08, rawDt) * (this.fastForward2x ? 2.0 : 1.0);

    // 1. Update Ability Cooldowns, Surges & Real Reactor Overload / Blackout State!
    if (this.flareCooldown > 0) this.flareCooldown = Math.max(0, this.flareCooldown - simDt);
    if (this.overclockCooldown > 0)
      this.overclockCooldown = Math.max(0, this.overclockCooldown - simDt);
    if (this.activeFlareSurgeTimer > 0)
      this.activeFlareSurgeTimer = Math.max(0, this.activeFlareSurgeTimer - simDt);
    if (this.activeOverclockSurgeTimer > 0)
      this.activeOverclockSurgeTimer = Math.max(0, this.activeOverclockSurgeTimer - simDt);
    if (this.overloadWarnCooldown > 0)
      this.overloadWarnCooldown = Math.max(0, this.overloadWarnCooldown - simDt);
    if (this.grateRattleCooldown > 0)
      this.grateRattleCooldown = Math.max(0, this.grateRattleCooldown - simDt);

    if (this.blackoutTimer > 0) {
      this.blackoutTimer = Math.max(0, this.blackoutTimer - simDt);
      this.overloadTimer = 0;
      if (this.blackoutTimer <= 0) {
        this.audioCb.onServoStep(0);
        this.pushLog('REACTOR MAIN BREAKER RESET // PERIMETER POWER RESTORED!');
      }
    } else {
      const currentLoad = this.getTotalLoadKw();
      if (currentLoad > this.maxReactorKw) {
        this.overloadTimer += simDt;
        if (this.overloadWarnCooldown <= 0) {
          this.overloadWarnCooldown = 1.25;
          this.audioCb.onLowAmmoAlert(0, this.overloadTimer > 2.4);
          if (this.overloadTimer > 2.2) {
            this.pushLog('⚠ CRITICAL REACTOR OVERLOAD — SHED LOAD [P] BEFORE BREAKER TRIPS!');
          }
        }
        if (this.overloadTimer >= PERIMETER_CONSTANTS.REACTOR_OVERLOAD_TRIP_SEC) {
          // MAIN BREAKER TRIP -> 3.5S SECTOR BLACKOUT!
          this.blackoutTimer = PERIMETER_CONSTANTS.REACTOR_BLACKOUT_SEC;
          this.overloadTimer = 0;
          this.activeFlareSurgeTimer = 0;
          this.activeOverclockSurgeTimer = 0;
          for (const t of this.turrets) {
            t.overclockTimer = 0;
          }
          this.audioCb.onBulkheadBreach();
          this.audioCb.onSyncGlitch(0.88);
          this.spawnSparks(this.blueprint.coreCenter, 22, '#FFB000');
          this.callouts.push({
            pos: { x: this.blueprint.coreCenter.x, y: this.blueprint.coreCenter.y - 38 },
            text: '⚡ BREAKER TRIP — 3.5S BLACKOUT!',
            color: '#FF3318',
            life: 2.2,
            maxLife: 2.2,
          });
          this.pushLog('CRITICAL // MAIN REACTOR BREAKER TRIPPED! 3.5S SECTOR BLACKOUT!');
        }
      } else if (this.overloadTimer > 0) {
        this.overloadTimer = Math.max(0, this.overloadTimer - simDt * 2.0);
      }
    }

    for (let i = this.flares.length - 1; i >= 0; i--) {
      this.flares[i].remainingSec -= simDt;
      if (this.flares[i].remainingSec <= 0) this.flares.splice(i, 1);
    }
    for (let i = this.overclocks.length - 1; i >= 0; i--) {
      this.overclocks[i].remainingSec -= simDt;
      if (this.overclocks[i].remainingSec <= 0) this.overclocks.splice(i, 1);
    }
    for (let i = this.purgeWaves.length - 1; i >= 0; i--) {
      this.purgeWaves[i].remainingSec -= simDt;
      if (this.purgeWaves[i].remainingSec <= 0) this.purgeWaves.splice(i, 1);
    }

    // 1B. Tick Mid-Wave 2.0s Arc-Weld Torch Sequences & Repair Cooldowns
    for (const ds of this.doors.values()) {
      if (ds.repairCooldown > 0) {
        ds.repairCooldown = Math.max(0, ds.repairCooldown - simDt);
      }
      if (ds.weldingTimer > 0) {
        ds.weldingTimer = Math.max(0, ds.weldingTimer - simDt);
        if (Math.random() < simDt * 12) {
          this.spawnSparks(ds.def.center, 2, '#FFB000');
        }
        if (ds.weldingTimer <= 0) {
          const wasWelded = ds.welded;
          ds.welded = true;
          ds.hp = ds.maxHp;
          ds.repairCooldown = PERIMETER_CONSTANTS.WELD_REPAIR_COOLDOWN_SEC;
          this.pathfinder.recompute(this.blueprint, this.doors);
          this.recomputeRelayLinks();
          this.audioCb.onArcWeld(this.panFromVirtualX(ds.def.center.x));
          this.spawnSparks(ds.def.center, 16, '#FFB000');
          this.callouts.push({
            pos: { ...ds.def.center },
            text: wasWelded ? `${ds.def.id} REINFORCED` : `${ds.def.id} SEALED`,
            color: '#FFB000',
            life: 1.3,
            maxLife: 1.3,
          });
          this.pushLog(
            wasWelded
              ? `BULKHEAD ${ds.def.id} REINFORCED [100% HP]`
              : `BULKHEAD ${ds.def.id} SEAL LOCKED (${this.getActiveSealedDoorCount()}/${PERIMETER_CONSTANTS.MAX_ACTIVE_DOOR_SEALS}) // PATH REROUTED`
          );
        }
      }
    }

    // 2. Floor-Grate 5s Rattling Breach Telegraphs & Wave Hostile Spawns
    if (this.phase === 'WAVE_ACTIVE') {
      for (const sq of this.spawnQueue) {
        if (sq.remaining <= 0) continue;
        sq.timerSec -= simDt;

        // Emit 5-second rattling floor-grate breach telegraph before auxiliary grates erupt!
        if (!sq.telegraphSent && sq.timerSec <= PERIMETER_CONSTANTS.GRATE_TELEGRAPH_SEC) {
          const vent = this.blueprint.vents.find((v) => v.id === sq.ventId);
          if (vent?.isAuxGrate) {
            sq.telegraphSent = true;
            const rem = Math.max(0.5, sq.timerSec);
            this.grateTelegraphs.push({
              ventId: vent.id,
              label: vent.label,
              pos: { ...vent.pos },
              remainingSec: rem,
              maxSec: rem,
              count: sq.totalCount,
            });
            this.audioCb.onDoorBatter(this.panFromVirtualX(vent.pos.x));
            this.spawnSparks(vent.pos, 10, '#FFB000');
            this.callouts.push({
              pos: { x: vent.pos.x, y: vent.pos.y - 26 },
              text: `⚠ ${vent.id} BREACH ${Math.ceil(rem)}S!`,
              color: '#FFB000',
              life: 1.8,
              maxLife: 1.8,
            });
            this.pushLog(
              `⚠ SUB-FLOOR GRATE RATTLING [${vent.id}] — ${sq.totalCount} SKITTERERS IN ${Math.ceil(rem)}S!`
            );
          } else {
            sq.telegraphSent = true;
          }
        }

        if (sq.timerSec <= 0) {
          sq.timerSec += sq.intervalSec;
          sq.remaining -= 1;
          this.spawnHostile(sq.ventId, sq.kind);
        }
      }

      // Tick down active floor-grate breach telegraphs with periodic metallic rattle + sparks
      for (let i = this.grateTelegraphs.length - 1; i >= 0; i--) {
        const gt = this.grateTelegraphs[i];
        gt.remainingSec -= simDt;
        if (Math.random() < simDt * 5) {
          this.spawnSparks(gt.pos, 2, '#FFB000');
        }
        if (this.grateRattleCooldown <= 0 && gt.remainingSec > 0.3) {
          this.grateRattleCooldown = 1.25;
          this.audioCb.onDoorBatter(this.panFromVirtualX(gt.pos.x));
        }
        if (gt.remainingSec <= 0) {
          this.grateTelegraphs.splice(i, 1);
        }
      }
    }

    // 3. Baseline Core Motion Sweep (pauses during Blackout!) + M314 Relay Sweeps & Cryo Valves
    if (this.blackoutTimer <= 0) {
      this.coreSweepTimer -= simDt;
      if (this.coreSweepTimer <= 0) {
        this.coreSweepTimer = PERIMETER_CONSTANTS.CORE_BASELINE_SWEEP_INTERVAL;
        this.motionWaves.push({
          origin: { ...this.blueprint.coreCenter },
          radius: 18,
          maxRadius: PERIMETER_CONSTANTS.CORE_BASELINE_SWEEP_RADIUS,
          speed: 440,
          fromM314: false,
          pingedHostileIds: new Set<number>(),
        });
      }
    }

    this.stepMotionWaves(simDt);
    this.stepHazardsAndClouds(simDt);
    this.stepTurrets(simDt);
    this.stepHostiles(simDt);
    this.stepVisualParticles(simDt);
    this.stepXenomorphChaosAudio(simDt);
    this.stepMotionTrackerAudio(rawDt);

    // 4. Check Wave Completion
    if (this.phase === 'WAVE_ACTIVE') {
      const anyPending = this.spawnQueue.some((s) => s.remaining > 0);
      if (!anyPending && this.hostiles.length === 0) {
        this.completeCurrentWave();
      }
    }
  }

  private spawnHostile(ventId: string, kind: HostileKind): void {
    const vent = this.blueprint.vents.find((v) => v.id === ventId) ?? this.blueprint.vents[0];
    const spec = HOSTILE_SPECS[kind];
    // Progressive HP scaling on later waves
    const hpScale = 1 + Math.max(0, this.waveNumber - 1) * 0.11;
    const maxHp = Math.round(spec.baseHp * hpScale);
    const jitterX = (Math.random() - 0.5) * 18;
    const jitterY = (Math.random() - 0.5) * 18;

    const entity: HostileEntity = {
      id: this.nextHostileId++,
      kind,
      pos: { x: vent.pos.x + jitterX, y: vent.pos.y + jitterY },
      vel: { x: 0, y: 0 },
      heading: 0,
      hp: maxHp,
      maxHp,
      speedPxS: spec.speedPxS * (0.95 + Math.random() * 0.1),
      radiusPx: spec.radiusPx,
      weavePhase: Math.random() * Math.PI * 2,
      blipTimer: 1.2, // Brief initial vent motion spike blip
      blipPos: { x: vent.pos.x, y: vent.pos.y },
      blipDistM:
        Math.hypot(
          vent.pos.x - this.blueprint.coreCenter.x,
          vent.pos.y - this.blueprint.coreCenter.y
        ) / PERIMETER_CONSTANTS.PX_PER_METER,
      m314SweepTimer: 0,
      tripwireTagTimer: 0,
      cryoSlowTimer: 0,
      napalmBurnTimer: 0,
      stunTimer: 0,
      illuminated: false,
      verified: false,
      batteringDoorId: null,
    };

    this.hostiles.push(entity);
  }

  private stepMotionWaves(dt: number): void {
    for (let i = this.motionWaves.length - 1; i >= 0; i--) {
      const w = this.motionWaves[i];
      const prevR = w.radius;
      w.radius += w.speed * dt;

      for (const h of this.hostiles) {
        if (w.pingedHostileIds.has(h.id)) continue;
        const d = Math.hypot(h.pos.x - w.origin.x, h.pos.y - w.origin.y);
        if (d >= prevR - 18 && d <= w.radius + 14) {
          w.pingedHostileIds.add(h.id);
          h.blipTimer = 1.95;
          h.blipPos = {
            x: h.pos.x + (Math.random() - 0.5) * 6,
            y: h.pos.y + (Math.random() - 0.5) * 6,
          };
          h.blipDistM =
            Math.hypot(
              h.pos.x - this.blueprint.coreCenter.x,
              h.pos.y - this.blueprint.coreCenter.y
            ) / PERIMETER_CONSTANTS.PX_PER_METER;
          if (w.fromM314) {
            h.m314SweepTimer = 1.55;
          }
        }
      }

      if (w.radius >= w.maxRadius) {
        this.motionWaves.splice(i, 1);
      }
    }
  }

  private stepHazardsAndClouds(dt: number): void {
    // Napalm Clouds: burn hostiles (bypassing armor!) AND burn away Acid Pools!
    for (let i = this.napalmClouds.length - 1; i >= 0; i--) {
      const c = this.napalmClouds[i];
      c.remainingSec -= dt;
      if (c.remainingSec <= 0) {
        this.napalmClouds.splice(i, 1);
        continue;
      }

      for (const h of this.hostiles) {
        if (Math.hypot(h.pos.x - c.pos.x, h.pos.y - c.pos.y) <= c.radius + h.radiusPx) {
          h.hp -= c.dps * dt;
          h.napalmBurnTimer = 0.65;
          if (this.burnScreechCooldown <= 0 && h.hp > 0) {
            this.burnScreechCooldown = 0.52 + Math.random() * 0.85;
            this.audioCb.onAlienScreech(
              'BURNING',
              h.kind,
              this.panFromVirtualX(h.pos.x),
              this.distNormFromCore(h.pos)
            );
          }
        }
      }

      // Burn away overlapping corrosive acid pools -> STERILIZED COMBO (+15 SCRAP)!
      for (let a = this.acidPools.length - 1; a >= 0; a--) {
        const pool = this.acidPools[a];
        if (Math.hypot(pool.pos.x - c.pos.x, pool.pos.y - c.pos.y) <= c.radius + pool.radius * 0.7) {
          pool.remainingSec -= dt * 4.2;
          if (pool.remainingSec <= 0) {
            this.scrap += 15;
            this.score += 75;
            this.spawnSparks(pool.pos, 10, '#FFB000');
            this.callouts.push({
              pos: { x: pool.pos.x, y: pool.pos.y - 10 },
              text: 'STERILIZED +15S',
              color: '#FFB000',
              life: 1.35,
              maxLife: 1.35,
            });
            this.pushLog('COMBO // NAPALM STERILIZED ACID POOL (+15 SCRAP)');
            this.acidPools.splice(a, 1);
          }
        }
      }
    }

    // Cryo Plumes: chill hostiles, expose Stalkers, and cool nearby turret barrels!
    for (let i = this.cryoPlumes.length - 1; i >= 0; i--) {
      const p = this.cryoPlumes[i];
      p.remainingSec -= dt;
      if (p.remainingSec <= 0) {
        this.cryoPlumes.splice(i, 1);
        continue;
      }

      for (const h of this.hostiles) {
        if (Math.hypot(h.pos.x - p.pos.x, h.pos.y - p.pos.y) <= p.radius + h.radiusPx) {
          h.cryoSlowTimer = Math.max(h.cryoSlowTimer, 1.35);
        }
      }

      for (const t of this.turrets) {
        if (Math.hypot(t.pos.x - p.pos.x, t.pos.y - p.pos.y) <= p.radius + 45) {
          t.heat = Math.max(0, t.heat - 24 * dt);
          if (t.thermalLocked && t.heat <= 32) {
            t.thermalLocked = false;
          }
        }
      }
    }

    // Corrosive Acid Pools: eat welded Blast Doors and damage M314 Laser Tripwires!
    for (let i = this.acidPools.length - 1; i >= 0; i--) {
      const pool = this.acidPools[i];
      pool.remainingSec -= dt;
      if (pool.remainingSec <= 0) {
        this.acidPools.splice(i, 1);
        continue;
      }

      for (const ds of this.doors.values()) {
        if (!ds.welded || ds.hp <= 0) continue;
        const d = Math.hypot(ds.def.center.x - pool.pos.x, ds.def.center.y - pool.pos.y);
        if (d <= pool.radius + 42) {
          ds.hp -= 38 * dt;
          ds.acidCorrodingTimer = 0.35;
          const prevWarn = this.warnedAcidDoorIds.get(ds.def.id) ?? 0;
          if (prevWarn <= 0) {
            this.warnedAcidDoorIds.set(ds.def.id, 5.0);
            this.pushLog(`ACID CORROSION ON BULKHEAD DOOR ${ds.def.id}!`);
          }
          if (ds.hp <= 0) {
            this.breachWeldedDoor(ds, 'CORRODED BY MOLECULAR ACID');
          }
        }
      }

      for (const t of this.turrets) {
        if (t.kind === 'MOTION_RELAY' && t.tripwireStart && t.tripwireEnd) {
          const midX = (t.tripwireStart.x + t.tripwireEnd.x) * 0.5;
          const midY = (t.tripwireStart.y + t.tripwireEnd.y) * 0.5;
          if (Math.hypot(midX - pool.pos.x, midY - pool.pos.y) <= pool.radius + 36) {
            t.tripwireIntegrity = Math.max(0, t.tripwireIntegrity - 30 * dt);
          }
        }
      }
    }

    for (const [k, v] of this.warnedAcidDoorIds.entries()) {
      if (v > 0) this.warnedAcidDoorIds.set(k, Math.max(0, v - dt));
    }
    for (const ds of this.doors.values()) {
      if (ds.underAttackTimer > 0) ds.underAttackTimer = Math.max(0, ds.underAttackTimer - dt);
      if (ds.acidCorrodingTimer > 0)
        ds.acidCorrodingTimer = Math.max(0, ds.acidCorrodingTimer - dt);
    }
  }

  private breachWeldedDoor(ds: BlastDoorState, cause: string): void {
    ds.welded = false;
    ds.hp = 0;
    this.pathfinder.recompute(this.blueprint, this.doors);
    this.audioCb.onSyncGlitch(0.55);
    this.audioCb.onDoorBatter(this.panFromVirtualX(ds.def.center.x));
    this.spawnSparks(ds.def.center, 20, '#FF3318');
    this.callouts.push({
      pos: { ...ds.def.center },
      text: `${ds.def.id} BREACHED!`,
      color: '#FF3318',
      life: 1.8,
      maxLife: 1.8,
    });
    this.pushLog(`ALERT // BULKHEAD ${ds.def.id} BREACHED (${cause})!`);
  }

  /**
   * Returns true if a grid cell blocks turret line-of-sight (solid bulkheads,
   * outer air shafts, or currently welded blast doors).
   */
  public isCellOpaque(col: number, row: number): boolean {
    if (col < 0 || col >= this.blueprint.cols || row < 0 || row >= this.blueprint.rows) {
      return true;
    }
    const kind = this.blueprint.tiles[row][col];
    if (!FlowFieldPathfinder.isWalkableKind(kind)) {
      return true;
    }
    const weldedDoor = this.pathfinder.getWeldedDoorAtCell(this.doors, col, row);
    return weldedDoor !== null;
  }

  /**
   * High-precision line-of-sight check between two points in blueprint space.
   * Prevents turrets from sensing or firing through solid bulkheads or sealed blast doors.
   */
  public hasLineOfSight(from: Vec2, to: Vec2): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 12) return true;
    const ts = this.blueprint.tileSize;
    const stepPx = 6;
    const steps = Math.ceil(dist / stepPx);
    const invSteps = 1 / steps;
    const startCol = Math.floor(from.x / ts);
    const startRow = Math.floor(from.y / ts);

    for (let i = 1; i < steps; i++) {
      const f = i * invSteps;
      const px = from.x + dx * f;
      const py = from.y + dy * f;
      const c = Math.floor(px / ts);
      const r = Math.floor(py / ts);
      if (c === startCol && r === startRow) continue;
      if (this.isCellOpaque(c, r)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Casts a sightline ray from `origin` along `angle` up to `maxDist`,
   * terminating precisely where it intersects a bulkhead wall or welded blast door.
   */
  public castSightRay(origin: Vec2, angle: number, maxDist: number): Vec2 {
    const ts = this.blueprint.tileSize;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const startCol = Math.floor(origin.x / ts);
    const startRow = Math.floor(origin.y / ts);
    let lastX = origin.x;
    let lastY = origin.y;
    const stepPx = 6;
    for (let d = stepPx; d <= maxDist; d += stepPx) {
      const px = origin.x + ux * d;
      const py = origin.y + uy * d;
      const c = Math.floor(px / ts);
      const r = Math.floor(py / ts);
      if (!(c === startCol && r === startRow) && this.isCellOpaque(c, r)) {
        // Binary refine edge to crisp wall face
        let lo = d - stepPx;
        let hi = d;
        for (let k = 0; k < 4; k++) {
          const mid = (lo + hi) * 0.5;
          const mc = Math.floor((origin.x + ux * mid) / ts);
          const mr = Math.floor((origin.y + uy * mid) / ts);
          if (!(mc === startCol && mr === startRow) && this.isCellOpaque(mc, mr)) {
            hi = mid;
          } else {
            lo = mid;
          }
        }
        return { x: origin.x + ux * lo, y: origin.y + uy * lo };
      }
      lastX = px;
      lastY = py;
    }
    return { x: lastX, y: lastY };
  }

  /**
   * Computes Darkness Illumination vs. Short Unlit IR Detection for every hostile BEFORE turrets fire!
   * - Illuminated targets (Flare, M314 Relay sweep, Tripwire, Cryo, Napalm, Core Light): 100% range +20% crit!
   * - Unlit dark targets: only detectable at 55% range inside turret IR cone (with 20% dark scatter miss chance).
   * - STALKERs: completely invisible in darkness — MUST be illuminated!
   */
  private updateHostileVerification(dt: number): void {
    const inBlackout = this.blackoutTimer > 0;

    // 1. Check Laser Tripwire crossings on powered M314 Relays (paused during Blackout)
    for (const t of this.turrets) {
      if (t.kind !== 'MOTION_RELAY') continue;
      if (t.tripwireIntegrity < 100) {
        t.tripwireIntegrity = Math.min(100, t.tripwireIntegrity + 12 * dt);
      }
      if (inBlackout || !t.powered || t.tripwireIntegrity < 20 || !t.tripwireStart || !t.tripwireEnd) {
        continue;
      }

      for (const h of this.hostiles) {
        const distSeg = this.pointToSegmentDist(h.pos, t.tripwireStart, t.tripwireEnd);
        if (distSeg <= h.radiusPx + 8) {
          h.tripwireTagTimer = 5.0;
          h.blipTimer = Math.max(h.blipTimer, 2.5);
          h.blipPos = { ...h.pos };
        }
      }
    }

    // 2. Evaluate illumination & verification per hostile
    for (const h of this.hostiles) {
      if (h.blipTimer > 0) {
        h.blipTimer = Math.max(0, h.blipTimer - dt);
        h.blipDistM =
          Math.hypot(
            h.pos.x - this.blueprint.coreCenter.x,
            h.pos.y - this.blueprint.coreCenter.y
          ) / PERIMETER_CONSTANTS.PX_PER_METER;
      }
      if (h.m314SweepTimer > 0) h.m314SweepTimer = Math.max(0, h.m314SweepTimer - dt);
      if (h.tripwireTagTimer > 0) h.tripwireTagTimer = Math.max(0, h.tripwireTagTimer - dt);
      if (h.cryoSlowTimer > 0) h.cryoSlowTimer = Math.max(0, h.cryoSlowTimer - dt);
      if (h.napalmBurnTimer > 0) h.napalmBurnTimer = Math.max(0, h.napalmBurnTimer - dt);
      if (h.stunTimer > 0) h.stunTimer = Math.max(0, h.stunTimer - dt);

      const inFlare = this.flares.some(
        (f) => Math.hypot(h.pos.x - f.pos.x, h.pos.y - f.pos.y) <= f.radius + h.radiusPx
      );
      const inCoreLight =
        !inBlackout &&
        Math.hypot(
          h.pos.x - this.blueprint.coreCenter.x,
          h.pos.y - this.blueprint.coreCenter.y
        ) <= PERIMETER_CONSTANTS.CORE_LIT_RADIUS;
      const hasSensorReveal =
        inFlare || h.tripwireTagTimer > 0 || h.cryoSlowTimer > 0 || h.m314SweepTimer > 0;
      const illuminated = hasSensorReveal || inCoreLight || h.napalmBurnTimer > 0;
      h.illuminated = illuminated;

      if (h.kind === 'STALKER') {
        // Optical/IR stealth: completely invisible to unlit turret IR cones unless illuminated!
        h.verified = illuminated;
      } else if (illuminated) {
        h.verified = true;
      } else if (inBlackout) {
        h.verified = false;
      } else {
        // Unlit dark corridor: short-range 55% passive IR pickup inside a powered turret's cone only!
        let inShortDarkCone = false;
        for (const t of this.turrets) {
          if (!t.powered || t.rearmTimer > 0 || (t.kind !== 'SENTRY_PULSE' && t.kind !== 'INCINERATOR')) {
            continue;
          }
          const spec = HARDWARE_SPECS[t.kind];
          const darkRange =
            spec.rangePx *
            (t.relayBoosted ? 1.24 : 1.0) *
            (t.level === 2 ? 1.12 : 1.0) *
            PERIMETER_CONSTANTS.DARK_CORRIDOR_RANGE_MULT;
          const dx = h.pos.x - t.pos.x;
          const dy = h.pos.y - t.pos.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= darkRange + h.radiusPx) {
            const angDiff = Math.abs(this.normalizeAngle(Math.atan2(dy, dx) - t.angle));
            if (angDiff <= spec.coneHalfAngleRad && this.hasLineOfSight(t.pos, h.pos)) {
              inShortDarkCone = true;
              break;
            }
          }
        }
        h.verified = inShortDarkCone;
      }
    }
  }

  private stepTurrets(dt: number): void {
    this.updateHostileVerification(dt);
    const inBlackout = this.blackoutTimer > 0;

    for (const t of this.turrets) {
      if (t.firingFlashTimer > 0) t.firingFlashTimer = Math.max(0, t.firingFlashTimer - dt);
      if (t.dryFireTimer > 0) t.dryFireTimer = Math.max(0, t.dryFireTimer - dt);
      if (t.overclockTimer > 0) t.overclockTimer = Math.max(0, t.overclockTimer - dt);
      if (t.fireCooldown > 0) t.fireCooldown = Math.max(0, t.fireCooldown - dt);

      const isOverclocked = t.overclockTimer > 0 && !inBlackout;

      // Passive barrel cooling
      const coolRate = t.level === 2 ? 15.5 : 11.5;
      if (t.firingFlashTimer <= 0.01) {
        t.heat = Math.max(0, t.heat - coolRate * dt);
      } else {
        t.heat = Math.max(0, t.heat - coolRate * 0.25 * dt);
      }
      if (t.thermalLocked && t.heat <= 32) {
        t.thermalLocked = false;
        this.pushLog(`${t.callsign} BARREL COOLED // TARGET LOCK RESTORED`, false);
      }

      // Tick Mid-Wave 2.8s Automated Belt-Loader Reload Sequence (offline while reloading!)
      if (t.rearmTimer > 0) {
        t.rearmTimer = Math.max(0, t.rearmTimer - dt);
        if (t.rearmTimer <= 0) {
          t.ammo = t.maxAmmo;
          this.warnedLowAmmoIds.delete(t.id);
          this.warnedDryIds.delete(t.id);
          this.audioCb.onServoStep(this.panFromVirtualX(t.pos.x));
          this.spawnSparks(t.pos, 8, '#44FF77');
          this.callouts.push({
            pos: { x: t.pos.x, y: t.pos.y - 24 },
            text: `${t.callsign} REARMED`,
            color: '#44FF77',
            life: 1.15,
            maxLife: 1.15,
          });
          this.pushLog(`${t.callsign} DRUM LOADED [${t.maxAmmo} RDS] — WEAPON HOT`);
        }
        continue;
      }

      if (!t.powered || inBlackout) continue;

      // Mechanical Servo Rotation toward targetAngle
      const diff = this.normalizeAngle(t.targetAngle - t.angle);
      if (Math.abs(diff) > 0.004) {
        const servoSpeed = (isOverclocked ? 4.2 : 2.1) * dt;
        if (Math.abs(diff) <= servoSpeed) {
          t.angle = t.targetAngle;
        } else {
          t.angle = this.normalizeAngle(t.angle + Math.sign(diff) * servoSpeed);
        }
      }

      const spec = HARDWARE_SPECS[t.kind];

      // 1. M314 Motion Relay Periodic Pulse Sweep
      if (t.kind === 'MOTION_RELAY') {
        t.pulseTimer -= dt * (isOverclocked ? 1.65 : 1.0);
        if (t.pulseTimer <= 0) {
          t.pulseTimer = 1.55;
          const maxR = spec.rangePx * (t.level === 2 ? 1.2 : 1.0);
          this.motionWaves.push({
            origin: { ...t.pos },
            radius: 10,
            maxRadius: maxR,
            speed: 520,
            fromM314: true,
            pingedHostileIds: new Set<number>(),
          });
        }
        continue;
      }

      // 2. Cryo-Stasis Vent Valve Periodic LN2 Plume
      if (t.kind === 'CRYO_VALVE') {
        t.pulseTimer -= dt * (isOverclocked ? 1.7 : 1.0);
        if (t.pulseTimer <= 0) {
          const rPx = spec.rangePx * (t.level === 2 ? 1.22 : 1.0);
          const hostileNear = this.hostiles.some(
            (h) => Math.hypot(h.pos.x - t.pos.x, h.pos.y - t.pos.y) <= rPx + 48
          );
          const hotTurretNear = this.turrets.some(
            (u) =>
              u.id !== t.id &&
              u.heat > 35 &&
              Math.hypot(u.pos.x - t.pos.x, u.pos.y - t.pos.y) <= rPx + 45
          );
          if (hostileNear || hotTurretNear || this.phase === 'WAVE_ACTIVE') {
            t.pulseTimer = 2.75;
            this.cryoPlumes.push({
              pos: { ...t.pos },
              radius: rPx,
              remainingSec: 1.95,
              maxSec: 1.95,
            });
            if (hostileNear) {
              this.audioCb.onCryoHiss(this.panFromVirtualX(t.pos.x));
            }
          } else {
            t.pulseTimer = 0.35;
          }
        }
        continue;
      }

      if (t.thermalLocked) continue;

      // 3. Directional Combat Turrets (UA 571-C Sentry & M240 Incinerator)
      const fullRange =
        spec.rangePx * (t.relayBoosted ? 1.24 : 1.0) * (t.level === 2 ? 1.12 : 1.0);
      const darkRange = fullRange * PERIMETER_CONSTANTS.DARK_CORRIDOR_RANGE_MULT;

      // Acquire highest-priority VERIFIED target inside cone (100% range if illuminated, 55% if dark!)
      let bestTarget: HostileEntity | null = null;
      let bestScore = Infinity;

      for (const h of this.hostiles) {
        if (!h.verified || h.hp <= 0) continue;
        const dx = h.pos.x - t.pos.x;
        const dy = h.pos.y - t.pos.y;
        const dist = Math.hypot(dx, dy);
        const allowedRange = h.illuminated ? fullRange : darkRange;
        if (dist > allowedRange + h.radiusPx) continue;
        const angToH = Math.atan2(dy, dx);
        const angDiff = Math.abs(this.normalizeAngle(angToH - t.angle));
        if (angDiff > spec.coneHalfAngleRad) continue;
        if (!this.hasLineOfSight(t.pos, h.pos)) continue;

        const distToCore = Math.hypot(
          h.pos.x - this.blueprint.coreCenter.x,
          h.pos.y - this.blueprint.coreCenter.y
        );
        if (distToCore < bestScore) {
          bestScore = distToCore;
          bestTarget = h;
        }
      }

      if (!bestTarget || t.fireCooldown > 0) continue;

      if (t.kind === 'SENTRY_PULSE') {
        if (t.ammo <= 0) {
          t.fireCooldown = 0.42;
          t.dryFireTimer = 0.25;
          const dryPan = this.panFromVirtualX(t.pos.x);
          this.audioCb.onDryFire(dryPan);
          if (!this.warnedDryIds.has(t.id)) {
            this.warnedDryIds.add(t.id);
            this.audioCb.onLowAmmoAlert(dryPan, true);
            this.lowAmmoReminderTimer = 5.2;
            this.pushLog(`CRITICAL // SENTRY ${t.callsign} DRY [000 RDS] — REARM IMMEDIATELY!`);
          }
          continue;
        }

        // Fire 10mm caseless pulse burst!
        const roundsSpent = Math.min(t.ammo, 2);
        t.ammo -= roundsSpent;
        t.fireCooldown = isOverclocked ? 0.045 : 0.088;
        t.firingFlashTimer = 0.075;
        // Tuned barrel heat (+2.6/shot = ~3.4s sustained fire to overheat -> real Cryo cooling synergy!)
        t.heat = Math.min(100, t.heat + (isOverclocked ? 3.6 : 2.6));

        const lowThresh = Math.ceil(t.maxAmmo * 0.25);
        if (t.ammo <= 0 && !this.warnedDryIds.has(t.id)) {
          this.warnedDryIds.add(t.id);
          this.audioCb.onLowAmmoAlert(this.panFromVirtualX(t.pos.x), true);
          this.lowAmmoReminderTimer = 5.2;
          this.pushLog(`CRITICAL // SENTRY ${t.callsign} DRY [000 RDS] — REARM IMMEDIATELY!`);
        } else if (t.ammo > 0 && t.ammo <= lowThresh && !this.warnedLowAmmoIds.has(t.id)) {
          this.warnedLowAmmoIds.add(t.id);
          this.audioCb.onLowAmmoAlert(this.panFromVirtualX(t.pos.x), false);
          this.lowAmmoReminderTimer = 5.8;
          this.pushLog(
            `ALERT // SENTRY ${t.callsign} LOW AMMO [${String(t.ammo).padStart(3, '0')} RDS]`
          );
        }

        if (t.heat >= 100) {
          t.thermalLocked = true;
          this.pushLog(`SENTRY ${t.callsign} THERMAL LOCK [100% TEMP] — COOLING BARREL!`);
        }

        const pan = this.panFromVirtualX(t.pos.x);
        const distFromCorePx = Math.hypot(
          t.pos.x - this.blueprint.coreCenter.x,
          t.pos.y - this.blueprint.coreCenter.y
        );
        const distanceNorm = Math.max(0, Math.min(1, (distFromCorePx - 120) / 780));
        this.audioCb.onPulseBurst(pan, isOverclocked, distanceNorm);
        this.audioCb.onAmmoTick(t.ammo / Math.max(1, t.maxAmmo));

        // Darkness 20% scatter miss penalty vs Illuminated pinpoint +20% crit bonus!
        const darkMiss =
          !bestTarget.illuminated && Math.random() < PERIMETER_CONSTANTS.DARK_CORRIDOR_MISS_CHANCE;
        let dmg = darkMiss
          ? 0
          : (t.level === 2 ? 22 : 16.5) *
            (t.relayBoosted ? 1.18 : 1.0) *
            (bestTarget.illuminated ? PERIMETER_CONSTANTS.ILLUMINATED_CRIT_MULT : 1.0);
        let ricochet = false;

        if (!darkMiss) {
          // CRYO + PULSE SHATTER Combo (+35% vs Chilled Praetorians & Bursters!)
          if (
            bestTarget.cryoSlowTimer > 0 &&
            (bestTarget.kind === 'PRAETORIAN' || bestTarget.kind === 'BURSTER')
          ) {
            dmg *= 1.35;
            this.spawnSparks(bestTarget.pos, 4, '#9BF8FF');
            if (Math.random() < 0.22) {
              this.callouts.push({
                pos: { x: bestTarget.pos.x, y: bestTarget.pos.y - 20 },
                text: 'SHATTER +35%',
                color: '#9BF8FF',
                life: 0.7,
                maxLife: 0.7,
              });
            }
          }

          // Praetorian Directional Carapace: 70% Frontal Deflection vs +40% Rear/Flank Bypass Crit!
          if (bestTarget.kind === 'PRAETORIAN') {
            const shotDx = t.pos.x - bestTarget.pos.x;
            const shotDy = t.pos.y - bestTarget.pos.y;
            const shotLen = Math.max(1, Math.hypot(shotDx, shotDy));
            const noseX = Math.cos(bestTarget.heading);
            const noseY = Math.sin(bestTarget.heading);
            const frontalAlignment = (shotDx / shotLen) * noseX + (shotDy / shotLen) * noseY;
            if (frontalAlignment > 0.5) {
              dmg *= 0.3;
              ricochet = true;
              this.audioCb.onRicochet(pan);
              this.spawnSparks(bestTarget.pos, 5, '#FFB000');
              if (Math.random() < 0.24) {
                this.callouts.push({
                  pos: { x: bestTarget.pos.x, y: bestTarget.pos.y - 18 },
                  text: 'RICOCHET',
                  color: '#FFB000',
                  life: 0.55,
                  maxLife: 0.55,
                });
              }
            } else if (frontalAlignment < -0.15) {
              dmg *= 1.4;
              this.spawnSparks(bestTarget.pos, 5, '#8EF5AB');
              if (Math.random() < 0.26) {
                this.callouts.push({
                  pos: { x: bestTarget.pos.x, y: bestTarget.pos.y - 22 },
                  text: 'FLANK CRIT +40%',
                  color: '#44FF77',
                  life: 0.72,
                  maxLife: 0.72,
                });
              }
            }
          }

          bestTarget.hp -= dmg;
          if (bestTarget.hp <= 0) {
            t.kills += 1;
          } else if (this.hitScreechCooldown <= 0 && Math.random() < 0.52) {
            this.hitScreechCooldown = 0.44 + Math.random() * 0.85;
            this.audioCb.onAlienScreech(
              'HIT',
              bestTarget.kind,
              this.panFromVirtualX(bestTarget.pos.x),
              this.distNormFromCore(bestTarget.pos)
            );
          }
        }

        const spread = darkMiss
          ? (Math.random() < 0.5 ? -1 : 1) * (16 + Math.random() * 14)
          : (bestTarget.illuminated ? 3 : 10) * (Math.random() - 0.5);
        this.tracers.push({
          p1: {
            x: t.pos.x + Math.cos(t.angle) * 18,
            y: t.pos.y + Math.sin(t.angle) * 18,
          },
          p2: {
            x: bestTarget.pos.x + spread,
            y: bestTarget.pos.y + spread,
          },
          life: 0.085,
          maxLife: 0.085,
          ricochet: ricochet || darkMiss,
          overclocked: isOverclocked,
        });
        if (!ricochet && !darkMiss) {
          this.spawnSparks(bestTarget.pos, 3, bestTarget.illuminated ? '#8EF5AB' : '#44FF77');
        }
      } else if (t.kind === 'INCINERATOR') {
        // Project lingering phosphor-amber napalm cloud (also illuminates dark corridors!)
        t.fireCooldown = isOverclocked ? 0.34 : 0.62;
        t.firingFlashTimer = 0.25;
        t.heat = Math.min(100, t.heat + (isOverclocked ? 22 : 16.5));
        if (t.heat >= 100) {
          t.thermalLocked = true;
          this.pushLog(`INCINERATOR ${t.callsign} THERMAL LOCK — VENTING CHAMBER!`);
        }

        const rawDist = Math.min(
          fullRange * 0.85,
          Math.hypot(bestTarget.pos.x - t.pos.x, bestTarget.pos.y - t.pos.y)
        );
        const dirAng = Math.atan2(bestTarget.pos.y - t.pos.y, bestTarget.pos.x - t.pos.x);
        const cloudPos = this.castSightRay(t.pos, dirAng, rawDist);

        this.napalmClouds.push({
          pos: cloudPos,
          radius: t.level === 2 ? 78 : 64,
          remainingSec: 3.4,
          maxSec: 3.4,
          dps: t.level === 2 ? 76 : 56,
        });
        this.audioCb.onIncinerator(
          this.panFromVirtualX(t.pos.x),
          this.distNormFromCore(cloudPos)
        );
        this.spawnSparks(cloudPos, 8, '#FFB000');
      }
    }
  }

  private stepHostiles(dt: number): void {
    const ts = this.blueprint.tileSize;

    for (let i = this.hostiles.length - 1; i >= 0; i--) {
      const h = this.hostiles[i];
      if (!h) continue;

      // Check death first
      if (h.hp <= 0) {
        this.handleHostileKilled(h);
        this.hostiles.splice(i, 1);
        continue;
      }

      if (h.stunTimer > 0) {
        continue;
      }

      // Check if reached Reactor Core!
      const distCore = Math.hypot(
        h.pos.x - this.blueprint.coreCenter.x,
        h.pos.y - this.blueprint.coreCenter.y
      );
      if (distCore <= 44) {
        this.hostiles.splice(i, 1);
        this.handleCoreSealBreach(h);
        if (this.phase === 'CORE_BREACHED') return;
        // Core breach shockwave can splice additional nearby hostiles; clamp loop cursor!
        i = Math.min(i, this.hostiles.length);
        continue;
      }

      // Sample Flow-Field steering & welded Blast Door obstruction
      const nav = this.pathfinder.sampleDirection(
        this.blueprint,
        this.doors,
        h.pos,
        h.kind === 'PRAETORIAN'
      );

      if (nav.batteringDoor) {
        h.batteringDoorId = nav.batteringDoor.def.id;
        h.heading = Math.atan2(
          nav.batteringDoor.def.center.y - h.pos.y,
          nav.batteringDoor.def.center.x - h.pos.x
        );
        const spec = HOSTILE_SPECS[h.kind];
        const slowFactor = h.cryoSlowTimer > 0 ? 0.45 : 1.0;
        nav.batteringDoor.hp -= spec.doorDps * slowFactor * dt;
        nav.batteringDoor.underAttackTimer = 0.28;

        if (Math.random() < dt * 4.5) {
          this.audioCb.onDoorBatter(this.panFromVirtualX(nav.batteringDoor.def.center.x));
          this.spawnSparks(nav.batteringDoor.def.center, 4, '#FFB000');
        }
        if (this.doorScreechCooldown <= 0) {
          this.doorScreechCooldown = 0.85 + Math.random() * 1.25;
          this.audioCb.onAlienScreech(
            'DOOR_CLAW',
            h.kind,
            this.panFromVirtualX(nav.batteringDoor.def.center.x),
            this.distNormFromCore(nav.batteringDoor.def.center)
          );
        }

        if (nav.batteringDoor.hp <= 0) {
          this.breachWeldedDoor(nav.batteringDoor, `BATTERED BY ${spec.name}`);
        }
        continue;
      }

      h.batteringDoorId = null;
      h.weavePhase += dt * (h.kind === 'SKITTERER' ? 11.5 : 4.2);

      let dirX = nav.dir.x;
      let dirY = nav.dir.y;

      // Skitterers weave erratically across corridors!
      if (h.kind === 'SKITTERER') {
        const perpX = -dirY;
        const perpY = dirX;
        const weave = Math.sin(h.weavePhase) * 0.52;
        dirX += perpX * weave;
        dirY += perpY * weave;
        const l = Math.max(1e-3, Math.hypot(dirX, dirY));
        dirX /= l;
        dirY /= l;
      }

      const speedMult = h.cryoSlowTimer > 0 ? 0.42 : 1.0;
      const moveSpd = h.speedPxS * speedMult;
      const nextX = h.pos.x + dirX * moveSpd * dt;
      const nextY = h.pos.y + dirY * moveSpd * dt;

      // Slide cleanly along corridor bulkhead walls & sealed blast doors
      if (
        this.pathfinder.isPassableCell(
          this.blueprint,
          this.doors,
          Math.floor(nextX / ts),
          Math.floor(h.pos.y / ts)
        )
      ) {
        h.pos.x = nextX;
      }
      if (
        this.pathfinder.isPassableCell(
          this.blueprint,
          this.doors,
          Math.floor(h.pos.x / ts),
          Math.floor(nextY / ts)
        )
      ) {
        h.pos.y = nextY;
      }

      h.vel.x = dirX * moveSpd;
      h.vel.y = dirY * moveSpd;
      h.heading = Math.atan2(dirY, dirX);
    }
  }

  private handleHostileKilled(h: HostileEntity): void {
    const spec = HOSTILE_SPECS[h.kind];
    this.totalKills += 1;
    this.scrap += spec.scrapReward;
    this.score += spec.scoreValue;
    this.spawnSparks(h.pos, h.kind === 'PRAETORIAN' ? 14 : 6, '#44FF77');

    // Wounded / dying Xenomorph wail echoing from the corridor outside
    const deathChance =
      h.kind === 'PRAETORIAN'
        ? 1.0
        : h.kind === 'BURSTER' || h.kind === 'STALKER'
          ? 0.78
          : 0.46;
    if (this.deathScreechCooldown <= 0 && Math.random() < deathChance) {
      this.deathScreechCooldown = 0.28 + Math.random() * 0.54;
      this.audioCb.onAlienScreech(
        'DEATH',
        h.kind,
        this.panFromVirtualX(h.pos.x),
        this.distNormFromCore(h.pos)
      );
    }

    // Acid Burster detonates into a corrosive vector hazard pool on death!
    if (h.kind === 'BURSTER') {
      this.acidPools.push({
        pos: { ...h.pos },
        radius: 88,
        remainingSec: 9.0,
        maxSec: 9.0,
      });
      this.audioCb.onAcidSizzle(this.panFromVirtualX(h.pos.x));
      this.spawnSparks(h.pos, 12, '#B8FF3B');
    }
  }

  private handleCoreSealBreach(breacher: HostileEntity): void {
    this.bulkheadSeals = Math.max(0, this.bulkheadSeals - 1);
    this.sealLostFlashTimer = 2.5;
    this.audioCb.onBulkheadBreach();
    this.audioCb.onSyncGlitch(0.95);
    this.spawnSparks(this.blueprint.coreCenter, 28, '#FF3318');

    if (this.bulkheadSeals <= 0) {
      this.phase = 'CORE_BREACHED';
      this.pushLog('CRITICAL // ALL 3 REACTOR CORE BULKHEAD SEALS BREACHED — COLONY SECTOR LOST!');
      return;
    }

    // Emergency inner shockwave clears immediate Core chamber on seal blow so 1 pack doesn't instant-drain 3 seals
    for (let i = this.hostiles.length - 1; i >= 0; i--) {
      const other = this.hostiles[i];
      if (
        Math.hypot(
          other.pos.x - this.blueprint.coreCenter.x,
          other.pos.y - this.blueprint.coreCenter.y
        ) <= 160
      ) {
        this.hostiles.splice(i, 1);
      }
    }

    this.pushLog(
      `!! CORE BULKHEAD SEAL BREACHED BY ${HOSTILE_SPECS[breacher.kind].name} // ${this.bulkheadSeals}/3 SEALS REMAINING !!`
    );
  }

  private completeCurrentWave(): void {
    const bonus = this.currentWaveDef.scrapBonus;
    this.scrap += bonus;
    this.score += this.waveNumber * 500 + this.bulkheadSeals * 250;

    // Cleanly finalize any in-progress mid-wave reloads/welds & reset overload between waves
    this.overloadTimer = 0;
    this.blackoutTimer = 0;
    this.grateTelegraphs = [];
    for (const t of this.turrets) {
      if (t.rearmTimer > 0) {
        t.rearmTimer = 0;
        t.ammo = t.maxAmmo;
        this.warnedLowAmmoIds.delete(t.id);
        this.warnedDryIds.delete(t.id);
      }
    }
    let doorsChanged = false;
    for (const ds of this.doors.values()) {
      ds.repairCooldown = 0;
      if (ds.weldingTimer > 0) {
        ds.weldingTimer = 0;
        ds.welded = true;
        ds.hp = ds.maxHp;
        doorsChanged = true;
      }
    }
    if (doorsChanged) {
      this.pathfinder.recompute(this.blueprint, this.doors);
      this.recomputeRelayLinks();
    }

    if (this.waveNumber % 2 === 0 && this.maxReactorKw < PERIMETER_CONSTANTS.MAX_REACTOR_KW_CAP) {
      this.maxReactorKw = Math.min(PERIMETER_CONSTANTS.MAX_REACTOR_KW_CAP, this.maxReactorKw + 15);
      this.pushLog(`AUXILIARY REACTOR BUS UNLOCKED // MAX CAPACITY NOW ${this.maxReactorKw} kW!`);
    }

    if (
      this.mode === 'SECTOR_01' &&
      this.waveNumber >= Sector01Blueprint.SECTOR_01_MAX_WAVES
    ) {
      this.score += this.bulkheadSeals * 2500 + this.scrap * 10;
      this.phase = 'SECTOR_VICTORY';
      this.pushLog('SECTOR 01 SECURED // ALL 10 XENOMORPH INCURSION WAVES NEUTRALIZED!');
      return;
    }

    this.pushLog(
      `WAVE ${String(this.waveNumber).padStart(2, '0')} CLEARED // +${bonus} ORDNANCE SCRAP REQUISITIONED.`
    );
    this.waveNumber += 1;
    this.currentWaveDef = Sector01Blueprint.getWaveDefinition(this.waveNumber);
    this.purgeAvailableThisWave = true;
    this.phase = 'TACTICAL_PREP';
  }

  private stepVisualParticles(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      this.tracers[i].life -= dt;
      if (this.tracers[i].life <= 0) this.tracers.splice(i, 1);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.pos.x += s.vel.x * dt;
      s.pos.y += s.vel.y * dt;
      s.vel.x *= 0.92;
      s.vel.y *= 0.92;
      s.life -= dt;
      if (s.life <= 0) this.sparks.splice(i, 1);
    }
    for (let i = this.callouts.length - 1; i >= 0; i--) {
      const c = this.callouts[i];
      c.pos.y -= 18 * dt;
      c.life -= dt;
      if (c.life <= 0) this.callouts.splice(i, 1);
    }
  }

  private stepXenomorphChaosAudio(dt: number): void {
    if (dt <= 0) return;
    if (this.hitScreechCooldown > 0)
      this.hitScreechCooldown = Math.max(0, this.hitScreechCooldown - dt);
    if (this.burnScreechCooldown > 0)
      this.burnScreechCooldown = Math.max(0, this.burnScreechCooldown - dt);
    if (this.doorScreechCooldown > 0)
      this.doorScreechCooldown = Math.max(0, this.doorScreechCooldown - dt);
    if (this.deathScreechCooldown > 0)
      this.deathScreechCooldown = Math.max(0, this.deathScreechCooldown - dt);

    if (this.phase !== 'WAVE_ACTIVE' || this.hostiles.length === 0) {
      this.swarmScreechTimer = 0.8 + Math.random() * 0.7;
      return;
    }

    // Periodic Low-Ammo / Empty-Drum console alert chime reminder during active combat
    const alertingSentry = this.turrets.find(
      (t) =>
        t.powered &&
        t.kind === 'SENTRY_PULSE' &&
        t.ammo <= Math.ceil(t.maxAmmo * 0.25)
    );
    if (alertingSentry) {
      this.lowAmmoReminderTimer -= dt;
      if (this.lowAmmoReminderTimer <= 0) {
        const anyDry = this.turrets.some(
          (t) => t.powered && t.kind === 'SENTRY_PULSE' && t.ammo <= 0
        );
        this.lowAmmoReminderTimer = anyDry ? 5.2 : 6.2;
        this.audioCb.onLowAmmoAlert(this.panFromVirtualX(alertingSentry.pos.x), anyDry);
      }
    }

    this.swarmScreechTimer -= dt;
    if (this.swarmScreechTimer <= 0) {
      const hordeFactor = Math.min(1, this.hostiles.length / 14);
      this.swarmScreechTimer = (2.35 - hordeFactor * 1.45) * (0.62 + Math.random() * 0.88);
      const picked = this.hostiles[Math.floor(Math.random() * this.hostiles.length)];
      if (picked) {
        this.audioCb.onAlienScreech(
          'SWARM',
          picked.kind,
          this.panFromVirtualX(picked.pos.x),
          this.distNormFromCore(picked.pos)
        );
      }
    }
  }

  private stepMotionTrackerAudio(rawDt: number): void {
    if (this.hostiles.length === 0) {
      this.trackerAudioTimer = 0.4;
      return;
    }

    let minDistPx = Infinity;
    let closestX = this.blueprint.coreCenter.x;
    for (const h of this.hostiles) {
      if (h.blipTimer <= 0 && !h.verified) continue;
      const d = Math.hypot(
        h.pos.x - this.blueprint.coreCenter.x,
        h.pos.y - this.blueprint.coreCenter.y
      );
      if (d < minDistPx) {
        minDistPx = d;
        closestX = h.pos.x;
      }
    }
    if (!Number.isFinite(minDistPx)) return;

    const distM = minDistPx / PERIMETER_CONSTANTS.PX_PER_METER;
    const norm = Math.max(0, Math.min(1, distM / 30));
    const interval = 0.22 + Math.pow(norm, 1.35) * 1.35;

    this.trackerAudioTimer -= rawDt;
    if (this.trackerAudioTimer <= 0) {
      this.trackerAudioTimer = interval;
      this.audioCb.onMotionPing(distM, 30, this.panFromVirtualX(closestX));
    }
  }

  public getNearestContactTelemetry(): {
    nearestDistM: number | null;
    contacts: Array<{ bearingRad: number; distM: number; verified: boolean }>;
  } {
    let nearestDistM: number | null = null;
    const contacts: Array<{ bearingRad: number; distM: number; verified: boolean }> = [];

    for (const h of this.hostiles) {
      if (h.blipTimer <= 0 && !h.verified) continue;
      const refPos = h.verified ? h.pos : h.blipPos;
      const dx = refPos.x - this.blueprint.coreCenter.x;
      const dy = refPos.y - this.blueprint.coreCenter.y;
      const distM = Math.hypot(dx, dy) / PERIMETER_CONSTANTS.PX_PER_METER;
      if (nearestDistM === null || distM < nearestDistM) {
        nearestDistM = distM;
      }
      contacts.push({
        bearingRad: Math.atan2(dy, dx),
        distM,
        verified: h.verified,
      });
    }

    return { nearestDistM, contacts };
  }

  private spawnSparks(origin: Vec2, count: number, color: string): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 45 + Math.random() * 145;
      const life = 0.22 + Math.random() * 0.28;
      this.sparks.push({
        pos: { x: origin.x, y: origin.y },
        vel: { x: Math.cos(a) * spd, y: Math.sin(a) * spd },
        color,
        life,
        maxLife: life,
      });
    }
  }

  private normalizeAngle(a: number): number {
    let r = a;
    while (r > Math.PI) r -= Math.PI * 2;
    while (r < -Math.PI) r += Math.PI * 2;
    return r;
  }

  private pointToSegmentDist(p: Vec2, a: Vec2, b: Vec2): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1e-4) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
    const projX = a.x + abx * t;
    const projY = a.y + aby * t;
    return Math.hypot(p.x - projX, p.y - projY);
  }
}
