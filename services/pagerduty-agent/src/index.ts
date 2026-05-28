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
  unsupportedExplicitA2AProtocolVersion
} from "@a2a/shared";
import { readJsonBody, sendJson, startJsonServer } from "@a2a/shared/http";

dotenv.config({ path: new URL("../../orchestrator-api/.env", import.meta.url) });

const port = Number(process.env.PORT ?? process.env.PAGERDUTY_AGENT_PORT ?? 4103);
const a2aAuthMode = assertSecureA2AAuthMode("pagerduty-agent");
const agentCard = {
  agentId: "pagerduty-agent",
  name: "PagerDuty Agent",
  description: "External PagerDuty support agent that owns alert/incident ingestion troubleshooting knowledge.",
  systems: ["PagerDuty"],
  endpoint: process.env.PAGERDUTY_AGENT_URL ?? "http://localhost:4103/task",
  auth: { type: a2aAuthMode, audience: "pagerduty-agent" },
  compatibility: OGEN_A2A_AGENT_CARD_COMPATIBILITY,
  skills: [
    {
      id: "pagerduty.diagnose_alert_ingestion_failure",
      name: "Diagnose alert ingestion failure",
      description: "Diagnose alerts that do not open incidents.",
      capabilities: ["incident.alert_ingestion.diagnose"],
      requestedAction: "pagerduty.alert_ingestion.diagnose",
      requiredPermission: "pagerduty.diagnose",
      requiredScopes: ["pagerduty.diagnose"],
      priority: 90,
      owner: "Incident Operations Team",
      scope: { systems: ["pagerduty"], resourceTypes: ["alert", "incident"] },
      riskLevel: "low"
    },
    { id: "pagerduty.diagnose_event_rate_limit", name: "Diagnose event rate limit", description: "Diagnose event ingestion rate limiting." }
  ]
};

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
    sendJson(response, 200, { status: "ok", agentId: "pagerduty-agent" }, request);
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

  const message = "userMessage" in task ? task.userMessage : task.message;
  const hasAlertContext = /alert|incident|event/i.test(message);

  const result: A2AAgentResponse = {
    agentId: "pagerduty-agent",
    status: hasAlertContext ? "diagnosed" : "unsupported",
    summary: hasAlertContext
      ? "PagerDuty Agent would inspect mock alert ingestion and incident creation signals for this issue."
      : "PagerDuty Agent does not have enough alert or incident context.",
    probableCause: hasAlertContext ? "Alert ingestion may be rate limited or failing before incident creation." : undefined,
    recommendedActions: hasAlertContext ? ["Check event ingestion rate", "Enable retry/backoff", "Queue failed events"] : undefined,
    evidence: hasAlertContext
      ? [
          {
            title: "Mock PagerDuty alert ingestion signal",
            data: {
              system: "PagerDuty",
              skillId: "skillId" in task ? task.skillId : undefined,
              message
            }
          }
        ]
      : [],
    trace: [
      {
        agent: "pagerduty-agent",
        action: hasAlertContext ? "inspect_alert_ingestion" : "idle",
        detail: hasAlertContext ? "Prepared mock PagerDuty alert ingestion diagnosis" : "PagerDuty agent was not needed for this scenario",
        timestamp: new Date().toISOString()
      },
      ...("context" in task && task.context.auth?.tokenValidated
        ? [
            {
              agent: "pagerduty-agent",
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
