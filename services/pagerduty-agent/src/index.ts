import dotenv from "dotenv";
import type { A2AAgentResponse, A2ATask, AgentTask } from "@a2a/shared";
import { readJsonBody, requireInternalServiceToken, sendJson, startJsonServer } from "@a2a/shared/src/http";

dotenv.config({ path: new URL("../../orchestrator-api/.env", import.meta.url) });

const port = Number(process.env.PORT ?? 4103);

startJsonServer(port, async (request, response) => {
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
