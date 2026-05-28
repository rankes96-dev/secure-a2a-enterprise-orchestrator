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
  unsupportedExplicitA2AProtocolVersion
} from "@a2a/shared";
import { readJsonBody, sendJson, startJsonServer } from "@a2a/shared/http";

dotenv.config({ path: new URL("../../orchestrator-api/.env", import.meta.url) });

const port = Number(process.env.PORT ?? process.env.JIRA_AGENT_PORT ?? 4101);
const a2aAuthMode = assertSecureA2AAuthMode("jira-agent");
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
  auth: { type: a2aAuthMode, audience: "jira-agent" },
  compatibility: OGEN_A2A_AGENT_CARD_COMPATIBILITY,
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

    sendTaskResult(response, request, taskInput, task, result);
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

  sendTaskResult(response, request, taskInput, task, result);
});
