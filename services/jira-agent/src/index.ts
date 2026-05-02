import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { A2AAgentResponse, A2ATask, AgentTask } from "@a2a/shared";
import { formatA2AAuthTraceDetail, requireA2AAuth } from "@a2a/shared";
import { readJsonBody, sendJson, startJsonServer } from "@a2a/shared/src/http";

dotenv.config({ path: new URL("../../orchestrator-api/.env", import.meta.url) });

const port = Number(process.env.JIRA_AGENT_PORT ?? 4101);
type JiraOperationRequirement = {
  operation: string;
  requiredScopes: string[];
};

const agentCard = {
  agentId: "jira-agent",
  name: "Jira Agent",
  description: "External Jira support agent that owns Jira-specific troubleshooting knowledge.",
  systems: ["Jira"],
  endpoint: process.env.JIRA_AGENT_URL ?? "http://localhost:4101/task",
  auth: { type: "mock_internal_token", audience: "jira-agent" },
  skills: [
    {
      id: "jira.diagnose_user_permission_issue",
      name: "Diagnose Jira user permission issue",
      description: "Diagnose user-facing Jira permission problems.",
      capabilities: ["jira.permission.diagnose"],
      supportingCapabilities: ["oauth.scope.compare"],
      requestedAction: "jira.permission.diagnose",
      requiredPermission: "jira.diagnose",
      requiredScopes: ["jira.diagnose"],
      priority: 80,
      owner: "Jira Support Team",
      scope: { systems: ["jira"], resourceTypes: ["project", "issue"] },
      riskLevel: "medium",
      examples: ["I don't have permission to create a Jira ticket", "Jira says I cannot create a ticket in FIN"]
    },
    {
      id: "jira.diagnose_issue_creation_failure",
      name: "Diagnose Jira issue creation failure",
      description: "Diagnose Jira issue creation API or sync failures.",
      capabilities: ["jira.issue_creation.diagnose"],
      supportingCapabilities: ["oauth.scope.compare"],
      requestedAction: "jira.issue_creation.diagnose",
      requiredPermission: "jira.diagnose",
      requiredScopes: ["jira.diagnose"],
      priority: 90,
      owner: "Jira Integration Team",
      scope: { systems: ["jira"], resourceTypes: ["issue"] },
      riskLevel: "medium",
      examples: ["Jira API returns 403 when creating issues"]
    },
    { id: "jira.ask_clarifying_questions", name: "Ask Jira clarifying questions", description: "Ask for Jira project, operation, or error detail." }
  ]
};

async function loadRequirements(): Promise<JiraOperationRequirement[]> {
  const filePath = path.resolve(process.cwd(), "../../mock-data/jira-operation-requirements.json");
  return JSON.parse(await readFile(filePath, "utf8")) as JiraOperationRequirement[];
}

function taskMessage(task: A2ATask | AgentTask): string {
  return "userMessage" in task ? task.userMessage : task.message;
}

function extractProjectKey(message: string): string | undefined {
  return (
    message.match(/\bin the\s+([A-Z][A-Z0-9_-]*)\s+project\b/i)?.[1] ??
    message.match(/\bproject\s+([A-Z][A-Z0-9_-]*)\b/i)?.[1] ??
    message.match(/\b([A-Z][A-Z0-9_-]*)\s+project\b/i)?.[1]
  );
}

startJsonServer(port, async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { status: "ok", agentId: "jira-agent" }, request);
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

  const message = taskMessage(task);
  const requirements = await loadRequirements();
  const operation = task.classification.operation ?? "create_issue";
  const requirement = requirements.find((item) => item.operation === operation);

  if (!requirement) {
    const result: A2AAgentResponse = {
      agentId: "jira-agent",
      status: "needs_more_info",
      summary: `Jira Agent does not have enough mock operation context for ${operation}.`,
      probableCause: "No Jira mock requirement is defined for the requested operation.",
      clarifyingQuestions: ["Which Jira operation failed?", "Was the user creating, updating, reading, or syncing an issue?"],
      evidence: [
        {
          title: "Missing Jira mock operation requirement",
          data: {
            requestedOperation: operation,
            knownOperations: requirements.map((item) => item.operation)
          }
        }
      ],
      trace: [
        {
          agent: "jira-agent",
          action: "missing_operation_requirements",
          detail: `No mock Jira operation requirement found for ${operation}`,
          timestamp: new Date().toISOString()
        }
      ]
    };

    sendJson(response, 200, result);
    return;
  }

  const projectKey = extractProjectKey(message);
  const isUserPermission = "skillId" in task && task.skillId === "jira.diagnose_user_permission_issue";
  const recommendedActions = projectKey
    ? [
        `Check ${projectKey} project permission scheme`,
        "Verify user/group/project role has Create Issues",
        `Check whether other users can create tickets in ${projectKey}`
      ]
    : [
        "Check the target project permission scheme",
        "Verify user/group/project role has Create Issues",
        "Ask which Jira project is affected"
      ];

  const result: A2AAgentResponse = {
    agentId: "jira-agent",
    status: "diagnosed",
    summary: isUserPermission
      ? `This looks like a Jira project permission issue${projectKey ? ` in the ${projectKey} project` : ""}.`
      : "This looks like a Jira issue creation authorization failure.",
    probableCause: projectKey
      ? `The user may be missing Create Issues permission in the ${projectKey} project.`
      : "The user or integration may be missing Jira Create Issues permission for the target project.",
    recommendedActions,
    evidence: [
      {
        title: "Mock Jira operation authorization requirements",
        data: {
          operation: requirement.operation,
          requiredScopes: requirement.requiredScopes,
          requiredPermission: "Create Issues",
          projectKey
        }
      }
    ],
    trace: [
      {
        agent: "jira-agent",
        action: "lookup_operation_requirements",
        detail: `Found required scopes for ${requirement.operation}`,
        timestamp: new Date().toISOString()
      },
      ...("context" in task && task.context.auth?.tokenValidated
        ? [
            {
              agent: "jira-agent",
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
