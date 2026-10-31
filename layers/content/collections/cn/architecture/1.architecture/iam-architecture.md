---
docId: NMCPS-ARCH-003
title: "IAM 架构"
description: "身份与访问控制（arch.iam）的 Tier 1 架构基准：AAA 框架（AuthN/AuthZ/Audit）、五层 IAM 架构、RBAC 与 ABAC 弹性结合、多租户隔离、合规审计，以及 `/api/v1/auth` 对接契约（登录 / 刷新 / 登出 / whoami / MFA / 改密）。本文是 arch.iam 域的唯一权威。"
excerpt: "AAA 框架、五层 IAM 架构、RBAC+ABAC、多租户隔离与 `/api/v1/auth` 对接契约。"
keywords:
  - "iam"
  - "architecture"
  - "身份"
  - "访问控制"
  - "认证"
  - "架构"
tier: 1
authority: normative
scope:
  - arch.iam
status: baseline
version: 0.3.1
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-10-25"
updatedAt: "2026-10-31"
icon: "carbon:user-certification"
tags:
  - "架构"
  - "IAM"
  - "访问控制"
---

# IAM 架构（NMCPS-ARCH-003）

> **本文职责**：`arch.iam` 域的唯一权威，定义系统身份与访问控制（IAM）架构——在正确上下文，让正确实体以正确方式访问正确资源。治理规则见 `NMCPS-GOV-001`，权威清单见 `NMCPS-GOV-003`。
> **目标读者**：架构与实施工程师 / AI 助手。

---

## 一、定位

IAM（Identity and Access Management）是安全基石，本质使命是「四正确」：在正确上下文（context）中，确保正确实体（Subject）以正确方式（Action）访问正确资源（Resource）。

---

## 二、AAA 框架

```text
请求发起者 (Subject) ──► 鉴权 (AuthN) ──► 授权 (AuthZ) ──► 资源操作 (Resource)
                                              │
                                              ▼
                                       安全审计 (Audit)
```

| 环节 | 含义 | 典型手段 |
| :--- | :--- | :--- |
| Subject | 谁发起的请求 | 用户、服务账号、API Key、外部系统 |
| AuthN | 证实「你是你」 | 密码、MFA、OIDC、SSO 令牌 |
| AuthZ | 判断「你能干什么」 | RBAC 角色 / ABAC 属性策略 |
| Audit | 记录「谁何时对什么做了什么」 | 审计日志、SIEM 接入 |

---

## 三、五层 IAM 架构

| 层 | 组成 |
| :--- | :--- |
| 接入层 | OIDC / OAuth 2.0 / SAML 网关，SSO 单点登录入口 |
| 身份管理层 | 用户/组织树（LDAP）、服务账号（ServiceAccount / API Key） |
| 策略决策层 | PDP（策略判定）+ PEP（决策执行/拦截点） |
| 存储层 | 策略库（RBAC 角色 + ABAC 策略文档）、角色/组映射 |
| 审计层 | 审计日志（CloudTrail / SIEM）、异常行为分析 |

---

## 四、RBAC 与 ABAC 弹性结合

| 模型 | 逻辑 | 适用 |
| :--- | :--- | :--- |
| RBAC | User → Role → Permission | 中小系统，简单直观 |
| ABAC | 属性策略：`IF (Subject.attr == Resource.attr AND condition) THEN Allow` | 复杂上下文控制（IP、时间段） |

系统采用**弹性结合**：用户-角色映射走标准 RBAC（`sys_role` + `sys_user_role_relation`），具体权限逻辑解耦至 `sys_policy` 表，以 JSONB 存储 ABAC 策略文档（Effect / Action / Resource / Condition），满足「特定 IP 才能访问」「指定时间段生效」等上下文控制，规避角色爆炸。

---

## 五、多租户隔离

所有业务核心数据表强制绑定 `tenant_id`，天然支持多租户隔离；ID 字段统一 `VARCHAR(64)`（snake_case），适配 Snowflake 64 位大整型，避免 JavaScript 精度丢失。

---

## 六、安全审计

