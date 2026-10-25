---
title: "文档体系操作手册"
description: "内容中心「先文档、再落码」的操作 runbook：新增受治理文档、注册 docId、更新 doc-map、过守卫、双语镜像与推进 status。"
excerpt: "新增文档、注册 docId、过守卫、双语镜像与推进 status 的 runbook。"
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
---

# 文档体系操作手册

内容中心「先文档、再落码」的操作 runbook。治理规则见 `NMCPS-GOV-001`，权威清单见 `NMCPS-GOV-003`。

## 新增受治理文档

受治理目录：`architecture/`（Tier 0~3）、`records/`（Tier 5）。

1. 写文档，frontmatter 携带 `docId` / `tier` / `authority` / `scope` / `status` / `owner` / `reviewBy`。
2. 在 `shared/constants/docIds.ts` 登记 `docId ↔ 路径` 唯一映射。
3. 在 `doc-map.md`（NMCPS-GOV-003）登记域级地图与文档总表，并追加变更记录。
4. 运行 `pnpm check:doc-system`，六组断言全部通过。

## 新增普通文档

普通目录：`documents/`、`articles/`、`releases/`。

frontmatter 只需 `title` / `createdAt` 等基础字段，无需治理字段，不注册 docId、不更新 doc-map。

## 双语镜像

1. 在 `en/` 下建立与 `cn/` 对齐的镜像文件，docId 一致、路径对齐。
2. 正文与 `title` / `description` 译为英文，治理字段（`tier` / `authority` / `scope` / `status`）保持一致。

## 推进 status

`draft` → 评审 → `baseline`（`authority: normative` 正式生效，正文成为他人依据）。
