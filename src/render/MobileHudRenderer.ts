import { PHYSICS } from '../constants';
import type { SafeAreaInsets } from '../types';
import type { SectorMapSummary } from './CampaignMapRenderer';
import {
  drawControlsCardModal,
  drawModalFrame,
  drawPauseBanner,
  drawStatusToast,
  formatUplinkBadge,
  POST_RUN_IDS,
  SYSTEM_MENU_IDS,
  TOP_CHROME_IDS,
  type ChromeButtonHitbox,
} from './chrome';
import {
  HudRenderer,
  LANDER_CONTROLS_SPEC,
  type CrtInteractiveButton,
  type HudRenderContext,
} from './HudRenderer';
import { drawRankedHudPill, drawRankedTitleRibbon } from './RankedBadge';
import {
  drawEllipsizedText,
  font,
  SEMIOTIC_ICONS,
  THEME,
  wrapTextLines,
} from './theme';

export interface MobileActiveTouchState {
  thrust: boolean;
  overdrive: boolean;
  rollLeft: boolean;
  rollRight: boolean;
  retro: boolean;
}

export class MobileHudRenderer {
  public static getSafeCorridor(
    w: number,
    h: number,
    insets: SafeAreaInsets,
    isFullscreen = false
  ): { topPx: number; bottomPx: number; deckHeightPx: number; bottomPadPx: number } {
    const isLandscape = w > h * 1.15;
    const deckH = isLandscape ? 108 : 136;
    const topPx = Math.max(isFullscreen ? 10 : 8, insets.top) + 54;
    // Extra fullscreen bottom clearance keeps touch buttons clear of curved OLED corners & OS gesture bar
    const fsExtraBot = isFullscreen ? (isLandscape ? 16 : 24) : 0;
    const bottomPadPx = Math.max(12 + fsExtraBot, insets.bottom + 8 + fsExtraBot);
    const bottomPx = h - bottomPadPx - deckH - 6;
    return {
      topPx,
      bottomPx: Math.max(topPx + 110, bottomPx),
      deckHeightPx: deckH,
      bottomPadPx,
    };
  }

  public render(
    ctx: CanvasRenderingContext2D,
    state: HudRenderContext,
    insets: SafeAreaInsets,
    sectorSummaries: readonly SectorMapSummary[],
    touchHoldState: MobileActiveTouchState,
    buttonsOut: CrtInteractiveButton[],
    touchControlsOut: CrtInteractiveButton[]
  ): void {
    const w = state.width;
    const h = state.height;

    if (state.phase === 'TITLE_MENU') {
      this.drawMobileTitleMenu(ctx, w, h, state, insets, sectorSummaries, buttonsOut);
    } else {
      this.drawMobileTopBar(ctx, w, state, insets, buttonsOut);

      if (state.phase === 'SECTOR_BRIEFING' && !state.inlineTeletypeHold) {
        this.drawMobileBriefingModal(ctx, w, h, state, buttonsOut);
      } else {
        this.drawMobileGoNoGoAndWarnings(ctx, w, h, state, insets);

        if (state.phase === 'SECTOR_BRIEFING' && state.inlineTeletypeHold) {
          this.drawMobileTeletypeHoldStrip(ctx, w, h, state, insets, buttonsOut);
          this.drawMobileTouchFlightDeck(
            ctx,
            w,
            h,
            state,
            insets,
            touchHoldState,
            buttonsOut,
            touchControlsOut
          );
        } else if (state.phase === 'FLIGHT') {
          this.drawMobileTouchFlightDeck(
            ctx,
            w,
            h,
            state,
            insets,
            touchHoldState,
            buttonsOut,
            touchControlsOut
          );
        } else if (state.phase === 'PAUSED') {
          drawPauseBanner(
            ctx,
            w,
            h,
            'Tap RESUME to continue descent, CONTROLS for key-card, or MENU for settings.',
            buttonsOut as ChromeButtonHitbox[],
            state.hoveredButtonId,
            state.timeSec
          );
        } else if (state.phase === 'SECTOR_TALLY' && state.lastBreakdown) {
          this.drawMobileTallyModal(ctx, w, h, state, buttonsOut);
        } else if (state.phase === 'HULL_BREACH' && state.lives > 0) {
          this.drawMobileBreachModal(ctx, w, h, state, buttonsOut);
        } else if (
          state.phase === 'CALLSIGN_ENTRY' ||
          state.phase === 'CAMPAIGN_COMPLETE' ||
          (state.phase === 'HULL_BREACH' && state.lives <= 0)
        ) {
          this.drawMobileCallsignModal(ctx, w, h, state, buttonsOut);
        }
      }
    }

    // Transient status toast when no full top modal is open
    if (
      state.statusBannerText &&
      state.statusBannerTimer > 0 &&
      !state.bezel.osdMenuOpen &&
      !state.controlsCardOpen &&
      !state.bezel.flightLogsOpen
    ) {
      const corridor = MobileHudRenderer.getSafeCorridor(w, h, insets, state.isFullscreen);
      const toastY = Math.max(corridor.topPx + 6, corridor.bottomPx - 74);
      const alpha = Math.min(1, state.statusBannerTimer / 0.25);
      drawStatusToast(ctx, w, toastY, state.statusBannerText, state.statusBannerTone, alpha);
    }

    // Top-most global modals (always clear underlying hitboxes via drawModalFrame!)
    if (state.bezel.osdMenuOpen) {
      this.drawMobileSystemMenuModal(ctx, w, h, state, buttonsOut);
    } else if (state.controlsCardOpen) {
      drawControlsCardModal(
        ctx,
        w,
        h,
        {
          ...LANDER_CONTROLS_SPEC,
          hoveredButtonId: state.hoveredButtonId,
        },
        buttonsOut as ChromeButtonHitbox[]
      );
    } else if (state.bezel.flightLogsOpen) {
      this.drawMobileManifestModal(ctx, w, h, state, insets, buttonsOut);
    }
  }

  private addTouchButton(
    ctx: CanvasRenderingContext2D,
    buttonsOut: CrtInteractiveButton[],
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    selected: boolean,
    hoveredId: string | null,
    accent: string = THEME.TEXT_PRIMARY,
    solidFill = false,
    fontPx = 14,
    disabled = false
  ): void {
    buttonsOut.push({
      id,
      rect: { x, y, width: w, height: h },
      label,
      ...(disabled ? { disabled: true } : {}),
    });
    const active = !disabled && (selected || hoveredId === id);

    const clampedPx = Math.max(12, Math.round(fontPx));
    ctx.font = clampedPx >= 13 ? font('button', clampedPx) : font('micro', 12);
    const textBaseY = y + h * 0.5 + Math.round(clampedPx * 0.34);

    if (disabled) {
      ctx.fillStyle = 'rgba(6, 14, 9, 0.72)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(36, 74, 48, 0.62)';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = THEME.TEXT_MUTED;
      ctx.textAlign = 'center';
      drawEllipsizedText(ctx, label, x + w * 0.5, textBaseY, w - 10);
      return;
    }

    if (solidFill) {
      ctx.fillStyle = active ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#FFF2CC';
      ctx.lineWidth = 2.2;
      ctx.strokeRect(x, y, w, h);

      ctx.fillStyle = THEME.INK_INVERSE;
      ctx.textAlign = 'center';
      drawEllipsizedText(ctx, label, x + w * 0.5, textBaseY, w - 10);
      return;
    }

    ctx.fillStyle = active ? 'rgba(68, 255, 119, 0.22)' : 'rgba(6, 16, 10, 0.92)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = active ? accent : THEME.BORDER_SUBTLE;
    ctx.lineWidth = active ? 2.2 : 1.6;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = active ? '#FFFFFF' : accent;
    ctx.textAlign = 'center';
    drawEllipsizedText(ctx, label, x + w * 0.5, textBaseY, w - 10);
  }

  // =========================================================================
  // 1. MOBILE MAIN MENU (WEYLAND-YUTANI AMBER TITLE, 6-SECTOR MAP & LAUNCH)
  // =========================================================================

  private drawMobileTitleMenu(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    insets: SafeAreaInsets,
    sectorSummaries: readonly SectorMapSummary[],
    buttonsOut: CrtInteractiveButton[]
  ): void {
    ctx.save();
    ctx.fillStyle = THEME.BG_VOID;
    ctx.fillRect(0, 0, w, h);

    // Subtle background grid
    ctx.strokeStyle = 'rgba(28, 92, 49, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 0; gx < w; gx += 42) {
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
    }
    for (let gy = 0; gy < h; gy += 42) {
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
    }
    ctx.stroke();

    const padX = Math.max(12, insets.left + 10, insets.right + 10);
    const topY = Math.max(state.isFullscreen ? 12 : 10, insets.top + 8);
    const fsBotExtra = state.isFullscreen ? 24 : 0;
    const botPad = Math.max(12 + fsBotExtra, insets.bottom + 10 + fsBotExtra);
    const contentW = Math.min(540, w - padX * 2);
    const cx = w * 0.5;
    const leftX = cx - contentW * 0.5;

