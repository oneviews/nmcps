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
version: 0.5.0
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
| `/api/v1/auth/login` | POST | `accountName`、`password` 必填；`tenantCode`、`mfaCode` 可选 | `accessToken`、`refreshToken`、`expiresIn`、`sessionId`、`accountCode`、`tenantId`、`accountLevel`、`mfaRequired`、`mustResetPassword` | `20201` 账号或口令错误（含已禁用账号）；`20203` 需要多因子验证码；`20204` 多因子验证码错误 |
| `/api/v1/auth/token/refresh` | POST | `refreshToken` | `accessToken`、`refreshToken`、`expiresIn`、`sessionId` | `10201` 未认证；`20205` 会话已失效 |
| `/api/v1/auth/logout` | POST | 空 body（`application/x-www-form-urlencoded`）+ Bearer | `ok` | `10201` 未认证（**不幂等**） |
| `/api/v1/auth/whoami` | GET | Bearer | `accountCode`、`accountName`、`displayName`、`tenantId`、`accountLevel`、`mfaEnabled`、`sessionId` | `10201` 未认证 |
| `/api/v1/auth/mfa/bind` | POST | `mfaType`（1=TOTP 且为缺省值，2=生物预留；`0` 未登记却可用，见 7.2 第 8 条） | `otpauthUrl`（一次性） | `10201`；`20109` 未实现的因子类型 |
| `/api/v1/auth/mfa/confirm` | POST | `mfaCode` | `ok` | `20204` 多因子验证码错误 |
| `/api/v1/auth/password` | POST | `newPassword` 必填；`oldPassword`、`firstReset` 可选 | `ok` | `20201` 老口令错误 |

`accountLevel` 取 `0`（超级管理员，`tenantId` 恒为 0）或 `1`（租户管理员，`tenantId` ≥ 1），与本文第三节的多租户隔离一致。

### 7.2 令牌与会话语义（实测）

1. 访问令牌 TTL 1800 秒；刷新令牌 TTL 7 天（JWT `exp - iat = 604800`）。上游**不返回**刷新令牌 TTL，BFF 只能用配置兜底。
2. **刷新即轮换**：`token/refresh` 成功后 `sessionId` 变更，**旧访问令牌立即失效**（实测旧 AT 调 `whoami` → `401`）。因此只允许「收到 401 后惰性刷新」，且必须单飞（single-flight）；禁止按 `expiresIn` 预刷新。
3. **多会话并存**：同一账号二次登录不会踢掉先前会话（实测首个 AT 仍 200）。
4. **登出不幂等**：同一令牌二次登出返 `401 10201`；BFF 必须吸收该错误并固定返回成功。
5. **错误信封用 `msg`**：失败体为 `{code,msg,traceId}`，`code` 是业务码（> 999）而非 HTTP 状态；`NMCPS-ADR-0007` 的 `ApiResponse` 归一化必须把 `msg` 映射为 `message`，并对 > 599 的 `code` 保留原值。
6. **缺入参一律 `500 10509`**（2026-10-31 实测 `login {}`、`login` 缺 `password`、`refresh {}`、`password {}`、`password` 缺 `newPassword`、`mfa/confirm {}`）：上游不区分「客户端填错」与「服务崩溃」。BFF 的 zod 前置校验因此是硬要求，不是洁癖（见 7.3）。
7. **并发刷新不互斥**：同一 RT 三路并发请求 `token/refresh` 全部 200，各自产出**不同** `sessionId`，三把访问令牌均可 `whoami`；注销其中一条不影响其余。只有串行复用才 `401 20205`。轮换是「先查后写」而非原子消费 —— 后果是会话分裂与 RT 重放窗口。前端仍必须单飞：单飞是省事与减少孤儿会话的工程手段，**不要**把「并发也能成功」当契约依赖。
8. **`mfaType` 缺省即 TOTP**：`{}`、`{mfaType:0}`、`{mfaType:1}` 结果相同，仅 `99` 报 `400 20109`。绑定是两阶段的，未 `confirm` 前 `mfaEnabled` 保持 false、登录不索要动态口令。
9. **`Content-Type` 只认 JSON**：`application/x-www-form-urlencoded` 打 `login` → `500 10509`；而 `logout` 无 body 即 200。BFF 侧统一只收 JSON 并在解析失败时回 `400 bff_invalid_body`。
10. **MFA 登录分支是 `401 20203`**，不是「200 + `mfaRequired: true`」：MFA 已启用的账号不带 `mfaCode` → `401 20203 需要多因子验证码`（`data` 为空）；带错误码 → `401 20204`；带正确 TOTP → 200。上游从不返回 `mfaRequired` 字段，BFF 的 `login.post.ts` 因此恒为 false。前端按 `20203` 展开动态口令输入框（缺口已于 2026-10-31 修复，见 7.8 第 7 项）。
11. **已禁用账号与口令错误同码**：`PUT /account/{code}/status` 置 `status: 2` 后登录 → `401 20201 账号或口令错误`，不区分「已禁用」。前端无法据此提示「账号停用」。
12. **改密不吊销旧令牌**：`password` 成功后旧访问令牌仍可 `whoami` 200 —— 7.5「改密后只提示、不登出」的约定由此得到实证，也意味着令牌泄露不能靠改密止损。
13. **`firstReset: true` 会跳过旧口令校验**（2026-10-31 实测）：body 只带 `newPassword` 即 `200`，`oldPassword` 可缺省。该字段本意是「首次登录强制改密」，不应成为免旧口令的后门 —— 会话被劫持即可改密夺号。BFF 的 `authPasswordSchema` 仍要求 `oldPassword`，前端不要因为该字段存在就放开必填。
14. **强制改密是纯前端约定**：`mustResetPassword: true` 的账号在未改密时 `whoami` 仍 200、其他接口照常放行；改密后标志清除（再登录 `mustResetPassword: false`）。正因上游不拦，客户端必须自己执行：`POST /api/auth/login` 返回该标志时，登录页直接把人送到专用改密页 `/auth/change-password`（并带上原始 `redirect`），改密成功后**强制登出、用新口令重登**，不再按 `redirect` 跳看板 —— 否则初始口令可以一直用下去（2026-10-31 修复，见 7.8 第 9 项）。该页提交改密时**不带** `firstReset`：该字段会跳过旧口令校验（第 13 条 / `NMCPS-REC-001` UP-AUTH-02），用户刚用旧口令登录过，让他再填一次即可。弱口令与重复口令的策略在上游：复杂度不足 `400 20101`，与近期历史重复 `400 20302`；改密立即生效（0/200/1000/3000ms 复测旧口令均 `401 20201`），无宽限窗口。

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
- 入参校验：`login` / `refresh` / `mfa/*` / `password` 先经 zod 校验，缺失即 `400 bff_invalid_body`（上游对缺失入参返 `500 10509`，不透传）；非 JSON 报文（如 `form-urlencoded`）同样 `400 bff_invalid_body`，因为上游不校验 `Content-Type`（见 7.2 第 9 条）。

