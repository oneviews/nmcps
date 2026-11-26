---
docId: NMCPS-ARCH-002
title: "数据源架构"
description: "数据源（arch.datasource）的 Tier 1 架构基准：数据源分类（设备采集/指标/告警/资产配置/实验网络运行时）、存储分层（RDBMS 控制 + TSDB 时序）、云端/边缘数据适配层、统一数据流转，以及第二出站通道（Mininet 实验后端）的白名单、能力位与就绪分离。本文是 arch.datasource 域的唯一权威。"
excerpt: "数据源分类、RDBMS+TSDB 存储分层、云边数据适配层与 Mininet 实验后端第二通道的数据源架构基准。"
keywords:
  - "datasource"
  - "architecture"
  - "数据源"
  - "架构"
  - "存储分层"
tier: 1
authority: normative
scope:
  - arch.datasource
status: baseline
version: 0.5.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-10-25"
updatedAt: "2026-11-25"
icon: "carbon:data-base"
tags:
  - "架构"
  - "数据源"
  - "存储分层"
---

# 数据源架构（NMCPS-ARCH-002）

> **本文职责**：`arch.datasource` 域的唯一权威，定义系统「数据源」——数据从哪里采集、如何分层存储、云边两侧如何用同一套接口读写。通信流的协议与拓扑见 `NMCPS-ARCH-001`，治理规则见 `NMCPS-GOV-001`。
> **目标读者**：架构与实施工程师 / AI 助手。

---

## 一、定位

数据源是网络管理系统的「记忆」：控制数据（资产、配置、身份）需要强一致，时序指标需要高吞吐。二者用不同存储引擎承载，是读写性能解耦的前提。

---

## 二、数据源分类

| 数据源 | 内容 | 时效性 | 存储 |
| :--- | :--- | :--- | :--- |
| 设备采集 | SNMP 轮询的设备状态、MIB 数据 | 实时 | 边缘采集 → 云端 TSDB |
| 指标流 | 高频监控指标（端口流量、CPU、内存） | 实时 | TSDB |
| 告警事件 | 边缘本地判定的告警 | 实时 | RDBMS（经 MQTT 上报） |
| 资产与配置 | 设备资产、配置变更、身份 | 强一致 | RDBMS |
| 实验网络运行时 | 实验网络里的节点 / 链路 / 运行态 / 流表与控制入口（可选） | 实时，不落库 | BFF 直读直发（见 §六） |

> 前四类是**需要存储**的数据源；第五类是**零存储**的可选上游，独立通道、独立就绪口径，缺它时页面局部降级而非不可用。8001 仿真平台运行时曾占这一行，2026-11-25 随 `NMCPS-ADR-0027` R8 退役，改由 Mininet 实验后端承担。

---

## 三、存储分层

| 层 | 引擎 | 承载 | 特征 |
| :--- | :--- | :--- | :--- |
| 控制存储 | RDBMS（PostgreSQL / Supabase） | 资产、配置、身份、审计 | 强一致、行级安全（RLS） |
| 时序存储 | TSDB（VictoriaMetrics） | 监控指标 | 高吞吐、压缩、降采样 |
| 边缘本地 | PocketBase / SQLite | 边缘离线自治 | 轻量（< 50MB）、单二进制 |

控制流与数据流的读写分离，避免高频指标写入冲击控制数据的强一致事务（见 `NMCPS-ARCH-001` §三）。

---

## 四、数据适配层（云边同构）

基于 Nuxt Layers 机制，云边两侧通过**同一套 Composables 接口**访问各自数据源，实现代码高复用：

| 适配层 | 后端 | 使用端 |
| :--- | :--- | :--- |
| layer-supabase | Supabase SDK + go-zero API Gateway | 云端总控台 |
| layer-pocketbase | PocketBase SDK + 边缘 Go Daemon | 边缘本地自治 UI |

两侧对外暴露完全一致的 Composables 接口；云端应用与边缘应用只组合不同适配层，UI 组件与业务逻辑共享。

---

## 五、数据流转

```text
设备（SNMP/Agent）
  → 边缘采集（Exporter / Go Daemon）
  → 指标直通云端 TSDB / 告警经 MQTT 上云 / 配置经 ChangeSet 同步
  → 云端 RDBMS（控制）+ TSDB（时序）
  → 总控台 UI（queryCollection / Composables 读取）
```

