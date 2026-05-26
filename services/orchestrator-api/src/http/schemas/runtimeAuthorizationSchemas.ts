export const runtimeAuthorizationRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    requestId: { type: "string" },
    conversationId: { type: "string" },
    tenantId: { type: "string" },
    actor: {
      type: "object",
      additionalProperties: false,
      properties: {
        provider: { type: "string" },
        issuer: { type: "string" },
        subject: { type: "string" },
        email: { type: "string" },
        roles: { type: "array", items: { type: "string" } },
        groups: { type: "array", items: { type: "string" } }
      }
    },
    callerAgent: {
      type: "object",
      additionalProperties: false,
      properties: {
        agentId: { type: "string" },
        issuer: { type: "string" }
      }
    },
    targetAgent: {
      type: "object",
      additionalProperties: false,
      properties: {
        agentId: { type: "string" },
        connectorId: { type: "string" },
        resourceSystem: { type: "string" }
      }
    },
    action: {
      type: "object",
      additionalProperties: false,
      required: ["skillId", "executionType", "riskLevel"],
      properties: {
        skillId: { type: "string" },
        skillLabel: { type: "string" },
        executionType: {
          type: "string",
          enum: ["diagnostic_read_only", "inspection_read_only", "write_action", "unsupported"]
        },
        riskLevel: {
          type: "string",
          enum: ["low", "medium", "high", "sensitive"]
        },
        requiresApproval: { type: "boolean" },
        sensitivity: { type: "string", enum: ["standard", "sensitive"] },
        requestedScopes: { type: "array", items: { type: "string" } }
      }
    },
    resource: {
      type: "object",
      additionalProperties: false,
      properties: {
        connectorId: { type: "string" },
        resourceSystem: { type: "string" },
        resourceId: { type: "string" },
        resourceType: { type: "string" },
        environment: { type: "string", enum: ["production", "staging", "development", "unknown"] }
      }
    },
    connectorRoute: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string" },
        runtimeMode: { type: "string", enum: ["external_runtime_available", "metadata_only", "not_available"] },
        connectorId: { type: "string" },
        resourceSystem: { type: "string" }
      }
    },
    interpretation: {
      type: "object",
      additionalProperties: false,
      properties: {
        interpretationId: { type: "string" },
        schemaVersion: { type: "string" },
        source: { type: "string", enum: ["ai", "fallback"] },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        risks: { type: "array", items: { type: "string" } },
        advisoryOnly: { const: true }
      }
    }
  }
} as const;

const matchedRuleSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "effect", "source", "description"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    effect: { type: "string", enum: ["allow", "block", "needs_approval"] },
    source: { type: "string", enum: ["guardrail", "tenant", "default"] },
    description: { type: "string" }
  }
} as const;

export const runtimeAuthorizationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "allowed", "requiresApproval", "reason", "tenantId", "policy", "runtimeExecution", "audit"],
  properties: {
    decision: { type: "string", enum: ["allow", "block", "needs_approval"] },
    allowed: { type: "boolean" },
    requiresApproval: { type: "boolean" },
    reason: { type: "string" },
    tenantId: { type: "string" },
    tenantResolution: {
      type: "object",
      additionalProperties: false,
      required: ["source", "requestedTenantAccepted"],
      properties: {
        source: { type: "string" },
        requestedTenantId: { type: "string" },
        requestedTenantAccepted: { type: "boolean" }
      }
    },
    policy: {
      type: "object",
      additionalProperties: false,
      required: [
        "policyVersion",
        "decisionId",
        "effect",
        "matchedRuleIds",
        "matchedGuardrailRuleIds",
        "matchedTenantRuleIds",
        "matchedRuleSummaries",
        "inputHash",
        "deniedByDefault",
        "requiresApproval"
      ],
      properties: {
        policyVersion: { type: "string" },
        decisionId: { type: "string" },
        effect: { type: "string", enum: ["allow", "block", "needs_approval"] },
        primaryRuleId: { type: "string" },
        primaryRuleSource: { type: "string", enum: ["guardrail", "tenant", "default"] },
        matchedRuleIds: { type: "array", items: { type: "string" } },
        matchedGuardrailRuleIds: { type: "array", items: { type: "string" } },
        matchedTenantRuleIds: { type: "array", items: { type: "string" } },
        matchedRuleSummaries: { type: "array", items: matchedRuleSummarySchema },
        inputHash: { type: "string" },
        deniedByDefault: { type: "boolean" },
        requiresApproval: { type: "boolean" }
      }
    },
    runtimeExecution: {
      type: "object",
      additionalProperties: false,
      required: ["executed", "runtimeTokenIssued", "externalRuntimeCalled"],
      properties: {
        executed: { const: false },
        runtimeTokenIssued: { const: false },
        externalRuntimeCalled: { const: false }
      }
    },
    audit: {
      type: "object",
      additionalProperties: false,
      required: ["eventType", "protectedMaterialExposed", "tokenMaterialStored", "rawPromptStored"],
      properties: {
        eventType: { const: "runtime.authorization.evaluated" },
        protectedMaterialExposed: { const: false },
        tokenMaterialStored: { const: false },
        rawPromptStored: { const: false }
      }
    }
  }
} as const;
