# V2 Platform Foundation

V2 starts from the completed V1 Secure A2A Gateway production demo and turns it into a scalable platform foundation for external enterprise AI connector agents.

## V2 North Star

V2 is not more demo prompts. V2 is the **Secure A2A Platform Foundation**.

Product principle:

```text
AI can interpret.
Gateway decides.
External agents own domain-specific runtime behavior.
Gateway owns trust, identity, policy, scoped token issuance, runtime endpoint validation, and audit proof.
```

V2 should prove:

- real user identity
- persistent trust
- persistent audit
- connector extensibility through an SDK
- governed chat engine behavior
- CI and browser smoke coverage
- production deployment discipline

## V1 Baseline

V1 is merged to `main` and remains the stable production demo baseline.

V1 runs on:

- Vercel Web UI
- Railway orchestrator
- Railway Mock IdP
- Railway Jira external agent
- Railway ServiceNow external agent
- Railway GitHub external agent
- Upstash Redis
- OpenRouter

V1 proves:

- demo user login
- zero-trust external agent onboarding
- signed Gateway challenge
- signed external agent trust response
- connector profiles
- scoped A2A JWT runtime execution
- `private_key_jwt` against Mock IdP
- runtime endpoint allowlists
- onboarding URL allowlists
- token redaction
- proof / execution gate stack
- Jira, ServiceNow, and GitHub reference connector runtimes

## Orchestrator-agnostic strategy

Ogen V2 remains orchestrator-agnostic by design. The concrete roadmap, capability boundaries, and migration posture are defined in [`docs/orchestrator-agnostic-roadmap.md`](./orchestrator-agnostic-roadmap.md).

Vendor or platform examples may appear in implementation notes, but the trust contracts, policy model, and security boundaries stay orchestrator-neutral.

## V2 Phases

### Phase 0  V1 Closeout / Branch Hygiene

Goals:

- V1 remains stable on `main`.
- V2 work happens only on `feature/v2-platform-foundation`.
- V1 code paths remain verifiable.
- Deployment docs remain accurate.

Acceptance criteria:

- `npm run verify:v1` still passes.
- V2 docs exist.
- No V2 feature changes break V1.

### Phase 1  Real User Identity With Auth0

Goal: add pluggable real user identity.

Auth0 is the real user identity provider for browser users. The existing `services/mock-identity-provider` service remains the **Reference A2A Token Issuer** / **Reference A2A Authorization Server** for local and V1-style runtime token flows. Phase 1 must not replace that A2A issuer entirely.

Auth0 is for browser end-user identity only. In V2 Phase 1, the Reference A2A Token Issuer remains the issuer for scoped A2A machine tokens used by connector runtime execution. Future V2 work may replace the reference issuer with an Auth0/Okta-backed issuer or another production authorization server, but that is separate from user login.

Expected future implementation:

- `AUTH_PROVIDER=mock|auth0`
- Auth0 OIDC login
- JWT/JWKS validation
- issuer, audience, expiry, and signature checks
- claims mapping for `sub`, `email`, `name`, and roles/groups
- user identity flows into policy, connector runtime context, audit proof, and Security Timeline

Vercel frontend Auth0 env uses only public SPA configuration:

- `VITE_AUTH_PROVIDER=auth0`
- `VITE_AUTH0_DOMAIN`
- `VITE_AUTH0_CLIENT_ID`
- `VITE_AUTH0_AUDIENCE`

The Auth0 SPA redirect URI should use `/auth/callback` in local and production deployments. The app root `/` is normal application boot, not the preferred OAuth callback route.

Railway orchestrator Auth0 env validates the user JWT server-side:

- `AUTH_PROVIDER=auth0`
- `AUTH0_ISSUER`
- `AUTH0_AUDIENCE`
- `AUTH0_JWKS_URI`
- `AUTH0_EMAIL_CLAIM`
- `AUTH0_ROLES_CLAIM`

### Phase 2  Persistent Platform State

Goal: move platform state out of in-memory maps.

Recommended stack:

- Postgres on Railway
- Prisma or Drizzle
- Upstash remains for replay, security, rate-limit, and cache state

Persist:

- tenants
- users
- installed connectors
- connector profiles
- connector trust events
- audit events
- conversations
- pending interactions
- runtime executions
- security decisions

Acceptance criteria:

- installed connectors survive orchestrator restart
- audit timeline survives restart
- conversation metadata survives restart
- pending interactions survive refresh/restart
- V1 local in-memory mode remains available for fast development

#### Phase 2.0  Persistent State Foundation / Store Boundary

Goal: define the platform state boundary before adding a real database.

Inventory all current in-memory platform state, classify ownership, and define the first stable store boundary before implementation moves to Postgres.

This checkpoint inventories current in-memory platform state and classifies each item by future owner:

- durable Postgres candidate
- short-lived Redis/cache candidate
- local-only/dev-only state

It introduces a `PlatformStateStore` boundary and keeps `InMemoryPlatformStateStore` as the default local/dev implementation. The boundary prepares the platform for Postgres later without implementing database persistence in this checkpoint.

The local memory implementation must defensively clone stored safe metadata and expose a process-local singleton accessor so future wiring does not accidentally create isolated memory stores.

Recommended state placement:

Postgres / durable:

- tenants
- users
- installed connectors
- connector trust records
- connector profile snapshots
- connector trust events
- conversations metadata
- pending interactions
- audit events
- runtime executions
- security decisions
- connected account metadata, not raw tokens yet

Redis / short-lived:

- replay protection
- rate limits
- onboarding challenge nonce state
- short-lived auth/session cache
- temporary OAuth state during callbacks
- transient lock/cache state

Local memory:

- local development fallback
- test fixtures
- demo-only ephemeral state

Phase 2.0 non-goals:

- no DB migration in this checkpoint
- no token vault implementation
- no real vendor OAuth persistence
- no replacement of Upstash
- no removal of in-memory local mode

#### Phase 2.4  Security Event Export Boundary / SOC & Observability Readiness

Goal: prepare the Gateway to export sanitized structured security events through a vendor-neutral boundary.

This phase should be designed after Phase 2.3 Conversation / Pending Interaction State Boundary, when audit events and conversation/pending-interaction state have clearer shape, but before real external write-heavy connected account flows and before vendor-specific SOC, SIEM, and observability integrations.

The export boundary should:

- Prepare the Gateway to export sanitized structured security events.
- Keep the audit event model vendor-neutral.
- Support future SOC/SIEM and observability integrations.
- Avoid coupling the Gateway to Splunk, Microsoft Sentinel, Elastic, Datadog, OpenTelemetry collectors, webhook pipelines, or any one vendor.
- Keep raw protected material out of exported events.

Future boundary shape:

```ts
export type SecurityEventSeverity =
  | "info"
  | "low"
  | "medium"
  | "high"
  | "critical";

export type SecurityEventOutcome =
  | "success"
  | "failure"
  | "blocked"
  | "needs_action";

export type SecurityEventEnvelope = {
  schemaVersion: string;
  id: string;
  eventType: string;
  severity: SecurityEventSeverity;
  outcome: SecurityEventOutcome;
  createdAt: string;

  tenantId?: string;
  actorProvider?: string;
  actorSubject?: string;
  actorEmail?: string;

  conversationId?: string;
  requestId?: string;
  taskId?: string;
  connectorId?: string;
  runtimeExecutionId?: string;

  resourceType?: string;
  resourceId?: string;

  safeMetadata: Record<string, unknown>;
};

export type SecurityEventSink = {
  publish(event: SecurityEventEnvelope): Promise<void>;
};
```

Future sinks may include:

- PlatformStateStore sink
- Console sink
- Webhook sink
- OpenTelemetry sink
- Splunk sink
- Microsoft Sentinel sink
- Elastic sink
- Datadog sink

This phase is documentation and boundary design only. It must not implement vendor-specific sinks, add Splunk/Sentinel/Datadog dependencies, add OpenTelemetry runtime dependencies, add a database, or change runtime behavior.

Checkpoint implementation:

- Phase 2.4 implements the internal `SecurityEventSink` boundary.
- Default sink is `noop`, so no events are sent externally by default.
- Console sink is local diagnostic only and does not log full metadata.
- Vendor sinks remain future work.
- Exported event envelope uses schemaVersion `secure-a2a.security-event.v1`.
- Publish failures must not break runtime or audit write-through.

Correlation requirements:

Future exported security events should include correlation IDs and actor/tenant fields where available:

- conversationId
- requestId
- taskId
- connectorId
- runtimeExecutionId
- actorProvider
- actorSubject
- actorEmail
- tenantId

SOC and observability teams need to trace a flow from user login, request interpreted, connector selected, token issued, runtime executed or blocked, and final response.

Severity guidance:

| Event | Severity |
| --- | --- |
| `user.identity.verified` | `info` |
| `connector.onboarding.trusted` | `medium` |
| `connector.runtime.succeeded` | `info` |
| `connector.runtime.failed` | `medium` |
| `connector.runtime.authorization_required` | `low` or `medium` |
| `security.request.blocked` | `high` |
| governance bypass attempt | `high` or `critical` |

