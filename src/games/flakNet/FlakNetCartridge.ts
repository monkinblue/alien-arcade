import type {
  Cartridge,
  CrtShaderFrameParams,
  CrtShockwaveUniform,
  HostEnvironment,
} from '../../shell/Cartridge';
import type { Vec2, ViewportRect } from '../../types';
import { FlakAudioEngine } from './FlakAudioEngine';
import { FlakDemoDirector, FlakTacticalAutoBot } from './FlakDemoDirector';
import { FlakHudRenderer, type FlakHudLayout } from './FlakHudRenderer';
import { FlakLeaderboardService } from './FlakLeaderboard';
import {
  FlakScopeRenderer,
  screenToVirtualScope,
  virtualScopeToScreen,
} from './FlakScopeRenderer';
import { FlakSimulation } from './FlakSimulation';
import { FLAK_CONSTANTS, type FlakLastSubmittedRun } from './types';

interface FlakDebugBridge {
  getState: () => Record<string, unknown>;
  fire: (x: number, y: number, type?: 'flak' | 'emp' | 'A' | 'S' | 'D') => boolean;
  jumpToWave: (n: number) => {
    waveNumber: number;
    hasBoss: boolean;
    empAmmo: number;
    domesIntact: number;
  };
  setAutoBot: (enabled: boolean) => { autoBotEnabled: boolean };
  startDemo: () => { active: boolean; stageIndex: number };
  exitDemo: () => { active: boolean };
  jumpToDemoStage: (stage: number) => { active: boolean; stageIndex: number; stageTitle: string };
}

declare global {
  interface Window {
    __FLAK_DEBUG__?: FlakDebugBridge;
  }
}

export class FlakNetCartridge implements Cartridge {
  public readonly id = 'flak';
  private host: HostEnvironment;
  private listenerAbort: AbortController | null = null;

  private flakAudio: FlakAudioEngine;
  private leaderboard: FlakLeaderboardService;
  private sim: FlakSimulation;
  private demoDirector = new FlakDemoDirector();
  private autoBot: FlakTacticalAutoBot | null = import.meta.env.DEV
    ? new FlakTacticalAutoBot()
    : null;
  private scopeRenderer = new FlakScopeRenderer();
  private hudRenderer = new FlakHudRenderer();

  private viewportWidth = 1280;
  private viewportHeight = 800;
  private offsetX = 0;
  private offsetY = 0;
  private crtRect: ViewportRect = { x: 0, y: 0, width: 1280, height: 800 };

  private cursorVirtual: Vec2 = {
    x: FLAK_CONSTANTS.VIRTUAL_W * 0.5,
    y: FLAK_CONSTANTS.VIRTUAL_H * 0.44,
  };
  private cursorInsideScope = false;
  private hoveredButtonId: string | null = null;

  private osdMenuOpen = false;
  private manifestOpen = false;
  private glitchIntensity = 0;

  private callsignDraft = 'GUNNER-01';
  private callsignEditing = false;
  private callsignOverwriteOnNextKey = false;
  private scoreSubmitted = false;
  private submittingScore = false;
  private submitResultBanner: string | null = null;
  private lastSubmittedRun: FlakLastSubmittedRun | null = null;

