import type { ReactNode } from 'react';

import { useSystemStore } from '../../stores/systemStore';
import { useTelemetryStore } from '../../stores/telemetryStore';
import { SectionHeader } from '../common/SectionHeader';
import { IconAlert, IconChip, IconCurrent, IconTarget } from '../icons';

import { TargetList } from '../command/TargetList';
import { AGCStatus } from './AGCStatus';
import { AlarmFeed } from './AlarmFeed';
import { PACurrentGrid } from './PACurrentGrid';

import './TelemetryPanel.css';

function useSensorTelemetryAvailable(): boolean {
  return useTelemetryStore((s) => {
    const t = s.current;
    if (t === null) return true;
    return !(
      t.thermistors_c.every((v) => v === 0) &&
      t.pa_currents_ma.every((v) => v === 0)
    );
  });
}

export function TelemetryPanel() {
  const mode = useSystemStore((s) => s.layoutPreset);
  const sensorsAvailable = useSensorTelemetryAvailable();
  const alarmCount = useTelemetryStore(
    (s) => s.alarms.filter((a) => !a.acknowledged).length,
  );

  const targetSection = (
    <Section
      key="target"
      header={<SectionHeader index="04" icon={<IconTarget size={12} />} label="Target List" />}
      dense
    >
      <TargetList />
    </Section>
  );

  const paSection = (
    <Section
      key="pa"
      header={
        <SectionHeader
          index="05"
          icon={<IconCurrent size={12} />}
          label="PA Currents"
          trailing="16ch - 8 zones"
        />
      }
    >
      <PACurrentGrid />
    </Section>
  );

  const agcSection = (
    <Section
      key="agc"
      header={<SectionHeader index="06" icon={<IconChip size={12} />} label="AGC" trailing="0x28-0x2C" />}
    >
      <AGCStatus />
    </Section>
  );

  const orderedSections =
    mode === 'diagnostic'
      ? [paSection, agcSection, targetSection]
      : [targetSection, paSection, agcSection];

  return (
    <div className="tlm-panel" data-mode={mode}>
      <div className="tlm-fixed-alarm-container">
        <SectionHeader
          index="07"
          icon={<IconAlert size={12} />}
          label="Alarm Feed"
          tone={alarmCount > 0 ? 'critical' : 'dim'}
          trailing={alarmCount > 0 ? `${alarmCount} active` : 'standby'}
        />
        <div className="tlm-fixed-alarm-container__body">
          <AlarmFeed />
        </div>
      </div>

      <div className="tlm-scroll-container">
        {!sensorsAvailable && (
          <div className="tlm-sensor-banner" role="status">
            <span className="tlm-sensor-banner__icon" aria-hidden>
              <IconAlert size={13} />
            </span>
            <div className="tlm-sensor-banner__text">
              <strong>Sensor Data Unavailable</strong>
              <span>
                STM32 firmware does not pipe thermistor / PA / IMU / baro
                values over the FPGA USB channel. Cells below will read zero.
              </span>
            </div>
          </div>
        )}

        {orderedSections}
      </div>
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
    <section className="tlm-section" data-dense={dense}>
      {header}
      <div className="tlm-section__body">{children}</div>
    </section>
  );
}
