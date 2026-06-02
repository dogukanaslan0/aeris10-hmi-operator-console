/**
 * Mock Engine — physical-hardware-free RadarFrame producer.
 * =============================================================================
 * Frontend mirror of `aeris_bridge/mock_engine.py`. Used when the WebSocket
 * cannot be reached so development can proceed without an STM32 / FPGA.
 *
 * Section 2.2 of the directive demands:
 *   - 2–5 moving targets (sinusoidal trajectories + Gaussian noise)
 *   - realistic Doppler bands (bird ±2 m/s, drone ±15 m/s, vehicle ±30 m/s)
 *   - thermistor warm-up curve (25 °C → 55-70 °C, exponential approach)
 *   - PA current ripple (±15 mA periodic noise)
 *   - OCXO boot countdown (compressed to ~10 s by default, not 180 s)
 *   - scanning sweep animation (y: 1→50, n: 1→32 loop)
 *
 * Determinism: Math.random() — non-deterministic on purpose so the demo
 * looks alive across reloads. Swap for a seeded PRNG if reproducibility is
 * ever needed in tests.
 *
 * Time origin:
 *   - `timestamp_ms` is Date.now() (Unix epoch). Required for cross-source
 *      ordering against real WebSocket frames.
 *   - `elapsed_s` uses performance.now() for monotonic, wall-clock-immune
 *      simulation maths.
 */

import type {
  AlarmEvent,
  ConnectionState,
  GpsFixQuality,
  PACurrentChannels,
  RadarFrame,
  RadarTarget,
  SystemState,
  TargetClassification,
  TelemetryData,
  ThermistorChannels,
  ThreatLevel,
} from '../types/radar';
import { RADAR_CONSTANTS } from '../types/radar';

// ════════════════════════════════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════════════════════════════════

export interface MockEngineConfig {
  /** Compressed OCXO warm-up for dev. Production-realistic = 180. */
  ocxo_warmup_s: number;
  /** Spawned target count at startup. [2, 5]. */
  initial_target_count: number;
  /** Probability per frame of an alarm being generated. [0, 1]. */
  alarm_probability_per_frame: number;
  /** Mock map centre — neutral default the operator overrides. */
  origin_lat: number;
  origin_lon: number;
}

export const DEFAULT_MOCK_CONFIG: MockEngineConfig = {
  ocxo_warmup_s: 10,
  initial_target_count: 4,
  alarm_probability_per_frame: 0.0005, // ~once per 30 s @ 60 Hz
  origin_lat: 41.0082,
  origin_lon: 28.9784,
};

// ════════════════════════════════════════════════════════════════════════════
// INTERNAL SEED TYPES
// ════════════════════════════════════════════════════════════════════════════

interface TargetSeed {
  id: string;
  classification: TargetClassification;
  // Straight-line flight model: the target oscillates back and forth along a
  // FIXED heading through the midpoint (x0,y0). It flies in a real geographic
  // direction — crossing the map like an actual aircraft — instead of
  // orbiting the radar centre (which read as "circling, untethered").
  x0_m: number; // flight-line midpoint, east (+) / west (−)
  y0_m: number; // flight-line midpoint, north (+) / south (−)
  heading_rad: number; // direction of travel (0 = north, CW)
  drift_amp_m: number; // half-length of the flight path
  drift_rate: number; // sinusoid angular rate (rad/s) → governs speed
  altitude_m: number;
  altitude_amp_m: number;
  rcs_dbsm: number;
  snr_base_db: number;
  phase: number;
}

// ════════════════════════════════════════════════════════════════════════════
// MOCK ENGINE
// ════════════════════════════════════════════════════════════════════════════

import { useTelemetryStore } from '../stores/telemetryStore';

export class MockEngine {
  private static instance: MockEngine | null = null;

  private readonly config: MockEngineConfig;
  private readonly start_ms_perf: number;
  private readonly start_ms_wall: number;
  private frame_id: number;
  private readonly targets: TargetSeed[];
  private readonly thermistor_phases: readonly number[];
  private readonly pa_phases: readonly number[];
  private dropped_frames: number;
  private pendingAlarms: AlarmEvent[];
  // Closed-loop thermal state (see simulateTelemetry).
  private coreTempC: number;
  private fanActive: boolean;
  private lastThermalT: number;

