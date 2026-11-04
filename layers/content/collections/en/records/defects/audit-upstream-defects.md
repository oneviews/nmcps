---
docId: NMCPS-REC-004
title: "Upstream `/api/v1/audit` defect list (probed 2026-11-02)"
navigation:
  title: "Upstream audit defects"
description: "Record-layer defect list: an exhaustive two-identity (super admin / tenant admin) probe of the `/audit` list, detail, chain verification and export endpoints on http://192.168.1.55:8888/api/v1, cross-checked with swagger, registering 9 upstream defects (undocumented tenant scoping and one shared code for expired tokens, `category` case-sensitive with unknown values silently ignored, unknown query parameters dropped and no stable `pageSize` ceiling, two accepted time formats with invalid values ignored, `verify` writing an audit entry and reporting a whole-chain index, export missing required fields answering 500, no export detail or delete endpoint, export list timestamps offset by 8 hours, detail snapshot fields always empty), with reproduction commands, expected behaviour and the impact on `/system/log`."
excerpt: "9 upstream audit defects, with reproduction and how `/system/log` narrows around them."
keywords:
  - "defect"
  - "audit"
  - "log"
  - "upstream"
  - "iam"
tier: 5
authority: informative
scope:
  - rec.defects.audit
status: superseded
supersededBy: NMCPS-ADR-0018
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-003
  - NMCPS-DESIGN-005
  - NMCPS-ARCH-003
createdAt: "2026-11-02"
updatedAt: "2026-11-02"
icon: "carbon:warning-alt"
tags:
  - "Defect"
  - "Records"
  - "IAM"
  - "Upstream"
  - "Audit"
  - "Log"
---

# Upstream `/api/v1/audit` defect list (NMCPS-REC-004)

> **Generation note (2026-11-04)**: this list was captured against the **retired** go-zero gateway; that instance is gone and the repository plus the integration environment now target `http://192.168.1.55:8888/api/v1`. The host:port in the reproduction commands below has been rewritten to the current instance, **but the findings describe the old generation only** — re-probe before using them as a coding basis. The list is kept as history and `status` is set to `superseded`.

> **Purpose**: capture this round's findings about the upstream audit endpoints so the iam side can track them, and state how they bound `/system/log`.
> **Not here**: the contract itself is authoritative in `NMCPS-ARCH-003` (`layers/content/collections/en/architecture/1.architecture/iam-architecture.md`) and `NMCPS-DESIGN-005` §9 (`layers/content/collections/en/architecture/2.domain/system.md`); this page only records what contradicts that contract or deserves fixing, plus its current state.

## 1. Scope and method

- Target: `http://192.168.1.55:8888/api/v1`, paths `/audit`, `/audit/{logCode}`, `/audit/verify`, `/audit/export`.
- Method: (1) compare the endpoint list against swagger; (2) probe with both identities — **super admin** and **tenant admin** — covering positive cases, missing parameters, cross-identity access and out-of-range values; (3) record the behaviour that survives the BFF (`GATEWAY_RESOURCES` allow-list plus slug passthrough, which does not change upstream decisions).
- Verdict: five endpoints are usable (`GET /audit`, `GET /audit/{logCode}`, `POST /audit/verify`, `GET|POST /audit/export`); export jobs have **no detail endpoint and no delete endpoint**. During the probe `GET /audit` `total` grew from `1823` to `1827`, the whole delta produced by `verify` itself (see UP-AUD-05).
- **Review note (re-probed 2026-11-02)**: the tenant-admin token taken by the first login script had already expired by the time the other calls ran, so all four endpoint families answered `401 10201`, which was recorded as "the domain rejects tenant admins". After signing in again and **decoding the JWT on the spot** (`accountLevel: 1`, `tenantId: 1`), the same account gets `code: 0` from all five families, `GET /audit` reports `total` 1709 (super admin 1893 at the same moment) and every returned row's `accountId` belongs to that tenant. Conclusion: **the audit domain is usable for tenant admins and the scope is filtered by tenant upstream**; UP-AUD-01 is corrected accordingly and the page no longer blocks requests by identity.

## 2. Upstream defects (9)

