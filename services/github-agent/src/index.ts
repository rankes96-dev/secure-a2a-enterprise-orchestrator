import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
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

const port = Number(process.env.PORT ?? process.env.GITHUB_AGENT_PORT ?? 4102);
const a2aAuthMode = assertSecureA2AAuthMode("github-agent");
type GitHubRateLimitEvent = {
  integration: string;
  operation: string;
  status: number;
  headers: {
    "x-ratelimit-remaining": string;
    "x-ratelimit-reset": string;
  };
  token: {
    type: string;
    permissions: string[];
    samlSsoAuthorized: boolean;
  };
};

const agentCard = withOgenAgentCardProvenance({
  agentId: "github-agent",
  name: "GitHub Agent",
  description: "External GitHub support agent that owns GitHub API/repository troubleshooting knowledge.",
  systems: ["GitHub"],
  endpoint: process.env.GITHUB_AGENT_URL ?? "http://localhost:4102/task",
  auth: { type: a2aAuthMode, audience: "github-agent" },
  compatibility: OGEN_A2A_AGENT_CARD_COMPATIBILITY,
  skills: [
    {
      id: "github.diagnose_repo_access_issue",
      name: "Diagnose repo access issue",
      description: "Diagnose repository or organization access problems.",
      capabilities: ["github.repository_access.diagnose"],
      requestedAction: "github.repository_access.diagnose",
      requiredPermission: "github.diagnose",
      requiredScopes: ["github.diagnose"],
      riskLevel: "medium",
      owner: "GitHub Support Team"
    },
    {
      id: "github.diagnose_repository_scan_failure",
      name: "Diagnose repository scan failure",
      description: "Diagnose repository sync or scan failures.",
      capabilities: ["github.repository_scan.diagnose"],
      requestedAction: "github.repository_scan.diagnose",
      requiredPermission: "github.diagnose",
      requiredScopes: ["github.diagnose"],
      priority: 90,
      owner: "GitHub Integration Team",
      scope: { systems: ["github"], resourceTypes: ["repository"] },
      riskLevel: "medium"
    },
    {
      id: "github.diagnose_rate_limit",
      name: "Diagnose rate limit",
      description: "Diagnose GitHub API rate limit exhaustion.",
      capabilities: ["github.rate_limit.diagnose"],
      requestedAction: "github.rate_limit.read",
      requiredPermission: "github.rate_limit.read",
      requiredScopes: ["github.rate_limit.read"],
      riskLevel: "low",
      owner: "GitHub Integration Team"
    }
  ]
}, { issuer: "ogen.local-agent:github-agent", signaturePresent: false });

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

async function loadEvents(): Promise<GitHubRateLimitEvent[]> {
  const filePath = path.resolve(process.cwd(), "../../mock-data/github-events.json");
  return JSON.parse(await readFile(filePath, "utf8")) as GitHubRateLimitEvent[];
}

startJsonServer(port, async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { status: "ok", agentId: "github-agent" }, request);
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

    sendTaskResult(response, request, taskInput, task, result);
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
      },
      ...("context" in task && task.context.auth?.tokenValidated
        ? [
            {
              agent: "github-agent",
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
