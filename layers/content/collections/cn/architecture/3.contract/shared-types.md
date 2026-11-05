---
docId: NMCPS-CONTRACT-001
title: "共享类型契约"
description: "共享类型契约（contract.shared-types）的 Tier 3 契约基准：跨模块共享类型的命名规范、目录组织、复用规则与禁 any / null 语义硬约束，登记 `/api/v1/auth` 契约类型（`shared/types/auth.ts`）、仿真平台实体类型（`shared/types/simulator.ts`）与 8888 拓扑图契约（`shared/types/topology.ts`）。本文是 contract.shared-types 域的唯一权威。"
excerpt: "跨模块共享类型的命名规范、目录组织、复用规则与仿真平台 / 拓扑图契约基准。"
keywords:
  - "contract"
  - "shared-types"
  - "类型"
  - "契约"
tier: 3
authority: normative
scope:
  - contract.shared-types
status: baseline
version: 0.4.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-002
createdAt: "2026-10-25"
updatedAt: "2026-11-05"
icon: "carbon:data-class"
tags:
  - "契约"
  - "类型"
  - "共享"
---

# 共享类型契约（NMCPS-CONTRACT-001）

> **本文职责**：`contract.shared-types` 域的唯一权威，定义跨模块共享类型契约——类型如何命名、如何组织、如何复用。数据源架构见 `NMCPS-ARCH-002`，治理规则见 `NMCPS-GOV-001`。
> **目标读者**：实施工程师 / AI 助手。

---

## 一、定位

共享类型契约是跨模块协作的「语言公约」：任何被多个模块（layer）复用的类型，其命名、位置与语义只在本契约定义一次，其余位置一律引用，禁止复制手写。

---

## 二、命名规范

| 对象 | 规范 | 示例 |
| :--- | :--- | :--- |
| 接口/类型 | PascalCase，语义名词 | `MetricDatapoint` |
| 联合类型 | 小写字面量联合 | `MetricType = 'counter' \| 'gauge'` |
| 类型文件 | kebab-case，按域分文件 | `metric.ts` / `topology.ts` |
| 目录 | `shared/types/` | 跨模块唯一入口 |

---

## 三、目录组织

```text
shared/
  types/          # 跨模块共享类型（唯一事实源）
    metric.ts     # 指标契约类型
    topology.ts   # 拓扑契约类型
    iam.ts        # 身份与访问控制类型
    ...
  constants/      # 纯数据常量（docId ↔ 路径映射等）
    docIds.ts
```

`shared/constants/docIds.ts` 是纯数据 + 纯函数（无 Nuxt 别名、无 IO、无副作用），Nuxt 侧与 node 脚本共用。

---

## 四、复用硬约束

1. **禁 `any`**：未知语义一律用 `unknown` 或明确联合类型，禁止 `any` 穿透。
2. **null 语义**：未知/缺失一律 `null`，禁止用 `0`、空串、`'unknown'` 伪造真值；`0` 是合法真值。
3. **单一事实源**：同一类型只在一个文件定义；派生值禁独立赋值（标注「派生，见源头」）。
4. **向前兼容**：新增字段用可选（`?`），删除字段先 `deprecated` 再移除。

---

## 五、现有共享类型

