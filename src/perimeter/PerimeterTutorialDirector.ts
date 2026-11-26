import type { Vec2 } from '../types';
import type { PerimeterSimulation } from './PerimeterSimulation';
import { PERIMETER_CONSTANTS } from './types';

export interface TutorialMapBeacon {
  pos: Vec2;
  label: string;
  color: string;
  radiusPx?: number;
}

export interface TutorialObjectiveItem {
  text: string;
  done: boolean;
}

export interface TutorialDirectiveSnapshot {
  active: boolean;
  graduated: boolean;
  stepIndex: number; // 0..8
  totalSteps: number; // 9
  code: string;
  title: string;
  briefingLines: string[];
  objectives: TutorialObjectiveItem[];
  beacons: TutorialMapBeacon[];
  highlightButtonIds: string[];
  wikiChapterIdx: number;
  showContinueBtn: boolean;
  continueLabel: string;
}

/**
 * Interactive 9-Stage USCM Tactical Combat Training Drill for Hadley's Perimeter.
 * Runs live inside the real Sector 01 simulation (unranked, core-seal shielded)
 * so brand-new players learn every weapon, combo, vision mechanic, door weld,
 * airlock purge, battery ability, and MK-III branch hands-on!
 */
export class PerimeterTutorialDirector {
  public active = false;
  public graduated = false;
  private stepIdx = 0;
  private readonly totalSteps = 9;

  // Per-stage milestone trackers
  private stepElapsedSec = 0;
  private dronesSpawned = false;
  private ammoDrainTriggered = false;
  private rearmCompleted = false;
  private stalkersSpawned = false;
  private flareUsedInStep = false;
  private praetorianSpawned = false;
  private acidDemoSpawned = false;
  private coolantUsedInStep = false;
  private doorWeldedInStep = false;
  private purgeSwarmSpawned = false;
  private purgeUsedInStep = false;
  private floodUsedInStep = false;
  private overclockUsedInStep = false;
  private initialSealedDoorsCount = 0;
  private stepAdvanceDelaySec = 0;

  private tileCenter(col: number, row: number): Vec2 {
    const ts = PERIMETER_CONSTANTS.TILE_SIZE;
    return { x: col * ts + ts * 0.5, y: row * ts + ts * 0.5 };
  }

  public start(sim: PerimeterSimulation): void {
    this.active = true;
    this.graduated = false;
    this.stepIdx = 0;
    this.resetStageTrackers();

    sim.resetRun('ENDLESS_SIEGE', false);
    sim.trainingMode = true;
    sim.phase = 'TACTICAL_PREP';
    sim.scrap = 320;
    sim.maxReactorKw = 115;
    sim.reserveBattery = 45;
    sim.eventLogs = [
      'LOG> ★ USCM TACTICAL SIMULATOR INITIALIZED — UNRANKED TRAINING DRILL ★',
      'LOG> REACTOR CORE SHIELDS ENGAGED: YOU CANNOT FAIL THIS ORIENTATION.',
      'LOG> FOLLOW THE MU-TH-UR DIRECTIVE BANNER ABOVE TO MASTER SECTOR 01.',
    ];
  }

  public stop(sim: PerimeterSimulation): void {
    this.active = false;
    this.graduated = false;
    sim.trainingMode = false;
  }

  private resetStageTrackers(): void {
    this.stepElapsedSec = 0;
    this.dronesSpawned = false;
    this.ammoDrainTriggered = false;
    this.rearmCompleted = false;
    this.stalkersSpawned = false;
    this.flareUsedInStep = false;
    this.praetorianSpawned = false;
    this.acidDemoSpawned = false;
    this.coolantUsedInStep = false;
    this.doorWeldedInStep = false;
    this.purgeSwarmSpawned = false;
    this.purgeUsedInStep = false;
    this.floodUsedInStep = false;
    this.overclockUsedInStep = false;
    this.stepAdvanceDelaySec = 0;
  }

  /** Called by Cartridge when player clicks [CONTINUE] or [SKIP STEP] */
  public advanceStep(sim: PerimeterSimulation): void {
    if (!this.active || this.graduated) return;

    // Clear leftover drill enemies/spits when manually skipping so next stage is crisp
    sim.hostiles = [];
    sim.acidSpits = [];
    sim.eggSacs = [];
    sim.clearPendingSpawns();
    sim.tacticalPaused = false;

    this.stepIdx += 1;
    if (this.stepIdx >= this.totalSteps) {
      this.graduated = true;
      sim.phase = 'TACTICAL_PREP';
      sim.pushLog('★ USCM PERIMETER COMMAND DRILL COMPLETE — CLEARED FOR RANKED ENDLESS SIEGE! ★');
      return;
    }

    this.setupStage(sim, this.stepIdx);
  }

