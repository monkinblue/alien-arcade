import {
  CONTROLS_CARD_IDS,
  handleSystemMenuAction,
  handleSystemMenuKey,
  hitTestChromeButtons,
  PAUSE_BANNER_IDS,
  POST_RUN_IDS,
  TOP_CHROME_IDS,
  type SystemMenuActionCallbacks,
} from '../render/chrome';
import {
  CALLSIGN_CHAR_REGEX,
  CALLSIGN_MAX_LEN,
  sanitizeCallsignDraft,
} from '../services/callsignGuard';
import type { Cartridge, CrtShaderFrameParams, HostEnvironment } from '../shell/Cartridge';
import type { Vec2, ViewportRect } from '../types';
import {
  PerimeterBlueprintRenderer,
  type BlueprintCamera,
} from './PerimeterBlueprintRenderer';
import {
  PerimeterDevAutoCommander,
  type AutoCommanderOptions,
} from './PerimeterDevAutoCommander';
import { PerimeterHudRenderer, type PerimeterLayout } from './PerimeterHudRenderer';
import { PerimeterManifest } from './PerimeterManifest';
import { PerimeterSimulation } from './PerimeterSimulation';
import { PerimeterTutorialDirector } from './PerimeterTutorialDirector';
import { PERIMETER_WIKI_CHAPTERS } from './PerimeterWikiData';
import {
  ENDGAME_DIRECTIVES,
  MK3_BRANCH_SPECS,
  OMEGA_DIRECTIVES,
  PERIMETER_CONSTANTS,
  TACTICAL_PROTOCOLS,
  WAVE_MUTATORS,
  type ActiveCursorTool,
  type BuildToolId,
  type CommandAbilityId,
  type DraftChoiceId,
  type EndgameDirectiveId,
  type Mk3BranchId,
  type OmegaDirectiveId,
  type PerimeterLastSubmittedRun,
  type PerimeterPhase,
  type ProtocolId,
  type SectorId,
} from './types';

interface PerimeterDebugBridge {
  getState: () => Record<string, unknown>;
  placeUnit: (
    buildId: Exclude<BuildToolId, 'NONE'>,
    col?: number,
    row?: number,
    aimAngle?: number
  ) => { ok: boolean; msg: string; turretId?: string };
  upgradeUnit: (
    idOrCallsign: string,
    mk3Branch?: Mk3BranchId
  ) => { ok: boolean; msg: string };
  selectUnit: (idOrCallsign: string | null) => { selectedTurretId: string | null };
  sellUnit: (idOrCallsign: string) => { ok: boolean; msg: string };
  toggleUnitPower: (idOrCallsign: string) => { ok: boolean; msg: string };
  rearmAll: () => { ok: boolean; msg: string; count: number };
  expandReactor: () => { ok: boolean; msg: string };
  fabricateSeal: () => { ok: boolean; msg: string };
  toggleAuxShed: () => { ok: boolean; msg: string };
  triggerAbility: (
    abilityId: CommandAbilityId,
    targetPos?: Vec2
  ) => { ok: boolean; msg: string };
  pickProtocol: (indexOrId: number | DraftChoiceId | OmegaDirectiveId) => { ok: boolean; msg: string };
  launchWave: () => { phase: string; waveNumber: number };
  setSpeed: (fast2x: boolean) => { fastForward2x: boolean };
  setPaused: (paused: boolean) => { tacticalPaused: boolean };
  grantScrap: (amount: number) => { scrap: number };
  setBattery: (pct: number) => { reserveBattery: number };
  setSeals: (count: number) => { bulkheadSeals: number };
  jumpToWave: (waveNum: number, autoLaunch?: boolean) => Record<string, unknown>;
  triggerProtocolDraft: () => { choices: DraftChoiceId[] };
  clearHostiles: (triggerWaveComplete?: boolean) => { phase: string; waveNumber: number };
  fastStep: (seconds: number, stepDt?: number) => Record<string, unknown>;
  setAutoCommander: (
    enabled: boolean,
    opts?: AutoCommanderOptions
  ) => { enabled: boolean; opts: Required<AutoCommanderOptions> };
  resetAudioTelemetry: () => { reset: boolean };
}

declare global {
  interface Window {
    __PERIMETER_DEBUG__?: PerimeterDebugBridge;
  }
}

export class PerimeterCartridge implements Cartridge {
  public readonly id = 'perimeter';
  private host: HostEnvironment;
  private listenerAbort: AbortController | null = null;

  private sim: PerimeterSimulation;
  private manifest = new PerimeterManifest();
  private blueprintRenderer = new PerimeterBlueprintRenderer();
  private hudRenderer = new PerimeterHudRenderer();

  private viewportWidth = 1280;
  private viewportHeight = 800;
  private offsetX = 0;
  private offsetY = 0;
  private crtRect: ViewportRect = { x: 0, y: 0, width: 1280, height: 800 };

  private camera: BlueprintCamera = {
    centerX: PERIMETER_CONSTANTS.VIRTUAL_W * 0.5,
    centerY: PERIMETER_CONSTANTS.VIRTUAL_H * 0.5,
    zoom: 1.0,
  };
  private lastSectorId: SectorId = 'SEC-01';
  private lastSectorTransitionVersion = -1;

  private keysDown = new Set<string>();
  private activeTool: ActiveCursorTool = { kind: 'INSPECT' };
  private selectedTurretId: string | null = null;
  private hoveredTurretId: string | null = null;
  private selectedDoorId: string | null = null;
  private hoveredButtonId: string | null = null;

  private cursorCrtPx: Vec2 = { x: 640, y: 400 };
  private cursorInsideBlueprint = false;
  private cursorVirtual: Vec2 | null = null;

  // Mouse-drag cone aiming & middle/right-drag camera panning
  private dragBuildAnchor: { col: number; row: number; angle: number; shiftHeld: boolean } | null =
    null;
  private dragRotateTurretId: string | null = null;
  private lastBuildHoverTile: { col: number; row: number } | null = null;
  private previewAngleLockedByUser = false;
  private lastToolAutoExitMs = 0;
  private panDragState: {
    pointerId: number;
    startX: number;
    startY: number;
    camStartX: number;
    camStartY: number;
    moved: boolean;
    button: number;
  } | null = null;

  private osdMenuOpen = false;
  private manifestOpen = false;
  private wikiOpen = false;
  private controlsCardOpen = false;
  private pauseBannerOpen = false;
  private draftPeekMap = false;
  private confirmExitPending = false;
  private confirmExitTimer = 0;
  private postRunKeylockSec = 0;
  private callsignEditing = false;
  private prevPhase: PerimeterPhase = 'BRIEFING';
  private wikiChapterIdx = 0;
  private wikiScrollPx = 0;
  private tutorialDirector = new PerimeterTutorialDirector();
  private callsignDraft = 'HICKS-01';
  private runPlaytimeSec = 0;
  private scoreSubmitted = false;
  private submittingScore = false;
  private submitResultBanner: string | null = null;
  private submitResultTone: 'green' | 'amber' | 'red' = 'amber';
  private lastSubmittedRun: PerimeterLastSubmittedRun | null = null;
  private statusToast: string | null = null;
  private statusToastTimer = 0;
  private glitchIntensity = 0;

  // Dev-only debug taint flag & Auto-Commander (100% tree-shaken in production builds)
  private debugTainted = false;
  private devOverlayVisible = false;
  private devJumpIndex = 0;
  private devAutoCommander: PerimeterDevAutoCommander | null = import.meta.env.DEV
    ? new PerimeterDevAutoCommander()
    : null;

