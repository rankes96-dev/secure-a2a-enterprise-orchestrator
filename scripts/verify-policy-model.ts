import { evaluateConnectorPolicy } from "../services/orchestrator-api/src/policy/connectorPolicy";

const forbiddenMarkers = [
  "access_token",
  "refresh_token",
  "Authorization",
  "Bearer",
  "client_secret",
  "private_key",
  "client_assertion"
];

const approved = evaluateConnectorPolicy({
  connectorRouteStatus: "connector_skill_approved",
  runtimeMode: "external_runtime_available",
  connectorId: "servicenow-reference",
  resourceSystem: "servicenow",
  skillId: "servicenow.ticket.status.lookup",
  executionType: "diagnostic_read_only",
  riskLevel: "low",
  action: {
    provider: "servicenow",
    resourceSystem: "servicenow",
    actionCategory: "business_object.read",
    approvalMode: "never",
    resourceSensitivity: "standard",
    fieldClasses: ["workflow_state"],
    actionConstraints: {
      bulkAllowed: false,
      maxRecordsPerRequest: 1,
      requiresConnectedAccount: true,
      auditRequired: true
    }
  }
});
if (approved.effect !== "allow") {
  throw new Error(`expected approved connector skill to be allowed, got ${approved.effect}`);
}
if (approved.reason.includes("diagnostic skill")) {
  throw new Error("generic policy allow wording should not say diagnostic skill");
}
if (!approved.matchedRuleIds.includes("allow-readonly-approved-runtime")) {
  throw new Error("expected approved connector skill to match allow-readonly-approved-runtime");
}
if (!approved.matchedTenantRuleIds.includes("allow-readonly-approved-runtime")) {
  throw new Error("expected approved connector skill to record tenant allow rule");
}

const missingTaxonomy = evaluateConnectorPolicy({
  connectorRouteStatus: "connector_skill_approved",
  runtimeMode: "external_runtime_available",
  connectorId: "servicenow-reference",
  resourceSystem: "servicenow",
  skillId: "servicenow.ticket.status.lookup",
  executionType: "diagnostic_read_only",
  riskLevel: "low"
});
if (missingTaxonomy.effect !== "block") {
  throw new Error(`expected missing taxonomy metadata to be blocked, got ${missingTaxonomy.effect}`);
}
if (missingTaxonomy.primaryRuleId !== "block-missing-action-taxonomy-metadata") {
  throw new Error(`expected missing taxonomy metadata to match block-missing-action-taxonomy-metadata, got ${missingTaxonomy.primaryRuleId}`);
}
if (!missingTaxonomy.matchedGuardrailRuleIds.includes("block-missing-action-taxonomy-metadata")) {
  throw new Error("expected missing taxonomy metadata to record block-missing-action-taxonomy-metadata guardrail");
}

const blocked = evaluateConnectorPolicy({ connectorRouteStatus: "connector_skill_blocked" });
if (blocked.effect !== "block") {
  throw new Error(`expected blocked connector skill to be blocked, got ${blocked.effect}`);
}
if (!blocked.matchedRuleIds.includes("block-unapproved-route")) {
  throw new Error("expected blocked connector skill to match block-unapproved-route");
}

const serialized = JSON.stringify({ approved, missingTaxonomy, blocked });
for (const marker of forbiddenMarkers) {
  if (serialized.includes(marker)) {
    throw new Error(`policy evaluation exposed forbidden marker: ${marker}`);
  }
}

console.log("Policy model verification passed.");
