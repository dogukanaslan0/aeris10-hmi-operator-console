"""AerisAdapter — bridges the upstream PLFM_RADAR parser to our schema.

Wiring assumptions (Yol A — readonly):

  - Upstream `radar_protocol.py` is on PYTHONPATH (clone PLFM_RADAR and point
    PYTHONPATH at `9_Firmware/9_3_GUI/`).
  - FPGA streams 11-byte data + 26-byte status packets over USB (FT2232H or
    FT601 — auto-detected).
  - STM32 exposes GPS as a separate USB-CDC port (NMEA over serial). Set
    AERIS_GPS_SERIAL_PORT to point at it.
  - Thermistor / PA current / IMU / baro telemetry is **not** exposed over
    the FPGA USB protocol. We surface zero arrays + flag at the schema level
    (frontend renders a "sensor data unavailable" placeholder).

Hardware quirks honoured (Section 8 of the master directive):

  - PR #115 (live/replay velocity unit consistency) — we read
    `velocity_resolution_mps` from WaveformConfig, never hard-code a value.
  - PR #113 (ADAR1000 channel rotation) — fixed in STM32 firmware
    (`fix/adar1000-channel-rotation` merged to develop). Nothing for us to do.
  - 400 MHz reset blackout — frame-queue empties briefly produce
    `dropped_frames++` rather than crashing.
  - OCXO 3-minute warm-up — STM32 doesn't expose its state, so we declare
    `ocxo_warm=True` once the first frame arrives.
  - 512-bin range — DIRECTIVE WAS WRONG. Real value is 64 bins × ~24 m/bin
    → 1536 m max for the Nexus variant.
  - AGC registers 0x28-0x2C — surfaced from StatusResponse.agc_*.
"""

from __future__ import annotations

import asyncio
import logging
import math
import queue
import threading
import time
import uuid
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ════════════════════════════════════════════════════════════════════════════
# UPSTREAM IMPORTS (best-effort)
# ════════════════════════════════════════════════════════════════════════════

try:
    from radar_protocol import (  # type: ignore[import-not-found]
        FT2232HConnection,
        FT601Connection,
        RadarAcquisition,
        RadarProtocol,
        StatusResponse,
    )

    _UPSTREAM_AVAILABLE = True
except ImportError:
    FT2232HConnection = None  # type: ignore[assignment,misc]
    FT601Connection = None  # type: ignore[assignment,misc]
    RadarAcquisition = None  # type: ignore[assignment,misc]
    RadarProtocol = None  # type: ignore[assignment,misc]
    StatusResponse = None  # type: ignore[assignment,misc]
    _UPSTREAM_AVAILABLE = False

# WaveformConfig lives in v7/models.py — import lazily so the adapter doesn't
# refuse to instantiate if v7 isn't installed.
try:
    from v7.models import WaveformConfig  # type: ignore[import-not-found]

    _WAVEFORM_AVAILABLE = True
except ImportError:
    WaveformConfig = None  # type: ignore[assignment,misc]
    _WAVEFORM_AVAILABLE = False


# ════════════════════════════════════════════════════════════════════════════
# CONSTANTS — fall-backs when v7 not on path
# ════════════════════════════════════════════════════════════════════════════

# These match `v7.models.WaveformConfig` defaults so a fall-back path still
# produces physically meaningful numbers.
_SPEED_OF_LIGHT_MPS = 299_792_458.0
FALLBACK_CARRIER_HZ = 10.5e9        # X-band carrier (10.5 GHz)
FALLBACK_PRF_HZ = 5_988.0           # 1 / 167 µs PRI
FALLBACK_N_DOPPLER_BINS = 32        # detection grid is 64 range × 32 Doppler
FALLBACK_RANGE_RESOLUTION_M = 24.0  # 64 bins × 24 m → 1536 m (AERIS-10N)

