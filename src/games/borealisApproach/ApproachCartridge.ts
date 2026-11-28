import {
  CONTROLS_CARD_IDS,
  handleSystemMenuAction,
  handleSystemMenuKey,
  PAUSE_BANNER_IDS,
  POST_RUN_IDS,
  SYSTEM_MENU_IDS,
  TOP_CHROME_IDS,
  type SystemMenuActionCallbacks,
} from '../../render/chrome';
import {
  CALLSIGN_CHAR_REGEX,
  CALLSIGN_MAX_LEN,
  sanitizeCallsignDraft,
} from '../../services/callsignGuard';
import type {
  Cartridge,
  CrtShaderFrameParams,
  CrtShockwaveUniform,
  HostEnvironment,
} from '../../shell/Cartridge';
import type { Vec2, ViewportRect } from '../../types';
import { ApproachAudio } from './ApproachAudio';
import {
  clearSessionTainted,
  installApproachDebugHandle,
  isSessionTainted,
  uninstallApproachDebugHandle,
} from './ApproachDevDebug';
import {
  APPROACH_UI_IDS,
  ApproachHudRenderer,
  type ApproachHudLayout,
} from './ApproachHudRenderer';
import { ApproachLeaderboardService } from './ApproachLeaderboard';
import {
  ApproachScopeRenderer,
  nmToScreen,
  screenToNm,
  type ApproachDragVisualState,
  type ApproachScopeProjection,
} from './ApproachScopeRenderer';
import { ApproachSimulation } from './ApproachSimulation';
import { ApproachTutorialDirector } from './ApproachTutorial';
import type {
  ApproachLastSubmittedRun,
  HoldingFixId,
  SpeedMode,
  VectorPreviewResult,
  VectorSnapKind,
} from './types';

const DRAG_SAMPLE_DIST_NM = 0.35;

export class BorealisApproachCartridge implements Cartridge {
  public readonly id = 'approach';
  private host: HostEnvironment;
  private listenerAbort: AbortController | null = null;

  private approachAudio: ApproachAudio;
  private leaderboard: ApproachLeaderboardService;
  private sim: ApproachSimulation;
  private tutorial = new ApproachTutorialDirector();
  private scopeRenderer = new ApproachScopeRenderer();
  private hudRenderer = new ApproachHudRenderer();

  private viewportWidth = 1280;
  private viewportHeight = 800;
  private offsetX = 0;
  private offsetY = 0;
  private crtRect: ViewportRect = { x: 0, y: 0, width: 1280, height: 800 };

  // Radar scope pointer & smooth vector dragging state
  private cursorNm: Vec2 | null = null;
  private cursorInsideScope = false;
  private hoveredButtonId: string | null = null;
  private hoveredCraftId: number | null = null;
  private selectedCraftId: number | null = null;

  private draggingCraftId: number | null = null;
  private dragPointerId: number | null = null;
  private dragStartNm: Vec2 | null = null;
  private dragHasMoved = false;
  private dragWaypointsNm: Vec2[] = [];
  private dragPreview: VectorPreviewResult | null = null;
  private dragLastSnapKind: VectorSnapKind = 'NONE';
  private dragLastFullHoldFix: HoldingFixId | null = null;

  // Deduplicates right-click Smart Hold between pointerdown(button=2) and contextmenu
  private rmbPointerDownConsumed = false;

  // Live 254.30 MHz radio oscilloscope buffer
  private radioOscSamples = new Float32Array(64);

  // Unified Modals & Safety Latches
  private osdMenuOpen = false;
  private manifestOpen = false;
  private controlsOpen = false;
  private manualOpen = false;
  private manualTab = 0;
  private confirmExitPending = false;
  private confirmExitTimer = 0;
  private confirmGameMenuPending = false;
  private confirmGameMenuTimer = 0;
  private glitchIntensity = 0;

  private statusToast: {
    text: string;
    tone: 'green' | 'amber' | 'red' | 'cyan';
    timer: number;
    duration: number;
  } | null = null;

  // Post-Run Callsign & Orbital Relay Submission (`approach_scores`)
  private callsignDraft = 'RAPCON-01';
  private runPlaytimeSec = 0;
  private callsignEditing = false;
  private callsignOverwriteOnNextKey = false;
  private scoreSubmitted = false;
  private submittingScore = false;
  private submitResultBanner: string | null = null;
  private submitResultTone: 'green' | 'amber' | 'red' = 'green';
  private lastSubmittedRun: ApproachLastSubmittedRun | null = null;

  constructor(host: HostEnvironment) {
    this.host = host;
    this.approachAudio = new ApproachAudio(host.audio);
    this.leaderboard = new ApproachLeaderboardService();
    this.callsignDraft = this.leaderboard.getSavedCallsign();
    this.sim = new ApproachSimulation(this.approachAudio.createSimulationCallbacks());
  }

  public mount(): void {
    this.unmount();
    this.listenerAbort = new AbortController();
    const signal = this.listenerAbort.signal;

    const vp = this.host.getViewport();
    this.resize(vp.width, vp.height, vp.offsetX, vp.offsetY);

    this.approachAudio.mount();
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.controlsOpen = false;
    this.manualOpen = false;
    this.manualTab = 0;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.confirmGameMenuPending = false;
    this.confirmGameMenuTimer = 0;
    this.statusToast = null;
    this.hoveredButtonId = null;
    this.hoveredCraftId = null;
    this.selectedCraftId = null;
    this.cursorNm = null;
    this.cursorInsideScope = false;
    this.cancelDrag();
    this.rmbPointerDownConsumed = false;
    this.glitchIntensity = 0;

    this.runPlaytimeSec = 0;
    this.callsignEditing = false;
    this.callsignOverwriteOnNextKey = false;
    this.scoreSubmitted = false;
    this.submittingScore = false;
    this.submitResultBanner = null;
    this.submitResultTone = 'green';
    this.lastSubmittedRun = null;
    this.callsignDraft = this.leaderboard.getSavedCallsign();

    this.host.setModalOpen(false);
    this.host.setCrtModeLocked(false);
    this.tutorial.stop(this.sim);
    this.sim.resetToTitle();
    this.sim.onFirstIonStorm = () => {
      if (this.sim.phase === 'ACTIVE_SHIFT' && !this.sim.trainingMode) {
        this.showToast(
          'ION STATIC DETECTED — NON-LETHAL · COMMS JAM ONLY (PRE-LOCK PATHS OR RMB HOLD)',
          'cyan',
          4.0
        );
      }
    };
    this.syncAirspaceBounds();

    if (import.meta.env.DEV) {
      installApproachDebugHandle({
        sim: this.sim,
        audio: this.approachAudio,
        host: this.host,
        hudRenderer: this.hudRenderer,
        tutorial: this.tutorial,
        startShift: () => this.startShift(),
        startTutorial: () => this.startTrainingDrill(),
        getCurrentLayout: () => this.getCurrentLayout(),
        getViewportOffset: () => ({ x: this.offsetX, y: this.offsetY }),
        getStatusSnapshot: () => ({
          submitResultBanner: this.submitResultBanner,
          scoreSubmitted: this.scoreSubmitted,
          crtPreset: this.host.getCrtPreset(),
          crtModeLocked: this.host.isCrtModeLocked(),
          osdMenuOpen: this.osdMenuOpen,
          manifestOpen: this.manifestOpen,
          controlsOpen: this.controlsOpen,
          confirmExitPending: this.confirmExitPending,
          confirmGameMenuPending: this.confirmGameMenuPending,
          runPlaytimeSec: Number(this.runPlaytimeSec.toFixed(2)),
        }),
      });
      if (window.__APPROACH_DEBUG__) {
        const dbg = window.__APPROACH_DEBUG__ as typeof window.__APPROACH_DEBUG__ & {
          getManualState?: () => { open: boolean; tab: number; graduationLockoutSec: number };
          openManual?: (tab?: number) => void;
          closeManual?: () => void;
        };
        dbg.getManualState = () => ({
          open: this.manualOpen || this.tutorial.isGraduated(),
          tab: this.manualTab,
          graduationLockoutSec: Number(this.tutorial.getGraduationLockoutSec().toFixed(2)),
        });
        dbg.openManual = (tab?: number) => {
          if (typeof tab === 'number' && Number.isFinite(tab)) {
            this.manualTab = Math.max(0, Math.min(2, Math.floor(tab)));
          }
          this.osdMenuOpen = false;
          this.manifestOpen = false;
          this.controlsOpen = false;
          this.manualOpen = true;
        };
        dbg.closeManual = () => {
          this.manualOpen = false;
        };
      }
    }

    this.bindListeners(signal);
  }

  public unmount(): void {
    if (import.meta.env.DEV) {
      uninstallApproachDebugHandle(this.sim);
    }
    if (this.listenerAbort) {
      this.listenerAbort.abort();
      this.listenerAbort = null;
    }
    this.tutorial.stop(this.sim);
    this.sim.onFirstIonStorm = null;
    this.approachAudio.unmount();
    this.host.music.setVhfDuck(false);
    this.host.music.stopGameplayMusic(0.75);
    this.host.audio.stopCartridgeLoops();
    this.host.setModalOpen(false);
    this.host.setCrtModeLocked(false);

    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.controlsOpen = false;
    this.manualOpen = false;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.confirmGameMenuPending = false;
    this.confirmGameMenuTimer = 0;
    this.statusToast = null;
    this.hoveredButtonId = null;
    this.hoveredCraftId = null;
    this.selectedCraftId = null;
    this.cursorNm = null;
    this.cursorInsideScope = false;
    this.cancelDrag();
    document.body.style.cursor = 'default';

    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (mobileInput && document.activeElement === mobileInput) {
      mobileInput.blur();
    }
  }

