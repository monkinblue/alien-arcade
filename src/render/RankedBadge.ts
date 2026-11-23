import { COLORS } from '../constants';

/**
 * Draws the shared MU-TH-UR 6000 "★ RANKED ● REC" prestige pill in game top bars
 * (or a calm muted "UNRANKED // PRACTICE" tag during non-recorded practice runs).
 * Returns the pixel width consumed so adjacent title text/pills never collide.
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
  const fontPx = compact ? 11.5 : 13;
  ctx.font = `bold ${fontPx}px "Share Tech Mono", monospace`;

  if (isRanked) {
    const label = compact ? '★ RANKED' : '★ RANKED  REC';
    const textW = ctx.measureText(label).width;
    const dotReserve = compact ? 0 : 12;
    const pillW = Math.ceil(textW + 18 + dotReserve);
    const pulse = 0.55 + 0.45 * Math.sin(timeSec * 6.5);

    // Rich crimson-amber flight-recorder seal
    ctx.fillStyle = `rgba(54, 24, 4, ${(0.84 + pulse * 0.12).toFixed(3)})`;
    ctx.fillRect(x, y, pillW, height);
    ctx.strokeStyle = pulse > 0.65 ? '#FFF2B2' : '#FFB000';
    ctx.lineWidth = 1.9;
    ctx.strokeRect(x, y, pillW, height);

    // Subtle inner crimson hairline trim
    ctx.strokeStyle = `rgba(255, 68, 34, ${(0.4 + pulse * 0.45).toFixed(3)})`;
    ctx.lineWidth = 1.0;
    ctx.strokeRect(x + 2, y + 2, pillW - 4, height - 4);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFE28A';
    const textY = y + height * 0.5 + fontPx * 0.34;
    if (compact) {
      ctx.fillText(label, x + 9, textY);
    } else {
      ctx.fillText('★ RANKED', x + 9, textY);
      const rankedW = ctx.measureText('★ RANKED').width;
      const dotX = x + 9 + rankedW + 9;
      const dotY = y + height * 0.5;
      ctx.fillStyle = pulse > 0.35 ? COLORS.RED_KLAXON : '#7A180A';
      ctx.beginPath();
      ctx.arc(dotX, dotY, 3.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFF6CC';
      ctx.fillText('REC', dotX + 7, textY);
    }
    ctx.restore();
    return pillW;
  }

  // Calm unranked / practice pill
  const label = compact ? 'PRACTICE' : 'PRACTICE // UNRANKED';
  const pillW = Math.ceil(ctx.measureText(label).width + 18);
  ctx.fillStyle = 'rgba(6, 18, 11, 0.86)';
  ctx.fillRect(x, y, pillW, height);
  ctx.strokeStyle = COLORS.GREEN_DIM;
  ctx.lineWidth = 1.3;
  ctx.strokeRect(x, y, pillW, height);

  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.GREEN_MID;
  ctx.fillText(label, x + pillW * 0.5, y + height * 0.5 + fontPx * 0.34);
  ctx.restore();
  return pillW;
}

/**
 * Draws the prominent Launch-Screen Prestige Ribbon indicating whether the selected mode
 * records to the global MU-TH-UR high-score leaderboard ("★ RANKED") or is Unranked Practice.
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
  if (isRanked) {
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 5.2);
    ctx.fillStyle = `rgba(68, 22, 6, ${(0.82 + pulse * 0.14).toFixed(3)})`;
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = '#FFB000';
    ctx.lineWidth = 2.0;
    ctx.strokeRect(x, y, w, h);

    // Corner gold prestige pips
    ctx.fillStyle = '#FFF6CC';
    ctx.fillRect(x + 3, y + 3, 4, 4);
    ctx.fillRect(x + w - 7, y + 3, 4, 4);
    ctx.fillRect(x + 3, y + h - 7, 4, 4);
    ctx.fillRect(x + w - 7, y + h - 7, 4, 4);

    let fontPx = Math.min(14.5, h * 0.56);
    ctx.font = `bold ${fontPx}px "Share Tech Mono", monospace`;
    while (fontPx > 10.5 && ctx.measureText(text).width > w - 24) {
      fontPx -= 0.5;
      ctx.font = `bold ${fontPx}px "Share Tech Mono", monospace`;
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFE490';
    ctx.fillText(text, x + w * 0.5, y + h * 0.5 + fontPx * 0.34);
  } else {
    ctx.fillStyle = 'rgba(6, 18, 11, 0.88)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(x, y, w, h);

    let fontPx = Math.min(13.5, h * 0.52);
    ctx.font = `bold ${fontPx}px "Share Tech Mono", monospace`;
    while (fontPx > 10 && ctx.measureText(text).width > w - 24) {
      fontPx -= 0.5;
      ctx.font = `bold ${fontPx}px "Share Tech Mono", monospace`;
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.GREEN_MID;
    ctx.fillText(text, x + w * 0.5, y + h * 0.5 + fontPx * 0.34);
  }
  ctx.restore();
}
