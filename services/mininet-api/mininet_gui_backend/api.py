"""
Mininet-GUI API to deploy and manage a mininet network instance.

## Deploy

Endpoints to start and stop the network at any point.

## Topology

Endpoints that add, remove and edit nodes and edges in real time.
"""
import os
import pty
import json
import select
import signal
import time
import asyncio
import subprocess
import logging
import uuid
import ipaddress
import re
import shlex
from datetime import datetime, timezone
from mininet_gui_backend.sniffer import SnifferManager
import pyshark.ek_field_mapping as ek_field_mapping
from pyshark.tshark.output_parser.tshark_ek import TsharkEkJsonParser
from typing import Any, Tuple, Union, Optional, Set, Dict, List, Literal
from contextlib import asynccontextmanager
import pkgutil

from mininet.moduledeps import pathCheck

from mininet.net import Mininet
from mininet.log import setLogLevel, info, debug as _debug
from mininet.topo import Topo, MinimalTopo
from mininet.clean import cleanup as mn_cleanup
from mininet.node import RemoteController, Controller as ReferenceController, NOX, UserSwitch, OVSSwitch, OVSKernelSwitch, OVSBridge, Node
from mininet_gui_backend.nodes import Ryu
from mininet.link import TCLink
from fastapi import FastAPI, HTTPException, File, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from fastapi.responses import PlainTextResponse, Response

from mininet_gui_backend.export import build_addressing_plan, export_net_to_script, export_net_to_json
from mininet_gui_backend.cli import CLISession
from mininet_gui_backend.auth import install_lab_auth
from mininet_gui_backend.engines import (
    EngineError,
    LinkSpec,
    NodeSpec,
    engine_catalog,
    register_builtin_engines,
)
from mininet_gui_backend.sessions import SessionStore
from mininet_gui_backend.snmp import inventory as snmp_inventory
from mininet_gui_backend.snmp import runtime as snmp_runtime
from mininet_gui_backend.schema import Switch, Host, Controller, Nat, Router
from mininet_gui_backend.flow_rules import FlowRuleCreate, FlowRuleDelete, build_flow, build_flow_match
from mininet_gui_backend.utils import (
    get_interface_stats_path,
    parse_ip_addrs,
    parse_flow_match_from_dump,
    read_interface_counter,
)

LOG_FILE = os.path.join(os.path.dirname(__file__), "mininet.log")
RYU_APP_DIRS = []

FLOW_FIELDS = [
    "cookie", "duration", "table", "n_packets", "n_bytes",
    "idle_timeout", "priority", "actions"
]

MONITOR_INTERVAL_SECONDS = 0.5

class LinkOptions(BaseModel):
    bw: Optional[float] = Field(None, ge=0)
    delay: Optional[Union[str, float]] = None
    jitter: Optional[Union[str, float]] = None
    loss: Optional[float] = Field(None, ge=0, le=100)
    max_queue_size: Optional[int] = Field(None, ge=0)
    use_htb: Optional[bool] = None

class LinkCreate(BaseModel):
    src: str
    dst: str
    options: Optional[LinkOptions] = None


class LinkUpdate(BaseModel):
    src: str
    dst: str
    options: Optional[LinkOptions] = None


class LinkStateUpdate(BaseModel):
    """链路 ifconfig 状态（`NMCPS-ADR-0027` §4 R8 的引擎面读 / 写补齐）。

    `toggle` 由**服务端**按当前状态取反：页面只有一个「来回切」按钮，客户端不该先读一次再算目标值
    （两次往返之间状态可能已变，客户端算出来的目标就是旧结论）。
    """

    state: Literal["up", "down", "toggle"]


class ControllerUpdate(BaseModel):
    controller_type: Optional[str] = None
    remote: Optional[bool] = None
    ip: Optional[str] = None
    port: Optional[int] = None
    ryu_app: Optional[Union[str, list]] = None
    color: Optional[str] = None


class SwitchUpdate(BaseModel):
    of_version: Optional[str] = None


class LinuxRouter(Node):
    def config(self, **params):
        super().config(**params)
        self.cmd("sysctl -w net.ipv4.ip_forward=1")

    def terminate(self):
        self.cmd("sysctl -w net.ipv4.ip_forward=0")
        super().terminate()

class HostUpdate(BaseModel):
    ip: Optional[str] = None
    intf: Optional[str] = None
    default_route: Optional[str] = None
    default_route_type: Optional[str] = None
    default_route_dev: Optional[str] = None
    default_route_ip: Optional[str] = None


class RouterUpdate(BaseModel):
    ip: Optional[str] = None
    interface_ips: Optional[Dict[str, str]] = None
    routes: Optional[List[str]] = None
    proxy_arp: Optional[bool] = None
    ip_forward: Optional[bool] = None

# 停网前等正在跑的 pingall / iperf 收尾的上限（NMCPS-ADR-0026 D3）：
# 一次 pingall 在 9 节点网络上实测 42.6 秒，180 秒留足余量；超时就记日志继续停，
# 不把运维卡在一个卡死的测试上。
PINGALL_IDLE_TIMEOUT_SECONDS = 180.0

# iperf 自己的三个上限（NMCPS-ADR-0026 的 D1 修订）：
# 这里不再调用 Mininet 的 `Net.iperf()` —— 它靠「服务端输出里出现 2 个 /sec」判断结束，
# 而 iperf 2.2.1 对 `waitListening` 的零字节 telnet 探测不再打印速率行，条件永远不成立，
# 端点就此永久挂起（`iperf_running` 卡在 True，两端 shell 也被留在 waiting 状态）。
# 现在自己起进程：服务端后台、客户端用 `timeout` 包住、全部走 subprocess 并带硬超时，
# 任何路径（含异常）都会把服务端收干净、把 `iperf_running` 复位。
IPERF_START_TIMEOUT_SECONDS = 15.0
# 客户端跑满 `-t` 之后还要收尾收包：余量给足，但绝不无限等
IPERF_CLIENT_GRACE_SECONDS = 20.0
# 与浏览器侧 `LAB_IPERF_SECONDS_MAX` 同口径（`layers/scenario/shared/types/labRun.ts`）
IPERF_SECONDS_MAX = 3600
IPERF_DEFAULT_PORT = 5001
IPERF_OUTPUT_TAIL_LINES = 12
IPERF_OUTPUT_LIMIT = 4000


class IperfRequest(BaseModel):
    client: str
    server: str
    l4_type: Optional[str] = "TCP"
    udp_bw: Optional[str] = None
    fmt: Optional[str] = None
    seconds: Optional[int] = 5
    port: Optional[int] = None

# 启动 / 关闭时的 `mn -c`。非 root 下它会对每个残留进程 `pkill` 失败并重试，
# 启动就卡在这里（实测 2026-11-24，`uvicorn` 永远不 ready）。`dryrun` 引擎与
# `pnpm check:simulation` 都不需要清理真实网络，用 `LAB_SKIP_STARTUP_CLEANUP=1` 跳过。
# 只影响进程生命周期的这两次调用：`stop_network()` / `full_reset_network()` 里的清理照旧。
def _startup_cleanup() -> None:
    if os.environ.get("LAB_SKIP_STARTUP_CLEANUP", "").strip().lower() in ("1", "true", "yes"):
        return
    mn_cleanup()


def is_root() -> bool:
    geteuid = getattr(os, "geteuid", None)
    return bool(geteuid) and geteuid() == 0


def _build_network() -> Optional[Mininet]:
    """建一张空网。非 root 时 **不建**：`Mininet.__init__` 会 `ensureRoot()` → `exit(1)`，
    整个 API 连启动都做不到。

    `dryrun` 引擎与 `/api/simulation/**` 不需要真网；缺 root 时让它们照常工作，
    `/api/mininet/**` 的写端点自然失败（没有网可操作），比「进程起不来」好排查。
    """
    if not is_root():
        logging.getLogger(__name__).warning(
            "not running as root: /api/mininet/** is unavailable; dryrun sessions still work"
        )
        return None
    net = Mininet(autoSetMacs=True, topo=Topo())
    net.is_started = False
    return net



@asynccontextmanager
async def lifespan(app: FastAPI):
    # start
    _startup_cleanup()
    setup_log_file()
    app.controllers = dict()
    app.switches = dict()
    app.hosts = dict()
    app.nats = dict()
    app.routers = dict()
    app.links = dict()
    app.link_attrs = dict()
    # 链路 ifconfig 状态（`up` / `down`）：**运行态**而不是配置，键与 `app.links` 同口径。
    # 网络没起来时一律按 `unknown` 读（见 `_link_status()`）—— 停网后回 `up` 等于替上游宣称
    # 「这条线通着」，而此刻两端命名空间根本不在了。
    app.link_states = dict()
    app.terminals = dict()
    app.sniffers = dict()
    app.sniffer_manager = SnifferManager(list_mininet_interfaces, start_sniffer_process)
    app.pingall_running = False
    app.iperf_running = False
    # 引擎注册表与会话层（M0）：1.0 的 `/api/mininet/**` 在会话层之上继续工作，
    # 会话是**新增**入口，不替换旧路径（路径迁移在 M1，见 docs/ai/simulation-parity.md §5）。
    register_builtin_engines()
    app.sessions = SessionStore()
    setLogLevel("debug")
    app.net = _build_network()
    yield
    # stop
    snmp_runtime.stop_on_shutdown()
    _startup_cleanup()

from mininet_gui_backend import __version__ as BACKEND_VERSION
from mininet_gui_backend import LAB_API_CONTRACT
try:
    from mininet.net import VERSION as MININET_VERSION
except Exception:
    MININET_VERSION = None

app = FastAPI(
    debug=True,
    lifespan=lifespan,
    title="Mininet-GUI-API",
    description=__doc__,
    version=BACKEND_VERSION,
    terms_of_service="http://example.com/terms/",
    contact={
        "name": "Lucas Schneider",
        "url": "https://github.com/schneider8357",
        "email": "schneider8357@hotmail.com",
    },
    # license_info={
    #     "name": "Apache 2.0",
    #     "url": "https://www.apache.org/licenses/LICENSE-2.0.html",
    # },
)


# 入口鉴权（M0 远程化）：`LAB_API_TOKEN` 已设置时要求 `x-lab-token`，未设置时只接受回环客户端。
# WebSocket 用 HMAC 签名查询串（Node 内置 WebSocket 不能设请求头），见 auth.py。
install_lab_auth(app)


# 不装 CORSMiddleware（NMCPS-ADR-0022 D9 / W6）：旧 Vite 前端退役后，浏览器只经 Nitro BFF
# 的 `/api/mininet/**` 与 `/mininet-ws/*` 访问本服务（前缀与本服务同形、靠主机 / 端口区分，
# 见 ADR-0022 D11），服务端调用不需要 CORS 头。原先的
# `allow_origins=["*"] + allow_credentials=True` 是唯一允许跨源直连 `:8000` 的入口 ——
# 一旦放开就等于把无登录态的特权后端暴露给任意网页；本服务只应经反代 / 回环访问。

