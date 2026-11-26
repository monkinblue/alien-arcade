import type { PerimeterVoiceId } from '../audio/AudioEngine';
import type { Vec2 } from '../types';
import { FlowFieldPathfinder } from './FlowFieldPathfinder';
import { Sector01Blueprint, type ColonyBlueprint } from './Sector01Blueprint';
import {
  HARDWARE_SPECS,
  HOSTILE_SPECS,
  MK3_BRANCH_SPECS,
  PERIMETER_CONSTANTS,
  TACTICAL_PROTOCOLS,
  WAVE_MUTATORS,
  type AcidHazardPool,
  type AcidSpitProjectile,
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
  type Mk3BranchId,
  type MotionSweepWave,
  type NapalmCloud,
  type OverclockZone,
  type PerimeterMode,
  type PerimeterPhase,
  type PhantomBlip,
  type PlacedTurret,
  type ProtocolId,
  type ProximityClaymore,
  type QueenEggSac,
  type RailBeamBolt,
  type ShockArcBolt,
  type StrobeFlareZone,
  type TracerBolt,
  type TurretKind,
  type VectorSpark,
  type WaveDefinition,
  type WaveMutatorId,
} from './types';

export interface SimulationAudioCallbacks {
  onMotionPing(distMeters: number, maxMeters: number, pan: number, closeSwarmCount: number): void;
  onPulseBurst(pan: number, overclocked: boolean, distanceNorm: number, tier: 1 | 2 | 3): void;
  onRailLance(pan: number, tier: 1 | 2 | 3, distanceNorm?: number): void;
  onShockCoil(pan: number): void;
  onClaymoreBlast(pan: number): void;
  onQueenRoar(pan: number): void;
  onShatterCrunch(pan: number): void;
  onThermalSteam(pan: number): void;
  onReactorBreaker(tripped: boolean): void;
  onWaveClear(): void;
  onUpgradeConfirm(isMk3: boolean): void;
  onIntercomVoice(id: PerimeterVoiceId): void;
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

  public mode: PerimeterMode = 'ENDLESS_SIEGE';
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
  public claymores: ProximityClaymore[] = [];
  public acidSpits: AcidSpitProjectile[] = [];
  public eggSacs: QueenEggSac[] = [];
  public shockArcs: ShockArcBolt[] = [];
  public railBeams: RailBeamBolt[] = [];
  public phantomBlips: PhantomBlip[] = [];
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

  // Active Command Ability Cooldowns, Reactor Reserve Battery, Load-Shed & Mutators
  public flareCooldown = 0;
  public overclockCooldown = 0;
  public coolantFlushCooldown = 0;
  public floodlightCooldown = 0;
  public purgeAvailableThisWave = true;
  public activeFlareSurgeTimer = 0;
  public activeOverclockSurgeTimer = 0;
  public activeCoolantSurgeTimer = 0;
  public floodlightTimer = 0;
  public reserveBattery = 25; // 0..100%: absorbs overloads OR triggers [L] Floodlight!
  public auxShedActive = false;
  public auxShedTurretIds: string[] = [];
  public reactorExpansionsBought = 0;
  public overloadTimer = 0;
  public blackoutTimer = 0;

  // Roguelike Protocol Drafts, Wave Mutators & Perfect-Wave Streak
  public activeProtocols: Partial<Record<ProtocolId, number>> = {};
  public protocolDraftChoices: ProtocolId[] = [];
  public activeMutator: WaveMutatorId = 'NONE';
  public perfectWaveStreak = 0;
  private sealLostThisWave = false;

  // Event Log Stream
  public eventLogs: string[] = [];

  // Internal counters
  private nextHostileId = 1;
  private callsignCounters: Record<TurretKind, number> = {
    SENTRY_PULSE: 0,
    INCINERATOR: 0,
    RAIL_LANCE: 0,
    CRYO_VALVE: 0,
    SHOCK_COIL: 0,
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
    this.resetRun('ENDLESS_SIEGE', true);
  }

