"""wired 引擎统一节点 / 链路适配的行为自检（NMCPS-DESIGN-008 M1）。

`pnpm check:engines` 用它在**没有 root、没有 mininet、没有 fastapi** 的环境里验证适配层，
所以这里不连真后端，而是把 legacy `api` 模块换成桩：桩只保留适配层真正用到的边界
（`api.app.*` 台账、`api.Host` / `api.Switch` 模型类、`create_*` / `delete_*` /
`list_edges`），并让它们抛带 `status_code` + `detail` 的异常，模拟 FastAPI 的
`HTTPException`（适配层正是靠 duck typing 归一错误，见 `_legacy_error()`）。

单独成文件而不是内联在 `check-engines.mjs` 里：这段有 150 行，内联会把零依赖守卫脚本
撑成第二个后端；分成文件后可以 `python3 scripts/check-wired-adapter.py` 直接复跑。
"""

import asyncio
import ipaddress
import re
import sys
import types

sys.path.insert(0, "services/mininet-api")

import mininet_gui_backend  # noqa: E402

if "mininet.net" in sys.modules:
    raise AssertionError("导入包时拉起了 mininet（适配层必须能在无 mininet 的环境里被测）")


class Model:
    """桩模型：pydantic 只被用到 `model_dump()` 与「必填字段缺失要报错」。"""

    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)

    def model_dump(self):
        return dict(vars(self))


class Host(Model):
    def __init__(self, **kwargs):
        for key in ("ip", "mac"):
            if key not in kwargs:
                raise ValueError(f"{key}: Field required")
        super().__init__(**kwargs)

    # Mininet 节点的两个方法：`deferred` 档在运行中真的会调它们
    def setDefaultRoute(self, route):
        self.default_route = route
        self.default_route_calls = getattr(self, "default_route_calls", 0) + 1

    def cmd(self, command):
        self.cmd_calls = getattr(self, "cmd_calls", []) + [command]
        return ""


class UpdateModel(Model):
    """桩 `*Update`：只记字段，不校验（校验归 legacy，适配层不复制一份）。"""

    pass


class Switch(Model):
    def __init__(self, **kwargs):
        for key in ("ports", "controller"):
            if key not in kwargs:
                raise ValueError(f"{key}: Field required")
        super().__init__(**kwargs)


class LinkOptions(Model):
    pass


class LinkCreate(Model):
    pass


def fail(status, detail):
    """模拟 FastAPI 的 `HTTPException`：适配层读 `status_code` / `detail`。"""
    exc = RuntimeError(detail)
    exc.status_code = status
    exc.detail = detail
    raise exc


class Net:
    is_started = False


app = types.SimpleNamespace(
    net=Net(),
    hosts={},
    switches={},
    routers={},
    nats={},
    controllers={},
    links={},
    link_attrs={},
    # 真后端在 M1.2 新增的默认路由台账（`NMCPS-ADR-0029` D2）
    host_routes={},
    nameToNode={},
)

#: legacy 更新路径的命中记录：适配层「什么时候真的下发、什么时候只写台账」要靠它断言
updates = []


def _number(value):
    return ipaddress.ip_interface(value).compressed


def _normalize_route(route):
    text = (route or "").strip()
    if not text:
        fail(400, "route must not be empty")
    return text


def update_host(host_id, payload):
    if host_id not in app.nameToNode:
        fail(404, f"Node {host_id} not found")
    host = app.hosts.get(host_id)
    if not host:
        fail(404, f"Host {host_id} not found")
    updates.append(("host", host_id, payload.model_dump()))
    if getattr(payload, "ip", None):
        host.ip = payload.ip
    if getattr(payload, "default_route", None) is not None:
        if payload.default_route:
            host.setDefaultRoute(payload.default_route)
        else:
            host.cmd("ip route del default")
    return {"status": "ok"}


def update_router(router_id, payload):
    router = app.routers.get(router_id)
    if not router:
        fail(404, f"Router {router_id} not found")
    updates.append(("router", router_id, payload.model_dump()))
    for key, value in payload.model_dump().items():
        if value is not None:
            setattr(router, key, value)
    return {"router": router.model_dump()}


def update_controller(controller_id, payload):
    if controller_id not in app.controllers:
        fail(404, "controller not found")
    updates.append(("controller", controller_id, payload.model_dump()))
    return {"controller": app.controllers[controller_id].model_dump()}


