"""SNMP 采集面（M2 首增量，`NMCPS-ADR-0028`）。

模块划分：

- `ber.py`：BER / PDU 编解码（只服务 GET / GETNEXT）
- `mib.py`：节点档案 → system / ifTable / ipAddrTable OID 表
- `inventory.py`：从在线 `app.net` 抽节点档案（不读页面状态）
- `agent.py`：UDP 服务与纯函数 `respond()`
- `runtime.py`：`LAB_SNMP_ENABLED` 门控、`nsenter` 起停、状态读数

全部只依赖 Python 标准库：不 import `net-snmp`、不生成 `snmpd.conf`、不随包
分发 MIB 文本。写面（v2c/v3 开通、rotate / revoke）不在本增量，见 ADR §4。
"""

from __future__ import annotations

__all__ = ["agent", "ber", "inventory", "mib", "runtime"]
