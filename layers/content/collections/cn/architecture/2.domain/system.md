---
docId: NMCPS-DESIGN-005
title: "系统管理领域基准"
description: "系统管理域（domain.system）的 Tier 2 设计基准：系统日志（操作日志 / 安全日志 / 归档记录三族，含归档执行）、策略管理、用户与权限管理，含 /system/log 与 /system/user 的端点、字段、权限矩阵与错误码口径。本文是 domain.system 域的唯一权威。"
excerpt: "系统日志（审计）、策略、用户与权限管理的领域基准（含落码口径）。"
keywords:
  - "system"
  - "系统管理"
  - "权限"
  - "领域基准"
tier: 2
authority: normative
scope:
  - domain.system
status: baseline
version: 0.8.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-003
createdAt: "2026-10-25"
updatedAt: "2026-11-04"
icon: "carbon:settings"
tags:
  - "领域基准"
  - "系统管理"
  - "权限"
---

# 系统管理领域基准（NMCPS-DESIGN-005）

> **本文职责**：`domain.system` 域的唯一权威，定义系统管理——系统日志、策略管理、用户与权限管理。身份与访问控制的架构基准见 `NMCPS-ARCH-003`。
> **目标读者**：实施工程师 / AI 助手。
> **代际提示（2026-11-04）**：后端已整体切换至 `http://192.168.1.55:8888/api/v1` 的 NMS 统一网关。**第六节（0.6.0，`iam/users`）、第七 / 八节（0.8.0，`iam/{policies,roles,role-policies,subject-roles}`）、第九节（0.7.0，`audit/*` 三族）均已按新代重写**；旧代结论只保留在置 `superseded` 的 `NMCPS-REC-001`～`004` 里作历史。字段映射与能力缺口见 `NMCPS-ADR-0018`。

---

## 一、定位

系统管理是网络管理系统的「治理面」：管理系统的运行日志、全局策略、用户账号与权限分配，是 IAM 架构（见 `NMCPS-ARCH-003`）的落地界面。

---

## 二、功能范围

| 子页面 | 功能 |
| :--- | :--- |
| log | 审计日志：操作日志 / 安全日志 / 归档记录三族列表与详情 + 归档执行（`/system/log`） |
| policy | 全局策略管理 |
| user | 用户账号管理 |
| permission | 权限分配（角色/策略绑定） |
| download | 客户端安装包下载中心（按 UA 检测平台，链接直指 GitHub Release，不代理二进制） |

---

## 三、关键数据实体

| 实体 | 说明 |
| :--- | :--- |
| 日志（Audit Log） | 只增不改的操作审计轨迹 |
| 策略（Policy） | ABAC 策略文档 |
| 用户（User） | 账号与角色绑定 |
| 权限（Permission） | 角色 → 权限映射 |

---

## 四、领域边界与依赖

- **上游依赖**：IAM 架构（RBAC + ABAC、多租户、审计，见 `NMCPS-ARCH-003`）。
- **消费方**：全系统（统一鉴权）。
- **不承载**：底层认证协议实现（属 IAM `NMCPS-ARCH-003`）。

---

## 五、演进路线

1. 用户与角色管理（RBAC）。
2. 策略管理（ABAC 策略文档编辑）。
3. 审计日志查询与 SIEM 接入。

---

## 六、`/system/user` 用户管理（落码基准）

> 口径来源：**2026-11-04** 对 `http://192.168.1.55:8888/api/v1` 的实调（`/swagger/openapi.json` + 真实响应）。
> 契约映射见 `NMCPS-ADR-0018` §4.2；本节只写「页面能依赖什么」。
> 旧代（`/account`、`/tenant`）的字段口径与缺陷记录仍在 `NMCPS-REC-002`，但作为**历史**保留（已标 `superseded`）。

### 6.1 数据源与端点

| 能力 | BFF 路径 | 上游 | 说明 |
| :--- | :--- | :--- | :--- |
| 列表 | `GET /api/iam/users` | `GET /api/v1/iam/users` | `page` / `page_size` / `keyword` / `status` / `department_id` |
| 建号 | `POST /api/iam/users` | 同 | `username` / `password` 必填；`email` / `display_name` / `department_id` 可选。**没有 `tenant_id`** |
| 详情 | `GET /api/iam/users/{id}` | 同 | 实测存在；页面仍只读列表（列表已含全部展示字段） |
| 改资料 / 改状态 | `PUT /api/iam/users/{id}` | 同 | body 里 `id` 也是必填；可写 `department_id` / `email` / `phone` / `display_name` / `status` / `mfa_enabled` |
| 删号 | `DELETE /api/iam/users/{id}` | 同 | 软删（`deleted_at`），列表默认不再返回 |
| 租户列表 | `GET /api/iam/tenants` | 同 | 只用于把行上的 `tenant_id` 翻成租户名 |
| 部门列表 | `GET /api/iam/departments` | 同 | 建号候选 + 归属过滤；条目自带 `tenant_id` |

- 路径段 `{id}` 是用户主键（`u_…`），不是旧代的 `accountCode`（`ACC…`）。
- 列表空结果是 `list: null`：BFF 在出口归一为 `[]`（`NMCPS-ADR-0018` D6），页面可以直接 `.map`。
- BFF 白名单需含 `iam`（`shared/types/api.ts` 的 `GATEWAY_RESOURCES`），否则一律 `404 bff_resource_not_allowed`。

### 6.2 字段口径

- `username`：唯一，重复建号回 `10002 用户已存在`；建号后不可改（`PUT` 请求体里没有它）。
- `status`：字符串枚举 `active` / `disabled` / `locked`（`chk_sys_user_status`）。页面只写 `active` ↔ `disabled`；`locked` 由上游在失败登录时置位。
- `tenant_id` / `department_id`：列表**自带**这两个字段，未分配时为 `null`；部门自带租户，所以页面用「选部门」表达归属。旧代缺口 `UP-ACC-05`（列表缺租户归属）在此闭环。
- `mfa_enabled`：只读展示（缺口 G8：新代没有 MFA 绑定端点，不提供绑定流程）。
- `created_at` / `updated_at`：RFC3339 带偏移（`2026-11-03T18:59:06+08:00`）→ 原样展示，不做时区换算。
- **没有 `accountLevel`**（缺口 G1）：等级模型整体退役，页面不展示、不筛选、也不在请求体里出现该字段。
- 口令策略：实测「密码长度应为 6-128 字符」（`40001`），旧代的复杂度 / 历史重复校验不再适用。

