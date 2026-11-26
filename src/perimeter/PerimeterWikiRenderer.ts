import { COLORS } from '../constants';
import type { CrtInteractiveButton } from '../render/HudRenderer';
import type { ViewportRect } from '../types';
import { PERIMETER_WIKI_CHAPTERS, type WikiBlock } from './PerimeterWikiData';

export interface WikiRenderParams {
  width: number;
  height: number;
  timeSec: number;
  chapterIdx: number;
  scrollPx: number;
  hoveredButtonId: string | null;
  trainingActive: boolean;
}

export interface WikiRenderResult {
  buttons: CrtInteractiveButton[];
  maxScrollPx: number;
  contentViewport: ViewportRect;
  scrollbarTrack: ViewportRect;
}

export class PerimeterWikiRenderer {
  private wrapLines(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxW: number
  ): string[] {
    if (maxW <= 24) return [text];
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    for (const word of words) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxW) {
        cur = candidate;
      } else {
        if (cur) lines.push(cur);
        cur = word;
      }
    }
    if (cur) lines.push(cur);
    return lines.length > 0 ? lines : [''];
  }

  public render(
    ctx: CanvasRenderingContext2D,
    params: WikiRenderParams
  ): WikiRenderResult {
    const { width: w, height: h, chapterIdx, hoveredButtonId, trainingActive } = params;
    const buttons: CrtInteractiveButton[] = [];

    const safeIdx = Math.max(0, Math.min(PERIMETER_WIKI_CHAPTERS.length - 1, chapterIdx));
    const chapter = PERIMETER_WIKI_CHAPTERS[safeIdx];

    const boxW = Math.min(1180, w - 28);
    const boxH = Math.min(760, h - 26);
    const bx = Math.round((w - boxW) * 0.5);
    const by = Math.round((h - boxH) * 0.5);

    const headerH = 62;
    const footerH = 52;
    const sidebarW = Math.max(190, Math.min(236, Math.round(boxW * 0.21)));
    const bodyTop = by + headerH;
    const bodyH = Math.max(180, boxH - headerH - footerH);

    const contentViewport: ViewportRect = {
      x: bx + sidebarW + 14,
      y: bodyTop + 10,
      width: Math.max(240, boxW - sidebarW - 42),
      height: Math.max(140, bodyH - 20),
    };

    const scrollbarTrack: ViewportRect = {
      x: bx + boxW - 22,
      y: contentViewport.y,
      width: 10,
      height: contentViewport.height,
    };

    ctx.save();

    // Backdrop dim
    ctx.fillStyle = 'rgba(1, 5, 3, 0.84)';
    ctx.fillRect(0, 0, w, h);

    // Main Terminal Chassis
    ctx.fillStyle = 'rgba(3, 10, 6, 0.985)';
    ctx.fillRect(bx, by, boxW, boxH);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 22, chapter.accent, 2.8);

    // Subtle chassis inner border
    ctx.strokeStyle = 'rgba(59, 224, 104, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(bx + 2, by + 2, boxW - 4, boxH - 4);

    // === HEADER BAR ===
    ctx.fillStyle = 'rgba(10, 28, 17, 0.86)';
    ctx.fillRect(bx + 4, by + 4, boxW - 8, headerH - 6);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(bx + 12, by + headerH - 2);
    ctx.lineTo(bx + boxW - 12, by + headerH - 2);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = 'bold 20px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText("MU-TH-UR 6000 // HADLEY'S PERIMETER TACTICAL WIKI", bx + 20, by + 29, boxW - 260);

    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText(
      'USCM SEC-01 FIELD MANUAL · [1-8] CHAPTERS · [WHEEL / ↑↓] SCROLL · [ESC / H] CLOSE',
      bx + 20,
      by + 48,
      boxW - 260
    );

    // Top-right classification badge + quick [X] Close button
    const closeW = 104;
    const closeRect: ViewportRect = {
      x: bx + boxW - closeW - 16,
      y: by + 13,
      width: closeW,
      height: 34,
    };
    this.drawButton(
      ctx,
      buttons,
      'perim-wiki-close',
      closeRect,
      '[ESC] CLOSE',
      false,
      hoveredButtonId,
      '#FFB000',
      13.5
    );

    // === LEFT CHAPTER INDEX SIDEBAR ===
    const sideX = bx + 12;
    const sideY = bodyTop + 10;
    const sideInnerW = sidebarW - 14;

    ctx.fillStyle = 'rgba(5, 16, 10, 0.92)';
    ctx.fillRect(sideX, sideY, sideInnerW, bodyH - 20);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(sideX, sideY, sideInnerW, bodyH - 20);

    ctx.textAlign = 'left';
    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('DOSSIER INDEX [1-8]', sideX + 10, sideY + 19);

    const tabTop = sideY + 28;
    const tabGap = 6;
    const availTabH = bodyH - 58;
    const tabH = Math.min(
      52,
      Math.max(32, Math.floor((availTabH - tabGap * (PERIMETER_WIKI_CHAPTERS.length - 1)) / PERIMETER_WIKI_CHAPTERS.length))
    );

    PERIMETER_WIKI_CHAPTERS.forEach((ch, idx) => {
      const ty = tabTop + idx * (tabH + tabGap);
      const tabId = `wiki-tab-${idx}`;
      const isAct = idx === safeIdx;
      const isHov = hoveredButtonId === tabId;

      buttons.push({
        id: tabId,
        rect: { x: sideX + 6, y: ty, width: sideInnerW - 12, height: tabH },
        label: ch.shortTitle,
      });

      ctx.fillStyle = isAct
        ? 'rgba(255, 176, 0, 0.22)'
        : isHov
          ? 'rgba(68, 255, 119, 0.16)'
          : 'rgba(4, 13, 8, 0.92)';
      ctx.fillRect(sideX + 6, ty, sideInnerW - 12, tabH);

      ctx.strokeStyle = isAct ? ch.accent : isHov ? '#FFFFFF' : 'rgba(59, 224, 104, 0.35)';
      ctx.lineWidth = isAct ? 2.1 : 1.2;
      ctx.strokeRect(sideX + 6, ty, sideInnerW - 12, tabH);

      // Left glowing accent spine on active chapter
      if (isAct) {
        ctx.fillStyle = ch.accent;
        ctx.fillRect(sideX + 6, ty, 4, tabH);
      }

      ctx.textAlign = 'left';
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.fillStyle = isAct ? '#FFE082' : ch.accent;
      ctx.fillText(`[${ch.code}]`, sideX + 14, ty + Math.round(tabH * 0.44));

      ctx.font = 'bold 13px "Share Tech Mono", monospace';
      ctx.fillStyle = isAct ? '#FFFFFF' : isHov ? '#FFFFFF' : '#9EF5B8';
      ctx.fillText(
        ch.shortTitle,
        sideX + 50,
        ty + Math.round(tabH * 0.45),
        sideInnerW - 64
      );

      if (tabH >= 42) {
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillStyle = isAct ? '#C6FAD6' : '#5E9B72';
        ctx.fillText(
          ch.subtitle.split('·')[0].trim(),
          sideX + 14,
          ty + tabH - 8,
          sideInnerW - 28
        );
      }
    });

    // === RIGHT SCROLLABLE ARTICLE VIEWPORT ===
    ctx.fillStyle = 'rgba(2, 8, 5, 0.96)';
    ctx.fillRect(
      contentViewport.x,
      contentViewport.y,
      contentViewport.width,
      contentViewport.height
    );
    ctx.strokeStyle = 'rgba(59, 224, 104, 0.45)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(
      contentViewport.x,
      contentViewport.y,
      contentViewport.width,
      contentViewport.height
    );

    const padX = 18;
    const innerW = contentViewport.width - padX * 2;
    const totalContentH = this.measureChapterHeight(ctx, chapter.blocks, innerW) + 84;
    const maxScrollPx = Math.max(0, Math.ceil(totalContentH - contentViewport.height));
    const clampedScroll = Math.max(0, Math.min(maxScrollPx, params.scrollPx));

    // Clip and render scrolled chapter body
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      contentViewport.x + 2,
      contentViewport.y + 2,
      contentViewport.width - 4,
      contentViewport.height - 4
    );
    ctx.clip();

    const originX = contentViewport.x + padX;
    let curY = contentViewport.y + 18 - clampedScroll;

    // Chapter Masthead
    ctx.textAlign = 'left';
    ctx.font = 'bold 18.5px "Share Tech Mono", monospace';
    ctx.fillStyle = chapter.accent;
    ctx.fillText(chapter.fullTitle, originX, curY + 14, innerW);

    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(chapter.subtitle, originX, curY + 34, innerW);

    ctx.strokeStyle = chapter.accent;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(originX, curY + 44);
    ctx.lineTo(originX + innerW, curY + 44);
    ctx.stroke();

    curY += 60;

    for (const block of chapter.blocks) {
      curY = this.renderBlock(ctx, block, originX, curY, innerW, chapter.accent);
    }

    ctx.restore();

    // Scroll fade cues at top/bottom if more content exists
    if (clampedScroll > 4) {
      const topFade = ctx.createLinearGradient(0, contentViewport.y, 0, contentViewport.y + 20);
      topFade.addColorStop(0, 'rgba(3, 12, 7, 0.92)');
      topFade.addColorStop(1, 'rgba(3, 12, 7, 0)');
      ctx.fillStyle = topFade;
      ctx.fillRect(contentViewport.x + 2, contentViewport.y + 2, contentViewport.width - 4, 18);
    }
    if (clampedScroll < maxScrollPx - 4) {
      const botFade = ctx.createLinearGradient(
        0,
        contentViewport.y + contentViewport.height - 24,
        0,
        contentViewport.y + contentViewport.height
      );
      botFade.addColorStop(0, 'rgba(3, 12, 7, 0)');
      botFade.addColorStop(1, 'rgba(3, 12, 7, 0.95)');
      ctx.fillStyle = botFade;
      ctx.fillRect(
        contentViewport.x + 2,
        contentViewport.y + contentViewport.height - 24,
        contentViewport.width - 4,
        22
      );
    }

    // === VERTICAL SCROLLBAR ===
    ctx.fillStyle = 'rgba(10, 28, 18, 0.85)';
    ctx.fillRect(scrollbarTrack.x, scrollbarTrack.y, scrollbarTrack.width, scrollbarTrack.height);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.0;
    ctx.strokeRect(scrollbarTrack.x, scrollbarTrack.y, scrollbarTrack.width, scrollbarTrack.height);

    if (maxScrollPx > 0) {
      const ratio = contentViewport.height / Math.max(contentViewport.height, totalContentH);
      const thumbH = Math.max(30, Math.round(scrollbarTrack.height * ratio));
      const thumbY =
        scrollbarTrack.y +
        Math.round((clampedScroll / maxScrollPx) * (scrollbarTrack.height - thumbH));
      ctx.fillStyle = chapter.accent;
      ctx.fillRect(scrollbarTrack.x + 1, thumbY, scrollbarTrack.width - 2, thumbH);
    } else {
      ctx.fillStyle = 'rgba(68, 255, 119, 0.35)';
      ctx.fillRect(
        scrollbarTrack.x + 1,
        scrollbarTrack.y + 1,
        scrollbarTrack.width - 2,
        scrollbarTrack.height - 2
      );
    }

    // === FOOTER ACTION BAR ===
    const footY = by + boxH - footerH + 7;
    const footH = 36;

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(bx + 12, by + boxH - footerH);
    ctx.lineTo(bx + boxW - 12, by + boxH - footerH);
    ctx.stroke();

    // Left: Launch Interactive Training Drill CTA
    const drillBtnW = Math.min(350, Math.round(boxW * 0.34));
    this.drawButton(
      ctx,
      buttons,
      trainingActive ? 'perim-wiki-close' : 'perim-drill-start',
      { x: bx + 16, y: footY, width: drillBtnW, height: footH },
      trainingActive
        ? '► RETURN TO ACTIVE TRAINING DRILL ◄'
        : '► PLAY 9-STAGE INTERACTIVE TRAINING DRILL [T] ◄',
      !trainingActive,
      hoveredButtonId,
      '#00F0FF',
      13.5
    );

    // Center: Quick Scroll Up / Down buttons
    const navBtnW = 92;
    const navStartX = bx + 16 + drillBtnW + 14;
    if (navStartX + navBtnW * 2 + 230 < bx + boxW - 16) {
      this.drawButton(
        ctx,
        buttons,
        'wiki-scroll-up',
        { x: navStartX, y: footY, width: navBtnW, height: footH },
        '▲ PG UP',
        false,
        hoveredButtonId,
        clampedScroll > 0 ? '#8EF5AB' : COLORS.GREEN_DIM,
        12.5
      );
      this.drawButton(
        ctx,
        buttons,
        'wiki-scroll-down',
        { x: navStartX + navBtnW + 8, y: footY, width: navBtnW, height: footH },
        '▼ PG DN',
        false,
        hoveredButtonId,
        clampedScroll < maxScrollPx ? '#8EF5AB' : COLORS.GREEN_DIM,
        12.5
      );
    }

    // Right: Close Wiki & Resume Console
    const doneBtnW = 216;
    this.drawButton(
      ctx,
      buttons,
      'perim-wiki-close',
      { x: bx + boxW - doneBtnW - 16, y: footY, width: doneBtnW, height: footH },
      '[ESC / H] RETURN TO CONSOLE',
      true,
      hoveredButtonId,
      '#44FF77',
      13.5
    );

    ctx.restore();

    return {
      buttons,
      maxScrollPx,
      contentViewport,
      scrollbarTrack,
    };
  }

  private measureChapterHeight(
    ctx: CanvasRenderingContext2D,
    blocks: WikiBlock[],
    innerW: number
  ): number {
    let h = 0;
    for (const block of blocks) {
      h += this.measureBlock(ctx, block, innerW);
    }
    return h;
  }

  private measureBlock(
    ctx: CanvasRenderingContext2D,
    block: WikiBlock,
    innerW: number
  ): number {
    if (block.kind === 'heading') {
      return 34;
    }
    if (block.kind === 'paragraph') {
      ctx.font = '13px "JetBrains Mono", monospace';
      const lines = this.wrapLines(ctx, block.text, innerW);
      return lines.length * 19 + 12;
    }
    if (block.kind === 'bullets') {
      ctx.font = '12.5px "JetBrains Mono", monospace';
      let sum = 6;
      for (const item of block.items) {
        const lines = this.wrapLines(ctx, `${item.lead} ${item.body}`, innerW - 18);
        sum += lines.length * 18.5 + 8;
      }
      return sum + 6;
    }
    if (block.kind === 'callout') {
      ctx.font = '12.5px "JetBrains Mono", monospace';
      let lineCount = 0;
      for (const l of block.lines) {
        lineCount += this.wrapLines(ctx, l, innerW - 28).length;
      }
      return 34 + lineCount * 18.5 + 16;
    }
    if (block.kind === 'formula') {
      ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
      const exprLines = this.wrapLines(ctx, block.expr, innerW - 28);
      ctx.font = '12px "JetBrains Mono", monospace';
      let noteLines = 0;
      for (const n of block.notes) {
        noteLines += this.wrapLines(ctx, `• ${n}`, innerW - 28).length;
      }
      return 32 + exprLines.length * 18 + 8 + noteLines * 17.5 + 18;
    }
    if (block.kind === 'table') {
      ctx.font = '11.5px "JetBrains Mono", monospace';
      let total = 28; // header row
      for (const row of block.rows) {
        let maxLines = 1;
        row.cols.forEach((cell, ci) => {
          const cw = Math.max(40, innerW * (block.colFracs[ci] ?? 0.25) - 12);
          const cnt = this.wrapLines(ctx, cell, cw).length;
          if (cnt > maxLines) maxLines = cnt;
        });
        total += maxLines * 16.5 + 10;
      }
      return total + 14;
    }
    return 0;
  }

  private renderBlock(
    ctx: CanvasRenderingContext2D,
    block: WikiBlock,
    x: number,
    y: number,
    innerW: number,
    chapterAccent: string
  ): number {
    if (block.kind === 'heading') {
      const accent = block.accent ?? '#FFB000';
      ctx.fillStyle = 'rgba(20, 44, 28, 0.58)';
      ctx.fillRect(x, y, innerW, 24);
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, 4, 24);
      ctx.textAlign = 'left';
      ctx.font = 'bold 14px "Share Tech Mono", monospace';
      ctx.fillStyle = accent;
      ctx.fillText(block.text, x + 12, y + 17, innerW - 18);
      return y + 34;
    }

    if (block.kind === 'paragraph') {
      ctx.textAlign = 'left';
      ctx.font = '13px "JetBrains Mono", monospace';
      ctx.fillStyle = block.accent ?? '#C8FAD8';
      const lines = this.wrapLines(ctx, block.text, innerW);
      lines.forEach((ln, idx) => {
        ctx.fillText(ln, x, y + 12 + idx * 19);
      });
      return y + lines.length * 19 + 12;
    }

    if (block.kind === 'bullets') {
      let cy = y + 4;
      for (const item of block.items) {
        ctx.textAlign = 'left';
        ctx.font = '12.5px "JetBrains Mono", monospace';
        const lines = this.wrapLines(ctx, `${item.lead} ${item.body}`, innerW - 18);
        // Glowing bullet square
        ctx.fillStyle = item.accent ?? chapterAccent;
        ctx.fillRect(x + 2, cy + 4, 6, 6);

        lines.forEach((ln, li) => {
          if (li === 0 && ln.startsWith(item.lead)) {
            ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
            ctx.fillStyle = item.accent ?? '#FFE082';
            ctx.fillText(item.lead, x + 16, cy + 12);
            const leadW = ctx.measureText(item.lead).width;
            ctx.font = '12.5px "JetBrains Mono", monospace';
            ctx.fillStyle = '#C4F7D4';
            ctx.fillText(ln.slice(item.lead.length), x + 16 + leadW, cy + 12);
          } else {
            ctx.font = '12.5px "JetBrains Mono", monospace';
            ctx.fillStyle = '#C4F7D4';
            ctx.fillText(ln, x + 16, cy + 12 + li * 18.5);
          }
        });
        cy += lines.length * 18.5 + 8;
      }
      return cy + 8;
    }

    if (block.kind === 'callout') {
      const borderCol =
        block.tone === 'warn' ? '#FF5533' : block.tone === 'combo' ? '#00F0FF' : '#FFB000';
      const bgCol =
        block.tone === 'warn'
          ? 'rgba(56, 14, 10, 0.55)'
          : block.tone === 'combo'
            ? 'rgba(6, 32, 38, 0.55)'
            : 'rgba(42, 30, 6, 0.55)';
      const icon = block.tone === 'warn' ? '⚠' : block.tone === 'combo' ? '★' : '▸';

      ctx.font = '12.5px "JetBrains Mono", monospace';
      const wrapped: string[] = [];
      for (const l of block.lines) {
        wrapped.push(...this.wrapLines(ctx, l, innerW - 28));
      }
      const boxH = 32 + wrapped.length * 18.5 + 8;

      ctx.fillStyle = bgCol;
      ctx.fillRect(x, y, innerW, boxH);
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x, y, innerW, boxH);
      ctx.fillStyle = borderCol;
      ctx.fillRect(x, y, 4, boxH);

      ctx.textAlign = 'left';
      ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
      ctx.fillStyle = borderCol;
      ctx.fillText(`${icon} ${block.title}`, x + 14, y + 20, innerW - 24);

      ctx.font = '12.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#E6FFEC';
      wrapped.forEach((ln, idx) => {
        ctx.fillText(ln, x + 14, y + 40 + idx * 18.5);
      });

      return y + boxH + 10;
    }

    if (block.kind === 'formula') {
      ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
      const exprLines = this.wrapLines(ctx, block.expr, innerW - 28);
      ctx.font = '12px "JetBrains Mono", monospace';
      const noteLines: string[] = [];
      for (const n of block.notes) {
        noteLines.push(...this.wrapLines(ctx, `• ${n}`, innerW - 28));
      }
      const boxH = 30 + exprLines.length * 18 + 8 + noteLines.length * 17.5 + 10;

      ctx.fillStyle = 'rgba(4, 22, 26, 0.72)';
      ctx.fillRect(x, y, innerW, boxH);
      ctx.strokeStyle = '#00F0FF';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x, y, innerW, boxH);

      ctx.textAlign = 'left';
      ctx.font = 'bold 12.5px "Share Tech Mono", monospace';
      ctx.fillStyle = '#00F0FF';
      ctx.fillText(`◈ ${block.title}`, x + 12, y + 19, innerW - 24);

      let fy = y + 38;
      ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#FFE082';
      for (const el of exprLines) {
        ctx.fillText(el, x + 14, fy);
        fy += 18;
      }
      fy += 4;
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.fillStyle = '#B8F6CB';
      for (const nl of noteLines) {
        ctx.fillText(nl, x + 14, fy);
        fy += 17.5;
      }

      return y + boxH + 10;
    }

    if (block.kind === 'table') {
      // Header bar
      const headH = 26;
      ctx.fillStyle = 'rgba(18, 46, 28, 0.85)';
      ctx.fillRect(x, y, innerW, headH);
      ctx.strokeStyle = COLORS.GREEN_DIM;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x, y, innerW, headH);

      let colX = x;
      ctx.textAlign = 'left';
      ctx.font = 'bold 12px "Share Tech Mono", monospace';
      ctx.fillStyle = '#FFB000';
      block.headers.forEach((hdr, ci) => {
        const cw = innerW * (block.colFracs[ci] ?? 0.25);
        ctx.fillText(hdr, colX + 6, y + 17, cw - 10);
        colX += cw;
      });

      let ry = y + headH;
      ctx.font = '11.5px "JetBrains Mono", monospace';
      block.rows.forEach((row, rIdx) => {
        const cellWrapped: string[][] = [];
        let maxLines = 1;
        row.cols.forEach((cell, ci) => {
          const cw = Math.max(40, innerW * (block.colFracs[ci] ?? 0.25) - 12);
          const lines = this.wrapLines(ctx, cell, cw);
          cellWrapped.push(lines);
          if (lines.length > maxLines) maxLines = lines.length;
        });
        const rowH = maxLines * 16.5 + 10;

        ctx.fillStyle = rIdx % 2 === 1 ? 'rgba(12, 30, 18, 0.45)' : 'rgba(5, 14, 9, 0.45)';
        ctx.fillRect(x, ry, innerW, rowH);
        ctx.strokeStyle = 'rgba(38, 96, 56, 0.45)';
        ctx.lineWidth = 1.0;
        ctx.strokeRect(x, ry, innerW, rowH);

        let cx = x;
        cellWrapped.forEach((lines, ci) => {
          const cw = innerW * (block.colFracs[ci] ?? 0.25);
          ctx.font =
            ci === 0
              ? 'bold 11.5px "JetBrains Mono", monospace'
              : '11.5px "JetBrains Mono", monospace';
          ctx.fillStyle = ci === 0 ? row.accent ?? '#52FF86' : '#C8FAD8';
          lines.forEach((ln, li) => {
            ctx.fillText(ln, cx + 6, ry + 16 + li * 16.5);
          });
          cx += cw;
        });
        ry += rowH;
      });

      return ry + 14;
    }

    return y;
  }

  private drawButton(
    ctx: CanvasRenderingContext2D,
    buttons: CrtInteractiveButton[],
    id: string,
    rect: ViewportRect,
    label: string,
    active: boolean,
    hoveredId: string | null,
    accent: string,
    fontPx: number
  ): void {
    buttons.push({ id, rect, label });
    const hov = hoveredId === id;
    ctx.fillStyle = hov
      ? 'rgba(255, 176, 0, 0.28)'
      : active
        ? 'rgba(59, 224, 104, 0.20)'
        : 'rgba(6, 16, 10, 0.94)';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = hov ? '#FFFFFF' : active ? accent : accent;
    ctx.lineWidth = hov || active ? 2.1 : 1.5;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    ctx.font = `bold ${fontPx}px "Share Tech Mono", monospace`;
    ctx.fillStyle = hov ? '#FFFFFF' : accent;
    ctx.textAlign = 'center';
    ctx.fillText(
      label,
      rect.x + rect.width * 0.5,
      rect.y + rect.height * 0.5 + fontPx * 0.34,
      rect.width - 10
    );
  }

  private drawCornerBrackets(
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
}
