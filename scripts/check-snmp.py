#!/usr/bin/env python3
"""SNMP 采集面自检（`NMCPS-ADR-0028`，M2 首增量）。

只依赖标准库：不需要 root、不需要 mininet、不需要 net-snmp。覆盖六块 ——
BER / PDU 往返、MIB 投影与 GETNEXT 单调、节点档案抽取、回环 UDP 端到端
（含错社区无响应）、真子进程入口（`-m … snmp.agent` 的参数解析 + SIGTERM + 端口释放）、
单份 v2c 凭据的盘上事实与 `apply_credentials()` 重启面（`NMCPS-ADR-0028` §6）。
真机 `snmpwalk` 验收不在本脚本里，见 ADR §5。
"""

from __future__ import annotations

import inspect
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "mininet-api"))

from mininet_gui_backend.snmp import agent, ber, credentials, inventory  # noqa: E402
from mininet_gui_backend.snmp import mib as snmp_mib  # noqa: E402
from mininet_gui_backend.snmp import runtime as snmp_runtime  # noqa: E402

results: list[tuple[str, bool]] = []


def log(label: str, ok: bool, detail: str = "") -> None:
    results.append((label, bool(ok)))
    print(f"{'✅' if ok else '❌'} {label}{f' — {detail}' if detail else ''}")


class StubIntf:
    """够 `inventory._interface_rows()` 用的接口桩（无 mininet 依赖）。"""

    def __init__(self, name: str, ip: str, mac: str = "aa:bb:cc:dd:ee:ff", prefix_len: int = 24, mtu: int = 1500):
        self.name = name
        self.ip = ip
        self.mac = mac
        self.prefixLen = prefix_len
        self.MTU = mtu


class StubNode:
    """节点桩：`IP()` / `MAC()` 按方法给（与 Mininet 同形），也支持字符串属性。"""

    type = "host"

    def __init__(self, name: str, ip: str, pid: int | None = None, mac: str = "aa:bb:cc:dd:ee:ff"):
        self.name = name
        self.pid = pid
        self._ip = ip
        self._mac = mac
        self._intfs = [StubIntf(f"{name}-eth0", ip, mac)] if ip else []

    def intfList(self):
        return list(self._intfs)

    def IP(self):
        return self._ip

    def MAC(self):
        return self._mac


def decode_response(data: bytes):
    """解码 GET-RESPONSE：`(version, community, request_id, varbinds)`。"""
    tag, message, _ = ber.decode_tlv(data, 0)
    assert tag == ber.TAG_SEQUENCE
    offset = 0
    tag, version, offset = ber.decode_tlv(message, offset)
    tag, community, offset = ber.decode_tlv(message, offset)
    tag, pdu, offset = ber.decode_tlv(message, offset)
    assert tag == ber.TAG_GET_RESPONSE, f"unexpected pdu tag 0x{tag:02x}"
    pdu_offset = 0
    tag, request_id, pdu_offset = ber.decode_tlv(pdu, pdu_offset)
    for _ in range(2):
        tag, _, pdu_offset = ber.decode_tlv(pdu, pdu_offset)
    tag, varbinds, pdu_offset = ber.decode_tlv(pdu, pdu_offset)

    rows = []
    vb_offset = 0
    while vb_offset < len(varbinds):
        tag, varbind, vb_offset = ber.decode_tlv(varbinds, vb_offset)
        inner = 0
        tag, name, inner = ber.decode_tlv(varbind, inner)
        value_tag, payload, inner = ber.decode_tlv(varbind, inner)
        rows.append((ber.decode_oid(name), value_tag, payload))
    return (
        ber.decode_integer(version),
        community.decode("utf-8"),
        ber.decode_integer(request_id),
        rows,
    )