The `UP-AUD-0x` identifiers are the stable cross-reference between this page, `NMCPS-DESIGN-005` §9.1–§9.5 and the code comments.
| ID | Severity | Symptom | Reproduction | Expected |
| :--- | :--- | :--- | :--- | :--- |
| UP-AUD-01 | Low | **Tenant scoping is undocumented, and "expired token" shares `401 10201` with "no permission"**: with a **freshly issued** token a tenant admin gets `code: 0` from all five endpoint families, `GET /audit` returns a smaller `total` than the super admin (1893 vs 1709 at the same moment) and every row's `accountId` belongs to its own tenant — the scope is filtered implicitly upstream and swagger says nothing about it; an expired token answers `401 10201` (`未认证或登录态已失效`), indistinguishable from a permission denial. The first round recorded "the domain rejects tenant admins" from exactly that artefact; it is corrected here (see the review note in §1) | Request `GET /audit?page=1&pageSize=2` with an expired token and with a fresh one, compare `code` / `total` / row `accountId` | State "a tenant admin only sees its own tenant" in swagger, and give an expired token its own code (e.g. `10202`) instead of reusing `401 10201` |
| UP-AUD-02 | Medium | **`category` is a free-form, case-sensitive string**: `category=session` narrows to 79 rows, while `category=SESSION`, `auth` or an empty string are **silently ignored** and return all 1823 rows | Compare `total` for `GET /audit?category=session` and `?category=SESSION` | Validate against the enum and answer `400 10101` instead of silently dropping the filter |
| UP-AUD-03 | Medium | **Query parameters and the page-size ceiling are unstable**: undocumented parameters such as `result` / `keyword` are silently ignored (both returned the full set); `pageSize=0` returns 20 rows but echoes `0`; `pageSize=200` really returns 200 rows, `pageSize=500` returns 20 rows but echoes `500` — **no ceiling can be relied on** | `GET /audit?pageSize=0`, `200`, `500`, plus `?result=2` and `?keyword=x`, and compare row count with the echo | Document a `pageSize` ceiling and answer `400 10101` above it; make unknown parameters either work or fail |
| UP-AUD-04 | Medium | **Two time formats, invalid values ignored, single-ended windows verify nothing**: `startTime` / `endTime` accept both `YYYY-MM-DD HH:MM:SS` and RFC3339 (the same window yields the same 381 rows), while a malformed value is silently ignored (full 1823 rows); `verify` with only one bound, or with a window that contains no entries, answers `checkedCount=0` and `intact: true` (re-probed 2026-11-02: the empty window `2026-11-02 00:00:00` … `00:00:01` also answered `intact: true`) | Compare `?startTime=2026-11-01 00:00:00&endTime=…` with RFC3339; call `POST /audit/verify` with only `startTime`, and with an empty window | Pick one format and answer `400 10101` when it is wrong; complete or reject a single-ended window instead of reporting "0 checked, intact"; never answer `intact: true` for an empty window |
| UP-AUD-05 | Medium | **`verify` writes, and its break point cannot be mapped to an entry**: every `POST /audit/verify` **appends an audit entry** (during the probe `total` went 1823 → 1824 → 1827 and several successful `POST /api/v1/audit/verify` rows appeared), so it is neither idempotent nor read-only; `brokenAtLogId` is a **whole-chain index** (measured `18`), neither a `logCode` nor an offset into the current result set | Call `POST /audit/verify` twice, then compare the newest rows of `GET /audit?pageSize=5` | Make verification read-only or state clearly that it writes an entry; return the `logCode` (or both `logCode` and index) in `brokenAtLogId` |
| UP-AUD-06 | Medium | **A missing export field answers `500 10509`**: `POST /audit/export` without any of `startTime` / `endTime` / `exportName` answers `500 系统内部错误` instead of `400 10101`, so callers cannot tell it apart from an upstream outage | `POST /audit/export` with only `exportName` | Answer `400 10101` and name the missing field |
| UP-AUD-07 | Medium | **Export jobs have no detail and no delete endpoint**: `GET /audit/export/{code}` answers `404` and there is no `DELETE`, so a job can never be reclaimed and its progress can only be read back from the list (`status` is an undocumented bare number, `downloadUrl` stays empty until the artefact exists); a routing flaw on top: `GET /audit/` (empty path segment) falls back to the **list** instead of `404` | `GET /audit/export/EXP…`, `DELETE /audit/export/EXP…`, `GET /audit/` | Add detail (progress / failure reason) and delete; answer `404` for an empty path segment |
| UP-AUD-08 | Low | **Export list timestamps are offset by 8 hours**: for the same `exportCode`, the create response returns local time (`…T03:17:06+08:00`) while the list read-back is 8 hours later (local time converted to local time once more) | Create a job, then immediately compare its `createdAt` in `GET /audit/export` | Use one time zone and format (RFC3339 with offset) and stop shifting again on the read path |
| UP-AUD-09 | Low | **Detail snapshot fields are always empty**: `sourceService` / `beforeSnapshot` / `afterSnapshot` / `detailJson` were empty strings in every sampled row; only `prevHash` carries a value | Fetch `GET /audit/{logCode}` and inspect each field | Either populate the snapshots or drop the four fields from the contract |