def update_switch_openflow_version(switch_id, payload):
    if switch_id not in app.switches:
        fail(404, "switch not found")
    updates.append(("switch", switch_id, payload.model_dump()))
    app.switches[switch_id].of_version = payload.of_version
    return {"switch": app.switches[switch_id].model_dump()}


def update_link(payload):
    src, dst = payload.src, payload.dst
    if src not in app.nameToNode or dst not in app.nameToNode:
        fail(400, "node not in net")
    key = frozenset((src, dst))
    if key not in app.links:
        fail(404, "link not found")
    options = payload.options.model_dump() if getattr(payload, "options", None) else {}
    updates.append(("link", f"{src}--{dst}", options))
    app.link_attrs[key] = options
    return {"from": src, "to": dst, "options": options}


def create_host(host):
    app.hosts[host.name] = host
    app.nameToNode[host.name] = host
    return {"status": "ok"}


def create_switch(switch):
    app.switches[switch.name] = switch
    app.nameToNode[switch.name] = switch
    return switch


def delete_node(node_id):
    if node_id not in app.nameToNode:
        fail(404, f"Node {node_id} not found")
    app.nameToNode.pop(node_id, None)
    app.hosts.pop(node_id, None)
    app.switches.pop(node_id, None)
    # 真后端删节点时会连带清掉挂在上面的链路（见 api.delete_node）
    for key in [item for item in app.links if node_id in item]:
        app.links.pop(key, None)
        app.link_attrs.pop(key, None)
    return {"message": "deleted"}


def create_link(payload):
    if payload.src not in app.nameToNode or payload.dst not in app.nameToNode:
        fail(400, "node not in net")
    key = frozenset((payload.src, payload.dst))
    if key in app.links:
        fail(400, "link already exists")
    options = payload.options.model_dump() if getattr(payload, "options", None) else {}
    app.links[key] = object()
    app.link_attrs[key] = options
    return {"from": payload.src, "to": payload.dst, "options": options, "intfs": {"from": "a-eth0", "to": "b-eth0"}}


def delete_link(src, dst):
    key = frozenset((src, dst))
    if key not in app.links:
        fail(404, "Node not found")
    app.links.pop(key, None)
    app.link_attrs.pop(key, None)
    return {"message": "deleted"}


def list_edges():
    edges = []
    for key in app.links:
        nodes = list(key)
        edges.append({
            "from": nodes[0],
            "to": nodes[1],
            "options": app.link_attrs.get(key) or {},
            "intfs": {"from": "a-eth0", "to": "b-eth0"},
        })
    return edges


stub = types.SimpleNamespace(
    app=app,
    Host=Host,
    Switch=Switch,
    Router=Host,
    Nat=Host,
    Controller=Host,
    HostUpdate=UpdateModel,
    RouterUpdate=UpdateModel,
    ControllerUpdate=UpdateModel,
    SwitchUpdate=UpdateModel,
    LinkOptions=LinkOptions,
    LinkCreate=LinkCreate,
    LinkUpdate=UpdateModel,
    create_host=create_host,
    create_switch=create_switch,
    create_router=create_host,
    create_nat=create_host,
    create_controller=create_host,
    delete_node=delete_node,
    create_link=create_link,
    delete_link=delete_link,
    list_edges=list_edges,
    update_host=update_host,
    update_router=update_router,
    update_controller=update_controller,
    update_switch_openflow_version=update_switch_openflow_version,
    update_link=update_link,
    _normalize_interface_ip=_number,
    _normalize_route=_normalize_route,
    _INTERFACE_NAME_RE=re.compile(r"^[A-Za-z0-9_.-]+$"),
)
mininet_gui_backend.api = stub
sys.modules["mininet_gui_backend.api"] = stub

from mininet_gui_backend.engines import (  # noqa: E402
    EngineConflict,
    EngineInvalidRequest,
    EngineResourceNotFound,
    EngineUnavailable,
    EngineUnsupported,
    LinkSpec,
    NodeSpec,
)
from mininet_gui_backend.engines.wired import WiredEngine  # noqa: E402

engine = WiredEngine()
asyncio.run(engine.create_session("sim_wired"))