def check_ber() -> None:
    oids = [
        "1.3.6.1.2.1.1.1.0",
        "1.3.6.1.2.1.31.1.1.1.18.2",
        "1.3.6.1.4.1.99999.7",
        "1.3.6.1.2.1.4.20.1.1.10.0.0.1",
    ]
    round_tripped = [ber.decode_oid(ber.encode_oid(oid)) for oid in oids]
    log("OID 编解码往返（含多字节弧 / 首弧合并）", round_tripped == oids, ", ".join(round_tripped))

    payload = bytes(range(256)) * 2
    tag, decoded, end = ber.decode_tlv((ber.encode_tlv(ber.TAG_OCTET_STRING, payload)), 0)
    log("长形式长度（>127 字节）往返", tag == ber.TAG_OCTET_STRING and decoded == payload and end == 516, f"end={end}")

    integers = [-2147483648, -129, -1, 0, 1, 127, 128, 255, 65535, 2147483647]
    ints_ok = all(ber.decode_integer(ber.encode_integer(value)) == value for value in integers)
    log("Integer 有符号最短编码往返", ints_ok, f"{len(integers)} 个值")

    for oid, get_next in (("1.3.6.1.2.1.1.1.0", False), ("1.3.6.1.2.1.1", True)):
        request = ber.parse_request(ber.build_request(oid, community="s3cret", request_id=42, get_next=get_next))
        expected_tag = ber.TAG_GET_NEXT_REQUEST if get_next else ber.TAG_GET_REQUEST
        ok = (
            request.version == 1
            and request.community == "s3cret"
            and request.request_id == 42
            and request.pdu_tag == expected_tag
            and request.oids == (oid,)
        )
        log(f"{'GETNEXT' if get_next else 'GET'} 请求构造 / 解析往返", ok, f"oid={oid}")

    try:
        ber.parse_request(ber.encode_tlv(ber.TAG_SEQUENCE, ber.encode_tlv(ber.TAG_INTEGER, b"\x00")))
    except ber.BerError:
        log("截断报文抛 BerError（agent 侧据此静默丢包）", True)
    else:
        log("截断报文抛 BerError（agent 侧据此静默丢包）", False, "未抛异常")


def check_mib() -> "snmp_mib.Mib":
    started_at = time.time() - 30
    host = StubNode("h1", "10.0.0.1", pid=4242)
    profile = inventory.node_profile(host, started_at)
    table = snmp_mib.build_mib(profile)

    node = profile.get("node") or {}
    interfaces = profile.get("interfaces") or []
    log(
        "节点档案含 id / type / started_at 与接口 IP / MAC / 前缀",
        node.get("id") == "h1" and node.get("type") == "host" and interfaces and interfaces[0].get("ip") == "10.0.0.1",
        f"{node.get('id')} {interfaces[:1]}",
    )

    sys_name = table.get(snmp_mib.OID_SYS_NAME)
    object_id = table.get(snmp_mib.OID_SYS_OBJECT_ID)
    log(
        "system 组：sysName == 台账 id、sysObjectID 指向企业类型弧",
        sys_name == (ber.TAG_OCTET_STRING, b"h1")
        and object_id is not None
        and ber.decode_oid(object_id[1]) == f"{snmp_mib.ENTERPRISE_ROOT}.{snmp_mib.TYPE_ARCS['host']}",
        f"sysObjectID={ber.decode_oid(object_id[1]) if object_id else '缺失'}",
    )

    if_descr = table.get(f"{snmp_mib.OID_IF_TABLE}.2.1")
    if_name = table.get(f"{snmp_mib.OID_IF_NAME}.1")
    ip_entry = table.get(f"{snmp_mib.OID_IP_ADDR_TABLE}.1.10.0.0.1")
    log(
        "ifTable / ifXTable / ipAddrTable 投影到真接口",
        if_descr == (ber.TAG_OCTET_STRING, b"h1-eth0")
        and if_name == (ber.TAG_OCTET_STRING, b"h1-eth0")
        and ip_entry == (ber.TAG_IP_ADDRESS, b"\x0a\x00\x00\x01"),
        f"ifDescr={if_descr} ipAdEntAddr={ip_entry}",
    )

    log("缺对象 get() 回 None（agent 侧转 noSuchObject）", table.get("1.3.6.1.2.1.1.99.0") is None)

    walked: list[str] = []
    cursor = "1.3.6.1"
    while True:
        step = table.getnext(cursor)
        if step is None:
            break
        walked.append(step[0])
        cursor = step[0]
    arcs = [ber.oid_arcs(oid) for oid in walked]
    log(
        "GETNEXT 单调覆盖全部 OID 且越过末项结束",
        len(walked) == len(table) == len(set(walked)) and arcs == sorted(arcs) and table.getnext(walked[-1]) is None,
        f"{len(walked)} 个 OID",
    )
    return table