`sys_audit_log` 只增不改，全量捕获 AAA 操作轨迹：Subject、Action、Resource、Result（allow/deny）、Context（IP、UA、时间段），为 SIEM / UEBA 接入提供原始凭据（对齐 ISO/IEC 27001 与 GB/T 安全技术要求）。

---

## 七、`/api/v1/auth` 对接契约（v2）

新后端把认证能力收敛到 `/api/v1/auth/*`：登录同时下发**访问令牌**与**刷新令牌**，身份以 `whoami` 为唯一事实源。落地裁决见 `NMCPS-ADR-0011`（`layers/content/collections/cn/records/adr/adr-0011.md`）；共享类型见 `NMCPS-CONTRACT-001`。

### 7.1 上游端点

| 上游端点 | 方法 | 入参 | 成功 `data` | 失败码 |
| :--- | :--- | :--- | :--- | :--- |
| `/api/v1/auth/login` | POST | `accountName`、`password` 必填；`tenantCode`、`mfaCode` 可选 | `accessToken`、`refreshToken`、`expiresIn`、`sessionId`、`accountCode`、`tenantId`、`accountLevel`、`mfaRequired`、`mustResetPassword` | `20201` 账号或口令错误 |
| `/api/v1/auth/token/refresh` | POST | `refreshToken` | `accessToken`、`refreshToken`、`expiresIn`、`sessionId` | `10201` 未认证；`20205` 会话已失效 |
| `/api/v1/auth/logout` | POST | 空 body（`application/x-www-form-urlencoded`）+ Bearer | `ok` | `10201` 未认证（**不幂等**） |
| `/api/v1/auth/whoami` | GET | Bearer | `accountCode`、`accountName`、`displayName`、`tenantId`、`accountLevel`、`mfaEnabled`、`sessionId` | `10201` 未认证 |
| `/api/v1/auth/mfa/bind` | POST | `mfaType`（1=TOTP，2=生物预留） | `otpauthUrl`（一次性） | `10201` |
| `/api/v1/auth/mfa/confirm` | POST | `mfaCode` | `ok` | `20204` 多因子验证码错误 |
| `/api/v1/auth/password` | POST | `newPassword` 必填；`oldPassword`、`firstReset` 可选 | `ok` | `20201` 老口令错误 |

`accountLevel` 取 `0`（超级管理员，`tenantId` 恒为 0）或 `1`（租户管理员，`tenantId` ≥ 1），与本文第三节的多租户隔离一致。

### 7.2 令牌与会话语义（实测）

1. 访问令牌 TTL 1800 秒；刷新令牌 TTL 7 天（JWT `exp - iat = 604800`）。上游**不返回**刷新令牌 TTL，BFF 只能用配置兜底。
2. **刷新即轮换**：`token/refresh` 成功后 `sessionId` 变更，**旧访问令牌立即失效**（实测旧 AT 调 `whoami` → `401`）。因此只允许「收到 401 后惰性刷新」，且必须单飞（single-flight）；禁止按 `expiresIn` 预刷新。
3. **多会话并存**：同一账号二次登录不会踢掉先前会话（实测首个 AT 仍 200）。
4. **登出不幂等**：同一令牌二次登出返 `401 10201`；BFF 必须吸收该错误并固定返回成功。
5. **错误信封用 `msg`**：失败体为 `{code,msg,traceId}`，`code` 是业务码（> 999）而非 HTTP 状态；`NMCPS-ADR-0007` 的 `ApiResponse` 归一化必须把 `msg` 映射为 `message`，并对 > 599 的 `code` 保留原值。

### 7.3 BFF 暴露面

| BFF 路由 | 上游 | 返回 `data` |
| :--- | :--- | :--- |
| `POST /api/auth/login` | `login` | `{ user, expiresIn, mfaRequired, mustResetPassword, tokens? }`：Web 不返回 `tokens`（改写 `nmcps_at` / `nmcps_rt` 双 cookie），桌面（`x-nmcps-client: desktop`）返回 `tokens` |
| `POST /api/auth/refresh` | `token/refresh` | `{ expiresIn, tokens? }`，同时轮换两枚 cookie |
| `POST /api/auth/logout` | `logout` | `{ ok: true }`，无论上游成败都清 cookie |
| `GET /api/auth/session` | `whoami` | `{ authenticated, user }`；上游 401 → HTTP 200 + `authenticated: false` |
| `POST /api/auth/mfa/bind` · `mfa/confirm` · `password` | 同名端点 | 透传 `{ otpauthUrl }` / `{ ok }` |

