/**
 * PPITooltip — floating tooltip pinned to the cursor when a target is hovered.
 * =============================================================================
 * Renders nothing if no target is hovered. Smart edge avoidance: flips to the
 * left of the cursor near the right viewport edge, and above the cursor near
 * the bottom.
 *
 * Visually quieter than the selected-target overlay (1px hairline border, no
 * glow) so hover and selection are visually distinct.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { RadarTarget } from '../../types/radar';

import './PPITooltip.css';

const OFFSET_PX = 14;
const VIEWPORT_MARGIN_PX = 12;

export interface PPITooltipProps {
  target: RadarTarget;
  clientX: number;
  clientY: number;
}

export function PPITooltip(props: PPITooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: props.clientX + OFFSET_PX,
    top: props.clientY + OFFSET_PX,
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = props.clientX + OFFSET_PX;
    let top = props.clientY + OFFSET_PX;
    if (left + rect.width > vw - VIEWPORT_MARGIN_PX) {
      left = props.clientX - rect.width - OFFSET_PX;
    }
    if (top + rect.height > vh - VIEWPORT_MARGIN_PX) {
      top = props.clientY - rect.height - OFFSET_PX;
    }
    setPos({ left, top });
  }, [props.clientX, props.clientY, props.target.id]);

  const t = props.target;
  const tail = t.id.split('-').pop() ?? t.id;
  const shortId = tail.slice(0, 6).toUpperCase();

  // Portal to <body>: the PPI lives inside `.aeris-layout__center`, which keeps
  // a `transform: translateY(0)` after its post-boot fade animation (forwards
  // fill). A non-`none` transform makes that element the containing block for
  // `position: fixed` descendants — so without the portal the tooltip's
  // viewport-space `left/top` would be measured from the centre panel's corner
  // (offset by the left panel width + topbar height) and land far from the
  // cursor. Rendering into <body> restores true viewport-relative positioning.
  return createPortal(
    <div
      ref={ref}
      className="ppi-tooltip"
      data-tone={t.threat_level}
      style={{ left: pos.left, top: pos.top }}
      role="tooltip"
    >
      <div className="ppi-tooltip__head">
        <span className="ppi-tooltip__id">TGT · {shortId}</span>
        <span className="ppi-tooltip__class">{t.classification.toUpperCase()}</span>
      </div>
      <div className="ppi-tooltip__grid">
        <Row label="RNG" value={formatRange(t.range_m)} />
        <Row label="BRG" value={`${t.azimuth_deg.toFixed(0)}°`} />
        <Row label="VEL" value={formatVel(t.doppler_mps)} />
        <Row label="SNR" value={`${t.snr_db.toFixed(0)} dB`} />
      </div>
      <div className="ppi-tooltip__foot" data-tone={t.threat_level}>
        {t.threat_level.toUpperCase()}
      </div>
    </div>,
    document.body,
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <div className="ppi-tooltip__row">
      <span className="ppi-tooltip__row-label">{props.label}</span>
      <span className="ppi-tooltip__row-value">{props.value}</span>
    </div>
  );
}

function formatRange(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)}km`;
  return `${m.toFixed(0)}m`;
}

function formatVel(mps: number): string {
  const sign = mps > 0 ? '+' : '';
  return `${sign}${mps.toFixed(1)}m/s`;
}
