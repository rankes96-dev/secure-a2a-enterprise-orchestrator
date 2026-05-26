import { existsSync, readFileSync } from "node:fs";
import { createAiRoutingProof } from "../services/orchestrator-api/src/interpretation/routingProof.js";
import { OGEN_AI_ROUTING_SCHEMA_VERSION } from "../services/orchestrator-api/src/interpretation/routingProofTypes.js";
import type { RoutingDecision } from "../packages/shared/src/index.js";
import type { AgentCard } from "../services/orchestrator-api/src/agentCards.js";
import type { OgenInterpretationProof } from "../services/orchestrator-api/src/interpretation/interpretationTypes.js";

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

function requireNotIncludes(source: string, phrase: string, context: string): void {
  if (source.includes(phrase)) {
    fail(`${context} should not include forbidden phrase: ${phrase}`);
    return;
  }
  ok(context);
}

function baseRoutingDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    classification: {
      system: "Jira",
      issueType: "UNKNOWN",
      operation: "unknown",
      confidence: "medium",
      reasoningSummary: "Verification routing decision.",
      classificationSource: "rules_fallback",
      reporterType: "end_user",
      supportMode: "end_user_support"
    },
    selectedAgents: [],
    skippedAgents: [
      {
        agentId: "external-jira-agent",
        reason: "Not selected for verification."
      }
    ],
    routingSource: "rules_fallback",
    routingConfidence: "medium",
    routingReasoningSummary: "Verification routing decision.",
    resolutionStatus: "needs_more_info",
    ...overrides
  };
}

function verificationAgentCard(agentId: string, skillIds: string[]): AgentCard {
  return {
    agentId,
    name: `${agentId} verification card`,
    description: "verification card description with secret phrase that must not enter routing proof",
    systems: ["Verification"],
    endpoint: `http://localhost/${agentId}`,
    auth: {
      type: "mock_internal_token",
      audience: agentId
    },
    skills: skillIds.map((skillId) => ({
      id: skillId,
      name: `${skillId} verification skill`,
      description: "verification skill description with hidden routing detail"
    }))
  };
}

function verificationInterpretationProof(overrides: Partial<OgenInterpretationProof> = {}): OgenInterpretationProof {
  return {
    interpretationId: "verification-interpretation",
    schemaVersion: "ogen.interpretation.v1",
    createdAt: "2026-05-26T00:00:00.000Z",
    source: "fallback",
    inputHash: "input-hash",
    outputHash: "output-hash",
    confidence: "medium",
    risks: [],
    advisoryOnly: true,
    rawPromptStored: false,
    rawAiResponseStored: false,
    ...overrides
  };
}

const routingProofTypes = read("services/orchestrator-api/src/interpretation/routingProofTypes.ts");
const routingProof = read("services/orchestrator-api/src/interpretation/routingProof.ts");
const aiRouter = read("services/orchestrator-api/src/aiRouter.ts");
const backend = read("services/orchestrator-api/src/index.ts");
const auditEvents = read("services/orchestrator-api/src/audit/auditEvents.ts");
const shared = read("packages/shared/src/index.ts");
const executionGateStack = read("services/orchestrator-api/src/executionGateStack.ts");
const packageJson = read("package.json");
const platformDocs = read("docs/v2-platform-foundation.md");
const productIdentityDocs = read("docs/ogen-product-identity.md");

requireIncludes(routingProofTypes, 'OGEN_AI_ROUTING_SCHEMA_VERSION = "ogen.ai-routing.v1"', "AI routing schema version exists");
for (const phrase of [
  "export type OgenAiRoutingProof",
  "routingProofId: string",
  "inputHash: string",
  "messageHash: string",
  "inputContextHash: string",
  "safeInputContextSummary",
  "outputHash: string",
  "advisoryOnly: true",
  "rawPromptStored: false",
  "rawAiResponseStored: false",
  "authorizedRuntime: false"
]) {
  requireIncludes(routingProofTypes, phrase, "AI routing proof type has required field");
}
for (const status of [
  "not_required",
  "passed",
  "failed",
  "empty_response",
  "ai_error",
  "not_configured"
]) {
  requireIncludes(routingProofTypes, status, "AI routing validation status covers required status");
}

