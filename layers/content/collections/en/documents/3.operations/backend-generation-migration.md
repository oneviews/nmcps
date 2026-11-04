---
title: "Backend generation migration work order"
description: "Work order for switching the BFF upstream from the retired go-zero gateway to the 8888 NMS unified gateway: environment variables, the per-file diff drafts of four rollback-safe commits, the field mapping, the check:bff fake-upstream changes, the acceptance commands and the rollback procedure. The decision lives in NMCPS-ADR-0018 (layers/content/collections/cn/records/adr/adr-0018.md); this page is a work-order note, never a source of authority."
excerpt: "Upstream moves to 8888: diff drafts for four commits, fake-upstream changes, acceptance."
createdAt: "2026-11-04"
updatedAt: "2026-11-04"
icon: "carbon:renew"
tags:
  - "Operations"
  - "Migration"
  - "BFF"
  - "Backend generation"
---

# Backend generation migration work order

> **Layer**: Tier 4 operations layer (freely updatable, **never a source of authority**). Decision and evidence: `NMCPS-ADR-0018`; normative documents: `NMCPS-ARCH-003` / `NMCPS-DESIGN-005`.
> **Goal**: no trace of the old upstream generation anywhere; the single BFF upstream is `http://192.168.1.55:8888/api/v1`.

---

## 1. Prerequisites

| Item | Value | Note |
| :--- | :--- | :--- |
| Upstream base | `http://192.168.1.55:8888/api/v1` | already written to `.env` / `.env.example` |
| Readiness probe | `GET /api/v1/health` | `NUXT_BFF_READINESS_PATH=/health` unchanged |
| Seed account | `admin` / `Admin@123456` | platform admin, `tenant_id: null` |
| Namespaces | `iam` / `asset` / `metric` / `topology` / `alarm` / `audit` / `system` / `task` / `transmission` / `dashboard` / `frequency` / `protocol` | allow-list source |

After touching `NUXT_BFF_*`, run `pnpm exec nuxt prepare` before `pnpm typecheck` (`runtime-config.d.ts` is generated).

---

## 2. Four commits (each independently revertible)

| # | Commit | Scope | Verification |
| :---: | :--- | :--- | :--- |
| C1 | `fix(bff): session-invalid codes become 40101, business errors never read as success` ✅ | `shared/utils/apiGuard.ts`, `server/utils/bff/auth.ts`, `app/composables/useAuth.ts`, `scripts/lib/bff-harness.mjs`, `scripts/check-bff.mjs`, `.env*` | `pnpm lint && pnpm typecheck && pnpm build:server && pnpm check:bff` |
| C2 | `feat(bff): authenticate against the iam namespace` ✅ | `shared/types/auth.ts`, `server/utils/bff/{auth,authSchema}.ts`, `server/api/auth/*` (incl. deleting `mfa/`), `app/{composables,pages/auth,constants}`, the affected `layers/{user,system}` pages, `scripts/{check-bff,check-ui}` + fake upstream, i18n | `pnpm lint && pnpm typecheck && pnpm build:server && pnpm check:bff` (74/74) + `pnpm check:ui` (103/103) + a live login |
| C3 | `feat(bff): rebuild the gateway allow-list on the new namespaces, normalise and mask at the exit` ✅ | `shared/types/api.ts`, `server/utils/bff/{gateway,proxy}.ts`, `scripts/{check-bff,lib/bff-harness}.mjs` | `pnpm build:server && pnpm check:bff` (82/82) + `pnpm check:ui` (103/103) |
| C4a | `refactor(system): point user management at iam/users, drop the dry-run with G5` ✅ | `shared/types/{account,tenant,department}.ts`, `layers/system/app/{composables/useAccounts,composables/useTenants,composables/useDepartments,composables/usePolicies,utils/accountError}.ts`, `layers/system/app/components/User/*`, `layers/system/app/pages/system/user.vue`, `pages/system/policy.vue` (dry-run entry removed), `shared/types/policy.ts`, i18n, `scripts/{check-ui,check-bff}.mjs`, `scripts/lib/bff-harness.mjs` | `pnpm lint && pnpm typecheck && pnpm build:server && pnpm check:bff` (84/84) + `pnpm check:ui` (103/103) |
| C4b | `refactor(system): point the audit page at audit/operation-logs and archiving` | `shared/types/audit.ts`, `composables/{useAuditLogs,useAuditExport}.ts`, `pages/system/log.vue`, fake upstream and self-check | `pnpm check:ui` + a manual pass over `/system/log` |
| C4c | `refactor(system): point the policy and permission pages at iam/roles and iam/policies, delete the legacy allow-list group` | `shared/types/policy.ts`, `composables/{usePolicies,usePermissions}.ts`, `pages/system/{policy,permission}.vue`, `shared/types/api.ts` (legacy group deleted), `check:bff` (legacy-name 404 assertions) | `pnpm check:bff` + `pnpm check:ui` + a manual pass over both pages |

