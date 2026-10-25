---
docId: NMCPS-DESIGN-001
title: "拓扑监控领域基准"
description: "拓扑监控域（domain.topology）的 Tier 2 设计基准：网络设备与链路的拓扑可视化、设备/链路监控指标采集与展示。本文是 domain.topology 域的唯一权威。"
excerpt: "网络设备与链路的拓扑可视化、设备/链路监控指标的领域设计基准。"
keywords:
  - "topology"
  - "拓扑"
  - "监控"
  - "领域基准"
tier: 2
authority: normative
scope:
  - domain.topology
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
icon: "carbon:cloud-monitoring"
tags:
  - "领域基准"
  - "拓扑"
  - "监控"
---

# 拓扑监控领域基准（NMCPS-DESIGN-001）

> **本文职责**：`domain.topology` 域的唯一权威，定义拓扑监控——网络设备与链路的拓扑可视化、监控指标采集与展示。通信采集见 `NMCPS-ARCH-001`，数据存储见 `NMCPS-ARCH-002`。
> **目标读者**：实施工程师 / AI 助手。

---

## 一、定位

拓扑监控是网络管理系统的「观测面」：以图形化方式呈现设备节点与链路关系，实时监控设备与链路的运行指标，为故障定位与容量规划提供依据。

---

## 二、功能范围

| 子页面 | 功能 |
| :--- | :--- |
| monitor | 网络拓扑图与全局监控总览 |
| link-metrics | 链路指标（带宽、时延、丢包） |
| device-metrics | 设备指标（CPU、内存、端口流量） |

---

## 三、关键数据实体

| 实体 | 说明 |
| :--- | :--- |
| 设备节点（Device Node） | 路由器/交换机/防火墙等网元 |
| 链路（Link） | 设备间的物理/逻辑连接 |
| 拓扑图（Topology） | 节点 + 链路的可视化模型 |
| 指标（Metric） | 设备/链路的时序监控数据（存 TSDB） |

---

## 四、领域边界与依赖

- **上游依赖**：设备采集（SNMP，见 `NMCPS-ARCH-001`）、指标存储（TSDB，见 `NMCPS-ARCH-002`）。
- **消费方**：dashboard（总览）、scenario（建模输入）。
- **不承载**：设备配置下发（属 device 域）、告警规则管理（属 system 域）。

---

## 五、演进路线

1. 拓扑图渲染（Canvas/SVG 节点 + 链路）。
2. 设备类型图标自动匹配（按设备类型选图）。
3. 设备/链路指标实时刷新与告警联动。

---

## 六、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化拓扑监控领域基准（定位、功能范围、数据实体、边界、演进）。 |
