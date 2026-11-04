---
docId: NMCPS-DESIGN-005
title: "System Management Domain Baseline"
description: "Tier 2 design baseline for the system management domain (domain.system): system logs (operation logs, security logs and archive records, including running an archive), policy management, user and permission management, including the /system/log and /system/user endpoint, field, permission-matrix and error-code baseline. This is the single authority for the domain.system domain."
excerpt: "System logs (audit), policy, user and permission management (incl. the implementation baselines)."
keywords:
  - "system"
  - "permission"
  - "baseline"
tier: 2
authority: normative
scope:
  - domain.system
status: baseline
version: 0.6.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-003
createdAt: "2026-10-25"
updatedAt: "2026-11-04"
icon: "carbon:settings"
tags:
  - "Domain"
  - "System"
  - "Permission"
---

# System Management Domain Baseline (NMCPS-DESIGN-005)

> **Responsibility**: single authority for `domain.system` — system logs, policy management, user and permission management. IAM architecture: `NMCPS-ARCH-003`.
> **Audience**: implementation engineers / AI assistants.
> **Generation note (2026-11-04)**: the backend has moved wholesale to the NMS unified gateway at `http://192.168.1.55:8888/api/v1`. **§9 was rewritten against the new `audit/*` families in 0.6.0**; §6 still describes the old generation (`/api/v1/account`, `accountLevel` — the cn 0.6.0 `iam/users` rewrite is not translated yet), and §7 / §8 (`/api/v1/role`, `/api/v1/permission`, `/api/v1/abac/rule`, `/api/v1/access/dryrun`) are still old generation too. Those sections must be rewritten against the `iam` namespace; until then, live probing wins, and the switch record is indexed by `NMCPS-GOV-003`.

---

## 1. Positioning

System management is the "governance plane" of the NMS: it manages runtime logs, global policies, user accounts, and permission assignment — the operational UI of the IAM architecture (`NMCPS-ARCH-003`).

---

## 2. Functional Scope

| Sub-page | Function |
| :--- | :--- |
| log | Audit log: operation / security / archive-record lists and details plus running an archive (`/system/log`) |
| policy | Global policy management |
| user | User account management |
| permission | Permission assignment (role/policy binding) |
| download | Client installer download centre (platform detected from the UA; links point straight at GitHub Releases, binaries are not proxied) |

---

## 3. Key Data Entities

| Entity | Note |
| :--- | :--- |
| Audit Log | Append-only operational audit trail |
| Policy | ABAC policy document |
| User | Account and role binding |
| Permission | Role → permission mapping |

---

## 4. Domain Boundary & Dependencies

- **Upstream**: IAM architecture (RBAC + ABAC, multi-tenant, audit, `NMCPS-ARCH-003`).
- **Consumers**: the whole system (unified authentication).
- **Out of scope**: low-level auth protocol implementation (IAM `NMCPS-ARCH-003`).

---

## 5. Roadmap

1. User and role management (RBAC).
2. Policy management (ABAC policy editing).
3. Audit log query and SIEM ingestion.

---

## 6. `/system/user` user management (implementation baseline)

> Source: live probing of `http://192.168.1.55:8888/api/v1` on 2026-11-01 and again on **2026-11-03** with both identities (super admin / tenant admin), cross-checked against swagger. Deviations from the contract are filed in `NMCPS-REC-002` (`layers/content/collections/cn/records/defects/account-upstream-defects.md`); this section only states what the page may rely on.

### 6.1 Data source and endpoints

| Capability | BFF path | Upstream | Notes |
| :--- | :--- | :--- | :--- |
| List | `GET /api/account` | `GET /api/v1/account` | `page` / `pageSize` / `keyword` / `accountLevel` / `status` |
| Create | `POST /api/account` | `POST /api/v1/account` | `accountName` / `displayName` / `password` / `accountLevel` required; **a super admin must also send `tenantId`** (positive, `0` counts as missing); `mfaEnabled` / `mustResetPassword` optional |
| Status | `PUT /api/account/{accountCode}/status` | same | body `{ status }`, returns `{ ok: true }` |
| Detail | `GET /api/account/{accountCode}` | same | not used by the page: the list already carries every displayed field |
| Tenants | `GET /api/tenant` | same | the only source for the `tenantId` a super admin must pick at creation; returns `list` / `total` / `page` / `pageSize` with `tenantId` / `tenantCode` / `tenantName` per row |

- The `{id}` path segment is the `accountCode` (`ACC…`), not the numeric `accountId`.
- **There is no profile-update endpoint** (no `PUT /api/v1/account/{id}`) and no delete endpoint: `displayName` is immutable after creation, and "delete" means `status=2` (disabled).
- The BFF whitelist must contain `account` (and `tenant` for the tenant picker) in `GATEWAY_RESOURCES` (`shared/types/api.ts`); otherwise every call returns `404 bff_resource_not_allowed`.

### 6.2 Field semantics

