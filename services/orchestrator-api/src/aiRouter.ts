import { OpenRouter } from "@openrouter/sdk";
import OpenAI from "openai";
import type {
  AgentName,
  Classification,
  EnterpriseSystem,
  ErrorCode,
  IntegrationOperation,
  IssueType,
  ReporterType,
  RequestInterpretation,
  RoutingDecision,
  SelectedAgent,
  SkippedAgent
} from "@a2a/shared";
import { findAgentSkillsByCapability, getAgentCard, getExecutableAgentCards, isExecutableAgentCard } from "./agentCards";
import { getAiConfig } from "./config/aiConfig";
import { interpretRequest } from "./requestInterpreter";

const systems: EnterpriseSystem[] = ["Jira", "GitHub", "PagerDuty", "SAP", "Confluence", "Monday", "Unknown"];
const errorCodes: ErrorCode[] = ["401", "403", "404", "429", "500", "502", "503", "504"];
const issueTypes: IssueType[] = [
  "AUTHENTICATION_FAILURE",
  "AUTHORIZATION_FAILURE",
  "RATE_LIMIT",
  "CONNECTIVITY_FAILURE",
  "WEBHOOK_FAILURE",
  "API_AVAILABILITY",
  "UNKNOWN"
];
const operations: IntegrationOperation[] = [
  "create_issue",
  "repository_scan",
  "send_alert",
  "oauth_client_auth",
  "sync_board_updates",
  "read_pages",
  "unknown"
];
const reporterTypes: ReporterType[] = ["end_user", "it_engineer", "unknown"];

const routerPrompt = `You are a ServiceNow-style AI Orchestrator Agent.
You are a secondary route planner. Primary routing is capability-based and already attempted.

Rules:
- Use only agent IDs and skill IDs present in the provided Agent Cards.
- selectedAgents[].skillId is REQUIRED for every selected agent.
- Match the user's request to Agent Card skill capabilities and descriptions.
- Never invent, paraphrase, rename, or omit skillId.
- Do not select unrelated agents.
- Do not decide authorization. The deterministic policy engine decides Allowed, Blocked, or NeedsApproval.
- Do not claim that any access/provisioning/security action was executed.
- Prefer returning no selected agents with resolutionStatus "needs_more_info" when the issue is vague.

Return JSON only:
{
  "classification": {
    "system": "Jira|GitHub|PagerDuty|SAP|Confluence|Monday|Unknown",
    "errorCode": "401|403|404|429|500|502|503|504",
    "issueType": "AUTHENTICATION_FAILURE|AUTHORIZATION_FAILURE|RATE_LIMIT|CONNECTIVITY_FAILURE|WEBHOOK_FAILURE|API_AVAILABILITY|UNKNOWN",
    "operation": "create_issue|repository_scan|send_alert|oauth_client_auth|sync_board_updates|read_pages|unknown",
    "confidence": "low|medium|high",
    "reasoningSummary": "string",
    "reporterType": "end_user|it_engineer|unknown",
    "supportMode": "end_user_support|technical_integration"
  },
  "selectedAgents": [
    {
      "agentId": "string",
      "role": "primary|supporting",
      "skillId": "string",
      "reason": "string"
    }
  ],
  "routingConfidence": "low|medium|high",
  "routingReasoningSummary": "string",
  "resolutionStatus": "resolved|needs_more_info|unsupported"
}`;

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function asOptionalErrorCode(value: unknown, fallback?: ErrorCode): ErrorCode | undefined {
  return typeof value === "string" && errorCodes.includes(value as ErrorCode) ? (value as ErrorCode) : fallback;
}

function completeSkippedAgents(selectedAgents: SelectedAgent[], explicitSkipped: SkippedAgent[] = []): SkippedAgent[] {
  const selectedIds = new Set(selectedAgents.map((agent) => agent.agentId));
  const explicitById = new Map(explicitSkipped.map((agent) => [agent.agentId, agent.reason]));

  return getExecutableAgentCards()
    .filter((card) => !selectedIds.has(card.agentId))
    .map((card) => ({
      agentId: card.agentId,
      reason: explicitById.get(card.agentId) ?? "No matching Agent Card capability was needed for this route."
    }));
}

function knownSystemFromText(value: string | undefined): EnterpriseSystem {
  const normalized = value?.toLowerCase() ?? "";
  return systems.find((system) => system !== "Unknown" && normalized.includes(system.toLowerCase())) ?? "Unknown";
}

