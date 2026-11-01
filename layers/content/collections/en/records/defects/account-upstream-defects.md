---
docId: NMCPS-REC-002
title: "Upstream `/api/v1/account` defect list (probed 2026-11-01)"
navigation:
  title: "Upstream account defects"
description: "Record-layer defect list: an exhaustive two-identity (super admin / tenant admin) probe of `/account`, `/account/{code}`, `/account/{code}/status`, `/account/role` and `/tenant/{id}/member` on http://192.168.1.55:10000/api/v1, cross-checked with swagger, registering 6 upstream defects (tenant-admin privilege escalation, ignored `accountLevel=0` filter, 500 on missing input, no profile-update or delete endpoint, missing tenant attribution with inconsistent time zones, super admins unable to assign roles), with reproduction commands, expected behaviour and the impact on the `/system/user` page."
excerpt: "6 upstream /account defects, with reproduction and their effect on the user page."
keywords:
  - "defect"
  - "account"
  - "upstream"
  - "iam"
  - "triage"
tier: 5
authority: informative
scope:
  - rec.defects.account
status: baseline
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-003
  - NMCPS-DESIGN-005
  - NMCPS-ARCH-003
createdAt: "2026-11-01"
updatedAt: "2026-11-01"
icon: "carbon:warning-alt"
tags:
  - "Defect"
  - "Records"
  - "IAM"
  - "Upstream"
  - "Accounts"
---

# Upstream `/api/v1/account` defect list (NMCPS-REC-002)

> **Purpose**: capture this round's findings about the upstream account endpoints so the iam side can track them, and state how they bound the `/system/user` implementation.
> **Not here**: the contract itself is authoritative in `NMCPS-ARCH-003` (`layers/content/collections/cn/architecture/1.architecture/iam-architecture.md`) and `NMCPS-DESIGN-005` §6 (`layers/content/collections/cn/architecture/2.domain/system.md`); this page only records what contradicts that contract or deserves fixing, plus its current state.

## 1. Scope and method

- Target: `http://192.168.1.55:10000/api/v1`, path prefixes `/account/*`, `/tenant/*/member`, `/role`, `/permission`.
- Method: (1) diff the swagger document `/swagger/specs/gateway.json` (only `GET` / `POST` / `PUT` / `DELETE` are exposed, no `PATCH`); (2) replay positive, missing-input, privilege-escalation, cross-tenant and out-of-range-status cases as **both** super admin and tenant admin; (3) record the behaviour seen through the BFF (`GATEWAY_RESOURCES` whitelist plus slug pass-through, which never changes upstream decisions).
- Result: **five endpoints work** (`GET/POST /account`, `GET /account/{code}`, `PUT /account/{code}/status`, `POST|DELETE /account/role`, `POST|DELETE /tenant/{id}/member`); **`PUT /account/{code}` and `DELETE /account/{code}` do not exist** (`405`).

## 2. Upstream defects (6)

`UP-ACC-0x` is the stable cross-reference used by `NMCPS-DESIGN-005` §6.5.

| ID | Severity | Symptom | Reproduction | Expected |
| :--- | :--- | :--- | :--- | :--- |
| UP-ACC-01 | High | **Tenant-admin privilege escalation**: a tenant admin may `POST /account` with `accountLevel: 0` (also `2` / `4`) and gets `200`; the new account then reads cross-tenant data and creates further `level: 0` accounts | As a tenant admin, `POST /api/v1/account {"accountName":"esc_02","displayName":"esc","password":"…","accountLevel":0}`, then compare `GET /account?pageSize=200` seen by the new account | Only levels not above the caller's and inside the caller's tenant; escalation → `403` |
| UP-ACC-02 | Medium | **`accountLevel=0` is ignored as a filter**: `GET /account?accountLevel=0` returns everything (zero treated as "not provided"), while `=1` / `=2` filter correctly | Compare `total` for `accountLevel=0` and `accountLevel=1` in the same state | Honour zero as a valid filter value, or reject it explicitly and document that |
| UP-ACC-03 | Medium | **Missing input / out-of-range level returns `500 10509`**: empty body, missing `accountLevel`, `accountLevel: 9`, `status: 5` all return `500` (same root cause as `UP-AUTH-03`) | Send each incomplete request | `400 10101` with field-level detail |
| UP-ACC-04 | Medium | **No profile-update and no delete endpoint**: `PUT /account/{code}` and `DELETE /account/{code}` return `405`; `displayName` is immutable after creation | `curl -X PUT .../account/ACC…`, `curl -X DELETE ...` | Add `PUT` (display name, MFA toggle) and `DELETE`, or document "disable only" as the design |
| UP-ACC-05 | Low | **List lacks tenant attribution and mixes time zones**: list items carry no `tenantId` / `tenantCode` (a super admin cannot tell which tenant owns an account); `createdAt` is local time from `GET` but UTC from `POST` | Compare the same field from a super-admin `GET /account` and a `POST /account` | Add `tenantId` / `tenantCode` to the list; emit UTC everywhere and label it |
| UP-ACC-06 | Low | **Super admins cannot assign roles**: `POST /account/role` always returns `10201` (domain reject) for a super admin, while tenant admins may use it inside their tenant | Call `POST /account/role` for the same `accountCode` as both identities | Platform-level accounts should either be assignable or return an explicit "not applicable" |

