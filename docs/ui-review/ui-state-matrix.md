# UI State Matrix

| Surface | Relevant states | Implemented behaviour | Test route |
| --- | --- | --- | --- |
| U1 Overview | Normal, Watch, Danger, Unknown, System fault | Plain-language status and next action; no raw score for General | S01, S02, S03, S04, S05 |
| U3 Locations | Normal, Unknown, empty plan | Read-only status and plan summary | General, S01/S04 |
| U4 Events | Empty, gas risk, system fault, resolved | Incident list and lifecycle status | General, S03/S05 |
| U5 Help/service | Empty, request success/failure, report | Inline service request and mock disclaimer | General, S09 |
| T1 Queue | Empty, incident, system fault, request | Work queue is derived from open records | Technician, S03/S04/S09 |
| T2 Provisioning | Incomplete, saved, validation pending/pass | Commissioning list identifies missing prerequisite | Technician setup workspace |
| T3 Diagnostics | Normal, warning, unknown | Sensor/network/power/valve evidence is labelled | Technician, S01/S04/S06 |
| T4 Replay | Empty, gas risk, system fault, workflow | Detection and technician actions stay separate | Technician, S03/S05/S09 |
| T7 Reports | Empty, verification pending, completed | Report gate and simulation disclaimer | Technician, S09 |
| D1/D2/D3/D6 | Normal, missing data, evidence | Raw JSON only Developer, labels show prototype boundary | Developer, S01/S03/S09 |
| D4/D5/D8 | Validation, spatial scenario, guided flow | Prototype/disclaimer and scenario-specific controls | Developer, S01–S10 |

Storage corruption is handled by the Engine as `Unknown`; a successful UI toast is only shown after the relevant local persistence call completes.
