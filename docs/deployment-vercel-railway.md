# Vercel + Railway Deployment Guide

This repository is an npm workspace monorepo. Deploy the frontend to Vercel and each backend service to Railway as separate services from the same repo.

Do not commit secrets, private JWKs, Redis tokens, API keys, cookies, access tokens, or client assertions.

## Architecture

Vercel:

- `apps/web-ui` only

Railway:

- `services/orchestrator-api`
- `services/mock-identity-provider`
- `services/jira-agent`
- `services/github-agent`
- `services/pagerduty-agent`
- `services/security-oauth-agent`
- `services/api-health-agent`
- `services/end-user-triage-agent`

External:

- Upstash Redis for shared TTL-based state

## Vercel Setup

Root Directory:

```text
repository root
```

Build command:

```bash
npm run build -w apps/web-ui
```

Output directory:

```text
apps/web-ui/dist
```

If Root Directory is set to `apps/web-ui` instead, use build command `npm run build` and output directory `dist`.

Environment:

```env
VITE_ORCHESTRATOR_API_URL=https://<orchestrator-api>.up.railway.app
```

Do not put server secrets in Vercel. The web UI should only know the orchestrator API URL.

## Railway Setup

Create one Railway service per backend workspace. Each service uses the same GitHub repo but a different workspace command.

Railway should install dependencies from the repository root so npm workspaces and `packages/shared` are available. Each backend service should use workspace-specific build/start commands.

This demo intentionally starts TypeScript services with `tsx`. The build command is a typecheck gate; the start command runs the TypeScript entrypoint directly.

### Backend Service Commands

| Service | Workspace path | Build command | Start command | Public URL |
| --- | --- | --- | --- | --- |
| orchestrator-api | `services/orchestrator-api` | `npm run build -w services/orchestrator-api` | `npm run start -w services/orchestrator-api` | yes |
| mock-identity-provider | `services/mock-identity-provider` | `npm run build -w services/mock-identity-provider` | `npm run start -w services/mock-identity-provider` | yes or private/internal |
| jira-agent | `services/jira-agent` | `npm run build -w services/jira-agent` | `npm run start -w services/jira-agent` | private/internal preferred |
| github-agent | `services/github-agent` | `npm run build -w services/github-agent` | `npm run start -w services/github-agent` | private/internal preferred |
| pagerduty-agent | `services/pagerduty-agent` | `npm run build -w services/pagerduty-agent` | `npm run start -w services/pagerduty-agent` | private/internal preferred |
| security-oauth-agent | `services/security-oauth-agent` | `npm run build -w services/security-oauth-agent` | `npm run start -w services/security-oauth-agent` | private/internal preferred |
| api-health-agent | `services/api-health-agent` | `npm run build -w services/api-health-agent` | `npm run start -w services/api-health-agent` | private/internal preferred |
| end-user-triage-agent | `services/end-user-triage-agent` | `npm run build -w services/end-user-triage-agent` | `npm run start -w services/end-user-triage-agent` | private/internal preferred |

Prefer Railway private/internal service URLs between backend services when available. Public URLs are acceptable for first deployment if CORS, service tokens, `private_key_jwt`, replay protection, and optional IP controls are configured appropriately.

## Shared Backend Env

Set on orchestrator, Mock IdP, and agents where applicable:

```env
HOST=0.0.0.0
INTERNAL_SERVICE_TOKEN=<same long random value across orchestrator, Mock IdP, and agents>
STATE_STORE_DRIVER=upstash
STATE_STORE_KEY_PREFIX=a2a
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

`INTERNAL_SERVICE_TOKEN` must match across services. Do not expose it to Vercel.

## Orchestrator Env

```env
PORT=4000
HOST=0.0.0.0
ALLOWED_ORIGINS=https://<vercel-app>.vercel.app
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAMESITE=None
TRUST_PROXY_HEADERS=false
MAX_DEMO_AGENTS_PER_SESSION=5
SESSION_RATE_LIMIT_WINDOW_MS=60000
SESSION_RATE_LIMIT_MAX_REQUESTS=20
DEMO_AGENT_RATE_LIMIT_WINDOW_MS=60000
DEMO_AGENT_RATE_LIMIT_MAX_REQUESTS=20
HEALTH_RATE_LIMIT_WINDOW_MS=60000
HEALTH_RATE_LIMIT_MAX_REQUESTS=30

