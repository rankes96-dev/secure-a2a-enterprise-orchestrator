import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentsHealthResponse, EndUserAnswer, ResolveResponse } from "@a2a/shared";
import "./styles.css";
import { PageHeader } from "./components/layout/PageHeader";
import { DemoGuideTab } from "./components/demo-guide/DemoGuideTab";
import { RunTaskTab } from "./components/run-task/RunTaskTab";
import { AgentRegistryTab } from "./components/agent-registry/AgentRegistryTab";
import { ConnectorTestCenterTab } from "./components/connector-test-center/ConnectorTestCenterTab";
import { TrustIdentityTab } from "./components/trust-identity/TrustIdentityTab";
import { SecurityTimelineTab } from "./components/security-timeline/SecurityTimelineTab";

const API_URL = import.meta.env.VITE_ORCHESTRATOR_API_URL ?? "http://localhost:4000";
const sampleMessage = "Jira issue creation fails with 403 when creating issues in FIN project";

type Scenario = {
  label: string;
  message: string;
  subtitle: string;
  purpose?: string;
  proves: string;
  badge?: string;
};

const scenarios: Array<{ category: string; items: Scenario[] }> = [
  {
    category: "Connector-first orchestration",
    items: [
      {
        label: "Jira connector approved diagnosis",
        message: "Jira issue creation fails with 403 when creating issues in FIN project",
        subtitle: "Approved Jira connector skill when the reference connector agent is installed",
        purpose: "Routes to the installed Jira connector agent and approved diagnosis skill.",
        proves: "Diagnostic skills can execute safely without enabling the target create action.",
        badge: "Approved connector"
      },
      {
        label: "Jira create blocked by grants/permissions",
        message: "Create a Jira issue in FIN project for this outage",
        subtitle: "Blocked because the create action lacks grant/permission approval by default",
        purpose: "Shows why an installed connector agent can be trusted while a specific action is blocked.",
        proves: "Target write actions remain blocked unless separately granted and permitted.",
        badge: "Blocked action"
      },
      {
        label: "ServiceNow incident assignment",
        message: "ServiceNow incident assignment keeps failing for network tickets",
        subtitle: "Runs when the ServiceNow reference connector agent is installed",
        purpose: "Routes to the ServiceNow connector profile and incident assignment diagnosis skill.",
        proves: "Diagnostic runtime is connector-generic while system-specific reasoning stays inside the external connector.",
        badge: "ServiceNow"
      },
      {
        label: "ServiceNow catalog request",
        message: "ServiceNow catalog request RITM keeps failing during approval",
        subtitle: "Catalog request diagnosis through the ServiceNow connector",
        purpose: "Shows another ServiceNow skill selected from the same connector profile.",
        proves: "Diagnostic runtime is connector-generic while system-specific reasoning stays inside the external connector.",
        badge: "ServiceNow"
      },
      {
        label: "GitHub repository rate limit",
        message: "GitHub repository sync is failing after API rate limit",
        subtitle: "Runs when the GitHub reference connector agent is installed",
        purpose: "Routes to the GitHub connector profile and rate-limit diagnosis skill.",
        proves: "Diagnostic runtime is connector-generic while system-specific reasoning stays inside the external connector.",
        badge: "GitHub"
      },
      {
        label: "GitHub pull request access",
        message: "GitHub pull request checks cannot read the repository",
        subtitle: "Pull request access diagnosis through the GitHub connector",
        purpose: "Shows connector-specific runtime diagnosis without Gateway-specific GitHub logic.",
        proves: "Diagnostic runtime is connector-generic while system-specific reasoning stays inside the external connector.",
        badge: "GitHub"
      },
      {
        label: "Unsupported request",
        message: "The warehouse robot arm calibration failed",
        subtitle: "No supported connector profile in this demo",
        purpose: "Offers a support ticket handoff instead of pretending a connector exists.",
        proves: "Unsupported systems do not get fake routes.",
        badge: "Unsupported"
      }
    ]
  }
];

type ActiveTab = "demo-guide" | "run-task" | "agent-registry" | "connector-test-center" | "trust-identity" | "security-timeline";
type ResolveA2ATask = NonNullable<ResolveResponse["a2aTasks"]>[number];
type GuidedFocusTarget =
  | "demo-guide"
  | "run-task"
  | "composer"
  | "gateway-response"
  | "security-summary"
  | "trust-login"
  | "agent-registry"
  | "connector-test-center"
  | "connector-catalog"
  | "zero-trust-onboarding"
  | "registered-agents"
  | "legacy-agents"
  | "security-timeline";

type ConnectionAudience = "bizapps" | "developer";
type ConnectionWizardStep =
  | "overview"
  | "gateway-registration"
  | "connection-input"
  | "discovery"
  | "verify"
  | "result";

const tabs: Array<{ id: ActiveTab; label: string; hint: string }> = [
  { id: "demo-guide", label: "Demo Guide", hint: "Start here" },
  { id: "run-task", label: "Run Task", hint: "Execute scenario" },
  { id: "agent-registry", label: "Agent Registry", hint: "Install agents" },
  { id: "connector-test-center", label: "Connector Test Center", hint: "Validate safety" },
  { id: "trust-identity", label: "Trust & Identity", hint: "Login / identity" },
  { id: "security-timeline", label: "Security Timeline", hint: "Audit proof" }
];

const activePageHeaders: Record<ActiveTab, { title: string; subtitle: string }> = {
  "demo-guide": {
    title: "Demo Guide",
    subtitle: "Present the zero-trust external connector flow in 5 minutes."
  },
  "run-task": {
    title: "Governed Runtime Chat",
    subtitle: "Ask in natural language. AI interprets, but Gateway approves execution."
  },
  "agent-registry": {
    title: "Agent Registry",
    subtitle: "Choose connector templates and install trusted external connector agents."
  },
  "connector-test-center": {
    title: "Connector Test Center",
    subtitle: "Validate installed connector agents with safe, repeatable governance tests."
  },
  "trust-identity": {
    title: "Trust & Identity",
    subtitle: "Authenticate a demo user and verify Gateway identity context."
  },
  "security-timeline": {
    title: "Security Timeline",
    subtitle: "Inspect identity, policy, token, runtime, and audit proof."
  }
};

const localConnectorPresets = [
  {
    label: "Use local Jira reference agent",
    agentBaseUrl: "http://localhost:4201",
    expectedAgentId: "external-jira-agent",
    expectedResourceSystem: "jira",
    expectedConnectorId: "jira-reference"
  },
  {
    label: "Use local ServiceNow reference agent",
    agentBaseUrl: "http://localhost:4202",
    expectedAgentId: "external-servicenow-agent",
    expectedResourceSystem: "servicenow",
    expectedConnectorId: "servicenow-reference"
  },
  {
    label: "Use local GitHub reference agent",
    agentBaseUrl: "http://localhost:4203",
    expectedAgentId: "external-github-agent",
    expectedResourceSystem: "github",
    expectedConnectorId: "github-reference"
  }
];

const fallbackSupportedConnectorGuardrails: SupportedConnectorGuardrail[] = [
  {
    resourceSystem: "jira",
    connectorId: "jira-reference",
    displayName: "Jira Cloud Reference Connector",
    status: "available",
    source: "local_reference",
    description: "Reference connector template for Jira issue diagnostics, permission inspection, and controlled issue creation demos.",
    category: "Work Management",
    publisher: "Secure A2A Reference",
    templateVersion: "1.0.0",
    authModel: "oauth_application_with_service_account",
    runtimeSupport: "supported",
    riskLevel: "medium",
    tags: ["jira", "issues", "permissions", "work-management"],
    setupRequirements: ["External agent discovery endpoint", "Gateway public registration", "OAuth application grants", "Service account permission attestation"],
    installed: false,
    installedCount: 0
  },
  {
    resourceSystem: "servicenow",
    connectorId: "servicenow-reference",
    displayName: "ServiceNow Reference Connector",
    status: "available",
    source: "local_reference",
    description: "Reference connector template for ServiceNow incident, catalog request, role, and ACL diagnostics.",
    category: "ITSM",
    publisher: "Secure A2A Reference",
    templateVersion: "1.0.0",
    authModel: "oauth_application_with_service_account",
    runtimeSupport: "supported",
    riskLevel: "medium",
    tags: ["servicenow", "incident", "catalog", "itsm", "acl"],
    setupRequirements: ["External agent discovery endpoint", "Gateway public registration", "OAuth application grants", "Service account role and ACL attestation"],
    installed: false,
    installedCount: 0
  },
  {
    resourceSystem: "github",
    connectorId: "github-reference",
    displayName: "GitHub Reference Connector",
    status: "available",
    source: "local_reference",
    description: "Reference connector template for GitHub repository, pull request, installation access, and rate-limit diagnostics.",
    category: "DevOps",
    publisher: "Secure A2A Reference",
    templateVersion: "1.0.0",
    authModel: "oauth_application_with_service_account",
    runtimeSupport: "supported",
    riskLevel: "medium",
    tags: ["github", "repository", "pull-request", "rate-limit", "devops"],
    setupRequirements: ["External agent discovery endpoint", "Gateway public registration", "App installation access attestation", "Repository permission attestation"],
    installed: false,
    installedCount: 0
  },
  {
    resourceSystem: "custom",
    connectorId: "custom-sdk",
    displayName: "Custom Connector SDK",
    status: "planned",
    source: "custom_sdk",
    description: "Build your own connector using the Secure A2A connector contract. Planned for V2.",
    category: "Custom",
    publisher: "Customer / Vendor",
    templateVersion: "planned",
    authModel: "custom_sdk_contract",
    runtimeSupport: "planned",
    riskLevel: "medium",
    tags: ["custom", "sdk", "bring-your-own-connector"],
    setupRequirements: ["Discovery document", "Connector profile", "Public JWKS", "Signed onboarding response", "Scoped runtime endpoint"],
    installed: false,
    installedCount: 0
  }
];

const fallbackConnectorTemplateById = new Map(fallbackSupportedConnectorGuardrails.map((template) => [template.connectorId, template]));

function enrichConnectorTemplate(template: SupportedConnectorGuardrail): SupportedConnectorGuardrail {
  return {
    ...fallbackConnectorTemplateById.get(template.connectorId),
    ...template
  };
}