  public resetRun(mode: PerimeterMode = 'ENDLESS_SIEGE', showBriefing = false): void {
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
    this.claymores = [];
    this.acidSpits = [];
    this.eggSacs = [];
    this.shockArcs = [];
    this.railBeams = [];
    this.phantomBlips = [];
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
    this.coolantFlushCooldown = 0;
    this.floodlightCooldown = 0;
    this.purgeAvailableThisWave = true;
    this.activeFlareSurgeTimer = 0;
    this.activeOverclockSurgeTimer = 0;
    this.activeCoolantSurgeTimer = 0;
    this.floodlightTimer = 0;
    this.reserveBattery = 25;
    this.auxShedActive = false;
    this.auxShedTurretIds = [];
    this.reactorExpansionsBought = 0;
    this.overloadTimer = 0;
    this.blackoutTimer = 0;
    this.overloadWarnCooldown = 0;
    this.grateRattleCooldown = 0;

    this.activeProtocols = {};
    this.protocolDraftChoices = [];
    this.activeMutator = 'NONE';
    this.perfectWaveStreak = 0;
    this.sealLostThisWave = false;

    this.callsignCounters = {
      SENTRY_PULSE: 0,
      INCINERATOR: 0,
      RAIL_LANCE: 0,
      CRYO_VALVE: 0,
      SHOCK_COIL: 0,
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
      `LOG> ENDLESS HIVE SIEGE ONLINE // ${this.blueprint.code}: ${this.blueprint.name}`,
      `LOG> REACTOR BUS: ${this.maxReactorKw} kW // ORDNANCE SCRAP: ${this.scrap} // CORE SEALS: 3/3`,
      'LOG> HOLD REACTOR CORE AGAINST ENDLESS WAVES — DEPLOY [1-8] & ENGAGE WAVE 01.',
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

  public getProtocolStacks(id: ProtocolId): number {
    return this.activeProtocols[id] ?? 0;
  }

  public getMaxDoorSeals(): number {
    return PERIMETER_CONSTANTS.MAX_ACTIVE_DOOR_SEALS + this.getProtocolStacks('BULKHEAD_ARMOR');
  }

  public getDoorMaxHp(): number {
    return Math.round(
      PERIMETER_CONSTANTS.DOOR_MAX_HP * (1 + this.getProtocolStacks('BULKHEAD_ARMOR') * 0.45)
    );
  }

  public getStreakMultiplier(): number {
    return Math.round((1.0 + Math.min(1.5, this.perfectWaveStreak * 0.25)) * 100) / 100;
  }

  public getActiveScoreMultiplier(): number {
    const mut = WAVE_MUTATORS[this.activeMutator]?.scoreMult ?? 1.0;
    return this.getStreakMultiplier() * mut;
  }

  public getReactorExpandCost(): number {
    return (
      PERIMETER_CONSTANTS.REACTOR_EXPAND_BASE_COST +
      this.reactorExpansionsBought * PERIMETER_CONSTANTS.REACTOR_EXPAND_STEP_COST
    );
  }

  public getTurretPowerKw(t: PlacedTurret): number {
    const base = HARDWARE_SPECS[t.kind].powerKw;
    if (t.level === 3 && t.mk3Branch) {
      return base + MK3_BRANCH_SPECS[t.kind][t.mk3Branch].extraKw;
    }
    return base;
  }

  public getStaticAllocatedKw(): number {
    let sum = 0;
    for (const t of this.turrets) {
      if (t.powered) {
        sum += this.getTurretPowerKw(t);
      }
    }
    return sum;
  }

  public getTotalLoadKw(): number {
    if (this.blackoutTimer > 0) return 0;
    let kw = this.getStaticAllocatedKw();
    if (this.activeFlareSurgeTimer > 0) kw += PERIMETER_CONSTANTS.FLARE_SURGE_KW;
    if (this.activeOverclockSurgeTimer > 0) kw += PERIMETER_CONSTANTS.OVERCLOCK_SURGE_KW;
    if (this.activeCoolantSurgeTimer > 0) kw += PERIMETER_CONSTANTS.COOLANT_FLUSH_SURGE_KW;
    return kw;
  }

  public getReactorAudioTelemetry(): {
    active: boolean;
    loadRatio: number;
    overloadFrac: number;
    blackoutActive: boolean;
  } {
    const active = this.phase === 'TACTICAL_PREP' || this.phase === 'WAVE_ACTIVE';
    const loadRatio = this.getTotalLoadKw() / Math.max(1, this.maxReactorKw);
    const overloadFrac = Math.min(
      1,
      this.overloadTimer / PERIMETER_CONSTANTS.REACTOR_OVERLOAD_TRIP_SEC
    );
    return {
      active,
      loadRatio,
      overloadFrac,
      blackoutActive: this.blackoutTimer > 0,
    };
  }

  /**
   * Magnetic hardpoint snap helper: snapping within ~48px of an open valid MOUNT_PAD,
   * DUCT_GRATE, or BLAST_DOOR eliminates off-center click misses during fast combat!
   */
  public resolveMagneticBuildCell(
    buildId: Exclude<BuildToolId, 'NONE'>,
    virtPos: Vec2,
    maxSnapPx = 48
  ): { col: number; row: number; snapped: boolean } {
    const ts = this.blueprint.tileSize;
    const rawCol = Math.floor(virtPos.x / ts);
    const rawRow = Math.floor(virtPos.y / ts);
    if (this.canPlaceHardwareAt(buildId, rawCol, rawRow).ok) {
      return { col: rawCol, row: rawRow, snapped: false };
    }

    if (buildId === 'ARC_WELDER') {
      const nearDoor = this.findDoorNearPoint(virtPos, maxSnapPx + 24);
      if (nearDoor) {
        const t0 = nearDoor.def.tiles[0];
        return { col: t0.col, row: t0.row, snapped: true };
      }
      return { col: rawCol, row: rawRow, snapped: false };
    }

    if (buildId === 'CLAYMORE') {
      return { col: rawCol, row: rawRow, snapped: false };
    }

    const wantTile = buildId === 'CRYO_VALVE' || buildId === 'SHOCK_COIL' ? 'DUCT_GRATE' : 'MOUNT_PAD';
    let bestCol = rawCol;
    let bestRow = rawRow;
    let bestDist = maxSnapPx;
    let snapped = false;

    for (let r = Math.max(0, rawRow - 1); r <= Math.min(this.blueprint.rows - 1, rawRow + 1); r++) {
      for (let c = Math.max(0, rawCol - 1); c <= Math.min(this.blueprint.cols - 1, rawCol + 1); c++) {
        if (this.blueprint.tiles[r][c] !== wantTile) continue;
        if (this.turrets.some((t) => t.col === c && t.row === r)) continue;
        const cx = c * ts + ts * 0.5;
        const cy = r * ts + ts * 0.5;
        const d = Math.hypot(virtPos.x - cx, virtPos.y - cy);
        if (d < bestDist) {
          bestDist = d;
          bestCol = c;
          bestRow = r;
          snapped = true;
        }
      }
    }
    return { col: bestCol, row: bestRow, snapped };
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
      const maxSeals = this.getMaxDoorSeals();
      if (!door.welded && this.getActiveSealedDoorCount() >= maxSeals) {
        return {
          ok: false,
          reason: `MAX ${maxSeals} DOOR SEALS ACTIVE — UNSEAL ONE FIRST`,
        };
      }
      const cost = door.welded
        ? Math.max(18, Math.round(spec.costScrap * (1 - door.hp / Math.max(1, door.maxHp))))
        : spec.costScrap;
      if (this.scrap < cost) {
        return { ok: false, reason: `INSUFFICIENT SCRAP (${cost} REQ)` };
      }
      return { ok: true };
    }

    if (buildId === 'CLAYMORE') {
      const tileKind = this.blueprint.tiles[row][col];
      if (!FlowFieldPathfinder.isWalkableKind(tileKind) || tileKind === 'CORE') {
        return { ok: false, reason: 'DEPLOY M18 CLAYMORE ON OPEN CORRIDOR FLOOR' };
      }
      if (this.claymores.length >= PERIMETER_CONSTANTS.CLAYMORE_MAX_ACTIVE) {
        return {
          ok: false,
          reason: `MAX ${PERIMETER_CONSTANTS.CLAYMORE_MAX_ACTIVE} CLAYMORES ACTIVE`,
        };
      }
      if (this.claymores.some((m) => m.col === col && m.row === row)) {
        return { ok: false, reason: 'CLAYMORE ALREADY ARMED ON TILE' };
      }
      if (this.scrap < spec.costScrap) {
        return { ok: false, reason: `INSUFFICIENT SCRAP (${spec.costScrap} REQ)` };
      }
      return { ok: true };
    }

    const tileKind = this.blueprint.tiles[row][col];
    if (this.turrets.some((t) => t.col === col && t.row === row)) {
      return { ok: false, reason: 'HARDPOINT OCCUPIED' };
    }

    if (buildId === 'CRYO_VALVE' || buildId === 'SHOCK_COIL') {
      if (tileKind !== 'DUCT_GRATE') {
        return { ok: false, reason: 'MOUNT ON FLOOR DUCT GRATE' };
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
      door.maxHp = this.getDoorMaxHp();
      const cost = door.welded
        ? Math.max(18, Math.round(spec.costScrap * (1 - door.hp / Math.max(1, door.maxHp))))
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
            : `ARC-WELDED BULKHEAD ${door.def.id} (${this.getActiveSealedDoorCount()}/${this.getMaxDoorSeals()}) // HOSTILE FLOW REROUTED`
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

    if (buildId === 'CLAYMORE') {
      const spec = HARDWARE_SPECS.CLAYMORE;
      this.scrap -= spec.costScrap;
      const ts = this.blueprint.tileSize;
      const pos: Vec2 = { x: col * ts + ts * 0.5, y: row * ts + ts * 0.5 };
      this.claymores.push({
        id: `mine-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        col,
        row,
        pos,
        armTimer: 0.6,
      });
      this.spawnSparks(pos, 8, '#FFB000');
      this.audioCb.onServoStep(this.panFromVirtualX(pos.x));
      this.pushLog(
        `ARMED M18 PROXIMITY CLAYMORE (${this.claymores.length}/${PERIMETER_CONSTANTS.CLAYMORE_MAX_ACTIVE}) // -${spec.costScrap} SCRAP`
      );
      return { ok: true };
    }

    const spec = HARDWARE_SPECS[buildId];
    this.scrap -= spec.costScrap;

    this.callsignCounters[buildId] += 1;
    const prefix =
      buildId === 'SENTRY_PULSE'
        ? 'A'
        : buildId === 'INCINERATOR'
          ? 'F'
          : buildId === 'RAIL_LANCE'
            ? 'R'
            : buildId === 'CRYO_VALVE'
              ? 'C'
              : buildId === 'SHOCK_COIL'
                ? 'S'
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
      relayMatrixBoosted: false,
      acidDebuffTimer: 0,
      jammedTimer: 0,
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
    const myFlowDist = this.pathfinder.getFlowDistance(col, row);
    // Score 16 directions by clear corridor sightline + upstream enemy traffic flow alignment!
    let bestAng = Math.atan2(pos.y - this.blueprint.coreCenter.y, pos.x - this.blueprint.coreCenter.x);
    let bestScore = -1e9;
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      let clearDist = 0;
      let upstreamBonus = 0;
      const seenCells = new Set<number>();
      for (let d = 30; d <= 420; d += 30) {
        const tc = Math.floor((pos.x + Math.cos(a) * d) / ts);
        const tr = Math.floor((pos.y + Math.sin(a) * d) / ts);
        if (
          tc >= 0 &&
          tc < this.blueprint.cols &&
          tr >= 0 &&
          tr < this.blueprint.rows &&
          !this.isCellOpaque(tc, tr)
        ) {
          clearDist = d;
          const cellKey = tr * this.blueprint.cols + tc;
          if (!seenCells.has(cellKey)) {
            seenCells.add(cellKey);
            const cellFlow = this.pathfinder.getFlowDistance(tc, tr);
            if (cellFlow < 1e8 && myFlowDist < 1e8) {
              if (cellFlow > myFlowDist + 0.5) {
                upstreamBonus += 38;
              } else if (cellFlow < myFlowDist - 0.5) {
                upstreamBonus -= 18;
              }
            }
          }
        } else {
          break;
        }
      }
      // Slight preference for clean cardinal corridor axes so beams run straight down hallways
      const cardinalBonus = i % 4 === 0 ? 22 : 0;
      const score = clearDist + upstreamBonus + cardinalBonus;
      if (score > bestScore) {
        bestScore = score;
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
      if (t.kind === 'SENTRY_PULSE' || t.kind === 'RAIL_LANCE' || t.kind === 'INCINERATOR') {
        const linked = activeRelays.filter(
          (r) => Math.hypot(r.pos.x - t.pos.x, r.pos.y - t.pos.y) <= (r.level === 3 ? 290 : 255)
        );
        t.relayBoosted = linked.length > 0;
        t.relayMatrixBoosted = linked.some((r) => r.level === 3 && r.mk3Branch === 'B');
      } else {
        t.relayBoosted = false;
        t.relayMatrixBoosted = false;
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

  public getRearmCostFor(t: PlacedTurret): number {
    if (t.kind !== 'SENTRY_PULSE' || t.ammo >= t.maxAmmo) return 0;
    const missingRatio = (t.maxAmmo - t.ammo) / Math.max(1, t.maxAmmo);
    const autoStacks = this.getProtocolStacks('AUTOLOADER');
    const costMult = Math.pow(0.65, autoStacks);
    return Math.max(8, Math.round(PERIMETER_CONSTANTS.REARM_COST_SCRAP * missingRatio * costMult));
  }

  public rearmTurret(turretId: string): { ok: boolean; msg: string } {
    const t = this.turrets.find((u) => u.id === turretId);
    if (!t || t.kind !== 'SENTRY_PULSE') return { ok: false, msg: 'NO DRUM MAGAZINE' };
    if (t.rearmTimer > 0) {
      return { ok: false, msg: `${t.callsign} RELOADING (${t.rearmTimer.toFixed(1)}S)` };
    }
    if (t.ammo >= t.maxAmmo) return { ok: false, msg: 'DRUM ALREADY FULL' };
    const cost = this.getRearmCostFor(t);
    if (this.scrap < cost) {
      return { ok: false, msg: `INSUFFICIENT SCRAP (${cost} REQ)` };
    }
    this.scrap -= cost;

    if (this.phase === 'TACTICAL_PREP') {
      t.ammo = t.maxAmmo;
      t.rearmTimer = 0;
      this.warnedLowAmmoIds.delete(t.id);
      this.warnedDryIds.delete(t.id);
      this.audioCb.onRearmSentry(this.panFromVirtualX(t.pos.x));
      this.pushLog(`REARMED ${t.callsign} [${t.maxAmmo} RDS] // -${cost} SCRAP`);
      return { ok: true, msg: `${t.callsign} REARMED` };
    }

    const autoStacks = this.getProtocolStacks('AUTOLOADER');
    const dur = Math.max(0.85, PERIMETER_CONSTANTS.REARM_DURATION_SEC * Math.pow(0.55, autoStacks));
    t.rearmTimer = dur;
    t.rearmDuration = dur;
    this.audioCb.onRearmSentry(this.panFromVirtualX(t.pos.x));
    this.pushLog(`RELOADING ${t.callsign} [${dur.toFixed(1)}S BELT FEED] // -${cost} SCRAP`);
    return { ok: true, msg: `${t.callsign} RELOADING (${dur.toFixed(1)}S)` };
  }

  public rearmAllSentries(): { ok: boolean; msg: string; count: number } {
    const candidates = this.turrets
      .filter((t) => t.kind === 'SENTRY_PULSE' && t.rearmTimer <= 0 && t.ammo < t.maxAmmo)
      .sort((a, b) => a.ammo / Math.max(1, a.maxAmmo) - b.ammo / Math.max(1, b.maxAmmo));
    if (candidates.length === 0) {
      return { ok: false, msg: 'ALL SENTRY DRUMS FULL OR LOADING', count: 0 };
    }
    let count = 0;
    let totalSpent = 0;
    for (const s of candidates) {
      const c = this.getRearmCostFor(s);
      if (this.scrap < c) break;
      const r = this.rearmTurret(s.id);
      if (r.ok) {
        count++;
        totalSpent += c;
      }
    }
    if (count === 0) {
      return { ok: false, msg: 'INSUFFICIENT SCRAP TO REARM', count: 0 };
    }
    return {
      ok: true,
      msg: `REARMED ${count} SENTR${count === 1 ? 'Y' : 'IES'} (-${totalSpent}S)`,
      count,
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
    const reqKw = this.getTurretPowerKw(t);
    if (!t.powered) {
      if (this.getStaticAllocatedKw() + reqKw > this.maxReactorKw) {
        return { ok: false, msg: `REACTOR OVERLOAD (${reqKw} kW NEEDED)` };
      }
      t.powered = true;
      this.recomputeRelayLinks();
      this.pushLog(`${t.callsign} POWER ONLINE [+${reqKw} kW]`);
      return { ok: true, msg: `${t.callsign} ONLINE` };
    } else {
      t.powered = false;
      this.recomputeRelayLinks();
      this.pushLog(`${t.callsign} STANDBY OFFLINE [-${reqKw} kW FREED]`);
      return { ok: true, msg: `${t.callsign} OFFLINE` };
    }
  }

  public toggleAuxLoadShed(): { ok: boolean; msg: string } {
    if (!this.auxShedActive) {
      const auxUnits = this.turrets.filter(
        (t) =>
          t.powered &&
          (t.kind === 'MOTION_RELAY' || t.kind === 'CRYO_VALVE' || t.kind === 'SHOCK_COIL')
      );
      if (auxUnits.length === 0) {
        return { ok: false, msg: 'NO ONLINE AUXILIARY UNITS TO SHED' };
      }
      let freedKw = 0;
      this.auxShedTurretIds = [];
      for (const u of auxUnits) {
        u.powered = false;
        freedKw += this.getTurretPowerKw(u);
        this.auxShedTurretIds.push(u.id);
      }
      this.auxShedActive = true;
      this.recomputeRelayLinks();
      this.audioCb.onServoStep(0);
      this.pushLog(`AUXILIARY LOAD SHED // ${auxUnits.length} SUPPORT UNITS OFFLINE (-${freedKw} kW)`);
      return { ok: true, msg: `SHED AUX: -${freedKw} kW FREED` };
    } else {
      let restored = 0;
      const stillOffline: string[] = [];
      for (const id of this.auxShedTurretIds) {
        const u = this.turrets.find((t) => t.id === id);
        if (u && !u.powered) {
          const req = this.getTurretPowerKw(u);
          if (this.getStaticAllocatedKw() + req <= this.maxReactorKw) {
            u.powered = true;
            restored++;
          } else {
            stillOffline.push(id);
          }
        }
      }
      this.auxShedTurretIds = stillOffline;
      this.auxShedActive = stillOffline.length > 0;
      this.recomputeRelayLinks();
      this.audioCb.onServoStep(0);
      if (stillOffline.length > 0) {
        this.pushLog(
          `AUXILIARY RESTORE PARTIAL // ${restored} ONLINE · ${stillOffline.length} STILL NEED kW HEADROOM`
        );
        return {
          ok: restored > 0,
          msg:
            restored > 0
              ? `RESTORED ${restored} (${stillOffline.length} NEED kW)`
              : `NEED MORE kW FOR ${stillOffline.length} AUX UNIT(S)`,
        };
      }
      this.pushLog(`AUXILIARY BUS RESTORED // ${restored} SUPPORT UNIT(S) ONLINE`);
      return { ok: true, msg: `AUX RESTORED (${restored} ONLINE)` };
    }
  }

  public expandReactorBus(): { ok: boolean; msg: string } {
    if (this.maxReactorKw >= PERIMETER_CONSTANTS.MAX_REACTOR_KW_HARD_CAP) {
      return { ok: false, msg: 'REACTOR BUS AT HARD CAP (360 kW)' };
    }
    const cost = this.getReactorExpandCost();
    if (this.scrap < cost) {
      return { ok: false, msg: `INSUFFICIENT SCRAP (${cost} REQ)` };
    }
    this.scrap -= cost;
    this.reactorExpansionsBought += 1;
    this.maxReactorKw = Math.min(
      PERIMETER_CONSTANTS.MAX_REACTOR_KW_HARD_CAP,
      this.maxReactorKw + PERIMETER_CONSTANTS.REACTOR_EXPAND_KW_STEP
    );
    this.audioCb.onUpgradeConfirm(false);
    this.spawnSparks(this.blueprint.coreCenter, 14, '#00F0FF');
    this.pushLog(
      `REACTOR CAPACITOR EXPANDED // MAX CAPACITY ${this.maxReactorKw} kW (-${cost} SCRAP)`
    );
    return { ok: true, msg: `REACTOR +${PERIMETER_CONSTANTS.REACTOR_EXPAND_KW_STEP} kW (${this.maxReactorKw} kW)` };
  }

  public fabricateCoreSeal(): { ok: boolean; msg: string } {
    if (this.phase !== 'TACTICAL_PREP') {
      return { ok: false, msg: 'FABRICATE SEALS BETWEEN WAVES ONLY' };
    }
    if (this.bulkheadSeals >= PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS) {
      return { ok: false, msg: 'ALL 3 CORE SEALS ALREADY INTACT' };
    }
    const cost = PERIMETER_CONSTANTS.SEAL_REBUILD_COST_SCRAP;
    if (this.scrap < cost) {
      return { ok: false, msg: `INSUFFICIENT SCRAP (${cost} REQ)` };
    }
    this.scrap -= cost;
    this.bulkheadSeals = Math.min(PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS, this.bulkheadSeals + 1);
    this.audioCb.onUpgradeConfirm(true);
    this.spawnSparks(this.blueprint.coreCenter, 20, '#44FF77');
    this.pushLog(`CORE SEAL FABRICATED // BULKHEAD SEALS ${this.bulkheadSeals}/3 (-${cost} SCRAP)`);
    return { ok: true, msg: `CORE SEAL RESTORED (${this.bulkheadSeals}/3)` };
  }

  public upgradeTurret(turretId: string, mk3Branch?: Mk3BranchId): { ok: boolean; msg: string } {
    const t = this.turrets.find((u) => u.id === turretId);
    if (!t) return { ok: false, msg: 'UNIT NOT FOUND' };
    if (t.level >= 3) return { ok: false, msg: 'MAX MK-III SPEC INSTALLED' };

    if (t.level === 1) {
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
      this.audioCb.onUpgradeConfirm(false);
      this.spawnSparks(t.pos, 12, '#44FF77');
      this.pushLog(`UPGRADED ${t.callsign} TO MK-II SPEC // -${cost} SCRAP`);
      return { ok: true, msg: `${t.callsign} UPGRADED MK-II` };
    }

    // Level 2 -> Branching MK-III Specialization!
    const chosen: Mk3BranchId = mk3Branch ?? 'A';
    const bSpec = MK3_BRANCH_SPECS[t.kind][chosen];
    if (this.scrap < bSpec.costScrap) {
      return { ok: false, msg: `INSUFFICIENT SCRAP (${bSpec.costScrap} REQ)` };
    }
    if (t.powered && this.getStaticAllocatedKw() + bSpec.extraKw > this.maxReactorKw) {
      return { ok: false, msg: `NEED +${bSpec.extraKw} kW HEADROOM FOR MK-III` };
    }
    this.scrap -= bSpec.costScrap;
    t.level = 3;
    t.mk3Branch = chosen;
    if (t.kind === 'SENTRY_PULSE' && chosen === 'B') {
      t.maxAmmo = 640;
      t.ammo = 640;
      t.rearmTimer = 0;
      this.warnedLowAmmoIds.delete(t.id);
      this.warnedDryIds.delete(t.id);
    }
    this.recomputeRelayLinks();
    this.audioCb.onUpgradeConfirm(true);
    this.spawnSparks(t.pos, 18, '#FFB000');
    this.callouts.push({
      pos: { x: t.pos.x, y: t.pos.y - 26 },
      text: `★ MK-III ${bSpec.code} ★`,
      color: '#FFB000',
      life: 1.8,
      maxLife: 1.8,
    });
    this.pushLog(`SPECIALIZED ${t.callsign} TO MK-III [${bSpec.code}] // -${bSpec.costScrap} SCRAP`);
    return { ok: true, msg: `${t.callsign} MK-III ${bSpec.code}` };
  }

  public scrapTurret(turretId: string): { ok: boolean; msg: string } {
    const idx = this.turrets.findIndex((u) => u.id === turretId);
    if (idx < 0) return { ok: false, msg: 'UNIT NOT FOUND' };
    const t = this.turrets[idx];
    const spec = HARDWARE_SPECS[t.kind];
    let invested = spec.costScrap + (t.level >= 2 ? spec.upgradeCostScrap : 0);
    if (t.level === 3 && t.mk3Branch) {
      invested += MK3_BRANCH_SPECS[t.kind][t.mk3Branch].costScrap;
    }
    const refund = Math.round(invested * 0.65);
    this.scrap += refund;
    this.turrets.splice(idx, 1);
    this.recomputeRelayLinks();
    this.pushLog(`RECYCLED ${t.callsign} // +${refund} SCRAP RECOVERED`);
    return { ok: true, msg: `+${refund} SCRAP` };
  }

  public selectProtocolDraft(protocolId: ProtocolId): { ok: boolean; msg: string } {
    if (this.phase !== 'PROTOCOL_DRAFT') return { ok: false, msg: 'NO PROTOCOL DRAFT ACTIVE' };
    if (!this.protocolDraftChoices.includes(protocolId)) {
      return { ok: false, msg: 'INVALID PROTOCOL CHOICE' };
    }
    const spec = TACTICAL_PROTOCOLS[protocolId];
    this.activeProtocols[protocolId] = (this.activeProtocols[protocolId] ?? 0) + 1;

    if (protocolId === 'AUX_BUS') {
      this.maxReactorKw = Math.min(
        PERIMETER_CONSTANTS.MAX_REACTOR_KW_HARD_CAP,
        this.maxReactorKw + 20
      );
    } else if (protocolId === 'SEAL_FABRICATION') {
      this.bulkheadSeals = Math.min(PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS, this.bulkheadSeals + 1);
    } else if (protocolId === 'BULKHEAD_ARMOR') {
      const newMax = this.getDoorMaxHp();
      for (const ds of this.doors.values()) {
        ds.maxHp = newMax;
        if (ds.welded) ds.hp = Math.min(newMax, ds.hp + Math.round(PERIMETER_CONSTANTS.DOOR_MAX_HP * 0.45));
      }
    }

    this.protocolDraftChoices = [];
    this.phase = 'TACTICAL_PREP';
    this.audioCb.onUpgradeConfirm(true);
    this.pushLog(`★ PROTOCOL INSTALLED: [${spec.code}] ${spec.title} — ${spec.desc} ★`);
    return { ok: true, msg: `PROTOCOL: ${spec.code}` };
  }

  public triggerInstantCommandAbility(
    abilityId: 'FLOODLIGHT' | 'COOLANT_FLUSH'
  ): { ok: boolean; msg: string } {
    if (this.blackoutTimer > 0) {
      return {
        ok: false,
        msg: `REACTOR BLACKOUT (${this.blackoutTimer.toFixed(1)}S)`,
      };
    }
    if (abilityId === 'FLOODLIGHT') {
      if (this.floodlightCooldown > 0) {
        return {
          ok: false,
          msg: `FLOODLIGHT CAPACITORS COOLING (${this.floodlightCooldown.toFixed(1)}S)`,
        };
      }
      if (this.reserveBattery < PERIMETER_CONSTANTS.FLOODLIGHT_BATTERY_COST) {
        return {
          ok: false,
          msg: `NEED ${PERIMETER_CONSTANTS.FLOODLIGHT_BATTERY_COST}% BATTERY (${Math.round(this.reserveBattery)}%)`,
        };
      }
      this.reserveBattery = Math.max(
        0,
        this.reserveBattery - PERIMETER_CONSTANTS.FLOODLIGHT_BATTERY_COST
      );
      this.floodlightCooldown = PERIMETER_CONSTANTS.FLOODLIGHT_COOLDOWN_SEC;
      const dur =
        PERIMETER_CONSTANTS.FLOODLIGHT_DURATION_SEC + this.getProtocolStacks('OPTICS_GAIN') * 4.0;
      this.floodlightTimer = Math.max(this.floodlightTimer, dur);
      this.audioCb.onReactorBreaker(false);
      this.audioCb.onFlarePop(0);
      this.spawnSparks(this.blueprint.coreCenter, 18, '#FFFFFF');
      this.pushLog(`EMERGENCY SECTOR FLOODLIGHT ACTIVE [${dur.toFixed(0)}S MAP-WIDE ILLUMINATION!]`);
      return { ok: true, msg: `FLOODLIGHT ACTIVE (${dur.toFixed(0)}S)` };
    }

    if (abilityId === 'COOLANT_FLUSH') {
      if (this.coolantFlushCooldown > 0) {
        return {
          ok: false,
          msg: `COOLANT MANIFOLD REPRESSURIZING (${this.coolantFlushCooldown.toFixed(1)}S)`,
        };
      }
      const cdBase =
        this.activeMutator === 'THERMAL_SPIKE'
          ? PERIMETER_CONSTANTS.COOLANT_FLUSH_COOLDOWN_SEC * 0.65
          : PERIMETER_CONSTANTS.COOLANT_FLUSH_COOLDOWN_SEC;
      this.coolantFlushCooldown = cdBase;
      this.activeCoolantSurgeTimer = PERIMETER_CONSTANTS.COOLANT_FLUSH_SURGE_SEC;
      let cooledCount = 0;
      for (const t of this.turrets) {
        if (t.heat > 5 || t.thermalLocked) {
          t.heat = Math.max(0, t.heat - 78);
          t.thermalLocked = false;
          t.acidDebuffTimer = 0;
          this.spawnSparks(t.pos, 8, '#9BF8FF');
          cooledCount++;
        }
      }
      this.audioCb.onThermalSteam(0);
      this.pushLog(`EMERGENCY BARREL COOLANT FLUSH // VENTED ${cooledCount} UNIT(S) & CLEARED ACID!`);
      return { ok: true, msg: `COOLANT FLUSHED (${cooledCount} UNITS)` };
    }
    return { ok: false, msg: 'UNKNOWN ABILITY' };
  }

  public triggerCommandAbility(
    abilityId: CommandAbilityId,
    targetPos: Vec2
  ): { ok: boolean; msg: string } {
    if (abilityId === 'FLOODLIGHT' || abilityId === 'COOLANT_FLUSH') {
      return this.triggerInstantCommandAbility(abilityId);
    }

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
      const flareDur =
        PERIMETER_CONSTANTS.FLARE_DURATION_SEC + this.getProtocolStacks('OPTICS_GAIN') * 4.0;
      this.flares.push({
        pos: { ...targetPos },
        radius: PERIMETER_CONSTANTS.FLARE_RADIUS_PX,
        remainingSec: flareDur,
        maxSec: flareDur,
      });
      this.audioCb.onFlarePop(this.panFromVirtualX(targetPos.x));
      this.spawnSparks(targetPos, 14, '#FFFFFF');
      this.pushLog(`M40 STROBE FLARE DEPLOYED // ${flareDur.toFixed(0)}S FULL RANGE & CRIT (0 kW)`);
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
      const ocDur =
        PERIMETER_CONSTANTS.OVERCLOCK_DURATION_SEC +
        this.getProtocolStacks('CAPACITOR_DRIVE') * 2.5;
      this.overclockCooldown = PERIMETER_CONSTANTS.OVERCLOCK_COOLDOWN_SEC;
      this.activeOverclockSurgeTimer = ocDur;
      for (const t of affected) {
        t.overclockTimer = ocDur;
      }
      this.overclocks.push({
        pos: { ...targetPos },
        radius: PERIMETER_CONSTANTS.OVERCLOCK_RADIUS_PX,
        remainingSec: ocDur,
      });
      this.audioCb.onOverclockSurge(this.panFromVirtualX(targetPos.x));
      const overloadNote =
        this.getTotalLoadKw() > this.maxReactorKw
          ? this.reserveBattery > 12
            ? ' — RESERVE BATTERY BUFFERING SURGE!'
            : ' — ⚠ REACTOR OVERLOAD! SHED AUX [X]!'
          : ' — WATCH HEAT!';
      this.pushLog(`OVERCLOCK ENGAGED [${affected.length} UNITS · ${ocDur.toFixed(0)}S]${overloadNote}`);
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
    this.activeMutator = this.currentWaveDef.mutator ?? 'NONE';
    this.sealLostThisWave = false;
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
    const mutTag =
      this.activeMutator !== 'NONE' ? ` [⚠ ${WAVE_MUTATORS[this.activeMutator].label}]` : '';
    this.pushLog(
      `WAVE ${String(this.waveNumber).padStart(2, '0')} INBOUND // ${this.currentWaveDef.title}${mutTag} [${activeVents}]`
    );
  }

  public step(rawDt: number): void {
    if (this.sealLostFlashTimer > 0) {
      this.sealLostFlashTimer = Math.max(0, this.sealLostFlashTimer - rawDt);
    }

    if (
      this.phase === 'BRIEFING' ||
      this.phase === 'PROTOCOL_DRAFT' ||
      this.phase === 'CORE_BREACHED' ||
      this.phase === 'CALLSIGN_ENTRY'
    ) {
      return;
    }

    if (this.tacticalPaused) {
      return;
    }

    const simDt = Math.min(0.08, rawDt) * (this.fastForward2x ? 2.0 : 1.0);

    // 1. Update Ability Cooldowns, Surges, Reserve Battery & Real Reactor Overload / Blackout State!
    if (this.flareCooldown > 0) this.flareCooldown = Math.max(0, this.flareCooldown - simDt);
    if (this.overclockCooldown > 0)
      this.overclockCooldown = Math.max(0, this.overclockCooldown - simDt);
    if (this.coolantFlushCooldown > 0)
      this.coolantFlushCooldown = Math.max(0, this.coolantFlushCooldown - simDt);
    if (this.floodlightCooldown > 0)
      this.floodlightCooldown = Math.max(0, this.floodlightCooldown - simDt);
    if (this.activeFlareSurgeTimer > 0)
      this.activeFlareSurgeTimer = Math.max(0, this.activeFlareSurgeTimer - simDt);
    if (this.activeOverclockSurgeTimer > 0)
      this.activeOverclockSurgeTimer = Math.max(0, this.activeOverclockSurgeTimer - simDt);
    if (this.activeCoolantSurgeTimer > 0)
      this.activeCoolantSurgeTimer = Math.max(0, this.activeCoolantSurgeTimer - simDt);
    if (this.floodlightTimer > 0)
      this.floodlightTimer = Math.max(0, this.floodlightTimer - simDt);
    if (this.overloadWarnCooldown > 0)
      this.overloadWarnCooldown = Math.max(0, this.overloadWarnCooldown - simDt);
    if (this.grateRattleCooldown > 0)
      this.grateRattleCooldown = Math.max(0, this.grateRattleCooldown - simDt);

    if (this.blackoutTimer > 0) {
      this.blackoutTimer = Math.max(0, this.blackoutTimer - simDt);
      this.overloadTimer = 0;
      if (this.blackoutTimer <= 0) {
        this.audioCb.onReactorBreaker(false);
        this.pushLog('REACTOR MAIN BREAKER RESET // PERIMETER POWER RESTORED!');
      }
    } else {
      const currentLoad = this.getTotalLoadKw();
      if (currentLoad > this.maxReactorKw) {
        // Reserve Battery automatically absorbs Overclock/Surge overload until depleted!
        if (this.reserveBattery > 0) {
          this.reserveBattery = Math.max(0, this.reserveBattery - 26 * simDt);
          this.overloadTimer = Math.max(0, this.overloadTimer - simDt * 1.2);
        } else {
          this.overloadTimer += simDt;
          if (this.overloadWarnCooldown <= 0) {
            this.overloadWarnCooldown = 1.25;
            this.audioCb.onLowAmmoAlert(0, this.overloadTimer > 2.4);
            if (this.overloadTimer > 1.4) {
              this.audioCb.onIntercomVoice('overload');
              this.pushLog('⚠ CRITICAL REACTOR OVERLOAD — SHED AUX [X] BEFORE BREAKER TRIPS!');
            }
          }
          if (this.overloadTimer >= PERIMETER_CONSTANTS.REACTOR_OVERLOAD_TRIP_SEC) {
            // MAIN BREAKER TRIP -> 3.5S SECTOR BLACKOUT!
            this.blackoutTimer = PERIMETER_CONSTANTS.REACTOR_BLACKOUT_SEC;
            this.overloadTimer = 0;
            this.activeFlareSurgeTimer = 0;
            this.activeOverclockSurgeTimer = 0;
            this.activeCoolantSurgeTimer = 0;
            this.floodlightTimer = 0;
            for (const t of this.turrets) {
              t.overclockTimer = 0;
            }
            this.audioCb.onReactorBreaker(true);
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
        }
      } else {
        if (this.overloadTimer > 0) {
          this.overloadTimer = Math.max(0, this.overloadTimer - simDt * 2.0);
        }
        // Charge Reactor Reserve Battery from unused free kW headroom during active waves (capped so [F] Flare stays vital!)
        if (this.phase === 'WAVE_ACTIVE' && this.reserveBattery < 100 && this.floodlightTimer <= 0) {
          const freeKw = Math.max(0, this.maxReactorKw - currentLoad);
          const capBoost = 1 + this.getProtocolStacks('CAPACITOR_DRIVE') * 0.5;
          const chargePerSec = (1.15 + Math.min(2.6, (freeKw / 55) * 2.6)) * capBoost;
          this.reserveBattery = Math.min(100, this.reserveBattery + chargePerSec * simDt);
        }
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
              : `BULKHEAD ${ds.def.id} SEAL LOCKED (${this.getActiveSealedDoorCount()}/${this.getMaxDoorSeals()}) // PATH REROUTED`
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
            this.audioCb.onIntercomVoice('grate_breach');
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
    this.stepClaymoresAndEggSacs(simDt);
    this.stepAcidSpits(simDt);
    this.stepTurrets(simDt);
    this.stepHostiles(simDt);
    this.stepVisualParticles(simDt);
    this.stepXenomorphChaosAudio(simDt);
    this.stepMotionTrackerAudio(rawDt);

    // 4. Check Wave Completion
    if (this.phase === 'WAVE_ACTIVE') {
      const anyPending = this.spawnQueue.some((s) => s.remaining > 0);
      if (!anyPending && this.hostiles.length === 0 && this.eggSacs.length === 0) {
        this.completeCurrentWave();
      }
    }
  }

  private spawnHostile(ventId: string, kind: HostileKind, overridePos?: Vec2): void {
    const vent = this.blueprint.vents.find((v) => v.id === ventId) ?? this.blueprint.vents[0];
    const spec = HOSTILE_SPECS[kind];
    // Progressive HP scaling on later waves (gentle ramp Waves 1..10, steeper Endless 11+)
    const hpScale =
      this.waveNumber <= 10
        ? 1 + Math.max(0, this.waveNumber - 1) * 0.1
        : 1.9 + (this.waveNumber - 10) * 0.16;
    const maxHp = Math.round(spec.baseHp * hpScale);
    const jitterX = overridePos ? 0 : (Math.random() - 0.5) * 18;
    const jitterY = overridePos ? 0 : (Math.random() - 0.5) * 18;
    const spawnPos = overridePos
      ? { x: overridePos.x, y: overridePos.y }
      : { x: vent.pos.x + jitterX, y: vent.pos.y + jitterY };

    const entity: HostileEntity = {
      id: this.nextHostileId++,
      kind,
      pos: spawnPos,
      vel: { x: 0, y: 0 },
      heading: 0,
      hp: maxHp,
      maxHp,
      speedPxS: spec.speedPxS * (0.95 + Math.random() * 0.1),
      radiusPx: spec.radiusPx,
      weavePhase: Math.random() * Math.PI * 2,
      blipTimer: 1.4,
      blipPos: { ...spawnPos },
      blipDistM:
        Math.hypot(
          spawnPos.x - this.blueprint.coreCenter.x,
          spawnPos.y - this.blueprint.coreCenter.y
        ) / PERIMETER_CONSTANTS.PX_PER_METER,
      m314SweepTimer: 0,
      tripwireTagTimer: 0,
      cryoSlowTimer: 0,
      cryoDeepFreeze: false,
      napalmBurnTimer: 0,
      stunTimer: 0,
      illuminated: false,
      verified: false,
      batteringDoorId: null,
      abilityCooldown:
        kind === 'SPITTER'
          ? 2.2
          : kind === 'SCREAMER'
            ? 2.5
            : kind === 'CRUSHER'
              ? 4.2
              : kind === 'QUEEN'
                ? 5.0
                : 99,
      chargeTelegraphTimer: 0,
      chargeActiveTimer: 0,
      queenEggStage: 0,
      isBoss: spec.isBoss,
    };

    this.hostiles.push(entity);

    if (kind === 'QUEEN') {
      this.audioCb.onQueenRoar(this.panFromVirtualX(spawnPos.x));
      this.audioCb.onIntercomVoice('queen');
      this.audioCb.onSyncGlitch(0.65);
      this.callouts.push({
        pos: { x: spawnPos.x, y: spawnPos.y - 32 },
        text: '★ MATRIARCH QUEEN DETECTED ★',
        color: '#FF3318',
        life: 2.6,
        maxLife: 2.6,
      });
      this.pushLog(`CRITICAL // XENO MATRIARCH QUEEN BREACHED ${vent.id} [${maxHp} HP]!`);
    } else if (kind === 'CRUSHER') {
      this.audioCb.onQueenRoar(this.panFromVirtualX(spawnPos.x));
      this.callouts.push({
        pos: { x: spawnPos.x, y: spawnPos.y - 28 },
        text: '⚠ JUGGERNAUT CRUSHER ⚠',
        color: '#FFB000',
        life: 2.2,
        maxLife: 2.2,
      });
      this.pushLog(`ALERT // JUGGERNAUT CRUSHER ENTERED ${vent.id} [${maxHp} HP]!`);
    }
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

      const srcTurret = c.sourceTurretId
        ? this.turrets.find((u) => u.id === c.sourceTurretId)
        : undefined;

      for (const h of this.hostiles) {
        if (h.hp <= 0) continue;
        if (Math.hypot(h.pos.x - c.pos.x, h.pos.y - c.pos.y) <= c.radius + h.radiusPx) {
          const thermiteBonus =
            c.isThermite && (h.kind === 'PRAETORIAN' || h.isBoss) ? 1.35 : 1.0;
          h.hp -= c.dps * thermiteBonus * dt;
          h.napalmBurnTimer = 0.65;
          h.lastBurnTurretId = c.sourceTurretId;
          if (h.hp <= 0 && srcTurret) {
            srcTurret.kills += 1;
          }
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

      // Napalm incinerates Queen Egg Sacs before they hatch!
      for (let e = this.eggSacs.length - 1; e >= 0; e--) {
        const sac = this.eggSacs[e];
        if (Math.hypot(sac.pos.x - c.pos.x, sac.pos.y - c.pos.y) <= c.radius + 20) {
          sac.hp -= c.dps * 1.6 * dt;
          if (sac.hp <= 0) {
            this.scrap += 12;
            this.score += Math.round(90 * this.getActiveScoreMultiplier());
            this.audioCb.onAcidSizzle(this.panFromVirtualX(sac.pos.x));
            this.spawnSparks(sac.pos, 10, '#FFB000');
            this.callouts.push({
              pos: { x: sac.pos.x, y: sac.pos.y - 10 },
              text: 'EGG INCINERATED +12S',
              color: '#FFB000',
              life: 1.2,
              maxLife: 1.2,
            });
            this.eggSacs.splice(e, 1);
          }
        }
      }

      // Burn away overlapping corrosive acid pools -> STERILIZED COMBO!
      for (let a = this.acidPools.length - 1; a >= 0; a--) {
        const pool = this.acidPools[a];
        if (Math.hypot(pool.pos.x - c.pos.x, pool.pos.y - c.pos.y) <= c.radius + pool.radius * 0.7) {
          pool.remainingSec -= dt * 4.2;
          if (pool.remainingSec <= 0) {
            const baseScrap = 15 + this.getProtocolStacks('THERMITE_CATALYST') * 20;
            const scrapGain = this.activeMutator === 'ACIDIC_SURGE' ? baseScrap * 2 : baseScrap;
            this.scrap += scrapGain;
            this.score += Math.round(75 * this.getActiveScoreMultiplier());
            this.audioCb.onAcidSizzle(this.panFromVirtualX(pool.pos.x));
            this.spawnSparks(pool.pos, 10, '#FFB000');
            this.callouts.push({
              pos: { x: pool.pos.x, y: pool.pos.y - 10 },
              text: `STERILIZED +${scrapGain}S`,
              color: '#FFB000',
              life: 1.35,
              maxLife: 1.35,
            });
            this.pushLog(`COMBO // NAPALM STERILIZED ACID POOL (+${scrapGain} SCRAP)`);
            this.acidPools.splice(a, 1);
          }
        }
      }
    }

    // Cryo Plumes: chill hostiles, expose Stalkers, cancel Crusher charges, and cool nearby turret barrels!
    for (let i = this.cryoPlumes.length - 1; i >= 0; i--) {
      const p = this.cryoPlumes[i];
      p.remainingSec -= dt;
      if (p.remainingSec <= 0) {
        this.cryoPlumes.splice(i, 1);
        continue;
      }

      for (const h of this.hostiles) {
        if (Math.hypot(h.pos.x - p.pos.x, h.pos.y - p.pos.y) <= p.radius + h.radiusPx) {
          h.cryoSlowTimer = Math.max(h.cryoSlowTimer, p.isDeepFreeze ? 2.1 : 1.35);
          if (p.isDeepFreeze) h.cryoDeepFreeze = true;
          if (h.chargeActiveTimer > 0 || h.chargeTelegraphTimer > 0) {
            h.chargeActiveTimer = 0;
            h.chargeTelegraphTimer = 0;
            h.stunTimer = Math.max(h.stunTimer, 0.7);
          }
        }
      }

      const coolRad = p.radius + (p.isCooler ? 110 : 45);
      const coolMult = p.isCooler ? 46 : 24;
      for (const t of this.turrets) {
        if (Math.hypot(t.pos.x - p.pos.x, t.pos.y - p.pos.y) <= coolRad) {
          t.heat = Math.max(0, t.heat - coolMult * dt);
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

  private stepClaymoresAndEggSacs(dt: number): void {
    // 1. Proximity Claymores: arm in 0.6s, detonate when any hostile steps within trigger radius!
    for (let i = this.claymores.length - 1; i >= 0; i--) {
      const m = this.claymores[i];
      if (m.armTimer > 0) {
        m.armTimer = Math.max(0, m.armTimer - dt);
        continue;
      }
      const triggered = this.hostiles.some(
        (h) =>
          h.hp > 0 &&
          Math.hypot(h.pos.x - m.pos.x, h.pos.y - m.pos.y) <=
            PERIMETER_CONSTANTS.CLAYMORE_TRIGGER_RADIUS_PX + h.radiusPx
      );
      if (!triggered) continue;

      this.claymores.splice(i, 1);
      const pan = this.panFromVirtualX(m.pos.x);
      this.audioCb.onClaymoreBlast(pan);
      this.audioCb.onSyncGlitch(0.32);
      this.spawnSparks(m.pos, 26, '#FFB000');
      this.spawnSparks(m.pos, 12, '#FFFFFF');

      let hits = 0;
      for (const h of this.hostiles) {
        const d = Math.hypot(h.pos.x - m.pos.x, h.pos.y - m.pos.y);
        if (d <= PERIMETER_CONSTANTS.CLAYMORE_BLAST_RADIUS_PX + h.radiusPx) {
          const falloff = 1 - Math.max(0, d / (PERIMETER_CONSTANTS.CLAYMORE_BLAST_RADIUS_PX * 1.4));
          h.hp -= PERIMETER_CONSTANTS.CLAYMORE_DAMAGE * Math.max(0.45, falloff);
          h.stunTimer = Math.max(h.stunTimer, h.isBoss ? 0.45 : 1.15);
          h.chargeActiveTimer = 0;
          hits++;
        }
      }
      // Blast vaporizes nearby acid pools & Queen egg sacs!
      this.acidPools = this.acidPools.filter(
        (p) => Math.hypot(p.pos.x - m.pos.x, p.pos.y - m.pos.y) > PERIMETER_CONSTANTS.CLAYMORE_BLAST_RADIUS_PX
      );
      this.eggSacs = this.eggSacs.filter(
        (s) => Math.hypot(s.pos.x - m.pos.x, s.pos.y - m.pos.y) > PERIMETER_CONSTANTS.CLAYMORE_BLAST_RADIUS_PX
      );
      this.callouts.push({
        pos: { x: m.pos.x, y: m.pos.y - 16 },
        text: `CLAYMORE BLAST ×${hits}`,
        color: '#FFB000',
        life: 1.4,
        maxLife: 1.4,
      });
    }

    // 2. Queen Egg Sacs: hatch into 3 Skitterers after 5.5s unless destroyed!
    for (let i = this.eggSacs.length - 1; i >= 0; i--) {
      const sac = this.eggSacs[i];
      sac.hatchTimer -= dt;
      if (sac.hatchTimer <= 0) {
        this.eggSacs.splice(i, 1);
        this.spawnSparks(sac.pos, 10, '#B8FF3B');
        for (let k = 0; k < 3; k++) {
          this.spawnHostile('VENT-01', 'SKITTERER', {
            x: sac.pos.x + (Math.random() - 0.5) * 24,
            y: sac.pos.y + (Math.random() - 0.5) * 24,
          });
        }
        this.audioCb.onAlienScreech('SWARM', 'SKITTERER', this.panFromVirtualX(sac.pos.x), 0.35);
      }
    }
  }

  private stepAcidSpits(dt: number): void {
    for (let i = this.acidSpits.length - 1; i >= 0; i--) {
      const sp = this.acidSpits[i];
      sp.life -= dt;
      sp.pos.x += sp.vel.x * dt;
      sp.pos.y += sp.vel.y * dt;

      const distTarget = Math.hypot(sp.targetPos.x - sp.pos.x, sp.targetPos.y - sp.pos.y);
      if (sp.life <= 0 || distTarget <= 18) {
        this.acidSpits.splice(i, 1);
        const pan = this.panFromVirtualX(sp.pos.x);
        this.audioCb.onAcidSizzle(pan);
        this.spawnSparks(sp.pos, 10, '#B8FF3B');

        if (sp.targetDoorId) {
          const ds = this.doors.get(sp.targetDoorId);
          if (ds && ds.welded) {
            ds.hp -= 55;
            ds.acidCorrodingTimer = 1.2;
            if (ds.hp <= 0) {
              this.breachWeldedDoor(ds, 'CORRODED BY SPITTER ACID');
            }
          }
        } else if (sp.targetTurretId) {
          const tur = this.turrets.find((t) => t.id === sp.targetTurretId);
          if (tur) {
            tur.acidDebuffTimer = 3.4;
            tur.heat = Math.min(95, tur.heat + 24);
            this.callouts.push({
              pos: { x: tur.pos.x, y: tur.pos.y - 24 },
              text: `${tur.callsign} ACID SPLASH!`,
              color: '#B8FF3B',
              life: 1.3,
              maxLife: 1.3,
            });
          }
        }

        this.acidPools.push({
          pos: { ...sp.pos },
          radius: 58,
          remainingSec: this.activeMutator === 'ACIDIC_SURGE' ? 9.5 : 6.0,
          maxSec: 9.5,
        });
      }
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
      const inRelayFlood =
        !inBlackout &&
        this.turrets.some(
          (t) =>
            t.kind === 'MOTION_RELAY' &&
            t.powered &&
            t.level === 3 &&
            t.mk3Branch === 'A' &&
            t.jammedTimer <= 0 &&
            Math.hypot(h.pos.x - t.pos.x, h.pos.y - t.pos.y) <= 240 + h.radiusPx
        );
      const coreLitRad =
        this.activeMutator === 'GRID_BROWNOUT'
          ? PERIMETER_CONSTANTS.CORE_LIT_RADIUS * 0.52
          : PERIMETER_CONSTANTS.CORE_LIT_RADIUS;
      const inCoreLight =
        !inBlackout &&
        Math.hypot(
          h.pos.x - this.blueprint.coreCenter.x,
          h.pos.y - this.blueprint.coreCenter.y
        ) <= coreLitRad;
      const mapFloodLit = this.floodlightTimer > 0 && !inBlackout;
      const hasSensorReveal =
        inFlare ||
        mapFloodLit ||
        inRelayFlood ||
        h.tripwireTagTimer > 0 ||
        h.cryoSlowTimer > 0 ||
        h.m314SweepTimer > 0;
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
          if (
            !t.powered ||
            t.rearmTimer > 0 ||
            (t.kind !== 'SENTRY_PULSE' && t.kind !== 'INCINERATOR' && t.kind !== 'RAIL_LANCE')
          ) {
            continue;
          }
          const spec = HARDWARE_SPECS[t.kind];
          const rlyMult = t.relayMatrixBoosted ? 1.32 : t.relayBoosted ? 1.24 : 1.0;
          const darkRange =
            spec.rangePx *
            rlyMult *
            (t.level >= 2 ? 1.12 : 1.0) *
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
      if (t.acidDebuffTimer > 0) t.acidDebuffTimer = Math.max(0, t.acidDebuffTimer - dt);
      if (t.jammedTimer > 0) t.jammedTimer = Math.max(0, t.jammedTimer - dt);

      const isOverclocked = t.overclockTimer > 0 && !inBlackout;

      // Passive barrel cooling
      const coolRate = t.level >= 2 ? 16.0 : 11.5;
      if (t.firingFlashTimer <= 0.01) {
        t.heat = Math.max(0, t.heat - coolRate * dt);
      } else {
        t.heat = Math.max(0, t.heat - coolRate * 0.25 * dt);
      }
      if (t.thermalLocked && t.heat <= 32) {
        t.thermalLocked = false;
        this.pushLog(`${t.callsign} BARREL COOLED // TARGET LOCK RESTORED`, false);
      }

      // Tick Mid-Wave Automated Belt-Loader Reload Sequence (offline while reloading!)
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

      // 1. M314 Motion Relay Periodic Pulse Sweep (paused briefly when Screamer-jammed!)
      if (t.kind === 'MOTION_RELAY') {
        if (t.jammedTimer > 0) continue;
        t.pulseTimer -= dt * (isOverclocked ? 1.65 : 1.0);
        if (t.pulseTimer <= 0) {
          t.pulseTimer = t.level === 3 ? 1.25 : 1.55;
          const maxR = spec.rangePx * (t.level >= 2 ? 1.2 : 1.0);
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
          const protoRad = 1 + this.getProtocolStacks('CRYO_SHATTER') * 0.2;
          const isCooler = t.level === 3 && t.mk3Branch === 'B';
          const isDeepFreeze = t.level === 3 && t.mk3Branch === 'A';
          const rPx = spec.rangePx * (t.level >= 2 ? 1.22 : 1.0) * protoRad;
          const hostileNear = this.hostiles.some(
            (h) => Math.hypot(h.pos.x - t.pos.x, h.pos.y - t.pos.y) <= rPx + 48
          );
          const hotTurretNear = this.turrets.some(
            (u) =>
              u.id !== t.id &&
              u.heat > 30 &&
              Math.hypot(u.pos.x - t.pos.x, u.pos.y - t.pos.y) <= rPx + (isCooler ? 110 : 45)
          );
          if (hostileNear || hotTurretNear || this.phase === 'WAVE_ACTIVE') {
            t.pulseTimer = isCooler ? 2.1 : 2.75;
            this.cryoPlumes.push({
              pos: { ...t.pos },
              radius: rPx,
              remainingSec: 2.05,
              maxSec: 2.05,
              isDeepFreeze,
              isCooler,
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

      // 2B. Arc-Shock Coil (Floor Grate Alternative: Chain-Stuns Skitterers & Decloaks Stalkers!)
      if (t.kind === 'SHOCK_COIL') {
        t.pulseTimer -= dt * (isOverclocked ? 1.75 : 1.0) * (t.acidDebuffTimer > 0 ? 0.65 : 1.0);
        if (t.pulseTimer <= 0) {
          const protoRad = 1 + this.getProtocolStacks('CRYO_SHATTER') * 0.2;
          const rPx = spec.rangePx * (t.level >= 2 ? 1.18 : 1.0) * protoRad;
          const inRange = this.hostiles
            .filter((h) => h.hp > 0 && Math.hypot(h.pos.x - t.pos.x, h.pos.y - t.pos.y) <= rPx + h.radiusPx)
            .sort(
              (a, b) =>
                Math.hypot(a.pos.x - t.pos.x, a.pos.y - t.pos.y) -
                Math.hypot(b.pos.x - t.pos.x, b.pos.y - t.pos.y)
            );
          if (inRange.length > 0) {
            const isTesla = t.level === 3 && t.mk3Branch === 'A';
            const isEmp = t.level === 3 && t.mk3Branch === 'B';
            t.pulseTimer = t.level >= 2 ? 1.85 : 2.35;
            t.firingFlashTimer = 0.25;
            const maxChains = isTesla ? 7 : t.level >= 2 ? 5 : 4;
            const targets = inRange.slice(0, maxChains);
            const baseDmg = (t.level >= 2 ? 58 : 42) * (isTesla ? 1.35 : 1.0);
            const pts: Vec2[] = [{ ...t.pos }];
            for (const target of targets) {
              pts.push({ ...target.pos });
              target.hp -= baseDmg;
              if (target.hp <= 0) t.kills += 1;
              const stunDur = isEmp
                ? target.isBoss
                  ? 0.55
                  : 1.25
                : target.isBoss
                  ? 0.22
                  : 0.68;
              target.stunTimer = Math.max(target.stunTimer, stunDur);
              target.tripwireTagTimer = Math.max(target.tripwireTagTimer, 4.0); // Decloaks Stalkers!
              target.chargeActiveTimer = 0;
              target.chargeTelegraphTimer = 0;
              if (target.kind === 'SCREAMER') target.abilityCooldown += 3.5;
              if (isEmp && target.isBoss) target.cryoSlowTimer = Math.max(target.cryoSlowTimer, 2.5);
              this.spawnSparks(target.pos, 5, '#00F0FF');
            }
            this.shockArcs.push({ points: pts, life: 0.22, maxLife: 0.22 });
            this.audioCb.onShockCoil(this.panFromVirtualX(t.pos.x));
          } else {
            t.pulseTimer = 0.25;
          }
        }
        continue;
      }

      if (t.thermalLocked) continue;

      // 3. Directional Combat Turrets (UA 571-C Sentry, M240 Incinerator, M99 Rail-Lance)
      const rlyRangeMult = t.relayMatrixBoosted ? 1.32 : t.relayBoosted ? 1.24 : 1.0;
      const fullRange = spec.rangePx * rlyRangeMult * (t.level >= 2 ? 1.12 : 1.0);
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
        // Rail-Lance prioritizes heavy armor & bosses first!
        const priorityBias =
          t.kind === 'RAIL_LANCE' && (h.isBoss || h.kind === 'PRAETORIAN') ? -450 : 0;
        if (distToCore + priorityBias < bestScore) {
          bestScore = distToCore + priorityBias;
          bestTarget = h;
        }
      }

      // If no hostile in cone, also allow turrets to shoot nearby Queen Egg Sacs!
      let eggTarget: QueenEggSac | null = null;
      if (!bestTarget && this.eggSacs.length > 0 && t.fireCooldown <= 0) {
        for (const sac of this.eggSacs) {
          const dx = sac.pos.x - t.pos.x;
          const dy = sac.pos.y - t.pos.y;
          const dist = Math.hypot(dx, dy);
          if (dist > fullRange + 16) continue;
          const angDiff = Math.abs(this.normalizeAngle(Math.atan2(dy, dx) - t.angle));
          if (angDiff <= spec.coneHalfAngleRad && this.hasLineOfSight(t.pos, sac.pos)) {
            eggTarget = sac;
            break;
          }
        }
      }

      if (eggTarget && !bestTarget && t.fireCooldown <= 0) {
        if (t.kind === 'SENTRY_PULSE' && t.ammo > 0) {
          t.ammo = Math.max(0, t.ammo - 2);
          t.fireCooldown = 0.095;
          t.firingFlashTimer = 0.07;
          eggTarget.hp -= 24;
          const pan = this.panFromVirtualX(t.pos.x);
          this.audioCb.onPulseBurst(pan, isOverclocked, this.distNormFromCore(t.pos), t.level);
          this.tracers.push({
            p1: { x: t.pos.x + Math.cos(t.angle) * 18, y: t.pos.y + Math.sin(t.angle) * 18 },
            p2: { ...eggTarget.pos },
            life: 0.08,
            maxLife: 0.08,
            ricochet: false,
            overclocked: isOverclocked,
          });
          if (eggTarget.hp <= 0) {
            this.eggSacs = this.eggSacs.filter((s) => s.id !== eggTarget!.id);
            this.scrap += 10;
            this.spawnSparks(eggTarget.pos, 10, '#B8FF3B');
          }
        }
        continue;
      }

      if (!bestTarget || t.fireCooldown > 0) continue;

      const heatMutMult = this.activeMutator === 'THERMAL_SPIKE' ? 1.28 : 1.0;
      const acidRofMult = t.acidDebuffTimer > 0 ? 1.45 : 1.0;

      if (t.kind === 'SENTRY_PULSE') {
        if (t.ammo <= 0) {
          t.fireCooldown = 0.42;
          t.dryFireTimer = 0.25;
          const dryPan = this.panFromVirtualX(t.pos.x);
          this.audioCb.onDryFire(dryPan);
          if (!this.warnedDryIds.has(t.id)) {
            this.warnedDryIds.add(t.id);
            this.audioCb.onLowAmmoAlert(dryPan, true);
            this.audioCb.onIntercomVoice('sentry_dry');
            this.lowAmmoReminderTimer = 5.2;
            this.pushLog(`CRITICAL // SENTRY ${t.callsign} DRY [000 RDS] — REARM IMMEDIATELY!`);
          }
          continue;
        }

        const isApSabot = t.level === 3 && t.mk3Branch === 'A';
        const isTwinLink = t.level === 3 && t.mk3Branch === 'B';

        const roundsSpent = Math.min(t.ammo, 2);
        t.ammo -= roundsSpent;
        const baseCd = isTwinLink ? 0.064 : 0.088;
        t.fireCooldown = (isOverclocked ? baseCd * 0.52 : baseCd) * acidRofMult;
        t.firingFlashTimer = 0.075;
        t.heat = Math.min(100, t.heat + (isOverclocked ? 3.6 : 2.6) * heatMutMult);

        const lowThresh = Math.ceil(t.maxAmmo * 0.25);
        if (t.ammo <= 0 && !this.warnedDryIds.has(t.id)) {
          this.warnedDryIds.add(t.id);
          this.audioCb.onLowAmmoAlert(this.panFromVirtualX(t.pos.x), true);
          this.audioCb.onIntercomVoice('sentry_dry');
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
          this.audioCb.onThermalSteam(this.panFromVirtualX(t.pos.x));
          this.pushLog(`SENTRY ${t.callsign} THERMAL LOCK [100% TEMP] — VENTING BARREL!`);
        }

        const pan = this.panFromVirtualX(t.pos.x);
        const distanceNorm = this.distNormFromCore(t.pos);
        this.audioCb.onPulseBurst(pan, isOverclocked, distanceNorm, t.level);
        this.audioCb.onAmmoTick(t.ammo / Math.max(1, t.maxAmmo));

        const darkMiss =
          !bestTarget.illuminated && Math.random() < PERIMETER_CONSTANTS.DARK_CORRIDOR_MISS_CHANCE;
        const duStacks = this.getProtocolStacks('DU_ROUNDS');
        const opticsStacks = this.getProtocolStacks('OPTICS_GAIN');
        const litCrit =
          PERIMETER_CONSTANTS.ILLUMINATED_CRIT_MULT +
          opticsStacks * 0.18 +
          (t.relayMatrixBoosted ? 0.32 : 0);

        let dmg = darkMiss
          ? 0
          : (t.level >= 2 ? 22 : 16.5) *
            (isApSabot ? 1.45 : 1.0) *
            (1 + duStacks * 0.18) *
            (t.relayBoosted ? 1.18 : 1.0) *
            (bestTarget.illuminated ? litCrit : 1.0);
        let ricochet = false;

        if (!darkMiss) {
          // CRYO + PULSE SHATTER Combo (+35%..+85% vs Chilled Heavy Hostiles + Crystalline Crunch Audio!)
          if (
            bestTarget.cryoSlowTimer > 0 &&
            (bestTarget.kind === 'PRAETORIAN' ||
              bestTarget.kind === 'BURSTER' ||
              bestTarget.isBoss)
          ) {
            const shatterBonus =
              (bestTarget.cryoDeepFreeze ? 0.55 : 0.35) +
              this.getProtocolStacks('CRYO_SHATTER') * 0.25;
            dmg *= 1 + shatterBonus;
            this.audioCb.onShatterCrunch(pan);
            this.spawnSparks(bestTarget.pos, 5, '#9BF8FF');
            if (Math.random() < 0.24) {
              this.callouts.push({
                pos: { x: bestTarget.pos.x, y: bestTarget.pos.y - 20 },
                text: `SHATTER +${Math.round(shatterBonus * 100)}%`,
                color: '#9BF8FF',
                life: 0.7,
                maxLife: 0.7,
              });
            }
          }

          // Twin-Link MK-III subtle stopping-power knockback on non-bosses!
          if (isTwinLink && !bestTarget.isBoss && Math.random() < 0.35) {
            const kDx = bestTarget.pos.x - t.pos.x;
            const kDy = bestTarget.pos.y - t.pos.y;
            const kLen = Math.max(1, Math.hypot(kDx, kDy));
            this.pushHostileAlongCorridor(bestTarget, { x: kDx / kLen, y: kDy / kLen }, 14);
          }

          // Heavy Directional Carapace (Praetorian, Crusher, Queen): 70% Frontal Deflection vs Flank Crit!
          if (bestTarget.kind === 'PRAETORIAN' || bestTarget.isBoss) {
            const shotDx = t.pos.x - bestTarget.pos.x;
            const shotDy = t.pos.y - bestTarget.pos.y;
            const shotLen = Math.max(1, Math.hypot(shotDx, shotDy));
            const noseX = Math.cos(bestTarget.heading);
            const noseY = Math.sin(bestTarget.heading);
            const frontalAlignment = (shotDx / shotLen) * noseX + (shotDy / shotLen) * noseY;
            if (frontalAlignment > 0.5) {
              const armorPierce = Math.min(0.9, (isApSabot ? 0.65 : 0) + duStacks * 0.25);
              const defMult = 0.3 + 0.7 * armorPierce;
              dmg *= defMult;
              if (armorPierce < 0.5) {
                ricochet = true;
                this.audioCb.onRicochet(pan);
                this.spawnSparks(bestTarget.pos, 5, '#FFB000');
                if (Math.random() < 0.22) {
                  this.callouts.push({
                    pos: { x: bestTarget.pos.x, y: bestTarget.pos.y - 18 },
                    text: 'RICOCHET',
                    color: '#FFB000',
                    life: 0.55,
                    maxLife: 0.55,
                  });
                }
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
      } else if (t.kind === 'RAIL_LANCE') {
        // M99 Electromagnetic Rail-Lance: Pierces frontal armor & punches straight down the corridor!
        const isOverpen = t.level === 3 && t.mk3Branch === 'A';
        const isCapacitor = t.level === 3 && t.mk3Branch === 'B';
        const baseCd = (t.level >= 2 ? 1.32 : 1.72) * (isCapacitor ? 0.65 : 1.0);
        t.fireCooldown = (isOverclocked ? baseCd * 0.52 : baseCd) * acidRofMult;
        t.firingFlashTimer = 0.24;
        t.heat = Math.min(100, t.heat + (isOverclocked ? 24 : 18) * heatMutMult);
        if (t.heat >= 100) {
          t.thermalLocked = true;
          this.audioCb.onThermalSteam(this.panFromVirtualX(t.pos.x));
          this.pushLog(`RAIL-LANCE ${t.callsign} THERMAL LOCK — COOLING RAILS!`);
        }

        const aimAng = Math.atan2(bestTarget.pos.y - t.pos.y, bestTarget.pos.x - t.pos.x);
        const beamEnd = this.castSightRay(t.pos, aimAng, fullRange);
        const duStacks = this.getProtocolStacks('DU_ROUNDS');
        const opticsStacks = this.getProtocolStacks('OPTICS_GAIN');
        const litMult = bestTarget.illuminated
          ? 1.2 + opticsStacks * 0.18 + (t.relayMatrixBoosted ? 0.32 : 0)
          : 1.0;
        const baseDmg =
          (t.level >= 2 ? 155 : 112) *
          (isOverpen ? 1.4 : 1.0) *
          (1 + duStacks * 0.18) *
          litMult;
        const maxPierce = isOverpen ? 99 : t.level >= 2 ? 5 : 4;

        // Gather all hostiles along the sightline ray sorted near-to-far
        const linedUp = this.hostiles
          .filter(
            (h) =>
              h.hp > 0 &&
              this.pointToSegmentDist(h.pos, t.pos, beamEnd) <= h.radiusPx + 14 &&
              this.hasLineOfSight(t.pos, h.pos)
          )
          .sort(
            (a, b) =>
              Math.hypot(a.pos.x - t.pos.x, a.pos.y - t.pos.y) -
              Math.hypot(b.pos.x - t.pos.x, b.pos.y - t.pos.y)
          );

        const pan = this.panFromVirtualX(t.pos.x);
        let pierced = 0;
        for (const h of linedUp) {
          if (pierced >= maxPierce) break;
          let shotDmg = baseDmg * (pierced === 0 ? 1.0 : isOverpen ? 0.92 : 0.78);
          if (h.cryoSlowTimer > 0) {
            shotDmg *= 1.35 + this.getProtocolStacks('CRYO_SHATTER') * 0.25;
            this.audioCb.onShatterCrunch(pan);
          }
          h.hp -= shotDmg;
          if (isCapacitor) {
            h.stunTimer = Math.max(h.stunTimer, h.isBoss ? 0.72 : 1.0);
            h.chargeActiveTimer = 0;
            h.chargeTelegraphTimer = 0;
          }
          if (h.hp <= 0) t.kills += 1;
          this.spawnSparks(h.pos, 8, '#00F0FF');
          pierced++;
        }

        if (pierced >= 3) {
          this.callouts.push({
            pos: { x: bestTarget.pos.x, y: bestTarget.pos.y - 24 },
            text: `RAIL PIERCE ×${pierced}!`,
            color: '#00F0FF',
            life: 1.1,
            maxLife: 1.1,
          });
        }

        this.railBeams.push({
          p1: { x: t.pos.x + Math.cos(aimAng) * 18, y: t.pos.y + Math.sin(aimAng) * 18 },
          p2: beamEnd,
          life: 0.26,
          maxLife: 0.26,
          tier: t.level,
        });
        this.audioCb.onRailLance(pan, t.level, this.distNormFromCore(t.pos));
      } else if (t.kind === 'INCINERATOR') {
        const isThermite = t.level === 3 && t.mk3Branch === 'A';
        const isFirewall = t.level === 3 && t.mk3Branch === 'B';
        t.fireCooldown = (isOverclocked ? 0.34 : 0.62) * acidRofMult;
        t.firingFlashTimer = 0.25;
        t.heat = Math.min(100, t.heat + (isOverclocked ? 22 : 16.5) * heatMutMult);
        if (t.heat >= 100) {
          t.thermalLocked = true;
          this.audioCb.onThermalSteam(this.panFromVirtualX(t.pos.x));
          this.pushLog(`INCINERATOR ${t.callsign} THERMAL LOCK — VENTING CHAMBER!`);
        }

        const rawDist = Math.min(
          fullRange * 0.85,
          Math.hypot(bestTarget.pos.x - t.pos.x, bestTarget.pos.y - t.pos.y)
        );
        const dirAng = Math.atan2(bestTarget.pos.y - t.pos.y, bestTarget.pos.x - t.pos.x);
        const cloudPos = this.castSightRay(t.pos, dirAng, rawDist);
        const thermProto = 1 + this.getProtocolStacks('THERMITE_CATALYST') * 0.3;

        this.napalmClouds.push({
          pos: cloudPos,
          radius: (t.level >= 2 ? 78 : 64) * (isFirewall ? 1.45 : 1.0),
          remainingSec: isFirewall ? 5.2 : 3.4,
          maxSec: isFirewall ? 5.2 : 3.4,
          dps: (t.level >= 2 ? 76 : 56) * (isThermite ? 1.65 : 1.0) * thermProto,
          isThermite,
          sourceTurretId: t.id,
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
        h.kind === 'PRAETORIAN' || h.kind === 'CRUSHER' || h.kind === 'QUEEN'
      );

      // Special Caste Tactical Abilities (Spitter, Screamer, Crusher Charge, Queen Egg Sacs!)
      if (h.abilityCooldown > 0) h.abilityCooldown = Math.max(0, h.abilityCooldown - dt);
      if (h.cryoSlowTimer <= 0) h.cryoDeepFreeze = false;

      if (h.kind === 'SPITTER' && h.abilityCooldown <= 0) {
        // Lob corrosive acid onto nearest welded Blast Door or powered Turret with LOS!
        let spitTargetPos: Vec2 | null = null;
        let spitDoorId: string | undefined;
        let spitTurretId: string | undefined;
        let bestD = 265;
        for (const ds of this.doors.values()) {
          if (!ds.welded) continue;
          const d = Math.hypot(ds.def.center.x - h.pos.x, ds.def.center.y - h.pos.y);
          if (d < bestD && this.hasLineOfSight(h.pos, ds.def.center)) {
            bestD = d;
            spitTargetPos = { ...ds.def.center };
            spitDoorId = ds.def.id;
            spitTurretId = undefined;
          }
        }
        if (!spitTargetPos) {
          for (const tur of this.turrets) {
            if (!tur.powered) continue;
            const d = Math.hypot(tur.pos.x - h.pos.x, tur.pos.y - h.pos.y);
            if (d < bestD && this.hasLineOfSight(h.pos, tur.pos)) {
              bestD = d;
              spitTargetPos = { ...tur.pos };
              spitTurretId = tur.id;
              spitDoorId = undefined;
            }
          }
        }
        if (spitTargetPos) {
          h.abilityCooldown = 4.4;
          const dx = spitTargetPos.x - h.pos.x;
          const dy = spitTargetPos.y - h.pos.y;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const spd = 290;
          this.acidSpits.push({
            id: this.nextHostileId++,
            pos: { ...h.pos },
            targetPos: spitTargetPos,
            vel: { x: (dx / dist) * spd, y: (dy / dist) * spd },
            life: dist / spd + 0.12,
            maxLife: dist / spd + 0.12,
            targetDoorId: spitDoorId,
            targetTurretId: spitTurretId,
          });
          this.audioCb.onAcidSizzle(this.panFromVirtualX(h.pos.x));
        }
      } else if (h.kind === 'SCREAMER' && h.abilityCooldown <= 0) {
        h.abilityCooldown = 4.8;
        let jammedAny = false;
        for (const tur of this.turrets) {
          if (
            tur.kind === 'MOTION_RELAY' &&
            tur.powered &&
            Math.hypot(tur.pos.x - h.pos.x, tur.pos.y - h.pos.y) <= 300
          ) {
            tur.jammedTimer = Math.max(tur.jammedTimer, 3.4);
            jammedAny = true;
          }
        }
        for (let p = 0; p < 3; p++) {
          const ang = Math.random() * Math.PI * 2;
          const rad = 75 + Math.random() * 145;
          this.phantomBlips.push({
            pos: {
              x: Math.max(90, Math.min(PERIMETER_CONSTANTS.VIRTUAL_W - 90, h.pos.x + Math.cos(ang) * rad)),
              y: Math.max(90, Math.min(PERIMETER_CONSTANTS.VIRTUAL_H - 90, h.pos.y + Math.sin(ang) * rad)),
            },
            life: 2.4,
            maxLife: 2.4,
          });
        }
        this.audioCb.onAlienScreech('SWARM', 'SCREAMER', this.panFromVirtualX(h.pos.x), this.distNormFromCore(h.pos));
        if (jammedAny) {
          this.callouts.push({
            pos: { x: h.pos.x, y: h.pos.y - 22 },
            text: 'RADAR JAMMED!',
            color: '#CC66FF',
            life: 1.4,
            maxLife: 1.4,
          });
        }
      } else if (h.kind === 'CRUSHER') {
        if (h.chargeTelegraphTimer > 0) {
          h.chargeTelegraphTimer = Math.max(0, h.chargeTelegraphTimer - dt);
          if (Math.random() < dt * 10) this.spawnSparks(h.pos, 2, '#FFB000');
          if (h.chargeTelegraphTimer <= 0) {
            h.chargeActiveTimer = 1.85;
            this.audioCb.onAlienScreech('SWARM', 'CRUSHER', this.panFromVirtualX(h.pos.x), this.distNormFromCore(h.pos));
          }
          continue; // Pauses briefly during pre-charge telegraph
        }
        if (h.chargeActiveTimer > 0) {
          h.chargeActiveTimer = Math.max(0, h.chargeActiveTimer - dt);
        } else if (h.abilityCooldown <= 0 && h.cryoSlowTimer <= 0 && !nav.batteringDoor) {
          h.abilityCooldown = 6.6;
          h.chargeTelegraphTimer = 1.05;
          this.callouts.push({
            pos: { x: h.pos.x, y: h.pos.y - 28 },
            text: '⚠ CRUSHER CHARGE!',
            color: '#FF5522',
            life: 1.1,
            maxLife: 1.1,
          });
        }
      } else if (h.kind === 'QUEEN') {
        // Threshold Egg Clutches at 75% and 40% HP so every Queen fight forces an egg-burn response!
        const hpRatio = h.hp / Math.max(1, h.maxHp);
        const curStage = h.queenEggStage ?? 0;
        const triggerThresholdClutch =
          (curStage === 0 && hpRatio <= 0.75) || (curStage === 1 && hpRatio <= 0.4);
        if (triggerThresholdClutch && this.eggSacs.length < 8) {
          h.queenEggStage = curStage + 1;
          for (let k = 0; k < 2; k++) {
            const offX = (k === 0 ? -1 : 1) * 20;
            const offY = (Math.random() - 0.5) * 18;
            this.eggSacs.push({
              id: this.nextHostileId++,
              pos: { x: h.pos.x + offX, y: h.pos.y + offY },
              hp: 85,
              maxHp: 85,
              hatchTimer: 5.0,
              maxHatchTimer: 5.0,
            });
          }
          this.audioCb.onAlienScreech(
            'SWARM',
            'QUEEN',
            this.panFromVirtualX(h.pos.x),
            this.distNormFromCore(h.pos)
          );
          this.spawnSparks(h.pos, 16, '#B8FF3B');
          this.callouts.push({
            pos: { x: h.pos.x, y: h.pos.y - 34 },
            text: '★ EGG CLUTCH LAID — BURN THEM! ★',
            color: '#C8FF44',
            life: 2.0,
            maxLife: 2.0,
          });
          this.pushLog('ALERT // MATRIARCH QUEEN LAID EGG CLUTCH — INCINERATE BEFORE HATCH!');
        } else if (h.abilityCooldown <= 0 && this.eggSacs.length < 7) {
          h.abilityCooldown = 7.2;
          this.eggSacs.push({
            id: this.nextHostileId++,
            pos: { x: h.pos.x, y: h.pos.y },
            hp: 85,
            maxHp: 85,
            hatchTimer: 5.5,
            maxHatchTimer: 5.5,
          });
          this.spawnSparks(h.pos, 10, '#B8FF3B');
          this.callouts.push({
            pos: { x: h.pos.x, y: h.pos.y - 30 },
            text: 'EGG SAC LAID!',
            color: '#B8FF3B',
            life: 1.5,
            maxLife: 1.5,
          });
        }
      }

      if (nav.batteringDoor) {
        h.batteringDoorId = nav.batteringDoor.def.id;
        h.heading = Math.atan2(
          nav.batteringDoor.def.center.y - h.pos.y,
          nav.batteringDoor.def.center.x - h.pos.x
        );
        const spec = HOSTILE_SPECS[h.kind];
        const slowFactor = h.cryoSlowTimer > 0 ? (h.cryoDeepFreeze ? 0.28 : 0.45) : 1.0;
        const chargeBonus = h.chargeActiveTimer > 0 ? 2.4 : 1.0;
        nav.batteringDoor.hp -= spec.doorDps * slowFactor * chargeBonus * dt;
        nav.batteringDoor.underAttackTimer = 0.28;

        if (nav.batteringDoor.hp > 0 && nav.batteringDoor.hp < nav.batteringDoor.maxHp * 0.3) {
          this.audioCb.onIntercomVoice('door_failing');
        }

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

      const speedMult =
        (h.cryoSlowTimer > 0 ? (h.cryoDeepFreeze ? 0.28 : 0.42) : 1.0) *
        (h.chargeActiveTimer > 0 ? 2.55 : 1.0);
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
    const salvageMult = 1 + this.getProtocolStacks('SALVAGE_BONUS') * 0.22;
    const scrapGain = Math.max(1, Math.round(spec.scrapReward * salvageMult));
    const scoreGain = Math.round(spec.scoreValue * this.getActiveScoreMultiplier());
    this.totalKills += 1;
    this.scrap += scrapGain;
    this.score += scoreGain;
    this.spawnSparks(
      h.pos,
      h.isBoss ? 28 : h.kind === 'PRAETORIAN' ? 14 : 6,
      h.isBoss ? '#FFB000' : '#44FF77'
    );

    if (h.kind === 'QUEEN' || h.kind === 'CRUSHER') {
      this.audioCb.onQueenRoar(this.panFromVirtualX(h.pos.x));
      this.audioCb.onSyncGlitch(0.55);
      this.callouts.push({
        pos: { x: h.pos.x, y: h.pos.y - 26 },
        text: `★ ${h.kind} KILLED +${scrapGain}S ★`,
        color: '#FFB000',
        life: 2.2,
        maxLife: 2.2,
      });
      this.pushLog(`★ ${spec.name} NEUTRALIZED! (+${scrapGain} SCRAP // +${scoreGain} PTS)`);
    } else {
      const deathChance =
        h.kind === 'PRAETORIAN'
          ? 1.0
          : h.kind === 'BURSTER' || h.kind === 'STALKER' || h.kind === 'SPITTER' || h.kind === 'SCREAMER'
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
    }

    // Acid Burster detonates into a corrosive vector hazard pool on death!
    if (h.kind === 'BURSTER' || (h.kind === 'SPITTER' && this.activeMutator === 'ACIDIC_SURGE')) {
      const surge = this.activeMutator === 'ACIDIC_SURGE';
      this.acidPools.push({
        pos: { ...h.pos },
        radius: surge ? 104 : 88,
        remainingSec: surge ? 12.0 : 9.0,
        maxSec: surge ? 12.0 : 9.0,
      });
      this.audioCb.onAcidSizzle(this.panFromVirtualX(h.pos.x));
      this.spawnSparks(h.pos, 12, '#B8FF3B');
    }
  }

  private handleCoreSealBreach(breacher: HostileEntity): void {
    this.bulkheadSeals = Math.max(0, this.bulkheadSeals - 1);
    this.sealLostThisWave = true;
    this.perfectWaveStreak = 0;
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

  public rollProtocolDraftChoices(): ProtocolId[] {
    const allIds = Object.keys(TACTICAL_PROTOCOLS) as ProtocolId[];
    const eligible = allIds.filter((id) => {
      if (id === 'SEAL_FABRICATION') {
        return this.bulkheadSeals < PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS;
      }
      if (id === 'AUX_BUS' && this.maxReactorKw >= PERIMETER_CONSTANTS.MAX_REACTOR_KW_HARD_CAP) {
        return false;
      }
      return this.getProtocolStacks(id) < TACTICAL_PROTOCOLS[id].maxStacks;
    });
    const shuffled = [...eligible].sort(() => Math.random() - 0.5);
    const chosen = shuffled.slice(0, 3);
    while (chosen.length < 3) {
      chosen.push('SALVAGE_BONUS');
    }
    return chosen;
  }

  private completeCurrentWave(): void {
    if (!this.sealLostThisWave) {
      this.perfectWaveStreak += 1;
    }
    const salvageMult = 1 + this.getProtocolStacks('SALVAGE_BONUS') * 0.22;
    const bonus = Math.round(this.currentWaveDef.scrapBonus * salvageMult);
    const wavePts = Math.round(
      (this.waveNumber * 500 + this.bulkheadSeals * 250) * this.getActiveScoreMultiplier()
    );
    this.scrap += bonus;
    this.score += wavePts;
    this.audioCb.onWaveClear();

    // Cleanly finalize any in-progress mid-wave reloads/welds & reset overload between waves
    this.overloadTimer = 0;
    this.blackoutTimer = 0;
    this.grateTelegraphs = [];
    this.acidSpits = [];
    this.phantomBlips = [];
    for (const t of this.turrets) {
      t.acidDebuffTimer = 0;
      t.jammedTimer = 0;
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

    if (this.waveNumber % 2 === 0 && this.maxReactorKw < PERIMETER_CONSTANTS.AUTO_REACTOR_KW_CAP) {
      this.maxReactorKw = Math.min(PERIMETER_CONSTANTS.AUTO_REACTOR_KW_CAP, this.maxReactorKw + 15);
      this.pushLog(`AUXILIARY REACTOR BUS UNLOCKED // MAX CAPACITY NOW ${this.maxReactorKw} kW!`);
    }

    if (this.waveNumber % 10 === 0) {
      const milestoneBonus = this.bulkheadSeals * 1500;
      this.score += milestoneBonus;
      this.pushLog(
        `★ MILESTONE // WAVE ${String(this.waveNumber).padStart(2, '0')} MATRIARCH SURVIVED (+${milestoneBonus.toLocaleString()} PTS) ★`
      );
    }

    const clearedWave = this.waveNumber;
    this.pushLog(
      `WAVE ${String(clearedWave).padStart(2, '0')} CLEARED // +${bonus} SCRAP · STREAK ${this.getStreakMultiplier().toFixed(2)}X`
    );
    this.waveNumber += 1;
    this.currentWaveDef = Sector01Blueprint.getWaveDefinition(this.waveNumber);
    this.activeMutator = this.currentWaveDef.mutator ?? 'NONE';
    this.purgeAvailableThisWave = true;

    // Trigger MU-TH-UR 3-Choice Tactical Protocol Draft every 3 waves!
    if (clearedWave % 3 === 0) {
      this.protocolDraftChoices = this.rollProtocolDraftChoices();
      this.phase = 'PROTOCOL_DRAFT';
      this.audioCb.onIntercomVoice('protocol');
      this.pushLog('★ MU-TH-UR TACTICAL PROTOCOL DRAFT READY — SELECT 1 DIRECTIVE [1 / 2 / 3] ★');
    } else {
      this.phase = 'TACTICAL_PREP';
    }
  }

  private stepVisualParticles(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      this.tracers[i].life -= dt;
      if (this.tracers[i].life <= 0) this.tracers.splice(i, 1);
    }
    for (let i = this.railBeams.length - 1; i >= 0; i--) {
      this.railBeams[i].life -= dt;
      if (this.railBeams[i].life <= 0) this.railBeams.splice(i, 1);
    }
    for (let i = this.shockArcs.length - 1; i >= 0; i--) {
      this.shockArcs[i].life -= dt;
      if (this.shockArcs[i].life <= 0) this.shockArcs.splice(i, 1);
    }
    for (let i = this.phantomBlips.length - 1; i >= 0; i--) {
      this.phantomBlips[i].life -= dt;
      if (this.phantomBlips[i].life <= 0) this.phantomBlips.splice(i, 1);
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
    let closeSwarmCount = 0;
    for (const h of this.hostiles) {
      if (h.blipTimer <= 0 && !h.verified) continue;
      const d = Math.hypot(
        h.pos.x - this.blueprint.coreCenter.x,
        h.pos.y - this.blueprint.coreCenter.y
      );
      if (d <= 14 * PERIMETER_CONSTANTS.PX_PER_METER) {
        closeSwarmCount++;
      }
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
      this.audioCb.onMotionPing(distM, 30, this.panFromVirtualX(closestX), closeSwarmCount);
    }
  }

  public getPendingSpawnCount(): number {
    let rem = 0;
    for (const s of this.spawnQueue) {
      rem += Math.max(0, s.remaining);
    }
    return rem;
  }

  public clearPendingSpawns(): void {
    this.spawnQueue = [];
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
