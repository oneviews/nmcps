"""台账 → MIB 投影（M2 首增量，`NMCPS-ADR-0028` D5）。

只投影三组标准 OID 加一个企业类型 OID：

- `SNMPv2-MIB` system：`1.3.6.1.2.1.1.{1..7}.0`
- `IF-MIB` ifTable 基础列：`1.3.6.1.2.1.2.2.1.{1..10,16}.<index>`，加 ifName / ifAlias
- `IP-MIB` ipAddrTable：`1.3.6.1.2.1.4.20.1.{1..5}.<a.b.c.d>`
- 企业类型：`sysObjectID = 1.3.6.1.4.1.99999.<type>`

OID 只写数字弧，不随包分发 MIB 文本；值全部来自节点档案（`inventory.py`），
agent 不读页面状态。

**只依赖标准库**：`pnpm check:snmp` 直接导入本模块。
"""

from __future__ import annotations

import bisect
import ipaddress
import time
from typing import Callable, Dict, List, Optional, Tuple

from mininet_gui_backend.snmp.ber import (
    SnmpValue,
    counter32,
    integer,
    ip_address,
    oid_arcs,
    oid_value,
    octet_string,
    timeticks,
)

#: 值提供器：每次读取都现算（sysUpTime 要随时间走，不能在建表时冻结）
Provider = Callable[[], SnmpValue]

OID_SYS_DESCR = "1.3.6.1.2.1.1.1.0"
OID_SYS_OBJECT_ID = "1.3.6.1.2.1.1.2.0"
OID_SYS_UPTIME = "1.3.6.1.2.1.1.3.0"
OID_SYS_CONTACT = "1.3.6.1.2.1.1.4.0"
OID_SYS_NAME = "1.3.6.1.2.1.1.5.0"
OID_SYS_LOCATION = "1.3.6.1.2.1.1.6.0"
OID_SYS_SERVICES = "1.3.6.1.2.1.1.7.0"

OID_IF_TABLE = "1.3.6.1.2.1.2.2.1"
OID_IF_NAME = "1.3.6.1.2.1.31.1.1.1.1"
OID_IF_ALIAS = "1.3.6.1.2.1.31.1.1.1.18"

OID_IP_ADDR_TABLE = "1.3.6.1.2.1.4.20.1"

#: 企业 OID 根（与参考侧同形，便于按 sysObjectID 分类的 NMS 识别）
ENTERPRISE_ROOT = "1.3.6.1.4.1.99999"

#: 统一节点类型 → 企业 OID 尾号（1 switch / 2 ap / 3 router / 5 station / 7 host）
TYPE_ARCS = {
    "switch": 1,
    "ap": 2,
    "router": 3,
    "mesh": 4,
    "station": 5,
    "server": 6,
    "host": 7,
    "satellite": 8,
}

#: sysServices 的位图：转发设备 2（physical），端系统 72（application + end-to-end）
SYSTEM_SERVICES = {
    "switch": 2,
    "ap": 2,
    "router": 2,
    "mesh": 2,
    "satellite": 2,
    "host": 72,
    "station": 72,
    "server": 72,
    "nat": 72,
    "controller": 72,
}

#: IANAifType：ethernetCsmacd(6) / softwareLoopback(24)
IF_TYPE_ETHERNET = 6
IF_TYPE_LOOPBACK = 24


def normalize_oid(oid: str) -> str:
    return oid.strip().lstrip(".")


class Mib:
    """按 OID 字典序排列的只读 OID 表；GETNEXT 用二分找「严格大于」的下一项。"""

    def __init__(self, entries: Dict[str, Provider]) -> None:
        self._entries: Dict[str, Provider] = {}
        self._order: List[Tuple[Tuple[int, ...], str]] = []
        for oid, provider in entries.items():
            key = normalize_oid(oid)
            self._entries[key] = provider
            self._order.append((oid_arcs(key), key))
        self._order.sort()
        self._arcs = [arcs for arcs, _ in self._order]

    def __len__(self) -> int:
        return len(self._entries)

    def get(self, oid: str) -> Optional[SnmpValue]:
        provider = self._entries.get(normalize_oid(oid))
        return None if provider is None else provider()

    def getnext(self, oid: str) -> Optional[Tuple[str, SnmpValue]]:
        query = oid_arcs(normalize_oid(oid))
        index = bisect.bisect_right(self._arcs, query)
        if index >= len(self._order):
            return None
        next_oid = self._order[index][1]
        return next_oid, self._entries[next_oid]()

    def oids(self) -> List[str]:
        return [oid for _, oid in self._order]


def _const(value: SnmpValue) -> Provider:
    return lambda: value