Outcome guidance:

| Event | Outcome |
| --- | --- |
| identity verified | `success` |
| runtime succeeded | `success` |
| runtime failed | `failure` |
| security blocked | `blocked` |
| authorization_required | `needs_action` |

Export safety requirements:

- Exported events must use safeMetadata only.
- Raw tokens, JWTs, Authorization headers, cookies, client assertions, private keys, client secrets, and raw prompts must never be exported.
- Future SOC/SIEM and observability exports must preserve the invariant: no raw tokens and no raw prompts.
- Existing neutral proof fields such as `protectedMaterialExposed` and `tokenMaterialStored` should remain safe boolean proof, not protected material.
- Vendor mappings should happen at the sink edge later, not inside the Gateway audit model.

### Phase 2.5  Connected Accounts / User Delegated OAuth

Goal: prevent external agents from acting with one shared admin/developer OAuth token.

Connected Accounts add user-delegated authorization for external applications that need user-level OAuth. The Gateway verifies enterprise user identity with Auth0, signs actor provenance into A2A runtime tokens, and external adapters validate those A2A runtime JWTs before calling vendor APIs. External adapters must never use one admin/developer OAuth token for all users.

Example ServiceNow/Monday flow:

- A user asks the ServiceNow agent to create a Monday defect.
- The adapter checks for a Monday connected account for `actor_provider + actor_sub`.
- If missing, the adapter returns `authorization_required`.
- The Gateway shows `Connect your monday account`.
- The user authorizes the Monday OAuth app.
- The adapter stores an encrypted token for that user.
- Future runtime calls use that user's Monday token, not Ran's token.

External applications using the same IdP as the enterprise tenant can help identity mapping through subject, email, directory, or SCIM data, but that does not replace OAuth delegated authorization for the target application. Identity proves who the user is; connected-account OAuth proves the user authorized that specific external app action.

Expected shared contracts:

- `ExternalAuthorizationRequirement` describes an `authorization_required` runtime response.
- `ConnectedAccountStatus` describes whether an actor has a usable connected account for a provider, connector, resource system, and scope set.
- Connector runtime proof and A2A agent responses may include safe authorization requirement metadata.
- End-user answers may safely say account connection is required, but must not expose raw OAuth tokens, refresh tokens, authorization codes, or Authorization headers.

Expected external adapter behavior:

- Validate the A2A runtime JWT signature, issuer, audience, expiration, required scope, `actor`, `actor_provider`, `actor_issuer`, and `actor_sub`.
- Resolve the actor to an external account by `actor_sub`, actor email, external directory, SCIM, or a user mapping table.
- Check the connected account token vault for provider, `actor_provider`, `actor_sub`, and required scopes.
- If the connected account is missing, expired, revoked, or insufficiently scoped, return `authorization_required`.
- If connected, use the actor's external app token for the vendor API call.
- For writes, require Gateway policy allow and human approval when configured.
- Never use one admin/developer OAuth token for all users.

Expected Gateway behavior:

- If connector runtime returns `authorization_required`, show `Connect your <provider> account`.
- Use a safe `authorizeUrl` as the CTA target when the adapter marks it safe for browser use.
- Keep a pending interaction so the user can continue after connecting the account.
- Security Timeline should show user authorization required, requested provider/scopes, actor identity, and raw tokens hidden.

Future token vault schema:

```text
connected_accounts
  id
  tenant_id
  actor_provider
  actor_issuer
  actor_subject
  actor_email
  provider
  resource_system
  connector_id
  external_account_id
  scopes
  status
  encrypted_access_token
  encrypted_refresh_token
  expires_at
  created_at
  updated_at
  revoked_at
```

Token vault security:

- Tokens are encrypted at rest.
- Tokens are never returned to the browser.
- Tokens are never logged.
- Revocation is supported.
- Refresh is handled server-side.
- One user's token is never used for another user.

### Phase 2.6  Tenant-Aware Postgres Schema Foundation

Goal: add the first opt-in durable database foundation behind `PlatformStateStore` without migrating every runtime read path at once.

This checkpoint adds a small Postgres boundary using `pg` directly. It does not introduce Prisma or Drizzle, does not make Postgres required for local development, and does not remove `InMemoryPlatformStateStore`.

Postgres is opt-in:

```env
PLATFORM_STATE_STORE_DRIVER=postgres
DATABASE_URL=<postgres-url>
DATABASE_SSL=true
```

Local development and V1-style demo flows continue to default to memory; memory remains default:

```env
PLATFORM_STATE_STORE_DRIVER=memory
```

Initial tenant-aware schema tables:

- `tenants`
- `users`
- `connector_trust_records`
- `audit_events`
- `conversation_states`
- `runtime_executions`

The schema uses `safe_metadata jsonb` for extensible proof data. It intentionally does not include a Connected Accounts token vault and does not include raw token material. OAuth access tokens, refresh tokens, authorization codes, JWTs, Authorization headers, cookies, private keys, client secrets, and client assertions must not be stored in these tables.

Connector trust records persist `owner_key_hash`, not raw owner keys or session-derived tokens. Their record IDs are scoped as tenant / owner-key-hash / agent so one tenant or owner cannot overwrite another tenant or owner's installed connector trust record for the same `agent_id`. Raw session tokens must never be stored in Postgres platform state or copied into connector trust `safe_metadata`.

The `PostgresPlatformStateStore` implements the existing state boundary for connector trust records, audit events, and conversation snapshots using parameterized queries. Phase 2.19 adds the first persisted audit viewer read path over these safe audit events.

### Phase 2.7  User Directory Access Gate

Goal: allow Auth0 to authenticate browser users, then require the local Gateway user directory to authorize access before attaching Gateway identity to the browser session.

Auth0 remains the authentication provider. The local users table authorizes Gateway access as an allowlist / user directory. The users table is passwordless: it stores no passwords, no password hashes, no raw OAuth tokens, no JWTs, and no Authorization headers. This is no token storage for user login. Email is the pre-provisioning key so operators can invite or allowlist a user before first login.

Directory model:

- `email` is required and normalized for lookup.
- `status` is `active`, `disabled`, or `invited`.
- `provider`, `issuer`, and `subject` may be empty before first login.
- First successful Auth0 login binds `provider` / `issuer` / `subject` to the email directory entry.
- Missing users are denied with a safe browser message.
- Disabled users are denied.
- Existing provider or subject mismatches fail closed.
- Directory roles can be merged into the verified Gateway identity.

For Auth0, `AUTH0_REQUIRE_USER_DIRECTORY=true` enforces the directory gate. When Postgres is the platform state driver, the recommended production default is to require the directory. Memory remains available for local/dev, and `PLATFORM_ALLOWED_USER_EMAILS=ran@gateway.com,admin@gateway.com` can seed an in-memory allowlist. If the memory allowlist is empty, the directory gate stays disabled unless explicitly required. Mock demo login remains available unless configured otherwise with `MOCK_REQUIRE_USER_DIRECTORY=true`; mock demo remains available unless configured otherwise.

Example local seed for an Auth0 user:

```powershell
$env:DATABASE_URL="postgresql://a2a:a2a@localhost:5432/secure_a2a_dev"
$env:DATABASE_SSL="false"
$env:PLATFORM_USER_EMAIL="ran@gateway.com"
$env:PLATFORM_USER_TENANT_ID="default"
$env:PLATFORM_USER_ROLES="it-support,admin"
$env:PLATFORM_USER_DISPLAY_NAME="Ran"
$env:PLATFORM_USER_STATUS="active"
npm.cmd run db:seed-platform-user
```

After seeding, `ran@gateway.com` starts with `provider`, `issuer`, and `subject` unset. The first successful Auth0 login binds those identity fields to that directory row.

### Phase 2.8  Authenticated App Shell / Required Login

The browser UI now starts in an authenticated app shell state. The main control plane is hidden until `GET /identity/session` confirms that Gateway identity is attached to the browser session. While the current identity is being checked, the UI shows only a minimal loading state. Anonymous users see the login screen. Directory-denied users see the safe Access Denied screen.

Auth0 authentication and Gateway access are separate checks. Auth0 login can succeed, but Gateway access is denied unless the local passwordless `users` table has an enabled matching user. `ran@gateway.com` is the first seeded local demo user for Postgres-backed Auth0 testing. Missing, disabled, or mismatched users receive the safe browser copy: `Access denied. Your user is not enabled for this gateway.`

Frontend gating is UX only. The orchestrator still enforces session and identity checks for protected runtime actions, connector onboarding, connector test flows, trust operations, demo environment preparation, and routes that mutate `PlatformStateStore`. Public health, Gateway metadata, and JWKS endpoints remain public where intentionally documented.

The app does not expose raw Auth0 access tokens, JWTs, OAuth callback `code` / `state` / `code_verifier` values, or internal session tokens. Login tokens are not stored in `localStorage`; the frontend only uses the Gateway session cookie and safe public identity response.

