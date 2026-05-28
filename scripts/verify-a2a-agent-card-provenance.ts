import { existsSync, readFileSync } from "node:fs";

let failed = false;

function fail(message: string): void {
  failed = true;
  console.error(`fail - ${message}`);
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

function requireExcludes(source: string, phrase: string, context: string): void {
  if (source.includes(phrase)) {
    fail(`${context} should not include forbidden phrase: ${phrase}`);
    return;
  }
  ok(context);
}

function assert(condition: unknown, context: string): void {
  if (!condition) {
    fail(context);
    return;
  }
  ok(context);
}

const provenancePath = "packages/shared/src/a2aAgentCardProvenance.ts";
const sharedIndexPath = "packages/shared/src/index.ts";
const agentCardsPath = "services/orchestrator-api/src/agentCards.ts";
const orchestratorPath = "services/orchestrator-api/src/index.ts";
const runtimeAuthorizationPath = "services/orchestrator-api/src/runtimeAuthorization/runtimeAuthorizationEvaluator.ts";
const connectorPolicyPath = "services/orchestrator-api/src/policy/connectorPolicy.ts";
const securityPolicyPath = "services/orchestrator-api/src/security/policyEngine.ts";
const packageJsonPath = "package.json";
const v2PlanScriptPath = "scripts/verify-v2-plan.ts";
const v2DocsPath = "docs/v2-platform-foundation.md";
const sdkDocsPath = "docs/sdk-readiness-contracts.md";
const roadmapPath = "docs/orchestrator-agnostic-roadmap.md";

const provenanceSource = read(provenancePath);
const sharedIndex = read(sharedIndexPath);
const agentCards = read(agentCardsPath);
const orchestrator = read(orchestratorPath);
const runtimeAuthorization = read(runtimeAuthorizationPath);
const connectorPolicy = read(connectorPolicyPath);
const securityPolicy = read(securityPolicyPath);
const packageJsonText = read(packageJsonPath);
const v2PlanScript = read(v2PlanScriptPath);
const v2Docs = read(v2DocsPath);
const sdkDocs = read(sdkDocsPath);
const roadmap = read(roadmapPath);
const verifierSource = read("scripts/verify-a2a-agent-card-provenance.ts");
const verifierImports = verifierSource
  .split(/\r?\n/)
  .filter((line) => line.startsWith("import "))
  .join("\n");

for (const phrase of [
  "../packages/shared/src/a2aAgentCardProvenance.js",
  "../services/orchestrator-api/src/agentCards.js"
]) {
  requireExcludes(verifierImports, phrase, "Agent Card provenance verifier is source-only");
}

for (const phrase of [
  "OgenAgentCardProvenance",
  "OgenAgentCardSignature",
  "OgenAgentCardVerificationStatus",
  "OGEN_AGENT_CARD_VERIFICATION_STATUSES",
  '"verified"',
  '"unverified"',
  '"expired"',
  '"invalid"',
  '"error"',
  '"not_configured"',
  "canonicalizeAgentCardPayload",
  "agentCardPayloadHash",
  "verifyOgenAgentCardSignature",
  "withOgenAgentCardProvenance",
  "signaturePresent",
  "verificationReason",
  "informationalOnly: true",
  "tenantAuthority: \"verified_gateway_session\"",
  "authorizationAuthority: \"existing_a2a_jwt_or_gateway_session\"",
  "policyAuthority: \"existing_ogen_policy\"",
  "auditAuthority: \"existing_ogen_audit\"",
  "protectedMaterialExposed: false",
  "tokenMaterialStored: false",
  "privateKeyMaterialExposed: false",
  "rawPromptStored: false"
]) {
  requireIncludes(provenanceSource, phrase, "shared Agent Card provenance contract");
}

for (const phrase of [
  'const AGENT_CARD_ENVELOPE_FIELDS = new Set(["provenance", "signature"])',
  "if (omitEnvelopeFields && AGENT_CARD_ENVELOPE_FIELDS.has(key))",
  "return JSON.stringify(stableValue(agentCard, true))",
  'createHash("sha256").update(canonicalizeAgentCardPayload(agentCard)).digest("base64url")',
  'verificationStatus: params.signature.signaturePresent ? "unverified" : "not_configured"',
  'verificationStatus: "invalid"',
  'verificationStatus: "expired"',
  'verificationStatus: "error"',
  'const REDACTED_VERIFICATION_REASON = "redacted_verification_reason" as const',
  "access[\\s_-]*token",
  "refresh[\\s_-]*token",
  "client[\\s_-]*assertion",
  "private[\\s_-]*key",
  "client[\\s_-]*secret",
  "authorization[\\s_-]*code",
  "bearer",
  "jwt",
  "if (PROTECTED_REASON_PATTERN.test(reason))",
  "return REDACTED_VERIFICATION_REASON",
  'safeReason(result.reason',
  'signaturePresent: signature.signaturePresent',
  'payloadHash: agentCardPayloadHash(params.agentCard)',
  'canonicalization: OGEN_AGENT_CARD_CANONICALIZATION'
]) {
  requireIncludes(provenanceSource, phrase, "shared Agent Card provenance source-only behavior");
}

const protectedReasonPatternFixture =
  /\b(?:access[\s_-]*token|refresh[\s_-]*token|id[\s_-]*token|client[\s_-]*assertion|client[\s_-]*secret|authorization[\s_-]*code|private[\s_-]*key|raw[\s_-]*prompt|bearer|jwt|secret|password|cookie|prompt)\b/i;
const redactedVerificationReason = "redacted_verification_reason";
const spacedProtectedReasonCases = [
  "access token abc123 was present",
  "client assertion failed signature verification",
  "private key material was referenced",
  "client secret appeared in verifier output"
];

for (const reason of spacedProtectedReasonCases) {
  const sanitized = protectedReasonPatternFixture.test(reason) ? redactedVerificationReason : reason.slice(0, 240);
  assert(sanitized === redactedVerificationReason, `spaced protected-material reason is generically redacted: ${reason}`);
  assert(!sanitized.includes(reason), `raw verifier message is not exposed for protected-material reason: ${reason}`);
}
requireIncludes(provenanceSource, "protectedMaterialExposed: false", "redacted Agent Card provenance still reports no protected material exposure");

requireIncludes(sharedIndex, 'export * from "./a2aAgentCardProvenance.js"', "shared index exports Agent Card provenance helpers");

for (const phrase of [
  "provenance?: OgenAgentCardProvenance",
  "signature?: unknown",
  "type OgenAgentCardSignature",
  "parseDiscoveredAgentCardProvenance",
  "withOgenAgentCardProvenance(card",
  "issuer: \"ogen.built-in-agent-registry\"",
  "signaturePresent: false",
  "parseDiscoveredAgentCardProvenance(card, card.agentId)"
]) {
  requireIncludes(agentCards, phrase, "orchestrator Agent Card discovery attaches provenance");
}
requireExcludes(agentCards, "Boolean(card.provenance?.signaturePresent)", "orchestrator Agent Card discovery does not truthy-coerce signature presence");
requireExcludes(agentCards, "Boolean(card.signature", "orchestrator Agent Card discovery does not truthy-coerce top-level signature");
requireExcludes(agentCards, "card.provenance?.issuer ?? card.agentId", "orchestrator Agent Card discovery does not directly copy discovered issuer");
requireExcludes(agentCards, "parseDiscoveredAgentCardProvenance(card.provenance", "orchestrator Agent Card discovery passes full card to provenance parser");

for (const phrase of [
  "function asRecord(value: unknown): Record<string, unknown> | undefined",
  "value !== null && typeof value === \"object\" && !Array.isArray(value)",
  "function optionalProvenanceString(value: unknown): string | undefined",
  "typeof value === \"string\" && value.trim().length > 0 ? value.trim() : undefined",
  "const TOP_LEVEL_SIGNATURE_PAYLOAD_FIELDS = [\"compactJws\", \"jws\", \"signature\", \"detachedJws\"] as const",
  "function hasValidTopLevelSignatureEnvelope(signature: unknown): boolean",
  "const signatureRecord = asRecord(signature)",
  "TOP_LEVEL_SIGNATURE_PAYLOAD_FIELDS.some((field) => optionalProvenanceString(signatureRecord[field]) !== undefined)",
  "export function parseDiscoveredAgentCardProvenance(",
  "card: { agentId?: unknown; provenance?: unknown; signature?: unknown }",
  "const provenance = asRecord(card.provenance)",
  "const signaturePresent = hasValidTopLevelSignatureEnvelope(card.signature)",
  "? true",
  ": typeof provenance?.signaturePresent === \"boolean\"",
  "? provenance.signaturePresent",
  ": false",
  "issuer: optionalProvenanceString(provenance?.issuer) ?? optionalProvenanceString(fallbackIssuer)",
  "kid: optionalProvenanceString(provenance?.kid)",
  "alg: optionalProvenanceString(provenance?.alg)",
  "signedAt: optionalProvenanceString(provenance?.signedAt)",
  "expiresAt: optionalProvenanceString(provenance?.expiresAt)",
  "signaturePresent"
]) {
  requireIncludes(agentCards, phrase, "orchestrator discovered provenance parser is source-validated");
}

const localAgentPaths = [
  "services/jira-agent/src/index.ts",
  "services/github-agent/src/index.ts",
  "services/pagerduty-agent/src/index.ts",
  "services/security-oauth-agent/src/index.ts",
  "services/api-health-agent/src/index.ts",
  "services/end-user-triage-agent/src/index.ts"
];

for (const path of localAgentPaths) {
  const source = read(path);
  requireIncludes(source, "withOgenAgentCardProvenance({", `${path} builds Agent Card with provenance`);
  requireIncludes(source, "signaturePresent: false", `${path} marks unsigned local Agent Card provenance safely`);
  requireIncludes(source, 'request.url === "/agent-card" || request.url === A2A_AGENT_CARD_WELL_KNOWN_PATH', `${path} exposes legacy and well-known Agent Card routes`);
  requireIncludes(source, 'sendJson(response, 200, agentCard, request, { "content-type": A2A_CONTENT_TYPE });', `${path} returns provenance-bearing Agent Card payload`);
}

for (const [name, source] of [
  ["runtime authorization", runtimeAuthorization],
  ["connector policy", connectorPolicy],
  ["security policy", securityPolicy]
] as const) {
  requireExcludes(source, "verificationStatus", `${name} does not use Agent Card provenance as authority`);
  requireExcludes(source, "OgenAgentCardProvenance", `${name} does not import Agent Card provenance as authority`);
}
requireExcludes(orchestrator, "verificationStatus === \"verified\"", "orchestrator does not gate authorization on verified provenance");

const packageJson = JSON.parse(packageJsonText) as { scripts?: Record<string, string> };
if (packageJson.scripts?.["verify:a2a-agent-card-provenance"] !== "tsx scripts/verify-a2a-agent-card-provenance.ts") {
  fail("package.json missing verify:a2a-agent-card-provenance script");
} else {
  ok("package.json includes verify:a2a-agent-card-provenance");
}
if (!packageJson.scripts?.["verify:v2-plan"]?.includes("verify:a2a-message-task-adapter && npm run verify:a2a-agent-card-provenance")) {
  fail("verify:v2-plan should run Agent Card provenance verifier after A2A Message/Task adapter verifier");
} else {
  ok("verify:v2-plan includes Agent Card provenance verifier after adapter verifier");
}
requireIncludes(v2PlanScript, "verify:a2a-agent-card-provenance", "V2 plan verifier requires Agent Card provenance package script");
requireExcludes(packageJsonText, "@a2a-js/sdk", "Phase 2.21 does not adopt official A2A JS SDK");

for (const phrase of [
  "Phase 2.21  Signed Agent Card Provenance",
  "signed Agent Card provenance is advisory only",
  "verificationStatus",
  "not_configured",
  "authorization remains Ogen policy, verified identity, tenant resolution, and Gateway RBAC",
  "Key rotation and trust-anchor rollout remain future operational work"
]) {
  requireIncludes(v2Docs, phrase, "V2 docs cover signed Agent Card provenance");
}

for (const phrase of [
  "Phase 2.21 adds signed Agent Card provenance",
  "Provenance is advisory metadata",
  "verified provenance does not grant runtime access",
  "Trust-anchor rollout and key rotation remain future work"
]) {
  requireIncludes(sdkDocs, phrase, "SDK readiness docs cover signed Agent Card provenance");
}

for (const phrase of [
  "Signed Agent Card Provenance",
  "provenance/integrity metadata",
  "informational-only",
  "Phase 2.22",
  "Optional Policy Consumption of Verified Provenance"
]) {
  requireIncludes(roadmap, phrase, "orchestrator-agnostic roadmap covers signed Agent Card provenance");
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("A2A Agent Card provenance verification passed.");
}
