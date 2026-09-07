# Sprint 4A Architecture Package

Status: **PROPOSED — not deployed, not production-approved**.

This package maps the browser-local GasGuard prototype to a future central backend without changing the prototype source, safety formulas, thresholds, provider contract, or edge behavior.

| Document | Purpose |
| --- | --- |
| [ADR-001](adr-001-backend-stack.md) | Backend stack alternatives and recommendation |
| [Backend architecture](backend-architecture.md) | Components, trust boundaries, data flow, edge boundary |
| [Database schema](database-schema.md) | Conceptual PostgreSQL schema and ER diagrams |
| [Security model](security-model.md) | Identity, RBAC, site isolation, threat model |
| [Device ingestion contract](device-ingestion-contract.md) | Proposed MQTT/REST device ingress contract |
| [Incident processing](incident-processing.md) | Transaction, deduplication, audit and notification flow |
| [API contract](api-contract.md) | Proposed HTTP API surface and error model |
| [Data retention](data-retention.md) | Retention, archive and backup policy proposal |
| [Migration plan](migration-plan.md) | Controlled move from browser storage to backend |
| [Open decisions](open-decisions.md) | Decisions and evidence required before implementation |

## Prototype facts used as inputs

- Canonical reading shape is owned by `js/data.js`; REST and MQTT adapters currently normalize into that shape before `js/engine.js` receives a reading.
- Browser-local keys currently include `gasguard-v2-draft`, `gasguard-v2-service-workflow`, `gasguard-v2-demo-role`, `gasguard-v2-view-mode`, `gasguard-v2-setup-profile`, and `gasguard-v2-managed-sites`.
- Current service entities are Service Request, Maintenance Task, Verification, and Service Report; current engine entities include readings, incident lifecycle records, source configuration, and retained evidence.

These facts are not evidence of a deployed backend, authentication system, multi-site isolation, or device control plane.
