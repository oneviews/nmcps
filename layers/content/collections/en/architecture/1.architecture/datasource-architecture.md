---
docId: NMCPS-ARCH-002
title: "Data Source Architecture"
description: "Tier 1 architecture baseline for data sources (arch.datasource): data source classification (device collection/metrics/alarms/asset-config), storage layering (RDBMS control + TSDB time-series), the cloud/edge data adapter layer, unified data flow, and the second data source (the simulator) with its separate channel, whitelist and write switch. This is the single authority for the arch.datasource domain."
excerpt: "Data source classification, RDBMS+TSDB layering, cloud/edge adapters, and the simulator's second channel."
keywords:
  - "datasource"
  - "architecture"
  - "storage"
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
  - "Architecture"
  - "Data Source"
  - "Storage Layering"
---

# Data Source Architecture (NMCPS-ARCH-002)

> **Responsibility**: single authority for `arch.datasource` — where data is collected, how it is layered in storage, and how cloud/edge read/write through the same interface. Transport flows: `NMCPS-ARCH-001`; governance rules: `NMCPS-GOV-001`.
> **Audience**: architecture and implementation engineers / AI assistants.

---

## 1. Positioning

The data source is the "memory" of the NMS: control data (assets, config, identity) needs strong consistency, while time-series metrics need high throughput. Different storage engines carry them, decoupling read/write performance.

---

## 2. Data Source Classification

| Source | Content | Freshness | Storage |
| :--- | :--- | :--- | :--- |
| Device collection | SNMP-polled device status, MIB data | Realtime | Edge collect → cloud TSDB |
| Metrics stream | High-frequency metrics (port traffic, CPU, memory) | Realtime | TSDB |
| Alarm events | Edge-judged alarms | Realtime | RDBMS (via MQTT) |
| Assets & config | Device assets, config changes, identity | Strong consistency | RDBMS |
| Simulator runtime | Node / link / session state and control entry points of a simulated network (optional) | Realtime, never stored | Read and forward through the BFF (see §6) |

> The first four need storage; the fifth is a **zero-storage** optional upstream with its own channel and its own readiness signal, and its absence degrades pages locally instead of taking them down.

---

## 3. Storage Layering

| Layer | Engine | Content | Trait |
| :--- | :--- | :--- | :--- |
| Control storage | RDBMS (PostgreSQL / Supabase) | Assets, config, identity, audit | Strong consistency, RLS |
| Time-series storage | TSDB (VictoriaMetrics) | Metrics | High throughput, compression, downsampling |
| Edge local | PocketBase / SQLite | Edge offline autonomy | Lightweight (< 50MB), single binary |

Control/data separation prevents high-frequency metric writes from contending with control transactions (see `NMCPS-ARCH-001` §3).

---

## 4. Data Adapter Layer (Cloud/Edge Isomorphic)

Via Nuxt Layers, cloud and edge access their data sources through the **same composables interface**, maximizing code reuse:

| Adapter | Backend | Used by |
| :--- | :--- | :--- |
| layer-supabase | Supabase SDK + go-zero API Gateway | Cloud console |
| layer-pocketbase | PocketBase SDK + edge Go Daemon | Edge local UI |

Both sides expose identical composables interfaces; cloud/edge apps only compose different adapters while sharing UI components and business logic.

---

## 5. Data Flow

```text
Device (SNMP/Agent)
  → Edge collection (Exporter / Go Daemon)
  → Metrics stream to cloud TSDB / alarms via MQTT / config via change sets
  → Cloud RDBMS (control) + TSDB (time-series)
  → Console UI (queryCollection / composables)
```

The simulator is a **second egress channel** (see §6) that bypasses the collection chain above and writes to no storage layer: it exposes the live state and control entry points of the currently running simulated network, which the BFF reads within a request and returns normalised as `ApiResponse`, with no caching and no write-back.

---

## 6. Second Data Source: The Simulator

The BFF (Nitro) has exactly two egress channels: the primary upstream (`runtimeConfig.bff.upstreamBase`, the NMS gateway) and an optional upstream (`runtimeConfig.simulator.baseUrl`, the hybrid-network simulation platform). Cross-layer verdicts, measured evidence and rejected options live in ADR-0019 §4; this section pins only the architecture-level constraints, while field-level contracts belong to `NMCPS-CONTRACT-001`.

### 6.1 Channel shape

