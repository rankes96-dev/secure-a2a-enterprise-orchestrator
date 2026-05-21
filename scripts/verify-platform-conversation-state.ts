import { existsSync, readFileSync } from "node:fs";
import { InMemoryPlatformStateStore } from "../services/orchestrator-api/src/state/inMemoryPlatformStateStore.js";
import { safeConversationSummary, sanitizeConversationMetadata, toStoredConversationStateRecord } from "../services/orchestrator-api/src/conversation/conversationStateStore.js";
import type { StoredConversationStateRecord } from "../services/orchestrator-api/src/state/platformStateStore.js";
import type { ConversationState } from "../services/orchestrator-api/src/conversation/conversationTypes.js";

let failed = false;

function fail(message: string): void {
  console.error(`fail - ${message}`);
  failed = true;
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
  }
}

function requireExcludes(source: string, phrase: string, context: string): void {
  if (source.includes(phrase)) {
    fail(`${context} should not include forbidden phrase: ${phrase}`);
  }
}

async function verifyInMemoryConversationCopies(): Promise<void> {
  const store = new InMemoryPlatformStateStore();
  const record: StoredConversationStateRecord = {
    id: "conversation-1",
    actorSubject: "user-1",
    createdAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:00:01.000Z",
    lastResolutionStatus: "needs_more_info",
    needsMoreInfoCount: 1,
    messages: [
      {
        role: "user",
        timestamp: "2026-05-21T00:00:00.000Z",
        safeSummary: "Need access to Jira"
      }
    ],
    pendingInteraction: {
      id: "pending-1",
      type: "target_selection",
      createdAt: "2026-05-21T00:00:00.000Z",
      safeOriginalUserRequestSummary: "Need access",
      safeContext: {
        nested: {
          systems: ["jira"]
        }
      }
    },
    safeMetadata: {
      nested: {
        source: "verify"
      }
    }
  };

  await store.upsertConversationState(record);
  const firstRead = await store.getConversationState("conversation-1");
  const firstNested = firstRead?.safeMetadata.nested as { source?: string } | undefined;
  if (firstNested) {
    firstNested.source = "mutated";
  }
  const firstPendingContext = firstRead?.pendingInteraction?.safeContext.nested as { systems?: string[] } | undefined;
  firstPendingContext?.systems?.push("mutated");

  const secondRead = await store.getConversationState("conversation-1");
  const secondNested = secondRead?.safeMetadata.nested as { source?: string } | undefined;
  const secondPendingContext = secondRead?.pendingInteraction?.safeContext.nested as { systems?: string[] } | undefined;
  if (secondNested?.source === "mutated") {
    fail("conversation safeMetadata should be deep-cloned on read");
  }
  if (secondPendingContext?.systems?.includes("mutated")) {
    fail("pending interaction safeContext should be deep-cloned on read");
  }

  const listed = await store.listConversationStates({ actorSubject: "user-1", limit: 1 });
  if (listed.length !== 1 || listed[0]?.id !== "conversation-1") {
    fail("listConversationStates should return stored conversation snapshots");
  }
}

function verifySanitizer(): void {
  const dangerousMessage = `Please use ${"Authorization"}: ${"Bearer"} abc and access_token=abc with client_secret=abc`;
  const summary = safeConversationSummary(dangerousMessage);
  if (summary.includes("abc") || summary !== "[redacted-sensitive-message]") {
    fail("safeConversationSummary should redact token-looking message content");
  }

  const state: ConversationState = {
    conversationId: "conversation-2",
    messages: [
      {
        role: "user",
        content: dangerousMessage,
        timestamp: "2026-05-21T00:00:00.000Z"
      }
    ],
    needsMoreInfoCount: 0,
    pendingInteraction: {
      id: "pending-2",
      type: "target_selection",
      originalUserRequest: dangerousMessage,
      createdAt: "2026-05-21T00:00:00.000Z",
      context: {
        note: dangerousMessage
      }
    }
  };
  const stored = toStoredConversationStateRecord({ state });
  const serialized = JSON.stringify(stored);
  if (serialized.includes("abc") || serialized.includes("client_secret") || serialized.includes("access_token")) {
    fail("stored conversation snapshot should not contain raw sensitive prompt material");
  }
  if (stored.messages[0]?.safeSummary !== "[redacted-sensitive-message]") {
    fail("stored conversation messages should use safe summaries");
  }
  if (stored.pendingInteraction?.safeOriginalUserRequestSummary !== "[redacted-sensitive-message]") {
    fail("pending interaction should store safeOriginalUserRequestSummary");
  }

  const sanitized = sanitizeConversationMetadata({
    originalMessage: dangerousMessage,
    context: {
      Authorization: "Bearer abc"
    }
  });
  if (JSON.stringify(sanitized).includes("abc")) {
    fail("sanitizeConversationMetadata should redact nested token-looking content");
  }
  if (!Object.prototype.hasOwnProperty.call(sanitized, "originalMessageSummary")) {
    fail("sanitizeConversationMetadata should replace originalMessage with originalMessageSummary");
  }
}

