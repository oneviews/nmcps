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
version: 0.8.1
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
> **Generation note (2026-11-04)**: the backend has moved wholesale to the NMS unified gateway at `http://192.168.1.55:8888/api/v1`. **§6 (0.6.0, `iam/users`), §7 / §8 (0.8.0, `iam/{policies,roles,role-policies,subject-roles}`) and §9 (0.7.0, the `audit/*` families) are all rewritten against the new generation**; old-generation conclusions survive only as history in `NMCPS-REC-001`–`004` (`status: superseded`). Field mappings and capability gaps: `NMCPS-ADR-0018`.

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

> Source: live probing of `http://192.168.1.55:8888/api/v1` on **2026-11-04** (`/swagger/openapi.json` plus real responses).
> Contract mapping: `NMCPS-ADR-0018` §4.2; this section only states what the page may rely on.
> The old generation (`/account`, `/tenant`) field semantics and defects stay in `NMCPS-REC-002` as **history** (`status: superseded`).

### 6.1 Data source and endpoints

| Capability | BFF path | Upstream | Notes |
| :--- | :--- | :--- | :--- |
| List | `GET /api/iam/users` | `GET /api/v1/iam/users` | `page` / `page_size` / `keyword` / `status` / `department_id` |
| Create | `POST /api/iam/users` | same | `username` / `password` required; `email` / `display_name` / `department_id` optional. **No `tenant_id`** |
| Detail | `GET /api/iam/users/{id}` | same | measured to exist; the page still relies on the list only, which already carries every displayed field |
| Profile / status update | `PUT /api/iam/users/{id}` | same | `id` is required in the body as well; writable: `department_id` / `email` / `phone` / `display_name` / `status` / `mfa_enabled` |
| Delete | `DELETE /api/iam/users/{id}` | same | soft delete (`deleted_at`); the list stops returning the row |
| Tenants | `GET /api/iam/tenants` | same | only used to turn a row's `tenant_id` into a tenant name |
| Departments | `GET /api/iam/departments` | same | create-form candidates plus the ownership filter; rows carry their own `tenant_id` |

- The `{id}` path segment is the user primary key (`u_…`), not the old `accountCode` (`ACC…`).
- An empty result arrives as `list: null` and the BFF normalises it to `[]` at the exit (`NMCPS-ADR-0018` D6), so the page can `.map` directly.
- The BFF allow-list must contain `iam` (`GATEWAY_RESOURCES` in `shared/types/api.ts`); otherwise every call returns `404 bff_resource_not_allowed`.

### 6.2 Field semantics

- `username`: unique — a duplicate returns `10002 user already exists`; immutable after creation (it is absent from the `PUT` body).
- `status`: string enum `active` / `disabled` / `locked` (`chk_sys_user_status`). The page only writes `active` ↔ `disabled`; `locked` is set upstream on failed sign-ins.
- `tenant_id` / `department_id`: the list **carries** both fields, `null` when unassigned. A department carries its tenant, so the page expresses ownership by picking a department. The old gap `UP-ACC-05` (list lacked tenant attribution) closes here.
- `mfa_enabled`: read-only display (gap G8: no MFA binding endpoint in the new generation, so no binding flow).
- `created_at` / `updated_at`: RFC3339 with an offset (`2026-11-03T18:59:06+08:00`) → displayed verbatim, never time-zone converted.
- **There is no `accountLevel`** (gap G1): the level model is retired wholesale — the page neither displays it, filters by it, nor sends it.
- Password policy: measured as "password length must be 6-128 characters" (`40001`); the old complexity / reuse rules no longer apply.

### 6.3 Permission matrix and page behaviour

| Action | Platform-level account (session `tenant_id: null`) | Tenant-level account (session carries `tenant_id`) |
| :--- | :--- | :--- |
| List scope | the whole platform, as returned upstream | whatever upstream limits to |
| Filters | `keyword` / `status` / `department_id` | same (within scope) |
| Create | `username` + `password` + optional department | same |
| Profile / status update | any user except yourself | users in scope except yourself |
| Delete | any user except yourself | users in scope except yourself |

