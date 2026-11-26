---
docId: NMCPS-ARCH-007
title: "实验面部署与运行架构"
description: "arch.lab-deploy 的 Tier 1 基准：实验后端与 BFF 的监听面与端口归属、特权模型与起停不变量、入口凭据（x-lab-token 与 WS HMAC 签名）、租户到实例的注册表、台账与重启语义、部署形态待裁决项与验收命令各自能证明什么。"
excerpt: "实验面监听面、特权、凭据与重启语义的唯一基准。"
keywords:
  - "lab"
  - "deployment"
  - "部署"
  - "特权"
  - "token"
  - "端口"
tier: 1
authority: normative
scope:
  - arch.lab-deploy
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-11-25"
updatedAt: "2026-11-25"
icon: "carbon:server"
tags:
  - "架构"
  - "实验台"
  - "部署"
  - "凭据"
---

# 实验面部署与运行架构（NMCPS-ARCH-007）

> **本文职责**：`arch.lab-deploy` 的唯一权威 —— 实验面「跑在哪里、以什么身份跑、谁能连、凭据怎么带、重启丢什么」。
> **不承载**：引擎内核与业务语义（`NMCPS-DESIGN-008`，layers/content/collections/cn/architecture/2.domain/simulation.md）；BFF 白名单与权限位（`NMCPS-ADR-0022`，layers/content/collections/cn/records/adr/adr-0022.md）；租户隔离裁决（`NMCPS-ADR-0021`，layers/content/collections/cn/records/adr/adr-0021.md）；长时预算（`NMCPS-ADR-0026`，layers/content/collections/cn/records/adr/adr-0026.md）。
> **目标读者**：实施 / 运维 / 排障工程师 / AI 助手。

---

## 一、定位

实验面有进程内特权状态（`app.net`）、一份入口凭据、一套按租户寻址的实例注册表。这三样都有「配错不报错、只在某个动作上炸」的性质，所以本文把它们定成可断言的约束，而不是部署备注。

三条不变量：

1. **监听面可枚举**：每个端口有且只有一个归属进程，浏览器永远不在其中。
2. **身份可判定**：一个进程能不能起真实网络，只取决于它有没有特权，不取决于任何配置开关。
3. **凭据可轮换**：HTTP 走请求头、WebSocket 走签名，口令不进查询串、不落日志。

判据来自代码而非偏好：`services/mininet-api/mininet_gui_backend/auth.py`（凭据与签名）、`layers/scenario/server/utils/bff/mininetConfig.ts`（实例与超时）、`nuxt.config.ts` 的 `runtimeConfig.mininet` / `runtimeConfig.lab`（缺省值）。

---

## 二、监听面与端口归属

| 进程 | 缺省监听 | 谁可以连 | 约束 |
| :--- | :--- | :--- | :--- |
| Mininet API（`uvicorn mininet_gui_backend.api:app`） | `127.0.0.1:8000`（`pnpm dev:lab-api`） | 只有 BFF（同机回环，或受控内网里的 BFF 主机） | 绑非回环地址**必须**设 `LAB_API_TOKEN`，见 §四 |
| Nitro BFF | `:3000` | 浏览器（同源） | 上游基址只在 Nitro 运行时配置里；`proxyToMininet()` 是唯一出站点 |
| SNMP agent（M2 首增量，节点内） | 节点 netns 内 `:161`（UDP；`LAB_SNMP_PORT` 可改） | NMS 采集端 | 每节点一份、跑在自己的 netns 里，不占宿主 `:161`；宿主 `snmpd` 可继续使用根 netns，见 `NMCPS-ADR-0028` |

三条硬约束：

1. **浏览器不得直连上游**。前缀同形（`NMCPS-ADR-0022` D11）意味着 `/api/mininet/**` 不带主机指 BFF、带 `:8000` 指上游直连；判「打到哪儿」只看主机与端口，不看路径，也不许在页面 / composable 里出现 `http://…:8000`。
2. **一个端口一个属主**。同一台机器上不要同时跑两份后端：`app.net` 是进程内全局，两份就是两张网、两把在途写锁，页面看到的事实会随请求落到不同进程。
3. **本机 `127.0.0.1:8000` 可能不是本服务**。2026-11-23 实测该端口被 nginx 的缺省 server 占着，`curl` 回 `400`；拿到 400 先看 `ss -ltn | grep ':8000'`，再谈后端有没有崩。真机验收因此用网卡地址（`REAL_MININET_BASE=http://192.168.1.90:8000`）。

