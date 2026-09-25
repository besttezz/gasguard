# GasGuard Public Landing V1

## Purpose

Provide a truthful, calm, and accessible public product landing page that introduces GasGuard as a safety intelligence platform for LPG monitoring. The page bridges high-level problem understanding for everyday visitors with deep engineering credibility for technical teams.

## User Journey

Visitor
→ Product (Why GasGuard & 3 Signals)
→ Demo (Interactive Simulation with Deterministic Scenarios)
→ Architecture (How It Works: 5-Stage System Flow)
→ Roles (4 Tailored Experiences: General, Technician, Admin, Developer)
→ Technology (3 Engineering Pillars: Reliable Data, Protected Pipeline, Hardware Path)
→ Trust (3-Stage Maturity Model & Boundary Transparency)
→ Sign In (Authorized Workspace Access)

## Sections

1. **Navigation Header**: Brand mark, section anchors (`#public-product-section`, `#public-demo-section`, `#public-flow-section`, `#public-roles-section`, `#public-tech-section`, `#public-trust-section`), and Sign In CTA.
2. **Hero Section**: Value proposition ("เข้าใจสถานะ LPG ไม่ใช่แค่ดูตัวเลข"), primary CTA ("ทดลองระบบ"), secondary flow link, and prototype preview card.
3. **Why GasGuard**: Problem narrative explaining the 3 signals: Level, Change (Rate of Rise), and Context.
4. **Product Capabilities**: 4 core pillars: Monitor, Analyze, Explain, and Respond.
5. **Interactive Demo**: Dominant Product Window running deterministic simulation scenarios (`NORMAL`, `ATTENTION`, `CRITICAL`).
6. **How It Works**: 5 connected architecture stages with collapsible technical detail disclosures.
7. **User Roles**: Contextual persona showcase addressing core questions for General, Technician, Admin, and Developer users.
8. **Technology**: 3 engineering pillars covering Telemetry V1.1 schema validation, protected pipeline guardrails, and HTTP device ingress.
9. **Trust & Transparency**: 3-stage maturity model clearly separating software implementation from pending hardware validation.
10. **Final Closing CTA**: Deep calm navy stage with dual actions ("ทดลองระบบ" and "เข้าสู่ระบบ") and companion brand accent.
11. **Public Footer**: Prototype metadata and copyright notice.

## Design Direction

**Calm Safety Intelligence**
- Curated calm dark/light surfaces with deep navy accents
- Restrained color-coded status badges with high contrast
- Non-alarmist, informative micro-animations and typography
- Zero sensationalized warnings or flashing emergency decoration

## Public Demo

- **NORMAL**: Baseline 84 ppm, rate +0.2 ppm/min, Safety Score 92/100, status Normal.
- **ATTENTION**: Elevated 185 ppm, rate +4.5 ppm/min, Safety Score 58/100, status Attention.
- **CRITICAL**: High risk 420 ppm, rate +12.8 ppm/min, Safety Score 6/100, status Critical.

*Clearly simulated/prototype*: Isolated deterministic client-side evaluation with persistent `SIMULATION / PROTOTYPE / ข้อมูลจำลอง` badge.

## Product Boundaries

- **Not Certified**: GasGuard is a software prototype and safety intelligence platform, not a certified industrial safety controller.
- **Physical ESP32 Pending**: Hardware packet delivery and physical wireless testing remain pending field validation.
- **MQ Calibration Pending**: Physical sensor resistance calibration and formal ppm conversion curves for MQ-3/MQ-6 remain pending laboratory testing.
- **No Autonomous Shutoff**: Valve closures and safety interventions remain advisory; no direct automated actuator control is claimed.

## Responsive Targets

- **390 × 844 (Mobile)**: Compact cards, wrapped diagram chips, mobile drawer navigation, zero horizontal overflow.
- **768 × 1024 (Tablet)**: Balanced 2-column grids, legible text wrapping, accessible touch targets.
- **1440 × 900 (Desktop)**: Full-width responsive container, multi-column architectural diagrams, side-by-side role showcase.

## Screenshot Archive

- Final archive location: `docs/screenshots/final-public-landing-v1/`
- Full-page capture: `docs/screenshots/final-public-landing-v1/desktop-1440px-full-page.png`
- Manifest: `docs/screenshots/final-public-landing-v1/manifest.md`
- Before/After comparison: `docs/screenshots/final-public-landing-v1/before-after/`

## Current Branch / Checkpoint

- **Branch**: `feature/public-product-landing`
- **Baseline Checkpoint**: `988ea48` (Sprint 05 screenshot archive)
- **Status**: Final QA 100% Complete & Verified
