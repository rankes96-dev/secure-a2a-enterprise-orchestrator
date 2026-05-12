# Deployment Readiness

This V1 production demo uses OpenRouter for AI, Upstash Redis for shared state/session/replay storage, Vercel for the browser UI, and Railway for backend services.

Production backend runtime uses compiled JavaScript from `dist`. Local development can use `tsx`, but Railway production start commands must run `node dist/...`.

Do not commit or expose raw JWTs, access tokens, refresh tokens, Authorization headers, client assertions, client secrets, private keys, API keys, cookies, Upstash tokens, or the OpenRouter API key.

## Architecture

- Vercel hosts only `apps/web-ui`.
- Railway hosts `services/orchestrator-api`.
- Railway hosts `services/mock-identity-provider`.
- Railway hosts external connector agents as separate Railway services:
  - Jira external agent
  - ServiceNow external agent
  - GitHub external agent
- Upstash Redis is the production state store.

## Build Model

Install dependencies from the repository root:

```bash
npm install
```

Production build:

```bash
npm run build
```

The root build compiles `@a2a/shared` first, builds the Vercel frontend, then builds every backend package to its own `dist` directory. Runtime dependencies such as `jose`, `dotenv`, and `@a2a/shared` are under `dependencies`; TypeScript, `tsx`, and `@types/*` remain development dependencies.

Local development:

```bash
npm run dev
```

The local dev runner builds `@a2a/shared` once, then starts services with `tsx` for fast iteration. Do not use the dev runner as a Railway production start command.

## Vercel

Build from the repository root:

```bash
npm run build:apps
```

Output directory:

```text
apps/web-ui/dist
```

Required public frontend env:

```env
VITE_ORCHESTRATOR_API_URL=https://<orchestrator>.railway.app
```

Vercel must not contain `OPENROUTER_API_KEY`, `UPSTASH_REDIS_REST_TOKEN`, `INTERNAL_SERVICE_TOKEN`, `ORCHESTRATOR_PRIVATE_JWK_JSON`, `ORCHESTRATOR_CLIENT_SECRET`, API keys, JWT secrets, cookies, or other server-side secrets.

## Railway Orchestrator Service

Railway service root: repository root.

Build command:

```bash
npm run build
```

Start command:

```bash
npm run start -w services/orchestrator-api
```

That workspace start script runs:

```bash
node dist/index.js
```

Required production env lives in `services/orchestrator-api/.env.production.example` and includes:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=<railway-provided-port>
ALLOWED_ORIGINS=https://<vercel-app>.vercel.app

OPENROUTER_API_KEY=<server-side-openrouter-key>
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

STATE_STORE_DRIVER=upstash
STATE_STORE_KEY_PREFIX=a2a
UPSTASH_REDIS_REST_URL=<upstash-rest-url>
UPSTASH_REDIS_REST_TOKEN=<upstash-rest-token>

SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAMESITE=None
TRUST_PROXY_HEADERS=false
SHOW_INTERNAL_HEALTH_URLS=false
INTERNAL_SERVICE_TOKEN=<shared-internal-service-token>

A2A_AUTH_MODE=oauth2_client_credentials_jwt
REQUIRE_SECURE_A2A_AUTH=true
A2A_IDP_URL=https://<mock-idp>.railway.app
A2A_JWKS_URI=https://<mock-idp>.railway.app/.well-known/jwks.json
ORCHESTRATOR_CLIENT_ID=servicenow-orchestrator-agent
ORCHESTRATOR_TOKEN_AUTH_METHOD=private_key_jwt
ORCHESTRATOR_PRIVATE_KEY_JWT_ENABLED=true
ORCHESTRATOR_PRIVATE_KEY_JWT_AUDIENCE=https://<mock-idp>.railway.app/oauth/token
ORCHESTRATOR_PRIVATE_JWK_JSON=<private-jwk-json>
ORCHESTRATOR_ALLOWED_AUTH_METHODS=private_key_jwt
```

Use `ALLOWED_ORIGINS` for the browser origin. Use `STATE_STORE_DRIVER=upstash` with `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

## Railway Mock IdP Service

Railway service root: repository root.

Build command:

```bash
npm run build
```

Start command:

```bash
npm run start -w services/mock-identity-provider
```

That workspace start script runs:

```bash
node dist/index.js
```

Required production env lives in `services/mock-identity-provider/.env.production.example`. The Mock IdP receives `ORCHESTRATOR_PUBLIC_JWK_JSON` only. Do not put the orchestrator private JWK on this service. Keep `/oauth/token` protected by `private_key_jwt`, replay protection, and optional source IP controls.

## Railway External Connector Agent Services

Deploy three separate Railway services from `real-external-agent`, one per connector.

Build command for each:

```bash
npm run build
```

Start commands:

```bash
npm run start:jira -w real-external-agent
npm run start:servicenow -w real-external-agent
npm run start:github -w real-external-agent
```

Those workspace start scripts run compiled JavaScript:

```bash
node dist/startConnector.js jira
node dist/startConnector.js servicenow
node dist/startConnector.js github
```

Each agent must have a public HTTPS URL on Railway for production onboarding. Do not onboard `localhost` URLs in production. Gateway onboarding must use the public Railway agent URL. Each agent must expose:

- `GET /.well-known/a2a-agent.json`
- `GET /.well-known/a2a-supported-connectors.json`
- `GET /.well-known/jwks.json`
- `POST /onboarding/challenge`
- `POST /a2a/task`

Required production env lives in `real-external-agent/.env.production.example`. Connector identity values:

- Jira: `EXTERNAL_CONNECTOR_ID=jira-reference`, `EXTERNAL_AGENT_ID=external-jira-agent`, `EXTERNAL_AGENT_CLIENT_ID=jira-agent-client`
- ServiceNow: `EXTERNAL_CONNECTOR_ID=servicenow-reference`, `EXTERNAL_AGENT_ID=external-servicenow-agent`, `EXTERNAL_AGENT_CLIENT_ID=servicenow-agent-client`
- GitHub: `EXTERNAL_CONNECTOR_ID=github-reference`, `EXTERNAL_AGENT_ID=external-github-agent`, `EXTERNAL_AGENT_CLIENT_ID=github-agent-client`

## Verification

Static/local readiness:

```bash
npm install
npm run typecheck
npm run build
npm run verify:v1
npm run verify:deployment-readiness
npm run verify:demo-readiness
```

Service-dependent e2e routing checks require the orchestrator and external connector agents to be running:

```bash
npm run verify:v1:e2e
```

Manual production demo path:

1. Open the Vercel URL.
2. Select BizApps / IT mode.
3. Onboard each external connector agent using its public HTTPS Railway URL.
4. Run Connector Test Center validation tests.
5. Open Security Timeline and confirm policy, token, runtime, and audit proof.