### 6.3 页面收敛（不是安全边界）

| 动作 | 平台级账号（会话 `tenant_id: null`） | 租户级账号（会话带 `tenant_id`） |
| :--- | :--- | :--- |
| 列表范围 | 上游返回的全平台 | 上游限定在可见范围 |
| 筛选 | `keyword` / `status` / `department_id` | 同（受范围约束） |
| 建号 | `username` + `password` + 可选部门 | 同 |
| 改资料 / 改状态 | 任意用户（本人除外） | 范围内用户（本人除外） |
| 删号 | 任意用户（本人除外） | 范围内用户（本人除外） |

1. 归属维度只有「部门」一个下拉：新代 `POST /iam/users` 没有 `tenant_id`，多给一个租户下拉只会产生传不上去的字段。
2. 本人账号的「改状态 / 删号」两个入口直接禁用，避免自锁 / 自删。
3. 删号走独立确认弹窗（软删不可从本页撤销），与「禁用」分开讲，不再把禁用当删号的替代。
4. 角色绑定（`subject-roles`）本页仍不提供：读写对称的入口需要与 `/system/permission` 一起设计（C4c）。
5. `isSuperAdmin` 目前是**近似**：会话 `tenant_id === null` 即平台级。按角色（`platform_admin`）判定需要新 ADR，见缺口 G1。
6. 上游仍是唯一鉴权点：BFF 只做白名单透传，客户端收敛不改变后端判定结果。

### 6.4 错误码 → 页面处置

| 码 | 上游含义 | 页面处置 |
| :--- | :--- | :--- |
| `10002` | 用户已存在 | `username` 字段内联错误 |
| `40001` | 字段校验失败（`message` 点名具体字段，如「密码长度应为 6-128 字符」） | 按 `message` 关键字内联到 `username` / `password`，其余整体提示并显示上游原文 |
| `10003` | 账号或密码错误（改密旧口令错同码） | 通用失败提示 |
| `10007` / `40101` / `401` | 会话失效 | 交给 `useApi` 的单飞刷新；仍失败则提示重新登录 |
| `10301` / `404` | 目标不存在 / 跨范围 | 「用户不存在或无权限」 |
| `10201` / `403` | 域拒绝 | 「当前身份无此权限」 |
| `10509` / `500` | 上游内部错误 | 通用失败提示 + 检查必填项 |
| `0` | 网络层失败（非信封） | 网络异常提示 |

上游未配置 / 掉线 / 超时沿用 `upstreamHintKey()` 的运维指引（与登录页、`/user/security` 同一套文案）。

### 6.5 缺口现状

- **已闭环**：`UP-ACC-04`（无改资料 / 无删号端点 → `PUT` + `DELETE`）、`UP-ACC-05`（列表缺租户归属 → 自带 `tenant_id` / `department_id`）。
- **仍开放**：`G1`（无 `accountLevel`，角色化判定待新 ADR）、`G2`（无 `mustResetPassword`）、`G8`（无 MFA 绑定端点）。
- 旧代 `UP-ACC-01`～`UP-ACC-08` 作为历史记录保留在 `NMCPS-REC-002`（`status: superseded`），不再作为本页的契约依据。

---

## 七、`/system/policy` 策略管理（落码基准）

> 口径来源：2026-11-04 对 `http://192.168.1.55:8888/api/v1` 的实调（平台超管 / 租户管理员 / 零角色账号三种会话 + swagger 比对）。与契约不符处登记在 `NMCPS-REC-005`（`layers/content/collections/cn/records/defects/iam-policy-upstream-defects.md`），本节只写「页面能依赖什么」。页面定位与工具栏口径见 `NMCPS-ADR-0017`。

### 7.1 数据源与端点

| 能力 | BFF 路径 | 上游 | 说明 |
| :--- | :--- | :--- | :--- |
| 策略列表 | `GET /api/iam/policies` | `GET /api/v1/iam/policies` | 只认 `page` / `page_size` / `keyword`；`code` / `policy_type` / `enabled` 传了被**静默忽略**（UP-RBAC-06） |
| 建策略 | `POST /api/iam/policies` | 同 | body `name` / `code` / `policy_type` / `document` / `description`；成功回 `200 { code: 0, message, id }`，`id` 在**顶层**且为 uuid |
| 策略详情 | `GET /api/iam/policies/{id}` | 同 | 不存在 → **HTTP 400 + 纯文本** `记录不存在`（不是 envelope） |
| 改策略 | `PUT /api/iam/policies/{id}` | 同 | `name` / `document` / `description` 生效；`enabled` 被忽略（UP-RBAC-03） |
| 删策略 | `DELETE /api/iam/policies/{id}` | 同 | 成功 `200 {code:0}`；失败回 **HTTP 200 + `code: 400`**（UP-RBAC-05）；系统策略同样可删（UP-RBAC-02） |
| 挂/摘策略 | `POST /api/iam/role-policies/{AttachPolicy,DetachPolicy}` | 同 | body `role_id` + `policy_id`；摘除幂等，重复挂载 → 400 原始 SQL 错误 |

- **ABAC 规则段整体下线**：`/abac/rule` 在新代 openapi（127 条路径）中不存在，缺口 G4 由「契约未知」升级为「端点缺失」。
- **授权试算下线**：`/access/dryrun` 同样不存在（缺口 G5）；`POST /iam/policies` 只做 CRUD，不提供「谁在某路径上能做什么」的计算端点。
- 策略与角色的关系是**独立资源** `role-policies`，不在策略对象上回写 `role_count` 之类聚合字段。
- BFF 白名单已含 `iam`（`shared/types/api.ts` 的 `GATEWAY_RESOURCES`），本节不新增资源名。

