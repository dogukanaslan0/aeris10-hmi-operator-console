# AERIS-10 Bridge

Python FastAPI WebSocket bridge between the **PLFM_RADAR** parser and the
AERIS-10 React HMI.

```
┌──────────┐   USB    ┌──────────────┐   WS    ┌──────────┐
│  FPGA    │ ───────▶ │  aeris_bridge│ ──────▶ │  React   │
│ XC7A100T │ (FTDI)   │  + upstream  │  60 Hz  │   HMI    │
└──────────┘          │  radar_proto │         └──────────┘
                      └──────────────┘
                            ▲
┌──────────┐  USB-CDC       │
│  STM32   │ ──────────────▶│  (GPS NMEA)
│  F746    │                │
└──────────┘
```

---

## Mock mode (no hardware required)

```bash
pip install -e .
python -m aeris_bridge
```

The bridge listens on `ws://127.0.0.1:8765/ws/radar`. With no env vars set,
it runs the Python `mock_engine` and the HMI sees `SOURCE: LIVE` (the
backend is real — the data is synthetic).

---

## Live mode (with FPGA + STM32 wired)

### 1. Install the upstream PLFM_RADAR parser

```bash
cd ..
git clone https://github.com/NawfalMotii79/PLFM_RADAR
export PYTHONPATH="$PYTHONPATH:$(realpath PLFM_RADAR/9_Firmware/9_3_GUI)"
```

You need the `develop` branch (PR #115 and #113 are merged there, the velocity
unit fix and ADAR1000 channel rotation fix). Default `main` has neither.

```bash
cd PLFM_RADAR
git checkout develop
cd -
```

### 2. Install the FTDI driver

The FPGA's USB chip is either **FT2232H** (USB 2.0) or **FT601** (USB 3.0).
The adapter auto-detects which is plugged in.

- FT2232H — `pyftdi` (already in `pyproject.toml`)
- FT601 — `ftd3xx` (proprietary, install manually from FTDI's site)

### 3. Configure environment

```bash
# Linux / macOS
export AERIS_LIVE=1
export AERIS_GPS_SERIAL_PORT=/dev/ttyACM0   # STM32 CDC GPS port
python -m aeris_bridge
```

```powershell
# Windows
$env:AERIS_LIVE = "1"
$env:AERIS_GPS_SERIAL_PORT = "COM4"
python -m aeris_bridge
```

The adapter:
1. Tries to open FT601 (USB-3) first.
2. Falls back to FT2232H (USB-2) if FT601 isn't present.
3. Spins the upstream `RadarAcquisition` thread.
4. Starts a separate thread reading NMEA from the STM32 GPS port.
5. Begins streaming `RadarFrame` messages at 60 Hz to the HMI.

If the upstream parser isn't on `PYTHONPATH`, the bridge logs a warning and
falls back to the mock engine automatically — your dev session never sits
blank.

---

## What's live vs. what's still mock

| Field | Source | Status |
|---|---|---|
| `targets[]` (range, doppler, snr) | FPGA detection grid → adapter inline extraction | ✅ live |
| `targets[].azimuth_deg` | Beam pose (TODO — needs scan_index plumbing) | ⚠ defaults to 0 |
| `targets[].rcs_dbsm` | Not derivable from upstream | ⚠ 0 |
| `targets[].threat_level` | Heuristic in adapter | ✅ live |
| `targets[].classification` | Not derivable | ⚠ "unknown" |
| `telemetry.thermistors_c` (8 ch) | **STM32 doesn't expose this** | ❌ zero array |
| `telemetry.pa_currents_ma` (16 ch) | **STM32 doesn't expose this** | ❌ zero array |
| `telemetry.agc_*` | StatusResponse (AGC registers 0x28-0x2C) | ✅ live |
| `telemetry.beam_*` | TODO — scan_index plumbing | ⚠ 0 |
| `system.connection` | Derived from first-frame-received | ✅ live |
| `system.ocxo_warm` | STM32 doesn't expose — assumed true | ⚠ true |
| `system.gps_*` | NMEA on STM32 USB-CDC port | ✅ live (if port set) |
| `system.imu_*` / `baro_*` | **STM32 doesn't expose this** | ❌ zero |

The HMI shows a `⚠ Sensör verisi yok` banner over the right panel when
thermistor + PA arrays are all-zero — operator knows what to expect.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `AERIS_HOST` | `127.0.0.1` | Bind address |
| `AERIS_PORT` | `8765` | Bind port |
| `AERIS_WS_PATH` | `/ws/radar` | WebSocket endpoint |
| `AERIS_LIVE` | _(unset)_ | `1` to attempt live mode |
| `AERIS_GPS_SERIAL_PORT` | _(unset)_ | STM32 USB-CDC GPS port |
| `AERIS_FRAME_RATE` | `60` | Broadcast cadence (Hz) |
| `AERIS_OCXO_WARMUP_S` | `10.0` | Mock OCXO countdown |
| `AERIS_ORIGIN_LAT` | `41.0082` | Mock map centre |
| `AERIS_ORIGIN_LON` | `28.9784` | Mock map centre |
| `AERIS_PROTOCOL_VERSION` | `1` | Handshake protocol version |

---

## Path to full hardware coverage

If you want thermistor / PA / IMU / baro telemetry to flow, the STM32
firmware needs a new opcode (e.g. `TELEMETRY_REQUEST` / `TELEMETRY_RESPONSE`)
that bundles the relevant sensors and ships them periodically over the FPGA
USB tunnel. Then:

1. Extend `radar_protocol.py` upstream with a `parse_telemetry_packet()`.
2. Extend `AerisAdapter._build_telemetry()` to read from
   `self.acquisition.latest_telemetry` instead of returning zeros.
3. Remove the "Sensör verisi yok" banner in `TelemetryPanel.tsx` (it
   self-hides once data flows).

That's a `9_Firmware/9_1_Microcontroller` change (C++ + HAL) plus a parser
PR. Track as a follow-up — Yol B in the project plan.

---

## WebSocket protocol

### Server → Client

| Type | Payload | Cadence |
|---|---|---|
| `HANDSHAKE` | `{server_version, mock, protocol_version}` | once, on connect |
| `FRAME` | `RadarFrame` | `frame_rate_hz` (default 60) |
| `ALARM` | `AlarmEvent` | as they occur |
| `CONFIG_ACK` | `{config_id, success, error}` | in response to `APPLY_CONFIG` |

### Client → Server

| Type | Fields |
|---|---|
| `APPLY_CONFIG` | `config_id`, `payload` (Partial<RadarConfig>) |
| `START_SCAN` | — |
| `STOP_SCAN` | — |
| `ACK_ALARM` | `alarm_id`, `operator` |
| `ANNOTATE_TARGET` | `payload` (TargetAnnotation) |

See [`schemas.py`](./schemas.py) for canonical Pydantic models. Always-on
mirror with [`frontend/src/types/radar.ts`](../frontend/src/types/radar.ts).

---

## Development

```bash
pip install -e ".[dev]"
ruff check aeris_bridge
mypy aeris_bridge
pytest
```

## Smoke test (mock mode only)

```bash
# In one terminal
python -m aeris_bridge

# In another
curl http://127.0.0.1:8765/
# {"service":"AERIS-10 Bridge","version":"0.1.0","mock":true,...}
```

Then connect the HMI (`cd ../frontend && npm run dev`) and watch the
target list populate.
