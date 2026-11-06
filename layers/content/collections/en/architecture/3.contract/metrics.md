---
docId: NMCPS-CONTRACT-002
title: "Metrics Contract"
description: "Tier 3 contract baseline for metrics (contract.metrics): metric types (counter/gauge/duration…), queryability classification (numeric/text/collector), catalog entries, datapoint structure, and the `/metric/datapoint` VM-matrix → front-end-series retrieval contract. This is the single authority for the contract.metrics domain."
excerpt: "Metric types, queryability, catalog entries, datapoints and the datapoint retrieval contract."
keywords:
  - "contract"
  - "metrics"
  - "monitoring"
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

## 6. `/metric/datapoint` Retrieval Contract (VM matrix → front-end series)

The single source of truth for this section is the gateway `openapi.json` (re-checked 2026-11-05, 127 paths): `GET /api/v1/metric/datapoint` plus the `metric_ListDatapointResp` / `metric_Datapoint` schemas. Presentation-side consumption is `NMCPS-DESIGN-001`; channel and caching are `NMCPS-ARCH-002`.

### 6.1 Request parameters

| Parameter | Type | Contract |
| :--- | :--- | :--- |
| `mode` | `'realtime' \| 'range'` | Decides whether the response carries `value` or `values`; **one mode per request**, never mixed inside one panel |
| `mgmt_ip` / `metric_code` | string | For a single device and metric. What goes to 8888 is always the **device management IP**, never a node id |
| `ips` / `codes` | string (comma separated) | Batch retrieval; in batch responses `mgmt_ip` / `metric_code` echo as `null` (**never an empty string**), so never infer single-vs-batch from the echo — use your own request |
| `from` / `to` | string | Send ISO strings; the response echoes **parsed integer Unix seconds** — the two sides differ, so never reuse a response `from` as the next request `from` |
| `step` | integer (seconds) | Aggregation step; omitting it lets the upstream decide. The front end only adds **display-level** downsampling (§6.6) and never changes storage semantics |
| `rate` | boolean | See §6.5 |

### 6.2 Response envelope

```ts
export interface MetricDatapointResponse {
  code: number                     // 0 = success; anything else is an upstream business error
  message: string                  // upstream text, rendered verbatim — never localised or rewritten
  data: {
    mode: 'realtime' | 'range'
    mgmt_ip: string | null         // batch ⇒ null (never an empty string)
    metric_code: string | null
    rate: boolean
    from?: number                  // range only: integer Unix seconds
    to?: number                    // range only: integer Unix seconds
    step?: number                  // range only: step in seconds
    results: MetricDatapoint[]
  }
}
```

`MetricDatapoint` is §5: the label key is `metric` (not `labels`) and every pair is `[unixSeconds, stringValue]`.

### 6.3 Unpacking pairs (hard constraints)

1. **Values are always strings**: a sample `"1234.5"` must be unpacked and passed through `Number()`; never feed the string into comparisons, sorting or a chart scale (`"9" > "10"`).
2. **Drop invalid points**: when `Number.isFinite(Number(v))` is `false` (`""` / `"NaN"` / `null`), drop the point and count one "dropped" event — **never zero-fill**, never interpolate.
3. **Time unit**: the first element is **Unix seconds**; the presentation layer multiplies by 1000. Never parse it as a timezone-bearing date string.

### 6.4 realtime and range are mutually exclusive

- `mode=realtime` ⇒ read `value` (a single point); `mode=range` ⇒ read `values` (a sequence). They **never coexist**: read only the one matching `mode`, the other being absent is normal.
- `results = []` is a **legitimate empty result** (that window really has no data): render a "no data for this window" empty state and never draw a flat zero line.

### 6.5 Deciding `rate`

`rate=true` only means something for `MetricType === 'counter'` (§2) and only when the user explicitly ticks "rate" on the chart. `gauge` / `duration` / `string` / `event` always send `false`. The type is taken from the catalog entry (§4); **never guess it from the `metric_code` name**.

### 6.6 Normalisation pipeline (fixed order, one pure function per step)

`unpack → drop invalid points → sort ascending by ts → de-duplicate equal ts (keep the last) → unit and decimals from the catalog entry → pixel-level downsampling → render`