### 7.4 前端落码约定

- 组合式函数：`useAuth()`（登录 / 登出 / 会话恢复 / 改密 / MFA 绑定与确认）+ `useAuthTokens()`（桌面令牌持久化）；所有 BFF 调用走 `useApi()`。
- `useApi` 命中 401 且有刷新令牌时单飞刷新一次并重放原请求；刷新失败即清会话。`login` 以 `auth: false` 跳过注入与重试；`refresh` 由 `useAuth` 直接 `$fetch`（不经 `useApi`），避免递归刷新。
- 登录页 `/auth/login`（`hide`，不进侧栏）；除落地页与 `/auth/**` 外，所有页面由全局守卫强制登录（见 7.6），页面无需逐条声明中间件。认证动作在源码与路由上统一用 `login`（不写 `sign-in`），裁决见 `NMCPS-ADR-0013`。
- 强制改密页 `/auth/change-password`（`hide` + `layout: false`，与登录页同壳）：一屏给齐「当前密码 / 新密码 / 确认新密码」，提交后提示并强制重登。它落在 `/auth/**` 白名单里，全局守卫不判登录态，所以页面自己在 `onMounted` 用 `fetchSession(true)` 兜底，未登录即带着 `redirect` 回登录页。**命名用 `change-password` 而不是 `reset-password`**：`reset` 在行业里专指「忘记口令」的匿名令牌流程（Auth0 `password-reset`、Keycloak `reset-credentials`、Django `reset/<uid>/<token>/`），上游接口设计表也把 `ResetPassword` 定为管理员重置、`ChangePassword` 定为自助改密；本页是已认证 + 需旧口令的**自助改密**，与 `useAuth().changePassword()` / `POST /api/auth/password` 取同一个词。裁决与备选见 `NMCPS-ADR-0014`（`layers/content/collections/cn/records/adr/adr-0014.md`），`reset` 一词保留给未来的忘记口令流程。页面另带一个隐藏的 `<input autocomplete="username">`（只读、`tabindex="-1"`、`aria-hidden`，值取会话里的 `accountName`）：密码管理器要靠表单里的「用户名」把新口令记到对应账号下，缺了它会新建一条永远登不进去的重复记录；`check:ui` 断言它恰好一个、不可见、且值等于当前账号。

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
- 两条改密路径要分清：本页是**普通自助改密**（改完只提示、不登出）；`mustResetPassword` 的账号走 `/auth/change-password`（改完强制重登，见 7.2 第 14 条 / 7.4）。

