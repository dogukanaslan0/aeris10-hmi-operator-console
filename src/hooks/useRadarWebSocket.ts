/**
 * useRadarWebSocket — the canonical, singleton-pattern WebSocket bridge.
 * =============================================================================
 * Responsibilities:
 *
 *   - Open one WebSocket connection per URL across the entire app lifetime.
 *   - Parse every inbound message envelope and dispatch via frameDispatcher.
 *   - Buffer FRAME payloads and flush only the latest per requestAnimationFrame
 *     tick — back-pressure prevents a backlog from accumulating when the tab
 *     was hidden or the main thread stalled.
 *   - Reconnect with exponential backoff (1s → 2s → 4s → 8s → 16s → 30s cap).
 *   - Surface a `shouldUseMock` flag that `useMockEngine` watches — engaged
 *     after the first failed open so dev sessions never sit blank.
 *   - Expose `send(command)` for upstream commands (APPLY_CONFIG, ACK_ALARM,
 *     ANNOTATE_TARGET, START_SCAN, STOP_SCAN). Returns `false` if the socket
 *     is not open — callers should handle that case (typically by clearing
 *     any "pending" state in the UI).
 *
 * Singleton scope: a module-level Map keyed by URL. Multiple components can
 * call this hook with the same URL and they will share one underlying socket.
 *
 *   const ws = useRadarWebSocket('ws://localhost:8765/ws/radar');
 *   ws.send({ type: 'APPLY_CONFIG', config_id: '...', payload: { ... } });
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import {
  applyRadarFrame,
  dispatchWebSocketMessage,
} from '../lib/frameDispatcher';
import type {
  RadarFrame,
  WebSocketCommand,
  WebSocketMessage,
} from '../types/radar';

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC TYPES
// ════════════════════════════════════════════════════════════════════════════

export type WebSocketHookStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closed';

export interface UseRadarWebSocketState {
  status: WebSocketHookStatus;
  /** Consecutive failed connection attempts since the last successful open. */
  attemptCount: number;
  lastError: string | null;
  /** True when the upstream is unreachable — useMockEngine watches this. */
  shouldUseMock: boolean;
}

export interface UseRadarWebSocketResult extends UseRadarWebSocketState {
  /** Send a command upstream. Returns false if the socket isn't open. */
  send: (command: WebSocketCommand) => boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// MANAGER (one per URL, lazy-initialised)
// ════════════════════════════════════════════════════════════════════════════

const INITIAL_CONNECT_TIMEOUT_MS = 3_000;
const BACKOFF_SEQUENCE_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

class RadarWebSocketManager {
  private readonly url: string;
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private connectTimer: number | null = null;
  private rafId: number = 0;
  private readonly frameBuffer: RadarFrame[] = [];
  private readonly listeners = new Set<(state: UseRadarWebSocketState) => void>();
  private state: UseRadarWebSocketState = {
    status: 'idle',
    attemptCount: 0,
    lastError: null,
    shouldUseMock: false,
  };
  private disposed = false;

  constructor(url: string) {
    this.url = url;
    this.startFlushLoop();
    this.connect();
  }

  // ── Public surface ──────────────────────────────────────────────────────

  getSnapshot(): UseRadarWebSocketState {
    return this.state;
  }

  subscribe(listener: (state: UseRadarWebSocketState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  send(command: WebSocketCommand): boolean {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    try {
      this.ws.send(JSON.stringify(command));
      return true;
    } catch (err) {
      console.warn('[ws] send failed', asErrorMessage(err));
      return false;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.connectTimer !== null) window.clearTimeout(this.connectTimer);
    if (this.rafId !== 0) window.cancelAnimationFrame(this.rafId);
    if (this.ws !== null) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  private connect(): void {
    if (this.disposed) return;

    this.setState({ status: 'connecting' });

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.handleConnectionFailure(asErrorMessage(err));
      return;
    }
    this.ws = ws;

    this.connectTimer = window.setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    }, INITIAL_CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (this.connectTimer !== null) {
        window.clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      this.setState({
        status: 'open',
        attemptCount: 0,
        lastError: null,
        shouldUseMock: false,
      });
    };

    ws.onmessage = (event: MessageEvent<string | ArrayBuffer | Blob>) => {
      if (typeof event.data !== 'string') {
        console.warn('[ws] dropping non-string payload');
        return;
      }
      try {
        const parsed = JSON.parse(event.data) as WebSocketMessage;
        dispatchWebSocketMessage(parsed, this.frameBuffer);
      } catch (err) {
        console.warn('[ws] parse error', asErrorMessage(err));
      }
    };

    ws.onerror = () => {
      this.setState({ lastError: 'socket error' });
    };

    ws.onclose = (event: CloseEvent) => {
      if (this.connectTimer !== null) {
        window.clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      this.ws = null;

      if (this.disposed) return;
      this.handleConnectionFailure(event.reason || this.state.lastError || 'closed');
    };
  }

  private handleConnectionFailure(reason: string): void {
    const attemptCount = this.state.attemptCount + 1;
    const backoffIdx = Math.min(attemptCount - 1, BACKOFF_SEQUENCE_MS.length - 1);
    const delay = BACKOFF_SEQUENCE_MS[backoffIdx];

    this.setState({
      status: 'closed',
      attemptCount,
      lastError: reason,
      shouldUseMock: true,
    });

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // ── rAF flush loop ──────────────────────────────────────────────────────

  private startFlushLoop(): void {
    const flush = (): void => {
      if (this.disposed) return;
      if (this.frameBuffer.length > 0) {
        const latest = this.frameBuffer[this.frameBuffer.length - 1];
        this.frameBuffer.length = 0;
        applyRadarFrame(latest);
      }
      this.rafId = window.requestAnimationFrame(flush);
    };
    this.rafId = window.requestAnimationFrame(flush);
  }

  // ── State mgmt ──────────────────────────────────────────────────────────

  private setState(partial: Partial<UseRadarWebSocketState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REGISTRY
// ════════════════════════════════════════════════════════════════════════════

const managers = new Map<string, RadarWebSocketManager>();

function acquireManager(url: string): RadarWebSocketManager {
  let mgr = managers.get(url);
  if (mgr === undefined) {
    mgr = new RadarWebSocketManager(url);
    managers.set(url, mgr);
  }
  return mgr;
}

/** Test-only: dispose every active manager. */
export function disposeAllRadarWebSockets(): void {
  for (const mgr of managers.values()) {
    mgr.dispose();
  }
  managers.clear();
}

// ════════════════════════════════════════════════════════════════════════════
// HOOK
// ════════════════════════════════════════════════════════════════════════════

export function useRadarWebSocket(url: string): UseRadarWebSocketResult {
  useEffect(() => {
    acquireManager(url);
  }, [url]);

  const state = useSyncExternalStore(
    (listener) => acquireManager(url).subscribe(listener),
    () => acquireManager(url).getSnapshot(),
    () => acquireManager(url).getSnapshot(),
  );

  const send = useCallback(
    (command: WebSocketCommand) => acquireManager(url).send(command),
    [url],
  );

  return { ...state, send };
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function asErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown error';
}
