---
title: "后端代际切换作业单"
description: "把 BFF 上游从已退役的旧代 go-zero 网关整体切到 8888 端口 NMS 统一网关的作业单：环境变量、四个可回滚提交的逐文件 diff 草案、字段映射、check:bff 假上游改造点、验收命令与回滚方式。裁决依据见 NMCPS-ADR-0018（layers/content/collections/cn/records/adr/adr-0018.md）；本页是作业层说明，不作依据。"
excerpt: "上游切 8888：四个提交的 diff 草案、假上游改造点与验收命令。"
createdAt: "2026-11-04"
updatedAt: "2026-11-04"
icon: "carbon:renew"
tags:
  - "作业层"
  - "迁移"
  - "BFF"
  - "后端代际"
---

# 后端代际切换作业单

> **层级**：Tier 4 作业层（可随时更新，**不作依据**）。裁决与证据见 `NMCPS-ADR-0018`；规范本体见 `NMCPS-ARCH-003` / `NMCPS-DESIGN-005`。
> **目标**：仓库里不再有任何旧代上游痕迹，BFF 唯一上游为 `http://192.168.1.55:8888/api/v1`。

---

## 一、准备

| 项 | 值 | 说明 |
| :--- | :--- | :--- |
| 上游基址 | `http://192.168.1.55:8888/api/v1` | 已写入 `.env` / `.env.example` |
| 就绪探针 | `GET /api/v1/health` | `NUXT_BFF_READINESS_PATH=/health` 不变 |
| 种子账号 | `admin` / `Admin@123456` | 平台管理员，`tenant_id: null` |
| 新代命名空间 | `iam` / `asset` / `metric` / `topology` / `alarm` / `audit` / `system` / `task` / `transmission` / `dashboard` / `frequency` / `protocol` | 白名单来源 |

改完 `NUXT_BFF_*` 后先 `pnpm exec nuxt prepare` 再 `pnpm typecheck`（`runtime-config.d.ts` 是生成物）。

---

## 二、四个提交（每个都可独立回滚）

| # | 提交 | 范围 | 验收 |
| :---: | :--- | :--- | :--- |
| C1 | `fix(bff): 会话失效码换 40101，业务错误不判成功` ✅ | `shared/utils/apiGuard.ts`、`server/utils/bff/auth.ts`、`app/composables/useAuth.ts`、`scripts/lib/bff-harness.mjs`、`scripts/check-bff.mjs`、`.env*` | `pnpm lint && pnpm typecheck && pnpm build:server && pnpm check:bff` |
| C2 | `feat(bff): 认证对接 iam 命名空间` ✅ | `shared/types/auth.ts`、`server/utils/bff/{auth,authSchema}.ts`、`server/api/auth/*`（含删除 `mfa/`）、`app/{composables,pages/auth,constants}`、`layers/{user,system}` 受影响页、`scripts/{check-bff,check-ui}` + 假上游、i18n | `pnpm lint && pnpm typecheck && pnpm build:server && pnpm check:bff`（74/74）+ `pnpm check:ui`（103/103）+ 真实登录 |
| C3 | `feat(bff): 网关白名单与敏感字段脱敏` | `shared/types/api.ts`、`server/utils/bff/{gateway,proxy}.ts`、`scripts/check-bff.mjs` | `check:bff` 全绿 |
| C4 | `refactor(system): 四个系统页面按 iam/audit 契约重写` | `shared/types/{account,policy,audit,tenant}.ts`、`layers/system/app/composables/*`、`layers/system/app/pages/system/*.vue` | `pnpm check:ui` + 手测四页 |

---

## 三、逐文件 diff 草案

### 3.1 `shared/types/api.ts`（C3）

```diff
-export const GATEWAY_RESOURCES = [
-	"abac", "access", "account", "ai", "alarm", "alerts", "asset", "association",
-	"audit", "dashboard", "device", "devices", "edge", "flow", "frequency", "group",
-	"health", "iam", "menu", "metrics", "monitor", "ota", "permission", "product",
-	"protocol", "role", "rule", "simulation", "targets", "telemetry", "template",
-	"tenant", "thing-model", "topology", "user"
-] as const;
+/** 上游十二个服务命名空间（NMS 统一网关；新增服务须显式登记） */
+export const GATEWAY_RESOURCES = [
+	"alarm", "asset", "audit", "dashboard", "frequency",
+	"health", "iam", "metric", "protocol", "system",
+	"task", "topology", "transmission"
+] as const;
```

