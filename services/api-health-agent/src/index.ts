import dotenv from "dotenv";
import type { A2AAgentResponse, A2ATask, AgentTask } from "@a2a/shared";
import { readJsonBody, requireInternalServiceToken, sendJson, startJsonServer } from "@a2a/shared/src/http";

dotenv.config({ path: new URL("../../orchestrator-api/.env", import.meta.url) });

const port = Number(process.env.PORT ?? 4105);

startJsonServer(port, async (request, response) => {
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
