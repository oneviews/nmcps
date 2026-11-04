---
docId: NMCPS-REC-005
title: "Upstream `/api/v1/iam/{roles,policies,role-policies,subject-roles}` defect list (probed 2026-11-04)"
navigation:
  title: "Upstream iam role and grant defects"
description: "Record-layer defect list: a three-session (platform super admin / tenant admin / role-less account) probe of iam/roles, iam/policies, iam/role-policies and iam/subject-roles on http://192.168.1.55:8888/api/v1, cross-checked with openapi, registering 10 upstream defects (no authorization check, deletable system objects, `enabled` writes ignored, raw SQL in 400s, delete failures carried by a 200, incomplete filters with an uncapped page size, missing required-field validation, ignored `tenant_id` input, unchecked cross-tenant grants, orphan relation rows), with reproduction commands, expected behaviour and the impact on /system/policy and /system/permission."
excerpt: "10 defects in the new-generation IAM role / policy / grant endpoints, with reproduction and how the two pages narrow around them."
keywords:
  - "defect"
  - "iam"
  - "policy"
  - "role"
  - "upstream"
tier: 5
authority: informative
scope:
  - rec.defects.iam-policy
status: baseline
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-003
  - NMCPS-DESIGN-005
  - NMCPS-ARCH-003
createdAt: "2026-11-04"
updatedAt: "2026-11-04"
icon: "carbon:warning-alt"
tags:
  - "Defect"
  - "Records"
  - "IAM"
  - "Upstream"
  - "Policy"
  - "Role"
---

# Upstream `/api/v1/iam/{roles,policies,role-policies,subject-roles}` defect list (NMCPS-REC-005)

> **Responsibility**: registers this round's findings on the new-generation IAM role / policy / grant endpoints so the upstream iam team can track them, and states how they constrain `/system/policy` and `/system/permission`.
> **Not here**: the contract is authoritative in `NMCPS-ARCH-003` (`layers/content/collections/cn/architecture/1.architecture/iam-architecture.md`) and `NMCPS-DESIGN-005` §7 / §8 (`layers/content/collections/cn/architecture/2.domain/system.md`); this list only records what contradicts the contract or deserves a fix.
> **Relation to the old generation**: `NMCPS-REC-003` describes the retired `/role|/permission|/abac|/access` generation and is `superseded`; this list covers the new generation and uses `UP-RBAC-xx`, which never collides with the old `UP-POL-0x`.

## 1. Scope and method

- Target: `http://192.168.1.55:8888/api/v1`, path prefixes `/iam/roles`, `/iam/policies`, `/iam/role-policies`, `/iam/subject-roles`.
- Method: ① diff the endpoint list against `/swagger/openapi.json` (127 paths); ② run positive, missing-parameter, duplicate, over-privilege and cross-tenant cases under **three sessions** — platform super admin `admin` (`tenant_id = null`), a temporary tenant admin (created with `POST /iam/users` plus `AssignRole`, soft-deleted afterwards) and a role-less account (same recipe, no role assigned); ③ every write targets a probe object (self-created role / policy / user) that is soft-deleted at the end.
- Baseline: **12 endpoints are usable** — `GET|POST /iam/roles`, `GET|PUT|DELETE /iam/roles/{id}`, `GET|POST /iam/policies`, `GET|PUT|DELETE /iam/policies/{id}`, `GET /iam/role-policies`, `POST /iam/role-policies/{AttachPolicy,DetachPolicy}`, `GET /iam/subject-roles`, `POST /iam/subject-roles/{AssignRole,RevokeRole}`. **`/permission`, `/abac/rule` and `/access/dryrun` are absent from the new openapi** (gaps G3 / G4 / G5 are upgraded from "contract unknown" to "endpoint missing").

## 2. Upstream defects (10)

`UP-RBAC-0x` is the stable reference shared by this list, `NMCPS-DESIGN-005` §7.5 / §8.5 and the code comments.

