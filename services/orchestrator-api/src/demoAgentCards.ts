import { randomUUID } from "node:crypto";
import type { AgentCard } from "./agentCards";

export type DemoAgentCardInput = {
  system: string;
  agentSlug?: string;
  agentId?: string;
  agentName?: string;
  description?: string;
  diagnosisGoal?: string;
  purposeText?: string;
  capability?: string;
  requiredScope?: string;
  riskLevel?: "low" | "medium" | "high" | "sensitive";
  resourceTypes?: string[];
  examples?: string[];
  supportingCapabilities?: string[];
  supportingHelpOptions?: string[];
};

const cardsBySession = new Map<string, AgentCard[]>();
const highRiskTerms = ["grant", "admin", "delete", "resolve", "escalate", "override", "rotate", "disable", "write", "token", "secret", "credential"];
const unsafeScopeTerms = ["admin", "write", "delete", "grant", "rotate", "disable", "token", "secret", "credential"];
const supportingHelpCapabilityByOption = new Map<string, string>([
  ["oauth_scope_compare", "oauth.scope.compare"],
  ["oauth scope comparison", "oauth.scope.compare"],
  ["oauth.scope.compare", "oauth.scope.compare"],
  ["api_health", "api.health.diagnose"],
  ["api health / rate limit", "api.health.diagnose"],
  ["api.health.diagnose", "api.health.diagnose"],
  ["security_policy", "security.policy.evaluate"],
  ["security policy evaluation", "security.policy.evaluate"],
  ["security.policy.evaluate", "security.policy.evaluate"]
]);

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "demo";
}

function scopeName(value: string): string {
  return slug(value).replace(/-/g, "_");
}

function randomId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 5);
}

function demoAgentId(input: DemoAgentCardInput, systemSlug: string): string {
  const explicitAgentId = input.agentId?.trim();
  if (explicitAgentId?.startsWith("demo-") && explicitAgentId.endsWith("-agent")) {
    return `demo-${slug(explicitAgentId.slice("demo-".length, -"agent".length))}-agent`;
  }

  const agentSlug = input.agentSlug?.trim();
  if (agentSlug) {
    return `demo-${slug(agentSlug)}-agent`;
  }

  return `demo-${systemSlug}-${randomId()}-agent`;
}

function listFromInput(value: string[] | undefined, fallback: string[]): string[] {
  const items = (value ?? []).map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? [...new Set(items)] : fallback;
}

function highRiskRequestedAction(value: string): boolean {
  const normalized = value.toLowerCase();
  return highRiskTerms.some((term) => normalized.includes(term));
}

function unsafeScope(value: string): boolean {
  const normalized = value.toLowerCase();
  return unsafeScopeTerms.some((term) => normalized.includes(term));
}

function validateStringLength(
  details: string[],
  field: string,
  value: string | undefined,
  maxLength: number,
  options?: { required?: boolean }
): void {
  const trimmed = value?.trim() ?? "";
  if (options?.required && !trimmed) {
    details.push(`${field} is required.`);
    return;
  }

  if (trimmed.length > maxLength) {
    details.push(`${field} must be ${maxLength} characters or fewer.`);
  }
}

function validateStringList(details: string[], field: string, values: string[] | undefined, maxItems: number, maxItemLength: number): void {
  const items = values ?? [];
  if (items.length > maxItems) {
    details.push(`${field} must contain ${maxItems} items or fewer.`);
  }

  if (items.some((item) => item.trim().length > maxItemLength)) {
    details.push(`${field} items must be ${maxItemLength} characters or fewer.`);
  }
}

function capabilityFromGoal(systemScope: string, goal?: string): string {
  const normalized = (goal ?? "").toLowerCase();

  if (/(?:access|permission|login|auth|sign[-\s]?in|sso|mfa)/.test(normalized)) {
    return `${systemScope}.access.diagnose`;
  }

  if (/(?:api|rate|limit|quota|health|latency|timeout|availability)/.test(normalized)) {
    return `${systemScope}.api_health.diagnose`;
  }

  if (/(?:alert|monitor|incident|notification|page|on[-\s]?call)/.test(normalized)) {
    return `${systemScope}.monitoring.diagnose`;
  }

  return `${systemScope}.issue.diagnose`;
}

function supportingCapabilitiesFor(input: DemoAgentCardInput): string[] {
  const mapped = (input.supportingHelpOptions ?? [])
    .map((option) => supportingHelpCapabilityByOption.get(option.trim().toLowerCase()))
    .filter((value): value is string => Boolean(value));

  return listFromInput([...(input.supportingCapabilities ?? []), ...mapped], []);
}

export function listDemoAgentCards(sessionToken: string): AgentCard[] {
  return [...(cardsBySession.get(sessionToken) ?? [])];
}

export function addDemoAgentCard(sessionToken: string, card: AgentCard): AgentCard {
  const current = cardsBySession.get(sessionToken) ?? [];
  const next = [...current.filter((item) => item.agentId !== card.agentId), card];
  cardsBySession.set(sessionToken, next);
  return card;
}