### 7.2 字段口径

- `id`：uuid。种子数据形如 `pol_platform_full`，**不能按前缀判断来源**，页面一律当不透明字符串。
- `code`：同一租户内唯一（约束 `uk_sys_policy_tenant_code`），跨租户可重名 —— 实测 `tenant.full_access` 在三个租户各出现一次，列表里共 10 条。
- `policy_type`：openapi 未约束枚举，实测 10 条全为 `system`。页面原样展示；未知值直接显示原值，不映射成「其他」。
- `document`：**JSON 字符串**（不是对象），形如 `[{"Action":["*"],"Effect":"Allow","Resource":["*"]}]`。上游按 jsonb 落库：非法 JSON → `400` + 原始 PG 错误 `22P02`（UP-RBAC-04），没有语义校验。页面只做「格式化预览 + 复制」，预览解析失败就回落原文，**不提供编辑器**（写坏即脏数据）。
- `enabled`：列表与详情恒 `true` —— `PUT` 带 `enabled: false` 返回 200 但值不变（UP-RBAC-03）。页面只读展示，不做开关。
- `is_system`：种子策略为 `true`。**它不是保护**：`DELETE` 对系统策略同样返回成功（UP-RBAC-02）→ 页面只当标签用，删除确认里如实提示。
- `tenant_id`：种子策略带；新建策略落在**会话租户**（实测平台超管建的策略 `tenant_id` 也是 `tnt_default`），body 不接受该字段（UP-RBAC-08）。
- `created_at` / `updated_at`：RFC3339 带 `+08:00` 偏移，原样展示，不做时区换算。

### 7.3 权限矩阵（实测）

| 动作 | 平台超管（会话 `tenant_id = null`） | 租户管理员 | 零角色账号 |
| :--- | :--- | :--- | :--- |
| 策略列表 / 详情 | 可用，见全量 10 条 | 可用，仅本租户 3 条 | **可用**（同租户范围，UP-RBAC-01） |
| 建 / 改 / 删策略 | 可（落 `tnt_default`） | 可（落本租户） | **可**（UP-RBAC-01） |
| 挂 / 摘策略 | 可 | 可 | **可**（UP-RBAC-01） |
| 启停策略 | 无有效端点 | 同左 | 同左 |

新代**没有业务级鉴权**：任何已认证会话都能读写 IAM 端点，可见范围只由**会话租户**决定（UP-RBAC-01 / UP-RBAC-09）。旧代「超管恒 `401 10201`」的域拒绝（UP-POL-08）随旧代退役，不再成立。

客户端收敛（**不是安全边界**，只为不引导用户踩上游缺口）：

1. **不按身份旁路取数**：超管进页面照常请求（旧口径「超管不发起任何请求」作废），401 只剩「凭证缺失 / 令牌失效」一种含义。
2. 不提供启停入口：`enabled` 写入被忽略，开关只会制造「点了没反应」的假象。
3. 系统策略不禁用删除入口，但确认弹窗必须写明「上游不保护系统策略，删除后不可恢复」。
4. 搜索走服务端 `keyword`（不再全量拉取后客户端过滤），因此**撤销** `NMCPS-ARCH-006` §3.8 里「`/system/policy` 客户端分页」的例外，改回服务端分页（`page_size` 上游无上限，页面自带 `DEFAULT_PAGE_SIZE`）。
5. 策略文档只做展示与复制：上游无语法校验，页面不暗示「已校验通过」。

### 7.4 失败形态 → 页面处置

新代几乎没有业务错误码，失败靠 **HTTP 状态 + 响应形态**区分，BFF 出口统一归一为 `{ code, message }`：

| 上游形态 | 含义 | 页面处置 |
| :--- | :--- | :--- |
| `200 {code:0,message,id}` | 建成功 | 关弹窗 + 重新取列表 + 选中新记录 |
| `200 {code:0,message}` | 改 / 删 / 挂 / 摘成功 | 重新取列表（或就地刷新关系） |
| `200 {code:400,message:"资源不存在或无权访问"}` | 删除失败（**transport 仍是 200**） | 按失败处理：提示 + 刷新列表（记录可能已被他人删除） |
| `400` 纯文本 `记录不存在` | 详情 / 更新目标不存在 | 「该策略已被删除」+ 清空选择 |
| `400` 纯文本含 `SQLSTATE 23505` | `code` 重复 | 字段内联「策略编码已存在」；**原始 SQL 文本不得透传给用户** |
| `400` 纯文本含 `SQLSTATE 22P02` | `document` 非法 JSON | 「策略文档必须是合法 JSON」 |
| `400` 纯文本含 `SQLSTATE 23503` | 挂载的 `role_id` / `policy_id` 不存在 | 「策略或角色已不存在，请刷新」 |
| `401 {code:40101}` / `{code:10007}` | 缺凭证 / 令牌失效 | 走会话失效（`SESSION_INVALID_CODES` 须含 `40101` / `10007`） |
| 无响应 / 超时 | 上游未配置 / 掉线 | 沿用 `upstreamHintKey()` 的运维指引 |

### 7.5 已知缺口

`UP-RBAC-01`～`UP-RBAC-10` 见 `NMCPS-REC-005`：无授权校验、系统对象可删、`enabled` 写入无效、400 回原始 SQL、删除失败用 200 承载、列表过滤残缺且分页无上限、必填校验缺失、`tenant_id` 入参被忽略、跨租户授权无拦、孤儿关系行。页面只依赖「列表 + 详情 + 建改删 + 挂摘」这组已确认可用的能力，不把上述缺口当契约。

---

## 八、`/system/permission` 角色与授权（落码基准）

> 口径来源同上。与契约不符处登记在 `NMCPS-REC-005`，本节只写「页面能依赖什么」。页面定位与工具栏口径见 `NMCPS-ADR-0017`。

### 8.1 数据源与端点

