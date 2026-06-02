/**
 * PACurrentGrid — Unified 16-channel PA telemetry grid (4 × 4) with selection details.
 * =============================================================================
 * Combines PA Temperature (8 zones) and PA Currents (16 channels) into a single
 * cohesive control console.
 *
 * Each cell displays:
 *   - PA channel index (PA1 to PA16)
 *   - Real-time quiescent drain current (mA)
 *   - Real-time zone temperature (°C) derived from coupled thermistors
 *   - Status indicator dot based on nominal/caution/critical levels
 *   - Historical current sparkline path
 *
 * Interactive Diagnostics Expansion Panel displays:
 *   - Power Dissipation (P = V * I) quiescent bias calculations (Vd = 5.0 V)
 *   - Exact coupled thermal zone mappings
 *   - Stat readouts (historical min, max, average current)
 *   - Large sparkline waveform with nominal/critical safety gridlines
 *
 * Cooling Status Footer displays:
 *   - Fan Running/Standby state with active visual cue
 *   - Fan start threshold (°C)
 */

import { useMemo, useState } from 'react';

import { useTelemetryStore } from '../../stores/telemetryStore';
import { RADAR_CONSTANTS } from '../../types/radar';
import { Sparkline } from '../common/Sparkline';

type Tone = 'nominal' | 'caution' | 'critical';

const SPARK_W = 56;
const SPARK_H = 20;
const SPARK_MIN_MA = 100;
const SPARK_MAX_MA = 650;

const THRESHOLD_LINES = [
  { value: RADAR_CONSTANTS.PA_CURRENT_NOMINAL_MIN_MA, color: 'rgba(255, 184, 0, 0.45)' },
  { value: RADAR_CONSTANTS.PA_CURRENT_NOMINAL_MAX_MA, color: 'rgba(255, 184, 0, 0.45)' },
  { value: RADAR_CONSTANTS.PA_CURRENT_CRITICAL_MA, color: 'rgba(255, 59, 59, 0.55)' },
];

export function PACurrentGrid() {
  const current = useTelemetryStore((s) => s.current);
  const history = useTelemetryStore((s) => s.paCurrentHistory);

  const [selectedPa, setSelectedPa] = useState<number | null>(null);

  // Transpose: history is [snapshot0, snapshot1, ...] of 16-tuples.
  // We want per-channel arrays: 16 arrays of N values.
  const perChannel = useMemo(() => {
    const out: number[][] = Array.from({ length: 16 }, () => []);
    for (const snap of history) {
      for (let i = 0; i < 16; i += 1) {
        out[i].push(snap[i]);
      }
    }
    return out;
  }, [history]);

  const alarms = useTelemetryStore((s) => s.alarms);

  const activePaSources = useMemo(() => {
    return new Set(
      alarms
        .filter((a) => !a.acknowledged && a.category === 'PA_CURRENT')
        .map((a) => a.source)
    );
  }, [alarms]);

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

  // Determine temperature for selected PA. PA 1-2 -> Thermistor 1, etc.
  const selectedPaTemp = selectedPa !== null
    ? current.thermistors_c[Math.floor((selectedPa - 1) / 2)]
    : 0;

  return (
    <div className="pa-currents-section">
      <div className="pa-grid">
        {current.pa_currents_ma.map((value, i) => {
          const tempIndex = Math.floor(i / 2); // PA 1-2 maps to Thermistor 1 (index 0), etc.
          const tempVal = current.thermistors_c[tempIndex];
          const hasPaAlarm = activePaSources.has(`PA_${i + 1}`);
          const hasThermistorAlarm = activeThermistorSources.has(`THERMISTOR_${tempIndex + 1}`);
          return (
            <Cell
              key={i}
              index={i + 1}
              value={value}
              temperature={tempVal}
              history={perChannel[i]}
              selected={selectedPa === i + 1}
              hasAlarm={hasPaAlarm || hasThermistorAlarm}
              onSelect={() => setSelectedPa(selectedPa === i + 1 ? null : i + 1)}
            />
          );
        })}
      </div>

      {selectedPa !== null && (
        <PADetailPanel
          index={selectedPa}
          value={current.pa_currents_ma[selectedPa - 1]}
          history={perChannel[selectedPa - 1]}
          temperature={selectedPaTemp}
        />
      )}

      <div className="pa-footer">
        <span className="pa-footer__fan">
          COOLING FAN: <strong data-active={current.cooling_fan_active}>{current.cooling_fan_active ? '● RUNNING' : '○ STANDBY'}</strong>
        </span>
        <span className="pa-footer__threshold">
          THRESHOLD: <strong>{current.cooling_threshold_c}°C</strong>
        </span>
      </div>
    </div>
  );
}

