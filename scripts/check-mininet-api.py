#!/usr/bin/env python3
"""Mininet 仿真后端的最小静态自检。

两种模式共用同一批断言函数（`check_*()`），断言语义只有一份：
  python3 scripts/check-mininet-api.py                完整自检：导入后端 + 路由清单 / CORS / standalone 落库
  python3 scripts/check-mininet-api.py --source-only  只跑源码守卫，零第三方依赖（CI 的 `lab-api` 步骤用它）

完整模式用 `inspect.getsource()` 取函数体，`--source-only` 从 `api.py` 文本里切同名函数，跑的是同一批断言。
不启动 uvicorn、不创建 Mininet 网络。

为什么要有 `--source-only`：`pnpm lab:check` 要 import fastapi / starlette / mininet，而 CI 的 quality job
不装这些依赖，于是「iperf 不许回到 `Net.iperf()`」这条守卫一度只在本机能跑 —— 2026-11-23 那条会永久挂起的
回归路径就是这么回到线上的。源码守卫进 CI 后，回归在 PR 上就变红，不用等人记得本地跑一次。
"""

from __future__ import annotations

import inspect
import re
import sys
from pathlib import Path
from types import SimpleNamespace

SOURCE_ONLY = "--source-only" in sys.argv[1:]

ROOT = Path(__file__).resolve().parents[1]
SERVICE_DIR = ROOT / "services" / "mininet-api"
API_PATH = SERVICE_DIR / "mininet_gui_backend" / "api.py"

if not API_PATH.exists():
    raise SystemExit(f"缺少 Mininet 后端源码：{SERVICE_DIR}")

# 源码守卫分三组：组名进 ✅ 行，最后的 `3/3` 由这张表算出来，漏跑一组会当场报错。
SOURCE_GROUPS = ("链路生命周期", "停网 / 重建前等待", "iperf 子进程")
passed: list[str] = []


def _function_source(text: str, name: str) -> str:
    """从 `api.py` 文本里切出顶层函数（`--source-only` 用）。"""
    match = re.search(rf"^(?:async )?def {name}\(", text, re.MULTILINE)
    if match is None:
        raise SystemExit(f"api.py 里找不到 {name}()：断言指向的函数被改名或删除（NMCPS-ADR-0024 / 0026）")
    rest = text[match.start():]
    following = re.search(r"^(?:@|(?:async )?def |class )", rest[1:], re.MULTILINE)
    return rest if following is None else rest[: following.start() + 1]


def _pass(group: str, summary: str) -> None:
    passed.append(group)
    print(f"✅ {summary}")


# NMCPS-ADR-0024 第二条：运行中加链路时，无控制器的交换机也必须重新初始化端口。
# OVSSwitch.start() 是 del-br + add-br，只有走这一步新链路接口才会 add-port 进 bridge。
# 老实现写的是 `elif node.type == "sw" and node.controller:`，于是 controller=None 的交换机
# （经 BFF 新建的常态）在运行中加链路后端口不在 bridge 里 —— 链路台账有、ARP 也到了交换机，
# 但 bridge 里没有那条 port，帧无处可去，ping 依旧 100% 丢包。
def check_link_lifecycle(source_of) -> None:
    create_link_src = source_of("create_link")
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
    delete_node_src = source_of("delete_node")
    delete_link_src = source_of("delete_link")
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
    _pass("链路生命周期", "加 / 删链路时交换机端口与 failMode 跟着走（NMCPS-ADR-0024）")


# NMCPS-ADR-0026 D3：停网 / 全量重建前必须先等正在跑的 pingall / iperf 收尾。
# `pingFull()` 不可中断，中途拆节点会让上游以 `AttributeError: 'NoneType' object has no
# attribute 'IP'` 崩掉（2026-11-21 实测）。两条路径都漏掉等待就等于把这条裁决写在注释里。
def check_idle_guard(source_of) -> None:
    await_idle_src = source_of("_await_idle_operations")
    if "app.pingall_running" not in await_idle_src or "app.iperf_running" not in await_idle_src:
        raise SystemExit(
            "_await_idle_operations() 没同时看 pingall_running / iperf_running："
            "只等其中一个仍会在另一个跑着时拆节点"
        )
    for name in ("stop_network", "full_reset_network"):
        src = source_of(name)
        if "await _await_idle_operations()" not in src:
            raise SystemExit(
                f"{name}() 拆节点前没有 await _await_idle_operations()："
                "pingall / iperf 跑到一半被拆节点会让上游 AttributeError（NMCPS-ADR-0026 D3）"
            )
    _pass("停网 / 重建前等待", "停网 / 全量重建都先等 pingall / iperf 收尾（NMCPS-ADR-0026 D3）")