| 能力 | BFF 路径 | 上游 | 说明 |
| :--- | :--- | :--- | :--- |
| 角色列表 | `GET /api/iam/roles` | `GET /api/v1/iam/roles` | `page` / `page_size` / `keyword` / `code`；`enabled` / `tenant_id` 被静默忽略 |
| 建角色 | `POST /api/iam/roles` | 同 | body `name` / `code` / `description`，**三者都不是必填**（空 body 也 `200`，落一条空角色，UP-RBAC-07） |
| 角色详情 | `GET /api/iam/roles/{id}` | 同 | 不存在 → `400` 纯文本 `记录不存在` |
| 改角色 | `PUT /api/iam/roles/{id}` | 同 | `name` / `description` 生效；`enabled` 被忽略 |
| 删角色 | `DELETE /api/iam/roles/{id}` | 同 | 无内置保护（系统角色同样 200，UP-RBAC-02）；失败形态同 §7.4 |
| 策略目录 | `GET /api/iam/policies` | 同 | 矩阵数据源，口径见 §7 |
| 角色已挂策略 | `GET /api/iam/role-policies?role_id=` | 同 | 只回关系行 `{ id, role_id, policy_id, created_at }`，**不回策略本体** → 前端按 `policy_id` 关联策略目录 |
| 挂策略 | `POST /api/iam/role-policies/AttachPolicy` | 同 | body `role_id` + `policy_id`；重复挂载 → `400` + `SQLSTATE 23505` |
| 摘策略 | `POST /api/iam/role-policies/DetachPolicy` | 同 | 幂等（重复摘除仍 `200`） |
| 已分配角色 | `GET /api/iam/subject-roles?subject_id=` | 同 | 只回关系行 `{ id, subject_type, subject_id, role_id, created_at }` |
| 分配 / 撤销角色 | `POST /api/iam/subject-roles/{AssignRole,RevokeRole}` | 同 | body `subject_type`（实测 `user`）/ `subject_id` / `role_id` |

- **没有权限点目录**（缺口 G3）：`/permission` 在新代 openapi 中不存在，权限点改由策略 `document` 的 `actions` 表达 → 授权矩阵从「权限点 × 角色」改为「**策略 × 角色**」，属重写而非迁移。
- **没有角色启停端点**：`PUT /iam/roles/{id}` 带 `enabled` 无效（UP-RBAC-03）。
- `roleLevel` / `isBuiltin` / `status` 三个字段随等级模型一并退役（缺口 G1）；`is_system` 接替「内置角色」的**语义标签**，但不构成保护。
- 账号 ↔ 角色已读写对称（旧代 `UP-POL-07` 闭环）：读走 `subject-roles` 列表，写走 `AssignRole` / `RevokeRole`。

### 8.2 字段口径

- `id`：uuid；种子形如 `r_tenant_admin`。页面当不透明字符串，`useRecordSelection` 直接用它做标识，不做数值化。
- `code`：同一租户内唯一（`uk_sys_role_tenant_code`），跨租户可重名 —— 实测 `tenant_admin` 在三个租户各有一条，列表共 10 条。
- `is_system`：种子角色 `true`，新建 `false`。只用于标签与文案。
- `enabled`：恒 `true`（写入无效），只读展示。
- `tenant_id`：平台角色无该字段，租户角色带；平台角色不进租户管理员的列表。
- `description`：可为空串，空时展示「—」。
- `created_at` / `updated_at`：RFC3339 带偏移，原样展示。
- 关系行的 `id` 是 uuid 且无语义，页面只用它做 `key`。
- 授权**没有 effect 维度**：`role-policies` 行存在即「已挂」，不存在即「未挂」（旧代 `UP-POL-03` 的「拒绝不可见」问题随字段消失，页面不必再解释）。

### 8.3 权限矩阵（实测）

| 动作 | 平台超管 | 租户管理员 | 零角色账号 |
| :--- | :--- | :--- | :--- |
| 角色 / 策略列表 | 可用，见全量 10 / 10 | 可用，见本租户 3 / 3 | **可用**（本租户范围，UP-RBAC-01） |
| 建 / 改 / 删角色 | 可（落 `tnt_default`） | 可（落本租户） | **可**（UP-RBAC-01） |
| 挂 / 摘策略、分配 / 撤销角色 | 可 | 可 | **可** |
| 跨租户指派角色 | — | **实测可**：把 `r_platform_admin` 指派给自己的用户回 `200`（UP-RBAC-09，可撤销） | 同左 |
| 角色启停 | 无有效端点 | 同左 | 同左 |

客户端收敛（**不是安全边界**）：

1. 不按身份旁路取数：新代没有域拒绝，三页请求一视同仁；可见范围由会话租户决定。
2. 不提供角色启停：`enabled` 写入无效，只读展示。
3. 删除系统角色 / 系统策略前弹确认，文案写明「上游不保护系统对象」。
4. 授权改为**策略勾选**：候选 = `GET /iam/policies`（本租户 3 条），已勾状态 = `GET /iam/role-policies?role_id=` 的 `policy_id` 集合；写用 `AttachPolicy` / `DetachPolicy`，乐观更新 + 失败回滚，并发按 `role_id + policy_id` 去重。
5. 建角色表单三字段都做前端必填：上游空 body 也返回成功，放过就是脏数据（UP-RBAC-07）。
6. 角色 ↔ 用户分区只做「读 + 分配 + 撤销」，不在此页建号；用户候选来自 `/api/iam/users`。`subject-roles` 里指向已删用户的孤儿行按 `/iam/users` 存在性过滤掉（UP-RBAC-10），不渲染幽灵成员。
7. 详情栏布局沿用 `NMCPS-ARCH-006` §3.2 / §3.7：view 态左「角色信息」、右「已授权策略」，判据为容器查询 `@min-[48rem]`。矩阵只有本租户 3 条策略，条目数远少于旧代的 24 条权限点，**等分是否仍合适留到落码时按实测截图复核**（超短则退回单栏），先按等分写。

### 8.4 失败形态 → 页面处置

失败形态与 §7.4 同族，差异只在文案：

