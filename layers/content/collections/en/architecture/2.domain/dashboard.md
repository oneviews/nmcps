---
docId: NMCPS-DESIGN-007
title: "Dashboard Domain Baseline"
description: "Tier 2 design baseline for the dashboard domain (domain.dashboard): system overview, agent assistant, Kubernetes monitoring and big-screen presentation, with the target-page list and data sources of the four sub-pages, in-house graphic shapes, empty and degraded states, and assertable acceptance criteria. This is the single authority for the domain.dashboard domain."
excerpt: "Overview, agent assistant, Kubernetes monitoring, big screen — with data sources, graphic shapes, empty states and acceptance assertions."
keywords:
  - "dashboard"
  - "big-screen"
  - "baseline"
  - "SparkStat"
  - "TopologyCanvas"
tier: 2
authority: normative
scope:
  - domain.dashboard
status: baseline
version: 0.2.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-002
  - NMCPS-ARCH-006
  - NMCPS-DESIGN-001
createdAt: "2026-10-25"
updatedAt: "2026-11-05"
icon: "carbon:dashboard"
tags:
  - "Domain"
  - "Dashboard"
  - "Big Screen"
---

# Dashboard Domain Baseline (NMCPS-DESIGN-007)

> **Responsibility**: single authority for `domain.dashboard` — system overview, agent assistant, Kubernetes monitoring, big-screen presentation, and the target-page list, data sources, graphic shapes, empty/degraded states and acceptance assertions of the four sub-pages. Data consumption: `NMCPS-ARCH-002`; page structure and toolbar rules: `NMCPS-ARCH-006`; topology graphics and data come from `NMCPS-DESIGN-001`; the in-house-graphics and second-upstream verdicts: `NMCPS-ADR-0019` (layers/content/collections/cn/records/adr/adr-0019.md).
> **Audience**: implementation engineers / AI assistants.

---

## 1. Positioning

The dashboard is the "presentation plane" of the NMS: it aggregates state across domains and provides system overview, agent interaction, cloud-native resource monitoring and a command big screen. **It does not produce data** — every card is a read-only recombination of data owned elsewhere, so no page may add a fetch channel or carry its own cache layer.

---

## 2. Functional Scope

| Sub-page | Function | 2.0 location |
| :--- | :--- | :--- |
| overview | System overview (numeric cockpit, read-only) | `layers/dashboard/app/pages/dashboard/overview.vue` |
| agent | Agent assistant | `layers/dashboard/app/pages/dashboard/agent.vue` |
| kubernetes | Kubernetes resource monitoring (embedded console) | `layers/dashboard/app/pages/dashboard/kubernetes.vue` |
| screen | Command big screen (2.5D main view + floating cards) | `layers/dashboard/app/pages/dashboard/screen.vue` |

All four pages **share one fetch core**: `overview` and `screen` read the same `metric` / `topology` / `alarm` data and differ only in layout density and polling interval (`overview` 30s, `screen` 60s). That is how the 1.0 big screen was built — reusing the same topology composable with **zero new BFF routes and zero new fetch channels**; 2.0 keeps the constraint.

---

## 3. Key Data Entities

| Entity | Note |
| :--- | :--- |
| Overview | Cross-domain aggregated summary metrics |
| Agent Session | Human-machine interaction context |
| Cluster Resource | Cloud-native resource status |

---

## 4. Domain Boundary & Dependencies

- **Upstream**: cross-domain aggregated data (`NMCPS-ARCH-002`).
- **Consumers**: end users (the single aggregation entry).
- **Out of scope**: raw per-domain data (provided by each `domain.*`).

---

## 5. Roadmap

1. System overview (cross-domain metric aggregation).
2. Agent assistant (natural-language ops).
3. Kubernetes monitoring and command big screen.

---

## 6. Data Sources

### 6.1 Primary source (8888 unified gateway, through the BFF `[...slug]` gateway, authenticated)

