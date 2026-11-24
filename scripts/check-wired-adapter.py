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
    nameToNode={},
)


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
    LinkOptions=LinkOptions,
    LinkCreate=LinkCreate,
    create_host=create_host,
    create_switch=create_switch,
    create_router=create_host,
    create_nat=create_host,
    create_controller=create_host,
    delete_node=delete_node,
    create_link=create_link,
    delete_link=delete_link,
    list_edges=list_edges,
)
mininet_gui_backend.api = stub
sys.modules["mininet_gui_backend.api"] = stub

from mininet_gui_backend.engines import (  # noqa: E402
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