| Id | Severity | Symptom | Reproduction | Expected |
| :--- | :--- | :--- | :--- | :--- |
| UP-RBAC-01 | High | **No authorization check**: a role-less account (no `subject-roles` binding) still gets 200 from `GET|POST|DELETE /iam/roles`, `GET /iam/policies` and `GET /iam/users`, and can create then delete a role | Create a user without a role, log in, read the four IAM resources | IAM management endpoints authorize against policy `actions` and return `403` otherwise |
| UP-RBAC-02 | High | **System objects are unprotected**: `DELETE /iam/roles/{id}` returns `200 {code:0}` for a role with `is_system=true`; the seed role `r_tenant_viewer_isp_a` was actually deleted during this probe | `DELETE /iam/roles/r_tenant_viewer_isp_a` | System roles / policies are read-only and return `403`; not even a soft delete |
| UP-RBAC-03 | High | **`enabled` writes are ignored**: `PUT /iam/roles/{id} {enabled:false}` returns `200` but reads back `true`; same for `PUT /iam/policies/{id}` | Create a role → PUT `enabled:false` → GET | Either the toggle works, or the contract states "no enable / disable" |
| UP-RBAC-04 | High | **400s return raw PostgreSQL text**: no envelope, no business code, and table / constraint names leak — duplicate `code` → `ERROR: duplicate key value violates unique constraint "uk_sys_role_tenant_code" (SQLSTATE 23505)`; invalid `document` → `SQLSTATE 22P02`; attaching a missing policy → `SQLSTATE 23503` | See §4 | Return `400 { code, message }` with a business code and never pass database errors through |
| UP-RBAC-05 | High | **Inconsistent failure channels**: `DELETE /iam/roles/not-a-uuid` returns **HTTP 200 + `{code:400,message:"资源不存在或无权访问"}`**, while `GET /iam/roles/{id}` for a missing record returns **HTTP 400 + plain text `记录不存在`** | See §4 | One channel: HTTP 4xx plus a single envelope |
| UP-RBAC-06 | Medium | **Incomplete filters and no page-size ceiling**: `/iam/roles` honours only `keyword` / `code` and silently ignores `enabled` / `tenant_id`; `/iam/policies` honours only `keyword` (`code=tenant.viewer`, `policy_type=system`, `enabled=false` are all ignored and still return 10 rows); `page_size=1000` is honoured verbatim (all 24 subject-roles rows) and `page=0&page_size=0` falls back to defaults | See §4 | Declare and honour the supported filters, reject invalid values, and cap `page_size` |
| UP-RBAC-07 | Medium | **Missing required-field validation**: `POST /iam/roles` with an empty body returns `200 {code:0,id}` and stores a role whose `code` and `name` are both empty; `POST /iam/users` without `email` trips `uk_sys_user_tenant_email` (`email` is effectively required and unique while openapi marks it optional) | See §4 | Validate required fields and return `400` with a business code |
| UP-RBAC-08 | High | **`tenant_id` input is ignored**: platform super admin `POST /iam/users {tenant_id:'t_isp_a'}` still stores `tnt_default`; `POST /iam/roles` and `/iam/policies` behave the same (always the session tenant) → cross-tenant provisioning is impossible | See §4 | A platform session may target any tenant through the input, or the field is dropped and "ownership follows the session" is documented |
| UP-RBAC-09 | High | **No cross-tenant grant check**: a tenant admin `POST /iam/subject-roles/AssignRole {role_id:'r_platform_admin'}` for its own user returns `200` (revoked again during the probe); a tenant session also sees 4 rows from `GET /iam/tenants` | See §4 | Validate that role and subject share a tenant; return only the own tenant |
| UP-RBAC-10 | Medium | **Relations survive soft deletes**: after soft-deleting a user its `subject-roles` row remains (one orphan measured); after soft-deleting a role both `role-policies` and `subject-roles` rows remain (`rpr_isp_a_viewer` / `srr_isp_viewer` still point at the deleted role) | See §4 | Cascade the soft delete, or filter deleted objects in the read endpoints |

## 3. Impact on the two pages

`/system/policy` and `/system/permission` rely on this "minimum trustworthy set" only:

- Usable: policy CRUD, role CRUD, relation reads / writes (`role-policies`) and subject assignment (`subject-roles`).
- Not usable: any "identity decides what may be done" judgement (UP-RBAC-01 / 09), enable / disable (UP-RBAC-03), cross-tenant object creation (UP-RBAC-08), server-side required-field validation (UP-RBAC-07) and stable failure codes (UP-RBAC-04 / 05).
- Retired: the ABAC rule segment (G4), the authorization dry run (G5) and the permission-point catalogue (G3) — none of them has an endpoint in the new generation, so they are not "temporarily unavailable".
- The client-side convergence lives in `NMCPS-DESIGN-005` §7.3 / §8.3 and is not repeated here.

## 4. Reproduction

`BASE` = `http://192.168.1.55:8888/api/v1`, `AT` = platform super-admin access token, `TT` = tenant-admin token, `ZT` = role-less account token. The full script (every defect, three sessions) lives in the Chinese record `layers/content/collections/cn/records/defects/iam-policy-upstream-defects.md` §4; the decisive calls are:

