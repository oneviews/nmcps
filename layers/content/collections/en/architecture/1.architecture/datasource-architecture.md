---
docId: NMCPS-ARCH-002
title: "Data Source Architecture"
description: "Tier 1 architecture baseline for data sources (arch.datasource): data source classification (device collection/metrics/alarms/asset-config), storage layering (RDBMS control + TSDB time-series), and the cloud/edge data adapter layer with unified data flow. This is the single authority for the arch.datasource domain."
excerpt: "Data source classification, RDBMS+TSDB layering, cloud/edge adapters."
keywords:
  - "datasource"
  - "architecture"
  - "storage"
tier: 1
authority: normative
scope:
  - arch.datasource
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:data-base"
tags:
  - "Architecture"
  - "Data Source"
  - "Storage Layering"
---

# Data Source Architecture (NMCPS-ARCH-002)

> **Responsibility**: single authority for `arch.datasource` — where data is collected, how it is layered in storage, and how cloud/edge read/write through the same interface. Transport flows: `NMCPS-ARCH-001`; governance rules: `NMCPS-GOV-001`.
> **Audience**: architecture and implementation engineers / AI assistants.

---

## 1. Positioning

The data source is the "memory" of the NMS: control data (assets, config, identity) needs strong consistency, while time-series metrics need high throughput. Different storage engines carry them, decoupling read/write performance.

---

## 2. Data Source Classification

| Source | Content | Freshness | Storage |
| :--- | :--- | :--- | :--- |
| Device collection | SNMP-polled device status, MIB data | Realtime | Edge collect → cloud TSDB |
| Metrics stream | High-frequency metrics (port traffic, CPU, memory) | Realtime | TSDB |
| Alarm events | Edge-judged alarms | Realtime | RDBMS (via MQTT) |
| Assets & config | Device assets, config changes, identity | Strong consistency | RDBMS |

---

## 3. Storage Layering

| Layer | Engine | Content | Trait |
| :--- | :--- | :--- | :--- |
| Control storage | RDBMS (PostgreSQL / Supabase) | Assets, config, identity, audit | Strong consistency, RLS |
| Time-series storage | TSDB (VictoriaMetrics) | Metrics | High throughput, compression, downsampling |
| Edge local | PocketBase / SQLite | Edge offline autonomy | Lightweight (< 50MB), single binary |

Control/data separation prevents high-frequency metric writes from contending with control transactions (see `NMCPS-ARCH-001` §3).

---

## 4. Data Adapter Layer (Cloud/Edge Isomorphic)

Via Nuxt Layers, cloud and edge access their data sources through the **same composables interface**, maximizing code reuse:

| Adapter | Backend | Used by |
| :--- | :--- | :--- |
| layer-supabase | Supabase SDK + go-zero API Gateway | Cloud console |
| layer-pocketbase | PocketBase SDK + edge Go Daemon | Edge local UI |

Both sides expose identical composables interfaces; cloud/edge apps only compose different adapters while sharing UI components and business logic.

---

## 5. Data Flow

```text
Device (SNMP/Agent)
  → Edge collection (Exporter / Go Daemon)
  → Metrics stream to cloud TSDB / alarms via MQTT / config via change sets
  → Cloud RDBMS (control) + TSDB (time-series)
  → Console UI (queryCollection / composables)
```

---

## 6. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: data source architecture (classification, storage layering, cloud/edge adapter, data flow). |
