---
docId: NMCPS-ARCH-003
title: "IAM Architecture"
description: "Tier 1 architecture baseline for identity and access management (arch.iam): the AAA framework (AuthN/AuthZ/Audit), the five-layer IAM architecture, flexible RBAC + ABAC, multi-tenant isolation, compliant auditing, and the `/api/v1/auth` integration contract (login / refresh / logout / whoami / MFA / password). This is the single authority for the arch.iam domain."
excerpt: "AAA framework, five-layer IAM, RBAC+ABAC, multi-tenant isolation, `/api/v1/auth` contract."
keywords:
  - "iam"
  - "architecture"
  - "access-control"
  - "auth"
tier: 1
authority: normative
scope:
  - arch.iam
status: baseline
version: 0.3.9
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-10-25"
updatedAt: "2026-10-31"
icon: "carbon:user-certification"
tags:
  - "Architecture"
  - "IAM"
  - "Access Control"
---

# IAM Architecture (NMCPS-ARCH-003)

> **Responsibility**: single authority for `arch.iam` — ensure the right entity accesses the right resource in the right way within the right context. Governance rules: `NMCPS-GOV-001`; authority index: `NMCPS-GOV-003`.
> **Audience**: architecture and implementation engineers / AI assistants.

---

## 1. Positioning

IAM (Identity and Access Management) is the security cornerstone; its mission is "four rights": in the right context, let the right Subject access the right Resource in the right Action.

---

## 2. AAA Framework

```text
Subject ──► AuthN ──► AuthZ ──► Resource
                   │
                   ▼
                Audit
```

| Stage | Meaning | Typical means |
| :--- | :--- | :--- |
| Subject | Who made the request | User, service account, API key, external system |
| AuthN | Prove "you are you" | Password, MFA, OIDC, SSO token |
| AuthZ | Decide "what you can do" | RBAC roles / ABAC attribute policies |
| Audit | Record "who did what, when" | Audit log, SIEM ingestion |

---

## 3. Five-Layer IAM Architecture

| Layer | Composition |
| :--- | :--- |
| Ingress | OIDC / OAuth 2.0 / SAML gateway, SSO entry |
| Identity management | User/org tree (LDAP), service accounts (ServiceAccount / API Key) |
| Policy decision | PDP (decision) + PEP (enforcement/interception) |
| Storage | Policy store (RBAC roles + ABAC policy docs), role/group mappings |
| Audit | Audit logs (CloudTrail / SIEM), anomaly analysis |

---

## 4. Flexible RBAC + ABAC

| Model | Logic | Fit |
| :--- | :--- | :--- |
| RBAC | User → Role → Permission | Small/medium systems, simple |
| ABAC | Attribute policy: `IF (Subject.attr == Resource.attr AND condition) THEN Allow` | Complex context (IP, time window) |

The system combines both: user-role mapping uses standard RBAC (`sys_role` + `sys_user_role_relation`), while concrete permission logic is decoupled into the `sys_policy` table storing ABAC policy documents as JSONB (Effect / Action / Resource / Condition), satisfying context controls like "specific IP only" or "time-window only" and avoiding role explosion.

---

## 5. Multi-Tenant Isolation

All business core tables are bound to `tenant_id` for multi-tenant isolation; ID fields are uniformly `VARCHAR(64)` (snake_case) to fit Snowflake 64-bit integers and avoid JavaScript precision loss.

---

## 6. Security Audit

`sys_audit_log` is append-only, capturing the full AAA trail: Subject, Action, Resource, Result (allow/deny), Context (IP, UA, time window), providing raw evidence for SIEM / UEBA (aligned with ISO/IEC 27001 and GB/T security requirements).

---

## 7. `/api/v1/auth` Integration Contract (v2)

The new backend converges authentication onto `/api/v1/auth/*`: a login issues both an **access token** and a **refresh token**, and `whoami` is the single source of identity truth. The implementation ruling is `NMCPS-ADR-0011` (`layers/content/collections/cn/records/adr/adr-0011.md`); shared types live in `NMCPS-CONTRACT-001`.

### 7.1 Upstream endpoints

