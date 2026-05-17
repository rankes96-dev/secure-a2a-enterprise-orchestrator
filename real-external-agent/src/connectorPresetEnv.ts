export const connectorPresets = {
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

export type ConnectorPresetName = keyof typeof connectorPresets;

const connectorIdentityEnvKeys = [
  "EXTERNAL_CONNECTOR_ID",
  "EXTERNAL_AGENT_ID",
  "EXTERNAL_AGENT_CLIENT_ID"
] as const;

export function isConnectorPresetName(value: string | undefined): value is ConnectorPresetName {
  return value === "jira" || value === "servicenow" || value === "github";
}

export function connectorPresetEnvConflicts(presetName: ConnectorPresetName, env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== "production") {
    return [];
  }

  const preset = connectorPresets[presetName];
  return connectorIdentityEnvKeys.flatMap((key) => {
    const actual = env[key];
    const expected = preset[key];
    return actual !== undefined && actual !== expected
      ? [`${key}=${actual} does not match ${presetName} preset value ${expected}`]
      : [];
  });
}

export function applyConnectorPreset(presetName: ConnectorPresetName, env: NodeJS.ProcessEnv = process.env): void {
  const conflicts = connectorPresetEnvConflicts(presetName, env);
  if (conflicts.length) {
    throw new Error(`Connector preset/environment mismatch:\n${conflicts.map((conflict) => `- ${conflict}`).join("\n")}`);
  }

  for (const [key, value] of Object.entries(connectorPresets[presetName])) {
    if (key === "EXTERNAL_AGENT_PORT" && env.PORT !== undefined) {
      continue;
    }

    if (env[key] === undefined) {
      env[key] = value;
    }
  }
}
