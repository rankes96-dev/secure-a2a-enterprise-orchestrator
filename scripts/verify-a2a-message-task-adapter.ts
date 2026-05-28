import { existsSync, readFileSync } from "node:fs";
import {
  internalA2AResponseToOutboundA2AEnvelope,
  normalizeA2ATaskInput,
  normalizeResolveRequestInput
} from "../packages/shared/src/a2aMessageTaskAdapter.js";

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

function requireBefore(source: string, first: string, second: string, context: string): void {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex > secondIndex) {
    fail(`${context} should contain ${first} before ${second}`);
    return;
  }
  ok(context);
}

function blockBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start < 0) {
    fail(`missing block start: ${startMarker}`);
    return "";
  }
  const end = source.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

function assert(condition: unknown, context: string): void {
  if (!condition) {
    fail(context);
    return;
  }
  ok(context);
}

const adapterPath = "packages/shared/src/a2aMessageTaskAdapter.ts";
const sharedIndexPath = "packages/shared/src/index.ts";
const orchestratorPath = "services/orchestrator-api/src/index.ts";
const runtimeAuthorizationPath = "services/orchestrator-api/src/runtimeAuthorization/runtimeAuthorizationEvaluator.ts";
const packageJsonPath = "package.json";
const v2PlanScriptPath = "scripts/verify-v2-plan.ts";
const v2DocsPath = "docs/v2-platform-foundation.md";
const sdkDocsPath = "docs/sdk-readiness-contracts.md";
const roadmapPath = "docs/orchestrator-agnostic-roadmap.md";

const adapter = read(adapterPath);
const sharedIndex = read(sharedIndexPath);
const orchestrator = read(orchestratorPath);
const runtimeAuthorization = read(runtimeAuthorizationPath);
const packageJsonText = read(packageJsonPath);
const v2PlanScript = read(v2PlanScriptPath);
const v2Docs = read(v2DocsPath);
const sdkDocs = read(sdkDocsPath);
const roadmap = read(roadmapPath);

for (const phrase of [
  "OgenA2AInboundMessageEnvelope",
  "OgenA2AOutboundTaskEnvelope",
  "OgenA2APartText",
  "OgenA2AAdapterProof",
  "normalizeResolveRequestInput",
  "normalizeA2ATaskInput",
  "internalA2ATaskToOutboundA2AEnvelope",
  "internalA2AResponseToOutboundA2AEnvelope",
  "outboundA2AEnvelopeToAgentResponse",
  "buildInvalidA2AEnvelopeResponse",
  "invalid_a2a_envelope",
  "Compatibility subset only. This is not a full A2A Message/Task implementation.",
  "protocolMetadataAuthoritative: false",
  "tenantAuthority: \"verified_gateway_session\"",
  "authorizationAuthority: \"existing_a2a_jwt_or_gateway_session\"",
  "policyAuthority: \"existing_ogen_policy\"",
  "auditAuthority: \"existing_ogen_audit\"",
  "protectedMaterialExposed: false",
  "tokenMaterialStored: false",
  "rawPromptStored: false",
  "PROTECTED_METADATA_KEY_PATTERN"
]) {
  requireIncludes(adapter, phrase, "shared A2A Message/Task adapter contract");
}

requireIncludes(sharedIndex, 'export * from "./a2aMessageTaskAdapter.js"', "shared index exports A2A Message/Task adapter");

for (const phrase of [
  "normalizeResolveRequestInput(requestBodyUnknown)",
  "validateResolveRequest(normalizedResolve.value)",
  "normalizedResolve.requestedCompatibilityEnvelope ? undefined : requestedTenantIdFromBody(requestBodyUnknown)",
  "internalA2AResponseToOutboundA2AEnvelope(resolveResult, normalizedResolve.proof",
  "isOgenA2AOutboundTaskEnvelope(response)",
  "outboundA2AEnvelopeToAgentResponse(agentId, response)",
  "postJson<AgentResponse | A2AAgentResponse | OgenA2AOutboundTaskEnvelope>"
]) {
  requireIncludes(orchestrator, phrase, "orchestrator wires adapter at protocol boundaries");
}
const resolveRoute = blockBetween(orchestrator, 'request.method !== "POST" || request.url !== "/resolve"', "});\n}");
requireBefore(resolveRoute, "normalizeResolveRequestInput(requestBodyUnknown)", "validateResolveRequest(normalizedResolve.value)", "/resolve normalizes envelope before request validation");
requireBefore(resolveRoute, "normalizeResolveRequestInput(requestBodyUnknown)", "tenantContextForRequest(", "/resolve rejects invalid envelope before tenant policy");
requireBefore(resolveRoute, "validateResolveRequest(normalizedResolve.value)", "await resolveIssue", "/resolve validates normalized body before execution");

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
  requireIncludes(source, "normalizeA2ATaskInput(await readJsonBody<unknown>(request), { toAgent: agentCard.agentId })", `${path} normalizes A2A compatibility envelope`);
  requireIncludes(source, "sendJson(response, 400, taskInput.response, request, { \"content-type\": A2A_CONTENT_TYPE });", `${path} rejects invalid envelope as protocol error`);
  requireIncludes(source, "internalA2AResponseToOutboundA2AEnvelope(result, taskInput.proof", `${path} wraps response envelope when requested`);
  requireIncludes(source, "sendTaskResult(response, request, taskInput, task, auth.response, auth.statusCode);", `${path} preserves auth checks before execution`);
  requireBefore(source, "normalizeA2ATaskInput(await readJsonBody<unknown>(request)", "requireA2AAuth({", `${path} normalizes before existing auth boundary`);
  requireBefore(source, "requireA2AAuth({", "sendTaskResult(response, request, taskInput, task, result", `${path} keeps task execution after auth boundary`);
}

