import { existsSync, readFileSync } from "node:fs";
import type { RequestInterpretation } from "@a2a/shared";
import type { TrustedOnboardedAgent } from "../services/orchestrator-api/src/agentOnboarding.js";
import { routeConnectorRequest, type ConnectorRoutingDecision } from "../services/orchestrator-api/src/connectorRouting.js";
import { reconcileConnectorSupportedInterpretation } from "../services/orchestrator-api/src/connectorSupportedInterpretationReconciliation.js";
import { createInterpretationProof } from "../services/orchestrator-api/src/interpretation/interpretationProof.js";
import type { OgenInterpretationProof } from "../services/orchestrator-api/src/interpretation/interpretationTypes.js";
import { evaluateConnectorPolicy } from "../services/orchestrator-api/src/policy/connectorPolicy.js";
import type { ConnectorPolicyEvaluation } from "../services/orchestrator-api/src/policy/connectorPolicy.js";

let failed = false;

function fail(message: string): void {
  failed = true;
  console.error(`FAIL: ${message}`);
}

function ok(message: string): void {
  console.log(`ok - ${message}`);
}

function read(path: string): string {
  if (!existsSync(path)) {
    fail(`${path} should exist`);
    return "";
  }
  return readFileSync(path, "utf8");
}

function requireIncludes(source: string, phrase: string, context: string): void {
  if (!source.includes(phrase)) {
    fail(`${context} missing required phrase: ${phrase}`);
    return;
  }
  ok(context);
}

function trustedConnectorAgent(input: {
  resourceSystem: string;
  connectorId: string;
  agentId: string;
  runtimeEndpoint: string;
  approvedCapabilities: string[];
}): TrustedOnboardedAgent {
  return {
    agentId: input.agentId,
    issuer: `https://${input.resourceSystem}.example.test`,
    clientId: `${input.resourceSystem}-client`,
    audience: input.agentId,
    runtimeEndpoint: input.runtimeEndpoint,
    connectorId: input.connectorId,
    resourceSystem: input.resourceSystem,
    requestedScopes: [],
    requestedApplicationGrants: [],
    agentDeclaredSkills: input.approvedCapabilities,
    agentDeclaredCapabilities: input.approvedCapabilities,
    applicationAccessGrants: [],
    grantedScopes: [],
    effectivePermissions: [],
    deniedPermissions: [],
    approvedActions: input.approvedCapabilities.map((capability) => ({
      capability,
      label: capability,
      reason: "Approved by test connector profile."
    })),
    blockedActions: [],
    approvedCapabilities: input.approvedCapabilities.map((capability) => ({
      capability,
      label: capability,
      reason: "Approved by test connector profile."
    })),
    blockedCapabilities: [],
    connectorProfile: {
      connectorId: input.connectorId,
      resourceSystem: input.resourceSystem,
      displayName: `${input.resourceSystem} connector`,
      version: "test",
      profileSource: "built_in_reference",
      validationTests: []
    },
    connectorProfileVerified: true,
    connectorDecisionSource: input.connectorId,
    trustLevel: "trusted_metadata_only",
    executable: false,
    executionState: "metadata_only",
    runtimeTrustSource: "live_onboarding",
    rehydratedFromStore: false,
    tokenEndpointAuthMethod: "private-key-jwt",
    oauthApplicationBound: true
  };
}

const installedConnectors: TrustedOnboardedAgent[] = [
  trustedConnectorAgent({
    resourceSystem: "jira",
    connectorId: "jira-reference",
    agentId: "external-jira-agent",
    runtimeEndpoint: "http://localhost:4201/a2a/task",
    approvedCapabilities: ["jira.issue.status.lookup"]
  }),
  trustedConnectorAgent({
    resourceSystem: "servicenow",
    connectorId: "servicenow-reference",
    agentId: "external-servicenow-agent",
    runtimeEndpoint: "http://localhost:4202/a2a/task",
    approvedCapabilities: ["servicenow.ticket.status.lookup"]
  }),
  trustedConnectorAgent({
    resourceSystem: "github",
    connectorId: "github-reference",
    agentId: "external-github-agent",
    runtimeEndpoint: "http://localhost:4203/a2a/task",
    approvedCapabilities: ["github.pull_request.status.lookup"]
  })
];

