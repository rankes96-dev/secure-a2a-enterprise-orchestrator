# Deployment Readiness

This V1 production demo uses OpenRouter for AI, Upstash Redis for replay/security state, Vercel for the browser UI, and Railway for backend services.

Browser sessions are in-memory in V1. Persistent browser session storage is a V2 item.

Production backend runtime uses compiled JavaScript from `dist`. Local development can use `tsx`, but Railway production start commands must run `node dist/...`.

Ogen requires Node.js >= 20. Railway/runtime should be configured for Node 20 or newer.

Do not commit or expose raw JWTs, access tokens, refresh tokens, Authorization headers, client assertions, client secrets, private keys, API keys, cookies, Upstash tokens, or the OpenRouter API key.

## Architecture

Production services:

- Vercel hosts only `apps/web-ui`.
- Railway hosts `services/orchestrator-api`.
- Railway hosts `services/mock-identity-provider`.
- Railway hosts external connector agents as separate Railway services:
  - Jira external agent
  - ServiceNow external agent
  - GitHub external agent
- Upstash Redis is the production replay and security state store.
- OpenRouter is the production AI provider.

Legacy internal mock agents are local-development helpers only and are not deployed in the V1 production connector-first setup.

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

## HTTP Framework Mode

Fastify mode is opt-in:

```env
ORCHESTRATOR_HTTP_FRAMEWORK=fastify
```

Current Fastify mode serves only:

- `GET /health`
- `GET /.well-known/a2a-gateway.json`
- `GET /.well-known/jwks.json`

Use default server mode for the full app until protected routes are migrated.

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
VITE_AUTH_PROVIDER=mock
VITE_JIRA_AGENT_URL=https://<jira-agent>.railway.app
VITE_SERVICENOW_AGENT_URL=https://<servicenow-agent>.railway.app
VITE_GITHUB_AGENT_URL=https://<github-agent>.railway.app
```

For Auth0 user login in V2 Phase 1, Vercel uses only public SPA values:

```env
VITE_AUTH_PROVIDER=auth0
VITE_AUTH0_DOMAIN=<tenant>.auth0.com
VITE_AUTH0_CLIENT_ID=<spa-client-id>
VITE_AUTH0_AUDIENCE=<api-audience>
```

Auth0 is for real browser user identity. The Mock IdP remains the A2A machine-token issuer for scoped connector runtime execution, and in V2 documentation this service is treated as the Reference A2A Token Issuer / Reference A2A Authorization Server rather than the primary user identity provider.

Auth0 SPA dashboard settings should use the dedicated callback route:

```text
Allowed Callback URLs:
http://localhost:5173/auth/callback
https://secure-a2a-enterprise-orchestrator.vercel.app/auth/callback

Allowed Logout URLs:
http://localhost:5173/
https://secure-a2a-enterprise-orchestrator.vercel.app/

Allowed Web Origins:
http://localhost:5173
https://secure-a2a-enterprise-orchestrator.vercel.app

Allowed Origins CORS:
http://localhost:5173
https://secure-a2a-enterprise-orchestrator.vercel.app
```

Root callback URLs such as `http://localhost:5173/` may be kept temporarily during migration, but `/auth/callback` is the preferred callback and root callbacks should be removed after verification.

For the current Railway production demo, set:

```env
VITE_JIRA_AGENT_URL=https://jira-external-agent-production.up.railway.app
VITE_SERVICENOW_AGENT_URL=https://servicenow-external-agent-production.up.railway.app
VITE_GITHUB_AGENT_URL=https://github-external-agent-production.up.railway.app
```

The Agent Registry preset cards use these `VITE_*_AGENT_URL` values when they are present. Without them, local development falls back to the localhost reference agents.

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
GATEWAY_ISSUER=https://<orchestrator>.railway.app
ORCHESTRATOR_PUBLIC_URL=https://<orchestrator>.railway.app
EXTERNAL_AGENT_ONBOARDING_ALLOWED_ORIGINS=https://<jira-agent>.railway.app,https://<servicenow-agent>.railway.app,https://<github-agent>.railway.app
CONNECTOR_RUNTIME_ALLOWED_ORIGINS=https://<jira-agent>.railway.app,https://<servicenow-agent>.railway.app,https://<github-agent>.railway.app

OPENROUTER_API_KEY=<server-side-openrouter-key>
OPENROUTER_MODEL=openai/gpt-4o-mini
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