for (const phrase of [
  "runtimeTokenIssued: false",
  "externalRuntimeCalled: false",
  "executed: false",
  "runtimeExecution"
]) {
  requireIncludes(runtimeAuthorization, phrase, "runtime authorization remains authorization-only");
}

const packageJson = JSON.parse(packageJsonText) as { scripts?: Record<string, string> };
if (packageJson.scripts?.["verify:a2a-message-task-adapter"] !== "tsx scripts/verify-a2a-message-task-adapter.ts") {
  fail("package.json missing verify:a2a-message-task-adapter script");
} else {
  ok("package.json includes verify:a2a-message-task-adapter");
}

const v2Verify = packageJson.scripts?.["verify:v2-plan"] ?? "";
if (!v2Verify.includes("verify:a2a-protocol-compatibility") || !v2Verify.includes("verify:a2a-message-task-adapter")) {
  fail("verify:v2-plan should include both A2A protocol and message/task adapter verifiers");
} else if (v2Verify.indexOf("verify:a2a-protocol-compatibility") > v2Verify.indexOf("verify:a2a-message-task-adapter")) {
  fail("verify:v2-plan should run verify:a2a-message-task-adapter after verify:a2a-protocol-compatibility");
} else {
  ok("verify:v2-plan includes adapter verifier after protocol verifier");
}

requireIncludes(v2PlanScript, "Phase 2.20b  A2A Message/Task Adapter", "V2 plan verifier requires Phase 2.20b docs");
requireIncludes(v2PlanScript, "verify:a2a-message-task-adapter", "V2 plan verifier requires adapter package script");
requireExcludes(packageJsonText, "@a2a-js/sdk", "Phase 2.20b does not adopt official A2A JS SDK");

for (const phrase of [
  "Phase 2.20b  A2A Message/Task Adapter",
  "narrow A2A Message/Task adapter layer only",
  "first non-empty text part maps deterministically",
  "Protocol metadata is never tenant, role, policy, authorization, or audit authority",
  "Malformed or unsupported compatibility envelopes return `invalid_a2a_envelope` with `taskExecuted: false`",
  "Full official Message/Task operations `list`, `get`, `cancel`, and `subscribe` are deferred"
]) {
  requireIncludes(v2Docs, phrase, "V2 docs cover A2A Message/Task adapter boundary");
}

for (const phrase of [
  "Phase 2.20b adds a narrow A2A Message/Task adapter subset",
  "maps the first text part to the internal message field",
  "Full official Message/Task operations `list`, `get`, `cancel`, and `subscribe` remain deferred",
  "Message/Task adapter metadata is not tenant, role, policy, authorization, or audit authority"
]) {
  requireIncludes(sdkDocs, phrase, "SDK readiness docs cover A2A Message/Task adapter contract");
}

for (const phrase of [
  "narrow A2A Message/Task adapter subset",
  "first text part to Ogen `A2ATask` input",
  "no full A2A provider operation set yet",
  "Message/Task `list`, `get`, `cancel`, and `subscribe` are deferred"
]) {
  requireIncludes(roadmap, phrase, "orchestrator-agnostic roadmap covers A2A Message/Task adapter scope");
}

const classification = {
  system: "GitHub",
  issueType: "RATE_LIMIT",
  confidence: "high",
  reasoningSummary: "Runtime verifier sample classification.",
  classificationSource: "rules_fallback",
  reporterType: "it_engineer",
  supportMode: "technical_integration",
  operation: "scan_repository"
};

