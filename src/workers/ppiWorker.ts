/**
 * ============================================================================
 * AERIS-10 Command & Control (C2) Tactical Console
 * ────────────────────────────────────────────────────────────────────────────
 * SYSTEM COMPONENT      : 2D Radar Canvas Web Worker Renderer (ppiWorker.ts)
 * ARCHITECT & DEVELOPER : Doğukan Aslan
 * LICENSE               : Proprietary / Community Shared Release
 * VERSION               : 1.0.0 (Nexus Active Deployment)
 * ============================================================================
 */

/**
 * PPI Worker — off-main-thread radar canvas renderer.
 * =============================================================================
 * Layer order (bottom → top, matches Section 4.3 of the directive):
 *
 *   1. Background radial gradient
 *   2. Range rings
 *   3. Azimuth tick lines (every 30°)
 *   4. Sweep glow segment (60° behind the sweep line, exponential decay)
 *   5. Sweep line
 *   6. Beam marker (small triangle on outer ring — actual reported beam)
 *   7. Target trails (Gaussian fade, last TRAIL_LENGTH samples)
 *   8. Target blips (filled threat-coloured dot + classification ring)
 *   9. Selected-target pulse ring
 *  10. Range labels + cardinal compass marks
 *
 * The render loop is self-driven: a worker-side requestAnimationFrame ticks
 * at the browser's paint cadence, independent of when store messages arrive.
 * Store updates merely mutate state; the loop picks up the latest snapshot
 * on its next tick.
 */

/// <reference lib="webworker" />

import type { RadarTarget } from '../types/radar';
import { RADAR_CONSTANTS } from '../types/radar';
import { polarToCanvas, normalizeAngle, hexWithAlpha } from '../lib/polarMath';
import type {
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from './ppiWorkerProtocol';

// ════════════════════════════════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════════════════════════════════

const MARGIN_PX = 32;
const RING_COUNT = 4;
const AZIMUTH_LINE_STEP_DEG = 30;
const SWEEP_RATE_DEG_PER_S = 90; // Slower, more deliberate professional C2 sweep rate (4 seconds per full rotation)
const SWEEP_GLOW_ARC_DEG = 60;
const SELECTION_PULSE_HZ = 1.5;
const TARGET_DOT_RADIUS_PX = 4;
const TARGET_RING_RADIUS_PX = 6;
const TRAIL_DOT_MIN_PX = 1.5;
const TRAIL_DOT_MAX_PX = 4;

const PALETTE = {
  bg_inner: 'rgba(15, 22, 32, 0.92)',
  bg_outer: 'rgba(5, 7, 11, 0.96)',
  ring: 'rgba(199, 204, 212, 0.10)',
  ring_label: 'rgba(199, 204, 212, 0.45)',
  azimuth_line: 'rgba(199, 204, 212, 0.06)',
  sweep_line: 'rgba(199, 204, 212, 0.95)',
  sweep_glow: 'rgba(199, 204, 212, 0.30)',
  beam_marker: 'rgba(123, 97, 255, 0.85)',
  selection_ring: '#c7ccd4',
  cardinal: 'rgba(232, 234, 240, 0.55)',
};

const CLASSIFICATION_COLOR: Record<RadarTarget['classification'], string> = {
  unknown: '#9aa4b5',
  bird: '#7c8a9e',
  drone: '#c7ccd4',
  aircraft: '#d8a553',
  vehicle: '#8d93a1',
};

const THREAT_COLOR: Record<RadarTarget['threat_level'], string> = {
  nominal: '#aeb4bf',
  caution: '#d8a553',
  warning: '#d8a553',
  critical: '#dc4f5d',
};

// ════════════════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════════════════

interface WorkerState {
  canvas: OffscreenCanvas | null;
  ctx: OffscreenCanvasRenderingContext2D | null;
  cssWidth: number;
  cssHeight: number;
  dpr: number;

  targets: RadarTarget[];
  trails: Map<string, RadarTarget[]>;
  selectedId: string | null;
  beamAzimuth: number;
  rangeScale: number;
  cursorTrail: { x: number; y: number; time: number }[];
  mapEnabled: boolean;

  sweepAngle: number;
  pulsePhase: number;
  lastFrameTime: number;
  rafId: number;
}

const state: WorkerState = {
  canvas: null,
  ctx: null,
  cssWidth: 0,
  cssHeight: 0,
  dpr: 1,

  targets: [],
  trails: new Map(),
  selectedId: null,
  beamAzimuth: 0,
  rangeScale: RADAR_CONSTANTS.NEXUS_MAX_RANGE_M,
  cursorTrail: [],
  mapEnabled: false,

  sweepAngle: 0,
  pulsePhase: 0,
  lastFrameTime: 0,
  rafId: 0,
};

// ════════════════════════════════════════════════════════════════════════════
// MESSAGE PUMP
// ════════════════════════════════════════════════════════════════════════════

self.addEventListener('message', (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'INIT':
      handleInit(msg.canvas, msg.width, msg.height, msg.dpr);
      return;
    case 'RESIZE':
      applyDimensions(msg.width, msg.height, msg.dpr);
      return;
    case 'TARGETS':
      state.targets = msg.targets;
      return;
    case 'TRAILS': {
      state.trails.clear();
      for (const id of Object.keys(msg.trails)) {
        state.trails.set(id, msg.trails[id]);
      }
      return;
    }
    case 'SELECTION':
      state.selectedId = msg.id;
      return;
    case 'BEAM':
      state.beamAzimuth = normalizeAngle(msg.azimuth_deg);
      return;
    case 'RANGE_SCALE':
      if (msg.metres > 0) state.rangeScale = msg.metres;
      return;
    case 'CURSOR':
      if (msg.x !== null && msg.y !== null) {
        state.cursorTrail.push({ x: msg.x, y: msg.y, time: performance.now() });
        if (state.cursorTrail.length > 25) {
          state.cursorTrail.shift();
        }
      }
      return;
    case 'MAP_MODE':
      state.mapEnabled = msg.enabled;
      return;
    case 'TEARDOWN':
      handleTeardown();
      return;
    default: {
      const _exhaustive: never = msg;
      console.warn('[ppiWorker] unknown message', _exhaustive);
    }
  }
});