| 上游形态 | 含义 | 页面处置 |
| :--- | :--- | :--- |
| `200 {code:400,message}` | 删除角色失败（transport 200） | 提示 + 刷新列表 |
| `400` 纯文本 `记录不存在` | 详情 / 更新目标不存在 | 「该角色已被删除」+ 清空选择 |
| `400` 纯文本含 `SQLSTATE 23505` | `code` 重复（建角色 / 重复挂载） | 建角色：字段内联「角色编码已存在」；挂载：提示后按最新关系重取 |
| `400` 纯文本含 `SQLSTATE 23503` | 挂载目标不存在 | 「策略已不存在，请刷新」 |
| `401 {code:40101}` / `{code:10007}` | 缺凭证 / 令牌失效 | 走会话失效 |
| 无响应 / 超时 | 上游未配置 / 掉线 | 沿用 `upstreamHintKey()` 的运维指引 |

### 8.5 已知缺口

`UP-RBAC-01`～`UP-RBAC-10` 见 `NMCPS-REC-005`；缺口 G1（无等级模型）与 G3（无权限点目录）在本文档层已经确认，`/system/permission` 因此从「权限点矩阵」重写为「策略授权」。页面只依赖已确认可用的九个端点，不把上述缺口当契约。

---

---

## 九、`/system/log` 审计日志（落码基准）

> 口径来源：2026-11-04 对 `http://192.168.1.55:8888/api/v1` 的实调（超级管理员 / 租户管理员双身份）+ openapi 逐项比对。旧代（0.5.x）的「单端点 + `category` + `verify` + `export`」已整体退役，本节按新代 `audit` 命名空间重写（C4b，`NMCPS-ADR-0018` §三）。与契约不符处登记在 `NMCPS-REC-004`（`layers/content/collections/cn/records/defects/audit-upstream-defects.md`），本节只写「页面能依赖什么」。

### 9.1 数据源与端点

| 能力 | BFF 路径 | 上游 | 参数 |
| :--- | :--- | :--- | :--- |
| 操作日志列表 | `GET /api/audit/operation-logs` | 同 | `page` / `page_size`，可选 `keyword` / `username` / `module` / `status` / `created_from` / `created_to` |
| 操作日志详情 | `GET /api/audit/operation-logs/{id}` | 同 | 路径段是主键 `id`（UUID）；旧代是 `logCode` |
| 安全日志列表 | `GET /api/audit/security-logs` | 同 | `page` / `page_size`，可选 `subject_name` / `action` / `auth_decision` / `ip_address` / `logged_from` / `logged_to` |
| 安全日志详情 | `GET /api/audit/security-logs/{id}` | 同 | 同左 |
| 归档记录列表 | `GET /api/audit/archive/records` | 同 | `page` / `page_size`，可选 `table_name` / `status`；**没有时间条件** |
| 归档记录详情 | `GET /api/audit/archive/records/{id}` | 同 | 与列表项同形 |
| 执行归档 | `POST /api/audit/archive/run` | 同 | body `{ table_name? }`（省 = 两张表都归档），返回 `{ "表名": 行数 }` |

- **三族各有自己的端点、筛选参数与详情端点**，不是「一个端点加过滤条件」：切族 = 换端点 + 换参数名 + 换字段。页面按族分支，不做「一套参数打三处」的假设。
- 旧代两条能力在新代**没有对应端点**，已随缺口下线：`POST /audit/verify`（哈希链校验，缺口 G6）与 `GET|POST /audit/export`（导出任务，缺口 G7）。「数据过保后去哪了」改由归档链路回答。
- BFF 白名单需含 `audit`（`shared/types/api.ts` 的 `GATEWAY_RESOURCES`），否则一律 `404 bff_resource_not_allowed`。
- 契约类型在 `shared/types/audit.ts`（`app/` 与 `server/` 同构引用），页面不重复声明字段。

### 9.2 字段口径

- **主键是 `id`（UUID）**，同时是详情端点路径段；它**不进**列表查询参数，只用于 `?id` 深链与详情取数（旧代的 `logCode` 已不存在）。
- `page_size`：默认 15、选项 15 / 30 / 50 / 100，页面级上限 `AUDIT_MAX_PAGE_SIZE = 100`（选择器在列表栏尾部，`NMCPS-ARCH-006` §3.8）。空结果上游给 `list: null`，BFF 出口归一为 `[]`（`NMCPS-ADR-0018` D6），消费面不必逐页判空。
- 时间边界是 **epoch 毫秒整数**（旧代是时间串）：操作日志 `created_from` / `created_to`，安全日志 `logged_from` / `logged_to`。页面把 `datetime-local` 字面值按**浏览器本地时**换算成毫秒发出；日历选日落到整日窗口 `00:00:00` … `23:59:59`（含首尾两端，少这 59 秒就会漏掉当天最后半分钟），反向区间本地先拦。
- 归档记录**没有时间条件**：`/audit/archive/records` 只认 `table_name` / `status`，因此页面在归档族把时间范围控件整个收起，请求里也不带任何时间参数。
- 归档记录字段已实测（2026-11-04 真跑一次 `POST /audit/archive/run` 后回读）：`id` / `table_name` / `archive_batch` / `rows_archived` / `cutoff_before` / `started_at` / `finished_at` / `status` / `created_at`。`*_at` / `cutoff_before` 是带偏移的 RFC3339（`2026-08-06T10:34:39.998235+08:00`），只裁剪展示、**不做时区换算**。
- **操作日志与安全日志的条目字段集合尚未在真实数据上核对过**（该实例审计库为空，只有归档链路跑出过真实样本）：类型文件按 openapi 的查询参数与同类实体反推已登记清单，渲染策略是「已登记字段缺失显示 `—`、未登记字段在详情尾部原样列出」，详情栏顶部常驻一条「字段口径说明」Alert —— 不让读者把「上游没记」误读成「页面漏渲染」。
- 归档结果是**行数映射**而不是任务对象：`0` 行是正常结果（没有过期数据），不是失败；弹窗里必须先说明这一点，否则「归档成功但 0 行」会被当成故障。