Supplementary observations (not defects, but the page must know them):

- **A list row is the first 12 detail fields** (`logCode` / `category` / `accountId` / `deviceCode` / `sessionId` / `traceId` / `action` / `resource` / `result` / `clientIp` / `eventTime` / `logHash`); the detail adds `sourceService` / `beforeSnapshot` / `afterSnapshot` / `detailJson` / `prevHash`.
- **`accountId=0` and empty strings count as "not provided"**, the same family as `category` ignoring unknown values, so the page only sends non-empty parameters.
- **A reversed window returns an empty set** (`start > end` → `total=0` with `200`): upstream does not complain, so the page rejects it locally.
- **`result` was only ever `1` (success) / `2` (failure)**; no sample exists for other values, so the page does not guess.
- **`eventTime` carries an offset** (`2026-11-02T03:15:09+08:00`): the page trims the format and never converts the zone.

## 3. Impact on `/system/log`

| Defect | Page handling |
| :--- | :--- |
| UP-AUD-01 | Both identities fetch normally (requests are no longer gated by identity): the scope is filtered by tenant upstream, and the identity note at the top of the detail pane only states "you see the whole platform / your own tenant"; `401 10201` still maps to "your session expired" with a re-login hint instead of "load failed" |
| UP-AUD-02 | The category filter offers only `session` and `api` as a select (no free text); any other value renders as an unknown category with its raw value |
| UP-AUD-03 | No `result` / `keyword` filter (no control that would not work); the client clamps `pageSize` to `100` and offers 20 / 50 / 100 |
| UP-AUD-04 | Time filters always send `YYYY-MM-DD HH:MM:SS` (no offset, browser local time as typed); a reversed window is rejected locally; `verify` requires both bounds |
| UP-AUD-05 | Verification is an **explicit button** (never fired on page load), the list reloads after it, and the toast states that the check appended an entry itself; the break point is shown as "entry #N" only; the result copy always quotes "N entries checked", and `checkedCount = 0` renders as a neutral notice stating that an empty window proves nothing (UP-AUD-04) |
| UP-AUD-06 | The export form validates the three required fields locally, so the upstream `500 10509` never doubles as a form error |
| UP-AUD-07 | The export dialog only creates, reads back and refreshes manually — no progress bar and no polling (there is no progress field to read), no delete; `status` is shown as a bare number, not guessed into "running / done" |
| UP-AUD-08 | The export `createdAt` is displayed as returned, with no zone conversion (converting would only hide the mismatch) |
| UP-AUD-09 | `sourceService` / snapshots / `detailJson` render only when non-empty; when all are empty there is no hollow "snapshot" block |

Narrowing on the client is **not a security boundary**: the BFF only passes requests through an allow-list and every authorisation decision stays upstream, so the defects must be fixed there.
## 4. Reproduction commands (paste as-is)