    // Top Quick Utility Bar (>=44px touch targets: ◄ OS top-left + DESKTOP MODE 1-click return!)
    const utilH = 44;
    const utilGap = 5;
    const utilW = Math.floor((contentW - utilGap * 4) / 5);
    const utils = [
      {
        id: TOP_CHROME_IDS.HUB,
        label: '◄ OS',
        accent: THEME.TEXT_PRIMARY,
        active: false,
      },
      {
        id: 'menu-toggle-mobile',
        label: 'DESKTOP',
        accent: THEME.ACCENT_CYAN,
        active: true,
      },
      {
        id: TOP_CHROME_IDS.AUDIO,
        label: state.bezel.audioMuted ? 'MUTED' : 'AUDIO',
        accent: state.bezel.audioMuted ? THEME.ALERT_RED_TEXT : THEME.TEXT_BRIGHT,
        active: !state.bezel.audioMuted,
      },
      {
        id: 'hud-logs-toggle',
        label: utilW >= 92 ? 'LEADERBOARD' : 'RANKS',
        accent: THEME.ACCENT_AMBER,
        active: state.bezel.flightLogsOpen,
      },
      {
        id: TOP_CHROME_IDS.MENU,
        label: 'MENU',
        accent: THEME.TEXT_BRIGHT,
        active: state.bezel.osdMenuOpen,
      },
    ];
    utils.forEach((u, idx) => {
      this.addTouchButton(
        ctx,
        buttonsOut,
        u.id,
        leftX + idx * (utilW + utilGap),
        topY,
        utilW,
        utilH,
        u.label,
        u.active,
        state.hoveredButtonId,
        u.accent,
        false,
        13
      );
    });

    let curY = topY + utilH + 10;
    const isRanked = state.selectedMenuMode === 'RANKED_CAMPAIGN';
    const isPractice = state.selectedMenuMode === 'PRACTICE';
    const isEndless = state.selectedMenuMode === 'ENDLESS';
    const isRankedSelection = isRanked || isEndless;

    // Title: Weyland-Yutani Amber Gold when Ranked is armed (calm P39 Green in Practice)
    ctx.textAlign = 'center';
    ctx.font = font('display', w < 380 ? 22 : 26);
    ctx.fillStyle = isRankedSelection ? THEME.ACCENT_AMBER : THEME.TEXT_PRIMARY;
    drawEllipsizedText(ctx, 'LV-426 LUNAR LANDER', cx, curY + 20, contentW);
    curY += 26;

    drawRankedTitleRibbon(
      ctx,
      leftX,
      curY,
      contentW,
      22,
      isRanked
        ? `${SEMIOTIC_ICONS.STAR} RANKED CAMPAIGN — HIGH SCORE RECORDED ${SEMIOTIC_ICONS.STAR}`
        : isEndless
          ? `${SEMIOTIC_ICONS.STAR} RANKED ENDLESS — HIGH SCORE RECORDED ${SEMIOTIC_ICONS.STAR}`
          : `PRACTICE SEC-0${state.selectedStartSector} (UNRANKED · NOT RECORDED)`,
      state.timeSec,
      isRankedSelection
    );
    curY += 27;

    // Compact Live Global #01 Leader Strip
    const champH = 44;
    ctx.fillStyle = 'rgba(22, 14, 3, 0.84)';
    ctx.fillRect(leftX, curY, contentW, champH);
    ctx.strokeStyle = THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(leftX, curY, contentW, champH);

