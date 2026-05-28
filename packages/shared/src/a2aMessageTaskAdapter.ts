import type { A2AAgentResponse, A2ATask, AgentTask, Classification, ResolveRequest, ResolveResponse } from "./index.js";

export const OGEN_A2A_ADAPTER_SCHEMA_VERSION = "ogen.a2a.adapter.v1" as const;

// Compatibility subset only. This is not a full A2A Message/Task implementation.
export type OgenA2APartText =
  | {
      kind: "text";
      text: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "text";
      text: string;
      metadata?: Record<string, unknown>;
    };

// Compatibility subset only. Unsupported Message fields are ignored unless they carry protected material.
export type OgenA2AInboundMessageEnvelope = {
  kind: "message";
  role?: "user" | "agent";
  messageId?: string;
  taskId?: string;
  contextId?: string;
  parts: OgenA2APartText[];
  metadata?: Record<string, unknown>;
};

export type OgenA2ATaskState = "submitted" | "working" | "input-required" | "completed" | "failed" | "rejected";

// Compatibility subset only. The payload carries safe response text plus adapter proof, not internal authority.
export type OgenA2AOutboundTaskEnvelope = {
  kind: "task";
  id: string;
  contextId?: string;
  status: {
    state: OgenA2ATaskState;
    message?: {
      role: "user" | "agent";
      parts: OgenA2APartText[];
    };
  };
  artifacts?: Array<{
    artifactId: string;
    name: string;
    parts: OgenA2APartText[];
  }>;
  metadata: {
    adapterProof?: OgenA2AAdapterProof;
    taskExecuted?: boolean;
    protectedMaterialExposed?: false;
    tokenMaterialStored?: false;
    rawPromptStored?: false;
  };
};

export type OgenA2AAdapterProof = {
  schemaVersion: typeof OGEN_A2A_ADAPTER_SCHEMA_VERSION;
  compatibilitySubset: "a2a-message-task-envelope";
  direction:
    | "legacy_internal_passthrough"
    | "inbound_message_to_resolve_request"
    | "inbound_message_to_internal_task"
    | "internal_task_to_outbound_task"
    | "internal_response_to_outbound_task"
    | "outbound_task_to_internal_response"
    | "invalid_inbound_envelope";
  mappingRules: string[];
  textPartCount: number;
  firstTextPartUsed: boolean;
  metadataKeysAccepted: string[];
  correlation: {
    messageId?: string;
    taskId?: string;
    contextId?: string;
    conversationId?: string;
  };
  authority: {
    protocolMetadataAuthoritative: false;
    tenantAuthority: "verified_gateway_session";
    authorizationAuthority: "existing_a2a_jwt_or_gateway_session";
    policyAuthority: "existing_ogen_policy";
    auditAuthority: "existing_ogen_audit";
  };
  protectedMaterialExposed: false;
  tokenMaterialStored: false;
  rawPromptStored: false;
};

export type InvalidOgenA2AEnvelopeResponse = {
  error: "invalid_a2a_envelope";
  message: string;
  taskExecuted: false;
  protectedMaterialExposed: false;
  tokenMaterialStored: false;
  rawPromptStored: false;
  adapterProof: OgenA2AAdapterProof;
};

export type OgenA2AResolveNormalization =
  | {
      ok: true;
      value: ResolveRequest;
      requestedCompatibilityEnvelope: boolean;
      proof: OgenA2AAdapterProof;
    }
  | {
      ok: false;
      response: InvalidOgenA2AEnvelopeResponse;
    };

export type OgenA2ATaskNormalization =
  | {
      ok: true;
      value: A2ATask | AgentTask;
      requestedCompatibilityEnvelope: boolean;
      proof: OgenA2AAdapterProof;
    }
  | {
      ok: false;
      response: InvalidOgenA2AEnvelopeResponse;
    };

const SAFE_MESSAGE_METADATA_KEYS = new Set([
  "classification",
  "contextHints",
  "conversationId",
  "fromAgent",
  "mediatedBy",
  "messageId",
  "parentTaskId",
  "requestedByAgent",
  "requestedScope",
  "skillId",
  "taskId",
  "toAgent"
]);

