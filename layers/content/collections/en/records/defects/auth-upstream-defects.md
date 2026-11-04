---
docId: NMCPS-REC-001
title: "Upstream `/api/v1/auth` defect list (probed 2026-10-31)"
navigation:
  title: "Upstream auth defects"
description: "Record-layer defect list: an exhaustive probe of the seven `/auth/*` endpoints on http://192.168.1.55:8888/api/v1 (swagger diff + live calls + BFF end-to-end) registering 6 upstream defects (non-atomic refresh rotation, 500 on missing input, unvalidated Content-Type, OPTIONS 404, undocumented mfaType default, firstReset bypassing the old-password check) and 4 in-repo drifts, each with reproduction, expected behaviour, and the closed/open checklist, plus six ready-to-file upstream tickets carrying the verbatim curl commands and output."
excerpt: "6 upstream defects and 4 in-repo drifts on /auth, with reproduction."
keywords:
  - "defect"
  - "auth"
  - "upstream"
  - "iam"
  - "triage"
tier: 5
authority: informative
scope:
  - rec.defects.auth
status: superseded
supersededBy: NMCPS-ADR-0018
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-003
  - NMCPS-ARCH-003
createdAt: "2026-10-31"
updatedAt: "2026-10-31"
icon: "carbon:warning-alt"
tags:
  - "Defect"
  - "Records"
  - "IAM"
  - "Upstream"
---

# Upstream `/api/v1/auth` defect list (NMCPS-REC-001)

> **Generation note (2026-11-04)**: this list was captured against the **retired** go-zero gateway; that instance is gone and the repository plus the integration environment now target `http://192.168.1.55:8888/api/v1`. The host:port in the reproduction commands below has been rewritten to the current instance, **but the findings describe the old generation only** — re-probe before using them as a coding basis. The list is kept as history and `status` is set to `superseded`.

> **Purpose**: capture this round's findings about the upstream authentication endpoints so the iam side can track them.
> **Not here**: the contract itself is authoritative in `NMCPS-ARCH-003` (`layers/content/collections/cn/architecture/1.architecture/iam-architecture.md`) §7; this page only records what contradicts that contract or deserves fixing, plus its current state.

## 1. Scope and method

- Target: `http://192.168.1.55:8888/api/v1`, prefix `/auth/*`.
- Method: (1) diff the endpoint list against `/swagger/specs/gateway.json`; (2) exhaustively probe each endpoint with valid, missing-field, unauthorised, wrong-credential, repeated and concurrent calls; (3) re-verify through the BFF (`PORT=39881 NUXT_BFF_UPSTREAM_BASE=<upstream>`) to see whether a defect is absorbed there.
- Verdict: **all 7 endpoints work** (`login`, `whoami`, `token/refresh`, `logout`, `password`, `mfa/bind`, `mfa/confirm`); every unregistered path (`/auth/session`, `/auth/captcha`, `/auth/mfa/disable`, `/auth/mfa/verify`, `/auth/validate`) returns `404`, so there is no hidden capability. The BFF passes 10/10 end-to-end cases.

## 2. Upstream defects (6)

The `UP-AUTH-0x` IDs are the stable cross-reference shared with `NMCPS-ARCH-003` §7.8; upstream ticket numbers are never written into this table — they live in §7 so the two numbering schemes cannot clash.

