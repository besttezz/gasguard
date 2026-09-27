# GasGuard Remote Hardware Pilot Gateway

## Overview

HW-4A implements the Remote Hardware Pilot Gateway Foundation for GasGuard ESP32 field devices operating over the public Internet. This enables remote ESP32 hardware bench nodes to communicate securely with a GasGuard Node server running on a private loopback origin via a Cloudflare Named Tunnel reverse proxy.

---

## Architecture Flow

```
ESP32 Field Device
  └── Internet HTTPS (TLS 1.2 / TLS 1.3)
        │
  Public Cloudflare Hostname (e.g. https://device-api.example.com)
        │ (Public TLS Termination at Cloudflare Edge)
        │
  Cloudflare Tunnel (cloudflared encrypted outbound connection)
        │
  GasGuard Server Origin (http://127.0.0.1:5567 loopback only)
        │ (Validated by request-security module)
        │
  Device Auth & Ingress Pipeline
        │
  Measurement Layer & Database
```

---

## Trust Boundary & Trusted Tunnel Mode

When deploying GasGuard for Remote Hardware Pilot operation (`GASGUARD_TRUSTED_TUNNEL_MODE=true`):

1. **Loopback Server Origin**: GasGuard server MUST be bound to loopback interface (`127.0.0.1` / `localhost`). Binding to `0.0.0.0` or a public IP while Trusted Tunnel Mode is enabled is strictly forbidden (`CONFIG_ERROR`).
2. **Explicit Expected Public Host**: Configured via `GASGUARD_PUBLIC_DEVICE_HOST=device-api.example.com`. Host header comparison is exact and case-insensitive (preventing hostname suffix injection attacks).
3. **Forwarded Protocol Inspection**: Requests must present `X-Forwarded-Proto: https`. Mixed or HTTP forwarded headers are rejected.
4. **HTTPS Enrollment**: Device enrollment (`POST /api/v1/device/enroll`) requires a verified trusted tunnel HTTPS transport or localhost. Insecure HTTP enrollment is strictly forbidden for remote deployments.
5. **No Router Port-Forwarding**: Incoming router port-forwarding is NOT required or recommended. Cloudflare Tunnel handles reverse proxying over outbound-initiated encrypted tunnels.

---

## Firmware Transport & TLS Trust

- **Telemetry Endpoint**: `GASGUARD_INGRESS_URL` set to public HTTPS URL (e.g. `https://device-api.example.com/api/v1/device/telemetry`).
- **Telemetry Transport**: Uses `WiFiClientSecure` + `HTTPClient`.
- **Telemetry Authentication**: Authenticated via HTTP header `x-device-key: <Device Credential>` (**NOT HMAC**).
- **TLS Trust Anchor**: Configured via `GASGUARD_INGRESS_CA_CERT`. If HTTPS URL is configured without a trust anchor, transport fails closed with `TRANSPORT_ERR_TLS_TRUST_NOT_CONFIGURED` (-4).
- **NO `setInsecure()`**: Certificate verification is NEVER bypassed in firmware source.

---

## Cloudflare Pages vs Cloudflare Tunnel Distinction

- **Cloudflare Pages**: Hosts the static web frontend bundle (`dist/`).
- **Cloudflare Tunnel**: Reverse-proxies dynamic API endpoints (`/api/v1/...`) from public HTTPS host to the loopback Node server origin (`127.0.0.1:5567`).

---

## Friend-Side Responsibilities

For remote field bench testing, a remote tester ("Friend") only needs:
1. Physical ESP32 hardware unit + USB power/serial cable.
2. Local 2.4GHz Wi-Fi access.
3. Mobile device or laptop with Espressif Provisioning tool to send initial Wi-Fi STA configuration + `deviceUid`/`enrollmentToken` to `gasguard-enroll` SoftAP endpoint.
4. Serial console monitor for field diagnostics.

The remote tester does **NOT** require Supabase credentials, database secrets, or server environment keys.

---

## Cloudflare Tunnel Configuration Template (HW-4B Concept)

Future Cloudflare Named Tunnel configuration template (`config.yml`):

```yaml
ingress:
  - hostname: <public-device-host>
    service: http://127.0.0.1:5567
    originRequest:
      httpHostHeader: <public-device-host>
  - service: http_status:404
```

> [!IMPORTANT]
> No real domain, no tunnel UUID, and no credentials file are configured in this checkpoint.

---

## Cloudflare Quick Tunnel Smoke Test Result (HW-4B-QT)

- **Date**: 2026-09-27
- **Classification**: Development / Testing Only (Temporary TryCloudflare Quick Tunnel)
- **Status**: PASSED (`tools/remote-hardware-smoke.js` verified HTTP 200 health & 401 unauth telemetry rejection over HTTPS tunnel)
- **Trusted Tunnel Mode**: `false` (Server mode `LOCAL_ONLY`, remote enrollment strictly closed)
- **Persistence**: Temporary process lifetime only. No domain, DNS records, Named Tunnel UUID, or credentials stored.

---

## Checkpoint Status

> [!NOTE]
> This HW-4B-QT checkpoint is **DEVELOPMENT / TESTING SMOKE ONLY**. Live Cloudflare Named Tunnel creation, DNS record mutation, and production domain deployment will be executed in **HW-4B**.
