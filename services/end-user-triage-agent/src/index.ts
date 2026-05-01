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
    { id: "end_user.triage", name: "End user triage", description: "Interpret a plain-language support issue.", capabilities: ["enterprise.issue.triage"] },
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
  const skillId = "skillId" in task ? task.skillId : undefined;
  const needsMoreInfo = task.classification.issueType === "UNKNOWN";
  const genericEnterpriseTriage = skillId === "end_user.triage" && task.classification.system === "Unknown";

  if (genericEnterpriseTriage) {
    const result: A2AAgentResponse = {
      agentId: "end-user-triage-agent",
      status: "needs_more_info",
      summary: "Enterprise triage needs more information to identify the correct specialist owner.",
      probableCause: "Insufficient ownership and failure details to route to a specialist agent.",
      clarifyingQuestions: [
        "Which pipeline or tool is failing, for example GitHub Actions, Jenkins, Azure DevOps, GitLab CI, or an internal deployment system?",
        "Which stage failed: build, test, deployment, approval, artifact publish, or notification?",
        "What is the exact error message or code?",
        "What changed yesterday?",
        "Is this affecting one service, one repository, or all deployments?"
      ],
      recommendedActions: [
        "Provide the pipeline/tool name and failing stage.",
        "Include the exact error message and timestamp.",
        "Attach the recent change or deployment reference if available."
      ],
      evidence: [
        {
          title: "Enterprise triage context",
          data: {
            affectedSystem: task.classification.system,
            userFacingSymptom: message,
            likelyTechnicalCategory: task.classification.issueType,
            needsMoreInfo: true,
            missingContext: ["pipeline/tool name", "failing stage", "exact error", "recent change", "blast radius"]
          }
        }
      ],
      trace: [
        {
          agent: "end-user-triage-agent",
          action: "enterprise_triage_needs_context",
          detail: "Requested ownership, failing-stage, exact-error, recent-change, and blast-radius details for enterprise triage.",
          timestamp: new Date().toISOString()
        }
      ]
    };

    sendJson(response, 200, result);
    return;
  }

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