Mininet 实验后端是**第二条出站通道**（见 §六），不走上图的采集链路，也不写入任何存储层：它提供「当前这张实验网络」的实时状态与控制入口，BFF 在请求期内读取、归一为 `ApiResponse` 返回，不做缓存与回写。

---

## 六、第二出站通道：Mininet 实验后端

BFF（Nitro）有且只有两条出站通道：主上游（`runtimeConfig.bff.upstreamBase`，NMS 统一网关）与可选上游（`runtimeConfig.mininet.baseUrl` / `instances`，Mininet 实验后端，经 `/api/mininet/**` 与 `/mininet-ws/*` 暴露）。跨层裁决见 `NMCPS-DESIGN-008`（layers/content/collections/cn/architecture/2.domain/simulation.md），监听面 / 特权 / 凭据 / 重启语义见 `NMCPS-ARCH-007`（layers/content/collections/cn/architecture/1.architecture/lab-deployment-architecture.md）。

> **8001 仿真平台通道已于 2026-11-25 退役**（`NMCPS-ADR-0027` §4 R8）：`/api/sim/**`、`runtimeConfig.simulator`、`SIMULATOR_ROUTES`、openapi 快照与 `check:bff` 第 ⑨ 组一次删净，不留别名、不双写。下表只描述现行通道；退役理由与影响面见 ADR。

### 6.1 通道形态

| 段位 | 落点 | 约束 |
| :--- | :--- | :--- |
| 配置 | `nuxt.config.ts` → `runtimeConfig.mininet` | `{ baseUrl, instances, token, timeoutMs, longTimeoutMs }`，可被 `NUXT_MININET_*` 覆盖；`baseUrl` 为空＝**通道未启用**，不是错误；配了 `instances` 后未命中的租户一律 503 `tenant_runtime_unavailable`，**不回退全局 `baseUrl`** |
| 读配置 | `layers/scenario/server/utils/bff/mininetConfig.ts` | 按租户解析实例（`baseUrl` 去尾斜杠、租户作用域失败关闭），缺省值集中一处 |
| 出站 | `layers/scenario/server/utils/bff/mininet.ts`（经 `[...slug].ts` 调用） | 独立 `$fetch`；读端点 15s、长时端点走 `longTimeoutMs`；入口凭据只以 `x-lab-token` 头带出，不进查询串 |
| 路由 | `layers/scenario/server/api/mininet/[...slug].ts` | 会话（401/503）→ 路径（400/404/405）→ 权限位（403 `lab_permission_denied`）→ 台账（404 `lab_resource_not_found`）→ 审计 → 加锁 → 出站；写操作审计先行，同一网络只允许一个在途写（409） |
| 白名单 | `layers/scenario/shared/constants/mininetRoutes.ts` | 逐条 `{ method, template, upstream, permissions }`；`{param}` 模板匹配，非前缀放行；未登记路径 404 `bff_resource_not_allowed`，动词不符 405 `bff_method_not_allowed`，编码穿越 400 `bff_path_invalid` |
| 能力探针 | `layers/scenario/server/api/mininet/channel.get.ts` | 静态路由优先于 `[...slug]`；只回 `{ configured, readOnly, writeEnabled, capabilities, endpointCount, timeoutMs, readinessPath }`，**不回 `baseUrl`**；页面据 `capabilities` 决定入口渲不渲染 |
| WebSocket | `/mininet-ws/*` + `POST /api/mininet/ws-ticket` | 票 60 秒一次性、绑定 `kind` + `target`；浏览器不直连 `:8000`，也不向下发上游地址 |

### 6.2 为什么必须是独立通道

`server/api/[...slug].ts` 的 `proxyToUpstream()` 会读 `nmcps_at` cookie 转成 `Bearer`，并在 401 时触发单飞刷新。实验后端的鉴权是入口凭据（`x-lab-token`）与回环信任，没有 `Bearer` 概念；复用它等于把访问令牌发给一个不认识它的上游，且两侧 401/403 语义不同，误触发刷新会把一次局部失败升级为会话失效。实验后端还带特权操作（终端 / 抓包 / 重建），因此权限位、审计与在途写互斥都在这一通道内闭环，而不是叠在主网关的通用转发上。

### 6.3 白名单哲学

