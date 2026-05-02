import type { AgentCardRegistry } from "../../orchestrator-api/src/agentCardRegistry";
import { sensitiveScopesNeverIssuedByMockIdp } from "./config/oauthApplications";

export type DiscoveredA2AResourceRegistry = {
  audiences: Set<string>;
  scopes: Set<string>;
  scopeToAgents: Map<string, string[]>;
};

const deniedScopes = new Set<string>(sensitiveScopesNeverIssuedByMockIdp);

function addScope(registry: DiscoveredA2AResourceRegistry, scope: string | undefined, agentId: string): void {
  const normalized = scope?.trim();
  if (!normalized || deniedScopes.has(normalized)) {
    return;
  }

  registry.scopes.add(normalized);
  registry.scopeToAgents.set(normalized, [...(registry.scopeToAgents.get(normalized) ?? []), agentId]);
}

export async function buildDiscoveredA2AResourceRegistry(registrySource: AgentCardRegistry): Promise<DiscoveredA2AResourceRegistry> {
  const registry: DiscoveredA2AResourceRegistry = {
    audiences: new Set<string>(),
    scopes: new Set<string>(),
    scopeToAgents: new Map<string, string[]>()
  };

  for (const card of (await registrySource.listAgentCards()).filter((agentCard) => Boolean(agentCard.endpoint))) {
    const audience = card.auth.audience?.trim();
    if (audience) {
      registry.audiences.add(audience);
    }

    for (const skill of card.skills) {
      if (skill.requiredScopes?.length) {
        for (const scope of skill.requiredScopes) {
          addScope(registry, scope, card.agentId);
        }
        continue;
      }

      addScope(registry, skill.requiredPermission, card.agentId);
    }
  }

  return registry;
}