1. Ownership has exactly one dimension — a **department** dropdown: `POST /iam/users` has no `tenant_id`, so a second tenant picker would only produce a field that can never be sent.
2. Both row actions (change status / delete) are disabled on your own account, to avoid self-lockout and self-deletion.
3. Deletion gets its own confirmation dialog (a soft delete cannot be undone from this page) and is described apart from "disable" — disabling is no longer a stand-in for deleting.
4. Role binding (`subject-roles`) is still not offered here: a read/write symmetric entry has to be designed together with `/system/permission` (C4c).
5. `isSuperAdmin` is an **approximation**: session `tenant_id === null` means platform level. Judging by role (`platform_admin`) needs a new ADR, see gap G1.
6. Upstream remains the only authorisation point: the BFF only forwards within the allow-list, and client narrowing never changes backend decisions.

### 6.4 Error codes → page handling

| Code | Upstream meaning | Page handling |
| :--- | :--- | :--- |
| `10002` | User already exists | inline error on `username` |
| `40001` | Field validation failed (`message` names the field, e.g. "password length must be 6-128 characters") | map the `message` keyword onto `username` / `password`, otherwise a page-level notice showing the upstream text |
| `10003` | Wrong account or password (the same code for a wrong current password on change) | generic failure notice |
| `10007` / `40101` / `401` | Session invalid | left to `useApi`'s single-flight refresh; if that still fails, prompt for re-login |
| `10301` / `404` | Target missing / out of scope | "user not found or not permitted" |
| `10201` / `403` | Domain reject | "the current identity may not do this" |
| `10509` / `500` | Upstream internal error | generic failure + check required fields |
| `0` | Network failure (non-envelope) | network error notice |

Upstream missing / unreachable / timeout reuse the operational guidance from `upstreamHintKey()` (same wording as the login page and `/user/security`).

### 6.5 Known gaps

- **Closed**: `UP-ACC-04` (no profile-update / no delete endpoint → `PUT` + `DELETE`), `UP-ACC-05` (list lacked tenant attribution → `tenant_id` / `department_id` present).
- **Still open**: `G1` (no `accountLevel`; role-based judgement needs a new ADR), `G2` (no `mustResetPassword`), `G8` (no MFA binding endpoint).
- The old `UP-ACC-01`–`UP-ACC-08` stay in `NMCPS-REC-002` (`status: superseded`) as history and are no longer the contract for this page.

---

## 7. `/system/policy` policy management (implementation baseline)

> Source: probing `http://192.168.1.55:8888/api/v1` on 2026-11-04 with three sessions (platform super admin / tenant admin / role-less account) plus an openapi diff. Contract deviations are filed as `NMCPS-REC-005` (`layers/content/collections/en/records/defects/iam-policy-upstream-defects.md`); this section only states what the page may rely on. Page role and toolbar conventions: `NMCPS-ADR-0017`.

### 7.1 Data sources and endpoints

| Capability | BFF path | Upstream | Notes |
| :--- | :--- | :--- | :--- |
| Policy list | `GET /api/iam/policies` | `GET /api/v1/iam/policies` | Only `page` / `page_size` / `keyword` are honoured; `code` / `policy_type` / `enabled` are **silently ignored** (UP-RBAC-06) |
| Create policy | `POST /api/iam/policies` | Same | Body `name` / `code` / `policy_type` / `document` / `description`; success returns `200 { code: 0, message, id }` with `id` at the **top level** as a UUID |
| Policy detail | `GET /api/iam/policies/{id}` | Same | Missing record → **HTTP 400 + plain text** `记录不存在` (not an envelope) |
| Update policy | `PUT /api/iam/policies/{id}` | Same | `name` / `document` / `description` apply; `enabled` is ignored (UP-RBAC-03) |
| Delete policy | `DELETE /api/iam/policies/{id}` | Same | Success `200 {code:0}`; failure returns **HTTP 200 with `code: 400`** (UP-RBAC-05); system policies are deletable too (UP-RBAC-02) |
| Attach / detach policy | `POST /api/iam/role-policies/{AttachPolicy,DetachPolicy}` | Same | Body `role_id` + `policy_id`; detach is idempotent, a duplicate attach returns a 400 with raw SQL text |

- **The whole ABAC rule segment is retired**: `/abac/rule` does not exist in the new openapi (127 paths), so gap G4 is upgraded from "contract unknown" to "endpoint missing".
- **The dry run is retired**: `/access/dryrun` is missing as well (gap G5). `POST /iam/policies` is plain CRUD and offers no "who can do what on this path" computation.
- The policy ↔ role relation is an **independent resource** (`role-policies`); the policy object carries no aggregated `role_count`-style field.
- The BFF allowlist already contains `iam` (`GATEWAY_RESOURCES` in `shared/types/api.ts`); this section adds no resource name.

