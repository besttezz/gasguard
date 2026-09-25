# GasGuard V2, Autonomous LPG Safety Draft 1

GasGuard V2 is an analytics-first LPG safety interface. It uses one canonical reading contract for simulation, REST API, MQTT, and later ESP32 adapters.

## Run locally

```powershell
npm run dev
```

Open `http://localhost:5567`.

Before using the workspace, configure Supabase Auth in `js/auth-config.js`. See `AUTH_SETUP.md` for the public client configuration and demo-user roles. The browser must use only a publishable/anon key; never use a `service_role` key.

For the one-click local launcher, double-click `start-gasguard.cmd`. It opens the main application only. `open-review-board.cmd` opens the optional image-review tool.

## Mobile UI review

Use a browser viewport around `390×844` to review the mobile application shell. The bottom navigation has four direct destinations and a role-specific More menu. The visible role is supplied by the authenticated user's trusted Supabase `app_metadata.role`; users cannot switch roles from the UI.

Run `node scripts/capture-mobile-app-evidence.mjs` to recreate the mobile/desktop evidence package in `docs/ui-review/mobile-app/`. See `docs/mobile-app-ux.md` for the page map and interaction rules.

## Test

```powershell
npm test
```

The test verifies the core safety semantics:

- normal historical readings become `safe`
- a sustained rise becomes `critical`
- offline telemetry becomes `unknown`, never `safe`
- completed/cancelled service requests are immutable and reports are gated by passed verification
- browser-local write failures, corrupt saved data, recovery traceability, and retention protection

## Draft 1 scope

- Data Contract and mock telemetry
- Feature calculation: baseline, rate of rise, exposure, variance, confidence, baseline drift
- Explainable rule-based risk and anomaly score
- Overview, Live Monitor, Safety Intelligence, Analytics, Events, Alerts, Devices, Maintenance, Locations, Reports, and Ask GasGuard
- Browser-local history, source settings, JSON export
- REST and MQTT adapter entry points

Cloud authentication, persistent cloud storage, PWA caching, and real edge actuation are intentionally deferred. They must not replace local fail-safe logic on the device.

See [Data Architecture](docs/data-architecture.md) for the contract and safety semantics.
See [Sprint 3.1 service workflow hardening](docs/sprint-3-service-workflow.md) for the local-only service state machine, persistence contract, and audit-view boundary.
