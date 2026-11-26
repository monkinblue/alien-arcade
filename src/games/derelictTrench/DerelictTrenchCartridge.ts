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
import { TrenchHudRenderer } from './TrenchHudRenderer';
import { TrenchLeaderboardService } from './TrenchLeaderboard';
import { TrenchRenderer } from './TrenchRenderer';
import { TrenchSimulation, type F16FlightInput } from './TrenchSimulation';
import { TRENCH_CONSTANTS, type TrenchLastSubmittedRun } from './types';

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
  private stickX = 0;
  private stickY = 0;
  private lastPointerUnlockMs = 0;
  private unlockedMouseSteerActive = false;

  private mouseScreenX = 640;
  private mouseScreenY = 300;
  private mouseInsideCanopy = false;
  private hoveredButtonId: string | null = null;

  private osdMenuOpen = false;
  private manifestOpen = false;
  private glitchIntensity = 0;

  private callsignDraft = 'VECTOR-04';
  private runPlaytimeSec = 0;
  private callsignEditing = false;
  private callsignOverwriteOnNextKey = false;
  private scoreSubmitted = false;
  private submittingScore = false;
  private submitResultBanner: string | null = null;
  private lastSubmittedRun: TrenchLastSubmittedRun | null = null;

  constructor(host: HostEnvironment) {
    this.host = host;
    this.trenchAudio = new TrenchAudioEngine(host.audio);
    this.leaderboard = new TrenchLeaderboardService();
    this.callsignDraft = this.leaderboard.getSavedCallsign();

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

  private releasePointerLock(): void {
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock();
      } catch {
        // Ignore
      }
    }
    this.pointerLocked = false;
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
    this.hoveredButtonId = null;
    this.glitchIntensity = 0;
    this.callsignEditing = false;
    this.callsignOverwriteOnNextKey = false;
    this.scoreSubmitted = false;
    this.submittingScore = false;
    this.submitResultBanner = null;
    this.lastSubmittedRun = null;
    this.callsignDraft = this.leaderboard.getSavedCallsign();

    this.sim.resetToTitle();
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
            if (this.sim.phase !== 'FLYING') {
              this.startSortie(false);
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
    this.releasePointerLock();
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
      this.releasePointerLock();
      this.keysDown.clear();
      this.mouseLeftDown = false;
      this.pendingMissileLaunch = false;
      this.pendingCmdsDeploy = false;
      this.trenchAudio.silenceAll();
    }
  }

  private bindListeners(signal: AbortSignal): void {
    // Track Browser Pointer Lock transitions cleanly (ESC releases Pointer Lock -> pauses flight!)
    document.addEventListener(
      'pointerlockchange',
      () => {
        const wasLocked = this.pointerLocked;
        this.pointerLocked = document.pointerLockElement !== null;

        if (wasLocked && !this.pointerLocked) {
          this.lastPointerUnlockMs = performance.now();
          this.mouseLeftDown = false;
          this.stickX = 0;
          this.stickY = 0;
          this.trenchAudio.setVulcanFiring(false);
          document.body.style.cursor = 'default';

          // Pressing ESC exits Pointer Lock & cleanly pauses active flight!
          if (this.sim.phase === 'FLYING' && !this.osdMenuOpen && !this.manifestOpen) {
            this.sim.paused = true;
          }
        } else if (this.pointerLocked) {
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

        // STRICT 1.2-SECOND GAME OVER INPUT LOCKOUT: ignores ALL held W/S/A/D flight keys!
        if (this.sim.phase === 'GAME_OVER' && this.sim.gameOverLockoutTimer > 0) {
          return;
        }

        // Game Over Post-Lockout Controls: cleanly separate Callsign Editing vs. Submit [ENTER] vs. Quick Relaunch [SPACE / R]!
        if (
          this.sim.phase === 'GAME_OVER' &&
          !this.osdMenuOpen &&
          !this.manifestOpen
        ) {
          if (this.callsignEditing && !this.scoreSubmitted) {
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
            if (!this.scoreSubmitted) {
              void this.submitScoreNow();
            } else {
              this.startSortie(true);
            }
            return;
          }
          if (e.code === 'Space' || e.code === 'KeyR') {
            e.preventDefault();
            this.startSortie(true);
            return;
          }
          if (e.code === 'KeyC' && !this.scoreSubmitted) {
            this.callsignEditing = true;
            this.callsignOverwriteOnNextKey = true;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.12 });
            return;
          }
        }

        // TAB during active flight cycles missile/LCOS targets cleanly!
        if (e.code === 'Tab') {
          if (
            this.sim.phase === 'FLYING' &&
            !this.sim.paused &&
            !this.osdMenuOpen &&
            !this.manifestOpen
          ) {
            if (this.sim.cycleTarget()) {
              this.host.audio.playSfx('ui_keyclick', { pitch: 1.22 });
            }
          } else if (this.osdMenuOpen) {
            this.osdMenuOpen = false;
            if (this.sim.phase === 'FLYING') this.sim.paused = false;
            this.host.audio.playButtonLatchLock(0.92, 0.85);
          }
          return;
        }

        // [M] toggles System & Command Menu cleanly
        if (e.code === 'KeyM') {
          this.manifestOpen = false;
          this.osdMenuOpen = !this.osdMenuOpen;
          if (this.sim.phase === 'FLYING') {
            this.sim.paused = this.osdMenuOpen;
          }
          if (this.osdMenuOpen) {
            this.releasePointerLock();
            this.mouseLeftDown = false;
            this.trenchAudio.setVulcanFiring(false);
            document.body.style.cursor = 'default';
          }
          this.host.audio.playButtonLatchLock(0.96, 0.85);
          return;
        }

        if (e.code === 'Escape') {
          // If browser JUST unlocked pointer lock on this ESC keystroke, stay paused rather than exiting OS!
          if (performance.now() - this.lastPointerUnlockMs < 220) {
            return;
          }
          if (this.osdMenuOpen) {
            this.osdMenuOpen = false;
            if (this.sim.phase === 'FLYING') this.sim.paused = false;
            this.host.audio.playButtonLatchLock(0.9, 0.8);
            return;
          }
          if (this.manifestOpen) {
            this.manifestOpen = false;
            this.host.audio.playButtonLatchLock(0.9, 0.8);
            return;
          }
          if (this.sim.phase === 'FLYING' && !this.sim.paused) {
            this.releasePointerLock();
            this.sim.paused = true;
            this.mouseLeftDown = false;
            this.stickX = 0;
            this.stickY = 0;
            this.trenchAudio.setVulcanFiring(false);
            this.host.audio.playButtonLatchLock(0.92, 0.85);
            return;
          }
          this.host.exitToMuthurOs('DERELICT TRENCH // VECTOR JET SIMULATOR DISENGAGED.');
          return;
        }

        if (
          e.code === 'KeyP' &&
          this.sim.phase === 'FLYING' &&
          !this.osdMenuOpen &&
          !this.manifestOpen
        ) {
          this.sim.paused = !this.sim.paused;
          if (this.sim.paused) {
            this.releasePointerLock();
            this.mouseLeftDown = false;
            this.stickX = 0;
            this.stickY = 0;
            this.trenchAudio.setVulcanFiring(false);
          }
          this.host.audio.playButtonLatchLock(0.95, 0.85);
          return;
        }

        if (e.code === 'KeyI' && !this.osdMenuOpen && !this.manifestOpen) {
          this.sim.invertPitch = !this.sim.invertPitch;
          this.host.audio.playSfx('ui_keyclick', { pitch: 1.08 });
          return;
        }

        // [C] or [F] deploys Chaff / Flare Countermeasure Salvo (CMDS)!
        if (
          (e.code === 'KeyC' || e.code === 'KeyF') &&
          !e.repeat &&
          this.sim.phase === 'FLYING' &&
          !this.sim.paused &&
          !this.osdMenuOpen &&
          !this.manifestOpen
        ) {
          this.pendingCmdsDeploy = true;
          return;
        }

        if (this.sim.phase === 'TITLE' && (e.code === 'Enter' || e.code === 'Space')) {
          this.startSortie(true);
          return;
        }

        // SPACE launches locked AIM-9 / AGM missile during active flight!
        if (
          e.code === 'Space' &&
          !e.repeat &&
          this.sim.phase === 'FLYING' &&
          !this.sim.paused &&
          !this.osdMenuOpen &&
          !this.manifestOpen
        ) {
          this.pendingMissileLaunch = true;
          return;
        }

        if (
          this.sim.phase === 'GAME_OVER' &&
          this.scoreSubmitted &&
          (e.code === 'KeyR' || e.code === 'Enter') &&
          !this.osdMenuOpen &&
          !this.manifestOpen
        ) {
          this.startSortie(false);
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

    // Raw Pointer Lock mouse-joy accumulator (War Thunder / Project Wingman style!)
    window.addEventListener(
      'mousemove',
      (e) => {
        if (
          this.pointerLocked &&
          this.sim.phase === 'FLYING' &&
          !this.sim.paused &&
          !this.osdMenuOpen &&
          !this.manifestOpen
        ) {
          const sens = 0.0028;
          const mx = Math.max(-140, Math.min(140, e.movementX));
          const my = Math.max(-140, Math.min(140, e.movementY));
          this.stickX += mx * sens;
          this.stickY += my * sens;

          // Smooth circular clamp inside [-1, 1] unit stick disk!
          const len = Math.hypot(this.stickX, this.stickY);
          if (len > 1) {
            this.stickX /= len;
            this.stickY /= len;
          }
          return;
        }

        // Unlocked cursor hover tracking for menus, launch screen, and top bar pills
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

        // Dual-Mode Seamless Fallback: when unlocked during active flight, moving cursor inside canopy
        // drives a responsive cursor-offset virtual flight stick (zero dead-stick moments!).
        if (
          !this.pointerLocked &&
          this.mouseInsideCanopy &&
          !hit &&
          this.sim.phase === 'FLYING' &&
          !this.sim.paused &&
          !this.osdMenuOpen &&
          !this.manifestOpen
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
          !this.osdMenuOpen &&
          !this.manifestOpen
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

        // While Pointer Locked during active flight: direct HOTAS mouse triggers!
        if (
          this.pointerLocked &&
          this.sim.phase === 'FLYING' &&
          !this.sim.paused &&
          !this.osdMenuOpen &&
          !this.manifestOpen
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

        // Clicking inside canopy while unlocked during active flight engages Pointer Lock immediately!
        const layout = this.hudRenderer.getLayout(this.viewportWidth, this.viewportHeight);
        const vp = layout.canopyVp;
        const inCanopy =
          cx >= vp.x && cx <= vp.x + vp.width && cy >= vp.y && cy <= vp.y + vp.height;

        if (
          inCanopy &&
          this.sim.phase === 'FLYING' &&
          !this.sim.paused &&
          !this.osdMenuOpen &&
          !this.manifestOpen
        ) {
          if (e.button === 0) {
            // Fire 20mm Vulcan immediately even if Pointer Lock is unavailable, AND request Pointer Lock!
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
        this.mouseLeftDown = false;
        this.pendingMissileLaunch = false;
        this.pendingCmdsDeploy = false;
        this.stickX = 0;
        this.stickY = 0;
        this.trenchAudio.setVulcanFiring(false);
      },
      { signal }
    );

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
            void this.submitScoreNow();
          }
        },
        { signal }
      );
    }
  }

  private startSortie(lockPointer: boolean): void {
    this.runPlaytimeSec = 0;
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.callsignEditing = false;
    this.callsignOverwriteOnNextKey = false;
    this.scoreSubmitted = false;
    this.submittingScore = false;
    this.submitResultBanner = null;
    this.lastSubmittedRun = null;
    this.keysDown.clear();
    this.mouseLeftDown = false;
    this.pendingMissileLaunch = false;
    this.pendingCmdsDeploy = false;
    this.stickX = 0;
    this.stickY = 0;
    this.unlockedMouseSteerActive = false;

    this.host.audio.playButtonLatchLock(1.0, 0.9);
    this.sim.startNewFlight();
    if (lockPointer) {
      this.requestCanopyPointerLock();
    }
  }

  private resumeWithPointerLock(): void {
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.stickX = 0;
    this.stickY = 0;
    if (this.sim.phase === 'FLYING') {
      this.sim.paused = false;
      this.requestCanopyPointerLock();
    }
  }

  private async submitScoreNow(): Promise<void> {
    if (import.meta.env.DEV && this.debugTainted) {
      this.submitResultBanner = 'DEV DEBUG SESSION — TRENCH_SCORES WRITE BLOCKED';
      return;
    }
    if (this.scoreSubmitted || this.submittingScore || this.sim.gameOverLockoutTimer > 0) return;
    this.submittingScore = true;
    this.submitResultBanner = 'TRANSMITTING TO TRENCH_SCORES...';

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
      this.host.audio.playMutedAvionicsIndicatorBeep(false);
      return;
    }
    this.scoreSubmitted = true;
    this.callsignDraft = this.leaderboard.getSavedCallsign();
    this.lastSubmittedRun = {
      docId: res.docId,
      callsign: this.callsignDraft,
      score: finalScore,
      distance: finalDist,
      maxMach: finalMach,
      grazes: finalKills,
      rank: res.rank,
    };
    this.submitResultBanner = res.online
      ? `LOGGED GLOBALLY // RANK #${res.rank}`
      : `SAVED TO LOCAL ARCHIVE // RANK #${res.rank}`;
    this.manifestOpen = true;
    this.host.audio.playButtonLatchLock(1.04, 0.9);
  }

  private handleHudButton(id: string): void {
    if (id === 'trench-locked' || id === 'trench-locked-retry') return;
    this.host.audio.playButtonLatchLock(0.98, 0.85);
    switch (id) {
      case 'trench-start':
      case 'trench-retry':
        this.startSortie(true);
        break;
      case 'trench-resume-lock':
      case 'trench-osd-close':
        this.resumeWithPointerLock();
        break;
      case 'trench-pause':
        if (this.sim.phase === 'FLYING') {
          if (this.sim.paused) {
            this.resumeWithPointerLock();
          } else {
            this.releasePointerLock();
            this.sim.paused = true;
            this.mouseLeftDown = false;
            this.stickX = 0;
            this.stickY = 0;
            this.trenchAudio.setVulcanFiring(false);
          }
        }
        break;
      case 'trench-mute':
        this.host.setMuted(!this.host.isMuted());
        break;
      case 'trench-fullscreen':
        this.host.toggleFullscreen();
        break;
      case 'trench-osd':
        this.manifestOpen = false;
        this.osdMenuOpen = !this.osdMenuOpen;
        if (this.sim.phase === 'FLYING') this.sim.paused = this.osdMenuOpen;
        if (this.osdMenuOpen) {
          this.releasePointerLock();
          this.mouseLeftDown = false;
          this.trenchAudio.setVulcanFiring(false);
        }
        break;
      case 'trench-manifest':
        this.osdMenuOpen = false;
        this.manifestOpen = !this.manifestOpen;
        if (this.manifestOpen) {
          this.releasePointerLock();
        }
        break;
      case 'trench-manifest-close':
        this.manifestOpen = false;
        break;
      case 'trench-toggle-invert':
        this.sim.invertPitch = !this.sim.invertPitch;
        break;
      case 'trench-submit-score':
        void this.submitScoreNow();
        break;
      case 'trench-callsign-field': {
        if (!this.scoreSubmitted) {
          this.callsignEditing = true;
          this.callsignOverwriteOnNextKey = true;
        }
        const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
        if (mobileInput) {
          mobileInput.value = this.callsignDraft;
          mobileInput.focus();
        }
        break;
      }
      case 'trench-exit-os':
        this.releasePointerLock();
        this.host.exitToMuthurOs('DERELICT TRENCH // VECTOR JET SIMULATOR DISENGAGED.');
        break;
    }
  }

  /**
   * Computes Pointer-Lock Virtual Flight Stick deflection (4% radial deadzone + smooth non-linear curve)
   * alongside persistent W/S throttle, A/D rudder yaw, LMB rotary cannon, RMB/SPACE missile launch,
   * and [C/F] CMDS countermeasures!
   */
  private buildFlightInput(canopyVp: ViewportRect): {
    input: F16FlightInput;
    stickNormX: number;
    stickNormY: number;
    deadzonePx: number;
  } {
    const minDim = Math.min(canopyVp.width, canopyVp.height);
    const deadzoneFrac = 0.04; // Clean, crisp 4% center deadzone!
    const deadzonePx = Math.max(12, Math.round(minDim * 0.024));

    let stickRoll = 0;
    let stickPitch = 0;
    let effectiveStickX = this.pointerLocked || this.unlockedMouseSteerActive ? this.stickX : 0;
    let effectiveStickY = this.pointerLocked || this.unlockedMouseSteerActive ? this.stickY : 0;

    if (
      this.sim.phase === 'FLYING' &&
      !this.sim.paused &&
      !this.osdMenuOpen &&
      !this.manifestOpen
    ) {
      // Arrow-key Pitch/Roll keyboard fallback (always works alongside Pointer Lock / Cursor Stick!)
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
        // Smooth non-linear response curve: surgical gunnery near center, fast rolls at full throw!
        const curved = Math.pow(effMag, 1.65);
        stickRoll = (effectiveStickX / mag) * curved;
        stickPitch = (effectiveStickY / mag) * curved;
      }
    }

    // W / S: Persistent Throttle (0% IDLE -> 100% MIL detent -> 120% AB)
    let throttleDelta = 0;
    if (this.keysDown.has('KeyW')) throttleDelta += 1;
    if (this.keysDown.has('KeyS')) throttleDelta -= 1;

    // A / D: Rudder Yaw left/right
    let rudderInput = 0;
    if (this.keysDown.has('KeyA')) rudderInput -= 1;
    if (this.keysDown.has('KeyD')) rudderInput += 1;

    const launchMissilePressed = this.pendingMissileLaunch;
    this.pendingMissileLaunch = false;

    const deployCmdsPressed = this.pendingCmdsDeploy;
    this.pendingCmdsDeploy = false;

    if (
      import.meta.env.DEV &&
      this.sim.phase === 'FLYING' &&
      !this.sim.paused &&
      !this.osdMenuOpen &&
      !this.manifestOpen
    ) {
      if (this.debugControl) {
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
    }

    return {
      input: {
        stickRoll,
        stickPitch,
        throttleDelta,
        rudderInput,
        firingGun: this.mouseLeftDown || (import.meta.env.DEV && this.debugGunActive),
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

    const layout = this.hudRenderer.getLayout(this.viewportWidth, this.viewportHeight);
    let { input, stickNormX, stickNormY, deadzonePx } = this.buildFlightInput(layout.canopyVp);

    if (
      import.meta.env.DEV &&
      this.devAutoPilot?.isEnabled() &&
      this.sim.phase === 'FLYING' &&
      !this.sim.paused &&
      !this.osdMenuOpen &&
      !this.manifestOpen
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

    this.sim.step(clampedDt, input);

    // Immediately release Pointer Lock & clear held keys on crash so 1.2s lockout + callsign UI are clean!
    if (
      this.sim.phase === 'GAME_OVER' &&
      (this.pointerLocked ||
        this.keysDown.size > 0 ||
        this.mouseLeftDown ||
        this.unlockedMouseSteerActive)
    ) {
      this.releasePointerLock();
      this.keysDown.clear();
      this.mouseLeftDown = false;
      this.pendingMissileLaunch = false;
      this.pendingCmdsDeploy = false;
      this.stickX = 0;
      this.stickY = 0;
      this.unlockedMouseSteerActive = false;
      this.callsignEditing = false;
      this.callsignOverwriteOnNextKey = false;
      this.trenchAudio.setVulcanFiring(false);
      document.body.style.cursor = 'default';
    }

    const flyingActive = this.sim.phase === 'FLYING' && !this.sim.paused;
    if (flyingActive && !this.osdMenuOpen && !this.manifestOpen) {
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

    // 1. Render 1st-Person 3D Wireframe Heightmap Canyon, Threats, Caches, Tracers, Missiles & Flares
    this.renderer.render(ctx, this.sim, layout.canopyVp, totalTimeSec);

    // 2. Render Next-Level F-16 Canopy HUD + 4-Panel Avionics MFD Cluster
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
      osdMenuOpen: this.osdMenuOpen,
      manifestOpen: this.manifestOpen,
      callsignDraft: this.callsignDraft,
      callsignEditing: this.callsignEditing,
      scoreSubmitted: this.scoreSubmitted,
      submittingScore: this.submittingScore,
      submitResultBanner: this.submitResultBanner,
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
      chromaScale: 0.34,
    };
  }
}
