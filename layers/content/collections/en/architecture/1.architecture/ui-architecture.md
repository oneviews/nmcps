---
docId: NMCPS-ARCH-006
title: "UI Interaction Architecture"
navigation:
  title: "UI Interaction Architecture"
  description: "The single baseline for data-form pages across the topbar / sidebar / bigscreen / mobile layouts: the two-pane split (list / detail) with its 56rem minimum page width, one content-page toolbar with left/right action ownership, the detail pane's view/edit/create states with a switch guard, record-level breadcrumbs and the selection URL contract, anti-patterns and acceptance. This is the single authority for the arch.ui domain."
description: "Tier 1 baseline for arch.ui: the per-layout content matrix, per-pane sizing for the two-pane data-form split (list / detail, with related data as sections inside the detail pane) and its container-query thresholds, the single-toolbar contract and action ownership test, the detail pane's three states with a dirty guard, and record-level breadcrumbs derived from an ?id selection contract."
excerpt: "Layout matrix, two-pane sizing with the 56rem threshold, one content-page toolbar, detail view states and record-level breadcrumbs."
keywords:
  - "ui"
  - "architecture"
  - "layout"
  - "master-detail"
  - "two-pane"
  - "min-width"
  - "toolbar"
  - "dirty-guard"
  - "breadcrumb"
tier: 1
authority: normative
scope:
  - arch.ui
status: baseline
version: 0.2.9
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-11-01"
updatedAt: "2026-11-01"
icon: "carbon:grid"
tags:
  - "Architecture"
  - "UI"
  - "Layout"
  - "Data forms"
  - "Interaction baseline"
---

# UI Interaction Architecture (NMCPS-ARCH-006)

> **Responsibility**: the single authority for the `arch.ui` domain — the structure, panes, toolbar and breadcrumb rules that apply to every **data-form page** (list / detail / CRUD) under the topbar, sidebar, bigscreen and mobile layouts.
> **Not covered**: which fields a domain has or which upstream endpoints it may call (those belong to each `NMCPS-DESIGN-00x` domain baseline); capability authorization and degradation (see `NMCPS-ARCH-005`). The decision record and rejected alternatives live in `NMCPS-ADR-0017`.
> **Audience**: front-end engineers / design reviewers / AI assistants.

---

## 1. Positioning

`useLayoutMode()` exposes four layout modes (`topbar` / `sidebar` / `bigscreen` / `mobile`), but **a page has exactly one internal structure**: every mode difference is absorbed by the outer container, and the page only reads three environment facts — available width, which element scrolls, and whether input is touch-based.

This baseline therefore governs three things:

1. **One page structure** works in all four modes; there is no "bigscreen version" and "mobile version" of the same page.
2. The three cross-domain building blocks — split, toolbar, breadcrumb — have exactly one source each; no domain may grow its own variant.
3. Column collapse, sticky offsets and action ownership all have assertable criteria, so `check:ui` can cover them.

Evidence comes from code, not preference: `app/composables/useLayoutMode.ts` (mode predicates), `app/layouts/default.vue` (scroll container and the two CSS variables), `app/components/App/AppToolbar.vue` (toolbar mount point).

---

## 2. Layout matrix

| Mode | Content width | Scroll container | Toolbar position | Pane shape |
| :--- | :--- | :--- | :--- | :--- |
| `topbar` | constrained by `topbarMaxWidthClass` (`narrow` / `wide` 1440px / `full`) | `main` | top of content, `sticky top-0` inside `main` | two panes at ≥ 56rem, otherwise overlay |
| `sidebar` | viewport − sidebar (4rem collapsed / 16rem expanded) | `main` | top of content, `sticky top-0` | same as above |
| `bigscreen` | viewport − sidebar − 16px right inset | **the page's own scroll box** (a bordered `absolute inset-y-4` frame) | `sticky top-0` **inside** that scroll box | same as above |
| `mobile` | full width | `main` | top of content | **never side by side**; overlay (list ↔ detail) |

Three hard constraints:

1. **Width decisions use container queries, not viewport breakpoints.** On the same 1920 display the sidebar reduces the content width by 12rem when it toggles, and `topbar` additionally caps at 1440px; `md:` / `lg:` misjudge both cases. The styling layer is Tailwind v4 (`max-w-(--ui-container)` / `text-(--ui-text-muted)` syntax), so use `@container` and `@min-[…]` variants directly.
2. **Sticky offsets only read variables.** `default.vue` injects `--content-sticky-top` (`0px` in `bigscreen`, `49px` otherwise) and `--content-max-h`. In `bigscreen` the toolbar and the content sit in different layers (the toolbar is rendered in two mutually exclusive places in `default.vue`), so hard-coding `0` or `49px` on a column header breaks the other mode.
3. **Mobile detection uses `isMobile`, never `!isMobileMode`.** `isMobile = isMobileMode || (max-width: 1023px)`, so a narrow desktop window (for example a 960px split screen) must also take the mobile branch.

---

## 3. Two-pane structure for data-form pages

