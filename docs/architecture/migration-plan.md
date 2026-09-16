# Prototype-to-backend migration plan

Status: **PROPOSED phased plan; no backend migration occurs in Sprint 4A**.

| Phase | Objective | Guard / rollback |
| --- | --- | --- |
| 1 | Freeze and export current browser schemas | tag/document keys and export format; retain rollback copy |
| 2 | Map localStorage entities to backend entities | preserve IDs/history where import is approved; record unmappable fields |
| 3 | Create and review backend schema | migration review and empty-environment rollback |
| 4 | Add read-only backend API | feature flag; browser remains source of display during rollback |
| 5 | Import deterministic Simulation data | checksum/count/relation validation; delete/reload non-production import only under approval |
| 6 | Switch dashboard reads to backend | read feature flag and comparison telemetry; fallback to prior read path |
| 7 | Move service workflow writes | server transition/report gates; prevent accidental dual writes |
| 8 | Move incident processing | transaction/idempotency/load tests before cutover |
| 9 | Add authentication/authorization | membership fixtures and cross-site tests before exposing data |
| 10 | Add device ingestion | broker ACL, credential rotation and quarantine tests |
| 11 | Add notification worker | outbox retry/delivery confirmation tests |
| 12 | Keep edge fail-safe independent | backend outage must not disable approved edge behavior |
| 13 | Deprecate localStorage as source of truth | export path, clear communication, feature-flag rollback window |

## Migration controls

- Use feature flags for each read/write/processing cutover.
- Avoid ungoverned dual writes: they can diverge, duplicate service transitions, or create different incident histories.
- Define import schema compatibility, validation report, dry run, repeatability, and rollback before moving any user data.
- Test cross-site isolation, idempotent imports, reading counts, report relations, incident transition order, outbox handling, and access control.
- Production readiness requires architecture approval, chosen technology, security review, backup/restore evidence, operational ownership, and validated hardware integration boundaries.