  public resize(width: number, height: number, offsetX = 0, offsetY = 0): void {
    this.viewportWidth = Math.max(320, width);
    this.viewportHeight = Math.max(240, height);
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.crtRect = { x: 0, y: 0, width: this.viewportWidth, height: this.viewportHeight };
    this.syncAirspaceBounds();
  }

  public setBackgroundPaused(paused: boolean): void {
    if (paused) {
      this.cancelDrag();
      this.approachAudio.silenceAll();
      this.host.music.setVhfDuck(false);
      this.host.music.stopGameplayMusic(0.5);
    }
  }

  private getCurrentLayout(): ApproachHudLayout {
    return this.hudRenderer.computeLayout(this.viewportWidth, this.viewportHeight);
  }

  private syncAirspaceBounds(layout?: ApproachHudLayout): ApproachScopeProjection {
    const activeLayout = layout ?? this.getCurrentLayout();
    const proj = this.scopeRenderer.getProjection(activeLayout.scopeViewport);
    this.sim.setAirspaceBounds(proj.halfWidthNm, proj.halfHeightNm);
    return proj;
  }

  private isInActiveGameplay(): boolean {
    return this.sim.phase === 'ACTIVE_SHIFT';
  }

  private isAnyModalOverlayOpen(): boolean {
    return (
      this.osdMenuOpen ||
      this.manifestOpen ||
      this.controlsOpen ||
      this.manualOpen ||
      (this.sim.phase === 'ACTIVE_SHIFT' && this.sim.paused) ||
      this.sim.phase === 'GAME_OVER' ||
      this.tutorial.isGraduated()
    );
  }

  private cancelDrag(): void {
    this.draggingCraftId = null;
    this.dragPointerId = null;
    this.dragStartNm = null;
    this.dragHasMoved = false;
    this.dragWaypointsNm = [];
    this.dragPreview = null;
    this.dragLastSnapKind = 'NONE';
    this.dragLastFullHoldFix = null;
  }

  private clampToScopeNm(pt: Vec2): Vec2 {
    const maxX = Math.max(4, this.sim.airspaceHalfWidthNm - 0.35);
    const maxY = Math.max(4, this.sim.airspaceHalfHeightNm - 0.35);
    return {
      x: Math.max(-maxX, Math.min(maxX, pt.x)),
      y: Math.max(-maxY, Math.min(maxY, pt.y)),
    };
  }

  private showToast(
    text: string,
    tone: 'green' | 'amber' | 'red' | 'cyan' = 'amber',
    duration = 1.4
  ): void {
    this.statusToast = { text, tone, timer: duration, duration };
  }

  private toggleMuteWithToast(): void {
    const nextMuted = !this.host.isMuted();
    this.host.setMuted(nextMuted);
    if (!nextMuted) {
      this.host.audio.playButtonLatchLock(1.02, 0.85);
    } else {
      this.approachAudio.silenceAll();
      this.host.music.setVhfDuck(false);
    }
    this.showToast(
      nextMuted ? 'AUDIO BUS: MUTED [M]' : 'AUDIO BUS: ONLINE [M]',
      nextMuted ? 'red' : 'green',
      1.2
    );
  }

  private toggleMusicWithToast(): void {
    const enabled = this.host.toggleMusic();
    this.host.audio.playButtonLatchLock(enabled ? 1.04 : 0.92, 0.85);
    this.showToast(
      enabled ? 'MUSIC: ON' : 'MUSIC: OFF',
      enabled ? 'green' : 'amber',
      1.2
    );
  }

  private toggleAtcMutedWithToast(): void {
    const nextMuted = this.approachAudio.toggleAtcMuted();
    this.host.audio.playButtonLatchLock(nextMuted ? 0.9 : 1.04, 0.85);
    if (nextMuted && !this.approachAudio.isConflictToneActive()) {
      this.host.music.setVhfDuck(false);
    }
    this.showToast(
      nextMuted ? 'ATC RADIO: MUTED' : 'ATC RADIO: ON',
      nextMuted ? 'red' : 'green',
      1.2
    );
  }

  private resolveSpeedTargetCraftId(): number | null {
    if (this.hoveredCraftId !== null && this.sim.getAircraftById(this.hoveredCraftId)) {
      return this.hoveredCraftId;
    }
    if (this.selectedCraftId !== null && this.sim.getAircraftById(this.selectedCraftId)) {
      return this.selectedCraftId;
    }
    return null;
  }

  private resolveSmartHoldTargetCraftId(): number | null {
    if (this.selectedCraftId !== null && this.sim.getAircraftById(this.selectedCraftId)) {
      return this.selectedCraftId;
    }
    if (this.hoveredCraftId !== null && this.sim.getAircraftById(this.hoveredCraftId)) {
      return this.hoveredCraftId;
    }
    return null;
  }

  private triggerSmartHold(craftId: number): void {
    const craft = this.sim.getAircraftById(craftId);
    if (!craft) return;

    if (this.draggingCraftId !== null) {
      this.cancelDrag();
      document.body.style.cursor = 'default';
    }

    const res = this.sim.commandSmartHold(craftId);
    if (res.ok && res.fixId) {
      const fl = Math.round((res.altitudeFt ?? 3500) / 100);
      this.selectedCraftId = craft.id;
      this.sim.pingAircraft(craft.id);
      this.showToast(
        `${craft.callsign} → SMART HOLD ${res.fixId} (FL${fl} · 0.35× FUEL)`,
        'cyan',
        2.2
      );
      return;
    }

    if (res.reason === 'JAMMED') {
      this.host.audio.playMutedAvionicsIndicatorBeep(false);
      this.selectedCraftId = craft.id;
      this.sim.pingAircraft(craft.id);
      this.showToast(
        'COMMS JAMMED (NO DAMAGE) — HOLDING LAST PATH UNTIL EXIT',
        'cyan',
        2.4
      );
      return;
    }

    if (res.reason === 'ALREADY_HOLDING') {
      const fixLabel = res.fixId ?? craft.assignedHoldFix ?? 'FIX';
      this.selectedCraftId = craft.id;
      this.sim.pingAircraft(craft.id);
      this.host.audio.playSfx('ui_keyclick', { pitch: 1.04, volume: 0.65 });
      this.showToast(`HOLDING ${fixLabel} — DRAG TO RELEASE`, 'cyan', 1.8);
      return;
    }

    if (res.reason === 'DEPARTING') {
      this.selectedCraftId = craft.id;
      this.showToast('DEPARTING — DRAG TO VECTOR', 'cyan', 1.5);
      return;
    }

    if (res.reason === 'ALL_FULL') {
      this.host.audio.playMutedAvionicsIndicatorBeep(false);
      this.showToast('ALL HOLDING FIXES FULL (3/3) — VECTOR MANUALLY', 'amber', 2.2);
      return;
    }

    if (res.reason === 'FLARING') {
      this.showToast('ON FINAL FLARE — TOO LOW FOR WAVE-OFF', 'amber', 1.5);
    }
  }

  private handleRightClickAtClient(
    clientX: number,
    clientY: number,
    pointerType = 'mouse'
  ): void {
    if (
      this.isAnyModalOverlayOpen() ||
      this.sim.phase !== 'ACTIVE_SHIFT' ||
      this.sim.paused ||
      this.sim.incidentFreezeTimer > 0
    ) {
      return;
    }

    const mapped = this.host.webglCrt.mapClientToCrtUv(
      clientX - this.offsetX,
      clientY - this.offsetY,
      this.crtRect,
      this.host.getCrtIntensity()
    );
    if (!mapped.inside) return;

    const cx = mapped.u * this.crtRect.width;
    const cy = mapped.v * this.crtRect.height;

    // 1. Flight Strip right-click -> immediate 1-Click Smart Hold!
    const hitId = this.hudRenderer.hitTestButton(cx, cy);
    if (hitId) {
      const stripCraftId = hitId.startsWith(APPROACH_UI_IDS.STRIP_PREFIX)
        ? Number(hitId.slice(APPROACH_UI_IDS.STRIP_PREFIX.length))
        : hitId.startsWith(APPROACH_UI_IDS.SPEED_PREFIX)
          ? Number(hitId.slice(APPROACH_UI_IDS.SPEED_PREFIX.length))
          : NaN;
      if (Number.isFinite(stripCraftId)) {
        this.triggerSmartHold(stripCraftId);
        return;
      }
    }

    // 2. Radar scope blip right-click -> immediate 1-Click Smart Hold!
    const layout = this.getCurrentLayout();
    const nm = screenToNm(cx, cy, layout.scopeViewport);
    if (!nm.inside) return;

    this.cursorInsideScope = true;
    this.cursorNm = { x: nm.x, y: nm.y };

    const hitRadiusNm = pointerType === 'touch' ? 1.85 : 1.5;
    let craft = this.sim.findAircraftAtNm(nm.x, nm.y, hitRadiusNm);
    if (!craft) {
      // Include flaring / takeoff-roll craft so RMB shows explicit FLARING / DEPARTING feedback
      let bestDist = hitRadiusNm;
      for (const candidate of this.sim.aircraft) {
        const d = Math.hypot(candidate.x - nm.x, candidate.y - nm.y);
        if (d <= bestDist) {
          bestDist = d;
          craft = candidate;
        }
      }
    }
    if (craft) {
      this.triggerSmartHold(craft.id);
    }
  }