@app.get("/api/version")
def get_version():
    return {
        "version": app.version,
        "mininet_version": MININET_VERSION,
        # BFF 握手比对用（`GET /api/mininet/version`）；改契约标记就是改 API 面
        "api_contract": LAB_API_CONTRACT,
    }

@app.get("/api/health")
def get_health():
    net = getattr(app, "net", None)
    connected = net is not None
    network_started = bool(getattr(net, "is_started", False))
    status = "ok" if connected else "unavailable"
    return {
        "status": status,
        "connected": connected,
        "network_started": network_started,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }

@app.get("/api/ryu/apps")
def get_ryu_apps():
    return {"apps": list_ryu_apps()}


def debug(msg, *args):
    _debug(str(msg)+" "+" ".join(map(str, args))+"\n")

def list_ryu_apps():
    apps = set()
    app_dirs = []
    env_dirs = os.environ.get("RYU_APP_DIRS", "")
    if env_dirs:
        for entry in env_dirs.split(os.pathsep):
            entry = entry.strip()
            if entry:
                app_dirs.append(entry)
    for app_dir in RYU_APP_DIRS:
        if os.path.isdir(app_dir):
            app_dirs.append(app_dir)
    try:
        import importlib
        app_pkg = importlib.import_module("ryu.app")
        if app_pkg and hasattr(app_pkg, "__path__"):
            for _finder, name, _ispkg in pkgutil.iter_modules(app_pkg.__path__):
                if name and not name.startswith("__"):
                    apps.add(name)
            pkg_dir = os.path.dirname(app_pkg.__file__)
            if os.path.isdir(pkg_dir):
                app_dirs.append(pkg_dir)
    except Exception:
        pass

    try:
        result = subprocess.run(
            ["ryu-manager", "--app-list"],
            check=False,
            capture_output=True,
            text=True,
            timeout=3,
        )
        if result.stdout:
            for line in result.stdout.splitlines():
                line = line.strip()
                if not line:
                    continue
                token = line.split()[0]
                if token.startswith("ryu.app."):
                    apps.add(token[len("ryu.app."):])
    except Exception:
        pass

    for app_dir in app_dirs:
        try:
            entries = os.listdir(app_dir)
        except OSError:
            continue
        for entry in entries:
            if entry.endswith(".py") and entry != "__init__.py":
                apps.add(entry[:-3])

    return sorted(apps)

def setup_log_file():
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    handler = logging.FileHandler(LOG_FILE)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG)
    if not any(isinstance(h, logging.FileHandler) and getattr(h, "baseFilename", None) == handler.baseFilename for h in root_logger.handlers):
        root_logger.addHandler(handler)
    try:
        from mininet.log import lg
        lg.setLevel(logging.DEBUG)
        if not any(isinstance(h, logging.FileHandler) and getattr(h, "baseFilename", None) == handler.baseFilename for h in lg.handlers):
            lg.addHandler(handler)
    except Exception:
        pass

def clear_log_file():
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    with open(LOG_FILE, "w", encoding="utf-8"):
        pass


def add_host_to_net(host: Host):
    host_node = app.net.addHost(host.name, ip=host.ip)
    host_node.x = host.x
    host_node.y = host.y
    host_node.ip = host.ip
    host_node.type = "host"
    return host_node


def add_router_to_net(router: Router):
    params = {"ip": router.ip, "mac": router.mac}
    router_node = app.net.addHost(router.name, cls=LinuxRouter, **params)
    router_node.x = router.x
    router_node.y = router.y
    router_node.ip = router.ip
    router_node.mac = router.mac
    router_node.type = "router"
    return router_node


_INTERFACE_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
_ROUTE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_.:/-]+$")


def _router_interface_names(node) -> List[str]:
    try:
        return [
            intf.name
            for intf in node.intfList()
            if intf.name and intf.name not in ("lo", "lo0")
        ]
    except Exception:
        return []


def _normalize_interface_ip(value: str) -> str:
    """Validate an interface address and return its normalized CIDR form."""
    try:
        return str(ipaddress.ip_interface(str(value).strip()))
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"invalid interface address: {value}"
        )


def _normalize_route(route: str) -> str:
    """Validate a static route before it is passed to the shell."""
    route = (route or "").strip()
    if not route:
        raise HTTPException(status_code=400, detail="route cannot be empty")
    try:
        tokens = shlex.split(route)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"invalid route: {route}")
    if not tokens:
        raise HTTPException(status_code=400, detail="route cannot be empty")
    for token in tokens:
        if not _ROUTE_TOKEN_RE.fullmatch(token):
            raise HTTPException(status_code=400, detail=f"invalid route: {route}")
    destination = tokens[0]
    if destination != "default":
        try:
            ipaddress.ip_network(destination, strict=False)
        except ValueError:
            raise HTTPException(
                status_code=400, detail=f"invalid route destination: {destination}"
            )
    return " ".join(tokens)


def _normalize_router_configuration(router: Router) -> Router:
    """Normalize and validate persisted router fields from API/import payloads."""
    router.ip = _normalize_interface_ip(router.ip)
    normalized_ips: Dict[str, str] = {}
    for name, address in router.interface_ips.items():
        name = str(name).strip()
        if not name or not _INTERFACE_NAME_RE.fullmatch(name):
            raise HTTPException(status_code=400, detail=f"invalid interface: {name}")
        normalized_ips[name] = _normalize_interface_ip(address)
    router.interface_ips = normalized_ips
    router.routes = [_normalize_route(route) for route in router.routes]
    return router


def _validate_router_interface_ips(node, interface_ips: Dict[str, str]) -> Dict[str, str]:
    if not interface_ips:
        return {}
    available = set(_router_interface_names(node))
    if not available:
        raise HTTPException(
            status_code=400, detail="router has no interfaces to configure"
        )
    normalized: Dict[str, str] = {}
    for name, address in interface_ips.items():
        name = str(name).strip()
        if not name or not _INTERFACE_NAME_RE.fullmatch(name):
            raise HTTPException(status_code=400, detail=f"invalid interface: {name}")
        if name not in available:
            raise HTTPException(
                status_code=400, detail=f"interface {name} is not attached to router"
            )
        normalized[name] = _normalize_interface_ip(address)
    return normalized


def _apply_router_configuration(router: Router) -> None:
    """Apply the persisted router configuration to the live Mininet node.

    Mininet only assigns the primary ``ip`` to the first interface.  Extra
    interface addresses, static routes and proxy-ARP settings are stored in
    the topology model and re-applied whenever the node starts or is edited.
    """
    node = app.net.nameToNode.get(router.name)
    if not node or getattr(node, "type", None) != "router":
        return
    if not getattr(app.net, "is_started", False):
        return

    interface_names = _router_interface_names(node)
    applied_ips: Dict[str, str] = {}
    for name, address in router.interface_ips.items():
        if name not in interface_names:
            debug(f"router {router.name}: interface {name} is not attached; skipping")
            continue
        applied_ips[name] = address

    previous = getattr(node, "_gui_router_config", None)
    if previous is None:
        previous = {"ip": router.ip, "interface_ips": {}, "routes": []}
    previous_ips: Dict[str, str] = previous.get("interface_ips", {})
    previous_routes: List[str] = previous.get("routes", [])

    forwarded = 1 if router.ip_forward else 0
    node.cmd(f"sysctl -w net.ipv4.ip_forward={forwarded}")
    proxy_arp = 1 if router.proxy_arp else 0
    for name in interface_names:
        node.cmd(f"sysctl -w net.ipv4.conf.{name}.proxy_arp={proxy_arp}")

    # Restore the primary address on interfaces whose custom address was removed.
    primary = interface_names[0] if interface_names else None
    for name in previous_ips:
        if name in applied_ips:
            continue
        node.cmd(f"ip addr flush dev {name} scope global")
        if name == primary and router.ip:
            node.cmd(f"ip addr add {router.ip} dev {name}")

    primary_changed = bool(primary and previous.get("ip") != router.ip)
    if primary_changed and primary not in applied_ips:
        node.cmd(f"ip addr flush dev {primary} scope global")
        node.cmd(f"ip addr add {router.ip} dev {primary}")

    for name, address in applied_ips.items():
        if previous_ips.get(name) == address and not (
            name == primary and primary_changed
        ):
            continue
        node.cmd(f"ip addr flush dev {name} scope global")
        node.cmd(f"ip addr add {address} dev {name}")

    for route in previous_routes:
        if route not in router.routes:
            node.cmd(f"ip route del {route}")
    for route in router.routes:
        node.cmd(f"ip route replace {route}")

    node._gui_router_config = {
        "ip": router.ip,
        "interface_ips": applied_ips,
        "routes": list(router.routes),
    }
    node.ip = router.ip


def _apply_all_router_configurations() -> None:
    for router in app.routers.values():
        _apply_router_configuration(router)


def add_nat_to_net(nat: Nat):
    params = {}
    if nat.ip:
        params["ip"] = nat.ip
    if nat.mac:
        params["mac"] = nat.mac
    nat_node = app.net.addNAT(nat.name, connect=False, **params)
    nat_node.x = nat.x
    nat_node.y = nat.y
    nat_node.type = "nat"
    if nat.ip:
        nat_node.ip = nat.ip
    if nat.mac:
        nat_node.mac = nat.mac
    return nat_node


def add_controller_to_net(controller: Controller, start=True):
    controller_type = (controller.controller_type or "").lower()
    if controller.remote or controller_type == "remote":
        controller_node = app.net.addController(
            controller.name,
            controller=RemoteController,
            ip=controller.ip,
            port=controller.port,
        )
    elif controller_type == "ryu":
        if not controller.port:
            raise HTTPException(status_code=400, detail="Ryu controller requires a port")
        if not controller.ryu_app:
            raise HTTPException(status_code=400, detail="Ryu controller requires an app")
        ryu_apps = controller.ryu_app if isinstance(controller.ryu_app, list) else [controller.ryu_app]
        available_apps = list_ryu_apps()
        if available_apps and any(app_name not in available_apps for app_name in ryu_apps):
            try:
                import importlib
                for app_name in ryu_apps:
                    importlib.import_module(f"ryu.app.{app_name}")
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid ryu app")
        elif not available_apps:
            try:
                import importlib
                for app_name in ryu_apps:
                    importlib.import_module(f"ryu.app.{app_name}")
            except Exception:
                # If we cannot verify, allow creation to keep UI usable.
                pass
        controller.ip = controller.ip or "127.0.0.1"
        controller_node = app.net.addController(
            controller.name,
            controller=Ryu,
            ip=controller.ip,
            port=controller.port,
            ryu_app=ryu_apps,
        )
    elif controller_type == "nox":
        controller_node = app.net.addController(
            controller.name, controller=NOX
        )
    else:
        if not controller.port or controller.port in _list_listening_ports():
            controller.port = _find_free_controller_port()
        controller_node = app.net.addController(
            controller.name, controller=ReferenceController, port=controller.port
        )

    if start:
        controller_node.start()
    controller_node.x = controller.x
    controller_node.y = controller.y
    controller_node.type = "controller"
    return controller_node


