---
docId: NMCPS-ARCH-002
title: "Data Source Architecture"
description: "Tier 1 architecture baseline for data sources (arch.datasource): data source classification (device collection/metrics/alarms/asset-config/lab runtime), storage layering (RDBMS control + TSDB time-series), the cloud/edge data adapter layer, unified data flow, and the second egress channel (the Mininet lab backend) with its whitelist, capability bits and readiness separation. This is the single authority for the arch.datasource domain."
excerpt: "Data source classification, RDBMS+TSDB layering, cloud/edge adapters, and the Mininet lab backend's second channel."
keywords:
  - "datasource"
  - "architecture"
  - "storage"
tier: 1
authority: normative
scope:
  - arch.datasource
status: baseline
version: 0.5.1
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-10-25"
updatedAt: "2026-11-28"
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
| Lab runtime | Node / link / run-state / flow-table state and control entry points of a lab network (optional) | Realtime, never stored | Read and forward through the BFF (see §6) |

> The first four need storage; the fifth is a **zero-storage** optional upstream with its own channel and its own readiness signal, and its absence degrades pages locally instead of taking them down. The 8001 simulator runtime held this row until 2026-11-25, when `NMCPS-ADR-0027` R8 retired it in favour of the Mininet lab backend.

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

The Mininet lab backend is the **second egress channel** (see §6): it bypasses the collection chain above and writes to no storage layer. It exposes the live state and control entry points of the current lab network, which the BFF reads within a request and returns normalised as `ApiResponse`, with no caching and no write-back.

---

## 6. Second Egress Channel: The Mininet Lab Backend

The BFF (Nitro) has exactly two egress channels: the primary upstream (`runtimeConfig.bff.upstreamBase`, the NMS gateway) and an optional upstream (`runtimeConfig.mininet.baseUrl` / `instances`, the Mininet lab backend, exposed through `/api/mininet/**` and `/mininet-ws/*`). Cross-layer verdicts live in `NMCPS-DESIGN-008` (layers/content/collections/cn/architecture/2.domain/simulation.md); listening surface, privileges, credentials and restart semantics live in `NMCPS-ARCH-007` (layers/content/collections/cn/architecture/1.architecture/lab-deployment-architecture.md).

> **The 8001 simulator channel was retired on 2026-11-25** (`NMCPS-ADR-0027` §4 R8): `/api/sim/**`, `runtimeConfig.simulator`, `SIMULATOR_ROUTES`, the openapi snapshot and `check:bff` group ⑨ were deleted in one batch — no aliases, no dual writes. The table below describes only the current channel; the rationale and impact live in the ADR.

### 6.1 Channel shape

| Piece | Landing point | Constraint |
| :--- | :--- | :--- |
| Config | `nuxt.config.ts` → `runtimeConfig.mininet` | `{ baseUrl, instances, token, timeoutMs, longTimeoutMs }`, overridable via `NUXT_MININET_*`; an empty `baseUrl` means **channel disabled**, not an error; once `instances` is set, an unmatched tenant gets 503 `tenant_runtime_unavailable` and **never falls back to the global `baseUrl`** |
| Config reader | `layers/scenario/server/utils/bff/mininetConfig.ts` | Per-tenant instance resolution (trailing slash stripped, tenant scope fails closed), defaults in one place |
| Egress | `layers/scenario/server/utils/bff/mininet.ts` (called from `[...slug].ts`) | Its own `$fetch`; 15s for reads, `longTimeoutMs` for long endpoints; the entry credential only travels as an `x-lab-token` header, never in the query string |
| Route | `layers/scenario/server/api/mininet/[...slug].ts` | Session (401/503) → path (400/404/405) → permission bit (403 `lab_permission_denied`) → ledger (404 `lab_resource_not_found`) → audit → lock → egress; writes audit first, and one network allows only one in-flight write (409) |
| Whitelist | `layers/scenario/shared/constants/mininetRoutes.ts` | One row per entry `{ method, template, upstream, permissions }`; `{param}` template matching, never prefix passthrough; unknown path 404 `bff_resource_not_allowed`, wrong verb 405 `bff_method_not_allowed`, encoded traversal 400 `bff_path_invalid` |
| Capability probe | `layers/scenario/server/api/mininet/channel.get.ts` | A static route ahead of `[...slug]`; returns only `{ configured, readOnly, writeEnabled, capabilities, endpointCount, timeoutMs, readinessPath }` and **never `baseUrl`**; the page renders entries from `capabilities` |
| WebSocket | `/mininet-ws/*` + `POST /api/mininet/ws-ticket` | A 60-second single-use ticket bound to `kind` + `target`; the browser never connects to `:8000` directly and the upstream address never reaches it |

### 6.2 Why it must be a separate channel

`proxyToUpstream()` in `server/api/[...slug].ts` reads the `nmcps_at` cookie and turns it into a `Bearer` header, triggering single-flight refresh on 401. The lab backend authenticates with an entry credential (`x-lab-token`) plus loopback trust, and has no notion of `Bearer`; reusing the gateway would send an access token to an upstream that cannot use it, and the differing 401/403 semantics would escalate one local failure into a lost session. The lab backend also carries privileged operations (terminal / sniffer / rebuild), so permission bits, audit and in-flight write exclusion all close inside this channel instead of being layered onto a generic proxy.