```bash
AT=$(curl -s -X POST "$BASE/iam/login" -H 'content-type: application/json' \
  -d '{"username":"admin","password":"Admin@123456"}' | jq -r .data.access_token)

# UP-RBAC-01 role-less account reads and writes IAM endpoints
curl -s "$BASE/iam/roles?page=1&page_size=100" -H "authorization: Bearer $ZT" | jq '.code, .data.total'
curl -s -X POST "$BASE/iam/roles" -H "authorization: Bearer $ZT" -H 'content-type: application/json' \
  -d '{"code":"probe_zero_role","name":"zero"}' | jq .

# UP-RBAC-02 deleting a system role succeeds (destructive: removes a seed role)
curl -s -X DELETE "$BASE/iam/roles/r_tenant_viewer_isp_a" -H "authorization: Bearer $AT"

# UP-RBAC-03 enabled write is ignored
RID=$(curl -s -X POST "$BASE/iam/roles" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"code":"probe_c4c_r2","name":"R2"}' | jq -r .id)
curl -s -X PUT "$BASE/iam/roles/$RID" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d "{\"id\":\"$RID\",\"name\":\"R2-renamed\",\"enabled\":false}" | jq .
curl -s "$BASE/iam/roles/$RID" -H "authorization: Bearer $AT" | jq '.data.name, .data.enabled'

# UP-RBAC-04 raw SQL in 400s
curl -s -X POST "$BASE/iam/policies" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"name":"dup","code":"tenant.viewer","policy_type":"system","document":"[]"}'
curl -s -X POST "$BASE/iam/policies" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"name":"bad","code":"probe_bad_doc","policy_type":"custom","document":"not-json"}'

# UP-RBAC-05 two failure channels
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "$BASE/iam/roles/not-a-uuid" -H "authorization: Bearer $AT"
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/iam/roles/00000000-0000-0000-0000-000000000000" -H "authorization: Bearer $AT"

# UP-RBAC-06 filters ignored, page size uncapped
curl -s "$BASE/iam/policies?page=1&page_size=100&code=tenant.viewer" -H "authorization: Bearer $AT" | jq '.data.total'
curl -s "$BASE/iam/subject-roles?page=1&page_size=1000" -H "authorization: Bearer $AT" | jq '.data.total, (.data.list|length)'

# UP-RBAC-07 no required-field validation
curl -s -X POST "$BASE/iam/roles" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{}' | jq .
curl -s -X POST "$BASE/iam/users" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"username":"probe_no_mail","password":"Probe@123456"}'

# UP-RBAC-08 tenant_id input ignored (the user lands in tnt_default)
UID_=$(curl -s -X POST "$BASE/iam/users" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"username":"probe_t2","password":"Probe@123456","email":"probe_t2@example.test","tenant_id":"t_isp_a"}' | jq -r .id)
curl -s "$BASE/iam/users/$UID_" -H "authorization: Bearer $AT" | jq '.data.tenant_id'

# UP-RBAC-10 orphan relations (subject ids that no longer exist as users)
curl -s "$BASE/iam/subject-roles?page=1&page_size=100" -H "authorization: Bearer $AT" | jq -r '.data.list[].subject_id' | sort -u > /tmp/sr.txt
curl -s "$BASE/iam/users?page=1&page_size=100" -H "authorization: Bearer $AT" | jq -r '.data.list[].id' | sort -u > /tmp/us.txt
comm -23 /tmp/sr.txt /tmp/us.txt
```

## 5. Environment side effects and restore

This probe left two side effects on the shared integration instance; **both need an upstream database fix** (the API cannot heal them):

| Side effect | Cause | Restore |
| :--- | :--- | :--- |
| Seed role `r_tenant_viewer_isp_a` soft-deleted | `UP-RBAC-02`: deleting a system role returns `200` (hit during probing) | `UPDATE sys_role SET deleted_at = NULL WHERE id = 'r_tenant_viewer_isp_a';` — its `role-policies` (`rpr_isp_a_viewer`) and `subject-roles` (`srr_isp_viewer`) rows still exist, so undoing the soft delete restores the state |
| Two orphan relation rows (pointing at soft-deleted probe user / role) | `UP-RBAC-10`: relations are not cleaned up on soft delete | Keep them as `UP-RBAC-10` evidence, or clean up with `DELETE FROM sys_subject_role_relation WHERE subject_id NOT IN (SELECT id FROM sys_user WHERE deleted_at IS NULL)` (table names per the actual upstream schema) |

All self-created probe objects (roles `probe_c4c_*`, policies `probe_c4c_pol*`, users `probe_c4c_*` / `probe_t2`) are soft-deleted; after cleanup the `roles` / `policies` / `role-policies` counts return to the seed values 9 / 10 / 10.

## 6. Not verified

- Whether **deleting** another tenant's role / policy is rejected: only the read range was verified as tenant-filtered. Deletions against another tenant were not attempted — the instance is shared and the failure shape is unpredictable, so no destructive test was run.
- The `policy_type` value set: all 10 measured rows are `system`, `custom` only appeared in self-created probes (the write was accepted), so no branch can be confirmed.
- The `subject_type` value set: only `user` was verified; whether `group` / `api_key` work is unprobed (`/iam/groups` and `/iam/api-keys` exist but are empty).
- `document` semantic validation: only "invalid JSON is rejected by jsonb" was verified; a valid JSON that violates policy grammar (e.g. `Action` as a string) was not tested.
- Why objects created by a platform session land in `tnt_default` instead of failing with "missing tenant": possibly because the super admin itself sits in the default tenant; needs upstream confirmation.

