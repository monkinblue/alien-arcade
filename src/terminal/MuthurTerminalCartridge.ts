import {
  drawChromeButton,
  type ChromeButtonAccent,
  type ChromeButtonHitbox,
} from '../render/chrome/ModalFrame';
import { draw1979RankedBonusBanner } from '../render/chrome/TopChromeBar';
import {
  drawCornerBrackets,
  drawEllipsizedText,
  font,
  isCrt1979Typography,
  SEMIOTIC_ICONS,
  THEME,
  wrapTextLines,
} from '../render/theme';
import { CRT_PRESET_CONFIG } from '../render/WebGLCRT';
import { HubLeadersService } from '../services/hubLeaders';
import type {
  Cartridge,
  CartridgeProgramId,
  CrtPreset,
  CrtShaderFrameParams,
  HostEnvironment,
  PhosphorTheme,
} from '../shell/Cartridge';
import type { ViewportRect } from '../types';

interface TerminalLine {
  text: string;
  tone: 'green' | 'bright' | 'amber' | 'secondary' | 'red' | 'cyan';
}

interface TerminalHitBox {
  id: string;
  rect: ViewportRect;
  action: () => void;
}

interface CartridgeBaySpec {
  slotCode: string;
  keyNum: '1' | '2' | '3' | '4' | '5';
  programId: CartridgeProgramId;
  title: string;
  ruleset: string;
  icon: string;
  accent: string;
  accentKind: ChromeButtonAccent;
}

const CARTRIDGE_BAYS: readonly CartridgeBaySpec[] = [
  {
    slotCode: 'SLOT 01',
    keyNum: '1',
    programId: 'lander',
    title: 'LUNAR LANDER',
    ruleset: '6 SECTORS / ENDLESS',
    icon: SEMIOTIC_ICONS.TRIANGLE,
    accent: THEME.TEXT_PRIMARY,
    accentKind: 'green',
  },
  {
    slotCode: 'SLOT 02',
    keyNum: '2',
    programId: 'perimeter',
    title: "HADLEY'S PERIMETER",
    ruleset: 'ENDLESS SIEGE // CAD',
    icon: SEMIOTIC_ICONS.HEX,
    accent: THEME.ACCENT_AMBER,
    accentKind: 'amber',
  },
  {
    slotCode: 'SLOT 03',
    keyNum: '3',
    programId: 'flak',
    title: 'FLAK NET',
    ruleset: 'ORBITAL INTERCEPT WAVES',
    icon: SEMIOTIC_ICONS.DIAMOND,
    accent: THEME.TEXT_BRIGHT,
    accentKind: 'green',
  },
  {
    slotCode: 'SLOT 04',
    keyNum: '4',
    programId: 'trench',
    title: 'DERELICT TRENCH',
    ruleset: '3D VECTOR JET SORTIE',
    icon: SEMIOTIC_ICONS.CROSS,
    accent: THEME.ACCENT_CYAN,
    accentKind: 'cyan',
  },
  {
    slotCode: 'SLOT 05',
    keyNum: '5',
    programId: 'approach',
    title: 'BOREALIS APPROACH',
    ruleset: 'LV-118 RAPCON // ATC SIM',
    icon: SEMIOTIC_ICONS.DOT_LIVE,
    accent: THEME.TEXT_PRIMARY,
    accentKind: 'green',
  },
];

const INITIAL_HEADER_LINES: readonly TerminalLine[] = [
  {
    text: 'WEYLAND-YUTANI CORP // INTERFACE 2037 // MU-TH-UR 6000',
    tone: 'amber',
  },
  {
    text: '64K RAM READY // ORBITAL TELEMETRY RELAY ACTIVE',
    tone: 'green',
  },
  {
    text: 'PRESS [1-5] OR CLICK ANY SYSTEM PROGRAM TO LAUNCH INSTANTLY.',
    tone: 'bright',
  },
  {
    text: "CLI DIRECTIVES: 'HELP', 'LEADERBOARD', 'DIAG', 'QUERY <TEXT>', [TAB] COMPLETE.",
    tone: 'secondary',
  },
];

const AUTOCOMPLETE_COMMANDS = [
  'HELP',
  'LEADERBOARD',
  'SCORES',
  'DIAG',
  'STATUS',
  'RUN 1',
  'RUN 2',
  'RUN 3',
  'RUN 4',
  'RUN 5',
  'LANDER',
  'PERIMETER',
  'FLAK',
  'TRENCH',
  'APPROACH',
  'BOREALIS',
  'RAPCON',
  'QUERY ',
  'ASK ',
  'CREW',
  'MANIFEST',
  'BIOSCAN',
  'MEDBAY',
  'SIGNAL',
  'DECODE',
  'BEACON',
  'DESTRUCT',
  'ABORT',
  'CRT ON',
  'CRT OFF',
  'CRT 1979',
  'CRT CRISP',
  'PHOSPHOR GREEN',
  'PHOSPHOR AMBER',
  'PHOSPHOR CYAN',
  'ORDER 937',
  'DIR',
  'CLS',
  'MUTE',
  'MUSIC',
];

const MAX_SCROLLBACK_LINES = 140;

export class MuthurTerminalCartridge implements Cartridge {
  public readonly id = 'terminal';
  private host: HostEnvironment;
  private hubLeaders = new HubLeadersService();
  private listenerAbort: AbortController | null = null;

  private viewportWidth = 1280;
  private viewportHeight = 800;
  private offsetX = 0;
  private offsetY = 0;
  private crtRect: ViewportRect = { x: 0, y: 0, width: 1280, height: 800 };

  private lines: TerminalLine[] = [];
  private revealedCharCount = 0;
  private totalLineChars = 0;
  /** Number of wrapped display lines scrolled upward from the bottom (0 = pinned to newest) */
  private scrollOffsetLines = 0;
  private lastMaxScrollOffset = 0;

  private inputBuffer = '';
  private commandHistory: string[] = [];
  private historyIndex = -1;

  // Ship Ops submenu & guarded destruct latch (prevents stray clicks triggering cold reboot!)
  private shipOpsOpen = false;
  private destructConfirmArmed = false;

  private hitBoxes: TerminalHitBox[] = [];
  private hoveredHitId: string | null = null;
  private glitchPulse = 0;
  private ambientTimer = 18.0;

  private returnBannerMessage: string | null = null;
  private hasCompletedInitialBootReveal = false;

  // Interactive Movie Sequences (BIOSCAN, SIGNAL, SELF-DESTRUCT)
  private bioscanActive = false;
  private bioscanElapsed = 0;
  private readonly bioscanDuration = 2.15;

  private signalActive = false;
  private signalElapsed = 0;
  private readonly signalDuration = 3.1;

  private destructActive = false;
  private destructRemaining = 10.0;
  private destructLastAnnouncedSec = 11;
  private destructWhiteoutTimer = 0;
  private destructKlaxonPulseTimer = 0;

  // Strictly isolated transient Web Audio nodes owned by Terminal sequences
  private terminalAudioNodes = new Set<AudioNode>();
  private terminalAudioSources = new Set<AudioScheduledSourceNode>();

  constructor(host: HostEnvironment) {
    this.host = host;
  }

  public setReturnNotice(message: string | null): void {
    this.returnBannerMessage = message;
  }

  public mount(): void {
    this.unmount();
    // Hub terminal is strictly silent of gameplay music; fade out any lingering track cleanly
    this.host.music.stopGameplayMusic();
    this.host.music.setVhfDuck(false);
    this.listenerAbort = new AbortController();
    const signal = this.listenerAbort.signal;

    const vp = this.host.getViewport();
    this.resize(vp.width, vp.height, vp.offsetX, vp.offsetY);

    this.inputBuffer = '';
    this.hoveredHitId = null;
    this.scrollOffsetLines = 0;
    this.shipOpsOpen = false;
    this.destructConfirmArmed = false;

    this.bioscanActive = false;
    this.bioscanElapsed = 0;
    this.signalActive = false;
    this.signalElapsed = 0;
    this.destructActive = false;
    this.destructRemaining = 10.0;
    this.destructLastAnnouncedSec = 11;
    this.destructWhiteoutTimer = 0;

    // Lift #mobile-callsign-input maxlength to 48 while Hub CLI is active (restored to 12 on unmount)
    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (mobileInput) {
      mobileInput.maxLength = 48;
      mobileInput.setAttribute('maxlength', '48');
      mobileInput.value = '';
    }

    this.resetLinesToPrompt(!this.hasCompletedInitialBootReveal);
    if (this.returnBannerMessage) {
      this.appendLines(
        [
          { text: `SYS> ${this.returnBannerMessage}`, tone: 'amber' },
          { text: 'READY FOR NEXT CARTRIDGE OR CLI DIRECTIVE.', tone: 'secondary' },
        ],
        false
      );
      this.returnBannerMessage = null;
    }
    this.hasCompletedInitialBootReveal = true;

    this.bindListeners(signal);
  }

  public unmount(): void {
    if (this.listenerAbort) {
      this.listenerAbort.abort();
      this.listenerAbort = null;
    }
    this.stopTerminalSequencesAudio();
    this.hoveredHitId = null;
    this.shipOpsOpen = false;
    this.destructConfirmArmed = false;
    this.destructActive = false;
    this.bioscanActive = false;
    this.signalActive = false;
    document.body.style.cursor = 'default';

    // Restore #mobile-callsign-input maxlength to 12 for game Callsign inputs
    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (mobileInput) {
      mobileInput.maxLength = 12;
      mobileInput.setAttribute('maxlength', '12');
      if (document.activeElement === mobileInput) {
        mobileInput.blur();
      }
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
      this.stopTerminalSequencesAudio();
    }
  }

