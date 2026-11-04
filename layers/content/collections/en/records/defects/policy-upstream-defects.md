---
docId: NMCPS-REC-003
title: "Upstream `/api/v1/{role,permission,abac,access}` defect list (probed 2026-11-01)"
navigation:
  title: "Upstream policy defects"
description: "Record-layer defect list: an exhaustive two-identity (super admin / tenant admin) probe of `/role`, `/role/{code}/permission`, `/permission`, `/abac/rule` and `/access/dryrun` on http://192.168.1.55:8888/api/v1, cross-checked with swagger, registering 10 upstream defects (missing lifecycle endpoints, unvalidated DSL syntax, grants reading back without `effect`, incomplete inputs and filters, level escalation vs out-of-range, dry run ignoring context, write-only account↔role, super admins rejected by the domain, built-in roles read-only, inconsistent time zones), with reproduction commands, expected behaviour and the impact on `/system/policy` and `/system/permission`."
excerpt: "10 upstream policy and permission defects, with reproduction and how the two pages narrow around them."
keywords:
  - "defect"
  - "policy"
  - "permission"
  - "upstream"
  - "iam"
tier: 5
authority: informative
scope:
  - rec.defects.policy
status: superseded
supersededBy: NMCPS-ADR-0018
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
  - "Policy"
  - "Permission"
---

# Upstream `/api/v1/{role,permission,abac,access}` defect list (NMCPS-REC-003)

> **Generation note (2026-11-04)**: this list was captured against the **retired** go-zero gateway; that instance is gone and the repository plus the integration environment now target `http://192.168.1.55:8888/api/v1`. The host:port in the reproduction commands below has been rewritten to the current instance, **but the findings describe the old generation only** — re-probe before using them as a coding basis. The list is kept as history and `status` is set to `superseded`.

> **Purpose**: capture this round's findings about the upstream policy / permission endpoints so the iam side can track them, and state how they bound `/system/policy` and `/system/permission`.
> **Not here**: the contract itself is authoritative in `NMCPS-ARCH-003` (`layers/content/collections/en/architecture/1.architecture/iam-architecture.md`) and `NMCPS-DESIGN-005` §7 / §8 (`layers/content/collections/en/architecture/2.domain/system.md`); this page only records what contradicts that contract or deserves fixing, plus its current state.

## 1. Scope and method

- Target: `http://192.168.1.55:8888/api/v1`, path prefixes `/role`, `/role/{roleCode}/permission`, `/permission`, `/abac/rule`, `/access/dryrun`.
- Method: (1) diff the swagger document (only `GET` / `POST` / `PUT` / `DELETE` are exposed, no `PATCH`); (2) replay positive, missing-input, privilege-escalation, cross-tenant and out-of-range-level cases as **both** super admin and tenant admin; (3) record the behaviour seen through the BFF (`GATEWAY_RESOURCES` whitelist plus slug pass-through, which never changes upstream decisions).
- Result: **ten endpoints work** (`GET /role`, `GET|POST|DELETE /role/{code}`, `GET|POST|DELETE /role/{code}/permission`, `GET|POST /permission`, `GET|POST /abac/rule`, `POST /access/dryrun`); **rules have no update or delete endpoint** (`PUT` / `PATCH` / `DELETE /abac/rule/{id}` all return `404`).

## 2. Upstream defects (10)

The `UP-POL-0x` ids are the stable references used by `NMCPS-DESIGN-005` §7.5 / §8.5 and by code comments.

