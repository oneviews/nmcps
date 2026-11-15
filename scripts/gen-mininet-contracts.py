#!/usr/bin/env python3
"""从 FastAPI app 生成 Mininet OpenAPI 契约快照。

用法：
    pnpm contracts:gen      # 重新生成 packages/contracts/openapi/mininet.json
    pnpm contracts:check    # 只校验快照是否最新，不写文件

契约快照是前端 client、BFF 白名单和测试的共同事实源。修改
services/mininet-api 的 schema 或路由后，必须同时刷新本快照。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE_DIR = ROOT / "services" / "mininet-api"
SNAPSHOT = ROOT / "packages" / "contracts" / "openapi" / "mininet.json"

sys.path.insert(0, str(SERVICE_DIR))

from mininet_gui_backend.api import app  # noqa: E402


def render() -> str:
    spec = app.openapi()
    spec.setdefault("info", {})["x-generated-by"] = "scripts/gen-mininet-contracts.py"
    return json.dumps(spec, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    check_only = "--check" in sys.argv[1:]
    content = render()

    if check_only:
        if not SNAPSHOT.exists():
            print(f"❌ 缺少契约快照：{SNAPSHOT}；先运行 pnpm contracts:gen", file=sys.stderr)
            return 1
        if SNAPSHOT.read_text(encoding="utf-8") != content:
            print(
                f"❌ 契约快照已过期：{SNAPSHOT}；运行 pnpm contracts:gen 后提交",
                file=sys.stderr,
            )
            return 1
        print(f"✅ 契约快照最新：{SNAPSHOT.relative_to(ROOT)}")
        return 0

    SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT.write_text(content, encoding="utf-8")
    print(f"✅ 已生成契约快照：{SNAPSHOT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
