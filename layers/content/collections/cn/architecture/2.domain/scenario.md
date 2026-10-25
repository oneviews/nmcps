---
docId: NMCPS-DESIGN-006
title: "场景建模领域基准"
description: "场景建模域（domain.scenario）的 Tier 2 设计基准：任务规划、计划生成、仿真生成与调度编排。本文是 domain.scenario 域的唯一权威。"
excerpt: "任务规划、计划生成、仿真生成与调度编排的领域设计基准。"
keywords:
  - "scenario"
  - "场景"
  - "仿真"
  - "领域基准"
tier: 2
authority: normative
scope:
  - domain.scenario
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-001
  - NMCPS-ARCH-002
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:map"
tags:
  - "领域基准"
  - "场景"
  - "仿真"
---

# 场景建模领域基准（NMCPS-DESIGN-006）

> **本文职责**：`domain.scenario` 域的唯一权威，定义场景建模——任务规划、计划生成、仿真生成与调度编排。数据下发见 `NMCPS-ARCH-001`。
> **目标读者**：实施工程师 / AI 助手。

---

## 一、定位

场景建模是网络管理系统的「演练面」：将网络运行场景抽象为可规划、可仿真的任务模型，支撑预案推演与自动化调度。

---

## 二、功能范围

| 子页面 | 功能 |
| :--- | :--- |
| task-planning | 任务规划 |
| plan-generation | 计划生成 |
| sim-generation | 仿真生成 |
| dispatch | 调度编排 |

---

## 三、关键数据实体

| 实体 | 说明 |
| :--- | :--- |
| 任务（Task） | 规划的最小执行单元 |
| 计划（Plan） | 多任务的编排计划 |
| 仿真（Simulation） | 场景的仿真运行 |
| 调度（Dispatch） | 任务到执行资源的分配 |

---

## 四、领域边界与依赖

- **上游依赖**：拓扑/设备数据（见 `NMCPS-ARCH-002`）、数据下发（见 `NMCPS-ARCH-001`）。
- **消费方**：transmission（任务数据下发）、dashboard（推演结果呈现）。
- **不承载**：底层仿真引擎实现。

---

## 五、演进路线

1. 任务规划与计划生成。
2. 仿真生成（基于拓扑与设备数据）。
3. 调度编排与自动化执行。

---

## 六、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化场景建模领域基准（定位、功能范围、数据实体、边界、演进）。 |
