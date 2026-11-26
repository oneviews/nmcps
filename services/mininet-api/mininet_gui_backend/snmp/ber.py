"""最小 BER 编解码（SNMPv2c，只服务 GET / GETNEXT）。

为什么自己写：M2 首增量不依赖 net-snmp，也不随包分发 MIB 文本（`NMCPS-ADR-0028`
D1）。这里只实现采集端真正会走到的子集：外层 SEQUENCE、版本 / community、
GET / GETNEXT PDU 与 varbind 列表；SET / v3 / trap 一律不解析。

**只依赖标准库**：`pnpm check:snmp` 在没有 fastapi / mininet / net-snmp 的机器上
导入本模块跑编解码用例。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Sequence, Tuple

#: 通用 ASN.1 / SNMP 标签
TAG_INTEGER = 0x02
TAG_OCTET_STRING = 0x04
TAG_NULL = 0x05
TAG_OID = 0x06
TAG_SEQUENCE = 0x30

TAG_IP_ADDRESS = 0x40
TAG_COUNTER32 = 0x41
TAG_GAUGE32 = 0x42
TAG_TIMETICKS = 0x43

TAG_GET_REQUEST = 0xA0
TAG_GET_NEXT_REQUEST = 0xA1
TAG_GET_RESPONSE = 0xA2

#: SNMPv2 的异常值标签（RFC 3416）：GET 缺对象 / GETNEXT 越过末项
TAG_NO_SUCH_OBJECT = 0x80
TAG_NO_SUCH_INSTANCE = 0x81
TAG_END_OF_MIB_VIEW = 0x82

#: `SnmpValue` = (标签, 已编码的 payload)；agent 只负责转发
SnmpValue = Tuple[int, bytes]


class BerError(ValueError):
    """报文不合法：agent 侧一律**静默丢包**，不回错误响应。"""


def encode_length(length: int) -> bytes:
    if length < 0:
        raise BerError("negative length")
    if length < 0x80:
        return bytes([length])
    payload = length.to_bytes((length.bit_length() + 7) // 8, "big")
    if len(payload) > 4:
        raise BerError("length too large")
    return bytes([0x80 | len(payload)]) + payload


def encode_tlv(tag: int, payload: bytes) -> bytes:
    return bytes([tag]) + encode_length(len(payload)) + payload


def decode_tlv(data: bytes, offset: int = 0) -> Tuple[int, bytes, int]:
    """读取一个 TLV，返回 `(tag, payload, next_offset)`；只接受短形式长度。"""
    if offset >= len(data):
        raise BerError("truncated tag")
    tag = data[offset]
    offset += 1
    if offset >= len(data):
        raise BerError("truncated length")
    first = data[offset]
    offset += 1
    if first & 0x80:
        count = first & 0x7F
        if count == 0 or count > 4 or offset + count > len(data):
            raise BerError("unsupported length form")
        length = int.from_bytes(data[offset:offset + count], "big")
        offset += count
    else:
        length = first
    end = offset + length
    if end > len(data):
        raise BerError("truncated payload")
    return tag, data[offset:end], end


def encode_integer(value: int) -> bytes:
    """有符号整数的 BER 内容字节（最短表示）。"""
    if value == 0:
        return b"\x00"
    length = (value.bit_length() + 8) // 8
    return value.to_bytes(length, "big", signed=True)


def decode_integer(payload: bytes) -> int:
    if not payload:
        raise BerError("empty integer")
    return int.from_bytes(payload, "big", signed=True)


def encode_uint32(value: int) -> bytes:
    """TimeTicks / Counter32 / Gauge32 的无符号内容（0..2^32-1）。"""
    if value < 0 or value > 0xFFFFFFFF:
        raise BerError(f"unsigned 32-bit value out of range: {value}")
    return value.to_bytes(4, "big")


def encode_subid(value: int) -> bytes:
    if value < 0 or value > 0xFFFFFFFF:
        raise BerError(f"sub-identifier out of range: {value}")
    parts = [value & 0x7F]
    value >>= 7
    while value:
        parts.append(0x80 | (value & 0x7F))
        value >>= 7
    return bytes(reversed(parts))


def oid_arcs(oid: str) -> Tuple[int, ...]:
    text = oid.strip().lstrip(".")
    if not text:
        raise BerError("empty oid")
    try:
        return tuple(int(part) for part in text.split("."))
    except ValueError as exc:  # pragma: no cover - 防御式
        raise BerError(f"invalid oid: {oid}") from exc


def encode_oid(oid: str) -> bytes:
    """点分 OID → BER 内容字节；首两个弧合并编码（X*40+Y）。"""
    arcs = oid_arcs(oid)
    if len(arcs) < 2:
        raise BerError(f"oid needs at least two arcs: {oid}")
    head = arcs[0] * 40 + arcs[1]
    return encode_subid(head) + b"".join(encode_subid(arc) for arc in arcs[2:])


def decode_oid(payload: bytes) -> str:
    subids: List[int] = []
    value = 0
    for byte in payload:
        value = (value << 7) | (byte & 0x7F)
        if byte & 0x80:
            continue
        subids.append(value)
        value = 0
    if payload and payload[-1] & 0x80:
        raise BerError("truncated oid")
    if not subids:
        raise BerError("empty oid")
    head = subids[0]
    if head < 40:
        arcs = [0, head]
    elif head < 80:
        arcs = [1, head - 40]
    else:
        arcs = [2, head - 80]
    arcs.extend(subids[1:])
    return ".".join(str(arc) for arc in arcs)



#: 值构造器：agent / mib 都按标签 + payload 传递，不做类型分支
def octet_string(text: str) -> SnmpValue:
    return TAG_OCTET_STRING, text.encode("utf-8")


def integer(value: int) -> SnmpValue:
    return TAG_INTEGER, encode_integer(value)


def oid_value(oid: str) -> SnmpValue:
    return TAG_OID, encode_oid(oid)


def timeticks(value: int) -> SnmpValue:
    return TAG_TIMETICKS, encode_uint32(value)


def counter32(value: int) -> SnmpValue:
    return TAG_COUNTER32, encode_uint32(value)


def ip_address(text: str) -> SnmpValue:
    parts = text.strip().split(".")
    if len(parts) != 4:
        raise BerError(f"invalid ipv4 address: {text}")
    try:
        return TAG_IP_ADDRESS, bytes(int(part) for part in parts)
    except ValueError as exc:
        raise BerError(f"invalid ipv4 address: {text}") from exc


@dataclass(frozen=True)
class SnmpRequest:
    version: int
    community: str
    pdu_tag: int
    request_id: int
    oids: Tuple[str, ...]


def parse_request(data: bytes) -> SnmpRequest:
    """解析 GET / GETNEXT 请求；其它 PDU（SET / RESPONSE / TRAP）一律拒绝。"""
    tag, message, _ = decode_tlv(data, 0)
    if tag != TAG_SEQUENCE:
        raise BerError("message is not a sequence")

    offset = 0
    tag, version_payload, offset = decode_tlv(message, offset)
    if tag != TAG_INTEGER:
        raise BerError("version is not an integer")
    version = decode_integer(version_payload)

    tag, community_payload, offset = decode_tlv(message, offset)
    if tag != TAG_OCTET_STRING:
        raise BerError("community is not an octet string")
    community = community_payload.decode("utf-8", "replace")

    tag, pdu, offset = decode_tlv(message, offset)
    if tag not in (TAG_GET_REQUEST, TAG_GET_NEXT_REQUEST):
        raise BerError(f"unsupported pdu tag: 0x{tag:02x}")
    pdu_tag = tag

    pdu_offset = 0
    tag, request_id_payload, pdu_offset = decode_tlv(pdu, pdu_offset)
    if tag != TAG_INTEGER:
        raise BerError("request-id is not an integer")
    request_id = decode_integer(request_id_payload)

    for _ in ("error-status", "error-index"):
        tag, _, pdu_offset = decode_tlv(pdu, pdu_offset)
        if tag != TAG_INTEGER:
            raise BerError("pdu error fields are not integers")

    tag, varbinds, pdu_offset = decode_tlv(pdu, pdu_offset)
    if tag != TAG_SEQUENCE:
        raise BerError("varbind list is not a sequence")

    oids: List[str] = []
    vb_offset = 0
    while vb_offset < len(varbinds):
        tag, varbind, vb_offset = decode_tlv(varbinds, vb_offset)
        if tag != TAG_SEQUENCE:
            raise BerError("varbind is not a sequence")
        tag, oid_payload, _ = decode_tlv(varbind, 0)
        if tag != TAG_OID:
            raise BerError("varbind name is not an oid")
        oids.append(decode_oid(oid_payload))

    return SnmpRequest(version, community, pdu_tag, request_id, tuple(oids))


def build_response(
    version: int,
    community: str,
    request_id: int,
    varbinds: Sequence[Tuple[str, SnmpValue]],
) -> bytes:
    """按请求回 GET-RESPONSE；error-status / error-index 恒 0（异常走异常值标签）。"""
    encoded = b""
    for oid, (value_tag, payload) in varbinds:
        encoded += encode_tlv(
            TAG_SEQUENCE,
            encode_tlv(TAG_OID, encode_oid(oid)) + encode_tlv(value_tag, payload),
        )

    pdu = encode_tlv(
        TAG_GET_RESPONSE,
        encode_tlv(TAG_INTEGER, encode_integer(request_id))
        + encode_tlv(TAG_INTEGER, b"\x00")
        + encode_tlv(TAG_INTEGER, b"\x00")
        + encode_tlv(TAG_SEQUENCE, encoded),
    )
    return encode_tlv(
        TAG_SEQUENCE,
        encode_tlv(TAG_INTEGER, encode_integer(version))
        + encode_tlv(TAG_OCTET_STRING, community.encode("utf-8"))
        + pdu,
    )


def build_request(
    oid: str,
    community: str = "public",
    request_id: int = 1,
    *,
    get_next: bool = False,
    version: int = 1,
) -> bytes:
    """构造 GET / GETNEXT 请求：自检与真机排查共用（不依赖 net-snmp 客户端）。"""
    varbind = encode_tlv(TAG_SEQUENCE, encode_tlv(TAG_OID, encode_oid(oid)) + encode_tlv(TAG_NULL, b""))
    pdu = encode_tlv(
        TAG_GET_NEXT_REQUEST if get_next else TAG_GET_REQUEST,
        encode_tlv(TAG_INTEGER, encode_integer(request_id))
        + encode_tlv(TAG_INTEGER, b"\x00")
        + encode_tlv(TAG_INTEGER, b"\x00")
        + encode_tlv(TAG_SEQUENCE, varbind),
    )
    return encode_tlv(
        TAG_SEQUENCE,
        encode_tlv(TAG_INTEGER, encode_integer(version))
        + encode_tlv(TAG_OCTET_STRING, community.encode("utf-8"))
        + pdu,
    )