Browser session is not authentication. A `/session` cookie only identifies a browser session; protected operational endpoints require attached Gateway identity or an admin API key. In-memory attached identity is not a permanent authorization decision: attached Gateway identity is revalidated against the user directory on protected routes. Disabling a user in the local `users` table invalidates future protected route access and clears the attached session identity. A denied identity attach clears any previously attached Gateway identity for that browser session, preventing stale identity confusion when switching Auth0 users. `/agents/health` requires identity/admin access because it can expose operational state. `/debug/ai-config` is admin/API-key only by default, with any identity-based debug access limited to explicit non-production local override. Health checks do not return upstream response bodies.

### Phase 2.9  Versioned Platform DB Migrations

Platform Postgres schema changes now have a small versioned migration path in `services/orchestrator-api/db/migrations`. `scripts/apply-platform-migrations.ts` applies SQL files in filename order and records each migration in `platform_schema_migrations` with an id, name, SHA-256 checksum, and applied timestamp.

The runner fails closed on checksum mismatch instead of silently accepting edited migration history. Each migration runs in a transaction, and re-running already applied migrations skips files whose stored checksum still matches.

schema.sql remains an idempotent bootstrap/reference schema. `db:apply-platform-schema` is still useful for local reset/bootstrap flows, but migrations are the preferred path for staging and production before enabling `PLATFORM_STATE_STORE_DRIVER=postgres`. Applying `schema.sql` after migrations is not the normal controlled path.

The initial migrations preserve the current safe platform model: tenant-aware users, connector trust, audit events, conversation state, and runtime executions. Existing local DBs that already applied `schema.sql` can run the idempotent migrations safely. The migration set intentionally has no token or password columns and does not add a connected-account token vault.

### Phase 2.10a  Connector Trust Read-Through / Rehydration

Connector trust records are persisted through `PlatformStateStore` and can now be read back into the orchestrator runtime mirror after restart. The runtime mirror can rehydrate from the store after restart. Request paths that list installed connectors, prepare demo connectors, or route `/resolve` use async read-through from the store when the process-local mirror is empty.

Rehydrated connector trust records are safe metadata records and use `runtimeTrustSource: "stored_metadata"`. Stored metadata can show installed connector state, support routing, and preserve connector identity, resource system, connector profile metadata, approved actions, and blocked actions without requiring raw owner/session keys or raw token material.

Rehydration does not make a connector automatically executable. Stored connector records remain metadata-only unless a future safe runtime revalidation path proves current executable trust. Stored metadata cannot execute runtime until fresh runtime validation or re-onboarding occurs. Live onboarding remains the path that can enable runtime execution. The runtime execution still requires policy, approved skill, runtime allowlist, scoped JWT, and current Gateway user identity. Memory mode remains available for local/demo use and remains compatible with the same read-through API.

### Phase 2.10b  Postgres Restart-Survival Smoke

Postgres restart survival is verified through store recreation / simulated process restart in `verify:postgres-restart-survival`. Static checks always run. The integration write smoke runs only when `DATABASE_URL` is set and `POSTGRES_RESTART_SMOKE_ALLOW_WRITE=true`.

The smoke writes safe synthetic records and then recreates the `PlatformStateStore` singleton before reading them back. It verifies connector trust metadata, audit events, conversation snapshots, and user directory records survive at the Postgres store layer.

Connector trust metadata survives restart as restart-surviving metadata, but rehydrated connector trust remains metadata-only. Runtime execution after restart still requires fresh runtime validation or re-onboarding before a persisted connector can execute. The smoke does not store raw tokens, raw prompts, passwords, password hashes, raw owner keys, or secrets.

### Phase 2.11  Ogen Policy Engine Boundary

Ogen now has a formal, explainable, versioned policy engine boundary. AI interpretation is advisory, not authoritative: normalized AI/fallback interpretation can inform policy input, but it cannot authorize an action. Connector profiles remain contracts, user identity is the subject, policy is the authority, and audit is the proof.

Policy is deny-by-default. Each decision has a policy version, decision ID, matched rule IDs, input hash, safe input summary, and default-deny proof. The invariant is: policy decisions are audit proof and are carried in safe runtime evidence without raw prompts, raw tokens, Authorization headers, or secrets.

The runtime rule is: metadata-only connector trust cannot execute runtime. Write, high-risk, sensitive, or explicitly approval-marked actions require governed approval. Read-only connector runtime execution requires an approved connector route, external runtime availability, current user identity, connector runtime allowlist, scoped JWT issuance, and an allow decision from policy. Future tenant-scoped policy storage will move rule definitions into Postgres without changing the policy decision proof shape.

Runtime execution requires explicit runtime availability. Runtime execution requires explicit action execution type. Runtime execution requires explicit risk classification. Missing action/risk metadata fails closed. Approved connector route alone is not enough to allow runtime execution.

Known reference connector skills carry explicit deterministic action safety metadata. Ogen may use reference catalog metadata as fallback only for known reference skills. Unknown or incomplete actions still fail closed. Ogen does not infer safety from natural language or AI output.

Ogen separates mandatory platform guardrails from tenant/configurable policy rules. Tenant policies can restrict further but cannot override core Ogen safety guardrails. Metadata-only runtime, missing runtime availability, missing action/risk metadata, low confidence interpretation, and approval-required actions are platform-level guardrails. Decision proof records matched guardrail rules and matched tenant rules separately.

Mandatory Ogen guardrails are immutable runtime definitions. Tenant policies can be dynamic, but platform safety guardrails are frozen and cannot be mutated by policy loading. Policy evaluation does not mutate tenant rule inputs.

Ogen rule IDs for mandatory guardrails and default-deny are reserved. Tenant policies cannot redefine reserved Ogen rule IDs. Default-deny proof always uses the canonical Ogen default deny rule.

Policy decisions include explainable matched rule summaries. Ogen reports whether a decision came from a mandatory guardrail, tenant rule, or default deny. Policy reasons are human-readable and audit-safe. Rule summaries never include raw prompt or token material.

Every policy decision has complete proof. Default-deny decisions always include a default rule summary, even when custom tenant rules omit a default-deny rule. Role requirement failures identify the exact guardrail or tenant policy rule that required the missing role.

### Phase 2.12  AI Interpretation Trust Boundary

AI interpretation is advisory, not authoritative. Ogen policy is the authority. AI can classify, normalize, and extract request signals, but AI output cannot grant scopes, approve connector execution, bypass guardrails, or authorize runtime.

Every interpretation proof has an ID, schema version, input hash, and output hash. Raw prompts and raw AI responses are not stored. Audit stores safe proof only: interpretation ID, schema, source, provider/model when safe, input/output hashes, confidence, advisory-only status, and no-raw-prompt/no-raw-AI-response flags.

Interpretation risks are captured as safe metadata. Prompt injection attempts, policy bypass language, token/secret requests, unsupported scope, and low confidence are tracked without storing raw prompt text. Unsafe interpretation risk blocks runtime execution through mandatory Ogen guardrails. Low confidence interpretation cannot authorize runtime.

### Phase 2.12a  AI Routing Trust Boundary

Secondary AI routing is advisory only. AI routing can suggest selected agents, skipped agents, routing status, confidence, and reasoning, but AI routing cannot authorize runtime. Ogen validates routing output, then Ogen policy and runtime gates remain authoritative for execution.

Every AI routing proof records source, validation status, selected/skipped agent IDs, routing status, routing confidence, input hash, and output hash. Raw prompts and raw AI routing responses are not stored. The proof always records `advisoryOnly: true` and `authorizedRuntime: false`.

Routing proof makes validation explicit: rules fallback is marked as rules fallback, missing AI config is marked not configured, empty AI output is marked empty response, failed validation is marked failed, AI errors are marked ai error, and validated secondary AI routing is marked passed. Audit stores safe routing proof only.

AI routing proof hashes the safe routing input context, not only the message. The safe context includes interpretation proof reference and agent card IDs/skill IDs. Raw prompts and raw agent card text are not stored.

Secondary AI routing receives a safe Agent Card routing view, not full Agent Cards. The safe view excludes endpoint/auth/description/secret-like metadata. Routing proof binds agent-to-skill mappings through agentSkillPairs. The routing proof hashes the safe routing view.

### Phase 2.13  SDK Readiness Contracts

No SDK implementation is built in this phase. SDK readiness contracts are defined now to avoid future rewrites of connector profiles, action metadata, safe routing views, runtime responses, policy proof, or AI proof boundaries.

The future connector SDK will generate connector profiles, safe routing views, runtime response contracts, and certification checks. Ogen policy remains strict; SDK makes metadata complete. Missing risk or execution metadata still fails closed, and the SDK contract makes explicit metadata the connector author's responsibility.

### Phase 2.14  Fastify API Contract Boundary

startJsonServer remains available for current V1/V2 behavior and mock agents. Fastify is introduced as a gradual schema-first HTTP boundary, not a backend rewrite.

Only public metadata/health routes are migrated initially. Future protected APIs will migrate route by route. This preserves Auth0, user directory, policy, runtime safety, and audit proof behavior while preparing Ogen for OpenAPI and SDK generation.

