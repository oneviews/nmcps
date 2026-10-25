---
docId: NMCPS-DESIGN-001
title: "Topology Monitoring Domain Baseline"
description: "Tier 2 design baseline for the topology monitoring domain (domain.topology): topology visualization of network devices and links, and collection/display of device and link metrics. This is the single authority for the domain.topology domain."
excerpt: "Topology visualization and device/link metrics for monitoring."
keywords:
  - "topology"
  - "monitoring"
  - "baseline"
tier: 2
authority: normative
scope:
  - domain.topology
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
  - NMCPS-ARCH-001
  - NMCPS-ARCH-002
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:cloud-monitoring"
tags:
  - "Domain"
  - "Topology"
  - "Monitoring"
---

# Topology Monitoring Domain Baseline (NMCPS-DESIGN-001)

> **Responsibility**: single authority for `domain.topology` — topology visualization of devices and links, and collection/display of monitoring metrics. Collection: `NMCPS-ARCH-001`; storage: `NMCPS-ARCH-002`.
> **Audience**: implementation engineers / AI assistants.

---

## 1. Positioning

Topology monitoring is the "observation plane" of the NMS: it visualizes device nodes and link relationships, monitors device/link metrics in realtime, and supports fault location and capacity planning.

---

## 2. Functional Scope

| Sub-page | Function |
| :--- | :--- |
| monitor | Network topology graph and global overview |
| link-metrics | Link metrics (bandwidth, latency, loss) |
| device-metrics | Device metrics (CPU, memory, port traffic) |

---

## 3. Key Data Entities

| Entity | Note |
| :--- | :--- |
| Device Node | Routers/switches/firewalls etc. |
| Link | Physical/logical connections between devices |
| Topology | Visual model of nodes + links |
| Metric | Time-series monitoring data (in TSDB) |

---

## 4. Domain Boundary & Dependencies

- **Upstream**: device collection (SNMP, `NMCPS-ARCH-001`), metric storage (TSDB, `NMCPS-ARCH-002`).
- **Consumers**: dashboard (overview), scenario (modeling input).
- **Out of scope**: device config push (device domain), alarm rule management (system domain).

---

## 5. Roadmap

1. Topology graph rendering (Canvas/SVG nodes + links).
2. Device-type icon auto-matching.
3. Realtime metric refresh with alarm linkage.

---

## 6. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: topology monitoring domain baseline. |