- `accountLevel`: `0` platform super admin (`tenantId: 0`) / `1` tenant admin / `2`–`3` subordinate tenant-level accounts / `4` service account (upstream wording: "provisioned by the system", a manual create returns `20102`). **The level offered at creation must be strictly lower than the caller's own** (a larger number) and `≤ 3`: super admin `1`–`3`, tenant admin `2`–`3`; same or higher returns `20103` ("can only manage downwards"). Levels outside `1`–`3` are still rendered read-only as "undefined level" in the list.
- `status`: `1` enabled / `2` disabled / `3` locked / `4` pending activation (swagger wording). Writing `0` or `5` → `10101`; `4` is produced by `mustResetPassword` at creation time, so the page never writes `4` itself.
- `createdAt`: `GET` returns local time while `POST` returns UTC (one field, two time zones) → displayed verbatim, never time-zone converted (UP-ACC-05).
- The list payload has **no** `tenantId` / `tenantCode` / `email` / `phone`: the page shows no tenant column and no email/phone columns (v1 fields that upstream does not have).
- `accountName` is unique: duplicates → `10302`. Passing `accountLevel=0` as a **filter** is treated as "not provided" (zero value) and returns everything, so the page offers no "super admins only" filter (UP-ACC-02).

### 6.3 Permission matrix (measured)

| Action | Super admin (`accountLevel: 0`, `tenantId: 0`) | Tenant admin (`accountLevel: 1`, `tenantId ≥ 1`) |
| :--- | :--- | :--- |
| List scope | Whole platform | Own tenant only |
| Create | `1`–`3` allowed, **`tenantId` is mandatory** (`0` or missing → `10101 missing required parameter tenantId`) | `2` / `3` allowed (`tenantId` is derived from the token, do not send it); `0` / `1` → `20103 can only manage downwards` |
| Create level ceiling | `4` → `20102 level does not match the owning layer … service accounts are provisioned by the system`; `> 4` → `10101` | same |
| Status update | Any account | Own tenant only, cross-tenant → `10301` |
| Role assignment `POST /api/account/role` | always `10201` (domain reject) | allowed for accounts in the tenant |
| Tenant membership `POST /api/tenant/{id}/member` | allowed | allowed for own tenant |

> Correction from the 2026-11-03 re-probe: the 0.5.6 matrix line "tenant admin may create `0` / `2` / `4` (should be rejected)" is obsolete — upstream now enforces "can only manage downwards" (`20103` for same or higher level) and treats `4` as a system-provisioned service account (`20102`). The same probe found a new mandatory `tenantId` on create, so a super admin that omits it can never create an account (`10101`); filed as `UP-ACC-07`.

Client-side narrowing (**not a security boundary**; it only avoids guiding users into calls upstream rejects or should reject):

1. The level picker is narrowed to "strictly lower than self and `≤ 3`": super admin `L1`–`L3`, tenant admin `L2`–`L3`, defaulting to the first (highest-privilege) option. Before 0.5.6 the picker offered only `1` (tenant admin) and `0` / `1` (super admin), i.e. every possible submission was a value upstream must reject (`20103`).
2. A super admin must also pick a tenant: the list comes from `GET /api/tenant` (only `default` exists in this environment) and `tenantId` travels with the create call; tenant admins never see the field (upstream derives it from the token, and sending it can cross tenant boundaries).
3. The row action "change status" is disabled for the caller's own account (`accountCode` equals the session account) to avoid self-lockout.
4. No role-binding or tenant-membership controls: the former is rejected with `10201` for super admins, the latter cannot be targeted because the list lacks `tenantId`; both belong to `/system/permission` and the tenant domain.
5. Upstream remains the only authorisation point: the BFF only enforces the whitelist, and client narrowing never changes backend decisions.

### 6.4 Error codes → page handling

| Code | Upstream meaning | Page handling |
| :--- | :--- | :--- |
| `10302` | Account name already exists | inline error on `accountName` |
| `20101` | Password violates the complexity / lifetime policy | inline error on `password` |
| `20102` | Level does not match the owning layer (`4` is a system-provisioned service account) | "this layer cannot create that level", attached to the level field |
| `20103` | Can only manage downwards: same or higher privilege | "the level must be lower than your own", attached to the level field |
| `10101` | Invalid parameters (level out of range / **missing `tenantId`**) | "invalid parameters" notice; the missing-`tenantId` case names the field |
| `10301` | Target missing or outside the current tenant domain | "account not found or not permitted" |
| `10201` | Unauthenticated / domain reject | "session expired or the current identity may not do this" |
| `10509` | Upstream internal error (missing field, level out of range) | generic failure + check required fields |

Upstream missing / unreachable / timeout reuse the operational guidance from `upstreamHintKey()` (same wording as the login page and `/user/security`).

### 6.5 Known gaps

`UP-ACC-01`–`UP-ACC-08` in `NMCPS-REC-002`: tenant-admin privilege escalation (**closed on 2026-11-03**: `20103` now fires), the `accountLevel=0` filter being ignored, `500` for missing fields or out-of-range levels, no profile-update or delete endpoint, missing tenant attribution plus inconsistent time zones, super admins being unable to assign roles, the new mandatory `tenantId` on create (`UP-ACC-07`), and `4` becoming a system-provisioned service account (`UP-ACC-08`). The page depends only on the four confirmed endpoints and treats none of the gaps as contract.