### 7.2 Field semantics

- `id`: UUID. Seed rows look like `pol_platform_full`, so **the prefix says nothing about provenance** — treat the value as opaque.
- `code`: unique per tenant (constraint `uk_sys_policy_tenant_code`), reusable across tenants — `tenant.full_access` is measured once per tenant, 10 rows in total.
- `policy_type`: openapi declares no enum; all 10 measured rows are `system`. The page renders the raw value; an unknown type is shown as-is rather than mapped to "other".
- `document`: a **JSON string** (not an object), e.g. `[{"Action":["*"],"Effect":"Allow","Resource":["*"]}]`. Upstream stores it as jsonb: invalid JSON returns `400` plus a raw PG error `22P02` (UP-RBAC-04) and there is no semantic validation. The page offers a formatted preview plus copy, falls back to the raw text when parsing fails, and **never ships an editor** (a broken document is dirty data).
- `enabled`: always `true` in list and detail — `PUT` with `enabled: false` returns 200 but the value does not change (UP-RBAC-03). Rendered read-only, no toggle.
- `is_system`: `true` for seed policies. **It is not a protection**: `DELETE` succeeds on system policies as well (UP-RBAC-02), so the page uses the flag as a badge only and says so in the delete confirmation.
- `tenant_id`: present on seed rows; a created policy lands in the **session tenant** (even a platform super admin gets `tnt_default`) and the body does not accept the field (UP-RBAC-08).
- `created_at` / `updated_at`: RFC3339 with a `+08:00` offset; rendered as returned, no time-zone conversion.

### 7.3 Permission matrix (measured)

| Action | Platform super admin (session `tenant_id = null`) | Tenant admin | Role-less account |
| :--- | :--- | :--- | :--- |
| Policy list / detail | Available, all 10 rows | Available, own tenant's 3 rows | **Available** (own tenant scope, UP-RBAC-01) |
| Create / update / delete policy | Allowed (lands in `tnt_default`) | Allowed (own tenant) | **Allowed** (UP-RBAC-01) |
| Attach / detach policy | Allowed | Allowed | **Allowed** (UP-RBAC-01) |
| Enable / disable policy | No working endpoint | Same | Same |

The new generation has **no business-level authorization**: any authenticated session can read and write IAM endpoints, and the visible range is decided by the **session tenant** alone (UP-RBAC-01 / UP-RBAC-09). The old "super admin always gets `401 10201`" domain rejection (UP-POL-08) retired with the old generation and no longer holds.

Client-side convergence (**not a security boundary**, only a way to avoid steering users into upstream gaps):

1. **No identity-based bypass**: a super admin issues the same requests as everyone else (the old "super admin sends no request" rule is void); `401` now only means "missing credentials / expired token".
2. No enable / disable entry: the `enabled` write is ignored, and a toggle would only fake an effect.
3. System policies keep their delete entry, but the confirmation must state "upstream does not protect system policies; deletion cannot be undone".
4. Search goes to the server via `keyword` (no more fetch-all-then-filter), which **revokes** the `NMCPS-ARCH-006` §3.8 "client-side paging for `/system/policy`" exception: server paging is used again, with the page supplying `DEFAULT_PAGE_SIZE` because upstream caps nothing.
5. The policy document is display-and-copy only: upstream validates no syntax, and the page never implies "validated".

### 7.4 Failure shapes → page handling

The new generation has almost no business error codes, so failures are told apart by **HTTP status + response shape**, normalised at the BFF boundary into `{ code, message }`:

| Upstream shape | Meaning | Page handling |
| :--- | :--- | :--- |
| `200 {code:0,message,id}` | Create succeeded | Close the dialog, refetch, select the new record |
| `200 {code:0,message}` | Update / delete / attach / detach succeeded | Refetch the list (or refresh the relation in place) |
| `200 {code:400,message:"资源不存在或无权访问"}` | Delete failed (**transport is still 200**) | Treat as failure: notify and refetch (the record may be gone) |
| `400` plain text `记录不存在` | Detail / update target missing | "This policy has been deleted" plus clearing the selection |
| `400` plain text containing `SQLSTATE 23505` | Duplicate `code` | Inline "policy code already exists"; the raw SQL text must **never** reach the user |
| `400` plain text containing `SQLSTATE 22P02` | `document` is not valid JSON | "The policy document must be valid JSON" |
| `400` plain text containing `SQLSTATE 23503` | Attached `role_id` / `policy_id` missing | "The policy or role no longer exists, please refresh" |
| `401 {code:40101}` / `{code:10007}` | Missing credentials / expired token | Session invalid (`SESSION_INVALID_CODES` must contain `40101` / `10007`) |
| No response / timeout | Upstream not configured or unreachable | The operational guidance from `upstreamHintKey()` |

