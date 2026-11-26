---
docId: NMCPS-ARCH-007
title: "Lab Deployment and Runtime Architecture"
description: "Tier 1 baseline for arch.lab-deploy: the listening surface and port ownership of the lab backend and the BFF, the privilege model and restart invariants, entry credentials (x-lab-token plus the WebSocket HMAC signature), the tenant-to-instance registry, ledger and restart semantics, the open deployment decisions, and what each acceptance command can and cannot prove."
excerpt: "The single baseline for the lab listening surface, privileges, credentials and restart semantics."
keywords:
  - "lab"
  - "deployment"
  - "privilege"
  - "token"
  - "ports"
tier: 1
authority: normative
scope:
  - arch.lab-deploy
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-11-25"
updatedAt: "2026-11-25"
icon: "carbon:server"
tags:
  - "Architecture"
  - "Lab"
  - "Deployment"
  - "Credentials"
---

# Lab Deployment and Runtime Architecture (NMCPS-ARCH-007)

> **This document owns**: the single authority for `arch.lab-deploy` — where the lab surface runs, as which identity, who may connect, how credentials travel, and what a restart loses.
> **Out of scope**: the engine kernel and its business semantics (`NMCPS-DESIGN-008`, layers/content/collections/cn/architecture/2.domain/simulation.md); the BFF whitelist and capability bits (`NMCPS-ADR-0022`, layers/content/collections/cn/records/adr/adr-0022.md); the tenant isolation ruling (`NMCPS-ADR-0021`, layers/content/collections/cn/records/adr/adr-0021.md); long-operation budgets (`NMCPS-ADR-0026`, layers/content/collections/cn/records/adr/adr-0026.md).
> **Audience**: implementation, operations and troubleshooting engineers / AI assistants.

---

## 1. Positioning

The lab surface holds privileged in-process state (`app.net`), one entry credential and one tenant-addressed instance registry. All three fail the same way: a misconfiguration stays silent until one specific action breaks. That is why they are stated here as assertable constraints rather than deployment notes.

Three invariants:

1. **The listening surface is enumerable**: every port has exactly one owning process, and the browser is never one of them.
2. **Identity is decidable**: whether a process can bring up a real network depends only on privilege, never on a configuration flag.
3. **Credentials are rotatable**: HTTP carries a header, WebSocket carries a signature; the secret never enters a query string and never reaches a log.

The criteria come from code, not preference: `services/mininet-api/mininet_gui_backend/auth.py` (credentials and signature), `layers/scenario/server/utils/bff/mininetConfig.ts` (instances and timeouts), and `runtimeConfig.mininet` / `runtimeConfig.lab` in `nuxt.config.ts` (defaults).

---

## 2. Listening surface and port ownership

| Process | Default listener | Who may connect | Constraint |
| :--- | :--- | :--- | :--- |
| Mininet API (`uvicorn mininet_gui_backend.api:app`) | `127.0.0.1:8000` (`pnpm dev:lab-api`) | Only the BFF (loopback on the same host, or a BFF host on the controlled network) | Binding a non-loopback address **requires** `LAB_API_TOKEN`, see §4 |
| Nitro BFF | `:3000` | Browsers (same origin) | The upstream base URL lives only in Nitro runtime config; `proxyToMininet()` is the only egress |
| SNMP agent (first M2 increment, inside each node) | `:161` (UDP) inside the node netns; `LAB_SNMP_PORT` overrides | NMS collectors | One agent per node, running in its own netns, so the host `:161` stays free and the host `snmpd` may keep the root namespace — see `NMCPS-ADR-0028` |

Three hard constraints:

1. **Browsers never talk to the upstream directly.** The prefixes are identical (`NMCPS-ADR-0022` D11), so `/api/mininet/**` without a host means the BFF and with `:8000` means the upstream. Decide by host and port, never by path, and never let `http://…:8000` appear in a page or composable.
2. **One port, one owner.** Do not run two backends on one machine: `app.net` is process-global, so two processes mean two networks and two in-flight write locks, and the facts a page sees depend on which process answered.
3. **`127.0.0.1:8000` on this host may not be this service.** Measured 2026-11-23: nginx's default server holds that port and answers `400`. On a 400, check `ss -ltn | grep ':8000'` before suspecting the backend. Real-device acceptance therefore uses the NIC address (`REAL_MININET_BASE=http://192.168.1.90:8000`).

