const connectorPresets = {
  jira: {
    EXTERNAL_CONNECTOR_ID: "jira-reference",
    EXTERNAL_AGENT_ID: "external-jira-agent",
    EXTERNAL_AGENT_PORT: "4201",
    EXTERNAL_AGENT_CLIENT_ID: "jira-agent-client"
  },
  servicenow: {
    EXTERNAL_CONNECTOR_ID: "servicenow-reference",
    EXTERNAL_AGENT_ID: "external-servicenow-agent",
    EXTERNAL_AGENT_PORT: "4202",
    EXTERNAL_AGENT_CLIENT_ID: "servicenow-agent-client"
  },
  github: {
    EXTERNAL_CONNECTOR_ID: "github-reference",
    EXTERNAL_AGENT_ID: "external-github-agent",
    EXTERNAL_AGENT_PORT: "4203",
    EXTERNAL_AGENT_CLIENT_ID: "github-agent-client"
  }
} as const;

type ConnectorPresetName = keyof typeof connectorPresets;

function isConnectorPresetName(value: string | undefined): value is ConnectorPresetName {
  return value === "jira" || value === "servicenow" || value === "github";
}

const presetName = process.argv[2];
if (!isConnectorPresetName(presetName)) {
  console.error("Usage: tsx src/startConnector.ts <jira|servicenow|github>");
  process.exit(1);
}

for (const [key, value] of Object.entries(connectorPresets[presetName])) {
  process.env[key] = value;
}

await import("./index.js");