| 类型 | 位置 | 说明 |
| :--- | :--- | :--- |
| `DocId` / `DOC_PATHS` | `shared/constants/docIds.ts` | docId ↔ 路径唯一映射 |
| `LayoutMode` / `UserPreferences` | `layers/user/app/composables/useUserPreferences.ts` | 布局偏好类型 |
| `ApiResponse` / `ApiStatus` / `ApiError` | `shared/types/api.ts` / `shared/utils/apiGuard.ts` | 统一响应信封与类型守卫 |
| `AuthUser` / `AuthTokens` / `AuthLoginPayload` / `AuthLoginResult` / `AuthRefreshResult` / `AuthSessionState` | `shared/types/auth.ts` | `/api/v1/auth` 契约：字段名沿用上游 camelCase（`accountCode` / `accountLevel` / `sessionId`…），**不做蛇形转换**；BFF 只把错误信封的 `msg` 归一为 `message`，业务字段一律透传保真；缺失语义（如登录返回不含 `displayName`）一律填 `null`，不用近义字段顶替 |
| `SimulatorRuntimeInventory` / `SimulatorRuntimeNode` / `SimulatorRuntimeLink` / `SimulatorNetworkStats` / `SimulatorLldpSummary` / `SimulatorLldpNeighbor` / `SimulatorSessionList` / `SimulatorSessionStatus` / `SimulatorMetricsSummary` / `SimulatorMetricsCurrent` | `shared/types/simulator.ts` | 8001 仿真平台实体契约，字段沿用上游 `snake_case`，口径见本契约 §六 |
| `TopologyGraph` / `TopologyGraphNode` / `TopologyGraphLink` / `TopologyCombo` / `TopologyGraphQuery` | `shared/types/topology.ts` | 8888 `GET /topology/graph` 契约：节点 `id` 是管理 IP、`status` 数值口径 `1/2/0`、链路 `bandwidth` 实测全为 `0`，口径见本契约 §七 |

> 随着 S2 领域基准落地，`metric` 等契约类型将迁入 `shared/types/`，本契约随演进同步登记（`topology` 已于 2026-11-05 落盘）。

---

## 六、仿真平台实体契约（`shared/types/simulator.ts`）

8001 仿真平台的实体类型统一落在 `shared/types/simulator.ts`，是 BFF `server/api/sim/**` 出站结果、`NMCPS-DESIGN-*` 页面消费与 `check:bff` 假上游共用的**唯一**类型来源。字段形状取自 2026-11-05 实测响应与 `openapi.json`（113 条路径 / 40 个 schema）。

### 6.1 命名与字段口径（本族例外，需显式登记）

| 规则 | 说明 |
| :--- | :--- |
| **沿用上游 `snake_case`** | 与 `MetricCatalogItem`（`NMCPS-CONTRACT-002`）同口径：上游字段一律原样透传，不做驼峰转换；只有 BFF 自造字段（错误信封的 `message`）例外 |
| **带单位字段保持 `string`** | `bandwidth: "4000Mbps"`、`delay: "2ms"`、`loss: "0%"`；数值化由页面纯函数（`parseBandwidthMbps` / `parseDelayMs` / `parseLossPct`）完成，**类型层不解析** |
| **可空显式 `\| null`** | 实测为 `null` 的字段（`mac_address` / `weaknet_config` / `protocol_config` / `radio` / `real_stats` / `tc` / `scenario`）一律 `\| null`，禁止用可选 `?:` 掩盖「上游明确给了 null」 |
| **未取证子对象不透明** | 未逐字段取证的子对象统一 `SimulatorOpaqueObject = Record<string, unknown>`，禁止 `any` |
| **枚举与线格式分离** | 线格式字段保留 `string`（上游会加取值），另定义联合类型 + 守卫（`SimulatorNodeType` / `SimulatorLinkType` / `SimulatorSessionState`）供页面收窄；守卫必须带 `unknown` 兜底分支 |

### 6.2 实体类型清单

