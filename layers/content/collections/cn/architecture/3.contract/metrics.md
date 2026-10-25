---
docId: NMCPS-CONTRACT-002
title: "指标契约"
description: "指标契约（contract.metrics）的 Tier 3 契约基准：监控指标的类型（counter/gauge/duration…）、可查询性三分类（numeric/text/collector）、指标目录条目与数据点结构。本文是 contract.metrics 域的唯一权威。"
excerpt: "监控指标的类型、可查询性三分类、目录条目与数据点结构的契约基准。"
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
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-002
  - NMCPS-DESIGN-001
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
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

## 六、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化指标契约（指标类型、可查询性三分类、目录条目、数据点结构）。 |
