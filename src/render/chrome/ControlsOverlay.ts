import {
  drawEllipsizedText,
  drawKeycap,
  font,
  isCrt1979Typography,
  SEMIOTIC_ICONS,
  THEME,
  wrapTextLines,
} from '../theme';
import {
  drawChromeButton,
  drawModalFrame,
  type ChromeButtonHitbox,
  type ModalFrameMetrics,
} from './ModalFrame';

export const CONTROLS_STRIP_HEIGHT = 22;

export const CONTROLS_CARD_IDS = {
  CLOSE: 'controls-close',
  OPEN_WIKI: 'controls-open-wiki',
} as const;

export const PAUSE_BANNER_IDS = {
  RESUME: 'pause-resume',
  CONTROLS: 'pause-controls',
  MENU: 'pause-menu',
} as const;

export interface ControlsStripItem {
  key: string;
  label: string;
  accent?: 'green' | 'amber' | 'cyan';
}

/**
 * Draws the persistent 22px bottom controls strip (12px bold JetBrains Mono)
 * with tactile keycaps + concise labels — eliminates mid-game controls amnesia.
 */
export function drawPersistentControlsStrip(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  items: readonly ControlsStripItem[],
  yOverride?: number
): void {
  if (items.length === 0) return;

  const stripH = CONTROLS_STRIP_HEIGHT;
  const y = yOverride ?? h - stripH;
  const midY = y + stripH * 0.5;

  ctx.save();
  ctx.fillStyle = 'rgba(3, 10, 6, 0.94)';
  ctx.fillRect(0, y, w, stripH);

  ctx.strokeStyle = THEME.BORDER_SUBTLE;
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(0, y + 0.5);
  ctx.lineTo(w, y + 0.5);
  ctx.stroke();

  ctx.font = font('micro', 12);
  ctx.textBaseline = 'middle';

  // Measure total width first so we can center nicely when space permits
  const keyPad = 5;
  const itemGap = w < 1020 ? 10 : 14;
  const sepW = 5;

  const measured = items.map((item) => {
    const keyW = Math.max(18, Math.ceil(ctx.measureText(item.key).width + keyPad * 2));
    const labelW = Math.ceil(ctx.measureText(item.label).width);
    return { item, keyW, labelW, totalW: keyW + sepW + labelW };
  });

  const sumW =
    measured.reduce((acc, m) => acc + m.totalW, 0) + Math.max(0, measured.length - 1) * itemGap;
  let curX = sumW <= w - 24 ? Math.round((w - sumW) * 0.5) : 10;
  const maxX = w - 10;

  for (let i = 0; i < measured.length; i++) {
    const m = measured[i];
    if (curX + m.keyW + 18 > maxX) break;

    const accent =
      m.item.accent === 'cyan'
        ? THEME.ACCENT_CYAN
        : m.item.accent === 'green'
          ? THEME.TEXT_PRIMARY
          : THEME.ACCENT_AMBER;
    const textAccent =
      m.item.accent === 'cyan'
        ? THEME.ACCENT_CYAN
        : m.item.accent === 'green'
          ? THEME.TEXT_BRIGHT
          : THEME.ACCENT_AMBER_HI;

    const is1979 = isCrt1979Typography();
    const drawnKeyW = drawKeycap(ctx, m.item.key, curX, midY, {
      height: is1979 ? 19 : 18,
      fontPx: 12,
      padX: keyPad,
      accent,
      textColor: textAccent,
      centerY: true,
    });

    curX += drawnKeyW + sepW;
    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const remW = maxX - curX;
    if (remW > 12) {
      drawEllipsizedText(ctx, m.item.label, curX, midY + 0.5, remW);
    }
    curX += m.labelW + itemGap;
  }

  ctx.restore();
}

export interface ControlsCardEntry {
  keys: string;
  action: string;
}

export interface ControlsCardSpec {
  programTitle: string;
  subtitle?: string;
  leftColumnTitle?: string;
  rightColumnTitle?: string;
  leftControls: readonly ControlsCardEntry[];
  rightControls: readonly ControlsCardEntry[];
  /** 3 concise Sentence-Case scoring / survival rules */
  coreRules: readonly string[];
  hoveredButtonId: string | null;
  /** Optional button to open a full field manual (e.g. Perimeter Wiki) */
  wikiButtonLabel?: string;
  wikiButtonId?: string;
  closeButtonId?: string;
}