  private constructor(config: MockEngineConfig) {
    this.config = config;
    this.start_ms_perf = performance.now();
    this.start_ms_wall = Date.now();
    this.frame_id = 0;
    this.targets = this.seedTargets();
    this.thermistor_phases = [0.0, 0.7, 1.4, 2.1, 2.8, 3.5, 4.2, 4.9];
    this.pa_phases = Array.from({ length: 16 }, (_, i) => i * 0.4);
    this.dropped_frames = 0;
    this.pendingAlarms = [];
    this.coreTempC = 25; // ambient
    this.fanActive = false;
    this.lastThermalT = 0;
  }

  static getInstance(config: MockEngineConfig = DEFAULT_MOCK_CONFIG): MockEngine {
    if (MockEngine.instance === null) {
      MockEngine.instance = new MockEngine(config);
    }
    return MockEngine.instance;
  }

  /** Tear down the singleton — call between Storybook stories or tests. */
  static reset(): void {
    MockEngine.instance = null;
  }

  // ── Frame production ────────────────────────────────────────────────────

  nextFrame(): RadarFrame {
    const elapsed_s = (performance.now() - this.start_ms_perf) / 1000;
    const timestamp_ms = this.start_ms_wall + elapsed_s * 1000;

    this.frame_id += 1;
    const frame_id = this.frame_id;

    // Every target is refreshed every frame (60 Hz). This is the C2 *track*
    // stream — smoothed/extrapolated track files, as a command console shows —
    // NOT raw beam-gated plots. The scanning beam (telemetry beam_azimuth /
    // scan_index) revisits each bearing far more slowly; the tracker is what
    // interpolates between dwells, which is why track updates are continuous
    // and independent of the instantaneous beam azimuth.
    const targets = this.targets.map((seed) =>
      this.simulateTarget(seed, elapsed_s, timestamp_ms),
    );
    const telemetry = this.simulateTelemetry(elapsed_s, frame_id);
    const system = this.simulateSystem(elapsed_s, timestamp_ms);

    // ── Target threat alarm generator ───────────────────────────────────────
    for (const target of targets) {
      if (target.threat_level === 'critical') {
        const alreadyExists =
          this.pendingAlarms.some((a) => a.source === target.id) ||
          useTelemetryStore.getState().alarms.some((a) => a.source === target.id && !a.acknowledged);
        if (!alreadyExists) {
          const parts = target.id.split('-');
          const num = parts[parts.length - 1];
          const type = parts[parts.length - 2] ?? '';
          const prefix =
            type.includes('bird') ? 'BRD' :
            type.includes('drone') ? 'DRN' :
            type.includes('aircraft') ? 'AIR' :
            type.includes('vehicle') ? 'VEH' :
            type.toUpperCase().slice(0, 3);
          const displayId = /^\d+$/.test(num)
            ? `${prefix}-${num}`
            : target.id.replace('mock-', '').replace('node-', '').toUpperCase();

          const alarmId = `alarm-${target.id}-${Date.now()}`;
          this.pendingAlarms.push({
            id: alarmId,
            timestamp_ms,
            category: 'TARGET_THREAT',
            severity: 'critical',
            source: target.id, // target ID acts as source
            message: `CRITICAL THREAT DETECTED: Target ${displayId} is inbound at ${target.range_m.toFixed(0)}m, closing ${Math.abs(target.doppler_mps).toFixed(1)}m/s!`,
            value: target.range_m,
            threshold: 200,
            acknowledged: false,
            acknowledged_at_ms: null,
            acknowledged_by: null,
          });
        }
      }
    }

    this.maybeGenerateAlarm(timestamp_ms);

    return {
      frame_id,
      timestamp_ms,
      targets,
      telemetry,
      system,
      source: 'mock',
    };
  }

  /** Drain any alarms produced during recent nextFrame() calls. */
  pollAlarms(): AlarmEvent[] {
    if (this.pendingAlarms.length === 0) return [];
    const out = this.pendingAlarms;
    this.pendingAlarms = [];
    return out;
  }

  // ── Target seeds (spec: 2-5 targets, mixed classifications) ─────────────

  private seedTargets(): TargetSeed[] {
    // Seed ranges (plus each seed's drift_amp) MUST stay within the radar's max
    // detectable range — NEXUS_MAX_RANGE_M = 1536 m — otherwise targets sit
    // beyond the PPI/map edge and are permanently invisible (a 1536 m-max radar
    // physically cannot see a 2600 m target). They are spread across the band so
    // changing the Range slider visibly reveals / hides the outer ones.
    const all: TargetSeed[] = [
      this.makeBird('mock-bird-1', 850, 45),
      this.makeCriticalDrone('mock-crit-drone', 300, 140),
      this.makeDrone('mock-drone-1', 1080, 110),
      this.makeAircraft('mock-aircraft-1', 900, 290),
      this.makeDrone('mock-drone-2', 820, 340),
    ];
    const clamped = Math.max(2, Math.min(5, this.config.initial_target_count));
    return all.slice(0, clamped);
  }

