import dotenv from "dotenv";
import type { A2AAgentResponse, A2ATask, AgentTask } from "@a2a/shared";
import { formatA2AAuthTraceDetail, requireA2AAuth } from "@a2a/shared";
import { readJsonBody, sendJson, startJsonServer } from "@a2a/shared/src/http";

dotenv.config({ path: new URL("../../orchestrator-api/.env", import.meta.url) });

const port = Number(process.env.PORT ?? process.env.END_USER_TRIAGE_AGENT_PORT ?? 4106);
const agentCard = {
  agentId: "end-user-triage-agent",
  name: "End User Triage Agent",
  description: "Interprets non-technical user complaints and converts them into support context.",
  systems: ["Jira", "GitHub", "PagerDuty", "SAP", "Confluence", "Monday"],
  endpoint: process.env.END_USER_TRIAGE_AGENT_URL ?? "http://localhost:4106/task",
  auth: { type: "mock_internal_token", audience: "end-user-triage-agent" },
  skills: [
    {
      id: "end_user.triage",
      name: "End user triage",
      description: "Interpret a plain-language support issue.",
      capabilities: ["enterprise.issue.triage"],
      requestedAction: "enterprise.issue.triage",
      requiredPermission: "enterprise.triage",
      requiredScopes: ["enterprise.triage"],
      riskLevel: "low",
      owner: "Enterprise Support Triage"
    },
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
  const skillId = "skillId" in task ? task.skillId : undefined;
  const lowerMessage = message.toLowerCase();
  const needsMoreInfo = task.classification.issueType === "UNKNOWN";
  const genericEnterpriseTriage = skillId === "end_user.triage" && task.classification.system === "Unknown";

  if (genericEnterpriseTriage) {
    const loginIssue = ["login", "log in", "sign in", "signin", "sso", "saml", "password", "authentication"].some((term) => lowerMessage.includes(term));
    const pipelineIssue = ["pipeline", "deployment", "deploy", "build", "release", "artifact", "stage"].some((term) => lowerMessage.includes(term));
    const connectivityIssue = ["vpn", "connect", "timeout", "dns", "tls", "network"].some((term) => lowerMessage.includes(term));
    const clarifyingQuestions = loginIssue
      ? [
          "Which system or tool are you trying to log in to?",
          "Is this happening in production, staging, or another environment?",
          "What is the exact login error message?",
          "Does this affect only you, a group, or all users?",
          "Is login handled through SSO, MFA, Okta, Entra, or another identity provider?"
        ]
      : pipelineIssue
        ? [
            "Which pipeline, CI/CD tool, or internal deployment system is failing?",
            "Which stage failed: build, test, deployment, approval, artifact publish, or notification?",
            "What is the exact error message or code?",
            "What changed yesterday?",
            "Is this affecting one service, one repository, or all deployments?"
          ]
        : connectivityIssue
          ? [
              "Which system, endpoint, or network path is affected?",
              "Is this happening in production, staging, or another environment?",
              "What is the exact connection, timeout, DNS, TLS, or network error?",
              "Does this affect one user/service or all users/services?",
              "When did it start?"
            ]
          : [
              "Which system or tool is affected?",
              "What action failed?",
              "What is the exact error message or code?",
              "When did it start?",
              "Does this affect one user/service or many users/services?"
            ];
    const recommendedActions = [
      "Provide the affected system/tool and environment.",
      "Include the exact error message and timestamp.",
      "Confirm who or what is affected and whether there was a recent change."
    ];
    const result: A2AAgentResponse = {
      agentId: "end-user-triage-agent",
      status: "needs_more_info",
      summary: loginIssue
        ? "Enterprise triage needs more information to identify the owner of this login/authentication issue."
        : "Enterprise triage needs more information to identify the correct specialist owner.",
      probableCause: "Insufficient ownership and failure details to route to a specialist agent.",
      clarifyingQuestions,
      recommendedActions,
      evidence: [
        {
          title: "Enterprise triage context",
          data: {
            affectedSystem: task.classification.system,
            userFacingSymptom: message,
            likelyTechnicalCategory: task.classification.issueType,
            needsMoreInfo: true,
            missingContext: loginIssue
              ? ["system/tool", "environment", "exact login error", "affected users", "identity provider"]
              : pipelineIssue
                ? ["pipeline/tool name", "failing stage", "exact error", "recent change", "blast radius"]
                : ["system/tool", "failed action", "exact error", "start time", "blast radius"]
          }
        }
      ],
      trace: [
        {
          agent: "end-user-triage-agent",
          action: "enterprise_triage_needs_context",
          detail: loginIssue
            ? "Requested system, environment, exact-login-error, affected-user, and identity-provider details for enterprise triage."
            : "Requested ownership, failing-stage, exact-error, recent-change, and blast-radius details for enterprise triage.",
          timestamp: new Date().toISOString()
        },
        ...("context" in task && task.context.auth?.tokenValidated
          ? [
              {
                agent: "end-user-triage-agent",
                action: "A2A_JWT_VALIDATED",
                detail: formatA2AAuthTraceDetail(task.context.auth),
                timestamp: new Date().toISOString()
              }
            ]
          : [])
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
      },
      ...("context" in task && task.context.auth?.tokenValidated
        ? [
            {
              agent: "end-user-triage-agent",
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