host = engine.add_node(
    "sim_wired",
    NodeSpec(id="h1", type="host", name="h1", x=10, y=20, attributes={"ip": "10.0.0.1", "mac": "00:00:00:00:00:01"}),
)
if host["type"] != "host" or host["attributes"].get("ip") != "10.0.0.1" or host["x"] != 10.0:
    raise AssertionError(f"host 映射丢了类型 / 坐标 / attributes：{host}")

switch = engine.add_node(
    "sim_wired",
    NodeSpec(id="sw1", type="switch", name="sw1", attributes={"ports": 4, "controller": None}),
)
if switch["type"] != "switch" or switch["attributes"].get("ports") != 4:
    raise AssertionError(f"switch 映射不对：{switch}")

nodes = engine.list_nodes("sim_wired")
if [node["id"] for node in nodes] != ["h1", "sw1"]:
    raise AssertionError(f"list_nodes 没把五类台账合成一张表：{nodes}")

try:
    engine.add_node("sim_wired", NodeSpec(id="h2", type="host", attributes={"mac": "00:00:00:00:00:02"}))
except EngineInvalidRequest:
    pass
else:
    raise AssertionError("缺 ip 的 host 没有被判成非法请求")

try:
    engine.add_node("sim_wired", NodeSpec(id="ap1", type="ap"))
except EngineUnsupported:
    pass
else:
    raise AssertionError("无线类型在 M3 之前必须显式 501，而不是静默成功")

link = engine.add_link("sim_wired", LinkSpec(id="", src="h1", dst="sw1", options={"bw": 10}))
if link["id"] != "h1--sw1" or link["options"].get("bw") != 10:
    raise AssertionError(f"链路 id / options 映射不对：{link}")

links = engine.list_links("sim_wired")
if len(links) != 1 or links[0]["id"] != "h1--sw1" or links[0]["intfs"]["from"] != "a-eth0":
    raise AssertionError(f"list_links 没读 legacy 台账：{links}")

live = engine.status("sim_wired")
if live["node_count"] != 2 or live["link_count"] != 1:
    raise AssertionError(f"会话状态里的节点 / 链路计数不对：{live}")

# —— M1.2 部分更新（NMCPS-ADR-0029 D2）：`layout` 恒生效、`deferred` 看运行态、`live` 停网 409 ——

try:
    engine.update_node("sim_wired", "h1", {"type": "switch"})
except EngineInvalidRequest:
    pass
else:
    raise AssertionError("不可变字段（type）没有被就地拒绝成 400")

try:
    engine.update_node("sim_wired", "h1", {"attributes": {"nope": 1}})
except EngineInvalidRequest:
    pass
else:
    raise AssertionError("白名单之外的属性没有被判成非法请求")

try:
    engine.update_node("sim_wired", "h1", {})
except EngineInvalidRequest:
    pass
else:
    raise AssertionError("空 PATCH 没被拒绝")

try:
    engine.update_node("sim_wired", "nope", {"x": 1})
except EngineResourceNotFound:
    pass
else:
    raise AssertionError("更新不存在的节点没回 404 类错误")

# 停网：布局照落台账（`layout` 档恒 `applied: true`），且不碰 legacy 的更新路径
app.net.is_started = False
updates.clear()
layout_node, layout_applied = engine.update_node("sim_wired", "h1", {"x": 33, "y": 44})
if not layout_applied or layout_node["x"] != 33.0 or layout_node["y"] != 44.0:
    raise AssertionError(f"停网时改位置没落台账 / applied 不对：{layout_node} / {layout_applied}")
if updates:
    raise AssertionError(f"纯布局补丁不该调用 legacy 更新路径：{updates}")

# 停网：`deferred` 档只写台账（`applied: false`），不下发
_, host_applied = engine.update_node(
    "sim_wired",
    "h1",
    {"attributes": {"ip": "10.0.0.11", "default_route": "10.0.0.254"}},
)
if host_applied:
    raise AssertionError("停网时改主机地址 / 默认路由不该报 applied=true")
if updates:
    raise AssertionError(f"停网时不该真的下发：{updates}")
if app.hosts["h1"].ip != "10.0.0.11/8":
    raise AssertionError(f"停网时主机地址没落台账（应补 `api.update_host` 同口径的默认前缀）：{app.hosts['h1'].ip}")