Additional observations the page must know (not defects):

- **Status enum**: `1` enabled / `2` disabled / `3` locked / `4` pending activation (swagger); `0` and `5` are not writable.
- **The path segment is `accountCode`** (`ACC…`), not `accountId`; cross-tenant calls return `10301` without leaking existence.
- **`accountName` is unique**: duplicates → `10302`; weak passwords → `20101`.
- **`mustResetPassword`** leaves the new account at `status: 4`; forced password change stays a client-side convention (as in the `UP-AUTH` record).

## 3. Impact on the `/system/user` page

The page depends only on the three confirmed endpoints (`GET /account`, `POST /account`, `PUT /account/{code}/status`) and keeps the gaps out of the UI:

| Defect | Page handling |
| :--- | :--- |
| UP-ACC-01 | Level picker follows the identity (super admin `0`/`1`, tenant admin `1` only); no escalation entry point |
| UP-ACC-02 | No "super admins only" filter (the `accountLevel=0` filter is ignored, so sending it would mislead) |
| UP-ACC-03 | Client-side validation (required fields, password length, level range) plus readable mapping of `10101` / `10509` |
| UP-ACC-04 | No edit or delete buttons; "disable" carries the delete semantics, `displayName` is read-only |
| UP-ACC-05 | No tenant column; `createdAt` shown verbatim with no time-zone conversion or "(UTC)" suffix |
| UP-ACC-06 | No role-binding control; roles and permissions live under `/system/permission` |

Client-side narrowing is **not a security boundary**: the BFF only enforces the whitelist, authorisation stays upstream, and the defects must be fixed there.

## 4. Reproduction commands

```bash
BASE=http://192.168.1.55:10000/api/v1
# Obtain a token (once as super admin, once as tenant admin)
AT=$(curl -s -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d '{"accountName":"admin","password":"<pwd>"}' | jq -r .data.accessToken)

# UP-ACC-01 tenant admin escalates (expect 403, observed 200)
curl -s -X POST "$BASE/account" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"accountName":"esc_probe","displayName":"probe","password":"<pwd>","accountLevel":0}'

# UP-ACC-02 zero-value level filter is ignored (expect super admins only, observed everything)
curl -s "$BASE/account?page=1&pageSize=200&accountLevel=0" -H "authorization: Bearer $AT" | jq .data.total

# UP-ACC-03 missing input returns 500 (expect 400 10101)
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/account" \
  -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{}'

# UP-ACC-04 no profile-update or delete endpoint
curl -s -o /dev/null -w '%{http_code}\n' -X PUT "$BASE/account/ACC00000000" -H "authorization: Bearer $AT"
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "$BASE/account/ACC00000000" -H "authorization: Bearer $AT"

# UP-ACC-06 super admin role assignment is domain-rejected (observed 10201)
curl -s -X POST "$BASE/account/role" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"accountCode":"ACC00000000","roleCode":"viewer"}'
```

## 5. Status

| Item | State |
| :--- | :--- |
| UP-ACC-01–UP-ACC-06 | **Open** (owned by the upstream iam side); the page already narrows per §3 |
| `/system/user` page | Implemented against the "minimum trustworthy surface", treating no gap as contract |
| BFF whitelist | `account` is part of `GATEWAY_RESOURCES`; pass-through never changes decisions |
| Docs | `NMCPS-DESIGN-005` §6 (cn/en), this record, `doc-map` and `shared/constants/docIds.ts` updated together |

## 6. Not verified

- Whether super admins have a separate platform-domain endpoint for role assignment: only `/account/role` was probed; no alternative path was found.
- The business meaning of `accountLevel: 2 / 3 / 4`: upstream accepts them but returns no distinguishing field, so their purpose cannot be determined.
- Mobile and desktop-window behaviour: `/system/user` was only verified in a browser and under the `check:ui` stub environment, never on a real device.

