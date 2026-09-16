# Data retention and backup policy proposal

Status: **PROPOSED**. No retention duration is approved. Every duration is **TBD — requires legal, operational and research decision**.

| Data class | Reason / importance | Immutable | Archive and backup proposal | Retention |
| --- | --- | --- | --- | --- |
| Raw telemetry | traceability and reprocessing | yes after accepted ingest | partition/archive strategy; encrypted backup; restore verification | TBD — requires legal, operational and research decision |
| Derived features | explainability and model/rule evidence | yes per reading/version | archive with reading/version relation | TBD — requires legal, operational and research decision |
| Incidents | safety/event history | controlled projection + append transitions | backup with transitions/evidence | TBD — requires legal, operational and research decision |
| Incident evidence | investigation trace | immutable reference set | access-controlled archive and restore test | TBD — requires legal, operational and research decision |
| Audit logs | accountability/security | append-only | protected backup and integrity review | TBD — requires legal, operational and research decision |
| Notification deliveries | delivery proof and failure analysis | append-only attempts | archive with alert correlation | TBD — requires legal, operational and research decision |
| Service requests/actions/verifications | service workflow trace | requests controlled; actions/results append-only | archive with report relation | TBD — requires legal, operational and research decision |
| Finalized reports | operational record | revision immutable | revision-preserving backup | TBD — requires legal, operational and research decision |

## Controls to decide before production

- backup owner, location, encryption, access separation, cadence, and restoration procedure;
- recovery point and recovery time objectives;
- legal/privacy classification, deletion exceptions, and subject-access policy;
- partitioning and archive retrieval performance;
- periodic restore verification evidence.

No browser-localStorage retention rule becomes a production policy by itself.
