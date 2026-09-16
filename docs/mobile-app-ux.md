# GasGuard Mobile-first Application UX

## Purpose and boundary

GasGuard is a browser-local, mock-data prototype. The mobile interface helps a person understand monitoring state, evidence and follow-up work. It is not a safety controller, a certified leak detector, a real service system, or a replacement for approved safety equipment.

## Mobile-first principles

- Reference viewport is 390×844. The interface also supports 360×800, 430×932, tablet and desktop.
- Status and next action appear before technical detail.
- Safe, attention, critical and unknown are always described in words as well as color.
- Bottom navigation leaves safe-area-aware space below the page content.
- Desktop sidebar and mobile navigation use the same registry in `js/navigation.js`.

## Roles and navigation

| Role | Landing page | Four direct mobile items | More menu |
| --- | --- | --- | --- |
| General | Overview | Home, Alerts, Area, History | Help and service, data guide |
| Technician | Work queue | Work, Appointment/report, Devices, Investigation | Provisioning, validation, maintenance |
| Developer | Developer dashboard | Dashboard, Data, Evidence, Demo | Feature analysis, validation, spatial, configuration |

The role selector is labelled **Demo mode** in the mobile sheet. It persists only in browser-local storage and does not represent login or production permissions. Changing role returns to that role's landing page. A permitted page is restored on refresh when the role has not changed.

## Page IDs and flows

- **G1–G5:** `overview`, `alerts`, `locations`, `events`, `assistant`
- **T1–T8:** `overview`, `reports`, `live`, `replay`, `setup`, `validation`, `maintenance`, `reports`
- **D1–D8:** `developer`, `explorer`, `events`, `demo`, `intelligence`, `validation`, `spatial`, `settings`

General flow is status → alert/history → help or service request. Technician flow is queue → evidence → device/provisioning/verification → report. Developer flow is pipeline overview → data/evidence → scenario demo and validation.

## Component patterns and accessibility

- Native buttons and selects are used for actions and controls.
- The More menu is a native `dialog`, closes with Escape, returns focus to its trigger and exposes role selection without a large persistent role picker.
- Bottom buttons have at least 52px height. Focus rings remain visible.
- Responsive layouts use a single content column on mobile, internal scrolling for code/data blocks and reserved bottom space for navigation.
- Motion is limited to existing short state transitions and respects reduced-motion rules.

## Language and safety state

General screens use Thai-first labels. Technician screens add technical English only where it names a field or workflow. Developer screens retain field names but include Thai context. “ผ่าน Verification” means a mock workflow gate passed; it never means certified or compliant.

`Unknown` means the browser cannot confirm current monitoring state. It is never relabelled as safe, does not resolve a gas incident and does not create a fabricated risk score.

## Known limits and future decision

All state is held in browser `localStorage`. There is no authentication, shared database, cloud sync, real notification delivery, hardware control or PWA/offline queue. A future production app must define authentication, site scope, retention, audit policy and edge-device safety behavior before using this navigation model with real users.