Every data-form page uses the same skeleton: **list pane (left) + detail pane (right)**. Both panes come from one primitive, `Layout/Split.vue`; a page fills the `#list` / `#detail` slots (technical identifiers are role names — `list` / `detail`, `[data-pane="list"]`) and never builds its own grid.

**There is no third pane**: related secondary data lives in fixed sections inside the detail pane (see §3.7). Only two shapes exist — **two panes** when the desktop is wide enough, and **overlay** on mobile or when a non-mobile container is too narrow. Both shapes share one component and one `?id` contract; they differ only in arrangement and the Back button.

### 3.1 Shape resolution and the minimum page width (container width, not viewport width)

**Minimum page width (assertable constants)**:

| Quantity | Value | Meaning |
| :--- | :--- | :--- |
| `--page-min-w` | **20rem (320px)** | floor of the single / overlay shape; below it is a shell defect outside this section |
| `--split-min-w` | **56rem (896px)** | **two-pane threshold**: under 56rem only the overlay shape is allowed |
| Detail pane minimum | **32rem (512px)** | never less than this in the two-pane shape |
| List pane width | **20–24rem (default 22rem)** | draggable between 18–28rem |

56rem is arithmetic, not a convention: list maximum 24rem + detail minimum 32rem = **56rem**.

| Container width | Shape | List | Detail | Divider |
| :--- | :--- | :--- | :--- | :--- |
| `isMobile` or < 56rem | **overlay** | 100%, alternating with the detail as the current panel | 100% (covers the list), a single Back button at the left of the content toolbar | none |
| ≥ 56rem | **two panes** | 20–24rem (default 22rem), draggable | flexible, minimum 32rem | 1px `border-default`, no gap |

- **The threshold reads container width only**: sidebar collapse (−12rem), the 1440px `topbar` cap and split windows all fool viewport breakpoints. Typical counter-example: a 1024px window with the sidebar expanded leaves 768px → overlay; without the fallback the detail pane ends up a malformed 448px.
- **Three drag rules**: the list pane needs a stable `id` (`<page>-list`); double-clicking the divider resets to 22rem; the range locks to 18–28rem and never reaches 0.
- **No "collapse the list pane" affordance**: the list is the primary surface, and shrinking it to an icon rail destabilises "which pane holds the data" — go overlay when narrow.
- **`UDashboardPanel resizable` is not used**: its theme carries `min-h-svh` (`bigscreen` double scrollbars), `lg:w-(--width)` (viewport breakpoint) and `hidden lg:block` on the divider, and it stores widths in a cookie — one `document.cookie` write per pointer pixel. Use `@container` + `grid` + a local `usePaneResize` (pointer events + rAF batching + a 300ms-debounced `localStorage` write on release + keyboard support).

### 3.2 Pane responsibilities

