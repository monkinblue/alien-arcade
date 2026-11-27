import type { ViewportRect } from '../types';

/**
 * Post-CRT WCAG-AA calibrated color palette for the MU-TH-UR 6000 Arcade System.
 * All foreground tokens account for ~24% CRT aperture-grille + scanline attenuation.
 */
export const THEME = {
  BG_VOID: '#030805',
  BG_PANEL: 'rgba(5, 15, 9, 0.94)',
  BG_PANEL_ELEVATED: 'rgba(8, 22, 13, 0.96)',
  BG_SCRIM: 'rgba(2, 6, 4, 0.82)',
  BG_ROW_ALT: 'rgba(14, 34, 21, 0.52)',
  BG_ROW_HOVER: 'rgba(255, 176, 0, 0.22)',
  BG_PILL: 'rgba(6, 18, 11, 0.92)',
  BG_PILL_HOVER: 'rgba(68, 255, 119, 0.22)',

  TEXT_PRIMARY: '#44FF77',
  TEXT_BRIGHT: '#9EF7B8',
  TEXT_SECONDARY: '#52B872',
  TEXT_MUTED: '#4E8A62',

  BORDER_SUBTLE: '#1C5C31',
  BORDER_ACTIVE: '#44FF77',

  ACCENT_AMBER: '#FFB000',
  ACCENT_AMBER_HI: '#FFE48F',
  ACCENT_AMBER_BG: 'rgba(54, 28, 4, 0.90)',

  ALERT_RED_TEXT: '#FF6247',
  ALERT_RED_STROKE: '#FF3318',
  ALERT_RED_BG: 'rgba(58, 12, 8, 0.92)',

  ACCENT_CYAN: '#4CEEFF',
  ACCENT_CYAN_BG: 'rgba(8, 34, 42, 0.88)',

  INK_INVERSE: '#040905',
  HALO_DARK: 'rgba(1, 6, 3, 0.72)',
} as const;

/**
 * Ron Cobb semiotic iconography for monochrome Amber-CRT & color-blind tactical clarity.
 */
export const SEMIOTIC_ICONS = {
  HEX: '⬡',
  DIAMOND: '◈',
  TRIANGLE: '▲',
  CROSS: '✚',
  SHIELD: '◈',
  STAR: '★',
  DOT_LIVE: '●',
  DOT_SYNC: '◌',
  DOT_LOCAL: '○',
  PLAY: '►',
  REPLAY: '↻',
} as const;

export type FontRole = 'display' | 'head' | 'button' | 'data' | 'micro' | 'prose';

const DEFAULT_ROLE_SIZE: Record<FontRole, number> = {
  display: 20,
  head: 16,
  button: 14,
  data: 13,
  micro: 12,
  prose: 14,
};

let crt1979TypographyActive = false;

/**
 * Syncs global 1979 CRT Terminal typography enlargement across the Hub and all 4 cartridges.
 * When active, terminal fonts render noticeably chunkier & larger (like a 1979 CRT monitor)
 * so glyphs cut crisply through heavy aperture grille, scanlines, and Gaussian halation.
 */
export function setCrt1979Typography(enabled: boolean): void {
  crt1979TypographyActive = enabled;
}

export function isCrt1979Typography(): boolean {
  return crt1979TypographyActive;
}

/**
 * Computes the clamped authored font size (px) guaranteeing effectivePx = px * scale >= 12.
 */
export function clampFontPx(sizePx: number, scale = 1): number {
  const safeScale = Math.max(0.5, scale);
  const floorPx = Math.ceil(12 / safeScale);
  return Math.max(floorPx, Math.round(sizePx));
}

/**
 * Unified post-CRT font helper:
 * - Enforces hard effectivePx >= 12px at every viewport scale.
 * - In 1979 CRT Mode, enlarges text ~14-18% with thick bold phosphor strokes (authentic old terminal feel).
 * - Never renders Share Tech Mono below 13px effective (automatically switches to JetBrains Mono).
 * - Always uses JetBrains Mono for data, micro, and prose roles.
 */