### 6.3 Whitelist philosophy

1. **Per-endpoint authorisation, never a prefix pass.** That upstream carries command execution, headless browser and credential-rotation capabilities, so a prefix pass is a full-open door.
2. **Only register what a page actually calls**, authorised entry by entry through capability bits (`lab:read` / `lab:create` / `lab:operate` / `lab:delete` / `lab:terminal` / `lab:sniffer`); adding an entry obliges a same-batch update of the matching `NMCPS-DESIGN-*` data-source table.
3. **Permanently excluded entries need a new ADR to unlock**: in-node arbitrary command execution (`execute`), headless browser (`browser`), integrity inspection (`integrity`), device library (`devices`), standalone probes (`test`), SNMP onboarding (`snmp/onboard`), external monitoring stack (`nms/vmagent`). These are verdicts R1–R7 of `NMCPS-ADR-0027`, not "not done yet".

The whitelist is not a hand-copied constant: `check:lab-bff` ⓪ reconciles it line by line as "24 queries + 42 writes = 66", while `check:engines` / `check:simulation` guard the engine face and the external backend; any added or renamed endpoint must change the whitelist and its assertions in the same batch.

### 6.4 Write capability bits

There is no coarse `allowWrite` boolean: write capability is the intersection of **the endpoint's declared permission** and **the session's capability bits**. The page first reads `capabilities` from `GET /api/mininet/channel`; unauthorised actions are not rendered and send no request, and the BFF's 403 `lab_permission_denied` remains the only permission boundary and the race-condition backstop. Writes still obey three constraints: the egress headers are limited to `accept` / `content-type` / `x-lab-token` (client `authorization` and cookies are never forwarded); every write emits one **structured audit** line first (`.data/audit/lab-audit-<date>.jsonl`: method / path / status / duration / `requestId` / client IP, **body excluded**), and a failed audit write answers 503 `audit_unavailable` rather than "do first, log later"; one network allows only one in-flight write (409 `lab_operation_in_progress`), so two tabs cannot edit the same network at once.

### 6.5 Readiness separation

`/ready` reflects the primary upstream only. An unreachable lab backend **must not** redden `/ready` — it affects just the pages that depend on it, which degrade locally (the topology monitor falls back to "8888 static topology only"), so an optional upstream's hiccup never becomes a site-wide outage. With no `baseUrl`, `/api/mininet/**` returns 503 `mininet_not_configured`, the same shape as an unconfigured primary upstream. The failure vocabulary lives in `MININET_MESSAGES` (`shared/constants/upstreamReasons.ts`: `notConfigured` / `unreachable` / `timeout` / `baseInvalid` / `tenantRuntimeUnavailable` / `resourceNotFound` / `permissionDenied` …), so the front end tells "channel is off", "tenant has no instance", "the ledger has no such network" and "the backend is down" by message rather than by status code.

The page keeps those three apart (`NMCPS-DESIGN-001` §8): `disabled` (deployment shape: no instance) and `empty` (usage shape: no lab network yet, 404 `lab_resource_not_found`) raise no banner; only a real read failure becomes `unreachable`.

### 6.6 Relationship to storage layering

The lab backend is a **zero-storage data source**: the runtime state it returns (nodes, links, run state, flow tables) lives only for the request, and the BFF writes nothing but "whose network is this" into its local ledger (`.data/lab-ledger.json`, control-plane metadata rather than a data copy) — never back to RDBMS / TSDB; control commands are forwarded to the backend while the BFF only applies permissions, audit and exclusion. §3's layering therefore stands unchanged: lab data is not retained historically, and metrics that need a history still come from the primary upstream's `/metric/*`.

### 6.7 Guards

After the retirement this channel is no longer covered by `check:bff` group ⑨ (deleted together with `/api/sim/**`); three self-checks take over:

| Check | Coverage |
| :--- | :--- |
| `pnpm check:lab-bff` | ⓪ whitelist count and line-by-line reconciliation; sessions / ledger ownership / permission bits / audit fail-closed / in-flight 409 / WebSocket tickets; page read path and write endpoints |
| `pnpm check:simulation` / `pnpm check:engines` | Session semantics of the external backend and engine-layer isolation (`import mininet` only inside `engines/` plus the frozen legacy files) |
| `pnpm check:ui` | Page side: capability trimming, the `disabled` / `empty` / `unreachable` states, link-action end to end (the fake upstream records what actually arrived) |

---