function handleInit(
  canvas: OffscreenCanvas,
  width: number,
  height: number,
  dpr: number,
): void {
  state.canvas = canvas;
  state.ctx = canvas.getContext('2d');
  if (state.ctx === null) {
    console.error('[ppiWorker] failed to acquire 2D context');
    return;
  }
  applyDimensions(width, height, dpr);
  postReady();
  startRenderLoop();
}

function applyDimensions(width: number, height: number, dpr: number): void {
  if (state.canvas === null) return;
  state.cssWidth = width;
  state.cssHeight = height;
  state.dpr = dpr;
  state.canvas.width = Math.max(1, Math.round(width * dpr));
  state.canvas.height = Math.max(1, Math.round(height * dpr));
}

function handleTeardown(): void {
  if (state.rafId !== 0) {
    self.cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  state.canvas = null;
  state.ctx = null;
}

function postReady(): void {
  const msg: WorkerOutboundMessage = { type: 'READY' };
  self.postMessage(msg);
}

// ════════════════════════════════════════════════════════════════════════════
// RENDER LOOP
// ════════════════════════════════════════════════════════════════════════════

function startRenderLoop(): void {
  state.lastFrameTime = performance.now();
  const tick = (now: number): void => {
    const dt_ms = now - state.lastFrameTime;
    state.lastFrameTime = now;
    update(dt_ms);
    render();
    state.rafId = self.requestAnimationFrame(tick);
  };
  state.rafId = self.requestAnimationFrame(tick);
}

function update(dt_ms: number): void {
  const dtClamped = Math.min(dt_ms, 100); // guard against tab-resume mega-step
  state.sweepAngle = normalizeAngle(
    state.sweepAngle + SWEEP_RATE_DEG_PER_S * (dtClamped / 1000),
  );
  state.pulsePhase =
    (state.pulsePhase + (dtClamped / 1000) * SELECTION_PULSE_HZ * Math.PI * 2) %
    (Math.PI * 2);

  // Expire cursor trail points older than 600ms
  const now = performance.now();
  state.cursorTrail = state.cursorTrail.filter((pt) => now - pt.time < 600);
}

function render(): void {
  const ctx = state.ctx;
  if (ctx === null) return;
  if (state.cssWidth === 0 || state.cssHeight === 0) return;

  try {
    ctx.save();
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, state.cssWidth, state.cssHeight);

    const cx = state.cssWidth / 2;
    const cy = state.cssHeight / 2;
    const maxR = Math.max(0, Math.min(state.cssWidth, state.cssHeight) / 2 - MARGIN_PX);

    if (maxR > 4) {
      drawBackground(ctx, cx, cy, maxR);
      drawRangeRings(ctx, cx, cy, maxR);
      drawAzimuthLines(ctx, cx, cy, maxR);
      drawSweepGlow(ctx, cx, cy, maxR);
      drawSweepLine(ctx, cx, cy, maxR);
      drawTrails(ctx, cx, cy, maxR);
      drawSelectedRoute(ctx, cx, cy, maxR);
      drawThreatPredictions(ctx, cx, cy, maxR);
      drawTargets(ctx, cx, cy, maxR);
      drawSelectedRing(ctx, cx, cy, maxR);
      drawRangeLabels(ctx, cx, cy, maxR);
      drawCenterCross(ctx, cx, cy);
      drawCursorTrail(ctx);
    }

    ctx.restore();
  } catch (err) {
    console.error('[ppiWorker] Render loop encountered an error:', err);
    try {
      ctx.restore();
    } catch (_) {}
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 1 — BACKGROUND
// ════════════════════════════════════════════════════════════════════════════

function drawBackground(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxR: number,
): void {
  if (state.mapEnabled) {
    // Live map tiles render behind the canvas at full brightness. Draw NO
    // background fill — no vignette, no dark mask. The radar sweep + rings
    // float directly over the map so it reads as "scanning the terrain"
    // rather than a circular cut-out window. (This is how real C2 map-mode
    // PPIs work — the map is the world, the sweep is a moving sensor beam.)
    return;
  }

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
  grad.addColorStop(0, PALETTE.bg_inner);
  grad.addColorStop(1, PALETTE.bg_outer);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, maxR + MARGIN_PX, 0, Math.PI * 2);
  ctx.fill();
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 2 — RANGE RINGS
// ════════════════════════════════════════════════════════════════════════════

function drawRangeRings(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxR: number,
): void {
  // Inner rings — faint references. In map mode bump opacity a touch so they
  // stay readable over the basemap.
  ctx.strokeStyle = state.mapEnabled ? 'rgba(199, 204, 212, 0.22)' : PALETTE.ring;
  ctx.lineWidth = 1;
  for (let i = 1; i < RING_COUNT; i += 1) {
    const r = (i / RING_COUNT) * maxR;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Outermost ring = the radar COVERAGE EDGE. Draw it boldly so the operator
  // sees exactly how far the sensor reaches and where targets sit relative
  // to that boundary — this is what anchors targets to the coverage area.
  ctx.strokeStyle = state.mapEnabled
    ? 'rgba(199, 204, 212, 0.7)'
    : 'rgba(199, 204, 212, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
  ctx.stroke();

  // Subtle inner glow band just inside the coverage edge (depth cue).
  if (state.mapEnabled) {
    const band = ctx.createRadialGradient(cx, cy, maxR * 0.92, cx, cy, maxR);
    band.addColorStop(0, 'rgba(199, 204, 212, 0)');
    band.addColorStop(1, 'rgba(199, 204, 212, 0.10)');
    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 3 — AZIMUTH LINES
// ════════════════════════════════════════════════════════════════════════════

function drawAzimuthLines(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxR: number,
): void {
  ctx.strokeStyle = PALETTE.azimuth_line;
  ctx.lineWidth = 1;
  for (let deg = 0; deg < 360; deg += AZIMUTH_LINE_STEP_DEG) {
    const rad = ((deg - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(rad) * maxR, cy + Math.sin(rad) * maxR);
    ctx.stroke();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 4 — SWEEP GLOW
// ════════════════════════════════════════════════════════════════════════════

function drawSweepGlow(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxR: number,
): void {
  const sweepMath = ((state.sweepAngle - 90) * Math.PI) / 180;
  const arcRad = (SWEEP_GLOW_ARC_DEG * Math.PI) / 180;
  const startAngle = sweepMath - arcRad;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, maxR, startAngle, sweepMath);
  ctx.closePath();
  ctx.clip();

  // Prefer createConicGradient when available — single-paint angular fade.
  if (typeof ctx.createConicGradient === 'function') {
    const grad = ctx.createConicGradient(startAngle, cx, cy);
    grad.addColorStop(0, 'rgba(199, 204, 212, 0)');
    grad.addColorStop(SWEEP_GLOW_ARC_DEG / 360, PALETTE.sweep_glow);
    grad.addColorStop(1, 'rgba(199, 204, 212, 0)');
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = 'rgba(199, 204, 212, 0.15)';
  }
  ctx.fillRect(cx - maxR - 2, cy - maxR - 2, (maxR + 2) * 2, (maxR + 2) * 2);
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 5 — SWEEP LINE
// ════════════════════════════════════════════════════════════════════════════

function drawSweepLine(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxR: number,
): void {
  const rad = ((state.sweepAngle - 90) * Math.PI) / 180;
  ctx.save();
  ctx.strokeStyle = PALETTE.sweep_line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(rad) * maxR, cy + Math.sin(rad) * maxR);
  ctx.stroke();
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 7 — TRAILS
// ════════════════════════════════════════════════════════════════════════════

function drawTrails(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxR: number,
): void {
  for (const trail of state.trails.values()) {
    const len = trail.length;
    if (len < 2) continue;

    // 1) Draw a faint, sleek dashed tactical vector path line
    ctx.save();
    ctx.beginPath();
    let started = false;
    const firstSample = trail[0];
    const sampleColor = CLASSIFICATION_COLOR[firstSample?.classification ?? 'unknown'] ?? CLASSIFICATION_COLOR.unknown;
    ctx.strokeStyle = hexWithAlpha(sampleColor, 0.22);
    ctx.lineWidth = 0.75;
    ctx.setLineDash([2, 4]); // Dotted style
    
    for (let i = 0; i < len; i += 1) {
      const sample = trail[i];
      if (sample === undefined || sample === null) continue;
      const { x, y } = polarToCanvas(sample.range_m, sample.azimuth_deg, cx, cy, maxR, state.rangeScale);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();

    // 2) Draw discrete, beautifully-spaced historical plot markers
    // step = 5 draws plots every 5 frames, preventing continuous sausage overlays
    const step = 5;
    for (let i = 0; i < len - 1; i += step) {
      const sample = trail[i];
      if (sample === undefined || sample === null) continue;
      
      const ageFactor = (i + 1) / len; // 0 (oldest) to 1 (newest)
      const alpha = ageFactor * ageFactor * 0.45; // quadratic decay for smooth fadeout
      
      const { x, y } = polarToCanvas(
        sample.range_m,
        sample.azimuth_deg,
        cx,
        cy,
        maxR,
        state.rangeScale,
      );
      const color = CLASSIFICATION_COLOR[sample.classification] ?? CLASSIFICATION_COLOR.unknown;
      
      ctx.save();
      ctx.beginPath();
      
      // Newer historic plots get elegant hollow tactical crosshairs
      // Older historic plots fade into ultra-fine micro solid dots
      if (i > len * 0.6) {
        ctx.strokeStyle = hexWithAlpha(color, alpha * 1.4);
        ctx.lineWidth = 0.75;
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.stroke();
        
        // Plus center
        ctx.beginPath();
        ctx.moveTo(x - 1, y);
        ctx.lineTo(x + 1, y);
        ctx.moveTo(x, y - 1);
        ctx.lineTo(x, y + 1);
        ctx.stroke();
      } else {
        ctx.fillStyle = hexWithAlpha(color, alpha * 0.85);
        ctx.arc(x, y, 1.25, 0, Math.PI * 2);
        ctx.fill();
      }
      
      ctx.restore();
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 8 — TARGETS
// ════════════════════════════════════════════════════════════════════════════

function drawTargets(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxR: number,
): void {
  ctx.save();
  for (const target of state.targets) {
    if (target === undefined || target === null) continue;
    // Beyond the current display range → off-scope, like a real PPI. Skip it
    // rather than clamping it onto the outer ring (which fakes its range).
    if (target.range_m > state.rangeScale) continue;
    const { x, y } = polarToCanvas(
      target.range_m,
      target.azimuth_deg,
      cx,
      cy,
      maxR,
      state.rangeScale,
    );
    const threatColor = THREAT_COLOR[target.threat_level];
    const classColor =
      CLASSIFICATION_COLOR[target.classification] ?? CLASSIFICATION_COLOR.unknown;

    // ── Ground anchor (map mode) — the target visibly "sits on" the map
    //    instead of floating: a soft drop-shadow disc + a footprint ring at
    //    its ground position, with a short tether up to the blip. ──────────
    if (state.mapEnabled) {
      ctx.save();
      ctx.shadowBlur = 0;
      // Drop shadow on the terrain
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.ellipse(x + 2, y + 3, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      // Footprint ring (threat-toned) — marks the ground position
      ctx.strokeStyle = hexWithAlpha(threatColor, 0.45);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = threatColor;
    ctx.beginPath();
    ctx.arc(x, y, TARGET_DOT_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = classColor;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(x, y, TARGET_RING_RADIUS_PX, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 8.5 — SELECTED TARGET ROUTE LINE (geçtiği yerler / rotası)
// ════════════════════════════════════════════════════════════════════════════

function drawSelectedRoute(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxR: number,
): void {
  if (state.selectedId === null) return;
  const trail = state.trails.get(state.selectedId);
  if (trail === undefined || trail.length < 2) return;

  // 1) Render the crisp, high-tech tactical dashed line
  ctx.save();
  ctx.setLineDash([3, 3]);
  
  for (let i = 1; i < trail.length; i += 1) {
    const prev = trail[i - 1];
    const curr = trail[i];
    if (prev === undefined || prev === null || curr === undefined || curr === null) continue;

    const pPrev = polarToCanvas(prev.range_m, prev.azimuth_deg, cx, cy, maxR, state.rangeScale);
    const pCurr = polarToCanvas(curr.range_m, curr.azimuth_deg, cx, cy, maxR, state.rangeScale);

    const age = i / trail.length; // 0 to 1
    ctx.strokeStyle = `rgba(199, 204, 212, ${0.1 + age * 0.55})`;
    ctx.lineWidth = 1.0 + age * 1.0;

    ctx.beginPath();
    ctx.moveTo(pPrev.x, pPrev.y);
    ctx.lineTo(pCurr.x, pCurr.y);
    ctx.stroke();
  }
  ctx.restore();

  // 2) Draw tiny stealth chevrons/arrows indicating target flight heading on the path line
  ctx.save();
  ctx.fillStyle = 'rgba(199, 204, 212, 0.75)';
  
  for (let i = 10; i < trail.length - 5; i += 15) {
    const pPrevSample = trail[i - 2];
    const pCurrSample = trail[i];
    if (pPrevSample === undefined || pPrevSample === null || pCurrSample === undefined || pCurrSample === null) continue;

    const pPrev = polarToCanvas(pPrevSample.range_m, pPrevSample.azimuth_deg, cx, cy, maxR, state.rangeScale);
    const pCurr = polarToCanvas(pCurrSample.range_m, pCurrSample.azimuth_deg, cx, cy, maxR, state.rangeScale);
    
    const dx = pCurr.x - pPrev.x;
    const dy = pCurr.y - pPrev.y;
    const angle = Math.atan2(dy, dx);
    
    ctx.save();
    ctx.translate(pCurr.x, pCurr.y);
    ctx.rotate(angle);
    
    // Sleek military stealth arrowhead symbol
    ctx.beginPath();
    ctx.moveTo(-5, -4);
    ctx.lineTo(3, 0);
    ctx.lineTo(-5, 4);
    ctx.lineTo(-3, 0); // Indented back for a sleek aerospace look
    ctx.closePath();
    ctx.fill();
    
    ctx.restore();
  }

  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 9 — SELECTED-TARGET PULSE RING
// ════════════════════════════════════════════════════════════════════════════

function drawSelectedRing(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxR: number,
): void {
  if (state.selectedId === null) return;
  const target = state.targets.find((t) => t.id === state.selectedId);
  if (target === undefined) return;

  const { x, y } = polarToCanvas(
    target.range_m,
    target.azimuth_deg,
    cx,
    cy,
    maxR,
    state.rangeScale,
  );
  const phase01 = (Math.sin(state.pulsePhase) + 1) / 2; // [0, 1]
  const ringR = 11 + phase01 * 9;
  const alpha = 0.95 - phase01 * 0.45;

  ctx.save();
  ctx.strokeStyle = hexWithAlpha(PALETTE.selection_ring, alpha);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 10 — RANGE LABELS + CARDINAL COMPASS
// ════════════════════════════════════════════════════════════════════════════

function drawRangeLabels(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxR: number,
): void {
  ctx.save();
  ctx.fillStyle = PALETTE.ring_label;
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  for (let i = 1; i <= RING_COUNT; i += 1) {
    const r = (i / RING_COUNT) * maxR;
    const range_m = (i / RING_COUNT) * state.rangeScale;
    ctx.fillText(formatDistance(range_m), cx, cy - r - 2);
  }

  // Cardinal marks
  ctx.fillStyle = PALETTE.cardinal;
  ctx.font = "600 11px 'JetBrains Mono', monospace";
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, cy - maxR - 14);
  ctx.fillText('S', cx, cy + maxR + 14);
  ctx.textAlign = 'left';
  ctx.fillText('E', cx + maxR + 8, cy);
  ctx.textAlign = 'right';
  ctx.fillText('W', cx - maxR - 8, cy);
  ctx.restore();
}

function drawCenterCross(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(199, 204, 212, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 4, cy);
  ctx.lineTo(cx + 4, cy);
  ctx.moveTo(cx, cy - 4);
  ctx.lineTo(cx, cy + 4);
  ctx.stroke();
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 8.2 — THREAT TRAJECTORY PREDICTION (Kritik Tehdit Öngörülen Rota)
// ════════════════════════════════════════════════════════════════════════════

function drawThreatPredictions(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  maxR: number,
): void {
  ctx.save();
  
  for (const target of state.targets) {
    if (target === undefined || target === null) continue;
    if (target.threat_level !== 'critical') continue;

    const trail = state.trails.get(target.id);
    if (trail === undefined || trail.length < 5) continue;

    // Get current and past samples for velocity vector estimation
    const curr = trail[trail.length - 1];
    // Go back 8 frames or the first frame to get a stable velocity vector
    const prevIndex = Math.max(0, trail.length - 8);
    const prev = trail[prevIndex];
    if (curr === undefined || curr === null || prev === undefined || prev === null) continue;

    const dt_ms = curr.timestamp_ms - prev.timestamp_ms;
    if (dt_ms <= 100) continue; // prevent division by zero or jitter

    const dt_s = dt_ms / 1000;
    const vx = (curr.x_m - prev.x_m) / dt_s;
    const vy = (curr.y_m - prev.y_m) / dt_s;

    // Only draw if target is moving
    const speed = Math.hypot(vx, vy);
    if (speed < 1.0) continue; // stationary threshold 1 m/s

    // Calculate future coordinates at 5 seconds
    const futureX_m = curr.x_m + vx * 5.0;
    const futureY_m = curr.y_m + vy * 5.0;

    // Map to canvas pixels
    const px_per_m = maxR / state.rangeScale;
    const startX = cx + (curr.x_m * px_per_m);
    const startY = cy - (curr.y_m * px_per_m);
    const endX = cx + (futureX_m * px_per_m);
    const endY = cy - (futureY_m * px_per_m);

    // Draw the trajectory prediction line
    ctx.save();
    
    // Create gradient that fades to transparent
    const grad = ctx.createLinearGradient(startX, startY, endX, endY);
    grad.addColorStop(0, 'rgba(255, 59, 59, 0.85)');
    grad.addColorStop(0.3, 'rgba(255, 59, 59, 0.55)');
    grad.addColorStop(1, 'rgba(255, 59, 59, 0.0)');
    
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 4;
    ctx.shadowColor = 'rgba(255, 59, 59, 0.5)';
    
    // Professional military dash-dot-dot pattern: [dash, gap, dot, gap, dot, gap]
    ctx.setLineDash([8, 3, 2, 3, 2, 3]);
    
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    // Draw a small predicted lock-point indicator
    ctx.strokeStyle = 'rgba(255, 59, 59, 0.5)';
    ctx.fillStyle = 'rgba(255, 59, 59, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(endX, endY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // Draw crosshair tick lines on the 5s prediction dot
    ctx.beginPath();
    ctx.moveTo(endX - 5, endY);
    ctx.lineTo(endX + 5, endY);
    ctx.moveTo(endX, endY - 5);
    ctx.lineTo(endX, endY + 5);
    ctx.stroke();
    
    // Label "+5s PROJ" in tiny tactical font
    ctx.fillStyle = 'rgba(255, 59, 59, 0.7)';
    ctx.font = "800 8px 'JetBrains Mono', monospace";
    ctx.textAlign = 'left';
    ctx.fillText('+5s PROJ', endX + 7, endY + 3);

    ctx.restore();
  }

  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 11 — CURSOR NEON GLOW TRAIL
// ════════════════════════════════════════════════════════════════════════════

function drawCursorTrail(ctx: OffscreenCanvasRenderingContext2D): void {
  const len = state.cursorTrail.length;
  if (len < 2) return;

  ctx.save();
  
  // 1) Fluid neon line
  ctx.beginPath();
  const first = state.cursorTrail[0];
  if (first) {
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < len; i += 1) {
      const pt = state.cursorTrail[i];
      if (pt) ctx.lineTo(pt.x, pt.y);
    }
  }

  ctx.strokeStyle = 'rgba(199, 204, 212, 0.4)';
  ctx.lineWidth = 2.0;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowBlur = 6;
  ctx.shadowColor = '#c7ccd4';
  ctx.stroke();

  // 2) Fading glowing sparks/dots along the trail
  ctx.shadowBlur = 0;
  const now = performance.now();
  for (let i = 0; i < len; i += 1) {
    const pt = state.cursorTrail[i];
    if (!pt) continue;
    const age = (now - pt.time) / 600; // 0 to 1
    if (age >= 1) continue;
    const alpha = (1 - age) * 0.45;
    const r = (1 - age) * 3.5 + 1.2;

    ctx.fillStyle = `rgba(199, 204, 212, ${alpha})`;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${m.toFixed(0)} m`;
}