```bash
BASE=http://192.168.1.55:8888/api/v1
AT=$(curl -s -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d '{"accountName":"admin","password":"<pwd>"}' | jq -r .data.accessToken)

# UP-AUD-01 tenant admins are usable (scope filtered by tenant); an expired token and a denial share 401 10201
TA=$(curl -s -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d '{"accountName":"tenantadmin","password":"<pwd>"}' | jq -r .data.accessToken)
python3 -c "import base64,json,sys;t=sys.argv[1].split('.')[1];t+='='*(-len(t)%4);print(json.loads(base64.urlsafe_b64decode(t))['accountLevel'])" "$TA"  # 1
curl -s "$BASE/audit?page=1&pageSize=2" -H "authorization: Bearer $TA" | jq '{code, total: .data.total, accountIds: [.data.list[].accountId]}'
curl -s "$BASE/audit?page=1&pageSize=2" -H "authorization: Bearer $AT" | jq '{code, total: .data.total}'
# expired token: 401 10201, indistinguishable from "no permission"
curl -s "$BASE/audit?page=1&pageSize=2" -H "authorization: Bearer $EXPIRED_TA" | jq '.code'

# UP-AUD-02 category is case-sensitive and unknown values are ignored
curl -s "$BASE/audit?page=1&pageSize=3&category=session" -H "authorization: Bearer $AT" | jq .data.total   # 79
curl -s "$BASE/audit?page=1&pageSize=3&category=SESSION" -H "authorization: Bearer $AT" | jq .data.total   # 1823

# UP-AUD-03 no stable pageSize ceiling; unknown parameters dropped
for ps in 0 200 500 1000; do
  curl -s "$BASE/audit?page=1&pageSize=$ps" -H "authorization: Bearer $AT" \
    | jq -c "{pageSize: .data.pageSize, len: (.data.list | length)}"
done
curl -s "$BASE/audit?page=1&pageSize=3&keyword=x" -H "authorization: Bearer $AT" | jq .data.total

# UP-AUD-04 both time formats are equivalent; a malformed value is ignored; single-ended verify checks nothing
curl -s "$BASE/audit?page=1&pageSize=3&startTime=2026-11-01%2000:00:00&endTime=2026-11-02%2000:00:00" \
  -H "authorization: Bearer $AT" | jq .data.total
curl -s -X POST "$BASE/audit/verify" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' -d '{"startTime":"2026-11-01 00:00:00"}' | jq .data

# UP-AUD-05 verify writes an entry and reports a whole-chain index
before=$(curl -s "$BASE/audit?page=1&pageSize=1" -H "authorization: Bearer $AT" | jq .data.total)
curl -s -X POST "$BASE/audit/verify" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{}' | jq .data
after=$(curl -s "$BASE/audit?page=1&pageSize=1" -H "authorization: Bearer $AT" | jq .data.total)
echo "$before -> $after"

# UP-AUD-06 a missing export field answers 500 10509
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/audit/export" \
  -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{"exportName":"probe"}'

# UP-AUD-07 no export detail, no delete; an empty path segment falls back to the list
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/audit/export/EXP0000000000" -H "authorization: Bearer $AT"
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE "$BASE/audit/export/EXP0000000000" -H "authorization: Bearer $AT"
curl -s "$BASE/audit/" -H "authorization: Bearer $AT" | jq 'has("data") and (.data | has("list"))'

# UP-AUD-08 the same exportCode differs by 8 hours between create and list
curl -s -X POST "$BASE/audit/export" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  -d '{"exportName":"probe7","startTime":"2026-11-01 00:00:00","endTime":"2026-11-02 00:00:00"}' | jq .data.createdAt
curl -s "$BASE/audit/export?page=1&pageSize=5" -H "authorization: Bearer $AT" | jq '.data.list[0].createdAt'
```

## 5. Closure status

| Item | Status |
| :--- | :--- |
| UP-AUD-01 | **Corrected** (the first-round finding is retracted: it was an expired-token artefact; it is now "tenant scoping undocumented plus one shared code for expired tokens", an upstream documentation / error-code issue) |
| UP-AUD-02 … UP-AUD-09 | **Open** (waiting on the upstream iam side); `/system/log` already narrows around them per §3 |
| `/system/log` | Implemented against the "smallest trustworthy surface" (list / detail / verify / export) instead of treating the gaps as contract |
| BFF allow-list | `audit` is part of `GATEWAY_RESOURCES`; the passthrough changes no decision |
| Documentation | `NMCPS-DESIGN-005` §9 (cn/en), this page, `doc-map` (cn/en) and `shared/constants/docIds.ts` are updated together |

## 6. Not verified

- The export `status` value domain: only `1` was ever observed, and the populated shape of `downloadUrl` / `objectKey` / `totalRecords` was never captured — the page therefore only shows a download button when `downloadUrl` is non-empty.
- The chain verification algorithm (how `logHash` / `prevHash` chain, whether checking continues after the first break): only "the current chain breaks at index 18" was measured, not the behaviour after a repair.
- `intact: false` is the pre-existing state of the probe environment (its historical chain is already broken); it is not caused by this page or this round, and the page only reports it. The re-probe saw the opposite case too: an empty window answers `intact: true` with `checkedCount: 0` (UP-AUD-04), which is why the page renders that as a neutral "0 checked" notice rather than a green success.
- Mobile / desktop window behaviour: verified in a browser and in the `check:ui` stub environment only, not on a device.