---

## 3. Privilege model

| Capability | Requires | Shape when missing |
| :--- | :--- | :--- |
| Building a network, start/stop, `TCLink`, OVS ports | root (`Mininet()` calls `ensureRoot()` and then `exit(1)`) | `app.net = None` and only `dryrun` sessions work — what CI and local root-less self-checks rely on |
| `mn -c` on startup and shutdown | root | Root-less self-checks must pass `LAB_SKIP_STARTUP_CLEANUP=1`, otherwise startup keeps failing to `pkill` other people's processes and hangs |
| `tc` / netns inspection on host interfaces | root + `nsenter` | The interfaces live in the host's own netns; the root namespace cannot see `h1-eth0` |

Four constraints:

1. **Privilege does not sink into the BFF.** The BFF only issues HTTP; authorisation for terminal, capture and `full_reset` happens in the BFF, execution in the upstream.
2. **One process, one privilege set.** Reading the ledger needs no root, but that is no reason to start a second backend (see §2.2).
3. **Container deployments must grant capabilities explicitly.** A missing capability shows up as "building the network fails", not "startup fails", and `dryrun` still passes — easy to misread as a code bug. The minimum set includes network administration and `/dev/net/tun`.
4. **Restart invariant** (measured 2026-11-18): when SIGTERM lands on a synchronous long operation (e.g. `net.pingFull()`), graceful shutdown waits forever — the process stays, `:8000` stops listening, and the new process blocks in startup cleanup, so neither binds. The tell is `curl -o /dev/null -w '%{http_code}'` returning `000` while `ps` still shows uvicorn; the remedy is `pkill -9`, `mn -c`, confirm the port is free, then start again.

---

## 4. Entry credentials

On the backend, one plain ASGI middleware in `auth.py` makes the call, for HTTP and WebSocket alike:

| Item | Rule |
| :--- | :--- |
| `LAB_API_TOKEN` unset | Only loopback clients are accepted (`127.0.0.0/8`, `::1`, IPv4-mapped, `localhost`, `testclient`), plus one warning at startup |
| `LAB_API_TOKEN` set | Every HTTP request except `/api/health` and `/api/version` must carry `x-lab-token` (constant-time `hmac.compare_digest`) |
| WebSocket | Node's built-in `WebSocket` cannot set headers, so it carries `lab_ts` plus `lab_sig = HMAC-SHA256(token, "<path>\n<ts>")`, a 120-second window and **path binding** |
| Rejection | HTTP `401` with `{detail: lab_token_required}` or `{detail: lab_token_invalid}`; WebSocket closes with `1008` and the same reason |
| Secret boundary | Never in a query string (HTTP), never logged, never echoed back; leaking one WS URL does not unlock another channel |

The BFF configures the same value as `NUXT_MININET_TOKEN`: egress sends it as a header only, and the WebSocket side signs with it. The handshake is `GET /api/mininet/version`, which reads the upstream `api_contract` and answers `compatible` (major-version comparison, expected `2.0` by default).

**The hardest rule**: binding a non-loopback address without a token hands `full_reset` to the whole LAN — with no token the backend trusts loopback only, so a `0.0.0.0` bind removes the gate entirely. Either "bind the NIC address" and "the same token on both sides" both hold, or neither happens.

---

## 5. Tenant to instance

`NUXT_MININET_INSTANCES` (a JSON string such as `{"t_a":{"baseUrl":"http://127.0.0.1:8000"}}`) is the single source of truth: `getMininetConfig(event, tenantId)` consults only that table when a tenant is given, and a miss yields an empty `baseUrl` → `503 tenant_runtime_unavailable`, **never** a fallback to the global instance.

- Parse failures are treated as an empty table (fail closed): a broken configuration must fail closed rather than quietly fall back to the global instance.
- A single instance may override `token` / `timeoutMs` / `longTimeoutMs`; `Math.max()` guarantees `longTimeoutMs >= timeoutMs` (`NMCPS-ADR-0026` D1).
- Empty `baseUrl` in both the global and the tenant entry means the channel is disabled: `/api/mininet/**` answers `503 mininet_not_configured`, not `500`.
- Default budgets: 15 seconds for reads, 180 seconds for long operations. The latter is measured — one `pingall` on a 9-node network takes 42.6 seconds, so the 15-second read budget would read as a timeout.

