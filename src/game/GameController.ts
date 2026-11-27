import { AudioEngine } from '../audio/AudioEngine';
import { PHYSICS, VOICE_TRANSCRIPTS } from '../constants';
import { SectorGenerator } from '../levels/SectorGenerator';
import { PhysicsEngine } from '../physics/PhysicsEngine';
import { BOOT_TIMING } from '../render/BootLogoRenderer';
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
import { BOOT_LINES, HudRenderer } from '../render/HudRenderer';
import { MobileHudRenderer, type MobileActiveTouchState } from '../render/MobileHudRenderer';
import { WebGLCRT } from '../render/WebGLCRT';
import { WorldRenderer, type CameraView } from '../render/WorldRenderer';
import {
  CALLSIGN_CHAR_REGEX,
  CALLSIGN_MAX_LEN,
  sanitizeCallsignDraft,
} from '../services/callsignGuard';
import {
  GlobalLeaderboardService,
  accuracyToGrade,
  formatSectorCode,
} from '../services/leaderboard';
import type { Cartridge, CrtShaderFrameParams, HostEnvironment } from '../shell/Cartridge';
import type {
  BezelState,
  GamePhase,
  LanderState,
  LandingEvaluation,
  LandingGrade,
  LandingPad,
  LastSubmittedRun,
  LeaderboardMode,
  MenuModeSelection,
  SafeAreaInsets,
  SectorConfig,
  SectorScoreBreakdown,
  TouchdownSnapshot,
  Vec2,
  ViewportRect,
  VoiceCalloutId,
} from '../types';

export class GameController implements Cartridge {
  public readonly id = 'lander';
  private host: HostEnvironment;
  private srLiveRegion: HTMLElement | null;

  private audio: AudioEngine;
  private leaderboard = new GlobalLeaderboardService();
  private physics = new PhysicsEngine();
  private webglCrt: WebGLCRT;
  private worldRenderer = new WorldRenderer();
  private hudRenderer = new HudRenderer();
  private listenerAbort: AbortController | null = null;

  private viewportWidth = 1280;
  private viewportHeight = 800;
  private crtRect: ViewportRect = { x: 0, y: 0, width: 1280, height: 800 };

  private phase: GamePhase = 'TITLE_MENU';
  private sector: SectorConfig;
  private lander: LanderState;

  private bezelState: BezelState = {
    sasEnabled: false,
    autoZoomEnabled: true,
    crtIntensity: 0,
    audioMuted: false,
    flightLogsOpen: false,
    osdMenuOpen: false,
  };

  // Shared Chrome, Safety Interlocks & Golden-Path Post-Run State
  private controlsCardOpen = false;
  private confirmExitPending = false;
  private confirmExitTimer = 0;
  private hasSeenInitialBriefing = false;
  private inlineTeletypeHold = false;
  private pulseSafetyLockSec = 0;
  private debriefKeylockSec = 0;
  private debriefOutcome: 'BREACH' | 'VICTORY' | 'ABORT' = 'BREACH';
  private callsignEditing = false;
  private manifestOpenedPostRun = false;
  private mobileModeOverride: boolean | null = null;
  private mobileRadarHintShown = false;
  private mobileRadarHintTimer = 0;
  private statusBannerTone: 'green' | 'amber' | 'red' | 'cyan' = 'amber';

  // Campaign / Deep-Survey 3-Lives Progression & Global Leaderboard State
  private readonly maxLives = 3;
  private lives = 3;
  private lifeLostFlashTimer = 0;
  private isPracticeRun = false;
  private endlessMode = false;
  private endlessDepth = 1;
  private endlessSeed = 203779;
  private selectedMenuMode: MenuModeSelection = 'RANKED_CAMPAIGN';
  private selectedStartSector = 1;
  private mobileMode = false;
  private isFullscreen = false;
  private canvasOffsetX = 0;
  private canvasOffsetY = 0;
  private safeAreaInsets: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private activeTouchPointers = new Map<number, string>();
  private gameEmergencyPulseAvailable = true;
  private missionScore = 0;
  private displayedScore = 0;
  private dropStreak = 0;
  private highestSectorNum = 1;
  private highestSectorCode = 'SEC-01';
  private accuracySamples: number[] = [];

  private lastBreakdown: SectorScoreBreakdown | null = null;
  private lastFailure: LandingEvaluation | null = null;
  private touchdownSnapshot: TouchdownSnapshot | null = null;
  private tallyAnimProgress = 0;
  private callsignDraft = 'PILOT-01';
  private runPlaytimeSec = 0;
  private manifestTab: LeaderboardMode = 'CAMPAIGN';
  private scoreSubmittedForRun = false;
  private lastSubmittedRun: LastSubmittedRun | null = null;
  private uplinkSubmitState: 'IDLE' | 'TRANSMITTING' | 'CONFIRMED' | 'OFFLINE_SAVED' = 'IDLE';
  private uplinkConfirmText: string | null = null;
  private sessionLogs: string[] = [
    'INTERFACE 2037 INITIALIZED // ORBITAL BUS ONLINE',
    'AWAITING PILOT DROP TELEMETRY DIRECTIVE',
  ];

  // Typewriter & 1979 Alien Awakening State
  private bootPoweredOn = false;
  private bootElapsedSec = 0;
  private bootModeSwitchPlayed = false;
  private crtWarmupProgress = 0;
  private bootProgressChars = 0;
  private bootTransitionPlayed = false;
  private briefingProgressChars = 0;
  private ambientChirpTimer = 26.0;
  private activeCalloutText: string | null = null;
  private activeCalloutTimer = 0;
  private statusBannerText: string | null = null;
  private statusBannerTimer = 0;
  private menuCursor = 0;

  // Per-sector extreme Airbus GPWS cooldowns, motion tracker, muted warning indicator & ignition edge
  private sectorElapsedSec = 0;
  private proximityVoiceCooldown = 0;
  private bankAngleVoiceCooldown = 0;
  private driftVoiceCooldown = 0;
  private avionicsBeepTimer = 0;
  private hadActiveAvionicsWarning = false;
  private motionPingTimer = 0;
  private wasMainEngineLit = false;

  // Camera & CRT Glitch FX
  private manualZoom = 1.15;
  private currentZoom = 1.15;
  private cameraPos: Vec2 = { x: 210, y: 130 };
  private glitchIntensity = 0;

  // Input Tracking
  private keysDown = new Set<string>();
  private pointerClient: Vec2 = { x: 540, y: 360 };
  private pointerInsideCrt = true;
  private cursorCrtPx: Vec2 = { x: 540, y: 360 };
  private cursorWorld: Vec2 = { x: 210, y: 130 };
  private hoveredHudButtonId: string | null = null;

  private simAccumulator = 0;
  private totalTimeSec = 0;

  constructor(host: HostEnvironment) {
    this.host = host;
    this.audio = host.audio;
    this.webglCrt = host.webglCrt;
    this.srLiveRegion = host.srLiveRegion;

    this.sector = SectorGenerator.createCampaignSector(1);
    this.lander = this.physics.createInitialLander(this.sector);
    this.cameraPos = { ...this.lander.pos };
    const savedSign = this.leaderboard.getSavedCallsign();
    if (savedSign) {
      this.callsignDraft = savedSign;
    }
  }

  public mount(): void {
    this.unmount();
    this.listenerAbort = new AbortController();
    const signal = this.listenerAbort.signal;

    const vp = this.host.getViewport();
    // Respect host.isTouchDevice() auto-mobile mode unless pilot explicitly toggled layout
    this.mobileMode =
      this.mobileModeOverride ??
      (vp.mobileMode || (this.host.isTouchDevice() && vp.width < 900));
    this.isFullscreen = vp.isFullscreen;
    this.safeAreaInsets = { ...vp.safeAreaInsets };
    this.bezelState.crtIntensity = this.host.getCrtIntensity();
    this.bezelState.audioMuted = this.host.isMuted();
    this.bezelState.osdMenuOpen = false;
    this.bezelState.flightLogsOpen = false;
    this.controlsCardOpen = false;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.callsignEditing = false;
    this.debriefKeylockSec = 0;
    this.pulseSafetyLockSec = 0;
    this.inlineTeletypeHold = false;
    this.manifestOpenedPostRun = false;
    this.bootPoweredOn = true;
    this.crtWarmupProgress = 1;
    this.phase = 'TITLE_MENU';
    this.menuCursor = 0;
    this.manualZoom = this.mobileMode ? 2.15 : 1.15;
    this.currentZoom = this.manualZoom;
    this.keysDown.clear();
    this.activeTouchPointers.clear();
    this.hoveredHudButtonId = null;
    this.host.setModalOpen(false);

    this.resize(vp.width, vp.height, vp.offsetX, vp.offsetY);
    this.bindInputListeners(signal);
    this.bindMobileCallsignAndFullscreen(signal);
  }

  public unmount(): void {
    if (this.listenerAbort) {
      this.listenerAbort.abort();
      this.listenerAbort = null;
    }
    this.keysDown.clear();
    this.activeTouchPointers.clear();
    this.hoveredHudButtonId = null;
    this.bezelState.osdMenuOpen = false;
    this.bezelState.flightLogsOpen = false;
    this.controlsCardOpen = false;
    this.confirmExitPending = false;
    this.callsignEditing = false;
    this.host.setModalOpen(false);
    document.body.style.cursor = 'default';
    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (mobileInput && document.activeElement === mobileInput) {
      mobileInput.blur();
    }
    this.audio.stopCartridgeLoops();
  }

  public resize(widthCss: number, heightCss: number, offsetX = 0, offsetY = 0): void {
    this.viewportWidth = Math.max(320, widthCss);
    this.viewportHeight = Math.max(240, heightCss);
    this.canvasOffsetX = offsetX;
    this.canvasOffsetY = offsetY;
    this.crtRect = { x: 0, y: 0, width: this.viewportWidth, height: this.viewportHeight };
    if (this.mobileModeOverride === null) {
      const vp = this.host.getViewport();
      this.mobileMode = vp.mobileMode || (this.host.isTouchDevice() && this.viewportWidth < 900);
    }
    this.readSafeAreaInsets();
  }

  private readSafeAreaInsets(): void {
    const probe = document.getElementById('safe-area-probe');
    if (!probe) return;
    const cs = window.getComputedStyle(probe);
    this.safeAreaInsets = {
      top: Number.parseFloat(cs.top) || 0,
      right: Number.parseFloat(cs.right) || 0,
      bottom: Number.parseFloat(cs.bottom) || 0,
      left: Number.parseFloat(cs.left) || 0,
    };
  }

  private isInUnifiedDebrief(): boolean {
    return (
      this.phase === 'CALLSIGN_ENTRY' ||
      this.phase === 'CAMPAIGN_COMPLETE' ||
      (this.phase === 'HULL_BREACH' && this.lives <= 0)
    );
  }

  private canSubmitRankedScore(): boolean {
    return !this.isPracticeRun && this.missionScore > 0;
  }

  private isInActiveRankedFlight(): boolean {
    return (
      !this.isPracticeRun &&
      (this.phase === 'FLIGHT' ||
        this.phase === 'PAUSED' ||
        this.phase === 'SECTOR_BRIEFING' ||
        this.phase === 'SECTOR_TALLY' ||
        (this.phase === 'HULL_BREACH' && this.lives > 0))
    );
  }

