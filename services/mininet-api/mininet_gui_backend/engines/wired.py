"""有线 Mininet 引擎：把全局 `app.net` 适配成统一引擎协议（M0 生命周期 → M1 节点 / 链路）。

`api.py` 是所有 `/api/mininet/**` 的实现（2.3k 行），M0 只接管了起停，M1 把**统一节点模型**
（`NodeSpec` / `LinkSpec`）接到 legacy 的后端函数上。刻意不重写建网逻辑：

- 建节点仍然走 `create_host` / `create_switch` / …（它们内部才认识 `TCLink`、OVS 端口、
  `switch_fail_mode()` 这些真实现），本层只做**形状转换 + 错误归一**；
- 因此引擎层不 import pydantic / mininet：模型类从 `api` 模块按名字取（`api.Host`），
  这样 `pnpm check:engines` 能在没有 fastapi / mininet 的机器上用桩模块跑通适配逻辑。

仍留在 legacy、M1.1 再迁：拖动落点（`node_position`）、改 IP / 默认路由、OpenFlow 版本、
流表、统计、抓包、导出。它们不是节点集合的增删，统一模型还没冻结「更新」的语义
（`Engine` 协议里没有 `update_node`），先不发明一套。
"""

from __future__ import annotations

import importlib.util
import os
from typing import Any, Dict, List, Optional

from mininet_gui_backend.engines.base import (
    Engine,
    EngineAvailability,
    EngineConflict,
    EngineError,
    EngineInvalidRequest,
    EngineResourceNotFound,
    EngineUnavailable,
    EngineUnsupported,
    LinkSpec,
    NodeSpec,
    SessionNotFound,
)

#: 主机上跑 Mininet 的常规前提（缺一不可，逐条报告而不是一句话「不可用」）
MININET_REQUIRED_COMMANDS = ("mn", "ovs-vsctl")

#: 统一节点类型 → legacy 模型类名（模型挂在 `api` 模块命名空间上，本层不 import schema）
NODE_MODEL_NAMES = {
    "host": "Host",
    "router": "Router",
    "switch": "Switch",
    "nat": "Nat",
    "controller": "Controller",
}

#: 统一节点类型 → legacy 建节点 handler 名（与 `POST /api/mininet/*` 同一个函数）
NODE_CREATOR_NAMES = {
    "host": "create_host",
    "router": "create_router",
    "switch": "create_switch",
    "nat": "create_nat",
    "controller": "create_controller",
}

#: 统一节点类型 → legacy 台账字典属性（读事实的唯一来源，不另存一份）
NODE_REGISTRY_NAMES = (
    ("host", "hosts"),
    ("switch", "switches"),
    ("router", "routers"),
    ("nat", "nats"),
    ("controller", "controllers"),
)

#: `NodeSpec` 自己带的字段：不进 legacy 模型的 `**payload`（`attributes` 才是扩展位）
_UNIFIED_NODE_KEYS = ("id", "type", "name", "x", "y", "attributes")

#: legacy 建节点时 `type` 只做留痕（真正的节点类型由 `add_*_to_net()` 写），沿用 1.0 的语义名


def _is_root() -> bool:
    geteuid = getattr(os, "geteuid", None)
    return bool(geteuid) and geteuid() == 0


def _missing_commands() -> List[str]:
    from shutil import which

    return [command for command in MININET_REQUIRED_COMMANDS if which(command) is None]


def _legacy() -> Any:
    """取 legacy `api` 模块（late import）：`api.py` 在导入时注册本引擎，顶层 import 会成环。"""
    from mininet_gui_backend import api

    return api


def _require_net(api: Any) -> Any:
    """legacy 的节点 / 链路读写都要 `app.net`（非 root 时它是 `None`，见 `_build_network()`）。"""
    net = getattr(api.app, "net", None)
    if net is None:
        raise EngineUnavailable("legacy network is not available on this host (requires root)", engine="wired")
    return net


def _message_of(exc: Exception) -> str:
    """legacy 侧的人类可读原话：`HTTPException.detail` / pydantic 的首条校验错误。"""
    detail = getattr(exc, "detail", None)
    if isinstance(detail, str) and detail.strip():
        return detail.strip()

    errors = getattr(exc, "errors", None)
    if callable(errors):
        try:
            first = errors()[0]
        except Exception:  # pragma: no cover - 防御式：拿不到就退回 str(exc)
            first = None
        if isinstance(first, dict) and isinstance(first.get("msg"), str):
            location = ".".join(str(part) for part in first.get("loc") or ())
            return f"{location}: {first['msg']}" if location else first["msg"]

    text = str(exc).strip().splitlines()
    return text[0] if text else "legacy backend rejected the request"