def check_respond(table: "snmp_mib.Mib") -> None:
    request = ber.parse_request(ber.build_request("1.3.6.1.2.1.1.99.0"))
    reply = agent.respond(table, request)
    _, _, request_id, rows = decode_response(reply)
    log(
        "GET 缺对象回 noSuchObject（error-status 仍为 0）",
        request_id == 1 and rows and rows[0][0] == "1.3.6.1.2.1.1.99.0" and rows[0][1] == ber.TAG_NO_SUCH_OBJECT,
        f"{rows}",
    )

    last = table.oids()[-1]
    reply = agent.respond(table, ber.parse_request(ber.build_request(last, get_next=True, request_id=7)))
    _, _, request_id, rows = decode_response(reply)
    log(
        "GETNEXT 越过末项回 endOfMibView",
        request_id == 7 and rows and rows[0][1] == ber.TAG_END_OF_MIB_VIEW,
        f"{rows}",
    )

    reply = agent.respond(table, ber.parse_request(ber.build_request(snmp_mib.OID_SYS_DESCR, request_id=9)))
    version, community, _, rows = decode_response(reply)
    log(
        "GET-RESPONSE 回带原 version / community / request-id",
        version == 1 and community == "public" and rows and rows[0][1] == ber.TAG_OCTET_STRING,
        f"version={version} community={community}",
    )

    log(
        "错版本 / 非 GET 报文不产生响应",
        agent.handle_datagram(table, ber.build_request(snmp_mib.OID_SYS_DESCR, version=0), "public") is None
        and agent.handle_datagram(table, b"\x30\x00", "public") is None,
    )


def check_inventory() -> None:
    switch = StubNode("s1", "", pid=1111)
    idle = StubNode("h2", "10.0.0.2", pid=None)
    net = SimpleNamespace(nameToNode={"h1": StubNode("h1", "10.0.0.1", pid=4242), "s1": switch, "h2": idle})
    targets = {item["id"]: item for item in inventory.agent_targets(net, time.time())}
    log(
        "无 IP 的节点（交换机）被跳过，有 IP 的进采集清单",
        set(targets) == {"h1", "h2"},
        f"targets={sorted(targets)}",
    )
    log(
        "有 IP 但没 pid 的节点保留在清单里，由 runtime 记为 unavailable",
        targets["h2"].get("pid") is None and targets["h2"].get("ip") == "10.0.0.2",
        f"pid={targets['h2'].get('pid')}",
    )

    status = {
        "enabled": True,
        "running": True,
        "port": 161,
        "community": "public",
        "nodes": [{"id": "h1", "status": "running", "ip": "10.0.0.1"}],
    }
    topology = inventory.build_topology(
        [
            {"id": "h1", "type": "host", "name": "h1", "ip": "10.0.0.1", "mac": "aa:bb:cc:dd:ee:ff"},
            {"id": "s1", "type": "switch", "name": "s1", "ip": "", "mac": ""},
        ],
        [{"from": "h1", "to": "s1"}],
        status,
    )
    hosts = {item["id"]: item for item in topology["nodes"]}
    log(
        "台账投影：可采集位按 IP 判、邻接来自台账链路",
        hosts["h1"]["collectable"] is True
        and hosts["s1"]["collectable"] is False
        and hosts["h1"]["agent"] == "running"
        and hosts["s1"]["agent"] == "unavailable"
        and topology["links"] == [{"from": "h1", "to": "s1"}],
        f"nodes={len(hosts)} links={len(topology['links'])}",
    )



