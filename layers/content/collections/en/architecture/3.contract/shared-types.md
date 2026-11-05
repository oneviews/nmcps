---
docId: NMCPS-CONTRACT-001
title: "Shared Types Contract"
description: "Tier 3 contract baseline for shared types (contract.shared-types): naming conventions, directory organization, reuse rules, and the no-any / null-semantics hard constraints for cross-module shared types, registering the `/api/v1/auth` DTOs in `shared/types/auth.ts` and the simulator entity types in `shared/types/simulator.ts`. This is the single authority for the contract.shared-types domain."
excerpt: "Naming, directory organization, reuse rules and the simulator entity contract for shared types."
keywords:
  - "contract"
  - "shared-types"
  - "types"
tier: 3
authority: normative
scope:
  - contract.shared-types
status: baseline
version: 0.4.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-002
createdAt: "2026-10-25"
updatedAt: "2026-11-05"
icon: "carbon:data-class"
tags:
  - "Contract"
  - "Types"
  - "Shared"
---

# Shared Types Contract (NMCPS-CONTRACT-001)

> **Responsibility**: single authority for `contract.shared-types` — how cross-module shared types are named, organized, and reused. Data source: `NMCPS-ARCH-002`; governance: `NMCPS-GOV-001`.
> **Audience**: implementation engineers / AI assistants.

---

## 1. Positioning

The shared types contract is the "language convention" for cross-module collaboration: any type reused by multiple modules (layers) is defined once here, and referenced everywhere else — never copy-pasted.

---

## 2. Naming Conventions

| Object | Convention | Example |
| :--- | :--- | :--- |
| Interface/type | PascalCase, semantic noun | `MetricDatapoint` |
| Union type | Lowercase literal union | `MetricType = 'counter' \| 'gauge'` |
| Type file | kebab-case, per-domain | `metric.ts` / `topology.ts` |
| Directory | `shared/types/` | Single cross-module entry |

---

## 3. Directory Organization

```text
shared/
  types/          # cross-module shared types (single source of truth)
    metric.ts
    topology.ts
    iam.ts
    ...
  constants/      # pure data constants (docId ↔ path mapping, etc.)
    docIds.ts
```

`shared/constants/docIds.ts` is pure data + pure functions (no Nuxt aliases, no IO, no side effects), shared by Nuxt and node scripts.

---

## 4. Reuse Hard Constraints

1. **No `any`**: use `unknown` or explicit unions; never let `any` leak through.
2. **null semantics**: unknown/missing is `null`; never fake truth with `0`, empty string, or `'unknown'`; `0` is a valid truth.
3. **Single source of truth**: each type is defined once; derived values are never assigned independently (mark "derived, see source").
4. **Forward compatibility**: new fields are optional (`?`); removal goes through `deprecated` first.

---

## 5. Existing Shared Types

| Type | Location | Note |
| :--- | :--- | :--- |
| `DocId` / `DOC_PATHS` | `shared/constants/docIds.ts` | docId ↔ path unique mapping |
| `LayoutMode` / `UserPreferences` | `layers/user/app/composables/useUserPreferences.ts` | Layout preference types |
| `ApiResponse` / `ApiStatus` / `ApiError` | `shared/types/api.ts` / `shared/utils/apiGuard.ts` | Unified response envelope and type guards |
| `AuthUser` / `AuthTokens` / `AuthLoginPayload` / `AuthLoginResult` / `AuthRefreshResult` / `AuthSessionState` | `shared/types/auth.ts` | `/api/v1/auth` contract: field names stay upstream camelCase (`accountCode` / `accountLevel` / `sessionId`…) with **no snake_case conversion**; the BFF only normalises the error envelope's `msg` into `message` and passes business fields through verbatim; missing semantics (e.g. login has no `displayName`) are `null`, never a look-alike field |

| `SimulatorRuntimeInventory` / `SimulatorRuntimeNode` / `SimulatorRuntimeLink` / `SimulatorNetworkStats` / `SimulatorLldpSummary` / `SimulatorLldpNeighbor` / `SimulatorSessionList` / `SimulatorSessionStatus` / `SimulatorMetricsSummary` / `SimulatorMetricsCurrent` | `shared/types/simulator.ts` | 8001 simulator entity contract, fields stay upstream `snake_case`; see §6 of this contract |
| `TopologyGraph` / `TopologyGraphNode` / `TopologyGraphLink` / `TopologyCombo` / `TopologyGraphQuery` | `shared/types/topology.ts` | 8888 `GET /topology/graph` contract: a node `id` is its management IP, `status` uses the numeric `1/2/0` convention and link `bandwidth` is measured as `0`; see §7 of this contract |

> As S2 domain baselines land, `metric` contract types will migrate into `shared/types/`; this contract registers them as they evolve (`topology` landed on 2026-11-05).

---

## 6. Simulator Entity Contract (`shared/types/simulator.ts`)

