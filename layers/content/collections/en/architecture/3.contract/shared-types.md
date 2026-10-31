---
docId: NMCPS-CONTRACT-001
title: "Shared Types Contract"
description: "Tier 3 contract baseline for shared types (contract.shared-types): naming conventions, directory organization, reuse rules, and the no-any / null-semantics hard constraints for cross-module shared types, including the `/api/v1/auth` DTOs in `shared/types/auth.ts`. This is the single authority for the contract.shared-types domain."
excerpt: "Naming, directory organization and reuse rules for shared types."
keywords:
  - "contract"
  - "shared-types"
  - "types"
tier: 3
authority: normative
scope:
  - contract.shared-types
status: baseline
version: 0.2.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-002
createdAt: "2026-10-25"
updatedAt: "2026-10-31"
icon: "carbon:data-class"
tags:
  - "Contract"
  - "Types"
  - "Shared"
---

# Shared Types Contract (NMCPS-CONTRACT-001)

> **Responsibility**: single authority for `contract.shared-types` — how cross-module shared types are named, organized, and reused. Data source: `NMCPS-ARCH-002`; governance: `NMCPS-GOV-001`.
> **Audience**: implementation engineers / AI assistants.

---

## 1. Positioning

The shared types contract is the "language convention" for cross-module collaboration: any type reused by multiple modules (layers) is defined once here, and referenced everywhere else — never copy-pasted.

---

## 2. Naming Conventions

| Object | Convention | Example |
| :--- | :--- | :--- |
| Interface/type | PascalCase, semantic noun | `MetricDatapoint` |
| Union type | Lowercase literal union | `MetricType = 'counter' \| 'gauge'` |
| Type file | kebab-case, per-domain | `metric.ts` / `topology.ts` |
| Directory | `shared/types/` | Single cross-module entry |

---

## 3. Directory Organization

```text
shared/
  types/          # cross-module shared types (single source of truth)
    metric.ts
    topology.ts
    iam.ts
    ...
  constants/      # pure data constants (docId ↔ path mapping, etc.)
    docIds.ts
```

`shared/constants/docIds.ts` is pure data + pure functions (no Nuxt aliases, no IO, no side effects), shared by Nuxt and node scripts.

---

## 4. Reuse Hard Constraints

1. **No `any`**: use `unknown` or explicit unions; never let `any` leak through.
2. **null semantics**: unknown/missing is `null`; never fake truth with `0`, empty string, or `'unknown'`; `0` is a valid truth.
3. **Single source of truth**: each type is defined once; derived values are never assigned independently (mark "derived, see source").
4. **Forward compatibility**: new fields are optional (`?`); removal goes through `deprecated` first.

---

## 5. Existing Shared Types

| Type | Location | Note |
| :--- | :--- | :--- |
| `DocId` / `DOC_PATHS` | `shared/constants/docIds.ts` | docId ↔ path unique mapping |
| `LayoutMode` / `UserPreferences` | `layers/user/app/composables/useUserPreferences.ts` | Layout preference types |
| `ApiResponse` / `ApiStatus` / `ApiError` | `shared/types/api.ts` / `shared/utils/apiGuard.ts` | Unified response envelope and type guards |
| `AuthUser` / `AuthTokens` / `AuthLoginPayload` / `AuthLoginResult` / `AuthRefreshResult` / `AuthSessionState` | `shared/types/auth.ts` | `/api/v1/auth` contract: field names stay upstream camelCase (`accountCode` / `accountLevel` / `sessionId`…) with **no snake_case conversion**; the BFF only normalises the error envelope's `msg` into `message` and passes business fields through verbatim; missing semantics (e.g. login has no `displayName`) are `null`, never a look-alike field |

> As S2 domain baselines land, `metric` / `topology` contract types will migrate into `shared/types/`; this contract registers them as they evolve.

---

## 6. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: shared types contract (naming, organization, reuse constraints, existing types). |
| 2026-10-31 | 0.2.0 | Registered `shared/types/api.ts` and `shared/types/auth.ts`: verbatim upstream fields, `msg` → `message` normalisation, missing means `null`. |
