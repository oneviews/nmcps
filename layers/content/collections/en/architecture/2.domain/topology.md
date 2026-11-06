---
docId: NMCPS-DESIGN-001
title: "Topology Monitoring Domain Baseline"
description: "Tier 2 design baseline for the topology monitoring domain (domain.topology): topology visualization of network devices and links, collection/display of device and link metrics, the target-page list and data sources of the three sub-pages, the graphic shapes of the four in-house renderers, empty and degraded states, and assertable acceptance criteria. This is the single authority for the domain.topology domain."
excerpt: "Topology visualization and device/link metrics, with data sources, graphic shapes, empty states and acceptance assertions."
keywords:
  - "topology"
  - "monitoring"
  - "baseline"
  - "TopologyCanvas"
  - "TrendChart"
tier: 2
authority: normative
scope:
  - domain.topology
status: baseline
version: 0.9.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-001
  - NMCPS-ARCH-002
  - NMCPS-ARCH-006
createdAt: "2026-10-25"
updatedAt: "2026-11-06"
icon: "carbon:cloud-monitoring"
tags:
  - "Domain"
  - "Topology"
  - "Monitoring"
---

# Topology Monitoring Domain Baseline (NMCPS-DESIGN-001)

> **Responsibility**: single authority for `domain.topology` — topology visualization of devices and links, collection/display of monitoring metrics, and the target-page list, data sources, graphic shapes, empty/degraded states and acceptance assertions of the three sub-pages. Collection: `NMCPS-ARCH-001`; storage: `NMCPS-ARCH-002`; page structure and toolbar rules: `NMCPS-ARCH-006`; the in-house-graphics and second-upstream verdicts: `NMCPS-ADR-0019` (layers/content/collections/cn/records/adr/adr-0019.md).
> **Audience**: implementation engineers / AI assistants.

---

## 1. Positioning

Topology monitoring is the "observation plane" of the NMS: it visualizes device nodes and link relationships, monitors device/link metrics in realtime, and supports fault location and capacity planning.

---

## 2. Functional Scope

| Sub-page | Function | 2.0 location |
| :--- | :--- | :--- |
| monitor | Network topology graph and global overview | `layers/topology/app/pages/topology/monitor.vue` |
| link-metrics | Link metrics (bandwidth, latency, loss) | `layers/topology/app/pages/topology/link-metrics.vue` |
| device-metrics | Device metrics (CPU, memory, port traffic) | `layers/topology/app/pages/topology/device-metrics.vue` |

All three pages **share one fetch core**: the topology structure comes from 8888 `/topology/graph` and metric series from `/metric/datapoint`; the pages differ only in whether the selected object is a node or a link, and in which metric codes (`metric_code`) they display.

---

## 3. Key Data Entities

| Entity | Note |
| :--- | :--- |
| Device Node | Routers/switches/firewalls etc. |
| Link | Physical/logical connections between devices |
| Topology | Visual model of nodes + links |
| Metric | Time-series monitoring data (in TSDB) |

---

## 4. Domain Boundary & Dependencies

- **Upstream**: device collection (SNMP, `NMCPS-ARCH-001`), metric storage (TSDB, `NMCPS-ARCH-002`).
- **Consumers**: dashboard (overview), scenario (modeling input).
- **Out of scope**: device config push (device domain), alarm rule management (system domain).

---

## 5. Roadmap

1. Topology graph rendering (Canvas/SVG nodes + links).
2. Device-type icon auto-matching.
3. Realtime metric refresh with alarm linkage.

---

## 6. Data Sources

### 6.1 Primary source (the 8888 unified gateway, through the BFF `[...slug]` gateway, authenticated)

| Purpose | Endpoint (8888 `/api/v1`) | Key parameters | Note |
| :--- | :--- | :--- | :--- |
| Topology structure | `GET /topology/graph` | `tenant_id` / `include_virtual` / `include_status` / `group_by` | measured 36 nodes / 48 links / 3 combos; with `include_status=true` nodes carry their status colour |
| Device ledger (list pane) | `GET /metric/device` | `page` / `page_size` / `device_code` / `codes` / `role` / `vendor` / `status` / `include` | the paged envelope's `total` is the count source |
| Link ledger | `GET /metric/link` | `page` / `page_size` / `link_id` / `device_code` / `medium` / `status` / `include` / `from` / `to` | `from` / `to` are the time window (ISO strings) |
| Metric series | `GET /metric/datapoint` | `mode` / `mgmt_ip` / `metric_code` / `from` / `to` / `step` / `rate` / `ips` / `codes` | returns a VM-style matrix (`metric` labels + `values` pairs); the retrieval contract belongs to `NMCPS-CONTRACT-002` |
| Metric catalogue (picker) | `GET /metric/definition` | `page` / `page_size` / `metric_group` / `keyword` | decides which `metric_code` values the picker offers |
| Available metric names | `GET /metric/name` | `mgmt_ip` / `ips` | per-device metric names; prefer this over `definition` when both are viable |
| Alarm overlay | `GET /alarm/alarm-events` | `page` / `page_size` / `severity` / `status` / `target_type` / `target_id` / `first_triggered_at_from` / `first_triggered_at_to` | `target_type=node` + `target_id=<node id>` drives node alarm badges; rule management is out of scope here |

