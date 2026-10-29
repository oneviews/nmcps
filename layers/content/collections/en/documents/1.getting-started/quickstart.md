---
title: "Quick Start"
description: "Quick start for the content center dev environment: prerequisites, install, start the dev server, and run validation commands."
excerpt: "Prerequisites, install, start dev server, run validation."
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:book"
---

# Quick Start

Quick start for the content center dev environment.

## Prerequisites

- Node.js >= 20.
- Package manager: pnpm >= 9.

## Install

```bash
pnpm install
```

## Start the Dev Server

```bash
pnpm dev
```

Listens on `http://localhost:3000` (strictPort).

## Run Validation

```bash
pnpm typecheck        # type check
pnpm lint             # ESLint (including i18n key order)
pnpm check:doc-system # doc-system guard (six assertions: uniqueness / completeness / closure / acyclicity / tier validity / staleness)
pnpm build:server     # build the BFF artifact first; check:bff consumes .output/server
pnpm check:bff        # BFF gateway contract (allowlists / verbs / traversal / CORS / envelope, per NMCPS-ADR-0007)
pnpm check:ui         # page checks (Playwright; needs a running server, defaults to http://192.168.1.90:3000)
```

> `check:ui` takes `CHECK_UI_BASE_URL` to override the target (CI points it at the local build, `http://127.0.0.1:3000`) and `CHECK_UI_SCREENSHOT` to override the screenshot path. CI lives in `.github/workflows/ci.yml` and runs the same three groups.

> Restart the dev server after adding a new collection directory so the `@nuxt/content` watcher picks it up.