requireIncludes(routingProof, "export function createAiRoutingProof", "AI routing proof builder exists");
requireIncludes(routingProof, "createHash", "AI routing proof hashes inputs");
requireIncludes(routingProof, "safeInputContextSummary", "AI routing proof builds safe input context summary");
requireIncludes(routingProof, "stableStringify(inputSummary)", "AI routing proof hashes safe input context summary");
requireIncludes(routingProof, "inputHash: inputContextHash", "AI routing proof uses input context hash as canonical input hash");
requireIncludes(routingProof, "stableStringify(summary)", "AI routing proof hashes safe output summary");
requireIncludes(routingProof, "selectedAgentIds: routingDecision.selectedAgents.map", "AI routing proof uses selected agent IDs");
requireIncludes(routingProof, "skippedAgentIds: routingDecision.skippedAgents.map", "AI routing proof uses skipped agent IDs");
requireIncludes(routingProof, "interpretationProof?: OgenInterpretationProof", "AI routing proof accepts interpretation proof context");
requireIncludes(routingProof, "agentCards?: AgentCard[]", "AI routing proof accepts safe Agent Card context");
requireIncludes(routingProof, "authorizedRuntime: false", "AI routing proof never authorizes runtime");
requireNotIncludes(routingProof, "rawPrompt:", "AI routing proof does not return raw prompt");
requireNotIncludes(routingProof, "rawAiResponse:", "AI routing proof does not return raw AI response");

requireIncludes(aiRouter, "routingProof: OgenAiRoutingProof", "routeWithAIWithProof returns routing proof");
requireIncludes(aiRouter, "const executableAgentCards = getExecutableAgentCards(cardsForContext(context));", "router derives one executable Agent Card set");
requireIncludes(aiRouter, "agentCards: executableAgentCards", "router passes safe Agent Cards into routing proof");
requireIncludes(aiRouter, "interpretationProof,", "router passes interpretation proof into routing proof");
requireIncludes(aiRouter, "callOpenRouter(message, requestInterpretation, executableAgentCards", "secondary AI router uses same Agent Card set as proof");
requireIncludes(aiRouter, "validationStatus: \"not_required\"", "router records rules fallback not-required proof");
requireIncludes(aiRouter, "validationStatus: \"not_configured\"", "router records missing AI config proof");
requireIncludes(aiRouter, "validationStatus: \"empty_response\"", "router records empty secondary AI response proof");
requireIncludes(aiRouter, "validationStatus: \"failed\"", "router records failed validation proof");
requireIncludes(aiRouter, "validationStatus: \"passed\"", "router records passed validation proof");
requireIncludes(aiRouter, "validationStatus: \"ai_error\"", "router records AI error proof");
requireIncludes(aiRouter, "export async function routeWithAI(message: string", "legacy routeWithAI remains compatible");
requireIncludes(aiRouter, "(await routeWithAIWithProof(message, context)).routingDecision", "legacy routeWithAI delegates to proof-aware path");

requireIncludes(auditEvents, 'AI_ROUTING_EVALUATED: "ai.routing.evaluated"', "AI routing audit event exists");
requireIncludes(backend, "appendAiRoutingEvaluatedAuditEvent", "/resolve appends AI routing proof audit");
requireIncludes(backend, "eventType: AuditEvents.AI_ROUTING_EVALUATED", "AI routing audit event is emitted");
requireIncludes(backend, "messageHash: proof.messageHash", "AI routing audit includes message hash");
requireIncludes(backend, "inputContextHash: proof.inputContextHash", "AI routing audit includes input context hash");
requireIncludes(backend, "safeInputContextSummary: proof.safeInputContextSummary", "AI routing audit includes safe input context summary");
requireIncludes(backend, "aiRoutingProof: response.aiRoutingProof ?? routingProof", "/resolve response includes AI routing proof");
requireIncludes(backend, "aiRoutingProof: responseWithIdentity.aiRoutingProof", "execution gate receives AI routing proof");

