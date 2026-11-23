import { COLORS } from '../constants';
import type { Vec2 } from '../types';
import type { CrtInteractiveButton } from './HudRenderer';

export type BootSequenceMode =
  | 'HARDWARE_HANDSHAKE'
  | 'LANDER_LAUNCH'
  | 'PERIMETER_LAUNCH'
  | 'FLAK_LAUNCH'
  | 'TRENCH_LAUNCH';

export const BOOT_TIMING = {
  FLASH_END_SEC: 0.88,
  LOGO_DRAW_END_SEC: 4.55,
  LOGO_HOLD_END_SEC: 5.45,
  PROTOCOL_START_SEC: 5.95,
} as const;

export const CARTRIDGE_LAUNCH_TIMING = {
  FLASH_END_SEC: 0.28,
  DRAW_END_SEC: 3.15,
  HOLD_END_SEC: 3.85,
  COMPLETE_SEC: 4.25,
} as const;

interface MeasuredPath {
  points: Vec2[];
  cumLengths: number[];
  totalLength: number;
}

interface GlyphSpec {
  widthFactor: number;
  contours: Array<Array<[number, number]>>;
}

/**
 * Hand-crafted Ron Cobb / 1979 ALIEN (USCSS Nostromo) double-walled outlined geometric
 * CAD vector glyphs on a normalized [0..1] x [0..1] grid.
 * Full alphanumeric + technical punctuation set traced by the live CRT electron beam.
 */
const WX = 0.21;
const HY = 0.155;
const CH = 0.125;