- 鉴权注入：Web 由 `nmcps_at` 转 `Authorization: Bearer`；桌面由 `useApi` 从 `tauri-plugin-store` 取令牌显式注入；两种模式在 `server/utils/bff/proxy.ts` 收敛为同一条上游头（显式 `Authorization` 优先于 cookie）。
- 端点归属：`/api/auth/*` 是 BFF 自有路由，**不登记** `GATEWAY_RESOURCES`，因此不与 `server/api/[...slug].ts` 通用代理冲突。
- CSRF：cookie 模式的非安全动词校验 `Origin` —— 同源（`Origin` 主机与请求 `Host` 一致）或命中 `bff.allowedOrigins` 放行，否则 `403 bff_csrf_rejected`；`login` 不带 cookie 可借，跳过校验。
- 入参校验：`login` / `refresh` / `mfa/*` / `password` 先经 zod 校验，缺失即 `400 bff_invalid_body`（上游对缺失入参返 `500 10509`，不透传）。

### 7.4 前端落码约定

- 组合式函数：`useAuth()`（登录 / 登出 / 会话恢复 / 改密 / MFA 绑定与确认）+ `useAuthTokens()`（桌面令牌持久化）；所有 BFF 调用走 `useApi()`。
- `useApi` 命中 401 且有刷新令牌时单飞刷新一次并重放原请求；刷新失败即清会话。`login` 以 `auth: false` 跳过注入与重试；`refresh` 由 `useAuth` 直接 `$fetch`（不经 `useApi`），避免递归刷新。
- 登录页 `/auth/login`（`hide`，不进侧栏）；除落地页与 `/auth/**` 外，所有页面由全局守卫强制登录（见 7.6），页面无需逐条声明中间件。认证动作在源码与路由上统一用 `login`（不写 `sign-in`），裁决见 `NMCPS-ADR-0013`。

### 7.5 自助安全设置页

`/user/security`（侧栏「用户中心 → 安全设置」，`sort: 4`）承载 MFA 绑定与改密两条自助流程，全部经 BFF：

| 区块 | BFF 调用 | 关键交互 |
| :--- | :--- | :--- |
| 多因子认证 | `POST /api/auth/mfa/bind` → `POST /api/auth/mfa/confirm` | 生成一次性 `otpauthUrl` 并就地展示密钥（`secret` 参数）+ 复制；输入 6 位动态口令确认后**强制 `fetchSession(true)`**，让 `mfaEnabled` 立即反映 |
| 修改口令 | `POST /api/auth/password` | 旧口令 + 新口令 + 确认口令；成功后只提示，不登出（上游未承诺改密作废旧令牌，见 `password.post.ts` 注释） |

- **一次性凭证不落库、不回显**：`otpauthUrl` 只存在页面内存里，关闭/刷新即丢；重新绑定必然重置 TOTP 密钥，需二次确认。
- **不引入二维码依赖**：项目依赖清单里没有 QR 库，页面改为「复制 URI + 复制密钥 + 引导手动录入」，避免为一个可选交互新增依赖。
- **登录由全局守卫接管**：本页不再声明按需中间件，未登录由 `/api/auth/session` 判定后直接跳登录页（见 7.6）。页面内保留引导态，只作为兜底：会话在停留期间失效、桌面端令牌被清空时，页面明确提示而不是留白。
- 错误码映射复用登录页口径：`20201` 旧口令错误、`20204` 动态口令错误、`10201` 会话失效（提示重新登录）。

### 7.6 登录守卫（全局强制）

系统不提供匿名浏览：除公开路径外，未登录访问一律送回登录页。