分页判据改为「分页信息在 `data` 内」，并补空列表归一：

```ts
export interface PagedData<T> {
	list: T[]
	page: number
	page_size: number
	total: number
}

export function isPagedData<T>(data: unknown): data is PagedData<T> {
	const d = data as Partial<PagedData<T>> | null;
	return !!d && Array.isArray(d.list)
		&& typeof d.page === "number"
		&& typeof d.page_size === "number"
		&& typeof d.total === "number";
}

/** 上游空列表返回 list: null，出口统一归一为 []（D6） */
export function normalizeList<T>(value: unknown): T[] {
	return Array.isArray(value) ? value as T[] : [];
}
```

### 3.2 `shared/types/auth.ts`（C2）

```diff
-export interface AuthTokens {
-	accessToken: string
-	refreshToken: string
-	expiresIn: number
-	sessionId: string
-}
+/** 上游 `POST /iam/login`、`POST /iam/refresh` 的 data（snake_case，原样透传） */
+export interface IamTokens {
+	access_token: string
+	refresh_token?: string
+	expires_in: number
+}
+
+/** 上游 `data.user_info`（平台管理员 `tenant_id` 为 null） */
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

- `AUTH_ACCOUNT_LEVEL` 常量删除（`accountLevel` 上游已不存在）。
- `AuthLoginResult` 去掉 `mfaRequired` / `mustResetPassword`，`tokens` 改为 `IamTokens`。
- `AuthMfaBindPayload` / `AuthMfaConfirmPayload` / `AuthMfaBindResult` 删除。

### 3.3 `server/utils/bff/authSchema.ts`（C2）

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

`authMfaBindSchema` / `authMfaConfirmSchema` 删除；`authPasswordSchema` 去掉 `firstReset`。

### 3.4 `server/utils/bff/auth.ts`（C2）

```diff
-const SESSION_INVALID_CODES = new Set([401, 10201, 20205]);
+/** 新代未认证：HTTP 401 + code 40101（refresh_token 失效同码） */
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
+/** 上游 `data.user_info` → `AuthUser`；缺失即 null，绝不编造 */
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

`toAuthTokens` 改读 `access_token` / `refresh_token` / `expires_in`；刷新响应无 `refresh_token` 时**保留旧刷新令牌**（不轮换，D4）。

#### 3.4.1 C2 实测补记（2026-11-04，真实上游 8888）

| 场景 | 实测响应 | 落码处置 |
| :--- | :--- | :--- |
| `POST /iam/refresh` 用同一 `refresh_token` 连打两次 | 两次都 `200 { code: 0, data: { access_token, expires_in } }` | 确认**不轮换**（D4）；`applySessionCookies` 只在响应带 `refresh_token` 时写刷新 cookie |
| `POST /iam/refresh` 用坏令牌 | **`HTTP 200 + { code: 10007, message: "无效的认证令牌" }`** | `SESSION_INVALID_CODES` 增加 `10007`，`authFailureResponse` 还原为 401 并清三种 cookie |
| `POST /iam/logout`（Bearer + `{ user_id }`）重复调用 | 两次都 `200 { code: 0 }` | 旧代「登出不幂等」作废；BFF 仍吞错恒回 `{ ok: true }` |
| `PUT /iam/password` 传 camelCase | `400 field "old_password" is not set` | 契约只认 `old_password` / `new_password`（`z.strictObject` 前置挡旧字段名） |
| `PUT /iam/password` 旧口令错误 | **`HTTP 200 + { code: 10003, message: "用户名或密码错误" }`** | 还原为 400 + `10003`，页面按 `error.code` 分类 |

会话来源（D3）落地方式：登录成功时把 `user_info` 归一成 `AuthUser` 写 `nmcps_ui` cookie（HttpOnly，`Path=/api/auth`），
`GET /api/auth/session` **不再调用上游**；有访问令牌却没有身份 cookie 视为半截会话，清干净后回 `{ authenticated: false }`。
桌面端没有 cookie 语义，登录时把身份一并存进 `auth.bin`（`useAuthTokens` 的 `user` 键），`fetchSession` 直接读本地。

