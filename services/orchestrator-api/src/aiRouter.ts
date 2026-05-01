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
  RoutingDecision,
  SelectedAgent,
  SkippedAgent
} from "@a2a/shared";
import { getAgentCard, getExecutableAgentCards, isExecutableAgentCard } from "./agentCards";
import { getAiConfig } from "./config/aiConfig";

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
You own intake and routing, not system-specific troubleshooting knowledge.
Select external enterprise agents by matching the user issue to Agent Card skills.

Rules:
- Use only agent IDs and skill IDs present in the provided Agent Cards.
- selectedAgents[].skillId is REQUIRED for every selected agent.
- skillId must be copied exactly from that agent's listed skills.
- Never invent, paraphrase, rename, or omit skillId.
- If selecting an agent, choose exactly one of that agent's listed skill IDs.
- If no matching skill exists on an agent card, do not select that agent.
- If the issue is about Jira permissions, select jira-agent with the relevant Jira skill.
- If the issue is a plain-language end-user complaint, select end-user-triage-agent primary and the system agent supporting.
- Select security-oauth-agent only when OAuth/token/scope/permission/security analysis adds value.
- Select api-health-agent upfront when rate limit/timeout/5xx/webhook/connectivity evidence is present and no more specific primary agent should own the first task.
- For Jira 403 issue creation or Jira sync creating issues, MUST select jira-agent primary with skillId jira.diagnose_issue_creation_failure and security-oauth-agent supporting with skillId security.compare_oauth_scopes.
- For plain-language Jira permission/ticket creation complaints, MUST select end-user-triage-agent primary with skillId end_user.triage, jira-agent supporting with skillId jira.diagnose_user_permission_issue, and security-oauth-agent supporting with skillId security.compare_oauth_scopes.
- For GitHub repository sync/scan during nightly scan with 403, MUST select only github-agent primary with skillId github.diagnose_repository_scan_failure. GitHub Agent may request API Health through mediated delegation later.
- For "inspect oauth" or OAuth token inspection requests, MUST select security-oauth-agent primary with skillId security.inspect_oauth_token.
- Do not select end-user-triage-agent for technical sync/API prompts unless the user phrased the issue as a plain-language end-user complaint.
- If the issue is vague, select no specialist agents or only end-user-triage-agent and ask for more details.
- Never decide Allowed or Blocked authorization. Security authorization is decided later by the policy engine.
- Never invent agent IDs or skill IDs.

Examples:
User: "Jira sync fails with 403 when creating issues"
Expected selectedAgents:
[
  {
    "agentId": "jira-agent",
    "role": "primary",
    "skillId": "jira.diagnose_issue_creation_failure",
    "reason": "The issue is a Jira issue creation failure with HTTP 403."
  },
  {
    "agentId": "security-oauth-agent",
    "role": "supporting",
    "skillId": "security.compare_oauth_scopes",
    "reason": "A 403 during issue creation may be caused by missing OAuth scopes or permissions."
  }
]

User: "Jira says I don't have permission to create a ticket in the FIN project"
Expected selectedAgents:
[
  {
    "agentId": "end-user-triage-agent",
    "role": "primary",
    "skillId": "end_user.triage",
    "reason": "This is a plain-language end-user support complaint."
  },
  {
    "agentId": "jira-agent",
    "role": "supporting",
    "skillId": "jira.diagnose_user_permission_issue",
    "reason": "The issue is a Jira permission problem while creating a ticket."
  },
  {
    "agentId": "security-oauth-agent",
    "role": "supporting",
    "skillId": "security.compare_oauth_scopes",
    "reason": "The message includes permission/access context."
  }
]

User: "GitHub repository sync started failing with 403 during nightly scan"
Expected selectedAgents:
[
  {
    "agentId": "github-agent",
    "role": "primary",
    "skillId": "github.diagnose_repository_scan_failure",
    "reason": "The issue is a GitHub repository sync failure during nightly scan."
  }
]

