export const OGEN_AI_ROUTING_SCHEMA_VERSION = "ogen.ai-routing.v1";

export type OgenAiRoutingSource =
  | "rules_fallback"
  | "secondary_ai";

export type OgenAiRoutingValidationStatus =
  | "not_required"
  | "passed"
  | "failed"
  | "empty_response"
  | "ai_error"
  | "not_configured";

export type OgenAiRoutingProof = {
  routingProofId: string;
  schemaVersion: string;
  createdAt: string;
  source: OgenAiRoutingSource;
  provider?: string;
  model?: string;
  inputHash: string;
  outputHash: string;
  validationStatus: OgenAiRoutingValidationStatus;
  selectedAgentIds: string[];
  skippedAgentIds: string[];
  resolutionStatus?: string;
  routingConfidence?: string;
  advisoryOnly: true;
  rawPromptStored: false;
  rawAiResponseStored: false;
  authorizedRuntime: false;
};
