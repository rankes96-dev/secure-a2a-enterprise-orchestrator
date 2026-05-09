export const localReferenceConnectorBaseUrls = [
  "http://localhost:4201",
  "http://localhost:4202",
  "http://localhost:4203"
] as const;

export function listSupportedConnectorGuardrails() {
  return [
    {
      resourceSystem: "jira",
      connectorId: "jira-reference",
      displayName: "Jira Cloud Reference Connector",
      status: "available" as const
    },
    {
      resourceSystem: "servicenow",
      connectorId: "servicenow-reference",
      displayName: "ServiceNow Reference Connector",
      status: "available" as const
    },
    {
      resourceSystem: "github",
      connectorId: "github-reference",
      displayName: "GitHub Reference Connector",
      status: "available" as const
    }
  ];
}

export function isAllowedLocalReferenceConnectorBaseUrl(url: string): boolean {
  return (localReferenceConnectorBaseUrls as readonly string[]).includes(url);
}