Every entity type of the 8001 simulator lives in `shared/types/simulator.ts`, the **single** type source shared by BFF `server/api/sim/**` responses, the `NMCPS-DESIGN-*` pages that consume them, and the fake upstream used by `check:bff`. Field shapes come from the 2026-11-05 measured responses and `openapi.json` (113 paths / 40 schemas).

### 6.1 Naming and field conventions (this family is an explicit exception)

| Rule | Note |
| :--- | :--- |
| **Keep upstream `snake_case`** | Same stance as `MetricCatalogItem` (`NMCPS-CONTRACT-002`): upstream fields pass through untouched with no camelCase conversion; only BFF-authored fields (the error envelope's `message`) differ |
| **Unit-bearing fields stay `string`** | `bandwidth: "4000Mbps"`, `delay: "2ms"`, `loss: "0%"`; numeric conversion belongs to page-level pure functions (`parseBandwidthMbps` / `parseDelayMs` / `parseLossPct`), **never to the type layer** |
| **Nullables are explicit `\| null`** | Fields measured as `null` (`mac_address` / `weaknet_config` / `protocol_config` / `radio` / `real_stats` / `tc` / `scenario`) are `\| null`; an optional `?:` must never hide "the upstream explicitly said null" |
| **Unsurveyed sub-objects stay opaque** | Sub-objects not measured field by field become `SimulatorOpaqueObject = Record<string, unknown>`; `any` is banned |
| **Wire format and enums are separate** | Wire fields keep `string` (the upstream adds values), with dedicated unions plus guards (`SimulatorNodeType` / `SimulatorLinkType` / `SimulatorSessionState`) for narrowing; every guard needs an `unknown` fallback branch |

### 6.2 Entity types

| Type | Upstream endpoint | Note |
| :--- | :--- | :--- |
| `SimulatorHealth` | `GET /api/health` | `status` / `app` / `engine_available[]` / `regulatory` (measured `US`) |
| `SimulatorRuntimeInventory` | `GET /api/network/runtime-inventory` | **the single runtime entry point**: `running` / `scenario` / `overrides` / `nodes[]` / `links[]` |
| `SimulatorRuntimeNode` | `nodes[]` of the same call | join keys against 8888 nodes: `id` / `name` / `ip_address`; rendering uses `x` / `y`; state is `status` |
| `SimulatorRuntimeLink` | `links[]` of the same call | `source` / `target` plus both interfaces; `type` separates `wired` / `wireless`; `bandwidth` / `delay` / `loss` are unit-bearing strings |
| `SimulatorNetworkStats` | `GET /api/network/stats` | `nodes_by_type` / `links_by_type` are `Record<string, number>` with **dynamic keys** (measured `router` 3 / `switch` 6 / `ap` 18 / `station` 9) |
| `SimulatorLldpSummary` / `SimulatorLldpNeighbor` | `GET /api/lldp/summary`, `/api/lldp/neighbors/{node_id}` | `mib_oids` is `Record<string, string>`; `discovered_at` is an upstream local-time string **without a timezone** — never feed it to `new Date()` as if it were UTC |
| `SimulatorSessionList` / `SimulatorSession` / `SimulatorSessionStatus` | `GET /api/simulation/sessions`, `/api/simulation/sessions/{sim_id}/status` | list envelope `{ count, items[] }`; `status.build_timing.phases[]` carries boot progress (`msg` / `pct` / `d_s`) |
| `SimulatorMetricsSummary` | `GET /api/metrics/summary/{sim_id}` | `sample_count` / `tick_count` / `avg_utilization_pct` / `avg_rtt_ms` / `avg_loss_pct` |
| `SimulatorMetricsCurrent` / `SimulatorMetricsSample` | `GET /api/metrics/current/{sim_id}` | per-link samples: `utilization_pct` / `rtt_ms` / `loss_pct` / `jitter_us` / `*_age_s` / `jitter_valid`; `at` is an upstream local-time string |

### 6.3 Key fields (measured shapes, for implementation)

```ts
export type SimulatorOpaqueObject = Record<string, unknown>

export interface SimulatorRuntimeInventory {
  running: boolean
  scenario: string | null
  overrides: {
    exists: boolean
    updated_at: string | null
    node_count: number
    link_count: number
    topology_count: number
  }
  nodes: SimulatorRuntimeNode[]
  links: SimulatorRuntimeLink[]
}

export interface SimulatorRuntimeNode {
  id: string
  name: string
  type: string                     // router | switch | ap | station | …
  status: string                   // online | offline | …
  x: number | null
  y: number | null
  interfaces: SimulatorOpaqueObject[]
  ip_address: string | null
  mac_address: string | null
  device_type: string
  role: string | null
  ports: Array<{ name: string, ip: string }>
  weaknet_config: SimulatorOpaqueObject | null
  protocol_config: SimulatorOpaqueObject | null
  radio: SimulatorOpaqueObject | null
}

export interface SimulatorRuntimeLink {
  id: string
  source: string
  target: string
  source_interface: string | null
  target_interface: string | null
  type: string                     // wired | wireless
  status: string                   // up | down
  bandwidth: string | null         // "4000Mbps" (kept as a string)
  delay: string | null             // "2ms"
  loss: string | null              // "0%"
  real_stats: SimulatorOpaqueObject | null
  weaknet_config: SimulatorOpaqueObject | null
  protocol_config: SimulatorOpaqueObject | null
  tc: SimulatorOpaqueObject | null
}
```

### 6.4 Relationship to BFF egress

1. **The type is the normalised egress shape**: `server/utils/bff/simulator.ts` only wraps upstream JSON in the `ApiResponse` envelope (with the entities above as `data`) — no field renaming, no unit conversion, no default filling.
2. **No channel, no entity**: an empty `baseUrl` yields `503 simulator_not_configured`, so the page receives an error envelope rather than an "empty entity"; the UI must render those two states differently (empty state vs not-connected state).
3. **Write endpoints have no response contract**: `POST` / `PATCH` / `DELETE` only guarantee the `ApiResponse` envelope; pages render from success plus a follow-up `runtime-inventory` refresh and never depend on a write response body.

---

## 7. 8888 Topology Graph Contract (`shared/types/topology.ts`)

The topology structure on `/topology/monitor` comes from the primary upstream `GET /api/v1/topology/graph` (BFF `/api/topology/graph`). Field shapes come from the 1.0 read-only consumer of that **same** endpoint (2026-10-14: 36 nodes / 47–48 links / 3 combos, see `normalizeTopologyInput()` in `_reference/nmcps-v1/shared/connector/topologyAdapt.ts`); it is a different channel from the 8001 runtime inventory (§6).

| Object | Measured shape | Implementation notes |
| :--- | :--- | :--- |
| Envelope | Either flat or wrapped in one `data` level; after the BFF gateway wraps it in `ApiResponse`, `data` is the graph object | Pages only read `data` and never unwrap the envelope themselves |
| Node | `id` (**management IP**) / `name` \| `hostname` \| `label` / `ip` / `category` / `type` / `status` / `tier` / `icon` / `brand` / `color` / `sysDescr` | `id` is an IP, so the display name falls back `name → hostname → label → id`; `tier` was only ever 2 / 4 |
| `status` | Numeric convention `1=online / 2=warning / 0=offline`, but strings also appear | Normalisation lives in `app/utils/graph/topologyNormalize.ts`; the type layer never guesses |
| Link | `source` / `target` / `bandwidth` / `linkType` / `status` / `bandwidth_util_pct` / `sourcePort` / `targetPort` | Both key names `edges` / `links` have appeared; `bandwidth` is measured as **0 everywhere** (no real value) ⇒ pages must not render 0 as bandwidth |
| Combo | `combos[]` (3 measured), fields not surveyed one by one | Counted by `id` only; it does not feed the layout |

Three hard rules:

1. **No renaming, no default filling**: normalisation (status → union, `tier` default, display-name fallback) happens only in pure functions such as `app/utils/graph/topologyNormalize.ts`; the type layer keeps the wire format.
2. **`0` is not "absent"**: `bandwidth: 0` means "not measured", not "zero bandwidth"; this family follows the §4 null semantics, so missing means `null`.
3. **Unsurveyed fields are not declared**: further `combos` fields and the `sysDescr` encoding get added after measurement — always change this document before the type (§4 forward compatibility).

---

## 8. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: shared types contract (naming, organization, reuse constraints, existing types). |
| 2026-10-31 | 0.2.0 | Registered `shared/types/api.ts` and `shared/types/auth.ts`: verbatim upstream fields, `msg` → `message` normalisation, missing means `null`. |
| 2026-11-05 | 0.3.0 | Added "§6 Simulator entity contract": registered the `shared/types/simulator.ts` type list (`SimulatorHealth` / `SimulatorRuntimeInventory` / `SimulatorRuntimeNode` / `SimulatorRuntimeLink` / `SimulatorNetworkStats` / `SimulatorLldpSummary` / `SimulatorLldpNeighbor` / `SimulatorSessionList` / `SimulatorSessionStatus` / `SimulatorMetricsSummary` / `SimulatorMetricsCurrent`), fixed the family's five exceptions (snake_case pass-through, unit-bearing fields stay strings, explicit `\| null`, `SimulatorOpaqueObject` for unsurveyed sub-objects, enums separate from the wire format with an `unknown` fallback), and recorded the measured key shapes. Lands ADR-0019 §7 obligation 3. |
| 2026-11-05 | 0.4.0 | Added "§7 8888 topology graph contract" and landed `shared/types/topology.ts` (`TopologyGraph` / `TopologyGraphNode` / `TopologyGraphLink` / `TopologyCombo` / `TopologyGraphQuery` plus three status unions). §5 now registers the family, and `shared/types/simulator.ts` was created with the §6.3 measured shapes — the earlier registration described a file that did not exist yet, so this release pays that docs-first debt down. Three rules went into the prose: a node `id` is its management IP (alignment with the 8001 inventory goes through `ip_address`), `bandwidth: 0` means "not measured" rather than zero bandwidth, and further `combos` fields are added only after measurement. |