for (const phrase of [
  "aiRoutingProof?:",
  "routingProofId: string",
  "schemaVersion: string",
  "inputHash: string",
  "messageHash: string",
  "inputContextHash: string",
  "safeInputContextSummary",
  "agentCardIds: string[]",
  "agentCardSkillIds: string[]",
  "agentCardCount: number",
  "outputHash: string",
  "validationStatus: string",
  "selectedAgentIds: string[]",
  "skippedAgentIds: string[]",
  "advisoryOnly: true",
  "rawPromptStored: false",
  "rawAiResponseStored: false",
  "authorizedRuntime: false"
]) {
  requireIncludes(shared, phrase, "shared response type includes safe AI routing proof");
}

for (const phrase of [
  "aiRoutingProof?: ResolveResponse[\"aiRoutingProof\"]",
  "aiRoutingProofId",
  "aiRoutingSource",
  "aiRoutingValidationStatus",
  "aiRoutingAdvisoryOnly",
  "aiRoutingAuthorizedRuntime",
  "aiRoutingInputContextHash",
  "aiRoutingAgentCardCount",
  "aiRoutingAgentCardIds",
  "aiRoutingInterpretationId"
]) {
  requireIncludes(executionGateStack, phrase, "execution gate evidence includes AI routing proof");
}

const parsedPackageJson = JSON.parse(packageJson) as { scripts?: Record<string, string> };
if (parsedPackageJson.scripts?.["verify:ai-routing-trust-boundary"] !== "tsx scripts/verify-ai-routing-trust-boundary.ts") {
  fail("package.json should include verify:ai-routing-trust-boundary");
} else {
  ok("package.json includes verify:ai-routing-trust-boundary");
}
if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:ai-interpretation-trust-boundary && npm run verify:ai-routing-trust-boundary")) {
  fail("verify:v2-plan should run AI routing trust boundary after AI interpretation trust boundary");
} else {
  ok("verify:v2-plan includes AI routing trust boundary after AI interpretation");
}

const fallbackInput = "Route this Jira request safely.";
const fallbackProof = createAiRoutingProof({
  inputText: fallbackInput,
  routingDecision: baseRoutingDecision(),
  source: "rules_fallback",
  validationStatus: "not_required",
  interpretationProof: verificationInterpretationProof(),
  agentCards: [verificationAgentCard("external-jira-agent", ["jira.issue.status.lookup"])]
});
if (
  fallbackProof.schemaVersion !== OGEN_AI_ROUTING_SCHEMA_VERSION ||
  fallbackProof.source !== "rules_fallback" ||
  fallbackProof.validationStatus !== "not_required" ||
  fallbackProof.inputHash !== fallbackProof.inputContextHash ||
  !fallbackProof.messageHash ||
  !fallbackProof.inputContextHash ||
  fallbackProof.authorizedRuntime !== false ||
  fallbackProof.advisoryOnly !== true ||
  fallbackProof.rawPromptStored !== false ||
  fallbackProof.rawAiResponseStored !== false ||
  JSON.stringify(fallbackProof).includes(fallbackInput) ||
  JSON.stringify(fallbackProof).includes("secret phrase")
) {
  fail("rules fallback routing proof should be advisory and not contain raw input text or raw Agent Card text");
} else {
  ok("rules fallback routing proof is safe and advisory");
}

const secondaryAiProof = createAiRoutingProof({
  inputText: "Use Jira issue lookup.",
  routingDecision: baseRoutingDecision({
    selectedAgents: [
      {
        agentId: "external-jira-agent",
        role: "primary",
        skillId: "jira.issue.status.lookup",
        reason: "Matched Jira lookup."
      }
    ],
    skippedAgents: [],
    routingSource: "ai",
    routingConfidence: "high",
    resolutionStatus: "resolved"
  }),
  source: "secondary_ai",
  validationStatus: "passed",
  provider: "openrouter",
  model: "safe-model",
  interpretationProof: verificationInterpretationProof({ interpretationId: "secondary-ai-interpretation" }),
  agentCards: [verificationAgentCard("external-jira-agent", ["jira.issue.status.lookup"])]
});
if (
  secondaryAiProof.source !== "secondary_ai" ||
  secondaryAiProof.validationStatus !== "passed" ||
  !secondaryAiProof.outputHash ||
  !secondaryAiProof.selectedAgentIds.includes("external-jira-agent") ||
  secondaryAiProof.authorizedRuntime !== false
) {
  fail("secondary AI routing proof should capture safe selected agent IDs without authorizing runtime");
} else {
  ok("secondary AI success proof is safe and advisory");
}