| Id | Severity | Symptom | Repro | Expected |
| :--- | :--- | :--- | :--- | :--- |
| UP-POL-01 | High | **Write endpoints are incomplete**: a rule can be neither updated nor deleted (`PUT` / `PATCH` / `DELETE /abac/rule/{id}` → `404`); `POST /permission` exists but there is no delete; roles have no `PUT /role/{code}/status`, so `status` can only change in the database | Request each path and diff swagger | Complete the rule lifecycle and permission delete; document or implement role status |
| UP-POL-02 | High | **`conditionDsl` is not validated**: an invalid govaluate expression still returns `200`; a duplicate `ruleCode` returns `409 10302` | `POST /abac/rule` with `conditionDsl: "("` | Validate the syntax and return `400 10101` with a position |
| UP-POL-03 | High | **Grants read back without `effect`**: `POST .../permission` accepts `effect=2` (deny) but `GET .../permission` only returns the permission bodies, so a deny becomes invisible | Write `{permCode, effect: 2}` then read back | Return `effect`, otherwise denies cannot be audited |
| UP-POL-04 | Medium | **Incomplete inputs and filters**: `GET /abac/rule` only accepts `page` / `pageSize` (no `keyword`); `POST /role` with a missing required field returns `500 10509` instead of `400 10101` | `GET /abac/rule?keyword=x`, `POST /role` with an empty body | Add `keyword` to the list; return `400 10101` for missing input |
| UP-POL-05 | Medium | **Level escalation and out-of-range levels**: a tenant admin creating a role at the same or a higher level gets `20103`, `roleLevel > 4` gets `40308`, and the messages do not distinguish the two | `POST /role` as tenant admin with `roleLevel: 0/1/9` | Separate "not permitted" from "out of range" and return field-level details |
| UP-POL-06 | Medium | **Dry run ignores optional context**: `clientIp` / `deviceCode` / `resourceTags` / `accountLevel` are accepted but do not affect the decision | Keep `accountId` / `path` / `method` fixed and vary only those four fields | Either use them in evaluation or reject unknown fields |
| UP-POL-07 | Medium | **Account↔role is write-only**: `GET /account/role?accountId=` does not exist (`404`) while `POST|DELETE /account/role` work | `GET /account/role?accountId=…` | Provide a read endpoint, otherwise bindings cannot be audited |
| UP-POL-08 | Medium | **Super admins are rejected by the whole policy domain**: `/role`, `/permission`, `/abac/rule`, `/access/dryrun` always return `401 10201` for a super-admin token | Call all four endpoints with a super-admin token | Platform-level roles / rules should be manageable, or document "policy domain is tenant-only" |
| UP-POL-09 | Medium | **Built-in roles are read-only via three different codes**: grant `40307`, revoke `40305`, delete `40303` — one meaning, three sources of wording | For an `isBuiltin: true` role call `POST` / `DELETE` / `DELETE /role/{code}` | Collapse them into one "built-in role is read-only" code |
| UP-POL-10 | Low | **Inconsistent time zones**: `GET /role` returns `createdAt` in UTC while `POST /role` returns local time | Create a role, then compare the same field | Standardise on UTC and label it |

Additional observations (not defects, but the pages must know them):

- **The path segment is `roleCode`** (not `roleId`): `/role/{roleCode}/permission`, `DELETE /role/{roleCode}`.
- **`GET /role/{code}` exists** but neither page calls it: list entries already carry every displayed field.
- **The permission catalog is small** (24 rows measured) and can be paged in fully; `resourceType=0` is treated as "not provided".
- **`roleCode: ""` means a global rule**: upstream uses an empty string rather than `null`, and the page shows it verbatim.

## 3. Impact on `/system/policy` and `/system/permission`

