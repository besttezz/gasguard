# GasGuard Cloudflare Pages Deployment Guide

This document provides exact, step-by-step instructions for deploying the GasGuard static web frontend to **Cloudflare Pages**.

> [!IMPORTANT]
> This guide is intended for the project collaborator who manages the Cloudflare account. All Cloudflare Pages setup is performed manually via the Cloudflare Dashboard Git integration.

---

## 1. Overview & Architecture

- **Hosted Surface**: Static Web Frontend ONLY (`dist/`).
- **Backend Services**: Handled directly from the browser to Supabase APIs (Auth & REST).
- **Local Dev Infrastructure**: The local Node development server (`server/dev-server.js`) and local ESP32 device ingress routes (`/api/v1/*`) are local/lab facilities only and are **not** deployed to Cloudflare Pages.
- **Wrangler / Workers**: `Wrangler` is **not required** for static Pages hosting.

---

## 2. Cloudflare Pages Project Configuration

When creating the Cloudflare Pages project in the Cloudflare Dashboard, use the following exact settings:

| Setting | Value |
| :--- | :--- |
| **Framework preset** | `None` |
| **Build command** | `npm run build:cloudflare` |
| **Build output directory** | `dist` |
| **Root directory** | `/` |

---

## 3. Required Environment Variables

Configure the following environment variables in the Cloudflare Pages project settings (**Settings > Environment variables**):

| Variable Name | Value Description |
| :--- | :--- |
| `GASGUARD_SUPABASE_URL` | Production Supabase HTTPS Project URL (e.g., `https://<project-ref>.supabase.co`) |
| `GASGUARD_SUPABASE_ANON_KEY` | Production Supabase browser-safe publishable / anon key |

### Key Safety Rules
- **Allowed Keys**: Standard Supabase `anon` / `publishable` keys. Public keys embedded in client JavaScript are safe because security boundaries are enforced at the database level by Supabase Auth, Row Level Security (RLS), and Postgres role privileges.
- **FORBIDDEN KEYS**: **NEVER** enter `service_role` keys, `sb_secret_*` tokens, database passwords, JWT secrets, or ESP32 device keys into environment variables or repository code. The build command will fail immediately if a secret key is detected.

---

## 4. Caching & Routing

- **Header Control**: `dist/_headers` ensures `js/auth-config.js` is served with `Cache-Control: no-store` so environment updates take effect without stale client caching.
- **Navigation**: GasGuard uses anchor and DOM-state single-page interface navigation. No catch-all `_redirects` rule is needed.

---

## 5. Post-Deployment Hosted QA Checklist

> [!NOTE]
> Execute this QA checklist once the Cloudflare Pages deployment URL is generated.

### Public Landing & Assets
- [ ] HTTPS loads cleanly without SSL warnings.
- [ ] Public landing page renders correctly.
- [ ] Mascot image and static CSS/JS assets load without 404s.
- [ ] Simulation disclosure banner remains visible.
- [ ] Responsive layout verifies cleanly on mobile viewports (~390 × 844) and desktop viewports.

### Authentication & Sessions
- [ ] Login UI initializes cleanly (no "Auth ยังไม่พร้อมใช้งาน" state).
- [ ] General user authentication succeeds.
- [ ] Technician user authentication succeeds.
- [ ] Developer user authentication succeeds.
- [ ] Admin user authentication succeeds.
- [ ] Page refresh restores active session from Supabase Auth.
- [ ] Logout invalidates session and returns to public landing view.
- [ ] Account with invalid/missing role is denied workspace access.

### Role-Based Routing
- [ ] `general` role routes to General Customer Workspace.
- [ ] `technician` role routes to Technician Field Workspace.
- [ ] `developer` role routes to Developer Safety Engine Workspace.
- [ ] `admin` role routes to System Admin Dashboard.

### Security Audit
- [ ] Browser page source contains no `service_role` or `sb_secret_*` tokens.
- [ ] No device keys or API secrets exposed in Network tab or JavaScript bundle.
- [ ] `.env`, `.env.local`, `package.json`, or server scripts are **not** accessible via URL.

### Scope Disclosures
- [ ] `/api/v1/device/telemetry` is acknowledged as local/lab ingress (not claimed as live internet endpoint on static Pages).
- [ ] Live hardware ingestion remains separated from static Pages deployment.