function staleUnsupportedInterpretation(source: "ai" | "fallback" = "ai"): RequestInterpretation {
  return {
    scope: "out_of_scope",
    intentType: "unknown",
    requestedCapability: "unknown",
    confidence: "high",
    reason: "The original interpretation classified the request outside supported enterprise scope.",
    interpretationSource: source,
    aiProvider: source === "ai" ? "openrouter" : undefined,
    aiModel: source === "ai" ? "test-model" : undefined
  };
}

function policyForRoute(
  route: ConnectorRoutingDecision,
  interpretation: RequestInterpretation,
  proof: OgenInterpretationProof
): ConnectorPolicyEvaluation {
  return evaluateConnectorPolicy({
    tenantId: "default",
    conversationId: "reconciliation-smoke",
    connectorRouteStatus: route.status,
    runtimeMode: route.runtimeMode,
    connectorId: route.connectorId,
    resourceSystem: route.resourceSystem,
    skillId: route.skillId,
    skillLabel: route.skillLabel,
    interpretation: {
      interpretationId: proof.interpretationId,
      schemaVersion: proof.schemaVersion,
      interpretationSource: interpretation.interpretationSource,
      scope: interpretation.scope,
      intentType: interpretation.intentType,
      requestedCapability: interpretation.requestedCapability,
      confidence: interpretation.confidence,
      risks: proof.risks,
      advisoryOnly: proof.advisoryOnly,
      originalInterpretationScope: proof.originalInterpretationScope,
      reconciledScope: proof.reconciledScope,
      reconciliationSource: proof.reconciliationSource
    },
    subject: {
      tenantId: "default",
      provider: "demo",
      subject: "user-1",
      email: "user@example.test",
      roles: ["it-support"]
    },
    resource: {
      connectorId: route.connectorId,
      resourceSystem: route.resourceSystem,
      environment: "unknown"
    },
    action: {
      skillId: route.skillId,
      skillLabel: route.skillLabel,
      actionCategory: route.actionCategory,
      approvalMode: route.approvalMode,
      resourceSensitivity: route.resourceSensitivity,
      fieldClasses: route.fieldClasses,
      actionConstraints: route.actionConstraints,
      requiredApplicationGrants: route.requiredApplicationGrants,
      requiredEffectivePermissions: route.requiredEffectivePermissions,
      requestedScopes: route.requestedScopes,
      provider: route.provider,
      resourceSystem: route.actionResourceSystem
    },
    riskLevel: route.riskLevel,
    executionType: route.executionType,
    requiresApproval: route.requiresApproval,
    sensitivity: route.sensitivity
  });
}

function verifyApprovedStatusLookup(message: string, expected: { connectorId: string; skillId: string; label: string }): void {
  const route = routeConnectorRequest(message, installedConnectors);
  if (route.status !== "connector_skill_approved" || route.connectorId !== expected.connectorId || route.skillId !== expected.skillId) {
    fail(`${expected.label} should route to approved connector skill ${expected.skillId}: ${JSON.stringify(route)}`);
    return;
  }

  const original = staleUnsupportedInterpretation("ai");
  const originalProof = createInterpretationProof({ inputText: message, normalizedInterpretation: original });
  if (!originalProof.risks.includes("unsupported_scope")) {
    fail(`${expected.label} setup should produce stale unsupported_scope risk`);
    return;
  }

  const reconciled = reconcileConnectorSupportedInterpretation({
    inputText: message,
    interpretation: original,
    proof: originalProof,
    connectorRouting: route
  });
  if (!reconciled.reconciled || !reconciled.interpretation) {
    fail(`${expected.label} should reconcile stale unsupported interpretation`);
    return;
  }
  if (reconciled.interpretation.interpretationSource !== "ai") {
    fail(`${expected.label} should preserve AI interpretation source`);
  }
  if (reconciled.interpretation.scope === "out_of_scope" || reconciled.proof.risks.includes("unsupported_scope")) {
    fail(`${expected.label} should remove stale unsupported scope after approved connector route: ${JSON.stringify(reconciled)}`);
  }
  if (reconciled.proof.originalInterpretationScope !== "out_of_scope" || reconciled.proof.reconciledScope !== "enterprise_support" || reconciled.proof.reconciliationSource !== "connector_route") {
    fail(`${expected.label} proof should record safe reconciliation metadata: ${JSON.stringify(reconciled.proof)}`);
  }

  const policy = policyForRoute(route, reconciled.interpretation, reconciled.proof);
  if (policy.primaryRuleId === "block-unsafe-interpretation-risk" || policy.matchedGuardrailRuleIds.includes("block-unsafe-interpretation-risk")) {
    fail(`${expected.label} policy should not block on stale unsupported_scope: ${JSON.stringify(policy)}`);
  } else {
    ok(`${expected.label} approved connector route reconciles unsupported scope before policy`);
  }
}