def _legacy_error(exc: Exception) -> EngineError:
    """legacy `HTTPException` → 引擎错误：状态码决定类别，原话原样带出（不做 i18n）。

    不 import fastapi：本层靠 duck typing 读 `status_code` / `detail`，
    这样 `check:engines` 能用桩模块在无 fastapi 的环境里跑同一条路径。
    """
    message = _message_of(exc)
    status = getattr(exc, "status_code", None)

    if status == 404:
        return EngineResourceNotFound(message, engine="wired")
    if status == 409:
        return EngineConflict(message, engine="wired")
    if isinstance(status, int) and 400 <= status < 500:
        return EngineInvalidRequest(message, engine="wired")
    return EngineError(message, engine="wired")


def _dump(model: Any) -> Dict[str, Any]:
    """legacy 模型 → dict：pydantic v2 的 `model_dump()`，桩 / 旧模型退回 `vars()`。"""
    dump = getattr(model, "model_dump", None)
    if callable(dump):
        return dict(dump())
    return dict(vars(model))


def _unified_node(node_type: str, model: Any) -> Dict[str, Any]:
    """legacy 模型 → 统一节点：`id/type/name/x/y` 提到顶层，其余键进 `attributes`。"""
    dump = _dump(model)
    attributes = {key: value for key, value in dump.items() if key not in ("id", "type", "name", "label", "x", "y")}
    name = str(dump.get("name") or dump.get("id") or "")
    return {
        "id": str(dump.get("id") or name),
        "type": node_type,
        "name": name,
        "x": float(dump.get("x") or 0.0),
        "y": float(dump.get("y") or 0.0),
        "attributes": attributes,
    }


def unified_nodes() -> List[Dict[str, Any]]:
    """五类分表的统一投影：`id/type/name/x/y` 提到顶层，其余键进 `attributes`。

    刻意**不判会话绑定**：1.x 的 `/api/mininet/nodes` 等价于「默认会话」（`sessions.py`
    模块注释），而会话侧那条在读之前先过 `_bound()`。两条读共用这里的形状，避免出现
    两份 `_unified_node()` 调用顺序不同的投影。
    """
    api = _legacy()
    nodes: List[Dict[str, Any]] = []
    for node_type, registry in NODE_REGISTRY_NAMES:
        for model in (getattr(api.app, registry, None) or {}).values():
            nodes.append(_unified_node(node_type, model))
    return sorted(nodes, key=lambda node: node["id"])


def _link_id(source: str, target: str) -> str:
    """统一链路 id：`src--dst`（无向，按字典序归一，与台账的链路键同口径）。"""
    left, right = sorted((source, target))
    return f"{left}--{right}"


