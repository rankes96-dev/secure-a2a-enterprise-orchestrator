# Real External Agent

Standalone Node.js + TypeScript service that simulates an independently owned vendor/domain agent for the Secure A2A Gateway.

This service represents an external Jira agent. It exposes public discovery metadata, a public JWKS, a signed zero-trust onboarding response, and a future A2A runtime endpoint.

## What It Demonstrates

- The Agent Card/discovery document is a declaration, not trust.
- The agent proves control by signing an onboarding response with its private key.
- Requested scopes and supported capabilities are returned only after a nonce-bound gateway challenge.
- The gateway must still derive approved capabilities from OAuth grants and resource permissions.
- The gateway can verify the signed trust response using the agent JWKS.
- Runtime task execution requires a scoped A2A JWT and validates it before returning a diagnosis.

No private key is committed. The development signing key is generated in memory at startup.

## Endpoints

- `GET /.well-known/a2a-agent.json` - public discovery metadata
- `GET /.well-known/jwks.json` - public JWKS for verifying onboarding responses
- `POST /onboarding/challenge` - returns a signed onboarding trust response
- `POST /a2a/task` - future runtime endpoint requiring a valid A2A bearer JWT

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
