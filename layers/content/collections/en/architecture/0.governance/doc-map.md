---
docId: NMCPS-GOV-003
title: "Documentation Map & Authority Index (Doc Map)"
navigation:
  title: "Doc Map"
description: "The single authority (SSOT) for the whole-repo doc index: each doc's docId / tier / authority / scope / status is maintained only here; all other docs reference this page. This is the single authority for the gov.doc-index domain."
excerpt: "The single authority for docId, tier, authority, scope, status."
keywords:
  - "doc-map"
  - "index"
  - "authority"
tier: 0
authority: normative
scope:
  - gov.doc-index
status: baseline
version: 0.30.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
createdAt: "2026-10-24"
updatedAt: "2026-11-01"
icon: "carbon:list"
tags:
  - "Governance"
  - "Index"
  - "Doc Map"
---

# Documentation Map & Authority Index (NMCPS-GOV-003)

> **Responsibility (SSOT)**: the single authority of the whole-repo doc index — each doc's `docId`, tier, `authority`, `scope`, `status` is maintained **only here**; all other docs reference this page.
> **Audience**: all engineers / AI assistants.

---

## 1. Usage Rules

1. **Find authority**: check §3 for your domain → open its single authority (one `normative` per scope).
2. **Change design**: update the corresponding Tier baseline before code; changing Tier 0~1 requires an ADR (Tier 5) first.
3. **Reference**: lower tiers reference higher tiers; higher tiers never reference lower tiers in body; Tier 5 is never a source.
4. **Conflict order**: code/generated contracts > Tier 0 > 1 > 2 > 3 > 4; Tier 5 does not participate.

---

## 2. Tier Definitions (0~5)

> Authority definitions: `NMCPS-GOV-001` §2.

| Tier | Name | Change frequency |
| :---: | :--- | :--- |
| 0 | Governance/charter | Very low (ADR required) |
| 1 | Architecture | Low |
| 2 | Domain baseline | Medium |
| 3 | Contract/reference | Medium |
| 4 | Operations | High |
| 5 | Records | Append-only + supersede |

---

## 3. Domain-Level Doc Map

| Domain | Tier | Authority (docId) | Status |
| :--- | :---: | :--- | :--- |
| `gov.doc-system` | 0 | NMCPS-GOV-001 | baseline |
| `gov.doc-index` | 0 | NMCPS-GOV-003 | baseline |
| `arch.transport` | 1 | NMCPS-ARCH-001 | baseline |
| `arch.datasource` | 1 | NMCPS-ARCH-002 | baseline |
| `arch.iam` | 1 | NMCPS-ARCH-003 | baseline |
| `arch.content` | 1 | NMCPS-ARCH-004 | baseline |
| `arch.platform` | 1 | NMCPS-ARCH-005 | baseline |
| `arch.ui` | 1 | NMCPS-ARCH-006 | baseline |
| `domain.topology` | 2 | NMCPS-DESIGN-001 | baseline |
| `domain.spectrum` | 2 | NMCPS-DESIGN-002 | baseline |
| `domain.transmission` | 2 | NMCPS-DESIGN-003 | baseline |
| `domain.device` | 2 | NMCPS-DESIGN-004 | baseline |
| `domain.system` | 2 | NMCPS-DESIGN-005 | baseline |
| `domain.scenario` | 2 | NMCPS-DESIGN-006 | baseline |
| `domain.dashboard` | 2 | NMCPS-DESIGN-007 | baseline |
| `contract.shared-types` | 3 | NMCPS-CONTRACT-001 | baseline |
| `contract.metrics` | 3 | NMCPS-CONTRACT-002 | baseline |

---

## 4. Document Table

