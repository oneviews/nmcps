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

# NMCPS-ADR-0024：无控制器的交换机必须落到 standalone。
# Mininet 的 OVSSwitch 默认 failMode='secure'，secure 模式下没有已连接的控制器就既没有
# 流表也没有 NORMAL 兜底，帧全部丢弃（现场：pingall 100% 丢包）；而经 BFF 新建的交换机
# controller 恒为 None，所以「没有控制器」是常态而不是例外。
from types import SimpleNamespace  # noqa: E402

from mininet_gui_backend import api as lab_api  # noqa: E402
from mininet_gui_backend.schema import Switch  # noqa: E402

switch_fail_mode = getattr(lab_api, "switch_fail_mode", None)
if switch_fail_mode is None:
    raise SystemExit("Mininet 后端缺少 switch_fail_mode()：无控制器交换机会退回 secure 并丢光全部帧")
if switch_fail_mode(None) != "standalone":
    raise SystemExit(
        f"switch_fail_mode(None) = {switch_fail_mode(None)!r}，期望 standalone（无控制器时不能 secure）"
    )
if switch_fail_mode("c0") != "secure":
    raise SystemExit(
        f"switch_fail_mode('c0') = {switch_fail_mode('c0')!r}，期望 secure（关联控制器后流表要生效）"
    )


def _switch(switch_type: str, controller):
    return Switch(
        id="s1",
        type="sw",
        name="s1",
        label="s1",
        x=0.0,
        y=0.0,
        ports=4,
        controller=controller,
        switch_type=switch_type,
    )


captured = []


def _record_add_switch(name, **kwargs):
    captured.append((name, kwargs))
    return SimpleNamespace(start=lambda *args, **kw: None)


# `app.net` 只在 lifespan 启动后存在（`app.net = Mininet(...)`），静态自检跑在 lifespan 之外，
# 这里挂一个只记录 `addSwitch` 参数的桩，既不需要 root，也不创建真实 Mininet 网络。
had_net = hasattr(lab_api.app, "net")
previous_net = getattr(lab_api.app, "net", None)
lab_api.app.net = SimpleNamespace(addSwitch=_record_add_switch)
try:
    for switch_type in ("ovs", "ovskernel", "ovsbridge", "legacy"):
        lab_api.add_switch_to_net(_switch(switch_type, None), start=False)
    lab_api.add_switch_to_net(_switch("ovskernel", "c0"), start=False)
finally:
    if had_net:
        lab_api.app.net = previous_net
    else:
        del lab_api.app.net

if len(captured) != 5:
    raise SystemExit(f"add_switch_to_net() 只创建了 {len(captured)} 个交换机，期望 5")

controllerless_modes = [kwargs.get("failMode") for _, kwargs in captured[:4]]
if controllerless_modes != ["standalone"] * 4:
    raise SystemExit(
        f"无控制器交换机得到的 failMode={controllerless_modes}，期望四个 OVS 分支都是 standalone"
    )
if captured[4][1].get("failMode") != "secure":
    raise SystemExit(
        f"关联控制器后 failMode={captured[4][1].get('failMode')!r}，期望 secure"
    )

exported_off = _switch("ovskernel", None).format_switch()
exported_on = _switch("ovskernel", "c0").format_switch()
if 'failMode="standalone"' not in exported_off or 'failMode="secure"' not in exported_on:
    raise SystemExit(
        "导出脚本的 addSwitch 没跟着控制器关联写 failMode："
        f"无控制器={exported_off} / 有控制器={exported_on}"
    )

print("✅ 无控制器交换机默认 standalone：四个 OVS 分支 + 导出脚本一致（NMCPS-ADR-0024）")
print(f"✅ Mininet 后端可导入：{len(http_paths)} 条 HTTP 路径 / {len(ws_paths)} 条 WebSocket 路径，无 CORS 中间件")
print(f"   HTTP: {', '.join(sorted(http_paths)[:3])} …")
print(f"   WS:   {', '.join(sorted(ws_paths))}")
