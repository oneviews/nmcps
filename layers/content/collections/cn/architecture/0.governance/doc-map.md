---
docId: NMCPS-GOV-003
title: "文档地图与权威索引（Doc Map）"
navigation:
  title: "文档地图"
description: "全仓文档列表的唯一权威（SSOT）：每篇文档的 docId / tier / authority / scope / status 只在本页维护，其余文档一律引用本页。"
excerpt: "全仓文档列表的唯一权威：docId、tier、authority、scope、status 只在此维护。"
keywords:
  - "doc-map"
  - "索引"
  - "权威"
  - "index"
tier: 0
authority: normative
scope:
  - gov.doc-index
status: baseline
version: 0.12.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
createdAt: "2026-10-24"
updatedAt: "2026-10-30"
icon: "carbon:list"
tags:
  - "文档体系"
  - "索引"
  - "权威"
  - "Doc Map"
---

# 文档地图与权威索引（NMCPS-GOV-003）

> **本文职责（SSOT）**：全仓文档列表的唯一权威——每篇文档的 `docId`、层级（tier）、`authority`、`scope`、`status` **只在本页维护**，其余文档一律引用本页，不再各自维护清单。
> **不承载**：提案理由、冲突清单、迁移计划（这些属各篇文档自身）。
> **目标读者**：全体工程师 / AI 助手。

---

## 一、使用规则

1. **找依据**：先看 §三 你的问题属于哪个域 → 打开该域的**唯一权威**（同一 scope 只有一个 `normative`）。
2. **改设计**：改代码前先改对应 Tier 的基准文档；改 Tier 0~1 须先记一条 ADR（Tier 5）。
3. **引用**：低层引用高层即可；高层不在正文引用低层；Tier 5（记录层）永不作依据。
4. **冲突裁决顺序**：代码 / 生成契约 > Tier 0 > 1 > 2 > 3 > 4；Tier 5 不参与。

---

## 二、层级定义（Tier 0~5）

> 权威定义见 `NMCPS-GOV-001`（文档体系章程）§二。此处仅列速查。

| Tier | 名称 | 变化频率 |
| :---: | :--- | :--- |
| 0 | 治理/宪章层 | 极低（变更须 ADR） |
| 1 | 架构层 | 低 |
| 2 | 领域基准层 | 中 |
| 3 | 契约/参考层 | 中 |
| 4 | 作业层 | 高 |
| 5 | 记录层 | 只追加 + supersede |

---

## 三、域级文档地图（每域唯一权威）

> 判定键是 `scope`：同一 scope 只允许一个 `normative`。

| 域 / 主题 | Tier | 唯一权威（docId） | 状态 |
| :--- | :---: | :--- | :--- |
| `gov.doc-system` | 0 | NMCPS-GOV-001 | baseline |
| `gov.doc-index` | 0 | NMCPS-GOV-003 | baseline |
| `arch.transport` | 1 | NMCPS-ARCH-001 | baseline |
| `arch.datasource` | 1 | NMCPS-ARCH-002 | baseline |
| `arch.iam` | 1 | NMCPS-ARCH-003 | baseline |
| `arch.content` | 1 | NMCPS-ARCH-004 | baseline |
| `domain.topology` | 2 | NMCPS-DESIGN-001 | baseline |
| `domain.spectrum` | 2 | NMCPS-DESIGN-002 | baseline |
| `domain.transmission` | 2 | NMCPS-DESIGN-003 | baseline |
| `domain.device` | 2 | NMCPS-DESIGN-004 | baseline |
| `domain.system` | 2 | NMCPS-DESIGN-005 | baseline |
| `domain.scenario` | 2 | NMCPS-DESIGN-006 | baseline |
| `domain.dashboard` | 2 | NMCPS-DESIGN-007 | baseline |
| `contract.shared-types` | 3 | NMCPS-CONTRACT-001 | baseline |
| `contract.metrics` | 3 | NMCPS-CONTRACT-002 | baseline |

**预留域（待建）**：暂无。

---

## 四、文档总表