# NMCPS-ADR-0026 §5：iperf 不能再回到 Mininet 的 `Net.iperf()`。Debian 打包版的实现用
# `while len(re.findall('/sec', servout)) < 2` 判断收尾，第 2 个 `/sec` 来自 `waitListening()`
# 的 telnet 探测；而本机 iperf 2.2.1 对那条零字节连接不再打印速率行，于是循环永不结束、
# `iperf_running` 卡死、两端 shell 留在 waiting，紧接着的 pingall 直接 500（2026-11-23 实测）。
def check_iperf_guard(source_of) -> None:
    run_iperf_src = source_of("run_iperf")
    if "net.iperf(" in run_iperf_src or "app.net.iperf(" in run_iperf_src:
        raise SystemExit(
            "run_iperf() 又在调 Mininet 的 `Net.iperf()`：打包版实现等第 2 个 /sec 却等不到，"
            "端点会无限挂起并把 iperf_running 卡在 True（NMCPS-ADR-0026 §5）"
        )
    for needle, reason in (
        ("subprocess.Popen", "服务端没有自己起进程（收尾就没法保证）"),
        ("subprocess.run", "客户端没有自己的硬超时（上游一发散就永久占住 iperf_running）"),
        ("app.iperf_running = False", "异常路径没有复位 iperf_running"),
        # 状态码是页面的诊断信息：客户端超时必须回 504（不是 500 / 400），并且正文带输出尾部，
        # 否则用户在界面上只看到一句通用失败，无从判断是超时还是连不上。
        ("subprocess.TimeoutExpired", "客户端超时没有单独分支（会落进 400 或直接 500）"),
        ("status_code=504", "客户端超时没有回 504"),
        ("_iperf_output_tail(client_output)", "失败正文不是输出尾部（上游原话会丢）"),
        # 收尾必须无条件：`finally` + drain，异常路径漏收会留下自己的 `iperf -s`，下一次 409。
        ("finally:", "没有 finally 收尾块"),
        ("_drain_iperf_process(server_process)", "finally 里没收服务端进程（残留 `iperf -s` 会占住端口）"),
        # 两个进程都要进节点自己的 netns（Mininet 节点才有 pid），否则命令跑在宿主网络里。
        ("_iperf_namespace_command(", "没有在节点 netns 里执行（会跑在宿主网络）"),
    ):
        if needle not in run_iperf_src:
            raise SystemExit(
                f"run_iperf() {reason}：iperf 挂起后 pingall / stop 会一起被拖住（NMCPS-ADR-0026 §5）"
            )

    # 就绪探测必须走服务端 netns 里的 `ss`。换回 Mininet 的 `waitListening()` 就是又一条 telnet
    # 连接：iperf 2.2.1 不给零字节连接打印速率行，而 `Net.iperf()` 正是靠「第 2 个 /sec」判收尾 ——
    # 那正是 §5 裁决要拆掉的死循环诱因。
    if "waitListening" in run_iperf_src:
        raise SystemExit(
            "run_iperf() 又用上了 `waitListening()`：telnet 探测会给服务端输出塞噪声，"
            "且正是 `Net.iperf()` 死循环的诱因（NMCPS-ADR-0026 §5）"
        )
    probe_src = source_of("_wait_for_iperf_listener")
    for needle, reason in (
        ('"ss"', "就绪探测没有用 `ss`"),
        ('"-ltn"', "TCP 就绪探测不是 `ss -ltn`（监听态查询）"),
        ('"-lun"', "UDP 就绪探测不是 `ss -lun`"),
        ("status_code=504", "服务端起不来时没有回 504（页面会当成 400 参数错）"),
    ):
        if needle not in probe_src:
            raise SystemExit(
                f"_wait_for_iperf_listener() {reason}：就绪探测退化成猜测，"
                "客户端会在服务端没 listen 时硬跑（NMCPS-ADR-0026 §5）"
            )
    _pass(
        "iperf 子进程",
        "吞吐测试自带子进程 / 硬超时 / netns 内 ss 就绪探测，不再依赖 Net.iperf()（NMCPS-ADR-0026 §5）",
    )


# `--source-only`：不 import 后端（CI 没有 fastapi / starlette / mininet），只读 `api.py` 文本。
if SOURCE_ONLY:
    api_text = API_PATH.read_text(encoding="utf-8")
    for check in (check_link_lifecycle, check_idle_guard, check_iperf_guard):
        check(lambda name, text=api_text: _function_source(text, name))
    if passed != list(SOURCE_GROUPS):
        raise SystemExit(f"源码守卫只跑了 {len(passed)}/{len(SOURCE_GROUPS)} 组：{passed}")
    print(
        f"✅ 源码守卫 {len(passed)}/{len(SOURCE_GROUPS)} 组通过"
        "（--source-only：未导入后端，无 Mininet 依赖）"
    )
    raise SystemExit(0)

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


