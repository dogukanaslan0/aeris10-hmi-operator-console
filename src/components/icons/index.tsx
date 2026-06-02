/**
 * AERIS-10 Icon Library — line-based tactical glyphs.
 * =============================================================================
 * 1.5 px stroke, 16×16 viewport, currentColor stroke.
 * Override `size` for chrome (TopBar uses 14, section headers 12).
 *
 * Every icon is `aria-hidden` by default — pair with a `<span class="sr-only">`
 * or `aria-label` on the parent for screen readers.
 *
 * Geometric, monoline, deliberately under-decorated. Designed to read at
 * 11-14 px without losing fidelity (no fills, no gradients, no curves under
 * 1 px). Stroke joins are rounded for the operator-terminal feel.
 */

import type { SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
  strokeWidth?: number;
}

function base(props: IconProps) {
  const { size = 16, strokeWidth = 1.5, ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...rest,
  };
}

// ── Brand / identity ────────────────────────────────────────────────────────

export function IconBrand(props: IconProps) {
  return (
    <svg {...base(props)}>
      <defs>
        <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c7ccd4" />
          <stop offset="100%" stopColor="#8d93a1" />
        </linearGradient>
      </defs>
      {/* Outer Abstract Hexagonal Brackets / Target Box (Faceted Stealth Alignment) */}
      <path d="M4.5 1.5 L1.5 4.5 V11.5 L4.5 14.5" stroke="url(#brandGrad)" strokeWidth={1.0} strokeOpacity={0.35} />
      <path d="M11.5 1.5 L14.5 4.5 V11.5 L14.5 14.5" stroke="url(#brandGrad)" strokeWidth={1.0} strokeOpacity={0.35} />
      
      {/* Sleek, Supersonic Faceted Stealth Delta Wing (Corporate Monolith) */}
      <path d="M8 2 L13 11 L8 9.25 L3 11 Z" stroke="url(#brandGrad)" strokeWidth={1.1} fill="url(#brandGrad)" fillOpacity="0.09" />
      
      {/* Center Precision Telemetry Emitter Line / Lock Axis */}
      <line x1="8" y1="2.25" x2="8" y2="9.0" stroke="#c7ccd4" strokeWidth={0.9} opacity="0.65" />
      <line x1="6.0" y1="7.75" x2="10.0" y2="7.75" stroke="#c7ccd4" strokeWidth={0.9} opacity="0.65" />
    </svg>
  );
}

// ── Connectivity ────────────────────────────────────────────────────────────

export function IconLink(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6.5 9.5 L 9.5 6.5" />
      <path d="M5.5 11 a 2.5 2.5 0 0 1 0 -3.5 L 7 6 a 2.5 2.5 0 0 1 3.5 0" />
      <path d="M10.5 5 a 2.5 2.5 0 0 1 0 3.5 L 9 10 a 2.5 2.5 0 0 1 -3.5 0" />
    </svg>
  );
}

export function IconWifi(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 6.5 a 8 8 0 0 1 11 0" />
      <path d="M4.5 8.5 a 5 5 0 0 1 7 0" />
      <path d="M6.5 10.5 a 2 2 0 0 1 3 0" />
      <circle cx="8" cy="13" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ── Hardware / electronics ──────────────────────────────────────────────────

export function IconChip(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="4" width="8" height="8" rx="0.5" />
      <rect x="6" y="6" width="4" height="4" />
      <path d="M5 2 L 5 4 M 8 2 L 8 4 M 11 2 L 11 4" />
      <path d="M5 12 L 5 14 M 8 12 L 8 14 M 11 12 L 11 14" />
      <path d="M2 5 L 4 5 M 2 8 L 4 8 M 2 11 L 4 11" />
      <path d="M12 5 L 14 5 M 12 8 L 14 8 M 12 11 L 14 11" />
    </svg>
  );
}

export function IconAntenna(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2" y="2.5" width="12" height="11" rx="0.5" />
      <circle cx="5" cy="5.5" r="0.6" />
      <circle cx="8" cy="5.5" r="0.6" />
      <circle cx="11" cy="5.5" r="0.6" />
      <circle cx="5" cy="8" r="0.6" />
      <circle cx="8" cy="8" r="0.6" />
      <circle cx="11" cy="8" r="0.6" />
      <circle cx="5" cy="10.5" r="0.6" />
      <circle cx="8" cy="10.5" r="0.6" />
      <circle cx="11" cy="10.5" r="0.6" />
    </svg>
  );
}

export function IconWaveform(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M1.5 8 L 3.5 8 L 5 4 L 7 12 L 9 4 L 11 12 L 12.5 8 L 14.5 8" />
    </svg>
  );
}

// ── Sensors / telemetry ─────────────────────────────────────────────────────

export function IconThermal(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 10 V 3.5 a 1.5 1.5 0 0 1 3 0 V 10" />
      <circle cx="9.5" cy="12" r="2" />
      <path d="M5 5.5 L 7 5.5 M 5 8 L 7 8" />
    </svg>
  );
}

export function IconCurrent(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 1.5 L 4 9 H 8 L 6.5 14.5 L 12 7 H 8 Z" />
    </svg>
  );
}

export function IconGps(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="5" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="M8 1.5 V 3.5 M 8 12.5 V 14.5 M 1.5 8 H 3.5 M 12.5 8 H 14.5" />
    </svg>
  );
}

export function IconCompass(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5 L 9.5 9 L 8 11 L 6.5 9 Z" fill="currentColor" />
      <circle cx="8" cy="2.5" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ── Time / clock ────────────────────────────────────────────────────────────

export function IconClock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.5 V 8 L 10.5 9.5" />
    </svg>
  );
}

// ── Status / alerts ─────────────────────────────────────────────────────────

export function IconAlert(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 2 L 14.5 13 H 1.5 Z" />
      <path d="M8 6.5 V 9.5" />
      <circle cx="8" cy="11.5" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconShield(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 1.5 L 13 3.5 V 8 a 6 6 0 0 1 -5 6 a 6 6 0 0 1 -5 -6 V 3.5 Z" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 8.5 L 6.5 12 L 13 4.5" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 4 L 12 12 M 12 4 L 4 12" />
    </svg>
  );
}

// ── Radar / scanning ────────────────────────────────────────────────────────

export function IconScan(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="6" opacity="0.4" />
      <circle cx="8" cy="8" r="3.5" opacity="0.7" />
      <path d="M8 8 L 13 4" />
      <circle cx="8" cy="8" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconTarget(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5 V 4 M 8 12 V 14.5 M 1.5 8 H 4 M 12 8 H 14.5" />
    </svg>
  );
}

export function IconBeam(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="3" cy="8" r="1.5" />
      <path d="M4.5 8 L 14 4" />
      <path d="M4.5 8 L 14 12" />
      <path d="M4.5 8 L 14 8" opacity="0.5" />
    </svg>
  );
}

// ── Power / system ──────────────────────────────────────────────────────────

export function IconPower(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 4 a 5 5 0 1 0 6 0" />
      <path d="M8 1.5 V 8" />
    </svg>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 2 L 14 5 L 8 8 L 2 5 Z" />
      <path d="M2 8 L 8 11 L 14 8" opacity="0.6" />
      <path d="M2 11 L 8 14 L 14 11" opacity="0.4" />
    </svg>
  );
}

// ── Navigation indicators ───────────────────────────────────────────────────

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 6 L 8 11 L 13 6" />
    </svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 3 L 11 8 L 6 13" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6.5" cy="6.5" r="3.5" />
      <path d="M9 9 L 13.5 13.5" />
    </svg>
  );
}

