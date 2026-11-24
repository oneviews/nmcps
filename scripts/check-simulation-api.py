#!/usr/bin/env python3
"""会话层 + 入口鉴权的运行时自检（M0 远程化）。

`pnpm check:engines` 只证明引擎与签名**函数**对；这里启动真的后端（uvicorn），
用 HTTP 走一遍：

- `LAB_API_TOKEN` 生效：`/api/health`、`/api/version` 公开，其余无 token → 401；
- `/api/version` 带契约标记 `api_contract`（BFF 握手靠它）；
- `dryrun` 引擎的整条会话链路：建会话 → 加节点 / 链路 → 起停 → 删除 → 404。

前置：`pip install -r services/mininet-api/requirements.txt` 与系统 Mininet
（`api.py` 顶层 `import mininet`）。不需要 root：dryrun 不碰内核。
"""

from __future__ import annotations

import json
import os
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE_DIR = ROOT / "services" / "mininet-api"
TOKEN = f"lab-check-{secrets.token_hex(8)}"

results: list[tuple[str, bool, str]] = []

# 本机环境可能带 `http_proxy`：urllib 默认会走代理，回 503（代理的本地拒绝页面），
# 看起来像「后端没起」。自检只连回环，显式禁用代理。
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def log(label: str, ok: bool, detail: str = "") -> None:
    results.append((label, ok, detail))
    print(f"{'✅' if ok else '❌'} {label}{f' — {detail}' if detail else ''}")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def call(port: int, path: str, *, method: str = "GET", token: str | None = None, body: dict | None = None) -> tuple[int, dict]:
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method)
    if token is not None:
        request.add_header("x-lab-token", token)
    payload = None
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        request.add_header("content-type", "application/json")
    try:
        with OPENER.open(request, payload, timeout=20) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw or b"null")
        except json.JSONDecodeError:
            return error.code, {"raw": raw.decode("utf-8", "replace")}


def wait_ready(port: int, process: subprocess.Popen, deadline: float = 60.0) -> bool:
    started = time.monotonic()
    while time.monotonic() - started < deadline:
        if process.poll() is not None:
            return False
        try:
            status, _ = call(port, "/api/health")
        except (urllib.error.URLError, ConnectionError, OSError):
            time.sleep(0.4)
            continue
        if status == 200:
            return True
        time.sleep(0.4)
    return False


