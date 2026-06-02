/**
 * AERIS-10 RADAR — Core Type Definitions
 * =============================================================================
 * STEP 1 of the C2 HMI rewrite. Single source of truth for every WebSocket
 * frame, Zustand store slice, component prop, and UI primitive.
 *
 * Strict TypeScript — no `any` permitted. Runtime validation (zod or hand-
 * written) lives outside this file; here we only declare shapes.
 *
 * Hardware pipeline this file mirrors (left = upstream, right = downstream):
 *
 *   FPGA XC7A100T → STM32F746 → Python parser → WebSocket → THIS FILE
 *
 * Unit conventions enforced across every interface:
 *   - Distance       metres            (suffix `_m`)
 *   - Velocity       metres / second   (suffix `_mps`, negative = inbound)
 *   - Angle          degrees           (suffix `_deg`)
 *   - Temperature    Celsius           (suffix `_c`)
 *   - Current        milliamps         (suffix `_ma`)
 *   - Power          decibel / dBsm    (suffix `_db` / `_dbsm`)
 *   - Pressure       hectopascal       (suffix `_hpa`)
 *   - Time (epoch)   Unix milliseconds (suffix `_ms`)
 *   - Time (relative)seconds           (suffix `_s`)
 *
 * Coordinate frame: radar is the origin. +X east, +Y north, +Z up.
 * Azimuth is measured clockwise from north, in [0, 360).
 * =============================================================================
 */

// ════════════════════════════════════════════════════════════════════════════
//  SECTION A — CORE TARGET TYPES
// ════════════════════════════════════════════════════════════════════════════

/** Frontend-derived threat assessment. Not from the radar. */
export type ThreatLevel = 'nominal' | 'caution' | 'warning' | 'critical';

/** Frontend-derived classification. `unknown` until kinematics + RCS converge. */
export type TargetClassification =
  | 'unknown'
  | 'bird'
  | 'drone'
  | 'aircraft'
  | 'vehicle';

/** A single detection inside one radar frame. */
export interface RadarTarget {
  /** UUID v4. Stable across frames — drives trail association and selection. */
  id: string;
  /** Unix epoch ms. Used for stale-target eviction and trail fade. */
  timestamp_ms: number;

  // ── Polar coordinates (raw FPGA output) ──────────────────────────────────
  /** Slant range, metres. [0, 20000]. */
  range_m: number;
  /** Azimuth, degrees clockwise from north. [0, 360). */
  azimuth_deg: number;
  /** Elevation, degrees. [-45, +45]. */
  elevation_deg: number;

  // ── Cartesian coordinates (Python adapter, IMU-corrected) ───────────────
  /** East-west offset, metres. East positive. */
  x_m: number;
  /** North-south offset, metres. North positive. */
  y_m: number;
  /** Altitude offset above radar boresight, metres. */
  z_m: number;

  // ── Kinematics ───────────────────────────────────────────────────────────
  /** Radial Doppler velocity, m/s. Negative = inbound, positive = outbound. */
  doppler_mps: number;

  // ── Quality metrics ──────────────────────────────────────────────────────
  /** Signal-to-noise ratio after CFAR, dB. Typical [0, 60+]. */
  snr_db: number;
  /** Estimated Radar Cross Section, dBsm. */
  rcs_dbsm: number;

  // ── Frontend-derived (NOT from FPGA) ─────────────────────────────────────
  threat_level: ThreatLevel;
  classification: TargetClassification;
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION B — HARDWARE TELEMETRY
// ════════════════════════════════════════════════════════════════════════════

/** Eight thermistor channels (ADS7830 I²C ADC). Index i → PA zone i+1. */
export type ThermistorChannels = readonly [
  number, number, number, number,
  number, number, number, number,
];

/** Sixteen PA quiescent-drain currents (ADTR1107 front-ends). */
export type PACurrentChannels = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

/** Hardware health telemetry — emitted at ~12 Hz (every 5th frame). */
export interface TelemetryData {
  /** PA thermistors 1-8, °C. */
  thermistors_c: ThermistorChannels;
  /** PA quiescent drain currents 1-16, mA. */
  pa_currents_ma: PACurrentChannels;

  // ── Cooling ──────────────────────────────────────────────────────────────
  cooling_fan_active: boolean;
  /** Operator-set fan trigger threshold, °C. */
  cooling_threshold_c: number;

  // ── AGC (FPGA inner loop, registers 0x28–0x2C) ──────────────────────────
  /** Signed gain. [-7, +7]. */
  agc_gain: number;
  agc_enabled: boolean;
  /** Fraction of samples that saturated this window. [0, 1]. */
  agc_saturation_ratio: number;