| Upstream endpoint | Method | Input | Success `data` | Error codes |
| :--- | :--- | :--- | :--- | :--- |
| `/api/v1/auth/login` | POST | `accountName`, `password` required; `tenantCode`, `mfaCode` optional | `accessToken`, `refreshToken`, `expiresIn`, `sessionId`, `accountCode`, `tenantId`, `accountLevel`, `mfaRequired`, `mustResetPassword` | `20201` wrong account or password (also a disabled account); `20203` MFA code required; `20204` wrong MFA code |
| `/api/v1/auth/token/refresh` | POST | `refreshToken` | `accessToken`, `refreshToken`, `expiresIn`, `sessionId` | `10201` unauthenticated; `20205` session expired |
| `/api/v1/auth/logout` | POST | Empty body (`application/x-www-form-urlencoded`) + Bearer | `ok` | `10201` unauthenticated (**not idempotent**) |
| `/api/v1/auth/whoami` | GET | Bearer | `accountCode`, `accountName`, `displayName`, `tenantId`, `accountLevel`, `mfaEnabled`, `sessionId` | `10201` unauthenticated |
| `/api/v1/auth/mfa/bind` | POST | `mfaType` (1 = TOTP, the default; 2 = biometric, reserved; `0` is undocumented yet accepted, see 7.2 item 8) | `otpauthUrl` (single use) | `10201`; `20109` unimplemented factor type |
| `/api/v1/auth/mfa/confirm` | POST | `mfaCode` | `ok` | `20204` wrong MFA code |
| `/api/v1/auth/password` | POST | `newPassword` required; `oldPassword`, `firstReset` optional | `ok` | `20201` wrong old password |

`accountLevel` is `0` (super admin, `tenantId` always 0) or `1` (tenant admin, `tenantId` ≥ 1), consistent with the multi-tenant isolation in §5.

### 7.2 Token and session semantics (observed)

1. The access token lives 1800 seconds; the refresh token lives 7 days (`exp - iat = 604800`). Upstream **does not** return a refresh TTL, so the BFF needs a configured fallback.
2. **Refresh rotates**: after `token/refresh` the `sessionId` changes and the **old access token is immediately dead** (old AT → `whoami` = `401`). Only lazy refresh after a 401 is allowed, and it must be single-flight; refreshing ahead of `expiresIn` is forbidden.
3. **Multiple sessions coexist**: a second login for the same account does not evict the first (the first AT still returned 200).
4. **Logout is not idempotent**: a second logout with the same token returns `401 10201`; the BFF absorbs it and always reports success.
5. **Errors use `msg`**: the failure body is `{code,msg,traceId}` where `code` is a business code (> 999) rather than the HTTP status; the `ApiResponse` normalisation from `NMCPS-ADR-0007` must map `msg` to `message` and keep `code` as-is when it is > 599.
6. **Missing input always yields `500 10509`** (probed 2026-10-31 with `login {}`, `login` without `password`, `refresh {}`, `password {}`, `password` without `newPassword`, `mfa/confirm {}`): upstream does not tell "client sent garbage" apart from "the service crashed". The zod pre-validation in the BFF is therefore a hard requirement, not fussiness (see 7.3).
7. **Concurrent refreshes are not serialised**: three parallel `token/refresh` calls with the same RT all returned 200, each with a **different** `sessionId`, and all three access tokens passed `whoami`; logging one of them out left the others alive. Only a serial replay returns `401 20205`. Rotation is read-then-write, not an atomic consume — the consequence is session fragmentation plus a refresh-token replay window. The client must still go single-flight: that is an engineering choice that avoids orphan sessions, **not** a contract that concurrency is guaranteed.
8. **`mfaType` defaults to TOTP**: `{}`, `{mfaType:0}` and `{mfaType:1}` are equivalent, and only `99` answers `400 20109`. Binding is two-phase: before `confirm` the `mfaEnabled` flag stays false and login asks for no OTP.
9. **`Content-Type` is not validated**: a `application/x-www-form-urlencoded` login answers `500 10509`, while `logout` succeeds with no body at all. The BFF accepts JSON only and answers `400 bff_invalid_body` when parsing fails.
10. **The MFA login branch is `401 20203`**, not "200 + `mfaRequired: true`": an MFA-enabled account without `mfaCode` gets `401 20203` (empty `data`), a wrong code gets `401 20204`, and a correct TOTP gets 200. Upstream never returns `mfaRequired`, so `login.post.ts` reports it as false unconditionally. The client opens the OTP field on `20203` (the gap was fixed on 2026-10-31, see row 7 in 7.8).
11. **A disabled account shares the credential error code**: after `PUT /account/{code}/status` sets `status: 2`, login answers `401 20201` with no hint that the account is suspended.
12. **Changing the password does not revoke tokens**: after a successful `password` call the old access token still answered `whoami` with 200 — which confirms the 7.5 rule of "notify only, never sign out", and means a leaked token cannot be stopped by a password change.
13. **`firstReset: true` skips the old-password check** (probed 2026-10-31): a body carrying only `newPassword` returns `200`, so `oldPassword` may be omitted. The flag is meant to mark a forced first-login reset and must not become a way to bypass the old password — a hijacked session could otherwise take the account over. The BFF `authPasswordSchema` still requires `oldPassword`; do not relax it just because this field exists.
14. **Forced reset is a client-side convention**: an account with `mustResetPassword: true` still gets 200 from `whoami` before changing anything, and every other endpoint keeps working; changing the password clears the flag (the next login reports `mustResetPassword: false`). Precisely because upstream does not enforce it, the client must: when `POST /api/auth/login` returns the flag, the login page sends the user to the dedicated `/auth/reset-password` page (carrying the original `redirect`), and a successful change **signs out and signs in again with the new password** instead of following `redirect` to the dashboard — otherwise the initial password stays usable forever (fixed 2026-10-31, see 7.8 row 9). That page deliberately submits **without** `firstReset`, which skips the old-password check (item 13 / `NMCPS-REC-001` UP-AUTH-02); the user just signed in with the old password, so asking once more costs nothing. The weak/reused password policy lives upstream: insufficient complexity answers `400 20101`, a recent duplicate answers `400 20302`, and the change takes effect immediately (old password answered `401 20201` at 0/200/1000/3000 ms), so there is no grace window.

