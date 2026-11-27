import type {
  CartridgeProgramId,
  CrtPreset,
  HostEnvironment,
  PhosphorTheme,
} from '../../shell/Cartridge';
import { drawEllipsizedText, font, SEMIOTIC_ICONS, THEME } from '../theme';
import {
  drawChromeButton,
  drawModalFrame,
  type ChromeButtonAccent,
  type ChromeButtonHitbox,
  type ModalFrameMetrics,
} from './ModalFrame';

export const SYSTEM_MENU_IDS = {
  RESUME: 'sys-resume',
  RESTART: 'sys-restart',
  LEADERBOARD: 'sys-leaderboard',
  CRT_CLASSIC: 'sys-crt-classic',
  CRT_CRISP: 'sys-crt-crisp',
  CRT_CYCLE: 'sys-crt-cycle',
  PHOSPHOR_GREEN: 'sys-phosphor-green',
  PHOSPHOR_AMBER: 'sys-phosphor-amber',
  PHOSPHOR_CYAN: 'sys-phosphor-cyan',
  PHOSPHOR_CYCLE: 'sys-phosphor-cycle',
  VOL_DEC: 'sys-vol-dec',
  VOL_INC: 'sys-vol-inc',
  VOL_MUTE: 'sys-vol-mute',
  DISPLAY_TOGGLE: 'sys-display-toggle',
  SWITCH_LANDER: 'sys-switch-lander',
  SWITCH_PERIMETER: 'sys-switch-perimeter',
  SWITCH_FLAK: 'sys-switch-flak',
  SWITCH_TRENCH: 'sys-switch-trench',
  EXIT_HUB: 'sys-exit-hub',
} as const;

export interface SystemMenuExtraRow {
  id: string;
  label: string;
  value: string;
  accent?: ChromeButtonAccent;
  disabled?: boolean;
}

export interface SystemMenuOptions {
  programTitle: string;
  activeProgramId: CartridgeProgramId;
  crtPreset: CrtPreset;
  phosphorTheme: PhosphorTheme;
  /** 0.0 .. 1.0 */
  masterVolume: number;
  audioMuted: boolean;
  isFullscreen: boolean;
  hoveredButtonId: string | null;
  /** 1-3 game-specific toggle / action rows */
  extraRows?: readonly SystemMenuExtraRow[];
  canRestart?: boolean;
  restartLabel?: string;
  leaderboardLabel?: string;
  confirmExitPending?: boolean;
}

export interface SystemMenuActionCallbacks {
  onResume: () => void;
  onRestart: () => void;
  onOpenLeaderboard: () => void;
  onExitToHub: () => void;
  onExtraAction?: (id: string) => void;
}

const CRT_ORDER: readonly CrtPreset[] = ['CLASSIC_1979', 'CRISP'];
const PHOSPHOR_ORDER: readonly PhosphorTheme[] = ['GREEN', 'AMBER', 'CYAN'];

const CARTRIDGE_SLOTS: ReadonlyArray<{
  id: string;
  programId: CartridgeProgramId;
  label: string;
  keyNum: string;
}> = [
  { id: SYSTEM_MENU_IDS.SWITCH_LANDER, programId: 'lander', label: '[1] LANDER', keyNum: '1' },
  {
    id: SYSTEM_MENU_IDS.SWITCH_PERIMETER,
    programId: 'perimeter',
    label: '[2] PERIMETER',
    keyNum: '2',
  },
  { id: SYSTEM_MENU_IDS.SWITCH_FLAK, programId: 'flak', label: '[3] FLAK', keyNum: '3' },
  { id: SYSTEM_MENU_IDS.SWITCH_TRENCH, programId: 'trench', label: '[4] TRENCH', keyNum: '4' },
];

/**
 * Draws the unified `[ESC]` System & Pause Menu shared by all 4 arcade programs.
 * Always isolates modal hitboxes via `drawModalFrame` (`buttons.length = 0`).
 */
