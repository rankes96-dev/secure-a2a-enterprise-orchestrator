import type { TrustedOnboardedAgent } from "./types";

// Local demo storage only. Production requires a persistent trusted connector
// registry with tenant ownership, audit, revocation, last verified timestamp,
// and external configuration hash history.
const trustedAgentsByOwner = new Map<string, TrustedOnboardedAgent[]>();

export function listTrustedOnboardedAgents(ownerKey: string): TrustedOnboardedAgent[] {
  return [...(trustedAgentsByOwner.get(ownerKey) ?? [])];
}

export function addTrustedOnboardedAgent(ownerKey: string, agent: TrustedOnboardedAgent): TrustedOnboardedAgent {
  const current = trustedAgentsByOwner.get(ownerKey) ?? [];
  trustedAgentsByOwner.set(ownerKey, [...current.filter((item) => item.agentId !== agent.agentId), agent]);
  return agent;
}
