import type { AgentName, IssueType } from "@a2a/shared";

export type AgentDefinition = {
  id:
    | "end-user-triage-agent"
    | "jira-agent"
    | "github-agent"
    | "pagerduty-agent"
    | "sap-agent"
    | "security-oauth-agent"
    | "api-health-agent";
  name: string;
  description: string;
  url: string;
  capabilities: string[];
  handlesSystems: string[];
  handlesIssueTypes: IssueType[];
  enabled: boolean;
};

export const agentRegistry: AgentDefinition[] = [
  {
    id: "end-user-triage-agent",
    name: "End User Triage Agent",
    description: "Interprets non-technical user complaints, identifies symptoms, and translates them into likely technical categories.",
    url: process.env.END_USER_TRIAGE_AGENT_URL ?? "http://localhost:4106/task",
    capabilities: ["support.triage", "symptom.interpretation", "clarifying_questions", "technical_category_mapping"],
    handlesSystems: ["Jira", "GitHub", "PagerDuty", "SAP", "Confluence", "Monday"],
    handlesIssueTypes: ["AUTHENTICATION_FAILURE", "AUTHORIZATION_FAILURE", "UNKNOWN"],
    enabled: true
  },
  {
    id: "jira-agent",
    name: "Jira Agent",
    description: "Checks Jira operations, permissions, and issue sync requirements.",
    url: process.env.JIRA_AGENT_URL ?? "http://localhost:4101/task",
    capabilities: ["jira.operation_requirements", "jira.issue_create", "jira.sync"],
    handlesSystems: ["Jira"],
    handlesIssueTypes: ["AUTHORIZATION_FAILURE", "AUTHENTICATION_FAILURE", "UNKNOWN"],
    enabled: true
  },
  {
    id: "github-agent",
    name: "GitHub Agent",
    description: "Checks GitHub repository scan responses, API headers, token metadata, and sync signals.",
    url: process.env.GITHUB_AGENT_URL ?? "http://localhost:4102/task",
    capabilities: ["github.repository_scan", "github.rate_limit_headers", "github.token_metadata"],
    handlesSystems: ["GitHub"],
    handlesIssueTypes: ["RATE_LIMIT", "AUTHORIZATION_FAILURE", "API_AVAILABILITY", "UNKNOWN"],
    enabled: true
  },
  {
    id: "pagerduty-agent",
    name: "PagerDuty Agent",
    description: "Checks PagerDuty incident and alert delivery signals.",
    url: process.env.PAGERDUTY_AGENT_URL ?? "http://localhost:4103/task",
    capabilities: ["pagerduty.alert_delivery", "pagerduty.incident_creation"],
    handlesSystems: ["PagerDuty"],
    handlesIssueTypes: ["WEBHOOK_FAILURE", "RATE_LIMIT", "API_AVAILABILITY", "UNKNOWN"],
    enabled: true
  },
  {
    id: "security-oauth-agent",
    name: "Security OAuth Agent",
    description: "Checks OAuth scopes, token posture, SAML authorization, invalid clients, and permissions.",
    url: process.env.SECURITY_OAUTH_AGENT_URL ?? "http://localhost:4104/task",
    capabilities: ["oauth.scope_compare", "oauth.token_posture", "saml.authorization", "client_credentials"],
    handlesSystems: ["Jira", "GitHub", "SAP", "Confluence", "Monday"],
    handlesIssueTypes: ["AUTHENTICATION_FAILURE", "AUTHORIZATION_FAILURE", "RATE_LIMIT"],
    enabled: true
  },
  {
    id: "api-health-agent",
    name: "API Health Agent",
    description: "Checks rate limits, API availability, timeouts, latency, TLS, DNS, and webhook delivery health.",
    url: process.env.API_HEALTH_AGENT_URL ?? "http://localhost:4105/task",
    capabilities: ["api.rate_limit", "api.availability", "network.connectivity", "webhook.delivery"],
    handlesSystems: ["Jira", "GitHub", "PagerDuty", "SAP", "Confluence", "Monday"],
    handlesIssueTypes: ["RATE_LIMIT", "CONNECTIVITY_FAILURE", "WEBHOOK_FAILURE", "API_AVAILABILITY"],
    enabled: true
  },
  {
    id: "sap-agent",
    name: "SAP Agent",
    description: "Placeholder for future SAP specialist checks.",
    url: "",
    capabilities: ["sap.oauth_client_auth"],
    handlesSystems: ["SAP"],
    handlesIssueTypes: ["AUTHENTICATION_FAILURE"],
    enabled: false
  }
];

export const executableAgents = agentRegistry.filter((agent) => agent.enabled && agent.url);

export function getAgentDefinition(agentId: string): AgentDefinition | undefined {
  return agentRegistry.find((agent) => agent.id === agentId);
}

export function isExecutableAgent(agentId: string): agentId is AgentName {
  const definition = getAgentDefinition(agentId);
  return Boolean(definition?.enabled && definition.url);
}
