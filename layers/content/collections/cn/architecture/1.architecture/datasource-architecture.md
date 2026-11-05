---
docId: NMCPS-ARCH-002
title: "数据源架构"
description: "数据源（arch.datasource）的 Tier 1 架构基准：数据源分类（设备采集/指标/告警/资产配置）、存储分层（RDBMS 控制 + TSDB 时序）、云端/边缘数据适配层、统一数据流转，以及第二数据源（仿真平台）的独立通道、白名单与写开关。本文是 arch.datasource 域的唯一权威。"
excerpt: "数据源分类、RDBMS+TSDB 存储分层、云边数据适配层与仿真平台第二通道的数据源架构基准。"
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
version: 0.2.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-10-25"
updatedAt: "2026-11-05"
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
| 仿真平台运行时 | 仿真网络里的节点 / 链路 / 会话实时状态与控制入口（可选） | 实时，不落库 | BFF 直读直发（见 §六） |

> 前四类是**需要存储**的数据源；第五类是**零存储**的可选上游，独立通道、独立就绪口径，缺它时页面局部降级而非不可用。

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

仿真平台是**第二条出站通道**（见 §六），不走上图的采集链路，也不写入任何存储层：它提供「当前正在跑的仿真网络」的实时状态与控制入口，BFF 在请求期内读取、归一为 `ApiResponse` 返回，不做缓存与回写。

---

## 六、第二数据源：仿真平台

BFF（Nitro）有且只有两条出站通道：主上游（`runtimeConfig.bff.upstreamBase`，NMS 统一网关）与可选上游（`runtimeConfig.simulator.baseUrl`，混合网络仿真平台）。跨层裁决、实测证据与被否决选项见 ADR-0019 §四；本节只固化架构级约束，字段级契约归 `NMCPS-CONTRACT-001`。

### 6.1 通道形态

| 段位 | 落点 | 约束 |
| :--- | :--- | :--- |
| 配置 | `nuxt.config.ts` → `runtimeConfig.simulator` | `{ baseUrl, allowWrite, timeoutMs, readinessPath }`，全部可被 `NUXT_SIMULATOR_*` 覆盖；`baseUrl` 为空＝**通道未启用**，不是错误 |
| 读配置 | `server/utils/bff/simConfig.ts` | 与 `getBffConfig()` 同形：缺省值集中一处、`baseUrl` 去尾斜杠、`allowWrite` 严格布尔 |
| 出站 | `server/utils/bff/simulator.ts` | 独立 `$fetch` 实例；超时与 `AbortSignal`；响应归一为 `ApiResponse` |
| 路由 | `server/api/sim/[...slug].ts` | 先过白名单再出站；未命中 → 404 `bff_resource_not_allowed`，动词不符 → 405 |
| 白名单 | `shared/constants/simulatorRoutes.ts` | 逐条 `{ method, template, write }`；`{param}` 模板匹配，非前缀放行 |

### 6.2 为什么必须是独立通道

`server/api/[...slug].ts` 的 `proxyToUpstream()` 会读 `nmcps_at` cookie 转成 `Bearer`，并在 401 时触发单飞刷新。仿真平台实测无需鉴权头，复用它等于把访问令牌发给一个没有鉴权能力的上游；且两侧 401/403 语义不同，误触发刷新会把一次局部失败升级为会话失效。

### 6.3 白名单哲学

1. **逐端点授权，不做前缀放行**。该上游含命令执行、无头浏览器、凭据轮换等端点，前缀放行等于全开。
2. **只登记页面真正调用的条目**，按层归档（拓扑监控 / 设备组网 / 场景筹划 / 传输管控 / 频谱管控 / 系统全景）；新增条目须同批更新 `NMCPS-DESIGN-*` 的数据源表。
3. **永久排除项需另立 ADR 才能解锁**：`POST /api/network/nodes/{node_id}/execute`（节点内任意命令执行）、`/api/browser/**`（无头浏览器与代理，兼 SSRF 面）、`/api/integrity/watch/**`（长驻守护任务）、`/api/devices/clear`、`/api/test/**`、`/api/snmp/onboard/**`、`/api/nms/vmagent/**`。

白名单不是手抄常量：它以仿真平台 `/openapi.json` 为机械来源，`check:bff` ⑨-6 断言「白名单 ⊆ openapi `paths`」，上游改名、漏登记、模板写错都能被点出来（快照 `info.version` 过期只告警不红，避免上游小版本把 CI 拖红）。

### 6.4 写开关

`allowWrite` 默认 `false`：全部 `write: true` 端点直接 405，页面以只读态呈现并标注「仿真控制未启用」。开启后仍受三条约束——出站头白名单只有 `accept` / `content-type`（**不注入 `authorization`**、不读 `nmcps_at`）；每次写调用在 BFF 记一条结构化日志（`sim write <method> <template> <status> <duration>`，不含请求体）；写操作不落任何本地存储，BFF 不持有第二本账。

### 6.5 就绪分离

`/ready` 只反映主上游。仿真平台不可达**不得**让 `/ready` 变红——它只影响依赖它的页面，页面局部降级（拓扑页退化为「仅 8888 静态拓扑」），避免可选上游的抖动升级成整站不可用。未配 `baseUrl` 时 `/api/sim/**` 返回 503 `simulator_not_configured`，与「未配主上游」同口径。

### 6.6 与存储分层的关系

仿真平台是**零存储数据源**：读到的运行时状态（节点、链路、会话）只在请求生命周期内存在，不回写 RDBMS / TSDB；控制指令直接转发给仿真引擎，BFF 只做白名单与日志。§三 的存储分层因此不变——仿真数据不参与历史留存，需要留痕的指标仍由主上游 `/metric/*` 提供。

### 6.7 守卫（随 P1 落码实现）

`check:bff` 第 ⑨ 组六条断言：未配 → 503 且信封为 `ApiResponse`；白名单内到达假上游、白名单外 404、动词不符 405；路径穿越（`..`、`%2e%2e`、段内含 `/`）→ 400；`allowWrite: false` 时写端点 405、`true` 时到达假上游；出站头不含 `authorization` 且不读 `nmcps_at`；白名单 ⊆ `/openapi.json` 快照。断言与代码同批落地，未实现前不得在文档里标为已通过。

---

## 七、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化数据源架构（分类、存储分层、云边数据适配层、数据流转）。 |
| 2026-11-05 | 0.2.0 | 增「§六 第二数据源：仿真平台」：通道形态（`runtimeConfig.simulator` / `simConfig.ts` / `simulator.ts` / `server/api/sim/**` / `simulatorRoutes.ts`）、为何必须独立通道（Bearer 不外发、401 语义分离）、白名单哲学（逐端点、按层归档、永久排除七项、`openapi.json` 机械来源）、写开关（`allowWrite` 默认 false、日志、不留第二本账）、就绪分离（仿真不可达不影响 `/ready`）、零存储定位与 ⑨ 组守卫；§二 增「仿真平台运行时」一行，§五 补第二通道说明。按 ADR-0019 §七 义务 2 落地。 |
