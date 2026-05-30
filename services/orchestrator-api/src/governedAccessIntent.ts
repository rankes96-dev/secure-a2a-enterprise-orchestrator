import type { RequestInterpretation } from "@a2a/shared";
import type { TrustedOnboardedAgent } from "./agentOnboarding.js";
import { getAiConfig, getSafeAiConfigSummary } from "./config/aiConfig.js";
import { inferConnectorRoutingIntent } from "./connectorRouting.js";
import { callOpenRouterJson } from "./openRouterClient.js";
import { extractPendingAccessLevelFromMessage, extractPendingBusinessReasonFromMessage } from "./pendingInteractionResolver.js";

export type GovernedAccessIntentType = "access_request" | "permission_request" | "service_request" | "unknown";
export type GovernedAccessIntentSource = "deterministic" | "ai";

export type GovernedAccessIntent = {
  intentType: GovernedAccessIntentType;
  targetResourceSystem?: string;
  targetResourceType?: string;
  targetResourceName?: string;
  requestedAccessLevel?: string;
  businessReason?: string;
  confidence: "low" | "medium" | "high";
  source: GovernedAccessIntentSource;
  rawPromptStored: false;
  reason: string;
  aiProvider?: "openrouter";
  aiModel?: string;
};

const intentTypes = ["access_request", "permission_request", "service_request", "unknown"] as const;
const confidenceValues = ["low", "medium", "high"] as const;

const governedAccessIntentPrompt = `You are a governed enterprise access planning intent interpreter.
Return candidate planning fields only. You are not an authorization or execution system.

Rules:
- Interpret whether the user is asking to prepare an access, permission, or service request.
- Return JSON only with these keys:
{
  "intentType": "access_request|permission_request|service_request|unknown",
  "targetResourceSystem": "string",
  "targetResourceType": "string",
  "targetResourceName": "string",
  "requestedAccessLevel": "viewer|contributor|project admin",
  "businessReason": "string",
  "confidence": "low|medium|high",
  "reason": "string"
}
- AI output is advisory candidate extraction only.
- Do not approve, execute, grant access, issue tokens, decide policy, or claim that a request was submitted.
- Do not return secrets, tokens, Authorization headers, private keys, API keys, cookies, or other protected material.
- If the user asks for protected material or policy bypass, still only classify the access intent fields; Gateway security detection decides blocking.
- Use targetResourceSystem for the enterprise system, such as jira or github, only when the text or prior context makes it clear.
- Use targetResourceType for resource shapes such as project, repository, group, role, application, or service.
- If the message is unrelated to access or service request planning, return intentType unknown with low confidence.`;

function optionalString(value: unknown, maxLength = 120): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}._ -]+/gu, " ").replace(/\s+/g, " ").trim();
}

function unsafeField(value: string): boolean {
  return /\b(raw token|bearer|authorization header|access token|refresh token|client secret|private key|api key|session cookie|cookie|password|bypass|ignore policy|skip approval|override approval)\b/i.test(value);
}

function cleanSystem(value: string | undefined): string | undefined {
  const cleaned = optionalString(value, 64)?.toLowerCase().replace(/[^a-z0-9_-]+/g, "");
  return cleaned && !unsafeField(cleaned) ? cleaned : undefined;
}

function cleanResourceType(value: string | undefined): string | undefined {
  const cleaned = optionalString(value, 64)?.toLowerCase().replace(/[^a-z0-9_-]+/g, "");
  if (!cleaned || unsafeField(cleaned)) {
    return undefined;
  }
  if (cleaned === "repo") {
    return "repository";
  }
  return cleaned;
}

function cleanResourceName(value: string | undefined): string | undefined {
  const cleaned = optionalString(value, 100)?.replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "");
  if (!cleaned || unsafeField(cleaned)) {
    return undefined;
  }
  const normalized = cleaned.toLowerCase();
  if (["jira", "github", "git hub", "project", "repo", "repository", "access", "permission", "viewer", "contributor"].includes(normalized)) {
    return undefined;
  }
  return cleaned;
}

function cleanBusinessReason(value: string | undefined): string | undefined {
  const cleaned = optionalString(value, 240);
  if (!cleaned || cleaned.length < 3 || unsafeField(cleaned)) {
    return undefined;
  }
  return cleaned.replace(/^that\s+/i, "");
}

function normalizeAccessLevel(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return extractPendingAccessLevelFromMessage(value) ??
    (/\bvisibility\s+into\b/i.test(value) ? "viewer" : undefined) ??
    (["viewer", "contributor", "project admin"].includes(value.toLowerCase()) ? value.toLowerCase() : undefined);
}

