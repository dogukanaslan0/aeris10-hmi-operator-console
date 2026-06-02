"""Python mock engine — Python mirror of frontend/src/lib/mockEngine.ts.

Produces the same RadarFrame shape so the frontend cannot tell the difference
without inspecting the `source` field. Used whenever AERIS_SERIAL_PORT is
unset or the live adapter fails to initialise.
"""

from __future__ import annotations

import math
import random
import time
import uuid
from dataclasses import dataclass
from typing import Any


# ── Mock thresholds (mirror RADAR_CONSTANTS in radar.ts) ──────────────────
# NEXUS_MAX_RANGE_M = 64 range bins × 24 m/bin = 1536 m. All mock targets must
# seed within this radius or they clamp to the PPI's outer ring on the frontend.
PA_CURRENT_CRITICAL_MA = 500
THERMISTOR_WARNING_C = 65
NEXUS_MAX_RANGE_M = 1_536

# Threat evaluation (kinematic) — mirror RADAR_CONSTANTS.THREAT_* in radar.ts.
THREAT_KEEPOUT_M = 200.0
THREAT_TTG_CRITICAL_S = 8.0
THREAT_TTG_WARNING_S = 25.0
THREAT_FAST_MOVER_MPS = 20.0
THREAT_CAUTION_M = 1_000.0


@dataclass
class _TargetSeed:
    id: str
    classification: str
    base_range_m: float
    range_amplitude_m: float
    base_azimuth_deg: float
    azimuth_rate_dps: float
    base_elevation_deg: float
    elevation_amplitude_deg: float
    doppler_base_mps: float
    doppler_amplitude_mps: float
    rcs_dbsm: float
    phase: float
    snr_base_db: float