def main() -> int:
    port = free_port()
    env = {
        **os.environ,
        "LAB_API_TOKEN": TOKEN,
        # 非 root 的 `mn -c` 会对着别人的进程反复 pkill 失败并卡住启动；
        # dryrun 不碰真实网络，跳过启动 / 关闭时的清理。
        "LAB_SKIP_STARTUP_CLEANUP": "1",
        "PYTHONPATH": str(SERVICE_DIR),
        "PYTHONUNBUFFERED": "1",
    }
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "mininet_gui_backend.api:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=str(SERVICE_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        if not wait_ready(port, process):
            output = ""
            if process.poll() is not None and process.stdout is not None:
                output = process.stdout.read()[-1500:]
            log("后端在 60 秒内就绪（uvicorn + mininet 可导入）", False, output.strip() or "进程未起")
            return 1
        log("后端在 60 秒内就绪（uvicorn + mininet 可导入）", True, f"127.0.0.1:{port}")

        status, body = call(port, "/api/health")
        log(
            "公开路径：`/api/health` 无 token 也回 200（探针不能带凭据）",
            status == 200 and "timestamp" in body,
            f"{status} connected={body.get('connected')}（非 root 时为 False，dryrun 不需要真网）",
        )

        status, body = call(port, "/api/version")
        log(
            "公开路径：`/api/version` 回契约标记 api_contract=2.0（BFF 握手依据）",
            status == 200 and body.get("api_contract") == "2.0",
            f"{status} contract={body.get('api_contract')!r}",
        )

        status, body = call(port, "/api/simulation/engines")
        log(
            "未带 token → 401 lab_token_invalid（不是 200 空表）",
            status == 401 and body.get("detail") == "lab_token_invalid",
            f"{status} {body.get('detail')!r}",
        )

        status, body = call(port, "/api/simulation/engines", token="wrong-token")
        log("错误 token → 401 lab_token_invalid", status == 401 and body.get("detail") == "lab_token_invalid", f"{status}")

        status, body = call(port, "/api/simulation/engines", token=TOKEN)
        engines = {entry.get("name"): entry for entry in (body.get("engines") or [])}
        log(
            "带 token：三个引擎都登记（wired / wireless / dryrun）",
            status == 200 and set(engines) == {"wired", "wireless", "dryrun"},
            f"{status} {sorted(engines)}",
        )
        log(
            "dryrun 可用；wired 缺 root 时明确报原因（不是静默不可用）",
            engines.get("dryrun", {}).get("availability", {}).get("available") is True
            and engines.get("wired", {}).get("availability", {}).get("reason") in {"", "requires_root"},
            f"wired={engines.get('wired', {}).get('availability')}",
        )

        status, session = call(port, "/api/simulation/sessions", method="POST", token=TOKEN, body={"engine": "dryrun", "name": "check"})
        session_id = session.get("id", "")
        log("建 dryrun 会话 → 201 + sim_* id", status == 201 and session_id.startswith("sim_"), f"{status} {session_id}")

        status, body = call(port, f"/api/simulation/sessions/{session_id}/nodes", method="POST", token=TOKEN, body={"id": "h1", "type": "host"})
        log("加节点 h1 → 201", status == 201 and body.get("type") == "host", f"{status}")
        call(port, f"/api/simulation/sessions/{session_id}/nodes", method="POST", token=TOKEN, body={"id": "s1", "type": "switch"})
        status, body = call(
            port,
            f"/api/simulation/sessions/{session_id}/links",
            method="POST",
            token=TOKEN,
            body={"id": "h1--s1", "src": "h1", "dst": "s1", "options": {"bw": 10}},
        )
        log("加链路 h1--s1（options 原样保留）→ 201", status == 201 and body.get("options", {}).get("bw") == 10, f"{status}")

        status, body = call(port, f"/api/simulation/sessions/{session_id}", token=TOKEN)
        live = body.get("live") or {}
        log(
            "会话状态：created + 2 节点 / 1 链路",
            status == 200 and body.get("state") == "created" and live.get("node_count") == 2 and live.get("link_count") == 1,
            f"{status} state={body.get('state')} live={live}",
        )

        status, body = call(port, f"/api/simulation/sessions/{session_id}/start", method="POST", token=TOKEN)
        log("start → state=running + live.started=True", status == 200 and body.get("state") == "running" and body.get("live", {}).get("started") is True, f"{status}")
        status, body = call(port, f"/api/simulation/sessions/{session_id}/stop", method="POST", token=TOKEN)
        log("stop → state=stopped + live.started=False", status == 200 and body.get("state") == "stopped" and body.get("live", {}).get("started") is False, f"{status}")

        status, body = call(port, "/api/simulation/sessions", method="POST", token=TOKEN, body={"engine": "no-such-engine"})
        log("未知引擎 → 404 engine_not_found", status == 404 and "engine_not_found" in str(body.get("detail")), f"{status} {body.get('detail')}")

        status, body = call(port, f"/api/simulation/sessions/{session_id}/nodes/h1", method="DELETE", token=TOKEN)
        log("删节点 → 200", status == 200 and body.get("status") == "deleted", f"{status}")

        status, body = call(port, f"/api/simulation/sessions/{session_id}", method="DELETE", token=TOKEN)
        log("删会话 → 200 deleted", status == 200 and body.get("status") == "deleted", f"{status}")
        status, body = call(port, f"/api/simulation/sessions/{session_id}", token=TOKEN)
        log("删后再读 → 404 session_not_found", status == 404 and "session_not_found" in str(body.get("detail")), f"{status}")

        passed = sum(1 for _, ok, _ in results if ok)
        print(f"\n{passed}/{len(results)} 项通过")
        return 0 if passed == len(results) else 1
    finally:
        process.terminate()
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()


if __name__ == "__main__":
    raise SystemExit(main())