### 7.6 登录守卫（全局强制）

系统不提供匿名浏览：除公开路径外，未登录访问一律送回登录页。

- 实现：`app/middleware/auth.global.ts`（全局路由中间件）；白名单仅 `/`（下载落地页）与 `/auth/**`（登录页）。
- 未登录：`navigateTo('/auth/login?redirect=<完整路径>')`；登录成功后按 `redirect` 回跳，缺省 `/dashboard/overview`。
- 已登录访问 `/auth/login`：直接回跳（`redirect` 优先，其次 `/dashboard/overview`），避免二次登录。
- 白名单内的非登录页（如 `/auth/change-password`）自己兜底：页面挂载时用 `fetchSession(true)` 判态，未登录即带 `redirect` 回登录页。`check:ui` 有专门用例锁这条（外部模式也跑）。
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
- 上游探针：登录页挂载时由 `useBffUpstream()` 打 `GET /ready`（显式 `retry: false` —— 503 在 ofetch 默认重试列表内，否则一次进页会打两次），只在 BFF 明确回 `upstream.configured === false` 时提示缺失；探针失败（网络中断 / 桌面端无同源 Nitro）不下结论，交给登录动作报错。
- 探针结论缓存：`sessionStorage`（键 `bff.upstreamProbe`），「已配置」30s、「未配置」5s（待修状态需尽快自愈）；提示内附「重新检测」按钮，绕过缓存立即重探，配好 `.env` 重启 BFF 后无需等待 TTL。
- CI 形态：`check:ui` 自建假上游 + 构建产物（随机端口）。不要用 `CHECK_UI_BASE_URL` 指向没有 `NUXT_BFF_UPSTREAM_BASE` 的实例，否则登录与「上游就绪」用例必然失败（2026-10-31 CI 实证）；脚本已在该模式下先探 `/ready`，未配置即报错退出。自建模式 64 项、外部模式 49 项：自建多 16 项（MFA 动态口令 2、强制改密 13、上游掉线 1，前两者依赖假上游的 `mfa-user` / `reset-user` 与 `__control/down`），外部模式多前置校验 1 项（登录与自检用例在两种模式下都在跑，含「未登录直进 `/auth/change-password`」这条守卫）。假上游的口令是**按账号可变**的（改密真的落库、`whoami` 按令牌回账号、改密后清 `mustResetPassword`），否则「新口令重登不再被弹回」「旧口令 `401 20201`」这两条断言写不出来。
- 词汇表单一事实源：`shared/constants/upstreamReasons.ts` 的 `UPSTREAM_REASONS`（`/ready` 的 `upstream.reason`）与 `BFF_UPSTREAM_MESSAGES`（API 层 `bff_upstream_*` message），server 与前端一律引用常量。自查脚本是纯 node ESM，不 import 该文件，而是按**线上字符串**断言 —— 改取值会让契约用例变红，这本身就是防漂移守卫。
- 复用口径：`/user/security` 的绑定 MFA / 改密与登录页共用 `upstreamHintKey()`（`app/utils/apiError.ts`）：`bff_upstream_missing` → 配 `.env` 指引，`bff_upstream_unreachable` / `bff_upstream_timeout` → 上游不可达指引（`auth.bffUpstreamUnavailable`），都不再回落原始 message，避免用户把运维问题读成「口令错误」。
- 掉线演练：假上游带控制端点 `POST /__control/down|up|state`；`down` 后除控制端点外的请求直接销毁 socket，BFF 侧表现为 502 `bff_upstream_unreachable`，因此「已登录 → 上游掉线 → 改密」这种只能运行中构造的场景也进了自查。
- 流程不变：预填不绕过任何环节 —— 仍走 `POST /api/auth/login`，守卫判据仍是 `GET /api/auth/session`（见 7.6）。

### 7.8 上游缺陷与两端漂移登记（2026-10-31 实测）

`/api/v1/auth/*` 能力面完整：7 个端点全部可达，未登记路径（`/auth/session`、`/auth/captcha`、`/auth/mfa/disable` 等）一律 `404`，无隐藏能力；BFF 对真实上游端到端 10/10 通过。以下是 5 项上游缺陷与 4 项**仓库内漂移**（第 6–9 项已修复，仍留在表里防回退），按影响排序。修复前不要把它们当契约依赖。

