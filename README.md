# GasGuard V2, Autonomous LPG Safety Draft 1

GasGuard V2 is an analytics-first LPG safety interface. It uses one canonical reading contract for simulation, REST API, MQTT, and later ESP32 adapters.

## Run locally

```powershell
npm run dev
```

Open `http://localhost:8080`.

## Test

```powershell
npm test
```

The test verifies the core safety semantics:

- normal historical readings become `safe`
- a sustained rise becomes `critical`
- offline telemetry becomes `unknown`, never `safe`

## Draft 1 scope

- Data Contract and mock telemetry
- Feature calculation: baseline, rate of rise, exposure, variance, confidence, baseline drift
- Explainable rule-based risk and anomaly score
- Overview, Live Monitor, Safety Intelligence, Analytics, Events, Alerts, Devices, Maintenance, Locations, Reports, and Ask GasGuard
- Browser-local history, source settings, JSON export
- REST and MQTT adapter entry points

Cloud authentication, persistent cloud storage, PWA caching, and real edge actuation are intentionally deferred. They must not replace local fail-safe logic on the device.

See [Data Architecture](docs/data-architecture.md) for the contract and safety semantics.