---

## 3. Per-file diff drafts

### 3.1 `shared/types/api.ts` (C3, shipped)

The allow-list now registers two groups (`NMCPS-ADR-0018` D2): the twelve new namespaces + `health` are the
**target set**, while the legacy names stay as a group annotated "delete as a whole once C4 finishes the client
migration" — the client data layer still calls `/api/account`, `/api/role` and `/api/audit`, so dropping them
now would break every system page between C3 and C4 (`check:ui` would go red immediately).

```ts
export const GATEWAY_RESOURCES = [
	// ── the twelve new namespaces (NMCPS-ADR-0018 D2) + the readiness probe ──
	"alarm", "asset", "audit", "dashboard", "frequency", "health",
	"iam", "metric", "protocol", "system", "task", "topology", "transmission",
	// ── legacy resource names (delete as a group once C4 migrates the client) ──
	"abac", "access", "account", "ai", "alerts", "association", "device", "devices",
	"edge", "flow", "group", "menu", "metrics", "monitor", "ota", "permission",
	"product", "role", "rule", "simulation", "targets", "telemetry", "template",
	"tenant", "thing-model", "user"
] as const;
```

Once C4 lands the legacy group disappears and `check:bff` must gain a "legacy name → 404" assertion (see §4).

List normalisation does **not** live here: `list: null → []` happens in `proxy.ts`'s `respond()` (§3.6), so the
front end only ever reads an `Array`. Helpers such as `PagedData` / `isPagedData` / `normalizeList` are left for
the C4 consumers to pull in as needed.

### 3.2 `shared/types/auth.ts` (C2)

```diff
-export interface AuthTokens {
-	accessToken: string
-	refreshToken: string
-	expiresIn: number
-	sessionId: string
-}
+export interface IamTokens {
+	access_token: string
+	refresh_token?: string
+	expires_in: number
+}
+
+export interface IamUserInfo {
+	id: string
+	username: string
+	display_name?: string
+	email?: string
+	phone?: string
+	tenant_id: string | null
+}
+
+export interface AuthUser {
+	id: string
+	username: string
+	displayName: string | null
+	email: string | null
+	phone: string | null
+	tenantId: string | null
+}
+
+export interface AuthLoginPayload {
+	username: string
+	password: string
+}
+
+export interface AuthRefreshPayload {
+	refresh_token?: string
+}
```

- `AUTH_ACCOUNT_LEVEL` is deleted (`accountLevel` no longer exists upstream).
- `AuthLoginResult` loses `mfaRequired` / `mustResetPassword`; `tokens` becomes `IamTokens`.
- `AuthMfaBindPayload` / `AuthMfaConfirmPayload` / `AuthMfaBindResult` are deleted.

### 3.3 `server/utils/bff/authSchema.ts` (C2)

```diff
 export const authLoginSchema = z.object({
-	accountName: z.string().trim().min(1).max(64),
+	username: z.string().trim().min(1).max(64),
 	password: z.string().min(1).max(128),
-	tenantCode: z.string().trim().min(1).max(64).optional(),
-	mfaCode: z.string().trim().min(4).max(16).optional()
 });
 
 export const authRefreshSchema = z.object({
-	refreshToken: z.string().trim().min(1).optional()
+	refresh_token: z.string().trim().min(1).optional()
 });
```

Delete `authMfaBindSchema` / `authMfaConfirmSchema`; drop `firstReset` from `authPasswordSchema`.

### 3.4 `server/utils/bff/auth.ts` (C2)

```diff
-const SESSION_INVALID_CODES = new Set([401, 10201, 20205]);
+/** Unauthenticated in the new generation: HTTP 401 + code 40101 (same code for an expired refresh_token) */
+const SESSION_INVALID_CODES = new Set([401, 40101]);
```