def check_loopback(table: "snmp_mib.Mib") -> None:
    """回环 UDP 端到端：`serve()` + `build_request()`，含错社区无响应。"""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    probe.bind(("127.0.0.1", 0))
    free_port = probe.getsockname()[1]
    probe.close()

    stop_event = threading.Event()
    thread = threading.Thread(
        target=agent.serve,
        kwargs={
            "mib": table,
            "port": free_port,
            "community": "public",
            "host": "127.0.0.1",
            "stop_event": stop_event,
        },
        daemon=True,
    )
    thread.start()
    time.sleep(0.2)

    client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    client.settimeout(1.5)
    try:
        client.sendto(ber.build_request(snmp_mib.OID_SYS_DESCR, request_id=99), ("127.0.0.1", free_port))
        data, _ = client.recvfrom(65535)
        _, _, request_id, rows = decode_response(data)
        log(
            "回环 UDP：GET system.sysDescr 读回节点档案",
            request_id == 99 and rows and rows[0][1] == ber.TAG_OCTET_STRING and b"Mininet host h1" in rows[0][2],
            f"{rows[:1]}",
        )

        client.sendto(ber.build_request(snmp_mib.OID_SYS_DESCR, community="private"), ("127.0.0.1", free_port))
        try:
            client.recvfrom(65535)
        except socket.timeout:
            log("回环 UDP：错社区被静默丢弃（不回错误响应）", True)
        else:
            log("回环 UDP：错社区被静默丢弃（不回错误响应）", False, "收到了响应")
    finally:
        client.close()
        stop_event.set()
        thread.join(3.0)


def _free_udp_port() -> int:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]
    finally:
        probe.close()


def _ask(port: int, oid: str, *, community: str, timeout: float = 0.6):
    """发一次 GET；超时返回 None（错社区与「端口上没人听」表现相同）。"""
    client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    client.settimeout(timeout)
    try:
        client.sendto(
            ber.build_request(oid, community=community, request_id=7),
            ("127.0.0.1", port),
        )
        data, _ = client.recvfrom(65535)
        return decode_response(data)
    except socket.timeout:
        return None
    finally:
        client.close()


def _wait_for_agent(port: int, oid: str, *, community: str, seconds: float = 5.0):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        reply = _ask(port, oid, community=community, timeout=0.3)
        if reply is not None:
            return reply
        time.sleep(0.1)
    return None


def _stop_process(proc: "subprocess.Popen[bytes] | None") -> "int | None":
    if proc is None:
        return None
    try:
        if proc.poll() is None:
            proc.terminate()
        return proc.wait(timeout=5.0)
    except subprocess.TimeoutExpired:
        proc.kill()
        return proc.wait(timeout=5.0)