- Each step is a stateless pure function in `app/utils/chart/*`, taking and returning point arrays, so it is unit-testable; the first landing is `app/utils/chart/metricSeries.ts` (`unpackSeries` / `sortAndDedupeSeries` / `normalizeMetricSeries` / `downsampleSeries` / `seriesExtent`).
- Downsampling only kicks in above 2 × canvas pixel columns and keeps **min/max** per column (preserving spikes); it never averages.
- Unit and decimals affect **display only**: `unit` / `metric_type` come from the catalog entry; when missing, show the raw value with no unit rather than inventing one.

### 6.7 Failure semantics

| Case | Contract |
| :--- | :--- |
| `code !== 0` | Treat as failure: `UAlert` with the upstream `message` verbatim plus a retry button; never silently degrade into "no data" |
| Network / timeout | Keep the last successful data and mark it stale (timestamp visible); never blank the panel into an empty state |
| 401 / `40101` | Go through the session refresh flow (the auth contract in `NMCPS-CONTRACT-001`); panels never handle login themselves |
| Catalog entry says `has_series: false` | That metric never enters a line panel (selecting it shows only the latest single value), avoiding "pick a text metric, see a flat line" |

### 6.8 Assertions (for later `check:ui` coverage)

| # | Assertion |
| :--- | :--- |
| S1 | `results: []` renders the empty-state copy and the DOM contains no zero-valued polyline |
| S2 | With all-string values, the played series matches the `Number()`-converted one (ordering, maximum) |
| S3 | On `code !== 0` a `UAlert` appears whose text equals the upstream `message` verbatim |

---

## 7. `/metric/name` Metric Name List (single device)

`/metric/datapoint`'s `metric_code` may only come from the list, never from guessing at the name. This layer uses the list as-is and **does not** do the three-way classification (that needs the catalog join plus the dictionary and belongs to the metrics pages' P1; the gap is registered in `NMCPS-DESIGN-001` §6.5).

```ts
export interface MetricNameData {
  mgmt_ip?: string | null        // null when mgmt_ip was not sent (empty string forbidden)
  ips?: string[] | null
  metrics?: RawMetricItem[] | null
}
export type RawMetricItem = string | RawMetricEntry   // dual shape (gap API-G12)
export interface RawMetricEntry {
  metric_code?: string
  metric_name?: string
  metric_group?: string
  unit?: string
  data_type?: string
  description?: string
}
```

| Rule | Contract |
| :--- | :--- |
| Request | `GET /metric/name?mgmt_ip=<device management IP>` (through the BFF gateway: `/api/metric/name`) |
| Entry shape | the new path returns a **string array**, the old path an **object array**; normalisation takes `metric_code` and falls back to `metric_name`, so both shapes must be accepted |
| Collector namespace | `up` / `scrape_*` are `collector` (§3) and **never enter the business metric set**; the list may well start with them, so picking skips them |
| First-entry pick | the `monitor` detail pane draws the **first non-collector entry** of the list and never picks by name (`cpu` as a substring does not mean `gauge`) |
| Empty list | a legal empty (the device exposes nothing queryable right now): render the empty copy and do **not** call `/metric/datapoint` |
| Type location | `shared/types/metric.ts` (`MetricNameData` / `RawMetricItem` / `RawMetricEntry`) |

---

## 8. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: metrics contract (types, queryability, catalog, datapoint). |
| 2026-11-05 | 0.2.0 | Added "§6 `/metric/datapoint` retrieval contract": request parameters (including the `ips` / `codes` batch mode and the `from` / `to` type gap between request and response), response envelope (`code` / `message` / `data`, batch echo as `null`), pair-unpacking hard constraints (string values must be converted, invalid points dropped without zero-fill), realtime/range exclusivity, `rate` decision rules, the normalisation pipeline (unpack → ascending sort → de-duplicate → format → pixel downsampling), failure semantics and three assertions. Lands ADR-0019 §7 obligation 3. |
| 2026-11-06 | 0.3.0 | **Added "§7 `/metric/name` metric name list" together with its first consumer**: the request (`mgmt_ip`), the `MetricNameData` shape, the `RawMetricItem` dual shape (string / object, gap API-G12), the collector-namespace skip rule, the first-entry pick and the empty-list semantics are registered; a `/metric/datapoint` `metric_code` comes only from the list, never from guessing at the name. §6.6 now names the first pure-function landing `app/utils/chart/metricSeries.ts` (the empty string must be rejected explicitly: `Number("")` is `0`, which would draw "not collected" as a zero line). Types landed in `shared/types/metric.ts`. |