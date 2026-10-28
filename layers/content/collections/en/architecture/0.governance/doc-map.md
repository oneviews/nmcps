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
version: 0.9.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
createdAt: "2026-10-24"
updatedAt: "2026-10-28"
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
