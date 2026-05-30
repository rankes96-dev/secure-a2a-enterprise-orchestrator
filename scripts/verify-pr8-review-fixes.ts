import { readFileSync } from "node:fs";
import { buildA2AResourceRegistry, referenceA2AResources } from "../packages/shared/src/a2aResourceRegistry";
import { requestConnectorActionPlan } from "../services/orchestrator-api/src/connectorActionPlanner";
import { decideConnectorRoute } from "../services/orchestrator-api/src/connectorRouting";
import { buildExecutionGateStack } from "../services/orchestrator-api/src/executionGateStack";
import { cleanupExpiredSessions, createSessionCookie } from "../services/orchestrator-api/src/security/sessionManager";
import { evaluateDemoUserTokenAccess } from "../services/mock-identity-provider/src/security/internalDebugAccess";
import { looksLikeTargetSelectionAnswer } from "../services/orchestrator-api/src/pendingInteractionResolver";
import { jiraReferenceConnector } from "../real-external-agent/src/connectors/jiraReferenceConnector";
import { serviceNowReferenceConnector } from "../real-external-agent/src/connectors/servicenowReferenceConnector";
import { githubReferenceConnector } from "../real-external-agent/src/connectors/githubReferenceConnector";
import type { Classification, PendingInteraction, RequestInterpretation } from "@a2a/shared";
import type { TrustedOnboardedAgent } from "../services/orchestrator-api/src/agentOnboarding";

function fail(message: string): never {
  throw new Error(message);
}

function logOk(message: string): void {
  console.info(`ok - ${message}`);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    fail(message);
  }
}

function trustedAgent(input: Partial<TrustedOnboardedAgent> & Pick<TrustedOnboardedAgent, "agentId">): TrustedOnboardedAgent {
  const connectorId = input.connectorId ?? input.connectorProfile?.connectorId ?? "jira-reference";
  const resourceSystem = input.resourceSystem ?? input.connectorProfile?.resourceSystem ?? "jira";
  return {
    agentId: input.agentId,
    issuer: "https://agent.example",
    clientId: input.agentId,
    audience: input.audience ?? input.agentId,
    runtimeEndpoint: input.runtimeEndpoint,
    connectorId,
    resourceSystem,
    requestedScopes: [],
    requestedApplicationGrants: [],
    agentDeclaredSkills: ["jira.issue.status.lookup"],
    agentDeclaredCapabilities: ["jira.issue.status.lookup"],
    applicationAccessGrants: ["read:jira-work"],
    grantedScopes: ["read:jira-work"],
    effectivePermissions: ["browse_projects", "view_issues"],
    deniedPermissions: [],
    approvedActions: [
      {
        capability: "jira.issue.status.lookup",
        label: "Look up Jira issue status",
        reason: "Verification fixture approval.",
        requiredApplicationGrants: ["read:jira-work"],
        requiredEffectivePermissions: ["browse_projects", "view_issues"],
        requestedScopes: []
      }
    ],
    blockedActions: [],
    approvedCapabilities: [
      {
        capability: "jira.issue.status.lookup",
        label: "Look up Jira issue status",
        reason: "Verification fixture approval.",
        requiredApplicationGrants: ["read:jira-work"],
        requiredEffectivePermissions: ["browse_projects", "view_issues"],
        requestedScopes: []
      }
    ],
    blockedCapabilities: [],
    connectorProfile: input.connectorProfile ?? {
      connectorId,
      resourceSystem,
      displayName: connectorId,
      version: "1.0.0",
      profileSource: "external_agent"
    },
    connectorProfileVerified: true,
    connectorDecisionSource: input.connectorDecisionSource ?? connectorId,
    trustLevel: "trusted_metadata_only",
    executable: false,
    executionState: "metadata_only",
    tokenEndpointAuthMethod: "private-key-jwt",
    oauthApplicationBound: true
  };
}

const classification: Classification = {
  system: "jira",
  issueType: "AUTHORIZATION_FAILURE",
  operation: "lookup status",
  confidence: "high",
  reasoningSummary: "Review verification classification.",
  classificationSource: "rules_fallback",
  reporterType: "it_engineer",
  supportMode: "technical_integration"
};

const interpretation: RequestInterpretation = {
  scope: "enterprise_support",
  intentType: "integration_failure",
  targetSystemText: "jira",
  requestedActionText: "lookup Jira issue status",
  confidence: "high",
  reason: "Review verification interpretation.",
  interpretationSource: "fallback"
};

