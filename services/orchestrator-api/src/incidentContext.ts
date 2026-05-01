import type { FollowUpInterpretation, RequestInterpretation } from "@a2a/shared";
import { incidentTaxonomy } from "./config/incidentTaxonomy";

export type IncidentContext = {
  targetSystemText?: string;
  environment?: string;
  symptom?: string;
  errorText?: string;
  impact?: string;
  suggestedAssignmentGroup: string;
  confidence: "low" | "medium" | "high";
  hasMinimumDetails: boolean;
};

function clean(value: string | undefined): string | undefined {
  return value?.trim().replace(/[,.?!]+$/, "") || undefined;
}

function includesTerm(value: string, term: string): boolean {
  return value.toLowerCase().includes(term.toLowerCase());
}

function firstConfiguredTerm(message: string, terms: readonly string[]): string | undefined {
  return terms.find((term) => includesTerm(message, term));
}

function firstMatch(message: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = message.match(pattern)?.[1];
    if (match) {
      return clean(match);
    }
  }

  return undefined;
}

function extractTargetSystem(message: string, interpretation?: RequestInterpretation): string | undefined {
  return clean(interpretation?.targetSystemText) ?? firstMatch(message, [
    /\bissue with\s+([^,.;]+?)(?:\s+(?:in|on|with|and|but|i\b|we\b)|[,.;]|$)/i,
    /\bcan(?:not|'t)\s+log\s*in\s+to\s+([^,.;]+?)(?:\s+(?:in|on|with|and|but)|[,.;]|$)/i,
    /\b([^,.;]+?)\s+login\s+(?:is\s+)?(?:broken|failing|failed|down)/i,
    /\b([^,.;]+?)\s+(?:is\s+)?(?:failing|failed|broken|timing out|timeout|not loading)/i
  ]);
}

function extractEnvironment(message: string): string | undefined {
  const term = firstConfiguredTerm(message, incidentTaxonomy.environments);
  if (!term) {
    return undefined;
  }

  return term === "prod" ? "production" : term === "stage" ? "staging" : term;
}

function extractSymptom(message: string, interpretation?: RequestInterpretation): string | undefined {
  const action = interpretation?.requestedActionText ?? "";
  const value = `${message}\n${action}`;
  return incidentTaxonomy.categories.find((category) => firstConfiguredTerm(value, category.terms))?.label;
}

function extractErrorText(message: string): string | undefined {
  const code = message.match(/\b(401|403|404|429|500|502|503|504)\b/)?.[1];
  if (code) {
    return code;
  }

  const configured = firstConfiguredTerm(message, incidentTaxonomy.errorPhrases);
  if (configured) {
    return configured === "wrong password" ? "password is wrong" : configured;
  }

  return firstMatch(message, [
    /\bi get an?\s+([^,.;]+error[^,.;]*)/i,
    /\bi get\s+([^,.;]+)/i,
    /\bwith error\s+([^,.;]+)/i,
    /\berror[:\s]+([^,.;]+)/i,
    /\breturns\s+([^,.;]+)/i
  ]);
}

function extractImpact(message: string): string | undefined {
  return incidentTaxonomy.impactPhrases.find((item) => firstConfiguredTerm(message, item.terms))?.value;
}

function assignmentGroupFor(symptom?: string): string {
  return incidentTaxonomy.categories.find((category) => category.label === symptom)?.assignmentGroup ?? incidentTaxonomy.defaultAssignmentGroup;
}

function completeContext(context: Partial<IncidentContext>): IncidentContext {
  const hasMinimumDetails = Boolean(context.targetSystemText && context.symptom && (context.environment || context.errorText || context.impact));
  const detailCount = [context.targetSystemText, context.environment, context.symptom, context.errorText, context.impact].filter(Boolean).length;

  return {
    targetSystemText: context.targetSystemText,
    environment: context.environment,
    symptom: context.symptom,
    errorText: context.errorText,
    impact: context.impact,
    suggestedAssignmentGroup: assignmentGroupFor(context.symptom),
    confidence: hasMinimumDetails && detailCount >= 4 ? "high" : hasMinimumDetails ? "medium" : "low",
    hasMinimumDetails
  };
}

export function extractIncidentContext(message: string, interpretation?: RequestInterpretation): IncidentContext {
  return completeContext({
    targetSystemText: extractTargetSystem(message, interpretation),
    environment: extractEnvironment(message),
    symptom: extractSymptom(message, interpretation),
    errorText: extractErrorText(message),
    impact: extractImpact(message)
  });
}

export function mergeIncidentContext(previous?: IncidentContext, current: Partial<IncidentContext> = {}): IncidentContext {
  return completeContext({
    targetSystemText: current.targetSystemText ?? previous?.targetSystemText,
    environment: current.environment ?? previous?.environment,
    symptom: current.symptom ?? previous?.symptom,
    errorText: current.errorText ?? previous?.errorText,
    impact: current.impact ?? previous?.impact
  });
}

export function applyFollowUpToIncidentContext(params: {
  previous?: IncidentContext;
  current?: IncidentContext;
  followUp?: FollowUpInterpretation;
}): IncidentContext {
  const followUpPatch: Partial<IncidentContext> = params.followUp?.isFollowUp
    ? {
        targetSystemText: params.followUp.addsTargetSystemText ?? (params.followUp.shouldPreservePreviousTargetSystem ? params.previous?.targetSystemText : undefined),
        environment: params.followUp.addsEnvironment,
        symptom: params.followUp.addsSymptom ?? (params.followUp.shouldPreservePreviousAction ? params.previous?.symptom : undefined),
        errorText: params.followUp.addsErrorText,
        impact: params.followUp.addsImpact
      }
    : {};

  return mergeIncidentContext(params.previous, {
    ...params.current,
    ...Object.fromEntries(Object.entries(followUpPatch).filter(([, value]) => Boolean(value)))
  });
}

export function buildManualIncidentAnswer(context: IncidentContext): string {
  const incidentType = context.symptom ? `enterprise ${context.symptom}` : "enterprise incident";

  return [
    `I identified this as an ${incidentType}, but no specialist Agent Card capability is currently available for ${context.targetSystemText ?? "this system"}.`,
    "Please open a ServiceNow incident manually.",
    `Suggested fields: Request type: Incident; Affected system: ${context.targetSystemText ?? "Unknown / needs confirmation"}; Environment: ${context.environment ?? "Unknown"}; Symptom: ${context.symptom ?? "Unknown"}; Error message/code: ${context.errorText ?? "Unknown"}; Suggested assignment group: ${context.suggestedAssignmentGroup}; Business impact: ${context.impact ?? "required"}; Attachments: screenshot, timestamp, affected users/services, and recent change reference.`
  ].join(" ");
}

export function buildIncidentFollowUpQuestion(context: IncidentContext): string {
  const captured = [
    context.targetSystemText ? `affected system: ${context.targetSystemText}` : undefined,
    context.environment ? `environment: ${context.environment}` : undefined,
    context.symptom ? `symptom: ${context.symptom}` : undefined
  ].filter(Boolean).join("; ");
  const missing = [
    context.errorText ? undefined : "the exact error message or code",
    context.impact ? undefined : "whether this affects only you, a group, or all users/services"
  ].filter(Boolean).join(" and ");

  return `Thanks, I added ${captured || "that context"} to the active enterprise incident. I still need ${missing || "any remaining business impact details"} before recommending a manual ServiceNow incident.`;
}