  private getPrimarySentry(sim: PerimeterSimulation) {
    return sim.turrets.find((t) => t.kind === 'SENTRY_PULSE') ?? sim.turrets[0] ?? null;
  }

  /** Computes a walkable corridor spawn point ~260–340px upstream of the player's sentry */
  private getCorridorSpawnNearSentry(sim: PerimeterSimulation): Vec2 {
    const primary = this.getPrimarySentry(sim);
    if (primary && primary.pos.x > sim.blueprint.coreCenter.x + 40) {
      // Player built on the East side — spawn in East Junction approach!
      return this.tileCenter(25, 8);
    }
    // Default West Junction approach (matches our glowing Pad beacon at [13, 7] / [14, 8])
    return this.tileCenter(6, 8);
  }

  private setupStage(sim: PerimeterSimulation, idx: number): void {
    this.resetStageTrackers();
    sim.tacticalPaused = false;
    sim.blackoutTimer = 0;
    sim.overloadTimer = 0;

    switch (idx) {
      case 1: {
        // Stage 2: Deploy & Aim Sentry
        sim.phase = 'TACTICAL_PREP';
        sim.scrap = Math.max(sim.scrap, 180);
        sim.pushLog('DRILL 02/09 // SELECT [1] UA 571-C, CLICK PAD & DRAG CONE DOWN WEST CORRIDOR.');
        break;
      }
      case 2: {
        // Stage 3: Live Contact, Pause & Rearm
        sim.phase = 'WAVE_ACTIVE';
        const sentry = this.getPrimarySentry(sim);
        if (!sentry) {
          // If skipped Stage 2, auto-place a helpful Sentry so Stage 3 works cleanly
          sim.scrap = Math.max(sim.scrap, 120);
          sim.deployHardware('SENTRY_PULSE', 14, 8, Math.PI);
        }
        const basePos = this.getCorridorSpawnNearSentry(sim);
        for (let i = 0; i < 3; i++) {
          const h = sim.spawnTrainingHostile('VENT-01', 'DRONE', {
            x: basePos.x + (basePos.x < 960 ? -i * 58 : i * 58),
            y: basePos.y + (i - 1) * 18,
          });
          h.hp = 68;
          h.maxHp = 68;
        }
        this.dronesSpawned = true;
        sim.pushLog('DRILL 03/09 // 3 XENO DRONES INBOUND! WATCH SENTRY ENGAGE — THEN TEST [E] REARM.');
        break;
      }
      case 3: {
        // Stage 4: Darkness, Cloaked Stalkers, M314 Relay + Tripwire & Flare
        sim.phase = 'WAVE_ACTIVE';
        sim.scrap = Math.max(sim.scrap, 180);
        sim.maxReactorKw = Math.max(sim.maxReactorKw, 130);
        sim.flareCooldown = 0;
        sim.pushLog('DRILL 04/09 // DEPLOY [6] M314 RELAY & DROP [F] M40 FLARE TO REVEAL STALKERS!');
        break;
      }
      case 4: {
        // Stage 5: Armor Piercing (Rail-Lance) & Cryo-Shatter Killbox
        sim.phase = 'WAVE_ACTIVE';
        sim.scrap = Math.max(sim.scrap, 340);
        sim.maxReactorKw = Math.max(sim.maxReactorKw, 175);
        sim.pushLog('DRILL 05/09 // PLACE [4] CRYO VALVE ON GRATE & [3] M99 RAIL-LANCE ON PAD!');
        break;
      }
      case 5: {
        // Stage 6: Acid Bursters, M240 Incinerator Sterilization & [C] Coolant Flush
        sim.phase = 'WAVE_ACTIVE';
        sim.scrap = Math.max(sim.scrap, 220);
        sim.maxReactorKw = Math.max(sim.maxReactorKw, 205);
        sim.coolantFlushCooldown = 0;
        // Pre-warm a turret so [C] Coolant Flush feels awesome & vents real heat!
        for (const t of sim.turrets) {
          if (t.kind === 'SENTRY_PULSE' || t.kind === 'RAIL_LANCE') {
            t.heat = Math.max(t.heat, 68);
          }
        }
        sim.pushLog('DRILL 06/09 // DEPLOY [2] M240 INCINERATOR TO STERILIZE ACID & PRESS [C] FLUSH!');
        break;
      }
      case 6: {
        // Stage 7: Arc-Weld Door Rerouting & Airlock Vent Purge
        sim.phase = 'WAVE_ACTIVE';
        sim.scrap = Math.max(sim.scrap, 180);
        sim.purgeAvailableThisWave = true;
        this.initialSealedDoorsCount = sim.getActiveSealedDoorCount();
        sim.pushLog('DRILL 07/09 // WELD ANY BLAST DOOR [7] TO REROUTE PATHS, THEN PURGE [V] AIRLOCK W-01!');
        break;
      }
      case 7: {
        // Stage 8: Reactor Reserve Battery, [L] Floodlight & [O] Overclock
        sim.phase = 'WAVE_ACTIVE';
        sim.reserveBattery = 88;
        sim.floodlightCooldown = 0;
        sim.overclockCooldown = 0;
        sim.pushLog('DRILL 08/09 // FIRE [L] EMERGENCY FLOODLIGHT (60% BAT) & [O] OVERCLOCK ON A TURRET!');
        break;
      }
      case 8: {
        // Stage 9: MK-II & Branching MK-III Specializations
        sim.phase = 'TACTICAL_PREP';
        sim.scrap = Math.max(sim.scrap, 620);
        sim.maxReactorKw = Math.max(sim.maxReactorKw, 250);
        if (sim.turrets.length === 0) {
          sim.deployHardware('SENTRY_PULSE', 14, 8, Math.PI);
        }
        sim.pushLog('DRILL 09/09 // CLICK ANY TURRET -> UPGRADE MK-II [U] -> PICK MK-III BRANCH A OR B!');
        break;
      }
    }
  }

