import { jiraReferenceConnector } from "./jiraReferenceConnector.js";
import type { ConnectorProfile, SupportedConnector } from "./types.js";

const supportedConnectors: SupportedConnector[] = [
  {
    connectorId: "jira-reference",
    resourceSystem: "jira",
    displayName: "Jira Cloud Reference Connector",
    status: "available",
    description: "Reference connector profile for Jira Cloud."
  },
  {
    connectorId: "servicenow-reference",
    resourceSystem: "servicenow",
    displayName: "ServiceNow Reference Connector",
    status: "coming_soon",
    description: "Placeholder for a future ServiceNow connector profile."
  },
  {
    connectorId: "salesforce-reference",
    resourceSystem: "salesforce",
    displayName: "Salesforce Reference Connector",
    status: "coming_soon",
    description: "Placeholder for a future Salesforce connector profile."
  },
  {
    connectorId: "github-reference",
    resourceSystem: "github",
    displayName: "GitHub Reference Connector",
    status: "coming_soon",
    description: "Placeholder for a future GitHub connector profile."
  }
];

const availableProfiles = new Map<string, ConnectorProfile>([
  [jiraReferenceConnector.connectorId, jiraReferenceConnector]
]);

export function listSupportedConnectors(): SupportedConnector[] {
  return supportedConnectors.map((connector) => ({ ...connector }));
}

export function getConnectorProfile(connectorId: string): ConnectorProfile | undefined {
  return availableProfiles.get(connectorId);
}

export function getDefaultConnectorProfile(): ConnectorProfile {
  return jiraReferenceConnector;
}

export function getConnectorProfileForResourceSystem(resourceSystem: string): ConnectorProfile | undefined {
  return [...availableProfiles.values()].find((profile) => profile.resourceSystem === resourceSystem);
}
