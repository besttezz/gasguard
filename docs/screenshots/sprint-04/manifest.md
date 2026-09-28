# GasGuard Screenshot Archive — Sprint 04

## Metadata

- **Sprint**: 04 — How It Works & User Roles
- **Feature**: Connected System Flow (5 Stages with Progressive Disclosure) and User Roles (4 Roles Centered on Questions)
- **Branch**: `feature/public-product-landing`
- **Base Commit**: `12b3b6c` (Sprint 03 finalization checkpoint)
- **Implementation Commit**: `376106a`
- **Generated At**: 2026-09-25

---

## Archive Manifest

| Screenshot Filename | Viewport | Section | Purpose | Disclosure State | Product Truthfulness Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `desktop-1440px-how-it-works.png` | 1440 × 900 (Desktop) | HOW IT WORKS | Verify 5-stage connected horizontal architecture flow (Sensor → Measurement → Telemetry → Safety Analysis → Experience) with directional connectors. | Default visitor-level view (`<details>` collapsed). | Raw ADC inputs separated from processing; explicitly notes prototype limitations. No certified threshold or automatic control claims. |
| `desktop-1440px-how-it-works-expanded.png` | 1440 × 900 (Desktop) | HOW IT WORKS | Verify technical progressive disclosure (`<details>` / `<summary>`) opened across all 5 stages for engineering credibility. | Expanded technical details view (`<details open>`). | Explicitly specifies Telemetry V1.1 monotonic sequence, measurement calibration boundary, and rule-based safety scoring prototype limits. |
| `desktop-1440px-roles.png` | 1440 × 900 (Desktop) | USER ROLES | Verify question-centered interactive role presentation: left role tabs + right contextual showcase panel with focus list and mini product fragment. | Active tab: GENERAL (`“ตอนนี้พื้นที่ของฉันเป็นอย่างไร?”`). | Honest workspace preview with realistic mock data; no unbacked claims of administrative or safety capabilities. |
| `tablet-768px-sprint04.png` | 768 × 1024 (Tablet) | HOW IT WORKS & ROLES | Verify tablet responsive layout, touch-friendly stage hierarchy, and 2-column role tabs. | Responsive tablet layout. | Clean typography, zero horizontal overflow, seamless transition from Demo to How It Works. |
| `mobile-390px-how-it-works.png` | 390 × 844 (Mobile) | HOW IT WORKS | Verify mobile vertical stepper layout (01 ↓ 02 ↓ 03 ↓ 04 ↓ 05) replacing horizontal dragging. | Mobile vertical stepper. | No horizontal scrolling or dragging required; legible cards with accessible disclosures. |
| `mobile-390px-roles.png` | 390 × 844 (Mobile) | USER ROLES | Verify mobile single-column role navigation and contextual story presentation. | Mobile role navigation. | Accessible touch targets (>= 48px), clean layout, zero horizontal overflow. |

---

## Verification & Compliance

- **Data Isolation**: Verified — How It Works and User Roles public sections are strictly informational and presentational. No mutation or leakage into authenticated workspaces (`demo-site`, `device-test`, or `hardware-pilot`).
- **Product Truthfulness**: Verified — zero claims of physical MQ sensor calibration, certified LPG emergency thresholds, automated shutoff control, or production hardware deployment. Clear prototype notices provided.
- **Secrets & Credentials**: Audited — zero credentials, private keys, or API tokens present.
- **Personal Data**: Audited — zero real personal identities or sensitive information present.
- **Accessibility**: Verified — semantic heading structure, native accessible `<details>/<summary>`, ARIA tablist/tab/tabpanel markup with keyboard navigation support, and `:focus-visible` styling preserved.
