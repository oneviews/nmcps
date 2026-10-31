---
docId: NMCPS-ARCH-005
title: "Platform capability architecture"
description: "Tier 1 baseline for the platform capability domain (arch.platform): the desktop and mobile capability matrix under the Tauri 2 host, permission layering, probe pages and browser degradation strategy. This document is the single authority for arch.platform."
excerpt: "Capability matrix, permission layering, probe pages and browser degradation for the Tauri host."
keywords:
  - "platform"
  - "architecture"
  - "tauri"
  - "capability"
  - "cross-platform"
tier: 1
authority: normative
scope:
  - arch.platform
status: baseline
version: 0.2.3
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-10-31"
updatedAt: "2026-10-31"
icon: "carbon:layers"
tags:
  - "architecture"
  - "platform"
  - "tauri"
  - "cross-platform"
---

# Platform capability architecture (NMCPS-ARCH-005)

> **Scope**: the single authority for `arch.platform` — what the frontend may use under each host (browser / desktop shell / mobile shell), how it degrades, and who grants it. Layer ownership is recorded in `NMCPS-ADR-0012` (layers/content/collections/cn/records/adr/adr-0012.md); the probe refactor decision is `NMCPS-ADR-0015` (layers/content/collections/cn/records/adr/adr-0015.md).
> **Audience**: frontend engineers, packaging and release owners, AI assistants.

---

## 1. Purpose

`layers/platform` is not a business module. It isolates host differences: desktop-only capabilities live behind a small set of composables, and business code calls those composables instead of importing Tauri plugins directly.

The single test is: **can it degrade safely in a plain browser?**

- Degradable → business code may use it directly (for example `useUpdater()` shows a "desktop only" toast).
- Not degradable (token storage, native notifications, file writes) → must go through a `layers/platform` composable, which owns the `isTauri()` guard.

---

## 2. Runtime and build targets

| Target | Artifact | Notes |
| :--- | :--- | :--- |
| Browser (web) | `.output/` + Nitro BFF | All platform capabilities degrade; `isTauri()` is `false` |
| Desktop (Windows / macOS / Linux) | Tauri 2 installer | Full capability set; `updater` only here |
| Mobile (Android / iOS) | Tauri 2 mobile bundle | Capability subset; window and file semantics differ |

`ssr: false` (SPA) is a precondition: `isTauri()` is client-only, so navigation and probe pages must not depend on it during server rendering.

---

## 3. Capability matrix

"Permission slot" means where the capability is declared under `src-tauri/capabilities/`: `main.json` is all platforms, `desktop.json` is desktop only.

| Capability | Plugin | Desktop | Android | iOS | Slot | Browser fallback |
| :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| System info | `os` | ✅ | ✅ | ✅ | `main.json` | Shows "not detectable" |
| Key-value store | `store` | ✅ | ✅ | ✅ | `main.json` | No-op (`useAuthTokens` returns `null`) |
| File access | `fs` | ✅ user Documents | ⚠️ app-private dir | ⚠️ app-private dir | `main.json` | Unavailable, page explains |
| Native notifications | `notification` | ✅ | ✅ (runtime grant on 13+) | ✅ (runtime grant) | `main.json` | Unavailable, page explains |
| External links | `opener` | ✅ | ✅ | ✅ | `main.json` | `window.open` |
| Multi-window webview | `webview` | ✅ | ⚠️ needs Activity Embedding (API 32+) | ⚠️ needs UIScene | `desktop.json` | Unavailable, page explains |
| Auto update | `updater` | ✅ | ❌ | ❌ | `desktop.json` | "Desktop only" toast |
| Shell execution | `shell` (plugin removed) | ❌ | ❌ | ❌ | none | none |

Two hard constraints follow from the matrix:

1. **`BaseDirectory.Document` on mobile is the app-private directory**, not the user-visible Documents folder. Probe pages must say so and must not promise a file in the system Documents directory.
2. **`shell` is never granted, and the plugin itself is gone.** The `shell:allow-execute` validator is effectively `\S.*`, i.e. arbitrary command execution: it turns the WebView into a code execution entry point. So `tauri-plugin-shell` (Rust dependency and registration), `@tauri-apps/plugin-shell` (npm dependency) and the shell auto-import in `modules/tauri.ts` were all removed — not "registered but ungranted", simply absent. If a system program is genuinely needed, add a Rust `#[tauri::command]` with an argument allowlist and record it in an ADR.

---

## 4. Permission layering

- `src-tauri/capabilities/main.json`: all-platform capabilities; only plugin defaults that also hold on mobile.
- `src-tauri/capabilities/desktop.json`: `platforms: ["macOS", "windows", "linux"]`; desktop-only capabilities such as `updater` / `webview`.
- A new plugin must be registered in three places: `src-tauri/src/lib.rs` (`init`), `src-tauri/capabilities/*.json` (permissions), and `modules/tauri.ts` (the `useTauri<Module><Function>` auto-import prefix). Removing one takes the same three places plus the npm dependency; four `pnpm check:platform` assertions keep `shell` at zero residue (`lib.rs` / `Cargo.toml` / `package.json` / `modules/tauri.ts`).

Any widened `allow-*` scope must state in the PR who calls it, what happens on failure, and why the default permission is insufficient — the same file is shared by desktop and mobile.

---

## 5. Composable conventions

`layers/platform` exports composables only; pages must not call `useTauri*` directly (the `os` probe is the exception, since exposing system info is its purpose).