| docId | 文档 | tier | authority | scope | status | 路径 |
| :--- | :--- | :---: | :---: | :--- | :---: | :--- |
| NMCPS-GOV-001 | 文档体系章程 | 0 | normative | gov.doc-system | baseline | architecture/0.governance/doc-system-charter.md |
| NMCPS-GOV-003 | 文档地图 | 0 | normative | gov.doc-index | baseline | architecture/0.governance/doc-map.md |
| NMCPS-ADR-0001 | 模块改名 | 5 | informative | rec.adr.0001 | baseline | records/adr/adr-0001.md |
| NMCPS-ADR-0002 | 路由中英文命名规范 | 5 | informative | rec.adr.0002 | baseline | records/adr/adr-0002.md |
| NMCPS-ADR-0003 | 路由排序规范 | 5 | informative | rec.adr.0003 | baseline | records/adr/adr-0003.md |
| NMCPS-ADR-0004 | 权威金字塔落地 | 5 | informative | rec.adr.0004 | baseline | records/adr/adr-0004.md |
| NMCPS-ADR-0005 | 双语镜像与接入 | 5 | informative | rec.adr.0005 | baseline | records/adr/adr-0005.md |
| NMCPS-ADR-0006 | 桌面端自动更新入口 | 5 | informative | rec.adr.0006 | baseline | records/adr/adr-0006.md |
| NMCPS-ADR-0007 | Nitro BFF 网关 | 5 | informative | rec.adr.0007 | baseline | records/adr/adr-0007.md |
| NMCPS-ADR-0008 | 下载落地页恢复 | 5 | informative | rec.adr.0008 | baseline | records/adr/adr-0008.md |
| NMCPS-ADR-0010 | 就绪探针与 SSE 透传 | 5 | informative | rec.adr.0010 | baseline | records/adr/adr-0010.md |
| NMCPS-ARCH-001 | 通信面架构 | 1 | normative | arch.transport | baseline | architecture/1.architecture/transport-architecture.md |
| NMCPS-ARCH-002 | 数据源架构 | 1 | normative | arch.datasource | baseline | architecture/1.architecture/datasource-architecture.md |
| NMCPS-ARCH-003 | IAM 架构 | 1 | normative | arch.iam | baseline | architecture/1.architecture/iam-architecture.md |
| NMCPS-ARCH-004 | 内容中心架构 | 1 | normative | arch.content | baseline | architecture/1.architecture/content-center-architecture.md |
| NMCPS-DESIGN-001 | 拓扑监控领域基准 | 2 | normative | domain.topology | baseline | architecture/2.domain/topology.md |
| NMCPS-DESIGN-002 | 频谱管控领域基准 | 2 | normative | domain.spectrum | baseline | architecture/2.domain/spectrum.md |
| NMCPS-DESIGN-003 | 传输管控领域基准 | 2 | normative | domain.transmission | baseline | architecture/2.domain/transmission.md |
| NMCPS-DESIGN-004 | 设备组网领域基准 | 2 | normative | domain.device | baseline | architecture/2.domain/device.md |
| NMCPS-DESIGN-005 | 系统管理领域基准 | 2 | normative | domain.system | baseline | architecture/2.domain/system.md |
| NMCPS-DESIGN-006 | 场景建模领域基准 | 2 | normative | domain.scenario | baseline | architecture/2.domain/scenario.md |
| NMCPS-DESIGN-007 | 仪表盘领域基准 | 2 | normative | domain.dashboard | baseline | architecture/2.domain/dashboard.md |
| NMCPS-CONTRACT-001 | 共享类型契约 | 3 | normative | contract.shared-types | baseline | architecture/3.contract/shared-types.md |
| NMCPS-CONTRACT-002 | 指标契约 | 3 | normative | contract.metrics | baseline | architecture/3.contract/metrics.md |

> 路径为相对 `layers/content/collections/cn/` 的相对路径；`en/` 为镜像集合，docId 一致。

---

## 五、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-24 | 0.1.0 | 首版：登记 GOV-001、GOV-003，定义域级地图骨架与预留域。 |
| 2026-10-24 | 0.2.0 | 登记首批记录层 ADR：0001 模块改名 / 0002 命名规范 / 0003 排序（Tier 5，informative）。 |
| 2026-10-24 | 0.3.0 | 登记 S1 架构层：ARCH-004 内容中心架构（Tier 1，normative）。 |
| 2026-10-25 | 0.4.0 | 登记 S1 架构层：ARCH-001 通信面 / ARCH-002 数据源 / ARCH-003 IAM（Tier 1，normative）。 |
| 2026-10-25 | 0.5.0 | 登记 S2 领域基准：DESIGN-001~007（topology / spectrum / transmission / device / system / scenario / dashboard，Tier 2，normative）。 |
| 2026-10-25 | 0.6.0 | 登记 S3 契约层：CONTRACT-001 共享类型 / CONTRACT-002 指标契约（Tier 3，normative）。 |
| 2026-10-25 | 0.7.0 | 登记记录层 ADR：0004 权威金字塔落地 / 0005 en 双语镜像与接入（Tier 5，informative）。 |
| 2026-10-25 | 0.8.0 | Tier 0~3 全部推进为 baseline（评审通过，authority 正式生效）。 |
| 2026-10-28 | 0.9.0 | 登记记录层 ADR：0006 桌面端自动更新入口（Tier 5，informative）。 |
| 2026-10-28 | 0.10.0 | 登记记录层 ADR：0007 启用 Nitro BFF 网关与 server/shared 目录（Tier 5，informative）。 |
| 2026-10-29 | 0.11.0 | 登记记录层 ADR：0008 恢复站点下载落地页与首页入口（Tier 5，informative）。 |
| 2026-10-30 | 0.12.0 | 登记记录层 ADR：0010 BFF 上游就绪探针与 SSE 流式透传（Tier 5，informative；0009 由 ADR-0008 预留给会话/令牌模型）。 |
