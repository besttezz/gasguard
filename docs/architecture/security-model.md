# Security model, authorization and threat model

Status: **PROPOSED**. Browser role mode is a UI demo only and is not authorization.

## Authorization model

Default deny. The server authenticates every request, derives the actor identity, validates membership/assignment, then applies a site predicate. It does not trust a role or `siteId` from localStorage or the request body alone. Sensitive configuration and future device-command actions require explicit approval or re-authentication policy before implementation.

| Resource / action | General user | Technician | Developer | Conditions |
| --- | --- | --- | --- | --- |
| Site, zone, plan read | scoped read | assigned-site read | environment + scoped read | membership/assignment required |
| Device/status read | summary only | assigned-site diagnostic read | approved technical scope | no credential material |
| Telemetry read | summary/latest only | diagnostic scope | approved technical scope | site predicate, minimised data |
| Incident read/acknowledge | summary/read | assigned-site read/acknowledge | approved technical read | acknowledgement audited |
| Service request | create/read own-site | read/manage assigned site | read-only unless explicitly assigned | transition checks server-side |
| Maintenance/verification | no | create on assigned request | read technical evidence | append-only action records |
| Service report | read finalized summary | create revision/finalize per workflow | read technical trace | finalization audited |
| Configuration | no | proposed operational input only | approved environment scope | versioned, audited approval |
| Audit | no | limited own-action view | approved operational scope | append-only access audited |
| Device command | no | no general web command | no default grant | future, separate approval boundary |

An operational admin role may exist only for constrained backend administration, membership, emergency access, and audit review. It is not a normal UI persona and requires separate governance.

## Site isolation

- All site-owned rows include `site_id` and foreign-key relationships must be checked for site consistency.
- API routes resolve the requested resource and authorize the resource's site before returning or modifying it.
- Technician assignment is evaluated in addition to role permission.
- Developer access is environment- and site-scoped, never blanket production access by default.
- Cross-site access attempts return `cross_site_access` without exposing resource existence.

## Threat model

| Threat | Asset | Attack path | Impact | Prevention | Detection | Residual risk |
| --- | --- | --- | --- | --- | --- | --- |
| Cross-site access | site data | guessed ID/client site claim | data exposure/change | server site predicate, FK consistency | authorization audit | implementation defects |
| Stolen device credential | ingress | copied credential | fake device messages | rotation, revocation, per-device ACL | anomaly/security logs | physical compromise |
| MQTT topic spoofing | telemetry | broad topic ACL | data leakage/injection | device-specific publish/subscribe ACL | broker audit | broker misconfiguration |
| Telemetry replay | incident state | resend valid payload | duplicate processing | message ID, sequence, timestamp window | duplicate metrics | clock/reset edge cases |
| Invalid/fake readings | safety evidence | malformed or forged payload | wrong evidence | schema/device validation, quarantine | rejected-message audit | authenticated faulty device |
| Configuration tampering | safety config | unauthorized update | unsafe configuration | versioning, approval, audit | config-change alerts | privileged misuse |
| Unauthorized device command | actuator | API misuse | physical risk | no default web permission; separate approval | command audit/feedback mismatch | future command plane |
| Notification suppression | alert delivery | disable or fail delivery | missed notice | outbox/retry/delivery state | failed-delivery monitoring | external provider outage |
| Audit modification | audit trail | DB/admin compromise | loss of traceability | append-only controls, restricted writers, backup | integrity review | privileged infrastructure attack |
| Browser localStorage manipulation | prototype state | local browser edit | misleading UI | backend source of truth migration | client marked untrusted | prototype remains editable |
| Developer over-permission | technical data | broad role | exposure | scoped memberships/environment gates | privileged-access audit | emergency access process |
| Secret leakage in logs | credentials | unsafe logging | credential compromise | allowlisted safe metadata/redaction | secret scanning/review | third-party logging errors |