  // ── Active beam pose (derived from indices, FPGA-side) ──────────────────
  /** Azimuth derived from stepper position. */
  beam_azimuth_deg: number;
  /** Elevation derived from ADAR1000 phase index. */
  beam_elevation_deg: number;
  /** Mechanical scan index, y in [1, 50]. */
  scan_index_mechanical: number;
  /** Electronic scan index, n in [1, 32]. */
  scan_index_electronic: number;

  // ── Link quality ─────────────────────────────────────────────────────────
  /** Monotonic count since the last STM32 reset. */
  frame_count: number;
  /** Cumulative dropped frames since boot. */
  dropped_frames: number;
  /** Real-time link bandwidth, bits per second. */
  data_rate_bps: number;
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION C — SYSTEM / NAVIGATION STATE
// ════════════════════════════════════════════════════════════════════════════

/** Operational finite-state machine. UI gates large parts of itself on this. */
export type ConnectionState =
  | 'DISCONNECTED'  // No WebSocket
  | 'CONNECTING'    // WS handshake in progress
  | 'OCXO_WARMUP'   // OCXO 3-minute warm-up running
  | 'ARMED'         // Ready, idle, awaiting scan command
  | 'SCANNING'      // Active sweep
  | 'FAULT'         // Hardware fault — see latest AlarmEvent
  | 'MOCK';         // Frontend simulator engaged (no physical hardware)

/** GPS fix quality per NMEA convention. */
export type GpsFixQuality = 0 | 1 | 2 | 3;
// 0 = no fix, 1 = GPS, 2 = DGPS, 3 = RTK

/** Sent at ~2 Hz (every 30th frame). */
export interface SystemState {
  connection: ConnectionState;

  // ── OCXO warm-up ─────────────────────────────────────────────────────────
  ocxo_warm: boolean;
  /** Elapsed warm-up seconds, [0, ocxo_warmup_total_s]. */
  ocxo_warmup_elapsed_s: number;
  /** Total warm-up duration, typically 180 s. */
  ocxo_warmup_total_s: number;

  // ── GPS ──────────────────────────────────────────────────────────────────
  gps_lat: number;
  gps_lon: number;
  gps_alt_m: number;
  gps_fix_quality: GpsFixQuality;
  gps_satellites: number;

  // ── IMU (GY-85) ──────────────────────────────────────────────────────────
  imu_pitch_deg: number;   // [-90, +90]
  imu_roll_deg: number;    // [-180, +180]
  imu_heading_deg: number; // [0, 360)

  // ── Barometer (BMP180) ──────────────────────────────────────────────────
  baro_alt_m: number;
  baro_pressure_hpa: number;

  // ── Clock ────────────────────────────────────────────────────────────────
  server_timestamp_ms: number;
  /** STM32 uptime, seconds. */
  uptime_s: number;
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION D — FRAME ENVELOPE  (Backend → Frontend, 60 Hz)
// ════════════════════════════════════════════════════════════════════════════

/** Where this frame came from. */
export type FrameSource = 'live' | 'mock' | 'replay';

/** One WebSocket data tick. */
export interface RadarFrame {
  /** Monotonically increasing. Gaps imply dropped frames. */
  frame_id: number;
  timestamp_ms: number;
  targets: RadarTarget[];
  telemetry: TelemetryData;
  system: SystemState;
  source: FrameSource;
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION E — RADAR CONFIGURATION  (Frontend → Backend → STM32)
// ════════════════════════════════════════════════════════════════════════════

export type RadarVariant = 'AERIS-10N' | 'AERIS-10E';
// AERIS-10N "Nexus"    → 3 km range, 8×16 patch antenna
// AERIS-10E "Extended" → 20 km range, 32×16 slotted waveguide + 10 W PA/ch

/**
 * Range-bin count. AERIS-10N ships 64 bins × 24 m/bin = 1536 m (upstream
 * v7/models). 512/1024/2048 are reserved for higher-resolution Extended-variant
 * FFT lengths. max_range_m MUST equal range_bins × RANGE_BIN_M.
 */
export type RangeBins = 64 | 512 | 1024 | 2048;

export type ScanMode = 'FULL_360' | 'SECTOR';

/**
 * Sector-scan parameters. Used only when `RadarConfig.scan_mode === 'SECTOR'`.
 * Wraps cleanly across 0° if `azimuth_start_deg > azimuth_end_deg`.
 *
 * NOTE: stepper motor resolution is 7.2°/step (50 positions per revolution).
 * `azimuth_step_deg` is rounded to the nearest multiple by the adapter.
 */
export interface ScanSector {
  azimuth_start_deg: number; // [0, 360)
  azimuth_end_deg: number;   // [0, 360)
  /** Step size in degrees. Practical floor is 7.2°. */
  azimuth_step_deg: number;
  /** Elevation applied across the whole sweep, [-45, +45]. */
  elevation_deg: number;
  /** Dwell time at each azimuth bucket, milliseconds. */
  dwell_time_ms: number;
}

/** Operator-tunable radar parameters. Sent upstream as APPLY_CONFIG. */
export interface RadarConfig {
  variant: RadarVariant;

