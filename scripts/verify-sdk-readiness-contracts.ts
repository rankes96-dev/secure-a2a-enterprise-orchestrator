import { existsSync, readFileSync } from "node:fs";
import type { AgentCard } from "../services/orchestrator-api/src/agentCards.js";
import { localReferenceConnectorIntentCatalog } from "../services/orchestrator-api/src/connectors/localReferenceConnectorIntentCatalog.js";
import { safeAgentRoutingView } from "../services/orchestrator-api/src/interpretation/safeAgentRoutingView.js";
import { evaluateConnectorPolicy } from "../services/orchestrator-api/src/policy/connectorPolicy.js";
import {
  forbiddenSafeRoutingViewFields,
  requiredExecutableActionMetadataFields,
  requiredPolicyProofFields,
  SDK_READINESS_VERSION,
  sdkCertificationChecks
} from "../services/orchestrator-api/src/sdkReadiness/sdkContracts.js";

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

const sdkDocs = read("docs/sdk-readiness-contracts.md");
const sdkContracts = read("services/orchestrator-api/src/sdkReadiness/sdkContracts.ts");
const connectorTypes = read("services/orchestrator-api/src/connectors/types.ts");
const safeRoutingViewSource = read("services/orchestrator-api/src/interpretation/safeAgentRoutingView.ts");
const referenceVerifier = read("scripts/verify-reference-action-metadata.ts");
const packageJson = read("package.json");
const platformDocs = read("docs/v2-platform-foundation.md");
const productIdentityDocs = read("docs/ogen-product-identity.md");

for (const section of [
  "Connector Profile Contract",
  "Skill / Action Metadata Contract",
  "Safe Routing View Contract",
  "Authorization Required Contract",
  "Runtime Execution Response Contract",
  "Policy Decision Proof Contract",
  "AI Proof Contracts",
  "Certification Checklist"
]) {
  requireIncludes(sdkDocs, section, "SDK readiness docs include required section");
}

for (const phrase of [
  "Do not ship a Connector SDK yet",
  "Missing `riskLevel` or `executionType` fails closed.",
  "AI output cannot classify risk.",
  "Natural language cannot classify risk.",
  "Reference metadata fallback is allowed only for known built-in/reference connector skills.",
  "No raw tokens.",
  "No OAuth authorization code in browser-visible response.",
  "Authorization is resumed by Ogen only after policy re-check.",
  "authorizedRuntime: false",
  "rawPromptStored: false",
  "rawAiResponseStored: false"
]) {
  requireIncludes(sdkDocs, phrase, "SDK readiness docs include required invariant");
}

requireIncludes(sdkContracts, 'SDK_READINESS_VERSION = "ogen.sdk-readiness.v1"', "SDK readiness version exists");
if (SDK_READINESS_VERSION !== "ogen.sdk-readiness.v1") {
  fail("SDK_READINESS_VERSION should be ogen.sdk-readiness.v1");
} else {
  ok("SDK_READINESS_VERSION runtime value is correct");
}

for (const field of [
  "riskLevel",
  "executionType",
  "requiresApproval",
  "sensitivity",
  "requiredApplicationGrants",
  "requiredEffectivePermissions"
]) {
  if (!requiredExecutableActionMetadataFields.includes(field as typeof requiredExecutableActionMetadataFields[number])) {
    fail(`required executable action metadata fields should include ${field}`);
  } else {
    ok(`required executable action metadata fields include ${field}`);
  }
}

for (const field of ["endpoint", "auth", "audience", "token", "secret", "description"]) {
  if (!forbiddenSafeRoutingViewFields.includes(field as typeof forbiddenSafeRoutingViewFields[number])) {
    fail(`forbidden safe routing view fields should include ${field}`);
  } else {
    ok(`forbidden safe routing view fields include ${field}`);
  }
}

for (const check of [
  "action-metadata-complete",
  "write-actions-require-approval",
  "safe-routing-view-no-secrets",
  "runtime-requires-scoped-jwt",
  "wrong-audience-rejected",
  "expired-token-rejected",
  "authorization-required-safe",
  "no-raw-token-or-prompt-evidence"
]) {
  if (!sdkCertificationChecks.includes(check as typeof sdkCertificationChecks[number])) {
    fail(`SDK certification checklist should include ${check}`);
  } else {
    ok(`SDK certification checklist includes ${check}`);
  }
}

