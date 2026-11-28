"""仿真引擎抽象（NMCPS-DESIGN-008 M0）。

为什么单开一层：2.0 要接三种引擎（有线 Mininet、无线 hwsim、无 root 的 dryrun），
而 `api.py` 从 1.0 起直接 `import mininet` 并操作全局 `app.net`。把差异收在这层之后，
上层（会话 / 路由）只认 `Engine` 协议，不再逐个分支判断「有线还是无线」。

**本模块只依赖标准库**：`pnpm check:engines` 会在没有 fastapi / mininet 的环境里
导入它并跑一遍 dryrun 引擎的行为用例。

统一节点模型（NMCPS-ADR-0027 D2）：引擎面只有一种节点 `NodeSpec{type, ...}`，
`host` / `router` / `switch` / `controller` / `nat` / `ap` / `station` 都是它的 `type`。
分表视图（`/api/mininet/hosts` 等）属于兼容层，不进引擎。
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

#: 引擎面认可的节点类型；无线（M3）只需要在列表里加 `ap` / `station`
NODE_TYPES = ("host", "router", "switch", "controller", "nat", "ap", "station")

#: 会话状态机（`created → running ⇄ stopped → …`）；`error` 只由引擎失败置位
SESSION_STATES = ("created", "running", "stopped", "error")


class EngineError(Exception):
    """引擎层错误的基类：`status_code` + `reason` 就是回给页面的诊断信息。

    `reason` 是稳定的机器可读串（页面 / 自检按它断言），`message` 是人类可读补充。
    两者都不做 i18n：上游原话按 `NMCPS-ARCH-006` §7 原样透出。
    """

    status_code = 400
    reason = "engine_error"

    def __init__(self, message: str = "", *, engine: Optional[str] = None) -> None:
        self.message = message
        self.engine = engine
        super().__init__(self.detail())

    def detail(self) -> str:
        parts = [self.reason]
        if self.engine:
            parts.append(f"engine={self.engine}")
        if self.message:
            parts.append(self.message)
        return ": ".join(parts)


class EngineNotFound(EngineError):
    status_code = 404
    reason = "engine_not_found"


class SessionNotFound(EngineError):
    status_code = 404
    reason = "session_not_found"


class EngineResourceNotFound(EngineError):
    """引擎里的节点 / 链路不存在（与「会话不存在」分开：页面要能分辨哪一层缺东西）。"""

    status_code = 404
    reason = "engine_resource_not_found"


class EngineUnavailable(EngineError):
    """引擎存在但不能用：缺 root、缺依赖、尚未实现（M3 之前没有无线引擎）。"""

    status_code = 409
    reason = "engine_unavailable"


class EngineConflict(EngineError):
    """同一引擎已有绑定的会话 / 节点 id 重复 —— 并发与重复写都要能分辨。"""

    status_code = 409
    reason = "engine_conflict"


class EngineUnsupported(EngineError):
    """某引擎还没实现该能力（例如有线引擎的节点 CRUD 要等 M1 统一节点）。"""

    status_code = 501
    reason = "engine_unsupported"


class EngineInvalidRequest(EngineError):
    status_code = 400
    reason = "engine_invalid_request"


@dataclass(frozen=True)
class EngineAvailability:
    """`GET /api/simulation/engines` 里的一行可用性事实。"""

    available: bool
    reason: str = ""
    details: Dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        return {"available": self.available, "reason": self.reason, "details": dict(self.details)}


@dataclass
class NodeSpec:
    """引擎面唯一节点形状；`attributes` 只放该类型自己的字段（ip / mac / ports …）。"""

    id: str
    type: str
    name: str = ""
    x: float = 0.0
    y: float = 0.0
    attributes: Dict[str, Any] = field(default_factory=dict)

    def validate(self) -> None:
        if not self.id.strip():
            raise EngineInvalidRequest("node id is empty")
        if self.type not in NODE_TYPES:
            raise EngineInvalidRequest(f"unknown node type {self.type!r}")

    def as_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "name": self.name or self.id,
            "x": self.x,
            "y": self.y,
            "attributes": dict(self.attributes),
        }


@dataclass
class LinkSpec:
    """链路：两端都用节点 id；`options` 就是上游 `LinkOptions` 的键（bw / delay …）。"""

    id: str
    src: str
    dst: str
    options: Dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "src": self.src, "dst": self.dst, "options": dict(self.options)}


# —— 更新类语义（NMCPS-ADR-0029 M1.2）——
#
# 白名单与生效档位放在这里而不是各引擎各写一份：`wired` 与 `dryrun` 必须对「哪些字段能改、
# 哪些键该 400」给出一致答案，否则 `check:engines` 验的语义与真后端不是同一个。
# 本模块只依赖标准库，校验函数也只用标准库（不 import pydantic）。

#: 不可变字段（ADR-0029 D3）：改名 / 换类型 / 改 MAC 都要重建节点，出现即 400
IMMUTABLE_NODE_FIELDS = ("id", "type", "mac", "name")

#: 统一模型里可更新的顶层字段（D1：位置并入节点 PATCH，不再是 `POST /node_position`）
NODE_LAYOUT_FIELDS = ("x", "y")

#: `attributes` 键白名单：类型 → {请求键: 台账键}（ADR-0029 §3）。
#: 同时收台账名（`interface_ips` / `ip_forward`，D1 允许分表字段名出现在 attributes 内）
#: 与 ADR 表里的驼峰名（`interfaceIps` / `ipForward`），两者归一成同一个台账键 ——
#: 页面表单用驼峰，读回的统一投影用台账名，多一种写法就要多一次静默失败。
NODE_ATTRIBUTE_FIELDS: Dict[str, Dict[str, str]] = {
    "host": {
        "ip": "ip",
        "default_route": "default_route",
        "defaultRoute": "default_route",
    },
    "router": {
        "ip": "ip",
        "interface_ips": "interface_ips",
        "interfaceIps": "interface_ips",
        "routes": "routes",
        "proxy_arp": "proxy_arp",
        "proxyArp": "proxy_arp",
        "ip_forward": "ip_forward",
        "ipForward": "ip_forward",
    },
    "controller": {
        "ip": "ip",
        "port": "port",
        "ryu_app": "ryu_app",
        "ryuApp": "ryu_app",
    },
    "switch": {
        "of_version": "of_version",
        "ofVersion": "of_version",
    },
    # NAT 连 1.x 更新端点都没有（ADR-0029 §3）：任何 attributes 都按未登记键回 400
    "nat": {},
}

#: `live` 档字段（D2）：改的是 OVS 桥参数，停网时无法兑现 → 409
NODE_LIVE_FIELDS = frozenset({"of_version"})

#: 链路 `options` 的可更新键（§3）；`max_queue_size` / `use_htb` 仍是 1.x 专用
LINK_OPTION_FIELDS = ("bw", "delay", "jitter", "loss")

#: `of_version` 的取值（与 `api.update_switch_openflow_version` 同一份口径）
OPENFLOW_VERSIONS = (None, "OpenFlow10", "OpenFlow11", "OpenFlow12", "OpenFlow13", "OpenFlow14", "OpenFlow15")


def _invalid(message: str) -> EngineInvalidRequest:
    return EngineInvalidRequest(message)


def _number_of(key: str, value: Any, *, minimum: Optional[float] = None, maximum: Optional[float] = None) -> float:
    # bool 是 int 的子类：`{"bw": true}` 必须拒绝，否则 `true` 会被当成 1 Mbit
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _invalid(f"{key} must be a number")
    if minimum is not None and value < minimum:
        raise _invalid(f"{key} must be >= {minimum}")
    if maximum is not None and value > maximum:
        raise _invalid(f"{key} must be <= {maximum}")
    return float(value)


def _check_node_attribute(node_type: str, key: str, value: Any) -> Any:
    """按台账键做**形状**校验；语义合法性仍归 legacy（pydantic / `setIP`）。"""
    if key in ("ip", "default_route"):
        if not isinstance(value, str):
            raise _invalid(f"{node_type}.{key} must be a string")
        if key == "ip" and not value.strip():
            raise _invalid("host/router ip must not be empty")
        return value.strip() if key == "default_route" else value
    if key == "interface_ips":
        if not isinstance(value, dict):
            raise _invalid("router.interface_ips must be an object")
        for name, address in value.items():
            if not isinstance(name, str) or not isinstance(address, str):
                raise _invalid("router.interface_ips must map interface names to address strings")
        return {name: address.strip() for name, address in value.items()}
    if key == "routes":
        if not isinstance(value, list) or any(not isinstance(route, str) for route in value):
            raise _invalid("router.routes must be a list of route strings")
        return [route.strip() for route in value]
    if key in ("proxy_arp", "ip_forward"):
        if not isinstance(value, bool):
            raise _invalid(f"router.{key} must be a boolean")
        return value
    if key == "port":
        if isinstance(value, bool) or not isinstance(value, int):
            raise _invalid("controller.port must be an integer")
        return value
    if key == "ryu_app":
        if not isinstance(value, (str, list)):
            raise _invalid("controller.ryu_app must be a string or a list")
        return value
    if key == "of_version":
        if value not in OPENFLOW_VERSIONS:
            raise _invalid(f"switch.of_version must be one of {OPENFLOW_VERSIONS}")
        return value
    raise _invalid(f"unhandled attribute {key!r}")  # pragma: no cover - 白名单已收敛


def split_node_patch(node_type: str, patch: Any) -> Tuple[Dict[str, float], Dict[str, Any]]:
    """把节点 PATCH 拆成 `(layout, attributes)`；不合法就抛 `engine_invalid_request`。

    `layout` 只有 `x` / `y`，`attributes` 的键已归一成台账名。空 patch（含只有空
    `attributes` 的）一律拒绝：让「什么都没改」返回 200 会让页面以为保存成功。
    """
    if node_type in ("ap", "station"):
        # M3 之前无线不可用（ADR-0029 §5）：不写「等 M3 再生效」的假台账
        raise EngineUnsupported(f"node type {node_type!r} has no updatable attributes before M3")

    if not isinstance(patch, dict):
        raise _invalid("node patch must be a JSON object")

    allowed = NODE_ATTRIBUTE_FIELDS.get(node_type, {})
    layout: Dict[str, float] = {}
    attributes: Dict[str, Any] = {}
    carries_attributes = False

    for key, value in patch.items():
        if key in NODE_LAYOUT_FIELDS:
            layout[key] = _number_of(key, value)
            continue
        if key == "attributes":
            if not isinstance(value, dict):
                raise _invalid("node patch attributes must be a JSON object")
            carries_attributes = True
            for attribute_key, attribute_value in value.items():
                if attribute_key in IMMUTABLE_NODE_FIELDS:
                    raise _invalid(f"{attribute_key!r} is immutable; rebuild the node instead")
                ledger_key = allowed.get(attribute_key)
                if ledger_key is None:
                    if not allowed:
                        raise _invalid(f"node type {node_type!r} has no updatable attributes")
                    raise _invalid(f"unknown attribute {attribute_key!r} for node type {node_type!r}")
                attributes[ledger_key] = _check_node_attribute(node_type, ledger_key, attribute_value)
            continue
        if key in IMMUTABLE_NODE_FIELDS:
            raise _invalid(f"{key!r} is immutable; rebuild the node instead")
        raise _invalid(f"unknown node patch field {key!r}")

    if not layout and not carries_attributes:
        raise _invalid("node patch carries no changes (expected x, y or attributes)")
    if carries_attributes and not attributes:
        raise _invalid("node patch attributes is empty")

    return layout, attributes


def split_link_patch(patch: Any) -> Dict[str, Any]:
    """把链路 PATCH 拆成 `options`；显式 `{}` 是合法请求（清空台账，不回收 tc）。"""
    if not isinstance(patch, dict):
        raise _invalid("link patch must be a JSON object")

    unknown = sorted(set(patch) - {"options"})
    if unknown:
        raise _invalid(f"unknown link patch field {unknown[0]!r}")
    if "options" not in patch:
        raise _invalid("link patch needs 'options' (send {} to clear the ledger)")

    raw = patch["options"]
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise _invalid("link patch options must be a JSON object")

    unexpected = sorted(set(raw) - set(LINK_OPTION_FIELDS))
    if unexpected:
        raise _invalid(f"unknown link option {unexpected[0]!r}")

    options: Dict[str, Any] = {}
    for key, value in raw.items():
        if key == "bw":
            options[key] = _number_of("bw", value, minimum=0)
        elif key in ("delay", "jitter"):
            if isinstance(value, str):
                options[key] = value.strip()
            else:
                options[key] = _number_of(key, value, minimum=0)
        elif key == "loss":
            options[key] = _number_of("loss", value, minimum=0, maximum=100)
    return options


class Engine(abc.ABC):
    """所有引擎的统一协议。

    生命周期方法一律 `async`：有线引擎要把 stop 交给 legacy `stop_network()`（协程），
    未来无线引擎还要在子进程里建网（参考侧 `configureNodes()` 会裸 `exit()`，
    同进程会打死 API —— 见 `docs/ai/simulation-parity.md` §4.4）。
    查询 / 记账方法同步，因为 dryrun 是纯内存、有线侧也只读台账。
    """

    #: 引擎名（路径与 API 里用它，不改名）
    name: str = ""
    #: `wired` / `wireless` / `dryrun`
    kind: str = ""
    #: 是否需要 root（`dryrun` 为 False，这是它能在 CI 里跑的原因）
    requires_root: bool = False
    #: 一句话说明（页面 / 运维文档直接展示，不做 i18n）
    description: str = ""

    def availability(self) -> EngineAvailability:  # pragma: no cover - 默认实现
        return EngineAvailability(True)

    def describe(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "kind": self.kind,
            "requires_root": self.requires_root,
            "description": self.description,
            "availability": self.availability().as_dict(),
        }

    # —— 会话生命周期 ——
    @abc.abstractmethod
    async def create_session(self, session_id: str, spec: Optional[Dict[str, Any]] = None) -> None:
        """把会话绑定到引擎；无法并发绑定的引擎在这里抛 `EngineConflict`。"""

    @abc.abstractmethod
    async def destroy_session(self, session_id: str) -> None:
        """释放会话（幂等：未绑定时不报错）。"""

    @abc.abstractmethod
    async def start(self, session_id: str) -> Dict[str, Any]:
        ...

    @abc.abstractmethod
    async def stop(self, session_id: str) -> Dict[str, Any]:
        ...

    @abc.abstractmethod
    def status(self, session_id: str) -> Dict[str, Any]:
        ...

    # —— 统一节点 / 链路 ——
    @abc.abstractmethod
    def list_nodes(self, session_id: str) -> List[Dict[str, Any]]:
        ...

    @abc.abstractmethod
    def add_node(self, session_id: str, node: NodeSpec) -> Dict[str, Any]:
        ...

    @abc.abstractmethod
    def remove_node(self, session_id: str, node_id: str) -> None:
        ...

    @abc.abstractmethod
    def list_links(self, session_id: str) -> List[Dict[str, Any]]:
        ...

    @abc.abstractmethod
    def add_link(self, session_id: str, link: LinkSpec) -> Dict[str, Any]:
        ...

    @abc.abstractmethod
    def remove_link(self, session_id: str, link_id: str) -> None:
        ...

    # —— 部分更新（NMCPS-ADR-0029 M1.2）——
    # 只更新既有对象，不新建：D3 把 id / type / mac / name 冻结成不可变字段，
    # 「等效于重建」的改动必须走删 + 建（页面据此提示，而不是让引擎偷偷重建）。
    @abc.abstractmethod
    def update_node(self, session_id: str, node_id: str, patch: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
        """按 `split_node_patch()` 的语义部分更新节点，返回 `(统一投影, applied)`。

        `applied` 是 D2 的生效事实：`layout` 档恒 `True`；`deferred` 档只在网络
        运行中才 `True`（停网时只落台账，下次 `start()` 兑现）；`live` 档停网即 409。
        """

    @abc.abstractmethod
    def update_link(self, session_id: str, link_id: str, patch: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
        """按 `split_link_patch()` 的语义部分更新链路，返回 `(链路投影, applied)`。"""
