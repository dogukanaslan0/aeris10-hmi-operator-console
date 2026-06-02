"""Bridge configuration — read from environment, immutable at runtime."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Settings:
    # ── Network ─────────────────────────────────────────────────────────────
    host: str = "127.0.0.1"
    port: int = 8765
    ws_path: str = "/ws/radar"

    # ── Live mode ───────────────────────────────────────────────────────────
    # Set `live_mode_enabled` (or AERIS_LIVE=1) to attempt the upstream
    # PLFM_RADAR adapter. USB chip (FT601 vs FT2232H) is auto-detected.
    # Falls back to mock engine if upstream isn't on PYTHONPATH or no device
    # responds.
    live_mode_enabled: bool = False

    # Legacy single-port settings — kept for backward compatibility but the
    # active live path uses upstream `radar_protocol.FT*Connection` instead.
    serial_port: Optional[str] = None
    serial_baud: int = 2_000_000

    # ── GPS (separate USB-CDC port from STM32) ──────────────────────────────
    # NMEA sentences over serial. Leave None to skip GPS — `gps_lat`/`gps_lon`
    # then report 0,0 and the HMI's map will follow operator-manual override.
    gps_serial_port: Optional[str] = None

    # ── Broadcast cadence ───────────────────────────────────────────────────
    frame_rate_hz: int = 60

    # ── Mock-engine knobs ──────────────────────────────────────────────────
    mock_ocxo_warmup_s: float = 10.0
    mock_origin_lat: float = 41.0082
    mock_origin_lon: float = 28.9784

    # ── Protocol ────────────────────────────────────────────────────────────
    protocol_version: int = 1

    @classmethod
    def from_env(cls) -> "Settings":
        # Live mode flag — either explicit AERIS_LIVE=1, or implicit if any
        # of the live-mode env vars is set.
        live_flag = os.getenv("AERIS_LIVE", "").strip().lower() in ("1", "true", "yes")
        serial_port = os.getenv("AERIS_SERIAL_PORT") or None
        gps_port = os.getenv("AERIS_GPS_SERIAL_PORT") or None
        live_mode_enabled = live_flag or bool(serial_port) or bool(gps_port)

        return cls(
            host=os.getenv("AERIS_HOST", cls.host),
            port=int(os.getenv("AERIS_PORT", str(cls.port))),
            ws_path=os.getenv("AERIS_WS_PATH", cls.ws_path),
            live_mode_enabled=live_mode_enabled,
            serial_port=serial_port,
            serial_baud=int(os.getenv("AERIS_SERIAL_BAUD", str(cls.serial_baud))),
            gps_serial_port=gps_port,
            frame_rate_hz=int(os.getenv("AERIS_FRAME_RATE", str(cls.frame_rate_hz))),
            mock_ocxo_warmup_s=float(
                os.getenv("AERIS_OCXO_WARMUP_S", str(cls.mock_ocxo_warmup_s))
            ),
            mock_origin_lat=float(
                os.getenv("AERIS_ORIGIN_LAT", str(cls.mock_origin_lat))
            ),
            mock_origin_lon=float(
                os.getenv("AERIS_ORIGIN_LON", str(cls.mock_origin_lon))
            ),
            protocol_version=int(
                os.getenv("AERIS_PROTOCOL_VERSION", str(cls.protocol_version))
            ),
        )