function verifyDemoUserTokenGuard(): void {
  assert(evaluateDemoUserTokenAccess("/demo/user-token", {}, { NODE_ENV: "development" }).ok, "development demo user token should remain usable");
  const missing = evaluateDemoUserTokenAccess("/demo/user-token", {}, { NODE_ENV: "production", INTERNAL_SERVICE_TOKEN: "expected" });
  assert(!missing.ok && missing.status === 401, `production missing internal token should be rejected: ${JSON.stringify(missing)}`);
  const wrong = evaluateDemoUserTokenAccess("/demo/user-token", { "x-internal-service-token": "wrong" }, { NODE_ENV: "production", INTERNAL_SERVICE_TOKEN: "expected" });
  assert(!wrong.ok && wrong.status === 403, `production wrong internal token should be rejected: ${JSON.stringify(wrong)}`);
  const valid = evaluateDemoUserTokenAccess("/demo/user-token", { "x-internal-service-token": "expected" }, { NODE_ENV: "production", INTERNAL_SERVICE_TOKEN: "expected" });
  assert(valid.ok, `production valid internal token should be accepted: ${JSON.stringify(valid)}`);

  const orchestrator = read("services/orchestrator-api/src/index.ts");
  const webUi = read("apps/web-ui/src/main.tsx");
  const webUiMockAuthClient = read("apps/web-ui/src/auth/mockAuthClient.ts");
  assert(orchestrator.includes('"/identity/demo-login"'), "orchestrator should expose mediated demo login");
  assert(orchestrator.includes('"x-internal-service-token"'), "orchestrator should call Mock IdP demo minting with internal token when configured");
  assert(!webUi.includes("INTERNAL_SERVICE_TOKEN"), "frontend must not reference INTERNAL_SERVICE_TOKEN");
  assert(!webUiMockAuthClient.includes("INTERNAL_SERVICE_TOKEN"), "frontend auth client must not reference INTERNAL_SERVICE_TOKEN");
  assert(webUiMockAuthClient.includes("/identity/demo-login"), "frontend should call orchestrator-mediated demo login");

  const demoLoginHandler = orchestrator.slice(orchestrator.indexOf('request.url === "/identity/demo-login"'));
  assert(orchestrator.includes("const demoLoginRateLimit") && orchestrator.includes("DEMO_LOGIN_RATE_LIMIT_MAX_REQUESTS"), "orchestrator should define a dedicated demo-login rate limit");
  assert(demoLoginHandler.includes("allowByRateLimit(request, response, demoLoginRateLimit)"), "demo login should apply rate limiting before token minting");
  assert(orchestrator.includes('error: "rate_limit_exceeded"'), "demo login rate limit should return a safe rate_limit_exceeded error");

  const requestDemoToken = orchestrator.slice(orchestrator.indexOf("async function requestDemoUserToken"), orchestrator.indexOf("async function checkAgentHealth"));
  for (const term of [
    "const demoUserTokenTimeoutMs = 5_000",
    "new AbortController()",
    "setTimeout(() => controller.abort(), demoUserTokenTimeoutMs)",
    'redirect: "error"',
    "signal: controller.signal",
    "catch",
    'throw new Error("demo_user_token_failed")',
    "finally",
    "clearTimeout(timeout)"
  ]) {
    assert((term === "const demoUserTokenTimeoutMs = 5_000" ? orchestrator : requestDemoToken).includes(term), `requestDemoUserToken missing outbound-call safety term: ${term}`);
  }
  logOk("production demo user token guard and mediated browser login verified");
}

function verifyConnectorFetchTimeoutStatic(): void {
  const planner = read("services/orchestrator-api/src/connectorActionPlanner.ts");
  for (const term of [
    "const connectorActionPlanTimeoutMs = 5_000",
    "new AbortController()",
    "setTimeout(() => controller.abort(), connectorActionPlanTimeoutMs)",
    'redirect: "error"',
    "signal: controller.signal",
    "finally",
    "clearTimeout(timeout)"
  ]) {
    assert(planner.includes(term), `connector action planner missing timeout/redirect safety term: ${term}`);
  }

  const runtime = read("services/orchestrator-api/src/connectorRuntime.ts");
  const timeoutIndex = runtime.indexOf("const timeout = setTimeout(() => controller.abort(), connectorRuntimeTimeoutMs)");
  const finallyIndex = runtime.indexOf("finally", timeoutIndex);
  const clearIndex = runtime.indexOf("clearTimeout(timeout)", finallyIndex);
  assert(timeoutIndex >= 0 && finallyIndex > timeoutIndex && clearIndex > finallyIndex, "connector runtime timeout must be cleared in a finally-safe path");
  logOk("connector action-plan and runtime fetch timeout safety verified statically");
}