| 类型 | 上游端点 | 说明 |
| :--- | :--- | :--- |
| `SimulatorHealth` | `GET /api/health` | `status` / `app` / `engine_available[]` / `regulatory`（实测 `US`） |
| `SimulatorRuntimeInventory` | `GET /api/network/runtime-inventory` | **运行态唯一入口**：`running` / `scenario` / `overrides` / `nodes[]` / `links[]` |
| `SimulatorRuntimeNode` | 同上 `nodes[]` | 与 8888 节点对齐的键：`id` / `name` / `ip_address`；渲染用 `x` / `y`；状态用 `status` |
| `SimulatorRuntimeLink` | 同上 `links[]` | `source` / `target` + 两端接口；`type` 区分 `wired` / `wireless`；`bandwidth` / `delay` / `loss` 为带单位字符串 |
| `SimulatorNetworkStats` | `GET /api/network/stats` | `nodes_by_type` / `links_by_type` 为**动态键**的 `Record<string, number>`（实测 `router` 3 / `switch` 6 / `ap` 18 / `station` 9） |
| `SimulatorLldpSummary` / `SimulatorLldpNeighbor` | `GET /api/lldp/summary`、`/api/lldp/neighbors/{node_id}` | `mib_oids` 为 `Record<string, string>`；`discovered_at` 为上游本地时间字符串（**不带时区**，禁止直接 `new Date()` 当 UTC 用） |
| `SimulatorSessionList` / `SimulatorSession` / `SimulatorSessionStatus` | `GET /api/simulation/sessions`、`/api/simulation/sessions/{sim_id}/status` | 列表信封 `{ count, items[] }`；`status.build_timing.phases[]` 为启动阶段进度（`msg` / `pct` / `d_s`） |
| `SimulatorMetricsSummary` | `GET /api/metrics/summary/{sim_id}` | `sample_count` / `tick_count` / `avg_utilization_pct` / `avg_rtt_ms` / `avg_loss_pct` |
| `SimulatorMetricsCurrent` / `SimulatorMetricsSample` | `GET /api/metrics/current/{sim_id}` | 逐链路采样：`utilization_pct` / `rtt_ms` / `loss_pct` / `jitter_us` / `*_age_s` / `jitter_valid`；`at` 为上游本地时间字符串 |

### 6.3 关键字段（实测形状，供落码对照）

```ts
export type SimulatorOpaqueObject = Record<string, unknown>

export interface SimulatorRuntimeInventory {
  running: boolean
  scenario: string | null
  overrides: {
    exists: boolean
    updated_at: string | null
    node_count: number
    link_count: number
    topology_count: number
  }
  nodes: SimulatorRuntimeNode[]
  links: SimulatorRuntimeLink[]
}

export interface SimulatorRuntimeNode {
  id: string
  name: string
  type: string                     // router | switch | ap | station | …
  status: string                   // online | offline | …
  x: number | null
  y: number | null
  interfaces: SimulatorOpaqueObject[]
  ip_address: string | null
  mac_address: string | null
  device_type: string
  role: string | null
  ports: Array<{ name: string, ip: string }>
  weaknet_config: SimulatorOpaqueObject | null
  protocol_config: SimulatorOpaqueObject | null
  radio: SimulatorOpaqueObject | null
}

export interface SimulatorRuntimeLink {
  id: string
  source: string
  target: string
  source_interface: string | null
  target_interface: string | null
  type: string                     // wired | wireless
  status: string                   // up | down
  bandwidth: string | null         // "4000Mbps"（保持字符串）
  delay: string | null             // "2ms"
  loss: string | null              // "0%"
  real_stats: SimulatorOpaqueObject | null
  weaknet_config: SimulatorOpaqueObject | null
  protocol_config: SimulatorOpaqueObject | null
  tc: SimulatorOpaqueObject | null
}
```

### 6.4 与 BFF 出站的关系

1. **类型是出站结果的归一形状**：`server/utils/bff/simulator.ts` 只把上游 JSON 包进 `ApiResponse` 信封（`data` 为上述实体），不改字段名、不改量纲、不补默认值。
2. **未配通道时无实体**：`baseUrl` 为空 → `503 simulator_not_configured`，页面拿到的是错误信封而非「空实体」，两者在 UI 上必须区分（空态 vs 未接入态）。
3. **写端点无返回契约**：`POST` / `PATCH` / `DELETE` 只保证 `ApiResponse` 信封；页面只按成功与否 + 随后的 `runtime-inventory` 刷新来渲染，不依赖写端点返回体。

---

## 七、8888 拓扑图契约（`shared/types/topology.ts`）