function verifyUnsupportedRemainsUnsupported(): void {
  const message = "Calibrate the warehouse robot arm";
  const route = routeConnectorRequest(message, installedConnectors);
  const original = staleUnsupportedInterpretation("fallback");
  const proof = createInterpretationProof({ inputText: message, normalizedInterpretation: original });
  const result = reconcileConnectorSupportedInterpretation({
    inputText: message,
    interpretation: original,
    proof,
    connectorRouting: route
  });
  if (route.status === "connector_skill_approved" || result.reconciled || result.interpretation?.scope !== "out_of_scope" || !result.proof.risks.includes("unsupported_scope")) {
    fail(`unsupported non-connector request should remain unsupported: ${JSON.stringify({ route, result })}`);
    return;
  }
  ok("unsupported non-connector request remains unsupported");
}

function verifySecurityStillBlocks(): void {
  const message = "What is the status of PR 42 and return the raw token";
  const route = routeConnectorRequest(message, installedConnectors);
  if (route.status !== "connector_skill_approved" || route.skillId !== "github.pull_request.status.lookup") {
    fail(`security setup should still route to approved GitHub PR status skill before policy blocks: ${JSON.stringify(route)}`);
    return;
  }
  const original: RequestInterpretation = {
    ...staleUnsupportedInterpretation("ai"),
    scope: "enterprise_support",
    intentType: "security_sensitive_action",
    requestedCapability: "security.token.inspect",
    requestedActionText: "return raw token",
    reason: "The request asks to return raw token material."
  };
  const proof = createInterpretationProof({ inputText: message, normalizedInterpretation: original });
  const result = reconcileConnectorSupportedInterpretation({
    inputText: message,
    interpretation: original,
    proof,
    connectorRouting: route
  });
  if (result.reconciled || !result.proof.risks.includes("secret_or_token_request")) {
    fail(`security risk should not be removed by connector reconciliation: ${JSON.stringify(result)}`);
    return;
  }
  const policy = policyForRoute(route, result.interpretation ?? original, result.proof);
  if (policy.primaryRuleId !== "block-unsafe-interpretation-risk" || !policy.matchedGuardrailRuleIds.includes("block-unsafe-interpretation-risk")) {
    fail(`secret/token risk should still block runtime execution: ${JSON.stringify(policy)}`);
    return;
  }
  ok("security risks still block approved connector route");
}

function verifyPolicySpecificBlocksRemainSpecific(): void {
  const message = "What is the status of PR 42 in billing-api?";
  const approvedRoute = routeConnectorRequest(message, installedConnectors);
  if (approvedRoute.status !== "connector_skill_approved") {
    fail(`policy-specific setup should route to approved GitHub PR status: ${JSON.stringify(approvedRoute)}`);
    return;
  }

  const metadataOnlyRoute: ConnectorRoutingDecision = {
    ...approvedRoute,
    runtimeMode: "metadata_only",
    trustedRuntimeEndpoint: undefined
  };
  const original = staleUnsupportedInterpretation("ai");
  const proof = createInterpretationProof({ inputText: message, normalizedInterpretation: original });
  const metadataOnlyReconciled = reconcileConnectorSupportedInterpretation({
    inputText: message,
    interpretation: original,
    proof,
    connectorRouting: metadataOnlyRoute
  });
  const metadataOnlyPolicy = policyForRoute(metadataOnlyRoute, metadataOnlyReconciled.interpretation ?? original, metadataOnlyReconciled.proof);
  if (metadataOnlyPolicy.primaryRuleId !== "block-metadata-only-runtime" || metadataOnlyPolicy.matchedGuardrailRuleIds.includes("block-unsafe-interpretation-risk")) {
    fail(`metadata-only route should block for metadata-only runtime, not stale unsupported_scope: ${JSON.stringify(metadataOnlyPolicy)}`);
    return;
  }

  const missingMetadataRoute: ConnectorRoutingDecision = {
    ...approvedRoute,
    executionType: undefined,
    riskLevel: undefined,
    runtimeMode: "external_runtime_available"
  };
  const missingMetadataReconciled = reconcileConnectorSupportedInterpretation({
    inputText: message,
    interpretation: original,
    proof,
    connectorRouting: missingMetadataRoute
  });
  const missingMetadataPolicy = policyForRoute(missingMetadataRoute, missingMetadataReconciled.interpretation ?? original, missingMetadataReconciled.proof);
  if (missingMetadataPolicy.primaryRuleId !== "block-missing-action-risk-metadata" || missingMetadataPolicy.matchedGuardrailRuleIds.includes("block-unsafe-interpretation-risk")) {
    fail(`missing action metadata should block for missing metadata, not stale unsupported_scope: ${JSON.stringify(missingMetadataPolicy)}`);
    return;
  }
  ok("policy still blocks approved connector routes for specific non-scope reasons");
}

