/**
 * ConnectionPanel — Section A of the command panel.
 * =============================================================================
 * WebSocket endpoint, transport status, latency, source classification.
 * Pulls from useSystemStore (latency) + useRadarWebSocket (status + source).
 */

import { useSystemStore } from '../../stores/systemStore';
import { useRadarWebSocket } from '../../hooks/useRadarWebSocket';
import type { WebSocketHookStatus } from '../../hooks/useRadarWebSocket';
import { WS_URL } from '../../lib/wsConfig';

type Tone = 'nominal' | 'info' | 'caution' | 'critical' | 'dim';

export function ConnectionPanel() {
  const ws = useRadarWebSocket(WS_URL);
  const system = useSystemStore((s) => s.current);

  const latencyMs = system !== null
    ? Math.max(0, Date.now() - system.server_timestamp_ms)
    : null;
  const latencyTone: Tone =
    latencyMs === null ? 'dim'
      : latencyMs < 500 ? 'nominal'
      : latencyMs < 2_000 ? 'caution'
      : 'critical';
  const latencyLabel = latencyMs !== null ? `${latencyMs} ms` : '—';

  const sourceLabel = ws.shouldUseMock
    ? 'MOCK ENGINE'
    : ws.status === 'open'
      ? 'LIVE HARDWARE'
      : 'OFFLINE';

  return (
    <div className="conn-panel">
      <div className="conn-panel__url">{WS_URL}</div>

      <div className="conn-panel__stats">
        <Stat
          label="STATUS"
          value={ws.status.toUpperCase()}
          tone={statusTone(ws.status)}
        />
        <Stat label="LATENCY" value={latencyLabel} tone={latencyTone} />
      </div>

      <div className="conn-panel__source">
        Source: <strong>{sourceLabel}</strong>
      </div>

      {ws.lastError !== null && ws.status !== 'open' && (
        <div className="conn-panel__error">⚠ {ws.lastError}</div>
      )}
    </div>
  );
}

function Stat(props: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="conn-panel__stat" data-tone={props.tone}>
      <span className="conn-panel__stat-label">{props.label}</span>
      <span className="conn-panel__stat-value">{props.value}</span>
    </div>
  );
}

function statusTone(status: WebSocketHookStatus): Tone {
  switch (status) {
    case 'open': return 'nominal';
    case 'connecting': return 'info';
    case 'closed': return 'critical';
    case 'idle': return 'dim';
  }
}
