/**
 * StatusOrb — cinematic 3D-ish status indicator.
 * =============================================================================
 * The next size up from StatusDot. Use it where you need the operator's eye
 * to land first — TopBar connection badge, dashboard hero status, FAULT
 * callouts. Composed of:
 *
 *   - halo:  radial gradient that breathes (or pulses for active states)
 *   - core:  3D-ish sphere via off-centre radial gradient + inset shadow
 *   - glint: small specular highlight, pinned upper-left of the core
 *
 * All three layers tint with `currentColor`, so a single `data-tone` swaps
 * the entire orb's mood.
 */

import './StatusOrb.css';

export type StatusOrbTone =
  | 'nominal'
  | 'info'
  | 'caution'
  | 'critical'
  | 'violet'
  | 'dim';

export interface StatusOrbProps {
  tone: StatusOrbTone;
  size?: number;
  /** Add the breathing halo animation (default: true for non-dim tones). */
  pulse?: boolean;
  /** ARIA label — when set, the orb becomes a status image instead of decor. */
  label?: string;
}

export function StatusOrb(props: StatusOrbProps) {
  const size = props.size ?? 16;
  const pulse = props.pulse ?? props.tone !== 'dim';

  return (
    <span
      className="status-orb"
      data-tone={props.tone}
      data-pulse={pulse || undefined}
      role={props.label !== undefined ? 'img' : undefined}
      aria-label={props.label}
      aria-hidden={props.label === undefined || undefined}
      style={{ width: size, height: size }}
    >
      <span className="status-orb__halo" />
      <span className="status-orb__core" />
      <span className="status-orb__glint" />
    </span>
  );
}
