---
docId: NMCPS-CONTRACT-002
title: "指标契约"
description: "指标契约（contract.metrics）的 Tier 3 契约基准：监控指标的类型（counter/gauge/duration…）、可查询性三分类（numeric/text/collector）、指标目录条目与数据点结构，以及 `/metric/datapoint` 的 VM matrix → 前端序列取数口径。本文是 contract.metrics 域的唯一权威。"
excerpt: "监控指标类型、可查询性三分类、目录条目、数据点结构与 datapoint 取数口径的契约基准。"
keywords:
  - "contract"
  - "metrics"
  - "指标"
  - "契约"
tier: 3
authority: normative
scope:
  - contract.metrics
status: baseline
version: 0.3.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-002
  - NMCPS-DESIGN-001
createdAt: "2026-10-25"
updatedAt: "2026-11-06"
icon: "carbon:chart-line"
tags:
  - "契约"
  - "指标"
  - "监控"
---

# 指标契约（NMCPS-CONTRACT-002）

> **本文职责**：`contract.metrics` 域的唯一权威，定义监控指标契约——指标类型、可查询性分类、目录条目与数据点结构。指标存储见 `NMCPS-ARCH-002`，拓扑监控消费见 `NMCPS-DESIGN-001`。
> **目标读者**：实施工程师 / AI 助手。

---

## 一、定位

指标契约是监控数据链的「度量衡」：统一指标的类型、可查询性、目录与数据点格式，让采集、存储、展示三层对齐同一套语义，杜绝「选了个文本指标却看到一条直线」之类错配。

---

## 二、指标类型（MetricType）

由 SNMP `dataType` 派生，供速率自动判定与单位格式化：

```ts
export type MetricType = 'counter' | 'gauge' | 'duration' | 'string' | 'event' | 'other'
```

| 取值 | 语义 |
| :--- | :--- |
| counter | 单调递增计数（可算速率） |
| gauge | 瞬时值（如 CPU 占用率） |
| duration | 时长 |
| string | 文本值 |
| event | 事件 |
| other | 其它 |

---

## 三、可查询性三分类（MetricCatalogKind）

```ts
export type MetricCatalogKind = 'numeric' | 'text' | 'collector'
```

| 取值 | 语义 | 前端处理 |
| :--- | :--- | :--- |
| numeric | 可绘图：数值通道 | 可选、可绘图 |
| text | 文本载体：落在同名标签、`value` 恒 1 | 可见但不可选 |
| collector | 采集器自监控（`up` / `scrape_*`） | 非设备业务指标 |

---

## 四、指标目录条目（MetricCatalogItem）

```ts
export interface MetricCatalogItem {
  code: string
  cn_name: string
  en_name: string
  category: string
  unit: string
  metric_type: MetricType
  description: string
  kind: MetricCatalogKind
  selectable: boolean      // = kind === 'numeric'
  has_series: boolean | null
  meta_source: 'l1' | 'backend' | 'name-only'
}
```

---

## 五、数据点（MetricDatapoint）

```ts
export interface MetricDatapoint {
  metric: Record<string, string>   // 标签键为 metric（含 __name__ / instance / ip）
  value?: [number, string]         // 实时单点（Unix 秒 + 字符串值）
  values?: Array<[number, string]> // 时序序列
}
```

约束：采样值恒为字符串，消费方须解包元组后转 `number`；`realtime` 用 `value`、`range` 用 `values`（不并存）；无数据 ⇒ `results = []`（不补 0 值点）。

---

## 六、`/metric/datapoint` 取数口径（VM matrix → 前端序列）

本节的契约**唯一事实源**是网关 `openapi.json`（2026-11-05 复核，127 条路径）中的 `GET /api/v1/metric/datapoint` 与 `metric_ListDatapointResp` / `metric_Datapoint` 两个 schema。展示侧消费见 `NMCPS-DESIGN-001`，通道与缓存见 `NMCPS-ARCH-002`。

### 6.1 请求参数