### 9.3 权限矩阵与页面行为

| 动作 | 超级管理员 | 租户管理员 |
| :--- | :--- | :--- |
| 三族列表 / 详情 | 全平台 | 可用，**范围由上游按租户过滤** |
| 执行归档 | 可用（写操作，会留下批次记录） | 页面同样给入口，越权由上游裁决（**未在租户管理员身份下实跑过**） |

客户端收敛（**不是安全边界**）：

1. 两种身份都照常取数：范围由上游过滤，页面只在详情栏顶部用身份说明讲清「你看的是全平台 / 本租户」（未选中空态也在，位置口径见 `NMCPS-ARCH-006` §4.1）。
2. 筛选按「是否决定数据口径」分两处：**时间范围**（按钮文案即当前窗口摘要 + `UPopover` 里给「全部时间 / 近 15 分钟 / 近 1 小时 / 近 24 小时 / 近 7 天」快捷项列、双月 `UCalendar range` 日历，以及日历下方两个到秒的 `datetime-local` 补手）与**日志族**（`USelect`：操作日志 / 安全日志 / 归档记录）常驻工具栏左区；浮层只放本族 openapi 真正列出的标识参数 —— 操作日志 `keyword` / `username` / `module` / `status`，安全日志 `subject_name` / `action` / `auth_decision` / `ip_address`，归档记录 `table_name` / `status`。每页条数不在这两处之列（列表呈现而非筛选，固定在列表栏尾部，默认 15）。归档族没有时间条件，范围控件随之隐藏。常驻判据是「不常驻会让人把过滤后的 `total` 当全量读」，占位预算与控件形态见 `NMCPS-ARCH-006` §4.1。
3. 列表用 `LayoutSplit` 两栏 + `useRecordSelection` 读写 `?id`；`↑` / `↓` 可在列表内移动选中，详情栏回读**当前族的详情端点**；切族回第一页并清掉选中（旧记录在新族里不存在）。
4. 归档是**显式动作**：右区按钮只在列表态且非归档族时出现，弹窗写明「写操作、不可撤销」「0 行是正常结果」，跑完后刷新归档记录列表让新批次可见。
5. 校验与导出入口全部下线（G6 / G7）：页面既没有「开始校验」也没有「导出」按钮，也不再有导出进度轮询。
6. `check:ui` 守住 11 项：两个常驻控件在位、左区总宽不超内容盒 45%、浮层只留本族标识参数；列表按族端点渲染；选中行走族详情端点；快捷区间真的改写 `created_from` / `created_to`（epoch 毫秒、间隔 24h）；按钮文案回显窗口；日历选整天含首尾两端；切到安全日志换成 `security-logs` + `logged_from` / `logged_to`；归档族收起范围控件且请求不带时间参数；320px 下时间范围退成图标且无横向溢出。列表栏尾部另有：高度 49px、默认每页 15 条（`page_size`）、选中行底色在深浅两模式都可辨（`NMCPS-ARCH-006` §3.8）。

### 9.4 错误码 → 页面处置

新代把业务错误塞进 **HTTP 200 + `code≠0`**，BFF 保留业务码、`apiGuard` 依码抛 `ApiError`（`NMCPS-ADR-0018` §三）。

| 码 | 上游含义 | 页面处置 |
| :--- | :--- | :--- |
| `40401` | 目标不存在（三个详情端点共用此码，`message` 里点名实体：「操作日志不存在」/「安全审计日志不存在」/「归档记录不存在」） | 详情栏提示「该记录不存在，或已被清理」，保留选中项以便重试 |
| `10007` | 令牌无效 / 过期 | 「登录态已失效或没有权限」提示并引导重登，不进「加载失败」分支 |
| `40001` | 字段校验失败（时间边界 / 分页参数） | 「参数不合法」提示，保留用户输入 |
| `10509` / `5xx` | 上游内部错误 | 通用失败提示 + 重试入口 |
| 非信封失败（`code = 0`） | 网络层 | 「网络异常，请重试」 |

`10201` 在新代是「密码错误」，**不再**当作鉴权失败复用（旧代口径作废）。上游未配置 / 掉线 / 超时沿用 `upstreamHintKey()` 的运维指引。

### 9.5 已知缺口

- **G6 / G7（功能缺口）**：新代没有哈希链校验，也没有导出任务端点；`verify` 与 `export` 的旧代缺陷（UP-AUD-05 / 06 / 07 / 08）随端点一起退役，页面不再提供这两条路径。
- **字段口径未实测**：操作日志与安全日志的条目字段集合未在真实数据上核对过（实例审计库为空），只有归档记录字段逐字核对过；页面因此把「已登记字段缺失」与「未登记字段」都显式呈现，而不是静默丢弃。
- **归档执行口径未穷举**：本次只在超级管理员身份下实跑过一次（两张表各 0 行）；保留期长度、并发执行、租户管理员越权行为均未验证，页面不据此给任何承诺。
- 旧代 `UP-AUD-01` / `02` / `03` / `04` / `09` 描述的是已下线的端点（`category` 大小写、`pageSize` 无上限、时间双格式、快照恒空），保留在 `NMCPS-REC-004` 作历史记录，**不再作为契约**。

---

