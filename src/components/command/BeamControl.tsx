/**
 * BeamControl — Section C of the command panel.
 * =============================================================================
 * Azimuth + elevation sliders, scan-mode toggle (FULL_360 / SECTOR), and
 * sector-only start/end sliders. Mutations flow through useSystemStore.setConfig;
 * useConfigSync (mounted at App level) debounces and emits APPLY_CONFIG.
 */

import { useSystemStore } from '../../stores/systemStore';
import type { ScanSector } from '../../types/radar';
import { Slider } from '../common/Slider';

const DEFAULT_SECTOR: ScanSector = {
  azimuth_start_deg: 0,
  azimuth_end_deg: 90,
  azimuth_step_deg: 7.2,
  elevation_deg: 0,
  dwell_time_ms: 50,
};

export function BeamControl() {
  const config = useSystemStore((s) => s.config);
  const setConfig = useSystemStore((s) => s.setConfig);
  function patchSector(partial: Partial<ScanSector>): void {
    const current = config.sector ?? DEFAULT_SECTOR;
    setConfig({ sector: { ...current, ...partial } });
  }

  return (
    <div className="beam-control">
      <Slider
        label="Azimuth"
        value={config.azimuth_start_deg}
        min={0}
        max={360}
        step={1}
        unit="°"
        onChange={(v) => setConfig({ azimuth_start_deg: v })}
        tone="info"
      />

      <Slider
        label="Elevation"
        value={config.elevation_deg}
        min={-45}
        max={45}
        step={0.5}
        unit="°"
        format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`}
        onChange={(v) => setConfig({ elevation_deg: v })}
        tone="violet"
      />

      {config.scan_mode === 'SECTOR' && (
        <div className="beam-control__sector">
          <Slider
            label="Sector Start"
            value={(config.sector ?? DEFAULT_SECTOR).azimuth_start_deg}
            min={0}
            max={360}
            step={7.2}
            unit="°"
            onChange={(v) => patchSector({ azimuth_start_deg: v })}
            tone="info"
          />
          <Slider
            label="Sector End"
            value={(config.sector ?? DEFAULT_SECTOR).azimuth_end_deg}
            min={0}
            max={360}
            step={7.2}
            unit="°"
            onChange={(v) => patchSector({ azimuth_end_deg: v })}
            tone="info"
          />
        </div>
      )}

      {/* ── Beam Vector Gimbal Dome ── */}
      <div className="beam-3d-container">
        <div
          className="beam-3d-dome"
          style={
            {
              '--vector-angle': `${((config.azimuth_start_deg % 180) - 90).toFixed(1)}deg`,
              '--vector-scale': (0.4 + ((config.elevation_deg + 45) / 90) * 0.6).toFixed(2),
            } as React.CSSProperties
          }
        >
          <div className="beam-3d-grid-floor" />
          <div className="beam-3d-grid-latitude" />
          <div className="beam-3d-vector">
            <div className="beam-3d-vector-line" />
            <div className="beam-3d-vector-dot" />
          </div>
        </div>
        <div className="beam-3d-readout">
          <span>STEER AZ: {config.azimuth_start_deg.toFixed(0)}°</span>
          <span>EL: {config.elevation_deg >= 0 ? '+' : ''}{config.elevation_deg.toFixed(1)}°</span>
        </div>
      </div>
    </div>
  );
}
