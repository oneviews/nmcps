---
title: "Quick Start"
description: "Quick start for the content center dev environment: prerequisites, install, start the dev server, and run validation commands."
excerpt: "Prerequisites, install, start dev server, run validation."
createdAt: "2026-10-25"
updatedAt: "2026-10-30"
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
pnpm check:doc-system # doc-system guard (seven assertions: uniqueness / completeness / closure / acyclicity / tier validity / staleness / CN-EN parity)
pnpm check:doc-system:selftest # guard self-test: plant four kinds of drift on a temp copy and assert the guard goes red (so an assertion cannot be silently neutered)
pnpm check:ci-summary # step-summary self-test: eighteen assertions pinning ci-summary.sh's `--expect` contract and the wiring of all seven call sites in ci.yml (regexes live only in scripts/ci-expectations.sh), plus a replay of the real-log fixtures in scripts/fixtures/ci-logs/ (with a sha256 manifest and a provenance check for artifact backfills)
pnpm check:i18n       # copy self-check (ten assertion groups: key sets / no CJK in en values / value shape / placeholders / system-page references / site-wide t() references / no CJK in templates)
pnpm build:server     # build the BFF artifact first; check:bff consumes .output/server
pnpm check:bff        # BFF gateway contract (allowlists / verbs / traversal / CORS / envelope / readiness probe / SSE, per NMCPS-ADR-0007 and NMCPS-ADR-0010)
pnpm check:ui         # page checks (Playwright; needs a running server, defaults to http://192.168.1.90:3000)
```

> The BFF exposes two probes: `GET /health` only proves the process can serve (liveness), while `GET /ready` also probes the upstream (200 `ready` / 503 `not_ready` + `upstream.reason`), per NMCPS-ADR-0010.

> `check:ui` takes `CHECK_UI_BASE_URL` to override the target (CI points it at the local build, `http://127.0.0.1:3000`) and `CHECK_UI_SCREENSHOT` to override the screenshot path. CI lives in `.github/workflows/ci.yml` and runs the same three groups.

> Triage CI with `sh scripts/ci-doctor.sh`: with no arguments it summarizes the latest run and job conclusions, `logs [run-id]` fetches the full log with ✅/❌ counts, `artifacts [run-id]` downloads artifacts into `ci-logs/downloads/`, and `fixtures [run-id]` turns that same artifact batch into the six samples (it delegates to `--from-ci` and keeps only steps whose conclusion is `success`). It requires `gh auth login` on the machine. The step summary is written by `scripts/ci-summary.sh`, which first declares the conclusion line a step must contain via `--expect`; when it cannot find that line it emits `::error` and exits 1 (wired as `|| status=1` in `ci.yml`), so "the check ran but the summary has no verdict" reddens the step instead of degrading silently. The six regexes are defined once in `scripts/ci-expectations.sh` and `ci.yml` only names a key (`--expect "$(sh scripts/ci-expectations.sh <key>)"`); `pnpm check:ci-summary` asserts in reverse that all seven call sites carry `--expect` and end with `|| status=1`, then replays every regex with `grep -aE` against `scripts/fixtures/ci-logs/<key>.log` (the tail of each step's real log, with its provenance in a `# source:` header), so a wording change reddens the check. A manifest, `scripts/fixtures/ci-logs/.manifest.json`, records each fixture's sha256 and claimed source, so editing a sample without re-sealing fails immediately (⑮–⑰). Refresh with `node scripts/check-ci-summary.mjs --write-fixtures` (re-runs the four local steps and re-seals the manifest), or with `node scripts/check-ci-summary.mjs --from-ci [run-id]`, which backfills all six samples straight from that run's artifacts — the only route for bff / ui, so nobody hand-copies `gh run view` output any more. The step and job names in the provenance come from that run, and ⑱ statically checks they still exist in `ci.yml`. The refresh guards itself twice: a step that exits non-zero is skipped (its failing output never becomes a "real log" sample) — `--from-ci` applies the same rule by reading each step's conclusion in that run and skipping anything that is not `success` — and every freshly written sample is replayed against the table regex immediately; either failure exits 1. `--seal` is an emergency exit, not a third refresh route: it only re-seals the manifest and will stamp whatever bytes are on disk, so the normal paths are the two above. It now requires `--reason "…"`: when the samples and the manifest disagree and no reason is given, the seal is refused outright (the on-disk manifest stays untouched, so ⑯ keeps failing); with a reason it first prints what the seal changed (bytes / provenance old → new / newly sealed / removed) and then emits a ready-to-paste commit message (subject `chore(ci): 手工重封 <keys> 样本 — <reason>`, body listing the changes). When the samples already match the manifest no reason is needed and it says there is nothing to commit.

> Restart the dev server after adding a new collection directory so the `@nuxt/content` watcher picks it up.