---

## 三、特权模型

| 能力 | 需要 | 缺失时的形态 |
| :--- | :--- | :--- |
| 建网、起停、`TCLink`、OVS 端口 | root（`Mininet()` 内部 `ensureRoot()` 会 `exit(1)`） | `app.net = None`，只有 `dryrun` 会话可用 —— CI 与本地无 root 自检都靠它 |
| 启动 / 关闭时的 `mn -c` | root | 非 root 自检必须带 `LAB_SKIP_STARTUP_CLEANUP=1`，否则会对别人的进程反复 `pkill` 失败并卡住启动 |
| 主机接口上的 `tc` / netns 观测 | root + `nsenter` | 接口在主机自己的 netns 里，根命名空间看不到 `h1-eth0` |

四条约束：

1. **特权不下沉到 BFF**。BFF 只发 HTTP；终端、抓包、`full_reset` 的授权在 BFF，执行在上游。
2. **一个进程一份特权**。读台账不需要 root，但也不许为读再起第二份后端（见 §二第 2 条）。
3. **容器部署要显式给能力**。缺能力表现为「建网失败」而不是「启动失败」，`dryrun` 仍能跑通，很容易误判成代码问题；最小集合至少包含网络管理与 `/dev/net/tun`。
4. **起停不变量**（2026-11-18 实测）：SIGTERM 撞上一个同步长操作（如 `net.pingFull()`）时，优雅关闭会一直等 —— 结果「进程还在、`:8000` 已无监听」，新进程又卡在启动清理，于是两个进程都不 bind。判据是 `curl -o /dev/null -w '%{http_code}'` 恒为 `000` 而 `ps` 里还有 uvicorn；处置是 `pkill -9` + `mn -c`、确认端口空置后再起。

---

## 四、入口凭据

后端侧由 `auth.py` 的一个纯 ASGI 中间件统一判定，HTTP 与 WebSocket 不分家：

| 项 | 规则 |
| :--- | :--- |
| 未设 `LAB_API_TOKEN` | 只接受回环客户端（`127.0.0.0/8`、`::1`、IPv4-mapped、`localhost`、`testclient`），启动打一条 warning |
| 已设 `LAB_API_TOKEN` | 除 `/api/health`、`/api/version` 外，所有 HTTP 必须带 `x-lab-token`（`hmac.compare_digest` 常量时间比较） |
| WebSocket | Node 内置 `WebSocket` 不能设请求头 → 改带 `lab_ts` + `lab_sig = HMAC-SHA256(token, "<path>\n<ts>")`，120 秒窗口且**绑定路径** |
| 拒绝 | HTTP `401` + `{detail: lab_token_required｜lab_token_invalid}`；WebSocket 以 `close 1008` + 同一 reason 结束 |
| 口令边界 | 不进查询串（HTTP）、不进日志、不回传；泄露一条 WS URL 也换不到别的通道 |

BFF 侧同值配置 `NUXT_MININET_TOKEN`：出站只以请求头带它，WebSocket 用它算签名。握手走 `GET /api/mininet/version`，读上游 `api_contract` 并回 `compatible`（主版本比较，缺省期望 `2.0`）。

**最硬的一条**：监听非回环地址而未设 token，等于把 `full_reset` 开放给整个局域网 —— 未设 token 时后端只信任回环，一旦绑到 `0.0.0.0` 这道门槛就不存在了。「绑网卡地址」与「两侧同值 token」必须同时成立，或者都不做。

---

## 五、租户 → 实例

`NUXT_MININET_INSTANCES`（JSON 字符串，形如 `{"t_a":{"baseUrl":"http://127.0.0.1:8000"}}`）是唯一真源：`getMininetConfig(event, tenantId)` 传了租户就只查这张表，未命中即空 `baseUrl` → `503 tenant_runtime_unavailable`，**绝不回退全局实例**。

- 解析失败一律按空表处理（fail closed）：配置坏了必须失败关闭，不能悄悄掉回全局实例。
- 单个实例可覆盖 `token` / `timeoutMs` / `longTimeoutMs`；长时预算用 `Math.max()` 兜住 `longTimeoutMs >= timeoutMs`（`NMCPS-ADR-0026` D1）。
- 全局与租户都为空 = 通道未启用，`/api/mininet/**` 回 `503 mininet_not_configured`，不是 500。
- 缺省预算：读 15 秒、长时 180 秒。后者来自实测 —— 一次 `pingall` 在 9 节点网络上耗时 42.6 秒，沿用 15 秒会被判成超时。

