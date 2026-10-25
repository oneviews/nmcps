---
docId: NMCPS-GOV-001
title: "Documentation System Charter"
navigation:
  title: "Documentation System Charter"
description: "The constitution of the NMCPS V2 documentation system (Docs-as-Code): the authority pyramid (Tier 0~5), the single-source-of-truth allocation table, the docId contract, hard governance constraints, and the docs-before-code workflow. This is the highest authority of the content center development-doc infrastructure."
excerpt: "The supreme authority: pyramid, SSOT, docId contract and guards."
keywords:
  - "governance"
  - "docs-as-code"
  - "charter"
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
  - "Governance"
  - "Docs-as-Code"
  - "Content Center"
---

# Documentation System Charter (NMCPS-GOV-001)

> **Responsibility**: the highest authority of the content center development-doc infrastructure — how docs are written, where they live, who decides, and how they are machine-guarded.
> **Audience**: project lead / architecture & implementation engineers / AI assistants.
> **Status**: approved (baseline); `authority: normative` is in effect and the body is binding.

---

## 1. Goals & Principles

Three inviolable principles:

1. **Docs-as-Code**: docs live in the same repo, version, and gate as code, reviewed and guarded with every PR.
2. **Authority layering**: every doc has a `tier` (0~5), an `authority` (normative / informative), a unique `scope`, and a `docId`.
3. **Docs before code**: any code change requires a corresponding Tier doc or ADR, passing the `check:doc-system` guard first.

---

## 2. Authority Pyramid (Tier 0~5)

| Tier | Name | Content | Change frequency |
| :---: | :--- | :--- | :--- |
| **0** | Governance/charter | `.clinerules`, this charter, doc-map | Very low (ADR required) |
| **1** | Architecture | Cross-domain: transport, data source, content center, IAM, shared contract | Low |
| **2** | Domain baseline | One design baseline per domain | Medium |
| **3** | Contract/reference | Types, OpenAPI, DB tables, syntax specs (machine-checkable first) | Medium |
| **4** | Operations | how-to / runbook / tuning / demo scripts | High |
| **5** | Records | ADR (one per decision), postmortems | Append-only + supersede |

**Reference rules**:

- Lower tiers reference higher tiers; higher tiers never reference lower tiers in body (only in index/map).
- Tier 5 (records) is never a source of authority.
- Conflict resolution order: code/generated contracts > Tier 0 > 1 > 2 > 3 > 4; Tier 5 does not participate.

---

## 3. Single Source of Truth (SSOT) Allocation

| Content | SSOT | Location | Consumer |
| :--- | :--- | :--- | :--- |
| Behavior rules (how to code/git/docs) | `.clinerules/` | Repo root | AI agent |
| Doc authority index (which is normative) | doc-map (`NMCPS-GOV-003`) | Content collections | Human + guard |
| Per-doc metadata (tier/authority/scope) | frontmatter | Content collections | Guard |
| The charter itself | This doc (`NMCPS-GOV-001`) | Content collections | Human |
| docId ↔ path mapping | `shared/constants/docIds.ts` | Codebase | Nuxt + node scripts |

---

## 4. docId System

- Naming: `NMCPS-{GOV|ARCH|DESIGN|CONTRACT|ADR|REC}-{NNNN}`.
- Globally unique; `shared/constants/docIds.ts` maintains the `docId ↔ path` mapping (pure data + pure functions).
- Code comments, scripts, and doc cross-references always use `docId (path)`; never hardcode doc paths.

---

## 5. Metadata Contract (frontmatter schema)

> Fields fall into "basic / governance / navigation" layers; "governed" = `architecture/`, `records/`; "plain" = `documents/`, `articles/`, `releases/`.

| Layer | Field | Governed | Plain |
| :--- | :--- | :---: | :---: |
| Basic | `title` | ✅ | ✅ |
| Basic | `description` / `excerpt` / `icon` / `tags` / `keywords` / `author` / `updatedAt` / `version` | ⬜ | ⬜ |
| Basic | `createdAt` | ⬜ | ✅ |
| Governance | `docId` / `tier` / `authority` / `scope` / `status` / `owner` | ✅ | ✗ |
| Governance | `reviewBy` / `dependsOn` / `supersedes` / `supersededBy` | ⬜ | ✗ |
| Navigation | `navigation.title` | ⬜ | ⬜ |

**Division of labor**: the zod schema in `content.config.ts` only declares field existence and types (all optional); the requiredness of governed docs is decided by `check:doc-system` per directory (`architecture/`, `records/`).

---

## 6. Hard Governance Constraints

1. `.clinerules/` must not hand-write any doc index, only behavior rules + a pointer to doc-map.
2. doc-map (`NMCPS-GOV-003`) is generated from frontmatter; any hand-written index is illegal.
3. `check:doc-system` validates `.clinerules` pointer → doc-map → frontmatter consistency; dangling or drifted references fail.

---

## 7. Docs-Before-Code Workflow

```text
Need → ① locate domain & tier
     → ② write docs (new domain → Tier 2 baseline / change Tier 1 → ADR first / record → Tier 5)
     → ③ register docId + pass check:doc-system
     → ④ review & approve (status → baseline, authority → normative)
     → ⑤ code allowed; references always via docId
```

---

## 8. Phased Rollout (S0~S3)

| Phase | Deliverable | Content |
| :--- | :--- | :--- |
| **S0 Foundation** | Governance + contract + guard | `@nuxt/content`; collections; frontmatter schema; `check:doc-system`; `.clinerules/`; this charter + doc-map |
| **S1 Architecture** | Tier 1 | transport / data source / content center / IAM / shared contract, one normative each |
| **S2 Domain baselines** | Tier 2 | one design baseline per built module |
| **S3 Records** | Tier 5 | backfill decisions as ADRs |

---

## 9. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-24 | 0.1.0 | Initial: principles, Tier 0~5, SSOT, docId, hard constraints, workflow, S0~S3. |
| 2026-10-24 | 0.2.0 | Added §5 metadata contract (field table): three layers, governed vs plain, excerpt/keywords, schema/guard division, removed contentType/accessLevel. |
| 2026-10-25 | 0.3.0 | Authority pyramid rolled out (Tier 1~3) and promoted to baseline; registered ADR-0004 rollout / ADR-0005 bilingual mirror. |

