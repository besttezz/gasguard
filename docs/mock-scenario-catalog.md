# Mock scenario and acceptance catalog

All UI screens consume the same engine/provider state. A scenario changes that shared state, not individual screen values.

| Scenario | Mock condition | Required system result |
|---|---|---|
| Normal | Stable LPG, active kitchen, valve open | Safe state, normal confidence, no safety alert |
| Cooking transient | Short rise followed by recovery | Contextual analysis must avoid treating a short active-cooking peak as a confirmed leak |
| Slow leak | Sustained increase while inactive | Rate, anomaly, exposure and risk increase progressively |
| Rapid leak | Rapid concentration increase | Critical state, alert/event evidence and incident replay |
| Sensor failure | Sensor telemetry unavailable | Unknown, never safe; no risk score |
| Network failure | MQTT/network unavailable | Unknown monitoring state, data-reliability evidence and reconnect context |
| Valve failure | Commanded close but feedback open | Actuator mismatch, low valve health and elevated anomaly/risk evidence |
| Sensor drift | Baseline rises over time | Drift and sensor-health inspection path visible to engineers |

## Required acceptance checks

1. Raw fields remain available after processed/derived values are created.
2. Every rendered metric derives from provider/engine state, not an arbitrary UI value.
3. Offline or stale telemetry is displayed as unknown, not zero or safe.
4. A valve command is not considered successful without feedback.
5. An event can be given an outcome label, label source and confidence.
6. Only confirmed labels are eligible for training-dataset export in a future backend.
7. Prototype compensation and thresholds are always identified as validation-required.

## Hardware handoff checklist

Before replacing MockProvider for a device, map every hardware field to the Data Dictionary, verify units and timestamp source, test malformed payload rejection, validate warm-up behavior, and capture calibration provenance. A missing optional field must become an explicit quality flag rather than a fabricated value.
