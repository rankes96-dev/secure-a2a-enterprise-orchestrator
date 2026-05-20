import type { LocalConnectorPreset } from "./components/agent-registry/types";

type ConnectorPresetEnv = Record<string, string | boolean | undefined>;

function cleanEnvUrl(value: string | boolean | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

function isLocalhostUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  } catch {
    return false;
  }
}

function referenceAgentLabel(displayName: string, agentBaseUrl: string): string {
  return isLocalhostUrl(agentBaseUrl)
    ? `Use local ${displayName} reference agent`
    : `Use ${displayName} reference agent`;
}

export function buildLocalConnectorPresets(env: ConnectorPresetEnv = {}): LocalConnectorPreset[] {
  const jiraAgentBaseUrl = cleanEnvUrl(env.VITE_JIRA_AGENT_URL) ?? "http://localhost:4201";
  const serviceNowAgentBaseUrl = cleanEnvUrl(env.VITE_SERVICENOW_AGENT_URL) ?? "http://localhost:4202";
  const githubAgentBaseUrl = cleanEnvUrl(env.VITE_GITHUB_AGENT_URL) ?? "http://localhost:4203";

  return [
    {
      label: referenceAgentLabel("Jira", jiraAgentBaseUrl),
      agentBaseUrl: jiraAgentBaseUrl,
      expectedAgentId: "external-jira-agent",
      expectedResourceSystem: "jira",
      expectedConnectorId: "jira-reference"
    },
    {
      label: referenceAgentLabel("ServiceNow", serviceNowAgentBaseUrl),
      agentBaseUrl: serviceNowAgentBaseUrl,
      expectedAgentId: "external-servicenow-agent",
      expectedResourceSystem: "servicenow",
      expectedConnectorId: "servicenow-reference"
    },
    {
      label: referenceAgentLabel("GitHub", githubAgentBaseUrl),
      agentBaseUrl: githubAgentBaseUrl,
      expectedAgentId: "external-github-agent",
      expectedResourceSystem: "github",
      expectedConnectorId: "github-reference"
    }
  ];
}
