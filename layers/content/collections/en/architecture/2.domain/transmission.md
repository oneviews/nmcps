---
docId: NMCPS-DESIGN-003
title: "Transmission Control Domain Baseline"
description: "Tier 2 design baseline for the transmission control domain (domain.transmission): data transfer task control and automated transfer scheduling. This is the single authority for the domain.transmission domain."
excerpt: "Data transfer task control and automated scheduling."
keywords:
  - "transmission"
  - "baseline"
tier: 2
authority: normative
scope:
  - domain.transmission
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-001
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:send-alt"
tags:
  - "Domain"
  - "Transmission"
---

# Transmission Control Domain Baseline (NMCPS-DESIGN-003)

> **Responsibility**: single authority for `domain.transmission` — control and automated scheduling of data transfer tasks. Transport plane: `NMCPS-ARCH-001`.
> **Audience**: implementation engineers / AI assistants.

---

## 1. Positioning

Transmission control is the "execution plane" of the NMS: it orchestrates, controls and auto-schedules data transfer tasks, ensuring data flows between edge and cloud on time and reliably.

---

## 2. Functional Scope

| Sub-page | Function |
| :--- | :--- |
| transmit | Data transfer task control |
| auto-transmit | Automated transfer scheduling |

---

## 3. Key Data Entities

| Entity | Note |
| :--- | :--- |
| Transfer Task | Orchestration unit of a transfer |
| Schedule | Timed/triggered transfer policy |
| Status | In-progress / success / failed / retry |

---

## 4. Domain Boundary & Dependencies

- **Upstream**: edge-cloud channel and protocol stack (`NMCPS-ARCH-001`).
- **Consumers**: scenario (data dispatch), dashboard (status display).
- **Out of scope**: low-level link scheduling (transport plane `NMCPS-ARCH-001`).

---

## 5. Roadmap

1. Manual transfer task orchestration and status tracking.
2. Automated scheduling (timed/event-triggered).
3. Resume from breakpoint and retry.

---

## 6. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: transmission control domain baseline. |