class MockEngine:
    """Mock-mode FrameProducer. Compatible with `Broadcaster`."""

    def __init__(
        self,
        ocxo_warmup_s: float = 10.0,
        origin_lat: float = 41.0082,
        origin_lon: float = 28.9784,
        alarm_probability_per_frame: float = 0.0005,
    ) -> None:
        self.ocxo_warmup_s = ocxo_warmup_s
        self.origin_lat = origin_lat
        self.origin_lon = origin_lon
        self.alarm_probability_per_frame = alarm_probability_per_frame

        self._start_perf = time.perf_counter()
        self._start_wall = time.time()
        self._frame_id = 0
        self._dropped_frames = 0
        self.pending_alarms: list[dict[str, Any]] = []

        self._targets = self._seed_targets()
        self._thermistor_phases = [0.0, 0.7, 1.4, 2.1, 2.8, 3.5, 4.2, 4.9]
        self._pa_phases = [i * 0.4 for i in range(16)]

        # Closed-loop thermal state (see _simulate_telemetry).
        self._core_temp_c = 25.0
        self._fan_active = False
        self._last_thermal_t = 0.0

    # ── Public API ──────────────────────────────────────────────────────────

    def next_frame(self) -> dict[str, Any]:
        elapsed_s = time.perf_counter() - self._start_perf
        timestamp_ms = int((self._start_wall + elapsed_s) * 1000)
        self._frame_id += 1
        frame_id = self._frame_id

        targets = [
            self._simulate_target(seed, elapsed_s, timestamp_ms)
            for seed in self._targets
        ]
        telemetry = self._simulate_telemetry(elapsed_s, frame_id)
        system = self._simulate_system(elapsed_s, timestamp_ms)

        self._maybe_generate_alarm(timestamp_ms)

        return {
            "frame_id": frame_id,
            "timestamp_ms": timestamp_ms,
            "targets": targets,
            "telemetry": telemetry,
            "system": system,
            "source": "mock",
        }

    async def get_frame(self) -> dict[str, Any]:
        """Async wrapper — broadcaster awaits this regardless of source."""
        return self.next_frame()

    # ── Target seeds ────────────────────────────────────────────────────────

    def _seed_targets(self) -> list[_TargetSeed]:
        # Ranges chosen so every target (base ± range_amplitude oscillation)
        # stays inside NEXUS_MAX_RANGE_M = 1536 m and remains visible on the
        # frontend's default display scale. Mirrors mockEngine.ts seed layout.
        return [
            self._make_bird("mock-bird-1", 850, 45),
            self._make_bird("mock-bird-2", 1200, 220),
            self._make_drone("mock-drone-1", 1080, 110),
            self._make_aircraft("mock-aircraft-1", 900, 290),
        ]

    def _make_bird(self, id_: str, r: float, az: float) -> _TargetSeed:
        return _TargetSeed(
            id=id_,
            classification="bird",
            base_range_m=r,
            range_amplitude_m=50,
            base_azimuth_deg=az,
            azimuth_rate_dps=3,
            base_elevation_deg=6,
            elevation_amplitude_deg=2,
            doppler_base_mps=0,
            doppler_amplitude_mps=2,
            rcs_dbsm=-20,
            phase=random.random() * 2 * math.pi,
            snr_base_db=12,
        )

    def _make_drone(self, id_: str, r: float, az: float) -> _TargetSeed:
        return _TargetSeed(
            id=id_,
            classification="drone",
            base_range_m=r,
            range_amplitude_m=200,
            base_azimuth_deg=az,
            azimuth_rate_dps=8,
            base_elevation_deg=15,
            elevation_amplitude_deg=4,
            doppler_base_mps=-3,
            doppler_amplitude_mps=15,
            rcs_dbsm=-10,
            phase=random.random() * 2 * math.pi,
            snr_base_db=22,
        )

    def _make_aircraft(self, id_: str, r: float, az: float) -> _TargetSeed:
        return _TargetSeed(
            id=id_,
            classification="aircraft",
            base_range_m=r,
            range_amplitude_m=400,
            base_azimuth_deg=az,
            azimuth_rate_dps=12,
            base_elevation_deg=22,
            elevation_amplitude_deg=3,
            doppler_base_mps=-8,
            doppler_amplitude_mps=25,
            rcs_dbsm=5,
            phase=random.random() * 2 * math.pi,
            snr_base_db=35,
        )

    def _simulate_target(
        self, seed: _TargetSeed, t: float, timestamp_ms: int
    ) -> dict[str, Any]:
        range_m = seed.base_range_m + math.sin(t * 0.3 + seed.phase) * seed.range_amplitude_m

        azimuth_raw = seed.base_azimuth_deg + t * seed.azimuth_rate_dps
        azimuth_deg = ((azimuth_raw % 360) + 360) % 360

        elevation_deg = (
            seed.base_elevation_deg
            + math.sin(t * 0.5 + seed.phase) * seed.elevation_amplitude_deg
        )

        doppler_mps = (
            seed.doppler_base_mps
            + math.sin(t * 0.7 + seed.phase) * seed.doppler_amplitude_mps
        )

        # SNR follows the radar range equation (SNR ∝ RCS·R⁻⁴): snr_base_db is
        # the SNR at the seed's nominal range; closing strengthens the return,
        # receding weakens it — no longer a flat per-class constant.
        nominal_range = max(1.0, seed.base_range_m)
        snr_db = (
            seed.snr_base_db
            - 40.0 * math.log10(range_m / nominal_range)
            + _gaussian_noise(1.5)
        )

        az_rad = math.radians(azimuth_deg - 90)
        el_rad = math.radians(elevation_deg)
        horizontal = range_m * math.cos(el_rad)
        x_m = horizontal * math.sin(az_rad)
        y_m = horizontal * math.cos(az_rad)
        z_m = range_m * math.sin(el_rad)

        return {
            "id": seed.id,
            "timestamp_ms": timestamp_ms,
            "range_m": range_m,
            "azimuth_deg": azimuth_deg,
            "elevation_deg": elevation_deg,
            "x_m": x_m,
            "y_m": y_m,
            "z_m": z_m,
            "doppler_mps": doppler_mps,
            "snr_db": snr_db,
            "rcs_dbsm": seed.rcs_dbsm + _gaussian_noise(0.5),
            "threat_level": _derive_threat(range_m, doppler_mps),
            "classification": seed.classification,
        }

    # ── Telemetry ───────────────────────────────────────────────────────────

    def _simulate_telemetry(self, t: float, frame_id: int) -> dict[str, Any]:
        # Closed-loop cooling: first-order thermal mass + hysteresis thermostat.
        # Fan engages at the cooling threshold (65 °C) and releases at 60 °C —
        # not on a fixed timer — so the core duty-cycles inside the warning band.
        dt = max(0.0, min(2.0, t - self._last_thermal_t))
        self._last_thermal_t = t
        tau_s = 90.0
        target = 50.0 if self._fan_active else 68.0
        self._core_temp_c += (target - self._core_temp_c) * (1.0 - math.exp(-dt / tau_s))
        if not self._fan_active and self._core_temp_c >= 65.0:
            self._fan_active = True
        elif self._fan_active and self._core_temp_c <= 60.0:
            self._fan_active = False
        fan_active = self._fan_active

        thermistors_c = [
            _thermistor_temp(self._core_temp_c, t, phase)
            for phase in self._thermistor_phases
        ]
        pa_currents_ma = [_pa_current(t, i) for i in range(16)]

        # Scan indices — mirror frontend
        mech_period_s = 50 / 60
        scan_idx_mech = (int((t / mech_period_s) * 50) % 50) + 1
        elec_period_s = 32 / 240
        scan_idx_elec = (int((t / elec_period_s) * 32) % 32) + 1

        beam_az = ((scan_idx_mech - 1) / 50) * 360
        beam_el = ((scan_idx_elec - 1) / 31) * 90 - 45

        return {
            "thermistors_c": thermistors_c,
            "pa_currents_ma": pa_currents_ma,
            "cooling_fan_active": fan_active,
            "cooling_threshold_c": 65,
            "agc_gain": round(math.sin(t * 0.3) * 3),
            "agc_enabled": True,
            "agc_saturation_ratio": max(
                0.0, math.sin(t * 0.5) * 0.005 + _gaussian_noise(0.001)
            ),
            "beam_azimuth_deg": beam_az,
            "beam_elevation_deg": beam_el,
            "scan_index_mechanical": scan_idx_mech,
            "scan_index_electronic": scan_idx_elec,
            "frame_count": frame_id,
            "dropped_frames": self._dropped_frames,
            "data_rate_bps": 6_200_000 + round(_gaussian_noise(100_000)),
        }

    # ── System ──────────────────────────────────────────────────────────────

    def _simulate_system(self, t: float, timestamp_ms: int) -> dict[str, Any]:
        ocxo_total = self.ocxo_warmup_s
        ocxo_elapsed = min(t, ocxo_total)
        ocxo_warm = t >= ocxo_total

        connection = "MOCK" if ocxo_warm else "OCXO_WARMUP"

        return {
            "connection": connection,
            "ocxo_warm": ocxo_warm,
            "ocxo_warmup_elapsed_s": ocxo_elapsed,
            "ocxo_warmup_total_s": ocxo_total,
            "gps_lat": self.origin_lat + math.sin(t * 0.05) * 0.00001,
            "gps_lon": self.origin_lon + math.cos(t * 0.05) * 0.00001,
            "gps_alt_m": 42 + math.sin(t * 0.1) * 0.5,
            "gps_fix_quality": 1,
            "gps_satellites": 11,
            "imu_pitch_deg": math.sin(t * 0.2) * 0.5,
            "imu_roll_deg": math.cos(t * 0.15) * 0.8,
            "imu_heading_deg": 180,
            "baro_alt_m": 42 + math.sin(t * 0.05) * 0.3,
            "baro_pressure_hpa": 1013.25 + math.sin(t * 0.02) * 1.5,
            "server_timestamp_ms": timestamp_ms,
            "uptime_s": t,
        }

    # ── Alarms ──────────────────────────────────────────────────────────────

    def _maybe_generate_alarm(self, timestamp_ms: int) -> None:
        if random.random() > self.alarm_probability_per_frame:
            return

        if random.random() < 0.5:
            idx = random.randint(0, 15)
            value = 510 + random.random() * 80
            severity = "critical" if value > 550 else "warning"
            self.pending_alarms.append(
                {
                    "id": str(uuid.uuid4()),
                    "timestamp_ms": timestamp_ms,
                    "category": "PA_CURRENT",
                    "severity": severity,
                    "source": f"PA_{idx + 1}",
                    "message": (
                        f"Quiescent current {value:.0f} mA exceeds critical threshold "
                        f"{PA_CURRENT_CRITICAL_MA} mA"
                    ),
                    "value": value,
                    "threshold": float(PA_CURRENT_CRITICAL_MA),
                    "acknowledged": False,
                    "acknowledged_at_ms": None,
                    "acknowledged_by": None,
                }
            )
        else:
            idx = random.randint(0, 7)
            value = 66 + random.random() * 6
            self.pending_alarms.append(
                {
                    "id": str(uuid.uuid4()),
                    "timestamp_ms": timestamp_ms,
                    "category": "THERMISTOR",
                    "severity": "warning",
                    "source": f"THERMISTOR_{idx + 1}",
                    "message": (
                        f"Zone temperature {value:.1f}°C above warning threshold "
                        f"{THERMISTOR_WARNING_C}°C"
                    ),
                    "value": value,
                    "threshold": float(THERMISTOR_WARNING_C),
                    "acknowledged": False,
                    "acknowledged_at_ms": None,
                    "acknowledged_by": None,
                }
            )


