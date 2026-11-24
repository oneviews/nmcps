"""会话层：2.0 的资源根（`docs/ai/simulation-parity.md` §4.1 S-A）。

参考侧的每条路径都带 `sim_id`，本仓 1.0 只有一张全局 `app.net`。M0 把「会话」立起来，
让 `/api/simulation/sessions/**` 成为统一入口；1.0 的 `/api/mininet/**` 在 M1 之前继续工作，
它们等价于「默认会话」，因此**两套不会互相踩**（见 `WiredEngine` 的单实例约束）。

本模块只依赖标准库与 `engines.base`：`pnpm check:engines` 在没有 fastapi / mininet 的
环境里也要能跑 dryrun 的整条会话链路。
"""

from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from mininet_gui_backend.engines import (
    Engine,
    EngineConflict,
    EngineError,
    EngineUnavailable,
    LinkSpec,
    NodeSpec,
    SessionNotFound,
    get_engine,
)

#: 单实例宿主上的会话上限：用完必须显式删（防「每点一次建一个」把内存与端口蚕食掉）
MAX_SESSIONS = 32


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _new_session_id() -> str:
    return f"sim_{uuid.uuid4().hex[:12]}"


@dataclass
class SessionRecord:
    id: str
    engine: str
    name: str
    state: str
    created_at: str
    updated_at: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    last_error: str = ""

    def as_dict(self, live: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "id": self.id,
            "engine": self.engine,
            "name": self.name,
            "state": self.state,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "metadata": dict(self.metadata),
        }
        if self.last_error:
            payload["last_error"] = self.last_error
        if live is not None:
            payload["live"] = live
        return payload


class SessionStore:
    """进程内会话表（一宿主一实例，不做持久化：进程重启即清空）。"""

    def __init__(self, max_sessions: int = MAX_SESSIONS, resolver=get_engine) -> None:
        self._records: Dict[str, SessionRecord] = {}
        self._lock = threading.RLock()
        self._max_sessions = max_sessions
        self._resolver = resolver

    # —— 内部 ——

    def _record(self, session_id: str) -> SessionRecord:
        record = self._records.get(session_id)
        if record is None:
            raise SessionNotFound(f"unknown session {session_id!r}")
        return record

    def _engine(self, record: SessionRecord) -> Engine:
        return self._resolver(record.engine)

    def _touch(self, record: SessionRecord, state: Optional[str] = None, error: str = "") -> None:
        if state is not None:
            record.state = state
        record.last_error = error
        record.updated_at = _now()

    def _fail(self, record: SessionRecord, exc: EngineError) -> None:
        self._touch(record, "error", exc.detail())

    # —— 生命周期 ——

    async def create(
        self,
        engine_name: str,
        name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SessionRecord:
        engine = self._resolver(engine_name)
        availability = engine.availability()
        if not availability.available:
            raise EngineUnavailable(availability.reason or "unavailable", engine=engine.name)

        session_id = _new_session_id()
        with self._lock:
            if len(self._records) >= self._max_sessions:
                raise EngineConflict(
                    f"session limit reached ({self._max_sessions}); delete an unused session first",
                    engine=engine.name,
                )

        await engine.create_session(session_id, {"metadata": dict(metadata or {})})

        record = SessionRecord(
            id=session_id,
            engine=engine.name,
            name=(name or "").strip() or session_id,
            state="created",
            created_at=_now(),
            updated_at=_now(),
            metadata=dict(metadata or {}),
        )
        with self._lock:
            self._records[session_id] = record
        return record

    def get(self, session_id: str) -> SessionRecord:
        with self._lock:
            return self._record(session_id)

    def list(self) -> List[SessionRecord]:
        with self._lock:
            return sorted(self._records.values(), key=lambda record: record.created_at)


    async def start(self, session_id: str) -> SessionRecord:
        record = self.get(session_id)
        engine = self._engine(record)
        try:
            await engine.start(session_id)
        except EngineError as exc:
            self._fail(record, exc)
            raise
        self._touch(record, "running")
        return record

    async def stop(self, session_id: str) -> SessionRecord:
        record = self.get(session_id)
        engine = self._engine(record)
        try:
            await engine.stop(session_id)
        except EngineError as exc:
            self._fail(record, exc)
            raise
        self._touch(record, "stopped")
        return record

    async def delete(self, session_id: str) -> SessionRecord:
        record = self.get(session_id)
        engine = self._engine(record)
        try:
            await engine.destroy_session(session_id)
        except EngineError as exc:
            self._fail(record, exc)
            raise
        with self._lock:
            self._records.pop(session_id, None)
        return record

    def status(self, session_id: str) -> Dict[str, Any]:
        record = self.get(session_id)
        engine = self._engine(record)
        try:
            live = engine.status(session_id)
        except EngineError as exc:
            self._fail(record, exc)
            raise
        return record.as_dict(live)

    # —— 统一节点 / 链路 ——

    def list_nodes(self, session_id: str) -> List[Dict[str, Any]]:
        record = self.get(session_id)
        return self._engine(record).list_nodes(session_id)

    def add_node(self, session_id: str, node: NodeSpec) -> Dict[str, Any]:
        record = self.get(session_id)
        return self._engine(record).add_node(session_id, node)

    def remove_node(self, session_id: str, node_id: str) -> None:
        record = self.get(session_id)
        self._engine(record).remove_node(session_id, node_id)

    def list_links(self, session_id: str) -> List[Dict[str, Any]]:
        record = self.get(session_id)
        return self._engine(record).list_links(session_id)

    def add_link(self, session_id: str, link: LinkSpec) -> Dict[str, Any]:
        record = self.get(session_id)
        return self._engine(record).add_link(session_id, link)

    def remove_link(self, session_id: str, link_id: str) -> None:
        record = self.get(session_id)
        self._engine(record).remove_link(session_id, link_id)
