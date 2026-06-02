/**
 * useMockEngine — drives the MockEngine singleton when WebSocket is unavailable.
 * =============================================================================
 * Hybrid timing per Section 5.2 of the directive:
 *
 *   - setInterval @ 1/60 s  : produces frames at a steady cadence even when
 *                             the tab is throttled to background mode.
 *   - requestAnimationFrame : flushes only the most recent buffered frame
 *                             when the browser is ready to paint — back-
 *                             pressure prevents stale frames from queuing up
 *                             after the tab returns to the foreground.
 *
 * Alarms are drained immediately after each tick because they have audit
 * value and shouldn't be coalesced like frames.
 *
 *   useMockEngine(ws.shouldUseMock);
 *
 * The hook is a no-op when `enabled` is false — the WebSocket hook flips it
 * on/off based on connection state. There's no shared coordination beyond
 * that boolean.
 */

import { useEffect } from 'react';

import { MockEngine } from '../lib/mockEngine';
import { applyRadarFrame } from '../lib/frameDispatcher';
import { useTelemetryStore } from '../stores/telemetryStore';
import type { RadarFrame } from '../types/radar';
import { RADAR_CONSTANTS } from '../types/radar';

export function useMockEngine(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const engine = MockEngine.getInstance();
    const frameBuffer: RadarFrame[] = [];

    // ── Producer ────────────────────────────────────────────────────────────
    const intervalMs = 1000 / RADAR_CONSTANTS.FRAME_RATE_HZ;
    const intervalId = window.setInterval(() => {
      frameBuffer.push(engine.nextFrame());

      const alarms = engine.pollAlarms();
      if (alarms.length === 0) return;
      const pushAlarm = useTelemetryStore.getState().pushAlarm;
      for (const alarm of alarms) {
        pushAlarm(alarm);
      }
    }, intervalMs);

    // ── Consumer ────────────────────────────────────────────────────────────
    let rafId = 0;
    const flush = (): void => {
      if (frameBuffer.length > 0) {
        const latest = frameBuffer[frameBuffer.length - 1];
        frameBuffer.length = 0;
        applyRadarFrame(latest);
      }
      rafId = window.requestAnimationFrame(flush);
    };
    rafId = window.requestAnimationFrame(flush);

    return () => {
      window.clearInterval(intervalId);
      window.cancelAnimationFrame(rafId);
    };
  }, [enabled]);
}
