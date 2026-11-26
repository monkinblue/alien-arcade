import { COLORS } from '../constants';
import { HubLeadersService } from '../services/hubLeaders';
import type {
  Cartridge,
  CartridgeProgramId,
  CrtShaderFrameParams,
  HostEnvironment,
  PhosphorTheme,
} from '../shell/Cartridge';
import type { ViewportRect } from '../types';

interface TerminalLine {
  text: string;
  tone: 'green' | 'bright' | 'amber' | 'dim' | 'red';
  clickableCmd?: string;
  clickableId?: string;
  programId?: CartridgeProgramId;
}

interface TerminalHitBox {
  id: string;
  rect: ViewportRect;
  autoTypeCmd?: string;
  action?: () => void;
}

const INITIAL_HEADER_LINES: TerminalLine[] = [
  {
    text: 'WEYLAND-YUTANI CORP // INTERFACE 2037 // MU-TH-UR 6000',
    tone: 'amber',
  },
  {
    text: '64K RAM SYSTEM READY // TELEMETRY UPLINK: ACTIVE',
    tone: 'green',
  },
  { text: '', tone: 'dim' },
  { text: 'INSTALLED SIMULATION PROGRAMS:', tone: 'bright' },
  {
    text: '  1. ORBITAL DESCENT TELEMETRY',
    tone: 'green',
    clickableCmd: 'RUN 1',
    clickableId: 'prog-row-1',
    programId: 'lander',
  },
  {
    text: "  2. HADLEY'S PERIMETER",
    tone: 'green',
    clickableCmd: 'RUN 2',
    clickableId: 'prog-row-2',
    programId: 'perimeter',
  },
  {
    text: '  3. ORBITAL INTERCEPT // FLAK',
    tone: 'green',
    clickableCmd: 'RUN 3',
    clickableId: 'prog-row-3',
    programId: 'flak',
  },
  {
    text: '  4. DERELICT TRENCH // VECTOR',
    tone: 'green',
    clickableCmd: 'RUN 4',
    clickableId: 'prog-row-4',
    programId: 'trench',
  },
  { text: '', tone: 'dim' },
  {
    text: "ENTER [1-4], 'HELP', 'QUERY <TEXT>', 'SCORES', OR 'PHOSPHOR AMBER':",
    tone: 'amber',
  },
];

