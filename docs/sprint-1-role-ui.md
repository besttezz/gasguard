# Sprint 1, Demo role-based information architecture

## Scope

This implementation changes what the Browser UI displays. It does not add authentication, authorization, multi-tenant storage, or security controls. The active role is stored only in browser `localStorage` under `gasguard-v2-demo-role`.

## Navigation matrix

| UI page or workspace | General | Technician | Developer |
| --- | --- | --- | --- |
| Overview | Yes | Yes | No, System Overview is used instead |
| Alerts | Yes | No | No |
| Areas | Yes | No | No |
| Event history | Yes | No | Logs and Evidence |
| Help / Ask GasGuard | Yes | No | No |
| Provisioning and Plan Editor | No | Yes | No |
| Live monitor / device diagnostics | No | Yes | No |
| Replay | No | Yes | No |
| Validation Lab | No | Yes | Yes |
| Maintenance | No | Yes | No |
| Reports | No | Yes | No |
| Developer Console | No | No | Yes |
| Data Explorer | No | No | Yes |
| Safety Intelligence | No | No | Yes |
| Spatial Simulation | No | No | Yes |
| Settings | No | No | Yes |

`goToPage()` is the normal UI navigation gate. If a page is not present in the active role matrix, it redirects to that role's landing page. This is a usability control, not a security boundary. A future authenticated backend must enforce role permissions independently.

## Site context and source label

The header displays one active site context. Before a provisioning record exists it states `ยังไม่ได้ลงทะเบียนสถานที่` and identifies Restaurant A as sample context. Provisioning changes the displayed name only in the local browser profile.

When the active provider is Simulation, every role shows `ข้อมูลจำลอง · Simulation` in the persistent header. This global source label remains visible on Dashboard, Events and Reports so mock values are not presented as hardware telemetry.
