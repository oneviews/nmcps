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
version: 0.4.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-10-25"
updatedAt: "2026-11-06"
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
| Route | `server/api/sim/[...slug].ts` (a path-less `/api/sim` is answered 400 `bff_path_missing` by `server/api/sim/index.ts`, never by the primary gateway) | Whitelist first, egress second; no match → 404 `bff_resource_not_allowed`, wrong verb → 405 |
| Whitelist | `shared/constants/simulatorRoutes.ts` | One row per entry `{ method, template, write }`; `{param}` template matching, never prefix passthrough |
| Capability probe | `server/api/sim/channel.get.ts` | A static route wins over the `[...slug]` channel; returns only `{ configured, writeEnabled, timeoutMs, readinessPath }` and **never `baseUrl`** (the upstream address is not leaked to the browser), so the page decides button state from `writeEnabled` |

### 6.2 Why it must be a separate channel

`proxyToUpstream()` in `server/api/[...slug].ts` reads the `nmcps_at` cookie and turns it into a `Bearer` header, and a 401 triggers single-flight refresh. The simulator was measured to require no auth header, so reusing that channel would send an access token to an upstream with no notion of authentication; the 401/403 semantics also differ, so a mis-triggered refresh would escalate one local failure into a lost session.

### 6.3 Whitelist philosophy

1. **Per-endpoint authorisation, never a prefix pass.** That upstream carries command execution, headless browser and credential-rotation endpoints, so a prefix pass is a full-open door.
2. **Only register what a page actually calls**, grouped by layer (topology / device networking / scenario planning / transport / spectrum / system overview); adding an entry obliges a same-batch update of the matching `NMCPS-DESIGN-*` data-source table.
3. **Permanently excluded entries need a new ADR to unlock**: `POST /api/network/nodes/{node_id}/execute` (arbitrary in-node command execution), `/api/browser/**` (headless browser and proxies, also an SSRF surface), `/api/integrity/watch/**` (long-running daemons), `/api/devices/clear`, `/api/test/**`, `/api/snmp/onboard/**`, `/api/nms/vmagent/**`.

The whitelist is not a hand-copied constant: it is derived mechanically from the simulator's `/openapi.json`, and `check:bff` assertion ⑨-6 proves "whitelist ⊆ openapi `paths`", so a renamed upstream path, a missing entry or a wrong template all surface (a stale snapshot `info.version` only warns, never reddens — an upstream patch release must not break CI).

### 6.4 Write switch

`allowWrite` defaults to `false`: every `write: true` endpoint answers 405 and the page renders read-only with a "simulator control disabled" note. The page does not guess: it reads the capability probe `GET /api/sim/channel` (§6.1) first, and with `writeEnabled=false` the buttons are `disabled` and it sends **not a single write request** — the BFF's 405 is only the second gate for a caller that bypasses the front end. Even when enabled, three constraints hold — the egress header whitelist is only `accept` / `content-type` (**no `authorization`**, never reads `nmcps_at`); each write call emits one **structured audit line** (a single JSON line so a log pipeline can parse it: `{"event":"simulator.write","method":…,"template":…,"path":…,"status":…,"durationMs":…,"requestId":…,"clientIp":…}`, body excluded); and writes persist nothing locally, because the BFF keeps no second ledger. The audit line carries no actor identity: the identity cookie (`nmcps_ui`) is scoped to `/api/auth`, which the simulator channel cannot read at all — when "who clicked it" matters, join on `requestId` against the gateway access log instead of keeping a second copy of identities inside the BFF.

### 6.5 Readiness separation

`/ready` reflects the primary upstream only. An unreachable simulator **must not** redden `/ready` — it affects just the pages that depend on it, which degrade locally (a topology page falls back to "8888 static topology only"), so an optional upstream's hiccup never becomes a site-wide outage. With no `baseUrl`, `/api/sim/**` returns 503 `simulator_not_configured`, the same shape as an unconfigured primary upstream. This channel's failure vocabulary lives in `SIMULATOR_MESSAGES` (`shared/constants/upstreamReasons.ts`: `notConfigured` / `unreachable` / `timeout` / `writeDisabled` / `baseInvalid`), so the front end tells "channel is off" from "simulator is down" by message rather than by status code.

### 6.6 Relationship to storage layering

The simulator is a **zero-storage data source**: the runtime state it returns (nodes, links, sessions) lives only for the request, never written back to RDBMS / TSDB; control commands are forwarded to the simulation engine while the BFF only applies the whitelist and logs. §3's layering therefore stands unchanged — simulator data is not retained historically, and metrics that need a history still come from the primary upstream's `/metric/*`.

### 6.7 Guards (`check:bff` group ⑨, shipped with the P1 code)

Six assertions, split into 21 checkpoints, landed with the code (`pnpm check:bff` measured 127/127 green):

