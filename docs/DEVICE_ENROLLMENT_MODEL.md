# Secure Device Enrollment Model Foundation

## 1. Purpose
The Secure Device Enrollment model provides server-side persistence for short-lived, one-time device enrollment tokens and persistent, revocable device authentication credentials. It establishes the secure database foundation required before physical ESP32 field nodes can claim authentication credentials and transmit authenticated telemetry to GasGuard ingress endpoints.

---

## 2. Architecture & Credential Handoff Flow

```
Technician (Assigned to Installation Job)
         │
         ▼
[ Future Controlled Token Issuance (HW-3B) ]
         │
         ▼
Raw One-Time Enrollment Token (64 hex characters, transmitted ONCE to device/app)
         │
         ▼ SHA-256 Digest (64 lowercase hex characters)
private.device_enrollment_tokens (status = 'pending', expires_at > created_at)
         │
         ▼ Physical ESP32 Claims Token (HW-3B / HW-3C)
[ Atomic Claim Workflow ]
         │
         ├─────────────────────────────────────────┐
         ▼                                         ▼
private.device_enrollment_tokens             Raw Device Credential (Generated ONCE)
  (status = 'claimed', claimed_at = now())          │
                                                   ▼ SHA-256 Digest
                                            private.device_credentials
                                              (status = 'active')
                                                   │
                                                   ▼ Stored safely in ESP32 NVS
                                            ESP32 Authenticated Ingress
                                              (x-device-key header)
```

> [!NOTE]
> HW-3A established database storage and schema isolate. HW-3B source defines controlled RPC workflows. Migration is **NOT applied remotely**. Firmware runtime and physical NVS persistence are reserved for future phases.

---

## 3. Credential Separation & Hashing Invariants

To eliminate cross-contamination and prevent credential reuse attacks, GasGuard enforces strict cryptographic credential boundaries:

$$\text{Wi-Fi Password} \neq \text{Provisioning PoP} \neq \text{Enrollment Token} \neq \text{Device Credential} \neq \text{Owner Invitation Token} \neq \text{Supabase JWT}$$

1. **Raw Token Format & Hash Storage**:
   - Raw enrollment tokens must consist of exactly 64 hexadecimal characters (`^[0-9a-fA-F]{64}$`), normalized to lowercase before hashing.
   - Enrollment Token: Raw 64 hex string $\to$ `SHA-256` $\to$ `private.device_enrollment_tokens.token_hash` (64 hex characters).
   - Device Credential: Raw 64 hex string $\to$ `SHA-256` $\to$ `private.device_credentials.credential_hash` (64 hex characters).
   - Raw tokens and raw keys are **NEVER** stored in database tables or recoverable from hashes.
2. **Public / Private Separation**:
   - Public metadata (e.g. `device_uid`, `device_type`, `lifecycle_status`, `site_id`, `zone_id`) resides in `public.devices`.
   - All secret authentication hashes reside strictly within `private.device_enrollment_tokens` and `private.device_credentials`.

---

## 4. Site Binding & Lock Ordering

1. **Strict Site Binding**:
   - A `device_enrollment_token` references both `device_id` (`public.devices.id`) and `installation_job_id` (`public.installation_jobs.id`).
   - Issuance and claim workflows MUST enforce the invariant: `device.site_id == installation_job.site_id`. A token issued for Site A can **NEVER** enroll a device into Site B.
2. **Consistent Global Lock Order**:
   - To eliminate deadlock risks during concurrent issuance and claim operations, all enrollment transactions acquire row locks in strict order:
     $$\text{DEVICE} \longrightarrow \text{INSTALLATION JOB} \longrightarrow \text{ENROLLMENT TOKEN} \longrightarrow \text{DEVICE CREDENTIAL INSERT}$$
   - During claim processing, an initial non-locking lookup resolves `device_id` and `installation_job_id`, after which explicit `FOR UPDATE` locks are taken on Device, Installation Job, and Enrollment Token rows in exact global sequence. All eligibility criteria are revalidated after authoritative row locks are held.
3. **Active Credential Uniqueness**:
   - Each physical device may have at most ONE active credential at a time (`UNIQUE(device_id) WHERE status = 'active'`).
   - Revoked credentials remain in `private.device_credentials` (`status = 'revoked'`, `revoked_at != null`) for audit history.

---

## 5. Expiration & Status Semantics

