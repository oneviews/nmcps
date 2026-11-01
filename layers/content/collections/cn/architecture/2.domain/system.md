---
docId: NMCPS-DESIGN-005
title: "系统管理领域基准"
description: "系统管理域（domain.system）的 Tier 2 设计基准：系统日志、策略管理、用户与权限管理，含 /system/user 的端点、字段、权限矩阵与错误码口径。本文是 domain.system 域的唯一权威。"
excerpt: "系统日志、策略、用户与权限管理的领域基准（含用户页落码口径）。"
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
version: 0.3.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-003
createdAt: "2026-10-25"
updatedAt: "2026-11-01"
icon: "carbon:settings"
tags:
  - "领域基准"
  - "系统管理"
  - "权限"
---

# 系统管理领域基准（NMCPS-DESIGN-005）

> **本文职责**：`domain.system` 域的唯一权威，定义系统管理——系统日志、策略管理、用户与权限管理。身份与访问控制的架构基准见 `NMCPS-ARCH-003`。
> **目标读者**：实施工程师 / AI 助手。

---

## 一、定位

系统管理是网络管理系统的「治理面」：管理系统的运行日志、全局策略、用户账号与权限分配，是 IAM 架构（见 `NMCPS-ARCH-003`）的落地界面。

---

## 二、功能范围

| 子页面 | 功能 |
| :--- | :--- |
| log | 系统日志查询与审计 |
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

> 口径来源：2026-11-01 对 `http://192.168.1.55:10000/api/v1` 的实调（超级管理员 / 租户管理员双身份穷举）+ swagger 比对。与契约不符处登记在 `NMCPS-REC-002`（`layers/content/collections/cn/records/defects/account-upstream-defects.md`），本节只写「页面能依赖什么」。

### 6.1 数据源与端点

| 能力 | BFF 路径 | 上游 | 说明 |
| :--- | :--- | :--- | :--- |
| 列表 | `GET /api/account` | `GET /api/v1/account` | `page` / `pageSize` / `keyword` / `accountLevel` / `status` |
| 建号 | `POST /api/account` | `POST /api/v1/account` | `accountName` / `displayName` / `password` / `accountLevel` 必填，`mfaEnabled` / `mustResetPassword` 可选 |
| 改状态 | `PUT /api/account/{accountCode}/status` | 同 | body `{ status }`，返回 `{ ok: true }` |
| 详情 | `GET /api/account/{accountCode}` | 同 | 页面不单独调用：列表已含全部展示字段 |

- 路径段 `{id}` 实为 `accountCode`（`ACC…`），不是 `accountId`。
- **没有改资料端点**（无 `PUT /api/v1/account/{id}`），也没有删号端点：`displayName` 建号后不可改，「删除」语义由 `status=2`（禁用）承接。
- BFF 白名单需含 `account`（`shared/types/api.ts` 的 `GATEWAY_RESOURCES`），否则一律 `404 bff_resource_not_allowed`。

### 6.2 字段口径

- `accountLevel`：`0` 平台超级管理员 / `1` 租户管理员（与 `NMCPS-ARCH-003` 第五节一致）。上游接受 `0–4`，但 `2/3/4` 无语义定义 → 页面只读展示「未定义等级」，创建时也只提供 `0` / `1`。
- `status`：`1` 启用 / `2` 禁用 / `3` 锁定 / `4` 待激活（swagger 口径）。写入 `0` 或 `5` → `10101`；`4` 由建号时的 `mustResetPassword` 决定，页面不主动写 `4`。
- `createdAt`：`GET` 返回本地时、`POST` 返回 UTC（同一字段两种时区）→ 页面原样展示，不做时区换算（UP-ACC-05）。
- 列表**不含** `tenantId` / `tenantCode` / `email` / `phone`：页面不展示租户归属，也不做「邮箱 / 手机」列（v1 那套字段上游没有）。
- `accountName` 唯一：重复 → `10302`；`accountLevel=0` 作为**过滤条件**会被上游当「未提供」（零值）→ 返回全量，页面不提供「只看超级管理员」筛选项（UP-ACC-02）。

### 6.3 权限矩阵（实测）

| 动作 | 超级管理员（`accountLevel: 0`，`tenantId: 0`） | 租户管理员（`accountLevel: 1`，`tenantId ≥ 1`） |
| :--- | :--- | :--- |
| 列表范围 | 全平台 | 仅本租户 |
| 建号 | 可建（含 `accountLevel: 0`） | 仅本租户；**实测可建 `0` / `2` / `4`（应拒绝）** |
| 改状态 | 任意账号 | 仅本租户账号，跨租户 → `10301` |
| 角色分配 `POST /api/account/role` | 恒 `10201`（域拒绝） | 本租户账号可分配 / 解除 |
| 租户成员 `POST /api/tenant/{id}/member` | 可调 | 本租户可调 |

客户端收敛（**不是安全边界**，只为不引导用户做出上游会拒或会越权的操作）：

1. 等级下拉按身份收敛：超级管理员 `0` / `1` 二选一，租户管理员只有 `1`。租户管理员越级建号是上游缺口（UP-ACC-01），页面不提供入口。
2. 行内「变更状态」对本人账号（`accountCode` 等于会话账号）禁用，避免自锁 / 自禁。
3. 不提供角色绑定与租户成员入口：前者超级管理员被上游 `10201` 拒绝，后者列表缺 `tenantId` 无法定位目标；两块归 `/system/permission` 与租户域。
4. 上游仍是唯一鉴权点：BFF 只做白名单透传，客户端收敛不改变后端判定结果。

### 6.4 错误码 → 页面处置

| 码 | 上游含义 | 页面处置 |
| :--- | :--- | :--- |
| `10302` | 账号名已存在 | `accountName` 字段内联错误 |
| `20101` | 口令不满足复杂度 / 有效期策略 | `password` 字段内联错误 |
| `10101` | 参数不合法（状态或等级越界） | 操作提示「参数不合法」 |
| `10301` | 目标不存在或不在当前租户域 | 「账号不存在或无权限」 |
| `10201` | 未认证 / 域拒绝 | 「会话失效或当前身份无此权限」 |
| `10509` | 上游内部错误（缺必填、等级越界） | 通用失败提示 + 检查必填项 |

上游未配置 / 掉线 / 超时沿用 `upstreamHintKey()` 的运维指引（与登录页、`/user/security` 同一套文案）。

### 6.5 已知缺口

`UP-ACC-01`～`UP-ACC-06` 见 `NMCPS-REC-002`：租户管理员越级建号、`accountLevel=0` 过滤失效、缺字段 / 越界等级报 `500`、无改资料与删号端点、列表缺租户归属与时区不一致、超级管理员无法分配角色。页面只依赖已确认可用的三个端点，不把上述缺口当契约。

---

## 七、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化系统管理领域基准（定位、功能范围、数据实体、边界、演进）。 |
| 2026-10-31 | 0.2.0 | 功能范围登记 `download` 子页面（`/system/download`「下载中心」）：原根路径下载落地页迁入系统管理，安装包链接直指 GitHub Release；裁决见 `NMCPS-ADR-0016`。 |
| 2026-11-01 | 0.3.0 | 新增第六节 `/system/user` 用户管理落码基准：端点表（列表 / 建号 / 改状态，无改资料与删号）、字段与状态枚举口径、超级管理员 vs 租户管理员的权限矩阵与客户端收敛、错误码映射、缺口清单；上游缺陷另立 `NMCPS-REC-002`。 |
