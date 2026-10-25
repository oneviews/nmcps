---
docId: NMCPS-ARCH-003
title: "IAM Architecture"
description: "Tier 1 architecture baseline for identity and access management (arch.iam): the AAA framework (AuthN/AuthZ/Audit), the five-layer IAM architecture, flexible RBAC + ABAC, multi-tenant isolation, and compliant auditing. This is the single authority for the arch.iam domain."
excerpt: "AAA framework, five-layer IAM, RBAC+ABAC, multi-tenant isolation."
keywords:
  - "iam"
  - "architecture"
  - "access-control"
tier: 1
authority: normative
scope:
  - arch.iam
status: baseline
version: 0.1.0
owner: "NMCPS Team"
reviewBy: "2027-03-31"
dependsOn:
  - NMCPS-GOV-001
  - NMCPS-GOV-003
createdAt: "2026-10-25"
updatedAt: "2026-10-25"
icon: "carbon:user-certification"
tags:
  - "Architecture"
  - "IAM"
  - "Access Control"
---

# IAM Architecture (NMCPS-ARCH-003)

> **Responsibility**: single authority for `arch.iam` — ensure the right entity accesses the right resource in the right way within the right context. Governance rules: `NMCPS-GOV-001`; authority index: `NMCPS-GOV-003`.
> **Audience**: architecture and implementation engineers / AI assistants.

---

## 1. Positioning

IAM (Identity and Access Management) is the security cornerstone; its mission is "four rights": in the right context, let the right Subject access the right Resource in the right Action.

---

## 2. AAA Framework

```text
Subject ──► AuthN ──► AuthZ ──► Resource
                   │
                   ▼
                Audit
```

| Stage | Meaning | Typical means |
| :--- | :--- | :--- |
| Subject | Who made the request | User, service account, API key, external system |
| AuthN | Prove "you are you" | Password, MFA, OIDC, SSO token |
| AuthZ | Decide "what you can do" | RBAC roles / ABAC attribute policies |
| Audit | Record "who did what, when" | Audit log, SIEM ingestion |

---

## 3. Five-Layer IAM Architecture

| Layer | Composition |
| :--- | :--- |
| Ingress | OIDC / OAuth 2.0 / SAML gateway, SSO entry |
| Identity management | User/org tree (LDAP), service accounts (ServiceAccount / API Key) |
| Policy decision | PDP (decision) + PEP (enforcement/interception) |
| Storage | Policy store (RBAC roles + ABAC policy docs), role/group mappings |
| Audit | Audit logs (CloudTrail / SIEM), anomaly analysis |

---

## 4. Flexible RBAC + ABAC

| Model | Logic | Fit |
| :--- | :--- | :--- |
| RBAC | User → Role → Permission | Small/medium systems, simple |
| ABAC | Attribute policy: `IF (Subject.attr == Resource.attr AND condition) THEN Allow` | Complex context (IP, time window) |

The system combines both: user-role mapping uses standard RBAC (`sys_role` + `sys_user_role_relation`), while concrete permission logic is decoupled into the `sys_policy` table storing ABAC policy documents as JSONB (Effect / Action / Resource / Condition), satisfying context controls like "specific IP only" or "time-window only" and avoiding role explosion.

---

## 5. Multi-Tenant Isolation

All business core tables are bound to `tenant_id` for multi-tenant isolation; ID fields are uniformly `VARCHAR(64)` (snake_case) to fit Snowflake 64-bit integers and avoid JavaScript precision loss.

---

## 6. Security Audit

`sys_audit_log` is append-only, capturing the full AAA trail: Subject, Action, Resource, Result (allow/deny), Context (IP, UA, time window), providing raw evidence for SIEM / UEBA (aligned with ISO/IEC 27001 and GB/T security requirements).

---

## 7. Changelog

| Date | Version | Change |
| :--- | :--- | :--- |
| 2026-10-25 | 0.1.0 | Initial: IAM architecture (AAA framework, five-layer architecture, RBAC+ABAC, multi-tenant, audit). |
