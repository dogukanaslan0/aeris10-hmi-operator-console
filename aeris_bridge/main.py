"""
============================================================================
AERIS-10 Command & Control (C2) Tactical Console
────────────────────────────────────────────────────────────────────────────
SYSTEM COMPONENT      : FastAPI Backend Bridge Application Entry
ARCHITECT & DEVELOPER : Doğukan Aslan
LICENSE               : Proprietary / Community Shared Release
============================================================================
"""


from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import Settings
from .mock_engine import MockEngine
from .radar_adapter import AerisAdapter
from .ws_broadcaster import Broadcaster

logger = logging.getLogger(__name__)

# ════════════════════════════════════════════════════════════════════════════
# BOOT — build source and broadcaster
# ════════════════════════════════════════════════════════════════════════════

settings = Settings.from_env()


def _build_source() -> tuple[object, bool]:
    """Returns (source, is_mock). Falls back to mock on any live-init failure."""
    if settings.live_mode_enabled:
        try:
            adapter = AerisAdapter(gps_serial_port=settings.gps_serial_port)
            logger.info(
                "live adapter ready (gps_port=%s)",
                settings.gps_serial_port or "<disabled>",
            )
            return adapter, False
        except Exception as err:
            logger.warning(
                "live adapter unavailable (%s) — falling back to mock engine", err
            )
    return (
        MockEngine(
            ocxo_warmup_s=settings.mock_ocxo_warmup_s,
            origin_lat=settings.mock_origin_lat,
            origin_lon=settings.mock_origin_lon,
        ),
        True,
    )


source, IS_MOCK = _build_source()
broadcaster = Broadcaster(
    source=source,
    frame_rate_hz=settings.frame_rate_hz,
    is_mock=IS_MOCK,
)


# ════════════════════════════════════════════════════════════════════════════
# LIFESPAN
# ════════════════════════════════════════════════════════════════════════════


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    import asyncio

    task = asyncio.create_task(broadcaster.run())
    logger.info(
        "broadcast loop started (mock=%s, fps=%d)",
        IS_MOCK,
        settings.frame_rate_hz,
    )
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        logger.info("broadcast loop stopped")


# ════════════════════════════════════════════════════════════════════════════
# APP
# ════════════════════════════════════════════════════════════════════════════


app = FastAPI(
    title="AERIS-10 Bridge",
    version=__version__,
    lifespan=lifespan,
)

# Permissive CORS — the React HMI may run on a different host/port during
# development. Tighten this in production deployments.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)


@app.get("/")
async def root() -> dict[str, object]:
    return {
        "service": "AERIS-10 Bridge",
        "version": __version__,
        "mock": IS_MOCK,
        "ws_endpoint": settings.ws_path,
        "frame_rate_hz": settings.frame_rate_hz,
        "protocol_version": settings.protocol_version,
    }


@app.websocket(settings.ws_path)
async def radar_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    client_id = await broadcaster.register(websocket)

    try:
        # Send HANDSHAKE immediately so the client knows the source mode and
        # protocol version before frames begin flowing.
        await websocket.send_json(
            {
                "type": "HANDSHAKE",
                "payload": {
                    "server_version": __version__,
                    "mock": IS_MOCK,
                    "protocol_version": settings.protocol_version,
                },
            }
        )

        # Process incoming commands until disconnect.
        while True:
            raw = await websocket.receive_json()
            await broadcaster.handle_command(client_id, raw)
    except WebSocketDisconnect:
        pass
    except Exception as err:
        logger.warning("ws session error (%s): %s", client_id, err)
    finally:
        await broadcaster.unregister(client_id)