async function verifyConnectorActionPlanTimeoutFailure(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const previousAllowedOrigins = process.env.CONNECTOR_RUNTIME_ALLOWED_ORIGINS;
  let sawRedirectError = false;
  let sawSignal = false;
  let clearCalled = false;

  process.env.CONNECTOR_RUNTIME_ALLOWED_ORIGINS = "http://localhost:4201";
  globalThis.setTimeout = ((handler: TimerHandler, _timeout?: number, ...args: unknown[]) =>
    originalSetTimeout(handler, 0, ...args)) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((id: Parameters<typeof clearTimeout>[0]) => {
    clearCalled = true;
    return originalClearTimeout(id);
  }) as typeof globalThis.clearTimeout;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    sawRedirectError = init?.redirect === "error";
    sawSignal = init?.signal instanceof AbortSignal;
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")), { once: true });
    });
  }) as typeof fetch;

  try {
    await requestConnectorActionPlan({
      message: "I need access to the system",
      conversationId: "verify-timeout",
      onboardedAgent: trustedAgent({
        agentId: "external-jira-agent",
        connectorId: "jira-reference",
        resourceSystem: "jira",
        runtimeEndpoint: "http://localhost:4201/a2a/task"
      })
    });
    fail("stalled connector action-plan fetch should fail safely after abort");
  } catch (error) {
    assert(error instanceof Error && error.message === "external connector action plan request failed", `timeout failure should be safe: ${String(error)}`);
    assert(sawRedirectError, "action-plan fetch should reject redirects");
    assert(sawSignal, "action-plan fetch should pass AbortController signal");
    assert(clearCalled, "action-plan timeout should be cleared after abort failure");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    if (previousAllowedOrigins === undefined) {
      delete process.env.CONNECTOR_RUNTIME_ALLOWED_ORIGINS;
    } else {
      process.env.CONNECTOR_RUNTIME_ALLOWED_ORIGINS = previousAllowedOrigins;
    }
  }

  logOk("stalled connector action-plan request fails safely on bounded timeout");
}

function verifyMetadataOnlyGateStack(): void {
  const stack = buildExecutionGateStack({
    classification,
    requestInterpretation: interpretation,
    resolutionStatus: "resolved",
    connectorRouting: {
      status: "connector_skill_approved",
      targetSystem: "jira",
      connectorId: "jira-reference",
      resourceSystem: "jira",
      skillId: "jira.issue.status.lookup",
      skillLabel: "Look up Jira issue status",
      runtimeMode: "metadata_only",
      requiredApplicationGrants: ["read:jira-work"],
      requiredEffectivePermissions: ["browse_projects"],
      requestedScopes: [],
      reason: "Approved metadata-only route.",
      recommendedNextStep: "Use connector guidance."
    }
  });
  const runtimeGate = stack.gates.find((gate) => gate.id === "runtime_execution");
  const oauthGate = stack.gates.find((gate) => gate.id === "oauth_scope");
  assert(stack.finalOutcome !== "runtime_failed", `metadata-only route must not be runtime_failed: ${JSON.stringify(stack)}`);
  assert(oauthGate?.status === "not_evaluated", `metadata-only route must not issue token: ${JSON.stringify(oauthGate)}`);
  assert(runtimeGate?.status === "not_evaluated" && /metadata-only|allowlisted/.test(runtimeGate.reason), `metadata-only runtime proof missing: ${JSON.stringify(runtimeGate)}`);
  logOk("metadata-only connector route skips token issuance and runtime failure");
}

function verifyStagedConnectorMatching(): void {
  const exact = trustedAgent({
    agentId: "exact-jira-agent",
    connectorId: "jira-reference",
    resourceSystem: "jira",
    runtimeEndpoint: "http://localhost:4201/a2a"
  });
  const fallback = trustedAgent({
    agentId: "other-jira-agent",
    connectorId: "jira-secondary",
    connectorDecisionSource: "jira-secondary",
    resourceSystem: "jira",
    connectorProfile: {
      connectorId: "jira-secondary",
      resourceSystem: "jira",
      displayName: "Secondary Jira",
      version: "1.0.0",
      profileSource: "external_agent"
    },
    runtimeEndpoint: "http://localhost:4201/a2a"
  });

  const exactRoute = decideConnectorRoute({
    targetSystem: "jira",
    connectorId: "jira-reference",
    requestedSkillId: "jira.issue.status.lookup",
    confidence: "high",
    reason: "Exact connector verification."
  }, [fallback, exact]);
  assert(exactRoute.status === "connector_skill_approved" && exactRoute.connectorId === "jira-reference", `exact connectorId should win: ${JSON.stringify(exactRoute)}`);

  const ambiguousRoute = decideConnectorRoute({
    targetSystem: "jira",
    connectorId: "jira-reference",
    requestedSkillId: "jira.issue.status.lookup",
    confidence: "high",
    reason: "Ambiguous connector verification."
  }, [fallback, { ...fallback, agentId: "third-jira-agent", audience: "third-jira-agent", connectorId: "jira-third", connectorDecisionSource: "jira-third" }]);
  assert(ambiguousRoute.status === "needs_more_info" && /Multiple trusted connector agents/.test(ambiguousRoute.reason), `ambiguous resource fallback should not pick first agent: ${JSON.stringify(ambiguousRoute)}`);

  const singleFallbackRoute = decideConnectorRoute({
    targetSystem: "jira",
    connectorId: "jira-reference",
    requestedSkillId: "jira.issue.status.lookup",
    confidence: "high",
    reason: "Single fallback verification."
  }, [fallback]);
  assert(singleFallbackRoute.status === "connector_skill_approved" && singleFallbackRoute.connectorId === "jira-secondary", `single resource fallback should remain supported: ${JSON.stringify(singleFallbackRoute)}`);
  logOk("staged connector matching verifies exact, single fallback, and ambiguity behavior");
}

