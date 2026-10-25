---
docId: NMCPS-ARCH-004
title: "Content Center Architecture"
description: "Tier 1 architecture baseline for the content center (Docs-as-Code documentation system): tech stack, collection structure, document governance, route planning, bilingual strategy, and data flow. This is the single authority for the arch.content domain."
excerpt: "Content center tech stack, collections, governance, routes and data flow."
keywords:
  - "content"
  - "architecture"
  - "docs-as-code"
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
  - "Architecture"
  - "Content Center"
  - "Docs-as-Code"
---

# Content Center Architecture (NMCPS-ARCH-004)

> **Responsibility**: single authority for `arch.content` — the architecture of the content center (Docs-as-Code). Governance rules and tiers: `NMCPS-GOV-001`; authority index: `NMCPS-GOV-003`.
> **Audience**: architecture and implementation engineers / AI assistants.

---

## 1. Positioning

The content center is the carrier of "docs before code": all development architecture docs (Tier 0~3), decision records (Tier 5), user-facing docs, and release notes live here, versioned and gated with the code.

---

## 2. Tech Stack

| Component | Choice | Note |
| :--- | :--- | :--- |
| Content engine | `@nuxt/content` v3 | Git-based, no database |
| Content database | `better-sqlite3` | Build/dev only |
| Collection definition | `content.config.ts` (root SSOT) | Defines collections and frontmatter schema |
| Bilingual | `collections/{cn,en}/` | Aligned with i18n (cn/en) |

---

## 3. Collection Structure

```text
layers/content/collections/{cn,en}/
  architecture/          # Tier 0~3 dev architecture docs
    0.governance/        # Tier 0: charter, doc-map
    1.architecture/      # Tier 1: cross-domain architecture
    2.domain/            # Tier 2: domain baselines
    3.contract/          # Tier 3: contracts/reference
  records/               # Tier 5: record layer
    adr/                 # ADR (one decision per file)
  documents/             # user-facing docs
  articles/              # technical blog
  releases/              # release notes
```

`cn` is the authoritative language; `en` is the mirror (same docId, aligned paths).

---

## 4. Document Governance

- **Authority pyramid**: Tier 0~5 (defined in `NMCPS-GOV-001` §2).
- **docId contract**: governed docs (`architecture/`, `records/`) carry `docId` / `tier` / `authority` / `scope` / `status` in frontmatter; the `docId ↔ path` mapping lives in `shared/constants/docIds.ts`.
- **Guard**: `pnpm check:doc-system` (six assertions: uniqueness / completeness / reference closure / acyclicity / tier validity / staleness warnings).
- **Single source of truth**: the authority index is `NMCPS-GOV-003` (doc-map); `.clinerules` only points to it.

---

## 5. Routes & Pages

| Route | Name | Collection | Status |
| :--- | :--- | :--- | :--- |
| `/content` | Content center | — | Redirect to `/content/document` |
| `/content/document` | System docs | documents/ | Placeholder (pending) |
| `/content/article` | Blog | articles/ | Placeholder (pending) |
| `/content/release` | Release notes | releases/ | Placeholder (pending) |
| `/content/metadata` | File management | filesystem | Placeholder (pending) |

---

## 6. Data Flow

```text
content files (collections/*.md)
  → @nuxt/content parse (content.config.ts validates frontmatter)
  → content_cn / content_en collections
  → UI (queryCollection())
```

---

## 7. Roadmap

1. Implement sub-routes (document / article / release / metadata) with `queryCollection()`.
2. Content center search (command palette / UDashboardSearch integration).
3. Complete the `en/` mirror (currently cn only).
4. Generate doc-map from frontmatter automatically.

---

## 8. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-24 | 0.1.0 | Initial: content center architecture (tech stack, collections, governance, routes, data flow, roadmap). |
