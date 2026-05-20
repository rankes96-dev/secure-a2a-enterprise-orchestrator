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

Auth0 will be the real user identity provider. Mock IdP remains the A2A machine-to-machine token issuer for local and V1-style runtime token flows. Phase 1 must not replace Mock IdP entirely.

Auth0 is for browser end-user identity only. In V2 Phase 1, the Mock IdP remains the issuer for scoped A2A machine tokens used by connector runtime execution.

Expected future implementation:

- `AUTH_PROVIDER=mock|auth0`
- Auth0 OIDC login
- JWT/JWKS validation
- issuer, audience, expiry, and signature checks
- claims mapping for `sub`, `email`, `name`, and roles/groups
- user identity flows into policy, connector runtime context, audit proof, and Security Timeline

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
- Public `.well-known/*` metadata is okay.
- `/admin` and debug endpoints must remain disabled or token-protected in production.
- Onboarding URL allowlist protects against SSRF.
- Runtime URL allowlist protects against untrusted runtime execution.
- `private_key_jwt` remains preferred over `client_secret_post`.
- User identity claims must be issuer/audience/signature/expiry validated before policy or audit use.
- Audit events must store safe metadata only, not raw JWTs, Authorization headers, private keys, client assertions, or secrets.

## Definition Of Done

V2 foundation is done when:

- V1 remains verifiable through `npm run verify:v1`.
- Real user identity is pluggable and Auth0-backed without removing Mock IdP machine-token flows.
- Installed connectors and audit proof persist across orchestrator restarts.
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
4. Move audit events into durable storage before expanding Security Timeline.
5. Extract the connector SDK from the existing reference connector contract.
6. Extract governed chat rules behind focused tests before larger routing changes.
7. Add CI and Playwright smoke once Phase 1 and Phase 2 stabilize.
8. Polish presentation after platform proof is stable.

## Verification Strategy

V2 verification should layer new checks without weakening V1:

- `npm run typecheck`
- `npm run build`
- `npm run verify:v1`
- `npm run verify:v2-plan`
- future Auth0 verification for JWT/JWKS validation and claim mapping
- future persistence verification for restart-surviving connectors, audit events, conversations, pending interactions, and runtime executions
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