---



## 7. `/system/policy` policy management (implementation baseline)

> Source: probing `http://192.168.1.55:8888/api/v1` on 2026-11-01 with both identities (super admin / tenant admin) plus a swagger diff. Contract deviations are filed as `NMCPS-REC-003` (`layers/content/collections/en/records/defects/policy-upstream-defects.md`); this section only states what the page may rely on. Page role and toolbar conventions: `NMCPS-ADR-0017`.

### 7.1 Data sources and endpoints

| Capability | BFF path | Upstream | Notes |
| :--- | :--- | :--- | :--- |
| Rule list | `GET /api/abac/rule` | `GET /api/v1/abac/rule` | Only `page` / `pageSize`; there is no `keyword`, no `status` / `roleCode` filter |
| Authorization dry run | `POST /api/access/dryrun` | `POST /api/v1/access/dryrun` | Pure computation, nothing is persisted; only `accountId` / `path` / `method` are required |
| Dry-run account options | `GET /api/account` | `GET /api/v1/account` | Reuses the account list (`pageSize` capped at 100) and takes the first entries for the picker |

- **No rule write endpoint is usable**: `POST /api/abac/rule` exists, but `PUT` / `PATCH` / `DELETE /abac/rule/{id}` all return `404` (UP-POL-01). A rule that can never be changed or removed is worse than none, so the page **offers no create entry**.
- Enabling / disabling a rule has no dedicated endpoint; `status` can only be changed in the upstream database, so the page renders it read-only.
- `path` must carry the `/api/v1` prefix to hit RBAC evaluation: the page hard-codes that guidance in the `path` hint and never auto-prefixes the value (that would hide what the user actually typed).
- The BFF allowlist must include `abac` / `access` / `account` (`GATEWAY_RESOURCES` in `shared/types/api.ts`), otherwise every call is `404 bff_resource_not_allowed`.

### 7.2 Field semantics

- `ruleId`: numeric primary key, used as list key and as the `useRecordSelection` record id; ties on `priority` break on it ascending (`byAbacPriority()`).
- `ruleCode`: unique; a duplicate create returns `409 10302` (UP-POL-02). Read-only in the UI.
- `roleCode`: **an empty string means a global rule**, not `null` (upstream convention). The page renders it as a "global" badge, never as "—".
- `conditionDsl`: a govaluate expression that upstream **does not parse or validate** (a malformed value still returns `200`, UP-POL-02), so the page shows it verbatim with a copy action — no editing, no "format" or "fix it" affordance.
- `priority`: lower matches first. The list sorts ascending, ties broken by `ruleId`.
- `status`: only `1` (enabled) / `2` (disabled) were observed (`POLICY_STATUS`). Those two are mapped; any other value goes through `pages.system-policy.status.unknown` with the raw value interpolated (`policyStatusKey()` + `{status}`) — the page never guesses what `0` means.
- `createdAt`: rendered as returned, no time-zone conversion.

### 7.3 Permission matrix (measured)

| Action | Super admin (`accountLevel: 0`) | Tenant admin (`accountLevel: 1`) |
| :--- | :--- | :--- |
| Rule list / dry run | **Always `401 10201`**: the policy domain is closed to super admins (UP-POL-08) | Available (own tenant domain) |
| Create / update / delete / toggle a rule | Endpoints do not exist (UP-POL-01) | Same |
| Keyword search | Not offered | Client-side filter (upstream has no `keyword`; adjacent to UP-POL-04) |

Client narrowing (**not a security boundary**, only avoids steering users into upstream gaps):

1. A super admin **issues no request at all** on this page; only the identity notice is rendered (top of the detail pane, also with nothing selected; otherwise every visit logs a `401`).
2. No write entry exists: a rule can be neither updated nor deleted, and the DSL is not validated — a typo can only be fixed in the database.
3. Search happens client-side: rules are paged in fully first (bounded by `MAX_RULE_PAGES`) and then filtered over `ruleCode` / `ruleName` / `roleCode` / `conditionDsl`; when filtering drops the selected record the page shows "not in current results" and **never silently rewrites the query**. Pagination is client-side too: the page-size selector and the paginator both live in the list footer (15 by default, `NMCPS-ARCH-006` §3.8) and the slice only affects rendering — hit-testing and `?id` deep links still run against every loaded rule, so paging never turns a valid deep link into "record not found".
4. The dry-run form only exposes `accountId` / `path` / `method`: the other four fields are accepted but ignored by upstream (UP-POL-06), so showing them would be a lie.

### 7.4 Error codes → page handling

| Code | Upstream meaning | Page handling |
| :--- | :--- | :--- |
| `10201` | Unauthenticated / domain reject (always for super admins) | Identity notice, never the "load failed" branch |
| `10302` | `ruleCode` already exists | Not reachable from list / dry run; message reads "rule code already exists" |
| `10101` | Invalid parameters | "invalid parameters" notice, user input preserved |
| `10509` | Upstream internal error | Generic failure notice plus retry |

Upstream missing / unreachable / timeout reuse the operational guidance from `upstreamHintKey()` (same wording as the login page and `/system/user`).