### 7.5 Known gaps

`UP-RBAC-01`–`UP-RBAC-10` in `NMCPS-REC-005`: no authorization check, deletable system objects, `enabled` writes ignored, raw SQL in 400s, delete failures carried by a 200, incomplete filters with an uncapped `page_size`, missing required-field validation, ignored `tenant_id` input, unchecked cross-tenant grants, and orphan relation rows. The page relies only on the confirmed "list + detail + create/update/delete + attach/detach" set and treats none of the gaps as contract.

---

## 8. `/system/permission` roles and grants (implementation baseline)

> Same source. Contract deviations are filed as `NMCPS-REC-005`; this section only states what the page may rely on. Page role and toolbar conventions: `NMCPS-ADR-0017`.

### 8.1 Data sources and endpoints

| Capability | BFF path | Upstream | Notes |
| :--- | :--- | :--- | :--- |
| Role list | `GET /api/iam/roles` | `GET /api/v1/iam/roles` | `page` / `page_size` / `keyword` / `code`; `enabled` / `tenant_id` are silently ignored |
| Create role | `POST /api/iam/roles` | Same | Body `name` / `code` / `description`, **none of them required** (an empty body still returns `200` and stores an empty role, UP-RBAC-07) |
| Role detail | `GET /api/iam/roles/{id}` | Same | Missing → `400` plain text `记录不存在` |
| Update role | `PUT /api/iam/roles/{id}` | Same | `name` / `description` apply; `enabled` is ignored |
| Delete role | `DELETE /api/iam/roles/{id}` | Same | No built-in protection (system roles return 200 as well, UP-RBAC-02); failure shapes as in §7.4 |
| Policy catalogue | `GET /api/iam/policies` | Same | Grant-matrix data source, semantics in §7 |
| Policies attached to a role | `GET /api/iam/role-policies?role_id=` | Same | Returns relation rows only `{ id, role_id, policy_id, created_at }`, **no policy body** → the client joins by `policy_id` |
| Attach policy | `POST /api/iam/role-policies/AttachPolicy` | Same | Body `role_id` + `policy_id`; duplicate attach → `400` with `SQLSTATE 23505` |
| Detach policy | `POST /api/iam/role-policies/DetachPolicy` | Same | Idempotent (a repeated detach still returns `200`) |
| Roles assigned to a subject | `GET /api/iam/subject-roles?subject_id=` | Same | Returns relation rows only `{ id, subject_type, subject_id, role_id, created_at }` |
| Assign / revoke role | `POST /api/iam/subject-roles/{AssignRole,RevokeRole}` | Same | Body `subject_type` (measured `user`) / `subject_id` / `role_id` |

- **No permission-point catalogue** (gap G3): `/permission` does not exist in the new openapi and permission points are expressed by a policy's `document.actions` → the grant matrix moves from "permission × role" to "**policy × role**", which is a rewrite rather than a migration.
- **No role enable / disable endpoint**: `PUT /iam/roles/{id}` with `enabled` has no effect (UP-RBAC-03).
- `roleLevel` / `isBuiltin` / `status` retire together with the level model (gap G1); `is_system` takes over the **semantic badge** of "built-in" without any protection.
- Account ↔ role is now symmetric (old `UP-POL-07` closed): reads go through the `subject-roles` list, writes through `AssignRole` / `RevokeRole`.
- `GET /iam/subject-roles` **only honours `subject_id`** (looking a role up by member is not in the contract): the page pulls every relation row once (`page_size=100`) and filters by `role_id`, so "who holds this role" is a client-side view rather than an upstream query; display names and "does the user still exist" come from `/api/iam/users`.

### 8.2 Field semantics