| docId | Doc | tier | authority | scope | status | path |
| :--- | :--- | :---: | :---: | :--- | :---: | :--- |
| NMCPS-GOV-001 | Documentation System Charter | 0 | normative | gov.doc-system | baseline | architecture/0.governance/doc-system-charter.md |
| NMCPS-GOV-003 | Doc Map | 0 | normative | gov.doc-index | baseline | architecture/0.governance/doc-map.md |
| NMCPS-ARCH-001 | Transport Plane Architecture | 1 | normative | arch.transport | baseline | architecture/1.architecture/transport-architecture.md |
| NMCPS-ARCH-002 | Data Source Architecture | 1 | normative | arch.datasource | baseline | architecture/1.architecture/datasource-architecture.md |
| NMCPS-ARCH-003 | IAM Architecture | 1 | normative | arch.iam | baseline | architecture/1.architecture/iam-architecture.md |
| NMCPS-ARCH-004 | Content Center Architecture | 1 | normative | arch.content | baseline | architecture/1.architecture/content-center-architecture.md |
| NMCPS-ARCH-005 | Platform Capability Architecture | 1 | normative | arch.platform | baseline | architecture/1.architecture/platform-architecture.md |
| NMCPS-ARCH-006 | UI Interaction Architecture | 1 | normative | arch.ui | baseline | architecture/1.architecture/ui-architecture.md |
| NMCPS-DESIGN-001 | Topology Monitoring Baseline | 2 | normative | domain.topology | baseline | architecture/2.domain/topology.md |
| NMCPS-DESIGN-002 | Spectrum Management Baseline | 2 | normative | domain.spectrum | baseline | architecture/2.domain/spectrum.md |
| NMCPS-DESIGN-003 | Transmission Control Baseline | 2 | normative | domain.transmission | baseline | architecture/2.domain/transmission.md |
| NMCPS-DESIGN-004 | Device Networking Baseline | 2 | normative | domain.device | baseline | architecture/2.domain/device.md |
| NMCPS-DESIGN-005 | System Management Baseline | 2 | normative | domain.system | baseline | architecture/2.domain/system.md |
| NMCPS-DESIGN-006 | Scenario Modeling Baseline | 2 | normative | domain.scenario | baseline | architecture/2.domain/scenario.md |
| NMCPS-DESIGN-007 | Dashboard Baseline | 2 | normative | domain.dashboard | baseline | architecture/2.domain/dashboard.md |
| NMCPS-CONTRACT-001 | Shared Types Contract | 3 | normative | contract.shared-types | baseline | architecture/3.contract/shared-types.md |
| NMCPS-CONTRACT-002 | Metrics Contract | 3 | normative | contract.metrics | baseline | architecture/3.contract/metrics.md |
| NMCPS-ADR-0001 | Module Renaming | 5 | informative | rec.adr.0001 | baseline | records/adr/adr-0001.md |
| NMCPS-ADR-0002 | Route Naming Conventions | 5 | informative | rec.adr.0002 | baseline | records/adr/adr-0002.md |
| NMCPS-ADR-0003 | Route Ordering Conventions | 5 | informative | rec.adr.0003 | baseline | records/adr/adr-0003.md |
| NMCPS-ADR-0004 | Authority Pyramid Rollout | 5 | informative | rec.adr.0004 | baseline | records/adr/adr-0004.md |
| NMCPS-ADR-0005 | English Mirror & Bilingual Integration | 5 | informative | rec.adr.0005 | baseline | records/adr/adr-0005.md |
| NMCPS-ADR-0006 | Desktop Update Entry & Startup Silent Check | 5 | informative | rec.adr.0006 | baseline | records/adr/adr-0006.md |
| NMCPS-ADR-0007 | Nitro BFF Gateway | 5 | informative | rec.adr.0007 | baseline | records/adr/adr-0007.md |
| NMCPS-ADR-0008 | Download Landing Page Restoration | 5 | informative | rec.adr.0008 | baseline | records/adr/adr-0008.md |
| NMCPS-ADR-0009 | Session and Token Model | 5 | informative | rec.adr.0009 | superseded | records/adr/adr-0009.md |
| NMCPS-ADR-0010 | Readiness Probe and SSE Passthrough | 5 | informative | rec.adr.0010 | baseline | records/adr/adr-0010.md |
| NMCPS-ADR-0011 | Auth API Integration and Token Rotation | 5 | informative | rec.adr.0011 | baseline | records/adr/adr-0011.md |
| NMCPS-ADR-0012 | Platform Layer Extraction | 5 | informative | rec.adr.0012 | baseline | records/adr/adr-0012.md |
| NMCPS-ADR-0013 | Login Naming and Seed Prefill | 5 | informative | rec.adr.0013 | baseline | records/adr/adr-0013.md |
| NMCPS-ADR-0014 | Forced Reset Page Naming | 5 | informative | rec.adr.0014 | baseline | records/adr/adr-0014.md |
| NMCPS-ADR-0015 | Platform Capability Probes | 5 | informative | rec.adr.0015 | baseline | records/adr/adr-0015.md |
| NMCPS-ADR-0016 | Removing the Root Landing Page | 5 | informative | rec.adr.0016 | baseline | records/adr/adr-0016.md |
| NMCPS-ADR-0017 | Data-Form Interaction Baseline | 5 | informative | rec.adr.0017 | baseline | records/adr/adr-0017.md |
| NMCPS-REC-001 | Upstream auth defect list | 5 | informative | rec.defects.auth | baseline | records/defects/auth-upstream-defects.md |
| NMCPS-REC-002 | Upstream account defect list | 5 | informative | rec.defects.account | baseline | records/defects/account-upstream-defects.md |