### 7.3 BFF surface

| BFF route | Upstream | `data` returned |
| :--- | :--- | :--- |
| `POST /api/auth/login` | `login` | `{ user, expiresIn, mfaRequired, mustResetPassword, tokens? }` — the web gets no `tokens` (both `nmcps_at` / `nmcps_rt` cookies are rewritten instead), the desktop (`x-nmcps-client: desktop`) gets `tokens` |
| `POST /api/auth/refresh` | `token/refresh` | `{ expiresIn, tokens? }` plus a rotated cookie pair |
| `POST /api/auth/logout` | `logout` | `{ ok: true }`, cookies cleared regardless of the upstream result |
| `GET /api/auth/session` | `whoami` | `{ authenticated, user }`; an upstream 401 becomes HTTP 200 with `authenticated: false` |
| `POST /api/auth/mfa/bind` · `mfa/confirm` · `password` | same-name endpoints | passthrough of `{ otpauthUrl }` / `{ ok }` |

- Credential injection: the web turns `nmcps_at` into `Authorization: Bearer`; the desktop injects the token from `tauri-plugin-store` via `useApi`; both collapse into one upstream header in `server/utils/bff/proxy.ts` (explicit `Authorization` wins over the cookie).
- Ownership: `/api/auth/*` are BFF routes and are **not** in `GATEWAY_RESOURCES`, so they never collide with the generic `server/api/[...slug].ts` proxy.
- CSRF: cookie-mode unsafe verbs validate `Origin` — same origin (`Origin` host equals the request `Host`) or a `bff.allowedOrigins` entry passes, otherwise `403 bff_csrf_rejected`; `login` carries no cookie to abuse and skips the check.
- Input validation: `login` / `refresh` / `mfa/*` / `password` are validated with zod first and answer `400 bff_invalid_body` when required fields are missing (upstream answers `500 10509` for missing input, which is not propagated); a non-JSON body (e.g. `form-urlencoded`) also answers `400 bff_invalid_body`, because upstream does not validate `Content-Type` (see 7.2 item 9).

### 7.4 Client conventions