---

## 6. Data and restart semantics

| Fact | Stored in | After a restart |
| :--- | :--- | :--- |
| Topology, nodes, links, run state | the upstream `app.net` (in-process) | Lost; the upstream is empty |
| Session table | the in-process table in `sessions.py` (ceiling `MAX_SESSIONS = 32`) | Lost |
| Ledger (resource ownership, state readings) | the BFF's `.data/lab-ledger.json` | Kept, but it may point at things that no longer exist |
| Write audit | the BFF's `.data/audit/lab-audit-<date>.jsonl` (daily shards) | Kept, append-only |

Four constraints:

1. **Do not reconcile the ledger first after a restart.** Reconciliation rewrites the resource list from upstream facts, and an empty upstream means an emptied ledger. The correct order is export / import the topology, start the network, then reconcile.
2. **An existing ledger file is trusted as-is.** The seed only applies when the file is missing, so deleting the file is the only way back to the seed (this prevents "deleted, then resurrected by the seed").
3. **Root-owned artefacts turn every write endpoint red for the normal user.** A root run leaves root-owned audit shards; a BFF started as a normal user then hits `EACCES` on append → every write endpoint answers `503 audit_unavailable` while read endpoints stay at 200. The diagnostic is `find .data -user root`: fix ownership before suspecting code.
4. **The ticket table is still in-process memory.** The one-shot `jti` table behind `ws-ticket` lives in the current BFF process; before scaling out horizontally it must move to the ledger, otherwise "the same ticket can be replayed against another instance".

---

## 7. Deployment shape and open decisions

**Settled**: one upstream per host (a lab machine runs exactly one upstream process), the BFF may live on another machine (the token is what makes remote deployment possible), and one host per tenant (isolation level A, `NMCPS-ADR-0021`).

Until each item below lands, neither this document nor the UI may claim it is supported:

| Item | Status | What changes when it lands |
| :--- | :--- | :--- |
| Startup shape on the lab host: systemd `User=labrun` + `AmbientCapabilities` (`CAP_NET_ADMIN` / `CAP_NET_RAW`), or a direct root start | To confirm | Install script, file ownership, `.data` permissions (see §6.3) |
| A dedicated image (custom `regulatory.db` / DFS) | To confirm | Decides whether this repo ships an install script only, or a full image plus acceptance |
| SNMP `:161` versus the host `snmpd` (the M2 in-process agent) | Decided (`NMCPS-ADR-0028`) | Each agent binds `:161` inside its node's own netns, never on the host; the root-namespace proxy shape is rejected |
| Per-tenant instance orchestration (containers / netns / quotas) | To decide | Orchestration lives in the deployment plane; the BFF only consumes the registry |

---

## 8. Acceptance surface

| Command | Proves | Does not prove |
| :--- | :--- | :--- |
| `pnpm lab:check` | Upstream route inventory, CORS removal, the source guards for start/stop and iperf | Any real network behaviour |
| `pnpm check:engines` | Legal engine layering, correct WS signature functions (no fastapi / no root) | Any real HTTP |
| `pnpm check:simulation` | A real backend (`dryrun`): the 401 matrix, `api_contract`, the whole session path | Privileged paths |
| `pnpm check:lab-bff` | The BFF whitelist, capability bits, audit, WS tickets | Whether the upstream is actually running |
| `pnpm check:lab-real:root` | Real Mininet: build, start/stop, link bandwidth, iperf | Multi-tenant isolation (single instance) |

A skip (for example without `CHECK_REAL_MININET`) **is not a pass**: a root-less `check:lab-real` prints `⏭` for the `tc` layer, and reading that as "verified" is the most common misjudgement.

---

## 9. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-11-25 | 0.1.0 | First version: turns item 2 of `docs/ai/simulation-parity.md` §7 ("deployment / privilege / token and port constraints") into a Tier 1 baseline — the listening surface and port ownership, the privilege model and restart invariant, `x-lab-token` and the WS signature, the tenant instance registry and its fail-closed behaviour, ledger and restart semantics, the open decisions, and what each acceptance command proves. |
