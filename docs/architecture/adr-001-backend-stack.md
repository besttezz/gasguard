# ADR-001: Backend stack direction

Status: **Recommended for evaluation; not approved or installed**.

## Context

The current client is vanilla JavaScript. A future backend needs REST APIs, MQTT integration through a controlled boundary, transactional persistence, background work, PostgreSQL support, server-side authorization, and testability on a Mini PC or home server.

## Options

| Status | Option | Strengths | Trade-offs |
| --- | --- | --- | --- |
| **Recommended** | JavaScript/TypeScript service using a lightweight Node.js HTTP framework, PostgreSQL, and a separate worker process | Shares language and validation concepts with the prototype; clear REST integration; mature PostgreSQL ecosystem; can split API/worker/device ingress; moderate resource use | Requires disciplined runtime validation, transaction design, migration discipline, and operational hardening |
| Alternative | Python service using an async web framework, PostgreSQL, and separate worker/device-ingress processes | Strong data-analysis ecosystem; readable domain services; good async and test tooling | Introduces a second primary language and separate validation models from the current JavaScript client |
| Deferred decision | Backend-as-a-service / managed platform | Faster initial identity and database setup | Must be assessed for MQTT boundary, transaction/outbox control, site isolation, cost, offline expectations, and deployment ownership |

## Recommendation

Evaluate the first option: a **TypeScript-oriented Node.js backend**, PostgreSQL as the relational source of truth, a separately deployable worker, and a broker integration boundary. This is a recommendation because it minimizes language discontinuity while preserving clear transaction ownership. It is not a stack decision until deployment, identity, broker, backup, and maintenance ownership are approved.

## Decision principles

- Keep the web SPA as a client; it does not make final safety or device-control decisions.
- Keep MQTT broker, ingress validation, API, worker, and database as separately controllable components.
- Use server-side runtime validation; never trust browser localStorage role or site ID.
- Use database transactions and an outbox for state changes that cause notifications.
- Do not select package versions in this ADR. Versions, patch policy, and support lifecycle are deferred to implementation planning.

## Consequences

Before implementation, select framework, ORM/query approach, migration tool, broker, authentication provider, deployment target, observability stack, and backup owner through the open-decision register.
