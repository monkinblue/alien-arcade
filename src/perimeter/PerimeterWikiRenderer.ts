import { COLORS } from '../constants';
import type { CrtInteractiveButton } from '../render/HudRenderer';
import type { ViewportRect } from '../types';
import {
  PERIMETER_WIKI_CHAPTERS,
  type BestiaryCardEntry,
  type WikiBlock,
} from './PerimeterWikiData';
import type { HostileKind } from './types';

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
    if (maxW <= 32) return [text];
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

    // Dedicated Full-Screen MU-TH-UR 6000 Console Screen footprint
    const margin = 8;
    const bx = margin;
    const by = margin;
    const boxW = Math.max(640, w - margin * 2);
    const boxH = Math.max(460, h - margin * 2);

    const headerH = 74;
    const footerH = 60;
    const sidebarW = Math.max(236, Math.min(296, Math.round(boxW * 0.225)));
    const bodyTop = by + headerH;
    const bodyH = Math.max(200, boxH - headerH - footerH);

    const scrollW = 16;
    const contentViewport: ViewportRect = {
      x: bx + sidebarW + 16,
      y: bodyTop + 12,
      width: Math.max(300, boxW - sidebarW - 44 - scrollW),
      height: Math.max(160, bodyH - 24),
    };

    const scrollbarTrack: ViewportRect = {
      x: contentViewport.x + contentViewport.width + 10,
      y: contentViewport.y,
      width: scrollW,
      height: contentViewport.height,
    };

    ctx.save();

    // Solid full-screen deep P39 CRT console backdrop
    ctx.fillStyle = '#020804';
    ctx.fillRect(0, 0, w, h);

    // Console Outer Frame & Glowing Corner Brackets
    ctx.fillStyle = '#030B06';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = 'rgba(68, 255, 119, 0.42)';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(bx + 1, by + 1, boxW - 2, boxH - 2);
    this.drawCornerBrackets(ctx, bx, by, boxW, boxH, 26, chapter.accent, 3.0);

    // === TOP CONSOLE HEADER BAR ===
    ctx.fillStyle = 'rgba(9, 26, 16, 0.94)';
    ctx.fillRect(bx + 3, by + 3, boxW - 6, headerH - 5);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(bx + 12, by + headerH - 2);
    ctx.lineTo(bx + boxW - 12, by + headerH - 2);
    ctx.stroke();

    // Prominent Top-Left Solid Amber "◄ BACK TO GAME" Console Button (impossible to miss!)
    const backBtnW = Math.min(248, Math.max(185, Math.round(boxW * 0.19)));
    const backBtnH = 46;
    const backRect: ViewportRect = {
      x: bx + 16,
      y: by + 13,
      width: backBtnW,
      height: backBtnH,
    };
    this.drawSolidCtaButton(
      ctx,
      buttons,
      'perim-wiki-close',
      backRect,
      trainingActive ? '◄ BACK TO DRILL [ESC]' : '◄ BACK TO GAME [ESC]',
      hoveredButtonId,
      '#FFB000',
      '#FFE082',
      17
    );

    // Centered / Left-aligned Console Masthead Title
    const titleX = backRect.x + backRect.width + 22;
    const rightStatusW = 195;
    const titleMaxW = Math.max(200, bx + boxW - titleX - rightStatusW - 16);

    ctx.textAlign = 'left';
    ctx.font = 'bold 25px "Share Tech Mono", monospace';
    ctx.fillStyle = '#52FF86';
    ctx.fillText("MU-TH-UR 6000 // TACTICAL DATABASE", titleX, by + 35, titleMaxW);

    ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(
      'USCM SEC-01 FIELD MANUAL · [1-8] CHAPTERS · [WHEEL / ↑↓] SCROLL · [ESC / H] RESUME',
      titleX,
      by + 57,
      titleMaxW
    );

    // Top-right Live Paused Indicator Badge
    const pausePillX = bx + boxW - rightStatusW - 14;
    ctx.fillStyle = 'rgba(22, 44, 28, 0.85)';
    ctx.fillRect(pausePillX, by + 18, rightStatusW, 36);
    ctx.strokeStyle = '#44FF77';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(pausePillX, by + 18, rightStatusW, 36);
    ctx.textAlign = 'center';
    ctx.font = 'bold 13.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#8EF5AB';
    ctx.fillText('❚❚ SIM PAUSED · SAFE', pausePillX + rightStatusW * 0.5, by + 41, rightStatusW - 12);

    // === LEFT CHAPTER INDEX SIDEBAR ===
    const sideX = bx + 14;
    const sideY = bodyTop + 12;
    const sideInnerW = sidebarW - 14;
    const sideH = bodyH - 24;

    ctx.fillStyle = 'rgba(5, 16, 10, 0.96)';
    ctx.fillRect(sideX, sideY, sideInnerW, sideH);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sideX, sideY, sideInnerW, sideH);

    ctx.textAlign = 'left';
    ctx.font = 'bold 14.5px "Share Tech Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText('DOSSIER INDEX [1–8]', sideX + 12, sideY + 24);

    const tabTop = sideY + 36;
    const tabGap = 7;
    const availTabH = sideH - 48;
    const tabH = Math.min(
      64,
      Math.max(
        40,
        Math.floor(
          (availTabH - tabGap * (PERIMETER_WIKI_CHAPTERS.length - 1)) /
            PERIMETER_WIKI_CHAPTERS.length
        )
      )
    );

    PERIMETER_WIKI_CHAPTERS.forEach((ch, idx) => {
      const ty = tabTop + idx * (tabH + tabGap);
      const tabId = `wiki-tab-${idx}`;
      const isAct = idx === safeIdx;
      const isHov = hoveredButtonId === tabId;

      buttons.push({
        id: tabId,
        rect: { x: sideX + 8, y: ty, width: sideInnerW - 16, height: tabH },
        label: ch.shortTitle,
      });

      ctx.fillStyle = isAct
        ? 'rgba(255, 176, 0, 0.24)'
        : isHov
          ? 'rgba(68, 255, 119, 0.18)'
          : 'rgba(4, 13, 8, 0.94)';
      ctx.fillRect(sideX + 8, ty, sideInnerW - 16, tabH);

      ctx.strokeStyle = isAct ? ch.accent : isHov ? '#FFFFFF' : 'rgba(59, 224, 104, 0.38)';
      ctx.lineWidth = isAct ? 2.4 : 1.3;
      ctx.strokeRect(sideX + 8, ty, sideInnerW - 16, tabH);

      if (isAct) {
        ctx.fillStyle = ch.accent;
        ctx.fillRect(sideX + 8, ty, 5, tabH);
      }

      ctx.textAlign = 'left';
      ctx.font = 'bold 14.5px "JetBrains Mono", monospace';
      ctx.fillStyle = isAct ? '#FFE082' : ch.accent;
      ctx.fillText(`[${ch.code}]`, sideX + 18, ty + Math.round(tabH * 0.45));

      ctx.font = 'bold 16px "Share Tech Mono", monospace';
      ctx.fillStyle = isAct ? '#FFFFFF' : isHov ? '#FFFFFF' : '#A6F8C0';
      ctx.fillText(
        ch.shortTitle,
        sideX + 62,
        ty + Math.round(tabH * 0.46),
        sideInnerW - 78
      );

      if (tabH >= 48) {
        ctx.font = '11.5px "JetBrains Mono", monospace';
        ctx.fillStyle = isAct ? '#D4FFE0' : '#65A87A';
        ctx.fillText(
          ch.subtitle.split('·')[0].trim(),
          sideX + 18,
          ty + tabH - 10,
          sideInnerW - 32
        );
      }
    });

    // === RIGHT FULL-SCALE CONSOLE READER VIEWPORT ===
    ctx.fillStyle = '#020905';
    ctx.fillRect(
      contentViewport.x,
      contentViewport.y,
      contentViewport.width,
      contentViewport.height
    );
    ctx.strokeStyle = 'rgba(68, 255, 119, 0.48)';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(
      contentViewport.x,
      contentViewport.y,
      contentViewport.width,
      contentViewport.height
    );

    const padX = 28;
    const innerW = contentViewport.width - padX * 2;
    const totalContentH = this.measureChapterHeight(ctx, chapter.blocks, innerW) + 116;
    const maxScrollPx = Math.max(0, Math.ceil(totalContentH - contentViewport.height));
    const clampedScroll = Math.max(0, Math.min(maxScrollPx, params.scrollPx));

    // Clipped scrollable article content
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
    let curY = contentViewport.y + 24 - clampedScroll;

    // Large Chapter Console Masthead
    ctx.textAlign = 'left';
    ctx.font = 'bold 24px "Share Tech Mono", monospace';
    ctx.fillStyle = chapter.accent;
    ctx.fillText(chapter.fullTitle, originX, curY + 18, innerW);

    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFB000';
    ctx.fillText(chapter.subtitle, originX, curY + 44, innerW);

    ctx.strokeStyle = chapter.accent;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(originX, curY + 58);
    ctx.lineTo(originX + innerW, curY + 58);
    ctx.stroke();

    curY += 78;

    for (const block of chapter.blocks) {
      curY = this.renderBlock(ctx, block, originX, curY, innerW, chapter.accent, params.timeSec);
    }

    ctx.restore();

    // Soft top/bottom scroll fades
    if (clampedScroll > 4) {
      const topFade = ctx.createLinearGradient(0, contentViewport.y, 0, contentViewport.y + 24);
      topFade.addColorStop(0, 'rgba(2, 9, 5, 0.94)');
      topFade.addColorStop(1, 'rgba(2, 9, 5, 0)');
      ctx.fillStyle = topFade;
      ctx.fillRect(contentViewport.x + 2, contentViewport.y + 2, contentViewport.width - 4, 22);
    }
    if (clampedScroll < maxScrollPx - 4) {
      const botFade = ctx.createLinearGradient(
        0,
        contentViewport.y + contentViewport.height - 28,
        0,
        contentViewport.y + contentViewport.height
      );
      botFade.addColorStop(0, 'rgba(2, 9, 5, 0)');
      botFade.addColorStop(1, 'rgba(2, 9, 5, 0.96)');
      ctx.fillStyle = botFade;
      ctx.fillRect(
        contentViewport.x + 2,
        contentViewport.y + contentViewport.height - 28,
        contentViewport.width - 4,
        26
      );
    }

    // === WIDE EASY-CLICK VERTICAL SCROLLBAR ===
    ctx.fillStyle = 'rgba(10, 28, 18, 0.88)';
    ctx.fillRect(scrollbarTrack.x, scrollbarTrack.y, scrollbarTrack.width, scrollbarTrack.height);
    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(scrollbarTrack.x, scrollbarTrack.y, scrollbarTrack.width, scrollbarTrack.height);

    if (maxScrollPx > 0) {
      const ratio = contentViewport.height / Math.max(contentViewport.height, totalContentH);
      const thumbH = Math.max(42, Math.round(scrollbarTrack.height * ratio));
      const thumbY =
        scrollbarTrack.y +
        Math.round((clampedScroll / maxScrollPx) * (scrollbarTrack.height - thumbH));
      ctx.fillStyle = chapter.accent;
      ctx.fillRect(scrollbarTrack.x + 2, thumbY, scrollbarTrack.width - 4, thumbH);
    } else {
      ctx.fillStyle = 'rgba(68, 255, 119, 0.35)';
      ctx.fillRect(
        scrollbarTrack.x + 2,
        scrollbarTrack.y + 2,
        scrollbarTrack.width - 4,
        scrollbarTrack.height - 4
      );
    }

    // === BOTTOM CONSOLE ACTION BAR ===
    const footY = by + boxH - footerH + 9;
    const footH = 42;

    ctx.strokeStyle = COLORS.GREEN_DIM;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(bx + 12, by + boxH - footerH);
    ctx.lineTo(bx + boxW - 12, by + boxH - footerH);
    ctx.stroke();

    // Left: Launch Interactive Training Drill CTA
    const drillBtnW = Math.min(390, Math.round(boxW * 0.34));
    this.drawButton(
      ctx,
      buttons,
      trainingActive ? 'perim-wiki-close' : 'perim-drill-start',
      { x: bx + 16, y: footY, width: drillBtnW, height: footH },
      trainingActive
        ? '◄ RETURN TO ACTIVE TRAINING DRILL'
        : '► LAUNCH 9-STAGE TRAINING DRILL [T]',
      !trainingActive,
      hoveredButtonId,
      '#00F0FF',
      15.5
    );

    // Center: Large Scroll Up / Down Buttons
    const navBtnW = 114;
    const navStartX = bx + 16 + drillBtnW + 16;
    const doneBtnW = Math.min(310, Math.max(240, Math.round(boxW * 0.24)));
    if (navStartX + navBtnW * 2 + 18 < bx + boxW - doneBtnW - 20) {
      this.drawButton(
        ctx,
        buttons,
        'wiki-scroll-up',
        { x: navStartX, y: footY, width: navBtnW, height: footH },
        '▲ SCROLL UP',
        false,
        hoveredButtonId,
        clampedScroll > 0 ? '#8EF5AB' : COLORS.GREEN_DIM,
        14
      );
      this.drawButton(
        ctx,
        buttons,
        'wiki-scroll-down',
        { x: navStartX + navBtnW + 10, y: footY, width: navBtnW, height: footH },
        '▼ SCROLL DN',
        false,
        hoveredButtonId,
        clampedScroll < maxScrollPx ? '#8EF5AB' : COLORS.GREEN_DIM,
        14
      );
    }

    // Right: Solid Bright Green "◄ RETURN TO GAME [ESC / H]" Button
    this.drawSolidCtaButton(
      ctx,
      buttons,
      'perim-wiki-close',
      { x: bx + boxW - doneBtnW - 16, y: footY, width: doneBtnW, height: footH },
      trainingActive ? '◄ RESUME DRILL [ESC / H]' : '◄ RETURN TO GAME [ESC / H]',
      hoveredButtonId,
      '#44FF77',
      '#B6FFD0',
      16.5
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
      return 46;
    }
    if (block.kind === 'paragraph') {
      ctx.font = '16px "JetBrains Mono", monospace';
      const lines = this.wrapLines(ctx, block.text, innerW);
      return lines.length * 25 + 16;
    }
    if (block.kind === 'bullets') {
      ctx.font = '15.5px "JetBrains Mono", monospace';
      let sum = 6;
      for (const item of block.items) {
        const lines = this.wrapLines(ctx, `${item.lead} ${item.body}`, innerW - 24);
        sum += lines.length * 24 + 12;
      }
      return sum + 8;
    }
    if (block.kind === 'callout') {
      ctx.font = '15.5px "JetBrains Mono", monospace';
      let lineCount = 0;
      for (const l of block.lines) {
        lineCount += this.wrapLines(ctx, l, innerW - 36).length;
      }
      return 42 + lineCount * 24 + 20;
    }
    if (block.kind === 'formula') {
      ctx.font = 'bold 15.5px "JetBrains Mono", monospace';
      const exprLines = this.wrapLines(ctx, block.expr, innerW - 36);
      ctx.font = '14.5px "JetBrains Mono", monospace';
      let noteLines = 0;
      for (const n of block.notes) {
        noteLines += this.wrapLines(ctx, `• ${n}`, innerW - 36).length;
      }
      return 40 + exprLines.length * 24 + 10 + noteLines * 22.5 + 22;
    }
    if (block.kind === 'table') {
      ctx.font = '14px "JetBrains Mono", monospace';
      let total = 36; // header row
      for (const row of block.rows) {
        let maxLines = 1;
        row.cols.forEach((cell, ci) => {
          const cw = Math.max(52, innerW * (block.colFracs[ci] ?? 0.25) - 16);
          const cnt = this.wrapLines(ctx, cell, cw).length;
          if (cnt > maxLines) maxLines = cnt;
        });
        total += maxLines * 21.5 + 14;
      }
      return total + 20;
    }
    if (block.kind === 'bestiary') {
      const scanW = 124;
      const textW = Math.max(180, innerW - scanW - 34);
      let total = 4;
      for (const entry of block.entries) {
        ctx.font = '14px "JetBrains Mono", monospace';
        const threatLines = this.wrapLines(ctx, `THREAT: ${entry.threat}`, textW).length;
        const counterLines = this.wrapLines(ctx, `COUNTER: ${entry.counter}`, textW).length;
        const textH = 60 + threatLines * 20 + 8 + counterLines * 20 + 14;
        const cardH = Math.max(132, textH);
        total += cardH + 12;
      }
      return total + 8;
    }
    return 0;
  }

  private renderBlock(
    ctx: CanvasRenderingContext2D,
    block: WikiBlock,
    x: number,
    y: number,
    innerW: number,
    chapterAccent: string,
    timeSec: number
  ): number {
    if (block.kind === 'heading') {
      const accent = block.accent ?? '#FFB000';
      ctx.fillStyle = 'rgba(20, 48, 30, 0.68)';
      ctx.fillRect(x, y, innerW, 34);
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, 5, 34);
      ctx.textAlign = 'left';
      ctx.font = 'bold 18px "Share Tech Mono", monospace';
      ctx.fillStyle = accent;
      ctx.fillText(block.text, x + 15, y + 23, innerW - 22);
      return y + 46;
    }

    if (block.kind === 'paragraph') {
      ctx.textAlign = 'left';
      ctx.font = '16px "JetBrains Mono", monospace';
      ctx.fillStyle = block.accent ?? '#D4FFE2';
      const lines = this.wrapLines(ctx, block.text, innerW);
      lines.forEach((ln, idx) => {
        ctx.fillText(ln, x, y + 16 + idx * 25);
      });
      return y + lines.length * 25 + 16;
    }

    if (block.kind === 'bullets') {
      let cy = y + 6;
      for (const item of block.items) {
        ctx.textAlign = 'left';
        ctx.font = '15.5px "JetBrains Mono", monospace';
        const lines = this.wrapLines(ctx, `${item.lead} ${item.body}`, innerW - 24);
        ctx.fillStyle = item.accent ?? chapterAccent;
        ctx.fillRect(x + 2, cy + 5, 8, 8);

        lines.forEach((ln, li) => {
          if (li === 0 && ln.startsWith(item.lead)) {
            ctx.font = 'bold 15.5px "JetBrains Mono", monospace';
            ctx.fillStyle = item.accent ?? '#FFE082';
            ctx.fillText(item.lead, x + 20, cy + 15);
            const leadW = ctx.measureText(item.lead).width;
            ctx.font = '15.5px "JetBrains Mono", monospace';
            ctx.fillStyle = '#D0FCE0';
            ctx.fillText(ln.slice(item.lead.length), x + 20 + leadW, cy + 15);
          } else {
            ctx.font = '15.5px "JetBrains Mono", monospace';
            ctx.fillStyle = '#D0FCE0';
            ctx.fillText(ln, x + 20, cy + 15 + li * 24);
          }
        });
        cy += lines.length * 24 + 12;
      }
      return cy + 8;
    }

    if (block.kind === 'callout') {
      const borderCol =
        block.tone === 'warn' ? '#FF5533' : block.tone === 'combo' ? '#00F0FF' : '#FFB000';
      const bgCol =
        block.tone === 'warn'
          ? 'rgba(62, 16, 12, 0.62)'
          : block.tone === 'combo'
            ? 'rgba(6, 36, 44, 0.62)'
            : 'rgba(46, 32, 6, 0.62)';
      const icon = block.tone === 'warn' ? '⚠' : block.tone === 'combo' ? '★' : '▸';

      ctx.font = '15.5px "JetBrains Mono", monospace';
      const wrapped: string[] = [];
      for (const l of block.lines) {
        wrapped.push(...this.wrapLines(ctx, l, innerW - 36));
      }
      const boxH = 42 + wrapped.length * 24 + 8;

      ctx.fillStyle = bgCol;
      ctx.fillRect(x, y, innerW, boxH);
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = 1.8;
      ctx.strokeRect(x, y, innerW, boxH);
      ctx.fillStyle = borderCol;
      ctx.fillRect(x, y, 5, boxH);

      ctx.textAlign = 'left';
      ctx.font = 'bold 17px "Share Tech Mono", monospace';
      ctx.fillStyle = borderCol;
      ctx.fillText(`${icon} ${block.title}`, x + 18, y + 26, innerW - 28);

      ctx.font = '15.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#EEFFF4';
      wrapped.forEach((ln, idx) => {
        ctx.fillText(ln, x + 18, y + 52 + idx * 24);
      });

      return y + boxH + 12;
    }

    if (block.kind === 'formula') {
      ctx.font = 'bold 15.5px "JetBrains Mono", monospace';
      const exprLines = this.wrapLines(ctx, block.expr, innerW - 36);
      ctx.font = '14.5px "JetBrains Mono", monospace';
      const noteLines: string[] = [];
      for (const n of block.notes) {
        noteLines.push(...this.wrapLines(ctx, `• ${n}`, innerW - 36));
      }
      const boxH = 40 + exprLines.length * 24 + 10 + noteLines.length * 22.5 + 10;

      ctx.fillStyle = 'rgba(4, 24, 30, 0.78)';
      ctx.fillRect(x, y, innerW, boxH);
      ctx.strokeStyle = '#00F0FF';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x, y, innerW, boxH);

      ctx.textAlign = 'left';
      ctx.font = 'bold 16px "Share Tech Mono", monospace';
      ctx.fillStyle = '#00F0FF';
      ctx.fillText(`◈ ${block.title}`, x + 16, y + 25, innerW - 28);

      let fy = y + 50;
      ctx.font = 'bold 15.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#FFE082';
      for (const el of exprLines) {
        ctx.fillText(el, x + 18, fy);
        fy += 24;
      }
      fy += 6;
      ctx.font = '14.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#C6FAD8';
      for (const nl of noteLines) {
        ctx.fillText(nl, x + 18, fy);
        fy += 22.5;
      }

      return y + boxH + 12;
    }

    if (block.kind === 'table') {
      const headH = 36;
      ctx.fillStyle = 'rgba(18, 50, 30, 0.90)';
      ctx.fillRect(x, y, innerW, headH);
      ctx.strokeStyle = COLORS.GREEN_DIM;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x, y, innerW, headH);

      let colX = x;
      ctx.textAlign = 'left';
      ctx.font = 'bold 15px "Share Tech Mono", monospace';
      ctx.fillStyle = '#FFB000';
      block.headers.forEach((hdr, ci) => {
        const cw = innerW * (block.colFracs[ci] ?? 0.25);
        ctx.fillText(hdr, colX + 8, y + 23, cw - 12);
        colX += cw;
      });

      let ry = y + headH;
      ctx.font = '14px "JetBrains Mono", monospace';
      block.rows.forEach((row, rIdx) => {
        const cellWrapped: string[][] = [];
        let maxLines = 1;
        row.cols.forEach((cell, ci) => {
          const cw = Math.max(52, innerW * (block.colFracs[ci] ?? 0.25) - 16);
          const lines = this.wrapLines(ctx, cell, cw);
          cellWrapped.push(lines);
          if (lines.length > maxLines) maxLines = lines.length;
        });
        const rowH = maxLines * 21.5 + 14;

        ctx.fillStyle = rIdx % 2 === 1 ? 'rgba(12, 32, 20, 0.54)' : 'rgba(5, 15, 10, 0.54)';
        ctx.fillRect(x, ry, innerW, rowH);
        ctx.strokeStyle = 'rgba(42, 104, 62, 0.52)';
        ctx.lineWidth = 1.1;
        ctx.strokeRect(x, ry, innerW, rowH);

        let cx = x;
        cellWrapped.forEach((lines, ci) => {
          const cw = innerW * (block.colFracs[ci] ?? 0.25);
          ctx.font =
            ci === 0
              ? 'bold 14px "JetBrains Mono", monospace'
              : '14px "JetBrains Mono", monospace';
          ctx.fillStyle = ci === 0 ? row.accent ?? '#52FF86' : '#D4FFE2';
          lines.forEach((ln, li) => {
            ctx.fillText(ln, cx + 8, ry + 21 + li * 21.5);
          });
          cx += cw;
        });
        ry += rowH;
      });

      return ry + 20;
    }

    if (block.kind === 'bestiary') {
      const scanW = 124;
      const textW = Math.max(180, innerW - scanW - 34);
      let cy = y + 4;

      for (const entry of block.entries) {
        cy = this.renderBestiaryCard(ctx, entry, x, cy, innerW, scanW, textW, timeSec);
      }
      return cy + 8;
    }

    return y;
  }

  private renderBestiaryCard(
    ctx: CanvasRenderingContext2D,
    entry: BestiaryCardEntry,
    x: number,
    y: number,
    innerW: number,
    scanW: number,
    textW: number,
    timeSec: number
  ): number {
    ctx.font = '14px "JetBrains Mono", monospace';
    const threatLines = this.wrapLines(ctx, `THREAT: ${entry.threat}`, textW);
    const counterLines = this.wrapLines(ctx, `COUNTER: ${entry.counter}`, textW);
    const textH = 60 + threatLines.length * 20 + 8 + counterLines.length * 20 + 14;
    const cardH = Math.max(132, textH);

    // Outer Specimen Card Chassis
    ctx.fillStyle = 'rgba(5, 16, 10, 0.90)';
    ctx.fillRect(x, y, innerW, cardH);
    ctx.strokeStyle = entry.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, innerW, cardH);
    ctx.fillStyle = entry.accent;
    ctx.fillRect(x, y, 4, cardH);

    // Left Live Bio-Scanner Viewport Box
    const pad = 10;
    const vx = x + pad + 2;
    const vy = y + pad;
    const vw = scanW - 4;
    const vh = cardH - pad * 2;

    ctx.fillStyle = '#020704';
    ctx.fillRect(vx, vy, vw, vh);
    ctx.strokeStyle = 'rgba(68, 255, 119, 0.35)';
    ctx.lineWidth = 1.1;
    ctx.strokeRect(vx, vy, vw, vh);

    // Subtle scanner crosshair & range ring inside viewport
    const scx = vx + vw * 0.5;
    const scy = vy + (vh - 18) * 0.5;
    ctx.save();
    ctx.strokeStyle = 'rgba(59, 224, 104, 0.16)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(vx + 6, scy);
    ctx.lineTo(vx + vw - 6, scy);
    ctx.moveTo(scx, vy + 6);
    ctx.lineTo(scx, vy + vh - 20);
    ctx.arc(scx, scy, Math.min(vw, vh - 20) * 0.38, 0, Math.PI * 2);
    ctx.stroke();

    // Render authentic live-animated in-game vector bio-silhouette!
    this.drawBestiarySpecimen(ctx, entry.kind, scx, scy, timeSec);
    ctx.restore();

    // Bottom scanner code strip inside viewport
    ctx.fillStyle = 'rgba(12, 32, 20, 0.85)';
    ctx.fillRect(vx + 1, vy + vh - 19, vw - 2, 18);
    ctx.textAlign = 'center';
    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    ctx.fillStyle = entry.accent;
    ctx.fillText(`ID: ${entry.code}`, scx, vy + vh - 6);

    // Right Dossier Details
    const tx = vx + vw + 16;

    // Row 1: Name + Right Role Tag Pill
    ctx.textAlign = 'left';
    ctx.font = 'bold 18px "Share Tech Mono", monospace';
    ctx.fillStyle = entry.accent;
    ctx.fillText(entry.name, tx, y + 25, textW - 154);

    ctx.font = 'bold 12px "Share Tech Mono", monospace';
    const tagW = Math.min(148, Math.ceil(ctx.measureText(entry.roleTag).width) + 16);
    const tagX = x + innerW - tagW - 12;
    ctx.fillStyle = 'rgba(14, 30, 20, 0.94)';
    ctx.fillRect(tagX, y + 9, tagW, 22);
    ctx.strokeStyle = entry.accent;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(tagX, y + 9, tagW, 22);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(entry.roleTag, tagX + tagW * 0.5, y + 24, tagW - 8);

    // Row 2: Tabular Telemetry Strip
    ctx.fillStyle = 'rgba(12, 30, 19, 0.72)';
    ctx.fillRect(tx, y + 34, textW, 22);
    ctx.textAlign = 'left';
    ctx.font = 'bold 12.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#FFE082';
    ctx.fillText(entry.statsLine, tx + 8, y + 49, textW - 14);

    // Row 3: Threat description
    let ty = y + 73;
    ctx.font = '14px "JetBrains Mono", monospace';
    threatLines.forEach((ln, idx) => {
      if (idx === 0 && ln.startsWith('THREAT:')) {
        ctx.font = 'bold 14px "JetBrains Mono", monospace';
        ctx.fillStyle = '#FFB000';
        ctx.fillText('THREAT:', tx, ty);
        const lw = ctx.measureText('THREAT:').width;
        ctx.font = '14px "JetBrains Mono", monospace';
        ctx.fillStyle = '#D6FFE4';
        ctx.fillText(ln.slice(7), tx + lw, ty);
      } else {
        ctx.font = '14px "JetBrains Mono", monospace';
        ctx.fillStyle = '#D6FFE4';
        ctx.fillText(ln, tx, ty);
      }
      ty += 20;
    });

    // Row 4: Best counter
    ty += 6;
    counterLines.forEach((ln, idx) => {
      if (idx === 0 && ln.startsWith('COUNTER:')) {
        ctx.font = 'bold 14px "JetBrains Mono", monospace';
        ctx.fillStyle = '#00F0FF';
        ctx.fillText('COUNTER:', tx, ty);
        const lw = ctx.measureText('COUNTER:').width;
        ctx.font = '14px "JetBrains Mono", monospace';
        ctx.fillStyle = '#A8FAFF';
        ctx.fillText(ln.slice(8), tx + lw, ty);
      } else {
        ctx.font = '14px "JetBrains Mono", monospace';
        ctx.fillStyle = '#A8FAFF';
        ctx.fillText(ln, tx, ty);
      }
      ty += 20;
    });

    return y + cardH + 12;
  }

  /**
   * Renders the exact in-game vector bio-silhouette of each Xenomorph caste
   * (matching PerimeterBlueprintRenderer.drawVerifiedBioSilhouette verbatim!)
   * scaled cleanly to fill the CRT Bestiary bio-scanner frame.
   */
  private drawBestiarySpecimen(
    ctx: CanvasRenderingContext2D,
    kind: HostileKind,
    cx: number,
    cy: number,
    timeSec: number
  ): void {
    const scaleByKind: Record<HostileKind, number> = {
      SKITTERER: 2.35,
      DRONE: 1.85,
      BURSTER: 2.15,
      STALKER: 1.85,
      SPITTER: 1.85,
      SCREAMER: 1.6,
      PRAETORIAN: 1.55,
      CRUSHER: 1.22,
      QUEEN: 1.02,
    };
    const strokeByKind: Record<HostileKind, string> = {
      SKITTERER: '#44FF77',
      DRONE: '#44FF77',
      BURSTER: '#C8FF44',
      STALKER: '#B6FFE0',
      SPITTER: '#B8FF3B',
      SCREAMER: '#E066FF',
      PRAETORIAN: '#FF8C24',
      CRUSHER: '#FF7722',
      QUEEN: '#FF3355',
    };

    const s = scaleByKind[kind];
    const strokeCol = strokeByKind[kind];

    ctx.save();
    // Slight offset right on Queen so her long sweeping whip tail centers cleanly inside the scanner box!
    ctx.translate(kind === 'QUEEN' ? cx + 8 : kind === 'DRONE' || kind === 'SKITTERER' ? cx + 4 : cx, cy);
    ctx.scale(s, s);

    // Stalker exposure lock brackets (just like in-game when revealed!)
    if (kind === 'STALKER') {
      const br = 18;
      ctx.strokeStyle = '#8EF5AB';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-br, -br, br * 2, br * 2);
    }

    // Gentle living orientation sway so specimens feel alive in the scanner
    ctx.rotate(Math.sin(timeSec * 1.4) * 0.08);

    ctx.strokeStyle = strokeCol;
    ctx.fillStyle = 'rgba(6, 22, 12, 0.90)';
    ctx.lineWidth =
      kind === 'QUEEN' ? 3.2 : kind === 'CRUSHER' || kind === 'PRAETORIAN' ? 2.6 : 2.0;

    if (kind === 'SKITTERER') {
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-4, -6);
      ctx.lineTo(-8, 0);
      ctx.lineTo(-4, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const legWig = Math.sin(timeSec * 22) * 2.8;
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(-17, legWig);
      for (const lx of [-3, 1, 5]) {
        ctx.moveTo(lx, -4);
        ctx.lineTo(lx - 2, -10 + legWig * 0.4);
        ctx.moveTo(lx, 4);
        ctx.lineTo(lx - 2, 10 - legWig * 0.4);
      }
      ctx.stroke();
    } else if (kind === 'DRONE') {
      const tailSway = Math.sin(timeSec * 10) * 4.5;
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(5, -7);
      ctx.lineTo(-11, -5);
      ctx.lineTo(-14, 0);
      ctx.lineTo(-11, 5);
      ctx.lineTo(5, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(6, -7);
      ctx.lineTo(14, -12);
      ctx.moveTo(6, 7);
      ctx.lineTo(14, 12);
      ctx.moveTo(-14, 0);
      ctx.lineTo(-24, tailSway);
      ctx.stroke();
    } else if (kind === 'PRAETORIAN') {
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(8, -17);
      ctx.lineTo(-14, -13);
      ctx.lineTo(-20, 0);
      ctx.lineTo(-14, 13);
      ctx.lineTo(8, 17);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#FFD266';
      ctx.lineWidth = 4.0;
      ctx.beginPath();
      ctx.arc(3, 0, 18, -1.05, 1.05);
      ctx.stroke();
    } else if (kind === 'BURSTER') {
      const pulseR = 12 + Math.sin(timeSec * 12) * 2.0;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const px = Math.cos(a) * pulseR;
        const py = Math.sin(a) * pulseR;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#D4FF44';
      ctx.beginPath();
      ctx.arc(-2, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 'SPITTER') {
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(5, -7);
      ctx.lineTo(-13, -11);
      ctx.lineTo(-17, 0);
      ctx.lineTo(-13, 11);
      ctx.lineTo(5, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#B8FF3B';
      ctx.beginPath();
      ctx.arc(-6, 0, 5.5 + Math.sin(timeSec * 10) * 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(8, -5);
      ctx.lineTo(18, -10);
      ctx.moveTo(8, 5);
      ctx.lineTo(18, 10);
      ctx.stroke();
    } else if (kind === 'SCREAMER') {
      const ringR = 14 + ((timeSec * 22) % 16);
      ctx.save();
      ctx.strokeStyle = 'rgba(224, 102, 255, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(4, -12);
      ctx.lineTo(-14, -7);
      ctx.lineTo(-10, 0);
      ctx.lineTo(-14, 7);
      ctx.lineTo(4, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (kind === 'CRUSHER') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 176, 0, 0.65)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, 0, 30 + Math.sin(timeSec * 10) * 2.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(25, 0);
      ctx.lineTo(14, -22);
      ctx.lineTo(-16, -18);
      ctx.lineTo(-24, 0);
      ctx.lineTo(-16, 18);
      ctx.lineTo(14, 22);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#FFD266';
      ctx.lineWidth = 4.6;
      ctx.beginPath();
      ctx.arc(4, 0, 23, -1.15, 1.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(14, -14);
      ctx.lineTo(30, -9);
      ctx.moveTo(14, 14);
      ctx.lineTo(30, 9);
      ctx.stroke();
    } else if (kind === 'QUEEN') {
      const tailW = Math.sin(timeSec * 6.5) * 9;
      ctx.fillStyle = 'rgba(38, 6, 12, 0.92)';
      ctx.beginPath();
      ctx.moveTo(30, 0);
      ctx.lineTo(10, -14);
      ctx.lineTo(-4, -29);
      ctx.lineTo(-22, -20);
      ctx.lineTo(-16, -8);
      ctx.lineTo(-26, 0);
      ctx.lineTo(-16, 8);
      ctx.lineTo(-22, 20);
      ctx.lineTo(-4, 29);
      ctx.lineTo(10, 14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#FFD266';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(12, -11);
      ctx.lineTo(28, -22);
      ctx.moveTo(12, 11);
      ctx.lineTo(28, 22);
      ctx.moveTo(-26, 0);
      ctx.quadraticCurveTo(-38, tailW, -46, -tailW * 0.6);
      ctx.stroke();
    } else {
      // STALKER
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(0, -10);
      ctx.lineTo(-13, 0);
      ctx.lineTo(0, 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(4, -7);
      ctx.lineTo(18, -13);
      ctx.moveTo(4, 7);
      ctx.lineTo(18, 13);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawSolidCtaButton(
    ctx: CanvasRenderingContext2D,
    buttons: CrtInteractiveButton[],
    id: string,
    rect: ViewportRect,
    label: string,
    hoveredId: string | null,
    bgColor: string,
    hoverBg: string,
    fontPx: number
  ): void {
    buttons.push({ id, rect, label });
    const hov = hoveredId === id;
    ctx.fillStyle = hov ? hoverBg : bgColor;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = hov ? 2.6 : 2.0;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    ctx.font = `bold ${fontPx}px "Share Tech Mono", monospace`;
    ctx.fillStyle = '#030A05';
    ctx.textAlign = 'center';
    ctx.fillText(
      label,
      rect.x + rect.width * 0.5,
      rect.y + rect.height * 0.5 + fontPx * 0.34,
      rect.width - 14
    );
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
        ? 'rgba(0, 240, 255, 0.16)'
        : 'rgba(6, 16, 10, 0.94)';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = hov ? '#FFFFFF' : accent;
    ctx.lineWidth = hov || active ? 2.2 : 1.6;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

    ctx.font = `bold ${fontPx}px "Share Tech Mono", monospace`;
    ctx.fillStyle = hov ? '#FFFFFF' : accent;
    ctx.textAlign = 'center';
    ctx.fillText(
      label,
      rect.x + rect.width * 0.5,
      rect.y + rect.height * 0.5 + fontPx * 0.34,
      rect.width - 12
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