  // ── Range / waveform ─────────────────────────────────────────────────────
  /** Max range, metres. [100, 20000]. */
  max_range_m: number;
  range_bins: RangeBins;
  /** Chirp duration, microseconds. */
  chirp_duration_us: number;
  /** Pulse Repetition Frequency, Hz. */
  prf_hz: number;

  // ── Beam steering ────────────────────────────────────────────────────────
  azimuth_start_deg: number;
  azimuth_end_deg: number;
  /** Target elevation, [-45, +45]. */
  elevation_deg: number;
  scan_mode: ScanMode;
  /** null when scan_mode === 'FULL_360'. */
  sector: ScanSector | null;

  // ── Gain / threshold ─────────────────────────────────────────────────────
  /** RX gain, dB. [0, 60]. */
  rx_gain_db: number;
  /** CFAR threshold, dB. [5, 30]. Higher = fewer detections, fewer false alarms. */
  cfar_threshold_db: number;
  agc_enabled: boolean;
  /** AGC target level, dB. [-40, 0]. */
  agc_target_db: number;

  // ── Cooling ──────────────────────────────────────────────────────────────
  /** Fan-on threshold, °C. [40, 85]. */
  cooling_threshold_c: number;

  // ── Map centring ─────────────────────────────────────────────────────────
  map_center_lat: number;
  map_center_lon: number;
  /** true = operator-locked. false = follow GPS. */
  map_center_manual: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION F — OPERATOR ANNOTATIONS
// ════════════════════════════════════════════════════════════════════════════

export type TargetPriority = 1 | 2 | 3; // 1 = low, 2 = medium, 3 = critical

export interface TargetAnnotation {
  target_id: string;
  /** Max 32 characters — enforce at the write boundary, not in the type. */
  label: string;
  priority: TargetPriority;
  /** Track-lock — adapter prioritises this target in subsequent scans. */
  locked: boolean;
  note: string;
  created_at_ms: number;
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION G — ALARMS                                                  [NEW]
// ════════════════════════════════════════════════════════════════════════════

export type AlarmCategory =
  | 'PA_CURRENT'      // PA Idq outside nominal envelope
  | 'THERMISTOR'      // Thermistor reading above warning/critical
  | 'FRAME_DROP'      // Drop rate spike beyond 0.1 %
  | 'CONNECTION'      // WebSocket / serial link event
  | 'GPS'             // Fix lost / quality degraded
  | 'OCXO'            // Warm-up failed or drift detected
  | 'AGC_SATURATION'  // AGC saturating for sustained window
  | 'TARGET_THREAT'   // High-threat target detection alarm
  | 'SYSTEM';         // Catch-all (boot, fault recovery, etc.)

export type AlarmSeverity = 'info' | 'warning' | 'critical';

/**
 * Timestamped, acknowledgeable event surfaced to the alarm feed.
 * Backend pushes these as discrete WS messages — they are NOT inside RadarFrame
 * because they have independent lifetimes and acknowledgement semantics.
 */
export interface AlarmEvent {
  id: string;                              // UUID
  timestamp_ms: number;
  category: AlarmCategory;
  severity: AlarmSeverity;
  /** Channel / component identifier, e.g. 'PA_3' or 'THERMISTOR_5'. */
  source: string;
  message: string;
  /** Observed value at trigger time (e.g. 612 for "612 mA"). null if N/A. */
  value: number | null;
  /** Threshold that was exceeded. null if N/A. */
  threshold: number | null;
  acknowledged: boolean;
  acknowledged_at_ms: number | null;
  /** Operator who acknowledged, if any. */
  acknowledged_by: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION H — WEBSOCKET WIRE PROTOCOL                                 [NEW]
// ════════════════════════════════════════════════════════════════════════════

export interface HandshakePayload {
  server_version: string;
  /** true = mock_engine.py is the source. UI must surface a 'MOCK' badge. */
  mock: boolean;
  /** Schema version of THIS types module the backend was built against. */
  protocol_version: number;
}

export interface ConfigAckPayload {
  /** Echoed config_id from the originating APPLY_CONFIG command. */
  config_id: string;
  success: boolean;
  /** Populated only when success === false. */
  error: string | null;
}

/** Discriminated union — every inbound message from backend. */
export type WebSocketMessage =
  | { type: 'FRAME'; payload: RadarFrame }
  | { type: 'ALARM'; payload: AlarmEvent }
  | { type: 'CONFIG_ACK'; payload: ConfigAckPayload }
  | { type: 'HANDSHAKE'; payload: HandshakePayload };

/** Discriminated union — every outbound command from frontend. */
export type WebSocketCommand =
  | { type: 'APPLY_CONFIG'; config_id: string; payload: Partial<RadarConfig> }
  | { type: 'START_SCAN' }
  | { type: 'STOP_SCAN' }
  | { type: 'ACK_ALARM'; alarm_id: string; operator: string }
  | { type: 'ANNOTATE_TARGET'; payload: TargetAnnotation };

// ════════════════════════════════════════════════════════════════════════════
//  SECTION I — ZUSTAND STORE SHAPES
// ════════════════════════════════════════════════════════════════════════════
//
// Three stores, one per update cadence, per Section 5.1 of the directive:
//   - Targets  → 60 Hz   (hot path, drives canvas)
//   - Telemetry→ 12 Hz   (drives thermistor + PA panels)
//   - System   →  2 Hz   (drives topbar + map centre + connection chrome)
//
// Splitting is intentional: a 60 Hz target update MUST NOT invalidate
// subscribers reading thermistor data. Cross-store reads are allowed via
// `getState()` but selectors must never span stores.
// ════════════════════════════════════════════════════════════════════════════

/** Targets store — hot path. */
export interface TargetStoreState {
  /** id of the most recently applied frame. Used for skew checks. */
  currentFrameId: number | null;
  /** id → latest detection. */
  targets: Map<string, RadarTarget>;
  /** Per-target trail history. Most-recent at the end. */
  targetHistory: Map<string, RadarTarget[]>;
  /** Operator selection (canvas pulse + detail readout). */
  selectedTargetId: string | null;
  /** Annotations indexed by target id. */
  annotations: Map<string, TargetAnnotation>;
  /** Set of pinned target IDs. */
  pinnedTargetIds: Set<string>;

