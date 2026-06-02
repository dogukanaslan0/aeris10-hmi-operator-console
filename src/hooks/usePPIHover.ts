/**
 * usePPIHover — track mouse over the PPI canvas, hit-test, expose hovered target.
 * =============================================================================
 * Throttled to one update per browser paint (requestAnimationFrame). The
 * mouse can move at 1000 Hz on high-DPI trackpads; we only care about the
 * latest position at render time.
 *
 *   const hover = usePPIHover(canvasRef);
 *   if (hover.target !== null) {
 *     // render <PPITooltip target={hover.target} x={hover.clientX} y={hover.clientY} />
 *   }
 *
 * Hit test reuses the same polarToCanvas + HIT_RADIUS_PX as click selection,
 * so what the operator hovers is exactly what a click would select.
 */

import { useEffect, useRef, useState } from 'react';

import { useTargetStore } from '../stores/radarStore';
import { useSystemStore } from '../stores/systemStore';
import { polarToCanvas } from '../lib/polarMath';
import type { RadarTarget } from '../types/radar';

const HIT_RADIUS_PX = 14;
const CANVAS_MARGIN_PX = 32;

export interface PPIHoverState {
  target: RadarTarget | null;
  clientX: number;
  clientY: number;
  active: boolean;
}

export function usePPIHover(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): PPIHoverState {
  const [state, setState] = useState<PPIHoverState>({
    target: null,
    clientX: 0,
    clientY: 0,
    active: false,
  });
  const rafIdRef = useRef<number>(0);
  const lastEventRef = useRef<MouseEvent | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const flush = (): void => {
      rafIdRef.current = 0;
      const e = lastEventRef.current;
      if (e === null) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const maxR = Math.max(
        0,
        Math.min(rect.width, rect.height) / 2 - CANVAS_MARGIN_PX,
      );

      const ts = useTargetStore.getState();
      const rangeScale = useSystemStore.getState().radarRangeScale;

      let best: RadarTarget | null = null;
      let bestDist = Infinity;
      for (const target of ts.targets.values()) {
        // Off-scope targets aren't drawn, so they can't be hovered either.
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
          best = target;
          bestDist = dist;
        }
      }

      setState({
        target: best,
        clientX: e.clientX,
        clientY: e.clientY,
        active: true,
      });
    };

    const onMove = (e: MouseEvent): void => {
      lastEventRef.current = e;
      if (rafIdRef.current === 0) {
        rafIdRef.current = window.requestAnimationFrame(flush);
      }
    };

    const onLeave = (): void => {
      lastEventRef.current = null;
      if (rafIdRef.current !== 0) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      setState((s) => ({ ...s, target: null, active: false }));
    };

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);

    return () => {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      if (rafIdRef.current !== 0) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
    };
  }, [canvasRef]);

  return state;
}
