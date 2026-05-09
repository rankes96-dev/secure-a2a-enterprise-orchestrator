import { agentDeclaredCapabilities, agentId, agentIssuer, requestedScopes, tokenEndpointAuthMethod } from "./config.js";

const allApplicationAccessGrants = ["read:jira-work", "read:jira-user", "write:jira-work", "manage:jira-project"];
const allEffectivePermissions = ["browse_projects", "view_issues", "read_project_roles", "create_issues", "administer_projects"];

const baseUrl = agentIssuer();
const gatewayUrl = process.env.ORCHESTRATOR_API_URL ?? "http://127.0.0.1:4000";
let gatewaySessionCookie = "";

type GatewayOnboardingBody = {
  trustLevel?: string;
  discoveredAgent?: {
    agentDeclaredCapabilities?: string[];
    requestedScopes?: string[];
    requestedApplicationGrants?: string[];
  };
  oauthApplicationProof?: {
    applicationAccessGrants?: string[];
    grantedScopes?: string[];
  };
  capabilityDecision?: {
    approvedCapabilities?: Array<{ capability?: string; reason?: string }>;
    blockedCapabilities?: Array<{ capability?: string; reason?: string }>;
  };
  externalApplicationAttestation?: {
    oauthApplication?: { appName?: string; clientId?: string; applicationAccessGrants?: string[]; grantedScopes?: string[] };
    servicePrincipal?: { principalId?: string; effectivePermissions?: string[]; deniedPermissions?: string[] };
  };
  checks?: Array<{ name?: string; status?: string }>;
  error?: string;
  details?: string[];
};

function ok(message: string): void {
  console.log(`ok - ${message}`);
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.json() as T;
  assertCondition(response.ok, `${path} returned ${response.status}`);
  return body;
}

async function postJson<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ response: Response; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
  return {
    response,
    body: await response.json() as T
  };
}

