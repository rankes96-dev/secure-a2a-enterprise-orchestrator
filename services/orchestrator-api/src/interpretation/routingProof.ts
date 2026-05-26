import { createHash, randomUUID } from "node:crypto";
import type { RoutingDecision } from "@a2a/shared";
import { OGEN_AI_ROUTING_SCHEMA_VERSION, type OgenAiRoutingProof, type OgenAiRoutingSource, type OgenAiRoutingValidationStatus } from "./routingProofTypes.js";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }

  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeRoutingSummary(routingDecision: RoutingDecision): Record<string, unknown> {
  return {
    selectedAgentIds: routingDecision.selectedAgents.map((agent) => agent.agentId),
    skippedAgentIds: routingDecision.skippedAgents.map((agent) => agent.agentId),
    resolutionStatus: routingDecision.resolutionStatus,
    routingConfidence: routingDecision.routingConfidence,
    routingSource: routingDecision.routingSource
  };
}

export function createAiRoutingProof(params: {
  inputText: string;
  routingDecision: RoutingDecision;
  source: OgenAiRoutingSource;
  validationStatus: OgenAiRoutingValidationStatus;
  provider?: string;
  model?: string;
}): OgenAiRoutingProof {
  const { inputText, routingDecision, source, validationStatus, provider, model } = params;
  const summary = safeRoutingSummary(routingDecision);
  return {
    routingProofId: randomUUID(),
    schemaVersion: OGEN_AI_ROUTING_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    source,
    provider,
    model,
    inputHash: sha256(inputText),
    outputHash: sha256(stableStringify(summary)),
    validationStatus,
    selectedAgentIds: routingDecision.selectedAgents.map((agent) => agent.agentId),
    skippedAgentIds: routingDecision.skippedAgents.map((agent) => agent.agentId),
    resolutionStatus: routingDecision.resolutionStatus,
    routingConfidence: routingDecision.routingConfidence,
    advisoryOnly: true,
    rawPromptStored: false,
    rawAiResponseStored: false,
    authorizedRuntime: false
  };
}