export function font(role: FontRole, sizePx?: number, scale = 1): string {
  const safeScale = Math.max(0.5, scale);
  let requested = sizePx ?? DEFAULT_ROLE_SIZE[role];
  if (crt1979TypographyActive) {
    // Taper boost slightly inside downscaled CAD sidebars so dense panels stay cleanly aligned
    const boostFactor = safeScale < 0.9 ? 0.65 : 1.0;
    const roleBoost =
      role === 'display' || role === 'head'
        ? requested * 0.16 + 0.8
        : role === 'data' || role === 'prose'
          ? requested * 0.15 + 0.6
          : role === 'button'
            ? requested * 0.12 + 0.5
            : requested * 0.13 + 0.4;
    requested += roleBoost * boostFactor;
  }

  const px = clampFontPx(requested, safeScale);
  const effectivePx = px * safeScale;

  const isDisplayFamily = role === 'display' || role === 'head' || role === 'button';
  const family =
    isDisplayFamily && effectivePx >= 13
      ? '"Share Tech Mono", "JetBrains Mono", monospace'
      : '"JetBrains Mono", monospace';
  const weight = role === 'prose' && !crt1979TypographyActive ? '600' : 'bold';

  return `${weight} ${px}px ${family}`;
}

/**
 * Wraps text into lines fitting within `maxWidth` using current `ctx.font`.
 * Respects explicit `\n` breaks and ellipsizes the final line if `maxLines` is reached.
 */
export function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines?: number
): string[] {
  const safeMaxW = Math.max(24, maxWidth);
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }
    const words = trimmed.split(/\s+/);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= safeMaxW) {
        current = candidate;
      } else if (!current) {
        // Hard-break single word wider than maxWidth
        let chunk = '';
        for (const ch of word) {
          if (ctx.measureText(chunk + ch).width > safeMaxW && chunk.length > 0) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) {
      lines.push(current);
    }
  }

  if (maxLines !== undefined && maxLines > 0 && lines.length > maxLines) {
    const clipped = lines.slice(0, maxLines);
    clipped[maxLines - 1] = ellipsizeString(ctx, clipped[maxLines - 1], safeMaxW);
    return clipped;
  }

  return lines;
}

/**
 * Returns `text` truncated with an ellipsis (`…`) if it exceeds `maxWidth`.
 */
export function ellipsizeString(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  const safeMaxW = Math.max(12, maxWidth);
  if (ctx.measureText(text).width <= safeMaxW) {
    return text;
  }
  const ellipsis = '…';
  const ellW = ctx.measureText(ellipsis).width;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid)).width + ellW <= safeMaxW) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo > 0 ? `${text.slice(0, lo).trimEnd()}${ellipsis}` : ellipsis;
}

/**
 * Draws text without horizontal squashing, cleanly ellipsizing if wider than `maxWidth`.
 * Returns the rendered text pixel width.
 */
export function drawEllipsizedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number
): number {
  const fitted = ellipsizeString(ctx, text, maxWidth);
  ctx.fillText(fitted, x, y);
  return ctx.measureText(fitted).width;
}

export interface KeycapOptions {
  height?: number;
  fontPx?: number;
  accent?: string;
  bg?: string;
  textColor?: string;
  padX?: number;
  /** If true, `y` is treated as vertical center instead of top edge. */
  centerY?: boolean;
}

/**
 * Draws a tactile 1979 Nostromo illuminated mechanical keycap badge.
 * Returns the total pixel width consumed so callers can chain keycaps + labels.
 */
export function drawKeycap(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  opts: KeycapOptions = {}
): number {
  const fontPx = clampFontPx(opts.fontPx ?? 12);
  const height = Math.max(18, opts.height ?? fontPx + 7);
  const padX = opts.padX ?? 6;
  const topY = opts.centerY ? Math.round(y - height * 0.5) : Math.round(y);
  const accent = opts.accent ?? THEME.ACCENT_AMBER;
  const bg = opts.bg ?? 'rgba(18, 28, 20, 0.96)';
  const textColor = opts.textColor ?? THEME.ACCENT_AMBER_HI;

  ctx.save();
  ctx.font = font('micro', fontPx);
  const textW = ctx.measureText(label).width;
  const capW = Math.max(height + 2, Math.ceil(textW + padX * 2));

  // Beveled dark keycap body
  ctx.fillStyle = bg;
  ctx.fillRect(x, topY, capW, height);

  // Subtle tactile lower key skirt
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(x + 1, topY + height - 2, capW - 2, 2);

  // Crisp illuminated legend rim
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x + 0.5, topY + 0.5, capW - 1, height - 1);

  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + capW * 0.5, topY + height * 0.5 + 0.5);
  ctx.restore();

  return capW;
}

/**
 * Draws crisp L-shaped 1979 Nostromo CAD corner brackets around a rectangle.
 */
export function drawCornerBrackets(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  len: number,
  color: string,
  lw = 2
): void {
  const clampedLen = Math.max(4, Math.min(len, w * 0.45, h * 0.45));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  // Top-left
  ctx.moveTo(x, y + clampedLen);
  ctx.lineTo(x, y);
  ctx.lineTo(x + clampedLen, y);
  // Top-right
  ctx.moveTo(x + w - clampedLen, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + clampedLen);
  // Bottom-left
  ctx.moveTo(x, y + h - clampedLen);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + clampedLen, y + h);
  // Bottom-right
  ctx.moveTo(x + w - clampedLen, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w, y + h - clampedLen);
  ctx.stroke();
  ctx.restore();
}