/**
 * Draws the unified `[H]` / `[?]` 1-Glance Controls Quick-Card (up to 820×500).
 * Pauses simulation cleanly, wraps key descriptions & tactical rules via `wrapTextLines()`
 * with zero ellipsis/clipping, and isolates modal hitboxes via `drawModalFrame`.
 */
export function drawControlsCardModal(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  spec: ControlsCardSpec,
  buttons: ChromeButtonHitbox[]
): ModalFrameMetrics {
  const modalW = Math.min(820, Math.max(320, w - 36));
  const modalH = Math.min(500, Math.max(300, h - 40));

  const metrics = drawModalFrame(
    ctx,
    w,
    h,
    {
      title: `CONTROLS QUICK-CARD // ${spec.programTitle}`,
      subtitle: spec.subtitle ?? 'SIMULATION PAUSED — PRESS [H] OR [ESC] TO RETURN TO ACTION',
      width: modalW,
      height: modalH,
      accentColor: THEME.ACCENT_CYAN,
      rightBadge: { text: `${SEMIOTIC_ICONS.DIAMOND} FIELD CARD`, tone: 'cyan' },
    },
    buttons
  );

  const { contentX, contentY, contentW, footerY } = metrics;
  const colGap = 14;
  const colW = Math.floor((contentW - colGap) * 0.5);
  const rightX = contentX + colW + colGap;
  const rightW = contentW - colW - colGap;

  // Pre-wrap tactical rule bullets cleanly (up to 2 lines each, zero mid-sentence truncation)
  const ruleLineStep = 17;
  const wrappedRules: string[][] = [];
  ctx.save();
  ctx.font = font('prose', 12);
  let totalRuleLines = 0;
  for (let i = 0; i < Math.min(3, spec.coreRules.length); i++) {
    const lines = wrapTextLines(ctx, `${i + 1}. ${spec.coreRules[i]}`, contentW - 24, 2);
    wrappedRules.push(lines);
    totalRuleLines += lines.length;
  }
  ctx.restore();

  const rulesNeededH = 28 + Math.max(1, totalRuleLines) * ruleLineStep + Math.max(0, wrappedRules.length - 1) * 4 + 8;
  const totalAvailH = Math.max(180, footerY - contentY - 10);
  const rulesAreaH = Math.min(Math.floor(totalAvailH * 0.44), Math.max(92, rulesNeededH));
  const colsAreaH = Math.max(130, totalAvailH - rulesAreaH - 10);

  const drawColumn = (
    x: number,
    y: number,
    cw: number,
    ch: number,
    title: string,
    entries: readonly ControlsCardEntry[]
  ) => {
    ctx.save();
    ctx.fillStyle = THEME.BG_ROW_ALT;
    ctx.fillRect(x, y, cw, ch);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);

    ctx.font = font('head', 13);
    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    drawEllipsizedText(ctx, title, x + 10, y + 15, cw - 20);

    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 27);
    ctx.lineTo(x + cw - 8, y + 27);
    ctx.stroke();

    // Pre-measure keycap widths and wrap action labels cleanly if a description is long
    ctx.font = font('micro', 12);
    const keyPad = 5;
    const measuredEntries = entries.map((entry) => {
      ctx.font = font('micro', 12);
      const rawKeyW = Math.max(20, Math.ceil(ctx.measureText(entry.keys).width + keyPad * 2));
      const labelOffset = Math.max(rawKeyW, 56) + 9;
      const labelW = Math.max(60, cw - 18 - labelOffset);
      ctx.font = font('prose', 12);
      const lines = wrapTextLines(ctx, entry.action, labelW, 2);
      return { entry, rawKeyW, labelOffset, lines };
    });

    const bodyTop = y + 32;
    const bodyAvailH = Math.max(40, ch - 36);
    const totalWeight = measuredEntries.reduce((acc, m) => acc + (m.lines.length > 1 ? 1.45 : 1), 0) || 1;
    const unitH = bodyAvailH / totalWeight;

    let curRowTop = bodyTop;
    for (const m of measuredEntries) {
      const slotH = Math.max(22, Math.min(m.lines.length > 1 ? 38 : 30, unitH * (m.lines.length > 1 ? 1.45 : 1)));
      if (curRowTop + 14 > y + ch) break;
      const midY = curRowTop + slotH * 0.5;

      drawKeycap(ctx, m.entry.keys, x + 9, midY, {
        height: 20,
        fontPx: 12,
        padX: keyPad,
        centerY: true,
      });

      const labelX = x + 9 + m.labelOffset;
      ctx.font = font('prose', 12);
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      if (m.lines.length <= 1) {
        ctx.fillText(m.lines[0] ?? '', labelX, midY + 0.5);
      } else {
        const lineGap = 14;
        ctx.fillText(m.lines[0], labelX, midY - lineGap * 0.5 + 0.5);
        ctx.fillText(m.lines[1], labelX, midY + lineGap * 0.5 + 0.5);
      }

      curRowTop += slotH;
    }
    ctx.restore();
  };

  drawColumn(
    contentX,
    contentY,
    colW,
    colsAreaH,
    spec.leftColumnTitle ?? 'PRIMARY FLIGHT & COMBAT',
    spec.leftControls
  );
  drawColumn(
    rightX,
    contentY,
    rightW,
    colsAreaH,
    spec.rightColumnTitle ?? 'TACTICAL & SYSTEM KEYS',
    spec.rightControls
  );

  // Core Field Rules Box (cleanly wrapped via wrapTextLines — zero right-edge clipping!)
  const rulesY = contentY + colsAreaH + 10;
  ctx.save();
  ctx.fillStyle = 'rgba(6, 18, 12, 0.90)';
  ctx.fillRect(contentX, rulesY, contentW, rulesAreaH);
  ctx.strokeStyle = THEME.BORDER_SUBTLE;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(contentX + 0.5, rulesY + 0.5, contentW - 1, rulesAreaH - 1);

  ctx.font = font('micro', 12);
  ctx.fillStyle = THEME.ACCENT_CYAN;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('CORE TACTICAL RULES', contentX + 12, rulesY + 14);

  ctx.font = font('prose', 12);
  ctx.fillStyle = THEME.TEXT_BRIGHT;
  let ruleY = rulesY + 32;
  for (let i = 0; i < wrappedRules.length; i++) {
    const lines = wrappedRules[i];
    for (const line of lines) {
      if (ruleY > rulesY + rulesAreaH - 6) break;
      ctx.fillText(line, contentX + 12, ruleY);
      ruleY += ruleLineStep;
    }
    ruleY += 3;
  }
  ctx.restore();

  // Footer
  const closeId = spec.closeButtonId ?? CONTROLS_CARD_IDS.CLOSE;
  const wikiId = spec.wikiButtonId ?? CONTROLS_CARD_IDS.OPEN_WIKI;
  const btnH = 36;

  if (spec.wikiButtonLabel) {
    const wikiW = Math.min(240, Math.floor(contentW * 0.46));
    const closeW = Math.min(200, Math.floor(contentW * 0.42));
    drawChromeButton(
      ctx,
      { x: contentX, y: footerY, width: wikiW, height: btnH },
      spec.wikiButtonLabel,
      {
        id: wikiId,
        accent: 'amber',
        hovered: spec.hoveredButtonId === wikiId,
        fontPx: 13,
      },
      buttons
    );
    drawChromeButton(
      ctx,
      { x: contentX + contentW - closeW, y: footerY, width: closeW, height: btnH },
      '[H / ESC] CLOSE',
      {
        id: closeId,
        accent: 'green',
        hovered: spec.hoveredButtonId === closeId,
        fontPx: 13,
      },
      buttons
    );
  } else {
    const closeW = Math.min(220, contentW);
    drawChromeButton(
      ctx,
      {
        x: contentX + Math.round((contentW - closeW) * 0.5),
        y: footerY,
        width: closeW,
        height: btnH,
      },
      '[H / ESC] CLOSE',
      {
        id: closeId,
        accent: 'green',
        hovered: spec.hoveredButtonId === closeId,
        fontPx: 13,
      },
      buttons
    );
  }

  return metrics;
}

