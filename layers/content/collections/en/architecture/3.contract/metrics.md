---
docId: NMCPS-CONTRACT-002
title: "Metrics Contract"
description: "Tier 3 contract baseline for metrics (contract.metrics): metric types (counter/gauge/duration…), queryability classification (numeric/text/collector), catalog entries, and datapoint structure. This is the single authority for the contract.metrics domain."
excerpt: "Metric types, queryability, catalog entries and datapoints."
keywords:
  - "contract"
  - "metrics"
  - "monitoring"
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
  - "Contract"
  - "Metrics"
  - "Monitoring"
---

# Metrics Contract (NMCPS-CONTRACT-002)

> **Responsibility**: single authority for `contract.metrics` — metric types, queryability classification, catalog entries, and datapoint structure. Storage: `NMCPS-ARCH-002`; topology consumption: `NMCPS-DESIGN-001`.
> **Audience**: implementation engineers / AI assistants.

---

## 1. Positioning

The metrics contract is the "yardstick" of the monitoring data chain: it unifies metric types, queryability, catalog and datapoint formats so that collection, storage, and display align on the same semantics — avoiding mismatches like "picking a text metric and seeing a flat line".

---

## 2. Metric Types (MetricType)

Derived from SNMP `dataType`, for automatic rate detection and unit formatting:

```ts
export type MetricType = 'counter' | 'gauge' | 'duration' | 'string' | 'event' | 'other'
```

| Value | Semantics |
| :--- | :--- |
| counter | Monotonic counter (rate computable) |
| gauge | Instantaneous value (e.g. CPU usage) |
| duration | Duration |
| string | Text value |
| event | Event |
| other | Other |

---

## 3. Queryability Classification (MetricCatalogKind)

```ts
export type MetricCatalogKind = 'numeric' | 'text' | 'collector'
```

| Value | Semantics | Frontend |
| :--- | :--- | :--- |
| numeric | Plottable: numeric channel | Selectable, plottable |
| text | Text carrier: value is always 1 | Visible but not selectable |
| collector | Collector self-metrics (`up` / `scrape_*`) | Non-business metric |

---

## 4. Catalog Entry (MetricCatalogItem)

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

## 5. Datapoint (MetricDatapoint)

```ts
export interface MetricDatapoint {
  metric: Record<string, string>   // label key is `metric` (incl. __name__ / instance / ip)
  value?: [number, string]         // realtime single point (Unix second + string value)
  values?: Array<[number, string]> // time-series sequence
}
```

Constraints: sample values are always strings (unpack the tuple then cast to `number`); `realtime` uses `value`, `range` uses `values` (mutually exclusive); no data ⇒ `results = []` (no zero-fill).

---

## 6. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: metrics contract (types, queryability, catalog, datapoint). |