### 7.5 Known gaps

`UP-POL-01` / `02` / `04` / `06` / `08` in `NMCPS-REC-003`: no rule lifecycle endpoints, the DSL is not validated, the list has no `keyword`, the dry run ignores context, and super admins are rejected by the domain. The page relies only on the three confirmed capabilities (list, dry run, account options) and treats none of the gaps as contract.
---

## 8. `/system/permission` permission management (implementation baseline)

> Same source. Contract deviations are filed as `NMCPS-REC-003`; this section only states what the page may rely on. Page role and toolbar conventions: `NMCPS-ADR-0017`.

### 8.1 Data sources and endpoints

| Capability | BFF path | Upstream | Notes |
| :--- | :--- | :--- | :--- |
| Role list | `GET /api/role` | `GET /api/v1/role` | `page` / `pageSize` / `keyword`; no status filter |
| Create role | `POST /api/role` | Same | `roleCode` / `roleName` / `roleLevel` required, `description` optional |
| Delete role | `DELETE /api/role/{roleCode}` | Same | Path segment is **`roleCode`**, not `roleId`; built-in roles return `40303` |
| Permission catalog | `GET /api/permission` | Same | `page` / `pageSize` / `keyword` / `resourceType`; only 24 rows measured, safe to page in fully |
| Role grants | `GET /api/role/{roleCode}/permission` | Same | **Does not return `effect`** (UP-POL-03) |
| Grant | `POST /api/role/{roleCode}/permission` | Same | Body `{ permCode, effect }`; the page only sends `effect=1` (allow) |
| Revoke | `DELETE /api/role/{roleCode}/permission` | Same | Body `{ permCode }`; `effect` is meaningless for a delete |

- **No role status endpoint exists** (`PUT /api/v1/role/{code}/status` is absent); `status` can only be changed in the database, so the page offers no enable / disable action (UP-POL-01).
- **`POST /api/permission` exists but delete does not**: the page treats the permission catalog as read-only (UP-POL-01).
- `GET /account/role?accountId=` **does not exist** (`404`), so no account↔role binding view is offered (UP-POL-07).

### 8.2 Field semantics

- `roleCode`: unique; a duplicate returns `409 10302`. Used as the `useRecordSelection` id and never numeric-coerced.
- `roleLevel`: `0` platform super admin / `1` tenant admin / `2`–`4` custom. A tenant admin may create `2`–`4`; the same or a higher level returns `20103`, and `>4` returns `40308` (upstream does not distinguish the two, UP-POL-05).
- `isBuiltin`: built-in roles are **read-only** — grant `40307`, revoke `40305`, delete `40303` (three codes for one meaning, UP-POL-09). The page disables the toggles and the delete entry and states the reason.
- `status`: same as above — only `1` (enabled) / `2` (disabled) were observed (`POLICY_STATUS`), rendered read-only; any other value goes through `pages.system-permission.status.unknown` with the raw value interpolated.
- `createdAt`: `GET` returns UTC while `POST` returns local time (UP-POL-10), so it is rendered as returned with no conversion.
- Permissions: `permCode` (e.g. `asset:device:read`), `permName`, `resourceType` (`0` is treated by upstream as "not provided", so the page never sends `0`; `4` means API and gets its own column on the right) and `description`.
- The grant list contains **only the permission bodies**: presence means "granted", with no way to tell allow from deny (UP-POL-03), so the page only expresses `ALLOW` and never shows a deny toggle.

### 8.3 Permission matrix (measured)

| Action | Super admin (`accountLevel: 0`) | Tenant admin (`accountLevel: 1`) |
| :--- | :--- | :--- |
| Role / permission lists | **Always `401 10201`** (UP-POL-08) | Available (own tenant domain) |
| Create role | Same | `2`–`4` allowed; `0` / `1` → `20103` |
| Delete role | Same | Custom roles only; built-in → `40303` |
| Grant / revoke | Same | Allowed; built-in roles → `40307` / `40305` |
| Enable / disable role | Endpoint does not exist (UP-POL-01) | Same |

Client narrowing (**not a security boundary**):

1. A super admin **issues no request at all** on this page; only the identity notice is rendered (top of the detail pane, also with nothing selected).
2. The level picker narrows by identity: a tenant admin only gets `2`–`4` (`0` / `1` would always be rejected with `20103`).
3. Grant toggles and delete buttons on built-in roles are disabled (`aria-disabled` plus a tooltip), not "click first, error later".
4. Grant toggles update **optimistically**: the UI flips first and rolls back with a notice on failure; in-flight requests are deduplicated per `roleCode + permCode`.
5. No permission create / delete and no role enable / disable: the endpoints do not exist, so the entry would only ever fail.
6. The detail pane's view state splits into **two equal columns**: role facts on the left (title, fields, built-in notice) and the grant matrix on the right, 50% each and filling the container (no `max-w`). The matrix itself is back to two columns: resource permissions (`resourceType` ≠ `4`) left, API permissions (`4`) right, order fixed, grouped by `resourceType` within each column and sorted stably by `permCode`. The decision is a **container query** (`@min-[48rem]`, never a viewport breakpoint — see `NMCPS-ARCH-006` §3): below the threshold both sides stack (fields first, matrix after) and the matrix collapses to single-column groups. API entries dominate the catalog (15 of 24 measured on 2026-11-02), and the two columns keep "device / metric / MIB / alert" off the bottom of the list.