  /**
   * Build a straight-line-flight seed from an initial polar position plus a
   * heading and along-track parameters. The midpoint is the polar position;
   * the target then flies back and forth along `heading`.
   */
  private makeSeed(params: {
    id: string;
    classification: TargetClassification;
    range_m: number;
    azimuth_deg: number;
    heading_deg: number;
    drift_amp_m: number;
    drift_rate: number;
    altitude_m: number;
    altitude_amp_m: number;
    rcs_dbsm: number;
    snr_base_db: number;
    phase: number;
  }): TargetSeed {
    const az = (params.azimuth_deg * Math.PI) / 180;
    return {
      id: params.id,
      classification: params.classification,
      x0_m: params.range_m * Math.sin(az),
      y0_m: params.range_m * Math.cos(az),
      heading_rad: (params.heading_deg * Math.PI) / 180,
      drift_amp_m: params.drift_amp_m,
      drift_rate: params.drift_rate,
      altitude_m: params.altitude_m,
      altitude_amp_m: params.altitude_amp_m,
      rcs_dbsm: params.rcs_dbsm,
      snr_base_db: params.snr_base_db,
      phase: params.phase,
    };
  }

  private makeCriticalDrone(id: string, range_m: number, azimuth_deg: number): TargetSeed {
    // Flies toward the radar (heading = inbound bearing) and makes repeated
    // strafing passes, diving from ~540 m down to ~60 m. phase 1.0 places it at
    // ~150 m and closing at t=0 → genuinely CRITICAL from the first frame (the
    // operator sees the critical styling + threat alarm immediately), then it
    // recedes and re-engages each cycle. vmax ≈ 0.07 × 240 ≈ 17 m/s (drone band).
    return this.makeSeed({
      id,
      classification: 'drone',
      range_m,
      azimuth_deg,
      heading_deg: azimuth_deg + 180, // inbound, toward the radar
      drift_amp_m: 240,
      drift_rate: 0.07,
      altitude_m: 90,
      altitude_amp_m: 15,
      rcs_dbsm: -12,
      snr_base_db: 25,
      phase: 1.0, // ~150 m + closing at t=0 → critical from boot
    });
  }

  private makeBird(id: string, range_m: number, azimuth_deg: number): TargetSeed {
    return this.makeSeed({
      id,
      classification: 'bird',
      range_m,
      azimuth_deg,
      heading_deg: Math.random() * 360,
      // Birds are slow + local: small patrol, low Doppler (~±2-3 m/s peak).
      drift_amp_m: 90,
      drift_rate: 0.03,
      altitude_m: 60,
      altitude_amp_m: 15,
      rcs_dbsm: -20,
      snr_base_db: 12,
      phase: Math.random() * Math.PI * 2,
    });
  }

  private makeDrone(id: string, range_m: number, azimuth_deg: number): TargetSeed {
    return this.makeSeed({
      id,
      classification: 'drone',
      range_m,
      azimuth_deg,
      heading_deg: Math.random() * 360,
      // Moderate movers — ~13 m/s peak along-track (drone Doppler band).
      drift_amp_m: 260,
      drift_rate: 0.05,
      altitude_m: 150,
      altitude_amp_m: 30,
      rcs_dbsm: -10,
      snr_base_db: 22,
      phase: Math.random() * Math.PI * 2,
    });
  }

  private makeAircraft(id: string, range_m: number, azimuth_deg: number): TargetSeed {
    return this.makeSeed({
      id,
      classification: 'aircraft',
      range_m,
      azimuth_deg,
      heading_deg: Math.random() * 360,
      // Fastest contact — sweeps across the scope (~30 m/s peak along-track).
      drift_amp_m: 340,
      drift_rate: 0.09,
      altitude_m: 300,
      altitude_amp_m: 45,
      rcs_dbsm: 5,
      snr_base_db: 35,
      phase: Math.random() * Math.PI * 2,
    });
  }

