import { OpenRouter } from "@openrouter/sdk";
import OpenAI from "openai";
import type { FollowUpInterpretation, RequestInterpretation } from "@a2a/shared";
import { incidentTaxonomy } from "./config/incidentTaxonomy";
import { getAiConfig } from "./config/aiConfig";
import type { IncidentContext } from "./incidentContext";

const followUpPrompt = `You are a ServiceNow enterprise support follow-up interpreter.
You receive:
- the previous user issue
- the assistant's last clarification questions
- the previous structured request interpretation
- the previous incident context
- the user's current message

Decide whether the current message is a follow-up answer or a new request.

Return JSON only:
{
  "isFollowUp": true,
  "confidence": "low|medium|high",
  "reason": "string",
  "addsEnvironment": "string",
  "addsErrorText": "string",
  "addsImpact": "string",
  "addsSymptom": "string",
  "addsTargetSystemText": "string",
  "shouldPreservePreviousTargetSystem": true,
  "shouldPreservePreviousAction": true
}

Rules:
- If the previous request was enterprise_support and the assistant asked clarification questions, short answers like "production", "only me", "login error", "permission denied", "all users", "SSO", "MFA", "deploy stage", etc. are likely follow-ups.
- Do not treat follow-up answers as out_of_scope.
- Preserve the previous target system unless the user clearly replaces it.
- Preserve the previous action/symptom unless the user clearly replaces it.
- If the current message is a new unrelated request, isFollowUp=false.
- Do not authorize, diagnose, or execute anything.
- Only extract context.

Examples:
Previous user:
"i have issue with an internal CI tool, i can't login"
Previous assistant:
"Which environment? What exact login error? Does it affect only you or all users?"
Current:
"production"
Expected:
{"isFollowUp":true,"confidence":"high","addsEnvironment":"production","shouldPreservePreviousTargetSystem":true,"shouldPreservePreviousAction":true,"reason":"The user answered the environment clarification question."}

Previous user:
"our internal deployment tool is failing"
Previous assistant:
"Which stage failed? What is the exact error? What changed recently?"
Current:
"deploy stage fails with permission denied in production"
Expected:
{"isFollowUp":true,"confidence":"high","addsEnvironment":"production","addsErrorText":"permission denied","addsSymptom":"deployment/pipeline failure","shouldPreservePreviousTargetSystem":true,"shouldPreservePreviousAction":true,"reason":"The user provided deployment stage, error, and environment details."}

Previous user:
"the corporate portal is not loading"
Previous assistant:
"What error do you see? Is this affecting only you or multiple users?"
Current:
"all users get timeout error"
Expected:
{"isFollowUp":true,"confidence":"high","addsErrorText":"timeout error","addsImpact":"all users","shouldPreservePreviousTargetSystem":true,"shouldPreservePreviousAction":true,"reason":"The user provided error and impact details for the previous enterprise issue."}

Previous user:
"i have issue with an internal app"
Previous assistant:
"What is the affected system and what operation failed?"
Current:
"i want to order pizza"
Expected:
{"isFollowUp":false,"confidence":"high","reason":"The user started a new out-of-scope consumer request."}`;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeImpact(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const lower = value.toLowerCase();
  return incidentTaxonomy.impactPhrases.find((item) => item.terms.some((term) => lower.includes(term.toLowerCase())))?.value ?? value;
}

function normalizeFollowUp(value: unknown, fallback: FollowUpInterpretation): FollowUpInterpretation {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const confidence = record.confidence === "high" || record.confidence === "medium" || record.confidence === "low" ? record.confidence : fallback.confidence;

  return {
    isFollowUp: typeof record.isFollowUp === "boolean" ? record.isFollowUp : fallback.isFollowUp,
    confidence,
    reason: optionalString(record.reason) ?? fallback.reason,
    addsEnvironment: optionalString(record.addsEnvironment) ?? fallback.addsEnvironment,
    addsErrorText: optionalString(record.addsErrorText) ?? fallback.addsErrorText,
    addsImpact: normalizeImpact(optionalString(record.addsImpact)) ?? fallback.addsImpact,
    addsSymptom: optionalString(record.addsSymptom) ?? fallback.addsSymptom,
    addsTargetSystemText: optionalString(record.addsTargetSystemText) ?? fallback.addsTargetSystemText,
    shouldPreservePreviousTargetSystem:
      typeof record.shouldPreservePreviousTargetSystem === "boolean"
        ? record.shouldPreservePreviousTargetSystem
        : fallback.shouldPreservePreviousTargetSystem,
    shouldPreservePreviousAction:
      typeof record.shouldPreservePreviousAction === "boolean" ? record.shouldPreservePreviousAction : fallback.shouldPreservePreviousAction,
    interpretationSource: fallback.interpretationSource,
    aiProvider: fallback.aiProvider,
    aiModel: fallback.aiModel
  };
}

function firstTerm(value: string, terms: readonly string[]): string | undefined {
  return terms.find((term) => value.toLowerCase().includes(term.toLowerCase()));
}