## 7. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: data source architecture (classification, storage layering, cloud/edge adapter, data flow). |
| 2026-11-05 | 0.2.0 | Adds "§6 Second data source: the simulator": channel shape (`runtimeConfig.simulator` / `simConfig.ts` / `simulator.ts` / `server/api/sim/**` / `simulatorRoutes.ts`), why it must be separate (no Bearer egress, distinct 401 semantics), whitelist philosophy (per endpoint, grouped by layer, seven permanent exclusions, mechanically derived from `openapi.json`), write switch (`allowWrite` off by default, logging, no second ledger), readiness separation (an unreachable simulator never reddens `/ready`), the zero-storage stance and the group ⑨ guards; §2 gains a "simulator runtime" row and §5 gains the second-channel note. Delivers ADR-0019 §7 obligation 2. |
| 2026-11-05 | 0.3.0 | **Pre-code obligation 4 is now fulfilled: the group ⑨ guards ship with the P1 code (`pnpm check:bff` 127/127).** ① `scripts/fixtures/simulator-openapi.json` is new — a mechanical projection of the upstream `/openapi.json` (113 paths → verb lists plus `_meta.source/capturedAt`), refreshable only via `NUXT_SIMULATOR_BASE_URL=<upstream> pnpm check:bff --refresh-simulator-snapshot`, with a `capturedAt` older than 180 days merely warning. ② `check:bff` gained group ⑨ (21 checkpoints) mapped one-to-one onto ⑨-1~⑨-6 (table in §6.7); the fake simulator `startSimulator()` (`scripts/lib/bff-harness.mjs`) records request headers **on the upstream side**, which is what proves the egress carries no `authorization` and never trades the `nmcps_at` cookie for a Bearer. ③ The §6.1 route row now names `server/api/sim/index.ts`: a path-less `/api/sim` answers 400 `bff_path_missing` instead of falling through to the primary gateway and reporting "path not allowed" for what was really a missing path. ④ §6.5 gained the `SIMULATOR_MESSAGES` vocabulary. ⑤ Reverse-checked: changing one whitelist template to `/api/network/stats-v2` reddens ⑨-6 and names that entry. |
| 2026-11-06 | 0.4.0 | **With write entries open, the write gate moved forward to the page**: §6.1 gained the capability-probe row `server/api/sim/channel.get.ts` (a static route ahead of the catch-all channel; returns `configured` / `writeEnabled` / `timeoutMs` / `readinessPath` and **never `baseUrl`**); §6.4 upgraded "one structured log line" into a **single-line JSON audit record** `{"event":"simulator.write",…}` (with `path` / `requestId` / `clientIp`, still no body) and documented why the record carries no actor identity and how to join it instead (the identity cookie is scoped to `/api/auth`, so join on `requestId` against the gateway access log); with `allowWrite=false` the page sends zero write requests and the BFF's 405 becomes the second gate for bypassing the front end. `check:ui` section 11 grew to `139/139` (new A9 plus the assertion that the probe leaks no address). |
| 2026-11-25 | 0.5.0 | **The second egress channel changes hands: the 8001 simulator is retired and the Mininet lab backend is registered (`NMCPS-ADR-0027` R8 step 4).** ① §6 was rewritten for `/api/mininet/**`: config (`runtimeConfig.mininet` with `baseUrl` / `instances`; an unmatched tenant gets 503 `tenant_runtime_unavailable`, never a fallback to the global base URL), config reader (`layers/scenario/server/utils/bff/mininetConfig.ts`), egress (`mininet.ts`, entry credential only via `x-lab-token`), route and whitelist (`layers/scenario/server/api/mininet/[...slug].ts` + `mininetRoutes.ts`; unknown path 404 / wrong verb 405 / traversal 400), capability probe (`GET /api/mininet/channel`, capability bits only, never `baseUrl`) and WebSocket (single-use ticket + `/mininet-ws/*`). ② The write switch became **capability bits**: no `allowWrite` boolean; the page trims by `capabilities`, the BFF's 403 is the only permission boundary, audit is written first (a failed write answers 503 `audit_unavailable`), and one in-flight write per network (409). ③ Readiness separation stays: an unreachable lab backend never reddens `/ready`, and `disabled` / `empty` / `unreachable` mean "no instance" / "no lab network yet" / "a real read failure". ④ The guards moved: `check:bff` group ⑨ (21 checkpoints, the `simulator-openapi.json` snapshot, `--refresh-simulator-snapshot`) was deleted together with `/api/sim/**`, `simulatorRoutes.ts`, `simConfig.ts` / `simulator.ts`, `SIMULATOR_MESSAGES` and the `simulator` block in `nuxt.config.ts`; coverage now comes from `check:lab-bff` / `check:simulation` / `check:engines` / `check:ui`. ⑤ The §2 classification row and the §5 data-flow note were renamed to match. |
| 2026-11-28 | 0.5.1 | **Whitelist counts synced after `NMCPS-ADR-0029` M1.2 landed**: the §6.3 reconciliation wording moves from "24 queries + 40 writes = 64" to "24 queries + 42 writes = 66" — two session-side update PATCHes were added (`PATCH /sessions/{session_id}/nodes/{node_id}` / `.../links/{link_id}`, `lab:operate`), and `GET /api/mininet/channel` now reports `endpointCount` 66 (`check:lab-bff` ⓪ / ① / ⑰ and the `check:ui` capability probe assertion changed in the same batch). |