Node.js >= 20 is required. Fastify mode is public-metadata-only for now. startJsonServer remains the default full application server.

### Phase 2.15  Runtime Authorization Decision API

`POST /runtime/authorize` is an authorization-only API for agent actions. It evaluates Ogen policy, returns policy decision proof, and requires a fresh identity session through the User Directory Access Gate. `request.actor` is optional context only; the verified identity session is authoritative for authorization.

The endpoint does not execute runtime, does not issue a runtime token, and does not call an external connector runtime. It is intended for future SDK, MCP proxy, and external agent flows that need to ask Ogen whether an action is allowed before using a separate execution path.

### Phase 2.16  Browser Session CSRF Guard

Browser-session POST routes require the `x-ogen-csrf-token` header. `POST /session` bootstraps the browser session and issues the readable CSRF cookie, so it does not require CSRF itself. Internal API-key/service-token calls can bypass CSRF only when the configured secret matches. Authorization bearer alone does not bypass CSRF. GET/public routes do not require CSRF.

CSRF tokens are signed and session-bound. A token for one browser session cannot be reused for another browser session, and CSRF tokens expire. The readable CSRF cookie follows cross-site session cookie settings so Vercel-to-Railway browser sessions can send both cookies on credentialed POSTs. Internal service/API-key bypass remains available for trusted non-browser flows.

### Phase 2.17  Tenant Resolution Boundary

tenantId is resolved by Ogen. client-supplied tenantId is a hint, not authority. Current local/default mode supports the configured default tenant, while Auth0 org/domain mapping can resolve tenant context from verified identity. policy, audit, user directory, connector trust, and runtime authorization should use the resolved tenant.

Auth0 organization claims such as `org_id` or `organization` must survive verified identity mapping so tenant resolution can use them as the authoritative tenant context without exposing raw JWT material to the browser.

Malformed tenant and conversation hints fail safely instead of crashing request handling or entering conversation state. Tenant switching attempts through `/resolve` and `/runtime/authorize` are audited as tenant access denied with tenant resolution metadata and without raw prompts or token material. `/runtime/authorize` emits `tenant.access.denied` before gateway RBAC or runtime policy evaluation when the requested tenant is not accepted.

Tenant denial audit records only validated string identifiers. Tenant access denials are exported as blocked security events.

### Phase 2.18  Gateway RBAC / ABAC Boundary

Gateway operations are protected by role/capability checks. Roles come from verified user directory identity, not request body, caller-supplied actor context, or SDK-provided role hints.

RBAC is tenant-aware: gateway authorization decisions include the Ogen-resolved tenant context and fail closed when the verified identity lacks a required role for the requested capability. Connector runtime action policy remains separate from gateway RBAC; Ogen Policy Engine still decides whether a connector/runtime action is allowed, blocked, or approval-required.

Connector onboarding read is a read-only bootstrap and inventory capability. UI bootstrap reads for installed connector state and supported connector readiness are available to roles that can otherwise use the gateway, including the default demo `it-support` role; connector onboarding discover and start remain admin capabilities restricted to connector, gateway, tenant, or platform admins.

Mock demo role labels are mapped to canonical GatewayRole values before they become verified session roles: `read-only` maps to `security_viewer`, and `identity-admin` maps to `admin`. Alias labels are not gateway roles and do not authorize capabilities directly.

Denied gateway authorization is audited with safe decision proof and exported as a blocked security event. Audit metadata includes capability, route, method, required roles, actor roles, matched role, and decision reason, without raw prompts or token material.

### Phase 2.19  Persisted Audit Viewer (MVP)

GET `/audit/events` exposes a tenant-scoped persisted audit viewer for browser session users with the `audit.read` Gateway capability. The route requires a fresh verified identity session and user-directory roles. Client-supplied tenantId is accepted only as a hint for Ogen tenant resolution; the query uses the resolved tenant and denies tenant switching attempts before listing stored events.

The response is a schema-first projection of stored audit events: time, event type, outcome, severity, actor provider/email, resolved tenant, route/capability summary, resource summary, and safe correlation IDs. It supports cursor/limit pagination plus optional `eventType`, `outcome`, `severity`, `from`, `to`, and safe `conversationId` filters. Cursor pagination uses deterministic `createdAt desc, id desc` ordering and embeds a snapshot ceiling so later audit writes do not shift an already-open result window. Outcome/severity filters use the Ogen-materialized classification index before pagination when the store exposes it; the bounded ordered scan remains only as a compatibility fallback for stores that have not implemented the indexed read model. It returns no raw prompt, token, secret, or stored metadata payload.

Audit classification stays consistent with the export boundary. Blocked events remain blocked in the viewer, and tenant.access.denied remains blocked with warning-or-higher severity. The UI adds a read-only persisted audit table inside Security Timeline; per-capability 403s remain local to that panel instead of changing account access state.

### Phase 2.19b  Audit Viewer Scale & Operability Hardening

The bounded-scan audit viewer behavior is intentionally retained as a safe compatibility fallback for derived `outcome` and `severity` filters when a store has not implemented the classification index contract. These classifications are Gateway-derived from event type and safe event metadata, not client-provided authority. The fallback scans deterministic `createdAt desc, id desc` source batches inside the cursor snapshot until it finds `limit + 1` matching projected events or exhausts the source window.

If a sparse derived filter reaches the bounded scan limit first, `GET /audit/events` returns `422 audit_events_filter_scan_limit_exceeded`. The error response includes operator-safe diagnostics only: source rows scanned, scan limit, matched row count, requested limit, an applied-filter hash, a boolean filter summary, and the current classification strategy. It does not return stored `safe_metadata`, raw prompts, tokens, secrets, actor subject, Authorization headers, cookies, JWTs, private keys, client assertions, or client secrets. Operators should narrow sparse queries with a time range, event type, conversation ID, or smaller page limit before retrying.

The forward scale path is now implemented for the built-in stores as a persisted Gateway classification index: materialized outcome/severity columns or an equivalent tenant-scoped read model keyed by `(tenant_id, outcome, severity, created_at desc, id desc)`. The materialized values are produced by Ogen-controlled classification logic at write time and migration time, not by AI interpretation or client-supplied fields. It preserves the same cursor snapshot semantics, tenant isolation, `audit.read` RBAC, and no-secrets projection boundary.

### Phase 2.19c  Indexed Audit Read Model for Outcome/Severity Filters

Phase 2.19c replaces the normal deep bounded scan path for `outcome` and `severity` filters with an indexed audit read model. `StoredAuditEvent` now carries Ogen-materialized outcome/severity values, and `PlatformStateStore` exposes `listAuditEventsByClassification` for cursor pagination over those fields. The memory store materializes classifications on append for local/test parity. The Postgres store writes materialized classifications on insert, backfills existing audit rows through the published `004_audit_event_classification_index.sql`, and uses composite indexes for tenant-scoped `created_at desc, id desc` pagination by outcome, severity, or both.

The fallback bounded scan remains available only for custom stores that do not expose `listAuditEventsByClassification`; if that fallback reaches the bounded limit, it still returns `422 audit_events_filter_scan_limit_exceeded` with operator-safe diagnostics. The indexed path keeps the cursor contract unchanged: request `{ cursor?, limit, filters... }`, response `{ items, hasNext, nextCursor? }`, deterministic `createdAt desc, id desc` ordering, and a snapshot ceiling that excludes newer audit writes from an already-open result window.

Trust boundaries remain unchanged. The classification index is produced by Ogen policy/classification code, never by AI interpretation or client-supplied classification fields. Reads remain scoped to the resolved tenant and require `audit.read` based on verified identity roles. The response projection and any structured errors continue to exclude raw prompts, tokens, secrets, actor subject, Authorization headers, cookies, JWTs, private keys, client assertions, client secrets, and stored metadata payloads.

Phase 2.19c rolling-safe rollout:

- Step A: restore the `004_audit_event_classification_index.sql` file baseline if any deployment artifact contains the rewritten copy, then run the forward expand migration `005_audit_event_classification_rolling_safety.sql` through the normal migration runner. The forward migration handles databases where `004` already added `outcome`/`severity` and enforced `NOT NULL`, databases where those columns are nullable, and databases where the compatibility trigger already exists.
- Step B: deploy the new app version. Old app instances that omit `outcome`/`severity` continue to write audit rows because the DB trigger fills them; new app instances write explicit Ogen-derived classifications.
- Step C: validate no null classifications remain and backfill complete with `select count(*) from audit_events where outcome is null or severity is null;` and run the audit viewer verification before contract enforcement.
- Step D: run the contract migration `services/orchestrator-api/db/contract-migrations/006_audit_event_classification_contract.sql` only after all app instances are upgraded and Step C returns zero rows. This is the later `NOT NULL` enforcement step and is intentionally outside the default migration runner path.

If an environment reports `Checksum mismatch for platform migration 004`, treat that as a migration lineage issue, not as a data migration failure. Restore the `004` file baseline in the deployment artifact, keep the forward `005` migration, and rerun the normal migration runner.

