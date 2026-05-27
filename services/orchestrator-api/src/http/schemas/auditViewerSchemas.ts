const auditEventOutcomeSchema = {
  type: "string",
  enum: ["success", "failure", "blocked", "needs_action"]
} as const;

const auditEventSeveritySchema = {
  type: "string",
  enum: ["info", "low", "medium", "high", "critical"]
} as const;

export const auditEventsQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    tenantId: { type: "string", maxLength: 160 },
    cursor: { type: "string", maxLength: 2048 },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    eventType: { type: "string", maxLength: 160 },
    outcome: auditEventOutcomeSchema,
    severity: auditEventSeveritySchema,
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" },
    conversationId: { type: "string", maxLength: 160 }
  }
} as const;

const auditEventSummarySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    route: { type: "string" },
    method: { type: "string" },
    capability: { type: "string" },
    reason: { type: "string" },
    resourceType: { type: "string" },
    resourceId: { type: "string" }
  }
} as const;

const auditViewerEventSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "tenantId", "createdAt", "eventType", "severity", "outcome", "actor", "correlation", "summary", "proof"],
  properties: {
    id: { type: "string" },
    tenantId: { type: "string" },
    createdAt: { type: "string" },
    eventType: { type: "string" },
    severity: auditEventSeveritySchema,
    outcome: auditEventOutcomeSchema,
    actor: {
      type: "object",
      additionalProperties: false,
      properties: {
        provider: { type: "string" },
        email: { type: "string" }
      }
    },
    correlation: {
      type: "object",
      additionalProperties: false,
      properties: {
        conversationId: { type: "string" },
        requestId: { type: "string" },
        taskId: { type: "string" },
        connectorId: { type: "string" },
        runtimeExecutionId: { type: "string" }
      }
    },
    summary: auditEventSummarySchema,
    proof: {
      type: "object",
      additionalProperties: false,
      required: ["protectedMaterialExposed", "tokenMaterialStored", "rawPromptStored"],
      properties: {
        protectedMaterialExposed: { const: false },
        tokenMaterialStored: { const: false },
        rawPromptStored: { const: false }
      }
    }
  }
} as const;

export const auditEventsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tenantId", "limit", "hasNext", "filters", "items", "responseProof"],
  properties: {
    tenantId: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    hasNext: { type: "boolean" },
    nextCursor: { type: "string" },
    filters: {
      type: "object",
      additionalProperties: false,
      properties: {
        eventType: { type: "string" },
        outcome: auditEventOutcomeSchema,
        severity: auditEventSeveritySchema,
        from: { type: "string" },
        to: { type: "string" },
        conversationId: { type: "string" }
      }
    },
    items: {
      type: "array",
      items: auditViewerEventSchema
    },
    responseProof: {
      type: "object",
      additionalProperties: false,
      required: ["safeMetadataReturned", "protectedMaterialExposed", "tokenMaterialStored", "rawPromptStored"],
      properties: {
        safeMetadataReturned: { const: false },
        protectedMaterialExposed: { const: false },
        tokenMaterialStored: { const: false },
        rawPromptStored: { const: false }
      }
    }
  }
} as const;

export const auditEventsErrorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error", "message"],
  properties: {
    error: { type: "string" },
    message: { type: "string" },
    guidance: {
      type: "array",
      items: { type: "string" }
    },
    diagnostics: {
      type: "object",
      additionalProperties: false,
      required: [
        "scannedRows",
        "scanLimit",
        "matchedRows",
        "requestedLimit",
        "appliedFilterHash",
        "appliedFilters",
        "classificationStrategy",
        "futureClassificationStrategy",
        "classificationIndexAvailable",
        "protectedMaterialExposed",
        "tokenMaterialStored",
        "rawPromptStored"
      ],
      properties: {
        scannedRows: { type: "integer", minimum: 0 },
        scanLimit: { type: "integer", minimum: 1 },
        matchedRows: { type: "integer", minimum: 0 },
        requestedLimit: { type: "integer", minimum: 1, maximum: 100 },
        appliedFilterHash: { type: "string" },
        appliedFilters: {
          type: "object",
          additionalProperties: false,
          required: ["eventType", "from", "to", "conversationId"],
          properties: {
            eventType: { type: "boolean" },
            outcome: auditEventOutcomeSchema,
            severity: auditEventSeveritySchema,
            from: { type: "boolean" },
            to: { type: "boolean" },
            conversationId: { type: "boolean" }
          }
        },
        classificationStrategy: { const: "derived_bounded_scan" },
        futureClassificationStrategy: { const: "materialized_outcome_severity_index" },
        classificationIndexAvailable: { const: false },
        protectedMaterialExposed: { const: false },
        tokenMaterialStored: { const: false },
        rawPromptStored: { const: false }
      }
    }
  }
} as const;