| ID | Severity | Symptom | Reproduction | Expected |
| :--- | :--- | :--- | :--- | :--- |
| UP-AUTH-01 | High | **Non-atomic refresh rotation**: the same RT fired three times concurrently returns `200` three times with three different `sessionId`s; all three ATs pass `whoami`; logging one out leaves the rest alive | Fire 3 parallel `POST /auth/token/refresh` with one `refreshToken`, then `GET /auth/whoami` per token | Single use: only the first succeeds, the rest answer `20205`. Today this is an RT replay window |
| UP-AUTH-02 | High | **`firstReset: true` bypasses the old-password check**: a body carrying only `newPassword` changes the password (`200`) | With any valid AT call `POST /auth/password {"newPassword":"…","firstReset":true}` | `firstReset` should only affect the forced-reset decision, never waive `oldPassword`; today a hijacked session can take over the account |
| UP-AUTH-03 | Medium | **Missing input always answers `500 10509`**: `login {}`, `login` without `password`, `refresh {}`, `password {}`, missing `newPassword`, `mfa/confirm {}` | Send each empty/partial body | `400 10101` with field-level detail (a client mistake is not a crash) |
| UP-AUTH-04 | Medium | **`Content-Type` is not validated**: a `application/x-www-form-urlencoded` login answers `500 10509`, yet `logout` succeeds with no body at all | Submit the login as form-encoded | `415`, or explicitly accept both encodings |
| UP-AUTH-05 | Low | **`OPTIONS /api/v1/auth` returns `404`** (compare `/api/v1/account` → `405 + Allow`) | `curl -X OPTIONS .../api/v1/auth` | A uniform preflight response for capability discovery and CORS |
| UP-AUTH-06 | Low | **`mfaType` defaults to TOTP and the undocumented `0` is accepted**: `{}` / `{mfaType:0}` / `{mfaType:1}` behave the same (all return `otpauthUrl`); `9` / `99` answer `400 20109` | `POST /auth/mfa/bind` with each of the five bodies | Validate explicitly and document the default; `0` should be rejected |

Additional observations (not defects, but worth knowing):

- **A disabled account shares the credential error code**: after `status: 2`, login answers `401 20201`, so the client cannot say "account suspended".
- **A password change does not revoke tokens**: the old AT still answers `200`, so a leaked token cannot be stopped by changing the password.
- **The MFA login branch is `401 20203`**, not "200 + `mfaRequired: true`"; upstream never returns `mfaRequired`.
- **Password policy**: weak secrets answer `400 20101` (`123456` / `abc` / `12345678` all rejected) and a recent duplicate answers `400 20302`.
- **Forced reset is a client-side convention**: an account with `mustResetPassword: true` still gets `200` from `whoami` before changing anything; upstream does not block the API — the client has to act, which `/auth/change-password` now does (see REPO-04).
- **A password change takes effect immediately**: four re-probes at `0 / 200 / 1000 / 3000 ms` all answered `401 20201` for the old password, so there is no grace window.

## 3. In-repo drift (4, closed by this round)

| ID | Symptom | Resolution |
| :--- | :--- | :--- |
| REPO-01 | The fake upstream answered `400 20205 mfa_required` where the real one answers `401 20203`, so the self-check stayed falsely green | `scripts/lib/bff-harness.mjs` now answers `401 / 20203`; the `check:bff` cases follow |
| REPO-02 | The login page only knew `20205`, so an MFA account never saw the OTP field | `app/pages/auth/login.vue` now keys on `20203` (both `submit` and `describeError`) |
| REPO-03 | The fake upstream consumed refresh tokens strictly once, while the real one allows concurrent use | The fake upstream now allows reuse inside a concurrency window and still rejects a serial replay; a new case locks that semantics |
| REPO-04 | **The forced-reset branch was dead code**: the login page stored `mustResetPassword` in a ref and then called `navigateTo(redirect)` immediately, so the warning `v-if` never rendered — and upstream does not block the API, leaving the initial password usable indefinitely | Closed in two steps: first the dead code, then the gap itself — a dedicated `/auth/change-password` page (one screen, three fields, forced re-login afterwards, submitted **without** `firstReset`), with the login page only forwarding `redirect`; the fake upstream gained a `reset-user` account; `check:ui` locks ten cases (landing, complete form, three inline validation states, a wrong old password naming `20201`, forced re-login, request body carries the old password and no `firstReset`, no request emitted by the validation states, toast after re-login) plus one guard case (an anonymous visit bounces back to the login page with the redirect target), and `check:bff` locks the flag pass-through; the page was later renamed from `/auth/reset-password` to `/auth/change-password` per `NMCPS-ADR-0014` (`reset` is reserved for a forgot-password flow) |

