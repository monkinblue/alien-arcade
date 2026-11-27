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
  RELAY_SNAP_DURATION_SEC,
} from '../render/BootLogoRenderer';
import type { CrtInteractiveButton } from '../render/HudRenderer';
import { CRT_PRESET_CONFIG, WebGLCRT } from '../render/WebGLCRT';
import { setCrt1979Typography } from '../render/theme';
import { MuthurTerminalCartridge } from '../terminal/MuthurTerminalCartridge';
import type { SafeAreaInsets, ViewportRect } from '../types';
import type {
  Cartridge,
  CartridgeProgramId,
  CrtPreset,
  CrtShaderFrameParams,
  HostEnvironment,
  PhosphorTheme,
} from './Cartridge';

const PHOSPHOR_STORAGE_KEY = 'muthur_phosphor_theme_v1';
const CRT_PRESET_STORAGE_KEY = 'muthur_crt_preset_v2';
const SESSION_LAUNCHED_KEY = 'muthur_launched_programs_v1';

const PROGRAM_LABELS: Record<CartridgeProgramId, string> = {
  lander: 'SLOT 01 // LUNAR LANDER',
  perimeter: "SLOT 02 // HADLEY'S PERIMETER",
  flak: 'SLOT 03 // FLAK NET',
  trench: 'SLOT 04 // DERELICT TRENCH',
};

