import type { RequestInterpretation } from "@a2a/shared";

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
  const match = message.match(/\b(production|prod|staging|stage|dev|test|qa|sandbox)\b/i)?.[1];
  if (!match) {
    return undefined;
  }

  return match.toLowerCase() === "prod" ? "production" : match.toLowerCase();
}

function extractSymptom(message: string, interpretation?: RequestInterpretation): string | undefined {
  const lower = message.toLowerCase();
  const action = interpretation?.requestedActionText?.toLowerCase();

  if (/(login|log in|sign in|signin|authentication|sso|mfa|invalid credentials|access denied|can't login|cannot login)/i.test(lower) || action?.includes("login")) {
    return "login/authentication issue";
  }

  if (/(pipeline|deployment|deploy|build|test stage|release|artifact)/i.test(lower) || action?.includes("deploy")) {
    return "deployment/pipeline failure";
  }

  if (/(query timeout|dashboard not loading|dashboard|report failing|data refresh|snowflake)/i.test(lower)) {
    return "data/query/platform issue";
  }

  if (/(vpn|connection failed|cannot connect|can't connect|timeout|dns|tls|network)/i.test(lower)) {
    return "connectivity/network issue";
  }

  if (/(sync failed|sync|webhook|api error|callback)/i.test(lower)) {
    return "sync/integration issue";
  }

  if (/(error|failed|failure|broken|not working)/i.test(lower)) {
    return "enterprise application issue";
  }

  return undefined;
}

function extractErrorText(message: string): string | undefined {
  const code = message.match(/\b(401|403|404|429|500|502|503|504)\b/)?.[1];
  if (code) {
    return code;
  }

  const knownError = message.match(/\b(permission denied|access denied|invalid credentials|timeout error|login error|sso error|mfa error)\b/i)?.[1];
  if (knownError) {
    return knownError.toLowerCase();
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
  return firstMatch(message, [
    /\b(all users|one user|a group|all deployments|one service|one repository|production users|finance users|all finance users)\b/i
  ]);
}

function assignmentGroupFor(symptom?: string): string {
  if (symptom === "login/authentication issue") {
    return "IAM / Identity / SSO Support";
  }

  if (symptom === "deployment/pipeline failure") {
    return "CI/CD Platform / DevOps Tools";
  }

  if (symptom === "connectivity/network issue") {
    return "Network / Endpoint Support";
  }

  if (symptom === "data/query/platform issue") {
    return "Data Platform Support";
  }

  if (symptom === "sync/integration issue") {
    return "Integration Platform Support";
  }

  return "Service Desk Triage";
}

export function extractIncidentContext(message: string, interpretation?: RequestInterpretation): IncidentContext {
  const targetSystemText = extractTargetSystem(message, interpretation);
  const environment = extractEnvironment(message);
  const symptom = extractSymptom(message, interpretation);
  const errorText = extractErrorText(message);
  const impact = extractImpact(message);
  const hasMinimumDetails = Boolean(targetSystemText && symptom && (environment || errorText || impact));
  const detailCount = [targetSystemText, environment, symptom, errorText, impact].filter(Boolean).length;

  return {
    targetSystemText,
    environment,
    symptom,
    errorText,
    impact,
    suggestedAssignmentGroup: assignmentGroupFor(symptom),
    confidence: hasMinimumDetails && detailCount >= 4 ? "high" : hasMinimumDetails ? "medium" : "low",
    hasMinimumDetails
  };
}

export function buildManualIncidentAnswer(context: IncidentContext): string {
  const incidentType = context.symptom ? `enterprise ${context.symptom}` : "enterprise incident";

  return [
    `I identified this as an ${incidentType}, but no specialist Agent Card capability is currently available for ${context.targetSystemText ?? "this system"}.`,
    "Please open a ServiceNow incident manually.",
    `Suggested fields: Request type: Incident; Affected system: ${context.targetSystemText ?? "Unknown / needs confirmation"}; Environment: ${context.environment ?? "Unknown"}; Symptom: ${context.symptom ?? "Unknown"}; Error message/code: ${context.errorText ?? "Unknown"}; Suggested assignment group: ${context.suggestedAssignmentGroup}; Business impact: ${context.impact ?? "required"}; Attachments: screenshot, timestamp, affected users/services, and recent change reference.`
  ].join(" ");
}
