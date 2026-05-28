import { createHash } from "node:crypto";

export const OGEN_AGENT_CARD_PROVENANCE_SCHEMA_VERSION = "ogen.agent-card.provenance.v1" as const;
export const OGEN_AGENT_CARD_CANONICALIZATION = "json-stable-sha256-v1" as const;

export const OGEN_AGENT_CARD_VERIFICATION_STATUSES = [
  "verified",
  "unverified",
  "expired",
  "invalid",
  "error",
  "not_configured"
] as const;

export type OgenAgentCardVerificationStatus = typeof OGEN_AGENT_CARD_VERIFICATION_STATUSES[number];

// Safe signature metadata only. JWS bytes and key material are verification inputs, not public provenance output.
export type OgenAgentCardSignature = {
  issuer?: string;
  kid?: string;
  alg?: string;
  signedAt?: string;
  expiresAt?: string;
  signaturePresent: boolean;
};

export type OgenAgentCardProvenance = {
  schemaVersion: typeof OGEN_AGENT_CARD_PROVENANCE_SCHEMA_VERSION;
  issuer?: string;
  kid?: string;
  alg?: string;
  signedAt?: string;
  expiresAt?: string;
  verificationStatus: OgenAgentCardVerificationStatus;
  verificationReason: string;
  signaturePresent: boolean;
  payloadHash: string;
  canonicalization: typeof OGEN_AGENT_CARD_CANONICALIZATION;
  authority: {
    informationalOnly: true;
    tenantAuthority: "verified_gateway_session";
    authorizationAuthority: "existing_a2a_jwt_or_gateway_session";
    policyAuthority: "existing_ogen_policy";
    auditAuthority: "existing_ogen_audit";
  };
  protectedMaterialExposed: false;
  tokenMaterialStored: false;
  privateKeyMaterialExposed: false;
  rawPromptStored: false;
};

export type OgenAgentCardSignatureVerifierResult = {
  valid: boolean;
  reason: string;
  issuer?: string;
  kid?: string;
  alg?: string;
  signedAt?: string;
  expiresAt?: string;
};

export type OgenAgentCardSignatureVerifier = (input: {
  agentCard: unknown;
  canonicalPayload: string;
  payloadHash: string;
  signature: OgenAgentCardSignature;
}) => Promise<OgenAgentCardSignatureVerifierResult> | OgenAgentCardSignatureVerifierResult;

const REDACTED_VERIFICATION_REASON = "redacted_verification_reason" as const;
const PROTECTED_REASON_PATTERN =
  /\b(?:access[\s_-]*token|refresh[\s_-]*token|id[\s_-]*token|client[\s_-]*assertion|client[\s_-]*secret|authorization[\s_-]*code|private[\s_-]*key|raw[\s_-]*prompt|bearer|jwt|secret|password|cookie|prompt)\b/i;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function safeReason(value: unknown, fallback: string): string {
  const reason = optionalString(value);
  if (!reason) {
    return fallback;
  }
  if (PROTECTED_REASON_PATTERN.test(reason)) {
    return REDACTED_VERIFICATION_REASON;
  }
  return reason.slice(0, 240);
}

const AGENT_CARD_ENVELOPE_FIELDS = new Set(["provenance", "signature"]);

function stableValue(value: unknown, omitEnvelopeFields = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }

  const record = asRecord(value);
  if (!record) {
    return value;
  }

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (omitEnvelopeFields && AGENT_CARD_ENVELOPE_FIELDS.has(key)) {
      continue;
    }
    const nested = record[key];
    if (nested !== undefined) {
      sorted[key] = stableValue(nested);
    }
  }
  return sorted;
}

export function canonicalizeAgentCardPayload(agentCard: unknown): string {
  return JSON.stringify(stableValue(agentCard, true));
}

export function agentCardPayloadHash(agentCard: unknown): string {
  return createHash("sha256").update(canonicalizeAgentCardPayload(agentCard)).digest("base64url");
}

export function isOgenAgentCardVerificationStatus(value: unknown): value is OgenAgentCardVerificationStatus {
  return typeof value === "string" && OGEN_AGENT_CARD_VERIFICATION_STATUSES.includes(value as OgenAgentCardVerificationStatus);
}

function expired(expiresAt: string | undefined, now: Date): boolean {
  if (!expiresAt) {
    return false;
  }
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= now.getTime();
}

