---
title: "Environment Tuning"
description: "Content center dev environment tuning: dev server config, @nuxt/content cache, and HMR notes."
excerpt: "Dev server config, content cache, HMR tuning."
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:book"
---

# Environment Tuning

## Dev Server

- Port: 3000 (`strictPort: true`).
- Listens on `0.0.0.0` for physical-device access.

## @nuxt/content Cache

- Collections are parsed once at dev-server startup; doc changes are incrementally parsed via HMR.
- **Restart the dev server after adding a new collection directory**, otherwise the watcher misses it.

## Bilingual Collections

- `content_cn`: authoritative cn language.
- `content_en`: en mirror (same docId, aligned paths).
- Doc pages switch collections by locale via `useContentCollection`.

## Three-Column Sticky Offsets

The sticky offsets and max heights of the left tree / right TOC are driven by CSS variables injected at the layout root:

- `--content-sticky-top`: sticky offset (0 for bigscreen, toolbar height otherwise).
- `--content-max-h`: sticky max height (follows the scroll container).