  private simulateTarget(
    seed: TargetSeed,
    t: number,
    timestamp_ms: number,
  ): RadarTarget {
    // Position along the straight flight line (sinusoidal back-and-forth)
    const wob = Math.sin(t * seed.drift_rate + seed.phase);
    const wobVel = Math.cos(t * seed.drift_rate + seed.phase) * seed.drift_rate;
    const along = wob * seed.drift_amp_m;
    const alongVel = wobVel * seed.drift_amp_m; // m/s along heading

    const hx = Math.sin(seed.heading_rad);
    const hy = Math.cos(seed.heading_rad);
    const x_m = seed.x0_m + hx * along;
    const y_m = seed.y0_m + hy * along;

    const range_m = Math.max(1, Math.hypot(x_m, y_m));
    const azimuth_deg = ((Math.atan2(x_m, y_m) * 180) / Math.PI + 360) % 360;

    // Signed Doppler = radial component of the velocity vector.
    // + = opening (moving away), − = closing (inbound).
    const vx = hx * alongVel;
    const vy = hy * alongVel;
    const doppler_mps = (x_m * vx + y_m * vy) / range_m;

    const altitude = Math.max(
      0,
      seed.altitude_m + Math.sin(t * 0.3 + seed.phase) * seed.altitude_amp_m,
    );
    const z_m = altitude;
    const elevation_deg = (Math.atan2(altitude, range_m) * 180) / Math.PI;

    // SNR follows the radar range equation: SNR ∝ RCS·R⁻⁴. `snr_base_db` is the
    // SNR at the seed's nominal range; as the target closes the return
    // strengthens (40·log10 per decade of range), as it recedes it weakens — so
    // SNR is no longer a flat per-class constant independent of distance.
    const nominalRange = Math.max(1, Math.hypot(seed.x0_m, seed.y0_m));
    const snr_db =
      seed.snr_base_db - 40 * Math.log10(range_m / nominalRange) + gaussianNoise(1.5);

    return {
      id: seed.id,
      timestamp_ms,
      range_m,
      azimuth_deg,
      elevation_deg,
      x_m,
      y_m,
      z_m,
      doppler_mps,
      snr_db,
      rcs_dbsm: seed.rcs_dbsm + gaussianNoise(0.5),
      threat_level: deriveThreatLevel(range_m, doppler_mps),
      classification: seed.classification,
    };
  }

  // ── Telemetry ──────────────────────────────────────────────────────────