const PROTECTED_METADATA_KEY_PATTERN =
  /authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|bearer|secret|password|cookie|client[_-]?assertion|private[_-]?key|raw[_-]?prompt|prompt/i;

const OGEN_A2A_TASK_STATES = new Set<OgenA2ATaskState>(["submitted", "working", "input-required", "completed", "failed", "rejected"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function optionalSourceSystem(value: unknown): "ServiceNow" | undefined {
  return value === "ServiceNow" ? "ServiceNow" : undefined;
}

function optionalReporterType(value: unknown): Classification["reporterType"] | undefined {
  return value === "end_user" || value === "it_engineer" || value === "unknown" ? value : undefined;
}

function optionalSupportMode(value: unknown): Classification["supportMode"] | undefined {
  return value === "end_user_support" || value === "technical_integration" ? value : undefined;
}

function optionalConfidence(value: unknown): Classification["confidence"] | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function optionalClassificationSource(value: unknown): Classification["classificationSource"] | undefined {
  return value === "ai" || value === "rules_fallback" ? value : undefined;
}

function optionalIssueType(value: unknown): Classification["issueType"] | undefined {
  return value === "AUTHENTICATION_FAILURE" ||
    value === "AUTHORIZATION_FAILURE" ||
    value === "RATE_LIMIT" ||
    value === "CONNECTIVITY_FAILURE" ||
    value === "WEBHOOK_FAILURE" ||
    value === "API_AVAILABILITY" ||
    value === "UNKNOWN"
    ? value
    : undefined;
}

function classificationFromMetadata(value: unknown): Classification | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const system = optionalString(record.system);
  const issueType = optionalIssueType(record.issueType);
  const confidence = optionalConfidence(record.confidence);
  const reasoningSummary = optionalString(record.reasoningSummary);
  const classificationSource = optionalClassificationSource(record.classificationSource);
  const reporterType = optionalReporterType(record.reporterType);
  const supportMode = optionalSupportMode(record.supportMode);

  if (!system || !issueType || !confidence || !reasoningSummary || !classificationSource || !reporterType || !supportMode) {
    return undefined;
  }

  return {
    system,
    errorCode: optionalString(record.errorCode),
    issueType,
    operation: optionalString(record.operation),
    confidence,
    reasoningSummary,
    classificationSource,
    aiProvider: record.aiProvider === "openrouter" ? "openrouter" : undefined,
    aiModel: optionalString(record.aiModel),
    reporterType,
    supportMode
  };
}

function fallbackClassification(contextHints?: Record<string, unknown>): Classification {
  return {
    system: optionalString(contextHints?.affectedSystem) ?? "Unknown",
    issueType: "UNKNOWN",
    confidence: "low",
    reasoningSummary: "A2A compatibility message omitted Ogen classification metadata; fallback classification is non-authoritative.",
    classificationSource: "rules_fallback",
    reporterType: optionalReporterType(contextHints?.reporterType) ?? "unknown",
    supportMode: optionalSupportMode(contextHints?.supportMode) ?? "technical_integration"
  };
}

function metadataKeysAccepted(metadata: Record<string, unknown> | undefined): string[] {
  return Object.keys(metadata ?? {})
    .filter((key) => SAFE_MESSAGE_METADATA_KEYS.has(key))
    .sort();
}

function protectedMetadataKey(value: unknown, depth = 0): string | undefined {
  if (depth > 4) {
    return undefined;
  }

  const record = asRecord(value);
  if (!record) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = protectedMetadataKey(item, depth + 1);
        if (nested) {
          return nested;
        }
      }
    }
    return undefined;
  }

  for (const [key, nestedValue] of Object.entries(record)) {
    if (PROTECTED_METADATA_KEY_PATTERN.test(key)) {
      return key;
    }
    const nested = protectedMetadataKey(nestedValue, depth + 1);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function envelopeKind(record: Record<string, unknown>): string | undefined {
  return optionalString(record.kind) ?? optionalString(record.type);
}

function looksLikeInboundEnvelope(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) {
    return false;
  }

  if (envelopeKind(record) === "message") {
    return true;
  }

  return Array.isArray(record.parts) && ("role" in record || "messageId" in record || "taskId" in record || "contextId" in record);
}

