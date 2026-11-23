import { AudioEngine } from '../audio/AudioEngine';
import { PHYSICS } from '../constants';
import { GameController } from '../game/GameController';
import { DerelictTrenchCartridge } from '../games/derelictTrench/DerelictTrenchCartridge';
import { FlakNetCartridge } from '../games/flakNet/FlakNetCartridge';
import { PerimeterCartridge } from '../perimeter/PerimeterCartridge';
import {
  BOOT_TIMING,
  BootLogoRenderer,
  CARTRIDGE_LAUNCH_TIMING,
} from '../render/BootLogoRenderer';
import type { CrtInteractiveButton } from '../render/HudRenderer';
import { WebGLCRT } from '../render/WebGLCRT';
import { MuthurTerminalCartridge } from '../terminal/MuthurTerminalCartridge';
import type { SafeAreaInsets, ViewportRect } from '../types';
import type {
  Cartridge,
  CartridgeProgramId,
  CrtShaderFrameParams,
  HostEnvironment,
  PhosphorTheme,
} from './Cartridge';

const PHOSPHOR_STORAGE_KEY = 'muthur_phosphor_theme_v1';

type HostStage = 'BOOT_HANDSHAKE' | 'CARTRIDGE_LAUNCH' | 'ACTIVE_CARTRIDGE';

export class CartridgeHost implements HostEnvironment {
  public readonly audio = new AudioEngine();
  public readonly webglCrt: WebGLCRT;
  public readonly srLiveRegion: HTMLElement | null;

  private webglCanvas: HTMLCanvasElement;
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;

  private bootLogoRenderer = new BootLogoRenderer();
  private terminalCartridge: MuthurTerminalCartridge;
  private landerCartridge: GameController;
  private perimeterCartridge: PerimeterCartridge;
  private flakCartridge: FlakNetCartridge;
  private trenchCartridge: DerelictTrenchCartridge;
  private activeCartridge: Cartridge | null = null;

  private stage: HostStage = 'BOOT_HANDSHAKE';
  private stageListenerAbort: AbortController | null = null;

  private dpr = 1;
  private viewportWidth = 1280;
  private viewportHeight = 800;
  private offsetX = 0;
  private offsetY = 0;
  private crtRect: ViewportRect = { x: 0, y: 0, width: 1280, height: 800 };
  private safeAreaInsets: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private fullscreenActive = false;
  private mobileMode = false;

  // Locked flat 0% blur/curvature CRT monitor across all programs + user-selectable phosphor tint
  private readonly crtIntensity = 0;
  private phosphorTheme: PhosphorTheme = 'GREEN';
  private audioMuted = false;

  // Boot & Cartridge Launch Transition State
  private bootPoweredOn = false;
  private bootElapsedSec = 0;
  private bootButtons: CrtInteractiveButton[] = [];
  private bootHoveredBtnId: string | null = null;
  private launchingProgram: CartridgeProgramId = 'lander';
  private launchElapsedSec = 0;

  private totalTimeSec = 0;
  private hostGlitch = 0;
  private syncTearTimer = 0;

  constructor(webglCanvas: HTMLCanvasElement, srLiveRegion: HTMLElement | null) {
    this.webglCanvas = webglCanvas;
    this.srLiveRegion = srLiveRegion;

    this.offscreenCanvas = document.createElement('canvas');
    const ctx = this.offscreenCanvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Failed to create offscreen 2D CRT framebuffer context.');
    }
    this.offscreenCtx = ctx;
    this.webglCrt = new WebGLCRT(this.webglCanvas);

    this.terminalCartridge = new MuthurTerminalCartridge(this);
    this.landerCartridge = new GameController(this);
    this.perimeterCartridge = new PerimeterCartridge(this);
    this.flakCartridge = new FlakNetCartridge(this);
    this.trenchCartridge = new DerelictTrenchCartridge(this);

