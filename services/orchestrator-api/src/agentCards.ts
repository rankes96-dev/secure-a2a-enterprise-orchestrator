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
  sensitive?: boolean;
};

export type AgentCard = {
  agentId:
    | "jira-agent"
    | "github-agent"
    | "pagerduty-agent"
    | "security-oauth-agent"
    | "api-health-agent"
    | "end-user-triage-agent";
  name: string;
  description: string;
  systems: string[];
  endpoint: string;
  auth: {
    type: "mock_internal_token";
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
      { id: "end_user.triage", name: "End user triage", description: "Interpret a plain-language support issue.", capabilities: ["enterprise.issue.triage"] },
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
        examples: ["I don't have permission to create a Jira ticket", "Jira says I cannot create a ticket in FIN"]
      },
      {
        id: "jira.diagnose_issue_creation_failure",
        name: "Diagnose Jira issue creation failure",
        description: "Diagnose Jira issue creation API or sync failures.",
        capabilities: ["jira.issue_creation.diagnose"],
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
      { id: "github.diagnose_repo_access_issue", name: "Diagnose repo access issue", description: "Diagnose repository or organization access problems.", capabilities: ["github.repository_access.diagnose"] },
      {
        id: "github.diagnose_repository_scan_failure",
        name: "Diagnose repository scan failure",
        description: "Diagnose repository sync or scan failures.",
        capabilities: ["github.repository_scan.diagnose"]
      },
      { id: "github.diagnose_rate_limit", name: "Diagnose rate limit", description: "Diagnose GitHub API rate limit exhaustion.", capabilities: ["github.rate_limit.diagnose"] }
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
        requiredPermission: "incident.draft.create"
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
        capabilities: ["oauth.scope.compare"],
        requestedAction: "oauth.scope.compare",
        requiredPermission: "security.scope.compare",
        requiredScopes: ["security.scope.compare"]
      },
      {
        id: "security.inspect_oauth_token",
        name: "Inspect OAuth token",
        description: "Inspect raw OAuth token posture.",
        capabilities: ["oauth.token.inspect"],
        requestedAction: "security.token.inspect",
        requiredPermission: "security.token.inspect",
        riskLevel: "sensitive",
        requiredScopes: ["security.token.inspect"],
        sensitive: true
      },
      { id: "security.evaluate_agent_action", name: "Evaluate agent action", description: "Evaluate agent action policy requirements." }
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
      { id: "api_health.diagnose_rate_limit", name: "Diagnose rate limit", description: "Diagnose rate-limit and throttling failures.", capabilities: ["api.rate_limit.diagnose", "api.health.diagnose"], requestedAction: "github.rate_limit.read", requiredPermission: "github.rate_limit.read" },
      {
        id: "api_health.diagnose_connectivity_failure",
        name: "Diagnose connectivity failure",
        description: "Diagnose timeout, DNS, TLS, and connectivity failures.",
        capabilities: ["api.connectivity.diagnose", "api.health.diagnose"],
        requestedAction: "api.health.read",
        requiredPermission: "apihealth.read"
      },
      {
        id: "api_health.diagnose_webhook_delivery",
        name: "Diagnose webhook delivery",
        description: "Diagnose webhook delivery and callback failures."
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

export function getAgentCards(): AgentCard[] {
  return agentCards;
}

export function getAgentCard(agentId: string): AgentCard | undefined {
  return agentCards.find((card) => card.agentId === agentId);
}

export function getExecutableAgentCards(): AgentCard[] {
  return agentCards.filter((card) => Boolean(card.endpoint));
}

export function isExecutableAgentCard(agentId: string): agentId is AgentName {
  return Boolean(getAgentCard(agentId)?.endpoint);
}

export function findAgentSkillByCapability(capability: string): { agent: AgentCard; skill: AgentCardSkill } | undefined {
  return getExecutableAgentCards().flatMap((agent) => agent.skills.map((skill) => ({ agent, skill }))).find(({ skill }) =>
    skill.capabilities?.includes(capability) || skill.aliases?.includes(capability) || skill.id === capability
  );
}