  private isInMidRunPeek(): boolean {
    return (
      !this.manifestOpenedPostRun &&
      (this.phase === 'FLIGHT' ||
        this.phase === 'PAUSED' ||
        this.phase === 'SECTOR_BRIEFING' ||
        this.phase === 'SECTOR_TALLY')
    );
  }

  private bindMobileCallsignAndFullscreen(signal: AbortSignal): void {
    const syncFs = () => {
      const docAny = document as Document & { webkitFullscreenElement?: Element | null };
      this.isFullscreen = Boolean(document.fullscreenElement || docAny.webkitFullscreenElement);
      this.readSafeAreaInsets();
    };
    document.addEventListener('fullscreenchange', syncFs, { signal });
    document.addEventListener('webkitfullscreenchange', syncFs, { signal });

    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (mobileInput) {
      mobileInput.addEventListener(
        'input',
        () => {
          if (this.isInUnifiedDebrief()) {
            this.callsignDraft = sanitizeCallsignDraft(mobileInput.value);
            mobileInput.value = this.callsignDraft;
            this.uplinkConfirmText = null;
          }
        },
        { signal }
      );
      mobileInput.addEventListener(
        'keydown',
        (ev) => {
          if (ev.key === 'Enter' && this.isInUnifiedDebrief()) {
            ev.preventDefault();
            mobileInput.blur();
            this.callsignEditing = false;
            this.audio.playButtonLatchLock();
            if (this.debriefKeylockSec <= 0) {
              void this.submitCallsign();
            }
          }
        },
        { signal }
      );
      mobileInput.addEventListener(
        'blur',
        () => {
          if (this.mobileMode) {
            this.callsignEditing = false;
          }
        },
        { signal }
      );
    }
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

  private toggleFullscreen(): void {
    this.host.toggleFullscreen();
    this.isFullscreen = this.host.getViewport().isFullscreen;
  }

  private getMobileTouchState(): MobileActiveTouchState {
    let thrust = false;
    let overdrive = false;
    let rollLeft = false;
    let rollRight = false;
    let retro = false;
    for (const ctrlId of this.activeTouchPointers.values()) {
      if (ctrlId === 'touch-thrust') thrust = true;
      else if (ctrlId === 'touch-overdrive') {
        thrust = true;
        overdrive = true;
      } else if (ctrlId === 'touch-roll-left') rollLeft = true;
      else if (ctrlId === 'touch-roll-right') rollRight = true;
      else if (ctrlId === 'touch-retro') retro = true;
    }
    return { thrust, overdrive, rollLeft, rollRight, retro };
  }

  private hitTestTouchControls(cx: number, cy: number): string | null {
    return hitTestChromeButtons(this.hudRenderer.touchControls, cx, cy);
  }

  public setBackgroundPaused(paused: boolean): void {
    this.audio.suspendForBackground(paused);
    if (paused) {
      this.keysDown.clear();
      this.activeTouchPointers.clear();
    }
  }

  private announceSr(message: string): void {
    if (this.srLiveRegion) {
      this.srLiveRegion.textContent = message;
    }
  }

  private logEvent(entry: string): void {
    this.sessionLogs.push(entry);
    if (this.sessionLogs.length > 20) {
      this.sessionLogs.shift();
    }
  }

  private triggerVoice(id: VoiceCalloutId, force = false): void {
    this.audio.playVoiceCallout(id, force);
    this.activeCalloutText = VOICE_TRANSCRIPTS[id] ?? id;
    this.activeCalloutTimer = 4.2;
    this.announceSr(this.activeCalloutText);
  }

  private showStatusToast(
    text: string,
    duration = 2.0,
    tone: 'green' | 'amber' | 'red' | 'cyan' = 'amber'
  ): void {
    this.statusBannerText = text;
    this.statusBannerTimer = duration;
    this.statusBannerTone = tone;
  }

  private toggleAudioMute(): void {
    const next = !this.host.isMuted();
    this.host.setMuted(next);
    this.bezelState.audioMuted = next;
    if (!next) {
      this.audio.playButtonLatchLock(1.0, 0.85);
    }
    this.showStatusToast(next ? 'AUDIO BUS: MUTED' : 'AUDIO BUS: ACTIVE', 1.2, next ? 'red' : 'green');
  }

  private requestExitToHub(): void {
    if (this.isInActiveRankedFlight() && !this.confirmExitPending) {
      this.confirmExitPending = true;
      this.confirmExitTimer = 4.0;
      this.showStatusToast('CLICK [CONFIRM EXIT?] AGAIN TO ABORT RUN TO MU-TH-UR OS', 2.4, 'red');
      return;
    }
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.bezelState.osdMenuOpen = false;
    this.bezelState.flightLogsOpen = false;
    this.controlsCardOpen = false;
    this.host.setModalOpen(false);
    this.host.exitToMuthurOs('TERMINATED PROGRAM 01 // LV-426 LUNAR LANDER.');
  }

  private getSystemMenuCallbacks(): SystemMenuActionCallbacks {
    return {
      onResume: () => {
        this.bezelState.osdMenuOpen = false;
        this.confirmExitPending = false;
        if (this.phase === 'PAUSED') {
          this.phase = 'FLIGHT';
        }
      },
      onRestart: () => {
        this.bezelState.osdMenuOpen = false;
        this.confirmExitPending = false;
        this.playAgainImmediate();
      },
      onOpenLeaderboard: () => {
        this.bezelState.osdMenuOpen = false;
        this.controlsCardOpen = false;
        this.confirmExitPending = false;
        this.manifestOpenedPostRun = this.isInUnifiedDebrief();
        this.bezelState.flightLogsOpen = true;
      },
      onExitToHub: () => {
        this.requestExitToHub();
      },
      onExtraAction: (id: string) => {
        this.handleLanderExtraAction(id);
      },
    };
  }

  private handleLanderExtraAction(id: string): void {
    switch (id) {
      case 'lander-sas-toggle':
        this.audio.playButtonLatchLock(0.96, 0.9);
        this.bezelState.sasEnabled = !this.bezelState.sasEnabled;
        this.showStatusToast(
          this.bezelState.sasEnabled
            ? 'SAS ON: 50% GENTLE ROLL ASSIST'
            : 'SAS OFF: 100% RAW RCS TORQUE',
          1.8,
          this.bezelState.sasEnabled ? 'green' : 'amber'
        );
        break;
      case 'lander-zoom-toggle':
        this.audio.playButtonLatchLock(0.96, 0.9);
        this.bezelState.autoZoomEnabled = !this.bezelState.autoZoomEnabled;
        this.showStatusToast(
          `AUTO-ZOOM APPROACH: ${this.bezelState.autoZoomEnabled ? 'ENGAGED' : 'MANUAL ONLY'}`,
          1.8,
          this.bezelState.autoZoomEnabled ? 'green' : 'amber'
        );
        break;
      case 'lander-jettison':
        this.bezelState.osdMenuOpen = false;
        this.confirmExitPending = false;
        this.manualJettisonAndRedeploy();
        break;
      case 'menu-toggle-mobile':
        this.bezelState.osdMenuOpen = false;
        this.mobileMode = !this.mobileMode;
        this.mobileModeOverride = this.mobileMode;
        this.activeTouchPointers.clear();
        this.manualZoom = this.mobileMode ? 2.15 : 1.15;
        this.currentZoom = this.manualZoom;
        this.showStatusToast(
          this.mobileMode ? 'TOUCH FLIGHT DECK ACTIVE' : 'DESKTOP FLIGHT CONSOLE ACTIVE',
          1.8,
          'cyan'
        );
        break;
    }
  }

  private awakenMotherIfDormant(asMobile = false): boolean {
    if (this.bootPoweredOn) {
      void this.audio.unlock();
      return false;
    }
    this.mobileMode = asMobile;
    this.mobileModeOverride = asMobile;
    this.bezelState.sasEnabled = false;
    if (asMobile) {
      this.manualZoom = 2.15;
      this.currentZoom = 2.15;
    }
    this.bootPoweredOn = true;
    this.bootElapsedSec = 0;
    this.bootModeSwitchPlayed = false;
    this.crtWarmupProgress = 0.04;
    this.bootProgressChars = 0;
    this.bootTransitionPlayed = false;
    this.glitchIntensity = 0.88;
    void this.audio.unlock().then(() => {
      this.audio.playAlienBootAwakening();
    });
    return true;
  }

  private bindInputListeners(signal: AbortSignal): void {
    window.addEventListener(
      'keydown',
      (e) => {
        if (
          ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)
        ) {
          e.preventDefault();
        }

        if (this.phase === 'BOOT' && !this.bootPoweredOn) {
          this.awakenMotherIfDormant();
          return;
        }
        void this.audio.unlock();

        this.keysDown.add(e.code);
        this.handleKeyDown(e);
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
      'blur',
      () => {
        this.keysDown.clear();
        this.activeTouchPointers.clear();
      },
      { signal }
    );

    const releaseTouchPointer = (ev: PointerEvent) => {
      this.activeTouchPointers.delete(ev.pointerId);
    };
    window.addEventListener('pointerup', releaseTouchPointer, { signal });
    window.addEventListener('pointercancel', releaseTouchPointer, { signal });

    window.addEventListener(
      'pointermove',
      (e) => {
        this.pointerClient.x = e.clientX;
        this.pointerClient.y = e.clientY;

        const mapped = this.webglCrt.mapClientToCrtUv(
          e.clientX - this.canvasOffsetX,
          e.clientY - this.canvasOffsetY,
          this.crtRect,
          this.bezelState.crtIntensity
        );
        this.pointerInsideCrt = mapped.inside;
        const cx = mapped.u * this.crtRect.width;
        const cy = mapped.v * this.crtRect.height;

        if (this.activeTouchPointers.has(e.pointerId)) {
          const slidCtrl = this.hitTestTouchControls(cx, cy);
          if (slidCtrl) {
            this.activeTouchPointers.set(e.pointerId, slidCtrl);
          } else {
            this.activeTouchPointers.delete(e.pointerId);
          }
          return;
        }

        if (!this.mobileMode) {
          this.cursorCrtPx.x = cx;
          this.cursorCrtPx.y = cy;
          this.hoveredHudButtonId = this.hitTestHudButtons(cx, cy);
        }

        if (this.hoveredHudButtonId !== null) {
          document.body.style.cursor = 'pointer';
        } else if (
          !this.mobileMode &&
          this.pointerInsideCrt &&
          this.phase === 'FLIGHT' &&
          !this.bezelState.flightLogsOpen &&
          !this.bezelState.osdMenuOpen &&
          !this.controlsCardOpen
        ) {
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
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        const mapped = this.webglCrt.mapClientToCrtUv(
          e.clientX - this.canvasOffsetX,
          e.clientY - this.canvasOffsetY,
          this.crtRect,
          this.bezelState.crtIntensity
        );
        const cx = mapped.u * this.crtRect.width;
        const cy = mapped.v * this.crtRect.height;

        if (this.phase === 'BOOT' && !this.bootPoweredOn) {
          const dormantBtn = mapped.inside ? this.hitTestHudButtons(cx, cy) : null;
          this.awakenMotherIfDormant(dormantBtn === 'boot-awaken-mobile');
          return;
        }
        void this.audio.unlock();
        if (!mapped.inside) return;

        const anyOverlayOpen =
          this.bezelState.flightLogsOpen || this.bezelState.osdMenuOpen || this.controlsCardOpen;

        // Touch flight-deck hold controls (including immediate drop from inline 1-line hold!)
        if (
          this.mobileMode &&
          !anyOverlayOpen &&
          (this.phase === 'FLIGHT' ||
            (this.phase === 'SECTOR_BRIEFING' && this.inlineTeletypeHold))
        ) {
          const touchHold = this.hitTestTouchControls(cx, cy);
          if (touchHold) {
            if (this.phase === 'SECTOR_BRIEFING' && this.inlineTeletypeHold) {
              this.beginSectorFlight();
            }
            this.activeTouchPointers.set(e.pointerId, touchHold);
            return;
          }
        }

        const hudBtn = this.hitTestHudButtons(cx, cy);
        if (hudBtn) {
          this.audio.playButtonLatchLock(0.96, 0.96);
          this.handleHudButtonClick(hudBtn);
          return;
        }

        // Clicking outside callsign input box exits callsign typing cleanly
        if (this.callsignEditing) {
          this.callsignEditing = false;
        }

        // Clicking outside confirm-exit resets the latch
        if (this.confirmExitPending) {
          this.confirmExitPending = false;
          this.confirmExitTimer = 0;
        }

        if (this.phase === 'BOOT' && this.bootPoweredOn && this.bootElapsedSec >= 0.75) {
          this.audio.playButtonLatchLock(0.94, 0.95);
          this.advanceFromBoot();
          return;
        }

        if (
          this.phase === 'FLIGHT' &&
          !anyOverlayOpen &&
          this.lander.alive
        ) {
          if (this.mobileMode) {
            const corridor = MobileHudRenderer.getSafeCorridor(
              this.crtRect.width,
              this.crtRect.height,
              this.safeAreaInsets,
              this.isFullscreen
            );
            if (cy > corridor.bottomPx) return;
          }
          this.cursorCrtPx.x = cx;
          this.cursorCrtPx.y = cy;
          const cam = this.buildCameraView();
          this.cursorWorld = this.worldRenderer.screenToWorld(cam, cx, cy);
          this.lander.spotlightAngle = Math.atan2(
            this.cursorWorld.y - this.lander.pos.y,
            this.cursorWorld.x - this.lander.pos.x
          );

          if (this.physics.triggerDirectionalLidar(this.lander)) {
            this.mobileRadarHintTimer = 0; // Dismiss 1st-flight hint once pilot learns!
            const pan = (mapped.u - 0.5) * 0.8;
            this.audio.playButtonLatchLock(1.12, 0.55);
            this.audio.playSfx('lidar_ping', { pitch: 1.18, pan, volume: 0.92 });
          } else {
            this.audio.playButtonLatchLock(0.72, 0.65);
            this.showStatusToast('NO RADAR CELLS — RESERVE GEN CHARGING', 1.3, 'amber');
          }
        }
      },
      { signal }
    );

    window.addEventListener(
      'wheel',
      (e) => {
        if (
          this.pointerInsideCrt &&
          !this.bezelState.flightLogsOpen &&
          !this.bezelState.osdMenuOpen &&
          !this.controlsCardOpen
        ) {
          e.preventDefault();
          const zoomDelta = e.deltaY < 0 ? 0.22 : -0.22;
          this.manualZoom = Math.max(1.0, Math.min(3.5, this.manualZoom + zoomDelta));
        }
      },
      { passive: false, signal }
    );
  }

  private hitTestHudButtons(cx: number, cy: number): string | null {
    return hitTestChromeButtons(this.hudRenderer.buttons, cx, cy);
  }

  private handleHudButtonClick(id: string): void {
    // Reset exit confirmation latch if pilot clicks any non-HUB button
    if (id !== TOP_CHROME_IDS.HUB && id !== 'sys-exit-hub' && id !== POST_RUN_IDS.EXIT_HUB) {
      this.confirmExitPending = false;
      this.confirmExitTimer = 0;
    }

    // 1. Unified System Menu dispatcher when System Menu is open
    if (this.bezelState.osdMenuOpen) {
      // Mobile menu also hosts Controls Card button
      if (id === TOP_CHROME_IDS.CONTROLS) {
        this.bezelState.osdMenuOpen = false;
        this.controlsCardOpen = true;
        return;
      }
      if (handleSystemMenuAction(id, this.host, this.getSystemMenuCallbacks())) {
        this.bezelState.audioMuted = this.host.isMuted();
        this.isFullscreen = this.host.getViewport().isFullscreen;
        return;
      }
    }

    // 2. Shared TopChromeBar / ControlsCard / PauseBanner / PostRunFlow IDs
    if (id.startsWith(POST_RUN_IDS.MANIFEST_TAB_PREFIX)) {
      const tab = id.slice(POST_RUN_IDS.MANIFEST_TAB_PREFIX.length);
      if (tab === 'CAMPAIGN' || tab === 'ENDLESS') {
        this.manifestTab = tab;
      }
      return;
    }

    if (id.startsWith('menu-map-sec-')) {
      const n = Number.parseInt(id.replace('menu-map-sec-', ''), 10);
      if (n >= 1 && n <= SectorGenerator.CAMPAIGN_SECTOR_COUNT) {
        this.selectedMenuMode = 'PRACTICE';
        this.selectedStartSector = n;
        // Desktop flanking topo cards launch Practice in 1 click! (Mobile selects so small screens don't mis-tap)
        if (!this.mobileMode) {
          this.startCampaign(n, true);
        }
      }
      return;
    }

    switch (id) {
      case TOP_CHROME_IDS.CRT:
        this.host.toggle1979Crt();
        break;
      case TOP_CHROME_IDS.CONTROLS:
      case PAUSE_BANNER_IDS.CONTROLS:
        this.bezelState.osdMenuOpen = false;
        this.bezelState.flightLogsOpen = false;
        this.controlsCardOpen = !this.controlsCardOpen;
        break;
      case CONTROLS_CARD_IDS.CLOSE:
        this.controlsCardOpen = false;
        break;
      case TOP_CHROME_IDS.AUDIO:
        this.toggleAudioMute();
        break;
      case TOP_CHROME_IDS.MENU:
      case PAUSE_BANNER_IDS.MENU:
        this.controlsCardOpen = false;
        this.bezelState.flightLogsOpen = false;
        this.bezelState.osdMenuOpen = !this.bezelState.osdMenuOpen;
        break;
      case TOP_CHROME_IDS.HUB:
        this.requestExitToHub();
        break;
      case PAUSE_BANNER_IDS.RESUME:
        if (this.phase === 'PAUSED') {
          this.phase = 'FLIGHT';
        }
        break;

      // Post-Run Unified Debrief & Global Manifest Actions
      case POST_RUN_IDS.CALLSIGN_BOX:
        if (this.canSubmitRankedScore() && !this.scoreSubmittedForRun) {
          this.callsignEditing = true;
          if (this.mobileMode) {
            this.focusMobileCallsignInput();
          }
        }
        break;
      case POST_RUN_IDS.SUBMIT_SCORE:
        if (this.debriefKeylockSec <= 0) {
          this.callsignEditing = false;
          void this.submitCallsign();
        }
        break;
      case POST_RUN_IDS.OPEN_MANIFEST:
        if (this.debriefKeylockSec <= 0) {
          this.finishCallsignUplink();
        }
        break;
      case POST_RUN_IDS.PLAY_AGAIN:
        if (this.debriefKeylockSec <= 0) {
          this.playAgainImmediate();
        }
        break;
      case POST_RUN_IDS.EXIT_HUB:
        if (this.debriefKeylockSec <= 0) {
          this.confirmExitPending = false;
          this.host.setModalOpen(false);
          this.host.exitToMuthurOs('TERMINATED PROGRAM 01 // LV-426 LUNAR LANDER.');
        }
        break;
      case POST_RUN_IDS.MANIFEST_PLAY_AGAIN:
        this.bezelState.flightLogsOpen = false;
        this.playAgainImmediate();
        break;
      case POST_RUN_IDS.MANIFEST_CLOSE:
        this.bezelState.flightLogsOpen = false;
        break;

      // Lander-Specific & Mobile Controls
      case 'hud-fullscreen-toggle':
        this.toggleFullscreen();
        break;
      case 'lander-sas-toggle':
      case 'lander-zoom-toggle':
      case 'lander-jettison':
      case 'menu-toggle-mobile':
        this.handleLanderExtraAction(id);
        break;
      case 'touch-pulse':
        this.tryFireEmergencyPulse();
        break;
      case 'callsign-backspace':
        this.callsignDraft = this.callsignDraft.slice(0, -1);
        this.uplinkConfirmText = null;
        break;
      case 'hud-logs-toggle':
      case 'menu-logs':
        this.bezelState.osdMenuOpen = false;
        this.controlsCardOpen = false;
        this.manifestOpenedPostRun = false;
        this.bezelState.flightLogsOpen = !this.bezelState.flightLogsOpen;
        break;
      case 'boot-awaken':
        this.awakenMotherIfDormant(false);
        break;
      case 'boot-awaken-mobile':
        this.awakenMotherIfDormant(true);
        break;
      case 'boot-continue':
        this.advanceFromBoot();
        break;
      case 'menu-select-ranked':
        this.selectedMenuMode = 'RANKED_CAMPAIGN';
        if (!this.mobileMode) {
          this.startCampaign(1, false);
        }
        break;
      case 'menu-select-practice':
        this.selectedMenuMode = 'PRACTICE';
        if (!this.mobileMode) {
          this.startCampaign(this.selectedStartSector, true);
        }
        break;
      case 'menu-select-endless':
        this.selectedMenuMode = 'ENDLESS';
        if (!this.mobileMode) {
          this.startEndlessDeepSurvey();
        }
        break;
      case 'menu-commit':
        this.launchSelectedMenuMode();
        break;
      case 'briefing-launch':
        this.beginSectorFlight();
        break;
      case 'tally-retry':
        this.retryPracticeSector();
        break;
      case 'tally-next':
        this.advanceAfterTally();
        break;
      case 'breach-retry':
        if (this.lives > 0) {
          this.redeployAfterCrash();
        }
        break;
      case 'breach-end':
        this.enterUnifiedDebrief('ABORT');
        break;
    }
  }

  private tryFireEmergencyPulse(): void {
    if (this.phase !== 'FLIGHT' || !this.lander.alive) return;
    if (this.pulseSafetyLockSec > 0) {
      this.audio.playButtonLatchLock(0.82, 0.45);
      this.showStatusToast('PULSE FLIP-COVER ARMING — STANDBY', 0.9, 'amber');
      return;
    }
    if (this.physics.triggerEmergencyThrustPulse(this.lander)) {
      this.gameEmergencyPulseAvailable = false;
      this.audio.playButtonLatchLock(1.06, 0.72);
      this.audio.playEmergencyThrustPulse();
      this.glitchIntensity = Math.max(this.glitchIntensity, 0.55);
      this.showStatusToast('!! 1X GAME EMERGENCY PULSE FIRED !!', 2.2, 'amber');
      this.logEvent(`1X GAME EMERGENCY PULSE FIRED ON ${this.sector.code}`);
    } else {
      this.audio.playButtonLatchLock(0.72, 0.65);
      this.showStatusToast('1X GAME PULSE ALREADY EXPENDED', 1.4, 'red');
    }
  }

  private launchSelectedMenuMode(isReplay = false): void {
    if (this.selectedMenuMode === 'RANKED_CAMPAIGN') {
      this.startCampaign(1, false, isReplay);
    } else if (this.selectedMenuMode === 'PRACTICE') {
      this.startCampaign(this.selectedStartSector, true, isReplay);
    } else {
      this.startEndlessDeepSurvey(isReplay);
    }
  }

  private playAgainImmediate(): void {
    this.bezelState.flightLogsOpen = false;
    this.bezelState.osdMenuOpen = false;
    this.controlsCardOpen = false;
    this.confirmExitPending = false;
    this.callsignEditing = false;
    this.manifestOpenedPostRun = false;
    this.hasSeenInitialBriefing = true;

    if (this.phase === 'TITLE_MENU') {
      this.launchSelectedMenuMode(true);
      return;
    }
    if (this.endlessMode) {
      this.startEndlessDeepSurvey(true);
    } else if (this.isPracticeRun) {
      this.startCampaign(this.selectedStartSector, true, true);
    } else {
      this.startCampaign(1, false, true);
    }
  }

  private retryPracticeSector(): void {
    this.hasSeenInitialBriefing = true;
    this.startCampaign(this.selectedStartSector, true, true);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const anyTopModal =
      this.bezelState.osdMenuOpen || this.controlsCardOpen || this.bezelState.flightLogsOpen;

    // 1. Opt-in Callsign Typing Mode inside Unified Debrief (blocks [R]/[M]/[P]/[H] collisions!)
    if (this.isInUnifiedDebrief() && this.callsignEditing && !anyTopModal) {
      if (this.uplinkSubmitState === 'TRANSMITTING') {
        return;
      }
      if (e.code === 'Escape') {
        this.audio.playButtonLatchLock(0.9, 0.85);
        this.callsignEditing = false;
      } else if (e.code === 'Backspace') {
        this.callsignDraft = this.callsignDraft.slice(0, -1);
        this.uplinkConfirmText = null;
        this.audio.playSfx('ui_keyclick', { pitch: 0.9 });
      } else if (e.code === 'Enter') {
        this.callsignEditing = false;
        this.audio.playButtonLatchLock();
        if (this.debriefKeylockSec <= 0 && !this.scoreSubmittedForRun) {
          void this.submitCallsign();
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (CALLSIGN_CHAR_REGEX.test(e.key) && this.callsignDraft.length < CALLSIGN_MAX_LEN) {
          this.callsignDraft += e.key.toUpperCase();
          this.uplinkConfirmText = null;
          this.audio.playSfx('ui_keyclick', { pitch: 1.06 });
        }
      }
      return;
    }

    // 2. Unified System Menu open -> delegate to shared handleSystemMenuKey ([ESC], [M], [1-4])
    if (this.bezelState.osdMenuOpen) {
      if (handleSystemMenuKey(e, this.host, this.getSystemMenuCallbacks())) {
        this.bezelState.audioMuted = this.host.isMuted();
        if (e.code === 'KeyM') {
          this.showStatusToast(
            this.bezelState.audioMuted ? 'AUDIO BUS: MUTED' : 'AUDIO BUS: ACTIVE',
            1.2,
            this.bezelState.audioMuted ? 'red' : 'green'
          );
        }
      }
      return;
    }

    // 3. Universal [M] Mute (outside typing & System Menu)
    if (this.phase !== 'BOOT' && e.code === 'KeyM' && !e.repeat) {
      this.toggleAudioMute();
      return;
    }

    // 4. Controls Quick-Card open
    if (this.controlsCardOpen) {
      if ((e.code === 'Escape' || e.code === 'KeyH' || e.key === '?') && !e.repeat) {
        this.audio.playButtonLatchLock(0.95, 0.9);
        this.controlsCardOpen = false;
      }
      return;
    }

    // 5. Global Manifest Modal open (supports [TAB] switch, [R]/[ENTER] instant replay, [ESC] close!)
    if (this.bezelState.flightLogsOpen) {
      if (e.code === 'Escape' && !e.repeat) {
        this.audio.playButtonLatchLock(0.95, 0.9);
        this.bezelState.flightLogsOpen = false;
      } else if (
        (e.code === 'Tab' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') &&
        !e.repeat
      ) {
        this.audio.playSfx('ui_keyclick');
        this.manifestTab = this.manifestTab === 'CAMPAIGN' ? 'ENDLESS' : 'CAMPAIGN';
      } else if ((e.code === 'KeyR' || e.code === 'Enter') && !e.repeat) {
        if (!this.isInMidRunPeek()) {
          this.audio.playButtonLatchLock();
          this.playAgainImmediate();
        }
      }
      return;
    }

    if (this.phase === 'BOOT') {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') {
        this.audio.playButtonLatchLock(0.94, 0.95);
        this.advanceFromBoot();
      }
      return;
    }

    // 6. Universal [H] / [?] Controls Quick-Card (pauses cleanly from any screen!)
    if ((e.code === 'KeyH' || e.key === '?') && !e.repeat) {
      this.audio.playButtonLatchLock(0.96, 0.9);
      this.controlsCardOpen = true;
      this.confirmExitPending = false;
      return;
    }

    // 7. Universal [ESC] -> Opens Unified System Menu (NEVER silently quits to Hub from Title!)
    if (e.code === 'Escape' && !e.repeat) {
      this.audio.playButtonLatchLock(0.92, 0.88);
      this.bezelState.osdMenuOpen = true;
      this.confirmExitPending = false;
      return;
    }

    // 8. Universal [P] Quick-Pause with Amber CRT PauseBanner
    if (e.code === 'KeyP' && !e.repeat) {
      if (this.phase === 'FLIGHT') {
        this.audio.playButtonLatchLock(0.94, 0.88);
        this.phase = 'PAUSED';
        return;
      }
      if (this.phase === 'PAUSED') {
        this.audio.playButtonLatchLock(1.02, 0.88);
        this.phase = 'FLIGHT';
        return;
      }
    }

    // 9. Phase-specific keybinds
    if (this.phase === 'TITLE_MENU') {
      const modes: MenuModeSelection[] = ['RANKED_CAMPAIGN', 'PRACTICE', 'ENDLESS'];
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        this.menuCursor = (this.menuCursor + 2) % 3;
        this.selectedMenuMode = modes[this.menuCursor];
        this.audio.playSfx('ui_keyclick');
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        this.menuCursor = (this.menuCursor + 1) % 3;
        this.selectedMenuMode = modes[this.menuCursor];
        this.audio.playSfx('ui_keyclick');
      } else if (e.code === 'Digit1') {
        this.audio.playButtonLatchLock();
        this.menuCursor = 0;
        this.selectedMenuMode = 'RANKED_CAMPAIGN';
      } else if (e.code === 'Digit2') {
        this.audio.playButtonLatchLock();
        this.menuCursor = 1;
        this.selectedMenuMode = 'PRACTICE';
      } else if (e.code === 'Digit3') {
        this.audio.playButtonLatchLock();
        this.menuCursor = 2;
        this.selectedMenuMode = 'ENDLESS';
      } else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        this.audio.playButtonLatchLock(1.04, 0.85);
        this.menuCursor = 1;
        this.selectedMenuMode = 'PRACTICE';
        const delta = e.code === 'ArrowLeft' ? -1 : 1;
        this.selectedStartSector = ((this.selectedStartSector - 1 + delta + 6) % 6) + 1;
      } else if (e.code === 'Digit4') {
        this.audio.playButtonLatchLock();
        this.manifestOpenedPostRun = false;
        this.bezelState.flightLogsOpen = true;
      } else if (e.code === 'Enter' || e.code === 'Space') {
        this.audio.playButtonLatchLock();
        this.launchSelectedMenuMode();
      }
      return;
    }

    if (this.phase === 'SECTOR_BRIEFING') {
      const isDropTrigger =
        e.code === 'KeyW' ||
        e.code === 'ArrowUp' ||
        e.code === 'KeyA' ||
        e.code === 'KeyD' ||
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight' ||
        e.code === 'KeyS' ||
        e.code === 'ArrowDown' ||
        e.code === 'Space' ||
        e.code === 'Enter';
      if (isDropTrigger && !e.repeat) {
        this.audio.playButtonLatchLock();
        this.beginSectorFlight();
      }
      return;
    }

    if (this.phase === 'FLIGHT') {
      // Bare lethal [R] jettison REMOVED from flight (safely housed inside [ESC] System Menu!)
      if (e.code === 'Space' && !e.repeat) {
        this.tryFireEmergencyPulse();
      }
      return;
    }

    if (this.phase === 'SECTOR_TALLY') {
      if (e.code === 'KeyR' && !e.repeat && this.isPracticeRun) {
        this.audio.playButtonLatchLock();
        this.retryPracticeSector();
      } else if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
        this.audio.playButtonLatchLock();
        if (this.tallyAnimProgress < 1) {
          this.tallyAnimProgress = 1;
        } else {
          this.advanceAfterTally();
        }
      }
      return;
    }

    if (this.phase === 'HULL_BREACH' && this.lives > 0) {
      if ((e.code === 'KeyR' || e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
        this.audio.playButtonLatchLock();
        this.redeployAfterCrash();
      } else if (e.code === 'KeyQ' && !e.repeat) {
        this.audio.playButtonLatchLock();
        this.enterUnifiedDebrief('ABORT');
      }
      return;
    }

    if (this.isInUnifiedDebrief()) {
      if (this.debriefKeylockSec > 0) {
        return; // Respect 1.0s visual KEYLOCK countdown!
      }
      if (e.code === 'KeyC' && !e.repeat) {
        if (
          this.canSubmitRankedScore() &&
          !this.scoreSubmittedForRun &&
          this.uplinkSubmitState !== 'TRANSMITTING'
        ) {
          this.audio.playButtonLatchLock(1.04, 0.85);
          this.callsignEditing = true;
        }
      } else if (e.code === 'KeyR' && !e.repeat) {
        this.audio.playButtonLatchLock();
        this.playAgainImmediate();
      } else if (e.code === 'Enter' && !e.repeat) {
        this.audio.playButtonLatchLock();
        if (this.canSubmitRankedScore() && !this.scoreSubmittedForRun) {
          void this.submitCallsign();
        } else if (this.scoreSubmittedForRun) {
          this.finishCallsignUplink();
        } else {
          this.playAgainImmediate();
        }
      }
      return;
    }
  }

  private advanceFromBoot(): void {
    if (this.bootElapsedSec < 0.65) {
      return;
    }

    if (this.bootElapsedSec < BOOT_TIMING.PROTOCOL_START_SEC) {
      this.bootElapsedSec = BOOT_TIMING.PROTOCOL_START_SEC;
      this.bootModeSwitchPlayed = true;
      this.glitchIntensity = Math.max(this.glitchIntensity, 0.32);
      return;
    }

    this.bootTransitionPlayed = true;
    this.glitchIntensity = Math.max(this.glitchIntensity, 0.24);
    this.audio.playScaryComputerTransition('dark', 0, 0.42);
    this.menuCursor = 0;
    this.phase = 'TITLE_MENU';
  }

  private startCampaign(
    startSector: number,
    practiceMode = startSector > 1,
    isReplay = false
  ): void {
    this.endlessMode = false;
    this.isPracticeRun = practiceMode;
    this.manifestTab = 'CAMPAIGN';
    this.lives = this.maxLives;
    this.lifeLostFlashTimer = 0;
    this.gameEmergencyPulseAvailable = true;
    this.missionScore = 0;
    this.displayedScore = 0;
    this.dropStreak = 0;
    this.highestSectorNum = startSector;
    this.accuracySamples = [];
    this.runPlaytimeSec = 0;
    this.scoreSubmittedForRun = false;
    this.lastSubmittedRun = null;
    this.uplinkSubmitState = 'IDLE';
    this.uplinkConfirmText = null;
    this.callsignEditing = false;
    this.confirmExitPending = false;
    this.loadSector(SectorGenerator.createCampaignSector(startSector), isReplay);
  }

  private startEndlessDeepSurvey(isReplay = false): void {
    this.endlessMode = true;
    this.isPracticeRun = false;
    this.manifestTab = 'ENDLESS';
    this.lives = this.maxLives;
    this.lifeLostFlashTimer = 0;
    this.gameEmergencyPulseAvailable = true;
    this.endlessDepth = 1;
    this.endlessSeed = (Date.now() & 0xffffffff) >>> 0;
    this.missionScore = 0;
    this.displayedScore = 0;
    this.dropStreak = 0;
    this.highestSectorNum = 1;
    this.accuracySamples = [];
    this.runPlaytimeSec = 0;
    this.scoreSubmittedForRun = false;
    this.lastSubmittedRun = null;
    this.uplinkSubmitState = 'IDLE';
    this.uplinkConfirmText = null;
    this.callsignEditing = false;
    this.confirmExitPending = false;
    this.loadSector(SectorGenerator.createEndlessSector(this.endlessDepth, this.endlessSeed), isReplay);
  }

  private loadSector(sec: SectorConfig, isReplay = false): void {
    this.sector = sec;
    const secNumber = sec.endlessMode ? this.endlessDepth : sec.index;
    this.highestSectorNum = Math.max(this.highestSectorNum, secNumber);
    this.highestSectorCode = sec.code;
    this.lander = this.physics.createInitialLander(sec);
    this.lander.emergencyPulseAvailable = this.gameEmergencyPulseAvailable;
    this.cameraPos = { ...this.lander.pos };
    this.manualZoom = this.mobileMode ? 2.15 : 1.08;
    this.currentZoom = this.manualZoom;
    this.activeTouchPointers.clear();
    this.sectorElapsedSec = 0;
    this.briefingProgressChars = 0;
    this.avionicsBeepTimer = 0;
    this.hadActiveAvionicsWarning = false;
    this.motionPingTimer = 0;
    this.lastBreakdown = null;
    this.lastFailure = null;
    this.touchdownSnapshot = null;

    // Sectors 2-6, Endless, Practice, and all Replays use the live 1-line teletype strip!
    this.inlineTeletypeHold =
      this.hasSeenInitialBriefing || isReplay || sec.endlessMode || this.isPracticeRun || sec.index > 1;
    this.phase = 'SECTOR_BRIEFING';
    this.audio.playScaryComputerTransition('dark');
    this.audio.playAlienComputerActivity(0.52);
    this.logEvent(`LOADED ${sec.code}: ${sec.name}`);
  }

  private beginSectorFlight(): void {
    this.audio.fadeOutBootStartupAudio(1.1);
    this.hasSeenInitialBriefing = true;
    this.inlineTeletypeHold = false;
    // 0.6s flip-cover safety interlock prevents briefing-skip [SPACE] taps from burning 1X Pulse!
    this.pulseSafetyLockSec = 0.6;
    if (this.mobileMode && !this.mobileRadarHintShown) {
      this.mobileRadarHintShown = true;
      this.mobileRadarHintTimer = 5.5;
    }
    this.phase = 'FLIGHT';
    this.audio.playScaryComputerTransition('engage');
  }

  private redeployAfterCrash(): void {
    if (this.lives <= 0) {
      this.enterUnifiedDebrief('BREACH');
      return;
    }
    this.spawnFreshShuttleOnCurrentSector(
      `${this.sector.code} // RESERVE SHUTTLE DEPLOYED (${this.lives} LEFT)`
    );
  }

  /**
   * Manual shuttle jettison (safely located inside `[ESC]` System Menu; locked on final shuttle).
   */
  private manualJettisonAndRedeploy(): void {
    if (this.lives <= 1) {
      this.audio.playButtonLatchLock(0.7, 0.7);
      this.showStatusToast('FINAL SHUTTLE ACTIVE — MANUAL JETTISON LOCKED', 2.0, 'red');
      return;
    }
    this.lives -= 1;
    this.lifeLostFlashTimer = 1.8;
    this.dropStreak = 0;
    this.logEvent(`MANUAL JETTISON ON ${this.sector.code} // ${this.lives} SHUTTLES REMAINING`);
    this.spawnFreshShuttleOnCurrentSector(
      `SHUTTLE JETTISONED (-1 HULL) // ${this.lives} REMAINING`
    );
  }

  private spawnFreshShuttleOnCurrentSector(toastMsg: string): void {
    const fresh = this.sector.endlessMode
      ? SectorGenerator.createEndlessSector(this.endlessDepth, this.endlessSeed)
      : SectorGenerator.createCampaignSector(this.sector.index);
    this.sector = fresh;
    this.lander = this.physics.createInitialLander(fresh);
    this.lander.emergencyPulseAvailable = this.gameEmergencyPulseAvailable;
    this.cameraPos = { ...this.lander.pos };
    this.currentZoom = this.manualZoom;
    this.activeTouchPointers.clear();
    this.sectorElapsedSec = 0;
    this.avionicsBeepTimer = 0;
    this.hadActiveAvionicsWarning = false;
    this.motionPingTimer = 0;
    this.lastFailure = null;
    this.touchdownSnapshot = null;
    this.glitchIntensity = 0.25;
    this.pulseSafetyLockSec = 0.6;
    this.inlineTeletypeHold = false;
    this.phase = 'FLIGHT';
    this.audio.playScaryComputerTransition('engage');
    this.showStatusToast(toastMsg, 2.0, 'amber');
  }

  private captureTouchdownSnapshot(
    explicitPad: LandingPad | null,
    vs: number,
    hs: number,
    deg: number,
    grade: LandingGrade
  ): void {
    let pad = explicitPad;
    let dist = 0;
    if (!pad) {
      let bestDist = Infinity;
      for (const p of this.sector.pads) {
        const cx = (p.x1 + p.x2) * 0.5;
        const d = Math.hypot(
          this.lander.pos.x - cx,
          this.lander.pos.y + PHYSICS.STRUT_REST_BOTTOM_Y - p.y
        );
        if (d < bestDist) {
          bestDist = d;
          pad = p;
        }
      }
      dist = bestDist;
    }
    if (!pad) return;
    const padCenter = (pad.x1 + pad.x2) * 0.5;
    this.touchdownSnapshot = {
      pad,
      dist,
      vs,
      hs,
      deg,
      offsetM: this.lander.pos.x - padCenter,
      grade,
    };
  }

  private handleTouchdown(evalResult: LandingEvaluation): void {
    const pad = evalResult.pad!;
    this.captureTouchdownSnapshot(
      pad,
      evalResult.impactVs,
      evalResult.impactHs,
      evalResult.impactDeg,
      evalResult.grade
    );
    this.dropStreak += 1;

    const basePadValue = PHYSICS.BASE_PAD_VALUE;
    const padMultiplier = pad.multiplier;
    const padScore = basePadValue * padMultiplier;
    const remainingFuelKg = this.lander.fuelKg;
    const fuelBonus = Math.round(remainingFuelKg * PHYSICS.FUEL_SCORE_MULTIPLIER);

    let precisionKissBonus = 0;
    if (evalResult.grade === 'SOFT_KISS') {
      const vsFactor = 1 - Math.min(1, evalResult.impactVs / PHYSICS.KISS_VS_MAX);
      const centerFactor = 1 - Math.min(1, evalResult.centerOffsetRatio);
      precisionKissBonus = Math.round(750 + 750 * (vsFactor * 0.55 + centerFactor * 0.45));
      precisionKissBonus = Math.min(PHYSICS.MAX_KISS_BONUS, precisionKissBonus);
    }

    const noDamageBonus =
      !this.lander.tookSectorDamage && evalResult.grade !== 'HARD_SURVIVAL'
        ? PHYSICS.NO_DAMAGE_BONUS
        : 0;

    const subtotal = padScore + fuelBonus + precisionKissBonus + noDamageBonus;
    const streakMultiplier = this.dropStreak;
    const sectorTotal = subtotal * streakMultiplier;

    const vsScore = Math.max(0, 1 - evalResult.impactVs / PHYSICS.SURVIVAL_VS_MAX) * 40;
    const hsScore = Math.max(0, 1 - evalResult.impactHs / PHYSICS.SURVIVAL_HS_MAX) * 25;
    const centerScore = Math.max(0, 1 - evalResult.centerOffsetRatio) * 25;
    const integrityScore = (this.lander.hullIntegrity / 100) * 10;
    const accuracyPercent = Math.max(
      40,
      Math.min(100, Math.round(vsScore + hsScore + centerScore + integrityScore))
    );
    this.accuracySamples.push(accuracyPercent);

    const accuracyRating =
      accuracyPercent >= 93
        ? 'S+'
        : accuracyPercent >= 84
          ? 'A'
          : accuracyPercent >= 72
            ? 'B'
            : 'C';

    this.missionScore += sectorTotal;
    this.lastBreakdown = {
      sectorCode: this.sector.code,
      sectorName: this.sector.name,
      grade: evalResult.grade,
      padLabel: pad.label,
      basePadValue,
      padMultiplier,
      padScore,
      remainingFuelKg,
      fuelBonus,
      touchdownVs: evalResult.impactVs,
      touchdownHs: evalResult.impactHs,
      touchdownDeg: evalResult.impactDeg,
      padCenterOffsetRatio: evalResult.centerOffsetRatio,
      precisionKissBonus,
      noDamageBonus,
      subtotal,
      streakMultiplier,
      sectorTotal,
      accuracyRating,
      accuracyPercent,
    };

    this.tallyAnimProgress = 0;
    this.phase = 'SECTOR_TALLY';
    this.audio.playIndustrialTouchdownThud(
      evalResult.impactVs,
      evalResult.grade === 'HARD_SURVIVAL'
    );
    this.audio.playScaryComputerTransition('confirm', 0.48, 0.48);
    this.logEvent(
      `${this.sector.code} EXTRACTED [${pad.label} ${padMultiplier}X] // +${sectorTotal.toLocaleString()} PTS`
    );
  }

  private advanceAfterTally(): void {
    if (this.isPracticeRun) {
      this.phase = 'TITLE_MENU';
      return;
    }

    if (this.endlessMode) {
      this.endlessDepth += 1;
      this.loadSector(SectorGenerator.createEndlessSector(this.endlessDepth, this.endlessSeed));
      return;
    }

    if (this.sector.index < SectorGenerator.CAMPAIGN_SECTOR_COUNT) {
      this.loadSector(SectorGenerator.createCampaignSector(this.sector.index + 1));
    } else {
      this.enterUnifiedDebrief('VICTORY');
    }
  }

  private getAverageAccuracy(): { percent: number; rating: string } {
    const percent =
      this.accuracySamples.length > 0
        ? Math.round(
            this.accuracySamples.reduce((a, b) => a + b, 0) / this.accuracySamples.length
          )
        : 0;
    return { percent, rating: accuracyToGrade(percent) };
  }

  /**
   * Enters the Unified Post-Run Debrief + Inline Callsign Modal (`GameOverDebriefModal`).
   */
  private enterUnifiedDebrief(outcome: 'BREACH' | 'VICTORY' | 'ABORT'): void {
    this.debriefOutcome = outcome;
    this.debriefKeylockSec = outcome === 'ABORT' ? 0.35 : 1.0;
    this.callsignEditing = false;
    this.confirmExitPending = false;
    this.manifestTab = this.endlessMode ? 'ENDLESS' : 'CAMPAIGN';

    const saved = this.leaderboard.getSavedCallsign();
    if (saved) {
      this.callsignDraft = saved;
    } else if (!this.callsignDraft.trim()) {
      this.callsignDraft = 'PILOT-01';
    }
    this.uplinkSubmitState = 'IDLE';
    this.uplinkConfirmText = null;
    this.phase = outcome === 'VICTORY' ? 'CAMPAIGN_COMPLETE' : 'CALLSIGN_ENTRY';
  }

  private async submitCallsign(): Promise<void> {
    if (
      !this.canSubmitRankedScore() ||
      this.scoreSubmittedForRun ||
      this.uplinkSubmitState === 'TRANSMITTING'
    ) {
      return;
    }
    const cleanDraft = sanitizeCallsignDraft(this.callsignDraft);
    this.callsignDraft = cleanDraft;
    this.uplinkSubmitState = 'TRANSMITTING';
    this.uplinkConfirmText = null;

    const avg = this.getAverageAccuracy();
    const mode: LeaderboardMode = this.endlessMode ? 'ENDLESS' : 'CAMPAIGN';
    const finalScore = Math.max(1, Math.round(this.missionScore));
    const result = await this.leaderboard.submitScore({
      callsign: cleanDraft,
      score: finalScore,
      sector: this.highestSectorNum,
      mode,
      accuracy: avg.percent,
      playtimeSec: this.runPlaytimeSec,
    });

    if (result.rejectedReason) {
      this.uplinkSubmitState = 'IDLE';
      this.uplinkConfirmText = result.rejectedReason;
      this.audio.playMutedAvionicsIndicatorBeep(false);
      return;
    }

    this.scoreSubmittedForRun = true;
    const submittedScore = result.submittedScore ?? finalScore;
    const rankStr = `#${String(result.rank).padStart(2, '0')}`;
    this.lastSubmittedRun = {
      docId: result.docId,
      callsign: cleanDraft,
      score: submittedScore,
      sector: this.highestSectorNum,
      highestSector: formatSectorCode(this.highestSectorNum, mode),
      accuracyRating: avg.rating,
      accuracyPercent: avg.percent,
      mode,
      rank: result.rank,
    };

    if (result.ok) {
      this.uplinkSubmitState = 'CONFIRMED';
      this.uplinkConfirmText = `UPLINK CONFIRMED // ${mode} RANK ${rankStr}`;
      this.audio.playScaryComputerTransition('confirm', 0, 0.55);
      this.logEvent(`GLOBAL UPLINK CONFIRMED: ${cleanDraft} [${mode} ${rankStr}]`);
    } else {
      this.uplinkSubmitState = 'OFFLINE_SAVED';
      this.uplinkConfirmText = `RELAY OFFLINE // LOGGED TO LOCAL ARCHIVE (${rankStr})`;
      this.logEvent(`LOCAL ARCHIVE LOGGED: ${cleanDraft} (${submittedScore} PTS)`);
    }

    // Golden-path 2-screen post-run loop: auto-open shared Global Manifest immediately!
    this.finishCallsignUplink();
  }

  private finishCallsignUplink(): void {
    this.manifestTab = this.endlessMode ? 'ENDLESS' : 'CAMPAIGN';
    this.manifestOpenedPostRun = true;
    this.callsignEditing = false;
    this.bezelState.flightLogsOpen = true;
  }

  private computeEmStormState(): {
    worldInterference: number;
    shaderInterference: number;
    blackoutActive: boolean;
  } {
    if (this.sector.emInterference < 0.3 && !this.sector.emBlackoutPulse) {
      return {
        worldInterference: this.sector.emInterference,
        shaderInterference: 0.012,
        blackoutActive: false,
      };
    }

    if (this.phase !== 'FLIGHT' && this.phase !== 'PAUSED') {
      return {
        worldInterference: 0.25,
        shaderInterference: 0.02,
        blackoutActive: false,
      };
    }

    if (this.sectorElapsedSec < 4.5) {
      return {
        worldInterference: 0.18,
        shaderInterference: 0.015,
        blackoutActive: false,
      };
    }

    const cycleT = (this.sectorElapsedSec - 4.5) % 14.5;
    const blackoutDuration = 8.0;
    if (cycleT < blackoutDuration) {
      let ripple = 0.024;
      if (cycleT < 0.85) {
        ripple = 0.024 + Math.sin((cycleT / 0.85) * Math.PI) * 0.23;
      } else if (cycleT > blackoutDuration - 0.55) {
        ripple = 0.024 + Math.sin(((blackoutDuration - cycleT) / 0.55) * Math.PI) * 0.15;
      }
      return {
        worldInterference: 1.0,
        shaderInterference: ripple,
        blackoutActive: true,
      };
    }

    return {
      worldInterference: 0.12,
      shaderInterference: 0.012,
      blackoutActive: false,
    };
  }

  private buildCameraView(): CameraView {
    if (this.mobileMode) {
      const corridor = MobileHudRenderer.getSafeCorridor(
        this.crtRect.width,
        this.crtRect.height,
        this.safeAreaInsets,
        this.isFullscreen
      );
      const availW = Math.max(260, this.crtRect.width - 16);
      const availH = Math.max(180, corridor.bottomPx - corridor.topPx);
      const fitPxPerM = Math.min(
        availW / Math.max(380, this.sector.worldWidth + 10),
        availH / Math.max(210, this.sector.worldHeight + 12)
      );
      const basePxPerM = Math.max(1.58, fitPxPerM);
      const pxPerMeter = basePxPerM * this.currentZoom;
      return {
        x: this.cameraPos.x,
        y: this.cameraPos.y,
        zoom: this.currentZoom,
        pxPerMeter,
        widthPx: this.crtRect.width,
        heightPx: this.crtRect.height,
      };
    }

    const layout = HudRenderer.computeLayoutMetrics(this.crtRect.width, this.crtRect.height);
    const basePxPerM = Math.min(
      layout.safeWidthPx / Math.max(380, this.sector.worldWidth + 16),
      (this.crtRect.height - layout.topHeaderY - 56) / Math.max(210, this.sector.worldHeight + 18)
    );
    const pxPerMeter = basePxPerM * this.currentZoom;

    return {
      x: this.cameraPos.x,
      y: this.cameraPos.y,
      zoom: this.currentZoom,
      pxPerMeter,
      widthPx: this.crtRect.width,
      heightPx: this.crtRect.height,
    };
  }

  public updateAndRender(
    frameDt: number,
    oCtx: CanvasRenderingContext2D,
    hostTotalTimeSec: number
  ): CrtShaderFrameParams {
    const dt = Math.min(PHYSICS.MAX_FRAME_DT, Math.max(0, frameDt));
    this.totalTimeSec = hostTotalTimeSec;
    this.bezelState.crtIntensity = this.host.getCrtIntensity();
    this.bezelState.audioMuted = this.host.isMuted();
    this.isFullscreen = this.host.getViewport().isFullscreen;

    if (this.activeCalloutTimer > 0) this.activeCalloutTimer = Math.max(0, this.activeCalloutTimer - dt);
    if (this.statusBannerTimer > 0) this.statusBannerTimer = Math.max(0, this.statusBannerTimer - dt);
    if (this.proximityVoiceCooldown > 0) this.proximityVoiceCooldown = Math.max(0, this.proximityVoiceCooldown - dt);
    if (this.bankAngleVoiceCooldown > 0) this.bankAngleVoiceCooldown = Math.max(0, this.bankAngleVoiceCooldown - dt);
    if (this.driftVoiceCooldown > 0) this.driftVoiceCooldown = Math.max(0, this.driftVoiceCooldown - dt);
    if (this.lifeLostFlashTimer > 0) this.lifeLostFlashTimer = Math.max(0, this.lifeLostFlashTimer - dt);
    if (this.glitchIntensity > 0) this.glitchIntensity = Math.max(0, this.glitchIntensity - dt * 1.45);
    if (this.debriefKeylockSec > 0) this.debriefKeylockSec = Math.max(0, this.debriefKeylockSec - dt);
    if (this.confirmExitTimer > 0) {
      this.confirmExitTimer = Math.max(0, this.confirmExitTimer - dt);
      if (this.confirmExitTimer === 0) {
        this.confirmExitPending = false;
      }
    }

    const modalPaused =
      this.bezelState.flightLogsOpen || this.bezelState.osdMenuOpen || this.controlsCardOpen;
    if (this.phase === 'FLIGHT' && this.lander.alive && !modalPaused) {
      this.sectorElapsedSec += dt;
      this.runPlaytimeSec += dt;
      if (this.pulseSafetyLockSec > 0) {
        this.pulseSafetyLockSec = Math.max(0, this.pulseSafetyLockSec - dt);
      }
      if (this.mobileRadarHintTimer > 0) {
        this.mobileRadarHintTimer = Math.max(0, this.mobileRadarHintTimer - dt);
      }
    }

    if (this.displayedScore < this.missionScore) {
      const diff = this.missionScore - this.displayedScore;
      this.displayedScore = Math.min(
        this.missionScore,
        this.displayedScore + Math.max(40, diff * 5.5) * dt
      );
    } else {
      this.displayedScore = this.missionScore;
    }

    if (this.bootPoweredOn) {
      this.bootElapsedSec += dt;
      if (this.crtWarmupProgress < 1) {
        this.crtWarmupProgress = Math.min(1, this.crtWarmupProgress + dt * 2.2);
      }
    }

    if (this.bootPoweredOn && this.phase !== 'BOOT') {
      this.ambientChirpTimer -= dt;
      if (this.ambientChirpTimer <= 0) {
        this.ambientChirpTimer = 25 + Math.random() * 14;
        this.audio.playAlienComputerActivity(0.22);
      }
    }

    if (this.phase === 'BOOT' && this.bootPoweredOn) {
      if (
        this.bootElapsedSec >= BOOT_TIMING.LOGO_HOLD_END_SEC &&
        !this.bootModeSwitchPlayed
      ) {
        this.bootModeSwitchPlayed = true;
        this.glitchIntensity = Math.max(this.glitchIntensity, 0.36);
      }

      if (this.bootElapsedSec >= BOOT_TIMING.PROTOCOL_START_SEC) {
        const totalBoot = BOOT_LINES.reduce((acc, s) => acc + s.length, 0);
        if (this.bootProgressChars < totalBoot) {
          const prev = this.bootProgressChars;
          this.bootProgressChars = Math.min(totalBoot, this.bootProgressChars + dt * 52);
          if (Math.floor(this.bootProgressChars / 2.8) > Math.floor(prev / 2.8)) {
            this.audio.playAsmrScrollClack(0.72);
          }
          if (this.bootProgressChars >= totalBoot && !this.bootTransitionPlayed) {
            this.bootTransitionPlayed = true;
          }
        }
      }
    } else if (this.phase === 'SECTOR_BRIEFING' && !modalPaused) {
      const targetChars = this.inlineTeletypeHold
        ? 140
        : this.sector.briefingLines.reduce((acc, s) => acc + s.length, 0);
      if (this.briefingProgressChars < targetChars) {
        const prev = this.briefingProgressChars;
        this.briefingProgressChars = Math.min(
          targetChars,
          this.briefingProgressChars + dt * (this.inlineTeletypeHold ? 95 : 58)
        );
        if (
          !this.inlineTeletypeHold &&
          Math.floor(this.briefingProgressChars / 2.6) > Math.floor(prev / 2.6)
        ) {
          this.audio.playAsmrScrollClack(0.84);
        }
      }
    } else if (this.phase === 'SECTOR_TALLY' && this.tallyAnimProgress < 1 && !modalPaused) {
      const prev = Math.floor(this.tallyAnimProgress * 18);
      this.tallyAnimProgress = Math.min(1, this.tallyAnimProgress + dt * 0.95);
      if (Math.floor(this.tallyAnimProgress * 18) > prev) {
        this.audio.playAsmrScrollClack(0.75);
      }
    }

    const preCam = this.buildCameraView();
    if (this.pointerInsideCrt) {
      this.cursorWorld = this.worldRenderer.screenToWorld(
        preCam,
        this.cursorCrtPx.x,
        this.cursorCrtPx.y
      );
    }

    const emStorm = this.computeEmStormState();
    const simActive =
      (this.phase === 'FLIGHT' || this.phase === 'HULL_BREACH' || this.phase === 'SECTOR_TALLY') &&
      !modalPaused;

    let interpAlpha = 1;
    const mobileTouch = this.getMobileTouchState();
    if (simActive) {
      this.simAccumulator += dt;
      const throttleUp =
        this.phase === 'FLIGHT' &&
        (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp') || mobileTouch.thrust);
      if (
        throttleUp &&
        !this.wasMainEngineLit &&
        this.lander.alive &&
        this.lander.fuelKg > 0.5 &&
        this.lander.throttle < 0.12
      ) {
        this.audio.playSfx('thruster_ignite', { pitch: 0.9, volume: 0.68 });
      }
      this.wasMainEngineLit = throttleUp;
      const overdrive =
        throttleUp &&
        (this.keysDown.has('ShiftLeft') ||
          this.keysDown.has('ShiftRight') ||
          mobileTouch.overdrive);
      const rotateLeft =
        this.phase === 'FLIGHT' &&
        (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft') || mobileTouch.rollLeft);
      const rotateRight =
        this.phase === 'FLIGHT' &&
        (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight') || mobileTouch.rollRight);
      const retroStabilizer =
        this.phase === 'FLIGHT' &&
        (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown') || mobileTouch.retro);

      while (this.simAccumulator >= PHYSICS.FIXED_DT) {
        this.simAccumulator -= PHYSICS.FIXED_DT;
        this.physics.step(
          PHYSICS.FIXED_DT,
          this.lander,
          this.sector,
          {
            throttleUp,
            overdrive,
            rotateLeft,
            rotateRight,
            retroStabilizer,
            sasEnabled: this.bezelState.sasEnabled,
            aimWorldPos: this.cursorWorld,
          },
          {
            onTouchdownConfirmed: (ev) => this.handleTouchdown(ev),
            onHardImpactGlitch: (intensity, reason) => {
              this.glitchIntensity = Math.max(this.glitchIntensity, intensity);
              this.audio.playIndustrialTouchdownThud(3.0, true);
              this.showStatusToast(reason, 2.8, 'amber');
            },
            onStrutContactThud: (intensity) => {
              this.audio.playIndustrialTouchdownThud(intensity * 2.0, false);
            },
            onCatastrophicBreach: (ev) => {
              this.lastFailure = ev;
              this.captureTouchdownSnapshot(
                ev.pad,
                ev.impactVs,
                ev.impactHs,
                ev.impactDeg,
                'CATASTROPHIC'
              );
              this.lives = Math.max(0, this.lives - 1);
              this.lifeLostFlashTimer = 2.4;
              this.dropStreak = 0;
              this.glitchIntensity = 1.0;
              this.audio.playSfx('hull_explosion', { pitch: 0.96, volume: 1.0 });
              this.audio.playScaryComputerTransition('dark');
              this.logEvent(
                this.lives > 0
                  ? `HULL BREACH ON ${this.sector.code} // ${this.lives} SHUTTLE(S) REMAINING`
                  : `GAME OVER ON ${this.sector.code} // ALL 3 SHUTTLES LOST`
              );
              if (this.lives <= 0) {
                // Directly open unified Game Over + Inline Callsign Debrief (1.0s visual lockout!)
                this.enterUnifiedDebrief('BREACH');
              } else {
                this.phase = 'HULL_BREACH';
              }
            },
          }
        );
      }
      interpAlpha = this.simAccumulator / PHYSICS.FIXED_DT;

      if (this.phase === 'FLIGHT' && this.lander.alive) {
        if (this.lander.agl < 66 && this.lander.groundedPad === null) {
          const closeness = 1 - Math.max(0, Math.min(1, this.lander.agl / 66));
          const interval = 0.17 + Math.pow(1 - closeness, 1.45) * 1.22;
          this.motionPingTimer -= dt;
          if (this.motionPingTimer <= 0) {
            this.motionPingTimer = interval;
            this.audio.playAlienMotionTrackerPing(closeness);
          }
        } else {
          this.motionPingTimer = 0.25;
        }

        const activeAvionicsWarnings = HudRenderer.computeAvionicsWarnings(
          this.lander,
          emStorm.blackoutActive
        );
        if (this.avionicsBeepTimer > 0) {
          this.avionicsBeepTimer = Math.max(0, this.avionicsBeepTimer - dt);
        }
        if (activeAvionicsWarnings.length > 0 && !modalPaused) {
          const hasCritical = activeAvionicsWarnings.some((w) => w.critical);
          if (!this.hadActiveAvionicsWarning && this.avionicsBeepTimer <= 0) {
            this.audio.playMutedAvionicsIndicatorBeep(hasCritical);
            this.avionicsBeepTimer = hasCritical ? 0.85 : 1.4;
          } else if (this.avionicsBeepTimer <= 0) {
            this.audio.playMutedAvionicsIndicatorBeep(hasCritical);
            this.avionicsBeepTimer = hasCritical ? 0.85 : 1.4;
          }
          this.hadActiveAvionicsWarning = true;
        } else {
          this.hadActiveAvionicsWarning = false;
          this.avionicsBeepTimer = Math.min(this.avionicsBeepTimer, 0.35);
        }

        const criticalPullUp = this.lander.agl < 14 && this.lander.vel.y < -4.6;
        const ceilingObstacle = this.lander.ceilingClearance < 8 && this.lander.vel.y > 1.5;
        const sinkRateWarn =
          this.lander.agl < 17 && this.lander.vel.y < -3.75 && this.lander.throttle < 0.75;
        const lateralDriftWarn = this.lander.agl < 15 && Math.abs(this.lander.vel.x) > 3.15;
        const absPitchDeg = Math.abs((this.lander.angle * 180) / Math.PI);
        const bankAngleWarn = (this.lander.agl < 34 && absPitchDeg > 33.0) || absPitchDeg > 58.0;

        if (criticalPullUp) {
          this.audio.playSfx('proximity_klaxon', { pitch: 0.95, volume: 0.65 });
          if (this.proximityVoiceCooldown <= 0) {
            this.proximityVoiceCooldown = 6.5;
            this.triggerVoice('voice_pull_up', true);
          }
        } else if (ceilingObstacle) {
          this.audio.playSfx('proximity_klaxon', { pitch: 1.05, volume: 0.6 });
          if (this.proximityVoiceCooldown <= 0) {
            this.proximityVoiceCooldown = 6.5;
            this.triggerVoice('voice_obstacle', true);
          }
        } else if (sinkRateWarn) {
          if (this.proximityVoiceCooldown <= 0) {
            this.proximityVoiceCooldown = 10.0;
            this.triggerVoice('voice_proximity');
          }
        } else if (lateralDriftWarn && this.driftVoiceCooldown <= 0) {
          this.driftVoiceCooldown = 10.0;
          this.triggerVoice('voice_lateral_drift');
        } else if (bankAngleWarn && this.bankAngleVoiceCooldown <= 0) {
          this.bankAngleVoiceCooldown = 10.0;
          this.triggerVoice('voice_bank_angle');
        }
      }
    }

    const rcsDir =
      this.lander.rcsRightActive && !this.lander.rcsLeftActive
        ? 1
        : this.lander.rcsLeftActive && !this.lander.rcsRightActive
          ? -1
          : 0;
    const rcsInt =
      this.lander.retroActive
        ? 0.95
        : this.lander.rcsLeftActive || this.lander.rcsRightActive
          ? this.bezelState.sasEnabled
            ? 0.42
            : 0.75
          : 0;
    const windSpd = Math.hypot(this.lander.currentWindVx, this.lander.currentWindVy);
    this.audio.updateFlightDsp(
      this.lander.throttle,
      rcsDir,
      rcsInt,
      windSpd,
      this.phase === 'FLIGHT' && this.lander.alive && !modalPaused,
      this.sector.darknessLevel,
      dt
    );

    this.updateCamera(dt);

    const cam = this.buildCameraView();
    if (this.phase !== 'BOOT' && this.phase !== 'TITLE_MENU') {
      this.worldRenderer.render(
        oCtx,
        cam,
        this.sector,
        this.lander,
        this.physics,
        interpAlpha,
        this.totalTimeSec,
        emStorm.worldInterference,
        this.phase === 'FLIGHT' && !modalPaused && this.pointerInsideCrt
          ? this.cursorWorld
          : null
      );
    }

    const avgAcc = this.getAverageAccuracy();
    const manifestView = this.leaderboard.getManifestEntries(this.manifestTab);

    this.hudRenderer.render(oCtx, {
      phase: this.phase,
      width: this.crtRect.width,
      height: this.crtRect.height,
      timeSec: this.totalTimeSec,
      sector: this.sector,
      lander: this.lander,
      bezel: this.bezelState,
      crtPreset: this.host.getCrtPreset(),
      phosphorTheme: this.host.getPhosphorTheme(),
      masterVolume: this.host.getMasterVolume(),
      controlsCardOpen: this.controlsCardOpen,
      confirmExitPending: this.confirmExitPending,
      inlineTeletypeHold: this.inlineTeletypeHold,
      pulseSafetyLockSec: this.pulseSafetyLockSec,
      debriefKeylockSec: this.debriefKeylockSec,
      debriefOutcome: this.debriefOutcome,
      callsignEditing: this.callsignEditing,
      manifestOpenedPostRun: this.manifestOpenedPostRun,
      mobileRadarHintTimer: this.mobileRadarHintTimer,
      statusBannerTone: this.statusBannerTone,
      cameraZoom: this.currentZoom,
      sectorElapsedSec: this.sectorElapsedSec,
      missionScore: this.missionScore,
      displayedScore: this.displayedScore,
      dropStreak: this.dropStreak,
      lives: this.lives,
      maxLives: this.maxLives,
      lifeLostFlashTimer: this.lifeLostFlashTimer,
      isPracticeRun: this.isPracticeRun,
      endlessMode: this.endlessMode,
      highestSectorCode: this.highestSectorCode,
      avgAccuracyPercent: avgAcc.percent,
      avgAccuracyRating: avgAcc.rating,
      selectedMenuMode: this.selectedMenuMode,
      selectedStartSector: this.selectedStartSector,
      menuCursor: this.menuCursor,
      mobileMode: this.mobileMode,
      isFullscreen: this.isFullscreen,
      safeAreaInsets: this.safeAreaInsets,
      mobileTouchState: mobileTouch,
      bootPoweredOn: this.bootPoweredOn,
      bootElapsedSec: this.bootElapsedSec,
      crtWarmupProgress: this.crtWarmupProgress,
      bootProgressChars: this.bootProgressChars,
      briefingProgressChars: this.briefingProgressChars,
      tallyAnimProgress: this.tallyAnimProgress,
      lastBreakdown: this.lastBreakdown,
      lastFailure: this.lastFailure,
      touchdownSnapshot: this.touchdownSnapshot,
      emBlackoutActive: emStorm.blackoutActive,
      activeCalloutText: this.activeCalloutText,
      activeCalloutTimer: this.activeCalloutTimer,
      statusBannerText: this.statusBannerText,
      statusBannerTimer: this.statusBannerTimer,
      callsignDraft: this.callsignDraft,
      playerSavedCallsign: this.leaderboard.getSavedCallsign(),
      uplinkConnectionStatus: this.leaderboard.getStatus(),
      campaignLeader: this.leaderboard.getReigningChampion('CAMPAIGN'),
      endlessLeader: this.leaderboard.getReigningChampion('ENDLESS'),
      manifestTab: this.manifestTab,
      manifestEntries: manifestView.entries,
      manifestShowingArchive: manifestView.showingArchiveFallback,
      lastSubmittedRun: this.lastSubmittedRun,
      uplinkSubmitState: this.uplinkSubmitState,
      uplinkConfirmText: this.uplinkConfirmText,
      sessionLogs: this.sessionLogs,
      hoveredButtonId: this.hoveredHudButtonId,
    });

    const overdriveAmt =
      this.phase === 'FLIGHT' && this.lander.alive
        ? this.lander.emergencyPulseTimer > 0
          ? 0.95
          : this.lander.overdrive
            ? Math.max(0.35, (this.lander.throttle - 0.85) * 1.9)
            : Math.max(0, (this.lander.throttle - 0.82) * 0.85)
        : 0;

    const tubeTurnOn =
      this.phase === 'BOOT' && this.bootPoweredOn && this.bootElapsedSec < 1.05
        ? Math.pow(1 - this.bootElapsedSec / 1.05, 1.35)
        : 0;

    // Clamp chromaScale: 0.22 in flight/title, 0.06 whenever any text modal is open!
    const modalActive =
      this.bezelState.osdMenuOpen ||
      this.bezelState.flightLogsOpen ||
      this.controlsCardOpen ||
      this.phase === 'PAUSED' ||
      this.phase === 'SECTOR_TALLY' ||
      this.phase === 'HULL_BREACH' ||
      this.phase === 'CALLSIGN_ENTRY' ||
      this.phase === 'CAMPAIGN_COMPLETE' ||
      (this.phase === 'SECTOR_BRIEFING' && !this.inlineTeletypeHold);
    this.host.setModalOpen(modalActive);

    return {
      interference: emStorm.shaderInterference,
      glitch: this.glitchIntensity,
      overdrive: overdriveAmt,
      tubeTurnOn,
      chromaScale: modalActive ? 0.06 : 0.22,
      modalActive,
    };
  }

  private updateCamera(dt: number): void {
    let targetZoom = this.manualZoom;
    let minPadDist = Infinity;
    let closestPad: LandingPad | null = null;
    for (const pad of this.sector.pads) {
      const cx = (pad.x1 + pad.x2) * 0.5;
      const d = Math.hypot(
        this.lander.pos.x - cx,
        this.lander.pos.y + PHYSICS.STRUT_REST_BOTTOM_Y - pad.y
      );
      if (d < minPadDist) {
        minPadDist = d;
        closestPad = pad;
      }
    }

    if (this.bezelState.autoZoomEnabled && this.phase === 'FLIGHT' && this.lander.alive) {
      if (this.mobileMode) {
        const mobileGateM = 130;
        if (minPadDist < mobileGateM) {
          const approachFactor = 1 - minPadDist / mobileGateM;
          const autoTarget = 2.15 + Math.pow(approachFactor, 0.78) * 1.8;
          targetZoom = Math.max(this.manualZoom, autoTarget);
        }
      } else if (minPadDist < PHYSICS.APPROACH_PROXIMITY_M) {
        const approachFactor = 1 - minPadDist / PHYSICS.APPROACH_PROXIMITY_M;
        const autoTarget = 1.15 + approachFactor * 1.35;
        targetZoom = Math.max(this.manualZoom, autoTarget);
      }
    } else if (this.phase === 'TITLE_MENU') {
      targetZoom = 1.05;
    }

    const zoomLerpRate = this.mobileMode ? 4.8 : 3.8;
    this.currentZoom += (targetZoom - this.currentZoom) * Math.min(1, dt * zoomLerpRate);

    const cam = this.buildCameraView();
    if (this.mobileMode) {
      const corridor = MobileHudRenderer.getSafeCorridor(
        this.crtRect.width,
        this.crtRect.height,
        this.safeAreaInsets,
        this.isFullscreen
      );
      const effTopPx =
        minPadDist <= PHYSICS.APPROACH_PROXIMITY_M ? corridor.topPx + 60 : corridor.topPx;
      const effBotPx = Math.max(effTopPx + 90, corridor.bottomPx - 20);
      const visCenterScreenY = (effTopPx + effBotPx) * 0.5;
      const yScreenBiasM = (cam.heightPx * 0.5 - visCenterScreenY) / cam.pxPerMeter;

      let focusWorldY = this.lander.pos.y + this.lander.vel.y * 0.55 - 7;
      if (closestPad && minPadDist < 85 && this.lander.pos.y >= closestPad.y - 4) {
        const padBlend = (1 - minPadDist / 85) * 0.36;
        focusWorldY =
          (this.lander.pos.y + this.lander.vel.y * 0.35) * (1 - padBlend) +
          (closestPad.y - 3) * padBlend;
      }

      let mX = Math.max(
        20,
        Math.min(this.sector.worldWidth - 20, this.lander.pos.x + this.lander.vel.x * 0.75)
      );
      let mY = Math.max(14, Math.min(this.sector.worldHeight - 8, focusWorldY - yScreenBiasM));

      if (this.lander.alive) {
        const halfW = Math.max(8, (this.crtRect.width * 0.5 - 20) / cam.pxPerMeter);
        mX = Math.max(this.lander.pos.x - halfW, Math.min(this.lander.pos.x + halfW, mX));

        const minCamY = this.lander.pos.y - (cam.heightPx * 0.5 - effTopPx - 28) / cam.pxPerMeter;
        const maxCamY = this.lander.pos.y + (effBotPx - 32 - cam.heightPx * 0.5) / cam.pxPerMeter;
        if (minCamY <= maxCamY) {
          mY = Math.max(minCamY, Math.min(maxCamY, mY));
        }
      }

      this.cameraPos.x += (mX - this.cameraPos.x) * Math.min(1, dt * 7.0);
      this.cameraPos.y += (mY - this.cameraPos.y) * Math.min(1, dt * 7.0);
      return;
    }

    const layout = HudRenderer.computeLayoutMetrics(this.crtRect.width, this.crtRect.height);
    const halfSafeW = layout.safeWidthPx / (2 * cam.pxPerMeter);
    const halfFullH = (cam.heightPx - layout.topHeaderY - 56) / (2 * cam.pxPerMeter);

    let desiredX = this.lander.pos.x + this.lander.vel.x * 1.2;
    let desiredY = this.lander.pos.y + this.lander.vel.y * 0.8 - 6;

    if (this.phase === 'TITLE_MENU') {
      desiredX = this.sector.worldWidth * 0.5 + Math.sin(this.totalTimeSec * 0.18) * 45;
      desiredY = 120;
    } else {
      const minX = Math.min(this.sector.worldWidth * 0.5, halfSafeW - 8);
      const maxX = Math.max(this.sector.worldWidth * 0.5, this.sector.worldWidth - halfSafeW + 8);
      const minY = Math.max(12, halfFullH - 18);
      const maxY = Math.max(minY + 10, this.sector.worldHeight - halfFullH + 26);

      desiredX = Math.max(minX, Math.min(maxX, desiredX));
      desiredY = Math.max(minY, Math.min(maxY, desiredY));

      if (this.lander.alive) {
        const maxCraftDx = Math.max(6, halfSafeW - 10);
        desiredX = Math.max(
          this.lander.pos.x - maxCraftDx,
          Math.min(this.lander.pos.x + maxCraftDx, desiredX)
        );

        const topHudBottomPx =
          minPadDist <= PHYSICS.APPROACH_PROXIMITY_M ? layout.safeTopPx : layout.topHeaderY + 16;
        const botHudTopPx = layout.safeBottomPx;
        const topClearM = Math.max(6, (cam.heightPx * 0.5 - topHudBottomPx - 14) / cam.pxPerMeter);
        const botClearM = Math.max(6, (botHudTopPx - 14 - cam.heightPx * 0.5) / cam.pxPerMeter);

        desiredY = Math.max(
          this.lander.pos.y - topClearM,
          Math.min(this.lander.pos.y + botClearM, desiredY)
        );
      }
    }

    this.cameraPos.x += (desiredX - this.cameraPos.x) * Math.min(1, dt * 6.0);
    this.cameraPos.y += (desiredY - this.cameraPos.y) * Math.min(1, dt * 6.0);
  }
}
