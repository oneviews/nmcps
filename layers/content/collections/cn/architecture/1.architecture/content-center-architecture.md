---
docId: NMCPS-ARCH-004
title: "内容中心架构"
description: "内容中心（Docs-as-Code 文档系统）的 Tier 1 架构基准：技术栈、集合结构、文档治理、路由规划、双语策略与数据流。本文是 arch.content 域的唯一权威。"
excerpt: "内容中心的技术栈、集合结构、文档治理、路由与数据流的架构基准。"
keywords:
  - "content"
  - "architecture"
  - "内容中心"
  - "架构"
tier: 1
authority: normative
scope:
  - arch.content
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-10-24"
updatedAt: "2026-10-24"
icon: "carbon:document"
tags:
  - "架构"
  - "内容中心"
  - "Docs-as-Code"
---

# 内容中心架构（NMCPS-ARCH-004）

> **本文职责**：`arch.content` 域的唯一权威，定义内容中心（Docs-as-Code 文档系统）的架构。治理规则与 Tier 定义见 `NMCPS-GOV-001`，文档权威清单见 `NMCPS-GOV-003`。
> **目标读者**：架构与实施工程师 / AI 助手。

---

## 一、定位

内容中心是「先文档、再落码」的载体：所有开发架构文档（Tier 0~3）、决策记录（Tier 5）、用户向文档与发布日志都存放在这里，随代码同仓、同版本、同门禁。

---

## 二、技术栈

| 组件 | 选型 | 说明 |
| :--- | :--- | :--- |
| 内容引擎 | `@nuxt/content` v3 | Git-based，无数据库 |
| 内容数据库 | `better-sqlite3` | 仅构建 / 开发期使用 |
| 集合定义 | `content.config.ts`（根级 SSOT） | 定义集合与 frontmatter schema |
| 双语 | `collections/{cn,en}/` | 与 i18n（cn/en）对齐 |

---

## 三、集合结构

```
layers/content/collections/{cn,en}/
  architecture/          # Tier 0~3 开发架构文档（治理/架构/领域/契约）
    0.governance/        # Tier 0：章程、doc-map
    1.architecture/      # Tier 1：跨域架构
    2.domain/            # Tier 2：领域基准
    3.contract/          # Tier 3：契约/参考
  records/               # Tier 5：记录层
    adr/                 # ADR（一决策一文件）
  documents/             # 用户向文档
    1.getting-started/ 2.product/ 3.operations/ 4.manual/
  articles/              # 技术博客（纯博客，不混设计文档）
  releases/              # 发布日志
```

`cn` 为权威语言，`en` 为镜像（docId 一致、路径对齐）。

---

## 四、文档治理

- **权威金字塔**：Tier 0~5（定义见 `NMCPS-GOV-001` §二）。
- **docId 契约**：受治理文档（`architecture/`、`records/`）frontmatter 携带 `docId` / `tier` / `authority` / `scope` / `status`；`docId ↔ 路径` 唯一映射见 `shared/constants/docIds.ts`。
- **守卫**：`pnpm check:doc-system`（六组断言：唯一性 / 完整性 / 引用闭合 / 无环 / 层级合法 / 老化告警）。
- **单一事实源**：权威清单以 `NMCPS-GOV-003`（doc-map）为准，`.clinerules` 不手写清单，只做指针。

---

## 五、路由与页面

| 路由 | 名称 | 集合 | 现状 |
| :--- | :--- | :--- | :--- |
| `/content` | 内容中心 | — | 重定向到 `/content/architecture` |
| `/content/architecture` | 开发架构 | architecture/ | 架构文档列表（按子目录分类卡片） |
| `/content/records` | 变更记录 | records/ | 决策记录与版本更新列表 |
| `/content/documents` | 技术手册 | documents/ | 技术手册列表 |
| `/content/articles` | 技术博客 | articles/ | 技术博客列表 |
| `/content/metadata` | 文件管理 | 文件系统 | 占位页（待实现） |

> 子路由与目录树一一对应：`architecture/` → `/content/architecture`、`records/`（含 `adr/` + `releases/`）→ `/content/records`、`documents/` → `/content/documents`、`articles/` → `/content/articles`。

---

## 六、数据流

```
content 文件（collections/*.md）
  → @nuxt/content 解析（content.config.ts 校验 frontmatter）
  → content_cn / content_en 集合
  → UI（queryCollection() 查询）
```

---

## 七、演进路线（待建清单）

1. 实现子路由（document / article / release / metadata），从占位页改为 `queryCollection()` 查询。
2. 内容中心搜索（命令面板 / UDashboardSearch 集成）。
3. `en/` 镜像的补全（当前仅 cn）。
4. doc-map 由 frontmatter 自动生成（当前为手维护 + 守卫校验 DOC_PATHS）。

---

## 八、变更记录

| 日期 | 版本 | 变更 |
| :--- | :--- | :--- |
| 2026-10-24 | 0.1.0 | 首版：固化内容中心架构（技术栈、集合结构、治理、路由、数据流、演进路线）。 |