STATE_STORE_DRIVER=upstash
STATE_STORE_KEY_PREFIX=a2a
UPSTASH_REDIS_REST_URL=<upstash-rest-url>
UPSTASH_REDIS_REST_TOKEN=<upstash-rest-token>

# Optional V2 platform state persistence. V1 does not require this.
PLATFORM_STATE_STORE_DRIVER=memory
# PLATFORM_STATE_STORE_DRIVER=postgres
# DATABASE_URL=<postgres-url>
# DATABASE_SSL=true

SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAMESITE=None
TRUST_PROXY_HEADERS=false
SHOW_INTERNAL_HEALTH_URLS=false
SHOW_LEGACY_INTERNAL_AGENT_DISCOVERY_WARNINGS=false
INTERNAL_SERVICE_TOKEN=<shared-internal-service-token>

AUTH_PROVIDER=mock
# For V2 Phase 1 Auth0 browser identity:
# AUTH_PROVIDER=auth0
# AUTH0_ISSUER=https://<tenant>.auth0.com/
# AUTH0_AUDIENCE=<auth0-api-audience>
# AUTH0_JWKS_URI=https://<tenant>.auth0.com/.well-known/jwks.json
# AUTH0_EMAIL_CLAIM=email
# AUTH0_ROLES_CLAIM=https://secure-a2a.dev/roles
# AUTH0_REQUIRE_USER_DIRECTORY=true
# MOCK_REQUIRE_USER_DIRECTORY=false
# PLATFORM_ALLOWED_USER_EMAILS=

# Admin/internal diagnostics:
ORCHESTRATOR_API_KEY=<long-random-admin-api-key>
ALLOW_DEBUG_AI_CONFIG_WITH_IDENTITY=false

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

Use `ALLOWED_ORIGINS` for the browser origin. Set at least one of `GATEWAY_ISSUER` or `ORCHESTRATOR_PUBLIC_URL` to the orchestrator's real public HTTPS Railway URL; this value is published in Gateway metadata, used for the Gateway JWKS URI, and signs onboarding challenges as the issuer. `EXTERNAL_AGENT_ONBOARDING_ALLOWED_ORIGINS` controls Agent Registry discovery and onboarding server-side fetches. `CONNECTOR_RUNTIME_ALLOWED_ORIGINS` controls `/a2a/task` execution after an agent is trusted. Both allowlists must contain only public connector origins. These entries are origins only, with scheme and host and no path, query, or fragment. If `EXTERNAL_AGENT_ONBOARDING_ALLOWED_ORIGINS` is unset, onboarding falls back to `CONNECTOR_RUNTIME_ALLOWED_ORIGINS`. Use `STATE_STORE_DRIVER=upstash` with `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for replay and security state, not browser sessions. `PLATFORM_STATE_STORE_DRIVER=postgres` is optional V2 platform persistence and requires `DATABASE_URL`; keep `PLATFORM_STATE_STORE_DRIVER=memory` for V1/local demo behavior. Do not put raw OAuth tokens, JWTs, Authorization headers, private keys, client secrets, or client assertions in Postgres platform-state tables.

For Railway Postgres, set `DATABASE_URL` from Railway Postgres and set `DATABASE_SSL=true` if required by the deployment. Run `npm.cmd run db:apply-platform-migrations` before enabling `PLATFORM_STATE_STORE_DRIVER=postgres`. The versioned migrations are preferred for staging and production. `services/orchestrator-api/db/schema.sql` remains an idempotent bootstrap/reference schema, and `npm.cmd run db:apply-platform-schema` remains useful for local reset/bootstrap only.

Local Postgres restart-survival smoke:

```powershell
$env:DATABASE_URL="postgresql://a2a:a2a@localhost:5432/secure_a2a_dev"
$env:DATABASE_SSL="false"
$env:POSTGRES_RESTART_SMOKE_ALLOW_WRITE="true"
npm.cmd run verify:postgres-restart-survival
```

Do not enable the write smoke against production unless intentionally testing a controlled environment. Smoke records use safe synthetic IDs and no secrets.

Use `ORCHESTRATOR_API_KEY` for admin/internal debug access such as `/debug/ai-config`. Do not enable identity-based debug config in production. `ALLOW_DEBUG_AI_CONFIG_WITH_IDENTITY=true` is only for explicit local non-production diagnostics; keep it `false` by default.