| # | 现象 | 实测证据 | 影响 | 归属 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 缺入参返回 `500 10509` 而非 `400 10101` | `login {}` / `login` 缺 `password` / `refresh {}` / `password {}` / 缺 `newPassword` / `mfa/confirm {}` 均为 500 | 客户端填错被报成服务崩溃；BFF 已用 zod 全挡 | 上游 |
| 2 | 刷新轮换不是原子消费 | 同一 RT 三路并发均 200，三个 `sessionId` 互异、三把 AT 均可用，注销其一不影响余下 | 会话分裂 + RT 重放窗口（令牌被窃时单次保护被绕过） | 上游 |
| 3 | `Content-Type` 不校验 | `form-urlencoded` 打 `login` → `500 10509`；`logout` 无 body 也 200 | 契约不清；BFF 统一只收 JSON | 上游 |
| 4 | `OPTIONS /api/v1/auth` 返回 `404` | 对比 `/api/v1/account` → `405 + Allow` | 无统一预检与能力发现；同源部署下不触发 | 上游 |
| 5 | `mfaType` 缺省即 TOTP、`0` 未登记却可用 | `{}` / `{mfaType:0}` / `{mfaType:1}` 同效（都返回 `otpauthUrl`）；`9` / `99` → `400 20109` | 客户端漏字段会静默绑定；两阶段绑定，未 `confirm` 时 `mfaEnabled` 不变 | 上游 |
| 6 | 假上游的 MFA 拒绝语义与真实相反 | `scripts/lib/bff-harness.mjs` 回 `400 20205 mfa_required`；真实回 `401 20203 需要多因子验证码` 且 `data` 为空 | 自查长期为绿，掩盖了下条前端缺口 | 仓库（假上游） |
| 7 | 登录页只认 `20205` | `app/pages/auth/login.vue` 的 `submit` 与 `describeError` 都只分支 `20205` | **MFA 已启用的账号无法登录**：只看到「需要多因子验证码」文案，不出现动态口令输入框 | 仓库（前端） |
| 8 | 假上游的刷新是单次消费 | `usedRefresh.add` 后第二路必 `401 10201`，Node 单线程下并发也如此 | `check:bff` 断言的是真实上游不具备的语义 | 仓库（假上游） |
| 9 | 登录页的 `mustResetPassword` 分支是死代码 | `mustResetPassword.value` 设完立即 `navigateTo(redirect)`，警告 `v-if` 永远来不及渲染；上游又不拦接口 | **强制改密等于没生效**：初始口令可长期使用 | 仓库（前端） |

第 6、7、8 项已于 2026-10-31 同批修复：假上游 MFA 分支改为 `401 20203 需要多因子验证码`，登录页改认 `20203`，假上游刷新新增 `POST /__control/auth-concurrency?allow=1`「并发窗口」开关，并由 `check:bff` 新增用例锁定「并发两路均 200」的真实语义（上游修成原子消费后该用例会变红，提示回来同步本表）。三项必须一起改：只改前端而不改假上游，自查会继续按 `20205` 断言；只改假上游而不改前端，用例会立刻变红——这正是该关卡该有的样子。

第 9 项的修复分两步收口：先修死代码（登录成功且 `mustResetPassword === true` 时不再按 `redirect` 跳看板），再补齐缺口本身 —— 新增专用改密页 `/auth/change-password`（一屏三字段，改完强制重登），登录页只负责带 `redirect` 送人过去。假上游新增 `reset-user` 账号返回该标志；`check:ui` 用十三条用例锁住（落点 / 表单齐备 / 隐藏 `autocomplete="username"` 归属当前账号 / 三个内联校验态 / 旧口令错点名 `20201` / 强制重登 / 报文带旧口令且不带 `firstReset` / 校验态不发请求 / 重登提示 / 新口令重登不再被弹回 / 旧口令改后被拒）+ 一条守卫用例（未登录直进回登录页并带回跳），`check:bff` 加一条「标志原样透传」用例防止 BFF 把它吞掉。三条内联校验（新旧相同、两次不一致、不足 8 位）另配「报文数必须为 2」的交叉断言：校验若被绕开，请求数会变成 5，用例立刻变红。

