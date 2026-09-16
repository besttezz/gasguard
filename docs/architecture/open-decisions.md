# Open decisions

Status: **No decision below is approved by this architecture package.**

| Blocking phase | Decision | Options | Recommendation | Evidence needed | Owner |
| --- | --- | --- | --- | --- | --- |
| Before backend | Backend framework | TypeScript Node service; Python async service; managed platform | evaluate TypeScript Node option first | prototype, maintenance skills, security review | Project Manager + Architect |
| Before backend | Database hosting | managed; self-hosted; home server | decide with backup/operations plan | cost, availability, owner | Project Manager |
| Before device ingress | MQTT broker | managed; self-hosted; embedded gateway option | require per-device ACL support | ACL, TLS, monitoring evaluation | Architect |
| Before auth | Authentication provider | managed IdP; self-managed; existing organization identity | choose only after identity ownership review | privacy, lifecycle, recovery | Project Manager |
| Before deployment | Deployment target | Mini PC; home server; managed/cloud | evaluate availability and maintenance burden | network, backup, patch owner | Operations owner |
| Before notifications | Notification provider | in-app only; push; provider integration | start with delivery-state design | consent, cost, delivery evidence | Product owner |
| Before device ingress | Hardware device identity | certificate; hardware-backed key; protected credential | choose per hardware capability | threat model, provisioning test | Hardware lead |
| After hardware choice | Sensor model | TBD | defer to validated hardware selection | manufacturer evidence, calibration plan | Hardware lead |
| Before incident cutover | Safety configuration source | approved controlled config; site config; research-derived | versioned approval workflow | validation and governance evidence | Safety owner |
| Before production | Retention duration | legal/operational/research options | TBD | policy decision | Project Manager |
| Before production | Backup location / recovery objectives | organizational options | TBD | restore test and owner | Operations owner |
| Before production | Monitoring | self-hosted/managed observability | TBD | alert ownership and privacy review | Operations owner |
| Before technician auth | Technician account ownership | internal; partner; per-site | explicit lifecycle and assignment process | employment/contract/privacy policy | Project Manager |