    ctx.font = font('micro', 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    const campChamp = state.campaignLeader
      ? `${state.campaignLeader.callsign} (${state.campaignLeader.score.toLocaleString()})`
      : 'UNCLAIMED';
    const endChamp = state.endlessLeader
      ? `${state.endlessLeader.callsign} (${state.endlessLeader.score.toLocaleString()})`
      : 'UNCLAIMED';
    drawEllipsizedText(ctx, `#1 CAMPAIGN: ${campChamp}`, leftX + 8, curY + 17, contentW - 16);
    drawEllipsizedText(ctx, `#1 ENDLESS:  ${endChamp}`, leftX + 8, curY + 36, contentW - 16);
    curY += champH + 8;

    // 6-Sector Campaign Descent Mini-Map Grid (2 rows x 3 cols)
    const availBeforeButtons = Math.max(94, h - botPad - curY - 238);
    const mapGridH = Math.min(162, availBeforeButtons);
    const cols = 3;
    const rows = 2;
    const tileGap = 6;
    const tileW = Math.floor((contentW - tileGap * (cols - 1)) / cols);
    const tileH = Math.max(46, Math.floor((mapGridH - tileGap) / rows));

    sectorSummaries.slice(0, 6).forEach((s, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const tx = leftX + col * (tileW + tileGap);
      const ty = curY + row * (tileH + tileGap);
      const tileId = `menu-map-sec-${s.num}`;
      buttonsOut.push({
        id: tileId,
        rect: { x: tx, y: ty, width: tileW, height: tileH },
        label: `SEC-0${s.num}`,
      });

      const pracSel = isPractice && state.selectedStartSector === s.num;
      ctx.fillStyle = isRanked
        ? 'rgba(54, 26, 4, 0.90)'
        : pracSel
          ? 'rgba(20, 56, 30, 0.92)'
          : 'rgba(5, 14, 9, 0.88)';
      ctx.fillRect(tx, ty, tileW, tileH);

      ctx.strokeStyle = isRanked
        ? THEME.ACCENT_AMBER
        : pracSel
          ? THEME.TEXT_PRIMARY
          : THEME.BORDER_SUBTLE;
      ctx.lineWidth = isRanked || pracSel ? 2.0 : 1.3;
      ctx.strokeRect(tx, ty, tileW, tileH);

      ctx.textAlign = 'left';
      ctx.font = font('micro', 12);
      ctx.fillStyle = isRanked
        ? THEME.ACCENT_AMBER_HI
        : pracSel
          ? THEME.TEXT_BRIGHT
          : THEME.TEXT_PRIMARY;
      ctx.fillText(`0${s.num}/06`, tx + 5, ty + 14);

      ctx.textAlign = 'right';
      ctx.font = font('micro', 12);
      ctx.fillStyle = isRanked
        ? THEME.ACCENT_AMBER
        : pracSel
          ? '#FFFFFF'
          : THEME.TEXT_SECONDARY;
      drawEllipsizedText(
        ctx,
        isRanked ? 'RNK' : pracSel ? `${SEMIOTIC_ICONS.PLAY}GO` : `S0${s.num}`,
        tx + tileW - 5,
        ty + 14,
        tileW * 0.48
      );

      // Mini terrain & ceiling vector trace inside tile
      const mx = tx + 4;
      const my = ty + 18;
      const mw = tileW - 8;
      const mh = Math.max(18, tileH - 22);
      const sec = s.sector;
      const toX = (wx: number) => mx + (wx / sec.worldWidth) * mw;
      const toY = (wy: number) => my + mh - (wy / (sec.worldHeight * 0.95)) * mh;

      if (sec.ceiling && sec.ceiling.length > 1) {
        ctx.strokeStyle = isRanked ? 'rgba(255, 176, 0, 0.55)' : THEME.BORDER_SUBTLE;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let k = 0; k < sec.ceiling.length; k += 4) {
          const px = toX(sec.ceiling[k].x);
          const py = Math.max(my, Math.min(my + mh, toY(sec.ceiling[k].y)));
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      ctx.strokeStyle = isRanked
        ? THEME.ACCENT_AMBER_HI
        : pracSel
          ? THEME.TEXT_BRIGHT
          : THEME.TEXT_PRIMARY;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k < sec.terrain.length; k += 4) {
        const px = toX(sec.terrain[k].x);
        const py = Math.max(my, Math.min(my + mh, toY(sec.terrain[k].y)));
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    });

    curY += tileH * 2 + tileGap + 8;

    // Dedicated Mode Selector Buttons + Bottom Amber [LAUNCH] Button (all >=44px tall)
    const btnH = 44;
    const btnGap = 6;

    this.addTouchButton(
      ctx,
      buttonsOut,
      'menu-select-ranked',
      leftX,
      curY,
      contentW,
      btnH,
      isRanked
        ? `${SEMIOTIC_ICONS.STAR} RANKED CAMPAIGN (6 SECTORS) ${SEMIOTIC_ICONS.STAR}`
        : 'RANKED CAMPAIGN (6 SECTORS)',
      isRanked,
      state.hoveredButtonId,
      isRanked ? THEME.ACCENT_AMBER_HI : THEME.ACCENT_AMBER,
      false,
      14
    );
    curY += btnH + btnGap;

    this.addTouchButton(
      ctx,
      buttonsOut,
      'menu-select-practice',
      leftX,
      curY,
      contentW,
      btnH,
      isPractice
        ? `${SEMIOTIC_ICONS.PLAY} PRACTICE: SEC-0${state.selectedStartSector} (SINGLE MAP)`
        : 'PRACTICE MODE (TAP ANY SECTOR 01–06)',
      isPractice,
      state.hoveredButtonId,
      THEME.TEXT_BRIGHT,
      false,
      14
    );
    curY += btnH + btnGap;

    this.addTouchButton(
      ctx,
      buttonsOut,
      'menu-select-endless',
      leftX,
      curY,
      contentW,
      btnH,
      `${SEMIOTIC_ICONS.STAR} ENDLESS DEEP-SURVEY (RANKED)`,
      isEndless,
      state.hoveredButtonId,
      THEME.ACCENT_AMBER,
      false,
      14
    );
    curY += btnH + btnGap + 2;

    // Prominent Solid-Amber Launch Button at Bottom!
    const crt1979On = state.crtPreset === 'CLASSIC_1979';
    const bonusTag = crt1979On && !isPractice ? ' [1.5X]' : '';
    const commitLabel = isRanked
      ? `${SEMIOTIC_ICONS.PLAY} LAUNCH RANKED CAMPAIGN${bonusTag}`
      : isPractice
        ? `${SEMIOTIC_ICONS.PLAY} LAUNCH PRACTICE SEC-0${state.selectedStartSector}`
        : `${SEMIOTIC_ICONS.PLAY} LAUNCH ENDLESS SURVEY${bonusTag}`;
    this.addTouchButton(
      ctx,
      buttonsOut,
      'menu-commit',
      leftX,
      curY,
      contentW,
      46,
      commitLabel,
      true,
      state.hoveredButtonId,
      THEME.ACCENT_AMBER_HI,
      true,
      15
    );
    curY += 50;

    // 1-Tap 1979 CRT 1.5X Ranked Challenge Pill right under Launch
    this.addTouchButton(
      ctx,
      buttonsOut,
      TOP_CHROME_IDS.CRT,
      leftX,
      curY,
      contentW,
      30,
      crt1979On
        ? `${SEMIOTIC_ICONS.STAR} 1979 CRT ARMED: 1.5X RANKED SCORE (LOCKED FOR RUN)`
        : `${SEMIOTIC_ICONS.STAR} TAP FOR 1979 CRT MODE (+1.5X RANKED SCORE)`,
      crt1979On,
      state.hoveredButtonId,
      THEME.ACCENT_AMBER_HI,
      false,
      12
    );
    curY += 34;

    // Fixed Distinct SAS ON vs OFF Explanation Note (>=12px, zero identical copy bug!)
    const sasMobileNote = state.bezel.sasEnabled
      ? 'SAS [ON]: 50% GENTLE ROLL ASSIST'
      : 'SAS [OFF]: 100% RAW RCS TORQUE';
    ctx.font = font('micro', 12);
    ctx.textAlign = 'center';
    ctx.fillStyle = state.bezel.sasEnabled ? THEME.TEXT_BRIGHT : THEME.ACCENT_AMBER_HI;
    drawEllipsizedText(ctx, sasMobileNote, cx, curY + 8, contentW - 8);

    ctx.restore();
  }

  // =========================================================================
  // 2. SPACE-PRESERVING MOBILE IN-FLIGHT TOP BAR + GO/CAUTION/NO-GO + DECK
  // =========================================================================

  private drawMobileTopBar(
    ctx: CanvasRenderingContext2D,
    w: number,
    state: HudRenderContext,
    insets: SafeAreaInsets,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    ctx.save();
    const topY = Math.max(state.isFullscreen ? 8 : 6, insets.top + 4);
    const padL = Math.max(8, insets.left + 8);
    const padR = Math.max(8, insets.right + 8);
    const barH = 46;

    ctx.fillStyle = 'rgba(3, 9, 5, 0.92)';
    ctx.fillRect(0, 0, w, topY + barH + 4);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(padL, topY + barH + 2);
    ctx.lineTo(w - padR, topY + barH + 2);
    ctx.stroke();

    // Left: 3 Shuttle Life Pips + Score + High-Contrast Fuel Bar
    const lowLives = state.lives === 1;
    for (let i = 0; i < state.maxLives; i++) {
      const alive = i < state.lives;
      const sx = padL + i * 18;
      const sy = topY + 5;
      ctx.fillStyle = alive
        ? lowLives
          ? THEME.ACCENT_AMBER
          : THEME.TEXT_PRIMARY
        : 'rgba(90, 20, 14, 0.5)';
      ctx.strokeStyle = alive
        ? lowLives
          ? THEME.ACCENT_AMBER_HI
          : THEME.TEXT_PRIMARY
        : THEME.ALERT_RED_STROKE;
      ctx.lineWidth = 1.4;
      ctx.fillRect(sx, sy, 13, 14);
      ctx.strokeRect(sx, sy, 13, 14);
    }

    ctx.textAlign = 'left';
    ctx.font = font('data', 16);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    const scoreStr = String(Math.round(state.displayedScore)).padStart(6, '0');
    ctx.fillText(scoreStr, padL + 58, topY + 18);
    const scoreRightX = padL + 58 + ctx.measureText(scoreStr).width + 8;
    if (scoreRightX + 78 < w - padR - 202) {
      drawRankedHudPill(ctx, scoreRightX, topY + 3, 18, state.timeSec, !state.isPracticeRun, true);
    }

    // High-Contrast Fuel Progress Bar (dark ink plate behind label for WCAG-AAA legibility at 0..100%)
    const fuelRatio = Math.max(
      0,
      Math.min(1, state.lander.fuelKg / Math.max(1, state.lander.maxFuelKg))
    );
    const fBarW = Math.min(146, Math.max(98, w * 0.33));
    const fBarY = topY + 24;
    const fBarH = 18;
    ctx.fillStyle = THEME.BG_VOID;
    ctx.fillRect(padL, fBarY, fBarW, fBarH);
    ctx.strokeStyle = fuelRatio <= 0.18 ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(padL + 0.5, fBarY + 0.5, fBarW - 1, fBarH - 1);

    ctx.fillStyle = fuelRatio <= 0.18 ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
    ctx.fillRect(padL + 2, fBarY + 2, Math.max(0, (fBarW - 4) * fuelRatio), fBarH - 4);

    // High-contrast centered dark pill plate behind fuel text so it is always crisp over fill & void
    const fuelText = `FUEL ${state.lander.fuelKg.toFixed(0)}K`;
    ctx.font = font('micro', 12);
    const fTxtW = Math.min(fBarW - 6, Math.ceil(ctx.measureText(fuelText).width + 8));
    const plateX = Math.round(padL + (fBarW - fTxtW) * 0.5);
    ctx.fillStyle = 'rgba(3, 8, 5, 0.86)';
    ctx.fillRect(plateX, fBarY + 2, fTxtW, fBarH - 4);

    ctx.fillStyle = fuelRatio <= 0.18 ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER_HI;
    ctx.textAlign = 'center';
    ctx.fillText(fuelText, padL + fBarW * 0.5, fBarY + 13);

    // Right: >=44x44 Touch Buttons [SAS] [EXIT FS / FULL] [MENU]
    const btnW = 60;
    const btnH = 44;
    const gap = 5;
    let rx = w - padR - btnW;

    this.addTouchButton(
      ctx,
      buttonsOut,
      TOP_CHROME_IDS.MENU,
      rx,
      topY + 1,
      btnW,
      btnH,
      'MENU',
      state.bezel.osdMenuOpen,
      state.hoveredButtonId,
      THEME.ACCENT_AMBER,
      false,
      13
    );
    rx -= btnW + gap;

    this.addTouchButton(
      ctx,
      buttonsOut,
      'hud-fullscreen-toggle',
      rx,
      topY + 1,
      btnW,
      btnH,
      state.isFullscreen ? 'EXIT FS' : 'FULL',
      state.isFullscreen,
      state.hoveredButtonId,
      THEME.ACCENT_AMBER_HI,
      false,
      13
    );
    rx -= btnW + gap;

    this.addTouchButton(
      ctx,
      buttonsOut,
      'lander-sas-toggle',
      rx,
      topY + 1,
      btnW,
      btnH,
      state.bezel.sasEnabled ? 'SAS:50' : 'SAS:OFF',
      state.bezel.sasEnabled,
      state.hoveredButtonId,
      state.bezel.sasEnabled ? THEME.TEXT_BRIGHT : THEME.ACCENT_AMBER,
      false,
      12
    );

    ctx.restore();
  }

  private drawMobileTeletypeHoldStrip(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    insets: SafeAreaInsets,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    const corridor = MobileHudRenderer.getSafeCorridor(w, h, insets, state.isFullscreen);
    const stripW = Math.min(460, w - 16);
    const stripH = 38;
    const sx = Math.round((w - stripW) * 0.5);
    const sy = corridor.topPx + 6;

    ctx.save();
    ctx.fillStyle = 'rgba(4, 13, 8, 0.94)';
    ctx.fillRect(sx, sy, stripW, stripH);
    ctx.strokeStyle = THEME.ACCENT_AMBER;
    ctx.lineWidth = 1.8;
    ctx.strokeRect(sx + 0.5, sy + 0.5, stripW - 1, stripH - 1);

    const dropW = 72;
    this.addTouchButton(
      ctx,
      buttonsOut,
      'briefing-launch',
      sx + stripW - dropW - 4,
      sy + 4,
      dropW,
      stripH - 8,
      'DROP',
      true,
      state.hoveredButtonId,
      THEME.ACCENT_AMBER_HI,
      true,
      12
    );

    const rawLine = `${state.sector.code} · ${state.sector.name} · TAP THRUST TO DROP`;
    const visible = rawLine.slice(0, Math.max(12, Math.floor(state.briefingProgressChars)));
    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.ACCENT_AMBER_HI;
    ctx.textAlign = 'left';
    drawEllipsizedText(ctx, visible, sx + 10, sy + 23, stripW - dropW - 18);
    ctx.restore();
  }

  private drawMobileGoNoGoAndWarnings(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    insets: SafeAreaInsets
  ): void {
    const lander = state.lander;
    const snap =
      (state.phase === 'SECTOR_TALLY' || state.phase === 'HULL_BREACH') && state.touchdownSnapshot
        ? state.touchdownSnapshot
        : null;

    let closestPad = snap?.pad ?? null;
    let closestDist = snap?.dist ?? Infinity;
    if (!snap) {
      for (const p of state.sector.pads) {
        const cx = (p.x1 + p.x2) * 0.5;
        const d = Math.hypot(lander.pos.x - cx, lander.pos.y + PHYSICS.STRUT_REST_BOTTOM_Y - p.y);
        if (d < closestDist) {
          closestDist = d;
          closestPad = p;
        }
      }
    }

    const corridor = MobileHudRenderer.getSafeCorridor(w, h, insets, state.isFullscreen);

    // 1st-Flight Mobile Radar Hint (fades cleanly & clears immediately on first ping!)
    if (state.phase === 'FLIGHT' && lander.alive && state.mobileRadarHintTimer > 0) {
      const alpha = Math.min(1, state.mobileRadarHintTimer / 0.8);
      const hintY = corridor.topPx + (closestDist <= PHYSICS.APPROACH_PROXIMITY_M ? 70 : 10);
      drawStatusToast(
        ctx,
        w,
        hintY,
        `${SEMIOTIC_ICONS.DIAMOND} TAP SKY TO PING RADAR`,
        'cyan',
        alpha
      );
    }

    if (
      closestPad &&
      (snap !== null || (lander.alive && closestDist <= PHYSICS.APPROACH_PROXIMITY_M))
    ) {
      const vs = snap ? snap.vs : Math.abs(Math.min(0, lander.vel.y));
      const hs = snap ? snap.hs : Math.abs(lander.vel.x);
      const deg = snap ? snap.deg : Math.abs((lander.angle * 180) / Math.PI);
      const padCx = (closestPad.x1 + closestPad.x2) * 0.5;
      const offsetM = snap ? snap.offsetM : lander.pos.x - padCx;
      const padHalfW = Math.max(1, (closestPad.x2 - closestPad.x1) * 0.5);
      const safeBoundM = Math.max(1.0, padHalfW - PHYSICS.STRUT_SPAN_HALF_X + 0.85);
      const kissBoundM = Math.min(padHalfW * 0.48, safeBoundM);

      const cards = [
        {
          lbl: 'V/S',
          val: `${vs.toFixed(1)}`,
          kiss: vs < PHYSICS.KISS_VS_MAX,
          go: vs <= PHYSICS.SAFE_VS_MAX,
          fatal: vs > PHYSICS.SURVIVAL_VS_MAX,
        },
        {
          lbl: 'H/S',
          val: `${hs.toFixed(1)}`,
          kiss: hs < PHYSICS.KISS_HS_MAX,
          go: hs <= PHYSICS.SAFE_HS_MAX,
          fatal: hs > PHYSICS.SURVIVAL_HS_MAX,
        },
        {
          lbl: 'ATT',
          val: `${deg.toFixed(0)}°`,
          kiss: deg <= 3.0,
          go: deg <= PHYSICS.SAFE_ANGLE_DEG,
          fatal: deg > PHYSICS.SURVIVAL_ANGLE_DEG,
        },
      ];

      const panelW = Math.min(404, w - 12);
      const panelX = (w - panelW) * 0.5;
      const panelY = corridor.topPx + 2;
      const panelH = 62;

      ctx.save();
      ctx.fillStyle = 'rgba(3, 9, 5, 0.94)';
      ctx.fillRect(panelX, panelY, panelW, panelH);
      ctx.strokeStyle = THEME.BORDER_SUBTLE;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(panelX, panelY, panelW, panelH);

      const cGap = 5;
      const cW = (panelW - 12 - cGap * 2) / 3;
      cards.forEach((c, idx) => {
        const cx = panelX + 6 + idx * (cW + cGap);
        const col = c.go
          ? THEME.TEXT_PRIMARY
          : c.fatal
            ? THEME.ALERT_RED_TEXT
            : THEME.ACCENT_AMBER;
        const strokeCol = c.go
          ? THEME.TEXT_PRIMARY
          : c.fatal
            ? THEME.ALERT_RED_STROKE
            : THEME.ACCENT_AMBER;
        const tag = c.kiss ? 'KISS' : c.go ? 'GO' : c.fatal ? 'NO-GO' : 'CAUT';

        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = 1.6;
        ctx.strokeRect(cx, panelY + 4, cW, 31);

        ctx.textAlign = 'left';
        ctx.font = font('micro', 12);
        ctx.fillStyle = '#FFFFFF';
        drawEllipsizedText(ctx, `${c.lbl} ${c.val}`, cx + 4, panelY + 23, cW * 0.62);

        ctx.textAlign = 'right';
        ctx.font = font('micro', 12);
        ctx.fillStyle = col;
        ctx.fillText(tag, cx + cW - 4, panelY + 23);
      });

      // Mini Soft-Kiss ILS Centerline Strip
      const ilsX = panelX + 8;
      const ilsW = panelW - 16;
      const ilsY = panelY + 41;
      const ilsH = 15;
      const maxRangeM = Math.max(15, padHalfW * 1.85);
      const toX = (m: number) =>
        ilsX + ilsW * (0.5 + Math.max(-0.48, Math.min(0.48, m / (maxRangeM * 2))));

      ctx.fillStyle = 'rgba(2, 6, 4, 0.96)';
      ctx.fillRect(ilsX, ilsY, ilsW, ilsH);
      ctx.strokeStyle = THEME.BORDER_SUBTLE;
      ctx.strokeRect(ilsX, ilsY, ilsW, ilsH);

      const kl = toX(-kissBoundM);
      const kr = toX(kissBoundM);
      ctx.fillStyle = 'rgba(68, 255, 119, 0.24)';
      ctx.fillRect(kl, ilsY + 1, kr - kl, ilsH - 2);

      const bugX = toX(offsetM);
      const inKiss = Math.abs(offsetM) <= kissBoundM;
      const inSafe = Math.abs(offsetM) <= safeBoundM;
      ctx.fillStyle = inKiss
        ? THEME.TEXT_BRIGHT
        : inSafe
          ? THEME.ACCENT_AMBER_HI
          : THEME.ALERT_RED_STROKE;
      ctx.beginPath();
      ctx.moveTo(bugX, ilsY + 2);
      ctx.lineTo(bugX + 5, ilsY + ilsH * 0.5);
      ctx.lineTo(bugX, ilsY + ilsH - 2);
      ctx.lineTo(bugX - 5, ilsY + ilsH * 0.5);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    // Compact Warning Pill right above the Touch Flight Deck
    if (state.phase === 'FLIGHT' && lander.alive) {
      const warnings = HudRenderer.computeAvionicsWarnings(lander, state.emBlackoutActive);
      if (warnings.length > 0) {
        const primary = warnings[0];
        const wy = corridor.bottomPx - 36;
        const label = primary.critical
          ? `${SEMIOTIC_ICONS.TRIANGLE} ${primary.text} ${SEMIOTIC_ICONS.TRIANGLE}`
          : `${SEMIOTIC_ICONS.DIAMOND} ${primary.text} ${SEMIOTIC_ICONS.DIAMOND}`;
        ctx.save();
        ctx.font = font('button', 15);
        const bw = Math.min(w - 20, Math.ceil(ctx.measureText(label).width + 28));
        const bx = (w - bw) * 0.5;
        ctx.fillStyle = primary.critical ? THEME.ALERT_RED_BG : THEME.ACCENT_AMBER_BG;
        ctx.fillRect(bx, wy, bw, 30);
        ctx.strokeStyle = primary.critical ? THEME.ALERT_RED_STROKE : THEME.ACCENT_AMBER;
        ctx.lineWidth = 2.0;
        ctx.strokeRect(bx, wy, bw, 30);
        ctx.fillStyle = primary.critical ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER_HI;
        ctx.textAlign = 'center';
        drawEllipsizedText(ctx, label, w * 0.5, wy + 20, bw - 12);
        ctx.restore();
      }
    }
  }

  /**
   * Ergonomic Dual-Thumb Multi-Touch 1979 Nostromo Flight Deck along bottom safe-area.
   */
  private drawMobileTouchFlightDeck(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    insets: SafeAreaInsets,
    touchHoldState: MobileActiveTouchState,
    buttonsOut: CrtInteractiveButton[],
    touchControlsOut: CrtInteractiveButton[]
  ): void {
    ctx.save();
    const corridor = MobileHudRenderer.getSafeCorridor(w, h, insets, state.isFullscreen);
    const deckTop = corridor.bottomPx + 4;
    const padL = Math.max(10, insets.left + 8);
    const padR = Math.max(10, insets.right + 8);
    const padB = corridor.bottomPadPx;

    ctx.fillStyle = 'rgba(3, 10, 6, 0.94)';
    ctx.fillRect(0, deckTop - 4, w, h - deckTop + 4);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(padL, deckTop - 3);
    ctx.lineTo(w - padR, deckTop - 3);
    ctx.stroke();

    // Top Telemetry Readout Line inside Deck (enforces >=12px floor!)
    const lander = state.lander;
    const leftTel = `AGL ${lander.agl.toFixed(0)}M | V/S ${lander.vel.y.toFixed(1)} | H/S ${lander.vel.x.toFixed(1)}`;
    const rightTel = `RADAR [${lander.radarCharges}/${lander.maxRadarCharges}]`;
    const availTelW = w - padL - padR - 4;
    ctx.font = font('micro', 12);
    const rightW = Math.ceil(ctx.measureText(rightTel).width + 10);

    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.TEXT_PRIMARY;
    drawEllipsizedText(ctx, leftTel, padL + 2, deckTop + 14, Math.max(90, availTelW - rightW));

    ctx.textAlign = 'right';
    ctx.fillStyle = lander.radarCharges > 0 ? THEME.TEXT_BRIGHT : THEME.ACCENT_AMBER;
    ctx.fillText(rightTel, w - padR - 2, deckTop + 14);

    const ctrlY = deckTop + 21;
    const ctrlH = Math.max(52, h - padB - ctrlY);
    const totalW = w - padL - padR;

    // Left Group (54% width): [ ◄ ROLL ] [ STAB ] [ ROLL ► ]
    const leftGroupW = Math.floor(totalW * 0.54);
    const gap = 6;
    const rollW = Math.floor((leftGroupW - gap * 2) * 0.38);
    const brakeW = leftGroupW - rollW * 2 - gap * 2;

    this.drawHoldPad(
      ctx,
      touchControlsOut,
      'touch-roll-left',
      padL,
      ctrlY,
      rollW,
      ctrlH,
      '◄ ROLL',
      touchHoldState.rollLeft,
      THEME.TEXT_BRIGHT
    );

    this.drawHoldPad(
      ctx,
      touchControlsOut,
      'touch-retro',
      padL + rollW + gap,
      ctrlY,
      brakeW,
      ctrlH,
      'STAB',
      touchHoldState.retro,
      THEME.ACCENT_AMBER_HI
    );

    this.drawHoldPad(
      ctx,
      touchControlsOut,
      'touch-roll-right',
      padL + rollW + gap + brakeW + gap,
      ctrlY,
      rollW,
      ctrlH,
      'ROLL ►',
      touchHoldState.rollRight,
      THEME.TEXT_BRIGHT
    );

    // Right Group (43% width): [ ⚡ PULSE ] + Tall [ ▲▲ OVR / ▲ THRUST ] Pad
    const rightGroupW = totalW - leftGroupW - 10;
    const rightStartX = w - padR - rightGroupW;
    const pulseW = Math.max(56, Math.floor(rightGroupW * 0.34));
    const thrustW = rightGroupW - pulseW - gap;
    const thrustX = rightStartX + pulseW + gap;

    // 1x Emergency Pulse Button (with 0.6s flip-cover guard interlock!)
    const pulseArmed = lander.emergencyPulseAvailable;
    const guardActive = pulseArmed && state.pulseSafetyLockSec > 0;
    this.addTouchButton(
      ctx,
      buttonsOut,
      'touch-pulse',
      rightStartX,
      ctrlY,
      pulseW,
      ctrlH,
      guardActive ? 'GUARD' : pulseArmed ? '⚡PULSE' : 'USED',
      lander.emergencyPulseTimer > 0,
      state.hoveredButtonId,
      guardActive
        ? THEME.ALERT_RED_TEXT
        : pulseArmed
          ? THEME.ACCENT_AMBER
          : THEME.TEXT_MUTED,
      false,
      13,
      !pulseArmed || guardActive
    );

    // Dual-Stage Vertical Throttle Pad: Upper 34% = OVERDRIVE (135%), Lower 66% = MAIN THRUST (100%)
    const ovrH = Math.max(26, Math.floor(ctrlH * 0.34));
    const mainH = ctrlH - ovrH - 3;

    this.drawHoldPad(
      ctx,
      touchControlsOut,
      'touch-overdrive',
      thrustX,
      ctrlY,
      thrustW,
      ovrH,
      '▲▲ OVR',
      touchHoldState.overdrive,
      THEME.ALERT_RED_TEXT
    );

    this.drawHoldPad(
      ctx,
      touchControlsOut,
      'touch-thrust',
      thrustX,
      ctrlY + ovrH + 3,
      thrustW,
      mainH,
      '▲ THRUST',
      touchHoldState.thrust || touchHoldState.overdrive,
      THEME.ACCENT_AMBER_HI
    );

    ctx.restore();
  }

  private drawHoldPad(
    ctx: CanvasRenderingContext2D,
    controlsOut: CrtInteractiveButton[],
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    active: boolean,
    accent: string
  ): void {
    controlsOut.push({ id, rect: { x, y, width: w, height: h }, label });
    ctx.fillStyle = active ? 'rgba(255, 176, 0, 0.34)' : 'rgba(8, 22, 13, 0.92)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = active ? '#FFFFFF' : accent;
    ctx.lineWidth = active ? 2.6 : 1.8;
    ctx.strokeRect(x, y, w, h);

    ctx.font = font('button', 14);
    ctx.fillStyle = active ? '#FFFFFF' : accent;
    ctx.textAlign = 'center';
    drawEllipsizedText(ctx, label, x + w * 0.5, y + h * 0.5 + 5, w - 8);
  }

  // =========================================================================
  // 3. CLEAN MOBILE MODALS (ISOLATED VIA drawModalFrame + ZERO BUGS)
  // =========================================================================

  private drawMobileBriefingModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    const m = drawModalFrame(
      ctx,
      w,
      h,
      {
        title: `${state.sector.code} // ${state.sector.name}`,
        subtitle: `GRAV ${state.sector.gravity.toFixed(2)} M/S² · FUEL ${state.sector.initialFuelKg} KG`,
        maxWidth: 460,
        maxHeight: 320,
        accentColor: THEME.ACCENT_AMBER,
      },
      buttonsOut as ChromeButtonHitbox[]
    );

    ctx.save();
    ctx.font = font('prose', 13);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.textAlign = 'left';
    let cy = m.contentY + 6;
    for (const line of state.sector.briefingLines.slice(0, 3)) {
      const wrapped = wrapTextLines(ctx, line, m.contentW - 4, 2);
      for (const wl of wrapped) {
        if (cy > m.footerY - 14) break;
        ctx.fillText(wl, m.contentX, cy);
        cy += 20;
      }
      cy += 4;
    }
    ctx.restore();

    this.addTouchButton(
      ctx,
      buttonsOut,
      'briefing-launch',
      m.contentX,
      m.footerY - 4,
      m.contentW,
      44,
      `${SEMIOTIC_ICONS.PLAY} ENGAGE LATCH & DROP`,
      true,
      state.hoveredButtonId,
      THEME.ACCENT_AMBER_HI,
      true,
      15
    );
  }

  private drawMobileTallyModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    const bd = state.lastBreakdown!;
    const gradeColor =
      bd.grade === 'SOFT_KISS'
        ? THEME.TEXT_PRIMARY
        : bd.grade === 'HARD_SURVIVAL'
          ? THEME.ACCENT_AMBER
          : THEME.TEXT_PRIMARY;
    const title =
      bd.grade === 'SOFT_KISS'
        ? `${SEMIOTIC_ICONS.STAR} PRECISION SOFT KISS ${SEMIOTIC_ICONS.STAR}`
        : bd.grade === 'HARD_SURVIVAL'
          ? `${SEMIOTIC_ICONS.TRIANGLE} SURVIVAL TOUCHDOWN`
          : `${SEMIOTIC_ICONS.DOT_LIVE} EXTRACTION CONFIRMED`;

    const m = drawModalFrame(
      ctx,
      w,
      h,
      {
        title,
        subtitle: `V/S ${bd.touchdownVs.toFixed(1)} · H/S ${bd.touchdownHs.toFixed(1)} · ATT ${bd.touchdownDeg.toFixed(0)}°`,
        maxWidth: 450,
        maxHeight: state.isPracticeRun ? 356 : 318,
        accentColor: gradeColor,
      },
      buttonsOut as ChromeButtonHitbox[]
    );

    const rows: Array<[string, string]> = [
      [`PAD [${bd.padLabel} ${bd.padMultiplier}X]`, `+${bd.padScore.toLocaleString()}`],
      ['FUEL BONUS', `+${bd.fuelBonus.toLocaleString()}`],
      ['KISS + INTEGRITY', `+${(bd.precisionKissBonus + bd.noDamageBonus).toLocaleString()}`],
      ['STREAK MULTIPLIER', `×${bd.streakMultiplier}`],
      ['SECTOR TOTAL', `+${bd.sectorTotal.toLocaleString()} PTS`],
    ];

    ctx.save();
    ctx.font = font('data', 13);
    rows.forEach(([k, v], i) => {
      const ry = m.contentY + 14 + i * 26;
      ctx.textAlign = 'left';
      ctx.fillStyle = i === 4 ? THEME.TEXT_BRIGHT : THEME.TEXT_PRIMARY;
      ctx.fillText(k, m.contentX, ry);
      ctx.textAlign = 'right';
      ctx.fillStyle = i === 4 ? THEME.ACCENT_AMBER : THEME.ACCENT_AMBER_HI;
      ctx.fillText(v, m.contentX + m.contentW, ry);
    });
    ctx.restore();

    if (state.isPracticeRun) {
      const gap = 8;
      const halfW = Math.floor((m.contentW - gap) * 0.5);
      this.addTouchButton(
        ctx,
        buttonsOut,
        'tally-retry',
        m.contentX,
        m.footerY - 4,
        halfW,
        44,
        `${SEMIOTIC_ICONS.REPLAY} RETRY SECTOR`,
        true,
        state.hoveredButtonId,
        THEME.ACCENT_AMBER_HI,
        true,
        14
      );
      this.addTouchButton(
        ctx,
        buttonsOut,
        'tally-next',
        m.contentX + halfW + gap,
        m.footerY - 4,
        m.contentW - halfW - gap,
        44,
        'MAIN MENU',
        false,
        state.hoveredButtonId,
        THEME.TEXT_BRIGHT,
        false,
        14
      );
    } else {
      const isFinal = !state.sector.endlessMode && state.sector.index >= 6;
      this.addTouchButton(
        ctx,
        buttonsOut,
        'tally-next',
        m.contentX,
        m.footerY - 4,
        m.contentW,
        44,
        isFinal ? 'COMPLETE CAMPAIGN' : `${SEMIOTIC_ICONS.PLAY} NEXT SECTOR`,
        true,
        state.hoveredButtonId,
        THEME.ACCENT_AMBER_HI,
        true,
        15
      );
    }
  }

