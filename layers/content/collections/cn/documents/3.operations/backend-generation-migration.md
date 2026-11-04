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
| C3 | `feat(bff): 网关白名单按新代命名空间重建，出口归一与脱敏` ✅ | `shared/types/api.ts`、`server/utils/bff/{gateway,proxy}.ts`、`scripts/{check-bff,lib/bff-harness}.mjs` | `pnpm build:server && pnpm check:bff`（82/82）+ `pnpm check:ui`（103/103） |
| C4a | `refactor(system): 用户管理改接 iam/users，试算随 G5 下线` ✅ | `shared/types/{account,tenant,department}.ts`、`layers/system/app/{composables/useAccounts,composables/useTenants,composables/useDepartments,composables/usePolicies,utils/accountError}.ts`、`layers/system/app/components/User/*`、`layers/system/app/pages/system/user.vue`、`pages/system/policy.vue`（移除试算入口）、`shared/types/policy.ts`、i18n、`scripts/{check-ui,check-bff}.mjs`、`scripts/lib/bff-harness.mjs` | `pnpm lint && pnpm typecheck && pnpm build:server && pnpm check:bff`（84/84）+ `pnpm check:ui`（103/103） |
| C4b | `refactor(system): 审计页改接 audit/operation-logs 与归档` | `shared/types/audit.ts`、`composables/{useAuditLogs,useAuditExport}.ts`、`pages/system/log.vue`、假上游与自检 | `pnpm check:ui` + 手测 `/system/log` |
| C4c | `refactor(system): 策略与权限页改接 iam/roles 与 iam/policies，删除旧代白名单组` | `shared/types/policy.ts`、`composables/{usePolicies,usePermissions}.ts`、`pages/system/{policy,permission}.vue`、`shared/types/api.ts`（旧代组删除）、`check:bff`（旧名 404 断言） | `pnpm check:bff` + `pnpm check:ui` + 手测两页 |

---

## 三、逐文件 diff 草案

### 3.1 `shared/types/api.ts`（C3，已落码）

白名单分两组登记（`NMCPS-ADR-0018` D2）：新代十二命名空间 + `health` 是**目标集**，旧代资源名整组带
`待 C4 客户端迁移后整组删除` 的注释保留 —— 客户端数据层此刻还打 `/api/account`、`/api/role`、`/api/audit`，
先删会让全部系统页在 C3 与 C4 之间断链（`check:ui` 直接红）。

```ts
export const GATEWAY_RESOURCES = [
	// ── 新代十二命名空间（NMCPS-ADR-0018 D2）+ 就绪探针 ──
	"alarm", "asset", "audit", "dashboard", "frequency", "health",
	"iam", "metric", "protocol", "system", "task", "topology", "transmission",
	// ── 旧代资源名（待 C4 客户端迁移后整组删除） ──
	"abac", "access", "account", "ai", "alerts", "association", "device", "devices",
	"edge", "flow", "group", "menu", "metrics", "monitor", "ota", "permission",
	"product", "role", "rule", "simulation", "targets", "telemetry", "template",
	"tenant", "thing-model", "user"
] as const;
```

C4 收尾后旧代组消失，`check:bff` 需补一条「旧名 404」断言接手（见 §四）。

分页/列表的**出口归一不在本文件**：`list: null → []` 由 `proxy.ts` 的 `respond()` 统一做（§3.6），
前端只读 `Array`。`PagedData` / `isPagedData` / `normalizeList` 这类辅助留给 C4 的消费面按需引入。

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

### 3.6 `server/utils/bff/proxy.ts`（C3，已落码）

两件事都挂在**唯一出口** `respond()` 上，而不是散到各 handler：`respond` 是 h3 序列化前的最后一站，
上游裸 JSON 包裹、已是信封、错误信封全部经过它，漏一处就等于没做。