export function isOgenA2AInboundMessageEnvelope(value: unknown): value is OgenA2AInboundMessageEnvelope {
  const record = asRecord(value);
  return Boolean(record && envelopeKind(record) === "message" && Array.isArray(record.parts));
}

export function isOgenA2AOutboundTaskEnvelope(value: unknown): value is OgenA2AOutboundTaskEnvelope {
  return validateOgenA2AOutboundTaskEnvelope(value).ok;
}

function isTextPart(value: unknown): value is OgenA2APartText {
  const record = asRecord(value);
  return Boolean(record && (record.kind === "text" || record.type === "text") && typeof record.text === "string");
}

function isOgenA2ATaskState(value: unknown): value is OgenA2ATaskState {
  return typeof value === "string" && OGEN_A2A_TASK_STATES.has(value as OgenA2ATaskState);
}

function validateTextParts(value: unknown, context: string): { ok: true; parts: OgenA2APartText[] } | { ok: false; message: string } {
  if (!Array.isArray(value)) {
    return { ok: false, message: `${context} parts must be an array.` };
  }

  for (const part of value) {
    if (!isTextPart(part)) {
      return { ok: false, message: `${context} supports only text parts with kind/type "text" and string text.` };
    }
  }

  return { ok: true, parts: value };
}

function textParts(parts: unknown[]): OgenA2APartText[] {
  return parts.filter(isTextPart);
}

function firstTextPart(parts: unknown[]): OgenA2APartText | undefined {
  return textParts(parts).find((part) => part.text.trim().length > 0);
}

export function validateOgenA2AOutboundTaskEnvelope(value: unknown): { ok: true; value: OgenA2AOutboundTaskEnvelope } | { ok: false; response: InvalidOgenA2AEnvelopeResponse } {
  const record = asRecord(value);
  if (!record || envelopeKind(record) !== "task") {
    return { ok: false, response: buildInvalidA2AEnvelopeResponse("Body is not an A2A task envelope.") };
  }

  const status = asRecord(record.status);
  if (!status) {
    return { ok: false, response: buildInvalidA2AEnvelopeResponse("A2A compatibility task envelope requires a status object.") };
  }

  if (!isOgenA2ATaskState(status.state)) {
    return { ok: false, response: buildInvalidA2AEnvelopeResponse(`Unsupported A2A compatibility task state: ${String(status.state ?? "missing")}.`) };
  }

  const statusMessage = asRecord(status.message);
  if (status.message !== undefined) {
    if (!statusMessage) {
      return { ok: false, response: buildInvalidA2AEnvelopeResponse("A2A compatibility task status.message must be an object when present.") };
    }
    if (statusMessage.role !== "user" && statusMessage.role !== "agent") {
      return { ok: false, response: buildInvalidA2AEnvelopeResponse("A2A compatibility task status.message.role must be user or agent when present.") };
    }
    const partsValidation = validateTextParts(statusMessage.parts, "A2A compatibility task status.message");
    if (!partsValidation.ok) {
      return { ok: false, response: buildInvalidA2AEnvelopeResponse(partsValidation.message) };
    }
  }

  const metadata = asRecord(record.metadata);
  if (!metadata) {
    return { ok: false, response: buildInvalidA2AEnvelopeResponse("A2A compatibility task envelope requires a metadata object.") };
  }
  if (metadata.protectedMaterialExposed === true || metadata.tokenMaterialStored === true || metadata.rawPromptStored === true) {
    return { ok: false, response: buildInvalidA2AEnvelopeResponse("A2A compatibility task metadata reports protected material exposure.") };
  }

  if (record.artifacts !== undefined) {
    if (!Array.isArray(record.artifacts)) {
      return { ok: false, response: buildInvalidA2AEnvelopeResponse("A2A compatibility task artifacts must be an array when present.") };
    }
    for (const artifact of record.artifacts) {
      const artifactRecord = asRecord(artifact);
      if (!artifactRecord) {
        return { ok: false, response: buildInvalidA2AEnvelopeResponse("A2A compatibility task artifacts must be objects.") };
      }
      const partsValidation = validateTextParts(artifactRecord.parts, "A2A compatibility task artifact");
      if (!partsValidation.ok) {
        return { ok: false, response: buildInvalidA2AEnvelopeResponse(partsValidation.message) };
      }
    }
  }

  return { ok: true, value: value as OgenA2AOutboundTaskEnvelope };
}