### 6.2 Second source (the 8001 simulator, through the whitelisted BFF `server/api/sim/**` channel)

The simulation control plane fills in only what 8888 lacks: **topology write operations** and **simulation runtime state**. The channel is defined by `NMCPS-ADR-0019` §4 — its own `runtimeConfig.simulator`, a template whitelist, `allowWrite` defaulting to `false`, and no `Authorization` sent.

| Purpose | Endpoint (8001, read-only) | Note |
| :--- | :--- | :--- |
| Runtime inventory | `GET /api/network/runtime-inventory` | **one call, whole picture**: `{ running, scenario, overrides:{…}, nodes[], links[] }`, measured at 36 nodes / 48 links; nodes are joined to 8888 nodes by device identity to overlay a "simulated" badge, links carry live up/down |
| Simulation stats | `GET /api/network/stats` | `node_count` / `link_count` / `nodes_by_type` / `links_by_type` / `nodes_online` / `links_up`, feeding the header badges |
| Neighbour discovery | `GET /api/lldp/summary`, `GET /api/lldp/neighbors/{node_id}` | the detail pane's "neighbours" section (`neighbors[]` with peer id / name / both interfaces / TTL / `mib_oids`) |
| Runtime preview | `GET /api/network/runtime/preview` | candidate topology preview before an add/remove |

> Verbs follow the measured `openapi.json`: `/api/network/runtime/nodes` and `/api/network/runtime/links` are **POST (create — a write)**, while `/api/network/runtime/nodes/{node_id}` and `/api/network/runtime/links/{link_id}` are **DELETE (remove — a write)**. Reads always go through `runtime-inventory`; listing `runtime/nodes` gets a 405. `NMCPS-ADR-0019` §4.2 was corrected against the same measurement on 2026-11-05.

| Purpose | Endpoint (8001, write, `write: true`) | Note |
| :--- | :--- | :--- |
| Link actions | `POST /api/network/links/{link_id}/{down,up,toggle,disable,power,reconfigure}`, `PATCH /api/network/links/{link_id}/{tc,radio}` | one button per action, requiring a second confirmation plus an audit line; `tc` / `radio` are **PATCH** (parameterised attribute change), not POST |
| Node actions | `POST /api/network/nodes/{node_id}/{start,stop,restart,power}`, `PATCH /api/network/nodes/{node_id}/{radio,ip}` | same; `radio` / `ip` are **PATCH** |
| Runtime add/remove | `POST /api/network/runtime/{nodes,links}`, `DELETE /api/network/runtime/{nodes,links}/{id}` | mutates the running simulation, the highest-risk group: needs "writes allowed" plus its own second confirmation |

**Write entries shipped (P1-B, 2026-11-06)**: the toolbar's right area carries two **node actions** only; link actions and runtime add/remove have **no entry point** (the canvas can select nodes only, link selection ships with P1), so no button silently does nothing.

| Page entry | Endpoint | Preconditions | Interaction |
| :--- | :--- | :--- | :--- |
| Restart node | `POST /api/network/nodes/{node_id}/restart` | a selected node + that node present in the simulator runtime (the `runtime-inventory` join gives `marker.simId`) + channel `writeEnabled` | `UModal` second confirmation (naming the simulated node and the action) → success `useToast` plus an immediate `refresh()` |
| Stop node | `POST /api/network/nodes/{node_id}/stop` | same | same |
| Link actions / runtime add-remove | see the table above | not open yet (P1) | no button at all; when opened it follows the same "capability bit → second confirmation → audit" routine |

