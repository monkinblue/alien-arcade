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
  private controlsOpen = false;
  private confirmExitPending = false;
  private confirmExitTimer = 0;
  private empTouchArmed = false;
  private glitchIntensity = 0;

  private statusToast: {
    text: string;
    tone: 'green' | 'amber' | 'red' | 'cyan';
    timer: number;
    duration: number;
  } | null = null;

  private callsignDraft = 'GUNNER-01';
  private runPlaytimeSec = 0;
  private debugTainted = false;
  private callsignEditing = false;
  private callsignOverwriteOnNextKey = false;
  private scoreSubmitted = false;
  private submittingScore = false;
  private submitResultBanner: string | null = null;
  private submitResultTone: 'green' | 'amber' | 'red' = 'green';
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
    this.controlsOpen = false;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.empTouchArmed = false;
    this.statusToast = null;
    this.hoveredButtonId = null;
    this.cursorInsideScope = false;
    this.glitchIntensity = 0;
    this.callsignEditing = false;
    this.callsignOverwriteOnNextKey = false;
    this.scoreSubmitted = false;
    this.submittingScore = false;
    this.submitResultBanner = null;
    this.submitResultTone = 'green';
    this.lastSubmittedRun = null;
    this.callsignDraft = this.leaderboard.getSavedCallsign();
    this.host.setModalOpen(false);

    this.sim.resetToTitle();
    this.demoDirector.stop(this.sim);
    if (import.meta.env.DEV) {
      this.debugTainted = false;
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
            controlsOpen: this.controlsOpen,
            osdMenuOpen: this.osdMenuOpen,
            manifestOpen: this.manifestOpen,
            empTouchArmed: this.empTouchArmed,
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
          this.debugTainted = true;
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
          this.debugTainted = true;
          this.demoDirector.stop(this.sim);
          this.osdMenuOpen = false;
          this.manifestOpen = false;
          this.controlsOpen = false;
          this.empTouchArmed = false;
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
          this.debugTainted = true;
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
          this.controlsOpen = false;
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
    this.host.setModalOpen(false);
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.controlsOpen = false;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.empTouchArmed = false;
    this.statusToast = null;
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

  private isActiveRankedRun(): boolean {
    return (
      !this.sim.isDemoMode &&
      (this.sim.phase === 'ACTIVE_WAVE' || this.sim.phase === 'WAVE_AUDIT')
    );
  }

  private isAnyModalOverlayOpen(): boolean {
    return (
      this.osdMenuOpen ||
      this.manifestOpen ||
      this.controlsOpen ||
      (this.sim.phase === 'ACTIVE_WAVE' && this.sim.paused && !this.sim.isDemoMode) ||
      (this.sim.phase === 'GAME_OVER' && !this.sim.isDemoMode)
    );
  }

  private showToast(
    text: string,
    tone: 'green' | 'amber' | 'red' | 'cyan' = 'amber',
    duration = 1.2
  ): void {
    this.statusToast = { text, tone, timer: duration, duration };
  }

  private toggleMuteWithToast(): void {
    const nextMuted = !this.host.isMuted();
    this.host.setMuted(nextMuted);
    if (!nextMuted) {
      this.host.audio.playButtonLatchLock(1.02, 0.85);
    }
    this.showToast(
      nextMuted ? 'AUDIO BUS: MUTED [M]' : 'AUDIO BUS: ONLINE [M]',
      nextMuted ? 'red' : 'green',
      1.2
    );
  }

  private startRun(): void {
    this.demoDirector.stop(this.sim);
    this.runPlaytimeSec = 0;
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.controlsOpen = false;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.empTouchArmed = false;
    this.callsignEditing = false;
    this.callsignOverwriteOnNextKey = false;
    this.scoreSubmitted = false;
    this.submittingScore = false;
    this.submitResultBanner = null;
    this.submitResultTone = 'green';
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
    this.controlsOpen = false;
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.empTouchArmed = false;
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
    this.empTouchArmed = false;
    this.host.audio.playButtonLatchLock(0.92, 0.85);
    document.body.style.cursor = 'default';
  }

  private requestExitToHub(): void {
    if (this.isActiveRankedRun() && !this.confirmExitPending) {
      this.confirmExitPending = true;
      this.confirmExitTimer = 3.5;
      this.host.audio.playButtonLatchLock(0.86, 0.85);
      this.showToast('RANKED RUN ACTIVE — CLICK [CONFIRM EXIT?] TO RETURN TO HUB', 'amber', 2.2);
      return;
    }
    this.confirmExitPending = false;
    this.confirmExitTimer = 0;
    this.host.exitToMuthurOs('EXITED ORBITAL INTERCEPT // FLAK NET. RADAR BUS DISENGAGED.');
  }

  /**
   * Fast-forwards WAVE_AUDIT on [SPACE], [ENTER], or Click:
   * - First press finishes the remaining dome/EMP bonus tally instantly.
   * - Second press (or once tally is complete) finishes any drop-pod descent and starts the next wave.
   */
  private fastForwardWaveAudit(): void {
    if (this.sim.phase !== 'WAVE_AUDIT' || !this.sim.waveAudit || this.sim.isDemoMode) return;
    const audit = this.sim.waveAudit;
    this.host.audio.playButtonLatchLock(1.04, 0.85);

    if (!audit.done) {
      const remDomes = Math.max(0, audit.survivingDomes - audit.talliedDomes);
      const remEmp = Math.max(0, audit.unusedEmpRounds - audit.talliedEmp);
      const addBonus = remDomes * audit.domeBonusPerUnit + remEmp * audit.empBonusPerUnit;
      audit.talliedDomes = audit.survivingDomes;
      audit.talliedEmp = audit.unusedEmpRounds;
      audit.totalWaveBonus += addBonus;
      this.sim.score += addBonus;
      audit.done = true;
      audit.stepTimer = 0;
      audit.completeHoldTimer = Math.min(audit.completeHoldTimer, 0.65);
      return;
    }

    if (this.sim.dropPod) {
      this.sim.dropPod.progress = 1;
      this.sim.step(0.05);
    }
    if (this.sim.phase === 'WAVE_AUDIT' && this.sim.waveAudit) {
      this.sim.waveAudit.completeHoldTimer = 0;
      this.sim.step(0.05);
    }
  }

  private getSystemMenuCallbacks(): SystemMenuActionCallbacks {
    return {
      onResume: () => {
        this.osdMenuOpen = false;
        this.confirmExitPending = false;
      },
      onRestart: () => {
        this.startRun();
      },
      onOpenLeaderboard: () => {
        this.osdMenuOpen = false;
        this.controlsOpen = false;
        this.confirmExitPending = false;
        this.manifestOpen = true;
      },
      onExitToHub: () => {
        this.requestExitToHub();
      },
      onExtraAction: (id) => {
        if (id === 'flak-sys-demo') {
          this.host.audio.playButtonLatchLock(1.04, 0.88);
          if (this.sim.isDemoMode) {
            this.exitDemo();
          } else {
            this.startDemo();
          }
        }
      },
    };
  }

  private async submitCurrentScore(): Promise<void> {
    if (this.demoDirector.isActive() || this.sim.isDemoMode) return;
    if (import.meta.env.DEV && this.debugTainted) {
      this.submitResultBanner = 'DEV DEBUG SESSION — ORBITAL RELAY WRITE BLOCKED';
      this.submitResultTone = 'amber';
      return;
    }
    if (this.scoreSubmitted || this.submittingScore) return;
    this.submittingScore = true;
    this.submitResultBanner = 'TRANSMITTING TELEMETRY TO ORBITAL RELAY...';
    this.submitResultTone = 'amber';
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
      wave: finalWave,
      maxChain: finalChain,
      accuracy: finalAcc,
      rank: res.rank,
    };
    this.host.audio.playButtonLatchLock(1.05, 0.9);
    this.submitResultTone = 'green';
    this.submitResultBanner = res.offlineFallback
      ? `LOGGED TO LOCAL TAPE ARCHIVE — RANK #${res.rank}`
      : `TRANSMISSION CONFIRMED // ORBITAL RELAY RANK #${res.rank}!`;
    // Auto-open unified Global Leaderboard Manifest with boxed ★ JUST ADDED badge
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
        const modalOpen = this.isAnyModalOverlayOpen();

        if (vPt.inside) {
          this.cursorVirtual = { x: vPt.x, y: vPt.y };
          if (this.sim.phase === 'ACTIVE_WAVE' && !this.sim.paused && !modalOpen) {
            this.sim.updateBatteryTurretAim(this.cursorVirtual);
          }
        }

        if (btnHit) {
          document.body.style.cursor = 'pointer';
        } else if (
          this.cursorInsideScope &&
          this.sim.phase === 'ACTIVE_WAVE' &&
          !this.sim.paused &&
          !modalOpen &&
          !this.sim.isDemoMode
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

        // 0. During Interactive Tactical Demo, Audio works & Demo Exit / any scope click exits Demo!
        if (this.demoDirector.isActive()) {
          if (e.button === 0) {
            const hitId = this.hudRenderer.hitTestButton(cx, cy);
            if (hitId === TOP_CHROME_IDS.CRT) {
              const next = this.host.toggle1979Crt();
              this.showToast(
                next === 'CLASSIC_1979' ? '1979 CRT MODE: ON' : '1979 CRT MODE: OFF (CLEAN)',
                next === 'CLASSIC_1979' ? 'amber' : 'green',
                1.4
              );
              return;
            }
            if (hitId === TOP_CHROME_IDS.AUDIO) {
              this.toggleMuteWithToast();
              return;
            }
            if (hitId === TOP_CHROME_IDS.CONTROLS) {
              this.exitDemo();
              this.controlsOpen = true;
              return;
            }
            if (hitId === TOP_CHROME_IDS.MENU) {
              this.exitDemo();
              this.osdMenuOpen = true;
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

        // Clicking elsewhere clears pending [CONFIRM EXIT?] breaker latch
        this.confirmExitPending = false;
        this.confirmExitTimer = 0;

        // 2. Never pass clicks into gameplay while any modal or Pause Banner is active
        if (this.isAnyModalOverlayOpen()) {
          return;
        }

        // 3. Allow clicking anywhere during WAVE_AUDIT to fast-forward the wave tally
        if (this.sim.phase === 'WAVE_AUDIT' && e.button === 0) {
          this.fastForwardWaveAudit();
          return;
        }

        // 4. Active Wave radar scope firing: LMB = Smart Flak (or armed Touch EMP), RMB = Center EMP Mortar
        if (this.sim.phase === 'ACTIVE_WAVE' && !this.sim.paused) {
          const layout = this.getCurrentLayout();
          const vPt = screenToVirtualScope(cx, cy, layout.scopeViewport);
          if (!vPt.inside) return;

          this.cursorVirtual = { x: vPt.x, y: vPt.y };
          this.cursorInsideScope = true;
          this.sim.updateBatteryTurretAim(this.cursorVirtual);

          if (e.button === 2 || (e.button === 0 && this.empTouchArmed)) {
            this.empTouchArmed = false;
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

        // 0. Interactive Tactical Demo instant exit on [SPACE] or [ESC] (+ [M] mute)
        if (this.demoDirector.isActive()) {
          if (e.code === 'KeyM' && !e.repeat) {
            this.toggleMuteWithToast();
            return;
          }
          if (e.code === 'Space' || e.code === 'Escape') {
            e.preventDefault();
            this.exitDemo();
          }
          return;
        }

        // 1. Strict 1.0-second Game Over input keylock (ignores frantic firing keys on dome collapse!)
        if (
          this.sim.phase === 'GAME_OVER' &&
          this.sim.gameOverLockoutTimer > 0 &&
          !this.osdMenuOpen &&
          !this.manifestOpen &&
          !this.controlsOpen
        ) {
          return;
        }

        // 2. Opt-in Callsign Editing mode on Game Over Debrief (isolated from hotkeys!)
        if (
          this.sim.phase === 'GAME_OVER' &&
          !this.osdMenuOpen &&
          !this.manifestOpen &&
          !this.controlsOpen &&
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

        // 4. Unified System Menu Modal open ([ESC] resume, [1-4] quick-switch, [T] Demo, [H] Controls)
        if (this.osdMenuOpen) {
          if (handleSystemMenuKey(e, this.host, this.getSystemMenuCallbacks())) {
            return;
          }
          if (e.code === 'KeyT' && !e.repeat) {
            e.preventDefault();
            this.host.audio.playButtonLatchLock(1.04, 0.88);
            this.startDemo();
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

        // 5. Controls Quick-Card Modal open ([H], [?], or [ESC] closes cleanly)
        if (this.controlsOpen) {
          if (e.code === 'Escape' || e.code === 'KeyH' || e.key === '?') {
            e.preventDefault();
            this.controlsOpen = false;
            this.host.audio.playButtonLatchLock();
          }
          return;
        }

        // 6. Global Manifest Modal open ([ESC] close; [R]/[ENTER] Play Again when post-run or title!)
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
            this.startRun();
            return;
          }
          return;
        }

        // 7. Universal [H] / [?] 1-Glance Controls Quick-Card (pauses sim cleanly)
        if ((e.code === 'KeyH' || e.key === '?') && !e.repeat) {
          e.preventDefault();
          this.confirmExitPending = false;
          this.controlsOpen = true;
          this.host.audio.playButtonLatchLock();
          return;
        }

        // 8. Unified [ESC] -> Opens System & Pause Menu everywhere (never exits directly to Hub)
        if (e.code === 'Escape') {
          e.preventDefault();
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
            this.startRun();
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

        // 10. Title Screen controls
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

        // 11. WAVE_AUDIT fast-forward on [SPACE] or [ENTER]
        if (this.sim.phase === 'WAVE_AUDIT') {
          if ((e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
            e.preventDefault();
            this.fastForwardWaveAudit();
          }
          return;
        }

        // 12. Universal [P] Quick-Pause with shared Amber CRT Pause Banner
        if (e.code === 'KeyP' && !e.repeat && this.sim.phase === 'ACTIVE_WAVE') {
          this.sim.paused = !this.sim.paused;
          this.empTouchArmed = false;
          this.host.audio.playButtonLatchLock();
          return;
        }

        // 13. Active Wave manual & primary weapon controls
        if (this.sim.phase === 'ACTIVE_WAVE' && !this.sim.paused && !e.repeat) {
          if (e.code === 'KeyA') {
            if (!this.sim.fireBattery('A', this.cursorVirtual.x, this.cursorVirtual.y)) {
              this.host.audio.playMutedAvionicsIndicatorBeep(false);
            }
          } else if (e.code === 'KeyD') {
            if (!this.sim.fireBattery('D', this.cursorVirtual.x, this.cursorVirtual.y)) {
              this.host.audio.playMutedAvionicsIndicatorBeep(false);
            }
          } else if (e.code === 'KeyS' || e.code === 'Space') {
            this.empTouchArmed = false;
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
      if (handleSystemMenuAction(id, this.host, this.getSystemMenuCallbacks())) {
        return;
      }
    }

    // 2. Callsign box click (opt-in editing on Game Over Debrief)
    if (id === POST_RUN_IDS.CALLSIGN_BOX) {
      if (this.sim.gameOverLockoutTimer > 0 || this.scoreSubmitted || this.submittingScore) return;
      this.callsignEditing = true;
      this.callsignOverwriteOnNextKey = true;
      this.host.audio.playSfx('ui_keyclick', { pitch: 1.1 });
      this.focusMobileCallsignInput();
      return;
    }

    // 3. Top Chrome Bar & Pause / Controls / PostRun shared actions
    if (id === TOP_CHROME_IDS.CRT) {
      this.confirmExitPending = false;
      const next = this.host.toggle1979Crt();
      this.showToast(
        next === 'CLASSIC_1979' ? '1979 CRT MODE: ON' : '1979 CRT MODE: OFF (CLEAN)',
        next === 'CLASSIC_1979' ? 'amber' : 'green',
        1.4
      );
      return;
    }

    if (id === TOP_CHROME_IDS.AUDIO) {
      this.confirmExitPending = false;
      this.toggleMuteWithToast();
      return;
    }

    if (id === TOP_CHROME_IDS.HUB) {
      this.requestExitToHub();
      return;
    }

    this.confirmExitPending = false;
    this.confirmExitTimer = 0;

    if (id === TOP_CHROME_IDS.DEMO_EXIT) {
      this.exitDemo();
      return;
    }

    if (id === TOP_CHROME_IDS.CONTROLS) {
      this.host.audio.playButtonLatchLock(1.0, 0.85);
      this.osdMenuOpen = false;
      this.manifestOpen = false;
      this.controlsOpen = !this.controlsOpen;
      return;
    }

    if (id === TOP_CHROME_IDS.MENU) {
      this.host.audio.playButtonLatchLock(1.0, 0.85);
      this.controlsOpen = false;
      this.manifestOpen = false;
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
      this.host.audio.playButtonLatchLock(1.04, 0.9);
      void this.submitCurrentScore();
      return;
    }
    if (id === POST_RUN_IDS.OPEN_MANIFEST) {
      this.host.audio.playButtonLatchLock(1.0, 0.85);
      this.osdMenuOpen = false;
      this.controlsOpen = false;
      this.manifestOpen = true;
      return;
    }
    if (id === POST_RUN_IDS.PLAY_AGAIN || id === POST_RUN_IDS.MANIFEST_PLAY_AGAIN) {
      this.host.audio.playButtonLatchLock(1.02, 0.9);
      this.startRun();
      return;
    }
    if (id === POST_RUN_IDS.MANIFEST_CLOSE) {
      this.host.audio.playButtonLatchLock(0.96, 0.85);
      this.manifestOpen = false;
      return;
    }
    if (id === POST_RUN_IDS.EXIT_HUB) {
      this.host.audio.playButtonLatchLock(0.9, 0.9);
      this.host.exitToMuthurOs('EXITED ORBITAL INTERCEPT // FLAK NET. RADAR BUS DISENGAGED.');
      return;
    }

    // 4. Flak-specific HUD buttons
    if (id === 'flak-emp-arm') {
      if (this.sim.phase !== 'ACTIVE_WAVE' || this.sim.paused || this.sim.isDemoMode) return;
      const empBat = this.sim.batteries[1];
      if (!empBat || empBat.ammo <= 0) {
        this.empTouchArmed = false;
        this.host.audio.playMutedAvionicsIndicatorBeep(false);
        return;
      }
      this.empTouchArmed = !this.empTouchArmed;
      this.host.audio.playButtonLatchLock(this.empTouchArmed ? 1.12 : 0.92, 0.88);
      if (this.empTouchArmed) {
        this.showToast('MK-IV EMP ARMED — CLICK / TAP RADAR SKY TO LAUNCH', 'amber', 1.5);
      } else {
        this.showToast('MK-IV EMP DISARMED — M90 FLAK ACTIVE', 'green', 1.0);
      }
      return;
    }

    if (id === 'flak-audit-skip') {
      this.fastForwardWaveAudit();
      return;
    }

    this.host.audio.playButtonLatchLock(0.98, 0.9);

    if (id === 'flak-start') {
      this.startRun();
    } else if (id === 'flak-demo') {
      this.startDemo();
    } else if (id === 'flak-manifest') {
      this.osdMenuOpen = false;
      this.controlsOpen = false;
      this.manifestOpen = true;
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

    if (this.statusToast) {
      this.statusToast.timer -= clampedDt;
      if (this.statusToast.timer <= 0) {
        this.statusToast = null;
      }
    }

    // Disarm touch EMP automatically if leaving active wave or out of EMP ammo
    if (
      this.empTouchArmed &&
      (this.sim.phase !== 'ACTIVE_WAVE' || (this.sim.batteries[1]?.ammo ?? 0) <= 0)
    ) {
      this.empTouchArmed = false;
    }

    const simActive = !this.osdMenuOpen && !this.manifestOpen && !this.controlsOpen;
    if (simActive) {
      if (this.demoDirector.isActive()) {
        this.demoDirector.step(this.sim, clampedDt);
      } else {
        if (import.meta.env.DEV && this.autoBot?.isEnabled()) {
          this.autoBot.step(this.sim, clampedDt, this.cursorVirtual);
        }
        if (this.sim.phase === 'ACTIVE_WAVE' && !this.sim.paused && !this.sim.isDemoMode) {
          this.runPlaytimeSec += clampedDt;
        }
      }
      this.sim.step(clampedDt);
    }

    const anyModalOpen = this.isAnyModalOverlayOpen();
    this.host.setModalOpen(anyModalOpen);

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

    // 1. Render Expanded 1920x1080 Surface-to-Orbit Radar Scope (with screen-space >=13px labels!)
    const botActive = import.meta.env.DEV && Boolean(this.autoBot?.isEnabled());
    this.scopeRenderer.render(ctx, {
      sim: this.sim,
      viewport: layout.scopeViewport,
      timeSec: totalTimeSec,
      cursorVirtual: this.cursorVirtual,
      cursorInsideScope: (this.cursorInsideScope || botActive) && !anyModalOpen,
      demoState,
      empTouchArmed: this.empTouchArmed,
    });

    // 2. Render Standardized Chrome, Slim Right Rail, Bottom Breech/EMP/Dome Dock & Modals
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
        audioMuted: this.host.isMuted(),
        masterVolume: this.host.getMasterVolume(),
        crtPreset: this.host.getCrtPreset(),
        phosphorTheme: this.host.getPhosphorTheme(),
        isFullscreen: this.host.getViewport().isFullscreen,
        isTouchDevice: this.host.isTouchDevice(),
        confirmExitPending: this.confirmExitPending,
        osdMenuOpen: this.osdMenuOpen,
        manifestOpen: this.manifestOpen,
        controlsOpen: this.controlsOpen,
        empTouchArmed: this.empTouchArmed,
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
      modalActive: anyModalOpen,
      chromaScale: anyModalOpen ? 0.06 : 0.22,
    };
  }
}