| Composable | Responsibility | Browser behaviour |
| :--- | :--- | :--- |
| `usePlatformInfo()` | platform / version / arch / locale | Fields are `null` |
| `usePlatformStore()` | probe-only store (`platform-probe.bin`) | `store()` returns `null` |
| `usePlatformFile()` | text file write + scope note | Returns `unavailable` |
| `usePlatformNotify()` | permission chain + native notification | Returns `unavailable` |
| `usePlatformWindow()` | multi-window (desktop only) | Returns `unsupported` |
| `useExternalLink()` | external link (Tauri `opener` / browser) | `window.open` |

Conventions:

- Composables **do not swallow errors**: they return `{ ok: false, reason }` and the page picks the copy (i18n keys under `pages.*`).
- `isTauri()` is evaluated per call, never cached at module level, so tests and preview builds cannot leak state.
- The probe store uses its own file name and never reuses `auth.bin`, so `autoSave` writes cannot overwrite each other.

---

## 6. Probe pages

Five probe pages remain as on-device evidence that a capability actually works; they are **not product features**:

| Route | Probe | Typical failure |
| :--- | :--- | :--- |
| `/os` | System info | Plugin not registered → call throws |
| `/file` | File write | Missing permission → `not allowed` |
| `/store` | Persistence | Value gone after restart |
| `/notifications` | Native notification | Permission chain broken → silent |
| `/webview` | Multi-window | Unsupported on mobile → must fall back to same-window navigation |

`/commands` is gone: it demonstrated exactly the `shell:allow-execute` that this document forbids.

**Entry rule**: the sidebar shows a virtual "Platform capabilities" group (`meta.group = "platform"`) **only under Tauri** (`meta.tauriOnly`). Pages stay reachable by URL in a browser but only render the degradation notice — so CI can assert "no entry in a browser" while desktop users still find the probes.

---

## 7. Self-checks

- `pnpm check:platform`: static assertions (capability matrix, no `shell:allow-execute` in capability files, zero `shell` plugin residue in `lib.rs` / `Cargo.toml` / `package.json` / `modules/tauri.ts`, five probe pages and composables exist, cn/en copy keys aligned, navigation meta present).
- `pnpm check:ui`: two browser assertions — no "Platform capabilities" group in the sidebar, and `/os` shows "not detectable" instead of throwing; the opposite branch is locked by the host simulation below.
- **Tauri host simulation**: `isTauri()` only reads `globalThis.isTauri`, so `check:ui` ends by booting a second instance with `NUXT_PUBLIC_BFF_BASE`, injecting that flag plus a minimal IPC stub (store / updater / os commands, the stub store backed by sessionStorage because the BFF writes no cookie in desktop mode), signing in again and asserting the group appears with five entries. It exercises the same runtime branch as the real desktop shell.
- **Still manual**: the headless environment has no `DISPLAY`; native window rendering, multi-window `/webview` and an actual notification banner need `pnpm tauri:dev` on a machine with a display, and the mobile columns need a real device. `pnpm tauri:dev` also requires that no other Nuxt dev server owns this directory (picking another port does not bypass `.nuxt/nuxt.lock`), and the script now refuses to start before compiling when either precondition is missing (measured 2026-10-31: the port fallback hit `ActionableError` in `beforeDevCommand` and `cargo run` then panicked in `gtk::rt::init`).

---

## 8. Retention policy

The probe pages and composables are a **capability reserve**, not product pages: their job is to prove out and document what a desktop or mobile host can do, so a future NMCPS feature can reuse it directly.

- **Kept**: OS info, file read/write and directory picking, key-value store, native notifications, window / multi-window, external links, updater — all six composables and five probe pages stay; the capability code is never cleaned up as "demo leftovers".
- **Single exception**: arbitrary command execution (`shell:allow-execute`) is not kept, for the reasons in `NMCPS-ADR-0015` (layers/content/collections/en/records/adr/adr-0015.md) — it is an arbitrary code execution surface and no future feature needs it; the plugin itself (Rust dependency and registration, npm dependency, auto-import) is removed too. Needing an external program means a dedicated backend command registered in this document's matrix, not the generic shell.
- **How features plug in**: business code consumes only the API exposed by `layers/platform/app/composables` and never imports a Tauri plugin directly; probe pages serve as regression samples (re-verify page by page after a Tauri or plugin major upgrade), not as feature entry points.
- **Adding a capability** requires all four: a composable, a probe case, a row in this document's matrix, and a permission in `capabilities`.
- **Removal gate**: deleting a probe page or composable requires amending this document and `NMCPS-ADR-0015` first; a removal without both is a regression.

---

## 9. Change log

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-31 | 0.1.0 | First version: capability matrix, permission layering, composable conventions, five probe pages, self-check scope; `shell` explicitly not granted (decision in ADR-0015). |
| 2026-10-31 | 0.2.0 | Section 7 upgrades "the group only shows under Tauri" from manual-only to a `check:ui` host simulation (inject `globalThis.isTauri` plus a minimal IPC stub, a second instance with `NUXT_PUBLIC_BFF_BASE`, 68 self-built assertions); native windows and mobile stay manual. |
| 2026-10-31 | 0.2.1 | Section 7 records the two `pnpm tauri:dev` preconditions (no other Nuxt dev server in this directory, a display server present); `scripts/tauri-dev.ts` now checks both before compiling. |
| 2026-10-31 | 0.2.2 | New section 8 "Retention policy": the five probe pages and six composables stay as a capability reserve for future NMCPS features, with arbitrary command execution the only exception; the admission rule for new capabilities and the removal gate are fixed there, and the change log moves to section 9. |
| 2026-10-31 | 0.2.3 | The `shell` plugin itself is removed (`Cargo.toml` / `lib.rs` / `modules/tauri.ts` / `package.json`), the matrix and section 4 now say "simply absent", and `check:platform` gains four zero-residue assertions (30 → 34). |
