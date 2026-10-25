---
docId: NMCPS-DESIGN-003
title: "传输管控领域基准"
description: "传输管控域（domain.transmission）的 Tier 2 设计基准：数据传输任务的管控与自动化传输调度。本文是 domain.transmission 域的唯一权威。"
excerpt: "数据传输任务管控与自动化传输调度的领域设计基准。"
keywords:
  - "transmission"
  - "传输"
  - "领域基准"
tier: 2
authority: normative
scope:
  - domain.transmission
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-001
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:send-alt"
tags:
  - "领域基准"
  - "传输"
---

# 传输管控领域基准（NMCPS-DESIGN-003）

> **本文职责**：`domain.transmission` 域的唯一权威，定义传输管控——数据传输任务的管控与自动化传输调度。通信面见 `NMCPS-ARCH-001`。
> **目标读者**：实施工程师 / AI 助手。

---

## 一、定位

传输管控是网络管理系统的「执行面」：对数据传输任务进行编排、管控与自动化调度，保障数据按时、可靠地在边云之间流转。

---

## 二、功能范围

| 子页面 | 功能 |
| :--- | :--- |
| transmit | 数据传输任务管控 |
| auto-transmit | 自动化传输调度 |

---

## 三、关键数据实体

| 实体 | 说明 |
| :--- | :--- |
| 传输任务（Transfer Task） | 一次数据传输的编排单元 |
| 传输调度（Schedule） | 定时/触发式传输策略 |
| 传输状态（Status） | 进行中/成功/失败/重试 |

---

## 四、领域边界与依赖

- **上游依赖**：边云通道与协议栈（见 `NMCPS-ARCH-001`）。
- **消费方**：scenario（仿真/计划的数据下发）、dashboard（传输状态呈现）。
- **不承载**：底层链路调度（属通信面 `NMCPS-ARCH-001`）。

---

## 五、演进路线

1. 传输任务的手动编排与状态追踪。
2. 自动化传输调度（定时/事件触发）。
3. 断点续传与失败重试。

---

## 六、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化传输管控领域基准（定位、功能范围、数据实体、边界、演进）。 |