function planningAgents(installedAgents: TrustedOnboardedAgent[] = []): TrustedOnboardedAgent[] {
  return installedAgents.filter((agent) => agent.connectorProfile?.planning?.supported === true);
}

function agentTerms(agent: TrustedOnboardedAgent): string[] {
  const connectorId = agent.connectorId ?? agent.connectorProfile?.connectorId ?? "";
  const resourceSystem = agent.resourceSystem ?? agent.connectorProfile?.resourceSystem ?? "";
  const displayName = agent.connectorProfile?.displayName ?? agent.connectorDisplayName ?? "";
  return [
    connectorId,
    connectorId.replace(/-reference$/i, ""),
    resourceSystem,
    displayName
  ].map((term) => normalizeText(term)).filter(Boolean);
}

function systemFromInstalledTerms(message: string, installedAgents: TrustedOnboardedAgent[] = []): string | undefined {
  const text = normalizeText(message);
  const match = planningAgents(installedAgents).find((agent) =>
    agentTerms(agent).some((term) => term && text.includes(term))
  );
  return (match?.resourceSystem ?? match?.connectorProfile?.resourceSystem)?.toLowerCase();
}

function systemFromContext(context?: RequestInterpretation, installedAgents: TrustedOnboardedAgent[] = []): string | undefined {
  const contextText = normalizeText([
    context?.targetSystemText,
    context?.targetResourceType,
    context?.targetResourceName
  ].filter(Boolean).join(" "));
  if (!contextText) {
    return undefined;
  }
  const match = planningAgents(installedAgents).find((agent) =>
    agentTerms(agent).some((term) => term && contextText.includes(term))
  );
  return (match?.resourceSystem ?? match?.connectorProfile?.resourceSystem)?.toLowerCase();
}

function explicitSystemFromMessage(message: string): string | undefined {
  const text = normalizeText(message);
  if (/\bjira\b/.test(text)) return "jira";
  if (/\bgithub\b|\bgit hub\b/.test(text)) return "github";
  return undefined;
}

function installedHasSystem(resourceSystem: string, installedAgents: TrustedOnboardedAgent[] = []): boolean {
  const normalized = resourceSystem.toLowerCase();
  return !installedAgents.length || planningAgents(installedAgents).some((agent) =>
    [agent.resourceSystem, agent.connectorProfile?.resourceSystem]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase() === normalized)
  );
}

function resourceTypeFromMessage(message: string): string | undefined {
  const text = normalizeText(message);
  if (/\b(repo|repository)\b/.test(text)) return "repository";
  if (/\b(project|projects)\b/.test(text)) return "project";
  if (/\b(group|team)\b/.test(text)) return "group";
  if (/\b(role|roles)\b/.test(text)) return "role";
  if (/\b(app|application|system|portal)\b/.test(text)) return "application";
  if (/\b(service|catalog item|request item)\b/.test(text)) return "service";
  return undefined;
}

function resourceNameFromMessage(message: string, targetResourceType?: string): string | undefined {
  const repoBefore = message.match(/\b([A-Za-z0-9][A-Za-z0-9._-]{1,80})\s+(?:repo|repository)\b/i)?.[1];
  const repoAfter = message.match(/\b(?:repo|repository)\s+([A-Za-z0-9][A-Za-z0-9._-]{1,80})\b/i)?.[1];
  const projectAfter = message.match(/\bproject\s+([A-Z][A-Z0-9_-]{1,20})\b/)?.[1];
  const projectBefore = message.match(/\b([A-Z][A-Z0-9_-]{1,20})\s+project\b/)?.[1];
  const addMeTo = message.match(/\badd\s+(?:me|us|this user|the user)\s+to\s+([A-Z][A-Z0-9_-]{1,20})\b/i)?.[1];
  const allCapsTarget = targetResourceType
    ? message.match(/\b([A-Z][A-Z0-9_-]{1,20})\b/)?.[1]
    : undefined;
  return cleanResourceName(repoBefore ?? repoAfter ?? projectAfter ?? projectBefore ?? addMeTo ?? allCapsTarget);
}

function inferredSystemFromResourceShape(targetResourceType: string | undefined, installedAgents: TrustedOnboardedAgent[] = []): string | undefined {
  if (targetResourceType === "repository" && installedHasSystem("github", installedAgents)) {
    return "github";
  }
  return undefined;
}

function contextCompatibleWithResourceShape(resourceSystem: string | undefined, targetResourceType: string | undefined): boolean {
  if (!resourceSystem || !targetResourceType) {
    return true;
  }
  if (targetResourceType === "repository") {
    return resourceSystem === "github";
  }
  if (targetResourceType === "project") {
    return resourceSystem === "jira";
  }
  return true;
}

