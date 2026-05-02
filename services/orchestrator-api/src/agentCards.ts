import type { AgentName } from "@a2a/shared";

export type AgentCardSkill = {
  id: string;
  name: string;
  description: string;
  examples?: string[];
  requiredScopes?: string[];
  capabilities?: string[];
  aliases?: string[];
  requestedAction?: string;
  requiredPermission?: string;
  riskLevel?: "low" | "medium" | "high" | "sensitive";
  metadataOptional?: boolean;
  supportingCapabilities?: string[];
  priority?: number;
  owner?: string;
  scope?: {
    systems?: string[];
    environments?: string[];
    resourceTypes?: string[];
  };
  sensitive?: boolean;
};

export type CapabilityMatchContext = {
  targetSystemText?: string;
  targetResourceType?: string;
  environment?: string;
};

export type CapabilityMatch = {
  agent: AgentCard;
  skill: AgentCardSkill;
  score: number;
  reason: string;
};

export type AgentCard = {
  agentId: string;
  name: string;
  description: string;
  systems: string[];
  endpoint: string;
  auth: {
    type: "mock_internal_token" | "oauth2_client_credentials_jwt";
    audience: string;
  };
  skills: AgentCardSkill[];
};

const staticAgentCards: AgentCard[] = [
  {
    agentId: "end-user-triage-agent",
    name: "End User Triage Agent",
    description: "Interprets non-technical user complaints and converts them into support context.",
    systems: ["Jira", "GitHub", "PagerDuty", "SAP", "Confluence", "Monday"],
    endpoint: process.env.END_USER_TRIAGE_AGENT_URL ?? "http://localhost:4106/task",
    auth: { type: "mock_internal_token", audience: "end-user-triage-agent" },
    skills: [
      {
        id: "end_user.triage",
        name: "End user triage",
        description: "Interpret a plain-language support issue.",
        capabilities: ["enterprise.issue.triage"],
        requestedAction: "enterprise.issue.triage",
        requiredPermission: "enterprise.triage",
        requiredScopes: ["enterprise.triage"],
        riskLevel: "low",
        owner: "Enterprise Support Triage"
      },
      {
        id: "end_user.ask_clarifying_questions",
        name: "Ask clarifying questions",
        description: "Ask for the missing action, error, or affected record when the issue is vague."
      },
      {
        id: "end_user.summarize_user_friendly",
        name: "User-friendly summary",
        description: "Convert technical findings into simple support language."
      }
    ]
  },
  {
    agentId: "jira-agent",
    name: "Jira Agent",
    description: "External Jira support agent that owns Jira-specific troubleshooting knowledge.",
    systems: ["Jira"],
    endpoint: process.env.JIRA_AGENT_URL ?? "http://localhost:4101/task",
    auth: { type: "mock_internal_token", audience: "jira-agent" },
    skills: [
      {
        id: "jira.diagnose_user_permission_issue",
        name: "Diagnose Jira user permission issue",
        description: "Diagnose user-facing Jira permission problems.",
        capabilities: ["jira.permission.diagnose"],
        supportingCapabilities: ["oauth.scope.compare"],
        requestedAction: "jira.permission.diagnose",
        requiredPermission: "jira.diagnose",
        requiredScopes: ["jira.diagnose"],
        priority: 80,
        owner: "Jira Support Team",
        scope: { systems: ["jira"], resourceTypes: ["project", "issue"] },
        riskLevel: "medium",
        examples: ["I don't have permission to create a Jira ticket", "Jira says I cannot create a ticket in FIN"]
      },
      {
        id: "jira.diagnose_issue_creation_failure",
        name: "Diagnose Jira issue creation failure",
        description: "Diagnose Jira issue creation API or sync failures.",
        capabilities: ["jira.issue_creation.diagnose"],
        supportingCapabilities: ["oauth.scope.compare"],
        requestedAction: "jira.issue_creation.diagnose",
        requiredPermission: "jira.diagnose",
        requiredScopes: ["jira.diagnose"],
        priority: 90,
        owner: "Jira Integration Team",
        scope: { systems: ["jira"], resourceTypes: ["issue"] },
        riskLevel: "medium",
        examples: ["Jira API returns 403 when creating issues"]
      },
      { id: "jira.ask_clarifying_questions", name: "Ask Jira clarifying questions", description: "Ask for Jira project, operation, or error detail." }
    ]
  },
  {
    agentId: "github-agent",
    name: "GitHub Agent",
    description: "External GitHub support agent that owns GitHub API/repository troubleshooting knowledge.",
    systems: ["GitHub"],
    endpoint: process.env.GITHUB_AGENT_URL ?? "http://localhost:4102/task",
    auth: { type: "mock_internal_token", audience: "github-agent" },
    skills: [
      {
        id: "github.diagnose_repo_access_issue",
        name: "Diagnose repo access issue",
        description: "Diagnose repository or organization access problems.",
        capabilities: ["github.repository_access.diagnose"],
        requestedAction: "github.repository_access.diagnose",
        requiredPermission: "github.diagnose",
        requiredScopes: ["github.diagnose"],
        riskLevel: "medium",
        owner: "GitHub Support Team"
      },
      {
        id: "github.diagnose_repository_scan_failure",
        name: "Diagnose repository scan failure",
        description: "Diagnose repository sync or scan failures.",
        capabilities: ["github.repository_scan.diagnose"],
        requestedAction: "github.repository_scan.diagnose",
        requiredPermission: "github.diagnose",
        requiredScopes: ["github.diagnose"],
        priority: 90,
        owner: "GitHub Integration Team",
        scope: { systems: ["github"], resourceTypes: ["repository"] },
        riskLevel: "medium"
      },
      {
        id: "github.diagnose_rate_limit",
        name: "Diagnose rate limit",
        description: "Diagnose GitHub API rate limit exhaustion.",
        capabilities: ["github.rate_limit.diagnose"],
        requestedAction: "github.rate_limit.read",
        requiredPermission: "github.rate_limit.read",
        requiredScopes: ["github.rate_limit.read"],
        riskLevel: "low",
        owner: "GitHub Integration Team"
      }
    ]
  },
  {
    agentId: "pagerduty-agent",
    name: "PagerDuty Agent",
    description: "External PagerDuty support agent that owns alert/incident ingestion troubleshooting knowledge.",
    systems: ["PagerDuty"],
    endpoint: process.env.PAGERDUTY_AGENT_URL ?? "http://localhost:4103/task",
    auth: { type: "mock_internal_token", audience: "pagerduty-agent" },
    skills: [
      {
        id: "pagerduty.diagnose_alert_ingestion_failure",
        name: "Diagnose alert ingestion failure",
        description: "Diagnose alerts that do not open incidents.",
        capabilities: ["incident.alert_ingestion.diagnose"],
        requestedAction: "pagerduty.alert_ingestion.diagnose",
        requiredPermission: "pagerduty.diagnose",
        requiredScopes: ["pagerduty.diagnose"],
        priority: 90,
        owner: "Incident Operations Team",
        scope: { systems: ["pagerduty"], resourceTypes: ["alert", "incident"] },
        riskLevel: "low"
      },
      { id: "pagerduty.diagnose_event_rate_limit", name: "Diagnose event rate limit", description: "Diagnose event ingestion rate limiting." }
    ]
  },
  {
    agentId: "security-oauth-agent",
    name: "Security OAuth Agent",
    description: "Security agent that evaluates OAuth, token, scope, permission and policy-sensitive actions.",
    systems: ["Security", "OAuth", "Identity"],
    endpoint: process.env.SECURITY_OAUTH_AGENT_URL ?? "http://localhost:4104/task",
    auth: { type: "mock_internal_token", audience: "security-oauth-agent" },
    skills: [
      {
        id: "security.compare_oauth_scopes",
        name: "Compare OAuth scopes",
        description: "Compare required OAuth scopes with mock token scopes.",
        capabilities: ["oauth.scope.compare", "oauth.client_auth.diagnose", "integration.auth.diagnose"],
        requestedAction: "oauth.scope.compare",
        requiredPermission: "security.scope.compare",
        priority: 60,
        owner: "Security Platform Team",
        scope: { resourceTypes: ["oauth_client", "scope", "token"] },
        riskLevel: "medium",
        requiredScopes: ["security.scope.compare"]
      },
      {
        id: "security.inspect_oauth_token",
        name: "Inspect OAuth token",
        description: "Inspect raw OAuth token posture.",
        capabilities: ["oauth.token.inspect", "security.token.inspect"],
        requestedAction: "security.token.inspect",
        requiredPermission: "security.token.inspect",
        priority: 90,
        owner: "Security Platform Team",
        scope: { resourceTypes: ["token", "credential"] },
        riskLevel: "sensitive",
        requiredScopes: ["security.token.inspect"],
        sensitive: true
      },
      {
        id: "security.evaluate_agent_action",
        name: "Evaluate agent action",
        description: "Evaluate agent action policy requirements.",
        capabilities: ["identity.permission.change"],
        requestedAction: "access.permission.grant",
        requiredPermission: "access.permission.grant",
        requiredScopes: ["access.permission.grant"],
        priority: 50,
        owner: "Security Platform Team",
        scope: { resourceTypes: ["role", "permission"] },
        riskLevel: "high"
      }
    ]
  },
  {
    agentId: "api-health-agent",
    name: "API Health Agent",
    description: "API health agent that evaluates rate limits, latency, connectivity, 5xx, DNS, TLS, and webhook delivery.",
    systems: ["API", "GitHub", "PagerDuty", "Jira", "SAP", "Confluence", "Monday"],
    endpoint: process.env.API_HEALTH_AGENT_URL ?? "http://localhost:4105/task",
    auth: { type: "mock_internal_token", audience: "api-health-agent" },
    skills: [
      { id: "api_health.diagnose_rate_limit", name: "Diagnose rate limit", description: "Diagnose rate-limit and throttling failures.", capabilities: ["api.rate_limit.diagnose", "api.health.diagnose"], requestedAction: "api.health.read", requiredPermission: "apihealth.read", requiredScopes: ["apihealth.read"], priority: 70, owner: "API Reliability Team", scope: { resourceTypes: ["api", "rate_limit"] }, riskLevel: "low" },
      {
        id: "api_health.diagnose_connectivity_failure",
        name: "Diagnose connectivity failure",
        description: "Diagnose timeout, DNS, TLS, and connectivity failures.",
        capabilities: ["api.connectivity.diagnose", "api.health.diagnose"],
        requestedAction: "api.health.read",
        requiredPermission: "apihealth.read",
        requiredScopes: ["apihealth.read"],
        priority: 70,
        owner: "API Reliability Team",
        scope: { resourceTypes: ["api"] },
        riskLevel: "low"
      },
      {
        id: "api_health.diagnose_webhook_delivery",
        name: "Diagnose webhook delivery",
        description: "Diagnose webhook delivery and callback failures.",
        capabilities: ["api.webhook_delivery.diagnose", "api.health.diagnose"],
        requestedAction: "api.health.read",
        requiredPermission: "apihealth.read",
        requiredScopes: ["apihealth.read"],
        priority: 70,
        owner: "API Reliability Team",
        scope: { resourceTypes: ["api", "webhook"] },
        riskLevel: "low"
      }
    ]
  }
];

