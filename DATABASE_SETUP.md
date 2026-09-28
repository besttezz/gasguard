# GasGuard Database Setup (Supabase / PostgreSQL)

All schema lives in `supabase/migrations/` and is applied in filename order. `supabase/seed.sql` adds the demo topology (Restaurant A / Kitchen Area, `ESP32-KITCHEN-01`, `SIM-ESP32-KITCHEN-01`) and is safe to run more than once.

## Tables

| Table | Purpose | Written by |
| --- | --- | --- |
| `customers`, `sites`, `zones`, `devices`, `sensors` | Physical topology | Admin / enrollment RPCs |
| `profiles`, `site_memberships` | Who can see which site | Auth trigger / admin |
| `installation_jobs`, `job_assignments` | Technician work | Admin |
| `telemetry_readings` | Every accepted sensor packet (time series) | `ingest_telemetry` RPC only |
| `device_status` | Latest snapshot per device (fast dashboard read, Realtime) | `ingest_telemetry` RPC only |
| `safety_events` | `gas_risk` / `system_fault` incidents with timeline (Realtime) | `ingest_telemetry`, `acknowledge_safety_event`, `review_safety_event` |
| `telemetry_hourly` (view) | Hourly rollup for reports; respects RLS | — |

Users only **read** through RLS: a user sees a site when they have an active `site_memberships` row, are `admin`, or are a `technician` with a live job at that site. Clients can never insert telemetry directly.

## Future-proofing

- `telemetry_readings.extra` (jsonb) and `schema_version` store new firmware fields without a migration; promote a field to a real column once it is stable.
- Duplicate packets (`device, sensor, bootId, sequence`) are ignored, so ESP32 retries are safe.
- `received_at` has a BRIN index, which stays small as history grows. When the free tier's storage fills, call `purge_telemetry_before(now() - interval '90 days')` from a scheduled job (service_role only; refuses cutoffs newer than 7 days). Reports keep working through `telemetry_hourly` for retained data.

## Create the hosted database

1. Create a free project at https://supabase.com/dashboard (choose region Singapore). Save the database password somewhere safe.
2. In this folder run, in order (each asks you to confirm in the browser or type the DB password):

```
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push --include-seed
```

   `<project-ref>` is the id in the dashboard URL: `supabase.com/dashboard/project/<project-ref>`. If the CLI asks for `config.toml`, run `npx supabase init` first and answer **N** to the prompts.

3. Frontend (browser, public): Project Settings > API > Project URL and **anon/publishable** key → `GASGUARD_SUPABASE_URL`, `GASGUARD_SUPABASE_ANON_KEY` (see `AUTH_SETUP.md`).
4. Device ingress server (never in the browser, never committed): put `GASGUARD_SUPABASE_URL` and `GASGUARD_SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, then `npm run dev:auth`. Every accepted packet is then stored; if the database is unreachable the live dashboard keeps working and the server logs `[telemetry-store] not persisted`.
5. Give a user access to Restaurant A (SQL Editor):

```sql
insert into public.site_memberships (site_id, user_id, membership_type)
values ('00000000-0000-4000-8000-000000000101', '<auth user uuid>', 'owner');
```

## Verify

`npm test` includes `tests/telemetry-storage.test.js`, which checks RLS, grants, duplicate protection, and that ingress never blocks on the database.
