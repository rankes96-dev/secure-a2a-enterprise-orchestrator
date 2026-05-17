import { jiraReferenceConnector } from "./jiraReferenceConnector.js";
import { serviceNowReferenceConnector } from "./servicenowReferenceConnector.js";
import { githubReferenceConnector } from "./githubReferenceConnector.js";
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
    status: "available",
    description: "Reference connector profile for ServiceNow."
  },
  {
    connectorId: "github-reference",
    resourceSystem: "github",
    displayName: "GitHub Reference Connector",
    status: "available",
    description: "Reference connector profile for GitHub."
  }
];

const availableProfiles = new Map<string, ConnectorProfile>([
  [jiraReferenceConnector.connectorId, jiraReferenceConnector],
  [serviceNowReferenceConnector.connectorId, serviceNowReferenceConnector],
  [githubReferenceConnector.connectorId, githubReferenceConnector]
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
