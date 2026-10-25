---
docId: NMCPS-GOV-001
title: "文档体系章程（Documentation System Charter）"
navigation:
  title: "文档体系章程"
description: "NMCPS V2 文档体系（Docs-as-Code）的宪章：权威金字塔（Tier 0~5）、单一事实源分配表、docId 契约、治理硬约束与「先文档、再落码」工作流。本文是内容中心开发文档基础设施的最高依据。"
excerpt: "内容中心开发文档基础设施的最高依据：权威金字塔、单一事实源、docId 契约与守卫。"
keywords:
  - "governance"
  - "治理"
  - "docs-as-code"
  - "文档体系"
  - "章程"
tier: 0
authority: normative
scope:
  - gov.doc-system
status: baseline
version: 0.3.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn: []
createdAt: "2026-10-24"
updatedAt: "2026-10-24"
icon: "carbon:document"
tags:
  - "文档体系"
  - "治理"
  - "Docs-as-Code"
  - "ADR"
  - "内容中心"
---

# 文档体系章程（NMCPS-GOV-001）

> **本文职责**：内容中心开发文档基础设施的最高依据，规定「文档怎么写、放在哪、谁说了算、如何被机器守卫」。
> **目标读者**：项目负责人 / 架构与实施工程师 / AI 助手。
> **状态**：已批准（baseline）；`authority` 保持 `normative` 并正式生效，正文成为他人依据。

---

## 一、目标与原则

本体系遵循三条不可动摇的原则：

1. **Docs-as-Code**：文档与代码同仓、同版本、同门禁，随 PR 一起评审、一起守卫。
2. **权威分层**：每篇文档拥有 `tier`（0~5）、`authority`（normative / informative）、唯一 `scope` 与 `docId`。
3. **先文档、再落码**：任何代码改动，必须先有对应 Tier 的文档或 ADR，并通过 `check:doc-system` 守卫后才允许落码。

---

## 二、权威金字塔（Tier 0~5）

| Tier | 名称 | 内容 | 变化频率 |
| :---: | :--- | :--- | :--- |
| **0** | 治理/宪章层 | `.clinerules`（项目规则）、文档体系章程（本文）、文档地图（doc-map） | 极低（变更须 ADR） |
| **1** | 架构层 | 系统级跨域：通信面、数据源、内容中心、IAM、共享契约 | 低 |
| **2** | 领域基准层 | 每个域一份唯一设计基准（topology / spectrum / transmission / device / system…） | 中（随域演进） |
| **3** | 契约/参考层 | 类型、OpenAPI、数据库表、语法规范（可机检者优先） | 中 |
| **4** | 作业层 | how-to / runbook / 环境调优 / 演示脚本 | 高（可随时更新） |
| **5** | 记录层 | ADR（一决策一文件）、排障复盘、专利交底 | 只追加 + supersede |

**引用铁律**：

- 低层引用高层即可；**高层不得在正文引用低层**（只允许在「索引 / 地图」中提及）。
- Tier 5（记录层）**永不作依据**。
- 冲突裁决顺序：代码 / 生成契约（可执行事实） > Tier 0 > Tier 1 > Tier 2 > Tier 3 > Tier 4；Tier 5 不参与裁决。

---

## 三、单一事实源分配表（SSOT，核心）

> 本表回答「每一类治理信息唯一放在哪里、由谁消费」。**任何信息只允许有一个事实源**，其余位置一律以指针引用，禁止复制手写。

| 内容 | 唯一事实源 | 位置 | 消费者 |
| :--- | :--- | :--- | :--- |
| 行为规则（怎么写代码 / git / 文档） | `.clinerules/` | 仓库根目录 | AI agent |
| 文档权威清单（哪篇是 normative） | doc-map（`NMCPS-GOV-003`） | 内容中心 collections | 人类 + 守卫 |
| 每篇文档的元数据（tier / authority / scope） | frontmatter | 内容中心 collections | 守卫 |
| 文档体系章程 | 本文（`NMCPS-GOV-001`） | 内容中心 collections | 人类 |
| docId ↔ 路径唯一映射 | `shared/constants/docIds.ts` | 代码库 | Nuxt 侧 + node 脚本 |

**推论（与 v1 的差异）**：

- `.clinerules/` 是给机器看的「怎么干」，内容中心是给人看的「是什么 / 为什么」；两者是同一套治理的两个投影，**不强行合并**。
- `.clinerules/` **禁止手写任何文档清单**，只保留行为规则 + 一句指针：「文档权威清单见 `NMCPS-GOV-003`」。
- doc-map 由 frontmatter **自动生成**，不手写（治 v1 `.clinerules` §6 手写权威清单仅覆盖 6/21 篇的漂移病）。
- 本表自身的变更，须记一条 Tier 5 ADR。

---

## 四、docId 体系

- 命名：`NMCPS-{GOV|ARCH|DESIGN|CONTRACT|ADR|REC}-{NNNN}`（前缀 + 四位序号）。
- 全仓唯一；`shared/constants/docIds.ts` 维护 `docId ↔ 文件路径` 唯一映射（纯数据 + 纯函数）。
- 代码注释、脚本、文档互引一律写 `docId（路径）`，**禁止硬编码文档路径**。

