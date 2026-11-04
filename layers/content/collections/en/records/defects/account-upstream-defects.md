---
docId: NMCPS-REC-002
title: "Upstream `/api/v1/account` defect list (probed 2026-11-01, re-probed 2026-11-03)"
navigation:
  title: "Upstream account defects"
description: "Record-layer defect list: an exhaustive two-identity (super admin / tenant admin) probe of `/account`, `/account/{code}`, `/account/{code}/status`, `/account/role` and `/tenant/{id}/member` on http://192.168.1.55:8888/api/v1, cross-checked with swagger, registering 8 upstream defects (tenant-admin privilege escalation [closed], ignored `accountLevel=0` filter, 500 on missing input, no profile-update or delete endpoint, missing tenant attribution with inconsistent time zones, super admins unable to assign roles, the new mandatory `tenantId` on create, `accountLevel=4` reserved for service accounts), with reproduction commands, expected behaviour and the impact on the `/system/user` page."
excerpt: "8 upstream /account defects (including the 2026-11-03 additions and closures), with reproduction and their effect on the user page."
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
status: superseded
supersededBy: NMCPS-ADR-0018
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-003
  - NMCPS-DESIGN-005
  - NMCPS-ARCH-003
createdAt: "2026-11-01"
updatedAt: "2026-11-03"
icon: "carbon:warning-alt"
tags:
  - "Defect"
  - "Records"
  - "IAM"
  - "Upstream"
  - "Accounts"
---

# Upstream `/api/v1/account` defect list (NMCPS-REC-002)

> **Generation note (2026-11-04)**: this list was captured against the **retired** go-zero gateway; that instance is gone and the repository plus the integration environment now target `http://192.168.1.55:8888/api/v1`. The host:port in the reproduction commands below has been rewritten to the current instance, **but the findings describe the old generation only** — re-probe before using them as a coding basis. The list is kept as history and `status` is set to `superseded`.

> **Purpose**: capture this round's findings about the upstream account endpoints so the iam side can track them, and state how they bound the `/system/user` implementation.
> **Not here**: the contract itself is authoritative in `NMCPS-ARCH-003` (`layers/content/collections/cn/architecture/1.architecture/iam-architecture.md`) and `NMCPS-DESIGN-005` §6 (`layers/content/collections/cn/architecture/2.domain/system.md`); this page only records what contradicts that contract or deserves fixing, plus its current state.

## 1. Scope and method

- Target: `http://192.168.1.55:8888/api/v1`, path prefixes `/account/*`, `/tenant/*/member`, `/role`, `/permission`.
- Method: (1) diff the swagger document `/swagger/specs/gateway.json` (only `GET` / `POST` / `PUT` / `DELETE` are exposed, no `PATCH`); (2) replay positive, missing-input, privilege-escalation, cross-tenant and out-of-range-status cases as **both** super admin and tenant admin; (3) record the behaviour seen through the BFF (`GATEWAY_RESOURCES` whitelist plus slug pass-through, which never changes upstream decisions).
- Result: **five endpoints work** (`GET/POST /account`, `GET /account/{code}`, `PUT /account/{code}/status`, `POST|DELETE /account/role`, `POST|DELETE /tenant/{id}/member`); **`PUT /account/{code}` and `DELETE /account/{code}` do not exist** (`405`).

## 2. Upstream defects (8)

`UP-ACC-0x` is the stable cross-reference used by `NMCPS-DESIGN-005` §6.5.