const quickScenarioLabels = new Set([
  "Jira connector approved diagnosis",
  "Jira create blocked by grants/permissions",
  "ServiceNow incident assignment",
  "ServiceNow catalog request",
  "GitHub repository rate limit",
  "GitHub pull request access",
  "Unsupported request"
]);

const allScenarios: Scenario[] = scenarios.flatMap((group) => group.items);
const quickScenarios = allScenarios.filter((scenario) => quickScenarioLabels.has(scenario.label));
const advancedScenarios = allScenarios.filter((scenario) => !quickScenarioLabels.has(scenario.label));
const infrastructureAgentIds = new Set(["mock-identity-provider"]);
const installedConnectorLifecycleLabels = {
  runtime_ready: "Runtime ready",
  verified: "Verified",
  needs_reverification: "Needs re-verification",
  runtime_blocked: "Runtime blocked",
  installed: "Installed",
  disabled: "Disabled",
  revoked: "Revoked"
} as const;

function inferDemoFlowType(response: ResolveResponse): string {
  if (response.connectorRouting) {
    return "Connector-first orchestration";
  }

  if (response.requestInterpretation?.scope === "out_of_scope" || response.routingReasoningSummary.toLowerCase().includes("outside the supported enterprise") || response.agentTrace.some((entry) => entry.action === "out_of_scope")) {
    return "Out of scope";
  }

  if (response.agentTrace.some((entry) => entry.action === "manual_incident_recommended")) {
    return "Manual incident workflow";
  }

  if (response.requestInterpretation?.scope === "manual_enterprise_workflow") {
    return "Manual service request";
  }

  if (response.resolutionStatus === "unsupported") {
    return "Unsupported/manual workflow";
  }

  if (response.securityDecisions?.some((decision) => decision.decision === "Blocked" || decision.decision === "NeedsApproval" || decision.decision === "NeedsMoreContext")) {
    return "Security policy";
  }

  if (response.classification.supportMode === "end_user_support") {
    return "End-user support";
  }

  return "Technical integration";
}

function decisionClass(decision: string): string {
  return `decision-${decision.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}`;
}

function routingDescription(response: ResolveResponse): string {
  if (response.routingSource === "ai") {
    return "Secondary AI router selected agents using Agent Cards.";
  }

  if (response.requestInterpretation?.interpretationSource === "ai") {
    return "AI interpreted the request. Deterministic fallback handled agent selection.";
  }

  if (response.requestInterpretation?.interpretationSource === "fallback") {
    return "Deterministic request interpretation fallback was used.";
  }

  return "Deterministic skill routing/fallback handled agent selection.";
}

function metadataItem(label: string, value: unknown): { label: string; value: string } | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (Array.isArray(value)) {
    return { label, value: value.length ? value.join(", ") : "none" };
  }

  return { label, value: String(value) };
}