A2A_AUTH_MODE=oauth2_client_credentials_jwt
A2A_IDP_URL=https://<mock-idp>.up.railway.app
A2A_JWKS_URI=https://<mock-idp>.up.railway.app/.well-known/jwks.json

ORCHESTRATOR_CLIENT_ID=servicenow-orchestrator-agent
ORCHESTRATOR_TOKEN_AUTH_METHOD=private_key_jwt
ORCHESTRATOR_PRIVATE_JWK_JSON=<private jwk json>

INTERNAL_SERVICE_TOKEN=<same long random value across orchestrator, Mock IdP, and agents>

STATE_STORE_DRIVER=upstash
STATE_STORE_KEY_PREFIX=a2a
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...

AI_PROVIDER=openrouter
OPENROUTER_API_KEY=optional
OPENROUTER_MODEL=openai/gpt-4o-mini
```

Keep `TRUST_PROXY_HEADERS=false` unless Railway or another trusted proxy is configured to sanitize incoming forwarded headers before they reach the orchestrator. `MAX_DEMO_AGENTS_PER_SESSION` limits public demo abuse.

Agent URLs configured on orchestrator:

```env
JIRA_AGENT_URL=https://<jira-agent>.up.railway.app/task
GITHUB_AGENT_URL=https://<github-agent>.up.railway.app/task
PAGERDUTY_AGENT_URL=https://<pagerduty-agent>.up.railway.app/task
SECURITY_OAUTH_AGENT_URL=https://<security-oauth-agent>.up.railway.app/task
API_HEALTH_AGENT_URL=https://<api-health-agent>.up.railway.app/task
END_USER_TRIAGE_AGENT_URL=https://<end-user-triage-agent>.up.railway.app/task
```

When using Railway private networking, use the private/internal URL equivalents for these agent URLs and for `A2A_IDP_URL` where possible.

## Mock IdP Env

Use Railway's provided `PORT` if available. The service also supports `MOCK_IDENTITY_PROVIDER_PORT` for local development.

```env
HOST=0.0.0.0
PORT=4110
MOCK_IDENTITY_PROVIDER_PORT=4110

A2A_ISSUER=https://<mock-idp>.up.railway.app
A2A_TOKEN_TTL_SECONDS=300

ORCHESTRATOR_PRIVATE_KEY_JWT_ENABLED=true
ORCHESTRATOR_PRIVATE_KEY_JWT_AUDIENCE=https://<mock-idp>.up.railway.app/oauth/token
ORCHESTRATOR_ALLOWED_AUTH_METHODS=private_key_jwt
ORCHESTRATOR_PUBLIC_JWK_JSON=<public jwk json>

INTERNAL_SERVICE_TOKEN=<same long random value across orchestrator, Mock IdP, and agents>

STATE_STORE_DRIVER=upstash
STATE_STORE_KEY_PREFIX=a2a
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

IP allowlist for first Railway deployment:

```env
MOCK_IDP_ENFORCE_IP_ALLOWLIST=false
MOCK_IDP_ALLOWED_SOURCE_IPS=127.0.0.1,::1,::ffff:127.0.0.1
MOCK_IDP_ALLOWED_SOURCE_CIDRS=
TRUST_PROXY_HEADERS=false
```

Enable the allowlist only after you understand Railway source IP/private networking behavior. If the Mock IdP is public, keep `/oauth/token` protected by `private_key_jwt`, replay protection, and optional IP allowlist.

## Agent Env

For each local mock agent:

```env
HOST=0.0.0.0
PORT=<service port or Railway PORT>
A2A_AUTH_MODE=oauth2_client_credentials_jwt
A2A_ISSUER=https://<mock-idp>.up.railway.app
A2A_JWKS_URI=https://<mock-idp>.up.railway.app/.well-known/jwks.json
INTERNAL_SERVICE_TOKEN=<same long random value across orchestrator, Mock IdP, and agents>
```

Suggested local service ports:

- Jira Agent: `4101`
- GitHub Agent: `4102`
- PagerDuty Agent: `4103`
- Security/OAuth Agent: `4104`
- API Health Agent: `4105`
- End-user Triage Agent: `4106`

Railway may inject its own `PORT`; prefer the Railway value in production.

## Key Generation

Generate a local orchestrator client-authentication key pair:

```bash
npm run generate:orchestrator-client-key
```

Copy:

- `ORCHESTRATOR_PRIVATE_JWK_JSON` to the orchestrator only
- `ORCHESTRATOR_PUBLIC_JWK_JSON` to the Mock IdP only

Never commit keys.

## Pre-Deploy Checks

Run locally before deploying:

```bash
npm run typecheck
npm run build
npm run verify:private-key-jwt-replay
npm run verify:a2a-token
npm run verify:mock-idp-ip-allowlist
npm run verify:session-demo-agent
```

The verification scripts that call HTTP endpoints assume local services are already running.

## Post-Deploy Smoke Tests

1. Open the Vercel URL.
2. Open Agent Health.
3. Confirm orchestrator, Mock IdP, and agents are healthy.
4. Create an external demo agent for Salesforce access diagnosis.
5. Ask: `I cannot login to my Salesforce account`.
6. Confirm the selected demo agent has `tokenIssued=true` and `tokenAuthMethod=private_key_jwt`.
7. Run the built-in Jira, GitHub, and PagerDuty scenarios.

No raw JWT, access token, client assertion, private key, client secret, or Authorization header should appear in the UI or logs.

## Common Issues

### CORS blocked

Check `ALLOWED_ORIGINS` on orchestrator. It must include the exact Vercel origin.

### Cookies not saved

For cross-site Vercel/Railway deployments, use:

```env
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_SAMESITE=None
```

Also verify the frontend calls the orchestrator with credentials.

### `tokenIssued=false` or `audience_not_allowed`

The session demo agent may not have registered with the Mock IdP. Check:

- `INTERNAL_SERVICE_TOKEN` matches between orchestrator and Mock IdP
- `A2A_IDP_URL` points to the reachable Mock IdP
- Mock IdP is healthy
- generated demo audience equals the demo `agentId`

### `private_key_jwt` invalid

Check:

- `ORCHESTRATOR_PRIVATE_JWK_JSON` is on orchestrator only
- `ORCHESTRATOR_PUBLIC_JWK_JSON` is on Mock IdP only
- public/private JWKs are a matching pair
- `ORCHESTRATOR_PRIVATE_KEY_JWT_AUDIENCE` matches the token endpoint URL expected by Mock IdP
- `ORCHESTRATOR_PRIVATE_KEY_JWT_ENABLED=true`

### Upstash errors

Check:

- `STATE_STORE_DRIVER=upstash`
- `UPSTASH_REDIS_REST_URL` is set
- `UPSTASH_REDIS_REST_TOKEN` is set
- the Upstash token has access to the selected database

Redis values must store only safe metadata. Do not store raw tokens or secrets.

### Demo agent creation blocked

Check:

- `MAX_DEMO_AGENTS_PER_SESSION` is high enough for the demo path
- `DEMO_AGENT_RATE_LIMIT_MAX_REQUESTS` and `SESSION_RATE_LIMIT_MAX_REQUESTS` are not too low for live demos
- generated advanced scopes do not contain public-demo unsafe terms such as `admin`, `write`, `delete`, `token`, `secret`, or `credential`

### Health down

Check:

- service URL env vars point to `/task` endpoints for agents
- Railway service is awake and not restarting
- `HOST=0.0.0.0` is set for public Railway services
- internal/private Railway URLs are reachable from the orchestrator