  // ── Actions ──────────────────────────────────────────────────────────────
  updateTargets: (
    incoming: readonly RadarTarget[],
    frameId: number,
    frameTimestampMs: number,
  ) => void;
  selectTarget: (id: string | null) => void;
  annotateTarget: (id: string, annotation: Partial<TargetAnnotation>) => void;
  /** Drop targets whose timestamp is older than nowMs - STALE_TARGET_MS. */
  clearStaleTargets: (nowMs: number) => void;
  /** Toggle pin target status */
  togglePinTarget: (id: string) => void;
}

/** Telemetry store — medium-rate. */
export interface TelemetryStoreState {
  current: TelemetryData | null;
  /** Sparkline windows (most-recent at the end), bounded by TELEMETRY_HISTORY. */
  thermistorHistory: ThermistorChannels[];
  paCurrentHistory: PACurrentChannels[];
  /** Active alarm feed, newest first. Acknowledged alarms remain for audit. */
  alarms: AlarmEvent[];

  // ── Actions ──────────────────────────────────────────────────────────────
  updateTelemetry: (telemetry: TelemetryData) => void;
  pushAlarm: (alarm: AlarmEvent) => void;
  acknowledgeAlarm: (alarmId: string, operator: string) => void;
  clearAlarms: () => void;
}

/** System store — slow rate. Also owns RadarConfig and UI display settings. */
export interface SystemStoreState {
  current: SystemState | null;
  config: RadarConfig;
  /** config_id of the last APPLY_CONFIG awaiting a CONFIG_ACK. */
  pendingConfigId: string | null;

  // ── UI display settings (operator-side only, never sent to backend) ─────
  /**
   * Max range shown on the PPI / map / 3D dome, metres. Mirrors
   * `config.max_range_m` (setConfig keeps them in sync, since the Range slider
   * is the only range control). May be temporarily overridden by a display-only
   * zoom action (command palette / keyboard) until the Range slider moves again.
   */
  radarRangeScale: number;
  /** Custom operator layouts: watch, engagement, diagnostic */
  layoutPreset: 'watch' | 'engagement' | 'diagnostic';
  /** Command palette overlay open status */
  commandPaletteOpen: boolean;
  /** Active dimension mode: 2D PPI or 3D Dome */
  radarMode: '2D' | '3D';

