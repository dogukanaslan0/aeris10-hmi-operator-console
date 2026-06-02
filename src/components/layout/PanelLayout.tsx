/**
 * ============================================================================
 * AERIS-10 Command & Control (C2) Tactical Console
 * ────────────────────────────────────────────────────────────────────────────
 * SYSTEM COMPONENT      : Main UI Panel Grid Shell Layout
 * ARCHITECT & DEVELOPER : Doğukan Aslan
 * LICENSE               : Proprietary / Community Shared Release
 * VERSION               : 1.0.0 (Nexus Active Deployment)
 * ============================================================================
 */

import type { ReactNode } from 'react';
import { useSystemStore } from '../../stores/systemStore';

import './PanelLayout.css';

export interface PanelLayoutProps {
  topBar: ReactNode;
  leftPanel: ReactNode;
  centerPanel: ReactNode;
  rightPanel: ReactNode;
  statusBar: ReactNode;
  booted?: boolean;
}

export function PanelLayout(props: PanelLayoutProps) {
  const layoutPreset = useSystemStore((s) => s.layoutPreset);

  return (
    <div
      className="aeris-layout"
      data-booted={props.booted ? "true" : "false"}
      data-layout={layoutPreset}
    >
      <header className="aeris-layout__topbar">{props.topBar}</header>
      <aside className="aeris-layout__left" data-panel="left">
        {props.leftPanel}
      </aside>
      <main className="aeris-layout__center" data-panel="center">
        {props.centerPanel}
      </main>
      <aside className="aeris-layout__right" data-panel="right">
        {props.rightPanel}
      </aside>
      <footer className="aeris-layout__statusbar">{props.statusBar}</footer>
    </div>
  );
}