function Cell(props: {
  index: number;
  value: number;
  temperature: number;
  history: number[];
  selected: boolean;
  hasAlarm: boolean;
  onSelect: () => void;
}) {
  const baseTone = toneOf(props.value);
  const tone = props.hasAlarm ? 'critical' : baseTone;
  const tempTone = tempToneOf(props.temperature);
  const color =
    tone === 'critical'
      ? '#dc4f5d'
      : tone === 'caution'
        ? '#d8a553'
        : '#aeb4bf';
  return (
    <button
      type="button"
      className="pa-cell"
      data-tone={tone}
      data-selected={props.selected}
      data-alarm={props.hasAlarm}
      onClick={props.onSelect}
      aria-pressed={props.selected}
      aria-label={`PA ${props.index}: ${props.value.toFixed(0)} mA, ${props.temperature.toFixed(1)} °C. Click for detailed diagnostics.`}
    >
      <div className="pa-cell__head">
        <span className="pa-cell__label">PA{props.index}</span>
        <span className="pa-cell__value">{props.value.toFixed(0)}<span className="pa-cell__unit">mA</span></span>
      </div>
      <div className="pa-cell__sub">
        <span className="pa-cell__temp" data-tone={tempTone}>T: {props.temperature.toFixed(1)}°C</span>
        <span className="pa-cell__indicator" data-tone={tone}>●</span>
      </div>
      <Sparkline
        data={props.history}
        min={SPARK_MIN_MA}
        max={SPARK_MAX_MA}
        width={SPARK_W}
        height={SPARK_H}
        color={color}
        thresholds={THRESHOLD_LINES}
        alertThreshold={RADAR_CONSTANTS.PA_CURRENT_CRITICAL_MA}
      />
    </button>
  );
}

interface PADetailPanelProps {
  index: number;
  value: number;
  history: number[];
  temperature: number;
}

function PADetailPanel({ index, value, history, temperature }: PADetailPanelProps) {
  const tone = toneOf(value);
  
  // Calculate historical statistics
  const stats = useMemo(() => {
    if (history.length === 0) {
      return { min: value, max: value, avg: value };
    }
    const sum = history.reduce((a, b) => a + b, 0);
    const min = Math.min(...history);
    const max = Math.max(...history);
    const avg = sum / history.length;
    return { min, max, avg };
  }, [history, value]);

  // Quiescent drain voltage on ADTR1107 frontend is nominally 5.0 V
  const voltage = 5.0; 
  const powerMw = value * voltage;
  const powerLabel = powerMw >= 1000 ? `${(powerMw / 1000).toFixed(2)} W` : `${powerMw.toFixed(0)} mW`;

  // Associated temperature zone tone
  const tempTone = tempToneOf(temperature);

  return (
    <div className="pa-detail" data-tone={tone}>
      <div className="pa-detail__header">
        <span className="pa-detail__title">PA Channel {index} Diagnostics</span>
        <span className="pa-detail__badge" data-tone={tone}>
          {tone === 'critical' ? 'CRITICAL' : tone === 'caution' ? 'ALERT' : 'NOMINAL'}
        </span>
      </div>

      <div className="pa-detail__grid">
        <div className="pa-detail__metric">
          <span className="pa-detail__metric-label">Quiescent Current</span>
          <span className="pa-detail__metric-value" data-tone={tone}>{value.toFixed(0)} mA</span>
        </div>
        <div className="pa-detail__metric">
          <span className="pa-detail__metric-label">Power Dissipation</span>
          <span className="pa-detail__metric-value">{powerLabel}</span>
        </div>
        <div className="pa-detail__metric">
          <span className="pa-detail__metric-label">Associated Zone Temp</span>
          <span className="pa-detail__metric-value" data-tone={tempTone}>
            {temperature.toFixed(1)} °C
          </span>
        </div>
      </div>

      <div className="pa-detail__divider" />

      <div className="pa-detail__stats">
        <div className="pa-detail__stat-row">
          <span>Historical Min</span>
          <strong>{stats.min.toFixed(0)} mA</strong>
        </div>
        <div className="pa-detail__stat-row">
          <span>Historical Max</span>
          <strong>{stats.max.toFixed(0)} mA</strong>
        </div>
        <div className="pa-detail__stat-row">
          <span>Historical Avg</span>
          <strong>{stats.avg.toFixed(0)} mA</strong>
        </div>
      </div>
      
      <div className="pa-detail__sparkline-container">
        <span className="pa-detail__sparkline-label">Quiescent History (Last 100 Ticks)</span>
        <div className="pa-detail__sparkline">
          <Sparkline
            data={history}
            min={SPARK_MIN_MA}
            max={SPARK_MAX_MA}
            width={280}
            height={40}
            color={tone === 'critical' ? '#dc4f5d' : tone === 'caution' ? '#d8a553' : '#aeb4bf'}
            thresholds={THRESHOLD_LINES}
            alertThreshold={RADAR_CONSTANTS.PA_CURRENT_CRITICAL_MA}
          />
        </div>
      </div>
    </div>
  );
}

function toneOf(value: number): Tone {
  if (value > RADAR_CONSTANTS.PA_CURRENT_CRITICAL_MA) return 'critical';
  if (
    value < RADAR_CONSTANTS.PA_CURRENT_NOMINAL_MIN_MA ||
    value > RADAR_CONSTANTS.PA_CURRENT_NOMINAL_MAX_MA
  ) {
    return 'caution';
  }
  return 'nominal';
}

function tempToneOf(value: number): Tone {
  if (value > RADAR_CONSTANTS.THERMISTOR_WARNING_MAX_C) return 'critical';
  if (value >= RADAR_CONSTANTS.THERMISTOR_NOMINAL_MAX_C) return 'caution';
  return 'nominal';
}
