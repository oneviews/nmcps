---
docId: NMCPS-DESIGN-007
title: "Dashboard Domain Baseline"
description: "Tier 2 design baseline for the dashboard domain (domain.dashboard): system overview, agent assistant, Kubernetes monitoring, and big-screen presentation. This is the single authority for the domain.dashboard domain."
excerpt: "Overview, agent assistant, Kubernetes monitoring, big screen."
keywords:
  - "dashboard"
  - "big-screen"
  - "baseline"
tier: 2
authority: normative
scope:
  - domain.dashboard
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-002
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:dashboard"
tags:
  - "Domain"
  - "Dashboard"
  - "Big Screen"
---

# Dashboard Domain Baseline (NMCPS-DESIGN-007)

> **Responsibility**: single authority for `domain.dashboard` — system overview, agent assistant, Kubernetes monitoring, and big-screen presentation. Data consumption: `NMCPS-ARCH-002`.
> **Audience**: implementation engineers / AI assistants.

---

## 1. Positioning

The dashboard is the "presentation plane" of the NMS: it aggregates status across domains, providing system overview, agent interaction, cloud-native resource monitoring, and command big screens.

---

## 2. Functional Scope

| Sub-page | Function |
| :--- | :--- |
| overview | System overview |
| agent | Agent assistant |
| kubernetes | Kubernetes resource monitoring |
| screen | Command big screen |

---

## 3. Key Data Entities

| Entity | Note |
| :--- | :--- |
| Overview | Cross-domain aggregated summary metrics |
| Agent Session | Human-machine interaction context |
| Cluster Resource | Cloud-native resource status |

---

## 4. Domain Boundary & Dependencies

- **Upstream**: cross-domain aggregated data (`NMCPS-ARCH-002`).
- **Consumers**: end users (the single aggregation entry).
- **Out of scope**: raw per-domain data (provided by each `domain.*`).

---

## 5. Roadmap

1. System overview (cross-domain metric aggregation).
2. Agent assistant (natural-language ops).
3. Kubernetes monitoring and command big screen.

---

## 6. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: dashboard domain baseline. |