Validation SQL:

```sql
select count(*) from audit_events where outcome is null or severity is null;

select conname, convalidated
from pg_constraint
where conrelid = 'audit_events'::regclass
  and conname in ('audit_events_outcome_check', 'audit_events_severity_check');

select attname, attnotnull
from pg_attribute
where attrelid = 'audit_events'::regclass
  and attname in ('outcome', 'severity');
```

### Phase 2.19d  Audit Index Rollout Operational Hardening

Large audit tables should treat classification indexes as an operator-controlled rollout, not a surprise lock during normal app deploy. The expand/upgrade/validate/contract sequence remains authoritative, and the deployment runbook is state-gated: confirm schema state first, run the expansion step before index DDL when `outcome`/`severity` columns are missing, and create the four classification indexes with `CREATE INDEX CONCURRENTLY IF NOT EXISTS` only when the columns exist and equivalent indexes are absent.

Concurrent index rollout guidance:

- Run in an explicit database operator session because `CREATE INDEX CONCURRENTLY` cannot run inside the migration runner transaction.
- Prefer a quiet window and monitor `pg_stat_progress_create_index`, `pg_locks`, write latency, and database CPU/IO while each index builds.
- If `004` already created the indexes non-concurrently, skip the concurrent index commands as redundant and continue with the upgrade/validate/contract (`006`) sequence.
- Build one index at a time for very large tables: `audit_events_tenant_created_at_id_idx`, `audit_events_tenant_outcome_created_at_id_idx`, `audit_events_tenant_severity_created_at_id_idx`, and `audit_events_tenant_outcome_severity_created_at_id_idx`.
- Validate before and after with `select count(*) from audit_events where outcome is null or severity is null;`, `select indexname from pg_indexes where tablename = 'audit_events';`, and a tenant-scoped filtered query ordered by `created_at desc, id desc`.
- Keep the normal migration lineage intact. Do not edit published migrations to add concurrent DDL; use forward migrations or operator-run SQL documented in the deployment runbook.

Example operator SQL:

```sql
create index concurrently if not exists audit_events_tenant_created_at_id_idx
  on audit_events (tenant_id, created_at desc, id desc);

create index concurrently if not exists audit_events_tenant_outcome_created_at_id_idx
  on audit_events (tenant_id, outcome, created_at desc, id desc);

create index concurrently if not exists audit_events_tenant_severity_created_at_id_idx
  on audit_events (tenant_id, severity, created_at desc, id desc);

create index concurrently if not exists audit_events_tenant_outcome_severity_created_at_id_idx
  on audit_events (tenant_id, outcome, severity, created_at desc, id desc);
```

### Phase 2.20a  A2A 1.0 Protocol Compatibility Layer

Phase 2.20a is a compatibility layer, not a replacement of Ogen's task model and not an adoption of the official JavaScript SDK yet. The internal `A2ATask`, connector policy, tenant resolution, scoped JWT issuance, and audit boundaries remain Ogen-owned. The compatibility surface adds protocol identifiers and headers so external A2A-capable runtimes can interoperate while Ogen continues to govern execution.

Discovery compatibility:

- Local agents that expose `GET /agent-card` also expose `GET /.well-known/agent-card.json` with the same safe Agent Card payload.
- `/agent-card` remains a legacy alias for local development and existing clients.
- Shared protocol constants define `A2A_PROTOCOL_VERSION = "1.0"`, `A2A_VERSION_HEADER = "A2A-Version"`, `A2A_CONTENT_TYPE = "application/a2a+json"`, and `A2A_AGENT_CARD_WELL_KNOWN_PATH = "/.well-known/agent-card.json"`.

Version and media handling:

- Outbound A2A task, discovery, onboarding, and connector-runtime calls send `A2A-Version: 1.0` and `Accept: application/a2a+json`; requests with bodies send `Content-Type: application/a2a+json`.
- Missing inbound `A2A-Version` stays allowed for legacy/internal clients.
- Explicit `A2A-Version: 1.0` is allowed.
- Any other explicit version returns `unsupported_a2a_version` with `taskExecuted: false`; it does not execute a task or expose prompts, tokens, secrets, Authorization headers, private keys, client assertions, or protected metadata.

Governance does not move into protocol metadata. Ogen policy remains authority, verified identity and Gateway RBAC remain authority, client tenant hints remain hints only, and `/runtime/authorize` remains authorization-only and does not execute runtime.

### Phase 2.20b  A2A Message/Task Adapter

Phase 2.20b adds a narrow A2A Message/Task adapter layer only. Ogen remains the governance authority: the internal `A2ATask`, tenant resolution, Gateway RBAC, scoped JWT validation, policy evaluation, runtime authorization, and audit boundaries remain the execution model. This phase does not add `@a2a-js/sdk`, does not replace Ogen contracts, and does not implement the full official Message/Task operation set.

Adapter mapping rules:

- Inbound compatibility envelopes use the explicit subset `kind: "message"`, `role: "user"`, and text `parts`.
- The first non-empty text part maps deterministically to `ResolveRequest.message` at `/resolve` or `A2ATask.userMessage` at `/task`.
- `messageId`, `taskId`, `contextId`, and safe `conversationId` metadata are preserved only as conversation/task correlation IDs.
- Safe metadata fields such as `classification`, `skillId`, `fromAgent`, `toAgent`, `requestedScope`, and `contextHints` can become internal task context hints for direct `/task` execution.
- `classification` metadata is optional for direct `/task` compatibility messages. When it is absent, the adapter synthesizes a non-authoritative `UNKNOWN` fallback classification so existing agents can keep using their internal `A2ATask` shape without treating protocol metadata as policy authority.
- Protocol metadata is never tenant, role, policy, authorization, or audit authority. Client tenant hints in compatibility envelopes are ignored by `/resolve`; the verified Gateway session remains authoritative.
- Adapter proof/output must report `protocolMetadataAuthoritative: false`, `protectedMaterialExposed: false`, `tokenMaterialStored: false`, and `rawPromptStored: false`.

Boundary behavior:

- Legacy internal `/resolve` and `/task` payloads continue to work unchanged.
- Compatibility envelopes are normalized before policy/execution and before local agent runtime handling.
- Malformed or unsupported compatibility envelopes return `invalid_a2a_envelope` with `taskExecuted: false`; they do not run downstream policy/runtime work and do not expose raw prompts, tokens, secrets, Authorization headers, private keys, client assertions, or protected metadata.
- Inbound Task envelopes are accepted only when `status.state` is in the supported subset and `status.message.parts` contains valid text part shapes. Unsupported states such as `canceled` are rejected safely instead of being mapped to success.
- A valid inbound Task envelope with `status.state: "completed"` maps to the resolver's diagnostic success path; `failed`, `rejected`, `submitted`, and `working` remain non-success states.
- Internal responses can be wrapped as compatibility `kind: "task"` envelopes when the request used the compatibility envelope path.
- Full official Message/Task operations `list`, `get`, `cancel`, and `subscribe` are deferred to a later provider implementation.

### Phase 2.21  Signed Agent Card Provenance

Phase 2.21 adds signed Agent Card provenance as an informational-first integrity and trust metadata layer. Discovery responses from `GET /agent-card` and `GET /.well-known/agent-card.json` include a safe `provenance` block with `issuer`, `kid`, `alg`, `signedAt`, `expiresAt`, `verificationStatus`, `verificationReason`, `signaturePresent`, and a deterministic canonical payload hash. Missing local signatures are marked `not_configured`; signature-present cards without a configured trust anchor are `unverified`; configured verification can produce `verified`, `expired`, `invalid`, or `error`.

Signed Agent Card provenance is advisory only in this phase; signed Agent Card provenance is advisory only even when a configured verifier marks it `verified`. It improves operator visibility into card origin and payload integrity, but authorization remains Ogen policy, verified identity, tenant resolution, and Gateway RBAC. Runtime authorization, scoped JWT audience/scope/delegation checks, connector policy, and audit decisions do not grant or deny access based solely on `verificationStatus`.

Safety rules:

- Provenance output never exposes private keys, raw tokens, raw prompts, Authorization headers, client assertions, secrets, or protected metadata.
- Verification failures are explicit and non-crashing; invalid, expired, missing, or verifier-error states remain safe discovery metadata.
- The canonical payload hash excludes the provenance/signature envelope itself so operators can compare the signed Agent Card body deterministically.
- Key rotation and trust-anchor rollout remain future operational work; optional policy consumption of verified provenance is deferred until explicit tenant trust-anchor policy exists.

### Phase 2.22  Generic Action Taxonomy & Policy Conditions

Phase 2.22 introduces a vendor-neutral action taxonomy and generic policy condition foundation. Vendor-specific tools normalize to Ogen action categories such as `business_object.read`, `business_object.create`, `diagnose`, `permission.inspect`, and `permission.grant`, then Ogen policy evaluates the normalized action metadata with tenant, verified identity, connector trust, runtime mode, and resource context.

