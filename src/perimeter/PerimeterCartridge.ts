import type { Cartridge, CrtShaderFrameParams, HostEnvironment } from '../shell/Cartridge';
import type { Vec2, ViewportRect } from '../types';
import {
  PerimeterBlueprintRenderer,
  type BlueprintCamera,
} from './PerimeterBlueprintRenderer';
import { PerimeterHudRenderer, type PerimeterLayout } from './PerimeterHudRenderer';
import { PerimeterManifest } from './PerimeterManifest';
import { PerimeterSimulation } from './PerimeterSimulation';
import {
  PERIMETER_CONSTANTS,
  type ActiveCursorTool,
  type BuildToolId,
  type CommandAbilityId,
  type PerimeterLastSubmittedRun,
} from './types';

export class PerimeterCartridge implements Cartridge {
  public readonly id = 'perimeter';
  private host: HostEnvironment;
  private listenerAbort: AbortController | null = null;

  private sim: PerimeterSimulation;
  private manifest = new PerimeterManifest();
  private blueprintRenderer = new PerimeterBlueprintRenderer();
  private hudRenderer = new PerimeterHudRenderer();

  private viewportWidth = 1280;
  private viewportHeight = 800;
  private offsetX = 0;
  private offsetY = 0;
  private crtRect: ViewportRect = { x: 0, y: 0, width: 1280, height: 800 };

  private camera: BlueprintCamera = {
    centerX: PERIMETER_CONSTANTS.VIRTUAL_W * 0.5,
    centerY: PERIMETER_CONSTANTS.VIRTUAL_H * 0.5,
    zoom: 1.0,
  };

  private keysDown = new Set<string>();
  private activeTool: ActiveCursorTool = { kind: 'INSPECT' };
  private selectedTurretId: string | null = null;
  private selectedDoorId: string | null = null;
  private hoveredButtonId: string | null = null;

  private cursorCrtPx: Vec2 = { x: 640, y: 400 };
  private cursorInsideBlueprint = false;
  private cursorVirtual: Vec2 | null = null;

  // Mouse-drag cone aiming & middle/right-drag camera panning
  private dragBuildAnchor: { col: number; row: number; angle: number; shiftHeld: boolean } | null =
    null;
  private dragRotateTurretId: string | null = null;
  private lastBuildHoverTile: { col: number; row: number } | null = null;
  private previewAngleLockedByUser = false;
  private lastToolAutoExitMs = 0;
  private panDragState: {
    pointerId: number;
    startX: number;
    startY: number;
    camStartX: number;
    camStartY: number;
    moved: boolean;
    button: number;
  } | null = null;

  private osdMenuOpen = false;
  private manifestOpen = false;
  private callsignDraft = 'HICKS-01';
  private scoreSubmitted = false;
  private submittingScore = false;
  private submitResultBanner: string | null = null;
  private lastSubmittedRun: PerimeterLastSubmittedRun | null = null;
  private statusToast: string | null = null;
  private statusToastTimer = 0;
  private glitchIntensity = 0;

  constructor(host: HostEnvironment) {
    this.host = host;
    this.callsignDraft = this.manifest.getSavedCallsign();

    this.sim = new PerimeterSimulation({
      onMotionPing: (distM, maxM, pan) =>
        this.host.audio.playPerimeterMotionPing(distM, maxM, pan),
      onPulseBurst: (pan, oc, distNorm) =>
        this.host.audio.playPulseSentryBurst(pan, oc, 1.0, distNorm),
      onAmmoTick: (ratio) => this.host.audio.playAmmoCounterTick(ratio),
      onLowAmmoAlert: (pan, isEmpty) =>
        this.host.audio.playLowAmmoAlertChime(pan, isEmpty),
      onRearmSentry: (pan) => this.host.audio.playSentryRearmBeltLock(pan),
      onDryFire: (pan) => this.host.audio.playSentryDryFire(pan),
      onIncinerator: (pan, distNorm) =>
        this.host.audio.playIncineratorWhoosh(pan, distNorm),
      onAlienScreech: (screechCtx, kind, pan, distNorm) =>
        this.host.audio.playXenomorphScreech(screechCtx, kind, pan, distNorm),
      onCryoHiss: (pan) => this.host.audio.playCryoVentHiss(pan),
      onArcWeld: (pan) => this.host.audio.playArcWelderSeal(pan),
      onDoorBatter: (pan) => this.host.audio.playDoorBatterThud(pan),
      onRicochet: (pan) => this.host.audio.playArmorRicochet(pan),
      onAcidSizzle: (pan) => this.host.audio.playAcidCorrosionSizzle(pan),
      onAirlockPurge: (pan) => this.host.audio.playAirlockDecompression(pan),
      onBulkheadBreach: () => this.host.audio.playBulkheadBreachKlaxon(),
      onFlarePop: (pan) => this.host.audio.playStrobeFlareIgnite(pan),
      onOverclockSurge: (pan) => this.host.audio.playOverclockSurge(pan),
      onServoStep: (pan) => this.host.audio.playTurretServoStep(pan),
      onLogClick: () => this.host.audio.playAsmrScrollClack(0.55),
      onSyncGlitch: (intensity) => {
        this.glitchIntensity = Math.max(this.glitchIntensity, intensity);
      },
    });
  }

  public mount(): void {
    this.unmount();
    this.listenerAbort = new AbortController();
    const signal = this.listenerAbort.signal;

    const vp = this.host.getViewport();
    this.resize(vp.width, vp.height, vp.offsetX, vp.offsetY);

    this.keysDown.clear();
    this.activeTool = { kind: 'INSPECT' };
    this.selectedTurretId = null;
    this.selectedDoorId = null;
    this.hoveredButtonId = null;
    this.dragBuildAnchor = null;
    this.dragRotateTurretId = null;
    this.lastBuildHoverTile = null;
    this.previewAngleLockedByUser = false;
    this.lastToolAutoExitMs = 0;
    this.panDragState = null;
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    this.camera = {
      centerX: PERIMETER_CONSTANTS.VIRTUAL_W * 0.5,
      centerY: PERIMETER_CONSTANTS.VIRTUAL_H * 0.5,
      zoom: 1.0,
    };

    // Start fresh Sector 01 briefing on cartridge mount
    this.sim.resetRun('SECTOR_01', true);
    this.callsignDraft = this.manifest.getSavedCallsign();
    this.scoreSubmitted = false;
    this.submittingScore = false;
    this.submitResultBanner = null;

    this.bindListeners(signal);
  }