const failedProof = createAiRoutingProof({
  inputText: "Bad routing attempt.",
  routingDecision: baseRoutingDecision(),
  source: "rules_fallback",
  validationStatus: "failed",
  interpretationProof: verificationInterpretationProof(),
  agentCards: [verificationAgentCard("external-jira-agent", ["jira.issue.status.lookup"])]
});
if (failedProof.validationStatus !== "failed" || failedProof.authorizedRuntime !== false) {
  fail("failed AI routing proof should remain non-authorizing");
} else {
  ok("failed AI routing proof remains non-authorizing");
}

const sameMessage = "Route this same request with different safe context.";
const oneCardProof = createAiRoutingProof({
  inputText: sameMessage,
  routingDecision: baseRoutingDecision(),
  source: "rules_fallback",
  validationStatus: "not_required",
  interpretationProof: verificationInterpretationProof({ outputHash: "same-interpretation-output" }),
  agentCards: [verificationAgentCard("b-agent", ["z.skill", "a.skill"])]
});
const differentCardProof = createAiRoutingProof({
  inputText: sameMessage,
  routingDecision: baseRoutingDecision(),
  source: "rules_fallback",
  validationStatus: "not_required",
  interpretationProof: verificationInterpretationProof({ outputHash: "same-interpretation-output" }),
  agentCards: [verificationAgentCard("a-agent", ["m.skill"]), verificationAgentCard("b-agent", ["z.skill", "a.skill"])]
});
if (oneCardProof.messageHash !== differentCardProof.messageHash || oneCardProof.inputContextHash === differentCardProof.inputContextHash) {
  fail("same message with different Agent Card context should keep messageHash and change inputContextHash");
} else {
  ok("Agent Card context changes AI routing input context hash");
}

const differentInterpretationProof = createAiRoutingProof({
  inputText: sameMessage,
  routingDecision: baseRoutingDecision(),
  source: "rules_fallback",
  validationStatus: "not_required",
  interpretationProof: verificationInterpretationProof({ outputHash: "different-interpretation-output" }),
  agentCards: [verificationAgentCard("b-agent", ["z.skill", "a.skill"])]
});
if (oneCardProof.messageHash !== differentInterpretationProof.messageHash || oneCardProof.inputContextHash === differentInterpretationProof.inputContextHash) {
  fail("same message with different interpretation output hash should keep messageHash and change inputContextHash");
} else {
  ok("interpretation proof context changes AI routing input context hash");
}

if (
  differentCardProof.safeInputContextSummary.agentCardIds.join(",") !== "a-agent,b-agent" ||
  differentCardProof.safeInputContextSummary.agentCardSkillIds.join(",") !== "a.skill,m.skill,z.skill"
) {
  fail("Agent Card IDs and skill IDs should be sorted for stable input context hashing");
} else {
  ok("safe routing input context summary is sorted and stable");
}

for (const phrase of [
  "Phase 2.12a  AI Routing Trust Boundary",
  "Secondary AI routing is advisory only.",
  "AI routing cannot authorize runtime.",
  "routing proof records source, validation status, selected/skipped agent IDs",
  "Raw prompts and raw AI routing responses are not stored.",
  "Ogen policy and runtime gates remain authoritative",
  "AI routing proof hashes the safe routing input context, not only the message.",
  "The safe context includes interpretation proof reference and agent card IDs/skill IDs.",
  "Raw prompts and raw agent card text are not stored."
]) {
  requireIncludes(platformDocs, phrase, "platform docs cover AI routing trust boundary");
}
requireIncludes(productIdentityDocs, "AI can suggest routing. Ogen validates and authorizes.", "product identity docs include AI routing trust principle");
requireIncludes(productIdentityDocs, "Ogen proves not only what AI suggested, but the safe context it was allowed to see.", "product identity docs include routing context proof principle");

if (failed) {
  process.exitCode = 1;
} else {
  console.log("AI routing trust boundary verification passed.");
}