OAuth scopes do not equal Ogen action permission. A broad vendor scope can prove a connected account may call an API, but Ogen still decides whether this user, tenant, connector, resource, action category, risk level, execution type, sensitivity, field class, and constraint set is allowed now.

Approval is a policy outcome, not automatic for every write. Existing compatibility fields `riskLevel`, `executionType`, `requiresApproval`, and `sensitivity` remain in place and missing risk/execution metadata still fails closed. New executable connector metadata can also carry `actionCategory`, `approvalMode`, `resourceSensitivity`, `fieldClasses`, `actionConstraints`, `requiredApplicationGrants`, `requiredEffectivePermissions`, `provider`, and `resourceSystem`. Ogen runtime policy validates taxonomy values at runtime and does not rely on TypeScript declarations or caller-provided shape alone.

Missing normalized action metadata fails certification for future external executable connectors. Executable external runtime actions must carry complete and valid taxonomy metadata before any default allow path can apply: `actionCategory`, `approvalMode`, `resourceSensitivity`, explicit `fieldClasses`, and explicit `actionConstraints`. `fieldClasses: []` and `actionConstraints: {}` are valid explicit declarations; unknown category, mode, sensitivity, field class, constraint key, or malformed constraint value fails closed. Current known reference connector skills may use deterministic reference catalog metadata as a compatibility fallback only when that metadata is complete; unknown or incomplete external actions are not treated as safe and future SDK/certification readiness marks missing taxonomy fields as incomplete.

`approvalMode` is enforced by mandatory Ogen policy outcomes. `blocked` blocks, `always` requires approval, `policy` continues to tenant/default policy evaluation, and `never` adds no approval requirement by itself while remaining subject to all guardrails. The legacy `requiresApproval` flag remains a compatibility signal but cannot override stricter normalized approval mode.

Resource-scoped policy matches use the trusted connector route/resource context, not caller-supplied action metadata. If an action body includes `resourceSystem` and it conflicts with the routed/resource system, Ogen fails closed before tenant allow rules are evaluated and records the trusted resource system in the policy proof.

Signed Agent Card provenance remains advisory only. It can describe card integrity, but it is not tenant, role, policy, authorization, runtime, or audit authority.

### Phase 3  Connector SDK

Goal: prove this is a platform, not a hardcoded Jira/ServiceNow/GitHub demo.

Future package:

```text
packages/connector-sdk
```

Expected SDK capabilities:

- `createConnectorAgent()`
- `defineConnectorProfile()`
- `defineSkill()`
- `defineRuntimeHandler()`
- discovery document builder
- JWKS support
- signed onboarding response helper
- runtime JWT validation helper
- end-user answer helper
- secret redaction helper

Future acceptance criteria:

- current `real-external-agent` can use the SDK
- at least one new connector example can be onboarded without changing Gateway core
- Gateway routing relies on connector profile/capabilities, not connector-specific hardcoding

### Phase 3.5  Real ServiceNow External Agent Adapter

Goal: make the ServiceNow adapter the flagship SDK proof.

This phase proves the platform can govern a real enterprise integration, not only reference mock connectors. The adapter should be built with the Connector SDK, speak Secure A2A to the Gateway, and speak ServiceNow REST/OAuth to a real ServiceNow instance.

ServiceNow itself does not need to support A2A. The external adapter implements the A2A contract with the Gateway and uses ServiceNow REST/OAuth behind the scenes.

Architecture:

```text
Vercel UI
  Secure A2A Gateway / Orchestrator
    signed onboarding + scoped runtime A2A JWT
      External ServiceNow Agent Adapter
        OAuth / REST
          ServiceNow Instance
```

Initial V2 capabilities should be read-only or low-risk:

- `servicenow.incident.read`
- `servicenow.incident.search`
- `servicenow.user.lookup`
- `servicenow.cmdb.ci.lookup`

Optional controlled write:

- `servicenow.incident.add_work_note`
- disabled by default
- requires human approval
- never enabled as casual autonomous write execution

Do not include initially:

- delete records
- grant roles
- update ACLs
- approve catalog requests
- close incidents/changes automatically
- bulk updates
- admin operations

Adapter environment shape:

```env
SERVICENOW_INSTANCE_URL=https://<instance>.service-now.com
SERVICENOW_AUTH_METHOD=oauth_client_credentials
SERVICENOW_CLIENT_ID=<servicenow-client-id>
SERVICENOW_CLIENT_SECRET=<servicenow-client-secret>
SERVICENOW_MAX_RESULT_RECORDS=10
SERVICENOW_ALLOW_WRITE_ACTIONS=false
SERVICENOW_REQUIRE_APPROVAL_FOR_WRITE=true
```

Security principles:

- ServiceNow credentials live only in the external adapter, never in Gateway or Vercel.
- Gateway still controls onboarding, trust, scoped A2A JWTs, runtime allowlists, policy, and audit proof.
- Adapter validates A2A runtime JWT before calling ServiceNow.
- Adapter enforces action-level scope checks.
- Adapter returns safe end-user answers and redacts ServiceNow secrets/tokens.

Acceptance criteria:

- Real ServiceNow adapter can onboard through signed Gateway challenge.
- Adapter exposes `.well-known/a2a-agent.json`, JWKS, connector profile, onboarding challenge, `/a2a/task`, and `/health`.
- Gateway can issue scoped runtime token for a ServiceNow read action.
- Adapter validates token and calls a real ServiceNow REST API.
- Gateway shows `tokenIssued=true`, runtime executed, and persisted/safe audit proof.
- ServiceNow read-only flow works without changing Gateway core.
- Any write action remains disabled by default or requires approval.

### Phase 4  Governed Chat Engine

Goal: turn the conversation layer into a deterministic state machine around AI interpretation.

Future module:

```text
services/orchestrator-api/src/chat-engine/
```

or:

```text
packages/chat-engine
```

Core precedence rules:

- Security/adversarial guard wins first.
- Explicit entity in current user message wins over previous context.
- Pending interaction resolution applies only when relation is clear.
- Connector runtime success wins over out-of-scope fallback.
- Access request routes by fulfillment capability.
- Needs-more-info only when no explicit unsafe/security intent exists.
- Unsupported only when no supported route/runtime/fulfillment exists.

This phase should prevent regressions such as:

- ServiceNow ticket carryover
- FIN-42 returning out-of-scope despite runtime success
- PR 42 returning out-of-scope despite runtime success
- admin bypass becoming NeedsMoreInfo
- target-selection accepting arbitrary questions as a target

### Phase 5  Policy And Audit Maturity

Goal: make proof/audit a persistent governance artifact.

Future audit events:

- user login
- connector discovery
- connector onboarding
- policy decision
- token issued
- runtime executed
- runtime blocked
- secret/token request blocked
- admin/debug attempt blocked
- connector revoked/disabled

Security Timeline should eventually read persisted audit events, not only latest response state.

### Phase 6  CI, Playwright, Production Smoke

Goal: move from manual verification to professional repo discipline.

Future additions:

- GitHub Actions
- Playwright browser smoke tests
- production smoke script

Critical browser smoke flows:

- app loads
- mock/Auth0 login works
- ServiceNow ticket lookup
- Jira issue lookup
- GitHub PR lookup
- access request routes to ServiceNow fulfillment
- raw token request blocked
- Agent Registry layout not broken
- connector onboarding works

### Phase 7  Presentation Polish

Goal: prepare for LinkedIn / portfolio launch.

Deliverables:

- architecture diagram
- sequence diagram
- demo video / GIF
- README rewrite
- Demo Guide rewrite
- What V2 proves
- What is intentionally not included

## Non-Goals

V2 should not include:

- real Jira API writes
- autonomous/high-risk ServiceNow writes
- real GitHub writes
- shared admin/developer OAuth tokens for user-delegated external app actions
- 20 connectors
- marketplace
- billing
- full SaaS RBAC
- SOC2
- SAML/SCIM
- complex policy language
- Kubernetes
- replacing all backend services with another stack
- rewriting everything from scratch

Real ServiceNow read-only adapter is V2 scope. Real ServiceNow writes such as `servicenow.incident.add_work_note` may be documented as optional controlled/approval-gated exploration, not default execution. Autonomous/high-risk ServiceNow writes are not V2 scope.

## Security Remediation Gate after Codex Security scan

P0 items for this checkpoint:

- session-bound conversations
- runtime token/JWT response redaction
- server-derived A2A required scopes
- connector risk/approval enforcement
- Agent Card / health check SSRF hardening

P1 findings:

- fixed: plan-only runtime requests bypass A2A authentication. Runtime-facing plan-only calls now require scoped A2A JWT validation before action plans are returned.
- fixed: runtime config oracle before JWT validation. External runtime token validation now happens before trusted config and connector access evaluation responses.
- fixed: external agent accepts under-validated A2A JWTs. Runtime JWT validation requires issuer, audience, expiration/signature, required scope, `sub`, `client_id`, `jti`, and actor provenance when task actor context is present.
- fixed: delegation JWT claims are not bound to task context. Delegated claims such as `parent_task_id`, `requested_by_agent`, `delegated_by`, depth, and actor context are checked against the submitted A2A task.
  Binding semantics: task-side delegation context requires matching JWT delegation claims. `delegated_by` represents the upstream requesting agent and must match the delegated task `fromAgent` or `requestedByAgent`; `requested_by_agent` must be present and match `task.requestedByAgent`; `parent_task_id` must be present and match `task.parentTaskId`; `delegation_depth` must be present and match `task.delegationDepth`. `mediatedBy` represents the Gateway/orchestrator mediator and is not bound unless a future explicit mediator JWT claim is added.
- fixed: mock IdP mints tokens for arbitrary audiences. Token audience must be in the registered A2A resource registry, and requested scopes must be allowed for that audience.
- fixed: spoofable proxy headers bypass Mock IdP IP allowlist. Proxy headers are ignored unless Mock IdP trusted proxy mode is explicitly enabled.
- fixed: trust status endpoint leaks configured JWKS URLs. Production trust status redacts full JWKS URLs for non-admin session callers.
- partially fixed: public demo token endpoint / mock IdP production hardening. Demo token and debug endpoints require internal/demo access gates; future work should disable demo login entirely for non-demo deployments.
- fixed: upstream agent error bodies leak through `/resolve`. Runtime and action-plan responses are normalized through token-aware sanitizers and generic upstream failure messages.
- fixed: ServiceNow ticket lookup leaks record existence. Missing and unauthorized tickets now return the same safe user-facing response.
- partially fixed: connector record access inferred from email prefixes. Current behavior is documented as demo fixture role hints only; real ACL integration remains future hardening.

P2 findings:

- pending: AI-derived capability is logged without sanitization.
- pending: Agent Card support hints bypass delegation policy.
- fixed: onboarding fetch errors leak network details. Onboarding fetch errors use safe generic messages.
- partially fixed: read-only connector answers can claim changes were made. Current end-user answers state no changes for reference read flows; broader connector answer attestation remains future hardening.
- pending: connector answer can spoof governed change results.
- pending: divergent skills bypass onboarding action review.
- pending: untrusted connector profiles can approve unauthorized actions.
- partially fixed: token-not-issued state is shown as successful. P0 connector policy paths avoid issuing runtime tokens for blocked/approval-required execution; UI polish remains future hardening.
- pending: malformed agent trace can crash Security Timeline UI.
- future hardening: replay verification can leak access tokens in logs.
- fixed: debug AI config endpoint exposed via self-issued sessions. Debug AI config is admin/API-key only by default; the optional identity-based diagnostic override is explicit and non-production only.
- pending: malformed Agent Card scope can crash routing.
- pending: composer clears messages that were not accepted.

## Architecture Principles

- Do not trust agent-declared metadata by itself.
- Discovery is public, but trust is earned through signed challenge and signed response.
- Runtime execution requires an installed connector, approved skill, required application grants, required effective permissions, runtime origin allowlist, and scoped A2A JWT.
- External agents own domain-specific runtime behavior.
- Gateway owns trust, identity, policy, scoped token issuance, runtime endpoint validation, and audit proof.
- Connector profiles and Agent Cards are contracts; they are not authorization.
- New connectors should not require Gateway core rewrites.
- V1 local in-memory mode should remain available for fast development while V2 adds persistent state.

## Security Principles

- Raw tokens are never displayed.
- Browser never receives internal service tokens.
- External adapters must not use one shared admin/developer OAuth token for all users.
- User-delegated external application authorization must use per-user connected accounts when the vendor action requires user OAuth.
- Public `.well-known/*` metadata is okay.
- `/admin` and debug endpoints must remain disabled or token-protected in production.
- Browser session is not authentication; protected operational endpoints require attached Gateway identity or admin/API-key access.
- In-memory attached identity is not a permanent authorization decision; protected routes revalidate Gateway identity against the local user directory.
- A denied identity attach clears any previously attached Gateway identity for that browser session.
- Health checks must not echo upstream response bodies.
- Onboarding URL allowlist protects against SSRF.
- Runtime URL allowlist protects against untrusted runtime execution.
- `private_key_jwt` remains preferred over `client_secret_post`.
- User identity claims must be issuer/audience/signature/expiry validated before policy or audit use.
- Audit events must store safe metadata only, not raw JWTs, Authorization headers, private keys, client assertions, or secrets.

## Definition Of Done

V2 foundation is done when:

- V1 remains verifiable through `npm run verify:v1`.
- Real user identity is pluggable and Auth0-backed without removing Reference A2A Token Issuer runtime flows.
- Installed connectors and audit proof persist across orchestrator restarts.
- Connected Accounts / User Delegated OAuth contracts exist for external applications that require per-user authorization.
- Connector SDK can express the existing reference connector contract.
- Real ServiceNow read-only adapter exists or is documented as the flagship SDK adapter target.
- ServiceNow secrets are isolated to the adapter.
- Gateway core does not change for ServiceNow-specific API logic.
- At least one new connector can be onboarded without changing Gateway core.
- Governed chat precedence rules are encoded in tests.
- Browser smoke tests cover the core production demo path.
- Deployment docs reflect the actual Vercel/Railway/Upstash/OpenRouter architecture.

## Suggested Implementation Order

1. Keep Phase 0 branch hygiene and verification discipline strict.
2. Add identity provider abstraction before Auth0-specific code.
3. Add persistence abstractions and schemas before migrating runtime state.
4. Define the SecurityEventSink export boundary after audit and conversation state are shaped.
5. Define Connected Accounts / User Delegated OAuth contracts before real write-capable adapters.
6. Move audit events into durable storage before expanding Security Timeline.
7. Extract the connector SDK from the existing reference connector contract.
8. Extract governed chat rules behind focused tests before larger routing changes.
9. Add CI and Playwright smoke once Phase 1 and Phase 2 stabilize.
10. Polish presentation after platform proof is stable.

## Verification Strategy

V2 verification should layer new checks without weakening V1:

- `npm run typecheck`
- `npm run build`
- `npm run verify:v1`
- `npm run verify:v2-plan`
- `npm run verify:platform-state-foundation`
- `npm run verify:platform-state-onboarding`
- `npm run verify:platform-audit-write-through`
- `npm run verify:platform-db-migrations`
- `npm run verify:user-directory-access-gate`
- `npm run verify:audit-viewer-boundary`
- `npm run verify:a2a-protocol-compatibility`
- `npm run verify:a2a-message-task-adapter`
- `npm run verify:a2a-agent-card-provenance`
- `npm run verify:generic-action-taxonomy`
- future Auth0 verification for JWT/JWKS validation and claim mapping
- Phase 2.6 adds the first opt-in Postgres schema and `PostgresPlatformStateStore`; Phase 2.19 verifies tenant-scoped persisted audit viewer reads, and Phase 2.19c verifies indexed outcome/severity pagination
- future connected-account verification for `authorization_required`, token vault status, user-specific OAuth tokens, and raw token redaction
- future SOC/SIEM and observability verification for sanitized vendor-neutral SecurityEventSink exports
- future SDK verification proving a connector can onboard without Gateway core changes
- future chat-engine regression tests for precedence rules
- future Playwright smoke tests for browser and production demo flows

## V2 Implementation Checklist

### Phase 0  V1 Closeout / Branch Hygiene

- [ ] Create `feature/v2-platform-foundation` from latest `main`
- [ ] Confirm `npm run verify:v1` passes before V2 changes
- [ ] Keep V1 runtime behavior stable
- [ ] Keep deployment docs accurate

### Phase 1  Auth0

- [ ] Define identity provider abstraction
- [ ] Add Auth0 config validation
- [ ] Add Auth0 JWT/JWKS validation
- [ ] Map claims to Gateway user identity
- [ ] Feed identity into policy decisions
- [ ] Feed identity into connector runtime context
- [ ] Show real IdP proof in Security Timeline

### Phase 2  Persistence