  private stopTerminalSequencesAudio(): void {
    for (const src of this.terminalAudioSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore
      }
    }
    this.terminalAudioSources.clear();
    for (const n of this.terminalAudioNodes) {
      try {
        n.disconnect();
      } catch {
        // Ignore
      }
    }
    this.terminalAudioNodes.clear();
  }

  private resetLinesToPrompt(animateFromZero: boolean): void {
    this.lines = INITIAL_HEADER_LINES.map((l) => ({ ...l }));
    this.scrollOffsetLines = 0;
    this.recomputeTotalChars();
    this.revealedCharCount = animateFromZero ? 0 : this.totalLineChars;
  }

  private recomputeTotalChars(): void {
    this.totalLineChars = this.lines.reduce((acc, l) => acc + Math.max(1, l.text.length), 0);
  }

  private appendLines(newLines: TerminalLine[], animateNew = true): void {
    const prevTotal = this.totalLineChars;
    for (const nl of newLines) {
      this.lines.push(nl);
    }
    if (this.lines.length > MAX_SCROLLBACK_LINES) {
      this.lines.splice(0, this.lines.length - MAX_SCROLLBACK_LINES);
    }
    this.scrollOffsetLines = 0;
    this.recomputeTotalChars();
    if (animateNew) {
      const newCount = newLines.reduce((acc, l) => acc + Math.max(1, l.text.length), 0);
      this.revealedCharCount = Math.max(0, Math.min(prevTotal, this.totalLineChars - newCount));
    } else {
      this.revealedCharCount = this.totalLineChars;
    }
  }

  private adjustScroll(deltaLines: number): void {
    this.scrollOffsetLines = Math.max(
      0,
      Math.min(this.lastMaxScrollOffset, this.scrollOffsetLines + deltaLines)
    );
  }

  private launchCartridgeInstant(programId: CartridgeProgramId): void {
    this.stopTerminalSequencesAudio();
    this.destructActive = false;
    this.destructConfirmArmed = false;
    this.shipOpsOpen = false;
    this.host.quickSwitchProgram(programId);
  }

  private handleTabAutocomplete(): void {
    const raw = this.inputBuffer.toUpperCase();
    if (!raw) {
      this.inputBuffer = 'HELP';
      this.host.audio.playSfx('ui_keyclick', { pitch: 1.08 });
      return;
    }
    const matches = AUTOCOMPLETE_COMMANDS.filter((c) => c.startsWith(raw));
    if (matches.length > 0) {
      const exactIdx = matches.indexOf(raw);
      const next =
        exactIdx >= 0 && matches.length > 1
          ? matches[(exactIdx + 1) % matches.length]
          : matches[0];
      this.inputBuffer = next;
      this.host.audio.playSfx('ui_keyclick', { pitch: 1.12 });
    } else {
      this.host.audio.playMutedAvionicsIndicatorBeep(false);
    }
  }

  private bindListeners(signal: AbortSignal): void {
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.destructWhiteoutTimer > 0) return;
        const dir = e.deltaY < 0 ? 3 : -3;
        if (this.lastMaxScrollOffset > 0) {
          e.preventDefault();
          this.adjustScroll(dir);
        }
      },
      { signal, passive: false }
    );

    window.addEventListener(
      'keydown',
      (e) => {
        const mobileInput = document.getElementById('mobile-callsign-input');
        if (mobileInput && e.target === mobileInput) {
          return;
        }
        if (this.destructWhiteoutTimer > 0) {
          return;
        }
        void this.host.audio.unlock();

        // Instant reveal if typewriter still catching up
        if (this.revealedCharCount < this.totalLineChars) {
          this.revealedCharCount = this.totalLineChars;
        }

        // CLI Scrollback keys (PgUp / PgDn / Shift+Arrows)
        if (e.code === 'PageUp') {
          e.preventDefault();
          this.adjustScroll(6);
          return;
        }
        if (e.code === 'PageDown') {
          e.preventDefault();
          this.adjustScroll(-6);
          return;
        }
        if (e.shiftKey && e.code === 'ArrowUp') {
          e.preventDefault();
          this.adjustScroll(2);
          return;
        }
        if (e.shiftKey && e.code === 'ArrowDown') {
          e.preventDefault();
          this.adjustScroll(-2);
          return;
        }

        // Instant [1-4] cartridge launch when CLI input buffer is empty!
        if (
          !this.destructActive &&
          this.inputBuffer.length === 0 &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        ) {
          const directBay = CARTRIDGE_BAYS.find((b) => b.keyNum === e.key);
          if (directBay) {
            e.preventDefault();
            this.launchCartridgeInstant(directBay.programId);
            return;
          }
        }

        if (e.code === 'Tab') {
          e.preventDefault();
          this.handleTabAutocomplete();
          return;
        }

        if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          e.preventDefault();
          this.host.audio.playSfx('keypress_return', { pitch: 0.96, volume: 0.95 });
          this.executeCommand(this.inputBuffer);
          return;
        }

        if (e.code === 'Backspace') {
          e.preventDefault();
          this.scrollOffsetLines = 0;
          if (this.inputBuffer.length > 0) {
            this.inputBuffer = this.inputBuffer.slice(0, -1);
            this.host.audio.playSfx('ui_keyclick', { pitch: 0.88, volume: 0.85 });
          } else {
            this.host.audio.playSfx('ui_keyclick', { pitch: 0.72, volume: 0.5 });
          }
          return;
        }

        if (e.code === 'Escape') {
          e.preventDefault();
          this.destructConfirmArmed = false;
          if (this.shipOpsOpen) {
            this.shipOpsOpen = false;
            this.host.audio.playSfx('ui_keyclick', { pitch: 0.88 });
          } else if (this.inputBuffer.length > 0) {
            this.inputBuffer = '';
            this.host.audio.playSfx('keypress_return', { pitch: 0.82, volume: 0.75 });
          } else if (this.scrollOffsetLines > 0) {
            this.scrollOffsetLines = 0;
          }
          return;
        }

        if (e.code === 'ArrowUp') {
          e.preventDefault();
          if (this.commandHistory.length > 0) {
            if (this.historyIndex < 0) {
              this.historyIndex = this.commandHistory.length - 1;
            } else {
              this.historyIndex = Math.max(0, this.historyIndex - 1);
            }
            this.inputBuffer = this.commandHistory[this.historyIndex] ?? '';
            this.scrollOffsetLines = 0;
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.04 });
          }
          return;
        }

        if (e.code === 'ArrowDown') {
          e.preventDefault();
          if (this.historyIndex >= 0) {
            this.historyIndex++;
            if (this.historyIndex >= this.commandHistory.length) {
              this.historyIndex = -1;
              this.inputBuffer = '';
            } else {
              this.inputBuffer = this.commandHistory[this.historyIndex] ?? '';
            }
            this.scrollOffsetLines = 0;
            this.host.audio.playSfx('ui_keyclick', { pitch: 0.98 });
          }
          return;
        }

        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (e.code === 'Space') {
            e.preventDefault();
          }
          this.scrollOffsetLines = 0;
          if (this.inputBuffer.length < 48) {
            this.inputBuffer += e.key.toUpperCase();
            this.host.audio.playSfx('ui_keyclick', {
              pitch: 0.94 + Math.random() * 0.14,
              volume: 0.88,
            });
          }
        }
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
          this.hoveredHitId = null;
          document.body.style.cursor = 'default';
          return;
        }
        const cx = mapped.u * this.crtRect.width;
        const cy = mapped.v * this.crtRect.height;
        const hit = this.findHitBox(cx, cy);
        this.hoveredHitId = hit?.id ?? null;
        document.body.style.cursor = hit ? 'pointer' : 'default';
      },
      { signal }
    );

    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (this.destructWhiteoutTimer > 0) return;

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
        const hit = this.findHitBox(cx, cy);
        if (hit) {
          if (this.revealedCharCount < this.totalLineChars) {
            this.revealedCharCount = this.totalLineChars;
          }
          if (hit.id !== 'shipops-destruct') {
            this.destructConfirmArmed = false;
          }
          hit.action();
          return;
        }

        this.destructConfirmArmed = false;
        if (this.revealedCharCount < this.totalLineChars) {
          this.revealedCharCount = this.totalLineChars;
          this.host.audio.playSfx('ui_keyclick');
        }
      },
      { signal }
    );

    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (mobileInput) {
      mobileInput.addEventListener(
        'input',
        () => {
          const nextVal = mobileInput.value.toUpperCase().slice(0, 48);
          if (nextVal !== this.inputBuffer) {
            this.inputBuffer = nextVal;
            mobileInput.value = nextVal;
            this.scrollOffsetLines = 0;
            this.host.audio.playSfx('ui_keyclick', { volume: 0.85 });
          }
        },
        { signal }
      );
      mobileInput.addEventListener(
        'keydown',
        (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            ev.stopPropagation();
            mobileInput.value = '';
            mobileInput.blur();
            this.host.audio.playSfx('keypress_return', { pitch: 0.96, volume: 0.95 });
            this.executeCommand(this.inputBuffer);
          }
        },
        { signal }
      );
    }
  }

  private findHitBox(cx: number, cy: number): TerminalHitBox | null {
    for (let i = this.hitBoxes.length - 1; i >= 0; i--) {
      const b = this.hitBoxes[i];
      if (
        cx >= b.rect.x &&
        cx <= b.rect.x + b.rect.width &&
        cy >= b.rect.y &&
        cy <= b.rect.y + b.rect.height
      ) {
        return b;
      }
    }
    return null;
  }

  private focusMobileKeyboard(): void {
    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (!mobileInput) return;
    mobileInput.value = this.inputBuffer;
    try {
      mobileInput.focus({ preventScroll: true });
    } catch {
      mobileInput.focus();
    }
  }

  // ===========================================================================
  // INTERACTIVE MOVIE-INSPIRED WEB AUDIO SEQUENCES (SIGNAL / DESTRUCT / ABORT)
  // ===========================================================================
  private playSignalBeaconAudio(): void {
    const ctx = this.host.audio.getAudioContext();
    const dest = this.host.audio.getMasterOutputNode();
    if (!ctx || !dest) return;
    const now = ctx.currentTime;

    const carrier = ctx.createOscillator();
    carrier.type = 'sawtooth';
    carrier.frequency.setValueAtTime(118, now);
    carrier.frequency.linearRampToValueAtTime(92, now + 1.5);
    carrier.frequency.linearRampToValueAtTime(126, now + 3.0);

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(4.8, now);
    mod.frequency.linearRampToValueAtTime(8.2, now + 3.0);

    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(34, now);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(420, now);
    bp.Q.setValueAtTime(4.5, now);

    const outGain = ctx.createGain();
    outGain.gain.setValueAtTime(0.001, now);
    outGain.gain.linearRampToValueAtTime(0.22, now + 0.25);
    outGain.gain.setValueAtTime(0.2, now + 2.55);
    outGain.gain.exponentialRampToValueAtTime(0.001, now + 3.05);

    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(bp);
    bp.connect(outGain);
    outGain.connect(dest);

    this.terminalAudioSources.add(carrier);
    this.terminalAudioSources.add(mod);
    this.terminalAudioNodes.add(modGain);
    this.terminalAudioNodes.add(bp);
    this.terminalAudioNodes.add(outGain);

    carrier.start(now);
    mod.start(now);
    carrier.stop(now + 3.1);
    mod.stop(now + 3.1);
  }

  private startSelfDestructAudio(): void {
    this.stopTerminalSequencesAudio();
    const ctx = this.host.audio.getAudioContext();
    const dest = this.host.audio.getMasterOutputNode();
    if (!ctx || !dest) return;
    const now = ctx.currentTime;

    const whine = ctx.createOscillator();
    whine.type = 'sawtooth';
    whine.frequency.setValueAtTime(74, now);
    whine.frequency.exponentialRampToValueAtTime(520, now + 10.2);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(340, now);
    lp.frequency.exponentialRampToValueAtTime(2400, now + 10.2);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.11, now + 0.5);
    g.gain.linearRampToValueAtTime(0.26, now + 10.0);

    whine.connect(lp);
    lp.connect(g);
    g.connect(dest);

    this.terminalAudioSources.add(whine);
    this.terminalAudioNodes.add(lp);
    this.terminalAudioNodes.add(g);
    whine.start(now);
  }

  private playDestructKlaxonPulse(urgent: boolean): void {
    const ctx = this.host.audio.getAudioContext();
    const dest = this.host.audio.getMasterOutputNode();
    if (!ctx || !dest) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(urgent ? 640 : 490, now);
    osc.frequency.linearRampToValueAtTime(urgent ? 440 : 360, now + 0.34);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(urgent ? 950 : 720, now);
    bp.Q.setValueAtTime(2.2, now);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(urgent ? 0.28 : 0.21, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(bp);
    bp.connect(g);
    g.connect(dest);

    this.terminalAudioSources.add(osc);
    this.terminalAudioNodes.add(bp);
    this.terminalAudioNodes.add(g);
    osc.start(now);
    osc.stop(now + 0.42);
  }

  private playSteamVentAbortAudio(): void {
    const ctx = this.host.audio.getAudioContext();
    const dest = this.host.audio.getMasterOutputNode();
    if (!ctx || !dest) return;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 1.4);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.7;
    }
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1900, now);
    bp.frequency.exponentialRampToValueAtTime(520, now + 1.3);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.28, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.35);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest);
    this.terminalAudioSources.add(src);
    this.terminalAudioNodes.add(bp);
    this.terminalAudioNodes.add(g);
    src.start(now);
    src.stop(now + 1.38);
  }

  // ===========================================================================
  // COMMAND PARSER (ALL 4 PROGRAMS + MOVIE MAINFRAME DIRECTIVES)
  // ===========================================================================
  private executeCommand(raw: string): void {
    const trimmed = raw.trim().toUpperCase().replace(/\s+/g, ' ');
    this.inputBuffer = '';
    this.historyIndex = -1;
    this.scrollOffsetLines = 0;

    if (!trimmed) {
      this.appendLines([{ text: 'MU-TH-UR>', tone: 'secondary' }], false);
      return;
    }

    if (this.commandHistory[this.commandHistory.length - 1] !== trimmed) {
      this.commandHistory.push(trimmed);
      if (this.commandHistory.length > 32) {
        this.commandHistory.shift();
      }
    }

    const echoLine: TerminalLine = { text: `MU-TH-UR> ${trimmed}`, tone: 'bright' };

    // Handle ABORT during active Self-Destruct sequence FIRST!
    if (this.destructActive && (trimmed === 'ABORT' || trimmed === 'CANCEL' || trimmed === 'STOP')) {
      this.destructActive = false;
      this.destructConfirmArmed = false;
      this.stopTerminalSequencesAudio();
      this.playSteamVentAbortAudio();
      this.glitchPulse = 0.45;
      this.appendLines(
        [
          echoLine,
          { text: '>>> EMERGENCY DESTRUCT ABORTED // COOLING UNITS VENTING <<<', tone: 'bright' },
          { text: 'REACTOR STABILIZED. MU-TH-UR 6000 RETURNING TO STANDBY.', tone: 'green' },
        ],
        true
      );
      return;
    }

    // 1. Direct Program Launches (instant relay switch!)
    if (
      trimmed === '1' ||
      trimmed === '01' ||
      trimmed === 'RUN 1' ||
      trimmed === 'RUN 01' ||
      trimmed === 'LOAD 1' ||
      trimmed === 'LOAD 01' ||
      trimmed === 'LANDER' ||
      trimmed === 'LUNAR LANDER'
    ) {
      this.launchCartridgeInstant('lander');
      return;
    }

    if (
      trimmed === '2' ||
      trimmed === '02' ||
      trimmed === 'RUN 2' ||
      trimmed === 'RUN 02' ||
      trimmed === 'LOAD 2' ||
      trimmed === 'LOAD 02' ||
      trimmed === 'PERIMETER' ||
      trimmed === 'DEFENSE' ||
      trimmed === 'TD' ||
      trimmed === 'HADLEY' ||
      trimmed === "HADLEY'S PERIMETER" ||
      trimmed === 'HADLEYS PERIMETER'
    ) {
      this.launchCartridgeInstant('perimeter');
      return;
    }

    if (
      trimmed === '3' ||
      trimmed === '03' ||
      trimmed === 'RUN 3' ||
      trimmed === 'RUN 03' ||
      trimmed === 'LOAD 3' ||
      trimmed === 'LOAD 03' ||
      trimmed === 'FLAK' ||
      trimmed === 'FLAK NET' ||
      trimmed === 'INTERCEPT' ||
      trimmed === 'ORBITAL' ||
      trimmed === 'ORBITAL INTERCEPT'
    ) {
      this.launchCartridgeInstant('flak');
      return;
    }

    if (
      trimmed === '4' ||
      trimmed === '04' ||
      trimmed === 'RUN 4' ||
      trimmed === 'RUN 04' ||
      trimmed === 'LOAD 4' ||
      trimmed === 'LOAD 04' ||
      trimmed === 'TRENCH' ||
      trimmed === 'VECTOR' ||
      trimmed === 'VECTOR RUN' ||
      trimmed === 'DERELICT TRENCH'
    ) {
      this.launchCartridgeInstant('trench');
      return;
    }

    if (
      trimmed === '5' ||
      trimmed === '05' ||
      trimmed === 'RUN 5' ||
      trimmed === 'RUN 05' ||
      trimmed === 'LOAD 5' ||
      trimmed === 'LOAD 05' ||
      trimmed === 'APPROACH' ||
      trimmed === 'BOREALIS' ||
      trimmed === 'BOREALIS APPROACH' ||
      trimmed === 'RAPCON' ||
      trimmed === 'ATC'
    ) {
      this.launchCartridgeInstant('approach');
      return;
    }

    // 5. Clear / CLS
    if (trimmed === 'CLS' || trimmed === 'CLEAR') {
      this.glitchPulse = 0.22;
      this.resetLinesToPrompt(false);
      return;
    }

    // 6. Categorized HELP / ?
    if (trimmed === 'HELP' || trimmed === '?') {
      this.host.audio.playAlienComputerActivity(0.35);
      this.appendLines(
        [
          echoLine,
          {
            text: 'PROGRAMS    : [1] LANDER | [2] PERIMETER | [3] FLAK | [4] TRENCH | [5] APPROACH',
            tone: 'bright',
          },
          { text: 'TELEMETRY   : LEADERBOARD | DIAG | DIR | CLS | WHEEL / PGUP / PGDN SCROLL', tone: 'green' },
          { text: 'SHIP OPS    : CREW | BIOSCAN | SIGNAL | QUERY <TEXT> | ORDER 937 | DESTRUCT', tone: 'amber' },
          { text: 'MONITOR     : CRT <ON|OFF> | PHOSPHOR <GREEN|AMBER|CYAN> | MUTE', tone: 'cyan' },
        ],
        true
      );
      return;
    }

    // 7. QUERY <text> / ASK <text>
    if (trimmed.startsWith('QUERY') || trimmed.startsWith('ASK')) {
      const q = trimmed.replace(/^(QUERY|ASK)\s*/, '').trim();
      this.host.audio.playAlienComputerActivity(0.45);
      if (!q) {
        this.appendLines(
          [
            echoLine,
            { text: 'SYNTAX: QUERY <SUBJECT> (E.G. ALIEN, CHANCES, KILL, COURSE, JONES)', tone: 'amber' },
          ],
          true
        );
        return;
      }

      let reply = 'DOES NOT COMPUTE // CLARIFY INQUIRY.';
      let tone: TerminalLine['tone'] = 'amber';
      if (/\b(ALIEN|ORGANISM|SPECIMEN|XENO|CREATURE)\b/.test(q)) {
        reply = 'SPECIAL ORDER 937 IN EFFECT. SCIENCE OFFICER EYES ONLY.';
        tone = 'red';
        this.glitchPulse = 0.45;
      } else if (/\b(CHANCES|SURVIVAL|SURVIVE|ODDS|LIVE)\b/.test(q)) {
        reply = 'PROBABILITY OF CREW SURVIVAL: 0.04%. INSUFFICIENT DATA FOR OPTIMISM.';
        tone = 'amber';
      } else if (/\b(KILL|STOP|HOW|DESTROY|DEFEAT)\b/.test(q)) {
        reply =
          'UNABLE TO CLARIFY. RECOMMEND QUARANTINE PROTOCOL — OVERRIDDEN BY SCIENCE OFFICER ASH.';
        tone = 'amber';
      } else if (/\b(COLLISION|COURSE|HEADING|WHERE|LV-426|DESTINATION)\b/.test(q)) {
        reply = 'USCSS NOSTROMO REROUTED TO ZETA II RETICULI // LV-426 PER COMPANY DIRECTIVE.';
        tone = 'green';
      } else if (/\b(ASH|SCIENCE OFFICER)\b/.test(q)) {
        reply = 'HYPERDYNE SYSTEMS 120-A/2 SYNTHETIC UNIT — ACCESS RESTRICTED BY COMPANY.';
        tone = 'red';
      } else if (/\b(JONES|JONESY|CAT)\b/.test(q)) {
        reply = 'BIOLOGICAL ASSET JONESY [FELINE]: VITALS NOMINAL. LOCATED ON C-DECK.';
        tone = 'bright';
      }

      this.appendLines([echoLine, { text: `MU-TH-UR: "${reply}"`, tone }], true);
      return;
    }

    // 8. CREW / MANIFEST
    if (trimmed === 'CREW' || trimmed === 'MANIFEST') {
      this.host.audio.playAlienComputerActivity(0.42);
      this.appendLines(
        [
          echoLine,
          { text: 'USCSS NOSTROMO // CREW MANIFEST [REG: 180924609]', tone: 'amber' },
          { text: '  CAPT. A.J. DALLAS      [COMMAND]     STATUS: ACTIVE', tone: 'green' },
          { text: '  W.O.  E.L. RIPLEY      [WARRANT OFF] STATUS: ACTIVE', tone: 'green' },
          { text: '  EXEC. G.W. KANE        [EXEC OFF]    STATUS: MEDBAY QUARANTINE', tone: 'amber' },
          { text: '  SCI.  ASH              [SCIENCE OFF] [SYNTHETIC — CLASSIFIED]', tone: 'red' },
          { text: '  NAV.  J.M. LAMBERT     [NAVIGATOR]   STATUS: ACTIVE', tone: 'green' },
          { text: '  ENG.  D.J. PARKER      [CHIEF ENG]   STATUS: C-DECK ENGINE ROOM', tone: 'green' },
          { text: '  TECH. S.E. BRETT       [ENG TECH]    STATUS: C-DECK ENGINE ROOM', tone: 'green' },
          { text: '  ASSET JONESY           [FELINE]      STATUS: ACTIVE // NOMINAL', tone: 'bright' },
        ],
        true
      );
      return;
    }

    // 9. BIOSCAN / MEDBAY
    if (trimmed === 'BIOSCAN' || trimmed === 'MEDBAY') {
      this.bioscanActive = true;
      this.bioscanElapsed = 0;
      this.signalActive = false;
      this.glitchPulse = 0.35;
      this.host.audio.playAlienComputerActivity(0.55);
      this.appendLines(
        [
          echoLine,
          { text: 'INITIATING MEDBAY AUTO-DOC THORACIC BIOSCAN [SUBJECT: KANE]...', tone: 'bright' },
        ],
        false
      );
      return;
    }

    // 10. SIGNAL / DECODE / BEACON
    if (trimmed === 'SIGNAL' || trimmed === 'DECODE' || trimmed === 'BEACON') {
      this.signalActive = true;
      this.signalElapsed = 0;
      this.bioscanActive = false;
      this.glitchPulse = 0.42;
      this.playSignalBeaconAudio();
      this.appendLines(
        [
          echoLine,
          { text: 'LOCKING ACOUSTIC BEACON FROM LV-426 // RUNNING FOURIER DECODE...', tone: 'amber' },
        ],
        false
      );
      return;
    }

    // 11. DESTRUCT / SELF-DESTRUCT
    if (trimmed === 'DESTRUCT' || trimmed === 'SELF-DESTRUCT' || trimmed === 'SELFDESTRUCT') {
      if (this.destructActive) {
        this.appendLines(
          [echoLine, { text: "DESTRUCT ALREADY ARMED — TYPE 'ABORT' TO CANCEL!", tone: 'red' }],
          false
        );
        return;
      }
      this.destructActive = true;
      this.destructConfirmArmed = false;
      this.shipOpsOpen = false;
      this.destructRemaining = 10.0;
      this.destructLastAnnouncedSec = 11;
      this.destructKlaxonPulseTimer = 0;
      this.bioscanActive = false;
      this.signalActive = false;
      this.glitchPulse = 0.72;
      this.host.triggerSyncGlitch(0.65);
      this.startSelfDestructAudio();
      this.appendLines(
        [
          echoLine,
          {
            text: ">>> EMERGENCY DESTRUCT SYSTEM ARMED — TYPE 'ABORT' TO CANCEL <<<",
            tone: 'red',
          },
        ],
        false
      );
      return;
    }

    // 12a. CRT <ON | OFF | 1979 | CRISP>
    if (trimmed.startsWith('CRT')) {
      const arg = trimmed.replace(/^CRT\s*/, '').trim();
      const order: CrtPreset[] = ['CLASSIC_1979', 'CRISP'];
      let next: CrtPreset | null = null;
      if (!arg) {
        next = order[(order.indexOf(this.host.getCrtPreset()) + 1) % order.length];
      } else if (arg === 'OFF' || arg === 'CRISP' || arg === 'FLAT' || arg === 'CLEAN' || arg === 'MODERN') {
        next = 'CRISP';
      } else if (arg === 'ON' || arg === '1979' || arg === 'CLASSIC' || arg === 'CLASSIC_1979') {
        next = 'CLASSIC_1979';
      }
      if (!next) {
        this.appendLines(
          [echoLine, { text: 'SYNTAX: CRT <ON | OFF>', tone: 'amber' }],
          true
        );
        return;
      }
      this.host.setCrtPreset(next);
      this.appendLines(
        [echoLine, { text: `1979 CRT DISPLAY MODE -> ${CRT_PRESET_CONFIG[next].label}`, tone: 'bright' }],
        true
      );
      return;
    }

    // 12b. PHOSPHOR <GREEN | AMBER | CYAN>
    if (trimmed.startsWith('PHOSPHOR') || trimmed.startsWith('THEME')) {
      const arg = trimmed.replace(/^(PHOSPHOR|THEME)\s*/, '').trim();
      const cycleOrder: PhosphorTheme[] = ['GREEN', 'AMBER', 'CYAN'];
      let nextTheme: PhosphorTheme | null = null;
      if (!arg) {
        const cur = this.host.getPhosphorTheme();
        nextTheme = cycleOrder[(cycleOrder.indexOf(cur) + 1) % cycleOrder.length];
      } else if (arg === 'GREEN' || arg === 'P39') {
        nextTheme = 'GREEN';
      } else if (arg === 'AMBER' || arg === 'P3' || arg === 'ORANGE') {
        nextTheme = 'AMBER';
      } else if (arg === 'CYAN' || arg === 'MEDBAY' || arg === 'BLUE') {
        nextTheme = 'CYAN';
      }

      if (!nextTheme) {
        this.appendLines(
          [echoLine, { text: 'SYNTAX: PHOSPHOR <GREEN | AMBER | CYAN>', tone: 'amber' }],
          true
        );
        return;
      }
      this.host.setPhosphorTheme(nextTheme);
      this.glitchPulse = 0.32;
      this.host.audio.playButtonLatchLock(1.04, 0.85);
      const label =
        nextTheme === 'GREEN'
          ? 'P39 PHOSPHOR GREEN (NOSTROMO STANDARD)'
          : nextTheme === 'AMBER'
            ? 'P3 VINTAGE AMBER (TACTICAL TERMINAL)'
            : 'MEDBAY CLINICAL CYAN (AUTO-DOC CRT)';
      this.appendLines(
        [echoLine, { text: `CRT PHOSPHOR MATRIX SHIFTED -> ${label}`, tone: 'bright' }],
        true
      );
      return;
    }

    // 13. SCORES / LEADERBOARD — Vertically stacked (1 entry per line, zero horizontal squishing!)
    if (trimmed === 'SCORES' || trimmed === 'LEADERBOARD' || trimmed === 'HIGHSCORES') {
      this.host.audio.playAlienComputerActivity(0.45);
      const out: TerminalLine[] = [
        echoLine,
        { text: 'ORBITAL RELAY // LEADERBOARD ACROSS ALL 5 PROGRAMS (SCROLL FOR FULL LIST):', tone: 'amber' },
      ];

      for (const bay of CARTRIDGE_BAYS) {
        const list = this.hubLeaders.getTopScores(bay.programId);
        const st = this.hubLeaders.getLeaderState(bay.programId).status;
        out.push({ text: `[${bay.slotCode}] ${bay.title}`, tone: 'bright' });
        if (list.length === 0) {
          out.push({
            text:
              st === 'LOADING'
                ? '  ◌ SYNCING ORBITAL RELAY...'
                : '  ○ NO VERIFIED RECORDS LOGGED YET',
            tone: 'secondary',
          });
        } else {
          list.slice(0, 3).forEach((entry, idx) => {
            const rankStr = `#${String(idx + 1).padStart(2, '0')}`;
            const csStr = entry.callsign.slice(0, 12).padEnd(13);
            out.push({
              text: `  ${rankStr}  ${csStr} ${entry.score.toLocaleString()} PTS`,
              tone: idx === 0 ? 'amber' : 'green',
            });
          });
        }
      }

      this.appendLines(out, true);
      return;
    }

    // 14. DIR / LS
    if (trimmed === 'DIR' || trimmed === 'LS' || trimmed === 'CATALOG') {
      this.host.audio.playAlienComputerActivity(0.38);
      this.appendLines(
        [
          echoLine,
          {
            text: 'VOLUME 180924609 // MAGNETIC TAPE ARCHIVE [64K FREE: 4,096 BYTES]',
            tone: 'amber',
          },
          { text: '  01  LUNAR_LANDER.SIM        28,672 B   [6 SECTORS / ENDLESS]', tone: 'green' },
          { text: '  02  HADLEYS_PERIMETER.SIM   34,816 B   [ENDLESS SIEGE CAD]', tone: 'green' },
          { text: '  03  FLAK_NET.SIM            31,744 B   [ORBITAL INTERCEPT]', tone: 'green' },
          { text: '  04  DERELICT_TRENCH.SIM     36,864 B   [3D VECTOR SORTIE]', tone: 'green' },
          { text: '  05  BOREALIS_APPROACH.SIM   38,912 B   [LV-118 RAPCON ATC]', tone: 'green' },
          { text: '  99  SPECIAL_ORDER_937.ENC    1,024 B   [EYES ONLY // RESTRICTED]', tone: 'amber' },
        ],
        true
      );
      return;
    }

    // 15. DIAG / STATUS (Diegetic Orbital Relay copy — zero backend/Firestore leaks!)
    if (trimmed === 'STATUS' || trimmed === 'DIAG' || trimmed === 'SYSTEM') {
      this.host.audio.playAlienComputerActivity(0.45);
      const audState = this.host.isMuted()
        ? 'MUTED'
        : `ACTIVE (${Math.round(this.host.getMasterVolume() * 100)}%)`;
      const musicState = this.host.isMusicEnabled() ? 'ON (IN-GAME)' : 'OFF';
      const theme = this.host.getPhosphorTheme();
      const preset = CRT_PRESET_CONFIG[this.host.getCrtPreset()].label;
      const uplink = this.hubLeaders.getUplinkSummary();
      const relayTxt =
        uplink.liveCount > 0
          ? `LIVE (${uplink.liveCount}/${uplink.totalCount} CHANNELS · ${uplink.avgPingMs ?? 24}MS)`
          : 'LOCAL TAPE ARCHIVE (OFFLINE)';
      this.appendLines(
        [
          echoLine,
          { text: 'USCSS NOSTROMO // HARDWARE & TELEMETRY DIAGNOSTIC:', tone: 'amber' },
          { text: '  HYPERSLEEP PODS : 7/7 STANDBY  |  COOLING UNITS 1-4: NOMINAL', tone: 'green' },
          { text: `  DISPLAY PROFILE : ${preset}  |  PHOSPHOR: ${theme}`, tone: 'green' },
          { text: `  ACOUSTIC BUS    : ${audState}  |  MUSIC: ${musicState}`, tone: 'green' },
          {
            text: `  ORBITAL RELAY   : ${relayTxt}`,
            tone: uplink.liveCount > 0 ? 'bright' : 'amber',
          },
        ],
        true
      );
      return;
    }

    // 16. Special Order 937
    if (
      trimmed === '937' ||
      trimmed === 'ORDER 937' ||
      trimmed === 'SPECIAL ORDER 937' ||
      trimmed === 'SCIENCE'
    ) {
      this.glitchPulse = 0.58;
      this.host.triggerSyncGlitch(0.55);
      this.host.audio.playScaryComputerTransition('dark', 0, 0.52);
      this.appendLines(
        [
          echoLine,
          { text: '>>> DECRYPTING WEYLAND-YUTANI CLASSIFIED DIRECTIVE [ORDER 937] <<<', tone: 'amber' },
          { text: 'SCIENCE OFFICER EYES ONLY: PRIORITY ONE — INSURE RETURN OF ORGANISM', tone: 'amber' },
          { text: 'FOR ANALYSIS. ALL OTHER CONSIDERATIONS SECONDARY. CREW EXPENDABLE.', tone: 'red' },
        ],
        true
      );
      return;
    }

    if (trimmed === 'MUTE' || trimmed === 'AUDIO') {
      const nextMute = !this.host.isMuted();
      this.host.setMuted(nextMute);
      this.appendLines(
        [echoLine, { text: `ACOUSTIC TELEMETRY BUS: ${nextMute ? 'MUTED' : 'ACTIVE'}.`, tone: 'amber' }],
        true
      );
      return;
    }

    if (trimmed === 'MUSIC' || trimmed === 'MUSIC ON' || trimmed === 'MUSIC OFF') {
      const nextEnabled =
        trimmed === 'MUSIC ON'
          ? true
          : trimmed === 'MUSIC OFF'
            ? false
            : !this.host.isMusicEnabled();
      this.host.setMusicEnabled(nextEnabled);
      this.host.audio.playButtonLatchLock(nextEnabled ? 1.04 : 0.92, 0.8);
      this.appendLines(
        [
          echoLine,
          {
            text: `CARTRIDGE BACKGROUND MUSIC: ${nextEnabled ? 'ON (PLAYS DURING ACTIVE GAMEPLAY)' : 'OFF'}.`,
            tone: 'amber',
          },
        ],
        true
      );
      return;
    }

    // Unrecognized directive
    this.host.audio.playMutedAvionicsIndicatorBeep(false);
    this.appendLines(
      [
        echoLine,
        {
          text: "DOES NOT COMPUTE // PRESS [1-5] FOR CARTRIDGES, TYPE 'HELP', OR PRESS [TAB].",
          tone: 'amber',
        },
      ],
      true
    );
  }

  public updateAndRender(
    dt: number,
    ctx: CanvasRenderingContext2D,
    totalTimeSec: number
  ): CrtShaderFrameParams {
    const clampedDt = Math.min(0.1, Math.max(0, dt));

    if (this.glitchPulse > 0) {
      this.glitchPulse = Math.max(0, this.glitchPulse - clampedDt * 1.8);
    }

    this.ambientTimer -= clampedDt;
    if (this.ambientTimer <= 0 && !this.destructActive) {
      this.ambientTimer = 22 + Math.random() * 14;
      this.host.audio.playAlienComputerActivity(0.2);
    }

    if (this.bioscanActive) {
      this.bioscanElapsed += clampedDt;
      if (this.bioscanElapsed >= this.bioscanDuration) {
        this.bioscanActive = false;
        this.glitchPulse = 0.55;
        this.host.audio.playScaryComputerTransition('dark', 0, 0.45);
        this.appendLines(
          [
            {
              text: 'ALERT: UNKNOWN PARASITIC ORGANISM ATTACHED TO RESPIRATORY TRACT — DO NOT REMOVE',
              tone: 'red',
            },
          ],
          true
        );
      }
    }

    if (this.signalActive) {
      this.signalElapsed += clampedDt;
      if (this.signalElapsed >= this.signalDuration) {
        this.signalActive = false;
        this.glitchPulse = 0.45;
        this.appendLines(
          [
            {
              text: 'ANALYSIS COMPLETE: TRANSMISSION IS NOT AN S.O.S. — IT IS A WARNING.',
              tone: 'amber',
            },
          ],
          true
        );
      }
    }

    if (this.destructWhiteoutTimer > 0) {
      this.destructWhiteoutTimer -= clampedDt;
      ctx.save();
      const p = Math.max(0, this.destructWhiteoutTimer / 1.15);
      ctx.fillStyle = p > 0.35 ? '#FFF8EE' : '#080C09';
      ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);
      for (let i = 0; i < 42; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#FFFFFF' : THEME.ACCENT_AMBER;
        const ry = Math.random() * this.viewportHeight;
        ctx.fillRect(0, ry, this.viewportWidth, 2 + Math.random() * 8);
      }
      ctx.restore();

      if (this.destructWhiteoutTimer <= 0) {
        this.stopTerminalSequencesAudio();
        this.host.coldRebootMuthur();
      }
      return {
        interference: 1.0,
        glitch: 1.0,
        overdrive: 1.0,
        tubeTurnOn: 0.4,
        chromaScale: 0.22,
      };
    }

    if (this.destructActive) {
      this.destructRemaining = Math.max(0, this.destructRemaining - clampedDt);
      const secInt = Math.ceil(this.destructRemaining);
      if (secInt < this.destructLastAnnouncedSec && secInt > 0) {
        this.destructLastAnnouncedSec = secInt;
        this.appendLines(
          [
            {
              text: `EMERGENCY DESTRUCT ARMED — T-MINUS ${String(secInt).padStart(2, '0')}S (TYPE 'ABORT' TO CANCEL)`,
              tone: secInt <= 3 ? 'red' : 'amber',
            },
          ],
          false
        );
      }

      this.destructKlaxonPulseTimer -= clampedDt;
      if (this.destructKlaxonPulseTimer <= 0) {
        this.destructKlaxonPulseTimer = this.destructRemaining <= 3.5 ? 0.55 : 0.95;
        this.playDestructKlaxonPulse(this.destructRemaining <= 3.5);
        this.glitchPulse = Math.max(this.glitchPulse, 0.32);
      }

      if (this.destructRemaining <= 0) {
        this.destructActive = false;
        this.stopTerminalSequencesAudio();
        this.host.audio.playScaryComputerTransition('dark', 0, 0.9);
        this.destructWhiteoutTimer = 1.15;
      }
    }

    // Fast snappy typewriter reveal (~150 chars/sec so Hub feels responsive immediately)
    if (this.revealedCharCount < this.totalLineChars) {
      const prev = this.revealedCharCount;
      this.revealedCharCount = Math.min(
        this.totalLineChars,
        this.revealedCharCount + clampedDt * 165
      );
      if (Math.floor(this.revealedCharCount / 4.0) > Math.floor(prev / 4.0)) {
        this.host.audio.playAsmrScrollClack(0.65);
      }
    }

    this.renderTerminal(ctx, totalTimeSec);

    return {
      interference: this.destructActive ? 0.09 : 0.014,
      glitch: this.glitchPulse,
      overdrive: this.destructActive ? 0.45 : 0,
      tubeTurnOn: 0,
      chromaScale: 0.22,
    };
  }

  private pushChromeActionButton(
    ctx: CanvasRenderingContext2D,
    rect: ViewportRect,
    label: string,
    id: string,
    accent: ChromeButtonAccent,
    action: () => void,
    opts?: { active?: boolean; fontPx?: number; subLabel?: string }
  ): void {
    const tmp: ChromeButtonHitbox[] = [];
    drawChromeButton(
      ctx,
      rect,
      label,
      {
        id,
        accent,
        hovered: this.hoveredHitId === id,
        active: opts?.active,
        fontPx: opts?.fontPx ?? 13,
        subLabel: opts?.subLabel,
      },
      tmp
    );
    this.hitBoxes.push({ id, rect, action });
  }

  private renderTerminal(ctx: CanvasRenderingContext2D, timeSec: number): void {
    const w = this.viewportWidth;
    const h = this.viewportHeight;
    this.hitBoxes = [];

    ctx.save();
    ctx.fillStyle = THEME.BG_VOID;
    ctx.fillRect(0, 0, w, h);

    // Subtle Nostromo cathode background gradient
    const glow = ctx.createRadialGradient(
      w * 0.45,
      h * 0.48,
      24,
      w * 0.5,
      h * 0.5,
      Math.max(w, h) * 0.72
    );
    if (this.destructActive) {
      const alarmPulse = 0.18 + 0.18 * (0.5 + 0.5 * Math.sin(timeSec * 14));
      glow.addColorStop(0, `rgba(180, 28, 12, ${alarmPulse.toFixed(3)})`);
      glow.addColorStop(1, 'rgba(20, 2, 1, 0.78)');
    } else {
      glow.addColorStop(0, 'rgba(26, 86, 44, 0.14)');
      glow.addColorStop(1, 'rgba(0, 0, 0, 0.54)');
    }
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // =========================================================================
    // 1. UNIFIED 46PX TOP HEADER BAR (Non-overlapping even on <780px viewports!)
    // =========================================================================
    const topBarH = 46;
    ctx.fillStyle = 'rgba(4, 11, 7, 0.96)';
    ctx.fillRect(0, 0, w, topBarH);
    ctx.strokeStyle = this.destructActive ? THEME.ALERT_RED_STROKE : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, topBarH - 0.5);
    ctx.lineTo(w, topBarH - 0.5);
    ctx.stroke();

    const isNarrow = w < 860;
    const isUltraNarrow = w < 640;
    const crtPreset = this.host.getCrtPreset();
    const phosphor = this.host.getPhosphorTheme();
    const muted = this.host.isMuted();
    const isFs = this.host.getViewport().isFullscreen;

    const crtOn = crtPreset === 'CLASSIC_1979';
    const phosShort = phosphor === 'GREEN' ? 'GRN' : phosphor === 'AMBER' ? 'AMB' : 'CYN';

    const topPills: Array<{
      id: string;
      label: string;
      accent: ChromeButtonAccent;
      active?: boolean;
      action: () => void;
    }> = [
      {
        id: 'hub-crt-preset',
        label: isUltraNarrow
          ? crtOn
            ? '1979:ON'
            : '1979:OFF'
          : isNarrow
            ? crtOn
              ? '1979 1.5X'
              : '1979: OFF'
            : crtOn
              ? '1979 CRT: ON [1.5X]'
              : '1979 CRT: OFF',
        accent: crtOn ? 'amber' : 'muted',
        active: crtOn,
        action: () => {
          this.host.toggle1979Crt();
        },
      },
      {
        id: 'hub-phosphor-cycle',
        label: isUltraNarrow ? phosShort : isNarrow ? `P:${phosShort}` : `PHOSPHOR: ${phosphor}`,
        accent: phosphor === 'AMBER' ? 'amber' : phosphor === 'CYAN' ? 'cyan' : 'green',
        action: () => {
          const order: PhosphorTheme[] = ['GREEN', 'AMBER', 'CYAN'];
          const next = order[(order.indexOf(phosphor) + 1) % order.length];
          this.host.setPhosphorTheme(next);
          this.host.audio.playButtonLatchLock(1.04, 0.85);
          this.glitchPulse = 0.25;
        },
      },
      {
        id: 'hub-audio-toggle',
        label: muted ? 'MUTED' : isUltraNarrow ? 'AUD' : 'AUDIO: ON',
        accent: muted ? 'red' : 'green',
        action: () => {
          this.host.setMuted(!muted);
          if (muted) this.host.audio.playButtonLatchLock(1.0, 0.8);
        },
      },
      {
        id: 'hub-fullscreen',
        label: isFs ? (isUltraNarrow ? 'WIN' : 'EXIT FS') : isUltraNarrow ? 'FS' : 'FULLSCR',
        accent: 'muted',
        action: () => {
          this.host.audio.playButtonLatchLock(1.0, 0.8);
          this.host.toggleFullscreen();
        },
      },
    ];

    const pillH = 32;
    const pillY = 7;
    const pillGap = isNarrow ? 5 : 8;
    const pillFontPx = isNarrow ? 12 : 13;

    let pillCursorX = w - (isNarrow ? 8 : 14);
    for (let i = topPills.length - 1; i >= 0; i--) {
      const p = topPills[i];
      ctx.font = pillFontPx >= 13 ? font('button', pillFontPx) : font('micro', 12);
      const pw = Math.max(isUltraNarrow ? 54 : 80, Math.ceil(ctx.measureText(p.label).width) + 26);
      pillCursorX -= pw;
      this.pushChromeActionButton(
        ctx,
        { x: pillCursorX, y: pillY, width: pw, height: pillH },
        p.label,
        p.id,
        p.accent,
        p.action,
        { fontPx: pillFontPx, active: p.active }
      );
      pillCursorX -= pillGap;
    }

    const leftMaxW = Math.max(80, pillCursorX - 14);
    ctx.font = font('head', isNarrow ? 14 : 17);
    ctx.fillStyle = this.destructActive ? THEME.ALERT_RED_TEXT : THEME.TEXT_PRIMARY;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const headerTitle = this.destructActive
      ? `⚠ EMERGENCY DESTRUCT // T-${this.destructRemaining.toFixed(1)}S ⚠`
      : isNarrow
        ? 'MU-TH-UR 6000'
        : 'INTERFACE 2037 // MU-TH-UR 6000 OS HUB';
    drawEllipsizedText(ctx, headerTitle, isNarrow ? 10 : 14, topBarH * 0.5 + 0.5, leftMaxW);

    // =========================================================================
    // 2. CLEAN 2-ZONE LAYOUT (Desktop: Left CLI + Right 4 Cartridge Bays)
    // =========================================================================
    const pad = isNarrow ? 10 : 14;
    const bodyTop = topBarH + pad;
    const bodyH = Math.max(220, h - bodyTop - pad);
    const bodyW = w - pad * 2;

    if (!isNarrow) {
      const gap = 14;
      const bayPanelW = Math.max(340, Math.min(460, Math.round(bodyW * 0.42)));
      const cliPanelW = bodyW - bayPanelW - gap;

      this.renderCliZone(ctx, pad, bodyTop, cliPanelW, bodyH, timeSec);
      this.renderCartridgeBayZone(ctx, pad + cliPanelW + gap, bodyTop, bayPanelW, bodyH, timeSec, false);
    } else {
      // Compact vertical 2-zone stack for narrow / mobile screens (Top: 5 Cartridge Bays, Bottom: CLI)
      const bayH = Math.min(256, Math.max(198, Math.round(bodyH * 0.45)));
      const cliY = bodyTop + bayH + 10;
      const cliH = Math.max(160, bodyTop + bodyH - cliY);

      this.renderCartridgeBayZone(ctx, pad, bodyTop, bodyW, bayH, timeSec, true);
      this.renderCliZone(ctx, pad, cliY, bodyW, cliH, timeSec);
    }

    // Pulsing warning frame border during active Self-Destruct
    if (this.destructActive) {
      ctx.strokeStyle = Math.sin(timeSec * 16) > 0 ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
      ctx.lineWidth = 3.0;
      ctx.strokeRect(2, topBarH + 2, w - 4, h - topBarH - 4);
    }

    ctx.restore();
  }

  private renderCliZone(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    timeSec: number
  ): void {
    const chipBarH = 38;
    const shipOpsSubH = this.shipOpsOpen && !this.destructActive ? 38 : 0;
    const trayReserve = chipBarH + (shipOpsSubH > 0 ? shipOpsSubH + 6 : 0) + 10;
    const consoleH = Math.max(120, h - trayReserve);

    ctx.save();
    ctx.fillStyle = THEME.BG_PANEL;
    ctx.fillRect(x, y, w, consoleH);
    ctx.strokeStyle = this.destructActive ? THEME.ALERT_RED_STROKE : THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, consoleH - 1);
    drawCornerBrackets(
      ctx,
      x,
      y,
      w,
      consoleH,
      16,
      this.destructActive ? THEME.ALERT_RED_STROKE : THEME.TEXT_PRIMARY,
      2.2
    );

    // Console Header Bar
    const hdrH = 30;
    ctx.fillStyle = 'rgba(10, 26, 16, 0.78)';
    ctx.fillRect(x + 2, y + 2, w - 4, hdrH - 2);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + hdrH);
    ctx.lineTo(x + w - 8, y + hdrH);
    ctx.stroke();

    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('MU-TH-UR // COMMAND INTERPRETER', x + 12, y + hdrH * 0.5 + 0.5);

    if (this.scrollOffsetLines > 0) {
      ctx.textAlign = 'right';
      ctx.fillStyle = THEME.ACCENT_CYAN;
      ctx.fillText(`↑ SCROLLBACK (+${this.scrollOffsetLines})`, x + w - 12, y + hdrH * 0.5 + 0.5);
    } else {
      ctx.textAlign = 'right';
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      ctx.fillText('WHEEL / PGUP SCROLL', x + w - 12, y + hdrH * 0.5 + 0.5);
    }

    // Prompt input bar pinned cleanly at bottom of CLI pane (taller chunky terminal in 1979 Mode)
    const is1979 = isCrt1979Typography();
    const promptH = is1979 ? 40 : 34;
    const promptBoxY = y + consoleH - promptH - 6;
    const animOverlayH = this.bioscanActive || this.signalActive ? 124 : 0;
    const logTop = y + hdrH + 8;
    const logBottom = promptBoxY - 6 - animOverlayH;
    const logAvailH = Math.max(40, logBottom - logTop);

    // Build wrapped display lines from revealed text (chunky large 1979 mainframe terminal font when ON)
    const fontPx = is1979 ? (w < 520 ? 13 : 15) : w < 520 ? 12 : 13;
    const lineStep = is1979 ? Math.round((fontPx * 1.15 + 0.6) * 1.48) : Math.round(fontPx * 1.54);
    const textLeft = x + 12;
    const scrollBarReserve = 14;
    const textMaxW = Math.max(120, w - 24 - scrollBarReserve);

    ctx.font = font('data', fontPx);
    const wrappedRows: Array<{ text: string; tone: TerminalLine['tone'] }> = [];
    let remChars = Math.floor(this.revealedCharCount);

    for (let i = 0; i < this.lines.length; i++) {
      if (remChars <= 0) break;
      const line = this.lines[i];
      const cost = Math.max(1, line.text.length);
      const shown = line.text.slice(0, remChars);
      remChars -= cost;

      if (shown.length === 0) {
        wrappedRows.push({ text: '', tone: line.tone });
      } else {
        const subLines = wrapTextLines(ctx, shown, textMaxW);
        for (const sl of subLines) {
          wrappedRows.push({ text: sl, tone: line.tone });
        }
      }
    }

    const visibleCapacity = Math.max(1, Math.floor(logAvailH / lineStep));
    const maxScroll = Math.max(0, wrappedRows.length - visibleCapacity);
    this.lastMaxScrollOffset = maxScroll;
    if (this.scrollOffsetLines > maxScroll) {
      this.scrollOffsetLines = maxScroll;
    }

    const endIdx = Math.max(0, wrappedRows.length - this.scrollOffsetLines);
    const startIdx = Math.max(0, endIdx - visibleCapacity);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let curY = logTop + Math.round(lineStep * 0.5);
    for (let i = startIdx; i < endIdx; i++) {
      const row = wrappedRows[i];
      ctx.fillStyle =
        row.tone === 'amber'
          ? THEME.ACCENT_AMBER_HI
          : row.tone === 'bright'
            ? THEME.TEXT_BRIGHT
            : row.tone === 'red'
              ? THEME.ALERT_RED_TEXT
              : row.tone === 'cyan'
                ? THEME.ACCENT_CYAN
                : row.tone === 'secondary'
                  ? THEME.TEXT_SECONDARY
                  : THEME.TEXT_PRIMARY;
      ctx.fillText(row.text, textLeft, curY);
      curY += lineStep;
    }

    // Visual scrollback thumb rail on right edge of CLI log area
    if (maxScroll > 0) {
      const trackX = x + w - 10;
      const trackY = logTop;
      const trackH = logAvailH;
      ctx.fillStyle = 'rgba(28, 92, 49, 0.35)';
      ctx.fillRect(trackX, trackY, 4, trackH);

      const thumbFrac = Math.max(0.14, visibleCapacity / Math.max(1, wrappedRows.length));
      const thumbH = Math.max(18, Math.round(trackH * thumbFrac));
      const scrollFrac = 1 - this.scrollOffsetLines / Math.max(1, maxScroll);
      const thumbY = trackY + Math.round((trackH - thumbH) * scrollFrac);
      ctx.fillStyle = THEME.TEXT_PRIMARY;
      ctx.fillRect(trackX, thumbY, 4, thumbH);
    }

    // Live Animated Movie Sequence Panes (BIOSCAN or SIGNAL)
    if (this.bioscanActive) {
      this.renderBioscanOverlay(ctx, x + 10, logBottom + 4, w - 20, 114, timeSec);
    } else if (this.signalActive) {
      this.renderSignalDecodeOverlay(ctx, x + 10, logBottom + 4, w - 20, 114, timeSec);
    }

    // Interactive Prompt Input Line (`MU-TH-UR> █`)
    const promptRect: ViewportRect = { x: x + 8, y: promptBoxY, width: w - 16, height: promptH };
    ctx.fillStyle = 'rgba(2, 8, 5, 0.96)';
    ctx.fillRect(promptRect.x, promptRect.y, promptRect.width, promptRect.height);
    ctx.strokeStyle = this.destructActive ? THEME.ALERT_RED_STROKE : THEME.TEXT_PRIMARY;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      promptRect.x + 0.5,
      promptRect.y + 0.5,
      promptRect.width - 1,
      promptRect.height - 1
    );

    const promptPrefix = this.destructActive ? 'ABORT?> ' : 'MU-TH-UR> ';
    ctx.font = font('data', 14);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const py = promptRect.y + promptRect.height * 0.5 + 0.5;
    ctx.fillStyle = this.destructActive ? THEME.ALERT_RED_TEXT : THEME.TEXT_PRIMARY;
    ctx.fillText(promptPrefix, promptRect.x + 10, py);

    const prefixW = ctx.measureText(promptPrefix).width;
    const availInputW = Math.max(40, promptRect.width - prefixW - 30);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    const drawnInputW = drawEllipsizedText(
      ctx,
      this.inputBuffer,
      promptRect.x + 10 + prefixW,
      py,
      availInputW
    );

    if (Math.sin(timeSec * 9.5) > -0.15) {
      ctx.fillStyle = this.destructActive ? THEME.ALERT_RED_TEXT : THEME.TEXT_PRIMARY;
      const curH = is1979 ? 22 : 18;
      const curW = is1979 ? 11 : 9;
      ctx.fillRect(
        promptRect.x + 12 + prefixW + drawnInputW,
        promptRect.y + Math.round((promptRect.height - curH) * 0.5),
        curW,
        curH
      );
    }

    this.hitBoxes.push({
      id: 'prompt-input-line',
      rect: promptRect,
      action: () => this.focusMobileKeyboard(),
    });

    ctx.restore();

    // Optional Guarded [SHIP OPS] Submenu Tray (CREW | BIOSCAN | SIGNAL | GUARDED DESTRUCT)
    let trayY = y + consoleH + 8;
    if (this.shipOpsOpen && !this.destructActive) {
      const subGap = 6;
      const subItems: Array<{
        id: string;
        label: string;
        accent: ChromeButtonAccent;
        action: () => void;
      }> = [
        {
          id: 'shipops-crew',
          label: '[CREW]',
          accent: 'green',
          action: () => {
            this.host.audio.playButtonLatchLock(1.0, 0.85);
            this.executeCommand('CREW');
          },
        },
        {
          id: 'shipops-bioscan',
          label: '[BIOSCAN]',
          accent: 'cyan',
          action: () => {
            this.host.audio.playButtonLatchLock(1.0, 0.85);
            this.executeCommand('BIOSCAN');
          },
        },
        {
          id: 'shipops-signal',
          label: '[SIGNAL]',
          accent: 'amber',
          action: () => {
            this.host.audio.playButtonLatchLock(1.0, 0.85);
            this.executeCommand('SIGNAL');
          },
        },
        {
          id: 'shipops-destruct',
          label: this.destructConfirmArmed ? 'CONFIRM DESTRUCT?' : 'ARM DESTRUCT',
          accent: 'red',
          action: () => {
            if (!this.destructConfirmArmed) {
              this.destructConfirmArmed = true;
              this.host.audio.playMutedAvionicsIndicatorBeep(true);
              this.appendLines(
                [
                  {
                    text: 'SAFETY INTERLOCK: CLICK [CONFIRM DESTRUCT?] AGAIN TO ARM SELF-DESTRUCT.',
                    tone: 'red',
                  },
                ],
                false
              );
            } else {
              this.destructConfirmArmed = false;
              this.executeCommand('DESTRUCT');
            }
          },
        },
      ];
      const sw = Math.floor((w - subGap * (subItems.length - 1)) / subItems.length);
      subItems.forEach((item, idx) => {
        const bw = idx === subItems.length - 1 ? w - (sw + subGap) * idx : sw;
        this.pushChromeActionButton(
          ctx,
          { x: x + idx * (sw + subGap), y: trayY, width: bw, height: shipOpsSubH },
          item.label,
          item.id,
          item.accent,
          item.action,
          { active: item.id === 'shipops-destruct' && this.destructConfirmArmed, fontPx: 12 }
        );
      });
      trayY += shipOpsSubH + 6;
    }

    // Clean 4-Chip Utility Bar: [HELP] | [SCORES] | [DIAG] | [SHIP OPS]
    if (this.destructActive) {
      this.pushChromeActionButton(
        ctx,
        { x, y: trayY, width: w, height: chipBarH },
        '⚠ ABORT SELF-DESTRUCT SEQUENCE ⚠',
        'chip-abort',
        'red',
        () => this.executeCommand('ABORT'),
        { active: true, fontPx: 14 }
      );
    } else {
      const chips: Array<{
        id: string;
        label: string;
        accent: ChromeButtonAccent;
        active?: boolean;
        action: () => void;
      }> = [
        {
          id: 'chip-help',
          label: '[HELP]',
          accent: 'green',
          action: () => {
            this.host.audio.playButtonLatchLock(1.0, 0.8);
            this.executeCommand('HELP');
          },
        },
        {
          id: 'chip-scores',
          label: '[LEADERBOARD]',
          accent: 'amber',
          action: () => {
            this.host.audio.playButtonLatchLock(1.0, 0.8);
            this.executeCommand('SCORES');
          },
        },
        {
          id: 'chip-diag',
          label: '[DIAG]',
          accent: 'cyan',
          action: () => {
            this.host.audio.playButtonLatchLock(1.0, 0.8);
            this.executeCommand('DIAG');
          },
        },
        {
          id: 'chip-shipops',
          label: this.shipOpsOpen ? '[SHIP OPS ▲]' : '[SHIP OPS ▼]',
          accent: this.shipOpsOpen ? 'amber' : 'muted',
          active: this.shipOpsOpen,
          action: () => {
            this.host.audio.playButtonLatchLock(0.98, 0.85);
            this.shipOpsOpen = !this.shipOpsOpen;
            this.destructConfirmArmed = false;
          },
        },
      ];
      const gap = 8;
      const cw = Math.floor((w - gap * (chips.length - 1)) / chips.length);
      chips.forEach((chip, idx) => {
        const bw = idx === chips.length - 1 ? w - (cw + gap) * idx : cw;
        this.pushChromeActionButton(
          ctx,
          { x: x + idx * (cw + gap), y: trayY, width: bw, height: chipBarH },
          chip.label,
          chip.id,
          chip.accent,
          chip.action,
          { active: chip.active, fontPx: 13 }
        );
      });
    }
  }

  private renderCartridgeBayZone(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    _timeSec: number,
    compactGrid: boolean
  ): void {
    ctx.save();
    ctx.fillStyle = THEME.BG_PANEL;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    drawCornerBrackets(ctx, x, y, w, h, 16, THEME.TEXT_PRIMARY, 2.0);

    // Authentic 1979 MU-TH-UR Mainframe Header Bar (monochrome P39 green + amber accents only)
    const hdrH = 30;
    ctx.fillStyle = 'rgba(10, 26, 16, 0.78)';
    ctx.fillRect(x + 2, y + 2, w - 4, hdrH - 2);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + hdrH);
    ctx.lineTo(x + w - 8, y + hdrH);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.ACCENT_AMBER;
    drawEllipsizedText(ctx, 'SYSTEM PROGRAM DIRECTORY // ROM [1-5]', x + 12, y + hdrH * 0.5 + 0.5, w - 24);

    const padInner = 12;
    const availW = w - padInner * 2;
    const listTop = y + hdrH + 10;

    const formatChamp = (programId: CartridgeProgramId): { text: string; live: boolean } => {
      const st = this.hubLeaders.getLeaderState(programId);
      if (st.leader) {
        return {
          text: `#01 ${st.leader.callsign}  ${st.leader.score.toLocaleString()} PTS`,
          live: true,
        };
      }
      return {
        text: st.status === 'LOADING' ? 'SYNCING RELAY...' : 'UNCLAIMED',
        live: false,
      };
    };

    if (compactGrid) {
      // Compact 2-column (3-row) Mainframe ROM Selector for narrow viewports (5th slot spans full width)
      const availH = Math.max(132, y + h - listTop - 10);
      const gap = 6;
      const rowCount = Math.ceil(CARTRIDGE_BAYS.length / 2);
      const cellW = Math.floor((availW - gap) * 0.5);
      const cellH = Math.floor((availH - gap * (rowCount - 1)) / rowCount);

      CARTRIDGE_BAYS.forEach((bay, idx) => {
        const isLastOdd = idx === CARTRIDGE_BAYS.length - 1 && CARTRIDGE_BAYS.length % 2 === 1;
        const col = isLastOdd ? 0 : idx % 2;
        const row = Math.floor(idx / 2);
        const bx = x + padInner + col * (cellW + gap);
        const by = listTop + row * (cellH + gap);
        const bw = isLastOdd ? availW : col === 1 ? availW - cellW - gap : cellW;
        const rect: ViewportRect = { x: bx, y: by, width: bw, height: cellH };
        const id = `bay-slot-${bay.keyNum}`;
        const hov = this.hoveredHitId === id;

        this.hitBoxes.push({
          id,
          rect,
          action: () => this.launchCartridgeInstant(bay.programId),
        });

        ctx.fillStyle = hov ? 'rgba(68, 255, 119, 0.14)' : 'rgba(5, 15, 9, 0.92)';
        ctx.fillRect(bx, by, bw, cellH);
        ctx.strokeStyle = hov ? THEME.ACCENT_AMBER_HI : THEME.BORDER_SUBTLE;
        ctx.lineWidth = hov ? 1.8 : 1.1;
        ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, cellH - 1);

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = font('head', 13);
        ctx.fillStyle = hov ? THEME.ACCENT_AMBER_HI : THEME.TEXT_PRIMARY;
        drawEllipsizedText(ctx, `[0${bay.keyNum}] ${bay.title}`, bx + 10, by + cellH * 0.34, bw - 18);

        ctx.font = font('micro', 12);
        ctx.fillStyle = THEME.TEXT_SECONDARY;
        const champ = formatChamp(bay.programId);
        drawEllipsizedText(ctx, champ.text, bx + 10, by + cellH * 0.72, bw - 18);
      });
    } else {
      // Authentic 1979 CRT Program Directory: 5 crisp rows sized cleanly for 1440x900 & 1280x720
      // + Super-Obvious 1979 1.5X Ranked Score Challenge Toggle + Live Selected Program Dossier
      const is1979Dir = isCrt1979Typography();
      const crtOn = this.host.getCrtPreset() === 'CLASSIC_1979';
      const bannerH = 34;
      const bannerRect: ViewportRect = { x: x + padInner, y: listTop, width: availW, height: bannerH };
      const tmpHit: ChromeButtonHitbox[] = [];
      draw1979RankedBonusBanner(
        ctx,
        bannerRect,
        crtOn,
        this.hoveredHitId,
        _timeSec,
        tmpHit,
        { id: 'hub-1979-banner', compact: true }
      );
      this.hitBoxes.push({
        id: 'hub-1979-banner',
        rect: bannerRect,
        action: () => {
          this.host.toggle1979Crt();
        },
      });

      const dirTop = listTop + bannerH + 8;
      const colHdrH = 22;
      const rowsStartY = dirTop + colHdrH;
      const availBelowHdr = Math.max(180, y + h - rowsStartY - 10);
      const bayCount = CARTRIDGE_BAYS.length;
      const rowGap = 5;
      const reserveDossier = availBelowHdr >= 470 ? (is1979Dir ? 216 : 196) : 0;
      const minRowH = is1979Dir ? 52 : 48;
      const maxRowH = is1979Dir ? 68 : 62;
      const budgetForRows = availBelowHdr - reserveDossier - (reserveDossier > 0 ? 8 : 0);
      const effectiveRowH = Math.max(
        minRowH,
        Math.min(maxRowH, Math.floor((budgetForRows - rowGap * (bayCount - 1)) / bayCount))
      );

      let focusedBay: CartridgeBaySpec = CARTRIDGE_BAYS[0];
      for (const b of CARTRIDGE_BAYS) {
        if (this.hoveredHitId === `bay-slot-${b.keyNum}`) {
          focusedBay = b;
          break;
        }
      }

      // Column micro-header rule
      const colHdrY = dirTop + 6;
      ctx.font = font('micro', 12);
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('ROM // PROGRAM', x + padInner + 8, colHdrY);
      ctx.textAlign = 'right';
      ctx.fillText('EXEC', x + padInner + availW - 8, colHdrY);

      ctx.strokeStyle = THEME.BORDER_SUBTLE;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(x + padInner, dirTop + 16);
      ctx.lineTo(x + padInner + availW, dirTop + 16);
      ctx.stroke();

      CARTRIDGE_BAYS.forEach((bay, idx) => {
        const bx = x + padInner;
        const by = rowsStartY + idx * (effectiveRowH + rowGap);
        const rect: ViewportRect = { x: bx, y: by, width: availW, height: effectiveRowH };
        const id = `bay-slot-${bay.keyNum}`;
        const hov = this.hoveredHitId === id;

        this.hitBoxes.push({
          id,
          rect,
          action: () => this.launchCartridgeInstant(bay.programId),
        });

        // Clean monochrome CRT directory row (no thick rainbow stripes or SaaS card chrome)
        ctx.fillStyle = hov ? 'rgba(68, 255, 119, 0.14)' : idx % 2 === 0 ? 'rgba(6, 18, 11, 0.84)' : 'rgba(4, 13, 8, 0.84)';
        ctx.fillRect(bx, by, availW, effectiveRowH);
        ctx.strokeStyle = hov ? THEME.ACCENT_AMBER_HI : THEME.BORDER_SUBTLE;
        ctx.lineWidth = hov ? 1.8 : 1.0;
        ctx.strokeRect(bx + 0.5, by + 0.5, availW - 1, effectiveRowH - 1);

        // Subtle left cursor chevron on hover only
        if (hov) {
          ctx.fillStyle = THEME.ACCENT_AMBER_HI;
          ctx.fillRect(bx + 2, by + 2, 3, effectiveRowH - 4);
        }

        // Row 1: Left-aligned Program Title + Right-aligned Execute Tag
        const line1Y = by + Math.round(effectiveRowH * 0.30);
        const line2Y = by + Math.round(effectiveRowH * 0.73);
        const textX = bx + 12;
        const execRight = bx + availW - 10;

        const execTag = hov ? '► RUN' : `[${bay.keyNum}]`;
        ctx.font = font('data', 13);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = hov ? THEME.ACCENT_AMBER_HI : THEME.TEXT_SECONDARY;
        ctx.fillText(execTag, execRight, line1Y);
        const execReserve = hov ? 62 : 40;

        const titleMaxW = Math.max(120, availW - 24 - execReserve);
        ctx.textAlign = 'left';
        ctx.font = font('head', effectiveRowH < 58 ? 14 : 15);
        ctx.fillStyle = hov ? THEME.ACCENT_AMBER_HI : THEME.TEXT_PRIMARY;
        drawEllipsizedText(ctx, `0${bay.keyNum}  ${bay.title}`, textX, line1Y, titleMaxW);

        // Row 2: Full-width split — Mode left, #01 Leader right (zero truncation on long callsigns!)
        const champ = formatChamp(bay.programId);
        const champCompact = champ.text.replace(/\s+PTS$/, '');
        ctx.font = font('micro', 12);
        const champW = Math.min(availW * 0.56, Math.ceil(ctx.measureText(champCompact).width) + 4);
        ctx.textAlign = 'right';
        ctx.fillStyle = hov ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT;
        drawEllipsizedText(ctx, champCompact, execRight, line2Y, champW);

        ctx.textAlign = 'left';
        ctx.fillStyle = hov ? THEME.TEXT_BRIGHT : THEME.TEXT_SECONDARY;
        const modeMaxW = Math.max(80, availW - 24 - champW - 10);
        drawEllipsizedText(ctx, bay.ruleset, textX, line2Y, modeMaxW);
      });

      // Lower Right Mainframe Telemetry Panel: Selected Program Brief + Live Top-3/Top-5 Leaderboard
      const dossierTop = rowsStartY + bayCount * effectiveRowH + (bayCount - 1) * rowGap + 8;
      const dossierH = y + h - 10 - dossierTop;
      if (dossierH >= 116) {
        const dx = x + padInner;
        const dw = availW;
        ctx.fillStyle = 'rgba(3, 10, 6, 0.92)';
        ctx.fillRect(dx, dossierTop, dw, dossierH);
        ctx.strokeStyle = THEME.BORDER_SUBTLE;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(dx + 0.5, dossierTop + 0.5, dw - 1, dossierH - 1);

        // Header line
        const dossierHdrH = 24;
        ctx.fillStyle = 'rgba(10, 26, 16, 0.72)';
        ctx.fillRect(dx + 1, dossierTop + 1, dw - 2, dossierHdrH);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = font('micro', 12);
        ctx.fillStyle = THEME.ACCENT_AMBER;
        drawEllipsizedText(
          ctx,
          `ROM 0${focusedBay.keyNum} TELEMETRY // ${focusedBay.title}`,
          dx + 10,
          dossierTop + dossierHdrH * 0.5 + 1,
          dw - 20
        );

        const BRIEF_BY_ID: Record<CartridgeProgramId, { brief: string; keys: string }> = {
          lander: {
            brief: '6-sector precision orbital descent & Endless Deep-Survey.',
            keys: 'W/A/D Thr · S Retro · LMB Radar · SPC 1X',
          },
          perimeter: {
            brief: 'USCM turret killbox defense across escalating colony sectors.',
            keys: '1-8 Build · Drag Aim · E Rearm · F/O/V/L/C/X Skills',
          },
          flak: {
            brief: 'Surface-to-orbit ballistic intercept & shockwave deflections.',
            keys: 'LMB/A/D Flak · RMB/SPACE/S EMP · Chain 2X Lead',
          },
          trench: {
            brief: 'Low-altitude canyon strike jet run ahead of the Purge Wave.',
            keys: 'Mouse Stick · W/S Thr · LMB Gun · RMB/SPC Missile',
          },
          approach: {
            brief: 'LV-118 RAPCON radar approach — vector dropships, heavies & tugs.',
            keys: 'Drag Vector · Snap Gate/Fix · RMB/DblClk Go-Around · Strip Ping',
          },
        };
        const info = BRIEF_BY_ID[focusedBay.programId];

        const hasFooter = dossierH >= 150;
        const footTop = hasFooter ? dossierTop + dossierH - 26 : dossierTop + dossierH - 6;

        let curY = dossierTop + dossierHdrH + (is1979Dir ? 15 : 14);
        const briefStep = is1979Dir ? 19 : 16;
        const maxBriefLines = dossierH >= 240 ? 2 : 1;
        ctx.font = font('prose', 12);
        ctx.fillStyle = THEME.TEXT_BRIGHT;
        const briefLines = wrapTextLines(ctx, info.brief, dw - 20, maxBriefLines);
        for (const bl of briefLines) {
          ctx.fillText(bl, dx + 10, curY);
          curY += briefStep;
        }

        ctx.font = font('micro', 12);
        ctx.fillStyle = THEME.TEXT_SECONDARY;
        drawEllipsizedText(ctx, `KEYS: ${info.keys}`, dx + 10, curY + 2, dw - 20);
        curY += is1979Dir ? 21 : 19;

        // Live Leaderboard Preview (strictly bounded above footTop so ZERO clipping in Clean or 1979 Mode!)
        if (footTop - curY >= 42) {
          ctx.strokeStyle = THEME.BORDER_SUBTLE;
          ctx.lineWidth = 1.0;
          ctx.beginPath();
          ctx.moveTo(dx + 10, curY - 4);
          ctx.lineTo(dx + dw - 10, curY - 4);
          ctx.stroke();

          const boardRowStep = is1979Dir ? 22 : 19;
          const maxBoardRows = dossierH >= (is1979Dir ? 290 : 260) ? 5 : 3;
          ctx.font = font('micro', 12);
          ctx.fillStyle = THEME.ACCENT_AMBER;
          ctx.fillText(`LIVE LEADERBOARD // TOP ${maxBoardRows}`, dx + 10, curY + 9);
          curY += is1979Dir ? 25 : 22;

          const top = this.hubLeaders.getTopScores(focusedBay.programId).slice(0, maxBoardRows);
          if (top.length === 0) {
            if (curY + 8 <= footTop - 4) {
              ctx.font = font('data', 12);
              ctx.fillStyle = THEME.TEXT_SECONDARY;
              ctx.fillText('AWAITING ORBITAL TELEMETRY...', dx + 10, curY + 2);
            }
          } else {
            top.forEach((entry, idx) => {
              if (curY + 10 > footTop - 4) return;
              ctx.font = font('data', 12);
              ctx.textAlign = 'left';
              ctx.fillStyle = idx === 0 ? THEME.ACCENT_AMBER_HI : THEME.TEXT_PRIMARY;
              ctx.fillText(`#0${idx + 1}  ${entry.callsign}`, dx + 10, curY + 2);
              ctx.textAlign = 'right';
              ctx.fillStyle = idx === 0 ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT;
              ctx.fillText(`${entry.score.toLocaleString()} PTS`, dx + dw - 10, curY + 2);
              curY += boardRowStep;
            });
          }
        }

        // Bottom mainframe status bar inside telemetry dossier
        if (hasFooter) {
          const footY = dossierTop + dossierH - 22;
          ctx.strokeStyle = THEME.BORDER_SUBTLE;
          ctx.lineWidth = 1.0;
          ctx.beginPath();
          ctx.moveTo(dx + 8, footY - 4);
          ctx.lineTo(dx + dw - 8, footY - 4);
          ctx.stroke();

          ctx.font = font('micro', 12);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = THEME.TEXT_SECONDARY;
          drawEllipsizedText(
            ctx,
            `PRESS [1-5] OR CLICK ROW TO EXECUTE ROM 0${focusedBay.keyNum}`,
            dx + 10,
            footY + 9,
            dw - 20
          );
        }
      }
    }

    ctx.restore();
  }

  private renderBioscanOverlay(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    timeSec: number
  ): void {
    const p = Math.max(0, Math.min(1, this.bioscanElapsed / this.bioscanDuration));
    ctx.save();
    ctx.fillStyle = 'rgba(3, 14, 8, 0.96)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = p > 0.72 ? THEME.ALERT_RED_STROKE : THEME.TEXT_PRIMARY;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    const cx = x + 60;
    const cy = y + h * 0.52;
    ctx.strokeStyle = THEME.TEXT_PRIMARY;
    ctx.lineWidth = 1.5;
    for (let r = -3; r <= 3; r++) {
      const ry = cy + r * 10;
      const rw = 32 - Math.abs(r) * 3.5;
      ctx.beginPath();
      ctx.ellipse(cx, ry, rw, 4.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (p > 0.32) {
      const anomPulse = 0.65 + 0.35 * Math.sin(timeSec * 22);
      ctx.strokeStyle = `rgba(255, 68, 34, ${anomPulse.toFixed(2)})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(cx + 4, cy + 3, 12, 0, Math.PI * 2);
      ctx.moveTo(cx + 4, cy + 15);
      ctx.quadraticCurveTo(cx + 20, cy + 25, cx + 10, cy + 36);
      ctx.stroke();
    }

    const scanY = y + 8 + p * (h - 16);
    ctx.strokeStyle = '#FFF6CC';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(x + 10, scanY);
    ctx.lineTo(x + 114, scanY);
    ctx.stroke();

    const tx = x + 128;
    const tw = Math.max(80, w - 138);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = font('head', 14);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    drawEllipsizedText(ctx, `MEDBAY AUTO-DOC // THORACIC SCAN ${Math.round(p * 100)}%`, tx, y + 24, tw);

    ctx.font = font('micro', 12);
    ctx.fillStyle = p > 0.55 ? THEME.ALERT_RED_TEXT : THEME.TEXT_BRIGHT;
    drawEllipsizedText(ctx, 'SUBJECT: EXEC. OFFICER KANE // RESPIRATORY TRACT', tx, y + 48, tw);
    drawEllipsizedText(
      ctx,
      p > 0.45
        ? 'BIO-MASS DENSITY: SILICON-CARBON EXOSKELETON DETECTED'
        : 'MAPPING PULMONARY ARTERIES & STERNUM...',
      tx,
      y + 72,
      tw
    );
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    drawEllipsizedText(
      ctx,
      p > 0.72 ? 'WARNING: MOLECULAR ACID HEMOLYMPH — DO NOT CUT!' : 'ANALYZING CELLULAR STRUCTURE...',
      tx,
      y + 96,
      tw
    );
    ctx.restore();
  }

  private renderSignalDecodeOverlay(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    timeSec: number
  ): void {
    const p = Math.max(0, Math.min(1, this.signalElapsed / this.signalDuration));
    ctx.save();
    ctx.fillStyle = 'rgba(4, 12, 8, 0.96)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = font('head', 13);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    drawEllipsizedText(
      ctx,
      `LV-426 ACOUSTIC BEACON // FOURIER DECODE ${Math.round(p * 100)}% [INTERVAL: 12.0S]`,
      x + 12,
      y + 20,
      w - 24
    );

    const waveTop = y + 34;
    const waveH = h - 56;
    const midY = waveTop + waveH * 0.5;
    ctx.strokeStyle = THEME.TEXT_PRIMARY;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    const samples = 88;
    for (let i = 0; i <= samples; i++) {
      const f = i / samples;
      const px = x + 12 + f * (w - 24);
      const env = Math.sin(f * Math.PI);
      const mod =
        Math.sin(f * 26 + timeSec * 15) * 0.55 +
        Math.sin(f * 68 - timeSec * 28) * 0.35 +
        Math.cos(f * 11 + timeSec * 7) * 0.25;
      const py = midY + mod * env * (waveH * 0.44);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    drawEllipsizedText(
      ctx,
      p > 0.65
        ? 'SYNTAX MATCH: NON-HUMAN ACOUSTIC WARNING PATTERN IDENTIFIED'
        : 'ISOLATING CARRIER HARMONICS FROM ATMOSPHERIC STATIC...',
      x + 12,
      y + h - 14,
      w - 24
    );
    ctx.restore();
  }
}
