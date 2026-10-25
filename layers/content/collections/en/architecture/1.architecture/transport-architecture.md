---
docId: NMCPS-ARCH-001
title: "Transport Plane Architecture"
description: "Tier 1 architecture baseline for the transport plane (arch.transport): the edge-cloud two-tier network, control/data plane separation, three data flows (metrics/alarm/asset-config), the protocol stack, and offline autonomy with reconnection. This is the single authority for the arch.transport domain."
excerpt: "Edge-cloud two-tier, control/data separation, three data flows, offline autonomy."
keywords:
  - "transport"
  - "architecture"
  - "edge-cloud"
tier: 1
authority: normative
scope:
  - arch.transport
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:network-3"
tags:
  - "Architecture"
  - "Transport"
  - "Edge-Cloud"
---

# Transport Plane Architecture (NMCPS-ARCH-001)

> **Responsibility**: single authority for `arch.transport` — how data flows between the cloud core and edge gateways, over which protocols, and how offline autonomy and eventual consistency are guaranteed. Governance rules: `NMCPS-GOV-001`; authority index: `NMCPS-GOV-003`.
> **Audience**: architecture and implementation engineers / AI assistants.

---

## 1. Positioning

The transport plane is the "circulatory system" of the NMS: it moves edge-collected data to the cloud for analysis and pushes cloud configuration down to the edge. Its core constraint is **offline autonomy** — the edge keeps running when disconnected and converges automatically after reconnection.

---

## 2. Edge-Cloud Two-Tier Network

| Tier | Composition | Responsibility |
| :--- | :--- | :--- |
| Cloud core | Nuxt 4 console + go-zero API/RPC gateway + VictoriaMetrics TSDB | Global control plane, aggregate analysis, config push |
| Edge gateway | Nuxt 4 local UI + lightweight Go Daemon + SNMP/Agent collector | Local collection, local storage, offline autonomy |

The two tiers connect via the edge-cloud channel: KubeEdge Tunnel / gRPC Tunnel / TLS MQTT.

---

## 3. Control Plane vs Data Plane

| Dimension | Control plane | Data plane |
| :--- | :--- | :--- |
| Content | Assets, config, commands, identity | High-frequency metrics |
| Storage | RDBMS | TSDB |
| Trait | Low throughput, strong consistency | High throughput, eventual consistency |

Read/write separation is the basis for performance and scalability: high-frequency metric writes do not contend with strong-consistency transactions of control data.

---

## 4. Three Data Flows

### 4.1 Metrics Stream

Policy: **edge does not store, streams to cloud**. Metrics collected by edge exporters bypass the edge store and are pushed to the cloud TSDB via lightweight agents (or pulled across the tunnel), preserving edge disk lifetime.

### 4.2 Alarm Event Stream

Policy: **local judgement, realtime reporting, storm protection**. The edge triggers alarms locally, serializes events as JSON, and pushes them over the MQTT bus; the cloud logic layer applies adaptive rate limiting to filter alarm storms, then writes to storage and pushes to the console via Realtime.

### 4.3 Asset & Config Sync

Policy: **incremental change sets + distributed transactions + eventual consistency (LWW)**.

- Cloud→edge: config changes dispatch a distributed transaction (SAGA) across gateways with automatic compensation on failure; the database WAL produces versioned change sets pushed to a queue, which the edge subscribes to for incremental local updates.
- Offline & reconnect: during disconnection, local ops are recorded in an offline `sync_queue`; after recovery the Daemon batch-submits, and the cloud converges via Last-Write-Wins or policy-based conflict resolution.

---

## 5. Protocol Stack

| Protocol | Use | Note |
| :--- | :--- | :--- |
| SNMP / SNMPv3 | Device collection | Collect router/switch/firewall status (RFC 1157 / 3411-3418) |
| MQTT (TLS) | Alarm bus / edge messaging | Lightweight pub-sub for alarm events |
| gRPC | Edge-cloud RPC / config push | go-zero ecosystem, schema-driven (.api / .proto) |
| Edge-cloud tunnel | Channel | KubeEdge Tunnel / gRPC Tunnel |

---

## 6. Offline Autonomy & Reconnection

1. During disconnection: local collection, local storage, local UI rendering, offline queue for ops.
2. After reconnection: offline queue batch-submits → cloud converges via LWW or policy-based conflict resolution.
3. Consistency: cross-gateway batch config uses SAGA transactions with automatic compensation to avoid state residue.

---

## 7. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: transport plane architecture (two-tier network, control/data separation, three data flows, protocol stack, offline autonomy). |
