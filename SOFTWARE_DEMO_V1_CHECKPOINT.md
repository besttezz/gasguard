# GasGuard Software Demo V1 — Final Readiness Checkpoint

Checkpoint date: 2026-09-24  
Release status: **Software-ready; external configuration pending**

## What is completed

- Vanilla JavaScript SPA packages reproducibly to `dist/`; build and all automated tests pass.
- Auth client, session restore, logout, trusted `app_metadata.role`, navigation guards, and four-role matrix are implemented.
- Deterministic Demo Site scenarios and isolated Demo Reset are ready and labelled `SIMULATION / PROTOTYPE`.
- Telemetry V1.1, Measurement Layer, Safety Engine, local HTTP device ingress, registry, Virtual ESP32, LAN readiness, and workspace isolation are implemented and tested.
- Cloudflare Pages build configuration is documented; generated `dist/` is git-ignored.

## Current architecture

- Cloudflare Pages → static GasGuard frontend from `dist/`.
- Local trusted LAN → Node device ingress → ESP32 or Virtual ESP32 → Measurement → Telemetry V1.1 → Safety Engine.
- Future hosted hardware → separately secured Worker/API required; not implemented in V1.

## Roles

- `general` → landing `overview`
- `technician` → landing `overview`
- `developer` → landing `developer`
- `admin` → landing `admin-dashboard`

Role permissions remain defined and tested in `js/navigation.js`; unsupported or missing roles are denied.

## Workspaces

- `demo-site` → `SIMULATION`; deterministic prototype data only.
- `hardware-pilot` → `REAL_DEVICE`; expected `ESP32-KITCHEN-01`, `MQ3-01`, `MQ6-01`; no data means `WAITING_FOR_DEVICE / UNKNOWN / N/A`.
- `device-test` → `TEST_DEVICE`; Virtual ESP32 data only, explicitly labelled, isolated from Hardware Pilot.

## Demo capabilities

- Default NORMAL state plus NORMAL, ATTENTION, CRITICAL, RECOVERY, and OFFLINE scenarios.
- Developer scenario controls use the existing simulation/engine path.
- Confirmed reset restores deterministic demo readings/events/alerts/service state without logout or cross-workspace changes.

## ESP32 readiness

- Local LAN host/port configuration, per-device authentication, trusted registry, health/status endpoints, firmware handshake example, preflight, and virtual verification are ready.
- Physical ESP32 connection, real sensor readings, and MQ calibration have not been performed.

## Deployment readiness

- Pages settings: branch `autonomous-lpg-safety`, root `/`, build `npm run build`, output `dist`, no framework preset.
- Blank Supabase configuration shows `Auth ยังไม่พร้อมใช้งาน` rather than attempting login.
- Node ingress and device secrets are outside the Pages deployment boundary.

## Pending manual work

- Create/configure the Supabase project and its public browser values.
- Create the four project-owned demo users and set trusted App Metadata roles.
- Verify hosted login/session/logout and role landing pages.
- Provision a secured hosted Worker/API before accepting hardware telemetry over the internet.
- Connect a physical ESP32 and complete separate calibration/safety validation work.

## Known limitations

- Hosted login and hosted device ingress are unavailable until the pending external setup is completed.
- Demo/service state is browser-local; no production database is present.
- Hardware Pilot never falls back to simulation and remains unknown before authenticated real telemetry.
- Synthetic handshake values are not calibrated sensor readings.
- GasGuard V1 is a prototype, not a certified or production safety controller.

## Exact next steps

1. Review the current dirty working tree and intentionally select the Software Demo V1 release files.
2. Configure Supabase public URL/publishable key and four demo accounts without committing credentials.
3. Run `npm run build` and `npm test`, then verify all four accounts against the generated hosted frontend.
4. Create and security-review the separate hosted device ingress design before implementing any Worker/API.
5. Perform physical ESP32 handshake first; keep MQ calibration and gas testing as separately approved work.