export function drawSystemMenuModal(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: SystemMenuOptions,
  buttons: ChromeButtonHitbox[]
): ModalFrameMetrics {
  const extraRows = opts.extraRows?.slice(0, 3) ?? [];
  const desiredH = 446 + (extraRows.length > 0 ? 26 + extraRows.length * 36 : 0);

  const metrics = drawModalFrame(
    ctx,
    w,
    h,
    {
      title: `SYSTEM & PAUSE MENU // ${opts.programTitle}`,
      subtitle: 'SIMULATION PAUSED — SETTINGS PERSIST ACROSS ALL MU-TH-UR CARTRIDGES',
      maxWidth: 680,
      maxHeight: Math.min(desiredH, 560),
      accentColor: THEME.ACCENT_AMBER,
      rightBadge: { text: 'SIM PAUSED', tone: 'amber' },
    },
    buttons
  );

  const { contentX, contentW, footerY } = metrics;
  let curY = metrics.contentY;
  const compact = metrics.boxH < 470;
  const rowH = compact ? 30 : 34;
  const rowGap = compact ? 5 : 7;

  // 1. Top 3 Primary Actions: RESUME | RESTART RUN | LEADERBOARD
  const actionH = compact ? 36 : 40;
  const actionGap = 8;
  const actionW = Math.floor((contentW - actionGap * 2) / 3);

  drawChromeButton(
    ctx,
    { x: contentX, y: curY, width: actionW, height: actionH },
    `${SEMIOTIC_ICONS.PLAY} RESUME [ESC]`,
    {
      id: SYSTEM_MENU_IDS.RESUME,
      accent: 'green',
      hovered: opts.hoveredButtonId === SYSTEM_MENU_IDS.RESUME,
      active: true,
      fontPx: 13,
    },
    buttons
  );

  drawChromeButton(
    ctx,
    { x: contentX + actionW + actionGap, y: curY, width: actionW, height: actionH },
    opts.restartLabel ?? `${SEMIOTIC_ICONS.REPLAY} RESTART RUN`,
    {
      id: SYSTEM_MENU_IDS.RESTART,
      accent: 'amber',
      hovered: opts.hoveredButtonId === SYSTEM_MENU_IDS.RESTART,
      disabled: opts.canRestart === false,
      fontPx: 13,
    },
    buttons
  );

  drawChromeButton(
    ctx,
    {
      x: contentX + (actionW + actionGap) * 2,
      y: curY,
      width: contentW - (actionW + actionGap) * 2,
      height: actionH,
    },
    opts.leaderboardLabel ?? `${SEMIOTIC_ICONS.STAR} LEADERBOARD`,
    {
      id: SYSTEM_MENU_IDS.LEADERBOARD,
      accent: 'cyan',
      hovered: opts.hoveredButtonId === SYSTEM_MENU_IDS.LEADERBOARD,
      fontPx: 13,
    },
    buttons
  );

  curY += actionH + (compact ? 10 : 14);

  // Helper to paint a clean full-row setting backdrop
  const drawSettingRowBg = (
    y: number,
    label: string,
    rowClickId?: string
  ): { controlX: number; controlW: number } => {
    const hovered = Boolean(rowClickId && opts.hoveredButtonId === rowClickId);
    ctx.save();
    ctx.fillStyle = hovered ? THEME.BG_ROW_HOVER : THEME.BG_ROW_ALT;
    ctx.fillRect(contentX, y, contentW, rowH);
    ctx.strokeStyle = hovered ? THEME.ACCENT_AMBER : THEME.BORDER_SUBTLE;
    ctx.lineWidth = hovered ? 1.5 : 1.0;
    ctx.strokeRect(contentX + 0.5, y + 0.5, contentW - 1, rowH - 1);

    const labelColW = Math.min(185, Math.floor(contentW * 0.32));
    ctx.font = font('data', 12);
    ctx.fillStyle = THEME.TEXT_BRIGHT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    drawEllipsizedText(ctx, label, contentX + 10, y + rowH * 0.5 + 0.5, labelColW - 14);
    ctx.restore();

    if (rowClickId) {
      buttons.push({
        id: rowClickId,
        rect: { x: contentX, y, width: contentW, height: rowH },
        label,
      });
    }

    return {
      controlX: contentX + Math.min(185, Math.floor(contentW * 0.32)) + 4,
      controlW: contentW - Math.min(185, Math.floor(contentW * 0.32)) - 10,
    };
  };

  // 2. Global Hardware Settings
  // Row A: 1979 CRT MODE (ON (1979 CRT) | OFF (CLEAN))
  {
    const { controlX, controlW } = drawSettingRowBg(curY, '1979 CRT MODE', SYSTEM_MENU_IDS.CRT_CYCLE);
    const segGap = 6;
    const segW = Math.floor((controlW - segGap) / 2);
    const segH = rowH - 6;
    const segY = curY + 3;
    const defs: Array<{ id: string; preset: CrtPreset; label: string }> = [
      { id: SYSTEM_MENU_IDS.CRT_CLASSIC, preset: 'CLASSIC_1979', label: 'ON (1979 CRT)' },
      { id: SYSTEM_MENU_IDS.CRT_CRISP, preset: 'CRISP', label: 'OFF (CLEAN)' },
    ];
    defs.forEach((d, idx) => {
      const sx = controlX + idx * (segW + segGap);
      const sw = idx === 1 ? controlW - segW - segGap : segW;
      const isAct = opts.crtPreset === d.preset;
      drawChromeButton(
        ctx,
        { x: sx, y: segY, width: sw, height: segH },
        d.label,
        {
          id: d.id,
          accent: isAct ? 'amber' : 'muted',
          active: isAct,
          hovered: opts.hoveredButtonId === d.id,
          fontPx: 12,
        },
        buttons
      );
    });
    curY += rowH + rowGap;
  }

  // Row B: PHOSPHOR (P39 GREEN | P3 AMBER | MEDBAY CYAN)
  {
    const { controlX, controlW } = drawSettingRowBg(
      curY,
      'PHOSPHOR',
      SYSTEM_MENU_IDS.PHOSPHOR_CYCLE
    );
    const segGap = 6;
    const segW = Math.floor((controlW - segGap * 2) / 3);
    const segH = rowH - 6;
    const segY = curY + 3;
    const defs: Array<{
      id: string;
      theme: PhosphorTheme;
      label: string;
      accent: ChromeButtonAccent;
    }> = [
      { id: SYSTEM_MENU_IDS.PHOSPHOR_GREEN, theme: 'GREEN', label: 'P39 GREEN', accent: 'green' },
      { id: SYSTEM_MENU_IDS.PHOSPHOR_AMBER, theme: 'AMBER', label: 'P3 AMBER', accent: 'amber' },
      { id: SYSTEM_MENU_IDS.PHOSPHOR_CYAN, theme: 'CYAN', label: 'MEDBAY CYAN', accent: 'cyan' },
    ];
    defs.forEach((d, idx) => {
      const sx = controlX + idx * (segW + segGap);
      const sw = idx === 2 ? controlW - (segW + segGap) * 2 : segW;
      const isAct = opts.phosphorTheme === d.theme;
      drawChromeButton(
        ctx,
        { x: sx, y: segY, width: sw, height: segH },
        d.label,
        {
          id: d.id,
          accent: isAct ? d.accent : 'muted',
          active: isAct,
          hovered: opts.hoveredButtonId === d.id,
          fontPx: 12,
        },
        buttons
      );
    });
    curY += rowH + rowGap;
  }

  // Row C: MASTER VOLUME (- / bar + XX% / + / MUTE)
  {
    const { controlX, controlW } = drawSettingRowBg(curY, 'MASTER VOLUME');
    const segH = rowH - 6;
    const segY = curY + 3;
    const btnStepW = 34;
    const muteW = 86;
    const gap = 6;

    drawChromeButton(
      ctx,
      { x: controlX, y: segY, width: btnStepW, height: segH },
      '-',
      {
        id: SYSTEM_MENU_IDS.VOL_DEC,
        accent: 'green',
        hovered: opts.hoveredButtonId === SYSTEM_MENU_IDS.VOL_DEC,
        fontPx: 14,
      },
      buttons
    );

    const plusX = controlX + controlW - muteW - gap - btnStepW;
    const barX = controlX + btnStepW + gap;
    const barW = Math.max(60, plusX - barX - gap);
    const pct = Math.round(Math.max(0, Math.min(1, opts.masterVolume)) * 100);

    // Volume level bar readout
    ctx.save();
    ctx.fillStyle = 'rgba(4, 14, 8, 0.92)';
    ctx.fillRect(barX, segY, barW, segH);
    ctx.strokeStyle = THEME.BORDER_SUBTLE;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(barX + 0.5, segY + 0.5, barW - 1, segH - 1);

    const fillW = Math.round(((barW - 4) * pct) / 100);
    if (fillW > 0) {
      ctx.fillStyle = opts.audioMuted ? 'rgba(78, 138, 98, 0.35)' : 'rgba(68, 255, 119, 0.36)';
      ctx.fillRect(barX + 2, segY + 2, fillW, segH - 4);
    }
    ctx.font = font('data', 12);
    ctx.fillStyle = opts.audioMuted ? THEME.ALERT_RED_TEXT : THEME.TEXT_BRIGHT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      opts.audioMuted ? `MUTED (${pct}%)` : `${pct}%`,
      barX + barW * 0.5,
      segY + segH * 0.5 + 0.5
    );
    ctx.restore();

    drawChromeButton(
      ctx,
      { x: plusX, y: segY, width: btnStepW, height: segH },
      '+',
      {
        id: SYSTEM_MENU_IDS.VOL_INC,
        accent: 'green',
        hovered: opts.hoveredButtonId === SYSTEM_MENU_IDS.VOL_INC,
        fontPx: 14,
      },
      buttons
    );

    drawChromeButton(
      ctx,
      { x: controlX + controlW - muteW, y: segY, width: muteW, height: segH },
      opts.audioMuted ? 'MUTED' : 'AUDIO ON',
      {
        id: SYSTEM_MENU_IDS.VOL_MUTE,
        accent: opts.audioMuted ? 'red' : 'green',
        active: !opts.audioMuted,
        hovered: opts.hoveredButtonId === SYSTEM_MENU_IDS.VOL_MUTE,
        fontPx: 12,
      },
      buttons
    );

    curY += rowH + rowGap;
  }

  // Row D: DISPLAY (WINDOWED | FULLSCREEN)
  {
    const { controlX, controlW } = drawSettingRowBg(
      curY,
      'DISPLAY',
      SYSTEM_MENU_IDS.DISPLAY_TOGGLE
    );
    const segGap = 6;
    const segW = Math.floor((controlW - segGap) / 2);
    const segH = rowH - 6;
    const segY = curY + 3;

    drawChromeButton(
      ctx,
      { x: controlX, y: segY, width: segW, height: segH },
      'WINDOWED',
      {
        id: SYSTEM_MENU_IDS.DISPLAY_TOGGLE,
        accent: !opts.isFullscreen ? 'amber' : 'muted',
        active: !opts.isFullscreen,
        hovered: opts.hoveredButtonId === SYSTEM_MENU_IDS.DISPLAY_TOGGLE,
        fontPx: 12,
      },
      buttons
    );

    drawChromeButton(
      ctx,
      { x: controlX + segW + segGap, y: segY, width: controlW - segW - segGap, height: segH },
      'FULLSCREEN',
      {
        id: SYSTEM_MENU_IDS.DISPLAY_TOGGLE,
        accent: opts.isFullscreen ? 'amber' : 'muted',
        active: opts.isFullscreen,
        hovered: opts.hoveredButtonId === SYSTEM_MENU_IDS.DISPLAY_TOGGLE,
        fontPx: 12,
      },
      buttons
    );

    curY += rowH + rowGap;
  }

  // 3. Game-Specific Program Rows (1-3 slots)
  if (extraRows.length > 0) {
    curY += compact ? 4 : 6;
    ctx.save();
    ctx.font = font('micro', 12);
    ctx.fillStyle = THEME.TEXT_SECONDARY;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('PROGRAM CONFIGURATION', contentX, curY + 6);
    ctx.restore();
    curY += 20;

    for (const row of extraRows) {
      const hov = !row.disabled && opts.hoveredButtonId === row.id;
      const accent = row.accent ?? 'green';
      const valColor = row.disabled
        ? THEME.TEXT_MUTED
        : accent === 'amber'
          ? THEME.ACCENT_AMBER_HI
          : accent === 'red'
            ? THEME.ALERT_RED_TEXT
            : accent === 'cyan'
              ? THEME.ACCENT_CYAN
              : THEME.TEXT_PRIMARY;

      buttons.push({
        id: row.id,
        rect: { x: contentX, y: curY, width: contentW, height: rowH },
        label: `${row.label}: ${row.value}`,
        ...(row.disabled ? { disabled: true } : {}),
      });

      ctx.save();
      ctx.fillStyle = hov ? THEME.BG_ROW_HOVER : THEME.BG_ROW_ALT;
      ctx.fillRect(contentX, curY, contentW, rowH);
      ctx.strokeStyle = hov ? '#FFFFFF' : row.disabled ? THEME.BORDER_SUBTLE : valColor;
      ctx.lineWidth = hov ? 1.8 : 1.2;
      ctx.strokeRect(contentX + 0.5, curY + 0.5, contentW - 1, rowH - 1);

      ctx.font = font('data', 12);
      ctx.fillStyle = row.disabled ? THEME.TEXT_MUTED : hov ? '#FFFFFF' : THEME.TEXT_BRIGHT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      drawEllipsizedText(ctx, row.label, contentX + 10, curY + rowH * 0.5 + 0.5, contentW * 0.56);

      ctx.textAlign = 'right';
      ctx.fillStyle = hov ? '#FFFFFF' : valColor;
      drawEllipsizedText(
        ctx,
        row.value,
        contentX + contentW - 10,
        curY + rowH * 0.5 + 0.5,
        contentW * 0.40
      );
      ctx.restore();

      curY += rowH + rowGap;
    }
  }

  // 4. Quick Cartridge Switcher Strip (+8px clean breathing room above [1-4] buttons)
  const switcherTop = Math.min(footerY - 72, curY + (compact ? 6 : 10));
  ctx.save();
  ctx.font = font('micro', 12);
  ctx.fillStyle = THEME.ACCENT_AMBER;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('QUICK CARTRIDGE SWITCH [1-4] // 0.45S CRT RELAY SNAP', contentX, switcherTop + 6);
  ctx.restore();

  const slotY = switcherTop + 24;
  const slotH = 34;
  const slotGap = 6;
  const slotW = Math.floor((contentW - slotGap * 3) / 4);
  CARTRIDGE_SLOTS.forEach((slot, idx) => {
    const sx = contentX + idx * (slotW + slotGap);
    const sw = idx === 3 ? contentW - (slotW + slotGap) * 3 : slotW;
    const isCurrent = opts.activeProgramId === slot.programId;
    drawChromeButton(
      ctx,
      { x: sx, y: slotY, width: sw, height: slotH },
      isCurrent ? `${SEMIOTIC_ICONS.DOT_LIVE} ${slot.label.replace(/^\[\d\]\s*/, '')}` : slot.label,
      {
        id: slot.id,
        accent: isCurrent ? 'amber' : 'green',
        active: isCurrent,
        disabled: isCurrent,
        hovered: opts.hoveredButtonId === slot.id,
        fontPx: 12,
      },
      buttons
    );
  });

  // 5. Footer: [ESC] RESUME | EXIT TO MU-TH-UR OS
  ctx.save();
  ctx.strokeStyle = THEME.BORDER_SUBTLE;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(contentX, footerY - 8);
  ctx.lineTo(contentX + contentW, footerY - 8);
  ctx.stroke();
  ctx.restore();

  const footBtnH = 36;
  const leftBtnW = Math.min(200, Math.floor(contentW * 0.42));
  const rightBtnW = Math.min(240, Math.floor(contentW * 0.48));

  drawChromeButton(
    ctx,
    { x: contentX, y: footerY, width: leftBtnW, height: footBtnH },
    '[ESC] RESUME',
    {
      id: SYSTEM_MENU_IDS.RESUME,
      accent: 'green',
      hovered: opts.hoveredButtonId === SYSTEM_MENU_IDS.RESUME,
      fontPx: 13,
    },
    buttons
  );

  drawChromeButton(
    ctx,
    { x: contentX + contentW - rightBtnW, y: footerY, width: rightBtnW, height: footBtnH },
    opts.confirmExitPending ? '[CONFIRM EXIT TO HUB?]' : 'EXIT TO MU-TH-UR OS',
    {
      id: SYSTEM_MENU_IDS.EXIT_HUB,
      accent: opts.confirmExitPending ? 'red' : 'muted',
      hovered: opts.hoveredButtonId === SYSTEM_MENU_IDS.EXIT_HUB,
      fontPx: 13,
    },
    buttons
  );

  return metrics;
}

