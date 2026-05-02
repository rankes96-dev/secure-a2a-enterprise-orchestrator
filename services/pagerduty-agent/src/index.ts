import dotenv from "dotenv";
import type { A2AAgentResponse, A2ATask, AgentTask } from "@a2a/shared";
import { formatA2AAuthTraceDetail, requireA2AAuth } from "@a2a/shared";
import { readJsonBody, sendJson, startJsonServer } from "@a2a/shared/src/http";

dotenv.config({ path: new URL("../../orchestrator-api/.env", import.meta.url) });

const port = Number(process.env.PORT ?? process.env.PAGERDUTY_AGENT_PORT ?? 4103);
const agentCard = {
  agentId: "pagerduty-agent",
  name: "PagerDuty Agent",
  description: "External PagerDuty support agent that owns alert/incident ingestion troubleshooting knowledge.",
  systems: ["PagerDuty"],
  endpoint: process.env.PAGERDUTY_AGENT_URL ?? "http://localhost:4103/task",
  auth: { type: "mock_internal_token", audience: "pagerduty-agent" },
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

startJsonServer(port, async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { status: "ok", agentId: "pagerduty-agent" }, request);
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

  const task = await readJsonBody<A2ATask | AgentTask>(request);
  const auth = await requireA2AAuth({
    request,
    task,
    agentId: agentCard.agentId,
    expectedAudience: agentCard.auth.audience
  });
  if (!auth.ok) {
    sendJson(response, auth.statusCode, auth.response, request);
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

  sendJson(response, 200, result);
});