  public notifyAbilityUsed(
    abilityId: 'FLARE' | 'OVERCLOCK' | 'PURGE' | 'FLOODLIGHT' | 'COOLANT_FLUSH'
  ): void {
    if (!this.active || this.graduated) return;
    if (this.stepIdx === 3 && abilityId === 'FLARE') {
      this.flareUsedInStep = true;
    } else if (this.stepIdx === 5 && abilityId === 'COOLANT_FLUSH') {
      this.coolantUsedInStep = true;
    } else if (this.stepIdx === 6 && abilityId === 'PURGE') {
      this.purgeUsedInStep = true;
    } else if (this.stepIdx === 7 && abilityId === 'FLOODLIGHT') {
      this.floodUsedInStep = true;
    } else if (this.stepIdx === 7 && abilityId === 'OVERCLOCK') {
      this.overclockUsedInStep = true;
    }
  }

  public notifyRearmTriggered(): void {
    if (!this.active || this.graduated) return;
    if (this.stepIdx === 2 && this.ammoDrainTriggered) {
      this.rearmCompleted = true;
    }
  }

  public step(sim: PerimeterSimulation, dt: number): void {
    if (!this.active || this.graduated) return;
    this.stepElapsedSec += dt;

    // Gentle auto-advance timer after completing a stage so player sees green checkmarks & hears chime
    if (this.stepAdvanceDelaySec > 0) {
      this.stepAdvanceDelaySec -= dt;
      if (this.stepAdvanceDelaySec <= 0) {
        this.advanceStep(sim);
      }
      return;
    }

    // Keep Scrap topped up gently if player recycled or spent elsewhere so drill can never stall
    if (this.stepIdx === 1 && sim.scrap < 100 && !sim.turrets.some((t) => t.kind === 'SENTRY_PULSE')) {
      sim.scrap = 120;
    } else if (this.stepIdx === 3 && sim.scrap < 65 && !sim.turrets.some((t) => t.kind === 'MOTION_RELAY')) {
      sim.scrap = 85;
    } else if (this.stepIdx === 4 && sim.scrap < 160) {
      const hasCryo = sim.turrets.some((t) => t.kind === 'CRYO_VALVE');
      const hasRail = sim.turrets.some((t) => t.kind === 'RAIL_LANCE');
      if (!hasCryo || !hasRail) sim.scrap = Math.max(sim.scrap, 240);
    } else if (this.stepIdx === 5 && sim.scrap < 130 && !sim.turrets.some((t) => t.kind === 'INCINERATOR')) {
      sim.scrap = 150;
    } else if (this.stepIdx === 6 && sim.scrap < 60 && !this.doorWeldedInStep) {
      sim.scrap = 75;
    } else if (this.stepIdx === 8 && sim.scrap < 300 && !sim.turrets.some((t) => t.level === 3)) {
      sim.scrap = 500;
    }

    switch (this.stepIdx) {
      case 0:
        // Orientation: waits for player to click [BEGIN DRILL]
        break;

      case 1: {
        // Stage 2: Place a UA 571-C Sentry
        if (sim.turrets.some((t) => t.kind === 'SENTRY_PULSE')) {
          this.triggerStageSuccess(sim, 'UA 571-C SENTRY ONLINE — PREPARING LIVE CONTACT!');
        }
        break;
      }

      case 2: {
        // Stage 3: Kill 3 Drones -> drain ammo -> practice [E] Rearm!
        if (this.dronesSpawned && !this.ammoDrainTriggered && sim.hostiles.length === 0) {
          this.ammoDrainTriggered = true;
          const s = this.getPrimarySentry(sim);
          if (s && s.kind === 'SENTRY_PULSE') {
            s.ammo = Math.min(s.ammo, 68);
            sim.scrap = Math.max(sim.scrap, 120);
            sim.pushLog('DRILL // DRONES ELIMINATED! SENTRY LOW ON AMMO — PRESS [E] OR CLICK REARM!');
          } else {
            this.rearmCompleted = true;
          }
        }
        const sCheck = this.getPrimarySentry(sim);
        if (
          this.ammoDrainTriggered &&
          (this.rearmCompleted ||
            (sCheck && (sCheck.rearmTimer > 0 || sCheck.ammo >= sCheck.maxAmmo)))
        ) {
          this.rearmCompleted = true;
          this.triggerStageSuccess(sim, 'BELT-LOADER REARM VERIFIED — ADVANCING TO DARKNESS DRILL!');
        }
        break;
      }

      case 3: {
        // Stage 4: Place M314 Relay + Drop M40 Flare + Kill 2 Cloaked Stalkers!
        const hasRelay = sim.turrets.some((t) => t.kind === 'MOTION_RELAY');
        if (sim.flares.length > 0) this.flareUsedInStep = true;

        if ((hasRelay || this.flareUsedInStep) && !this.stalkersSpawned) {
          this.stalkersSpawned = true;
          const basePos = this.getCorridorSpawnNearSentry(sim);
          for (let i = 0; i < 2; i++) {
            const st = sim.spawnTrainingHostile('VENT-01', 'STALKER', {
              x: basePos.x + (basePos.x < 960 ? -i * 68 : i * 68),
              y: basePos.y + (i === 0 ? -12 : 12),
            });
            st.hp = 80;
            st.maxHp = 80;
          }
          sim.pushLog('DRILL // 2 CLOAKED SIGNAL STALKERS INBOUND! ILLUMINATE THEM WITH M314 OR [F] FLARE!');
        }

        if (hasRelay && this.flareUsedInStep && this.stalkersSpawned && sim.hostiles.length === 0) {
          this.triggerStageSuccess(sim, 'STALKERS DECLOAKED & ELIMINATED — EXCELLENT SENSOR WORK!');
        }
        break;
      }

      case 4: {
        // Stage 5: Place Cryo Valve + Rail-Lance -> Eliminate Armored Praetorian!
        const hasCryo = sim.turrets.some((t) => t.kind === 'CRYO_VALVE');
        const hasRail = sim.turrets.some((t) => t.kind === 'RAIL_LANCE');
        if (hasCryo && hasRail && !this.praetorianSpawned) {
          this.praetorianSpawned = true;
          const basePos = this.getCorridorSpawnNearSentry(sim);
          const prt = sim.spawnTrainingHostile('VENT-01', 'PRAETORIAN', {
            x: basePos.x,
            y: basePos.y,
          });
          prt.hp = 290;
          prt.maxHp = 290;
          sim.pushLog('DRILL // ARMORED PRAETORIAN APPROACHING! WATCH CRYO + RAIL-LANCE SHATTER IT!');
        }
        if (hasCryo && hasRail && this.praetorianSpawned && sim.hostiles.length === 0) {
          this.triggerStageSuccess(sim, 'ARMORED PRAETORIAN SHATTERED — KILLBOX SYNERGY CONFIRMED!');
        }
        break;
      }

      case 5: {
        // Stage 6: Deploy M240 Incinerator (sterilize Acid Pool + burn Bursters) & trigger [C] Flush!
        const incin = sim.turrets.find((t) => t.kind === 'INCINERATOR');
        if (incin && !this.acidDemoSpawned) {
          this.acidDemoSpawned = true;
          const aimX = incin.pos.x + Math.cos(incin.angle) * 115;
          const aimY = incin.pos.y + Math.sin(incin.angle) * 115;
          sim.spawnTrainingAcidPool({ x: aimX, y: aimY }, 62);
          for (let i = 0; i < 2; i++) {
            const b = sim.spawnTrainingHostile('VENT-01', 'BURSTER', {
              x: aimX + (i === 0 ? -18 : 18),
              y: aimY + (i === 0 ? -10 : 10),
            });
            b.hp = 78;
            b.maxHp = 78;
          }
          sim.pushLog('DRILL // ACID BURSTERS & CORROSIVE POOL DETECTED — NAPALM STERILIZING!');
        }
        if (
          incin &&
          this.coolantUsedInStep &&
          this.acidDemoSpawned &&
          sim.hostiles.length === 0
        ) {
          this.triggerStageSuccess(sim, 'ACID STERILIZED & COOLANT MANIFOLD FLUSHED!');
        }
        break;
      }

      case 6: {
        // Stage 7: Weld 1 Blast Door [7] & Trigger [V] Airlock Purge on W-01!
        if (sim.getActiveSealedDoorCount() > this.initialSealedDoorsCount) {
          this.doorWeldedInStep = true;
        }
        if (!this.purgeSwarmSpawned && (this.doorWeldedInStep || this.stepElapsedSec > 1.0)) {
          this.purgeSwarmSpawned = true;
          const al = sim.blueprint.airlocks[0]; // AIRLOCK W-01
          if (al) {
            for (let i = 0; i < 6; i++) {
              const sk = sim.spawnTrainingHostile('VENT-01', 'SKITTERER', {
                x: al.center.x + ((i % 2) - 0.5) * 34,
                y: al.center.y + (Math.floor(i / 2) - 1) * 34,
              });
              // Keep them inside Airlock W-01 long enough for a brand-new player to click [V] Purge!
              sk.speedPxS = 18;
              sk.hp = 26;
              sk.maxHp = 26;
            }
          }
        }
        // Keep purge available until used in this stage
        if (!this.purgeUsedInStep) {
          sim.purgeAvailableThisWave = true;
        }
        if (this.doorWeldedInStep && this.purgeUsedInStep) {
          this.triggerStageSuccess(sim, 'DOOR SEALED & AIRLOCK DECOMPRESSION PURGE EXECUTED!');
        }
        break;
      }

      case 7: {
        // Stage 8: Trigger [L] Floodlight & [O] Overclock
        if (sim.floodlightTimer > 0) this.floodUsedInStep = true;
        if (sim.activeOverclockSurgeTimer > 0) this.overclockUsedInStep = true;
        if (!this.floodUsedInStep && sim.reserveBattery < 65) {
          sim.reserveBattery = 80;
        }
        if (this.floodUsedInStep && this.overclockUsedInStep) {
          this.triggerStageSuccess(sim, 'REACTOR FLOODLIGHT & OVERCLOCK SURGE MASTERED!');
        }
        break;
      }

      case 8: {
        // Stage 9: Upgrade any turret to MK-III Branch A or B
        if (sim.turrets.some((t) => t.level === 3)) {
          this.triggerStageSuccess(sim, 'MK-III SPECIALIZATION INSTALLED — CERTIFICATION EARNED!');
        }
        break;
      }
    }
  }