| Assertion | Covers | Criterion |
| :--- | :--- | :--- |
| ⑨-1 | Channel disabled / path-less | No `baseUrl` → 503 `simulator_not_configured` with an `ApiResponse` envelope and zero upstream hits; `/api/sim` and `/api/sim/` → 400 `bff_path_missing` (never the primary gateway's 404) |
| ⑨-2 | Whitelist boundary | A whitelisted path reaches the fake upstream and is wrapped in the envelope; anything else 404 `bff_resource_not_allowed`; the permanent exclusions (`browser` / `execute` / `test`) also 404; wrong verb (GET on a POST-only endpoint) → 405 `bff_method_not_allowed` |
| ⑨-3 | Path traversal | Encoded traversal (`%2e%2e%2f`) → 400 `bff_path_invalid` |
| ⑨-4 | Both sides of the write switch | `allowWrite: false` → write endpoints 405 `simulator_write_disabled` with zero upstream hits; `true` → reaches the upstream with verb and path intact |
| ⑨-5 | Egress headers | When the client sends `authorization` and an `nmcps_at` cookie, both are absent from the headers **recorded on the fake upstream** (ask the upstream, not the BFF) |
| ⑨-6 | Whitelist ⊆ snapshot | All 23 entries proved "path + verb" ∈ `scripts/fixtures/simulator-openapi.json` (a mechanical projection of `/openapi.json`: 113 paths); an empty extraction reddens |

The snapshot has exactly one refresh entry: `NUXT_SIMULATOR_BASE_URL=http://<host>:8001 pnpm check:bff --refresh-simulator-snapshot` (rewrites `_meta.capturedAt` and `paths`). A `_meta.capturedAt` older than 180 days only prints `⚠️` and never reddens — an upstream patch release must not break CI. Conversely, mistyping one whitelist template (measured with `/api/network/stats-v2`) makes ⑨-6 name that exact entry, so the guard is not decorative.

---

## 7. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: data source architecture (classification, storage layering, cloud/edge adapter, data flow). |
| 2026-11-05 | 0.2.0 | Adds "§6 Second data source: the simulator": channel shape (`runtimeConfig.simulator` / `simConfig.ts` / `simulator.ts` / `server/api/sim/**` / `simulatorRoutes.ts`), why it must be separate (no Bearer egress, distinct 401 semantics), whitelist philosophy (per endpoint, grouped by layer, seven permanent exclusions, mechanically derived from `openapi.json`), write switch (`allowWrite` off by default, logging, no second ledger), readiness separation (an unreachable simulator never reddens `/ready`), the zero-storage stance and the group ⑨ guards; §2 gains a "simulator runtime" row and §5 gains the second-channel note. Delivers ADR-0019 §7 obligation 2. |
| 2026-11-05 | 0.3.0 | **Pre-code obligation 4 is now fulfilled: the group ⑨ guards ship with the P1 code (`pnpm check:bff` 127/127).** ① `scripts/fixtures/simulator-openapi.json` is new — a mechanical projection of the upstream `/openapi.json` (113 paths → verb lists plus `_meta.source/capturedAt`), refreshable only via `NUXT_SIMULATOR_BASE_URL=<upstream> pnpm check:bff --refresh-simulator-snapshot`, with a `capturedAt` older than 180 days merely warning. ② `check:bff` gained group ⑨ (21 checkpoints) mapped one-to-one onto ⑨-1~⑨-6 (table in §6.7); the fake simulator `startSimulator()` (`scripts/lib/bff-harness.mjs`) records request headers **on the upstream side**, which is what proves the egress carries no `authorization` and never trades the `nmcps_at` cookie for a Bearer. ③ The §6.1 route row now names `server/api/sim/index.ts`: a path-less `/api/sim` answers 400 `bff_path_missing` instead of falling through to the primary gateway and reporting "path not allowed" for what was really a missing path. ④ §6.5 gained the `SIMULATOR_MESSAGES` vocabulary. ⑤ Reverse-checked: changing one whitelist template to `/api/network/stats-v2` reddens ⑨-6 and names that entry. |
| 2026-11-06 | 0.4.0 | **With write entries open, the write gate moved forward to the page**: §6.1 gained the capability-probe row `server/api/sim/channel.get.ts` (a static route ahead of the catch-all channel; returns `configured` / `writeEnabled` / `timeoutMs` / `readinessPath` and **never `baseUrl`**); §6.4 upgraded "one structured log line" into a **single-line JSON audit record** `{"event":"simulator.write",…}` (with `path` / `requestId` / `clientIp`, still no body) and documented why the record carries no actor identity and how to join it instead (the identity cookie is scoped to `/api/auth`, so join on `requestId` against the gateway access log); with `allowWrite=false` the page sends zero write requests and the BFF's 405 becomes the second gate for bypassing the front end. `check:ui` section 11 grew to `139/139` (new A9 plus the assertion that the probe leaks no address). |