    try {
      const savedTheme = window.localStorage.getItem(PHOSPHOR_STORAGE_KEY);
      if (savedTheme === 'GREEN' || savedTheme === 'AMBER' || savedTheme === 'CYAN') {
        this.phosphorTheme = savedTheme;
      }
    } catch {
      // Ignore storage restrictions
    }

    const syncFs = () => {
      const docAny = document as Document & { webkitFullscreenElement?: Element | null };
      this.fullscreenActive = Boolean(
        document.fullscreenElement || docAny.webkitFullscreenElement
      );
      this.readSafeAreaInsets();
    };
    document.addEventListener('fullscreenchange', syncFs);
    document.addEventListener('webkitfullscreenchange', syncFs);

    this.resize(window.innerWidth, window.innerHeight, 0, 0);
    this.enterStage('BOOT_HANDSHAKE');
  }

  public getViewport() {
    return {
      width: this.viewportWidth,
      height: this.viewportHeight,
      dpr: this.dpr,
      offsetX: this.offsetX,
      offsetY: this.offsetY,
      crtRect: this.crtRect,
      safeAreaInsets: this.safeAreaInsets,
      isFullscreen: this.fullscreenActive,
      mobileMode: this.mobileMode,
    };
  }

  public getCrtIntensity(): number {
    return this.crtIntensity;
  }

  public getPhosphorTheme(): PhosphorTheme {
    return this.phosphorTheme;
  }

  public setPhosphorTheme(theme: PhosphorTheme): void {
    this.phosphorTheme = theme;
    try {
      window.localStorage.setItem(PHOSPHOR_STORAGE_KEY, theme);
    } catch {
      // Ignore storage restrictions
    }
  }

  public isMuted(): boolean {
    return this.audioMuted;
  }

  public setMuted(muted: boolean): void {
    this.audioMuted = muted;
    this.audio.setMuted(muted);
  }

  public toggleFullscreen(): void {
    const docAny = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const targetEl = (document.getElementById('console-shell') ||
      document.documentElement) as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };

    if (document.fullscreenElement || docAny.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        void document.exitFullscreen().catch(() => {});
      } else if (docAny.webkitExitFullscreen) {
        void docAny.webkitExitFullscreen();
      }
      return;
    }

    if (targetEl.requestFullscreen) {
      void targetEl
        .requestFullscreen({ navigationUI: 'hide' })
        .catch(() => targetEl.requestFullscreen())
        .catch(() => {});
    } else if (targetEl.webkitRequestFullscreen) {
      void targetEl.webkitRequestFullscreen();
    }
  }

  public triggerSyncGlitch(intensity = 0.7): void {
    this.hostGlitch = Math.max(this.hostGlitch, intensity);
  }

  public launchProgram(program: CartridgeProgramId): void {
    this.unmountActiveCartridge();
    this.audio.stopCartridgeLoops();
    this.launchingProgram = program;
    this.launchElapsedSec = 0;
    this.hostGlitch = Math.max(this.hostGlitch, 0.78);
    this.audio.playScaryComputerTransition('dark', 0, 0.55);
    this.audio.playAlienComputerActivity(0.45);
    this.enterStage('CARTRIDGE_LAUNCH');
  }

  public exitToMuthurOs(reasonLog?: string): void {
    this.unmountActiveCartridge();
    this.audio.stopCartridgeLoops();
    this.hostGlitch = 0.92;
    this.syncTearTimer = 0.32;
    this.audio.playScaryComputerTransition('dark', 0, 0.5);
    this.terminalCartridge.setReturnNotice(
      reasonLog ?? 'RETURNED TO MU-TH-UR 6000 COMMAND TERMINAL.'
    );
    this.mountCartridge(this.terminalCartridge);
  }

  public coldRebootMuthur(): void {
    this.unmountActiveCartridge();
    this.audio.stopCartridgeLoops();
    this.bootPoweredOn = true;
    this.bootElapsedSec = 0;
    this.hostGlitch = 1.0;
    this.syncTearTimer = 0.32;
    this.terminalCartridge.setReturnNotice(
      'EMERGENCY DESTRUCT RECOVERY COMPLETE // MU-TH-UR 6000 COLD-REBOOTED.'
    );
    this.enterStage('BOOT_HANDSHAKE');
    void this.audio.unlock().then(() => {
      this.audio.playAlienBootAwakening();
    });
  }

  private unmountActiveCartridge(): void {
    if (this.activeCartridge) {
      this.activeCartridge.unmount();
      this.activeCartridge = null;
    }
  }

  private mountCartridge(cartridge: Cartridge): void {
    this.clearStageListeners();
    this.unmountActiveCartridge();
    this.stage = 'ACTIVE_CARTRIDGE';
    this.activeCartridge = cartridge;
    cartridge.mount();
  }

  private clearStageListeners(): void {
    if (this.stageListenerAbort) {
      this.stageListenerAbort.abort();
      this.stageListenerAbort = null;
    }
    this.bootHoveredBtnId = null;
    document.body.style.cursor = 'default';
  }

  private enterStage(nextStage: 'BOOT_HANDSHAKE' | 'CARTRIDGE_LAUNCH'): void {
    this.clearStageListeners();
    this.unmountActiveCartridge();
    this.stage = nextStage;
    this.stageListenerAbort = new AbortController();
    const signal = this.stageListenerAbort.signal;

    window.addEventListener(
      'pointermove',
      (e) => {
        if (this.stage !== 'BOOT_HANDSHAKE' || this.bootPoweredOn) {
          this.bootHoveredBtnId = null;
          document.body.style.cursor = 'default';
          return;
        }
        const mapped = this.webglCrt.mapClientToCrtUv(
          e.clientX - this.offsetX,
          e.clientY - this.offsetY,
          this.crtRect,
          this.crtIntensity
        );
        if (!mapped.inside) {
          this.bootHoveredBtnId = null;
          document.body.style.cursor = 'default';
          return;
        }
        const cx = mapped.u * this.crtRect.width;
        const cy = mapped.v * this.crtRect.height;
        const hit = this.hitTestBootButtons(cx, cy);
        this.bootHoveredBtnId = hit;
        document.body.style.cursor = hit ? 'pointer' : 'default';
      },
      { signal }
    );

    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        if (this.stage === 'BOOT_HANDSHAKE') {
          if (!this.bootPoweredOn) {
            this.awakenHardware();
            return;
          }
          if (this.bootElapsedSec >= 0.72 && this.bootElapsedSec < BOOT_TIMING.LOGO_HOLD_END_SEC) {
            this.audio.playButtonLatchLock(0.95, 0.9);
            this.bootElapsedSec = BOOT_TIMING.LOGO_HOLD_END_SEC;
            this.hostGlitch = Math.max(this.hostGlitch, 0.45);
          }
          return;
        }

        if (this.stage === 'CARTRIDGE_LAUNCH') {
          if (
            this.launchElapsedSec >= 0.35 &&
            this.launchElapsedSec < CARTRIDGE_LAUNCH_TIMING.HOLD_END_SEC
          ) {
            this.audio.playButtonLatchLock(0.95, 0.9);
            this.launchElapsedSec = CARTRIDGE_LAUNCH_TIMING.HOLD_END_SEC;
            this.hostGlitch = Math.max(this.hostGlitch, 0.42);
          }
        }
      },
      { signal }
    );

    window.addEventListener(
      'keydown',
      (e) => {
        if (['Space', 'Enter', 'Escape', 'Tab'].includes(e.code)) {
          e.preventDefault();
        }
        if (this.stage === 'BOOT_HANDSHAKE') {
          if (!this.bootPoweredOn) {
            this.awakenHardware();
            return;
          }
          if (
            (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') &&
            this.bootElapsedSec >= 0.72 &&
            this.bootElapsedSec < BOOT_TIMING.LOGO_HOLD_END_SEC
          ) {
            this.audio.playButtonLatchLock(0.95, 0.9);
            this.bootElapsedSec = BOOT_TIMING.LOGO_HOLD_END_SEC;
            this.hostGlitch = Math.max(this.hostGlitch, 0.45);
          }
          return;
        }

        if (this.stage === 'CARTRIDGE_LAUNCH') {
          if (
            (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') &&
            this.launchElapsedSec >= 0.35 &&
            this.launchElapsedSec < CARTRIDGE_LAUNCH_TIMING.HOLD_END_SEC
          ) {
            this.audio.playButtonLatchLock(0.95, 0.9);
            this.launchElapsedSec = CARTRIDGE_LAUNCH_TIMING.HOLD_END_SEC;
            this.hostGlitch = Math.max(this.hostGlitch, 0.42);
          }
        }
      },
      { signal }
    );
  }

  private awakenHardware(): void {
    if (this.bootPoweredOn) return;
    this.mobileMode = false;
    this.bootPoweredOn = true;
    this.bootElapsedSec = 0;
    this.hostGlitch = 0.88;
    void this.audio.unlock().then(() => {
      this.audio.playAlienBootAwakening();
    });
  }

  private hitTestBootButtons(cx: number, cy: number): string | null {
    for (let i = this.bootButtons.length - 1; i >= 0; i--) {
      const b = this.bootButtons[i];
      if (
        cx >= b.rect.x &&
        cx <= b.rect.x + b.rect.width &&
        cy >= b.rect.y &&
        cy <= b.rect.y + b.rect.height
      ) {
        return b.id;
      }
    }
    return null;
  }

  public resize(widthCss: number, heightCss: number, offsetX = 0, offsetY = 0): void {
    this.viewportWidth = Math.max(320, widthCss);
    this.viewportHeight = Math.max(240, heightCss);
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    this.webglCanvas.width = Math.round(this.viewportWidth * this.dpr);
    this.webglCanvas.height = Math.round(this.viewportHeight * this.dpr);

    this.crtRect = { x: 0, y: 0, width: this.viewportWidth, height: this.viewportHeight };
    this.offscreenCanvas.width = Math.round(this.crtRect.width * this.dpr);
    this.offscreenCanvas.height = Math.round(this.crtRect.height * this.dpr);
    this.readSafeAreaInsets();

    this.activeCartridge?.resize(this.viewportWidth, this.viewportHeight, offsetX, offsetY);
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

  public setBackgroundPaused(paused: boolean): void {
    this.audio.suspendForBackground(paused);
    this.activeCartridge?.setBackgroundPaused(paused);
  }

  public updateAndRender(frameDt: number): void {
    const dt = Math.min(PHYSICS.MAX_FRAME_DT, Math.max(0, frameDt));
    this.totalTimeSec += dt;

    if (this.hostGlitch > 0) {
      this.hostGlitch = Math.max(0, this.hostGlitch - dt * 1.65);
    }
    if (this.syncTearTimer > 0) {
      this.syncTearTimer = Math.max(0, this.syncTearTimer - dt);
    }

    const oCtx = this.offscreenCtx;
    oCtx.save();
    oCtx.scale(this.dpr, this.dpr);

    let shaderParams: CrtShaderFrameParams = {
      interference: 0.014,
      glitch: 0,
      overdrive: 0,
      tubeTurnOn: 0,
    };

    if (this.stage === 'BOOT_HANDSHAKE') {
      if (this.bootPoweredOn) {
        this.bootElapsedSec += dt;
      }

      if (this.bootPoweredOn && this.bootElapsedSec >= BOOT_TIMING.PROTOCOL_START_SEC) {
        // Transition directly from hardware power-on + 180924609 // INTERFACE 2037 handshake into MU-TH-UR 6000 OS Hub!
        oCtx.restore();
        this.hostGlitch = Math.max(this.hostGlitch, 0.36);
        this.mountCartridge(this.terminalCartridge);
        this.updateAndRender(0.001);
        return;
      }

      this.bootButtons = [];
      this.bootLogoRenderer.render(oCtx, {
        width: this.crtRect.width,
        height: this.crtRect.height,
        timeSec: this.totalTimeSec,
        bootPoweredOn: this.bootPoweredOn,
        mobileMode: this.mobileMode,
        bootElapsedSec: this.bootElapsedSec,
        bootProgressChars: 0,
        bootLines: [],
        hoveredButtonId: this.bootHoveredBtnId,
        buttonsOut: this.bootButtons,
        sequenceMode: 'HARDWARE_HANDSHAKE',
      });

      shaderParams.tubeTurnOn =
        this.bootPoweredOn && this.bootElapsedSec < 1.05
          ? Math.pow(1 - this.bootElapsedSec / 1.05, 1.35)
          : 0;
    } else if (this.stage === 'CARTRIDGE_LAUNCH') {
      this.launchElapsedSec += dt;
      if (this.launchElapsedSec >= CARTRIDGE_LAUNCH_TIMING.COMPLETE_SEC) {
        oCtx.restore();
        this.hostGlitch = Math.max(this.hostGlitch, 0.35);
        this.audio.fadeOutBootStartupAudio(0.8);
        if (this.launchingProgram === 'lander') {
          this.mountCartridge(this.landerCartridge);
        } else if (this.launchingProgram === 'perimeter') {
          this.mountCartridge(this.perimeterCartridge);
        } else if (this.launchingProgram === 'trench') {
          this.mountCartridge(this.trenchCartridge);
        } else {
          this.mountCartridge(this.flakCartridge);
        }
        this.updateAndRender(0.001);
        return;
      }

      this.bootButtons = [];
      this.bootLogoRenderer.render(oCtx, {
        width: this.crtRect.width,
        height: this.crtRect.height,
        timeSec: this.totalTimeSec,
        bootPoweredOn: true,
        mobileMode: this.mobileMode,
        bootElapsedSec: this.launchElapsedSec,
        bootProgressChars: 0,
        bootLines: [],
        hoveredButtonId: null,
        buttonsOut: this.bootButtons,
        sequenceMode:
          this.launchingProgram === 'trench'
            ? 'TRENCH_LAUNCH'
            : this.launchingProgram === 'flak'
              ? 'FLAK_LAUNCH'
              : this.launchingProgram === 'perimeter'
                ? 'PERIMETER_LAUNCH'
                : 'LANDER_LAUNCH',
      });
      shaderParams.interference = 0.03;
    } else if (this.activeCartridge) {
      shaderParams = this.activeCartridge.updateAndRender(dt, oCtx, this.totalTimeSec);
    }

    // Horizontal CRT sync-glitch raster bars during cartridge exit / mode transitions
    if (this.syncTearTimer > 0) {
      const p = this.syncTearTimer / 0.32;
      oCtx.fillStyle = `rgba(68, 255, 119, ${(0.28 * p).toFixed(2)})`;
      const y1 = ((this.totalTimeSec * 420) % this.crtRect.height);
      oCtx.fillRect(0, y1, this.crtRect.width, 10 * p);
      oCtx.fillStyle = `rgba(255, 176, 0, ${(0.24 * p).toFixed(2)})`;
      oCtx.fillRect(0, this.crtRect.height - y1, this.crtRect.width, 6 * p);
    }

    oCtx.restore();

    const phosphorMode =
      this.phosphorTheme === 'AMBER' ? 1 : this.phosphorTheme === 'CYAN' ? 2 : 0;

    this.webglCrt.render(
      this.offscreenCanvas,
      this.crtRect,
      this.dpr,
      this.totalTimeSec,
      this.crtIntensity,
      shaderParams.interference,
      Math.max(shaderParams.glitch, this.hostGlitch),
      shaderParams.overdrive,
      shaderParams.tubeTurnOn,
      shaderParams.shockwaves,
      phosphorMode,
      shaderParams.chromaScale ?? 1.0
    );
  }
}
