import type { AgentCard } from "./agentCards";

export type DemoAgentCardInput = {
  system: string;
  agentName?: string;
  description?: string;
  capability?: string;
  riskLevel?: "low" | "medium" | "high" | "sensitive";
  resourceTypes?: string[];
  examples?: string[];
};

const cardsBySession = new Map<string, AgentCard[]>();
const highRiskTerms = ["grant", "admin", "delete", "resolve", "escalate", "override", "rotate", "disable", "write"];

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

function listFromInput(value: string[] | undefined, fallback: string[]): string[] {
  const items = (value ?? []).map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? [...new Set(items)] : fallback;
}

function highRiskRequestedAction(value: string): boolean {
  const normalized = value.toLowerCase();
  return highRiskTerms.some((term) => normalized.includes(term));
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

export function buildDemoAgentCard(input: DemoAgentCardInput): AgentCard {
  const rawSystem = input.system.trim();
  const systemSlug = slug(rawSystem);
  const systemScope = scopeName(rawSystem);
  const displaySystem = titleCase(rawSystem);
  const agentId = `demo-${systemSlug}-agent`;
  const capability = input.capability?.trim() || `${systemScope}.issue.diagnose`;
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
        name: `Diagnose ${displaySystem} issue`,
        description: `Diagnose ${displaySystem} issues using demo agent-card metadata.`,
        examples: listFromInput(input.examples, []),
        requiredScopes: [`${systemScope}.diagnose`],
        capabilities: [capability],
        requestedAction,
        requiredPermission: `${systemScope}.diagnose`,
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

    if (skill.requiredScopes?.some((scope) => /(?:admin|write|delete|grant|rotate|disable)/i.test(scope))) {
      warnings.push(`Skill ${skill.id} uses a high-risk scope; demo defaults should be diagnostic/read-only.`);
    }
  }

  return warnings;
}