| 参数 | 类型 | 口径 |
| :--- | :--- | :--- |
| `mode` | `'realtime' \| 'range'` | 必填语义：决定响应里出现 `value` 还是 `values`；前端**一次请求只用一种**，不在同一面板混用 |
| `mgmt_ip` / `metric_code` | string | 单设备单指标走这两个；交给 8888 的永远是**设备管理 IP**，不是节点 id |
| `ips` / `codes` | string（逗号分隔） | 批量取数；批量时响应回显 `mgmt_ip` / `metric_code` 为 `null`（**禁空串**），前端不得靠回显判断单点/批量，只认自己的请求参数 |
| `from` / `to` | string | 请求侧按 ISO 字符串发；响应回显是**解析后的整数 Unix 秒**——两侧类型不同，禁止把响应的 `from` 直接当请求 `from` 复用 |
| `step` | integer（秒） | 聚合步长；省略则由上游决定，前端只额外做**显示级**降采样（§6.6），不改存储口径 |
| `rate` | boolean | 见 §6.5 |

### 6.2 响应信封

```ts
export interface MetricDatapointResponse {
  code: number                     // 0 = 成功；非 0 为上游业务错误码
  message: string                  // 上游原文，逐字展示，不本地化、不改写
  data: {
    mode: 'realtime' | 'range'
    mgmt_ip: string | null         // 批量 ⇒ null（禁空串）
    metric_code: string | null
    rate: boolean
    from?: number                  // 仅 range：整数 Unix 秒
    to?: number                    // 仅 range：整数 Unix 秒
    step?: number                  // 仅 range：步长秒
    results: MetricDatapoint[]
  }
}
```

`MetricDatapoint` 见 §五：标签键是 `metric`（不是 `labels`），点对恒为 `[unix秒, 字符串值]`。

### 6.3 点对解包（硬约束）

1. **值恒为字符串**：采样值 `"1234.5"` 必须解包后 `Number()`；禁止把字符串直接送进比较、排序或图表比例尺（`"9" > "10"`）。
2. **非法点丢弃**：`Number.isFinite(Number(v))` 为 `false`（`""` / `"NaN"` / `null`）时丢弃该点并计入一次「丢弃计数」，**不得补 0**、不得插值。
3. **时间单位**：点对首元素是 **Unix 秒**，转毫秒由展示层统一乘 1000；禁止再按本地时区解析字符串。

### 6.4 realtime 与 range 互斥

- `mode=realtime` ⇒ 读 `value`（单点）；`mode=range` ⇒ 读 `values`（序列）。两者**不并存**，前端按 `mode` 只读其一，另一个缺失是正常的。
- `results = []` 是**合法空**（该时段确实无数据）：渲染「该时段无数据」空态，绝不画一条 0 值直线。

### 6.5 `rate` 的判定

`rate=true` 只对 `MetricType === 'counter'` 有意义（§二），且由用户在图表上显式勾选「速率」。`gauge` / `duration` / `string` / `event` 恒传 `false`。类型判定只依据目录条目（§四），**禁止从 `metric_code` 命名猜测**。

### 6.6 序列规范化管线（顺序固定、每步纯函数）

`解包 → 丢弃非法点 → 按 ts 升序 → 同 ts 去重（保留最后一条）→ 单位与小数位取目录条目 → 像素级降采样 → 渲染`

- 每一步是 `app/utils/chart/*` 的无状态纯函数，输入输出都是点数组，可单测；首个落点 `app/utils/chart/metricSeries.ts`（`unpackSeries` / `sortAndDedupeSeries` / `normalizeMetricSeries` / `downsampleSeries` / `seriesExtent`）。
- 降采样只在点数 > 2 × 画布像素列宽时触发，按列保留 **min/max**（保住毛刺），不取平均。
- 单位与小数位只影响**显示**：`unit` / `metric_type` 来自目录条目，缺失则如实显示原值不加单位。

### 6.7 失败语义