def check_agent_process() -> None:
    """真进程入口：`python -m … .snmp.agent --profile … --port … --community …`。

    `check_loopback()` 只证明 `serve()` 能服务；这里证明**入口**也对：档案从
    `--profile` 读、端口听 `--port`、社区听 `--community`，SIGTERM 优雅退出并释放端口。
    这不是真机验收（没有 netns / 没有 net-snmp），是 `runtime.py` 那条命令行的自检。
    """
    started_at = time.time() - 5
    profile = inventory.node_profile(StubNode("h1", "10.0.0.1", pid=4242), started_at)
    proc: "subprocess.Popen[bytes] | None" = None
    reply = None
    port = 0
    attempts = 0

    with tempfile.TemporaryDirectory(prefix="nmcps-snmp-") as tmp:
        tmp_dir = Path(tmp)
        profile_path = tmp_dir / "h1.json"
        profile_path.write_text(json.dumps(profile, ensure_ascii=False), encoding="utf-8")
        log_path = tmp_dir / "agent.log"

        env = dict(os.environ)
        env["PYTHONPATH"] = os.pathsep.join(
            [str(snmp_runtime.SERVICE_ROOT), env.get("PYTHONPATH", "")]
        ).strip(os.pathsep)
        env["PYTHONUNBUFFERED"] = "1"

        # 端口是「先探空闲再交给子进程」，抢到的概率极低；真被抢就换一个重试。
        while reply is None and attempts < 3:
            attempts += 1
            port = _free_udp_port()
            with open(log_path, "wb") as log_file:
                proc = subprocess.Popen(  # noqa: S603 - 参数全是本脚本生成的字面量
                    [
                        sys.executable,
                        "-m",
                        "mininet_gui_backend.snmp.agent",
                        "--profile",
                        str(profile_path),
                        "--port",
                        str(port),
                        "--community",
                        "s3cret",
                    ],
                    cwd=str(snmp_runtime.SERVICE_ROOT),
                    env=env,
                    stdin=subprocess.DEVNULL,
                    stdout=log_file,
                    stderr=subprocess.STDOUT,
                )
            reply = _wait_for_agent(port, snmp_mib.OID_SYS_NAME, community="s3cret")
            # 探「默认社区」与第一次探测无关：只要子进程还活着就都发一遍。放在重试
            # 循环里而不是循环之后，是为了让「--community 不生效」的失败理由落在
            # 自己那条上（public=应答 / s3cret=无响应），而不是只在上面那条里显示「无响应」。
            alive = proc.poll() is None
            wrong = _ask(port, snmp_mib.OID_SYS_NAME, community="public", timeout=0.8) if alive else None
            right = _ask(port, snmp_mib.OID_SYS_NAME, community="s3cret", timeout=0.8) if alive else None
            if reply is not None or attempts >= 3:
                break
            _stop_process(proc)
            proc = None

        code = _stop_process(proc)
        log_text = log_path.read_text("utf-8", errors="replace") if log_path.exists() else ""

        released = False
        release_detail = "端口未释放"
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                probe.bind(("127.0.0.1", port))
                released = True
                release_detail = f"port={port} 可重新绑定"
            finally:
                probe.close()
        except OSError as exc:
            release_detail = f"port={port} 仍被占用：{exc}"

        sys_name = reply[3][0][2] if reply and reply[3] else None
        log(
            "真实子进程：--profile / --port 生效（sysName == 台账 id、日志报同一端口）",
            sys_name == b"h1" and port != 161 and f":{port}" in log_text,
            f"port={port} attempts={attempts} sysName={sys_name!r}",
        )
        log(
            "真实子进程：--community 覆盖默认值（public 被丢、s3cret 应答）",
            wrong is None and right is not None,
            f"public={'应答' if wrong is not None else '无响应'} s3cret={'应答' if right is not None else '无响应'}",
        )
        log(
            "真实子进程：SIGTERM 后退出码 0（信号处理器优雅收尾，不是被 kill）",
            code == 0,
            f"exit={code}",
        )
        log("真实子进程：退出后端口释放", released, release_detail)


def check_runtime() -> None:
    previous = os.environ.get("LAB_SNMP_ENABLED")
    os.environ.pop("LAB_SNMP_ENABLED", None)
    try:
        instance = snmp_runtime.SnmpRuntime()
        disabled = instance.start_for_net(SimpleNamespace(nameToNode={}))
        log(
            "未设 LAB_SNMP_ENABLED 时 start_for_net() 是 no-op",
            disabled.get("enabled") is False and disabled.get("running") is False and disabled.get("nodes") == [],
            f"enabled={disabled.get('enabled')} running={disabled.get('running')}",
        )

        os.environ["LAB_SNMP_ENABLED"] = "1"
        enabled_status = instance.start_for_net(SimpleNamespace(nameToNode={}))
        log(
            "启用后空网仍无 agent，状态读数是三态字段齐全的纯数据",
            enabled_status.get("enabled") is True
            and enabled_status.get("running") is False
            and enabled_status.get("nodes") == []
            and enabled_status.get("port") == 161
            and enabled_status.get("community") == "public",
            f"port={enabled_status.get('port')} community={enabled_status.get('community')}",
        )
        instance.stop_all()
    finally:
        if previous is None:
            os.environ.pop("LAB_SNMP_ENABLED", None)
        else:
            os.environ["LAB_SNMP_ENABLED"] = previous

    log(
        "lifespan 退出钩子可重复调用（stop_on_shutdown 幂等）",
        snmp_runtime.stop_on_shutdown() is None,
    )

    # agent 子进程靠 `-m mininet_gui_backend.snmp.agent` 起来，而包在 `services/mininet-api/` 下：
    # PYTHONPATH 指错一级（例如指到 `services/`）时，只有 `cwd` 兜着，换个启动方式就 ImportError。
    launch_src = inspect.getsource(snmp_runtime.SnmpRuntime._launch)
    log(
        "agent 子进程的 PYTHONPATH 指向服务根（可 import mininet_gui_backend）",
        "SERVICE_ROOT.parent" not in launch_src
        and (snmp_runtime.SERVICE_ROOT / "mininet_gui_backend" / "snmp" / "agent.py").is_file(),
        f"SERVICE_ROOT={snmp_runtime.SERVICE_ROOT}",
    )