| ID | Severity | Symptom | Reproduction | Expected |
| :--- | :--- | :--- | :--- | :--- |
| UP-ACC-01 | ~~High~~ **closed** | **Tenant-admin privilege escalation**: on 2026-11-01 a tenant admin could `POST /account` with `accountLevel: 0` / `2` / `4` and got `200`. **Fixed as of the 2026-11-03 re-probe**: same or higher level now returns `20103 只能向下管控：不可操作与自身同级或更高权限的账号/角色` | As a tenant admin, `POST /api/v1/account` with `accountLevel` in `0` / `1` / `2` / `3` / `4` / `9` (reusing an existing name so nothing is written): `0` / `1` → `20103`, `2` / `3` → past the level gate (`10302` duplicate), `4` → `20102`, `9` → `10101` | Already met: only levels strictly below the caller may be created |
| UP-ACC-02 | Medium | **`accountLevel=0` is ignored as a filter**: `GET /account?accountLevel=0` returns everything (zero treated as "not provided"), while `=1` / `=2` filter correctly | Compare `total` for `accountLevel=0` and `accountLevel=1` in the same state | Honour zero as a valid filter value, or reject it explicitly and document that |
| UP-ACC-03 | Medium | **Missing input / out-of-range level returns `500 10509`**: empty body, missing `accountLevel`, `status: 5` all return `500` (same root cause as `UP-AUTH-03`); **re-probe update**: `accountLevel: 9` now returns `10101`, but a missing `tenantId` also returns `10101` with no field-level detail | Send each incomplete request | `400 10101` with field-level detail |
| UP-ACC-04 | Medium | **No profile-update and no delete endpoint**: `PUT /account/{code}` and `DELETE /account/{code}` return `405`; `displayName` is immutable after creation | `curl -X PUT .../account/ACC…`, `curl -X DELETE ...` | Add `PUT` (display name, MFA toggle) and `DELETE`, or document "disable only" as the design |
| UP-ACC-05 | Low | **List lacks tenant attribution and mixes time zones**: list items carry no `tenantId` / `tenantCode` (a super admin cannot tell which tenant owns an account); `createdAt` is local time from `GET` but UTC from `POST` | Compare the same field from a super-admin `GET /account` and a `POST /account` | Add `tenantId` / `tenantCode` to the list; emit UTC everywhere and label it |
| UP-ACC-06 | Low | **Super admins cannot assign roles**: `POST /account/role` always returns `10201` (domain reject) for a super admin, while tenant admins may use it inside their tenant | Call `POST /account/role` for the same `accountCode` as both identities | Platform-level accounts should either be assignable or return an explicit "not applicable" |
| UP-ACC-07 | Medium | **Create now requires `tenantId`, which only upstream knows**: `POST /account` without `tenantId` (or with `0`) → `10101 请求参数不合法：缺少必填参数 tenantId`. A tenant admin succeeds without it (derived from the token); **a super admin always fails**; neither `GET /account` nor `/auth/whoami` exposes a reusable tenant field | Same body without `tenantId` as both identities: super admin → `10101`, tenant admin → passes | (1) derive the tenant from the token consistently, or (2) return `tenantId` in `GET /account` so the client has a source |
| UP-ACC-08 | Low | **`accountLevel: 4` now has a home but is still not creatable**: `4` → `20102 账号等级与归属层不匹配：平台层仅可建 L0，租户层为 L1-L3，服务账号由系统自动开通`. The same message claims "platform layer may only create L0", which contradicts the measurement (a super admin creates `1`–`3` fine) | Send `accountLevel: 4` as both identities | Align wording with the decision; document how service accounts are listed |

Additional observations the page must know (not defects):

- **Status enum**: `1` enabled / `2` disabled / `3` locked / `4` pending activation (swagger); `0` and `5` are not writable.
- **The path segment is `accountCode`** (`ACC…`), not `accountId`; cross-tenant calls return `10301` without leaking existence.
- **`accountName` is unique**: duplicates → `10302`; weak passwords → `20101`.
- **`mustResetPassword`** leaves the new account at `status: 4`; forced password change stays a client-side convention (as in the `UP-AUTH` record).
- **Creatable levels (re-probe)**: strictly below the caller and `≤ 3` — super admin `L1`–`L3`, tenant admin `L2`–`L3`. Upstream calls `2` / `3` "tenant layer", and no field distinguishes them beyond the number.

## 3. Impact on the `/system/user` page