  public unmount(): void {
    if (this.listenerAbort) {
      this.listenerAbort.abort();
      this.listenerAbort = null;
    }
    this.keysDown.clear();
    this.dragBuildAnchor = null;
    this.dragRotateTurretId = null;
    this.lastBuildHoverTile = null;
    this.previewAngleLockedByUser = false;
    this.lastToolAutoExitMs = 0;
    this.panDragState = null;
    this.hoveredButtonId = null;
    this.osdMenuOpen = false;
    this.manifestOpen = false;
    document.body.style.cursor = 'default';
    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (mobileInput && document.activeElement === mobileInput) {
      mobileInput.blur();
    }
    this.host.audio.stopCartridgeLoops();
  }

  public resize(width: number, height: number, offsetX = 0, offsetY = 0): void {
    this.viewportWidth = Math.max(320, width);
    this.viewportHeight = Math.max(240, height);
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.crtRect = { x: 0, y: 0, width: this.viewportWidth, height: this.viewportHeight };
    this.clampCamera();
  }

  public setBackgroundPaused(paused: boolean): void {
    if (paused) {
      this.keysDown.clear();
      this.dragBuildAnchor = null;
      this.panDragState = null;
    }
  }

  private resetSubmissionState(): void {
    this.scoreSubmitted = false;
    this.submittingScore = false;
    this.submitResultBanner = null;
    this.lastSubmittedRun = null;
    this.callsignDraft = this.manifest.getSavedCallsign();
  }

  private async submitCurrentRunScore(): Promise<void> {
    if (this.scoreSubmitted || this.submittingScore) return;
    this.submittingScore = true;
    this.submitResultBanner = 'TRANSMITTING TELEMETRY TO MU-TH-UR...';
    const finalScore = Math.max(1, this.sim.score);
    const finalWaves = Math.max(1, this.sim.waveNumber);
    const finalKills = Math.max(0, this.sim.totalKills);
    const finalMode = this.sim.mode;
    const res = await this.manifest.submitScore({
      callsign: this.callsignDraft,
      waves: finalWaves,
      kills: finalKills,
      score: finalScore,
      mode: finalMode,
    });
    this.submittingScore = false;
    this.scoreSubmitted = true;
    this.callsignDraft = this.manifest.getSavedCallsign();
    this.lastSubmittedRun = {
      docId: res.docId,
      callsign: this.callsignDraft,
      score: finalScore,
      waves: finalWaves,
      kills: finalKills,
      mode: finalMode,
      rank: res.rank,
    };
    this.host.audio.playButtonLatchLock(1.05, 0.9);
    this.submitResultBanner = res.offlineFallback
      ? `LOGGED TO LOCAL ARCHIVE — RANK #${res.rank}`
      : `TRANSMISSION CONFIRMED // GLOBAL PERIMETER_SCORES RANK #${res.rank}!`;
    // Open Global Manifest immediately with the pulsing ★ JUST ADDED highlight (matching Lunar Lander)
    this.manifestOpen = true;
  }

  private focusMobileCallsignInput(): void {
    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (!mobileInput) return;
    mobileInput.value = this.callsignDraft;
    try {
      mobileInput.focus({ preventScroll: true });
    } catch {
      mobileInput.focus();
    }
  }

  private showToast(msg: string, duration = 2.2): void {
    this.statusToast = msg;
    this.statusToastTimer = duration;
  }

  private getCurrentLayout(): PerimeterLayout {
    return this.hudRenderer.computeLayout(this.viewportWidth, this.viewportHeight);
  }

  private clampCamera(): void {
    this.camera.zoom = Math.max(1.0, Math.min(2.5, this.camera.zoom));
    if (this.camera.zoom <= 1.01) {
      this.camera.centerX = PERIMETER_CONSTANTS.VIRTUAL_W * 0.5;
      this.camera.centerY = PERIMETER_CONSTANTS.VIRTUAL_H * 0.5;
      return;
    }
    const halfSpanX = (PERIMETER_CONSTANTS.VIRTUAL_W * 0.5) / this.camera.zoom;
    const halfSpanY = (PERIMETER_CONSTANTS.VIRTUAL_H * 0.5) / this.camera.zoom;
    const minX = Math.min(PERIMETER_CONSTANTS.VIRTUAL_W * 0.5, halfSpanX);
    const maxX = Math.max(
      PERIMETER_CONSTANTS.VIRTUAL_W * 0.5,
      PERIMETER_CONSTANTS.VIRTUAL_W - halfSpanX
    );
    const minY = Math.min(PERIMETER_CONSTANTS.VIRTUAL_H * 0.5, halfSpanY);
    const maxY = Math.max(
      PERIMETER_CONSTANTS.VIRTUAL_H * 0.5,
      PERIMETER_CONSTANTS.VIRTUAL_H - halfSpanY
    );
    this.camera.centerX = Math.max(minX, Math.min(maxX, this.camera.centerX));
    this.camera.centerY = Math.max(minY, Math.min(maxY, this.camera.centerY));
  }

  private bindListeners(signal: AbortSignal): void {
    window.addEventListener(
      'contextmenu',
      (e) => {
        e.preventDefault();
      },
      { signal }
    );

    window.addEventListener(
      'blur',
      () => {
        this.keysDown.clear();
        this.dragBuildAnchor = null;
        this.dragRotateTurretId = null;
        this.panDragState = null;
      },
      { signal }
    );

    window.addEventListener(
      'keyup',
      (e) => {
        this.keysDown.delete(e.code);
      },
      { signal }
    );

    window.addEventListener(
      'keydown',
      (e) => {
        if (
          ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)
        ) {
          e.preventDefault();
        }
        void this.host.audio.unlock();
        this.keysDown.add(e.code);
        this.handleKeyDown(e);
      },
      { signal }
    );

