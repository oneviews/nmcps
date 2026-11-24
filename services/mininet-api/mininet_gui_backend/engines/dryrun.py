"""dryrun 引擎：不碰内核的纯内存实现（NMCPS-DESIGN-008 M0）。

存在的理由只有一条：**CI 里没有 root、也不一定有 Mininet**，但 API 语义（会话、节点、
链路、起停的顺序约束）必须在每次 PR 上都可验证。参考侧的 `engines/dryrun/` 做的是同一件事，
这里从零写，不复制它的代码。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from mininet_gui_backend.engines.base import (
    Engine,
    EngineAvailability,
    EngineConflict,
    EngineInvalidRequest,
    LinkSpec,
    NodeSpec,
    SessionNotFound,
)


@dataclass
class _DrySession:
    started: bool = False
    nodes: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    links: Dict[str, Dict[str, Any]] = field(default_factory=dict)


class DryRunEngine(Engine):
    """内存引擎：起停只改一个布尔，节点 / 链路只记台账。"""

    name = "dryrun"
    kind = "dryrun"
    requires_root = False
    description = "In-memory engine: validates session / node / link semantics without root or Mininet."

    def __init__(self) -> None:
        self._sessions: Dict[str, _DrySession] = {}

    def availability(self) -> EngineAvailability:
        return EngineAvailability(True, "", {"root_required": False, "touches_kernel": False})

    def _session(self, session_id: str) -> _DrySession:
        session = self._sessions.get(session_id)
        if session is None:
            raise SessionNotFound(f"session {session_id!r} is not bound to engine {self.name}", engine=self.name)
        return session

    async def create_session(self, session_id: str, spec: Optional[Dict[str, Any]] = None) -> None:
        if session_id in self._sessions:
            raise EngineConflict(f"session {session_id!r} already exists", engine=self.name)
        self._sessions[session_id] = _DrySession()

    async def destroy_session(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    async def start(self, session_id: str) -> Dict[str, Any]:
        session = self._session(session_id)
        session.started = True
        return {"status": "ok", "started": True}

    async def stop(self, session_id: str) -> Dict[str, Any]:
        session = self._session(session_id)
        session.started = False
        return {"status": "ok", "started": False}

    def status(self, session_id: str) -> Dict[str, Any]:
        session = self._session(session_id)
        return {
            "engine": self.name,
            "started": session.started,
            "node_count": len(session.nodes),
            "link_count": len(session.links),
        }

    # —— 统一节点 ——

    def list_nodes(self, session_id: str) -> List[Dict[str, Any]]:
        return [dict(node) for node in self._session(session_id).nodes.values()]

    def add_node(self, session_id: str, node: NodeSpec) -> Dict[str, Any]:
        node.validate()
        session = self._session(session_id)
        if node.id in session.nodes:
            raise EngineConflict(f"node {node.id!r} already exists", engine=self.name)
        record = node.as_dict()
        session.nodes[node.id] = record
        return dict(record)

    def remove_node(self, session_id: str, node_id: str) -> None:
        session = self._session(session_id)
        if node_id not in session.nodes:
            raise EngineConflict(f"node {node_id!r} does not exist", engine=self.name)
        del session.nodes[node_id]
        # 挂在该节点上的链路一起回收：留着就是指向不存在端点的死链路
        for link_id, link in list(session.links.items()):
            if node_id in (link["src"], link["dst"]):
                del session.links[link_id]

    # —— 链路 ——

    def list_links(self, session_id: str) -> List[Dict[str, Any]]:
        return [dict(link) for link in self._session(session_id).links.values()]

    def add_link(self, session_id: str, link: LinkSpec) -> Dict[str, Any]:
        session = self._session(session_id)
        if not link.id.strip():
            raise EngineInvalidRequest("link id is empty")
        if link.id in session.links:
            raise EngineConflict(f"link {link.id!r} already exists", engine=self.name)
        if link.src == link.dst:
            raise EngineInvalidRequest("link endpoints must differ")
        for endpoint in (link.src, link.dst):
            if endpoint not in session.nodes:
                raise EngineInvalidRequest(f"link endpoint {endpoint!r} is not a node of this session")
        record = link.as_dict()
        session.links[link.id] = record
        return dict(record)

    def remove_link(self, session_id: str, link_id: str) -> None:
        session = self._session(session_id)
        if link_id not in session.links:
            raise EngineConflict(f"link {link_id!r} does not exist", engine=self.name)
        del session.links[link_id]