def _mac_bytes(mac: str) -> bytes:
    """`aa:bb:cc:dd:ee:ff` / `aa-bb-…` → 6 字节；无 MAC（交换机端口）回空串。"""
    text = (mac or "").strip().replace("-", ":")
    if not text:
        return b""
    parts = text.split(":")
    try:
        return bytes(int(part, 16) for part in parts)
    except ValueError:
        return b""


def _prefix_mask(prefix_len: int) -> str:
    try:
        network = ipaddress.IPv4Network(f"0.0.0.0/{int(prefix_len)}", strict=False)
    except (ValueError, TypeError):
        return "0.0.0.0"
    return str(network.netmask)


def _ip_arcs(ip: str) -> Optional[Tuple[int, ...]]:
    try:
        address = ipaddress.IPv4Address(ip)
    except (ipaddress.AddressValueError, ValueError):
        return None
    if address.is_loopback:
        return None
    return tuple(int(part) for part in str(address).split("."))



def build_mib(profile: Dict) -> Mib:
    """节点档案 → OID 表。档案形状见 `inventory.py` 的 `node_profile()`。"""
    node = profile.get("node") or {}
    node_id = str(node.get("id") or node.get("name") or "node")
    node_type = str(node.get("type") or "host")
    started_at = float(node.get("started_at") or time.time())
    location = str(node.get("location") or "")
    contact = str(node.get("contact") or "NMCPS")

    def uptime() -> SnmpValue:
        centiseconds = int(max(0, time.time() - started_at) * 100) & 0xFFFFFFFF
        return timeticks(centiseconds)

    entries: Dict[str, Provider] = {
        OID_SYS_DESCR: _const(octet_string(f"Mininet {node_type} {node_id} (NMCPS simulated node)")),
        OID_SYS_OBJECT_ID: _const(oid_value(f"{ENTERPRISE_ROOT}.{TYPE_ARCS.get(node_type, TYPE_ARCS['host'])}")),
        OID_SYS_UPTIME: uptime,
        OID_SYS_CONTACT: _const(octet_string(contact)),
        OID_SYS_NAME: _const(octet_string(node_id)),
        OID_SYS_LOCATION: _const(octet_string(location)),
        OID_SYS_SERVICES: _const(integer(SYSTEM_SERVICES.get(node_type, 72))),
    }

    for index, intf in enumerate(profile.get("interfaces") or [], start=1):
        name = str(intf.get("name") or f"eth{index - 1}")
        if_type = IF_TYPE_LOOPBACK if name == "lo" else IF_TYPE_ETHERNET
        mtu = int(intf.get("mtu") or 1500)
        speed = int(intf.get("speed") or 1_000_000_000)
        mac = _mac_bytes(str(intf.get("mac") or ""))

        entries[f"{OID_IF_TABLE}.1.{index}"] = _const(integer(index))
        entries[f"{OID_IF_TABLE}.2.{index}"] = _const(octet_string(name))
        entries[f"{OID_IF_TABLE}.3.{index}"] = _const(integer(if_type))
        entries[f"{OID_IF_TABLE}.4.{index}"] = _const(integer(mtu))
        entries[f"{OID_IF_TABLE}.5.{index}"] = _const(integer(speed))
        entries[f"{OID_IF_TABLE}.6.{index}"] = _const((0x04, mac))
        entries[f"{OID_IF_TABLE}.7.{index}"] = _const(integer(1))
        entries[f"{OID_IF_TABLE}.8.{index}"] = _const(integer(1))
        entries[f"{OID_IF_TABLE}.9.{index}"] = _const(timeticks(0))
        entries[f"{OID_IF_TABLE}.10.{index}"] = _const(counter32(0))
        entries[f"{OID_IF_TABLE}.16.{index}"] = _const(counter32(0))
        entries[f"{OID_IF_NAME}.{index}"] = _const(octet_string(name))
        entries[f"{OID_IF_ALIAS}.{index}"] = _const(octet_string(str(intf.get("alias") or "")))

        ip = str(intf.get("ip") or "")
        arcs = _ip_arcs(ip)
        if arcs is None:
            continue
        suffix = ".".join(str(arc) for arc in arcs)
        entries[f"{OID_IP_ADDR_TABLE}.1.{suffix}"] = _const(ip_address(ip))
        entries[f"{OID_IP_ADDR_TABLE}.2.{suffix}"] = _const(integer(index))
        entries[f"{OID_IP_ADDR_TABLE}.3.{suffix}"] = _const(ip_address(_prefix_mask(intf.get("prefix_len") or 24)))
        entries[f"{OID_IP_ADDR_TABLE}.4.{suffix}"] = _const(integer(1))
        entries[f"{OID_IP_ADDR_TABLE}.5.{suffix}"] = _const(integer(65535))

    return Mib(entries)