function classifyFromInterpretation(message: string, interpretation: RequestInterpretation, reason: string): Classification {
  const lower = message.toLowerCase();
  const capability = interpretation.requestedCapability ?? "";
  const errorCode = errorCodes.find((code) => lower.includes(code));
  const system = knownSystemFromText(interpretation.targetSystemText);
  const operation: IntegrationOperation =
    capability === "jira.issue_creation.diagnose" || capability === "jira.permission.diagnose"
      ? "create_issue"
      : capability === "github.repository_scan.diagnose"
        ? "repository_scan"
        : capability === "incident.alert_ingestion.diagnose"
          ? "send_alert"
          : capability === "oauth.client_auth.diagnose" || capability === "integration.auth.diagnose"
            ? "oauth_client_auth"
            : "unknown";
  const issueType: IssueType =
    interpretation.intentType === "security_sensitive_action"
      ? "AUTHORIZATION_FAILURE"
      : interpretation.intentType === "access_request" || interpretation.intentType === "permission_change"
        ? "AUTHORIZATION_FAILURE"
        : capability.includes("rate_limit") || errorCode === "429"
          ? "RATE_LIMIT"
          : capability.includes("auth") || errorCode === "401"
            ? "AUTHENTICATION_FAILURE"
            : errorCode === "403"
              ? "AUTHORIZATION_FAILURE"
              : includesAny(lower, ["timeout", "connectivity", "dns", "tls"])
                ? "CONNECTIVITY_FAILURE"
                : capability.includes("alert_ingestion")
                  ? "WEBHOOK_FAILURE"
                  : "UNKNOWN";
  const reporterType: ReporterType =
    interpretation.intentType === "access_request" || interpretation.intentType === "permission_change" || interpretation.scope === "manual_enterprise_workflow"
      ? "end_user"
      : includesAny(lower, [" i ", "me ", "can't", "cannot", "says i", "don't have"])
        ? "end_user"
        : interpretation.scope === "enterprise_support"
          ? "it_engineer"
          : "unknown";

  return {
    system,
    errorCode,
    issueType,
    operation,
    confidence: interpretation.confidence,
    reasoningSummary: reason,
    classificationSource: "rules_fallback",
    reporterType,
    supportMode: reporterType === "end_user" ? "end_user_support" : "technical_integration"
  };
}

function select(agentId: AgentName, role: "primary" | "supporting", skillId: string, reason: string): SelectedAgent {
  return { agentId, role, skillId, reason };
}

function chooseCapabilityMatch(interpretation: RequestInterpretation): ReturnType<typeof findAgentSkillsByCapability>[number] | undefined {
  const capability = interpretation.requestedCapability;

  if (!capability || capability === "unknown") {
    return undefined;
  }

  const matches = findAgentSkillsByCapability(capability);
  const filtered = matches.filter(({ skill }) =>
    interpretation.intentType === "security_sensitive_action" || (!skill.sensitive && skill.riskLevel !== "sensitive")
  );
  const candidates = filtered.length > 0 ? filtered : matches;

  return candidates.sort((left, right) => {
    const leftExact = left.skill.capabilities?.includes(capability) ? 0 : 1;
    const rightExact = right.skill.capabilities?.includes(capability) ? 0 : 1;
    const leftTriage = left.agent.agentId === "end-user-triage-agent" ? 1 : 0;
    const rightTriage = right.agent.agentId === "end-user-triage-agent" ? 1 : 0;
    return leftExact - rightExact || leftTriage - rightTriage;
  })[0];
}

export function routeByCapability(interpretation: RequestInterpretation): SelectedAgent[] {
  const primary = chooseCapabilityMatch(interpretation);

  if (!primary) {
    return [];
  }

  const selectedAgents: SelectedAgent[] = [
    select(
      primary.agent.agentId,
      "primary",
      primary.skill.id,
      `Matched requested capability ${interpretation.requestedCapability} to Agent Card skill ${primary.skill.id}.`
    )
  ];
  const selectedKeys = new Set(selectedAgents.map((agent) => `${agent.agentId}:${agent.skillId}`));

  for (const capability of primary.skill.supportingCapabilities ?? []) {
    const supporting = findAgentSkillsByCapability(capability).find(({ agent, skill }) => !selectedKeys.has(`${agent.agentId}:${skill.id}`));

    if (!supporting) {
      continue;
    }

    selectedAgents.push(
      select(
        supporting.agent.agentId,
        "supporting",
        supporting.skill.id,
        `Matched supporting capability ${capability} from primary skill ${primary.skill.id}.`
      )
    );
    selectedKeys.add(`${supporting.agent.agentId}:${supporting.skill.id}`);
  }

  return selectedAgents;
}

