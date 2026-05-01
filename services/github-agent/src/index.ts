import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { A2AAgentResponse, A2ATask, AgentTask, GitHubRateLimitEvent } from "@a2a/shared";
import { readJsonBody, requireInternalServiceToken, sendJson, startJsonServer } from "@a2a/shared/src/http";

dotenv.config({ path: new URL("../../orchestrator-api/.env", import.meta.url) });

const port = Number(process.env.PORT ?? 4102);
const agentCard = {
  agentId: "github-agent",
  name: "GitHub Agent",
  description: "External GitHub support agent that owns GitHub API/repository troubleshooting knowledge.",
  systems: ["GitHub"],
  endpoint: process.env.GITHUB_AGENT_URL ?? "http://localhost:4102/task",
  auth: { type: "mock_internal_token", audience: "github-agent" },
  skills: [
    { id: "github.diagnose_repo_access_issue", name: "Diagnose repo access issue", description: "Diagnose repository or organization access problems.", capabilities: ["github.repository_access.diagnose"] },
    {
      id: "github.diagnose_repository_scan_failure",
      name: "Diagnose repository scan failure",
      description: "Diagnose repository sync or scan failures.",
      capabilities: ["github.repository_scan.diagnose"],
      riskLevel: "medium"
    },
    { id: "github.diagnose_rate_limit", name: "Diagnose rate limit", description: "Diagnose GitHub API rate limit exhaustion.", capabilities: ["github.rate_limit.diagnose"] }
  ]
};

async function loadEvents(): Promise<GitHubRateLimitEvent[]> {
  const filePath = path.resolve(process.cwd(), "../../mock-data/github-events.json");
  return JSON.parse(await readFile(filePath, "utf8")) as GitHubRateLimitEvent[];
}

startJsonServer(port, async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { status: "ok", agentId: "github-agent" }, request);
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
  const events = await loadEvents();
  const event = events.find((item) => item.operation === task.classification.operation);

  if (!event) {
    const result: A2AAgentResponse = {
      agentId: "github-agent",
      status: "needs_more_info",
      summary: "GitHub Agent needs repository context before it can diagnose this issue.",
      clarifyingQuestions: ["Which repository or organization is affected?", "What exact GitHub error message is shown?"],
      evidence: [
        {
          title: "GitHub repository access signal",
          data: {
            system: "GitHub",
            symptom: "User reports missing repository access",
            likelyCategory: "repository_permission_or_organization_access",
            needsMoreInfo: true,
            requestedDetails: ["repository name", "organization", "exact access message"]
          }
        }
      ],
      trace: [
        {
          agent: "github-agent",
          action: "inspect_repository_access_symptom",
          detail: "Captured user-facing GitHub repository access complaint",
          timestamp: new Date().toISOString()
        }
      ]
    };

    sendJson(response, 200, result);
    return;
  }

  const result: A2AAgentResponse = {
    agentId: "github-agent",
    status: "diagnosed",
    summary: "GitHub repository scan is failing because the scan exhausted GitHub API rate limit capacity.",
    probableCause: "GitHub API rate limit was exhausted during the nightly repository scan.",
    recommendedActions: ["Check x-ratelimit-remaining and x-ratelimit-reset", "Reduce scan concurrency", "Add retry and backoff", "Batch repository scans"],
    requestedDelegations: [
      {
        targetAgentId: "api-health-agent",
        skillId: "api_health.diagnose_rate_limit",
        reason: "Need API Health Agent to validate rate-limit and throttling evidence.",
        context: {
          observedStatus: event.status,
          rateLimitRemaining: event.headers["x-ratelimit-remaining"],
          operation: event.operation
        }
      }
    ],
    evidence: [
      {
        title: "Mock GitHub API rate limit response",
        data: { ...event }
      }
    ],
    trace: [
      {
        agent: "github-agent",
        action: "inspect_rate_limit_headers",
        detail: `Found ${event.status} with x-ratelimit-remaining=${event.headers["x-ratelimit-remaining"]}`,
        timestamp: new Date().toISOString()
      }
    ]
  };

  sendJson(response, 200, result);
});
