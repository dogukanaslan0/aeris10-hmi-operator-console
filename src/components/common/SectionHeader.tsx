/**
 * SectionHeader — uniform tactical panel section heading.
 * =============================================================================
 * Replaces ad-hoc <h2 class="cmd-section__title"> with a structured component:
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ 03  ▣  BEAM STEERING ───────────────────  active     │
 *   └──────────────────────────────────────────────────────┘
 *      │   │   │                              │
 *      │   │   │                              └─ trailing slot
 *      │   │   └─ label (uppercase, tracked)
 *      │   └─ icon (Icon* component)
 *      └─ index badge ("01"/"02"/.../"99")
 *
 * Numbering aids quick operator reference ("section 03 needs attention").
 */

import type { ReactNode } from 'react';

import './SectionHeader.css';

export interface SectionHeaderProps {
  index?: string;
  icon?: ReactNode;
  label: string;
  trailing?: ReactNode;
  /** Optional accent tone for the index + icon (default: dim). */
  tone?: 'nominal' | 'info' | 'caution' | 'critical' | 'violet' | 'dim';
}

export function SectionHeader(props: SectionHeaderProps) {
  return (
    <header className="section-header" data-tone={props.tone ?? 'dim'}>
      {props.index !== undefined && (
        <span className="section-header__index">{props.index}</span>
      )}
      {props.icon !== undefined && (
        <span className="section-header__icon">{props.icon}</span>
      )}
      <h2 className="section-header__label">{props.label}</h2>
      <span className="section-header__rule" aria-hidden />
      {props.trailing !== undefined && (
        <span className="section-header__trailing">{props.trailing}</span>
      )}
    </header>
  );
}
