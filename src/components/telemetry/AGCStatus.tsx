/**
 * AGCStatus — FPGA AGC inner-loop readout.
 * =============================================================================
 * Section 4.5-C of the directive. Signed gain is mapped to a 15-cell bar
 * (-7 → leftmost, +7 → rightmost, 0 → midpoint marker). Saturation is
 * surfaced as a simple OK / DEGRADED / SATURATED state (operators don't
 * parse 0.04% vs 0.12% at a glance — they need a tone). The raw register
 * value is preserved as a tooltip for hardware-debug sessions.
 */

import { useTelemetryStore } from '../../stores/telemetryStore';

const CELL_COUNT = 15;
const CELL_CENTER = Math.floor(CELL_COUNT / 2); // index 7
const GAIN_MIN = -7;
const GAIN_MAX = 7;

// Saturation tiers (fraction of samples saturating per analysis window)
const SAT_DEGRADED_FRAC = 0.001; // > 0.1 %
const SAT_SATURATED_FRAC = 0.01; //  > 1 %

export function AGCStatus() {
  const current = useTelemetryStore((s) => s.current);

  if (current === null) {
    return <div className="tlm-empty">Awaiting data</div>;
  }

  const normalized = (current.agc_gain - GAIN_MIN) / (GAIN_MAX - GAIN_MIN);
  const filledCells = Math.round(normalized * (CELL_COUNT - 1));

  const gainSign = current.agc_gain >= 0 ? '+' : '';
  const saturationPct = current.agc_saturation_ratio * 100;
  const saturationPctLabel = saturationPct.toFixed(2);

  // Simple state — operators read this instead of decoding a percentage.
  let saturationState: 'OK' | 'DEGRADED' | 'SATURATED' = 'OK';
  let saturationTone: 'nominal' | 'caution' | 'critical' = 'nominal';
  if (current.agc_saturation_ratio > SAT_SATURATED_FRAC) {
    saturationState = 'SATURATED';
    saturationTone = 'critical';
  } else if (current.agc_saturation_ratio > SAT_DEGRADED_FRAC) {
    saturationState = 'DEGRADED';
    saturationTone = 'caution';
  }

  // 0x28..0x2C — 0x2A is the attack register. Surface the gain value as a
  // signed-byte hex per the directive's debug intent.
  const regHex = ((current.agc_gain & 0xff) >>> 0)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

  return (
    <div className="agc">
      <div className="agc__row">
        <span className="agc__label">Gain</span>
        <div
          className="agc__bar"
          role="img"
          aria-label={`AGC gain ${gainSign}${current.agc_gain}`}
        >
          {Array.from({ length: CELL_COUNT }, (_, i) => (
            <span
              key={i}
              className="agc__cell"
              data-filled={i <= filledCells}
              data-center={i === CELL_CENTER || undefined}
            />
          ))}
        </div>
        <span className="agc__value">
          {gainSign}
          {current.agc_gain}
        </span>
      </div>

      <div className="agc__metrics">
        <Metric
          label="Saturation"
          value={saturationState}
          tone={saturationTone}
          title={`${saturationPctLabel}% of samples saturating`}
        />
        <Metric label="Mode" value={current.agc_enabled ? 'AUTO' : 'MANUAL'} />
        <Metric
          label="Reg 0x2A"
          value={`0x${regHex}`}
          title="AGC attack register (0x2A) — current signed-byte gain value"
        />
      </div>
    </div>
  );
}

interface MetricProps {
  label: string;
  value: string;
  tone?: 'nominal' | 'caution' | 'critical';
  title?: string;
}

function Metric(props: MetricProps) {
  return (
    <div className="agc__metric" title={props.title} data-tone={props.tone}>
      <span className="agc__metric-label">{props.label}</span>
      <span className="agc__metric-value">{props.value}</span>
    </div>
  );
}