export type AnnunciatorLampState = 'OFF' | 'INFO' | 'CAUTION' | 'CRITICAL';

export interface AnnunciatorLamp {
  id?: string;
  label: string;
  state: AnnunciatorLampState;
  icon?: string;
  /** Optional explicit pulse override (defaults to pulsing when CRITICAL). */
  pulse?: boolean;
}

/**
 * Renders a Nostromo backlit aerospace glass annunciator strip.
 * Lamps stay calm, dark etched glass when OFF and illuminate crisply when tripped,
 * preventing floating warning banners from colliding with HUD readouts.
 */
export function drawAnnunciatorStrip(
  ctx: CanvasRenderingContext2D,
  lamps: readonly AnnunciatorLamp[],
  x: number,
  y: number,
  w: number,
  h: number,
  timeSec = 0
): void {
  if (lamps.length === 0 || w <= 0 || h <= 0) return;

  ctx.save();
  // Recessed dark aerospace lamp bezel tray
  ctx.fillStyle = 'rgba(3, 9, 6, 0.94)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = THEME.BORDER_SUBTLE;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  const pad = 3;
  const gap = 4;
  const innerW = Math.max(16, w - pad * 2);
  const innerH = Math.max(18, h - pad * 2);
  const tileW = (innerW - gap * (lamps.length - 1)) / lamps.length;
  const tileY = y + pad;

  const pulseFast = 0.5 + 0.5 * Math.sin(timeSec * 12.0);
  const pulseMed = 0.5 + 0.5 * Math.sin(timeSec * 6.5);

  ctx.font = font('micro', 12);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < lamps.length; i++) {
    const lamp = lamps[i];
    const tx = x + pad + i * (tileW + gap);
    const shouldPulse = lamp.pulse ?? lamp.state === 'CRITICAL';

    let bg = 'rgba(7, 16, 11, 0.90)';
    let border = 'rgba(28, 72, 42, 0.58)';
    let textCol: string = 'rgba(78, 138, 98, 0.65)';
    let innerGloss = 'rgba(68, 255, 119, 0.03)';

    if (lamp.state === 'CRITICAL') {
      const a = shouldPulse ? 0.72 + pulseFast * 0.26 : 0.92;
      bg = `rgba(92, 16, 10, ${a.toFixed(3)})`;
      border = shouldPulse && pulseFast > 0.55 ? '#FF947D' : THEME.ALERT_RED_STROKE;
      textCol = '#FFF0EC';
      innerGloss = 'rgba(255, 98, 71, 0.24)';
    } else if (lamp.state === 'CAUTION') {
      const a = shouldPulse ? 0.72 + pulseMed * 0.22 : 0.90;
      bg = `rgba(74, 40, 4, ${a.toFixed(3)})`;
      border = THEME.ACCENT_AMBER;
      textCol = THEME.ACCENT_AMBER_HI;
      innerGloss = 'rgba(255, 176, 0, 0.18)';
    } else if (lamp.state === 'INFO') {
      bg = THEME.ACCENT_CYAN_BG;
      border = THEME.ACCENT_CYAN;
      textCol = THEME.ACCENT_CYAN;
      innerGloss = 'rgba(76, 238, 255, 0.14)';
    }

    ctx.fillStyle = bg;
    ctx.fillRect(tx, tileY, tileW, innerH);

    // Top backlit glass highlight strip
    ctx.fillStyle = innerGloss;
    ctx.fillRect(tx + 1, tileY + 1, Math.max(0, tileW - 2), Math.max(2, Math.floor(innerH * 0.28)));

    ctx.strokeStyle = border;
    ctx.lineWidth = lamp.state === 'OFF' ? 1.0 : 1.7;
    ctx.strokeRect(tx + 0.5, tileY + 0.5, tileW - 1, innerH - 1);

    const text = lamp.icon ? `${lamp.icon} ${lamp.label}` : lamp.label;
    ctx.fillStyle = textCol;
    drawEllipsizedText(ctx, text, tx + tileW * 0.5, tileY + innerH * 0.5 + 0.5, tileW - 8);
  }

  ctx.restore();
}

/**
 * Convenience helper to create a ViewportRect.
 */
export function makeRect(x: number, y: number, width: number, height: number): ViewportRect {
  return { x, y, width, height };
}