- `id`: UUID; seed rows look like `r_tenant_admin`. Treated as an opaque string and used directly as the `useRecordSelection` identifier — never numericised.
- `code`: unique per tenant (`uk_sys_role_tenant_code`), reusable across tenants — `tenant_admin` is measured once per tenant, 10 rows in total.
- `is_system`: `true` on seed roles, `false` on created ones. Used for badges and copy only.
- `enabled`: always `true` (writes are ignored), rendered read-only.
- `tenant_id`: absent on the platform role, present on tenant roles; platform roles do not appear in a tenant admin's list.
- `description`: may be an empty string; rendered as "—" when empty.
- `created_at` / `updated_at`: RFC3339 with an offset, rendered as returned.
- A relation row's `id` is a UUID with no semantics; the page uses it as a `key` only.
- Grants have **no effect dimension**: a `role-policies` row means "attached", its absence "not attached" (the old "deny is invisible" problem, `UP-POL-03`, disappeared with the field, so the page no longer explains it).

### 8.3 Permission matrix (measured)

| Action | Platform super admin | Tenant admin | Role-less account |
| :--- | :--- | :--- | :--- |
| Role / policy list | Available, all 10 / 10 rows | Available, own tenant's 3 / 3 rows | **Available** (own tenant scope, UP-RBAC-01) |
| Create / update / delete role | Allowed (lands in `tnt_default`) | Allowed (own tenant) | **Allowed** (UP-RBAC-01) |
| Attach / detach policy, assign / revoke role | Allowed | Allowed | **Allowed** |
| Cross-tenant role assignment | — | **Measured as allowed**: assigning `r_platform_admin` to its own user returns `200` (UP-RBAC-09, reversible) | Same |
| Enable / disable role | No working endpoint | Same | Same |

Client-side convergence (**not a security boundary**):

1. No identity-based bypass: the new generation has no domain rejection, so all three pages issue the same requests and the session tenant decides the visible range.
2. No role enable / disable: `enabled` writes have no effect, so it is read-only.
3. Deleting a system role or policy asks for confirmation and states "upstream does not protect system objects".
4. Grants become **policy checkboxes**: candidates come from `GET /iam/policies` (3 rows in a tenant), the checked state is the `policy_id` set from `GET /iam/role-policies?role_id=`, and writes use `AttachPolicy` / `DetachPolicy` with optimistic updates, rollback on failure and de-duplication on `role_id + policy_id`.
5. The create-role form requires all three fields on the client: an empty body succeeds upstream, so letting it through only produces dirty data (UP-RBAC-07).
6. The role ↔ user block is read + assign + revoke only; accounts are never created here and the user picker comes from `/api/iam/users`. Orphan `subject-roles` rows pointing at deleted users are filtered out against `/iam/users` existence (UP-RBAC-10) so no ghost member is rendered.
7. The detail pane keeps the `NMCPS-ARCH-006` §3.2 / §3.7 layout: in `view` state, "role info" left and "attached policies" right, decided by a container query (`@min-[48rem]`). The matrix now holds 3 tenant policies instead of 24 permission points, so **whether 50/50 still fits is checked with a real screenshot during implementation** (fall back to a single column if too short); the baseline stays 50/50.

### 8.4 Failure shapes → page handling

Same family as §7.4, only the copy differs:

| Upstream shape | Meaning | Page handling |
| :--- | :--- | :--- |
| `200 {code:400,message}` | Role delete failed (transport 200) | Notify and refetch the list |
| `400` plain text `记录不存在` | Detail / update target missing | "This role has been deleted" plus clearing the selection |
| `400` plain text containing `SQLSTATE 23505` | Duplicate `code` (create role / duplicate attach) | Create: inline "role code already exists"; attach: notify and refetch the relation |
| `400` plain text containing `SQLSTATE 23503` | Attach target missing | "The policy no longer exists, please refresh" |
| `401 {code:40101}` / `{code:10007}` | Missing credentials / expired token | Session invalid |
| No response / timeout | Upstream not configured or unreachable | The operational guidance from `upstreamHintKey()` |

### 8.5 Known gaps

`UP-RBAC-01`–`UP-RBAC-10` in `NMCPS-REC-005`; gaps G1 (no level model) and G3 (no permission catalogue) are confirmed at this document level, which is why `/system/permission` is rewritten from a "permission-point matrix" into "policy grants". The page relies only on the nine confirmed endpoints and treats none of the gaps as contract.

