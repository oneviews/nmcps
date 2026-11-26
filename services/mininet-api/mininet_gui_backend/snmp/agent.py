"""UDP 上的最小只读 SNMP agent（`NMCPS-ADR-0028` D1–D3）。

分工：`ber.py` 管字节，`mib.py` 管 OID 表，本模块只做「收包 → 校验 → 回包」。
`respond()` 是纯函数（同一请求 + 同一 MIB 给同一答案），`serve()` 才碰 socket，
于是 `pnpm check:snmp` 不需要 root、不需要 mininet，也能测完整个协议面。
"""

from __future__ import annotations

import logging
import socket
import threading
from typing import Optional

from mininet_gui_backend.snmp.ber import (
    TAG_END_OF_MIB_VIEW,
    TAG_GET_NEXT_REQUEST,
    TAG_GET_REQUEST,
    TAG_NO_SUCH_OBJECT,
    BerError,
    SnmpRequest,
    build_response,
    parse_request,
)
from mininet_gui_backend.snmp.mib import Mib

LOG = logging.getLogger("mininet_gui_backend.snmp")

#: SNMPv2c 的 version 字段（v1 是 0）
SNMP_VERSION_2C = 1

#: 单包上限：UDP 最大载荷，超出的包在 recvfrom 里就会被截断
MAX_DATAGRAM = 65535


def respond(mib: Mib, request: SnmpRequest) -> Optional[bytes]:
    """按 GET / GETNEXT 语义回包；其它 PDU 返回 None（由调用方丢包）。"""
    if request.pdu_tag == TAG_GET_REQUEST:
        varbinds = []
        for oid in request.oids:
            value = mib.get(oid)
            varbinds.append((oid, value if value is not None else (TAG_NO_SUCH_OBJECT, b"")))
    elif request.pdu_tag == TAG_GET_NEXT_REQUEST:
        varbinds = []
        for oid in request.oids:
            nxt = mib.getnext(oid)
            varbinds.append(nxt if nxt is not None else (oid, (TAG_END_OF_MIB_VIEW, b"")))
    else:
        return None
    return build_response(request.version, request.community, request.request_id, varbinds)


def handle_datagram(mib: Mib, data: bytes, community: str) -> Optional[bytes]:
    """解析 + 校验社区串 / 版本；任何不合法的输入都静默丢弃（不回错误响应）。"""
    try:
        request = parse_request(data)
    except BerError:
        return None
    if request.version != SNMP_VERSION_2C:
        return None
    if community and request.community != community:
        return None
    return respond(mib, request)


def serve(
    mib: Mib,
    *,
    port: int,
    community: str,
    host: str = "0.0.0.0",
    stop_event: Optional[threading.Event] = None,
) -> None:
    """阻塞式服务循环；`stop_event` 置位后 0.5 秒内退出。

    在节点自己的 netns 里由 `nsenter` 拉起（见 `runtime.py`），所以这里绑
    `0.0.0.0` 就是该节点的全部地址，不会碰宿主端口表。
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.settimeout(0.5)
    try:
        sock.bind((host, port))
        LOG.info("snmp agent listening on %s:%s (%d oids)", host, port, len(mib))
        while stop_event is None or not stop_event.is_set():
            try:
                data, peer = sock.recvfrom(MAX_DATAGRAM)
            except socket.timeout:
                continue
            except OSError:
                break
            reply = handle_datagram(mib, data, community)
            if reply is None:
                continue
            try:
                sock.sendto(reply, peer)
            except OSError as exc:  # pragma: no cover - 对端已关闭
                LOG.debug("snmp reply failed: %s", exc)
    finally:
        sock.close()


def _main(argv: Optional[list[str]] = None) -> int:
    """进程入口：`python -m mininet_gui_backend.snmp.agent --profile <json>`。

    由 `runtime.py` 通过 `nsenter -t <pid> -n --` 拉起，stdout / stderr 都进
    `.data/snmp/<node>.log`，所以这里只关心退出码。
    """
    import argparse
    import json
    import signal
    from pathlib import Path

    from mininet_gui_backend.snmp.mib import build_mib

    parser = argparse.ArgumentParser(description="Minimal read-only SNMPv2c agent for one Mininet node")
    parser.add_argument("--profile", required=True, help="node profile JSON written by snmp.runtime")
    parser.add_argument("--port", type=int, default=161, help="UDP port to bind inside the node netns")
    parser.add_argument("--community", default="public", help="v2c community; mismatches are dropped")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    profile = json.loads(Path(args.profile).read_text("utf-8"))
    stop_event = threading.Event()

    def _handle(signum: int, _frame: object) -> None:
        LOG.info("snmp agent received signal %s, stopping", signum)
        stop_event.set()

    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)

    serve(
        build_mib(profile),
        port=args.port,
        community=args.community,
        stop_event=stop_event,
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - 进程入口
    raise SystemExit(_main())

