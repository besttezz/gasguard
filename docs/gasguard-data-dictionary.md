# GasGuard data dictionary, V2 foundation

## Design rule

Every record must answer: what was measured, when, where, which device and sensor produced it, in what operating context, and with what quality. Raw observations are immutable. Processed values and derived features are versioned so they can be recalculated when calibration or analysis changes.

```text
Raw telemetry -> processed reading -> derived features -> event/outcome -> AI analysis
```

Prototype threshold values are only UI and test assumptions. They are not certified safety limits.

## 1. SENSOR_READINGS

One synchronized timestamp per sensor reading. Temperature and humidity belong in the same record as LPG.

| Field group | Required fields | Layer | Notes |
|---|---|---|---|
| Identity | timestamp, locationId, zoneId, deviceId, sensorId | raw | ISO 8601 UTC timestamp in storage; display in local timezone |
| Raw gas | rawAdc, sensorVoltage, sensorResistance, rsR0 | raw | Preserve for future recalculation |
| Processed gas | calculatedPpm, correctedPpm, unit, calibrationVersion | processed | correctedPpm must record compensation version |
| Environment | temperatureC, humidityPct | raw context | Same timestamp as gas |
| Operating context | operatingState, kitchenActive, occupancy, ventilationState, fanState, doorState | context | `closed`, `idle`, `active`, `cleaning`, `maintenance`, `unknown` |
| Quality | warmupComplete, timeSinceBootSec, confidence, qualityFlags | derived | Never silently turn stale or invalid data into zero |
| Baseline | baselineValue, baselineDelta, baselineMean1h, baselineMean24h, baselineMean7d | derived | Version feature calculations |

## 2. DERIVED_GAS_FEATURES

Calculated from readings, never used as a replacement for raw telemetry.

| Feature family | Fields |
|---|---|
| Change | gasDelta5s, gasDelta30s, gasDelta1m, gasDelta5m, rate5s, rate30s, rate1m, rate5m, gasAcceleration |
| Smoothing | movingAvg1m, movingAvg5m, movingAvg15m, movingAvg1h |
| Stability | variance1m, variance5m, variance1h, std1m, std5m, std1h |
| Event shape | min1m, max1m, peakValue, peakStart, peakEnd, peakDurationSec, recoveryRate, timeToBaselineSec |
| Exposure | timeAboveBaselineSec, percentTimeAboveBaseline, areaUnderCurve |
| Context | anomalyScore, leakContext, usagePattern, zoneRisk, sensorFusionConfidence |

## 3. DEVICES AND SENSORS

`DEVICES` holds gateway or controller metadata. `SENSORS` holds individual sensor metadata, installation and calibration status. A device can host multiple sensors.

Required device health fields: firmwareVersion, deviceUptimeSec, bootCount, resetReason, cpuTemperatureC, freeHeapBytes, powerVoltage, powerCurrent, watchdogResetCount, lastSeen.

Required sensor fields: sensorModel, manufacturer, batch, installationDate, operatingHours, calibrationDate, status, baselineDrift7d, sensorHealth.

## 4. ACTUATOR_LOGS

Valve state is not a single boolean. Store commandedState, actualState, commandTimestamp, feedbackTimestamp, responseTimeMs, failedCommandCount, openCloseCycleCount, timeOpenSec, and timeClosedSec. A command-feedback mismatch is an actuator fault, not proof that the valve moved.

## 5. NETWORK_AND_POWER_LOGS

Store rssi, latencyMs, packetLossPct, disconnectCount, reconnectCount, lastSeen, messageIntervalMs, missedMessages, mqttConnectionState, apiResponseTimeMs, inputVoltage, batteryVoltage, batteryPercentage, chargingState, powerSource, powerFailureCount, and backupActive.

## 6. EVENTS, ALERTS AND USER_ACTIONS

An alert has a lifecycle: alertId, triggerTime, acknowledgedTime, resolvedTime, triggerReason, severity, triggerValue, peakValue, durationSec, notificationSent, notificationReceived, userAcknowledged, and assigned outcome.

Engineers label events with: `normal`, `cooking`, `sensor_noise`, `environmental_effect`, `device_fault`, `network_fault`, `maintenance`, `confirmed_abnormal_event`, or `unknown`.

Keep `labelSource` and `labelConfidence` (`low`, `medium`, `confirmed`). Keep user interaction timestamps for alertOpened, alertAcknowledged, actionTaken, and timeToAcknowledgeSec.

## 7. CALIBRATION_AND_MAINTENANCE_LOGS

Calibration records require calibrationId, sensorId, date, beforeValue, afterValue, referenceCondition, temperatureC, humidityPct, calibrationMethod, operator, result, and calibrationVersion. Maintenance records must retain the evidence that caused the recommendation.

## 8. AI_ANALYSIS AND MODEL_VERSIONS

AI output is an auditable derived record: modelVersion, featureSchemaVersion, inputFeatureIds or snapshot, riskScore, anomalyScore, prediction, confidence, explanation, timestamp, and later ground-truth outcome. The rule engine is stored the same way as an AI model so V0.1 can be compared with later models.

## Sampling and retention, prototype defaults

- Live telemetry: target 10 seconds, configurable per device.
- UI mock history: generate 24 hours at 10-second cadence only when a browser or backend can retain it efficiently; do not render all points at once.
- Persist raw readings before aggregation. Build 1-minute and 1-hour rollups for dashboard views.
- Retain quality flags and calibration version alongside every raw reading.

## V2 priorities

1. Raw sensor values and synchronized environment data.
2. Context and outcome labels.
3. Calibration, operating-hours, baseline and sensor-health history.
4. Valve command-feedback and network/power reliability.
5. Multiple-sensor topology from the 2D plan.

## Provider boundary

MockProvider, RESTProvider and MQTTProvider must produce the same normalized envelope. UI screens consume provider/store state only. They must not invent a safety score or sensor value locally.