  constructor(host: HostEnvironment) {
    this.host = host;
    this.flakAudio = new FlakAudioEngine(host.audio);
    this.leaderboard = new FlakLeaderboardService();
    this.callsignDraft = this.leaderboard.getSavedCallsign();

    this.sim = new FlakSimulation({
      onLaunchLight: (xNorm) => this.flakAudio.playLaunchLight(xNorm),
      onLaunchEmp: (xNorm) => this.flakAudio.playLaunchEmp(xNorm),
      onDetonateAirburst: (xNorm, altNorm) =>
        this.flakAudio.playDetonateAirburst(xNorm, altNorm),
      onDetonateEmp: (xNorm, altNorm) => this.flakAudio.playDetonateEmp(xNorm, altNorm),
      onBatteryReload: (xNorm) => this.flakAudio.playBatteryReload(xNorm),
      onDomeBreach: (xNorm) => this.flakAudio.playDomeBreach(xNorm),
      onWaveIncoming: () => this.flakAudio.playWaveIncomingKlaxon(),
      onDomeLockAlarm: (xNorm) => this.flakAudio.playDomeLockAlarm(xNorm),
      onMirvSplitWarning: (xNorm) => this.flakAudio.playMirvSplitWarning(xNorm),
      onRadarPing: (xNorm, pitch, vol) => this.flakAudio.playRadarPing(xNorm, pitch, vol),
      onHarmonicCombo: (chain, isDc, xNorm) =>
        this.flakAudio.playHarmonicComboChime(chain, isDc, xNorm),
      onDeflectionClank: (xNorm, isKill) =>
        this.flakAudio.playDeflectionClank(xNorm, isKill),
      onTallyClick: (step) => this.flakAudio.playTallyClick(step),
      onDropPodRestore: (xNorm) => this.flakAudio.playDropPodRestore(xNorm),
      onBossArrival: (xNorm) => this.flakAudio.playBossArrival(xNorm),
      onBossSalvo: (xNorm) => this.flakAudio.playBossSalvo(xNorm),
      onBossHullHit: (xNorm, hpDestroyed) =>
        this.flakAudio.playBossHullHit(xNorm, hpDestroyed),
      onBossDestroyed: (xNorm) => this.flakAudio.playBossDestroyed(xNorm),
      onSyncGlitch: (intensity) => {
        this.glitchIntensity = Math.max(this.glitchIntensity, intensity);
      },
    });
  }

