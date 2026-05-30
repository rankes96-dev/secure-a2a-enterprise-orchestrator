import type { ResolveResponse } from "@a2a/shared";
import type { SecurityTimelineEvent } from "./components/types";

type ResolveA2ATask = NonNullable<ResolveResponse["a2aTasks"]>[number];
type ConnectorRuntime = NonNullable<ResolveResponse["connectorRuntime"]>;
type ConnectorRuntimeTokenMetadata = NonNullable<ConnectorRuntime["tokenMetadata"]>;
type SecurityTimelineStatus = SecurityTimelineEvent["status"];

function metadataList(items: Array<{ label: string; value: unknown }>): Array<{ label: string; value: string }> {
  return items
    .filter((item) => item.value !== undefined && item.value !== null && item.value !== "")
    .map((item) => ({
      label: item.label,
      value: Array.isArray(item.value) ? item.value.join(", ") || "none" : String(item.value)
    }));
}

function policyStatus(decision: string): SecurityTimelineStatus {
  if (decision === "Allowed") {
    return "success";
  }
  if (decision === "Blocked") {
    return "blocked";
  }
  return "warning";
}

function agentResponseStatus(status: string): SecurityTimelineStatus {
  if (status === "diagnosed" || status === "completed") {
    return "success";
  }
  if (status === "blocked" || status === "error") {
    return "blocked";
  }
  return "warning";
}

function finalStatus(status: ResolveResponse["resolutionStatus"]): SecurityTimelineStatus {
  if (status === "resolved") {
    return "success";
  }
  if (status === "unsupported") {
    return "warning";
  }
  return "info";
}

function tokenActorMetadataObserved(tokenMetadata: ConnectorRuntimeTokenMetadata): boolean {
  return Boolean(
    tokenMetadata.actor ||
    tokenMetadata.actorRoles?.length ||
    tokenMetadata.actorProvider ||
    tokenMetadata.actorIssuer ||
    tokenMetadata.actorSubject
  );
}

function responseRuntimeActorMetadataObserved(response: ResolveResponse): boolean {
  const tokenMetadata = response.connectorRuntime?.tokenMetadata;
  return Boolean(tokenMetadata && tokenActorMetadataObserved(tokenMetadata));
}

function planningResumed(response: ResolveResponse | null): boolean {
  return Boolean(
    response?.pendingInteractionResolution?.relation === "provide_missing_input" &&
    response.executionGateStack?.finalOutcome === "planned"
  );
}

export function securityDecisions(response: ResolveResponse | null): NonNullable<ResolveResponse["securityDecisions"]> {
  if (!response) {
    return [];
  }

  return response.securityDecisions ?? (response.securityDecision ? [response.securityDecision] : []);
}

export function primaryPolicyLabel(response: ResolveResponse | null): string {
  if (response?.connectorPolicy?.effect === "allow") {
    return "Connector policy allowed";
  }
  if (response?.connectorPolicy?.effect === "block") {
    return "Connector policy blocked";
  }
  if (response?.connectorPolicy?.effect === "needs_approval") {
    return "Connector policy needs approval";
  }
  if (response?.connectorPolicy) {
    return "Connector policy evaluated";
  }

  const decisions = securityDecisions(response);
  if (decisions.some((decision) => decision.decision === "Blocked")) {
    return "Blocked";
  }
  if (decisions.some((decision) => decision.decision === "NeedsApproval")) {
    return "NeedsApproval";
  }
  if (decisions.some((decision) => decision.decision === "NeedsMoreContext")) {
    return "NeedsMoreContext";
  }
  if (decisions.some((decision) => decision.decision === "Allowed")) {
    return "Allowed";
  }

  return "none";
}

export function tokenStatusLabel(response: ResolveResponse | null): string {
  if (planningResumed(response)) {
    return "runtime token not issued";
  }

  const runtime = response?.connectorRuntime;
  if (runtime) {
    const tokenMetadata = runtime.tokenMetadata;
    if (tokenMetadata?.tokenIssued === true) {
      return "runtime token issued";
    }
    if (runtime.authorizationRequirement || runtime.agentResponse?.authorizationRequirement) {
      return "user authorization required";
    }
    if (runtime.executed === true && !tokenMetadata) {
      return "runtime executed; token proof unavailable";
    }
    if (tokenMetadata) {
      return "raw token hidden";
    }
    return "runtime token not issued";
  }

  const tasks = response?.a2aTasks ?? [];
  if (!tasks.length) {
    return "not applicable";
  }
  if (tasks.some((task) => task.context.auth?.tokenIssued === true)) {
    return "issued";
  }
  if (tasks.some((task) => task.context.auth?.tokenIssued === false || task.context.authMode === "oauth2_client_credentials_jwt")) {
    return "not issued";
  }

  return "not applicable";
}