- Composables: `useAuth()` (sign in / sign out / session restore / password change / MFA binding and confirmation) plus `useAuthTokens()` (desktop token persistence); every BFF call goes through `useApi()`.
- On a 401 with a refresh token, `useApi` refreshes single-flight once and replays the original request; a failed refresh clears the session. `login` opts out of injection and retry with `auth: false`, and `refresh` is called by `useAuth` through `$fetch` (never via `useApi`) so refreshing cannot recurse.
- The sign-in page lives at `/auth/login` (`hide`, not in the sidebar); everything except the landing page and `/auth/**` is forced through the global guard (see 7.6), so pages do not declare middleware one by one. The auth action is named `login` in both source and route (never `sign-in`); see `NMCPS-ADR-0013`.
- The forced-reset page lives at `/auth/reset-password` (`hide` + `layout: false`, same shell as the sign-in page): one screen with current password / new password / confirm, then a toast and a forced re-login. It sits under the `/auth/**` whitelist, so the global guard does not check it; the page therefore falls back to `fetchSession(true)` in `onMounted` and returns to the sign-in page with a `redirect` when the session is gone.

### 7.5 Self-service security page

`/user/security` (sidebar "User center → Security", `sort: 4`) hosts the two self-service flows, both through the BFF:

| Section | BFF calls | Behaviour |
| :--- | :--- | :--- |
| Multi-factor auth | `POST /api/auth/mfa/bind` → `POST /api/auth/mfa/confirm` | Renders the one-shot `otpauthUrl` plus its `secret` for copy; after a successful 6-digit confirmation it forces `fetchSession(true)` so `mfaEnabled` updates immediately |
| Password change | `POST /api/auth/password` | Old + new + confirm password; on success it only reports, never signs out (upstream never promised that changing the password revokes tokens — see `password.post.ts`) |

- **One-shot secrets stay in memory**: the `otpauthUrl` lives only in page state and is gone on reload; re-binding resets the TOTP secret, so it asks for confirmation first.
- **No QR dependency**: the dependency list has no QR library, so the page offers "copy URI / copy secret / enter manually" instead of adding a dependency for an optional interaction.
- **Sign-in is owned by the global guard**: the page declares no middleware of its own; an anonymous visit is settled by `/api/auth/session` and redirected to the sign-in page (see 7.6). The inline guide state stays as a fallback only — when the session dies while the page is open, or when a desktop token has been cleared, the page explains the situation instead of rendering blank.
- Error codes reuse the sign-in mapping: `20201` wrong old password, `20204` wrong OTP, `10201` expired session (ask to sign in again).
- Keep the two password paths apart: this page is the **ordinary self-service change** (report only, never sign out); an account flagged `mustResetPassword` goes through `/auth/reset-password` (forced re-login afterwards, see 7.2 item 14 / 7.4).

### 7.6 Sign-in guard (global, mandatory)

The system offers no anonymous browsing: outside the public paths, every anonymous visit is sent back to the sign-in page.

- Implementation: `app/middleware/auth.global.ts` (global route middleware); the allowlist is just `/` (download landing page) and `/auth/**` (sign-in page).
- Anonymous: `navigateTo('/auth/login?redirect=<full path>')`; after a successful sign-in the user is sent back to `redirect`, defaulting to `/dashboard/overview`.
- Authenticated visiting `/auth/login`: bounced straight back (`redirect` first, then `/dashboard/overview`) so nobody signs in twice.
- Non-login pages inside the allowlist (e.g. `/auth/reset-password`) guard themselves: on mount they call `fetchSession(true)` and, when anonymous, return to the login page with a `redirect`. A dedicated `check:ui` case pins this (it runs in external mode too).
- Single source of truth: only `GET /api/auth/session` (`fetchSession()` caches it; `force` after sign-in). The guard never reads cookies or parses tokens.
- No SSR special case: the app is a SPA (`ssr: false` in `nuxt.config.ts`), so the guard always runs on the client; the first frame carries no business data and the redirect fires as soon as the session answers.
- Desktop bundle: same client-side guard, and `useAuthTokens()` reporting no token means anonymous.
- Enforcement stays put: the BFF remains the only authority (`401 bff_auth_required`); the guard only handles navigation.

### 7.7 Demo seed accounts and login prefill

This repository is a demo program, so the login page must be loggable out of the box: seed accounts are pre-filled and the demo identity can be switched in one click.