# Velocity resolution is NOT a free parameter. The unambiguous Doppler span is
# ±PRF/2, i.e. a velocity span of λ·PRF/2 shared across N Doppler bins:
#     Δv = λ·PRF / (2·N)
# The old hard-coded 5.343 m/s implied N=16, which contradicts the 32-bin grid
# and PRF 5988 Hz (it was 2× too large). Derive it so PRF, bin count and
# velocity resolution can never silently drift apart again. ≈ 2.671 m/s.
_FALLBACK_WAVELENGTH_M = _SPEED_OF_LIGHT_MPS / FALLBACK_CARRIER_HZ
FALLBACK_VELOCITY_RESOLUTION_MPS = (
    _FALLBACK_WAVELENGTH_M * FALLBACK_PRF_HZ / (2.0 * FALLBACK_N_DOPPLER_BINS)
)

# ── Track association (greedy nearest-neighbour) gates + scan ───────────────
_TRACK_GATE_RANGE_M = 60.0    # ~2.5 range bins
_TRACK_GATE_VEL_MPS = 12.0    # ~4 Doppler bins
_TRACK_GATE_AZ_DEG = 12.0     # within ~1.5 stepper steps
_TRACK_EVICT_FRAMES = 150     # drop a track unseen for ~2.5 s at 60 fps
_SCAN_STEP_DEG = 360.0 / 50   # 7.2° per dwell (50 stepper positions)

# Threat evaluation (kinematic) — mirror RADAR_CONSTANTS.THREAT_* in radar.ts.
_THREAT_KEEPOUT_M = 200.0
_THREAT_TTG_CRITICAL_S = 8.0
_THREAT_TTG_WARNING_S = 25.0
_THREAT_FAST_MOVER_MPS = 20.0
_THREAT_CAUTION_M = 1_000.0


# ════════════════════════════════════════════════════════════════════════════
# AERIS ADAPTER
# ════════════════════════════════════════════════════════════════════════════