/**
 * Shared click dispatcher for all `SystemMenuModal` controls.
 * Returns `true` if `buttonId` was handled.
 */
export function handleSystemMenuAction(
  buttonId: string,
  host: HostEnvironment,
  callbacks: SystemMenuActionCallbacks
): boolean {
  switch (buttonId) {
    case SYSTEM_MENU_IDS.RESUME:
      host.audio.playButtonLatchLock(1.02, 0.85);
      callbacks.onResume();
      return true;
    case SYSTEM_MENU_IDS.RESTART:
      host.audio.playButtonLatchLock(0.95, 0.9);
      callbacks.onRestart();
      return true;
    case SYSTEM_MENU_IDS.LEADERBOARD:
      host.audio.playButtonLatchLock(1.04, 0.85);
      callbacks.onOpenLeaderboard();
      return true;
    case SYSTEM_MENU_IDS.CRT_CRISP:
      host.setCrtPreset('CRISP');
      return true;
    case SYSTEM_MENU_IDS.CRT_CLASSIC:
      host.setCrtPreset('CLASSIC_1979');
      return true;
    case SYSTEM_MENU_IDS.CRT_CYCLE: {
      const idx = CRT_ORDER.indexOf(host.getCrtPreset());
      host.setCrtPreset(CRT_ORDER[(idx + 1) % CRT_ORDER.length]);
      return true;
    }
    case SYSTEM_MENU_IDS.PHOSPHOR_GREEN:
      host.setPhosphorTheme('GREEN');
      host.audio.playButtonLatchLock(1.04, 0.85);
      return true;
    case SYSTEM_MENU_IDS.PHOSPHOR_AMBER:
      host.setPhosphorTheme('AMBER');
      host.audio.playButtonLatchLock(1.04, 0.85);
      return true;
    case SYSTEM_MENU_IDS.PHOSPHOR_CYAN:
      host.setPhosphorTheme('CYAN');
      host.audio.playButtonLatchLock(1.04, 0.85);
      return true;
    case SYSTEM_MENU_IDS.PHOSPHOR_CYCLE: {
      const idx = PHOSPHOR_ORDER.indexOf(host.getPhosphorTheme());
      host.setPhosphorTheme(PHOSPHOR_ORDER[(idx + 1) % PHOSPHOR_ORDER.length]);
      host.audio.playButtonLatchLock(1.04, 0.85);
      return true;
    }
    case SYSTEM_MENU_IDS.VOL_DEC: {
      const next = Math.max(0, Math.round((host.getMasterVolume() - 0.1) * 10) / 10);
      host.setMasterVolume(next);
      host.audio.playButtonLatchLock(0.92, 0.75);
      return true;
    }
    case SYSTEM_MENU_IDS.VOL_INC: {
      const next = Math.min(1, Math.round((host.getMasterVolume() + 0.1) * 10) / 10);
      host.setMasterVolume(next);
      if (host.isMuted() && next > 0) {
        host.setMuted(false);
      }
      host.audio.playButtonLatchLock(1.08, 0.75);
      return true;
    }
    case SYSTEM_MENU_IDS.VOL_MUTE:
      host.setMuted(!host.isMuted());
      if (!host.isMuted()) {
        host.audio.playButtonLatchLock(1.0, 0.8);
      }
      return true;
    case SYSTEM_MENU_IDS.DISPLAY_TOGGLE:
      host.audio.playButtonLatchLock(1.0, 0.85);
      host.toggleFullscreen();
      return true;
    case SYSTEM_MENU_IDS.SWITCH_LANDER:
      if (host.getActiveProgramId() !== 'lander') {
        host.quickSwitchProgram('lander');
      }
      return true;
    case SYSTEM_MENU_IDS.SWITCH_PERIMETER:
      if (host.getActiveProgramId() !== 'perimeter') {
        host.quickSwitchProgram('perimeter');
      }
      return true;
    case SYSTEM_MENU_IDS.SWITCH_FLAK:
      if (host.getActiveProgramId() !== 'flak') {
        host.quickSwitchProgram('flak');
      }
      return true;
    case SYSTEM_MENU_IDS.SWITCH_TRENCH:
      if (host.getActiveProgramId() !== 'trench') {
        host.quickSwitchProgram('trench');
      }
      return true;
    case SYSTEM_MENU_IDS.EXIT_HUB:
      host.audio.playButtonLatchLock(0.88, 0.9);
      callbacks.onExitToHub();
      return true;
    default:
      if (callbacks.onExtraAction) {
        callbacks.onExtraAction(buttonId);
        return true;
      }
      return false;
  }
}

