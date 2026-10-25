---
docId: NMCPS-DESIGN-004
title: "Device Networking Domain Baseline"
description: "Tier 2 design baseline for the device networking domain (domain.device): device asset management, device types, routing, meshing, and policy configuration. This is the single authority for the domain.device domain."
excerpt: "Device assets, types, routing, meshing and policy."
keywords:
  - "device"
  - "networking"
  - "baseline"
tier: 2
authority: normative
scope:
  - domain.device
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-002
  - NMCPS-ARCH-003
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:data-connected"
tags:
  - "Domain"
  - "Device"
  - "Networking"
---

# Device Networking Domain Baseline (NMCPS-DESIGN-004)

> **Responsibility**: single authority for `domain.device` — device assets, types, routing, meshing, and policy config. Device identity/access: `NMCPS-ARCH-003`.
> **Audience**: implementation engineers / AI assistants.

---

## 1. Positioning

Device networking is the "asset plane" of the NMS: it manages the asset ledger and types of managed devices, orchestrates routing and meshing, and pushes policy configuration.

---

## 2. Functional Scope

| Sub-page | Function |
| :--- | :--- |
| type | Device type management |
| device | Device asset management |
| route | Routing orchestration |
| mesh | Meshing (mesh topology) |
| policy | Policy configuration |

---

## 3. Key Data Entities

| Entity | Note |
| :--- | :--- |
| Device | Asset record of a managed element |
| Device Type | Model/role classification |
| Route | Forwarding path between devices |
| Mesh | Device mesh topology |
| Policy | Config policy pushed to devices |

---

## 4. Domain Boundary & Dependencies

- **Upstream**: asset storage (`NMCPS-ARCH-002`), device access control (`NMCPS-ARCH-003`).
- **Consumers**: topology (display), scenario (modeling input).
- **Out of scope**: device runtime monitoring (topology), config push channel (transport `NMCPS-ARCH-001`).

---

## 5. Roadmap

1. Device asset ledger and type management.
2. Routing and mesh topology orchestration.
3. Policy config push (via transport change sets).

---

## 6. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: device networking domain baseline. |