  constructor(host: HostEnvironment) {
    this.host = host;
    this.callsignDraft = this.manifest.getSavedCallsign();

    this.sim = new PerimeterSimulation({
      onMotionPing: (distM, maxM, pan, closeSwarmCount) => {
        if (import.meta.env.DEV) {
          this.devAutoCommander?.recordAudio(
            closeSwarmCount >= 3 ? 'motionPingDouble' : 'motionPing'
          );
        }
        this.host.audio.playPerimeterMotionPing(distM, maxM, pan, closeSwarmCount);
      },
      onPulseBurst: (pan, oc, distNorm, tier) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio(`pulseT${tier}`);
        this.host.audio.playPulseSentryBurst(pan, oc, 1.0, distNorm, tier);
      },
      onRailLance: (pan, tier, distNorm) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio(`railT${tier}`);
        this.host.audio.playRailLanceShot(pan, tier, distNorm);
      },
      onShockCoil: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('shockCoil');
        this.host.audio.playShockCoilArc(pan);
      },
      onClaymoreBlast: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('claymoreBlast');
        this.host.audio.playClaymoreDetonation(pan);
      },
      onQueenRoar: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('queenRoar');
        this.host.audio.playQueenMatriarchRoar(pan);
      },
      onShatterCrunch: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('shatterCrunch');
        this.host.audio.playCryoShatterCrunch(pan);
      },
      onThermalSteam: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('thermalSteam');
        this.host.audio.playThermalSteamVent(pan);
      },
      onReactorBreaker: (tripped) => {
        if (import.meta.env.DEV) {
          this.devAutoCommander?.recordAudio(tripped ? 'breakerTrip' : 'breakerRestore');
        }
        this.host.audio.playReactorBreakerEvent(tripped);
      },
      onWaveClear: () => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('waveClear');
        this.host.audio.playWaveClearedChime();
      },
      onUpgradeConfirm: (isMk3) => {
        if (import.meta.env.DEV) {
          this.devAutoCommander?.recordAudio(isMk3 ? 'upgradeMk3' : 'upgradeMk2');
        }
        this.host.audio.playUpgradeConfirmChime(isMk3);
      },
      onIntercomVoice: (id) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio(`voice_${id}`);
        this.host.audio.playPerimeterIntercomVoice(id);
      },
      onAmmoTick: (ratio) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('ammoTick');
        this.host.audio.playAmmoCounterTick(ratio);
      },
      onLowAmmoAlert: (pan, isEmpty) => {
        if (import.meta.env.DEV) {
          this.devAutoCommander?.recordAudio(isEmpty ? 'dryAlert' : 'lowAmmoAlert');
        }
        this.host.audio.playLowAmmoAlertChime(pan, isEmpty);
      },
      onRearmSentry: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('rearmSentry');
        this.host.audio.playSentryRearmBeltLock(pan);
      },
      onDryFire: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('dryFire');
        this.host.audio.playSentryDryFire(pan);
      },
      onIncinerator: (pan, distNorm) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('incinerator');
        this.host.audio.playIncineratorWhoosh(pan, distNorm);
      },
      onAlienScreech: (screechCtx, kind, pan, distNorm) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio(`screech_${screechCtx}`);
        this.host.audio.playXenomorphScreech(screechCtx, kind, pan, distNorm);
      },
      onCryoHiss: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('cryoHiss');
        this.host.audio.playCryoVentHiss(pan);
      },
      onArcWeld: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('arcWeld');
        this.host.audio.playArcWelderSeal(pan);
      },
      onDoorBatter: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('doorBatter');
        this.host.audio.playDoorBatterThud(pan);
      },
      onRicochet: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('ricochet');
        this.host.audio.playArmorRicochet(pan);
      },
      onAcidSizzle: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('acidSizzle');
        this.host.audio.playAcidCorrosionSizzle(pan);
      },
      onAirlockPurge: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('airlockPurge');
        this.host.audio.playAirlockDecompression(pan);
      },
      onBulkheadBreach: () => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('bulkheadBreach');
        this.host.audio.playBulkheadBreachKlaxon();
      },
      onFlarePop: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('flarePop');
        this.host.audio.playStrobeFlareIgnite(pan);
      },
      onOverclockSurge: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('overclockSurge');
        this.host.audio.playOverclockSurge(pan);
      },
      onServoStep: (pan) => {
        if (import.meta.env.DEV) this.devAutoCommander?.recordAudio('servoStep');
        this.host.audio.playTurretServoStep(pan);
      },
      onLogClick: () => this.host.audio.playAsmrScrollClack(0.55),
      onSyncGlitch: (intensity) => {
        this.glitchIntensity = Math.max(this.glitchIntensity, intensity);
      },
    });

    this.sim.onSectorChanged = (sectorId) => {
      this.syncCameraForSectorChange(sectorId);
    };
  }

  private getWorldDims(): { w: number; h: number } {
    const bp = this.sim.blueprint;
    return {
      w: bp.cols * bp.tileSize,
      h: bp.rows * bp.tileSize,
    };
  }

  private fitCameraToBlueprint(): void {
    const { w, h } = this.getWorldDims();
    this.camera = {
      centerX: w * 0.5,
      centerY: h * 0.5,
      zoom: 1.0,
    };
  }

  private syncCameraForSectorChange(sectorId: SectorId): void {
    const prevSector = this.lastSectorId;
    this.lastSectorId = sectorId;
    this.lastSectorTransitionVersion = this.sim.sectorTransitionVersion;
    this.fitCameraToBlueprint();
    this.selectedTurretId = null;
    this.selectedDoorId = null;
    this.dragBuildAnchor = null;
    this.dragRotateTurretId = null;
    this.lastBuildHoverTile = null;
    this.previewAngleLockedByUser = false;
    this.activeTool = { kind: 'INSPECT' };
    if (this.sim.waveNumber > 1 && sectorId !== prevSector) {
      this.showToast(
        `SECTOR EXTRACTION COMPLETE // DEPLOYED TO ${sectorId} — 100% SCRAP REFUNDED!`,
        4.2
      );
    }
  }

  public mount(): void {
    this.unmount();
    this.listenerAbort = new AbortController();
    const signal = this.listenerAbort.signal;

    const vp = this.host.getViewport();
    this.resize(vp.width, vp.height, vp.offsetX, vp.offsetY);

    this.keysDown.clear();
    this.activeTool = { kind: 'INSPECT' };
    this.selectedTurretId = null;
    this.hoveredTurretId = null;
    this.selectedDoorId = null;
    this.hoveredButtonId = null;
    this.dragBuildAnchor = null;
    this.dragRotateTurretId = null;
    this.lastBuildHoverTile = null;
    this.previewAngleLockedByUser = false;
    this.lastToolAutoExitMs = 0;
    this.panDragState = null;
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.wikiOpen = false;
    this.controlsCardOpen = false;
    this.pauseBannerOpen = false;
    this.draftPeekMap = false;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.postRunKeylockSec = 0;
    this.callsignEditing = false;
    this.wikiChapterIdx = 0;
    this.wikiScrollPx = 0;
    this.tutorialDirector.stop(this.sim);

    // Start fresh Endless Hive Siege briefing on cartridge mount
    this.runPlaytimeSec = 0;
    this.sim.resetRun('ENDLESS_SIEGE', true);
    this.prevPhase = this.sim.phase;
    this.lastSectorId = this.sim.blueprint.sectorId;
    this.lastSectorTransitionVersion = this.sim.sectorTransitionVersion;
    this.fitCameraToBlueprint();
    this.callsignDraft = this.manifest.getSavedCallsign();
    this.scoreSubmitted = false;
    this.submittingScore = false;
    this.submitResultBanner = null;
    this.submitResultTone = 'amber';

    this.bindListeners(signal);

    if (import.meta.env.DEV) {
      this.debugTainted = false;
      this.devAutoCommander?.resetAudioTelemetry();
      this.devAutoCommander?.setEnabled(false);

      const resolveTurret = (idOrCallsign: string) => {
        const up = idOrCallsign.toUpperCase();
        return this.sim.turrets.find((t) => t.id === idOrCallsign || t.callsign.toUpperCase() === up);
      };

      const buildStateSnapshot = (): Record<string, unknown> => {
        const audioSnap = this.devAutoCommander?.getAudioTelemetry() ?? {
          eventsLast5SecPerSec: 0,
          eventsLast5SecByType: {},
          totalCounts: {},
        };
        const byKind: Record<string, number> = {};
        const bosses: Array<Record<string, unknown>> = [];
        for (const h of this.sim.hostiles) {
          byKind[h.kind] = (byKind[h.kind] ?? 0) + 1;
          if (h.isBoss) {
            bosses.push({
              id: h.id,
              kind: h.kind,
              hp: Math.ceil(h.hp),
              maxHp: h.maxHp,
              x: Math.round(h.pos.x),
              y: Math.round(h.pos.y),
              verified: h.verified,
              illuminated: h.illuminated,
              stunned: h.stunTimer > 0,
              chilled: h.cryoSlowTimer > 0,
              burning: h.napalmBurnTimer > 0,
              charging: h.chargeTelegraphTimer > 0 || h.chargeActiveTimer > 0,
            });
          }
        }

        const openMountPads: Array<{ col: number; row: number }> = [];
        const openDuctGrates: Array<{ col: number; row: number }> = [];
        const bp = this.sim.blueprint;
        for (let r = 0; r < bp.rows; r++) {
          for (let c = 0; c < bp.cols; c++) {
            const k = bp.tiles[r][c];
            if (k !== 'MOUNT_PAD' && k !== 'DUCT_GRATE') continue;
            if (this.sim.turrets.some((t) => t.col === c && t.row === r)) continue;
            if (k === 'MOUNT_PAD') openMountPads.push({ col: c, row: r });
            else openDuctGrates.push({ col: c, row: r });
          }
        }

        const mut = WAVE_MUTATORS[this.sim.activeMutator];
        return {
          phase: this.sim.phase,
          waveNumber: this.sim.waveNumber,
          waveTitle: this.sim.currentWaveDef.title,
          sectorId: this.sim.blueprint.sectorId,
          pendingBreachIds: [...this.sim.pendingBreachIds],
          activeBreachIds: [...this.sim.activeBreachIds],
          tacticalPaused: this.sim.tacticalPaused,
          fastForward2x: this.sim.fastForward2x,
          autoCommanderEnabled: this.devAutoCommander?.isEnabled() ?? false,
          autoCommanderActions: this.devAutoCommander?.getRecentActions() ?? [],
          debugTainted: this.debugTainted,
          economy: {
            scrap: this.sim.scrap,
            score: this.sim.score,
            totalKills: this.sim.totalKills,
            streak: this.sim.perfectWaveStreak,
            streakMult: this.sim.getStreakMultiplier(),
            activeScoreMult: this.sim.getActiveScoreMultiplier(),
            reactorExpandCost: this.sim.getReactorExpandCost(),
            reactorExpansionsBought: this.sim.reactorExpansionsBought,
          },
          reactor: {
            usedKw: this.sim.getTotalLoadKw(),
            staticKw: this.sim.getStaticAllocatedKw(),
            maxKw: this.sim.maxReactorKw,
            freeKw: this.sim.maxReactorKw - this.sim.getTotalLoadKw(),
            reserveBattery: Number(this.sim.reserveBattery.toFixed(1)),
            overloadTimer: Number(this.sim.overloadTimer.toFixed(2)),
            blackoutTimer: Number(this.sim.blackoutTimer.toFixed(2)),
            auxShedActive: this.sim.auxShedActive,
            floodlightTimer: Number(this.sim.floodlightTimer.toFixed(2)),
          },
          seals: {
            coreSeals: this.sim.bulkheadSeals,
            maxCoreSeals: PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS,
            sealedDoors: this.sim.getActiveSealedDoorCount(),
            maxDoorSeals: this.sim.getMaxDoorSeals(),
            doors: Array.from(this.sim.doors.values()).map((d) => ({
              id: d.def.id,
              welded: d.welded,
              hp: Math.round(d.hp),
              maxHp: d.maxHp,
              weldingTimer: Number(d.weldingTimer.toFixed(2)),
            })),
          },
          mutator: {
            id: this.sim.activeMutator,
            label: mut.label,
            scoreMult: mut.scoreMult,
          },
          protocols: {
            draftMode: this.sim.draftMode,
            active: { ...this.sim.activeProtocols },
            activeOmegas: [...this.sim.activeOmegas],
            activeEndgame: { ...this.sim.activeEndgameDirectives },
            draftChoices: [...this.sim.protocolDraftChoices],
            omegaDraftChoices: [...this.sim.omegaDraftChoices],
            draftChoiceSpecs: this.sim.protocolDraftChoices.map((id) =>
              id in ENDGAME_DIRECTIVES
                ? ENDGAME_DIRECTIVES[id as EndgameDirectiveId]
                : TACTICAL_PROTOCOLS[id as ProtocolId]
            ),
            omegaDraftChoiceSpecs: this.sim.omegaDraftChoices.map((id) => OMEGA_DIRECTIVES[id]),
          },
          cooldowns: {
            flare: Number(this.sim.flareCooldown.toFixed(2)),
            overclock: Number(this.sim.overclockCooldown.toFixed(2)),
            coolantFlush: Number(this.sim.coolantFlushCooldown.toFixed(2)),
            floodlight: Number(this.sim.floodlightCooldown.toFixed(2)),
            purgeAvailable: this.sim.purgeAvailableThisWave,
          },
          turrets: this.sim.turrets.map((t) => ({
            id: t.id,
            callsign: t.callsign,
            kind: t.kind,
            col: t.col,
            row: t.row,
            level: t.level,
            mk3Branch: t.mk3Branch ?? null,
            mk3Code:
              t.level === 3 && t.mk3Branch ? MK3_BRANCH_SPECS[t.kind][t.mk3Branch].code : null,
            mk4Level: t.mk4Level ?? 0,
            powerUpTimer: Number((t.powerUpTimer ?? 0).toFixed(2)),
            powered: t.powered,
            kw: this.sim.getTurretPowerKw(t),
            ammo: t.ammo,
            maxAmmo: t.maxAmmo,
            rearmTimer: Number(t.rearmTimer.toFixed(2)),
            heat: Math.round(t.heat),
            thermalLocked: t.thermalLocked,
            overclockTimer: Number(t.overclockTimer.toFixed(2)),
            relayBoosted: t.relayBoosted,
            relayMatrixBoosted: t.relayMatrixBoosted,
            acidDebuffTimer: Number(t.acidDebuffTimer.toFixed(2)),
            jammedTimer: Number(t.jammedTimer.toFixed(2)),
            kills: t.kills,
          })),
          hazards: {
            claymores: this.sim.claymores.length,
            eggSacs: this.sim.eggSacs.length,
            acidPools: this.sim.acidPools.length,
            acidSpits: this.sim.acidSpits.length,
            phantomBlips: this.sim.phantomBlips.length,
            grateTelegraphs: this.sim.grateTelegraphs.length,
            flares: this.sim.flares.length,
            napalmClouds: this.sim.napalmClouds.length,
          },
          hostiles: {
            total: this.sim.hostiles.length,
            pendingSpawns: this.sim.getPendingSpawnCount(),
            verified: this.sim.hostiles.filter((h) => h.verified).length,
            byKind,
            bosses,
          },
          openHardpoints: {
            mountPadsCount: openMountPads.length,
            ductGratesCount: openDuctGrates.length,
            mountPads: openMountPads.slice(0, 8),
            ductGrates: openDuctGrates,
          },
          selected: {
            turretId: this.selectedTurretId,
            doorId: this.selectedDoorId,
            activeTool: this.activeTool.kind,
          },
          recentLogs: this.sim.eventLogs.slice(-8),
          audioTelemetry: {
            muted: this.host.isMuted(),
            busActivity: Number(this.host.audio.getBusActivityLevel().toFixed(3)),
            reactorAudio: this.sim.getReactorAudioTelemetry(),
            ...audioSnap,
          },
        };
      };

      window.__PERIMETER_DEBUG__ = {
        getState: buildStateSnapshot,
        placeUnit: (buildId, col, row, aimAngle) => {
          this.debugTainted = true;
          if (col !== undefined && row !== undefined) {
            const ang = aimAngle ?? this.sim.computeDefaultAimAngle(col, row);
            const res = this.sim.deployHardware(buildId, col, row, ang);
            if (res.ok && res.placedTurret) {
              this.selectedTurretId = res.placedTurret.id;
              this.selectedDoorId = null;
            }
            return {
              ok: res.ok,
              msg: res.reason ?? `DEPLOYED ${res.placedTurret?.callsign ?? buildId}`,
              turretId: res.placedTurret?.id,
            };
          }
          const placed = this.devAutoCommander?.placeBestHardware(this.sim, buildId) ?? {
            ok: false,
            msg: 'AUTO COMMANDER UNAVAILABLE',
          };
          if (placed.ok && placed.turretId) {
            this.selectedTurretId = placed.turretId;
            this.selectedDoorId = null;
          }
          return placed;
        },
        upgradeUnit: (idOrCallsign, mk3Branch) => {
          this.debugTainted = true;
          const t = resolveTurret(idOrCallsign);
          if (!t) return { ok: false, msg: `TURRET ${idOrCallsign} NOT FOUND` };
          this.selectedTurretId = t.id;
          this.selectedDoorId = null;
          return this.sim.upgradeTurret(t.id, mk3Branch);
        },
        selectUnit: (idOrCallsign) => {
          if (!idOrCallsign) {
            this.selectedTurretId = null;
            return { selectedTurretId: null };
          }
          const t = resolveTurret(idOrCallsign);
          this.selectedTurretId = t?.id ?? null;
          this.selectedDoorId = null;
          return { selectedTurretId: this.selectedTurretId };
        },
        sellUnit: (idOrCallsign) => {
          this.debugTainted = true;
          const t = resolveTurret(idOrCallsign);
          if (!t) return { ok: false, msg: `TURRET ${idOrCallsign} NOT FOUND` };
          const r = this.sim.scrapTurret(t.id);
          if (this.selectedTurretId === t.id) this.selectedTurretId = null;
          return r;
        },
        toggleUnitPower: (idOrCallsign) => {
          this.debugTainted = true;
          const t = resolveTurret(idOrCallsign);
          if (!t) return { ok: false, msg: `TURRET ${idOrCallsign} NOT FOUND` };
          return this.sim.toggleTurretPower(t.id);
        },
        rearmAll: () => {
          this.debugTainted = true;
          return this.sim.rearmAllSentries();
        },
        expandReactor: () => {
          this.debugTainted = true;
          return this.sim.expandReactorBus();
        },
        fabricateSeal: () => {
          this.debugTainted = true;
          return this.sim.fabricateCoreSeal();
        },
        toggleAuxShed: () => {
          this.debugTainted = true;
          return this.sim.toggleAuxLoadShed();
        },
        triggerAbility: (abilityId, targetPos) => {
          this.debugTainted = true;
          if (abilityId === 'FLOODLIGHT' || abilityId === 'COOLANT_FLUSH') {
            return this.sim.triggerInstantCommandAbility(abilityId);
          }
          let pos = targetPos;
          if (!pos) {
            if (abilityId === 'OVERCLOCK') {
              const t = this.sim.turrets.find((u) => u.powered);
              pos = t ? { ...t.pos } : { ...this.sim.blueprint.coreCenter };
            } else if (abilityId === 'PURGE') {
              const al = this.sim.blueprint.airlocks[0];
              pos = al ? { ...al.center } : { ...this.sim.blueprint.coreCenter };
            } else {
              const h = this.sim.hostiles[0];
              pos = h ? { ...h.pos } : { ...this.sim.blueprint.coreCenter };
            }
          }
          return this.sim.triggerCommandAbility(abilityId, pos);
        },
        pickProtocol: (indexOrId) => {
          this.debugTainted = true;
          if (this.sim.draftMode === 'OMEGA') {
            const omegaId =
              typeof indexOrId === 'number'
                ? this.sim.omegaDraftChoices[indexOrId]
                : (indexOrId as OmegaDirectiveId);
            if (!omegaId) return { ok: false, msg: 'INVALID OMEGA INDEX OR ID' };
            return this.sim.selectOmegaDirective(omegaId);
          }
          const protoId =
            typeof indexOrId === 'number'
              ? this.sim.protocolDraftChoices[indexOrId]
              : (indexOrId as DraftChoiceId);
          if (!protoId) return { ok: false, msg: 'INVALID PROTOCOL INDEX OR ID' };
          return this.sim.selectProtocolDraft(protoId);
        },
        launchWave: () => {
          this.debugTainted = true;
          if (this.sim.phase === 'BRIEFING') this.sim.phase = 'TACTICAL_PREP';
          if (this.sim.phase === 'TACTICAL_PREP') this.sim.launchNextWave();
          return { phase: this.sim.phase, waveNumber: this.sim.waveNumber };
        },
        setSpeed: (fast2x) => {
          this.sim.fastForward2x = Boolean(fast2x);
          return { fastForward2x: this.sim.fastForward2x };
        },
        setPaused: (paused) => {
          this.sim.tacticalPaused = Boolean(paused);
          return { tacticalPaused: this.sim.tacticalPaused };
        },
        grantScrap: (amount) => {
          this.debugTainted = true;
          this.sim.scrap = Math.max(0, this.sim.scrap + Math.round(amount));
          return { scrap: this.sim.scrap };
        },
        setBattery: (pct) => {
          this.debugTainted = true;
          this.sim.reserveBattery = Math.max(0, Math.min(100, pct));
          return { reserveBattery: this.sim.reserveBattery };
        },
        setSeals: (count) => {
          this.debugTainted = true;
          this.sim.bulkheadSeals = Math.max(
            1,
            Math.min(PERIMETER_CONSTANTS.MAX_BULKHEAD_SEALS, Math.round(count))
          );
          return { bulkheadSeals: this.sim.bulkheadSeals };
        },
        jumpToWave: (waveNum, autoLaunch = false) => {
          this.debugTainted = true;
          this.osdMenuOpen = false;
          this.manifestOpen = false;
          this.devAutoCommander?.jumpToWave(this.sim, waveNum, autoLaunch);
          return buildStateSnapshot();
        },
        triggerProtocolDraft: () => {
          this.debugTainted = true;
          return { choices: this.devAutoCommander?.openProtocolDraft(this.sim) ?? [] };
        },
        clearHostiles: (triggerWaveComplete = true) => {
          this.debugTainted = true;
          this.devAutoCommander?.clearHostiles(this.sim, triggerWaveComplete);
          return { phase: this.sim.phase, waveNumber: this.sim.waveNumber };
        },
        fastStep: (seconds, stepDt = 1 / 60) => {
          this.debugTainted = true;
          const clampedSec = Math.max(0, Math.min(360, seconds));
          const dt = Math.max(1 / 120, Math.min(0.05, stepDt));
          const steps = Math.ceil(clampedSec / dt);
          for (let i = 0; i < steps; i++) {
            this.devAutoCommander?.step(this.sim, dt);
            this.sim.step(dt);
          }
          return buildStateSnapshot();
        },
        setAutoCommander: (enabled, opts) => {
          this.debugTainted = true;
          this.devAutoCommander?.setEnabled(Boolean(enabled), opts);
          return {
            enabled: this.devAutoCommander?.isEnabled() ?? false,
            opts: this.devAutoCommander?.getOptions() ?? {
              autoLaunch: true,
              godSeals: false,
              autoPickProtocol: true,
            },
          };
        },
        resetAudioTelemetry: () => {
          this.devAutoCommander?.resetAudioTelemetry();
          return { reset: true };
        },
      };
    }
  }

  public unmount(): void {
    if (import.meta.env.DEV) {
      delete window.__PERIMETER_DEBUG__;
      this.devAutoCommander?.setEnabled(false);
      this.devAutoCommander?.resetAudioTelemetry();
      this.debugTainted = false;
    }
    if (this.listenerAbort) {
      this.listenerAbort.abort();
      this.listenerAbort = null;
    }
    this.keysDown.clear();
    this.dragBuildAnchor = null;
    this.dragRotateTurretId = null;
    this.lastBuildHoverTile = null;
    this.previewAngleLockedByUser = false;
    this.lastToolAutoExitMs = 0;
    this.panDragState = null;
    this.hoveredButtonId = null;
    this.hoveredTurretId = null;
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.wikiOpen = false;
    this.controlsCardOpen = false;
    this.pauseBannerOpen = false;
    this.draftPeekMap = false;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.callsignEditing = false;
    this.host.setModalOpen(false);
    this.tutorialDirector.stop(this.sim);
    document.body.style.cursor = 'default';
    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (mobileInput && document.activeElement === mobileInput) {
      mobileInput.blur();
    }
    this.host.audio.stopCartridgeLoops();
  }

  public resize(width: number, height: number, offsetX = 0, offsetY = 0): void {
    this.viewportWidth = Math.max(320, width);
    this.viewportHeight = Math.max(240, height);
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.crtRect = { x: 0, y: 0, width: this.viewportWidth, height: this.viewportHeight };
    this.clampCamera();
  }

  public setBackgroundPaused(paused: boolean): void {
    if (paused) {
      this.keysDown.clear();
      this.dragBuildAnchor = null;
      this.panDragState = null;
    }
  }

  private resetSubmissionState(resetPlaytime = false): void {
    if (resetPlaytime) {
      this.runPlaytimeSec = 0;
    }
    this.scoreSubmitted = false;
    this.submittingScore = false;
    this.submitResultBanner = null;
    this.submitResultTone = 'amber';
    this.lastSubmittedRun = null;
    this.callsignEditing = false;
    this.callsignDraft = this.manifest.getSavedCallsign();
  }

  private isActiveRankedRun(): boolean {
    if (this.sim.trainingMode) return false;
    if (this.sim.phase === 'WAVE_ACTIVE' || this.sim.phase === 'PROTOCOL_DRAFT') return true;
    if (
      this.sim.phase === 'TACTICAL_PREP' &&
      (this.sim.waveNumber > 1 || this.sim.turrets.length > 0)
    ) {
      return true;
    }
    return false;
  }

  private exitToHubNow(): void {
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.wikiOpen = false;
    this.controlsCardOpen = false;
    this.pauseBannerOpen = false;
    this.draftPeekMap = false;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.host.setModalOpen(false);
    this.tutorialDirector.stop(this.sim);
    this.host.exitToMuthurOs("TERMINATED PROGRAM 02 // HADLEY'S PERIMETER TACTICAL NET.");
  }

  private requestExitToHub(): void {
    if (this.isActiveRankedRun() && !this.confirmExitPending) {
      this.confirmExitPending = true;
      this.confirmExitTimer = 4.0;
      this.host.audio.playButtonLatchLock(0.86, 0.85);
      this.showToast('CLICK [CONFIRM EXIT?] AGAIN TO TERMINATE ACTIVE RANKED SIEGE', 3.5);
      return;
    }
    this.exitToHubNow();
  }

  /**
   * Unified Instant Replay: jumps straight into Wave 1 Prep (showBriefing = false) — never re-shows Briefing!
   */
  private startFreshReplay(): void {
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.wikiOpen = false;
    this.controlsCardOpen = false;
    this.pauseBannerOpen = false;
    this.draftPeekMap = false;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.postRunKeylockSec = 0;
    this.activeTool = { kind: 'INSPECT' };
    this.selectedTurretId = null;
    this.selectedDoorId = null;
    this.tutorialDirector.stop(this.sim);
    this.resetSubmissionState(true);
    const ranked1979Bonus = this.host.getCrtPreset() === 'CLASSIC_1979';
    this.sim.resetRun('ENDLESS_SIEGE', false, ranked1979Bonus);
    this.host.setCrtModeLocked(ranked1979Bonus);
    this.prevPhase = this.sim.phase;
    this.fitCameraToBlueprint();
  }

  private getSystemMenuCallbacks(): SystemMenuActionCallbacks {
    return {
      onResume: () => {
        this.osdMenuOpen = false;
        this.confirmExitPending = false;
      },
      onRestart: () => {
        this.startFreshReplay();
      },
      onOpenLeaderboard: () => {
        this.osdMenuOpen = false;
        this.manifestOpen = true;
      },
      onExitToHub: () => {
        this.requestExitToHub();
      },
      onExtraAction: (extraId: string) => {
        if (extraId === 'perim-wiki-open') {
          this.osdMenuOpen = false;
          this.manifestOpen = false;
          this.controlsCardOpen = false;
          this.wikiOpen = true;
        } else if (extraId === 'perim-drill-start') {
          this.handleHudButton('perim-drill-start');
        } else if (extraId === 'perim-drill-exit') {
          this.handleHudButton('perim-drill-exit');
        }
      },
    };
  }

  private async submitCurrentRunScore(): Promise<void> {
    if (this.scoreSubmitted || this.submittingScore) return;
    if (this.sim.trainingMode) {
      this.submitResultBanner = 'SIMULATION DRILL UNRANKED — SUBMISSION BLOCKED';
      this.submitResultTone = 'amber';
      return;
    }
    if (import.meta.env.DEV && this.debugTainted) {
      this.submitResultBanner = 'DEV DEBUG ACTIVE — ORBITAL UPLINK SUBMISSION BLOCKED';
      this.submitResultTone = 'red';
      this.host.audio.playMutedAvionicsIndicatorBeep(false);
      return;
    }
    this.submittingScore = true;
    this.submitResultBanner = 'TRANSMITTING TELEMETRY TO ORBITAL RELAY...';
    this.submitResultTone = 'amber';
    const finalScore = Math.max(1, this.sim.score);
    const finalWaves = Math.max(1, this.sim.waveNumber);
    const finalKills = Math.max(0, this.sim.totalKills);
    const finalMode = this.sim.mode;
    const res = await this.manifest.submitScore({
      callsign: this.callsignDraft,
      waves: finalWaves,
      kills: finalKills,
      score: finalScore,
      mode: finalMode,
      playtimeSec: this.runPlaytimeSec,
    });
    this.submittingScore = false;
    if (res.rejectedReason) {
      this.submitResultBanner = res.rejectedReason;
      this.submitResultTone = 'red';
      this.host.audio.playMutedAvionicsIndicatorBeep(false);
      return;
    }
    this.scoreSubmitted = true;
    this.callsignEditing = false;
    this.callsignDraft = this.manifest.getSavedCallsign();
    const persistedScore = res.submittedScore ?? finalScore;
    this.lastSubmittedRun = {
      docId: res.docId,
      callsign: this.callsignDraft,
      score: persistedScore,
      waves: finalWaves,
      kills: finalKills,
      mode: finalMode,
      rank: res.rank,
    };
    this.host.audio.playButtonLatchLock(1.05, 0.9);
    this.submitResultTone = 'green';
    this.submitResultBanner = res.offlineFallback
      ? `LOGGED TO LOCAL TAPE ARCHIVE — RANK #${res.rank}`
      : `TRANSMISSION CONFIRMED // ORBITAL RELAY RANK #${res.rank}!`;
    // Auto-open unified Global Manifest immediately with boxed ★ JUST ADDED badge
    this.manifestOpen = true;
  }

  private focusMobileCallsignInput(): void {
    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (!mobileInput) return;
    mobileInput.value = this.callsignDraft;
    try {
      mobileInput.focus({ preventScroll: true });
    } catch {
      mobileInput.focus();
    }
  }

  private showToast(msg: string, duration = 2.2): void {
    this.statusToast = msg;
    this.statusToastTimer = duration;
  }

  private getCurrentLayout(): PerimeterLayout {
    return this.hudRenderer.computeLayout(this.viewportWidth, this.viewportHeight);
  }

  private clampCamera(): void {
    const { w: worldW, h: worldH } = this.getWorldDims();
    this.camera.zoom = Math.max(1.0, Math.min(2.5, this.camera.zoom));
    if (this.camera.zoom <= 1.01) {
      this.camera.centerX = worldW * 0.5;
      this.camera.centerY = worldH * 0.5;
      return;
    }
    const halfSpanX = (worldW * 0.5) / this.camera.zoom;
    const halfSpanY = (worldH * 0.5) / this.camera.zoom;
    const minX = Math.min(worldW * 0.5, halfSpanX);
    const maxX = Math.max(worldW * 0.5, worldW - halfSpanX);
    const minY = Math.min(worldH * 0.5, halfSpanY);
    const maxY = Math.max(worldH * 0.5, worldH - halfSpanY);
    this.camera.centerX = Math.max(minX, Math.min(maxX, this.camera.centerX));
    this.camera.centerY = Math.max(minY, Math.min(maxY, this.camera.centerY));
  }

  private bindListeners(signal: AbortSignal): void {
    window.addEventListener(
      'contextmenu',
      (e) => {
        e.preventDefault();
      },
      { signal }
    );

    window.addEventListener(
      'blur',
      () => {
        this.keysDown.clear();
        this.dragBuildAnchor = null;
        this.dragRotateTurretId = null;
        this.panDragState = null;
      },
      { signal }
    );

    window.addEventListener(
      'keyup',
      (e) => {
        this.keysDown.delete(e.code);
      },
      { signal }
    );

    window.addEventListener(
      'keydown',
      (e) => {
        if (
          ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)
        ) {
          e.preventDefault();
        }
        void this.host.audio.unlock();
        this.keysDown.add(e.code);
        this.handleKeyDown(e);
      },
      { signal }
    );

    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (mobileInput) {
      mobileInput.addEventListener(
        'input',
        () => {
          const isPostRun =
            this.sim.phase === 'CORE_BREACHED' || this.sim.phase === 'CALLSIGN_ENTRY';
          if (!isPostRun || this.scoreSubmitted) return;
          this.callsignDraft = sanitizeCallsignDraft(mobileInput.value);
          mobileInput.value = this.callsignDraft;
        },
        { signal }
      );
      mobileInput.addEventListener(
        'keydown',
        (ev) => {
          const isPostRun =
            this.sim.phase === 'CORE_BREACHED' || this.sim.phase === 'CALLSIGN_ENTRY';
          if (ev.key === 'Enter' && isPostRun && !this.scoreSubmitted) {
            ev.preventDefault();
            this.callsignEditing = false;
            mobileInput.blur();
            void this.submitCurrentRunScore();
          }
        },
        { signal }
      );
    }

    window.addEventListener(
      'pointermove',
      (e) => {
        const mapped = this.host.webglCrt.mapClientToCrtUv(
          e.clientX - this.offsetX,
          e.clientY - this.offsetY,
          this.crtRect,
          this.host.getCrtIntensity()
        );
        const cx = mapped.u * this.crtRect.width;
        const cy = mapped.v * this.crtRect.height;
        this.cursorCrtPx = { x: cx, y: cy };

        const layout = this.getCurrentLayout();
        const bpVp = layout.blueprintViewport;

        // Handle Middle-Mouse or Right-Mouse Panning
        if (this.panDragState && e.pointerId === this.panDragState.pointerId) {
          const dxPx = cx - this.panDragState.startX;
          const dyPx = cy - this.panDragState.startY;
          if (Math.hypot(dxPx, dyPx) > 5) {
            this.panDragState.moved = true;
          }
          if (this.panDragState.moved && this.camera.zoom > 1.0) {
            const { w: worldW, h: worldH } = this.getWorldDims();
            const tf = this.blueprintRenderer.computeTransform(bpVp, this.camera, worldW, worldH);
            this.camera.centerX = this.panDragState.camStartX - dxPx / tf.scale;
            this.camera.centerY = this.panDragState.camStartY - dyPx / tf.scale;
            this.clampCamera();
          }
          return;
        }

        this.hoveredButtonId = mapped.inside ? this.hitTestHudButtons(cx, cy) : null;

        this.cursorInsideBlueprint =
          mapped.inside &&
          !this.osdMenuOpen &&
          !this.manifestOpen &&
          !this.wikiOpen &&
          !this.controlsCardOpen &&
          !this.pauseBannerOpen &&
          !this.tutorialDirector.graduated &&
          this.sim.phase !== 'BRIEFING' &&
          (this.sim.phase !== 'PROTOCOL_DRAFT' || this.draftPeekMap) &&
          this.sim.phase !== 'CORE_BREACHED' &&
          this.sim.phase !== 'CALLSIGN_ENTRY' &&
          cx >= bpVp.x &&
          cx <= bpVp.x + bpVp.width &&
          cy >= bpVp.y &&
          cy <= bpVp.y + bpVp.height;

        if (this.cursorInsideBlueprint || this.dragBuildAnchor || this.dragRotateTurretId) {
          const { w: worldW, h: worldH } = this.getWorldDims();
          this.cursorVirtual = this.blueprintRenderer.screenToVirtual(
            bpVp,
            this.camera,
            cx,
            cy,
            worldW,
            worldH
          );
          this.hoveredTurretId = this.cursorInsideBlueprint
            ? this.sim.findTurretAt(this.cursorVirtual, 36)?.id ?? null
            : null;
        } else {
          this.cursorVirtual = null;
          this.hoveredTurretId = null;
        }

        // Update drag-to-aim angle during hardware placement!
        if (this.dragBuildAnchor && this.cursorVirtual) {
          const ts = this.sim.blueprint.tileSize;
          const ax = this.dragBuildAnchor.col * ts + ts * 0.5;
          const ay = this.dragBuildAnchor.row * ts + ts * 0.5;
          if (Math.hypot(this.cursorVirtual.x - ax, this.cursorVirtual.y - ay) > 12) {
            this.dragBuildAnchor.angle = Math.atan2(
              this.cursorVirtual.y - ay,
              this.cursorVirtual.x - ax
            );
          }
        }

        // Update drag-to-aim angle on existing selected turret!
        if (this.dragRotateTurretId && this.cursorVirtual) {
          const t = this.sim.turrets.find((u) => u.id === this.dragRotateTurretId);
          if (t && Math.hypot(this.cursorVirtual.x - t.pos.x, this.cursorVirtual.y - t.pos.y) > 16) {
            this.sim.setTurretTargetAngle(
              t.id,
              Math.atan2(this.cursorVirtual.y - t.pos.y, this.cursorVirtual.x - t.pos.x)
            );
          }
        }

        // Recompute optimal corridor aim angle whenever hovering a new hardpoint (with magnetic snap)!
        if (
          !this.dragBuildAnchor &&
          this.activeTool.kind === 'BUILD' &&
          this.cursorVirtual &&
          this.activeTool.buildId !== 'ARC_WELDER' &&
          this.activeTool.buildId !== 'CRYO_VALVE' &&
          this.activeTool.buildId !== 'SHOCK_COIL' &&
          this.activeTool.buildId !== 'CLAYMORE'
        ) {
          const resolved = this.sim.resolveMagneticBuildCell(
            this.activeTool.buildId,
            this.cursorVirtual
          );
          const col = resolved.col;
          const row = resolved.row;
          const movedTile =
            !this.lastBuildHoverTile ||
            this.lastBuildHoverTile.col !== col ||
            this.lastBuildHoverTile.row !== row;
          if (movedTile) {
            this.lastBuildHoverTile = { col, row };
            this.previewAngleLockedByUser = false;
            const rule = this.tutorialDirector.getSnapshot(this.sim).activePlacementRule;
            if (
              rule &&
              rule.buildId === this.activeTool.buildId &&
              rule.targetAngle !== undefined
            ) {
              this.activeTool.previewAngle = rule.targetAngle;
            } else if (this.sim.canPlaceHardwareAt(this.activeTool.buildId, col, row).ok) {
              this.activeTool.previewAngle = this.sim.computeDefaultAimAngle(col, row);
            }
          }
        }

        if (this.hoveredButtonId) {
          document.body.style.cursor = 'pointer';
        } else if (this.cursorInsideBlueprint && this.activeTool.kind !== 'INSPECT') {
          document.body.style.cursor = 'crosshair';
        } else {
          document.body.style.cursor = 'default';
        }
      },
      { signal }
    );

    window.addEventListener(
      'pointerdown',
      (e) => {
        void this.host.audio.unlock();
        const mapped = this.host.webglCrt.mapClientToCrtUv(
          e.clientX - this.offsetX,
          e.clientY - this.offsetY,
          this.crtRect,
          this.host.getCrtIntensity()
        );
        if (!mapped.inside) return;

        const cx = mapped.u * this.crtRect.width;
        const cy = mapped.v * this.crtRect.height;

        // Middle-click or Right-click inside blueprint starts camera pan (or cancels active tool on quick right-click)
        if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) {
          e.preventDefault();
          this.panDragState = {
            pointerId: e.pointerId,
            startX: cx,
            startY: cy,
            camStartX: this.camera.centerX,
            camStartY: this.camera.centerY,
            moved: false,
            button: e.button,
          };
          return;
        }

        if (e.pointerType === 'mouse' && e.button !== 0) return;

        // 1. Check HUD / Modal Buttons First (respecting disabled buttons via hitTestChromeButtons)
        const btn = this.hitTestHudButtons(cx, cy);
        if (btn) {
          if (btn !== TOP_CHROME_IDS.HUB && btn !== 'sys-exit-hub') {
            this.confirmExitPending = false;
            this.confirmExitTimer = 0;
          }
          if (btn !== 'insp-rearm' && !btn.startsWith('rack-rearm-')) {
            this.host.audio.playButtonLatchLock(0.95, 0.92);
          }
          this.handleHudButton(btn);
          return;
        }

        // Clicking outside confirm-exit button clears the latch
        if (this.confirmExitPending) {
          this.confirmExitPending = false;
          this.confirmExitTimer = 0;
        }

        if (this.wikiOpen) {
          const track = this.hudRenderer.wikiScrollbarTrack;
          if (
            track &&
            this.hudRenderer.wikiMaxScrollPx > 0 &&
            cx >= track.x - 8 &&
            cx <= track.x + track.width + 8 &&
            cy >= track.y &&
            cy <= track.y + track.height
          ) {
            const frac = Math.max(0, Math.min(1, (cy - track.y) / Math.max(1, track.height)));
            this.wikiScrollPx = Math.round(frac * this.hudRenderer.wikiMaxScrollPx);
          }
          return;
        }

        if (
          this.osdMenuOpen ||
          this.manifestOpen ||
          this.controlsCardOpen ||
          this.pauseBannerOpen ||
          this.tutorialDirector.graduated ||
          this.sim.phase === 'BRIEFING' ||
          this.sim.phase === 'PROTOCOL_DRAFT' ||
          this.sim.phase === 'CALLSIGN_ENTRY' ||
          this.sim.phase === 'CORE_BREACHED'
        ) {
          return;
        }

        // 2. Click inside Central CAD Blueprint Viewport
        const layout = this.getCurrentLayout();
        const bpVp = layout.blueprintViewport;
        if (
          cx < bpVp.x ||
          cx > bpVp.x + bpVp.width ||
          cy < bpVp.y ||
          cy > bpVp.y + bpVp.height
        ) {
          return;
        }

        const { w: worldW, h: worldH } = this.getWorldDims();
        const virt = this.blueprintRenderer.screenToVirtual(
          bpVp,
          this.camera,
          cx,
          cy,
          worldW,
          worldH
        );
        this.cursorVirtual = virt;
        const ts = this.sim.blueprint.tileSize;

        // Rotate-Turret Aiming Click
        if (this.activeTool.kind === 'ROTATE_TURRET') {
          const rotId = this.activeTool.turretId;
          const t = this.sim.turrets.find((u) => u.id === rotId);
          if (t) {
            const ang = Math.atan2(virt.y - t.pos.y, virt.x - t.pos.x);
            this.sim.setTurretTargetAngle(t.id, ang);
            this.showToast(`${t.callsign} SERVO SLEWING TO ${Math.round(((ang * 180) / Math.PI + 360) % 360)}°`);
          }
          this.activeTool = { kind: 'INSPECT' };
          this.lastToolAutoExitMs = performance.now();
          return;
        }

        // Active Command Ability Deployment Click
        if (this.activeTool.kind === 'ABILITY') {
          const castId = this.activeTool.abilityId;
          const gate = this.tutorialDirector.validateTargetedAbility(this.sim, castId, virt);
          if (!gate.ok) {
            this.host.audio.playMutedAvionicsIndicatorBeep(false);
            this.showToast(gate.reason ?? 'TARGET THE PULSING DRILL ZONE!');
            return;
          }
          const res = this.sim.triggerCommandAbility(castId, virt);
          if (res.ok) {
            this.tutorialDirector.notifyAbilityUsed(castId);
            this.activeTool = { kind: 'INSPECT' };
            this.lastToolAutoExitMs = performance.now();
            this.showToast(res.msg);
          } else {
            this.host.audio.playMutedAvionicsIndicatorBeep(false);
            this.showToast(res.msg);
          }
          return;
        }

        // Hardware Build Deployment (with Magnetic Hardpoint Snap + Mouse-Drag Cone Aiming!)
        if (this.activeTool.kind === 'BUILD') {
          const bId = this.activeTool.buildId;
          const resolved = this.sim.resolveMagneticBuildCell(bId, virt);
          const snapCol = resolved.col;
          const snapRow = resolved.row;
          const check = this.sim.canPlaceHardwareAt(bId, snapCol, snapRow);
          if (!check.ok) {
            // Allow clicking an existing turret/door to inspect if clicked directly on it
            const existingT = this.sim.findTurretAt(virt, 28);
            if (existingT) {
              this.selectedTurretId = existingT.id;
              this.selectedDoorId = null;
              this.activeTool = { kind: 'INSPECT' };
              this.lastToolAutoExitMs = performance.now();
              this.host.audio.playSfx('ui_keyclick');
              return;
            }
            this.host.audio.playMutedAvionicsIndicatorBeep(false);
            this.showToast(check.reason ?? 'INVALID HARDPOINT');
            return;
          }

          if (
            bId === 'ARC_WELDER' ||
            bId === 'CRYO_VALVE' ||
            bId === 'SHOCK_COIL' ||
            bId === 'CLAYMORE'
          ) {
            const tutCheck = this.tutorialDirector.validatePlacement(this.sim, bId, snapCol, snapRow, 0);
            if (!tutCheck.ok) {
              this.host.audio.playMutedAvionicsIndicatorBeep(false);
              this.showToast(tutCheck.reason ?? 'DEPLOY ON THE PULSING TARGET!');
              return;
            }
            const deployed = this.sim.deployHardware(bId, snapCol, snapRow, 0);
            if (deployed.ok) {
              if (deployed.placedTurret) {
                const placePan = Math.max(
                  -0.82,
                  Math.min(0.82, (deployed.placedTurret.pos.x / worldW - 0.5) * 1.5)
                );
                this.host.audio.playWeaponDeployEmplace(deployed.placedTurret.kind, placePan);
                this.selectedTurretId = deployed.placedTurret.id;
                this.selectedDoorId = null;
              } else if (deployed.weldedDoor) {
                this.selectedDoorId = deployed.weldedDoor.def.id;
                this.selectedTurretId = null;
                this.showToast(
                  this.sim.phase === 'WAVE_ACTIVE'
                    ? `${deployed.weldedDoor.def.id} ARC-WELDING (${PERIMETER_CONSTANTS.DOOR_MIDWAVE_WELD_SEC.toFixed(1)}S)...`
                    : `${deployed.weldedDoor.def.id} SEALED`
                );
              } else if (bId === 'CLAYMORE') {
                this.tutorialDirector.notifyClaymorePlaced();
                this.showToast(
                  `M18 CLAYMORE ARMED (${this.sim.claymoresRemainingThisWave}/${this.sim.getClaymoreStockPerWave()} STOCK LEFT)`
                );
              }
              if (!e.shiftKey) {
                this.activeTool = { kind: 'INSPECT' };
                this.lastToolAutoExitMs = performance.now();
              }
            }
            return;
          }

          // Enforce exact target pad BEFORE starting directional drag in Training Drill!
          const tutRule = this.tutorialDirector.getSnapshot(this.sim).activePlacementRule;
          if (
            this.tutorialDirector.active &&
            !this.tutorialDirector.graduated &&
            tutRule &&
            tutRule.buildId === bId &&
            (snapCol !== tutRule.col || snapRow !== tutRule.row)
          ) {
            this.host.audio.playMutedAvionicsIndicatorBeep(false);
            this.showToast('DEPLOY ON THE PULSING TARGET PAD IN WEST JUNCTION!');
            return;
          }

          // Directional Hardware (UA 571-C, M240, M99 Rail-Lance, M314): Begin drag-to-aim anchor!
          const anchorPan = Math.max(
            -0.82,
            Math.min(0.82, ((snapCol * ts + ts * 0.5) / worldW - 0.5) * 1.5)
          );
          this.host.audio.playTurretTripodTouchdown(anchorPan);
          const initAng =
            tutRule && tutRule.buildId === bId && tutRule.targetAngle !== undefined
              ? tutRule.targetAngle
              : this.previewAngleLockedByUser
                ? this.activeTool.previewAngle
                : this.sim.computeDefaultAimAngle(snapCol, snapRow);
          this.dragBuildAnchor = {
            col: snapCol,
            row: snapRow,
            angle: initAng,
            shiftHeld: e.shiftKey,
          };
          return;
        }

        // Default INSPECT Mode: Select Placed Turret or Blast Door
        // (Zero accidental rotation on normal clicks — use [R], Inspector button, or Shift+Drag to aim!)
        const hitTurret = this.sim.findTurretAt(virt, 34);
        if (hitTurret) {
          this.selectedTurretId = hitTurret.id;
          this.selectedDoorId = null;
          if (
            e.shiftKey &&
            !(this.tutorialDirector.active && !this.tutorialDirector.graduated) &&
            hitTurret.kind !== 'CRYO_VALVE' &&
            hitTurret.kind !== 'SHOCK_COIL'
          ) {
            this.dragRotateTurretId = hitTurret.id;
          }
          this.host.audio.playSfx('ui_keyclick');
          return;
        }

        const hitDoor = this.sim.findDoorNearPoint(virt, 48);
        if (hitDoor) {
          this.selectedDoorId = hitDoor.def.id;
          this.selectedTurretId = null;
          this.host.audio.playSfx('ui_keyclick');
          return;
        }

        this.selectedTurretId = null;
        this.selectedDoorId = null;
      },
      { signal }
    );

    const handlePointerEnd = (e: PointerEvent) => {
      if (this.panDragState && e.pointerId === this.panDragState.pointerId) {
        const wasQuickRightClick =
          this.panDragState.button === 2 && !this.panDragState.moved;
        this.panDragState = null;
        if (wasQuickRightClick && this.activeTool.kind !== 'INSPECT') {
          this.activeTool = { kind: 'INSPECT' };
          this.statusToast = null;
          this.statusToastTimer = 0;
          this.host.audio.playSfx('ui_keyclick', { pitch: 0.85 });
        }
        return;
      }

      if (this.dragRotateTurretId) {
        this.dragRotateTurretId = null;
      }

      if (this.dragBuildAnchor && this.activeTool.kind === 'BUILD') {
        const anchor = this.dragBuildAnchor;
        this.dragBuildAnchor = null;
        const tutCheck = this.tutorialDirector.validatePlacement(
          this.sim,
          this.activeTool.buildId,
          anchor.col,
          anchor.row,
          anchor.angle
        );
        if (!tutCheck.ok) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast(tutCheck.reason ?? 'AIM ALONG THE CORRIDOR GUIDE CONE!');
          return;
        }
        const res = this.sim.deployHardware(
          this.activeTool.buildId,
          anchor.col,
          anchor.row,
          anchor.angle
        );
        if (res.ok && res.placedTurret) {
          const { w: worldW } = this.getWorldDims();
          const placePan = Math.max(
            -0.82,
            Math.min(0.82, (res.placedTurret.pos.x / worldW - 0.5) * 1.5)
          );
          this.host.audio.playWeaponDeployEmplace(res.placedTurret.kind, placePan);
          this.selectedTurretId = res.placedTurret.id;
          this.selectedDoorId = null;
          if (!anchor.shiftHeld) {
            this.activeTool = { kind: 'INSPECT' };
            this.lastToolAutoExitMs = performance.now();
          }
          this.lastBuildHoverTile = null;
          this.previewAngleLockedByUser = false;
        } else if (res.reason) {
          this.showToast(res.reason);
        }
      }
    };

    window.addEventListener('pointerup', handlePointerEnd, { signal });
    window.addEventListener('pointercancel', handlePointerEnd, { signal });

    window.addEventListener(
      'wheel',
      (e) => {
        if (this.wikiOpen) {
          e.preventDefault();
          const step = Math.sign(e.deltaY) * 112;
          this.wikiScrollPx = Math.max(
            0,
            Math.min(this.hudRenderer.wikiMaxScrollPx, this.wikiScrollPx + step)
          );
          return;
        }
        if (
          this.osdMenuOpen ||
          this.manifestOpen ||
          this.controlsCardOpen ||
          this.pauseBannerOpen ||
          this.sim.phase === 'BRIEFING'
        ) {
          return;
        }
        const layout = this.getCurrentLayout();
        const bpVp = layout.blueprintViewport;
        if (
          this.cursorCrtPx.x >= bpVp.x &&
          this.cursorCrtPx.x <= bpVp.x + bpVp.width &&
          this.cursorCrtPx.y >= bpVp.y &&
          this.cursorCrtPx.y <= bpVp.y + bpVp.height
        ) {
          e.preventDefault();
          const { w: worldW, h: worldH } = this.getWorldDims();
          const beforeVirt = this.blueprintRenderer.screenToVirtual(
            bpVp,
            this.camera,
            this.cursorCrtPx.x,
            this.cursorCrtPx.y,
            worldW,
            worldH
          );
          const delta = e.deltaY < 0 ? 0.18 : -0.18;
          this.camera.zoom = Math.max(1.0, Math.min(2.5, this.camera.zoom + delta));
          const afterVirt = this.blueprintRenderer.screenToVirtual(
            bpVp,
            this.camera,
            this.cursorCrtPx.x,
            this.cursorCrtPx.y,
            worldW,
            worldH
          );
          this.camera.centerX += beforeVirt.x - afterVirt.x;
          this.camera.centerY += beforeVirt.y - afterVirt.y;
          this.clampCamera();
        }
      },
      { passive: false, signal }
    );
  }

  private hitTestHudButtons(cx: number, cy: number): string | null {
    return hitTestChromeButtons(this.hudRenderer.buttons, cx, cy);
  }

  private selectBuildTool(buildId: Exclude<BuildToolId, 'NONE'>): void {
    if (this.tutorialDirector.active && !this.tutorialDirector.graduated) {
      const snap = this.tutorialDirector.getSnapshot(this.sim);
      if (!snap.allowedBuildIds.includes(buildId)) {
        this.host.audio.playMutedAvionicsIndicatorBeep(false);
        this.showToast('DRILL LOCK: ONLY THE HIGHLIGHTED TOOL IS ACTIVE FOR THIS STEP');
        return;
      }
      this.lastBuildHoverTile = null;
      this.previewAngleLockedByUser = false;
      if (this.activeTool.kind === 'BUILD' && this.activeTool.buildId === buildId) {
        this.activeTool = { kind: 'INSPECT' };
        return;
      }
      const defAng =
        snap.activePlacementRule?.buildId === buildId &&
        snap.activePlacementRule.targetAngle !== undefined
          ? snap.activePlacementRule.targetAngle
          : 0;
      this.activeTool = { kind: 'BUILD', buildId, previewAngle: defAng };
      return;
    }

    this.lastBuildHoverTile = null;
    this.previewAngleLockedByUser = false;
    if (this.activeTool.kind === 'BUILD' && this.activeTool.buildId === buildId) {
      this.activeTool = { kind: 'INSPECT' };
      return;
    }
    this.activeTool = { kind: 'BUILD', buildId, previewAngle: 0 };
  }

  private armCommandAbility(abilityId: CommandAbilityId): void {
    if (this.tutorialDirector.active && !this.tutorialDirector.graduated) {
      const snap = this.tutorialDirector.getSnapshot(this.sim);
      if (!snap.allowedAbilityIds.includes(abilityId)) {
        this.host.audio.playMutedAvionicsIndicatorBeep(false);
        this.showToast('DRILL LOCK: COMPLETE THE CURRENT OBJECTIVE FIRST');
        return;
      }
    }
    // Instant map-wide Reactor abilities ([L] Emergency Floodlight & [C] Emergency Coolant Flush)
    if (abilityId === 'FLOODLIGHT' || abilityId === 'COOLANT_FLUSH') {
      const res = this.sim.triggerInstantCommandAbility(abilityId);
      if (res.ok) {
        this.tutorialDirector.notifyAbilityUsed(abilityId);
      } else {
        this.host.audio.playMutedAvionicsIndicatorBeep(false);
      }
      this.showToast(res.msg);
      return;
    }

    // Smart Double-Tap [O] Overclock: if already armed AND a powered turret is selected, fire centered on it!
    if (
      abilityId === 'OVERCLOCK' &&
      this.activeTool.kind === 'ABILITY' &&
      this.activeTool.abilityId === 'OVERCLOCK' &&
      this.selectedTurretId
    ) {
      const sel = this.sim.turrets.find((u) => u.id === this.selectedTurretId && u.powered);
      if (sel) {
        const res = this.sim.triggerCommandAbility('OVERCLOCK', sel.pos);
        if (res.ok) {
          this.tutorialDirector.notifyAbilityUsed('OVERCLOCK');
          this.activeTool = { kind: 'INSPECT' };
          this.lastToolAutoExitMs = performance.now();
          this.showToast(res.msg);
        } else {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast(res.msg);
        }
        return;
      }
    }

    if (this.activeTool.kind === 'ABILITY' && this.activeTool.abilityId === abilityId) {
      this.activeTool = { kind: 'INSPECT' };
      return;
    }
    if (abilityId === 'FLARE' && this.sim.flareCooldown > 0) {
      this.showToast(`M40 STROBE FLARE RECHARGING (${this.sim.flareCooldown.toFixed(1)}S)`);
      return;
    }
    if (abilityId === 'OVERCLOCK' && this.sim.overclockCooldown > 0) {
      this.showToast(`POWER BUS COOLING (${this.sim.overclockCooldown.toFixed(1)}S)`);
      return;
    }
    if (abilityId === 'PURGE' && !this.sim.purgeAvailableThisWave) {
      this.showToast('AIRLOCK VENT PURGE EXPENDED THIS WAVE (1X/WAVE)');
      return;
    }
    this.activeTool = { kind: 'ABILITY', abilityId };
    this.showToast(
      abilityId === 'FLARE'
        ? 'CLICK ANY DARK CORRIDOR TO DEPLOY M40 STROBE FLARE'
        : abilityId === 'OVERCLOCK'
          ? this.selectedTurretId
            ? 'CLICK SECTOR TO OVERCLOCK (OR PRESS [O] AGAIN ON SELECTED TURRET)'
            : 'CLICK SECTOR TO OVERCLOCK TURRETS (2X ROF FOR 8S)'
          : 'CLICK DESIGNATED AIRLOCK CHAMBER [W-01 / E-02 / S-03] TO PURGE'
    );
  }

  private handleHudButton(id: string): void {
    // 1. Unified System Menu Modal dispatch
    if (this.osdMenuOpen) {
      const handled = handleSystemMenuAction(id, this.host, this.getSystemMenuCallbacks());
      if (handled) return;
    }

    // 2. Shared TopChromeBar / ControlsOverlay / PostRunFlow IDs
    switch (id) {
      case TOP_CHROME_IDS.CRT: {
        if (this.host.isCrtModeLocked()) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('1979 MODE LOCKED FOR ACTIVE 1.5X RANKED RUN', 1.8);
          return;
        }
        const next = this.host.toggle1979Crt();
        this.showToast(
          next === 'CLASSIC_1979'
            ? '1979 CRT: ON — 1.5X RANKED SCORE ARMED!'
            : '1979 CRT: OFF (CLEAN · 1.0X)',
          1.6
        );
        return;
      }
      case TOP_CHROME_IDS.CONTROLS:
        this.osdMenuOpen = false;
        this.manifestOpen = false;
        this.pauseBannerOpen = false;
        this.wikiOpen = false;
        this.controlsCardOpen = !this.controlsCardOpen;
        return;
      case TOP_CHROME_IDS.AUDIO: {
        const nextMuted = !this.host.isMuted();
        this.host.setMuted(nextMuted);
        this.showToast(nextMuted ? 'AUDIO: MUTED [M]' : 'AUDIO: ON [M]', 1.2);
        return;
      }
      case TOP_CHROME_IDS.MENU:
        this.manifestOpen = false;
        this.wikiOpen = false;
        this.controlsCardOpen = false;
        this.pauseBannerOpen = false;
        this.osdMenuOpen = !this.osdMenuOpen;
        return;
      case TOP_CHROME_IDS.HUB:
        this.requestExitToHub();
        return;
      case CONTROLS_CARD_IDS.CLOSE:
        this.controlsCardOpen = false;
        return;
      case CONTROLS_CARD_IDS.OPEN_WIKI:
        this.controlsCardOpen = false;
        this.osdMenuOpen = false;
        this.manifestOpen = false;
        this.pauseBannerOpen = false;
        this.wikiOpen = true;
        return;
      case 'controls-open-quick':
        this.osdMenuOpen = false;
        this.manifestOpen = false;
        this.pauseBannerOpen = false;
        this.wikiOpen = false;
        this.controlsCardOpen = true;
        return;
      case PAUSE_BANNER_IDS.RESUME:
        this.pauseBannerOpen = false;
        return;
      case PAUSE_BANNER_IDS.CONTROLS:
        this.pauseBannerOpen = false;
        this.controlsCardOpen = true;
        return;
      case PAUSE_BANNER_IDS.MENU:
        this.pauseBannerOpen = false;
        this.osdMenuOpen = true;
        return;
      case POST_RUN_IDS.CALLSIGN_BOX:
        if (!this.scoreSubmitted && !this.submittingScore) {
          this.callsignEditing = true;
          this.focusMobileCallsignInput();
        }
        return;
      case POST_RUN_IDS.SUBMIT_SCORE:
        if (this.postRunKeylockSec <= 0) {
          this.callsignEditing = false;
          void this.submitCurrentRunScore();
        }
        return;
      case POST_RUN_IDS.OPEN_MANIFEST:
        this.manifestOpen = true;
        return;
      case POST_RUN_IDS.PLAY_AGAIN:
      case POST_RUN_IDS.MANIFEST_PLAY_AGAIN:
        if (this.postRunKeylockSec <= 0 || this.manifestOpen) {
          this.startFreshReplay();
        }
        return;
      case POST_RUN_IDS.EXIT_HUB:
        if (this.postRunKeylockSec <= 0) {
          this.exitToHubNow();
        }
        return;
      case POST_RUN_IDS.MANIFEST_CLOSE:
        this.manifestOpen = false;
        return;
      case 'proto-peek-toggle':
        if (this.sim.phase === 'PROTOCOL_DRAFT') {
          this.draftPeekMap = !this.draftPeekMap;
        }
        return;
      case 'perim-drill-advanced':
        this.osdMenuOpen = false;
        this.manifestOpen = false;
        this.wikiOpen = false;
        this.controlsCardOpen = false;
        this.pauseBannerOpen = false;
        this.activeTool = { kind: 'INSPECT' };
        this.selectedTurretId = null;
        this.selectedDoorId = null;
        this.tutorialDirector.startAdvancedLab(this.sim);
        this.fitCameraToBlueprint();
        this.showToast('ADVANCED SYSTEMS LAB INITIALIZED (4 MODULES — UNRANKED)');
        return;
    }

    if (id.startsWith('wiki-tab-')) {
      const idx = parseInt(id.replace('wiki-tab-', ''), 10);
      if (!Number.isNaN(idx)) {
        this.wikiChapterIdx = Math.max(0, Math.min(PERIMETER_WIKI_CHAPTERS.length - 1, idx));
        this.wikiScrollPx = 0;
      }
      return;
    }
    if (id === 'wiki-scroll-up') {
      this.wikiScrollPx = Math.max(0, this.wikiScrollPx - 240);
      return;
    }
    if (id === 'wiki-scroll-down') {
      this.wikiScrollPx = Math.min(this.hudRenderer.wikiMaxScrollPx, this.wikiScrollPx + 240);
      return;
    }
    if (id === 'proto-reroll') {
      const r = this.sim.rerollProtocolDraft();
      if (!r.ok) this.host.audio.playMutedAvionicsIndicatorBeep(false);
      this.showToast(r.msg);
      return;
    }
    if (id.startsWith('proto-')) {
      const idx = parseInt(id.replace('proto-', ''), 10);
      if (this.sim.draftMode === 'OMEGA') {
        const chosen = this.sim.omegaDraftChoices[idx];
        if (chosen) {
          const r = this.sim.selectOmegaDirective(chosen);
          if (r.ok) this.draftPeekMap = false;
          if (!r.ok) this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast(r.msg);
        }
      } else {
        const chosen = this.sim.protocolDraftChoices[idx];
        if (chosen) {
          const r = this.sim.selectProtocolDraft(chosen);
          if (r.ok) this.draftPeekMap = false;
          if (!r.ok) this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast(r.msg);
        }
      }
      return;
    }
    if (id.startsWith('build-')) {
      const bId = id.replace('build-', '') as Exclude<BuildToolId, 'NONE'>;
      this.selectBuildTool(bId);
      return;
    }
    if (id.startsWith('ability-')) {
      const abId = id.replace('ability-', '') as CommandAbilityId;
      this.armCommandAbility(abId);
      return;
    }
    if (id.startsWith('rack-rearm-')) {
      const tId = id.replace('rack-rearm-', '');
      this.selectedTurretId = tId;
      this.selectedDoorId = null;
      this.activeTool = { kind: 'INSPECT' };
      const r = this.sim.rearmTurret(tId);
      if (r.ok) this.tutorialDirector.notifyRearmTriggered();
      this.showToast(r.msg);
      return;
    }
    if (id.startsWith('rack-select-')) {
      const tId = id.replace('rack-select-', '');
      this.selectedTurretId = tId;
      this.selectedDoorId = null;
      this.activeTool = { kind: 'INSPECT' };
      return;
    }

    switch (id) {
      case 'resupply-purge':
      case 'resupply-mines': {
        if (this.tutorialDirector.active && !this.tutorialDirector.graduated) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('RESUPPLY LOCKED DURING TRAINING DRILL');
          break;
        }
        const kind = id === 'resupply-purge' ? 'PURGE' : 'CLAYMORES';
        const r = this.sim.purchaseOrdnanceResupply(kind);
        if (!r.ok) this.host.audio.playMutedAvionicsIndicatorBeep(false);
        this.showToast(r.msg);
        break;
      }
      case 'briefing-engage': {
        const ranked1979Bonus = this.host.getCrtPreset() === 'CLASSIC_1979';
        this.sim.ranked1979Bonus = ranked1979Bonus;
        this.host.setCrtModeLocked(ranked1979Bonus);
        this.sim.phase = 'TACTICAL_PREP';
        if (ranked1979Bonus) {
          this.showToast('★ 1979 CRT RANKED LOCKED — 1.5X BASELINE SCORE ACTIVE ★', 2.4);
        }
        break;
      }
      case 'wave-launch':
        if (this.sim.trainingMode) {
          if (this.tutorialDirector.getSnapshot(this.sim).showContinueBtn) {
            this.tutorialDirector.advanceStep(this.sim);
          }
        } else {
          this.sim.launchNextWave();
        }
        break;
      case 'perim-pause-toggle':
        // Tactical Pause applies ONLY during WAVE_ACTIVE (never pauses TACTICAL_PREP!)
        if (this.sim.phase === 'WAVE_ACTIVE') {
          this.sim.tacticalPaused = !this.sim.tacticalPaused;
        }
        break;
      case 'toggle-2x-speed':
        this.sim.fastForward2x = !this.sim.fastForward2x;
        this.showToast(this.sim.fastForward2x ? 'WAVE INTERCEPT: 2X SPEED' : 'NORMAL 1X SPEED');
        break;
      case 'insp-rearm':
        if (this.selectedTurretId) {
          const r = this.sim.rearmTurret(this.selectedTurretId);
          if (r.ok) this.tutorialDirector.notifyRearmTriggered();
          this.showToast(r.msg);
        }
        break;
      case 'insp-rotate':
        if (this.tutorialDirector.active && !this.tutorialDirector.graduated) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('TURRET AIM LOCKED ON KILLBOX DURING TRAINING DRILL');
          break;
        }
        if (this.selectedTurretId) {
          if (
            this.activeTool.kind === 'ROTATE_TURRET' &&
            this.activeTool.turretId === this.selectedTurretId
          ) {
            this.activeTool = { kind: 'INSPECT' };
          } else {
            this.activeTool = { kind: 'ROTATE_TURRET', turretId: this.selectedTurretId };
            this.showToast('CLICK CORRIDOR DIRECTION TO AIM TURRET CONE');
          }
        }
        break;
      case 'insp-power':
        if (this.tutorialDirector.active && !this.tutorialDirector.graduated) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('POWER TOGGLE LOCKED DURING TRAINING DRILL');
          break;
        }
        if (this.selectedTurretId) {
          const r = this.sim.toggleTurretPower(this.selectedTurretId);
          this.showToast(r.msg);
        }
        break;
      case 'rearm-all': {
        if (
          this.tutorialDirector.active &&
          !this.tutorialDirector.graduated &&
          !this.tutorialDirector.getSnapshot(this.sim).allowRearm
        ) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('DRILL LOCK: COMPLETE CURRENT OBJECTIVE FIRST');
          break;
        }
        const r = this.sim.rearmAllSentries();
        if (r.ok) this.tutorialDirector.notifyRearmTriggered();
        if (!r.ok) this.host.audio.playMutedAvionicsIndicatorBeep(false);
        this.showToast(r.msg);
        break;
      }
      case 'reactor-expand': {
        if (this.tutorialDirector.active && !this.tutorialDirector.graduated) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('REACTOR EXPANSION AUTO-MANAGED DURING DRILL');
          break;
        }
        const r = this.sim.expandReactorBus();
        if (!r.ok) this.host.audio.playMutedAvionicsIndicatorBeep(false);
        this.showToast(r.msg);
        break;
      }
      case 'seal-fabricate': {
        if (this.tutorialDirector.active && !this.tutorialDirector.graduated) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('CORE SEALS ARE SHIELDED DURING DRILL');
          break;
        }
        const r = this.sim.fabricateCoreSeal();
        if (!r.ok) this.host.audio.playMutedAvionicsIndicatorBeep(false);
        this.showToast(r.msg);
        break;
      }
      case 'aux-shed': {
        if (this.tutorialDirector.active && !this.tutorialDirector.graduated) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('SHED AUX LOCKED DURING TRAINING DRILL');
          break;
        }
        const r = this.sim.toggleAuxLoadShed();
        if (!r.ok) this.host.audio.playMutedAvionicsIndicatorBeep(false);
        this.showToast(r.msg);
        break;
      }
      case 'insp-upgrade':
        if (
          this.tutorialDirector.active &&
          !this.tutorialDirector.graduated &&
          !this.tutorialDirector.getSnapshot(this.sim).allowUpgrade
        ) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('UPGRADES UNLOCK IN CORE 04/04!');
          break;
        }
        if (this.selectedTurretId) {
          const r = this.sim.upgradeTurret(this.selectedTurretId);
          this.showToast(r.msg);
        }
        break;
      case 'insp-upgrade-a':
        if (
          this.tutorialDirector.active &&
          !this.tutorialDirector.graduated &&
          !this.tutorialDirector.getSnapshot(this.sim).allowUpgrade
        ) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('UPGRADES UNLOCK IN CORE 04/04!');
          break;
        }
        if (this.selectedTurretId) {
          const r = this.sim.upgradeTurret(this.selectedTurretId, 'A');
          if (!r.ok) this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast(r.msg);
        }
        break;
      case 'insp-upgrade-b':
        if (
          this.tutorialDirector.active &&
          !this.tutorialDirector.graduated &&
          !this.tutorialDirector.getSnapshot(this.sim).allowUpgrade
        ) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('UPGRADES UNLOCK IN CORE 04/04!');
          break;
        }
        if (this.selectedTurretId) {
          const r = this.sim.upgradeTurret(this.selectedTurretId, 'B');
          if (!r.ok) this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast(r.msg);
        }
        break;
      case 'insp-refit-mk4':
        if (this.tutorialDirector.active && !this.tutorialDirector.graduated) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('MK-IV REFITS LOCKED DURING TRAINING DRILL');
          break;
        }
        if (this.selectedTurretId) {
          const r = this.sim.refitTurretMk4(this.selectedTurretId);
          if (!r.ok) this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast(r.msg);
        }
        break;
      case 'insp-scrap':
        if (this.tutorialDirector.active && !this.tutorialDirector.graduated) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('SCRAPPING DISABLED DURING TRAINING DRILL');
          break;
        }
        if (this.selectedTurretId) {
          const r = this.sim.scrapTurret(this.selectedTurretId);
          this.selectedTurretId = null;
          this.showToast(r.msg);
        }
        break;
      case 'door-weld':
      case 'door-unseal':
        if (this.tutorialDirector.active && !this.tutorialDirector.graduated) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('USE [7] DOOR SEAL ON D-04 IN CORE 04/04!');
          break;
        }
        if (this.selectedDoorId) {
          const r = this.sim.toggleDoorSeal(this.selectedDoorId);
          this.showToast(r.msg);
        }
        break;
      case 'door-repair':
        if (this.tutorialDirector.active && !this.tutorialDirector.graduated) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('DOOR REPAIRS LOCKED DURING TRAINING DRILL');
          break;
        }
        if (this.selectedDoorId) {
          const r = this.sim.repairDoorSeal(this.selectedDoorId);
          this.showToast(r.msg);
        }
        break;
      case 'end-to-callsign':
        this.resetSubmissionState();
        this.sim.phase = 'CALLSIGN_ENTRY';
        break;
      case 'perim-callsign-focus':
        this.callsignEditing = true;
        this.focusMobileCallsignInput();
        break;
      case 'perim-save-callsign':
        void this.submitCurrentRunScore();
        break;
      case 'perim-skip-callsign':
        this.startFreshReplay();
        break;
      case 'perim-wiki-open':
        this.osdMenuOpen = false;
        this.manifestOpen = false;
        this.controlsCardOpen = false;
        this.pauseBannerOpen = false;
        this.wikiOpen = true;
        break;
      case 'perim-wiki-close':
        this.wikiOpen = false;
        break;
      case 'perim-drill-open-wiki': {
        const snap = this.tutorialDirector.getSnapshot(this.sim);
        this.wikiChapterIdx = snap.wikiChapterIdx;
        this.wikiScrollPx = 0;
        this.osdMenuOpen = false;
        this.manifestOpen = false;
        this.controlsCardOpen = false;
        this.pauseBannerOpen = false;
        this.wikiOpen = true;
        break;
      }
      case 'perim-drill-start':
        this.osdMenuOpen = false;
        this.manifestOpen = false;
        this.wikiOpen = false;
        this.controlsCardOpen = false;
        this.pauseBannerOpen = false;
        this.draftPeekMap = false;
        this.activeTool = { kind: 'INSPECT' };
        this.selectedTurretId = null;
        this.selectedDoorId = null;
        this.resetSubmissionState(true);
        this.tutorialDirector.start(this.sim);
        this.prevPhase = this.sim.phase;
        this.fitCameraToBlueprint();
        this.showToast('USCM 4-STAGE CORE CERTIFICATION DRILL INITIALIZED (UNRANKED)');
        break;
      case 'perim-drill-next':
      case 'perim-drill-skip':
        this.activeTool = { kind: 'INSPECT' };
        this.dragBuildAnchor = null;
        this.tutorialDirector.advanceStep(this.sim);
        break;
      case 'perim-drill-exit':
        this.startFreshReplay();
        this.showToast('RANKED ENDLESS HIVE SIEGE ARMED — DEPLOY DEFENSES!');
        break;
      case 'perim-drill-to-menu':
        this.osdMenuOpen = false;
        this.manifestOpen = false;
        this.wikiOpen = false;
        this.controlsCardOpen = false;
        this.pauseBannerOpen = false;
        this.draftPeekMap = false;
        this.activeTool = { kind: 'INSPECT' };
        this.selectedTurretId = null;
        this.selectedDoorId = null;
        this.tutorialDirector.stop(this.sim);
        this.sim.resetRun('ENDLESS_SIEGE', true);
        this.resetSubmissionState(true);
        this.prevPhase = this.sim.phase;
        this.fitCameraToBlueprint();
        this.showToast("RETURNED TO HADLEY'S PERIMETER MAIN MENU");
        break;
      case 'perim-manifest':
        this.osdMenuOpen = false;
        this.wikiOpen = false;
        this.controlsCardOpen = false;
        this.pauseBannerOpen = false;
        this.manifestOpen = !this.manifestOpen;
        break;
      case 'perim-new-run':
        this.startFreshReplay();
        break;
      case 'perim-osd':
        this.manifestOpen = false;
        this.wikiOpen = false;
        this.controlsCardOpen = false;
        this.pauseBannerOpen = false;
        this.osdMenuOpen = !this.osdMenuOpen;
        break;
      case 'perim-close-modal':
        this.osdMenuOpen = false;
        this.manifestOpen = false;
        this.wikiOpen = false;
        this.controlsCardOpen = false;
        this.pauseBannerOpen = false;
        break;
      case 'perim-mute': {
        const nextMuted = !this.host.isMuted();
        this.host.setMuted(nextMuted);
        this.showToast(nextMuted ? 'AUDIO: MUTED [M]' : 'AUDIO: ON [M]', 1.2);
        break;
      }
      case 'perim-fullscreen':
        this.host.toggleFullscreen();
        break;
      case 'perim-restart-endless':
        this.startFreshReplay();
        break;
      case 'perim-exit-os':
        this.requestExitToHub();
        break;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Dev-only playtest hotkeys [F2..F9] (100% dead-code eliminated in production builds)
    if (import.meta.env.DEV && !e.repeat) {
      if (e.code === 'F2') {
        e.preventDefault();
        this.debugTainted = true;
        const nextOn = !(this.devAutoCommander?.isEnabled() ?? false);
        this.devAutoCommander?.setEnabled(nextOn, {
          autoLaunch: true,
          autoPickProtocol: false,
        });
        this.showToast(nextOn ? '[DEV] AUTO-COMMANDER: ON' : '[DEV] AUTO-COMMANDER: OFF');
        return;
      }
      if (e.code === 'F3') {
        e.preventDefault();
        this.debugTainted = true;
        this.sim.scrap += 1000;
        this.showToast(`[DEV] +1000 SCRAP (NOW ${this.sim.scrap})`);
        return;
      }
      if (e.code === 'F4') {
        e.preventDefault();
        this.debugTainted = true;
        const milestones = [3, 4, 5, 6, 7, 8, 10, 12, 15];
        const target = milestones[this.devJumpIndex % milestones.length];
        this.devJumpIndex++;
        this.devAutoCommander?.jumpToWave(this.sim, target, e.shiftKey);
        this.showToast(`[DEV] JUMPED TO WAVE ${String(target).padStart(2, '0')}`);
        return;
      }
      if (e.code === 'F6') {
        e.preventDefault();
        this.debugTainted = true;
        this.devAutoCommander?.openProtocolDraft(this.sim);
        return;
      }
      if (e.code === 'F7') {
        e.preventDefault();
        this.debugTainted = true;
        this.devAutoCommander?.clearHostiles(this.sim, true);
        this.showToast('[DEV] CLEARED WAVE HOSTILES');
        return;
      }
      if (e.code === 'F8') {
        e.preventDefault();
        this.devOverlayVisible = !this.devOverlayVisible;
        return;
      }
      if (e.code === 'F9') {
        e.preventDefault();
        this.debugTainted = true;
        const curOpts = this.devAutoCommander?.getOptions();
        const nextGod = !(curOpts?.godSeals ?? false);
        this.devAutoCommander?.setEnabled(this.devAutoCommander?.isEnabled() ?? false, {
          godSeals: nextGod,
        });
        this.showToast(nextGod ? '[DEV] GOD SEALS: ON' : '[DEV] GOD SEALS: OFF');
        return;
      }
    }

    const isHelpKey = e.code === 'KeyH' || e.key === '?' || (e.shiftKey && e.code === 'Slash');

    // 1. Universal [M] Mute toggle (outside active Callsign typing!)
    if (e.code === 'KeyM' && !e.repeat && !this.callsignEditing) {
      const nextMuted = !this.host.isMuted();
      this.host.setMuted(nextMuted);
      if (!nextMuted) this.host.audio.playButtonLatchLock(1.0, 0.85);
      this.showToast(nextMuted ? 'AUDIO: MUTED [M]' : 'AUDIO: ON [M]', 1.2);
      return;
    }

    // 2. Full Field Manual Wiki Modal
    if (this.wikiOpen) {
      if ((e.code === 'Escape' || isHelpKey) && !e.repeat) {
        this.host.audio.playButtonLatchLock(0.92, 0.9);
        this.wikiOpen = false;
      } else if (e.code === 'ArrowDown') {
        this.wikiScrollPx = Math.min(this.hudRenderer.wikiMaxScrollPx, this.wikiScrollPx + 84);
      } else if (e.code === 'ArrowUp') {
        this.wikiScrollPx = Math.max(0, this.wikiScrollPx - 84);
      } else if (e.code === 'PageDown') {
        this.wikiScrollPx = Math.min(this.hudRenderer.wikiMaxScrollPx, this.wikiScrollPx + 340);
      } else if (e.code === 'PageUp') {
        this.wikiScrollPx = Math.max(0, this.wikiScrollPx - 340);
      } else if (e.code === 'Home') {
        this.wikiScrollPx = 0;
      } else if (e.code === 'End') {
        this.wikiScrollPx = this.hudRenderer.wikiMaxScrollPx;
      } else if (e.code === 'KeyT' && !e.repeat && !this.tutorialDirector.active) {
        this.host.audio.playButtonLatchLock();
        this.handleHudButton('perim-drill-start');
      } else if (!e.repeat && e.code.startsWith('Digit')) {
        const num = parseInt(e.code.replace('Digit', ''), 10);
        if (num >= 1 && num <= PERIMETER_WIKI_CHAPTERS.length) {
          this.wikiChapterIdx = num - 1;
          this.wikiScrollPx = 0;
          this.host.audio.playSfx('ui_keyclick', { pitch: 1.05 });
        }
      }
      return;
    }

    // 3. Shared [H] / [?] 1-Glance Controls Quick-Card (with [W] -> Full Field Manual!)
    if (this.controlsCardOpen) {
      if ((e.code === 'Escape' || isHelpKey) && !e.repeat) {
        this.host.audio.playButtonLatchLock(0.92, 0.9);
        this.controlsCardOpen = false;
      } else if (e.code === 'KeyW' && !e.repeat) {
        this.host.audio.playButtonLatchLock(1.02, 0.9);
        this.controlsCardOpen = false;
        this.wikiOpen = true;
      }
      return;
    }

    // 4. Shared [ESC] System & Pause Menu ([1-4] Quick Switch, [ESC] Resume, [M] Mute)
    if (this.osdMenuOpen) {
      if (isHelpKey && !e.repeat) {
        this.host.audio.playButtonLatchLock();
        this.osdMenuOpen = false;
        this.controlsCardOpen = true;
        return;
      }
      handleSystemMenuKey(e, this.host, this.getSystemMenuCallbacks());
      return;
    }

    // 5. Shared Global Manifest Leaderboard ([R / ENTER] Play Again post-run, [ESC] Close)
    if (this.manifestOpen) {
      if (e.code === 'Escape' && !e.repeat) {
        this.host.audio.playButtonLatchLock(0.92, 0.9);
        this.manifestOpen = false;
      } else if (
        (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'NumpadEnter') &&
        !e.repeat &&
        (this.sim.phase === 'CORE_BREACHED' ||
          this.sim.phase === 'CALLSIGN_ENTRY' ||
          Boolean(this.lastSubmittedRun))
      ) {
        this.host.audio.playButtonLatchLock(1.04, 0.9);
        this.startFreshReplay();
      }
      return;
    }

    // 6. Shared [P] Amber CRT Pause Banner
    if (this.pauseBannerOpen) {
      if (e.code === 'KeyP' && !e.repeat) {
        this.host.audio.playButtonLatchLock(1.04, 0.85);
        this.pauseBannerOpen = false;
      } else if (isHelpKey && !e.repeat) {
        this.host.audio.playButtonLatchLock(1.02, 0.9);
        this.pauseBannerOpen = false;
        this.controlsCardOpen = true;
      } else if (e.code === 'Escape' && !e.repeat) {
        this.host.audio.playButtonLatchLock(0.92, 0.9);
        this.pauseBannerOpen = false;
        this.osdMenuOpen = true;
      }
      return;
    }

    // 7. Training Drill Graduation Modal (Core offers [A] Advanced Systems Lab!)
    if (this.tutorialDirector.graduated) {
      const snap = this.tutorialDirector.getSnapshot(this.sim);
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
        this.host.audio.playButtonLatchLock();
        this.handleHudButton('perim-drill-exit');
      } else if (e.code === 'KeyA' && !e.repeat && snap.canStartAdvancedLab) {
        this.host.audio.playButtonLatchLock();
        this.handleHudButton('perim-drill-advanced');
      } else if (isHelpKey && !e.repeat) {
        this.host.audio.playButtonLatchLock();
        this.handleHudButton('perim-wiki-open');
      } else if (e.code === 'Escape' && !e.repeat) {
        this.host.audio.playButtonLatchLock(0.92, 0.9);
        this.osdMenuOpen = true;
      }
      return;
    }

    // 8. 70% Briefing Modal ([ESC] opens System Menu — never exits to Hub!)
    if (this.sim.phase === 'BRIEFING') {
      if ((e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') && !e.repeat) {
        this.host.audio.playButtonLatchLock();
        this.sim.phase = 'TACTICAL_PREP';
      } else if (e.code === 'KeyT' && !e.repeat) {
        this.host.audio.playButtonLatchLock();
        this.handleHudButton('perim-drill-start');
      } else if (isHelpKey && !e.repeat) {
        this.host.audio.playButtonLatchLock();
        this.controlsCardOpen = true;
      } else if (e.code === 'Escape' && !e.repeat) {
        this.host.audio.playButtonLatchLock(0.92, 0.9);
        this.osdMenuOpen = true;
      }
      return;
    }

    // 9. Protocol / Omega Draft Modal ([H] Controls ALLOWED + [SPACE] PEEK MAP toggle!)
    if (this.sim.phase === 'PROTOCOL_DRAFT') {
      if (e.code === 'Space' && !e.repeat) {
        this.host.audio.playSfx('ui_keyclick', { pitch: this.draftPeekMap ? 1.05 : 0.92 });
        this.draftPeekMap = !this.draftPeekMap;
      } else if (isHelpKey && !e.repeat) {
        this.host.audio.playButtonLatchLock(1.02, 0.9);
        this.controlsCardOpen = true;
      } else if (e.code === 'Escape' && !e.repeat) {
        if (this.draftPeekMap) {
          this.draftPeekMap = false;
        } else {
          this.host.audio.playButtonLatchLock(0.92, 0.9);
          this.osdMenuOpen = true;
        }
      } else if (!this.draftPeekMap) {
        if (e.code === 'Digit1' && !e.repeat) {
          this.handleHudButton('proto-0');
        } else if (e.code === 'Digit2' && !e.repeat) {
          this.handleHudButton('proto-1');
        } else if (e.code === 'Digit3' && !e.repeat) {
          this.handleHudButton('proto-2');
        } else if (e.code === 'KeyR' && !e.repeat) {
          this.handleHudButton('proto-reroll');
        }
      }
      return;
    }

    // 10. Unified 1-Screen GameOverDebriefModal (0.4s keylock, opt-in [C] callsign edit, [ENTER] submit, [R] instant replay!)
    if (this.sim.phase === 'CORE_BREACHED' || this.sim.phase === 'CALLSIGN_ENTRY') {
      if (this.callsignEditing && !this.scoreSubmitted) {
        if (e.code === 'Escape') {
          this.callsignEditing = false;
          this.host.audio.playSfx('ui_keyclick', { pitch: 0.9 });
        } else if (e.code === 'Backspace') {
          this.callsignDraft = this.callsignDraft.slice(0, -1);
          this.host.audio.playSfx('ui_keyclick', { pitch: 0.9 });
        } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          this.callsignEditing = false;
          if (this.postRunKeylockSec <= 0) {
            this.host.audio.playSfx('keypress_return', { volume: 0.9 });
            void this.submitCurrentRunScore();
          }
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (CALLSIGN_CHAR_REGEX.test(e.key) && this.callsignDraft.length < CALLSIGN_MAX_LEN) {
            this.callsignDraft += e.key.toUpperCase();
            this.submitResultBanner = null;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.05 });
          }
        }
        return;
      }

      if (e.code === 'Escape' && !e.repeat) {
        this.host.audio.playButtonLatchLock(0.92, 0.9);
        this.osdMenuOpen = true;
        return;
      }

      if (this.postRunKeylockSec > 0) return;

      if (e.code === 'KeyC' && !e.repeat && !this.scoreSubmitted && !this.sim.trainingMode) {
        this.callsignEditing = true;
        this.focusMobileCallsignInput();
        this.host.audio.playSfx('ui_keyclick', { pitch: 1.08 });
      } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
        if (!this.sim.trainingMode && !this.scoreSubmitted) {
          this.host.audio.playSfx('keypress_return', { volume: 0.9 });
          void this.submitCurrentRunScore();
        } else if (this.scoreSubmitted) {
          this.host.audio.playButtonLatchLock();
          this.manifestOpen = true;
        } else {
          this.host.audio.playButtonLatchLock();
          this.startFreshReplay();
        }
      } else if (e.code === 'KeyR' && !e.repeat) {
        this.host.audio.playButtonLatchLock(1.04, 0.9);
        this.startFreshReplay();
      }
      return;
    }

    // 11. Active Tactical Gameplay / Prep Controls
    // [ESC]: cancels active build/ability/rotate tool first; otherwise opens unified SystemMenuModal!
    if (e.code === 'Escape' && !e.repeat) {
      if (this.activeTool.kind !== 'INSPECT') {
        this.activeTool = { kind: 'INSPECT' };
        this.statusToast = null;
        this.statusToastTimer = 0;
        this.host.audio.playSfx('ui_keyclick', { pitch: 0.85 });
      } else if (performance.now() - this.lastToolAutoExitMs < 450) {
        this.host.audio.playSfx('ui_keyclick', { pitch: 0.8 });
      } else {
        this.host.audio.playButtonLatchLock(0.92, 0.9);
        this.osdMenuOpen = true;
      }
      return;
    }

    // [P]: Universal Amber CRT Pause Banner
    if (e.code === 'KeyP' && !e.repeat) {
      this.host.audio.playButtonLatchLock(0.88, 0.85);
      this.pauseBannerOpen = true;
      return;
    }

    // [SPACE]: Interactive Tactical Pause during WAVE_ACTIVE ONLY (stop pausing TACTICAL_PREP!)
    if (e.code === 'Space' && !e.repeat) {
      if (this.sim.phase === 'WAVE_ACTIVE') {
        this.sim.tacticalPaused = !this.sim.tacticalPaused;
        this.host.audio.playButtonLatchLock(this.sim.tacticalPaused ? 0.88 : 1.04, 0.85);
      }
      return;
    }

    // [H] / [?]: Universal 1-Glance Controls Quick-Card (with [W] -> Full Field Manual)
    if (isHelpKey && !e.repeat) {
      this.host.audio.playButtonLatchLock(1.02, 0.9);
      this.controlsCardOpen = true;
      return;
    }

    // [Z]: Toggle 2X Speed
    if (e.code === 'KeyZ' && !e.repeat) {
      this.host.audio.playButtonLatchLock(1.02, 0.85);
      this.handleHudButton('toggle-2x-speed');
      return;
    }

    // [T]: Launch 4-Stage Training Drill (only during Wave 1 Prep before placing turrets!)
    if (
      e.code === 'KeyT' &&
      !e.repeat &&
      !this.tutorialDirector.active &&
      this.sim.phase === 'TACTICAL_PREP' &&
      this.sim.waveNumber === 1 &&
      this.sim.turrets.length === 0
    ) {
      this.host.audio.playButtonLatchLock();
      this.handleHudButton('perim-drill-start');
      return;
    }

    // [ENTER]: Launch Wave in Tactical Prep
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat && this.sim.phase === 'TACTICAL_PREP') {
      this.host.audio.playButtonLatchLock();
      if (this.sim.trainingMode) {
        if (this.tutorialDirector.getSnapshot(this.sim).showContinueBtn) {
          this.tutorialDirector.advanceStep(this.sim);
        }
      } else {
        this.sim.launchNextWave();
      }
      return;
    }

    // Command Ability & Engineering Hotkeys: [F], [O], [V], [L], [C], [X] (Shift+1/2/3 hijack REMOVED!)
    if (e.code === 'KeyF' && !e.repeat) {
      this.host.audio.playSfx('ui_keyclick');
      this.armCommandAbility('FLARE');
      return;
    }
    if (e.code === 'KeyO' && !e.repeat) {
      this.host.audio.playSfx('ui_keyclick');
      this.armCommandAbility('OVERCLOCK');
      return;
    }
    if (e.code === 'KeyV' && !e.repeat) {
      this.host.audio.playSfx('ui_keyclick');
      this.armCommandAbility('PURGE');
      return;
    }
    if (e.code === 'KeyL' && !e.repeat) {
      this.host.audio.playSfx('ui_keyclick');
      this.armCommandAbility('FLOODLIGHT');
      return;
    }
    if (e.code === 'KeyC' && !e.repeat) {
      this.host.audio.playSfx('ui_keyclick');
      this.armCommandAbility('COOLANT_FLUSH');
      return;
    }
    if (e.code === 'KeyX' && !e.repeat) {
      this.host.audio.playButtonLatchLock();
      this.handleHudButton('aux-shed');
      return;
    }

    // Hardware Build Hotkeys [1-8] (Shift+[1-8] multi-deploy now works cleanly!)
    if (e.code === 'Digit1') {
      this.host.audio.playSfx('ui_keyclick');
      this.selectBuildTool('SENTRY_PULSE');
    } else if (e.code === 'Digit2') {
      this.host.audio.playSfx('ui_keyclick');
      this.selectBuildTool('INCINERATOR');
    } else if (e.code === 'Digit3') {
      this.host.audio.playSfx('ui_keyclick');
      this.selectBuildTool('RAIL_LANCE');
    } else if (e.code === 'Digit4') {
      this.host.audio.playSfx('ui_keyclick');
      this.selectBuildTool('CRYO_VALVE');
    } else if (e.code === 'Digit5') {
      this.host.audio.playSfx('ui_keyclick');
      this.selectBuildTool('SHOCK_COIL');
    } else if (e.code === 'Digit6') {
      this.host.audio.playSfx('ui_keyclick');
      this.selectBuildTool('MOTION_RELAY');
    } else if (e.code === 'Digit7') {
      this.host.audio.playSfx('ui_keyclick');
      this.selectBuildTool('ARC_WELDER');
    } else if (e.code === 'Digit8') {
      this.host.audio.playSfx('ui_keyclick');
      this.selectBuildTool('CLAYMORE');
    } else if (e.code === 'KeyR' && !e.repeat) {
      const isDirectionalBuild =
        this.activeTool.kind === 'BUILD' &&
        this.activeTool.buildId !== 'ARC_WELDER' &&
        this.activeTool.buildId !== 'CRYO_VALVE' &&
        this.activeTool.buildId !== 'SHOCK_COIL' &&
        this.activeTool.buildId !== 'CLAYMORE';
      if (isDirectionalBuild && this.activeTool.kind === 'BUILD') {
        this.activeTool.previewAngle += Math.PI / 4;
        this.previewAngleLockedByUser = true;
        if (this.dragBuildAnchor) {
          this.dragBuildAnchor.angle += Math.PI / 4;
        }
        this.host.audio.playTurretServoStep(0);
      } else if (this.selectedTurretId) {
        if (this.tutorialDirector.active && !this.tutorialDirector.graduated) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast('TURRET AIM LOCKED ON KILLBOX DURING TRAINING DRILL');
          return;
        }
        const t = this.sim.turrets.find((u) => u.id === this.selectedTurretId);
        if (t && t.kind !== 'CRYO_VALVE' && t.kind !== 'SHOCK_COIL') {
          // 1-press clean +45° rotation!
          const nextAng = t.targetAngle + Math.PI / 4;
          this.sim.setTurretTargetAngle(t.id, nextAng);
          const deg = Math.round((((nextAng * 180) / Math.PI) + 360) % 360);
          this.showToast(`${t.callsign} ROTATED +45° (${deg}°)`, 1.5);
          if (this.activeTool.kind === 'ROTATE_TURRET') {
            this.activeTool = { kind: 'INSPECT' };
          }
        }
      }
    } else if (e.code === 'KeyE' && !e.repeat) {
      // [E] falls back to rearm-all when no turret or a non-Sentry is selected!
      const sel = this.selectedTurretId
        ? this.sim.turrets.find((u) => u.id === this.selectedTurretId)
        : undefined;
      if (e.shiftKey || !sel || sel.kind !== 'SENTRY_PULSE') {
        this.handleHudButton('rearm-all');
      } else {
        this.handleHudButton('insp-rearm');
      }
    } else if (e.code === 'KeyK' && !e.repeat && this.selectedTurretId) {
      // Turret Power moved from [P] -> [K] (freeing [P] for universal Pause!)
      this.host.audio.playButtonLatchLock();
      this.handleHudButton('insp-power');
    } else if (e.code === 'KeyU' && !e.repeat && this.selectedTurretId) {
      this.host.audio.playButtonLatchLock();
      const sel = this.sim.turrets.find((u) => u.id === this.selectedTurretId);
      if (sel && sel.level === 3) {
        this.handleHudButton('insp-refit-mk4');
      } else {
        this.handleHudButton('insp-upgrade');
      }
    } else if (e.code === 'KeyA' && !e.repeat && this.selectedTurretId) {
      const sel = this.sim.turrets.find((u) => u.id === this.selectedTurretId);
      if (sel && sel.level === 2) {
        this.host.audio.playButtonLatchLock();
        this.handleHudButton('insp-upgrade-a');
      }
    } else if (e.code === 'KeyB' && !e.repeat && this.selectedTurretId) {
      const sel = this.sim.turrets.find((u) => u.id === this.selectedTurretId);
      if (sel && sel.level === 2) {
        this.host.audio.playButtonLatchLock();
        this.handleHudButton('insp-upgrade-b');
      }
    } else if (e.code === 'Delete' && !e.repeat && this.selectedTurretId) {
      // [DEL] ONLY for turret scrap (Backspace removed to prevent accidental scrap!)
      this.host.audio.playButtonLatchLock();
      this.handleHudButton('insp-scrap');
    }
  }

  public updateAndRender(
    dt: number,
    ctx: CanvasRenderingContext2D,
    totalTimeSec: number
  ): CrtShaderFrameParams {
    const clampedDt = Math.min(0.1, Math.max(0, dt));

    if (this.statusToastTimer > 0) {
      this.statusToastTimer = Math.max(0, this.statusToastTimer - clampedDt);
      if (this.statusToastTimer <= 0) {
        this.statusToast = null;
      }
    }
    if (this.confirmExitTimer > 0) {
      this.confirmExitTimer = Math.max(0, this.confirmExitTimer - clampedDt);
      if (this.confirmExitTimer <= 0) {
        this.confirmExitPending = false;
      }
    }
    if (this.postRunKeylockSec > 0) {
      this.postRunKeylockSec = Math.max(0, this.postRunKeylockSec - clampedDt);
    }
    if (this.glitchIntensity > 0) {
      this.glitchIntensity = Math.max(0, this.glitchIntensity - clampedDt * 1.6);
    }

    const overlayFreezingSim =
      this.osdMenuOpen ||
      this.manifestOpen ||
      this.wikiOpen ||
      this.controlsCardOpen ||
      this.pauseBannerOpen;

    // Smooth WASD / Arrow Camera Panning when zoomed in
    if (
      !overlayFreezingSim &&
      !this.callsignEditing &&
      this.sim.phase !== 'CORE_BREACHED' &&
      this.sim.phase !== 'CALLSIGN_ENTRY' &&
      this.camera.zoom > 1.0
    ) {
      let panX = 0;
      let panY = 0;
      if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) panX -= 1;
      if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) panX += 1;
      if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) panY -= 1;
      if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) panY += 1;
      if (panX !== 0 || panY !== 0) {
        const spd = 620 / this.camera.zoom;
        this.camera.centerX += panX * spd * clampedDt;
        this.camera.centerY += panY * spd * clampedDt;
        this.clampCamera();
      }
    }

    // Step Tactical Simulation (freezes automatically if any System/Controls/Pause/Manifest/Wiki modal is open)
    if (!overlayFreezingSim) {
      if (
        !this.sim.trainingMode &&
        (this.sim.phase === 'TACTICAL_PREP' || this.sim.phase === 'WAVE_ACTIVE')
      ) {
        this.runPlaytimeSec += clampedDt;
      }
      if (import.meta.env.DEV) {
        this.devAutoCommander?.step(this.sim, clampedDt);
      }
      this.sim.step(clampedDt);

      // Phase-transition hooks (0.4s Post-Run Keylock, auto-clear Tactical Pause in Prep, clear Draft Peek)
      if (this.sim.phase !== this.prevPhase) {
        if (this.sim.phase === 'CORE_BREACHED') {
          this.postRunKeylockSec = 0.4;
          this.callsignEditing = false;
          this.draftPeekMap = false;
          this.pauseBannerOpen = false;
          this.resetSubmissionState(false);
        }
        if (this.prevPhase === 'PROTOCOL_DRAFT') {
          this.draftPeekMap = false;
        }
        if (this.sim.phase === 'TACTICAL_PREP') {
          this.sim.tacticalPaused = false;
        }
        this.prevPhase = this.sim.phase;
      }

      if (
        this.sim.blueprint.sectorId !== this.lastSectorId ||
        this.sim.sectorTransitionVersion !== this.lastSectorTransitionVersion
      ) {
        this.syncCameraForSectorChange(this.sim.blueprint.sectorId);
      }
      if (this.tutorialDirector.active && !this.sim.tacticalPaused) {
        const prevStep = this.tutorialDirector.getSnapshot(this.sim).stepIndex;
        this.tutorialDirector.step(this.sim, clampedDt);
        const nextSnap = this.tutorialDirector.getSnapshot(this.sim);
        if (nextSnap.stepIndex !== prevStep || nextSnap.graduated) {
          this.activeTool = { kind: 'INSPECT' };
          this.dragBuildAnchor = null;
        }
      }
      const napalmState = this.sim.getActiveNapalmAudioState();
      this.host.audio.updatePerimeterNapalmBed(napalmState.intensity, napalmState.pan, clampedDt);
      const rx = this.sim.getReactorAudioTelemetry();
      this.host.audio.updatePerimeterReactorBed(
        rx.active,
        this.sim.tacticalPaused ? rx.loadRatio * 0.35 : rx.loadRatio,
        this.sim.tacticalPaused ? 0 : rx.overloadFrac,
        rx.blackoutActive,
        clampedDt
      );
    } else {
      this.host.audio.updatePerimeterNapalmBed(0, 0, clampedDt);
      this.host.audio.updatePerimeterReactorBed(false, 0, 0, false, clampedDt);
    }

    const layout = this.getCurrentLayout();
    const tutorialDirective = this.tutorialDirector.getSnapshot(this.sim);

    const anyModalOpen =
      this.wikiOpen ||
      this.controlsCardOpen ||
      this.osdMenuOpen ||
      this.manifestOpen ||
      this.pauseBannerOpen ||
      tutorialDirective.graduated ||
      this.sim.phase === 'BRIEFING' ||
      (this.sim.phase === 'PROTOCOL_DRAFT' && !this.draftPeekMap) ||
      this.sim.phase === 'CORE_BREACHED' ||
      this.sim.phase === 'CALLSIGN_ENTRY';
    this.host.setModalOpen(anyModalOpen);

    // Clear full offscreen frame
    ctx.fillStyle = '#030805';
    ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    // 1. Render Central Colony CAD Blueprint (with Calm-Mode hover reveal!)
    this.blueprintRenderer.render(ctx, {
      sim: this.sim,
      viewport: layout.blueprintViewport,
      camera: this.camera,
      timeSec: totalTimeSec,
      activeTool: this.activeTool,
      cursorVirtual: this.cursorVirtual,
      selectedTurretId: this.selectedTurretId,
      hoveredTurretId: this.hoveredTurretId,
      selectedDoorId: this.selectedDoorId,
      dragBuildAnchor: this.dragBuildAnchor,
      tutorialBeacons: tutorialDirective.beacons,
      tutorialPlacementRule: tutorialDirective.activePlacementRule,
      tutorialAngleCheck: this.tutorialDirector.active
        ? (buildId, col, row, angle) =>
            this.tutorialDirector.isAngleWithinActiveRule(this.sim, buildId, col, row, angle)
        : undefined,
    });

    const crtModeLocked =
      this.sim.ranked1979Bonus &&
      !this.sim.trainingMode &&
      this.sim.phase !== 'BRIEFING' &&
      this.sim.phase !== 'CORE_BREACHED' &&
      this.sim.phase !== 'CALLSIGN_ENTRY';
    this.host.setCrtModeLocked(crtModeLocked);

    // 2. Render Nostromo Left/Right/Top/Bottom Instrumentation & Shared Chrome Modals
    this.hudRenderer.render(
      ctx,
      {
        width: this.viewportWidth,
        height: this.viewportHeight,
        timeSec: totalTimeSec,
        sim: this.sim,
        manifest: this.manifest,
        activeTool: this.activeTool,
        selectedTurretId: this.selectedTurretId,
        selectedDoorId: this.selectedDoorId,
        hoveredButtonId: this.hoveredButtonId,
        audioMuted: this.host.isMuted(),
        isFullscreen: this.host.getViewport().isFullscreen,
        crtPreset: this.host.getCrtPreset(),
        crtModeLocked,
        phosphorTheme: this.host.getPhosphorTheme(),
        masterVolume: this.host.getMasterVolume(),
        confirmExitPending: this.confirmExitPending,
        osdMenuOpen: this.osdMenuOpen,
        manifestOpen: this.manifestOpen,
        wikiOpen: this.wikiOpen,
        controlsCardOpen: this.controlsCardOpen,
        pauseBannerOpen: this.pauseBannerOpen,
        draftPeekMap: this.draftPeekMap,
        wikiChapterIdx: this.wikiChapterIdx,
        wikiScrollPx: this.wikiScrollPx,
        tutorialDirective,
        callsignDraft: this.callsignDraft,
        callsignEditing: this.callsignEditing,
        postRunKeylockSec: this.postRunKeylockSec,
        scoreSubmitted: this.scoreSubmitted,
        submittingScore: this.submittingScore,
        submitResultBanner: this.submitResultBanner,
        submitResultTone: this.submitResultTone,
        lastSubmittedRun: this.lastSubmittedRun,
        statusToast: this.statusToast,
      },
      layout
    );

    if (import.meta.env.DEV && this.devOverlayVisible && this.devAutoCommander) {
      this.devAutoCommander.renderDevOverlay(
        ctx,
        this.sim,
        layout.blueprintViewport.x + 8,
        layout.blueprintViewport.y + layout.blueprintViewport.height - 142,
        this.debugTainted,
        this.host.audio.getBusActivityLevel()
      );
    }

    const overdriveAmt =
      this.sim.blackoutTimer > 0
        ? 0.08
        : this.sim.overloadTimer > 1.2
          ? 0.45
          : this.sim.activeOverclockSurgeTimer > 0
            ? 0.36
            : this.sim.sealLostFlashTimer > 0
              ? 0.6
              : 0;

    return {
      interference:
        this.sim.sealLostFlashTimer > 0
          ? 0.28
          : this.sim.blackoutTimer > 0
            ? 0.14
            : this.sim.overloadTimer > 0.6
              ? 0.065
              : 0.012,
      glitch: this.glitchIntensity,
      overdrive: overdriveAmt,
      tubeTurnOn: 0,
      modalActive: anyModalOpen,
      chromaScale: anyModalOpen ? 0.06 : 0.22,
    };
  }
}
