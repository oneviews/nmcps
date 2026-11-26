---
docId: NMCPS-DESIGN-008
title: "Simulation Engine Surface Baseline"
description: "Tier 2 design baseline for domain.simulation: the session as resource root, the engine abstraction, the unified node projection, the outward channel and capability bits, and the phase boundaries. This is the single authority for the domain.simulation domain."
excerpt: "Sessions, the unified node projection and capability bits of the engine surface."
keywords:
  - "simulation"
  - "engine"
  - "session"
  - "baseline"
tier: 2
authority: normative
scope:
  - domain.simulation
status: baseline
version: 0.1.1
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-001
  - NMCPS-DESIGN-006
createdAt: "2026-11-25"
updatedAt: "2026-11-26"
icon: "carbon:network-4"
tags:
  - "Domain"
  - "Simulation"
  - "Engine"
  - "Session"
---

# Simulation Engine Surface Baseline (NMCPS-DESIGN-008)

> **Responsibility**: single authority for `domain.simulation` — it turns "how a simulation instance is created, read, started and destroyed" into verifiable interface boundaries. Scenario modeling itself lives in `NMCPS-DESIGN-006`; the only egress from the management plane to the engine surface lives in `NMCPS-ARCH-001`.
> **Audience**: implementation engineers / AI assistants.

---

## 1. Positioning

The engine surface is the **execution plane** of the lab: it owns Mininet (wired today, wireless later) and exposes exactly four kinds of facts — sessions, nodes, links, and start/stop. The management plane (Nuxt + Nitro BFF) is the only consumer; browsers never talk to the engine surface directly.

The engine surface is deployed on a dedicated lab host (one instance per host), so the design does **not** aim for concurrent instances: isolation comes from "one tenant, one host" (`NMCPS-ADR-0021`), not from several networks inside one process.

---

## 2. Resource root: the session

The resource root of 2.0 is a **session** (`sim_<12 hex chars>`), not "the one global network".

| Item | Convention |
| :--- | :--- |
| Storage | An in-process table (`mininet_gui_backend/sessions.py`); cleared on restart, never persisted |
| Ceiling | `MAX_SESSIONS = 32`; sessions must be deleted explicitly so a repeated "create" cannot eat ports and memory |
| Fields | `id` / `engine` / `name` / `state` / `created_at` / `updated_at` / `metadata` / `last_error` (only when non-empty) |
| Ownership metadata | `metadata` (`network_id` / `tenant_id` / `actor_id`) is written **by the BFF only**; client-supplied values are overwritten |
| 1.x equivalence | `/api/mininet/**` is a synonym for "the default session": with a single network no `session_id` is passed, and both channels share one instance and one in-flight write lock |

A session path that disagrees with the ledger's `session_id` is treated as "not found" (404) — the same shape as "no such session" — so the status code cannot be used to enumerate other tenants' sessions.

---

## 3. Engine abstraction

Engines are registered by name (`engines/registry.py`) with **no fallback**: an unregistered name raises "unknown engine" instead of picking "whatever works" — a fallback would turn "asked for wireless, got wired" into a silently wrong topology.

| Engine | Responsibility | Status |
| :--- | :--- | :--- |
| `wired` | Wired: start/stop plus unified node / link CRUD | Landed (M1) |
| `wireless` | Wireless: `ap` / `station` | Node creation answers 501 until M3 |
| `dryrun` | Root-free fake engine that drives the whole session chain in CI | Kept; the only unprivileged way to regression-test semantics |

- Network building is not rewritten inside engines: `TCLink` / OVS ports / `switch_fail_mode()` still come from the legacy builders, and engines only do **model mapping and error normalisation** (`engine_invalid_request` / `engine_resource_not_found` / `engine_conflict` / `engine_unavailable`).
- `import mininet` is allowed inside `engines/` only; `api.py` / `export.py` / `schema.py` / `nodes.py` / `cli.py` are a frozen legacy list guarded by a static check that fails on any new entry.
- Wireless dependencies are probed only for existence (`find_spec("mn_wifi")`); a top-level import would stop the backend from booting on hosts without them.

---

## 4. Unified nodes and links

A node is a **unified model**, not five per-type tables:

```json
{ "id": "h1", "type": "host", "name": "h1", "x": 120, "y": 80,
  "attributes": { "ip": "10.0.0.1/8", "mac": "…", "defaultRoute": "…" } }
```

| Rule | Detail |
| :--- | :--- |
| Promoted fields | `id` / `type` / `name` / `x` / `y` stay at the top level; everything else goes into `attributes` |
| Ordering | Sorted by `id`, so two reads in a row agree |
| Single projection | The projection lives only in `unified_nodes()` in `engines/wired.py`; the session-side `list_nodes()` checks the session binding first and then reuses that same function |
| 1.x read | `GET /api/mininet/nodes` is the "default session" read and does **not** check a session binding, so a session holding only `lab:read` can still load the topology |
| Node types | `host` / `router` / `switch` / `controller` / `nat` (`ap` / `station` are already in `NODE_TYPES`; canvas support arrives with M3) |
| Updates | The "update" semantics of the unified model are not frozen, and the `Engine` protocol deliberately has **no** `update_node`; position / IP / default route / OpenFlow / flows / stats still go through the 1.x per-type endpoints |

