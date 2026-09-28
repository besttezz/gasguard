# Core Platform Schema (Phase 6C-1)

## Overview

Phase 6C-1 defines the core database foundation for the GasGuard platform in Supabase.
This initial migration creates **EXACTLY 7 public tables** representing identity, tenancy/location, and hardware topology.

No telemetry, measurements, time-series rollups, service incidents, or provisioning write policies are included in this phase.

## Table Catalog

| Table | Primary Key | Parent Reference | Description |
|---|---|---|---|
| `profiles` | `id` (uuid references `auth.users(id)`) | `auth.users` | User profile settings (theme, display name). Auto-provisioned by auth trigger. |
| `customers` | `id` (uuid) | None | Customer organization or household account (`household`, `restaurant`, `other`). |
| `sites` | `id` (uuid) | `customers(id)` | Physical installation location / facility with lifecycle status. |
| `zones` | `id` (uuid) | `sites(id)` | Specific sub-area within a site (e.g., Kitchen, Storage). |
| `site_memberships` | `(site_id, user_id)` (composite) | `sites(id)`, `auth.users(id)` | Bridges platform users to sites with membership type (`owner`, `member`). |
| `devices` | `id` (uuid) | `sites(id)`, `zones(id)` | Hardware controller / gateway (e.g. ESP32 node) registered to a site. |
| `sensors` | `id` (uuid) | `devices(id)` | Gas sensing elements (MQ-3, MQ-6) attached to a device. |

## Data Relationships

```text
auth.users ───────────► profiles (1:1)
    │
    ▼
site_memberships (N:M) ◄──────────┐
    ▲                             │
    │                             │
customers ───► sites ─────────────┼───► zones (1:N)
                 │                │       ▲
                 │                │       │
                 └──► devices ────┘───────┘ (1:N)
                         │
                         └──► sensors (1:N)
```

## Authorization Model

Authorization in GasGuard combines **Platform Role** (`auth user app_metadata.role`) and **Site Membership** (`public.site_memberships`):

### 1. Platform Roles (`app_metadata.role`)
- **`admin`**: Global read access across all sites, customers, zones, devices, sensors, and site memberships.
- **`general`**: Can view customer, site, zone, device, and sensor information ONLY for sites where they hold an `active` site membership.
- **`technician`**: No automatic platform-wide business access in Phase 6C-1. Access will be scoped to explicit installation / service job assignments in later phases.
- **`developer`**: No automatic platform-wide business access in Phase 6C-1. Access will be scoped to technical diagnostics in later phases.

### 2. Site Memberships (`site_memberships`)
- Binds a user to a specific site with `membership_type` (`owner` or `member`) and `status` (`active` or `revoked`).
- Does **not** store platform roles (`general`, `technician`, `admin`, `developer`). Platform roles and site memberships are strictly separated.

## Row-Level Security (RLS) Rules

- **RLS is enabled on ALL 7 tables.**
- **No anonymous access**: All policies target `authenticated` users only.
- **Business writes are DENY BY DEFAULT**: In Phase 6C-1, there are **no browser INSERT, UPDATE, or DELETE policies** on `customers`, `sites`, `zones`, `site_memberships`, `devices`, or `sensors`.
- **Profiles**: Authenticated users can SELECT and UPDATE only their own profile (`id = auth.uid()`).
- **Site Memberships**: Users can inspect only their own membership records (`user_id = auth.uid()`), while `admin` users can inspect all memberships. Members cannot enumerate other members.

## Automated Lifecycle & Triggers

1. **`public.handle_updated_at()`**: Reusable trigger function with explicit `set search_path = public, pg_catalog` updating `updated_at = now()`. Attached to `profiles`, `customers`, `sites`, `zones`, `devices`, and `sensors`.
2. **`public.handle_new_auth_user()`**: Security definer trigger automatically creating an empty `profiles` record (`id`) when a new user signs up in `auth.users`.
