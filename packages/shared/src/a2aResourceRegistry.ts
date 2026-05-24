export type A2AResourceRegistration = {
  audience: string;
  connectorId: string;
  agentId: string;
  resourceSystem: string;
  scopes: string[];
};

export type DiscoveredA2AResourceRegistry = {
  audiences: Set<string>;
  scopes: Set<string>;
  scopeToAgents: Map<string, string[]>;
  audienceToScopes: Map<string, string[]>;
};

const referenceResources: A2AResourceRegistration[] = [
  {
    agentId: "end-user-triage-agent",
    audience: "end-user-triage-agent",
    connectorId: "legacy-end-user-triage",
    resourceSystem: "enterprise-triage",
    scopes: ["enterprise.triage"]
  },
  {
    agentId: "jira-agent",
    audience: "jira-agent",
    connectorId: "legacy-jira-agent",
    resourceSystem: "jira",
    scopes: ["jira.diagnose"]
  },
  {
    agentId: "github-agent",
    audience: "github-agent",
    connectorId: "legacy-github-agent",
    resourceSystem: "github",
    scopes: ["github.diagnose", "github.rate_limit.read"]
  },
  {
    agentId: "pagerduty-agent",
    audience: "pagerduty-agent",
    connectorId: "legacy-pagerduty-agent",
    resourceSystem: "pagerduty",
    scopes: ["pagerduty.diagnose"]
  },
  {
    agentId: "security-oauth-agent",
    audience: "security-oauth-agent",
    connectorId: "legacy-security-oauth-agent",
    resourceSystem: "oauth-security",
    scopes: ["security.scope.compare", "security.token.inspect", "access.permission.grant"]
  },
  {
    agentId: "api-health-agent",
    audience: "api-health-agent",
    connectorId: "legacy-api-health-agent",
    resourceSystem: "api-health",
    scopes: ["apihealth.read"]
  },
  {
    agentId: "external-jira-agent",
    audience: "external-jira-agent",
    connectorId: "jira-reference",
    resourceSystem: "jira",
    scopes: ["read:jira-work", "read:jira-user", "write:jira-work", "manage:jira-project"]
  },
  {
    agentId: "external-servicenow-agent",
    audience: "external-servicenow-agent",
    connectorId: "servicenow-reference",
    resourceSystem: "servicenow",
    scopes: ["incident.read", "incident.write", "catalog.read", "user.read"]
  },
  {
    agentId: "external-github-agent",
    audience: "external-github-agent",
    connectorId: "github-reference",
    resourceSystem: "github",
    scopes: ["repo.metadata.read", "repo.contents.read", "repo.issues.read", "repo.pull_requests.read", "repo.administration.read"]
  }
];

export function referenceA2AResources(): A2AResourceRegistration[] {
  return referenceResources.map((resource) => ({
    ...resource,
    scopes: [...resource.scopes]
  }));
}

export function buildA2AResourceRegistry(
  resources: A2AResourceRegistration[],
  options: { deniedScopes?: Iterable<string> } = {}
): DiscoveredA2AResourceRegistry {
  const deniedScopes = new Set(options.deniedScopes ?? []);
  const registry: DiscoveredA2AResourceRegistry = {
    audiences: new Set<string>(),
    scopes: new Set<string>(),
    scopeToAgents: new Map<string, string[]>(),
    audienceToScopes: new Map<string, string[]>()
  };

  for (const resource of resources) {
    const audience = resource.audience.trim();
    if (audience) {
      registry.audiences.add(audience);
    }

    for (const scope of resource.scopes) {
      const normalized = scope.trim();
      if (!normalized || deniedScopes.has(normalized)) {
        continue;
      }

      registry.scopes.add(normalized);
      registry.scopeToAgents.set(normalized, [...(registry.scopeToAgents.get(normalized) ?? []), resource.agentId]);
      registry.audienceToScopes.set(audience, [...(registry.audienceToScopes.get(audience) ?? []), normalized]);
    }
  }

  return registry;
}