class AerisAdapter:
    """Live-mode FrameProducer. Speaks to the FPGA via upstream `radar_protocol`."""

    def __init__(
        self,
        *,
        gps_serial_port: Optional[str] = None,
        mock_radar: bool = False,
    ) -> None:
        if not _UPSTREAM_AVAILABLE:
            raise RuntimeError(
                "Upstream PLFM_RADAR parser not on PYTHONPATH. Clone the repo and "
                "add 9_Firmware/9_3_GUI to PYTHONPATH:\n"
                "  git clone https://github.com/NawfalMotii79/PLFM_RADAR ../PLFM_RADAR\n"
                "  export PYTHONPATH=\"$PYTHONPATH:$(realpath ../PLFM_RADAR/9_Firmware/9_3_GUI)\"\n"
                "Or unset AERIS_SERIAL_PORT to use the mock engine."
            )

        # ── USB connection — auto-detect FT601 first (newer/faster), fallback
        #    to FT2232H (legacy/USB-2.0 prototypes) ────────────────────────────
        self.connection = self._auto_detect_connection(mock=mock_radar)

        # ── Frame queue + acquisition thread ────────────────────────────────
        self.frame_queue: queue.Queue = queue.Queue(maxsize=4)
        self.latest_status: Optional[Any] = None
        self.latest_gps: dict[str, Any] = {}
        self.acquisition = RadarAcquisition(  # type: ignore[misc]
            connection=self.connection,
            frame_queue=self.frame_queue,
            recorder=None,
            status_callback=self._on_status,
        )
        self.acquisition.start()

        # ── Waveform config — use upstream value if available ───────────────
        if _WAVEFORM_AVAILABLE and WaveformConfig is not None:
            self.waveform = WaveformConfig()
            self.range_resolution_m = float(self.waveform.range_resolution_m)
            self.velocity_resolution_mps = float(self.waveform.velocity_resolution_mps)
            self.n_doppler_bins = int(self.waveform.n_doppler_bins)
        else:
            logger.warning(
                "v7.models.WaveformConfig not importable — using fallback constants"
            )
            self.waveform = None
            self.range_resolution_m = FALLBACK_RANGE_RESOLUTION_M
            self.velocity_resolution_mps = FALLBACK_VELOCITY_RESOLUTION_MPS
            self.n_doppler_bins = FALLBACK_N_DOPPLER_BINS

        # ── GPS listener (separate USB-CDC port) ────────────────────────────
        self.gps_thread: Optional[threading.Thread] = None
        self._gps_stop = threading.Event()
        if gps_serial_port:
            self._start_gps_listener(gps_serial_port)

        # ── Bookkeeping ─────────────────────────────────────────────────────
        self.frame_count = 0
        self.dropped_frames = 0
        self.start_perf = time.perf_counter()
        self.start_wall = time.time()
        self.pending_alarms: list[dict[str, Any]] = []
        self._first_frame_seen = False

        # ── Tracker state — persistent track ids + dead-reckoned beam sweep ──
        # `_tracks` maps a stable track id to its last-known kinematics so
        # detections can be associated frame-to-frame (see `_associate`).
        self._tracks: dict[str, dict[str, Any]] = {}
        self._next_track_num = 1
        self._scan_az_deg = 0.0

    # ── Public surface (Broadcaster contract) ──────────────────────────────

    async def get_frame(self) -> dict[str, Any]:
        """Pull the latest queued frame and normalise to RadarFrame schema."""
        raw_frame = await asyncio.to_thread(self._pull_latest_frame)
        return self._normalize(raw_frame)

    def send_command(self, opcode: int, value: int, addr: int = 0) -> bool:
        """Build and write a 4-byte FPGA command via the upstream protocol."""
        if RadarProtocol is None:
            return False
        cmd = RadarProtocol.build_command(opcode, value, addr)
        try:
            return bool(self.connection.write(cmd))
        except Exception as err:
            logger.warning("send_command failed: %s", err)
            return False

    def close(self) -> None:
        """Tear down acquisition + GPS threads. Safe to call multiple times."""
        try:
            self.acquisition.stop()
        except Exception:
            pass
        self._gps_stop.set()
        try:
            self.connection.close()
        except Exception:
            pass

    # ── USB auto-detect ────────────────────────────────────────────────────

    def _auto_detect_connection(self, *, mock: bool) -> Any:
        """Try FT601 (USB 3.0) first, fall back to FT2232H (USB 2.0).

        In mock mode, both connections synthesise traffic — return whichever
        opens first. In live mode, refuse to start if neither is present.
        """
        candidates: list[tuple[str, Any]] = [
            ("FT601 (USB 3.0)", FT601Connection),
            ("FT2232H (USB 2.0)", FT2232HConnection),
        ]
        last_err: Optional[Exception] = None
        for label, cls in candidates:
            if cls is None:
                continue
            try:
                conn = cls(mock=mock)
                if conn.open():
                    logger.info("connected via %s", label)
                    return conn
            except Exception as err:
                last_err = err
                logger.debug("%s open failed: %s", label, err)
        raise RuntimeError(
            f"No USB radar device detected (FT601 nor FT2232H). last error: {last_err}"
        )

    # ── Frame production ───────────────────────────────────────────────────

    def _pull_latest_frame(self) -> Optional[Any]:
        """Drain the queue, returning the freshest frame (skip stale backlog)."""
        latest: Optional[Any] = None
        try:
            latest = self.frame_queue.get(timeout=0.5)
        except queue.Empty:
            self.dropped_frames += 1
            return None

        # Drain anything else that piled up while we were busy.
        while True:
            try:
                latest = self.frame_queue.get_nowait()
            except queue.Empty:
                break
        return latest

    def _normalize(self, raw_frame: Optional[Any]) -> dict[str, Any]:
        now_ms = int(time.time() * 1000)
        elapsed_s = time.perf_counter() - self.start_perf
        self.frame_count += 1

        # Advance the dead-reckoned mechanical sweep one dwell per frame.
        self._scan_az_deg = (self._scan_az_deg + _SCAN_STEP_DEG) % 360.0

        if raw_frame is not None:
            self._first_frame_seen = True

        targets = self._extract_targets(raw_frame, now_ms) if raw_frame else []

        return {
            "frame_id": self.frame_count,
            "timestamp_ms": now_ms,
            "targets": targets,
            "telemetry": self._build_telemetry(),
            "system": self._build_system(now_ms, elapsed_s),
            "source": "live",
        }

    # ── Target extraction (inline, no v7 dependency) ───────────────────────

    def _extract_targets(
        self, frame: Any, timestamp_ms: int
    ) -> list[dict[str, Any]]:
        """Convert a range/Doppler detection grid into discrete, *tracked* targets.

        Each FPGA frame is one beam dwell, so every detection in it shares the
        beam's current azimuth (dead-reckoned in `_infer_beam_pose`). Detections
        are then associated frame-to-frame by a greedy nearest-neighbour gate so
        each physical target keeps a STABLE track id across its life. Without this
        the HMI's trails, predictions, pins and selection — all keyed by id —
        break, because the previous `live-{frame}-{i}` id was unique every frame
        (a brand-new "track" 60×/s, so history never accumulated).

        For production-grade detection-to-track linking, route through
        `v7.processing.extract_targets_from_frame` (Kalman/IMM) instead.
        """
        import numpy as np  # local import to keep top-level dep light

        detections = np.argwhere(frame.detections > 0)
        beam_az_deg, beam_el_deg = self._infer_beam_pose()

        if detections.size == 0:
            self._evict_stale_tracks()
            return []

        doppler_center = frame.detections.shape[1] // 2

        # 1) Build raw plots (range / radial velocity / SNR) for this dwell.
        plots: list[dict[str, Any]] = []
        for rbin, dbin in detections:
            range_m = float(rbin) * self.range_resolution_m
            velocity_mps = float(dbin - doppler_center) * self.velocity_resolution_mps
            magnitude = (
                float(frame.magnitude[rbin, dbin])
                if hasattr(frame, "magnitude")
                else 1.0
            )
            snr_db = 10.0 * math.log10(max(magnitude, 1e-9))
            plots.append(
                {
                    "range_m": range_m,
                    "velocity_mps": velocity_mps,
                    "snr_db": snr_db,
                }
            )

        # 2) Associate plots to persistent tracks (stable ids).
        track_ids = self._associate(plots, beam_az_deg)

        # 3) Project to Cartesian (radar at origin, +Y north) and emit.
        out: list[dict[str, Any]] = []
        for plot, track_id in zip(plots, track_ids):
            range_m = plot["range_m"]
            az_rad = math.radians(beam_az_deg - 90)
            el_rad = math.radians(beam_el_deg)
            horizontal = range_m * math.cos(el_rad)
            x_m = horizontal * math.sin(az_rad)
            y_m = horizontal * math.cos(az_rad)
            z_m = range_m * math.sin(el_rad)

            out.append(
                {
                    "id": track_id,
                    "timestamp_ms": timestamp_ms,
                    "range_m": range_m,
                    "azimuth_deg": beam_az_deg,
                    "elevation_deg": beam_el_deg,
                    "x_m": x_m,
                    "y_m": y_m,
                    "z_m": z_m,
                    "doppler_mps": plot["velocity_mps"],
                    "snr_db": plot["snr_db"],
                    "rcs_dbsm": 0.0,  # not derivable from upstream
                    "threat_level": _derive_threat(range_m, plot["velocity_mps"]),
                    "classification": "unknown",
                }
            )

        self._evict_stale_tracks()
        return out

    # ── Track association (greedy nearest-neighbour GNN-lite) ───────────────

    def _associate(self, plots: list[dict[str, Any]], azimuth_deg: float) -> list[str]:
        """Match each plot to the closest in-gate existing track (reusing its
        id) or spawn a new persistent track. One track is consumed per frame."""
        assigned: list[str] = []
        used: set[str] = set()
        for plot in plots:
            best_id: Optional[str] = None
            best_cost = float("inf")
            for tid, tr in self._tracks.items():
                if tid in used:
                    continue
                d_range = abs(tr["range_m"] - plot["range_m"])
                d_vel = abs(tr["doppler_mps"] - plot["velocity_mps"])
                d_az = abs(_shortest_angle_deg(tr["azimuth_deg"], azimuth_deg))
                if (
                    d_range > _TRACK_GATE_RANGE_M
                    or d_vel > _TRACK_GATE_VEL_MPS
                    or d_az > _TRACK_GATE_AZ_DEG
                ):
                    continue
                cost = d_range / _TRACK_GATE_RANGE_M + d_vel / _TRACK_GATE_VEL_MPS
                if cost < best_cost:
                    best_cost = cost
                    best_id = tid
            if best_id is None:
                best_id = f"live-track-{self._next_track_num}"
                self._next_track_num += 1
            used.add(best_id)
            self._tracks[best_id] = {
                "range_m": plot["range_m"],
                "doppler_mps": plot["velocity_mps"],
                "azimuth_deg": azimuth_deg,
                "last_frame": self.frame_count,
            }
            assigned.append(best_id)
        return assigned

    def _evict_stale_tracks(self) -> None:
        """Drop tracks not re-detected within `_TRACK_EVICT_FRAMES`."""
        cutoff = self.frame_count - _TRACK_EVICT_FRAMES
        stale = [tid for tid, tr in self._tracks.items() if tr["last_frame"] < cutoff]
        for tid in stale:
            del self._tracks[tid]

    def _infer_beam_pose(self) -> tuple[float, float]:
        """Dead-reckoned beam pose. Upstream doesn't surface scan_index yet, so
        we integrate a steady mechanical sweep (one 7.2° step per frame in
        `_normalize`). Each frame is treated as one beam dwell, so detections in
        it are tagged with this azimuth — the standard scanning-radar convention,
        which spreads tracks across true bearings instead of stacking them all at
        0°. Replace with the real ADAR1000 channel / scan_index from
        StatusResponse once firmware surfaces it."""
        return self._scan_az_deg, 0.0

    # ── Telemetry (mostly zero — see module docstring) ────────────────────

    def _build_telemetry(self) -> dict[str, Any]:
        status = self.latest_status
        agc_gain = 0
        agc_enabled = False
        agc_saturation_ratio = 0.0
        if status is not None:
            agc_gain = int(getattr(status, "agc_current_gain", 0))
            agc_enabled = bool(getattr(status, "agc_enable", 0))
            agc_saturation_ratio = float(getattr(status, "agc_saturation_count", 0)) / 255.0

        return {
            # Not exposed by upstream USB protocol — flatlined.
            # Frontend heuristic: all-zero → "Sensör verisi yok" badge.
            "thermistors_c": [0.0] * 8,
            "pa_currents_ma": [0.0] * 16,
            "cooling_fan_active": False,
            "cooling_threshold_c": 65.0,
            # AGC — sourced from StatusResponse
            "agc_gain": agc_gain,
            "agc_enabled": agc_enabled,
            "agc_saturation_ratio": agc_saturation_ratio,
            # Beam pose — dead-reckoned mechanical sweep (see _infer_beam_pose)
            "beam_azimuth_deg": self._scan_az_deg,
            "beam_elevation_deg": 0.0,
            "scan_index_mechanical": int(self._scan_az_deg / _SCAN_STEP_DEG) + 1,
            "scan_index_electronic": 1,
            # Link quality
            "frame_count": self.frame_count,
            "dropped_frames": self.dropped_frames,
            "data_rate_bps": 6_200_000,
        }

    # ── System ─────────────────────────────────────────────────────────────

    def _build_system(self, timestamp_ms: int, elapsed_s: float) -> dict[str, Any]:
        # Connection state derivation:
        #   - First frame received yet?       → SCANNING
        #   - Acquisition alive but no frames → CONNECTING
        connection = "SCANNING" if self._first_frame_seen else "CONNECTING"

        gps = self.latest_gps
        return {
            "connection": connection,
            "ocxo_warm": True,
            "ocxo_warmup_elapsed_s": 180.0,
            "ocxo_warmup_total_s": 180.0,
            "gps_lat": float(gps.get("lat", 0.0)),
            "gps_lon": float(gps.get("lon", 0.0)),
            "gps_alt_m": float(gps.get("alt", 0.0)),
            "gps_fix_quality": int(gps.get("fix", 0)),
            "gps_satellites": int(gps.get("sats", 0)),
            # STM32 doesn't pipe IMU/baro to host — zeros until firmware exposes it.
            "imu_pitch_deg": 0.0,
            "imu_roll_deg": 0.0,
            "imu_heading_deg": 0.0,
            "baro_alt_m": 0.0,
            "baro_pressure_hpa": 0.0,
            "server_timestamp_ms": timestamp_ms,
            "uptime_s": elapsed_s,
        }

    # ── Status callback (from RadarAcquisition thread) ─────────────────────

    def _on_status(self, status: Any) -> None:
        self.latest_status = status

    # ── GPS listener (separate USB-CDC) ────────────────────────────────────

    def _start_gps_listener(self, port: str) -> None:
        def reader() -> None:
            try:
                import serial  # type: ignore[import-not-found]

                with serial.Serial(port, baudrate=9600, timeout=1.0) as ser:
                    logger.info("GPS listener attached to %s", port)
                    buf = b""
                    while not self._gps_stop.is_set():
                        chunk = ser.read(256)
                        if not chunk:
                            continue
                        buf += chunk
                        while b"\n" in buf:
                            line, buf = buf.split(b"\n", 1)
                            try:
                                self._parse_nmea(
                                    line.decode("ascii", errors="ignore").strip()
                                )
                            except Exception as err:
                                logger.debug("nmea parse error: %s", err)
            except Exception as err:
                logger.warning("GPS listener failed on %s: %s", port, err)

        self.gps_thread = threading.Thread(target=reader, daemon=True, name="aeris-gps")
        self.gps_thread.start()

    def _parse_nmea(self, line: str) -> None:
        if not line.startswith(("$GPGGA", "$GNGGA")):
            return
        parts = line.split(",")
        if len(parts) < 10:
            return
        try:
            lat_raw, lat_dir = parts[2], parts[3]
            lon_raw, lon_dir = parts[4], parts[5]
            fix = int(parts[6] or "0")
            sats = int(parts[7] or "0")
            alt = float(parts[9] or "0")

            lat = _nmea_to_decimal(lat_raw, lat_dir)
            lon = _nmea_to_decimal(lon_raw, lon_dir)

            # Map NMEA fix quality (0-8) → our 0|1|2|3 union
            fix_simplified = 0
            if fix == 1:
                fix_simplified = 1  # GPS
            elif fix == 2:
                fix_simplified = 2  # DGPS
            elif fix in (4, 5):
                fix_simplified = 3  # RTK fix / float

            self.latest_gps = {
                "lat": lat,
                "lon": lon,
                "alt": alt,
                "fix": fix_simplified,
                "sats": sats,
            }
        except (ValueError, IndexError):
            return


