/**
 * Store Debug Subscribers — STEP 2 test harness.
 * =============================================================================
 * Opt-in console.log subscribers for each of the three stores. Called once
 * from `App.tsx` (or `main.tsx`) during development to verify cadence and
 * state coherence without standing up the canvas.
 *
 * Returns an unsubscribe function — call it to detach all listeners at once,
 * e.g. in a React effect cleanup.
 *
 *   useEffect(() => enableStoreDebugLogs(), []);
 *
 * Production builds should not call this. Wrap in `import.meta.env.DEV`.
 */

import { useSystemStore } from './systemStore';
import { useTargetStore } from './radarStore';
import { useTelemetryStore } from './telemetryStore';

export function enableStoreDebugLogs(): () => void {
  // ── Targets ──────────────────────────────────────────────────────────────
  const unsubTargetCount = useTargetStore.subscribe(
    (s) => s.targets.size,
    (size, prev) => {
      console.log(`[targets] count ${prev} → ${size}`);
    },
  );

  const unsubFrameId = useTargetStore.subscribe(
    (s) => s.currentFrameId,
    (id) => {
      if (id !== null && id % 60 === 0) {
        // Log once per second at 60 Hz to avoid console spam.
        console.log(`[targets] frame_id ${id}`);
      }
    },
  );

  const unsubSelection = useTargetStore.subscribe(
    (s) => s.selectedTargetId,
    (id, prev) => {
      console.log(`[targets] selection ${prev ?? 'none'} → ${id ?? 'none'}`);
    },
  );

  // ── Telemetry ────────────────────────────────────────────────────────────
  const unsubFan = useTelemetryStore.subscribe(
    (s) => s.current?.cooling_fan_active ?? null,
    (active, prev) => {
      if (active !== prev) {
        console.log(`[telemetry] cooling fan: ${prev} → ${active}`);
      }
    },
  );

  const unsubAgc = useTelemetryStore.subscribe(
    (s) => s.current?.agc_gain ?? null,
    (gain) => {
      if (gain !== null) {
        console.log(`[telemetry] agc_gain ${gain}`);
      }
    },
  );

  const unsubAlarmCount = useTelemetryStore.subscribe(
    (s) => s.alarms.length,
    (count, prev) => {
      if (count > prev) {
        const latest = useTelemetryStore.getState().alarms[0];
        console.warn(
          `[alarms] +1 (${count} total) — ${latest.severity} ${latest.category} ${latest.source}: ${latest.message}`,
        );
      }
    },
  );

  // ── System ───────────────────────────────────────────────────────────────
  const unsubConnection = useSystemStore.subscribe(
    (s) => s.current?.connection ?? null,
    (conn, prev) => {
      console.log(`[system] connection ${prev ?? 'INIT'} → ${conn ?? 'null'}`);
    },
  );

  const unsubOcxo = useSystemStore.subscribe(
    (s) => s.current?.ocxo_warm ?? null,
    (warm, prev) => {
      if (warm !== prev) {
        console.log(`[system] ocxo_warm ${prev} → ${warm}`);
      }
    },
  );

  const unsubConfigAck = useSystemStore.subscribe(
    (s) => s.pendingConfigId,
    (id, prev) => {
      console.log(`[system] pendingConfigId ${prev ?? 'none'} → ${id ?? 'none'}`);
    },
  );

  return () => {
    unsubTargetCount();
    unsubFrameId();
    unsubSelection();
    unsubFan();
    unsubAgc();
    unsubAlarmCount();
    unsubConnection();
    unsubOcxo();
    unsubConfigAck();
  };
}