  private drawMobileBreachModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    const m = drawModalFrame(
      ctx,
      w,
      h,
      {
        title: `HULL BREACH // ${state.lives} SHUTTLE LEFT`,
        subtitle: state.lastFailure?.reason ?? 'CATASTROPHIC STRUCTURAL IMPACT',
        maxWidth: 448,
        maxHeight: 266,
        accentColor: THEME.ALERT_RED_STROKE,
        rightBadge: { text: `${state.lives} LEFT`, tone: 'red' },
      },
      buttonsOut as ChromeButtonHitbox[]
    );

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = font('data', 13);
    ctx.fillStyle = THEME.TEXT_PRIMARY;
    drawEllipsizedText(
      ctx,
      `RUN SCORE: ${Math.round(state.missionScore).toLocaleString()} PTS (${state.highestSectorCode})`,
      m.contentX + m.contentW * 0.5,
      m.contentY + 20,
      m.contentW
    );
    ctx.restore();

    this.addTouchButton(
      ctx,
      buttonsOut,
      'breach-retry',
      m.contentX,
      m.footerY - 52,
      m.contentW,
      44,
      `${SEMIOTIC_ICONS.PLAY} REDEPLOY SHUTTLE (${state.lives} LEFT)`,
      true,
      state.hoveredButtonId,
      THEME.ACCENT_AMBER_HI,
      true,
      14
    );
    this.addTouchButton(
      ctx,
      buttonsOut,
      'breach-end',
      m.contentX,
      m.footerY - 2,
      m.contentW,
      44,
      state.isPracticeRun ? 'END PRACTICE' : 'END RUN & DEBRIEF',
      false,
      state.hoveredButtonId,
      THEME.TEXT_SECONDARY,
      false,
      13
    );
  }

  private drawMobileCallsignModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    const locked = state.debriefKeylockSec > 0.01;
    const isVictory = state.debriefOutcome === 'VICTORY';
    const canSubmit = !state.isPracticeRun && state.missionScore > 0;
    const isDone =
      state.uplinkSubmitState === 'CONFIRMED' || state.uplinkSubmitState === 'OFFLINE_SAVED';
    const isSending = state.uplinkSubmitState === 'TRANSMITTING';

    const m = drawModalFrame(
      ctx,
      w,
      h,
      {
        title: isVictory ? 'CAMPAIGN COMPLETE!' : 'MISSION DEBRIEF // GAME OVER',
        subtitle: `${Math.round(state.missionScore).toLocaleString()} PTS · ${state.highestSectorCode} · ACC ${state.avgAccuracyPercent}%`,
        maxWidth: 448,
        maxHeight: canSubmit ? 360 : 280,
        accentColor: isVictory ? THEME.TEXT_PRIMARY : THEME.ACCENT_AMBER,
        rightBadge: locked
          ? { text: `LOCK ${state.debriefKeylockSec.toFixed(1)}S`, tone: 'amber' }
          : canSubmit
            ? { text: `${SEMIOTIC_ICONS.STAR} RANKED`, tone: 'amber' }
            : { text: 'PRACTICE', tone: 'local' },
      },
      buttonsOut as ChromeButtonHitbox[]
    );

    let cy = m.contentY + 2;

    if (canSubmit) {
      // Tappable Callsign Input Field (Focuses native phone virtual keyboard!)
      const inW = m.contentW - (isDone ? 0 : 62);
      buttonsOut.push({
        id: POST_RUN_IDS.CALLSIGN_BOX,
        rect: { x: m.contentX, y: cy, width: inW, height: 48 },
        label: 'TAP TO EDIT CALLSIGN',
      });

      ctx.save();
      ctx.fillStyle = state.callsignEditing
        ? 'rgba(42, 24, 4, 0.94)'
        : 'rgba(2, 7, 4, 0.96)';
      ctx.fillRect(m.contentX, cy, inW, 48);
      ctx.strokeStyle = isDone
        ? THEME.TEXT_PRIMARY
        : state.callsignEditing
          ? THEME.ACCENT_AMBER_HI
          : THEME.ACCENT_AMBER;
      ctx.lineWidth = 2.0;
      ctx.strokeRect(m.contentX, cy, inW, 48);

      const blink = !isDone && !isSending && Math.sin(state.timeSec * 10) > 0 ? '_' : '';
      ctx.font = font('display', 19);
      ctx.fillStyle = isDone ? THEME.TEXT_PRIMARY : THEME.ACCENT_AMBER_HI;
      ctx.textAlign = 'center';
      drawEllipsizedText(
        ctx,
        `${state.callsignDraft || 'PILOT-01'}${blink}`,
        m.contentX + inW * 0.5,
        cy + 31,
        inW - 14
      );
      ctx.restore();

      if (!isDone) {
        this.addTouchButton(
          ctx,
          buttonsOut,
          'callsign-backspace',
          m.contentX + inW + 6,
          cy,
          56,
          48,
          '⌫',
          false,
          state.hoveredButtonId,
          THEME.ACCENT_AMBER,
          false,
          16
        );
      }

      cy += 64;

      // BUG #3 FIX: Render `uplinkConfirmText` validation/cooldown errors EVEN WHEN `!isDone`!
      ctx.save();
      ctx.font = font('micro', 12);
      ctx.textAlign = 'center';
      let msgText = 'TAP CALLSIGN BOX TO EDIT · TAP TRANSMIT TO POST';
      let msgCol: string = THEME.TEXT_SECONDARY;
      if (isDone && state.uplinkConfirmText) {
        msgText = state.uplinkConfirmText;
        msgCol = THEME.TEXT_PRIMARY;
      } else if (isSending) {
        msgText = 'TRANSMITTING TELEMETRY PACKET...';
        msgCol = THEME.ACCENT_AMBER_HI;
      } else if (state.uplinkConfirmText) {
        // Explicit inline rejection / validation / 15s cooldown error!
        msgText = state.uplinkConfirmText;
        msgCol = THEME.ALERT_RED_TEXT;
      }
      ctx.fillStyle = msgCol;
      const errLines = wrapTextLines(ctx, msgText, m.contentW - 8, 2);
      errLines.forEach((ln, idx) => {
        ctx.fillText(ln, m.contentX + m.contentW * 0.5, cy + idx * 17);
      });
      ctx.restore();

      // Primary Submit / Manifest CTA
      const primaryId = isDone ? POST_RUN_IDS.OPEN_MANIFEST : POST_RUN_IDS.SUBMIT_SCORE;
      const primaryLabel = isSending
        ? 'TRANSMITTING...'
        : isDone
          ? `${SEMIOTIC_ICONS.STAR} VIEW LEADERBOARD`
          : locked
            ? `LOCKED (${state.debriefKeylockSec.toFixed(1)}S)`
            : `${SEMIOTIC_ICONS.PLAY} TRANSMIT SCORE`;

      this.addTouchButton(
        ctx,
        buttonsOut,
        primaryId,
        m.contentX,
        m.footerY - 52,
        m.contentW,
        44,
        primaryLabel,
        !locked,
        state.hoveredButtonId,
        isDone ? THEME.TEXT_PRIMARY : THEME.ACCENT_AMBER_HI,
        !locked && !isSending,
        14,
        locked || isSending
      );
    } else {
      ctx.save();
      ctx.font = font('prose', 13);
      ctx.fillStyle = THEME.TEXT_BRIGHT;
      ctx.textAlign = 'center';
      const note = state.isPracticeRun
        ? 'Practice sortie complete. Launch Ranked mode to post global scores.'
        : 'Score 0 PTS — extract at least 1 sector to submit a Ranked score.';
      const lines = wrapTextLines(ctx, note, m.contentW - 12, 3);
      lines.forEach((ln, idx) => {
        ctx.fillText(ln, m.contentX + m.contentW * 0.5, cy + 20 + idx * 20);
      });
      ctx.restore();
    }

    // Unified Footer: PLAY AGAIN + ◄ MENU + ◄ HUB
    const gap = 6;
    const hubW = Math.min(96, Math.floor(m.contentW * 0.26));
    const menuW = Math.min(108, Math.floor(m.contentW * 0.30));
    const replayW = m.contentW - hubW - menuW - gap * 2;
    this.addTouchButton(
      ctx,
      buttonsOut,
      POST_RUN_IDS.PLAY_AGAIN,
      m.contentX,
      m.footerY - 2,
      replayW,
      44,
      locked ? `WAIT (${state.debriefKeylockSec.toFixed(1)}S)` : `${SEMIOTIC_ICONS.REPLAY} REPLAY`,
      !canSubmit && !locked,
      state.hoveredButtonId,
      THEME.TEXT_BRIGHT,
      !canSubmit && !locked,
      13,
      locked
    );
    this.addTouchButton(
      ctx,
      buttonsOut,
      POST_RUN_IDS.GAME_MENU,
      m.contentX + replayW + gap,
      m.footerY - 2,
      menuW,
      44,
      '◄ MENU',
      false,
      state.hoveredButtonId,
      THEME.ACCENT_AMBER_HI,
      false,
      12,
      locked
    );
    this.addTouchButton(
      ctx,
      buttonsOut,
      POST_RUN_IDS.EXIT_HUB,
      m.contentX + replayW + menuW + gap * 2,
      m.footerY - 2,
      hubW,
      44,
      '◄ HUB',
      false,
      state.hoveredButtonId,
      THEME.ACCENT_CYAN,
      false,
      12,
      locked
    );
  }

  private drawMobileSystemMenuModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    const inRun =
      state.phase === 'FLIGHT' || state.phase === 'PAUSED' || state.phase === 'SECTOR_BRIEFING';

    const m = drawModalFrame(
      ctx,
      w,
      h,
      {
        title: 'SYSTEM & FLIGHT MENU',
        subtitle: 'SIMULATION PAUSED — GLOBAL MU-TH-UR SETTINGS',
        maxWidth: 448,
        maxHeight: Math.min(h - 24, inRun ? 510 : 420),
        accentColor: THEME.ACCENT_AMBER,
        rightBadge: { text: 'PAUSED', tone: 'amber' },
      },
      buttonsOut as ChromeButtonHitbox[]
    );

    let cy = m.contentY - 2;
    const bw = m.contentW;
    const rowCount = inRun ? 6 : 4;
    const availRowsH = Math.max(120, m.footerY - cy - 10);
    const gap = availRowsH < 250 ? 4 : 6;
    const bh = Math.min(44, Math.max(28, Math.floor((availRowsH - gap * (rowCount - 1)) / rowCount)));
    const halfW = Math.floor((bw - gap) * 0.5);

    if (inRun) {
      this.addTouchButton(
        ctx,
        buttonsOut,
        SYSTEM_MENU_IDS.RESUME,
        m.contentX,
        cy,
        bw,
        bh,
        `${SEMIOTIC_ICONS.PLAY} RESUME DESCENT`,
        true,
        state.hoveredButtonId,
        THEME.ACCENT_AMBER_HI,
        true,
        14
      );
      cy += bh + gap;

      this.addTouchButton(
        ctx,
        buttonsOut,
        'lander-jettison',
        m.contentX,
        cy,
        halfW,
        bh,
        state.lives > 1 ? `JETTISON (-1)` : 'FINAL SHUTTLE',
        false,
        state.hoveredButtonId,
        state.lives > 1 ? THEME.ACCENT_AMBER : THEME.TEXT_MUTED,
        false,
        13,
        state.lives <= 1
      );
      this.addTouchButton(
        ctx,
        buttonsOut,
        SYSTEM_MENU_IDS.RESTART,
        m.contentX + halfW + gap,
        cy,
        bw - halfW - gap,
        bh,
        `${SEMIOTIC_ICONS.REPLAY} RESTART RUN`,
        false,
        state.hoveredButtonId,
        THEME.TEXT_BRIGHT,
        false,
        13
      );
      cy += bh + gap;
    }

    // Distinct SAS ON/OFF copy
    this.addTouchButton(
      ctx,
      buttonsOut,
      'lander-sas-toggle',
      m.contentX,
      cy,
      bw,
      bh,
      state.bezel.sasEnabled
        ? 'SAS: ON (50% GENTLE ROLL ASSIST)'
        : 'SAS: OFF (100% RAW RCS TORQUE)',
      state.bezel.sasEnabled,
      state.hoveredButtonId,
      state.bezel.sasEnabled ? THEME.TEXT_BRIGHT : THEME.ACCENT_AMBER,
      false,
      13
    );
    cy += bh + gap;

    // Global 1979 CRT Mode + Phosphor Cycle Row (locked during active gameplay!)
    const crt1979On = state.crtPreset === 'CLASSIC_1979';
    const crtLocked = state.crtModeLocked;
    this.addTouchButton(
      ctx,
      buttonsOut,
      SYSTEM_MENU_IDS.CRT_CYCLE,
      m.contentX,
      cy,
      halfW,
      bh,
      crtLocked
        ? crt1979On
          ? '■ CRT ON [LOCK]'
          : '■ CRT OFF [LOCK]'
        : crt1979On
          ? '1979 CRT: ON (1.5X)'
          : '1979 CRT: OFF',
      crt1979On,
      state.hoveredButtonId,
      crt1979On ? THEME.ACCENT_AMBER_HI : THEME.TEXT_SECONDARY,
      false,
      12,
      crtLocked
    );
    this.addTouchButton(
      ctx,
      buttonsOut,
      SYSTEM_MENU_IDS.PHOSPHOR_CYCLE,
      m.contentX + halfW + gap,
      cy,
      bw - halfW - gap,
      bh,
      `PHOSPHOR: ${state.phosphorTheme}`,
      false,
      state.hoveredButtonId,
      THEME.ACCENT_CYAN,
      false,
      12
    );
    cy += bh + gap;

    // Audio Mute + Fullscreen Row
    this.addTouchButton(
      ctx,
      buttonsOut,
      SYSTEM_MENU_IDS.VOL_MUTE,
      m.contentX,
      cy,
      halfW,
      bh,
      state.bezel.audioMuted
        ? 'AUDIO: MUTED'
        : `AUDIO: ${Math.round(state.masterVolume * 100)}%`,
      !state.bezel.audioMuted,
      state.hoveredButtonId,
      state.bezel.audioMuted ? THEME.ALERT_RED_TEXT : THEME.TEXT_BRIGHT,
      false,
      12
    );
    this.addTouchButton(
      ctx,
      buttonsOut,
      SYSTEM_MENU_IDS.DISPLAY_TOGGLE,
      m.contentX + halfW + gap,
      cy,
      bw - halfW - gap,
      bh,
      state.isFullscreen ? 'EXIT FS' : 'FULLSCREEN',
      state.isFullscreen,
      state.hoveredButtonId,
      THEME.ACCENT_AMBER_HI,
      false,
      12
    );
    cy += bh + gap;

    // Controls Quick-Card + Desktop Layout Toggle
    this.addTouchButton(
      ctx,
      buttonsOut,
      TOP_CHROME_IDS.CONTROLS,
      m.contentX,
      cy,
      halfW,
      bh,
      'CONTROLS CARD',
      false,
      state.hoveredButtonId,
      THEME.ACCENT_CYAN,
      false,
      12
    );
    this.addTouchButton(
      ctx,
      buttonsOut,
      'menu-toggle-mobile',
      m.contentX + halfW + gap,
      cy,
      bw - halfW - gap,
      bh,
      'DESKTOP MODE',
      true,
      state.hoveredButtonId,
      THEME.ACCENT_CYAN,
      false,
      12
    );

    // Footer: CLOSE + ◄ GAME MENU (when in run) + MU-TH-UR OS HUB
    if (inRun) {
      const fGap = 6;
      const thirdW = Math.floor((bw - fGap * 2) / 3);
      this.addTouchButton(
        ctx,
        buttonsOut,
        SYSTEM_MENU_IDS.RESUME,
        m.contentX,
        m.footerY - 2,
        thirdW,
        44,
        'CLOSE',
        false,
        state.hoveredButtonId,
        THEME.TEXT_BRIGHT,
        false,
        12
      );
      this.addTouchButton(
        ctx,
        buttonsOut,
        SYSTEM_MENU_IDS.GAME_MENU,
        m.contentX + thirdW + fGap,
        m.footerY - 2,
        thirdW,
        44,
        state.confirmGameMenuPending ? 'CONFIRM?' : '◄ GAME MENU',
        state.confirmGameMenuPending,
        state.hoveredButtonId,
        state.confirmGameMenuPending ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER_HI,
        false,
        12
      );
      this.addTouchButton(
        ctx,
        buttonsOut,
        SYSTEM_MENU_IDS.EXIT_HUB,
        m.contentX + (thirdW + fGap) * 2,
        m.footerY - 2,
        bw - (thirdW + fGap) * 2,
        44,
        state.confirmExitPending ? 'CONFIRM?' : '◄ HUB',
        state.confirmExitPending,
        state.hoveredButtonId,
        state.confirmExitPending ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER,
        false,
        12
      );
    } else {
      this.addTouchButton(
        ctx,
        buttonsOut,
        SYSTEM_MENU_IDS.RESUME,
        m.contentX,
        m.footerY - 2,
        halfW,
        44,
        'CLOSE MENU',
        false,
        state.hoveredButtonId,
        THEME.TEXT_BRIGHT,
        false,
        13
      );
      this.addTouchButton(
        ctx,
        buttonsOut,
        SYSTEM_MENU_IDS.EXIT_HUB,
        m.contentX + halfW + gap,
        m.footerY - 2,
        bw - halfW - gap,
        44,
        state.confirmExitPending ? '[CONFIRM HUB?]' : 'MU-TH-UR OS HUB',
        state.confirmExitPending,
        state.hoveredButtonId,
        state.confirmExitPending ? THEME.ALERT_RED_TEXT : THEME.ACCENT_AMBER,
        false,
        13
      );
    }
  }

  private drawMobileManifestModal(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: HudRenderContext,
    _insets: SafeAreaInsets,
    buttonsOut: CrtInteractiveButton[]
  ): void {
    const uplinkStatus =
      state.uplinkConnectionStatus === 'LOADING'
        ? 'SYNCING'
        : state.manifestShowingArchive
          ? 'LOCAL'
          : 'LIVE';

    const m = drawModalFrame(
      ctx,
      w,
      h,
      {
        title: 'LUNAR LANDER // LEADERBOARD',
        maxWidth: 520,
        maxHeight: Math.min(560, h - 24),
        accentColor: THEME.TEXT_PRIMARY,
        rightBadge: formatUplinkBadge(uplinkStatus),
      },
      buttonsOut as ChromeButtonHitbox[]
    );

    const tabGap = 8;
    const tabW = Math.floor((m.contentW - tabGap) * 0.5);
    this.addTouchButton(
      ctx,
      buttonsOut,
      `${POST_RUN_IDS.MANIFEST_TAB_PREFIX}CAMPAIGN`,
      m.contentX,
      m.contentY - 2,
      tabW,
      40,
      'CAMPAIGN',
      state.manifestTab === 'CAMPAIGN',
      state.hoveredButtonId,
      THEME.ACCENT_AMBER,
      false,
      14
    );
    this.addTouchButton(
      ctx,
      buttonsOut,
      `${POST_RUN_IDS.MANIFEST_TAB_PREFIX}ENDLESS`,
      m.contentX + tabW + tabGap,
      m.contentY - 2,
      m.contentW - tabW - tabGap,
      40,
      'ENDLESS',
      state.manifestTab === 'ENDLESS',
      state.hoveredButtonId,
      THEME.ACCENT_AMBER,
      false,
      14
    );

    const headY = m.contentY + 54;
    ctx.save();
    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.ACCENT_AMBER;
    ctx.textAlign = 'left';
    ctx.fillText('RNK', m.contentX + 4, headY);
    ctx.fillText('CALLSIGN', m.contentX + 44, headY);
    ctx.textAlign = 'right';
    ctx.fillText('SCORE', m.contentX + m.contentW - 72, headY);
    ctx.fillText('SEC', m.contentX + m.contentW - 4, headY);

    const availH = Math.max(120, m.footerY - headY - 24);
    const maxRows = Math.min(10, Math.max(5, Math.floor(availH / 26)));
    const rowStep = Math.min(28, Math.floor(availH / maxRows));
    const playerTag = state.playerSavedCallsign.trim().toUpperCase();
    const recentRun =
      state.lastSubmittedRun && state.lastSubmittedRun.mode === state.manifestTab
        ? state.lastSubmittedRun
        : null;

    const visible = state.manifestEntries.slice(0, maxRows);
    let matchedNewIdx = -1;
    if (recentRun) {
      if (recentRun.docId) {
        matchedNewIdx = visible.findIndex((e) => e.id === recentRun.docId);
      }
      if (matchedNewIdx === -1) {
        matchedNewIdx = visible.findIndex(
          (e) =>
            e.callsign.toUpperCase() === recentRun.callsign.toUpperCase() &&
            e.score === recentRun.score &&
            e.sector === recentRun.sector
        );
      }
    }

    visible.forEach((entry, idx) => {
      const ry = headY + 24 + idx * rowStep;
      const isNew = idx === matchedNewIdx;
      const isPlayer = playerTag.length > 0 && entry.callsign.toUpperCase() === playerTag;

      if (isNew) {
        ctx.fillStyle = 'rgba(68, 255, 119, 0.24)';
        ctx.fillRect(m.contentX, ry - 15, m.contentW, rowStep - 2);
        ctx.strokeStyle = THEME.TEXT_PRIMARY;
        ctx.lineWidth = 1.6;
        ctx.strokeRect(m.contentX, ry - 15, m.contentW, rowStep - 2);
      } else if (idx % 2 === 1) {
        ctx.fillStyle = THEME.BG_ROW_ALT;
        ctx.fillRect(m.contentX, ry - 15, m.contentW, rowStep - 2);
      }

      ctx.font = font('data', 12);
      ctx.textAlign = 'left';
      ctx.fillStyle = isNew
        ? '#FFFFFF'
        : isPlayer || idx === 0
          ? THEME.ACCENT_AMBER_HI
          : THEME.TEXT_PRIMARY;
      ctx.fillText(`#${String(idx + 1).padStart(2, '0')}`, m.contentX + 4, ry);

      const nameStr = isNew
        ? `${entry.callsign.slice(0, 8)} ${SEMIOTIC_ICONS.STAR}NEW`
        : entry.callsign;
      drawEllipsizedText(ctx, nameStr, m.contentX + 44, ry, Math.max(70, m.contentW - 196));

      ctx.textAlign = 'right';
      ctx.fillStyle = isNew ? THEME.ACCENT_AMBER_HI : THEME.TEXT_BRIGHT;
      ctx.fillText(entry.score.toLocaleString(), m.contentX + m.contentW - 72, ry);
      ctx.fillStyle = isNew ? THEME.TEXT_BRIGHT : THEME.TEXT_SECONDARY;
      ctx.fillText(entry.highestSector, m.contentX + m.contentW - 4, ry);
    });
    ctx.restore();

    const showReplay = state.manifestOpenedPostRun || state.phase === 'TITLE_MENU';
    if (showReplay) {
      const gap = 8;
      const closeW = Math.min(126, Math.floor(m.contentW * 0.36));
      const playW = m.contentW - closeW - gap;
      this.addTouchButton(
        ctx,
        buttonsOut,
        POST_RUN_IDS.MANIFEST_PLAY_AGAIN,
        m.contentX,
        m.footerY - 2,
        playW,
        44,
        `${SEMIOTIC_ICONS.PLAY} PLAY AGAIN`,
        true,
        state.hoveredButtonId,
        THEME.ACCENT_AMBER_HI,
        true,
        14
      );
      this.addTouchButton(
        ctx,
        buttonsOut,
        POST_RUN_IDS.MANIFEST_CLOSE,
        m.contentX + playW + gap,
        m.footerY - 2,
        closeW,
        44,
        'CLOSE',
        false,
        state.hoveredButtonId,
        THEME.TEXT_SECONDARY,
        false,
        14
      );
    } else {
      this.addTouchButton(
        ctx,
        buttonsOut,
        POST_RUN_IDS.MANIFEST_CLOSE,
        m.contentX,
        m.footerY - 2,
        m.contentW,
        44,
        'CLOSE',
        true,
        state.hoveredButtonId,
        THEME.ACCENT_AMBER,
        false,
        14
      );
    }
  }
}
