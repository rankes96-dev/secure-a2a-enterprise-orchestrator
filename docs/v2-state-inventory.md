# V2 State Inventory

This document is inventory/planning only. It defines the current known volatile state and intended future owner for Phase 2 platform persistence. It does not claim database persistence is already implemented.

| State item | Current location / module | Current storage type | Risk if process restarts | Future store | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `conversations` | `services/orchestrator-api/src/index.ts` | in-memory Map | Governed chat context, pending follow-up context, and continuity are lost. | Postgres | high | Needed for governed chat, pending interactions, audit continuity. |
| `userIdentitiesBySession` | `services/orchestrator-api/src/index.ts` | in-memory Map | Browser session to verified user mapping is lost, forcing re-identification. | session store / Redis or DB-backed session reference | high | Auth0 identity is verified, but current session identity is process-local. |
| `rateLimitBuckets` | `services/orchestrator-api/src/index.ts` | in-memory Map | Restart clears local throttling windows. | Redis / Upstash | medium | Should remain short-lived, not Postgres. |
| trusted/onboarded connector agents | agent onboarding registry / current implementation | likely in-memory or state store depending current code | Installed connector trust may disappear and require re-onboarding. | Postgres durable connector registry | highest | Phase 2.1 starts routing connector trust records through `PlatformStateStore`; the memory driver remains active and Postgres implementation is still future work. With memory only, process restart still loses data. |
| connector profiles / profile hashes | `services/orchestrator-api/src/agentOnboarding/*`, external connector profile fetch flow | process-local runtime data / latest fetched snapshot | Stale config detection and profile proof may be unavailable after restart. | Postgres | high | Needed for stale config detection and audit proof. |
| connector trust events | agent onboarding flow / current trust response handling | response-derived or in-memory proof | Onboarding proof history can be lost. | Postgres | high | Onboarding proof should be durable. |
| audit/security timeline events | latest response-derived proof | response object / frontend-visible latest state | Security Timeline loses historical continuity and restart-surviving proof. | Postgres audit events | high | Security Timeline should eventually read persisted audit events. |
| pending interactions | conversation memory | in-memory conversation state | Target selection, approvals, and `authorization_required` continuations can be lost. | Postgres | high | Needed for target selection, approval, `authorization_required` continuation. |
| runtime executions | connector runtime response path | response-derived transient metadata | Execution proof and runtime history are lost. | Postgres | high | Store safe metadata only, never raw JWTs or Authorization headers. |
| Connected Accounts metadata | future connected-account boundary | not yet implemented | User-delegated authorization status cannot survive until implemented. | Postgres | later / Phase 2.5 | Raw vendor tokens must be encrypted and owned by adapter/token vault later. |

Planning constraints:

- Durable platform control-plane records should move behind `PlatformStateStore` before Postgres is introduced.
- Redis / Upstash remains the right home for replay protection, rate limits, nonce/challenge state, callback state, and other short-lived cache/lock data.
- Local memory remains available for local development fallback, tests, and demo-only ephemeral state.
- Store boundaries must use safe metadata only and no raw tokens.
- In-memory store reads/writes must use defensive deep copies for safe metadata. Runtime modules should use the singleton store accessor once the store is wired into orchestration paths.
