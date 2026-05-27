# Ogen Orchestrator-Agnostic Roadmap

Product: Ogen  
Tagline: The trust layer and secure runtime for enterprise AI agents.

## Purpose

Ogen started as a secure **A2A-to-MCP gateway**: enterprise AI agents and orchestrators need to call MCP tools and external connector actions through a governed runtime boundary.

The platform direction keeps that core flow and generalizes it:

```text
A2A agent / enterprise AI orchestrator
  -> Ogen trust + authorization boundary
    -> MCP tools / connector runtimes / enterprise APIs
```

Ogen must not be designed only for ServiceNow, monday.com, Microsoft, or any single orchestrator. ServiceNow is a strong reference integration and enterprise wedge, but Ogen should work with any A2A-capable orchestrator, MCP client, enterprise automation platform, or custom multi-agent runtime.

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
Runtime executes only approved tool actions.
Audit proves what happened.
```

Ogen should be positioned as:

```text
The trust and authorization layer between A2A agents and MCP-powered enterprise tools.
```

or:

```text
The runtime authorization layer for enterprise AI agents using connected tools.
```

Not as:

```text
A ServiceNow-only adapter.
A monday-only MCP wrapper.
A Microsoft-only Copilot extension.
A generic prompt firewall with no runtime authorization semantics.
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
Can this user technically access the external application?
```

MCP answers:

```text
Which tools are available to the client?
```

A2A / orchestrator configuration answers:

```text
How does this agent call a provider or tool?
```

Ogen answers:

```text
Should this specific agent action be allowed right now, for this user, tenant, tool, resource, risk level, scope, and approval state?
```

Therefore:

```text
OAuth grants access.
MCP exposes tools.
A2A/orchestrators invoke agents.
Ogen authorizes actions.
Audit proves decisions.
```

## Core architecture: A2A to MCP/tool governance

Ogen should preserve the original A2A-to-MCP idea as the primary product wedge:

```text
Enterprise AI Orchestrator / A2A Agent
        |
        v
      Ogen
        |
        +-- A2A provider interface
        +-- Runtime authorization API
        +-- MCP proxy / tool gateway
        +-- Connector SDK / certified runtime handlers
        |
        v
 MCP tools / external connector agents / enterprise APIs
```

Ogen can be integrated in several ways, but they should all support the same core model: agents using tools safely.

## Generic integration models

### Model A — Ogen as an A2A Provider

An enterprise orchestrator configures Ogen as an A2A provider.

```text
Enterprise AI Orchestrator
  -> Ogen A2A Provider
    -> Ogen policy / runtime authorization / audit
      -> MCP proxy / external connector agent / vendor API
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
- optionally require approval before risky actions based on tenant policy
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

Manual tool selection does not scale. Every MCP tool, A2A skill, or connector action must become an Ogen action with deterministic metadata.

Required fields for executable actions:

```text
skillId / actionId
label
executionType
riskLevel
approvalMode
resourceSensitivity
actionCategory
requiredApplicationGrants
requiredEffectivePermissions
requestedScopes
resourceSystem
provider
constraints
```

`requiresApproval` can remain as a current compatibility field, but the scalable model should move toward `approvalMode`.

Recommended approval modes:

```text
never   -> approval is never required by the action metadata itself
policy  -> tenant policy decides whether approval is required
always  -> approval is always required unless the action is blocked earlier
blocked -> action is blocked by default unless explicitly enabled by future policy design
```

Examples:

```json
{
  "skillId": "monday.board.item.read",
  "label": "Read monday board item",
  "actionCategory": "business_object.read",
  "executionType": "inspection_read_only",
  "riskLevel": "low",
  "approvalMode": "never",
  "resourceSensitivity": "standard",
  "requestedScopes": ["boards:read"]
}
```

```json
{
  "skillId": "monday.board.item.update",
  "label": "Update monday board item",
  "actionCategory": "business_object.update",
  "executionType": "write_action",
  "riskLevel": "high",
  "approvalMode": "policy",
  "resourceSensitivity": "standard",
  "requestedScopes": ["boards:write"],
  "constraints": {
    "bulkAllowed": false,
    "maxRecordsPerRequest": 1
  }
}
```

Rules:

- Ogen must not infer risk from AI text.
- Ogen must not infer write/read safety from missing metadata.
- Missing `riskLevel` or `executionType` fails closed.
- Missing `actionCategory`, `approvalMode`, or `resourceSensitivity` should fail certification once the generic action taxonomy is introduced.
- Broad OAuth scopes do not imply agent permission to use every tool.
- Connector-provided metadata or certified reference metadata can prove safe read-only behavior.
- Write actions should not automatically mean approval; write actions mean governance.