export function delegationLabel(response: ResolveResponse | null): string {
  if (!response) {
    return "no";
  }

  const taskDelegation = response.a2aTasks?.some((task) => (task.delegationDepth ?? 0) > 0 || Boolean(task.mediatedBy)) ?? false;
  if (response.connectorRuntime || response.connectorRouting) {
    return taskDelegation ? "yes" : "no";
  }

  const traceDelegation = [...response.executionTrace, ...response.agentTrace].some((entry) => entry.action.toLowerCase().includes("delegation"));
  return taskDelegation || traceDelegation ? "yes" : "no";
}

export function cockpitStatusClass(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("blocked")) {
    return "blocked";
  }
  if (normalized.includes("authorization required") || normalized.includes("approval") || normalized.includes("needs") || normalized.includes("unsupported") || normalized.includes("proof unavailable")) {
    return "warning";
  }
  if (normalized.includes("not issued") || normalized.includes("not applicable") || normalized.includes("not available")) {
    return "neutral";
  }
  if (normalized.includes("allowed") || normalized.includes("verified") || normalized.includes("issued") || normalized.includes("resolved") || normalized.includes("diagnosed") || normalized.includes("inspected") || normalized.includes("completed") || normalized.includes("executed") || normalized.includes("raw token hidden") || normalized === "yes") {
    return "success";
  }

  return "neutral";
}

export function lastResultLabel(response: ResolveResponse | null): string {
  if (!response) {
    return "No task run yet";
  }

  const policy = primaryPolicyLabel(response);
  if (policy === "Blocked" || policy === "Connector policy blocked") {
    return "blocked";
  }
  if (policy === "NeedsApproval" || policy === "Connector policy needs approval") {
    return "needs approval";
  }

  return response.resolutionStatus;
}

export function connectorRoutingStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    connector_skill_approved: "Connector skill approved",
    connector_skill_blocked: "Connector skill blocked",
    connector_skill_not_declared: "Connector skill not enabled",
    connector_skill_not_enabled: "Connector skill not enabled",
    connector_not_onboarded: "Connector template supported, but no agent installed",
    unsupported: "Unsupported request",
    needs_more_info: "Needs more information"
  };

  return labels[status] ?? statusDisplayLabel(status);
}

export function connectorRoutingStatusClass(status: string): string {
  if (status === "connector_skill_approved") {
    return "success";
  }

  if (status === "connector_skill_blocked") {
    return "blocked";
  }

  if (status === "connector_skill_not_declared" || status === "connector_skill_not_enabled" || status === "connector_not_onboarded" || status === "unsupported") {
    return "warning";
  }

  return "neutral";
}

export function connectorRouteSummaryLabel(response: ResolveResponse | null): string {
  const status = response?.connectorRouting?.status;
  if (!status) {
    return response ? `${response.selectedAgents.length} selected / ${response.selectedAgents[0]?.agentId ?? "none"}` : "No route selected yet";
  }
  if (status === "connector_skill_approved") {
    return "Connector route approved";
  }
  if (status === "needs_more_info") {
    return "Connector route needs info";
  }
  return "Connector route blocked";
}

export function resultSummaryLabel(response: ResolveResponse | null): string {
  if (!response) {
    return "No task run yet";
  }
  if (planningResumed(response)) {
    return "planning resumed";
  }
  if (response.connectorRuntime?.executed) {
    return response.connectorRuntime.agentResponse?.status ?? "executed";
  }
  return response.resolutionStatus;
}

export function policyOutcomeLabel(policy: string): string {
  if (policy.toLowerCase().startsWith("connector policy")) {
    return policy;
  }
  if (policy === "Allowed") {
    return "Policy allowed";
  }
  if (policy === "Blocked") {
    return "Policy blocked";
  }
  if (policy === "NeedsApproval") {
    return "Policy needs approval";
  }
  if (policy === "NeedsMoreContext") {
    return "Policy needs more context";
  }
  return "Policy not evaluated";
}

