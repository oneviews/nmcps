---
docId: NMCPS-ARCH-002
title: "数据源架构"
description: "数据源（arch.datasource）的 Tier 1 架构基准：数据源分类（设备采集/指标/告警/资产配置）、存储分层（RDBMS 控制 + TSDB 时序）、云端/边缘数据适配层与统一数据流转。本文是 arch.datasource 域的唯一权威。"
excerpt: "数据源分类、RDBMS+TSDB 存储分层与云边数据适配层的数据源架构基准。"
keywords:
  - "datasource"
  - "architecture"
  - "数据源"
  - "架构"
  - "存储分层"
tier: 1
authority: normative
scope:
  - arch.datasource
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:data-base"
tags:
  - "架构"
  - "数据源"
  - "存储分层"
---

# 数据源架构（NMCPS-ARCH-002）

> **本文职责**：`arch.datasource` 域的唯一权威，定义系统「数据源」——数据从哪里采集、如何分层存储、云边两侧如何用同一套接口读写。通信流的协议与拓扑见 `NMCPS-ARCH-001`，治理规则见 `NMCPS-GOV-001`。
> **目标读者**：架构与实施工程师 / AI 助手。

---

## 一、定位

数据源是网络管理系统的「记忆」：控制数据（资产、配置、身份）需要强一致，时序指标需要高吞吐。二者用不同存储引擎承载，是读写性能解耦的前提。

---

## 二、数据源分类

| 数据源 | 内容 | 时效性 | 存储 |
| :--- | :--- | :--- | :--- |
| 设备采集 | SNMP 轮询的设备状态、MIB 数据 | 实时 | 边缘采集 → 云端 TSDB |
| 指标流 | 高频监控指标（端口流量、CPU、内存） | 实时 | TSDB |
| 告警事件 | 边缘本地判定的告警 | 实时 | RDBMS（经 MQTT 上报） |
| 资产与配置 | 设备资产、配置变更、身份 | 强一致 | RDBMS |

---

## 三、存储分层

| 层 | 引擎 | 承载 | 特征 |
| :--- | :--- | :--- | :--- |
| 控制存储 | RDBMS（PostgreSQL / Supabase） | 资产、配置、身份、审计 | 强一致、行级安全（RLS） |
| 时序存储 | TSDB（VictoriaMetrics） | 监控指标 | 高吞吐、压缩、降采样 |
| 边缘本地 | PocketBase / SQLite | 边缘离线自治 | 轻量（< 50MB）、单二进制 |

控制流与数据流的读写分离，避免高频指标写入冲击控制数据的强一致事务（见 `NMCPS-ARCH-001` §三）。

---

## 四、数据适配层（云边同构）

基于 Nuxt Layers 机制，云边两侧通过**同一套 Composables 接口**访问各自数据源，实现代码高复用：

| 适配层 | 后端 | 使用端 |
| :--- | :--- | :--- |
| layer-supabase | Supabase SDK + go-zero API Gateway | 云端总控台 |
| layer-pocketbase | PocketBase SDK + 边缘 Go Daemon | 边缘本地自治 UI |

两侧对外暴露完全一致的 Composables 接口；云端应用与边缘应用只组合不同适配层，UI 组件与业务逻辑共享。

---

## 五、数据流转

```text
设备（SNMP/Agent）
  → 边缘采集（Exporter / Go Daemon）
  → 指标直通云端 TSDB / 告警经 MQTT 上云 / 配置经 ChangeSet 同步
  → 云端 RDBMS（控制）+ TSDB（时序）
  → 总控台 UI（queryCollection / Composables 读取）
```

---

## 六、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | 首版：固化数据源架构（分类、存储分层、云边数据适配层、数据流转）。 |