### 8.4 Error codes → page handling

| Code | Upstream meaning | Page handling |
| :--- | :--- | :--- |
| `10201` | Unauthenticated / domain reject (always for super admins) | Identity notice, never the "load failed" branch |
| `10302` | `roleCode` already exists | Inline error on `roleCode` |
| `20103` | Level not lower than the caller's | Form-level "you can only create roles below your own level" |
| `40308` | `roleLevel` out of range | Form-level "level out of range (2–4)" |
| `40303` | Built-in role cannot be deleted | Row notice "built-in roles cannot be deleted" |
| `40305` | Built-in role grants cannot be revoked | Toggle rolls back with "built-in role grants are fixed" |
| `40307` | Built-in role cannot be granted | Same as above |
| `10509` | Upstream internal error (missing field) | Generic failure notice plus required-field check |
| `10101` | Invalid parameters | "invalid parameters" notice, user input preserved |

Upstream missing / unreachable / timeout reuse the operational guidance from `upstreamHintKey()`.

### 8.5 Known gaps

`UP-POL-01` / `03` / `05` / `07` / `08` / `09` / `10` in `NMCPS-REC-003`: no role enable / disable or permission delete, grants cannot be read back with `effect`, privilege escalation and out-of-range levels share wording, account↔role is write-only, super admins are rejected by the domain, built-in roles return three different codes, and time zones are inconsistent. The page relies only on the seven confirmed endpoints and treats none of the gaps as contract.

---

## 9. `/system/log` audit log (implementation baseline)

> Source: probing `http://192.168.1.55:8888/api/v1` on 2026-11-04 with both identities (super admin / tenant admin) plus a field-by-field openapi diff. The old generation (0.5.x: one endpoint plus `category`, `verify` and `export`) has been retired as a whole, so this section is rewritten against the new `audit` namespace (C4b, `NMCPS-ADR-0018` §3). Contract deviations are filed as `NMCPS-REC-004` (`layers/content/collections/en/records/defects/audit-upstream-defects.md`); this section only states what the page may rely on.

### 9.1 Data sources and endpoints

| Capability | BFF path | Upstream | Parameters |
| :--- | :--- | :--- | :--- |
| Operation-log list | `GET /api/audit/operation-logs` | Same | `page` / `page_size`, optional `keyword` / `username` / `module` / `status` / `created_from` / `created_to` |
| Operation-log detail | `GET /api/audit/operation-logs/{id}` | Same | The path segment is the primary key `id` (UUID); the old generation used `logCode` |
| Security-log list | `GET /api/audit/security-logs` | Same | `page` / `page_size`, optional `subject_name` / `action` / `auth_decision` / `ip_address` / `logged_from` / `logged_to` |
| Security-log detail | `GET /api/audit/security-logs/{id}` | Same | Same as the left cell |
| Archive-record list | `GET /api/audit/archive/records` | Same | `page` / `page_size`, optional `table_name` / `status`; **no time condition** |
| Archive-record detail | `GET /api/audit/archive/records/{id}` | Same | Same shape as a list row |
| Run archiving | `POST /api/audit/archive/run` | Same | Body `{ table_name? }` (omitted = archive both tables), returns `{ "<table>": rows }` |

- **Each family has its own endpoint, filter parameters and detail endpoint** — this is not "one endpoint plus a filter". Switching family swaps the endpoint, the parameter names and the fields, so the page branches per family instead of assuming one parameter set fits all three.
- Two old capabilities have **no counterpart** in the new generation and are retired together with gaps G6 / G7: `POST /audit/verify` (hash-chain verification) and `GET|POST /audit/export` (export jobs). "Where does expired data go" is now answered by the archive chain.
- The BFF allow-list must contain `audit` (`GATEWAY_RESOURCES` in `shared/types/api.ts`), otherwise every call answers `404 bff_resource_not_allowed`.
- The contract types live in `shared/types/audit.ts` (shared by `app/` and `server/`); the page declares no fields of its own.

### 9.2 Field semantics