## 4. Closed and open verification items

Closed (probe accounts `AUTOTEST-*`, disabled with `status: 2` afterwards):

- Successful password change, old password rejected, old AT still valid;
- `mfa/bind` plus a real TOTP → successful `mfa/confirm`, `whoami.mfaEnabled` flips to true;
- An MFA account logs in with a correct `mfaCode`, gets `20203` without one and `20204` with a wrong one;
- Login after disabling answers `20201`;
- Creating with `mustResetPassword: true` → the flag comes back on login → a `firstReset` change clears it;
- Both password-policy rules (complexity and history).

Self-check guards (fake upstream, so they do not depend on the real one being reproducible): `check:bff` (81 assertions) covers the `20203` / `20204` pass-through pair and the `mustResetPassword` flag; `check:ui` (68 assertions self-built, 51 external) covers the MFA retry sign-in and the whole forced-reset flow (landing on `/auth/change-password` → complete form → the hidden `autocomplete="username"` bound to the current account → three inline validation states → a wrong old password naming `20201` → forced re-login → request body carrying the old password and no `firstReset` → toast after re-login → the new password signing in without a bounce → the old password rejected with `401 20201`), plus the "anonymous visit to the change page bounces to the login page with the redirect target" guard. The fake upstream keeps a mutable password per account (a change is persisted, `whoami` answers for the token's account, the flag is cleared), which is what makes the last three assertions possible.

Still open: natural expiry (30-minute AT / 7-day RT) and concurrent refresh across multiple browser tabs.

## 5. Re-running the probe

1. Start the BFF: `PORT=39881 NUXT_BFF_UPSTREAM_BASE=http://192.168.1.55:8888/api/v1 node .output/server/index.mjs`.
2. Hit the upstream directly for UP-AUTH-01 (concurrent refresh) and UP-AUTH-03/04 (missing input, Content-Type) — those are only visible upstream, the BFF absorbs them.
3. Re-verify end-to-end through the BFF: `pnpm check:bff` against the fake upstream (81 assertions) and `pnpm check:ui` against its own fake upstream and the built artefact (68 assertions), then one manual login against the real upstream.
4. Remember `--noproxy '*'` for local curl (the environment exports `http_proxy`).

## 6. Ticket text (ready to file)

The six blocks below are self-contained: title, environment, reproduction, observed output, expectation, impact, acceptance. Every command and output was recorded verbatim against `http://192.168.1.55:8888/api/v1` on 2026-10-31. Shared prefix:

```bash
UP=http://192.168.1.55:8888/api/v1
AT=$(curl -s --noproxy '*' -X POST "$UP/auth/login" -H 'content-type: application/json' \
  -d '{"accountName":"admin","password":"Admin@123456"}' | jq -r '.data.accessToken')
```

### Ticket 1 · [High] Refresh rotation is not atomic: one RT works three times concurrently

**Reproduction**

```bash
RT=$(curl -s --noproxy '*' -X POST "$UP/auth/login" -H 'content-type: application/json' \
  -d '{"accountName":"admin","password":"Admin@123456"}' | jq -r '.data.refreshToken')
for i in 1 2 3; do
  curl -s --noproxy '*' -X POST "$UP/auth/token/refresh" -H 'content-type: application/json' \
    -d "{\"refreshToken\":\"$RT\"}" -o /tmp/r$i.json &
done; wait
jq -r '[.code, (.data.sessionId // "-")] | @tsv' /tmp/r1.json /tmp/r2.json /tmp/r3.json
```

**Observed**: all three answer `200 / code:0`, each with a distinct `sessionId` (`cc094934…` / `ab8f003a…` / `512f0f93…`); all three access tokens get `200` from `GET /auth/whoami`; logging out the first leaves the second working.

**Expected**: single consumption — the first caller gets `200`, the rest `401 20205`, and the rotated-out session dies.

**Impact**: a leaked RT opens a concurrent replay window and yields several long-lived sessions, including ones that survive a logout.

**Acceptance**: N concurrent refreshes of one RT yield exactly one success; `sessionId` is globally unique; a logout invalidates every sibling session.

### Ticket 2 · [High] `firstReset: true` skips the old-password check, so a session alone can change the password

**Reproduction** (`$AT` must belong to a **probe account**; reusing admin's token really does change admin's password)

```bash
# Get an AT for a probe account first (do not reuse the admin token above)
AT=$(curl -s --noproxy '*' -X POST "$UP/auth/login" -H 'content-type: application/json' \
  -d '{"accountName":"AUTOTEST-TICKET","password":"Ticket@123456"}' | jq -r '.data.accessToken')
curl -s --noproxy '*' -X POST "$UP/auth/password" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' \
  -d '{"newPassword":"Ticket@654321","firstReset":true}'
```

**Observed**: `200 {"code":0,"msg":"ok"}` with no `oldPassword` in the body; afterwards the old password answers `401 20201` and the new one `200`.

**Expected**: `firstReset` only decides whether the forced-reset gate applies; it must never waive `oldPassword`. A request without it should be `400` and change nothing.

**Impact**: anyone holding an AT (XSS, log leak, shared terminal) takes the account over and locks the owner out.

**Acceptance**: every `password` request without `oldPassword` answers `400`; `firstReset` waives the gate only (or the flow moves to a server-side one-shot reset token).

### Ticket 3 · [Medium] Missing input always answers `500 10509`, reporting client errors as crashes

**Reproduction**

```bash
UP=http://192.168.1.55:8888/api/v1
curl -s --noproxy '*' -X POST "$UP/auth/login" -H 'content-type: application/json' -d '{}'
curl -s --noproxy '*' -X POST "$UP/auth/login" -H 'content-type: application/json' -d '{"accountName":"admin"}'
curl -s --noproxy '*' -X POST "$UP/auth/token/refresh" -H 'content-type: application/json' -d '{}'
curl -s --noproxy '*' -X POST "$UP/auth/password" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{}'
curl -s --noproxy '*' -X POST "$UP/auth/mfa/confirm" -H "authorization: Bearer $AT" -H 'content-type: application/json' -d '{}'
```

**Observed**: all five answer `500 {"code":10509,"msg":"系统内部错误","traceId":"…"}`.

**Expected**: `400` with a business code and field-level detail (for example `10101 invalid parameter`, plus `field`).

**Impact**: clients cannot tell "I sent it wrong" from "the service is down"; monitoring drowns in invalid 5xx; the BFF can only collapse it into `bff_upstream_error`.

**Acceptance**: the five requests above answer `400` naming the missing field, and the path emits no 5xx log line.

### Ticket 4 · [Medium] `Content-Type` is not validated: form encoding gives 500, while a body-less `logout` gives 200

**Reproduction**

```bash
curl -s --noproxy '*' -X POST "$UP/auth/login" \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'accountName=admin&password=Admin@123456'
curl -s --noproxy '*' -X POST "$UP/auth/logout" -H "authorization: Bearer $AT" \
  -H 'content-type: application/x-www-form-urlencoded'
```

**Observed**: login `500 10509`; body-less `logout` `200 {"code":0,"data":{"ok":true}}`.

**Expected**: the two endpoints behave alike — either `415 Unsupported Media Type` (JSON only) or explicit support for both encodings; not 500 on one and 200 on the other.

**Impact**: form-based clients (and any gateway or proxy that rewrites bodies) get 500 instead of a readable error, and `logout`'s leniency makes the media-type rule self-contradictory.

**Acceptance**: non-JSON encodings answer the same status (`415` or `400`) on every `/auth/*` write endpoint, `logout` included.

### Ticket 5 · [Low] `OPTIONS /api/v1/auth` answers `404` while `/api/v1/account` answers `405 + Allow`

**Reproduction**

```bash
curl -s -i --noproxy '*' -X OPTIONS "$UP/auth" | head -3
curl -s -i --noproxy '*' -X OPTIONS "$UP/account" | head -3
```

**Observed**: `/auth` → `404` carrying the gateway's `404 page not found`; `/account` → `405` with `Allow: POST, GET`.

**Expected**: comparable resources answer preflight alike (`204/405 + Allow`), or the gateway handles CORS preflight uniformly.

**Impact**: browser preflight fails, and capability discovery or automated probing gets no `Allow` header.

**Acceptance**: `OPTIONS /api/v1/auth` no longer `404`s, and `Allow` semantics match between `/auth/*` and `/account`.

### Ticket 6 · [Low] The `mfaType` default is undocumented; `0` and `1` behave alike and both return a TOTP `otpauthUrl`

**Reproduction**

```bash
for B in '{}' '{"mfaType":0}' '{"mfaType":1}' '{"mfaType":9}' '{"mfaType":99}'; do
  echo "== $B"
  curl -s --noproxy '*' -X POST "$UP/auth/mfa/bind" -H "authorization: Bearer $AT" \
    -H 'content-type: application/json' -d "$B"
done
```

**Observed**: `{}`, `{mfaType:0}` and `{mfaType:1}` all answer `200` with an `otpauthUrl`; `{mfaType:9}` and `{mfaType:99}` answer `400 {"code":20109,"msg":"该 MFA 因子类型暂未实现"}`.

**Expected**: document the enum (including what the default resolves to); reject unimplemented types (including `0` if it truly is unimplemented); do not return `otpauthUrl` for non-TOTP types.

**Impact**: clients cannot tell which factor is default, and whether `0` means "TOTP" or "not implemented" is only discoverable by trying.

**Acceptance**: `/docs` lists the `mfaType` enum and its default; the meaning and response shape of `0` and `1` agree (`otpauthUrl` only for TOTP).

> Filing suggestion: one EPIC with six children. Tickets 1 and 2 are high priority (security), 3 and 4 are robustness, 5 and 6 are consistency.

## 7. Upstream ticket registry (one EPIC + 6 children)

Only this table changes after filing: `UP-AUTH-0x` is the stable in-repo ID (referenced by §2 and by `NMCPS-ARCH-003` §7.8) and the upstream ticket number is an external ID — never swap one for the other. The EPIC title is "[EPIC] `/api/v1/auth` contract and security defects (6, probed 2026-10-31)"; each child copies the first heading of its §6 ticket.

| Upstream ticket | Type | Defect | Title (§6) | Status | Filed on |
| :--- | :--- | :--- | :--- | :--- | :--- |
| — | EPIC | UP-AUTH-01…06 | `/api/v1/auth` contract and security defects (6) | To file | — |
| — | Child | UP-AUTH-01 | Non-atomic refresh rotation: one RT usable three times concurrently | To file | — |
| — | Child | UP-AUTH-02 | `firstReset: true` bypasses the old-password check, a session alone can change the password | To file | — |
| — | Child | UP-AUTH-03 | Missing input always answers `500 10509`, reporting a client mistake as a crash | To file | — |
| — | Child | UP-AUTH-04 | `Content-Type` is not validated: form encoding answers 500, a body-less `logout` answers 200 | To file | — |
| — | Child | UP-AUTH-05 | `OPTIONS /api/v1/auth` returns `404`, unlike `/api/v1/account` with `405 + Allow` | To file | — |
| — | Child | UP-AUTH-06 | The `mfaType` default is undocumented; `0` and `1` behave alike and both return a TOTP `otpauthUrl` | To file | — |

Status vocabulary: `To file` → `Filed` (fill the ticket number and date) → `Fixed` (after re-running §5) → `Verified` (`pnpm check:bff` / `check:ui` green and the §2 row can go). Whenever a row reaches `Fixed`, update §2, `NMCPS-ARCH-003` §7.8 and this table together.
