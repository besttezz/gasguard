# Sprint 3 — Service Request & Technician Workflow

## Scope

Sprint 3 adds a local, mock-only service workflow to the Autonomous LPG Safety prototype. It helps a user request an inspection, lets a technician record simulated work, verifies a result, and produces a plain-language report. It does not control hardware, alter the LPG risk model, or claim a real service outcome.

## Data model

All records live in browser `localStorage` under `gasguard-v2-service-workflow` with version `service-workflow-v0.1`.

- `ServiceRequest`: request ID, site, incident, zone, device IDs, request type, title, description, priority, lifecycle timestamps, requester/contact preference, assigned technician, notes, related task IDs, report ID, history, and `mock` marker.
- `MaintenanceTask`: task ID, request/incident/site/zone/device references, action, timing, performer, result, notes, evidence placeholders, and `mock` marker.
- `Verification`: verification ID, request/incident references, test/expected/observed result, outcome, evidence placeholders, notes, performer, timestamp, and `mock` marker.
- `ServiceReport`: issue, incident/diagnostic summary, task relations, intentionally empty parts-replaced list, verification result, detection state at completion, workflow state, technician identity, timestamps, next action, evidence references, and `mock` marker.

## State machine

`submitted → acknowledged → scheduled/in_progress → awaiting_verification → completed`

Other allowed paths are `submitted/scheduled → cancelled`, `in_progress/awaiting_verification → unable_to_complete`, and `unable_to_complete → in_progress`. A request cannot become `completed` until a verification record has result `passed`.

The app records a timestamped history for every state transition. Creating another open request for the same Incident returns the existing request instead, preventing duplicate open work.

## Incident separation and retention

The technician workflow is separate from the detection lifecycle. Closing a service request never resolves a gas-risk or system-fault Incident. A generated service report visibly warns when the linked detection Incident is still open.

When preserving browser history, the engine keeps every open Incident, every Incident with incomplete technician review, and every Incident attached to an open service request or incomplete maintenance task. Only completed, unprotected historical records are eligible for the normal 80-record limit. If protected records alone exceed that limit, they are all retained and a storage warning is set instead of deleting them.

## UI entry points

- General user: **Ask GasGuard** has a mock service-request form; open Incident cards also offer a request shortcut.
- Technician: **รายงานการบริการ** contains the service queue, simulated task/verification actions, and generated service reports. **การบำรุงรักษา** lists related mock tasks.
- Developer: the existing Developer Console remains read-only and shows the selected Incident together with its related request, task, verification, report, and storage-warning evidence. These records are prototype evidence, not certified service records.

## Mock boundary

The workflow is local-only and is explicitly marked mock/demo. It sends no message, makes no network call, invokes no hardware, controls no valve, creates no real booking, and has no authentication or push notification. Real deployment requires a backend, identity and authorization, audit and privacy controls, notification delivery, retention policy, and validation against actual installation procedures.