/**
 * Draws the shared Amber CRT `[P]` Quick-Pause Banner across all 4 arcade programs.
 */
export function drawPauseBanner(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  subtitle: string,
  buttons: ChromeButtonHitbox[],
  hoveredButtonId: string | null = null,
  timeSec = 0
): ModalFrameMetrics {
  const pulse = 0.55 + 0.45 * Math.sin(timeSec * 4.5);
  const metrics = drawModalFrame(
    ctx,
    w,
    h,
    {
      title: 'SIMULATION PAUSED',
      subtitle: 'TELEMETRY HOLD ENGAGED',
      maxWidth: 520,
      maxHeight: 210,
      accentColor: pulse > 0.5 ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER,
      rightBadge: { text: '[P] HOLD', tone: 'amber' },
    },
    buttons
  );

  const { contentX, contentY, contentW, footerY } = metrics;

  ctx.save();
  ctx.font = font('prose', 14);
  ctx.fillStyle = THEME.TEXT_BRIGHT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapTextLines(
    ctx,
    subtitle || 'Press [P] to resume action, [H] for Controls, or [ESC] for System Menu.',
    contentW - 12,
    2
  );
  const startY = contentY + (lines.length === 1 ? 24 : 14);
  lines.forEach((line, idx) => {
    ctx.fillText(line, contentX + contentW * 0.5, startY + idx * 22);
  });
  ctx.restore();

  const btnGap = 8;
  const btnH = 36;
  const btnW = Math.floor((contentW - btnGap * 2) / 3);

  drawChromeButton(
    ctx,
    { x: contentX, y: footerY, width: btnW, height: btnH },
    `${SEMIOTIC_ICONS.PLAY} RESUME [P]`,
    {
      id: PAUSE_BANNER_IDS.RESUME,
      accent: 'green',
      active: true,
      hovered: hoveredButtonId === PAUSE_BANNER_IDS.RESUME,
      fontPx: 13,
    },
    buttons
  );

  drawChromeButton(
    ctx,
    { x: contentX + btnW + btnGap, y: footerY, width: btnW, height: btnH },
    '[H] CONTROLS',
    {
      id: PAUSE_BANNER_IDS.CONTROLS,
      accent: 'cyan',
      hovered: hoveredButtonId === PAUSE_BANNER_IDS.CONTROLS,
      fontPx: 13,
    },
    buttons
  );

  drawChromeButton(
    ctx,
    {
      x: contentX + (btnW + btnGap) * 2,
      y: footerY,
      width: contentW - (btnW + btnGap) * 2,
      height: btnH,
    },
    '[ESC] MENU',
    {
      id: PAUSE_BANNER_IDS.MENU,
      accent: 'amber',
      hovered: hoveredButtonId === PAUSE_BANNER_IDS.MENU,
      fontPx: 13,
    },
    buttons
  );

  return metrics;
}

