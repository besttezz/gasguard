# Owner Invitation & Site Claim Model Foundation

## A. Purpose
The Owner Invitation model enables secure, one-time handoff of a commissioned GasGuard Site to the actual customer (Site Owner). It provides a cryptographically secure bridge between physical equipment installation/commissioning and digital site ownership claim.

## B. Architecture

```
Technician / Admin
        │
        ▼
[ Future Controlled Invitation Issuer ]
        │
        ▼
Raw One-Time Token (High-entropy, displayed/sent ONCE)
        │
        ▼
  SHA-256 Digest (64 lowercase hex characters)
        │
        ▼
private.owner_invitations (Internal server-side storage)
        │
        ▼
Owner Authenticates (Own Supabase Auth account)
        │
        ▼
[ Future Atomic Claim Workflow ]
        │
        ▼
public.site_memberships (membership_type = 'owner', status = 'active')
```

## C. Security Boundaries
- **Raw Token Never Stored**: The high-entropy one-time raw token exists only transiently at generation and delivery time. Only its 64-character lowercase hexadecimal SHA-256 digest is persisted (`private.owner_invitations.token_hash`).
- **Private Schema Isolation**: Stored in `private.owner_invitations`, an internal server schema inaccessible to browser/client roles (`PUBLIC`, `anon`, `authenticated`).
- **Zero Client RLS Policies**: No direct client policies exist for `private.owner_invitations`. Table privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) and schema access (`USAGE`, `CREATE`) are explicitly revoked from client roles.
- **Distinct Credential Types**:
  - Invitation token != customer password
  - Invitation token != Supabase access token / JWT
  - Invitation token != device credential
  - Invitation token != device enrollment token
  - Invitation token != Wi-Fi credential / API key
- **Authentication & Authorization**: User authentication remains handled exclusively via standard Supabase Auth. Device authentication and enrollment remain strictly separated. Site membership is established solely through controlled server-side claim workflows.

## D. Status Semantics
`private.owner_invitations.status` uses an explicit check constraint enforcing exactly four allowed states:
- `pending`: Active, unexpired invitation ready to be claimed.
- `claimed`: Successfully consumed by an authenticated user; requires `claimed_at` timestamp.
- `revoked`: Explicitly invalidated by an authorized issuer prior to claim or expiration.
- `expired`: Invalidated due to passing `expires_at` timestamp.

## E. Commissioning Dependency
Site claim validation strictly depends on `public.sites.lifecycle_status = 'commissioned'`. An invitation cannot be claimed for a site that is still in `draft`, `installed`, or `decommissioned` states.

## F. Explicitly NOT IMPLEMENTED in Phase 6E-1
This phase establishes **database storage and security foundation ONLY**. The following are explicitly out of scope and NOT implemented:
- Invitation issuing API / RPC (`issue_owner_invitation`)
- Claim API / RPC (`claim_owner_invitation`)
- Token generation logic
- Email delivery
- SMS delivery
- QR code generation/delivery
- Site commissioning state transitions
- Customer UI
- Technician UI
