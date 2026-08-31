# Autonomous LPG Safety Roadmap

## Draft 1, complete

- [x] Product context, data architecture, and normalized reading contract
- [x] Mock simulation and historical local persistence
- [x] Feature engineering: baseline, rate, exposure, variance, confidence, drift
- [x] Explainable rule-based risk, anomaly, event classification, and safety states
- [x] Owner and engineer views
- [x] Overview, live monitor, intelligence, analytics, events, alerts, devices, maintenance, locations, reports, settings, and analytics assistant
- [x] REST and MQTT adapter entry points
- [x] JSON export and core engine tests
- [x] Explainable Safety Replay and mock Validation Lab against a fixed-threshold comparator

## Integration phase, required before field use

- [ ] Define sensor hardware matrix, sampling rate, calibration method, and valid units
- [ ] Build/validate ESP32 payload adapter and device identity provisioning
- [ ] Test REST adapter against a real authenticated endpoint
- [ ] Test MQTT connectivity, topic authorization, reconnection, retained-message behavior, and malformed payloads
- [ ] Introduce server-side storage with retention, access control, audit log, and backup policy
- [ ] Define edge fail-safe logic, valve feedback, alarm behavior, and manual override independently of cloud/web
- [ ] Validate thresholds, compensation, drift model, and risk model with recorded field data
- [ ] Execute the controlled evaluation protocol in `docs/research-validation-plan.md` and report detection lead time, false alarms, missed events, and data availability

## Intelligence phase, only after data quality validation

- [ ] Establish labeled event taxonomy: cooking, suspected leak, fault, sensor drift, connectivity loss, maintenance
- [ ] Create data-quality monitoring and calibration records
- [ ] Validate statistical baseline/anomaly model against historical data
- [ ] Evaluate prediction and maintenance models with held-out data
- [ ] Add AI/LLM explanation only as a read-only layer over verified data and engine outputs

## Production readiness

- [ ] Authentication, user roles, multi-location permissions, and cloud synchronization
- [ ] Mobile/responsive field validation and accessibility audit
- [ ] PWA/offline event queue, only after cache/update strategy is designed
- [ ] Security review: API secrets, MQTT credentials, rate limits, CSP, dependency policy
- [ ] Incident runbooks, emergency procedures, monitoring, observability, and recovery drills

## Explicit safety boundary

The Draft 1 web application is a planning, visualization, and analytics prototype. It does not provide certified leak detection, cloud-independent valve control, or a substitute for approved safety equipment.