def _list_listening_ports() -> Set[int]:
    result = subprocess.run(
        ["netstat", "-tuln"],
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "netstat failed").strip()
        raise HTTPException(status_code=500, detail=detail)
    ports: Set[int] = set()
    for line in (result.stdout or "").splitlines():
        line = line.strip()
        if not line or line.lower().startswith("proto"):
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        local = parts[3]
        if ":" not in local:
            continue
        port_str = local.rsplit(":", 1)[-1]
        if port_str.isdigit():
            ports.add(int(port_str))
    return ports


def _find_free_controller_port() -> int:
    used = _list_listening_ports()
    ranges = [
        range(6633, 6638),
        range(6653, 6658),
    ]
    for rng in ranges:
        for port in rng:
            if port not in used:
                return port
    raise HTTPException(status_code=400, detail="no available controller ports")


def switch_fail_mode(controller: Optional[str]) -> str:
    """交换机 fail mode 由控制器关联推导（NMCPS-ADR-0024）。

    Mininet 的 `OVSSwitch` 默认 `failMode='secure'`：secure 模式下没有已连接的控制器就
    既没有流表、也没有 NORMAL 兜底动作，收到的帧全部丢弃 —— 现场表现就是台账和画布都对、
    `pingall` 100% 丢包。因此这里按关联推导：

    - 有控制器 → `secure`：OpenFlow 规则（`flow_rules.py` 写的流表）才生效；
    - 无控制器 → `standalone`：OVS 当传统自学习交换机用，开箱即通。

    局限写在 `NMCPS-ADR-0024` 里：standalone 会忽略流表，想「被编排 + 写流表」必须先关联控制器。
    """
    return "secure" if controller else "standalone"


def release_switch_port(intf) -> None:
    """删除节点 / 链路前，把交换机侧的 port 从 bridge 上摘掉。

    Mininet 的 `delNode` / `delLink` 只删接口（`ip link del`），不会通知 OVS：bridge 里会留下
    一条 `ofport: -1`、`error: could not open network device` 的记录。它不影响转发，却会让
    `ovs-vsctl list-ports` 看起来链路还在（排查时极易误判，2026-11-18 现场就被缺端口和鬼端口
    各误导过一次），也可能让同名端口（如 `s4-eth3`）下次 `add-port` 失败。
    """
    node = getattr(intf, "node", None)
    name = getattr(intf, "name", None)
    if not name or getattr(node, "type", None) != "sw":
        return
    try:
        subprocess.run(
            ["ovs-vsctl", "--if-exists", "del-port", node.name, name],
            check=False,
            capture_output=True,
            timeout=10,
        )
    except Exception as exc:  # noqa: BLE001 - 清理失败不该阻断删除本身
        debug("failed to release ovs port", name, exc)



def add_switch_to_net(switch: Switch, start=True):
    switch_type = (switch.switch_type or "").lower()
    switch.switch_type = switch_type or switch.switch_type
    fail_mode = switch_fail_mode(switch.controller)
    if switch_type == "user":
        switch_node = app.net.addSwitch(switch.name, ports=switch.ports, cls=UserSwitch)
    elif switch_type == "ovs":
        switch_node = app.net.addSwitch(
            switch.name, ports=switch.ports, cls=OVSSwitch, failMode=fail_mode
        )
    elif switch_type == "ovskernel":
        switch_node = app.net.addSwitch(
            switch.name, ports=switch.ports, cls=OVSKernelSwitch, failMode=fail_mode
        )
    elif switch_type == "ovsbridge":
        switch_node = app.net.addSwitch(
            switch.name, ports=switch.ports, cls=OVSBridge, failMode=fail_mode
        )
    else:
        switch_node = app.net.addSwitch(
            switch.name, ports=switch.ports, failMode=fail_mode
        )

    if start and switch.controller:
        switch_node.start([app.net.nameToNode.get(switch.controller)])
    else:
        switch_node.start([])
    switch_node.x = switch.x
    switch_node.y = switch.y
    switch_node.type = "sw"
    switch_node.controller = switch.controller
    switch_node.switch_type = switch.switch_type
    if switch.of_version:
        _apply_switch_openflow_version(switch.name, switch.of_version, switch_type=switch.switch_type)
    return switch_node


def _apply_switch_openflow_version(switch_id: str, of_version: Optional[str], switch_type: Optional[str] = None):
    if switch_type is None:
        switch = app.switches.get(switch_id)
        if not switch:
            raise HTTPException(status_code=404, detail="switch not found")
        switch_type = switch.switch_type
    switch_type = (switch_type or "").lower()
    if switch_type not in ("ovs", "ovskernel", "ovsbridge"):
        raise HTTPException(status_code=400, detail="openflow version is only supported for OVS switches")
    if not of_version or of_version == "auto":
        result = subprocess.run(
            ["ovs-vsctl", "--if-exists", "clear", "bridge", switch_id, "protocols"],
            text=True,
            capture_output=True,
        )
    else:
        result = subprocess.run(
            ["ovs-vsctl", "--if-exists", "set", "bridge", switch_id, f"protocols={of_version}"],
            text=True,
            capture_output=True,
        )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "ovs-vsctl failed").strip()
        raise HTTPException(status_code=400, detail=detail)


def _terminate_all_terminals():
    for node_id, sessions in list(app.terminals.items()):
        for session_id, (master_fd, process) in list(sessions.items()):
            try:
                process.terminate()
            except Exception:
                pass
            try:
                process.wait(timeout=0.1)
            except Exception:
                pass
            try:
                os.close(master_fd)
            except Exception:
                pass
        sessions.clear()
        app.terminals.pop(node_id, None)


async def _stop_all_sniffers_quietly():
    try:
        await app.sniffer_manager.stop()
    except Exception:
        pass