if app.host_routes.get("h1") != "10.0.0.254":
    raise AssertionError(f"停网时默认路由没记进台账（重建后会丢）：{app.host_routes}")

# 停网：`live` 档（交换机 OpenFlow 版本）兑现不了 → 409
try:
    engine.update_node("sim_wired", "sw1", {"attributes": {"of_version": "OpenFlow13"}})
except EngineConflict:
    pass
else:
    raise AssertionError("停网时改 OpenFlow 版本没有回 409")

# 停网：链路 options 只写台账
link_patch, link_applied = engine.update_link("sim_wired", "h1--sw1", {"options": {"bw": 20}})
if link_applied or link_patch["options"].get("bw") != 20:
    raise AssertionError(f"停网时改链路带宽：台账应是 20、applied 应是 false，实际 {link_patch} / {link_applied}")
if updates:
    raise AssertionError(f"停网时不该真的下发链路：{updates}")

# 运行中：同样两个补丁变成真下发（`applied: true`）
app.net.is_started = True
updates.clear()
_, running_applied = engine.update_node(
    "sim_wired",
    "h1",
    {"attributes": {"ip": "10.0.0.12", "default_route": "10.0.0.253"}},
)
if not running_applied:
    raise AssertionError("运行中改主机地址 / 默认路由应报 applied=true")
live_host = app.nameToNode["h1"]
if getattr(live_host, "default_route", None) != "10.0.0.253":
    raise AssertionError(f"运行中的节点没收到新默认路由：{vars(live_host)}")
if not any(item[0] == "host" for item in updates):
    raise AssertionError("运行中改主机地址没走 legacy（前缀归一与 `setIP()` 都在它里面）")

running_switch, switch_applied = engine.update_node("sim_wired", "sw1", {"attributes": {"of_version": "OpenFlow13"}})
if not switch_applied or running_switch["attributes"].get("of_version") != "OpenFlow13":
    raise AssertionError(f"运行中改 OpenFlow 版本没落到投影：{running_switch}")

_, running_link_applied = engine.update_link("sim_wired", "h1--sw1", {"options": {"bw": 5}})
if not running_link_applied or app.link_attrs[frozenset(("h1", "sw1"))].get("bw") != 5:
    raise AssertionError(f"运行中改链路带宽没下发：{app.link_attrs}")

# 链路补丁的两种形状：显式 `{}` 合法（清台账），缺 `options` 是 400
cleared, cleared_applied = engine.update_link("sim_wired", "h1--sw1", {"options": {}})
if not cleared_applied or cleared["options"]:
    raise AssertionError(f"显式清空链路 options 应生效且台账为空：{cleared} / {cleared_applied}")
try:
    engine.update_link("sim_wired", "h1--sw1", {})
except EngineInvalidRequest:
    pass
else:
    raise AssertionError("缺 options 的链路补丁没被拒绝")

try:
    engine.update_link("sim_wired", "h1--sw1", {"options": {"mtu": 9000}})
except EngineInvalidRequest:
    pass
else:
    raise AssertionError("白名单之外的链路 option 没被拒绝")

try:
    engine.update_link("sim_wired", "h1--nope", {"options": {"bw": 1}})
except EngineResourceNotFound:
    pass
else:
    raise AssertionError("更新不存在的链路没回 404 类错误")

app.net.is_started = False

engine.remove_node("sim_wired", "h1")
if [node["id"] for node in engine.list_nodes("sim_wired")] != ["sw1"]:
    raise AssertionError("删节点没反映到统一台账")
if engine.list_links("sim_wired"):
    raise AssertionError("删节点后挂在上面的链路仍然在统一台账里")

try:
    engine.remove_node("sim_wired", "h1")
except EngineResourceNotFound:
    pass
else:
    raise AssertionError("删不存在的节点没回 404 类错误")

try:
    engine.remove_link("sim_wired", "no-such-link")
except EngineInvalidRequest:
    pass
else:
    raise AssertionError("不是 <src>--<dst> 形状的链路 id 没有被就地拒绝")

app.net = None
try:
    engine.add_node("sim_wired", NodeSpec(id="h3", type="host", attributes={"ip": "10.0.0.3", "mac": "00:00:00:00:00:03"}))
except EngineUnavailable:
    pass
else:
    raise AssertionError("非 root（app.net = None）时仍然接受了写请求")

print("wired-adapter-ok")