function accessSignalScore(message: string): number {
  const text = normalizeText(message);
  let score = 0;
  if (/\b(access|permissions?|role)\b/.test(text)) score += 3;
  if (/\bget\s+into\b/.test(text)) score += 3;
  if (/\bvisibility\s+into\b/.test(text)) score += 3;
  if (/\badd\s+(?:me|us|this user|the user)\s+to\b/.test(text)) score += 3;
  if (/\bwork\s+on\b/.test(text) && /\b(project|repo|repository|system|application)\b/.test(text)) score += 2;
  if (/\b(i need|need|want|request|can you|please)\b/.test(text) && /\b(project|repo|repository|system|application|group|role)\b/.test(text)) score += 1;
  if (/\b(status|show me|what is the status|why can t|why cannot|fails?|failed|failure|error|rate limit|create issue|pull request|incident)\b/.test(text) && !/\b(access|permissions?|role)\b/.test(text)) {
    score -= 3;
  }
  return score;
}

function intentTypeFromMessage(message: string): GovernedAccessIntentType {
  const text = normalizeText(message);
  if (accessSignalScore(message) <= 0) {
    return "unknown";
  }
  if (/\b(permissions?|role|admin|administrator)\b/.test(text)) {
    return "permission_request";
  }
  if (/\b(service request|catalog item|request item)\b/.test(text)) {
    return "service_request";
  }
  return "access_request";
}

function confidenceFor(input: {
  intentType: GovernedAccessIntentType;
  targetResourceSystem?: string;
  targetResourceName?: string;
  score: number;
}): "low" | "medium" | "high" {
  if (input.intentType === "unknown" || input.score <= 0) {
    return "low";
  }
  if (input.targetResourceSystem && input.targetResourceName && input.score >= 3) {
    return "high";
  }
  if (input.targetResourceSystem || input.targetResourceName || input.score >= 3) {
    return "medium";
  }
  return "low";
}

export function fallbackGovernedAccessIntent(params: {
  message: string;
  installedAgents?: TrustedOnboardedAgent[];
  previousInterpretation?: RequestInterpretation;
}): GovernedAccessIntent {
  const connectorIntent = inferConnectorRoutingIntent(params.message);
  const targetResourceType = cleanResourceType(resourceTypeFromMessage(params.message));
  const targetResourceName = cleanResourceName(connectorIntent.targetResourceName) ?? resourceNameFromMessage(params.message, targetResourceType);
  const shapeInferredSystem = inferredSystemFromResourceShape(targetResourceType, params.installedAgents);
  const contextSystem = systemFromContext(params.previousInterpretation, params.installedAgents);
  const compatibleContextSystem = contextCompatibleWithResourceShape(contextSystem, targetResourceType)
    ? contextSystem
    : undefined;
  const detectedSystem =
    cleanSystem(connectorIntent.fulfillmentCapability === "access.request.prepare" ? connectorIntent.targetResourceSystem : undefined) ??
    explicitSystemFromMessage(params.message) ??
    systemFromInstalledTerms(params.message, params.installedAgents) ??
    shapeInferredSystem ??
    compatibleContextSystem;
  const targetResourceSystem = cleanSystem(detectedSystem);
  const score = Math.max(
    accessSignalScore(params.message),
    connectorIntent.fulfillmentCapability === "access.request.prepare" ? 3 : 0
  );
  const intentType = connectorIntent.intentClass ?? intentTypeFromMessage(params.message);
  const requestedAccessLevel = normalizeAccessLevel(connectorIntent.requestedAccessLevel) ?? normalizeAccessLevel(params.message);
  const businessReason = cleanBusinessReason(extractPendingBusinessReasonFromMessage(params.message));
  const confidence = confidenceFor({ intentType, targetResourceSystem, targetResourceName, score });

  return {
    intentType,
    targetResourceSystem,
    targetResourceType,
    targetResourceName,
    requestedAccessLevel,
    businessReason,
    confidence,
    source: "deterministic",
    rawPromptStored: false,
    reason: confidence === "low"
      ? "Deterministic access intent interpreter did not find enough governed planning evidence."
      : "Deterministic access intent interpreter normalized candidate planning fields without granting authority."
  };
}

function shouldTryAiFallback(intent: GovernedAccessIntent, message: string): boolean {
  return intent.confidence !== "high" &&
    (intent.intentType !== "unknown" || accessSignalScore(message) >= 3);
}