| Purpose | Endpoint (8888 `/api/v1`) | Key parameters | Note |
| :--- | :--- | :--- | :--- |
| Network-wide counts (top stat cards) | `GET /metric/device`, `GET /metric/link` | `page` / `page_size` / `status` / `role` / `medium` | use the paged envelope's `total` as the denominator; never pull the whole list |
| Node / link metrics (chart cards) | `GET /metric/datapoint` | `mode` / `mgmt_ip` / `metric_code` / `from` / `to` / `step` / `rate` / `ips` / `codes` | overview and topology share the same metric codes; the retrieval contract belongs to `NMCPS-CONTRACT-002` |
| Available metric names | `GET /metric/name` | `mgmt_ip` / `ips` | decides which metrics a device card may offer, instead of guessing codes |
| Network-wide topology (middle column / big-screen main view) | `GET /topology/graph` | `tenant_id` / `include_virtual` / `include_status` / `group_by` | measured 36 nodes / 48 links / 3 combos; graphic shapes belong to `NMCPS-DESIGN-001` |
| Alarm summary (right column / floating cards) | `GET /alarm/alarm-events` | `severity` / `status` / `target_type` / `target_id` / `first_triggered_at_from` / `first_triggered_at_to` | read-only counts and a few recent rows; ack/close belong to the system domain |
| Device ledger (device-card context) | `GET /asset/device` | `page` / `page_size` / device identity | `snmp_*_pass` is masked at the BFF egress (`NMCPS-ADR-0018` D7); pages must not cache the plaintext |
| Channel occupancy (overview third row) | `GET /frequency/wifi/aps`, `/state`, `/scan` | see the spectrum domain | the component comes from `domain.spectrum`; this domain only lays it out and never changes its fetch |

### 6.2 Endpoints explicitly not used

| Endpoint | Measured state | Conclusion |
| :--- | :--- | :--- |
| `GET /dashboard/dashboards`, `/widgets`, `/widget-bindings` | empty list (`list: null, total: 0`) | **not used to carry the 2.0 page structure.** Card layout lives in page code (versionable, reviewable) rather than in an empty upstream config store; revisit "user-defined dashboards" as a separate capability once the upstream has real board data |
| `/ai/**` | no such namespace on 8888 (only legacy resource-name fallbacks remain) | **not wired in phase 1.** The agent page keeps its empty state and never fabricates a response; the integration form needs its own ADR |

### 6.3 Local engines

**This domain uses no BFF engine** (`NMCPS-ADR-0019` §5.2 registers no triple for it). All aggregation is a front-end `computed`.

### 6.4 Fetch constraints

1. **No new channels**: `overview` / `screen` must reuse the topology and metric composables and must not open a BFF route just for the big screen (a 1.0 hard constraint, inherited by 2.0).
2. **Polling**: `overview` 30s, `screen` 60s; paused while the page is not visible, with one catch-up fetch on return.
3. **Single-flight**: cards requesting the same endpoint on one screen merge by parameter, so N cards never produce N upstream calls.
4. **Read-only**: this domain issues no `POST` / `PUT` / `PATCH` / `DELETE`; every write under `/dashboard/**` is out of scope for 2.0 phase 1.

---

## 7. Graphic Shapes

In-house components (`NMCPS-ADR-0019` D1); this domain permits only the shapes below:

| Component | Where | Carrier | Requirements |
| :--- | :--- | :--- | :--- |
| `SparkStat` | the five top stat cards of overview, floating-card readings | SVG | single value + mini trend + status colour; with no data show "—", never `0` |
| `TrendChart` | node / link telemetry cards, channel-occupancy trend | SVG | the same component and the same fetch as `NMCPS-DESIGN-001`; this domain never duplicates a chart implementation |
| `TopologyCanvas` | the overview middle column, the big-screen 2.5D main view | SVG + isometric projection | **read-only mode** (no write action buttons); layout still goes through pure functions, and the big screen may switch layered / radial |
| `FloatingCard` (2.5D) | big-screen node / link detail cards | HTML + frosted glass | exactly **one** open at a time; clicking empty canvas closes it and clears the selection |
| Embedded iframe | the `kubernetes` page | iframe | address supplied by `runtimeConfig.public.kubernetesUiUrl`, nothing hard-coded; it must carry a trailing slash (otherwise a 307 downgrades to `http:` and mixed-content blocks it); `referrerpolicy="no-referrer"`; height chain `flex-1` + `min-h-0` so the page itself never scrolls |

