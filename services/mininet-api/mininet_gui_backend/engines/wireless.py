"""无线引擎占位（M3 落地，`docs/ai/simulation-parity.md` §五）。

现在就把引擎登记出来，是为了让 `GET /api/simulation/engines` 在 2.0 之前就能回答
「无线为什么用不了」——一句 `engine_unavailable: mn_wifi_missing` 比前端空白强。

硬约束：**本模块不得在顶层 import `mn_wifi`**。它是 pip 依赖（不 vendored），
CI 与本机 `pnpm check:engines` 都不装它；顶层 import 会让整个后端在无无线依赖的机器上
起不来。`pnpm check:engines` 会断言这条。
"""

from __future__ import annotations

import importlib.util
import os
from typing import Any, Dict, List, Optional, Tuple

from mininet_gui_backend.engines.base import (
    Engine,
    EngineAvailability,
    EngineUnsupported,
    LinkSpec,
    NodeSpec,
)


def _is_root() -> bool:
    geteuid = getattr(os, "geteuid", None)
    return bool(geteuid) and geteuid() == 0


class WirelessEngine(Engine):
    """`mac80211_hwsim` + `hostapd` 引擎；M3 之前只报不可用。"""

    name = "wireless"
    kind = "wireless"
    requires_root = True
    description = "Wireless engine (mac80211_hwsim radios + hostapd); planned for M3."

    def availability(self) -> EngineAvailability:
        details: Dict[str, Any] = {"node_types": ["ap", "station"], "planned_phase": "M3"}
        if importlib.util.find_spec("mn_wifi") is None:
            return EngineAvailability(False, "mn_wifi_missing", details)
        if not _is_root():
            return EngineAvailability(False, "requires_root", details)
        return EngineAvailability(False, "engine_not_implemented", details)

    def _unsupported(self, action: str) -> EngineUnsupported:
        return EngineUnsupported(f"wireless engine arrives in M3 ({action})", engine=self.name)

    async def create_session(self, session_id: str, spec: Optional[Dict[str, Any]] = None) -> None:
        raise self._unsupported("create_session")

    async def destroy_session(self, session_id: str) -> None:
        # 幂等释放：会话创建失败时上层仍会走清理路径
        return None

    async def start(self, session_id: str) -> Dict[str, Any]:
        raise self._unsupported("start")

    async def stop(self, session_id: str) -> Dict[str, Any]:
        raise self._unsupported("stop")

    def status(self, session_id: str) -> Dict[str, Any]:
        raise self._unsupported("status")

    def list_nodes(self, session_id: str) -> List[Dict[str, Any]]:
        raise self._unsupported("list_nodes")

    def add_node(self, session_id: str, node: NodeSpec) -> Dict[str, Any]:
        raise self._unsupported("add_node")

    def remove_node(self, session_id: str, node_id: str) -> None:
        raise self._unsupported("remove_node")

    def list_links(self, session_id: str) -> List[Dict[str, Any]]:
        raise self._unsupported("list_links")

    def add_link(self, session_id: str, link: LinkSpec) -> Dict[str, Any]:
        raise self._unsupported("add_link")

    def remove_link(self, session_id: str, link_id: str) -> None:
        raise self._unsupported("remove_link")

    def update_node(self, session_id: str, node_id: str, patch: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
        raise self._unsupported("update_node")

    def update_link(self, session_id: str, link_id: str, patch: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
        raise self._unsupported("update_link")