const NOSTROMO_VECTOR_GLYPHS: Record<string, GlyphSpec> = {
  A: {
    widthFactor: 1.02,
    contours: [
      [
        [0, 1],
        [0, CH],
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 1],
        [1 - WX, 1],
        [1 - WX, 0.59],
        [WX, 0.59],
        [WX, 1],
        [0, 1],
      ],
      [
        [WX, HY],
        [1 - WX, HY],
        [1 - WX, 0.44],
        [WX, 0.44],
        [WX, HY],
      ],
    ],
  },
  B: {
    widthFactor: 1.0,
    contours: [
      [
        [0, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 0.43],
        [0.88, 0.5],
        [1, 0.57],
        [1, 1 - CH],
        [1 - CH, 1],
        [0, 1],
        [0, 0],
      ],
      [
        [WX, HY],
        [1 - WX, HY],
        [1 - WX, 0.42],
        [WX, 0.42],
        [WX, HY],
      ],
      [
        [WX, 0.58],
        [1 - WX, 0.58],
        [1 - WX, 1 - HY],
        [WX, 1 - HY],
        [WX, 0.58],
      ],
    ],
  },
  C: {
    widthFactor: 0.96,
    contours: [
      [
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 0.28],
        [1 - WX, 0.28],
        [1 - WX, HY],
        [WX, HY],
        [WX, 1 - HY],
        [1 - WX, 1 - HY],
        [1 - WX, 0.72],
        [1, 0.72],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, CH],
        [CH, 0],
      ],
    ],
  },
  D: {
    widthFactor: 1.02,
    contours: [
      [
        [0, 0],
        [1 - CH * 1.45, 0],
        [1, CH * 1.45],
        [1, 1 - CH * 1.45],
        [1 - CH * 1.45, 1],
        [0, 1],
        [0, 0],
      ],
      [
        [WX, HY],
        [1 - WX - 0.04, HY],
        [1 - WX, HY + 0.05],
        [1 - WX, 1 - HY - 0.05],
        [1 - WX - 0.04, 1 - HY],
        [WX, 1 - HY],
        [WX, HY],
      ],
    ],
  },
  E: {
    widthFactor: 0.95,
    contours: [
      [
        [0, 0],
        [1, 0],
        [1, HY],
        [WX, HY],
        [WX, 0.425],
        [0.84, 0.425],
        [0.84, 0.575],
        [WX, 0.575],
        [WX, 1 - HY],
        [1, 1 - HY],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  },
  F: {
    widthFactor: 0.93,
    contours: [
      [
        [0, 0],
        [1, 0],
        [1, HY],
        [WX, HY],
        [WX, 0.43],
        [0.82, 0.43],
        [0.82, 0.58],
        [WX, 0.58],
        [WX, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  },
  G: {
    widthFactor: 1.0,
    contours: [
      [
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 0.27],
        [1 - WX, 0.27],
        [1 - WX, HY],
        [WX, HY],
        [WX, 1 - HY],
        [1 - WX, 1 - HY],
        [1 - WX, 0.62],
        [0.54, 0.62],
        [0.54, 0.47],
        [1, 0.47],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, CH],
        [CH, 0],
      ],
    ],
  },
  H: {
    widthFactor: 1.0,
    contours: [
      [
        [0, 0],
        [WX, 0],
        [WX, 0.42],
        [1 - WX, 0.42],
        [1 - WX, 0],
        [1, 0],
        [1, 1],
        [1 - WX, 1],
        [1 - WX, 0.58],
        [WX, 0.58],
        [WX, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  },
  I: {
    widthFactor: 0.52,
    contours: [
      [
        [0.08, 0],
        [0.92, 0],
        [0.92, HY],
        [0.68, HY],
        [0.68, 1 - HY],
        [0.92, 1 - HY],
        [0.92, 1],
        [0.08, 1],
        [0.08, 1 - HY],
        [0.32, 1 - HY],
        [0.32, HY],
        [0.08, HY],
        [0.08, 0],
      ],
    ],
  },
  J: {
    widthFactor: 0.92,
    contours: [
      [
        [1 - WX, 0],
        [1, 0],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, 0.68],
        [WX, 0.68],
        [WX, 1 - HY],
        [1 - WX, 1 - HY],
        [1 - WX, 0],
      ],
    ],
  },
  K: {
    widthFactor: 1.0,
    contours: [
      [
        [0, 0],
        [WX, 0],
        [WX, 0.42],
        [0.74, 0],
        [1, 0],
        [0.52, 0.49],
        [1, 1],
        [0.74, 1],
        [WX, 0.58],
        [WX, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  },
  L: {
    widthFactor: 0.94,
    contours: [
      [
        [0, 0],
        [WX, 0],
        [WX, 1 - HY],
        [1, 1 - HY],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  },
  M: {
    widthFactor: 1.14,
    contours: [
      [
        [0, 0],
        [0.22, 0],
        [0.5, 0.46],
        [0.78, 0],
        [1, 0],
        [1, 1],
        [1 - WX * 0.9, 1],
        [1 - WX * 0.9, 0.36],
        [0.56, 0.72],
        [0.44, 0.72],
        [WX * 0.9, 0.36],
        [WX * 0.9, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  },
  N: {
    widthFactor: 1.04,
    contours: [
      [
        [0, 0],
        [WX, 0],
        [1 - WX, 0.63],
        [1 - WX, 0],
        [1, 0],
        [1, 1],
        [1 - WX, 1],
        [WX, 0.37],
        [WX, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  },
  O: {
    widthFactor: 1.0,
    contours: [
      [
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, CH],
        [CH, 0],
      ],
      [
        [WX, HY],
        [1 - WX, HY],
        [1 - WX, 1 - HY],
        [WX, 1 - HY],
        [WX, HY],
      ],
    ],
  },
  P: {
    widthFactor: 0.98,
    contours: [
      [
        [0, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 0.46],
        [1 - CH, 0.58],
        [WX, 0.58],
        [WX, 1],
        [0, 1],
        [0, 0],
      ],
      [
        [WX, HY],
        [1 - WX, HY],
        [1 - WX, 0.42],
        [WX, 0.42],
        [WX, HY],
      ],
    ],
  },
  Q: {
    widthFactor: 1.02,
    contours: [
      [
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 0.78],
        [0.88, 0.9],
        [1, 1],
        [0.78, 1],
        [0.68, 0.92],
        [CH, 1],
        [0, 1 - CH],
        [0, CH],
        [CH, 0],
      ],
      [
        [WX, HY],
        [1 - WX, HY],
        [1 - WX, 1 - HY],
        [WX, 1 - HY],
        [WX, HY],
      ],
    ],
  },
  R: {
    widthFactor: 1.02,
    contours: [
      [
        [0, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 0.44],
        [1 - CH, 0.54],
        [0.68, 0.54],
        [1, 1],
        [0.77, 1],
        [0.46, 0.54],
        [WX, 0.54],
        [WX, 1],
        [0, 1],
        [0, 0],
      ],
      [
        [WX, HY],
        [1 - WX, HY],
        [1 - WX, 0.4],
        [WX, 0.4],
        [WX, HY],
      ],
    ],
  },
  S: {
    widthFactor: 0.98,
    contours: [
      [
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 0.26],
        [1 - WX, 0.26],
        [1 - WX, HY],
        [WX, HY],
        [WX, 0.42],
        [1 - CH, 0.42],
        [1, 0.54],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, 0.74],
        [WX, 0.74],
        [WX, 1 - HY],
        [1 - WX, 1 - HY],
        [1 - WX, 0.58],
        [CH, 0.58],
        [0, 0.46],
        [0, CH],
        [CH, 0],
      ],
    ],
  },
  T: {
    widthFactor: 0.96,
    contours: [
      [
        [0, 0],
        [1, 0],
        [1, HY],
        [0.5 + WX * 0.5, HY],
        [0.5 + WX * 0.5, 1],
        [0.5 - WX * 0.5, 1],
        [0.5 - WX * 0.5, HY],
        [0, HY],
        [0, 0],
      ],
    ],
  },
  U: {
    widthFactor: 1.0,
    contours: [
      [
        [0, 0],
        [WX, 0],
        [WX, 1 - HY],
        [1 - WX, 1 - HY],
        [1 - WX, 0],
        [1, 0],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, 0],
      ],
    ],
  },
  V: {
    widthFactor: 1.02,
    contours: [
      [
        [0, 0],
        [WX, 0],
        [0.5, 0.76],
        [1 - WX, 0],
        [1, 0],
        [0.61, 1],
        [0.39, 1],
        [0, 0],
      ],
    ],
  },
  W: {
    widthFactor: 1.16,
    contours: [
      [
        [0, 0],
        [0.19, 0],
        [0.32, 0.72],
        [0.44, 0.28],
        [0.56, 0.28],
        [0.68, 0.72],
        [0.81, 0],
        [1, 0],
        [0.78, 1],
        [0.6, 1],
        [0.5, 0.62],
        [0.4, 1],
        [0.22, 1],
        [0, 0],
      ],
    ],
  },
  X: {
    widthFactor: 1.0,
    contours: [
      [
        [0, 0],
        [0.24, 0],
        [0.5, 0.37],
        [0.76, 0],
        [1, 0],
        [0.63, 0.5],
        [1, 1],
        [0.76, 1],
        [0.5, 0.63],
        [0.24, 1],
        [0, 1],
        [0.37, 0.5],
        [0, 0],
      ],
    ],
  },
  Y: {
    widthFactor: 0.98,
    contours: [
      [
        [0, 0],
        [0.24, 0],
        [0.5, 0.42],
        [0.76, 0],
        [1, 0],
        [0.5 + WX * 0.5, 0.58],
        [0.5 + WX * 0.5, 1],
        [0.5 - WX * 0.5, 1],
        [0.5 - WX * 0.5, 0.58],
        [0, 0],
      ],
    ],
  },
  Z: {
    widthFactor: 0.96,
    contours: [
      [
        [0, 0],
        [1, 0],
        [1, HY],
        [0.28, 1 - HY],
        [1, 1 - HY],
        [1, 1],
        [0, 1],
        [0, 1 - HY],
        [0.72, HY],
        [0, HY],
        [0, 0],
      ],
    ],
  },
  '0': {
    widthFactor: 1.0,
    contours: [
      [
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, CH],
        [CH, 0],
      ],
      [
        [WX, HY],
        [1 - WX, HY],
        [1 - WX, 1 - HY],
        [WX, 1 - HY],
        [WX, HY],
      ],
    ],
  },
  '1': {
    widthFactor: 0.54,
    contours: [
      [
        [0.1, 0.14],
        [0.44, 0],
        [0.82, 0],
        [0.82, 1],
        [0.4, 1],
        [0.4, 0.25],
        [0.1, 0.29],
        [0.1, 0.14],
      ],
    ],
  },
  '2': {
    widthFactor: 1.0,
    contours: [
      [
        [0, CH],
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 0.46],
        [1 - CH, 0.56],
        [WX, 0.56],
        [WX, 1 - HY],
        [1, 1 - HY],
        [1, 1],
        [0, 1],
        [0, 0.52],
        [CH, 0.42],
        [1 - WX, 0.42],
        [1 - WX, HY],
        [WX, HY],
        [WX, 0.25],
        [0, 0.25],
        [0, CH],
      ],
    ],
  },
  '3': {
    widthFactor: 0.98,
    contours: [
      [
        [0, CH],
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 0.43],
        [0.86, 0.5],
        [1, 0.57],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, 0.74],
        [WX, 0.74],
        [WX, 1 - HY],
        [1 - WX, 1 - HY],
        [1 - WX, 0.57],
        [0.34, 0.57],
        [0.34, 0.43],
        [1 - WX, 0.43],
        [1 - WX, HY],
        [WX, HY],
        [WX, 0.26],
        [0, 0.26],
        [0, CH],
      ],
    ],
  },
  '4': {
    widthFactor: 1.0,
    contours: [
      [
        [0.55, 0],
        [0.78, 0],
        [0.78, 0.56],
        [1, 0.56],
        [1, 0.71],
        [0.78, 0.71],
        [0.78, 1],
        [0.57, 1],
        [0.57, 0.71],
        [0, 0.71],
        [0, 0.55],
        [0.55, 0],
      ],
      [
        [0.57, 0.24],
        [0.57, 0.56],
        [0.22, 0.56],
        [0.57, 0.24],
      ],
    ],
  },
  '5': {
    widthFactor: 0.98,
    contours: [
      [
        [0, 0],
        [1, 0],
        [1, HY],
        [WX, HY],
        [WX, 0.4],
        [1 - CH, 0.4],
        [1, 0.52],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, 0.74],
        [WX, 0.74],
        [WX, 1 - HY],
        [1 - WX, 1 - HY],
        [1 - WX, 0.55],
        [0, 0.55],
        [0, 0],
      ],
    ],
  },
  '6': {
    widthFactor: 1.0,
    contours: [
      [
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 0.26],
        [1 - WX, 0.26],
        [1 - WX, HY],
        [WX, HY],
        [WX, 0.44],
        [1 - CH, 0.44],
        [1, 0.54],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, CH],
        [CH, 0],
      ],
      [
        [WX, 0.58],
        [1 - WX, 0.58],
        [1 - WX, 1 - HY],
        [WX, 1 - HY],
        [WX, 0.58],
      ],
    ],
  },
  '7': {
    widthFactor: 0.96,
    contours: [
      [
        [0, 0],
        [1, 0],
        [1, HY],
        [0.46, 1],
        [0.22, 1],
        [0.74, HY],
        [0, HY],
        [0, 0],
      ],
    ],
  },
  '8': {
    widthFactor: 1.0,
    contours: [
      [
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 0.43],
        [0.89, 0.5],
        [1, 0.57],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, 0.57],
        [0.11, 0.5],
        [0, 0.43],
        [0, CH],
        [CH, 0],
      ],
      [
        [WX, HY],
        [1 - WX, HY],
        [1 - WX, 0.425],
        [WX, 0.425],
        [WX, HY],
      ],
      [
        [WX, 0.575],
        [1 - WX, 0.575],
        [1 - WX, 1 - HY],
        [WX, 1 - HY],
        [WX, 0.575],
      ],
    ],
  },
  '9': {
    widthFactor: 1.0,
    contours: [
      [
        [CH, 0],
        [1 - CH, 0],
        [1, CH],
        [1, 1 - CH],
        [1 - CH, 1],
        [CH, 1],
        [0, 1 - CH],
        [0, 0.74],
        [WX, 0.74],
        [WX, 1 - HY],
        [1 - WX, 1 - HY],
        [1 - WX, 0.56],
        [CH, 0.56],
        [0, 0.46],
        [0, CH],
        [CH, 0],
      ],
      [
        [WX, HY],
        [1 - WX, HY],
        [1 - WX, 0.42],
        [WX, 0.42],
        [WX, HY],
      ],
    ],
  },
  "'": {
    widthFactor: 0.34,
    contours: [
      [
        [0.25, 0],
        [0.75, 0],
        [0.62, 0.34],
        [0.25, 0.34],
        [0.25, 0],
      ],
    ],
  },
  '-': {
    widthFactor: 0.62,
    contours: [
      [
        [0.08, 0.43],
        [0.92, 0.43],
        [0.92, 0.57],
        [0.08, 0.57],
        [0.08, 0.43],
      ],
    ],
  },
  '/': {
    widthFactor: 0.58,
    contours: [
      [
        [0.72, 0],
        [0.96, 0],
        [0.28, 1],
        [0.04, 1],
        [0.72, 0],
      ],
    ],
  },
  ':': {
    widthFactor: 0.36,
    contours: [
      [
        [0.22, 0.22],
        [0.78, 0.22],
        [0.78, 0.38],
        [0.22, 0.38],
        [0.22, 0.22],
      ],
      [
        [0.22, 0.62],
        [0.78, 0.62],
        [0.78, 0.78],
        [0.22, 0.78],
        [0.22, 0.62],
      ],
    ],
  },
  '.': {
    widthFactor: 0.36,
    contours: [
      [
        [0.22, 0.8],
        [0.78, 0.8],
        [0.78, 1.0],
        [0.22, 1.0],
        [0.22, 0.8],
      ],
    ],
  },
};

export interface BootLogoRenderParams {
  width: number;
  height: number;
  timeSec: number;
  bootPoweredOn: boolean;
  mobileMode: boolean;
  bootElapsedSec: number;
  bootProgressChars: number;
  bootLines: readonly string[];
  hoveredButtonId: string | null;
  buttonsOut: CrtInteractiveButton[];
  sequenceMode?: BootSequenceMode;
}

interface DualChannelEmblem {
  chA: MeasuredPath[];
  lenA: number;
  chB: MeasuredPath[];
  lenB: number;
}

export class BootLogoRenderer {
  private handshakeEmblem!: DualChannelEmblem;
  private landerEmblem!: DualChannelEmblem;
  private perimeterEmblem!: DualChannelEmblem;
  private flakEmblem!: DualChannelEmblem;
  private trenchEmblem!: DualChannelEmblem;

  constructor() {
    this.handshakeEmblem = this.buildHandshakeEmblem();
    this.landerEmblem = this.buildLanderEmblem();
    this.perimeterEmblem = this.buildPerimeterEmblem();
    this.flakEmblem = this.buildFlakEmblem();
    this.trenchEmblem = this.buildTrenchEmblem();
  }

  private measurePath(pts: Array<[number, number]>): MeasuredPath {
    const points: Vec2[] = pts.map(([x, y]) => ({ x, y }));
    const cumLengths: number[] = [0];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      cumLengths.push(total);
    }
    return { points, cumLengths, totalLength: total };
  }

  private finalizeEmblem(chA: MeasuredPath[], chB: MeasuredPath[]): DualChannelEmblem {
    return {
      chA,
      lenA: chA.reduce((acc, p) => acc + p.totalLength, 0),
      chB,
      lenB: chB.reduce((acc, p) => acc + p.totalLength, 0),
    };
  }

  private appendTextContours(
    target: MeasuredPath[],
    text: string,
    leftX: number,
    rightX: number,
    topY: number,
    height: number,
    gapRatio = 0.21
  ): void {
    const chars = Array.from(text.toUpperCase());
    let unitSum = 0;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === ' ') {
        unitSum += 0.56;
      } else {
        unitSum += NOSTROMO_VECTOR_GLYPHS[ch]?.widthFactor ?? 1.0;
      }
      if (i < chars.length - 1 && ch !== ' ' && chars[i + 1] !== ' ') {
        unitSum += gapRatio;
      } else if (i < chars.length - 1) {
        unitSum += gapRatio * 0.55;
      }
    }

    const availW = rightX - leftX;
    const baseCharW = availW / Math.max(1, unitSum);
    let cursorX = leftX;

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === ' ') {
        cursorX += baseCharW * (0.56 + gapRatio * 0.55);
        continue;
      }
      const spec = NOSTROMO_VECTOR_GLYPHS[ch];
      const cw = baseCharW * (spec?.widthFactor ?? 1.0);
      if (spec) {
        for (const contour of spec.contours) {
          const scaledPts: Array<[number, number]> = contour.map(([nx, ny]) => [
            cursorX + nx * cw,
            topY + ny * height,
          ]);
          target.push(this.measurePath(scaledPts));
        }
      }
      const nextIsSpace = i < chars.length - 1 && chars[i + 1] === ' ';
      cursorX += cw + baseCharW * (nextIsSpace ? gapRatio * 0.55 : gapRatio);
    }
  }

  /**
   * 1) Initial Hardware Power-On Handshake Emblem: "INTERFACE 2037 // 180924609"
   */
  private buildHandshakeEmblem(): DualChannelEmblem {
    const chA: MeasuredPath[] = [];
    const chB: MeasuredPath[] = [];

    // Stepped Nostromo Mainframe Architecture Frame
    chA.push(
      this.measurePath([
        [-436, -108],
        [-58, -108],
        [28, -194],
        [368, -194],
        [368, 12],
        [438, 12],
        [438, 138],
        [-436, 138],
        [-436, -108],
      ])
    );
    chA.push(
      this.measurePath([
        [-40, -108],
        [34, -182],
        [356, -182],
        [356, -108],
        [-40, -108],
      ])
    );
    // Nostromo Bridge Canopy + MU-TH-UR Tape Core Schematic
    chA.push(
      this.measurePath([
        [48, -122],
        [78, -166],
        [204, -166],
        [204, -148],
        [114, -148],
        [114, -122],
        [48, -122],
      ])
    );
    chA.push(this.measurePath([[224, -182], [224, -108]]));
    chA.push(this.measurePath([[238, -182], [238, -108]]));
    // Weyland-Yutani Dual Telemetry Wings in Dorsal Bay
    chA.push(
      this.measurePath([
        [258, -170],
        [278, -170],
        [296, -138],
        [314, -170],
        [334, -170],
        [306, -120],
        [286, -120],
        [258, -170],
      ])
    );
    chA.push(
      this.measurePath([
        [-424, -96],
        [356, -96],
        [356, 6],
        [-424, 6],
        [-424, -96],
      ])
    );
    this.appendTextContours(chA, 'INTERFACE 2037', -406, 338, -84, 78, 0.19);

    chB.push(this.measurePath([[368, 12], [-436, 12]]));
    chB.push(
      this.measurePath([
        [-424, 24],
        [426, 24],
        [426, 126],
        [-424, 126],
        [-424, 24],
      ])
    );
    this.appendTextContours(chB, '180924609', -406, 408, 35, 80, 0.19);

    return this.finalizeEmblem(chA, chB);
  }

  /**
   * 2) Program 01 Launch Emblem: "LUNAR LANDER // 180924609"
   */
  private buildLanderEmblem(): DualChannelEmblem {
    const chA: MeasuredPath[] = [];
    const chB: MeasuredPath[] = [];

    chA.push(
      this.measurePath([
        [-436, -108],
        [-58, -108],
        [28, -194],
        [368, -194],
        [368, 12],
        [438, 12],
        [438, 138],
        [-436, 138],
        [-436, -108],
      ])
    );
    chA.push(
      this.measurePath([
        [-40, -108],
        [34, -182],
        [356, -182],
        [356, -108],
        [-40, -108],
      ])
    );
    chA.push(
      this.measurePath([
        [48, -122],
        [78, -166],
        [204, -166],
        [204, -148],
        [114, -148],
        [114, -122],
        [48, -122],
      ])
    );
    chA.push(this.measurePath([[224, -182], [224, -108]]));
    chA.push(this.measurePath([[238, -182], [238, -108]]));
    chA.push(
      this.measurePath([
        [250, -168],
        [264, -168],
        [264, -154],
        [250, -154],
        [250, -168],
      ])
    );
    // Integrated Aft Docked Lunar Lander Descent Module Silhouette
    chA.push(
      this.measurePath([
        [292, -168],
        [324, -168],
        [334, -154],
        [330, -136],
        [286, -136],
        [282, -154],
        [292, -168],
      ])
    );
    chA.push(
      this.measurePath([
        [288, -136],
        [274, -118],
        [266, -118],
        [281, -118],
      ])
    );
    chA.push(
      this.measurePath([
        [328, -136],
        [342, -118],
        [335, -118],
        [350, -118],
      ])
    );
    chA.push(
      this.measurePath([
        [301, -136],
        [296, -123],
        [320, -123],
        [315, -136],
      ])
    );
    chA.push(
      this.measurePath([
        [-424, -96],
        [356, -96],
        [356, 6],
        [-424, 6],
        [-424, -96],
      ])
    );
    this.appendTextContours(chA, 'LUNAR LANDER', -406, 338, -85, 80, 0.2);

    chB.push(this.measurePath([[368, 12], [-436, 12]]));
    chB.push(
      this.measurePath([
        [-424, 24],
        [426, 24],
        [426, 126],
        [-424, 126],
        [-424, 24],
      ])
    );
    this.appendTextContours(chB, '180924609', -406, 408, 35, 80, 0.19);

    return this.finalizeEmblem(chA, chB);
  }

  /**
   * 3) Program 02 Launch Emblem: "HADLEY'S PERIMETER // UA 571-C TACTICAL NET"
   * Features Colony Bastion CAD Frame + UA 571-C Automated Sentry Tripod + 60° Radar Cone!
   */
  private buildPerimeterEmblem(): DualChannelEmblem {
    const chA: MeasuredPath[] = [];
    const chB: MeasuredPath[] = [];

    // Stepped Colony Bastion CAD Outer Frame
    chA.push(
      this.measurePath([
        [-452, -108],
        [-140, -108],
        [-72, -196],
        [386, -196],
        [386, 12],
        [452, 12],
        [452, 138],
        [-452, 138],
        [-452, -108],
      ])
    );

    // Dorsal Tactical Schematic Bay
    chA.push(
      this.measurePath([
        [-122, -108],
        [-64, -184],
        [374, -184],
        [374, -108],
        [-122, -108],
      ])
    );

    // Left Dorsal Sub-Duct Cross-Hatch Bulkhead Schematic
    chA.push(
      this.measurePath([
        [-52, -172],
        [42, -172],
        [42, -120],
        [-52, -120],
        [-52, -172],
      ])
    );
    chA.push(this.measurePath([[-52, -172], [42, -120]]));
    chA.push(this.measurePath([[42, -172], [-52, -120]]));
    chA.push(this.measurePath([[62, -184], [62, -108]]));

    // Center-Right UA 571-C Remote Sentry Turret Vector CAD Silhouette
    // Tripod legs
    chA.push(
      this.measurePath([
        [118, -118],
        [152, -142],
        [186, -118],
      ])
    );
    chA.push(this.measurePath([[152, -142], [152, -118]]));
    // Receiver + 500-Rd Ammo Drum Box
    chA.push(
      this.measurePath([
        [126, -166],
        [174, -166],
        [178, -144],
        [126, -144],
        [126, -166],
      ])
    );
    // Heavy Caseless Barrel + Muzzle Brake
    chA.push(
      this.measurePath([
        [174, -160],
        [234, -160],
        [234, -152],
        [174, -152],
      ])
    );
    // Dorsal IR Sensor Pod
    chA.push(
      this.measurePath([
        [138, -176],
        [166, -176],
        [166, -166],
        [138, -166],
        [138, -176],
      ])
    );

    // 60° Infrared Sweeping Cone + Motion Blip Arcs inside Dorsal Bay
    chA.push(
      this.measurePath([
        [240, -156],
        [352, -180],
        [360, -156],
        [352, -132],
        [240, -156],
      ])
    );
    chA.push(
      this.measurePath([
        [296, -168],
        [302, -156],
        [296, -144],
      ])
    );
    chA.push(
      this.measurePath([
        [328, -174],
        [336, -156],
        [328, -138],
      ])
    );

    // Tier-1 Inner Structural Rail + "HADLEY'S PERIMETER"
    chA.push(
      this.measurePath([
        [-440, -96],
        [374, -96],
        [374, 6],
        [-440, 6],
        [-440, -96],
      ])
    );
    this.appendTextContours(chA, "HADLEY'S PERIMETER", -424, 358, -82, 74, 0.17);

    // Channel B: Tier-2 Structural Wall + "UA 571-C TACTICAL NET"
    chB.push(this.measurePath([[386, 12], [-452, 12]]));
    chB.push(
      this.measurePath([
        [-440, 24],
        [440, 24],
        [440, 126],
        [-440, 126],
        [-440, 24],
      ])
    );
    this.appendTextContours(chB, 'UA 571-C TACTICAL NET', -424, 424, 40, 68, 0.17);

    return this.finalizeEmblem(chA, chB);
  }

  /**
   * 4) Program 03 Launch Emblem: "ORBITAL INTERCEPT // LV-426 FLAK NET"
   * Features Atmospheric Radar Dome Arcs + Curved Orbital Re-Entry Trajectory + Flak Burst Reticle!
   */
  private buildFlakEmblem(): DualChannelEmblem {
    const chA: MeasuredPath[] = [];
    const chB: MeasuredPath[] = [];

    // Outer Radar Telemetry Bezel Frame
    chA.push(
      this.measurePath([
        [-452, -108],
        [-180, -108],
        [-114, -198],
        [386, -198],
        [386, 12],
        [452, 12],
        [452, 138],
        [-452, 138],
        [-452, -108],
      ])
    );

    // Dorsal Atmospheric Radar Scope Bay
    chA.push(
      this.measurePath([
        [-162, -108],
        [-106, -186],
        [374, -186],
        [374, -108],
        [-162, -108],
      ])
    );

    // Semicircular Surface-to-Orbit Radar Range Arcs inside Dorsal Bay
    const rcx = 106;
    const rcy = -114;
    for (const rad of [34, 62]) {
      const arcPts: Array<[number, number]> = [];
      const steps = 16;
      for (let i = 0; i <= steps; i++) {
        const ang = Math.PI + (i / steps) * Math.PI;
        arcPts.push([rcx + Math.cos(ang) * rad * 1.45, rcy + Math.sin(ang) * rad]);
      }
      chA.push(this.measurePath(arcPts));
    }

    // Horizon Line + 3 Battery Turret Marks + 2 Dome Silhouettes
    chA.push(this.measurePath([[-96, -114], [352, -114]]));
    // Left, Center, Right Batteries
    for (const bx of [-42, 106, 254]) {
      chA.push(
        this.measurePath([
          [bx - 12, -114],
          [bx - 6, -125],
          [bx + 6, -125],
          [bx + 12, -114],
        ])
      );
      chA.push(this.measurePath([[bx, -125], [bx + (bx < 106 ? 12 : bx > 106 ? -12 : 0), -138]]));
    }
    // Curved Orbital Re-Entry Vector Trajectory + Airburst Crosshair
    chA.push(
      this.measurePath([
        [-74, -180],
        [-10, -172],
        [46, -158],
        [92, -142],
      ])
    );
    // Octagonal Airburst Shockwave Ring at Intercept Point (92, -142)
    const burstPts: Array<[number, number]> = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      burstPts.push([92 + Math.cos(a) * 16, -142 + Math.sin(a) * 16]);
    }
    chA.push(this.measurePath(burstPts));
    chA.push(this.measurePath([[72, -142], [112, -142]]));
    chA.push(this.measurePath([[92, -162], [92, -122]]));

    // Tier-1 Inner Structural Rail + "ORBITAL INTERCEPT"
    chA.push(
      this.measurePath([
        [-440, -96],
        [374, -96],
        [374, 6],
        [-440, 6],
        [-440, -96],
      ])
    );
    this.appendTextContours(chA, 'ORBITAL INTERCEPT', -424, 358, -82, 74, 0.17);

    // Channel B: Tier-2 Structural Wall + "LV-426 // FLAK NET"
    chB.push(this.measurePath([[386, 12], [-452, 12]]));
    chB.push(
      this.measurePath([
        [-440, 24],
        [440, 24],
        [440, 126],
        [-440, 126],
        [-440, 24],
      ])
    );
    this.appendTextContours(chB, 'LV-426 // FLAK NET', -424, 424, 40, 68, 0.17);

    return this.finalizeEmblem(chA, chB);
  }

  /**
   * 5) Program 04 Launch Emblem: "DERELICT TRENCH // VECTOR RUN"
   * Features Perspective 3D Wireframe Tunnel Ribs + Fighter-Jet Flight Path Marker!
   */
  private buildTrenchEmblem(): DualChannelEmblem {
    const chA: MeasuredPath[] = [];
    const chB: MeasuredPath[] = [];

    chA.push(
      this.measurePath([
        [-452, -108],
        [-180, -108],
        [-114, -198],
        [386, -198],
        [386, 12],
        [452, 12],
        [452, 138],
        [-452, 138],
        [-452, -108],
      ])
    );

    // Dorsal 3D Wireframe Tunnel Perspective Bay
    chA.push(
      this.measurePath([
        [-162, -108],
        [-106, -186],
        [374, -186],
        [374, -108],
        [-162, -108],
      ])
    );
    // Converging perspective vanishing rays & octagonal ribs inside Dorsal Bay
    const vpx = 106;
    const vpy = -146;
    for (const s of [0.22, 0.48, 0.82]) {
      const rw = 160 * s;
      const rh = 34 * s;
      chA.push(
        this.measurePath([
          [vpx - rw, vpy - rh * 0.45],
          [vpx - rw * 0.6, vpy - rh],
          [vpx + rw * 0.6, vpy - rh],
          [vpx + rw, vpy - rh * 0.45],
          [vpx + rw, vpy + rh * 0.65],
          [vpx + rw * 0.65, vpy + rh],
          [vpx - rw * 0.65, vpy + rh],
          [vpx - rw, vpy + rh * 0.65],
          [vpx - rw, vpy - rh * 0.45],
        ])
      );
    }
    // Flight Path Marker symbol at vanishing point
    chA.push(
      this.measurePath([
        [vpx - 22, vpy],
        [vpx - 8, vpy],
      ])
    );
    chA.push(
      this.measurePath([
        [vpx + 8, vpy],
        [vpx + 22, vpy],
      ])
    );
    chA.push(
      this.measurePath([
        [vpx, vpy - 16],
        [vpx, vpy - 7],
      ])
    );

    chA.push(
      this.measurePath([
        [-440, -96],
        [374, -96],
        [374, 6],
        [-440, 6],
        [-440, -96],
      ])
    );
    this.appendTextContours(chA, 'DERELICT TRENCH', -424, 358, -82, 74, 0.17);

    chB.push(this.measurePath([[386, 12], [-452, 12]]));
    chB.push(
      this.measurePath([
        [-440, 24],
        [440, 24],
        [440, 126],
        [-440, 126],
        [-440, 24],
      ])
    );
    this.appendTextContours(chB, 'VECTOR RUN // 04', -424, 424, 40, 68, 0.17);

    return this.finalizeEmblem(chA, chB);
  }

  public render(ctx: CanvasRenderingContext2D, params: BootLogoRenderParams): void {
    const mode = params.sequenceMode ?? 'HARDWARE_HANDSHAKE';
    const { width: w, height: h, bootPoweredOn, bootElapsedSec } = params;

    if (
      mode === 'LANDER_LAUNCH' ||
      mode === 'PERIMETER_LAUNCH' ||
      mode === 'FLAK_LAUNCH' ||
      mode === 'TRENCH_LAUNCH'
    ) {
      this.renderCartridgeLaunchSequence(ctx, w, h, params, mode);
      return;
    }

    if (!bootPoweredOn) {
      this.drawDormantScreen(ctx, w, h, params);
      return;
    }

    if (bootElapsedSec < BOOT_TIMING.LOGO_HOLD_END_SEC) {
      this.drawRedAlienLogoStartup(ctx, w, h, params, this.handshakeEmblem);
      return;
    }

    if (bootElapsedSec < BOOT_TIMING.PROTOCOL_START_SEC) {
      this.drawModeSwitchTransition(ctx, w, h, params);
      return;
    }

    this.drawFullScreenAwakeningProtocol(ctx, w, h, params);
  }

  /**
   * Renders the procedural electron-beam launch sequence when launching Program 1 (Lunar Lander),
   * Program 2 (Hadley's Perimeter // UA 571-C Tactical Net), or Program 3 (Orbital Intercept // Flak Net)
   * from MU-TH-UR OS.
   */
  public renderCartridgeLaunchSequence(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: BootLogoRenderParams,
    mode: 'LANDER_LAUNCH' | 'PERIMETER_LAUNCH' | 'FLAK_LAUNCH' | 'TRENCH_LAUNCH'
  ): void {
    const t = params.bootElapsedSec;
    const isPerimeter = mode === 'PERIMETER_LAUNCH';
    const isFlak = mode === 'FLAK_LAUNCH';
    const isTrench = mode === 'TRENCH_LAUNCH';
    const emblem = isTrench
      ? this.trenchEmblem
      : isFlak
        ? this.flakEmblem
        : isPerimeter
          ? this.perimeterEmblem
          : this.landerEmblem;

    if (t >= CARTRIDGE_LAUNCH_TIMING.HOLD_END_SEC) {
      const p = Math.min(
        1,
        (t - CARTRIDGE_LAUNCH_TIMING.HOLD_END_SEC) /
          (CARTRIDGE_LAUNCH_TIMING.COMPLETE_SEC - CARTRIDGE_LAUNCH_TIMING.HOLD_END_SEC)
      );
      this.drawCollapseProgress(ctx, w, h, p, isPerimeter || isFlak || isTrench);
      return;
    }

    ctx.save();
    ctx.fillStyle = isTrench ? '#020805' : isFlak ? '#020704' : isPerimeter ? '#040301' : '#050101';
    ctx.fillRect(0, 0, w, h);

    const rasterWarmup = Math.max(0, Math.min(1, t / 0.24));
    if (rasterWarmup > 0.01) {
      const humFlicker =
        0.96 + 0.04 * Math.sin(params.timeSec * 376.99) * Math.cos(params.timeSec * 23.0);
      const alpha = rasterWarmup * humFlicker;

      const cx = w * 0.5;
      const cy = h * 0.46;
      const outerR = Math.hypot(w * 0.62, h * 0.62);
      const bgGrad = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.04, cx, cy, outerR);
      if (isTrench) {
        bgGrad.addColorStop(0, `rgba(18, 98, 56, ${(0.88 * alpha).toFixed(3)})`);
        bgGrad.addColorStop(0.45, `rgba(10, 48, 28, ${(0.92 * alpha).toFixed(3)})`);
        bgGrad.addColorStop(0.8, `rgba(4, 18, 12, ${(0.96 * alpha).toFixed(3)})`);
        bgGrad.addColorStop(1, 'rgba(2, 6, 4, 0.99)');
      } else if (isFlak) {
        // Deep Atmospheric P39 Phosphor Radar Green Flood with Subtle Sweep Highlight
        bgGrad.addColorStop(0, `rgba(22, 92, 46, ${(0.88 * alpha).toFixed(3)})`);
        bgGrad.addColorStop(0.48, `rgba(11, 52, 26, ${(0.92 * alpha).toFixed(3)})`);
        bgGrad.addColorStop(0.8, `rgba(5, 22, 12, ${(0.96 * alpha).toFixed(3)})`);
        bgGrad.addColorStop(1, 'rgba(2, 6, 4, 0.99)');
      } else if (isPerimeter) {
        // Deep Colony Tactical Amber-Oxblood / Dark Emerald Security CRT Flood
        bgGrad.addColorStop(0, `rgba(128, 56, 12, ${(0.92 * alpha).toFixed(3)})`);
        bgGrad.addColorStop(0.48, `rgba(74, 28, 6, ${(0.94 * alpha).toFixed(3)})`);
        bgGrad.addColorStop(0.8, `rgba(26, 12, 4, ${(0.96 * alpha).toFixed(3)})`);
        bgGrad.addColorStop(1, 'rgba(5, 4, 2, 0.99)');
      } else {
        bgGrad.addColorStop(0, `rgba(154, 30, 20, ${(0.95 * alpha).toFixed(3)})`);
        bgGrad.addColorStop(0.45, `rgba(116, 19, 13, ${(0.94 * alpha).toFixed(3)})`);
        bgGrad.addColorStop(0.78, `rgba(58, 8, 6, ${(0.96 * alpha).toFixed(3)})`);
        bgGrad.addColorStop(1, 'rgba(12, 1, 1, 0.99)');
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Live rotating surface-to-orbit radar sweep wedge behind Flak Net emblem
      if (isFlak) {
        const sweepOriginX = w * 0.5;
        const sweepOriginY = h * 0.92;
        const sweepRadius = Math.hypot(w, h) * 0.85;
        const sweepAng = -Math.PI + ((t * 1.15) % 1.0) * Math.PI;
        ctx.save();
        for (let r = 1; r <= 4; r++) {
          ctx.strokeStyle = `rgba(68, 255, 119, ${(0.12 * alpha).toFixed(3)})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(sweepOriginX, sweepOriginY, (sweepRadius * r) / 4.2, Math.PI, Math.PI * 2);
          ctx.stroke();
        }
        ctx.strokeStyle = `rgba(142, 245, 171, ${(0.42 * alpha).toFixed(3)})`;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(sweepOriginX, sweepOriginY);
        ctx.lineTo(
          sweepOriginX + Math.cos(sweepAng) * sweepRadius,
          sweepOriginY + Math.sin(sweepAng) * sweepRadius
        );
        ctx.stroke();
        ctx.restore();
      }

      // Live converging 3D wireframe tunnel ignition reveal behind Derelict Trench emblem!
      if (isTrench) {
        const vpx = w * 0.5;
        const vpy = h * 0.46;
        ctx.save();
        for (let i = 0; i < 9; i++) {
          const zFrac = ((i / 9 + t * 0.55) % 1.0);
          const scaleZ = Math.pow(zFrac, 1.85);
          const rw = w * 0.54 * scaleZ;
          const rh = h * 0.46 * scaleZ;
          ctx.strokeStyle = `rgba(68, 255, 119, ${(0.08 + scaleZ * 0.34 * alpha).toFixed(3)})`;
          ctx.lineWidth = 1.1 + scaleZ * 1.6;
          ctx.beginPath();
          ctx.moveTo(vpx - rw, vpy - rh * 0.42);
          ctx.lineTo(vpx - rw * 0.62, vpy - rh);
          ctx.lineTo(vpx + rw * 0.62, vpy - rh);
          ctx.lineTo(vpx + rw, vpy - rh * 0.42);
          ctx.lineTo(vpx + rw, vpy + rh * 0.55);
          ctx.lineTo(vpx + rw * 0.62, vpy + rh);
          ctx.lineTo(vpx - rw * 0.62, vpy + rh);
          ctx.lineTo(vpx - rw, vpy + rh * 0.55);
          ctx.closePath();
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      for (let sy = 0; sy < h; sy += 4) {
        ctx.fillRect(0, sy, w, 1.5);
      }
    }

    if (t < CARTRIDGE_LAUNCH_TIMING.FLASH_END_SEC) {
      const u = t / CARTRIDGE_LAUNCH_TIMING.FLASH_END_SEC;
      const flashAlpha = Math.sin(u * Math.PI) * 0.65;
      ctx.fillStyle = isTrench
        ? `rgba(142, 245, 171, ${flashAlpha.toFixed(3)})`
        : isFlak
          ? `rgba(110, 255, 152, ${flashAlpha.toFixed(3)})`
          : isPerimeter
            ? `rgba(255, 196, 92, ${flashAlpha.toFixed(3)})`
            : `rgba(255, 150, 120, ${flashAlpha.toFixed(3)})`;
      ctx.fillRect(0, h * 0.5 - (4 + u * 90), w, (4 + u * 90) * 2);
    }

    const rawDraw =
      (t - CARTRIDGE_LAUNCH_TIMING.FLASH_END_SEC * 0.5) /
      (CARTRIDGE_LAUNCH_TIMING.DRAW_END_SEC - CARTRIDGE_LAUNCH_TIMING.FLASH_END_SEC * 0.5);
    const drawProgA = this.easeInOutSine(Math.max(0, Math.min(1, rawDraw)));
    const drawProgB = this.easeInOutSine(Math.max(0, Math.min(1, (rawDraw - 0.08) / 0.92)));

    const scale = Math.min((w * 0.80) / 940, (h * 0.66) / 380);
    const originX = w * 0.5;
    const originY = h * 0.45;

    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(scale, scale);
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 6;
    ctx.lineCap = 'square';

    this.renderProceduralBeamChannel(
      ctx,
      emblem.chA,
      emblem.lenA * drawProgA,
      drawProgA < 0.999 && drawProgA > 0.001,
      params.timeSec,
      isPerimeter || isFlak || isTrench
    );

    if (drawProgB > 0.001) {
      this.renderProceduralBeamChannel(
        ctx,
        emblem.chB,
        emblem.lenB * drawProgB,
        drawProgB < 0.999,
        params.timeSec + 1.7,
        isPerimeter || isFlak || isTrench
      );
    }
    ctx.restore();

    // Subtle skip prompt at bottom
    ctx.font = 'bold 14px "Share Tech Mono", monospace';
    ctx.fillStyle = isTrench
      ? 'rgba(142, 245, 171, 0.88)'
      : isFlak
        ? 'rgba(142, 245, 171, 0.85)'
        : isPerimeter
          ? 'rgba(255, 208, 120, 0.78)'
          : 'rgba(235, 245, 255, 0.72)';
    ctx.textAlign = 'center';
    ctx.fillText(
      isTrench
        ? 'ENGAGING DROP-SHIP FLIGHT VECTOR 04 // DERELICT TRENCH 3D RUNNER [SPACE / CLICK TO SKIP]'
        : isFlak
          ? 'CALIBRATING CARTRIDGE 03 // LV-426 SURFACE-TO-ORBIT FLAK NET RADAR [SPACE / CLICK TO SKIP]'
          : isPerimeter
            ? 'MOUNTING CARTRIDGE 02 // SEC-01 HADLEY MED-LAB CAD SCHEMATIC [SPACE / CLICK TO SKIP]'
            : 'MOUNTING CARTRIDGE 01 // LV-426 ORBITAL DESCENT TELEMETRY [SPACE / CLICK TO SKIP]',
      w * 0.5,
      h - 28
    );

    ctx.restore();
  }

  /**
   * Stage 0: Full-Screen Dormant Terminal ("Option to Awaken") — zero HUD chrome!
   */
  private drawDormantScreen(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: BootLogoRenderParams
  ): void {
    ctx.save();
    ctx.fillStyle = '#010302';
    ctx.fillRect(0, 0, w, h);

    // Subtle unlit cathode-glass reflection while computer sits quietly in standby
    const glassGrad = ctx.createRadialGradient(
      w * 0.5,
      h * 0.46,
      20,
      w * 0.5,
      h * 0.5,
      Math.max(w, h) * 0.72
    );
    glassGrad.addColorStop(0, 'rgba(10, 20, 14, 0.14)');
    glassGrad.addColorStop(0.65, 'rgba(4, 8, 5, 0.08)');
    glassGrad.addColorStop(1, 'rgba(0, 0, 0, 0.92)');
    ctx.fillStyle = glassGrad;
    ctx.fillRect(0, 0, w, h);

    // Entire screen acts as wake trigger
    params.buttonsOut.push({
      id: 'boot-awaken',
      rect: { x: 0, y: 0, width: w, height: h },
      label: 'WAKE TERMINAL',
    });

    const isNarrow = w < 560;
    const marginX = Math.max(24, Math.round(w * 0.055));
    const topY = Math.max(44, Math.round(h * 0.085));
    const fontPx = isNarrow ? 13.5 : 15.5;
    const lineStep = Math.round(fontPx * 1.72);
    const cursorOn = Math.sin(params.timeSec * Math.PI * 1.8) >= 0;
    const heaterBreath = 0.28 + 0.2 * (0.5 + 0.5 * Math.sin(params.timeSec * 1.6));

    ctx.textAlign = 'left';
    ctx.font = `${fontPx}px "JetBrains Mono", "Share Tech Mono", monospace`;

    ctx.fillStyle = 'rgba(59, 224, 104, 0.36)';
    ctx.fillText('WEYLAND-YUTANI // MU-TH-UR 6000', marginX, topY);
    ctx.fillText('SYSTEM STATE: STANDBY', marginX, topY + lineStep);

    ctx.fillStyle = 'rgba(68, 255, 119, 0.62)';
    const wakePrompt = isNarrow ? '> TOUCH OR PRESS KEY ' : '> PRESS ANY KEY OR CLICK ';
    ctx.fillText(
      `${wakePrompt}${cursorOn ? '█' : ' '}`,
      marginX,
      topY + lineStep * 2.35
    );

    // Tiny dim cathode filament standby LED in bottom-right corner
    ctx.textAlign = 'right';
    ctx.font = `${isNarrow ? 11 : 12}px "JetBrains Mono", monospace`;
    ctx.fillStyle = `rgba(255, 176, 0, ${heaterBreath.toFixed(2)})`;
    ctx.fillText('● STANDBY', w - marginX, h - Math.max(24, Math.round(h * 0.05)));

    ctx.restore();
  }

  /**
   * Stage 1 & 2: Full-Screen 1979 CRT Tube Turn-On Distorted Flash + Red Nostromo CRT Screen
   * with Live Electron-Beam Procedural Vector Tracing of "INTERFACE 2037 / 180924609".
   */
  private drawRedAlienLogoStartup(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: BootLogoRenderParams,
    emblem: DualChannelEmblem
  ): void {
    const t = params.bootElapsedSec;
    ctx.save();

    ctx.fillStyle = '#050101';
    ctx.fillRect(0, 0, w, h);

    const rasterWarmup = Math.max(0, Math.min(1, (t - 0.1) / 0.68));
    if (rasterWarmup > 0.01) {
      const humFlicker =
        0.96 + 0.04 * Math.sin(params.timeSec * 376.99) * Math.cos(params.timeSec * 23.0);
      const redAlpha = rasterWarmup * humFlicker;

      const cx = w * 0.5;
      const cy = h * 0.46;
      const outerR = Math.hypot(w * 0.62, h * 0.62);
      const redGrad = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.04, cx, cy, outerR);
      redGrad.addColorStop(0, `rgba(154, 30, 20, ${(0.95 * redAlpha).toFixed(3)})`);
      redGrad.addColorStop(0.45, `rgba(116, 19, 13, ${(0.94 * redAlpha).toFixed(3)})`);
      redGrad.addColorStop(0.78, `rgba(58, 8, 6, ${(0.96 * redAlpha).toFixed(3)})`);
      redGrad.addColorStop(1, 'rgba(12, 1, 1, 0.99)');

      ctx.fillStyle = redGrad;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.20)';
      for (let sy = 0; sy < h; sy += 4) {
        ctx.fillRect(0, sy, w, 1.5);
      }

      const humBarY = ((params.timeSec * 68) % (h + 160)) - 80;
      const humGrad = ctx.createLinearGradient(0, humBarY - 65, 0, humBarY + 65);
      humGrad.addColorStop(0, 'rgba(255, 90, 60, 0)');
      humGrad.addColorStop(0.5, `rgba(255, 95, 65, ${(0.065 * redAlpha).toFixed(3)})`);
      humGrad.addColorStop(1, 'rgba(255, 90, 60, 0)');
      ctx.fillStyle = humGrad;
      ctx.fillRect(0, humBarY - 65, w, 130);
    }

    // 2. WEIRD DISTORTED CRT TUBE TURN-ON FLASH (0.00s -> 0.88s)
    if (t < BOOT_TIMING.FLASH_END_SEC) {
      const u = t / BOOT_TIMING.FLASH_END_SEC;

      if (u < 0.42) {
        const arcP = u / 0.42;
        const spanW = w * Math.min(1.08, 0.08 + Math.pow(arcP, 0.42) * 1.05);
        const arcAlpha = Math.sin(arcP * Math.PI);

        const bloomH = 18 + arcP * 150;
        const arcGrad = ctx.createRadialGradient(
          w * 0.5,
          h * 0.5,
          4,
          w * 0.5,
          h * 0.5,
          Math.max(spanW * 0.55, bloomH)
        );
        arcGrad.addColorStop(0, `rgba(255, 250, 240, ${(0.95 * arcAlpha).toFixed(3)})`);
        arcGrad.addColorStop(0.28, `rgba(255, 150, 95, ${(0.78 * arcAlpha).toFixed(3)})`);
        arcGrad.addColorStop(0.65, `rgba(220, 42, 24, ${(0.45 * arcAlpha).toFixed(3)})`);
        arcGrad.addColorStop(1, 'rgba(90, 8, 4, 0)');
        ctx.fillStyle = arcGrad;
        ctx.fillRect(0, h * 0.5 - bloomH, w, bloomH * 2);

        ctx.save();
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.98 * (1 - arcP * 0.35)).toFixed(3)})`;
        ctx.lineWidth = Math.max(2, (1 - arcP) * 11 + 2.5);
        ctx.shadowColor = '#FF9966';
        ctx.shadowBlur = 24;
        ctx.beginPath();
        const startX = w * 0.5 - spanW * 0.5;
        const segs = 36;
        for (let i = 0; i <= segs; i++) {
          const f = i / segs;
          const px = startX + spanW * f;
          const env = Math.sin(f * Math.PI);
          const warpY =
            Math.sin(f * 13.0 + t * 85.0) * 26 * env * (1 - arcP * 0.6) +
            Math.cos(f * 29.0 - t * 120.0) * 9 * env;
          const py = h * 0.5 + warpY;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      }

      if (u > 0.1) {
        const flashP = (u - 0.1) / 0.9;
        const surge = Math.sin(Math.pow(flashP, 0.55) * Math.PI) * (1 - flashP * 0.45);

        const flashGrad = ctx.createRadialGradient(
          w * (0.5 + Math.sin(t * 44) * 0.06 * (1 - flashP)),
          h * (0.48 + Math.cos(t * 37) * 0.05 * (1 - flashP)),
          10,
          w * 0.5,
          h * 0.5,
          Math.max(w, h) * 0.72
        );
        flashGrad.addColorStop(0, `rgba(255, 242, 232, ${(0.72 * surge).toFixed(3)})`);
        flashGrad.addColorStop(0.32, `rgba(255, 110, 75, ${(0.52 * surge).toFixed(3)})`);
        flashGrad.addColorStop(0.68, `rgba(135, 165, 255, ${(0.24 * surge).toFixed(3)})`);
        flashGrad.addColorStop(1, 'rgba(30, 4, 4, 0)');
        ctx.fillStyle = flashGrad;
        ctx.fillRect(0, 0, w, h);

        const tearCount = 5;
        for (let k = 0; k < tearCount; k++) {
          const bandNorm = (k * 0.21 + t * 3.7) % 1.0;
          const by = bandNorm * h;
          const bh = (6 + (k % 3) * 10) * (1 - flashP);
          if (bh > 1.2) {
            ctx.fillStyle =
              k % 2 === 0
                ? `rgba(255, 225, 210, ${(0.26 * surge).toFixed(3)})`
                : `rgba(150, 205, 255, ${(0.2 * surge).toFixed(3)})`;
            ctx.fillRect(0, by, w, bh);
          }
        }
      }
    }

    // 3. PROCEDURAL ELECTRON-BEAM DRAWING OF THE INITIALIZATION HANDSHAKE EMBLEM
    if (t >= BOOT_TIMING.FLASH_END_SEC * 0.82) {
      const rawDraw =
        (t - BOOT_TIMING.FLASH_END_SEC * 0.82) /
        (BOOT_TIMING.LOGO_DRAW_END_SEC - BOOT_TIMING.FLASH_END_SEC * 0.82);
      const drawProgA = this.easeInOutSine(Math.max(0, Math.min(1, rawDraw)));
      const drawProgB = this.easeInOutSine(Math.max(0, Math.min(1, (rawDraw - 0.08) / 0.92)));

      const scale = Math.min((w * 0.78) / 910, (h * 0.66) / 380);
      const originX = w * 0.5;
      const originY = h * 0.43 + (t < 1.15 ? Math.sin(t * 36) * Math.exp(-t * 3.2) * 8 : 0);

      ctx.save();
      ctx.translate(originX, originY);
      ctx.scale(scale, scale);
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 6;
      ctx.lineCap = 'square';

      this.renderProceduralBeamChannel(
        ctx,
        emblem.chA,
        emblem.lenA * drawProgA,
        drawProgA < 0.999 && drawProgA > 0.001,
        params.timeSec,
        false
      );

      if (drawProgB > 0.001) {
        this.renderProceduralBeamChannel(
          ctx,
          emblem.chB,
          emblem.lenB * drawProgB,
          drawProgB < 0.999,
          params.timeSec + 1.7,
          false
        );
      }

      ctx.restore();
    }

    if (t >= 0.95) {
      ctx.font = 'bold 14px "Share Tech Mono", monospace';
      ctx.fillStyle = 'rgba(238, 247, 255, 0.70)';
      ctx.textAlign = 'center';
      ctx.fillText(
        '180924609 // INTERFACE 2037 HANDSHAKE ACTIVE — [SPACE / CLICK] ENTER MU-TH-UR OS',
        w * 0.5,
        h - 28
      );
    }

    ctx.restore();
  }

  private renderProceduralBeamChannel(
    ctx: CanvasRenderingContext2D,
    paths: readonly MeasuredPath[],
    targetDist: number,
    showBeamSpot: boolean,
    timeSec: number,
    amberTheme = false
  ): void {
    if (targetDist <= 0) return;

    let rem = targetDist;
    let tipPos: Vec2 | null = null;
    const wakeWindow = 105;

    ctx.save();
    ctx.strokeStyle = amberTheme ? 'rgba(68, 255, 119, 0.34)' : 'rgba(135, 188, 255, 0.36)';
    ctx.lineWidth = 7.6;
    ctx.beginPath();
    rem = targetDist;
    for (const p of paths) {
      if (rem <= 0) break;
      const drawLen = Math.min(p.totalLength, rem);
      this.traceSubPath(ctx, p, 0, drawLen, 2.2, 0.4);
      rem -= p.totalLength;
    }
    ctx.stroke();

    ctx.strokeStyle = amberTheme ? 'rgba(255, 176, 0, 0.38)' : 'rgba(255, 165, 145, 0.32)';
    ctx.lineWidth = 6.8;
    ctx.beginPath();
    rem = targetDist;
    for (const p of paths) {
      if (rem <= 0) break;
      const drawLen = Math.min(p.totalLength, rem);
      this.traceSubPath(ctx, p, 0, drawLen, -2.0, -0.3);
      rem -= p.totalLength;
    }
    ctx.stroke();

    ctx.strokeStyle = amberTheme ? '#FFF2D6' : '#EEF7FF';
    ctx.lineWidth = 3.2;
    ctx.shadowColor = amberTheme ? 'rgba(255, 196, 88, 0.78)' : 'rgba(185, 222, 255, 0.72)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    rem = targetDist;
    for (const p of paths) {
      if (rem <= 0) break;
      const drawLen = Math.min(p.totalLength, rem);
      const endPt = this.traceSubPath(ctx, p, 0, drawLen, 0, 0);
      if (rem <= p.totalLength) {
        tipPos = endPt;
      }
      rem -= p.totalLength;
    }
    ctx.stroke();
    ctx.restore();

    if (showBeamSpot && tipPos) {
      const wakeStartGlobal = Math.max(0, targetDist - wakeWindow);
      ctx.save();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 5.0;
      ctx.shadowColor = '#FFFFFF';
      ctx.shadowBlur = 18;
      ctx.beginPath();

      let acc = 0;
      for (const p of paths) {
        const pStart = acc;
        const pEnd = acc + p.totalLength;
        const segLo = Math.max(pStart, wakeStartGlobal);
        const segHi = Math.min(pEnd, targetDist);
        if (segHi > segLo) {
          this.traceSubPath(ctx, p, segLo - pStart, segHi - pStart, 0, 0);
        }
        acc = pEnd;
        if (acc >= targetDist) break;
      }
      ctx.stroke();

      const flicker = 0.92 + 0.08 * Math.sin(timeSec * 90);
      const outerR = 38 * flicker;
      const spotGlow = ctx.createRadialGradient(
        tipPos.x,
        tipPos.y,
        1.5,
        tipPos.x,
        tipPos.y,
        outerR
      );
      spotGlow.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
      spotGlow.addColorStop(0.22, amberTheme ? 'rgba(255, 238, 185, 0.90)' : 'rgba(225, 248, 255, 0.88)');
      spotGlow.addColorStop(0.52, amberTheme ? 'rgba(255, 176, 36, 0.42)' : 'rgba(255, 155, 130, 0.36)');
      spotGlow.addColorStop(1, 'rgba(255, 80, 30, 0)');

      ctx.fillStyle = spotGlow;
      ctx.beginPath();
      ctx.arc(tipPos.x, tipPos.y, outerR, 0, Math.PI * 2);
      ctx.fill();

      ctx.translate(tipPos.x, tipPos.y);
      ctx.fillStyle = amberTheme ? 'rgba(255, 240, 195, 0.94)' : 'rgba(210, 245, 255, 0.92)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 17 * flicker, 6.2 * flicker, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.ellipse(0, 0, 10.5 * flicker, 3.6 * flicker, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  private traceSubPath(
    ctx: CanvasRenderingContext2D,
    path: MeasuredPath,
    startDist: number,
    endDist: number,
    offsetX: number,
    offsetY: number
  ): Vec2 {
    const pts = path.points;
    const cums = path.cumLengths;
    if (pts.length === 0) return { x: 0, y: 0 };
    if (endDist <= startDist) return pts[0];

    let started = false;
    let lastPt: Vec2 = pts[0];

    for (let i = 0; i < pts.length - 1; i++) {
      const d0 = cums[i];
      const d1 = cums[i + 1];
      const segLen = d1 - d0;
      if (segLen <= 1e-5) continue;
      if (d1 <= startDist) continue;
      if (d0 >= endDist) break;

      const t0 = startDist > d0 ? (startDist - d0) / segLen : 0;
      const t1 = endDist < d1 ? (endDist - d0) / segLen : 1;

      const sx = pts[i].x + (pts[i + 1].x - pts[i].x) * t0 + offsetX;
      const sy = pts[i].y + (pts[i + 1].y - pts[i].y) * t0 + offsetY;
      const ex = pts[i].x + (pts[i + 1].x - pts[i].x) * t1 + offsetX;
      const ey = pts[i].y + (pts[i + 1].y - pts[i].y) * t1 + offsetY;

      if (!started) {
        ctx.moveTo(sx, sy);
        started = true;
      }
      ctx.lineTo(ex, ey);
      lastPt = { x: ex - offsetX, y: ey - offsetY };
    }

    return lastPt;
  }

  private drawCollapseProgress(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    p: number,
    amberTheme = false
  ): void {
    ctx.save();
    ctx.fillStyle = '#030704';
    ctx.fillRect(0, 0, w, h);

    if (p < 0.5) {
      const collapse = 1 - p * 2;
      const bandH = Math.max(4, h * collapse * collapse);
      const by = h * 0.5 - bandH * 0.5;

      ctx.fillStyle = amberTheme
        ? `rgba(130, 62, 12, ${(0.85 * collapse).toFixed(3)})`
        : `rgba(140, 26, 18, ${(0.85 * collapse).toFixed(3)})`;
      ctx.fillRect(0, by, w, bandH);

      ctx.fillStyle = `rgba(255, 220, 195, ${(0.75 * (1 - collapse * 0.4)).toFixed(3)})`;
      ctx.fillRect(0, h * 0.5 - 3, w, 6);
    } else {
      const open = (p - 0.5) * 2;
      const bandH = Math.max(4, h * open * open);
      const by = h * 0.5 - bandH * 0.5;

      ctx.fillStyle = 'rgba(18, 68, 34, 0.32)';
      ctx.fillRect(0, by, w, bandH);

      ctx.fillStyle = `rgba(155, 255, 185, ${(0.65 * (1 - open)).toFixed(3)})`;
      ctx.fillRect(0, h * 0.5 - 2.5, w, 5);
    }

    ctx.restore();
  }

  private drawModeSwitchTransition(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: BootLogoRenderParams
  ): void {
    const p =
      (params.bootElapsedSec - BOOT_TIMING.LOGO_HOLD_END_SEC) /
      (BOOT_TIMING.PROTOCOL_START_SEC - BOOT_TIMING.LOGO_HOLD_END_SEC);
    this.drawCollapseProgress(ctx, w, h, p, false);
  }

  private drawFullScreenAwakeningProtocol(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    params: BootLogoRenderParams
  ): void {
    ctx.save();
    ctx.fillStyle = COLORS.BG_DEEP;
    ctx.fillRect(0, 0, w, h);

    const edgePad = Math.max(18, Math.round(Math.min(w, h) * 0.028));
    this.drawBrackets(
      ctx,
      edgePad,
      edgePad,
      w - edgePad * 2,
      h - edgePad * 2,
      26,
      COLORS.GREEN_DIM,
      2.2
    );

    const baseW = Math.min(860, w - 64);
    const baseH = Math.min(420, h - 64);
    const bx = (w - baseW) * 0.5;
    const by = (h - baseH) * 0.5;

    this.drawBrackets(ctx, bx, by, baseW, baseH, 20, COLORS.GREEN_PRIMARY, 2.4);

    ctx.font = 'bold 21px "Share Tech Mono", monospace';
    ctx.fillStyle = COLORS.AMBER_CAUTION;
    ctx.textAlign = 'left';
    ctx.fillText('INTERFACE 2037 // MU-TH-UR 6000 AWAKENING', bx + 22, by + 38);

    ctx.font = 'bold 15px "JetBrains Mono", monospace';
    let remaining = Math.floor(params.bootProgressChars);
    params.bootLines.forEach((line, idx) => {
      const ly = by + 80 + idx * 36;
      if (remaining <= 0) return;
      const slice = line.slice(0, remaining);
      remaining -= line.length;
      ctx.fillStyle = idx === 4 ? COLORS.AMBER_CAUTION : COLORS.GREEN_PRIMARY;
      ctx.fillText(slice, bx + 22, ly);
    });

    const btnW = Math.min(430, baseW - 44);
    const btnH = 44;
    const btnX = w * 0.5 - btnW * 0.5;
    const btnY = by + baseH - 58;
    params.buttonsOut.push({
      id: 'boot-continue',
      rect: { x: btnX, y: btnY, width: btnW, height: btnH },
      label: '[SPACE / CLICK] ENTER COMMAND TERMINAL',
    });

    const hovered = params.hoveredButtonId === 'boot-continue';
    ctx.fillStyle = hovered ? 'rgba(54, 201, 94, 0.26)' : 'rgba(16, 42, 24, 0.88)';
    ctx.fillRect(btnX, btnY, btnW, btnH);
    ctx.strokeStyle = hovered ? COLORS.GREEN_BRIGHT : COLORS.AMBER_CAUTION;
    ctx.lineWidth = 2.6;
    ctx.strokeRect(btnX, btnY, btnW, btnH);

    ctx.font = 'bold 17px "Share Tech Mono", monospace';
    ctx.fillStyle = hovered ? COLORS.GREEN_BRIGHT : COLORS.AMBER_BRIGHT;
    ctx.textAlign = 'center';
    ctx.fillText('> [ SPACE / CLICK ] ENTER COMMAND TERMINAL <', w * 0.5, btnY + 28);

    ctx.restore();
  }

  private drawBrackets(
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

  private easeInOutSine(x: number): number {
    return -(Math.cos(Math.PI * x) - 1) * 0.5;
  }
}
