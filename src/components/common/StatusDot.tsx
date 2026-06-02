/**
 * StatusDot — animated SVG status indicator.
 * =============================================================================
 * Replaces Unicode bullets (●, ◐, ○) with a real glyph: filled inner disk +
 * outer halo ring. Tones map to semantic colour vars. Optional `pulse` adds
 * a 2.2 s expand-and-fade ring overlay for "active" states.
 *
 *   <StatusDot tone="nominal" pulse />
 *   <StatusDot tone="critical" size={12} />
 *
 * Use it everywhere a connection / health / activity indicator is needed.
 */

import './StatusDot.css';

export type StatusTone =
  | 'nominal'
  | 'info'
  | 'caution'
  | 'critical'
  | 'violet'
  | 'dim';

export interface StatusDotProps {
  tone: StatusTone;
  size?: number;
  /** Add an outer expand-fade ring animation. */
  pulse?: boolean;
  /** Add a soft permanent glow. Combine with pulse for SCANNING states. */
  glow?: boolean;
  className?: string;
  label?: string;
}

export function StatusDot(props: StatusDotProps) {
  const size = props.size ?? 10;
  const half = size / 2;
  const inner = size * 0.28;
  const ring = size * 0.42;

  return (
    <span
      className={`status-dot ${props.className ?? ''}`}
      data-tone={props.tone}
      data-pulse={props.pulse ? 'true' : undefined}
      data-glow={props.glow ? 'true' : undefined}
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="status-dot__svg"
      >
        <circle
          cx={half}
          cy={half}
          r={ring}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          opacity={0.45}
          className="status-dot__halo"
        />
        <circle
          cx={half}
          cy={half}
          r={inner}
          fill="currentColor"
          className="status-dot__core"
        />
      </svg>
    </span>
  );
}
