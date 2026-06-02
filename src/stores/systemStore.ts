/**
 * ============================================================================
 * AERIS-10 Command & Control (C2) Tactical Console
 * ────────────────────────────────────────────────────────────────────────────
 * SYSTEM COMPONENT      : Core C2 Global System Store & State Engine
 * ARCHITECT & DEVELOPER : Doğukan Aslan
 * LICENSE               : Proprietary / Community Shared Release
 * VERSION               : 1.0.0 (Nexus Active Deployment)
 * ============================================================================
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { RadarConfig, SystemStoreState } from '../types/radar';
import { RADAR_CONSTANTS } from '../types/radar';

const DEFAULT_RADAR_CONFIG: RadarConfig = {
  variant: 'AERIS-10N',

  // Range / waveform — upstream defaults (v7/models.WaveformConfig).
  // range_bins MUST satisfy max_range_m = range_bins × RANGE_BIN_M. AERIS-10N
  // ships 64 bins × 24 m = 1536 m; the earlier 512 contradicted the 1536 m max
  // range (512 × 24 = 12 288 m) and is corrected here.
  max_range_m: RADAR_CONSTANTS.NEXUS_MAX_RANGE_M,
  range_bins: 64,
  chirp_duration_us: 30, // upstream: 30 µs chirp
  prf_hz: 5_988, // 1 / 167 µs PRI ≈ 5988 Hz

  // Beam steering (full sweep)
  azimuth_start_deg: 0,
  azimuth_end_deg: 360,
  elevation_deg: 0,
  scan_mode: 'FULL_360',
  sector: null,

  // Gain / threshold
  rx_gain_db: 24,
  cfar_threshold_db: 18,
  agc_enabled: true,
  agc_target_db: -20,

  // Cooling
  cooling_threshold_c: 65,

  // Map centre — follow GPS until operator overrides.
  map_center_lat: 0,
  map_center_lon: 0,
  map_center_manual: false,
};

export const useSystemStore = create<SystemStoreState>()(
  subscribeWithSelector((set) => ({
    // ── State ────────────────────────────────────────────────────────────────
    current: null,
    config: DEFAULT_RADAR_CONFIG,
    pendingConfigId: null,
    radarRangeScale: RADAR_CONSTANTS.NEXUS_MAX_RANGE_M,
    layoutPreset: 'engagement',
    commandPaletteOpen: false,
    radarMode: '2D',

    // ── Actions ──────────────────────────────────────────────────────────────

    updateSystem: (system) => set({ current: system }),

    setConfig: (partial) =>
      set((state) => {
        const config = { ...state.config, ...partial };
        // The operator's "Range" control is the only range input in the UI, so
        // it is the single source of truth for how far the tactical display
        // reaches. Mirror it into the display range scale the instant it moves
        // so the PPI rings, target geometry, 3D dome and geographic basemap
        // zoom all track the configured radar range. Without this the Range
        // slider would appear to do nothing (display stayed at its default).
        if (partial.max_range_m !== undefined) {
          return { config, radarRangeScale: partial.max_range_m };
        }
        return { config };
      }),

    setPendingConfigId: (id) => set({ pendingConfigId: id }),

    setRadarRangeScale: (metres) => set({ radarRangeScale: metres }),

    setLayoutPreset: (preset) => set({ layoutPreset: preset }),

    setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

    setRadarMode: (mode) => set({ radarMode: mode }),
  })),
);

export { DEFAULT_RADAR_CONFIG };