export function routeWithRules(
  message: string,
  reason = "Capability routing fallback was used.",
  requestInterpretation?: RequestInterpretation
): RoutingDecision {
  const interpretation = requestInterpretation;

  if (!interpretation) {
    const classification: Classification = {
      system: "Unknown",
      issueType: "UNKNOWN",
      operation: "unknown",
      confidence: "low",
      reasoningSummary: reason,
      classificationSource: "rules_fallback",
      reporterType: "unknown",
      supportMode: "technical_integration"
    };

    return {
      classification,
      selectedAgents: [],
      skippedAgents: completeSkippedAgents([]),
      routingSource: "rules_fallback",
      routingConfidence: "low",
      routingReasoningSummary: "No request interpretation was available.",
      resolutionStatus: "needs_more_info"
    };
  }

  const classification = classifyFromInterpretation(message, interpretation, reason);

  if (interpretation.scope === "out_of_scope") {
    return {
      classification: {
        ...classification,
        system: "Unknown",
        issueType: "UNKNOWN",
        operation: "unknown",
        reporterType: "unknown",
        supportMode: "end_user_support"
      },
      selectedAgents: [],
      skippedAgents: getExecutableAgentCards().map((card) => ({
        agentId: card.agentId,
        reason: "Request is outside enterprise support scope."
      })),
      routingSource: "rules_fallback",
      routingConfidence: interpretation.confidence,
      routingReasoningSummary: interpretation.reason,
      resolutionStatus: "unsupported",
      requestInterpretation: interpretation
    };
  }

  const selectedAgents = routeByCapability(interpretation);

  if (interpretation.scope === "manual_enterprise_workflow" && selectedAgents.length === 0) {
    return {
      classification: {
        ...classification,
        issueType: classification.issueType === "UNKNOWN" ? "AUTHORIZATION_FAILURE" : classification.issueType,
        operation: "unknown",
        reporterType: "end_user",
        supportMode: "end_user_support"
      },
      selectedAgents: [],
      skippedAgents: completeSkippedAgents([]),
      routingSource: "rules_fallback",
      routingConfidence: interpretation.confidence,
      routingReasoningSummary: interpretation.reason,
      resolutionStatus: "unsupported",
      requestInterpretation: interpretation
    };
  }

  if (selectedAgents.length > 0) {
    return {
      classification,
      selectedAgents,
      skippedAgents: completeSkippedAgents(selectedAgents),
      routingSource: "rules_fallback",
      routingConfidence: interpretation.confidence,
      routingReasoningSummary: `Matched requested capability ${interpretation.requestedCapability} to Agent Card metadata.`,
      resolutionStatus: "resolved",
      requestInterpretation: interpretation
    };
  }

  return {
    classification,
    selectedAgents: [],
    skippedAgents: completeSkippedAgents([]),
    routingSource: "rules_fallback",
    routingConfidence: interpretation.confidence === "high" ? "medium" : interpretation.confidence,
    routingReasoningSummary: interpretation.reason || "No Agent Card capability matched the interpreted request.",
    resolutionStatus: "needs_more_info",
    requestInterpretation: interpretation
  };
}

function normalizeClassification(value: unknown, fallback: Classification, aiProvider: "openrouter" | "openai", aiModel: string): Classification {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

  return {
    system: asEnum(record.system, systems, fallback.system),
    errorCode: asOptionalErrorCode(record.errorCode, fallback.errorCode),
    issueType: asEnum(record.issueType, issueTypes, fallback.issueType),
    operation: asEnum(record.operation, operations, fallback.operation ?? "unknown"),
    confidence: asEnum(record.confidence, ["low", "medium", "high"] as const, fallback.confidence),
    reasoningSummary: typeof record.reasoningSummary === "string" ? record.reasoningSummary : "AI router returned a classification.",
    classificationSource: "ai",
    aiProvider,
    aiModel,
    reporterType: asEnum(record.reporterType, reporterTypes, fallback.reporterType),
    supportMode: asEnum(record.supportMode, ["end_user_support", "technical_integration"] as const, fallback.supportMode)
  };
}

function parseAgentList(value: unknown): SelectedAgent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      agentId: typeof item.agentId === "string" ? (item.agentId as AgentName) : ("" as AgentName),
      role: asEnum(item.role, ["primary", "supporting"] as const, "supporting"),
      skillId: typeof item.skillId === "string" ? item.skillId : undefined,
      reason: typeof item.reason === "string" ? item.reason : "Selected by secondary AI Agent Card router."
    }));
}

function normalizeRoutingDecision(value: unknown, fallback: RoutingDecision, aiProvider: "openrouter" | "openai", aiModel: string): RoutingDecision {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const classification = normalizeClassification(record.classification, fallback.classification, aiProvider, aiModel);
  const selectedAgents = parseAgentList(record.selectedAgents);

  return {
    classification,
    selectedAgents,
    skippedAgents: completeSkippedAgents(selectedAgents),
    routingSource: "ai",
    routingConfidence: asEnum(record.routingConfidence, ["low", "medium", "high"] as const, "medium"),
    routingReasoningSummary:
      typeof record.routingReasoningSummary === "string" ? record.routingReasoningSummary : "Secondary AI planner selected agents by Agent Card skills.",
    resolutionStatus: asEnum(record.resolutionStatus, ["resolved", "needs_more_info", "unsupported"] as const, "resolved"),
    requestInterpretation: fallback.requestInterpretation
  };
}