  private stepCraftSpeed(craftId: number, delta: 1 | -1): void {
    const craft = this.sim.getAircraftById(craftId);
    if (!craft || craft.state === 'LANDING') return;
    if (craft.inStorm) {
      this.host.audio.playMutedAvionicsIndicatorBeep(false);
      this.showToast(
        'COMMS JAMMED (NO DAMAGE) — HOLDING LAST PATH UNTIL EXIT',
        'cyan',
        2.2
      );
      return;
    }
    const prevMode = craft.speedMode;
    const nextMode = this.sim.cycleCraftSpeed(craftId, delta);
    if (nextMode && nextMode !== prevMode) {
      this.showToast(
        `${craft.callsign}: SPEED ${nextMode} (${craft.speedKt} KT)`,
        nextMode === 'FAST' ? 'amber' : nextMode === 'SLOW' ? 'cyan' : 'green',
        1.1
      );
    }
  }

  private cycleStripCraftSpeed(craftId: number): void {
    const craft = this.sim.getAircraftById(craftId);
    if (!craft || craft.state === 'LANDING') return;
    this.selectedCraftId = craftId;
    if (craft.inStorm) {
      this.host.audio.playMutedAvionicsIndicatorBeep(false);
      this.showToast(
        'COMMS JAMMED (NO DAMAGE) — HOLDING LAST PATH UNTIL EXIT',
        'cyan',
        2.2
      );
      return;
    }
    const nextMode: SpeedMode =
      craft.speedMode === 'STD' ? 'FAST' : craft.speedMode === 'FAST' ? 'SLOW' : 'STD';
    if (this.sim.setCraftSpeedMode(craftId, nextMode)) {
      this.showToast(
        `${craft.callsign}: SPEED ${nextMode} (${craft.speedKt} KT)`,
        nextMode === 'FAST' ? 'amber' : nextMode === 'SLOW' ? 'cyan' : 'green',
        1.1
      );
    }
  }

  private triggerClearDeparture(): void {
    if (
      this.sim.phase !== 'ACTIVE_SHIFT' ||
      this.sim.paused ||
      this.isAnyModalOverlayOpen() ||
      this.sim.incidentFreezeTimer > 0
    ) {
      return;
    }
    const launched = this.sim.clearDeparture();
    if (launched) {
      this.selectedCraftId = launched.id;
      this.tutorial.notifyDepartureCleared();
      this.showToast(
        launched.gapLaunchEligible
          ? `GAP LAUNCH (+300): ${launched.callsign} · RWY ${launched.departureRunway ?? this.sim.primaryRunway}`
          : `CLEARED TAKEOFF: ${launched.callsign} · RWY ${launched.departureRunway ?? this.sim.primaryRunway}`,
        'cyan',
        1.7
      );
    } else {
      this.host.audio.playMutedAvionicsIndicatorBeep(false);
      this.showToast('DEPARTURE QUEUE CLEAR — NO CRAFT HOLDING SHORT', 'amber', 1.2);
    }
  }

  private resetSessionUiState(): void {
    this.cancelDrag();
    this.approachAudio.clearRadioQueue(true);
    this.runPlaytimeSec = 0;
    if (import.meta.env.DEV) {
      clearSessionTainted(this.sim);
    }
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.controlsOpen = false;
    this.manualOpen = false;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.confirmGameMenuPending = false;
    this.confirmGameMenuTimer = 0;
    this.hoveredCraftId = null;
    this.selectedCraftId = null;
    this.rmbPointerDownConsumed = false;
    this.callsignEditing = false;
    this.callsignOverwriteOnNextKey = false;
    this.scoreSubmitted = false;
    this.submittingScore = false;
    this.submitResultBanner = null;
    this.submitResultTone = 'green';
    this.lastSubmittedRun = null;
  }

  private startShift(): void {
    this.resetSessionUiState();
    this.tutorial.stop(this.sim);

    const ranked1979Bonus = this.host.getCrtPreset() === 'CLASSIC_1979';
    this.callsignDraft = this.leaderboard.getSavedCallsign();
    this.syncAirspaceBounds();
    this.sim.startNewShift({ ranked1979Bonus });
    this.host.setCrtModeLocked(true);

    if (ranked1979Bonus) {
      this.showToast('★ 1979 CRT RANKED LOCKED — 1.5X BASELINE SCORE ACTIVE ★', 'amber', 2.4);
    }
  }

  private startTrainingDrill(): void {
    this.resetSessionUiState();
    this.manualTab = 0;
    this.syncAirspaceBounds();
    this.tutorial.start(this.sim);
    this.host.setCrtModeLocked(true);
    this.showToast('RAPCON TRAINING DRILL — UNRANKED GUIDED SIMULATOR', 'cyan', 2.0);
  }

  private requestExitToHub(): void {
    this.confirmGameMenuPending = false;
    this.confirmGameMenuTimer = 0;
    if (this.isInActiveGameplay() && !this.confirmExitPending) {
      this.confirmExitPending = true;
      this.confirmExitTimer = 3.8;
      this.host.audio.playButtonLatchLock(0.86, 0.85);
      this.showToast('ACTIVE RAPCON SHIFT — CLICK [CONFIRM EXIT?] TO RETURN TO HUB', 'amber', 2.2);
      return;
    }
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.tutorial.stop(this.sim);
    this.host.setCrtModeLocked(false);
    this.host.exitToMuthurOs('EXITED BOREALIS APPROACH // LV-118 RAPCON RADAR STANDBY.');
  }

  private returnToBriefingMenu(requireConfirm: boolean): void {
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    if (requireConfirm && this.isInActiveGameplay() && !this.confirmGameMenuPending) {
      this.confirmGameMenuPending = true;
      this.confirmGameMenuTimer = 4.0;
      this.showToast('CLICK [CONFIRM MENU?] AGAIN TO RETURN TO GAME MENU', 'red', 2.4);
      return;
    }
    this.cancelDrag();
    this.approachAudio.silenceAll();
    this.host.music.setVhfDuck(false);
    this.host.music.stopGameplayMusic(0.75);
    this.tutorial.stop(this.sim);
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.controlsOpen = false;
    this.manualOpen = false;
    this.confirmGameMenuPending = false;
    this.confirmGameMenuTimer = 0;
    this.hoveredCraftId = null;
    this.selectedCraftId = null;
    this.host.setCrtModeLocked(false);
    this.sim.resetToTitle();
    this.showToast('RETURNED TO BOREALIS APPROACH MENU', 'green', 1.4);
  }

  private getSystemMenuCallbacks(): SystemMenuActionCallbacks {
    return {
      onResume: () => {
        this.osdMenuOpen = false;
        this.confirmExitPending = false;
        this.confirmExitTimer = 0;
        this.confirmGameMenuPending = false;
        this.confirmGameMenuTimer = 0;
      },
      onRestart: () => {
        if (this.tutorial.isActive()) {
          this.startTrainingDrill();
        } else {
          this.startShift();
        }
      },
      onReturnToGameMenu: () => {
        this.returnToBriefingMenu(true);
      },
      onOpenLeaderboard: () => {
        this.osdMenuOpen = false;
        this.controlsOpen = false;
        this.manualOpen = false;
        this.confirmExitPending = false;
        this.confirmExitTimer = 0;
        this.confirmGameMenuPending = false;
        this.confirmGameMenuTimer = 0;
        this.manifestOpen = true;
      },
      onExitToHub: () => {
        this.requestExitToHub();
      },
      onToggleAtcMute: () => {
        this.toggleAtcMutedWithToast();
      },
    };
  }