    const mobileInput = document.getElementById('mobile-callsign-input') as HTMLInputElement | null;
    if (mobileInput) {
      mobileInput.addEventListener(
        'input',
        () => {
          if (this.sim.phase !== 'CALLSIGN_ENTRY' || this.scoreSubmitted) return;
          this.callsignDraft = mobileInput.value.toUpperCase().slice(0, 16);
          mobileInput.value = this.callsignDraft;
        },
        { signal }
      );
      mobileInput.addEventListener(
        'keydown',
        (ev) => {
          if (ev.key === 'Enter' && this.sim.phase === 'CALLSIGN_ENTRY' && !this.scoreSubmitted) {
            ev.preventDefault();
            mobileInput.blur();
            void this.submitCurrentRunScore();
          }
        },
        { signal }
      );
    }

    window.addEventListener(
      'pointermove',
      (e) => {
        const mapped = this.host.webglCrt.mapClientToCrtUv(
          e.clientX - this.offsetX,
          e.clientY - this.offsetY,
          this.crtRect,
          this.host.getCrtIntensity()
        );
        const cx = mapped.u * this.crtRect.width;
        const cy = mapped.v * this.crtRect.height;
        this.cursorCrtPx = { x: cx, y: cy };

        const layout = this.getCurrentLayout();
        const bpVp = layout.blueprintViewport;

        // Handle Middle-Mouse or Right-Mouse Panning
        if (this.panDragState && e.pointerId === this.panDragState.pointerId) {
          const dxPx = cx - this.panDragState.startX;
          const dyPx = cy - this.panDragState.startY;
          if (Math.hypot(dxPx, dyPx) > 5) {
            this.panDragState.moved = true;
          }
          if (this.panDragState.moved && this.camera.zoom > 1.0) {
            const tf = this.blueprintRenderer.computeTransform(bpVp, this.camera);
            this.camera.centerX = this.panDragState.camStartX - dxPx / tf.scale;
            this.camera.centerY = this.panDragState.camStartY - dyPx / tf.scale;
            this.clampCamera();
          }
          return;
        }

        this.hoveredButtonId = mapped.inside ? this.hitTestHudButtons(cx, cy) : null;

        this.cursorInsideBlueprint =
          mapped.inside &&
          !this.osdMenuOpen &&
          !this.manifestOpen &&
          this.sim.phase !== 'BRIEFING' &&
          this.sim.phase !== 'CALLSIGN_ENTRY' &&
          cx >= bpVp.x &&
          cx <= bpVp.x + bpVp.width &&
          cy >= bpVp.y &&
          cy <= bpVp.y + bpVp.height;

        if (this.cursorInsideBlueprint || this.dragBuildAnchor || this.dragRotateTurretId) {
          this.cursorVirtual = this.blueprintRenderer.screenToVirtual(bpVp, this.camera, cx, cy);
        } else {
          this.cursorVirtual = null;
        }

        // Update drag-to-aim angle during hardware placement!
        if (this.dragBuildAnchor && this.cursorVirtual) {
          const ts = this.sim.blueprint.tileSize;
          const ax = this.dragBuildAnchor.col * ts + ts * 0.5;
          const ay = this.dragBuildAnchor.row * ts + ts * 0.5;
          if (Math.hypot(this.cursorVirtual.x - ax, this.cursorVirtual.y - ay) > 12) {
            this.dragBuildAnchor.angle = Math.atan2(
              this.cursorVirtual.y - ay,
              this.cursorVirtual.x - ax
            );
          }
        }

        // Update drag-to-aim angle on existing selected turret!
        if (this.dragRotateTurretId && this.cursorVirtual) {
          const t = this.sim.turrets.find((u) => u.id === this.dragRotateTurretId);
          if (t && Math.hypot(this.cursorVirtual.x - t.pos.x, this.cursorVirtual.y - t.pos.y) > 16) {
            this.sim.setTurretTargetAngle(
              t.id,
              Math.atan2(this.cursorVirtual.y - t.pos.y, this.cursorVirtual.x - t.pos.x)
            );
          }
        }

        // Recompute optimal corridor aim angle whenever hovering a new hardpoint!
        // (Fixes carryover previewAngle bug while respecting manual [R] rotation on the current tile.)
        if (
          !this.dragBuildAnchor &&
          this.activeTool.kind === 'BUILD' &&
          this.cursorVirtual &&
          this.activeTool.buildId !== 'ARC_WELDER' &&
          this.activeTool.buildId !== 'CRYO_VALVE'
        ) {
          const col = Math.floor(this.cursorVirtual.x / this.sim.blueprint.tileSize);
          const row = Math.floor(this.cursorVirtual.y / this.sim.blueprint.tileSize);
          const movedTile =
            !this.lastBuildHoverTile ||
            this.lastBuildHoverTile.col !== col ||
            this.lastBuildHoverTile.row !== row;
          if (movedTile) {
            this.lastBuildHoverTile = { col, row };
            this.previewAngleLockedByUser = false;
            if (this.sim.canPlaceHardwareAt(this.activeTool.buildId, col, row).ok) {
              this.activeTool.previewAngle = this.sim.computeDefaultAimAngle(col, row);
            }
          }
        }

        if (this.hoveredButtonId) {
          document.body.style.cursor = 'pointer';
        } else if (this.cursorInsideBlueprint && this.activeTool.kind !== 'INSPECT') {
          document.body.style.cursor = 'crosshair';
        } else {
          document.body.style.cursor = 'default';
        }
      },
      { signal }
    );

