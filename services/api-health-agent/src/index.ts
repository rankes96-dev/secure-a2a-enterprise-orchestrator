import dotenv from "dotenv";
import type { A2AAgentResponse, A2ATask, AgentTask } from "@a2a/shared";
import {
  A2A_AGENT_CARD_WELL_KNOWN_PATH,
  A2A_CONTENT_TYPE,
  OGEN_A2A_AGENT_CARD_COMPATIBILITY,
  assertSecureA2AAuthMode,
  buildUnsupportedA2AProtocolVersionResponse,
  formatA2AAuthTraceDetail,
  internalA2AResponseToOutboundA2AEnvelope,
  normalizeA2ATaskInput,
  requireA2AAuth,
  unsupportedExplicitA2AProtocolVersion,
  withOgenAgentCardProvenance
} from "@a2a/shared";
import { readJsonBody, sendJson, startJsonServer } from "@a2a/shared/http";

dotenv.config({ path: new URL("../../orchestrator-api/.env", import.meta.url) });

const port = Number(process.env.PORT ?? process.env.API_HEALTH_AGENT_PORT ?? 4105);
const a2aAuthMode = assertSecureA2AAuthMode("api-health-agent");
const agentCard = withOgenAgentCardProvenance({
  agentId: "api-health-agent",
  name: "API Health Agent",
  description: "API health agent that evaluates rate limits, latency, connectivity, 5xx, DNS, TLS, and webhook delivery.",
  systems: ["API", "GitHub", "PagerDuty", "Jira", "SAP", "Confluence", "Monday"],
  endpoint: process.env.API_HEALTH_AGENT_URL ?? "http://localhost:4105/task",
  auth: { type: a2aAuthMode, audience: "api-health-agent" },
  compatibility: OGEN_A2A_AGENT_CARD_COMPATIBILITY,
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
}, { issuer: "ogen.local-agent:api-health-agent", signaturePresent: false });

function requiredScopeForTask(task: A2ATask | AgentTask): string | undefined {
  const skillId = "skillId" in task ? task.skillId : undefined;
  const skill = agentCard.skills.find((item) => item.id === skillId);
  return skill?.requiredPermission ?? skill?.requiredScopes?.[0];
}

type NormalizedA2ATaskInput = Extract<ReturnType<typeof normalizeA2ATaskInput>, { ok: true }>;

function sendTaskResult(
  response: Parameters<typeof sendJson>[0],
  request: NonNullable<Parameters<typeof sendJson>[3]>,
  taskInput: NormalizedA2ATaskInput,
  task: A2ATask | AgentTask,
  result: A2AAgentResponse,
  statusCode = 200
): void {
  if (taskInput.requestedCompatibilityEnvelope) {
    sendJson(
      response,
      statusCode,
      internalA2AResponseToOutboundA2AEnvelope(result, taskInput.proof, {
        taskId: "taskId" in task ? task.taskId : undefined,
        contextId: "conversationId" in task ? task.conversationId : undefined,
        agentId: agentCard.agentId
      }),
      request,
      { "content-type": A2A_CONTENT_TYPE }
    );
    return;
  }

  sendJson(response, statusCode, result, request);
}

startJsonServer(port, async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { status: "ok", agentId: "api-health-agent" }, request);
    return;
  }

  if (request.method === "GET" && (request.url === "/agent-card" || request.url === A2A_AGENT_CARD_WELL_KNOWN_PATH)) {
    sendJson(response, 200, agentCard, request, { "content-type": A2A_CONTENT_TYPE });
    return;
  }

  if (request.method !== "POST" || request.url !== "/task") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const unsupportedVersion = unsupportedExplicitA2AProtocolVersion(request.headers);
  if (unsupportedVersion) {
    sendJson(response, 400, buildUnsupportedA2AProtocolVersionResponse(unsupportedVersion), request, { "content-type": A2A_CONTENT_TYPE });
    return;
  }

  const taskInput = normalizeA2ATaskInput(await readJsonBody<unknown>(request), { toAgent: agentCard.agentId });
  if (!taskInput.ok) {
    sendJson(response, 400, taskInput.response, request, { "content-type": A2A_CONTENT_TYPE });
    return;
  }

  const task = taskInput.value;
  const auth = await requireA2AAuth({
    request,
    task,
    agentId: agentCard.agentId,
    expectedAudience: agentCard.auth.audience,
    requiredScope: requiredScopeForTask(task)
  });
  if (!auth.ok) {
    sendTaskResult(response, request, taskInput, task, auth.response, auth.statusCode);
    return;
  }
  if ("context" in task && auth.taskAuth) {
    task.context.auth = auth.taskAuth;
  }

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
      },
      ...("context" in task && task.context.auth?.tokenValidated
        ? [
            {
              agent: "api-health-agent",
              action: "A2A_JWT_VALIDATED",
              detail: formatA2AAuthTraceDetail(task.context.auth),
              timestamp: new Date().toISOString()
            }
          ]
        : [])
    ]
  };

  sendTaskResult(response, request, taskInput, task, result);
});
