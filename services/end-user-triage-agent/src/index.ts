import dotenv from "dotenv";
import type { A2AAgentResponse, A2ATask, AgentTask } from "@a2a/shared";
import { readJsonBody, requireInternalServiceToken, sendJson, startJsonServer } from "@a2a/shared/src/http";

dotenv.config({ path: new URL("../../orchestrator-api/.env", import.meta.url) });

const port = Number(process.env.PORT ?? 4106);

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
  const needsMoreInfo = task.classification.issueType === "UNKNOWN";
  const result: A2AAgentResponse = {
    agentId: "end-user-triage-agent",
    status: needsMoreInfo ? "needs_more_info" : "diagnosed",
    summary: needsMoreInfo
      ? "The external triage agent needs more information before routing this issue."
      : "The external triage agent translated the user complaint into support context.",
    clarifyingQuestions: needsMoreInfo
      ? ["What action failed?", "What exact error message or code do you see?", "Which record, board, project, repository, or integration is affected?"]
      : undefined,
    recommendedActions: needsMoreInfo ? undefined : ["Use the specialist agent response for the system-specific diagnosis."],
    evidence: [
      {
        title: "End-user symptom interpretation",
        data: {
          affectedSystem: task.classification.system,
          userFacingSymptom: message,
          likelyTechnicalCategory: task.classification.issueType,
          needsMoreInfo,
          suggestedNextQuestions: [
            "What exact error message do you see?",
            "Does this happen for every item or only one?",
            "Did this work before?"
          ]
        }
      }
    ],
    trace: [
      {
        agent: "end-user-triage-agent",
        action: "interpret_user_complaint",
        detail: `Interpreted complaint as ${task.classification.system} / ${task.classification.issueType}`,
        timestamp: new Date().toISOString()
      }
    ]
  };

  sendJson(response, 200, result);
});