原先的空白项已在本轮闭环（测试账号 `AUTOTEST-*` 用完即置 `status: 2` 禁用）：改密成功路径 `200`、随后旧口令 `401 20201`、**旧访问令牌仍 `200`**；`mfa/bind` + 真实 TOTP 计算后 `mfa/confirm` `200`、`whoami.mfaEnabled` 转 true；MFA 账号带正确 `mfaCode` 登录 `200`；禁用后登录 `20201`；`mustResetPassword: true` 建号 → 登录带该标志 → `firstReset` 改密后标志清除；弱口令 `20101` 与近三次重复 `20302` 两条策略。仍未验证：AT 30 分钟 / RT 7 天自然过期、浏览器多标签页并发刷新的实际表现。缺陷与复现方法统一登记在 `NMCPS-REC-001`（`layers/content/collections/cn/records/defects/auth-upstream-defects.md`）。

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
| 2026-10-31 | 0.3.2 | 7.7 补登录页上游探针（`useBffUpstream()` + `/ready`）、探针缓存 TTL（已配置 30s / 未配置 5s）与「重新检测」，并记录 CI 不得把 `CHECK_UI_BASE_URL` 指向无上游实例。 |
| 2026-10-31 | 0.3.3 | 7.7 记 `check:ui` 外部模式的 `/ready` 前置校验（未配上游即报错退出，48 项）与 `/user/security` 复用同一条 503 修复指引。 |
| 2026-10-31 | 0.3.4 | 7.7 抽出 `shared/constants/upstreamReasons.ts`（`/ready` reason 与 `bff_upstream_*` message），上游侧失败统一走 `upstreamHintKey()`（掉线/超时也给指引），假上游加 `/__control/down|up` 支撑「运行中掉线」自查（48 项）。 |
| 2026-10-31 | 0.3.5 | 7.1 补 `20203` / `20204` / 禁用同码；7.2 按实测补 6–12 条（缺参 `500 10509`、并发刷新不互斥、`mfaType` 缺省、只收 JSON、MFA 登录是 `401 20203`、禁用与口令错误同码、改密不吊销旧令牌）；新增 7.8 上游缺陷与两端漂移登记（5 项上游 + 3 项仓库内漂移）。 |
| 2026-10-31 | 0.3.7 | 7.2 第 14 条补客户端执行口径（`mustResetPassword` → 跳 `/user/security` + 常驻 toast）；7.7 计数改为自建 52 / 外部 50；7.8 新增第 9 项（登录页强制改密分支曾是死代码，已修并由 `check:ui` 两条用例锁住），第 5 项 `mfaType` 证据改为 `9` / `99` → `400 20109`；`check:bff` 增 `20204` 与 `mustResetPassword` 透传用例（81 项）。 |
| 2026-10-31 | 0.3.8 | 强制改密落地专用页：7.2 第 14 条改为「跳 `/auth/reset-password` + 改完强制重登 + 提交不带 `firstReset`」（对齐第 13 条 UP-AUTH-02）；7.4 补该页的壳与自判登录约定；7.7 计数改为自建 55 / 外部 48；7.8 第 9 项补「先修死代码、再补专用表单」两步收口与 5 条用例。 |
| 2026-10-31 | 0.3.9 | 改密页把表单校验与错误映射纳入守卫：`check:ui` 7.8 第 9 项由 5 条扩到 10 条（新增新旧相同 / 两次不一致 / 不足 8 位三个内联校验态、旧口令错点名「当前密码不正确」、以及「校验态不发请求」的报文数交叉断言），另加一条守卫用例（未登录直进 `/auth/reset-password` 回登录页并带回跳）；7.7 计数改为自建 61 / 外部 49。 |
| 2026-10-31 | 0.4.0 | 改密页更名 `/auth/reset-password` → `/auth/change-password`（i18n 21 键 `auth.reset*` → `auth.changePassword*`，文案不变；自查条数不变，自建 61 / 外部 49）：`reset` 在行业与上游设计里都指「忘记口令」的匿名令牌流程，本页是需旧口令的自助改密，与 `useAuth().changePassword()` 取同词；裁决见 `NMCPS-ADR-0014`（`layers/content/collections/cn/records/adr/adr-0014.md`），7.4 补命名理由。 |
| 2026-10-31 | 0.5.0 | 改密页补密码管理器语义与闭环断言：页面加隐藏 `<input autocomplete="username">`（值取会话账号）；假上游口令改为**按账号可变**（改密真的落库、`whoami` 按令牌回账号、改密后清 `mustResetPassword`），`check:ui` 补三条用例（新口令重登不再被弹回 / 改后旧口令被拒 `401 20201` / 隐藏用户名归属当前账号），7.7 计数改为自建 64 / 外部 49；`check:bff` 的第二次改密改用上一次设的新口令。 |