let agentCards: AgentCard[] = staticAgentCards;

function agentCardUrl(endpoint: string): string {
  const url = new URL(endpoint);
  url.pathname = "/agent-card";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isAgentCard(value: unknown): value is AgentCard {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

  return Boolean(
    record &&
      typeof record.agentId === "string" &&
      typeof record.name === "string" &&
      typeof record.description === "string" &&
      typeof record.endpoint === "string" &&
      Array.isArray(record.systems) &&
      Array.isArray(record.skills)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAgentCardOnce(staticCard: AgentCard): Promise<AgentCard> {
  const url = agentCardUrl(staticCard.endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}${body ? ` with body ${body}` : ""}`);
    }

    const card = JSON.parse(body) as unknown;

    if (!isAgentCard(card)) {
      throw new Error(`${url} returned an invalid Agent Card shape`);
    }

    if (card.agentId !== staticCard.agentId) {
      throw new Error(`${url} returned agentId ${card.agentId}; expected ${staticCard.agentId}`);
    }

    return card;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAgentCard(staticCard: AgentCard): Promise<AgentCard> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await fetchAgentCardOnce(staticCard);
    } catch (error) {
      lastError = error;
      await delay(300);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown discovery error");
}

export async function discoverAgentCards(): Promise<AgentCard[]> {
  const discoveredCards = await Promise.all(
    staticAgentCards.map(async (staticCard) => {
      try {
        const card = await fetchAgentCard(staticCard);
        console.info(`[agent-cards] discovered ${card.agentId} from ${agentCardUrl(staticCard.endpoint)}`);
        return card;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unknown discovery error";
        console.warn(`[agent-cards] discovery failed for ${staticCard.agentId}; using static fallback: ${detail}`);
        return staticCard;
      }
    })
  );

  agentCards = discoveredCards;
  return agentCards;
}

export function validateExecutableAgentCards(cards: AgentCard[] = getExecutableAgentCards()): string[] {
  const warnings: string[] = [];

  for (const card of cards) {
    for (const skill of card.skills) {
      const label = `${card.agentId}/${skill.id}`;

      if (skill.capabilities?.length && !skill.metadataOptional && !skill.requestedAction) {
        warnings.push(`skill ${label} is missing requestedAction metadata`);
      }

      if (skill.requestedAction && !skill.requiredPermission && !skill.requiredScopes?.length) {
        warnings.push(`skill ${label} has requestedAction but no requiredPermission or requiredScopes metadata`);
      }

      if (skill.sensitive && (skill.riskLevel !== "sensitive" || !skill.requiredPermission)) {
        warnings.push(`sensitive skill ${label} must use riskLevel sensitive and declare requiredPermission`);
      }

      if ((skill.riskLevel === "high" || skill.requestedAction?.includes("grant") || skill.requestedAction?.includes("admin")) && !skill.requiredPermission) {
        warnings.push(`high-risk skill ${label} is missing requiredPermission metadata`);
      }
    }
  }

  return warnings;
}

export function getAgentCards(): AgentCard[] {
  return agentCards;
}

export function getAgentCard(agentId: string, cards: AgentCard[] = agentCards): AgentCard | undefined {
  return cards.find((card) => card.agentId === agentId);
}

export function getExecutableAgentCards(cards: AgentCard[] = agentCards): AgentCard[] {
  return cards.filter((card) => Boolean(card.endpoint));
}

export function isExecutableAgentCard(agentId: string, cards: AgentCard[] = agentCards): agentId is AgentName {
  return Boolean(getAgentCard(agentId, cards)?.endpoint);
}

export function combineAgentCards(...cardGroups: AgentCard[][]): AgentCard[] {
  const byId = new Map<string, AgentCard>();
  for (const card of cardGroups.flat()) {
    byId.set(card.agentId, card);
  }
  return [...byId.values()];
}

export function findAgentSkillByCapability(capability: string, context: CapabilityMatchContext = {}, cards: AgentCard[] = getExecutableAgentCards()): { agent: AgentCard; skill: AgentCardSkill } | undefined {
  return findAgentSkillsByCapability(capability, context, cards)[0];
}

function scopeContains(scopeValues: string[] | undefined, value: string | undefined): boolean {
  const normalized = value?.toLowerCase().trim();

  return Boolean(normalized && scopeValues?.some((scopeValue) => normalized.includes(scopeValue.toLowerCase()) || scopeValue.toLowerCase().includes(normalized)));
}

export function findAgentSkillsByCapability(capability: string, context: CapabilityMatchContext = {}, cards: AgentCard[] = getExecutableAgentCards()): CapabilityMatch[] {
  // Target system is context. Capability is routing. Policy is authorization.
  // `systems[]` on an Agent Card remains descriptive; skill capability equality is the required route key.
  return getExecutableAgentCards(cards)
    .flatMap((agent) => agent.skills.map((skill) => ({ agent, skill })))
    .filter(({ skill }) => skill.capabilities?.includes(capability))
    .map(({ agent, skill }) => {
      const reasons = [`exact capability ${capability}`];
      let score = 100 + (skill.priority ?? 0);

      if (scopeContains(skill.scope?.systems, context.targetSystemText)) {
        score += 20;
        reasons.push(`target system matched skill scope (${context.targetSystemText})`);
      }

      if (scopeContains(skill.scope?.resourceTypes, context.targetResourceType)) {
        score += 10;
        reasons.push(`resource type matched skill scope (${context.targetResourceType})`);
      }

      if (scopeContains(skill.scope?.environments, context.environment)) {
        score += 5;
        reasons.push(`environment matched skill scope (${context.environment})`);
      }

      return {
        agent,
        skill,
        score,
        reason: reasons.join("; ")
      };
    })
    .sort((left, right) => right.score - left.score || left.agent.agentId.localeCompare(right.agent.agentId));
}