The per-type tables survive only as legacy compatibility views (`GET /hosts` and friends); their existence does not fork the write path.

---

## 5. Outward channel and capability bits

The browser only reaches same-origin BFF paths `<prefix>/**` and `<prefix>-ws/*`, whose prefix mirrors the upstream path shape (`NMCPS-ADR-0022` D11): a path without a host means the BFF, a path carrying the engine host and port is a direct upstream call (self-check scripts only).

| Channel | Endpoints | Capability |
| :--- | :--- | :--- |
| Session reads | `GET /sessions`, `/sessions/{id}`, `/sessions/{id}/{nodes,links}` | `lab:read` |
| Session creation | `POST /sessions`, `POST /sessions/{id}/nodes`, `POST /sessions/{id}/links` | `lab:create` |
| Start / stop / unlink | `POST /sessions/{id}/start` (`lab:create`), `/stop` (`lab:operate`), `DELETE /sessions/{id}/links/{link_id}` (`lab:operate`) | per row |
| Destroy / node removal | `DELETE /sessions/{id}`, `DELETE /sessions/{id}/nodes/{node_id}` | `lab:delete` |
| Terminal / capture | `<prefix>-ws/{terminal,logs,monitor,sniffer}` | `lab:terminal` / `lab:sniffer`, never derived from `lab:read` / `lab:operate` |

- Every whitelist row carries only `method` / `template` / `upstream` / `permissions`; the two upstreams are told apart by the `upstream` prefix.
- Writes share one path: audit first (both allowed and denied are recorded), 409 for a second in-flight write on the same network, and the resource inventory plus ledger `state` converge after success.
- Every WebSocket first exchanges a one-shot ticket (60 seconds, bound to kind and target) and the BFF verifies it before opening the upstream connection; the token never appears in query strings, logs, or responses.

---

## 6. Runtime state as the ledger sees it

The ledger `state` is the BFF's own enum (`creating` / `running` / `stopped` / `error`), written back **after** a successful upstream `start` / `stop` / `full_reset`, and reconciled against the upstream boolean on read: upstream `false` with a stored `running` answers `stopped`; an unreadable upstream keeps the stored value rather than guessing.

Adding or removing nodes / links, flows, `pingall` / `iperf` do **not** touch the runtime state: they can succeed on a network that was never started, and letting them write it would fabricate a fact.

---

## 7. Phases and acceptance

| Phase | Scope | Exit criteria | Status (2026-11-26) |
| :--- | :--- | :--- | :--- |
| M0 | Engine registry, session layer, BFF remote access (token + handshake), engine layering and the static guard | Contracts generated + BFF self-check; the root-free `dryrun` engine drives the whole chain in CI | Closed |
| M1 | Unified node / link CRUD, session paths in the whitelist, ledger `session_id` ownership, unified read path | Self-check counts plus a real-host regression (start/stop, bandwidth edit, real iperf) | Closed (including the M1.1 unified read path) |
| M2 | SNMP surface (topology projection, onboarding credentials) | An external `snmpwalk` returns matching OIDs | Collection side closed (`NMCPS-ADR-0028`); the credential side `snmp/onboard` has not started and needs `lab:snmp` first (`NMCPS-ADR-0027` D5) |
| M3 | Wireless + spectrum (hwsim / `hostapd` / radio read-write) | Change a channel → read back the same value → the conflict disappears (requires root) | Not started (`ap` / `station` creation still answers 501) |
| M4 | Transmission (link tc, link actions, weak network) | The htb class `rate` equals the requested value (requires root) | Partial: bandwidth edits through `PUT /links` work and were verified on a real host; link actions and weak-network shaping are not done |
| M5 | Orchestration (scenario configs, preview, build progress) | Import → preview → build → visible progress | Not started |

Dependency order: M0 → M1 → (M2 ∥ M3) → M4 → M5. M3 must not precede M1: wireless needs the unified node model and the full runtime inventory.

---

## 8. Out of scope

- **The P2 items of the reference `:8001` are not reproduced**: arbitrary command execution inside a node (`execute`), headless browser scraping (`browser/*`), VictoriaMetrics agent management (`nms/*`), integrity patrols (`integrity/*`), and subnet scanning (`scan-subnets`).
- **No double-writing**: one action, one entry point. The page has already collapsed its read path onto the unified node read; writes and updates still use the 1.x endpoints, and the page does not call the session channel directly.
- **No session persistence**: a session is a runtime fact and dies with the process; what needs to last is the ledger and the audit trail, not the session table.
- **No concurrent multi-tenancy**: on a single-instance host multi-tenancy only works as "one tenant, one host"; isolating concurrent multi-user operation is outside this document.

---

## 9. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-11-25 | 0.1.0 | First version: the simulation engine surface baseline (session as resource root, engine abstraction, unified node projection, outward channel and capability bits, ledger runtime state, phase boundaries). Covers the landed M0 / M1 / M1.1 and the entry points of the remaining phases. |
| 2026-11-26 | 0.1.1 | §7 gains a "Status" column: M0 / M1 closed, M2 collection side closed (`NMCPS-ADR-0028`) while the credential side `snmp/onboard` has not started (needs `lab:snmp`), M3 not started, M4 limited to working bandwidth edits, M5 not started. |
