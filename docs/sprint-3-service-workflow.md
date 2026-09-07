# Sprint 3.1 — Service Workflow Safety Hardening

## Scope and boundary

Sprint 3.1 hardens the existing prototype workflow only. It adds no backend, authentication, push notification, hardware control, real appointment, real technician identity, actuator command, or change to LPG formulas and thresholds. Every record remains a mock record in the current browser.

## Storage and transaction contract

Service data uses browser `localStorage` key `gasguard-v2-service-workflow`, schema `service-workflow-v0.2`.

Every mutating service API returns `{ ok, code, message, data }`. The state shown in the application changes only after serialisation and `localStorage.setItem` succeed. If storage is unavailable or full, the API returns `storage_unavailable` or `storage_write_failed`; it never reports a false success. Existing v0.1 or unversioned data is normalized by a defensive migration. Unreadable data starts a recoverable empty workflow and displays a warning.

## Request state machine and immutability

`submitted → acknowledged → scheduled/in_progress → awaiting_verification → completed`

Allowed alternatives are cancellation before work is completed, `in_progress/awaiting_verification → unable_to_complete`, and `unable_to_complete → in_progress`.

- A request becomes `completed` only after its latest Verification has result `passed`.
- `completed` and `cancelled` are terminal. Notes, tasks, verification, and all transitions are rejected without changing the record.
- A cancelled request cannot create a report.
- One Incident may have only one open request. The duplicate response returns the existing request without a write.

## Report gate and idempotency

A Service Report can be created only when the request is `completed` and the latest Verification is `passed`. The report records relations and observed mock results; it does not invent parts replaced, service outcome, or technician identity. Calling report again returns the same report (`report_exists`) rather than creating another record.

Service completion is separate from LPG incident detection. A report always preserves the linked Incident's detection status, and the UI warns when that Incident remains open.

## Roles and audit view

- **General:** Ask GasGuard shows requests created by the general role and their report summary only after a valid report exists.
- **Technician:** the service queue provides only actions allowed by the state machine; reports are available only after the report gate passes.
- **Developer:** Relation Explorer selects all data, an Incident, or a Request and displays linked Incident, Request, Task, Verification, and Report objects. Its labels include schema version, `LOCAL_BROWSER_DATA`, `MOCK`, and `NOT_A_PRODUCTION_AUDIT_LOG`.

## Engine storage integrity

The analytics engine treats malformed retained browser data as `unknown`: confidence is `0`, risk is `null`, and the interface must not imply that the space is safe. Once valid telemetry is received, the malformed raw payload is backed up under `gasguard-v2-draft-corrupt-backup`; a recovery transition and resolved recovery event are retained for traceability. This is recovery of a local prototype session, not a certified audit procedure.

## Retention

The engine retains open Incidents, incomplete technician reviews, and Incidents connected to an open Service Request or incomplete Maintenance Task. Fully resolved and unprotected history remains eligible for the normal browser-local limit. A warning is shown rather than deleting protected records when the protected set exceeds the limit.

## Verification coverage

`npm test` covers engine regression scenarios, terminal-state immutability, report gates and idempotency, relationship snapshots, migration idempotency, storage-write failure, corrupted local engine storage and recovery, and retention protection. It is deterministic mock coverage only; it is not hardware, calibration, field-installation, security, or production acceptance testing.