- Single source of truth: `DEMO_ACCOUNTS` in `shared/constants/demoAccounts.ts` (super admin / tenant admin); the page only consumes it and never hard-codes credentials in the SFC.
- Prefill scope: `accountName` / `password` / `tenantCode` are refilled as a set per identity; other fields (such as `mfaCode`) are left alone, and every field stays editable.
- Identity semantics: the super admin always has `tenantId === 0` and an empty `tenantCode`; the tenant admin carries a tenant code — consistent with the multi-tenant isolation in §5 and `AUTH_ACCOUNT_LEVEL` (`0` / `1`).
- Demo only: the seed passwords serve demos and recordings; before going live they must be checked against the upstream IAM seed script, or the prefill removed (see `NMCPS-ADR-0013`).
- Verified seed facts (owner-specified, probe on 2026-10-31 against `http://192.168.1.55:10000/api/v1`): login API `POST /api/v1/auth/login`; super admin `admin` / `Admin@123456` (`accountLevel: 0`, `tenantId: 0`); tenant admin `tenantadmin` / `Tenant@123456` (`accountLevel: 1`, `tenantId: 1`). The seeds carry no tenant code, so an empty `tenantCode` is enough to log in (the built-in default tenant code is `default`, used only when a tenant must be chosen explicitly).
- Prerequisite: `NUXT_BFF_UPSTREAM_BASE` must be set (local `.env`, never committed). With an empty upstream every `/api/auth/*` route answers `503 bff_upstream_missing`, so no account — seed or otherwise — can log in; the prefill cannot compensate for a missing upstream.
- Upstream probe: on mount the login page calls `GET /ready` through `useBffUpstream()` with an explicit `retry: false` (503 sits in ofetch's default retry list, so leaving it on means two requests per visit). Only an explicit `upstream.configured === false` triggers the warning; a failed probe (network outage, or desktop with no same-origin Nitro) draws no conclusion and defers to the login call.
- Probe cache: `sessionStorage` under `bff.upstreamProbe`, 30s for "configured" and 5s for "not configured" (a to-fix state should heal quickly). The warning carries a "Check again" button that skips the cache, so fixing `.env` and restarting the BFF takes effect without waiting for the TTL.
- CI shape: `check:ui` starts its own fake upstream plus the built artefact on random ports. Never point `CHECK_UI_BASE_URL` at an instance without `NUXT_BFF_UPSTREAM_BASE`; the login and upstream-ready cases fail by construction (observed in CI on 2026-10-31). In that external mode the script probes `/ready` first and aborts when no upstream is configured. The self-built mode reports 61 assertions and the external one 49: self-built adds 13 cases (2 for the MFA one-time code, 10 for the forced reset, 1 for the dropped upstream — the first two need the fake `mfa-user` / `reset-user` accounts and `__control/down`), external adds the preflight (login and the self-check cases run in both modes, including the "anonymous visit to `/auth/reset-password`" guard).
- Single vocabulary: `shared/constants/upstreamReasons.ts` holds `UPSTREAM_REASONS` (the `/ready` `upstream.reason` values) and `BFF_UPSTREAM_MESSAGES` (the `bff_upstream_*` API messages); server and client reference the constants. The self-check scripts are plain node ESM and do not import that file — they assert the wire strings, so changing a value turns the contract cases red. That is the drift guard.
- Reuse: the MFA bind and password-change actions on `/user/security` share `upstreamHintKey()` (`app/utils/apiError.ts`) with the login page: `bff_upstream_missing` → the "set `.env`" hint, `bff_upstream_unreachable` / `bff_upstream_timeout` → the unreachable hint (`auth.bffUpstreamUnavailable`). Neither falls back to the raw message, so an ops problem is not read as "wrong password".
- Drop drill: the fake upstream exposes `POST /__control/down|up|state`; while down it destroys sockets for every other path, which surfaces as 502 `bff_upstream_unreachable` on the BFF side. That makes "signed in → upstream dropped → change password" testable, which cannot be built any other way.
- Flow unchanged: the prefill bypasses nothing — it still calls `POST /api/auth/login`, and the guard still judges by `GET /api/auth/session` (see 7.6).

### 7.8 Upstream defects and in-repo drift (probed 2026-10-31)

The `/api/v1/auth/*` surface is complete: all 7 endpoints answer, every unregistered path (`/auth/session`, `/auth/captcha`, `/auth/mfa/disable`, …) returns `404`, and there is no hidden capability. The BFF passes 10/10 end-to-end cases against the real upstream. What follows are 5 upstream defects plus 4 **in-repo** drifts (rows 6–9 are fixed but kept as regression guards), ordered by impact. Until they are fixed, do not treat them as contract.

| # | Symptom | Evidence | Impact | Owner |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Missing input returns `500 10509` instead of `400 10101` | `login {}` / `login` without `password` / `refresh {}` / `password {}` / missing `newPassword` / `mfa/confirm {}` all answer 500 | A client mistake is reported as a crash; the BFF blocks all of them with zod | Upstream |
| 2 | Rotation is not an atomic consume | The same RT fired three times in parallel returned 200 three times with three distinct `sessionId`s; all three ATs worked, and logging one out left the rest alive | Session fragmentation plus an RT replay window (a stolen token bypasses the single-use guard) | Upstream |
| 3 | `Content-Type` is not validated | `form-urlencoded` login → `500 10509`; `logout` without a body → 200 | Fuzzy contract; the BFF accepts JSON only | Upstream |
| 4 | `OPTIONS /api/v1/auth` returns `404` | Compare `/api/v1/account` → `405 + Allow` | No uniform preflight or capability discovery; harmless while same-origin | Upstream |
| 5 | `mfaType` defaults to TOTP and `0` is undocumented | `{}` / `{mfaType:0}` / `{mfaType:1}` behave identically (all return an `otpauthUrl`); `9` / `99` → `400 20109` | A client that omits the field silently binds TOTP; binding is two-phase, so `mfaEnabled` stays false until `confirm` | Upstream |
| 6 | The fake upstream's MFA rejection is the opposite of reality | `scripts/lib/bff-harness.mjs` answers `400 20205 mfa_required`; the real upstream answers `401 20203` with empty `data` | The self-check stays green and hides the next row | Repo (fake upstream) |
| 7 | The login page only knows `20205` | `app/pages/auth/login.vue` branches on `20205` in both `submit` and `describeError` | **An MFA-enabled account cannot log in**: the user sees "MFA code required" but no OTP field ever appears | Repo (client) |
| 8 | The fake upstream consumes refresh tokens once | After `usedRefresh.add` the second call always returns `401 10201`, even concurrently under Node's single thread | `check:bff` asserts semantics the real upstream does not have | Repo (fake upstream) |
| 9 | The login page's `mustResetPassword` branch is dead code | `mustResetPassword.value` is set and `navigateTo(redirect)` runs immediately, so the warning `v-if` never renders; upstream does not block the API either | **Forced reset never took effect**: the initial password could be used indefinitely | Repo (client) |

Rows 6, 7 and 8 were fixed together on 2026-10-31: the fake upstream's MFA branch now answers `401 20203`, the login page keys on `20203`, and the fake upstream gained a `POST /__control/auth-concurrency?allow=1` concurrency window whose "two parallel refreshes both return 200" case locks the real semantics (it will flip red once upstream consumes atomically, which is the signal to come back and update this table). The three must land together: patching the client alone leaves the self-check asserting `20205`, while patching the fake upstream alone turns the case red — which is exactly what a gate should do.

Row 9 was closed in two steps: first the dead code (a successful login with `mustResetPassword === true` no longer follows `redirect` to the dashboard), then the gap itself — a dedicated `/auth/reset-password` page (one screen, three fields, forced re-login afterwards) with the login page only forwarding the `redirect` query. The fake upstream gained a `reset-user` account returning the flag; `check:ui` locks ten cases (landing page, complete form, three inline validation states, a wrong old password naming `20201`, forced re-login, request body carrying the old password and no `firstReset`, no request emitted by the validation states, the success toast) plus one guard case (an anonymous visit bounces back to the login page with the redirect target), and `check:bff` asserts the flag passes through so the BFF cannot swallow it. The three inline validations (new equals old, mismatch, shorter than 8) also carry a cross-check that exactly two requests are emitted: if the validation were bypassed the count would become five and the case would fail.

The former blanks are now closed (the `AUTOTEST-*` probe account was disabled with `status: 2` afterwards): a successful password change returned `200` with the old password answering `401 20201` afterwards, while the **old access token still answered `200`**; `mfa/bind` followed by a `mfa/confirm` carrying a real TOTP returned `200` and flipped `whoami.mfaEnabled` to true; that MFA account then logged in with a correct `mfaCode` (200); login after disabling answered `20201`; creating with `mustResetPassword: true` → the flag comes back on login → a `firstReset` change clears it; both password rules (weak `20101`, recent duplicate `20302`). Still unverified: natural expiry (30-minute AT / 7-day RT) and concurrent refresh across multiple browser tabs. Defects and their reproduction steps live in `NMCPS-REC-001` (`layers/content/collections/cn/records/defects/auth-upstream-defects.md`).

---

## 8. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: IAM architecture (AAA framework, five-layer architecture, RBAC+ABAC, multi-tenant, audit). |
| 2026-10-31 | 0.2.0 | Added §7: the `/api/v1/auth` integration contract (endpoint table, token rotation semantics, BFF surface, client conventions). |
| 2026-10-31 | 0.2.1 | Added 7.5: `/user/security` self-service page (MFA binding / password change) interaction and credential handling. |
| 2026-10-31 | 0.2.2 | Added 7.6: the global sign-in guard (mandatory login outside the landing page and `/auth/**`), including the client-side check and bounce rules that follow from the SPA setup. |
| 2026-10-31 | 0.3.0 | Unified the login page on `/auth/login` (file name / route / i18n key renamed from `sign-in` to `login`); added 7.7 demo seed accounts and login prefill. |
| 2026-10-31 | 0.3.1 | 7.7 now records the verified seed facts (`admin` / `tenantadmin`, login works with an empty `tenantCode`) and the login prerequisite: without `NUXT_BFF_UPSTREAM_BASE`, `/api/auth/*` answers 503. |
| 2026-10-31 | 0.3.2 | 7.7 now records the login-page upstream probe (`useBffUpstream()` + `/ready`), the probe cache TTLs (30s configured / 5s missing), the "Check again" action, and the CI rule that `CHECK_UI_BASE_URL` must point at an instance with an upstream. |
| 2026-10-31 | 0.3.3 | 7.7 now records the `/ready` preflight of the `check:ui` external mode (aborts without an upstream, 48 assertions) and the shared 503 guidance reused by `/user/security`. |
| 2026-10-31 | 0.3.4 | 7.7 now extracts `shared/constants/upstreamReasons.ts` (the `/ready` reasons and the `bff_upstream_*` messages), routes every upstream-side failure through `upstreamHintKey()` (unreachable/timeout get a hint too), and gives the fake upstream `/__control/down|up` so the "upstream dropped while signed in" case is covered (48 assertions). |
| 2026-10-31 | 0.3.5 | 7.1 adds `20203` / `20204` and the disabled-account alias; 7.2 gains items 6–12 from the probe (missing input `500 10509`, non-serialised concurrent refresh, `mfaType` default, JSON-only, MFA login is `401 20203`, disabled shares `20201`, password change keeps old tokens); new 7.8 registers 5 upstream defects and 3 in-repo drifts. |
| 2026-10-31 | 0.3.7 | 7.2 item 14 gains the client-side rule (`mustResetPassword` → `/user/security` plus a persistent toast); 7.7 counts become 52 self-built / 50 external; 7.8 gains row 9 (the forced-reset branch used to be dead code, now fixed and locked by two `check:ui` cases) and row 5 now cites `9` / `99` → `400 20109`; `check:bff` gains the `20204` and `mustResetPassword` pass-through cases (81 assertions). |
| 2026-10-31 | 0.3.8 | The forced reset gets its own page: 7.2 item 14 now says "go to `/auth/reset-password`, re-login afterwards, submit without `firstReset`" (aligned with item 13 / UP-AUTH-02); 7.4 records that page's shell and self-checked sign-in; 7.7 counts become 55 self-built / 48 external; 7.8 row 9 records the two-step close-out and the five cases. |
| 2026-10-31 | 0.3.9 | The reset page now guards its form validation and error mapping too: `check:ui` 7.8 row 9 grows from five to ten cases (new equals old / mismatch / shorter than 8 as inline validation states, a wrong old password naming "current password is incorrect", and a request-count cross-check proving the validation states emit nothing), plus one guard case (an anonymous visit to `/auth/reset-password` bounces back to the login page with the redirect target); 7.7 counts become 61 self-built / 49 external. |
