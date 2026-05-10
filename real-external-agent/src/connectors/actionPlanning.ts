import type { ConnectorActionPlan } from "../planTypes.js";
import { buildJiraActionPlan, isJiraAccessPlanningRequest } from "./jiraActionPlan.js";

export type ConnectorPlanningHandler = {
  connectorId: string;
  resourceSystem: string;
  canPlan(message: string): boolean;
  buildPlan(message: string): ConnectorActionPlan;
};

export const jiraPlanningHandler: ConnectorPlanningHandler = {
  connectorId: "jira-reference",
  resourceSystem: "jira",
  canPlan: isJiraAccessPlanningRequest,
  buildPlan: buildJiraActionPlan
};

export const serviceNowPlanningHandler: ConnectorPlanningHandler = {
  connectorId: "servicenow-reference",
  resourceSystem: "servicenow",
  canPlan: () => false,
  buildPlan: () => {
    throw new Error("ServiceNow planning handler not implemented in V1 reference connector.");
  }
};

export const githubPlanningHandler: ConnectorPlanningHandler = {
  connectorId: "github-reference",
  resourceSystem: "github",
  canPlan: () => false,
  buildPlan: () => {
    throw new Error("GitHub planning handler not implemented in V1 reference connector.");
  }
};

const planningHandlers = [
  jiraPlanningHandler,
  serviceNowPlanningHandler,
  githubPlanningHandler
];

export function buildConnectorActionPlan(params: {
  connectorId: string;
  resourceSystem: string;
  message: string;
}): ConnectorActionPlan | undefined {
  const handler = planningHandlers.find((item) =>
    item.connectorId === params.connectorId &&
    item.resourceSystem === params.resourceSystem &&
    item.canPlan(params.message)
  );
  return handler?.buildPlan(params.message);
}