    window.addEventListener(
      'pointerdown',
      (e) => {
        void this.host.audio.unlock();
        const mapped = this.host.webglCrt.mapClientToCrtUv(
          e.clientX - this.offsetX,
          e.clientY - this.offsetY,
          this.crtRect,
          this.host.getCrtIntensity()
        );
        if (!mapped.inside) return;

        const cx = mapped.u * this.crtRect.width;
        const cy = mapped.v * this.crtRect.height;

        // Middle-click or Right-click inside blueprint starts camera pan (or cancels active tool on quick right-click)
        if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) {
          e.preventDefault();
          this.panDragState = {
            pointerId: e.pointerId,
            startX: cx,
            startY: cy,
            camStartX: this.camera.centerX,
            camStartY: this.camera.centerY,
            moved: false,
            button: e.button,
          };
          return;
        }

        if (e.pointerType === 'mouse' && e.button !== 0) return;

        // 1. Check HUD / Modal Buttons First
        const btn = this.hitTestHudButtons(cx, cy);
        if (btn) {
          if (btn !== 'insp-rearm' && !btn.startsWith('rack-rearm-')) {
            this.host.audio.playButtonLatchLock(0.95, 0.92);
          }
          this.handleHudButton(btn);
          return;
        }

        if (
          this.osdMenuOpen ||
          this.manifestOpen ||
          this.sim.phase === 'BRIEFING' ||
          this.sim.phase === 'CALLSIGN_ENTRY' ||
          this.sim.phase === 'SECTOR_VICTORY' ||
          this.sim.phase === 'CORE_BREACHED'
        ) {
          return;
        }

        // 2. Click inside Central CAD Blueprint Viewport
        const layout = this.getCurrentLayout();
        const bpVp = layout.blueprintViewport;
        if (
          cx < bpVp.x ||
          cx > bpVp.x + bpVp.width ||
          cy < bpVp.y ||
          cy > bpVp.y + bpVp.height
        ) {
          return;
        }

        const virt = this.blueprintRenderer.screenToVirtual(bpVp, this.camera, cx, cy);
        this.cursorVirtual = virt;
        const ts = this.sim.blueprint.tileSize;
        const col = Math.floor(virt.x / ts);
        const row = Math.floor(virt.y / ts);

        // Rotate-Turret Aiming Click
        if (this.activeTool.kind === 'ROTATE_TURRET') {
          const rotId = this.activeTool.turretId;
          const t = this.sim.turrets.find((u) => u.id === rotId);
          if (t) {
            const ang = Math.atan2(virt.y - t.pos.y, virt.x - t.pos.x);
            this.sim.setTurretTargetAngle(t.id, ang);
            this.showToast(`${t.callsign} SERVO SLEWING TO ${Math.round(((ang * 180) / Math.PI + 360) % 360)}°`);
          }
          this.activeTool = { kind: 'INSPECT' };
          this.lastToolAutoExitMs = performance.now();
          return;
        }

        // Active Command Ability Deployment Click
        if (this.activeTool.kind === 'ABILITY') {
          const res = this.sim.triggerCommandAbility(this.activeTool.abilityId, virt);
          if (res.ok) {
            this.activeTool = { kind: 'INSPECT' };
            this.lastToolAutoExitMs = performance.now();
            this.showToast(res.msg);
          } else {
            this.host.audio.playMutedAvionicsIndicatorBeep(false);
            this.showToast(res.msg);
          }
          return;
        }

        // Hardware Build Deployment (with Mouse-Drag Cone Aiming!)
        if (this.activeTool.kind === 'BUILD') {
          const bId = this.activeTool.buildId;
          const check = this.sim.canPlaceHardwareAt(bId, col, row);
          if (!check.ok) {
            // Allow clicking an existing turret/door to inspect if clicked directly on it
            const existingT = this.sim.findTurretAt(virt, 28);
            if (existingT) {
              this.selectedTurretId = existingT.id;
              this.selectedDoorId = null;
              this.activeTool = { kind: 'INSPECT' };
              this.lastToolAutoExitMs = performance.now();
              this.host.audio.playSfx('ui_keyclick');
              return;
            }
            this.host.audio.playMutedAvionicsIndicatorBeep(false);
            this.showToast(check.reason ?? 'INVALID HARDPOINT');
            return;
          }

          if (bId === 'ARC_WELDER' || bId === 'CRYO_VALVE') {
            const deployed = this.sim.deployHardware(bId, col, row, 0);
            if (deployed.ok) {
              if (deployed.placedTurret) {
                const placePan = Math.max(
                  -0.82,
                  Math.min(0.82, (deployed.placedTurret.pos.x / PERIMETER_CONSTANTS.VIRTUAL_W - 0.5) * 1.5)
                );
                this.host.audio.playWeaponDeployEmplace(deployed.placedTurret.kind, placePan);
                this.selectedTurretId = deployed.placedTurret.id;
                this.selectedDoorId = null;
              } else if (deployed.weldedDoor) {
                this.selectedDoorId = deployed.weldedDoor.def.id;
                this.selectedTurretId = null;
                this.showToast(
                  this.sim.phase === 'WAVE_ACTIVE'
                    ? `${deployed.weldedDoor.def.id} ARC-WELDING (2.0S)...`
                    : `${deployed.weldedDoor.def.id} SEALED`
                );
              }
              if (!e.shiftKey) {
                this.activeTool = { kind: 'INSPECT' };
                this.lastToolAutoExitMs = performance.now();
              }
            }
            return;
          }

          // Directional Hardware (UA 571-C, M240, M314): Begin drag-to-aim anchor!
          const anchorPan = Math.max(
            -0.82,
            Math.min(0.82, ((col * ts + ts * 0.5) / PERIMETER_CONSTANTS.VIRTUAL_W - 0.5) * 1.5)
          );
          this.host.audio.playTurretTripodTouchdown(anchorPan);
          const initAng = this.previewAngleLockedByUser
            ? this.activeTool.previewAngle
            : this.sim.computeDefaultAimAngle(col, row);
          this.dragBuildAnchor = {
            col,
            row,
            angle: initAng,
            shiftHeld: e.shiftKey,
          };
          return;
        }

        // Default INSPECT Mode: Select Placed Turret or Blast Door
        // (Zero accidental rotation on normal clicks — use [R], Inspector button, or Shift+Drag to aim!)
        const hitTurret = this.sim.findTurretAt(virt, 34);
        if (hitTurret) {
          this.selectedTurretId = hitTurret.id;
          this.selectedDoorId = null;
          if (e.shiftKey && hitTurret.kind !== 'CRYO_VALVE') {
            this.dragRotateTurretId = hitTurret.id;
          }
          this.host.audio.playSfx('ui_keyclick');
          return;
        }

        const hitDoor = this.sim.findDoorNearPoint(virt, 48);
        if (hitDoor) {
          this.selectedDoorId = hitDoor.def.id;
          this.selectedTurretId = null;
          this.host.audio.playSfx('ui_keyclick');
          return;
        }

        this.selectedTurretId = null;
        this.selectedDoorId = null;
      },
      { signal }
    );

    const handlePointerEnd = (e: PointerEvent) => {
      if (this.panDragState && e.pointerId === this.panDragState.pointerId) {
        const wasQuickRightClick =
          this.panDragState.button === 2 && !this.panDragState.moved;
        this.panDragState = null;
        if (wasQuickRightClick && this.activeTool.kind !== 'INSPECT') {
          this.activeTool = { kind: 'INSPECT' };
          this.statusToast = null;
          this.statusToastTimer = 0;
          this.host.audio.playSfx('ui_keyclick', { pitch: 0.85 });
        }
        return;
      }

      if (this.dragRotateTurretId) {
        this.dragRotateTurretId = null;
      }

      if (this.dragBuildAnchor && this.activeTool.kind === 'BUILD') {
        const anchor = this.dragBuildAnchor;
        this.dragBuildAnchor = null;
        const res = this.sim.deployHardware(
          this.activeTool.buildId,
          anchor.col,
          anchor.row,
          anchor.angle
        );
        if (res.ok && res.placedTurret) {
          const placePan = Math.max(
            -0.82,
            Math.min(0.82, (res.placedTurret.pos.x / PERIMETER_CONSTANTS.VIRTUAL_W - 0.5) * 1.5)
          );
          this.host.audio.playWeaponDeployEmplace(res.placedTurret.kind, placePan);
          this.selectedTurretId = res.placedTurret.id;
          this.selectedDoorId = null;
          if (!anchor.shiftHeld) {
            this.activeTool = { kind: 'INSPECT' };
            this.lastToolAutoExitMs = performance.now();
          }
          this.lastBuildHoverTile = null;
          this.previewAngleLockedByUser = false;
        } else if (res.reason) {
          this.showToast(res.reason);
        }
      }
    };

    window.addEventListener('pointerup', handlePointerEnd, { signal });
    window.addEventListener('pointercancel', handlePointerEnd, { signal });

    window.addEventListener(
      'wheel',
      (e) => {
        if (this.osdMenuOpen || this.manifestOpen || this.sim.phase === 'BRIEFING') return;
        const layout = this.getCurrentLayout();
        const bpVp = layout.blueprintViewport;
        if (
          this.cursorCrtPx.x >= bpVp.x &&
          this.cursorCrtPx.x <= bpVp.x + bpVp.width &&
          this.cursorCrtPx.y >= bpVp.y &&
          this.cursorCrtPx.y <= bpVp.y + bpVp.height
        ) {
          e.preventDefault();
          const beforeVirt = this.blueprintRenderer.screenToVirtual(
            bpVp,
            this.camera,
            this.cursorCrtPx.x,
            this.cursorCrtPx.y
          );
          const delta = e.deltaY < 0 ? 0.18 : -0.18;
          this.camera.zoom = Math.max(1.0, Math.min(2.5, this.camera.zoom + delta));
          const afterVirt = this.blueprintRenderer.screenToVirtual(
            bpVp,
            this.camera,
            this.cursorCrtPx.x,
            this.cursorCrtPx.y
          );
          this.camera.centerX += beforeVirt.x - afterVirt.x;
          this.camera.centerY += beforeVirt.y - afterVirt.y;
          this.clampCamera();
        }
      },
      { passive: false, signal }
    );
  }

  private hitTestHudButtons(cx: number, cy: number): string | null {
    for (let i = this.hudRenderer.buttons.length - 1; i >= 0; i--) {
      const b = this.hudRenderer.buttons[i];
      if (
        cx >= b.rect.x &&
        cx <= b.rect.x + b.rect.width &&
        cy >= b.rect.y &&
        cy <= b.rect.y + b.rect.height
      ) {
        return b.id;
      }
    }
    return null;
  }

  private selectBuildTool(buildId: Exclude<BuildToolId, 'NONE'>): void {
    this.lastBuildHoverTile = null;
    this.previewAngleLockedByUser = false;
    if (this.activeTool.kind === 'BUILD' && this.activeTool.buildId === buildId) {
      this.activeTool = { kind: 'INSPECT' };
      return;
    }
    this.activeTool = { kind: 'BUILD', buildId, previewAngle: 0 };
  }

  private armCommandAbility(abilityId: CommandAbilityId): void {
    if (this.activeTool.kind === 'ABILITY' && this.activeTool.abilityId === abilityId) {
      this.activeTool = { kind: 'INSPECT' };
      return;
    }
    if (abilityId === 'FLARE' && this.sim.flareCooldown > 0) {
      this.showToast(`M40 STROBE FLARE RECHARGING (${this.sim.flareCooldown.toFixed(1)}S)`);
      return;
    }
    if (abilityId === 'OVERCLOCK' && this.sim.overclockCooldown > 0) {
      this.showToast(`POWER BUS COOLING (${this.sim.overclockCooldown.toFixed(1)}S)`);
      return;
    }
    if (abilityId === 'PURGE' && !this.sim.purgeAvailableThisWave) {
      this.showToast('AIRLOCK VENT PURGE EXPENDED THIS WAVE (1X/WAVE)');
      return;
    }
    this.activeTool = { kind: 'ABILITY', abilityId };
    this.showToast(
      abilityId === 'FLARE'
        ? 'CLICK ANY DARK CORRIDOR TO DEPLOY M40 STROBE FLARE'
        : abilityId === 'OVERCLOCK'
          ? 'CLICK SECTOR TO OVERCLOCK TURRETS (2X ROF FOR 8S)'
          : 'CLICK DESIGNATED AIRLOCK CHAMBER [W-01 / E-02 / S-03] TO PURGE'
    );
  }

  private handleHudButton(id: string): void {
    if (id.startsWith('build-')) {
      const bId = id.replace('build-', '') as Exclude<BuildToolId, 'NONE'>;
      this.selectBuildTool(bId);
      return;
    }
    if (id.startsWith('ability-')) {
      const abId = id.replace('ability-', '') as CommandAbilityId;
      this.armCommandAbility(abId);
      return;
    }
    if (id.startsWith('rack-rearm-')) {
      const tId = id.replace('rack-rearm-', '');
      this.selectedTurretId = tId;
      this.selectedDoorId = null;
      this.activeTool = { kind: 'INSPECT' };
      const r = this.sim.rearmTurret(tId);
      this.showToast(r.msg);
      return;
    }
    if (id.startsWith('rack-select-')) {
      const tId = id.replace('rack-select-', '');
      this.selectedTurretId = tId;
      this.selectedDoorId = null;
      this.activeTool = { kind: 'INSPECT' };
      return;
    }

    switch (id) {
      case 'mode-sec01':
        this.resetSubmissionState();
        this.sim.resetRun('SECTOR_01', true);
        break;
      case 'mode-endless':
        this.resetSubmissionState();
        this.sim.resetRun('ENDLESS_SIEGE', true);
        break;
      case 'briefing-engage':
        this.sim.phase = 'TACTICAL_PREP';
        break;
      case 'wave-launch':
        this.sim.launchNextWave();
        break;
      case 'perim-pause-toggle':
        if (this.sim.phase === 'WAVE_ACTIVE' || this.sim.phase === 'TACTICAL_PREP') {
          this.sim.tacticalPaused = !this.sim.tacticalPaused;
        }
        break;
      case 'toggle-2x-speed':
        this.sim.fastForward2x = !this.sim.fastForward2x;
        this.showToast(this.sim.fastForward2x ? 'WAVE INTERCEPT: 2X SPEED' : 'NORMAL 1X SPEED');
        break;
      case 'insp-rearm':
        if (this.selectedTurretId) {
          const r = this.sim.rearmTurret(this.selectedTurretId);
          this.showToast(r.msg);
        }
        break;
      case 'insp-rotate':
        if (this.selectedTurretId) {
          if (
            this.activeTool.kind === 'ROTATE_TURRET' &&
            this.activeTool.turretId === this.selectedTurretId
          ) {
            this.activeTool = { kind: 'INSPECT' };
          } else {
            this.activeTool = { kind: 'ROTATE_TURRET', turretId: this.selectedTurretId };
            this.showToast('CLICK CORRIDOR DIRECTION TO AIM TURRET CONE');
          }
        }
        break;
      case 'insp-power':
        if (this.selectedTurretId) {
          const r = this.sim.toggleTurretPower(this.selectedTurretId);
          this.showToast(r.msg);
        }
        break;
      case 'insp-upgrade':
        if (this.selectedTurretId) {
          const r = this.sim.upgradeTurret(this.selectedTurretId);
          this.showToast(r.msg);
        }
        break;
      case 'insp-scrap':
        if (this.selectedTurretId) {
          const r = this.sim.scrapTurret(this.selectedTurretId);
          this.selectedTurretId = null;
          this.showToast(r.msg);
        }
        break;
      case 'door-weld':
      case 'door-unseal':
        if (this.selectedDoorId) {
          const r = this.sim.toggleDoorSeal(this.selectedDoorId);
          this.showToast(r.msg);
        }
        break;
      case 'door-repair':
        if (this.selectedDoorId) {
          const r = this.sim.repairDoorSeal(this.selectedDoorId);
          this.showToast(r.msg);
        }
        break;
      case 'end-to-callsign':
        this.resetSubmissionState();
        this.sim.phase = 'CALLSIGN_ENTRY';
        break;
      case 'perim-callsign-focus':
        this.focusMobileCallsignInput();
        break;
      case 'perim-save-callsign':
        void this.submitCurrentRunScore();
        break;
      case 'perim-skip-callsign':
        this.resetSubmissionState();
        this.sim.resetRun(this.sim.mode, true);
        break;
      case 'perim-manifest':
        this.osdMenuOpen = false;
        this.manifestOpen = !this.manifestOpen;
        break;
      case 'perim-new-run':
        this.manifestOpen = false;
        this.resetSubmissionState();
        this.sim.resetRun(this.sim.mode, true);
        break;
      case 'perim-osd':
        this.manifestOpen = false;
        this.osdMenuOpen = !this.osdMenuOpen;
        break;
      case 'perim-close-modal':
        this.osdMenuOpen = false;
        this.manifestOpen = false;
        break;
      case 'perim-mute':
        this.host.setMuted(!this.host.isMuted());
        break;
      case 'perim-fullscreen':
        this.host.toggleFullscreen();
        break;
      case 'perim-restart-sec01':
        this.osdMenuOpen = false;
        this.resetSubmissionState();
        this.sim.resetRun('SECTOR_01', false);
        break;
      case 'perim-restart-endless':
        this.osdMenuOpen = false;
        this.resetSubmissionState();
        this.sim.resetRun('ENDLESS_SIEGE', false);
        break;
      case 'perim-exit-os':
        this.osdMenuOpen = false;
        this.manifestOpen = false;
        this.host.exitToMuthurOs("TERMINATED PROGRAM 02 // HADLEY'S PERIMETER TACTICAL NET.");
        break;
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Callsign Entry Keyboard Input (1-16 chars, no profanity filter)
    if (this.sim.phase === 'CALLSIGN_ENTRY' && !this.osdMenuOpen && !this.manifestOpen) {
      if (e.code === 'Escape') {
        this.host.audio.playButtonLatchLock();
        this.handleHudButton('perim-skip-callsign');
        return;
      }
      if (!this.scoreSubmitted) {
        if (e.code === 'Backspace') {
          this.callsignDraft = this.callsignDraft.slice(0, -1);
          this.host.audio.playSfx('ui_keyclick', { pitch: 0.9 });
        } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          this.host.audio.playSfx('keypress_return', { volume: 0.9 });
          void this.submitCurrentRunScore();
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (this.callsignDraft.length < 16) {
            this.callsignDraft += e.key.toUpperCase();
            this.host.audio.playSfx('ui_keyclick', { pitch: 1.05 });
          }
        }
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        this.host.audio.playButtonLatchLock();
        this.handleHudButton('perim-new-run');
      }
      return;
    }

    if (e.code === 'Tab' && !e.repeat) {
      this.host.audio.playButtonLatchLock(0.95, 0.9);
      this.manifestOpen = false;
      this.osdMenuOpen = !this.osdMenuOpen;
      return;
    }

    if (this.osdMenuOpen || this.manifestOpen) {
      if (e.code === 'Escape') {
        this.host.audio.playButtonLatchLock(0.92, 0.9);
        this.osdMenuOpen = false;
        this.manifestOpen = false;
      }
      return;
    }

    if (this.sim.phase === 'BRIEFING') {
      if (e.code === 'Enter' || e.code === 'Space') {
        this.host.audio.playButtonLatchLock();
        this.sim.phase = 'TACTICAL_PREP';
      } else if (e.code === 'Escape') {
        this.host.audio.playButtonLatchLock();
        this.handleHudButton('perim-exit-os');
      }
      return;
    }

    if (this.sim.phase === 'SECTOR_VICTORY' || this.sim.phase === 'CORE_BREACHED') {
      if (e.code === 'Enter' || e.code === 'Space') {
        this.host.audio.playButtonLatchLock();
        this.resetSubmissionState();
        this.sim.phase = 'CALLSIGN_ENTRY';
      } else if (e.code === 'Escape') {
        this.osdMenuOpen = true;
      }
      return;
    }

    // Active Tactical Gameplay / Prep Controls
    if (e.code === 'Escape') {
      if (this.activeTool.kind !== 'INSPECT') {
        this.activeTool = { kind: 'INSPECT' };
        this.statusToast = null;
        this.statusToastTimer = 0;
        this.host.audio.playSfx('ui_keyclick', { pitch: 0.85 });
      } else if (performance.now() - this.lastToolAutoExitMs < 550) {
        // Absorb reflexive ESC right after auto-tool-exit instead of yanking into OSD menu!
        this.host.audio.playSfx('ui_keyclick', { pitch: 0.8 });
      } else if (this.selectedTurretId || this.selectedDoorId) {
        this.selectedTurretId = null;
        this.selectedDoorId = null;
        this.host.audio.playSfx('ui_keyclick', { pitch: 0.85 });
      } else {
        this.host.audio.playButtonLatchLock(0.92, 0.9);
        this.osdMenuOpen = true;
      }
      return;
    }

    if (e.code === 'Space' && !e.repeat) {
      this.sim.tacticalPaused = !this.sim.tacticalPaused;
      this.host.audio.playButtonLatchLock(this.sim.tacticalPaused ? 0.88 : 1.04, 0.85);
      return;
    }

    if (e.code === 'Enter' && !e.repeat && this.sim.phase === 'TACTICAL_PREP') {
      this.host.audio.playButtonLatchLock();
      this.sim.launchNextWave();
      return;
    }

    // Command Ability Hotkeys: [F], [O], [V] (plus Shift+1/2/3 or Alt+1/2/3)
    if (e.code === 'KeyF' || ((e.shiftKey || e.altKey) && e.code === 'Digit1')) {
      this.host.audio.playSfx('ui_keyclick');
      this.armCommandAbility('FLARE');
      return;
    }
    if (e.code === 'KeyO' || ((e.shiftKey || e.altKey) && e.code === 'Digit2')) {
      this.host.audio.playSfx('ui_keyclick');
      this.armCommandAbility('OVERCLOCK');
      return;
    }
    if (e.code === 'KeyV' || ((e.shiftKey || e.altKey) && e.code === 'Digit3')) {
      this.host.audio.playSfx('ui_keyclick');
      this.armCommandAbility('PURGE');
      return;
    }

    // Hardware Build Hotkeys [1-5]
    if (e.code === 'Digit1') {
      this.host.audio.playSfx('ui_keyclick');
      this.selectBuildTool('SENTRY_PULSE');
    } else if (e.code === 'Digit2') {
      this.host.audio.playSfx('ui_keyclick');
      this.selectBuildTool('INCINERATOR');
    } else if (e.code === 'Digit3') {
      this.host.audio.playSfx('ui_keyclick');
      this.selectBuildTool('CRYO_VALVE');
    } else if (e.code === 'Digit4') {
      this.host.audio.playSfx('ui_keyclick');
      this.selectBuildTool('MOTION_RELAY');
    } else if (e.code === 'Digit5') {
      this.host.audio.playSfx('ui_keyclick');
      this.selectBuildTool('ARC_WELDER');
    } else if (e.code === 'KeyR' && !e.repeat) {
      const isDirectionalBuild =
        this.activeTool.kind === 'BUILD' &&
        this.activeTool.buildId !== 'ARC_WELDER' &&
        this.activeTool.buildId !== 'CRYO_VALVE';
      if (isDirectionalBuild && this.activeTool.kind === 'BUILD') {
        this.activeTool.previewAngle += Math.PI / 4;
        this.previewAngleLockedByUser = true;
        if (this.dragBuildAnchor) {
          this.dragBuildAnchor.angle += Math.PI / 4;
        }
        this.host.audio.playTurretServoStep(0);
      } else if (this.selectedTurretId) {
        // Cancel non-directional tools (e.g. Arc-Welder) cleanly so [R] rotates selected turret!
        if (
          this.activeTool.kind === 'ROTATE_TURRET' &&
          this.activeTool.turretId === this.selectedTurretId
        ) {
          const t = this.sim.turrets.find((u) => u.id === this.selectedTurretId);
          if (t) {
            this.sim.setTurretTargetAngle(t.id, t.targetAngle + Math.PI / 4);
          }
          this.activeTool = { kind: 'INSPECT' };
          this.lastToolAutoExitMs = performance.now();
        } else {
          this.handleHudButton('insp-rotate');
        }
      }
    } else if (e.code === 'KeyE' && !e.repeat && this.selectedTurretId) {
      this.host.audio.playButtonLatchLock();
      this.handleHudButton('insp-rearm');
    } else if (e.code === 'KeyP' && !e.repeat && this.selectedTurretId) {
      this.host.audio.playButtonLatchLock();
      this.handleHudButton('insp-power');
    } else if (e.code === 'KeyU' && !e.repeat && this.selectedTurretId) {
      this.host.audio.playButtonLatchLock();
      this.handleHudButton('insp-upgrade');
    } else if (
      (e.code === 'Delete' || e.code === 'Backspace') &&
      !e.repeat &&
      this.selectedTurretId
    ) {
      this.host.audio.playButtonLatchLock();
      this.handleHudButton('insp-scrap');
    }
  }

  public updateAndRender(
    dt: number,
    ctx: CanvasRenderingContext2D,
    totalTimeSec: number
  ): CrtShaderFrameParams {
    const clampedDt = Math.min(0.1, Math.max(0, dt));

    if (this.statusToastTimer > 0) {
      this.statusToastTimer = Math.max(0, this.statusToastTimer - clampedDt);
      if (this.statusToastTimer <= 0) {
        this.statusToast = null;
      }
    }
    if (this.glitchIntensity > 0) {
      this.glitchIntensity = Math.max(0, this.glitchIntensity - clampedDt * 1.6);
    }

    // Smooth WASD / Arrow Camera Panning when zoomed in
    if (
      !this.osdMenuOpen &&
      !this.manifestOpen &&
      this.sim.phase !== 'CALLSIGN_ENTRY' &&
      this.camera.zoom > 1.0
    ) {
      let panX = 0;
      let panY = 0;
      if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) panX -= 1;
      if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) panX += 1;
      if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) panY -= 1;
      if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) panY += 1;
      if (panX !== 0 || panY !== 0) {
        const spd = 620 / this.camera.zoom;
        this.camera.centerX += panX * spd * clampedDt;
        this.camera.centerY += panY * spd * clampedDt;
        this.clampCamera();
      }
    }

    // Step Tactical Simulation (freezes automatically if OSD/Manifest modal is open)
    if (!this.osdMenuOpen && !this.manifestOpen) {
      this.sim.step(clampedDt);
      const napalmState = this.sim.getActiveNapalmAudioState();
      this.host.audio.updatePerimeterNapalmBed(napalmState.intensity, napalmState.pan, clampedDt);
    } else {
      this.host.audio.updatePerimeterNapalmBed(0, 0, clampedDt);
    }

    const layout = this.getCurrentLayout();

    // Clear full offscreen frame
    ctx.fillStyle = '#030805';
    ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight);

    // 1. Render Central 1920x1080 Colony CAD Blueprint
    this.blueprintRenderer.render(ctx, {
      sim: this.sim,
      viewport: layout.blueprintViewport,
      camera: this.camera,
      timeSec: totalTimeSec,
      activeTool: this.activeTool,
      cursorVirtual: this.cursorVirtual,
      selectedTurretId: this.selectedTurretId,
      selectedDoorId: this.selectedDoorId,
      dragBuildAnchor: this.dragBuildAnchor,
    });

    // 2. Render Nostromo Left/Right/Top/Bottom Instrumentation & Modals
    this.hudRenderer.render(
      ctx,
      {
        width: this.viewportWidth,
        height: this.viewportHeight,
        timeSec: totalTimeSec,
        sim: this.sim,
        manifest: this.manifest,
        activeTool: this.activeTool,
        selectedTurretId: this.selectedTurretId,
        selectedDoorId: this.selectedDoorId,
        hoveredButtonId: this.hoveredButtonId,
        audioMuted: this.host.isMuted(),
        isFullscreen: this.host.getViewport().isFullscreen,
        osdMenuOpen: this.osdMenuOpen,
        manifestOpen: this.manifestOpen,
        callsignDraft: this.callsignDraft,
        scoreSubmitted: this.scoreSubmitted,
        submittingScore: this.submittingScore,
        submitResultBanner: this.submitResultBanner,
        lastSubmittedRun: this.lastSubmittedRun,
        statusToast: this.statusToast,
      },
      layout
    );

    const overdriveAmt =
      this.sim.blackoutTimer > 0
        ? 0.08
        : this.sim.overloadTimer > 1.2
          ? 0.45
          : this.sim.activeOverclockSurgeTimer > 0
            ? 0.36
            : this.sim.sealLostFlashTimer > 0
              ? 0.6
              : 0;

    return {
      interference:
        this.sim.sealLostFlashTimer > 0
          ? 0.28
          : this.sim.blackoutTimer > 0
            ? 0.14
            : this.sim.overloadTimer > 0.6
              ? 0.065
              : 0.012,
      glitch: this.glitchIntensity,
      overdrive: overdriveAmt,
      tubeTurnOn: 0,
      chromaScale: 0.28, // Keep sidebar kW/Scrap/Ammo numerals razor-sharp right to CRT edges!
    };
  }
}
