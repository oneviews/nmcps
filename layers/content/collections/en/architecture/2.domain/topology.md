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
version: 0.2.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-001
  - NMCPS-ARCH-002
  - NMCPS-ARCH-006
createdAt: "2026-10-25"
updatedAt: "2026-11-05"
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

### 6.3 Local engines

**This domain uses no BFF engine** (`NMCPS-ADR-0019` §5.2 registers no triple for it). Layout is a client-side pure function family (`app/utils/graph/*`: `topologyLayout` / `topologyLayering` / `topologyRadialLayout` / `topologyTierTreeLayout` / `topologyEdgeStyle`) that takes node and link arrays and returns coordinates, holding no state.

### 6.4 Fetch constraints

1. **One egress**: 8888 data goes only through `useApi()` → the BFF gateway; pages never call the upstream directly and never roll their own `$fetch`.
2. **Polling**: topology and metrics refresh every 30s by default, pause while `document.visibilityState !== "visible"`, and refetch immediately once visible again.
3. **Time window**: metric pages default to the last hour with `step` chosen from the window; the picker follows `NMCPS-ARCH-006` §4.1 — one summary button plus a `UPopover` (preset column + `UCalendar range`), never two side-by-side `datetime-local` inputs.
4. **Failure classification**: `ApiError.code` 401 takes the shared refresh path; `5xx` shows the error state with retry; `code=0` with empty `data` is an empty state, **not** an error.

---

## 7. Graphic Shapes

All graphics are drawn in-house (`NMCPS-ADR-0019` D1 / D2). This domain may use only the components below; pages must not create their own canvas or start their own `requestAnimationFrame`.

| Component | Where | Carrier | Requirements |
| :--- | :--- | :--- | :--- |
| `TopologyCanvas` | the `monitor` main view | SVG (≤ 400 nodes) plus an isometric projection for a 2.5D feel | layout injected as a pure function; caps of 400 nodes / 1,200 links with weight-based trimming reported as "N trimmed"; drag / zoom / rubber-band hit testing comes from `app/composables/useGraphInteraction.ts` |
| `TrendChart` | the `device-metrics` / `link-metrics` main chart | SVG polyline plus area fill | threshold bands, range selection, cursor readout; above 2,000 points aggregate per pixel column keeping the extremes |
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
| 8888 unconfigured / unreachable | page-level `UAlert` (error) + retry; navigation and other domains unaffected | `/ready` has `upstream.configured === false`, or the request returns `5xx` |
| Simulator unconfigured | **page renders read-only as normal**: topology and metrics still show; the simulation action group is `disabled` with "simulation control disabled" | `runtimeConfig.simulator.baseUrl` empty |
| Simulator with `allowWrite=false` | write buttons visible but `disabled`, with a "simulation writes disabled" hint; the BFF answers 405 even if the front end is bypassed | a `write: true` entry plus the switch off |
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
| A3 | selecting a node shows that node's metrics | clicking a node renders a `TrendChart` in the right pane and the `/api/metric/datapoint` request carries that node's `mgmt_ip` |
| A4 | an empty topology renders the empty state, not a blank canvas | the fake upstream returns `nodes: []` → the empty copy appears and `topology-canvas` is absent |
| A5 | 8888 outage degrades | closing the fake upstream → an error `UAlert` with retry appears and the page does not go blank |
| A6 | read-only when the simulator is unconfigured | without `NUXT_SIMULATOR_BASE_URL` the topology renders normally and every simulation action button is `disabled` |
| A7 | write endpoints rejected | with `allowWrite=false`, hitting `/api/sim/api/network/links/{id}/down` returns 405 |
| A8 | no site-wide outage | in the A6 / A7 scenarios `/ready` still returns 200 with `upstream.configured === true` |

---

## 10. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: topology monitoring domain baseline. |
| 2026-11-05 | 0.2.0 | Obligation 1 of `NMCPS-ADR-0019` applied: added the 2.0 locations of the three pages, the data sources (seven 8888 endpoints + the 8001 read/write whitelist + the empty local-engine set), the graphic shapes (`TopologyCanvas` / `TrendChart` / `SparkStat`), eight empty and degraded states, eight acceptance assertions; `dependsOn` gained `NMCPS-ARCH-006` (`NMCPS-ADR-0019` is cited in prose only — a Tier 2 normative doc does not `dependsOn` a Tier 5 record). |

