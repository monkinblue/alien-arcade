import type { PerimeterVoiceId } from '../audio/AudioEngine';
import type { Vec2 } from '../types';
import { FlowFieldPathfinder } from './FlowFieldPathfinder';
import {
  applyDynamicBreach,
  createSectorBlueprint,
  getDynamicBreachesForWave,
  getSectorIdForWave,
  getWaveDefinition,
  getWaveHpScale,
} from './SectorCatalog';
import {
  ENDGAME_DIRECTIVES,
  HARDWARE_SPECS,
  HOSTILE_SPECS,
  MK3_BRANCH_SPECS,
  OMEGA_DIRECTIVES,
  PERIMETER_CONSTANTS,
  TACTICAL_PROTOCOLS,
  WAVE_MUTATORS,
  type AcidHazardPool,
  type AcidSpitProjectile,
  type AirlockChamberDef,
  type AirlockPurgeWave,
  type BlastDoorState,
  type BuildToolId,
  type ColonyBlueprint,
  type CommandAbilityId,
  type CoreBreachBlast,
  type CryoPlume,
  type DraftChoiceId,
  type DraftMode,
  type EndgameDirectiveId,
  type FloatingCallout,
  type GrateBreachTelegraph,
  type HostileEntity,
  type HostileKind,
  type Mk3BranchId,
  type MotionSweepWave,
  type NapalmCloud,
  type OmegaDirectiveId,
  type OverclockZone,
  type PerimeterCrtShockwave,
  type PerimeterMode,
  type PerimeterPhase,
  type PhantomBlip,
  type PlacedTurret,
  type ProtocolId,
  type ProximityClaymore,
  type QueenEggSac,
  type RailBeamBolt,
  type SectorId,
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
  onCoreSealBreach(pan: number): void;
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
  hpOverride?: number;
}

const MAX_AUTO_REACTOR_UNLOCKS = 6; // W2, W4, W6, W8, W10, W12 (+15 kW each = +90 kW)

export class PerimeterSimulation {
  public blueprint: ColonyBlueprint;
  public pathfinder: FlowFieldPathfinder;
  public audioCb: SimulationAudioCallbacks;

  public mode: PerimeterMode = 'ENDLESS_SIEGE';
  public phase: PerimeterPhase = 'BRIEFING';
  public trainingMode = false;
  public tacticalPaused = false;
  public fastForward2x = false;

  // Sector Evolution & Dynamic Hull Breach State
  public pendingBreachIds: string[] = [];
  public activeBreachIds: string[] = [];
  public sectorTransitionVersion = 0;
  public onSectorChanged?: (sectorId: SectorId, blueprint: ColonyBlueprint) => void;

  // Economy & Core Health
  public scrap: number = PERIMETER_CONSTANTS.INITIAL_SCRAP;
  public maxReactorKw: number = PERIMETER_CONSTANTS.BASE_REACTOR_KW;
  public autoReactorUnlocks = 0;
  public bulkheadSeals: number = PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS;
  public sealLostFlashTimer = 0;
  public sealConcussionFlashTimer = 0;
  public screenShake = 0;
  public crtShockwaves: PerimeterCrtShockwave[] = [];
  public coreBreachBlasts: CoreBreachBlast[] = [];
  public aegisBarrierReady = false;
  public aegisBarrierCharges = 0;
  public aegisRechargeWavesRemaining = 0;

  // Score & Wave Progression
  public waveNumber = 1;
  public currentWaveDef: WaveDefinition;
  public totalKills = 0;
  public score = 0;
  /** True when this Ranked Endless Siege launched in 1979 CRT Mode (grants baseline 1.5x score!) */
  public ranked1979Bonus = false;
  public prepCountdownSec = 0;

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
  public purgeChargesRemaining = 1;
  public purgeAvailableThisWave = true;
  public claymoresRemainingThisWave: number = PERIMETER_CONSTANTS.CLAYMORE_STOCK_PER_WAVE;
  public resupplyPurchasesThisWave = 0;
  public activeFlareSurgeTimer = 0;
  public activeOverclockSurgeTimer = 0;
  public activeCoolantSurgeTimer = 0;
  public floodlightTimer = 0;
  public reserveBattery = 25;
  public auxShedActive = false;
  public auxShedTurretIds: string[] = [];
  public reactorExpansionsBought = 0;
  public overloadTimer = 0;
  public blackoutTimer = 0;

  // Roguelike Protocol Drafts, Omega Directives, Endgame Directives & Mutators
  public draftMode: DraftMode = 'PROTOCOL';
  public activeProtocols: Partial<Record<ProtocolId, number>> = {};
  public activeOmegas: OmegaDirectiveId[] = [];
  public activeEndgameDirectives: Partial<Record<EndgameDirectiveId, number>> = {};
  public protocolDraftChoices: DraftChoiceId[] = [];
  public omegaDraftChoices: OmegaDirectiveId[] = [];
  public draftRerollsUsedThisDraft = 0;
  public paidRerollsUsedThisDraft = 0;
  public freeDraftRerollsRemaining = 0;
  public activeMutator: WaveMutatorId = 'NONE';
  public perfectWaveStreak = 0;
  private sealLostThisWave = false;
  private pendingProtocolDraftAfterOmega = false;

  // Event Log Stream
  public eventLogs: string[] = [];