  public mount(): void {
    this.unmount();
    this.listenerAbort = new AbortController();
    const signal = this.listenerAbort.signal;

    const vp = this.host.getViewport();
    this.resize(vp.width, vp.height, vp.offsetX, vp.offsetY);

    this.flakAudio.mount();
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.hoveredButtonId = null;
    this.cursorInsideScope = false;
    this.glitchIntensity = 0;
    this.callsignEditing = false;
    this.callsignOverwriteOnNextKey = false;
    this.scoreSubmitted = false;
    this.submittingScore = false;
    this.submitResultBanner = null;
    this.lastSubmittedRun = null;
    this.callsignDraft = this.leaderboard.getSavedCallsign();

    this.sim.resetToTitle();
    this.demoDirector.stop(this.sim);
    if (import.meta.env.DEV) {
      this.autoBot?.setEnabled(false);
    }
    this.bindListeners(signal);

    if (import.meta.env.DEV) {
      window.__FLAK_DEBUG__ = {
        getState: () => {
          const demo = this.demoDirector.getTelemetry();
          const activeCursor = demo.active ? demo.aiCursor : this.cursorVirtual;
          return {
            phase: this.sim.phase,
            waveNumber: this.sim.waveNumber,
            score: this.sim.score,
            liveChain: this.sim.liveChain,
            highChain: this.sim.highChain,
            predictorBoostTimer: Number(this.sim.predictorBoostTimer.toFixed(2)),
            shotsFired: this.sim.shotsFired,
            shotsHit: this.sim.shotsHit,
            accuracy: this.sim.getAccuracyPercent(),
            totalKills: this.sim.totalKills,
            dangerCloseKills: this.sim.dangerCloseKills,
            dangerCloseRechargeProgress: this.sim.dangerCloseRechargeProgress,
            deflectionKills: this.sim.deflectionKills,
            empRechargeFlashTimer: Number(this.sim.empRechargeFlashTimer.toFixed(2)),
            isDemoMode: this.sim.isDemoMode,
            autoBotEnabled: this.autoBot?.isEnabled() ?? false,
            paused: this.sim.paused,
            demo,
            domes: this.sim.domes.map((d) => ({ id: d.id, x: d.x, intact: d.intact })),
            batteries: this.sim.batteries.map((b) => ({
              id: b.id,
              weaponType: b.weaponType,
              ammo: b.ammo,
              maxAmmo: b.maxAmmo,
              reloadProgress: Number(b.reloadProgress.toFixed(2)),
              cooldownTimer: Number(b.cooldownTimer.toFixed(2)),
            })),
            threats: this.sim.threats.map((t) => ({
              id: t.id,
              kind: t.kind,
              x: Math.round(t.x),
              y: Math.round(t.y),
              vx: Math.round(t.vx),
              vy: Math.round(t.vy),
              hp: t.hp,
              deflectedTimer: Number(t.deflectedTimer.toFixed(2)),
              lockedDomeId: t.lockedDomeId,
            })),
            shellsCount: this.sim.shells.length,
            blastsCount: this.sim.blasts.length,
            crtShockwavesCount: this.sim.crtShockwaves.length,
            boss: this.sim.boss
              ? {
                  designation: this.sim.boss.designation,
                  hp: this.sim.boss.hp,
                  maxHp: this.sim.boss.maxHp,
                  x: Math.round(this.sim.boss.x),
                  y: Math.round(this.sim.boss.y),
                  empStunTimer: Number(this.sim.boss.empStunTimer.toFixed(2)),
                }
              : null,
            deflectionPreview: this.sim.getDeflectionPreview(activeCursor),
            recentLogs: this.sim.logs.slice(0, 5),
            recentKills: this.sim.killLogs.slice(-5),
            audio: this.flakAudio.getLoadedAudioStats(),
          };
        },
        fire: (x, y, type = 'flak') => {
          this.cursorVirtual = { x, y };
          this.sim.updateBatteryTurretAim(this.cursorVirtual);
          if (type === 'emp' || type === 'S') {
            return this.sim.fireEmpMortar(x, y);
          }
          if (type === 'A' || type === 'D') {
            return this.sim.fireBattery(type, x, y);
          }
          return this.sim.fireSmartFlak(x, y);
        },
        jumpToWave: (n) => {
          this.demoDirector.stop(this.sim);
          this.osdMenuOpen = false;
          this.manifestOpen = false;
          this.callsignEditing = false;
          this.scoreSubmitted = false;
          this.sim.jumpToWave(n);
          return {
            waveNumber: this.sim.waveNumber,
            hasBoss: this.sim.boss !== null,
            empAmmo: this.sim.batteries[1]?.ammo ?? 0,
            domesIntact: this.sim.getIntactDomeCount(),
          };
        },
        setAutoBot: (enabled) => {
          this.autoBot?.setEnabled(Boolean(enabled));
          return { autoBotEnabled: this.autoBot?.isEnabled() ?? false };
        },
        startDemo: () => {
          this.startDemo();
          const t = this.demoDirector.getTelemetry();
          return { active: t.active, stageIndex: t.stageIndex };
        },
        exitDemo: () => {
          this.exitDemo();
          return { active: this.demoDirector.isActive() };
        },
        jumpToDemoStage: (stage) => {
          this.autoBot?.setEnabled(false);
          this.osdMenuOpen = false;
          this.manifestOpen = false;
          this.demoDirector.jumpToStage(this.sim, stage);
          const t = this.demoDirector.getTelemetry();
          return { active: t.active, stageIndex: t.stageIndex, stageTitle: t.stageTitle };
        },
      };
    }
  }

