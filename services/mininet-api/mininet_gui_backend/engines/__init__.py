"""仿真引擎抽象层（NMCPS-DESIGN-008 M0）。

对外只有这份导出面：会话 / 路由只从这里取 `Engine`、注册表与错误类型，
不直接 import 具体引擎模块 —— 这样 M3 加无线时不用改调用方。
"""

from mininet_gui_backend.engines.base import (
    NODE_TYPES,
    SESSION_STATES,
    Engine,
    EngineAvailability,
    EngineConflict,
    EngineError,
    EngineInvalidRequest,
    EngineNotFound,
    EngineResourceNotFound,
    EngineUnavailable,
    EngineUnsupported,
    LinkSpec,
    NodeSpec,
    SessionNotFound,
)
from mininet_gui_backend.engines.registry import (
    engine_catalog,
    get_engine,
    list_engines,
    register_builtin_engines,
    register_engine,
)

__all__ = [
    "NODE_TYPES",
    "SESSION_STATES",
    "Engine",
    "EngineAvailability",
    "EngineConflict",
    "EngineError",
    "EngineInvalidRequest",
    "EngineNotFound",
    "EngineResourceNotFound",
    "EngineUnavailable",
    "EngineUnsupported",
    "LinkSpec",
    "NodeSpec",
    "SessionNotFound",
    "engine_catalog",
    "get_engine",
    "list_engines",
    "register_builtin_engines",
    "register_engine",
]