# ════════════════════════════════════════════════════════════════════════════
# HELPERS — module-level, pure
# ════════════════════════════════════════════════════════════════════════════


def _gaussian_noise(stddev: float) -> float:
    """Box-Muller standard-normal noise scaled by stddev."""
    return random.gauss(0.0, stddev)


def _thermistor_temp(core_c: float, t: float, phase: float) -> float:
    """Per-channel reading: shared core temperature + per-channel gradient + noise."""
    channel_mod = math.sin(t * 0.1 + phase) * 2
    return core_c + channel_mod + _gaussian_noise(0.4)


def _pa_current(t: float, channel_index: int) -> float:
    BASE_MA = 280
    phase = channel_index * 0.4
    ripple = math.sin(t * 0.2 + phase) * 15
    return BASE_MA + ripple + _gaussian_noise(3)


def _derive_threat(range_m: float, doppler_mps: float) -> str:
    """Kinematic threat eval — mirror frontend deriveThreatLevel() in mockEngine.ts.

    doppler_mps < 0 = closing. TTG = range / closing_speed is the intercept
    proxy a range/Doppler radar can actually compute (it has no angle rate), so
    a far-but-fast inbound contact escalates ahead of a near tangential one.
    """
    speed = abs(doppler_mps)
    closing_speed = -doppler_mps
    ttg = range_m / closing_speed if closing_speed > 0 else math.inf

    if closing_speed > 0 and (range_m < THREAT_KEEPOUT_M or ttg < THREAT_TTG_CRITICAL_S):
        return "critical"
    if range_m < THREAT_KEEPOUT_M:
        return "warning"
    if closing_speed > 0 and ttg < THREAT_TTG_WARNING_S:
        return "warning"
    if range_m < 500 and speed > THREAT_FAST_MOVER_MPS:
        return "warning"
    if range_m < THREAT_CAUTION_M:
        return "caution"
    return "nominal"
