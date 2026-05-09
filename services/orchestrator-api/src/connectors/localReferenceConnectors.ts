export const localReferenceConnectorBaseUrls = [
  "http://localhost:4201",
  "http://localhost:4202",
  "http://localhost:4203"
] as const;

export type ConnectorTemplateSource = "local_reference" | "custom_sdk";

export type ConnectorTemplateStatus = "available" | "planned" | "coming_soon";

export type ConnectorTemplate = {
  resourceSystem: string;
  connectorId: string;
  displayName: string;
  status: ConnectorTemplateStatus;
  source: ConnectorTemplateSource;
};

export function listSupportedConnectorGuardrails() {
  return listSupportedConnectorTemplates().filter((connector) => connector.status === "available");
}

export function listSupportedConnectorTemplates(): ConnectorTemplate[] {
  return [
    {
      resourceSystem: "jira",
      connectorId: "jira-reference",
      displayName: "Jira Cloud Reference Connector",
      status: "available",
      source: "local_reference"
    },
    {
      resourceSystem: "servicenow",
      connectorId: "servicenow-reference",
      displayName: "ServiceNow Reference Connector",
      status: "available",
      source: "local_reference"
    },
    {
      resourceSystem: "github",
      connectorId: "github-reference",
      displayName: "GitHub Reference Connector",
      status: "available",
      source: "local_reference"
    },
    {
      resourceSystem: "custom",
      connectorId: "custom-sdk",
      displayName: "Custom Connector SDK",
      status: "planned",
      source: "custom_sdk"
    }
  ];
}

export function isAllowedLocalReferenceConnectorBaseUrl(url: string): boolean {
  return (localReferenceConnectorBaseUrls as readonly string[]).includes(url);
}
