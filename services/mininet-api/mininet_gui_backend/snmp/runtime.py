"""SNMP 采集面的生命周期（`NMCPS-ADR-0028` D2 / D4）。

起停挂点只有一处：`start_for_net()` 在网络启动成功后调用，`stop_all()` 在网络
停止 / 重置 / 进程退出时调用。每个节点一个 agent 进程：

    nsenter -t <节点 pid> -n -- python -m mininet_gui_backend.snmp.agent --profile ...

因此绑定发生**在节点自己的 netns 里**，宿主 `:161` 与宿主 `snmpd` 都不受影响；
非 root（没有 `nsenter` 能力）时节点记为 `unavailable`，绝不回落到根 netns。

默认关闭：只有 `LAB_SNMP_ENABLED=1` 才拉起。采集失败只写状态，**不**让起网失败。
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from mininet_gui_backend.snmp import credentials, inventory

LOG = logging.getLogger("mininet_gui_backend.snmp")

#: 服务根目录（`services/mininet-api`）：工作目录与 `.data` 都相对它
SERVICE_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_PORT = 161
DEFAULT_COMMUNITY = "public"
STOP_TIMEOUT_SECONDS = 3.0


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def enabled() -> bool:
    return _env_flag("LAB_SNMP_ENABLED")


def port() -> int:
    raw = os.environ.get("LAB_SNMP_PORT", "").strip()
    try:
        value = int(raw) if raw else DEFAULT_PORT
    except ValueError:
        LOG.warning("invalid LAB_SNMP_PORT=%r, falling back to %d", raw, DEFAULT_PORT)
        return DEFAULT_PORT
    return value if 1 <= value <= 65535 else DEFAULT_PORT


def community() -> str:
    """部署默认串（D3）：没有编排出来的凭据时就是它，也是吊销后的回落值。"""
    return os.environ.get("LAB_SNMP_COMMUNITY", "").strip() or DEFAULT_COMMUNITY


def credentials_path() -> Path:
    return state_dir() / "credentials.json"


def credential_store() -> "credentials.CredentialStore":
    """每次读盘都新建一份：凭据是**盘上**的事实，不缓存在进程里。"""
    return credentials.CredentialStore(credentials_path())


def credential_record() -> Optional[Dict[str, Any]]:
    """盘上的完整凭据（含密文）；没开通回 `None`，文件坏了抛 `CredentialStoreUnavailable`。"""
    return credential_store().read()


def effective_community() -> str:
    """agent 真正要用的社区串：凭据优先，否则部署默认（`NMCPS-ADR-0028` §6 D9）。

    文件损坏时回落部署默认串并记一条 warning —— 采集不中断，但 `status()` 里的
    `credential_error` 会让「编排出来的串其实没生效」看得见，而不是静默降级。
    """
    try:
        record = credential_record()
    except credentials.CredentialError as exc:
        LOG.warning("snmp credential file is unusable, falling back to the deployment community: %s", exc)
        return community()
    if record is None:
        return community()
    return str(record.get("community") or "").strip() or community()


def collection_enabled() -> bool:
    """凭据写入的前置条件（D12）：采集面没开时写进去的串永远不会生效。"""
    return enabled()


def state_dir() -> Path:
    raw = os.environ.get("LAB_SNMP_STATE_DIR", "").strip()
    return Path(raw) if raw else SERVICE_ROOT / ".data" / "snmp"


def _safe_name(node_id: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in node_id) or "node"


def _write_private_json(path: Path, payload: Dict[str, Any]) -> None:
    """档案只落 0600 文件：社区串并不在里面，但接口 / MAC 属于面内事实。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:  # pragma: no cover - 非 POSIX
        pass
    tmp = path.with_name(f".{path.name}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    os.chmod(path, 0o600)



class SnmpRuntime:
    """进程表 + 状态读数；实例由 `api.py` 持有一份（与 `app.net` 同生命周期）。"""

    def __init__(self) -> None:
        self._procs: Dict[str, subprocess.Popen[bytes]] = {}
        self._nodes: Dict[str, Dict[str, Any]] = {}
        self._started_at: Optional[float] = None
        self._last_error: Optional[str] = None
        self._lock = threading.Lock()

    # -- 生命周期 ---------------------------------------------------------
    def start_for_net(self, net: Any) -> Dict[str, Any]:
        self.stop_all()
        with self._lock:
            self._last_error = None
            if not enabled():
                LOG.info("snmp collection disabled (LAB_SNMP_ENABLED is not set)")
                return self.status()
            if net is None:
                self._last_error = "network is not running"
                return self.status()
            self._started_at = time.time()
            for target in inventory.agent_targets(net, self._started_at):
                try:
                    self._launch(target)
                except Exception as exc:  # 采集失败不得影响起网
                    LOG.warning("snmp agent for %s failed to start: %s", target.get("id"), exc)
                    record = self._nodes.setdefault(str(target.get("id")), {})
                    record.update(
                        {
                            "id": str(target.get("id")),
                            "type": target.get("type"),
                            "ip": target.get("ip"),
                            "pid": target.get("pid"),
                            "port": port(),
                            "status": "unavailable",
                            "error": str(exc),
                        }
                    )
            return self.status()

    def _launch(self, target: Dict[str, Any]) -> None:
        node_id = str(target["id"])
        pid = target.get("pid")
        record: Dict[str, Any] = {
            "id": node_id,
            "type": target.get("type"),
            "ip": target.get("ip"),
            "pid": pid,
            "port": port(),
            "status": "unavailable",
            "error": None,
        }
        self._nodes[node_id] = record

        if pid is None:
            record["error"] = "node has no pid (network not started)"
            return
        if os.geteuid() != 0:
            record["error"] = "root required to enter the node netns"
            return
        nsenter = shutil.which("nsenter")
        if not nsenter:
            record["error"] = "nsenter is not available"
            return

        runtime_dir = state_dir()
        profile_path = runtime_dir / f"{_safe_name(node_id)}.json"
        _write_private_json(profile_path, target["profile"])
        log_path = runtime_dir / f"{_safe_name(node_id)}.log"

        cmd = [
            nsenter,
            "-t",
            str(pid),
            "-n",
            "--",
            sys.executable,
            "-m",
            "mininet_gui_backend.snmp.agent",
            "--profile",
            str(profile_path),
            "--port",
            str(port()),
            "--community",
            effective_community(),
        ]
        env = dict(os.environ)
        # 子进程要 `import mininet_gui_backend.snmp.agent`：包在 `services/mininet-api/` 下，
        # 所以 PYTHONPATH 必须指向服务根目录本身（不是它的上一级）；`cwd` 同时兜底。
        env["PYTHONPATH"] = os.pathsep.join(
            [str(SERVICE_ROOT), env.get("PYTHONPATH", "")]
        ).strip(os.pathsep)
        env["PYTHONUNBUFFERED"] = "1"

        runtime_dir.mkdir(parents=True, exist_ok=True)
        with open(log_path, "ab") as log_file:
            proc = subprocess.Popen(  # noqa: S603 - 参数全部来自受控配置
                cmd,
                cwd=str(SERVICE_ROOT),
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        self._procs[node_id] = proc
        record.update(
            {
                "status": "running",
                "error": None,
                "started_at": time.time(),
                "profile": str(profile_path),
                "log": str(log_path),
            }
        )

    def stop_node(self, node_id: str) -> None:
        proc = self._procs.pop(node_id, None)
        if proc is not None:
            self._terminate(proc)
        self._nodes.pop(node_id, None)

    def stop_all(self) -> None:
        with self._lock:
            procs = list(self._procs.values())
            self._procs.clear()
            self._nodes.clear()
            self._started_at = None
        for proc in procs:
            self._terminate(proc)

    @staticmethod
    def _terminate(proc: subprocess.Popen[bytes]) -> None:
        if proc.poll() is not None:
            return
        try:
            proc.terminate()
            proc.wait(timeout=STOP_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:  # pragma: no cover - 仅在 agent 卡死时
            LOG.warning("snmp agent %s ignored SIGTERM, killing", proc.pid)
            proc.kill()
        except OSError as exc:  # pragma: no cover - 进程已消失
            LOG.debug("snmp agent %s stop failed: %s", proc.pid, exc)

    # -- 读数 -------------------------------------------------------------
    def running(self) -> bool:
        return any(proc.poll() is None for proc in self._procs.values())

    def apply_credentials(self, net: Any) -> Dict[str, Any]:
        """凭据落盘后让新串生效（`NMCPS-ADR-0028` §6 D12）。

        「全量重启」是刻意的：agent 的社区串只在命令行上出现一次，没有热更新
        通道；逐条重启只会多出「有些节点还用旧串」的中间态。`applied` 表示是否
        真的重启过 —— 采集面关着或没有在跑的网络时为 `False`，状态照常可读。
        """
        restarted = enabled() and net is not None
        status = self.start_for_net(net)
        return {"applied": restarted, "status": status}

    def status(self) -> Dict[str, Any]:
        nodes: List[Dict[str, Any]] = []
        for node_id, record in sorted(self._nodes.items()):
            entry = dict(record)
            proc = self._procs.get(node_id)
            if proc is not None and proc.poll() is not None and entry.get("status") == "running":
                entry["status"] = "stopped"
                entry["error"] = f"agent exited with code {proc.returncode}"
            nodes.append(entry)
        view = credential_store().public_view()
        onboarded = bool(view.get("onboarded"))
        return {
            "enabled": enabled(),
            "running": self.running(),
            "port": port(),
            # 开通后不回传密文（D9）：读端点的读者只要 `lab:read`。未开通时这里是
            # 部署默认串 —— 它本来就在 `LAB_SNMP_COMMUNITY` 里，不是编排出来的秘密。
            "community": None if onboarded else community(),
            "community_source": "credential" if onboarded else "deployment",
            **view,
            "started_at": self._started_at,
            "error": self._last_error,
            "nodes": nodes,
        }


#: 进程内单例：与 `app.net` 同生命周期，由 `api.py` 起停（`NMCPS-ADR-0028` D4）
runtime = SnmpRuntime()


def stop_on_shutdown() -> None:
    """lifespan 退出时调用：进程退出不该把 root 名下的 agent 留在节点里。"""
    try:
        runtime.stop_all()
    except Exception as exc:  # pragma: no cover - 退出路径只记日志
        LOG.warning("snmp runtime shutdown failed: %s", exc)

