/**
 * RadarConfig — Section D of the command panel.
 * =============================================================================
 * Range, chirp duration, PRF, RX gain, CFAR threshold, AGC enable, cooling
 * threshold. Variant max-range upper bound is derived from RADAR_CONSTANTS.
 */

import { useSystemStore } from '../../stores/systemStore';
import { RADAR_CONSTANTS } from '../../types/radar';
import { Slider } from '../common/Slider';

export function RadarConfig() {
  const config = useSystemStore((s) => s.config);
  const setConfig = useSystemStore((s) => s.setConfig);

  const rangeMax =
    config.variant === 'AERIS-10E'
      ? RADAR_CONSTANTS.EXTENDED_MAX_RANGE_M
      : RADAR_CONSTANTS.NEXUS_MAX_RANGE_M;

  return (
    <div className="radar-config">
      <Slider
        label="Range"
        value={config.max_range_m}
        min={100}
        max={rangeMax}
        step={config.variant === 'AERIS-10E' ? 250 : 100}
        format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${v.toFixed(0)} m`)}
        onChange={(v) => setConfig({ max_range_m: v })}
        tone="info"
      />

      <Slider
        label="Chirp Duration"
        value={config.chirp_duration_us}
        min={10}
        max={500}
        step={5}
        unit=" µs"
        onChange={(v) => setConfig({ chirp_duration_us: v })}
        tone="info"
      />

      <Slider
        label="PRF"
        value={config.prf_hz}
        min={100}
        max={5000}
        step={100}
        unit=" Hz"
        onChange={(v) => setConfig({ prf_hz: v })}
        tone="info"
      />

      <Slider
        label="RX Gain"
        value={config.rx_gain_db}
        min={0}
        max={60}
        step={1}
        unit=" dB"
        onChange={(v) => setConfig({ rx_gain_db: v })}
        tone="info"
      />

      <Slider
        label="CFAR Threshold"
        value={config.cfar_threshold_db}
        min={5}
        max={30}
        step={0.5}
        unit=" dB"
        onChange={(v) => setConfig({ cfar_threshold_db: v })}
        tone="info"
      />

      <div className="radar-config__row">
        <span className="radar-config__row-label">AGC</span>
        <div className="radar-config__row-controls">
          <button
            type="button"
            className="aeris-toggle"
            data-active={config.agc_enabled}
            onClick={() => setConfig({ agc_enabled: true })}
          >
            On
          </button>
          <button
            type="button"
            className="aeris-toggle"
            data-active={!config.agc_enabled}
            onClick={() => setConfig({ agc_enabled: false })}
          >
            Off
          </button>
        </div>
      </div>

      <Slider
        label="Cooling Threshold"
        value={config.cooling_threshold_c}
        min={40}
        max={85}
        step={1}
        unit=" °C"
        onChange={(v) => setConfig({ cooling_threshold_c: v })}
        tone="caution"
      />
    </div>
  );
}
