---
docId: NMCPS-ARCH-003
title: "IAM 架构"
description: "身份与访问控制（arch.iam）的 Tier 1 架构基准：AAA 框架（AuthN/AuthZ/Audit）、五层 IAM 架构、RBAC 与 ABAC 弹性结合、多租户隔离与合规审计。本文是 arch.iam 域的唯一权威。"
excerpt: "AAA 框架、五层 IAM 架构、RBAC+ABAC 与多租户隔离的身份访问控制基准。"
keywords:
  - "iam"
  - "architecture"
  - "身份"
  - "访问控制"
  - "架构"
tier: 1
authority: normative
scope:
  - arch.iam
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
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

## 七、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化 IAM 架构（AAA 框架、五层架构、RBAC+ABAC、多租户、审计）。 |
