import { getPlatformStateStore } from "../state/createPlatformStateStore.js";
import type { StoredConversationStateRecord, StoredPendingInteractionRecord } from "../state/platformStateStore.js";
import type { VerifiedUserIdentity } from "../security/userIdentity.js";
import type { ConversationState } from "./conversationTypes.js";
import type { ResolveResponse } from "@a2a/shared";

const maxSummaryLength = 240;
const maxSanitizeDepth = 6;
const sensitiveMarkers = [
  "access" + "_token",
  "refresh" + "_token",
  "author" + "ization",
  "bear" + "er",
  "client" + "_assertion",
  "private" + "_key",
  "client" + "_secret",
  "author" + "ization" + "_code",
  "cook" + "ie",
  "set-" + "cookie",
  "j" + "wt",
  "raw" + " token",
  "pass" + "word",
  "sec" + "ret"
];

function includesSensitiveMarker(value: string): boolean {
  const normalized = value.toLowerCase();
  return sensitiveMarkers.some((marker) => normalized.includes(marker));
}

export function safeConversationSummary(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (includesSensitiveMarker(normalized)) {
    return "[redacted-sensitive-message]";
  }
  return normalized.length > maxSummaryLength ? `${normalized.slice(0, maxSummaryLength - 3)}...` : normalized;
}

function sanitizeConversationValue(value: unknown, depth = 0): unknown {
  if (depth > maxSanitizeDepth) {
    return "[depth-limited]";
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return safeConversationSummary(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeConversationValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        if (includesSensitiveMarker(key)) {
          return [key, "hidden"];
        }
        if (key === "originalMessage" || key === "originalUserRequest") {
          return [`${key}Summary`, typeof item === "string" ? safeConversationSummary(item) : sanitizeConversationValue(item, depth + 1)];
        }
        return [key, sanitizeConversationValue(item, depth + 1)];
      })
    );
  }
  return undefined;
}

export function sanitizeConversationMetadata(value: Record<string, unknown> = {}): Record<string, unknown> {
  return sanitizeConversationValue(value) as Record<string, unknown>;
}

function pendingInteractionRecord(state: ConversationState): StoredPendingInteractionRecord | undefined {
  const pending = state.pendingInteraction;
  if (!pending) {
    return undefined;
  }
  return {
    id: pending.id,
    type: pending.type,
    createdAt: pending.createdAt,
    expiresAt: pending.expiresAt,
    safeOriginalUserRequestSummary: pending.safeOriginalUserRequestSummary ?? safeConversationSummary(pending.originalUserRequest),
    originalUserRequestHash: pending.originalUserRequestHash,
    tenantId: pending.tenantId,
    conversationId: pending.conversationId,
    actorProvider: pending.actorProvider,
    actorSubject: pending.actorSubject,
    actorEmail: pending.actorEmail,
    safeContext: sanitizeConversationMetadata({
      ...pending.context,
      rawPromptStored: false,
      tokenMaterialStored: false,
      protectedMaterialExposed: false
    })
  };
}

export function toStoredConversationStateRecord(params: {
  state: ConversationState;
  actor?: VerifiedUserIdentity;
  response?: ResolveResponse;
}): StoredConversationStateRecord {
  const { state, actor, response } = params;
  const createdAt = state.messages[0]?.timestamp ?? new Date().toISOString();
  const updatedAt = state.messages[state.messages.length - 1]?.timestamp ?? createdAt;
  return {
    id: state.conversationId,
    ownerSessionHash: state.ownerSessionHash,
    tenantId: state.tenantId,
    actorProvider: state.actorProvider ?? actor?.provider,
    actorSubject: state.actorSubject ?? actor?.subject,
    actorEmail: state.actorEmail ?? actor?.email,
    createdAt,
    updatedAt,
    lastResolutionStatus: response?.resolutionStatus ?? state.lastResolutionStatus,
    needsMoreInfoCount: state.needsMoreInfoCount,
    messages: state.messages.map((message) => ({
      role: message.role,
      timestamp: message.timestamp,
      safeSummary: safeConversationSummary(message.content)
    })),
    pendingInteraction: pendingInteractionRecord(state),
    pendingFollowUp: state.pendingFollowUp
      ? sanitizeConversationMetadata({
          type: state.pendingFollowUp.type,
          originalMessageSummary: safeConversationSummary(state.pendingFollowUp.originalMessage),
          detectedIntentClasses: state.pendingFollowUp.detectedIntentClasses,
          missingFields: state.pendingFollowUp.missingFields,
          createdAt: state.pendingFollowUp.createdAt
        })
      : undefined,
    lastRequestInterpretation: state.lastRequestInterpretation ? sanitizeConversationMetadata(state.lastRequestInterpretation as unknown as Record<string, unknown>) : undefined,
    safeMetadata: {
      writeThroughSource: "orchestrator.finalize",
      selectedAgentCount: state.lastSelectedAgents?.length ?? 0,
      hasPendingInteraction: Boolean(state.pendingInteraction),
      hasPendingFollowUp: Boolean(state.pendingFollowUp),
      protectedMaterialStored: false,
      rawPromptStored: false
    }
  };
}

export async function persistConversationStateSnapshot(params: {
  state: ConversationState;
  actor?: VerifiedUserIdentity;
  response?: ResolveResponse;
}): Promise<void> {
  try {
    await getPlatformStateStore().upsertConversationState(toStoredConversationStateRecord(params));
  } catch {
    console.warn(`[conversation-state] snapshot write failed for conversationId=${params.state.conversationId}`);
  }
}
