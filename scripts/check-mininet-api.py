#!/usr/bin/env python3
"""Mininet 仿真后端的最小静态自检。

只做 import + 路由清单校验，不启动 uvicorn、不创建 Mininet 网络。
供仓库根目录 `pnpm lab:check` 使用；需要在 Linux 上具备 Mininet 依赖。
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE_DIR = ROOT / "services" / "mininet-api"

if not (SERVICE_DIR / "mininet_gui_backend" / "api.py").exists():
    raise SystemExit(f"缺少 Mininet 后端源码：{SERVICE_DIR}")

sys.path.insert(0, str(SERVICE_DIR))

from starlette.routing import WebSocketRoute  # noqa: E402

try:
    from mininet_gui_backend.api import app
except ModuleNotFoundError as exc:
    raise SystemExit(
        f"导入 Mininet 后端失败：{exc}。"
        "请先安装 services/mininet-api/requirements.txt 及系统 Mininet 依赖。"
    ) from exc

http_paths = set()
ws_paths = set()

for route in app.routes:
    path = getattr(route, "path", "")
    if path.startswith("/api/mininet/"):
        if isinstance(route, WebSocketRoute):
            ws_paths.add(path)
        else:
            http_paths.add(path)

if not http_paths:
    raise SystemExit("Mininet 后端没有暴露任何 /api/mininet/ HTTP 路由")

if not ws_paths:
    raise SystemExit("Mininet 后端没有暴露任何 /api/mininet/ WebSocket 路由")

# NMCPS-ADR-0022 D9 / W6：旧前端退役后浏览器只经 BFF 访问，后端不再需要 CORS。
# 留着 `CORSMiddleware(allow_origins=["*"])` 等于给任意网页开一扇直连特权后端的门，
# 而且它与 `allow_credentials=True` 同时出现时本身就是无效组合。
cors_middleware = [
    middleware
    for middleware in app.user_middleware
    if "cors" in getattr(middleware.cls, "__name__", "").lower()
]
if cors_middleware:
    raise SystemExit("Mininet 后端仍装了 CORS 中间件：旧前端已退役，浏览器只应经 BFF 访问")

print(f"✅ Mininet 后端可导入：{len(http_paths)} 条 HTTP 路径 / {len(ws_paths)} 条 WebSocket 路径，无 CORS 中间件")
print(f"   HTTP: {', '.join(sorted(http_paths)[:3])} …")
print(f"   WS:   {', '.join(sorted(ws_paths))}")
