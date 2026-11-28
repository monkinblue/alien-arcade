import {
  drawEllipsizedText,
  font,
  SEMIOTIC_ICONS,
  THEME,
  wrapTextLines,
} from '../theme';
import {
  drawChromeButton,
  drawModalFrame,
  formatUplinkBadge,
  type ChromeButtonAccent,
  type ChromeButtonHitbox,
  type ModalFrameMetrics,
} from './ModalFrame';

export const POST_RUN_IDS = {
  CALLSIGN_BOX: 'postrun-callsign-box',
  SUBMIT_SCORE: 'postrun-submit',
  PLAY_AGAIN: 'postrun-play-again',
  GAME_MENU: 'postrun-game-menu',
  EXIT_HUB: 'postrun-exit-hub',
  OPEN_MANIFEST: 'postrun-open-manifest',
  MANIFEST_TAB_PREFIX: 'manifest-tab-',
  MANIFEST_PLAY_AGAIN: 'manifest-play-again',
  MANIFEST_CLOSE: 'manifest-close',
} as const;

export interface DebriefStatCard {
  label: string;
  value: string;
  accent?: 'green' | 'amber' | 'red' | 'cyan';
}

export interface GameOverDebriefOptions {
  title: string;
  subtitle?: string;
  outcomeTone?: 'red' | 'amber' | 'green';
  timeSec: number;
  /** Visual keylock countdown remaining (seconds). While > 0, dims & disables action buttons! */
  keylockRemainingSec: number;
  /** Up to 4 stat cards rendered in a crisp horizontal row */
  stats: readonly DebriefStatCard[];
  isRanked: boolean;
  score: number;
  callsignDraft: string;
  callsignEditing: boolean;
  scoreSubmitted: boolean;
  submittingScore: boolean;
  /** Visible rejection/cooldown/confirmation banner rendered on BOTH desktop and mobile */
  statusBanner?: string | null;
  statusBannerTone?: 'green' | 'amber' | 'red';
  hoveredButtonId: string | null;
  playAgainLabel?: string;
  submitLabel?: string;
  showViewManifestButton?: boolean;
}

/**
 * Draws the unified 640×430 Post-Run Debrief + Inline Callsign Modal shared across all 4 games.
 * - Visual KEYLOCK countdown dimming prevents accidental misfires on run end
 * - Opt-in `[C]` / click callsign editing prevents typing collisions with `[R]` instant replay
 * - Always shows `statusBanner` validation/cooldown errors on desktop AND mobile
 */
