# GasGuard Team Handoff

## Current Status
- Static SPA frontend with four-role navigation (General, Technician, Developer, Admin) and public Product landing.
- Supabase Auth integration architecture ready (email/password login, trusted `app_metadata.role`, session restore, auth guards).
- Workspaces implemented with strict isolation:
  - `demo-site`: deterministic simulation scenarios (NORMAL, ATTENTION, CRITICAL, RECOVERY, OFFLINE) and isolated reset.
  - `hardware-pilot`: real hardware workspace, defaults to `WAITING_FOR_DEVICE / UNKNOWN / N/A` before receiving real telemetry.
  - `device-test`: bench testing with Virtual ESP32 telemetry.
- Measurement Layer and Telemetry V1.1 schema implemented with monotonic sequence tracking, `bootId`, duplicate/out-of-order rejection, and staleness detection.
- Local Node device ingress (`/api/v1/device/telemetry`), device registry, and authentication ready.
- Static build output configured to `dist/` (git-ignored); all automated tests passing.

## Branch
`autonomous-lpg-safety`

## Local Run
```powershell
# Standard local dev server (http://localhost:5567)
npm run dev

# LAN mode for local ESP32 testing (listens on 0.0.0.0:5567)
npm run dev:lan
```

## Tests
```powershell
# Run full automated test suite
npm test

# Build static bundle to dist/
npm run build

# Integration preflight check
npm run integration:check
```

## Supabase — PENDING
Teammates setting up Supabase need to:
1. Create a Supabase project and get Project URL and public anon/publishable key.
2. Configure frontend:
   - For local: set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `js/auth-config.js` (uncommitted).
   - For Cloudflare Pages: set environment variables `GASGUARD_SUPABASE_URL` and `GASGUARD_SUPABASE_ANON_KEY`.
3. Create 4 demo users in Supabase Auth (Email + Password):
   - General Demo
   - Technician Demo
   - Developer Demo
   - Admin Demo
4. Set authorization claim in **App Metadata** (`app_metadata.role`):
   - `{"role": "general"}`
   - `{"role": "technician"}`
   - `{"role": "developer"}`
   - `{"role": "admin"}`
5. Test login, session restore on reload, and logout for all 4 roles.
*Note: Never commit real passwords, service_role keys, or secrets.*

## Cloudflare — PENDING
Cloudflare Pages deployment settings:
- **Framework preset**: None
- **Build command**: `npm run build`
- **Build output directory**: `dist`
- **Production branch**: `autonomous-lpg-safety`
- **Environment variables**: `GASGUARD_SUPABASE_URL`, `GASGUARD_SUPABASE_ANON_KEY` (public only)

## ESP32
- **Local Ingress**: Ready via Node server (`POST /api/v1/device/telemetry`) and registry with header authentication (`x-device-key`).
- **Physical Board**: Pending connection, flashing (`firmware/esp32-handshake/`), and sensor calibration.
- **Hosted Ingress**: Pending separate Cloudflare Worker/API before taking hardware telemetry over the public internet.

## Do Not Change Yet
Do not alter these core modules unless new project requirements explicitly require it:
- Telemetry V1.1 schema
- Safety formula & Engine contracts
- Workspace isolation logic
- Measurement Layer conversion & validation rules
