---
docId: NMCPS-DESIGN-005
title: "系统管理领域基准"
description: "系统管理域（domain.system）的 Tier 2 设计基准：系统日志、策略管理、用户与权限管理。本文是 domain.system 域的唯一权威。"
excerpt: "系统日志、策略管理、用户与权限管理的领域设计基准。"
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
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-003
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
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

## 六、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化系统管理领域基准（定位、功能范围、数据实体、边界、演进）。 |
