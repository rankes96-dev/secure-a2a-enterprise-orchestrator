import { createHash, randomUUID } from "node:crypto";
import type { RoutingDecision } from "@a2a/shared";
import type { AgentCard } from "../agentCards.js";
import type { OgenInterpretationProof } from "./interpretationTypes.js";
import { OGEN_AI_ROUTING_SCHEMA_VERSION, type OgenAiRoutingProof, type OgenAiRoutingSafeInputContextSummary, type OgenAiRoutingSource, type OgenAiRoutingValidationStatus } from "./routingProofTypes.js";
import { safeAgentRoutingView, type SafeAgentRoutingView } from "./safeAgentRoutingView.js";

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

function sorted(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function safeInputContextSummary(params: {
  inputText: string;
  interpretationProof?: OgenInterpretationProof;
  agentCards?: AgentCard[];
  agentRoutingViews?: SafeAgentRoutingView[];
}): OgenAiRoutingSafeInputContextSummary {
  const messageHash = sha256(params.inputText);
  const agentRoutingViews = params.agentRoutingViews ?? safeAgentRoutingView(params.agentCards ?? []);
  const agentSkillPairs = sorted(agentRoutingViews.flatMap((view) => view.skillIds.map((skillId) => `${view.agentId}:${skillId}`)));

  return {
    messageHash,
    interpretationId: params.interpretationProof?.interpretationId,
    interpretationOutputHash: params.interpretationProof?.outputHash,
    interpretationSchemaVersion: params.interpretationProof?.schemaVersion,
    interpretationRisks: params.interpretationProof?.risks ? [...params.interpretationProof.risks] : undefined,
    agentCardIds: sorted(agentRoutingViews.map((view) => view.agentId)),
    agentCardSkillIds: sorted(agentRoutingViews.flatMap((view) => view.skillIds)),
    agentSkillPairs,
    agentRoutingViewHash: sha256(stableStringify(agentRoutingViews)),
    agentRoutingViewCount: agentRoutingViews.length,
    agentCardCount: agentRoutingViews.length
  };
}

export function createAiRoutingProof(params: {
  inputText: string;
  routingDecision: RoutingDecision;
  source: OgenAiRoutingSource;
  validationStatus: OgenAiRoutingValidationStatus;
  provider?: string;
  model?: string;
  interpretationProof?: OgenInterpretationProof;
  agentCards?: AgentCard[];
  agentRoutingViews?: SafeAgentRoutingView[];
}): OgenAiRoutingProof {
  const { inputText, routingDecision, source, validationStatus, provider, model } = params;
  const summary = safeRoutingSummary(routingDecision);
  const inputSummary = safeInputContextSummary({
    inputText,
    interpretationProof: params.interpretationProof,
    agentCards: params.agentCards,
    agentRoutingViews: params.agentRoutingViews
  });
  const inputContextHash = sha256(stableStringify(inputSummary));
  return {
    routingProofId: randomUUID(),
    schemaVersion: OGEN_AI_ROUTING_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    source,
    provider,
    model,
    inputHash: inputContextHash,
    messageHash: inputSummary.messageHash,
    inputContextHash,
    safeInputContextSummary: inputSummary,
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