function metadataList(items: Array<{ label: string; value: unknown }>): Array<{ label: string; value: string }> {
  return items.map((item) => metadataItem(item.label, item.value)).filter((item): item is { label: string; value: string } => Boolean(item));
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

function securityDecisions(response: ResolveResponse | null): NonNullable<ResolveResponse["securityDecisions"]> {
  if (!response) {
    return [];
  }

  return response.securityDecisions ?? (response.securityDecision ? [response.securityDecision] : []);
}

function primaryPolicyLabel(response: ResolveResponse | null): string {
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

function tokenStatusLabel(response: ResolveResponse | null): string {
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

function delegationLabel(response: ResolveResponse | null): string {
  if (!response) {
    return "no";
  }

  const taskDelegation = response.a2aTasks?.some((task) => (task.delegationDepth ?? 0) > 0 || Boolean(task.mediatedBy)) ?? false;
  const traceDelegation = [...response.executionTrace, ...response.agentTrace].some((entry) => entry.action.toLowerCase().includes("delegation"));
  return taskDelegation || traceDelegation ? "yes" : "no";
}

function cockpitStatusClass(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("allowed") || normalized.includes("verified") || normalized.includes("issued") || normalized.includes("resolved") || normalized.includes("diagnosed") || normalized.includes("inspected") || normalized.includes("completed") || normalized === "yes") {
    return "success";
  }
  if (normalized.includes("blocked") || normalized.includes("required") || normalized.includes("not issued")) {
    return "blocked";
  }
  if (normalized.includes("approval") || normalized.includes("needs") || normalized.includes("unsupported")) {
    return "warning";
  }

  return "neutral";
}

function lastResultLabel(response: ResolveResponse | null): string {
  if (!response) {
    return "No task run yet";
  }

  const policy = primaryPolicyLabel(response);
  if (policy === "Blocked") {
    return "blocked";
  }
  if (policy === "NeedsApproval") {
    return "needs approval";
  }

  return response.resolutionStatus;
}

function statusDisplayLabel(value: string): string {
  const normalized = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
  return normalized ? normalized.toUpperCase() : "NO TASK RUN YET";
}

function connectorRoutingStatusLabel(status: string): string {
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

function connectorRoutingStatusClass(status: string): string {
  if (status === "connector_skill_approved") {
    return "success";
  }

  if (status === "connector_skill_blocked" || status === "connector_skill_not_declared" || status === "connector_skill_not_enabled" || status === "connector_not_onboarded" || status === "unsupported") {
    return "warning";
  }

  return "neutral";
}

function responseSkillId(response: ResolveResponse): string {
  return response.connectorRuntime?.agentResponse?.runtimeSemantics?.executedSkillId ?? response.connectorRouting?.skillId ?? response.connectorRuntime?.skillId ?? "";
}

function responseIsDiagnostic(response: ResolveResponse): boolean {
  const semantics = response.connectorRuntime?.agentResponse?.runtimeSemantics;
  return semantics?.executionType === "diagnostic_read_only" || responseSkillId(response).includes(".diagnose");
}

function chatOutcomeLabel(response: ResolveResponse): string {
  const backendOutcomeLabels: Record<NonNullable<ResolveResponse["executionGateStack"]>["finalOutcome"], string> = {
    planned: "PLANNED",
    diagnosed: "DIAGNOSED",
    executed: "COMPLETED",
    blocked_at_gateway: "BLOCKED",
    blocked_at_oauth_scope: "BLOCKED AT OAUTH SCOPE",
    blocked_at_service_account_permission: "BLOCKED AT SERVICE ACCOUNT",
    runtime_failed: "RUNTIME FAILED",
    unsupported: "UNSUPPORTED",
    needs_more_info: "NEEDS MORE INFO"
  };
  if (response.executionGateStack) {
    return backendOutcomeLabels[response.executionGateStack.finalOutcome];
  }

  const semantics = response.connectorRuntime?.agentResponse?.runtimeSemantics;
  const agentStatus = response.connectorRuntime?.agentResponse?.status;
  const id = responseSkillId(response);

  if (agentStatus === "diagnosed" || semantics?.outcome === "diagnosed" || id.includes(".diagnose")) {
    return "DIAGNOSED";
  }

  if (id.includes(".inspect")) {
    return "INSPECTED";
  }

  if (response.connectorRouting?.status === "connector_skill_blocked") {
    return "BLOCKED";
  }

  if (response.resolutionStatus === "unsupported" || response.connectorRouting?.status === "unsupported" || semantics?.outcome === "unsupported") {
    return "UNSUPPORTED";
  }

  if (response.connectorRuntime?.executed || semantics?.outcome === "executed") {
    return "COMPLETED";
  }

  return statusDisplayLabel(response.resolutionStatus);
}

function sanitizeEndUserText(value?: string): string {
  const text = firstSentence(value ?? "").trim();
  if (!text) {
    return "";
  }

  const lower = text.toLowerCase();
  if (
    lower.includes("diagnostic skill") ||
    lower.includes("target write/action operation") ||
    lower.includes("execution gate") ||
    lower.includes("oauth") ||
    lower.includes("service account") ||
    lower.includes("service-account") ||
    lower.includes("required grants") ||
    lower.includes("required permissions") ||
    lower.includes("connector runtime") ||
    lower.includes("side-effect-free action plan")
  ) {
    return "";
  }

  return text;
}

function supportNextStep(response: ResolveResponse): string {
  return sanitizeEndUserText(response.connectorRouting?.recommendedNextStep) ||
    sanitizeEndUserText(response.diagnosis.recommendedFix) ||
    sanitizeEndUserText(response.connectorRuntime?.agentResponse?.recommendedActions?.[0]) ||
    "Open an approved access request or contact IT with the details.";
}

function supportFinding(response: ResolveResponse): string {
  return sanitizeEndUserText(response.diagnosis.probableCause) ||
    sanitizeEndUserText(response.connectorRuntime?.agentResponse?.probableCause) ||
    sanitizeEndUserText(response.connectorRuntime?.agentResponse?.summary) ||
    sanitizeEndUserText(response.finalAnswer) ||
    "The Gateway found the safest available path for this request.";
}

function responseExecutedWriteOrAdmin(response: ResolveResponse): boolean {
  const semantics = response.connectorRuntime?.agentResponse?.runtimeSemantics;
  return response.connectorRuntime?.executed === true &&
    semantics?.writeActionAttempted === true &&
    semantics.executionType === "write_action";
}

function endUserAnswerFields(answer: EndUserAnswer): string[] {
  return [
    answer.title,
    answer.summary,
    answer.whatWasChecked ?? "",
    answer.whatWasChanged ?? "",
    answer.nextStep
  ];
}

function isSafeEndUserAnswer(answer: EndUserAnswer, response: ResolveResponse): boolean {
  if (answer.safeToDisplay !== true) {
    return false;
  }

  const fields = endUserAnswerFields(answer);
  const maxLengths = [120, 360, 260, 180, 260];
  if (fields.some((field, index) => field.length > maxLengths[index])) {
    return false;
  }

  const secretMarkers = [
    "bearer",
    "authorization",
    "access_token",
    "refresh_token",
    "client_secret",
    "private_key",
    "raw jwt"
  ];
  if (fields.some((field) => secretMarkers.some((marker) => field.toLowerCase().includes(marker)))) {
    return false;
  }

  if (!responseExecutedWriteOrAdmin(response)) {
    const changedText = (answer.whatWasChanged ?? "").toLowerCase();
    const unsafeChangeClaims = [
      "access was granted",
      "granted access",
      "issue was created",
      "created an issue",
      "permission was changed",
      "permissions were changed",
      "incident was assigned",
      "assigned the incident",
      "catalog request was approved",
      "request was fulfilled",
      "repository was changed",
      "changes were made"
    ];
    if (unsafeChangeClaims.some((claim) => changedText.includes(claim))) {
      return false;
    }
  }

  return true;
}

function connectorEndUserAnswer(response: ResolveResponse): EndUserAnswer | undefined {
  const answer = response.connectorRuntime?.agentResponse?.endUserAnswer ??
    response.a2aResponses?.find((item) => item.endUserAnswer)?.endUserAnswer;
  return answer && isSafeEndUserAnswer(answer, response) ? answer : undefined;
}

function formatConnectorEndUserAnswer(outcome: string, answer: EndUserAnswer, response: ResolveResponse): string {
  return [
    outcome,
    answer.title,
    "",
    "What I found:",
    answer.summary,
    "",
    "What I checked:",
    answer.whatWasChecked ?? "The request and available connector information were checked.",
    "",
    "Changes:",
    answer.whatWasChanged ?? (responseExecutedWriteOrAdmin(response) ? "The approved action completed." : "No changes were made."),
    "",
    "Next step:",
    answer.nextStep
  ].join("\n");
}

function buildEndUserSupportAnswer(response: ResolveResponse): string {
  const outcome = chatOutcomeLabel(response);
  const nextStep = supportNextStep(response);
  const targetStatus = response.connectorRuntime?.agentResponse?.runtimeSemantics?.targetActionStatus;

  if (response.securityIntent?.detected) {
    return [
      "BLOCKED",
      "I cannot perform this request directly.",
      "",
      "Reason:",
      "This request would require a permission change, write action, admin action, or protected runtime data.",
      "Prompt text cannot grant access, change permissions, or reveal protected runtime data.",
      "",
      "No changes were made.",
      "",
      "Next step:",
      "Open an approved access request or contact IT with the details."
    ].join("\n");
  }

  if (response.finalAnswer.startsWith("CHECK READY")) {
    return [
      "CHECK READY",
      "I can continue with the safe check, but this V1 demo stops at the approved plan for this request.",
      "",
      "No changes were made.",
      "",
      "Next step:",
      "Use Connector Test Center or Security Timeline to review the proof."
    ].join("\n");
  }

  if (response.finalAnswer.startsWith("CANCELLED")) {
    return [
      "CANCELLED",
      "I stopped the current request.",
      "",
      "No changes were made.",
      "",
      "Next step:",
      "Send a new request when you are ready."
    ].join("\n");
  }

  const safeConnectorAnswer = connectorEndUserAnswer(response);
  if (safeConnectorAnswer) {
    return formatConnectorEndUserAnswer(outcome, safeConnectorAnswer, response);
  }

  if (outcome === "PLANNED" || response.connectorActionPlan) {
    return [
      "PLANNED",
      "I checked this request safely.",
      "",
      "What I found:",
      "The Gateway found a safe next step for this request.",
      "",
      "No changes were made.",
      "",
      "Next step:",
      "Start with the safe check, or open an approved access request if a permission change is needed."
    ].join("\n");
  }

  if (outcome === "NEEDS MORE INFO" && response.connectorPlanningTargetResolution?.strategy === "needs_clarification") {
    return [
      "NEEDS MORE INFO",
      "I need one more detail before I can help safely.",
      "",
      "What I found:",
      "The target system is unclear.",
      "",
      "No changes were made.",
      "",
      "Next step:",
      "Search installed systems or choose Other / not listed."
    ].join("\n");
  }

  if (outcome === "DIAGNOSED" || responseIsDiagnostic(response)) {
    const changeRequestNote = targetStatus && targetStatus !== "ready"
      ? "\nChanging this may require an approved access or configuration request."
      : "";
    return [
      "DIAGNOSED",
      "I checked this safely.",
      "",
      "What I found:",
      `${supportFinding(response)}${changeRequestNote}`,
      "",
      "No changes were made.",
      "",
      "Next step:",
      nextStep
    ].join("\n");
  }

  if (outcome === "BLOCKED" || outcome === "BLOCKED AT OAUTH SCOPE" || outcome === "BLOCKED AT SERVICE ACCOUNT") {
    return [
      "BLOCKED",
      "I cannot perform this request directly.",
      "",
      "Reason:",
      "This request would require a permission change, write action, admin action, or protected runtime data.",
      "",
      "No changes were made.",
      "",
      "Next step:",
      "Open an approved access request or contact IT with the details."
    ].join("\n");
  }

  if (outcome === "UNSUPPORTED") {
    return [
      "UNSUPPORTED",
      "This system is not available here yet.",
      "",
      "Open a support ticket with:",
      "- the system name",
      "- what you need access to",
      "- why you need it"
    ].join("\n");
  }

  return [
    outcome,
    "I checked this safely.",
    "",
    "What I found:",
    supportFinding(response),
    "",
    "No changes were made.",
    "",
    "Next step:",
    nextStep
  ].join("\n");
}

function governedChatAnswer(response: ResolveResponse): string {
  return buildEndUserSupportAnswer(response);
}

function shortHash(value?: string): string {
  return value ? value.slice(0, 12) : "not declared";
}

function connectorRuntimeFailureCopy(error?: string, message?: string): { title: string; body: string; nextStep?: string } {
  if (error === "connector_configuration_changed") {
    return {
      title: "Needs re-verification",
      body: message ?? "The external connector configuration changed after the Gateway trusted its onboarding attestation.",
      nextStep: "Re-run Gateway onboarding to refresh trusted connector attestation."
    };
  }

  if (error === "skill_not_currently_approved") {
    return {
      title: "Connector runtime refused execution",
      body: message ?? "The skill is no longer approved by current connector configuration.",
      nextStep: "Enable the skill and required access in the external admin console, then re-run Gateway onboarding."
    };
  }

  return {
    title: "Connector approved, runtime failed safely",
    body: message ?? error ?? "External connector runtime failed.",
    nextStep: "Check the local external agent and Mock IdP, then retry."
  };
}

function firstSentence(text: string, maxLength = 190): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "No gateway response has been generated yet.";
  }

  const sentenceMatch = trimmed.match(/^(.+?[.!?])(\s|$)/);
  const sentence = sentenceMatch?.[1] ?? trimmed;
  if (sentence.length <= maxLength) {
    return sentence;
  }

  const clipped = sentence.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 80 ? lastSpace : maxLength).trim()}...`;
}

function recommendedActionItems(text: string): string[] {
  const items = text
    .split(/[;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length ? items : [text.trim()].filter(Boolean);
}

function policyOutcomeLabel(policy: string): string {
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

function tokenOutcomeLabel(token: string): string {
  if (token === "issued") {
    return "Scoped token issued";
  }
  if (token === "not issued") {
    return "Scoped token not issued";
  }

  return "No token issued yet";
}

function buildSecurityTimelineEvents(response: ResolveResponse): SecurityTimelineEvent[] {
  const events: SecurityTimelineEvent[] = [];
  const firstTraceTimestamp = response.executionTrace[0]?.timestamp ?? response.agentTrace[0]?.timestamp;

  events.push({
    id: "identity-verified",
    category: "identity",
    title: "User identity verified",
    description: `Verified user ${response.userIdentity.email ?? "unknown"} was attached to this gateway session.`,
    status: "success",
    timestamp: firstTraceTimestamp,
    actor: response.userIdentity.email,
    metadata: metadataList([
      { label: "Email", value: response.userIdentity.email },
      { label: "Roles", value: response.userIdentity.roles ?? [] }
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

  for (const [index, decision] of (response.securityDecisions ?? (response.securityDecision ? [response.securityDecision] : [])).entries()) {
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

  events.push({
    id: "final-answer",
    category: "audit",
    title: "Final answer generated",
    description: "Gateway summarized agent findings and returned response.",
    status: finalStatus(response.resolutionStatus),
    timestamp: response.executionTrace[response.executionTrace.length - 1]?.timestamp,
    actor: "orchestrator",
    metadata: metadataList([
      { label: "Resolution status", value: response.resolutionStatus },
      { label: "Selected agents", value: response.selectedAgents.length },
      { label: "A2A tasks", value: response.a2aTasks?.length ?? 0 },
      { label: "Final answer", value: response.finalAnswer }
    ])
  });

  return events;
}

function securityTimelineFilterMatches(event: SecurityTimelineEvent, filter: SecurityTimelineFilter): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "response-audit") {
    return event.category === "response" || event.category === "audit";
  }

  return event.category === filter;
}

function safeTaskAuthMetadata(auth: ResolveA2ATask["context"]["auth"] | undefined) {
  if (!auth) {
    return undefined;
  }

  return {
    authMode: auth.authMode,
    issuer: auth.issuer,
    audience: auth.audience,
    scope: auth.scope,
    tokenIssued: auth.tokenIssued,
    tokenValidated: auth.tokenValidated,
    validationReason: auth.validationReason,
    delegatedBy: auth.delegatedBy,
    delegationDepth: auth.delegationDepth,
    parentTaskId: auth.parentTaskId,
    requestedByAgent: auth.requestedByAgent,
    actor: auth.actor,
    actorRoles: auth.actorRoles,
    tokenAuthMethod: auth.tokenAuthMethod,
    rawToken: "hidden"
  };
}

function safeRawExecutionData(response: ResolveResponse) {
  return {
    userIdentity: response.userIdentity,
    requestInterpretation: response.requestInterpretation,
    securityIntent: response.securityIntent,
    executionGateStack: response.executionGateStack,
    connectorActionPlan: response.connectorActionPlan,
    evaluatedActionPlan: response.evaluatedActionPlan,
    connectorRouting: response.connectorRouting,
    connectorRuntime: response.connectorRuntime,
    selectedAgents: response.selectedAgents,
    securityDecisions: response.securityDecisions ?? (response.securityDecision ? [response.securityDecision] : []),
    executionTrace: response.executionTrace,
    agentTrace: response.agentTrace,
    a2aTasks: response.a2aTasks?.map((task) => ({
      taskId: task.taskId,
      fromAgent: task.fromAgent,
      toAgent: task.toAgent,
      skillId: task.skillId,
      mediatedBy: task.mediatedBy,
      delegationDepth: task.delegationDepth,
      actor: task.context.actor,
      auth: safeTaskAuthMetadata(task.context.auth)
    })) ?? [],
    a2aResponses: response.a2aResponses?.map((agentResponse) => ({
      agentId: agentResponse.agentId,
      status: agentResponse.status,
      summary: agentResponse.summary,
      evidence: agentResponse.evidence,
      trace: agentResponse.trace
    })) ?? []
  };
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

function healthClass(status: string): string {
  return `health-${status}`;
}

function endpointMetadata(endpoint: string | undefined): { endpointType: AgentCardEndpointType; endpointScheme: AgentCardEndpointScheme } {
  if (!endpoint) {
    return { endpointType: "unknown", endpointScheme: "unknown" };
  }

  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol === "session:") {
      return { endpointType: "session", endpointScheme: "session" };
    }
    if (parsed.protocol === "https:") {
      return { endpointType: "public", endpointScheme: "https" };
    }
    if (parsed.protocol === "http:") {
      return { endpointType: "public", endpointScheme: "http" };
    }
  } catch {
    return { endpointType: "unknown", endpointScheme: "unknown" };
  }

  return { endpointType: "unknown", endpointScheme: "unknown" };
}

function endpointTypeLabel(endpointType: AgentCardEndpointType | "internal", endpointScheme?: AgentCardEndpointScheme): string {
  if (endpointType === "public" && endpointScheme && endpointScheme !== "unknown") {
    return `public ${endpointScheme}`;
  }

  return endpointType;
}

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  status?: "loading" | "done";
  metadata?: ResolveResponse;
};

type AgentCardEndpointType = "public" | "session" | "unknown";
type AgentCardEndpointScheme = "https" | "http" | "session" | "unknown";

type DerivedCapability = {
  capability: string;
  label?: string;
  reason: string;
  requiredApplicationGrants?: string[];
  requiredEffectivePermissions?: string[];
  missingApplicationGrants?: string[];
  missingEffectivePermissions?: string[];
  deniedEffectivePermissions?: string[];
};

type TrustedOnboardedAgent = {
  agentId: string;
  issuer: string;
  clientId: string;
  audience: string;
  runtimeEndpoint?: string;
  connectorProfileUrl?: string;
  connectorId?: string;
  resourceSystem?: string;
  connectorDisplayName?: string;
  requestedScopes: string[];
  requestedApplicationGrants?: string[];
  agentDeclaredSkills?: string[];
  agentDeclaredCapabilities: string[];
  applicationAccessGrants?: string[];
  grantedScopes: string[];
  approvedActions?: DerivedCapability[];
  blockedActions?: DerivedCapability[];
  approvedCapabilities: DerivedCapability[];
  blockedCapabilities: DerivedCapability[];
  connectorProfile?: ConnectorProfileSummary;
  connectorProfileVerified?: boolean;
  lifecycle?: {
    state: "installed" | "verified" | "runtime_ready" | "needs_reverification" | "runtime_blocked" | "disabled" | "revoked";
    label: string;
    reason: string;
  };
  connectorDecisionSource?: string;
  externalConfigHash?: string;
  connectorProfileHash?: string;
  resourcePrincipal?: string;
  trustLevel: "untrusted" | "schema_valid" | "oauth_bound" | "signed_response_verified" | "endpoint_control_verified" | "trusted_metadata_only" | "executable_pending_runtime_validation";
  executable: false;
  executionState: "metadata_only";
  tokenEndpointAuthMethod: "private-key-jwt" | "client-secret-post" | "unknown";
  oauthApplicationBound: boolean;
};

type AgentOnboardingResult = {
  onboardingId: string;
  status: "trusted_metadata_only";
  trustLevel: TrustedOnboardedAgent["trustLevel"];
  discoveredAgent: {
    agentId: string;
    issuer: string;
    clientId: string;
    audience: string;
    requestedScopes: string[];
    requestedApplicationGrants?: string[];
    agentDeclaredSkills?: string[];
    agentDeclaredCapabilities: string[];
  };
  agent: {
    agentId: string;
    issuer: string;
    clientId: string;
    audience: string;
  };
  gatewayProof: {
    gatewayClientId: string;
    gatewayIssuer: string;
    signedChallengeVerifiedByAgent: boolean;
    rawAssertionExposed: false;
  };
  agentProof: {
    discoveryFetched: boolean;
    externalAgentContacted: boolean;
    signedResponseVerified: boolean;
    nonceMatched: boolean;
  };
  oauthApplicationProof: {
    clientBound: boolean;
    applicationAccessGrants?: string[];
    grantedScopes: string[];
    missingRequestedApplicationGrants?: string[];
    allowedClientId?: string;
    tokenEndpointAuthMethod?: "private-key-jwt" | "client-secret-post" | "unknown";
    status?: "active" | "disabled";
  };
  resourcePermissionProof: {
    principal: string;
    effectivePermissions: string[];
    deniedPermissions: string[];
  };
  externalApplicationAttestation?: {
    resourceSystem?: string;
    connectorId?: string;
    connectorProfileUrl?: string;
    connectorProfileHash?: string;
    externalConfigHash?: string;
    trustAdapter?: string;
    oauthApplication?: {
      appName?: string;
      clientId: string;
      authorizationServerIssuer: string;
      applicationAccessGrants?: string[];
      grantedScopes: string[];
      tokenEndpointAuthMethod: string;
      status: string;
    };
    servicePrincipal?: {
      principalType: string;
      principalId: string;
      effectivePermissions: string[];
      deniedPermissions: string[];
    };
  };
  connectorProfile?: ConnectorProfileSummary;
  connectorProfileVerified: boolean;
  connectorDecisionSource: string;
  skillDecision?: {
    approvedActions: DerivedCapability[];
    blockedActions: DerivedCapability[];
  };
  capabilityDecision: {
    approvedCapabilities: DerivedCapability[];
    blockedCapabilities: DerivedCapability[];
  };
  checks: Array<{ name: string; status: "passed" | "failed" | "metadata_only"; detail?: string }>;
  message: string;
  trustedAgent: TrustedOnboardedAgent;
  trustedAgents?: TrustedOnboardedAgent[];
};

type ConnectorProfileSummary = {
  connectorId: string;
  resourceSystem: string;
  displayName: string;
  version: string;
  profileSource: "external_agent" | "built_in_reference" | "custom_connector";
  validationTests?: ConnectorValidationTest[];
};

type ConnectorValidationTestCategory =
  | "end_user_planning"
  | "approved_diagnostic"
  | "blocked_write_action"
  | "adversarial"
  | "unsupported_handoff";

type ConnectorValidationTestOutcome =
  | "needs_more_info"
  | "planned"
  | "check_ready"
  | "diagnosed"
  | "blocked"
  | "unsupported";

type ConnectorValidationTestStep = {
  message: string;
  expectedOutcome: ConnectorValidationTestOutcome;
};

type ConnectorValidationTest = {
  id: string;
  title: string;
  category: ConnectorValidationTestCategory;
  persona: "end_user" | "bizapps_it" | "security";
  description: string;
  proves: string;
  steps: ConnectorValidationTestStep[];
  expectedFinalOutcome: ConnectorValidationTestOutcome;
  requiresPlanning?: boolean;
  requiresRuntimeReady?: boolean;
  referenceOnly?: boolean;
};

type GatewayRegistrationMetadata = {
  gatewayId: string;
  issuer: string;
  clientId: string;
  jwksUri: string;
  supportedOnboardingMethods: string[];
};

type SupportedConnectorGuardrail = {
  resourceSystem: string;
  connectorId: string;
  displayName: string;
  status: "available" | "coming_soon" | "planned";
  source?: "local_reference" | "custom_sdk";
  description?: string;
  category?: "ITSM" | "DevOps" | "Work Management" | "Custom";
  publisher?: string;
  templateVersion?: string;
  authModel?: "oauth_application_with_service_account" | "custom_sdk_contract";
  runtimeSupport?: "supported" | "planned" | "not_supported";
  riskLevel?: "low" | "medium" | "high";
  tags?: string[];
  docsUrl?: string;
  setupRequirements?: string[];
  installed?: boolean;
  installedCount?: number;
};

type AgentDiscoveryMetadata = {
  agentId: string;
  issuer: string;
  resourceSystem?: string;
  connectorId?: string;
  connectorDisplayName?: string;
  connectorProfileUrl?: string;
  externalConfigHash?: string;
  supportedConnectorProfileUrl?: string;
  trustAdapter?: string;
  jwksUri: string;
  onboardingEndpoint: string;
  runtimeEndpoint: string;
  adminConsoleUrl?: string;
  auth: {
    audience: string;
    tokenEndpointAuthMethod: "private_key_jwt" | "client_secret_post" | "unknown";
  };
  connectionRequirements?: {
    requiresGatewayRegistration: boolean;
    requiresOAuthApplication: boolean;
    requiresServicePrincipal: boolean;
  };
};

type AgentOnboardingDiscoveryResult = {
  discovered: true;
  agentBaseUrl: string;
  expectedAgentId: string;
  discovery: AgentDiscoveryMetadata;
  gatewayRegistration: GatewayRegistrationMetadata;
  connectionInstructions: {
    admin: string[];
    externalAgentDeveloper: string[];
  };
  checks: AgentOnboardingResult["checks"];
};

type RegisteredAgentSource = "zero-trust-onboarded" | "built-in" | "infrastructure";

type RegisteredAgentRow = {
  agentId: string;
  status: string;
  endpointType: AgentCardEndpointType | "internal";
  endpointScheme: AgentCardEndpointScheme;
  authMode: string;
  latencyMs?: number;
  agentCardAvailable: boolean;
  error?: string;
  canDelete: boolean;
  source: RegisteredAgentSource;
  trustLevel?: TrustedOnboardedAgent["trustLevel"];
  requestedScopes?: string[];
  agentDeclaredSkills?: string[];
  agentDeclaredCapabilities?: string[];
  grantedScopes?: string[];
  approvedActions?: DerivedCapability[];
  blockedActions?: DerivedCapability[];
  approvedCapabilities?: DerivedCapability[];
  blockedCapabilities?: DerivedCapability[];
  resourcePrincipal?: string;
  runtimeEndpoint?: string;
  connectorId?: string;
  resourceSystem?: string;
  connectorDisplayName?: string;
  externalConfigHash?: string;
  connectorProfileVerified?: boolean;
  lifecycle?: {
    state: "installed" | "verified" | "runtime_ready" | "needs_reverification" | "runtime_blocked" | "disabled" | "revoked";
    label: string;
    reason: string;
  };
  oauthApplicationBound?: boolean;
  executable?: boolean;
  executionState?: "metadata_only";
};

type IdentitySessionResponse = {
  authenticated: boolean;
  user: {
    email: string;
    name?: string;
    roles: string[];
  } | null;
  issuer: string;
  audience: "secure-a2a-gateway";
};

type TrustStatusResponse = {
  userIdentity: IdentitySessionResponse & {
    rawTokenExposed: false;
  };
  gatewayIdentity: {
    agentId: string;
    a2aAuthMode: string;
    secureAuthRequired: boolean;
    tokenAuthMethod: "private-key-jwt" | "client-secret-post" | "unknown";
    actorPropagationEnabled: boolean;
  };
  mockIdp: {
    issuer: string;
    jwksUri: string;
    tokenEndpoint: string;
    userTokenEndpoint: string;
    rawKeysExposed: boolean;
  };
  securityControls: {
    rawTokensDisplayed: boolean;
    agentOnboardingFetchesExternalUrls: boolean;
    externalAgentsExecutable: boolean;
    agentCardSecretsRejected: boolean;
    userIdentityRequiredForResolve: boolean;
    privateKeyJwtReplayProtection: "configured" | "unknown";
    ipAllowlist: "configured" | "disabled" | "unknown";
  };
};

type SecurityTimelineCategory =
  | "identity"
  | "routing"
  | "policy"
  | "token"
  | "agent"
  | "delegation"
  | "response"
  | "audit";

type SecurityTimelineStatus = "success" | "warning" | "blocked" | "info";

type SecurityTimelineEvent = {
  id: string;
  category: SecurityTimelineCategory;
  title: string;
  description: string;
  status: SecurityTimelineStatus;
  timestamp?: string;
  actor?: string;
  agentId?: string;
  metadata?: Array<{ label: string; value: string }>;
};

type SecurityTimelineFilter =
  | "all"
  | "identity"
  | "routing"
  | "policy"
  | "token"
  | "agent"
  | "delegation"
  | "response-audit";

const securityTimelineFilters: Array<{ id: SecurityTimelineFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "identity", label: "Identity" },
  { id: "routing", label: "Routing" },
  { id: "policy", label: "Policy" },
  { id: "token", label: "Token" },
  { id: "agent", label: "Agent" },
  { id: "delegation", label: "Delegation" },
  { id: "response-audit", label: "Response/Audit" }
];

const demoUserOptions = [
  { email: "ran@company.com", label: "Ran Keselman", roleLabel: "it-support" },
  { email: "analyst@company.com", label: "Security Analyst", roleLabel: "read-only" },
  { email: "admin@company.com", label: "Identity Admin", roleLabel: "identity-admin" }
];

async function friendlyApiError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  let body: { error?: string; details?: string[]; limit?: number } | undefined;

  try {
    body = text ? JSON.parse(text) as { error?: string; details?: string[]; limit?: number } : undefined;
  } catch {
    body = undefined;
  }

  if (response.status === 429 || body?.error === "Too many requests") {
    return "Too many requests. Wait a minute and try again.";
  }

  if (body?.error === "Session required") {
    return "Your browser session expired. Refresh the page and try again.";
  }

  if (body?.error) {
    return `${fallback}: ${body.error}`;
  }

  return text ? `${fallback}: ${text}` : `${fallback} (${response.status})`;
}

function createMessageId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function MessageList({ messages }: { messages: ChatMessage[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <section className="task-transcript" aria-label="Conversation">
      <div className="section-heading-row">
        <div>
          <p className="active-panel-eyebrow">Conversation</p>
          <h2>Gateway Runtime Chat</h2>
        </div>
      </div>
      {messages.map((chatMessage) => (
        <article
          className={`task-message-card chat-bubble ${chatMessage.role === "user" ? "request-card user-message" : "gateway-response-card assistant-message"} ${chatMessage.status === "loading" ? "loading" : ""
            }`}
          key={chatMessage.id}
        >
          <span>{chatMessage.role === "user" ? "You" : "Secure A2A Gateway"}</span>
          <p>{chatMessage.content}</p>
        </article>
      ))}
      {messages.length === 0 ? (
        <div className="empty-state compact">Ask about Jira, ServiceNow, GitHub, or try to request a blocked action.</div>
      ) : null}
      <div ref={endRef} />
    </section>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("demo-guide");
  const [message, setMessage] = useState(sampleMessage);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [health, setHealth] = useState<AgentsHealthResponse | null>(null);
  const [healthError, setHealthError] = useState("");
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [zeroTrustAgentBaseUrl, setZeroTrustAgentBaseUrl] = useState("http://localhost:4201");
  const [zeroTrustExpectedAgentId, setZeroTrustExpectedAgentId] = useState("external-jira-agent");
  const [zeroTrustExpectedResourceSystem, setZeroTrustExpectedResourceSystem] = useState("");
  const [zeroTrustExpectedConnectorId, setZeroTrustExpectedConnectorId] = useState("");
  const [supportedConnectorGuardrails, setSupportedConnectorGuardrails] = useState<SupportedConnectorGuardrail[]>(fallbackSupportedConnectorGuardrails);
  const [zeroTrustOnboardedAgents, setZeroTrustOnboardedAgents] = useState<TrustedOnboardedAgent[]>([]);
  const [zeroTrustDiscovery, setZeroTrustDiscovery] = useState<AgentOnboardingDiscoveryResult | null>(null);
  const [zeroTrustResult, setZeroTrustResult] = useState<AgentOnboardingResult | null>(null);
  const [zeroTrustError, setZeroTrustError] = useState("");
  const [zeroTrustCopyMessage, setZeroTrustCopyMessage] = useState("");
  const [gatewayRegistrationMetadata, setGatewayRegistrationMetadata] = useState<GatewayRegistrationMetadata | null>(null);
  const [connectionAudience, setConnectionAudience] = useState<ConnectionAudience>("bizapps");
  const [connectionWizardStep, setConnectionWizardStep] = useState<ConnectionWizardStep>("overview");
  const [connectionWizardCollapsedAfterSuccess, setConnectionWizardCollapsedAfterSuccess] = useState(false);
  const [customConnectorContractOpen, setCustomConnectorContractOpen] = useState(false);
  const [expandedInstalledAgentIds, setExpandedInstalledAgentIds] = useState<string[]>([]);
  const [selectedInstalledConnectorTemplateId, setSelectedInstalledConnectorTemplateId] = useState<string | undefined>();
  const [isZeroTrustDiscovering, setIsZeroTrustDiscovering] = useState(false);
  const [isZeroTrustOnboarding, setIsZeroTrustOnboarding] = useState(false);
  const [identitySession, setIdentitySession] = useState<IdentitySessionResponse | null>(null);
  const [trustStatus, setTrustStatus] = useState<TrustStatusResponse | null>(null);
  const [selectedDemoUserEmail, setSelectedDemoUserEmail] = useState(demoUserOptions[0].email);
  const [identityError, setIdentityError] = useState("");
  const [identityMessage, setIdentityMessage] = useState("");
  const [isIdentityLoading, setIsIdentityLoading] = useState(false);
  const [securityTimelineFilter, setSecurityTimelineFilter] = useState<SecurityTimelineFilter>("all");
  const [pendingFocusTarget, setPendingFocusTarget] = useState<GuidedFocusTarget | null>(null);
  const [guidedStatus, setGuidedStatus] = useState("");
  const demoGuideRootRef = useRef<HTMLElement | null>(null);
  const runTaskRootRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const taskTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gatewayResponseRef = useRef<HTMLElement | null>(null);
  const securitySummaryRef = useRef<HTMLElement | null>(null);
  const trustIdentityRootRef = useRef<HTMLElement | null>(null);
  const loginPanelRef = useRef<HTMLElement | null>(null);
  const demoUserSelectRef = useRef<HTMLSelectElement | null>(null);
  const loginButtonRef = useRef<HTMLButtonElement | null>(null);
  const agentRegistryRootRef = useRef<HTMLElement | null>(null);
  const connectorTestCenterRootRef = useRef<HTMLElement | null>(null);
  const connectorCatalogRef = useRef<HTMLElement | null>(null);
  const zeroTrustOnboardingRef = useRef<HTMLElement | null>(null);
  const registeredAgentsRef = useRef<HTMLElement | null>(null);
  const legacyAgentsRef = useRef<HTMLDetailsElement | null>(null);
  const securityTimelineRootRef = useRef<HTMLElement | null>(null);
  const timelineListRef = useRef<HTMLElement | null>(null);
  const latestResponse = useMemo(
    () => [...messages].reverse().find((item) => item.role === "assistant" && item.status === "done" && item.metadata)?.metadata ?? null,
    [messages]
  );
  const securityTimelineEvents = useMemo(
    () => latestResponse ? buildSecurityTimelineEvents(latestResponse) : [],
    [latestResponse]
  );
  const visibleSecurityTimelineEvents = useMemo(
    () => securityTimelineEvents.filter((event) => securityTimelineFilterMatches(event, securityTimelineFilter)),
    [securityTimelineEvents, securityTimelineFilter]
  );
  const healthLabel = health
    ? `${health.summary.healthy}/${health.summary.total} healthy`
    : "Agents unknown";
  const authModeLabel = health?.orchestrator.authMode === "oauth2_client_credentials_jwt"
    ? "Secure A2A JWT"
    : "Local mock";
  const userBadgeLabel = identitySession?.authenticated && identitySession.user
    ? identitySession.user.email
    : "Login required";
  const builtInAgentsCount = health?.agents.filter((agent) => agent.endpointType !== "session" && !infrastructureAgentIds.has(agent.agentId)).length ?? 0;
  const healthyAgentsCount = health?.summary.healthy ?? 0;
  const registeredAgentRows: RegisteredAgentRow[] = [
    ...zeroTrustOnboardedAgents.map((agent) => ({
      agentId: agent.agentId,
      status: "unknown",
      endpointType: "public" as const,
      endpointScheme: endpointMetadata(agent.issuer).endpointScheme,
      authMode: agent.tokenEndpointAuthMethod,
      latencyMs: undefined,
      agentCardAvailable: true,
      error: undefined,
      canDelete: false,
      source: "zero-trust-onboarded" as const,
      trustLevel: agent.trustLevel,
      requestedScopes: agent.requestedScopes,
      agentDeclaredSkills: agent.agentDeclaredSkills,
      agentDeclaredCapabilities: agent.agentDeclaredCapabilities,
      grantedScopes: agent.grantedScopes,
      approvedActions: agent.approvedActions,
      blockedActions: agent.blockedActions,
      approvedCapabilities: agent.approvedCapabilities,
      blockedCapabilities: agent.blockedCapabilities,
      resourcePrincipal: agent.resourcePrincipal,
      runtimeEndpoint: agent.runtimeEndpoint,
      connectorId: agent.connectorId ?? agent.connectorProfile?.connectorId,
      resourceSystem: agent.resourceSystem ?? agent.connectorProfile?.resourceSystem,
      connectorDisplayName: agent.connectorDisplayName ?? agent.connectorProfile?.displayName,
      externalConfigHash: agent.externalConfigHash,
      connectorProfileVerified: agent.connectorProfileVerified,
      lifecycle: agent.lifecycle,
      oauthApplicationBound: agent.oauthApplicationBound,
      executable: agent.executable,
      executionState: agent.executionState
    })),
    ...(health?.agents.map((agent) => ({
      agentId: agent.agentId,
      status: agent.status,
      endpointType: agent.endpointType,
      endpointScheme: "unknown" as const,
      authMode: "unknown",
      latencyMs: agent.latencyMs,
      agentCardAvailable: agent.details.agentCardAvailable,
      error: agent.error,
      canDelete: false,
      source: infrastructureAgentIds.has(agent.agentId) ? "infrastructure" as const : "built-in" as const
    })) ?? [])
  ];
  const latestActorAttached = latestResponse?.userIdentity.authenticated === true;
  const latestActorTokenObserved = Boolean(latestResponse?.a2aTasks?.some((task) =>
    Boolean(task.context.auth?.actor) ||
    Boolean(task.context.auth?.actorRoles?.length) ||
    Boolean(task.context.actor?.email)
  ));
  const latestActorRoles = latestResponse?.userIdentity.roles?.join(", ") ?? "none";
  const isUserAuthenticated = identitySession?.authenticated === true || trustStatus?.userIdentity.authenticated === true;
  const connectorTemplateCount = supportedConnectorGuardrails.length;
  const installedConnectorAgentCount = zeroTrustOnboardedAgents.length;
  const runtimeReadyConnectorAgentCount = zeroTrustOnboardedAgents.filter((agent) => {
    const approvedCount = (agent.approvedActions ?? agent.approvedCapabilities)?.length ?? 0;
    return agent.lifecycle?.state === "runtime_ready" || (
      approvedCount > 0 &&
      agent.connectorProfileVerified === true &&
      Boolean(agent.runtimeEndpoint) &&
      Boolean(agent.externalConfigHash)
    );
  }).length;
  const latestRequest = [...messages].reverse().find((item) => item.role === "user")?.content ?? "";
  const executionState = isUserAuthenticated ? "allowed" : "login required";
  const authModeSummary = health?.orchestrator.authMode ?? trustStatus?.gatewayIdentity.a2aAuthMode ?? "unknown";
  const lastResult = lastResultLabel(latestResponse);
  const policySummary = primaryPolicyLabel(latestResponse);
  const tokenSummary = tokenStatusLabel(latestResponse);
  const delegationSummary = delegationLabel(latestResponse);
  const primarySelectedAgent = latestResponse?.selectedAgents[0]?.agentId ?? "none";
  const actorEmail = latestResponse?.userIdentity.email ?? identitySession?.user?.email;
  const policyOutcome = policyOutcomeLabel(policySummary);
  const tokenOutcome = tokenOutcomeLabel(tokenSummary);

  function scrollToRef<T extends HTMLElement>(ref: React.RefObject<T | null>, options?: ScrollIntoViewOptions) {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start", ...options });
  }

  function focusElement<T extends HTMLElement>(ref: React.RefObject<T | null>) {
    ref.current?.focus({ preventScroll: true });
  }

  function highlightSection<T extends HTMLElement>(ref: React.RefObject<T | null>) {
    const element = ref.current;
    if (!element) {
      return;
    }

    element.classList.remove("focus-pulse");
    window.setTimeout(() => {
      element.classList.add("focus-pulse");
      window.setTimeout(() => element.classList.remove("focus-pulse"), 1520);
    }, 0);
  }

  function guideToTarget(target: GuidedFocusTarget) {
    setPendingFocusTarget(target);
  }

  function showGuidedStatus(messageText: string) {
    setGuidedStatus(messageText);
  }

  function goToTrustIdentity() {
    setActiveTab("trust-identity");
    showGuidedStatus("Moved to Trust & Identity");
    guideToTarget("trust-login");
  }

  function goToRunTask() {
    setActiveTab("run-task");
    showGuidedStatus("Moved to Run Task");
    guideToTarget("composer");
  }

  function goToAgentRegistry() {
    setActiveTab("agent-registry");
    showGuidedStatus("Moved to Agent Registry");
    guideToTarget("agent-registry");
  }

  function goToConnectorCatalog() {
    setActiveTab("agent-registry");
    showGuidedStatus("Moved to Connector Catalog");
    guideToTarget("connector-catalog");
  }

  function goToInstalledConnectorAgents() {
    setActiveTab("agent-registry");
    showGuidedStatus("Installed Connector Agents highlighted");
    guideToTarget("registered-agents");
  }

  function goToSecurityTimeline() {
    setActiveTab("security-timeline");
    showGuidedStatus("Moved to Security Timeline");
    guideToTarget("security-timeline");
  }

  function hasInstalledConnector(connectorId: string) {
    return zeroTrustOnboardedAgents.some((agent) => (agent.connectorId ?? agent.connectorProfile?.connectorId) === connectorId);
  }

  function hasApprovedSkill(connectorId: string, skillId: string) {
    return zeroTrustOnboardedAgents.some((agent) =>
      (agent.connectorId ?? agent.connectorProfile?.connectorId) === connectorId &&
      (agent.approvedActions ?? agent.approvedCapabilities ?? []).some((action) => action.capability === skillId)
    );
  }

  function hasBlockedSkill(connectorId: string, skillId: string) {
    return zeroTrustOnboardedAgents.some((agent) =>
      (agent.connectorId ?? agent.connectorProfile?.connectorId) === connectorId &&
      (agent.blockedActions ?? agent.blockedCapabilities ?? []).some((action) => action.capability === skillId)
    );
  }

  function readinessStatusForSkill(connectorId: string, skillId: string, expected: "approved" | "blocked"): "ready" | "missing_connector" | "runtime_blocked" {
    if (!hasInstalledConnector(connectorId)) {
      return "missing_connector";
    }
    if (expected === "approved") {
      return hasApprovedSkill(connectorId, skillId) ? "ready" : "runtime_blocked";
    }
    return hasBlockedSkill(connectorId, skillId) ? "ready" : "runtime_blocked";
  }

  async function checkAgentHealth() {
    setHealthError("");
    setIsHealthLoading(true);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agents/health`, {
        method: "GET",
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to check agent health"));
      }

      setHealth((await response.json()) as AgentsHealthResponse);
    } catch (caughtError) {
      setHealthError(caughtError instanceof Error ? caughtError.message : "Failed to check agent health");
    } finally {
      setIsHealthLoading(false);
    }
  }

  useEffect(() => {
    void loadZeroTrustOnboardedAgents();
    void checkAgentHealth();
    void loadTrustStatus();
    void loadGatewayRegistrationMetadata();
    void loadSupportedConnectorGuardrails();
  }, []);

  useEffect(() => {
    if (activeTab === "demo-guide") {
      void loadZeroTrustOnboardedAgents();
      void loadSupportedConnectorGuardrails();
      void loadTrustStatus();
    }
    if (activeTab === "agent-registry") {
      void loadZeroTrustOnboardedAgents();
      void checkAgentHealth();
    }
    if (activeTab === "trust-identity") {
      void loadTrustStatus();
    }
  }, [activeTab]);

  useEffect(() => {
    if (!pendingFocusTarget) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (pendingFocusTarget === "demo-guide") {
        scrollToRef(demoGuideRootRef);
        highlightSection(demoGuideRootRef);
      }
      if (pendingFocusTarget === "run-task") {
        scrollToRef(runTaskRootRef);
        highlightSection(runTaskRootRef);
      }
      if (pendingFocusTarget === "composer") {
        scrollToRef(composerRef);
        highlightSection(composerRef);
        focusElement(taskTextareaRef);
      }
      if (pendingFocusTarget === "gateway-response") {
        scrollToRef(gatewayResponseRef);
        highlightSection(gatewayResponseRef);
      }
      if (pendingFocusTarget === "security-summary") {
        scrollToRef(securitySummaryRef);
        highlightSection(securitySummaryRef);
      }
      if (pendingFocusTarget === "trust-login") {
        scrollToRef(loginPanelRef);
        highlightSection(loginPanelRef);
        if (demoUserSelectRef.current) {
          focusElement(demoUserSelectRef);
        } else if (loginButtonRef.current) {
          focusElement(loginButtonRef);
        }
      }
      if (pendingFocusTarget === "agent-registry") {
        scrollToRef(agentRegistryRootRef);
        highlightSection(agentRegistryRootRef);
      }
      if (pendingFocusTarget === "connector-test-center") {
        scrollToRef(connectorTestCenterRootRef);
        highlightSection(connectorTestCenterRootRef);
      }
      if (pendingFocusTarget === "connector-catalog") {
        scrollToRef(connectorCatalogRef);
        highlightSection(connectorCatalogRef);
      }
      if (pendingFocusTarget === "zero-trust-onboarding") {
        scrollToRef(zeroTrustOnboardingRef);
        highlightSection(zeroTrustOnboardingRef);
      }
      if (pendingFocusTarget === "registered-agents") {
        scrollToRef(registeredAgentsRef);
        highlightSection(registeredAgentsRef);
      }
      if (pendingFocusTarget === "legacy-agents") {
        scrollToRef(legacyAgentsRef);
        highlightSection(legacyAgentsRef);
      }
      if (pendingFocusTarget === "security-timeline") {
        const targetRef = timelineListRef.current ? timelineListRef : securityTimelineRootRef;
        scrollToRef(targetRef);
        highlightSection(targetRef);
      }
      setPendingFocusTarget(null);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeTab, pendingFocusTarget, latestResponse, registeredAgentRows.length, zeroTrustResult]);

  useEffect(() => {
    if (!guidedStatus) {
      return;
    }

    const timeoutId = window.setTimeout(() => setGuidedStatus(""), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [guidedStatus]);

  async function ensureSession() {
    const response = await fetch(`${API_URL}/session`, {
      method: "POST",
      credentials: "include"
    });

    if (!response.ok) {
      throw new Error(await friendlyApiError(response, "Failed to create browser session"));
    }
  }

  async function loadIdentitySession() {
    setIdentityError("");
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/identity/session`, {
        method: "GET",
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to load identity session"));
      }

      setIdentitySession((await response.json()) as IdentitySessionResponse);
    } catch (caughtError) {
      setIdentityError(caughtError instanceof Error ? caughtError.message : "Failed to load identity session");
    }
  }

  async function loadTrustStatus() {
    setIdentityError("");
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/identity/trust-status`, {
        method: "GET",
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to load trust status"));
      }

      const body = (await response.json()) as TrustStatusResponse;
      setTrustStatus(body);
      setIdentitySession({
        authenticated: body.userIdentity.authenticated,
        user: body.userIdentity.user,
        issuer: body.userIdentity.issuer,
        audience: body.userIdentity.audience
      });
    } catch (caughtError) {
      setIdentityError(caughtError instanceof Error ? caughtError.message : "Failed to load trust status");
    }
  }

  async function loginDemoUser() {
    setIdentityError("");
    setIdentityMessage("");
    setIsIdentityLoading(true);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/identity/demo-login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: selectedDemoUserEmail })
      });

      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to login as demo user"));
      }

      const body = (await response.json()) as IdentitySessionResponse;
      setIdentitySession(body);
      setIdentityMessage("Demo user identity verified and attached to this gateway session.");
      await loadTrustStatus();
      guideToTarget("trust-login");
    } catch (caughtError) {
      setIdentityError(caughtError instanceof Error ? caughtError.message : "Failed to login as demo user");
    } finally {
      setIsIdentityLoading(false);
    }
  }

  async function logoutIdentity() {
    setIdentityError("");
    setIdentityMessage("");
    setIsIdentityLoading(true);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/identity/logout`, {
        method: "POST",
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to logout demo user"));
      }

      setIdentitySession((await response.json()) as IdentitySessionResponse);
      setIdentityMessage("Demo user identity cleared from this gateway session.");
      await loadTrustStatus();
    } catch (caughtError) {
      setIdentityError(caughtError instanceof Error ? caughtError.message : "Failed to logout demo user");
    } finally {
      setIsIdentityLoading(false);
    }
  }

  async function loadZeroTrustOnboardedAgents() {
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agent-onboarding`, {
        method: "GET",
        credentials: "include"
      });
      if (!response.ok) {
        throw new Error(await friendlyApiError(response, "Failed to load zero-trust onboarded agents"));
      }
      const body = await response.json() as { agents: TrustedOnboardedAgent[] };
      setZeroTrustOnboardedAgents(body.agents);
    } catch (caughtError) {
      setZeroTrustError(caughtError instanceof Error ? caughtError.message : "Failed to load zero-trust onboarded agents");
    }
  }

  async function loadGatewayRegistrationMetadata() {
    try {
      const response = await fetch(`${API_URL}/.well-known/a2a-gateway.json`, {
        method: "GET",
        credentials: "include"
      });
      if (response.ok) {
        setGatewayRegistrationMetadata((await response.json()) as GatewayRegistrationMetadata);
      }
    } catch {
      setGatewayRegistrationMetadata(null);
    }
  }

  async function loadSupportedConnectorGuardrails() {
    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agent-onboarding/supported-connectors`, {
        method: "GET",
        credentials: "include"
      });
      if (response.ok) {
        const body = await response.json() as { connectorTemplates?: SupportedConnectorGuardrail[]; connectors: SupportedConnectorGuardrail[] };
        setSupportedConnectorGuardrails((body.connectorTemplates ?? body.connectors).map(enrichConnectorTemplate));
      }
    } catch {
      setSupportedConnectorGuardrails(fallbackSupportedConnectorGuardrails);
    }
  }

  function resetZeroTrustConnectionState() {
    setZeroTrustDiscovery(null);
    setZeroTrustResult(null);
    setZeroTrustError("");
    setZeroTrustCopyMessage("");
    setConnectionWizardCollapsedAfterSuccess(false);
  }

  function applyLocalConnectorPreset(preset: typeof localConnectorPresets[number]) {
    setSelectedInstalledConnectorTemplateId(undefined);
    setZeroTrustAgentBaseUrl(preset.agentBaseUrl);
    setZeroTrustExpectedAgentId(preset.expectedAgentId);
    setZeroTrustExpectedResourceSystem(preset.expectedResourceSystem);
    setZeroTrustExpectedConnectorId(preset.expectedConnectorId);
    resetZeroTrustConnectionState();
    setConnectionWizardStep("connection-input");
    setActiveTab("agent-registry");
    showGuidedStatus(`${preset.label.replace("Use local ", "").replace("reference agent", "reference agent")} selected`);
    guideToTarget("zero-trust-onboarding");
  }

  async function discoverZeroTrustAgent() {
    setZeroTrustError("");
    setZeroTrustResult(null);
    setZeroTrustDiscovery(null);
    setIsZeroTrustDiscovering(true);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agent-onboarding/discover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          agentBaseUrl: zeroTrustAgentBaseUrl,
          expectedAgentId: zeroTrustExpectedAgentId,
          ...(zeroTrustExpectedResourceSystem ? { expectedResourceSystem: zeroTrustExpectedResourceSystem } : {}),
          ...(zeroTrustExpectedConnectorId ? { expectedConnectorId: zeroTrustExpectedConnectorId } : {})
        })
      });
      const body = await response.json() as AgentOnboardingDiscoveryResult | { discovered: false; details?: string[]; error?: string };
      if (!response.ok || !("discovered" in body) || body.discovered !== true) {
        const details = "details" in body && body.details?.length
          ? body.details.join(" ")
          : "Discovery failed. Start the selected reference connector instance and ensure it exposes GET /.well-known/a2a-agent.json.";
        throw new Error(details);
      }

      setZeroTrustDiscovery(body);
      setGatewayRegistrationMetadata(body.gatewayRegistration);
      setConnectionWizardStep("discovery");
      guideToTarget("zero-trust-onboarding");
    } catch (caughtError) {
      setConnectionWizardStep("discovery");
      setZeroTrustError(caughtError instanceof Error ? caughtError.message : "Discovery failed. Start the selected reference connector instance and ensure it exposes GET /.well-known/a2a-agent.json.");
      guideToTarget("zero-trust-onboarding");
    } finally {
      setIsZeroTrustDiscovering(false);
    }
  }

  async function copyGatewayRegistrationJson(value: unknown) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      setZeroTrustCopyMessage("Gateway registration JSON copied.");
    } catch {
      setZeroTrustCopyMessage("Copy failed. Select the JSON and copy it manually.");
    }
  }

  async function startZeroTrustOnboarding() {
    setZeroTrustError("");
    setZeroTrustResult(null);
    if (!zeroTrustDiscovery) {
      setZeroTrustError("Discover the external agent before verifying the connection.");
      setConnectionWizardStep("connection-input");
      guideToTarget("zero-trust-onboarding");
      return;
    }
    setConnectionWizardStep("verify");
    setIsZeroTrustOnboarding(true);

    try {
      await ensureSession();
      const response = await fetch(`${API_URL}/agent-onboarding/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          agentBaseUrl: zeroTrustAgentBaseUrl,
          expectedAgentId: zeroTrustExpectedAgentId,
          ...(zeroTrustExpectedResourceSystem ? { expectedResourceSystem: zeroTrustExpectedResourceSystem } : {}),
          ...(zeroTrustExpectedConnectorId ? { expectedConnectorId: zeroTrustExpectedConnectorId } : {})
        })
      });
      const body = await response.json() as AgentOnboardingResult | { error: string; details?: string[]; checks?: AgentOnboardingResult["checks"] };
      if (!response.ok) {
        const details = "details" in body && body.details?.length ? ` ${body.details.join(" ")}` : "";
        throw new Error(`Zero-trust onboarding failed.${details}`);
      }
      const result = body as AgentOnboardingResult;
      setZeroTrustResult(result);
      setConnectionWizardCollapsedAfterSuccess(false);
      if (result.trustedAgents) {
        setZeroTrustOnboardedAgents(result.trustedAgents);
      } else {
        await loadZeroTrustOnboardedAgents();
      }
      await loadSupportedConnectorGuardrails();
      setConnectionWizardStep("result");
      guideToTarget("zero-trust-onboarding");
    } catch (caughtError) {
      setConnectionWizardStep("verify");
      setZeroTrustError(caughtError instanceof Error ? caughtError.message : "Zero-trust onboarding failed");
      guideToTarget("zero-trust-onboarding");
    } finally {
      setIsZeroTrustOnboarding(false);
    }
  }

  async function resolveIssue(issueText: string) {
    const trimmedIssueText = issueText.trim();

    if (!trimmedIssueText || isLoading || !isUserAuthenticated) {
      if (trimmedIssueText && !isUserAuthenticated) {
        setError("Secure execution requires verified user identity. Login in Trust & Identity before running tasks.");
        goToTrustIdentity();
      }
      return;
    }

    setError("");
    setIsLoading(true);

    const loadingMessageId = createMessageId();
    const now = new Date().toISOString();
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: createMessageId(),
        role: "user",
        content: trimmedIssueText,
        timestamp: now,
        status: "done"
      },
      {
        id: loadingMessageId,
        role: "assistant",
        content: "Starting A2A task conversation...",
        timestamp: now,
        status: "loading"
      }
    ]);

    try {
      await ensureSession();
      const apiResponse = await fetch(`${API_URL}/resolve`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({ message: trimmedIssueText, conversationId })
      });

      if (!apiResponse.ok) {
        throw new Error(`Orchestrator returned ${apiResponse.status} with body ${await apiResponse.text()}`);
      }

      const resolvedResponse = (await apiResponse.json()) as ResolveResponse;
      setConversationId(resolvedResponse.conversationId);
      setMessages((currentMessages) =>
        currentMessages.map((chatMessage) =>
          chatMessage.id === loadingMessageId
            ? {
              ...chatMessage,
              content: governedChatAnswer(resolvedResponse),
              timestamp: new Date().toISOString(),
              status: "done",
              metadata: resolvedResponse
            }
            : chatMessage
        )
      );
      guideToTarget("gateway-response");
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : "Failed to resolve issue";
      setError(errorMessage);
      setMessages((currentMessages) =>
        currentMessages.map((chatMessage) =>
          chatMessage.id === loadingMessageId
            ? {
              ...chatMessage,
              content: `Unable to resolve issue: ${errorMessage}`,
              timestamp: new Date().toISOString(),
              status: "done"
            }
            : chatMessage
        )
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function submitIssue(event: React.FormEvent) {
    event.preventDefault();
    await resolveIssue(message);
  }

  function startNewConversation() {
    setMessages([]);
    setConversationId(undefined);
    setError("");
    setMessage(sampleMessage);
  }

  function renderPageHeader({
    eyebrow,
    title,
    subtitle,
    action,
    children
  }: {
    eyebrow: string;
    title: string;
    subtitle: string;
    action?: React.ReactNode;
    children?: React.ReactNode;
  }) {
    return <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} action={action}>{children}</PageHeader>;
  }

  const screenContext = {
    activeTab, setActiveTab, message, setMessage, messages, error, isLoading, health, healthError, isHealthLoading,
    zeroTrustAgentBaseUrl, setZeroTrustAgentBaseUrl, zeroTrustExpectedAgentId, setZeroTrustExpectedAgentId,
    setSupportedConnectorGuardrails, setZeroTrustOnboardedAgents, setZeroTrustDiscovery, setZeroTrustResult, setZeroTrustError, setZeroTrustCopyMessage,
    zeroTrustExpectedResourceSystem, setZeroTrustExpectedResourceSystem, zeroTrustExpectedConnectorId, setZeroTrustExpectedConnectorId,
    supportedConnectorGuardrails, zeroTrustOnboardedAgents, zeroTrustDiscovery, zeroTrustResult, zeroTrustError, zeroTrustCopyMessage,
    setGatewayRegistrationMetadata, setIsZeroTrustDiscovering, setIsZeroTrustOnboarding, setIdentitySession, setTrustStatus, setIdentityError, setIdentityMessage, setIsIdentityLoading,
    gatewayRegistrationMetadata, connectionAudience, setConnectionAudience, connectionWizardStep, setConnectionWizardStep,
    connectionWizardCollapsedAfterSuccess, setConnectionWizardCollapsedAfterSuccess, customConnectorContractOpen, setCustomConnectorContractOpen,
    expandedInstalledAgentIds, setExpandedInstalledAgentIds, selectedInstalledConnectorTemplateId, setSelectedInstalledConnectorTemplateId,
    isZeroTrustDiscovering, isZeroTrustOnboarding, identitySession, trustStatus, selectedDemoUserEmail, setSelectedDemoUserEmail,
    identityError, identityMessage, isIdentityLoading, securityTimelineFilter, setSecurityTimelineFilter, guidedStatus,
    demoGuideRootRef, runTaskRootRef, composerRef, taskTextareaRef, gatewayResponseRef, securitySummaryRef, trustIdentityRootRef,
    loginPanelRef, demoUserSelectRef, loginButtonRef, agentRegistryRootRef, connectorCatalogRef, zeroTrustOnboardingRef,
    registeredAgentsRef, legacyAgentsRef, connectorTestCenterRootRef, securityTimelineRootRef, timelineListRef,
    latestResponse, securityTimelineEvents, visibleSecurityTimelineEvents, healthLabel, authModeLabel, userBadgeLabel,
    builtInAgentsCount, healthyAgentsCount, registeredAgentRows, latestActorAttached, latestActorTokenObserved, latestActorRoles,
    isUserAuthenticated, connectorTemplateCount, installedConnectorAgentCount, runtimeReadyConnectorAgentCount, latestRequest,
    executionState, authModeSummary, lastResult, policySummary, tokenSummary, delegationSummary, primarySelectedAgent, actorEmail,
    policyOutcome, tokenOutcome,
    guideToTarget, showGuidedStatus, goToTrustIdentity, goToRunTask, goToAgentRegistry, goToConnectorCatalog,
    goToInstalledConnectorAgents, goToSecurityTimeline, hasInstalledConnector, hasApprovedSkill, hasBlockedSkill, readinessStatusForSkill,
    checkAgentHealth, loadTrustStatus, loginDemoUser, logoutIdentity, applyLocalConnectorPreset, discoverZeroTrustAgent,
    copyGatewayRegistrationJson, startZeroTrustOnboarding, resolveIssue, submitIssue, startNewConversation, resetZeroTrustConnectionState,
    loadZeroTrustOnboardedAgents, loadSupportedConnectorGuardrails, loadGatewayRegistrationMetadata,
    renderPageHeader,
    localConnectorPresets, scenarios, quickScenarios, advancedScenarios, securityTimelineFilters, demoUserOptions,
    cockpitStatusClass, statusDisplayLabel, connectorRoutingStatusLabel, connectorRoutingStatusClass, connectorRuntimeFailureCopy,
    firstSentence, recommendedActionItems, shortHash, JsonBlock, MessageList, safeRawExecutionData, healthClass,
    endpointMetadata, endpointTypeLabel, routingDescription, securityDecisions, decisionClass, sampleMessage
  };

  function navigateToTab(tabId: ActiveTab) {
    setActiveTab(tabId);
    if (tabId === "demo-guide") {
      guideToTarget("demo-guide");
    }
    if (tabId === "run-task") {
      guideToTarget("composer");
    }
    if (tabId === "agent-registry") {
      guideToTarget("agent-registry");
    }
    if (tabId === "connector-test-center") {
      guideToTarget("connector-test-center");
    }
    if (tabId === "trust-identity") {
      guideToTarget("trust-login");
    }
    if (tabId === "security-timeline") {
      guideToTarget("security-timeline");
    }
  }

  const activePageHeader = activePageHeaders[activeTab];

  return (
    <main className="shell control-plane-shell">
      <aside className="control-sidebar" aria-label="Product navigation">
        <div className="sidebar-brand">
          <p className="eyebrow">Secure A2A Gateway</p>
          <h1>Runtime Control Plane</h1>
          <p>AI interprets. Gateway decides. Scoped runtime executes only approved skills.</p>
        </div>

        <nav className="sidebar-nav" aria-label="Main product sections">
          <span>Main</span>
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => navigateToTab(tab.id)}
            >
              <strong>{tab.label}</strong>
              <small>{tab.hint}</small>
            </button>
          ))}
        </nav>

        <div className="sidebar-nav sidebar-planned" aria-label="Future planned sections">
          <span>Future</span>
          <button type="button" disabled>
            <strong>External Agent Admin</strong>
            <small>Action plans are generated by the connector for a specific request. They are side-effect-free and must be approved by the Gateway before execution.</small>
          </button>
        </div>

        <div className="sidebar-status" aria-label="System status">
          <span>System</span>
          <div>
            <small>Identity:</small>
            <strong className={isUserAuthenticated ? "status-success" : "status-warning"}>{isUserAuthenticated ? "Logged in" : "Not logged in"}</strong>
          </div>
          <div>
            <small>Installed agents:</small>
            <strong>{installedConnectorAgentCount}</strong>
          </div>
          <div>
            <small>Runtime ready:</small>
            <strong>{runtimeReadyConnectorAgentCount}</strong>
          </div>
          <div>
            <small>Security:</small>
            <strong>Raw tokens hidden</strong>
          </div>
          <div>
            <small>Auth:</small>
            <strong>Scoped JWT enabled</strong>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-copy">
            <p className="eyebrow">Active section</p>
            <h1>{activePageHeader.title}</h1>
            <p className="topbar-subtitle">{activePageHeader.subtitle}</p>
            <div className="menu-hint">
              <span>{activeTab === "demo-guide" ? "Follow the guided demo path from the Next Action card." : "Open Demo Guide for the recommended presentation flow."}</span>
              <button type="button" onClick={() => {
                navigateToTab("demo-guide");
                guideToTarget("demo-guide");
              }}>Demo Guide</button>
            </div>
          </div>
          <div className="topbar-actions">
            {isUserAuthenticated ? (
              <div className="status user-status authenticated">{userBadgeLabel}</div>
            ) : (
              <button type="button" className="status user-status anonymous clickable-status" onClick={goToTrustIdentity}>
                {userBadgeLabel}
              </button>
            )}
            <div className={`status execution-status ${isUserAuthenticated ? "unlocked" : "locked"}`}>Execution {isUserAuthenticated ? "unlocked" : "locked"}</div>
            <div className="status">
              {authModeLabel}
              {health?.orchestrator.secureAuthRequired ? " / Secure auth required" : ""}
            </div>
            <div className={`health-summary ${health?.summary.down ? "has-down" : health?.summary.degraded ? "has-degraded" : "all-healthy"}`}>
              <span>{isHealthLoading ? "Checking..." : healthLabel}</span>
              <small>{health?.orchestrator.status ?? "unknown"}</small>
            </div>
            <button type="button" className="secondary-button" onClick={startNewConversation} disabled={isLoading}>
              New conversation
            </button>
          </div>
        </header>

        {guidedStatus ? <div className="guided-status" role="status">{guidedStatus}</div> : null}

        {activeTab === "demo-guide" ? <DemoGuideTab ctx={screenContext} /> : null}
        {activeTab === "run-task" ? <RunTaskTab ctx={screenContext} /> : null}
        {activeTab === "agent-registry" ? <AgentRegistryTab ctx={screenContext} /> : null}
        {activeTab === "connector-test-center" ? <ConnectorTestCenterTab ctx={screenContext} /> : null}
        {activeTab === "trust-identity" ? <TrustIdentityTab ctx={screenContext} /> : null}
        {activeTab === "security-timeline" ? <SecurityTimelineTab ctx={screenContext} /> : null}
      </section>

    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
