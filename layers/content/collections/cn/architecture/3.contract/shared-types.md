---
docId: NMCPS-CONTRACT-001
title: "共享类型契约"
description: "共享类型契约（contract.shared-types）的 Tier 3 契约基准：跨模块共享类型的命名规范、目录组织、复用规则与禁 any / null 语义硬约束，并登记 `/api/v1/auth` 契约类型（`shared/types/auth.ts`）。本文是 contract.shared-types 域的唯一权威。"
excerpt: "跨模块共享类型的命名规范、目录组织与复用规则的契约基准。"
keywords:
  - "contract"
  - "shared-types"
  - "类型"
  - "契约"
tier: 3
authority: normative
scope:
  - contract.shared-types
status: baseline
version: 0.2.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-002
createdAt: "2026-10-25"
updatedAt: "2026-10-31"
icon: "carbon:data-class"
tags:
  - "契约"
  - "类型"
  - "共享"
---

# 共享类型契约（NMCPS-CONTRACT-001）

> **本文职责**：`contract.shared-types` 域的唯一权威，定义跨模块共享类型契约——类型如何命名、如何组织、如何复用。数据源架构见 `NMCPS-ARCH-002`，治理规则见 `NMCPS-GOV-001`。
> **目标读者**：实施工程师 / AI 助手。

---

## 一、定位

共享类型契约是跨模块协作的「语言公约」：任何被多个模块（layer）复用的类型，其命名、位置与语义只在本契约定义一次，其余位置一律引用，禁止复制手写。

---

## 二、命名规范

| 对象 | 规范 | 示例 |
| :--- | :--- | :--- |
| 接口/类型 | PascalCase，语义名词 | `MetricDatapoint` |
| 联合类型 | 小写字面量联合 | `MetricType = 'counter' \| 'gauge'` |
| 类型文件 | kebab-case，按域分文件 | `metric.ts` / `topology.ts` |
| 目录 | `shared/types/` | 跨模块唯一入口 |

---

## 三、目录组织

```text
shared/
  types/          # 跨模块共享类型（唯一事实源）
    metric.ts     # 指标契约类型
    topology.ts   # 拓扑契约类型
    iam.ts        # 身份与访问控制类型
    ...
  constants/      # 纯数据常量（docId ↔ 路径映射等）
    docIds.ts
```

`shared/constants/docIds.ts` 是纯数据 + 纯函数（无 Nuxt 别名、无 IO、无副作用），Nuxt 侧与 node 脚本共用。

---

## 四、复用硬约束

1. **禁 `any`**：未知语义一律用 `unknown` 或明确联合类型，禁止 `any` 穿透。
2. **null 语义**：未知/缺失一律 `null`，禁止用 `0`、空串、`'unknown'` 伪造真值；`0` 是合法真值。
3. **单一事实源**：同一类型只在一个文件定义；派生值禁独立赋值（标注「派生，见源头」）。
4. **向前兼容**：新增字段用可选（`?`），删除字段先 `deprecated` 再移除。

---

## 五、现有共享类型

| 类型 | 位置 | 说明 |
| :--- | :--- | :--- |
| `DocId` / `DOC_PATHS` | `shared/constants/docIds.ts` | docId ↔ 路径唯一映射 |
| `LayoutMode` / `UserPreferences` | `layers/user/app/composables/useUserPreferences.ts` | 布局偏好类型 |
| `ApiResponse` / `ApiStatus` / `ApiError` | `shared/types/api.ts` / `shared/utils/apiGuard.ts` | 统一响应信封与类型守卫 |
| `AuthUser` / `AuthTokens` / `AuthLoginPayload` / `AuthLoginResult` / `AuthRefreshResult` / `AuthSessionState` | `shared/types/auth.ts` | `/api/v1/auth` 契约：字段名沿用上游 camelCase（`accountCode` / `accountLevel` / `sessionId`…），**不做蛇形转换**；BFF 只把错误信封的 `msg` 归一为 `message`，业务字段一律透传保真；缺失语义（如登录返回不含 `displayName`）一律填 `null`，不用近义字段顶替 |

> 随着 S2 领域基准落地，`metric` / `topology` 等契约类型将迁入 `shared/types/`，本契约随演进同步登记。

---

## 六、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化共享类型契约（命名规范、目录组织、复用硬约束、现有类型清单）。 |
| 2026-10-31 | 0.2.0 | 登记 `shared/types/api.ts` 与 `shared/types/auth.ts`：明确上游字段透传保真、`msg` → `message` 归一、缺失即 `null`。 |
