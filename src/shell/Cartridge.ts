import type { AudioEngine } from '../audio/AudioEngine';
import type { WebGLCRT } from '../render/WebGLCRT';
import type { SafeAreaInsets, ViewportRect } from '../types';

export type CartridgeProgramId = 'lander' | 'perimeter' | 'flak' | 'trench';

export type PhosphorTheme = 'GREEN' | 'AMBER' | 'CYAN';

export interface CrtShockwaveUniform {
  /** Normalized CRT screen X in [0..1] (0 = left, 1 = right) */
  uvX: number;
  /** Normalized CRT screen Y in [0..1] (0 = top canvas, 1 = bottom canvas; flipped for WebGL) */
  uvY: number;
  /** Shockwave radius in normalized height units (aspect-corrected in shader) */
  radius: number;
  /** Displacement/bloom intensity [0..1] (0 = inactive) */
  intensity: number;
}

export interface CrtShaderFrameParams {
  interference: number;
  glitch: number;
  overdrive: number;
  tubeTurnOn: number;
  /** Optional chromatic aberration scale [0..1] (defaults to 1.0; lowered in text-dense CAD views) */
  chromaScale?: number;
  shockwaves?: readonly CrtShockwaveUniform[];
}

export interface HostEnvironment {
  readonly audio: AudioEngine;
  readonly webglCrt: WebGLCRT;
  readonly srLiveRegion: HTMLElement | null;
  getViewport(): {
    width: number;
    height: number;
    dpr: number;
    offsetX: number;
    offsetY: number;
    crtRect: ViewportRect;
    safeAreaInsets: SafeAreaInsets;
    isFullscreen: boolean;
    mobileMode: boolean;
  };
  getCrtIntensity(): number;
  getPhosphorTheme(): PhosphorTheme;
  setPhosphorTheme(theme: PhosphorTheme): void;
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  toggleFullscreen(): void;
  triggerSyncGlitch(intensity?: number): void;
  launchProgram(program: CartridgeProgramId): void;
  exitToMuthurOs(reasonLog?: string): void;
  coldRebootMuthur(): void;
}

export interface Cartridge {
  readonly id: string;
  mount(): void;
  unmount(): void;
  resize(width: number, height: number, offsetX: number, offsetY: number): void;
  setBackgroundPaused(paused: boolean): void;
  updateAndRender(
    dt: number,
    ctx: CanvasRenderingContext2D,
    totalTimeSec: number
  ): CrtShaderFrameParams;
}
