import type { ConnectorRoutingDecision } from "../connectorRouting.js";

export type ConnectorPolicyEffect =
  | "allow"
  | "block"
  | "needs_approval";

export type ConnectorPolicyRule = {
  id: string;
  name: string;
  description: string;
  effect: ConnectorPolicyEffect;
  appliesTo: {
    connectorIds?: string[];
    resourceSystems?: string[];
    skillIds?: string[];
    riskLevels?: Array<"low" | "medium" | "high" | "sensitive">;
  };
  conditions?: {
    requireUserLogin?: boolean;
    requireAdminRole?: boolean;
    businessHoursOnly?: boolean;
  };
};

export type ConnectorPolicyEvaluation = {
  effect: ConnectorPolicyEffect;
  reason: string;
  matchedRuleIds: string[];
};

export const defaultConnectorPolicyRules: ConnectorPolicyRule[] = [
  {
    id: "allow-readonly-diagnostics",
    name: "Allow read-only diagnostics",
    description: "Read-only diagnostic skills are allowed after connector trust verification.",
    effect: "allow",
    appliesTo: {
      riskLevels: ["low", "medium"]
    },
    conditions: {
      requireUserLogin: true
    }
  },
  {
    id: "block-unknown-or-unapproved-skills",
    name: "Block unknown or unapproved skills",
    description: "Skills not approved by connector decision are blocked.",
    effect: "block",
    appliesTo: {}
  },
  {
    id: "high-risk-skills-need-approval",
    name: "High-risk skills need approval",
    description: "High-risk connector skills are modeled as approval-required for V2 policy management.",
    effect: "needs_approval",
    appliesTo: {
      riskLevels: ["high", "sensitive"]
    },
    conditions: {
      requireAdminRole: true
    }
  }
];

// V1 policy evaluation is intentionally minimal. Gateway connector route
// decision remains authoritative. V2 will enforce rule matching by connector,
// skill, risk level, user role, approval state, and business conditions.
export function evaluateConnectorPolicy(input: {
  connectorRouteStatus: ConnectorRoutingDecision["status"];
  riskLevel?: "low" | "medium" | "high" | "sensitive";
}): ConnectorPolicyEvaluation {
  if (input.connectorRouteStatus === "connector_skill_approved") {
    return {
      effect: "allow",
      reason: "Default connector policy allowed this approved connector skill.",
      matchedRuleIds: ["allow-readonly-diagnostics"]
    };
  }

  return {
    effect: "block",
    reason: "Skill was not eligible for runtime execution because Gateway action decision blocked it.",
    matchedRuleIds: ["block-unknown-or-unapproved-skills"]
  };
}
