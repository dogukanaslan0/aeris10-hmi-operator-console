/**
 * ============================================================================
 * AERIS-10 Command & Control (C2) Tactical Console
 * ────────────────────────────────────────────────────────────────────────────
 * SYSTEM COMPONENT      : Left Command Center Panel Composition
 * ARCHITECT & DEVELOPER : Doğukan Aslan
 * LICENSE               : Proprietary / Community Shared Release
 * VERSION               : 1.0.0 (Nexus Active Deployment)
 * ============================================================================
 */

import { ReactNode } from 'react';

import { useSystemStore } from '../../stores/systemStore';
import { SectionHeader } from '../common/SectionHeader';
import { IconAntenna, IconBeam } from '../icons';

import { OCXOBoot } from './OCXOBoot';
import { BeamControl } from './BeamControl';
import { RadarConfig } from './RadarConfig';

import './CommandPanel.css';

export function CommandPanel() {
  const mode = useSystemStore((s) => s.layoutPreset);

  return (
    <div className="cmd-panel" data-mode={mode}>
      <OCXOBoot />

      <Section
        header={
          <SectionHeader
            index="01"
            icon={<IconBeam size={12} />}
            label="Beam Steering"
            tone="violet"
          />
        }
      >
        <BeamControl />
      </Section>

      <Section
        header={
          <SectionHeader
            index="02"
            icon={<IconAntenna size={12} />}
            label="Radar Configuration"
          />
        }
      >
        <RadarConfig />
      </Section>
    </div>
  );
}

interface SectionProps {
  header: ReactNode;
  children: ReactNode;
  dense?: boolean;
}

function Section({ header, children, dense }: SectionProps) {
  return (
    <section className="cmd-section" data-dense={dense}>
      {header}
      <div className="cmd-section__body">{children}</div>
    </section>
  );
}
