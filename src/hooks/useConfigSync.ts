/**
 * useConfigSync — debounced APPLY_CONFIG dispatcher.
 * =============================================================================
 * Watches `useSystemStore.config`. Whenever it changes, schedules a debounced
 * APPLY_CONFIG command over the WebSocket. If the operator keeps tweaking
 * sliders, only the *final* value is sent.
 *
 * Mounted once at App level so all sliders share a single debounce window —
 * adjusting azimuth then range produces ONE command, not two.
 *
 * `useRadarWebSocket().send` is a stable callback (useCallback inside the
 * hook), so this effect re-runs only when the config object actually changes.
 *
 * Mock mode behaviour: `send()` returns false (socket not open). We clear
 * `pendingConfigId` so the UI doesn't appear to be awaiting an ACK that will
 * never arrive.
 */

import { useEffect } from 'react';

import { useSystemStore } from '../stores/systemStore';
import { useRadarWebSocket } from './useRadarWebSocket';
import { WS_URL } from '../lib/wsConfig';

const DEBOUNCE_MS = 300;

export function useConfigSync(): void {
  const config = useSystemStore((s) => s.config);
  const setPendingConfigId = useSystemStore((s) => s.setPendingConfigId);
  const { send } = useRadarWebSocket(WS_URL);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const id = makeUuid();
      setPendingConfigId(id);
      const ok = send({
        type: 'APPLY_CONFIG',
        config_id: id,
        payload: config,
      });
      if (!ok) {
        setPendingConfigId(null);
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [config, setPendingConfigId, send]);
}

function makeUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