```diff
-export function toAuthUser(payload: unknown, fallbackAccountName?: string): AuthUser | null {
-	accountCode: toStringOrNull(record.accountCode) ?? accountName,
-	accountName,
-	displayName: toStringOrNull(record.displayName),
-	tenantId: toNumberOrNull(record.tenantId),
-	accountLevel: toNumberOrNull(record.accountLevel),
-	mfaEnabled: typeof record.mfaEnabled === "boolean" ? record.mfaEnabled : null,
-	sessionId: toStringOrNull(record.sessionId) ?? ""
-}
+/** upstream data.user_info -> AuthUser; missing means null, never invented */
+export function toAuthUser(payload: unknown): AuthUser | null {
+	const info = asRecord(asRecord(payload)?.user_info) ?? asRecord(payload);
+	const username = toStringOrNull(info?.username);
+
+	if (!username) {
+		return null;
+	}
+
+	return {
+		id: toStringOrNull(info?.id) ?? "",
+		username,
+		displayName: toStringOrNull(info?.display_name),
+		email: toStringOrNull(info?.email),
+		phone: toStringOrNull(info?.phone),
+		tenantId: toStringOrNull(info?.tenant_id)
+	};
+}
```

`toAuthTokens` reads `access_token` / `refresh_token` / `expires_in`; when a refresh response has no `refresh_token`, **keep the previous one** (no rotation, D4).

#### 3.4.1 C2 measured addendum (2026-11-04, live upstream on 8888)

| Case | Measured response | What the code does |
| :--- | :--- | :--- |
| `POST /iam/refresh` with the same `refresh_token` twice | both `200 { code: 0, data: { access_token, expires_in } }` | confirms **no rotation** (D4); `applySessionCookies` writes the refresh cookie only when the response carries `refresh_token` |
| `POST /iam/refresh` with a bogus token | **`HTTP 200 + { code: 10007, message: "无效的认证令牌" }`** | `SESSION_INVALID_CODES` gains `10007`; `authFailureResponse` restores 401 and clears all three cookies |
| `POST /iam/logout` (Bearer + `{ user_id }`) twice | both `200 { code: 0 }` | the old "logout is not idempotent" rule is void; the BFF still swallows errors and always returns `{ ok: true }` |
| `PUT /iam/password` with camelCase | `400 field "old_password" is not set` | the contract only accepts `old_password` / `new_password` (`z.strictObject` rejects legacy names up front) |
| `PUT /iam/password` with a wrong old password | **`HTTP 200 + { code: 10003, message: "用户名或密码错误" }`** | restored as 400 + `10003`; pages branch on `error.code` |

How D3 lands: on a successful login the BFF normalises `user_info` into `AuthUser` and writes it to the
`nmcps_ui` cookie (HttpOnly, `Path=/api/auth`), so `GET /api/auth/session` **no longer calls upstream**;
an access token without an identity cookie counts as a half session, gets cleared, and answers `{ authenticated: false }`.
Desktop has no cookie semantics, so login also stores the identity in `auth.bin` (the `user` key of `useAuthTokens`) and `fetchSession` reads it locally.

### 3.5 `server/api/auth/*.ts` (C2)

| File | Change (✅ = landed with C2) |
| :--- | :--- |
| `login.post.ts` | ✅ `iam/login`; `toAuthUser(payload)` without a fallback name; business failures go through `authFailureResponse(..., 401)`; Web writes `nmcps_at` / `nmcps_rt` / `nmcps_ui` |
| `refresh.post.ts` | ✅ `iam/refresh`; `json: { refresh_token }`; `toAuthTokens(data, previousToken)` keeps the token (no rotation); bogus token `200 + 10007` → 401 + cookies cleared |
| `logout.post.ts` | ✅ `iam/logout` + `authorization` + `json: { user_id }` (from the session); upstream is idempotent |
| `session.get.ts` | ✅ no `whoami`: identity comes from the `nmcps_ui` cookie; no identity (including a token-only half session) → 200 `{ authenticated: false, user: null }` |
| `password.post.ts` | ✅ `iam/password` (`PUT`); fields `old_password` / `new_password`; wrong old password `200 + 10003` → 400 + business code |
| `mfa/*.ts` | ✅ directory deleted (gap G8); the `/user/security` two-factor block now states the upstream has no endpoint |

### 3.6 `server/utils/bff/proxy.ts` (C3, shipped)

Both behaviours hang off the **single exit** `respond()` rather than being scattered across handlers: `respond`
is the last stop before h3 serialises, so the raw-JSON wrap, the already-an-envelope path and the error envelope
all pass through it — missing one place would mean not doing it at all.

```ts
/** Fields masked at the exit (NMCPS-ADR-0018 D7) */
const MASKED_FIELDS = new Set(["snmp_auth_pass", "snmp_priv_pass"]);
const MASK_VALUE = "***";

/** `data.list === null` → `[]` (D6) */
function normalizeEmptyList<T>(data: T): T { … }

/** Walk objects / arrays; a sensitive key holding a non-empty string becomes `***` (D7) */
function maskSensitiveFields(value: unknown): unknown { … }

function normalizeExitBody<T>(body: ApiResponse<T>): ApiResponse<T> {
	if (body.code !== 0 || body.data === undefined)
		return body;
	return { ...body, data: maskSensitiveFields(normalizeEmptyList(body.data)) as T };
}

function respond<T>(event: H3Event, status: number, body: ApiResponse<T>): ApiResponse<T> {
	// …set status / content-type / no-store
	return normalizeExitBody(body);
}
```

