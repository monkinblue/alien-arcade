import { drawEllipsizedText, font, SEMIOTIC_ICONS, THEME } from './theme';

/**
 * Draws the shared MU-TH-UR 6000 "★ RANKED ● REC" prestige pill in game top bars
 * (or a calm WCAG-AA "PRACTICE" tag during non-recorded practice runs).
 * Enforces the >=12px effective font floor and returns pixel width consumed.
 */
export function drawRankedHudPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  timeSec: number,
  isRanked: boolean,
  compact = false
): number {
  ctx.save();
  const fontPx = compact ? 12 : 13;
  ctx.font = compact ? font('micro', fontPx) : font('button', fontPx);

  if (isRanked) {
    const label = compact ? `${SEMIOTIC_ICONS.STAR} RANKED` : `${SEMIOTIC_ICONS.STAR} RANKED  REC`;
    const textW = ctx.measureText(label).width;
    const dotReserve = compact ? 0 : 14;
    const pillW = Math.ceil(textW + 18 + dotReserve);
    const pulse = 0.55 + 0.45 * Math.sin(timeSec * 6.5);

    // Rich amber flight-recorder seal
    ctx.fillStyle = `rgba(54, 26, 4, ${(0.86 + pulse * 0.10).toFixed(3)})`;
    ctx.fillRect(x, y, pillW, height);
    ctx.strokeStyle = pulse > 0.65 ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(x + 0.5, y + 0.5, pillW - 1, height - 1);

    // Subtle inner crimson hairline trim
    ctx.strokeStyle = `rgba(255, 68, 34, ${(0.38 + pulse * 0.42).toFixed(3)})`;
    ctx.lineWidth = 1.0;
    ctx.strokeRect(x + 2.5, y + 2.5, pillW - 5, height - 5);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    const midY = y + height * 0.5 + 0.5;

    if (compact) {
      ctx.fillText(label, x + 9, midY);
    } else {
      const rankedPrefix = `${SEMIOTIC_ICONS.STAR} RANKED`;
      ctx.fillText(rankedPrefix, x + 9, midY);
      const rankedW = ctx.measureText(rankedPrefix).width;
      const dotX = x + 9 + rankedW + 9;
      ctx.fillStyle = pulse > 0.35 ? THEME.ALERT_RED_STROKE : '#7A180A';
      ctx.beginPath();
      ctx.arc(dotX, y + height * 0.5, 3.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFF6CC';
      ctx.fillText('REC', dotX + 7, midY);
    }
    ctx.restore();
    return pillW;
  }

  // Calm unranked / practice pill (post-CRT WCAG-AA contrast)
  const label = compact ? 'PRACTICE' : 'PRACTICE // UNRANKED';
  const pillW = Math.ceil(ctx.measureText(label).width + 18);
  ctx.fillStyle = THEME.BG_PILL;
  ctx.fillRect(x, y, pillW, height);
  ctx.strokeStyle = THEME.BORDER_SUBTLE;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(x + 0.5, y + 0.5, pillW - 1, height - 1);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = THEME.TEXT_SECONDARY;
  ctx.fillText(label, x + pillW * 0.5, y + height * 0.5 + 0.5);
  ctx.restore();
  return pillW;
}

/**
 * Draws the Launch-Screen Prestige Ribbon indicating whether the selected mode
 * records to the global MU-TH-UR high-score leaderboard ("★ RANKED") or is Unranked Practice.
 * Never drops below 12px effective font size and never horizontally squashes text.
 */
export function drawRankedTitleRibbon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  timeSec: number,
  isRanked: boolean
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (isRanked) {
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 5.2);
    ctx.fillStyle = `rgba(60, 26, 4, ${(0.84 + pulse * 0.12).toFixed(3)})`;
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = THEME.ACCENT_AMBER;
    ctx.lineWidth = 2.0;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // Corner gold prestige pips
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.fillRect(x + 3, y + 3, 4, 4);
    ctx.fillRect(x + w - 7, y + 3, 4, 4);
    ctx.fillRect(x + 3, y + h - 7, 4, 4);
    ctx.fillRect(x + w - 7, y + h - 7, 4, 4);

    let fontPx = Math.max(12, Math.min(15, Math.floor(h * 0.54)));
    ctx.font = fontPx >= 13 ? font('button', fontPx) : font('micro', 12);
    while (fontPx > 12 && ctx.measureText(text).width > w - 24) {
      fontPx -= 1;
      ctx.font = fontPx >= 13 ? font('button', fontPx) : font('micro', 12);
    }
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    drawEllipsizedText(ctx, text, x + w * 0.5, y + h * 0.5 + 0.5, w - 24);
  } else {
    ctx.fillStyle = THEME.BG_PILL;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    let fontPx = Math.max(12, Math.min(14, Math.floor(h * 0.50)));
    ctx.font = fontPx >= 13 ? font('button', fontPx) : font('micro', 12);
    while (fontPx > 12 && ctx.measureText(text).width > w - 24) {
      fontPx -= 1;
      ctx.font = fontPx >= 13 ? font('button', fontPx) : font('micro', 12);
    }
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    drawEllipsizedText(ctx, text, x + w * 0.5, y + h * 0.5 + 0.5, w - 24);
  }
  ctx.restore();
}