---

## 六、数据与重启语义

| 事实 | 存放位置 | 重启后 |
| :--- | :--- | :--- |
| 拓扑 / 节点 / 链路 / 运行态 | 上游 `app.net`（进程内） | 全丢，上游为空 |
| 会话表 | `sessions.py` 进程内表（上限 `MAX_SESSIONS = 32`） | 全丢 |
| 台账（资源归属、状态读数） | BFF `.data/lab-ledger.json` | 留存，但可能指向已不存在的东西 |
| 写操作审计 | BFF `.data/audit/lab-audit-<日期>.jsonl`（按天分片） | 留存，只追加 |

四条约束：

1. **重启后不要先点台账对账**。对账按上游事实重写清单，上游空 = 把台账清空。正确顺序是导出 / 导入拓扑 → 启动 → 再对账。
2. **台账文件存在即只信文件**。seed 只在文件缺失时生效，删文件才会回到 seed（避免「删了又被 seed 复活」）。
3. **root 产物会让普通用户的写端点全红**。root 跑完会留下 root 名下的审计分片，普通用户起的 BFF 追加即 `EACCES` → 所有写端点 `503 audit_unavailable`，而读端点照常 200。诊断口径：`find .data -user root` 有输出就先修属主，再怀疑代码。
4. **票表仍是进程内内存**。`ws-ticket` 的 `jti` 一次性表在当前 BFF 进程里；横向扩容前必须先落到台账，否则「同一张票换一个实例就能再用一次」。

---

## 七、部署形态与待裁决

**已定**：单宿主单实例（一台实验机只跑一份上游）、上游与 BFF 可不同机（token 就是远程化的前提）、每租户一台宿主（隔离级别 A，`NMCPS-ADR-0021`）。

以下任一项落地前，文档与界面都不得写「已支持」：

| 项 | 状态 | 落地时要改的地方 |
| :--- | :--- | :--- |
| 90 的启动形态：systemd `User=labrun` + `AmbientCapabilities`（`CAP_NET_ADMIN` / `CAP_NET_RAW`）还是 root 直启 | 待确认 | 安装脚本、文件属主、`.data` 权限（见 §六第 3 条） |
| 专用镜像（自定义 `regulatory.db` / DFS） | 待确认 | 决定本仓只交安装脚本，还是整套镜像与验收 |
| SNMP `:161` 与宿主 `snmpd` 冲突（M2 的进程内 agent） | 已裁决（`NMCPS-ADR-0028`） | 每个 agent 在节点自己的 netns 内绑 `:161`，不占宿主端口；根 netns 代理形态被否决 |
| 每租户实例编排（容器 / netns / 配额） | 待裁决 | 编排在部署面，BFF 只消费注册表 |

---

## 八、验收口径

| 命令 | 能证明 | 不能证明 |
| :--- | :--- | :--- |
| `pnpm lab:check` | 上游路由清单、CORS 已移除、起停与 iperf 的源码守卫 | 真实网络行为 |
| `pnpm check:engines` | 引擎分层合法、WS 签名函数正确（无 fastapi / 无 root） | 任何真实 HTTP |
| `pnpm check:simulation` | 起真后端（`dryrun`）：401 矩阵、`api_contract`、会话全链路 | 特权路径 |
| `pnpm check:lab-bff` | BFF 白名单、权限位、审计、WS 票 | 上游是否真在跑 |
| `pnpm check:lab-real:root` | 真 Mininet：建网 / 起停 / 链路带宽 / iperf | 多租户隔离（单实例） |

跳过（例如没有 `CHECK_REAL_MININET`）**不算通过**：`check:lab-real` 的非 root 运行会把 `tc` 那层打 `⏭`，读成「已验」是最常见的误判。

---

## 九、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-11-25 | 0.1.0 | 首版：把 `docs/ai/simulation-parity.md` §七第 2 条的「部署 / 特权 / token 与端口约束」折成 Tier 1 基准 —— 监听面与端口归属、特权模型与起停不变量、`x-lab-token` 与 WS 签名、租户实例注册表与 fail-closed、台账与重启语义、待裁决项、验收命令的证明边界。 |
