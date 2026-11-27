import { drawRankedHudPill } from '../RankedBadge';
import { drawEllipsizedText, font, isCrt1979Typography, THEME } from '../theme';
import {
  drawChromeButton,
  type ChromeButtonAccent,
  type ChromeButtonHitbox,
} from './ModalFrame';

export const TOP_CHROME_BAR_HEIGHT = 46;

export const TOP_CHROME_IDS = {
  CRT: 'chrome-crt',
  CONTROLS: 'chrome-controls',
  AUDIO: 'chrome-audio',
  MENU: 'chrome-menu',
  HUB: 'chrome-hub',
  DEMO_EXIT: 'chrome-demo-exit',
} as const;

export interface TopChromeBarOptions {
  /** Canonical program title (e.g. 'LUNAR LANDER', "HADLEY'S PERIMETER", 'FLAK NET', 'DERELICT TRENCH') */
  title: string;
  timeSec: number;
  isRanked?: boolean;
  showRankedBadge?: boolean;
  rankedCompact?: boolean;
  /** Compact run telemetry shown after the ranked pill (e.g. 'SEC 02 · 12,450 PTS') */
  telemetryText?: string;
  /** Whether heavy 1979 CRT Mode is active (defaults to global synced typography/CRT flag) */
  crt1979Enabled?: boolean;
  /** Left-most right-rail button label: '[H] CONTROLS' (default) or '[H] MANUAL' (Perimeter) */
  controlsLabel?: string;
  audioMuted: boolean;
  hoveredButtonId: string | null;
  /** When true, MU-TH-UR OS switches into a 1-click '[CONFIRM EXIT?]' breaker latch */
  confirmExitPending?: boolean;
  /** When true (e.g. Flak Tactical Demo), replaces MU-TH-UR OS with '[ESC] EXIT DEMO' */
  demoModeActive?: boolean;
  /** Optional custom button IDs if a cartridge prefers legacy IDs */
  buttonIds?: Partial<typeof TOP_CHROME_IDS>;
  /** Optional Y offset (default 0) */
  yOffset?: number;
}

export interface TopChromeBarMetrics {
  barH: number;
  rightRailX: number;
}

/**
 * Draws the unified 46px MU-TH-UR 6000 Top Chrome Bar shared across all 4 arcade programs:
 * - Far TOP-LEFT: Standardized `◄ MU-TH-UR OS` home/exit button (or inline `[CONFIRM EXIT?]` breaker latch)
 * - Left Zone: `<CANONICAL TITLE>` · Ranked Pill · Compact Telemetry
 * - Right Rail: Strict 3-pill utility bar (`[H] CONTROLS` | `AUDIO` | `[ESC] MENU`)
 */