# 链路通断（NMCPS-ADR-0027 §4 R8）：`up` / `down` / `toggle` 只改运行态，且必须能分辨三种拒绝。
# 用桩网 / 桩链路跑真函数：不需要 root，也不创建命名空间；`ifconfig` 的调用参数就是断言对象。
class _StubIntf:
    def __init__(self, name: str) -> None:
        self.name = name
        self.calls: list[tuple] = []

    def ifconfig(self, *args) -> str:
        self.calls.append(args)
        return ""


class _StubLink:
    def __init__(self) -> None:
        self.intf1 = _StubIntf("h1-eth0")
        self.intf2 = _StubIntf("h2-eth0")


state_link = _StubLink()
state_key = frozenset(("h1", "h2"))
saved_state = {
    name: (hasattr(lab_api.app, name), getattr(lab_api.app, name, None))
    for name in ("net", "links", "link_attrs", "link_states")
}
lab_api.app.links = {state_key: state_link}
lab_api.app.link_attrs = {state_key: {"bw": 10}}
lab_api.app.link_states = {}
try:
    from fastapi import HTTPException  # noqa: E402 - 完整模式才有 fastapi

    lab_api.app.net = SimpleNamespace(is_started=False)
    try:
        lab_api.set_link_state("h1", "h2", lab_api.LinkStateUpdate(state="down"))
    except HTTPException as exc:
        if exc.status_code != 400:
            raise SystemExit(f"未启动的网络上改链路状态回了 {exc.status_code}，期望 400（接口还不存在）")
    else:
        raise SystemExit("未启动的网络上改链路状态成功了：客户端会收到一个无法验证的假状态")
    if lab_api._link_status(state_key) != "unknown":
        raise SystemExit(
            f"未启动时 _link_status={lab_api._link_status(state_key)!r}，期望 unknown（不是 up）"
        )

    try:
        lab_api.set_link_state("h1", "nope", lab_api.LinkStateUpdate(state="down"))
    except HTTPException as exc:
        if exc.status_code != 404:
            raise SystemExit(f"不存在的链路回了 {exc.status_code}，期望 404")
    else:
        raise SystemExit("不存在的链路改状态成功了：路径参数没有被当成台账键校验")

    lab_api.app.net = SimpleNamespace(is_started=True)
    first = lab_api.set_link_state("h1", "h2", lab_api.LinkStateUpdate(state="toggle"))
    if first.get("status") != "down":
        raise SystemExit(f"首次 toggle 得到 {first.get('status')!r}，期望 down")
    if state_link.intf1.calls != [("down",)] or state_link.intf2.calls != [("down",)]:
        raise SystemExit(
            f"toggle → down 时两端接口调用为 {state_link.intf1.calls}/{state_link.intf2.calls}，"
            "期望两段都 ifconfig('down')（只断一端等于链路还通）"
        )
    second = lab_api.set_link_state("h1", "h2", lab_api.LinkStateUpdate(state="toggle"))
    if second.get("status") != "up" or state_link.intf1.calls[-1] != ("up",):
        raise SystemExit(
            f"再次 toggle 得到 {second.get('status')!r} / {state_link.intf1.calls[-1]!r}，期望 up"
        )
    if first.get("options") != {"bw": 10}:
        raise SystemExit(f"链路通断回了 options={first.get('options')!r}，期望原样带回台账属性")
    if lab_api._link_status(state_key) == "unknown":
        raise SystemExit("网络运行中仍读到 unknown：运行态读数没跟着写回")
finally:
    for name, (existed, value) in saved_state.items():
        if existed:
            setattr(lab_api.app, name, value)
        elif hasattr(lab_api.app, name):
            delattr(lab_api.app, name)

print("✅ 链路通断只改运行态：未启动 400 / 未知链路 404 / toggle 由服务端取反（NMCPS-ADR-0027 §4 R8）")

# 与 `--source-only` 跑的是同一批断言，这里只是换个取源码的方式（inspect 而不是切文本）。
for check in (check_link_lifecycle, check_idle_guard, check_iperf_guard):
    check(lambda name: inspect.getsource(getattr(lab_api, name)))

if passed != list(SOURCE_GROUPS):
    raise SystemExit(f"源码守卫只跑了 {len(passed)}/{len(SOURCE_GROUPS)} 组：{passed}")

print(f"✅ Mininet 后端可导入：{len(http_paths)} 条 HTTP 路径 / {len(ws_paths)} 条 WebSocket 路径，无 CORS 中间件")
print(f"   HTTP: {', '.join(sorted(http_paths)[:3])} …")
print(f"   WS:   {', '.join(sorted(ws_paths))}")
