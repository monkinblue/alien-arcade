import type { PerimeterSimulation } from './PerimeterSimulation';
import { Sector01Blueprint } from './Sector01Blueprint';
import {
  HARDWARE_SPECS,
  MK3_BRANCH_SPECS,
  PERIMETER_CONSTANTS,
  type BuildToolId,
  type Mk3BranchId,
  type ProtocolId,
  type TurretKind,
} from './types';

export interface AutoCommanderOptions {
  autoLaunch?: boolean;
  godSeals?: boolean;
  autoPickProtocol?: boolean;
}

/**
 * Dev-only tactical Auto-Commander used strictly behind `if (import.meta.env.DEV)` via
 * `window.__PERIMETER_DEBUG__.setAutoCommander(true)` to stress-test mid/late-game Endless Siege
 * waves (8-unit arsenal, Mk-III branches, Reserve Battery, Floodlight, Coolant Flush, Protocol Drafts,
 * Wave 5 Crusher, Wave 10 Queen, and Wave 12+ endless scaling).
 */
export class PerimeterDevAutoCommander {
  private enabled = false;
  private thinkAccum = 0;
  private opts: Required<AutoCommanderOptions> = {
    autoLaunch: true,
    godSeals: false,
    autoPickProtocol: true,
  };
  private actionsLog: string[] = [];
  private audioCounts: Record<string, number> = {};
  private audioRecent: Array<{ t: number; key: string }> = [];

  public recordAudio(key: string): void {
    this.audioCounts[key] = (this.audioCounts[key] ?? 0) + 1;
    const now = performance.now();
    this.audioRecent.push({ t: now, key });
    if (this.audioRecent.length > 600) {
      this.audioRecent.splice(0, this.audioRecent.length - 400);
    }
  }

  public resetAudioTelemetry(): void {
    this.audioCounts = {};
    this.audioRecent = [];
  }

  public getAudioTelemetry(): {
    eventsLast5SecPerSec: number;
    eventsLast5SecByType: Record<string, number>;
    totalCounts: Record<string, number>;
  } {
    const cutoff = performance.now() - 5000;
    const recentByType: Record<string, number> = {};
    let recentTotal = 0;
    for (const ev of this.audioRecent) {
      if (ev.t >= cutoff) {
        recentByType[ev.key] = (recentByType[ev.key] ?? 0) + 1;
        recentTotal++;
      }
    }
    return {
      eventsLast5SecPerSec: Number((recentTotal / 5).toFixed(2)),
      eventsLast5SecByType: recentByType,
      totalCounts: { ...this.audioCounts },
    };
  }

  public jumpToWave(sim: PerimeterSimulation, targetWave: number, autoLaunch = false): void {
    const clamped = Math.max(1, Math.min(99, Math.floor(targetWave)));
    sim.waveNumber = clamped;
    sim.currentWaveDef = Sector01Blueprint.getWaveDefinition(clamped);
    sim.activeMutator = sim.currentWaveDef.mutator ?? 'NONE';
    sim.hostiles = [];
    sim.clearPendingSpawns();
    sim.eggSacs = [];
    sim.acidSpits = [];
    sim.acidPools = [];
    sim.phantomBlips = [];
    sim.grateTelegraphs = [];
    sim.overloadTimer = 0;
    sim.blackoutTimer = 0;
    sim.purgeAvailableThisWave = true;

    const autoUnlockedKw = Math.min(
      PERIMETER_CONSTANTS.AUTO_REACTOR_KW_CAP,
      PERIMETER_CONSTANTS.BASE_REACTOR_KW + Math.floor((clamped - 1) / 2) * 15
    );
    if (sim.maxReactorKw < autoUnlockedKw) {
      sim.maxReactorKw = autoUnlockedKw;
    }

    sim.phase = 'TACTICAL_PREP';
    sim.tacticalPaused = false;
    sim.pushLog(
      `[DEV] JUMPED TO WAVE ${String(clamped).padStart(2, '0')} // ${sim.currentWaveDef.title} (BUS ${sim.maxReactorKw} kW)`
    );
    if (autoLaunch) {
      sim.launchNextWave();
    }
  }

