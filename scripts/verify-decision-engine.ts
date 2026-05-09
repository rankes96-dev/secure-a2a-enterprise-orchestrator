import { decideConnectorActions } from "../services/orchestrator-api/src/connectors/decisionEngine";
import type { ConnectorProfile } from "../services/orchestrator-api/src/connectors/types";

const profile: ConnectorProfile = {
  connectorId: "demo-reference",
  resourceSystem: "demo",
  displayName: "Demo Reference Connector",
  version: "1.0.0",
  profileSource: "external_agent",
  applicationAccessGrantCatalog: [
    { id: "grant.read", label: "Read", description: "Read access." }
  ],
  effectivePermissionCatalog: [
    { id: "permission.read", label: "Read permission", description: "Read permission." }
  ],
  skillCatalog: [
    {
      id: "demo.read",
      label: "Read demo data",
      description: "Read demo data.",
      requiredApplicationGrants: ["grant.read"],
      requiredEffectivePermissions: ["permission.read"]
    }
  ],
  actionCatalog: []
};

function decide(input: {
  requestedApplicationGrants?: string[];
  applicationAccessGrants?: string[];
  effectivePermissions?: string[];
  deniedPermissions?: string[];
}) {
  return decideConnectorActions({
    connectorProfile: profile,
    agentId: "agent",
    clientId: "client",
    declaredSkills: ["demo.read"],
    requestedApplicationGrants: input.requestedApplicationGrants ?? ["grant.read"],
    applicationAccessGrants: input.applicationAccessGrants ?? ["grant.read"],
    effectivePermissions: input.effectivePermissions ?? ["permission.read"],
    deniedPermissions: input.deniedPermissions ?? []
  })[0];
}

function assertStatus(name: string, decision: ReturnType<typeof decide>, status: "approved" | "blocked", reasonIncludes?: string): void {
  if (decision.status !== status) {
    throw new Error(`${name}: expected ${status}, got ${decision.status}`);
  }
  if (reasonIncludes && !decision.reason.includes(reasonIncludes)) {
    throw new Error(`${name}: expected reason to include ${reasonIncludes}, got ${decision.reason}`);
  }
}

assertStatus("all requirements", decide({}), "approved");
assertStatus("missing grant", decide({ applicationAccessGrants: [] }), "blocked", "missing application access grant grant.read");
assertStatus("missing permission", decide({ effectivePermissions: [] }), "blocked", "missing effective permission permission.read");
assertStatus("denied permission", decide({ effectivePermissions: ["permission.read"], deniedPermissions: ["permission.read"] }), "blocked", "denied permission permission.read");

console.log("Decision engine verification passed.");