| Pane | Must contain | Forbidden |
| :--- | :--- | :--- |
| List | identifying fields (name / code), status, timestamp; at most one row action ("select", or the domain's single high-frequency idempotent action such as enable/disable); at most two lines of information at 20–24rem. Search / filters / refresh are **not** in the pane; they inject into the content toolbar's left area (§4) | editing writes, bulk actions, cross-entity navigation entries, a third field (move it to a `title` or the detail pane), a hand-built pane header |
| Detail | a content-area title (display name + code), the record's form-style view, related sections (§3.7), field-level validation feedback, an empty state ("select a record on the left") and a loading skeleton; form content capped with `max-w` (≈640px). Record / submit actions inject into the content toolbar's right area (§4) | a second "view detail" built with `UModal` (duplicates the pane's meaning); a nested list → detail master-detail; a hand-built pane header |

The one-row-action cap is testable: mobile row heights leave no room for several buttons without dropping the hit area below 24px, and a duplicated action makes "which record am I changing" answerable from two places.

### 3.3 Height and scrolling contract

- **The definite-height chain is in place** (since 0.2.2): the `default.vue` content container is `flex min-h-0 flex-1 flex-col`, and inside it a `flex min-h-0 flex-1 flex-col overflow-y-auto` box is the scroll container. **A page root declaring `flex-1 min-h-0` is an explicit opt-in for split pages**; pages that omit it keep their content height and scroll through that container as before.
- **The toolbar sits outside the scroll container**: `AppToolbar` is rendered exactly once in `default.vue` and that render site sits outside the scroll container (the single render site of §4.3), so `--content-sticky-top` is always `0px`; panes still write `top-(--content-sticky-top)`, which visually pins them to the toolbar's bottom edge.
- Each pane is `min-h-0` and scrolls itself; **never nest `h-svh` / `h-screen` inside a pane**, otherwise `bigscreen` renders two scrollbars.
- Sticky elements inside a pane use `top-(--content-sticky-top)` and `max-h-(--content-max-h)` (`DocumentPage.vue`'s three columns are the existing correct implementation).
- **The list and detail panes scroll independently**: selecting a record must not reset the list scroll position.
- **No horizontal scrolling in any mode or shape** (from `--page-min-w` 20rem); the detail pane's form is capped with `max-w` so a wide screen never stretches single-column inputs.

### 3.4 Empty, loading and error states

Every request-backed region owns its own `pending` / `error` / `empty` state; a page-wide loading state is not acceptable. An empty list puts guidance in the detail pane instead of squeezing an empty state into the table, and a failed request reports inside its own pane while the other pane stays usable. Loading uses skeletons (five list rows, detail sections) and a refresh keeps old data plus a thin top progress bar.

### 3.5 Detail view states and the switch guard

The detail pane has exactly three states and opens in `view`:

| State | Entered by | Toolbar "record actions" | Toolbar "submit actions" | Dirty state |
| :--- | :--- | :--- | :--- | :--- |
| `view` | default / after save / cancel edit | edit, dangerous action (delete) | not rendered | none |
| `edit` | "edit" | dangerous action | cancel + save | present |
| `create` | "create" | not rendered (nothing to delete yet) | cancel + create | present |

- **The dirty flag is true only in `edit` / `create`**: row, page, window and route changes all go through `requestSwitch(next)`, and a dirty state raises "Stay / Discard and switch" with Stay focused by default.
- **A successful save** keeps the selection and patches the row in place or refreshes silently (no scroll reset, no reselect); `create` replaces the placeholder `?id` with the real id.
- **A failed save** stays in `edit`, keeps the input and shows the error nearby; never clear the form or leave edit.
- **Validation**: inline field errors plus a top summary that jumps to the first one; upstream codes (for example `10302`) map to a field (the `accountError.ts` pattern), never a bare toast.
- **Keyboard**: tab order = visual order; `⌘/Ctrl+Enter` submits; `Esc` cancels editing (confirm when dirty).

### 3.6 List rows and the default selection

- Row height 48px (`comfortable`) / 40px (`compact`, a preference, never switched by breakpoint); one primary identifier + status badge + one secondary line, truncated with a `title`.
- Selection uses two channels: `bg-elevated` + a 2px primary left bar + `aria-selected`; hit areas ≥ 44px on mobile.
- Grouping is two levels at most (group → item) with collapse state remembered per group id.
- **Default selection**: on by default in the two-pane shape (the detail pane opens in read-only `view`, so a selection gives context immediately); the sort key must **share the list's ordering** (one `sortKey` function — 1.0 shipped two copies and the default selection stopped being the first row); executed once (`settled` flag); **never in the overlay shape** (the first screen would jump straight to the detail and hide the list).
- **Rows must be focusable**: `tabindex="0"`, `Enter` / `Space` selects, plus `aria-selected`; `UTable` rows are not focusable by default, so add keyboard bindings in the row slot or use a hand-rolled listbox in the list pane.

### 3.7 Related sections inside the detail pane and feedback channels

- **Fixed placement and order**: inside the detail pane, after the main form — **overview fields → related tables → activity / audit**. No new pane, no nested master-detail.
- **Limits**: at most 2 related tables, each ≤ 5 rows by default plus "view all"; "view all" navigates to that entity's own page — **a nested list → detail inside the detail pane is forbidden**.
- **Read-only**: related tables never host the main record's CTA and never write across entities.
- Requests that depend on the current record wait for `?id`; in `create` / no selection show page copy or statistics instead of blank space.
- Each related table owns its own tri-state; one failing table never affects the main form or the others, and no data renders "no related data yet".
- In the overlay shape the sections scroll with the form and are **never folded into tabs** (one lookup path per piece of information).
- Four feedback channels: **inline** (field errors, in-pane empty/error), **toast** (write success/failure), **alert** (page-level scope copy), **modal** (destructive and unsaved confirmations). Optimistic updates only for idempotent, reversible actions (enable-disable, pin), with rollback plus a toast on failure.

---

## 4. Toolbar contract: one level, split left/right

A content page has **exactly one** toolbar: the reserved `AppToolbar` in the layout (`app/layouts/default.vue`, height read from `--app-toolbar-h`; `bigscreen` and the other modes are mutually exclusive so only one is ever mounted). Pages never build their own toolbar and never add a second header inside a pane; they inject into one of two mount points with `Teleport`:

| Area | Mount point | Content | Relation to the panes |
| :--- | :--- | :--- | :--- |
| Left | `#app-toolbar-left` | breadcrumb (`topbar` mode, always leftmost), collection actions: search, filters, sorting, bulk, refresh | same side as the list pane; operates on the whole collection |
| Right | `#app-toolbar-right` | record actions (dangerous ones left of the submit group), submit actions, primary CTA (create / save) | same side as the detail pane; operates on the selected record |

- **Why the two levels are gone** (changed in 0.2.5): a pane header next to the reserved toolbar always stacks into two 49px rows on a narrow window — 98px out of a 600px viewport. Left/right placement already expresses what an action operates on; a second bar for the same buttons buys nothing.
- **The record title (display name + code) is not a toolbar item**: it is content, rendered at the top of the detail pane's content area; in `topbar` mode the breadcrumb record segment carries the same label (§5.1) — that is also the answer to "which record am I looking at" in the overlay shape (§5.3).
- Overlay and two panes share that single level: the left/right content switches with the current panel (§4.4).

### 4.1 Left/right split

Pages inject with `Teleport`:

```vue
<Teleport to="#app-toolbar-left"> …collection actions… </Teleport>
<Teleport to="#app-toolbar-right"> …record / submit actions… </Teleport>
```

| Position | Operates on | Content |
| :--- | :--- | :--- |
| Left `#app-toolbar-left` | **the collection** | search, filters, sorting, bulk actions, refresh, column settings |
| Right `#app-toolbar-right` | **one record** | primary CTA (create / save / edit), status badge, dangerous actions (disable / delete) |

- The left area maps to the list pane and the right area to the detail pane; reviews decide by asking "does this button change the collection or one record".
- **Row-level actions never enter the toolbar; collection-level actions never enter the right area; every action has exactly one entry point per page.**
- The summary of the detail pane's related sections (for example "3 accounts in this tenant") sits next to the section title, never in a toolbar.
- A page has **at most one** primary CTA (`color="primary"`): "Create" in `create` or "Save" in `edit`; `view` has no primary and the main CTA degrades to `variant="outline"`.
- Dangerous actions sit in the right area, left of the submit group (`color="error" variant="outline"`); bulk dangerous actions sit in the left area, appear only when `selectedCount > 0` and carry a `UKbd` count.
- **Horizontal padding matches the content (12px)**: the toolbar uses `px-3` (`0.75rem`) on both sides, the same coordinate as the panes' `p-3` and the page-level alert's `mx-3` — the first left-area action lines up with the list pane's content edge, and the primary CTA lines up with the detail pane's right content edge. `UDashboardToolbar`'s own root padding must be cleared too (`px-0 sm:px-0` in `ui.root`; `px-0` alone loses to the default `sm:px-6`, which adds another 24px from 640px up). Do not copy `UHeader`'s responsive padding (`px-4 sm:px-6 lg:px-8`) either: the toolbar lives inside the content box rather than across the full viewport, so the 32px `lg` step leaves a 20px horizontal offset from the content and reads as "too much padding on both ends" (fixed in 0.2.6, measured at 12px per side by `check:ui`).
- **In `topbar` mode what lines up is the container, not the padding (0.2.8)**: the toolbar's inner container and `UHeader`'s `container` share `topbarMaxWidthClass` and are each centred, so their left edges and widths match (both `left=240` / `width=1440` at a 1920 viewport with the default `wide` preset); padding stays per-component — the toolbar keeps `px-3` while the header keeps `UContainer`'s `px-4 sm:px-6 lg:px-8`, so the two content left edges always differ by 20px. That difference is **intentional**: the toolbar aligns with the page content (the `p-3` inside the scroll container), the header aligns with its own 32px. Making the toolbar take `lg:px-8` only indents it another 20px inside the content box (measured in 0.2.6 as "too much padding on both ends"). `check:ui` asserts all three numbers (12 / 32 / 20) — read this line before touching any padding.

### 4.2 Action ownership test (three questions)

Stop at the first hit; the answer now decides **which area**, not which level:

1. Does it change the **collection** (many / all)? → left area.
2. Does it change **one record** (including dangerous actions)? → right area, "record actions" group.
3. Does it change **only the unsaved draft** (cancel / save)? → right area, "submit actions" group.
4. None of the above (cross-page, read-only navigation, global)? → never a new bar: rightmost of the right area, or inside the page content (e.g. a help link).

The right area has a fixed order (left → right, never reordered): **record actions (dangerous leftmost) → submit actions → primary CTA**. The title no longer occupies a toolbar slot.

### 4.3 Injection mechanism

- `Teleport` replaces module-level shared state: it has no global state, removes itself on unmount, is SSR-safe and cannot leak across `<KeepAlive>` pages; a page no longer needs an extra SFC just to pass a `Component`.
- Both mount points stay in the DOM even when the toolbar collapses (§4.4), so a static target id is safe; and because there is only **one** render site for every mode (next bullet), a layout-mode switch never destroys the mount point, so the injected content survives.
- The old `usePageToolbar()` module-level `shallowRef` channel is **retired**: the project runs `ssr: false`, so there is no cross-request sharing, but it is a module-level singleton (multiple instances on one page overwrite each other) and it forces an extra SFC just to pass actions — those are the reasons, not SSR.
- **Emptiness must be observed, not computed**: teleported content is not a reactive child of `AppToolbar`, so neither `$slots` nor a `computed` can see it. `AppToolbar` opens a `MutationObserver` (`childList`) on both mount points when it mounts and collapses the whole bar accordingly (§4.4). That missing observer is why the reserved bar used to sit empty at 49px on every page.
- **A single render site** (corrected in 0.2.7): `AppToolbar` is rendered **once** in `default.vue`, outside the scroll container (§3.3). Never split it into `<AppToolbar v-if="isBigscreenMode" />` plus `v-if="!isBigscreenMode" />`: `Teleport` binds its target node at mount time, so a layout-mode switch that destroys and recreates the mount point leaves the page's teleported content attached to a node inside a **detached subtree** — the bar is still there while the search box and every button are gone (measured in sidebar mode). `check:ui` switches to sidebar via the preferences panel and then asserts the actions are still mounted.

### 4.4 One level, height and narrow screens

- Toolbar height reads a **single token `--app-toolbar-h`** (49px-equivalent rem, same source as `--content-sticky-top`) and never wraps; on overflow the right end folds into a `UDropdownMenu` (`⋯`) keeping the primary and dangerous actions, never hiding them wholesale. It scales with `--app-font-scale`.
- **Nothing to show means no bar at all**: with no breadcrumb (non-`topbar` mode) and no injected actions, `AppToolbar` collapses to zero height and drops `bg` / `backdrop-blur` / bottom border (`min-h-0 h-0 overflow-hidden border-b-0 bg-transparent backdrop-blur-none`), so it stops stealing a toolbar row on every page. The mount points stay in the DOM, so a page that injects actions later restores the bar (collapsed then expanded, one frame of movement is acceptable). `mobile` follows the same rule as `bigscreen`: no actions means zero height.
- **`topbar` never collapses (the exception)**: the breadcrumb sits leftmost in the left area, so collapsing would leave it nowhere to go — a `topbar` page with no actions still keeps a 49px bar rendering only the breadcrumb, with zero children in the left mount point. That is a fixed cost of topbar mode rather than a missed collapse, which is why the emptiness check reads `!isTopbarMode && !hasPageActions`; decide where the breadcrumb would live before changing it.
- Icon buttons need `aria-label` + Tooltip (`UKbd` for the shortcut); toolbar buttons are always `size="sm"`.
- **Overlay follows the current panel** (same level, no extra row): list panel = collection actions in the left area (including "Create") and an empty right area; detail panel = "Back" leftmost in the left area, record/submit actions in the right area and "Create" hidden. Two panes = collection actions left and record actions / primary CTA right, simultaneously.
- "Back" is rendered by the **page** into the left area (`Layout/Split.vue` no longer ships its own in-pane back row); the two-pane shape never renders "Back".

---

## 5. Record-level breadcrumbs and the selection URL contract

A breadcrumb is the **route hierarchy (generated)** plus the **current selection (record level, clearable)**. The two have different sources and must never be merged into a single array written by the page.

### 5.1 Division of labour

| Segment | Source | Changes when | Clickable |
| :--- | :--- | :--- | :--- |
| Route segment | `useNavigation().breadcrumb`, derived from `meta.sort` / `meta.name` | the route changes | middle segments navigate; the last segment (current page) does not |
| Record segment | record context (display name of the selected record) | the selection changes or detail data arrives | no `to`; rendered as a button whose click **clears the selection** (on mobile this is "back to list") |

- The record segment is appended **only in last position**; there is no "route → record → sub-page" three-level chain, because a breadcrumb expresses hierarchy, not field-level paths.
- Its label updates by itself as data moves from `pending` to `loaded` (code while loading, display name afterwards); pages must not hand-write a `watch` to re-inject it.
- Content-centre document titles keep using `route.meta.breadcrumb` (existing implementation, single writer per page) and never conflict with the record segment; when both exist the record segment comes after.

### 5.2 Selection lives in the URL

The single source of truth for the selected record is the URL query `?id=<record identifier>` (for example `/system/user?id=ACC0001`).

| Situation | Behaviour | Why |
| :--- | :--- | :--- |
| Row click in the two-pane shape | `router.replace` | both panes are on screen, so a click means "view" and must not pollute history |
| Row click in the overlay shape | `router.push` | the overlay needs the system back gesture to return to the list |
| Opening a link that carries `?id` | select that record once the list loads | shareable deep links, refresh keeps context |
| `?id` **not present in the current `rows`** | detail empty state "this record is not in the current filter / page" + "clear selection", no detail request | with no detail endpoint the list result is the only reliable source; silently paging to find it would desync the filter state from the URL |
| `?id` points at a missing record | detail empty state plus one notice, URL kept | an upstream hiccup must not be rendered as "record deleted" |

> **History follows the shape, not the device**: width varies on one device (window resizing, sidebar toggling) and the shape can change mid-session; deriving it from the device makes Back in a narrow desktop window jump to the list instead of the previous record.

**Implementation (landed in 0.2.3)**: reading and writing go through `useRecordSelection` (`app/composables/useRecordSelection.ts`) — `?id` is the single source of truth, the membership test only looks at the current `rows`, and `?id` never enters the list request key; two panes use `replace`, the overlay uses `push`; the two-pane default selection is enabled with `autoSelect` + `defaultRecord` (which must share the list's `sortKey`), runs once, and the overlay never auto-selects. The record segment goes through `useRecordContext` (`app/composables/useRecordContext.ts`): the page binds its label source once (identifier → display name updates automatically) and `AppToolbar` appends it as the last breadcrumb item rendered as a button, where a click clears the selection.

### 5.3 Overlay degradation

- In the overlay shape (mobile or a container under 56rem) the header breadcrumb is hidden (currently `hidden md:flex`), so **the record name must be repeated at the top of the detail pane's content area** (content title: display name + code); otherwise the user cannot confirm which record is on screen.
- In the overlay shape "back to list" has exactly **two equivalent entry points**: the Back button injected by the page at the left of the content toolbar's left area (`Layout/Split.vue` no longer ships one), and the browser / system back button (the overlay uses `push`). The two-pane shape **renders no** Back button.

---

## 6. Anti-patterns

| Anti-pattern | Consequence | Correct approach |
| :--- | :--- | :--- |
| Deciding the shape from viewport breakpoints (`md:` / `lg:`) | misjudged for a collapsed sidebar, a capped topbar and narrow split screens alike | container queries (`@container`) plus the 56rem threshold |
| Hard-coding sticky offsets (`top-0` / `top-[49px]`) | double scrollbars in `bigscreen`, or a header hidden behind the toolbar | `top-(--content-sticky-top)`, height from `--app-toolbar-h` |
| Page-built split grids | four modes drift apart and `check:ui` cannot assert them uniformly | the `Layout/Split.vue` primitive |
| A split container that keeps `min-h-full` | no definite height outside `bigscreen`, so in-pane scrolling degrades into whole-page scrolling | content container `flex min-h-0 flex-1 flex-col`, page root `flex-1 min-h-0` |
| Deriving `push` / `replace` from the device (`isMobile`) | width varies on one device, so Back misbehaves in a narrow desktop window | derive history behaviour from the current shape |
| A nested list → detail inside the detail pane | stacked master-detail, no unique answer for back semantics or breadcrumbs | related tables only link out through "view all" |
| Row actions plus toolbar actions for the same thing | two entry points for one action, hit area too small on mobile | at most one row action, the rest on the toolbar |
| `UModal` for "view detail" | a pane empty state and a modal say the same thing, back stack gets confusing | the detail pane |
| A page writing `route.meta.breadcrumb` to build the record segment | multiple writers overwrite each other, labels leak after leaving the page | derive from record context |
| A page-wide single loading / error state | one failing pane takes the whole page down | per-pane tri-state |
| A hand-built toolbar or actions inside a `UCard` header | action position drifts from page to page | inject through `Teleport` into the content toolbar (§4) |
| The detail pane editable by default (no `view` state) | the dirty flag is permanent, every row switch prompts, and accidental edits are maximal | `view → edit → create` |
| A second sort implementation for the default selection | the default selection is not the first row | reuse the list's own `sortKey` |
| `UModal` carrying a record's edit form | two entry points for one record and two dirty guards | an inline form in the detail pane (modals only for one-off forms with no record) |
| A second toolbar built inside a pane (a pane header holding another row of actions) | two stacked rows on a narrow screen eat 98px of a 600px viewport; action ownership drifts per page | inject everything through `Teleport` into the content toolbar, split left/right |

---

## 7. Acceptance and guards

| Assertion | Where | Covers |
| :--- | :--- | :--- |
| Six container widths (320 / 768 / 1024 / 1366 / 1440 / 1920) each render the pilot page: two panes at ≥ 56rem and non-`mobile`, overlay otherwise; no horizontal scroll and no nested scrollbars at any width | `check:ui` (measured on `/system/user` across six widths: shape plus both `[data-pane]` visibilities; "no nested scrollbars" is still manual) | shape resolution + minimum page width |
| At 320px `--page-min-w` holds: the list's primary action stays visible and the toolbar folds into `⋯` instead of wrapping | `check:ui` (asserts no horizontal overflow at 320px; "primary action visible / `⋯` folding" is still manual) | minimum page width |
| Two panes: detail ≥ 32rem; the list drags between 18–28rem and survives a refresh; double-click resets to 22rem | `check:ui` / manual | resizable split |
| In the overlay a row click turns the URL into `?id=…` with `push`; the system back button and the toolbar's Back both return to the list; the two-pane shape renders no Back button | `check:ui` (480px viewport: the click writes `?id`, `goBack()` returns to the list) + a real device | overlay shape |
| In `topbar` mode the toolbar breadcrumb gains a record segment once a record is selected, and clicking it removes that segment | `check:ui` (switch to "Topbar" at a 1920 viewport: `[System / Users / Alice]` → clicking the record segment leaves `[System / Users]` and drops `?id` from the URL) | record-level breadcrumb |
| A deep link carrying `?id` selects the record and leaves the list scroll position alone; an `?id` outside the current `rows` shows the detail empty state with **zero detail requests** | `check:ui` (hit row plus detail pane; an `?id` outside `rows` keeps the URL, shows the notice and issues 0 detail requests) | selection in the URL |
| Every pane has ≤ 1 row action, none duplicated in a toolbar; ≤ 1 primary per page; the page renders exactly **one** toolbar (the reserved content one), actions split into its left / right area, and the bar collapses when there is nothing to show | review + `check:ui` (`/system/user`: the reserved toolbar holds the search box and "Create", no second bar inside the panes; a page with no actions collapses it) | action ownership + one level |
| The overlay toolbar follows the current panel: collection actions on the list, the left-area "Back" plus record actions on the detail | `check:ui` (480px: a search box on the list, a "Back" button and no search box on the detail) | one-level toolbar |
| Switching rows in `view` raises nothing; in `edit` it raises "Stay / Discard and switch" with Stay focused by default | `check:ui` | view states and guard |
| The default selection equals the first list row (one `sortKey`); the overlay shape never defaults | `check:ui` (two panes select the first row and `replace` `?id`; the overlay loads with no `?id`) | default selection |
| List rows are focusable (`tabindex="0"` + `Enter`/`Space` + `aria-selected`) | review + `check:ui` | accessibility |
| The toolbar keeps 12px per side, the left area lines up with the list pane's row content and the right area with the detail pane's right content edge | `check:ui` (12px measured per side; the row content starts at 14px = 12px padding + 2px selected border) | horizontal padding |
| Switching layout mode (bigscreen → sidebar) keeps the toolbar actions mounted: one bar per page, both areas still populated | `check:ui` (switch to "Sidebar" in the preferences panel, then assert `h=49`, left area child count > 0 and "Create" still in the right area) | single render site |
| `topbar` mode: the toolbar and the header share the same constrained container (left edge / width) while each keeps its own padding, 12px and 32px — the 20px difference is intentional, and the toolbar stays flush with the page content's left edge | `check:ui` (1920 viewport: header and toolbar containers both `240/1440`; toolbar 12px, header 32px, toolbar-to-content offset 0) | topbar alignment |
| An action-less page (`/dashboard/overview`) collapses entirely in `bigscreen` / `mobile` (zero height, no backdrop, no bottom border), while `topbar` does **not** collapse: it keeps only the breadcrumb with zero children in the left mount point | `check:ui` (bigscreen `h=0`; switch to "Topbar": `h=49`, breadcrumb `[System / Overview]`, 0 left children; switch to "Mobile": `h=0 backdrop=none border-b=0px`) | collapse when empty |

`check:ui` currently runs 90 assertions (90/90 green on 2026-11-01), of which the 18 `/system/user` cases cover rows 1, 2, 4, 5, 6, 7, 8, 10, 12, 13 and 14 above (row 2 only covers "no horizontal overflow"); row 15's three-mode collapse runs on `/dashboard/overview`. Whenever the number of cases changes, update this sentence together with the script output so no stale count survives.

**Coverage gap**: the `edit` state and dirty guard, related sections, and `DELETE`-style dangerous actions need at least one domain with a `PUT` and related data to be accepted; `/system/user` only has list / create / status, so these stay **parked** until the second form page lands and must not be signed off as "covered".

---

## 8. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-11-01 | 0.1.0 | Initial: layout matrix, three-pane data-form structure and column collapse (52rem / 80rem), toolbar left/right semantics injected via `Teleport`, record-level breadcrumbs and the `?id` contract, anti-patterns and acceptance. Decision record: `NMCPS-ADR-0017`. |
| 2026-11-01 | 0.2.0 | Baseline detail filled in from the 1.0 reference implementations (`connector/device.vue`, `system/user.vue`): §3.1 gains per-pane sizing for the three shapes plus the three drag rules; §3.5 the detail pane's `view/edit/create` states and switch guard; §3.6 list rows and the shared `sortKey` requirement for the default selection; §3.7 the related pane and four feedback channels; §4 upgraded from a page toolbar to a **two-level contract (L0 page / L1 pane)** with the three-question ownership test, a fixed 49px height and overflow folding; §6 and §7 updated to match. |
| 2026-11-01 | 0.2.1 | **Three panes collapsed into two**: §3 is now list / detail only, with no third pane and no collapse order; §3.1 becomes "shape resolution + **minimum page width**" — `--page-min-w` 20rem, two-pane threshold `--split-min-w` 56rem (= list maximum 24rem + detail minimum 32rem), detail ≥ 32rem, decided by "`isMobile` or container < 56rem → overlay, otherwise two panes", and `UDashboardPanel resizable` is explicitly excluded; §3.2 covers two panes and forbids nested master-detail in the detail pane; §3.3 adds the definite-height chain and "no horizontal scrolling in any shape"; §3.6 makes the default selection shape-dependent and requires focusable rows; §3.7 turns the related pane into **sections inside the detail pane** (≤ 2 tables, ≤ 5 rows each); §4.4 reads `--app-toolbar-h` and requires **one toolbar level in the overlay**; §5.2/§5.3 derive history from the shape and add the "`?id` outside the current rows" branch; §6/§7 update anti-patterns and acceptance and correct two false statements (the `check:ui` layout-switch coverage and the `usePageToolbar` cross-request sharing, irrelevant under `ssr: false`). |
| 2026-11-01 | 0.2.2 | Mechanism landed and documented: §3.3 now describes the definite-height chain as built (content container `flex min-h-0 flex-1 flex-col` plus a nested scroll container; a page root with `flex-1 min-h-0` is the explicit split-page opt-in) and records that the toolbar sits outside the scroll container in both modes, so `--content-sticky-top` is `0`. `--app-toolbar-h` is the single source of toolbar height, deleting `usePageToolbar` in favour of the `#app-toolbar-left` / `#app-toolbar-right` mount points, and `Layout/Split.vue` + `usePaneResize` were measured at 320 / 768 / 1024 / 1366 / 1440 / 1920 (both shapes, no horizontal scroll, 18–28rem drag, 22rem double-click reset, width remembered across reloads). |
| 2026-11-01 | 0.2.3 | **Selection URL contract landed**: §5.2 gains an implementation note — `useRecordSelection` (`app/composables/useRecordSelection.ts`) owns `?id`: membership is tested against the current `rows` only, `?id` never enters the list request key, two panes use `replace` and the overlay `push`, and the default selection is enabled with `autoSelect` + a `defaultRecord` sharing the list `sortKey` (the overlay never auto-selects). The record segment goes through `useRecordContext` (`app/composables/useRecordContext.ts`) and `AppToolbar` renders it as the last breadcrumb item, clickable to clear the selection. `/system/user` now uses the contract (focusable rows, selected highlight, `?id` outside `rows` shows a notice plus clear without any extra request); the two-pane shape and the default selection follow in migration step 4, and the `check:ui` cases in §7 are still pending. |
| 2026-11-01 | 0.2.4 | **`/system/user` two-pane migration complete**
| 2026-11-01 | 0.2.5 | **The toolbar collapses to a single level, split left/right** (reverting the L0/L1 layering of 0.2.0): the reserved `AppToolbar` is the only toolbar, pages `Teleport` into `#app-toolbar-left` (collection actions: search / filters / refresh) and `#app-toolbar-right` (record / submit actions / primary CTA), and panes no longer host headers — the overlay and the two-pane shape share that one level and switch its content with the current panel; `Layout/Split.vue` drops `#list-toolbar` / `#detail-toolbar` and its built-in back row, so "Back" is injected by the page into the left area; the record title (display name + code) moves to the top of the detail pane's content area (which is how §5.3 answers "which record am I looking at"); `AppToolbar` watches both mount points with a `MutationObserver` and collapses to zero height when there is no breadcrumb and nothing injected (teleported content is not a reactive child, so a `computed` cannot see it — that gap is why every page used to carry an empty 49px bar). §3.2 / §3.1 / §5.3 / §6 / §7 rewritten accordingly. |
| 2026-11-01 | 0.2.6 | **Toolbar horizontal padding aligned with the content**: §4.1 gains a rule — the content-page toolbar uses `px-3` (12px) on both sides, the same coordinate as the panes' `p-3` and the page-level alert's `mx-3`, so the first left-area action lines up with the list pane's content edge and the primary CTA lines up with the detail pane's right content edge; `UDashboardToolbar`'s root padding is cleared as well (`px-0 sm:px-0`, because `px-0` alone loses to the default `sm:px-6` and adds another 24px from 640px up), and `UHeader`'s `px-4 sm:px-6 lg:px-8` is ruled out (the toolbar sits inside the content box, and the `lg` 32px step left a 20px offset from the content). `AppToolbar` switched to `px-3` + root `sm:px-0`; §7 gains row 12 (12px per side, left area aligned with the row content) and `check:ui` gains one assertion, 83 → 84. |
| 2026-11-01 | 0.2.8 | **`topbar` mode gains `check:ui` cases (breadcrumb record segment + container alignment)**: row 5 of §7 moves from "to be added" to "covered" — after switching to "Topbar" at a 1920 viewport the breadcrumb reads `[System / Users / Alice]`, and clicking the record segment returns to two segments with `?id` gone. New row 14: "the toolbar and the header align on the **constrained container** (both `left=240` / `width=1440`) while each keeps its own padding, 12px vs 32px, and the 20px difference is intentional", now also stated in §4.1. `check:ui` grows to 88 assertions (85 → 88). |
| 2026-11-01 | 0.2.7 | **The toolbar now has a single render site (fixes "actions vanish in sidebar mode")**: `default.vue` used to render `<AppToolbar>` twice, once per mode (`v-if="isBigscreenMode"` inside the scroll container, `v-if="!isBigscreenMode"` outside). A layout-mode switch destroyed and recreated that mount point, so the page's teleported content stayed attached to a node inside a detached subtree — the bar was still there while the search box and every button were gone (measured in sidebar mode: `leftKids=0`). It is now rendered **once, outside the scroll container** for every mode (what §3.3 always described; `sticky top-0` becomes a harmless no-op in `bigscreen`). §4.3 gains the "single render site" rule, §3.3 wording follows, §7 gains row 13 and `check:ui` grows to 85 assertions (switch to "Sidebar", then assert the actions are still mounted). |

| 2026-11-01 | 0.2.9 | **The no-action page contract now covers every mode in §4.4 / §7**: the doc only said "nothing to show means no bar at all" and `check:ui` only proved it in bigscreen, leaving the `topbar` exception (a persistent breadcrumb means the bar never collapses) and the `mobile` rule unstated. §4.4 now records that `bigscreen` and `mobile` collapse to zero height while `topbar` keeps a 49px bar with only the breadcrumb and an empty left mount point (emptiness reads `!isTopbarMode && !hasPageActions`); §7 gains row 15 (`/dashboard/overview`: bigscreen `h=0`; topbar `h=49` with `[System / Overview]` and 0 left children; mobile `h=0 backdrop=none border-b=0px`). `check:ui` 88 → 90 assertions. |
