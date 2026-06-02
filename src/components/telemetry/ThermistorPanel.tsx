/**
 * ThermistorPanel — 8-zone PA temperature heat-map.
 * =============================================================================
 * Section 4.5-A of the directive. Each row shows a bar that fills from a
 * baseline ambient (20 °C) to a hot ceiling (80 °C). Colour tracks the
 * directive's three-tier band: <50 °C nominal, 50-65 °C caution, >65 °C
 * critical.
 */

import { useMemo } from 'react';
import { useTelemetryStore } from '../../stores/telemetryStore';

type Tone = 'nominal' | 'caution' | 'critical';

const BAR_MIN_C = 20;
const BAR_MAX_C = 80;

export function ThermistorPanel() {
  const current = useTelemetryStore((s) => s.current);
  const alarms = useTelemetryStore((s) => s.alarms);

  const activeThermistorSources = useMemo(() => {
    return new Set(
      alarms
        .filter((a) => !a.acknowledged && a.category === 'THERMISTOR')
        .map((a) => a.source)
    );
  }, [alarms]);

  if (current === null) {
    return <div className="tlm-empty">Awaiting data</div>;
  }

  return (
    <div className="thermistor">
      {current.thermistors_c.map((value, i) => (
        <Row 
          key={i} 
          index={i + 1} 
          value={value} 
          hasAlarm={activeThermistorSources.has(`THERMISTOR_${i + 1}`)} 
        />
      ))}

      <div className="thermistor__footer">
        <span>Fan: <strong data-active={current.cooling_fan_active}>{current.cooling_fan_active ? '● ACTIVE' : '○ OFF'}</strong></span>
        <span>Threshold: <strong>{current.cooling_threshold_c}°C</strong></span>
      </div>
    </div>
  );
}

function Row(props: { index: number; value: number; hasAlarm: boolean }) {
  // If there's an active alarm for this specific thermistor, force tone to critical to blink
  const baseTone = toneOf(props.value);
  const tone = props.hasAlarm ? 'critical' : baseTone;
  const span = BAR_MAX_C - BAR_MIN_C;
  const percent = Math.max(
    0,
    Math.min(100, ((props.value - BAR_MIN_C) / span) * 100),
  );
  return (
    <div className="thermistor__row" data-tone={tone} data-alarm={props.hasAlarm}>
      <span className="thermistor__label">PA{props.index}</span>
      <div className="thermistor__bar">
        <div className="thermistor__fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="thermistor__value">{props.value.toFixed(1)}°C</span>
    </div>
  );
}

function toneOf(value: number): Tone {
  if (value > 65) return 'critical';
  if (value >= 50) return 'caution';
  return 'nominal';
}
