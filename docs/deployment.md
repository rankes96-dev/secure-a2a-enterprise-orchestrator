# Deployment Readiness

This V1 demo is designed for a split deployment where the browser UI, Gateway API, Redis/session storage, and external connector agents run as separate services.

## Architecture

- Web UI on Vercel.
- Orchestrator API on Railway.
- Redis on Railway or Upstash.
- External agents as separate Railway services:
  - `real-external-agent-jira`
  - `real-external-agent-servicenow`
  - `real-external-agent-github`

## Required Environment Variables

### Vercel

- `VITE_ORCHESTRATOR_API_URL=https://<orchestrator>.railway.app`

### Orchestrator Railway Service

- `PORT`
- `NODE_ENV=production`
- `REDIS_URL`
- `WEB_ORIGIN=https://<vercel-app>.vercel.app`
- `CORS_ALLOWED_ORIGINS=https://<vercel-app>.vercel.app`
- JWT or signing environment variables used by the deployment.
- OpenRouter or other AI provider variables if enabled.
- External agent base URLs if the deployment preconfigures agents, otherwise use the public discovery URLs entered during onboarding.

### External Agent Railway Services

- `PORT`
- `PUBLIC_BASE_URL=https://<agent>.railway.app`
- `ORCHESTRATOR_BASE_URL=https://<orchestrator>.railway.app` if the agent needs to call back to the Gateway.
- Connector-specific demo variables.

Do not expose secrets to the frontend. Public browser configuration should only contain the orchestrator URL and other non-secret values.

## Production Notes

- Do not assume localhost agent URLs work in production.
- Each external agent needs a public HTTPS URL.
- Gateway onboarding must use the public Railway agent URL.
- Redis/session storage must be configured before multi-instance deployment.
- Vercel/Railway CORS must allow the frontend origin to call the orchestrator.
- External agents should be deployed before running onboarding in production.

## Checklist

1. Deploy the orchestrator API to Railway.
2. Deploy Redis on Railway or Upstash and set `REDIS_URL`.
3. Deploy the external connector agents as separate Railway services.
4. Configure the Vercel environment with `VITE_ORCHESTRATOR_API_URL`.
5. Open the Web UI.
6. Select BizApps / IT mode.
7. Onboard each external agent using its public HTTPS Railway URL.
8. Run Connector Test Center validation tests.