  public clearHostiles(sim: PerimeterSimulation, triggerWaveComplete = true): void {
    sim.hostiles = [];
    sim.clearPendingSpawns();
    sim.eggSacs = [];
    sim.acidSpits = [];
    sim.grateTelegraphs = [];
    if (triggerWaveComplete && sim.phase === 'WAVE_ACTIVE') {
      sim.step(PERIMETER_CONSTANTS.FIXED_DT);
    }
  }

  public openProtocolDraft(sim: PerimeterSimulation): ProtocolId[] {
    sim.protocolDraftChoices = sim.rollProtocolDraftChoices();
    sim.phase = 'PROTOCOL_DRAFT';
    sim.audioCb.onIntercomVoice('protocol');
    sim.pushLog('[DEV] PROTOCOL DRAFT OPENED — SELECT 1 DIRECTIVE [1 / 2 / 3]');
    return [...sim.protocolDraftChoices];
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getOptions(): Required<AutoCommanderOptions> {
    return { ...this.opts };
  }

  public getRecentActions(): string[] {
    return this.actionsLog.slice(-12);
  }

  public setEnabled(enabled: boolean, opts?: AutoCommanderOptions): void {
    this.enabled = enabled;
    if (opts) {
      this.opts = {
        autoLaunch: opts.autoLaunch ?? this.opts.autoLaunch,
        godSeals: opts.godSeals ?? this.opts.godSeals,
        autoPickProtocol: opts.autoPickProtocol ?? this.opts.autoPickProtocol,
      };
    }
    this.thinkAccum = 0;
  }

  private note(msg: string): void {
    this.actionsLog.push(msg);
    if (this.actionsLog.length > 40) this.actionsLog.shift();
  }

  public step(sim: PerimeterSimulation, dt: number): void {
    if (!this.enabled) return;

    if (this.opts.godSeals && sim.bulkheadSeals < PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS) {
      sim.bulkheadSeals = PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS;
    }

    if (sim.phase === 'BRIEFING') {
      sim.phase = 'TACTICAL_PREP';
      this.note('SKIPPED BRIEFING');
      return;
    }

    if (sim.phase === 'PROTOCOL_DRAFT') {
      if (this.opts.autoPickProtocol && sim.protocolDraftChoices.length > 0) {
        const preferred: ProtocolId[] = [
          'DU_ROUNDS',
          'AUX_BUS',
          'AUTOLOADER',
          'CRYO_SHATTER',
          'CAPACITOR_DRIVE',
          'OPTICS_GAIN',
          'SALVAGE_BONUS',
          'THERMITE_CATALYST',
          'BULKHEAD_ARMOR',
          'SEAL_FABRICATION',
        ];
        const pick =
          preferred.find((p) => sim.protocolDraftChoices.includes(p)) ??
          sim.protocolDraftChoices[0];
        const r = sim.selectProtocolDraft(pick);
        if (r.ok) this.note(`W${sim.waveNumber} PICKED PROTOCOL ${pick}`);
      }
      return;
    }

    if (sim.phase !== 'TACTICAL_PREP' && sim.phase !== 'WAVE_ACTIVE') return;

    this.thinkAccum += dt;
    if (this.thinkAccum < 0.35) return;
    this.thinkAccum = 0;

    // 1. Emergency Reactor Overload protection
    if (sim.overloadTimer > 1.2 && !sim.auxShedActive) {
      const r = sim.toggleAuxLoadShed();
      if (r.ok) this.note(`SHED AUX @ ${sim.overloadTimer.toFixed(1)}S OVRLD`);
    } else if (sim.auxShedActive && sim.overloadTimer <= 0 && sim.activeOverclockSurgeTimer <= 0) {
      const r = sim.toggleAuxLoadShed();
      if (r.ok) this.note('RESTORED AUX BUS');
    }

    // 2. Rearm Sentries below 30% ammo (or any below 80% during Prep)
    const needRearm = sim.turrets.some(
      (t) =>
        t.kind === 'SENTRY_PULSE' &&
        t.rearmTimer <= 0 &&
        (sim.phase === 'TACTICAL_PREP' ? t.ammo < t.maxAmmo * 0.85 : t.ammo <= t.maxAmmo * 0.25)
    );
    if (needRearm) {
      const r = sim.rearmAllSentries();
      if (r.ok) this.note(r.msg);
    }

    // 3. Emergency Coolant Flush when any turret is thermal-locked, acid-corroded, or >=80% heat
    if (
      sim.phase === 'WAVE_ACTIVE' &&
      sim.coolantFlushCooldown <= 0 &&
      sim.blackoutTimer <= 0 &&
      sim.turrets.some((t) => t.thermalLocked || t.acidDebuffTimer > 0.5 || t.heat >= 82)
    ) {
      const r = sim.triggerInstantCommandAbility('COOLANT_FLUSH');
      if (r.ok) this.note(r.msg);
    }

    // 4. Active Combat Command Abilities: Emergency Floodlight, Overclock on Boss/Dense Wave, Flare
    if (sim.phase === 'WAVE_ACTIVE' && sim.hostiles.length > 0 && sim.blackoutTimer <= 0) {
      const hasBoss = sim.hostiles.some((h) => h.isBoss);
      if (
        sim.floodlightTimer <= 0 &&
        sim.floodlightCooldown <= 0 &&
        sim.reserveBattery >= PERIMETER_CONSTANTS.FLOODLIGHT_BATTERY_COST &&
        (hasBoss || sim.hostiles.length >= 6)
      ) {
        const r = sim.triggerInstantCommandAbility('FLOODLIGHT');
        if (r.ok) this.note(r.msg);
      }

      if (sim.overclockCooldown <= 0 && (hasBoss || sim.hostiles.length >= 9)) {
        const combatTurret = sim.turrets.find(
          (t) =>
            t.powered &&
            (t.kind === 'SENTRY_PULSE' || t.kind === 'RAIL_LANCE' || t.kind === 'INCINERATOR')
        );
        if (combatTurret) {
          const r = sim.triggerCommandAbility('OVERCLOCK', combatTurret.pos);
          if (r.ok) this.note(r.msg);
        }
      }

      if (sim.flareCooldown <= 0 && sim.floodlightTimer <= 0) {
        const darkHostile = sim.hostiles.find((h) => !h.illuminated);
        if (darkHostile) {
          const r = sim.triggerCommandAbility('FLARE', darkHostile.pos);
          if (r.ok) this.note(r.msg);
        }
      }
    }

    // 5. Economy Spend (Build Balanced 8-Unit Roster -> MK-II -> Branching MK-III -> Reactor Expand -> Claymores)
    this.spendScrapSmart(sim);

    // 6. Auto-Launch Wave after Prep build cycle settles
    if (sim.phase === 'TACTICAL_PREP' && this.opts.autoLaunch && sim.turrets.length >= 2) {
      sim.launchNextWave();
      this.note(`LAUNCHED WAVE ${sim.waveNumber}`);
    }
  }

  private spendScrapSmart(sim: PerimeterSimulation): void {
    // Core Seal Fabrication during Prep if blown and affordable
    if (
      sim.phase === 'TACTICAL_PREP' &&
      sim.bulkheadSeals < PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS &&
      sim.scrap >= PERIMETER_CONSTANTS.SEAL_REBUILD_COST_SCRAP
    ) {
      const r = sim.fabricateCoreSeal();
      if (r.ok) {
        this.note(r.msg);
        return;
      }
    }

    const freeKw = sim.maxReactorKw - sim.getStaticAllocatedKw();
    const countKind = (k: TurretKind) => sim.turrets.filter((t) => t.kind === k).length;

    // Expand reactor bus whenever free headroom drops below 28 kW and we can afford it
    if (
      freeKw < 28 &&
      sim.maxReactorKw < PERIMETER_CONSTANTS.MAX_REACTOR_KW_HARD_CAP &&
      sim.scrap >= sim.getReactorExpandCost()
    ) {
      const r = sim.expandReactorBus();
      if (r.ok) {
        this.note(r.msg);
        return;
      }
    }

    // Desired balanced progression order covering all 6 turret classes
    const desiredOrder: TurretKind[] = [
      'SENTRY_PULSE',
      'SENTRY_PULSE',
      'MOTION_RELAY',
      'CRYO_VALVE',
      'RAIL_LANCE',
      'INCINERATOR',
      'SHOCK_COIL',
      'SENTRY_PULSE',
      'RAIL_LANCE',
      'MOTION_RELAY',
      'INCINERATOR',
      'CRYO_VALVE',
      'SHOCK_COIL',
      'RAIL_LANCE',
    ];
    const targetCounts: Partial<Record<TurretKind, number>> = {};
    for (const k of desiredOrder) {
      targetCounts[k] = (targetCounts[k] ?? 0) + 1;
      if (countKind(k) < targetCounts[k]!) {
        const spec = HARDWARE_SPECS[k];
        if (sim.scrap >= spec.costScrap && freeKw >= spec.powerKw) {
          const placed = this.placeBestHardware(sim, k);
          if (placed) return;
        }
        break;
      }
    }

    // Upgrade MK-I -> MK-II
    for (const t of sim.turrets) {
      if (t.level === 1) {
        const cost = HARDWARE_SPECS[t.kind].upgradeCostScrap;
        if (sim.scrap >= cost) {
          const r = sim.upgradeTurret(t.id);
          if (r.ok) {
            this.note(r.msg);
            return;
          }
        }
      }
    }

    // Upgrade MK-II -> MK-III (alternating A & B branches so both specializations get exercised!)
    for (let i = 0; i < sim.turrets.length; i++) {
      const t = sim.turrets[i];
      if (t.level === 2) {
        const branch: Mk3BranchId = i % 2 === 0 ? 'A' : 'B';
        const bSpec = MK3_BRANCH_SPECS[t.kind][branch];
        if (sim.scrap >= bSpec.costScrap && freeKw >= bSpec.extraKw) {
          const r = sim.upgradeTurret(t.id, branch);
          if (r.ok) {
            this.note(r.msg);
            return;
          }
        }
      }
    }

    // Drop 0 kW M18 Proximity Claymores in corridors once 4+ turrets are online
    if (
      sim.turrets.length >= 4 &&
      sim.claymores.length < 5 &&
      sim.scrap >= HARDWARE_SPECS.CLAYMORE.costScrap + 65
    ) {
      this.placeBestHardware(sim, 'CLAYMORE');
    }
  }

  public placeBestHardware(
    sim: PerimeterSimulation,
    buildId: Exclude<BuildToolId, 'NONE'>
  ): { ok: boolean; msg: string; turretId?: string } {
    const bp = sim.blueprint;
    const ts = bp.tileSize;
    const core = bp.coreCenter;

    if (buildId === 'ARC_WELDER') {
      const openDoor = Array.from(sim.doors.values()).find((d) => !d.welded && d.weldingTimer <= 0);
      if (!openDoor) return { ok: false, msg: 'NO OPEN BLAST DOOR' };
      const t0 = openDoor.def.tiles[0];
      const res = sim.deployHardware('ARC_WELDER', t0.col, t0.row, 0);
      if (res.ok) this.note(`WELDED ${openDoor.def.id}`);
      return { ok: res.ok, msg: res.reason ?? `${openDoor.def.id} SEALED` };
    }

    const wantTile =
      buildId === 'CLAYMORE'
        ? 'CORRIDOR'
        : buildId === 'CRYO_VALVE' || buildId === 'SHOCK_COIL'
          ? 'DUCT_GRATE'
          : 'MOUNT_PAD';

    const candidates: Array<{ col: number; row: number; dist: number }> = [];
    for (let r = 0; r < bp.rows; r++) {
      for (let c = 0; c < bp.cols; c++) {
        if (bp.tiles[r][c] !== wantTile) continue;
        if (!sim.canPlaceHardwareAt(buildId, c, r).ok) continue;
        const cx = c * ts + ts * 0.5;
        const cy = r * ts + ts * 0.5;
        const dist = Math.hypot(cx - core.x, cy - core.y);
        if (buildId === 'CLAYMORE' && (dist < 140 || dist > 520)) continue;
        candidates.push({ col: c, row: r, dist });
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);
    if (candidates.length === 0) return { ok: false, msg: `NO OPEN ${wantTile}` };

    const best = candidates[0];
    const ang =
      buildId === 'CRYO_VALVE' || buildId === 'SHOCK_COIL' || buildId === 'CLAYMORE'
        ? 0
        : sim.computeDefaultAimAngle(best.col, best.row);
    const res = sim.deployHardware(buildId, best.col, best.row, ang);
    if (res.ok) {
      this.note(`DEPLOYED ${res.placedTurret?.callsign ?? buildId} @ (${best.col},${best.row})`);
    }
    return {
      ok: res.ok,
      msg: res.reason ?? `DEPLOYED ${res.placedTurret?.callsign ?? buildId}`,
      turretId: res.placedTurret?.id,
    };
  }

  /**
   * Compact dev-only telemetry HUD overlay toggled via [F8] (100% stripped from production builds).
   */
  public renderDevOverlay(
    ctx: CanvasRenderingContext2D,
    sim: PerimeterSimulation,
    x: number,
    y: number,
    debugTainted: boolean,
    busActivity: number
  ): void {
    const audio = this.getAudioTelemetry();
    const topEvents = Object.entries(audio.eventsLast5SecByType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    const bosses = sim.hostiles
      .filter((h) => h.isBoss)
      .map((b) => `${b.kind} ${Math.ceil(b.hp)}/${b.maxHp}`)
      .join(', ');
    const mk3Count = sim.turrets.filter((t) => t.level === 3).length;
    const mk2Count = sim.turrets.filter((t) => t.level === 2).length;

    const lines = [
      `[DEV HUD F8] W${sim.waveNumber} ${sim.phase} | MUT:${sim.activeMutator} | AUTO:${this.enabled ? 'ON' : 'OFF'} | TAINT:${debugTainted ? 'YES' : 'NO'}`,
      `ECON: ${sim.scrap}S | KW:${sim.getTotalLoadKw()}/${sim.maxReactorKw} | BAT:${Math.round(sim.reserveBattery)}% | OVRLD:${sim.overloadTimer.toFixed(1)}s | BLK:${sim.blackoutTimer.toFixed(1)}s`,
      `UNITS: ${sim.turrets.length} (MK2:${mk2Count} MK3:${mk3Count}) | MINES:${sim.claymores.length} | EGGS:${sim.eggSacs.length} | HOSTILES:${sim.hostiles.length}+${sim.getPendingSpawnCount()}`,
      `AUDIO: ${audio.eventsLast5SecPerSec.toFixed(1)} ev/s | BUS:${busActivity.toFixed(2)} | TOP5s: ${topEvents || 'QUIET'}`,
      `BOSS: ${bosses || 'NONE'} | KEYS: [F2]AUTO [F3]+1KS [F4]JUMP [F6]DRAFT [F7]CLR [F9]GOD`,
    ];

    const boxW = 635;
    const boxH = lines.length * 16 + 12;
    ctx.save();
    ctx.fillStyle = 'rgba(2, 12, 16, 0.90)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = '#00F0FF';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(x, y, boxW, boxH);
    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    lines.forEach((ln, i) => {
      ctx.fillStyle = i === 0 ? '#00F0FF' : i === 3 ? '#FFE082' : '#9EF5B8';
      ctx.fillText(ln, x + 8, y + 17 + i * 16, boxW - 16);
    });
    ctx.restore();
  }
}
