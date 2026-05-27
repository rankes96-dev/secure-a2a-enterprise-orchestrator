# Ogen Orchestrator-Agnostic Roadmap

Product: Ogen  
Tagline: The trust layer and secure runtime for enterprise AI agents.

## Purpose

This document extends the V2/V3 development plan with a generic, scale-first roadmap for Ogen as an AI agent runtime authorization layer. Ogen must not be designed only for ServiceNow. ServiceNow is a strong reference integration and a useful enterprise wedge, but Ogen should work with any AI agent orchestrator, MCP client, enterprise automation platform, or custom multi-agent runtime.

Target orchestrator examples:

- ServiceNow AI Agent / Agentic Workflow / A2A provider configuration
- Microsoft Copilot Studio / Microsoft 365 Copilot extensibility
- MCP clients and MCP remote servers
- Custom enterprise AI agent orchestrators
- Internal SOC/ITSM/DevOps agent platforms
- Future A2A-compatible agent platforms

Core product principle:

```text
AI can interpret.
AI can suggest routing.
Ogen validates.
Ogen policy authorizes.
Runtime executes only approved actions.
Audit proves what happened.
```

Ogen should be positioned as:

```text
The runtime authorization layer for enterprise AI agents.
```

Not as:

```text
A ServiceNow-only adapter.
A monday-only MCP wrapper.
A single orchestrator integration.
```

## Why recent MCP / ServiceNow experience matters

A real ServiceNow + monday.com MCP experiment showed the following enterprise friction points:

1. Tools exposed by the MCP server had to be selected and described manually.
2. Each user had to authorize monday.com through delegated OAuth.
3. The first connection created multiple consent/authorization screens.
4. monday.com OAuth scopes were broad, including workspace, document, and board read/write permissions.
5. ServiceNow A2A provider setup required an Agent Card URL, credential alias, and subflow configuration.

This does not make Ogen unnecessary. It clarifies Ogen's role.

OAuth answers:

```text
Can this user technically access monday.com?
```

MCP answers:

```text
Which tools are available to the client?
```

ServiceNow or another orchestrator answers:

```text
How does this agent call a provider or tool?
```

Ogen answers:

```text
Should this specific agent action be allowed right now, for this user, tenant, tool, resource, risk level, scope, and approval state?
```

Therefore:

```text
OAuth gives access.
MCP exposes tools.
The orchestrator invokes agents.
Ogen governs use.
```

## Generic integration models

### Model A — Ogen as an A2A Provider

An enterprise orchestrator configures Ogen as an A2A provider.

```text
Enterprise AI Orchestrator
  -> Ogen A2A Provider
    -> Ogen policy / runtime authorization / audit
      -> External connector agent / MCP proxy / vendor API
```

This maps well to ServiceNow A2A provider configuration, but must remain generic enough for any platform that can discover an Agent Card or call an A2A-compatible provider.

Required future capabilities:

- Ogen-owned Agent Card URL
- Well-known discovery endpoint
- Credential alias / client authentication support
- Runtime authorization before execution
- Safe policy proof returned to the orchestrator
- Tenant-aware audit events

### Model B — Ogen as an MCP Proxy / Tool Gateway

An orchestrator or AI client connects to Ogen instead of connecting directly to a vendor MCP server.

```text
AI Orchestrator / MCP Client
  -> Ogen MCP Proxy
    -> Ogen tool metadata, policy, consent, approval, audit
      -> Vendor MCP Server / API
```

This is useful when vendor MCP servers expose broad tools/scopes and the enterprise needs stronger governance.

Ogen should:

- ingest or discover tool manifests
- map tools to Ogen action metadata
- classify read/write/risk/sensitivity deterministically
- expose only safe routing/tool views to AI
- enforce policy before tool execution
- optionally require approval before write/high/sensitive actions
- record proof without raw prompt/token/secret material

### Model C — Ogen as Runtime Authorization API

An orchestrator keeps its direct tool/MCP/vendor integration but asks Ogen whether a requested action is allowed.

```text
AI Orchestrator
  -> POST /runtime/authorize
    -> Ogen policy decision + proof
  -> Orchestrator continues, blocks, or requests approval
```