## Generic action taxonomy

Vendor-specific tool names do not scale. Ogen should normalize vendor tools into a generic action taxonomy, then apply tenant policy to the normalized action.

Pattern:

```text
Vendor-specific action
  -> normalized Ogen action category
    -> generic policy conditions
      -> allow / needs_approval / block
```

Suggested initial categories:

```text
read
search
diagnose
comment.add
business_object.read
business_object.create
business_object.update
workflow_state.change
assignment.change
permission.inspect
permission.grant
record.delete
bulk.modify
admin.configure
external_message.send
```

Examples:

```text
monday.item.create             -> business_object.create
jira.issue.create              -> business_object.create
servicenow.incident.create     -> business_object.create
github.issue.create            -> business_object.create
```

```text
monday.item.update             -> business_object.update
jira.issue.update              -> business_object.update
servicenow.incident.update     -> business_object.update
github.issue.update            -> business_object.update
```

```text
servicenow.user.role.grant     -> permission.grant
github.repo.permission.grant   -> permission.grant
jira.project.permission.change -> permission.grant
```

This lets one tenant policy apply across monday, ServiceNow, GitHub, Jira, Microsoft Graph, and future connectors.

## Generic policy condition model

Approval and allow/block decisions should be driven by generic policy conditions, not vendor-specific one-off rules.

Policy conditions should support at least:

```text
actionCategories
executionTypes
riskLevels
approvalModes
resourceSensitivities
environments
actorRolesAny
connectorIds
resourceSystems
providers
fieldClasses
bulk
maxRecordsPerRequest
maxActionsPerHour
requiresConnectedAccount
auditRequired
```

Example tenant policy:

```json
{
  "id": "allow-standard-single-record-business-updates",
  "effect": "allow",
  "match": {
    "actionCategories": [
      "business_object.create",
      "business_object.update",
      "workflow_state.change",
      "comment.add"
    ],
    "executionTypes": ["write_action"],
    "riskLevels": ["medium", "high"],
    "approvalModes": ["policy"],
    "resourceSensitivities": ["standard"],
    "actorRolesAny": ["it-support", "operator", "project-coordinator"]
  },
  "conditions": {
    "bulk": false,
    "maxRecordsPerRequest": 1,
    "maxActionsPerHour": 30,
    "requiresConnectedAccount": true,
    "auditRequired": true
  }
}
```

This policy can allow safe single-record business updates across many connectors while still blocking or escalating sensitive cases.

Approval should be by exception:

```text
allow by policy
approve by exception
block dangerous actions
audit everything
```

Not:

```text
every write action opens an approval
```

## Resource sensitivity and field classes

Action category alone is not enough. Ogen also needs normalized resource and field sensitivity.

Suggested resource sensitivity values:

```text
standard
sensitive
regulated
security_critical
admin_controlled
```

Suggested field classes:

```text
workflow_state
assignment
classification
financial
customer_pii
employee_pii
security
identity
permission
admin_config
external_message
```

Examples:

```text
monday status column       -> workflow_state
monday owner column        -> assignment
monday budget column       -> financial
ServiceNow assigned_to     -> assignment
ServiceNow state           -> workflow_state
ServiceNow roles           -> permission
GitHub assignee            -> assignment
GitHub branch protection   -> security / admin_config
GitHub collaborator        -> permission
```

Generic policy can then say:

```text
business_object.update + standard + workflow_state -> allow by policy
business_object.update + financial/customer_pii    -> needs_approval
permission.grant                                   -> needs_approval or block
bulk.modify                                        -> needs_approval or block
record.delete                                      -> block by default
```

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
Ogen policy may still allow, require approval, or block depending tenant policy and normalized action metadata.
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

Actions should be governed based on normalized action metadata, resource sensitivity, constraints, tenant policy, and OAuth/connected-account state — not just OAuth scopes and not just a boolean approval flag.

Suggested defaults:

```text
read-only low-risk action -> allow if user/tenant/connector policy passes
medium inspection action -> allow or audit depending tenant policy
standard single-record create/update/comment/status change -> allow by policy when constraints match
sensitive field/resource update -> needs_approval
admin/bulk/delete/security-sensitive action -> needs_approval or block by default
```

Future approval records should include:

