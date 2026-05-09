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

const approved = evaluateConnectorPolicy({ connectorRouteStatus: "connector_skill_approved" });
if (approved.effect !== "allow") {
  throw new Error(`expected approved connector skill to be allowed, got ${approved.effect}`);
}
if (approved.reason.includes("diagnostic skill")) {
  throw new Error("generic policy allow wording should not say diagnostic skill");
}
if (!approved.matchedRuleIds.includes("allow-readonly-diagnostics")) {
  throw new Error("expected approved connector skill to match allow-readonly-diagnostics");
}

const blocked = evaluateConnectorPolicy({ connectorRouteStatus: "connector_skill_blocked" });
if (blocked.effect !== "block") {
  throw new Error(`expected blocked connector skill to be blocked, got ${blocked.effect}`);
}
if (!blocked.matchedRuleIds.includes("block-unknown-or-unapproved-skills")) {
  throw new Error("expected blocked connector skill to match block-unknown-or-unapproved-skills");
}

const serialized = JSON.stringify({ approved, blocked });
for (const marker of forbiddenMarkers) {
  if (serialized.includes(marker)) {
    throw new Error(`policy evaluation exposed forbidden marker: ${marker}`);
  }
}

console.log("Policy model verification passed.");
