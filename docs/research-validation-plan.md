# GasGuard research validation plan

## Research contribution

GasGuard is proposed as an explainable, context-aware LPG safety decision-support system. It differs from a fixed gas-concentration alarm by using the historical baseline, rate of rise, exposure, valve state, kitchen activity, connection state, and data confidence. The web application is an analytics and explanation layer. It is not an approved leak detector or a cloud-dependent safety controller.

## Comparison baseline

The baseline comparator is a fixed-threshold policy used only for the prototype comparison:

- below 180 ppm: safe
- 180 to 299 ppm: attention
- 300 ppm or higher: critical
- offline telemetry: unknown

These values are not validated safety limits. They must be replaced by criteria based on the selected sensor, installation environment, applicable standards, and supervised field testing.

## Controlled scenarios

1. Normal kitchen operation: expected safe.
2. Short concentration peak while valve is open and cooking is active: expected safe after contextual review.
3. Sustained LPG rise while valve is closed and kitchen activity is inactive: expected critical.
4. Sensor or network loss: expected unknown, never safe.

The Validation Lab in the UI presents deterministic mock versions of these cases. Its output proves only that the implementation follows the stated prototype rules. It is not a performance claim.

## Prototype test functions

The Validation Lab includes a Scenario Test Runner, a Fail-safe Drill, and Incident Evidence export. The runner checks the four deterministic mock cases against their declared expected states. The drill checks that offline telemetry becomes `unknown`, malformed payloads are rejected, and the browser does not claim authority for remote valve actuation. Incident Evidence exports the normalized reading, derived features, explanation, recent events, and the prototype safety boundary in JSON.

## Field evaluation protocol

For every recorded scenario, preserve the normalized sensor payload, calibration state, environmental values, valve feedback, observed activity, human safety classification, and timestamp. Split recordings by date or site before tuning the model, then reserve held-out recordings for final evaluation.

Report:

- detection lead time relative to the fixed-threshold comparator;
- false alarm rate for normal cooking and transient peaks;
- missed-event rate for supervised leak scenarios;
- precision, recall, and confusion matrix for the event taxonomy;
- data availability, stale-data count, and unknown-state duration;
- explanation completeness: whether each alert includes its input evidence and recommended human action.

## Safety and governance boundary

Any physical valve closure, alarm, or ventilation response must be validated independently at the edge controller with manual override, feedback confirmation, and a safe failure mode. The browser and cloud must not be the sole authority for emergency actuation. Remote command authorization, audit logging, network security, and operator runbooks are required before field deployment.
