# Secure A2A Enterprise Integration Resolver

A local TypeScript monorepo demo for a chat-based enterprise integration resolver.

The first scenario is:

> Jira sync fails with 403 when creating issues

The ServiceNow-style AI Orchestrator Agent classifies the request, selects external enterprise agents from Agent Cards, starts local A2A-like task conversations, gathers agent-owned findings, and returns a support-style diagnosis with an A2A conversation trace.

## Apps and services

- `apps/web-ui` - React + Vite chat UI
- `services/orchestrator-api` - ServiceNow-style AI Orchestrator Agent API
- `services/end-user-triage-agent` - local end-user symptom triage agent
- `services/jira-agent` - local Jira specialist agent
- `services/github-agent` - local GitHub specialist agent
- `services/pagerduty-agent` - local PagerDuty specialist agent
- `services/security-oauth-agent` - local OAuth/security specialist agent
- `services/api-health-agent` - local API health and rate-limit specialist agent
- `mock-data` - JSON-only mock enterprise data

## Requirements

- Node.js 20+
- npm 10+

## Run locally

Optional AI classification setup:

1. Open `services/orchestrator-api/.env`.
2. Paste your OpenRouter key into `OPENROUTER_API_KEY`.
3. Keep `AI_PROVIDER=openrouter`.

```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_MODEL=openai/gpt-4o-mini
```

If no API key is configured, if the AI request fails, or if the AI returns an invalid/unsafe agent route, the orchestrator automatically uses the local rules fallback. API keys stay server-side in `services/orchestrator-api/.env` and are never sent to the React frontend.

The AI orchestrator returns both classification and A2A agent routing. The backend validates selected agent IDs and skill IDs against Agent Cards before invoking any local mock agent.

Security settings for public hosting:

```env
ORCHESTRATOR_API_KEY=generate_a_long_random_client_api_key
INTERNAL_SERVICE_TOKEN=generate_a_long_random_internal_service_token
ALLOWED_ORIGINS=https://your-frontend-domain.example
HOST=0.0.0.0
MAX_BODY_BYTES=65536
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=30
```

- `POST /resolve` requires `x-api-key`.
- Browser clients can also call `POST /session` to receive an HttpOnly session cookie, then call `POST /resolve` with credentials.
- Agent `/task` endpoints require `x-internal-service-token`.
- The orchestrator sends `x-internal-service-token` to agents.
- Browser CORS is restricted by `ALLOWED_ORIGINS`.
- Request bodies are capped by `MAX_BODY_BYTES`.
- `/resolve` has a simple in-memory rate limit.
- Do not put `ORCHESTRATOR_API_KEY`, `INTERNAL_SERVICE_TOKEN`, OpenRouter keys, or OpenAI keys in frontend code.
- For Railway, set these as Railway environment variables. Use `HOST=0.0.0.0` only for services Railway must route to.
- For a separate public frontend/backend domain on Railway, use `SESSION_COOKIE_SECURE=true` and `SESSION_COOKIE_SAMESITE=None`.
- Session cookies prevent exposing a shared API key in the browser. They do not prove a visitor is human by themselves; add a CAPTCHA provider such as Cloudflare Turnstile before `/session` for real human verification.

```bash
npm install
npm run dev
```

Open the UI at:

```text
http://localhost:5173
```

The local services run on:

- Web UI: `http://localhost:5173`
- Orchestrator API: `http://localhost:4000`
- Jira Agent: `http://localhost:4101`
- GitHub Agent: `http://localhost:4102`
- PagerDuty Agent: `http://localhost:4103`
- Security/OAuth Agent: `http://localhost:4104`
- API Health Agent: `http://localhost:4105`

## Try it

Send this message in the chat UI:

```text
Jira sync fails with 403 when creating issues
```

Expected result:

- System: Jira
- Error code: 403
- Issue type: `AUTHORIZATION_FAILURE`
- Selected agents: `jira-agent`, `security-oauth-agent`
- A2A conversation trace showing user submission, classification, Agent Card selection, task delivery, evidence checks, and final diagnosis
- Security decision allowing `servicenow-orchestrator-agent` to call `security-oauth-agent` for `security.scope.compare`
- Probable cause: missing OAuth scope `write:jira-work`
- Recommended fix: add the missing scope and reauthorize the Jira OAuth app

The UI also includes demo buttons for GitHub rate limit, PagerDuty alert failure, and SAP 401 invalid client scenarios. GitHub Rate Limit is fully wired with local mock data. PagerDuty has a local mock A2A diagnosis path; SAP is still routed through the security agent in this step.

GitHub Rate Limit input:

```text
GitHub repository sync started failing with 403 during nightly scan
```

Expected GitHub result:

- System: GitHub
- Error code: 403
- Issue type: `RATE_LIMIT`
- Operation: `repository_scan`
- Initial selected agent: `github-agent`
- GitHub Agent requests mediated delegation to `api-health-agent` for `api_health.diagnose_rate_limit`
- A2A conversation trace shows the GitHub delegation request, orchestrator validation, policy decision, and mediated API Health task
- Probable cause: GitHub API rate limit was exhausted during the nightly repository scan
- Recommended fix: throttle scan concurrency, add retry/backoff handling, and schedule repository scans in batches

## Notes

- No production-grade OAuth/OIDC is implemented yet. The demo includes API key/session protection for the orchestrator and internal service tokens for mock agent calls.
- No real Jira, GitHub, PagerDuty, SAP, or OAuth APIs are called.
- All enterprise evidence comes from JSON files in `mock-data`.

## Architecture note

This project simulates a ServiceNow-style AI Orchestrator Agent coordinating with external enterprise agents through A2A-like task conversations.

- The ServiceNow Orchestrator Agent owns intake, classification, Agent Card based routing, task creation, response collection, and final support/incident-style summarization.
- External enterprise agents own system-specific mock knowledge and tools. Jira troubleshooting belongs in `jira-agent`, GitHub repository/API troubleshooting belongs in `github-agent`, PagerDuty alert ingestion belongs in `pagerduty-agent`, and OAuth/security posture belongs in `security-oauth-agent`.
- Each external agent owns and serves its Agent Card from `/agent-card`. The orchestrator discovers Agent Cards from those endpoints at startup and uses the local static cards only as a fallback if discovery fails.
- A2A task envelopes include `taskId`, `conversationId`, `fromAgent`, `toAgent`, `mediatedBy` for delegated tasks, `skillId`, support context, target audience, requested scope, and `authMode: "mock_internal_token"`.
- Security allow/block decisions remain deterministic and policy-based. The LLM may detect or route a requested action, but `policyEngine.ts` maps the action to permissions and returns the decision.

The orchestrator does not need to know every Jira/GitHub/PagerDuty issue. It selects the external agent that owns the system and summarizes that agent's diagnosis. Everything remains local and mock-based for now; no real enterprise APIs or OAuth flows are called.