- 实现：`app/middleware/auth.global.ts`（全局路由中间件）；白名单仅 `/`（下载落地页）与 `/auth/**`（登录页）。
- 未登录：`navigateTo('/auth/login?redirect=<完整路径>')`；登录成功后按 `redirect` 回跳，缺省 `/dashboard/overview`。
- 已登录访问 `/auth/login`：直接回跳（`redirect` 优先，其次 `/dashboard/overview`），避免二次登录。
- 判据唯一：只认 `GET /api/auth/session`（`fetchSession()` 带缓存，登录后用 `force` 刷新）；守卫不读 cookie、不解析令牌。
- SSR 不需要特判：应用是 SPA（`nuxt.config.ts` 的 `ssr: false`），守卫恒在客户端执行；首帧不渲染业务数据，会话回来后立即重定向。
- 桌面静态包：同样走客户端守卫，`useAuthTokens()` 无令牌即未登录。
- 鉴权关口不变：BFF 仍是唯一鉴权点（`401 bff_auth_required`），守卫只管导航。

### 7.7 演示种子账号与登录页预填

本仓库是演示程序，登录页要开箱可登录：默认预填种子账号，并可一键切换演示身份。

- 单一事实源：`shared/constants/demoAccounts.ts` 的 `DEMO_ACCOUNTS`（超级管理员 / 租户管理员）；页面只消费，不在 SFC 里硬编码账号口令。
- 预填范围：`accountName` / `password` / `tenantCode` 三项随身份整体回填，其余字段（如 `mfaCode`）不动；字段保持可编辑。
- 身份口径：超级管理员 `tenantId` 恒为 `0`，`tenantCode` 留空；租户管理员带租户编码 —— 与第五节多租户隔离、`AUTH_ACCOUNT_LEVEL`（`0` / `1`）一致。
- 演示专用：种子口令只用于演示与录屏；上线前须核对与上游 IAM 种子脚本一致，或移除预填（裁决见 `NMCPS-ADR-0013`）。
- 种子事实（需求方给定 + 2026-10-31 对 `http://192.168.1.55:10000/api/v1` 实测）：登录 API = `POST /api/v1/auth/login`；超级管理员 `admin` / `Admin@123456`（`accountLevel: 0`、`tenantId: 0`）；租户管理员 `tenantadmin` / `Tenant@123456`（`accountLevel: 1`、`tenantId: 1`）。种子不含租户编码，`tenantCode` 留空即可登录（内置默认租户 code 为 `default`，仅显式多租户时填）。
- 登录前提：必须配置 `NUXT_BFF_UPSTREAM_BASE`（本地 `.env`，不入库）。上游为空时 `/api/auth/*` 一律返回 `503 bff_upstream_missing`，任何账号都登不上 —— 预填再好也补不了上游缺失。
- 流程不变：预填不绕过任何环节 —— 仍走 `POST /api/auth/login`，守卫判据仍是 `GET /api/auth/session`（见 7.6）。

---

## 八、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化 IAM 架构（AAA 框架、五层架构、RBAC+ABAC、多租户、审计）。 |
| 2026-10-31 | 0.2.0 | 新增第七节：`/api/v1/auth` 对接契约（端点表、令牌轮换语义、BFF 暴露面、前端落码约定）。 |
| 2026-10-31 | 0.2.1 | 新增 7.5：`/user/security` 自助安全设置页（MFA 绑定 / 改密）的交互与凭证处置约定。 |
| 2026-10-31 | 0.2.2 | 新增 7.6：全局登录守卫（除落地页与 `/auth/**` 外强制登录），明确 SPA 下的客户端判定与回跳规则。 |
| 2026-10-31 | 0.3.0 | 登录页统一为 `/auth/login`（文件名 / 路由 / i18n 键由 `sign-in` 改为 `login`）；新增 7.7 演示种子账号与登录页预填。 |
| 2026-10-31 | 0.3.1 | 7.7 按实测补全种子事实（`admin` / `tenantadmin`，`tenantCode` 留空即可登录）与登录前提（`NUXT_BFF_UPSTREAM_BASE` 未配置时 `/api/auth/*` 返回 503）。 |