```ts
/** 出口掩码字段（NMCPS-ADR-0018 D7） */
const MASKED_FIELDS = new Set(["snmp_auth_pass", "snmp_priv_pass"]);
const MASK_VALUE = "***";

/** `data.list === null` → `[]`（D6） */
function normalizeEmptyList<T>(data: T): T { … }

/** 深走对象 / 数组，命中敏感键且值为非空字符串 → `***`（D7） */
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

边界与取舍：

- **只归一成功信封**（`code === 0`）：失败信封没有 `data`，也不该被改写语义；
- **SSE 分支不经过 `respond`**（`streamResponse` 直出 `Response`），事件流不可能被掩码；
- 掩码对**空串保持原样**：没有凭据可掩，回 `***` 反而会让人以为「有值但被藏」；
- 归一/掩码都在 BFF 出口做，前端拿到的 `list` 恒为数组、`snmp_*_pass` 恒为 `***`；
- 深层数组同样处理（`asset/device` 的 `data.list[]` 就是数组套对象）。

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


### 3.8 `layers/system/app/composables/*.ts`（C4a / C4b / C4c，C4a 已落码）

| 文件 | 端点变化 |
| :--- | :--- |
| `useAccounts.ts` ✅ | `/api/account` → `/api/iam/users`；`pageSize` → `page_size`；状态改 `PUT /api/iam/users/{id}`；新增 `DELETE /iam/users/{id}`（软删）；`POST` 回的是 `{ code, message, id }`（没有 `data`），用 `keyword` 回读新记录 |
| `useTenants.ts` ✅ | `/api/tenant` → `/api/iam/tenants`（只用于把 `tenant_id` 翻成租户名） |
| `useDepartments.ts` ✅（新增） | `GET /api/iam/departments`：建号候选 + 归属过滤，条目自带 `tenant_id` |
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
| C3 | `scripts/lib/bff-harness.mjs` | 无 `asset` / 新代审计路由 | 新增 `GET /asset/device`（snake_case + 明文 `snmp_*_pass`）与 `GET /audit/operation-logs`（空结果 `list: null`），两处都容忍 `/api/v1` 前缀 |
| C3 | `scripts/check-bff.mjs` ⑧ | — | 新增 8 条：「asset 放行并透传」「`snmp_auth_pass` → `***`」「`snmp_priv_pass` → `***`」「其余字段原样」「响应体无明文凭据」「`list: null` → `[]`」「分页字段不受影响」「`system` / `transmission` 在白名单内」 |
| C4a | `scripts/lib/bff-harness.mjs` | 无 `iam/users` / `iam/tenants` / `iam/departments` | 新增三条：列表按 `keyword` / `status` / `department_id` 真过滤、`page_size` 分页、空结果 `list: null`；`POST` 回 `{ code, message, id }`、重复用户名 `200 + 10002`、缺字段 `200 + 40001`；`PUT` / `DELETE /iam/users/{id}`（目标不存在回 `400` +「记录不存在」） |
| C4a | `scripts/check-ui.mjs` ③ | 假上游固定账号集 `ACC-1001…`、等级候选断言 | 用户集换 `u_alice` / `u_bob` / `u_carol`；等级候选用例改为「建号表单只剩部门一个下拉」；建号用例改填 `username` / 显示名 / 邮箱 / 口令，断言 `id` 回读与 `?id` replace |

C1 落码实测（2026-11-04）：`pnpm check:bff` 83/83、`pnpm check:ui` 105/105。
C2 落码实测（2026-11-04，同一上游）：`pnpm check:bff` 74/74、`pnpm check:ui` 103/103
—— 断言总数下降是因为 MFA 绑定（G8）、强制改密（G2）、刷新轮换与 whoami 相关用例随能力退场被删除。
C3 落码实测（2026-11-04）：`pnpm check:bff` 82/82（74 + 8）、`pnpm check:ui` 103/103、`pnpm lint` / `pnpm typecheck` 无输出。
C4a 落码实测（2026-11-04）：`pnpm check:bff` 84/84（82 + 2：`iam/users` 透传 snake_case、空结果归一 `[]`）、`pnpm check:ui` 103/103（等级候选用例改成「建号表单只剩部门一个下拉」，建号用例改为断言 `id` 回读 + `?id` replace，断言总数不变）、`pnpm lint` / `pnpm typecheck` / `pnpm build:server` 无输出。

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

1. `check:bff` 全绿。C1 已覆盖「200 + `code≠0` 不得判 success」与「40101 会话失效」；C2 已覆盖「刷新不轮换」「坏刷新令牌 `200 + 10007` → 401」「改密 `PUT` + snake_case」「登出幂等」「会话不触达上游」；C3 已覆盖「`list: null` → `[]`」「`snmp_auth_pass` / `snmp_priv_pass` → `***` 且明文不出网」「十二命名空间放行」。
2. 真实登录返回 `user.displayName = "平台管理员"`、`tenantId = null`（C2 已实测通过）。
3. `grep -rn "192\.168\.1\.55:1" --exclude-dir=_reference .` 无命中（旧端口前缀已清零）。
4. 四页手测：登录 → `/system/user` 列表与建号 → `/system/policy`（无试算、无 ABAC）→ `/system/log`（无导出、无校验）。

---

## 六、回滚

- 提交独立可回滚：C1 → C2 → C3 → C4 逆序 `git revert`。
- 环境变量层面单独回滚无效（旧代实例已退役），**禁止**把 `.env` 指回旧端口。
- 回滚后必须重跑 `pnpm check:bff`：假上游与 BFF 代码跨提交混搭会出现假绿。


