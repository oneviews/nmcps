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

import inspect  # noqa: E402
import re  # noqa: E402

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

# NMCPS-ADR-0024 第二条：运行中加链路时，无控制器的交换机也必须重新初始化端口。
# OVSSwitch.start() 是 del-br + add-br，只有走这一步新链路接口才会 add-port 进 bridge。
# 老实现写的是 `elif node.type == "sw" and node.controller:`，于是 controller=None 的交换机
# （经 BFF 新建的常态）在运行中加链路后端口不在 bridge 里 —— 链路台账有、ARP 也到了交换机，
# 但 bridge 里没有那条 port，帧无处可去，ping 依旧 100% 丢包。
create_link_src = inspect.getsource(lab_api.create_link)
if re.search(r'elif node\.type == "sw"\s+and\s+node\.controller', create_link_src):
    raise SystemExit(
        "create_link() 仍只给有控制器的交换机初始化端口："
        "无控制器交换机在运行中加链路后端口进不了 bridge（NMCPS-ADR-0024）"
    )
if not re.search(r"node\.start\(\s*\[controller_node\]\s+if\s+controller_node\s+else\s+\[\]\s*\)", create_link_src):
    raise SystemExit(
        "create_link() 缺少无控制器交换机的 node.start([]) 分支："
        "运行中新增链路的端口不会被 add-port 进 bridge"
    )
if "node.failMode = switch_fail_mode(" not in create_link_src:
    raise SystemExit(
        "create_link() 重启交换机前没按控制器关联重设 failMode："
        "重启会把 bridge 重建回默认 secure"
    )

# 删除路径的对称要求：Mininet 的 delNode / delLink 只删接口、不通知 OVS，bridge 里会留下
# `ofport: -1` 的鬼端口（`ovs-vsctl list-ports` 看起来链路还在），删节点还会把死链路留在
# app.links 里让 export 输出已不存在的链路。
delete_node_src = inspect.getsource(lab_api.delete_node)
delete_link_src = inspect.getsource(lab_api.delete_link)
for name, src in (("delete_node", delete_node_src), ("delete_link", delete_link_src)):
    if "release_switch_port(" not in src:
        raise SystemExit(
            f"{name}() 删除前没有 release_switch_port()："
            "交换机侧端口会作为 ofport=-1 的鬼端口留在 bridge 里"
        )
if "app.link_attrs.pop(key, None)" not in delete_node_src:
    raise SystemExit(
        "delete_node() 没清理 app.links / app.link_attrs："
        "删节点后 export 仍会输出挂在该节点上的死链路"
    )

# NMCPS-ADR-0026 D3：停网 / 全量重建前必须先等正在跑的 pingall / iperf 收尾。
# `pingFull()` 不可中断，中途拆节点会让上游以 `AttributeError: 'NoneType' object has no
# attribute 'IP'` 崩掉（2026-11-21 实测）。两条路径都漏掉等待就等于把这条裁决写在注释里。
await_idle_src = inspect.getsource(lab_api._await_idle_operations)
if "app.pingall_running" not in await_idle_src or "app.iperf_running" not in await_idle_src:
    raise SystemExit(
        "_await_idle_operations() 没同时看 pingall_running / iperf_running："
        "只等其中一个仍会在另一个跑着时拆节点"
    )
for name in ("stop_network", "full_reset_network"):
    src = inspect.getsource(getattr(lab_api, name))
    if "await _await_idle_operations()" not in src:
        raise SystemExit(
            f"{name}() 拆节点前没有 await _await_idle_operations()："
            "pingall / iperf 跑到一半被拆节点会让上游 AttributeError（NMCPS-ADR-0026 D3）"
        )

# NMCPS-ADR-0026 §5：iperf 不能再回到 Mininet 的 `Net.iperf()`。Debian 打包版的实现用
# `while len(re.findall('/sec', servout)) < 2` 判断收尾，第 2 个 `/sec` 来自 `waitListening()`
# 的 telnet 探测；而本机 iperf 2.2.1 对那条零字节连接不再打印速率行，于是循环永不结束、
# `iperf_running` 卡死、两端 shell 留在 waiting，紧接着的 pingall 直接 500（2026-11-23 实测）。
run_iperf_src = inspect.getsource(lab_api.run_iperf)
if "net.iperf(" in run_iperf_src or "app.net.iperf(" in run_iperf_src:
    raise SystemExit(
        "run_iperf() 又在调 Mininet 的 `Net.iperf()`：打包版实现等第 2 个 /sec 却等不到，"
        "端点会无限挂起并把 iperf_running 卡在 True（NMCPS-ADR-0026 §5）"
    )
for needle, reason in (
    ("subprocess.Popen", "服务端没有自己起进程（收尾就没法保证）"),
    ("subprocess.run", "客户端没有自己的硬超时（上游一发散就永久占住 iperf_running）"),
    ("app.iperf_running = False", "异常路径没有复位 iperf_running"),
):
    if needle not in run_iperf_src:
        raise SystemExit(
            f"run_iperf() {reason}：iperf 挂起后 pingall / stop 会一起被拖住（NMCPS-ADR-0026 §5）"
        )

print("✅ 无控制器交换机默认 standalone：四个 OVS 分支 + 导出脚本一致（NMCPS-ADR-0024）")
print("✅ 停网 / 全量重建都先等 pingall / iperf 收尾（NMCPS-ADR-0026 D3）")
print("✅ 吞吐测试自带子进程与硬超时，不再依赖 Net.iperf()（NMCPS-ADR-0026 §5）")
print(f"✅ Mininet 后端可导入：{len(http_paths)} 条 HTTP 路径 / {len(ws_paths)} 条 WebSocket 路径，无 CORS 中间件")
print(f"   HTTP: {', '.join(sorted(http_paths)[:3])} …")
print(f"   WS:   {', '.join(sorted(ws_paths))}")