The client **does not guess** write permission: the page reads `{ configured, writeEnabled, timeoutMs, readinessPath }` from the BFF's own capability probe `GET /api/sim/channel`. That endpoint returns capability bits only and **never `baseUrl`** (the upstream address is not leaked to the browser); with `writeEnabled=false` the buttons are `disabled` and the page sends **no** write request at all — the BFF's 405 is the second gate, not the first. `node_id` comes from `marker.simId` (the simulator-side id), **not** the 8888 node id (one is the simulation engine's key, the other the management IP).

### 6.3 Local engines

**This domain uses no BFF engine** (`NMCPS-ADR-0019` §5.2 registers no triple for it). Layout is a client-side pure function family (`app/utils/graph/*`: `topologyLayout` / `topologyLayering` / `topologyRadialLayout` / `topologyTierTreeLayout` / `topologyEdgeStyle`) that takes node and link arrays and returns coordinates, holding no state.

### 6.4 Fetch constraints

1. **One egress**: 8888 data goes only through `useApi()` → the BFF gateway; pages never call the upstream directly and never roll their own `$fetch`.
2. **Polling**: topology and metrics refresh every 30s by default, pause while `document.visibilityState !== "visible"`, and refetch immediately once visible again.
3. **Time window**: metric pages default to the last hour with `step` chosen from the window; the picker follows `NMCPS-ARCH-006` §4.1 — one summary button plus a `UPopover` (preset column + `UCalendar range`), never two side-by-side `datetime-local` inputs.
4. **Failure classification**: `ApiError.code` 401 takes the shared refresh path; `5xx` shows the error state with retry; `code=0` with empty `data` is an empty state, **not** an error.

### 6.5 Node Trend Retrieval Contract (A3, landed 2026-11-06)

The `TrendChart` in the `monitor` detail pane draws **one** series, fetched in two steps, both through the BFF gateway (pages never call the upstream directly):

| Step | Endpoint (8888 `/api/v1`) | Parameters | Notes |
| :--- | :--- | :--- | :--- |
| ① pick a code | `GET /metric/name` | `mgmt_ip` = the selected node's **management IP** | the device's available metric names (dual shape; normalisation in `NMCPS-CONTRACT-002` §7); only the collector self-monitoring namespace (`up` / `scrape_*`) is skipped — **type is never guessed from the name** |
| ② fetch the series | `GET /metric/datapoint` | `mode=range` / `mgmt_ip` / `metric_code` / `from` / `to` (ISO strings) / `step=60` | the last hour; `rate` is not sent — no known type means no rate (`NMCPS-CONTRACT-002` §6.5) |

- **Data kernel**: `layers/topology/app/composables/useMetricSeries.ts` (the generic two-request loader plus the catalog join, state and a sequence number against races); this page's `useNodeTrend.ts` is a thin wrapper on it with no explicit code. Unpacking / ascending sort / de-duplication / downsampling all live in the pure functions of `app/utils/chart/metricSeries.ts` (`NMCPS-CONTRACT-002` §6.6), the three-way classification in `app/utils/metric/metricCatalog.ts` (`NMCPS-CONTRACT-002` §8), and the component only draws.
- **Graphics**: `app/components/Graph/TrendChart.vue` (SVG polyline plus area fill; `vector-effect` keeps the stroke width under stretching; above 2 × column width the series is bucketed per column keeping min/max, so spikes survive).
- **No picker on this page**: the monitor page draws only the **first** name the catalog calls `numeric`; the picker lives on `device-metrics` / `link-metrics` (§6.6) and is the same kernel with a different `metricCode`.
- **Failure semantics**: `code !== 0` → a `UAlert` with the upstream `message` verbatim plus retry; a failed refetch of the same node keeps the previous series and marks it possibly stale; `results: []` and "every point invalid" both render the empty state and **never** a zero-value line.
- **Type verdict**: text and event metrics never enter the line panel (`selectable = false`), the decision order is `NMCPS-CONTRACT-002` §8.3; when the catalog is unavailable the loader falls back to name-only (skipping just `up` / `scrape_*`), where a text metric can still flatten — the gap stays registered rather than papered over with name guessing.

### 6.6 Metrics Page Retrieval Contract (device-metrics / link-metrics, landed 2026-11-06)

Both pages share one skeleton — "ledger → select a row → metric picker → `TrendChart`" (`app/components/Layout/Split.vue` two panes plus `useRecordSelection`, which keeps the selection in `?id`):

| Page | Ledger endpoint | What the selection fetches |
| :--- | :--- | :--- |
| `device-metrics` | `GET /metric/device` (`page` / `page_size`; the envelope's `total` is the count) | `mgmt_ip` = that device's `mgmt_ip` |
| `link-metrics` | `GET /metric/link` (same) | `mgmt_ip` = the **source endpoint device's** `mgmt_ip` (a second `/metric/device` call builds the `device_code → mgmt_ip` map) plus the **filter key `ifIndex` = `identity.source.if_index`** |

- **Shared kernel**: `useMetricSeries(ip, { code, rate, ifIndex })` — catalog (the `/metric/definition` row of §6.1), name list and series in one pass; pages only bind the returned refs to controls.
- **Picker**: `USelect` options are the catalog entries with `selectable === true` (label from `en_name`, falling back to `code`, with `unit` as the suffix); switching only changes `metric_code` and does not refetch the name list.
- **Link series = that source port (measurement-driven change, 2026-11-06)**: `/metric/datapoint` still has no `link_id` dimension, but a live probe shows the series **carry an `ifIndex` label** (the same interface is scraped by two jobs; 2 interfaces × 2 jobs = 4 results). The link page therefore moves from "the source device's metric of the same name" to "the source device's series **for that port**": it passes `ifIndex = identity.source.if_index`, and `selectMetricSeries` (`NMCPS-CONTRACT-002` §6.9) filters the group and averages across jobs. Three honest labels: ① the endpoint has no `if_index` ⇒ current values only, no polyline; ② the chosen metric carries no `ifIndex` label (device-level metrics such as `sysUpTime`) ⇒ the device-level series is drawn and labelled "device-level, not port-level"; ③ `if_index` was supplied but that metric is interface-scoped without this index ⇒ the `no_interface_series` empty state, **no substitute port**. True `link_id` retrieval still waits for the upstream.
- **Rate switch**: shown only when the catalog entry has `metric_type === 'counter'` (`NMCPS-CONTRACT-002` §6.5); `rate` is an explicit user choice defaulting to `false`, while `gauge` / `duration` hide the switch and always send `false`.
- **Empty and degraded states**: same contract as §6.5 (empty list / no data / every point invalid are all the empty state, never a zero-value line); a catalog failure only prints one line inside the chart card and **never escalates into a page-level error**.


---

## 7. Graphic Shapes

All graphics are drawn in-house (`NMCPS-ADR-0019` D1 / D2). This domain may use only the components below; pages must not create their own canvas or start their own `requestAnimationFrame`.

| Component | Where | Carrier | Requirements |
| :--- | :--- | :--- | :--- |
| `TopologyCanvas` | the `monitor` main view | SVG (≤ 400 nodes) plus an isometric projection for a 2.5D feel | layout injected as a pure function; caps of 400 nodes / 1,200 links with weight-based trimming reported as "N trimmed"; drag / zoom / rubber-band hit testing comes from `app/composables/useGraphInteraction.ts` |
| `TrendChart` | the `device-metrics` / `link-metrics` main chart; the node trend in the `monitor` detail pane | SVG polyline plus area fill | threshold bands, range selection, cursor readout; above 2,000 points aggregate per pixel column keeping the extremes |
| `SparkStat` | page headers and detail-pane mini cards | SVG | single value + mini trend + status colour, replacing the scattered unovis mini charts of 1.0 |

- **Status colours** come from the semantic palette in `app.config.ts`; hard-coded hex is forbidden.
- **Sizing** is always `ResizeObserver` + `useDevicePixelRatio`; reading `window.innerWidth` to decide layout is forbidden (container-query convergence, `NMCPS-ARCH-006`).
- **Motion** honours `prefers-reduced-motion`; no permanent `rAF` loop — repaint only when data arrives.
- **Accessibility**: the graph and its legend carry `role="img"` + `aria-label`, and an equivalent keyboard-navigable list view is provided.

---

## 8. Empty and Degraded States

| Scenario | Behaviour | Trigger |
| :--- | :--- | :--- |
| Empty topology (upstream returns no `nodes`) | empty-state illustration + "no topology data for this tenant" + refresh; **never** a blank canvas | `data.nodes.length === 0` |
| No metric points | empty state + "no collected data in this window"; the window and metric pickers stay usable | empty matrix, no error |
| Metric fetch failed (upstream envelope `code !== 0`) | `UAlert` "fetch failed" + **the upstream message verbatim** (never translated, never replaced by `api_request_failed`) + a retry button; the "no collected data in this window" chart **must not** render at the same time (failure is not emptiness); when a previous successful series is still on hand it stays on screen with a stale note | `status: "error"` as normalised by the BFF / an `ApiError` on the client |
| 8888 unconfigured / unreachable | page-level `UAlert` (error) + retry; navigation and other domains unaffected | `/ready` has `upstream.configured === false`, or the request returns `5xx` |
| Simulator unconfigured | **page renders read-only as normal**: topology and metrics still show; the simulation action group is `disabled` with "simulation control disabled" | `runtimeConfig.simulator.baseUrl` empty |
| Simulator with `allowWrite=false` | write buttons visible but `disabled`, with a "simulation writes disabled" hint; the BFF answers 405 even if the front end is bypassed | `writeEnabled === false` from `/api/sim/channel` (the client never guesses, and the page sends no write request at all) |
| Simulator unreachable | partial degradation: the read-only panes stay, the simulated badge and LLDP section show "simulation platform unreachable"; `/ready` must **not** go red | channel timeout / connection failure |
| Trimming triggered | a corner badge "N nodes / M links trimmed" plus a hint to switch to the layered/radial view | more than 400 nodes or 1,200 links |

**Hard requirement**: every degraded state must say which data is missing, which blocks it affects, and whether it can be retried. A silent blank screen, or escalating a hiccup in an optional upstream into a full-page error, is forbidden.

---

## 9. Acceptance Assertions

Asserted one by one when `check:ui` lands (unimplemented items are filled in with P1 and must not be pre-declared as passing):

| # | Assertion | Criterion |
| :---: | :--- | :--- |
| A1 | all three pages route and take their titles from i18n | `topology-{monitor,device-metrics,link-metrics}` each appear once in `i18n/locales/*.json`; no hard-coded CJK in the pages |
| A2 | the topology page renders `TopologyCanvas` | `[data-testid="topology-canvas"]` matches and the SVG holds more than zero `circle`/`path` elements |
| A3 | selecting a node shows that node's metrics | clicking a node renders a `TrendChart` in the right pane and the `/api/metric/datapoint` request carries that node's `mgmt_ip` (the code comes from the first non-collector entry of `/metric/name`; invalid samples are dropped and counted, never zero-filled) |
| A4 | an empty topology renders the empty state, not a blank canvas | the fake upstream returns `nodes: []` → the empty copy appears and `topology-canvas` is absent |
| A5 | 8888 outage degrades | closing the fake upstream, then clicking the toolbar's "refresh topology" → an error `UAlert` with a retry button appears and the page does not go blank; once the upstream is back, "retry" returns to the topology. **No full page reload**: reloading while the upstream is down fails the session probe too, so the guard bounces to the login page and the assertion would test the wrong page |
| A6 | read-only when the simulator is unconfigured | without `NUXT_SIMULATOR_BASE_URL` the topology renders normally and every simulation action button is `disabled` |
| A7 | write endpoints rejected | two gates in a fixed order (path whitelist → channel enabled → write permission): an unconfigured channel short-circuits to 503 `simulator_not_configured`; a configured channel with `allowWrite` still at its default `false` answers 405 `simulator_write_disabled`, and that request never reaches the upstream |
| A8 | no site-wide outage | in the A6 / A7 scenarios `/ready` still returns 200 with `upstream.configured === true` |
| A9 | write entries confirm twice and leave an audit trail | on an `allowWrite: true` instance: `/api/sim/channel` says `writeEnabled=true`, the buttons become clickable once a simulated node is selected, and after the `UModal` second confirmation the request **reaches the fake simulator** with method and path unchanged; a success `useToast` appears and the page refreshes; the BFF emits one structured audit line `{"event":"simulator.write",…}` (method / template / status / duration / `x-request-id` / client IP, **no request body**). With `allowWrite=false` the buttons are `disabled`, the page sends zero write requests, and the capability probe never contains the upstream `baseUrl` |

| A10 | metrics-page ledger and picker (`device-metrics`) | the left pane renders the device ledger (rows > 0, count from the envelope's `total`) and selects the first row; the right-hand picker lists **only entries the catalog calls `numeric`** (the fake upstream tags `sys_name` as `string`, so it must not appear) | every entry reports `meta_source: backend` (catalog hit); `GET /metric/definition` is requested once |
| A11 | metrics-page chart and rate switch (`device-metrics`) | the default metric renders a `TrendChart` and `/api/metric/datapoint` carries that device's `mgmt_ip` with `metric_code=if_in_octets`; after switching to a `gauge` metric the request carries the new `metric_code` and **no** `rate` (only `counter` shows the switch) | invalid samples are dropped and counted; the empty state never draws a zero line |
| A12 | link-page ledger and chart (`link-metrics`) | the left pane renders the link ledger (rows > 0, current values from `/metric/link`'s `metrics`); selecting a link renders a `TrendChart` whose `/api/metric/datapoint` request carries the **source endpoint device's** `mgmt_ip` and whose polyline is the group with **`metric.ifIndex === identity.source.if_index`** (same-`ifIndex` jobs averaged first, never mixed with other ports) | the `device_code → mgmt_ip` map comes from `/metric/device`; a missing `if_index`, a metric without an `ifIndex` label, and a zero-match group are labelled per §6.6, never faked and never falling back |
| A13 | a failed metric fetch never degrades into an empty state (shared `TrendPanel`) | with an upstream HTTP 200 + `code !== 0`, `[data-testid="metric-trend-error"]` appears, its description **equals the upstream `message` verbatim**, a retry button is present, and the page contains no "no collected data in this window" and renders no chart container; once the upstream recovers, clicking retry really fetches data (the error goes away and the polyline returns) | the fake upstream's `__control/metric-error` fabricates an envelope failure (not a network error — that is `__control/down` and takes the stale branch); two assertions in `check:ui`, implementing S3 of `NMCPS-CONTRACT-002` §6.7 |
| A14 | the same panel keeps the same semantics on the device page (`device-metrics`) | after selecting a device, an upstream `code !== 0` likewise produces only `[data-testid="metric-trend-error"]` (verbatim message + retry), with no "no collected data in this window" on the page and no chart container rendered | one `check:ui` assertion; same `MetricTrendPanel`, guarding against semantics drifting per page |
| A15 | the monitor node pane keeps the same semantics (`monitor`, via the `useNodeTrend` wrapper) | after selecting a node, a `code !== 0` produces only `[data-testid="trend-error"]` (verbatim message + retry) and `trend-chart` is not rendered | the thin wrapper must not leak a failure back into the chart; one `check:ui` assertion |
| A16 | a re-fetch of the same device under a **network error** keeps the old polyline and flags it stale | with a chart already on screen (`data-series-count` non-empty), kill the upstream and click "refresh metric": the error alert appears, the polyline stays with an unchanged series count, and "metric channel temporarily unavailable" shows up | uses `__control/down` (a network error, `bff_upstream_unreachable`), a different path from the envelope failures in A13–A15; one `check:ui` assertion |

> **Status (2026-11-06)**: A1 – A16 are all asserted by `pnpm check:ui` (section 11 of `scripts/check-ui.mjs`; A4 / A5 need the fake upstream's `__control/topology-empty` and `__control/down`, so they only run in self-hosted mode), and a self-hosted run measures `158/158` green. A3 is pinned by three assertions: clicking a node renders a `TrendChart` whose code is the **first drawable** entry of `/metric/name` (the fake upstream puts `up` / `scrape_*` first and tags `sys_name` as `string` on purpose), the `/api/metric/datapoint` request carries that node's `mgmt_ip` and `metric_code`, and the two invalid samples embedded in the series (empty string / `NaN`) are dropped and counted instead of being zero-filled. A10 – A12 cover the metrics pages (`device-metrics` / `link-metrics`): the ledger's row count matches `total`, the picker lists only the entries the catalog calls `numeric` (`sys_name` must never appear), switching the metric changes `metric_code`, and the link page fetches the source endpoint device's `mgmt_ip`. A7 / A9's precise halves live in two companion cases, each booting a second BFF with `NUXT_SIMULATOR_BASE_URL`: one with `allowWrite=false` proves the IP-aligned "simulated" markers are really drawn, the degraded banner disappears, a write answers 405 and the fake simulator sees zero write hits; the other with `NUXT_SIMULATOR_ALLOW_WRITE=true` proves the buttons become clickable, the `UModal` confirmation really sends the write to the fake simulator with method and path unchanged, and the success toast appears — testing only "not configured" would never exercise the channel itself. A separate **visual + DOM** pass over the link page ran on 2026-11-06 (throwaway playwright script, artifacts left in `/tmp`, never committed) and measured four states: state ① with `LNK-0001` selected reports `data-series-if-index=101` and `data-series-count=2`, two cross-job series folded into one curve plus the "2 invalid samples ignored (never zero-filled)" hint; state ② after switching to `cpu_util_pct` the attribute is empty and the device-level note appears under the chart; state ③ with every `ifIndex=101` group stripped from the response the `no_interface_series` empty state renders and the SVG holds zero `path` elements (no zero-filled line, no port-102 substitute); state ④ with `LNK-0002` selected only the gap notice shows and zero `/api/metric/datapoint` requests fire. That pass also caught contradictory copy (state ② still claimed "the line is the ifIndex=101 interface series" while the panel said device-level; the body now states the rule instead) — a "panel says device-level, page claims port-level" conflict is invisible to assertions and only shows up by eye, hence this note. The evidence itself adds no assertion; A13 (envelope failure shown verbatim, plus retry — two assertions) then lifts the count to `155/155` and removes the contradictory "no collected data in this window" line that used to sit next to the error alert. A14–A16 immediately after extend the same semantics to the other two entries (device page, monitor pane) and pin the `__control/down` stale branch (polyline kept, series count unchanged, "metric channel temporarily unavailable" shown), bringing the count to `158/158`.The LLDP neighbourhood section, the alarm badges, **link actions** and a true `link_id`-scoped series (the upstream has no `link_id` retrieval; `if_index`-scoped link series landed per §6.6) are likewise P1.

---

## 10. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: topology monitoring domain baseline. |
| 2026-11-05 | 0.2.0 | Obligation 1 of `NMCPS-ADR-0019` applied: added the 2.0 locations of the three pages, the data sources (seven 8888 endpoints + the 8001 read/write whitelist + the empty local-engine set), the graphic shapes (`TopologyCanvas` / `TrendChart` / `SparkStat`), eight empty and degraded states, eight acceptance assertions; `dependsOn` gained `NMCPS-ARCH-006` (`NMCPS-ADR-0019` is cited in prose only — a Tier 2 normative doc does not `dependsOn` a Tier 5 record). |
| 2026-11-05 | 0.3.0 | **The `monitor` page landed** (`layers/topology/app/pages/topology/monitor.vue`): structure from `GET /api/topology/graph`, simulator runtime from the 8001 `runtime-inventory` / `stats` (IP-aligned, drawn as a dashed outer ring); the `useTopologyMonitor()` data kernel polls every 30 s, pauses while the page is hidden, and splits failures — a primary-upstream failure is a page-level error, a simulator failure degrades only the simulation section. Graphics land in `app/components/Graph/{TopologyCanvas,SparkStat}.vue` plus `app/utils/graph/{topologyNormalize,topologyLayout,topologyStatusStyle,simulatorOverlay}.ts` (pure functions) and `app/composables/useGraphInteraction.ts` (drag / zoom, no rAF). §9 records the status: A1/A2/A4–A8 are in `check:ui`, A3 plus LLDP / ledger / alarm badges stay with P1. |
| 2026-11-06 | 0.4.0 | **Write entries shipped (P1-B)**: the two toolbar actions (restart / stop) call `POST /api/network/nodes/{node_id}/{restart,stop}` targeting the simulator-side `marker.simId` (not the 8888 node id), with `UModal` confirmation, a success `useToast` and an immediate refresh. Write permission is no longer guessed: a new BFF capability probe `GET /api/sim/channel` returns only `configured` / `writeEnabled` / `timeoutMs` / `readinessPath` (**never `baseUrl`**), and with `writeEnabled=false` the buttons are `disabled` and the page issues zero write requests. §6.2 gained the write-entry scope table (link actions and runtime add/remove stay P1, **no buttons at all** — a dead button that cannot be reached is worse than none), §8's `allowWrite=false` trigger became the capability bit, §9 gained **A9** (second confirmation + upstream receipt + structured audit line + no address leak from the probe), and the status now reads `139/139`. |
| 2026-11-06 | 0.5.0 | **A3 landed, A1–A9 all green**: the `monitor` detail pane gained the node trend — selecting a node → `GET /api/metric/name` (`mgmt_ip`) to pick a code (skipping only the `up` / `scrape_*` collector namespace, never guessing the type from the name) → `GET /api/metric/datapoint` (`mode=range`, last hour, `step=60`, no `rate`) → a hand-drawn `TrendChart`. Kernel `layers/topology/app/composables/useNodeTrend.ts` (clears on node switch, keeps the previous series and marks it stale when the same node fails, guarded by a sequence number); unpack / ascending sort / de-duplicate / pixel downsampling live in the pure functions of `app/utils/chart/metricSeries.ts` (the empty string is rejected explicitly: `Number("")` is 0 and would draw "not collected" as a zero line). §6.5 registers the retrieval contract and the known gap (the three-way classification needs a catalog join, P1 of the metrics pages); §7's `TrendChart` row gained this page; §9's A3 criterion gained "invalid samples dropped, never zero-filled" and the status now reads `142/142` (three new assertions in section 11). |
| 2026-11-06 | 0.6.0 | **Metrics pages landed, A10–A12 with them**: the two-step `/metric/datapoint` retrieval was extracted into `layers/topology/app/composables/useMetricSeries.ts` (catalog join + name list + series, one generic kernel), and `useNodeTrend.ts` became its thin wrapper with no explicit code; the three-way classification lives in `app/utils/metric/metricCatalog.ts` (decision order in `NMCPS-CONTRACT-002` §8), and `device-metrics` / `link-metrics` went from placeholders to real pages (`Layout/Split.vue` ledger + `useRecordSelection` + a `USelect` metric picker + a rate switch only for `counter`). New §6.6 records the retrieval contract and registers the link-level series gap: `/metric/datapoint` only takes `mgmt_ip`, so the link page charts the source device's metric of the same name while the link's current values come from `/metric/link`'s `metrics`. `check:ui` 142 → 151 assertions (nine new A10–A12 cases in section 11). |
| 2026-11-06 | 0.7.0 | **The link polyline becomes "the source port" and the "`results` is always one entry" assumption is gone**: a live upstream probe shows a `range` `/metric/datapoint` answer carrying several series with an `ifIndex` label (one interface scraped by two jobs), so §6.6 moves the link page from "the source device's metric of the same name" to "the interface series with `metric.ifIndex === identity.source.if_index`" (per-timestamp mean across jobs, rule in `NMCPS-CONTRACT-002` §6.9); three cases are labelled honestly: no `if_index` means no polyline, a metric without an `ifIndex` label is marked device-level, and a zero-match group renders the `no_interface_series` empty state with no fallback. A12's criteria tightened accordingly and `check:ui` grew by two assertions (the polyline really hits the source port's `ifIndex`; the fake upstream now returns two `ifIndex` × two `job`). |
| 2026-11-06 | 0.7.1 | **Visual self-check recorded, plus a fix for copy that contradicted the panel**: a throwaway playwright script (never committed) screenshotted each state and scraped the DOM, and the four measurements are now in §9 "Status" (port group key `101`, two cross-job series folded into one, the device-level note, the zero-match empty state with `path=0`, and no request when the source endpoint has no IP); state ② exposed a page header still claiming "the line is the ifIndex=101 interface series" while the panel marked it device-level, so `portBody` (cn / en) now states the rule instead — port-level metrics chart that port series, and a device-level metric gets a note under the chart. Criteria and assertion count unchanged. |
| 2026-11-06 | 0.8.0 | **A failed metric fetch is no longer conflated with "no data" (A13)**: when the gateway answers HTTP 200 + `code !== 0`, `TrendPanel` shows only a `UAlert` (i18n title, upstream `message` verbatim as the description) plus retry — it **no longer** renders the "no collected data in this window" chart underneath, since two contradictory lines side by side read as "nothing was scraped" rather than "the fetch did not succeed"; an existing series is still kept and flagged stale (`NMCPS-CONTRACT-002` §6.7). §8 gains a "metric fetch failed" row and §9 gains A13; the fake upstream gains `__control/metric-error` / `__control/metric-ok` (only `/metric/datapoint` fails the envelope, catalog and name list stay healthy) and `check:ui` grows from 153 to 155 (verbatim message comparison + retry really fetching the `ifIndex=101` series). |
| 2026-11-06 | 0.9.0 | **Failure semantics completed across all three entries and the stale branch pinned (A14–A16)**: A13 only locked the link detail page, while `MetricTrendPanel` also backs the `device-metrics` device detail and `useNodeTrend` backs the `monitor` node pane — in both, the same scenario still drew "no collected data in this window" right above "metric fetch failed" (calling a failed fetch "nothing scraped"). A pure failure now renders no chart container at all (`!error || points.length > 0`) and only a re-fetch of the same device keeps the polyline plus a stale note. A14 (device page parity), A15 (monitor parity) and A16 (the stale branch under `__control/down`: polyline kept, series count unchanged, "metric channel temporarily unavailable" shown) take `check:ui` from 155 to 158; `NMCPS-CONTRACT-002` §6.7 gains "identical on all three entries, no chart on a pure failure" and assertion S7. |