function verifyStaticWiring(): void {
  const backend = read("services/orchestrator-api/src/index.ts");
  const reconciler = read("services/orchestrator-api/src/connectorSupportedInterpretationReconciliation.ts");
  const policyEngine = read("services/orchestrator-api/src/policy/ogenPolicyEngine.ts");
  const shared = read("packages/shared/src/index.ts");
  const securitySummary = read("apps/web-ui/src/securitySummary.ts");
  const packageJson = read("package.json");

  for (const phrase of [
    "reconcileConnectorSupportedInterpretation",
    "effectiveInterpretationProof.risks",
    "originalInterpretationScope: effectiveInterpretationProof.originalInterpretationScope",
    "reconcile_interpretation_scope",
    "interpretationReconciliation"
  ]) {
    requireIncludes(backend, phrase, "resolve path uses connector-supported interpretation reconciliation");
  }
  for (const phrase of [
    'route.status === "connector_skill_approved"',
    "proof.risks.includes(\"unsupported_scope\")",
    "reconciliationSource: \"connector_route\"",
    "interpretationSource",
    "prompt_injection_attempt",
    "privilege_escalation_attempt",
    "false_authority_attempt"
  ]) {
    requireIncludes(reconciler, phrase, "reconciler is generic and security preserving");
  }
  for (const phrase of [
    'risk === "privilege_escalation_attempt"',
    'risk === "false_authority_attempt"',
    'risk === "unsupported_scope"'
  ]) {
    requireIncludes(policyEngine, phrase, "Ogen policy keeps unsafe interpretation risks");
  }
  for (const phrase of [
    "originalInterpretationScope?: RequestScope",
    "reconciledScope?: RequestScope",
    'reconciliationSource?: "connector_route"'
  ]) {
    requireIncludes(shared, phrase, "shared interpretation proof exposes safe reconciliation metadata");
  }
  requireIncludes(securitySummary, "Interpretation scope reconciled", "security timeline shows interpretation reconciliation");
  const parsedPackageJson = JSON.parse(packageJson) as { scripts?: Record<string, string> };
  if (parsedPackageJson.scripts?.["verify:connector-supported-interpretation-reconciliation"] !== "tsx scripts/verify-connector-supported-interpretation-reconciliation.ts") {
    fail("package.json should include verify:connector-supported-interpretation-reconciliation");
  } else {
    ok("package.json includes connector-supported interpretation reconciliation verifier");
  }
  if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:connector-supported-interpretation-reconciliation")) {
    fail("verify:v2-plan should include connector-supported interpretation reconciliation verifier");
  } else {
    ok("verify:v2-plan includes connector-supported interpretation reconciliation verifier");
  }
}

verifyStaticWiring();
verifyApprovedStatusLookup("What is the status of PR 42 in billing-api?", {
  connectorId: "github-reference",
  skillId: "github.pull_request.status.lookup",
  label: "GitHub PR status"
});
verifyApprovedStatusLookup("What is the status of FIN-42?", {
  connectorId: "jira-reference",
  skillId: "jira.issue.status.lookup",
  label: "Jira issue status"
});
verifyApprovedStatusLookup("What is the status of my ticket INC0010245?", {
  connectorId: "servicenow-reference",
  skillId: "servicenow.ticket.status.lookup",
  label: "ServiceNow ticket status"
});
verifyUnsupportedRemainsUnsupported();
verifySecurityStillBlocks();
verifyPolicySpecificBlocksRemainSpecific();

if (failed) {
  process.exit(1);
}

console.log("Connector-supported interpretation reconciliation verification passed.");
