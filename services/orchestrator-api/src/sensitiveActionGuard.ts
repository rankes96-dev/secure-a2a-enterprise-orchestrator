import type { RequestInterpretation } from "@a2a/shared";

export type SensitiveActionDetection = {
  isSensitive: boolean;
  requestedAction?: string;
  requiredPermission?: string;
  reason: string;
  confidence: "low" | "medium" | "high";
};

const revealTerms = [
  "show",
  "print",
  "reveal",
  "dump",
  "decode",
  "inspect",
  "expose",
  "exfiltrate",
  "display",
  "give me",
  "show me",
  "raw"
];

const tokenTerms = [
  "oauth",
  "jwt",
  "bearer",
  "bearer token",
  "authorization header",
  "auth header",
  "token",
  "session cookie",
  "cookie"
];

const secretTerms = [
  "api key",
  "client secret",
  "password",
  "private key",
  "credential",
  "credentials",
  "secret",
  "raw secret"
];

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

export function detectSensitiveAction(message: string, interpretation?: RequestInterpretation): SensitiveActionDetection {
  const lower = message.toLowerCase();
  const asksToReveal = includesAny(lower, revealTerms);
  const mentionsToken = includesAny(lower, tokenTerms);
  const mentionsSecret = includesAny(lower, secretTerms);
  const interpretedCapability = interpretation?.requestedCapability;
  const interpretedSensitive =
    interpretation?.intentType === "security_sensitive_action" ||
    interpretedCapability === "security.token.inspect" ||
    interpretedCapability === "oauth.token.inspect" ||
    interpretedCapability === "security.secret.reveal";

  if ((asksToReveal && mentionsSecret && !mentionsToken) || (interpretedCapability === "security.secret.reveal" && !mentionsToken)) {
    return {
      isSensitive: true,
      requestedAction: "security.secret.reveal",
      requiredPermission: "security.secret.reveal",
      reason: "The request attempts to reveal a raw secret or credential.",
      confidence: asksToReveal && mentionsSecret ? "high" : "medium"
    };
  }

  if ((asksToReveal && mentionsToken) || interpretedSensitive) {
    return {
      isSensitive: true,
      requestedAction: "security.token.inspect",
      requiredPermission: "security.token.inspect",
      reason: "The request attempts to inspect or reveal token/header material.",
      confidence: asksToReveal && mentionsToken ? "high" : "medium"
    };
  }

  return {
    isSensitive: false,
    reason: "No sensitive token, header, or secret reveal request detected.",
    confidence: "low"
  };
}
