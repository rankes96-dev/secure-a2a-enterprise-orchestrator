import { OpenRouter } from "@openrouter/sdk";
import OpenAI from "openai";
import type { Classification, EnterpriseSystem, ErrorCode, IntegrationOperation, IssueType } from "@a2a/shared";
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

const classifierPrompt = `You are an enterprise integration incident classifier.
Classify the user's message into a routing decision for a secure multi-agent A2A integration resolver.

Supported systems:
Jira, GitHub, PagerDuty, SAP, Confluence, Monday, Unknown

Rules:
- 401, invalid_client, expired token, bad client secret, credential rotation => AUTHENTICATION_FAILURE
- 403, forbidden, missing scope, insufficient permission => AUTHORIZATION_FAILURE
- 429, rate limit, x-ratelimit-remaining 0, too many requests => RATE_LIMIT
- timeout, DNS, TLS, certificate, connection refused => CONNECTIVITY_FAILURE
- webhook failed, delivery failed, callback not received => WEBHOOK_FAILURE
- 500, 502, 503, 504, service unavailable => API_AVAILABILITY

Important classification nuance:
- GitHub 403 during nightly repository scan can be RATE_LIMIT if the text mentions rate limit, nightly scan, repository scan, or x-ratelimit.
- Jira 403 while creating issues is usually AUTHORIZATION_FAILURE with operation create_issue.
- SAP 401 with invalid_client or credential rotation is AUTHENTICATION_FAILURE with operation oauth_client_auth.
- PagerDuty alerts not opening incidents during peak traffic is likely RATE_LIMIT or WEBHOOK_FAILURE depending on wording.

Return a JSON object only with these fields:
system, errorCode, issueType, operation, confidence, reasoningSummary.
Do not include markdown, comments, or extra keys.`;

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function ruleBasedClassify(message: string, reason = "Rules fallback classification."): Classification {
  const lower = message.toLowerCase();
  const isTechnical = ["api", "sync", "403", "401", "429", "token", "scope", "webhook", "nightly scan"].some((item) => lower.includes(item));
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
  const operation: IntegrationOperation =
    system === "Jira" && includesAny(lower, ["creating issues", "create issue", "create a ticket", "create ticket", "open ticket"])
      ? "create_issue"
      : system === "GitHub" && includesAny(lower, ["nightly scan", "repository scan", "repository sync"])
        ? "repository_scan"
        : system === "PagerDuty" && lower.includes("alert")
          ? "send_alert"
          : includesAny(lower, ["invalid_client", "invalid client", "credential rotation", "oauth token", "token endpoint"])
            ? "oauth_client_auth"
            : system === "Monday" && lower.includes("board")
              ? "sync_board_updates"
              : system === "Confluence" && lower.includes("page")
                ? "read_pages"
                : "unknown";
  const issueType: IssueType =
    system === "GitHub" && errorCode === "403" && operation === "repository_scan"
      ? "RATE_LIMIT"
      : errorCode === "401" || includesAny(lower, ["invalid_client", "invalid client", "expired token", "bad client secret", "credential rotation"])
        ? "AUTHENTICATION_FAILURE"
        : errorCode === "403" || includesAny(lower, ["forbidden", "missing scope", "insufficient permission"])
          ? "AUTHORIZATION_FAILURE"
          : errorCode === "429" || includesAny(lower, ["rate limit", "too many requests"])
            ? "RATE_LIMIT"
            : includesAny(lower, ["timeout", "dns", "tls", "certificate", "connection refused"])
              ? "CONNECTIVITY_FAILURE"
              : includesAny(lower, ["webhook failed", "delivery failed", "callback not received"])
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
    reporterType: isTechnical ? "it_engineer" : "end_user",
    supportMode: isTechnical ? "technical_integration" : "end_user_support"
  };
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function asOptionalErrorCode(value: unknown, fallback?: ErrorCode): ErrorCode | undefined {
  return typeof value === "string" && errorCodes.includes(value as ErrorCode) ? (value as ErrorCode) : fallback;
}

function normalizeAiClassification(value: unknown, fallback: Classification, aiProvider: "openrouter" | "openai", aiModel: string): Classification {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

  return {
    system: asEnum(record.system, systems, fallback.system),
    errorCode: asOptionalErrorCode(record.errorCode, fallback.errorCode),
    issueType: asEnum(record.issueType, issueTypes, fallback.issueType),
    operation: asEnum(record.operation, operations, fallback.operation ?? "unknown"),
    confidence: asEnum(record.confidence, ["low", "medium", "high"] as const, "medium"),
    reasoningSummary: typeof record.reasoningSummary === "string" ? record.reasoningSummary : "AI classifier returned a valid routing decision.",
    classificationSource: "ai",
    aiProvider,
    aiModel,
    reporterType: asEnum(record.reporterType, ["end_user", "it_engineer", "unknown"] as const, fallback.reporterType),
    supportMode: asEnum(record.supportMode, ["end_user_support", "technical_integration"] as const, fallback.supportMode)
  };
}

async function classifyWithOpenRouter(message: string, apiKey: string, model: string): Promise<string | undefined> {
  const openRouter = new OpenRouter({ apiKey });
  const result = await openRouter.chat.send({
    chatRequest: {
      model,
      messages: [
        { role: "system", content: classifierPrompt },
        { role: "user", content: message }
      ],
      responseFormat: { type: "json_object" },
      stream: false,
      temperature: 0
    }
  });

  const content = result.choices[0]?.message.content;
  return typeof content === "string" ? content : undefined;
}

async function classifyWithOpenAi(message: string, apiKey: string, model: string): Promise<string | undefined> {
  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: classifierPrompt },
      { role: "user", content: message }
    ],
    temperature: 0
  });

  return completion.choices[0]?.message?.content ?? undefined;
}

export async function classify(message: string): Promise<Classification> {
  const fallback = ruleBasedClassify(message, "AI classifier unavailable; local rules were used.");
  const aiConfig = getAiConfig();

  if (!aiConfig.apiKey?.trim()) {
    console.info(`[classifier] ${aiConfig.provider} key is not configured; using rules fallback`);
    return fallback;
  }

  try {
    console.info(`[classifier] calling ${aiConfig.provider} model=${aiConfig.model}`);
    const content =
      aiConfig.provider === "openrouter"
        ? await classifyWithOpenRouter(message, aiConfig.apiKey, aiConfig.model)
        : await classifyWithOpenAi(message, aiConfig.apiKey, aiConfig.model);

    if (!content) {
      console.info(`[classifier] ${aiConfig.provider} returned empty content; using rules fallback`);
      return fallback;
    }

    console.info(`[classifier] ${aiConfig.provider} classification succeeded`);
    return normalizeAiClassification(JSON.parse(content), fallback, aiConfig.provider, aiConfig.model);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown AI classifier error";
    console.warn(`[classifier] ${aiConfig.provider} classification failed; using rules fallback: ${detail}`);
    return ruleBasedClassify(message, `AI classifier failed; local rules were used. ${detail}`);
  }
}
