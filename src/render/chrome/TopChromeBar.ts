import { drawRankedHudPill } from '../RankedBadge';
import { drawEllipsizedText, font, isCrt1979Typography, SEMIOTIC_ICONS, THEME } from '../theme';
import type { ViewportRect } from '../../types';
import {
  drawChromeButton,
  type ChromeButtonAccent,
  type ChromeButtonHitbox,
} from './ModalFrame';

export const TOP_CHROME_BAR_HEIGHT = 46;

export const TOP_CHROME_IDS = {
  CRT: 'chrome-crt',
  CONTROLS: 'chrome-controls',
  MUSIC: 'chrome-music',
  ATC: 'chrome-atc',
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
  /** When true, player started a Ranked run in 1979 Mode (+1.5x score) and cannot exit 1979 Mode until run ends */
  crtModeLocked?: boolean;
  /** Left-most right-rail button label: '[H] CONTROLS' (default) or '[H] MANUAL' (Perimeter) */
  controlsLabel?: string;
  audioMuted: boolean;
  /** Whether shared in-game background music is enabled (defaults to true) */
  musicEnabled?: boolean;
  /** Optional ATC / VHF radio mute state (when defined, renders a matching ATC toggle next to MUSIC & AUDIO) */
  atcMuted?: boolean;
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

  const hasAtc = opts.atcMuted !== undefined;
  const tightDesktop6 = hasAtc && !compact && w < 1340;
  const pillH = 32;
  const pillY = y0 + Math.round((barH - pillH) * 0.5);
  const pillGap = ultraCompact
    ? hasAtc
      ? 3
      : 4
    : compact
      ? hasAtc
        ? 4
        : 5
      : tightDesktop6
        ? 5
        : hasAtc
          ? 6
          : 7;
  const padSide = compact ? 8 : tightDesktop6 ? 10 : 12;
  const pillFontPx = ultraCompact || (hasAtc && compact) ? 12 : 13;
  const pillPadX = ultraCompact
    ? hasAtc
      ? 16
      : 18
    : compact
      ? 18
      : tightDesktop6
        ? 18
        : hasAtc
          ? 20
          : 22;

  // 1. Far TOP-LEFT standardized `◄ MU-TH-UR OS` anchor button (all 5 programs!)
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
  const hubMinW = opts.confirmExitPending ? 124 : ultraCompact ? 52 : hasAtc && compact ? 106 : 114;
  const hubW = Math.max(hubMinW, Math.ceil(ctx.measureText(hubText).width) + pillPadX);
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

  // 2. Right Rail: Clean utility bar (1979 CRT | [H] CONTROLS | MUSIC | [ATC] | AUDIO | [ESC] MENU)
  const crtOn = opts.crt1979Enabled ?? isCrt1979Typography();
  const crtLocked = Boolean(opts.crtModeLocked);
  const crtText = crtLocked
    ? crtOn
      ? ultraCompact
        ? '■ 1979'
        : compact
          ? '■ 1979 LOCK'
          : opts.isRanked !== false
            ? '■ 1979 · 1.5X LOCK'
            : '■ 1979 CRT: LOCK'
      : ultraCompact
        ? '■ CRT:OFF'
        : compact
          ? '■ CRT LOCK'
          : '■ 1979 CRT: OFF [LOCK]'
    : ultraCompact
      ? crtOn
        ? '1979:ON'
        : '1979:OFF'
      : compact
        ? crtOn
          ? '1979 1.5X'
          : '1979: OFF'
        : crtOn
          ? '1979 CRT: ON [1.5X]'
          : '1979 CRT: OFF';

  const controlsBaseLabel = opts.controlsLabel ?? '[H] CONTROLS';
  const controlsText = ultraCompact
    ? '[H] HELP'
    : compact && controlsBaseLabel.length > 10
      ? controlsBaseLabel.replace('CONTROLS', 'KEYS')
      : controlsBaseLabel;

  const musicOn = opts.musicEnabled ?? true;
  const musicText =
    compact || ultraCompact
      ? musicOn
        ? 'MUS: ON'
        : 'MUS: OFF'
      : musicOn
        ? 'MUSIC: ON'
        : 'MUSIC: OFF';

  const audioText = opts.audioMuted
    ? ultraCompact
      ? 'MUTED'
      : compact
        ? 'AUD: MUTE'
        : 'AUDIO: MUTED'
    : ultraCompact
      ? 'AUD: ON'
      : compact
        ? 'AUD: ON'
        : 'AUDIO: ON';

  const menuText = ultraCompact ? '[ESC]' : '[ESC] MENU';

  const pillDefs: Array<{
    id: string;
    label: string;
    accent: ChromeButtonAccent;
    active?: boolean;
    dimmed?: boolean;
    minW: number;
  }> = [
    {
      id: ids.CRT,
      label: crtText,
      accent: crtOn ? 'amber' : 'muted',
      active: crtOn,
      minW: ultraCompact ? (hasAtc ? 58 : 62) : compact ? (hasAtc ? 74 : 84) : tightDesktop6 ? 98 : 104,
    },
    {
      id: ids.CONTROLS,
      label: controlsText,
      accent: 'cyan',
      minW: ultraCompact ? (hasAtc ? 60 : 66) : compact ? (hasAtc ? 68 : 78) : tightDesktop6 ? 92 : 98,
    },
    {
      id: ids.MUSIC,
      label: musicText,
      accent: opts.audioMuted ? 'muted' : musicOn ? 'green' : 'amber',
      dimmed: opts.audioMuted,
      minW: ultraCompact ? (hasAtc ? 56 : 60) : compact ? (hasAtc ? 64 : 72) : tightDesktop6 ? 82 : 90,
    },
  ];

  if (hasAtc) {
    const atcMuted = Boolean(opts.atcMuted);
    const atcText =
      compact || ultraCompact
        ? atcMuted
          ? 'ATC: OFF'
          : 'ATC: ON'
        : atcMuted
          ? 'ATC: MUTED'
          : 'ATC: ON';
    pillDefs.push({
      id: ids.ATC,
      label: atcText,
      accent: opts.audioMuted ? 'muted' : atcMuted ? 'red' : 'green',
      dimmed: opts.audioMuted,
      minW: ultraCompact ? 56 : compact ? 64 : tightDesktop6 ? 72 : 78,
    });
  }

  pillDefs.push(
    {
      id: ids.AUDIO,
      label: audioText,
      accent: opts.audioMuted ? 'red' : 'green',
      minW: ultraCompact ? (hasAtc ? 54 : 58) : compact ? (hasAtc ? 64 : 72) : tightDesktop6 ? 84 : 92,
    },
    {
      id: ids.MENU,
      label: menuText,
      accent: 'amber',
      minW: ultraCompact ? (hasAtc ? 44 : 48) : compact ? (hasAtc ? 74 : 80) : tightDesktop6 ? 84 : 90,
    }
  );

  let cursorX = w - padSide;
  for (let i = pillDefs.length - 1; i >= 0; i--) {
    const def = pillDefs[i];
    ctx.font = pillFontPx >= 13 ? font('button', pillFontPx) : font('micro', 12);
    const measured = Math.ceil(ctx.measureText(def.label).width) + pillPadX;
    const pw = Math.max(def.minW, measured);
    cursorX -= pw;

    const isHovered = opts.hoveredButtonId === def.id;
    if (def.dimmed) {
      ctx.save();
      ctx.globalAlpha = isHovered ? 0.78 : 0.48;
    }
    drawChromeButton(
      ctx,
      { x: cursorX, y: pillY, width: pw, height: pillH },
      def.label,
      {
        id: def.id,
        accent: def.accent,
        active: def.active,
        hovered: isHovered,
        fontPx: pillFontPx,
      },
      buttons
    );
    if (def.dimmed) {
      ctx.restore();
    }

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

/**
 * Draws the super-obvious 1-click `[1979 MODE · 1.5X RANKED SCORE]` callout toggle bar
 * shared across all 4 games' Title/Briefing screens (wired directly to `TOP_CHROME_IDS.CRT`).
 */
export function draw1979RankedBonusBanner(
  ctx: CanvasRenderingContext2D,
  rect: ViewportRect,
  crtOn: boolean,
  hoveredButtonId: string | null,
  timeSec: number,
  buttons: ChromeButtonHitbox[],
  opts?: { id?: string; compact?: boolean }
): void {
  const id = opts?.id ?? TOP_CHROME_IDS.CRT;
  const hov = hoveredButtonId === id;
  const compact = Boolean(opts?.compact || rect.width < 520);
  const pulse = 0.5 + 0.5 * Math.sin(timeSec * 5.2);

  buttons.push({
    id,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    label: crtOn ? '1979 CRT BONUS ARMED (1.5X)' : 'ENABLE 1979 CRT FOR 1.5X RANKED SCORE',
  });

  ctx.save();
  if (crtOn) {
    ctx.fillStyle = hov
      ? 'rgba(116, 62, 6, 0.96)'
      : `rgba(82, 42, 4, ${(0.88 + pulse * 0.1).toFixed(3)})`;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = hov ? '#FFFFFF' : pulse > 0.5 ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;
    ctx.lineWidth = hov ? 2.2 : 1.8;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
  } else {
    ctx.fillStyle = hov ? 'rgba(66, 38, 6, 0.90)' : 'rgba(24, 16, 5, 0.88)';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = hov ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;
    ctx.lineWidth = hov ? 1.8 : 1.3;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
  }

  // Left accent bar
  ctx.fillStyle = crtOn ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;
  ctx.fillRect(rect.x, rect.y, 4, rect.height);

  // Right-side tactile switch pill
  const pillText = crtOn ? 'ON · 1.5X' : 'ENABLE 1.5X';
  ctx.font = font('micro', 12);
  const pillW = Math.max(compact ? 78 : 96, Math.ceil(ctx.measureText(pillText).width) + 16);
  const pillH = Math.max(20, rect.height - 8);
  const pillX = rect.x + rect.width - pillW - 6;
  const pillY = rect.y + Math.round((rect.height - pillH) * 0.5);

  ctx.fillStyle = crtOn ? THEME.ACCENT_AMBER : 'rgba(54, 30, 4, 0.92)';
  ctx.fillRect(pillX, pillY, pillW, pillH);
  ctx.strokeStyle = crtOn ? '#FFF4CC' : THEME.ACCENT_AMBER_HI;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(pillX + 0.5, pillY + 0.5, pillW - 1, pillH - 1);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = crtOn ? THEME.INK_INVERSE : THEME.ACCENT_AMBER_HI;
  ctx.fillText(pillText, pillX + pillW * 0.5, pillY + pillH * 0.5 + 0.5);

  // Left message (calibrated for zero truncation across Hub + all 4 games in both Clean & 1979 typography!)
  const msg = crtOn
    ? compact
      ? `${SEMIOTIC_ICONS.STAR} 1979 ARMED: 1.5X RANKED (LOCKED)`
      : `${SEMIOTIC_ICONS.STAR} 1979 CRT ARMED: 1.5X RANKED SCORE (LOCKED FOR RUN)`
    : compact
      ? `${SEMIOTIC_ICONS.STAR} 1979 MODE: +1.5X RANKED (LOCKED)`
      : `${SEMIOTIC_ICONS.STAR} 1979 CRT CHALLENGE: +1.5X RANKED SCORE (LOCKED FOR RUN)`;

  ctx.textAlign = 'left';
  ctx.font = font('data', 12);
  ctx.fillStyle = crtOn ? '#FFF6D6' : THEME.ACCENT_AMBER_HI;
  drawEllipsizedText(
    ctx,
    msg,
    rect.x + 12,
    rect.y + rect.height * 0.5 + 0.5,
    Math.max(80, pillX - rect.x - 18)
  );
  ctx.restore();
}
