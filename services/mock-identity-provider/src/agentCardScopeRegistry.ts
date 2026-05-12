import { sensitiveScopesNeverIssuedByMockIdp } from "./config/oauthApplications.js";

export type DiscoveredA2AResourceRegistry = {
  audiences: Set<string>;
  scopes: Set<string>;
  scopeToAgents: Map<string, string[]>;
};

const deniedScopes = new Set<string>(sensitiveScopesNeverIssuedByMockIdp);

const localA2AResources = [
  {
    agentId: "end-user-triage-agent",
    audience: "end-user-triage-agent",
    scopes: ["enterprise.triage"]
  },
  {
    agentId: "jira-agent",
    audience: "jira-agent",
    scopes: ["jira.diagnose"]
  },
  {
    agentId: "github-agent",
    audience: "github-agent",
    scopes: ["github.diagnose", "github.rate_limit.read"]
  },
  {
    agentId: "pagerduty-agent",
    audience: "pagerduty-agent",
    scopes: ["pagerduty.diagnose"]
  },
  {
    agentId: "security-oauth-agent",
    audience: "security-oauth-agent",
    scopes: ["security.scope.compare", "security.token.inspect", "access.permission.grant"]
  },
  {
    agentId: "api-health-agent",
    audience: "api-health-agent",
    scopes: ["apihealth.read"]
  },
  {
    agentId: "external-jira-agent",
    audience: "external-jira-agent",
    scopes: ["read:jira-work", "read:jira-user", "write:jira-work", "manage:jira-project"]
  },
  {
    agentId: "external-servicenow-agent",
    audience: "external-servicenow-agent",
    scopes: ["incident.read", "incident.write", "catalog.read", "user.read"]
  },
  {
    agentId: "external-github-agent",
    audience: "external-github-agent",
    scopes: ["repo.metadata.read", "repo.contents.read", "repo.issues.read", "repo.pull_requests.read", "repo.administration.read"]
  }
];

function addScope(registry: DiscoveredA2AResourceRegistry, scope: string | undefined, agentId: string): void {
  const normalized = scope?.trim();
  if (!normalized || deniedScopes.has(normalized)) {
    return;
  }

  registry.scopes.add(normalized);
  registry.scopeToAgents.set(normalized, [...(registry.scopeToAgents.get(normalized) ?? []), agentId]);
}

export function buildDiscoveredA2AResourceRegistry(): DiscoveredA2AResourceRegistry {
  const registry: DiscoveredA2AResourceRegistry = {
    audiences: new Set<string>(),
    scopes: new Set<string>(),
    scopeToAgents: new Map<string, string[]>()
  };

  for (const resource of localA2AResources) {
    registry.audiences.add(resource.audience);
    for (const scope of resource.scopes) {
      addScope(registry, scope, resource.agentId);
    }
  }

  return registry;
}
