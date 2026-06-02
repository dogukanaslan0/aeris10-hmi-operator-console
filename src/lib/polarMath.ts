/**
 * Polar / canvas coordinate utilities — shared by main thread (hit tests)
 * and worker (drawing) so both agree on the projection.
 *
 * Convention:
 *   - Azimuth 0° = north (canvas up), increasing clockwise.
 *   - Canvas math angle is measured from +X axis (east) clockwise (positive
 *     direction because canvas Y is inverted).
 *   - The math-angle equivalent of an azimuth is `(azimuth - 90) * π / 180`.
 */

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Project a polar target position onto canvas pixels.
 *
 * Targets beyond `rangeScale` are clamped to the outer ring rather than
 * dropped — they stay visually anchored at the edge instead of disappearing.
 */
export function polarToCanvas(
  range_m: number,
  azimuth_deg: number,
  centerX: number,
  centerY: number,
  maxRadius: number,
  rangeScale: number,
): CanvasPoint {
  const clampedRange = Math.min(Math.max(0, range_m), rangeScale);
  const radius = rangeScale > 0 ? (clampedRange / rangeScale) * maxRadius : 0;
  const angle_rad = ((azimuth_deg - 90) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(angle_rad),
    y: centerY + radius * Math.sin(angle_rad),
  };
}

/** Wrap any angle into [0, 360). */
export function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Signed shortest angular distance from `from` to `to`, in [-180, 180]. */
export function shortestAngleDiff(from: number, to: number): number {
  let diff = ((to - from) % 360 + 540) % 360 - 180;
  if (diff === -180) diff = 180;
  return diff;
}

/** Convert a 7-char `#RRGGBB` to `rgba(r, g, b, alpha)`. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