  private async submitCurrentScore(): Promise<void> {
    if (this.sim.trainingMode) {
      this.submitResultBanner = 'TRAINING DRILL — UNRANKED SESSION';
      this.submitResultTone = 'amber';
      return;
    }
    if (import.meta.env.DEV && isSessionTainted(this.sim)) {
      this.submitResultBanner = 'DEV DEBUG SESSION — RELAY WRITE BLOCKED';
      this.submitResultTone = 'amber';
      return;
    }
    if (this.scoreSubmitted || this.submittingScore) return;
    this.submittingScore = true;
    this.submitResultBanner = 'TRANSMITTING RAPCON LOG TO ORBITAL RELAY...';
    this.submitResultTone = 'amber';

    const finalScore = Math.max(1, Math.round(this.sim.score));
    const finalLanded = Math.max(0, Math.round(this.sim.landedCount));
    const finalMaxMult = Math.max(1, Math.min(5, Math.round(this.sim.maxMultiplier * 100) / 100));
    const finalPhase = this.sim.shiftPhase;

    const res = await this.leaderboard.submitScore({
      callsign: this.callsignDraft,
      score: finalScore,
      landed: finalLanded,
      maxMult: finalMaxMult,
      phase: finalPhase,
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
    this.callsignDraft = this.leaderboard.getSavedCallsign();
    this.lastSubmittedRun = {
      docId: res.docId,
      callsign: this.callsignDraft,
      score: res.submittedScore ?? finalScore,
      landed: finalLanded,
      maxMult: finalMaxMult,
      phase: finalPhase,
      rank: res.rank,
    };

    this.host.audio.playButtonLatchLock(1.05, 0.9);
    this.submitResultTone = 'green';
    this.submitResultBanner = res.offlineFallback
      ? `LOGGED TO LOCAL TAPE ARCHIVE — RANK #${res.rank}`
      : `TRANSMISSION CONFIRMED // ORBITAL RELAY RANK #${res.rank}!`;
    this.manifestOpen = true;
  }

  private focusMobileCallsignInput(): void {
    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (!mobileInput) return;
    mobileInput.maxLength = CALLSIGN_MAX_LEN;
    mobileInput.value = this.callsignDraft;
    try {
      mobileInput.focus({ preventScroll: true });
    } catch {
      mobileInput.focus();
    }
  }

  private bindListeners(signal: AbortSignal): void {
    window.addEventListener(
      'contextmenu',
      (e) => {
        e.preventDefault();
        if (this.rmbPointerDownConsumed) {
          this.rmbPointerDownConsumed = false;
          return;
        }
        void this.host.audio.unlock();
        if (e.target instanceof Element) {
          const stripEl = e.target.closest('[data-craft-id], [data-aircraft-id]');
          const rawId =
            stripEl?.getAttribute('data-craft-id') ?? stripEl?.getAttribute('data-aircraft-id');
          if (rawId !== null && rawId !== undefined) {
            const parsedId = Number(rawId);
            if (Number.isFinite(parsedId)) {
              this.triggerSmartHold(parsedId);
              return;
            }
          }
        }
        this.handleRightClickAtClient(e.clientX, e.clientY, 'mouse');
      },
      { signal }
    );

    window.addEventListener(
      'blur',
      () => {
        this.cancelDrag();
        this.rmbPointerDownConsumed = false;
        this.approachAudio.updateAmbience(false, false, 0.05);
        this.approachAudio.updateConflictAlertTone(false, 99, 0.05);
      },
      { signal }
    );

    // Mouse-wheel speed control over radar scope (hovered or selected aircraft)
    window.addEventListener(
      'wheel',
      (e) => {
        if (
          this.isAnyModalOverlayOpen() ||
          this.sim.phase !== 'ACTIVE_SHIFT' ||
          this.sim.paused ||
          this.sim.incidentFreezeTimer > 0
        ) {
          return;
        }
        const mapped = this.host.webglCrt.mapClientToCrtUv(
          e.clientX - this.offsetX,
          e.clientY - this.offsetY,
          this.crtRect,
          this.host.getCrtIntensity()
        );
        if (!mapped.inside) return;

        const cx = mapped.u * this.crtRect.width;
        const cy = mapped.v * this.crtRect.height;
        const layout = this.getCurrentLayout();
        const nm = screenToNm(cx, cy, layout.scopeViewport);
        if (!nm.inside) return;

        const underCursor = this.sim.findAircraftAtNm(nm.x, nm.y, 1.45);
        const targetId = underCursor?.id ?? this.resolveSpeedTargetCraftId();
        if (targetId === null || Math.abs(e.deltaY) < 0.01) return;

        e.preventDefault();
        void this.host.audio.unlock();
        this.selectedCraftId = targetId;
        this.stepCraftSpeed(targetId, e.deltaY < 0 ? 1 : -1);
      },
      { signal, passive: false }
    );

    window.addEventListener(
      'pointermove',
      (e) => {
        const mapped = this.host.webglCrt.mapClientToCrtUv(
          e.clientX - this.offsetX,
          e.clientY - this.offsetY,
          this.crtRect,
          this.host.getCrtIntensity()
        );

        if (!mapped.inside) {
          if (this.draggingCraftId === null) {
            this.hoveredButtonId = null;
            this.hoveredCraftId = null;
            this.cursorInsideScope = false;
            document.body.style.cursor = 'default';
          }
          return;
        }

        const cx = mapped.u * this.crtRect.width;
        const cy = mapped.v * this.crtRect.height;
        const layout = this.getCurrentLayout();
        const nm = screenToNm(cx, cy, layout.scopeViewport);
        this.cursorInsideScope = nm.inside;
        this.cursorNm = { x: nm.x, y: nm.y };

        // Active smooth vector drag update
        if (
          this.draggingCraftId !== null &&
          (this.dragPointerId === null || e.pointerId === this.dragPointerId)
        ) {
          const craft = this.sim.getAircraftById(this.draggingCraftId);
          if (
            !craft ||
            craft.state === 'LANDING' ||
            craft.inStorm ||
            this.sim.phase !== 'ACTIVE_SHIFT' ||
            this.sim.paused ||
            this.isAnyModalOverlayOpen()
          ) {
            const jammedMidDrag = Boolean(craft?.inStorm);
            this.cancelDrag();
            document.body.style.cursor = 'default';
            if (jammedMidDrag) {
              this.host.audio.playMutedAvionicsIndicatorBeep(false);
              this.showToast(
                'COMMS JAMMED (NO DAMAGE) — HOLDING LAST PATH UNTIL EXIT',
                'cyan',
                2.4
              );
            }
            return;
          }

          const clamped = this.clampToScopeNm({ x: nm.x, y: nm.y });
          if (
            !this.dragHasMoved &&
            this.dragStartNm &&
            Math.hypot(clamped.x - this.dragStartNm.x, clamped.y - this.dragStartNm.y) >= 0.45
          ) {
            this.dragHasMoved = true;
          }

          const lastPt = this.dragWaypointsNm[this.dragWaypointsNm.length - 1];
          if (
            !lastPt ||
            Math.hypot(clamped.x - lastPt.x, clamped.y - lastPt.y) >= DRAG_SAMPLE_DIST_NM
          ) {
            this.dragWaypointsNm.push(clamped);
            if (this.dragWaypointsNm.length > 96) {
              this.dragWaypointsNm.splice(1, 1);
            }
            if (this.dragHasMoved) {
              this.approachAudio.playDragWaypointTick();
            }
          }

          const previewPts =
            this.dragWaypointsNm.length > 0 &&
            Math.hypot(
              clamped.x - this.dragWaypointsNm[this.dragWaypointsNm.length - 1].x,
              clamped.y - this.dragWaypointsNm[this.dragWaypointsNm.length - 1].y
            ) > 0.08
              ? [...this.dragWaypointsNm, clamped]
              : this.dragWaypointsNm;

          this.dragPreview = this.sim.previewAndSnapPath(this.draggingCraftId, previewPts);
          if (this.dragPreview.holdFixFull && this.dragPreview.holdFix) {
            if (this.dragLastFullHoldFix !== this.dragPreview.holdFix) {
              this.dragLastFullHoldFix = this.dragPreview.holdFix;
              this.host.audio.playMutedAvionicsIndicatorBeep(false);
              this.showToast(
                this.dragPreview.rejectReason ??
                  `HOLD ${this.dragPreview.holdFix} FULL (3/3) — USE ANOTHER FIX`,
                'amber',
                1.8
              );
            }
          } else {
            this.dragLastFullHoldFix = null;
          }
          if (this.dragPreview.snapKind !== this.dragLastSnapKind) {
            if (
              this.dragPreview.snapKind === 'ILS_LOCK' ||
              this.dragPreview.snapKind === 'PAD_LOCK' ||
              this.dragPreview.snapKind === 'CRADLE_LOCK'
            ) {
              this.host.audio.playSfx('ui_keyclick', { pitch: 1.28, volume: 0.65 });
            } else if (this.dragPreview.snapKind === 'HOLD_FIX') {
              this.host.audio.playSfx('ui_keyclick', { pitch: 1.18, volume: 0.62 });
            } else if (this.dragPreview.snapKind === 'UNSTABLE_REJECT') {
              this.host.audio.playSfx('ui_keyclick', { pitch: 0.72, volume: 0.65 });
            }
            this.dragLastSnapKind = this.dragPreview.snapKind;
          }

          this.hoveredButtonId = null;
          this.hoveredCraftId = this.draggingCraftId;
          document.body.style.cursor = 'crosshair';
          return;
        }

        // Idle hover hit-testing (HUD buttons & Flight Progress Strips + radar blips)
        const btnHit = this.hudRenderer.hitTestButton(cx, cy);
        this.hoveredButtonId = btnHit;

        if (
          !btnHit &&
          nm.inside &&
          this.sim.phase === 'ACTIVE_SHIFT' &&
          !this.sim.paused &&
          !this.isAnyModalOverlayOpen()
        ) {
          const hov = this.sim.findAircraftAtNm(nm.x, nm.y, 1.35);
          this.hoveredCraftId = hov ? hov.id : null;
        } else if (btnHit && btnHit.startsWith(APPROACH_UI_IDS.SPEED_PREFIX)) {
          const parsedId = Number(btnHit.slice(APPROACH_UI_IDS.SPEED_PREFIX.length));
          this.hoveredCraftId = Number.isFinite(parsedId) ? parsedId : null;
        } else if (btnHit && btnHit.startsWith(APPROACH_UI_IDS.STRIP_PREFIX)) {
          const parsedId = Number(btnHit.slice(APPROACH_UI_IDS.STRIP_PREFIX.length));
          this.hoveredCraftId = Number.isFinite(parsedId) ? parsedId : null;
        } else {
          this.hoveredCraftId = null;
        }

        document.body.style.cursor =
          btnHit || this.hoveredCraftId !== null ? 'pointer' : 'default';
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

        // 1. Right-click (RMB) on any Flight Strip or Radar Blip -> 1-Click Smart Hold / Safe Wave-Off!
        if (e.button === 2) {
          this.rmbPointerDownConsumed = true;
          this.confirmExitPending = false;
          this.confirmExitTimer = 0;
          this.confirmGameMenuPending = false;
          this.confirmGameMenuTimer = 0;
          this.handleRightClickAtClient(e.clientX, e.clientY, e.pointerType);
          return;
        }
        this.rmbPointerDownConsumed = false;

        // 2. Check interactive HUD, Top Chrome Bar, Modals, Tutorial Buttons, and Flight Strips first
        if (e.button === 0) {
          const hitId = this.hudRenderer.hitTestButton(cx, cy);
          if (hitId) {
            this.cancelDrag();
            this.handleHudButton(hitId);
            return;
          }
        }

        // Clicking outside clears pending breaker latches
        this.confirmExitPending = false;
        this.confirmExitTimer = 0;
        this.confirmGameMenuPending = false;
        this.confirmGameMenuTimer = 0;

        // 3. Never pass pointer events into radar gameplay while any modal, pause, or debrief is active
        if (
          this.isAnyModalOverlayOpen() ||
          this.sim.phase !== 'ACTIVE_SHIFT' ||
          this.sim.paused ||
          this.sim.incidentFreezeTimer > 0
        ) {
          return;
        }

        const layout = this.getCurrentLayout();
        const nm = screenToNm(cx, cy, layout.scopeViewport);
        this.cursorInsideScope = nm.inside;
        this.cursorNm = { x: nm.x, y: nm.y };
        if (!nm.inside) return;

        const hitRadiusNm = e.pointerType === 'touch' ? 1.85 : 1.45;
        const craft = this.sim.findAircraftAtNm(nm.x, nm.y, hitRadiusNm);

        if (e.button !== 0 || !craft) {
          this.selectedCraftId = null;
          return;
        }

        this.selectedCraftId = craft.id;

        // 4. Ion Static non-lethal comms-jam coaching toast
        if (craft.inStorm) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.sim.pingAircraft(craft.id);
          this.showToast(
            'COMMS JAMMED (NO DAMAGE) — HOLDING LAST PATH UNTIL EXIT',
            'cyan',
            2.4
          );
          return;
        }

        // 5. Begin smooth vector flight-path drag
        const startPt = this.clampToScopeNm({ x: nm.x, y: nm.y });
        this.draggingCraftId = craft.id;
        this.dragPointerId = e.pointerId;
        this.dragStartNm = startPt;
        this.dragHasMoved = false;
        this.dragWaypointsNm = [startPt];
        this.dragPreview = null;
        this.dragLastSnapKind = 'NONE';
        this.dragLastFullHoldFix = null;
        this.hoveredCraftId = craft.id;
        this.host.audio.playSfx('ui_keyclick', { pitch: 1.12, volume: 0.72 });
        document.body.style.cursor = 'crosshair';
      },
      { signal }
    );

    const finishDrag = (e: PointerEvent, cancelled: boolean): void => {
      if (this.draggingCraftId === null) return;
      if (this.dragPointerId !== null && e.pointerId !== this.dragPointerId) return;

      const craftId = this.draggingCraftId;
      const moved = this.dragHasMoved;
      const waypoints = [...this.dragWaypointsNm];
      const startPt = this.dragStartNm;

      if (!cancelled) {
        const mapped = this.host.webglCrt.mapClientToCrtUv(
          e.clientX - this.offsetX,
          e.clientY - this.offsetY,
          this.crtRect,
          this.host.getCrtIntensity()
        );
        if (mapped.inside) {
          const cx = mapped.u * this.crtRect.width;
          const cy = mapped.v * this.crtRect.height;
          const layout = this.getCurrentLayout();
          const nm = screenToNm(cx, cy, layout.scopeViewport);
          const endPt = this.clampToScopeNm({ x: nm.x, y: nm.y });
          const last = waypoints[waypoints.length - 1];
          if (!last || Math.hypot(endPt.x - last.x, endPt.y - last.y) >= 0.1) {
            waypoints.push(endPt);
          }
        }
      }

      this.cancelDrag();
      document.body.style.cursor = 'default';

      if (cancelled || this.sim.phase !== 'ACTIVE_SHIFT' || this.sim.paused) {
        return;
      }

      const endPt = waypoints[waypoints.length - 1];
      const totalDisplacement =
        startPt && endPt ? Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y) : 0;

      if (moved || totalDisplacement >= 0.55) {
        const res = this.sim.assignVectorPath(craftId, waypoints);
        if (res.blockedByStorm) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast(
            'COMMS JAMMED (NO DAMAGE) — HOLDING LAST PATH UNTIL EXIT',
            'cyan',
            2.4
          );
        } else if (res.holdFixFull && res.holdFix) {
          this.host.audio.playMutedAvionicsIndicatorBeep(false);
          this.showToast(
            res.rejectReason ?? `HOLD ${res.holdFix} FULL (3/3) — USE ANOTHER FIX`,
            'amber',
            2.2
          );
        } else if (res.snapKind === 'UNSTABLE_REJECT') {
          this.showToast(
            `${res.rejectReason ?? 'UNSTABLE APPROACH'} — GOING AROUND!`,
            'amber',
            2.0
          );
        } else if (res.entersRestrictedZone) {
          this.showToast('CAUTION: VECTOR CROSSES R-118 LIVE-FIRE MOA!', 'red', 1.8);
        }
      } else {
        // Click / short tap simply selects & pings the contact (never accidental Go-Around!)
        this.selectedCraftId = craftId;
        this.sim.pingAircraft(craftId);
      }
    };

