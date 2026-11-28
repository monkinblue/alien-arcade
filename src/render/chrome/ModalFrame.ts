import type { ViewportRect } from '../../types';
import {
  drawCornerBrackets,
  drawEllipsizedText,
  font,
  SEMIOTIC_ICONS,
  THEME,
} from '../theme';

/**
 * Standardized interactive hitbox pushed by all shared chrome helpers.
 * Structurally compatible with `CrtInteractiveButton` across all 4 games.
 */
export interface ChromeButtonHitbox {
  id: string;
  rect: ViewportRect;
  label: string;
  disabled?: boolean;
}

/**
 * Hit-tests a button array from top-most to bottom-most, ignoring disabled hitboxes.
 */
export function hitTestChromeButtons(
  buttons: readonly ChromeButtonHitbox[],
  cx: number,
  cy: number
): string | null {
  for (let i = buttons.length - 1; i >= 0; i--) {
    const b = buttons[i];
    if (b.disabled) continue;
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

export type ModalBadgeTone = 'live' | 'sync' | 'local' | 'amber' | 'red' | 'cyan';

export interface ModalRightBadge {
  text: string;
  tone?: ModalBadgeTone;
}

export interface ModalFrameOptions {
  title: string;
  subtitle?: string;
  maxWidth?: number;
  maxHeight?: number;
  width?: number;
  height?: number;
  accentColor?: string;
  rightBadge?: ModalRightBadge;
  /**
   * Optional top Y coordinate below which the modal scrim & centering live
   * (e.g., `TOP_CHROME_BAR_HEIGHT` so the top navigation bar stays bright and clickable).
   */
  scrimTopY?: number;
  /**
   * Default `true`: clears `buttons.length = 0` before drawing modal controls so
   * underlying HUD buttons can NEVER leak clicks behind an open modal.
   */
  isolateHitboxes?: boolean;
}

export interface ModalFrameMetrics {
  bx: number;
  by: number;
  boxW: number;
  boxH: number;
  contentX: number;
  contentY: number;
  contentW: number;
  footerY: number;
}

/**
 * Draws the shared dimmed scrim, beveled Nostromo CRT modal panel, corner brackets,
 * header title, optional right uplink/status pill, and ALWAYS isolates modal hitboxes
 * (`buttons.length = 0`) unless explicitly disabled.
 */
export function drawModalFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: ModalFrameOptions,
  buttons: ChromeButtonHitbox[]
): ModalFrameMetrics {
  if (opts.isolateHitboxes !== false) {
    buttons.length = 0;
  }

  const scrimTop = Math.max(0, Math.min(h - 200, opts.scrimTopY ?? 0));
  const availH = h - scrimTop;
  const boxW = Math.max(300, Math.min(opts.width ?? opts.maxWidth ?? 680, w - 24));
  const boxH = Math.max(180, Math.min(opts.height ?? opts.maxHeight ?? 480, availH - 24));
  const bx = Math.round((w - boxW) * 0.5);
  const by = scrimTop + Math.round((availH - boxH) * 0.5);
  const accent = opts.accentColor ?? THEME.TEXT_PRIMARY;
  const padX = 20;

  ctx.save();

  // Dimmed backdrop scrim (prevents visual bleed from underlying cockpit/radar)
  ctx.fillStyle = THEME.BG_SCRIM;
  ctx.fillRect(0, scrimTop, w, h - scrimTop);

  // Main beveled CRT panel body
  ctx.fillStyle = THEME.BG_PANEL;
  ctx.fillRect(bx, by, boxW, boxH);

  // Subtle recessed inner frame
  ctx.strokeStyle = THEME.BORDER_SUBTLE;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);

  // Crisp 1979 corner brackets
  drawCornerBrackets(ctx, bx, by, boxW, boxH, 18, accent, 2.4);

  // Header band
  const hasSubtitle = Boolean(opts.subtitle);
  const headerH = hasSubtitle ? 56 : 44;
  ctx.fillStyle = 'rgba(10, 26, 16, 0.72)';
  ctx.fillRect(bx + 2, by + 2, boxW - 4, headerH - 2);

  // Optional right status / uplink pill in header
  let rightReservedW = 0;
  if (opts.rightBadge) {
    const badge = opts.rightBadge;
    const tone = badge.tone ?? 'live';
    const badgeColors: Record<ModalBadgeTone, { bg: string; border: string; text: string }> = {
      live: {
        bg: 'rgba(10, 36, 18, 0.92)',
        border: THEME.TEXT_PRIMARY,
        text: THEME.TEXT_BRIGHT,
      },
      sync: {
        bg: THEME.ACCENT_AMBER_BG,
        border: THEME.ACCENT_AMBER,
        text: THEME.ACCENT_AMBER_HI,
      },
      local: {
        bg: 'rgba(16, 28, 20, 0.92)',
        border: THEME.TEXT_MUTED,
        text: THEME.TEXT_SECONDARY,
      },
      amber: {
        bg: THEME.ACCENT_AMBER_BG,
        border: THEME.ACCENT_AMBER,
        text: THEME.ACCENT_AMBER_HI,
      },
      red: {
        bg: THEME.ALERT_RED_BG,
        border: THEME.ALERT_RED_STROKE,
        text: THEME.ALERT_RED_TEXT,
      },
      cyan: {
        bg: THEME.ACCENT_CYAN_BG,
        border: THEME.ACCENT_CYAN,
        text: THEME.ACCENT_CYAN,
      },
    };
    const bc = badgeColors[tone];
    ctx.font = font('micro', 12);
    const pillW = Math.min(Math.ceil(ctx.measureText(badge.text).width + 18), Math.floor(boxW * 0.44));
    const pillH = 24;
    const pillX = bx + boxW - padX - pillW;
    const pillY = by + Math.round((headerH - pillH) * 0.5);

    ctx.fillStyle = bc.bg;
    ctx.fillRect(pillX, pillY, pillW, pillH);
    ctx.strokeStyle = bc.border;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(pillX + 0.5, pillY + 0.5, pillW - 1, pillH - 1);

    ctx.fillStyle = bc.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawEllipsizedText(ctx, badge.text, pillX + pillW * 0.5, pillY + pillH * 0.5 + 0.5, pillW - 10);
    rightReservedW = pillW + 12;
  }

  // Modal Title
  const titleMaxW = Math.max(120, boxW - padX * 2 - rightReservedW);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font('display', 18);
  ctx.fillStyle = accent === THEME.TEXT_PRIMARY ? THEME.TEXT_BRIGHT : accent;
  drawEllipsizedText(
    ctx,
    opts.title,
    bx + padX,
    by + (hasSubtitle ? 21 : headerH * 0.5 + 1),
    titleMaxW
  );

  if (opts.subtitle) {
    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    drawEllipsizedText(ctx, opts.subtitle, bx + padX, by + 42, titleMaxW);
  }

  // Header separator rule
  ctx.strokeStyle = THEME.BORDER_SUBTLE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bx + 12, by + headerH);
  ctx.lineTo(bx + boxW - 12, by + headerH);
  ctx.stroke();

  ctx.restore();

  return {
    bx,
    by,
    boxW,
    boxH,
    contentX: bx + padX,
    contentY: by + headerH + 14,
    contentW: boxW - padX * 2,
    footerY: by + boxH - 52,
  };
}