/**
 * Optional keyboard helper while `SystemMenuModal` is open:
 * handles `[1-4]` quick-switch, `[ESC]` resume, and `[M]` mute.
 */
export function handleSystemMenuKey(
  e: KeyboardEvent,
  host: HostEnvironment,
  callbacks: SystemMenuActionCallbacks
): boolean {
  if (e.code === 'Escape') {
    e.preventDefault();
    return handleSystemMenuAction(SYSTEM_MENU_IDS.RESUME, host, callbacks);
  }
  if (e.code === 'KeyM') {
    e.preventDefault();
    return handleSystemMenuAction(SYSTEM_MENU_IDS.VOL_MUTE, host, callbacks);
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === '1') {
      e.preventDefault();
      return handleSystemMenuAction(SYSTEM_MENU_IDS.SWITCH_LANDER, host, callbacks);
    }
    if (e.key === '2') {
      e.preventDefault();
      return handleSystemMenuAction(SYSTEM_MENU_IDS.SWITCH_PERIMETER, host, callbacks);
    }
    if (e.key === '3') {
      e.preventDefault();
      return handleSystemMenuAction(SYSTEM_MENU_IDS.SWITCH_FLAK, host, callbacks);
    }
    if (e.key === '4') {
      e.preventDefault();
      return handleSystemMenuAction(SYSTEM_MENU_IDS.SWITCH_TRENCH, host, callbacks);
    }
  }
  return false;
}