The page depends only on the confirmed endpoints (`GET /account`, `POST /account`, `PUT /account/{code}/status`, plus `GET /tenant` for the tenant a super admin must pick) and keeps the gaps out of the UI:

| Defect | Page handling |
| :--- | :--- |
| UP-ACC-01 | **Closed**. The page still narrows the same way: level picker = strictly below self and `≤ 3` (super admin `L1`–`L3`, tenant admin `L2`–`L3`). Before the re-probe it offered only `1`, so a tenant admin could only submit a value upstream must reject with `20103` (fixed 2026-11-03) |
| UP-ACC-02 | No "super admins only" filter (the `accountLevel=0` filter is ignored, so sending it would mislead) |
| UP-ACC-03 | Client-side validation (required fields, password length, level range) plus readable mapping of `10101` / `10509` |
| UP-ACC-04 | No edit or delete buttons; "disable" carries the delete semantics, `displayName` is read-only |
| UP-ACC-05 | No tenant column; `createdAt` shown verbatim with no time-zone conversion or "(UTC)" suffix |
| UP-ACC-06 | No role-binding control; roles and permissions live under `/system/permission` |
| UP-ACC-07 | A super admin must pick an "owning tenant" (`GET /tenant`); `tenantId` travels with the request, while tenant admins never see the field (upstream derives it from the token) |
| UP-ACC-08 | The picker caps at `3`; `20102` maps to "this layer cannot create that level" and is attached to the level field |

Client-side narrowing is **not a security boundary**: the BFF only enforces the whitelist, authorisation stays upstream, and the defects must be fixed there.

## 4. Reproduction commands

```bash
BASE=http://192.168.1.55:8888/api/v1
# Obtain a token (once as super admin, once as tenant admin)
AT=$(curl -s -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d '{"accountName":"admin","password":"<pwd>"}' | jq -r .data.accessToken)

# UP-ACC-01 (closed on 2026-11-03) tenant admin at same / higher level → 20103
# The name intentionally reuses the existing "tenantadmin": the level gate fires before uniqueness, so nothing is written
for L in 0 1 2 3 4 9; do curl -s -X POST "$BASE/account" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' \
  -d "{\"accountName\":\"tenantadmin\",\"displayName\":\"probe\",\"password\":\"<pwd>\",\"accountLevel\":$L}"; echo; done
# Expect: 0/1 → 20103; 2/3 → 10302 (level passed, name taken); 4 → 20102; 9 → 10101

# UP-ACC-07 super admin without tenantId → 10101 missing required parameter tenantId
curl -s -X POST "$BASE/account" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"accountName":"admin","displayName":"probe","password":"<pwd>","accountLevel":1}'

# UP-ACC-07 the only source of a tenantId value is GET /tenant
curl -s "$BASE/tenant" -H "authorization: Bearer $AT" | jq '.data.list[].tenantId'

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
| UP-ACC-01 | **Closed** (2026-11-03 re-probe: same / higher level returns `20103`) |
| UP-ACC-02–UP-ACC-08 | **Open** (owned by the upstream iam side); the page already narrows per §3 |
| `/system/user` page | Implemented against the "minimum trustworthy surface", treating no gap as contract; the creatable levels and the tenant picker follow the re-probe |
| BFF whitelist | `account` / `tenant` are part of `GATEWAY_RESOURCES`; pass-through never changes decisions |
| Docs | `NMCPS-DESIGN-005` §6 (cn/en, 0.5.7), this record and `doc-map` updated together |

## 6. Not verified

- Whether super admins have a separate platform-domain endpoint for role assignment: only `/account/role` was probed; no alternative path was found.
- The business difference between `accountLevel: 2` and `3`: upstream lumps both into "tenant layer" and returns no distinguishing field.
- Whether a super-admin create really lands in the selected tenant: proving it needs a real new account, while this round only reached the level / uniqueness gate with a duplicate name, so nothing was written.
- Mobile and desktop-window behaviour: `/system/user` was only verified in a browser and under the `check:ui` stub environment, never on a real device.