This is the least invasive integration model and is already started by Phase 2.15.

Important invariant:

```text
POST /runtime/authorize does not execute runtime, issue runtime tokens, or call external connector runtime.
```

### Model D — Ogen as Connector SDK + Certification Layer

Connector authors use a future Ogen SDK to publish safe connector profiles.

```text
Connector author
  -> Ogen Connector SDK
    -> connector profile + safe routing view + runtime handler + certification checks
      -> Ogen onboarding / policy / audit
```

The SDK should prevent incomplete or unsafe connectors from being accepted as executable.

## Generic tool/action metadata model

Manual tool selection does not scale. Every tool or agent skill must become an Ogen action with deterministic metadata.

Required fields for executable actions:

```text
skillId / actionId
label
executionType
riskLevel
requiresApproval
sensitivity
requiredApplicationGrants
requiredEffectivePermissions
requestedScopes
resourceSystem
provider
```

Examples:

```json
{
  "skillId": "monday.board.item.read",
  "label": "Read monday board item",
  "executionType": "inspection_read_only",
  "riskLevel": "low",
  "requiresApproval": false,
  "sensitivity": "standard",
  "requestedScopes": ["boards:read"]
}
```

```json
{
  "skillId": "monday.board.item.update",
  "label": "Update monday board item",
  "executionType": "write_action",
  "riskLevel": "high",
  "requiresApproval": true,
  "sensitivity": "sensitive",
  "requestedScopes": ["boards:write"]
}
```

Rules:

- Ogen must not infer risk from AI text.
- Ogen must not infer write/read safety from missing metadata.
- Missing `riskLevel` or `executionType` fails closed.
- Broad OAuth scopes do not imply agent permission to use every tool.
- Connector-provided metadata or certified reference metadata can prove safe read-only behavior.

## OAuth / connected-account model

Per-user OAuth is good and should be supported. It is better than one shared service account token. But OAuth consent is not sufficient agent governance.

Ogen should treat OAuth as connected-account authorization, not runtime policy approval.

Future connected-account records should be scoped by:

```text
tenant_id
actor_provider
actor_issuer
actor_subject
actor_email
provider
resource_system
connector_id
external_account_id
scopes
status
last_used_at
revoked_at
```

Ogen should verify:

- user identity
- tenant
- connected account presence
- scope sufficiency
- scope drift
- token status
- action policy
- approval state

For example:

```text
User has monday boards:write OAuth scope.
Agent requests monday.board.item.update.
Ogen policy still returns needs_approval or block depending tenant policy.
```

Core principle:

```text
Can the token technically do it?
```

is different from:

```text
Should this agent action be allowed now?
```

## Approval and governance model

Actions should be governed based on action metadata, not just OAuth scopes.

Suggested defaults:

```text
read-only low-risk action -> allow if user/tenant/connector policy passes
medium inspection action -> allow or audit depending tenant policy
write/high/sensitive action -> needs_approval
admin/bulk/delete/security-sensitive action -> block by default
```

Future approval records should include:

```text
approval_id
tenant_id
actor
requested_action
resource
risk_level
policy_decision_id
status
approved_by
approved_at
expires_at
business_reason
```

Approval resume must re-check:

- tenant
- user identity
- connector trust
- connected account
- scopes
- policy
- action metadata

## Planned roadmap additions

The following phases extend the main V2/V3 plan. They should remain orchestrator-agnostic.

### Phase 2.20 — Orchestrator-Agnostic Provider Model

Goal: define how any enterprise AI orchestrator can connect to Ogen without Ogen becoming ServiceNow-specific.

Deliverables:

- generic provider/discovery contract
- Ogen Agent Card / provider metadata contract
- route capability mapping for external orchestrators
- guidance for ServiceNow, Microsoft Copilot, MCP clients, and custom orchestrators as examples only
- verification that docs and contracts do not hardcode ServiceNow as the only orchestration target

Non-goal:

- no ServiceNow-specific implementation in this phase

### Phase 2.21 — Tool-to-Action Metadata Mapping

Goal: convert external tool definitions into Ogen action metadata.

Sources may include:

- MCP tool manifests
- A2A Agent Cards
- connector profiles
- SDK-defined action catalogs
- manually imported tool catalogs