```text
approval_id
tenant_id
actor
requested_action
normalized_action_category
resource
resource_sensitivity
field_classes
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
- resource sensitivity
- field classes
- constraints

## Planned roadmap additions

The following phases extend the main V2/V3 plan. They should remain orchestrator-agnostic but preserve the core A2A-to-MCP/tool governance flow.

### Phase 2.20 — A2A-to-MCP Runtime Governance Model

Goal: define the core product flow where A2A agents and enterprise orchestrators use MCP tools and connector actions through Ogen's authorization boundary.

Deliverables:

- canonical A2A-to-MCP flow diagram and contracts
- Ogen-owned Agent Card / provider metadata contract
- MCP/tool gateway responsibility boundary
- runtime authorization handoff points
- proof model for agent -> Ogen -> tool calls
- verification that Ogen remains centered on governing tool use, not becoming a vendor-specific adapter

### Phase 2.21 — Orchestrator-Agnostic Provider Model

Goal: define how any enterprise AI orchestrator can connect to Ogen without Ogen becoming ServiceNow-specific.

Deliverables:

- generic provider/discovery contract
- route capability mapping for external orchestrators
- guidance for ServiceNow, Microsoft Copilot, MCP clients, and custom orchestrators as examples only
- verification that docs and contracts do not hardcode ServiceNow as the only orchestration target

Non-goal:

- no ServiceNow-specific implementation in this phase

### Phase 2.22 — Generic Action Taxonomy and Policy Conditions

Goal: define the vendor-neutral action taxonomy and generic policy condition model that let Ogen scale beyond one connector or one orchestrator.

Deliverables:

- `OgenActionCategory`
- `approvalMode`
- `resourceSensitivity`
- `fieldClass`
- `actionConstraints`
- generic policy condition schema
- certification checks that require action category, risk, execution type, approval mode, and sensitivity for executable actions

Acceptance criteria:

- same policy can govern monday item updates, Jira issue updates, ServiceNow incident updates, GitHub issue updates, and Microsoft Graph object updates through normalized categories
- write actions are not automatically approval-required; approval is a tenant policy outcome
- high-risk standard single-record writes can be allowed by policy when constraints match
- sensitive, bulk, permission, admin, delete, and regulated actions fail closed or require approval

### Phase 2.23 — Tool-to-Action Metadata Mapping

Goal: convert external tool definitions into Ogen action metadata.

Sources may include:

- MCP tool manifests
- A2A Agent Cards
- connector profiles
- SDK-defined action catalogs
- manually imported tool catalogs

Output:

- normalized Ogen action catalog
- actionCategory/approvalMode/resourceSensitivity/fieldClasses/constraints
- executionType/riskLevel/requiresApproval compatibility fields
- required scopes/grants/permissions
- safe routing view
- validation failures for incomplete metadata

Rules:

- no AI-only risk classification
- no natural-language-only safety inference
- unknown tool metadata fails closed

### Phase 2.24 — Connected Account Consent Registry

Goal: track user-delegated OAuth connection state in a vendor-neutral model.

Support providers such as:

- monday.com
- Microsoft Graph / Copilot-related tools
- Jira / Atlassian
- GitHub
- ServiceNow
- internal enterprise apps

This phase should define metadata and state. Raw token vault implementation can remain a later phase unless explicitly in scope.

### Phase 2.25 — OAuth Scope-to-Policy Mapping

Goal: map broad OAuth scopes into Ogen action constraints.

Example:

```text
monday OAuth grants boards:write.
Ogen allows monday.board.item.read.
Ogen allows monday.board.item.update only when the normalized action, resource sensitivity, field classes, actor role, rate limits, and tenant policy match.
Ogen requires approval or blocks monday.workspace.bulk_modify unless explicitly approved by tenant policy.
```

Deliverables:

- scope catalog contract
- action-to-scope requirements
- insufficient-scope decision proof
- scope drift detection boundary
- proof that OAuth scope presence does not bypass Ogen policy

### Phase 2.26 — Generic MCP Proxy Boundary

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

### Phase 2.27 — Generic A2A Provider Boundary

Goal: design Ogen as an A2A provider that enterprise orchestrators can register through Agent Card discovery.

This should support orchestrators like ServiceNow, Microsoft Copilot-style platforms, and custom enterprise agent runtimes.

Deliverables:

- generic Agent Card / provider metadata
- authorization-only and execution-capable modes
- credential/alias requirements abstracted from any specific orchestrator
- safe callback/subflow guidance as examples, not core coupling

### Phase 2.28 — Orchestrator Integration Examples

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
- Generic Action Taxonomy certification
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
- taxonomy-driven for policy scale
- centered on A2A agents using MCP/tools safely

## Product framing

Use this framing in demos and docs:

```text
A2A agents and enterprise orchestrators can connect to MCP tools.
Ogen governs what those agents are allowed to do with those tools.
```

or:

```text
OAuth grants access.
MCP exposes tools.
A2A invokes agents.
Ogen authorizes actions.
Audit proves decisions.
```

Scale framing:

```text
Vendor tools become normalized Ogen actions.
Tenant policy governs normalized actions.
Approval is an exception path, not the default for every write.
```
