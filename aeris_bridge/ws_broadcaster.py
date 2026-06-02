"""Broadcaster — fan-out FRAME and ALARM messages to all connected clients.

One asyncio task drives the loop:
  1. Pull next frame from source (adapter or mock)
  2. Send to every registered WebSocket
  3. Drain any source-side pending alarms and send them too
  4. Sleep to maintain frame_rate_hz cadence

Per-channel throttling (telemetry @ 12 Hz, system @ 2 Hz) happens on the
*frontend* — the dispatcher in frameDispatcher.ts checks `frame_id % DIVIDER`.
We send full frames every tick; local-network bandwidth is comfortable
(~480 KB/s at 60 Hz).
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any, Optional

from fastapi import WebSocket

from .schemas import ConfigAckPayload, command_adapter

logger = logging.getLogger(__name__)


class Broadcaster:
    def __init__(
        self,
        source: Any,
        frame_rate_hz: int,
        is_mock: bool,
    ) -> None:
        self.source = source
        self.frame_interval_s = 1.0 / max(1, frame_rate_hz)
        self.is_mock = is_mock
        self.clients: dict[str, WebSocket] = {}
        self._lock = asyncio.Lock()

    # ── Client registry ────────────────────────────────────────────────────

    async def register(self, ws: WebSocket) -> str:
        client_id = str(uuid.uuid4())
        async with self._lock:
            self.clients[client_id] = ws
        logger.info("client %s connected (total=%d)", client_id, len(self.clients))
        return client_id

    async def unregister(self, client_id: str) -> None:
        async with self._lock:
            self.clients.pop(client_id, None)
        logger.info("client %s disconnected (total=%d)", client_id, len(self.clients))

    # ── Command handling (client → server) ─────────────────────────────────

    async def handle_command(self, client_id: str, raw: dict[str, Any]) -> None:
        """Validate and dispatch a client command. Acks APPLY_CONFIG."""
        try:
            cmd = command_adapter.validate_python(raw)
        except Exception as err:
            logger.warning("invalid command from %s: %s — raw=%s", client_id, err, raw)
            return

        cmd_type = cmd.type  # type: ignore[union-attr]

        if cmd_type == "APPLY_CONFIG":
            # Real wiring: push partial config to STM32 over SPI. For now we
            # ack success after a no-op so the frontend can clear pending state.
            await self._send_to(
                client_id,
                {
                    "type": "CONFIG_ACK",
                    "payload": ConfigAckPayload(
                        config_id=cmd.config_id,  # type: ignore[union-attr]
                        success=True,
                        error=None,
                    ).model_dump(),
                },
            )
            logger.info("APPLY_CONFIG acked for %s (id=%s)", client_id, cmd.config_id)  # type: ignore[union-attr]
        elif cmd_type == "ACK_ALARM":
            logger.info(
                "alarm %s acknowledged by %s",
                cmd.alarm_id,  # type: ignore[union-attr]
                cmd.operator,  # type: ignore[union-attr]
            )
        elif cmd_type == "START_SCAN":
            logger.info("START_SCAN from %s", client_id)
        elif cmd_type == "STOP_SCAN":
            logger.info("STOP_SCAN from %s", client_id)
        elif cmd_type == "ANNOTATE_TARGET":
            logger.info(
                "annotation for target %s from %s",
                cmd.payload.target_id,  # type: ignore[union-attr]
                client_id,
            )

    # ── Broadcast loop ─────────────────────────────────────────────────────

    async def run(self) -> None:
        """Main loop — call once via app.lifespan; cancelled on shutdown."""
        next_tick = time.monotonic()
        while True:
            try:
                frame = await self._produce_frame()
                await self._broadcast({"type": "FRAME", "payload": frame})
            except asyncio.CancelledError:
                raise
            except Exception as err:
                logger.warning("frame production failed: %s", err)

            # Drain alarms pending on the source
            pending: Optional[list[dict[str, Any]]] = getattr(
                self.source, "pending_alarms", None
            )
            if pending:
                drained = list(pending)
                pending.clear()
                for alarm in drained:
                    await self._broadcast({"type": "ALARM", "payload": alarm})

            # Pace
            next_tick += self.frame_interval_s
            sleep_for = next_tick - time.monotonic()
            if sleep_for <= 0:
                # We're behind — reset the target so we don't accumulate debt.
                next_tick = time.monotonic()
            else:
                await asyncio.sleep(sleep_for)

    # ── Internals ──────────────────────────────────────────────────────────

    async def _produce_frame(self) -> dict[str, Any]:
        """Call either sync next_frame() or async get_frame() — whichever the
        source exposes. Both shapes are supported."""
        if hasattr(self.source, "get_frame"):
            result = self.source.get_frame()
            if asyncio.iscoroutine(result):
                return await result
            return result
        return self.source.next_frame()

    async def _broadcast(self, message: dict[str, Any]) -> None:
        """Send `message` to every connected client. Dead sockets are pruned."""
        async with self._lock:
            clients = list(self.clients.items())

        dead: list[str] = []
        for client_id, ws in clients:
            try:
                await ws.send_json(message)
            except Exception as err:
                logger.debug("send failed to %s: %s", client_id, err)
                dead.append(client_id)

        if dead:
            async with self._lock:
                for client_id in dead:
                    self.clients.pop(client_id, None)

    async def _send_to(self, client_id: str, message: dict[str, Any]) -> None:
        async with self._lock:
            ws = self.clients.get(client_id)
        if ws is None:
            return
        try:
            await ws.send_json(message)
        except Exception as err:
            logger.debug("send_to failed (%s): %s", client_id, err)
