import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  A2AAgentResponse,
  A2ATask,
  AgentEvidence,
  AgentName,
  AgentResponse,
  AgentTraceEntry,
  Classification,
  ExecutionTraceStep,
  ResolveRequest,
  ResolveResponse,
  SecurityDecision
} from "@a2a/shared";
import { postJson, readJsonBody, sendJson, startJsonServer } from "@a2a/shared/src/http";
import { buildManualAccessRequestAnswer, detectAccessRequestIntent } from "./accessRequest";
import { discoverAgentCards, getAgentCard } from "./agentCards";
import { routeWithAI } from "./aiRouter";
import { evaluateDelegationPolicy, evaluateSecurityPolicy } from "./security/policyEngine";
import { createSessionCookie, hasValidSession } from "./security/sessionManager";

dotenv.config({ path: new URL("../.env", import.meta.url) });

const port = Number(process.env.PORT ?? 4000);
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const rateLimitMaxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 30);
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const orchestratorAgentId = "servicenow-orchestrator-agent";
const MAX_DELEGATION_DEPTH = 1;

function clientIp(request: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string {
  const forwardedFor = request.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return firstForwarded?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
}

function allowByRateLimit(request: Parameters<typeof clientIp>[0], response: Parameters<typeof sendJson>[0]): boolean {
  const now = Date.now();
  const key = clientIp(request);
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
    return true;
  }

  if (bucket.count >= rateLimitMaxRequests) {
    sendJson(response, 429, { error: "Too many requests" });
    return false;
  }

  bucket.count += 1;
  return true;
}

function hasValidClientApiKey(request: IncomingMessage): boolean {
  const expected = process.env.ORCHESTRATOR_API_KEY;
  return Boolean(expected && request.headers["x-api-key"] === expected);
}

function requireClientAccess(request: IncomingMessage, response: ServerResponse): boolean {
  if (hasValidSession(request) || hasValidClientApiKey(request)) {
    return true;
  }

  sendJson(response, 401, { error: "Unauthorized" });
  return false;
}

function trace(action: string, detail: string): AgentTraceEntry {
  return {
    agent: "orchestrator",
    action,
    detail,
    timestamp: new Date().toISOString()
  };
}

function executionStep(actor: ExecutionTraceStep["actor"], action: string, detail: string): ExecutionTraceStep {
  return {
    actor,
    action,
    detail,
    timestamp: new Date().toISOString()
  };
}

function buildDiagnosis(agentResponses: A2AAgentResponse[]): ResolveResponse["diagnosis"] {
  const diagnosed =
    agentResponses.find((response) => response.status === "diagnosed" && response.probableCause && response.agentId !== "end-user-triage-agent") ??
    agentResponses.find((response) => response.status === "diagnosed" && response.probableCause);

  if (diagnosed?.probableCause) {
    return {
      probableCause: diagnosed.probableCause,
      recommendedFix: diagnosed.recommendedActions?.join("; ") ?? diagnosed.summary
    };
  }

  const needsMoreInfo = agentResponses.find((response) => response.status === "needs_more_info");

  if (needsMoreInfo) {
    return {
      probableCause: "More information is needed before an external agent can diagnose the issue",
      recommendedFix: needsMoreInfo.clarifyingQuestions?.join("; ") ?? needsMoreInfo.summary
    };
  }

  return {
    probableCause: "No external agent returned a diagnosis",
    recommendedFix: "Review the A2A conversation trace and retry with more issue detail."
  };
}

