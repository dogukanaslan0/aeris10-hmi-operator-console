/**
 * CornerBrackets — tactical L-shapes pinned to a container's four corners.
 * =============================================================================
 * Pure decoration. Apply to any container with `position: relative`.
 *
 *   <div style={{ position: 'relative' }}>
 *     <CornerBrackets bindToConnection />
 *     ... content ...
 *   </div>
 *
 * With `bindToConnection`, the bracket tone follows the live system
 * connection state — SCANNING → green, FAULT → red, OCXO_WARMUP → violet,
 * etc. Use this on the PPI wrapper to make the radar "feel alive".
 *
 * Without it, pass an explicit `tone` for a static frame.
 */

import { useSystemStore } from '../../stores/systemStore';
import type { ConnectionState } from '../../types/radar';

import './CornerBrackets.css';

export type CornerBracketsTone =
  | 'cyan'
  | 'green'
  | 'amber'
  | 'red'
  | 'violet'
  | 'dim';

export interface CornerBracketsProps {
  /** Bracket arm length in px. */
  size?: number;
  /** Bracket stroke thickness in px. */
  thickness?: number;
  /** Inset from container edge in px. */
  inset?: number;
  /** Static tone — ignored when `bindToConnection` is true. */
  tone?: CornerBracketsTone;
  /** Reactive: tone follows useSystemStore.current.connection. */
  bindToConnection?: boolean;
  /** Opacity, default 0.55. */
  opacity?: number;
}

export function CornerBrackets(props: CornerBracketsProps) {
  // Always subscribe (hook rules); only use the value when bindToConnection
  // is true. Cheap selector — the system store updates at ~2 Hz.
  const connection = useSystemStore((s) => s.current?.connection ?? null);

  const size = props.size ?? 12;
  const thickness = props.thickness ?? 1;
  const inset = props.inset ?? 6;
  const opacity = props.opacity ?? 0.55;

  const tone: CornerBracketsTone =
    props.bindToConnection === true && connection !== null
      ? mapConnectionToTone(connection)
      : props.tone ?? 'cyan';

  const style = {
    '--cb-size': `${size}px`,
    '--cb-thickness': `${thickness}px`,
    '--cb-inset': `${inset}px`,
    '--cb-opacity': String(opacity),
  } as React.CSSProperties;

  return (
    <div
      className="corner-brackets"
      data-tone={tone}
      data-reactive={props.bindToConnection ? 'true' : undefined}
      style={style}
      aria-hidden
    >
      <span className="corner-brackets__tl" />
      <span className="corner-brackets__tr" />
      <span className="corner-brackets__bl" />
      <span className="corner-brackets__br" />
    </div>
  );
}

function mapConnectionToTone(state: ConnectionState): CornerBracketsTone {
  switch (state) {
    case 'SCANNING':     return 'green';
    case 'ARMED':        return 'cyan';
    case 'CONNECTING':   return 'cyan';
    case 'OCXO_WARMUP':  return 'violet';
    case 'FAULT':        return 'red';
    case 'MOCK':         return 'amber';
    case 'DISCONNECTED': return 'dim';
    default:             return 'cyan';
  }
}