For Auth0 browser login, set `AUTH0_REQUIRE_USER_DIRECTORY=true` in production so Auth0 authentication only attaches Gateway identity after the local users directory authorizes the email. The required login shell hides the main app until Gateway identity is attached. The directory stores no passwords and no raw token material, and browser login tokens are not stored in `localStorage`. In memory mode, `PLATFORM_ALLOWED_USER_EMAILS=` can seed local allowed users; if it is empty, the directory gate remains disabled unless explicitly required.

Local Postgres user-directory flow:

```powershell
$env:DATABASE_URL="postgresql://a2a:a2a@localhost:5432/secure_a2a_dev"
$env:DATABASE_SSL="false"
npm.cmd run db:apply-platform-migrations

$env:PLATFORM_USER_EMAIL="ran@gateway.com"
$env:PLATFORM_USER_TENANT_ID="default"
$env:PLATFORM_USER_ROLES="it-support,admin"
$env:PLATFORM_USER_DISPLAY_NAME="Ran"
$env:PLATFORM_USER_STATUS="active"
npm.cmd run db:seed-platform-user
```

Then run the orchestrator with:

```env
PLATFORM_STATE_STORE_DRIVER=postgres
AUTH0_REQUIRE_USER_DIRECTORY=true
```

`ran@gateway.com` is the first local seeded Auth0 demo user. An Auth0 user that is not present and active in the local `users` table receives the safe Access Denied screen.

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

Required production env lives in `services/mock-identity-provider/.env.production.example`. The Mock IdP receives `ORCHESTRATOR_PUBLIC_JWK_JSON` only. Do not put the orchestrator private JWK on this service. Keep `/oauth/token` protected by `private_key_jwt`, replay protection, and optional source IP controls. Mock IdP debug endpoints are local-only or protected by `x-internal-service-token` in production.

## Railway External Connector Agent Services

Deploy three separate Railway services for `real-external-agent`, one per connector.

Railway service root: repository root. Do not set Railway Root Directory to `real-external-agent` when using workspace start commands such as `npm run start:jira -w real-external-agent`. The `real-external-agent` package is selected through the workspace command, not Railway root directory.

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
- `GET /.well-known/a2a-connector-profile.json`
- `GET /.well-known/jwks.json`
- `POST /onboarding/challenge`
- `POST /a2a/task`

Required production env lives in `real-external-agent/.env.production.example`. Connector identity values:

- Jira: `EXTERNAL_CONNECTOR_ID=jira-reference`, `EXTERNAL_AGENT_ID=external-jira-agent`, `EXTERNAL_AGENT_CLIENT_ID=jira-agent-client`
- ServiceNow: `EXTERNAL_CONNECTOR_ID=servicenow-reference`, `EXTERNAL_AGENT_ID=external-servicenow-agent`, `EXTERNAL_AGENT_CLIENT_ID=servicenow-agent-client`
- GitHub: `EXTERNAL_CONNECTOR_ID=github-reference`, `EXTERNAL_AGENT_ID=external-github-agent`, `EXTERNAL_AGENT_CLIENT_ID=github-agent-client`

Railway provides `PORT`; do not set `EXTERNAL_AGENT_PORT` in Railway production. The connector preset ports `4201`, `4202`, and `4203` are local-only defaults for running multiple connector instances on one developer machine.

The connector-specific start command and EXTERNAL_* connector identity env values must match. The service fails fast in production if they do not.

External connector runtime JWT validation uses the Mock IdP service as the Reference A2A Token Issuer. Set `MOCK_IDP_ISSUER=https://<mock-idp>.railway.app` to the exact `iss` value in A2A runtime JWTs, and set `MOCK_IDP_JWKS_URI=https://<mock-idp>.railway.app/.well-known/jwks.json` for signature verification. Both values must point to the same Mock IdP / A2A token issuer deployment. External agents validate the A2A issuer, audience, expiration, and required scope; they do not validate Auth0 directly.

The external connector admin console is local-only by default. In Railway production, keep:

```env
EXTERNAL_AGENT_ADMIN_ENABLED=false
EXTERNAL_AGENT_ADMIN_TOKEN=<long-random-admin-token-if-enabled>
```

With `NODE_ENV=production`, `/admin` and `/admin/*` return 404 unless `EXTERNAL_AGENT_ADMIN_ENABLED=true`. If production admin access is explicitly enabled, every `/admin` and `/admin/*` endpoint requires `EXTERNAL_AGENT_ADMIN_TOKEN` in either `x-admin-token` or `x-internal-service-token`. Do not enable public unauthenticated admin endpoints in Railway.

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
