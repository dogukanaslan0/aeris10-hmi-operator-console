/**
 * Frame Dispatcher — the single point where parsed frames meet the stores.
 * =============================================================================
 * Both `useRadarWebSocket` and `useMockEngine` funnel their output through
 * here. Keeping the store-write fan-out in one place guarantees:
 *
 *   - Telemetry/system throttling rules are applied consistently regardless
 *     of source (matches the backend cadence contract in Section 2.1).
 *   - Cross-source switches (mock → live, live → mock) reset the target
 *     cursor cleanly so out-of-order frame guards don't black-hole frames
 *     from the new source.
 *   - WebSocket message types (HANDSHAKE / ALARM / CONFIG_ACK / FRAME) are
 *     decoded in one place — schema drift fails loud, not silent.
 */

import type {
  FrameSource,
  RadarFrame,
  WebSocketMessage,
} from '../types/radar';
import { RADAR_CONSTANTS } from '../types/radar';

import { useTargetStore } from '../stores/radarStore';
import { useTelemetryStore } from '../stores/telemetryStore';
import { useSystemStore } from '../stores/systemStore';

// Module-level state — source-switch detection + per-channel cadence cursors.
let lastSource: FrameSource | null = null;
let lastTelemetryFrameId = -Infinity;
let lastSystemFrameId = -Infinity;

/**
 * Apply one RadarFrame to all three stores, honouring per-channel throttle.
 * Safe to call ≥60 Hz; idempotent under duplicate frame_ids (target store
 * guards out-of-order updates).
 */
export function applyRadarFrame(frame: RadarFrame): void {
  // ── Source switch → wipe target state to avoid mixing entities ──────────
  if (lastSource !== null && lastSource !== frame.source) {
    useTargetStore.setState({
      currentFrameId: null,
      targets: new Map(),
      targetHistory: new Map(),
      selectedTargetId: null,
    });
    // Frame ids restart with a new source — reset the cadence cursors so the
    // first frame of the new source applies immediately rather than stalling
    // on a stale high id.
    lastTelemetryFrameId = -Infinity;
    lastSystemFrameId = -Infinity;
  }
  lastSource = frame.source;

  // ── Hot path: every frame ───────────────────────────────────────────────
  useTargetStore
    .getState()
    .updateTargets(frame.targets, frame.frame_id, frame.timestamp_ms);

  // ── Per-channel cadence by frame-id DELTA, not `frame_id % divider` ──────
  // Under rAF back-pressure only the most recent buffered frame is applied, so
  // a frame whose id is an exact multiple of the divider can be skipped
  // entirely — making `% divider === 0` fire irregularly (or starve) under
  // load. Gating on the delta since the last applied frame keeps telemetry and
  // system updating at their intended ~12 Hz / ~2 Hz regardless of dropped
  // intermediate frames.
  if (frame.frame_id - lastTelemetryFrameId >= RADAR_CONSTANTS.TELEMETRY_DIVIDER) {
    useTelemetryStore.getState().updateTelemetry(frame.telemetry);
    lastTelemetryFrameId = frame.frame_id;
  }
  if (frame.frame_id - lastSystemFrameId >= RADAR_CONSTANTS.SYSTEM_DIVIDER) {
    useSystemStore.getState().updateSystem(frame.system);
    lastSystemFrameId = frame.frame_id;
  }
}

/**
 * Decode and route a single WebSocket message envelope.
 *
 * FRAME messages are pushed into `frameBuffer` so the receiver can apply
 * back-pressure (only flushing the most recent frame per rAF tick). All
 * other message types are applied immediately because they are low-rate
 * and order-sensitive.
 *
 * Bad JSON / unknown types do NOT throw — they are logged and dropped.
 */
export function dispatchWebSocketMessage(
  message: WebSocketMessage,
  frameBuffer: RadarFrame[],
): void {
  switch (message.type) {
    case 'FRAME': {
      frameBuffer.push(message.payload);
      return;
    }

    case 'ALARM': {
      useTelemetryStore.getState().pushAlarm(message.payload);
      return;
    }

    case 'CONFIG_ACK': {
      const sys = useSystemStore.getState();
      if (sys.pendingConfigId === message.payload.config_id) {
        sys.setPendingConfigId(null);
      }
      if (!message.payload.success) {
        console.error(
          '[config] APPLY_CONFIG rejected — id=%s err=%s',
          message.payload.config_id,
          message.payload.error ?? '<no message>',
        );
      }
      return;
    }

    case 'HANDSHAKE': {
      console.log(
        '[ws] handshake v%s protocol=%d mock=%s',
        message.payload.server_version,
        message.payload.protocol_version,
        message.payload.mock,
      );
      return;
    }

    default: {
      // Exhaustiveness check — schema drift caught here at compile time.
      const _exhaustive: never = message;
      console.warn('[ws] unknown message type:', _exhaustive);
      return;
    }
  }
}

/** Test/cleanup helper — reset the source-switch memory + cadence cursors. */
export function resetFrameDispatcher(): void {
  lastSource = null;
  lastTelemetryFrameId = -Infinity;
  lastSystemFrameId = -Infinity;
}