---

## 五、元数据契约（frontmatter schema）

> 字段分「基础 / 治理 / 导航」三层；「受治理」= `architecture/`、`records/` 目录，「普通」= `documents/`、`articles/`、`releases/`。

| 层 | 字段 | 受治理 | 普通 | 说明 |
| :--- | :--- | :---: | :---: | :--- |
| 基础 | `title` | ✅ | ✅ | 标题 |
| 基础 | `description` | ⬜ | ⬜ | 完整描述（SEO / 文档头） |
| 基础 | `excerpt` | ⬜ | ⬜ | 短摘要（列表卡片，≤80 字） |
| 基础 | `icon` | ⬜ | ⬜ | 图标 |
| 基础 | `tags` | ⬜ | ⬜ | 分类标签（展示） |
| 基础 | `keywords` | ⬜ | ⬜ | 检索关键词（搜索，不展示） |
| 基础 | `author` | ⬜ | ⬜ | 作者 |
| 基础 | `createdAt` | ⬜ | ✅ | 创建日期 |
| 基础 | `updatedAt` | ⬜ | ⬜ | 更新日期（老化告警） |
| 基础 | `version` | ⬜ | ⬜ | 版本号 |
| 治理 | `docId` | ✅ | ✗ | 稳定标识 |
| 治理 | `tier` | ✅ | ✗ | 层级 0~5 |
| 治理 | `authority` | ✅ | ✗ | normative / informative |
| 治理 | `scope` | ✅ | ✗ | 唯一权威键 |
| 治理 | `status` | ✅ | ✗ | draft / review / baseline / deprecated / superseded |
| 治理 | `owner` | ✅ | ✗ | 责任人 |
| 治理 | `reviewBy` | ⬜ | ✗ | 老化截止 |
| 治理 | `dependsOn` | ⬜ | ✗ | 依赖 DAG |
| 治理 | `supersedes` | ⬜ | ✗ | 作废了谁 |
| 治理 | `supersededBy` | ⬜ | ✗ | 被谁取代 |
| 导航 | `navigation.title` | ⬜ | ⬜ | 导航标签覆盖 |

**分工（与 v1 的差异）**：`content.config.ts` 的 zod schema 只声明「字段存在性与类型」（全 optional）；「受治理文档的必填性」由 `check:doc-system` 守卫按目录（`architecture/`、`records/`）统一裁决。此分工显式写死，消除 v1「schema optional vs 设计必填」的含糊。

**已删除字段（相对 v1）**：`contentType`（内容类型由目录结构编码）、`accessLevel`（V2 内部工具无需权限分级）。

---

## 六、治理硬约束（三条）

1. `.clinerules/` 不得手写任何文档清单，只保留行为规则与指向 doc-map 的指针。
2. doc-map（`NMCPS-GOV-003`）由 frontmatter 自动生成，任何手写清单一律判非法。
3. `check:doc-system` 守卫校验「`.clinerules` 指针 → doc-map → frontmatter」三者一致：引用的 docId 必须存在且元数据一致，死链 / 漂移即失败。

---

## 七、先文档、再落码工作流

```
需求 → ① 定位所属域与 Tier
      → ② 写文档（新域写 Tier 2 基准 / 改 Tier 1 先记 ADR / 记录进 Tier 5）
      → ③ 注册 docId + 过 check:doc-system
      → ④ 评审通过（status 升 baseline、authority 升 normative）
      → ⑤ 才允许落码；代码引用一律走 docId
```

---

## 八、分阶段落地（S0~S3）

| 阶段 | 交付 | 内容 |
| :--- | :--- | :--- |
| **S0 奠基** | 治理 + 契约 + 守卫 | 接入 `@nuxt/content`；建 collections；定 frontmatter schema；写 `check:doc-system`；重组 `.clinerules/`；落本文 + doc-map |
| **S1 架构层** | Tier 1 | 通信面 / 数据源 / 内容中心 / IAM / 共享契约 各一篇 normative 架构文档 |
| **S2 领域基准** | Tier 2 | 每个已建模块（topology / spectrum / transmission / device / system…）一份唯一设计基准 |
| **S3 记录层** | Tier 5 | 把已发生的决策（模块改名 / 命名规范 / 排序）回填为 ADR，作为首批记录 |

---

## 九、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-24 | 0.1.0 | 首版：目标原则、Tier 0~5、单一事实源分配表、docId 体系、三条治理硬约束、先文档再落码工作流、S0~S3 分期。 |
| 2026-10-24 | 0.2.0 | 新增 §五 元数据契约（frontmatter 字段表）：基础/治理/导航三层、受治理 vs 普通两级、excerpt/keywords 字段、schema 与守卫分工、删除 contentType/accessLevel。 |
| 2026-10-25 | 0.3.0 | 权威金字塔落地（Tier 1~3）并整体推进为 baseline；登记 ADR-0004 金字塔落地 / ADR-0005 双语镜像。 |