/**
 * Renders a transient centered MU-TH-UR status toast (e.g. Audio Mute or Pitch Axis toggle).
 */
export function drawStatusToast(
  ctx: CanvasRenderingContext2D,
  w: number,
  y: number,
  text: string,
  tone: 'green' | 'amber' | 'red' | 'cyan' = 'amber',
  alpha = 1
): void {
  if (!text || alpha <= 0.01) return;
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const colorMap = {
    green: { bg: 'rgba(6, 24, 12, 0.94)', border: THEME.TEXT_PRIMARY, text: THEME.TEXT_BRIGHT },
    amber: { bg: THEME.ACCENT_AMBER_BG, border: THEME.ACCENT_AMBER, text: THEME.ACCENT_AMBER_HI },
    red: { bg: THEME.ALERT_RED_BG, border: THEME.ALERT_RED_STROKE, text: '#FFE8E2' },
    cyan: { bg: THEME.ACCENT_CYAN_BG, border: THEME.ACCENT_CYAN, text: THEME.ACCENT_CYAN },
  }[tone];

  ctx.save();
  ctx.globalAlpha = clampedAlpha;
  ctx.font = font('button', 14);
  const pillW = Math.min(w - 32, Math.ceil(ctx.measureText(text).width + 32));
  const pillH = 32;
  const px = Math.round((w - pillW) * 0.5);

  ctx.fillStyle = colorMap.bg;
  ctx.fillRect(px, y, pillW, pillH);
  ctx.strokeStyle = colorMap.border;
  ctx.lineWidth = 1.8;
  ctx.strokeRect(px + 0.5, y + 0.5, pillW - 1, pillH - 1);

  ctx.fillStyle = colorMap.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawEllipsizedText(ctx, text, px + pillW * 0.5, y + pillH * 0.5 + 0.5, pillW - 16);
  ctx.restore();
}