function fallbackInterpretFollowUp(params: {
  currentMessage: string;
  previousInterpretation?: RequestInterpretation;
  previousIncidentContext?: IncidentContext;
  reason?: string;
}): FollowUpInterpretation {
  if (params.previousInterpretation?.scope !== "enterprise_support") {
    return {
      isFollowUp: false,
      confidence: "high",
      reason: params.reason ?? "No previous enterprise support interpretation is active.",
      interpretationSource: "fallback"
    };
  }

  const wordCount = params.currentMessage.trim().split(/\s+/).filter(Boolean).length;
  const unrelatedConsumerTerms = ["pizza", "lunch", "dinner", "recipe", "movie", "shopping", "weather"];
  const looksUnrelated = Boolean(firstTerm(params.currentMessage, unrelatedConsumerTerms));
  if (looksUnrelated) {
    return {
      isFollowUp: false,
      confidence: "high",
      reason: params.reason ?? "The message appears to start a new unrelated consumer request.",
      interpretationSource: "fallback"
    };
  }

  const environment = firstTerm(params.currentMessage, incidentTaxonomy.environments);
  const errorText = firstTerm(params.currentMessage, incidentTaxonomy.errorPhrases);
  const impact = incidentTaxonomy.impactPhrases.find((item) => firstTerm(params.currentMessage, item.terms))?.value;
  const category = incidentTaxonomy.categories.find((item) => firstTerm(params.currentMessage, item.terms));
  const isFollowUp = wordCount <= 8 || Boolean(environment || errorText || impact || category);

  return {
    isFollowUp,
    confidence: isFollowUp ? "medium" : "low",
    reason: params.reason ?? (isFollowUp ? "The message appears to add context to the active enterprise support issue." : "The message does not look like clarification context."),
    addsEnvironment: environment === "prod" ? "production" : environment === "stage" ? "staging" : environment,
    addsErrorText: errorText === "wrong password" ? "password is wrong" : errorText,
    addsImpact: impact,
    addsSymptom: category?.label,
    shouldPreservePreviousTargetSystem: isFollowUp,
    shouldPreservePreviousAction: isFollowUp,
    interpretationSource: "fallback"
  };
}

async function callOpenRouter(input: unknown, apiKey: string, model: string): Promise<string | undefined> {
  const openRouter = new OpenRouter({ apiKey });
  const result = await openRouter.chat.send({
    chatRequest: {
      model,
      messages: [
        { role: "system", content: followUpPrompt },
        { role: "user", content: JSON.stringify(input) }
      ],
      responseFormat: { type: "json_object" },
      stream: false,
      temperature: 0
    }
  });

  const content = result.choices[0]?.message.content;
  return typeof content === "string" ? content : undefined;
}

async function callOpenAi(input: unknown, apiKey: string, model: string): Promise<string | undefined> {
  const client = new OpenAI({ apiKey });
  const result = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: followUpPrompt },
      { role: "user", content: JSON.stringify(input) }
    ],
    temperature: 0
  });

  return result.choices[0]?.message.content ?? undefined;
}

export async function interpretFollowUp(params: {
  currentMessage: string;
  previousUserMessage?: string;
  previousAssistantMessage?: string;
  previousInterpretation?: RequestInterpretation;
  previousIncidentContext?: IncidentContext;
}): Promise<FollowUpInterpretation> {
  const fallback = fallbackInterpretFollowUp(params);

  if (params.previousInterpretation?.scope !== "enterprise_support") {
    return fallback;
  }

  const aiConfig = getAiConfig();
  console.info(`[follow-up-interpreter] provider=${aiConfig.provider} model=${aiConfig.model} hasKey=${aiConfig.hasApiKey}`);

  if (!aiConfig.apiKey?.trim()) {
    console.info("[follow-up-interpreter] fallback used reason=AI API key is not configured");
    return fallbackInterpretFollowUp({ ...params, reason: "AI API key is not configured; deterministic follow-up fallback was used." });
  }

  try {
    const input = {
      currentMessage: params.currentMessage,
      previousUserMessage: params.previousUserMessage,
      previousAssistantMessage: params.previousAssistantMessage,
      previousInterpretation: params.previousInterpretation,
      previousIncidentContext: params.previousIncidentContext
    };
    const content =
      aiConfig.provider === "openrouter"
        ? await callOpenRouter(input, aiConfig.apiKey, aiConfig.model)
        : await callOpenAi(input, aiConfig.apiKey, aiConfig.model);

    if (!content) {
      console.info("[follow-up-interpreter] fallback used reason=AI returned empty content");
      return fallbackInterpretFollowUp({ ...params, reason: "AI follow-up interpretation returned empty content; deterministic fallback was used." });
    }

    const normalized = normalizeFollowUp(JSON.parse(content), {
      ...fallback,
      interpretationSource: "ai",
      aiProvider: aiConfig.provider,
      aiModel: aiConfig.model
    });
    console.info(`[follow-up-interpreter] AI succeeded isFollowUp=${normalized.isFollowUp} confidence=${normalized.confidence}`);
    return normalized;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown AI follow-up interpreter error";
    console.warn(`[follow-up-interpreter] fallback used reason=${detail}`);
    return fallbackInterpretFollowUp({ ...params, reason: `AI follow-up interpretation failed; deterministic fallback was used. ${detail}` });
  }
}
