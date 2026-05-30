# Ogen SDK Readiness Contracts

Ogen does not ship a Connector SDK yet. Do not ship a Connector SDK yet in this phase. This document defines the public contracts that a future Ogen Connector SDK must implement so connector work can start from stable boundaries instead of rewriting gateway policy, routing, or audit behavior.

Product: Ogen  
Tagline: The trust layer and secure runtime for enterprise AI agents.

## Connector Profile Contract

A connector profile describes what a connector can do and how Ogen can verify it. The future SDK must produce profiles with:

- `connectorId`
- `resourceSystem`
- `version`
- `displayName`
- `profileSource`
- `applicationAccessGrantCatalog`
- `effectivePermissionCatalog`
- `skillCatalog`
- `actionCatalog`
- `validationTests`

Profiles are contracts, not authorization decisions. Ogen policy remains the authority.

## Skill / Action Metadata Contract

Every executable skill/action must declare:

- `id` or `actionId`
- `label`
- `toolSourceType`
- `riskLevel`
- `executionType`
- `actionCategory`
- `approvalMode`
- `resourceSensitivity`
- `fieldClasses`
- `actionConstraints`
- `requiresApproval`
- `sensitivity`
- `requiredApplicationGrants`
- `requiredEffectivePermissions`
- `requestedScopes`
- `provider`
- `resourceSystem`
- `toolMappingProof`
- `certificationResult`

Rules:

- Missing `riskLevel` or `executionType` fails closed.
- Missing normalized action taxonomy metadata fails SDK certification.
- Missing normalized action metadata fails certification for future executable connectors.
- Executable external runtime actions fail closed before default allow when `actionCategory`, `approvalMode`, `resourceSensitivity`, explicit `fieldClasses`, or explicit `actionConstraints` are missing or invalid.
- Write, high-risk, or sensitive actions require governed approval.
- OAuth scopes do not equal Ogen action permission.
- Broad OAuth scopes do not grant action permission.
- approval is a policy outcome, not automatic for every write.
- `approvalMode: "blocked"` blocks, `"always"` requires approval, `"policy"` defers to policy evaluation, and `"never"` adds no approval requirement by itself.
- AI output cannot classify risk.
- Natural language cannot classify risk.
- Reference metadata fallback is allowed only for known built-in/reference connector skills.
- Production connectors must publish this metadata explicitly.

## Tool-to-Action Metadata Mapping Contract

Future SDKs must convert MCP tools, A2A Agent Card skills, connector profile actions, SDK catalogs, and manually imported catalogs into normalized Ogen action metadata before authorization. Required source types are `mcp_tool_manifest`, `a2a_agent_card_skill`, `connector_profile_action`, `sdk_action_catalog`, and `manually_imported_catalog`.

The SDK must emit:

- tool source type, source ID, and tool ID
- normalized action metadata
- required scopes/grants/permissions
- mapping proof in the `proof` field
- certification result

Mapping proof must be audit-safe: `deterministicMapping: true`, `aiInferred: false`, `rawDescriptionStored: false`, and `protectedMaterialExposed: false`. AI descriptions are not authority, natural-language tool text must not classify safety, and OAuth scopes only describe connected-account/API reach. Unknown or incomplete tools fail closed as `incomplete_metadata`, `unsupported_tool_shape`, or `blocked_unknown_tool`; they are not upgraded by AI, broad scopes, or provenance.

Connector runtime execution and A2A task execution are distinct concepts. SDK and product surfaces must not use A2A task creation, A2A task token issuance, or Agent Card metadata as proof that an external connector runtime executed.

## Safe Routing View Contract

The SDK/public routing view may expose only:

- `agentId`
- `name`, if safe
- `systems`
- `skillIds`
- skill `id` and skill `name`, if safe

The safe routing view must not expose:

- `endpoint`
- `runtimeEndpoint`
- `auth`
- `audience`
- `issuer`
- `jwks`
- `headers`
- `tokens`
- `secrets`
- descriptions that could contain sensitive operational detail

## Authorization Required Contract

Future connector runtimes may return an authorization-required result:

```json
{
  "status": "authorization_required",
  "provider": "servicenow",
  "requiredScopes": ["incident.read"],
  "reason": "User consent required"
}
```

Rules:

- No raw tokens.
- No OAuth authorization code in browser-visible response.
- Authorization is resumed by Ogen only after policy re-check.

## Runtime Execution Response Contract

Runtime execution responses must be safe to display and audit. The safe shape includes:

- `status`
- `executed`
- `outcome`
- safe evidence
- safe trace
- optional `authorizationRequirement`
- no raw token
- no raw prompt
- no secret material

## A2A 1.0 Compatibility Contract

Phase 2.20a keeps compatibility-first A2A 1.0 alignment without replacing Ogen's internal task model or adopting the official JavaScript SDK. Future SDK helpers should use the shared constants `A2A_PROTOCOL_VERSION`, `A2A_VERSION_HEADER`, `A2A_CONTENT_TYPE`, and `A2A_AGENT_CARD_WELL_KNOWN_PATH`.

Phase 2.20b adds a narrow A2A Message/Task adapter subset without replacing Ogen's internal task model or adopting the official JavaScript SDK. The adapter accepts a minimal inbound `kind: "message"` envelope, maps the first text part to the internal message field, treats `classification` as an optional safe hint with a non-authoritative `UNKNOWN` fallback, preserves conversation/task correlation IDs safely, validates inbound Task state and text parts strictly, and wraps internal responses as a minimal outbound `kind: "task"` envelope only when the compatibility path requested it. Full official Message/Task operations `list`, `get`, `cancel`, and `subscribe` remain deferred.

Phase 2.21 adds signed Agent Card provenance as safe discovery metadata. Provenance is advisory metadata: it can report issuer, key ID, algorithm, signing time, expiry, signature presence, canonical payload hash, and `verificationStatus`, but verified provenance does not grant runtime access. Ogen policy, verified identity, tenant resolution, scoped JWT validation, and Gateway RBAC remain authoritative. Trust-anchor rollout and key rotation remain future work.

Phase 2.22 adds generic action taxonomy contracts. Vendor-specific tools normalize to Ogen action categories before policy evaluation; for example ServiceNow ticket reads, Jira issue reads, GitHub permission inspection, Microsoft Graph changes, MCP tools, and monday item updates are governed through shared action metadata instead of vendor-specific policy shortcuts.

Phase 2.23 adds deterministic Tool-to-Action Metadata Mapping. MCP/A2A/vendor tools become normalized Ogen actions through explicit metadata and safe mapping proof. Mapping is deterministic and non-AI-derived; `incomplete_metadata`, `unsupported_tool_shape`, and `blocked_unknown_tool` fail closed.

Rules:

- Discovery should serve `GET /.well-known/agent-card.json`; local legacy providers may keep `GET /agent-card` as an alias.
- Outbound A2A requests should include `A2A-Version: 1.0` and `Accept: application/a2a+json`.
- Outbound A2A requests with bodies should use `Content-Type: application/a2a+json`.
- Missing inbound `A2A-Version` remains legacy-compatible; unsupported explicit versions must return a safe protocol error before task execution.
- Protocol metadata is not authorization. Ogen policy, verified identity, tenant resolution, scoped JWT validation, and Gateway RBAC remain authoritative.
- Message/Task adapter metadata is not tenant, role, policy, authorization, or audit authority; adapter proof must report `protocolMetadataAuthoritative: false`.
- Agent Card provenance is not tenant, role, policy, authorization, runtime, or audit authority; it is informational integrity metadata only.
- Valid completed Task envelopes map to diagnostic success; unsupported Task states and malformed message parts return `invalid_a2a_envelope` instead of falling through as successful results.
- Adapter outputs must not expose raw tokens, raw prompts, secrets, Authorization headers, private keys, client assertions, or protected metadata.
- Provenance outputs must not expose raw tokens, raw prompts, secrets, Authorization headers, private keys, client assertions, protected metadata, or sensitive key material.
- Tool mapping proof must not store raw descriptions, prompts, tokens, secrets, Authorization headers, private keys, client assertions, protected metadata, or sensitive key material.

## Runtime Authorization API Contract

Future SDKs can call `POST /runtime/authorize` to ask Ogen whether an action is allowed, blocked, or needs approval before runtime execution.

Rules:

- SDK can call Ogen to ask if an action is allowed.
- SDK may send tenantId as context hint.
- Ogen resolves the authoritative tenant.
- SDK must not assume tenant selection is accepted.
- Actor context may be supplied as a hint.
- Ogen verified identity session is authoritative.
- SDK must not rely on caller-supplied actor for authorization.
- SDK must not treat its own local decision as authority.
- SDK must send `toolMappingStatus: "mapped"` plus audit-safe `toolMappingProof`; missing or non-mapped tool metadata fails closed before allow.
- Mapping proof must be bound to the requested action and trusted route/resource: `toolMappingProof.toolId` must match the requested `skillId`, `toolMappingProof.provider` must match the action provider, and `toolMappingProof.resourceSystem` must match both the action resource system and trusted connector route/resource system.
- Ogen response includes policy proof.
- Execution requires a separate future runtime execution path.
- Authorization-only responses do not issue runtime tokens.
- Authorization-only responses do not call external connector runtime.
- Authorization-only responses do not store raw prompts, raw tokens, or secret material.
- SDK callers can ask for runtime authorization, but gateway APIs still enforce Ogen RBAC.
- SDK-provided actor/role data is not authoritative.

## Persisted Audit Viewer Contract

The browser audit viewer is a Gateway API, not a connector SDK execution path. Future SDKs may correlate with Ogen audit proof through safe identifiers such as requestId, taskId, connectorId, runtimeExecutionId, or conversationId, but they must not depend on raw stored metadata and must not receive raw prompt, token, Authorization header, or secret material from audit viewer responses.

## Policy Decision Proof Contract

Ogen policy decisions must expose audit-safe proof:

- `policyVersion`
- `decisionId`
- `effect`
- `primaryRuleId`
- `primaryRuleSource`
- `matchedRuleIds`
- `matchedGuardrailRuleIds`
- `matchedTenantRuleIds`
- `matchedRuleSummaries`
- `inputHash`
- `deniedByDefault`
- `requiresApproval`

## AI Proof Contracts

AI interpretation and AI routing are advisory signals only.

Required proof fields and invariants:

- `interpretationProof`
- `aiRoutingProof`
- `advisoryOnly: true`
- `authorizedRuntime: false` for routing proof
- `rawPromptStored: false`
- `rawAiResponseStored: false`

AI can interpret and suggest routing. Ogen validates, applies policy, and authorizes.

## Orchestrator-agnostic metadata and policy normalization

The SDK contracts must align with [`docs/orchestrator-agnostic-roadmap.md`](./orchestrator-agnostic-roadmap.md). Connector metadata and decision flows must include and preserve:

- `actionCategory`
- `approvalMode`
- `resourceSensitivity`
- `fieldClasses`
- `actionConstraints`
- `toolMappingProof`
- `toolSourceType`
- `requestedScopes`
- `requiredApplicationGrants`
- `requiredEffectivePermissions`
- `provider`
- `resourceSystem`
- normalized action categories policy

These requirements are contract-level inputs for safe authorization and audit proof. Vendor-specific adapters may map native fields, but they must normalize into this shared Ogen policy shape before authorization decisions. Empty `fieldClasses: []` and `actionConstraints: {}` are valid explicit declarations. Unknown taxonomy values, unknown constraint keys, malformed constraint values, or unnormalized field classes are treated as incomplete and fail closed.

Tool-to-action mapping is a trust boundary. AI descriptions, natural-language tool text, broad OAuth scopes, and provenance/signature metadata are not authorization authority. The SDK may preserve only safe source identifiers and deterministic mapping proof; it must not store raw tool descriptions as proof.

Generic policy conditions may match `actionCategories`, `executionTypes`, `riskLevels`, `approvalModes`, `resourceSensitivities`, `actorRolesAny`, `connectorIds`, `resourceSystems`, `providers`, `fieldClasses`, `bulk`, `maxRecordsPerRequest`, `maxActionsPerHour`, `requiresConnectedAccount`, and `auditRequired`. OAuth scopes remain connected-account/API authorization evidence; they do not grant Ogen action permission by themselves. Resource system policy conditions are matched against trusted route/resource context; caller-supplied action metadata cannot override the routed resource system, and mismatches fail closed.

## Certification Checklist

A future SDK connector must pass:

- all executable actions include `riskLevel` and `executionType`
- all future executable actions include `actionCategory`, `approvalMode`, `resourceSensitivity`, `fieldClasses`, and `actionConstraints`
- missing normalized taxonomy fields are certification gaps and fail-closed for future external execution safety
- tool/action mapping includes source type, normalized action metadata, required scopes/grants/permissions, mapping proof, and certification result
- mapping proof is deterministic, non-AI-derived, and audit-safe
- write, high-risk, or sensitive actions require approval
- runtime validates scoped JWT
- wrong audience rejected
- expired JWT rejected
- missing actor claims rejected if delegated
- `authorization_required` response is safe
- safe routing view excludes endpoints, auth, secrets, and descriptions
- no raw token or prompt leaks in evidence
- connector profile hash stable