## 十、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化系统管理领域基准（定位、功能范围、数据实体、边界、演进）。 |
| 2026-10-31 | 0.2.0 | 功能范围登记 `download` 子页面（`/system/download`「下载中心」）：原根路径下载落地页迁入系统管理，安装包链接直指 GitHub Release；裁决见 `NMCPS-ADR-0016`。 |
| 2026-11-01 | 0.3.0 | 新增第六节 `/system/user` 用户管理落码基准：端点表（列表 / 建号 / 改状态，无改资料与删号）、字段与状态枚举口径、超级管理员 vs 租户管理员的权限矩阵与客户端收敛、错误码映射、缺口清单；上游缺陷另立 `NMCPS-REC-002`。 |
| 2026-11-01 | 0.4.0 | 新增第七节 `/system/policy` 与第八节 `/system/permission` 落码基准：端点表（规则只读巡检 + 试算、角色 / 权限点 / 授权三组端点）、字段口径（`roleCode` 空串 = 全局、`conditionDsl` 不校验、回读无 `effect`）、双身份权限矩阵与客户端收敛（超管不进请求、无写入口、客户端过滤、乐观授权）、错误码映射、缺口清单；原变更记录顺延为第九节，上游缺陷统一登记在 `NMCPS-REC-003`。 |
| 2026-11-01 | 0.4.1 | **身份 / 范围说明 Alert 改放详情栏顶部**：三页（第六 / 七 / 八节）原先把「这批数据在什么范围内可信」当页面级横幅渲染，现在统一进 `#detail` 顶部、未选中空态也在，页面顶部只留工具栏与两栏骨架；第七、八节的客户端收敛条目点明该位置。布局与对齐口径见 `NMCPS-ARCH-006` §4.1（0.2.11）。 |
| 2026-11-02 | 0.5.0 | 新增第九节 `/system/log` 审计日志落码基准：端点表（列表 / 详情 / 链式校验 / 导出任务列表 / 创建导出，**导出无详情与删除端点**）、字段口径（列表 12 字段 = 详情前 12 字段、`category` 大小写敏感、`result` 1/2、`eventTime` 带偏移不换算、`pageSize` 夹到 100、快照字段恒空）、双身份权限矩阵与客户端收敛（两种身份都取数、租户范围由上游过滤、无 `result` / `keyword` 控件、两栏 + `?id`、校验做成显式按钮并说明「自身会写一条日志」、导出无轮询）、错误码映射、缺口清单；原变更记录顺延为第十节，上游缺陷统一登记在 `NMCPS-REC-004`。 |
| 2026-11-02 | 0.5.1 | **§8.3 权限矩阵改两列**：左列资源类（`resourceType` ≠ `4`）、右列接口类（`4`）。实测 24 条权限点里 15 条是接口类，与资源类分组混排会把「单设备 / 指标 / MIB / 告警」压到列表底部；列序固定「资源类 → 接口类」，容器窄于两个 `17rem` 时自动堆叠（接口列仍在第二段），空列渲染一行灰字而不是整列消失；§8.2 字段口径补 `4` = 接口类。 |
| 2026-11-02 | 0.5.2 | **§8.3 授权矩阵回到单列并右移到详情栏右侧**：撤销 0.5.1 的「资源类 / 接口类」双列矩阵，矩阵恢复按 `resourceType` 单列分组、条目按 `permCode` 稳定排序；详情栏 view 态改为内部左右分栏 —— 左「角色信息」、右「授权矩阵」，分栏判据是容器查询 `@min-[48rem]`（不是视口断点，见 `NMCPS-ARCH-006` §3），窄于阈值纵向堆叠且顺序不变。§8.2 同步把 `4` = 接口类的措辞改回「按类型分组展示」。 |
| 2026-11-02 | 0.5.3 | **§8.3 详情栏等分两列、矩阵内部恢复两列**：左「角色信息」、右「授权矩阵」各占 50% 并铺满容器（去掉 0.5.2 的字段窄列与 70rem 上限）；矩阵内部恢复「资源类 / 接口类」两列（0.5.1 的口径），列序固定、列内按 `resourceType` 分组。判据仍是容器查询 `@min-[48rem]`，窄于阈值纵向堆叠且矩阵内部同步回单列；§8.2 措辞回到「`4` = 接口类，矩阵里单独占右列」。 |
| 2026-11-02 | 0.5.4 | **§9.3 第 2 条：时间范围与类别常驻工具栏左区**。原先把 `category` 与起止时间一起塞进筛选浮层，结果是「过滤后的 `total` 被当全量读」——这两项恰好决定数据口径。现在左区常驻「时间范围按钮（文案 = 当前窗口摘要，`UPopover` 内给全部时间 / 近 15 分钟 / 近 1 小时 / 近 24 小时 / 近 7 天快捷项 + 自定义起止）」与「类别 `USelect`」，`accountId` / `deviceCode` / `sessionId` / `traceId` 与每页条数仍在浮层，浮层的「有筛选」高亮同步收窄到浮层内部的四个标识；占位预算与控件形态见 `NMCPS-ARCH-006` §4.1（0.2.14）。 |
| 2026-11-02 | 0.5.5 | **§9.3 第 2 条：时间范围浮层改为「快捷项列 + 双月日历」**。原先浮层里只有一列快捷按钮和两个 `datetime-local`，选「上周三到上周五」这种区间必须手填两个时间串。现在抽出 `components/Audit/RangePicker.vue`（形态照 Nuxt UI dashboard 模板的 `HomeDateRangePicker`）：左侧快捷项列（命中项底色高亮，窄屏隐藏）+ 双月 `UCalendar range` 日历，日历下方保留两个到秒的 `datetime-local` 补手；选日按整日窗口落 `00:00:00` … `23:59:59`，点一天 = 从那天起、点第二天才收尾（留空终点，reka 的区间选择才能继续）。三条入口（快捷项 / 日历 / 手填）只改同一个 `start` / `end` / `preset`，取数仍由页面既有的 `watch` 落地。渲染细节与两个实测坑见 `NMCPS-ARCH-006` §4.1（0.2.15）。 |
| 2026-11-03 | 0.5.6 | **每页条数从筛选浮层移到列表栏尾部，四个列表页统一默认 15 条**。三个实测问题：① 选中行底色在浅 / 深两模式都读不出（`bg-elevated/60` 叠在白面板上几乎同色），已由 `NMCPS-ARCH-006` 0.2.16 改为 `bg-accented`；② 每页条数原先默认 20、只有 `/system/log` 在筛选浮层里有一个，`/system/user` 与 `/system/permission` 连入口都没有，`/system/policy` 则完全不分页 —— 现在统一 `DEFAULT_PAGE_SIZE = 15`（选项 15 / 30 / 50 / 100，来源 `shared/constants/paging.ts`），四页都在列表尾提供选择器；③ 列表尾高度统一 49px（`--app-list-footer-h`）。本文件相应更新：§6 端点表口径不变，§7.3 第 3 条补「客户端分页只切渲染层，深链仍对全量生效」、§9.2 的 `pageSize` 选项改为 15 / 30 / 50 / 100、§9.3 第 2 条把每页条数移出筛选浮层、第 6 条补尾部三条断言。 |
| 2026-11-03 | 0.5.7 | **§6 用户管理建号口径按 2026-11-03 复测更正（修「租户管理员建号必失败」）**。现象：租户管理员在 `?id=new` 建号，表单只提供 `1`（= 自身等级），提交一律回 `20103 只能向下管控`，可见的「账号等级」下拉等于没有可选项。复测三条结论：① 等级必须**严格低于自己**（超级管理员 `1`–`3`、租户管理员 `2`–`3`），同级或更高 → `20103`；`4` → `20102`（服务账号由系统开通）；② `POST /account` 新增 `tenantId` 必填（`0` 视同缺省），超级管理员不带该字段直接 `10101`，因此页面新增「所属租户」下拉，来源 `GET /api/tenant`；③ `UP-ACC-01`（租户越级建号）由上游闭环，§6.5 与 `NMCPS-REC-002` 同步更新，新增 `UP-ACC-07`（`tenantId` 必填）/ `UP-ACC-08`（`4` 归服务账号）。§6.1 端点表加租户列表、§6.2 等级语义改写、§6.3 矩阵重写并补客户端收敛 1 / 2 两条、§6.4 错误码加 `20102` / `20103`。 |
| 2026-11-04 | 0.6.0 | **§6 用户管理按新代 `iam/users` 重写（C4a）**：端点表换成 `GET|POST /iam/users`、`GET|PUT|DELETE /iam/users/{id}`、`GET /iam/tenants`、`GET /iam/departments`；字段口径改 snake_case（`id` / `username` / `display_name` / `status: active|disabled|locked` / `mfa_enabled` / `tenant_id` / `department_id`），`pageSize` → `page_size`，`list: null` 由 BFF 出口归一为 `[]`；**等级模型（`accountLevel`）整段退役**（缺口 G1），建号归属改由「部门」表达（`POST /iam/users` 实测没有 `tenant_id`）；新增删号（`DELETE`，软删 `deleted_at`，旧代 `UP-ACC-04` 闭环）与「列表自带租户归属」（`UP-ACC-05` 闭环）；错误码表改为实测的 `10002` / `40001` / `10003` / `10007` / `10301` 组合，口令策略按实测「6-128 字符」；`POST /access/dryrun` 入口与弹窗随缺口 G5 下线。 |
| 2026-11-04 | 0.7.0 | **§9 审计日志按新代 `audit/*` 三族重写（C4b）**：旧代的单端点 `GET /audit?category=…` + `POST /audit/verify` + `GET|POST /audit/export` 全部退役，改为按日志族拆分的六个读路径与一个写路径 —— 操作日志 `GET /audit/operation-logs`、安全日志 `GET /audit/security-logs`、归档记录 `GET /audit/archive/records`（各带自己的详情端点）与执行归档 `POST /audit/archive/run`；主键从 `logCode` 变 `id`（UUID），分页字段从 `pageSize` 变 `page_size`，时间边界从时间串变 **epoch 毫秒整数**（`created_from` / `created_to`、`logged_from` / `logged_to`），空结果 `list: null` 由 BFF 出口归一为 `[]`。页面改成「三族一页」：日志族下拉常驻左区、浮层只放本族的 openapi 参数、归档族收起时间范围；校验与导出入口随缺口 G6 / G7 下线，归档弹窗取代导出；错误码表换成 `40401` / `10007` / `40001`（旧代 `10201` 在新代是「密码错误」，不再复用）。字段口径如实分层：归档记录已实测，操作 / 安全日志的条目字段尚无真实样本，页面只渲染已登记字段并把未登记字段原样列出。`check:ui` 的 `/system/log` 用例 8 → 11（切族换端点与时间参数、归档族无时间条件、选中行走族详情端点），总数 105 → 106；`check:bff` 的空列表归一路径改到 `operation-logs`。 |
| 2026-11-04 | 0.8.0 | **§7 / §8 按新代 `iam` 命名空间重写（C4c）**：策略段从「`/abac/rule` 只读巡检 + `/access/dryrun` 试算」改为策略 CRUD —— 列表 / 建 / 详情 / 改 / 删落在 `GET|POST /iam/policies` 与 `GET|PUT|DELETE /iam/policies/{id}`，挂摘策略走独立的 `POST /iam/role-policies/{AttachPolicy,DetachPolicy}`；ABAC 段与试算按钮随缺口 G4 / G5 由「契约未知」升级为「端点缺失」下线。角色段从「`roleCode` 路径 + `roleLevel` + 权限点目录」改为 uuid 主键的 `GET|POST /iam/roles` + `GET|PUT|DELETE /iam/roles/{id}`，授权矩阵从「权限点 × 角色」重写为「策略 × 角色」（缺口 G3 确认：`/permission` 在新代 openapi 中不存在），账号↔角色改由 `subject-roles` 三端点读写对称（旧代 `UP-POL-07` 闭环）。三处旧口径随实测作废：① 「超管恒 `401 10201`」的域拒绝不存在了，任何已认证会话（含零角色账号）都能读写 IAM 端点，可见范围只由会话租户决定（`UP-RBAC-01` / `UP-RBAC-09`）→ 客户端不再按身份旁路取数；② `enabled` 写入被忽略（`UP-RBAC-03`）→ 不提供启停；③ 列表有 `keyword` → 撤销「客户端全量拉取 + 客户端分页」的例外，回到服务端分页。失败处理改为按 **HTTP 状态 + 响应形态**分派（`200 {code:400}`、`400` 纯文本 `记录不存在`、`400` + 原始 `SQLSTATE`），并写明原始 SQL 不得透传给用户。上游缺陷由 `NMCPS-REC-003`（旧代，已 `superseded`）换为 `NMCPS-REC-005`。 |