- **The primary key is `id` (UUID)**, which doubles as the detail path segment; it never enters a list query, it only drives `?id` deep links and detail fetches (the old `logCode` no longer exists).
- `page_size`: 15 by default, options 15 / 30 / 50 / 100, with a page-level ceiling of `AUDIT_MAX_PAGE_SIZE = 100` (selector in the list footer, `NMCPS-ARCH-006` §3.8). An empty result arrives upstream as `list: null` and the BFF exit normalises it to `[]` (`NMCPS-ADR-0018` D6), so no consumer has to null-check.
- Time bounds are **epoch-millisecond integers** (the old generation sent strings): `created_from` / `created_to` for operation logs, `logged_from` / `logged_to` for security logs. The page converts its `datetime-local` literal using **browser local time**; picking a calendar day yields a whole-day window `00:00:00` … `23:59:59` including both ends (dropping those 59 seconds loses the last half minute of the day), and a reversed window is rejected locally.
- Archive records carry **no time condition**: `/audit/archive/records` only accepts `table_name` / `status`, so the page hides the whole range control in the archive family and sends no time parameter at all.
- Archive-record fields were measured (one real `POST /audit/archive/run` on 2026-11-04, then read back): `id` / `table_name` / `archive_batch` / `rows_archived` / `cutoff_before` / `started_at` / `finished_at` / `status` / `created_at`. `*_at` / `cutoff_before` are RFC3339 with an offset (`2026-08-06T10:34:39.998235+08:00`); they are trimmed for display and **never converted between zones**.
- **The entry fields of operation and security logs are not yet verified against real data** (this instance's audit database is empty; only the archive path has produced real samples, so that is where the measured field list comes from): the type file derives the registered field list from the openapi query parameters and sibling entities, so the page renders "a registered field that is missing shows `—`, an unregistered field is listed raw at the end of the detail pane" and keeps a permanent "field semantics" alert at the top of the detail pane — nobody should read "upstream did not record it" as "the page dropped it".
- The archive result is a **row-count map**, not a job object: `0` rows is a normal result (nothing past the retention cutoff) rather than a failure, and the dialog has to say so before it runs.

### 9.3 Permission matrix and page behaviour

| Action | Super admin | Tenant admin |
| :--- | :--- | :--- |
| All three families, list / detail | Whole platform | Available; **scope is filtered upstream per tenant** |
| Run archiving | Available (a write that leaves a batch record) | The page shows the entry too and lets upstream judge; **not exercised under a tenant-admin identity** |

Client narrowing (**not** a security boundary):

1. Both identities fetch normally: the scope is filtered upstream and the page only states "you are looking at the whole platform / this tenant" at the top of the detail pane (also in the empty state; position rules in `NMCPS-ARCH-006` §4.1).
2. Filters split on "does it decide the data scope": the **time range** (a button whose label is the current window summary, with a `UPopover` holding the "all time / last 15 minutes / last hour / last 24 hours / last 7 days" preset column, a two-month `UCalendar range`, and two second-precision `datetime-local` inputs under the calendar) and the **log family** (`USelect`: operation / security / archive) stay in the toolbar's left area; the popover only holds the identifiers this family's openapi really lists — operation logs `keyword` / `username` / `module` / `status`, security logs `subject_name` / `action` / `auth_decision` / `ip_address`, archive records `table_name` / `status`. Page size is neither: it is presentation, not filtering, and lives in the list footer (15 by default). The archive family has no time condition, so the range control disappears with it. The standing rule is "hiding it would let people read the filtered `total` as the whole set"; budget and rendering rules live in `NMCPS-ARCH-006` §4.1.
3. The page uses `LayoutSplit` plus `useRecordSelection` over `?id`; `↑` / `↓` move the selection inside the list and the detail pane reads **the current family's detail endpoint**. Switching family returns to page 1 and clears the selection, since the old row does not exist in the new family.
4. Archiving is an **explicit action**: the right-area button appears only in the list pane and outside the archive family, the dialog states "write, cannot be undone" and "0 rows is a normal result", and the archive-record list is reloaded afterwards so the new batch shows up.
5. Verification and export entries are gone (G6 / G7): there is no "start verification" button, no "export" button and no export-progress polling.
6. `check:ui` guards 11 cases: both standing controls exist, the left area stays within 45% of the content box, and the popover only holds this family's identifiers; the list renders from the family endpoint; selecting a row hits the family detail endpoint; a preset really rewrites `created_from` / `created_to` (epoch ms, 24h apart); the button label echoes the window; calendar day picks include both ends; switching to security logs swaps to `security-logs` plus `logged_from` / `logged_to`; the archive family hides the range control and sends no time parameter; at 320px the range collapses to an icon with no horizontal overflow. The list footer additionally asserts 49px height, 15 rows per page (`page_size`) and a selection fill readable in both themes (`NMCPS-ARCH-006` §3.8).

### 9.4 Error codes → page handling

The new generation returns business errors as **HTTP 200 + `code≠0`**; the BFF preserves the business code and `apiGuard` throws `ApiError` from it (`NMCPS-ADR-0018` §3).

| Code | Upstream meaning | Page handling |
| :--- | :--- | :--- |
| `40401` | Target not found (shared by all three detail endpoints; the `message` names the entity: "operation log not found" / "security audit log not found" / "archive record not found") | "That record does not exist or has been purged" in the detail pane, selection kept so the user can retry |
| `10007` | Invalid / expired token | "Session expired or no permission" notice with a re-login hint, never the "load failed" branch |
| `40001` | Field validation failed (time bounds / paging) | "invalid parameters" notice, user input preserved |
| `10509` / `5xx` | Upstream internal error | Generic failure notice with a retry entry |
| Non-envelope failure (`code = 0`) | Network | "Network error, please retry" |

`10201` means "wrong password" in the new generation and is **no longer** reused as an auth failure (the old reading is void). Upstream missing / unreachable / timeout reuse the operational guidance from `upstreamHintKey()`.

### 9.5 Known gaps

- **G6 / G7 (capability gaps)**: the new generation has neither hash-chain verification nor export-job endpoints. The old defects that lived on `verify` / `export` (UP-AUD-05 / 06 / 07 / 08) retire together with those endpoints, and the page no longer offers either path.
- **Unverified field semantics**: the entry fields of operation and security logs have never been checked against real data (this instance's audit database is empty); only the archive-record fields were verified field by field. The page therefore renders "a registered field is missing" and "an unregistered field exists" explicitly instead of dropping either silently.
- **Archiving is not exhaustively characterised**: it was exercised once, as a super admin, with 0 rows in both tables. Retention length, concurrent runs and a tenant admin's rights are all unverified, and the page promises nothing about them.
- The old `UP-AUD-01` / `02` / `03` / `04` / `09` describe retired endpoints (`category` case sensitivity, no `pageSize` ceiling, two time formats, always-empty snapshots). They stay in `NMCPS-REC-004` as history and are **no longer contract**.

---

## 10. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: system management domain baseline. |
| 2026-10-31 | 0.2.0 | Functional scope gains the `download` sub-page (`/system/download`, "Downloads"): the former root download landing page moved into the system section, with installer links pointing straight at GitHub Releases; see `NMCPS-ADR-0016`. |
| 2026-11-01 | 0.3.0 | New section 6, the `/system/user` implementation baseline: endpoint table (list / create / status, no profile update or delete), field and status enumerations, the super-admin vs tenant-admin permission matrix with client narrowing, error-code mapping and the gap list; upstream defects are filed separately as `NMCPS-REC-002`. |
| 2026-11-01 | 0.4.0 | New section 7 (`/system/policy`) and section 8 (`/system/permission`) implementation baselines: endpoint tables (read-only rule inspection plus dry run; roles / permissions / grants), field semantics (`roleCode` empty string means global, the DSL is not validated, grants read back without `effect`), the dual-identity permission matrix with client narrowing (super admins issue no request, no write entries, client-side filtering, optimistic grants), error-code mapping and the gap list; the changelog moves to section 9 and all upstream defects are filed as `NMCPS-REC-003`. |
| 2026-11-01 | 0.4.1 | **The identity / scope alert now sits at the top of the detail pane**: all three pages (sections 6-8) used to render "within what scope does this data hold" as a page-level banner above the two-pane skeleton; it now lives at the top of `#detail`, visible in the empty selection too, leaving only the toolbar and the split above. Sections 7 and 8 name that position in their client-narrowing bullets; the layout and alignment rule is in `NMCPS-ARCH-006` §4.1 (0.2.11). |
| 2026-11-02 | 0.5.0 | New section 9, the `/system/log` audit-log implementation baseline: endpoint table (list / detail / chain verification / export job list / create export, **export has no detail or delete endpoint**), field semantics (a list row is the first 12 detail fields, `category` is case-sensitive, `result` is 1/2, `eventTime` keeps its offset and is not converted, `pageSize` clamps to 100, snapshots are always empty), the dual-identity permission matrix with client narrowing (both identities fetch, tenant scope filtered upstream, no `result` / `keyword` control, two panes over `?id`, verification is an explicit button that itself writes an entry, no export polling), error-code mapping and the gap list; the changelog moves to section 10 and all upstream defects are filed as `NMCPS-REC-004`. |
| 2026-11-02 | 0.5.1 | **§8.3 permission matrix now renders in two columns**: resource permissions (`resourceType` ≠ `4`) on the left, API permissions (`4`) on the right. API entries dominate the catalog (15 of 24 measured), and mixing them into the resource groups pushed "device / metric / MIB / alert" to the bottom. The order is fixed (resource → API), the grid auto-fits two `17rem` columns and stacks below that with the API column still second, and an empty column renders one muted line instead of disappearing; §8.2 now states `4` means API. |
| 2026-11-02 | 0.5.2 | **§8.3 grant matrix returns to a single column and moves to the right of the detail pane**: the 0.5.1 resource / API dual-column matrix is reverted; the matrix is grouped by `resourceType` again with entries sorted stably by `permCode`, and the view state now splits inside the detail pane — role facts left, grant matrix right — using a container query (`@min-[48rem]`, not a viewport breakpoint, see `NMCPS-ARCH-006` §3), stacking below the threshold with the order unchanged. §8.2 now says `4` means API and is grouped as such. |
| 2026-11-02 | 0.5.3 | **§8.3 detail pane splits into two equal columns and the matrix returns to two columns**: role facts left, grant matrix right, 50% each filling the container (dropping the 0.5.2 narrow field column and the 70rem cap); the matrix again splits into resource / API columns (the 0.5.1 rule) with a fixed order and grouping by `resourceType` inside each column. The decision is still a container query (`@min-[48rem]`): below it both sides stack and the matrix collapses to single-column groups; §8.2 again says `4` means API and gets its own column on the right. |
| 2026-11-02 | 0.5.4 | **§9.3 item 2: the time range and the category become standing controls in the toolbar left area**. They used to sit in the filter popover together with the ID fields, which made the filtered `total` read as the whole set — these two are exactly the dimensions that decide the data scope. The left area now carries a time-range button (label = current window summary; the `UPopover` offers all time / last 15 minutes / last hour / last 24 hours / last 7 days plus a custom range) and a category `USelect`; `accountId` / `deviceCode` / `sessionId` / `traceId` and the page size stay in the popover, and the popover highlight narrows to those four IDs. Budget and rendering rules: `NMCPS-ARCH-006` §4.1 (0.2.14). |
| 2026-11-02 | 0.5.5 | **§9.3 item 2: the time-range popover becomes a "preset column + two-month calendar"**. The popover used to hold a single column of presets plus two `datetime-local` inputs, so a range like "last Wednesday to last Friday" had to be typed as two timestamps. It is now `components/Audit/RangePicker.vue` (popover shape copied from the Nuxt UI dashboard template's `HomeDateRangePicker`): a left preset column (matched preset highlighted, hidden on narrow viewports) beside a two-month `UCalendar range`, with two `datetime-local` inputs underneath for second-level precision; a day selection lands on a whole-day window `00:00:00` … `23:59:59`, and the first click opens the range while the second closes it (the end stays empty in between so reka keeps extending instead of restarting). All three entries (presets / calendar / typing) write the same `start` / `end` / `preset`; fetching still happens through the page's existing `watch`. Rendering details and two measured gotchas: `NMCPS-ARCH-006` §4.1 (0.2.15). |
| 2026-11-03 | 0.5.6 | **The page size moves from the filter popover to the list footer, and all four list pages default to 15 rows**. Three measured problems: (1) the selected row fill was unreadable in both themes (`bg-elevated/60` on a white pane composites to nearly the same pixel) — `NMCPS-ARCH-006` 0.2.16 switches it to `bg-accented`; (2) the page size defaulted to 20 and only `/system/log` had one, buried in its filter popover, while `/system/user` and `/system/permission` had no entry at all and `/system/policy` did not paginate — now `DEFAULT_PAGE_SIZE = 15` (options 15 / 30 / 50 / 100, sourced from `shared/constants/paging.ts`) and all four pages render the selector in the footer; (3) the footer height is a single 49px token (`--app-list-footer-h`). This file follows: §7.3 item 3 notes client-side pagination slicing only the render layer while deep links still hit the full set, §9.2 changes the `pageSize` options to 15 / 30 / 50 / 100, §9.3 item 2 moves the page size out of the popover and item 6 adds the three footer assertions. |
| 2026-11-03 | 0.5.7 | **§6 account-creation rules corrected from the 2026-11-03 re-probe (fixes "tenant admin can never create an account")**. Symptom: a tenant admin on `?id=new` saw only level `1` (its own) in the picker, and every submit returned `20103 can only manage downwards` — the level select had no viable option. Three measured facts: (1) the target level must be **strictly lower than the caller's own** (super admin `1`–`3`, tenant admin `2`–`3`); same or higher → `20103`, and `4` → `20102` (service accounts are provisioned by the system); (2) `POST /account` now requires `tenantId` (`0` counts as missing), so a super admin omitting it fails with `10101` — the form therefore gains a tenant picker fed by `GET /api/tenant`; (3) `UP-ACC-01` (tenant escalation) is closed upstream, so §6.5 and `NMCPS-REC-002` are updated and `UP-ACC-07` (mandatory `tenantId`) / `UP-ACC-08` (`4` belongs to service accounts) are filed. §6.1 adds the tenant endpoint, §6.2 rewrites level semantics, §6.3 rewrites the matrix and adds client narrowing items 1–2, §6.4 adds `20102` / `20103`. |
| 2026-11-04 | 0.6.0 | **§9 rewritten against the new `audit/*` families (C4b)**: the old single endpoint `GET /audit?category=…` plus `POST /audit/verify` and `GET|POST /audit/export` is retired wholesale in favour of six read paths split by log family plus one write path — operation logs `GET /audit/operation-logs`, security logs `GET /audit/security-logs`, archive records `GET /audit/archive/records` (each with its own detail endpoint) and `POST /audit/archive/run`. The primary key moves from `logCode` to `id` (UUID), paging from `pageSize` to `page_size`, time bounds from strings to **epoch-millisecond integers** (`created_from` / `created_to`, `logged_from` / `logged_to`), and the empty `list: null` is normalised to `[]` at the BFF exit. The page becomes "three families, one page": a log-family `USelect` stands in the left area, the popover only holds that family's openapi parameters, and the archive family folds the range control away. Verification and export entries retire with gaps G6 / G7 and the archive dialog replaces export; the error-code table becomes `40401` / `10007` / `40001` (the old `10201` now means "wrong password"). Field semantics are layered honestly: archive-record fields are measured, operation / security entry fields have no real samples yet, so the page renders registered fields only and lists unregistered ones raw. The `/system/log` cases in `check:ui` go 8 → 11 (family switch swaps endpoint and time parameters, the archive family sends no time condition, selecting a row hits the family detail endpoint) and the total goes 105 → 106; the empty-list normalisation path in `check:bff` moves to `operation-logs`. |

