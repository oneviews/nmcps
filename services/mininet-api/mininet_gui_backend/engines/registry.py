"""引擎注册表（`docs/ai/simulation-parity.md` §4「无引擎抽象」的补口）。

只做三件事：按名字取引擎、列全部引擎、登记内置的三个。**不猜**：名字没登记就抛
`EngineNotFound`（路由层映射成 404），不会回落到「随便挑一个能用的引擎」——
回落会把「请求了无线却拿到有线」变成静默的错误拓扑。
"""

from __future__ import annotations

import threading
from typing import Dict, List

from mininet_gui_backend.engines.base import Engine, EngineNotFound

_REGISTRY: Dict[str, Engine] = {}
_LOCK = threading.Lock()


def register_engine(engine: Engine) -> Engine:
    """登记（幂等）：同名重复登记按最后一次覆盖，方便自检里换桩。"""
    if not engine.name:
        raise ValueError("engine.name must not be empty")
    with _LOCK:
        _REGISTRY[engine.name] = engine
    return engine


def get_engine(name: str) -> Engine:
    with _LOCK:
        engine = _REGISTRY.get(name.strip())
    if engine is None:
        known = ", ".join(sorted(_REGISTRY)) or "none"
        raise EngineNotFound(f"unknown engine {name!r} (registered: {known})", engine=name)
    return engine


def list_engines() -> List[Engine]:
    with _LOCK:
        return [_REGISTRY[name] for name in sorted(_REGISTRY)]


def engine_catalog() -> List[Dict[str, object]]:
    return [engine.describe() for engine in list_engines()]


def register_builtin_engines() -> None:
    """登记有线 / 无线 / dryrun 三个内置引擎（api 启动时调用，可重复调用）。"""
    from mininet_gui_backend.engines.dryrun import DryRunEngine
    from mininet_gui_backend.engines.wired import WiredEngine
    from mininet_gui_backend.engines.wireless import WirelessEngine

    register_engine(WiredEngine())
    register_engine(WirelessEngine())
    register_engine(DryRunEngine())