for (const phrase of [
  "export type ConnectorActionRequirement",
  "riskLevel?:",
  "executionType?:",
  "requiresApproval?: boolean",
  'sensitivity?: "standard" | "sensitive"'
]) {
  requireIncludes(connectorTypes, phrase, "ConnectorActionRequirement supports SDK metadata field");
}

for (const forbidden of forbiddenSafeRoutingViewFields) {
  if (safeRoutingViewSource.includes(`${forbidden}:`)) {
    fail(`safe routing view source should not expose ${forbidden}`);
  } else {
    ok(`safe routing view source does not expose ${forbidden}`);
  }
}

requireIncludes(referenceVerifier, "Reference action metadata verification passed.", "reference metadata verification exists");

const parsedPackageJson = JSON.parse(packageJson) as { scripts?: Record<string, string> };
if (parsedPackageJson.scripts?.["verify:sdk-readiness-contracts"] !== "tsx scripts/verify-sdk-readiness-contracts.ts") {
  fail("package.json should include verify:sdk-readiness-contracts");
} else {
  ok("package.json includes verify:sdk-readiness-contracts");
}
if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:reference-action-metadata && npm run verify:sdk-readiness-contracts")) {
  fail("verify:v2-plan should run SDK readiness contracts after reference action metadata");
} else {
  ok("verify:v2-plan includes SDK readiness contracts after reference action metadata");
}

for (const connector of localReferenceConnectorIntentCatalog) {
  for (const skill of connector.skillHints) {
    if (!skill.riskLevel || !skill.executionType) {
      fail(`${connector.connectorId}/${skill.skillId} should declare riskLevel and executionType`);
    }
  }
}
ok("all local reference skills declare riskLevel and executionType");

const unsafeAgentCard: AgentCard = {
  agentId: "sdk-verification-agent",
  name: "SDK Verification Agent",
  description: "sensitive operational description",
  systems: ["Verification"],
  endpoint: "https://runtime.example/a2a/task",
  auth: {
    type: "oauth2_client_credentials_jwt",
    audience: "secret-audience"
  },
  skills: [
    {
      id: "verification.skill",
      name: "Verification skill",
      description: "sensitive skill description"
    }
  ]
};
const safeView = safeAgentRoutingView([unsafeAgentCard]);
const safeViewText = JSON.stringify(safeView);
for (const forbidden of [
  "https://runtime.example",
  "secret-audience",
  "sensitive operational description",
  "sensitive skill description",
  "endpoint",
  "auth",
  "audience",
  "description"
]) {
  if (safeViewText.includes(forbidden)) {
    fail(`safe routing view output should not include ${forbidden}`);
  }
}
if (safeView[0]?.agentId !== "sdk-verification-agent" || safeView[0]?.skillIds.join(",") !== "verification.skill") {
  fail("safe routing view should keep routing identifiers");
} else {
  ok("safe routing view keeps routing IDs while omitting forbidden material");
}

const policyProof = evaluateConnectorPolicy({
  connectorRouteStatus: "connector_skill_approved",
  runtimeMode: "external_runtime_available",
  connectorId: "sdk-verification",
  resourceSystem: "verification",
  skillId: "verification.skill",
  skillLabel: "Verification skill",
  subject: {
    tenantId: "default",
    userId: "sdk-verification-user",
    roles: ["employee"]
  },
  riskLevel: "low",
  executionType: "inspection_read_only",
  requiresApproval: false,
  sensitivity: "standard"
});
const policyProofRecord = policyProof as unknown as Record<string, unknown>;
for (const field of requiredPolicyProofFields) {
  if (!(field in policyProofRecord)) {
    fail(`policy proof should include ${field}`);
  } else {
    ok(`policy proof includes ${field}`);
  }
}

for (const phrase of [
  "Phase 2.13  SDK Readiness Contracts",
  "No SDK implementation is built in this phase.",
  "contracts are defined now to avoid future rewrites",
  "connector SDK will generate connector profiles, safe routing views, runtime response contracts, and certification checks",
  "Ogen policy remains strict; SDK makes metadata complete"
]) {
  requireIncludes(platformDocs, phrase, "platform docs cover SDK readiness contracts");
}
requireIncludes(productIdentityDocs, "Ogen policy is strict. The SDK makes connector metadata complete. Certification proves the connector is safe to run.", "product identity docs cover SDK readiness principle");

if (failed) {
  process.exitCode = 1;
} else {
  console.log("SDK readiness contracts verification passed.");
}