export function deleteDemoAgentCard(sessionToken: string, agentId: string): boolean {
  const current = cardsBySession.get(sessionToken) ?? [];
  const next = current.filter((card) => card.agentId !== agentId);
  cardsBySession.set(sessionToken, next);
  return next.length !== current.length;
}

export function validateDemoAgentInput(input: DemoAgentCardInput): string[] {
  const details: string[] = [];

  validateStringLength(details, "system", input.system, 60, { required: true });
  validateStringLength(details, "agentSlug", input.agentSlug, 80);
  validateStringLength(details, "agentId", input.agentId, 120);
  validateStringLength(details, "agentName", input.agentName, 120);
  validateStringLength(details, "description", input.description, 500);
  validateStringLength(details, "diagnosisGoal", input.diagnosisGoal, 240);
  validateStringLength(details, "purposeText", input.purposeText, 240);
  validateStringLength(details, "capability", input.capability, 120);
  validateStringLength(details, "requiredScope", input.requiredScope, 120);
  validateStringList(details, "resourceTypes", input.resourceTypes, 10, 40);
  validateStringList(details, "examples", input.examples, 5, 160);
  validateStringList(details, "supportingCapabilities", input.supportingCapabilities, 10, 80);
  validateStringList(details, "supportingHelpOptions", input.supportingHelpOptions, 10, 80);

  if (input.requiredScope && unsafeScope(input.requiredScope)) {
    details.push("requiredScope contains unsafe terms for the public demo.");
  }

  return details;
}

export function buildDemoAgentCard(input: DemoAgentCardInput): AgentCard {
  const rawSystem = input.system.trim();
  const systemSlug = slug(rawSystem);
  const systemScope = scopeName(rawSystem);
  const displaySystem = titleCase(rawSystem);
  const diagnosisGoal = input.diagnosisGoal?.trim() || input.purposeText?.trim();
  const agentId = demoAgentId(input, systemSlug);
  const capability = input.capability?.trim() || capabilityFromGoal(systemScope, diagnosisGoal);
  const requiredScope = input.requiredScope?.trim() || `${systemScope}.diagnose`;
  const requestedAction = capability;
  const riskLevel = highRiskRequestedAction(requestedAction) && input.riskLevel !== "sensitive"
    ? "high"
    : input.riskLevel ?? "low";

  return {
    agentId,
    name: input.agentName?.trim() || `Demo ${displaySystem} Agent`,
    description: input.description?.trim() || `Demo agent that diagnoses ${displaySystem} issues.`,
    systems: [rawSystem],
    endpoint: `session://demo-agent/${agentId}/task`,
    auth: {
      type: "oauth2_client_credentials_jwt",
      audience: agentId
    },
    skills: [
      {
        id: `${systemScope}.diagnose`,
        name: diagnosisGoal || `Diagnose ${displaySystem} issue`,
        description: diagnosisGoal
          ? `${diagnosisGoal} using generated demo agent-card metadata.`
          : `Diagnose ${displaySystem} issues using demo agent-card metadata.`,
        examples: listFromInput(input.examples, diagnosisGoal ? [diagnosisGoal] : []),
        requiredScopes: [requiredScope],
        capabilities: [capability],
        supportingCapabilities: supportingCapabilitiesFor(input),
        requestedAction,
        requiredPermission: requiredScope,
        riskLevel,
        owner: `Demo ${displaySystem} Team`,
        scope: {
          systems: [rawSystem],
          resourceTypes: listFromInput(input.resourceTypes, ["incident", "ticket", "account"])
        },
        sensitive: riskLevel === "sensitive"
      }
    ]
  };
}

export function validateDemoAgentCard(card: AgentCard): string[] {
  const warnings: string[] = [];

  if (!card.agentId.startsWith("demo-")) {
    warnings.push("Demo agentId should start with demo-.");
  }

  if (!card.endpoint.startsWith(`session://demo-agent/${card.agentId}/task`)) {
    warnings.push("Demo endpoint must use the session://demo-agent/{agentId}/task scheme.");
  }

  if (card.auth.audience !== card.agentId) {
    warnings.push("Demo auth audience must match agentId.");
  }

  for (const skill of card.skills) {
    if (skill.sensitive && skill.riskLevel !== "sensitive") {
      warnings.push(`Skill ${skill.id} cannot be sensitive unless riskLevel is sensitive.`);
    }

    if (skill.requestedAction && highRiskRequestedAction(skill.requestedAction) && skill.riskLevel !== "high" && skill.riskLevel !== "sensitive") {
      warnings.push(`Skill ${skill.id} contains high-risk action terms and should be high or sensitive risk.`);
    }

    if (skill.requiredScopes?.some((scope) => unsafeScope(scope))) {
      warnings.push(`Skill ${skill.id} uses a high-risk scope; demo defaults should be diagnostic/read-only.`);
    }
  }

  return warnings;
}