def _mode(path: Path) -> int:
    return path.stat().st_mode & 0o777


def _expect_error(fn):
    """跑一次写操作，把异常原样返回（类型与 code 由调用方断言）。"""
    try:
        fn()
    except Exception as exc:  # noqa: BLE001 - 类型不对也要报出来
        return exc
    return None


def check_credentials() -> None:
    """单份 v2c 凭据（`NMCPS-ADR-0028` §6 D8–D12）。

    断言的是**盘上的事实**与状态读数的一致性：0600 / 0700、`public_view()` 不含密文、
    重复开通 409、未开通轮换 / 吊销 404、轮换版本 +1、吊销后回落部署默认串，
    以及新串真的出现在 agent 的命令行上（`apply_credentials()`）。
    """
    previous = {
        name: os.environ.get(name)
        for name in ("LAB_SNMP_ENABLED", "LAB_SNMP_COMMUNITY", "LAB_SNMP_STATE_DIR")
    }
    original_popen = snmp_runtime.subprocess.Popen
    original_which = snmp_runtime.shutil.which
    original_geteuid = os.geteuid
    captured: dict[str, list[list[str]]] = {"cmd": []}

    class FakeProcess:
        pid = 4242

        def __init__(self, cmd, **_kwargs):
            captured["cmd"].append(list(cmd))

        def poll(self):
            return None

        def terminate(self):
            return None

        def wait(self, timeout=None):  # noqa: ARG002 - 与 Popen 同形
            return 0

    try:
        with tempfile.TemporaryDirectory() as tmp:
            os.environ["LAB_SNMP_ENABLED"] = "1"
            os.environ["LAB_SNMP_COMMUNITY"] = "deploy-community-1"
            os.environ["LAB_SNMP_STATE_DIR"] = tmp
            store = snmp_runtime.credential_store()
            runtime = snmp_runtime.SnmpRuntime()

            before = runtime.status()
            log(
                "未开通：状态回部署默认串且 community_source=deployment",
                before.get("onboarded") is False
                and before.get("community") == "deploy-community-1"
                and before.get("community_source") == "deployment"
                and before.get("credential_version") is None,
                f"community={before.get('community')} source={before.get('community_source')}",
            )

            first = store.onboard()
            path = snmp_runtime.credentials_path()
            log(
                "开通：凭据文件 0600、目录 0700、社区串为服务端生成的 sim- 前缀",
                path.is_file()
                and _mode(path) == 0o600
                and _mode(path.parent) == 0o700
                and str(first.get("community", "")).startswith(credentials.GENERATED_PREFIX)
                and first.get("credential_version") == 1,
                f"mode={oct(_mode(path))} dir={oct(_mode(path.parent))} version={first.get('credential_version')}",
            )

            view = store.public_view()
            log(
                "public_view() 不含密文（D9：读端点的读者只要 lab:read）",
                "community" not in view
                and view.get("onboarded") is True
                and view.get("credential_version") == 1
                and str(first.get("community")) not in json.dumps(view),
                f"keys={sorted(view)}",
            )

            onboarded_status = runtime.status()
            log(
                "status() 开通后 community=None（密文不回传），source=credential",
                onboarded_status.get("community") is None
                and onboarded_status.get("community_source") == "credential"
                and onboarded_status.get("onboarded") is True
                and str(first.get("community")) not in json.dumps(onboarded_status),
                f"source={onboarded_status.get('community_source')}",
            )

            duplicate = _expect_error(lambda: store.onboard())
            log(
                "重复开通 → CredentialExists（409 snmp_credentials_exist）",
                isinstance(duplicate, credentials.CredentialExists)
                and duplicate.status_code == 409
                and duplicate.code == "snmp_credentials_exist",
                f"error={type(duplicate).__name__}",
            )

            rotated = store.rotate()
            record = snmp_runtime.credential_record() or {}
            log(
                "轮换：版本 +1、密文换新、rotated_at 落盘",
                rotated.get("credential_version") == 2
                and rotated.get("community") != first.get("community")
                and bool(record.get("rotated_at"))
                and record.get("created_at") == first.get("created_at"),
                f"version={rotated.get('credential_version')}",
            )

            weak = {
                value: _expect_error(lambda value=value: credentials.validate_community(value))
                for value in ("public", "short", "has space")
            }
            named = credentials.validate_community("Mpls2026-lab")
            log(
                "弱串（默认串 / 太短 / 带空白）回 400 snmp_community_weak，可读强串放行",
                all(isinstance(error, credentials.WeakCommunity) and error.status_code == 400 for error in weak.values())
                and named == "Mpls2026-lab",
                f"errors={','.join(type(error).__name__ for error in weak.values())}",
            )
            net = SimpleNamespace(nameToNode={"h1": StubNode("h1", "10.0.0.1", pid=4242)})
            snmp_runtime.subprocess.Popen = FakeProcess
            snmp_runtime.shutil.which = lambda _name: "/usr/bin/nsenter"
            os.geteuid = lambda: 0
            captured["cmd"].clear()
            applied = runtime.apply_credentials(net)
            first_cmd = captured["cmd"][0] if captured["cmd"] else []
            log(
                "apply_credentials() 全量重启，新串出现在 agent 命令行 --community 上",
                applied.get("applied") is True
                and "--community" in first_cmd
                and first_cmd[first_cmd.index("--community") + 1] == rotated.get("community")
                and applied.get("status", {}).get("community") is None,
                f"applied={applied.get('applied')} argc={len(first_cmd)}",
            )

            explicit = store.rotate("Mpls2026-lab")
            captured["cmd"].clear()
            runtime.apply_credentials(net)
            second_cmd = captured["cmd"][0] if captured["cmd"] else []
            log(
                "显式轮换的串同样进命令行，且旧串不再出现",
                explicit.get("credential_version") == 3
                and second_cmd[second_cmd.index("--community") + 1] == "Mpls2026-lab"
                and str(rotated.get("community")) not in " ".join(second_cmd),
                f"version={explicit.get('credential_version')}",
            )

            revoked = store.revoke()
            after = runtime.status()
            log(
                "吊销：文件消失、状态回落部署默认串",
                revoked.get("onboarded") is False
                and not path.exists()
                and after.get("community") == "deploy-community-1"
                and after.get("community_source") == "deployment",
                f"exists={path.exists()} source={after.get('community_source')}",
            )

            missing = {
                "rotate": _expect_error(store.rotate),
                "revoke": _expect_error(store.revoke),
            }
            log(
                "未开通时轮换 / 吊销 → CredentialMissing（404 snmp_credentials_missing）",
                all(
                    isinstance(error, credentials.CredentialMissing)
                    and error.status_code == 404
                    and error.code == "snmp_credentials_missing"
                    for error in missing.values()
                ),
                f"errors={','.join(sorted(str(error.code) for error in missing.values()))}",
            )

            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("{not json", encoding="utf-8")
            broken_view = store.public_view()
            log(
                "凭据文件损坏：状态里看得见 credential_error，采集回落部署默认串（不静默）",
                broken_view.get("onboarded") is False
                and broken_view.get("credential_error") == "snmp_credentials_unwritable"
                and snmp_runtime.effective_community() == "deploy-community-1",
                f"error={broken_view.get('credential_error')} community={snmp_runtime.effective_community()}",
            )

            log(
                "凭据目录默认落在服务根的 .data/snmp 下（不放仓库根 / tmp）",
                '".data" / "snmp"' in inspect.getsource(snmp_runtime.state_dir),
                f"SERVICE_ROOT={snmp_runtime.SERVICE_ROOT}",
            )
    finally:
        snmp_runtime.subprocess.Popen = original_popen
        snmp_runtime.shutil.which = original_which
        os.geteuid = original_geteuid
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def main() -> int:
    check_ber()
    table = check_mib()
    check_respond(table)
    check_inventory()
    check_loopback(table)
    check_agent_process()
    check_runtime()
    check_credentials()

    failed = [label for label, ok in results if not ok]
    print(f"\n结果：{len(results) - len(failed)} 通过 / {len(failed)} 失败")
    for label in failed:
        print(f"  ❌ {label}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())