export function tokenOutcomeLabel(token: string): string {
  if (token === "runtime token issued") {
    return "Runtime token issued";
  }
  if (token === "user authorization required") {
    return "User authorization required";
  }
  if (token === "runtime executed; token proof unavailable") {
    return "Runtime executed; token proof unavailable";
  }
  if (token === "runtime token not issued") {
    return "Runtime token not issued";
  }
  if (token === "raw token hidden") {
    return "Raw token hidden";
  }
  if (token === "not applicable") {
    return "Not applicable";
  }
  if (token === "issued") {
    return "Scoped token issued";
  }
  if (token === "not issued") {
    return "Scoped token not issued";
  }
  return "No token issued yet";
}

export function statusDisplayLabel(value: string): string {
  const normalized = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
  return normalized ? normalized.toUpperCase() : "NO TASK RUN YET";
}

export function buildSecurityTimelineEvents(response: ResolveResponse): SecurityTimelineEvent[] {
  const events: SecurityTimelineEvent[] = [];
  const firstTraceTimestamp = response.executionTrace[0]?.timestamp ?? response.agentTrace[0]?.timestamp;
  const runtimeActorContextIncluded = responseRuntimeActorMetadataObserved(response);

  events.push({
    id: "identity-verified",
    category: "identity",
    title: "User identity verified",
    description: `Verified ${response.userIdentity.provider ?? "user"} identity for ${response.userIdentity.email ?? "unknown"} was attached to this gateway session.`,
    status: "success",
    timestamp: firstTraceTimestamp,
    actor: response.userIdentity.email,
    metadata: metadataList([
      { label: "Identity provider", value: response.userIdentity.provider },
      { label: "Email", value: response.userIdentity.email },
      { label: "Roles", value: response.userIdentity.roles ?? [] },
      { label: "Runtime actor context", value: runtimeActorContextIncluded ? "included" : "not included" },
      { label: "Raw token", value: "hidden" }
    ])
  });

  if (response.requestInterpretation) {
    events.push({
      id: "request-interpreted",
      category: "routing",
      title: "Request interpreted",
      description: "Gateway classified the user request before routing.",
      status: response.requestInterpretation.confidence === "high" ? "success" : "info",
      timestamp: response.executionTrace.find((entry) => entry.action === "interpret_request")?.timestamp,
      actor: "orchestrator",
      metadata: metadataList([
        { label: "Scope", value: response.requestInterpretation.scope },
        { label: "Intent", value: response.requestInterpretation.intentType },
        { label: "Target system", value: response.requestInterpretation.targetSystemText },
        { label: "Skill", value: response.requestInterpretation.requestedCapability },
        { label: "Action", value: response.requestInterpretation.requestedActionText }
      ])
    });
  }

  if (planningResumed(response)) {
    events.push({
      id: "governed-planning-resumed",
      category: "routing",
      title: "Connector planning resumed",
      description: "Gateway resumed governed planning state before new routing; no request was submitted and connector runtime was not executed.",
      status: "info",
      timestamp: response.executionTrace.find((entry) => entry.action === "complete_planning_without_submission")?.timestamp,
      actor: "orchestrator",
      metadata: metadataList([
        { label: "Pending interaction resumed", value: "yes" },
        { label: "Missing inputs collected", value: response.evidence.find((item) => item.title === "Governed planning resume")?.data.missingInputsCollected },
        { label: "Request submitted", value: "false" },
        { label: "Runtime executed", value: "false" },
        { label: "Runtime token issued", value: "false" },
        { label: "External runtime called", value: "false" },
        { label: "Raw prompt stored", value: "false" },
        { label: "Protected material exposed", value: "false" }
      ])
    });
  }

  if (response.connectorRouting) {
    const routeStatusClass = connectorRoutingStatusClass(response.connectorRouting.status);
    events.push({
      id: "connector-route",
      category: "routing",
      title: connectorRouteSummaryLabel(response),
      description: response.connectorRouting.reason,
      status: routeStatusClass === "success" ? "success" : routeStatusClass === "blocked" ? "blocked" : "warning",
      timestamp: response.executionTrace.find((entry) => entry.action === "connector_route_decision")?.timestamp,
      actor: "orchestrator",
      agentId: response.connectorRouting.connectorId,
      metadata: metadataList([
        { label: "Connector route", value: connectorRoutingStatusLabel(response.connectorRouting.status) },
        { label: "Connector ID", value: response.connectorRouting.connectorId },
        { label: "Resource system", value: response.connectorRouting.resourceSystem ?? response.connectorRouting.targetSystem },
        { label: "Skill ID", value: response.connectorRouting.skillId },
        { label: "Skill label", value: response.connectorRouting.skillLabel },
        { label: "Runtime mode", value: response.connectorRouting.runtimeMode },
        { label: "Tool mapping", value: response.connectorRouting.toolMappingStatus },
        { label: "Tool mapping deterministic", value: response.connectorRouting.toolMappingProof?.deterministicMapping },
        { label: "Tool mapping AI inferred", value: response.connectorRouting.toolMappingProof?.aiInferred },
        { label: "Legacy/internal A2A tasks", value: response.a2aTasks?.length ?? 0 }
      ])
    });
  }

  for (const [index, agent] of response.selectedAgents.entries()) {
    events.push({
      id: `selected-agent-${agent.agentId}-${agent.skillId ?? index}`,
      category: "routing",
      title: "Agent Card selected",
      description: `Gateway selected ${agent.agentId} based on skill metadata.`,
      status: "success",
      timestamp: response.agentTrace.find((entry) => entry.action === "select_agent" && entry.detail.includes(agent.agentId))?.timestamp,
      agentId: agent.agentId,
      metadata: metadataList([
        { label: "Agent ID", value: agent.agentId },
        { label: "Skill", value: agent.skillId },
        { label: "Skill", value: agent.matchedCapability },
        { label: "Reason", value: agent.reason }
      ])
    });
  }

  if (response.connectorPolicy) {
    events.push({
      id: `connector-policy-${response.connectorPolicy.decisionId ?? response.connectorPolicy.primaryRuleId ?? "decision"}`,
      category: "policy",
      title: primaryPolicyLabel(response),
      description: response.connectorPolicy.reason,
      status: response.connectorPolicy.effect === "allow" ? "success" : response.connectorPolicy.effect === "block" ? "blocked" : "warning",
      timestamp: response.agentTrace.find((entry) => entry.action.includes("POLICY") || entry.action.includes("SECURITY"))?.timestamp,
      actor: "orchestrator",
      agentId: response.connectorRouting?.connectorId ?? response.connectorRuntime?.connectorId,
      metadata: metadataList([
        { label: "Effect", value: response.connectorPolicy.effect },
        { label: "Primary rule", value: response.connectorPolicy.primaryRuleId },
        { label: "Primary source", value: response.connectorPolicy.primaryRuleSource },
        { label: "Matched rules", value: response.connectorPolicy.matchedRuleIds },
        { label: "Decision ID", value: response.connectorPolicy.decisionId }
      ])
    });
  }

  for (const [index, decision] of securityDecisions(response).entries()) {
    events.push({
      id: `policy-${decision.target}-${decision.requestedAction}-${index}`,
      category: "policy",
      title: `Policy decision: ${decision.decision}`,
      description: decision.reason,
      status: policyStatus(decision.decision),
      timestamp: response.agentTrace.find((entry) => entry.action.includes("POLICY") || entry.action.includes("SECURITY"))?.timestamp,
      actor: decision.caller,
      agentId: decision.target,
      metadata: metadataList([
        { label: "Agent", value: decision.target },
        { label: "Requested action", value: decision.requestedAction },
        { label: "Required permission", value: decision.requiredPermission },
        { label: "Matched policy", value: decision.matchedPolicy }
      ])
    });
  }

  for (const task of response.a2aTasks ?? []) {
    addA2ATaskEvents(events, response, task);
  }

  const traceDelegation = [...response.executionTrace, ...response.agentTrace].find((entry) => entry.action.toLowerCase().includes("delegation"));
  if (traceDelegation && !events.some((event) => event.category === "delegation")) {
    events.push({
      id: "delegation-trace",
      category: "delegation",
      title: "Delegation mediated by gateway",
      description: "Agent requested help from another agent; gateway mediated the call.",
      status: traceDelegation.decision === "Blocked" ? "blocked" : "info",
      timestamp: traceDelegation.timestamp,
      actor: "actor" in traceDelegation ? traceDelegation.actor : traceDelegation.agent,
      agentId: traceDelegation.toAgent,
      metadata: metadataList([
        { label: "Action", value: traceDelegation.action },
        { label: "From", value: traceDelegation.fromAgent },
        { label: "To", value: traceDelegation.toAgent },
        { label: "Depth", value: traceDelegation.delegationDepth }
      ])
    });
  }

  for (const [index, agentResponse] of (response.a2aResponses ?? []).entries()) {
    events.push({
      id: `agent-response-${agentResponse.agentId}-${index}`,
      category: "response",
      title: "Agent response received",
      description: `${agentResponse.agentId} returned ${agentResponse.status}.`,
      status: agentResponseStatus(agentResponse.status),
      timestamp: agentResponse.trace?.[0]?.timestamp,
      agentId: agentResponse.agentId,
      metadata: metadataList([
        { label: "Agent ID", value: agentResponse.agentId },
        { label: "Status", value: agentResponse.status },
        { label: "Summary", value: agentResponse.summary }
      ])
    });
  }

  if (response.connectorRuntime?.tokenMetadata) {
    const tokenMetadata = response.connectorRuntime.tokenMetadata;
    const actorAttached = tokenActorMetadataObserved(tokenMetadata);
    events.push({
      id: "connector-runtime-actor-context",
      category: "token",
      title: "Actor context attached to runtime proof",
      description: "Gateway attached safe actor metadata to the scoped runtime context. Raw identity and A2A tokens stayed hidden.",
      status: actorAttached ? "success" : "warning",
      timestamp: response.executionTrace.find((entry) => entry.action.includes("connector.runtime.token"))?.timestamp,
      actor: tokenMetadata.actor,
      agentId: response.connectorRuntime.connectorId,
      metadata: metadataList([
        { label: "Identity provider", value: tokenMetadata.actorProvider ?? response.userIdentity.provider },
        { label: "Actor issuer", value: tokenMetadata.actorIssuer },
        { label: "Actor subject", value: tokenMetadata.actorSubject },
        { label: "Actor email", value: tokenMetadata.actor },
        { label: "Actor roles", value: tokenMetadata.actorRoles ?? [] },
        { label: "Runtime token metadata", value: actorAttached ? "actor included" : "actor missing" },
        { label: "Raw token", value: "hidden" }
      ])
    });
  }

  const authRequirement = response.connectorRuntime?.authorizationRequirement;
  if (authRequirement) {
    events.push({
      id: "connector-runtime-authorization-required",
      category: "response",
      title: "External account authorization required",
      description: `Connect your ${authRequirement.provider} account to continue. Raw tokens hidden.`,
      status: "warning",
      actor: authRequirement.actorEmail ?? response.userIdentity.email,
      agentId: authRequirement.connectorId,
      metadata: metadataList([
        { label: "Provider", value: authRequirement.provider },
        { label: "Resource system", value: authRequirement.resourceSystem },
        { label: "Connector", value: authRequirement.connectorId },
        { label: "Requested scopes", value: authRequirement.requestedScopes },
        { label: "Actor provider", value: authRequirement.actorProvider ?? response.userIdentity.provider },
        { label: "Actor subject", value: authRequirement.actorSubject },
        { label: "Actor email", value: authRequirement.actorEmail ?? response.userIdentity.email },
        { label: "Raw tokens", value: "hidden" }
      ])
    });
  }

  events.push({
    id: "final-answer",
    category: "audit",
    title: "Final answer generated",
    description: "Gateway summarized agent findings and returned response.",
    status: finalStatus(response.resolutionStatus),
    timestamp: response.executionTrace[response.executionTrace.length - 1]?.timestamp,
    actor: "orchestrator",
    metadata: metadataList(response.connectorRuntime || response.connectorRouting
      ? [
          { label: "Resolution status", value: response.resolutionStatus },
          { label: "Connector route", value: response.connectorRouting ? connectorRoutingStatusLabel(response.connectorRouting.status) : undefined },
          { label: "Connector ID", value: response.connectorRuntime?.connectorId ?? response.connectorRouting?.connectorId },
          { label: "Resource system", value: response.connectorRuntime?.resourceSystem ?? response.connectorRouting?.resourceSystem ?? response.connectorRouting?.targetSystem },
          { label: "Runtime agent ID", value: response.connectorRuntime?.agentResponse?.agentId },
          { label: "Skill ID", value: response.connectorRuntime?.skillId ?? response.connectorRouting?.skillId },
          { label: "Skill label", value: response.connectorRouting?.skillLabel },
          { label: "Runtime executed", value: response.connectorRuntime ? response.connectorRuntime.executed : false },
          { label: "Agent response status", value: response.connectorRuntime?.agentResponse?.status },
          { label: "Tool mapping", value: response.connectorRouting?.toolMappingStatus },
          { label: "Tool mapping deterministic", value: response.connectorRouting?.toolMappingProof?.deterministicMapping },
          { label: "Tool mapping AI inferred", value: response.connectorRouting?.toolMappingProof?.aiInferred },
          { label: "Legacy/internal A2A tasks", value: response.a2aTasks?.length ?? 0 },
          { label: "Final answer", value: response.finalAnswer }
        ]
      : [
          { label: "Resolution status", value: response.resolutionStatus },
          { label: "Selected agents", value: response.selectedAgents.length },
          { label: "A2A tasks", value: response.a2aTasks?.length ?? 0 },
          { label: "Final answer", value: response.finalAnswer }
        ])
  });

  return events;
}