function sentence(value: string): string {
  return /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function buildFinalAnswer(params: {
  classification: Classification;
  agentResponses: A2AAgentResponse[];
  securityDecisions?: SecurityDecision[];
}): string {
  const approvalDecision = params.securityDecisions?.find((decision) => decision.decision === "NeedsApproval");

  if (approvalDecision) {
    return `Needs approval: ${approvalDecision.reason}`;
  }

  const needsMoreInfo = params.agentResponses.find((response) => response.status === "needs_more_info");

  if (needsMoreInfo) {
    const questions = needsMoreInfo.clarifyingQuestions?.join(" ");
    return questions ? `${needsMoreInfo.summary} ${questions}` : needsMoreInfo.summary;
  }

  const diagnosed = params.agentResponses.filter((response) => response.status === "diagnosed");
  const blockedDecision = params.securityDecisions?.find((decision) => decision.decision === "Blocked");

  if (blockedDecision && diagnosed.length === 0) {
    return `Blocked by policy: ${blockedDecision.reason}`;
  }

  if (diagnosed.length === 0) {
    return "I could not complete the A2A diagnosis. Please provide the failed action, exact error, and affected system or record.";
  }

  const primary = diagnosed.find((response) => response.agentId !== "end-user-triage-agent") ?? diagnosed[0];
  const actions = primary.recommendedActions?.length ? ` Recommended actions: ${primary.recommendedActions.join("; ")}.` : "";
  const supporting = diagnosed
    .filter((response) => response !== primary)
    .map((response) => `${response.agentId}: ${response.summary}`)
    .join(" ");

  if (params.classification.supportMode === "end_user_support") {
    return `${primary.summary}${actions}${supporting ? ` Supporting findings: ${supporting}` : ""}`;
  }

  return `${primary.summary}${primary.probableCause ? ` Probable cause: ${sentence(primary.probableCause)}` : ""}${actions}${supporting ? ` Supporting findings: ${supporting}` : ""}`;
}

function primarySecurityDecision(decisions: SecurityDecision[]): SecurityDecision | undefined {
  return (
    decisions.find((decision) => decision.decision === "Blocked") ??
    decisions.find((decision) => decision.decision === "NeedsApproval") ??
    decisions.find((decision) => decision.decision === "NeedsMoreContext") ??
    decisions[0]
  );
}

function requestedActionForAgent(agentId: AgentName, classification: Classification, message: string): string | undefined {
  const lower = message.toLowerCase();

  if (agentId === "security-oauth-agent") {
    if (
      classification.system === "Jira" &&
      includesAny(lower, ["grant", "give me", "add me"]) &&
      includesAny(lower, ["permission", "access"]) &&
      includesAny(lower, ["create jira", "create ticket", "create tickets", "create issue", "create issues"])
    ) {
      return "access.grant_permission";
    }

    if (lower.includes("inspect") && lower.includes("oauth")) {
      return "inspect_oauth_token";
    }

    return "compare_oauth_scopes";
  }

  if (agentId === "api-health-agent") {
    if (classification.system === "GitHub" && classification.issueType === "RATE_LIMIT") {
      return "read_github_rate_limit";
    }

    return "read_api_health";
  }

  if (agentId === "pagerduty-agent") {
    return "create_incident_draft";
  }

  return undefined;
}

function requestedScopeForAction(requestedAction?: string): string | undefined {
  if (requestedAction === "compare_oauth_scopes") {
    return "security.scope.compare";
  }

  if (requestedAction === "inspect_oauth_token") {
    return "security.token.inspect";
  }

  if (requestedAction === "access.grant_permission") {
    return "access.permission.grant";
  }

  if (requestedAction === "read_github_rate_limit") {
    return "github.rate_limit.read";
  }

  if (requestedAction === "read_api_health") {
    return "apihealth.read";
  }

  return undefined;
}

function requestedScopeForSkill(skillId?: string): string | undefined {
  if (skillId === "api_health.diagnose_rate_limit") {
    return "github.rate_limit.read";
  }

  if (skillId === "api_health.diagnose_connectivity_failure" || skillId === "api_health.diagnose_webhook_delivery") {
    return "apihealth.read";
  }

  if (skillId === "security.compare_oauth_scopes") {
    return "security.scope.compare";
  }

  return undefined;
}

function createTaskId(): string {
  return randomUUID();
}

function createA2ATask(params: {
  conversationId: string;
  fromAgent?: string;
  toAgent: AgentName;
  skillId?: string;
  message: string;
  classification: Classification;
  securityDecision?: SecurityDecision;
  requestedScope?: string;
  mediatedBy?: string;
  delegationDepth?: number;
  parentTaskId?: string;
  requestedByAgent?: string;
  delegationContext?: Record<string, unknown>;
}): A2ATask {
  const card = getAgentCard(params.toAgent);

  return {
    taskId: createTaskId(),
    conversationId: params.conversationId,
    fromAgent: params.fromAgent ?? orchestratorAgentId,
    toAgent: params.toAgent,
    mediatedBy: params.mediatedBy,
    delegationDepth: params.delegationDepth,
    parentTaskId: params.parentTaskId,
    requestedByAgent: params.requestedByAgent,
    skillId: params.skillId,
    userMessage: params.message,
    classification: params.classification,
    context: {
      reporterType: params.classification.reporterType,
      supportMode: params.classification.supportMode,
      sourceSystem: "ServiceNow",
      affectedSystem: params.classification.system,
      securityDecision: params.securityDecision,
      callerAgentId: "servicenow-orchestrator-agent",
      targetAgentId: params.toAgent,
      targetAudience: card?.auth.audience,
      requestedScope: params.requestedScope,
      authMode: "mock_internal_token",
      delegationContext: params.delegationContext
      // TODO: replace mock_internal_token with OAuth 2.0 Client Credentials, JWT access tokens,
      // audience/issuer/scope/JWKS validation, and optional mTLS or DPoP.
    }
  };
}

function normalizeAgentResponse(agentId: AgentName, response: AgentResponse | A2AAgentResponse): A2AAgentResponse {
  if ("agentId" in response && "status" in response) {
    return response;
  }

  return {
    agentId,
    status: response.evidence.length > 0 ? "diagnosed" : "unsupported",
    summary: response.evidence[0]?.title ?? "Agent returned legacy evidence.",
    evidence: response.evidence.map((item) => ({ title: item.title, data: item.data })),
    trace: response.trace
  };
}

async function resolveIssue(requestBody: ResolveRequest): Promise<ResolveResponse> {
  const routingDecision = await routeWithAI(requestBody.message);
  const classification = routingDecision.classification;
  const conversationId = createTaskId();

  if (routingDecision.selectedAgents.length === 0) {
    const needsMoreInfo = routingDecision.resolutionStatus === "needs_more_info";
    const accessRequest = detectAccessRequestIntent(requestBody.message);
    const unsupportedAccessRequest = routingDecision.resolutionStatus === "unsupported" && accessRequest.isAccessRequest;
    const diagnosis = unsupportedAccessRequest
      ? {
          probableCause: "Unsupported manual access request workflow",
          recommendedFix: "Open a ServiceNow access request manually for the requested group membership change."
        }
      : needsMoreInfo
      ? {
          probableCause: "Not enough diagnostic detail to route the issue",
          recommendedFix:
            "Please provide the error message or code, what operation failed, and which system Monday.com is syncing with."
        }
      : {
          probableCause: "Scenario not implemented yet",
          recommendedFix: "Use the Jira 403 Missing Scope or GitHub Rate Limit scenario for the fully wired local agent flow."
        };
    const finalAnswer = unsupportedAccessRequest
      ? buildManualAccessRequestAnswer(accessRequest)
      : needsMoreInfo
      ? "I need more details before I can route this to the right agent. Please provide the error message or code, what operation failed, and which system Monday.com is syncing with."
      : `${diagnosis.probableCause}. ${diagnosis.recommendedFix}`;

    return {
      finalAnswer,
      classification,
      selectedAgents: routingDecision.selectedAgents,
      skippedAgents: routingDecision.skippedAgents,
      routingSource: routingDecision.routingSource,
      routingConfidence: routingDecision.routingConfidence,
      routingReasoningSummary: routingDecision.routingReasoningSummary,
      resolutionStatus: routingDecision.resolutionStatus,
      evidence: [],
      agentTrace: [
        trace("classify_issue", `Detected ${classification.system}, ${classification.errorCode ?? "no error code"}, ${classification.issueType}`),
        trace(
          unsupportedAccessRequest ? "unsupported_manual_workflow" : needsMoreInfo ? "needs_more_info" : "skip_unimplemented_scenario",
          unsupportedAccessRequest
            ? "No Active Directory or Identity Access agent is available for this access request"
            : needsMoreInfo
            ? "No specialist agents were executed because the issue lacks diagnostic details"
            : "No local specialist workflow is implemented for this scenario yet"
        )
      ],
      executionTrace: [
        executionStep("user", "submit_issue", requestBody.message),
        executionStep(
          "orchestrator",
          "classify_issue",
          `Classified as ${classification.confidence} confidence / ${classification.issueType}`
        ),
        executionStep(
          "orchestrator",
          unsupportedAccessRequest ? "skip_agent_execution" : needsMoreInfo ? "skip_agent_execution" : "return_not_implemented",
          unsupportedAccessRequest
            ? "Did not execute specialist agents because no Active Directory or Identity Access agent is available"
            : needsMoreInfo
            ? "Did not execute specialist agents because the issue lacks diagnostic details"
            : "Scenario not implemented yet"
        ),
        executionStep(
          "orchestrator",
          unsupportedAccessRequest ? "return_manual_request_guidance" : needsMoreInfo ? "ask_for_more_information" : "return_response",
          unsupportedAccessRequest
            ? "Returned manual ServiceNow access request guidance"
            : needsMoreInfo
              ? "Asked the user for the error code, failed operation, and integration direction"
              : "Returned placeholder response"
        )
      ],
      a2aTasks: [],
      a2aResponses: [],
      securityDecisions: [],
      diagnosis
    };
  }

  const orchestratorTrace = [
    trace("route_issue", `${routingDecision.routingSource} selected ${routingDecision.selectedAgents.map((agent) => agent.agentId).join(", ")}`),
    trace("classify_issue", `Detected ${classification.system}, ${classification.errorCode ?? "no error code"}, ${classification.issueType}`),
    ...routingDecision.selectedAgents.map((agent) => trace("select_agent", `Selected ${agent.agentId} as ${agent.role}: ${agent.reason}`))
  ];

  const a2aTasks: A2ATask[] = [];
  const a2aResponses: A2AAgentResponse[] = [];
  const executedDelegations = new Set<string>();
  const delegationExecutionSteps: ExecutionTraceStep[] = [];
  const securityDecisions: SecurityDecision[] = [];

  async function processRequestedDelegations(agentResponse: A2AAgentResponse, parentTask: A2ATask): Promise<void> {
    for (const delegation of agentResponse.requestedDelegations ?? []) {
      const fromAgent = agentResponse.agentId;
      const targetCard = getAgentCard(delegation.targetAgentId);
      const targetSkill = targetCard?.skills.find((skill) => skill.id === delegation.skillId);
      const currentDepth = parentTask.delegationDepth ?? 0;
      const nextDepth = currentDepth + 1;
      const delegationKey = `${parentTask.conversationId}:${fromAgent}:${delegation.targetAgentId}:${delegation.skillId}`;

      orchestratorTrace.push({
        ...trace("DELEGATION_REQUESTED", `${fromAgent} requested ${delegation.targetAgentId}/${delegation.skillId}: ${delegation.reason}`),
        fromAgent,
        toAgent: delegation.targetAgentId,
        mediatedBy: orchestratorAgentId,
        skillId: delegation.skillId,
        delegationDepth: nextDepth
      });
      delegationExecutionSteps.push({
        ...executionStep(fromAgent as ExecutionTraceStep["actor"], "request_delegation", delegation.reason),
        taskId: parentTask.taskId,
        conversationId: parentTask.conversationId,
        fromAgent,
        toAgent: delegation.targetAgentId,
        mediatedBy: orchestratorAgentId,
        skillId: delegation.skillId,
        delegationDepth: nextDepth
      });

      const validationFailure =
        !targetCard
          ? `Target agent ${delegation.targetAgentId} is not present in Agent Cards.`
          : !targetCard.endpoint
            ? `Target agent ${delegation.targetAgentId} has no executable endpoint.`
            : !targetSkill
              ? `Skill ${delegation.skillId} is not present on ${delegation.targetAgentId}.`
              : currentDepth >= MAX_DELEGATION_DEPTH
                ? `Delegation depth ${nextDepth} exceeds max depth ${MAX_DELEGATION_DEPTH}.`
                : executedDelegations.has(delegationKey)
                  ? `Delegation ${fromAgent} -> ${delegation.targetAgentId}/${delegation.skillId} already executed in this conversation.`
                  : undefined;

      if (validationFailure) {
        orchestratorTrace.push({
          ...trace("DELEGATION_BLOCKED", validationFailure),
          fromAgent,
          toAgent: delegation.targetAgentId,
          mediatedBy: orchestratorAgentId,
          skillId: delegation.skillId,
          decision: "Blocked",
          delegationDepth: nextDepth
        });
        delegationExecutionSteps.push({
          ...executionStep("orchestrator", "validate_delegation", validationFailure),
          taskId: parentTask.taskId,
          conversationId: parentTask.conversationId,
          fromAgent,
          toAgent: delegation.targetAgentId,
          mediatedBy: orchestratorAgentId,
          skillId: delegation.skillId,
          decision: "Blocked",
          delegationDepth: nextDepth
        });
        a2aResponses.push({
          agentId: delegation.targetAgentId,
          status: "blocked",
          summary: `Delegation from ${fromAgent} to ${delegation.targetAgentId} was blocked by orchestrator validation.`,
          probableCause: validationFailure,
          recommendedActions: ["Review the delegated Agent Card target, skill, depth, and duplicate request."],
          trace: [
            {
              agent: "orchestrator",
              action: "DELEGATION_BLOCKED",
              detail: validationFailure,
              timestamp: new Date().toISOString()
            }
          ]
        });
        continue;
      }

      delegationExecutionSteps.push({
        ...executionStep("orchestrator", "validate_delegation", `Validated ${fromAgent} -> ${delegation.targetAgentId}/${delegation.skillId}`),
        taskId: parentTask.taskId,
        conversationId: parentTask.conversationId,
        fromAgent,
        toAgent: delegation.targetAgentId,
        mediatedBy: orchestratorAgentId,
        skillId: delegation.skillId,
        decision: "Allowed",
        delegationDepth: nextDepth
      });

      const policyDecision = evaluateDelegationPolicy({
        callerAgentId: fromAgent,
        targetAgentId: delegation.targetAgentId,
        requestedAction: delegation.skillId
      }) as SecurityDecision;
      securityDecisions.push(policyDecision);

      orchestratorTrace.push({
        ...trace(
          policyDecision.decision === "Allowed" ? "SECURITY_POLICY_ALLOWED" : "SECURITY_BLOCKED",
          `${policyDecision.decision}: ${policyDecision.caller} -> ${policyDecision.target} requested ${policyDecision.requestedAction}`
        ),
        fromAgent,
        toAgent: delegation.targetAgentId,
        mediatedBy: orchestratorAgentId,
        skillId: delegation.skillId,
        decision: policyDecision.decision,
        delegationDepth: nextDepth
      });
      delegationExecutionSteps.push({
        ...executionStep(
          "orchestrator",
          "security_policy_evaluated",
          `${policyDecision.decision}: ${policyDecision.reason}`
        ),
        taskId: parentTask.taskId,
        conversationId: parentTask.conversationId,
        fromAgent,
        toAgent: delegation.targetAgentId,
        mediatedBy: orchestratorAgentId,
        skillId: delegation.skillId,
        decision: policyDecision.decision,
        delegationDepth: nextDepth
      });

      if (policyDecision.decision !== "Allowed") {
        orchestratorTrace.push({
          ...trace("DELEGATION_BLOCKED", policyDecision.reason),
          fromAgent,
          toAgent: delegation.targetAgentId,
          mediatedBy: orchestratorAgentId,
          skillId: delegation.skillId,
          decision: policyDecision.decision,
          delegationDepth: nextDepth
        });
        a2aResponses.push({
          agentId: delegation.targetAgentId,
          status: "blocked",
          summary: `Delegation from ${fromAgent} to ${delegation.targetAgentId} was blocked by policy.`,
          probableCause: policyDecision.reason,
          recommendedActions: ["Use an allowed delegation policy or request approval."],
          trace: [
            {
              agent: "orchestrator",
              action: "DELEGATION_BLOCKED",
              detail: policyDecision.reason,
              timestamp: new Date().toISOString()
            }
          ]
        });
        continue;
      }

      executedDelegations.add(delegationKey);
      const delegatedTask = createA2ATask({
        conversationId: parentTask.conversationId,
        fromAgent,
        toAgent: delegation.targetAgentId,
        skillId: delegation.skillId,
        message: parentTask.userMessage,
        classification,
        securityDecision: policyDecision,
        requestedScope: requestedScopeForSkill(delegation.skillId),
        mediatedBy: orchestratorAgentId,
        delegationDepth: nextDepth,
        parentTaskId: parentTask.taskId,
        requestedByAgent: fromAgent,
        delegationContext: delegation.context
      });
      a2aTasks.push(delegatedTask);

      try {
        const response = await postJson<AgentResponse | A2AAgentResponse>(targetCard!.endpoint, delegatedTask, {
          "x-internal-service-token": process.env.INTERNAL_SERVICE_TOKEN ?? ""
        });
        const normalizedResponse = normalizeAgentResponse(delegation.targetAgentId, response);
        a2aResponses.push(normalizedResponse);
        delegationExecutionSteps.push({
          ...executionStep("orchestrator", "execute_delegated_task", `Executed delegated task on ${delegation.targetAgentId}`),
          taskId: delegatedTask.taskId,
          conversationId: delegatedTask.conversationId,
          fromAgent: delegatedTask.fromAgent,
          toAgent: delegatedTask.toAgent,
          mediatedBy: delegatedTask.mediatedBy,
          skillId: delegatedTask.skillId,
          decision: policyDecision.decision,
          delegationDepth: delegatedTask.delegationDepth
        });
        await processRequestedDelegations(normalizedResponse, delegatedTask);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown delegated agent call failure";
        orchestratorTrace.push({
          ...trace("AGENT_CALL_FAILED", `${delegation.targetAgentId}: ${detail}`),
          fromAgent,
          toAgent: delegation.targetAgentId,
          mediatedBy: orchestratorAgentId,
          skillId: delegation.skillId,
          delegationDepth: nextDepth
        });
        a2aResponses.push({
          agentId: delegation.targetAgentId,
          status: "error",
          summary: `${delegation.targetAgentId} failed during delegated A2A task execution.`,
          probableCause: detail,
          recommendedActions: ["Retry the local mock service or inspect its logs."],
          trace: [
            {
              agent: "orchestrator",
              action: "AGENT_CALL_FAILED",
              detail,
              timestamp: new Date().toISOString()
            }
          ]
        });
      }
    }
  }

  for (const agent of routingDecision.selectedAgents) {
    const card = getAgentCard(agent.agentId);

    if (!card?.endpoint) {
      continue;
    }

    const requestedAction = requestedActionForAgent(agent.agentId, classification, requestBody.message);
    let taskSecurityDecision: SecurityDecision | undefined;

    if (requestedAction) {
      const policyDecision = evaluateSecurityPolicy({
        callerAgentId: orchestratorAgentId,
        targetAgentId: agent.agentId,
        requestedAction
      }) as SecurityDecision;

      securityDecisions.push(policyDecision);
      taskSecurityDecision = policyDecision;
      orchestratorTrace.push(
        trace(
          "SECURITY_POLICY_EVALUATED",
          `${policyDecision.decision}: ${policyDecision.caller} -> ${policyDecision.target} requires ${policyDecision.requiredPermission}`
        )
      );

      if (policyDecision.decision !== "Allowed") {
        const action = policyDecision.decision === "NeedsApproval" ? "SECURITY_NEEDS_APPROVAL" : "SECURITY_BLOCKED";
        orchestratorTrace.push(trace(action, policyDecision.reason));
        a2aResponses.push({
          agentId: agent.agentId,
          status: "blocked",
          summary:
            policyDecision.decision === "NeedsApproval"
              ? `Task requires approval before invoking ${agent.agentId}.`
              : `Task was blocked by policy before invoking ${agent.agentId}.`,
          probableCause: policyDecision.reason,
          recommendedActions:
            policyDecision.decision === "NeedsApproval"
              ? ["Request approval from the Jira project owner or access administrator."]
              : ["Use an allowed security action or request approval."],
          trace: [
            {
              agent: "orchestrator",
              action,
              detail: policyDecision.reason,
              timestamp: new Date().toISOString()
            }
          ]
        });
        continue;
      }
    }

    const a2aTask = createA2ATask({
      conversationId,
      toAgent: agent.agentId,
      skillId: agent.skillId,
      message: requestBody.message,
      classification,
      securityDecision: taskSecurityDecision,
      requestedScope: requestedScopeForAction(requestedAction)
    });
    a2aTasks.push(a2aTask);

    try {
      const response = await postJson<AgentResponse | A2AAgentResponse>(card.endpoint, a2aTask, {
        "x-internal-service-token": process.env.INTERNAL_SERVICE_TOKEN ?? ""
      });
      const normalizedResponse = normalizeAgentResponse(agent.agentId, response);
      a2aResponses.push(normalizedResponse);
      await processRequestedDelegations(normalizedResponse, a2aTask);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown agent call failure";
      orchestratorTrace.push(trace("AGENT_CALL_FAILED", `${agent.agentId}: ${detail}`));
      a2aResponses.push({
        agentId: agent.agentId,
        status: "error",
        summary: `${agent.agentId} failed during A2A task execution.`,
        probableCause: detail,
        recommendedActions: ["Retry the local mock service or inspect its logs."],
        trace: [
          {
            agent: "orchestrator",
            action: "AGENT_CALL_FAILED",
            detail,
            timestamp: new Date().toISOString()
          }
        ]
      });
    }
  }

  const evidence: AgentEvidence[] = a2aResponses.flatMap((response) =>
    (response.evidence ?? []).map((item) => ({
      agent: response.agentId as AgentName,
      title: item.title,
      data: item.data as Record<string, unknown>
    }))
  );
  const agentTrace = [...orchestratorTrace, ...a2aResponses.flatMap((response) => response.trace ?? [])] as AgentTraceEntry[];
  const diagnosis = buildDiagnosis(a2aResponses);
  const securityDecision = primarySecurityDecision(securityDecisions);
  const resolutionStatus = a2aResponses.some((response) => response.status === "needs_more_info")
    ? "needs_more_info"
    : routingDecision.resolutionStatus;
  const executionTrace = [
    executionStep("user", "submit_issue", requestBody.message),
    executionStep("orchestrator", "route_issue", `${routingDecision.routingSource} routing decision: ${routingDecision.routingReasoningSummary}`),
    executionStep("orchestrator", "classify_issue", `Detected ${classification.system}, ${classification.errorCode ?? "no error code"}, ${classification.issueType}`),
    ...routingDecision.selectedAgents.map((agent) => ({
      ...executionStep("orchestrator", "select_agent", `Selected ${agent.agentId} as ${agent.role}: ${agent.reason}`),
      skillId: agent.skillId
    })),
    ...a2aTasks.filter((task) => !task.mediatedBy).map((task) => ({
      ...executionStep("orchestrator", "send_a2a_task", `Sent A2A task to ${task.toAgent}${task.skillId ? ` for ${task.skillId}` : ""}`),
      taskId: task.taskId,
      conversationId: task.conversationId,
      fromAgent: task.fromAgent,
      toAgent: task.toAgent,
      mediatedBy: task.mediatedBy,
      skillId: task.skillId,
      decision: task.context.securityDecision?.decision,
      delegationDepth: task.delegationDepth
    })),
    ...delegationExecutionSteps,
    ...a2aResponses.flatMap((response) =>
      (response.trace ?? []).map((entry) => executionStep("orchestrator", entry.action, `${entry.agent}: ${entry.detail}`))
    ),
    executionStep("orchestrator", "generate_final_diagnosis", diagnosis.probableCause)
  ];

  return {
    finalAnswer: buildFinalAnswer({
      classification,
      agentResponses: a2aResponses,
      securityDecisions
    }),
    classification,
    selectedAgents: routingDecision.selectedAgents,
    skippedAgents: routingDecision.skippedAgents,
    routingSource: routingDecision.routingSource,
    routingConfidence: routingDecision.routingConfidence,
    routingReasoningSummary: routingDecision.routingReasoningSummary,
    resolutionStatus,
    evidence,
    agentTrace,
    executionTrace,
    securityDecision,
    securityDecisions,
    a2aTasks,
    a2aResponses,
    diagnosis
  };
}

async function start(): Promise<void> {
  await discoverAgentCards();

  startJsonServer(port, async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      ok: true
    });
    return;
  }

  if (request.method === "POST" && request.url === "/session") {
    sendJson(
      response,
      200,
      { ok: true },
      request,
      {
        "set-cookie": createSessionCookie()
      }
    );
    return;
  }

  if (request.method !== "POST" || request.url !== "/resolve") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (!requireClientAccess(request, response)) {
    return;
  }

  if (!allowByRateLimit(request, response)) {
    return;
  }

  const requestBody = await readJsonBody<ResolveRequest>(request);

  if (!requestBody.message?.trim()) {
    sendJson(response, 400, { error: "message is required" });
    return;
  }

  sendJson(response, 200, await resolveIssue(requestBody));
  });
}

void start();