---

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
| 2026-11-04 | 0.6.0 | **§6 user management rewritten against the new `iam/users` (C4a)**: the endpoint table becomes `GET|POST /iam/users`, `GET|PUT|DELETE /iam/users/{id}`, `GET /iam/tenants` and `GET /iam/departments`; field semantics switch to snake_case (`id` / `username` / `display_name` / `status: active|disabled|locked` / `mfa_enabled` / `tenant_id` / `department_id`), `pageSize` → `page_size`, and the empty `list: null` is normalised to `[]` at the BFF exit; **the level model (`accountLevel`) retires wholesale** (gap G1) and ownership at creation is expressed through a department (`POST /iam/users` has no `tenant_id`, as measured); deletion is new (`DELETE`, soft delete via `deleted_at`, closing `UP-ACC-04`) and the list now carries tenant attribution (`UP-ACC-05` closed); the error-code table becomes the measured `10002` / `40001` / `10003` / `10007` / `10301` set and the password policy the measured \"6-128 characters\"; the `POST /access/dryrun` entry and its dialog retire with gap G5. |
| 2026-11-04 | 0.7.0 | **§9 rewritten against the new `audit/*` families (C4b)**: the old single endpoint `GET /audit?category=…` plus `POST /audit/verify` and `GET|POST /audit/export` is retired wholesale in favour of six read paths split by log family plus one write path — operation logs `GET /audit/operation-logs`, security logs `GET /audit/security-logs`, archive records `GET /audit/archive/records` (each with its own detail endpoint) and `POST /audit/archive/run`. The primary key moves from `logCode` to `id` (UUID), paging from `pageSize` to `page_size`, time bounds from strings to **epoch-millisecond integers** (`created_from` / `created_to`, `logged_from` / `logged_to`), and the empty `list: null` is normalised to `[]` at the BFF exit. The page becomes "three families, one page": a log-family `USelect` stands in the left area, the popover only holds that family's openapi parameters, and the archive family folds the range control away. Verification and export entries retire with gaps G6 / G7 and the archive dialog replaces export; the error-code table becomes `40401` / `10007` / `40001` (the old `10201` now means "wrong password"). Field semantics are layered honestly: archive-record fields are measured, operation / security entry fields have no real samples yet, so the page renders registered fields only and lists unregistered ones raw. The `/system/log` cases in `check:ui` go 8 → 11 (family switch swaps endpoint and time parameters, the archive family sends no time condition, selecting a row hits the family detail endpoint) and the total goes 105 → 106; the empty-list normalisation path in `check:bff` moves to `operation-logs`. |
| 2026-11-04 | 0.8.0 | **§7 / §8 rewritten against the new `iam` namespace (C4c)**: the policy section moves from "read-only `/abac/rule` inspection plus `/access/dryrun`" to policy CRUD — list / create / detail / update / delete on `GET|POST /iam/policies` and `GET|PUT|DELETE /iam/policies/{id}`, with attach / detach on the independent `POST /iam/role-policies/{AttachPolicy,DetachPolicy}` — and the ABAC segment plus the dry-run button retire as gaps G4 / G5 are upgraded from "contract unknown" to "endpoint missing". The role section moves from "`roleCode` path + `roleLevel` + permission catalogue" to UUID-keyed `GET|POST /iam/roles` and `GET|PUT|DELETE /iam/roles/{id}`, the grant matrix is rewritten from "permission × role" to "policy × role" (gap G3 confirmed: `/permission` is absent from the new openapi), and account ↔ role becomes symmetric through the three `subject-roles` endpoints (old `UP-POL-07` closed). Three old rules are voided by measurement: ① the "super admin always gets `401 10201`" domain rejection no longer exists — any authenticated session, including a role-less account, can read and write IAM endpoints and only the session tenant limits the visible range (`UP-RBAC-01` / `UP-RBAC-09`), so the client no longer bypasses requests by identity; ② `enabled` writes are ignored (`UP-RBAC-03`), so there is no enable / disable affordance; ③ the list honours `keyword`, which revokes the "fetch-all plus client-side paging" exception and restores server paging. Failure handling now dispatches on **HTTP status + response shape** (`200 {code:400}`, plain-text `400 记录不存在`, `400` with a raw `SQLSTATE`) and states that raw SQL must never reach the user. Upstream defects move from `NMCPS-REC-003` (old generation, `superseded`) to `NMCPS-REC-005`. |
| 2026-11-04 | 0.8.1 | **§8.1 gains one measured constraint (C4c-2 backfill)**: `GET /iam/subject-roles` only honours `subject_id` — looking a role up by member is not in the contract — so the page pulls every relation row once and filters by `role_id`; "who holds this role" is a client-side view, with display names and existence taken from `/api/iam/users` (orphan links are filtered on that basis, `UP-RBAC-10`). The same round records the C4c-1 / C4c-2 acceptance in the migration checklist: `check:bff` 106/106, `check:ui` 116/116. |
