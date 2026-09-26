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
Raw One-Time Enrollment Token (High-entropy random string, transmitted ONCE to device/app)
         │
         ▼ SHA-256 Digest (64 lowercase hex characters)
private.device_enrollment_tokens (status = 'pending', expires_at > created_at)
         │
         ▼ Physical ESP32 Claims Token (HW-3B / HW-3C)
[ Future Atomic Claim Workflow ]
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
> HW-3A establishes the **database storage, security isolation, and contract schema ONLY**. It does NOT issue tokens, process claims, or modify ESP32 NVS / firmware runtime.

---

## 3. Credential Separation & Hashing Invariants

To eliminate cross-contamination and prevent credential reuse attacks, GasGuard enforces strict cryptographic credential boundaries:

$$\text{Wi-Fi Password} \neq \text{Provisioning PoP} \neq \text{Enrollment Token} \neq \text{Device Credential} \neq \text{Owner Invitation Token} \neq \text{Supabase JWT}$$

1. **Hash-Only Storage**:
   - Enrollment Token: Raw random string $\to$ `SHA-256` $\to$ `private.device_enrollment_tokens.token_hash` (64 hex characters).
   - Device Credential: Raw random string $\to$ `SHA-256` $\to$ `private.device_credentials.credential_hash` (64 hex characters).
   - Raw tokens and raw keys are **NEVER** stored in database tables or recoverable from hashes.
2. **Public / Private Separation**:
   - Public metadata (e.g. `device_uid`, `device_type`, `lifecycle_status`, `site_id`, `zone_id`) resides in `public.devices`.
   - All secret authentication hashes reside strictly within `private.device_enrollment_tokens` and `private.device_credentials`.

---

## 4. Site Binding & Authorization Boundaries

1. **Strict Site Binding**:
   - A `device_enrollment_token` references both `device_id` (`public.devices.id`) and `installation_job_id` (`public.installation_jobs.id`).
   - Issuance and claim workflows MUST enforce the invariant: `device.site_id == installation_job.site_id`. A token issued for Site A can **NEVER** enroll a device into Site B.
2. **Technician & Job Authorization**:
   - Future token issuance requires an authenticated technician user (`role = 'technician'`) explicitly assigned to the relevant `installation_job` via `public.job_assignments` (or an `admin` user).
   - Assignment status must not be `cancelled`.
3. **Active Credential Uniqueness**:
   - Each physical device may have at most ONE active credential at a time (`UNIQUE(device_id) WHERE status = 'active'`).
   - Revoked credentials remain in `private.device_credentials` (`status = 'revoked'`, `revoked_at != null`) for audit history and key rotation tracking.

---

## 5. Schema Security & Privilege Isolation

1. **Private Schema Isolation**: Both `private.device_enrollment_tokens` and `private.device_credentials` are created in the `private` schema.
2. **Schema Privilege Revocation**: `USAGE` and `CREATE` on schema `private` are explicitly revoked from `PUBLIC`, `anon`, and `authenticated`.
3. **Table Privilege Revocation**: `ALL` privileges on both tables are explicitly revoked from `PUBLIC`, `anon`, and `authenticated`.
4. **Row Level Security (RLS)**: RLS is enabled on both tables with **ZERO** client policies created. Browser and client sessions cannot read, insert, update, or delete credential or token records directly.

---

## 6. Status Semantics

### `private.device_enrollment_tokens.status`
- `pending`: Active token awaiting physical device claim.
- `claimed`: Successfully consumed during device bootstrap (`claimed_at` timestamp required).
- `revoked`: Explicitly invalidated prior to use.
- `expired`: Invalidated due to passing `expires_at` timestamp.

### `private.device_credentials.status`
- `active`: Current valid device authentication credential.
- `revoked`: Explicitly invalidated credential (`revoked_at` timestamp required).

---

## 7. Development Status & Maturity

- **STORAGE SCHEMA**: `IMPLEMENTED IN SOURCE (MIGRATION CREATED)`
- **REMOTE DATABASE**: `NOT APPLIED TO REMOTE DATABASE (READ-ONLY SAFETY)`
- **TOKEN ISSUANCE**: `NOT IMPLEMENTED (HW-3B BOUNDARY)`
- **ATOMIC CLAIM RPC**: `NOT IMPLEMENTED (HW-3B BOUNDARY)`
- **FIRMWARE NVS CREDENTIAL**: `NOT IMPLEMENTED (HW-3C BOUNDARY)`
- **PHYSICAL HARDWARE**: `NOT PHYSICALLY TESTED`