### 3.5 `server/api/auth/*.ts`（C2）

| 文件 | 改动（✅ = C2 已落码） |
| :--- | :--- |
| `login.post.ts` | ✅ `iam/login`；`toAuthUser(payload)` 无兜底账号名；业务失败走 `authFailureResponse(..., 401)`；Web 写 `nmcps_at` / `nmcps_rt` / `nmcps_ui` |
| `refresh.post.ts` | ✅ `iam/refresh`；`json: { refresh_token }`；`toAuthTokens(data, 旧令牌)` 不轮换；坏令牌 `200 + 10007` → 401 + 清 cookie |
| `logout.post.ts` | ✅ `iam/logout` + `authorization` + `json: { user_id }`（取自会话里的 `id`）；上游幂等 |
| `session.get.ts` | ✅ 不调 `whoami`：身份取 `nmcps_ui` cookie；无身份（含「有令牌无身份」的半截会话）→ 200 `{ authenticated: false, user: null }` |
| `password.post.ts` | ✅ `iam/password`（`PUT`）；字段 `old_password` / `new_password`；旧口令错 `200 + 10003` → 400 + 业务码 |
| `mfa/*.ts` | ✅ 整目录删除（缺口 G8）；`/user/security` 的两步验证区块改为「上游无端点」提示 |

### 3.6 `server/utils/bff/proxy.ts`（C3）

```ts
/** 上游明文凭据字段：BFF 出口一律打码（NMCPS-ADR-0018 D7） */
const SENSITIVE_KEYS = new Set(["snmp_auth_pass", "snmp_priv_pass"]);

function maskSensitive(value: unknown): unknown {
	if (Array.isArray(value))
		return value.map(maskSensitive);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = SENSITIVE_KEYS.has(k) && typeof v === "string" && v
				? "***"
				: maskSensitive(v);
		}
		return out;
	}
	return value;
}
```

挂载点：`proxyToUpstream` 把 JSON 包成信封之前对 `data` 调 `maskSensitive`；SSE 分支不改。

### 3.7 判据层与信封推导（C1，**最关键**）

现状已具备信封判定，不要凭印象乱改：

- `useAuth.ts:53` 的刷新用裸 `$fetch`，但**第 61 行**已过 `isSuccessResponse`；登录/登出走 `useApi().post`，失败抛 `ApiError`。
- 让「HTTP 200 + `code: 10003`」成为失败的真正载荷点是 `proxy.ts` 的 `normalizeUpstreamEnvelope`：上游 2xx 信封不带 `status`，它按 `code === 0 ? "success" : "warning"` 推出来 —— **这条推导必须原样保留**，不得在改路径时顺手重写。

C1 实落三处：

1. `shared/utils/apiGuard.ts` —— `isSuccessResponse` 只认 `code === 0`（`status` 仅用于一票否决）：

```ts
export function isSuccessResponse<T>(res: ApiResponse<T> | undefined | null): res is ApiResponse<T> & { data: T } {
	return !!res
		&& res.code === 0
		&& res.status !== "warning"
		&& res.status !== "error";
}
```

2. `server/utils/bff/auth.ts` + `app/composables/useAuth.ts` —— 会话失效码换代：`{401, 10201, 20205}` → `{401, 40101}`。
3. `scripts/lib/bff-harness.mjs` + `scripts/check-bff.mjs` —— 假上游未认证码同步 `40101`；新增 `biz-error-user` → `200 { code: 10003 }`，断言 BFF 输出 `status=warning`、`code=10003` 且不写 cookie。

登录表单字段改 `username`、`useAuthTokens()` 键改 snake_case 属 C2（与 `IamTokens` 同批）。


### 3.8 `layers/system/app/composables/*.ts`（C4）