type ValidationResult =
  | { ok: true; decision: RoutingDecision }
  | { ok: false; reasons: string[] };

function validateRoutingDecision(decision: RoutingDecision, fallback: RoutingDecision): ValidationResult {
  const reasons: string[] = [];
  const selectedById = new Map<AgentName, SelectedAgent>();

  for (const agent of decision.selectedAgents) {
    const card = getAgentCard(agent.agentId);

    if (!card || !isExecutableAgentCard(agent.agentId)) {
      reasons.push(`unknown agentId: ${agent.agentId}`);
      continue;
    }

    if (!agent.skillId) {
      reasons.push(`missing skillId for ${agent.agentId}.`);
      continue;
    }

    if (!card.skills.some((skill) => skill.id === agent.skillId)) {
      reasons.push(`skillId not found on ${agent.agentId}: ${agent.skillId}.`);
      continue;
    }

    if (selectedById.has(agent.agentId)) {
      reasons.push(`duplicate agentId ignored: ${agent.agentId}.`);
      continue;
    }

    selectedById.set(agent.agentId, agent);
  }

  const selectedAgents = [...selectedById.values()];

  if (selectedAgents.length === 0) {
    return {
      ok: true,
      decision: {
        ...fallback,
        routingSource: decision.routingSource,
        routingReasoningSummary: decision.routingReasoningSummary
      }
    };
  }

  if (!selectedAgents.some((agent) => agent.role === "primary")) {
    selectedAgents[0] = { ...selectedAgents[0], role: "primary" };
  }

  return {
    ok: true,
    decision: {
      ...decision,
      selectedAgents,
      skippedAgents: completeSkippedAgents(selectedAgents),
      resolutionStatus: decision.resolutionStatus === "unsupported" ? "unsupported" : "resolved"
    }
  };
}

async function callOpenRouter(message: string, interpretation: RequestInterpretation, apiKey: string, model: string): Promise<string | undefined> {
  const openRouter = new OpenRouter({ apiKey });
  const result = await openRouter.chat.send({
    chatRequest: {
      model,
      messages: [
        { role: "system", content: routerPrompt },
        {
          role: "user",
          content: JSON.stringify({
            message,
            requestInterpretation: interpretation,
            agentCards: getExecutableAgentCards()
          })
        }
      ],
      responseFormat: { type: "json_object" },
      stream: false,
      temperature: 0
    }
  });

  const content = result.choices[0]?.message.content;
  return typeof content === "string" ? content : undefined;
}

async function callOpenAi(message: string, interpretation: RequestInterpretation, apiKey: string, model: string): Promise<string | undefined> {
  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: routerPrompt },
      {
        role: "user",
        content: JSON.stringify({
          message,
          requestInterpretation: interpretation,
          agentCards: getExecutableAgentCards()
        })
      }
    ],
    temperature: 0
  });

  return completion.choices[0]?.message.content ?? undefined;
}

export async function routeWithAI(message: string): Promise<RoutingDecision> {
  const requestInterpretation = await interpretRequest(message);
  const fallback = routeWithRules(message, "Capability routing fallback was used.", requestInterpretation);

  if (fallback.resolutionStatus === "unsupported" || fallback.selectedAgents.length > 0) {
    return fallback;
  }

  const aiConfig = getAiConfig();

  if (!aiConfig.apiKey?.trim()) {
    console.info(`[router] ${aiConfig.provider} key is not configured; using capability routing fallback`);
    return fallback;
  }

  try {
    const content =
      aiConfig.provider === "openrouter"
        ? await callOpenRouter(message, requestInterpretation, aiConfig.apiKey, aiConfig.model)
        : await callOpenAi(message, requestInterpretation, aiConfig.apiKey, aiConfig.model);

    if (!content) {
      return fallback;
    }

    const normalized = normalizeRoutingDecision(JSON.parse(content), fallback, aiConfig.provider, aiConfig.model);
    const validation = validateRoutingDecision(normalized, fallback);

    if (!validation.ok) {
      const reason = validation.reasons.join(" ");
      console.warn(`[router] Secondary AI routing validation failed; using capability fallback: ${reason}`);
      return routeWithRules(message, `Secondary AI routing validation failed; capability fallback was used. ${reason}`, requestInterpretation);
    }

    return { ...validation.decision, requestInterpretation };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown AI router error";
    console.warn(`[router] Secondary AI routing failed; using capability fallback: ${detail}`);
    return routeWithRules(message, `Secondary AI routing failed; capability fallback was used. ${detail}`, requestInterpretation);
  }
}