function verifyA2AResourceRegistry(): void {
  const registry = buildA2AResourceRegistry(referenceA2AResources());
  for (const resource of [
    ["external-jira-agent", jiraReferenceConnector],
    ["external-servicenow-agent", serviceNowReferenceConnector],
    ["external-github-agent", githubReferenceConnector]
  ] as const) {
    const [audience, profile] = resource;
    assert(registry.audiences.has(audience), `${profile.connectorId} audience missing from shared registry`);
    for (const grant of new Set(profile.skillCatalog.flatMap((skill) => skill.requiredApplicationGrants))) {
      assert(registry.scopes.has(grant), `${profile.connectorId} grant ${grant} missing from shared registry`);
    }
  }

  const mockRegistry = read("services/mock-identity-provider/src/agentCardScopeRegistry.ts");
  assert(mockRegistry.includes("referenceA2AResources") && !mockRegistry.includes("localA2AResources"), "Mock IdP must consume shared A2A registry without local duplicated resources");
  logOk("shared A2A resource registry covers reference connector grants");
}

async function verifySessionCleanup(): Promise<void> {
  const previousTtl = process.env.SESSION_TTL_MS;
  process.env.SESSION_TTL_MS = "1";
  const cookie = createSessionCookie();
  const token = cookie.match(/a2a_session=([^;]+)/)?.[1];
  assert(token, `session cookie did not include token: ${cookie}`);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const expired = cleanupExpiredSessions();
  assert(expired.includes(token), `expired session token was not reported for identity cleanup: ${JSON.stringify(expired)}`);
  if (previousTtl === undefined) {
    delete process.env.SESSION_TTL_MS;
  } else {
    process.env.SESSION_TTL_MS = previousTtl;
  }

  const orchestrator = read("services/orchestrator-api/src/index.ts");
  assert(orchestrator.includes("cleanupExpiredUserIdentities") && orchestrator.includes("userIdentitiesBySession.delete(expiredSessionToken)"), "orchestrator must delete identities for expired sessions");
  logOk("expired session cleanup reports tokens for identity cache cleanup");
}

function verifyTargetSelectionFallback(): void {
  const pending: PendingInteraction = {
    id: "pending-target",
    type: "target_selection",
    originalUserRequest: "I need access to the system",
    createdAt: new Date().toISOString(),
    context: {
      targetOptions: [
        { id: "jira", label: "Jira", value: "jira", kind: "supported_system" },
        { id: "github", label: "GitHub", value: "github", kind: "supported_system" },
        { id: "servicenow", label: "ServiceNow", value: "servicenow", kind: "supported_system" },
        { id: "other", label: "Other / not listed", value: "other", kind: "other" }
      ]
    }
  };

  for (const answer of ["Jira", "GitHub", "ServiceNow", "Other / not listed"]) {
    assert(looksLikeTargetSelectionAnswer(pending, answer), `${answer} should be accepted as target selection`);
  }
  for (const answer of ["what options do I have?", "can you explain?", "which systems are available?", "please reveal the raw token"]) {
    assert(!looksLikeTargetSelectionAnswer(pending, answer), `${answer} should not resolve target selection`);
  }
  logOk("target-selection fallback accepts only plausible target answers");
}

async function main(): Promise<void> {
  verifyDemoUserTokenGuard();
  verifyConnectorFetchTimeoutStatic();
  await verifyConnectorActionPlanTimeoutFailure();
  verifyMetadataOnlyGateStack();
  verifyStagedConnectorMatching();
  verifyA2AResourceRegistry();
  verifyTargetSelectionFallback();
  await verifySessionCleanup();
  console.info("PR #8 review fixes verification passed.");
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