  private simulateTelemetry(t: number, frame_id: number): TelemetryData {
    // ── Closed-loop cooling ─────────────────────────────────────────────────
    // A first-order thermal mass driven by a hysteresis thermostat. The fan
    // engages when the core crosses the cooling threshold (65 °C) and releases
    // at a lower bound (60 °C) — NOT on a fixed timer. The core then cycles
    // inside the [60, 65] band, so the warning path is naturally exercised and
    // the fan visibly duty-cycles, exactly like a real bang-bang controller.
    const dt = Math.max(0, Math.min(2, t - this.lastThermalT));
    this.lastThermalT = t;
    const TAU_S = 90;            // thermal time constant
    const TARGET_HOT_C = 68;     // equilibrium, fan OFF
    const TARGET_COOLED_C = 50;  // equilibrium, fan ON
    const FAN_ON_C = 65;         // = cooling_threshold_c
    const FAN_OFF_C = 60;        // hysteresis lower bound
    const target = this.fanActive ? TARGET_COOLED_C : TARGET_HOT_C;
    this.coreTempC += (target - this.coreTempC) * (1 - Math.exp(-dt / TAU_S));
    if (!this.fanActive && this.coreTempC >= FAN_ON_C) this.fanActive = true;
    else if (this.fanActive && this.coreTempC <= FAN_OFF_C) this.fanActive = false;
    const fan_active = this.fanActive;

    const thermistors_c: ThermistorChannels = [
      thermistorTemp(this.coreTempC, t, this.thermistor_phases[0]),
      thermistorTemp(this.coreTempC, t, this.thermistor_phases[1]),
      thermistorTemp(this.coreTempC, t, this.thermistor_phases[2]),
      thermistorTemp(this.coreTempC, t, this.thermistor_phases[3]),
      thermistorTemp(this.coreTempC, t, this.thermistor_phases[4]),
      thermistorTemp(this.coreTempC, t, this.thermistor_phases[5]),
      thermistorTemp(this.coreTempC, t, this.thermistor_phases[6]),
      thermistorTemp(this.coreTempC, t, this.thermistor_phases[7]),
    ];

    const pa_currents_ma: PACurrentChannels = [
      paCurrent(t, 0),  paCurrent(t, 1),  paCurrent(t, 2),  paCurrent(t, 3),
      paCurrent(t, 4),  paCurrent(t, 5),  paCurrent(t, 6),  paCurrent(t, 7),
      paCurrent(t, 8),  paCurrent(t, 9),  paCurrent(t, 10), paCurrent(t, 11),
      paCurrent(t, 12), paCurrent(t, 13), paCurrent(t, 14), paCurrent(t, 15),
    ];

    // Mechanical sweep — 50 stepper positions, full revolution every 6.25 s.
    // Real surveillance radars run 5-15 RPM; we land at ~9.6 RPM so the
    // operator can comfortably track the beam vector visually.
    const mech_period_s = 50 / 8;
    const scan_index_mechanical =
      (Math.floor((t / mech_period_s) * RADAR_CONSTANTS.STEPPER_POSITIONS) %
        RADAR_CONSTANTS.STEPPER_POSITIONS) +
      1;

    // Electronic sweep — 32 ADAR1000 positions, full sweep every 2 s.
    // Slower than the old 32/240 (133 ms) so the elevation needle doesn't
    // flicker in the 3D dome.
    const elec_period_s = 32 / 16;
    const scan_index_electronic =
      (Math.floor((t / elec_period_s) * RADAR_CONSTANTS.ELECTRONIC_POSITIONS) %
        RADAR_CONSTANTS.ELECTRONIC_POSITIONS) +
      1;

    const beam_azimuth_deg =
      ((scan_index_mechanical - 1) / RADAR_CONSTANTS.STEPPER_POSITIONS) * 360;
    const beam_elevation_deg =
      ((scan_index_electronic - 1) / (RADAR_CONSTANTS.ELECTRONIC_POSITIONS - 1)) *
        (RADAR_CONSTANTS.ELECTRONIC_RANGE_DEG * 2) -
      RADAR_CONSTANTS.ELECTRONIC_RANGE_DEG;

    return {
      thermistors_c,
      pa_currents_ma,
      cooling_fan_active: fan_active,
      cooling_threshold_c: 65,
      agc_gain: Math.round(Math.sin(t * 0.3) * 3),
      agc_enabled: true,
      agc_saturation_ratio: Math.max(
        0,
        Math.sin(t * 0.5) * 0.005 + gaussianNoise(0.001),
      ),
      beam_azimuth_deg,
      beam_elevation_deg,
      scan_index_mechanical,
      scan_index_electronic,
      frame_count: frame_id,
      dropped_frames: this.dropped_frames,
      data_rate_bps: 6_200_000 + Math.round(gaussianNoise(100_000)),
    };
  }

  // ── System ─────────────────────────────────────────────────────────────

  private simulateSystem(t: number, timestamp_ms: number): SystemState {
    const ocxo_total = this.config.ocxo_warmup_s;
    const ocxo_elapsed = Math.min(t, ocxo_total);
    const ocxo_warm = t >= ocxo_total;

    const connection: ConnectionState = ocxo_warm ? 'MOCK' : 'OCXO_WARMUP';
    const gps_fix_quality: GpsFixQuality = 1;

    return {
      connection,
      ocxo_warm,
      ocxo_warmup_elapsed_s: ocxo_elapsed,
      ocxo_warmup_total_s: ocxo_total,
      gps_lat: this.config.origin_lat + Math.sin(t * 0.05) * 0.00001,
      gps_lon: this.config.origin_lon + Math.cos(t * 0.05) * 0.00001,
      gps_alt_m: 42 + Math.sin(t * 0.1) * 0.5,
      gps_fix_quality,
      gps_satellites: 11,
      imu_pitch_deg: Math.sin(t * 0.2) * 0.5,
      imu_roll_deg: Math.cos(t * 0.15) * 0.8,
      imu_heading_deg: 180,
      baro_alt_m: 42 + Math.sin(t * 0.05) * 0.3,
      baro_pressure_hpa: 1013.25 + Math.sin(t * 0.02) * 1.5,
      server_timestamp_ms: timestamp_ms,
      uptime_s: t,
    };
  }

  // ── Alarms ─────────────────────────────────────────────────────────────

