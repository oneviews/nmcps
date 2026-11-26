"""从在线 Mininet 实例抽「agent 档案」（`NMCPS-ADR-0028` D2 / D5）。

只读 `app.net` 的事实（节点名、类型、接口 IP / MAC / 前缀 / MTU），不读页面状态，
也不改网络。两种消费方：

- `runtime.start_for_net()`：把档案落盘后交给 `snmp/agent.py` 起服务；
- `GET /api/mininet/snmp/topology`：把 archive 投影成给 NMS 用的 seed 列表。

**只依赖标准库**：测试用桩节点对象即可，不 import mininet。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from mininet_gui_backend.snmp.mib import ENTERPRISE_ROOT, TYPE_ARCS

#: Mininet 节点类型 → 统一台帐类型（`node.type` 不认时按类名兜底）
_TYPE_BY_NAME = {
    "switch": "switch",
    "host": "host",
    "router": "router",
    "nat": "nat",
    "controller": "controller",
    "station": "station",
    "ap": "ap",
}


def node_type(node: Any) -> str:
    """先看 `node.type`，再看类名；两者都不认就是 `host`（端系统语义更安全）。"""
    raw = str(getattr(node, "type", "") or "").lower()
    if raw in _TYPE_BY_NAME:
        return _TYPE_BY_NAME[raw]
    class_name = type(node).__name__.lower()
    for key, value in _TYPE_BY_NAME.items():
        if key in class_name:
            return value
    return "host"


def _call(value: Any) -> Any:
    """Mininet 的 `IP()` / `MAC()` 是方法；桩对象可能直接给字符串。"""
    return value() if callable(value) else value


def _text(obj: Any, *names: str) -> str:
    """按顺序取第一个非空字符串属性（同时兼容方法与普通字段）。"""
    for name in names:
        try:
            value = _call(getattr(obj, name, ""))
        except Exception:  # pragma: no cover - 属性访问失败按缺失处理
            continue
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _first_ipv4(node: Any) -> str:
    direct = _text(node, "IP", "ip")
    if direct and direct != "0.0.0.0" and not direct.startswith("127."):
        return direct
    for intf in _interfaces(node):
        ip = _text(intf, "ip", "IP")
        if ip and ip != "0.0.0.0" and not ip.startswith("127."):
            return ip
    return ""


def _interfaces(node: Any) -> List[Any]:
    try:
        return list(node.intfList() or [])
    except Exception:  # pragma: no cover - 桩对象可能没有 intfList
        return []


def _interface_rows(node: Any) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for intf in _interfaces(node):
        rows.append(
            {
                "name": _text(intf, "name"),
                "ip": _text(intf, "ip", "IP"),
                "prefix_len": int(getattr(intf, "prefixLen", 24) or 24),
                "mac": _text(intf, "mac", "MAC"),
                "mtu": int(getattr(intf, "MTU", 1500) or 1500),
            }
        )
    if not rows:
        ip = _first_ipv4(node)
        if ip:
            rows.append(
                {
                    "name": "eth0",
                    "ip": ip,
                    "prefix_len": 24,
                    "mac": _text(node, "MAC", "mac"),
                    "mtu": 1500,
                }
            )
    return rows


def build_topology(
    nodes: List[Dict[str, Any]],
    links: List[Dict[str, Any]],
    status: Dict[str, Any],
) -> Dict[str, Any]:
    """台账节点 / 链路 + agent 读数 → 给 NMS 用的 seed 清单（`NMCPS-ADR-0028` D6）。

    与参考侧 `POST /snmp/topology` 的语义不同：那边扫宿主子网、读 LLDP 反推；
    这里只是把**仿真网台账**原样发布成可采集目标，邻接也来自台账链路。
    """
    port = int(status.get("port") or 161)
    # 开通凭据后 status.community 是 `None`（D9）：这里必须原样发布成 null，
    # 不能 `or "public"` 兜底 —— 那会把一个错的社区串写进 NMS 的 seed 清单。
    raw_community = status.get("community")
    community = str(raw_community) if raw_community else None
    credential_version = status.get("credential_version")
    agents = {str(item.get("id")): item for item in status.get("nodes") or []}

    published: List[Dict[str, Any]] = []
    for node in nodes:
        node_id = str(node.get("id") or "")
        if not node_id:
            continue
        node_type = str(node.get("type") or "host")
        agent = agents.get(node_id) or {}
        ip = str(node.get("ip") or agent.get("ip") or "")
        published.append(
            {
                "id": node_id,
                "type": node_type,
                "name": str(node.get("name") or node_id),
                "ip": ip,
                "mac": str(node.get("mac") or ""),
                "collectable": bool(ip),
                "port": port,
                "community": community,
                "sys_object_id": f"{ENTERPRISE_ROOT}.{TYPE_ARCS.get(node_type, TYPE_ARCS['host'])}",
                "agent": agent.get("status") or "unavailable",
            }
        )

    published_links = [
        {"from": str(link.get("from") or ""), "to": str(link.get("to") or "")}
        for link in links
        if link.get("from") and link.get("to")
    ]
    return {
        "community": community,
        "credential_version": credential_version,
        "port": port,
        "enabled": bool(status.get("enabled")),
        "running": bool(status.get("running")),
        "nodes": published,
        "links": published_links,
    }


def node_profile(node: Any, started_at: float) -> Dict[str, Any]:
    """单个节点的档案：`{"node": {...}, "interfaces": [...]}`。"""
    name = str(getattr(node, "name", "") or "")
    return {
        "node": {
            "id": name,
            "name": name,
            "type": node_type(node),
            "started_at": float(started_at),
            "location": _text(node, "location"),
            "contact": _text(node, "contact"),
        },
        "interfaces": _interface_rows(node),
    }


def agent_targets(net: Any, started_at: float) -> List[Dict[str, Any]]:
    """每个有 IPv4 的节点一个 target：`{id, type, ip, pid, profile}`。

    没有 IP 的节点（交换机端口 / 控制器）不采集：它们没有可寻址的接口，
    `snmpwalk <ip>` 本身就无从下手。
    """
    nodes = getattr(net, "nameToNode", None) or {}
    targets: List[Dict[str, Any]] = []
    for node_id in sorted(nodes):
        node = nodes[node_id]
        ip = _first_ipv4(node)
        if not ip:
            continue
        profile = node_profile(node, started_at)
        pid: Optional[int] = getattr(node, "pid", None)
        targets.append(
            {
                "id": str(node_id),
                "type": profile["node"]["type"],
                "ip": ip,
                "pid": int(pid) if pid else None,
                "profile": profile,
            }
        )
    return targets
