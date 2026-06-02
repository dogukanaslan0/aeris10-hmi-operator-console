"""Pydantic schemas — mirror frontend/src/types/radar.ts exactly.

This is the canonical Python definition of the wire protocol. If you change
a field here, change it in radar.ts too — the frontend's discriminated
unions are the type-checked compile-time counterpart.

Strict mode: `extra="forbid"` everywhere so unknown fields fail loud rather
than silently coercing.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


# ════════════════════════════════════════════════════════════════════════════
# ENUM-LIKE LITERALS
# ════════════════════════════════════════════════════════════════════════════

ThreatLevel = Literal["nominal", "caution", "warning", "critical"]
TargetClassification = Literal["unknown", "bird", "drone", "aircraft", "vehicle"]
ConnectionState = Literal[
    "DISCONNECTED",
    "CONNECTING",
    "OCXO_WARMUP",
    "ARMED",
    "SCANNING",
    "FAULT",
    "MOCK",
]
FrameSource = Literal["live", "mock", "replay"]
GpsFixQuality = Literal[0, 1, 2, 3]
AlarmCategory = Literal[
    "PA_CURRENT",
    "THERMISTOR",
    "FRAME_DROP",
    "CONNECTION",
    "GPS",
    "OCXO",
    "AGC_SATURATION",
    "SYSTEM",
]
AlarmSeverity = Literal["info", "warning", "critical"]
RadarVariant = Literal["AERIS-10N", "AERIS-10E"]
RangeBins = Literal[64, 512, 1024, 2048]
ScanMode = Literal["FULL_360", "SECTOR"]
TargetPriority = Literal[1, 2, 3]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ════════════════════════════════════════════════════════════════════════════
# CORE DATA
# ════════════════════════════════════════════════════════════════════════════


class RadarTarget(_Strict):
    id: str
    timestamp_ms: int

    range_m: float
    azimuth_deg: float
    elevation_deg: float

    x_m: float
    y_m: float
    z_m: float

    doppler_mps: float

    snr_db: float
    rcs_dbsm: float

    threat_level: ThreatLevel
    classification: TargetClassification


class TelemetryData(_Strict):
    thermistors_c: list[float] = Field(min_length=8, max_length=8)
    pa_currents_ma: list[float] = Field(min_length=16, max_length=16)

    cooling_fan_active: bool
    cooling_threshold_c: float

    agc_gain: int
    agc_enabled: bool
    agc_saturation_ratio: float

    beam_azimuth_deg: float
    beam_elevation_deg: float
    scan_index_mechanical: int
    scan_index_electronic: int

    frame_count: int
    dropped_frames: int
    data_rate_bps: int


class SystemState(_Strict):
    connection: ConnectionState

    ocxo_warm: bool
    ocxo_warmup_elapsed_s: float
    ocxo_warmup_total_s: float

    gps_lat: float
    gps_lon: float
    gps_alt_m: float
    gps_fix_quality: GpsFixQuality
    gps_satellites: int

    imu_pitch_deg: float
    imu_roll_deg: float
    imu_heading_deg: float

    baro_alt_m: float
    baro_pressure_hpa: float

    server_timestamp_ms: int
    uptime_s: float


class RadarFrame(_Strict):
    frame_id: int
    timestamp_ms: int
    targets: list[RadarTarget]
    telemetry: TelemetryData
    system: SystemState
    source: FrameSource


# ════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ════════════════════════════════════════════════════════════════════════════


class ScanSector(_Strict):
    azimuth_start_deg: float
    azimuth_end_deg: float
    azimuth_step_deg: float
    elevation_deg: float
    dwell_time_ms: float


class RadarConfig(_Strict):
    variant: RadarVariant
    max_range_m: float
    range_bins: RangeBins
    chirp_duration_us: float
    prf_hz: float

    azimuth_start_deg: float
    azimuth_end_deg: float
    elevation_deg: float
    scan_mode: ScanMode
    sector: Optional[ScanSector]

    rx_gain_db: float
    cfar_threshold_db: float
    agc_enabled: bool
    agc_target_db: float

    cooling_threshold_c: float

    map_center_lat: float
    map_center_lon: float
    map_center_manual: bool


class TargetAnnotation(_Strict):
    target_id: str
    label: str
    priority: TargetPriority
    locked: bool
    note: str
    created_at_ms: int


# ════════════════════════════════════════════════════════════════════════════
# ALARMS
# ════════════════════════════════════════════════════════════════════════════


class AlarmEvent(_Strict):
    id: str
    timestamp_ms: int
    category: AlarmCategory
    severity: AlarmSeverity
    source: str
    message: str
    value: Optional[float] = None
    threshold: Optional[float] = None
    acknowledged: bool
    acknowledged_at_ms: Optional[int] = None
    acknowledged_by: Optional[str] = None


# ════════════════════════════════════════════════════════════════════════════
# WEBSOCKET WIRE PROTOCOL — server → client
# ════════════════════════════════════════════════════════════════════════════


class HandshakePayload(_Strict):
    server_version: str
    mock: bool
    protocol_version: int


class ConfigAckPayload(_Strict):
    config_id: str
    success: bool
    error: Optional[str] = None


class FrameMessage(_Strict):
    type: Literal["FRAME"] = "FRAME"
    payload: RadarFrame


class AlarmMessage(_Strict):
    type: Literal["ALARM"] = "ALARM"
    payload: AlarmEvent


class HandshakeMessage(_Strict):
    type: Literal["HANDSHAKE"] = "HANDSHAKE"
    payload: HandshakePayload


class ConfigAckMessage(_Strict):
    type: Literal["CONFIG_ACK"] = "CONFIG_ACK"
    payload: ConfigAckPayload


# ════════════════════════════════════════════════════════════════════════════
# WEBSOCKET WIRE PROTOCOL — client → server
# ════════════════════════════════════════════════════════════════════════════


class ApplyConfigCommand(_Strict):
    type: Literal["APPLY_CONFIG"]
    config_id: str
    payload: dict[str, Any]  # Partial<RadarConfig> — server applies subset


class StartScanCommand(_Strict):
    type: Literal["START_SCAN"]


class StopScanCommand(_Strict):
    type: Literal["STOP_SCAN"]


class AckAlarmCommand(_Strict):
    type: Literal["ACK_ALARM"]
    alarm_id: str
    operator: str


class AnnotateTargetCommand(_Strict):
    type: Literal["ANNOTATE_TARGET"]
    payload: TargetAnnotation


WebSocketCommand = Annotated[
    Union[
        ApplyConfigCommand,
        StartScanCommand,
        StopScanCommand,
        AckAlarmCommand,
        AnnotateTargetCommand,
    ],
    Field(discriminator="type"),
]

# Parse incoming JSON into the discriminated union — use:
#   cmd = command_adapter.validate_python(payload)
command_adapter: TypeAdapter[WebSocketCommand] = TypeAdapter(WebSocketCommand)
