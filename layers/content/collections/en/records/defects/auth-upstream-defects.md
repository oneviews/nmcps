---
docId: NMCPS-REC-001
title: "Upstream `/api/v1/auth` defect list (probed 2026-10-31)"
navigation:
  title: "Upstream auth defects"
description: "Record-layer defect list: an exhaustive probe of the seven `/auth/*` endpoints on http://192.168.1.55:10000/api/v1 (swagger diff + live calls + BFF end-to-end) registering 6 upstream defects (non-atomic refresh rotation, 500 on missing input, unvalidated Content-Type, OPTIONS 404, undocumented mfaType default, firstReset bypassing the old-password check) and 3 in-repo drifts, each with reproduction, expected behaviour, and the closed/open checklist."
excerpt: "6 upstream defects and 3 in-repo drifts on /auth, with reproduction."
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
status: baseline
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

> **Purpose**: capture this round's findings about the upstream authentication endpoints so the iam side can track them.
> **Not here**: the contract itself is authoritative in `NMCPS-ARCH-003` (`layers/content/collections/cn/architecture/1.architecture/iam-architecture.md`) §7; this page only records what contradicts that contract or deserves fixing, plus its current state.

## 1. Scope and method

- Target: `http://192.168.1.55:10000/api/v1`, prefix `/auth/*`.
- Method: (1) diff the endpoint list against `/swagger/specs/gateway.json`; (2) exhaustively probe each endpoint with valid, missing-field, unauthorised, wrong-credential, repeated and concurrent calls; (3) re-verify through the BFF (`PORT=39881 NUXT_BFF_UPSTREAM_BASE=<upstream>`) to see whether a defect is absorbed there.
- Verdict: **all 7 endpoints work** (`login`, `whoami`, `token/refresh`, `logout`, `password`, `mfa/bind`, `mfa/confirm`); every unregistered path (`/auth/session`, `/auth/captcha`, `/auth/mfa/disable`, `/auth/mfa/verify`, `/auth/validate`) returns `404`, so there is no hidden capability. The BFF passes 10/10 end-to-end cases.

## 2. Upstream defects (6)

| ID | Severity | Symptom | Reproduction | Expected |
| :--- | :--- | :--- | :--- | :--- |
| UP-AUTH-01 | High | **Non-atomic refresh rotation**: the same RT fired three times concurrently returns `200` three times with three different `sessionId`s; all three ATs pass `whoami`; logging one out leaves the rest alive | Fire 3 parallel `POST /auth/token/refresh` with one `refreshToken`, then `GET /auth/whoami` per token | Single use: only the first succeeds, the rest answer `20205`. Today this is an RT replay window |
| UP-AUTH-02 | High | **`firstReset: true` bypasses the old-password check**: a body carrying only `newPassword` changes the password (`200`) | With any valid AT call `POST /auth/password {"newPassword":"…","firstReset":true}` | `firstReset` should only affect the forced-reset decision, never waive `oldPassword`; today a hijacked session can take over the account |
| UP-AUTH-03 | Medium | **Missing input always answers `500 10509`**: `login {}`, `login` without `password`, `refresh {}`, `password {}`, missing `newPassword`, `mfa/confirm {}` | Send each empty/partial body | `400 10101` with field-level detail (a client mistake is not a crash) |
| UP-AUTH-04 | Medium | **`Content-Type` is not validated**: a `application/x-www-form-urlencoded` login answers `500 10509`, yet `logout` succeeds with no body at all | Submit the login as form-encoded | `415`, or explicitly accept both encodings |
| UP-AUTH-05 | Low | **`OPTIONS /api/v1/auth` returns `404`** (compare `/api/v1/account` → `405 + Allow`) | `curl -X OPTIONS .../api/v1/auth` | A uniform preflight response for capability discovery and CORS |
| UP-AUTH-06 | Low | **`mfaType` defaults to TOTP and `0` is undocumented**: `{}` / `{mfaType:0}` / `{mfaType:1}` behave the same; only `99` answers `400 20109` | `POST /auth/mfa/bind` with each body | Validate explicitly and document the default; `0` should be rejected |

Additional observations (not defects, but worth knowing):

- **A disabled account shares the credential error code**: after `status: 2`, login answers `401 20201`, so the client cannot say "account suspended".
- **A password change does not revoke tokens**: the old AT still answers `200`, so a leaked token cannot be stopped by changing the password.
- **The MFA login branch is `401 20203`**, not "200 + `mfaRequired: true`"; upstream never returns `mfaRequired`.
- **Password policy**: weak secrets answer `400 20101` (`123456` / `abc` / `12345678` all rejected) and a recent duplicate answers `400 20302`.
- **Forced reset is a client-side convention**: an account with `mustResetPassword: true` still gets `200` from `whoami` before changing anything; upstream does not block the API.
- **A password change takes effect immediately**: four re-probes at `0 / 200 / 1000 / 3000 ms` all answered `401 20201` for the old password, so there is no grace window.

## 3. In-repo drift (3, closed by this round)

| ID | Symptom | Resolution |
| :--- | :--- | :--- |
| REPO-01 | The fake upstream answered `400 20205 mfa_required` where the real one answers `401 20203`, so the self-check stayed falsely green | `scripts/lib/bff-harness.mjs` now answers `401 / 20203`; the `check:bff` cases follow |
| REPO-02 | The login page only knew `20205`, so an MFA account never saw the OTP field | `app/pages/auth/login.vue` now keys on `20203` (both `submit` and `describeError`) |
| REPO-03 | The fake upstream consumed refresh tokens strictly once, while the real one allows concurrent use | The fake upstream now allows reuse inside a concurrency window and still rejects a serial replay; a new case locks that semantics |

## 4. Closed and open verification items

Closed (probe accounts `AUTOTEST-*`, disabled with `status: 2` afterwards):

- Successful password change, old password rejected, old AT still valid;
- `mfa/bind` plus a real TOTP → successful `mfa/confirm`, `whoami.mfaEnabled` flips to true;
- An MFA account logs in with a correct `mfaCode`, gets `20203` without one and `20204` with a wrong one;
- Login after disabling answers `20201`;
- Creating with `mustResetPassword: true` → the flag comes back on login → a `firstReset` change clears it;
- Both password-policy rules (complexity and history).

Still open: natural expiry (30-minute AT / 7-day RT) and concurrent refresh across multiple browser tabs.

## 5. Re-running the probe

1. Start the BFF: `PORT=39881 NUXT_BFF_UPSTREAM_BASE=http://192.168.1.55:10000/api/v1 node .output/server/index.mjs`.
2. Hit the upstream directly for UP-AUTH-01 (concurrent refresh) and UP-AUTH-03/04 (missing input, Content-Type) — those are only visible upstream, the BFF absorbs them.
3. Re-verify end-to-end through the BFF: `pnpm check:bff` against the fake upstream, plus a manual login against the real one.
4. Remember `--noproxy '*'` for local curl (the environment exports `http_proxy`).
