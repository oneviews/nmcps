---
docId: NMCPS-DESIGN-004
title: "设备组网领域基准"
description: "设备组网域（domain.device）的 Tier 2 设计基准：设备资产管理、设备类型、路由、组网与策略配置。本文是 domain.device 域的唯一权威。"
excerpt: "设备资产、设备类型、路由、组网与策略配置的领域设计基准。"
keywords:
  - "device"
  - "设备"
  - "组网"
  - "领域基准"
tier: 2
authority: normative
scope:
  - domain.device
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-002
  - NMCPS-ARCH-003
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:data-connected"
tags:
  - "领域基准"
  - "设备"
  - "组网"
---

# 设备组网领域基准（NMCPS-DESIGN-004）

> **本文职责**：`domain.device` 域的唯一权威，定义设备组网——设备资产管理、设备类型、路由、组网与策略配置。设备身份与访问控制见 `NMCPS-ARCH-003`。
> **目标读者**：实施工程师 / AI 助手。

---

## 一、定位

设备组网是网络管理系统的「资产面」：管理被管网络设备的资产台账与类型，编排设备间的路由与组网关系，并下发策略配置。

---

## 二、功能范围

| 子页面 | 功能 |
| :--- | :--- |
| type | 设备类型管理 |
| device | 设备资产管理 |
| route | 路由编排 |
| mesh | 组网（网状拓扑） |
| policy | 策略配置 |

---

## 三、关键数据实体

| 实体 | 说明 |
| :--- | :--- |
| 设备（Device） | 被管网元的资产记录 |
| 设备类型（Device Type） | 设备型号/角色分类 |
| 路由（Route） | 设备间转发路径 |
| 组网（Mesh） | 设备组网拓扑 |
| 策略（Policy） | 下发到设备的配置策略 |

---

## 四、领域边界与依赖

- **上游依赖**：资产存储（见 `NMCPS-ARCH-002`）、设备访问控制（见 `NMCPS-ARCH-003`）。
- **消费方**：topology（拓扑呈现）、scenario（建模输入）。
- **不承载**：设备运行监控（属 topology 域）、配置下发通道（属通信面 `NMCPS-ARCH-001`）。

---

## 五、演进路线

1. 设备资产台账与类型管理。
2. 路由与组网拓扑编排。
3. 策略配置下发（经通信面 ChangeSet 同步）。

---

## 六、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化设备组网领域基准（定位、功能范围、数据实体、边界、演进）。 |
