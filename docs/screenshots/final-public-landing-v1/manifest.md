# GasGuard Screenshot Archive — Final Public Landing V1

## Metadata

- **Product**: GasGuard Public Landing V1
- **Design Direction**: Calm Safety Intelligence
- **Branch**: `feature/public-product-landing`
- **Final Commit**: `7a8e1e9` / final release checkpoint
- **Release Status**: PASS — Public Landing V1 Verified for Demo & Review
- **Date**: 2026-09-25

---

## Product Maturity

- **Public Landing V1**: Complete / Demo Ready (Review Ready)
- **Software Prototype**: Implemented for demonstration and testing
- **Device Integration Software**: Ready for device integration testing
- **Physical ESP32**: Pending validation
- **MQ-3 / MQ-6 Calibration**: Pending physical calibration and validation
- **Safety Thresholds**: Pending validation
- **Certification**: Not completed
- **Production Safety Deployment**: Not approved / not claimed

---

## Sections

1. Navigation
2. Hero
3. Why GasGuard
4. Product Capabilities
5. Interactive Demo
6. How It Works
7. User Roles
8. Technology
9. Trust & Transparency
10. Final CTA

---

## Viewports

- **Desktop**: 1440 × 900
- **Tablet**: 768 × 1024
- **Mobile**: 390 × 844

---

## Interactive States

- **Demo Scenarios**: NORMAL (84 ppm), ATTENTION (185 ppm), CRITICAL (420 ppm)
- **Role Tabs**: General, Technician, Admin, Developer
- **Technical Disclosures**: Native accessible details/summary in How It Works and Technology Pillars
- **Authentication Transition**: Seamless switch between public-view and auth-view

---

## Truthfulness Notes

- **Prototype Transparency**: Persistent `SIMULATION / PROTOTYPE / ข้อมูลจำลอง` badge across all demo views.
- **Hardware Separation**: Telemetry schema validation (`deviceId`, `sensorId`, `bootId`) separated from Hardware Device Key Ingress.
- **Pending Validation**: Factual disclosures for pending physical ESP32 testing, MQ-3/MQ-6 calibration, and safety threshold validation.
- **Zero Forbidden Claims**: Zero occurrences of `Valve: OPEN/CLOSED`, `Connection: ONLINE`, `Sensor: Active`, or automated shutoff claims.

---

## Accessibility Notes

- Exactly one semantic H1 in public view.
- Logical H2/H3 heading hierarchy.
- Visible focus rings (`:focus-visible`) for all interactive elements.
- ARIA live regions (`aria-live="polite"`) for dynamic trend updates.
- Full keyboard navigation for role tabs and scenario buttons.
- Touch target compliance (>= 44px) across mobile views.

---

## Purpose

- Presentation slides
- Project documentation
- Before/after comparison
- UI regression reference

---

## Archive Manifest

| Screenshot Filename | Viewport | Section / Scope | Verification Status | Truthfulness / Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `01-desktop-1440px-hero.png` | 1440 × 900 | Hero & Preview Card | PASS | Product-first hero with truthful preview |
| `02-desktop-1440px-product-story.png` | 1440 × 900 | Why GasGuard & Capabilities | PASS | Editorial problem narrative (3 Signals) |
| `03-desktop-1440px-demo-normal.png` | 1440 × 900 | Interactive Demo (Normal) | PASS | Dominant Product Window (84 ppm, Safe) |
| `04-desktop-1440px-demo-critical.png` | 1440 × 900 | Interactive Demo (Critical) | PASS | Critical scenario proof (420 ppm, Risk 94) |
| `05-desktop-1440px-how-it-works.png` | 1440 × 900 | How It Works (System Flow) | PASS | Connected 5-stage architecture |
| `06-desktop-1440px-roles.png` | 1440 × 900 | User Roles (4 Experiences) | PASS | Contextual persona tabs with problem framing |
| `07-desktop-1440px-technology.png` | 1440 × 900 | Technology (3 Pillars) | PASS | Engineering pillars & ingress path |
| `08-desktop-1440px-trust.png` | 1440 × 900 | Trust & Transparency | PASS | 3-stage maturity model (factual boundaries) |
| `09-desktop-1440px-final-cta.png` | 1440 × 900 | Final Closing CTA | PASS | Calm closing stage with dual action |
| `desktop-1440px-full-page.png` | 1440 × Full | Complete Landing Page | PASS | Seamless full-page continuous narrative |
| `tablet-768px-full-top.png` | 768 × 1024 | Hero & Top (Tablet) | PASS | Responsive tablet layout |
| `tablet-768px-demo-flow.png` | 768 × 1024 | Demo & Flow (Tablet) | PASS | Responsive demo and system flow |
| `mobile-390px-hero.png` | 390 × 844 | Mobile Hero | PASS | Clean mobile hero with touch CTA |
| `mobile-390px-demo.png` | 390 × 844 | Mobile Interactive Demo | PASS | Mobile-optimized product window |
| `mobile-390px-flow.png` | 390 × 844 | Mobile How It Works | PASS | Vertically stacked flow stages |
| `mobile-390px-roles.png` | 390 × 844 | Mobile User Roles | PASS | Touch-friendly role selector |
| `mobile-390px-trust-cta.png` | 390 × 844 | Mobile Trust & Final CTA | PASS | Stacked maturity cards and closing CTA |
| `before-after/before-sprint01-hero.png` | 1440 × 900 | Benchmark Baseline (Sprint 1) | ARCHIVE | Pre-optimization reference |
| `before-after/after-final-v1-hero.png` | 1440 × 900 | Final Hero Experience | PASS | Post-optimization release reference |