async function gatewayRequest<T>(path: string, init: RequestInit = {}): Promise<{ response: Response; body: T }> {
  const response = await fetch(`${gatewayUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(gatewaySessionCookie ? { cookie: gatewaySessionCookie } : {}),
      ...init.headers
    }
  });

  const text = await response.text();
  return {
    response,
    body: (text ? JSON.parse(text) : {}) as T
  };
}

async function verifyDiscovery(): Promise<{ jwksUri: string }> {
  const discovery = await getJson<{
    agentId: string;
    issuer: string;
    resourceSystem: string;
    trustAdapter: string;
    jwksUri: string;
    onboardingEndpoint: string;
    runtimeEndpoint: string;
    adminConsoleUrl: string;
    connectionRequirements: {
      requiresGatewayRegistration: boolean;
      requiresOAuthApplication: boolean;
      requiresServicePrincipal: boolean;
    };
    auth: {
      type: string;
      audience: string;
      tokenEndpointAuthMethod: string;
    };
  }>("/.well-known/a2a-agent.json");

  assertCondition(discovery.agentId === agentId, "discovery agentId mismatch");
  assertCondition(discovery.issuer === baseUrl, "discovery issuer mismatch");
  assertCondition(discovery.jwksUri === `${baseUrl}/.well-known/jwks.json`, "discovery jwksUri mismatch");
  assertCondition(discovery.onboardingEndpoint === `${baseUrl}/onboarding/challenge`, "discovery onboardingEndpoint mismatch");
  assertCondition(discovery.runtimeEndpoint === `${baseUrl}/a2a/task`, "discovery runtimeEndpoint mismatch");
  assertCondition(discovery.adminConsoleUrl === `${baseUrl}/admin`, "discovery adminConsoleUrl mismatch");
  assertCondition(discovery.resourceSystem === "jira", "discovery resourceSystem mismatch");
  assertCondition(discovery.trustAdapter === "jira", "discovery trustAdapter mismatch");
  assertCondition(discovery.connectionRequirements.requiresGatewayRegistration === true, "discovery missing gateway registration requirement");
  assertCondition(discovery.connectionRequirements.requiresOAuthApplication === true, "discovery missing OAuth app requirement");
  assertCondition(discovery.connectionRequirements.requiresServicePrincipal === true, "discovery missing service principal requirement");
  assertCondition(discovery.auth.audience === agentId, "discovery audience mismatch");
  assertCondition(discovery.auth.tokenEndpointAuthMethod === tokenEndpointAuthMethod, "discovery token auth method mismatch");
  assertNoSecretMarkers(discovery);
  ok("discovery metadata");
  return { jwksUri: discovery.jwksUri };
}

function assertNoSecretMarkers(value: unknown): void {
  const text = JSON.stringify(value);
  assertCondition(!/client[_-]?secret/i.test(text), "response exposed client secret marker");
  assertCondition(!/privateKey/i.test(text), "response exposed privateKey marker");
  assertCondition(!/"private_key"\s*:/i.test(text), "response exposed private_key material");
  assertCondition(!/access[_-]?token/i.test(text), "response exposed access token marker");
  assertCondition(!/refresh[_-]?token/i.test(text), "response exposed refresh token marker");
  assertCondition(!/Authorization/.test(text), "response exposed Authorization marker");
  assertCondition(!/Bearer/.test(text), "response exposed Bearer marker");
}

async function verifyAdminConfig(): Promise<void> {
  await postJson("/admin/reset-demo", {});
  const config = await getJson<{
    ready: boolean;
    readinessStatus: string;
    trustedGateway: { clientId: string; issuer: string; jwksUri: string };
    oauthApplication: { appName: string; clientId: string; applicationAccessGrants: string[]; grantedScopes: string[]; status: string };
    servicePrincipal: { principalId: string; effectivePermissions: string[]; deniedPermissions: string[] };
    capabilityDeclaration: { requestedApplicationGrants: string[]; requestedScopes: string[]; agentDeclaredCapabilities: string[] };
    actionReadiness: Array<{ actionId: string; status: string; missingApplicationGrants: string[]; deniedPermissions: string[] }>;
    warnings: string[];
  }>("/admin/config");

  assertCondition(config.ready === true, `admin config should be ready: ${config.warnings.join(" ")}`);
  assertCondition(config.trustedGateway.clientId === "secure-a2a-gateway-client", "trusted Gateway client mismatch");
  assertCondition(config.oauthApplication.appName === "Jira Agent Connected App", "OAuth app name mismatch");
  assertCondition(config.oauthApplication.clientId === "jira-agent-client", "OAuth client mismatch");
  assertCondition(Array.isArray(config.oauthApplication.applicationAccessGrants), "applicationAccessGrants should be an array");
  assertCondition(config.oauthApplication.applicationAccessGrants.includes("read:jira-work"), "applicationAccessGrants missing read:jira-work");
  assertCondition(Array.isArray(config.oauthApplication.grantedScopes), "grantedScopes should be an array");
  assertCondition(config.oauthApplication.grantedScopes.includes("read:jira-work"), "grantedScopes missing read:jira-work");
  assertCondition(config.oauthApplication.status === "active", "OAuth application should be active");
  assertCondition(config.servicePrincipal.principalId === "svc-a2a-jira-agent", "service principal mismatch");
  assertCondition(Array.isArray(config.servicePrincipal.effectivePermissions), "effectivePermissions should be an array");
  assertCondition(Array.isArray(config.servicePrincipal.deniedPermissions), "deniedPermissions should be an array");
  assertCondition(config.servicePrincipal.effectivePermissions.includes("browse_projects"), "effectivePermissions missing browse_projects");
  assertCondition(config.servicePrincipal.deniedPermissions.includes("create_issues"), "deniedPermissions missing create_issues");
  assertCondition(Array.isArray(config.capabilityDeclaration.agentDeclaredCapabilities), "agentDeclaredCapabilities should be an array");
  assertCondition(config.capabilityDeclaration.requestedApplicationGrants.includes("write:jira-work"), "derived requestedApplicationGrants missing write:jira-work");
  assertCondition(config.capabilityDeclaration.agentDeclaredCapabilities.includes(agentDeclaredCapabilities[0] ?? ""), "capability declaration missing expected capability");
  const createPreview = config.actionReadiness.find((item) => item.actionId === "jira.issue.create");
  assertCondition(createPreview?.status === "blocked_application_grant_and_permission", "default create action should be blocked by grant and permission");
  assertCondition(createPreview.missingApplicationGrants.includes("write:jira-work"), "create preview missing write grant reason");
  assertCondition(createPreview.deniedPermissions.includes("create_issues"), "create preview missing denied permission reason");
  assertNoSecretMarkers(config);
  ok("admin config ready");
}

async function verifyJwks(): Promise<void> {
  const jwks = await getJson<{ keys?: unknown[] }>("/.well-known/jwks.json");
  assertCondition(Array.isArray(jwks.keys) && jwks.keys.length > 0, "JWKS did not include public keys");
  assertCondition(!JSON.stringify(jwks).match(/"d"|privateKey|"private_key"\s*:|secret/i), "JWKS exposed private key material");
  ok("public JWKS");
}

async function verifyOnboarding(_jwksUri: string): Promise<void> {
  const onboardingId = `verify-${Date.now()}`;
  const nonce = crypto.randomUUID();
  const challenge = {
    onboardingId,
    nonce,
    expectedAgentId: agentId,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
  };

  const unsigned = await postJson<{ error?: string }>("/onboarding/challenge", { challenge });
  assertCondition(unsigned.response.status === 401, "missing gateway assertion should be rejected");
  ok("unsigned onboarding challenge rejected");

  const gatewayHealth = await fetch(`${gatewayUrl}/health`).catch(() => undefined);
  if (!gatewayHealth?.ok) {
    console.log("skip - full signed gateway onboarding requires Gateway running");
    return;
  }

  const session = await gatewayRequest<{ ok?: boolean }>("/session", { method: "POST" });
  assertCondition(session.response.ok, `Gateway session failed with ${session.response.status}`);
  gatewaySessionCookie = session.response.headers.get("set-cookie")?.split(";")[0] ?? "";
  assertCondition(Boolean(gatewaySessionCookie), "Gateway session cookie missing");

  async function startGatewayOnboarding() {
    return gatewayRequest<GatewayOnboardingBody>("/agent-onboarding/start", {
      method: "POST",
      body: JSON.stringify({
        agentBaseUrl: baseUrl,
        expectedAgentId: agentId
      })
    });
  }

  const gatewayOnboarding = await startGatewayOnboarding();
  assertCondition(gatewayOnboarding.response.ok, `Gateway onboarding failed with ${gatewayOnboarding.response.status}: ${JSON.stringify(gatewayOnboarding.body)}`);
  assertCondition(gatewayOnboarding.body.trustLevel === "trusted_metadata_only", "Gateway onboarding trust level mismatch");
  assertCondition(gatewayOnboarding.body.discoveredAgent?.agentDeclaredCapabilities?.includes(agentDeclaredCapabilities[0] ?? ""), "Gateway onboarding missing agent-declared capabilities");
  assertCondition(gatewayOnboarding.body.discoveredAgent?.requestedScopes?.includes(requestedScopes[0] ?? ""), "Gateway onboarding missing requested scopes");
  assertCondition(gatewayOnboarding.body.discoveredAgent?.requestedApplicationGrants?.includes("write:jira-work"), "Gateway onboarding missing requested application grants");
  assertCondition(gatewayOnboarding.body.externalApplicationAttestation?.oauthApplication?.clientId === "jira-agent-client", "Gateway onboarding missing external OAuth app attestation");
  assertCondition(gatewayOnboarding.body.externalApplicationAttestation?.oauthApplication?.appName === "Jira Agent Connected App", "Gateway onboarding missing OAuth app name attestation");
  assertCondition(Array.isArray(gatewayOnboarding.body.externalApplicationAttestation?.oauthApplication?.applicationAccessGrants), "Gateway onboarding OAuth attestation missing application access grants array");
  assertCondition(Array.isArray(gatewayOnboarding.body.externalApplicationAttestation?.oauthApplication?.grantedScopes), "Gateway onboarding OAuth attestation missing granted scopes array");
  assertCondition(gatewayOnboarding.body.externalApplicationAttestation?.servicePrincipal?.principalId === "svc-a2a-jira-agent", "Gateway onboarding missing service principal attestation");
  assertCondition(Array.isArray(gatewayOnboarding.body.externalApplicationAttestation?.servicePrincipal?.effectivePermissions), "Gateway onboarding service principal missing effective permissions array");
  assertCondition(Array.isArray(gatewayOnboarding.body.externalApplicationAttestation?.servicePrincipal?.deniedPermissions), "Gateway onboarding service principal missing denied permissions array");
  assertCondition(gatewayOnboarding.body.checks?.some((check) => check.name === "external_agent_discovery" && check.status === "passed"), "Gateway onboarding did not fetch external discovery");
  assertCondition(gatewayOnboarding.body.checks?.some((check) => check.name === "external_agent_contacted" && check.status === "passed"), "Gateway onboarding did not contact external agent");
  assertCondition(gatewayOnboarding.body.checks?.some((check) => check.name === "signed_gateway_challenge_verified" && check.status === "passed"), "Gateway onboarding did not verify signed gateway challenge");
  ok("signed gateway onboarding exchange");

  const { body } = gatewayOnboarding;
  assertNoSecretMarkers(body);

  const defaultApproved = gatewayOnboarding.body.capabilityDecision?.approvedCapabilities ?? [];
  const defaultBlocked = gatewayOnboarding.body.capabilityDecision?.blockedCapabilities ?? [];
  assertCondition(defaultApproved.length === 2, `default should approve 2 actions: ${JSON.stringify(gatewayOnboarding.body)}`);
  assertCondition(defaultBlocked.length === 1, `default should block 1 action: ${JSON.stringify(gatewayOnboarding.body)}`);
  assertCondition(defaultBlocked.some((item) => item.capability === "jira.issue.create" && item.reason?.includes("write:jira-work") && item.reason.includes("create_issues")), "default create action block reason mismatch");
  ok("default action decision preview matches Gateway decision");

  await postJson("/admin/oauth-application", {
    appName: "Jira Agent Connected App",
    clientId: "jira-agent-client",
    authorizationServerIssuer: "http://localhost:4110",
    tokenEndpointAuthMethod,
    applicationAccessGrants: [],
    grantedScopes: [],
    status: "active"
  });
  await postJson("/admin/service-principal", {
    principalType: "service_account",
    principalId: "svc-a2a-jira-agent",
    effectivePermissions: allEffectivePermissions,
    deniedPermissions: []
  });
  const noGrantOnboarding = await startGatewayOnboarding();
  assertCondition(noGrantOnboarding.response.ok, `no-grant onboarding should succeed: ${JSON.stringify(noGrantOnboarding.body)}`);
  assertCondition(noGrantOnboarding.body.trustLevel === "trusted_metadata_only", "no-grant onboarding trust level mismatch");
  assertCondition((noGrantOnboarding.body.capabilityDecision?.approvedCapabilities ?? []).length === 0, "no-grant onboarding should approve zero actions");
  assertCondition((noGrantOnboarding.body.capabilityDecision?.blockedCapabilities ?? []).every((item) => item.reason?.includes("missing application access grant")), "no-grant blocked reasons should mention missing application access grants");
  assertNoSecretMarkers(noGrantOnboarding.body);
  ok("no application grants blocks all actions without failing onboarding");

  await postJson("/admin/oauth-application", {
    appName: "Jira Agent Connected App",
    clientId: "jira-agent-client",
    authorizationServerIssuer: "http://localhost:4110",
    tokenEndpointAuthMethod,
    applicationAccessGrants: allApplicationAccessGrants,
    grantedScopes: allApplicationAccessGrants,
    status: "active"
  });
  await postJson("/admin/service-principal", {
    principalType: "service_account",
    principalId: "svc-a2a-jira-agent",
    effectivePermissions: allEffectivePermissions,
    deniedPermissions: []
  });
  const fullAccessOnboarding = await startGatewayOnboarding();
  assertCondition(fullAccessOnboarding.response.ok, `full-access onboarding should succeed: ${JSON.stringify(fullAccessOnboarding.body)}`);
  assertCondition((fullAccessOnboarding.body.capabilityDecision?.approvedCapabilities ?? []).some((item) => item.capability === "jira.issue.create"), "full-access onboarding should approve create issue action");
  assertNoSecretMarkers(fullAccessOnboarding.body);
  ok("all grants and permissions approve create issue action");

  const disabled = await postJson("/admin/oauth-application", {
    appName: "Jira Agent Connected App",
    clientId: "jira-agent-client",
    authorizationServerIssuer: "http://localhost:4110",
    tokenEndpointAuthMethod,
    applicationAccessGrants: requestedScopes,
    grantedScopes: requestedScopes,
    status: "disabled"
  });
  assertCondition(disabled.response.ok, "failed to disable OAuth application for verification");

  const disabledOnboarding = await gatewayRequest<{ error?: string; details?: string[] }>("/agent-onboarding/start", {
    method: "POST",
    body: JSON.stringify({
      agentBaseUrl: baseUrl,
      expectedAgentId: agentId
    })
  });
  assertCondition(!disabledOnboarding.response.ok, "disabled OAuth app should fail Gateway onboarding");
  const disabledFailureText = JSON.stringify(disabledOnboarding.body);
  assertCondition(
    disabledFailureText.includes("OAuth application is not active") ||
      disabledFailureText.includes("external_agent_not_ready") ||
      disabledFailureText.includes("external agent trust response could not be obtained or verified"),
    "disabled OAuth app failure reason mismatch"
  );
  ok("disabled OAuth application rejected during onboarding");

  const reset = await postJson("/admin/reset-demo", {});
  assertCondition(reset.response.ok, "failed to restore demo config after disabled OAuth verification");
}

async function verifyRuntimeIfTokenProvided(): Promise<void> {
  const token = process.env.RUNTIME_BEARER_TOKEN;
  if (!token) {
    console.log("skip - runtime JWT validation requires RUNTIME_BEARER_TOKEN");
    return;
  }

  const { response, body } = await postJson<{ status?: string }>("/a2a/task", {
    message: "Diagnose Jira access"
  }, {
    authorization: `Bearer ${token}`
  });

  assertCondition(response.ok, `runtime task failed with ${response.status}`);
  assertCondition(body.status === "diagnosed", "runtime response did not diagnose");
  ok("runtime A2A JWT validation");
}

async function main(): Promise<void> {
  console.log(`Verifying external agent at ${baseUrl}`);
  await verifyAdminConfig();
  const { jwksUri } = await verifyDiscovery();
  await verifyJwks();
  await verifyOnboarding(jwksUri);
  await verifyRuntimeIfTokenProvided();
  console.log("External agent verification passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "external agent verification failed");
  process.exitCode = 1;
});