- **Density differs only by layout**: the big screen and overview use the same components, changing only font size, spacing and card count; there are no "big-screen-only charts".
- **Motion**: the big screen may keep entrance transitions but must honour `prefers-reduced-motion` and must not run a permanent `rAF`.
- **Colours**: status colours come from the semantic palette in `app.config.ts`; the dark HUD skin may override surface tokens only, never the semantics.

---

## 8. Empty and Degraded States

| Scenario | Behaviour | Trigger |
| :--- | :--- | :--- |
| Empty overview metrics | the card shows the "—" placeholder plus "no collected data"; other cards on screen stay normal | `datapoint` returns an empty matrix with no error |
| Empty topology | the middle column / big screen shows the empty-state illustration + "no topology data for this tenant", **never** a blank canvas | `data.nodes.length === 0` |
| 8888 unconfigured / unreachable | page-level `UAlert` (error) + retry; navigation and other domains unaffected | `/ready` has `upstream.configured === false`, or the request returns `5xx` |
| Some cards fail | **local** error placeholder, no page-wide red; the failing card offers its own retry | one request fails while the rest succeed |
| Alarm endpoint empty (no alarms) | shows "no alarms", visually distinct from "fetch failed" | `total === 0` and `code === 0` |
| Big screen without WebGL / weak device | degrades to the SVG main view (same component, different `renderer` argument) with "switched to compatible rendering" | capability probe fails |
| `kubernetesUiUrl` unconfigured | **no empty iframe**; an empty state says "cloud-native console address is not configured" | `public.kubernetesUiUrl` empty |
| Agent not integrated | empty state "agent not connected yet" and sending disabled; **no** fabricated reply or fake session | no upstream in phase 1 |

**Hard requirement**: this domain is an aggregation plane, so any failing unit may only degrade its own block. Escalating a single card's failure into a page error, or drawing missing data as `0`, counts as a defect.

---

## 9. Acceptance Assertions

Asserted one by one when `check:ui` lands (unimplemented items follow P1 and must not be pre-declared as passing):

| # | Assertion | Criterion |
| :---: | :--- | :--- |
| B1 | all four pages route and take their titles from i18n | `dashboard-{overview,agent,kubernetes,screen}` each appear once in `i18n/locales/*.json`; no hard-coded CJK in the pages |
| B2 | overview renders stat cards and topology | at least one `[data-testid="spark-stat"]`, a `[data-testid="topology-canvas"]`, and the canvas offers no write actions |
| B3 | big screen and overview share their fetch | both pages request the same endpoint set (`/api/metric/*`, `/api/topology/graph`, `/api/alarm/alarm-events`); the big screen adds no BFF route |
| B4 | empty metrics are not zero | with an empty matrix from the fake upstream the card text is "—" and no `0` appears as that metric's reading |
| B5 | partial failure stays partial | forcing a 500 from `/api/alarm/alarm-events` puts only the alarm card into the error placeholder; stat cards and topology stay normal |
| B6 | 8888 outage degrades | closing the fake upstream → page-level `UAlert` with retry, no blank page |
| B7 | no iframe when the address is unconfigured | with an empty `NUXT_PUBLIC_KUBERNETES_UI_URL` the page has no `<iframe>` and shows the "address not configured" empty state |
| B8 | no fabricated agent | with no upstream the send button is disabled and the DOM holds no fabricated assistant messages |
| B9 | read-only | no `POST`/`PUT`/`PATCH`/`DELETE` request occurs (other than `/api/iam/refresh`) |

---

## 10. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: dashboard domain baseline. |
| 2026-11-05 | 0.2.0 | Obligation 1 of `NMCPS-ADR-0019` applied: added the 2.0 locations of the four pages and the "one shared fetch core" constraint, the data sources (seven 8888 endpoints plus the explicitly unused `/dashboard/**` and `/ai/**`), the graphic shapes (`SparkStat` / `TrendChart` / `TopologyCanvas` / `FloatingCard` / embedded iframe), eight empty and degraded states, nine acceptance assertions; `dependsOn` gained `NMCPS-ARCH-006` and `NMCPS-DESIGN-001` (`NMCPS-ADR-0019` is cited in prose only — a Tier 2 normative doc does not `dependsOn` a Tier 5 record). |