function buildAdapterProof(params: {
  direction: OgenA2AAdapterProof["direction"];
  messageId?: string;
  taskId?: string;
  contextId?: string;
  conversationId?: string;
  textPartCount?: number;
  firstTextPartUsed?: boolean;
  metadataKeysAccepted?: string[];
  mappingRules?: string[];
}): OgenA2AAdapterProof {
  return {
    schemaVersion: OGEN_A2A_ADAPTER_SCHEMA_VERSION,
    compatibilitySubset: "a2a-message-task-envelope",
    direction: params.direction,
    mappingRules: params.mappingRules ?? [
      "first text part -> userMessage/message",
      "messageId/taskId/contextId -> safe correlation IDs only",
      "safe metadata keys -> internal context hints only",
      "protocol metadata is never tenant, role, policy, auth, or audit authority"
    ],
    textPartCount: params.textPartCount ?? 0,
    firstTextPartUsed: params.firstTextPartUsed ?? false,
    metadataKeysAccepted: params.metadataKeysAccepted ?? [],
    correlation: {
      messageId: params.messageId,
      taskId: params.taskId,
      contextId: params.contextId,
      conversationId: params.conversationId
    },
    authority: {
      protocolMetadataAuthoritative: false,
      tenantAuthority: "verified_gateway_session",
      authorizationAuthority: "existing_a2a_jwt_or_gateway_session",
      policyAuthority: "existing_ogen_policy",
      auditAuthority: "existing_ogen_audit"
    },
    protectedMaterialExposed: false,
    tokenMaterialStored: false,
    rawPromptStored: false
  };
}

function invalidProof(): OgenA2AAdapterProof {
  return buildAdapterProof({
    direction: "invalid_inbound_envelope",
    mappingRules: [
      "invalid envelope rejected before task execution",
      "no envelope metadata is promoted to tenant, role, policy, auth, or audit authority"
    ]
  });
}

export function buildInvalidA2AEnvelopeResponse(message: string, proof: OgenA2AAdapterProof = invalidProof()): InvalidOgenA2AEnvelopeResponse {
  return {
    error: "invalid_a2a_envelope",
    message,
    taskExecuted: false,
    protectedMaterialExposed: false,
    tokenMaterialStored: false,
    rawPromptStored: false,
    adapterProof: proof
  };
}

function normalizeInboundEnvelope(value: unknown): { ok: true; record: Record<string, unknown>; parts: unknown[]; metadata?: Record<string, unknown> } | { ok: false; response: InvalidOgenA2AEnvelopeResponse } {
  if (!looksLikeInboundEnvelope(value)) {
    return { ok: false, response: buildInvalidA2AEnvelopeResponse("Body is not an A2A message envelope.") };
  }

  const record = asRecord(value);
  if (!record || envelopeKind(record) !== "message") {
    return { ok: false, response: buildInvalidA2AEnvelopeResponse("A2A compatibility envelope must use kind: \"message\".") };
  }

  if (record.role !== undefined && record.role !== "user") {
    return { ok: false, response: buildInvalidA2AEnvelopeResponse("A2A compatibility envelope must use role: \"user\" for inbound execution.") };
  }

  if (!Array.isArray(record.parts)) {
    return { ok: false, response: buildInvalidA2AEnvelopeResponse("A2A compatibility envelope requires a parts array.") };
  }
  const partsValidation = validateTextParts(record.parts, "A2A compatibility envelope");
  if (!partsValidation.ok) {
    return { ok: false, response: buildInvalidA2AEnvelopeResponse(partsValidation.message) };
  }

  const metadata = asRecord(record.metadata);
  const protectedKey = protectedMetadataKey(record);
  if (protectedKey) {
    return { ok: false, response: buildInvalidA2AEnvelopeResponse(`A2A compatibility envelope metadata contains protected material key: ${protectedKey}.`) };
  }

  if (!firstTextPart(record.parts)) {
    return { ok: false, response: buildInvalidA2AEnvelopeResponse("A2A compatibility envelope requires a non-empty text part.") };
  }

  return { ok: true, record, parts: record.parts, metadata };
}