const platformStateStore = read("services/orchestrator-api/src/state/platformStateStore.ts");
const inMemoryStore = read("services/orchestrator-api/src/state/inMemoryPlatformStateStore.ts");
const conversationStore = read("services/orchestrator-api/src/conversation/conversationStateStore.ts");
const conversationTypes = read("services/orchestrator-api/src/conversation/conversationTypes.ts");
const orchestrator = read("services/orchestrator-api/src/index.ts");
const packageJson = read("package.json");
const plan = read("docs/v2-platform-foundation.md");
const inventory = read("docs/v2-state-inventory.md");
const parsedPackageJson = JSON.parse(packageJson) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

for (const phrase of [
  "StoredConversationStateRecord",
  "StoredPendingInteractionRecord",
  "StoredConversationMessage",
  "upsertConversationState",
  "getConversationState",
  "listConversationStates"
]) {
  requireIncludes(platformStateStore, phrase, "platform state store conversation boundary");
}

for (const phrase of [
  "conversationStates = new Map<string, StoredConversationStateRecord>",
  "copyConversationState",
  "upsertConversationState",
  "getConversationState",
  "listConversationStates",
  "updatedAt.localeCompare"
]) {
  requireIncludes(inMemoryStore, phrase, "in-memory conversation state store");
}

for (const phrase of [
  "ConversationState",
  "pendingInteraction?: PendingInteraction",
  "pendingFollowUp?: PendingFollowUpContext"
]) {
  requireIncludes(conversationTypes, phrase, "conversation state type module");
}

for (const phrase of [
  "getPlatformStateStore",
  "toStoredConversationStateRecord",
  "persistConversationStateSnapshot",
  "safeConversationSummary",
  "sanitizeConversationMetadata",
  "safeOriginalUserRequestSummary",
  "originalMessageSummary",
  "rawPromptStored: false",
  "protectedMaterialStored: false",
  "upsertConversationState"
]) {
  requireIncludes(conversationStore, phrase, "conversation snapshot write-through helper");
}

for (const forbidden of [
  "originalUserRequest: pending.originalUserRequest",
  "originalMessage: state.pendingFollowUp.originalMessage",
  "safeSummary: message.content",
  "content: message.content"
]) {
  requireExcludes(conversationStore, forbidden, "conversation snapshot helper");
}

for (const forbidden of ["access_token", "refresh_token", "Authorization", "Bearer", "private_key", "client_secret", "client_assertion", "authorization_code", "set-cookie"]) {
  requireExcludes(conversationStore, forbidden, "conversation snapshot helper source");
}

for (const phrase of [
  "persistConversationStateSnapshot",
  "void persistConversationStateSnapshot({",
  "updateConversationState(conversationState, finalResponse, mergedIncidentContext)"
]) {
  requireIncludes(orchestrator, phrase, "orchestrator conversation snapshot write-through");
}

for (const phrase of [
  '"verify:platform-conversation-state": "tsx scripts/verify-platform-conversation-state.ts"',
  "verify:platform-conversation-state"
]) {
  requireIncludes(packageJson, phrase, "package scripts");
}

if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:platform-conversation-state")) {
  fail("verify:v2-plan should include verify:platform-conversation-state");
}

for (const phrase of [
  "Phase 2.3: define conversation and pending-interaction state boundary",
  "Phase 2.3: write safe conversation snapshots through `PlatformStateStore`",
  "Phase 2.3: keep existing in-memory read path active",
  "Phase 2.3: do not persist raw prompts or token-looking content",
  "Phase 2.3: memory driver remains active; restart survival is future Postgres work"
]) {
  requireIncludes(plan, phrase, "V2 platform foundation docs");
}

for (const phrase of [
  "Phase 2.3 starts write-through of safe snapshots to `PlatformStateStore`",
  "Current runtime read path still uses in-memory conversation state",
  "Raw conversation text is not persisted; safe summaries are stored instead",
  "Pending interaction context is sanitized before storage"
]) {
  requireIncludes(inventory, phrase, "V2 state inventory");
}

const dependencyNames = Object.keys({
  ...(parsedPackageJson.dependencies ?? {}),
  ...(parsedPackageJson.devDependencies ?? {})
});
for (const forbidden of ["prisma", "drizzle", "pg", "postgres"]) {
  if (dependencyNames.some((name) => name.toLowerCase().includes(forbidden))) {
    fail(`Phase 2.3 should not introduce DB dependency: ${forbidden}`);
  }
}

async function main(): Promise<void> {
  await verifyInMemoryConversationCopies();
  verifySanitizer();

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log("Platform conversation state verification passed.");
  }
}

void main();
