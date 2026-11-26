"""SNMP 凭据存储（`NMCPS-ADR-0028` §6，D8 / D9 / D11）。

一份 v2c 社区串，落在 `.data/snmp/credentials.json`：目录 `0700`、文件 `0600`、
写入走「临时文件 + `os.replace`」。这里的三个写方法（`onboard` / `rotate` /
`revoke`）只负责**改盘上的事实**，起不停 agent 由 `runtime.apply_credentials()`
决定 —— 存储不认识网络，也就不会出现「文件改了、进程没换」的分叉。

密文的可见性（D9）：`onboard()` / `rotate()` 的返回值里带 `community`；
`public_view()` 永远不带，供 `GET /snmp/state` 与 `GET /snmp/topology` 使用。

只依赖标准库。
"""

from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

#: v2c 固定报 `2`（D8）；目前没有 v1 / v3 分支，写了也不认
CREDENTIAL_VERSION = 2
MIN_COMMUNITY_LENGTH = 8
MAX_COMMUNITY_LENGTH = 64
#: 全网默认串：开通动作的意义就是摆脱它们（D11）
WEAK_COMMUNITIES = frozenset({"public", "private"})
GENERATED_PREFIX = "sim-"


class CredentialError(Exception):
    """凭据面的领域错误：`code` 直接当上游 `detail`（BFF 原样透传）。"""

    status_code = 500
    code = "snmp_credentials_error"


class CredentialExists(CredentialError):
    status_code = 409
    code = "snmp_credentials_exist"


class CredentialMissing(CredentialError):
    status_code = 404
    code = "snmp_credentials_missing"


class WeakCommunity(CredentialError):
    status_code = 400
    code = "snmp_community_weak"


class CredentialStoreUnavailable(CredentialError):
    status_code = 500
    code = "snmp_credentials_unwritable"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def generated_community() -> str:
    """服务端生成的社区串：`sim-` + 32 位十六进制（36 字符，落在 8–64 之内）。"""
    return f"{GENERATED_PREFIX}{secrets.token_hex(16)}"


def validate_community(value: str) -> str:
    """显式社区串的强度校验（D11）：8–64 个可打印 ASCII、无空白、不是默认串。

    只做「能否安全地用在一份配置里」的判断 —— 不去猜熵，也不强制大小写混合：
    运维可能用 `Mpls2026-lab` 这种可读串，拒绝它只会把人推回 `public`。
    """
    text = str(value)
    if text != text.strip() or any(ch.isspace() for ch in text):
        raise WeakCommunity("community must not contain whitespace")
    if not MIN_COMMUNITY_LENGTH <= len(text) <= MAX_COMMUNITY_LENGTH:
        raise WeakCommunity(
            f"community must be {MIN_COMMUNITY_LENGTH}-{MAX_COMMUNITY_LENGTH} characters"
        )
    if not all(0x21 <= ord(ch) <= 0x7E for ch in text):
        raise WeakCommunity("community must be printable ASCII")
    if text.lower() in WEAK_COMMUNITIES:
        raise WeakCommunity("community must not be a well-known default")
    return text


class CredentialStore:
    """一个实例一份凭据；路径由调用方给（`runtime.credentials_path()`）。"""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    # -- 读 ---------------------------------------------------------------
    def read(self) -> Optional[Dict[str, Any]]:
        """返回完整记录（含密文），只在 `runtime` 内部使用；不存在回 `None`。

        文件损坏**不**静默当作「没开通」：那会让 `effective_community()` 悄悄回落到
        部署默认串，而运维以为编排出来的串还在生效。调用方（runtime）把它记成
        `credential_error` 并继续用部署默认串 —— 采集不中断，但状态里看得见。
        """
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        except OSError as exc:
            raise CredentialStoreUnavailable(f"cannot read {self.path.name}: {exc}") from exc
        try:
            record = json.loads(raw)
        except ValueError as exc:
            raise CredentialStoreUnavailable(f"{self.path.name} is not valid JSON: {exc}") from exc
        if not isinstance(record, dict) or not str(record.get("community") or "").strip():
            raise CredentialStoreUnavailable(f"{self.path.name} has no community")
        return record

    def onboarded(self) -> bool:
        return self.read() is not None

    def public_view(self) -> Dict[str, Any]:
        """不含密文的元数据：`GET /snmp/state` 与 `/snmp/topology` 用的那一份（D9）。"""
        empty = {
            "onboarded": False,
            "credential_version": None,
            "credential_created_at": None,
            "credential_rotated_at": None,
            "credential_error": None,
        }
        try:
            record = self.read()
        except CredentialError as exc:
            return {**empty, "credential_error": exc.code}
        if record is None:
            return empty
        return {
            "onboarded": True,
            "credential_version": int(record.get("credential_version") or 1),
            "credential_created_at": record.get("created_at"),
            "credential_rotated_at": record.get("rotated_at"),
            "credential_error": None,
        }


    # -- 写 ---------------------------------------------------------------
    def onboard(self, community: Optional[str] = None) -> Dict[str, Any]:
        """开通：已存在就 `CredentialExists`（D10 的 409），不覆盖。"""
        if self.read() is not None:
            raise CredentialExists("snmp credentials already exist")
        secret = validate_community(community) if community else generated_community()
        record = {
            "version": CREDENTIAL_VERSION,
            "community": secret,
            "credential_version": 1,
            "created_at": _now(),
            "rotated_at": None,
        }
        self._write(record)
        return {"community": secret, **self._metadata(record)}

    def rotate(self, community: Optional[str] = None) -> Dict[str, Any]:
        """轮换：密文换新、`credential_version + 1`；没开通就 `CredentialMissing`。"""
        existing = self.read()
        if existing is None:
            raise CredentialMissing("snmp credentials are not onboarded")
        secret = validate_community(community) if community else generated_community()
        record = {
            "version": CREDENTIAL_VERSION,
            "community": secret,
            "credential_version": int(existing.get("credential_version") or 1) + 1,
            "created_at": existing.get("created_at") or _now(),
            "rotated_at": _now(),
        }
        self._write(record)
        return {"community": secret, **self._metadata(record)}

    def revoke(self) -> Dict[str, Any]:
        """吊销：删文件；没开通就 `CredentialMissing`（404，与「不存在」同口径）。"""
        if self.read() is None:
            raise CredentialMissing("snmp credentials are not onboarded")
        try:
            self.path.unlink()
        except FileNotFoundError:  # pragma: no cover - 读与删之间的竞态
            raise CredentialMissing("snmp credentials are not onboarded") from None
        except OSError as exc:
            raise CredentialStoreUnavailable(f"cannot remove {self.path.name}: {exc}") from exc
        return self.public_view()

    # -- 落盘 -------------------------------------------------------------
    @staticmethod
    def _metadata(record: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "onboarded": True,
            "version": int(record.get("version") or CREDENTIAL_VERSION),
            "credential_version": int(record.get("credential_version") or 1),
            "created_at": record.get("created_at"),
            "rotated_at": record.get("rotated_at"),
        }

    def _write(self, record: Dict[str, Any]) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            os.chmod(self.path.parent, 0o700)
            tmp = self.path.with_name(f".{self.path.name}.tmp")
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(record, handle, ensure_ascii=False, indent=2)
            os.replace(tmp, self.path)
            os.chmod(self.path, 0o600)
        except OSError as exc:
            raise CredentialStoreUnavailable(f"cannot write {self.path.name}: {exc}") from exc