# ════════════════════════════════════════════════════════════════════════════
# HELPERS — pure functions
# ════════════════════════════════════════════════════════════════════════════


def _shortest_angle_deg(a: float, b: float) -> float:
    """Signed shortest angular difference (a − b) wrapped to [-180, 180]."""
    return ((a - b + 180.0) % 360.0) - 180.0


def _nmea_to_decimal(raw: str, direction: str) -> float:
    """Convert an NMEA degree-minute string ('DDMM.MMMM' / 'DDDMM.MMMM') to
    decimal degrees, applying hemisphere sign from direction ('N'/'S'/'E'/'W')."""
    if not raw or "." not in raw:
        return 0.0
    dot_idx = raw.index(".")
    deg_len = dot_idx - 2
    if deg_len <= 0:
        return 0.0
    try:
        degrees = float(raw[:deg_len])
        minutes = float(raw[deg_len:])
    except ValueError:
        return 0.0
    decimal = degrees + minutes / 60.0
    if direction in ("S", "W"):
        decimal = -decimal
    return decimal


def _derive_threat(range_m: float, velocity_mps: float) -> str:
    """Kinematic threat eval — mirror frontend deriveThreatLevel() in mockEngine.ts.

    velocity_mps < 0 = closing. TTG = range / closing_speed is the intercept
    proxy a range/Doppler radar can compute (no angle rate).
    """
    speed = abs(velocity_mps)
    closing_speed = -velocity_mps
    ttg = range_m / closing_speed if closing_speed > 0 else math.inf

    if closing_speed > 0 and (range_m < _THREAT_KEEPOUT_M or ttg < _THREAT_TTG_CRITICAL_S):
        return "critical"
    if range_m < _THREAT_KEEPOUT_M:
        return "warning"
    if closing_speed > 0 and ttg < _THREAT_TTG_WARNING_S:
        return "warning"
    if range_m < 500 and speed > _THREAT_FAST_MOVER_MPS:
        return "warning"
    if range_m < _THREAT_CAUTION_M:
        return "caution"
    return "nominal"