  // ── Actions ──────────────────────────────────────────────────────────────
  updateSystem: (system: SystemState) => void;
  setConfig: (partial: Partial<RadarConfig>) => void;
  setPendingConfigId: (id: string | null) => void;
  setRadarRangeScale: (metres: number) => void;
  setLayoutPreset: (preset: 'watch' | 'engagement' | 'diagnostic') => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setRadarMode: (mode: '2D' | '3D') => void;
}

// ════════════════════════════════════════════════════════════════════════════
//  SECTION J — HARDWARE CONSTANTS                                      [NEW]
// ════════════════════════════════════════════════════════════════════════════
//
// Single source of truth for magic numbers referenced in Sections 1, 4 and 8
// of the directive. Components MUST import from here rather than hard-coding.
// ════════════════════════════════════════════════════════════════════════════

export const RADAR_CONSTANTS = {
  // ── Trails / staleness ──────────────────────────────────────────────────
  TRAIL_LENGTH: 30,        // frames retained per target
  STALE_TARGET_MS: 2_000,  // eviction threshold

  // ── Update cadence ──────────────────────────────────────────────────────
  FRAME_RATE_HZ: 60,
  TELEMETRY_DIVIDER: 5,    // every 5th frame  → ~12 Hz
  SYSTEM_DIVIDER: 30,      // every 30th frame → ~2 Hz

  // ── History windows ─────────────────────────────────────────────────────
  TELEMETRY_HISTORY: 100,

  // ── OCXO warm-up ────────────────────────────────────────────────────────
  OCXO_WARMUP_S: 180,

  // ── Scan geometry ───────────────────────────────────────────────────────
  STEPPER_POSITIONS: 50,
  STEPPER_RESOLUTION_DEG: 7.2,
  ELECTRONIC_POSITIONS: 32,
  ELECTRONIC_RANGE_DEG: 45,   // ± this value

  // ── Range bins (upstream WaveformConfig: 64 bins × ~24 m/bin) ───────────
  // NOTE: the master directive's 6 m/bin × 512 bins was aspirational.
  // Upstream `v7/models.py` ships with 24 m/bin × 64 bins for AERIS-10N.
  RANGE_BIN_M: 24,
  NEXUS_MAX_RANGE_M: 1_536,     // 24 m × 64 bins
  EXTENDED_MAX_RANGE_M: 20_000, // unchanged — Extended variant assumed

  // ── Threat evaluation (kinematic, range + radial closure) ───────────────
  // A range/Doppler radar measures range and *radial* velocity only (no angle
  // rate), so time-to-go along the line of sight — TTG = range / closing speed
  // — is the correct available proxy for time-to-intercept. Escalation keys off
  // TTG (not bare range) so a fast inbound contact is flagged with seconds of
  // warning instead of only once it crosses an arbitrary close-range gate.
  THREAT_KEEPOUT_M: 200,        // inner keep-out: anything this close is high alert
  THREAT_TTG_CRITICAL_S: 8,     // closing & < this TTG → critical
  THREAT_TTG_WARNING_S: 25,     // closing & < this TTG → warning
  THREAT_FAST_MOVER_MPS: 20,    // mid-range fast crosser threshold
  THREAT_CAUTION_M: 1_000,      // within surveillance envelope → at least caution

  // ── Health thresholds (Section 1.2 + Section 4.5) ───────────────────────
  PA_CURRENT_NOMINAL_MIN_MA: 150,
  PA_CURRENT_NOMINAL_MAX_MA: 450,
  PA_CURRENT_CRITICAL_MA: 500,
  THERMISTOR_NOMINAL_MAX_C: 50,
  THERMISTOR_WARNING_MAX_C: 65,

  // ── Drop rate sanity (Section 8 §3) ─────────────────────────────────────
  FRAME_DROP_RATIO_WARN: 0.001, // 0.1 %

  // ── STM32 start-handshake byte sequence (Section 1.1, Section 8 §4) ─────
  // Adapter sends this — UI only displays it for diagnostic confirmation.
  START_HANDSHAKE: [23, 46, 158, 237] as const,
} as const;

export type RadarConstants = typeof RADAR_CONSTANTS;

// ════════════════════════════════════════════════════════════════════════════
//  END OF FILE — STEP 1 OUTPUT
// ════════════════════════════════════════════════════════════════════════════
