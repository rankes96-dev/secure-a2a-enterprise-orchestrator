# Real External Agent

Standalone Node.js + TypeScript service that simulates an independently owned vendor/domain agent for the Secure A2A Gateway.

This service represents an external Jira agent using a generic connector profile model. Jira is the reference connector profile for this demo; future custom connectors can provide their own application access grant catalogs, effective permission catalogs, and action catalogs. The service exposes public discovery metadata, a public JWKS, a signed zero-trust onboarding response, and a future A2A runtime endpoint.

## What It Demonstrates

- The Agent Card/discovery document is a declaration, not trust.
- The agent proves control by signing an onboarding response with its private key.
- Application access grants define what the connected app can request from the external system.
- Effective permissions define what the service account / integration user can actually do.
- Agent actions require both application access grants and effective permissions.
- Missing application grants block an action even if all effective permissions exist.
- Missing effective permissions block an action even if all application access grants exist.
- Requested application grants and agent-declared actions are returned only after a nonce-bound gateway challenge.
- The gateway must still derive approved actions from application access grants, effective permissions, denied permissions, and policy.
- The gateway can verify the signed trust response using the agent JWKS.
- Runtime task execution requires a scoped A2A JWT and validates it before returning a diagnosis.

No private key is committed. The development signing key is generated in memory at startup.

## Endpoints

- `GET /admin` - local development admin console for external-side setup
- `GET /admin/config` - safe current admin configuration
- `POST /admin/trusted-gateway` - save Gateway public registration metadata
- `POST /admin/oauth-application` - save external OAuth application binding metadata and application access grants
- `POST /admin/service-principal` - save integration user effective and denied permissions
- `POST /admin/capability-declaration` - save enabled agent actions; requested application grants are derived from action requirements
- `POST /admin/reset-demo` - restore local demo defaults
- `GET /.well-known/a2a-agent.json` - public discovery metadata
- `GET /.well-known/a2a-connector-profile.json` - public connector profile describing grant, permission, and action catalogs
- `GET /.well-known/jwks.json` - public JWKS for verifying onboarding responses
- `POST /onboarding/challenge` - returns a signed onboarding trust response
- `POST /a2a/task` - future runtime endpoint requiring a valid A2A bearer JWT

## External Agent Admin Console

Open `http://localhost:4201/admin` while the service is running.

The admin console simulates the external system or vendor-owned agent admin screen. It is local development only, has no authentication in this phase, and stores configuration in memory.

Use it to configure:

- trusted Gateway registration copied from the Gateway UI
- OAuth application metadata owned by the external system
- application access grants assigned to the connected app
- service account / integration user effective and denied permissions
- enabled agent actions from the connector action catalog

No client secrets, private keys, access tokens, refresh tokens, bearer headers, or Authorization headers are stored or displayed.

During onboarding, the agent uses this config to:

- verify the signed Gateway challenge with the registered Gateway issuer, client ID, and JWKS URI
- confirm the OAuth application is active
- include signed OAuth application and service principal attestations in the onboarding response
- declare requested application grants and agent actions without claiming they are approved

## Authorization Model

The demo uses a generic model that can scale beyond Jira:

- Application access grants: OAuth/API grants assigned to the connected app. In Jira, these are OAuth scopes such as `read:jira-work`.
- Effective permissions: roles, permissions, or entitlements held by the service account / integration user in the external system.
- Agent actions: business actions the external agent can declare, each with required application grants and required effective permissions.

An action is ready only when every required application access grant is present, every required effective permission is present, and no required permission is explicitly denied. The Gateway remains the final authority and may still block actions by policy.

The current Jira reference connector profile is implemented in `src/connectorProfile.ts` and published at `/.well-known/a2a-connector-profile.json`. Discovery includes the connector profile URL, and the signed onboarding response includes the connector ID, profile URL, and a local demo SHA-256 hash over stable JSON for the profile.

A future Custom Connector Layer can replace this static file with system-specific catalogs for ServiceNow, Salesforce, GitHub, Slack, and other systems. The Gateway should not need Jira-specific action requirements in its core.

## Connector Registry

Connector registry code lives in `src/connectors/`:

- `types.ts` defines connector profile and supported connector metadata.
- `jiraReferenceConnector.ts` contains the Jira Cloud reference connector profile.
- `registry.ts` exposes `listSupportedConnectors()`, `getConnectorProfile(connectorId)`, `getDefaultConnectorProfile()`, and `getConnectorProfileForResourceSystem(resourceSystem)`.

The selected connector controls the admin console catalogs for application access grants, effective permissions, denied permissions, and agent actions. For this phase, only `jira-reference` is available; ServiceNow, Salesforce, and GitHub are listed as future connector placeholders only if enabled in the registry.

To add another connector profile later, add its profile module, register it in `registry.ts`, and make it available through the admin-selected connector. Do not add system-specific action requirements to Gateway core.

## Environment

Copy `.env.example` to `.env` if you want to override defaults.

```env
PORT=4201
AGENT_ISSUER=http://localhost:4201
MOCK_IDP_JWKS_URI=http://localhost:4110/.well-known/jwks.json
EXPECTED_AUDIENCE=external-jira-agent
```

## Run

```bash
npm install
npm run dev
```

The service listens on `http://localhost:4201` by default.

## Verify

In another terminal:

```bash
npm run verify:agent
```

The verification script checks discovery, JWKS, and the signed onboarding response. Runtime verification is skipped unless you provide a bearer token:

```bash
RUNTIME_BEARER_TOKEN=<a2a-jwt> npm run verify:agent
```

## Security Boundaries

- Discovery metadata does not include secrets or private keys.
- The onboarding response is signed with RS256.
- The runtime endpoint does not accept anonymous requests.
- Runtime JWT validation checks issuer signature via Mock IdP JWKS, audience, scope, and actor metadata when present.
- This is a local development agent, not a production identity provider or production Jira connector.
