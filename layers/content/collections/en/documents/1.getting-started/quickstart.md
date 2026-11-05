---
title: "Quick Start"
description: "Quick start for the content center dev environment: prerequisites, install, start the dev server, and run validation commands."
excerpt: "Prerequisites, install, start dev server, run validation."
createdAt: "2026-10-25"
updatedAt: "2026-11-05"
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
pnpm check:ci-summary # step-summary self-test: twenty assertions pinning ci-summary.sh's `--expect` contract, the wiring of all seven call sites in ci.yml (regexes live only in scripts/ci-expectations.sh), a replay of the real-log fixtures in scripts/fixtures/ci-logs/ (with a sha256 manifest and a provenance check for artifact backfills), an `::error` annotation whenever any assertion reddens (so the Checks page names the failing assertion itself), and the wiring of `scripts/ci-doctor.sh drill` (usage / dispatch / trap rollback / `--yes` / main-only push)
pnpm check:i18n       # copy self-check (ten assertion groups: key sets / no CJK in en values / value shape / placeholders / system-page references / site-wide t() references / no CJK in templates)
pnpm build:server     # build the BFF artifact first; check:bff consumes .output/server
pnpm check:bff        # BFF gateway contract (allowlists / verbs / traversal / CORS / envelope / readiness probe / SSE, per NMCPS-ADR-0007 and NMCPS-ADR-0010)
pnpm check:ui         # page checks (Playwright; needs a running server, defaults to http://192.168.1.90:3000)
```

> The BFF exposes two probes: `GET /health` only proves the process can serve (liveness), while `GET /ready` also probes the upstream (200 `ready` / 503 `not_ready` + `upstream.reason`), per NMCPS-ADR-0010.

> `check:ui` takes `CHECK_UI_BASE_URL` to override the target (CI points it at the local build, `http://127.0.0.1:3000`) and `CHECK_UI_SCREENSHOT` to override the screenshot path. CI lives in `.github/workflows/ci.yml` and runs the same three groups.

> Triage CI with `sh scripts/ci-doctor.sh`: with no arguments it summarizes the latest run and job conclusions, `logs [run-id]` fetches the full log with ✅/❌ counts, `artifacts [run-id]` downloads artifacts into `ci-logs/downloads/`, and `fixtures [run-id]` turns that same artifact batch into the six samples (it delegates to `--from-ci` and keeps only steps whose conclusion is `success`). It requires `gh auth login` on the machine. The step summary is written by `scripts/ci-summary.sh`, which first declares the conclusion line a step must contain via `--expect`; when it cannot find that line it emits `::error` and exits 1 (wired as `|| status=1` in `ci.yml`), so "the check ran but the summary has no verdict" reddens the step instead of degrading silently. The six regexes are defined once in `scripts/ci-expectations.sh` and `ci.yml` only names a key (`--expect "$(sh scripts/ci-expectations.sh <key>)"`); `pnpm check:ci-summary` asserts in reverse that all seven call sites carry `--expect` and end with `|| status=1`, then replays every regex with `grep -aE` against `scripts/fixtures/ci-logs/<key>.log` and checks the `sha256` and provenance recorded in `.manifest.json` (⑮–⑰). How to refresh a sample, and which entry point counts as an emergency, is the table in the next section.

> Restart the dev server after adding a new collection directory so the `@nuxt/content` watcher picks it up.

## The Four Ways to Refresh a CI Sample

The six samples under `scripts/fixtures/ci-logs/` are the **tail of each step's real log**, so a wording change means a refresh. There are four entry points; only the first two are normal routes. The third column is what you **must do afterwards**, the fourth is the assertion that reddens when you don't (numbering follows the header comment of `scripts/check-ci-summary.mjs`, ⑫–⑳).

| Entry point | When it is allowed | What you must do afterwards | Who catches it |
| --- | --- | --- | --- |
| `node scripts/check-ci-summary.mjs --write-fixtures` | The wording of one of the four laptop steps (lint / typecheck / i18n / governance) changed, or the samples are missing | Only steps that exit 0 are written (failing output never becomes a sample); every new sample is replayed against its regex immediately; the manifest is sealed along the way, no separate `--seal` | ⑫⑮ manifest ↔ samples, ⑬ regex replay, ⑯ `sha256` |
| `node scripts/check-ci-summary.mjs --from-ci [run-id]` (`sh scripts/ci-doctor.sh fixtures [run-id]` is the same entry point) | Always for bff / ui (their environment cannot be booted locally); or to re-sync all six from the latest green run | Only steps whose `conclusion=success` in that run are taken, anything else is skipped and exits 1; provenance is written as `CI run <id> 步骤 "<step>"（job: <job>）产物 <artifact>/<file> 尾部`; the new samples are replayed | the conclusion filter itself, ⑯⑰ bytes ↔ provenance, ⑱ step / artifact names must still exist in `ci.yml` |
| `node scripts/check-ci-summary.mjs --seal --reason "…"` | **Emergency only**: the manifest is damaged or the artifacts have expired, so neither machine route applies | The reason is mandatory (without it the seal is refused and not one byte of the manifest is written); read the "本次封存改动" list it prints, then paste the commit message draft it emits — it must say which fixture changed and why neither machine route applied | the `--reason` requirement; ⑯ stays red while the seal is refused |
| Hand-copying `gh run view` output | Never (the only way to fake a sample's provenance) | — | ⑭ every sample carries a `# source:` line, ⑯ a hand edit without a re-seal reddens, ⑰ a header-only edit contradicts the manifest's source |

When something is red, start from the Checks annotations: every failed assertion prints one `::error title=step-summary self-test failed (item N): <name>::<first detail line>（共 N 行明细，见日志）` line, so the annotation locates the problem and the log keeps the full detail (the `❌` block).

### Drilling the Red Annotation

The annotation path has to prove itself periodically, otherwise "a drifted sample turns CI red" is just belief:

```bash
sh scripts/ci-doctor.sh drill ui --dry-run   # inject + check the local expectation only, no commit, no push
sh scripts/ci-doctor.sh drill ui --yes       # full drill: push, compare against the Checks annotation, auto-rollback
```

`drill` appends one drifted line to `scripts/fixtures/ci-logs/<key>.log` (body only, never the `# source:` line — so it trips ⑯, not ⑰), pushes a temporary commit, waits for that run to redden, compares that commit's failure annotation with the expectation generated locally on the spot, then rolls back and drives the rollback run back to green. The expectation is never hardcoded, so changing assertion wording does not invalidate the drill. `key` defaults to `ui`; `--yes` is mandatory (it pushes two commits to main); it requires a clean worktree and `HEAD == origin/main`.

It is **not** a fifth refresh entry point: the sample was never broken — it is broken on purpose and repaired again. So the drill has exactly one legal end state: clean worktree, `HEAD == origin/main`, rollback run `success` with 0 failure annotations. If any of that fails, `drill` exits 1 itself (and a `trap` rolls back if it crashes mid-way).
