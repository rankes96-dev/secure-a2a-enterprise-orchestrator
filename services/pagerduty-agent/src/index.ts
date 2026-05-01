import dotenv from "dotenv";
import type { A2AAgentResponse, A2ATask, AgentTask } from "@a2a/shared";
import { readJsonBody, requireInternalServiceToken, sendJson, startJsonServer } from "@a2a/shared/src/http";

dotenv.config({ path: new URL("../../orchestrator-api/.env", import.meta.url) });

const port = Number(process.env.PORT ?? 4103);
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
      capabilities: ["incident.alert_ingestion.diagnose"]
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

  if (!requireInternalServiceToken(request, response)) {
    return;
  }

  const task = await readJsonBody<A2ATask | AgentTask>(request);
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
      }
    ]
  };

  sendJson(response, 200, result);
});
