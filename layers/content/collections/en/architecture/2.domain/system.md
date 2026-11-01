---
docId: NMCPS-DESIGN-005
title: "System Management Domain Baseline"
description: "Tier 2 design baseline for the system management domain (domain.system): system logs, policy management, user and permission management, including the /system/user endpoint, field, permission-matrix and error-code baseline. This is the single authority for the domain.system domain."
excerpt: "System logs, policy, user and permission management (incl. the user-page baseline)."
keywords:
  - "system"
  - "permission"
  - "baseline"
tier: 2
authority: normative
scope:
  - domain.system
status: baseline
version: 0.3.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-003
createdAt: "2026-10-25"
updatedAt: "2026-11-01"
icon: "carbon:settings"
tags:
  - "Domain"
  - "System"
  - "Permission"
---

# System Management Domain Baseline (NMCPS-DESIGN-005)

> **Responsibility**: single authority for `domain.system` — system logs, policy management, user and permission management. IAM architecture: `NMCPS-ARCH-003`.
> **Audience**: implementation engineers / AI assistants.

---

## 1. Positioning

System management is the "governance plane" of the NMS: it manages runtime logs, global policies, user accounts, and permission assignment — the operational UI of the IAM architecture (`NMCPS-ARCH-003`).

---

## 2. Functional Scope

| Sub-page | Function |
| :--- | :--- |
| log | System log query and audit |
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

> Source: live probing of `http://192.168.1.55:10000/api/v1` on 2026-11-01 with both identities (super admin / tenant admin), cross-checked against swagger. Deviations from the contract are filed in `NMCPS-REC-002` (`layers/content/collections/cn/records/defects/account-upstream-defects.md`); this section only states what the page may rely on.

### 6.1 Data source and endpoints

| Capability | BFF path | Upstream | Notes |
| :--- | :--- | :--- | :--- |
| List | `GET /api/account` | `GET /api/v1/account` | `page` / `pageSize` / `keyword` / `accountLevel` / `status` |
| Create | `POST /api/account` | `POST /api/v1/account` | `accountName` / `displayName` / `password` / `accountLevel` required; `mfaEnabled` / `mustResetPassword` optional |
| Status | `PUT /api/account/{accountCode}/status` | same | body `{ status }`, returns `{ ok: true }` |
| Detail | `GET /api/account/{accountCode}` | same | not used by the page: the list already carries every displayed field |

- The `{id}` path segment is the `accountCode` (`ACC…`), not the numeric `accountId`.
- **There is no profile-update endpoint** (no `PUT /api/v1/account/{id}`) and no delete endpoint: `displayName` is immutable after creation, and "delete" means `status=2` (disabled).
- The BFF whitelist must contain `account` (`GATEWAY_RESOURCES` in `shared/types/api.ts`); otherwise every call returns `404 bff_resource_not_allowed`.

### 6.2 Field semantics

- `accountLevel`: `0` platform super admin / `1` tenant admin (consistent with section 5 of `NMCPS-ARCH-003`). Upstream accepts `0–4`, but `2/3/4` have no defined meaning → rendered read-only as "undefined level", and the create form offers only `0` / `1`.
- `status`: `1` enabled / `2` disabled / `3` locked / `4` pending activation (swagger wording). Writing `0` or `5` → `10101`; `4` is produced by `mustResetPassword` at creation time, so the page never writes `4` itself.
- `createdAt`: `GET` returns local time while `POST` returns UTC (one field, two time zones) → displayed verbatim, never time-zone converted (UP-ACC-05).
- The list payload has **no** `tenantId` / `tenantCode` / `email` / `phone`: the page shows no tenant column and no email/phone columns (v1 fields that upstream does not have).
- `accountName` is unique: duplicates → `10302`. Passing `accountLevel=0` as a **filter** is treated as "not provided" (zero value) and returns everything, so the page offers no "super admins only" filter (UP-ACC-02).

### 6.3 Permission matrix (measured)

| Action | Super admin (`accountLevel: 0`, `tenantId: 0`) | Tenant admin (`accountLevel: 1`, `tenantId ≥ 1`) |
| :--- | :--- | :--- |
| List scope | Whole platform | Own tenant only |
| Create | Allowed (including `accountLevel: 0`) | Own tenant; **`0` / `2` / `4` are accepted and should be rejected** |
| Status update | Any account | Own tenant only, cross-tenant → `10301` |
| Role assignment `POST /api/account/role` | always `10201` (domain reject) | allowed for accounts in the tenant |
| Tenant membership `POST /api/tenant/{id}/member` | allowed | allowed for own tenant |

Client-side narrowing (**not a security boundary**; it only avoids guiding users into calls upstream rejects or should reject):

1. The level picker follows the identity: super admin chooses `0` / `1`, tenant admin only `1`. Tenant-side privilege escalation is an upstream gap (UP-ACC-01), so the page exposes no entry point for it.
2. The row action "change status" is disabled for the caller's own account (`accountCode` equals the session account) to avoid self-lockout.
3. No role-binding or tenant-membership controls: the former is rejected with `10201` for super admins, the latter cannot be targeted because the list lacks `tenantId`; both belong to `/system/permission` and the tenant domain.
4. Upstream remains the only authorisation point: the BFF only enforces the whitelist, and client narrowing never changes backend decisions.

### 6.4 Error codes → page handling

| Code | Upstream meaning | Page handling |
| :--- | :--- | :--- |
| `10302` | Account name already exists | inline error on `accountName` |
| `20101` | Password violates the complexity / lifetime policy | inline error on `password` |
| `10101` | Invalid parameters (status or level out of range) | "invalid parameters" notice |
| `10301` | Target missing or outside the current tenant domain | "account not found or not permitted" |
| `10201` | Unauthenticated / domain reject | "session expired or the current identity may not do this" |
| `10509` | Upstream internal error (missing field, level out of range) | generic failure + check required fields |

Upstream missing / unreachable / timeout reuse the operational guidance from `upstreamHintKey()` (same wording as the login page and `/user/security`).

### 6.5 Known gaps

`UP-ACC-01`–`UP-ACC-06` in `NMCPS-REC-002`: tenant-admin privilege escalation, the `accountLevel=0` filter being ignored, `500` for missing fields or out-of-range levels, no profile-update or delete endpoint, missing tenant attribution plus inconsistent time zones, and super admins being unable to assign roles. The page depends only on the three confirmed endpoints and treats none of the gaps as contract.

---



## 7. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: system management domain baseline. |
| 2026-10-31 | 0.2.0 | Functional scope gains the `download` sub-page (`/system/download`, "Downloads"): the former root download landing page moved into the system section, with installer links pointing straight at GitHub Releases; see `NMCPS-ADR-0016`. |
| 2026-11-01 | 0.3.0 | New section 6, the `/system/user` implementation baseline: endpoint table (list / create / status, no profile update or delete), field and status enumerations, the super-admin vs tenant-admin permission matrix with client narrowing, error-code mapping and the gap list; upstream defects are filed separately as `NMCPS-REC-002`. |
