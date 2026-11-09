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
version: 0.7.1
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-002
  - NMCPS-DESIGN-001
createdAt: "2026-10-25"
updatedAt: "2026-11-08"
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
  meta_source: 'l1' | 'backend' | 'name-only' | 'catalog-only'
}
```

The fourth `meta_source` value `catalog-only` comes out of the union candidate set in §8.6: the name list did not report this name, only catalog evidence exists. `has_series` still records **catalog evidence only** (`null` = the catalog does not say); it is never filled with `false` because "the name list did not report it" — that would hit rule 2 of §8.3 and turn the whole catalog into `text`.

---

## 5. Datapoint (MetricDatapoint)

```ts
export interface MetricDatapoint {
  metric: Record<string, string>   // label map (see the table below)
  value?: [number, string]         // realtime single point (Unix second + string value)
  values?: Array<[number, string]> // time-series sequence
}
```

Constraints: sample values are always strings (unpack the tuple then cast to `number`); `realtime` uses `value`, `range` uses `values` (mutually exclusive); no data ⇒ `results = []` (no zero-fill).

**Measured label set** (re-checked 2026-11-06 against the live upstream `192.168.1.55:8888`, `10.0.0.249` × `ifInOctets` / `ifOperStatus` / `sysUpTime`):

| Label | When it appears | Purpose |
| :--- | :--- | :--- |
| `instance` / `ip` | always | the device management IP — use it to confirm "this series really belongs to that device" |
| `__name__` | **only when `rate=false`**; a `rate=true` VM result carries none | never identify a metric by `__name__` (it is absent in rate mode) |
| `ifIndex` | **interface-level metrics only** (`ifInOctets` / `ifOperStatus` …), value is the interface index as a string | the link page's interface dimension (§6.9) |
| `job` | always | one device may be scraped by several jobs (`snmp_devices` / `wireless_devices`) ⇒ the de-duplication key (§6.9) |
| `sys_name` / `auth` / `node_uuid` | depends on the scraping job | display fallbacks only, **never** part of the series identity |

> `results` is **not always a single entry**: a `range` request for one `mgmt_ip` + `metric_code` measured 2 results (device-level metric, two jobs) up to 4 results (interface-level metric, 2 `ifIndex` × 2 jobs). The old "take `results[0]`" behaviour was an unmeasured assumption and is replaced by §6.9.

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

These semantics hold identically on **both entries** (the `link-metrics` link detail and the `device-metrics` device detail, which share the same `useMetricSeries` kernel), and a **pure failure renders no chart at all**: with no previously successful series to keep, the chart container is not rendered, because a "no collected data in this window" line above a "fetch failed" alert contradicts itself (the first says nothing was scraped, the second says the fetch did not succeed). Only a re-fetch of the *same* device keeps the polyline and adds a stale note. Since 2026-11-08 `monitor` is no longer a third entry: it **fetches nothing** (its detail pane offers only the deep-link button that takes the user to `device-metrics`, `NMCPS-DESIGN-001` §6.5), so the "not scraped vs not fetched" contradiction has nowhere to land on the monitor page — it renders neither an error box nor empty-state copy.

### 6.8 Assertions (for later `check:ui` coverage)

| # | Assertion |
| :--- | :--- |
| S1 | `results: []` renders the empty-state copy and the DOM contains no zero-valued polyline |
| S2 | With all-string values, the played series matches the `Number()`-converted one (ordering, maximum) |
| S3 | On `code !== 0` a `UAlert` appears whose text equals the upstream `message` verbatim |
| S7 | Both entries (link detail, device detail) show only "verbatim message + retry" on `code !== 0` and render no chart container; a re-fetch of the same device under a network error keeps the polyline and adds a stale note (`check:ui` A13 / A14 / A16); `monitor` is no longer an entry — it fetches nothing, so under a failure it renders neither an error box nor empty-state copy (A15 pins "it invents nothing") |
| S6 | With `ifIndex` supplied only that interface's series is used (its two `job` entries merged first) and its values are distinguishable from those of other interfaces / device-level series; without `ifIndex` the deterministic rule of §6.9 picks the group instead of `results[0]` |

### 6.9 Multiple series: the `ifIndex` interface dimension and same-source de-duplication

`results` may carry **several interfaces of one device** and **several jobs of one interface**, so "one series = one label group" must be resolved explicitly (pure-function landing `selectMetricSeries` in `app/utils/chart/metricSeries.ts`).

| Case | Rule |
| :--- | :--- |
| The caller supplies `ifIndex` (the link page passes the endpoint port index) | Take the group with `metric.ifIndex === String(ifIndex)`; when **no result of that metric carries an `ifIndex` label at all** (a device-level metric) fall back to the device-level group and let the page label it "device-level"; when the metric is interface-scoped but lacks that index ⇒ **empty state** (`no_interface_series`), never a substitute port |
| Several entries with the same `ip` + `ifIndex` (different `job`) | Merge into one by **arithmetic mean per timestamp** (v1 measured the same interface scraped by two jobs; summing would double the traffic) |
| No `ifIndex` supplied (device / monitor pages) | Group by `ifIndex`, take the **lowest group key first**, de-duplicate inside the group as above; a series without an `ifIndex` label is device-level and forms its own group |
| An empty group | Left to the drop counter of §6.3 ②, never zero-filled |

- The grouping key is `ifIndex` alone: `job` / `auth` / `sys_name` / `node_uuid` are scraping-side metadata — the same interface under two jobs **is the same physical object**.
- With `rate=true` the series carries no `__name__`, so grouping and group selection **look at `ifIndex` only**.
- The old "one device + one metric ⇒ a single result, take the first" was an unmeasured assumption and is gone; `check:ui` case A12 pins the rule with a fake upstream returning two `ifIndex` × two `job`.

---

## 7. `/metric/name` Metric Name List (single device)

`/metric/datapoint`'s `metric_code` may only come from the list or the catalog (§8.6), never from guessing at the name. The list only answers "which names did this device report"; **name → type** is decided in §8 (catalog join plus three-way classification), and the picker offers only the entries §8 calls `numeric`.

The list is a **clue, not the only entry point of the candidate set** (§8.6): measured on 2026-11-08, 24 of 36 devices answer `metrics: []` (18 fat APs + 3 access switches + 3 aggregation switches) while the same AP still returns 4 series for `ifInOctets` and `10.0.0.250` returns 2 for `hwEntityCpuUsage` — an empty list only means this query produced no names, **not** that the device has no data. Three same-root causes sit behind the 2026-11-08 report "routers / L2-L3 switches / APs cannot pick a metric, and the ones they do pick draw nothing": disabling the picker on an empty list (24 devices with nothing to pick), reading the catalog's type field under the wrong name (text metrics slip into the options and flatten into a constant 1 line), and fetching only the first `page_size=200` page of a 463-row catalog (the remaining 263 rows pass as `numeric`).

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
| First-entry pick | the metrics page draws the **first non-collector entry** of the list by default and never picks by name (`cpu` as a substring does not mean `gauge`); with the union candidate set this "first" still lands on a name-list hit (§8.6 order). The monitor page no longer does this step (it fetches nothing and only offers the deep-link button) |
| Empty list | **not** "this device has nothing queryable": the candidate set comes from the §8.6 union (the catalog's `numeric` entries), the picker stays usable, the user picks one and then sees whether the window holds any samples, and the page says "candidates come from the metric catalog". The old rule ("empty list ⇒ no `/metric/datapoint`") is retired — the upstream really does have such devices with an empty list and live series (see above) |
| Type location | `shared/types/metric.ts` (`MetricNameData` / `RawMetricItem` / `RawMetricEntry`) |

---

## 8. `/metric/definition` Catalog Join and Three-Way Classification

The §3 taxonomy becomes an **executable decision order** here: `/metric/name` supplies the names, `/metric/definition` supplies the type evidence, and only their join may claim "this one can be drawn as a polyline".

### 8.1 Request

| Parameter | Contract |
| :--- | :--- |
| `page` / `page_size` | backend defaults 1 / 20; the frontend **pages through the whole catalog** (`page_size=200` to start, at most 10 pages). The single-page rule is retired: measured on 2026-11-08 `total=463`, so taking the first page leaves 263 rows missing from the join and rule 3 of §8.3 passes them as `numeric` |
| `metric_group` / `keyword` | **not sent** by this layer: the catalog is the input to a full join, and filtering by group would turn "not found in the filtered page" into a false "text metric" verdict |
| Caching | the catalog is device-independent and fetched once per app session (module-level cache); failures are not cached, the next visit retries |

### 8.2 Entry parsing (must tolerate shape drift)

`metric_listDefinition` only declares the `metric_BaseResp` envelope in the openapi, **the entry fields are not final**, so parsing follows "use it if you can read it":

| Target | Order |
| :--- | :--- |
| Code | `code` → `metric_code` → `name` → `metric_name` (empty strings dropped) |
| Type | `metric_type` → `data_type` (the measured 2026-11-08 field name is `data_type`, values `gauge` / `counter` / `string` / `enum`); values outside `METRIC_TYPES` are dropped (treated as no evidence) |
| Series presence | `has_series`; only a boolean is trusted |
| Enabled flag | rows with `enabled === false` are **dropped** (measured: one row, `hwMstpInstanceID`): a disabled metric collects no points, so listing it only adds an empty chart |
| Display fields | `cn_name` → `metric_name`, `en_name` → `metric_name_en`, then `unit` / `category` / `description`, empty string when missing |

### 8.3 Decision order (fixed, not reorderable)

| # | Evidence | Verdict |
| :---: | :--- | :--- |
| 1 | the name is `up` / `scrape_*` | `collector` |
| 2 | catalog `metric_type ∈ {string, event}`, or `has_series === false` | `text` |
| 3 | everything else (including names the catalog does not carry) | `numeric` |

`selectable = kind === 'numeric'` and the picker lists **only** `selectable` entries (§3: text is visible but not selectable). The name rule always comes first: collector self-monitoring may not even exist in the catalog, so it must not wait for the join.

### 8.4 `meta_source` and degradation

| Value | Meaning |
| :--- | :--- |
| `backend` | the catalog carries this name (complete classification evidence) |
| `name-only` | catalog unavailable, or the catalog lacks this name: only the collector name rule applies, everything else passes as `numeric` |
| `l1` | static dictionary (not wired in this layer; value reserved) |

A failing `GET /metric/definition` **never blocks the chart**: the whole catalog falls back to `name-only`, the page says "metric catalog unavailable", and the series is still fetched. A text or event metric can then still flatten into a straight line — the gap is registered in `NMCPS-DESIGN-001` §6.6, never papered over by guessing at the name.

Measured (2026-11-06, `check:ui` A17 / A18 make the fake upstream answer `/metric/definition` with `code !== 0`): the chart still renders (`data-series-count=2`), no retrieval-error box appears, and not one word of the upstream failure reaches the page; the picker keeps **codes only** (`if_in_octets | cpu_util_pct | sys_name` — `en_name` comes from the catalog, so it disappears too) and `sys_name`, a text metric, really does slip into the options. The degradation notice is therefore not decoration: its consequence is exactly what it warns about, and the assertions state that it appeared.

### 8.5 Assertions

| # | Assertion |
| :---: | :--- |
| S4 | catalog entries with `metric_type=string` never appear among the metric picker options |
| S5 | when `/metric/definition` fails the chart still renders (series present, no retrieval-error box), a "metric catalog unavailable" notice appears without leaking the upstream text, and the picker degrades to name-only judgement (display names gone, text metrics mixed in) (`check:ui` A17–A18) |
| S8 | a catalog row carrying the measured field name (`data_type=string`) never appears among the picker options either (`check:ui` A10q) — S4 pins the fake upstream's `metric_type` shape, this one pins the real field name |
| S9 | with an empty name list (`/metric/name` answers `metrics: []`) the picker stays **usable**, the "candidates come from the metric catalog" notice appears, and the options include metrics that exist only in the catalog (`check:ui` A10p) |

### 8.6 Picker candidate set (union)

The candidate set = **the catalog's `numeric` entries** (device-independent) ∪ **the names in the name list** (§7; names the catalog lacks still pass as `name-only`). The order is fixed: name-list hits (in list order) first, then catalog-only entries (in catalog order). A name-list hit is the likeliest thing the user wants to draw, so the `monitor` pane's "first plottable entry" still lands on a metric the device really reported, instead of being pushed aside by a wireless metric that happens to sit first in the catalog.

| Case | Candidates | Page | Assertions |
| :--- | :--- | :--- | :--- |
| list and catalog both present | the union, name-list hits first | a normal picker | A10 / A11 |
| list empty, catalog present (the 24 devices of §7) | only the catalog's `numeric` entries | picker usable + a "candidates come from the metric catalog" notice; a metric with no points in the window falls into the `no_datapoints` empty state of §6.3, never a forced straight line | A10p |
| catalog failed (§8.4) | only the list (name judgement) | degraded picker + the catalog notice (§8.4) | A17 / A18 |
| both empty | empty | picker disabled + the empty copy (`no_metric_names`) | — |

`has_series` does **not** take part in this union: when the catalog omits the field it is `null`, and filling it with `false` because "the list did not report it" would hit rule 2 of §8.3 and turn the whole catalog into `text` — fixing one gap while opening another.

---

## 9. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: metrics contract (types, queryability, catalog, datapoint). |
| 2026-11-05 | 0.2.0 | Added "§6 `/metric/datapoint` retrieval contract": request parameters (including the `ips` / `codes` batch mode and the `from` / `to` type gap between request and response), response envelope (`code` / `message` / `data`, batch echo as `null`), pair-unpacking hard constraints (string values must be converted, invalid points dropped without zero-fill), realtime/range exclusivity, `rate` decision rules, the normalisation pipeline (unpack → ascending sort → de-duplicate → format → pixel downsampling), failure semantics and three assertions. Lands ADR-0019 §7 obligation 3. |
| 2026-11-06 | 0.3.0 | **Added "§7 `/metric/name` metric name list" together with its first consumer**: the request (`mgmt_ip`), the `MetricNameData` shape, the `RawMetricItem` dual shape (string / object, gap API-G12), the collector-namespace skip rule, the first-entry pick and the empty-list semantics are registered; a `/metric/datapoint` `metric_code` comes only from the list, never from guessing at the name. §6.6 now names the first pure-function landing `app/utils/chart/metricSeries.ts` (the empty string must be rejected explicitly: `Number("")` is `0`, which would draw "not collected" as a zero line). Types landed in `shared/types/metric.ts`. |
| 2026-11-06 | 0.4.0 | **Added "§8 `/metric/definition` catalog join and three-way classification" together with the metric picker**: the request (`page_size=200`, why `metric_group` / `keyword` stay unset, the session-level cache), tolerant entry parsing (code from `code` → `metric_code` → `name`, type only from `METRIC_TYPES`), the fixed decision order (name → collector, catalog → text, everything else → numeric), the three `meta_source` states and the "a missing catalog never blocks the chart" degradation, plus assertions S4 / S5. §7 is reworded accordingly: the list answers names only, the type verdict lives in §8. First consumers: `app/utils/metric/metricCatalog.ts` and `layers/topology/app/composables/useMetricSeries.ts`, landed on `device-metrics` / `link-metrics`. |
| 2026-11-06 | 0.5.0 | **Measurement overturns "`results` is always one entry"; added "§6.9 Multiple series: the `ifIndex` interface dimension and same-source de-duplication"**: a direct probe of the live upstream (`192.168.1.55:8888`, `10.0.0.249` × `ifInOctets` / `ifOperStatus` / `sysUpTime`) shows a `range` request returning 2 results (device-level metric × two scraping jobs) up to 4 results (interface-level metric × 2 `ifIndex` × 2 `job`); the `ifIndex` label really exists (so the interface dimension is available) and `rate=true` results carry no `__name__`. §5 gained the measured label set; §6.9 fixes the three rules (with `ifIndex` keep only that interface, merge same `ip`+`ifIndex` across `job` by per-timestamp mean, without `ifIndex` take the lowest group key), removes the "take `results[0]`" assumption and adds assertion S6. |
| 2026-11-06 | 0.5.1 | **§6.7 gains "identical on all three entries, and a pure failure draws no chart"**: the `device-metrics` and `monitor` panes (the latter through the `useNodeTrend` wrapper) used to keep rendering the chart when the upstream envelope failed, so "no collected data in this window" and "metric fetch failed" appeared side by side — reading as "nothing was scraped" when the truth was "the fetch did not succeed". Now a pure failure renders no chart container at all, and only a re-fetch of the same device keeps the polyline with a stale note. Assertion S7 pins the three entries to the same behaviour. |
| 2026-11-06 | 0.6.0 | **§8.4 / S5 moves from 'stated' to 'measured'**: the catalog failure used to be a sentence with no assertion behind it. The fake upstream now has `__control/catalog-error` (`/metric/definition` answers HTTP 200 + `code !== 0`); A17 asserts the chart still renders (`data-series-count=2`), the "metric catalog unavailable" notice appears, no retrieval-error box shows and nothing of the upstream text reaches the page, while A18 asserts the **consequence** of the degradation: the picker keeps codes only (`en_name` vanishes with the catalog) and `sys_name`, a text metric, really does slip into the options — the notice is not decoration. |
| 2026-11-08 | 0.7.1 | **`monitor` leaves the "three entries": failure semantics now live on the two metrics pages only (§6.7 / S7)**: the monitor detail pane no longer draws a polyline and no longer calls `/api/metric/*` (`useNodeTrend.ts` is deleted, `NMCPS-DESIGN-001` §6.5) — without a series it cannot tell "nothing was scraped" from "the fetch did not succeed", so it renders neither an error box nor empty-state copy (`check:ui` A15 now pins exactly that). §6.7's "identical on all three entries" becomes "identical on both entries", S7 follows, and the note that a monitor deep link lands on the metrics page keeps the §8.6 candidate order. |
| 2026-11-08 | 0.7.0 | **Measurement overturns "an empty list means the device has nothing queryable"; the candidate set becomes a union (§8.6)**: asking `/metric/name` for all 36 devices of the live upstream (`192.168.1.55:8888`) shows 18 fat APs, 3 access switches and 3 aggregation switches answering `metrics: []`, while `10.0.0.249` still returns 4 series for `ifInOctets` and `10.0.0.250` returns 2 for `hwEntityCpuUsage` — an empty list only means this query produced no names, so disabling the picker on it welds 24 devices shut (the user report of 2026-11-08: "routers / L2-L3 switches / APs cannot pick a metric"). The same measurement exposes two same-root causes: ① catalog rows use `metric_code` / `data_type` / `metric_name` / `metric_name_en` while the parser read only `metric_type` / `cn_name` / `en_name`, so 76 `string` metrics (`hwEntityBoardName`, `ifDescr`, …) slip into the router's options and draw a constant 1 line; ② the catalog holds `total=463` rows and the frontend took only the first `page_size=200`, leaving 263 rows as `name-only` passed through as `numeric`. Changes — §4 gains the `catalog-only` `meta_source` (`has_series` still records catalog evidence only, never `false` for "the list did not report it"); §7's empty-list row now hands candidates to §8.6 with the picker usable plus a "candidates come from the metric catalog" notice; §8.1 pages through the whole catalog (at most 10 pages); §8.2 reads `data_type`, `metric_name` / `metric_name_en` and drops `enabled === false` rows; a new §8.6 fixes the union and its order (name-list hits first, catalog-only rows after). Assertions S8 / S9 land as `check:ui` A10q (`data_type=string` rows stay out of the picker) / A10p (an empty list keeps the picker usable and shows the catalog notice), moving the count from 210 to 212. |
