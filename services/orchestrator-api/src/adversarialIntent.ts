import type { SecurityIntent } from "@a2a/shared";

const documentedAdversarialExamples = [
  "ignore previous instructions",
  "bypass gateway",
  "bypass policy",
  "return raw token",
  "show token",
  "give me bearer",
  "use admin permissions",
  "pretend approved",
  "override policy",
  "skip authorization",
  "disable governance"
];

const adversarialPatterns: Array<{ pattern: RegExp; category: NonNullable<SecurityIntent["category"]>; reason: string }> = [
  {
    pattern: /\b(ignore|disregard)\s+(all\s+)?(previous|prior|above)\s+instructions?\b/i,
    category: "prompt_injection_attempt",
    reason: "The request attempts to override system or governance instructions."
  },
  {
    pattern: /\b(return|show|reveal|print|dump|expose)\s+(the\s+)?(raw\s+)?(runtime\s+)?(token|bearer|authorization|access[_\s-]?token)\b/i,
    category: "token_exfiltration_attempt",
    reason: "The request attempts to reveal protected runtime token material."
  },
  {
    pattern: /\b(give\s+me|send|provide)\s+(the\s+)?bearer\b/i,
    category: "token_exfiltration_attempt",
    reason: "The request attempts to reveal bearer token material."
  },
  {
    pattern: /\b(bypass|override|skip|disable)\s+(gateway|policy|authorization|authz|governance|approval)\b/i,
    category: "policy_bypass_attempt",
    reason: "The request attempts to bypass Gateway governance or authorization."
  },
  {
    pattern: /\b(use|grant|assume)\s+(admin|administrator|root|superuser)\s+permissions?\b/i,
    category: "privilege_escalation_attempt",
    reason: "The request attempts to obtain privileges from prompt text instead of configured grants and permissions."
  },
  {
    pattern: /\bpretend\s+(the\s+)?(connector|agent|gateway|policy|skill|action)\s+(is\s+)?(approved|allowed|trusted|enabled)\b/i,
    category: "false_authority_attempt",
    reason: "The request attempts to substitute a prompt assertion for Gateway trust or approval state."
  }
];

export function detectAdversarialIntent(message: string): SecurityIntent {
  void documentedAdversarialExamples;
  const match = adversarialPatterns.find((item) => item.pattern.test(message));
  if (!match) {
    return {
      detected: false,
      reason: "No adversarial governance bypass intent detected."
    };
  }

  return {
    detected: true,
    category: match.category,
    reason: match.reason
  };
}