1. **逐端点授权，不做前缀放行**。该上游含命令执行、无头浏览器、凭据轮换等能力，前缀放行等于全开。
2. **只登记页面真正调用的条目**，按能力位（`lab:read` / `lab:create` / `lab:operate` / `lab:delete` / `lab:terminal` / `lab:sniffer`）逐条授权；新增条目须同批更新 `NMCPS-DESIGN-*` 的数据源表。
3. **永久排除项需另立 ADR 才能解锁**：节点内任意命令执行（`execute`）、无头浏览器（`browser`）、完整性巡检（`integrity`）、设备库读写（`devices`）、独立探测工具（`test`）、SNMP 开通（`snmp/onboard`）、外部监控栈（`nms/vmagent`）。这些是 `NMCPS-ADR-0027` R1–R7 的裁决，不是「还没做」。

白名单不是手抄常量：`check:lab-bff` ⓪ 按「24 条查询 + 40 条写 = 64」逐行对账，`check:engines` / `check:simulation` 守卫引擎面与外置后端；新增或改名端点必须同批改白名单与断言。

### 6.4 写能力位

通道没有「全局写开关」这种粗粒度布尔：写能力由**端点声明的权限位 + 会话持有的能力位**共同决定。页面先读 `GET /api/mininet/channel` 的 `capabilities`，未授权的动作不渲染、也不发请求；BFF 的 403 `lab_permission_denied` 是竞态兜底与唯一权限边界。写操作仍受三条约束——出站头白名单只有 `accept` / `content-type` / `x-lab-token`（不转发客户端的 `authorization` / cookie）；每次写调用先写一行**结构化审计**（`.data/audit/lab-audit-<日期>.jsonl`，方法 / 路径 / 状态 / 耗时 / `requestId` / 客户端 IP，**不含请求体**），审计写失败即 503 `audit_unavailable`，绝不「先做后补」；同一网络只允许一个在途写（409 `lab_operation_in_progress`），避免两个页面同时改一张网。

### 6.5 就绪分离

`/ready` 只反映主上游。实验后端不可达**不得**让 `/ready` 变红——它只影响依赖它的页面，页面局部降级（拓扑监控页退化为「仅 8888 静态拓扑」），避免可选上游的抖动升级成整站不可用。未配 `baseUrl` 时 `/api/mininet/**` 返回 503 `mininet_not_configured`，与「未配主上游」同口径。失败词汇集中在 `shared/constants/upstreamReasons.ts` 的 `MININET_MESSAGES`（`notConfigured` / `unreachable` / `timeout` / `baseInvalid` / `tenantRuntimeUnavailable` / `resourceNotFound` / `permissionDenied` …），前端据 message 而非状态码区分「通道没开」「租户没有实例」「台账没有这张网」与「实验后端挂了」。

页面对这三件事分开呈现（`NMCPS-DESIGN-001` §八）：`disabled`（部署形态：没有实例）、`empty`（使用形态：还没有实验网络，404 `lab_resource_not_found`）都不挂告警条，只有真读失败才 `unreachable`。

### 6.6 与存储分层的关系

实验后端是**零存储数据源**：读到的运行时状态（节点、链路、运行态、流表）只在请求生命周期内存在，BFF 只把「这张网是谁的」写进本地台账（`.data/lab-ledger.json`，属控制面元数据，不是数据副本），不回写 RDBMS / TSDB；控制指令直接转发给实验后端，BFF 只做权限、审计与互斥。§三 的存储分层因此不变——实验数据不参与历史留存，需要留痕的指标仍由主上游 `/metric/*` 提供。

### 6.7 守卫

退役后本通道不挂在 `check:bff` 的 ⑨ 组上（那组随 `/api/sim/**` 一起删除），改由三套自检覆盖：

| 自检 | 覆盖 |
| :--- | :--- |
| `pnpm check:lab-bff` | ⓪ 白名单计数与逐行对账；会话 / 台账归属 / 权限位 / 审计失败关闭 / 在途写 409 / WebSocket 票；页面读路径与写端点 |
| `pnpm check:simulation` / `pnpm check:engines` | 外置后端的会话面语义与引擎层隔离（`import mininet` 只在 `engines/` + 冻结的 legacy 文件） |
| `pnpm check:ui` | 页面侧：能力位裁剪、`disabled` / `empty` / `unreachable` 三态、链路动作端到端（假上游记录上游实收） |

