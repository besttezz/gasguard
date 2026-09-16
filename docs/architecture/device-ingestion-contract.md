# Device identity and ingestion contract

Status: **PROPOSED contract only**. It does not modify the prototype data dictionary or deploy MQTT/REST ingress.

## Device lifecycle

1. An authorized operational workflow proposes a device registration against one site and zone.
2. Backend creates a device record and an individual credential reference; the secret is shown/transported through an approved secure enrollment process, never retained in application logs.
3. Device assignment is time-bounded and audited. Credential rotation and revocation invalidate future ingress.
4. Ingress resolves device identity first, then obtains authoritative site/zone assignment; payload `siteId` cannot redirect a device to another site.

## Proposed topic structure

`sites/{siteId}/devices/{deviceId}/telemetry`

- A device credential may publish only to its assigned device topic.
- Device credentials receive no broad telemetry subscription.
- Browser clients do not subscribe directly to system-wide telemetry; they call authorized backend APIs.
- Broker ACL must bind credential, device ID, site assignment, and permitted operation. Topic design alone is insufficient.

## REST ingress

`POST /api/v1/device-ingest/telemetry` is proposed for device-to-backend use, not browser use. Device authentication is distinct from human sessions. REST and MQTT feed the same validation and transaction pipeline.

## Payload contract

Current canonical payload facts include device/sensor/location/zone identifiers; `gas` values and raw fields; environment temperature/humidity; quality state; system/valve/network/power state; and timestamp. The backend preserves the existing data dictionary as the canonical reading basis.

The following envelope fields are **PROPOSED_BACKEND_FIELD** and do not change the current dictionary:

| Field | Purpose | Validation |
| --- | --- | --- |
| `messageId` | idempotency/deduplication key | unique per device within defined retention window |
| `schemaVersion` | payload decoder selection | allowlisted supported schema |
| `sequence` | ordering/replay evidence | monotonic per device session where supported |
| `deviceTimestamp` | device observation time | UTC parseable, bounded by policy |
| `receivedAt` | backend receipt time | assigned by server, never trusted from device |
| `firmwareVersion` | device-release evidence | matches registered/reported version format |

## Validation pipeline

1. Transport/broker ACL and device credential state.
2. Device is active and assigned to one authoritative site/zone.
3. Size, content-type, schema and canonical field validation.
4. Server receipt timestamp; device timestamp freshness/skew policy is **TBD**.
5. Duplicate detection by device/message ID; sequence and timestamp are supporting evidence, not the only protection.
6. Rate limit by credential/device and reject unsafe bursts without leaking other-site information.
7. Persist accepted telemetry or quarantine invalid payload metadata; do not persist secrets in the dead-letter record.

## Replay, stale and offline handling

- Duplicate message: return/record `duplicate_message` idempotently without duplicating an incident transition.
- Out-of-order telemetry: store with both device and received time, then apply an approved ordering policy; it must not silently overwrite newer state.
- Stale/offline detection: a worker evaluates absence based on a future approved site/device policy. It creates/updates a system-fault path, not a gas-risk resolution.
- Invalid payload: reject with safe error metadata and place a redacted envelope reference in quarantine for controlled review.

## Failure boundary

Invalid ingress, broker failure, or backend unavailability does not instruct the browser or remote backend to imply a safe area. Edge network-loss behavior remains an independent future edge-controller design.