| 场景 | 契约 |
| :--- | :--- |
| `code !== 0` | 视为失败：`UAlert` 展示上游 `message` 原文 + 重试按钮；不静默降级为「无数据」 |
| 网络/超时 | 保留上一次成功数据并标记 stale（时间戳可见），不把面板清空成空态 |
| 401 / `40101` | 走会话刷新流程（`NMCPS-CONTRACT-001` 的 auth 契约），面板不单独处理登录 |
| 目录条目标 `has_series: false` | 该指标不进入折线面板（选它只显示最新单点值），避免「选了文本指标看到一条直线」 |

### 6.8 断言（供 `check:ui` 后续覆盖）

| # | 断言 |
| :--- | :--- |
| S1 | `results: []` 渲染空态文案，且 DOM 中没有 0 值折线 |
| S2 | 值全为字符串时，播放的数值序列与 `Number()` 后一致（排序、最大值） |
| S3 | `code !== 0` 时出现 `UAlert` 且文案等于上游 `message` 原文 |

---

## 七、`/metric/name` 指标名清单（单设备）

`/metric/datapoint` 的 `metric_code` 只能来自清单，不允许按命名猜。本层只用清单本身，**不做类型三分类**（那需要目录 join + 字典，属指标页 P1；缺口登记在 `NMCPS-DESIGN-001` §6.5）。

```ts
export interface MetricNameData {
  mgmt_ip?: string | null        // 未传 mgmt_ip 时回显 null（禁空串）
  ips?: string[] | null
  metrics?: RawMetricItem[] | null
}
export type RawMetricItem = string | RawMetricEntry   // 双形态（缺口 API-G12）
export interface RawMetricEntry {
  metric_code?: string
  metric_name?: string
  metric_group?: string
  unit?: string
  data_type?: string
  description?: string
}
```

| 规则 | 口径 |
| :--- | :--- |
| 请求 | `GET /metric/name?mgmt_ip=<设备管理 IP>`（走 BFF 网关：`/api/metric/name`） |
| 条目形态 | 新路径回**字符串数组**、旧路径回**对象数组**；归一只取 `metric_code` 再兜 `metric_name`，两种都要吃得下 |
| 采集器命名空间 | `up` / `scrape_*` 属 §三 `collector`，**不进业务指标集**；清单首项可能正是它们，挑选时跳过 |
| 首项选取 | `monitor` 详情栏只画清单里**第一个非 collector 条目**，不按名字挑（`cpu` 子串不等于 `gauge`） |
| 空清单 | 是合法空（该设备暂无可查指标），渲染空态文案，不打 `/metric/datapoint` |
| 类型落点 | `shared/types/metric.ts`（`MetricNameData` / `RawMetricItem` / `RawMetricEntry`） |

---

## 八、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化指标契约（指标类型、可查询性三分类、目录条目、数据点结构）。 |
| 2026-11-05 | 0.2.0 | 增「§六 `/metric/datapoint` 取数口径」：登记请求参数（含 `ips` / `codes` 批量与 `from` / `to` 两侧类型差异）、响应信封（`code` / `message` / `data`，批量回显 `null`）、点对解包硬约束（字符串值必须数值化、非法点丢弃不补 0）、realtime/range 互斥、`rate` 判定、规范化管线（解包→升序→去重→格式化→像素降采样）、失败语义与三条断言。按 ADR-0019 §七 义务 3 落地。 |
| 2026-11-06 | 0.3.0 | **增「§七 `/metric/name` 指标名清单」并落地首个消费面**：登记请求（`mgmt_ip`）、`MetricNameData` 形状、`RawMetricItem` 双形态（字符串 / 对象，缺口 API-G12）、采集器命名空间跳过规则、首项选取与空清单语义；`/metric/datapoint` 的 `metric_code` 只从清单来，不按命名猜类型。§6.6 的管线注明首个纯函数落点 `app/utils/chart/metricSeries.ts`（空串必须显式判掉：`Number("")` 是 `0`，会把「没采到」画成 0 值线）。类型落点 `shared/types/metric.ts` 同期补齐。 |