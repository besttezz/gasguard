# GasGuard Supabase Auth Setup

GasGuard uses Supabase Auth email/password login. Only public browser configuration belongs in this repository. Never place a `service_role` or secret key in browser code.

## 1. Configure the browser client

1. Open the Supabase project dashboard.
2. Copy the Project URL and the public publishable/legacy anon key from project API settings.
3. For local development only, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the uncommitted working copy of `js/auth-config.js`.
4. For Cloudflare Pages, set build variables `GASGUARD_SUPABASE_URL` and `GASGUARD_SUPABASE_ANON_KEY`; `npm run build` writes the public values into `dist/js/auth-config.js`.
5. Keep Email authentication enabled. Do not enable public Sign Up unless the product owner approves a registration flow.

The checked-in config remains blank. With blank configuration, GasGuard displays **Auth ยังไม่พร้อมใช้งาน** and disables login. Never put a password, device key, `service_role`, or `sb_secret_*` value in either frontend configuration path.

## 2. Create four demo users

Create users from Authentication > Users in the Supabase dashboard. Choose project-owned demo email addresses and temporary passwords; do not commit passwords to this repository.

- General Demo — role `general`
- Technician Demo — role `technician`
- Developer Demo — role `developer`
- Admin Demo — role `admin`

For each user, set the authorization claim in **App Metadata**, not User Metadata:

```json
{ "role": "general" }
```

Replace the value with `technician`, `developer`, or `admin` for the corresponding account. GasGuard denies access when the role is missing or unsupported. After changing App Metadata, sign out and sign in again so the refreshed session contains the new claim.

For Admin Demo, set App Metadata to:

```json
{ "role": "admin" }
```

## 3. Test the four accounts

Start the local app with `npm run dev`, open `http://localhost:5567`, and test each account separately:

1. **General Demo**: sign in and confirm access to Overview, Alerts, Events, Locations, Assistant, Guide, Reports, and Product. Confirm Developer, Technician, and Admin-only pages redirect to Overview.
2. Sign out, confirm the Login screen returns, then sign in as **Technician Demo**. Confirm access to Overview, Alerts, Events, Live, Devices, Maintenance, Replay, Reports, Setup, Validation, and Product. Confirm Settings and Admin Dashboard redirect to Overview.
3. Sign out, then sign in as **Developer Demo**. Confirm access to Overview, Live, Events, Intelligence, Validation, Demo, Spatial, Devices, Developer, Explorer, Settings, Hardware Lab, and Product. Confirm Reports and Admin Dashboard redirect to Developer Dashboard.
4. Refresh once while each account is signed in. The same role and allowed workspace must be restored from the Supabase session.
5. Sign out, then sign in as **Admin Demo**. Confirm Admin Dashboard is the landing page and Product, Overview, Alerts, Events, Locations, Devices, Maintenance, and Reports are available. Confirm Hardware Lab, Explorer, Demo, and Developer Dashboard are denied.
6. Create or temporarily edit a test account with no role or an unsupported role such as `owner`. Confirm GasGuard shows access denied and never opens the workspace.

Do not put any demo password in source code, documentation, screenshots, or commits.

## 4. Security boundary

The SPA guard controls UI visibility and internal navigation only. Protect any future Supabase tables, Storage buckets, Edge Functions, and backend APIs independently with RLS/policies based on authenticated identity and trusted `app_metadata` claims.

## Future Google sign-in

Google can later be enabled as a Supabase Auth provider and connected to the same role model. Google sign-in is intentionally not implemented in this iteration.