| 文件 | 端点变化 |
| :--- | :--- |
| `useAccounts.ts` | `/api/account` → `/api/iam/users`；`pageSize` → `page_size`；状态改 `PUT /api/iam/users/{id}` |
| `useTenants.ts` | `/api/tenant` → `/api/iam/tenants` |
| `usePolicies.ts` | `/api/role` → `/api/iam/roles`；`/api/abac/rule` 与 `/api/access/dryrun` 删除；新增 `policies` / `role-policies` |
| `usePermissions.ts` | 权限目录段删除；矩阵改读 `role-policies` + 策略 `actions` |
| `useAuditLogs.ts` | `/api/audit` → `/api/audit/operation-logs`；详情用 `{id}` |
| `useAuditExport.ts` | 整文件删除（无导出端点）；归档改 `POST /api/audit/archive/run` |

响应解包统一：`normalizeList(res.data?.list)`，分页读 `res.data?.page` / `page_size` / `total`。

---

## 四、`check:bff` 与假上游改造点

| 提交 | 位置 | 现状 | 改法 |
| :---: | :--- | :--- | :--- |
| C1 | `scripts/lib/bff-harness.mjs` | 未认证业务码是旧代 `10201` / `20205` | 统一 `40101`；新增 `/auth/login` 的 `biz-error-user` → `200 { code: 10003 }` |
| C1 | `scripts/check-bff.mjs` ⑦ | 断言 `10201` / `20205` | 改 `40101`；**新增**「上游 200 + `code: 10003` → BFF `status=warning` 且不写 cookie」 |
| C2 | `scripts/lib/bff-harness.mjs` | 路由按旧资源名（`auth` / `account`） | 认证段已改 `iam` 前缀 + snake_case（`account` / `audit` 段留到 C4） |
| C2 | `scripts/check-bff.mjs` ⑦ | 「刷新即轮换」 | **改为「刷新不轮换」**：同 `refresh_token` 二次刷新仍 200、cookie 值不变；另加「坏刷新令牌 `200 + 10007` → BFF 401」「改密 `PUT` + snake_case」「登出幂等」 |
| C3 | `scripts/check-bff.mjs` 新增 | — | `list: null` → BFF 出口 `[]`；`snmp_auth_pass` 出口为 `***` |

C1 落码实测（2026-11-04）：`pnpm check:bff` 83/83、`pnpm check:ui` 105/105。
C2 落码实测（2026-11-04，同一上游）：`pnpm check:bff` 74/74、`pnpm check:ui` 103/103
—— 断言总数下降是因为 MFA 绑定（G8）、强制改密（G2）、刷新轮换与 whoami 相关用例随能力退场被删除。

断言数变化须同步更新脚本自身摘要的 `N/N` 与相关架构文档里的计数（`.clinerules`「CI self-check conventions」）。

---

## 五、验收

```bash
pnpm exec nuxt prepare
pnpm lint
pnpm typecheck
pnpm build:server && pnpm check:bff
pnpm check:ui
pnpm check:governance && pnpm check:doc-system

# 真实联调（BFF 起在 39881，上游 8888）
PORT=39881 node .output/server/index.mjs &
curl -s -X POST http://127.0.0.1:39881/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"admin","password":"Admin@123456"}'
curl -s http://127.0.0.1:39881/ready
```

验收口径：

1. `check:bff` 全绿。C1 已覆盖「200 + `code≠0` 不得判 success」与「40101 会话失效」；C2 已覆盖「刷新不轮换」「坏刷新令牌 `200 + 10007` → 401」「改密 `PUT` + snake_case」「登出幂等」「会话不触达上游」；C3 补「`list: null` 归一」与「敏感字段打码」。
2. 真实登录返回 `user.displayName = "平台管理员"`、`tenantId = null`（C2 已实测通过）。
3. `grep -rn "192\.168\.1\.55:1" --exclude-dir=_reference .` 无命中（旧端口前缀已清零）。
4. 四页手测：登录 → `/system/user` 列表与建号 → `/system/policy`（无试算、无 ABAC）→ `/system/log`（无导出、无校验）。

---

## 六、回滚

- 提交独立可回滚：C1 → C2 → C3 → C4 逆序 `git revert`。
- 环境变量层面单独回滚无效（旧代实例已退役），**禁止**把 `.env` 指回旧端口。
- 回滚后必须重跑 `pnpm check:bff`：假上游与 BFF 代码跨提交混搭会出现假绿。