    window.addEventListener('pointerup', (e) => finishDrag(e, false), { signal });
    window.addEventListener('pointercancel', (e) => finishDrag(e, true), { signal });

    window.addEventListener(
      'keydown',
      (e) => {
        const mobileInputEl = document.getElementById('mobile-callsign-input');
        if (mobileInputEl && e.target === mobileInputEl) {
          return;
        }
        if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
          e.preventDefault();
        }
        void this.host.audio.unlock();

        // 1. Strict 1.2-second Game Over input keylock (ignores stray keys right on 3rd seal breach!)
        if (
          this.sim.phase === 'GAME_OVER' &&
          this.sim.gameOverLockoutTimer > 0 &&
          !this.osdMenuOpen &&
          !this.manifestOpen &&
          !this.controlsOpen &&
          !this.manualOpen
        ) {
          return;
        }

        // 2. Opt-in Callsign Editing mode on Game Over Debrief (isolated from hotkeys!)
        if (
          this.sim.phase === 'GAME_OVER' &&
          !this.osdMenuOpen &&
          !this.manifestOpen &&
          !this.controlsOpen &&
          !this.manualOpen &&
          this.callsignEditing &&
          !this.scoreSubmitted
        ) {
          if (e.code === 'Escape') {
            e.preventDefault();
            this.callsignEditing = false;
            this.callsignOverwriteOnNextKey = false;
            this.host.audio.playSfx('ui_keyclick', { pitch: 0.85 });
            return;
          }
          if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            e.preventDefault();
            this.callsignEditing = false;
            this.callsignOverwriteOnNextKey = false;
            this.host.audio.playSfx('keypress_return', { volume: 0.9 });
            void this.submitCurrentScore();
            return;
          }
          if (e.code === 'Backspace') {
            e.preventDefault();
            if (this.callsignOverwriteOnNextKey) {
              this.callsignDraft = '';
              this.callsignOverwriteOnNextKey = false;
            } else {
              this.callsignDraft = this.callsignDraft.slice(0, -1);
            }
            this.host.audio.playSfx('ui_keyclick', { pitch: 0.9 });
            return;
          }
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (CALLSIGN_CHAR_REGEX.test(e.key)) {
              if (this.callsignOverwriteOnNextKey) {
                this.callsignDraft = e.key.toUpperCase();
                this.callsignOverwriteOnNextKey = false;
              } else if (this.callsignDraft.length < CALLSIGN_MAX_LEN) {
                this.callsignDraft += e.key.toUpperCase();
              }
              this.submitResultBanner = null;
              this.host.audio.playSfx('ui_keyclick', { pitch: 0.96 + Math.random() * 0.1 });
            }
            return;
          }
          return;
        }

        // 3. Universal [M] Mute toggle (outside text inputs, with 1.2s toast!)
        if (e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          this.toggleMuteWithToast();
          return;
        }

        // 4. Unified System Menu Modal open ([ESC] resume, [1-5] quick-switch, [H] Controls)
        if (this.osdMenuOpen) {
          if (handleSystemMenuKey(e, this.host, this.getSystemMenuCallbacks())) {
            return;
          }
          if ((e.code === 'KeyH' || e.key === '?') && !e.repeat) {
            e.preventDefault();
            this.osdMenuOpen = false;
            this.controlsOpen = true;
            this.host.audio.playButtonLatchLock();
            return;
          }
          return;
        }

        // 5. Standalone 3-Tab RAPCON Field Manual Modal open ([1-3] / [← →] tabs, [ESC] close, [H] Controls)
        if (this.manualOpen) {
          if (e.code === 'Escape') {
            e.preventDefault();
            this.manualOpen = false;
            this.host.audio.playButtonLatchLock(0.96, 0.85);
            return;
          }
          if ((e.code === 'KeyH' || e.key === '?') && !e.repeat) {
            e.preventDefault();
            this.manualOpen = false;
            this.controlsOpen = true;
            this.host.audio.playButtonLatchLock();
            return;
          }
          if ((e.code === 'Digit1' || e.code === 'Numpad1') && !e.repeat) {
            e.preventDefault();
            this.manualTab = 0;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.06, volume: 0.7 });
            return;
          }
          if ((e.code === 'Digit2' || e.code === 'Numpad2') && !e.repeat) {
            e.preventDefault();
            this.manualTab = 1;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.06, volume: 0.7 });
            return;
          }
          if ((e.code === 'Digit3' || e.code === 'Numpad3') && !e.repeat) {
            e.preventDefault();
            this.manualTab = 2;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.06, volume: 0.7 });
            return;
          }
          if (e.code === 'ArrowLeft' && !e.repeat) {
            e.preventDefault();
            this.manualTab = (this.manualTab + 2) % 3;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.04, volume: 0.7 });
            return;
          }
          if (e.code === 'ArrowRight' && !e.repeat) {
            e.preventDefault();
            this.manualTab = (this.manualTab + 1) % 3;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.08, volume: 0.7 });
            return;
          }
          return;
        }

        // 5b. Controls Quick-Card Modal open ([H], [?], or [ESC] closes cleanly)
        if (this.controlsOpen) {
          if (e.code === 'Escape' || e.code === 'KeyH' || e.key === '?') {
            e.preventDefault();
            this.controlsOpen = false;
            this.host.audio.playButtonLatchLock();
          }
          return;
        }

        // 6. Global Leaderboard Modal open ([ESC] close; [R]/[ENTER] Play Again when post-run or title!)
        if (this.manifestOpen) {
          if (e.code === 'Escape') {
            e.preventDefault();
            this.manifestOpen = false;
            this.host.audio.playButtonLatchLock();
            return;
          }
          if (
            (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'NumpadEnter') &&
            (this.sim.phase === 'GAME_OVER' || this.sim.phase === 'TITLE')
          ) {
            e.preventDefault();
            this.host.audio.playButtonLatchLock(1.04, 0.9);
            this.startShift();
            return;
          }
          return;
        }

        // 7. Universal [H] / [?] 1-Glance Controls Quick-Card (pauses sim cleanly)
        if ((e.code === 'KeyH' || e.key === '?') && !e.repeat) {
          e.preventDefault();
          this.cancelDrag();
          this.confirmExitPending = false;
          this.controlsOpen = true;
          this.host.audio.playButtonLatchLock();
          return;
        }

        // 8. Unified [ESC] -> Opens System & Pause Menu everywhere (never exits directly to Hub)
        if (e.code === 'Escape') {
          e.preventDefault();
          this.cancelDrag();
          this.confirmExitPending = false;
          this.osdMenuOpen = true;
          this.host.audio.playButtonLatchLock();
          return;
        }

        // 9. Game Over Debrief post-lockout keyboard controls
        if (this.sim.phase === 'GAME_OVER') {
          if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            e.preventDefault();
            this.host.audio.playSfx('keypress_return', { volume: 0.9 });
            if (!this.scoreSubmitted) {
              void this.submitCurrentScore();
            } else {
              this.manifestOpen = true;
            }
            return;
          }
          if (e.code === 'KeyR' && !e.repeat) {
            e.preventDefault();
            this.host.audio.playButtonLatchLock();
            this.startShift();
            return;
          }
          if (e.code === 'KeyC' && !this.scoreSubmitted && !e.repeat) {
            this.callsignEditing = true;
            this.callsignOverwriteOnNextKey = true;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.12 });
            return;
          }
          return;
        }

        // 10. Pre-Launch Briefing Screen controls
        if (this.sim.phase === 'TITLE') {
          if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
            e.preventDefault();
            this.host.audio.playButtonLatchLock(1.04, 0.9);
            this.startShift();
          }
          return;
        }

        // 11. Training Drill Step 6 Graduation / Field Manual Modal hotkeys (with 0.8s arrival guard!)
        if (this.tutorial.isGraduated() && !this.sim.paused) {
          if ((e.code === 'Digit1' || e.code === 'Numpad1') && !e.repeat) {
            e.preventDefault();
            this.manualTab = 0;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.06, volume: 0.7 });
            return;
          }
          if ((e.code === 'Digit2' || e.code === 'Numpad2') && !e.repeat) {
            e.preventDefault();
            this.manualTab = 1;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.06, volume: 0.7 });
            return;
          }
          if ((e.code === 'Digit3' || e.code === 'Numpad3') && !e.repeat) {
            e.preventDefault();
            this.manualTab = 2;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.06, volume: 0.7 });
            return;
          }
          if (e.code === 'ArrowLeft' && !e.repeat) {
            e.preventDefault();
            this.manualTab = (this.manualTab + 2) % 3;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.04, volume: 0.7 });
            return;
          }
          if (e.code === 'ArrowRight' && !e.repeat) {
            e.preventDefault();
            this.manualTab = (this.manualTab + 1) % 3;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.08, volume: 0.7 });
            return;
          }
          if (this.tutorial.isGraduationLocked()) {
            return;
          }
          if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
            e.preventDefault();
            this.host.audio.playButtonLatchLock(1.04, 0.9);
            this.tutorial.markCompleted();
            this.startShift();
            return;
          }
          if (e.code === 'KeyR' && !e.repeat) {
            e.preventDefault();
            this.host.audio.playButtonLatchLock(1.0, 0.88);
            this.startTrainingDrill();
            return;
          }
          return;
        }

        // 12. Universal [P] Quick-Pause with shared Amber CRT Pause Banner
        if (e.code === 'KeyP' && !e.repeat && this.sim.phase === 'ACTIVE_SHIFT') {
          this.cancelDrag();
          this.sim.paused = !this.sim.paused;
          this.host.audio.playButtonLatchLock();
          return;
        }

        if (this.sim.phase !== 'ACTIVE_SHIFT' || this.sim.paused) {
          return;
        }

        // 13. Training Drill Step 3 & Step 5 [SPACE] / [ENTER] explicit advance
        if (
          this.tutorial.isActive() &&
          (this.tutorial.getStepIndex() === 2 || this.tutorial.getStepIndex() === 4) &&
          !e.repeat &&
          (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')
        ) {
          e.preventDefault();
          if (this.tutorial.getStepIndex() === 4) {
            this.manualTab = 0;
          }
          this.host.audio.playButtonLatchLock(1.02, 0.85);
          this.tutorial.notifyNext();
          return;
        }

        // 14. Active Gameplay Tactical Hotkeys: [W] Smart Hold, [D] Clear Departure, [S] Slower, [F] Faster
        if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (e.code === 'KeyW') {
            e.preventDefault();
            if (this.sim.incidentFreezeTimer > 0) return;
            const targetId = this.resolveSmartHoldTargetCraftId();
            if (targetId !== null) {
              this.triggerSmartHold(targetId);
            } else {
              this.showToast('SELECT OR HOVER AN AIRCRAFT FOR SMART HOLD [W]', 'cyan', 1.5);
            }
            return;
          }
          if (e.code === 'KeyD') {
            e.preventDefault();
            this.triggerClearDeparture();
            return;
          }
          if (e.code === 'KeyS') {
            e.preventDefault();
            const targetId = this.resolveSpeedTargetCraftId();
            if (targetId !== null) {
              this.stepCraftSpeed(targetId, -1);
            }
            return;
          }
          if (e.code === 'KeyF') {
            e.preventDefault();
            const targetId = this.resolveSpeedTargetCraftId();
            if (targetId !== null) {
              this.stepCraftSpeed(targetId, 1);
            }
            return;
          }
        }
      },
      { signal }
    );

    // Mobile virtual keyboard bridge for Callsign submission on Game Over
    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (mobileInput) {
      mobileInput.addEventListener(
        'input',
        () => {
          if (this.sim.phase !== 'GAME_OVER' || this.scoreSubmitted) return;
          this.callsignDraft = sanitizeCallsignDraft(mobileInput.value);
          mobileInput.value = this.callsignDraft;
        },
        { signal }
      );
      mobileInput.addEventListener(
        'keydown',
        (ev) => {
          ev.stopPropagation();
          if (
            ev.key === 'Enter' &&
            this.sim.phase === 'GAME_OVER' &&
            this.sim.gameOverLockoutTimer <= 0 &&
            !this.scoreSubmitted
          ) {
            ev.preventDefault();
            this.callsignEditing = false;
            this.callsignOverwriteOnNextKey = false;
            mobileInput.blur();
            void this.submitCurrentScore();
          }
        },
        { signal }
      );
    }
  }

  private handleHudButton(id: string): void {
    // 1. Unified System Menu actions
    if (this.osdMenuOpen) {
      if (id === SYSTEM_MENU_IDS.VOL_MUTE) {
        this.toggleMuteWithToast();
        return;
      }
      if (id === SYSTEM_MENU_IDS.MUSIC_TOGGLE) {
        this.toggleMusicWithToast();
        return;
      }
      if (id === SYSTEM_MENU_IDS.ATC_TOGGLE) {
        this.toggleAtcMutedWithToast();
        return;
      }
      if (handleSystemMenuAction(id, this.host, this.getSystemMenuCallbacks())) {
        return;
      }
    }

    // 2. Right-Column Departure Queue Launch Button
    if (id === APPROACH_UI_IDS.CLEAR_DEPARTURE) {
      this.triggerClearDeparture();
      return;
    }

    // 3. Flight Progress Strip Speed Pill toggle (STD -> FAST -> SLOW -> STD)
    if (id.startsWith(APPROACH_UI_IDS.SPEED_PREFIX)) {
      const craftId = Number(id.slice(APPROACH_UI_IDS.SPEED_PREFIX.length));
      if (Number.isFinite(craftId)) {
        this.cycleStripCraftSpeed(craftId);
      }
      return;
    }

    // 4. Right-Column ATC Flight Progress Strip click -> Ping & Highlight Craft on Radar (2.5s)!
    if (id.startsWith(APPROACH_UI_IDS.STRIP_PREFIX)) {
      const craftId = Number(id.slice(APPROACH_UI_IDS.STRIP_PREFIX.length));
      if (Number.isFinite(craftId)) {
        const craft = this.sim.getAircraftById(craftId);
        if (craft && this.sim.pingAircraft(craftId)) {
          this.selectedCraftId = craftId;
          const pan = Math.max(-1, Math.min(1, craft.x / Math.max(1, this.sim.airspaceHalfWidthNm)));
          this.approachAudio.playStripPing(pan);
        }
      }
      return;
    }

    // 5. RAPCON 3-Tab Field Manual & Interactive Training Drill buttons
    if (id === APPROACH_UI_IDS.OPEN_MANUAL) {
      this.host.audio.playButtonLatchLock(1.02, 0.88);
      this.cancelDrag();
      this.osdMenuOpen = false;
      this.manifestOpen = false;
      this.controlsOpen = false;
      this.manualOpen = true;
      return;
    }
    if (id === APPROACH_UI_IDS.MANUAL_CLOSE) {
      this.host.audio.playButtonLatchLock(0.96, 0.85);
      this.manualOpen = false;
      return;
    }
    if (id.startsWith(APPROACH_UI_IDS.MANUAL_TAB_PREFIX)) {
      const parsedTab = Number(id.slice(APPROACH_UI_IDS.MANUAL_TAB_PREFIX.length));
      if (Number.isFinite(parsedTab)) {
        this.manualTab = Math.max(0, Math.min(2, Math.floor(parsedTab)));
        this.host.audio.playSfx('ui_keyclick', { pitch: 1.06, volume: 0.72 });
      }
      return;
    }
    if (id === APPROACH_UI_IDS.TRAINING_DRILL) {
      this.host.audio.playButtonLatchLock(1.04, 0.9);
      this.startTrainingDrill();
      return;
    }
    if (id === APPROACH_UI_IDS.TUTORIAL_NEXT) {
      if (this.tutorial.getStepIndex() === 4) {
        this.manualTab = 0;
      }
      this.host.audio.playButtonLatchLock(1.02, 0.85);
      this.tutorial.notifyNext();
      return;
    }
    if (id === APPROACH_UI_IDS.TUTORIAL_SKIP) {
      this.host.audio.playButtonLatchLock(1.04, 0.9);
      this.tutorial.markCompleted();
      this.startShift();
      return;
    }
    if (id === APPROACH_UI_IDS.TUTORIAL_LAUNCH_RANKED) {
      if (this.tutorial.isGraduationLocked()) return;
      this.host.audio.playButtonLatchLock(1.04, 0.9);
      this.tutorial.markCompleted();
      this.startShift();
      return;
    }
    if (id === APPROACH_UI_IDS.TUTORIAL_REPLAY) {
      if (this.tutorial.isGraduationLocked()) return;
      this.host.audio.playButtonLatchLock(1.0, 0.88);
      this.startTrainingDrill();
      return;
    }
    if (id === APPROACH_UI_IDS.TUTORIAL_BRIEFING_MENU) {
      if (this.tutorial.isGraduationLocked()) return;
      this.host.audio.playButtonLatchLock(0.96, 0.88);
      this.tutorial.markCompleted();
      this.returnToBriefingMenu(false);
      return;
    }

    // 6. Callsign box click (opt-in editing on Game Over Debrief)
    if (id === POST_RUN_IDS.CALLSIGN_BOX) {
      if (this.sim.gameOverLockoutTimer > 0 || this.scoreSubmitted || this.submittingScore) return;
      this.callsignEditing = true;
      this.callsignOverwriteOnNextKey = true;
      this.host.audio.playSfx('ui_keyclick', { pitch: 1.1 });
      this.focusMobileCallsignInput();
      return;
    }

    // 7. Top Chrome Bar & Shared Modal Actions
    if (id === TOP_CHROME_IDS.CRT) {
      this.confirmExitPending = false;
      this.confirmGameMenuPending = false;
      if (this.host.isCrtModeLocked()) {
        this.host.audio.playMutedAvionicsIndicatorBeep(false);
        const lockedState = this.host.getCrtPreset() === 'CLASSIC_1979' ? 'ON' : 'OFF';
        this.showToast(
          `1979 CRT LOCKED ${lockedState} DURING SHIFT — FINISH OR EXIT SHIFT`,
          'amber',
          1.8
        );
        return;
      }
      const next = this.host.toggle1979Crt();
      this.showToast(
        next === 'CLASSIC_1979'
          ? '1979 CRT: ON — 1.5X RANKED SCORE ARMED!'
          : '1979 CRT: OFF (CLEAN · 1.0X)',
        next === 'CLASSIC_1979' ? 'amber' : 'green',
        1.6
      );
      return;
    }

    if (id === TOP_CHROME_IDS.AUDIO) {
      this.confirmExitPending = false;
      this.toggleMuteWithToast();
      return;
    }

    if (id === TOP_CHROME_IDS.MUSIC) {
      this.confirmExitPending = false;
      this.toggleMusicWithToast();
      return;
    }

    if (id === TOP_CHROME_IDS.ATC) {
      this.confirmExitPending = false;
      this.toggleAtcMutedWithToast();
      return;
    }

    if (id === TOP_CHROME_IDS.HUB) {
      this.requestExitToHub();
      return;
    }

    this.confirmExitPending = false;
    this.confirmExitTimer = 0;

    if (id === TOP_CHROME_IDS.CONTROLS || id === APPROACH_UI_IDS.TITLE_CONTROLS) {
      this.host.audio.playButtonLatchLock(1.0, 0.85);
      this.cancelDrag();
      this.osdMenuOpen = false;
      this.manifestOpen = false;
      this.manualOpen = false;
      this.controlsOpen = id === TOP_CHROME_IDS.CONTROLS ? !this.controlsOpen : true;
      return;
    }

    if (id === TOP_CHROME_IDS.MENU) {
      this.host.audio.playButtonLatchLock(1.0, 0.85);
      this.cancelDrag();
      this.controlsOpen = false;
      this.manifestOpen = false;
      this.manualOpen = false;
      this.osdMenuOpen = !this.osdMenuOpen;
      return;
    }

    if (id === CONTROLS_CARD_IDS.CLOSE) {
      this.host.audio.playButtonLatchLock(0.96, 0.85);
      this.controlsOpen = false;
      return;
    }

    if (id === PAUSE_BANNER_IDS.RESUME) {
      this.host.audio.playButtonLatchLock(1.04, 0.85);
      this.sim.paused = false;
      return;
    }
    if (id === PAUSE_BANNER_IDS.CONTROLS) {
      this.host.audio.playButtonLatchLock(1.0, 0.85);
      this.controlsOpen = true;
      return;
    }
    if (id === PAUSE_BANNER_IDS.MENU) {
      this.host.audio.playButtonLatchLock(1.0, 0.85);
      this.osdMenuOpen = true;
      return;
    }

    if (id === POST_RUN_IDS.SUBMIT_SCORE) {
      if (this.sim.gameOverLockoutTimer > 0) return;
      this.host.audio.playButtonLatchLock(1.04, 0.9);
      void this.submitCurrentScore();
      return;
    }
    if (id === POST_RUN_IDS.OPEN_MANIFEST || id === APPROACH_UI_IDS.TITLE_LEADERBOARD) {
      if (id === POST_RUN_IDS.OPEN_MANIFEST && this.sim.gameOverLockoutTimer > 0) return;
      this.host.audio.playButtonLatchLock(1.0, 0.85);
      this.osdMenuOpen = false;
      this.controlsOpen = false;
      this.manualOpen = false;
      this.manifestOpen = true;
      return;
    }
    if (
      id === POST_RUN_IDS.PLAY_AGAIN ||
      id === POST_RUN_IDS.MANIFEST_PLAY_AGAIN ||
      id === APPROACH_UI_IDS.LAUNCH_SHIFT
    ) {
      if (id === POST_RUN_IDS.PLAY_AGAIN && this.sim.gameOverLockoutTimer > 0) return;
      this.host.audio.playButtonLatchLock(1.04, 0.9);
      this.startShift();
      return;
    }
    if (id === POST_RUN_IDS.GAME_MENU) {
      if (this.sim.phase === 'GAME_OVER' && !this.manifestOpen && this.sim.gameOverLockoutTimer > 0) {
        return;
      }
      this.host.audio.playButtonLatchLock(0.96, 0.88);
      this.returnToBriefingMenu(false);
      return;
    }
    if (id === POST_RUN_IDS.MANIFEST_CLOSE) {
      this.host.audio.playButtonLatchLock(0.96, 0.85);
      this.manifestOpen = false;
      return;
    }
    if (id === POST_RUN_IDS.EXIT_HUB) {
      if (this.sim.phase === 'GAME_OVER' && this.sim.gameOverLockoutTimer > 0) return;
      this.host.audio.playButtonLatchLock(0.9, 0.9);
      this.tutorial.stop(this.sim);
      this.host.setCrtModeLocked(false);
      this.host.exitToMuthurOs('EXITED BOREALIS APPROACH // LV-118 RAPCON RADAR STANDBY.');
    }
  }

  public updateAndRender(
    dt: number,
    ctx: CanvasRenderingContext2D,
    totalTimeSec: number
  ): CrtShaderFrameParams {
    const clampedDt = Math.min(0.1, Math.max(0, dt));

    if (this.glitchIntensity > 0) {
      this.glitchIntensity = Math.max(0, this.glitchIntensity - clampedDt * 1.7);
    }

    if (this.confirmExitPending) {
      this.confirmExitTimer -= clampedDt;
      if (this.confirmExitTimer <= 0) {
        this.confirmExitPending = false;
        this.confirmExitTimer = 0;
      }
    }
    if (this.confirmGameMenuPending) {
      this.confirmGameMenuTimer -= clampedDt;
      if (this.confirmGameMenuTimer <= 0) {
        this.confirmGameMenuPending = false;
        this.confirmGameMenuTimer = 0;
      }
    }

    if (this.statusToast) {
      this.statusToast.timer -= clampedDt;
      if (this.statusToast.timer <= 0) {
        this.statusToast = null;
      }
    }

    const layout = this.getCurrentLayout();
    const proj = this.syncAirspaceBounds(layout);

    const simActive =
      !this.osdMenuOpen && !this.manifestOpen && !this.controlsOpen && !this.manualOpen;
    if (simActive) {
      if (this.sim.phase === 'ACTIVE_SHIFT' && !this.sim.paused && !this.sim.trainingMode) {
        this.runPlaytimeSec += clampedDt;
      }
      this.sim.update(clampedDt);
      if (!this.sim.paused) {
        this.tutorial.update(this.sim, clampedDt);
      }
    }

    // Clear stale craft selection/drag if the craft landed or was cleared in a mishap
    if (this.selectedCraftId !== null && !this.sim.getAircraftById(this.selectedCraftId)) {
      this.selectedCraftId = null;
    }
    if (this.draggingCraftId !== null) {
      const dragged = this.sim.getAircraftById(this.draggingCraftId);
      if (!dragged || dragged.state === 'LANDING' || this.sim.phase !== 'ACTIVE_SHIFT') {
        this.cancelDrag();
      }
    }

    if (this.sim.sealBreachFlashTimer > 0.6) {
      this.glitchIntensity = Math.max(this.glitchIntensity, 0.55);
    }

    const anyModalOpen = this.isAnyModalOverlayOpen();
    this.host.setModalOpen(anyModalOpen);

    // Universal gameplay CRT mode lock: locks BOTH ON and OFF during ACTIVE_SHIFT, unlocks on TITLE or GAME_OVER!
    const crtModeLocked = this.sim.phase === 'ACTIVE_SHIFT';
    this.host.setCrtModeLocked(crtModeLocked);

    // Continuous RAPCON HVAC bunker ambience + escalating TCAS Conflict Alert tone
    const liveShiftAudio =
      simActive &&
      this.sim.phase === 'ACTIVE_SHIFT' &&
      !this.sim.paused &&
      !this.tutorial.isGraduated();
    this.approachAudio.updateAmbience(liveShiftAudio, this.sim.conflictActive, clampedDt);
    this.approachAudio.updateConflictAlertTone(
      liveShiftAudio && this.sim.conflictActive,
      this.sim.minSeparationNm,
      clampedDt
    );

    // Live 254.30 MHz VHF/UHF Radio Oscilloscope telemetry
    const radioLevel = this.approachAudio.getRadioOscilloscopeSamples(this.radioOscSamples);
    const radioTransmitting = this.approachAudio.isRadioTransmitting();
    const atcMuted = this.approachAudio.isAtcMuted();
    const conflictToneActive = this.approachAudio.isConflictToneActive();
    const activeTransmission = this.approachAudio.getActiveTransmission();
    const tutorialState = this.tutorial.getOverlayState(this.sim);

    // Program #5 Gameplay Music (`approach-and-trench.mp3`) — strictly during live shift gameplay,
    // smoothly fading out on Pause/Modals/Briefing/Debrief and ducking ~28% under audible VHF radio
    // (skipped when ATC is muted) or active Conflict Alert alarms.
    this.host.music.setGameplayMusicActive(liveShiftAudio, 'approach', {
      fadeInSec: 0.5,
      fadeOutSec: 0.75,
    });
    this.host.music.setVhfDuck(
      liveShiftAudio && ((!atcMuted && radioTransmitting) || conflictToneActive)
    );

    ctx.fillStyle = '#030805';
    ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    // 1. Render Expanded Full-Rectangular 1979 PPI Radar Scope
    const dragState: ApproachDragVisualState | null =
      this.draggingCraftId !== null
        ? {
            craftId: this.draggingCraftId,
            rawWaypointsNm: this.dragWaypointsNm,
            preview: this.dragPreview,
            cursorNm: this.cursorNm,
          }
        : null;

    this.scopeRenderer.render(ctx, {
      sim: this.sim,
      viewport: layout.scopeViewport,
      timeSec: totalTimeSec,
      hoveredCraftId: this.hoveredCraftId,
      selectedCraftId: this.selectedCraftId,
      dragState,
      cursorNm: this.cursorNm,
      cursorInsideScope: this.cursorInsideScope && !anyModalOpen,
      tutorialState,
    });

    // 2. Render 3-Column 1979 RAPCON HUD, Top Chrome Bar, Controls Strip, Tutorial & Shared Modals
    const toastAlpha = this.statusToast
      ? Math.min(1, this.statusToast.timer / Math.min(0.28, this.statusToast.duration))
      : 0;

    this.hudRenderer.render(
      ctx,
      {
        width: this.viewportWidth,
        height: this.viewportHeight,
        timeSec: totalTimeSec,
        sim: this.sim,
        leaderboard: this.leaderboard,
        hoveredButtonId: this.hoveredButtonId,
        selectedCraftId: this.selectedCraftId,
        hoveredCraftId: this.hoveredCraftId,
        audioMuted: this.host.isMuted(),
        musicEnabled: this.host.isMusicEnabled(),
        atcMuted,
        masterVolume: this.host.getMasterVolume(),
        crtPreset: this.host.getCrtPreset(),
        crtModeLocked,
        phosphorTheme: this.host.getPhosphorTheme(),
        isFullscreen: this.host.getViewport().isFullscreen,
        confirmExitPending: this.confirmExitPending,
        confirmGameMenuPending: this.confirmGameMenuPending,
        osdMenuOpen: this.osdMenuOpen,
        manifestOpen: this.manifestOpen,
        controlsOpen: this.controlsOpen,
        manualOpen: this.manualOpen,
        manualTab: this.manualTab,
        radioWaveform: this.radioOscSamples,
        radioLevel,
        radioTransmitting,
        activeTransmission,
        callsignDraft: this.callsignDraft,
        callsignEditing: this.callsignEditing,
        scoreSubmitted: this.scoreSubmitted,
        submittingScore: this.submittingScore,
        submitResultBanner: this.submitResultBanner,
        submitResultTone: this.submitResultTone,
        lastSubmittedRun: this.lastSubmittedRun,
        statusToast: this.statusToast
          ? { text: this.statusToast.text, tone: this.statusToast.tone, alpha: toastAlpha }
          : null,
        tutorialState,
        isFirstVisit: this.tutorial.isFirstVisit(),
      },
      layout
    );

    // 3. Map active RAPCON shockwaves (touchdowns, Fumes Saves, MAYDAY spawns, ICC seal breaches)
    const shockwaves: CrtShockwaveUniform[] = [];
    for (const sw of this.sim.crtShockwaves) {
      const p = Math.max(0, Math.min(1, sw.age / Math.max(0.01, sw.duration)));
      const peak =
        sw.tone === 'red'
          ? 0.52
          : sw.tone === 'gold'
            ? 0.38
            : sw.tone === 'amber'
              ? 0.34
              : 0.22;
      const intensity = peak * Math.pow(1 - p, 1.45);
      if (intensity <= 0.005) continue;
      const screenPt = nmToScreen(sw.x, sw.y, layout.scopeViewport);
      const maxRadPx = sw.maxRadiusNm * proj.pxPerNm;
      shockwaves.push({
        uvX: screenPt.x / Math.max(1, this.viewportWidth),
        uvY: screenPt.y / Math.max(1, this.viewportHeight),
        radius: (maxRadPx / Math.max(1, this.viewportHeight)) * Math.pow(p, 0.55),
        intensity,
      });
    }

    const stormInterference = this.sim.storms.length > 0 ? 0.012 : 0;
    const breachInterference = this.sim.sealBreachFlashTimer > 0 ? 0.32 : 0;
    const conflictInterference = this.sim.conflictActive ? 0.045 : 0;

    return {
      interference: Math.min(
        0.75,
        0.014 + stormInterference + breachInterference + conflictInterference
      ),
      glitch: this.glitchIntensity,
      overdrive:
        this.sim.sealBreachFlashTimer > 0
          ? 0.56
          : this.sim.conflictActive
            ? 0.24
            : 0,
      tubeTurnOn: 0,
      shockwaves,
      modalActive: anyModalOpen || this.sim.phase === 'TITLE',
      chromaScale: anyModalOpen || this.sim.phase === 'TITLE' ? 0.06 : 0.22,
    };
  }
}

export { BorealisApproachCartridge as ApproachCartridge };
