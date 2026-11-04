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
version: 0.36.14
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
createdAt: "2026-10-24"
updatedAt: "2026-11-04"
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
| NMCPS-ADR-0018 | Backend generation switch | 5 | informative | rec.adr.0018 | baseline | records/adr/adr-0018.md |
| NMCPS-REC-001 | Upstream auth defect list | 5 | informative | rec.defects.auth | superseded | records/defects/auth-upstream-defects.md |
| NMCPS-REC-002 | Upstream account defect list | 5 | informative | rec.defects.account | superseded | records/defects/account-upstream-defects.md |
| NMCPS-REC-003 | Upstream policy defect list | 5 | informative | rec.defects.policy | superseded | records/defects/policy-upstream-defects.md |
| NMCPS-REC-004 | Upstream audit defect list | 5 | informative | rec.defects.audit | superseded | records/defects/audit-upstream-defects.md |
| NMCPS-REC-005 | Upstream iam role and grant defect list | 5 | informative | rec.defects.iam-policy | baseline | records/defects/iam-policy-upstream-defects.md |

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
| 2026-11-01 | 0.31.0 | **ARCH-006 → 0.2.10 (breadcrumb route segments)**: §5.1 records that ancestor segments link to the default child page (`defaultChildPath()`, not the page-less `m.path`); §7 gains row 16 (`/system/user`: `[System(a → /system/user) / Users(span)]`, plus `Alice(button)` in last position with the first two unchanged once a record is selected). `check:ui` 90 → 92 assertions (`/system/user` 18 → 20). |
| 2026-11-01 | 0.32.0 | **Mirror catch-up: NMCPS-REC-003 registered** — the upstream `/api/v1/{role,permission,abac,access}` defect list and the boundaries it sets for `/system/policy` and `/system/permission` (ten defects: no lifecycle endpoints, the DSL is not validated, read-back has no `effect`, missing parameters and filters, level escalation and out-of-range levels, the dry run ignoring context, account↔role being write-only, super admins rejected by the domain, three codes for built-in roles, inconsistent time zones; Tier 5, informative). DESIGN-005 goes to 0.4.0 (§7 `/system/policy` and §8 `/system/permission` implementation baselines landed in this round). |
| 2026-11-01 | 0.33.0 | **ARCH-006 → 0.2.11 and DESIGN-005 → 0.4.1 (scope alert moves to the top of the detail pane)**: the page-root identity / scope banner (`mx-3 mt-3`) on `/system/user`, `/system/policy` and `/system/permission` now renders at the top of `#detail` (`px-4 pt-4`), with the empty selection switching from `h-full` to `flex-1` inside a `flex min-h-full flex-col` detail column so no scrollbar appears; ARCH-006 §3.7 (feedback channels) and §4.1 (alignment) follow suit — content pages carry no page-level alert — and DESIGN-005 §7.3 / §8.3 name the new position. `check:ui` stays at 92/92. |
| 2026-11-02 | 0.34.0 | **Mirror catch-up: NMCPS-REC-004 registered** — the upstream `/api/v1/audit` defect list and the boundaries it sets for `/system/log` (nine defects: undocumented tenant scoping with one shared code for expired tokens and denials, `category` being case-sensitive with unknown values silently ignored, unknown query parameters dropped with no stable `pageSize` ceiling, two accepted time formats whose invalid values are ignored, `verify` writing an entry and reporting a whole-chain index, a missing export field answering `500`, no export detail or delete endpoint, export list timestamps offset by 8 hours, always-empty detail snapshots; Tier 5, informative). DESIGN-005 goes to 0.5.0 (§9 `/system/log` audit-log implementation baseline, changelog renumbered to §10). |
| 2026-11-02 | 0.34.1 | **DESIGN-005 → 0.5.1 (the `/system/permission` matrix now renders in two columns)**: resource permissions (`resourceType` ≠ `4`) on the left and API permissions (`4`) on the right. API entries dominate the catalog (15 of 24), so mixing them in pushed "device / metric / MIB / alert" to the bottom; the order is fixed, the grid auto-fits (`repeat(auto-fit, minmax(17rem, 1fr))`, API column still second) and stacks on narrow containers, and an empty column keeps one muted line. |
| 2026-11-02 | 0.34.2 | `NMCPS-ARCH-006` → 0.2.12 (§3.7 side-by-side exception for a field column plus a read-only section, §3.2 width wording), `NMCPS-DESIGN-005` → 0.5.2 (§8.3 grant matrix back to a single column, moved to the right of the detail pane). |
| 2026-11-02 | 0.34.3 | `NMCPS-ARCH-006` → 0.2.13 (§3.7 two equal columns filling the detail pane, §3.2 drops the `max-w` cap for that shape), `NMCPS-DESIGN-005` → 0.5.3 (§8.3 two equal columns plus the resource / API matrix columns). |
| 2026-11-02 | 0.34.4 | `NMCPS-ARCH-006` → 0.2.14 (§4.1 adds the left-area standing-filter budget and the "no bespoke controls, Nuxt UI v4 native components only" rule), `NMCPS-DESIGN-005` → 0.5.4 (§9.3 item 2: the time range and category become standing toolbar controls, the remaining ID filters stay in the popover). |
| 2026-11-02 | 0.34.5 | `NMCPS-ARCH-006` → 0.2.15 (§4.1 names where the range popover lives and adds two measured rules: the calendar container must not be `w-0 flex-1`, and a whole-day window must be `00:00:00` … `23:59:59`; row 17 grows 7 → 8 assertions, 99 → 100 in total), `NMCPS-DESIGN-005` → 0.5.5 (§9.3 item 2: the range popover becomes a preset column + two-month calendar + second-level inputs). |
| 2026-11-03 | 0.34.6 | `NMCPS-ARCH-006` → 0.2.16 (§3.6 switches the selected-row fill from `bg-elevated/60` to `bg-accented` with the measured reason for both themes; new §3.8 "List footer: count / page size / pagination" — height from `--app-list-footer-h`, 15 rows by default, options 15 / 30 / 50 / 100 on all four pages, the narrow-pane collapse order, and `/system/policy`'s client-side pagination slicing only the render layer; §7 row 17 drops the page size and row 18 adds three assertions, 100 → 103), `NMCPS-DESIGN-005` → 0.5.6 (§7.3 item 3 notes the client-side pagination contract, §9.2 changes the `pageSize` options to 15 / 30 / 50 / 100, §9.3 item 2 moves the page size out of the popover and item 6 adds the footer assertions). |
| 2026-11-03 | 0.34.7 | `NMCPS-ARCH-006` → 0.2.17 (§7 gains row 19: create-level options are strictly below the session level and `≤ 3`, guarded by 2 `check:ui` cases; 103 → 105 in total), `NMCPS-DESIGN-005` → 0.5.7 (§6.1 adds the super-admin `tenantId` requirement and `GET /tenant`; §6.2 rewrites level semantics as 0 / 1 / 2–3 / 4; §6.3 rewrites the matrix from the 2026-11-03 re-probe and adds two client-narrowing items; §6.4 adds `20102` / `20103`; §6.5 marks `UP-ACC-01` closed and files `UP-ACC-07` / `UP-ACC-08`), `NMCPS-REC-002` re-probe update (`UP-ACC-01` closed, new `UP-ACC-07` mandatory `tenantId` on create and `UP-ACC-08` `L4` belonging to service accounts, 6 → 8 defects, with reproduction commands). |
| 2026-11-04 | 0.34.8 | Registered record-layer ADR `NMCPS-ADR-0018` "backend generation switch" (the retired go-zero gateway gives way to the single upstream `http://192.168.1.55:8888/api/v1`; ten measured facts, four field-mapping tables, ten capability gaps, thirteen impacted files; partially revokes ADR-0011's refresh-rotation clause; Tier 5, informative) and marked `NMCPS-REC-001~004` as `superseded` with `supersededBy: NMCPS-ADR-0018` plus a generation note at the top of each list (their probe target is retired). New Tier 4 work order `documents/3.operations/backend-generation-migration.md` (per-file diff drafts, `check:bff` fake-upstream changes, acceptance and rollback; not a governed document). |
| 2026-11-04 | 0.35.0 | Mirror of the Chinese registration: new record-layer defect list `NMCPS-REC-005` for the new-generation `iam/{roles,policies,role-policies,subject-roles}` endpoints (ten defects: no authorization check, deletable system objects, `enabled` writes ignored, raw SQL in 400s, delete failures carried by a 200, incomplete filters with an uncapped `page_size`, missing required-field validation, ignored `tenant_id` input, unchecked cross-tenant grants, orphan relation rows; Tier 5, informative, `baseline`). `NMCPS-DESIGN-005` goes to 0.8.0 (§7 / §8 rewritten against the `iam` namespace: policy CRUD, role CRUD, `role-policies` grants and `subject-roles` assignment; the ABAC segment, the dry run and the permission catalogue retire with G4 / G5 / G3; failures dispatch on the HTTP shape) and `NMCPS-ARCH-006` to 0.2.20 (§3.8 revokes the `/system/policy` client-side paging exception). |
| 2026-11-04 | 0.36.0 | `NMCPS-ARCH-006` → 0.2.21 (§7 gains rows 20 / 21: the contract surface of `/system/policy` and `/system/permission`, `check:ui` 106 → 116), `NMCPS-DESIGN-005` → 0.8.1 (§8.1 records that `GET /iam/subject-roles` only honours `subject_id` and the by-role lookup happens client-side, plus the C4c-1 / C4c-2 acceptance: `check:bff` 106/106, `check:ui` 116/116). |
| 2026-11-04 | 0.36.1 | `NMCPS-ARCH-006` → 0.2.22 (§7 gains row 22, the copy vs data boundary: interface copy comes only from `i18n/locales/{cn,en}.json` and templates never hardcode CJK, while upstream data is rendered verbatim and never localised; the body writes down the decision order for "Chinese in the English UI = data, not a copy defect"; `pnpm check:i18n` lands as the guard with 9 assertion groups). |
| 2026-11-04 | 0.36.2 | `NMCPS-ARCH-006` → 0.2.23 (§7 row 22 drops the hardcoded component count: it now says "every `.vue` template under `app` and `layers`" and records that `check:i18n` prints the real count, so prose never has to be updated; assertion groups stay 9, `check:ui` stays 116). |
| 2026-11-04 | 0.36.3 | `NMCPS-ARCH-006` → 0.2.24 (`check:i18n` gains group ⑧, a site-wide reference pass over `t()` / `$t()` / `tm()` literals across `app` and every `layers/*/app`, with dynamic keys asserted as static prefixes; assertion groups 9 → 10, and `quickstart` now says ten groups). |
| 2026-11-04 | 0.36.4 | `NMCPS-ARCH-006` → 0.2.25 (groups ⑥ and ⑧ of `check:i18n` merge into one `auditUsage()` implementation, with prefix matching split into `segment` / `open`; assertion groups stay 10 and the measured 333/5 and 497/9 are unchanged). This row also closes the English lag since 0.36.0: rows 0.36.1–0.36.4 mirror the Chinese doc-map's 0.39.1–0.39.4, so both maps now carry the same change set. |
| 2026-11-04 | 0.36.5 | **Guard hardening**: `check:doc-system` gains group ⑦, "CN-EN parity" — (a) compares the `docId` → x.y.z target-version sets harvested from the two doc-maps' changelog rows and fails when either side is missing a version; (b) asserts, for every docId registered in `DOC_PATHS`, that its English mirror exists and carries the same `version` as the Chinese doc, with `NMCPS-GOV-003` itself exempt (the two maps keep parallel independent numbering, so (a) covers the content set). Assertions 886 → 967 (40 governed docs, 39 CN-EN pairs). Measured negative case: flipping the English 0.2.22 to 0.2.99 yields 966 pass / 1 fail and prints `missing` / `extra`. The assertion-group count is updated in the same pass across `quickstart`, `doc-workflow` and `content-center-architecture` in both languages. |
| 2026-11-04 | 0.36.6 | **Guard self-test**: new `pnpm check:doc-system:selftest` (`scripts/check-doc-system.selftest.mjs`) — copies `check-doc-system.ts`, `docIds.ts` and every `.md` into a system temp dir, plants drift on the copy, then runs the real script and judges it on "exit code + message wording". Four cases: ① pristine copy stays at 0 failures; ② flipping the English doc-map's `0.2.22` to `0.2.99` yields 1 failure whose message carries `missing` / `extra`; ③ nudging the English ARCH-006 `version` down one release yields 1 failure; ④ deleting the English ARCH-006 file yields 1 failure. The self-test is wired into `check:governance` and the CI governance job; locally it reports `文档体系自测 4/4 通过`, and it leaves the working tree untouched (one clean copy per case, deleted afterwards). Its first run also caught a real bug: the guard ended with `process.exit()`, and with 967 lines of output filling the pipe buffer the tail (❌ lines and the summary) got truncated — switched to `process.exitCode`, with the same change in `check:i18n` / `check:rules` (`check:bff` keeps `process.exit()` because it holds sockets that must be force-closed). |
| 2026-11-04 | 0.36.7 | **CI summary leads with the verdict**: `scripts/ci-summary.sh` no longer pastes only the log tail — it now writes a "Key results" block (extracting `结果：N 通过 / M 失败 / K 告警`, `文档体系自测 N/M 通过`, `文案自查 N/M 通过`, `N/M 项通过`, at most 8 lines), a "Failures" block (`❌` / `error TS…` / `Error:`, at most 5 lines) and folds the last 40 log lines into a collapsed `<details>`; when no summary line exists it says so explicitly instead of showing an empty block. Verified locally against four real logs (governance / self-test / i18n / rules) and two synthetic ones (failing, no-summary) — the `check:governance` summary now shows `967 通过 / 0 失败 / 0 告警`, `4/4`, `30/30` and `34/34` side by side. |
| 2026-11-04 | 0.36.8 | **A missing summary now fails the step**: `scripts/ci-summary.sh` gains an optional `--expect "<ERE>"` by which the caller declares the conclusion line this step's log must contain; when it is absent the script ① emits an `::error` annotation (the run's Annotations go red), ② writes "预期结论缺失" at the top of the step summary and ③ exits 1. All six call sites in `ci.yml` now read `… --expect '<regex>' \|\| status=1` (lint `\$ eslint`, typecheck `vue-tsc`, i18n `文案自查 N/M 通过`, governance `结果：N 通过`, BFF `N/M 项通过`, page UI `N/M 项通过`), so "the check ran but the summary has no verdict" can no longer degrade silently; page UI's failure branch only appends the summary (`\|\| true`) and never masks the real exit code. New `pnpm check:ci-summary` (`scripts/check-ci-summary.mjs`, six cases: hit / miss / no-`--expect` backward compatibility / non-CI still enforced / missing option value / unknown option) is wired into `check:governance` and reports `步骤摘要自测 6/6 通过`. |
| 2026-11-04 | 0.36.9 | **Regexes collapsed into a single source of truth**: the six `--expect` regexes moved out of `ci.yml` into the new `scripts/ci-expectations.sh` (`sh scripts/ci-expectations.sh <key>` prints the regex, `--list` prints `key<TAB>regex`, an unknown key exits 2), and all seven call sites in `ci.yml` now read `--expect "$(sh scripts/ci-expectations.sh <key>)"`. `pnpm check:ci-summary` grows from 6 to 11 assertions with five static wiring checks — ⑦ every call carries that form, ⑧ every call ends with `\|\| status=1` (only an already-red branch may use `\|\| true`, decided by walking back to the nearest `if [ "$status" -ne 0 ]`), ⑨ the keys used in ci.yml and the `--list` table match both ways (no dead rows, no unregistered keys), ⑩ every key resolves to a non-empty regex, ⑪ an unknown key errors out. Measured negatively: deleting one line's `--expect` → 9/11; flipping page UI's success branch from `\|\| status=1` to `\|\| true` → 10/11. |
| 2026-11-04 | 0.36.10 | **Regexes replayed against real logs**: six fixtures added under `scripts/fixtures/ci-logs/<key>.log` (the tail of each step's real log, with a `# source:` header naming provenance and how to refresh), and `pnpm check:ci-summary` grows from 11 to 14 assertions — ⑫ fixtures and table keys match both ways (a missing or orphan fixture reddens), ⑬ every regex hits its fixture via `grep -aE` (the same tool and flags `ci-summary.sh` uses), ⑭ every fixture carries a `# source:` line (no invented samples). This closes the last blind spot: wiring could be right while the regex no longer matches today's wording. Refresh with `node scripts/check-ci-summary.mjs --write-fixtures`, which re-runs lint / typecheck / i18n / governance and writes their tails (all runs finish before anything is written, otherwise a mid-run rewrite would falsely redden `check:governance`); bff / ui need build output plus a real browser and are copied from `gh run view <id> --log`. Measured negatively: deleting `ui.log` → 12/14; changing `116/116 项通过` to `116/116 cases passed` → 12/14; deleting `bff.log`'s `# source:` line → 13/14. |
| 2026-11-04 | 0.36.11 | **Manifest cross-checks the samples**: `scripts/fixtures/ci-logs/.manifest.json` records each fixture's `sha256` and the `source` it claims, and `pnpm check:ci-summary` grows from 14 to 17 assertions — ⑮ manifest and fixture files match both ways (a missing or stale row reddens), ⑯ every `sha256` matches the fixture bytes (editing a sample without re-sealing reddens), ⑰ the manifest's `source` equals the fixture's `# source:` line (touching only the header is caught because the two sources disagree). This closes the gap left by the previous round: `# source:` was just a comment, and whoever edited a sample could edit it too. Sealing: `--write-fixtures` re-runs the four local steps and seals automatically, while the new `--seal` re-seals without running anything (for hand-copied bff / ui samples). Measured negatively: changing `ui.log`'s `116/116` to `118/118` without re-sealing → 16/17; rewriting only line 2 (`# source:`) of `bff.log` → 15/17 (⑯ and ⑰ both red); deleting the i18n row → 14/17. |
| 2026-11-04 | 0.36.12 | **The refresh guards itself**: `--write-fixtures` goes from "run everything, then write" to "never write a red step, and replay what you wrote" — a step exiting non-zero is skipped, so its failing output can never be frozen into a fixture pretending to be a real log (the previous round did exactly that with a red `lint.log`), while the green keys are written and sealed as usual. Each freshly written sample is immediately replayed with `grep -aE` against its row in `scripts/ci-expectations.sh`, so wording drift is reported at resample time instead of at the next assertion run. Either failure exits 1, yet the fixtures stay self-consistent (assertions still 17/17). Measured negatively: temporarily adding a `no-unused-vars` violation → `❌ 跳过 lint.log`, lint.log bytes unchanged (same sha256), the other three refreshed, exit 1; temporarily rewriting the table's `typecheck` regex to `vue-tsc-nonexistent` → `⚠️ 正则不再命中新样本：key=typecheck` plus governance skipped because ⑬ reddened, exit 1. |
| 2026-11-04 | 0.36.13 | **Backfills become machine-captured**: a new `--from-ci [run-id]` refills **all six** samples from that run's artifacts — the very files `ci.yml` tees to disk and uploads as `check-logs-quality` / `check-logs-runtime` — including bff / ui, which cannot run locally at all. The provenance reads `CI run <id> 步骤 "<step>"（job: <job>）产物 <artifact>/<file> 尾部`, with step and job names taken from that run's actual composition (a missing step is skipped and reddens), which removes the last hand-copied link in the chain and the only place a source could be invented. It also fixed `ui.log`'s stale provenance (`Build & run UI self-check` → `Page UI checks`). New assertion ⑱: every step name and artifact name in the backfill table must exist in `ci.yml` (renaming either reddens). Assertions 17 → 18. Measured: `--from-ci 41923275927` refilled all six then 18/18; `--from-ci 999999999` → clean error, exit 1; `PATH` without gh → `拿不到 run id`, exit 1; restoring the old `ui` step name → `跳过 ui.log`, exit 1 with ⑱ red too. |
| 2026-11-04 | 0.36.14 | **`--seal` demoted to an emergency exit**: it can still stamp any bytes on disk (the escape hatch when the manifest is damaged or the artifacts expired), but the normal routes are `--write-fixtures` and `--from-ci`, so three changes turn it into a visible exception instead of a silent backdoor: the script header and the first line of `--seal`'s output both state "emergency exit — and a hand seal must say in the commit message which fixture changed and why neither machine route applied"; before sealing it diffs the old manifest and prints every change (`bytes <sha>… → <sha>…` / `provenance 旧「…」新「…」` / `newly sealed` / `removed`), so nobody can "just re-seal" without seeing what they touched; when samples already match the manifest it says "this `--seal` changed nothing, nothing to commit". `readManifest()` became a shared helper for the assertion and sealing paths (a missing file or broken JSON is an empty manifest, which ⑮ reddens). Measured: deleting the `ui` row → `ui: 新封存`; one appended line in `ui.log` → `ui: 字节变了 c0821b915da3… → cc7404d46ea2…`; rewriting only `ui.log`'s `# source:` line → both "字节变了" and "出处变了 旧…/新…"; moving `ui.log` away → `ui: 已从清单移除`; sealing again unchanged → "清单无变化". Assertions still 18/18. |