export function normalizeResolveRequestInput(value: unknown): OgenA2AResolveNormalization {
  if (!looksLikeInboundEnvelope(value)) {
    return {
      ok: true,
      value: value as ResolveRequest,
      requestedCompatibilityEnvelope: false,
      proof: buildAdapterProof({ direction: "legacy_internal_passthrough" })
    };
  }

  const normalized = normalizeInboundEnvelope(value);
  if (!normalized.ok) {
    return normalized;
  }

  const textPart = firstTextPart(normalized.parts)!;
  const textPartCount = textParts(normalized.parts).length;
  const messageId = optionalString(normalized.record.messageId);
  const taskId = optionalString(normalized.record.taskId) ?? optionalString(normalized.metadata?.taskId);
  const contextId = optionalString(normalized.record.contextId);
  const conversationId = contextId ?? optionalString(normalized.metadata?.conversationId);
  const proof = buildAdapterProof({
    direction: "inbound_message_to_resolve_request",
    messageId,
    taskId,
    contextId,
    conversationId,
    textPartCount,
    firstTextPartUsed: true,
    metadataKeysAccepted: metadataKeysAccepted(normalized.metadata)
  });

  return {
    ok: true,
    value: {
      message: textPart.text.trim(),
      conversationId
    },
    requestedCompatibilityEnvelope: true,
    proof
  };
}

export function normalizeA2ATaskInput(value: unknown, defaults: { toAgent: string; fromAgent?: string }): OgenA2ATaskNormalization {
  if (!looksLikeInboundEnvelope(value)) {
    return {
      ok: true,
      value: value as A2ATask | AgentTask,
      requestedCompatibilityEnvelope: false,
      proof: buildAdapterProof({ direction: "legacy_internal_passthrough" })
    };
  }

  const normalized = normalizeInboundEnvelope(value);
  if (!normalized.ok) {
    return normalized;
  }

  const textPart = firstTextPart(normalized.parts)!;
  const contextHints = asRecord(normalized.metadata?.contextHints);
  const classification = classificationFromMetadata(normalized.metadata?.classification) ?? fallbackClassification(contextHints);
  const messageId = optionalString(normalized.record.messageId);
  const taskId = optionalString(normalized.record.taskId) ?? optionalString(normalized.metadata?.taskId) ?? messageId ?? "a2a-compat-task";
  const contextId = optionalString(normalized.record.contextId);
  const conversationId = contextId ?? optionalString(normalized.metadata?.conversationId) ?? "a2a-compat-conversation";
  const fromAgent = optionalString(normalized.metadata?.fromAgent) ?? defaults.fromAgent ?? "a2a-compat-client";
  const toAgent = optionalString(normalized.metadata?.toAgent) ?? defaults.toAgent;
  const textPartCount = textParts(normalized.parts).length;
  const proof = buildAdapterProof({
    direction: "inbound_message_to_internal_task",
    messageId,
    taskId,
    contextId,
    conversationId,
    textPartCount,
    firstTextPartUsed: true,
    metadataKeysAccepted: metadataKeysAccepted(normalized.metadata)
  });

  return {
    ok: true,
    value: {
      taskId,
      conversationId,
      fromAgent,
      toAgent,
      mediatedBy: optionalString(normalized.metadata?.mediatedBy),
      delegationDepth: optionalNumber(normalized.metadata?.delegationDepth),
      parentTaskId: optionalString(normalized.metadata?.parentTaskId),
      requestedByAgent: optionalString(normalized.metadata?.requestedByAgent),
      skillId: optionalString(normalized.metadata?.skillId),
      userMessage: textPart.text.trim(),
      classification,
      context: {
        reporterType: optionalReporterType(contextHints?.reporterType) ?? classification.reporterType,
        supportMode: optionalSupportMode(contextHints?.supportMode) ?? classification.supportMode,
        sourceSystem: optionalSourceSystem(contextHints?.sourceSystem),
        affectedSystem: optionalString(contextHints?.affectedSystem) ?? classification.system,
        callerAgentId: fromAgent,
        targetAgentId: toAgent,
        requestedScope: optionalString(normalized.metadata?.requestedScope)
      }
    },
    requestedCompatibilityEnvelope: true,
    proof
  };
}

