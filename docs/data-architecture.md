# GasGuard V2 Data Architecture

## Canonical reading contract

Every provider, including mock, REST, MQTT, and ESP32 adapters, must emit the same shape.

```js
{
  deviceId, sensorId, locationId, zoneId,
  timestamp,
  gas: { value, unit: 'ppm', rawValue, calibrationVersion },
  environment: { temperature, humidity },
  system: { valve, connection, battery, rssi }
}
```

`connection` is `online` or `offline`. `valve` is `open`, `closed`, or `unknown`. A missing or offline reading is never converted to a zero gas value.

## Derived features, model v0.1

| Feature | Calculation | Purpose |
| --- | --- | --- |
| Baseline | mean of historical readings, excluding the latest short window | expected local LPG level |
| Rate of rise | difference across the recent five reading intervals | detect rapid accumulation |
| Exposure | sum of `max(0, LPG - baseline)` across the latest 30 minutes | distinguish sustained elevation from a single peak |
| Variance | standard deviation of the baseline pool | scale deviation to local noise |
| Confidence | starts at 96 and is reduced for humidity, variance, and known prototype sensor age | qualify the reading, not the safety state |
| Anomaly score | z-deviation, positive rate, and inconsistent valve context | quantify unusual behavior |
| Risk score | concentration, rate, exposure, anomaly, valve context, and confidence | rule-based, explainable prioritization |

All values must carry a model or calibration version once persisted. V0.1 is a prototype model, not a certified safety calculation.

## Safety semantics

| State | Meaning | UI behavior |
| --- | --- | --- |
| `safe` | data is online and no current risk feature is elevated | normal status with evidence |
| `attention` | pattern needs review but is not critical | show causes and observation guidance |
| `critical` | high computed risk from multiple evidence factors | show immediate review guidance and event record |
| `unknown` | telemetry is unavailable or insufficient | show monitoring unavailable, do not show a risk score |

Safety-critical actuation remains an edge/device responsibility. The web application records, explains, and requests actions; it is not the authoritative fail-safe controller.

## Model evolution

V0.1 uses deterministic rules. V0.2 may replace individual feature thresholds with robust local statistics. Machine learning is only introduced after a labeled, quality-controlled dataset exists and must preserve the same canonical contract and explainability output.