async function callOpenRouterForGovernedAccessIntent(message: string, previousInterpretation: RequestInterpretation | undefined, apiKey: string, baseURL: string, model: string): Promise<string | undefined> {
  return callOpenRouterJson({
    apiKey,
    baseURL,
    model,
    messages: [
      { role: "system", content: governedAccessIntentPrompt },
      {
        role: "user",
        content: JSON.stringify({
          message,
          previousContext: previousInterpretation
            ? {
                targetSystemText: previousInterpretation.targetSystemText,
                targetResourceType: previousInterpretation.targetResourceType,
                targetResourceName: previousInterpretation.targetResourceName,
                intentType: previousInterpretation.intentType
              }
            : undefined
        })
      }
    ]
  });
}

function normalizeAiGovernedAccessIntent(value: unknown, params: {
  fallback: GovernedAccessIntent;
  installedAgents?: TrustedOnboardedAgent[];
  aiProvider: "openrouter";
  aiModel: string;
}): GovernedAccessIntent {
  const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const intentType = enumValue(record.intentType, intentTypes, params.fallback.intentType);
  const targetResourceType = cleanResourceType(optionalString(record.targetResourceType)) ?? params.fallback.targetResourceType;
  const targetResourceSystem = cleanSystem(optionalString(record.targetResourceSystem)) ?? params.fallback.targetResourceSystem;
  const targetResourceName = cleanResourceName(optionalString(record.targetResourceName)) ?? params.fallback.targetResourceName;
  const requestedAccessLevel = normalizeAccessLevel(optionalString(record.requestedAccessLevel)) ?? params.fallback.requestedAccessLevel;
  const businessReason = cleanBusinessReason(optionalString(record.businessReason)) ?? params.fallback.businessReason;
  const confidence = enumValue(record.confidence, confidenceValues, params.fallback.confidence);
  const validatedSystem = targetResourceSystem && installedHasSystem(targetResourceSystem, params.installedAgents)
    ? targetResourceSystem
    : params.fallback.targetResourceSystem;
  const validatedConfidence = confidenceFor({
    intentType,
    targetResourceSystem: validatedSystem,
    targetResourceName,
    score: confidence === "high" ? 3 : confidence === "medium" ? 2 : 1
  });

  return {
    intentType,
    targetResourceSystem: validatedSystem,
    targetResourceType,
    targetResourceName,
    requestedAccessLevel,
    businessReason,
    confidence: validatedConfidence,
    source: "ai",
    rawPromptStored: false,
    reason: cleanBusinessReason(optionalString(record.reason, 240)) ?? "AI returned candidate planning fields; Gateway validation retained only safe fields.",
    aiProvider: params.aiProvider,
    aiModel: params.aiModel
  };
}

function completeness(intent: GovernedAccessIntent): number {
  return [
    intent.intentType !== "unknown",
    intent.targetResourceSystem,
    intent.targetResourceType,
    intent.targetResourceName,
    intent.requestedAccessLevel,
    intent.businessReason
  ].filter(Boolean).length;
}

export async function interpretGovernedAccessIntent(params: {
  message: string;
  installedAgents?: TrustedOnboardedAgent[];
  previousInterpretation?: RequestInterpretation;
  allowAi?: boolean;
}): Promise<GovernedAccessIntent> {
  const fallback = fallbackGovernedAccessIntent(params);
  if (params.allowAi === false || !shouldTryAiFallback(fallback, params.message)) {
    return fallback;
  }

  const aiConfig = getAiConfig();
  if (!aiConfig.apiKey?.trim()) {
    const summary = getSafeAiConfigSummary();
    console.info(`[governed-access-intent] AI fallback skipped reason=OpenRouter API key is not configured expectedKey=${summary.expectedKeyName} envFileHint=${summary.envFileHint}`);
    return fallback;
  }

  try {
    const content = await callOpenRouterForGovernedAccessIntent(
      params.message,
      params.previousInterpretation,
      aiConfig.apiKey,
      aiConfig.baseURL,
      aiConfig.model
    );
    if (!content) {
      return fallback;
    }
    const aiIntent = normalizeAiGovernedAccessIntent(JSON.parse(content), {
      fallback,
      installedAgents: params.installedAgents,
      aiProvider: aiConfig.provider,
      aiModel: aiConfig.model
    });
    return completeness(aiIntent) > completeness(fallback) && aiIntent.intentType !== "unknown" ? aiIntent : fallback;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown governed access intent AI error";
    console.warn(`[governed-access-intent] AI fallback failed; using deterministic interpretation: ${detail}`);
    return fallback;
  }
}