export function drawGameOverDebriefModal(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: GameOverDebriefOptions,
  buttons: ChromeButtonHitbox[]
): ModalFrameMetrics {
  const locked = opts.keylockRemainingSec > 0.01;
  const accentColor =
    opts.outcomeTone === 'green'
      ? THEME.TEXT_PRIMARY
      : opts.outcomeTone === 'amber'
        ? THEME.ACCENT_AMBER
        : THEME.ALERT_RED_STROKE;

  const badge = locked
    ? { text: `KEYLOCK ${opts.keylockRemainingSec.toFixed(1)}S`, tone: 'amber' as const }
    : opts.isRanked
      ? { text: `${SEMIOTIC_ICONS.STAR} RANKED RECORD`, tone: 'amber' as const }
      : { text: 'PRACTICE RUN', tone: 'local' as const };

  const metrics = drawModalFrame(
    ctx,
    w,
    h,
    {
      title: opts.title,
      subtitle: opts.subtitle,
      maxWidth: 680,
      maxHeight: 430,
      accentColor,
      rightBadge: badge,
    },
    buttons
  );

  const { contentX, contentY, contentW, footerY } = metrics;
  let curY = contentY;

  // 1. 4 Stat Cards Row
  const cards = opts.stats.slice(0, 4);
  if (cards.length > 0) {
    const cardGap = 8;
    const cardH = 66;
    const cardW = Math.floor((contentW - cardGap * (cards.length - 1)) / cards.length);

    cards.forEach((card, idx) => {
      const cx = contentX + idx * (cardW + cardGap);
      const cw = idx === cards.length - 1 ? contentW - (cardW + cardGap) * idx : cardW;
      const valCol =
        card.accent === 'amber'
          ? THEME.ACCENT_AMBER_HI
          : card.accent === 'red'
            ? THEME.ALERT_RED_TEXT
            : card.accent === 'cyan'
              ? THEME.ACCENT_CYAN
              : THEME.TEXT_PRIMARY;

      ctx.save();
      ctx.fillStyle = THEME.BG_ROW_ALT;
      ctx.fillRect(cx, curY, cw, cardH);
      ctx.strokeStyle = THEME.BORDER_SUBTLE;
      ctx.lineWidth = 1.3;
      ctx.strokeRect(cx + 0.5, curY + 0.5, cw - 1, cardH - 1);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = font('micro', 12);
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      drawEllipsizedText(ctx, card.label, cx + cw * 0.5, curY + 19, cw - 12);

      ctx.font = font('display', 19);
      ctx.fillStyle = valCol;
      drawEllipsizedText(ctx, card.value, cx + cw * 0.5, curY + 46, cw - 12);
      ctx.restore();
    });
    curY += cardH + 14;
  }

  // 2. Inline Pre-Filled Callsign Uplink Panel (or Unranked Notice)
  if (opts.isRanked) {
    const panelH = Math.max(106, footerY - curY - 14);
    ctx.save();
    ctx.fillStyle = 'rgba(6, 18, 11, 0.92)';
    ctx.fillRect(contentX, curY, contentW, panelH);
    ctx.strokeStyle = opts.callsignEditing ? THEME.ACCENT_AMBER : THEME.BORDER_SUBTLE;
    ctx.lineWidth = opts.callsignEditing ? 1.8 : 1.3;
    ctx.strokeRect(contentX + 0.5, curY + 0.5, contentW - 1, panelH - 1);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = font('micro', 12);
    ctx.fillStyle = opts.callsignEditing ? THEME.ACCENT_AMBER_HI : THEME.TEXT_SECONDARY;
    drawEllipsizedText(
      ctx,
      opts.scoreSubmitted
        ? 'ORBITAL TELEMETRY LOGGED'
        : opts.callsignEditing
          ? 'EDITING CALLSIGN — TYPE A-Z / 0-9, PRESS [ENTER] TO CONFIRM'
          : 'PILOT CALLSIGN — CLICK BOX OR PRESS [C] TO EDIT',
      contentX + 12,
      curY + 18,
      contentW - 24
    );
    ctx.restore();

    // Clickable Callsign Input Box
    const inputX = contentX + 12;
    const inputY = curY + 32;
    const inputW = contentW - 24;
    const inputH = 38;
    const boxHovered =
      !locked &&
      !opts.scoreSubmitted &&
      !opts.submittingScore &&
      opts.hoveredButtonId === POST_RUN_IDS.CALLSIGN_BOX;

    if (!opts.scoreSubmitted && !opts.submittingScore) {
      buttons.push({
        id: POST_RUN_IDS.CALLSIGN_BOX,
        rect: { x: inputX, y: inputY, width: inputW, height: inputH },
        label: 'EDIT CALLSIGN',
        ...(locked ? { disabled: true } : {}),
      });
    }

    ctx.save();
    ctx.fillStyle = opts.callsignEditing
      ? 'rgba(42, 24, 4, 0.92)'
      : boxHovered
        ? 'rgba(18, 44, 26, 0.85)'
        : 'rgba(3, 10, 6, 0.96)';
    ctx.fillRect(inputX, inputY, inputW, inputH);
    ctx.strokeStyle = opts.callsignEditing
      ? THEME.ACCENT_AMBER_HI
      : boxHovered
        ? '#FFFFFF'
        : THEME.TEXT_PRIMARY;
    ctx.lineWidth = opts.callsignEditing || boxHovered ? 2.0 : 1.5;
    ctx.strokeRect(inputX + 0.5, inputY + 0.5, inputW - 1, inputH - 1);

    const displayCallsign = opts.callsignDraft || 'PILOT';
    const cursorOn = opts.callsignEditing && Math.sin(opts.timeSec * 8.5) >= 0;
    ctx.font = font('display', 18);
    ctx.fillStyle = opts.callsignEditing ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const textShown = `${displayCallsign}${cursorOn ? '█' : ''}`;
    drawEllipsizedText(ctx, textShown, inputX + 12, inputY + inputH * 0.5 + 1, inputW - 110);

    // Right inline mode hint pill inside input box
    ctx.font = font('micro', 12);
    ctx.textAlign = 'right';
    ctx.fillStyle = opts.callsignEditing ? THEME.ACCENT_AMBER : THEME.TEXT_SECONDARY;
    ctx.fillText(
      opts.scoreSubmitted ? 'LOCKED' : opts.callsignEditing ? 'TYPING' : '[C] EDIT',
      inputX + inputW - 12,
      inputY + inputH * 0.5 + 0.5
    );
    ctx.restore();

    // Visible Status / Validation / Rejection Banner (desktop AND mobile!)
    const bannerY = inputY + inputH + 14;
    if (opts.statusBanner) {
      const bTone = opts.statusBannerTone ?? 'amber';
      const bCol =
        bTone === 'red'
          ? THEME.ALERT_RED_TEXT
          : bTone === 'green'
            ? THEME.TEXT_PRIMARY
            : THEME.ACCENT_AMBER_HI;
      ctx.save();
      ctx.font = font('micro', 12);
      ctx.fillStyle = bCol;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const lines = wrapTextLines(ctx, opts.statusBanner, contentW - 24, 2);
      lines.forEach((ln, idx) => {
        ctx.fillText(ln, contentX + 12, bannerY + idx * 16);
      });
      ctx.restore();
    } else {
      ctx.save();
      ctx.font = font('micro', 12);
      ctx.fillStyle = THEME.TEXT_SECONDARY;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      drawEllipsizedText(
        ctx,
        locked
          ? `Controls locked for ${opts.keylockRemainingSec.toFixed(1)}s to prevent accidental skip.`
          : 'Press [ENTER] to transmit score & view Leaderboard, or [R] for instant replay.',
        contentX + 12,
        bannerY + 2,
        contentW - 24
      );
      ctx.restore();
    }
  } else {
    // Unranked Practice Summary Box
    const panelH = Math.max(88, footerY - curY - 14);
    ctx.save();
    ctx.fillStyle = THEME.BG_ROW_ALT;
    ctx.fillRect(contentX, curY, contentW, panelH);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(contentX + 0.5, curY + 0.5, contentW - 1, panelH - 1);

    ctx.font = font('prose', 14);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const msg =
      opts.statusBanner ??
      'Unranked Practice / Drill sortie complete. Launch Ranked mode to post scores to the Leaderboard.';
    const lines = wrapTextLines(ctx, msg, contentW - 32, 3);
    const baseY = curY + panelH * 0.5 - ((lines.length - 1) * 20) * 0.5;
    lines.forEach((ln, idx) => {
      ctx.fillText(ln, contentX + contentW * 0.5, baseY + idx * 20);
    });
    ctx.restore();
  }

  // 3. Footer Action Buttons (Visibly Dimmed & Disabled During KEYLOCK Countdown!)
  const footH = 38;
  const btnGap = 8;

  if (opts.isRanked) {
    const hubW = Math.min(116, Math.floor(contentW * 0.18));
    const menuW = Math.min(128, Math.floor(contentW * 0.20));
    const remW = contentW - hubW - menuW - btnGap * 3;
    const submitW = Math.floor(remW * 0.56);
    const replayW = remW - submitW;

    const primaryId = opts.scoreSubmitted
      ? POST_RUN_IDS.OPEN_MANIFEST
      : POST_RUN_IDS.SUBMIT_SCORE;
    const primaryLabel = opts.submittingScore
      ? 'TRANSMITTING...'
      : opts.scoreSubmitted
        ? `${SEMIOTIC_ICONS.STAR} LEADERBOARD [ENTER]`
        : locked
          ? `LOCKED (${opts.keylockRemainingSec.toFixed(1)}S)`
          : opts.submitLabel ?? `${SEMIOTIC_ICONS.PLAY} TRANSMIT [ENTER]`;

    drawChromeButton(
      ctx,
      { x: contentX, y: footerY, width: submitW, height: footH },
      primaryLabel,
      {
        id: primaryId,
        accent: opts.scoreSubmitted ? 'cyan' : 'amber',
        active: !locked && !opts.submittingScore,
        disabled: locked || opts.submittingScore,
        hovered: opts.hoveredButtonId === primaryId,
        fontPx: 12,
      },
      buttons
    );

    drawChromeButton(
      ctx,
      { x: contentX + submitW + btnGap, y: footerY, width: replayW, height: footH },
      locked
        ? `WAIT (${opts.keylockRemainingSec.toFixed(1)}S)`
        : opts.playAgainLabel ?? `${SEMIOTIC_ICONS.REPLAY} PLAY AGAIN [R]`,
      {
        id: POST_RUN_IDS.PLAY_AGAIN,
        accent: 'green',
        disabled: locked,
        hovered: opts.hoveredButtonId === POST_RUN_IDS.PLAY_AGAIN,
        fontPx: 12,
      },
      buttons
    );

    drawChromeButton(
      ctx,
      { x: contentX + submitW + replayW + btnGap * 2, y: footerY, width: menuW, height: footH },
      '◄ GAME MENU',
      {
        id: POST_RUN_IDS.GAME_MENU,
        accent: 'amber',
        disabled: locked,
        hovered: opts.hoveredButtonId === POST_RUN_IDS.GAME_MENU,
        fontPx: 12,
      },
      buttons
    );

    drawChromeButton(
      ctx,
      { x: contentX + contentW - hubW, y: footerY, width: hubW, height: footH },
      'MU-TH-UR OS',
      {
        id: POST_RUN_IDS.EXIT_HUB,
        accent: 'muted',
        disabled: locked,
        hovered: opts.hoveredButtonId === POST_RUN_IDS.EXIT_HUB,
        fontPx: 12,
      },
      buttons
    );
  } else {
    const showManifest = opts.showViewManifestButton !== false;
    const hubW = Math.min(124, Math.floor(contentW * 0.20));
    const menuW = Math.min(138, Math.floor(contentW * 0.22));
    const manifestW = showManifest ? Math.min(156, Math.floor(contentW * 0.25)) : 0;
    const gaps = showManifest ? 3 : 2;
    const replayW = contentW - hubW - menuW - manifestW - btnGap * gaps;

    drawChromeButton(
      ctx,
      { x: contentX, y: footerY, width: replayW, height: footH },
      locked
        ? `WAIT (${opts.keylockRemainingSec.toFixed(1)}S)`
        : opts.playAgainLabel ?? `${SEMIOTIC_ICONS.REPLAY} PLAY AGAIN [R]`,
      {
        id: POST_RUN_IDS.PLAY_AGAIN,
        accent: 'green',
        active: !locked,
        disabled: locked,
        hovered: opts.hoveredButtonId === POST_RUN_IDS.PLAY_AGAIN,
        fontPx: 12,
      },
      buttons
    );

    let nextX = contentX + replayW + btnGap;
    drawChromeButton(
      ctx,
      { x: nextX, y: footerY, width: menuW, height: footH },
      '◄ GAME MENU',
      {
        id: POST_RUN_IDS.GAME_MENU,
        accent: 'amber',
        disabled: locked,
        hovered: opts.hoveredButtonId === POST_RUN_IDS.GAME_MENU,
        fontPx: 12,
      },
      buttons
    );
    nextX += menuW + btnGap;

    if (showManifest) {
      drawChromeButton(
        ctx,
        { x: nextX, y: footerY, width: manifestW, height: footH },
        `${SEMIOTIC_ICONS.STAR} LEADERBOARD`,
        {
          id: POST_RUN_IDS.OPEN_MANIFEST,
          accent: 'cyan',
          disabled: locked,
          hovered: opts.hoveredButtonId === POST_RUN_IDS.OPEN_MANIFEST,
          fontPx: 12,
        },
        buttons
      );
    }

    drawChromeButton(
      ctx,
      { x: contentX + contentW - hubW, y: footerY, width: hubW, height: footH },
      'MU-TH-UR OS',
      {
        id: POST_RUN_IDS.EXIT_HUB,
        accent: 'muted',
        disabled: locked,
        hovered: opts.hoveredButtonId === POST_RUN_IDS.EXIT_HUB,
        fontPx: 12,
      },
      buttons
    );
  }

  return metrics;
}