const AUTOCOMPLETE_COMMANDS = [
  'HELP',
  'RUN 1',
  'RUN 2',
  'RUN 3',
  'RUN 4',
  'LANDER',
  'PERIMETER',
  'FLAK',
  'TRENCH',
  'VECTOR',
  'QUERY ',
  'ASK ',
  'CREW',
  'MANIFEST',
  'BIOSCAN',
  'MEDBAY',
  'SIGNAL',
  'DECODE',
  'BEACON',
  'DIAG',
  'STATUS',
  'DESTRUCT',
  'SELF-DESTRUCT',
  'ABORT',
  'PHOSPHOR GREEN',
  'PHOSPHOR AMBER',
  'PHOSPHOR CYAN',
  'THEME ',
  'SCORES',
  'LEADERBOARD',
  'ORDER 937',
  'DIR',
  'CLS',
  'MUTE',
];

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

  private inputBuffer = '';
  private commandHistory: string[] = [];
  private historyIndex = -1;

  // Auto-typing state when user clicks a program row or shortcut
  private autoTypeQueue = '';
  private autoTypeTimer = 0;
  private pendingLaunchProgram: CartridgeProgramId | null = null;
  private pendingLaunchTimer = 0;

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
    this.listenerAbort = new AbortController();
    const signal = this.listenerAbort.signal;

    const vp = this.host.getViewport();
    this.resize(vp.width, vp.height, vp.offsetX, vp.offsetY);

    this.inputBuffer = '';
    this.autoTypeQueue = '';
    this.autoTypeTimer = 0;
    this.pendingLaunchProgram = null;
    this.pendingLaunchTimer = 0;
    this.hoveredHitId = null;

    this.bioscanActive = false;
    this.bioscanElapsed = 0;
    this.signalActive = false;
    this.signalElapsed = 0;
    this.destructActive = false;
    this.destructRemaining = 10.0;
    this.destructLastAnnouncedSec = 11;
    this.destructWhiteoutTimer = 0;

    this.resetLinesToPrompt(!this.hasCompletedInitialBootReveal);
    if (this.returnBannerMessage) {
      this.appendLines(
        [
          { text: `SYS> ${this.returnBannerMessage}`, tone: 'amber' },
          { text: 'READY FOR NEXT OPERATOR DIRECTIVE.', tone: 'dim' },
        ],
        true
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
    this.autoTypeQueue = '';
    this.pendingLaunchProgram = null;
    this.destructActive = false;
    this.bioscanActive = false;
    this.signalActive = false;
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
    // Keep terminal scrollback crisp & bounded while always preserving top header + 4 program rows
    const maxExtraLines = 15;
    const baseCount = INITIAL_HEADER_LINES.length;
    if (this.lines.length > baseCount + maxExtraLines) {
      const overflow = this.lines.length - (baseCount + maxExtraLines);
      this.lines.splice(baseCount, overflow);
    }
    this.recomputeTotalChars();
    if (animateNew) {
      const newCount = newLines.reduce((acc, l) => acc + Math.max(1, l.text.length), 0);
      this.revealedCharCount = Math.max(0, Math.min(prevTotal, this.totalLineChars - newCount));
    } else {
      this.revealedCharCount = this.totalLineChars;
    }
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
      // If exact match already in list, cycle to next matching command
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
      'keydown',
      (e) => {
        const mobileInput = document.getElementById('mobile-callsign-input');
        if (mobileInput && e.target === mobileInput) {
          return;
        }
        if (
          this.pendingLaunchProgram !== null ||
          this.autoTypeQueue.length > 0 ||
          this.destructWhiteoutTimer > 0
        ) {
          return;
        }
        void this.host.audio.unlock();

        if (this.revealedCharCount < this.totalLineChars) {
          this.revealedCharCount = this.totalLineChars;
          if (e.code === 'Escape' || (e.code === 'Space' && this.inputBuffer.length === 0)) {
            e.preventDefault();
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
          if (this.inputBuffer.length > 0) {
            this.inputBuffer = '';
            this.host.audio.playSfx('keypress_return', { pitch: 0.82, volume: 0.75 });
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
            this.host.audio.playSfx('ui_keyclick', { pitch: 0.98 });
          }
          return;
        }

        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (e.code === 'Space') {
            e.preventDefault();
          }
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
        if (
          this.pendingLaunchProgram !== null ||
          this.autoTypeQueue.length > 0 ||
          this.destructWhiteoutTimer > 0
        ) {
          return;
        }

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
          if (hit.autoTypeCmd) {
            this.triggerAutoTypeCommand(hit.autoTypeCmd);
          } else if (hit.action) {
            this.host.audio.playButtonLatchLock(0.95, 0.9);
            hit.action();
          }
          return;
        }

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

  private triggerAutoTypeCommand(cmd: string): void {
    this.inputBuffer = '';
    this.autoTypeQueue = cmd.toUpperCase();
    this.autoTypeTimer = 0.014;
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

    // Eerie 1979 LV-426 low-frequency acoustic modulated distress/warning beacon (3.0s)
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

    // Rising Nostromo reactor core whine
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

    if (!trimmed) {
      this.appendLines([{ text: 'MU-TH-UR>', tone: 'dim' }], false);
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
      this.stopTerminalSequencesAudio();
      this.playSteamVentAbortAudio();
      this.glitchPulse = 0.45;
      this.appendLines(
        [
          echoLine,
          {
            text: '>>> EMERGENCY DESTRUCT ABORTED // VENTING COOLING UNITS... <<<',
            tone: 'bright',
          },
          { text: 'REACTOR STABILIZED. MU-TH-UR 6000 RETURNING TO STANDBY.', tone: 'green' },
        ],
        true
      );
      return;
    }

    // 1. Program 1: Lunar Lander
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
      this.stopTerminalSequencesAudio();
      this.destructActive = false;
      this.appendLines(
        [
          echoLine,
          {
            text: 'MOUNTING CARTRIDGE 01 // ORBITAL DESCENT TELEMETRY (LV-426)...',
            tone: 'amber',
          },
        ],
        false
      );
      this.glitchPulse = 0.65;
      this.pendingLaunchProgram = 'lander';
      this.pendingLaunchTimer = 0.34;
      return;
    }

    // 2. Program 2: Hadley's Perimeter
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
      this.stopTerminalSequencesAudio();
      this.destructActive = false;
      this.appendLines(
        [
          echoLine,
          {
            text: "MOUNTING CARTRIDGE 02 // HADLEY'S PERIMETER (UA 571-C TACTICAL NET)...",
            tone: 'amber',
          },
        ],
        false
      );
      this.glitchPulse = 0.65;
      this.pendingLaunchProgram = 'perimeter';
      this.pendingLaunchTimer = 0.34;
      return;
    }

    // 3. Program 3: Orbital Intercept // Flak Net
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
      this.stopTerminalSequencesAudio();
      this.destructActive = false;
      this.appendLines(
        [
          echoLine,
          {
            text: 'CALIBRATING SURFACE-TO-ORBIT RADAR 03 // FLAK NET...',
            tone: 'amber',
          },
        ],
        false
      );
      this.glitchPulse = 0.65;
      this.pendingLaunchProgram = 'flak';
      this.pendingLaunchTimer = 0.34;
      return;
    }

    // 4. Program 4: Derelict Trench // Vector Run
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
      this.stopTerminalSequencesAudio();
      this.destructActive = false;
      this.appendLines(
        [
          echoLine,
          {
            text: 'ENGAGING DROP-SHIP FLIGHT VECTOR 04 // DERELICT TRENCH...',
            tone: 'amber',
          },
        ],
        false
      );
      this.glitchPulse = 0.65;
      this.pendingLaunchProgram = 'trench';
      this.pendingLaunchTimer = 0.34;
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
            text: 'SIMULATIONS   : RUN [1-4] | LANDER | PERIMETER | FLAK | TRENCH | SCORES',
            tone: 'bright',
          },
          {
            text: 'SHIP SYSTEMS  : CREW | BIOSCAN | SIGNAL | DIAG | STATUS | DIR | CLS',
            tone: 'green',
          },
          {
            text: 'CLASSIFIED    : QUERY <TEXT> | ASK <TEXT> | ORDER 937 | DESTRUCT',
            tone: 'amber',
          },
          {
            text: 'DISPLAY/AUDIO : PHOSPHOR <GREEN|AMBER|CYAN> | MUTE | [TAB] AUTOCOMPLETE',
            tone: 'green',
          },
        ],
        true
      );
      return;
    }

    // 7. QUERY <text> / ASK <text> — Ripley-vs-MU-TH-UR Interrogation Parser!
    if (trimmed.startsWith('QUERY') || trimmed.startsWith('ASK')) {
      const q = trimmed.replace(/^(QUERY|ASK)\s*/, '').trim();
      this.host.audio.playAlienComputerActivity(0.45);
      if (!q) {
        this.appendLines(
          [
            echoLine,
            { text: 'SYNTAX: QUERY <SUBJECT> (E.G. ALIEN, CHANCES, KILL, COURSE)', tone: 'amber' },
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

    // 9. BIOSCAN / MEDBAY (2-second animated phosphor chest-cavity scan!)
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

    // 10. SIGNAL / DECODE / BEACON (3-second animated waveform + acoustic beacon!)
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

    // 11. DESTRUCT / SELF-DESTRUCT (Interactive 10-second Nostromo Self-Destruct!)
    if (trimmed === 'DESTRUCT' || trimmed === 'SELF-DESTRUCT' || trimmed === 'SELFDESTRUCT') {
      if (this.destructActive) {
        this.appendLines(
          [echoLine, { text: "DESTRUCT ALREADY ARMED — TYPE 'ABORT' TO CANCEL!", tone: 'red' }],
          false
        );
        return;
      }
      this.destructActive = true;
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

    // 12. PHOSPHOR <GREEN | AMBER | CYAN> / THEME
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
          [
            echoLine,
            { text: 'SYNTAX: PHOSPHOR <GREEN | AMBER | CYAN>', tone: 'amber' },
          ],
          true
        );
        return;
      }
      this.host.setPhosphorTheme(nextTheme);
      this.glitchPulse = 0.4;
      this.host.audio.playButtonLatchLock(1.04, 0.9);
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

    // 13. SCORES / LEADERBOARD (Unified Top-5 Board across all 4 arcade games!)
    if (trimmed === 'SCORES' || trimmed === 'LEADERBOARD' || trimmed === 'HIGHSCORES') {
      this.host.audio.playAlienComputerActivity(0.45);
      const formatTop = (id: CartridgeProgramId, label: string): TerminalLine[] => {
        const list = this.hubLeaders.getTopScores(id);
        const st = this.hubLeaders.getLeaderState(id).status;
        if (list.length === 0) {
          return [
            {
              text: `  ${label.padEnd(12)} ${st === 'LOADING' ? '[SYNCING UPLINK...]' : '[NO HUMAN SCORES YET]'}`,
              tone: 'dim',
            },
          ];
        }
        const compact = list
          .slice(0, 5)
          .map((e, i) => `#${i + 1} ${e.callsign.slice(0, 10)}:${e.score.toLocaleString()}`)
          .join(' | ');
        return [{ text: `  ${label.padEnd(11)} ${compact}`, tone: 'green' }];
      };

      this.appendLines(
        [
          echoLine,
          { text: 'GLOBAL TELEMETRY TOP-5 MANIFEST // ALL 4 SIMULATIONS:', tone: 'amber' },
          ...formatTop('lander', '01 LANDER'),
          ...formatTop('perimeter', '02 PERIMTR'),
          ...formatTop('flak', '03 FLAKNET'),
          ...formatTop('trench', '04 TRENCH'),
        ],
        true
      );
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
          { text: '  01  ORBITAL_DESCENT.SIM     28,672 B   [LV-426 DROP TELEMETRY]', tone: 'green' },
          { text: '  02  HADLEYS_PERIMETER.SIM   34,816 B   [UA 571-C SENTRY CAD]', tone: 'green' },
          { text: '  03  FLAK_NET_RADAR.SIM      31,744 B   [M90 + BOSS INTERCEPT]', tone: 'green' },
          { text: '  04  DERELICT_TRENCH.SIM     36,864 B   [3D VECTOR FLIGHT RUN]', tone: 'green' },
          { text: '  99  SPECIAL_ORDER_937.ENC    1,024 B   [EYES ONLY // RESTRICTED]', tone: 'amber' },
        ],
        true
      );
      return;
    }

    // 15. DIAG / STATUS (Live ship subsystems + Firestore Uplink telemetry!)
    if (trimmed === 'STATUS' || trimmed === 'DIAG' || trimmed === 'SYSTEM') {
      this.host.audio.playAlienComputerActivity(0.45);
      const audState = this.host.isMuted() ? 'MUTED' : 'NOMINAL';
      const theme = this.host.getPhosphorTheme();
      const uplink = this.hubLeaders.getUplinkSummary();
      const pingTxt =
        uplink.liveCount > 0
          ? `ONLINE (${uplink.liveCount}/${uplink.totalCount} DBs · ${uplink.avgPingMs ?? 24}MS)`
          : 'OFFLINE / LOCAL ARCHIVE';
      this.appendLines(
        [
          echoLine,
          { text: 'USCSS NOSTROMO // FULL HARDWARE & SUBSYSTEM DIAGNOSTIC:', tone: 'amber' },
          {
            text: `  HYPERSLEEP PODS : 7/7 STANDBY  |  ATMOS PROCESSOR : COOLING UNITS 1-4 OK`,
            tone: 'green',
          },
          {
            text: `  CORE 64K MEMORY : 65,536 BYTES OK  |  PHOSPHOR : ${theme}  |  AUDIO: ${audState}`,
            tone: 'green',
          },
          {
            text: `  FIRESTORE UPLINK: ${pingTxt}`,
            tone: uplink.liveCount > 0 ? 'bright' : 'amber',
          },
        ],
        true
      );
      return;
    }

    // 16. Special Order 937 Classified Easter Egg
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
          {
            text: '>>> DECRYPTING WEYLAND-YUTANI CLASSIFIED DIRECTIVE [SPECIAL ORDER 937] <<<',
            tone: 'amber',
          },
          {
            text: 'SCIENCE OFFICER EYES ONLY: PRIORITY ONE — INSURE RETURN OF ORGANISM',
            tone: 'amber',
          },
          {
            text: 'FOR ANALYSIS. ALL OTHER CONSIDERATIONS SECONDARY. CREW EXPENDABLE.',
            tone: 'red',
          },
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

    // Unrecognized directive
    this.host.audio.playMutedAvionicsIndicatorBeep(false);
    this.appendLines(
      [
        echoLine,
        {
          text: "DOES NOT COMPUTE // ENTER [1-4], 'HELP', 'QUERY <TEXT>', OR PRESS [TAB].",
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

    // Ambient computer thinking chirp
    this.ambientTimer -= clampedDt;
    if (this.ambientTimer <= 0 && !this.destructActive) {
      this.ambientTimer = 22 + Math.random() * 14;
      this.host.audio.playAlienComputerActivity(0.2);
    }

    // 1. Step BIOSCAN 2-second animated sequence
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

    // 2. Step SIGNAL 3-second animated waveform sequence
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

    // 3. Step Interactive 10-second Nostromo SELF-DESTRUCT Sequence!
    if (this.destructWhiteoutTimer > 0) {
      this.destructWhiteoutTimer -= clampedDt;
      // Dramatic CRT white-out static burst before cold reboot!
      ctx.save();
      const p = Math.max(0, this.destructWhiteoutTimer / 1.15);
      ctx.fillStyle = p > 0.35 ? '#FFF8EE' : '#080C09';
      ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);
      for (let i = 0; i < 42; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#FFFFFF' : '#FFB000';
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
              text: `EMERGENCY DESTRUCT SYSTEM ARMED — T-MINUS ${String(secInt).padStart(2, '0')}...  (TYPE 'ABORT' TO CANCEL)`,
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

    // Pending program launch delay
    if (this.pendingLaunchProgram !== null) {
      this.pendingLaunchTimer -= clampedDt;
      if (this.pendingLaunchTimer <= 0) {
        const target = this.pendingLaunchProgram;
        this.pendingLaunchProgram = null;
        this.host.launchProgram(target);
        return {
          interference: 0.06,
          glitch: 0.85,
          overdrive: 0,
          tubeTurnOn: 0,
        };
      }
    }

    // Typewriter output reveal with mechanical clacks
    if (this.revealedCharCount < this.totalLineChars) {
      const prev = this.revealedCharCount;
      this.revealedCharCount = Math.min(
        this.totalLineChars,
        this.revealedCharCount + clampedDt * 92
      );
      if (Math.floor(this.revealedCharCount / 3.2) > Math.floor(prev / 3.2)) {
        this.host.audio.playAsmrScrollClack(0.7);
      }
    } else if (this.autoTypeQueue.length > 0) {
      this.autoTypeTimer -= clampedDt;
      if (this.autoTypeTimer <= 0) {
        this.autoTypeTimer = 0.036;
        const ch = this.autoTypeQueue[0];
        this.autoTypeQueue = this.autoTypeQueue.slice(1);
        this.inputBuffer += ch;
        this.host.audio.playSfx('ui_keyclick', {
          pitch: 0.96 + Math.random() * 0.12,
          volume: 0.88,
        });
        if (this.autoTypeQueue.length === 0) {
          this.host.audio.playSfx('keypress_return', { pitch: 0.96, volume: 0.95 });
          this.executeCommand(this.inputBuffer);
        }
      }
    }

    this.renderTerminal(ctx, totalTimeSec);

    return {
      interference: this.destructActive ? 0.09 : 0.015,
      glitch: this.glitchPulse,
      overdrive: this.destructActive ? 0.45 : 0,
      tubeTurnOn: 0,
    };
  }

  private renderTerminal(ctx: CanvasRenderingContext2D, timeSec: number): void {
    const w = this.viewportWidth;
    const h = this.viewportHeight;
    this.hitBoxes = [];

    ctx.save();
    ctx.fillStyle = COLORS.BG_DEEP;
    ctx.fillRect(0, 0, w, h);

    // Subtle cathode glow (or pulsing red/amber alarm flood during Self-Destruct!)
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
      glow.addColorStop(0, 'rgba(26, 86, 44, 0.15)');
      glow.addColorStop(1, 'rgba(0, 0, 0, 0.52)');
    }
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const pad = Math.max(12, Math.round(Math.min(w, h) * 0.018));
    const outerCol = this.destructActive
      ? Math.sin(timeSec * 16) > 0
        ? COLORS.RED_KLAXON
        : '#FFB000'
      : COLORS.GREEN_DIM;
    this.drawCornerBrackets(ctx, pad, pad, w - pad * 2, h - pad * 2, 26, outerCol, this.destructActive ? 3.5 : 2.2);

    // Pulsing warning border frame during Self-Destruct
    if (this.destructActive) {
      ctx.strokeStyle = Math.sin(timeSec * 16) > 0 ? COLORS.RED_KLAXON : '#FFB000';
      ctx.lineWidth = 3.2;
      ctx.strokeRect(pad + 4, pad + 4, w - pad * 2 - 8, h - pad * 2 - 8);
    }

    // Top Hardware Header Strip (with bigger readable pills!)
    const topBarBottom = pad + 52;
    ctx.strokeStyle = this.destructActive ? COLORS.RED_KLAXON : COLORS.GREEN_DIM;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(pad + 14, topBarBottom);
    ctx.lineTo(w - pad - 14, topBarBottom);
    ctx.stroke();

    const isCompact = w < 780;
    ctx.font = isCompact
      ? 'bold 15px "Share Tech Mono", monospace'
      : 'bold 19px "Share Tech Mono", monospace';
    ctx.fillStyle = this.destructActive ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY;
    ctx.textAlign = 'left';
    ctx.fillText(
      this.destructActive
        ? `⚠ EMERGENCY DESTRUCT ARMED // T-MINUS ${this.destructRemaining.toFixed(1)}S ⚠`
        : isCompact
          ? 'MU-TH-UR 6000 // OS HUB'
          : 'INTERFACE 2037 // USCSS NOSTROMO // MU-TH-UR 6000 OS HUB',
      pad + 16,
      pad + 33
    );

    // Top-Right Hardware Pills (Phosphor Theme, Audio Mute, Fullscreen)
    const muted = this.host.isMuted();
    const isFs = this.host.getViewport().isFullscreen;
    const theme = this.host.getPhosphorTheme();

    const pills: Array<{
      id: string;
      label: string;
      w: number;
      accent: string;
      onClick: () => void;
    }> = [
      {
        id: 'hub-phosphor-cycle',
        label: `CRT: ${theme}`,
        w: isCompact ? 96 : 124,
        accent: '#FFB000',
        onClick: () => {
          const order: PhosphorTheme[] = ['GREEN', 'AMBER', 'CYAN'];
          const next = order[(order.indexOf(theme) + 1) % order.length];
          this.host.setPhosphorTheme(next);
          this.glitchPulse = 0.35;
        },
      },
      {
        id: 'hub-audio-toggle',
        label: muted ? 'AUDIO: OFF' : 'AUDIO: ON',
        w: isCompact ? 96 : 124,
        accent: muted ? COLORS.RED_KLAXON : COLORS.GREEN_BRIGHT,
        onClick: () => {
          this.host.setMuted(!this.host.isMuted());
        },
      },
      {
        id: 'hub-fullscreen',
        label: isFs ? 'EXIT FULL' : 'FULLSCR',
        w: isCompact ? 90 : 118,
        accent: COLORS.GREEN_PRIMARY,
        onClick: () => {
          this.host.toggleFullscreen();
        },
      },
    ];

    let pillX = w - pad - 16;
    const pillY = pad + 6;
    const pillH = 38;
    for (let i = pills.length - 1; i >= 0; i--) {
      const p = pills[i];
      pillX -= p.w;
      const rect: ViewportRect = { x: pillX, y: pillY, width: p.w, height: pillH };
      this.hitBoxes.push({ id: p.id, rect, action: p.onClick });
      const hov = this.hoveredHitId === p.id;

      ctx.fillStyle = hov ? 'rgba(68, 255, 119, 0.24)' : 'rgba(6, 16, 10, 0.92)';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = hov ? '#FFFFFF' : p.accent;
      ctx.lineWidth = hov ? 2.2 : 1.8;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

      ctx.font = isCompact
        ? 'bold 13.5px "Share Tech Mono", monospace'
        : 'bold 15.5px "Share Tech Mono", monospace';
      ctx.fillStyle = hov ? '#FFFFFF' : p.accent;
      ctx.textAlign = 'center';
      ctx.fillText(p.label, rect.x + rect.width * 0.5, rect.y + 24);
      pillX -= 8;
    }

    // Significantly Larger Bottom Quick-Command Deck (2 generous rows or spacious full-width buttons!)
    const bottomDeckH = w < 1120 ? 108 : 58;
    const showAuxRack = w >= 1020 && h >= 540;
    const contentTop = topBarBottom + 12;
    const contentBottom = h - pad - bottomDeckH - 12;
    const contentH = Math.max(200, contentBottom - contentTop);
    const auxW = showAuxRack ? Math.min(352, Math.round(w * 0.275)) : 0;
    const mainX = pad + 16;
    const mainW = w - pad * 2 - 32 - (showAuxRack ? auxW + 16 : 0);

    ctx.fillStyle = 'rgba(4, 11, 7, 0.86)';
    ctx.fillRect(mainX, contentTop, mainW, contentH);
    this.drawCornerBrackets(
      ctx,
      mainX,
      contentTop,
      mainW,
      contentH,
      18,
      this.destructActive ? COLORS.RED_KLAXON : COLORS.GREEN_PRIMARY,
      2.2
    );

    // Responsive Monospace Font Sizing inside Main Terminal
    const fontPx = Math.max(13.5, Math.min(18.5, Math.floor(Math.min(mainW / 44, contentH / 25))));
    const lineStep = Math.round(fontPx * 1.56);
    const textLeft = mainX + Math.max(14, Math.round(fontPx * 1.0));
    let curY = contentTop + Math.max(26, Math.round(fontPx * 1.75));

    ctx.font = `bold ${fontPx}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'left';

    let remChars = Math.floor(this.revealedCharCount);
    let activeRevealCursorDrawn = false;

    const animOverlayReserve = this.bioscanActive || this.signalActive ? 132 : 0;
    const maxTextY = contentBottom - lineStep * 2.1 - animOverlayReserve;

    for (let i = 0; i < this.lines.length; i++) {
      if (remChars <= 0) break;
      const line = this.lines[i];
      const lineCost = Math.max(1, line.text.length);
      const shownText = line.text.slice(0, remChars);
      remChars -= lineCost;

      if (curY > maxTextY) {
        break;
      }

      // Clickable program row interactive highlight box (bigger & easier to click!)
      if (line.clickableCmd && line.clickableId && shownText.length > 4) {
        const stackedBadge = Boolean(line.programId && mainW < 700);
        const rowH = stackedBadge
          ? Math.round(lineStep * 1.78)
          : Math.round(lineStep * 1.12);
        const rowRect: ViewportRect = {
          x: textLeft - 8,
          y: curY - Math.round(fontPx * 1.08),
          width: Math.min(mainW - (textLeft - mainX) * 2 + 16, Math.max(300, mainW - 32)),
          height: rowH,
        };
        this.hitBoxes.push({
          id: line.clickableId,
          rect: rowRect,
          autoTypeCmd: line.clickableCmd,
        });

        const isRowHovered = this.hoveredHitId === line.clickableId;
        ctx.fillStyle = isRowHovered
          ? 'rgba(255, 176, 0, 0.24)'
          : 'rgba(59, 224, 104, 0.08)';
        ctx.fillRect(rowRect.x, rowRect.y, rowRect.width, rowRect.height);
        ctx.strokeStyle = isRowHovered ? '#FFB000' : 'rgba(59, 224, 104, 0.42)';
        ctx.lineWidth = isRowHovered ? 2.2 : 1.4;
        ctx.strokeRect(rowRect.x, rowRect.y, rowRect.width, rowRect.height);

        const prefix = isRowHovered ? shownText.replace(/^  /, '► ') : shownText;

        if (line.programId && shownText.length >= line.text.length) {
          const badgeText = this.hubLeaders.formatBadgeText(line.programId);
          const leaderState = this.hubLeaders.getLeaderState(line.programId);
          const hasChamp = Boolean(leaderState.leader);

          if (!stackedBadge) {
            ctx.save();
            const badgeFontPx = Math.max(12, Math.min(fontPx - 0.5, 15.5));
            ctx.font = `bold ${badgeFontPx}px "JetBrains Mono", monospace`;
            const badgeW = ctx.measureText(badgeText).width;
            const maxLeftW = Math.max(140, rowRect.width - badgeW - 24);

            ctx.font = `bold ${fontPx}px "JetBrains Mono", monospace`;
            ctx.textAlign = 'left';
            ctx.fillStyle = isRowHovered ? '#FFD466' : '#44FF77';
            ctx.fillText(prefix, textLeft, curY, maxLeftW);

            ctx.font = `bold ${badgeFontPx}px "JetBrains Mono", monospace`;
            ctx.textAlign = 'right';
            ctx.fillStyle = hasChamp
              ? isRowHovered
                ? '#FFF6CC'
                : '#FFB000'
              : 'rgba(255, 176, 0, 0.68)';
            ctx.fillText(badgeText, rowRect.x + rowRect.width - 10, curY);
            ctx.restore();
          } else {
            ctx.fillStyle = isRowHovered ? '#FFD466' : '#44FF77';
            ctx.fillText(prefix, textLeft, curY, rowRect.width - 16);

            ctx.save();
            ctx.font = `bold ${Math.max(11.5, fontPx - 2)}px "JetBrains Mono", monospace`;
            ctx.textAlign = 'left';
            ctx.fillStyle = hasChamp ? '#FFB000' : 'rgba(255, 176, 0, 0.68)';
            ctx.fillText(`    ${badgeText}`, textLeft, curY + Math.round(lineStep * 0.74), rowRect.width - 20);
            ctx.restore();
          }
        } else {
          ctx.fillStyle = isRowHovered ? '#FFD466' : '#44FF77';
          ctx.fillText(prefix, textLeft, curY);
        }

        curY += stackedBadge ? Math.round(lineStep * 0.92) : Math.round(lineStep * 0.16);
      } else {
        ctx.fillStyle =
          line.tone === 'amber'
            ? '#FFB000'
            : line.tone === 'bright'
              ? '#8EF5AB'
              : line.tone === 'red'
                ? COLORS.RED_KLAXON
                : line.tone === 'dim'
                  ? COLORS.GREEN_MID
                  : '#44FF77';
        ctx.fillText(shownText, textLeft, curY, mainW - (textLeft - mainX) - 14);
      }

      if (remChars <= 0 && this.revealedCharCount < this.totalLineChars && !activeRevealCursorDrawn) {
        activeRevealCursorDrawn = true;
        const tw = ctx.measureText(shownText).width;
        ctx.fillStyle = '#FFB000';
        ctx.fillRect(textLeft + tw + 4, curY - fontPx + 2, Math.round(fontPx * 0.62), fontPx);
      }

      curY += line.text.length === 0 ? Math.round(lineStep * 0.48) : lineStep;
    }

    // Live Animated Movie Sequence Panes (BIOSCAN chest scan OR SIGNAL Fourier waveform!)
    if (this.bioscanActive) {
      this.renderBioscanOverlay(ctx, textLeft, contentBottom - 164, mainW - 44, 118, timeSec);
    } else if (this.signalActive) {
      this.renderSignalDecodeOverlay(ctx, textLeft, contentBottom - 164, mainW - 44, 118, timeSec);
    }

    // Live Interactive Command Prompt Row: `MU-TH-UR> █`
    if (this.revealedCharCount >= this.totalLineChars) {
      const promptY = Math.min(contentBottom - 18, Math.max(curY + 4, contentBottom - 26));
      const promptPrefix = this.destructActive ? 'ABORT?> ' : 'MU-TH-UR> ';
      ctx.font = `bold ${fontPx + 1}px "JetBrains Mono", monospace`;
      ctx.fillStyle = this.destructActive ? COLORS.RED_KLAXON : '#44FF77';
      ctx.fillText(promptPrefix, textLeft, promptY);

      const prefixW = ctx.measureText(promptPrefix).width;
      ctx.fillStyle = '#FFB000';
      ctx.fillText(this.inputBuffer, textLeft + prefixW, promptY);

      const inputW = ctx.measureText(this.inputBuffer).width;
      const cursorBlink = Math.sin(timeSec * 9.5) > -0.15 || this.autoTypeQueue.length > 0;
      if (cursorBlink) {
        ctx.fillStyle = this.destructActive ? COLORS.RED_KLAXON : '#44FF77';
        ctx.fillRect(
          textLeft + prefixW + inputW + 3,
          promptY - fontPx + 1,
          Math.max(10, Math.round(fontPx * 0.64)),
          fontPx + 2
        );
      }

      this.hitBoxes.push({
        id: 'prompt-input-line',
        rect: {
          x: textLeft - 4,
          y: promptY - fontPx - 6,
          width: mainW - 36,
          height: fontPx + 16,
        },
        action: () => this.focusMobileKeyboard(),
      });
    }

    // =========================================================================
    // SIGNIFICANTLY LARGER BOTTOM QUICK-COMMAND BUTTON DECK!
    // =========================================================================
    const quickChips: Array<{ id: string; label: string; cmd: string; accent: string }> =
      this.destructActive
        ? [
            { id: 'chip-abort', label: '⚠ ABORT SELF-DESTRUCT ⚠', cmd: 'ABORT', accent: COLORS.RED_KLAXON },
          ]
        : [
            { id: 'chip-run-1', label: '[1] LANDER', cmd: 'RUN 1', accent: '#44FF77' },
            { id: 'chip-run-2', label: '[2] PERIMETER', cmd: 'RUN 2', accent: '#FFB000' },
            { id: 'chip-run-3', label: '[3] FLAK NET', cmd: 'RUN 3', accent: '#8EF5AB' },
            { id: 'chip-run-4', label: '[4] VECTOR RUN', cmd: 'RUN 4', accent: '#FFF6CC' },
            { id: 'chip-scores', label: '[SCORES]', cmd: 'SCORES', accent: '#FFB000' },
            { id: 'chip-bioscan', label: '[BIOSCAN]', cmd: 'BIOSCAN', accent: '#44FF77' },
            { id: 'chip-signal', label: '[SIGNAL]', cmd: 'SIGNAL', accent: '#8EF5AB' },
            { id: 'chip-destruct', label: '[DESTRUCT]', cmd: 'DESTRUCT', accent: COLORS.RED_KLAXON },
            { id: 'chip-help', label: '[HELP]', cmd: 'HELP', accent: '#44FF77' },
          ];

    const deckX = mainX;
    const deckW = w - pad * 2 - 32;
    const deckY = contentBottom + 10;
    const twoRows = w < 1120 && quickChips.length > 1;
    const rowCount = twoRows ? 2 : 1;
    const perRow = twoRows ? Math.ceil(quickChips.length / 2) : quickChips.length;
    const gap = 9;
    const btnH = twoRows ? 48 : 50;

    for (let r = 0; r < rowCount; r++) {
      const slice = quickChips.slice(r * perRow, (r + 1) * perRow);
      const count = slice.length;
      if (count === 0) continue;
      const bw = Math.floor((deckW - gap * (count - 1)) / count);
      const by = deckY + r * (btnH + 8);

      for (let c = 0; c < count; c++) {
        const chip = slice[c];
        const rect: ViewportRect = {
          x: deckX + c * (bw + gap),
          y: by,
          width: bw,
          height: btnH,
        };
        this.hitBoxes.push({ id: chip.id, rect, autoTypeCmd: chip.cmd });
        const hov = this.hoveredHitId === chip.id;

        ctx.fillStyle = hov
          ? 'rgba(255, 176, 0, 0.28)'
          : chip.accent === COLORS.RED_KLAXON
            ? 'rgba(42, 8, 6, 0.92)'
            : 'rgba(6, 20, 11, 0.94)';
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        ctx.strokeStyle = hov ? '#FFFFFF' : chip.accent;
        ctx.lineWidth = hov ? 2.6 : 1.9;
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

        const btnFontPx = bw < 115 ? 14 : 16.5;
        ctx.font = `bold ${btnFontPx}px "Share Tech Mono", monospace`;
        ctx.fillStyle = hov ? '#FFFFFF' : chip.accent;
        ctx.textAlign = 'center';
        ctx.fillText(
          chip.label,
          rect.x + rect.width * 0.5,
          rect.y + rect.height * 0.5 + btnFontPx * 0.35,
          rect.width - 10
        );
      }
    }

    // Optional Right-Side Nostromo Auxiliary Telemetry & BIGGER Clickable Cartridge Slots!
    if (showAuxRack) {
      const auxX = mainX + mainW + 16;
      this.renderAuxiliaryMainframeRack(ctx, auxX, contentTop, auxW, contentH, timeSec);
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
    ctx.fillStyle = 'rgba(3, 14, 8, 0.95)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = p > 0.72 ? COLORS.RED_KLAXON : '#44FF77';
    ctx.lineWidth = 2.0;
    ctx.strokeRect(x, y, w, h);

    // Creepy vector ribcage + parasitic anomaly silhouette on left
    const cx = x + 68;
    const cy = y + h * 0.52;
    ctx.strokeStyle = '#44FF77';
    ctx.lineWidth = 1.6;
    for (let r = -3; r <= 3; r++) {
      const ry = cy + r * 11;
      const rw = 36 - Math.abs(r) * 4;
      ctx.beginPath();
      ctx.ellipse(cx, ry, rw, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Pulsing parasitic embryo anomaly detected inside thorax!
    if (p > 0.32) {
      const anomPulse = 0.65 + 0.35 * Math.sin(timeSec * 22);
      ctx.strokeStyle = `rgba(255, 68, 34, ${anomPulse.toFixed(2)})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(cx + 4, cy + 4, 14, 0, Math.PI * 2);
      ctx.moveTo(cx + 4, cy + 18);
      ctx.quadraticCurveTo(cx + 22, cy + 28, cx + 10, cy + 40);
      ctx.stroke();
    }

    // Sweeping vertical phosphor scanner bar across thorax
    const scanY = y + 8 + p * (h - 16);
    ctx.strokeStyle = '#FFF6CC';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x + 12, scanY);
    ctx.lineTo(x + 126, scanY);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(`MEDBAY AUTO-DOC // THORACIC SCAN ${Math.round(p * 100)}%`, x + 144, y + 28);
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillStyle = p > 0.55 ? COLORS.RED_KLAXON : '#8EF5AB';
    ctx.fillText('SUBJECT: EXEC. OFFICER KANE // RESPIRATORY TRACT', x + 144, y + 54);
    ctx.fillText(
      p > 0.45
        ? 'BIO-MASS DENSITY: SILICON-CARBON EXOSKELETON DETECTED'
        : 'MAPPING PULMONARY ARTERIES & STERNUM...',
      x + 144,
      y + 78,
      w - 156
    );
    ctx.fillStyle = '#FFB000';
    ctx.fillText(
      p > 0.72 ? 'WARNING: MOLECULAR ACID HEMOLYMPH — DO NOT CUT!' : 'ANALYZING CELLULAR STRUCTURE...',
      x + 144,
      y + 102,
      w - 156
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
    ctx.fillStyle = 'rgba(4, 12, 8, 0.95)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#FFB000';
    ctx.lineWidth = 2.0;
    ctx.strokeRect(x, y, w, h);

    ctx.textAlign = 'left';
    ctx.font = 'bold 14px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(
      `LV-426 ACOUSTIC BEACON // FOURIER DECODE ${Math.round(p * 100)}% [INTERVAL: 12.0S]`,
      x + 14,
      y + 24
    );

    // Live animated oscilloscope modulated beacon waveform!
    const waveTop = y + 36;
    const waveH = h - 54;
    const midY = waveTop + waveH * 0.5;
    ctx.strokeStyle = '#44FF77';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    const samples = 88;
    for (let i = 0; i <= samples; i++) {
      const f = i / samples;
      const px = x + 14 + f * (w - 28);
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

    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText(
      p > 0.65
        ? 'SYNTAX MATCH: NON-HUMAN ACOUSTIC WARNING PATTERN IDENTIFIED'
        : 'ISOLATING CARRIER HARMONICS FROM ATMOSPHERIC STATIC...',
      x + 14,
      y + h - 10
    );
    ctx.restore();
  }

  private renderAuxiliaryMainframeRack(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    timeSec: number
  ): void {
    ctx.save();
    ctx.fillStyle = 'rgba(4, 11, 7, 0.88)';
    ctx.fillRect(x, y, w, h);
    this.drawCornerBrackets(ctx, x, y, w, h, 18, COLORS.AMBER_CAUTION, 2.2);

    ctx.textAlign = 'left';
    ctx.font = 'bold 16.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('MU-TH-UR // TELEMETRY BUS', x + 14, y + 27);

    ctx.strokeStyle = COLORS.AMBER_DIM;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 14, y + 36);
    ctx.lineTo(x + w - 14, y + 36);
    ctx.stroke();

    // Dual Animated Magnetic Tape Reels Vector Graphic (compact cleanly at top to give big room for Slot Cards!)
    const reelY = y + 76;
    const reelR = 24;
    const r1X = x + w * 0.31;
    const r2X = x + w * 0.69;
    const spin = timeSec * (this.destructActive ? 4.5 : 1.35);

    [r1X, r2X].forEach((rx, idx) => {
      const ang = idx === 0 ? spin : -spin * 0.85;
      ctx.strokeStyle = COLORS.GREEN_PRIMARY;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(rx, reelY, reelR, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = COLORS.GREEN_DIM;
      ctx.beginPath();
      ctx.arc(rx, reelY, reelR * 0.36, 0, Math.PI * 2);
      ctx.stroke();

      for (let s = 0; s < 3; s++) {
        const sa = ang + (s * Math.PI * 2) / 3;
        ctx.strokeStyle = '#FFB000';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(rx + Math.cos(sa) * 7, reelY + Math.sin(sa) * 7);
        ctx.lineTo(rx + Math.cos(sa) * (reelR - 4), reelY + Math.sin(sa) * (reelR - 4));
        ctx.stroke();
      }
    });

    ctx.strokeStyle = COLORS.AMBER_BRIGHT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(r1X, reelY + reelR);
    ctx.lineTo(x + w * 0.5, reelY + reelR + 8);
    ctx.lineTo(r2X, reelY + reelR);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText('TAPE DRIVE 01-B // LOCKED', x + w * 0.5, reelY + reelR + 23);

    // Compact Live 64K Core Memory Hex Matrix (4 crisp rows)
    const regTop = reelY + reelR + 40;
    ctx.textAlign = 'left';
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.GREEN_BRIGHT;
    ctx.fillText('CORE 64K // HEX MONITOR', x + 14, regTop);

    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    const step = Math.floor(timeSec * 6);
    const hexRows = h > 620 ? 5 : 3;
    for (let r = 0; r < hexRows; r++) {
      const addr = (0x2037 + r * 16).toString(16).toUpperCase();
      const b0 = (((step + r * 41) * 251) & 0xff).toString(16).toUpperCase().padStart(2, '0');
      const b1 = (((step + r * 19) * 509) & 0xff).toString(16).toUpperCase().padStart(2, '0');
      const b2 = (((step + r * 73) * 811) & 0xff).toString(16).toUpperCase().padStart(2, '0');
      const b3 = (((step + r * 11) * 397) & 0xff).toString(16).toUpperCase().padStart(2, '0');
      ctx.fillStyle = r === step % hexRows ? '#FFB000' : COLORS.GREEN_PRIMARY;
      ctx.fillText(`${addr}: ${b0} ${b1} ${b2} ${b3}`, x + 14, regTop + 18 + r * 17);
    }

    // =========================================================================
    // SIGNIFICANTLY BIGGER, CLICKABLE CARTRIDGE LAUNCH CARDS (SLOT 01 .. 04)!
    // Fills the rest of the Telemetry Bus cleanly with bold, easy-to-hit cards!
    // =========================================================================
    const cardsAreaTop = regTop + 26 + hexRows * 17;
    const cardsAreaBottom = y + h - 12;
    const cardsAvailH = Math.max(160, cardsAreaBottom - cardsAreaTop);
    const cardGap = 10;
    const cardH = Math.max(48, Math.min(84, Math.floor((cardsAvailH - cardGap * 3 - 22) / 4)));

    ctx.font = 'bold 13px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('SIMULATION CARTRIDGE SLOTS [CLICK]:', x + 14, cardsAreaTop + 10);

    const slotSub = (id: CartridgeProgramId): string => {
      const st = this.hubLeaders.getLeaderState(id);
      if (st.leader) {
        return `TOP: ${st.leader.callsign} // ${st.leader.score.toLocaleString()}`;
      }
      return st.status === 'LOADING' ? 'SYNCING UPLINK...' : 'RECORD UNCLAIMED';
    };

    const cards: Array<{
      id: string;
      cmd: string;
      title: string;
      rankedTag: string;
      sub: string;
      col: string;
    }> = [
      {
        id: 'slot-card-1',
        cmd: 'RUN 1',
        title: 'SLOT 01: LUNAR LANDER',
        rankedTag: '★ RANKED: 6-SEC / ENDLESS',
        sub: slotSub('lander'),
        col: '#44FF77',
      },
      {
        id: 'slot-card-2',
        cmd: 'RUN 2',
        title: 'SLOT 02: PERIMETER CAD',
        rankedTag: '★ RANKED: ENDLESS SIEGE',
        sub: slotSub('perimeter'),
        col: '#FFB000',
      },
      {
        id: 'slot-card-3',
        cmd: 'RUN 3',
        title: 'SLOT 03: FLAK NET RADAR',
        rankedTag: '★ RANKED: ARCADE WAVES',
        sub: slotSub('flak'),
        col: '#8EF5AB',
      },
      {
        id: 'slot-card-4',
        cmd: 'RUN 4',
        title: 'SLOT 04: DERELICT TRENCH',
        rankedTag: '★ RANKED: JET SORTIE',
        sub: slotSub('trench'),
        col: '#FFF6CC',
      },
    ];

    const startCardY = cardsAreaTop + 20;
    cards.forEach((c, idx) => {
      const cy = startCardY + idx * (cardH + cardGap);
      const rect: ViewportRect = { x: x + 12, y: cy, width: w - 24, height: cardH };
      this.hitBoxes.push({ id: c.id, rect, autoTypeCmd: c.cmd });
      const hov = this.hoveredHitId === c.id;

      ctx.fillStyle = hov ? 'rgba(255, 176, 0, 0.24)' : 'rgba(10, 26, 15, 0.84)';
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = hov ? '#FFFFFF' : c.col;
      ctx.lineWidth = hov ? 2.4 : 1.8;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

      const titleFont = cardH >= 64 ? 16 : 14.5;
      const rankFont = cardH >= 64 ? 12 : 11;
      const subFont = cardH >= 64 ? 13 : 12;

      ctx.textAlign = 'left';
      ctx.font = `bold ${titleFont}px "Share Tech Mono", monospace`;
      ctx.fillStyle = hov ? '#FFFFFF' : c.col;
      ctx.fillText(
        hov ? `► ${c.title}` : c.title,
        rect.x + 12,
        rect.y + Math.round(cardH * 0.34),
        rect.width - 24
      );

      ctx.font = `bold ${rankFont}px "Share Tech Mono", monospace`;
      ctx.fillStyle = '#FFE28A';
      ctx.fillText(
        c.rankedTag,
        rect.x + 12,
        rect.y + Math.round(cardH * 0.61),
        rect.width - 24
      );

      ctx.font = `bold ${subFont}px "JetBrains Mono", monospace`;
      ctx.fillStyle = hov ? '#FFF6CC' : '#FFB000';
      ctx.fillText(c.sub, rect.x + 12, rect.y + Math.round(cardH * 0.87), rect.width - 24);
    });

    ctx.restore();
  }

  private drawCornerBrackets(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    len: number,
    color: string,
    lineWidth: number
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x, y + len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);

    ctx.moveTo(x + w - len, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + len);

    ctx.moveTo(x, y + h - len);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + len, y + h);

    ctx.moveTo(x + w - len, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - len);
    ctx.stroke();
  }
}
