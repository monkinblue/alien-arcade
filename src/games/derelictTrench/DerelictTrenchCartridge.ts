import {
  CONTROLS_CARD_IDS,
  handleSystemMenuAction,
  handleSystemMenuKey,
  PAUSE_BANNER_IDS,
  POST_RUN_IDS,
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
import type { ViewportRect } from '../../types';
import { TrenchAudioEngine } from './TrenchAudioEngine';
import { TrenchDevAutoPilot } from './TrenchDevAutoPilot';
import { TRENCH_UI_IDS, TrenchHudRenderer } from './TrenchHudRenderer';
import { TrenchLeaderboardService } from './TrenchLeaderboard';
import { TrenchRenderer } from './TrenchRenderer';
import { TrenchSimulation, type F16FlightInput } from './TrenchSimulation';
import { TRENCH_CONSTANTS, type TrenchLastSubmittedRun } from './types';

type StickSensitivityPreset = 'LOW' | 'MED' | 'HIGH';

const PITCH_STORAGE_KEY = 'muthur_trench_pitch_v2';
const SENS_STORAGE_KEY = 'muthur_trench_stick_sens_v1';

const STICK_SENS_ORDER: readonly StickSensitivityPreset[] = ['LOW', 'MED', 'HIGH'];
const STICK_SENS_SCALE: Record<StickSensitivityPreset, number> = {
  LOW: 0.0020,
  MED: 0.0028,
  HIGH: 0.0038,
};

interface TrenchDebugControl {
  stickX?: number;
  stickY?: number;
  throttle?: number;
  rudder?: number;
}

interface TrenchDebugBridge {
  getState: () => Record<string, unknown>;
  setControl: (ctrl: TrenchDebugControl | null) => TrenchDebugControl | null;
  fireGun: (active: boolean) => { firingGun: boolean; gunRds: number };
  fireMissile: () => { queued: boolean; lockState: string; missiles: number };
  deployCMDS: () => { queued: boolean; cmds: number };
  jumpToSector: (n: number) => {
    sector: number;
    sectorId: string;
    ralt: number;
    targetsCount: number;
  };
  triggerSamLaunch: () => { launched: boolean; samId: number | null; source: string };
  setAutoPilot: (enabled: boolean) => { autoPilotEnabled: boolean };
}

declare global {
  interface Window {
    __TRENCH_DEBUG__?: TrenchDebugBridge;
  }
}

export class DerelictTrenchCartridge implements Cartridge {
  public readonly id = 'trench';
  private host: HostEnvironment;
  private listenerAbort: AbortController | null = null;

  private trenchAudio: TrenchAudioEngine;
  private leaderboard: TrenchLeaderboardService;
  private sim: TrenchSimulation;
  private devAutoPilot: TrenchDevAutoPilot | null = import.meta.env.DEV
    ? new TrenchDevAutoPilot()
    : null;
  private debugControl: TrenchDebugControl | null = null;
  private debugGunActive = false;
  private debugTainted = false;
  private renderer = new TrenchRenderer();
  private hudRenderer = new TrenchHudRenderer();

  private viewportWidth = 1280;
  private viewportHeight = 800;
  private offsetX = 0;
  private offsetY = 0;
  private crtRect: ViewportRect = { x: 0, y: 0, width: 1280, height: 800 };

  private keysDown = new Set<string>();
  private mouseLeftDown = false;
  private pendingMissileLaunch = false;
  private pendingCmdsDeploy = false;

  // Pointer Lock + Unlocked Cursor Fallback Virtual Flight Stick (clamped to unit circle [-1, 1])
  private pointerLocked = false;
  private programmaticPointerUnlock = false;
  private stickX = 0;
  private stickY = 0;
  private lastPointerUnlockMs = 0;
  private unlockedMouseSteerActive = false;
  private stickSensitivity: StickSensitivityPreset = 'MED';
  private lastSortieWasDrill = false;

  private mouseScreenX = 640;
  private mouseScreenY = 300;
  private mouseInsideCanopy = false;
  private hoveredButtonId: string | null = null;

  // Unified Modals & Safety Latches
  private osdMenuOpen = false;
  private manifestOpen = false;
  private controlsCardOpen = false;
  private wasPausedBeforeModal = false;
  private confirmExitPending = false;
  private confirmExitTimer = 0;
  private glitchIntensity = 0;

  // Transient HUD Toasts ([I] Pitch Axis / [M] Mute)
  private statusToastText: string | null = null;
  private statusToastTone: 'green' | 'amber' | 'red' | 'cyan' = 'amber';
  private statusToastTimer = 0;

  // Post-Run Callsign & Orbital Relay Submission
  private callsignDraft = 'VECTOR-04';
  private runPlaytimeSec = 0;
  private callsignEditing = false;
  private callsignOverwriteOnNextKey = false;
  private scoreSubmitted = false;
  private submittingScore = false;
  private submitResultBanner: string | null = null;
  private submitResultTone: 'green' | 'amber' | 'red' = 'amber';
  private lastSubmittedRun: TrenchLastSubmittedRun | null = null;

  constructor(host: HostEnvironment) {
    this.host = host;
    this.trenchAudio = new TrenchAudioEngine(host.audio);
    this.leaderboard = new TrenchLeaderboardService();
    this.callsignDraft = this.leaderboard.getSavedCallsign();
    this.stickSensitivity = this.loadStickSensitivity();

    this.sim = new TrenchSimulation({
      onVulcanFiring: (firing) => this.trenchAudio.setVulcanFiring(firing),
      onGunHitConfirm: (pan) => this.trenchAudio.playGunHitConfirm(pan),
      onBonusChime: (isResupply) => this.trenchAudio.playTacticalBonusChime(isResupply),
      onMissileLaunch: (side) => this.trenchAudio.playMissileLaunch(side),
      onCmdsVoice: () => this.trenchAudio.playCmdsBettyVoice(),
      onCmdsPop: (pan, beatIndex) => this.trenchAudio.playCmdsPop(pan, beatIndex),
      onHullImpactThud: (pan) => this.trenchAudio.playHullImpactThud(pan),
      onRwrSpikeChirp: (urgent) => this.trenchAudio.playRwrSpikeChirp(urgent),
      onMuffledExplosion: (pan, heavy) => this.trenchAudio.playMuffledExplosion(pan, heavy),
      onTerrainSparkHit: (pan) => this.trenchAudio.playTerrainSparkHit(pan),
      onPullUpWarning: () => this.trenchAudio.playPullUpWarningBeep(),
      onSyncGlitch: (intensity) => {
        this.glitchIntensity = Math.max(this.glitchIntensity, intensity);
      },
    });
    this.sim.invertPitch = this.loadPitchInvert();
  }

  private loadPitchInvert(): boolean {
    try {
      const saved = window.localStorage.getItem(PITCH_STORAGE_KEY);
      if (saved === 'push_up') return true;
      if (saved === 'pull_up') return false;
    } catch {
      // Ignore storage access failures
    }
    return false; // Default to PULL BACK = UP (standard flight stick)
  }

  private savePitchInvert(pushUpToClimb: boolean): void {
    try {
      window.localStorage.setItem(PITCH_STORAGE_KEY, pushUpToClimb ? 'push_up' : 'pull_up');
    } catch {
      // Ignore storage errors
    }
  }

  private loadStickSensitivity(): StickSensitivityPreset {
    try {
      const saved = window.localStorage.getItem(SENS_STORAGE_KEY);
      if (saved === 'LOW' || saved === 'MED' || saved === 'HIGH') {
        return saved;
      }
    } catch {
      // Ignore storage errors
    }
    return 'MED';
  }

  private saveStickSensitivity(sens: StickSensitivityPreset): void {
    try {
      window.localStorage.setItem(SENS_STORAGE_KEY, sens);
    } catch {
      // Ignore storage errors
    }
  }

  private showStatusToast(
    text: string,
    tone: 'green' | 'amber' | 'red' | 'cyan',
    durationSec: number
  ): void {
    this.statusToastText = text;
    this.statusToastTone = tone;
    this.statusToastTimer = durationSec;
  }

  private isAnyOverlayModalOpen(): boolean {
    return this.osdMenuOpen || this.manifestOpen || this.controlsCardOpen;
  }

  private getLockCanvas(): HTMLCanvasElement | null {
    return document.getElementById('crt-webgl-canvas') as HTMLCanvasElement | null;
  }

  private requestCanopyPointerLock(): void {
    const canvas = this.getLockCanvas();
    if (!canvas || document.pointerLockElement === canvas) return;
    try {
      const maybePromise = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {
          // Ignore browser gesture/iframe lock rejection cleanly
        });
      }
    } catch {
      // Ignore pointer lock rejection cleanly
    }
  }

  private releasePointerLock(programmatic = true): void {
    if (document.pointerLockElement) {
      if (programmatic) {
        this.programmaticPointerUnlock = true;
      }
      try {
        document.exitPointerLock();
      } catch {
        this.programmaticPointerUnlock = false;
      }
    }
    this.pointerLocked = false;
  }

  private haltActiveFlightInputs(): void {
    this.mouseLeftDown = false;
    this.pendingMissileLaunch = false;
    this.pendingCmdsDeploy = false;
    this.stickX = 0;
    this.stickY = 0;
    this.unlockedMouseSteerActive = false;
    this.trenchAudio.setVulcanFiring(false);
    document.body.style.cursor = 'default';
  }

  private openOverlayModal(kind: 'osd' | 'manifest' | 'controls'): void {
    if (!this.isAnyOverlayModalOpen()) {
      this.wasPausedBeforeModal = this.sim.paused;
    }
    this.osdMenuOpen = kind === 'osd';
    this.manifestOpen = kind === 'manifest';
    this.controlsCardOpen = kind === 'controls';
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;

    if (this.sim.phase === 'FLYING') {
      this.sim.paused = true;
    }
    this.releasePointerLock(true);
    this.haltActiveFlightInputs();
  }

  private closeAllOverlayModals(restoreFlight: boolean): void {
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.controlsCardOpen = false;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;

    if (this.sim.phase === 'FLYING') {
      if (restoreFlight) {
        this.sim.paused = false;
        this.stickX = 0;
        this.stickY = 0;
      } else {
        this.sim.paused = this.wasPausedBeforeModal;
      }
    }
  }

  private getSystemMenuCallbacks(): SystemMenuActionCallbacks {
    return {
      onResume: () => {
        this.resumeWithPointerLock();
      },
      onRestart: () => {
        this.startSortie(true, this.lastSortieWasDrill);
      },
      onOpenLeaderboard: () => {
        this.openOverlayModal('manifest');
      },
      onExitToHub: () => {
        this.requestExitToHub();
      },
      onExtraAction: (id: string) => {
        this.handleHudButton(id);
      },
    };
  }

  private requestExitToHub(): void {
    const activeRankedFlight = this.sim.phase === 'FLYING' && !this.sim.freeFlightDrill;
    if (activeRankedFlight && !this.confirmExitPending) {
      this.confirmExitPending = true;
      this.confirmExitTimer = 4.0;
      this.host.audio.playButtonLatchLock(0.84, 0.85);
      return;
    }
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.releasePointerLock(true);
    this.host.setModalOpen(false);
    this.host.exitToMuthurOs('DERELICT TRENCH // VECTOR JET SIMULATOR DISENGAGED.');
  }

  private setPitchMode(pushUpToClimb: boolean, announceToast: boolean): void {
    this.sim.invertPitch = pushUpToClimb;
    this.savePitchInvert(pushUpToClimb);
    this.host.audio.playSfx('ui_keyclick', { pitch: pushUpToClimb ? 1.12 : 0.96 });
    if (announceToast) {
      this.showStatusToast(
        pushUpToClimb ? 'MOUSE PITCH: PUSH UP = UP' : 'MOUSE PITCH: PULL BACK = UP',
        pushUpToClimb ? 'green' : 'amber',
        2.0
      );
    }
  }

  private toggleAudioMuteWithToast(): void {
    const nextMuted = !this.host.isMuted();
    this.host.setMuted(nextMuted);
    if (!nextMuted) {
      this.host.audio.playButtonLatchLock(1.0, 0.8);
    }
    this.showStatusToast(
      nextMuted ? 'AUDIO: MUTED [M]' : 'AUDIO: ACTIVE [M]',
      nextMuted ? 'red' : 'green',
      1.2
    );
  }

  private cycleStickSensitivity(): void {
    const idx = STICK_SENS_ORDER.indexOf(this.stickSensitivity);
    this.stickSensitivity = STICK_SENS_ORDER[(idx + 1) % STICK_SENS_ORDER.length];
    this.saveStickSensitivity(this.stickSensitivity);
    this.host.audio.playSfx('ui_keyclick', { pitch: 1.08 });
    this.showStatusToast(`STICK SENSITIVITY: ${this.stickSensitivity}`, 'cyan', 1.6);
  }

  public mount(): void {
    this.unmount();
    this.listenerAbort = new AbortController();
    const signal = this.listenerAbort.signal;

    const vp = this.host.getViewport();
    this.resize(vp.width, vp.height, vp.offsetX, vp.offsetY);

    this.trenchAudio.mount();
    this.keysDown.clear();
    this.mouseLeftDown = false;
    this.pendingMissileLaunch = false;
    this.pendingCmdsDeploy = false;
    this.pointerLocked = document.pointerLockElement !== null;
    this.programmaticPointerUnlock = false;
    this.stickX = 0;
    this.stickY = 0;
    this.lastPointerUnlockMs = 0;
    this.unlockedMouseSteerActive = false;

    const layout = this.hudRenderer.getLayout(this.viewportWidth, this.viewportHeight);
    this.mouseScreenX = layout.canopyVp.x + layout.canopyVp.width * 0.5;
    this.mouseScreenY = layout.canopyVp.y + layout.canopyVp.height * 0.5;
    this.mouseInsideCanopy = false;
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.controlsCardOpen = false;
    this.wasPausedBeforeModal = false;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.hoveredButtonId = null;
    this.glitchIntensity = 0;
    this.statusToastText = null;
    this.statusToastTimer = 0;
    this.callsignEditing = false;
    this.callsignOverwriteOnNextKey = false;
    this.scoreSubmitted = false;
    this.submittingScore = false;
    this.submitResultBanner = null;
    this.submitResultTone = 'amber';
    this.lastSubmittedRun = null;
    this.lastSortieWasDrill = false;
    this.callsignDraft = this.leaderboard.getSavedCallsign();
    this.stickSensitivity = this.loadStickSensitivity();
    this.sim.invertPitch = this.loadPitchInvert();

    this.sim.resetToTitle();
    this.host.setModalOpen(false);
    this.bindListeners(signal);

    if (import.meta.env.DEV) {
      this.debugControl = null;
      this.debugGunActive = false;
      this.debugTainted = false;
      this.devAutoPilot?.setEnabled(false);

      window.__TRENCH_DEBUG__ = {
        getState: () => ({
          sector: this.sim.sectorNumber,
          score: Math.round(this.sim.score),
          kcas: this.sim.kcas,
          mach: Number(this.sim.mach.toFixed(2)),
          ralt: Math.round(this.sim.raltM),
          gLoad: Number(this.sim.gLoad.toFixed(2)),
          isStalling: this.sim.isStalling,
          throttle: Number(this.sim.throttle.toFixed(2)),
          hull: Math.round(this.sim.hull),
          gunRds: this.sim.gunAmmo,
          missiles: this.sim.missilesRemaining,
          cmds: this.sim.cmdsRemaining,
          cmdsActiveSec: Number(this.sim.cmdsActiveTimer.toFixed(2)),
          purgeDist: Math.round(this.sim.purgeDistanceM),
          lockedTargetId: this.sim.lockedTargetId,
          freeFlightDrill: this.sim.freeFlightDrill,
          invertPitch: this.sim.invertPitch,
          stickSensitivity: this.stickSensitivity,
          incomingSams: this.sim.enemySams.map((s) => ({
            id: s.id,
            sourceSiteId: s.sourceSiteId ?? null,
            x: Math.round(s.x),
            y: Math.round(s.y),
            z: Math.round(s.z),
            distM: Math.round(
              Math.hypot(s.x - this.sim.x, s.y - this.sim.y, s.z - this.sim.z)
            ),
            decoyed: s.decoyedByFlareId !== null,
          })),
          targets: this.sim.targets
            .filter((t) => !t.destroyed)
            .map((t) => ({
              id: t.id,
              kind: t.kind,
              sector: t.sectorNumber,
              x: Math.round(t.x),
              y: Math.round(t.y),
              z: Math.round(t.z),
              distM: Math.round(
                Math.hypot(t.x - this.sim.x, t.y - this.sim.y, t.z - this.sim.z)
              ),
              hp: t.hp,
            })),
          phase: this.sim.phase,
          sectorId: this.sim.sectorId,
          lockState: this.sim.lockState,
          noeMultiplier: this.sim.noeMultiplier,
          autoPilotEnabled: this.devAutoPilot?.isEnabled() ?? false,
          audio: this.trenchAudio.getLoadedAudioStats(),
        }),
        setControl: (ctrl) => {
          this.debugTainted = true;
          if (!ctrl) {
            this.debugControl = null;
            return null;
          }
          this.debugControl = { ...(this.debugControl ?? {}), ...ctrl };
          if (typeof ctrl.throttle === 'number' && Number.isFinite(ctrl.throttle)) {
            this.sim.throttle = Math.max(
              0,
              Math.min(TRENCH_CONSTANTS.MAX_THROTTLE, ctrl.throttle)
            );
          }
          return { ...this.debugControl };
        },
        fireGun: (active) => {
          this.debugTainted = true;
          this.debugGunActive = Boolean(active);
          return { firingGun: this.debugGunActive, gunRds: this.sim.gunAmmo };
        },
        fireMissile: () => {
          this.debugTainted = true;
          this.pendingMissileLaunch = true;
          return {
            queued: true,
            lockState: this.sim.lockState,
            missiles: this.sim.missilesRemaining,
          };
        },
        deployCMDS: () => {
          this.debugTainted = true;
          this.pendingCmdsDeploy = true;
          return { queued: true, cmds: this.sim.cmdsRemaining };
        },
        jumpToSector: (n) => {
          this.debugTainted = true;
          this.osdMenuOpen = false;
          this.manifestOpen = false;
          this.controlsCardOpen = false;
          this.callsignEditing = false;
          this.scoreSubmitted = false;
          this.sim.jumpToSector(n);
          return {
            sector: this.sim.sectorNumber,
            sectorId: this.sim.sectorId,
            ralt: Math.round(this.sim.raltM),
            targetsCount: this.sim.targets.length,
          };
        },
        triggerSamLaunch: () => {
          this.debugTainted = true;
          return this.sim.triggerSamLaunchNow();
        },
        setAutoPilot: (enabled) => {
          this.debugTainted = true;
          const on = Boolean(enabled);
          if (on) {
            this.osdMenuOpen = false;
            this.manifestOpen = false;
            this.controlsCardOpen = false;
            if (this.sim.phase !== 'FLYING') {
              this.startSortie(false, false);
            }
            this.sim.paused = false;
          }
          this.devAutoPilot?.setEnabled(on);
          return { autoPilotEnabled: this.devAutoPilot?.isEnabled() ?? false };
        },
      };
    }
  }

  public unmount(): void {
    if (import.meta.env.DEV) {
      delete window.__TRENCH_DEBUG__;
      this.devAutoPilot?.setEnabled(false);
      this.debugControl = null;
      this.debugGunActive = false;
      this.debugTainted = false;
    }
    this.releasePointerLock(true);
    this.host.setModalOpen(false);
    if (this.listenerAbort) {
      this.listenerAbort.abort();
      this.listenerAbort = null;
    }
    this.keysDown.clear();
    this.mouseLeftDown = false;
    this.pendingMissileLaunch = false;
    this.pendingCmdsDeploy = false;
    this.stickX = 0;
    this.stickY = 0;
    this.trenchAudio.unmount();
    this.host.audio.stopCartridgeLoops();
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.controlsCardOpen = false;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.hoveredButtonId = null;
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
  }

  public setBackgroundPaused(paused: boolean): void {
    if (paused) {
      this.releasePointerLock(true);
      this.keysDown.clear();
      this.haltActiveFlightInputs();
      this.trenchAudio.silenceAll();
    }
  }

  private bindListeners(signal: AbortSignal): void {
    // Track Browser Pointer Lock transitions: browser-initiated ESC unlock opens unified SystemMenuModal!
    document.addEventListener(
      'pointerlockchange',
      () => {
        const wasLocked = this.pointerLocked;
        this.pointerLocked = document.pointerLockElement !== null;

        if (wasLocked && !this.pointerLocked) {
          const wasProgrammatic = this.programmaticPointerUnlock;
          this.programmaticPointerUnlock = false;
          this.haltActiveFlightInputs();

          if (!wasProgrammatic) {
            this.lastPointerUnlockMs = performance.now();
            // User pressed [ESC] while Pointer Locked -> unlock directly into unified System Menu!
            if (this.sim.phase === 'FLYING' && !this.isAnyOverlayModalOpen()) {
              this.openOverlayModal('osd');
            }
          }
        } else if (this.pointerLocked) {
          this.programmaticPointerUnlock = false;
          this.hoveredButtonId = null;
          this.stickX = 0;
          this.stickY = 0;
          this.unlockedMouseSteerActive = false;
        }
      },
      { signal }
    );

    window.addEventListener(
      'keydown',
      (e) => {
        if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
          e.preventDefault();
        }
        void this.host.audio.unlock();

        // 1. Unified System Menu Modal open: delegate [1-4] quick-switch, [ESC] resume, [M] mute
        if (this.osdMenuOpen) {
          if (e.code === 'Escape' && performance.now() - this.lastPointerUnlockMs < 240) {
            return;
          }
          if (e.code === 'KeyM') {
            e.preventDefault();
            this.toggleAudioMuteWithToast();
            return;
          }
          if (e.code === 'KeyI') {
            e.preventDefault();
            this.setPitchMode(!this.sim.invertPitch, true);
            return;
          }
          if (handleSystemMenuKey(e, this.host, this.getSystemMenuCallbacks())) {
            return;
          }
          return;
        }

        // 2. Controls Quick-Card Modal open: [H] / [?] / [ESC] closes cleanly
        if (this.controlsCardOpen) {
          if (e.code === 'Escape' || e.code === 'KeyH' || e.key === '?') {
            e.preventDefault();
            this.closeAllOverlayModals(false);
            this.host.audio.playButtonLatchLock(0.92, 0.82);
            return;
          }
          if (e.code === 'KeyM') {
            e.preventDefault();
            this.toggleAudioMuteWithToast();
            return;
          }
          return;
        }

        // 3. Global Manifest Modal open: [ESC] closes; [R] / [ENTER] replays post-run or launches!
        if (this.manifestOpen) {
          if (e.code === 'Escape') {
            e.preventDefault();
            this.closeAllOverlayModals(false);
            this.host.audio.playButtonLatchLock(0.92, 0.82);
            return;
          }
          if (
            this.sim.phase !== 'FLYING' &&
            (e.code === 'KeyR' || e.code === 'Enter' || e.code === 'NumpadEnter')
          ) {
            e.preventDefault();
            this.startSortie(true, this.lastSortieWasDrill);
            return;
          }
          if (e.code === 'KeyM') {
            e.preventDefault();
            this.toggleAudioMuteWithToast();
            return;
          }
          return;
        }

        // 4. STRICT 1.2-SECOND GAME OVER KEYLOCK: ignores ALL held flight keys!
        if (this.sim.phase === 'GAME_OVER' && this.sim.gameOverLockoutTimer > 0) {
          return;
        }

        // 5. Game Over Post-Lockout Controls: opt-in [C] callsign edit vs [ENTER] submit vs [R] replay
        if (this.sim.phase === 'GAME_OVER') {
          if (this.callsignEditing && !this.scoreSubmitted && !this.sim.freeFlightDrill) {
            if (e.code === 'Escape') {
              this.callsignEditing = false;
              this.callsignOverwriteOnNextKey = false;
              this.host.audio.playSfx('ui_keyclick', { pitch: 0.85 });
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
            if (e.code === 'Enter' || e.code === 'NumpadEnter') {
              e.preventDefault();
              this.callsignEditing = false;
              this.callsignOverwriteOnNextKey = false;
              void this.submitScoreNow();
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
                this.host.audio.playSfx('ui_keyclick', { pitch: 0.98 + Math.random() * 0.1 });
              }
              return;
            }
            return;
          }

          if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            e.preventDefault();
            if (!this.sim.freeFlightDrill && !this.scoreSubmitted) {
              void this.submitScoreNow();
            } else if (!this.sim.freeFlightDrill && this.scoreSubmitted) {
              this.openOverlayModal('manifest');
            } else {
              this.startSortie(true, this.lastSortieWasDrill);
            }
            return;
          }
          if (e.code === 'KeyR') {
            e.preventDefault();
            this.startSortie(true, this.lastSortieWasDrill);
            return;
          }
          if (e.code === 'KeyC' && !this.scoreSubmitted && !this.sim.freeFlightDrill) {
            this.callsignEditing = true;
            this.callsignOverwriteOnNextKey = true;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.12 });
            return;
          }
        }

        // 6. [ESC] NEVER auto-exits to Hub! Always opens unified SystemMenuModal safely.
        if (e.code === 'Escape') {
          if (performance.now() - this.lastPointerUnlockMs < 240) {
            return;
          }
          this.openOverlayModal('osd');
          this.host.audio.playButtonLatchLock(0.95, 0.85);
          return;
        }

        // 7. [H] / [?] Universal 1-Glance Controls Quick-Card (pauses sim cleanly)
        if (e.code === 'KeyH' || e.key === '?') {
          e.preventDefault();
          this.openOverlayModal('controls');
          this.host.audio.playButtonLatchLock(1.0, 0.85);
          return;
        }

        // 8. [M] Universal Audio Mute Toggle (moved System Menu to [ESC]!)
        if (e.code === 'KeyM' && !e.repeat) {
          e.preventDefault();
          this.toggleAudioMuteWithToast();
          return;
        }

        // 9. [I] Immediate Pitch-Invert Toggle with 2.0s Centered HUD Toast!
        if (e.code === 'KeyI' && !e.repeat) {
          e.preventDefault();
          this.setPitchMode(!this.sim.invertPitch, true);
          return;
        }

        // 10. [P] Universal Quick-Pause (Amber CRT PauseBanner)
        if (e.code === 'KeyP' && !e.repeat && this.sim.phase === 'FLYING') {
          e.preventDefault();
          if (this.sim.paused) {
            this.resumeWithPointerLock();
          } else {
            this.sim.paused = true;
            this.releasePointerLock(true);
            this.haltActiveFlightInputs();
            this.host.audio.playButtonLatchLock(0.95, 0.85);
          }
          return;
        }

        // 11. [TAB] Cleanly kept as Target Cycle during active flight!
        if (e.code === 'Tab') {
          if (this.sim.phase === 'FLYING' && !this.sim.paused) {
            if (this.sim.cycleTarget()) {
              this.host.audio.playSfx('ui_keyclick', { pitch: 1.22 });
            }
          }
          return;
        }

        // 12. [C] / [F] CMDS Chaff & Flare Salvo
        if (
          (e.code === 'KeyC' || e.code === 'KeyF') &&
          !e.repeat &&
          this.sim.phase === 'FLYING' &&
          !this.sim.paused
        ) {
          this.pendingCmdsDeploy = true;
          return;
        }

        // 13. Launch from Title via [ENTER]
        if (this.sim.phase === 'TITLE' && (e.code === 'Enter' || e.code === 'NumpadEnter')) {
          e.preventDefault();
          this.startSortie(true, false);
          return;
        }

        // 14. [SPACE] Launches locked AIM-9 Missile during active flight
        if (
          e.code === 'Space' &&
          !e.repeat &&
          this.sim.phase === 'FLYING' &&
          !this.sim.paused
        ) {
          this.pendingMissileLaunch = true;
          return;
        }

        this.keysDown.add(e.code);
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
      'contextmenu',
      (e) => {
        e.preventDefault();
      },
      { signal }
    );

    window.addEventListener(
      'auxclick',
      (e) => {
        if (e.button === 1) e.preventDefault();
      },
      { signal }
    );

    // Raw Pointer Lock mouse-joy accumulator with persisted LOW / MED / HIGH sensitivity
    window.addEventListener(
      'mousemove',
      (e) => {
        if (
          this.pointerLocked &&
          this.sim.phase === 'FLYING' &&
          !this.sim.paused &&
          !this.isAnyOverlayModalOpen()
        ) {
          const sens = STICK_SENS_SCALE[this.stickSensitivity];
          const mx = Math.max(-140, Math.min(140, e.movementX));
          const my = Math.max(-140, Math.min(140, e.movementY));
          this.stickX += mx * sens;
          this.stickY += my * sens;

          const len = Math.hypot(this.stickX, this.stickY);
          if (len > 1) {
            this.stickX /= len;
            this.stickY /= len;
          }
          return;
        }

        const mapped = this.host.webglCrt.mapClientToCrtUv(
          e.clientX - this.offsetX,
          e.clientY - this.offsetY,
          this.crtRect,
          this.host.getCrtIntensity()
        );
        if (!mapped.inside) {
          this.hoveredButtonId = null;
          this.mouseInsideCanopy = false;
          document.body.style.cursor = 'default';
          return;
        }
        const cx = mapped.u * this.crtRect.width;
        const cy = mapped.v * this.crtRect.height;
        this.mouseScreenX = cx;
        this.mouseScreenY = cy;

        const layout = this.hudRenderer.getLayout(this.viewportWidth, this.viewportHeight);
        const vp = layout.canopyVp;
        this.mouseInsideCanopy =
          cx >= vp.x && cx <= vp.x + vp.width && cy >= vp.y && cy <= vp.y + vp.height;

        const hit = this.hudRenderer.hitTestButton(cx, cy);
        this.hoveredButtonId = hit;

        if (
          !this.pointerLocked &&
          this.mouseInsideCanopy &&
          !hit &&
          this.sim.phase === 'FLYING' &&
          !this.sim.paused &&
          !this.isAnyOverlayModalOpen()
        ) {
          this.unlockedMouseSteerActive = true;
          const halfSpan = Math.max(120, Math.min(vp.width, vp.height) * 0.36);
          const rawX = (cx - (vp.x + vp.width * 0.5)) / halfSpan;
          const rawY = (cy - (vp.y + vp.height * 0.5)) / halfSpan;
          const len = Math.hypot(rawX, rawY);
          if (len > 1) {
            this.stickX = rawX / len;
            this.stickY = rawY / len;
          } else {
            this.stickX = rawX;
            this.stickY = rawY;
          }
        } else if (!this.pointerLocked && !this.mouseInsideCanopy) {
          this.unlockedMouseSteerActive = false;
          this.stickX = 0;
          this.stickY = 0;
        }

        if (hit) {
          document.body.style.cursor = 'pointer';
        } else if (
          this.mouseInsideCanopy &&
          this.sim.phase === 'FLYING' &&
          !this.sim.paused &&
          !this.isAnyOverlayModalOpen()
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
        void this.host.audio.unlock();
        if (e.button === 1) {
          e.preventDefault();
        }

        if (
          this.pointerLocked &&
          this.sim.phase === 'FLYING' &&
          !this.sim.paused &&
          !this.isAnyOverlayModalOpen()
        ) {
          if (e.button === 0) {
            this.mouseLeftDown = true;
          } else if (e.button === 2) {
            this.pendingMissileLaunch = true;
          } else if (e.button === 1) {
            if (this.sim.cycleTarget()) {
              this.host.audio.playSfx('ui_keyclick', { pitch: 1.22 });
            }
          }
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

        if (e.button === 0) {
          const hit = this.hudRenderer.hitTestButton(cx, cy);
          if (hit) {
            this.handleHudButton(hit);
            return;
          }
        }

        const layout = this.hudRenderer.getLayout(this.viewportWidth, this.viewportHeight);
        const vp = layout.canopyVp;
        const inCanopy =
          cx >= vp.x && cx <= vp.x + vp.width && cy >= vp.y && cy <= vp.y + vp.height;

        if (
          inCanopy &&
          this.sim.phase === 'FLYING' &&
          !this.sim.paused &&
          !this.isAnyOverlayModalOpen()
        ) {
          this.confirmExitPending = false;
          if (e.button === 0) {
            this.mouseLeftDown = true;
            this.requestCanopyPointerLock();
          } else if (e.button === 2) {
            this.pendingMissileLaunch = true;
          } else if (e.button === 1) {
            if (this.sim.cycleTarget()) {
              this.host.audio.playSfx('ui_keyclick', { pitch: 1.22 });
            }
          }
        }
      },
      { signal }
    );

    window.addEventListener(
      'pointerup',
      (e) => {
        if (e.button === 0) this.mouseLeftDown = false;
      },
      { signal }
    );

    window.addEventListener(
      'blur',
      () => {
        this.keysDown.clear();
        this.haltActiveFlightInputs();
      },
      { signal }
    );

    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (mobileInput) {
      mobileInput.addEventListener(
        'input',
        () => {
          if (this.sim.phase !== 'GAME_OVER' || this.scoreSubmitted || this.sim.freeFlightDrill) {
            return;
          }
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
            !this.scoreSubmitted &&
            !this.sim.freeFlightDrill
          ) {
            ev.preventDefault();
            this.callsignEditing = false;
            this.callsignOverwriteOnNextKey = false;
            mobileInput.blur();
            void this.submitScoreNow();
          }
        },
        { signal }
      );
    }
  }

  private startSortie(lockPointer: boolean, freeFlightDrill = false): void {
    this.runPlaytimeSec = 0;
    this.lastSortieWasDrill = freeFlightDrill;
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.controlsCardOpen = false;
    this.wasPausedBeforeModal = false;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.callsignEditing = false;
    this.callsignOverwriteOnNextKey = false;
    this.scoreSubmitted = false;
    this.submittingScore = false;
    this.submitResultBanner = null;
    this.submitResultTone = 'amber';
    this.lastSubmittedRun = null;
    this.keysDown.clear();
    this.haltActiveFlightInputs();

    this.host.audio.playButtonLatchLock(1.0, 0.9);
    this.sim.startNewFlight({ freeFlightDrill });
    if (freeFlightDrill) {
      this.showStatusToast(
        'FREE-FLIGHT DRILL ACTIVE — FORGIVING TERRAIN BOUNCE & REDUCED SAM THREAT',
        'cyan',
        2.6
      );
    }
    if (lockPointer && !this.host.isTouchDevice()) {
      this.requestCanopyPointerLock();
    }
  }

  private resumeWithPointerLock(): void {
    this.closeAllOverlayModals(true);
    if (this.sim.phase === 'FLYING' && !this.host.isTouchDevice()) {
      this.requestCanopyPointerLock();
    }
  }

  private async submitScoreNow(): Promise<void> {
    if (this.sim.freeFlightDrill) return;
    if (import.meta.env.DEV && this.debugTainted) {
      this.submitResultBanner = 'DEV DEBUG SESSION — RELAY WRITE BLOCKED';
      this.submitResultTone = 'red';
      return;
    }
    if (this.scoreSubmitted || this.submittingScore || this.sim.gameOverLockoutTimer > 0) return;
    this.submittingScore = true;
    this.submitResultBanner = 'TRANSMITTING TO ORBITAL RELAY...';
    this.submitResultTone = 'amber';

    const cleanCallsign = sanitizeCallsignDraft(this.callsignDraft);
    const finalScore = Math.max(1, Math.round(this.sim.score));
    const finalDist = Math.max(0, Math.round(this.sim.distanceFlownM));
    const finalMach = Math.round(this.sim.maxMach * 10) / 10;
    const finalKills = Math.max(0, Math.round(this.sim.targetsDestroyed));

    const res = await this.leaderboard.submitScore({
      callsign: cleanCallsign,
      score: finalScore,
      distance: finalDist,
      maxMach: finalMach,
      grazes: finalKills,
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
      distance: finalDist,
      maxMach: finalMach,
      grazes: finalKills,
      rank: res.rank,
    };
    this.submitResultBanner = res.online
      ? `LOGGED TO ORBITAL RELAY // RANK #${res.rank}`
      : `SAVED TO LOCAL TAPE ARCHIVE // RANK #${res.rank}`;
    this.submitResultTone = 'green';
    this.openOverlayModal('manifest');
    this.host.audio.playButtonLatchLock(1.04, 0.9);
  }

  private handleHudButton(id: string): void {
    // Delegate shared System Menu actions first when System Menu is open
    if (this.osdMenuOpen) {
      if (handleSystemMenuAction(id, this.host, this.getSystemMenuCallbacks())) {
        return;
      }
    }

    switch (id) {
      // Top Chrome Bar (unified pills)
      case TOP_CHROME_IDS.CRT: {
        const next = this.host.toggle1979Crt();
        this.showStatusToast(
          next === 'CLASSIC_1979' ? '1979 CRT MODE: ON' : '1979 CRT MODE: OFF (CLEAN)',
          next === 'CLASSIC_1979' ? 'amber' : 'green',
          1.4
        );
        return;
      }
      case TOP_CHROME_IDS.CONTROLS:
      case PAUSE_BANNER_IDS.CONTROLS:
      case TRENCH_UI_IDS.TITLE_CONTROLS:
        this.host.audio.playButtonLatchLock(1.0, 0.85);
        if (this.controlsCardOpen) {
          this.closeAllOverlayModals(false);
        } else {
          this.openOverlayModal('controls');
        }
        return;
      case TOP_CHROME_IDS.AUDIO:
        this.toggleAudioMuteWithToast();
        return;
      case TOP_CHROME_IDS.MENU:
      case PAUSE_BANNER_IDS.MENU:
      case TRENCH_UI_IDS.TITLE_MENU:
        this.host.audio.playButtonLatchLock(0.96, 0.85);
        if (this.osdMenuOpen) {
          this.resumeWithPointerLock();
        } else {
          this.openOverlayModal('osd');
        }
        return;
      case TOP_CHROME_IDS.HUB:
        this.requestExitToHub();
        return;

      // Pause Banner & Controls Quick-Card Close
      case PAUSE_BANNER_IDS.RESUME:
        this.host.audio.playButtonLatchLock(1.02, 0.85);
        this.resumeWithPointerLock();
        return;
      case CONTROLS_CARD_IDS.CLOSE:
        this.host.audio.playButtonLatchLock(0.92, 0.82);
        this.closeAllOverlayModals(false);
        return;

      // Title Screen & Game-Specific Menu Actions
      case TRENCH_UI_IDS.START_RANKED:
        this.startSortie(true, false);
        return;
      case TRENCH_UI_IDS.START_DRILL:
        this.startSortie(true, true);
        return;
      case TRENCH_UI_IDS.PITCH_ARCADE:
        this.setPitchMode(true, true);
        return;
      case TRENCH_UI_IDS.PITCH_SIM:
        this.setPitchMode(false, true);
        return;
      case TRENCH_UI_IDS.TOGGLE_INVERT:
        this.setPitchMode(!this.sim.invertPitch, true);
        return;
      case TRENCH_UI_IDS.CYCLE_SENS:
        this.cycleStickSensitivity();
        return;
      case TRENCH_UI_IDS.TITLE_MANIFEST:
        this.host.audio.playButtonLatchLock(1.0, 0.85);
        this.openOverlayModal('manifest');
        return;

      // Post-Run Debrief & Global Manifest Shared IDs
      case POST_RUN_IDS.CALLSIGN_BOX: {
        if (!this.scoreSubmitted && !this.sim.freeFlightDrill) {
          this.callsignEditing = true;
          this.callsignOverwriteOnNextKey = true;
          this.host.audio.playSfx('ui_keyclick', { pitch: 1.12 });
          const mobileInput = document.getElementById(
            'mobile-callsign-input'
          ) as HTMLInputElement | null;
          if (mobileInput) {
            mobileInput.maxLength = CALLSIGN_MAX_LEN;
            mobileInput.value = this.callsignDraft;
            mobileInput.focus();
          }
        }
        return;
      }
      case POST_RUN_IDS.SUBMIT_SCORE:
        this.host.audio.playButtonLatchLock(1.0, 0.85);
        void this.submitScoreNow();
        return;
      case POST_RUN_IDS.PLAY_AGAIN:
      case POST_RUN_IDS.MANIFEST_PLAY_AGAIN:
        this.startSortie(true, this.lastSortieWasDrill);
        return;
      case POST_RUN_IDS.OPEN_MANIFEST:
        this.host.audio.playButtonLatchLock(1.0, 0.85);
        this.openOverlayModal('manifest');
        return;
      case POST_RUN_IDS.MANIFEST_CLOSE:
        this.host.audio.playButtonLatchLock(0.92, 0.82);
        this.closeAllOverlayModals(false);
        return;
      case POST_RUN_IDS.EXIT_HUB:
        this.host.audio.playButtonLatchLock(0.9, 0.85);
        this.requestExitToHub();
        return;
    }
  }

  private buildFlightInput(canopyVp: ViewportRect): {
    input: F16FlightInput;
    stickNormX: number;
    stickNormY: number;
    deadzonePx: number;
  } {
    const minDim = Math.min(canopyVp.width, canopyVp.height);
    const deadzoneFrac = 0.04;
    const deadzonePx = Math.max(12, Math.round(minDim * 0.024));

    let stickRoll = 0;
    let stickPitch = 0;
    let effectiveStickX = this.pointerLocked || this.unlockedMouseSteerActive ? this.stickX : 0;
    let effectiveStickY = this.pointerLocked || this.unlockedMouseSteerActive ? this.stickY : 0;

    const flightLive =
      this.sim.phase === 'FLYING' && !this.sim.paused && !this.isAnyOverlayModalOpen();

    if (flightLive) {
      const kbRoll =
        (this.keysDown.has('ArrowRight') ? 0.78 : 0) - (this.keysDown.has('ArrowLeft') ? 0.78 : 0);
      const kbPitch =
        (this.keysDown.has('ArrowDown') ? 0.72 : 0) - (this.keysDown.has('ArrowUp') ? 0.72 : 0);
      if (kbRoll !== 0 || kbPitch !== 0) {
        effectiveStickX = Math.max(-1, Math.min(1, effectiveStickX + kbRoll));
        effectiveStickY = Math.max(-1, Math.min(1, effectiveStickY + kbPitch));
      }

      const mag = Math.hypot(effectiveStickX, effectiveStickY);
      if (mag > deadzoneFrac) {
        const effMag = Math.min(1, (mag - deadzoneFrac) / (1 - deadzoneFrac));
        const curved = Math.pow(effMag, 1.65);
        stickRoll = (effectiveStickX / mag) * curved;
        stickPitch = (effectiveStickY / mag) * curved;
      }
    }

    let throttleDelta = 0;
    if (this.keysDown.has('KeyW')) throttleDelta += 1;
    if (this.keysDown.has('KeyS')) throttleDelta -= 1;

    let rudderInput = 0;
    if (this.keysDown.has('KeyA')) rudderInput -= 1;
    if (this.keysDown.has('KeyD')) rudderInput += 1;

    const launchMissilePressed = flightLive ? this.pendingMissileLaunch : false;
    this.pendingMissileLaunch = false;

    const deployCmdsPressed = flightLive ? this.pendingCmdsDeploy : false;
    this.pendingCmdsDeploy = false;

    if (import.meta.env.DEV && flightLive && this.debugControl) {
      if (typeof this.debugControl.stickX === 'number') {
        stickRoll = Math.max(-1, Math.min(1, this.debugControl.stickX));
        effectiveStickX = stickRoll;
      }
      if (typeof this.debugControl.stickY === 'number') {
        stickPitch = Math.max(-1, Math.min(1, this.debugControl.stickY));
        effectiveStickY = stickPitch;
      }
      if (typeof this.debugControl.rudder === 'number') {
        rudderInput = Math.max(-1, Math.min(1, this.debugControl.rudder));
      }
      if (typeof this.debugControl.throttle === 'number') {
        const targetTh = Math.max(
          0,
          Math.min(TRENCH_CONSTANTS.MAX_THROTTLE, this.debugControl.throttle)
        );
        this.sim.throttle = targetTh;
        throttleDelta = 0;
      }
    }

    return {
      input: {
        stickRoll,
        stickPitch,
        throttleDelta,
        rudderInput,
        firingGun: flightLive && (this.mouseLeftDown || (import.meta.env.DEV && this.debugGunActive)),
        launchMissilePressed,
        deployCmdsPressed,
      },
      stickNormX: effectiveStickX,
      stickNormY: effectiveStickY,
      deadzonePx,
    };
  }

  public updateAndRender(
    dt: number,
    ctx: CanvasRenderingContext2D,
    totalTimeSec: number
  ): CrtShaderFrameParams {
    const clampedDt = Math.min(0.05, Math.max(0, dt));
    if (this.glitchIntensity > 0) {
      this.glitchIntensity = Math.max(0, this.glitchIntensity - clampedDt * 2.1);
    }
    if (this.statusToastTimer > 0) {
      this.statusToastTimer = Math.max(0, this.statusToastTimer - clampedDt);
      if (this.statusToastTimer <= 0) {
        this.statusToastText = null;
      }
    }
    if (this.confirmExitPending) {
      this.confirmExitTimer = Math.max(0, this.confirmExitTimer - clampedDt);
      if (this.confirmExitTimer <= 0) {
        this.confirmExitPending = false;
      }
    }

    const anyOverlayOpen = this.isAnyOverlayModalOpen();
    const layout = this.hudRenderer.getLayout(this.viewportWidth, this.viewportHeight);
    let { input, stickNormX, stickNormY, deadzonePx } = this.buildFlightInput(layout.canopyVp);

    if (
      import.meta.env.DEV &&
      this.devAutoPilot?.isEnabled() &&
      this.sim.phase === 'FLYING' &&
      !this.sim.paused &&
      !anyOverlayOpen
    ) {
      const ap = this.devAutoPilot.computeInput(this.sim, clampedDt);
      input = {
        ...ap,
        firingGun: ap.firingGun || this.debugGunActive || this.mouseLeftDown,
        launchMissilePressed: ap.launchMissilePressed || input.launchMissilePressed,
        deployCmdsPressed: ap.deployCmdsPressed || input.deployCmdsPressed,
      };
      stickNormX = ap.stickRoll;
      stickNormY = ap.stickPitch;
    }

    // CRITICAL SAFETY: Auto-pause simulation whenever ANY modal (MANIFEST, OSD, CONTROLS) is open!
    if (!anyOverlayOpen) {
      this.sim.step(clampedDt, input);
    } else if (this.sim.gunFiringNow) {
      this.sim.gunFiringNow = false;
      this.trenchAudio.setVulcanFiring(false);
    }

    // Immediately release Pointer Lock & clear held keys on airframe loss
    if (
      this.sim.phase === 'GAME_OVER' &&
      (this.pointerLocked ||
        this.keysDown.size > 0 ||
        this.mouseLeftDown ||
        this.unlockedMouseSteerActive)
    ) {
      this.releasePointerLock(true);
      this.keysDown.clear();
      this.haltActiveFlightInputs();
      this.callsignEditing = false;
      this.callsignOverwriteOnNextKey = false;
    }

    const flyingActive = this.sim.phase === 'FLYING' && !this.sim.paused && !anyOverlayOpen;
    if (flyingActive) {
      this.runPlaytimeSec += clampedDt;
    }
    this.trenchAudio.updateCockpitEngine(
      flyingActive,
      this.sim.throttle,
      this.sim.mach,
      this.sim.gLoad,
      this.sim.stallFactor
    );
    this.trenchAudio.updateSeekerTone(
      flyingActive && this.sim.missilesRemaining > 0,
      this.sim.lockState,
      this.sim.lockedTargetInSeeker,
      this.sim.lockProgress
    );
    this.trenchAudio.updateRwrMissileWarble(flyingActive && this.sim.samIncomingActive);

    // Notify host for crisp modal chromatic aberration reduction (0.06 modals / 0.22 play)
    const modalActive =
      anyOverlayOpen ||
      this.sim.phase === 'GAME_OVER' ||
      (this.sim.phase === 'FLYING' && this.sim.paused);
    this.host.setModalOpen(modalActive);

    // 1. Render 1st-Person 3D Wireframe Heightmap Canyon, Threats, Semiotic Pods, Tracers & Flares
    this.renderer.render(ctx, this.sim, layout.canopyVp, totalTimeSec);

    // 2. Render Canopy HUD + Nostromo Annunciator Strip + Consolidated 3-MFD Cluster + Shared Chrome
    this.hudRenderer.render(ctx, {
      width: this.viewportWidth,
      height: this.viewportHeight,
      timeSec: totalTimeSec,
      sim: this.sim,
      leaderboard: this.leaderboard,
      hoveredButtonId: this.hoveredButtonId,
      mouseScreenX: this.mouseScreenX,
      mouseScreenY: this.mouseScreenY,
      mouseInsideCanopy: this.mouseInsideCanopy,
      stickNormX,
      stickNormY,
      stickDeadzonePx: deadzonePx,
      pointerLocked: this.pointerLocked,
      projectWorld: (wx, wy, wz) => this.renderer.projectWorld(this.sim, wx, wy, wz),
      audioMuted: this.host.isMuted(),
      isFullscreen: this.host.getViewport().isFullscreen,
      crtPreset: this.host.getCrtPreset(),
      phosphorTheme: this.host.getPhosphorTheme(),
      masterVolume: this.host.getMasterVolume(),
      isTouchDevice: this.host.isTouchDevice(),
      stickSensitivityLabel: this.stickSensitivity,
      confirmExitPending: this.confirmExitPending,
      osdMenuOpen: this.osdMenuOpen,
      manifestOpen: this.manifestOpen,
      controlsCardOpen: this.controlsCardOpen,
      statusToastText: this.statusToastText,
      statusToastTone: this.statusToastTone,
      statusToastAlpha: this.statusToastTimer > 0 ? Math.min(1, this.statusToastTimer / 0.35) : 0,
      callsignDraft: this.callsignDraft,
      callsignEditing: this.callsignEditing,
      scoreSubmitted: this.scoreSubmitted,
      submittingScore: this.submittingScore,
      submitResultBanner: this.submitResultBanner,
      submitResultTone: this.submitResultTone,
      lastSubmittedRun: this.lastSubmittedRun,
    });

    const shockwaves: CrtShockwaveUniform[] = this.sim.crtShockwaves.map((sw) => {
      const p = Math.min(1, sw.age / Math.max(0.01, sw.duration));
      return {
        uvX: sw.uvX,
        uvY: sw.uvY,
        radius: sw.maxRadiusNorm * Math.pow(p, 0.55),
        intensity: sw.peakIntensity * Math.pow(1 - p, 1.3),
      };
    });

    const dangerInterference =
      flyingActive && (this.sim.samIncomingActive || this.sim.purgeThermalAlert || this.sim.pullUpWarning)
        ? 0.036
        : 0.01;

    return {
      interference: dangerInterference,
      glitch: this.glitchIntensity,
      overdrive: (this.sim.afterburning || this.sim.purgeThermalAlert) && flyingActive ? 0.28 : 0,
      tubeTurnOn: 0,
      shockwaves,
      chromaScale: modalActive ? 0.06 : 0.22,
      modalActive,
    };
  }
}