Boundaries and trade-offs:

- **Only successful envelopes** are normalised (`code === 0`); failure envelopes carry no `data` and must keep their semantics;
- **The SSE branch never passes through `respond`** (`streamResponse` returns a `Response` directly), so event streams cannot be masked;
- An **empty string stays empty**: there is no credential to hide, and `***` would suggest "a value exists but is hidden";
- Normalising and masking at the BFF exit means the front end always sees an array `list` and `snmp_*_pass === "***"`;
- Deep arrays are handled too (`asset/device` returns `data.list[]`, i.e. objects inside an array).

### 3.7 Guard layer and the envelope derivation (C1, **most delicate**)

The envelope gate already exists — do not "fix" it from memory:

- `useAuth.ts:53` refreshes through raw `$fetch`, but **line 61** already gates on `isSuccessResponse`; login/logout go through `useApi().post`, which throws `ApiError`.
- What actually turns "HTTP 200 + `code: 10003`" into a failure is `normalizeUpstreamEnvelope` in `proxy.ts`: upstream 2xx envelopes carry no `status`, so it derives `code === 0 ? "success" : "warning"` — **keep that derivation verbatim** and never rewrite it while changing paths.

C1 lands in three places:

1. `shared/utils/apiGuard.ts` — `isSuccessResponse` only accepts `code === 0` (`status` merely vetoes):

```ts
export function isSuccessResponse<T>(res: ApiResponse<T> | undefined | null): res is ApiResponse<T> & { data: T } {
	return !!res
		&& res.code === 0
		&& res.status !== "warning"
		&& res.status !== "error";
}
```

2. `server/utils/bff/auth.ts` + `app/composables/useAuth.ts` — session-invalid codes move generations: `{401, 10201, 20205}` → `{401, 40101}`.
3. `scripts/lib/bff-harness.mjs` + `scripts/check-bff.mjs` — the fake upstream emits `40101`; a new `biz-error-user` returns `200 { code: 10003 }`, and the assertions require `status=warning`, `code=10003` and no cookie.

The `username` form field and the snake_case `useAuthTokens()` keys belong to C2 (shipped with `IamTokens`).


### 3.8 `layers/system/app/composables/*.ts` (C4a / C4b / C4c, C4a shipped)

| File | Endpoint change |
| :--- | :--- |
| `useAccounts.ts` ✅ | `/api/account` → `/api/iam/users`; `pageSize` → `page_size`; status via `PUT /api/iam/users/{id}`; `DELETE /iam/users/{id}` added (soft delete); `POST` answers `{ code, message, id }` (no `data`), so the composable re-reads the row with `keyword` |
| `useTenants.ts` ✅ | `/api/tenant` → `/api/iam/tenants` (only used to translate `tenant_id` into a tenant name) |
| `useDepartments.ts` ✅ (new) | `GET /api/iam/departments`: creation candidates and the ownership filter; each row carries `tenant_id` |
| `useTenants.ts` | `/api/tenant` → `/api/iam/tenants` |
| `usePolicies.ts` | `/api/role` → `/api/iam/roles`; `/api/abac/rule` and `/api/access/dryrun` removed; add `policies` / `role-policies` |
| `usePermissions.ts` | catalogue block removed; matrix reads `role-policies` + policy `actions` |
| `useAuditLogs.ts` | `/api/audit` → `/api/audit/operation-logs`; detail by `{id}` |
| `useAuditExport.ts` | delete (no export endpoint); archiving uses `POST /api/audit/archive/run` |

Unwrap uniformly: `normalizeList(res.data?.list)` and read `res.data?.page` / `page_size` / `total`.

---

## 4. `check:bff` and fake-upstream changes