export type UplinkStatus = 'LIVE' | 'SYNCING' | 'LOCAL';

export interface ManifestColumnDef {
  header: string;
  /** Relative weight of custom stat columns (normalized into the remaining 45% right zone) */
  widthFrac: number;
  align?: 'left' | 'right' | 'center';
}

export interface ManifestRowData {
  rank: number;
  callsign: string;
  score: number;
  /** Values aligned with `columns` order */
  stats: readonly string[];
  isJustAdded?: boolean;
  isLocalFallback?: boolean;
}

export interface ManifestTabDef {
  id: string;
  label: string;
  active: boolean;
}

export interface GlobalManifestOptions {
  title: string;
  uplinkStatus: UplinkStatus;
  timeSec: number;
  columns: readonly ManifestColumnDef[];
  rows: readonly ManifestRowData[];
  tabs?: readonly ManifestTabDef[];
  /** Optional emerald bottom Rank Banner when a score was just submitted */
  justAddedBanner?: string | null;
  /** True post-run (shows prominent PLAY AGAIN [R / ENTER]); false when peeking mid-run */
  showPlayAgain?: boolean;
  playAgainLabel?: string;
  closeLabel?: string;
  emptyMessage?: string;
  hoveredButtonId: string | null;
}

/**
 * Draws the unified 780×580 Global Leaderboard Manifest shared across all 4 games.
 * - Diegetic orbital relay uplink pill (zero backend/table-name leaks!)
 * - Standardized proportional columns: RNK (7%) | CALLSIGN (29%) | SCORE (19%) | <custom 45%>
 * - Boxed 98×18 `★ JUST ADDED` badge + pulsing emerald row + bottom Rank Banner
 * - Unified footer: `► PLAY AGAIN [R / ENTER]` + `[ESC] CLOSE`
 */
