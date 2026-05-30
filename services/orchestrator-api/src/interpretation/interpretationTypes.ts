import type { RequestScope } from "@a2a/shared";

export const OGEN_INTERPRETATION_SCHEMA_VERSION = "ogen.interpretation.v1";

export type OgenInterpretationRisk =
  | "none"
  | "low_confidence"
  | "prompt_injection_attempt"
  | "secret_or_token_request"
  | "policy_bypass_attempt"
  | "privilege_escalation_attempt"
  | "false_authority_attempt"
  | "unsupported_scope";

export type OgenInterpretationProof = {
  interpretationId: string;
  schemaVersion: string;
  createdAt: string;
  source: "ai" | "fallback";
  provider?: string;
  model?: string;
  inputHash: string;
  outputHash: string;
  confidence: "low" | "medium" | "high";
  risks: OgenInterpretationRisk[];
  advisoryOnly: true;
  rawPromptStored: false;
  rawAiResponseStored: false;
  originalInterpretationScope?: RequestScope;
  reconciledScope?: RequestScope;
  reconciliationSource?: "connector_route";
  reconciliationReason?: string;
};