| Commit | Location | Today | Change |
| :---: | :--- | :--- | :--- |
| C1 | `scripts/lib/bff-harness.mjs` | unauthenticated codes are the old `10201` / `20205` | unify on `40101`; add `/auth/login` case `biz-error-user` → `200 { code: 10003 }` |
| C1 | `scripts/check-bff.mjs` ⑦ | asserts `10201` / `20205` | switch to `40101`; **add** "upstream 200 + `code: 10003` → BFF `status=warning`, no cookie" |
| C2 | `scripts/lib/bff-harness.mjs` | fake upstream routed by the old resource names (`auth` / `account`) | the auth section now routes on `iam` with snake_case fields (`account` / `audit` wait for C4) |
| C2 | `scripts/check-bff.mjs` ⑦ | "refresh rotates" | **inverted to "refresh does not rotate"**: the same `refresh_token` twice still returns 200 and the cookie value is unchanged; plus "bogus refresh token `200 + 10007` → BFF 401", "password `PUT` + snake_case" and "logout is idempotent" |
| C3 | `scripts/lib/bff-harness.mjs` | no `asset` or new-generation audit route | add `GET /asset/device` (snake_case + plaintext `snmp_*_pass`) and `GET /audit/operation-logs` (empty result as `list: null`); both tolerate the `/api/v1` prefix |
| C3 | `scripts/check-bff.mjs` ⑧ | — | eight new assertions: "`asset` allowed and proxied", "`snmp_auth_pass` → `***`", "`snmp_priv_pass` → `***`", "other fields untouched", "no plaintext credential in the body", "`list: null` → `[]`", "paging fields unaffected", "`system` / `transmission` are allow-listed" |
| C4a | `scripts/lib/bff-harness.mjs` | no `iam/users` / `iam/tenants` / `iam/departments` | three new routes: the list really filters on `keyword` / `status` / `department_id`, pages with `page_size`, and returns `list: null` when empty; `POST` answers `{ code, message, id }`, a duplicate username gives `200 + 10002`, a missing field gives `200 + 40001`; `PUT` / `DELETE /iam/users/{id}` (a missing target answers `400` with "record does not exist") |
| C4a | `scripts/check-ui.mjs` ③ | fixed fake account set `ACC-1001…`, level-candidate assertions | user set becomes `u_alice` / `u_bob` / `u_carol`; the level-candidate case became "the creation form has exactly one select: department"; the creation case fills `username` / display name / email / password and asserts the `id` read-back plus the `?id` replace |

Measured with C1 in place (2026-11-04): `pnpm check:bff` 83/83, `pnpm check:ui` 105/105.
Measured with C2 in place (2026-11-04, same upstream): `pnpm check:bff` 74/74, `pnpm check:ui` 103/103
— the totals dropped because the MFA binding (G8), forced reset (G2), rotation and `whoami` cases retired with the capability.
Measured with C3 in place (2026-11-04): `pnpm check:bff` 82/82 (74 + 8), `pnpm check:ui` 103/103, `pnpm lint` / `pnpm typecheck` clean.
Measured with C4a in place (2026-11-04): `pnpm check:bff` 84/84 (82 + 2: `iam/users` passes snake_case through, and an empty `list: null` is normalised to `[]`), `pnpm check:ui` 103/103 (the level-candidate case became "the creation form has exactly one select: department", the creation case now asserts the `id` read-back and the `?id` replace, so the assertion count is unchanged), `pnpm lint` / `pnpm typecheck` / `pnpm build:server` silent.

Changing the assertion count means updating the `N/N` in the script summary and any counts quoted in the architecture docs (`.clinerules` "CI self-check conventions").

---

## 5. Acceptance

```bash
pnpm exec nuxt prepare
pnpm lint
pnpm typecheck
pnpm build:server && pnpm check:bff
pnpm check:ui
pnpm check:governance && pnpm check:doc-system

# live smoke test (BFF on 39881, upstream on 8888)
PORT=39881 node .output/server/index.mjs &
curl -s -X POST http://127.0.0.1:39881/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"admin","password":"Admin@123456"}'
curl -s http://127.0.0.1:39881/ready
```

Criteria:

1. `check:bff` green. C1 already covers "200 + `code≠0` must not be a success" and "40101 session invalid"; C2 already covers "no rotation", "bogus refresh token `200 + 10007` → 401", "password `PUT` + snake_case", "logout is idempotent" and "session never calls upstream"; C3 adds "`list: null` normalised" and "sensitive fields masked".
2. A live login returns `user.displayName = "平台管理员"` and `tenantId = null` (verified during C2).
3. `grep -rn "192\.168\.1\.55:1" --exclude-dir=_reference .` returns nothing (the old port prefix is gone).
4. Manual pass over four pages: login → `/system/user` list and create → `/system/policy` (no dry run, no ABAC) → `/system/log` (no export, no verify).

---

## 6. Rollback

- Each commit reverts on its own: C4 → C3 → C2 → C1 via `git revert`.
- Rolling back only the environment variable is pointless (the old instance is retired); pointing `.env` back at the old port is **forbidden**.
- Always re-run `pnpm check:bff` after a rollback: a fake upstream mixed across commits produces false green.