| Piece | Landing point | Constraint |
| :--- | :--- | :--- |
| Config | `nuxt.config.ts` → `runtimeConfig.simulator` | `{ baseUrl, allowWrite, timeoutMs, readinessPath }`, all overridable via `NUXT_SIMULATOR_*`; an empty `baseUrl` means **channel disabled**, not an error |
| Config reader | `server/utils/bff/simConfig.ts` | Same shape as `getBffConfig()`: defaults in one place, trailing slash stripped, `allowWrite` strictly boolean |
| Egress | `server/utils/bff/simulator.ts` | Its own `$fetch` instance; timeout and `AbortSignal`; responses normalised to `ApiResponse` |
| Route | `server/api/sim/[...slug].ts` | Whitelist first, egress second; no match → 404 `bff_resource_not_allowed`, wrong verb → 405 |
| Whitelist | `shared/constants/simulatorRoutes.ts` | One row per entry `{ method, template, write }`; `{param}` template matching, never prefix passthrough |

### 6.2 Why it must be a separate channel

`proxyToUpstream()` in `server/api/[...slug].ts` reads the `nmcps_at` cookie and turns it into a `Bearer` header, and a 401 triggers single-flight refresh. The simulator was measured to require no auth header, so reusing that channel would send an access token to an upstream with no notion of authentication; the 401/403 semantics also differ, so a mis-triggered refresh would escalate one local failure into a lost session.

### 6.3 Whitelist philosophy

1. **Per-endpoint authorisation, never a prefix pass.** That upstream carries command execution, headless browser and credential-rotation endpoints, so a prefix pass is a full-open door.
2. **Only register what a page actually calls**, grouped by layer (topology / device networking / scenario planning / transport / spectrum / system overview); adding an entry obliges a same-batch update of the matching `NMCPS-DESIGN-*` data-source table.
3. **Permanently excluded entries need a new ADR to unlock**: `POST /api/network/nodes/{node_id}/execute` (arbitrary in-node command execution), `/api/browser/**` (headless browser and proxies, also an SSRF surface), `/api/integrity/watch/**` (long-running daemons), `/api/devices/clear`, `/api/test/**`, `/api/snmp/onboard/**`, `/api/nms/vmagent/**`.

The whitelist is not a hand-copied constant: it is derived mechanically from the simulator's `/openapi.json`, and `check:bff` assertion ⑨-6 proves "whitelist ⊆ openapi `paths`", so a renamed upstream path, a missing entry or a wrong template all surface (a stale snapshot `info.version` only warns, never reddens — an upstream patch release must not break CI).

### 6.4 Write switch

`allowWrite` defaults to `false`: every `write: true` endpoint answers 405 and the page renders read-only with a "simulator control disabled" note. Even when enabled, three constraints hold — the egress header whitelist is only `accept` / `content-type` (**no `authorization`**, never reads `nmcps_at`); each write call emits one structured BFF log line (`sim write <method> <template> <status> <duration>`, body excluded); and writes persist nothing locally, because the BFF keeps no second ledger.

### 6.5 Readiness separation

`/ready` reflects the primary upstream only. An unreachable simulator **must not** redden `/ready` — it affects just the pages that depend on it, which degrade locally (a topology page falls back to "8888 static topology only"), so an optional upstream's hiccup never becomes a site-wide outage. With no `baseUrl`, `/api/sim/**` returns 503 `simulator_not_configured`, the same shape as an unconfigured primary upstream.

### 6.6 Relationship to storage layering

The simulator is a **zero-storage data source**: the runtime state it returns (nodes, links, sessions) lives only for the request, never written back to RDBMS / TSDB; control commands are forwarded to the simulation engine while the BFF only applies the whitelist and logs. §3's layering therefore stands unchanged — simulator data is not retained historically, and metrics that need a history still come from the primary upstream's `/metric/*`.

### 6.7 Guards (shipped with P1 code)

The six assertions of `check:bff` group ⑨: unconfigured → 503 with an `ApiResponse` envelope; whitelisted path reaches the fake upstream, non-whitelisted 404, wrong verb 405; path traversal (`..`, `%2e%2e`, a segment containing `/`) → 400; `allowWrite: false` makes write endpoints 405 while `true` reaches the fake upstream; the egress carries no `authorization` and never reads `nmcps_at`; whitelist ⊆ the `/openapi.json` snapshot. Assertions land in the same batch as the code and must not be documented as passing before they exist.

---

## 7. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: data source architecture (classification, storage layering, cloud/edge adapter, data flow). |
| 2026-11-05 | 0.2.0 | Adds "§6 Second data source: the simulator": channel shape (`runtimeConfig.simulator` / `simConfig.ts` / `simulator.ts` / `server/api/sim/**` / `simulatorRoutes.ts`), why it must be separate (no Bearer egress, distinct 401 semantics), whitelist philosophy (per endpoint, grouped by layer, seven permanent exclusions, mechanically derived from `openapi.json`), write switch (`allowWrite` off by default, logging, no second ledger), readiness separation (an unreachable simulator never reddens `/ready`), the zero-storage stance and the group ⑨ guards; §2 gains a "simulator runtime" row and §5 gains the second-channel note. Delivers ADR-0019 §7 obligation 2. |
