import dotenv from "dotenv";
import type { A2AAgentResponse, A2ATask, AgentTask } from "@a2a/shared";
import { readJsonBody, requireInternalServiceToken, sendJson, startJsonServer } from "@a2a/shared/src/http";

dotenv.config({ path: new URL("../../orchestrator-api/.env", import.meta.url) });

const port = Number(process.env.PORT ?? 4105);
const agentCard = {
  agentId: "api-health-agent",
  name: "API Health Agent",
  description: "API health agent that evaluates rate limits, latency, connectivity, 5xx, DNS, TLS, and webhook delivery.",
  systems: ["API", "GitHub", "PagerDuty", "Jira", "SAP", "Confluence", "Monday"],
  endpoint: process.env.API_HEALTH_AGENT_URL ?? "http://localhost:4105/task",
  auth: { type: "mock_internal_token", audience: "api-health-agent" },
  skills: [
    { id: "api_health.diagnose_rate_limit", name: "Diagnose rate limit", description: "Diagnose rate-limit and throttling failures.", capabilities: ["api.rate_limit.diagnose", "api.health.diagnose"], requestedAction: "api.health.read", requiredPermission: "apihealth.read", requiredScopes: ["apihealth.read"], priority: 70, owner: "API Reliability Team", scope: { resourceTypes: ["api", "rate_limit"] }, riskLevel: "low" },
    {
      id: "api_health.diagnose_connectivity_failure",
      name: "Diagnose connectivity failure",
      description: "Diagnose timeout, DNS, TLS, and connectivity failures.",
      capabilities: ["api.connectivity.diagnose", "api.health.diagnose"],
      requestedAction: "api.health.read",
      requiredPermission: "apihealth.read",
      requiredScopes: ["apihealth.read"],
      priority: 70,
      owner: "API Reliability Team",
      scope: { resourceTypes: ["api"] },
      riskLevel: "low"
    },
    {
      id: "api_health.diagnose_webhook_delivery",
      name: "Diagnose webhook delivery",
      description: "Diagnose webhook delivery and callback failures.",
      capabilities: ["api.webhook_delivery.diagnose", "api.health.diagnose"],
      requestedAction: "api.health.read",
      requiredPermission: "apihealth.read",
      requiredScopes: ["apihealth.read"],
      priority: 70,
      owner: "API Reliability Team",
      scope: { resourceTypes: ["api", "webhook"] },
      riskLevel: "low"
    }
  ]
};

startJsonServer(port, async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { status: "ok", agentId: "api-health-agent" }, request);
    return;
  }

  if (request.method === "GET" && request.url === "/agent-card") {
    sendJson(response, 200, agentCard, request);
    return;
  }

  if (request.method !== "POST" || request.url !== "/task") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (!requireInternalServiceToken(request, response)) {
    return;
  }

  const task = await readJsonBody<A2ATask | AgentTask>(request);
  const isGitHubRateLimit = task.classification.system === "GitHub" && task.classification.issueType === "RATE_LIMIT";

  const result: A2AAgentResponse = {
    agentId: "api-health-agent",
    status: isGitHubRateLimit ? "diagnosed" : "unsupported",
    summary: isGitHubRateLimit
      ? "API Health Agent confirmed a rate-limit health signal for the GitHub repository scan."
      : "API Health Agent has no scenario-specific mock health signal for this issue.",
    probableCause: isGitHubRateLimit ? "Repository scan traffic exhausted available API capacity." : undefined,
    recommendedActions: isGitHubRateLimit ? ["Throttle scan concurrency", "Add retry/backoff", "Schedule scans in smaller batches"] : undefined,
    evidence: [
      {
        title: isGitHubRateLimit ? "GitHub API rate-limit health check" : "API health check",
        data: isGitHubRateLimit
          ? {
              healthSignal: "rate_limit_exhausted",
              status: 403,
              rateLimitRemaining: 0,
              recommendedControl: "batch_scans_with_backoff"
            }
          : {
              healthSignal: "not_implemented_for_scenario",
              note: "No API health mock is defined for this scenario yet."
            }
      }
    ],
    trace: [
      {
        agent: "api-health-agent",
        action: isGitHubRateLimit ? "check_rate_limit_health" : "check_api_health",
        detail: isGitHubRateLimit ? "Confirmed API health signal is rate-limit exhaustion" : "No scenario-specific API health mock found",
        timestamp: new Date().toISOString()
      }
    ]
  };

  sendJson(response, 200, result);
});