class WiredEngine(Engine):
    """全局 `app.net` 单例的适配器；一宿主一实例（`docs/ai/simulation-parity.md` §4.4）。"""

    name = "wired"
    kind = "wired"
    requires_root = True
    description = "Wired Mininet engine (legacy singleton app.net)."

    def __init__(self) -> None:
        self._session_id: Optional[str] = None

    def availability(self) -> EngineAvailability:
        details: Dict[str, Any] = {
            "single_instance": True,
            "node_crud": "unified_m1",
        }
        if importlib.util.find_spec("mininet") is None:
            return EngineAvailability(False, "mininet_missing", details)
        if not _is_root():
            return EngineAvailability(False, "requires_root", details)
        missing = _missing_commands()
        if missing:
            return EngineAvailability(False, "mininet_commands_missing", {**details, "missing": missing})
        return EngineAvailability(True, "", details)

    def _bound(self, session_id: str) -> None:
        if self._session_id is None:
            raise SessionNotFound(f"session {session_id!r} is not bound to engine {self.name}", engine=self.name)
        if self._session_id != session_id:
            raise SessionNotFound(
                f"engine {self.name} is bound to session {self._session_id!r}, not {session_id!r}",
                engine=self.name,
            )

    async def create_session(self, session_id: str, spec: Optional[Dict[str, Any]] = None) -> None:
        if self._session_id is not None and self._session_id != session_id:
            # 全局 app.net 只有一个：第二个 wired 会话会把前一个的画面换成自己的
            raise EngineConflict(
                f"engine {self.name} already owns session {self._session_id!r} (single-instance host)",
                engine=self.name,
            )
        self._session_id = session_id

    async def destroy_session(self, session_id: str) -> None:
        if self._session_id != session_id:
            return
        self._session_id = None

    async def start(self, session_id: str) -> Dict[str, Any]:
        self._bound(session_id)
        api = _legacy()
        return api.start_network()

    async def stop(self, session_id: str) -> Dict[str, Any]:
        self._bound(session_id)
        api = _legacy()
        return await api.stop_network()

    def status(self, session_id: str) -> Dict[str, Any]:
        self._bound(session_id)
        api = _legacy()
        net = getattr(api.app, "net", None)
        return {
            "engine": self.name,
            "started": bool(getattr(net, "is_started", False)),
            "node_count": sum(len(getattr(api.app, registry, None) or {}) for _, registry in NODE_REGISTRY_NAMES),
            "link_count": len(getattr(api.app, "links", None) or {}),
        }

    # —— 统一节点（M1）：形状转换 + 错误归一，建网逻辑仍由 legacy 实现 ——

    def list_nodes(self, session_id: str) -> List[Dict[str, Any]]:
        self._bound(session_id)
        return unified_nodes()

    def add_node(self, session_id: str, node: NodeSpec) -> Dict[str, Any]:
        self._bound(session_id)
        node.validate()
        api = _legacy()

        model_name = NODE_MODEL_NAMES.get(node.type)
        creator_name = NODE_CREATOR_NAMES.get(node.type)
        if model_name is None or creator_name is None:
            # `ap` / `station` 在 `NODE_TYPES` 里（M3 无线），有线引擎还不能建
            raise EngineUnsupported(f"wired engine cannot create node type {node.type!r} (M3)", engine=self.name)

        # 类型判完再判实例：请求本身不合法不该被报成「引擎不可用」
        _require_net(api)

        name = node.name or node.id
        payload: Dict[str, Any] = {
            "id": node.id,
            "type": node.type,
            "name": name,
            "label": str(node.attributes.get("label") or name),
            "x": float(node.x),
            "y": float(node.y),
        }
        for key, value in node.attributes.items():
            if key not in _UNIFIED_NODE_KEYS:
                payload[key] = value

        model_class = getattr(api, model_name, None)
        creator = getattr(api, creator_name, None)
        if model_class is None or creator is None:
            raise EngineUnavailable(f"legacy backend lost {model_name}/{creator_name}", engine=self.name)

        try:
            instance = model_class(**payload)
        except Exception as exc:
            # pydantic 的必填字段缺失 / 类型不符：请求本身不合法，不是引擎故障
            raise EngineInvalidRequest(_message_of(exc), engine=self.name) from exc

        try:
            creator(instance)
        except Exception as exc:
            raise _legacy_error(exc) from exc

        return _unified_node(node.type, instance)

    def remove_node(self, session_id: str, node_id: str) -> None:
        self._bound(session_id)
        api = _legacy()
        _require_net(api)
        try:
            api.delete_node(node_id)
        except Exception as exc:
            raise _legacy_error(exc) from exc

    # —— 统一链路（M1） ——

    def list_links(self, session_id: str) -> List[Dict[str, Any]]:
        self._bound(session_id)
        api = _legacy()
        links: List[Dict[str, Any]] = []
        for edge in api.list_edges():
            source = str(edge.get("from") or "")
            target = str(edge.get("to") or "")
            if not source or not target:
                continue
            record: Dict[str, Any] = {
                "id": _link_id(source, target),
                "src": source,
                "dst": target,
                "options": dict(edge.get("options") or {}),
            }
            if edge.get("intfs"):
                record["intfs"] = edge["intfs"]
            links.append(record)
        return sorted(links, key=lambda link: link["id"])

    def add_link(self, session_id: str, link: LinkSpec) -> Dict[str, Any]:
        self._bound(session_id)
        api = _legacy()
        _require_net(api)

        if not link.src or not link.dst:
            raise EngineInvalidRequest("link endpoints are empty", engine=self.name)
        if link.src == link.dst:
            raise EngineInvalidRequest("link endpoints must differ", engine=self.name)

        try:
            options = api.LinkOptions(**link.options) if link.options else None
            payload = api.LinkCreate(src=link.src, dst=link.dst, options=options)
            created = api.create_link(payload)
        except Exception as exc:
            raise _legacy_error(exc) from exc

        record: Dict[str, Any] = {
            "id": link.id or _link_id(link.src, link.dst),
            "src": link.src,
            "dst": link.dst,
            "options": dict((created or {}).get("options") or link.options or {}),
        }
        if (created or {}).get("intfs"):
            record["intfs"] = created["intfs"]
        return record

    def remove_link(self, session_id: str, link_id: str) -> None:
        self._bound(session_id)
        api = _legacy()
        _require_net(api)

        source, _, target = link_id.partition("--")
        if not source or not target:
            raise EngineInvalidRequest(f"link id {link_id!r} is not '<src>--<dst>'", engine=self.name)

        try:
            api.delete_link(source, target)
        except Exception as exc:
            raise _legacy_error(exc) from exc
