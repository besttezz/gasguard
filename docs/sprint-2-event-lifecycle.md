# Sprint 2 — Event lifecycle and incident views

## Reading, alert, and event

- **Reading** is one normalized provider payload. It may arrive every two seconds and is retained only as analysis input.
- **Alert** is a user-facing notification derived from an open incident. When present, its display references the incident `eventId`.
- **Event / incident** is one continuous gas-risk or system-fault context. It groups many readings and is the record shown in History, Investigation, Evidence, and Reports.

The UI must never render every reading as a separate event-history item.

## Event schema

Each new incident contains: `eventId`, `siteId`, `zoneId`, `deviceIds`, `eventType`, `source`, `lifecycleStatus`, `severity`, `peakSeverity`, `startedAt`, `lastUpdatedAt`, `resolvedAt`, `firstReading`, `latestReading`, `peakLpgPpm`, `peakRiskScore`, `peakAnomalyScore`, `readingCount`, `updateCount`, `acknowledgement`, `technicianReview`, `resolutionSummary`, `prototypeRuleVersion`, and `evidence`.

Fields unavailable from the existing contract are explicitly `null`, empty, or shown as `ยังไม่มีข้อมูล`. New simulation events use source `simulation` and rule version `UNVALIDATED_PROTOTYPE/event-lifecycle-v0.1`.

## Deduplication and lifecycle

The incident deduplication key is `(siteId, zoneId, eventType, unresolved)`. `gas_risk` represents both attention and critical severity: severity escalation updates the same record and adds an `escalated` timeline transition. `system_fault` is separate from `gas_risk`.

- `safe` resolves matching open gas-risk incidents using the pre-existing Engine result.
- `attention` or `critical` creates or updates the matching gas-risk incident.
- `unknown` creates or updates a system-fault incident and records a missing-data period. It never resolves an open gas-risk incident and is never rendered as safe.
- A return to online monitoring resolves the matching system-fault record without altering any gas-risk record.

Supported detection states are `open`, `resolved`, and `system_fault`. `acknowledged` and `investigating` are represented as technician workflow states, deliberately separate from Engine detection.

## Technician workflow

`acknowledgement` records acknowledgement time and actor. `technicianReview` records `not_started`, `acknowledged`, `investigating`, or `resolved`, plus optional notes. Marking the technician workflow resolved does **not** overwrite the Engine's detection lifecycle or claim that the area is safe.

## LocalStorage migration

Older records without `eventId` are normalized on load as `legacy: true`. Since their original site, zone, readings, and source cannot be recovered, those fields remain null/empty and the evidence timeline states that the record is legacy. No old history is deleted solely because it has the older schema. The store retains at most 80 incident records and 360 readings.

## UI mapping

- **General:** one card per incident with plain-language status, site/zone, start/duration, peak severity, system response, recommended next step, technician acknowledgement, and simulation label.
- **Technician:** incident selection, first/latest/peak values, device and site context, transitions, valve/network state, acknowledgement, investigation, notes, and workflow resolution.
- **Developer:** incident IDs, lifecycle/source summaries, first/latest/peak values, rule label, and evidence JSON labelled `UNVALIDATED_PROTOTYPE`.
- **Maintenance:** a separate mock task queue for device, sensor, network, power, valve feedback, placement, and post-incident review. It does not use readings as maintenance work.

## Known limitations and backend path

This is browser-local prototype data, not an authenticated or shared incident system. No hardware LPG test, external notification, real valve control, retention policy, user identity, immutable audit log, or multi-site isolation is included. A production backend must enforce permissions; own event IDs and transaction-safe deduplication; attach durable reading/evidence references; store real users, devices, sites, and manufacturer maintenance guidance; and validate all prototype rules before operational use.
