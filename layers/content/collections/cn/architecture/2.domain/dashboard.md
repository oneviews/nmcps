---
docId: NMCPS-DESIGN-007
title: "仪表盘领域基准"
description: "仪表盘域（domain.dashboard）的 Tier 2 设计基准：系统总览、智能体助手、Kubernetes 监控与大屏呈现。本文是 domain.dashboard 域的唯一权威。"
excerpt: "系统总览、智能体助手、Kubernetes 监控与大屏呈现的领域设计基准。"
keywords:
  - "dashboard"
  - "仪表盘"
  - "大屏"
  - "领域基准"
tier: 2
authority: normative
scope:
  - domain.dashboard
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-002
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:dashboard"
tags:
  - "领域基准"
  - "仪表盘"
  - "大屏"
---

# 仪表盘领域基准（NMCPS-DESIGN-007）

> **本文职责**：`domain.dashboard` 域的唯一权威，定义仪表盘——系统总览、智能体助手、Kubernetes 监控与大屏呈现。数据消费见 `NMCPS-ARCH-002`。
> **目标读者**：实施工程师 / AI 助手。

---

## 一、定位

仪表盘是网络管理系统的「呈现面」：聚合各域状态，提供系统总览、智能体交互、云原生资源监控与指挥大屏。

---

## 二、功能范围

| 子页面 | 功能 |
| :--- | :--- |
| overview | 系统总览 |
| agent | 智能体助手 |
| kubernetes | Kubernetes 资源监控 |
| screen | 指挥大屏 |

---

## 三、关键数据实体

| 实体 | 说明 |
| :--- | :--- |
| 总览指标（Overview） | 跨域聚合的摘要指标 |
| 智能体会话（Agent） | 人机交互上下文 |
| 集群资源（K8s） | 云原生资源状态 |

---

## 四、领域边界与依赖

- **上游依赖**：跨域聚合数据（见 `NMCPS-ARCH-002`）。
- **消费方**：终端用户（唯一聚合入口）。
- **不承载**：各域原始数据（由各域 `domain.*` 提供）。

---

## 五、演进路线

1. 系统总览（跨域指标聚合）。
2. 智能体助手（自然语言运维交互）。
3. Kubernetes 监控与指挥大屏。

---

## 六、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化仪表盘领域基准（定位、功能范围、数据实体、边界、演进）。 |
