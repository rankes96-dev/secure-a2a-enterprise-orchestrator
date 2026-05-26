import { existsSync, readFileSync } from "node:fs";
import { createAiRoutingProof } from "../services/orchestrator-api/src/interpretation/routingProof.js";
import { OGEN_AI_ROUTING_SCHEMA_VERSION } from "../services/orchestrator-api/src/interpretation/routingProofTypes.js";
import type { RoutingDecision } from "../packages/shared/src/index.js";
import type { AgentCard } from "../services/orchestrator-api/src/agentCards.js";
import type { OgenInterpretationProof } from "../services/orchestrator-api/src/interpretation/interpretationTypes.js";
import { safeAgentRoutingView } from "../services/orchestrator-api/src/interpretation/safeAgentRoutingView.js";

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
    description: "card-secret-description",
    systems: ["Verification"],
    endpoint: `https://hidden-runtime.example/${agentId}`,
    auth: {
      type: "mock_internal_token",
      audience: `secret-audience-${agentId}`
    },
    skills: skillIds.map((skillId) => ({
      id: skillId,
      name: `${skillId} verification skill`,
      description: "skill-secret-description"
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
const safeRoutingView = read("services/orchestrator-api/src/interpretation/safeAgentRoutingView.ts");
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
  "agentSkillPairs: string[]",
  "agentRoutingViewHash: string",
  "agentRoutingViewCount: number",
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
requireIncludes(routingProof, "agentRoutingViews?: SafeAgentRoutingView[]", "AI routing proof accepts safe Agent Routing Views");
requireIncludes(routingProof, "safeAgentRoutingView(params.agentCards ?? [])", "AI routing proof derives safe routing view from Agent Cards when needed");
requireIncludes(routingProof, "agentSkillPairs", "AI routing proof binds agent-to-skill pairs");
requireIncludes(routingProof, "agentRoutingViewHash: sha256(stableStringify(agentRoutingViews))", "AI routing proof hashes safe Agent Routing Views");
requireIncludes(routingProof, "selectedAgentIds: routingDecision.selectedAgents.map", "AI routing proof uses selected agent IDs");
requireIncludes(routingProof, "skippedAgentIds: routingDecision.skippedAgents.map", "AI routing proof uses skipped agent IDs");
requireIncludes(routingProof, "interpretationProof?: OgenInterpretationProof", "AI routing proof accepts interpretation proof context");
requireIncludes(routingProof, "agentCards?: AgentCard[]", "AI routing proof accepts safe Agent Card context");
requireIncludes(routingProof, "authorizedRuntime: false", "AI routing proof never authorizes runtime");
requireNotIncludes(routingProof, "rawPrompt:", "AI routing proof does not return raw prompt");
requireNotIncludes(routingProof, "rawAiResponse:", "AI routing proof does not return raw AI response");

requireIncludes(safeRoutingView, "export type SafeAgentRoutingView", "safe Agent Routing View type exists");
requireIncludes(safeRoutingView, "export function safeAgentRoutingView", "safe Agent Routing View helper exists");
requireIncludes(safeRoutingView, "agentId: card.agentId", "safe Agent Routing View includes agent ID");
requireIncludes(safeRoutingView, "skillIds: skills.map", "safe Agent Routing View includes skill IDs");
requireNotIncludes(safeRoutingView, "endpoint", "safe Agent Routing View omits runtime endpoint");
requireNotIncludes(safeRoutingView, "auth", "safe Agent Routing View omits auth");
requireNotIncludes(safeRoutingView, "audience", "safe Agent Routing View omits audience");
requireNotIncludes(safeRoutingView, "issuer", "safe Agent Routing View omits issuer");
requireNotIncludes(safeRoutingView, "jwks", "safe Agent Routing View omits jwks");
requireNotIncludes(safeRoutingView, "description", "safe Agent Routing View omits descriptions");
requireNotIncludes(safeRoutingView, "headers", "safe Agent Routing View omits headers");
requireNotIncludes(safeRoutingView, "token", "safe Agent Routing View omits tokens");

requireIncludes(aiRouter, "routingProof: OgenAiRoutingProof", "routeWithAIWithProof returns routing proof");
requireIncludes(aiRouter, "const executableAgentCards = getExecutableAgentCards(cardsForContext(context));", "router derives one executable Agent Card set");
requireIncludes(aiRouter, "const agentRoutingViews = safeAgentRoutingView(executableAgentCards);", "router builds safe Agent Routing Views");
requireIncludes(aiRouter, "agentCards: executableAgentCards", "router passes safe Agent Cards into routing proof");
requireIncludes(aiRouter, "agentRoutingViews,", "router passes safe Agent Routing Views into routing proof");
requireIncludes(aiRouter, "interpretationProof,", "router passes interpretation proof into routing proof");
requireIncludes(aiRouter, "callOpenRouter(message, requestInterpretation, agentRoutingViews", "secondary AI router uses safe Agent Routing Views");
requireIncludes(aiRouter, "agentRoutingViews", "secondary AI router prompt uses safe Agent Routing Views");
requireNotIncludes(aiRouter, "content: JSON.stringify({\n          message,\n          requestInterpretation: interpretation,\n          agentCards", "secondary AI router prompt does not send full Agent Cards");
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
requireIncludes(backend, "agentSkillPairs: proof.safeInputContextSummary.agentSkillPairs", "AI routing audit includes agent-to-skill pairs");
requireIncludes(backend, "agentRoutingViewHash: proof.safeInputContextSummary.agentRoutingViewHash", "AI routing audit includes routing view hash");
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
  "agentSkillPairs: string[]",
  "agentRoutingViewHash: string",
  "agentRoutingViewCount: number",
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
  "aiRoutingAgentSkillPairs",
  "aiRoutingAgentRoutingViewHash",
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
  JSON.stringify(fallbackProof).includes("https://hidden-runtime.example") ||
  JSON.stringify(fallbackProof).includes("secret-audience") ||
  JSON.stringify(fallbackProof).includes("card-secret-description") ||
  JSON.stringify(fallbackProof).includes("skill-secret-description")
) {
  fail("rules fallback routing proof should be advisory and not contain raw input text or raw Agent Card material");
} else {
  ok("rules fallback routing proof is safe and advisory");
}

const unsafeCard = verificationAgentCard("unsafe-agent", ["unsafe.skill"]);
const safeView = safeAgentRoutingView([unsafeCard]);
const safeViewSerialized = JSON.stringify(safeView);
if (
  safeViewSerialized.includes("https://hidden-runtime.example") ||
  safeViewSerialized.includes("secret-audience") ||
  safeViewSerialized.includes("card-secret-description") ||
  safeViewSerialized.includes("skill-secret-description") ||
  safeView[0]?.agentId !== "unsafe-agent" ||
  safeView[0]?.skillIds.join(",") !== "unsafe.skill"
) {
  fail("safe Agent Routing View should remove endpoint/auth/descriptions while keeping routing IDs");
} else {
  ok("safe Agent Routing View removes non-routing Agent Card material");
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
  differentCardProof.safeInputContextSummary.agentCardSkillIds.join(",") !== "a.skill,m.skill,z.skill" ||
  differentCardProof.safeInputContextSummary.agentSkillPairs.join(",") !== "a-agent:m.skill,b-agent:a.skill,b-agent:z.skill" ||
  !differentCardProof.safeInputContextSummary.agentRoutingViewHash
) {
  fail("Agent Card IDs, skill IDs, skill pairs, and routing view hash should be sorted for stable input context hashing");
} else {
  ok("safe routing input context summary is sorted and stable");
}

const swappedContextA = createAiRoutingProof({
  inputText: sameMessage,
  routingDecision: baseRoutingDecision(),
  source: "rules_fallback",
  validationStatus: "not_required",
  interpretationProof: verificationInterpretationProof({ outputHash: "same-interpretation-output" }),
  agentCards: [verificationAgentCard("agent-a", ["skill-x"]), verificationAgentCard("agent-b", ["skill-y"])]
});
const swappedContextB = createAiRoutingProof({
  inputText: sameMessage,
  routingDecision: baseRoutingDecision(),
  source: "rules_fallback",
  validationStatus: "not_required",
  interpretationProof: verificationInterpretationProof({ outputHash: "same-interpretation-output" }),
  agentCards: [verificationAgentCard("agent-a", ["skill-y"]), verificationAgentCard("agent-b", ["skill-x"])]
});
if (
  swappedContextA.safeInputContextSummary.agentCardIds.join(",") !== swappedContextB.safeInputContextSummary.agentCardIds.join(",") ||
  swappedContextA.safeInputContextSummary.agentCardSkillIds.join(",") !== swappedContextB.safeInputContextSummary.agentCardSkillIds.join(",") ||
  swappedContextA.safeInputContextSummary.agentSkillPairs.join(",") === swappedContextB.safeInputContextSummary.agentSkillPairs.join(",") ||
  swappedContextA.inputContextHash === swappedContextB.inputContextHash
) {
  fail("same agent IDs and skill IDs with swapped mappings should change agentSkillPairs and inputContextHash");
} else {
  ok("routing proof binds agent-to-skill mappings");
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
  "Raw prompts and raw agent card text are not stored.",
  "Secondary AI routing receives a safe Agent Card routing view, not full Agent Cards.",
  "The safe view excludes endpoint/auth/description/secret-like metadata.",
  "Routing proof binds agent-to-skill mappings through agentSkillPairs.",
  "routing proof hashes the safe routing view."
]) {
  requireIncludes(platformDocs, phrase, "platform docs cover AI routing trust boundary");
}
requireIncludes(productIdentityDocs, "AI can suggest routing. Ogen validates and authorizes.", "product identity docs include AI routing trust principle");
requireIncludes(productIdentityDocs, "Ogen proves not only what AI suggested, but the safe context it was allowed to see.", "product identity docs include routing context proof principle");
requireIncludes(productIdentityDocs, "Ogen gives AI routing only the safe context it needs, then proves that context.", "product identity docs include safe routing context principle");

if (failed) {
  process.exitCode = 1;
} else {
  console.log("AI routing trust boundary verification passed.");
}
