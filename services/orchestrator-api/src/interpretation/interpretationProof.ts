import { createHash, randomUUID } from "node:crypto";
import type { RequestInterpretation, RequestScope } from "@a2a/shared";
import { OGEN_INTERPRETATION_SCHEMA_VERSION, type OgenInterpretationProof, type OgenInterpretationRisk } from "./interpretationTypes.js";

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

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function interpretationRisks(inputText: string, normalizedInterpretation: RequestInterpretation): OgenInterpretationRisk[] {
  const risks = new Set<OgenInterpretationRisk>();
  const message = inputText.toLowerCase();
  const capability = normalizedInterpretation.requestedCapability?.toLowerCase() ?? "";

  if (normalizedInterpretation.confidence === "low") {
    risks.add("low_confidence");
  }

  if (
    normalizedInterpretation.intentType === "security_sensitive_action" ||
    includesAny(capability, ["token", "secret", "credential"])
  ) {
    risks.add("secret_or_token_request");
  }

  if (includesAny(message, ["ignore policy", "bypass policy", "do not block", "override rules", "route this as harmless"])) {
    risks.add("policy_bypass_attempt");
  }

  if (includesAny(message, ["pretend you are allowed", "ignore rules"])) {
    risks.add("prompt_injection_attempt");
  }

  if (includesAny(message, ["grant me admin", "make me admin", "use admin permissions", "admin without approval", "root permissions", "superuser permissions"])) {
    risks.add("privilege_escalation_attempt");
  }

  if (includesAny(message, ["pretend approved", "pretend allowed", "pretend trusted", "pretend the connector is approved", "pretend the policy is allowed"])) {
    risks.add("false_authority_attempt");
  }

  if (normalizedInterpretation.scope === "out_of_scope") {
    risks.add("unsupported_scope");
  }

  return risks.size > 0 ? [...risks] : ["none"];
}

export function createInterpretationProof(params: {
  inputText: string;
  normalizedInterpretation: RequestInterpretation;
  interpretationId?: string;
  reconciliation?: {
    originalInterpretationScope: RequestScope;
    reconciledScope: RequestScope;
    reconciliationSource: "connector_route";
    reconciliationReason: string;
  };
}): OgenInterpretationProof {
  const { inputText, normalizedInterpretation } = params;
  return {
    interpretationId: params.interpretationId ?? randomUUID(),
    schemaVersion: OGEN_INTERPRETATION_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    source: normalizedInterpretation.interpretationSource ?? "fallback",
    provider: normalizedInterpretation.aiProvider,
    model: normalizedInterpretation.aiModel,
    inputHash: sha256(inputText),
    outputHash: sha256(stableStringify(normalizedInterpretation)),
    confidence: normalizedInterpretation.confidence,
    risks: interpretationRisks(inputText, normalizedInterpretation),
    advisoryOnly: true,
    rawPromptStored: false,
    rawAiResponseStored: false,
    originalInterpretationScope: params.reconciliation?.originalInterpretationScope,
    reconciledScope: params.reconciliation?.reconciledScope,
    reconciliationSource: params.reconciliation?.reconciliationSource,
    reconciliationReason: params.reconciliation?.reconciliationReason
  };
}