  private triggerStageSuccess(sim: PerimeterSimulation, msg: string): void {
    if (this.stepAdvanceDelaySec > 0) return;
    sim.audioCb.onUpgradeConfirm(this.stepIdx === this.totalSteps - 1);
    sim.pushLog(`✓ ${msg}`);
    this.stepAdvanceDelaySec = 1.35;
  }

  public getSnapshot(sim: PerimeterSimulation): TutorialDirectiveSnapshot {
    if (!this.active) {
      return {
        active: false,
        graduated: false,
        stepIndex: 0,
        totalSteps: this.totalSteps,
        code: '',
        title: '',
        briefingLines: [],
        objectives: [],
        beacons: [],
        highlightButtonIds: [],
        wikiChapterIdx: 0,
        showContinueBtn: false,
        continueLabel: '',
      };
    }

    if (this.graduated) {
      return {
        active: true,
        graduated: true,
        stepIndex: this.totalSteps,
        totalSteps: this.totalSteps,
        code: 'CERTIFIED',
        title: 'USCM PERIMETER COMMAND CERTIFICATION COMPLETE!',
        briefingLines: [
          'You have mastered Hardpoints, Vision & Tripwires, Armor Piercing, Cryo-Shatter, Napalm Sterilization, Door Rerouting, Airlock Purges, Reactor Battery Systems, and MK-III Branches!',
          'You are cleared for RANKED ENDLESS HIVE SIEGE. Watch for Protocol Drafts every 3 waves, Crushers on Wave 5, and the Matriarch Queen on Wave 10!',
        ],
        objectives: [],
        beacons: [],
        highlightButtonIds: [],
        wikiChapterIdx: 7,
        showContinueBtn: false,
        continueLabel: '',
      };
    }

    const corePos = sim.blueprint.coreCenter;
    const westPad = this.tileCenter(14, 8);
    const westRelayPad = this.tileCenter(9, 7);
    const westCryoGrate = this.tileCenter(9, 9);
    const westRailPad = this.tileCenter(13, 7);
    const westIncinPad = this.tileCenter(9, 10);
    const doorD04 = sim.doors.get('D-04')?.def.center ?? this.tileCenter(11, 8);
    const airlockW01 = sim.blueprint.airlocks[0]?.center ?? this.tileCenter(4, 8);

    switch (this.stepIdx) {
      case 0:
        return {
          active: true,
          graduated: false,
          stepIndex: 0,
          totalSteps: this.totalSteps,
          code: 'DRILL 01/09',
          title: 'ORIENTATION — PROTECT THE CORE & READ THE BLUEPRINT',
          briefingLines: [
            'Protect the glowing REACTOR CORE (center) — if 3 aliens breach it, all 3 Bulkhead Seals blow and the colony falls.',
            'Aliens emerge from orange corner VENTS & Floor Grates following the dashed lines. Place guns on [+] MOUNT PADS & Cryo/Arc on striped DUCT GRATES.',
          ],
          objectives: [
            { text: 'LEFT: Reactor kW, 3 Seals, Reserve Battery & Live Weapons Rack', done: true },
            { text: 'RIGHT: 8 Hardware Units [1-8], Command Abilities & Unit Inspector', done: true },
          ],
          beacons: [
            { pos: corePos, label: 'REACTOR CORE (3 SEALS)', color: '#44FF77', radiusPx: 54 },
            { pos: this.tileCenter(1, 2), label: 'ALIEN BREACH VENT', color: '#FFB000', radiusPx: 36 },
            { pos: westRelayPad, label: '[+] MOUNT PAD', color: '#00F0FF', radiusPx: 30 },
          ],
          highlightButtonIds: [],
          wikiChapterIdx: 0,
          showContinueBtn: true,
          continueLabel: '► BEGIN DRILL [ENTER]',
        };

      case 1: {
        const placed = sim.turrets.some((t) => t.kind === 'SENTRY_PULSE');
        return {
          active: true,
          graduated: false,
          stepIndex: 1,
          totalSteps: this.totalSteps,
          code: 'DRILL 02/09',
          title: 'DEPLOY & AIM YOUR FIRST UA 571-C PULSE SENTRY',
          briefingLines: [
            'Press [1] (or click [1] UA 571-C on the right panel). Click the pulsing [+] MOUNT PAD near the Core, HOLD & DRAG LEFT to aim down the West Corridor, then release!',
            'Notice two cone arcs: SOLID INNER ARC = 55% dark vision; DASHED OUTER ARC = 100% range when enemies are illuminated.',
          ],
          objectives: [{ text: 'Deploy a [1] UA 571-C Pulse Sentry on any [+] Mount Pad', done: placed }],
          beacons: [{ pos: westPad, label: 'CLICK & DRAG LEFT', color: '#FFB000', radiusPx: 34 }],
          highlightButtonIds: ['build-SENTRY_PULSE'],
          wikiChapterIdx: 0,
          showContinueBtn: false,
          continueLabel: '',
        };
      }

      case 2: {
        const dronesCleared = this.dronesSpawned && sim.hostiles.length === 0;
        return {
          active: true,
          graduated: false,
          stepIndex: 2,
          totalSteps: this.totalSteps,
          code: 'DRILL 03/09',
          title: 'LIVE COMBAT, TACTICAL PAUSE [SPACE] & AMMO REARM [E]',
          briefingLines: [
            '3 Xeno Drones are advancing! Sentries burn through 320-rd drums & build barrel HEAT (shown on the Left Weapons Rack).',
            'Tip: Hit [SPACE] anytime to PAUSE and issue orders calmly! When your Sentry runs low, press [E] (or click REARM) to feed a fresh ammo belt.',
          ],
          objectives: [
            { text: 'Eliminate the 3 approaching Xeno Drones', done: dronesCleared },
            {
              text: dronesCleared
                ? 'Press [E] (or click [E] REARM ALL on left) to reload your Sentry!'
                : 'Wait for Drones to drop, then test Sentry Reload',
              done: this.rearmCompleted,
            },
          ],
          beacons: this.getPrimarySentry(sim)
            ? [
                {
                  pos: this.getPrimarySentry(sim)!.pos,
                  label: dronesCleared ? 'PRESS [E] TO REARM!' : 'DEFENDING CORRIDOR',
                  color: dronesCleared ? '#FFB000' : '#44FF77',
                  radiusPx: 34,
                },
              ]
            : [],
          highlightButtonIds: dronesCleared ? ['rearm-all', 'insp-rearm'] : [],
          wikiChapterIdx: 0,
          showContinueBtn: false,
          continueLabel: '',
        };
      }

      case 3: {
        const hasRelay = sim.turrets.some((t) => t.kind === 'MOTION_RELAY');
        const stalkersDead = this.stalkersSpawned && sim.hostiles.length === 0;
        return {
          active: true,
          graduated: false,
          stepIndex: 3,
          totalSteps: this.totalSteps,
          code: 'DRILL 04/09',
          title: 'DARKNESS, CLOAKED STALKERS & M314 LASER TRIPWIRE',
          briefingLines: [
            'SIGNAL STALKERS are 100% INVISIBLE in dark corridors! Place an [6] M314 RELAY: it sweeps radar, boosts nearby guns (+24% RNG / +18% DMG), and casts a RED LASER TRIPWIRE that tags any alien crossing it for 5.0s!',
            'Then press [F] M40 FLARE (0 kW!) and click the dark corridor to light up 2 approaching Stalkers for 100% range + 20% CRIT!',
          ],
          objectives: [
            { text: 'Deploy an [6] M314 Motion Relay (drag to aim its red Tripwire!)', done: hasRelay },
            { text: 'Drop an [F] M40 Strobe Flare in the corridor', done: this.flareUsedInStep },
            { text: 'Decloak & neutralize both Signal Stalkers', done: stalkersDead },
          ],
          beacons: !hasRelay
            ? [{ pos: westRelayPad, label: 'DEPLOY [6] M314 RELAY', color: '#44FF77', radiusPx: 34 }]
            : !this.flareUsedInStep
              ? [{ pos: this.tileCenter(8, 8), label: 'DROP [F] FLARE HERE', color: '#FFF0B8', radiusPx: 44 }]
              : [],
          highlightButtonIds: [!hasRelay ? 'build-MOTION_RELAY' : '', !this.flareUsedInStep ? 'ability-FLARE' : ''].filter(
            Boolean
          ),
          wikiChapterIdx: 1,
          showContinueBtn: false,
          continueLabel: '',
        };
      }

      case 4: {
        const hasCryo = sim.turrets.some((t) => t.kind === 'CRYO_VALVE');
        const hasRail = sim.turrets.some((t) => t.kind === 'RAIL_LANCE');
        const prtDead = this.praetorianSpawned && sim.hostiles.length === 0;
        return {
          active: true,
          graduated: false,
          stepIndex: 4,
          totalSteps: this.totalSteps,
          code: 'DRILL 05/09',
          title: 'ARMOR PIERCING [3] RAIL-LANCE & [4] CRYO-SHATTER COMBO',
          briefingLines: [
            'Heavy PRAETORIANS deflect 70% of frontal Sentry bullets (RICOCHET!). Counter them with a killbox combo:',
            '[4] CRYO VALVE on a striped Duct Grate slows 58%, cools guns & adds +35% SHATTER CRIT! [3] M99 RAIL-LANCE ignores 100% armor & pierces 4 lined foes!',
          ],
          objectives: [
            { text: 'Place a [4] Cryo-Stasis Valve on a striped Duct Grate', done: hasCryo },
            { text: 'Deploy a [3] M99 Rail-Lance on a [+] Mount Pad aimed down-hall', done: hasRail },
            { text: 'Shatter the armored Praetorian Crusher', done: prtDead },
          ],
          beacons: [
            ...(!hasCryo
              ? [{ pos: westCryoGrate, label: '[4] CRYO ON GRATE', color: '#9BF8FF', radiusPx: 32 }]
              : []),
            ...(!hasRail
              ? [{ pos: westRailPad, label: '[3] M99 RAIL-LANCE', color: '#00F0FF', radiusPx: 34 }]
              : []),
          ],
          highlightButtonIds: [!hasCryo ? 'build-CRYO_VALVE' : '', !hasRail ? 'build-RAIL_LANCE' : ''].filter(
            Boolean
          ),
          wikiChapterIdx: 3,
          showContinueBtn: false,
          continueLabel: '',
        };
      }

      case 5: {
        const hasIncin = sim.turrets.some((t) => t.kind === 'INCINERATOR');
        const burstersDead = this.acidDemoSpawned && sim.hostiles.length === 0;
        return {
          active: true,
          graduated: false,
          stepIndex: 5,
          totalSteps: this.totalSteps,
          code: 'DRILL 06/09',
          title: 'ACID POOLS, [2] INCINERATOR STERILIZE & [C] COOLANT FLUSH',
          briefingLines: [
            'ACID BURSTERS leave corrosive pools that melt Doors & Tripwires. [2] M240 INCINERATOR ignores armor, lights targets, AND burns Acid Pools for +15 BONUS SCRAP!',
            'Press [C] COOLANT FLUSH anytime barrels overheat or Spitters splash acid — it instantly vents -78 HEAT & cleanses acid!',
          ],
          objectives: [
            { text: 'Deploy an [2] M240 Incinerator on a Mount Pad', done: hasIncin },
            { text: 'Press [C] (or click [C] FLUSH) to vent weapon heat', done: this.coolantUsedInStep },
            { text: 'Burn the Acid Bursters & sterilize the Acid Pool', done: burstersDead },
          ],
          beacons: !hasIncin
            ? [{ pos: westIncinPad, label: '[2] M240 INCINERATOR', color: '#FFB000', radiusPx: 34 }]
            : [],
          highlightButtonIds: [
            !hasIncin ? 'build-INCINERATOR' : '',
            !this.coolantUsedInStep ? 'ability-COOLANT_FLUSH' : '',
          ].filter(Boolean),
          wikiChapterIdx: 3,
          showContinueBtn: false,
          continueLabel: '',
        };
      }

      case 6: {
        return {
          active: true,
          graduated: false,
          stepIndex: 6,
          totalSteps: this.totalSteps,
          code: 'DRILL 07/09',
          title: 'REROUTING WITH [7] DOOR SEALS & [V] AIRLOCK PURGE',
          briefingLines: [
            'Select [7] DOOR SEAL and click Blast Door D-04 (or any door) to weld it shut — watch the dashed alien paths INSTANTLY reroute around sealed corridors!',
            'Then press [V] PURGE (1x/wave) and click orange AIRLOCK W-01 to blast the trapped Skitterers backward for 2X DECOMPRESSION KILL score!',
          ],
          objectives: [
            { text: 'Arc-Weld any Blast Door [D-01..D-06] using [7] DOOR SEAL', done: this.doorWeldedInStep },
            { text: 'Press [V] PURGE and click orange AIRLOCK W-01', done: this.purgeUsedInStep },
          ],
          beacons: [
            ...(!this.doorWeldedInStep
              ? [{ pos: doorD04, label: 'WELD DOOR [7]', color: '#FFB000', radiusPx: 36 }]
              : []),
            ...(!this.purgeUsedInStep
              ? [{ pos: airlockW01, label: 'PURGE [V] AIRLOCK W-01', color: '#FF5522', radiusPx: 54 }]
              : []),
          ],
          highlightButtonIds: [
            !this.doorWeldedInStep ? 'build-ARC_WELDER' : '',
            !this.purgeUsedInStep ? 'ability-PURGE' : '',
          ].filter(Boolean),
          wikiChapterIdx: 7,
          showContinueBtn: false,
          continueLabel: '',
        };
      }

      case 7: {
        return {
          active: true,
          graduated: false,
          stepIndex: 7,
          totalSteps: this.totalSteps,
          code: 'DRILL 08/09',
          title: 'REACTOR BATTERY, [L] FLOODLIGHT & [O] OVERCLOCK SURGE',
          briefingLines: [
            'Unused Free kW charges your cyan RESERVE BATTERY (left panel). It automatically buffers Overloads before a 3.5s Blackout — OR spend 60% Battery for [L] FLOODLIGHT (7.5s map-wide vision)!',
            'Press [L] FLOODLIGHT now, then press [O] OVERCLOCK and click near your turrets for 2X FIRE RATE (+22 kW surge buffered by Battery)!',
          ],
          objectives: [
            { text: 'Trigger [L] EMERGENCY FLOODLIGHT (60% Reserve Battery)', done: this.floodUsedInStep },
            { text: 'Trigger [O] OVERCLOCK on a turret cluster (+22 kW · 2X ROF)', done: this.overclockUsedInStep },
          ],
          beacons: [],
          highlightButtonIds: [
            !this.floodUsedInStep ? 'ability-FLOODLIGHT' : '',
            !this.overclockUsedInStep ? 'ability-OVERCLOCK' : '',
          ].filter(Boolean),
          wikiChapterIdx: 5,
          showContinueBtn: false,
          continueLabel: '',
        };
      }

      case 8:
      default: {
        const hasMk2 = sim.turrets.some((t) => t.level >= 2);
        const hasMk3 = sim.turrets.some((t) => t.level === 3);
        const targetT = sim.turrets.find((t) => t.level < 3) ?? sim.turrets[0];
        return {
          active: true,
          graduated: false,
          stepIndex: 8,
          totalSteps: this.totalSteps,
          code: 'DRILL 09/09',
          title: 'MK-II & BRANCHING MK-III SPECIALIZATIONS — FINAL CHECK!',
          briefingLines: [
            'Every unit upgrades MK-I -> MK-II (+12% range, +33% power, 0 extra kW) -> then splits into TWO permanent MK-III Branches (A vs. B)!',
            'Click any turret on the map (or Left Rack), click [U] MK-II in the bottom-right Inspector, then pick Branch III-A or III-B to graduate!',
          ],
          objectives: [
            { text: 'Click a turret & upgrade it to MK-II ([U] or Inspector button)', done: hasMk2 },
            { text: 'Choose a permanent MK-III Specialization (Branch A or B)', done: hasMk3 },
          ],
          beacons: targetT
            ? [{ pos: targetT.pos, label: 'CLICK TO UPGRADE MK-III', color: '#00F0FF', radiusPx: 36 }]
            : [],
          highlightButtonIds: hasMk2 ? ['insp-upgrade-a', 'insp-upgrade-b'] : ['insp-upgrade'],
          wikiChapterIdx: 2,
          showContinueBtn: false,
          continueLabel: '',
        };
      }
    }
  }
}
