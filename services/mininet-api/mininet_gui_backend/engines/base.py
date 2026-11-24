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
from typing import Any, Dict, List, Optional

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
