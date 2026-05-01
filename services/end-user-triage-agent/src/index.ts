import dotenv from "dotenv";
import type { A2AAgentResponse, A2ATask, AgentTask } from "@a2a/shared";
import { readJsonBody, requireInternalServiceToken, sendJson, startJsonServer } from "@a2a/shared/src/http";

dotenv.config({ path: new URL("../../orchestrator-api/.env", import.meta.url) });

const port = Number(process.env.PORT ?? 4106);
const agentCard = {
  agentId: "end-user-triage-agent",
  name: "End User Triage Agent",
  description: "Interprets non-technical user complaints and converts them into support context.",
  systems: ["Jira", "GitHub", "PagerDuty", "SAP", "Confluence", "Monday"],
  endpoint: process.env.END_USER_TRIAGE_AGENT_URL ?? "http://localhost:4106/task",
  auth: { type: "mock_internal_token", audience: "end-user-triage-agent" },
  skills: [
    { id: "end_user.triage", name: "End user triage", description: "Interpret a plain-language support issue." },
    {
      id: "end_user.ask_clarifying_questions",
      name: "Ask clarifying questions",
      description: "Ask for the missing action, error, or affected record when the issue is vague."
    },
    {
      id: "end_user.summarize_user_friendly",
      name: "User-friendly summary",
      description: "Convert technical findings into simple support language."
    }
  ]
};

startJsonServer(port, async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { status: "ok", agentId: "end-user-triage-agent" }, request);
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