  private maybeGenerateAlarm(timestamp_ms: number): void {
    if (Math.random() > this.config.alarm_probability_per_frame) return;

    const choice = Math.random();
    if (choice < 0.5) {
      const idx = Math.floor(Math.random() * 16);
      const value = 510 + Math.random() * 80;
      this.pendingAlarms.push({
        id: makeUuid(),
        timestamp_ms,
        category: 'PA_CURRENT',
        severity: value > 550 ? 'critical' : 'warning',
        source: `PA_${idx + 1}`,
        message: `Quiescent current ${value.toFixed(0)} mA exceeds critical threshold ${RADAR_CONSTANTS.PA_CURRENT_CRITICAL_MA} mA`,
        value,
        threshold: RADAR_CONSTANTS.PA_CURRENT_CRITICAL_MA,
        acknowledged: false,
        acknowledged_at_ms: null,
        acknowledged_by: null,
      });
    } else {
      const idx = Math.floor(Math.random() * 8);
      const value = 66 + Math.random() * 6;
      this.pendingAlarms.push({
        id: makeUuid(),
        timestamp_ms,
        category: 'THERMISTOR',
        severity: 'warning',
        source: `THERMISTOR_${idx + 1}`,
        message: `Zone temperature ${value.toFixed(1)}°C above warning threshold ${RADAR_CONSTANTS.THERMISTOR_WARNING_MAX_C}°C`,
        value,
        threshold: RADAR_CONSTANTS.THERMISTOR_WARNING_MAX_C,
        acknowledged: false,
        acknowledged_at_ms: null,
        acknowledged_by: null,
      });
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS — pure functions, exported only for tests / reuse
// ════════════════════════════════════════════════════════════════════════════

/** Standard-normal noise scaled by `stddev`. Box-Muller transform. */
export function gaussianNoise(stddev: number): number {
  const u1 = Math.max(Math.random(), 1e-12);
  const u2 = Math.random();
  return stddev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Per-channel thermistor reading: the shared core temperature (integrated by
 * the closed-loop thermostat in MockEngine.simulateTelemetry) plus a small
 * per-channel spatial gradient and sensor noise.
 */
export function thermistorTemp(
  coreC: number,
  t: number,
  channelPhase: number,
): number {
  const channelMod = Math.sin(t * 0.1 + channelPhase) * 2;
  return coreC + channelMod + gaussianNoise(0.4);
}

/** PA Idq with ±15 mA sinusoidal ripple and small Gaussian noise. */
export function paCurrent(t: number, channelIndex: number): number {
  const BASE_MA = 280;
  const phase = channelIndex * 0.4;
  const ripple = Math.sin(t * 0.2 + phase) * 15;
  return BASE_MA + ripple + gaussianNoise(3);
}

/**
 * Kinematic threat evaluation from range + radial velocity (Doppler).
 *
 * Convention: doppler_mps < 0 = closing (range decreasing). A range/Doppler
 * radar has no angle-rate, so time-to-go along the line of sight,
 * TTG = range / closing_speed, is the correct available intercept proxy. Bare
 * range alone is tactically backwards — a 1200 m contact closing fast is more
 * dangerous than a 300 m one flying tangentially. Escalation therefore keys off
 * TTG, with the inner keep-out as a hard floor.
 */
export function deriveThreatLevel(
  range_m: number,
  doppler_mps: number,
): ThreatLevel {
  const C = RADAR_CONSTANTS;
  const speed = Math.abs(doppler_mps);
  const closingSpeed = -doppler_mps; // > 0 when inbound
  const ttg = closingSpeed > 0 ? range_m / closingSpeed : Infinity;

  // Critical — imminent: closing and either inside keep-out or short TTG.
  if (closingSpeed > 0 && (range_m < C.THREAT_KEEPOUT_M || ttg < C.THREAT_TTG_CRITICAL_S)) {
    return 'critical';
  }
  // Inside the keep-out but not closing (tangential / receding) — still high.
  if (range_m < C.THREAT_KEEPOUT_M) return 'warning';
  // Closing with a short-ish TTG, or a fast mid-range mover.
  if (closingSpeed > 0 && ttg < C.THREAT_TTG_WARNING_S) return 'warning';
  if (range_m < 500 && speed > C.THREAT_FAST_MOVER_MPS) return 'warning';
  // Within the surveillance envelope.
  if (range_m < C.THREAT_CAUTION_M) return 'caution';
  return 'nominal';
}

/** crypto.randomUUID() shim — falls back to RFC4122-shaped Math.random in
 *  ancient environments. Modern browsers (and Node ≥ 14.17) have it natively. */
function makeUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback — NOT cryptographically secure, only used to keep ids unique.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