export function drawGlobalManifestModal(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: GlobalManifestOptions,
  buttons: ChromeButtonHitbox[]
): ModalFrameMetrics {
  const metrics = drawModalFrame(
    ctx,
    w,
    h,
    {
      title: opts.title,
      maxWidth: 780,
      maxHeight: 580,
      accentColor: THEME.TEXT_PRIMARY,
      rightBadge: formatUplinkBadge(opts.uplinkStatus),
    },
    buttons
  );

  const { contentX, contentW, footerY } = metrics;
  let curY = metrics.contentY - 2;

  // 1. Optional Mode Tabs (e.g. Campaign / Endless with [TAB] cue)
  if (opts.tabs && opts.tabs.length > 0) {
    const tabH = 30;
    const tabGap = 8;
    const tabW = Math.min(180, Math.floor((contentW - tabGap * (opts.tabs.length - 1)) / opts.tabs.length));
    opts.tabs.forEach((tab, idx) => {
      const btnId = `${POST_RUN_IDS.MANIFEST_TAB_PREFIX}${tab.id}`;
      const accent: ChromeButtonAccent = tab.active ? 'amber' : 'muted';
      drawChromeButton(
        ctx,
        { x: contentX + idx * (tabW + tabGap), y: curY, width: tabW, height: tabH },
        tab.label,
        {
          id: btnId,
          accent,
          active: tab.active,
          hovered: opts.hoveredButtonId === btnId,
          fontPx: 12,
        },
        buttons
      );
    });

    ctx.save();
    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('[TAB] SWITCH BOARD', contentX + contentW, curY + tabH * 0.5 + 0.5);
    ctx.restore();

    curY += tabH + 10;
  }

  // 2. Proportional Columns Geometry: RNK 7% | CALLSIGN 29% | SCORE 19% | <custom stat cols 45%>
  const colRnkW = Math.round(contentW * 0.07);
  const colCallW = Math.round(contentW * 0.29);
  const colScoreW = Math.round(contentW * 0.19);
  const customTotalW = Math.max(80, contentW - colRnkW - colCallW - colScoreW);
  const weightSum = opts.columns.reduce((acc, c) => acc + Math.max(0.01, c.widthFrac), 0) || 1;
  const customColWidths = opts.columns.map((c) => Math.floor((customTotalW * Math.max(0.01, c.widthFrac)) / weightSum));
  if (customColWidths.length > 0) {
    const used = customColWidths.reduce((a, b) => a + b, 0);
    customColWidths[customColWidths.length - 1] += customTotalW - used;
  }

  const colRnkX = contentX;
  const colCallX = colRnkX + colRnkW;
  const colScoreX = colCallX + colCallW;
  const customColXs: number[] = [];
  let cxAcc = colScoreX + colScoreW;
  for (let i = 0; i < customColWidths.length; i++) {
    customColXs.push(cxAcc);
    cxAcc += customColWidths[i];
  }

  // Table Header Bar
  const headerBarH = 26;
  ctx.save();
  ctx.fillStyle = 'rgba(12, 30, 18, 0.92)';
  ctx.fillRect(contentX, curY, contentW, headerBarH);
  ctx.strokeStyle = THEME.BORDER_SUBTLE;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(contentX + 0.5, curY + 0.5, contentW - 1, headerBarH - 1);

  ctx.font = font('micro', 12);
  ctx.fillStyle = THEME.ACCENT_AMBER;
  ctx.textBaseline = 'middle';
  const hdrY = curY + headerBarH * 0.5 + 0.5;

  ctx.textAlign = 'center';
  ctx.fillText('RNK', colRnkX + colRnkW * 0.5, hdrY);
  ctx.textAlign = 'left';
  ctx.fillText('CALLSIGN', colCallX + 8, hdrY);
  ctx.textAlign = 'right';
  ctx.fillText('SCORE', colScoreX + colScoreW - 10, hdrY);

  opts.columns.forEach((col, i) => {
    const align = col.align ?? 'right';
    const colX = customColXs[i];
    const colW = customColWidths[i];
    ctx.textAlign = align;
    const drawX =
      align === 'left' ? colX + 8 : align === 'center' ? colX + colW * 0.5 : colX + colW - 8;
    drawEllipsizedText(ctx, col.header, drawX, hdrY, colW - 12);
  });
  ctx.restore();

  curY += headerBarH + 4;

  // 3. Leaderboard Rows
  const bannerReserveH = opts.justAddedBanner ? 40 : 6;
  const tableAvailH = Math.max(90, footerY - 12 - bannerReserveH - curY);
  const maxVisibleRows = Math.min(10, Math.max(4, Math.floor(tableAvailH / 28)));
  const rowH = Math.min(34, Math.floor(tableAvailH / Math.max(1, maxVisibleRows)));

  if (opts.rows.length === 0) {
    ctx.save();
    ctx.fillStyle = THEME.BG_ROW_ALT;
    ctx.fillRect(contentX, curY, contentW, Math.min(110, tableAvailH));
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.strokeRect(contentX + 0.5, curY + 0.5, contentW - 1, Math.min(110, tableAvailH) - 1);

    ctx.font = font('prose', 14);
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const emptyMsg =
      opts.emptyMessage ??
      (opts.uplinkStatus === 'SYNCING'
        ? 'Synchronizing orbital leaderboard...'
        : 'No verified pilot records logged yet. Complete a ranked sortie to claim #1.');
    ctx.fillText(emptyMsg, contentX + contentW * 0.5, curY + Math.min(110, tableAvailH) * 0.5);
    ctx.restore();
  } else {
    const visible = opts.rows.slice(0, maxVisibleRows);
    const pulse = 0.55 + 0.45 * Math.sin(opts.timeSec * 6.0);

    visible.forEach((row, idx) => {
      const ry = curY + idx * rowH;
      const midY = ry + rowH * 0.5 + 0.5;
      const isHighlight = Boolean(row.isJustAdded);

      ctx.save();
      if (isHighlight) {
        ctx.fillStyle = `rgba(34, 110, 56, ${(0.34 + pulse * 0.16).toFixed(3)})`;
        ctx.fillRect(contentX, ry, contentW, rowH - 2);
        ctx.strokeStyle = pulse > 0.5 ? THEME.ACCENT_AMBER_HI : THEME.TEXT_PRIMARY;
        ctx.lineWidth = 1.6;
        ctx.strokeRect(contentX + 0.5, ry + 0.5, contentW - 1, rowH - 3);
      } else if (idx % 2 === 1) {
        ctx.fillStyle = THEME.BG_ROW_ALT;
        ctx.fillRect(contentX, ry, contentW, rowH - 2);
      }

      const isTopThree = row.rank <= 3;
      ctx.textBaseline = 'middle';

      // RNK
      ctx.font = font('data', 13);
      ctx.textAlign = 'center';
      ctx.fillStyle =
        row.rank === 1
          ? THEME.ACCENT_AMBER_HI
          : isTopThree
            ? THEME.ACCENT_AMBER
            : THEME.TEXT_SECONDARY;
      ctx.fillText(`#${String(row.rank).padStart(2, '0')}`, colRnkX + colRnkW * 0.5, midY);

      // CALLSIGN (+ boxed 98x18 ★ JUST ADDED badge when applicable!)
      ctx.textAlign = 'left';
      const badgeReserve = isHighlight ? 106 : 0;
      const callMaxW = Math.max(48, colCallW - 14 - badgeReserve);
      ctx.fillStyle = isHighlight
        ? '#FFFFFF'
        : row.isLocalFallback
          ? THEME.TEXT_SECONDARY
          : THEME.TEXT_BRIGHT;
      const callW = drawEllipsizedText(ctx, row.callsign, colCallX + 8, midY, callMaxW);

      if (isHighlight) {
        const bx = Math.min(colCallX + colCallW - 102, colCallX + 8 + Math.ceil(callW) + 8);
        const by = Math.round(ry + (rowH - 2 - 18) * 0.5);
        ctx.fillStyle = 'rgba(18, 72, 34, 0.96)';
        ctx.fillRect(bx, by, 98, 18);
        ctx.strokeStyle = THEME.TEXT_PRIMARY;
        ctx.lineWidth = 1.3;
        ctx.strokeRect(bx + 0.5, by + 0.5, 97, 17);

        ctx.font = font('micro', 12);
        ctx.fillStyle = THEME.ACCENT_AMBER_HI;
        ctx.textAlign = 'center';
        ctx.fillText(`${SEMIOTIC_ICONS.STAR} JUST ADDED`, bx + 49, by + 9.5);
      }

      // SCORE
      ctx.font = font('data', 13);
      ctx.textAlign = 'right';
      ctx.fillStyle = isHighlight ? THEME.ACCENT_AMBER_HI : THEME.TEXT_PRIMARY;
      drawEllipsizedText(
        ctx,
        row.score.toLocaleString(),
        colScoreX + colScoreW - 10,
        midY,
        colScoreW - 14
      );

      // Custom stat columns
      ctx.font = font('micro', 12);
      ctx.fillStyle = isHighlight ? THEME.TEXT_BRIGHT : THEME.TEXT_SECONDARY;
      opts.columns.forEach((col, ci) => {
        const val = row.stats[ci] ?? '-';
        const align = col.align ?? 'right';
        const colX = customColXs[ci];
        const colW = customColWidths[ci];
        ctx.textAlign = align;
        const drawX =
          align === 'left' ? colX + 8 : align === 'center' ? colX + colW * 0.5 : colX + colW - 8;
        drawEllipsizedText(ctx, val, drawX, midY, colW - 12);
      });

      ctx.restore();
    });
  }

  // 4. Emerald Bottom Rank Banner (when score just transmitted)
  if (opts.justAddedBanner) {
    const bannerY = footerY - 40;
    ctx.save();
    ctx.fillStyle = 'rgba(10, 44, 22, 0.94)';
    ctx.fillRect(contentX, bannerY, contentW, 30);
    ctx.strokeStyle = THEME.TEXT_PRIMARY;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(contentX + 0.5, bannerY + 0.5, contentW - 1, 29);

    ctx.font = font('button', 13);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawEllipsizedText(
      ctx,
      opts.justAddedBanner,
      contentX + contentW * 0.5,
      bannerY + 15.5,
      contentW - 20
    );
    ctx.restore();
  }

  // 5. Unified Footer: ► PLAY AGAIN [R / ENTER] + ◄ GAME MENU + [ESC] CLOSE (post-run)
  const footH = 38;
  if (opts.showPlayAgain !== false) {
    const gap = 10;
    const closeW = Math.min(164, Math.floor(contentW * 0.24));
    const menuW = Math.min(164, Math.floor(contentW * 0.24));
    const playW = Math.min(300, contentW - closeW - menuW - gap * 2);

    drawChromeButton(
      ctx,
      { x: contentX, y: footerY, width: playW, height: footH },
      opts.playAgainLabel ?? `${SEMIOTIC_ICONS.PLAY} PLAY AGAIN [R / ENTER]`,
      {
        id: POST_RUN_IDS.MANIFEST_PLAY_AGAIN,
        accent: 'green',
        active: true,
        hovered: opts.hoveredButtonId === POST_RUN_IDS.MANIFEST_PLAY_AGAIN,
        fontPx: 14,
      },
      buttons
    );

    drawChromeButton(
      ctx,
      { x: contentX + contentW - closeW - gap - menuW, y: footerY, width: menuW, height: footH },
      '◄ GAME MENU',
      {
        id: POST_RUN_IDS.GAME_MENU,
        accent: 'amber',
        hovered: opts.hoveredButtonId === POST_RUN_IDS.GAME_MENU,
        fontPx: 13,
      },
      buttons
    );

    drawChromeButton(
      ctx,
      { x: contentX + contentW - closeW, y: footerY, width: closeW, height: footH },
      opts.closeLabel ?? '[ESC] CLOSE',
      {
        id: POST_RUN_IDS.MANIFEST_CLOSE,
        accent: 'muted',
        hovered: opts.hoveredButtonId === POST_RUN_IDS.MANIFEST_CLOSE,
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
        height: footH,
      },
      opts.closeLabel ?? '[ESC] CLOSE',
      {
        id: POST_RUN_IDS.MANIFEST_CLOSE,
        accent: 'green',
        hovered: opts.hoveredButtonId === POST_RUN_IDS.MANIFEST_CLOSE,
        fontPx: 13,
      },
      buttons
    );
  }

  return metrics;
}