const envelope = {
  kind: "message",
  role: "user",
  messageId: "message-1",
  taskId: "task-1",
  contextId: "conversation-1",
  parts: [
    { kind: "text", text: "  Diagnose the GitHub rate limit failure.  " },
    { kind: "text", text: "This second text part must not become the userMessage." }
  ],
  metadata: {
    classification,
    skillId: "github.diagnose_rate_limit",
    fromAgent: "external-orchestrator",
    toAgent: "github-agent",
    requestedScope: "github.rate_limit.read",
    conversationId: "ignored-because-contextId-wins",
    contextHints: { affectedSystem: "GitHub" },
    tenantId: "tenant-metadata-is-not-authority"
  }
};

const taskNormalization = normalizeA2ATaskInput(envelope, { toAgent: "github-agent" });
assert(taskNormalization.ok, "runtime adapter accepts valid inbound Message envelope");
if (taskNormalization.ok && "userMessage" in taskNormalization.value) {
  assert(taskNormalization.value.userMessage === "Diagnose the GitHub rate limit failure.", "runtime adapter maps first text part to userMessage deterministically");
  assert(taskNormalization.value.conversationId === "conversation-1", "runtime adapter preserves contextId as conversation correlation");
  assert(taskNormalization.value.taskId === "task-1", "runtime adapter preserves taskId as task correlation");
  assert(taskNormalization.value.skillId === "github.diagnose_rate_limit", "runtime adapter maps safe skillId metadata");
  assert(taskNormalization.value.context.targetAgentId === "github-agent", "runtime adapter maps target agent as context hint");
  assert(!("tenantId" in taskNormalization.value.context), "runtime adapter does not map tenant metadata into task context");
  assert(!taskNormalization.value.context.actor, "runtime adapter does not map actor authority from protocol metadata");
  assert(!taskNormalization.value.context.auth, "runtime adapter does not map auth authority from protocol metadata");
  assert(taskNormalization.proof.authority.protocolMetadataAuthoritative === false, "runtime adapter proof marks protocol metadata non-authoritative");
  assert(taskNormalization.proof.protectedMaterialExposed === false, "runtime adapter proof does not expose protected material");
}

const resolveNormalization = normalizeResolveRequestInput({
  kind: "message",
  role: "user",
  contextId: "resolve-conversation",
  parts: [{ type: "text", text: "  Help with Jira permissions.  " }],
  metadata: { tenantId: "ignored", conversationId: "fallback-conversation" }
});
assert(resolveNormalization.ok, "runtime adapter accepts /resolve Message envelope");
if (resolveNormalization.ok) {
  assert(resolveNormalization.value.message === "Help with Jira permissions.", "runtime adapter maps first text part to /resolve message");
  assert(resolveNormalization.value.conversationId === "resolve-conversation", "runtime adapter maps contextId to /resolve conversationId");
}

const invalidEnvelope = normalizeA2ATaskInput({ kind: "message", role: "user", parts: [] }, { toAgent: "github-agent" });
assert(!invalidEnvelope.ok, "runtime adapter rejects malformed envelope without text part");
if (!invalidEnvelope.ok) {
  assert(invalidEnvelope.response.error === "invalid_a2a_envelope", "malformed envelope returns safe protocol error");
  assert(invalidEnvelope.response.taskExecuted === false, "malformed envelope has taskExecuted false");
}

const secretValue = "super-secret-token-value";
const protectedEnvelope = normalizeA2ATaskInput(
  {
    ...envelope,
    metadata: {
      ...envelope.metadata,
      accessToken: secretValue
    }
  },
  { toAgent: "github-agent" }
);
assert(!protectedEnvelope.ok, "runtime adapter rejects envelope metadata with protected key");
if (!protectedEnvelope.ok) {
  assert(!JSON.stringify(protectedEnvelope.response).includes(secretValue), "invalid envelope response does not leak protected metadata value");
}

if (taskNormalization.ok) {
  const outbound = internalA2AResponseToOutboundA2AEnvelope(
    {
      agentId: "github-agent",
      status: "diagnosed",
      summary: "GitHub rate limit diagnosis completed.",
      evidence: [{ title: "sensitive evidence", data: { accessToken: secretValue } }]
    },
    taskNormalization.proof,
    { taskId: "task-1", contextId: "conversation-1", agentId: "github-agent" }
  );
  assert(outbound.kind === "task", "runtime adapter maps internal response to outbound Task envelope");
  assert(outbound.status.message?.parts[0]?.text === "GitHub rate limit diagnosis completed.", "runtime adapter maps response summary to outbound text part");
  assert(!JSON.stringify(outbound).includes(secretValue), "outbound Task envelope does not leak protected evidence data");
  assert(outbound.metadata.adapterProof.authority.protocolMetadataAuthoritative === false, "outbound Task proof preserves non-authoritative protocol metadata");
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("A2A Message/Task adapter verification passed.");
}