| Defect | Page handling |
| :--- | :--- |
| UP-POL-01 | `/system/policy` is read-only inspection: no create / update / delete / toggle entry (a write entry that can only create and never reclaim is worse than none); `/system/permission` offers no role enable / disable and no permission create / delete |
| UP-POL-02 | The DSL is shown verbatim with a copy action, never "prettified" or "corrected"; a duplicate role code (`10302`) becomes an inline error on `roleCode` |
| UP-POL-03 | The grant toggle only expresses `ALLOW`; there is no deny toggle (writing one makes it invisible) |
| UP-POL-04 | Rule search filters **client-side** (rules are paged in fully first, bounded by `MAX_RULE_PAGES`); required fields on the create-role form are blocked locally |
| UP-POL-05 | The level picker narrows by identity (a tenant admin only gets `2`–`4`); `20103` / `40308` map to readable copy |
| UP-POL-06 | The dry-run form only exposes `accountId` / `path` / `method` and never shows controls that do nothing |
| UP-POL-07 | No account↔role binding entry |
| UP-POL-08 | A super admin sees only the identity notice on both pages and **issues no request** |
| UP-POL-09 | Built-in roles still appear in the list, but their grant toggles and delete entry are disabled with a stated reason |
| UP-POL-10 | `createdAt` is rendered as returned, with no time-zone conversion |

Client narrowing is **not a security boundary**: the BFF only does allowlisted pass-through, authorization stays upstream, and the defects must be fixed there.

## 4. Reproduction commands (copy-paste ready)

```bash
BASE=http://192.168.1.55:8888/api/v1
AT=$(curl -s -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d '{"accountName":"admin","password":"<pwd>"}' | jq -r .data.accessToken)

# UP-POL-01 rules have no update / delete endpoint (expected to work, actually 404)
curl -s -o /dev/null -w '%{http_code}\n' -X PUT "$BASE/abac/rule/1" -H "authorization: Bearer $AT"
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "$BASE/abac/rule/1" -H "authorization: Bearer $AT"

# UP-POL-02 an invalid DSL still returns 200
curl -s -X POST "$BASE/abac/rule" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"ruleCode":"probe_dsl","ruleName":"probe","conditionDsl":"(","priority":99}'

# UP-POL-03 a deny cannot be read back (no effect in the response)
curl -s -X POST "$BASE/role/$ROLE/permission" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' -d '{"permCode":"asset:device:read","effect":2}'
curl -s "$BASE/role/$ROLE/permission?page=1&pageSize=100" -H "authorization: Bearer $AT" | jq '.data.list[0]'

# UP-POL-04 no keyword on the rule list; missing role fields return 500
curl -s "$BASE/abac/rule?page=1&pageSize=5&keyword=x" -H "authorization: Bearer $AT" | jq .data.total
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/role" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' -d '{}'

# UP-POL-05 level out of range / escalation
curl -s -X POST "$BASE/role" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"roleCode":"probe_l0","roleName":"probe","roleLevel":0}'

# UP-POL-07 the account-role read endpoint does not exist
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/account/role?accountId=1" -H "authorization: Bearer $AT"

# UP-POL-08 a super admin calling the policy domain (expected to work, actually 401 10201)
curl -s "$BASE/abac/rule?page=1&pageSize=5" -H "authorization: Bearer $AT" | jq .code
```

## 5. Status

| Item | Status |
| :--- | :--- |
| UP-POL-01 – UP-POL-10 | **Open** on the upstream iam side; both pages already narrow as described in section 3 |
| `/system/policy`, `/system/permission` | Implemented against the smallest trustworthy surface; no gap is treated as contract |
| BFF allowlist | `role` / `permission` / `abac` / `access` are in `GATEWAY_RESOURCES`; pass-through never changes decisions |
| Documentation | `NMCPS-DESIGN-005` §7 / §8 (cn/en), this page, `doc-map` and `shared/constants/docIds.ts` updated together |

## 6. Unverified

- The govaluate feature set behind `conditionDsl` (operators, function allowlist): only "syntax is not validated" was probed, not semantic limits.
- The `status` value domain is not exhausted: only `1` (enabled) / `2` (disabled) were observed for rules and roles, `0` has no sample — so the pages send anything other than `1` / `2` to `status.unknown` with the raw value.
- Dry-run evaluation order against real ABAC rules (whether `priority` ascending is the only criterion): no stable sample exists.
- Mobile / native-window behaviour: both pages were only verified in a browser and in the `check:ui` stub environment, never on a real device.