function textPart(text: string): OgenA2APartText {
  return { kind: "text", text };
}

export function internalA2ATaskToOutboundA2AEnvelope(task: A2ATask, proof?: OgenA2AAdapterProof): OgenA2AOutboundTaskEnvelope {
  const adapterProof =
    proof ??
    buildAdapterProof({
      direction: "internal_task_to_outbound_task",
      taskId: task.taskId,
      contextId: task.conversationId,
      conversationId: task.conversationId,
      textPartCount: 1,
      firstTextPartUsed: true
    });

  return {
    kind: "task",
    id: task.taskId,
    contextId: task.conversationId,
    status: {
      state: "submitted",
      message: {
        role: "user",
        parts: [textPart(task.userMessage)]
      }
    },
    metadata: {
      adapterProof,
      taskExecuted: false,
      protectedMaterialExposed: false,
      tokenMaterialStored: false,
      rawPromptStored: false
    }
  };
}

function taskStateFromAgentStatus(status: A2AAgentResponse["status"]): OgenA2ATaskState {
  if (status === "needs_more_info") {
    return "input-required";
  }
  if (status === "blocked" || status === "unsupported") {
    return "rejected";
  }
  if (status === "error") {
    return "failed";
  }
  return "completed";
}

function agentStatusFromTaskState(state: OgenA2ATaskState, taskExecuted: boolean): A2AAgentResponse["status"] {
  if (state === "input-required") {
    return "needs_more_info";
  }
  if (state === "failed") {
    return "error";
  }
  if (state === "rejected") {
    return taskExecuted ? "unsupported" : "blocked";
  }
  if (state === "submitted" || state === "working") {
    return "needs_more_info";
  }
  return taskExecuted ? "diagnosed" : "unsupported";
}

function taskExecutedForResponse(response: A2AAgentResponse | ResolveResponse): boolean {
  return "finalAnswer" in response ? true : response.status !== "blocked" && response.status !== "error";
}

export function internalA2AResponseToOutboundA2AEnvelope(
  response: A2AAgentResponse | ResolveResponse,
  proof: OgenA2AAdapterProof,
  correlation?: { taskId?: string; contextId?: string; agentId?: string }
): OgenA2AOutboundTaskEnvelope {
  const responseText = "finalAnswer" in response ? response.finalAnswer : response.summary;
  const taskId = correlation?.taskId ?? proof.correlation.taskId ?? proof.correlation.messageId ?? "a2a-compat-response";
  const contextId = correlation?.contextId ?? proof.correlation.contextId ?? proof.correlation.conversationId;
  const state = "finalAnswer" in response ? "completed" : taskStateFromAgentStatus(response.status);

  return {
    kind: "task",
    id: taskId,
    contextId,
    status: {
      state,
      message: {
        role: "agent",
        parts: [textPart(responseText)]
      }
    },
    metadata: {
      adapterProof: {
        ...proof,
        direction: "internal_response_to_outbound_task"
      },
      taskExecuted: taskExecutedForResponse(response),
      protectedMaterialExposed: false,
      tokenMaterialStored: false,
      rawPromptStored: false
    }
  };
}

export function outboundA2AEnvelopeToAgentResponse(agentId: string, envelope: OgenA2AOutboundTaskEnvelope): A2AAgentResponse {
  const messageParts = envelope.status.message?.parts ?? [];
  const summary = firstTextPart(messageParts)?.text.trim() || "A2A task envelope did not include a text response.";
  const taskExecuted = typeof envelope.metadata.taskExecuted === "boolean" ? envelope.metadata.taskExecuted : envelope.status.state === "completed";

  return {
    agentId,
    status: agentStatusFromTaskState(envelope.status.state, taskExecuted),
    summary,
    trace: [
      {
        agent: agentId,
        action: "a2a_message_task_adapter_response",
        detail: "Normalized A2A compatibility Task envelope into internal A2AAgentResponse.",
        timestamp: new Date().toISOString()
      }
    ]
  };
}