export function drawTopChromeBar(
  ctx: CanvasRenderingContext2D,
  w: number,
  opts: TopChromeBarOptions,
  buttons: ChromeButtonHitbox[]
): TopChromeBarMetrics {
  const barH = TOP_CHROME_BAR_HEIGHT;
  const y0 = opts.yOffset ?? 0;
  const compact = w < 1060;
  const ultraCompact = w < 860;
  const ids = { ...TOP_CHROME_IDS, ...(opts.buttonIds ?? {}) };

  ctx.save();

  // Solid 46px CRT header bar with subtle bottom bezel separator
  ctx.fillStyle = 'rgba(4, 11, 7, 0.95)';
  ctx.fillRect(0, y0, w, barH);
  ctx.strokeStyle = THEME.BORDER_SUBTLE;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, y0 + barH - 0.5);
  ctx.lineTo(w, y0 + barH - 0.5);
  ctx.stroke();

  const pillH = 32;
  const pillY = y0 + Math.round((barH - pillH) * 0.5);
  const pillGap = compact ? 6 : 8;
  const padSide = compact ? 8 : 12;
  const pillFontPx = ultraCompact ? 12 : 13;

  // 1. Far TOP-LEFT standardized `◄ MU-TH-UR OS` anchor button (all 4 programs!)
  const hubId = opts.demoModeActive ? ids.DEMO_EXIT : ids.HUB;
  const hubText = opts.demoModeActive
    ? '[ESC] EXIT DEMO'
    : opts.confirmExitPending
      ? '[CONFIRM EXIT?]'
      : ultraCompact
        ? '◄ OS'
        : '◄ MU-TH-UR OS';
  const hubAccent: ChromeButtonAccent = opts.demoModeActive
    ? 'amber'
    : opts.confirmExitPending
      ? 'red'
      : 'green';

  ctx.font = pillFontPx >= 13 ? font('button', pillFontPx) : font('micro', 12);
  const hubMinW = opts.confirmExitPending ? 128 : ultraCompact ? 54 : 118;
  const hubW = Math.max(hubMinW, Math.ceil(ctx.measureText(hubText).width) + 24);
  drawChromeButton(
    ctx,
    { x: padSide, y: pillY, width: hubW, height: pillH },
    hubText,
    {
      id: hubId,
      accent: hubAccent,
      hovered: opts.hoveredButtonId === hubId,
      active: Boolean(opts.confirmExitPending && hubId === ids.HUB),
      fontPx: pillFontPx,
    },
    buttons
  );

  // 2. Right Rail: Clean 4-pill utility bar (1979 CRT: ON/OFF | [H] CONTROLS | AUDIO | [ESC] MENU)
  const crtOn = opts.crt1979Enabled ?? isCrt1979Typography();
  const crtText = ultraCompact
    ? crtOn
      ? '1979:ON'
      : '1979:OFF'
    : compact
      ? crtOn
        ? '1979: ON'
        : '1979: OFF'
      : crtOn
        ? '1979 CRT: ON'
        : '1979 CRT: OFF';

  const controlsBaseLabel = opts.controlsLabel ?? '[H] CONTROLS';
  const controlsText = ultraCompact
    ? '[H] HELP'
    : compact && controlsBaseLabel.length > 10
      ? controlsBaseLabel.replace('CONTROLS', 'KEYS')
      : controlsBaseLabel;

  const audioText = opts.audioMuted
    ? ultraCompact
      ? 'MUTED'
      : 'AUDIO: MUTED'
    : ultraCompact
      ? 'AUD: ON'
      : 'AUDIO: ON';

  const menuText = ultraCompact ? '[ESC]' : '[ESC] MENU';

  const pillDefs: Array<{
    id: string;
    label: string;
    accent: ChromeButtonAccent;
    active?: boolean;
    minW: number;
  }> = [
    {
      id: ids.CRT,
      label: crtText,
      accent: crtOn ? 'amber' : 'muted',
      active: crtOn,
      minW: ultraCompact ? 68 : 108,
    },
    { id: ids.CONTROLS, label: controlsText, accent: 'cyan', minW: ultraCompact ? 76 : 102 },
    {
      id: ids.AUDIO,
      label: audioText,
      accent: opts.audioMuted ? 'red' : 'green',
      minW: ultraCompact ? 68 : 96,
    },
    { id: ids.MENU, label: menuText, accent: 'amber', minW: ultraCompact ? 56 : 94 },
  ];

  let cursorX = w - padSide;
  for (let i = pillDefs.length - 1; i >= 0; i--) {
    const def = pillDefs[i];
    ctx.font = pillFontPx >= 13 ? font('button', pillFontPx) : font('micro', 12);
    const measured = Math.ceil(ctx.measureText(def.label).width) + 24;
    const pw = Math.max(def.minW, measured);
    cursorX -= pw;

    drawChromeButton(
      ctx,
      { x: cursorX, y: pillY, width: pw, height: pillH },
      def.label,
      {
        id: def.id,
        accent: def.accent,
        active: def.active,
        hovered: opts.hoveredButtonId === def.id,
        fontPx: pillFontPx,
      },
      buttons
    );

    cursorX -= pillGap;
  }

  const rightRailX = cursorX + pillGap;

  // 3. Left Zone (after MU-TH-UR OS pill): Divider · Canonical Title · Ranked Pill · Compact Telemetry
  let leftX = padSide + hubW + (compact ? 10 : 14);
  const maxLeftX = rightRailX - 12;
  const midY = y0 + barH * 0.5 + 0.5;

  if (maxLeftX > leftX + 40) {
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(leftX - (compact ? 5 : 7), y0 + 11);
    ctx.lineTo(leftX - (compact ? 5 : 7), y0 + barH - 11);
    ctx.stroke();

    ctx.font = font('head', compact ? 14 : 16);
    ctx.fillStyle = THEME.TEXT_PRIMARY;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const titleAvail = Math.max(40, maxLeftX - leftX);
    const titleUsed = drawEllipsizedText(ctx, opts.title, leftX, midY, titleAvail);
    leftX += Math.ceil(titleUsed) + 12;
  }

  if (opts.showRankedBadge !== false && maxLeftX - leftX >= 96) {
    const useCompactBadge = opts.rankedCompact ?? (compact || maxLeftX - leftX < 240);
    const badgeH = 26;
    const badgeY = y0 + Math.round((barH - badgeH) * 0.5);
    const usedW = drawRankedHudPill(
      ctx,
      leftX,
      badgeY,
      badgeH,
      opts.timeSec,
      opts.isRanked !== false,
      useCompactBadge
    );
    leftX += usedW + 12;
  }

  if (opts.telemetryText && maxLeftX - leftX >= 72) {
    // Subtle vertical divider
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(leftX - 6, y0 + 12);
    ctx.lineTo(leftX - 6, y0 + barH - 12);
    ctx.stroke();

    ctx.font = font('data', compact ? 12 : 13);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    drawEllipsizedText(ctx, opts.telemetryText, leftX + 2, midY, maxLeftX - leftX - 4);
  }

  ctx.restore();
  return { barH, rightRailX };
}