export type ChromeButtonAccent = 'green' | 'amber' | 'red' | 'cyan' | 'muted';

export interface ChromeButtonDrawOptions {
  id: string;
  accent?: ChromeButtonAccent;
  hovered?: boolean;
  active?: boolean;
  disabled?: boolean;
  fontPx?: number;
  align?: 'center' | 'left';
  subLabel?: string;
}

/**
 * Renders a crisp backlit 1979 MU-TH-UR hardware button and pushes its hitbox into `buttons`.
 */
export function drawChromeButton(
  ctx: CanvasRenderingContext2D,
  rect: ViewportRect,
  label: string,
  opts: ChromeButtonDrawOptions,
  buttons: ChromeButtonHitbox[]
): void {
  const accent = opts.accent ?? 'green';
  const disabled = Boolean(opts.disabled);
  const hovered = !disabled && Boolean(opts.hovered);
  const active = Boolean(opts.active);

  buttons.push({
    id: opts.id,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    label,
    ...(disabled ? { disabled: true } : {}),
  });

  const palette: Record<
    ChromeButtonAccent,
    { bg: string; bgHov: string; bgAct: string; border: string; text: string }
  > = {
    green: {
      bg: 'rgba(6, 20, 12, 0.92)',
      bgHov: 'rgba(34, 96, 52, 0.56)',
      bgAct: 'rgba(26, 86, 44, 0.78)',
      border: THEME.TEXT_PRIMARY,
      text: THEME.TEXT_BRIGHT,
    },
    amber: {
      bg: 'rgba(42, 22, 4, 0.92)',
      bgHov: 'rgba(98, 56, 8, 0.74)',
      bgAct: 'rgba(84, 46, 6, 0.88)',
      border: THEME.ACCENT_AMBER,
      text: THEME.ACCENT_AMBER_HI,
    },
    red: {
      bg: THEME.ALERT_RED_BG,
      bgHov: 'rgba(116, 24, 16, 0.88)',
      bgAct: 'rgba(96, 18, 12, 0.94)',
      border: THEME.ALERT_RED_STROKE,
      text: '#FFE6E0',
    },
    cyan: {
      bg: THEME.ACCENT_CYAN_BG,
      bgHov: 'rgba(18, 72, 86, 0.76)',
      bgAct: 'rgba(14, 62, 76, 0.90)',
      border: THEME.ACCENT_CYAN,
      text: THEME.ACCENT_CYAN,
    },
    muted: {
      bg: 'rgba(8, 18, 12, 0.86)',
      bgHov: 'rgba(24, 52, 34, 0.65)',
      bgAct: 'rgba(20, 44, 28, 0.85)',
      border: THEME.BORDER_SUBTLE,
      text: THEME.TEXT_SECONDARY,
    },
  };

  const p = palette[accent];

  ctx.save();
  if (disabled) {
    ctx.fillStyle = 'rgba(6, 14, 9, 0.72)';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = 'rgba(36, 74, 48, 0.62)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
  } else {
    ctx.fillStyle = hovered ? p.bgHov : active ? p.bgAct : p.bg;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = hovered ? '#FFFFFF' : p.border;
    ctx.lineWidth = hovered || active ? 2.0 : 1.5;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
  }

  const fontPx = Math.max(12, opts.fontPx ?? 13);
  ctx.font = fontPx >= 13 ? font('button', fontPx) : font('micro', 12);
  ctx.fillStyle = disabled ? THEME.TEXT_MUTED : hovered ? '#FFFFFF' : p.text;
  ctx.textBaseline = 'middle';

  const pad = 8;
  const textY = opts.subLabel ? rect.y + rect.height * 0.37 : rect.y + rect.height * 0.5 + 0.5;
  if (opts.align === 'left') {
    ctx.textAlign = 'left';
    drawEllipsizedText(ctx, label, rect.x + pad, textY, rect.width - pad * 2);
  } else {
    ctx.textAlign = 'center';
    drawEllipsizedText(ctx, label, rect.x + rect.width * 0.5, textY, rect.width - pad * 2);
  }

  if (opts.subLabel) {
    ctx.font = font('micro', 12);
    ctx.fillStyle = disabled ? THEME.TEXT_MUTED : THEME.TEXT_SECONDARY;
    const subY = rect.y + rect.height * 0.73;
    if (opts.align === 'left') {
      ctx.textAlign = 'left';
      drawEllipsizedText(ctx, opts.subLabel, rect.x + pad, subY, rect.width - pad * 2);
    } else {
      ctx.textAlign = 'center';
      drawEllipsizedText(ctx, opts.subLabel, rect.x + rect.width * 0.5, subY, rect.width - pad * 2);
    }
  }

  ctx.restore();
}

export function formatUplinkBadge(status: 'LIVE' | 'SYNCING' | 'LOCAL'): ModalRightBadge {
  if (status === 'LIVE') {
    return { text: `${SEMIOTIC_ICONS.DOT_LIVE} ORBITAL RELAY: LIVE`, tone: 'live' };
  }
  if (status === 'SYNCING') {
    return { text: `${SEMIOTIC_ICONS.DOT_SYNC} SYNCING RELAY...`, tone: 'sync' };
  }
  return { text: `${SEMIOTIC_ICONS.DOT_LOCAL} LOCAL TAPE ARCHIVE`, tone: 'local' };
}