async def _await_idle_operations(timeout: float = PINGALL_IDLE_TIMEOUT_SECONDS) -> bool:
    """Wait (bounded) for a running pingall / iperf before tearing nodes down.

    `pingFull()` cannot be cancelled (Mininet has no hook), and rebuilding the
    topology while it iterates node interfaces kills the upstream with
    `AttributeError: 'NoneType' object has no attribute 'IP'` (measured
    2026-11-21, NMCPS-ADR-0026 D3). So stop waits instead of racing: poll the
    two flags on the event loop, and if the deadline passes, log and continue
    stopping anyway -- an operator must never be blocked by a stuck test.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while app.pingall_running or app.iperf_running:
        if loop.time() >= deadline:
            info(
                f"*** pingall/iperf still running after {timeout:.0f}s, "
                "stopping the network anyway\n"
            )
            return False
        await asyncio.sleep(0.2)
    return True


async def _stop_mininet_with_timeout(timeout: float = 5.0):
    controllers = list(getattr(app.net, "controllers", []) or [])
    if controllers:
        for controller in controllers:
            try:
                controller.terminate()
            except Exception:
                pass
    app.net.controllers = []
    loop = asyncio.get_running_loop()
    try:
        await asyncio.wait_for(loop.run_in_executor(None, app.net.stop), timeout=timeout)
    except asyncio.TimeoutError:
        debug(f"mininet.stop() did not complete within {timeout} seconds, continuing cleanup")
    except Exception as exc:
        debug("error while stopping mininet", exc)

def list_mininet_interfaces():
    nodes = []
    if hasattr(app.net, "hosts"):
        for host in app.net.hosts:
            intfs = [i.name for i in host.intfList() if i.name and i.name not in ("lo", "lo0")]
            node_type = getattr(host, "type", "host")
            nodes.append({"id": host.name, "type": node_type, "intfs": intfs, "pid": host.pid})
    if hasattr(app.net, "switches"):
        for sw in app.net.switches:
            intfs = [i.name for i in sw.intfList() if i.name and i.name not in ("lo", "lo0")]
            node_type = getattr(sw, "type", "switch")
            nodes.append({"id": sw.name, "type": node_type, "intfs": intfs, "pid": sw.pid})
    return nodes

@app.get("/api/mininet/addressing_plan")
def addressing_plan():
    if not app.net.is_started:
        raise HTTPException(status_code=400, detail="network must be started")
    return build_addressing_plan(app.net)

@app.get("/api/mininet/hosts")
def list_hosts():
    return app.hosts

@app.get("/api/mininet/interfaces")
def list_interfaces():
    return {"nodes": list_mininet_interfaces()}

@app.get("/api/mininet/switches")
def list_switches():
    for sw_id, sw in app.switches.items():
        if not getattr(sw, "switch_type", None):
            node = app.net.nameToNode.get(sw_id)
            if node:
                if isinstance(node, UserSwitch):
                    sw.switch_type = "user"
                elif isinstance(node, OVSBridge):
                    sw.switch_type = "ovsbridge"
                elif isinstance(node, OVSSwitch):
                    sw.switch_type = "ovs"
                elif isinstance(node, OVSKernelSwitch):
                    sw.switch_type = "ovskernel"
    return app.switches

@app.get("/api/mininet/controllers")
def list_controllers():
    return app.controllers

@app.get("/api/mininet/nats")
def list_nats():
    return app.nats

@app.get("/api/mininet/routers")
def list_routers():
    return app.routers

@app.get("/api/mininet/nodes")
def list_unified_nodes():
    """统一节点读（M1.1）：五类分表的投影，形状与 `/api/simulation/sessions/{id}/nodes` 一致。

    1.x 的 `/api/mininet/**` 等价于「默认会话」（`sessions.py` 模块注释），因此这条不需要
    `session_id`；会话侧那条在 `WiredEngine.list_nodes()` 里先过 `_bound()`，两条共用
    `wired.unified_nodes()` 的投影。页面读拓扑只打一条，不再并发拉五张分表。
    """
    # 局部 import：`engines.wired` 反过来在调用期才 `_legacy()` 拿本模块，顶层互导会成环
    from mininet_gui_backend.engines.wired import unified_nodes

    return unified_nodes()


def _link_states() -> dict:
    """`app.link_states` 的惰性初始化：lifespan 会建它，但自检脚本可能只 import `app` 就调函数。"""
    states = getattr(app, "link_states", None)
    if states is None:
        states = dict()
        app.link_states = states
    return states


def _link_status(key) -> str:
    """链路的运行态读数：`up` / `down` / `unknown`。

    是**读出来的运行态**而不是配置项：网络没起来时两端的命名空间都不存在，任何具体读数都是编的，
    因此回 `unknown`（页面渲染 `—`）。`app.link_states` 只在 `PATCH /links/{src}/{dst}/state`
    成功后才写入，`stop` / `full_reset` 会清空它 —— 重建后的接口是全新的，旧的 `down` 不成立。
    """
    if getattr(app.net, "is_started", False) is not True:
        return "unknown"
    return _link_states().get(key, "up")


@app.get("/api/mininet/links")
def list_edges():
    edges = []
    for key in app.links:
        nodes = list(key)
        attrs = app.link_attrs.get(key) or {}
        link = app.links.get(key)
        from_node = nodes[0] if len(nodes) > 0 else None
        to_node = nodes[1] if len(nodes) > 1 else None
        intfs = None
        intf1 = getattr(link, "intf1", None)
        intf2 = getattr(link, "intf2", None)
        if intf1 and intf2 and getattr(intf1, "node", None) and getattr(intf2, "node", None):
            from_node = intf1.node.name
            to_node = intf2.node.name
            intfs = {"from": intf1.name, "to": intf2.name}
        if from_node and to_node:
            edges.append({
                "from": from_node,
                "to": to_node,
                "options": attrs,
                "intfs": intfs,
                "status": _link_status(key),
            })
    return edges

def _start_snmp_collection() -> None:
    """起网成功后拉起采集面；失败只写状态，不影响起网（`NMCPS-ADR-0028` D4）。"""
    try:
        snmp_runtime.runtime.start_for_net(app.net)
    except Exception as exc:  # pragma: no cover - 防御式
        logging.getLogger(__name__).warning("snmp collection failed to start: %s", exc)


def _stop_snmp_collection() -> None:
    """停网 / 重置 / 进程退出时回收；agent 的 netns 随节点消失，先于 `mn -c`。"""
    try:
        snmp_runtime.runtime.stop_all()
    except Exception as exc:  # pragma: no cover - 防御式
        logging.getLogger(__name__).warning("snmp collection failed to stop: %s", exc)


def _ledger_snmp_nodes() -> List[dict]:
    """五类台账 → NMS seed；只取 id / type / name / ip / mac，不猜接口。"""
    rows: List[dict] = []
    for kind, collection in (
        ("controller", app.controllers),
        ("switch", app.switches),
        ("host", app.hosts),
        ("nat", app.nats),
        ("router", app.routers),
    ):
        for item in collection.values():
            data = item.model_dump() if hasattr(item, "model_dump") else vars(item)
            rows.append(
                {
                    "id": data.get("id") or "",
                    "type": data.get("type") or kind,
                    "name": data.get("name") or data.get("id") or "",
                    "ip": data.get("ip") or "",
                    "mac": data.get("mac") or "",
                }
            )
    return rows


def _ledger_snmp_links() -> List[dict]:
    rows: List[dict] = []
    for key in app.links:
        nodes = list(key)
        if len(nodes) == 2:
            rows.append({"from": nodes[0], "to": nodes[1]})
    return rows


@app.get("/api/mininet/snmp/state")
def get_snmp_state():
    """采集面读数：开关 / 运行态 / 每节点 agent 状态（三态，读不到不回落）。"""
    return snmp_runtime.runtime.status()


@app.get("/api/mininet/snmp/topology")
def get_snmp_topology():
    """台账投影：给外部 NMS 的 seed 清单（节点 + 链路 + 采集参数）。"""
    return snmp_inventory.build_topology(
        _ledger_snmp_nodes(),
        _ledger_snmp_links(),
        snmp_runtime.runtime.status(),
    )


@app.get("/api/mininet/start")
def get_network_started():
    net = getattr(app, "net", None)
    return bool(getattr(net, "is_started", False))

@app.post("/api/mininet/start")
def start_network():
    """Build network and start nodes"""
    if app.net.is_started:
        raise HTTPException(status_code=400, detail="network already started")
    app.net.build()
    for controller in app.controllers:
        app.net.nameToNode[controller].start()
    for switch_id in app.switches:
        switch = app.net.nameToNode[switch_id]
        controller_id = getattr(app.switches[switch_id], "controller", None)
        controller_node = None
        if controller_id:
            controller_node = app.net.nameToNode.get(controller_id)
        if controller_node:
            switch.controller = controller_node
            switch.failMode = switch_fail_mode(controller_id)
            switch.start([controller_node])
        else:
            switch.controller = None
            switch.failMode = switch_fail_mode(None)
            switch.start([])
    app.net.is_started = True
    _apply_all_router_configurations()
    _start_snmp_collection()
    return {"status": "ok"}

@app.post("/api/mininet/stop")
async def stop_network():
    """Stop network and nodes"""
    # 先等正在跑的探测 / 测速收尾：pingFull() 不可中断，中途拆节点会让上游
    # AttributeError（NMCPS-ADR-0026 D3）
    await _await_idle_operations()
    await _stop_all_sniffers_quietly()
    _terminate_all_terminals()
    app.iperf_running = False

    await _stop_mininet_with_timeout()
    _stop_snmp_collection()

    # Cleanup (mn -c)
    mn_cleanup()

    # Create the Mininet network
    setLogLevel("debug")
    app.net = Mininet(autoSetMacs=True, topo=Topo())
    app.net.is_started = False
    app.links = dict()
    # 重建出来的接口是全新的：旧的 `down` 不会跟着新接口成立
    app.link_states = dict()
    # Recreate topology without start
    entries = [
        (add_host_to_net, app.hosts.values(), {}),
        (add_router_to_net, app.routers.values(), {}),
        (add_nat_to_net, app.nats.values(), {}),
        (add_controller_to_net, app.controllers.values(), {"start": False}),
        (add_switch_to_net, app.switches.values(), {"start": False}),
    ]
    for builder, collection, kwargs in entries:
        for item in collection:
            builder(item, **kwargs)
    app.links = dict()
    for key, attrs in list(app.link_attrs.items()):
        nodes = list(key)
        if len(nodes) != 2:
            continue
        src, dst = nodes
        kwargs = {}
        if attrs:
            kwargs.update(attrs)
            kwargs["cls"] = TCLink
        new_link = app.net.addLink(src, dst, **kwargs)
        if app.net.is_started:
            for node_id in (src, dst):
                node = app.net.nameToNode[node_id]
                if node.type in ("host", "nat", "router"):
                    node.configDefault()
                elif node.type == "sw" and node.controller:
                    node.start([node.controller])
        app.links[key] = new_link
    return {"status": "ok"}

@app.post("/api/mininet/reset")
async def reset_network():
    """Restart network and nodes"""
    try:
        await app.sniffer_manager.stop()
    except Exception:
        pass
    clear_log_file()
    await stop_network()
    return start_network()

@app.post("/api/mininet/full_reset")
async def full_reset_network():
    """Full reset: stop everything, cleanup, and clear saved topology."""
    # 与 stop_network() 同一条约束：清理拓扑前先等探测 / 测速收尾（NMCPS-ADR-0026 D3）
    await _await_idle_operations()
    await _stop_all_sniffers_quietly()
    _terminate_all_terminals()
    clear_log_file()

    await _stop_mininet_with_timeout()
    _stop_snmp_collection()
    mn_cleanup()

    app.controllers = dict()
    app.switches = dict()
    app.hosts = dict()
    app.nats = dict()
    app.routers = dict()
    app.links = dict()
    app.link_attrs = dict()
    app.link_states = dict()
    app.terminals = dict()
    app.sniffers = dict()
    app.pingall_running = False
    app.iperf_running = False

    setLogLevel("debug")
    app.net = Mininet(autoSetMacs=True, topo=Topo())
    app.net.is_started = False
    return {"status": "ok"}

@app.post("/api/mininet/pingall")
def run_pingall():
    """Build network and start nodes"""
    if not app.net.is_started:
        raise HTTPException(status_code=400, detail="network must be started to run pingall")
    if app.pingall_running:
        raise HTTPException(status_code=409, detail="pingall already running")
    app.pingall_running = True
    try:
        pingall_results = app.net.pingFull()
        debug(pingall_results)
        return "\n".join(
            [
                f"{p[0]}->{p[1]}: {p[2][0]}/{p[2][1]}, rtt min/avg/max/mdev {p[2][2]:.3f}/{p[2][3]:.3f}/{p[2][4]:.3f}/{p[2][5]:.3f} ms"
                for p in pingall_results
            ]
        )
    finally:
        app.pingall_running = False

@app.post("/api/mininet/hosts")
def create_host(host: Host):
    if host.id in app.hosts:
        app.hosts[host.id] = host
        return {"status": "updated"}
    # Create host in the Mininet network using the request data
    debug(host)
    new_host = add_host_to_net(host)
    app.hosts[host.name] = host
    debug(new_host)
    # Return an OK status code
    return {"status": "ok"}

@app.post("/api/mininet/routers")
def create_router(router: Router):
    router = _normalize_router_configuration(router)
    if router.id in app.routers:
        app.routers[router.id] = router
        _apply_router_configuration(router)
        return {"status": "updated"}
    debug(router)
    new_router = add_router_to_net(router)
    app.routers[router.name] = router
    debug(new_router)
    return {"status": "ok"}


@app.patch("/api/mininet/routers/{router_id}")
def update_router(router_id: str, payload: RouterUpdate):
    router = app.routers.get(router_id)
    if not router:
        raise HTTPException(status_code=404, detail=f"Router {router_id} not found")
    node = app.net.nameToNode.get(router_id)
    if node and getattr(node, "type", None) != "router":
        raise HTTPException(status_code=400, detail="node is not a router")

    if payload.ip is not None:
        router.ip = _normalize_interface_ip(payload.ip)
    if payload.interface_ips is not None:
        if node is None:
            raise HTTPException(status_code=404, detail=f"Router {router_id} not found")
        router.interface_ips = _validate_router_interface_ips(node, payload.interface_ips)
    if payload.routes is not None:
        router.routes = [_normalize_route(route) for route in payload.routes]
    if payload.proxy_arp is not None:
        router.proxy_arp = payload.proxy_arp
    if payload.ip_forward is not None:
        router.ip_forward = payload.ip_forward

    if node is not None:
        node.ip = router.ip
        if hasattr(node, "params") and isinstance(node.params, dict):
            node.params["ip"] = router.ip
    app.routers[router_id] = router
    _apply_router_configuration(router)
    return {"router": router.model_dump()}

@app.patch("/api/mininet/hosts/{host_id}")
def update_host(host_id: str, payload: HostUpdate):
    if host_id not in app.net.nameToNode:
        raise HTTPException(status_code=404, detail=f"Node {host_id} not found")
    node = app.net.nameToNode[host_id]
    if getattr(node, "type", None) != "host":
        raise HTTPException(status_code=400, detail="node is not a host")
    host = app.hosts.get(host_id)
    if not host:
        raise HTTPException(status_code=404, detail=f"Host {host_id} not found")
    if payload.ip:
        ip_value = payload.ip.strip()
        if "/" in ip_value:
            addr, prefix_raw = ip_value.split("/", 1)
            try:
                prefix_len = int(prefix_raw)
            except ValueError:
                raise HTTPException(status_code=400, detail="invalid prefix length")
        else:
            addr = ip_value
            prefix_len = None
        if prefix_len is None:
            fallback = host.ip
            if fallback and "/" in fallback:
                prefix_len = int(fallback.split("/", 1)[1])
            else:
                prefix_len = 8
        intf = payload.intf or None
        node.setIP(addr, prefixLen=prefix_len, intf=intf)
        host.ip = f"{addr}/{prefix_len}"
    if payload.default_route_type:
        route_type = payload.default_route_type.strip().lower()
        if route_type == "dev":
            dev = (payload.default_route_dev or "").strip()
            if dev:
                node.setDefaultRoute(dev)
            else:
                node.cmd("ip route del default")
        elif route_type == "ip":
            ip_value = (payload.default_route_ip or "").strip()
            if ip_value:
                node.setDefaultRoute(f"via {ip_value}")
            else:
                node.cmd("ip route del default")
    elif payload.default_route is not None:
        route_value = payload.default_route.strip()
        if route_value:
            node.setDefaultRoute(route_value)
        else:
            node.cmd("ip route del default")
    app.hosts[host_id] = host
    return {"status": "ok", "host": host.model_dump()}

@app.post("/api/mininet/nats")
def create_nat(nat: Nat):
    if nat.id in app.nats:
        app.nats[nat.id] = nat
        return {"status": "updated"}
    debug(nat)
    new_nat = add_nat_to_net(nat)
    app.nats[nat.name] = nat
    debug(new_nat)
    return {"status": "ok"}


@app.post("/api/mininet/switches")
def create_switch(switch: Switch):
    # Create switch in the Mininet network using the request data
    debug("CREATING SWITCH", switch)
    if switch.controller and switch.controller not in app.controllers:
        raise HTTPException(
            status_code=400, detail=f'controller "{switch.controller}" does not exist'
        )
    new_switch = add_switch_to_net(switch)
    app.switches[switch.name] = switch
    return switch


@app.post("/api/mininet/controllers")
def create_controller(controller: Controller):
    # Create controller in the Mininet network using the request data
    debug(controller)
    new_controller = add_controller_to_net(controller, start=True)
    app.controllers[controller.name] = controller
    debug(new_controller)
    return {"status": "ok"}


@app.put("/api/mininet/controllers/{controller_id}")
def update_controller(controller_id: str, payload: ControllerUpdate):
    if controller_id not in app.controllers:
        raise HTTPException(status_code=404, detail="controller not found")
    controller = app.controllers[controller_id]
    updates = payload.model_dump(exclude_none=True)
    for key, value in updates.items():
        setattr(controller, key, value)
    app.controllers[controller_id] = controller
    return {"controller": controller.model_dump()}


@app.put("/api/mininet/switches/{switch_id}/openflow")
def update_switch_openflow_version(switch_id: str, payload: SwitchUpdate):
    if switch_id not in app.switches:
        raise HTTPException(status_code=404, detail="switch not found")
    of_version = payload.of_version
    if of_version in ("", "auto"):
        of_version = None
    allowed = {None, "OpenFlow10", "OpenFlow11", "OpenFlow12", "OpenFlow13", "OpenFlow14", "OpenFlow15"}
    if of_version not in allowed:
        raise HTTPException(status_code=400, detail="invalid OpenFlow version")
    _apply_switch_openflow_version(switch_id, of_version)
    app.switches[switch_id].of_version = of_version
    return {"switch": app.switches[switch_id].model_dump()}

@app.post("/api/mininet/associate_switch")
def associate_switch(data: dict):
    # Associate switch to controller.
    if "switch" not in data or "controller" not in data:
        raise HTTPException(
            status_code=400, detail=f'missing key in data'
        )
    sw_id = data["switch"]
    ctl_id = data["controller"]
    if sw_id not in app.net.nameToNode or ctl_id not in app.net.nameToNode:
        raise HTTPException(status_code=400, detail='node not in net')
    sw = app.net.nameToNode[sw_id]
    ctl = app.net.nameToNode[ctl_id]
    if app.switches[sw_id].controller:
        raise HTTPException(status_code=400, detail="switch is already associated")
    sw.controller = ctl
    # 关联控制器后该交换机改为 secure（NMCPS-ADR-0024）：standalone 会忽略控制器下发的流表
    sw.failMode = switch_fail_mode(ctl_id)
    app.switches[sw_id].controller = ctl_id
    if app.net.is_started:
        sw.start([sw.controller])
    return "OK"

@app.post("/api/mininet/links")
def create_link(payload: Union[Tuple[str, str], LinkCreate]):
    if isinstance(payload, (list, tuple)):
        src, dst = payload
        options = None
    else:
        src, dst = payload.src, payload.dst
        options = payload.options

    if src not in app.net.nameToNode or dst not in app.net.nameToNode:
        raise HTTPException(status_code=400, detail=f'node not in net')
    if app.net.nameToNode[src].type == "host" and app.net.nameToNode[src].intfList() and len([i for i in app.net.nameToNode[src].intfList() if i.name and i.name not in ("lo", "lo0")]) >= 1:
        raise HTTPException(status_code=400, detail="host already has a link")
    if app.net.nameToNode[dst].type == "host" and app.net.nameToNode[dst].intfList() and len([i for i in app.net.nameToNode[dst].intfList() if i.name and i.name not in ("lo", "lo0")]) >= 1:
        raise HTTPException(status_code=400, detail="host already has a link")
    key = frozenset((src, dst))
    if key in app.links:
        raise HTTPException(status_code=400, detail=f'link already exists')
    link_kwargs = {}
    if options:
        opt = options.model_dump(exclude_none=True)
        if "delay" in opt and isinstance(opt["delay"], (int, float)):
            opt["delay"] = f"{opt['delay']}ms"
        if "jitter" in opt and isinstance(opt["jitter"], (int, float)):
            opt["jitter"] = f"{opt['jitter']}ms"
        link_kwargs.update(opt)
        link_kwargs["cls"] = TCLink
    new_link = app.net.addLink(src, dst, **link_kwargs)
    if app.net.is_started:
        for node in (src, dst):
            node = app.net.nameToNode[node]
            if node.type in ("host", "nat", "router"):
                node.configDefault()
            elif node.type == "sw":
                # 交换机必须在加链之后重启一次端口初始化：OVSSwitch.start() 是 del-br + add-br，
                # 只有走这一步，新链路接口才会被 add-port 进 bridge。
                # 曾经这里写的是 `and node.controller`，于是「无控制器 + 运行中加链路」的交换机
                # 端口永远进不了 bridge —— 链路在台账里有、h5 的 ARP 也到了交换机，但 bridge
                # 里没有 s1-eth3，帧无处可去，现场表现就是 ping 100% 丢包（NMCPS-ADR-0024）。
                controller_node = (
                    node.controller
                    if not isinstance(node.controller, str)
                    else app.net.nameToNode.get(node.controller)
                )
                if not controller_node:
                    node.controller = None
                if hasattr(node, "failMode"):
                    node.failMode = switch_fail_mode(
                        getattr(controller_node, "name", None)
                    )
                node.start([controller_node] if controller_node else [])
        for node_id in (src, dst):
            router = app.routers.get(node_id)
            if router:
                _apply_router_configuration(router)
    # It is important to store this Link object because
    # mininet (apparently) doesn't have an easy way to access this
    app.links[key] = new_link
    # 新链路两端接口刚起来：运行态读数从 `up` 起算（旧 `down` 不跟着重建）
    _link_states()[key] = "up"
    if options:
        app.link_attrs[key] = options.model_dump(exclude_none=True)
    else:
        app.link_attrs[key] = {}
    intfs = None
    if getattr(new_link, "intf1", None) and getattr(new_link, "intf2", None):
        intfs = {"from": new_link.intf1.name, "to": new_link.intf2.name}
    return {"from": src, "to": dst, "options": app.link_attrs[key], "intfs": intfs}


@app.put("/api/mininet/links")
def update_link(payload: LinkUpdate):
    src, dst = payload.src, payload.dst
    options = payload.options
    if src not in app.net.nameToNode or dst not in app.net.nameToNode:
        raise HTTPException(status_code=400, detail="node not in net")
    key = frozenset((src, dst))
    if key not in app.links:
        raise HTTPException(status_code=404, detail="link not found")
    stored_opts = options.model_dump(exclude_none=True) if options else {}
    config_opts = dict(stored_opts)
    if "delay" in config_opts and isinstance(config_opts["delay"], (int, float)):
        config_opts["delay"] = f"{config_opts['delay']}ms"
    if "jitter" in config_opts and isinstance(config_opts["jitter"], (int, float)):
        config_opts["jitter"] = f"{config_opts['jitter']}ms"
    app.link_attrs[key] = stored_opts

    link = app.links.get(key)
    if link and config_opts:
        try:
            link.intf1.config(**config_opts)
            link.intf2.config(**config_opts)
        except Exception as exc:
            debug("failed to update link config", exc)

    return {"from": src, "to": dst, "options": app.link_attrs[key]}


@app.patch("/api/mininet/links/{src_id}/{dst_id}/state")
def set_link_state(src_id: str, dst_id: str, payload: LinkStateUpdate):
    """把一条链路的两个接口 `ifconfig up|down`，并写回运行态读数。

    为什么单独一条端点而不是塞进 `PUT /links`：`PUT /links` 改的是 `TCLink` 的**属性**
    （bw / delay / loss，落 `app.link_attrs`，停网重建后仍然生效），这里改的是链路**此刻通不通**
    （运行态，停网 / 重建即失效）。两件事的生命周期不同，混成一个请求就会在停网后「看起来还断着」。

    网络未启动时回 400：接口不存在，`up` / `down` 无处可落；此刻写下的状态也无法在
    `GET /links` 里被验证（`_link_status()` 那时恒为 `unknown`），等于让客户端收到一个假成功。
    """
    key = frozenset((src_id, dst_id))
    link = app.links.get(key)
    if not link:
        raise HTTPException(status_code=404, detail="link not found")
    if getattr(app.net, "is_started", False) is not True:
        raise HTTPException(status_code=400, detail="network must be started to change link state")

    current = _link_states().get(key, "up")
    if payload.state == "toggle":
        target = "down" if current == "up" else "up"
    else:
        target = payload.state

    for intf in (getattr(link, "intf1", None), getattr(link, "intf2", None)):
        if not intf or not getattr(intf, "name", None):
            continue
        try:
            intf.ifconfig(target)
        except Exception as exc:  # noqa: BLE001 - 上游原话要透出，不能吞成 200
            debug("failed to set link state", intf.name, target, exc)
            raise HTTPException(status_code=500, detail=f"failed to set {intf.name} {target}: {exc}")

    _link_states()[key] = target
    intfs = None
    if getattr(link, "intf1", None) and getattr(link, "intf2", None):
        intfs = {"from": link.intf1.name, "to": link.intf2.name}
    return {
        "from": src_id,
        "to": dst_id,
        "status": target,
        "options": app.link_attrs.get(key, {}),
        "intfs": intfs,
    }


@app.get("/api/mininet/links/stats/{src_id}/{dst_id}")
def get_link_stats(src_id: str, dst_id: str):
    key = frozenset((src_id, dst_id))
    link = app.links.get(key)
    if not link:
        raise HTTPException(status_code=404, detail="link not found")
    intfs = []
    for intf in (getattr(link, "intf1", None), getattr(link, "intf2", None)):
        if not intf or not getattr(intf, "name", None):
            continue
        stats_paths = get_interface_stats_path(intf.name)
        intfs.append({
            "name": intf.name,
            "tx_bytes": read_interface_counter(stats_paths["tx"]),
            "rx_bytes": read_interface_counter(stats_paths["rx"]),
        })
    return {
        "from": src_id,
        "to": dst_id,
        "intfs": intfs,
        "options": app.link_attrs.get(key, {}),
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


@app.post("/api/mininet/node_position")
def node_position(data: dict):
    if "node_id" not in data or "position" not in data:
        raise HTTPException(
            status_code=400, detail=f'missing key in data'
        )
    debug("data:",data)
    node_id = data["node_id"]
    x, y = data["position"]
    if node_id not in app.net.nameToNode:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
    node = app.net.nameToNode[node_id]
    debug("before update xy",(node.x, node.y))
    node.x = x
    node.y = y
    debug("updated xy",(app.net.nameToNode[node_id].x, app.net.nameToNode[node_id].y))
    if node.type == "sw":
        app.switches[node_id].x = x
        app.switches[node_id].y = y
    elif node.type == "host":
        app.hosts[node_id].x = x
        app.hosts[node_id].y = y
    elif node.type == "controller":
        app.controllers[node_id].x = x
        app.controllers[node_id].y = y
    elif node.type == "nat":
        app.nats[node_id].x = x
        app.nats[node_id].y = y
    elif node.type == "router":
        app.routers[node_id].x = x
        app.routers[node_id].y = y
    return {"message": f"Node {node_id} updated successfully"}


@app.delete("/api/mininet/delete_node/{node_id}")
def delete_node(node_id: str):
    if node_id not in app.net.nameToNode:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
    node = app.net.nameToNode[node_id]
    # 先摘交换机侧端口再删节点：Mininet 删接口不会通知 OVS（见 release_switch_port）
    for intf in node.intfList():
        link = getattr(intf, "link", None)
        if link is None:
            continue
        release_switch_port(link.intf1)
        release_switch_port(link.intf2)
    # 节点没了，挂在它上面的链路也要从台账里消失，否则 export / 画布会带着死链路
    for key in [k for k in app.links if node_id in k]:
        app.links.pop(key, None)
        app.link_attrs.pop(key, None)
        _link_states().pop(key, None)
    app.net.delNode(node)
    if node.type == "sw":
        del app.switches[node_id]
    elif node.type == "host":
        del app.hosts[node_id]
    elif node.type == "controller":
        del app.controllers[node_id]
        for switch_id in app.switches:
            switch = app.switches[switch_id]
            if switch.controller == node_id:
                debug("CONTROLLER", switch.controller, node_id)
                app.switches[switch_id].controller = None
                app.net.nameToNode[switch_id].start([])
    elif node.type == "nat":
        del app.nats[node_id]
    elif node.type == "router":
        del app.routers[node_id]
    return {"message": f"Node {node_id} deleted successfully"}

@app.delete("/api/mininet/delete_link/{src_id}/{dst_id}")
def delete_link(src_id: str, dst_id: str):
    key = frozenset((src_id, dst_id))
    if key not in app.links:
        raise HTTPException(status_code=404, detail=f"Node not found")
    link = app.links[key]
    release_switch_port(link.intf1)
    release_switch_port(link.intf2)
    app.net.delLink(link)
    del app.links[key]
    app.link_attrs.pop(key, None)
    _link_states().pop(key, None)
    return {"message": f"Link {key} deleted successfully"}

@app.delete("/api/mininet/remove_association/{src_id}/{dst_id}")
def remove_association(src_id: str, dst_id: str):
    if src_id not in app.net.nameToNode or dst_id not in app.net.nameToNode:
        raise HTTPException(status_code=400, detail='node not in net')
    sw, ctl = None, None
    for node_id in (src_id, dst_id):
        node = app.net.nameToNode[node_id]
        if node.type == "sw":
            sw = node
        elif node.type == "controller":
            ctl = node
    if not sw or not ctl:
        raise HTTPException(status_code=400, detail=f'node {node_id} isnt switch or controller')
    sw.controller = None
    app.switches[sw.name].controller = None
    if app.net.is_started:
        sw.start([])
    return "OK"


@app.get("/api/mininet/stats/{node_id}")
def get_node_stats(node_id: str):
    if node_id not in app.net.nameToNode:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

    node = app.net.nameToNode[node_id]
    base_data = app.switches.get(node_id) or app.hosts.get(node_id) or app.controllers.get(node_id) or app.nats.get(node_id) or app.routers.get(node_id)
    if not base_data:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
    result = dict(**base_data.model_dump())

    if node.type == "sw":
        ports_raw = node.dpctl("dump-ports")
        ports_raw = ports_raw[ports_raw.find("\n") + 1:].replace("\n", " ")
        result["ports"] = [p.strip() for p in ports_raw.split("port") if "LOCAL" not in p and p.strip()]

        flow_table_raw = node.dpctl("dump-flows").strip()
        parsed_flows = []

        for line in flow_table_raw.split("\n"):
            line = line.strip()
            if not line:
                continue
            flow = {}
            match_fields = {}
            actions = None

            if " actions=" in line:
                line, actions = line.split(" actions=", 1)
            elif "actions=" in line:
                line, actions = line.split("actions=", 1)

            if actions is not None:
                flow["actions"] = actions.strip()

            fields = [f.strip() for f in line.split(",") if f.strip()]
            for field in fields:
                if "=" in field:
                    key, value = field.split("=", 1)
                    if key in FLOW_FIELDS:
                        flow[key] = value
                    else:
                        match_fields[key] = value
                else:
                    match_fields[field] = True

            flow["match_fields"] = match_fields
            parsed_flows.append(flow)
        result["flow_table"] = parsed_flows
    elif node.type in ("host", "router"):
        arp_table = node.cmd("arp -a -n")
        print("ARP TABLE", arp_table)
        parsed_arp_table = []
        for line in arp_table.splitlines():
            parts = line.split()
            if len(parts) < 6:
                continue
            ip = parts[1].strip("()")
            mac = parts[3]
            interface = parts[-1]
            parsed_arp_table.append({"ip": ip, "mac": mac, "interface": interface})
        result["arp_table"] = parsed_arp_table
        default_route = node.cmd("ip route show default").strip()
        result["default_route"] = default_route
        interfaces = []
        try:
            interfaces = [intf.name for intf in node.intfList() if intf.name != "lo"]
        except Exception:
            interfaces = []
        result["interfaces"] = interfaces

    result.pop("x", None)
    result.pop("y", None)

    return result

@app.post("/api/mininet/flows")
def add_flow(rule: FlowRuleCreate):
    if not app.net.is_started:
        raise HTTPException(status_code=400, detail="network must be started to add flows")
    if rule.switch not in app.net.nameToNode:
        raise HTTPException(status_code=404, detail=f"Switch {rule.switch} not found")
    node = app.net.nameToNode[rule.switch]
    if getattr(node, "type", None) not in ("sw", "switch"):
        raise HTTPException(status_code=400, detail="node is not a switch")

    flow = build_flow(rule)
    cmd = ["ovs-ofctl"]
    if rule.of_version:
        cmd.extend(["-O", rule.of_version])
    cmd.extend(["add-flow", rule.switch, flow])
    result = subprocess.run(cmd, text=True, capture_output=True)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "ovs-ofctl add-flow failed").strip()
        raise HTTPException(status_code=400, detail=detail)

    return {"status": "ok", "flow": flow}

@app.get("/api/mininet/flows/{switch_id}")
def list_flows(switch_id: str):
    if not app.net.is_started:
        raise HTTPException(status_code=400, detail="network must be started to list flows")
    if switch_id not in app.net.nameToNode:
        raise HTTPException(status_code=404, detail=f"Switch {switch_id} not found")
    node = app.net.nameToNode[switch_id]
    if getattr(node, "type", None) not in ("sw", "switch"):
        raise HTTPException(status_code=400, detail="node is not a switch")

    cmd = ["ovs-ofctl", "dump-flows", switch_id]
    result = subprocess.run(cmd, text=True, capture_output=True)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "ovs-ofctl dump-flows failed").strip()
        raise HTTPException(status_code=400, detail=detail)
    return {"switch": switch_id, "flows": result.stdout.strip()}

@app.delete("/api/mininet/flows")
def delete_flows(rule: FlowRuleDelete):
    if not app.net.is_started:
        raise HTTPException(status_code=400, detail="network must be started to delete flows")
    if rule.switch not in app.net.nameToNode:
        raise HTTPException(status_code=404, detail=f"Switch {rule.switch} not found")
    node = app.net.nameToNode[rule.switch]
    if getattr(node, "type", None) not in ("sw", "switch"):
        raise HTTPException(status_code=400, detail="node is not a switch")

    match = build_flow_match(rule)
    cmd = ["ovs-ofctl"]
    if rule.of_version:
        cmd.extend(["-O", rule.of_version])
    if rule.strict:
        cmd.append("--strict")
    cmd.extend(["del-flows", rule.switch])
    if match:
        cmd.append(match)
    result = subprocess.run(cmd, text=True, capture_output=True)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "ovs-ofctl del-flows failed").strip()
        raise HTTPException(status_code=400, detail=detail)

    return {"status": "ok", "match": match or "all"}

@app.delete("/api/mininet/flows/{switch_id}/{flow_id}")
def delete_flow_by_id(switch_id: str, flow_id: int):
    if not app.net.is_started:
        raise HTTPException(status_code=400, detail="network must be started to delete flows")
    if switch_id not in app.net.nameToNode:
        raise HTTPException(status_code=404, detail=f"Switch {switch_id} not found")
    node = app.net.nameToNode[switch_id]
    if getattr(node, "type", None) not in ("sw", "switch"):
        raise HTTPException(status_code=400, detail="node is not a switch")
    if flow_id <= 0:
        raise HTTPException(status_code=400, detail="flow_id must be >= 1")

    dump = subprocess.run(["ovs-ofctl", "dump-flows", switch_id], text=True, capture_output=True)
    if dump.returncode != 0:
        detail = (dump.stderr or dump.stdout or "ovs-ofctl dump-flows failed").strip()
        raise HTTPException(status_code=400, detail=detail)
    lines = [l for l in dump.stdout.splitlines() if "actions=" in l]
    if flow_id > len(lines):
        raise HTTPException(status_code=404, detail="flow_id not found")
    line = lines[flow_id - 1]
    try:
        match = parse_flow_match_from_dump(line)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    result = subprocess.run(
        ["ovs-ofctl", "--strict", "del-flows", switch_id, match],
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "ovs-ofctl del-flows failed").strip()
        raise HTTPException(status_code=400, detail=detail)
    return {"status": "ok", "match": match}

def _iperf_namespace_command(node, args: List[str]) -> List[str]:
    """在节点自己的 netns 里执行命令（Mininet 节点持有宿主 pid）。"""
    pid = getattr(node, "pid", None)
    if not isinstance(pid, int) or pid <= 0:
        raise HTTPException(status_code=409, detail="host process is not running")
    return ["nsenter", "-t", str(pid), "-n", *args]


def _iperf_output_tail(text: str) -> str:
    """输出的最后几行：够定位问题，又不会把整段 pty 噪声塞回浏览器。"""
    lines = [line.rstrip() for line in (text or "").splitlines() if line.strip()]
    return "\n".join(lines[-IPERF_OUTPUT_TAIL_LINES:])[:IPERF_OUTPUT_LIMIT]


def _iperf_rate_of(text: str) -> str:
    """取最后一条带宽读数（`… Gbits/sec`）；没有就返回空串。"""
    for line in reversed((text or "").splitlines()):
        match = re.search(r"([\d.]+\s+[KMGTP]?bits/sec)", line)
        if match:
            return match.group(1)
    return ""


def _drain_iperf_process(process) -> str:
    """收掉 `iperf -s` 并取回它的输出。

    先 SIGINT 而不是 SIGKILL：iperf 自己的信号处理会打印报告再退出，
    直接 -9 会把还在 stdio 缓冲里的服务端读数一起丢掉。幂等 ——
    重复调用（正常路径取过输出、`finally` 再兜一次）只会拿到空串。
    """
    try:
        if process.poll() is None:
            try:
                process.send_signal(signal.SIGINT)
            except Exception:
                pass
        output, _ = process.communicate(timeout=5)
        return output or ""
    except subprocess.TimeoutExpired:
        process.kill()
        try:
            output, _ = process.communicate(timeout=5)
            return output or ""
        except Exception:
            return ""
    except Exception:
        return ""


def _wait_for_iperf_listener(process, server_node, port: int, udp: bool) -> None:
    """等 `iperf -s` 真正 listen：在服务端自己的 netns 里用 `ss` 查这个端口。

    协议无关（TCP 查 `-ltn`、UDP 查 `-lun`），而且不产生任何连接 —— 旧实现走 mininet 的
    `waitListening()`，那条 telnet 连接既会产生速率行噪声，又是把 `Net.iperf()` 拖进死循环的诱因。
    """
    probe_args = ["ss", "-H", "-lun" if udp else "-ltn", f"sport = :{port}"]
    deadline = time.monotonic() + IPERF_START_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = _drain_iperf_process(process)
            raise HTTPException(
                status_code=400,
                detail=f"iperf server exited: {_iperf_output_tail(output) or 'no output'}",
            )
        try:
            probe = subprocess.run(
                _iperf_namespace_command(server_node, probe_args),
                capture_output=True,
                text=True,
                timeout=5,
            )
        except subprocess.TimeoutExpired:
            probe = None
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"cannot enter host netns: {exc}") from exc
        if probe is not None and probe.returncode == 0 and probe.stdout.strip():
            return
        time.sleep(0.2)
    raise HTTPException(
        status_code=504,
        detail=(
            f"iperf server did not listen on port {port} within "
            f"{IPERF_START_TIMEOUT_SECONDS:.0f}s"
        ),
    )


@app.post("/api/mininet/iperf")
def run_iperf(request: IperfRequest):
    if not app.net.is_started:
        raise HTTPException(status_code=400, detail="network must be started to run iperf")
    if app.iperf_running:
        raise HTTPException(status_code=409, detail="iperf already running")
    if request.client == request.server:
        raise HTTPException(status_code=400, detail="client and server must be different hosts")
    if request.client not in app.net.nameToNode or request.server not in app.net.nameToNode:
        raise HTTPException(status_code=404, detail="client or server host not found")
    client_node = app.net.nameToNode[request.client]
    server_node = app.net.nameToNode[request.server]
    if getattr(client_node, "type", None) != "host" or getattr(server_node, "type", None) != "host":
        raise HTTPException(status_code=400, detail="client and server must be hosts")

    l4_type = (request.l4_type or "TCP").strip().upper() or "TCP"
    if l4_type not in ("TCP", "UDP"):
        raise HTTPException(status_code=400, detail="l4_type must be TCP or UDP")
    seconds = request.seconds if request.seconds is not None else 5
    if not 1 <= seconds <= IPERF_SECONDS_MAX:
        raise HTTPException(status_code=400, detail=f"seconds must be between 1 and {IPERF_SECONDS_MAX}")
    port = request.port if request.port is not None else IPERF_DEFAULT_PORT
    if not 1 <= port <= 65535:
        raise HTTPException(status_code=400, detail="port must be between 1 and 65535")

    base_args = ["iperf", "-p", str(port)]
    if l4_type == "UDP":
        base_args.append("-u")
    if request.fmt:
        base_args += ["-f", request.fmt]

    server_ip = server_node.IP()
    client_args = [
        "timeout",
        str(int(seconds + IPERF_CLIENT_GRACE_SECONDS)),
        *base_args,
        "-t",
        str(seconds),
        "-c",
        server_ip,
    ]
    if l4_type == "UDP":
        client_args += ["-b", request.udp_bw or "10M"]

    app.iperf_running = True
    server_process = None
    try:
        server_process = subprocess.Popen(
            _iperf_namespace_command(server_node, [*base_args, "-s"]),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        _wait_for_iperf_listener(server_process, server_node, port, l4_type == "UDP")
        try:
            client = subprocess.run(
                _iperf_namespace_command(client_node, client_args),
                capture_output=True,
                text=True,
                timeout=seconds + IPERF_CLIENT_GRACE_SECONDS + 5,
            )
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(
                status_code=504,
                detail=(
                    "iperf client did not finish within "
                    f"{int(seconds + IPERF_CLIENT_GRACE_SECONDS)}s"
                ),
            ) from exc
        client_output = f"{client.stdout or ''}{client.stderr or ''}"
        server_output = _drain_iperf_process(server_process)
        if client.returncode != 0 and not _iperf_rate_of(client_output):
            raise HTTPException(
                status_code=400,
                detail=(
                    "iperf failed: "
                    + (_iperf_output_tail(client_output) or f"exit {client.returncode}")
                ),
            )
        info(
            f"*** iperf {l4_type} {request.client}->{request.server} {seconds}s: "
            f"client={_iperf_rate_of(client_output) or 'n/a'} "
            f"server={_iperf_rate_of(server_output) or 'n/a'}\n"
        )
        return {
            "client": _iperf_output_tail(client_output),
            "server": _iperf_output_tail(server_output),
        }
    finally:
        if server_process is not None:
            _drain_iperf_process(server_process)
        app.iperf_running = False

@app.get("/api/mininet/export_script", response_class=PlainTextResponse)
def export_network():
    debug(app.net)
    return export_net_to_script(app.switches, app.hosts, app.controllers, app.nats, app.routers, app.links).encode("utf-8")

@app.get("/api/mininet/export_json", response_class=PlainTextResponse)
def export_network():
    debug(app.net)
    return export_net_to_json(app.switches, app.hosts, app.controllers, app.nats, app.routers, app.links).encode("utf-8")

@app.post("/api/mininet/import_json")
async def import_json(file: UploadFile = File(...)):
    contents = await file.read()

    try:
        data = json.loads(contents.decode("utf-8"))
        print("Received Topology JSON:", data)

        if "nodes" in data and "edges" in data:
            nodes = data.get("nodes") or []
            edges = data.get("edges") or []
            controllers = []
            switches = []
            hosts = []
            routers = []
            nats = []

            for node in nodes:
                node_type = (node.get("type") or "").lower()
                if node_type in ("controller", "ctl", "c"):
                    controllers.append(node)
                elif node_type in ("sw", "switch"):
                    switches.append(node)
                elif node_type in ("host", "h"):
                    hosts.append(node)
                elif node_type == "router":
                    routers.append(node)
                elif node_type == "nat":
                    nats.append(node)

            controller_ids = {c.get("id") for c in controllers if c.get("id")}
            switch_ids = {s.get("id") for s in switches if s.get("id")}
            switch_index = {s.get("id"): s for s in switches if s.get("id")}

            for edge in edges:
                src = edge.get("from")
                dst = edge.get("to")
                if not src or not dst:
                    continue
                if src in switch_ids and dst in controller_ids:
                    if not switch_index[src].get("controller"):
                        switch_index[src]["controller"] = dst
                elif dst in switch_ids and src in controller_ids:
                    if not switch_index[dst].get("controller"):
                        switch_index[dst]["controller"] = src

            links = []
            for edge in edges:
                src = edge.get("from")
                dst = edge.get("to")
                if not src or not dst:
                    continue
                if src in controller_ids or dst in controller_ids:
                    continue
                options = edge.get("options")
                if options is None:
                    links.append([src, dst])
                else:
                    links.append({"src": src, "dst": dst, "options": options})

            data = {
                "controllers": controllers,
                "switches": switches,
                "hosts": hosts,
                "routers": routers,
                "nats": nats,
                "links": links,
            }

        for controller_data in data.get("controllers", []):
            controller = Controller(**controller_data)
            create_controller(controller)

        for switch_data in data.get("switches", []):
            switch = Switch(**switch_data)
            controller = switch.controller
            switch.controller = None
            create_switch(switch)
            if controller:
                associate_switch({
                    "switch": switch.id,
                    "controller": controller
                })

        for host_data in data.get("hosts", []):
            host = Host(**host_data)
            create_host(host)

        for router_data in data.get("routers", []):
            router = Router(**router_data)
            create_router(router)

        for nat_data in data.get("nats", []):
            nat = Nat(**nat_data)
            create_nat(nat)

        for link in data.get("links", []):
            debug("LINKS: ", data["links"])
            debug("LINK: ", link)
            if isinstance(link, dict):
                create_link(LinkCreate(**link))
            else:
                create_link(tuple(link))

        return {"message": "Topology successfully imported"}

    except json.JSONDecodeError:
        return {"error": "Invalid JSON file"}, 400

async def read_pty(master_fd, websocket: WebSocket):
    """Reads PTY output and sends it to WebSocket"""
    try:
        while True:
            await asyncio.sleep(0.01)
            try:
                r, _, _ = select.select([master_fd], [], [], 0)
            except OSError as e:
                if getattr(e, "errno", None) == 9:
                    break
                raise
            if master_fd in r:
                try:
                    output = os.read(master_fd, 1024).decode(errors="ignore")
                except OSError as e:
                    if getattr(e, "errno", None) == 9:
                        break
                    raise
                if output:
                    await websocket.send_text(output)
    except Exception as e:
        debug(f"PTY Read Error: {e}")

async def read_sniffer(process: asyncio.subprocess.Process, websocket: WebSocket):
    """Reads tcpdump output and sends it to WebSocket"""
    try:
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            await websocket.send_text(line.decode(errors="ignore").rstrip())
    except Exception as e:
        debug(f"Sniffer Read Error: {e}")


async def start_sniffer_process(node_pid: int, intf: str, pcap_path: str):
    if node_pid and node_pid > 0:
        return await asyncio.create_subprocess_exec(
            "mnexec",
            "-a",
            str(node_pid),
            "tshark",
            "-l",
            "-n",
            "-q",
            "-i",
            intf,
            "-T",
            "ek",
            "-w",
            pcap_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
    return await asyncio.create_subprocess_exec(
        "tshark",
        "-l",
        "-n",
        "-q",
        "-i",
        intf,
        "-T",
        "ek",
        "-w",
        pcap_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )

@app.websocket("/api/mininet/terminal/{node_id}")
async def websocket_terminal(websocket: WebSocket, node_id: str):
    """WebSocket endpoint for accessing a Mininet node terminal"""
    await websocket.accept()
    if not getattr(app.net, "is_started", False):
        await websocket.send_text("Error: network must be started to open a webshell.")
        await websocket.close()
        return

    node = app.net.get(node_id)

    if not node:
        await websocket.send_text(f"Error: node {node_id} not found.")
        await websocket.close()
        return

    master_fd, slave_fd = pty.openpty()

    env = dict(os.environ)
    env["PS1"] = f"root@{node_id}:\\w$ "
    process = node.popen(
        ["/bin/bash", "--noprofile", "--norc", "-i"],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        text=True,
        close_fds=True,
        env=env,
    )

    session_id = f"{node_id}-{uuid.uuid4().hex}"
    sessions = app.terminals.get(node_id, {})
    sessions[session_id] = (master_fd, process)
    app.terminals[node_id] = sessions

    asyncio.create_task(read_pty(master_fd, websocket))

    try:
        while True:
            data = await websocket.receive_text()
            debug("RECEIVED",data.encode())
            os.write(master_fd, data.encode())
    except WebSocketDisconnect:
        process.terminate()
        os.close(master_fd)
        sessions = app.terminals.get(node_id, {})
        sessions.pop(session_id, None)
        if not sessions:
            app.terminals.pop(node_id, None)
        else:
            app.terminals[node_id] = sessions
        print(f"Closed terminal session for {node_id} ({session_id})")

@app.websocket("/api/mininet/logs")
async def websocket_logs(websocket: WebSocket):
    await websocket.accept()
    if not os.path.exists(LOG_FILE):
        clear_log_file()
    process = await asyncio.create_subprocess_exec(
        "tail",
        "-n",
        "1000",
        "-f",
        LOG_FILE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        while True:
            line = await process.stdout.readline()
            if not line:
                await asyncio.sleep(0.05)
                continue
            await websocket.send_text(line.decode(errors="ignore").rstrip())
    except WebSocketDisconnect:
        pass
    finally:
        process.terminate()

@app.websocket("/api/mininet/sniffer")
async def websocket_sniffer(websocket: WebSocket):
    """WebSocket endpoint for streaming tcpdump output on all Mininet interfaces"""
    await websocket.accept()

    if not app.net.is_started:
        await websocket.send_text("Error: network must be started to sniff.")
        await websocket.close()
        return

    nodes = list_mininet_interfaces()
    if not nodes:
        await websocket.send_text("Error: no Mininet nodes available to sniff.")
        await websocket.close()
        return

    queue = await app.sniffer_manager.subscribe()
    try:
        while True:
            event = await queue.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        await app.sniffer_manager.unsubscribe(queue)


@app.websocket("/api/mininet/monitor")
async def websocket_interface_monitor(websocket: WebSocket):
    """WebSocket endpoint that streams tx/rx traffic rates for a single interface"""
    await websocket.accept()

    if not getattr(app.net, "is_started", False):
        await websocket.send_text("Error: network must be started to monitor.")
        await websocket.close()
        return

    node_id = websocket.query_params.get("node")
    intf_name = websocket.query_params.get("intf")
    interval_param = websocket.query_params.get("interval")
    try:
        interval = float(interval_param) if interval_param else MONITOR_INTERVAL_SECONDS
    except (ValueError, TypeError):
        interval = MONITOR_INTERVAL_SECONDS
    interval = max(0.1, min(interval, 5.0))

    if not node_id or not intf_name:
        await websocket.send_text("Error: node and intf query parameters are required.")
        await websocket.close()
        return

    nodes = list_mininet_interfaces()
    node_info = next((node for node in nodes if node["id"] == node_id), None)
    if not node_info or intf_name not in node_info.get("intfs", []):
        await websocket.send_text(f"Error: interface {intf_name} for node {node_id} was not found.")
        await websocket.close()
        return

    stats = get_interface_stats_path(intf_name)
    tx_path = stats.get("tx")
    rx_path = stats.get("rx")
    if not tx_path or not rx_path or not os.path.isdir(os.path.dirname(tx_path)):
        await websocket.send_text(f"Error: statistics for interface {intf_name} are unavailable.")
        await websocket.close()
        return

    last_tx = None
    last_rx = None
    last_time = None
    try:
        while True:
            current_time = datetime.now(timezone.utc)
            tx_bytes = read_interface_counter(tx_path)
            rx_bytes = read_interface_counter(rx_path)
            if tx_bytes is None or rx_bytes is None:
                await websocket.send_text(f"Error: failed to read counters for {intf_name}.")
                break

            if last_tx is not None and last_rx is not None and last_time:
                elapsed = (current_time - last_time).total_seconds()
                if elapsed > 0:
                    tx_delta = max(0, tx_bytes - last_tx)
                    rx_delta = max(0, rx_bytes - last_rx)
                    tx_gbps = (tx_delta * 8) / elapsed / 1e9
                    rx_gbps = (rx_delta * 8) / elapsed / 1e9
                    payload = {
                        "node": node_id,
                        "intf": intf_name,
                        "ts": current_time.isoformat(),
                        "tx_gbps": tx_gbps,
                        "rx_gbps": rx_gbps,
                    }
                    await websocket.send_json(payload)

            last_tx = tx_bytes
            last_rx = rx_bytes
            last_time = current_time
            await asyncio.sleep(interval)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        debug(f"Monitor WebSocket error: {exc}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass

@app.get("/api/mininet/sniffer/state")
def sniffer_state():
    return {"active": app.sniffer_manager.active}

@app.get("/api/mininet/sniffer/history")
async def sniffer_history():
    return {"events": await app.sniffer_manager.get_history()}

@app.post("/api/mininet/sniffer/start")
async def sniffer_start():
    if not getattr(app.net, "is_started", False):
        raise HTTPException(status_code=400, detail="network must be started to begin sniffing")
    await app.sniffer_manager.start()
    return {"active": app.sniffer_manager.active}

@app.post("/api/mininet/sniffer/stop")
async def sniffer_stop():
    await app.sniffer_manager.stop()
    return {"active": app.sniffer_manager.active}

@app.get("/api/mininet/sniffer/export")
async def sniffer_export():
    pcap_data = await app.sniffer_manager.get_pcap()

    return Response(
        content=pcap_data,
        media_type="application/vnd.tcpdump.pcap",
        headers={"Content-Disposition": "attachment; filename=sniffer.pcap"},
    )
# —— 仿真引擎与会话（M0，docs/ai/simulation-parity.md §五）——
#
# 与 `/api/mininet/**` 的关系：那套是 1.0 的全局单例 API，M0 不动它；这里是 2.0 的
# 会话入口，`engine=wired` 的会话内部就是那张全局网（单实例约束由 WiredEngine 兜住），
# `engine=dryrun` 是纯内存实现 —— 无 root 的机器（CI）也能验证整条链路。


def _engine_http_error(exc: EngineError) -> HTTPException:
    """引擎错误 → HTTP 状态码 + 稳定 reason（页面按 reason 分支，不猜 500）。"""
    return HTTPException(status_code=exc.status_code, detail=exc.detail())


class SessionCreate(BaseModel):
    engine: str = "wired"
    name: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class SessionNodeCreate(BaseModel):
    id: str
    type: str
    name: Optional[str] = None
    x: float = 0.0
    y: float = 0.0
    attributes: Optional[Dict[str, Any]] = None


class SessionLinkCreate(BaseModel):
    id: str
    src: str
    dst: str
    options: Optional[Dict[str, Any]] = None


@app.get("/api/simulation/engines")
def list_simulation_engines():
    return {"engines": engine_catalog()}


@app.get("/api/simulation/sessions")
def list_simulation_sessions():
    sessions = [record.as_dict() for record in app.sessions.list()]
    return {"sessions": sessions, "total": len(sessions)}


@app.post("/api/simulation/sessions", status_code=201)
async def create_simulation_session(payload: SessionCreate):
    try:
        record = await app.sessions.create(payload.engine, payload.name, payload.metadata)
    except EngineError as exc:
        raise _engine_http_error(exc) from exc
    return record.as_dict()


@app.get("/api/simulation/sessions/{session_id}")
def get_simulation_session(session_id: str):
    try:
        return app.sessions.status(session_id)
    except EngineError as exc:
        raise _engine_http_error(exc) from exc


@app.delete("/api/simulation/sessions/{session_id}")
async def delete_simulation_session(session_id: str):
    try:
        record = await app.sessions.delete(session_id)
    except EngineError as exc:
        raise _engine_http_error(exc) from exc
    return {"status": "deleted", "id": record.id}


@app.post("/api/simulation/sessions/{session_id}/start")
async def start_simulation_session(session_id: str):
    try:
        await app.sessions.start(session_id)
        # 起停都回**带 live 事实**的完整状态：页面不必再发一次 GET 才知道引擎真的起来了
        return app.sessions.status(session_id)
    except EngineError as exc:
        raise _engine_http_error(exc) from exc


@app.post("/api/simulation/sessions/{session_id}/stop")
async def stop_simulation_session(session_id: str):
    try:
        await app.sessions.stop(session_id)
        return app.sessions.status(session_id)
    except EngineError as exc:
        raise _engine_http_error(exc) from exc



@app.get("/api/simulation/sessions/{session_id}/nodes")
def list_simulation_nodes(session_id: str):
    try:
        return app.sessions.list_nodes(session_id)
    except EngineError as exc:
        raise _engine_http_error(exc) from exc


@app.post("/api/simulation/sessions/{session_id}/nodes", status_code=201)
def create_simulation_node(session_id: str, payload: SessionNodeCreate):
    node = NodeSpec(
        id=payload.id,
        type=payload.type,
        name=payload.name or payload.id,
        x=payload.x,
        y=payload.y,
        attributes=dict(payload.attributes or {}),
    )
    try:
        return app.sessions.add_node(session_id, node)
    except EngineError as exc:
        raise _engine_http_error(exc) from exc


@app.delete("/api/simulation/sessions/{session_id}/nodes/{node_id}")
def delete_simulation_node(session_id: str, node_id: str):
    try:
        app.sessions.remove_node(session_id, node_id)
    except EngineError as exc:
        raise _engine_http_error(exc) from exc
    return {"status": "deleted", "id": node_id}


@app.get("/api/simulation/sessions/{session_id}/links")
def list_simulation_links(session_id: str):
    try:
        return app.sessions.list_links(session_id)
    except EngineError as exc:
        raise _engine_http_error(exc) from exc


@app.post("/api/simulation/sessions/{session_id}/links", status_code=201)
def create_simulation_link(session_id: str, payload: SessionLinkCreate):
    link = LinkSpec(id=payload.id, src=payload.src, dst=payload.dst, options=dict(payload.options or {}))
    try:
        return app.sessions.add_link(session_id, link)
    except EngineError as exc:
        raise _engine_http_error(exc) from exc


@app.delete("/api/simulation/sessions/{session_id}/links/{link_id}")
def delete_simulation_link(session_id: str, link_id: str):
    try:
        app.sessions.remove_link(session_id, link_id)
    except EngineError as exc:
        raise _engine_http_error(exc) from exc
    return {"status": "deleted", "id": link_id}