export function buildOgenAgentCardProvenance(params: {
  agentCard: unknown;
  signature?: OgenAgentCardSignature;
  verificationStatus?: OgenAgentCardVerificationStatus;
  verificationReason?: string;
}): OgenAgentCardProvenance {
  const signature = params.signature ?? { signaturePresent: false };
  const status = params.verificationStatus ?? (signature.signaturePresent ? "unverified" : "not_configured");
  const reason =
    params.verificationReason ??
    (signature.signaturePresent
      ? "Agent Card signature metadata is present, but no trust-anchor verifier is configured."
      : "Agent Card signature verification is not configured; provenance is advisory only.");

  return {
    schemaVersion: OGEN_AGENT_CARD_PROVENANCE_SCHEMA_VERSION,
    issuer: signature.issuer,
    kid: signature.kid,
    alg: signature.alg,
    signedAt: signature.signedAt,
    expiresAt: signature.expiresAt,
    verificationStatus: status,
    verificationReason: safeReason(reason, "Agent Card provenance status was recorded safely."),
    signaturePresent: signature.signaturePresent,
    payloadHash: agentCardPayloadHash(params.agentCard),
    canonicalization: OGEN_AGENT_CARD_CANONICALIZATION,
    authority: {
      informationalOnly: true,
      tenantAuthority: "verified_gateway_session",
      authorizationAuthority: "existing_a2a_jwt_or_gateway_session",
      policyAuthority: "existing_ogen_policy",
      auditAuthority: "existing_ogen_audit"
    },
    protectedMaterialExposed: false,
    tokenMaterialStored: false,
    privateKeyMaterialExposed: false,
    rawPromptStored: false
  };
}

export function withOgenAgentCardProvenance<T extends object>(
  agentCard: T,
  signature: OgenAgentCardSignature = { signaturePresent: false }
): T & { provenance: OgenAgentCardProvenance } {
  return {
    ...agentCard,
    provenance: buildOgenAgentCardProvenance({ agentCard, signature })
  };
}

export async function verifyOgenAgentCardSignature(params: {
  agentCard: unknown;
  signature: OgenAgentCardSignature;
  verifier?: OgenAgentCardSignatureVerifier;
  now?: Date;
}): Promise<OgenAgentCardProvenance> {
  const canonicalPayload = canonicalizeAgentCardPayload(params.agentCard);
  const payloadHash = createHash("sha256").update(canonicalPayload).digest("base64url");

  if (!params.verifier) {
    return buildOgenAgentCardProvenance({
      agentCard: params.agentCard,
      signature: params.signature,
      verificationStatus: params.signature.signaturePresent ? "unverified" : "not_configured",
      verificationReason: params.signature.signaturePresent
        ? "Agent Card signature metadata is present, but no trust-anchor verifier is configured."
        : "Agent Card signature verification is not configured; provenance is advisory only."
    });
  }

  if (!params.signature.signaturePresent) {
    return buildOgenAgentCardProvenance({
      agentCard: params.agentCard,
      signature: params.signature,
      verificationStatus: "unverified",
      verificationReason: "Agent Card signature verifier is configured, but no signature metadata is present."
    });
  }

  try {
    const result = await params.verifier({
      agentCard: params.agentCard,
      canonicalPayload,
      payloadHash,
      signature: params.signature
    });
    const signature: OgenAgentCardSignature = {
      issuer: result.issuer ?? params.signature.issuer,
      kid: result.kid ?? params.signature.kid,
      alg: result.alg ?? params.signature.alg,
      signedAt: result.signedAt ?? params.signature.signedAt,
      expiresAt: result.expiresAt ?? params.signature.expiresAt,
      signaturePresent: true
    };

    if (!result.valid) {
      return buildOgenAgentCardProvenance({
        agentCard: params.agentCard,
        signature,
        verificationStatus: "invalid",
        verificationReason: safeReason(result.reason, "Agent Card signature verification failed safely.")
      });
    }

    if (expired(signature.expiresAt, params.now ?? new Date())) {
      return buildOgenAgentCardProvenance({
        agentCard: params.agentCard,
        signature,
        verificationStatus: "expired",
        verificationReason: "Agent Card signature verified but is expired."
      });
    }

    return buildOgenAgentCardProvenance({
      agentCard: params.agentCard,
      signature,
      verificationStatus: "verified",
      verificationReason: safeReason(result.reason, "Agent Card signature verified.")
    });
  } catch {
    return buildOgenAgentCardProvenance({
      agentCard: params.agentCard,
      signature: params.signature,
      verificationStatus: "error",
      verificationReason: "Agent Card signature verification failed safely."
    });
  }
}
