---
title: "Doc System Runbook"
description: "Runbook for the content center docs-before-code workflow: adding governed docs, registering docId, updating doc-map, passing the guard, bilingual mirroring, and promoting status."
excerpt: "Add docs, register docId, pass guard, bilingual mirror, promote status."
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:book"
---

# Doc System Runbook

Runbook for the docs-before-code workflow. Governance: `NMCPS-GOV-001`; authority index: `NMCPS-GOV-003`.

## Add a Governed Doc

Governed directories: `architecture/` (Tier 0~3), `records/` (Tier 5).

1. Write the doc with `docId` / `tier` / `authority` / `scope` / `status` / `owner` / `reviewBy` / `icon` in frontmatter.
2. Register the `docId ↔ path` mapping in `shared/constants/docIds.ts`.
3. Register the domain map and document table in `doc-map.md` (NMCPS-GOV-003), and append a changelog entry.
4. Run `pnpm check:doc-system`; all six assertions must pass.

## Add a Plain Doc

Plain directories: `documents/`, `articles/`, `releases/`.

Basic fields (`title` / `createdAt` / `icon`) are required; no governance fields, no docId registration, no doc-map update. Assign a directory-appropriate icon (`architecture/` = `carbon:catalog`, `records/` = `carbon:decision-tree`, `documents/` = `carbon:book`, `releases/` = `carbon:launch`, `articles/` = `carbon:blog`); it must not be empty.

## Bilingual Mirror

1. Create a mirror file under `en/` aligned to `cn/`, same docId, aligned paths.
2. Translate the body and `title` / `description`; keep governance fields (`tier` / `authority` / `scope` / `status`) identical.

## Promote Status

`draft` → review → `baseline` (`authority: normative` takes effect and the body becomes binding).
