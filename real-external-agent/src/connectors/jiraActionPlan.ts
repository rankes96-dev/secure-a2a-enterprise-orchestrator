import { randomUUID } from "node:crypto";
import type { ConnectorActionPlan } from "../planTypes.js";

function hasUserReference(message: string): boolean {
  return /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(message) || /\bme\b|\bmy\b|\buser\b/i.test(message);
}

export function buildJiraActionPlan(message: string): ConnectorActionPlan {
  return {
    planId: `plan-${randomUUID()}`,
    connectorId: "jira-reference",
    resourceSystem: "jira",
    interpretedIntent: "jira.project_access_request",
    userRequest: message,
    mode: "plan_only",
    safeToDisplay: true,
    sideEffectsAllowed: "none",
    missingInputs: hasUserReference(message) ? [] : ["userEmail"],
    options: [
      {
        actionId: "jira.project.access.inspect",
        label: "Inspect Jira project access",
        description: "Read project roles and permission context to explain why access is missing.",
        executionType: "inspection_read_only",
        riskLevel: "low",
        sideEffects: "none",
        requiredApplicationGrants: ["read:jira-work", "read:jira-user"],
        requiredEffectivePermissions: ["browse_projects", "read_project_roles"],
        targetObjectTypes: ["jira.project", "jira.user"]
      },
      {
        actionId: "jira.project.access.grant",
        label: "Grant Jira project access",
        description: "Add a user to a Jira project role or otherwise grant project access.",
        executionType: "admin_action",
        riskLevel: "high",
        sideEffects: "admin_change",
        requiredApplicationGrants: ["manage:jira-project", "write:jira-work"],
        requiredEffectivePermissions: ["administer_projects", "manage_project_roles"],
        requiresApproval: true,
        targetObjectTypes: ["jira.project", "jira.user"]
      }
    ],
    recommendedOptionId: "jira.project.access.inspect",
    recommendedNextStep: "Ask whether the user wants to inspect access or request/grant access."
  };
}

export function isJiraAccessPlanningRequest(message: string): boolean {
  return /\b(need access|can't access|cannot access|permission to project|add me to project|grant access|project access)\b/i.test(message);
}
