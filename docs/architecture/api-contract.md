# Proposed API contract

Status: **PROPOSED**. All endpoints use server-derived identity, permission, and site scope. Request and response shapes are conceptual; no endpoint exists today.

## Common rules

- Responses use `{ data, correlationId }` on success where appropriate.
- Writes accept an idempotency key where retry can duplicate business effects.
- Site scope is derived on the server. A client may request a resource, but cannot select an unauthorized site.
- All writes require validation and audit as shown below.

| Area | Method / path | Permission / site scope | Shape and validation | Idempotency / audit |
| --- | --- | --- | --- | --- |
| Auth | `GET /api/v1/session` | authenticated / n.a. | profile and scoped memberships | no / access policy TBD |
| Auth | `POST /api/v1/logout` | authenticated / own session | session termination | idempotent / audit policy TBD |
| Auth | `POST /api/v1/token/refresh` | refresh-session boundary | provider-specific, no raw token logging | controlled / security log |
| Site | `GET /api/v1/site/current` | site.read / resolved current site | summary only | no / no write audit |
| Site | `GET /api/v1/site/zones` | zone.read / assigned site | paginated zone summaries | no / no write audit |
| Site | `GET /api/v1/site/plan` | site_plan.read / assigned site | published plan revision | no / access audit policy TBD |
| Device | `GET /api/v1/devices` | device.read / scoped site | filtered list, no secrets | no / no write audit |
| Device | `GET /api/v1/devices/{id}` | device.read / resource site | detail/status | no / no write audit |
| Device | `GET /api/v1/devices/{id}/diagnostics` | device.diagnostics.read / technician assignment | technical evidence | no / privileged access audit |
| Device | `POST /api/v1/devices/registration-proposals` | device.register.propose / approved site | proposed identity/zone; not credential issuance | idempotency key / audit |
| Telemetry | `POST /api/v1/device-ingest/telemetry` | device ingress credential / assigned device site | canonical payload + proposed envelope validation | message ID / security and ingestion audit |
| Telemetry | `GET /api/v1/telemetry/latest` | telemetry.read / scoped site | summary/full detail by permission | no / access policy TBD |
| Telemetry | `GET /api/v1/telemetry/history` | telemetry.read / scoped site | bounded time range, pagination | no / access policy TBD |
| Telemetry | `GET /api/v1/readings/{id}/features` | features.read / reading site | derived feature/version evidence | no / no write audit |
| Incident | `GET /api/v1/incidents` | incident.read / scoped site | filtered summaries | no / no write audit |
| Incident | `GET /api/v1/incidents/{id}` | incident.read / resource site | detail and allowed evidence | no / access audit policy TBD |
| Incident | `GET /api/v1/incidents/{id}/transitions` | incident.read / resource site | append-only transition history | no / no write audit |
| Incident | `POST /api/v1/incidents/{id}/acknowledgements` | incident.acknowledge / assigned site | reason, optimistic concurrency if needed | idempotency key / audit |
| Service | `GET/POST /api/v1/service-requests` | request.read/create / scoped site | request form, transition preconditions | write key / audit |
| Service | `POST /api/v1/service-requests/{id}/transitions` | request.transition / technician assignment | allowed state transition/reason | idempotency key / audit |
| Service | `POST /api/v1/service-requests/{id}/maintenance-actions` | maintenance.create / technician assignment | append-only observed action | write key / audit |
| Service | `POST /api/v1/service-requests/{id}/verifications` | verification.create / technician assignment | append-only result/evidence references | write key / audit |
| Service | `GET /api/v1/service-reports/{id}` | report.read / resource site | finalized report/revision summary | no / access policy TBD |
| Service | `POST /api/v1/service-requests/{id}/report-finalizations` | report.finalize / authorized workflow | requires completed + passed verification | write key / audit |
| Config | `GET /api/v1/configuration/active` | configuration.read / scoped site | version metadata/content by permission | no / no write audit |
| Config | `POST /api/v1/configuration-proposals` | configuration.propose / approved scope | versioned proposal; no threshold specified | write key / audit |
| Notification | `GET/PUT /api/v1/notification-preferences` | notification.preference / own scoped membership | channel/category settings | write key / audit |
| Notification | `GET /api/v1/notifications/deliveries` | notification.read / scoped site | delivery status, minimised metadata | no / no write audit |
| Notification | `POST /api/v1/alerts/{id}/acknowledgements` | alert.acknowledge / scoped site | acknowledgement reason | write key / audit |

No general-user valve/device-command endpoint is proposed. Any future command surface is a separately approved safety boundary.

## Error model

```json
{
  "code": "invalid_payload",
  "message": "Payload is not accepted by the device ingestion contract.",
  "correlationId": "server-generated-reference",
  "fieldErrors": [{"field": "gas.value", "code": "required"}],
  "retryable": false
}
```

Expected codes include `unauthenticated`, `forbidden`, `cross_site_access`, `invalid_payload`, `device_revoked`, `stale_telemetry`, `duplicate_message`, `invalid_transition`, `verification_required`, `report_already_finalized`, `persistence_failure`, and `service_unavailable`. Clients receive no stack trace, token, device secret, or internal exception detail.
