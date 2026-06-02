/**
 * ============================================================================
 * AERIS-10 Command & Control (C2) Tactical Console
 * ────────────────────────────────────────────────────────────────────────────
 * SYSTEM COMPONENT      : 2D Primary Radar Viewport (PPICanvas Harness)
 * ARCHITECT & DEVELOPER : Doğukan Aslan
 * LICENSE               : Proprietary / Community Shared Release
 * VERSION               : 1.0.0 (Nexus Active Deployment)
 * ============================================================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useTargetStore } from '../../stores/radarStore';
import { useTelemetryStore } from '../../stores/telemetryStore';
import { useSystemStore } from '../../stores/systemStore';
import type { RadarTarget } from '../../types/radar';
import { polarToCanvas } from '../../lib/polarMath';
import type { WorkerInboundMessage } from '../../workers/ppiWorkerProtocol';
import PPIWorker from '../../workers/ppiWorker.ts?worker';
import { formatDoppler, formatRange, shortId } from '../command/TargetList';
import { CornerBrackets } from '../common/CornerBrackets';
import { IconCompass, IconScan } from '../icons';
import { usePPIHover } from '../../hooks/usePPIHover';
import { PPITooltip } from './PPITooltip';
import { PPIMapLayer } from './PPIMapLayer';
import { MissionModeRail } from '../common/MissionModeRail';
import { IconGps } from '../icons';

import './PPICanvas.css';
import './Radar3D.css';

const HIT_RADIUS_PX = 14;
const CANVAS_MARGIN_PX = 32;

export function PPICanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const transferredRef = useRef<boolean>(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const [mapEnabled, setMapEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('aeris.ppiMap') === '1';
    } catch {
      return false;
    }
  });

  const selectedTarget = useTargetStore((s) =>
    s.selectedTargetId !== null ? s.targets.get(s.selectedTargetId) ?? null : null,
  );

  // Ref mirror so the (deps-[]) ResizeObserver always reads the live value.
  const mapEnabledRef = useRef(mapEnabled);
  mapEnabledRef.current = mapEnabled;

  // Size the canvas: full-bleed in map mode (radar overlays the whole map),
  // square in classic mode (centred PPI disc).
  const applyCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (canvas === null || wrapper === null) return;
    const rect = wrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    let w: number;
    let h: number;
    if (mapEnabledRef.current) {
      w = Math.max(64, Math.round(rect.width));
      h = Math.max(64, Math.round(rect.height));
    } else {
      const size = Math.max(64, Math.min(rect.width, rect.height) - CANVAS_MARGIN_PX / 2);
      w = size;
      h = size;
    }
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    workerRef.current?.postMessage({ type: 'RESIZE', width: w, height: h, dpr });
  }, []);

  // Tell the worker whether a basemap is behind it; also re-size the canvas
  // (full-bleed vs square) and persist the preference.
  useEffect(() => {
    workerRef.current?.postMessage({ type: 'MAP_MODE', enabled: mapEnabled });
    applyCanvasSize();
    try {
      window.localStorage.setItem('aeris.ppiMap', mapEnabled ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [mapEnabled, applyCanvasSize]);

  const hover = usePPIHover(canvasRef);

  // Hover-intent — wait 80 ms before committing to showing the tooltip so a
  // fast cursor sweep over multiple targets doesn't flash a chain of pop-ups.
  // Resets the instant the hover target changes or the cursor leaves.
  const [tooltipReady, setTooltipReady] = useState(false);
  useEffect(() => {
    if (hover.target === null || !hover.active) {
      setTooltipReady(false);
      return;
    }
    const timer = window.setTimeout(() => setTooltipReady(true), 80);
    return () => window.clearTimeout(timer);
  }, [hover.target?.id, hover.active]);

  // ── Worker lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (canvas === null || wrapper === null) return;

    // Check if there is already an active worker attached to this canvas DOM node
    // to handle React 18 StrictMode double-mount gracefully without throwing
    // "Cannot transfer control from a canvas for more than one time".
    const existingWorker = (canvas as any)._worker;
    const pendingTimer = (canvas as any)._teardownTimer;

    if (existingWorker && pendingTimer) {
      clearTimeout(pendingTimer);
      (canvas as any)._teardownTimer = null;
      workerRef.current = existingWorker;
      transferredRef.current = true;
      return;
    }

    const wrapperRect = wrapper.getBoundingClientRect();
    const initialSize = Math.max(
      64,
      Math.min(wrapperRect.width, wrapperRect.height) - CANVAS_MARGIN_PX / 2,
    );
    canvas.style.width = `${initialSize}px`;
    canvas.style.height = `${initialSize}px`;

    const dpr = window.devicePixelRatio || 1;
    const offscreen = canvas.transferControlToOffscreen();
    transferredRef.current = true;

    let worker: Worker;
    try {
      worker = new PPIWorker();
      workerRef.current = worker;
      (canvas as any)._worker = worker;
    } catch (err) {
      console.error('AERIS-10: Failed to instantiate Web Worker:', err);
      // Fallback gracefully so the React app still renders the layout and panels
      return;
    }

    const initMsg: WorkerInboundMessage = {
      type: 'INIT',
      canvas: offscreen,
      width: initialSize,
      height: initialSize,
      dpr,
    };
    worker.postMessage(initMsg, [offscreen]);
    // Sync initial map-mode (localStorage may have restored it to true).
    worker.postMessage({ type: 'MAP_MODE', enabled: mapEnabled });

    return () => {
      // Defer the teardown/termination using a timeout so that if React 18 StrictMode
      // remounts the component synchronously, we can intercept and reuse the active worker.
      (canvas as any)._teardownTimer = setTimeout(() => {
        const teardown: WorkerInboundMessage = { type: 'TEARDOWN' };
        worker.postMessage(teardown);
        worker.terminate();
        
        if ((canvas as any)._worker === worker) {
          (canvas as any)._worker = null;
          (canvas as any)._teardownTimer = null;
        }
      }, 50);

      workerRef.current = null;
      transferredRef.current = false;
    };
  }, []);

  // ── Resize observation ────────────────────────────────────────────────────
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (wrapper === null || canvas === null) return;

    const observer = new ResizeObserver(() => {
      applyCanvasSize();
    });
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [applyCanvasSize]);

  // ── Store subscriptions → worker ─────────────────────────────────────────
  useEffect(() => {
    const post = (msg: WorkerInboundMessage): void => {
      workerRef.current?.postMessage(msg);
    };

    // Initial state snapshot
    const ts = useTargetStore.getState();
    post({ type: 'TARGETS', targets: Array.from(ts.targets.values()) });
    post({ type: 'TRAILS', trails: trailMapToRecord(ts.targetHistory) });
    post({ type: 'SELECTION', id: ts.selectedTargetId });

    const tel = useTelemetryStore.getState().current;
    if (tel !== null) post({ type: 'BEAM', azimuth_deg: tel.beam_azimuth_deg });

    post({
      type: 'RANGE_SCALE',
      metres: useSystemStore.getState().radarRangeScale,
    });

    // Live subscriptions
    const unsubTargets = useTargetStore.subscribe(
      (s) => s.targets,
      (targets) =>
        post({ type: 'TARGETS', targets: Array.from(targets.values()) }),
    );
    const unsubTrails = useTargetStore.subscribe(
      (s) => s.targetHistory,
      (history) =>
        post({ type: 'TRAILS', trails: trailMapToRecord(history) }),
    );
    const unsubSelection = useTargetStore.subscribe(
      (s) => s.selectedTargetId,
      (id) => post({ type: 'SELECTION', id }),
    );
    const unsubBeam = useTelemetryStore.subscribe(
      (s) => s.current?.beam_azimuth_deg,
      (deg) => {
        if (deg !== undefined) post({ type: 'BEAM', azimuth_deg: deg });
      },
    );
    const unsubRange = useSystemStore.subscribe(
      (s) => s.radarRangeScale,
      (scale) => post({ type: 'RANGE_SCALE', metres: scale }),
    );

    return () => {
      unsubTargets();
      unsubTrails();
      unsubSelection();
      unsubBeam();
      unsubRange();
    };
  }, []);

  // ── Click → hit test → selection ──────────────────────────────────────────
  const handleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;

    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const maxR = Math.max(0, Math.min(rect.width, rect.height) / 2 - 32);

    const store = useTargetStore.getState();
    const rangeScale = useSystemStore.getState().radarRangeScale;

    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const target of store.targets.values()) {
      // Off-scope targets aren't drawn, so they can't be clicked either.
      if (target.range_m > rangeScale) continue;
      const { x, y } = polarToCanvas(
        target.range_m,
        target.azimuth_deg,
        cx,
        cy,
        maxR,
        rangeScale,
      );
      const dist = Math.hypot(px - x, py - y);
      if (dist <= HIT_RADIUS_PX && dist < bestDist) {
        bestId = target.id;
        bestDist = dist;
      }
    }
    store.selectTarget(bestId);
  }, []);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;

    workerRef.current?.postMessage({
      type: 'CURSOR',
      x: px,
      y: py,
    });
  }, []);

  const handleMouseLeave = useCallback(() => {
    workerRef.current?.postMessage({
      type: 'CURSOR',
      x: null,
      y: null,
    });
  }, []);

  const setRadarMode = useSystemStore((s) => s.setRadarMode);
  const layoutPreset = useSystemStore((s) => s.layoutPreset);

  return (
    <div
      ref={wrapperRef}
      className="ppi-wrapper"
      data-mode={layoutPreset}
      data-map={mapEnabled || undefined}
    >
      <PPIMapLayer visible={mapEnabled} />

      <CornerBrackets size={14} thickness={1} inset={10} bindToConnection opacity={0.55} />

      <div className="ppi-label ppi-label--tl" aria-hidden>
        <IconScan size={11} /> <span>PPI · LIVE</span>
      </div>

      <button
        type="button"
        className="ppi-map-toggle"
        data-active={mapEnabled || undefined}
        onClick={() => setMapEnabled((v) => !v)}
        title={mapEnabled ? 'Hide geographic basemap' : 'Show geographic basemap'}
        aria-pressed={mapEnabled}
      >
        <IconGps size={11} />
        <span>MAP {mapEnabled ? 'ON' : 'OFF'}</span>
      </button>

      <div className="radar-3d__controls">
        <button
          type="button"
          className="radar-3d__toggle-btn radar-3d__toggle-btn--active"
        >
          2D PPI VIEW
        </button>
        <button
          type="button"
          className="radar-3d__toggle-btn"
          onClick={() => setRadarMode('3D')}
        >
          3D DOME VIEW
        </button>
      </div>
      <div className="ppi-label ppi-label--tr" aria-hidden>
        <IconCompass size={11} /> <span>HDG 360°</span>
      </div>
      <div className="ppi-label ppi-label--bl" aria-hidden>
        <span>X-BAND · 10.5 GHz</span>
      </div>
      <div className="ppi-label ppi-label--br" aria-hidden>
        <span>PLFM</span>
      </div>

      <canvas
        ref={canvasRef}
        key={canvasKey}
        className="ppi-canvas"
        data-hovered={hover.target !== null}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        role="img"
        aria-label="Plan Position Indicator — radar surface"
      />
      {selectedTarget !== null && <TargetDetailOverlay target={selectedTarget} />}
      {hover.target !== null
        && hover.active
        && tooltipReady
        && hover.target.id !== selectedTarget?.id && (
        <PPITooltip
          target={hover.target}
          clientX={hover.clientX}
          clientY={hover.clientY}
        />
      )}
      <MissionModeRail />
    </div>
  );
}

// ── Overlay (HTML, not canvas) ──────────────────────────────────────────────

function TargetDetailOverlay({ target }: { target: RadarTarget }) {
  const mode = useSystemStore((s) => s.layoutPreset);
  const history = useTargetStore((s) => s.targetHistory.get(target.id) ?? []);
  const shortTgtId = shortId(target.id);
  const ageMs = Math.max(0, Date.now() - target.timestamp_ms);
  const cpaSeconds =
    target.doppler_mps < -0.1 ? target.range_m / Math.abs(target.doppler_mps) : null;
  const bearingRate = deriveBearingRate(history);
  const rangeTrend = deriveRangeTrend(history);
  const confidence = deriveTargetConfidence(target, history, ageMs);
  const sparkSamples = history.slice(-14);
  
  return (
    <div className="ppi-overlay" data-tone={target.threat_level} data-mode={mode}>
      <div className="ppi-overlay__head">
        <div className="ppi-overlay__header-left">
          <span className="ppi-overlay__id">TGT-{shortTgtId}</span>
          <span className="ppi-overlay__class">{target.classification.toUpperCase()}</span>
        </div>
        <span className="ppi-overlay__badge" data-tone={target.threat_level}>
          {target.threat_level === 'critical' ? '⬣ CRIT'
           : target.threat_level === 'warning' ? '◆ WARN'
           : target.threat_level === 'caution' ? '◇ CAUT'
           : '✓ NOM'}
        </span>
      </div>

      <div className="ppi-overlay__mission-row">
        <span>
          <strong>CPA</strong>
          {cpaSeconds === null ? 'OPENING' : formatSeconds(cpaSeconds)}
        </span>
        <span data-tone={confidence.tone}>
          <strong>CONF</strong>
          {confidence.label}
        </span>
        <span>
          <strong>AGE</strong>
          {ageMs < 1_000 ? `${ageMs.toFixed(0)}ms` : `${(ageMs / 1000).toFixed(1)}s`}
        </span>
      </div>

      <div className="ppi-overlay__grid">
        <div className="ppi-overlay__cell">
          <span className="ppi-overlay__cell-label">RANGE</span>
          <span className="ppi-overlay__cell-value">{formatRange(target.range_m)}</span>
        </div>
        <div className="ppi-overlay__cell">
          <span className="ppi-overlay__cell-label">VELOCITY</span>
          <span className="ppi-overlay__cell-value" data-tone={target.doppler_mps < 0 ? 'critical' : 'nominal'}>
            {formatDoppler(target.doppler_mps)}
          </span>
        </div>

        <div className="ppi-overlay__cell">
          <span className="ppi-overlay__cell-label">AZIMUTH</span>
          <span className="ppi-overlay__cell-value">{target.azimuth_deg.toFixed(1)}°</span>
        </div>
        <div className="ppi-overlay__cell">
          <span className="ppi-overlay__cell-label">SNR</span>
          <span className="ppi-overlay__cell-value">{target.snr_db.toFixed(1)} dB</span>
        </div>

        <div className="ppi-overlay__cell">
          <span className="ppi-overlay__cell-label">ELEVATION</span>
          <span className="ppi-overlay__cell-value">
            {target.elevation_deg >= 0 ? '+' : ''}{target.elevation_deg.toFixed(1)}°
          </span>
        </div>
        <div className="ppi-overlay__cell">
          <span className="ppi-overlay__cell-label">RCS</span>
          <span className="ppi-overlay__cell-value">{target.rcs_dbsm.toFixed(1)} dBsm</span>
        </div>
      </div>

      <div className="ppi-overlay__dossier-extra">
        <div className="ppi-overlay__trend-grid">
          <TrendCell label="CLOSING" value={target.doppler_mps < 0 ? 'YES' : 'NO'} tone={target.doppler_mps < 0 ? 'critical' : 'nominal'} />
          <TrendCell label="BRG RATE" value={`${bearingRate >= 0 ? '+' : ''}${bearingRate.toFixed(1)} deg/s`} />
          <TrendCell label="RNG TREND" value={`${rangeTrend >= 0 ? '+' : ''}${rangeTrend.toFixed(0)} m/s`} tone={rangeTrend < 0 ? 'critical' : 'nominal'} />
          <TrendCell label="ALT" value={`${target.z_m.toFixed(0)} m`} />
        </div>
        <div className="ppi-overlay__sparkline" aria-hidden>
          {sparkSamples.map((sample, index) => (
            <span
              key={`${sample.timestamp_ms}-${index}`}
              style={{ height: `${sparkHeight(sample.doppler_mps)}%` }}
              data-tone={sample.doppler_mps < 0 ? 'critical' : 'nominal'}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function TrendCell(props: {
  label: string;
  value: string;
  tone?: 'critical' | 'nominal';
}) {
  return (
    <div className="ppi-overlay__trend-cell" data-tone={props.tone}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function deriveBearingRate(history: RadarTarget[]): number {
  if (history.length < 2) return 0;
  const first = history[Math.max(0, history.length - 10)];
  const last = history[history.length - 1];
  const dt = Math.max(0.001, (last.timestamp_ms - first.timestamp_ms) / 1000);
  return angleDeltaDeg(last.azimuth_deg, first.azimuth_deg) / dt;
}

function deriveRangeTrend(history: RadarTarget[]): number {
  if (history.length < 2) return 0;
  const first = history[Math.max(0, history.length - 10)];
  const last = history[history.length - 1];
  const dt = Math.max(0.001, (last.timestamp_ms - first.timestamp_ms) / 1000);
  return (last.range_m - first.range_m) / dt;
}

function deriveTargetConfidence(
  target: RadarTarget,
  history: RadarTarget[],
  ageMs: number,
): { label: string; tone: 'nominal' | 'caution' | 'critical' } {
  if (ageMs > 1_500) return { label: 'STALE', tone: 'critical' };
  if (target.snr_db >= 28 && history.length >= 8) return { label: 'HIGH', tone: 'nominal' };
  if (target.snr_db >= 16 && history.length >= 3) return { label: 'MED', tone: 'caution' };
  return { label: 'LOW', tone: 'critical' };
}

function angleDeltaDeg(next: number, prev: number): number {
  return ((next - prev + 540) % 360) - 180;
}

function formatSeconds(seconds: number): string {
  if (seconds > 99) return '>99s';
  return `${seconds.toFixed(1)}s`;
}

function sparkHeight(mps: number): number {
  return Math.max(18, Math.min(100, 18 + Math.abs(mps) * 5.2));
}

function trailMapToRecord(
  map: Map<string, RadarTarget[]>,
): Record<string, RadarTarget[]> {
  const out: Record<string, RadarTarget[]> = {};
  for (const [id, trail] of map) {
    out[id] = trail;
  }
  return out;
}