Output:

- normalized Ogen action catalog
- executionType/riskLevel/requiresApproval/sensitivity
- required scopes/grants/permissions
- safe routing view
- validation failures for incomplete metadata

Rules:

- no AI-only risk classification
- no natural-language-only safety inference
- unknown tool metadata fails closed

### Phase 2.22 — Connected Account Consent Registry

Goal: track user-delegated OAuth connection state in a vendor-neutral model.

Support providers such as:

- monday.com
- Microsoft Graph / Copilot-related tools
- Jira / Atlassian
- GitHub
- ServiceNow
- internal enterprise apps

This phase should define metadata and state. Raw token vault implementation can remain a later phase unless explicitly in scope.

### Phase 2.23 — OAuth Scope-to-Policy Mapping

Goal: map broad OAuth scopes into Ogen action constraints.

Example:

```text
monday OAuth grants boards:write.
Ogen allows monday.board.item.read.
Ogen requires approval for monday.board.item.update.
Ogen blocks monday.workspace.bulk_modify unless explicitly approved by tenant policy.
```

Deliverables:

- scope catalog contract
- action-to-scope requirements
- insufficient-scope decision proof
- scope drift detection boundary

### Phase 2.24 — Generic MCP Proxy Boundary

Goal: design Ogen as a policy-aware MCP proxy without binding to any one vendor.

Ogen MCP proxy should:

- expose safe tools to an MCP client
- hide raw vendor auth and endpoint details
- enforce Ogen runtime authorization before tool calls
- support connected-account authorization_required responses
- audit tool call decisions and outcomes

Non-goals for first boundary:

- no full production MCP proxy required immediately
- no vendor-specific MCP implementation as core logic

### Phase 2.25 — Generic A2A Provider Boundary

Goal: design Ogen as an A2A provider that enterprise orchestrators can register through Agent Card discovery.

This should support orchestrators like ServiceNow, Microsoft Copilot-style platforms, and custom enterprise agent runtimes.

Deliverables:

- generic Agent Card / provider metadata
- authorization-only and execution-capable modes
- credential/alias requirements abstracted from any specific orchestrator
- safe callback/subflow guidance as examples, not core coupling

### Phase 2.26 — Orchestrator Integration Examples

Goal: provide examples without making them product dependencies.

Examples may include:

- ServiceNow A2A provider configuration
- Microsoft Copilot Studio / Graph connector style notes
- generic MCP client setup
- custom orchestrator calling `POST /runtime/authorize`

All examples must be clearly marked as examples. Core Ogen contracts must remain generic.

## V3 platform direction

V3 should prove Ogen is a platform, not a single integration.

V3 priorities:

- Ogen Connector SDK
- Connector Certification Harness
- Approval Engine + Resume Flow
- Connected Account Token Vault
- Generic MCP Proxy proof of concept
- Generic A2A Provider proof of concept
- Real connector example, chosen for demo value but not hardcoded into core
- Persisted Audit Viewer and SOC/SIEM export

Possible real connector examples:

- monday.com MCP-backed connector
- ServiceNow REST/OAuth adapter
- GitHub App / GitHub OAuth connector
- Microsoft Graph / Copilot-adjacent connector
- Jira / Atlassian connector

Selection criteria should be:

```text
Which connector best proves generic Ogen value?
```

Not:

```text
Which connector makes Ogen specific to one platform?
```

## Non-goals and guardrails

Ogen must not become:

- a ServiceNow-only integration
- a monday-only MCP wrapper
- a Microsoft-only Copilot extension
- a replacement for OAuth consent screens
- a replacement for vendor permission models
- a generic prompt firewall with no authorization semantics

Ogen should remain:

- identity-aware
- tenant-aware
- policy-driven
- connector/runtime agnostic
- SDK-ready
- audit-first
- least-privilege oriented
- safe-by-default

## Product framing

Use this framing in demos and docs:

```text
ServiceNow, Copilot, or any AI orchestrator can connect agents to tools.
Ogen governs what those agents are allowed to do with those tools.
```

or:

```text
OAuth grants access.
MCP exposes tools.
Ogen authorizes actions.
Audit proves decisions.
```