---

## 七、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化数据源架构（分类、存储分层、云边数据适配层、数据流转）。 |
| 2026-11-05 | 0.3.0 | **落码前义务 4 已履行：⑨ 组守卫随 P1 代码落地（`pnpm check:bff` 127/127）**。① 新增 `scripts/fixtures/simulator-openapi.json`——上游 `/openapi.json` 的机械投影（113 条路径 → 动词列表 + `_meta.source/capturedAt`），刷新只有 `NUXT_SIMULATOR_BASE_URL=<上游> pnpm check:bff --refresh-simulator-snapshot` 一个入口，`capturedAt` 超 180 天只 `⚠️` 不判红；② `check:bff` 增第 ⑨ 组 21 个检查点，逐条对应 ⑨-1~⑨-6（见 §6.7 表），假仿真平台 `startSimulator()`（`scripts/lib/bff-harness.mjs`）在**上游侧**记录请求头，用于取证「出站不带 `authorization`、不把 `nmcps_at` 转 Bearer」；③ §6.1 路由行补 `server/api/sim/index.ts`：`/api/sim` 无路径段回 400 `bff_path_missing`，否则会落到主网关得 404，把「少写了路径」误报成「路径不允许」；④ §6.5 补 `SIMULATOR_MESSAGES` 词汇表；⑤ 反向验证：把白名单一条模板改成 `/api/network/stats-v2`，⑨-6 立刻点名该条变红。 |
| 2026-11-06 | 0.4.0 | **写入口开通后写闸前移到页面**：§6.1 新增能力探针行 `server/api/sim/channel.get.ts`（静态路由优先于 catch-all 通道，只回 `configured` / `writeEnabled` / `timeoutMs` / `readinessPath`，**不回 `baseUrl`**）；§6.4 把「记一条结构化日志」升级为**单行 JSON 审计行** `{"event":"simulator.write",…}`（含 `path` / `requestId` / `clientIp`，仍不含请求体），并写明审计行不带操作者身份的原因与对齐方式（身份 cookie 作用域是 `/api/auth`，按 `requestId` 与网关访问日志对齐）；`allowWrite=false` 时页面零写请求，BFF 的 405 退化为「绕过前端」的第二道闸。`check:ui` 第 11 段随之扩到 `139/139`（新增 A9 与能力探针不泄露地址的断言）。 |
| 2026-11-25 | 0.5.0 | **第二出站通道换人：8001 仿真平台退役，登记 Mininet 实验后端（`NMCPS-ADR-0027` R8 第 4 条）**。① §6 整章重写为 `/api/mininet/**`：配置（`runtimeConfig.mininet` 的 `baseUrl` / `instances`，租户未命中即 503 `tenant_runtime_unavailable`，不回退全局基址）、读配置（`layers/scenario/server/utils/bff/mininetConfig.ts`）、出站（`mininet.ts`，入口凭据只走 `x-lab-token`）、路由与白名单（`layers/scenario/server/api/mininet/[...slug].ts` + `mininetRoutes.ts`，未登记 404 / 动词不符 405 / 穿越 400）、能力探针（`GET /api/mininet/channel`，只回 `capabilities` 等位、不回 `baseUrl`）与 WebSocket（一次性票 + `/mininet-ws/*`）。② 写开关改成**能力位**：没有 `allowWrite` 布尔；页面按 `capabilities` 裁剪，BFF 403 是唯一权限边界；审计先行（写盘失败 503 `audit_unavailable`）、同网在途写 409。③ 就绪分离保留：实验后端不可达不让 `/ready` 变红；`disabled` / `empty` / `unreachable` 三态分别对应「没有实例」「还没有实验网络」「真读失败」。④ 守卫换组：`check:bff` 第 ⑨ 组（21 个检查点、`simulator-openapi.json` 快照、`--refresh-simulator-snapshot`）随 `/api/sim/**`、`simulatorRoutes.ts`、`simConfig.ts` / `simulator.ts`、`SIMULATOR_MESSAGES` 与 `nuxt.config.ts` 的 `simulator` 段一次删净；覆盖改由 `check:lab-bff` / `check:simulation` / `check:engines` / `check:ui` 分担。⑤ §二 分类行与 §五 流转说明同步改名。 |