type HostStage = 'BOOT_HANDSHAKE' | 'CARTRIDGE_LAUNCH' | 'RELAY_SNAP' | 'ACTIVE_CARTRIDGE';

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
  private activeProgramId: CartridgeProgramId | 'hub' = 'hub';

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

  // Global CRT Mode (defaults OFF / Modern Clean; user toggle persists in localStorage), Phosphor Theme & Audio
  private crtPreset: CrtPreset = 'CRISP';
  private phosphorTheme: PhosphorTheme = 'GREEN';
  private audioMuted = false;
  private modalOpen = false;

  // Session-level memory of which cartridges have already played their 4s vector splash
  private launchedThisSession = new Set<CartridgeProgramId>();

  // Boot & Cartridge Launch / Relay Snap Transition State
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

    this.loadPersistedPreferences();

    this.terminalCartridge = new MuthurTerminalCartridge(this);
    this.landerCartridge = new GameController(this);
    this.perimeterCartridge = new PerimeterCartridge(this);
    this.flakCartridge = new FlakNetCartridge(this);
    this.trenchCartridge = new DerelictTrenchCartridge(this);

    const syncFs = () => {
      const docAny = document as Document & { webkitFullscreenElement?: Element | null };
      this.fullscreenActive = Boolean(
        document.fullscreenElement || docAny.webkitFullscreenElement
      );
      this.readSafeAreaInsets();
    };
    document.addEventListener('fullscreenchange', syncFs);
    document.addEventListener('webkitfullscreenchange', syncFs);

    this.bindGlobalA11ySwitches();
    this.resize(window.innerWidth, window.innerHeight, 0, 0);
    this.enterStage('BOOT_HANDSHAKE');
  }

  private loadPersistedPreferences(): void {
    try {
      const savedTheme = window.localStorage.getItem(PHOSPHOR_STORAGE_KEY);
      if (savedTheme === 'GREEN' || savedTheme === 'AMBER' || savedTheme === 'CYAN') {
        this.phosphorTheme = savedTheme;
      }
      const savedPreset = window.localStorage.getItem(CRT_PRESET_STORAGE_KEY);
      if (savedPreset === 'CRISP' || savedPreset === 'CLASSIC_1979') {
        this.crtPreset = savedPreset;
      } else if (savedPreset === 'NOSTROMO_TUBE') {
        this.crtPreset = 'CLASSIC_1979';
      }
    } catch {
      // Ignore storage restrictions
    }
    setCrt1979Typography(this.crtPreset === 'CLASSIC_1979');

    try {
      const raw = window.sessionStorage.getItem(SESSION_LAUNCHED_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (
              item === 'lander' ||
              item === 'perimeter' ||
              item === 'flak' ||
              item === 'trench'
            ) {
              this.launchedThisSession.add(item);
            }
          }
        }
      }
    } catch {
      // Ignore sessionStorage restrictions
    }
  }

  private markProgramLaunchedInSession(program: CartridgeProgramId): void {
    this.launchedThisSession.add(program);
    try {
      window.sessionStorage.setItem(
        SESSION_LAUNCHED_KEY,
        JSON.stringify(Array.from(this.launchedThisSession))
      );
    } catch {
      // Ignore sessionStorage restrictions
    }
  }

  private announceLive(message: string): void {
    if (this.srLiveRegion) {
      this.srLiveRegion.textContent = message;
    }
  }

  private bindGlobalA11ySwitches(): void {
    const crtOrder: readonly CrtPreset[] = ['CLASSIC_1979', 'CRISP'];
    const phosphorOrder: readonly PhosphorTheme[] = ['GREEN', 'AMBER', 'CYAN'];

    document.getElementById('a11y-crt-preset')?.addEventListener('click', () => {
      void this.audio.unlock();
      const next = crtOrder[(crtOrder.indexOf(this.crtPreset) + 1) % crtOrder.length];
      this.setCrtPreset(next);
    });

    document.getElementById('a11y-phosphor-cycle')?.addEventListener('click', () => {
      void this.audio.unlock();
      const next =
        phosphorOrder[(phosphorOrder.indexOf(this.phosphorTheme) + 1) % phosphorOrder.length];
      this.setPhosphorTheme(next);
      this.audio.playButtonLatchLock(1.04, 0.85);
    });

    document.getElementById('a11y-mute-toggle')?.addEventListener('click', () => {
      void this.audio.unlock();
      this.setMuted(!this.audioMuted);
      this.announceLive(this.audioMuted ? 'Audio bus muted.' : 'Audio bus active.');
    });

    document.getElementById('a11y-fullscreen-toggle')?.addEventListener('click', () => {
      this.toggleFullscreen();
    });

    document.getElementById('a11y-hub-return')?.addEventListener('click', () => {
      if (this.activeProgramId !== 'hub') {
        this.exitToMuthurOs('RETURNED VIA ACCESSIBILITY SWITCH.');
      }
    });
  }

  public isTouchDevice(): boolean {
    const coarse =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
    const touchPoints = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
    return coarse || (touchPoints && Math.min(this.viewportWidth, this.viewportHeight) < 900);
  }

  private syncMobileMode(): void {
    this.mobileMode = this.isTouchDevice() && this.viewportWidth < 900;
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
    return CRT_PRESET_CONFIG[this.crtPreset].curve;
  }

  public getCrtPreset(): CrtPreset {
    return this.crtPreset;
  }

  public setCrtPreset(preset: CrtPreset): void {
    this.crtPreset = preset;
    setCrt1979Typography(preset === 'CLASSIC_1979');
    try {
      window.localStorage.setItem(CRT_PRESET_STORAGE_KEY, preset);
    } catch {
      // Ignore storage restrictions
    }
    this.webglCrt.triggerDegauss();
    this.audio.playDegaussRelay();
    this.announceLive(`1979 CRT Mode ${preset === 'CLASSIC_1979' ? 'enabled' : 'disabled'}.`);
  }

  public toggle1979Crt(): CrtPreset {
    const next: CrtPreset = this.crtPreset === 'CLASSIC_1979' ? 'CRISP' : 'CLASSIC_1979';
    this.setCrtPreset(next);
    return next;
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
    this.announceLive(`Phosphor mode set to ${theme}.`);
  }

  public getMasterVolume(): number {
    return this.audio.getMasterVolume();
  }

  public setMasterVolume(vol: number): void {
    this.audio.setMasterVolume(vol);
  }

  public isMuted(): boolean {
    return this.audioMuted;
  }

  public setMuted(muted: boolean): void {
    this.audioMuted = muted;
    this.audio.setMuted(muted);
  }

  public getActiveProgramId(): CartridgeProgramId | 'hub' {
    return this.activeProgramId;
  }

  public setModalOpen(open: boolean): void {
    this.modalOpen = open;
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
    this.startProgramTransition(program);
  }

  public quickSwitchProgram(program: CartridgeProgramId): void {
    this.startProgramTransition(program);
  }

  private startProgramTransition(program: CartridgeProgramId): void {
    this.unmountActiveCartridge();
    this.audio.stopCartridgeLoops();
    this.launchingProgram = program;
    this.launchElapsedSec = 0;

    const alreadySeen = this.launchedThisSession.has(program);
    if (alreadySeen) {
      // Snappy 0.45s CRT relay snap on repeat switches
      this.hostGlitch = Math.max(this.hostGlitch, 0.46);
      this.audio.playRelaySnap();
      this.enterStage('RELAY_SNAP');
    } else {
      // Iconic full vector launch only on FIRST launch per program per session (0ms instant skip!)
      this.markProgramLaunchedInSession(program);
      this.hostGlitch = Math.max(this.hostGlitch, 0.72);
      this.audio.playScaryComputerTransition('dark', 0, 0.52);
      this.audio.playAlienComputerActivity(0.42);
      this.enterStage('CARTRIDGE_LAUNCH');
    }
  }

  private mountProgramById(program: CartridgeProgramId): void {
    this.audio.fadeOutBootStartupAudio(0.45);
    this.hostGlitch = Math.max(this.hostGlitch, 0.30);
    if (program === 'lander') {
      this.mountCartridge(this.landerCartridge, 'lander');
    } else if (program === 'perimeter') {
      this.mountCartridge(this.perimeterCartridge, 'perimeter');
    } else if (program === 'trench') {
      this.mountCartridge(this.trenchCartridge, 'trench');
    } else {
      this.mountCartridge(this.flakCartridge, 'flak');
    }
  }

  public exitToMuthurOs(reasonLog?: string): void {
    this.unmountActiveCartridge();
    this.audio.stopCartridgeLoops();
    this.hostGlitch = 0.72;
    this.syncTearTimer = 0.24;
    this.audio.playRelaySnap();
    this.terminalCartridge.setReturnNotice(
      reasonLog ?? 'RETURNED TO MU-TH-UR 6000 COMMAND TERMINAL.'
    );
    this.mountCartridge(this.terminalCartridge, 'hub');
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
    this.modalOpen = false;
    if (this.activeCartridge) {
      this.activeCartridge.unmount();
      this.activeCartridge = null;
    }
  }

  private mountCartridge(cartridge: Cartridge, programId: CartridgeProgramId | 'hub'): void {
    this.clearStageListeners();
    this.unmountActiveCartridge();
    this.stage = 'ACTIVE_CARTRIDGE';
    this.activeCartridge = cartridge;
    this.activeProgramId = programId;
    this.modalOpen = false;
    cartridge.mount();
    this.announceLive(
      programId === 'hub'
        ? 'MU-TH-UR 6000 OS Hub active.'
        : `${PROGRAM_LABELS[programId]} active.`
    );
  }

  private clearStageListeners(): void {
    if (this.stageListenerAbort) {
      this.stageListenerAbort.abort();
      this.stageListenerAbort = null;
    }
    this.bootHoveredBtnId = null;
    document.body.style.cursor = 'default';
  }

  private enterStage(nextStage: 'BOOT_HANDSHAKE' | 'CARTRIDGE_LAUNCH' | 'RELAY_SNAP'): void {
    this.clearStageListeners();
    this.unmountActiveCartridge();
    this.stage = nextStage;
    this.stageListenerAbort = new AbortController();
    const signal = this.stageListenerAbort.signal;

    const completeCurrentTransition = (): void => {
      if (this.stage === 'BOOT_HANDSHAKE') {
        this.audio.playRelaySnap();
        this.hostGlitch = Math.max(this.hostGlitch, 0.32);
        this.mountCartridge(this.terminalCartridge, 'hub');
      } else if (this.stage === 'CARTRIDGE_LAUNCH' || this.stage === 'RELAY_SNAP') {
        this.audio.playRelaySnap();
        this.mountProgramById(this.launchingProgram);
      }
    };

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
          this.getCrtIntensity()
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
          // Instant 0ms skip straight into MU-TH-UR Hub (zero lockout, zero collapse tail!)
          completeCurrentTransition();
          return;
        }

        if (this.stage === 'CARTRIDGE_LAUNCH' || this.stage === 'RELAY_SNAP') {
          // Instant 0ms skip straight into target cartridge
          completeCurrentTransition();
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
          // Instant 0ms skip on any key once powered on
          if (!e.repeat && !['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) {
            completeCurrentTransition();
          }
          return;
        }

        if (this.stage === 'CARTRIDGE_LAUNCH' || this.stage === 'RELAY_SNAP') {
          if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') {
            completeCurrentTransition();
          }
        }
      },
      { signal }
    );
  }

  private awakenHardware(): void {
    if (this.bootPoweredOn) return;
    this.syncMobileMode();
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
    this.syncMobileMode();

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
        oCtx.restore();
        this.hostGlitch = Math.max(this.hostGlitch, 0.32);
        this.mountCartridge(this.terminalCartridge, 'hub');
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
        this.bootPoweredOn && this.bootElapsedSec < 0.95
          ? Math.pow(1 - this.bootElapsedSec / 0.95, 1.35)
          : 0;
    } else if (this.stage === 'RELAY_SNAP') {
      this.launchElapsedSec += dt;
      if (this.launchElapsedSec >= RELAY_SNAP_DURATION_SEC) {
        oCtx.restore();
        this.mountProgramById(this.launchingProgram);
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
        sequenceMode: 'RELAY_SNAP',
        relayTargetLabel: PROGRAM_LABELS[this.launchingProgram],
      });
      shaderParams.interference = 0.04;
    } else if (this.stage === 'CARTRIDGE_LAUNCH') {
      this.launchElapsedSec += dt;
      if (this.launchElapsedSec >= CARTRIDGE_LAUNCH_TIMING.COMPLETE_SEC) {
        oCtx.restore();
        this.mountProgramById(this.launchingProgram);
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
      const y1 = (this.totalTimeSec * 420) % this.crtRect.height;
      oCtx.fillRect(0, y1, this.crtRect.width, 10 * p);
      oCtx.fillStyle = `rgba(255, 176, 0, ${(0.24 * p).toFixed(2)})`;
      oCtx.fillRect(0, this.crtRect.height - y1, this.crtRect.width, 6 * p);
    }

    oCtx.restore();

    const phosphorMode =
      this.phosphorTheme === 'AMBER' ? 1 : this.phosphorTheme === 'CYAN' ? 2 : 0;

    const presetCfg = CRT_PRESET_CONFIG[this.crtPreset];
    const isModal = this.modalOpen || Boolean(shaderParams.modalActive);
    let effectiveChroma: number;
    if (!presetCfg.enabled1979) {
      effectiveChroma = 0.0;
    } else if (isModal) {
      effectiveChroma = 0.36;
    } else if (shaderParams.chromaScale !== undefined) {
      effectiveChroma =
        shaderParams.chromaScale <= 0.12 ? 0.36 : presetCfg.defaultChroma;
    } else {
      effectiveChroma = presetCfg.defaultChroma;
    }

    this.webglCrt.render(
      this.offscreenCanvas,
      this.crtRect,
      this.dpr,
      this.totalTimeSec,
      this.getCrtIntensity(),
      shaderParams.interference,
      Math.max(shaderParams.glitch, this.hostGlitch),
      shaderParams.overdrive,
      shaderParams.tubeTurnOn,
      shaderParams.shockwaves,
      phosphorMode,
      effectiveChroma,
      this.crtPreset
    );
  }
}