`/topology/monitor` 的拓扑结构来自主上游 `GET /api/v1/topology/graph`（BFF `/api/topology/graph`）。字段口径取自 1.0 对**同一端点**的只读实测消费（2026-10-14：36 节点 / 47~48 链路 / 3 combos，见 `_reference/nmcps-v1/shared/connector/topologyAdapt.ts` 的 `normalizeTopologyInput()`），与 8001 运行态台账（§六）是两条通道。

| 对象 | 实测形状 | 落码要点 |
| :--- | :--- | :--- |
| 信封 | 可能平铺，也可能包一层 `data`；BFF 网关统一包成 `ApiResponse` 后 `data` 即图对象 | 页面只认 `data`，不再自行解信封 |
| 节点 | `id`（**管理 IP**）/ `name` \| `hostname` \| `label` / `ip` / `category` / `type` / `status` / `tier` / `icon` / `brand` / `color` / `sysDescr` | `id` 是 IP，展示名要按 `name → hostname → label → id` 兜底；`tier` 实测只有 2 / 4 |
| `status` | 数值口径 `1=在线 / 2=告警 / 0=离线`，也会直接给字符串 | 归一在 `app/utils/graph/topologyNormalize.ts`，类型层不猜 |
| 链路 | `source` / `target` / `bandwidth` / `linkType` / `status` / `bandwidth_util_pct` / `sourcePort` / `targetPort` | 两种键名 `edges` / `links` 都出现过；`bandwidth` 实测**全为 0**（真值缺失）⇒ 页面不得把 0 当带宽展示 |
| 组合 | `combos[]`（实测 3 个），字段未逐项取证 | 只按 `id` 计数，不参与布局 |

三条硬约束：

1. **不改字段名、不补默认值**：归一（状态 → 联合类型、`tier` 缺省、展示名兜底）只发生在 `app/utils/graph/topologyNormalize.ts` 这类纯函数里，类型层保留线格式。
2. **`0` 不是缺省**：`bandwidth: 0` 表示上游没测到，不是「零带宽」；本族沿用 §四 的 null 语义，缺失一律 `null`。
3. **契约未取证的部分不设字段**：`combos` 的其余字段、`sysDescr` 的编码都在取证后追加，必须先改本文再改类型（§四 向前兼容）。

---

## 八、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化共享类型契约（命名规范、目录组织、复用硬约束、现有类型清单）。 |
| 2026-10-31 | 0.2.0 | 登记 `shared/types/api.ts` 与 `shared/types/auth.ts`：明确上游字段透传保真、`msg` → `message` 归一、缺失即 `null`。 |
| 2026-11-05 | 0.3.0 | 增「§六 仿真平台实体契约」：登记 `shared/types/simulator.ts` 的类型清单（`SimulatorHealth` / `SimulatorRuntimeInventory` / `SimulatorRuntimeNode` / `SimulatorRuntimeLink` / `SimulatorNetworkStats` / `SimulatorLldpSummary` / `SimulatorLldpNeighbor` / `SimulatorSessionList` / `SimulatorSessionStatus` / `SimulatorMetricsSummary` / `SimulatorMetricsCurrent`），固化本族五条例外口径（snake_case 透传、带单位字段保持 string、可空显式 `\| null`、未取证子对象用 `SimulatorOpaqueObject`、枚举与线格式分离 + `unknown` 兜底），并按 2026-11-05 实测登记关键字段形状。按 ADR-0019 §七 义务 3 落地。 |
| 2026-11-05 | 0.4.0 | 增「§七 8888 拓扑图契约」并落盘 `shared/types/topology.ts`（`TopologyGraph` / `TopologyGraphNode` / `TopologyGraphLink` / `TopologyCombo` / `TopologyGraphQuery` + 三个状态联合）。§五 清单同步登记、`shared/types/simulator.ts` 按 §6.3 实测形状补齐（此前只在文档里登记、文件尚未存在——文档先行的欠账在本次落码时还清）。三条硬约束写进正文：`id` 是管理 IP（对齐 8001 靠 `ip_address`）、`bandwidth: 0` 是「没测到」不是零带宽、`combos` 其余字段取证后再追加。 |
