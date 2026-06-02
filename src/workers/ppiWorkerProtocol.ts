/**
 * PPI Worker — message protocol.
 * =============================================================================
 * Shared between the React side (PPICanvas.tsx) and the worker side
 * (ppiWorker.ts). Single source of truth for transferred message shapes.
 *
 * Notes:
 *   - INIT must be sent EXACTLY once. OffscreenCanvas handoff is one-way.
 *   - TARGETS sends a flat array, not a Map — structured-clone-friendly and
 *     iteration-efficient on the worker side.
 *   - TRAILS is a record keyed by target id, mirroring `targetHistory`.
 *   - Resize is reported in CSS pixels; the worker multiplies by `dpr`
 *     internally to set the drawing buffer size.
 */

import type { RadarTarget } from '../types/radar';

export type WorkerInboundMessage =
  | {
      type: 'INIT';
      canvas: OffscreenCanvas;
      width: number;
      height: number;
      dpr: number;
    }
  | {
      type: 'RESIZE';
      width: number;
      height: number;
      dpr: number;
    }
  | {
      type: 'TARGETS';
      targets: RadarTarget[];
    }
  | {
      type: 'TRAILS';
      trails: Record<string, RadarTarget[]>;
    }
  | {
      type: 'SELECTION';
      id: string | null;
    }
  | {
      type: 'BEAM';
      azimuth_deg: number;
    }
  | {
      type: 'RANGE_SCALE';
      metres: number;
    }
  | {
      type: 'CURSOR';
      x: number | null;
      y: number | null;
    }
  | {
      type: 'MAP_MODE';
      enabled: boolean;
    }
  | {
      type: 'TEARDOWN';
    };

export type WorkerOutboundMessage =
  | { type: 'READY' }
  | { type: 'PAINT_TIMING'; frame_ms: number };