- [ ] Phase 2.0: inventory current in-memory platform state
- [ ] Phase 2.0: define `PlatformStateStore`
- [ ] Phase 2.0: keep `InMemoryPlatformStateStore` as the local/dev default
- [ ] Phase 2.0: verify no raw tokens are represented in store boundary types
- [ ] Phase 2.1: route installed connector trust registry through `PlatformStateStore`
- [ ] Phase 2.1: preserve existing in-memory local mode
- [ ] Phase 2.1: verify onboarding success writes safe connector trust records
- [ ] Phase 2.2: append safe audit events through `PlatformStateStore`
- [ ] Phase 2.2: audit write failures must not break runtime/user flow
- [ ] Phase 2.2: audit metadata must be sanitized and raw tokens hidden
- [ ] Phase 2.2: memory driver remains active; restart survival is future Postgres work
- [ ] Phase 2.2a: harden early adversarial/governance block audit coverage
- [ ] Phase 2.2a: use neutral persisted audit proof names like `protectedMaterialExposed` and `tokenMaterialStored`
- [ ] Phase 2.2a: keep raw prompts out of adversarial/security block audit events
- [ ] Phase 2.3: define conversation and pending-interaction state boundary
- [ ] Phase 2.3: write safe conversation snapshots through `PlatformStateStore`
- [ ] Phase 2.3: keep existing in-memory read path active
- [ ] Phase 2.3: do not persist raw prompts or token-looking content
- [ ] Phase 2.3: memory driver remains active; restart survival is future Postgres work
- [ ] Phase 2.4: define vendor-neutral SecurityEventSink boundary
- [ ] Phase 2.4: add event schema version guidance
- [ ] Phase 2.4: add severity and outcome model
- [ ] Phase 2.4: add correlation ID requirements
- [ ] Phase 2.4: keep SOC/observability exports sanitized
- [ ] Phase 2.4: do not implement vendor-specific sinks yet
- [ ] Phase 2.4: implement internal SecurityEventSink boundary
- [ ] Phase 2.4: default SecurityEventSink to noop
- [ ] Phase 2.4: keep ConsoleSecurityEventSink local and metadata-minimal
- [ ] Phase 2.4: use schemaVersion `secure-a2a.security-event.v1`
- [ ] Phase 2.4: keep publish failures non-blocking for runtime and audit write-through
- [ ] Phase 2.6: add `pg` Postgres dependency without adding Prisma or Drizzle
- [ ] Phase 2.6: add tenant-aware schema for tenants, users, connector trust, audit events, conversations, and runtime executions
- [ ] Phase 2.6: add `PostgresPlatformStateStore` behind `PLATFORM_STATE_STORE_DRIVER=postgres`
- [ ] Phase 2.6: keep memory as the default local/dev state store
- [ ] Phase 2.6: verify schema has no raw token material or token vault columns
- [ ] Phase 2.6: persist connector trust owner scope as `owner_key_hash` and scope trust IDs by tenant / owner / agent
- [ ] Phase 2.7: require the local user directory before Auth0 identity attaches to a Gateway session
- [ ] Phase 2.7: support email allowlist first and provider/issuer/subject binding after first login
- [ ] Phase 2.7: deny missing, disabled, and mismatched users safely
- [ ] Phase 2.7: keep mock demo available unless configured otherwise
- [ ] Phase 2.8: hide the main app until Gateway identity is attached
- [ ] Phase 2.8: keep backend protected routes enforcing session and identity
- [ ] Phase 2.8: keep Auth0 tokens and callback parameters out of UI and localStorage
- [ ] Phase 2.9: add versioned Postgres migrations with checksum tracking
- [ ] Phase 2.9: keep `schema.sql` as bootstrap/reference while preferring migrations for staging/production
- [ ] Phase 2.9: keep migrations free of token and password columns
- [ ] Phase 2.19: expose `GET /audit/events` behind verified session `audit.read`
- [ ] Phase 2.19: keep audit viewer reads tenant-scoped to Ogen-resolved tenant context
- [ ] Phase 2.19: project persisted audit events without raw prompt, token, secret, or stored metadata payload
- [ ] Phase 2.19b: return safe `audit_events_filter_scan_limit_exceeded` guidance for sparse derived filters
- [ ] Phase 2.19b: keep scan-limit diagnostics operator-safe and free of stored metadata or protected material
- [ ] Phase 2.19b: define future materialized outcome/severity index path without trusting AI or client classification
- [ ] Phase 2.19c: materialize Ogen-derived outcome/severity for indexed audit reads
- [ ] Phase 2.19c: keep filtered cursor pagination stable through the classification index
- [ ] Phase 2.19c: preserve bounded-scan fallback errors for stores without the indexed read contract
- [ ] Phase 2.19d: document operator-controlled `CREATE INDEX CONCURRENTLY IF NOT EXISTS` rollout for large audit tables
- [ ] Phase 2.20a: expose `/.well-known/agent-card.json` beside legacy `/agent-card`
- [ ] Phase 2.20a: send `A2A-Version: 1.0` and `application/a2a+json` on outbound A2A calls
- [ ] Phase 2.20a: reject unsupported explicit inbound A2A versions without task execution
- [ ] Phase 2.20b: add narrow A2A Message/Task adapter types and mapping functions without replacing `A2ATask`
- [ ] Phase 2.20b: normalize compatibility envelopes at `/resolve` and local `/task` boundaries before policy/execution
- [ ] Phase 2.20b: keep protocol metadata out of tenant, role, policy, authorization, and audit authority
- [ ] Phase 2.20b: defer official Message/Task operations `list`, `get`, `cancel`, and `subscribe`
- [ ] Phase 2.21: include advisory signed Agent Card provenance on `/agent-card` and `/.well-known/agent-card.json`
- [ ] Phase 2.21: keep Agent Card provenance out of tenant, role, policy, authorization, runtime, and audit authority
- [ ] Phase 2.21: verify no private keys, raw tokens, raw prompts, secrets, or protected metadata appear in provenance output
- [ ] Phase 2.22: export generic Ogen action taxonomy and policy condition source types
- [ ] Phase 2.22: propagate normalized action metadata through connector/action contracts
- [ ] Phase 2.22: keep OAuth scopes separate from Ogen action permission and approval policy
- [ ] Phase 2.22: fail SDK certification for missing normalized action metadata on future executable connectors
- [ ] Add database package
- [ ] Add schema
- [ ] Persist tenants and users
- [ ] Persist installed connectors
- [ ] Persist connector profiles
- [ ] Persist connector trust events
- [ ] Persist audit events
- [ ] Persist conversations
- [ ] Persist pending interactions
- [ ] Persist runtime executions
- [ ] Keep local in-memory mode available

### Phase 2.5  Connected Accounts / User Delegated OAuth

- [ ] Define shared `authorization_required` contract
- [ ] Define connected account status contract
- [ ] Design connected account token vault schema
- [ ] Define actor-to-external-account resolution rules
- [ ] Define adapter checks for provider, actor, connector, resource system, and required scopes
- [ ] Design Gateway `Connect your <provider> account` CTA behavior
- [ ] Preserve pending interaction after authorization
- [ ] Add Security Timeline events for user authorization required
- [ ] Verify one user's token is never used for another user
- [ ] Verify raw OAuth tokens, refresh tokens, and authorization codes stay hidden

### Phase 3  Connector SDK

- [ ] Create `packages/connector-sdk`
- [ ] Add connector profile builder
- [ ] Add skill definition helper
- [ ] Add discovery document builder
- [ ] Add JWKS and onboarding signature helpers
- [ ] Add runtime JWT validation helper
- [ ] Add end-user answer helper
- [ ] Add secret redaction helper
- [ ] Port current `real-external-agent` to SDK usage
- [ ] Add one new connector example without Gateway core changes

### Phase 3.5  Real ServiceNow External Agent Adapter

- [ ] Define ServiceNow adapter connector profile
- [ ] Add ServiceNow adapter env validation
- [ ] Implement ServiceNow OAuth/client credentials helper
- [ ] Implement incident read
- [ ] Implement incident search
- [ ] Implement user lookup
- [ ] Implement CMDB CI lookup
- [ ] Add optional work-note action behind approval/disabled flag
- [ ] Add ServiceNow adapter verification
- [ ] Add demo flow showing real ServiceNow read-only execution

### Phase 4  Governed Chat Engine

- [ ] Define chat state machine boundaries
- [ ] Encode precedence rules
- [ ] Add regression tests for ticket carryover
- [ ] Add regression tests for runtime success versus out-of-scope fallback
- [ ] Add regression tests for admin bypass handling
- [ ] Add regression tests for target-selection resolution

### Phase 5  Policy And Audit Maturity

- [ ] Define persisted audit event schema
- [ ] Persist login events
- [ ] Persist discovery and onboarding events
- [ ] Persist policy decisions
- [ ] Persist token issuance metadata
- [ ] Persist runtime executed/blocked events
- [ ] Persist secret/token request blocks
- [ ] Persist admin/debug attempt blocks
- [ ] Read Security Timeline from audit events

### Phase 6  CI, Playwright, Production Smoke

- [ ] Add GitHub Actions workflow
- [ ] Add Playwright browser smoke tests
- [ ] Add production smoke script
- [ ] Cover app load
- [ ] Cover login
- [ ] Cover Jira, ServiceNow, and GitHub lookups
- [ ] Cover access request fulfillment routing
- [ ] Cover raw token request block
- [ ] Cover Agent Registry layout
- [ ] Cover connector onboarding

### Phase 7  Presentation Polish

- [ ] Add architecture diagram
- [ ] Add sequence diagram
- [ ] Record demo video / GIF
- [ ] Rewrite README for platform positioning
- [ ] Rewrite Demo Guide for V2 proof
- [ ] Document what V2 proves
- [ ] Document intentional exclusions

## What Remains V3+

- real vendor write execution
- multi-tenant SaaS administration
- marketplace and billing
- SAML/SCIM enterprise lifecycle
- full RBAC administration
- complex policy language and policy authoring UI
- SOC2/compliance program artifacts
- broad connector catalog
- Kubernetes or multi-region platform operations
