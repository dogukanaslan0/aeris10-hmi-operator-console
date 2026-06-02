/**
 * FrameStats — link-quality readout.
 * =============================================================================
 * Section 4.5-D of the directive. Surfaces frame counts, drop ratio, data
 * rate, and the active scan indices.
 */

import { useTelemetryStore } from '../../stores/telemetryStore';
import { RADAR_CONSTANTS } from '../../types/radar';

type Tone = 'nominal' | 'caution' | 'critical';

export function FrameStats() {
  const current = useTelemetryStore((s) => s.current);

  if (current === null) {
    return <div className="tlm-empty">Awaiting data</div>;
  }

  const dropRatio =
    current.frame_count > 0 ? current.dropped_frames / current.frame_count : 0;
  const dropPercent = (dropRatio * 100).toFixed(3);
  const dropTone: Tone =
    dropRatio > RADAR_CONSTANTS.FRAME_DROP_RATIO_WARN * 5
      ? 'critical'
      : dropRatio > RADAR_CONSTANTS.FRAME_DROP_RATIO_WARN
        ? 'caution'
        : 'nominal';

  const dataRateMbps = (current.data_rate_bps / 1_000_000).toFixed(2);

  return (
    <div className="frame-stats">
      <Row label="Frame #" value={current.frame_count.toLocaleString()} />
      <Row
        label="Dropped"
        value={`${current.dropped_frames} (${dropPercent}%)`}
        tone={dropTone}
      />
      <Row label="Data Rate" value={`${dataRateMbps} Mb/s`} />
      <Row
        label="Sweep M/E"
        value={`${current.scan_index_mechanical}/${current.scan_index_electronic}`}
      />
      <Row
        label="Beam Az/El"
        value={`${current.beam_azimuth_deg.toFixed(1)}° / ${signed(current.beam_elevation_deg)}°`}
      />
    </div>
  );
}

function Row(props: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="frame-stats__row" data-tone={props.tone}>
      <span className="frame-stats__row-label">{props.label}</span>
      <span className="frame-stats__row-value">{props.value}</span>
    </div>
  );
}

function signed(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}`;
}
