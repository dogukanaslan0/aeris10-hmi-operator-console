/**
 * WebSocket endpoint configuration.
 * =============================================================================
 * Resolved at build/dev time from `VITE_WS_URL` (set via `.env.local` or the
 * shell environment). Falls back to the local Python bridge default.
 *
 *   echo 'VITE_WS_URL=ws://10.0.1.42:8765/ws/radar' >> .env.local
 */

const FALLBACK_WS_URL = 'ws://localhost:8765/ws/radar';

export const WS_URL: string = import.meta.env.VITE_WS_URL ?? FALLBACK_WS_URL;
