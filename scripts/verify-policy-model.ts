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
  executionType: "diagnostic_read_only",
  riskLevel: "low"
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

const blocked = evaluateConnectorPolicy({ connectorRouteStatus: "connector_skill_blocked" });
if (blocked.effect !== "block") {
  throw new Error(`expected blocked connector skill to be blocked, got ${blocked.effect}`);
}
if (!blocked.matchedRuleIds.includes("block-unapproved-route")) {
  throw new Error("expected blocked connector skill to match block-unapproved-route");
}

const serialized = JSON.stringify({ approved, blocked });
for (const marker of forbiddenMarkers) {
  if (serialized.includes(marker)) {
    throw new Error(`policy evaluation exposed forbidden marker: ${marker}`);
  }
}

console.log("Policy model verification passed.");
