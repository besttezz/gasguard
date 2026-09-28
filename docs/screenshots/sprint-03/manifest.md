# GasGuard Screenshot Archive — Sprint 03

## Metadata

- **Sprint**: 03 — Interactive Product Demo
- **Feature**: Product Proof Stage & Deterministic Simulation Controls (NORMAL / ATTENTION / CRITICAL)
- **Branch**: `feature/public-product-landing`
- **Base Commit**: `06b7cf6` (Sprint 02 product truthfulness checkpoint)
- **Implementation Commit**: `0266b0a`
- **Generated At**: 2026-09-25

---

## Archive Manifest

| Screenshot Filename | Viewport | Scenario | Purpose | Prototype Disclosure Status | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `desktop-1440px-normal.png` | 1440 × 900 (Desktop) | NORMAL | Verify dominant product window stage in NORMAL state (84 ppm, baseline 84 ppm, rate +0.2 ppm/min, score 92/100, System Mode: MONITORING, Simulated Connection: AVAILABLE). | Clearly visible (`SIMULATION / PROTOTYPE / ข้อมูลจำลอง`, `Prototype Simulation`, bottom disclosure notice). | Calm blue tone, baseline-aligned trend line, rule-based prototype explanation, no valve claims. |
| `desktop-1440px-attention.png` | 1440 × 900 (Desktop) | ATTENTION | Verify deterministic transition to ATTENTION state (185 ppm, rate +4.5 ppm/min, score 58/100, System Mode: ATTENTION, Simulated Connection: AVAILABLE). | Clearly visible (`SIMULATION / PROTOTYPE / ข้อมูลจำลอง`, `Prototype Simulation`, bottom disclosure notice). | Amber status beacon, rising curve trend visual, rate-of-rise observation explanation without leak diagnosis or valve control claims. |
| `desktop-1440px-critical.png` | 1440 × 900 (Desktop) | CRITICAL | Verify deterministic transition to CRITICAL state (420 ppm, rate +12.8 ppm/min, score 6/100, System Mode: HIGH RISK, Simulated Connection: AVAILABLE). | Clearly visible (`SIMULATION / PROTOTYPE / ข้อมูลจำลอง`, `Prototype Simulation`, bottom disclosure notice). | Coral/red beacon, steep rising curve, prototype response message without certified threshold or automated valve control claims. |
| `tablet-768px-demo.png` | 768 × 1024 (Tablet) | NORMAL | Verify tablet responsive layout, segmented control touch ergonomics, and 3-column metric card scaling. | Clearly visible (`SIMULATION / PROTOTYPE / ข้อมูลจำลอง`, `Prototype Simulation`, bottom disclosure notice). | Clean typography, no overflow, smooth SVG trend rendering. |
| `mobile-390px-demo.png` | 390 × 844 (Mobile) | NORMAL | Verify mobile vertical hierarchy (Header → Segmented Tabs → Status Hero → Metrics Strip → Trend → Explanation → Disclosure). | Clearly visible (`SIMULATION / PROTOTYPE / ข้อมูลจำลอง`, `Prototype Simulation`, bottom disclosure notice). | Touch-friendly tab buttons (>= 48px), stacked single-column metrics, 0px horizontal overflow. |
| `mobile-390px-critical.png` | 390 × 844 (Mobile) | CRITICAL | Verify mobile state transition in high-risk simulated state. | Clearly visible (`SIMULATION / PROTOTYPE / ข้อมูลจำลอง`, `Prototype Simulation`, bottom disclosure notice). | Legible critical explanation, clear callout, accessible contrast, prototype response wording. |

---

## Verification & Compliance

- **Data Isolation**: Verified — public demo interacts strictly with isolated deterministic simulation state (`GasGuardPublicDemo`). No side-effects or mutations on `demo-site`, `device-test`, or `hardware-pilot`.
- **Product Truthfulness**: Verified — zero claims of certified thresholds, hardware calibration, AI prediction, or automated emergency control.
- **Secrets & Credentials**: Audited — zero credentials, API keys, or private tokens present.
- **Personal Data**: Audited — zero personal or sensitive user data present.
- **Accessibility**: Verified — keyboard accessible scenario tabs (`aria-pressed`, `:focus-visible`), live-region status updates, and text equivalent for SVG trend.