User: "inspect oauth in github"
Expected selectedAgents:
[
  {
    "agentId": "security-oauth-agent",
    "role": "primary",
    "skillId": "security.inspect_oauth_token",
    "reason": "The user requested OAuth token inspection."
  }
]

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
  "skippedAgents": [
    {
      "agentId": "string",
      "reason": "string"
    }
  ],
  "routingConfidence": "low|medium|high",
  "routingReasoningSummary": "string",
  "resolutionStatus": "resolved|needs_more_info|unsupported"
}`;

const securityKeywords = [
  "oauth",
  "token",
  "scope",
  "permission",
  "unauthorized",
  "forbidden",
  "401",
  "403",
  "invalid_client",
  "authentication",
  "authorization",
  "saml",
  "login",
  "access denied"
];
const apiHealthKeywords = ["timeout", "latency", "dns", "tls", "certificate", "webhook", "delivery failed", "rate limit", "429", "500", "502", "503", "504", "unavailable", "nightly scan"];

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function asOptionalErrorCode(value: unknown, fallback?: ErrorCode): ErrorCode | undefined {
  return typeof value === "string" && errorCodes.includes(value as ErrorCode) ? (value as ErrorCode) : fallback;
}

function classifyForRouting(message: string, reason: string): Classification {
  const lower = message.toLowerCase();
  const errorCode = errorCodes.find((code) => lower.includes(code));
  const system: EnterpriseSystem = lower.includes("jira")
    ? "Jira"
    : lower.includes("github")
      ? "GitHub"
      : lower.includes("pagerduty")
        ? "PagerDuty"
        : lower.includes("sap")
          ? "SAP"
          : lower.includes("confluence")
            ? "Confluence"
            : lower.includes("monday")
              ? "Monday"
              : "Unknown";
  const reporterType: ReporterType = includesAny(lower, ["api", "sync", "403", "401", "429", "token", "scope", "webhook", "nightly scan"])
    ? "it_engineer"
    : includesAny(lower, ["i ", "can't", "cannot", "says i", "don't have"])
      ? "end_user"
      : "unknown";
  const operation: IntegrationOperation =
    system === "Jira" && includesAny(lower, ["ticket", "issue", "creating issues", "create"])
      ? "create_issue"
      : system === "GitHub" && includesAny(lower, ["repository", "repo", "scan", "sync"])
        ? "repository_scan"
        : system === "PagerDuty" && includesAny(lower, ["alert", "incident", "event"])
          ? "send_alert"
          : includesAny(lower, ["oauth", "invalid_client", "client secret", "token endpoint"])
            ? "oauth_client_auth"
            : system === "Monday" && lower.includes("board")
              ? "sync_board_updates"
              : system === "Confluence" && lower.includes("page")
                ? "read_pages"
                : "unknown";
  const issueType: IssueType =
    system === "GitHub" && includesAny(lower, ["nightly scan", "rate limit"])
      ? "RATE_LIMIT"
      : includesAny(lower, ["invalid_client", "invalid client", "client secret", "credential rotation"]) || errorCode === "401"
        ? "AUTHENTICATION_FAILURE"
        : includesAny(lower, ["permission", "access denied", "forbidden", "missing scope"]) || errorCode === "403"
          ? "AUTHORIZATION_FAILURE"
          : includesAny(lower, ["rate limit", "too many requests"]) || errorCode === "429"
            ? "RATE_LIMIT"
            : includesAny(lower, ["timeout", "dns", "tls", "certificate", "connection refused"])
              ? "CONNECTIVITY_FAILURE"
              : includesAny(lower, ["webhook", "delivery failed"])
                ? "WEBHOOK_FAILURE"
                : errorCode && ["500", "502", "503", "504"].includes(errorCode)
                  ? "API_AVAILABILITY"
                  : "UNKNOWN";

  return {
    system,
    errorCode,
    issueType,
    operation,
    confidence: system === "Unknown" || issueType === "UNKNOWN" ? "low" : "high",
    reasoningSummary: reason,
    classificationSource: "rules_fallback",
    reporterType,
    supportMode: reporterType === "end_user" ? "end_user_support" : "technical_integration"
  };
}

function select(agentId: AgentName, role: "primary" | "supporting", skillId: string, reason: string): SelectedAgent {
  return { agentId, role, skillId, reason };
}

function completeSkippedAgents(selectedAgents: SelectedAgent[], explicitSkipped: SkippedAgent[] = []): SkippedAgent[] {
  const selectedIds = new Set(selectedAgents.map((agent) => agent.agentId));
  const explicitById = new Map(explicitSkipped.map((agent) => [agent.agentId, agent.reason]));

  return getExecutableAgentCards()
    .filter((card) => !selectedIds.has(card.agentId))
    .map((card) => ({
      agentId: card.agentId,
      reason: explicitById.get(card.agentId) ?? "No matching Agent Card skill was needed for this route."
    }));
}

export function routeWithRules(message: string, reason = "AI routing unavailable; Agent Card rules fallback was used."): RoutingDecision {
  const lower = message.toLowerCase();
  const classification = classifyForRouting(message, reason);

  if (classification.system === "Monday" && classification.issueType === "UNKNOWN") {
    return {
      classification,
      selectedAgents: [],
      skippedAgents: completeSkippedAgents([]),
      routingSource: "rules_fallback",
      routingConfidence: "low",
      routingReasoningSummary: "The issue mentions Monday.com but does not include the failed action or exact error.",
      resolutionStatus: "needs_more_info"
    };
  }

  const selectedAgents: SelectedAgent[] =
    classification.system === "Jira" && classification.reporterType === "end_user"
      ? [
          select("end-user-triage-agent", "primary", "end_user.triage", "Plain-language support issue should be translated into support context."),
          select("jira-agent", "supporting", "jira.diagnose_user_permission_issue", "Jira Agent owns Jira permission troubleshooting."),
          ...(includesAny(lower, securityKeywords)
            ? [select("security-oauth-agent", "supporting", "security.compare_oauth_scopes", "Security Agent can compare OAuth/scope posture if relevant.")]
            : [])
        ]
      : classification.system === "Jira"
        ? [
            select("jira-agent", "primary", "jira.diagnose_issue_creation_failure", "Jira Agent owns Jira issue creation troubleshooting."),
            ...(includesAny(lower, securityKeywords)
              ? [select("security-oauth-agent", "supporting", "security.compare_oauth_scopes", "Security Agent can compare OAuth/scope posture if relevant.")]
              : [])
          ]
        : classification.system === "GitHub" && classification.operation === "repository_scan"
          ? [
              select("github-agent", "primary", "github.diagnose_repository_scan_failure", "GitHub Agent owns repository scan troubleshooting.")
            ]
          : includesAny(lower, ["inspect oauth"])
            ? [select("security-oauth-agent", "primary", "security.inspect_oauth_token", "The user requested a sensitive OAuth token inspection.")]
            : includesAny(lower, securityKeywords)
              ? [select("security-oauth-agent", "primary", "security.compare_oauth_scopes", "Security Agent owns OAuth and policy-sensitive checks.")]
              : [];

  return {
    classification,
    selectedAgents,
    skippedAgents: completeSkippedAgents(selectedAgents),
    routingSource: "rules_fallback",
    routingConfidence: selectedAgents.length > 0 ? "high" : "low",
    routingReasoningSummary: selectedAgents.length > 0 ? reason : "No Agent Card skill matched enough detail to start a specialist task.",
    resolutionStatus: selectedAgents.length > 0 ? "resolved" : "needs_more_info"
  };
}

function normalizeClassification(value: unknown, fallback: Classification, aiProvider: "openrouter" | "openai", aiModel: string): Classification {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

  return {
    system: asEnum(record.system, systems, fallback.system),
    errorCode: asOptionalErrorCode(record.errorCode, fallback.errorCode),
    issueType: asEnum(record.issueType, issueTypes, fallback.issueType),
    operation: asEnum(record.operation, operations, fallback.operation ?? "unknown"),
    confidence: asEnum(record.confidence, ["low", "medium", "high"] as const, "medium"),
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
      reason: typeof item.reason === "string" ? item.reason : "Selected by AI Agent Card router."
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
      typeof record.routingReasoningSummary === "string" ? record.routingReasoningSummary : "AI selected agents by Agent Card skills.",
    resolutionStatus: asEnum(record.resolutionStatus, ["resolved", "needs_more_info", "unsupported"] as const, "resolved")
  };
}

function normalizeSelectedSkill(agentId: AgentName, skillId: string | undefined, message: string): string | undefined {
  const card = getAgentCard(agentId);

  if (skillId && card?.skills.some((skill) => skill.id === skillId)) {
    return skillId;
  }

  const lower = message.toLowerCase();

  const inferred =
    agentId === "jira-agent" && includesAny(lower, ["don't have permission", "dont have permission", "cannot create a ticket", "can't create a ticket", "permission"]) && includesAny(lower, ["ticket", "issue", "create"])
      ? "jira.diagnose_user_permission_issue"
      : agentId === "jira-agent" && includesAny(lower, ["403", "create", "creating issues", "issue creation"])
        ? "jira.diagnose_issue_creation_failure"
        : agentId === "security-oauth-agent" && includesAny(lower, ["inspect", "token", "oauth", "jwt"])
          ? "security.inspect_oauth_token"
          : agentId === "security-oauth-agent" && includesAny(lower, ["403", "permission", "scope", "access denied", "forbidden"])
            ? "security.compare_oauth_scopes"
            : agentId === "github-agent" && includesAny(lower, ["repository scan", "repository sync", "repo scan", "nightly scan"])
              ? "github.diagnose_repository_scan_failure"
              : agentId === "api-health-agent" && includesAny(lower, ["rate limit", "429", "nightly scan"])
                ? "api_health.diagnose_rate_limit"
                : agentId === "api-health-agent" && includesAny(lower, ["timeout", "dns", "tls", "certificate", "500", "502", "503", "504"])
                  ? "api_health.diagnose_connectivity_failure"
                  : agentId === "api-health-agent" && includesAny(lower, ["webhook", "delivery failed"])
                    ? "api_health.diagnose_webhook_delivery"
                    : undefined;

  return inferred && card?.skills.some((skill) => skill.id === inferred) ? inferred : undefined;
}

type ValidationResult =
  | { ok: true; decision: RoutingDecision }
  | { ok: false; reasons: string[] };

function validateRoutingDecision(decision: RoutingDecision, fallback: RoutingDecision, message: string): ValidationResult {
  const lower = message.toLowerCase();
  const reasons: string[] = [];

  const selectedById = new Map<AgentName, SelectedAgent>();

  for (const agent of decision.selectedAgents) {
    const card = getAgentCard(agent.agentId);

    if (!card || !isExecutableAgentCard(agent.agentId)) {
      reasons.push(`unknown agentId: ${agent.agentId}`);
      continue;
    }

    if (agent.agentId === "security-oauth-agent" && !includesAny(lower, securityKeywords)) {
      reasons.push("security-oauth-agent selected without security keywords.");
      continue;
    }

    if (agent.agentId === "api-health-agent" && !includesAny(lower, apiHealthKeywords)) {
      reasons.push("api-health-agent selected without health keywords.");
      continue;
    }

    const normalizedSkillId = normalizeSelectedSkill(agent.agentId, agent.skillId, message);

    if (!agent.skillId) {
      reasons.push(`missing skillId for ${agent.agentId}.`);
    } else if (!card.skills.some((skill) => skill.id === agent.skillId)) {
      reasons.push(`skillId not found on ${agent.agentId}: ${agent.skillId}.`);
    }

    if (!normalizedSkillId) {
      continue;
    }

    if (selectedById.has(agent.agentId)) {
      reasons.push(`duplicate agentId ignored: ${agent.agentId}.`);
      continue;
    }

    const normalizedAgent = { ...agent, skillId: normalizedSkillId };
    selectedById.set(agent.agentId, normalizedAgent.role === "primary" ? normalizedAgent : { ...normalizedAgent, role: "supporting" });
  }

  const selectedAgents = [...selectedById.values()];
  const fallbackHasKnownRoute = fallback.selectedAgents.length > 0 && fallback.classification.confidence === "high";
  const selectedIds = new Set(selectedAgents.map((agent) => agent.agentId));
  const includesFallbackAgents = fallback.selectedAgents.every((agent) => selectedIds.has(agent.agentId));

  if (selectedAgents.length === 0) {
    if (decision.classification.issueType === "UNKNOWN" && decision.classification.confidence === "low" && fallback.selectedAgents.length === 0) {
      return {
        ok: true,
        decision: { ...fallback, routingSource: decision.routingSource, routingReasoningSummary: decision.routingReasoningSummary }
      };
    }

    if (fallback.selectedAgents.length > 0) {
      return { ok: false, reasons: reasons.length ? reasons : ["no valid selected agents after validation."] };
    }

    return {
      ok: true,
      decision: { ...decision, selectedAgents: [], skippedAgents: completeSkippedAgents([]), resolutionStatus: "needs_more_info" }
    };
  }

  if (fallbackHasKnownRoute && !includesFallbackAgents) {
    return {
      ok: false,
      reasons: [
        ...reasons,
        `AI route omitted expected Agent Card route members: ${fallback.selectedAgents
          .filter((agent) => !selectedIds.has(agent.agentId))
          .map((agent) => agent.agentId)
          .join(", ")}.`
      ]
    };
  }

  if (!selectedAgents.some((agent) => agent.role === "primary")) {
    return { ok: false, reasons: [...reasons, "no primary agent."] };
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

async function callOpenRouter(message: string, apiKey: string, model: string): Promise<string | undefined> {
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
            agentCards: getExecutableAgentCards(),
            reporterTypes,
            supportModes: ["end_user_support", "technical_integration"]
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

async function callOpenAi(message: string, apiKey: string, model: string): Promise<string | undefined> {
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
          agentCards: getExecutableAgentCards(),
          reporterTypes,
          supportModes: ["end_user_support", "technical_integration"]
        })
      }
    ],
    temperature: 0
  });

  return completion.choices[0]?.message.content ?? undefined;
}

export async function routeWithAI(message: string): Promise<RoutingDecision> {
  const fallback = routeWithRules(message);
  const aiConfig = getAiConfig();

  if (!aiConfig.apiKey?.trim()) {
    console.info(`[router] ${aiConfig.provider} key is not configured; using Agent Card rules fallback`);
    return fallback;
  }

  try {
    const content =
      aiConfig.provider === "openrouter"
        ? await callOpenRouter(message, aiConfig.apiKey, aiConfig.model)
        : await callOpenAi(message, aiConfig.apiKey, aiConfig.model);

    if (!content) {
      return fallback;
    }

    const normalized = normalizeRoutingDecision(JSON.parse(content), fallback, aiConfig.provider, aiConfig.model);
    const validation = validateRoutingDecision(normalized, fallback, message);

    if (!validation.ok) {
      const reason = validation.reasons.join(" ");
      console.warn(`[router] AI routing validation failed; using Agent Card rules fallback: ${reason}`);
      return routeWithRules(message, `AI routing validation failed; Agent Card rules fallback was used. ${reason}`);
    }

    return validation.decision;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown AI router error";
    console.warn(`[router] AI routing failed; using Agent Card rules fallback: ${detail}`);
    return routeWithRules(message, `AI routing failed; Agent Card rules fallback was used. ${detail}`);
  }
}
