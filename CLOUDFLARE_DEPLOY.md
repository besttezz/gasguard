# Cloudflare Pages deployment (readiness only)

This repository contains two separate runtimes:

- `index.html`, `css/`, `js/`, `assets/`: static browser application, packaged into `dist/` for Cloudflare Pages.
- `server/`, device keys, and `/api/v1/device/*`: local Node device ingress. These are not copied to `dist/` and must not be deployed as Pages static assets.

## Cloudflare Pages settings

| Setting | Value |
| --- | --- |
| Production branch | `autonomous-lpg-safety` (current prepared branch) |
| Root directory | `/` (repository root) |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Expected URL | `https://<pages-project-name>.pages.dev/` |

The build copies only the static allowlist. No framework or frontend compilation is added. Because no top-level `404.html` is emitted, Cloudflare Pages applies its SPA fallback to `index.html`. GasGuard currently navigates with client state/query parameters, so assets remain root-relative and refresh-safe.

## Environment modes

Development uses `npm run dev` and the checked-in blank `js/auth-config.js`. Hosted Demo uses the same frontend output and optional public build variables:

- `GASGUARD_SUPABASE_URL`: Supabase project URL.
- `GASGUARD_SUPABASE_ANON_KEY`: public anon/publishable key only.

If either value is missing, the hosted page shows **Auth ยังไม่พร้อมใช้งาน** instead of attempting login. Never set `service_role`, `sb_secret_*`, `GASGUARD_REAL_DEVICE_KEY`, or `GASGUARD_TEST_DEVICE_KEY` in Pages frontend variables. The build rejects known Supabase secret key formats.

## Expected hosted behavior

After public Supabase Auth is configured and a permitted user signs in, `demo-site` runs simulation, scenario switching, and Demo Reset entirely in the browser. Demo data remains labelled `SIMULATION / PROTOTYPE`.

Without a hosted ingress, `/api/v1/health` and `/api/v1/device/status` are unavailable. Hardware Pilot must remain `WAITING_FOR_DEVICE`, `NO DATA`, `UNKNOWN`, with ingress `UNAVAILABLE`; it must not fall back to simulation.

## Device ingress boundary

Local ESP32 testing continues through `npm run dev:lan` and the Node route `POST /api/v1/device/telemetry`. A future internet-facing device endpoint requires a separately secured Cloudflare Worker/API implementation. Do not upload `server/` or device secrets to Pages, and do not point an ESP32 at the static Pages URL expecting ingress.

## Pre-deploy verification

Run `npm run build`, then `npm test`. Inspect `dist/`: it must contain only `index.html`, `assets/`, `css/`, and `js/`. Confirm the Pages environment has no device secret and that the intended Supabase redirect/site URLs include the future `pages.dev` or custom domain before deploying.