  // Internal counters & transient per-tick caches
  private nextHostileId = 1;
  private scrapFraction = 0;
  private callsignCounters: Record<TurretKind, number> = {
    SENTRY_PULSE: 0,
    INCINERATOR: 0,
    RAIL_LANCE: 0,
    CRYO_VALVE: 0,
    SHOCK_COIL: 0,
    MOTION_RELAY: 0,
  };
  private spawnQueue: PendingSpawnCursor[] = [];
  private congestionGrid: Float32Array;
  private hazardMask: Uint8Array;
  private congestionRecomputeTimer = 1.0;
  private cryoCoolerBuffedTurretIds = new Set<string>();
  private relayFloodHostileIds = new Set<number>();
  private acidSpitOwners = new Map<number, number>();
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
    this.blueprint = createSectorBlueprint('SEC-01');
    this.pathfinder = new FlowFieldPathfinder(this.blueprint);
    const totalCells = this.blueprint.cols * this.blueprint.rows;
    this.congestionGrid = new Float32Array(totalCells);
    this.hazardMask = new Uint8Array(totalCells);
    this.currentWaveDef = getWaveDefinition(1, 'SEC-01');
    this.resetRun('ENDLESS_SIEGE', true);
  }

  public resetRun(
    mode: PerimeterMode = 'ENDLESS_SIEGE',
    showBriefing = false,
    ranked1979Bonus = false
  ): void {
    this.mode = mode;
    this.phase = showBriefing ? 'BRIEFING' : 'TACTICAL_PREP';
    this.trainingMode = false;
    this.ranked1979Bonus = Boolean(ranked1979Bonus);
    this.tacticalPaused = false;
    this.fastForward2x = false;

    // Fresh mutable SEC-01 blueprint so dynamic breaches never bleed across runs
    this.blueprint = createSectorBlueprint('SEC-01');
    this.pathfinder = new FlowFieldPathfinder(this.blueprint);
    const totalCells = this.blueprint.cols * this.blueprint.rows;
    this.congestionGrid = new Float32Array(totalCells);
    this.hazardMask = new Uint8Array(totalCells);
    this.congestionRecomputeTimer = 1.0;
    this.pendingBreachIds = [];
    this.activeBreachIds = [];
    this.sectorTransitionVersion += 1;

    this.scrap = PERIMETER_CONSTANTS.INITIAL_SCRAP;
    this.scrapFraction = 0;
    this.maxReactorKw = PERIMETER_CONSTANTS.BASE_REACTOR_KW;
    this.autoReactorUnlocks = 0;
    this.bulkheadSeals = PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS;
    this.sealLostFlashTimer = 0;
    this.aegisBarrierReady = false;
    this.aegisBarrierCharges = 0;
    this.aegisRechargeWavesRemaining = 0;

    this.waveNumber = 1;
    this.currentWaveDef = getWaveDefinition(1, this.blueprint.sectorId);
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
    this.crtShockwaves = [];
    this.coreBreachBlasts = [];
    this.screenShake = 0;
    this.sealConcussionFlashTimer = 0;
    this.spawnQueue = [];
    this.cryoCoolerBuffedTurretIds.clear();
    this.relayFloodHostileIds.clear();
    this.acidSpitOwners.clear();

    this.flareCooldown = 0;
    this.overclockCooldown = 0;
    this.coolantFlushCooldown = 0;
    this.floodlightCooldown = 0;
    this.purgeChargesRemaining = 1;
    this.purgeAvailableThisWave = true;
    this.claymoresRemainingThisWave = PERIMETER_CONSTANTS.CLAYMORE_STOCK_PER_WAVE;
    this.resupplyPurchasesThisWave = 0;
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

    this.draftMode = 'PROTOCOL';
    this.activeProtocols = {};
    this.activeOmegas = [];
    this.activeEndgameDirectives = {};
    this.protocolDraftChoices = [];
    this.omegaDraftChoices = [];
    this.draftRerollsUsedThisDraft = 0;
    this.paidRerollsUsedThisDraft = 0;
    this.freeDraftRerollsRemaining = 0;
    this.activeMutator = 'NONE';
    this.perfectWaveStreak = 0;
    this.sealLostThisWave = false;
    this.pendingProtocolDraftAfterOmega = false;

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

    this.initDoorsFromBlueprint();
    this.pathfinder.recompute(this.blueprint, this.doors);
    this.refreshPendingBreaches();
    this.onSectorChanged?.(this.blueprint.sectorId, this.blueprint);

    this.eventLogs = [
      `LOG> ENDLESS HIVE SIEGE ONLINE // ${this.blueprint.sectorId}: ${this.blueprint.sectorName}`,
      `LOG> REACTOR BUS: ${this.maxReactorKw} kW // ORDNANCE SCRAP: ${this.scrap} // CORE SEALS: 3/3`,
      'LOG> HOLD REACTOR CORE AGAINST ENDLESS WAVES — DEPLOY [1-8] & ENGAGE WAVE 01.',
    ];
  }

  private initDoorsFromBlueprint(): void {
    this.doors.clear();
    const maxHp = this.getDoorMaxHp();
    for (const def of this.blueprint.blastDoors) {
      this.doors.set(def.id, {
        def,
        welded: false,
        hp: 0,
        maxHp,
        underAttackTimer: 0,
        acidCorrodingTimer: 0,
        weldingTimer: 0,
        weldingDuration: PERIMETER_CONSTANTS.DOOR_MIDWAVE_WELD_SEC,
        repairCooldown: 0,
        lastPathHpBand: 4,
      });
    }
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

  public hasOmega(id: OmegaDirectiveId): boolean {
    return this.activeOmegas.includes(id);
  }

  public getEndgameStacks(id: EndgameDirectiveId): number {
    return this.activeEndgameDirectives[id] ?? 0;
  }

  public getMaxDoorSeals(): number {
    return PERIMETER_CONSTANTS.MAX_ACTIVE_DOOR_SEALS + this.getProtocolStacks('BULKHEAD_ARMOR');
  }

  public getDoorMaxHp(): number {
    return Math.round(
      PERIMETER_CONSTANTS.DOOR_MAX_HP * (1 + this.getProtocolStacks('BULKHEAD_ARMOR') * 0.5)
    );
  }

  public getClaymoreStockPerWave(): number {
    return PERIMETER_CONSTANTS.CLAYMORE_STOCK_PER_WAVE + (this.hasOmega('BREACH_SAPPER') ? 4 : 0);
  }

  public getClaymoreMaxActive(): number {
    return PERIMETER_CONSTANTS.CLAYMORE_MAX_ACTIVE + (this.hasOmega('BREACH_SAPPER') ? 4 : 0);
  }

  public getSentryMaxAmmo(t: PlacedTurret): number {
    const base =
      t.level === 3 && t.mk3Branch === 'B' ? 640 : t.level >= 2 ? 440 : HARDWARE_SPECS.SENTRY_PULSE.maxAmmo;
    const autoStacks = this.getProtocolStacks('AUTOLOADER');
    return Math.round(base * (1 + autoStacks * 0.2));
  }

  public getStreakMultiplier(): number {
    return Math.round((1.0 + Math.min(1.5, this.perfectWaveStreak * 0.25)) * 100) / 100;
  }

  public getActiveScoreMultiplier(): number {
    const mut = WAVE_MUTATORS[this.activeMutator]?.scoreMult ?? 1.0;
    const telemetryMult = 1 + this.getEndgameStacks('COMBAT_TELEMETRY') * 0.15;
    const crt1979Mult = this.ranked1979Bonus && !this.trainingMode ? 1.5 : 1.0;
    return this.getStreakMultiplier() * mut * telemetryMult * crt1979Mult;
  }

  public getEffectiveMaxReactorCap(): number {
    return Math.min(
      PERIMETER_CONSTANTS.MAX_REACTOR_KW_HARD_CAP,
      PERIMETER_CONSTANTS.SCRAP_REACTOR_KW_HARD_CAP + this.getProtocolStacks('AUX_BUS') * 20
    );
  }

  public getReactorExpandCost(): number {
    return (
      PERIMETER_CONSTANTS.REACTOR_EXPAND_BASE_COST +
      this.reactorExpansionsBought * PERIMETER_CONSTANTS.REACTOR_EXPAND_STEP_COST
    );
  }

  public getMk4RefitCost(t: PlacedTurret): number | null {
    if (t.level < 3 || t.mk4Level >= PERIMETER_CONSTANTS.MK4_REFIT_COSTS.length) {
      return null;
    }
    return PERIMETER_CONSTANTS.MK4_REFIT_COSTS[t.mk4Level];
  }

  public getOrdnanceResupplyCost(): number {
    return (
      PERIMETER_CONSTANTS.RESUPPLY_BASE_COST +
      this.resupplyPurchasesThisWave * PERIMETER_CONSTANTS.RESUPPLY_STEP_COST
    );
  }

  public getProtocolRerollCost(): number {
    if (this.freeDraftRerollsRemaining > 0) return 0;
    return (
      PERIMETER_CONSTANTS.PROTOCOL_REROLL_BASE_COST +
      this.paidRerollsUsedThisDraft * PERIMETER_CONSTANTS.PROTOCOL_REROLL_STEP_COST
    );
  }

  public getTurretPowerKw(t: PlacedTurret): number {
    let kw = HARDWARE_SPECS[t.kind].powerKw;
    if (t.level === 3 && t.mk3Branch) {
      kw += MK3_BRANCH_SPECS[t.kind][t.mk3Branch].extraKw;
    }
    kw += (t.mk4Level ?? 0) * PERIMETER_CONSTANTS.MK4_KW_PER_LEVEL;
    return kw;
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

  public getOverclockSurgeKw(): number {
    const capStacks = this.getProtocolStacks('CAPACITOR_DRIVE');
    return Math.round(PERIMETER_CONSTANTS.OVERCLOCK_SURGE_KW * Math.max(0.4, 1 - capStacks * 0.2));
  }

  public getTotalLoadKw(): number {
    if (this.blackoutTimer > 0) return 0;
    let kw = this.getStaticAllocatedKw();
    if (this.activeFlareSurgeTimer > 0) kw += PERIMETER_CONSTANTS.FLARE_SURGE_KW;
    if (this.activeOverclockSurgeTimer > 0) kw += this.getOverclockSurgeKw();
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
   * Awards Scrap with SALVAGE_BONUS (+25%/stack) using a fractional accumulator so small
   * rewards (Skitterers, Eggs, Acid Sterilize) never lose value to rounding.
   */
  private addSalvageScrap(baseAmount: number, applySalvageBonus = true): number {
    const mult = applySalvageBonus ? 1 + this.getProtocolStacks('SALVAGE_BONUS') * 0.25 : 1.0;
    const total = baseAmount * mult + this.scrapFraction;
    const whole = Math.floor(total);
    this.scrapFraction = total - whole;
    if (whole > 0) {
      this.scrap += whole;
    }
    return whole;
  }

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
        if (!this.canPlaceHardwareAt(buildId, c, r).ok) continue;
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

  private getMapWidthPx(): number {
    return this.blueprint.cols * this.blueprint.tileSize;
  }

  private getMapHeightPx(): number {
    return this.blueprint.rows * this.blueprint.tileSize;
  }

  private panFromVirtualX(x: number): number {
    return Math.max(-0.85, Math.min(0.85, (x / Math.max(1, this.getMapWidthPx()) - 0.5) * 1.5));
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
  // PATHFINDING, CONGESTION & DYNAMIC BREACH MANAGEMENT
  // ===========================================================================

  public recomputePathfinder(withCongestion = false): void {
    if (
      withCongestion &&
      this.phase === 'WAVE_ACTIVE' &&
      this.getActiveSealedDoorCount() > 0 &&
      this.hostiles.length >= 10
    ) {
      const cols = this.blueprint.cols;
      const rows = this.blueprint.rows;
      const total = cols * rows;
      const ts = this.blueprint.tileSize;
      this.congestionGrid.fill(0);
      this.hazardMask.fill(0);

      // Count hostiles per cell first, penalizing only genuine crowding (>= 3 hostiles/cell)
      for (const h of this.hostiles) {
        if (h.hp <= 0) continue;
        const c = Math.max(0, Math.min(cols - 1, Math.floor(h.pos.x / ts)));
        const r = Math.max(0, Math.min(rows - 1, Math.floor(h.pos.y / ts)));
        this.congestionGrid[r * cols + c] += 1;
      }
      for (let idx = 0; idx < total; idx++) {
        const count = this.congestionGrid[idx];
        this.congestionGrid[idx] = count >= 3 ? Math.min(2.5, (count - 2) * 0.55) : 0;
      }

      if (this.waveNumber >= 5) {
        const markHazardRadius = (pos: Vec2, radius: number) => {
          const minC = Math.max(0, Math.floor((pos.x - radius) / ts));
          const maxC = Math.min(cols - 1, Math.floor((pos.x + radius) / ts));
          const minR = Math.max(0, Math.floor((pos.y - radius) / ts));
          const maxR = Math.min(rows - 1, Math.floor((pos.y + radius) / ts));
          const r2 = radius * radius;
          for (let r = minR; r <= maxR; r++) {
            const cy = r * ts + ts * 0.5;
            for (let c = minC; c <= maxC; c++) {
              const idx = r * cols + c;
              if (this.hazardMask[idx]) continue;
              const cx = c * ts + ts * 0.5;
              const dx = cx - pos.x;
              const dy = cy - pos.y;
              if (dx * dx + dy * dy <= r2) {
                this.hazardMask[idx] = 1;
                this.congestionGrid[idx] += 0.65;
              }
            }
          }
        };

        for (const p of this.cryoPlumes) {
          markHazardRadius(p.pos, p.radius);
        }
        for (const n of this.napalmClouds) {
          markHazardRadius(n.pos, n.radius);
        }
      }

      this.pathfinder.recompute(this.blueprint, this.doors, this.congestionGrid);
    } else {
      this.pathfinder.recompute(this.blueprint, this.doors);
    }
  }

  public refreshPendingBreaches(): void {
    const opened = new Set(this.activeBreachIds);
    const upcoming = getDynamicBreachesForWave(this.blueprint, this.waveNumber, opened);
    this.pendingBreachIds = upcoming.map((b) => b.id);
    if (upcoming.length > 0 && this.phase !== 'BRIEFING') {
      const labels = upcoming.map((b) => b.label).join(', ');
      this.pushLog(
        `⚠ STRUCTURAL FRACTURE DETECTED [${labels}] — COLLAPSES ON WAVE ${String(this.waveNumber).padStart(2, '0')}!`,
        false
      );
    }
  }

  private getDoorHpBand(ds: BlastDoorState): number {
    const ratio = ds.hp / Math.max(1, ds.maxHp);
    if (ratio > 0.75) return 4;
    if (ratio > 0.5) return 3;
    if (ratio > 0.25) return 2;
    return 1;
  }

  private applyDoorDamage(ds: BlastDoorState, dmg: number, cause: string): void {
    if (!ds.welded || ds.hp <= 0) return;
    ds.hp -= dmg;
    if (ds.hp <= 0) {
      this.breachWeldedDoor(ds, cause);
      return;
    }
    const band = this.getDoorHpBand(ds);
    if (ds.lastPathHpBand === undefined || band < ds.lastPathHpBand) {
      ds.lastPathHpBand = band;
      this.recomputePathfinder(this.phase === 'WAVE_ACTIVE');
    }
  }

  /**
   * P0 #1 Softlock Guard: ejects any hostile occupying a newly welded door's tiles
   * to the nearest passable outer cell (furthest from Core), preventing permanent entombment.
   */
  private ejectHostilesFromDoor(ds: BlastDoorState): void {
    const ts = this.blueprint.tileSize;
    const doorTileSet = new Set(ds.def.tiles.map((t) => t.row * this.blueprint.cols + t.col));
    for (const h of this.hostiles) {
      const hc = Math.floor(h.pos.x / ts);
      const hr = Math.floor(h.pos.y / ts);
      const inDoorTile = doorTileSet.has(hr * this.blueprint.cols + hc);
      const touchingDoor = ds.def.tiles.some((t) => {
        const cx = t.col * ts + ts * 0.5;
        const cy = t.row * ts + ts * 0.5;
        return Math.hypot(h.pos.x - cx, h.pos.y - cy) < ts * 0.52;
      });
      if (!inDoorTile && !touchingDoor) continue;
      this.nudgeHostileToPassableCell(h, true);
    }
  }

  private nudgeHostileToPassableCell(h: HostileEntity, preferOuterFromCore: boolean): void {
    const ts = this.blueprint.tileSize;
    const hc = Math.max(0, Math.min(this.blueprint.cols - 1, Math.floor(h.pos.x / ts)));
    const hr = Math.max(0, Math.min(this.blueprint.rows - 1, Math.floor(h.pos.y / ts)));

    let bestCol = -1;
    let bestRow = -1;
    let bestScore = -Infinity;

    for (let rad = 1; rad <= 3; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          const nc = hc + dc;
          const nr = hr + dr;
          if (!this.pathfinder.isPassableCell(this.blueprint, this.doors, nc, nr)) continue;
          const cx = nc * ts + ts * 0.5;
          const cy = nr * ts + ts * 0.5;
          const distToCore = Math.hypot(
            cx - this.blueprint.coreCenter.x,
            cy - this.blueprint.coreCenter.y
          );
          const distToHostile = Math.hypot(cx - h.pos.x, cy - h.pos.y);
          // Prefer closer ring first, and within the ring prefer outer side away from Core
          const score =
            -rad * 1000 + (preferOuterFromCore ? distToCore * 2.0 : 0) - distToHostile * 0.5;
          if (score > bestScore) {
            bestScore = score;
            bestCol = nc;
            bestRow = nr;
          }
        }
      }
      if (bestCol >= 0) break;
    }

    if (bestCol >= 0) {
      h.pos.x = bestCol * ts + ts * 0.5;
      h.pos.y = bestRow * ts + ts * 0.5;
      h.knockbackTimer = 0;
      h.knockbackVel = undefined;
      h.knockbackMaxTimer = undefined;
    }
  }

  // ===========================================================================
  // PLACEMENT, DOOR WELDING, INSPECTOR ACTIONS & ACTIVE COMMAND ABILITIES
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
      if (this.claymoresRemainingThisWave <= 0) {
        return {
          ok: false,
          reason: `M18 STOCK DEPLETED (0/${this.getClaymoreStockPerWave()} THIS WAVE)`,
        };
      }
      const maxActive = this.getClaymoreMaxActive();
      if (this.claymores.length >= maxActive) {
        return {
          ok: false,
          reason: `MAX ${maxActive} CLAYMORES ACTIVE`,
        };
      }
      if (this.claymores.some((m) => m.col === col && m.row === row)) {
        return { ok: false, reason: 'CLAYMORE ALREADY ARMED ON TILE' };
      }
      const ts = this.blueprint.tileSize;
      const cx = col * ts + ts * 0.5;
      const cy = row * ts + ts * 0.5;
      const blockedByAcid = this.acidPools.some(
        (p) => Math.hypot(p.pos.x - cx, p.pos.y - cy) <= Math.max(60, p.radius * 0.85)
      );
      if (blockedByAcid) {
        return { ok: false, reason: 'CORROSIVE ACID POOL — STERILIZE BEFORE MINING' };
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

    // P0 #10: Strictly block building turrets on SPAWN_GRATE or any active aux spawn vent
    if (
      tileKind === 'SPAWN_GRATE' ||
      this.blueprint.vents.some((v) => v.isAuxGrate && v.col === col && v.row === row)
    ) {
      return { ok: false, reason: 'SUB-FLOOR SPAWN GRATE — NON-BUILDABLE' };
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
        door.welded = true;
        door.weldingTimer = 0;
        door.hp = door.maxHp;
        door.lastPathHpBand = 4;
        door.repairCooldown = 0;
        this.ejectHostilesFromDoor(door);
        this.recomputePathfinder(false);
        this.recomputeRelayLinks();
        this.audioCb.onArcWeld(this.panFromVirtualX(door.def.center.x));
        this.spawnSparks(door.def.center, 14, '#FFB000');
        this.pushLog(
          wasWelded
            ? `REINFORCED BULKHEAD SEAL ${door.def.id} [100% HP]`
            : `ARC-WELDED BULKHEAD ${door.def.id} (${this.getActiveSealedDoorCount()}/${this.getMaxDoorSeals()}) // HOSTILE FLOW REROUTED`
        );
      } else {
        // Mid-wave: 1.5s arc-weld torch sequence!
        const weldSec = PERIMETER_CONSTANTS.DOOR_MIDWAVE_WELD_SEC;
        door.weldingTimer = weldSec;
        door.weldingDuration = weldSec;
        this.audioCb.onArcWeld(this.panFromVirtualX(door.def.center.x));
        this.spawnSparks(door.def.center, 10, '#FFB000');
        this.pushLog(
          wasWelded
            ? `REINFORCING ${door.def.id} [${weldSec.toFixed(1)}S TORCH SEQUENCE]...`
            : `ARC-WELDING ${door.def.id} [${weldSec.toFixed(1)}S TORCH SEQUENCE]...`
        );
      }
      return { ok: true, weldedDoor: door };
    }

    if (buildId === 'CLAYMORE') {
      const spec = HARDWARE_SPECS.CLAYMORE;
      this.scrap -= spec.costScrap;
      this.claymoresRemainingThisWave = Math.max(0, this.claymoresRemainingThisWave - 1);
      const ts = this.blueprint.tileSize;
      const pos: Vec2 = { x: col * ts + ts * 0.5, y: row * ts + ts * 0.5 };
      const armSec =
        this.phase === 'WAVE_ACTIVE'
          ? PERIMETER_CONSTANTS.CLAYMORE_MIDWAVE_ARM_SEC
          : PERIMETER_CONSTANTS.CLAYMORE_PREP_ARM_SEC;
      this.claymores.push({
        id: `mine-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        col,
        row,
        pos,
        armTimer: armSec,
      });
      this.spawnSparks(pos, 8, '#FFB000');
      this.audioCb.onServoStep(this.panFromVirtualX(pos.x));
      this.pushLog(
        `ARMED M18 CLAYMORE [${this.claymoresRemainingThisWave}/${this.getClaymoreStockPerWave()} STOCK LEFT · ${armSec.toFixed(1)}S ARM] // -${spec.costScrap} SCRAP`
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

    const initMaxAmmo =
      buildId === 'SENTRY_PULSE'
        ? Math.round(spec.maxAmmo * (1 + this.getProtocolStacks('AUTOLOADER') * 0.2))
        : spec.maxAmmo;

    const turret: PlacedTurret = {
      id: `turret-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      callsign,
      kind: buildId,
      col,
      row,
      pos,
      powered: true,
      level: 1,
      mk4Level: 0,
      powerUpTimer: 0,
      totalInvestedScrap: spec.costScrap,
      angle: aimAngle,
      targetAngle: aimAngle,
      ammo: initMaxAmmo,
      maxAmmo: initMaxAmmo,
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

  /**
   * P0 #13 Smart Default Aim Angle: points turrets directly toward incoming active open
   * flow routes from outer vents AND sub-floor grates (including North GRATE-01 on W2!).
   */
  public computeDefaultAimAngle(col: number, row: number): number {
    const ts = this.blueprint.tileSize;
    const pos = { x: col * ts + ts * 0.5, y: row * ts + ts * 0.5 };
    const myFlowDist = this.pathfinder.getFlowDistance(col, row, 'standard');

    // Collect cells on all active vent & aux-grate flow routes so turrets naturally guard real traffic
    const routeCellWeights = new Map<number, number>();
    const activeWaveVentIds = new Set(this.currentWaveDef.groups.map((g) => g.ventId));
    for (const vent of this.blueprint.vents) {
      const weight = activeWaveVentIds.has(vent.id) ? 2.0 : vent.isAuxGrate ? 1.15 : 1.35;
      const pts = this.pathfinder.traceRoutePreview(
        this.blueprint,
        this.doors,
        vent.col,
        vent.row,
        'standard'
      );
      for (const pt of pts) {
        const rc = Math.floor(pt.x / ts);
        const rr = Math.floor(pt.y / ts);
        if (rc >= 0 && rc < this.blueprint.cols && rr >= 0 && rr < this.blueprint.rows) {
          const key = rr * this.blueprint.cols + rc;
          routeCellWeights.set(key, (routeCellWeights.get(key) ?? 0) + weight);
        }
      }
    }

    let bestAng = Math.atan2(pos.y - this.blueprint.coreCenter.y, pos.x - this.blueprint.coreCenter.x);
    let bestScore = -1e9;

    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      let clearDist = 0;
      let upstreamBonus = 0;
      let routeBonus = 0;
      const seenCells = new Set<number>();

      // Sample center ray + two narrow flanking rays (±14°) to catch adjacent corridor lanes
      const subAngles = [a, a - 0.24, a + 0.24];
      for (let sIdx = 0; sIdx < subAngles.length; sIdx++) {
        const sa = subAngles[sIdx];
        const rayWeight = sIdx === 0 ? 1.0 : 0.45;
        for (let d = 30; d <= 420; d += 30) {
          const tc = Math.floor((pos.x + Math.cos(sa) * d) / ts);
          const tr = Math.floor((pos.y + Math.sin(sa) * d) / ts);
          if (
            tc >= 0 &&
            tc < this.blueprint.cols &&
            tr >= 0 &&
            tr < this.blueprint.rows &&
            !this.isCellOpaque(tc, tr)
          ) {
            if (sIdx === 0) clearDist = d;
            const cellKey = tr * this.blueprint.cols + tc;
            if (!seenCells.has(cellKey)) {
              seenCells.add(cellKey);
              const cellFlow = this.pathfinder.getFlowDistance(tc, tr, 'standard');
              const rw = routeCellWeights.get(cellKey) ?? 0;
              if (rw > 0) {
                const dirMult = cellFlow >= myFlowDist - 1.2 ? 1.35 : 0.65;
                routeBonus += rw * 52 * dirMult * rayWeight;
              }
              if (cellFlow < 1e8 && myFlowDist < 1e8) {
                if (cellFlow > myFlowDist + 0.5) {
                  upstreamBonus += 32 * rayWeight;
                } else if (cellFlow < myFlowDist - 0.5) {
                  upstreamBonus -= 22 * rayWeight;
                }
              }
            }
          } else {
            break;
          }
        }
      }

      const cardinalBonus = i % 4 === 0 ? 24 : 0;
      const score = Math.min(clearDist, 360) + upstreamBonus + routeBonus + cardinalBonus;
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
          this.blueprint.tiles[r][c] === 'CORE' ||
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
    // Phase 1 Screamer counterplay: jammed or spinning-up M314 Relays lose relayBoosted & relayMatrixBoosted!
    const activeRelays = this.turrets.filter(
      (t) =>
        t.kind === 'MOTION_RELAY' &&
        t.powered &&
        t.powerUpTimer <= 0 &&
        t.jammedTimer <= 0
    );
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
      ds.welded = false;
      ds.hp = 0;
      ds.weldingTimer = 0;
      ds.lastPathHpBand = 4;
      this.recomputePathfinder(this.phase === 'WAVE_ACTIVE');
      this.pushLog(`UNSEALED BULKHEAD DOOR ${ds.def.id} // CORRIDOR OPENED`);
      return { ok: true, msg: `${ds.def.id} UNSEALED` };
    }
    const tile = ds.def.tiles[0];
    const res = this.deployHardware('ARC_WELDER', tile.col, tile.row, 0);
    return {
      ok: res.ok,
      msg:
        res.reason ??
        (this.phase === 'WAVE_ACTIVE'
          ? `${ds.def.id} WELDING (${PERIMETER_CONSTANTS.DOOR_MIDWAVE_WELD_SEC.toFixed(1)}S)...`
          : `${ds.def.id} WELDED`),
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
        (this.phase === 'WAVE_ACTIVE'
          ? `${ds.def.id} REINFORCING (${PERIMETER_CONSTANTS.DOOR_MIDWAVE_WELD_SEC.toFixed(1)}S)...`
          : `${ds.def.id} REINFORCED`),
    };
  }

  public getRearmCostFor(t: PlacedTurret): number {
    if (t.kind !== 'SENTRY_PULSE' || t.ammo >= t.maxAmmo) return 0;
    const missingRatio = (t.maxAmmo - t.ammo) / Math.max(1, t.maxAmmo);
    const autoStacks = this.getProtocolStacks('AUTOLOADER');
    // Phase 2 AUTOLOADER: -45% rearm time AND cost per stack
    const costMult = Math.pow(0.55, autoStacks);
    // Phase 1 Sentry TWIN-LINK rearm tierMult trimmed 1.45 -> 1.25
    const tierMult =
      t.level === 3 && t.mk3Branch === 'B' ? 1.25 : t.level >= 2 ? 1.18 : 1.0;
    return Math.max(
      8,
      Math.round(PERIMETER_CONSTANTS.REARM_COST_SCRAP * tierMult * missingRatio * costMult)
    );
  }

  private getWaveSalvageYieldMult(): number {
    if (this.waveNumber <= 8) return 1.0;
    if (this.waveNumber <= 15) {
      return 1.0 - (this.waveNumber - 8) * 0.068;
    }
    return Math.max(0.25, 0.52 - (this.waveNumber - 15) * 0.03);
  }

  private applyHostileStun(
    h: HostileEntity,
    durationSec: number,
    ignoreImmunity = false
  ): boolean {
    if (durationSec <= 0) return false;
    if (!ignoreImmunity && (h.stunImmuneTimer ?? 0) > 0) {
      return false;
    }
    h.stunTimer = Math.max(h.stunTimer, durationSec);
    const postRecoverySec = h.isBoss ? 2.6 : h.kind === 'PRAETORIAN' ? 1.8 : 1.4;
    h.stunImmuneTimer = Math.max(h.stunImmuneTimer ?? 0, durationSec + postRecoverySec);
    return true;
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
    const dur = Math.max(0.75, PERIMETER_CONSTANTS.REARM_DURATION_SEC * Math.pow(0.55, autoStacks));
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
      // P0 #13: 2.5s mid-wave capacitor spin-up stops zero-latency Pause power-juggling!
      if (this.phase === 'WAVE_ACTIVE') {
        t.powerUpTimer = PERIMETER_CONSTANTS.TURRET_POWER_SPINUP_SEC;
      } else {
        t.powerUpTimer = 0;
      }
      this.recomputeRelayLinks();
      this.pushLog(
        t.powerUpTimer > 0
          ? `${t.callsign} CAPACITOR SPIN-UP [${t.powerUpTimer.toFixed(1)}S · +${reqKw} kW]`
          : `${t.callsign} POWER ONLINE [+${reqKw} kW]`
      );
      return {
        ok: true,
        msg: t.powerUpTimer > 0 ? `${t.callsign} SPINNING UP (${t.powerUpTimer.toFixed(1)}S)` : `${t.callsign} ONLINE`,
      };
    } else {
      t.powered = false;
      t.powerUpTimer = 0;
      this.recomputeRelayLinks();
      this.pushLog(`${t.callsign} STANDBY OFFLINE [-${reqKw} kW FREED]`);
      return { ok: true, msg: `${t.callsign} OFFLINE` };
    }
  }

  /**
   * P0 #13 Smart Priority [X] Shed Aux: sheds lowest-priority auxiliary units ONLY until
   * total reactor load <= maxReactorKw (instead of killing all Cryo/Relays at once).
   */
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

      // Lowest priority shed first: Shock Coil (1) < Non-MK3 Relay (2) < Cryo Valve (3) < MK3 Relay (4)
      const priorityRank = (u: PlacedTurret): number => {
        if (u.kind === 'SHOCK_COIL') return 1;
        if (u.kind === 'MOTION_RELAY' && u.level < 3) return 2;
        if (u.kind === 'CRYO_VALVE') return 3;
        return 4;
      };
      auxUnits.sort(
        (a, b) =>
          priorityRank(a) - priorityRank(b) ||
          a.level - b.level ||
          this.getTurretPowerKw(b) - this.getTurretPowerKw(a)
      );

      const currentOverloadKw = this.getTotalLoadKw() - this.maxReactorKw;
      let freedKw = 0;
      this.auxShedTurretIds = [];
      for (const u of auxUnits) {
        u.powered = false;
        u.powerUpTimer = 0;
        freedKw += this.getTurretPowerKw(u);
        this.auxShedTurretIds.push(u.id);
        // Stop shedding as soon as load <= maxReactorKw (or after shedding 1 unit if pre-shedding)
        if (currentOverloadKw > 0) {
          if (this.getTotalLoadKw() <= this.maxReactorKw) break;
        } else {
          break;
        }
      }
      this.auxShedActive = this.auxShedTurretIds.length > 0;
      this.recomputeRelayLinks();
      this.audioCb.onServoStep(0);
      this.pushLog(
        `SMART AUX SHED // ${this.auxShedTurretIds.length} LOW-PRIORITY UNIT(S) OFFLINE (-${freedKw} kW)`
      );
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
            if (this.phase === 'WAVE_ACTIVE') {
              u.powerUpTimer = PERIMETER_CONSTANTS.TURRET_POWER_SPINUP_SEC;
            }
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
    const cap = this.getEffectiveMaxReactorCap();
    if (this.maxReactorKw >= cap) {
      const hint =
        cap < PERIMETER_CONSTANTS.MAX_REACTOR_KW_HARD_CAP
          ? `SCRAP CAP (${cap} kW) — DRAFT +20kW BUS FOR UP TO ${PERIMETER_CONSTANTS.MAX_REACTOR_KW_HARD_CAP} kW`
          : `REACTOR BUS AT HARD CAP (${cap} kW)`;
      return { ok: false, msg: hint };
    }
    const cost = this.getReactorExpandCost();
    if (this.scrap < cost) {
      return { ok: false, msg: `INSUFFICIENT SCRAP (${cost} REQ)` };
    }
    this.scrap -= cost;
    this.reactorExpansionsBought += 1;
    this.maxReactorKw = Math.min(cap, this.maxReactorKw + PERIMETER_CONSTANTS.REACTOR_EXPAND_KW_STEP);
    this.audioCb.onUpgradeConfirm(false);
    this.spawnSparks(this.blueprint.coreCenter, 14, '#00F0FF');
    this.pushLog(
      `REACTOR CAPACITOR EXPANDED // MAX CAPACITY ${this.maxReactorKw}/${cap} kW (-${cost} SCRAP)`
    );
    return {
      ok: true,
      msg: `REACTOR +${PERIMETER_CONSTANTS.REACTOR_EXPAND_KW_STEP} kW (${this.maxReactorKw} kW)`,
    };
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
    if (t.level >= 3) return { ok: false, msg: 'MAX MK-III SPEC INSTALLED — USE MK-IV REFIT' };

    if (t.level === 1) {
      const cost = HARDWARE_SPECS[t.kind].upgradeCostScrap;
      if (this.scrap < cost) return { ok: false, msg: `INSUFFICIENT SCRAP (${cost} REQ)` };
      this.scrap -= cost;
      t.level = 2;
      t.totalInvestedScrap += cost;
      if (t.kind === 'SENTRY_PULSE') {
        t.maxAmmo = this.getSentryMaxAmmo(t);
        t.ammo = t.maxAmmo;
        t.rearmTimer = 0;
        this.warnedLowAmmoIds.delete(t.id);
        this.warnedDryIds.delete(t.id);
      }
      this.audioCb.onUpgradeConfirm(false);
      this.spawnSparks(t.pos, 12, '#44FF77');
      this.pushLog(`UPGRADED ${t.callsign} TO MK-II SPEC // -${cost} SCRAP`);
      return { ok: true, msg: `${t.callsign} UPGRADED MK-II` };
    }

    // Level 2 -> Branching MK-III Specialization
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
    t.totalInvestedScrap += bSpec.costScrap;
    if (t.kind === 'SENTRY_PULSE' && chosen === 'B') {
      t.maxAmmo = this.getSentryMaxAmmo(t);
      t.ammo = t.maxAmmo;
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

  /**
   * Phase 2 Late-Game Scrap Sink: MK-IV Overhaul Refits (450/700/1000S -> +10% DMG & +1 kW per level).
   */
  public refitTurretMk4(turretId: string): { ok: boolean; msg: string } {
    const t = this.turrets.find((u) => u.id === turretId);
    if (!t) return { ok: false, msg: 'UNIT NOT FOUND' };
    if (t.level < 3) return { ok: false, msg: 'REQUIRES MK-III SPECIALIZATION FIRST' };
    const cost = this.getMk4RefitCost(t);
    if (cost === null) return { ok: false, msg: 'MAX MK-IV+3 REFIT INSTALLED' };
    if (this.scrap < cost) return { ok: false, msg: `INSUFFICIENT SCRAP (${cost} REQ)` };
    const extraKw = PERIMETER_CONSTANTS.MK4_KW_PER_LEVEL;
    if (t.powered && this.getStaticAllocatedKw() + extraKw > this.maxReactorKw) {
      return { ok: false, msg: `NEED +${extraKw} kW HEADROOM FOR MK-IV REFIT` };
    }
    this.scrap -= cost;
    t.mk4Level += 1;
    t.totalInvestedScrap += cost;
    this.audioCb.onUpgradeConfirm(true);
    this.spawnSparks(t.pos, 16, '#00F0FF');
    this.callouts.push({
      pos: { x: t.pos.x, y: t.pos.y - 26 },
      text: `★ MK-IV+${t.mk4Level} (+${t.mk4Level * 10}% DMG) ★`,
      color: '#00F0FF',
      life: 1.6,
      maxLife: 1.6,
    });
    this.pushLog(
      `MK-IV OVERHAUL REFIT ${t.callsign} [TIER ${t.mk4Level}/3 · +${t.mk4Level * 10}% DMG · +${extraKw} kW] // -${cost} SCRAP`
    );
    return { ok: true, msg: `${t.callsign} MK-IV+${t.mk4Level}` };
  }

  /**
   * Phase 2 Late-Game Scrap Sink: Tactical Ordnance Resupply (250S + 100S/use per wave).
   */
  public purchaseOrdnanceResupply(kind: 'PURGE' | 'CLAYMORES'): { ok: boolean; msg: string } {
    const cost = this.getOrdnanceResupplyCost();
    if (this.scrap < cost) {
      return { ok: false, msg: `INSUFFICIENT SCRAP (${cost} REQ)` };
    }
    this.scrap -= cost;
    this.resupplyPurchasesThisWave += 1;
    if (kind === 'PURGE') {
      this.purgeChargesRemaining += 1;
      this.purgeAvailableThisWave = true;
      this.audioCb.onUpgradeConfirm(false);
      this.spawnSparks(this.blueprint.coreCenter, 14, '#8EF5AB');
      this.pushLog(
        `ORDNANCE RESUPPLY // +1 AIRLOCK PURGE CHARGE (${this.purgeChargesRemaining} READY) // -${cost} SCRAP`
      );
      return { ok: true, msg: `+1 PURGE CHARGE (${this.purgeChargesRemaining} READY)` };
    } else {
      this.claymoresRemainingThisWave += 6;
      this.audioCb.onUpgradeConfirm(false);
      this.spawnSparks(this.blueprint.coreCenter, 14, '#FFB000');
      this.pushLog(
        `ORDNANCE RESUPPLY // +6 M18 CLAYMORES (${this.claymoresRemainingThisWave} STOCK) // -${cost} SCRAP`
      );
      return { ok: true, msg: `+6 CLAYMORES (${this.claymoresRemainingThisWave} STOCK)` };
    }
  }

  public scrapTurret(turretId: string): { ok: boolean; msg: string } {
    const idx = this.turrets.findIndex((u) => u.id === turretId);
    if (idx < 0) return { ok: false, msg: 'UNIT NOT FOUND' };
    const t = this.turrets[idx];
    const refund = Math.round(t.totalInvestedScrap * 0.65);
    this.scrap += refund;
    this.turrets.splice(idx, 1);
    this.recomputeRelayLinks();
    this.pushLog(`RECYCLED ${t.callsign} // +${refund} SCRAP RECOVERED`);
    return { ok: true, msg: `+${refund} SCRAP` };
  }

  // ===========================================================================
  // PROTOCOL DRAFTS, OMEGA DIRECTIVES, ENDGAME DIRECTIVES & PAID REROLLS
  // ===========================================================================

  private shuffleInPlace<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  public rollProtocolDraftChoices(): DraftChoiceId[] {
    const allIds = Object.keys(TACTICAL_PROTOCOLS) as ProtocolId[];
    const eligible = allIds.filter((id) => {
      if (id === 'AUX_BUS' && this.getEffectiveMaxReactorCap() >= PERIMETER_CONSTANTS.MAX_REACTOR_KW_HARD_CAP) {
        return false;
      }
      return this.getProtocolStacks(id) < TACTICAL_PROTOCOLS[id].maxStacks;
    });

    this.shuffleInPlace(eligible);
    const chosen: DraftChoiceId[] = eligible.slice(0, 3);

    // P0 #6: Fill remaining slots with distinct repeatable ENDGAME_DIRECTIVES (never duplicate SALVAGE_BONUS!)
    if (chosen.length < 3) {
      const endgamePool = this.shuffleInPlace(
        Object.keys(ENDGAME_DIRECTIVES) as EndgameDirectiveId[]
      );
      for (const egId of endgamePool) {
        if (chosen.length >= 3) break;
        if (!chosen.includes(egId)) {
          chosen.push(egId);
        }
      }
    }
    return chosen;
  }

  private rollOmegaDraftChoices(): OmegaDirectiveId[] {
    const unowned = (Object.keys(OMEGA_DIRECTIVES) as OmegaDirectiveId[]).filter(
      (id) => !this.activeOmegas.includes(id)
    );
    this.shuffleInPlace(unowned);
    return unowned.slice(0, 3);
  }

  private openProtocolDraftModal(): void {
    this.draftMode = 'PROTOCOL';
    this.protocolDraftChoices = this.rollProtocolDraftChoices();
    this.omegaDraftChoices = [];
    this.draftRerollsUsedThisDraft = 0;
    this.paidRerollsUsedThisDraft = 0;
    this.freeDraftRerollsRemaining = this.getProtocolStacks('SALVAGE_BONUS');
    this.phase = 'PROTOCOL_DRAFT';
    this.audioCb.onIntercomVoice('protocol');
    this.pushLog('★ MU-TH-UR TACTICAL PROTOCOL DRAFT READY — SELECT 1 DIRECTIVE [1 / 2 / 3] ★');
  }

  private openOmegaDraftModal(): boolean {
    const choices = this.rollOmegaDraftChoices();
    if (choices.length === 0) return false;
    this.draftMode = 'OMEGA';
    this.omegaDraftChoices = choices;
    this.protocolDraftChoices = [];
    this.draftRerollsUsedThisDraft = 0;
    this.paidRerollsUsedThisDraft = 0;
    this.freeDraftRerollsRemaining = this.getProtocolStacks('SALVAGE_BONUS');
    this.phase = 'PROTOCOL_DRAFT';
    this.audioCb.onIntercomVoice('protocol');
    this.pushLog('★ BOSS MILESTONE — OMEGA DIRECTIVE AUTHORIZED! HIGH-RISK TRADE-OFF READY ★');
    return true;
  }

  public rerollProtocolDraft(): { ok: boolean; msg: string } {
    if (this.phase !== 'PROTOCOL_DRAFT') {
      return { ok: false, msg: 'NO DRAFT ACTIVE' };
    }

    if (this.draftMode === 'OMEGA') {
      const unowned = (Object.keys(OMEGA_DIRECTIVES) as OmegaDirectiveId[]).filter(
        (id) => !this.activeOmegas.includes(id)
      );
      if (unowned.length <= this.omegaDraftChoices.length) {
        return { ok: false, msg: 'ALL REMAINING OMEGA DIRECTIVES ALREADY SHOWN' };
      }
      const cost = this.getProtocolRerollCost();
      if (cost > 0 && this.scrap < cost) {
        return { ok: false, msg: `INSUFFICIENT SCRAP (${cost} REQ)` };
      }
      if (this.freeDraftRerollsRemaining > 0) {
        this.freeDraftRerollsRemaining -= 1;
      } else {
        this.scrap -= cost;
        this.paidRerollsUsedThisDraft += 1;
      }
      this.draftRerollsUsedThisDraft += 1;
      const prevSig = [...this.omegaDraftChoices].sort().join(',');
      let next = this.rollOmegaDraftChoices();
      for (let tries = 0; tries < 5 && [...next].sort().join(',') === prevSig; tries++) {
        next = this.rollOmegaDraftChoices();
      }
      this.omegaDraftChoices = next;
      this.audioCb.onServoStep(0);
      this.pushLog(
        cost === 0
          ? 'OMEGA DRAFT REROLLED [FREE SALVAGE REROLL]'
          : `OMEGA DRAFT REROLLED // -${cost} SCRAP`
      );
      return { ok: true, msg: cost === 0 ? 'FREE REROLL' : `REROLLED (-${cost}S)` };
    }

    const cost = this.getProtocolRerollCost();
    if (cost > 0 && this.scrap < cost) {
      return { ok: false, msg: `INSUFFICIENT SCRAP (${cost} REQ)` };
    }
    if (this.freeDraftRerollsRemaining > 0) {
      this.freeDraftRerollsRemaining -= 1;
    } else {
      this.scrap -= cost;
      this.paidRerollsUsedThisDraft += 1;
    }
    this.draftRerollsUsedThisDraft += 1;

    const prevSig = [...this.protocolDraftChoices].sort().join(',');
    let next = this.rollProtocolDraftChoices();
    for (let tries = 0; tries < 6 && [...next].sort().join(',') === prevSig; tries++) {
      next = this.rollProtocolDraftChoices();
    }
    this.protocolDraftChoices = next;
    this.audioCb.onServoStep(0);
    this.pushLog(
      cost === 0
        ? 'PROTOCOL DRAFT REROLLED [FREE SALVAGE REROLL]'
        : `PROTOCOL DRAFT REROLLED // -${cost} SCRAP`
    );
    return { ok: true, msg: cost === 0 ? 'FREE REROLL' : `REROLLED (-${cost}S)` };
  }

  public selectEndgameDirective(id: EndgameDirectiveId): { ok: boolean; msg: string } {
    if (this.phase !== 'PROTOCOL_DRAFT' || this.draftMode !== 'PROTOCOL') {
      return { ok: false, msg: 'NO PROTOCOL DRAFT ACTIVE' };
    }
    if (!this.protocolDraftChoices.includes(id)) {
      return { ok: false, msg: 'INVALID ENDGAME DIRECTIVE CHOICE' };
    }
    const spec = ENDGAME_DIRECTIVES[id];
    this.activeEndgameDirectives[id] = (this.activeEndgameDirectives[id] ?? 0) + 1;

    if (id === 'EMERGENCY_ORDNANCE') {
      this.purgeChargesRemaining += 1;
      this.purgeAvailableThisWave = true;
      this.scrap += 250;
    }

    this.protocolDraftChoices = [];
    this.phase = 'TACTICAL_PREP';
    this.audioCb.onUpgradeConfirm(true);
    this.pushLog(`★ ENDGAME DIRECTIVE INSTALLED: [${spec.code}] ${spec.title} — ${spec.desc} ★`);
    return { ok: true, msg: `DIRECTIVE: ${spec.code}` };
  }

  public selectOmegaDirective(id: OmegaDirectiveId): { ok: boolean; msg: string } {
    if (this.phase !== 'PROTOCOL_DRAFT' || this.draftMode !== 'OMEGA') {
      return { ok: false, msg: 'NO OMEGA DRAFT ACTIVE' };
    }
    if (!this.omegaDraftChoices.includes(id)) {
      return { ok: false, msg: 'INVALID OMEGA DIRECTIVE CHOICE' };
    }
    const spec = OMEGA_DIRECTIVES[id];
    if (!this.activeOmegas.includes(id)) {
      this.activeOmegas.push(id);
    }

    if (id === 'BREACH_SAPPER') {
      this.claymoresRemainingThisWave += 4;
    } else if (id === 'NIGHT_HUNTER_OPTICS') {
      this.floodlightTimer = 0;
    }

    this.omegaDraftChoices = [];
    this.audioCb.onUpgradeConfirm(true);
    this.pushLog(`★ OMEGA DIRECTIVE LOCKED: [${spec.code}] ${spec.title} — ${spec.desc} ★`);

    if (this.pendingProtocolDraftAfterOmega) {
      this.pendingProtocolDraftAfterOmega = false;
      this.openProtocolDraftModal();
    } else {
      this.draftMode = 'PROTOCOL';
      this.phase = 'TACTICAL_PREP';
    }
    return { ok: true, msg: `OMEGA: ${spec.code}` };
  }

  public selectProtocolDraft(choiceId: DraftChoiceId): { ok: boolean; msg: string } {
    if (choiceId in ENDGAME_DIRECTIVES) {
      return this.selectEndgameDirective(choiceId as EndgameDirectiveId);
    }
    if (this.phase !== 'PROTOCOL_DRAFT' || this.draftMode !== 'PROTOCOL') {
      return { ok: false, msg: 'NO PROTOCOL DRAFT ACTIVE' };
    }
    const protocolId = choiceId as ProtocolId;
    if (!this.protocolDraftChoices.includes(protocolId)) {
      return { ok: false, msg: 'INVALID PROTOCOL CHOICE' };
    }
    const spec = TACTICAL_PROTOCOLS[protocolId];
    this.activeProtocols[protocolId] = (this.activeProtocols[protocolId] ?? 0) + 1;

    if (protocolId === 'AUX_BUS') {
      // Raises hard cap (295 -> 375) AND grants +20 kW immediately without touching autoReactorUnlocks!
      this.maxReactorKw = Math.min(this.getEffectiveMaxReactorCap(), this.maxReactorKw + 20);
    } else if (protocolId === 'AUTOLOADER') {
      // Immediately boost drum capacity on all deployed Sentries!
      for (const t of this.turrets) {
        if (t.kind === 'SENTRY_PULSE') {
          const prevMax = t.maxAmmo;
          t.maxAmmo = this.getSentryMaxAmmo(t);
          t.ammo += Math.max(0, t.maxAmmo - prevMax);
        }
      }
    } else if (protocolId === 'AEGIS_SHIELD') {
      this.bulkheadSeals = Math.min(PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS, this.bulkheadSeals + 1);
      const stacks = this.getProtocolStacks('AEGIS_SHIELD');
      this.aegisBarrierCharges = Math.min(stacks, this.aegisBarrierCharges + 1);
      this.aegisBarrierReady = this.aegisBarrierCharges > 0;
      if (this.aegisBarrierCharges >= stacks) {
        this.aegisRechargeWavesRemaining = 0;
      }
    } else if (protocolId === 'BULKHEAD_ARMOR') {
      const newMax = this.getDoorMaxHp();
      for (const ds of this.doors.values()) {
        ds.maxHp = newMax;
        if (ds.welded) {
          ds.hp = Math.min(newMax, ds.hp + Math.round(PERIMETER_CONSTANTS.DOOR_MAX_HP * 0.5));
          ds.lastPathHpBand = this.getDoorHpBand(ds);
        }
      }
    }

    this.protocolDraftChoices = [];
    this.phase = 'TACTICAL_PREP';
    this.audioCb.onUpgradeConfirm(true);
    this.pushLog(`★ PROTOCOL INSTALLED: [${spec.code}] ${spec.title} — ${spec.desc} ★`);
    return { ok: true, msg: `PROTOCOL: ${spec.code}` };
  }

  // ===========================================================================
  // COMMAND ABILITIES
  // ===========================================================================

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
      if (this.hasOmega('NIGHT_HUNTER_OPTICS')) {
        return { ok: false, msg: 'DISABLED BY Ω-NIGHTOPT PROTOCOL' };
      }
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
        PERIMETER_CONSTANTS.FLOODLIGHT_DURATION_SEC + this.getProtocolStacks('OPTICS_GAIN') * 2.5;
      this.floodlightTimer = Math.max(this.floodlightTimer, dur);

      // Phase 1 [L] Floodlight buff: instant Screamer jam purge + map-wide Stalker reveal +25% crit!
      for (const t of this.turrets) {
        t.jammedTimer = 0;
      }
      this.phantomBlips = [];
      for (const h of this.hostiles) {
        if (h.kind === 'STALKER') {
          h.stealthBurnTimer = Math.max(h.stealthBurnTimer ?? 0, dur);
        }
      }
      this.recomputeRelayLinks();

      this.audioCb.onReactorBreaker(false);
      this.audioCb.onFlarePop(0);
      this.spawnSparks(this.blueprint.coreCenter, 18, '#FFFFFF');
      this.pushLog(
        `EMERGENCY SECTOR FLOODLIGHT ACTIVE [${dur.toFixed(1)}S · +25% CRIT · JAM PURGED · STALKERS EXPOSED!]`
      );
      return { ok: true, msg: `FLOODLIGHT ACTIVE (${dur.toFixed(1)}S)` };
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
        if (t.heat > 5 || t.thermalLocked || t.acidDebuffTimer > 0) {
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
        PERIMETER_CONSTANTS.FLARE_DURATION_SEC + this.getProtocolStacks('OPTICS_GAIN') * 2.5;
      this.flares.push({
        pos: { ...targetPos },
        radius: PERIMETER_CONSTANTS.FLARE_RADIUS_PX,
        remainingSec: flareDur,
        maxSec: flareDur,
      });
      this.audioCb.onFlarePop(this.panFromVirtualX(targetPos.x));
      this.spawnSparks(targetPos, 14, '#FFFFFF');
      this.pushLog(`M40 STROBE FLARE DEPLOYED // ${flareDur.toFixed(1)}S FULL RANGE & CRIT (0 kW)`);
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
        this.getProtocolStacks('CAPACITOR_DRIVE') * 2.0;
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
      if (this.purgeChargesRemaining <= 0) {
        return { ok: false, msg: 'AIRLOCK VENT PURGE EXPENDED THIS WAVE' };
      }
      const chamber = this.findAirlockAt(targetPos);
      if (!chamber) {
        return { ok: false, msg: 'CLICK DESIGNATED AIRLOCK CHAMBER' };
      }
      this.purgeChargesRemaining = Math.max(0, this.purgeChargesRemaining - 1);
      this.purgeAvailableThisWave = this.purgeChargesRemaining > 0;
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

    this.acidPools = this.acidPools.filter(
      (p) => p.pos.x < minX || p.pos.x > maxX || p.pos.y < minY || p.pos.y > maxY
    );

    let flushedCount = 0;
    let purgeKills = 0;
    const knockbackDur = 0.42;
    for (const h of this.hostiles) {
      if (h.pos.x >= minX && h.pos.x <= maxX && h.pos.y >= minY && h.pos.y <= maxY) {
        flushedCount++;
        const pushScale =
          h.kind === 'QUEEN'
            ? 0.22
            : h.kind === 'CRUSHER'
              ? 0.28
              : h.kind === 'PRAETORIAN'
                ? 0.35
                : 1.0;
        const stunDur =
          h.kind === 'QUEEN'
            ? 0.6
            : h.kind === 'CRUSHER'
              ? 0.7
              : h.kind === 'PRAETORIAN'
                ? 0.8
                : 1.75;
        const pushDist = PERIMETER_CONSTANTS.PURGE_PUSH_PX * pushScale;
        this.applyHostileKnockback(h, chamber.flushDir, pushDist, knockbackDur, true);
        this.applyHostileStun(h, stunDur, true);
        if (h.kind === 'CRUSHER') {
          h.chargeActiveTimer = 0;
          h.chargeTelegraphTimer = 0;
        }
        // Phase 1 [V] Airlock Purge buff: 35% current HP (15% boss) + 100 flat dmg!
        const purgeDmg = Math.round(h.hp * (h.isBoss ? 0.15 : 0.35) + 100);
        h.hp -= purgeDmg;
        if (h.hp <= 0) {
          purgeKills++;
          this.score += Math.round(HOSTILE_SPECS[h.kind].scoreValue * this.getActiveScoreMultiplier());
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

  private applyHostileKnockback(
    h: HostileEntity,
    dir: Vec2,
    totalPx: number,
    durationSec = 0.42,
    forceOverride = false
  ): void {
    const dur = Math.max(0.05, durationSec);
    if (!forceOverride && h.knockbackTimer && h.knockbackTimer > dur) {
      return;
    }
    const v0 = (2 * totalPx) / dur;
    h.knockbackVel = { x: dir.x * v0, y: dir.y * v0 };
    h.knockbackTimer = dur;
    h.knockbackMaxTimer = dur;
  }

  private stepHostileKnockback(h: HostileEntity, dt: number): void {
    if (!h.knockbackVel || !h.knockbackTimer || h.knockbackTimer <= 0) return;
    const maxDur = Math.max(0.05, h.knockbackMaxTimer ?? 0.42);
    const prevT = h.knockbackTimer;
    const nextT = Math.max(0, prevT - dt);
    const midFrac = ((prevT + nextT) * 0.5) / maxDur;
    const stepDx = h.knockbackVel.x * midFrac * dt;
    const stepDy = h.knockbackVel.y * midFrac * dt;
    h.knockbackTimer = nextT;
    if (nextT <= 0) {
      h.knockbackVel = undefined;
      h.knockbackMaxTimer = undefined;
    }

    const dist = Math.hypot(stepDx, stepDy);
    const subSteps = Math.max(1, Math.ceil(dist / 12));
    const ts = this.blueprint.tileSize;
    for (let s = 0; s < subSteps; s++) {
      const nx = h.pos.x + stepDx / subSteps;
      const ny = h.pos.y + stepDy / subSteps;
      let moved = false;
      if (
        this.pathfinder.isPassableCell(
          this.blueprint,
          this.doors,
          Math.floor(nx / ts),
          Math.floor(h.pos.y / ts)
        )
      ) {
        h.pos.x = nx;
        moved = true;
      }
      if (
        this.pathfinder.isPassableCell(
          this.blueprint,
          this.doors,
          Math.floor(h.pos.x / ts),
          Math.floor(ny / ts)
        )
      ) {
        h.pos.y = ny;
        moved = true;
      }
      if (!moved) {
        h.knockbackTimer = 0;
        h.knockbackVel = undefined;
        h.knockbackMaxTimer = undefined;
        break;
      }
    }
    if (Math.random() < dt * 16) {
      this.spawnSparks(h.pos, 2, '#8EF5AB');
    }
  }

  // ===========================================================================
  // WAVE FLOW, DYNAMIC BREACHES & SECTOR EXTRACTION
  // ===========================================================================

  public launchNextWave(): void {
    if (this.phase !== 'TACTICAL_PREP') return;
    this.currentWaveDef = getWaveDefinition(this.waveNumber, this.blueprint.sectorId);
    this.activeMutator = this.currentWaveDef.mutator ?? 'NONE';
    this.sealLostThisWave = false;

    // Phase 3: Trigger any scheduled Dynamic AIR_SHAFT Hull Breaches on W5/15/25!
    const openedSet = new Set(this.activeBreachIds);
    const breachesNow = getDynamicBreachesForWave(this.blueprint, this.waveNumber, openedSet);
    if (breachesNow.length > 0) {
      const ts = this.blueprint.tileSize;
      for (const br of breachesNow) {
        applyDynamicBreach(this.blueprint, br);
        this.activeBreachIds.push(br.id);
        const midTile = br.tiles[Math.floor(br.tiles.length / 2)] ?? br.tiles[0];
        if (midTile) {
          const bPos = { x: midTile.col * ts + ts * 0.5, y: midTile.row * ts + ts * 0.5 };
          this.spawnSparks(bPos, 24, '#FFB000');
          this.callouts.push({
            pos: { x: bPos.x, y: bPos.y - 16 },
            text: `⚠ HULL BREACH: ${br.label}!`,
            color: '#FF5522',
            life: 2.6,
            maxLife: 2.6,
          });
        }
        this.pushLog(`⚠ HULL BREACH // ${br.label} COLLAPSED INTO NEW BYPASS CORRIDOR!`);
      }
      this.pendingBreachIds = [];
      this.audioCb.onBulkheadBreach();
      this.audioCb.onSyncGlitch(0.65);
      this.recomputePathfinder(false);
    }

    this.spawnQueue = this.currentWaveDef.groups.map((g) => ({
      ventId: g.ventId,
      kind: g.kind,
      remaining: g.count,
      totalCount: g.count,
      intervalSec: g.intervalSec,
      timerSec: g.delaySec,
      telegraphSent: false,
      hpOverride: g.hpOverride,
    }));
    this.grateTelegraphs = [];
    this.purgeChargesRemaining = Math.max(1, this.purgeChargesRemaining);
    this.purgeAvailableThisWave = this.purgeChargesRemaining > 0;
    this.congestionRecomputeTimer = 1.0;
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

  /**
   * Phase 3 Post-Queen Sector Extraction (W11 / W21 / W31+):
   * Auto-liquidates all turrets at 100% invested Scrap, swaps to the next asymmetric Sector
   * blueprint, resets doors/hazards, and preserves Protocols, Omegas, kW, Seals, Streak & Score!
   */
  public performSectorExtraction(nextSectorId: SectorId): number {
    let totalRefund = 0;
    for (const t of this.turrets) {
      totalRefund += t.totalInvestedScrap;
    }
    this.scrap += totalRefund;
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
    this.crtShockwaves = [];
    this.coreBreachBlasts = [];
    this.screenShake = 0;
    this.sealConcussionFlashTimer = 0;
    this.spawnQueue = [];
    this.cryoCoolerBuffedTurretIds.clear();
    this.relayFloodHostileIds.clear();
    this.acidSpitOwners.clear();
    this.auxShedActive = false;
    this.auxShedTurretIds = [];
    this.warnedLowAmmoIds.clear();
    this.warnedDryIds.clear();
    this.warnedAcidDoorIds.clear();
    this.callsignCounters = {
      SENTRY_PULSE: 0,
      INCINERATOR: 0,
      RAIL_LANCE: 0,
      CRYO_VALVE: 0,
      SHOCK_COIL: 0,
      MOTION_RELAY: 0,
    };

    this.blueprint = createSectorBlueprint(nextSectorId);
    this.pathfinder = new FlowFieldPathfinder(this.blueprint);
    const totalCells = this.blueprint.cols * this.blueprint.rows;
    this.congestionGrid = new Float32Array(totalCells);
    this.hazardMask = new Uint8Array(totalCells);
    this.activeBreachIds = [];
    this.pendingBreachIds = [];

    this.initDoorsFromBlueprint();
    this.pathfinder.recompute(this.blueprint, this.doors);
    this.sectorTransitionVersion += 1;
    this.onSectorChanged?.(nextSectorId, this.blueprint);

    this.audioCb.onUpgradeConfirm(true);
    this.audioCb.onSyncGlitch(0.5);
    this.pushLog(
      `★ SECTOR EXTRACTION -> ${this.blueprint.sectorId}: ${this.blueprint.sectorName} // 100% LIQUIDATION (+${totalRefund} SCRAP) ★`
    );
    return totalRefund;
  }

  public step(rawDt: number): void {
    const fxDt = Math.min(0.08, Math.max(0, rawDt));
    if (this.sealLostFlashTimer > 0) {
      this.sealLostFlashTimer = Math.max(0, this.sealLostFlashTimer - fxDt);
    }
    if (this.sealConcussionFlashTimer > 0) {
      this.sealConcussionFlashTimer = Math.max(0, this.sealConcussionFlashTimer - fxDt);
    }
    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake - fxDt * 26);
    }
    for (let i = this.crtShockwaves.length - 1; i >= 0; i--) {
      const sw = this.crtShockwaves[i];
      sw.age += fxDt;
      if (sw.age >= sw.duration) {
        this.crtShockwaves.splice(i, 1);
      }
    }
    for (let i = this.coreBreachBlasts.length - 1; i >= 0; i--) {
      const b = this.coreBreachBlasts[i];
      b.age += fxDt;
      if (b.age >= b.duration) {
        this.coreBreachBlasts.splice(i, 1);
      }
    }

    if (this.phase === 'CORE_BREACHED' || this.phase === 'CALLSIGN_ENTRY') {
      // Keep final-seal explosion sparks & breach callout animating smoothly after Game Over triggers
      this.stepVisualParticles(fxDt);
      return;
    }

    if (this.phase === 'BRIEFING' || this.phase === 'PROTOCOL_DRAFT') {
      return;
    }

    if (this.tacticalPaused) {
      return;
    }

    const simDt = Math.min(0.08, rawDt) * (this.fastForward2x ? 2.0 : 1.0);

    // 1. Update Ability Cooldowns, Surges, Reserve Battery & Reactor Overload / Blackout State
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
        if (this.reserveBattery > 0) {
          this.reserveBattery = Math.max(0, this.reserveBattery - 26 * simDt);
          this.overloadTimer = Math.max(0, this.overloadTimer - simDt * 1.0);
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
        // P0 #13: Fixed [X] overload-reset exploit (decay 2.0x -> 1.0x)
        if (this.overloadTimer > 0) {
          this.overloadTimer = Math.max(0, this.overloadTimer - simDt * 1.0);
        }
        if (this.phase === 'WAVE_ACTIVE' && this.reserveBattery < 100 && this.floodlightTimer <= 0) {
          const freeKw = Math.max(0, this.maxReactorKw - currentLoad);
          // Phase 2 CAPACITOR_DRIVE: +40% battery charge per stack
          const capBoost = 1 + this.getProtocolStacks('CAPACITOR_DRIVE') * 0.4;
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

    // 1B. Tick Mid-Wave 1.5s Arc-Weld Torch Sequences & Repair Cooldowns
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
          ds.lastPathHpBand = 4;
          ds.repairCooldown = PERIMETER_CONSTANTS.WELD_REPAIR_COOLDOWN_SEC;
          // P0 #1: Eject any hostiles occupying the door tiles to nearest passable outer cell!
          this.ejectHostilesFromDoor(ds);
          this.recomputePathfinder(this.phase === 'WAVE_ACTIVE');
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

    // 1C. Phase 1: Periodic 1.0s active-wave congestion/hazard flow-field recompute
    if (this.phase === 'WAVE_ACTIVE') {
      this.congestionRecomputeTimer -= simDt;
      if (this.congestionRecomputeTimer <= 0) {
        this.congestionRecomputeTimer = 1.0;
        this.recomputePathfinder(true);
      }
    }

    // 2. Floor-Grate 5s Rattling Breach Telegraphs & Wave Hostile Spawns
    if (this.phase === 'WAVE_ACTIVE') {
      for (const sq of this.spawnQueue) {
        if (sq.remaining <= 0) continue;
        sq.timerSec -= simDt;

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
            // Phase 2 BREACH_SAPPER Omega: auto-seed rattling grates with a free armed Claymore!
            if (
              this.hasOmega('BREACH_SAPPER') &&
              !this.claymores.some((m) => m.col === vent.col && m.row === vent.row)
            ) {
              this.claymores.push({
                id: `sapper-mine-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                col: vent.col,
                row: vent.row,
                pos: { ...vent.pos },
                armTimer: 0.5,
              });
              this.spawnSparks(vent.pos, 10, '#FFB000');
              this.pushLog(`Ω-SAPPER // AUTO-MINED RATTLING GRATE [${vent.id}]!`);
            }
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
          this.spawnHostile(sq.ventId, sq.kind, undefined, sq.hpOverride);
        }
      }

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

    // 3. Baseline Core Motion Sweep (pauses during Blackout)
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
    if (this.phase === 'WAVE_ACTIVE' && !this.trainingMode) {
      const anyPending = this.spawnQueue.some((s) => s.remaining > 0);
      if (!anyPending && this.hostiles.length === 0 && this.eggSacs.length === 0) {
        this.completeCurrentWave();
      }
    }
  }

  public spawnTrainingHostile(
    ventId: string,
    kind: HostileKind,
    overridePos?: Vec2
  ): HostileEntity {
    this.spawnHostile(ventId, kind, overridePos);
    return this.hostiles[this.hostiles.length - 1];
  }

  public spawnTrainingAcidPool(pos: Vec2, radius = 64): void {
    this.acidPools.push({
      pos: { x: pos.x, y: pos.y },
      radius,
      remainingSec: 28,
      maxSec: 28,
    });
  }

  private spawnHostile(
    ventId: string,
    kind: HostileKind,
    overridePos?: Vec2,
    hpOverride?: number
  ): void {
    const vent = this.blueprint.vents.find((v) => v.id === ventId) ?? this.blueprint.vents[0];
    const spec = HOSTILE_SPECS[kind];
    const hpScale = this.currentWaveDef.hpScale ?? getWaveHpScale(this.waveNumber);
    const speedScale =
      this.waveNumber <= 10 ? 1.0 : 1.0 + Math.min(0.45, (this.waveNumber - 10) * 0.024);
    const maxHp = hpOverride ?? Math.round(spec.baseHp * hpScale);
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
      speedPxS: spec.speedPxS * speedScale * (0.95 + Math.random() * 0.1),
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
      stunImmuneTimer: 0,
      armorShredTimer: 0,
      silenceTimer: 0,
      thermalShockIcd: 0,
      burnArmorMeltTimer: 0,
      doorBatterTimer: 0,
      stealthBurnTimer: 0,
      firewallSlowTimer: 0,
      opticalIlluminated: false,
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

  private triggerThermalShock(h: HostileEntity, creditTurret?: PlacedTurret): void {
    const shockDmg = Math.max(18, Math.round(h.maxHp * 0.08));
    h.hp -= shockDmg;
    h.thermalShockIcd = 4.0;
    h.napalmBurnTimer = 0;
    h.cryoSlowTimer = 0;
    h.cryoDeepFreeze = false;
    if (h.hp <= 0 && creditTurret) {
      creditTurret.kills += 1;
    }
    this.audioCb.onShatterCrunch(this.panFromVirtualX(h.pos.x));
    this.spawnSparks(h.pos, 10, '#00F0FF');
    this.spawnSparks(h.pos, 6, '#FFB000');
    this.callouts.push({
      pos: { x: h.pos.x, y: h.pos.y - 24 },
      text: `⚡ THERMAL SHOCK -${shockDmg}`,
      color: '#00F0FF',
      life: 0.95,
      maxLife: 0.95,
    });
  }

  private computeSterilizeScrap(): number {
    const mutMult = this.activeMutator === 'ACIDIC_SURGE' ? 2.0 : 1.0;
    const decayedBase = 12 * mutMult * this.getWaveSalvageYieldMult();
    // P0 #12 + Phase 2: THERMITE_CATALYST +12 flat sterilize Scrap EXEMPT from yield decay!
    const thermFlat = this.getProtocolStacks('THERMITE_CATALYST') * 12 * mutMult;
    return Math.max(6, decayedBase + thermFlat);
  }

  private stepHazardsAndClouds(dt: number): void {
    // 1. Expire Napalm Clouds and handle Acid Pool sterilization & Egg burning
    for (let i = this.napalmClouds.length - 1; i >= 0; i--) {
      const c = this.napalmClouds[i];
      c.remainingSec -= dt;
      if (c.remainingSec <= 0) {
        this.napalmClouds.splice(i, 1);
        continue;
      }

      // Burn away overlapping corrosive acid pools -> STERILIZED COMBO!
      for (let a = this.acidPools.length - 1; a >= 0; a--) {
        const pool = this.acidPools[a];
        if (Math.hypot(pool.pos.x - c.pos.x, pool.pos.y - c.pos.y) <= c.radius + pool.radius * 0.7) {
          pool.remainingSec -= dt * 4.2;
          if (pool.remainingSec <= 0) {
            const rawScrap = this.computeSterilizeScrap();
            const scrapGain = this.addSalvageScrap(rawScrap, true);
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

    // 1B. Phase 1: Top-3 Diminishing Napalm Cloud Cap per Hostile (100% / 50% / 25% = 1.75x max!)
    if (this.napalmClouds.length > 0) {
      const weights = [1.0, 0.5, 0.25];
      for (const h of this.hostiles) {
        if (h.hp <= 0) continue;
        let top0 = 0;
        let top1 = 0;
        let top2 = 0;
        let topTurretId: string | undefined;
        let hitThermite = false;
        let hitFirewall = false;

        for (const c of this.napalmClouds) {
          if (Math.hypot(h.pos.x - c.pos.x, h.pos.y - c.pos.y) <= c.radius + h.radiusPx) {
            const effDps = c.dps;
            if (effDps > top0) {
              top2 = top1;
              top1 = top0;
              top0 = effDps;
              topTurretId = c.sourceTurretId;
            } else if (effDps > top1) {
              top2 = top1;
              top1 = effDps;
            } else if (effDps > top2) {
              top2 = effDps;
            }
            if (c.isThermite) hitThermite = true;
            if (c.isFirewall) hitFirewall = true;
          }
        }

        if (top0 > 0) {
          const totalDps = top0 * weights[0] + top1 * weights[1] + top2 * weights[2];
          h.hp -= totalDps * dt;
          h.napalmBurnTimer = 0.65;
          h.lastBurnTurretId = topTurretId;
          // Phase 1 Thermite -35% armor melt (4s) & Firewall -25% slow!
          if (hitThermite) {
            h.burnArmorMeltTimer = Math.max(h.burnArmorMeltTimer, 4.0);
          }
          if (hitFirewall) {
            h.firewallSlowTimer = Math.max(h.firewallSlowTimer ?? 0, 0.65);
          }
          if (h.hp <= 0 && topTurretId) {
            const srcTurret = this.turrets.find((u) => u.id === topTurretId);
            if (srcTurret) srcTurret.kills += 1;
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

      // 1C. Napalm vs Queen Egg Sacs (50% Napalm resistance + top-3 cloud cap!)
      for (let e = this.eggSacs.length - 1; e >= 0; e--) {
        const sac = this.eggSacs[e];
        let top0 = 0;
        let top1 = 0;
        let top2 = 0;
        for (const c of this.napalmClouds) {
          if (Math.hypot(sac.pos.x - c.pos.x, sac.pos.y - c.pos.y) <= c.radius + 20) {
            if (c.dps > top0) {
              top2 = top1;
              top1 = top0;
              top0 = c.dps;
            } else if (c.dps > top1) {
              top2 = top1;
              top1 = c.dps;
            } else if (c.dps > top2) {
              top2 = c.dps;
            }
          }
        }
        if (top0 > 0) {
          const effEggDps = (top0 + 0.5 * top1 + 0.25 * top2) * 0.5; // 50% Napalm resist!
          sac.hp -= effEggDps * dt;
          if (sac.hp <= 0) {
            const gain = this.addSalvageScrap(12, true);
            this.score += Math.round(90 * this.getActiveScoreMultiplier());
            this.audioCb.onAcidSizzle(this.panFromVirtualX(sac.pos.x));
            this.spawnSparks(sac.pos, 10, '#FFB000');
            this.callouts.push({
              pos: { x: sac.pos.x, y: sac.pos.y - 10 },
              text: `EGG INCINERATED +${gain}S`,
              color: '#FFB000',
              life: 1.2,
              maxLife: 1.2,
            });
            this.eggSacs.splice(e, 1);
          }
        }
      }
    }

    // 2. Cryo Plumes: LOS-enforced chill, CRYO COOLER 320px aura (-20% heat / +15% ROF), Thermal Shock!
    this.cryoCoolerBuffedTurretIds.clear();
    for (let i = this.cryoPlumes.length - 1; i >= 0; i--) {
      const p = this.cryoPlumes[i];
      p.remainingSec -= dt;
      if (p.remainingSec <= 0) {
        this.cryoPlumes.splice(i, 1);
        continue;
      }

      for (const h of this.hostiles) {
        if (h.hp <= 0) continue;
        if (
          Math.hypot(h.pos.x - p.pos.x, h.pos.y - p.pos.y) <= p.radius + h.radiusPx &&
          this.hasLineOfSight(p.pos, h.pos)
        ) {
          // Phase 2 THERMAL_SHOCK Omega Directive: Cryo hitting Burning foe -> 8% max-HP detonation!
          if (this.hasOmega('THERMAL_SHOCK') && h.napalmBurnTimer > 0 && h.thermalShockIcd <= 0) {
            this.triggerThermalShock(h);
            continue;
          }
          h.cryoSlowTimer = Math.max(h.cryoSlowTimer, p.isDeepFreeze ? 2.1 : 1.35);
          if (p.isDeepFreeze) h.cryoDeepFreeze = true;
          // Phase 1: Cryo no longer hard-cancels Crusher charges (slows active charge 30% in stepHostiles!)
        }
      }

      // P0 #12 + Phase 1: CRYO COOLER true 320px (2x) cooling radius + -20% heat/shot & +15% ROF!
      const coolRad = p.isCooler ? 320 : p.radius + 45;
      const coolMult = p.isCooler ? 48 : 24;
      for (const t of this.turrets) {
        if (
          Math.hypot(t.pos.x - p.pos.x, t.pos.y - p.pos.y) <= coolRad &&
          this.hasLineOfSight(p.pos, t.pos)
        ) {
          t.heat = Math.max(0, t.heat - coolMult * dt);
          if (t.thermalLocked && t.heat <= 32) {
            t.thermalLocked = false;
          }
          if (p.isCooler) {
            this.cryoCoolerBuffedTurretIds.add(t.id);
          }
        }
      }
    }

    // 3. Corrosive Acid Pools: eat welded Blast Doors, damage Tripwires, AND debuff turrets within 60px!
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
          ds.acidCorrodingTimer = 0.35;
          const prevWarn = this.warnedAcidDoorIds.get(ds.def.id) ?? 0;
          if (prevWarn <= 0) {
            this.warnedAcidDoorIds.set(ds.def.id, 5.0);
            this.pushLog(`ACID CORROSION ON BULKHEAD DOOR ${ds.def.id}!`);
          }
          this.applyDoorDamage(ds, 38 * dt, 'CORRODED BY MOLECULAR ACID');
        }
      }

      for (const t of this.turrets) {
        // Phase 1 Burster Acid Pool counterplay: pools within 60px debuff turrets (+25% CD, +8 heat/s)
        if (Math.hypot(t.pos.x - pool.pos.x, t.pos.y - pool.pos.y) <= 60) {
          t.acidDebuffTimer = Math.max(t.acidDebuffTimer, 0.35);
          if (t.kind === 'SENTRY_PULSE' || t.kind === 'RAIL_LANCE' || t.kind === 'INCINERATOR') {
            t.heat = Math.min(98, t.heat + 8 * dt);
          }
        }
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
    const waveMineDmg =
      PERIMETER_CONSTANTS.CLAYMORE_DAMAGE *
      (1 + (this.waveNumber - 1) * 0.14) *
      (this.hasOmega('BREACH_SAPPER') ? 1.5 : 1.0);

    // 1. Proximity Claymores
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
          h.hp -= waveMineDmg * Math.max(0.45, falloff);
          this.applyHostileStun(h, h.isBoss ? 0.42 : 0.95);
          h.chargeActiveTimer = 0;
          hits++;
        }
      }

      // Phase 1: Claymore grants 50% sterilize Scrap & 50% egg Scrap when clearing acid pools & eggs!
      let bonusScrap = 0;
      for (let a = this.acidPools.length - 1; a >= 0; a--) {
        const p = this.acidPools[a];
        if (Math.hypot(p.pos.x - m.pos.x, p.pos.y - m.pos.y) <= PERIMETER_CONSTANTS.CLAYMORE_BLAST_RADIUS_PX) {
          this.acidPools.splice(a, 1);
          bonusScrap += this.addSalvageScrap(this.computeSterilizeScrap() * 0.5, true);
        }
      }
      for (let e = this.eggSacs.length - 1; e >= 0; e--) {
        const s = this.eggSacs[e];
        if (Math.hypot(s.pos.x - m.pos.x, s.pos.y - m.pos.y) <= PERIMETER_CONSTANTS.CLAYMORE_BLAST_RADIUS_PX) {
          this.eggSacs.splice(e, 1);
          bonusScrap += this.addSalvageScrap(6, true);
        }
      }

      // Phase 2 BREACH_SAPPER Omega: mines leave 4.0s Napalm cloud on detonation!
      if (this.hasOmega('BREACH_SAPPER')) {
        const thermProto = 1 + this.getProtocolStacks('THERMITE_CATALYST') * 0.25;
        this.napalmClouds.push({
          pos: { ...m.pos },
          radius: 92,
          remainingSec: 4.0,
          maxSec: 4.0,
          dps: 76 * thermProto,
        });
      }

      this.callouts.push({
        pos: { x: m.pos.x, y: m.pos.y - 16 },
        text: bonusScrap > 0 ? `CLAYMORE ×${hits} (+${bonusScrap}S)` : `CLAYMORE BLAST ×${hits}`,
        color: '#FFB000',
        life: 1.4,
        maxLife: 1.4,
      });
    }

    // 2. Queen Egg Sacs: hatch into 3 Skitterers after timer expires unless destroyed
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
        const ownerId = this.acidSpitOwners.get(sp.id);
        this.acidSpitOwners.delete(sp.id);
        this.acidSpits.splice(i, 1);
        const pan = this.panFromVirtualX(sp.pos.x);
        this.audioCb.onAcidSizzle(pan);
        this.spawnSparks(sp.pos, 10, '#B8FF3B');

        if (sp.targetDoorId) {
          const ds = this.doors.get(sp.targetDoorId);
          if (ds && ds.welded) {
            const armorStacks = this.getProtocolStacks('BULKHEAD_ARMOR');
            const baseSpitDmg = 55;
            // Phase 2 BULKHEAD_ARMOR: 50% Spitter acid reflect back onto the attacking Spitter!
            if (armorStacks > 0) {
              const reflectDmg = Math.round(baseSpitDmg * 0.5 * armorStacks);
              const attacker =
                (ownerId !== undefined ? this.hostiles.find((h) => h.id === ownerId && h.hp > 0) : undefined) ??
                this.hostiles.find(
                  (h) =>
                    h.kind === 'SPITTER' &&
                    h.hp > 0 &&
                    Math.hypot(h.pos.x - ds.def.center.x, h.pos.y - ds.def.center.y) <= 360
                );
              if (attacker) {
                attacker.hp -= reflectDmg;
                this.shockArcs.push({
                  points: [{ ...ds.def.center }, { ...attacker.pos }],
                  life: 0.24,
                  maxLife: 0.24,
                });
                this.spawnSparks(attacker.pos, 8, '#00F0FF');
                this.callouts.push({
                  pos: { x: attacker.pos.x, y: attacker.pos.y - 20 },
                  text: `⚡ ACID REFLECT -${reflectDmg}`,
                  color: '#00F0FF',
                  life: 0.95,
                  maxLife: 0.95,
                });
              }
            }
            const effectiveDmg = armorStacks > 0 ? Math.round(baseSpitDmg * (1 - 0.25 * armorStacks)) : baseSpitDmg;
            ds.acidCorrodingTimer = 1.2;
            this.applyDoorDamage(ds, effectiveDmg, 'CORRODED BY SPITTER ACID');
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
    // P0 #1: Clear weldingTimer so a destroyed door can NEVER resurrect on top of breachers!
    ds.weldingTimer = 0;
    ds.lastPathHpBand = 4;
    this.recomputePathfinder(this.phase === 'WAVE_ACTIVE');
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
   * P0 #2 & #10: Opaque check for line-of-sight.
   * Solid bulkheads, air shafts, Reactor CORE, and welded blast doors (except optional `ignoreDoorId`)
   * all block line-of-sight!
   */
  public isCellOpaque(col: number, row: number, ignoreDoorId?: string): boolean {
    if (col < 0 || col >= this.blueprint.cols || row < 0 || row >= this.blueprint.rows) {
      return true;
    }
    const kind = this.blueprint.tiles[row][col];
    if (kind === 'CORE' || !FlowFieldPathfinder.isWalkableKind(kind)) {
      return true;
    }
    const weldedDoor = this.pathfinder.getWeldedDoorAtCell(this.doors, col, row);
    if (weldedDoor !== null && weldedDoor.def.id !== ignoreDoorId) {
      return true;
    }
    return false;
  }

  /**
   * High-precision line-of-sight check between two points in blueprint space.
   * Pass `ignoreDoorId` when checking LOS to a welded Blast Door itself (e.g., Spitter acid spit!).
   */
  public hasLineOfSight(from: Vec2, to: Vec2, ignoreDoorId?: string): boolean {
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
      if (this.isCellOpaque(c, r, ignoreDoorId)) {
        return false;
      }
    }
    return true;
  }

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

  private updateHostileVerification(dt: number): void {
    const inBlackout = this.blackoutTimer > 0;
    this.relayFloodHostileIds.clear();

    // 1. Check Laser Tripwire crossings on powered, unjammed, spun-up M314 Relays
    for (const t of this.turrets) {
      if (t.kind !== 'MOTION_RELAY') continue;
      if (t.tripwireIntegrity < 100) {
        t.tripwireIntegrity = Math.min(100, t.tripwireIntegrity + 12 * dt);
      }
      if (
        inBlackout ||
        !t.powered ||
        t.powerUpTimer > 0 ||
        t.jammedTimer > 0 ||
        t.tripwireIntegrity < 20 ||
        !t.tripwireStart ||
        !t.tripwireEnd
      ) {
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

    // 2. Evaluate timers, optical illumination, Cryo/Napalm visibility & Stalker stealth per hostile
    const coreLitRad =
      this.activeMutator === 'GRID_BROWNOUT'
        ? PERIMETER_CONSTANTS.CORE_LIT_RADIUS * 0.52
        : PERIMETER_CONSTANTS.CORE_LIT_RADIUS;
    const mapFloodLit = this.floodlightTimer > 0 && !inBlackout;

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
      if (h.stunImmuneTimer && h.stunImmuneTimer > 0) {
        h.stunImmuneTimer = Math.max(0, h.stunImmuneTimer - dt);
      }
      if (h.armorShredTimer > 0) h.armorShredTimer = Math.max(0, h.armorShredTimer - dt);
      if (h.silenceTimer > 0) h.silenceTimer = Math.max(0, h.silenceTimer - dt);
      if (h.thermalShockIcd > 0) h.thermalShockIcd = Math.max(0, h.thermalShockIcd - dt);
      if (h.burnArmorMeltTimer > 0) h.burnArmorMeltTimer = Math.max(0, h.burnArmorMeltTimer - dt);
      if (h.stealthBurnTimer && h.stealthBurnTimer > 0) {
        h.stealthBurnTimer = Math.max(0, h.stealthBurnTimer - dt);
      }
      if (h.firewallSlowTimer && h.firewallSlowTimer > 0) {
        h.firewallSlowTimer = Math.max(0, h.firewallSlowTimer - dt);
      }

      const inFlare = this.flares.some(
        (f) => Math.hypot(h.pos.x - f.pos.x, h.pos.y - f.pos.y) <= f.radius + h.radiusPx
      );
      // Phase 1 M314 FLOODLIGHT: 280px optical halo, IMMUNE to Screamer jam, burns Stalker stealth 6s!
      const inRelayFlood =
        !inBlackout &&
        this.turrets.some(
          (t) =>
            t.kind === 'MOTION_RELAY' &&
            t.powered &&
            t.powerUpTimer <= 0 &&
            t.level === 3 &&
            t.mk3Branch === 'A' &&
            Math.hypot(h.pos.x - t.pos.x, h.pos.y - t.pos.y) <= 280 + h.radiusPx
        );
      if (inRelayFlood) {
        this.relayFloodHostileIds.add(h.id);
        if (h.kind === 'STALKER') {
          h.stealthBurnTimer = Math.max(h.stealthBurnTimer ?? 0, 6.0);
        }
      }
      const inCoreLight =
        !inBlackout &&
        Math.hypot(
          h.pos.x - this.blueprint.coreCenter.x,
          h.pos.y - this.blueprint.coreCenter.y
        ) <= coreLitRad;

      // Optical / Sensor reveal (M314, Flare, Floodlight, Tripwire, Shock[sets tripwireTagTimer], Core)
      const opticalReveal =
        inFlare ||
        mapFloodLit ||
        inRelayFlood ||
        h.tripwireTagTimer > 0 ||
        h.m314SweepTimer > 0 ||
        inCoreLight ||
        (h.stealthBurnTimer ?? 0) > 0;

      h.opticalIlluminated = opticalReveal;
      // Phase 1: Napalm reveals visibility WITHOUT granting full lit crit; Cryo does not grant lit crit either!
      h.illuminated = opticalReveal;

      if (h.kind === 'STALKER') {
        // Phase 1 Stalker: optical/sensor reveal = full lock; Cryo/Napalm-only = targetable with 50% evasion!
        h.verified = opticalReveal || h.cryoSlowTimer > 0 || h.napalmBurnTimer > 0;
      } else if (opticalReveal || h.napalmBurnTimer > 0 || h.cryoSlowTimer > 0) {
        h.verified = true;
      } else if (inBlackout) {
        h.verified = false;
      } else {
        let inShortDarkCone = false;
        for (const t of this.turrets) {
          if (
            !t.powered ||
            t.powerUpTimer > 0 ||
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
            (t.level === 3 ? 1.22 : t.level === 2 ? 1.12 : 1.0) *
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

  private isTurretOpticallyProtected(t: PlacedTurret, inBlackout: boolean): boolean {
    if (!inBlackout && this.floodlightTimer > 0) return true;
    if (this.flares.some((f) => Math.hypot(t.pos.x - f.pos.x, t.pos.y - f.pos.y) <= f.radius)) {
      return true;
    }
    if (
      !inBlackout &&
      this.turrets.some(
        (r) =>
          r.kind === 'MOTION_RELAY' &&
          r.powered &&
          r.powerUpTimer <= 0 &&
          r.level === 3 &&
          r.mk3Branch === 'A' &&
          Math.hypot(t.pos.x - r.pos.x, t.pos.y - r.pos.y) <= 280
      )
    ) {
      return true;
    }
    return false;
  }

  /**
   * Computes Phase 2 Shared Additive Combat Card Bucket for a shot against `target`:
   * `1 + duDmg + litCritBonuses + shatterBonuses`
   */
  private computeAdditiveCombatBucket(
    t: PlacedTurret,
    target: HostileEntity,
    includeDu: boolean
  ): { mult: number; triggeredShatter: boolean; shatterBonus: number } {
    let bucket = 1.0;

    if (includeDu) {
      bucket += this.getProtocolStacks('DU_ROUNDS') * 0.15;
    }

    if (target.illuminated) {
      bucket += PERIMETER_CONSTANTS.ILLUMINATED_CRIT_MULT - 1.0; // +0.20 base lit crit
      bucket += this.getProtocolStacks('OPTICS_GAIN') * 0.15;
      if (t.relayMatrixBoosted) bucket += 0.32;
      if (this.relayFloodHostileIds.has(target.id)) bucket += 0.15;
      if (this.floodlightTimer > 0 && this.blackoutTimer <= 0) bucket += 0.25;
    }

    let triggeredShatter = false;
    let shatterBonus = 0;
    if (
      target.cryoSlowTimer > 0 &&
      (target.kind === 'PRAETORIAN' || target.kind === 'BURSTER' || target.isBoss)
    ) {
      triggeredShatter = true;
      shatterBonus =
        (target.cryoDeepFreeze ? 0.55 : 0.35) + this.getProtocolStacks('CRYO_SHATTER') * 0.2;
      bucket += shatterBonus;
    }

    return { mult: bucket, triggeredShatter, shatterBonus };
  }

  private stepTurrets(dt: number): void {
    this.updateHostileVerification(dt);
    const inBlackout = this.blackoutTimer > 0;
    const volatileOverpressure = this.hasOmega('VOLATILE_OVERPRESSURE');
    const nightHunter = this.hasOmega('NIGHT_HUNTER_OPTICS');
    const overdriveStacks = this.getEndgameStacks('REACTOR_OVERDRIVE');
    const globalDmgMult = 1 + overdriveStacks * 0.05;
    const autoStacks = this.getProtocolStacks('AUTOLOADER');

    let relayLinkDirty = false;

    for (const t of this.turrets) {
      if (t.firingFlashTimer > 0) t.firingFlashTimer = Math.max(0, t.firingFlashTimer - dt);
      if (t.dryFireTimer > 0) t.dryFireTimer = Math.max(0, t.dryFireTimer - dt);
      if (t.overclockTimer > 0) t.overclockTimer = Math.max(0, t.overclockTimer - dt);
      // P0 #8: True 60Hz fireCooldown carry-over (clamp idle floor to -dt, never 0 before firing!)
      t.fireCooldown = Math.max(-dt, t.fireCooldown - dt);
      if (t.acidDebuffTimer > 0) t.acidDebuffTimer = Math.max(0, t.acidDebuffTimer - dt);
      if (t.jammedTimer > 0) {
        t.jammedTimer = Math.max(0, t.jammedTimer - dt);
        if (t.jammedTimer <= 0 && t.kind === 'MOTION_RELAY') {
          relayLinkDirty = true;
        }
      }
      if (t.powerUpTimer > 0 && t.powered && !inBlackout) {
        t.powerUpTimer = Math.max(0, t.powerUpTimer - dt);
        if (t.powerUpTimer <= 0 && t.kind === 'MOTION_RELAY') {
          relayLinkDirty = true;
        }
      }

      const isOverclocked = t.overclockTimer > 0 && !inBlackout;
      const isCryoCooled = this.cryoCoolerBuffedTurretIds.has(t.id);
      const mk4DmgMult = 1 + (t.mk4Level ?? 0) * PERIMETER_CONSTANTS.MK4_DMG_PER_LEVEL;

      // Passive barrel cooling
      const coolRate = t.level >= 2 ? 16.0 : 11.5;
      if (t.firingFlashTimer <= 0.015) {
        t.heat = Math.max(0, t.heat - coolRate * dt);
      } else {
        t.heat = Math.max(0, t.heat - coolRate * 0.25 * dt);
      }
      if (t.thermalLocked && t.heat <= 32) {
        t.thermalLocked = false;
        this.pushLog(`${t.callsign} BARREL COOLED // TARGET LOCK RESTORED`, false);
      }

      // Tick Mid-Wave Automated Belt-Loader Reload Sequence
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
        if (t.fireCooldown < 0) t.fireCooldown = 0;
        continue;
      }

      // Phase 2 AUTOLOADER: Auto-rearms empty Sentries automatically!
      if (
        t.kind === 'SENTRY_PULSE' &&
        t.powered &&
        !inBlackout &&
        t.ammo <= 0 &&
        autoStacks > 0 &&
        this.scrap >= this.getRearmCostFor(t)
      ) {
        this.rearmTurret(t.id);
        continue;
      }

      if (!t.powered || inBlackout || t.powerUpTimer > 0) {
        if (t.fireCooldown < 0) t.fireCooldown = 0;
        continue;
      }

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
      const omegaRofMult = volatileOverpressure ? 1.3 : 1.0;

      // 1. M314 Motion Relay Periodic Pulse Sweep
      if (t.kind === 'MOTION_RELAY') {
        if (t.jammedTimer > 0) continue;
        t.pulseTimer -= dt * (isOverclocked ? 1.65 : 1.0) * omegaRofMult;
        if (t.pulseTimer <= 0) {
          t.pulseTimer = t.level === 3 ? 1.25 : 1.55;
          // Base 390px -> MK-II ~430px (1.1025x)
          const levelRangeMult = t.level >= 2 ? 1.105 : 1.0;
          const maxR = spec.rangePx * levelRangeMult * mk4DmgMult;
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

      // 2. Cryo-Stasis Vent Valve Periodic LN2 Plume (Spitter acid halves plume rate!)
      if (t.kind === 'CRYO_VALVE') {
        const acidPlumeRateMult = t.acidDebuffTimer > 0 ? 0.5 : 1.0;
        t.pulseTimer -= dt * (isOverclocked ? 1.7 : 1.0) * omegaRofMult * acidPlumeRateMult;
        if (t.pulseTimer <= 0) {
          // Phase 2 CRYO_SHATTER: +15% LOS-bound Cryo & Shock radius per stack
          const protoRad = 1 + this.getProtocolStacks('CRYO_SHATTER') * 0.15;
          const isCooler = t.level === 3 && t.mk3Branch === 'B';
          const isDeepFreeze = t.level === 3 && t.mk3Branch === 'A';
          const rPx = spec.rangePx * (t.level >= 2 ? 1.22 : 1.0) * protoRad;
          const hostileNear = this.hostiles.some(
            (h) =>
              Math.hypot(h.pos.x - t.pos.x, h.pos.y - t.pos.y) <= rPx + 48 &&
              this.hasLineOfSight(t.pos, h.pos)
          );
          const coolCheckRad = isCooler ? 320 : rPx + 45;
          const hotTurretNear = this.turrets.some(
            (u) =>
              u.id !== t.id &&
              u.heat > 24 &&
              Math.hypot(u.pos.x - t.pos.x, u.pos.y - t.pos.y) <= coolCheckRad
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

      // 2B. Arc-Shock Coil (LOS-bound, wave scaling, TESLA %HP shock, EMP 1.2s stun + armor shred + 4s silence!)
      if (t.kind === 'SHOCK_COIL') {
        t.pulseTimer -=
          dt * (isOverclocked ? 1.75 : 1.0) * omegaRofMult * (t.acidDebuffTimer > 0 ? 0.65 : 1.0);
        if (t.pulseTimer <= 0) {
          const protoRad = 1 + this.getProtocolStacks('CRYO_SHATTER') * 0.15;
          const rPx = spec.rangePx * (t.level >= 2 ? 1.18 : 1.0) * protoRad;
          const inRange = this.hostiles
            .filter(
              (h) =>
                h.hp > 0 &&
                Math.hypot(h.pos.x - t.pos.x, h.pos.y - t.pos.y) <= rPx + h.radiusPx &&
                this.hasLineOfSight(t.pos, h.pos)
            )
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

            // Phase 1 Shock Coil scaling: +12%/wave + CAPACITOR_DRIVE (+25%/stack) + OPTICS_GAIN + MK4!
            const waveScale = 1 + (this.waveNumber - 1) * 0.12;
            const capScale = 1 + this.getProtocolStacks('CAPACITOR_DRIVE') * 0.25;
            const opticsBonus = this.getProtocolStacks('OPTICS_GAIN') * 0.15;
            const baseDmg =
              (t.level >= 2 ? 58 : 42) *
              (isTesla ? 1.35 : 1.0) *
              waveScale *
              capScale *
              mk4DmgMult *
              globalDmgMult;

            const pts: Vec2[] = [{ ...t.pos }];
            for (const target of targets) {
              pts.push({ ...target.pos });
              const litMult = target.illuminated ? 1 + opticsBonus : 1.0;
              // TESLA CHAIN: +5% max-HP shock (capped 450 vs bosses)
              const pctHpDmg = isTesla
                ? Math.min(target.isBoss ? 450 : 9999, target.maxHp * 0.05)
                : 0;
              target.hp -= baseDmg * litMult + pctHpDmg;
              if (target.hp <= 0) t.kills += 1;

              // P0 #12 + Phase 1 EMP PULSE: true 1.2s stun (0.65s boss), -50% frontal armor shred, 4.0s silence!
              const stunDur = isEmp
                ? target.isBoss
                  ? 0.65
                  : 1.2
                : target.isBoss
                  ? 0.25
                  : 0.65;
              this.applyHostileStun(target, stunDur);
              target.tripwireTagTimer = Math.max(target.tripwireTagTimer, 4.0);
              target.chargeActiveTimer = 0;
              target.chargeTelegraphTimer = 0;
              if (target.kind === 'SCREAMER') target.abilityCooldown += 3.5;
              if (isEmp) {
                target.armorShredTimer = Math.max(target.armorShredTimer, 4.0);
                target.silenceTimer = Math.max(target.silenceTimer, 4.0);
                if (target.isBoss) {
                  target.cryoSlowTimer = Math.max(target.cryoSlowTimer, 2.5);
                }
              }
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

      if (t.thermalLocked) {
        if (t.fireCooldown < 0) t.fireCooldown = 0;
        continue;
      }

      // 3. Directional Combat Turrets (UA 571-C Sentry, M240 Incinerator, M99 Rail-Lance)
      const rlyRangeMult = t.relayMatrixBoosted ? 1.32 : t.relayBoosted ? 1.24 : 1.0;
      const fullRange =
        spec.rangePx * rlyRangeMult * (t.level === 3 ? 1.22 : t.level === 2 ? 1.12 : 1.0);
      const darkRange = fullRange * PERIMETER_CONSTANTS.DARK_CORRIDOR_RANGE_MULT;

      // Acquire highest-priority VERIFIED target inside cone
      let bestTarget: HostileEntity | null = null;
      let bestScore = Infinity;

      for (const h of this.hostiles) {
        if (!h.verified || h.hp <= 0) continue;
        const dx = h.pos.x - t.pos.x;
        const dy = h.pos.y - t.pos.y;
        const dist = Math.hypot(dx, dy);
        const allowedRange =
          h.illuminated || h.napalmBurnTimer > 0 || h.cryoSlowTimer > 0 ? fullRange : darkRange;
        if (dist > allowedRange + h.radiusPx) continue;
        const angToH = Math.atan2(dy, dx);
        const angDiff = Math.abs(this.normalizeAngle(angToH - t.angle));
        if (angDiff > spec.coneHalfAngleRad) continue;
        if (!this.hasLineOfSight(t.pos, h.pos)) continue;

        const distToCore = Math.hypot(
          h.pos.x - this.blueprint.coreCenter.x,
          h.pos.y - this.blueprint.coreCenter.y
        );
        const priorityBias =
          t.kind === 'RAIL_LANCE' && (h.isBoss || h.kind === 'PRAETORIAN') ? -450 : 0;
        if (distToCore + priorityBias < bestScore) {
          bestScore = distToCore + priorityBias;
          bestTarget = h;
        }
      }

      // P0 #11 + Phase 1: Unified Queen Egg Sac targeting across Sentries, Rails, AND Incinerators!
      // All 3 turret types prioritize Eggs <2.0s from hatch (Firewall prioritizes Eggs even earlier!)
      let eggTarget: QueenEggSac | null = null;
      if (this.eggSacs.length > 0) {
        let bestEggTimer = Infinity;
        const isFirewall = t.kind === 'INCINERATOR' && t.level === 3 && t.mk3Branch === 'B';
        for (const sac of this.eggSacs) {
          const dx = sac.pos.x - t.pos.x;
          const dy = sac.pos.y - t.pos.y;
          const dist = Math.hypot(dx, dy);
          if (dist > fullRange + 16) continue;
          const angDiff = Math.abs(this.normalizeAngle(Math.atan2(dy, dx) - t.angle));
          if (angDiff <= spec.coneHalfAngleRad && this.hasLineOfSight(t.pos, sac.pos)) {
            const urgent = sac.hatchTimer < 2.0 || (isFirewall && sac.hatchTimer < 3.5);
            if ((urgent || !bestTarget) && sac.hatchTimer < bestEggTimer) {
              bestEggTimer = sac.hatchTimer;
              eggTarget = sac;
            }
          }
        }
      }

      // Phase 1 Screamer Phantom Blip decoy: turrets not in optical Floodlight/Flare waste 1 shot!
      let phantomIdx = -1;
      if (
        !eggTarget &&
        this.phantomBlips.length > 0 &&
        t.fireCooldown <= 0 &&
        !this.isTurretOpticallyProtected(t, inBlackout)
      ) {
        for (let pi = 0; pi < this.phantomBlips.length; pi++) {
          const pb = this.phantomBlips[pi];
          const dx = pb.pos.x - t.pos.x;
          const dy = pb.pos.y - t.pos.y;
          const dist = Math.hypot(dx, dy);
          if (dist > fullRange) continue;
          const angDiff = Math.abs(this.normalizeAngle(Math.atan2(dy, dx) - t.angle));
          if (angDiff <= spec.coneHalfAngleRad && this.hasLineOfSight(t.pos, pb.pos)) {
            phantomIdx = pi;
            break;
          }
        }
      }

      if (!bestTarget && !eggTarget && phantomIdx < 0) {
        if (t.fireCooldown < 0) t.fireCooldown = 0;
        continue;
      }

      if (t.fireCooldown > 0) continue;

      const heatMutMult =
        (this.activeMutator === 'THERMAL_SPIKE' ? 1.28 : 1.0) *
        (volatileOverpressure ? 1.35 : 1.0) *
        (isCryoCooled ? 0.8 : 1.0);
      // Phase 1: Cryo Cooler +15% ROF, Volatile Overpressure +30% ROF, Overclock 1.15x heat (down from 1.38x)
      const rofSpeedMult = (isCryoCooled ? 1.15 : 1.0) * omegaRofMult;
      const acidRofMult = t.acidDebuffTimer > 0 ? 1.25 : 1.0;
      const ocSpeedMult = isOverclocked ? 0.52 / (1 + overdriveStacks * 0.05) : 1.0;
      const ocHeatMult = isOverclocked ? 1.15 : 1.0;

      // Consume phantom decoy shot if lured by Screamer interference!
      if (phantomIdx >= 0) {
        const pb = this.phantomBlips[phantomIdx];
        this.phantomBlips.splice(phantomIdx, 1);
        const pan = this.panFromVirtualX(t.pos.x);
        if (t.kind === 'SENTRY_PULSE' && t.ammo > 0) {
          t.ammo = Math.max(0, t.ammo - 2);
          const baseCd = t.level === 3 && t.mk3Branch === 'B' ? 0.064 : 0.088;
          t.fireCooldown += ((baseCd * ocSpeedMult) / rofSpeedMult) * acidRofMult;
          t.firingFlashTimer = 0.045;
          this.tracers.push({
            p1: { x: t.pos.x + Math.cos(t.angle) * 18, y: t.pos.y + Math.sin(t.angle) * 18 },
            p2: { ...pb.pos },
            life: 0.085,
            maxLife: 0.085,
            ricochet: true,
            overclocked: isOverclocked,
          });
          this.audioCb.onPulseBurst(pan, isOverclocked, this.distNormFromCore(t.pos), t.level);
        } else if (t.kind === 'RAIL_LANCE') {
          const isCap = t.level === 3 && t.mk3Branch === 'B';
          const baseCd = (t.level >= 2 ? 1.32 : 1.72) * (isCap ? 0.65 : 1.0);
          t.fireCooldown += ((baseCd * ocSpeedMult) / rofSpeedMult) * acidRofMult;
          t.firingFlashTimer = 0.24;
          const aimAng = Math.atan2(pb.pos.y - t.pos.y, pb.pos.x - t.pos.x);
          const beamEnd = this.castSightRay(t.pos, aimAng, fullRange);
          this.railBeams.push({
            p1: { x: t.pos.x + Math.cos(aimAng) * 18, y: t.pos.y + Math.sin(aimAng) * 18 },
            p2: beamEnd,
            life: 0.22,
            maxLife: 0.22,
            tier: t.level,
          });
          this.audioCb.onRailLance(pan, t.level, this.distNormFromCore(t.pos));
        } else if (t.kind === 'INCINERATOR') {
          t.fireCooldown += ((0.62 * ocSpeedMult) / rofSpeedMult) * acidRofMult;
          t.firingFlashTimer = 0.22;
          this.audioCb.onIncinerator(pan, this.distNormFromCore(pb.pos));
        }
        this.spawnSparks(pb.pos, 6, '#CC66FF');
        this.callouts.push({
          pos: { x: pb.pos.x, y: pb.pos.y - 16 },
          text: 'PHANTOM DECOY!',
          color: '#CC66FF',
          life: 0.85,
          maxLife: 0.85,
        });
        continue;
      }

      // Unified Egg Sac Firing Branch (Sentry, Rail-Lance, Incinerator)
      if (eggTarget) {
        const pan = this.panFromVirtualX(t.pos.x);
        const duStacks = this.getProtocolStacks('DU_ROUNDS');
        if (t.kind === 'SENTRY_PULSE') {
          if (t.ammo <= 0) {
            t.fireCooldown = 0.42;
            t.dryFireTimer = 0.25;
            this.audioCb.onDryFire(pan);
            continue;
          }
          const isApSabot = t.level === 3 && t.mk3Branch === 'A';
          const isTwinLink = t.level === 3 && t.mk3Branch === 'B';
          const sentryHeatBase = (isTwinLink ? 1.9 : 2.6) * Math.max(0.5, 1 - autoStacks * 0.15);
          t.ammo = Math.max(0, t.ammo - 2);
          const baseCd = isTwinLink ? 0.064 : 0.088;
          t.fireCooldown += ((baseCd * ocSpeedMult) / rofSpeedMult) * acidRofMult;
          t.firingFlashTimer = 0.045;
          t.heat = Math.min(100, t.heat + sentryHeatBase * ocHeatMult * heatMutMult);
          const eggDmg =
            (t.level >= 2 ? 22 : 16.5) *
            (isApSabot ? 1.45 : 1.0) *
            (1 + duStacks * 0.15) *
            (t.relayBoosted ? 1.18 : 1.0) *
            mk4DmgMult *
            globalDmgMult;
          eggTarget.hp -= eggDmg;
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
            const gain = this.addSalvageScrap(10, true);
            this.spawnSparks(eggTarget.pos, 10, '#B8FF3B');
            this.callouts.push({
              pos: { x: eggTarget.pos.x, y: eggTarget.pos.y - 12 },
              text: `EGG DESTROYED +${gain}S`,
              color: '#B8FF3B',
              life: 1.0,
              maxLife: 1.0,
            });
          }
        } else if (t.kind === 'RAIL_LANCE') {
          const isOverpen = t.level === 3 && t.mk3Branch === 'A';
          const isCapacitor = t.level === 3 && t.mk3Branch === 'B';
          const baseCd = (t.level >= 2 ? 1.32 : 1.72) * (isCapacitor ? 0.65 : 1.0);
          t.fireCooldown += ((baseCd * ocSpeedMult) / rofSpeedMult) * acidRofMult;
          t.firingFlashTimer = 0.24;
          t.heat = Math.min(100, t.heat + 18 * ocHeatMult * heatMutMult);
          const aimAng = Math.atan2(eggTarget.pos.y - t.pos.y, eggTarget.pos.x - t.pos.x);
          const beamEnd = this.castSightRay(t.pos, aimAng, fullRange);
          const eggDmg =
            (t.level >= 2 ? 155 : 112) *
            (isOverpen ? 1.4 : 1.0) *
            (1 + duStacks * 0.15) *
            mk4DmgMult *
            globalDmgMult;
          // Damage all eggs along the rail beam!
          for (let ei = this.eggSacs.length - 1; ei >= 0; ei--) {
            const s = this.eggSacs[ei];
            if (this.pointToSegmentDist(s.pos, t.pos, beamEnd) <= 22 && this.hasLineOfSight(t.pos, s.pos)) {
              s.hp -= eggDmg;
              this.spawnSparks(s.pos, 8, '#00F0FF');
              if (s.hp <= 0) {
                this.eggSacs.splice(ei, 1);
                this.addSalvageScrap(10, true);
              }
            }
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
          t.fireCooldown += ((0.62 * ocSpeedMult) / rofSpeedMult) * acidRofMult;
          t.firingFlashTimer = 0.25;
          t.heat = Math.min(100, t.heat + 16.5 * ocHeatMult * heatMutMult);
          const rawDist = Math.min(
            fullRange * 0.85,
            Math.hypot(eggTarget.pos.x - t.pos.x, eggTarget.pos.y - t.pos.y)
          );
          const dirAng = Math.atan2(eggTarget.pos.y - t.pos.y, eggTarget.pos.x - t.pos.x);
          const cloudPos = this.castSightRay(t.pos, dirAng, rawDist);
          const thermProto = 1 + this.getProtocolStacks('THERMITE_CATALYST') * 0.25;
          const baseBurnDps = isThermite ? 140 : t.level >= 2 ? 88 : 64;
          this.napalmClouds.push({
            pos: cloudPos,
            radius: (t.level >= 2 ? 78 : 64) * (isFirewall ? 1.45 : 1.0),
            remainingSec: isFirewall ? 5.2 : 3.4,
            maxSec: isFirewall ? 5.2 : 3.4,
            dps: baseBurnDps * thermProto * mk4DmgMult * globalDmgMult,
            isThermite,
            isFirewall,
            sourceTurretId: t.id,
          });
          this.audioCb.onIncinerator(pan, this.distNormFromCore(cloudPos));
          this.spawnSparks(cloudPos, 8, '#FFB000');
        }
        continue;
      }

      if (!bestTarget) continue;

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
        // P0 #8 + Phase 1: 60Hz carry-over `+= cd`, `firingFlashTimer = 0.045s`, Twin-Link heat 1.9!
        const baseCd = isTwinLink ? 0.064 : 0.088;
        t.fireCooldown += ((baseCd * ocSpeedMult) / rofSpeedMult) * acidRofMult;
        t.firingFlashTimer = 0.045;
        const baseHeat = (isTwinLink ? 1.9 : 2.6) * Math.max(0.5, 1 - autoStacks * 0.15);
        t.heat = Math.min(100, t.heat + baseHeat * ocHeatMult * heatMutMult);

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

        const targetVisuallyLit = bestTarget.illuminated || bestTarget.napalmBurnTimer > 0;
        const darkMiss =
          !targetVisuallyLit &&
          !nightHunter &&
          Math.random() < PERIMETER_CONSTANTS.DARK_CORRIDOR_MISS_CHANCE;
        // Phase 1 Stalker: 50% evasion in Cryo-only chokes without optical/sensor reveal!
        const stalkerEvade =
          bestTarget.kind === 'STALKER' && !bestTarget.opticalIlluminated && Math.random() < 0.5;
        const missed = darkMiss || stalkerEvade;

        const duStacks = this.getProtocolStacks('DU_ROUNDS');
        const bucketRes = this.computeAdditiveCombatBucket(t, bestTarget, true);
        const nightBonus = nightHunter && !bestTarget.illuminated ? 1.35 : 1.0;

        // P0 #12: DU_ROUNDS 1.00 AP cap + excess AP converts at 50% into bonus boss DMG!
        const rawAp = (isApSabot ? 0.65 : 0) + duStacks * 0.25;
        const cappedAp = Math.min(1.0, rawAp);
        const excessAp = Math.max(0, rawAp - 1.0);
        const bossExcessApMult = bestTarget.isBoss && excessAp > 0 ? 1 + excessAp * 0.5 : 1.0;

        let dmg = missed
          ? 0
          : (t.level >= 2 ? 22 : 16.5) *
            (isApSabot ? 1.45 : 1.0) *
            (t.relayBoosted ? 1.18 : 1.0) *
            bucketRes.mult *
            nightBonus *
            bossExcessApMult *
            mk4DmgMult *
            globalDmgMult;
        let ricochet = false;

        if (!missed) {
          if (bucketRes.triggeredShatter) {
            this.audioCb.onShatterCrunch(pan);
            this.spawnSparks(bestTarget.pos, 5, '#9BF8FF');
            if (Math.random() < 0.24) {
              this.callouts.push({
                pos: { x: bestTarget.pos.x, y: bestTarget.pos.y - 20 },
                text: `SHATTER +${Math.round(bucketRes.shatterBonus * 100)}%`,
                color: '#9BF8FF',
                life: 0.7,
                maxLife: 0.7,
              });
            }
          }

          if (isTwinLink && !bestTarget.isBoss && Math.random() < 0.35) {
            const kDx = bestTarget.pos.x - t.pos.x;
            const kDy = bestTarget.pos.y - t.pos.y;
            const kLen = Math.max(1, Math.hypot(kDx, kDy));
            this.applyHostileKnockback(bestTarget, { x: kDx / kLen, y: kDy / kLen }, 14, 0.12);
          }

          // Heavy Directional Carapace (W1-W6 Crusher softened 60% deflect; EMP -50% shred; Thermite -35% melt!)
          if (bestTarget.kind === 'PRAETORIAN' || bestTarget.isBoss) {
            const shotDx = t.pos.x - bestTarget.pos.x;
            const shotDy = t.pos.y - bestTarget.pos.y;
            const shotLen = Math.max(1, Math.hypot(shotDx, shotDy));
            const noseX = Math.cos(bestTarget.heading);
            const noseY = Math.sin(bestTarget.heading);
            const frontalAlignment = (shotDx / shotLen) * noseX + (shotDy / shotLen) * noseY;
            if (frontalAlignment > 0.5) {
              let effectiveDeflect =
                bestTarget.kind === 'CRUSHER' && this.waveNumber <= 6 ? 0.6 : 0.7;
              if (bestTarget.armorShredTimer > 0) effectiveDeflect *= 0.5;
              if (bestTarget.burnArmorMeltTimer > 0) effectiveDeflect *= 0.65;
              const defMult = 1 - effectiveDeflect + effectiveDeflect * cappedAp;
              dmg *= defMult;
              if (cappedAp < 0.5 && effectiveDeflect > 0.35) {
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

          // Phase 1 Sentry TWIN-LINK: 2-target splash (40% damage within 65px)!
          if (isTwinLink && dmg > 0) {
            const splashDmg = dmg * 0.4;
            let splashed = 0;
            for (const other of this.hostiles) {
              if (other.id === bestTarget.id || other.hp <= 0) continue;
              if (
                Math.hypot(other.pos.x - bestTarget.pos.x, other.pos.y - bestTarget.pos.y) <=
                65 + other.radiusPx
              ) {
                other.hp -= splashDmg;
                if (other.hp <= 0) t.kills += 1;
                this.spawnSparks(other.pos, 2, '#FFB000');
                splashed++;
                if (splashed >= 2) break;
              }
            }
          }
        }

        const spread = missed
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
          ricochet: ricochet || missed,
          overclocked: isOverclocked,
        });
        if (!ricochet && !missed) {
          this.spawnSparks(bestTarget.pos, 3, bestTarget.illuminated ? '#8EF5AB' : '#44FF77');
        }
      } else if (t.kind === 'RAIL_LANCE') {
        const isOverpen = t.level === 3 && t.mk3Branch === 'A';
        const isCapacitor = t.level === 3 && t.mk3Branch === 'B';
        const baseCd = (t.level >= 2 ? 1.32 : 1.72) * (isCapacitor ? 0.65 : 1.0);
        t.fireCooldown += ((baseCd * ocSpeedMult) / rofSpeedMult) * acidRofMult;
        t.firingFlashTimer = 0.24;
        t.heat = Math.min(100, t.heat + 18 * ocHeatMult * heatMutMult);
        if (t.heat >= 100) {
          t.thermalLocked = true;
          this.audioCb.onThermalSteam(this.panFromVirtualX(t.pos.x));
          this.pushLog(`RAIL-LANCE ${t.callsign} THERMAL LOCK — COOLING RAILS!`);
        }

        const aimAng = Math.atan2(bestTarget.pos.y - t.pos.y, bestTarget.pos.x - t.pos.x);
        const beamEnd = this.castSightRay(t.pos, aimAng, fullRange);
        // Phase 1: OVERPEN pierce capped 99 -> 12
        const maxPierce = isOverpen ? 12 : t.level >= 2 ? 5 : 4;
        const baseRailRaw =
          (t.level >= 2 ? 155 : 112) * (isOverpen ? 1.4 : 1.0) * mk4DmgMult * globalDmgMult;
        const duStacks = this.getProtocolStacks('DU_ROUNDS');
        // Rail already pierces 100% armor: DU_ROUNDS AP excess converts at 50% into boss bonus DMG!
        const railBossExcessMult = duStacks > 0 ? 1 + duStacks * 0.25 * 0.5 : 1.0;

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

          // Phase 1: 10% Rail dark miss chance (unless illuminated, burning, or NIGHT_HUNTER_OPTICS!)
          const visuallyLit = h.illuminated || h.napalmBurnTimer > 0;
          if (!visuallyLit && !nightHunter && Math.random() < PERIMETER_CONSTANTS.RAIL_DARK_MISS_CHANCE) {
            continue;
          }
          // Phase 1 Stalker: 50% evasion when not optically revealed
          if (h.kind === 'STALKER' && !h.opticalIlluminated && Math.random() < 0.5) {
            continue;
          }

          // P0 #11 + Phase 2: Evaluate h.illuminated & Deep Freeze shatter PER PIERCED TARGET!
          const bucketRes = this.computeAdditiveCombatBucket(t, h, true);
          const nightBonus = nightHunter && !h.illuminated ? 1.35 : 1.0;
          const bossBonus = h.isBoss ? railBossExcessMult : 1.0;
          const pierceFalloff = pierced === 0 ? 1.0 : isOverpen ? 0.92 : 0.78;
          const shotDmg = baseRailRaw * bucketRes.mult * nightBonus * bossBonus * pierceFalloff;

          if (bucketRes.triggeredShatter) {
            this.audioCb.onShatterCrunch(pan);
          }

          h.hp -= shotDmg;

          // Phase 2 THERMAL_SHOCK Omega Directive: Rail hitting Burning foe -> 8% max-HP detonation!
          if (
            this.hasOmega('THERMAL_SHOCK') &&
            h.hp > 0 &&
            h.napalmBurnTimer > 0 &&
            h.thermalShockIcd <= 0
          ) {
            this.triggerThermalShock(h, t);
          }

          if (isCapacitor && h.hp > 0) {
            const cancelledCharge = h.chargeActiveTimer > 0 || h.chargeTelegraphTimer > 0;
            h.chargeActiveTimer = 0;
            h.chargeTelegraphTimer = 0;
            const appliedStun = this.applyHostileStun(
              h,
              h.isBoss ? 0.48 : h.kind === 'PRAETORIAN' ? 0.75 : 0.72
            );
            if (cancelledCharge || (h.isBoss && appliedStun)) {
              this.callouts.push({
                pos: { x: h.pos.x, y: h.pos.y - h.radiusPx - 12 },
                text: cancelledCharge ? '⚡ CHARGE STAGGERED!' : '⚡ STAGGERED!',
                color: '#00F0FF',
                life: 0.85,
                maxLife: 0.85,
              });
            }
          }
          if (h.hp <= 0) t.kills += 1;
          this.spawnSparks(h.pos, 8, '#00F0FF');
          pierced++;
        }

        // Also cleave any Queen Egg Sacs along the rail beam!
        for (let ei = this.eggSacs.length - 1; ei >= 0; ei--) {
          const sac = this.eggSacs[ei];
          if (this.pointToSegmentDist(sac.pos, t.pos, beamEnd) <= 22 && this.hasLineOfSight(t.pos, sac.pos)) {
            sac.hp -= baseRailRaw * (1 + duStacks * 0.15);
            this.spawnSparks(sac.pos, 6, '#00F0FF');
            if (sac.hp <= 0) {
              this.eggSacs.splice(ei, 1);
              this.addSalvageScrap(10, true);
            }
          }
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
        t.fireCooldown += ((0.62 * ocSpeedMult) / rofSpeedMult) * acidRofMult;
        t.firingFlashTimer = 0.25;
        t.heat = Math.min(100, t.heat + 16.5 * ocHeatMult * heatMutMult);
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
        // Phase 1 & 2: Retuned base DPS (64 / 88 / 140) + THERMITE_CATALYST +25%/stack!
        const thermProto = 1 + this.getProtocolStacks('THERMITE_CATALYST') * 0.25;
        const baseBurnDps = isThermite ? 140 : t.level >= 2 ? 88 : 64;

        this.napalmClouds.push({
          pos: cloudPos,
          radius: (t.level >= 2 ? 78 : 64) * (isFirewall ? 1.45 : 1.0),
          remainingSec: isFirewall ? 5.2 : 3.4,
          maxSec: isFirewall ? 5.2 : 3.4,
          dps: baseBurnDps * thermProto * mk4DmgMult * globalDmgMult,
          isThermite,
          isFirewall,
          sourceTurretId: t.id,
        });
        this.audioCb.onIncinerator(
          this.panFromVirtualX(t.pos.x),
          this.distNormFromCore(cloudPos)
        );
        this.spawnSparks(cloudPos, 8, '#FFB000');
      }
    }

    if (relayLinkDirty) {
      this.recomputeRelayLinks();
    }
  }

  private stepHostiles(dt: number): void {
    const ts = this.blueprint.tileSize;
    const mapW = this.getMapWidthPx();
    const mapH = this.getMapHeightPx();
    const hpScale = this.currentWaveDef.hpScale ?? getWaveHpScale(this.waveNumber);
    const armorStacks = this.getProtocolStacks('BULKHEAD_ARMOR');

    for (let i = this.hostiles.length - 1; i >= 0; i--) {
      const h = this.hostiles[i];
      if (!h) continue;

      // Check death first
      if (h.hp <= 0) {
        this.handleHostileKilled(h);
        this.hostiles.splice(i, 1);
        continue;
      }

      // P0 #1 Safety Nudge: if any hostile sits on an impassable tile, push cleanly to nearest passable tile!
      const curCol = Math.floor(h.pos.x / ts);
      const curRow = Math.floor(h.pos.y / ts);
      if (!this.pathfinder.isPassableCell(this.blueprint, this.doors, curCol, curRow)) {
        this.nudgeHostileToPassableCell(h, true);
      }

      // Apply active decompression knockback slide smoothly even while stunned
      if (h.knockbackTimer && h.knockbackTimer > 0) {
        this.stepHostileKnockback(h, dt);
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
        i = Math.min(i, this.hostiles.length);
        continue;
      }

      // Phase 1: 3-Tier Flow-Field Pathfinding (standard / sapper / heavy)
      const tier = FlowFieldPathfinder.tierForHostile(h.kind);
      const nav = this.pathfinder.sampleDirection(this.blueprint, this.doors, h.pos, tier);

      // Special Caste Tactical Abilities
      if (h.abilityCooldown > 0) h.abilityCooldown = Math.max(0, h.abilityCooldown - dt);
      if (h.cryoSlowTimer <= 0) h.cryoDeepFreeze = false;

      if (h.kind === 'SPITTER' && h.abilityCooldown <= 0 && h.silenceTimer <= 0) {
        // P0 #2 + Phase 1: 320px Spitter range + ignoreDoorId LOS fix so Spitters actually corrode welded doors!
        let spitTargetPos: Vec2 | null = null;
        let spitDoorId: string | undefined;
        let spitTurretId: string | undefined;
        let bestD = 320;
        for (const ds of this.doors.values()) {
          if (!ds.welded) continue;
          const d = Math.hypot(ds.def.center.x - h.pos.x, ds.def.center.y - h.pos.y);
          if (d < bestD && this.hasLineOfSight(h.pos, ds.def.center, ds.def.id)) {
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
          const spitId = this.nextHostileId++;
          this.acidSpits.push({
            id: spitId,
            pos: { ...h.pos },
            targetPos: spitTargetPos,
            vel: { x: (dx / dist) * spd, y: (dy / dist) * spd },
            life: dist / spd + 0.12,
            maxLife: dist / spd + 0.12,
            targetDoorId: spitDoorId,
            targetTurretId: spitTurretId,
          });
          this.acidSpitOwners.set(spitId, h.id);
          this.audioCb.onAcidSizzle(this.panFromVirtualX(h.pos.x));
        }
      } else if (h.kind === 'SCREAMER' && h.abilityCooldown <= 0 && h.silenceTimer <= 0) {
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
        if (jammedAny) {
          // Phase 1: Screamer jam immediately disables relayBoosted & relayMatrixBoosted!
          this.recomputeRelayLinks();
        }
        for (let p = 0; p < 3; p++) {
          const ang = Math.random() * Math.PI * 2;
          const rad = 75 + Math.random() * 145;
          this.phantomBlips.push({
            pos: {
              x: Math.max(90, Math.min(mapW - 90, h.pos.x + Math.cos(ang) * rad)),
              y: Math.max(90, Math.min(mapH - 90, h.pos.y + Math.sin(ang) * rad)),
            },
            life: 2.6,
            maxLife: 2.6,
          });
        }
        this.audioCb.onAlienScreech(
          'SWARM',
          'SCREAMER',
          this.panFromVirtualX(h.pos.x),
          this.distNormFromCore(h.pos)
        );
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
            this.audioCb.onAlienScreech(
              'SWARM',
              'CRUSHER',
              this.panFromVirtualX(h.pos.x),
              this.distNormFromCore(h.pos)
            );
          }
          continue;
        }
        if (h.chargeActiveTimer > 0) {
          h.chargeActiveTimer = Math.max(0, h.chargeActiveTimer - dt);
        } else if (h.abilityCooldown <= 0) {
          // P0 #4 + Phase 1: Allow Crusher charges against welded doors (5s battering-ram cycle)
          // AND allow initiating charge while chilled with +30% telegraph!
          const chilledTelegraphMult = h.cryoSlowTimer > 0 ? 1.3 : 1.0;
          if (nav.batteringDoor) {
            h.abilityCooldown = 5.0;
            h.chargeTelegraphTimer = 1.05 * chilledTelegraphMult;
            this.callouts.push({
              pos: { x: h.pos.x, y: h.pos.y - 28 },
              text: '⚠ DOOR RAM CHARGE!',
              color: '#FF5522',
              life: 1.1,
              maxLife: 1.1,
            });
          } else {
            h.abilityCooldown = 6.6;
            h.chargeTelegraphTimer = 1.05 * chilledTelegraphMult;
            this.callouts.push({
              pos: { x: h.pos.x, y: h.pos.y - 28 },
              text: '⚠ CRUSHER CHARGE!',
              color: '#FF5522',
              life: 1.1,
              maxLife: 1.1,
            });
          }
        }
      } else if (h.kind === 'QUEEN' && h.silenceTimer <= 0) {
        // Phase 1: Scale Egg Sac HP (85 * hpScale * 0.5, floor 85) + respect EMP caster silence!
        const scaledEggHp = Math.max(85, Math.round(85 * hpScale * 0.5));
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
              hp: scaledEggHp,
              maxHp: scaledEggHp,
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
            text: '★ EGG CLUTCH LAID — DESTROY THEM! ★',
            color: '#C8FF44',
            life: 2.0,
            maxLife: 2.0,
          });
          this.pushLog('ALERT // MATRIARCH QUEEN LAID EGG CLUTCH — DESTROY BEFORE HATCH!');
        } else if (h.abilityCooldown <= 0 && this.eggSacs.length < 7) {
          h.abilityCooldown = 7.2;
          this.eggSacs.push({
            id: this.nextHostileId++,
            pos: { x: h.pos.x, y: h.pos.y },
            hp: scaledEggHp,
            maxHp: scaledEggHp,
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
        h.doorBatterTimer += dt;
        h.heading = Math.atan2(
          nav.batteringDoor.def.center.y - h.pos.y,
          nav.batteringDoor.def.center.x - h.pos.x
        );

        // Phase 1 Burster Door-Detonation: battering a welded door >= 1.5s acid-detonates!
        if (h.kind === 'BURSTER' && h.doorBatterTimer >= 1.5) {
          const targetDoor = nav.batteringDoor;
          const surge = this.activeMutator === 'ACIDIC_SURGE';
          this.acidPools.push({
            pos: { ...targetDoor.def.center },
            radius: 88,
            remainingSec: surge ? 12.0 : 9.0,
            maxSec: surge ? 12.0 : 9.0,
            fromBursterDoorBlast: true,
          });
          this.audioCb.onAcidSizzle(this.panFromVirtualX(targetDoor.def.center.x));
          this.spawnSparks(targetDoor.def.center, 18, '#B8FF3B');
          this.callouts.push({
            pos: { x: targetDoor.def.center.x, y: targetDoor.def.center.y - 20 },
            text: 'ACID BREACH BLAST (-110)!',
            color: '#B8FF3B',
            life: 1.5,
            maxLife: 1.5,
          });
          this.pushLog(`ALERT // ACID BURSTER DETONATED ON BULKHEAD ${targetDoor.def.id}!`);
          this.applyDoorDamage(targetDoor, 110, 'BREACHED BY ACID BURSTER DETONATION');
          this.hostiles.splice(i, 1);
          continue;
        }

        // Phase 2 BULKHEAD_ARMOR Electrified Bulkheads: 55 DPS melee recoil per stack!
        if (armorStacks > 0) {
          h.hp -= 55 * armorStacks * dt;
          if (Math.random() < dt * 6) {
            this.spawnSparks(h.pos, 3, '#00F0FF');
          }
          if (h.hp <= 0) {
            this.handleHostileKilled(h);
            this.hostiles.splice(i, 1);
            continue;
          }
        }

        const spec = HOSTILE_SPECS[h.kind];
        const slowFactor =
          h.cryoSlowTimer > 0
            ? h.isBoss
              ? h.cryoDeepFreeze
                ? 0.64
                : 0.71
              : h.cryoDeepFreeze
                ? 0.28
                : 0.45
            : 1.0;
        const chargeBonus = h.chargeActiveTimer > 0 ? 2.4 : 1.0;
        const deepDoorMult =
          this.waveNumber <= 10 ? 1.0 : 1.0 + (this.waveNumber - 10) * 0.05;
        const doorDmg = spec.doorDps * slowFactor * chargeBonus * deepDoorMult * dt;
        nav.batteringDoor.underAttackTimer = 0.28;

        if (
          nav.batteringDoor.hp - doorDmg > 0 &&
          nav.batteringDoor.hp - doorDmg < nav.batteringDoor.maxHp * 0.3
        ) {
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

        this.applyDoorDamage(nav.batteringDoor, doorDmg, `BATTERED BY ${spec.name}`);
        continue;
      }

      h.batteringDoorId = null;
      h.doorBatterTimer = 0;
      h.weavePhase += dt * (h.kind === 'SKITTERER' ? 11.5 : 4.2);

      let dirX = nav.dir.x;
      let dirY = nav.dir.y;

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

      // Phase 1 Cryo Boss 50% slow resist (29% Cryo / 36% Deep Freeze vs Boss),
      // Crusher active charge slowed 30% by Cryo instead of hard-cancelled, and Firewall -25% slow!
      let speedMult = 1.0;
      if (h.chargeActiveTimer > 0) {
        speedMult = 2.55 * (h.cryoSlowTimer > 0 ? 0.7 : 1.0);
      } else if (h.cryoSlowTimer > 0) {
        if (h.isBoss) {
          speedMult = h.cryoDeepFreeze ? 0.64 : 0.71;
        } else {
          speedMult = h.cryoDeepFreeze ? 0.28 : 0.42;
        }
      }
      if (h.firewallSlowTimer && h.firewallSlowTimer > 0) {
        speedMult *= h.isBoss ? 0.875 : 0.75;
      }

      const moveSpd = h.speedPxS * speedMult;
      const nextX = h.pos.x + dirX * moveSpd * dt;
      const nextY = h.pos.y + dirY * moveSpd * dt;

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
    const baseScrap = spec.scrapReward * this.getWaveSalvageYieldMult();
    // Phase 2 SALVAGE_BONUS fractional accumulator (+25%/stack)
    const scrapGain = Math.max(1, this.addSalvageScrap(baseScrap, true));
    const scoreGain = Math.round(spec.scoreValue * this.getActiveScoreMultiplier());
    this.totalKills += 1;
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
    if (this.trainingMode) {
      this.sealLostFlashTimer = 1.1;
      this.audioCb.onSyncGlitch(0.45);
      this.spawnSparks(this.blueprint.coreCenter, 18, '#00F0FF');
      for (let i = this.hostiles.length - 1; i >= 0; i--) {
        const other = this.hostiles[i];
        if (
          Math.hypot(
            other.pos.x - this.blueprint.coreCenter.x,
            other.pos.y - this.blueprint.coreCenter.y
          ) <= 180
        ) {
          this.hostiles.splice(i, 1);
        }
      }
      this.pushLog(
        `SIMULATION SHIELD HELD // REPULSED ${HOSTILE_SPECS[breacher.kind].name} AT CORE (TRAINING MODE)`
      );
      return;
    }

    // Phase 2 AEGIS_SHIELD: rechargeable 1-hit Core Energy Barrier absorbs breach without losing a Seal!
    if (this.aegisBarrierReady && this.aegisBarrierCharges > 0) {
      this.aegisBarrierCharges -= 1;
      this.aegisBarrierReady = this.aegisBarrierCharges > 0;
      if (this.aegisRechargeWavesRemaining <= 0) {
        this.aegisRechargeWavesRemaining = 5;
      }
      this.sealLostFlashTimer = 1.4;
      this.audioCb.onReactorBreaker(false);
      this.audioCb.onSyncGlitch(0.6);
      this.spawnSparks(this.blueprint.coreCenter, 26, '#00F0FF');
      for (let i = this.hostiles.length - 1; i >= 0; i--) {
        const other = this.hostiles[i];
        if (
          Math.hypot(
            other.pos.x - this.blueprint.coreCenter.x,
            other.pos.y - this.blueprint.coreCenter.y
          ) <= 170
        ) {
          this.hostiles.splice(i, 1);
        }
      }
      this.callouts.push({
        pos: { x: this.blueprint.coreCenter.x, y: this.blueprint.coreCenter.y - 34 },
        text: '★ AEGIS BARRIER ABSORBED BREACH! ★',
        color: '#00F0FF',
        life: 2.2,
        maxLife: 2.2,
      });
      this.pushLog(
        `★ AEGIS CORE ENERGY BARRIER ABSORBED ${HOSTILE_SPECS[breacher.kind].name} // RECHARGES IN ${this.aegisRechargeWavesRemaining} WAVES! ★`
      );
      return;
    }

    this.bulkheadSeals = Math.max(0, this.bulkheadSeals - 1);
    this.sealLostThisWave = true;
    this.perfectWaveStreak = 0;
    this.sealLostFlashTimer = 2.5;
    this.sealConcussionFlashTimer = 0.85;
    this.screenShake = Math.max(this.screenShake, 18);
    this.pushCrtShockwave(
      this.blueprint.coreCenter.x,
      this.blueprint.coreCenter.y,
      0.56,
      1.0,
      0.92
    );
    this.coreBreachBlasts.push({
      x: this.blueprint.coreCenter.x,
      y: this.blueprint.coreCenter.y,
      age: 0,
      duration: 0.78,
      maxRadius: 290,
      coreRadius: 72,
    });
    this.audioCb.onCoreSealBreach(this.panFromVirtualX(this.blueprint.coreCenter.x));
    this.audioCb.onSyncGlitch(0.95);
    this.spawnExplosiveSparks(this.blueprint.coreCenter, 38, '#FF3318', 95, 360, 0.34, 0.78);
    this.spawnExplosiveSparks(this.blueprint.coreCenter, 24, '#FFB000', 70, 270, 0.28, 0.65);
    this.callouts.push({
      pos: { x: this.blueprint.coreCenter.x, y: this.blueprint.coreCenter.y - 44 },
      text:
        this.bulkheadSeals <= 0
          ? '!! FINAL CORE SEAL BREACHED !!'
          : `!! CORE SEAL BLOWN (${this.bulkheadSeals}/3 LEFT) !!`,
      color: '#FF3318',
      life: 2.3,
      maxLife: 2.3,
    });

    if (this.bulkheadSeals <= 0) {
      this.phase = 'CORE_BREACHED';
      this.pushLog('CRITICAL // ALL 3 REACTOR CORE BULKHEAD SEALS BREACHED — COLONY SECTOR LOST!');
      return;
    }

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
    if (!this.sealLostThisWave) {
      this.perfectWaveStreak += 1;
    }

    // Phase 2: Active mutators grant +20% Wave Clear Scrap (+ SALVAGE_BONUS fractional Scrap)!
    const mutScrapMult = WAVE_MUTATORS[this.activeMutator]?.scrapMult ?? 1.0;
    const bonus = this.addSalvageScrap(this.currentWaveDef.scrapBonus * mutScrapMult, true);
    const wavePts = Math.round(
      (this.waveNumber * 500 + this.bulkheadSeals * 250) * this.getActiveScoreMultiplier()
    );
    this.score += wavePts;
    this.audioCb.onWaveClear();

    // Cleanly finalize any in-progress mid-wave reloads/welds/spin-ups & reset overload
    this.overloadTimer = 0;
    this.blackoutTimer = 0;
    this.grateTelegraphs = [];
    this.acidSpits = [];
    this.acidSpitOwners.clear();
    this.phantomBlips = [];
    this.resupplyPurchasesThisWave = 0;
    this.claymoresRemainingThisWave = this.getClaymoreStockPerWave();
    for (const t of this.turrets) {
      t.acidDebuffTimer = 0;
      t.jammedTimer = 0;
      t.powerUpTimer = 0;
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
        ds.lastPathHpBand = 4;
        doorsChanged = true;
      }
    }
    if (doorsChanged) {
      this.recomputePathfinder(false);
      this.recomputeRelayLinks();
    } else {
      // Clear wave congestion weights for clean Prep route previews
      this.recomputePathfinder(false);
    }

    // P0 #5: Separate autoReactorUnlocks (0..6 on W2..W12) from maxReactorKw so AUX_BUS/Scrap NEVER cannibalize free unlocks!
    if (this.waveNumber % 2 === 0 && this.autoReactorUnlocks < MAX_AUTO_REACTOR_UNLOCKS) {
      this.autoReactorUnlocks += 1;
      const cap = this.getEffectiveMaxReactorCap();
      this.maxReactorKw = Math.min(cap, this.maxReactorKw + 15);
      this.pushLog(
        `AUXILIARY REACTOR BUS UNLOCKED [${this.autoReactorUnlocks}/${MAX_AUTO_REACTOR_UNLOCKS}] // MAX CAPACITY NOW ${this.maxReactorKw} kW!`
      );
    }

    // Phase 2 AEGIS_SHIELD: tick 5-wave barrier recharge counter
    const aegisStacks = this.getProtocolStacks('AEGIS_SHIELD');
    if (aegisStacks > 0 && this.aegisBarrierCharges < aegisStacks) {
      this.aegisRechargeWavesRemaining = Math.max(0, this.aegisRechargeWavesRemaining - 1);
      if (this.aegisRechargeWavesRemaining <= 0) {
        this.aegisBarrierCharges += 1;
        this.aegisBarrierReady = true;
        if (this.aegisBarrierCharges < aegisStacks) {
          this.aegisRechargeWavesRemaining = 5;
        }
        this.spawnSparks(this.blueprint.coreCenter, 18, '#00F0FF');
        this.pushLog('★ AEGIS CORE ENERGY BARRIER RECHARGED — 1-HIT PROTECTION ONLINE! ★');
      }
    }

    if (this.waveNumber % 10 === 0) {
      const crt1979Mult = this.ranked1979Bonus && !this.trainingMode ? 1.5 : 1.0;
      const milestoneBonus = Math.round(this.bulkheadSeals * 1500 * crt1979Mult);
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

    // Post-Queen Sector Extraction on W11/21/31+ across SEC-01 -> SEC-02 -> SEC-03
    const nextSectorId = getSectorIdForWave(this.waveNumber);
    if (nextSectorId !== this.blueprint.sectorId) {
      this.performSectorExtraction(nextSectorId);
    }

    this.currentWaveDef = getWaveDefinition(this.waveNumber, this.blueprint.sectorId);
    this.activeMutator = this.currentWaveDef.mutator ?? 'NONE';
    this.purgeChargesRemaining = Math.max(1, this.purgeChargesRemaining);
    this.purgeAvailableThisWave = this.purgeChargesRemaining > 0;
    this.refreshPendingBreaches();

    // Trigger Boss-Milestone Omega Directive (W5, W10, W15, W20...) AND/OR Protocol Draft (every 3 waves)!
    const wantsOmega = clearedWave % 5 === 0;
    const wantsProtocol = clearedWave % 3 === 0;
    this.pendingProtocolDraftAfterOmega = false;

    if (wantsOmega && this.openOmegaDraftModal()) {
      if (wantsProtocol) {
        this.pendingProtocolDraftAfterOmega = true;
      }
    } else if (wantsProtocol) {
      this.openProtocolDraftModal();
    } else {
      this.draftMode = 'PROTOCOL';
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

  private pushCrtShockwave(
    x: number,
    y: number,
    maxRadiusNorm: number,
    peakIntensity: number,
    duration: number
  ): void {
    if (this.crtShockwaves.length >= 4) {
      this.crtShockwaves.shift();
    }
    this.crtShockwaves.push({
      x,
      y,
      age: 0,
      duration,
      maxRadiusNorm,
      peakIntensity,
    });
  }

  private spawnExplosiveSparks(
    origin: Vec2,
    count: number,
    color: string,
    speedMin: number,
    speedMax: number,
    lifeMin: number,
    lifeMax: number
  ): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = speedMin + Math.random() * Math.max(1, speedMax - speedMin);
      const life = lifeMin + Math.random() * Math.max(0.05, lifeMax - lifeMin);
      this.sparks.push({
        pos: { x: origin.x, y: origin.y },
        vel: { x: Math.cos(a) * spd, y: Math.sin(a) * spd },
        color,
        life,
        maxLife: life,
      });
    }
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
