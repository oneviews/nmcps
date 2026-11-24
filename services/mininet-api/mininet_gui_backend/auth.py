"""入口鉴权（M0 远程化）：`x-lab-token` + WebSocket 的 HMAC 签名查询串。

背景（`docs/ai/simulation-parity.md` §一 / §4.4）：2.0 的仿真端仍在 `90` 单机，但 BFF 可能
不在同一台机器上。1.0 的后端假设「只从回环访问」，一旦绑定到内网地址就没有任何门槛 ——
任何能连到 `:8000` 的进程都能 `full_reset`。

两条通道为什么不是同一个头：

- HTTP：`x-lab-token`（常量时间比较）；
- WebSocket：Node 内置的 `WebSocket` **不能设置请求头**，BFF 只能用查询串带凭据。
  直接把口令塞进查询串会进 access log，所以带的是 `lab_ts` + `lab_sig`
  （`HMAC-SHA256(token, "<path>\\n<ts>")`，120 秒窗口、绑定路径）——
  泄露一条 URL 也换不到别的通道。

未设置 `LAB_API_TOKEN` 时只接受回环客户端（本机现状不变），并在启动时打一条 warning。
本模块只依赖标准库：`pnpm check:engines` 在没有 fastapi 的机器上也要能验签名逻辑。
"""

from __future__ import annotations

import hmac
import ipaddress
import json
import logging
import os
import time
from hashlib import sha256
from typing import Any, Optional

TOKEN_ENV = "LAB_API_TOKEN"
TOKEN_HEADER = b"x-lab-token"
WS_TS_PARAM = "lab_ts"
WS_SIG_PARAM = "lab_sig"
WS_SIGNATURE_WINDOW_SECONDS = 120
PUBLIC_PATHS = frozenset({"/api/health", "/api/version"})
LOOPBACK_HOSTS = frozenset({"localhost", "testclient"})
REASON_TOKEN_REQUIRED = "lab_token_required"
REASON_TOKEN_INVALID = "lab_token_invalid"

logger = logging.getLogger("mininet_gui_backend.auth")


def token_from_env() -> str:
    return (os.environ.get(TOKEN_ENV) or "").strip()


def is_loopback(host: Optional[str]) -> bool:
    """`127.0.0.0/8` / `::1`（含 IPv4-mapped）与几个已知的本机名。"""
    if not host:
        return False
    if host in LOOPBACK_HOSTS:
        return True
    try:
        address = ipaddress.ip_address(host.split("%", 1)[0])
    except ValueError:
        return False
    if address.version == 6 and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return address.is_loopback


def ws_signature(token: str, path: str, ts: str) -> str:
    """BFF 与后端共用的签名算法（`layers/scenario/server/utils/bff/labWsRelay.ts`）。"""
    message = f"{path}\n{ts}".encode("utf-8")
    return hmac.new(token.encode("utf-8"), message, sha256).hexdigest()


def verify_ws_signature(
    token: str,
    path: str,
    ts: str,
    signature: str,
    *,
    now: Optional[int] = None,
    window: int = WS_SIGNATURE_WINDOW_SECONDS,
) -> bool:
    """校验签名是否有效、是否在窗口内（绑定路径，不能拿到别的通道上重放）。"""
    if not token or not ts or not signature:
        return False
    try:
        issued_at = int(ts)
    except ValueError:
        return False
    current = int(time.time()) if now is None else int(now)
    if abs(current - issued_at) > window:
        return False
    return hmac.compare_digest(ws_signature(token, path, ts), signature)


def _header(scope: dict, name: bytes) -> str:
    for key, value in scope.get("headers") or []:
        if key.lower() == name:
            return value.decode("latin-1").strip()
    return ""


def _query_params(scope: dict) -> dict:
    raw = scope.get("query_string") or b""
    params: dict = {}
    for chunk in raw.split(b"&"):
        if not chunk:
            continue
        key, _, value = chunk.partition(b"=")
        params.setdefault(key.decode("latin-1"), value.decode("latin-1"))
    return params


class LabAuthMiddleware:
    """纯 ASGI 中间件：HTTP 与 WebSocket 都在这里判，不分散到各端点。"""

    def __init__(self, app: Any, *, token: str = "", window: int = WS_SIGNATURE_WINDOW_SECONDS) -> None:
        self.app = app
        self._token = token
        self._window = window

    def _authorized(self, scope: dict) -> bool:
        token = self._token
        presented = _header(scope, TOKEN_HEADER)
        if not token:
            client = scope.get("client")
            return bool(client) and is_loopback(client[0])
        if presented and hmac.compare_digest(presented, token):
            return True
        if scope["type"] == "websocket":
            params = _query_params(scope)
            return verify_ws_signature(
                token,
                scope.get("path", ""),
                params.get(WS_TS_PARAM, ""),
                params.get(WS_SIG_PARAM, ""),
                window=self._window,
            )
        return False

    async def _reject(self, send: Any, reason: str) -> None:
        body = json.dumps({"detail": reason}, ensure_ascii=False).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": 401,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"cache-control", b"no-store"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        })
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        if scope.get("path") in PUBLIC_PATHS or self._authorized(scope):
            return await self.app(scope, receive, send)

        reason = REASON_TOKEN_INVALID if self._token else REASON_TOKEN_REQUIRED
        logger.warning("lab api rejected %s %s: %s", scope["type"], scope.get("path"), reason)
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008, "reason": reason})
            return
        await self._reject(send, reason)


def install_lab_auth(app: Any) -> str:
    """挂上中间件并返回生效策略（`token` / `loopback-only`），供启动日志与自检使用。"""
    token = token_from_env()
    app.add_middleware(LabAuthMiddleware, token=token)
    if token:
        logger.info("lab api auth: x-lab-token required (websocket: HMAC query signature)")
        return "token"
    logger.warning(
        "LAB_API_TOKEN is not set: only loopback clients are accepted "
        "(remote BFF needs LAB_API_TOKEN on both sides)"
    )
    return "loopback-only"