### Expired Token Handling
- Expiry is enforced strictly by checking `expires_at <= now()` at claim time.
- Attempting to claim an expired token raises an `ENROLLMENT_EXPIRED` exception. Because PostgreSQL exception handling aborts and rolls back the transaction, the function does **NOT** attempt an unpersisted status update (`status = 'expired'`) prior to raising the exception.
- Materialized `pending` $\to$ `expired` status cleanup is a future background maintenance concern and does not weaken atomic claim semantics.

### `private.device_enrollment_tokens.status`
- `pending`: Active token awaiting physical device claim.
- `claimed`: Successfully consumed during device bootstrap (`claimed_at` timestamp required).
- `revoked`: Explicitly invalidated prior to use.
- `expired`: Invalidated due to passing `expires_at` timestamp.

### `private.device_credentials.status`
- `active`: Current valid device authentication credential.
- `revoked`: Explicitly invalidated credential (`revoked_at` timestamp required).

---

## 6. Development Status & Maturity

- **STORAGE SCHEMA (HW-3A)**: `APPLIED TO REMOTE DATABASE`
- **WORKFLOW MIGRATION (HW-3B)**: `HW-3B SOURCE HARDENED (REMOTE NOT APPLIED)`
- **FIRMWARE NVS CREDENTIAL (HW-3C)**: `NOT IMPLEMENTED`
- **PHYSICAL HARDWARE**: `NOT PHYSICALLY TESTED`

### Verification Classification
- **STATIC CONTRACT**: Migration SQL structure, grant/revoke permissions, SQL regex validation, lock ordering, error normalization, and recursive secret redaction unit tests (`tests/device-enrollment-workflow.test.js`).
- **ROLLBACK DB VERIFIED**: Rollback-only linked-database transaction verification testing issuance and claim RPC behaviors on Supabase `zwktlkgrvggapdaurohd` inside explicit `BEGIN...ROLLBACK` blocks (zero persistent schema or data mutation).
- **NOT TESTED**: Firmware NVS credential storage and physical ESP32 Wi-Fi field execution.

---

## 7. HW-3B Controlled Workflow Specification

### 7.1 Token Issuance (`public.issue_device_enrollment_token`)
- **Caller Authorization**: Authenticated `technician` assigned to the installation job (`assigned` / `accepted` status) or global `admin`. `general` and `developer` roles are rejected (`UNAUTHORIZED`).
- **Eligibility**:
  - `device.lifecycle_status` MUST be `registered`.
  - `installation_job.job_type` MUST be `installation`.
  - `installation_job.status` MUST be `scheduled` or `in_progress`.
  - `device.site_id` MUST equal `installation_job.site_id` (Strict Site Binding).
- **Concurrency & Serialization**: Row locks acquired in `DEVICE` $\to$ `JOB` order. Automatically revokes any existing `pending` tokens for the device before inserting a new 1..60 minute token.
- **One-Time Raw Return**: Returns raw 64 hex character token ONCE. Raw token is never stored in DB; only `SHA-256` hash is persisted.

### 7.2 Atomic Claim (`public.claim_device_enrollment`)
- **Execution Boundary**: Server-only RPC executable ONLY by `service_role`. Execution revoked from `PUBLIC`, `anon`, and `authenticated`.
- **Atomic Transaction Steps**:
  1. Validates token format (`^[0-9a-fA-F]{64}$`) and computes `SHA-256` hash.
  2. Non-locking lookup discovers `device_id` and `installation_job_id`.
  3. Row locks `public.devices` (`FOR UPDATE`).
  4. Row locks `public.installation_jobs` (`FOR UPDATE`).
  5. Row locks `private.device_enrollment_tokens` (`FOR UPDATE`).
  6. Revalidates token status, `expires_at > now()`, bindings, optional `expected_device_uid`, device lifecycle (`registered`), job status (`scheduled`/`in_progress`), and strict site binding.
  7. Verifies no active credential exists for the device.
  8. Generates cryptographically secure 256-bit raw device credential (64 hex characters) and computes `SHA-256`.
  9. Inserts `private.device_credentials` (`status = 'active'`).
  10. Updates `private.device_enrollment_tokens` (`status = 'claimed'`, `claimed_at = now()`).
  11. Transitions `public.devices` (`lifecycle_status = 'commissioning'`).
  12. Returns raw device credential ONCE.