  public unmount(): void {
    if (import.meta.env.DEV) {
      delete window.__FLAK_DEBUG__;
      this.autoBot?.setEnabled(false);
    }
    this.demoDirector.stop(this.sim);
    if (this.listenerAbort) {
      this.listenerAbort.abort();
      this.listenerAbort = null;
    }
    this.flakAudio.unmount();
    this.host.audio.stopCartridgeLoops();
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.hoveredButtonId = null;
    this.cursorInsideScope = false;
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
      this.flakAudio.silenceAll();
    }
  }

  private getCurrentLayout(): FlakHudLayout {
    return this.hudRenderer.computeLayout(this.viewportWidth, this.viewportHeight);
  }

  private startRun(): void {
    this.demoDirector.stop(this.sim);
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.callsignEditing = false;
    this.callsignOverwriteOnNextKey = false;
    this.scoreSubmitted = false;
    this.submittingScore = false;
    this.submitResultBanner = null;
    this.lastSubmittedRun = null;
    this.callsignDraft = this.leaderboard.getSavedCallsign();
    this.sim.startNewGame();
  }

  private startDemo(): void {
    if (import.meta.env.DEV) {
      this.autoBot?.setEnabled(false);
    }
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.callsignEditing = false;
    this.callsignOverwriteOnNextKey = false;
    this.scoreSubmitted = false;
    this.submittingScore = false;
    this.submitResultBanner = null;
    this.lastSubmittedRun = null;
    this.demoDirector.start(this.sim);
    document.body.style.cursor = 'pointer';
  }

  private exitDemo(): void {
    if (!this.demoDirector.isActive() && !this.sim.isDemoMode) return;
    this.demoDirector.stop(this.sim);
    this.host.audio.playButtonLatchLock(0.92, 0.85);
    document.body.style.cursor = 'default';
  }

  private async submitCurrentScore(): Promise<void> {
    if (this.demoDirector.isActive() || this.sim.isDemoMode) return;
    if (this.scoreSubmitted || this.submittingScore) return;
    this.submittingScore = true;
    this.submitResultBanner = 'TRANSMITTING TELEMETRY TO MU-TH-UR...';
    const finalScore = Math.max(1, this.sim.score);
    const finalWave = Math.max(1, this.sim.waveNumber);
    const finalChain = Math.max(1, this.sim.highChain);
    const finalAcc = this.sim.getAccuracyPercent();
    const res = await this.leaderboard.submitScore({
      callsign: this.callsignDraft,
      score: finalScore,
      wave: finalWave,
      maxChain: finalChain,
      accuracy: finalAcc,
    });
    this.submittingScore = false;
    this.scoreSubmitted = true;
    this.callsignDraft = this.leaderboard.getSavedCallsign();
    this.lastSubmittedRun = {
      docId: res.docId,
      callsign: this.callsignDraft,
      score: finalScore,
      wave: finalWave,
      maxChain: finalChain,
      accuracy: finalAcc,
      rank: res.rank,
    };
    this.host.audio.playButtonLatchLock(1.05, 0.9);
    this.submitResultBanner = res.offlineFallback
      ? `LOGGED TO LOCAL ARCHIVE — RANK #${res.rank}`
      : `TRANSMISSION CONFIRMED // GLOBAL FLAK_SCORES RANK #${res.rank}!`;
    // Immediately open Global Leaderboard with pulsing ★ JUST ADDED highlight (matching Lunar Lander!)
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
        this.flakAudio.updateContinuousBeds([], false, 0.05);
      },
      { signal }
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
          this.hoveredButtonId = null;
          this.cursorInsideScope = false;
          document.body.style.cursor = 'default';
          return;
        }

        const cx = mapped.u * this.crtRect.width;
        const cy = mapped.v * this.crtRect.height;
        const btnHit = this.hudRenderer.hitTestButton(cx, cy);
        this.hoveredButtonId = btnHit;

        const layout = this.getCurrentLayout();
        const vPt = screenToVirtualScope(cx, cy, layout.scopeViewport);
        this.cursorInsideScope = vPt.inside;
        if (vPt.inside) {
          this.cursorVirtual = { x: vPt.x, y: vPt.y };
          if (this.sim.phase === 'ACTIVE_WAVE' && !this.sim.paused && !this.osdMenuOpen && !this.manifestOpen) {
            this.sim.updateBatteryTurretAim(this.cursorVirtual);
          }
        }

        if (btnHit) {
          document.body.style.cursor = 'pointer';
        } else if (
          this.cursorInsideScope &&
          this.sim.phase === 'ACTIVE_WAVE' &&
          !this.sim.paused &&
          !this.osdMenuOpen &&
          !this.manifestOpen
        ) {
          document.body.style.cursor = 'none';
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

        // 0. During Interactive Tactical Demo, utility pills work & ANY other click instantly exits Demo!
        if (this.demoDirector.isActive()) {
          if (e.button === 0) {
            const hitId = this.hudRenderer.hitTestButton(cx, cy);
            if (hitId === 'flak-mute' || hitId === 'flak-fullscreen' || hitId === 'flak-exit-os') {
              this.handleHudButton(hitId);
              return;
            }
          }
          this.exitDemo();
          return;
        }

        // 1. Check interactive HUD / modal buttons first (left click / touch)
        if (e.button === 0) {
          const hitId = this.hudRenderer.hitTestButton(cx, cy);
          if (hitId) {
            this.handleHudButton(hitId);
            return;
          }
        }

        // 2. Active Wave radar scope firing: LMB = Smart Flak (A/D), RMB = Center EMP Mortar (S)
        if (
          this.sim.phase === 'ACTIVE_WAVE' &&
          !this.sim.paused &&
          !this.osdMenuOpen &&
          !this.manifestOpen
        ) {
          const layout = this.getCurrentLayout();
          const vPt = screenToVirtualScope(cx, cy, layout.scopeViewport);
          if (!vPt.inside) return;

          this.cursorVirtual = { x: vPt.x, y: vPt.y };
          this.cursorInsideScope = true;
          this.sim.updateBatteryTurretAim(this.cursorVirtual);

          if (e.button === 2) {
            if (!this.sim.fireEmpMortar(vPt.x, vPt.y)) {
              this.host.audio.playMutedAvionicsIndicatorBeep(false);
            }
          } else if (e.button === 0) {
            if (!this.sim.fireSmartFlak(vPt.x, vPt.y)) {
              this.host.audio.playMutedAvionicsIndicatorBeep(false);
            }
          }
        }
      },
      { signal }
    );

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

        // Interactive Tactical Demo instant exit on [SPACE] or [ESC]
        if (this.demoDirector.isActive()) {
          if (e.code === 'Space' || e.code === 'Escape') {
            e.preventDefault();
            this.exitDemo();
          }
          return;
        }

        // STRICT 1.0-SECOND GAME OVER INPUT LOCKOUT: ignores frantic A/S/D/SPACE firing keys on dome collapse!
        if (this.sim.phase === 'GAME_OVER' && this.sim.gameOverLockoutTimer > 0) {
          return;
        }

        // Game Over Post-Lockout Controls: cleanly separate Callsign Editing ([C]/click) vs [ENTER] Submit vs [SPACE/R] Redeploy!
        if (
          this.sim.phase === 'GAME_OVER' &&
          !this.osdMenuOpen &&
          !this.manifestOpen
        ) {
          if (this.callsignEditing && !this.scoreSubmitted) {
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
              if (/^[A-Za-z0-9 _-]$/.test(e.key)) {
                if (this.callsignOverwriteOnNextKey) {
                  this.callsignDraft = e.key.toUpperCase();
                  this.callsignOverwriteOnNextKey = false;
                } else if (this.callsignDraft.length < 16) {
                  this.callsignDraft += e.key.toUpperCase();
                }
                this.host.audio.playSfx('ui_keyclick', { pitch: 0.96 + Math.random() * 0.1 });
              }
              return;
            }
            return;
          }

          if (e.code === 'Escape') {
            e.preventDefault();
            this.osdMenuOpen = true;
            this.host.audio.playButtonLatchLock();
            return;
          }
          if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            e.preventDefault();
            this.host.audio.playSfx('keypress_return', { volume: 0.9 });
            if (!this.scoreSubmitted) {
              void this.submitCurrentScore();
            } else {
              this.startRun();
            }
            return;
          }
          if (e.code === 'Space' || e.code === 'KeyR') {
            e.preventDefault();
            this.host.audio.playButtonLatchLock();
            this.startRun();
            return;
          }
          if (e.code === 'KeyC' && !this.scoreSubmitted) {
            this.callsignEditing = true;
            this.callsignOverwriteOnNextKey = true;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.12 });
            return;
          }
          return;
        }

        if (e.code === 'Escape') {
          e.preventDefault();
          this.host.audio.playButtonLatchLock();
          if (this.manifestOpen) {
            this.manifestOpen = false;
          } else {
            this.osdMenuOpen = !this.osdMenuOpen;
          }
          return;
        }

        if (e.code === 'Tab' && !e.repeat) {
          this.host.audio.playButtonLatchLock();
          this.manifestOpen = false;
          this.osdMenuOpen = !this.osdMenuOpen;
          return;
        }

        if (this.osdMenuOpen || this.manifestOpen) return;

        if (this.sim.phase === 'TITLE') {
          if (e.code === 'Enter' || e.code === 'Space') {
            this.host.audio.playButtonLatchLock();
            this.startRun();
          } else if (e.code === 'KeyT' && !e.repeat) {
            this.host.audio.playButtonLatchLock(1.06, 0.9);
            this.startDemo();
          }
          return;
        }

        if (e.code === 'KeyP' && !e.repeat && this.sim.phase === 'ACTIVE_WAVE') {
          this.sim.paused = !this.sim.paused;
          this.host.audio.playButtonLatchLock();
          return;
        }

        if (this.sim.phase === 'ACTIVE_WAVE' && !this.sim.paused && !e.repeat) {
          // Manual precision battery firing controls: [A] Left Flak, [D] Right Flak, [S]/[Space] EMP Mortar
          if (e.code === 'KeyA') {
            if (!this.sim.fireBattery('A', this.cursorVirtual.x, this.cursorVirtual.y)) {
              this.host.audio.playMutedAvionicsIndicatorBeep(false);
            }
          } else if (e.code === 'KeyD') {
            if (!this.sim.fireBattery('D', this.cursorVirtual.x, this.cursorVirtual.y)) {
              this.host.audio.playMutedAvionicsIndicatorBeep(false);
            }
          } else if (e.code === 'KeyS' || e.code === 'Space') {
            if (!this.sim.fireEmpMortar(this.cursorVirtual.x, this.cursorVirtual.y)) {
              this.host.audio.playMutedAvionicsIndicatorBeep(false);
            }
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
          this.callsignDraft = mobileInput.value.toUpperCase().slice(0, 16);
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
    if (id === 'flak-locked' || id === 'flak-locked-restart') return;
    if (id === 'flak-callsign-focus') {
      if (this.sim.gameOverLockoutTimer > 0 || this.scoreSubmitted) return;
      this.callsignEditing = true;
      this.callsignOverwriteOnNextKey = true;
      this.host.audio.playSfx('ui_keyclick', { pitch: 1.1 });
      this.focusMobileCallsignInput();
      return;
    }

    this.host.audio.playButtonLatchLock(0.98, 0.9);

    if (id === 'flak-start' || id === 'flak-restart') {
      this.startRun();
    } else if (id === 'flak-demo') {
      this.startDemo();
    } else if (id === 'flak-exit-demo') {
      this.exitDemo();
    } else if (id === 'flak-pause') {
      if (this.sim.phase === 'ACTIVE_WAVE') {
        this.sim.paused = !this.sim.paused;
      }
    } else if (id === 'flak-manifest') {
      this.osdMenuOpen = false;
      this.manifestOpen = !this.manifestOpen;
    } else if (id === 'flak-osd') {
      this.manifestOpen = false;
      this.osdMenuOpen = !this.osdMenuOpen;
    } else if (id === 'flak-close-modal') {
      this.osdMenuOpen = false;
      this.manifestOpen = false;
    } else if (id === 'flak-mute') {
      this.host.setMuted(!this.host.isMuted());
    } else if (id === 'flak-fullscreen') {
      this.host.toggleFullscreen();
    } else if (id === 'flak-submit-score') {
      void this.submitCurrentScore();
    } else if (id === 'flak-exit-os') {
      this.host.exitToMuthurOs(
        'EXITED ORBITAL INTERCEPT // FLAK NET. RADAR BUS DISENGAGED.'
      );
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

    const simActive = !this.osdMenuOpen && !this.manifestOpen;
    if (simActive) {
      if (this.demoDirector.isActive()) {
        this.demoDirector.step(this.sim, clampedDt);
      } else if (import.meta.env.DEV && this.autoBot?.isEnabled()) {
        this.autoBot.step(this.sim, clampedDt, this.cursorVirtual);
      }
      this.sim.step(clampedDt);
    }

    const demoState = this.demoDirector.isActive() ? this.demoDirector.getTelemetry() : null;

    // Update continuous pooled Doppler re-entry shrieks & stereo Ion Storm Jammer interference loop
    this.flakAudio.updateContinuousBeds(
      this.sim.threats,
      simActive && this.sim.phase === 'ACTIVE_WAVE' && !this.sim.paused,
      clampedDt
    );

    const layout = this.getCurrentLayout();

    ctx.fillStyle = '#030805';
    ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    // 1. Render Central 1920x1080 Surface-to-Orbit Radar Scope
    const botActive = import.meta.env.DEV && Boolean(this.autoBot?.isEnabled());
    this.scopeRenderer.render(ctx, {
      sim: this.sim,
      viewport: layout.scopeViewport,
      timeSec: totalTimeSec,
      cursorVirtual: this.cursorVirtual,
      cursorInsideScope:
        (this.cursorInsideScope || botActive) &&
        !this.osdMenuOpen &&
        !this.manifestOpen,
      demoState,
    });

    // 2. Render Chunky Nostromo CRT Telemetry Strips, Analog Dials & Overlays
    this.hudRenderer.render(
      ctx,
      {
        width: this.viewportWidth,
        height: this.viewportHeight,
        timeSec: totalTimeSec,
        sim: this.sim,
        leaderboard: this.leaderboard,
        hoveredButtonId: this.hoveredButtonId,
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
        demoState,
      },
      layout
    );

    // 3. Map active physical shockwaves into localized WebGL CRT shader distortion rings!
    const shockwaves: CrtShockwaveUniform[] = [];
    for (const sw of this.sim.crtShockwaves) {
      const p = Math.max(0, Math.min(1, sw.age / Math.max(0.01, sw.duration)));
      const intensity = sw.peakIntensity * Math.pow(1 - p, 1.45);
      if (intensity <= 0.005) continue;
      const screenPt = virtualScopeToScreen(sw.x, sw.y, layout.scopeViewport);
      shockwaves.push({
        uvX: screenPt.x / Math.max(1, this.viewportWidth),
        uvY: screenPt.y / Math.max(1, this.viewportHeight),
        radius: sw.maxRadiusNorm * Math.pow(p, 0.52),
        intensity,
      });
    }

    const jammerInterference = this.sim.getActiveJammerIntensity() * 0.24;
    const breachInterference = this.sim.domeHitFlashTimer > 0 ? 0.34 : 0;

    return {
      interference: Math.min(0.8, 0.016 + jammerInterference + breachInterference),
      glitch: this.glitchIntensity,
      overdrive: this.sim.domeHitFlashTimer > 0 ? 0.58 : this.sim.liveChain >= 8 ? 0.25 : 0,
      tubeTurnOn: 0,
      shockwaves,
      chromaScale: 0.3,
    };
  }
}