function addA2ATaskEvents(events: SecurityTimelineEvent[], response: ResolveResponse, task: ResolveA2ATask): void {
  const actorAttached = Boolean(task.context.actor?.email || task.context.auth?.actor || task.context.auth?.actorRoles?.length);
  events.push({
    id: `task-${task.taskId}`,
    category: "agent",
    title: "A2A task created",
    description: `Task envelope created for ${task.toAgent}.`,
    status: "info",
    timestamp: response.executionTrace.find((entry) => entry.taskId === task.taskId)?.timestamp,
    actor: task.fromAgent,
    agentId: task.toAgent,
    metadata: metadataList([
      { label: "Task ID", value: task.taskId },
      { label: "To agent", value: task.toAgent },
      { label: "Skill", value: task.skillId },
      { label: "Auth mode", value: task.context.authMode },
      { label: "Actor attached", value: actorAttached ? "yes" : "no" }
    ])
  });

  const auth = task.context.auth;
  if (auth?.tokenIssued === true) {
    events.push({
      id: `token-issued-${task.taskId}`,
      category: "token",
      title: "Scoped A2A JWT issued",
      description: "Gateway requested an audience-bound scoped token for the selected agent. Raw token hidden.",
      status: "success",
      timestamp: response.executionTrace.find((entry) => entry.taskId === task.taskId && entry.action.includes("attach"))?.timestamp,
      actor: auth.actor ?? task.context.actor?.email,
      agentId: task.toAgent,
      metadata: metadataList([
        { label: "Audience", value: auth.audience },
        { label: "Scope", value: auth.scope },
        { label: "Token auth method", value: auth.tokenAuthMethod },
        { label: "Actor", value: auth.actor ?? task.context.actor?.email },
        { label: "Actor roles", value: auth.actorRoles ?? task.context.actor?.roles },
        { label: "Raw token", value: "hidden" }
      ])
    });
  } else if (auth?.authMode === "oauth2_client_credentials_jwt" || task.context.authMode === "oauth2_client_credentials_jwt") {
    events.push({
      id: `token-not-issued-${task.taskId}`,
      category: "token",
      title: "Scoped A2A token not issued",
      description: auth?.validationReason ?? "JWT mode was expected, but token issuance was not completed.",
      status: auth?.validationReason?.toLowerCase().includes("failed") ? "blocked" : "warning",
      timestamp: response.executionTrace.find((entry) => entry.taskId === task.taskId && entry.action.includes("token"))?.timestamp,
      agentId: task.toAgent,
      metadata: metadataList([
        { label: "Audience", value: auth?.audience ?? task.context.targetAudience },
        { label: "Scope", value: auth?.scope ?? task.context.requestedScope },
        { label: "Raw token", value: "hidden" }
      ])
    });
  }

  if ((task.delegationDepth ?? 0) > 0 || task.mediatedBy) {
    events.push({
      id: `delegation-task-${task.taskId}`,
      category: "delegation",
      title: "Delegation mediated by gateway",
      description: "Agent requested help from another agent; gateway mediated the call.",
      status: "success",
      timestamp: response.executionTrace.find((entry) => entry.taskId === task.taskId)?.timestamp,
      actor: task.fromAgent,
      agentId: task.toAgent,
      metadata: metadataList([
        { label: "From", value: task.fromAgent },
        { label: "To", value: task.toAgent },
        { label: "Mediated by", value: task.mediatedBy },
        { label: "Delegation depth", value: task.delegationDepth }
      ])
    });
  }
}