> Paths are relative to `layers/content/collections/cn/`; `en/` is the mirror collection with the same docId.

---

## 5. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-24 | 0.1.0 | Initial: GOV-001, GOV-003, domain map skeleton. |
| 2026-10-24 | 0.2.0 | Registered ADR-0001~0003 (Tier 5, informative). |
| 2026-10-24 | 0.3.0 | Registered ARCH-004 (Tier 1, normative). |
| 2026-10-25 | 0.4.0 | Registered ARCH-001~003 (Tier 1, normative). |
| 2026-10-25 | 0.5.0 | Registered DESIGN-001~007 (Tier 2, normative). |
| 2026-10-25 | 0.6.0 | Registered CONTRACT-001~002 (Tier 3, normative). |
| 2026-10-25 | 0.7.0 | Registered ADR-0004 authority pyramid rollout / ADR-0005 English mirror (Tier 5, informative). |
| 2026-10-25 | 0.8.0 | Tier 0~3 promoted to baseline (approved, authority in effect). |
| 2026-10-28 | 0.9.0 | Registered ADR-0006 desktop update entry (Tier 5, informative). |
| 2026-10-28 | 0.10.0 | Registered ADR-0007 enabling the Nitro BFF gateway and the server/shared directories (Tier 5, informative). |
| 2026-10-29 | 0.11.0 | Registered ADR-0008 restoring the download landing page and the `/` entry (Tier 5, informative). |
| 2026-10-30 | 0.12.0 | Registered ADR-0010 BFF upstream readiness probe and SSE streaming passthrough (Tier 5, informative; mirror catch-up). |
| 2026-10-30 | 0.13.0 | Registered ADR-0009 session and token model (Tier 5, informative; fills the slot reserved by ADR-0008). |
| 2026-10-31 | 0.14.0 | Registered ADR-0011 auth API integration and token rotation (Tier 5, informative); ADR-0009 now carries `supersededBy` and is marked superseded. |
| 2026-10-31 | 0.15.0 | Registered ADR-0012 platform layer extraction (Tauri capability demos moved into `layers/platform`, route paths unchanged). |
| 2026-10-31 | 0.16.0 | Registered ADR-0013 login naming unification and demo seed prefill (Tier 5, informative). |
| 2026-10-31 | 0.17.0 | Mirror catch-up: registered REC-001, the upstream `/api/v1/auth` defect list and in-repo drifts (Tier 5, informative; the zh map already carried it at 0.17.0). |
| 2026-10-31 | 0.18.0 | Registered ADR-0014 renaming the forced password page to `change-password` (keeping `reset` for a forgot-password flow; Tier 5, informative). |
| 2026-10-31 | 0.19.0 | Registered ARCH-005 Platform Capability Architecture (`arch.platform`, Tier 1, normative: capability matrix, permission layering, probe scope) and ADR-0015 platform capability probes (drop `commands` and `shell:allow-execute`; Tier 5, informative). |
| 2026-11-01 | 0.20.0 | Registered ARCH-006 UI Interaction Architecture (`arch.ui`, Tier 1, normative: layout matrix, three-pane split with container-query collapse, toolbar left/right semantics, record-level breadcrumbs and the `?id` contract) and ADR-0017 data-form interaction baseline (retire the `usePageToolbar` module-level channel, inject toolbars via Teleport; Tier 5, informative). Mirror catch-up: ADR-0016 and REC-002 added to the doc table (the zh map already carried them at 0.20.0 / 0.21.0). |
| 2026-11-01 | 0.21.0 | ARCH-006 goes to 0.2.0 and ADR-0017 gains its baseline detail (drawn from 1.0's `connector/device.vue` and `system/user.vue`): per-pane sizing and the three drag rules, the detail pane's `view/edit/create` states with a switch guard, list rows and a shared `sortKey` for the default selection, the related pane and four feedback channels, and a toolbar upgraded from one page level to **two levels (L0 page / L1 pane)** with the three-question ownership test and a fixed 49px height. §6 anti-patterns and §7 acceptance updated (four new assertions: row-action cap, view-state guard, default selection, divider persistence — to land in `check:ui` with migration step 5). |
| 2026-11-01 | 0.22.0 | **ARCH-006 → 0.2.1, ADR-0017 gains §7.1**: data-form pages collapse from three panes to two (list / detail), related data becomes fixed sections inside the detail pane, and only two shapes remain (two panes / overlay); the **minimum page width** constants land (`--page-min-w` 20rem, two-pane threshold `--split-min-w` 56rem = list maximum 24rem + detail minimum 32rem, detail ≥ 32rem) with the rule "`isMobile` or container < 56rem → overlay"; history behaviour follows the shape instead of the device; toolbar height reads `--app-toolbar-h` and the overlay renders one level. Two false statements corrected (`check:ui` never covered four-mode switching; `usePageToolbar` has no cross-request sharing under `ssr: false`). |
| 2026-11-01 | 0.23.0 | **ARCH-006 → 0.2.2 (mechanism landed)**: §3.3 describes the definite-height chain as built (content container `flex min-h-0 flex-1 flex-col` plus the inner `data-layout-scroll` container; a page root with `flex-1 min-h-0` is the explicit split-page opt-in) and records that the toolbar sits outside the scroll container in both modes, so `--content-sticky-top` is `0`. `--app-toolbar-h` is now the single source of toolbar height, `usePageToolbar` is deleted (zero references) in favour of the `#app-toolbar-left` / `#app-toolbar-right` mount points, and the new `Layout/Split.vue` + `usePaneResize` were measured at 320 / 768 / 1024 / 1366 / 1440 / 1920 (both shapes, no horizontal scroll, 18–28rem drag, 22rem double-click reset, width kept across reloads). |
| 2026-11-01 | 0.24.0 | **ARCH-006 → 0.2.3 (selection URL contract landed)**: §5.2 gains an implementation note — `useRecordSelection` (`app/composables/useRecordSelection.ts`) owns `?id` (membership tested against the current `rows` only, `?id` never enters the list request key, two panes `replace` / overlay `push`, the default selection enabled with `autoSelect` + a `defaultRecord` sharing the list `sortKey`, once, never in the overlay); the record segment goes through `useRecordContext` (`app/composables/useRecordContext.ts`) and `AppToolbar` renders it as the last breadcrumb item, clickable to clear. `/system/user` uses the contract (focusable rows, selected highlight, `?id` outside `rows` shows a notice plus clear with no extra request); the two-pane shape and the default selection follow in migration step 4 and the §7 `check:ui` cases stay pending. |
| 2026-11-01 | 0.25.0 | **ARCH-006 → 0.2.4 (`/system/user` two-pane migration)**: §7 rows 1, 2, 4, 6 and 9 are covered by `check:ui` (six-width shapes, no horizontal overflow at 320px, overlay `push` plus back, deep-link hit, `?id` outside `rows` with zero detail requests, `?id=new` inline form, two-pane default selection) and the fake upstream gained the three account endpoints; the breadcrumb case is marked explicitly pending. Registered here retroactively. |
| 2026-11-01 | 0.26.0 | **ARCH-006 → 0.2.5, ADR-0017 gains §7.2 (toolbar collapses to one level, split left/right)**: the L0 / L1 layering of 0.2.0 is reverted — the reserved `AppToolbar` is the only layer, collection actions inject into `#app-toolbar-left`, record / submit actions and the primary CTA into `#app-toolbar-right`, panes no longer render a header (`Layout/Split.vue` drops `#list-toolbar` / `#detail-toolbar` and its built-in back row); overlay and two panes share the layer and switch its content with the current panel, the record title moves to the top of the detail content area and "Back" is injected by the page into the left area; `AppToolbar` now observes both mount points with a `MutationObserver` and collapses to zero height when a page injects nothing outside `topbar` mode. `check:ui` grows to 83 cases (collapse when empty, actions in the reserved bar, exactly one bar, overlay follows the panel). |
| 2026-11-01 | 0.27.0 | **ARCH-006 → 0.2.6 (toolbar horizontal padding aligned with the content)**: §4.1 gains a rule — the toolbar uses `px-3` (12px) on both sides, the same coordinate as the panes `p-3` and the page-level alert `mx-3`, so the first left-area action lines up with the list pane content edge and the primary CTA with the detail pane right content edge; `UDashboardToolbar` root padding is cleared as well (`px-0 sm:px-0`, since `px-0` alone loses to the default `sm:px-6` and adds another 24px from 640px up) and `UHeader` `px-4 sm:px-6 lg:px-8` is ruled out because the toolbar sits inside the content box and the `lg` 32px step left a 20px offset. §7 gains acceptance row 12 and `check:ui` goes to 84 assertions (12px per side measured, row content at 14px). |
| 2026-11-01 | 0.28.0 | **ARCH-006 → 0.2.7 (single render site for the toolbar, fixes "actions vanish in sidebar mode")**: `default.vue` used to render `<AppToolbar>` twice — inside the scroll container for `bigscreen`, outside for the rest — so a mode switch destroyed and recreated the mount point and left the page's teleported content in a detached subtree (measured: sidebar mode `leftKids=0`, h=0). It now renders once, outside the scroll container, for every mode; §4.3 gains the "single render site" rule, §3.3 wording follows, §7 gains row 13 and `check:ui` grows to 85 assertions (switch to "Sidebar", then assert the actions survive). |

| 2026-11-01 | 0.29.0 | **ARCH-006 → 0.2.8 (`topbar` mode gains `check:ui` cases)**: row 5 of §7 (the breadcrumb record segment) moves from pending to covered — switching to "Topbar" at a 1920 viewport yields `[System / Users / Alice]` and clicking that segment drops `?id`; new row 14 records that the toolbar and the header align on the constrained container (both `left=240` / `width=1440`) while each keeps its own padding, 12px vs 32px, with the 20px difference intentional; §4.1 states the same rule. `check:ui` 85 → 88 assertions. |
| 2026-11-01 | 0.30.0 | **ARCH-006 → 0.2.9 (no-action page collapse across modes)**: §4.4 states that `mobile` matches `bigscreen` and that `topbar` never collapses (persistent breadcrumb, zero left-mount children, emptiness reads `!isTopbarMode && !hasPageActions`); §7 gains row 15 (`/dashboard/overview`: bigscreen `h=0` / topbar `h=49` / mobile `h=0`) and `check:ui` grows 88 → 90 assertions. |
