import { agentId, agentIssuer, clientId, selectedConnectorId, tokenEndpointAuthMethod } from "./config.js";
import { deriveRequestedApplicationGrants, getConnectorProfile } from "./connectorProfile.js";
import type { ConnectorProfile } from "./connectors/types.js";

const profile = getConnectorProfile(process.env.VERIFY_EXPECTED_CONNECTOR_ID ?? selectedConnectorId);
const baseUrl = agentIssuer();
const gatewayUrl = process.env.ORCHESTRATOR_API_URL ?? "http://127.0.0.1:4000";
const allApplicationAccessGrants = profile.applicationAccessGrantCatalog.map((grant) => grant.id);
const allEffectivePermissions = profile.effectivePermissionCatalog.map((permission) => permission.id);
const defaultDeclaredSkills = profile.demoDefaults.defaultEnabledSkillIds?.length
  ? [...profile.demoDefaults.defaultEnabledSkillIds]
  : profile.skillCatalog.map((skill) => skill.id);
const defaultRequestedApplicationGrants = deriveRequestedApplicationGrants(defaultDeclaredSkills, profile.connectorId);
const defaultApplicationAccessGrants = profile.demoDefaults.oauthApplication.defaultApplicationAccessGrants;
const defaultEffectivePermissions = profile.demoDefaults.servicePrincipal.defaultEffectivePermissions;
const defaultDeniedPermissions = profile.demoDefaults.servicePrincipal.defaultDeniedPermissions;
let gatewaySessionCookie = "";

type GatewayOnboardingBody = {
  trustLevel?: string;
  discoveredAgent?: {
    agentDeclaredSkills?: string[];
    agentDeclaredCapabilities?: string[];
    requestedScopes?: string[];
    requestedApplicationGrants?: string[];
  };
  connectorProfile?: {
    connectorId?: string;
    resourceSystem?: string;
    displayName?: string;
    version?: string;
    profileSource?: string;
  };
  connectorProfileVerified?: boolean;
  connectorDecisionSource?: string;
  skillDecision?: {
    approvedActions?: Array<{ capability?: string; reason?: string }>;
    blockedActions?: Array<{ capability?: string; reason?: string }>;
  };
  capabilityDecision?: {
    approvedCapabilities?: Array<{ capability?: string; reason?: string }>;
    blockedCapabilities?: Array<{ capability?: string; reason?: string }>;
  };
  externalApplicationAttestation?: {
    connectorId?: string;
    connectorProfileUrl?: string;
    connectorProfileHash?: string;
    externalConfigHash?: string;
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

function sameMembers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((value) => actual.includes(value));
}

function expectedDecision(profileToEvaluate: ConnectorProfile, grants: string[], permissions: string[], denied: string[]) {
  const grantSet = new Set(grants);
  const permissionSet = new Set(permissions);
  const deniedSet = new Set(denied);
  const enabled = new Set(defaultDeclaredSkills);
  const approved: string[] = [];
  const blocked: string[] = [];

  for (const skill of profileToEvaluate.skillCatalog.filter((item) => enabled.has(item.id))) {
    const missingGrant = skill.requiredApplicationGrants.some((grant) => !grantSet.has(grant));
    const missingPermission = skill.requiredEffectivePermissions.some((permission) => !permissionSet.has(permission) && !deniedSet.has(permission));
    const deniedPermission = skill.requiredEffectivePermissions.some((permission) => deniedSet.has(permission));
    if (missingGrant || missingPermission || deniedPermission) {
      blocked.push(skill.id);
    } else {
      approved.push(skill.id);
    }
  }

  return { approved, blocked };
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

async function verifyDiscovery(): Promise<{ jwksUri: string }> {
  const discovery = await getJson<{
    agentId: string;
    issuer: string;
    resourceSystem: string;
    connectorId: string;
    connectorDisplayName: string;
    connectorProfileUrl: string;
    supportedConnectorProfileUrl: string;
    externalConfigHash: string;
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
  assertCondition(discovery.resourceSystem === profile.resourceSystem, "discovery resourceSystem mismatch");
  assertCondition(discovery.connectorId === profile.connectorId, "discovery connectorId mismatch");
  assertCondition(discovery.connectorDisplayName === profile.displayName, "discovery connector display name mismatch");
  assertCondition(discovery.connectorProfileUrl === `${baseUrl}/.well-known/a2a-connector-profile.json`, "discovery connectorProfileUrl mismatch");
  assertCondition(typeof discovery.externalConfigHash === "string" && discovery.externalConfigHash.length === 64, "discovery missing externalConfigHash");
  assertCondition(discovery.supportedConnectorProfileUrl === `${baseUrl}/.well-known/a2a-supported-connectors.json`, "discovery supportedConnectorProfileUrl mismatch");
  assertCondition(discovery.trustAdapter === profile.resourceSystem, "discovery trustAdapter mismatch");
  assertCondition(discovery.connectionRequirements.requiresGatewayRegistration === true, "discovery missing gateway registration requirement");
  assertCondition(discovery.connectionRequirements.requiresOAuthApplication === true, "discovery missing OAuth app requirement");
  assertCondition(discovery.connectionRequirements.requiresServicePrincipal === true, "discovery missing service principal requirement");
  assertCondition(discovery.auth.audience === agentId, "discovery audience mismatch");
  assertCondition(discovery.auth.tokenEndpointAuthMethod === tokenEndpointAuthMethod, "discovery token auth method mismatch");
  assertNoSecretMarkers(discovery);
  ok("discovery metadata");
  return { jwksUri: discovery.jwksUri };
}

async function verifySupportedConnectors(): Promise<void> {
  const connectors = await getJson<Array<{ connectorId: string; resourceSystem: string; displayName: string; status: string }>>("/.well-known/a2a-supported-connectors.json");
  assertCondition(connectors.some((connector) => connector.connectorId === profile.connectorId && connector.resourceSystem === profile.resourceSystem && connector.status === "available"), "supported connectors missing selected connector");
  assertNoSecretMarkers(connectors);
  ok("supported connectors");
}

async function verifyConnectorProfile(): Promise<void> {
  const actual = await getJson<ConnectorProfile>("/.well-known/a2a-connector-profile.json");
  assertCondition(actual.connectorId === profile.connectorId, "connector profile connectorId mismatch");
  assertCondition(actual.resourceSystem === profile.resourceSystem, "connector profile resourceSystem mismatch");
  assertCondition(actual.displayName === profile.displayName, "connector profile display name mismatch");
  assertCondition(actual.version === profile.version, "connector profile version mismatch");
  assertCondition(actual.profileSource === profile.profileSource, "connector profile source mismatch");
  assertCondition(Array.isArray(actual.applicationAccessGrantCatalog) && actual.applicationAccessGrantCatalog.length === profile.applicationAccessGrantCatalog.length, "connector profile application access grant catalog mismatch");
  assertCondition(Array.isArray(actual.effectivePermissionCatalog) && actual.effectivePermissionCatalog.length === profile.effectivePermissionCatalog.length, "connector profile effective permission catalog mismatch");
  assertCondition(Array.isArray(actual.skillCatalog) && sameMembers(actual.skillCatalog.map((skill) => skill.id), profile.skillCatalog.map((skill) => skill.id)), "connector profile skill catalog mismatch");
  assertNoSecretMarkers(actual);
  ok("connector profile");
}

async function verifyAdminConfig(): Promise<void> {
  await postJson("/admin/reset-demo", {});
  const config = await getJson<{
    ready: boolean;
    warnings: string[];
    trustedGateway: { clientId: string; issuer: string; jwksUri: string };
    selectedConnectorId: string;
    selectedConnector?: { connectorId: string; resourceSystem: string; status: string };
    supportedConnectors: Array<{ connectorId: string; resourceSystem: string; status: string }>;
    oauthApplication: { appName: string; clientId: string; applicationAccessGrants: string[]; grantedScopes: string[]; status: string };
    servicePrincipal: { principalId: string; effectivePermissions: string[]; deniedPermissions: string[] };
    capabilityDeclaration: { requestedApplicationGrants: string[]; requestedScopes: string[]; agentDeclaredCapabilities: string[] };
    actionReadiness: Array<{ actionId: string; status: string; missingApplicationGrants: string[]; deniedPermissions: string[] }>;
    externalConfigHash: string;
    externalConfigUpdatedAt: string;
  }>("/admin/config");

  assertCondition(config.ready === true, `admin config should be ready: ${config.warnings.join(" ")}`);
  assertCondition(config.selectedConnectorId === profile.connectorId, "selected connector mismatch");
  assertCondition(config.selectedConnector?.connectorId === profile.connectorId, "selected connector metadata missing");
  assertCondition(typeof config.externalConfigHash === "string" && config.externalConfigHash.length === 64, "admin config missing externalConfigHash");
  assertCondition(typeof config.externalConfigUpdatedAt === "string", "admin config missing externalConfigUpdatedAt");
  assertCondition(config.supportedConnectors.some((connector) => connector.connectorId === profile.connectorId && connector.status === "available"), "admin config missing selected supported connector");
  assertCondition(config.trustedGateway.clientId === "secure-a2a-gateway-client", "trusted Gateway client mismatch");
  assertCondition(config.oauthApplication.appName === profile.demoDefaults.oauthApplication.appName, "OAuth app name mismatch");
  assertCondition(config.oauthApplication.clientId === clientId, "OAuth client mismatch");
  assertCondition(sameMembers(config.oauthApplication.applicationAccessGrants, defaultApplicationAccessGrants), "applicationAccessGrants mismatch");
  assertCondition(sameMembers(config.oauthApplication.grantedScopes, defaultApplicationAccessGrants), "grantedScopes mismatch");
  assertCondition(config.oauthApplication.status === "active", "OAuth application should be active");
  assertCondition(config.servicePrincipal.principalId === profile.demoDefaults.servicePrincipal.principalId, "service principal mismatch");
  assertCondition(sameMembers(config.servicePrincipal.effectivePermissions, defaultEffectivePermissions), "effectivePermissions mismatch");
  assertCondition(sameMembers(config.servicePrincipal.deniedPermissions, defaultDeniedPermissions), "deniedPermissions mismatch");
  assertCondition(sameMembers(config.capabilityDeclaration.agentDeclaredCapabilities, defaultDeclaredSkills), "agentDeclaredCapabilities mismatch");
  assertCondition(sameMembers(config.capabilityDeclaration.requestedApplicationGrants, defaultRequestedApplicationGrants), "derived requestedApplicationGrants mismatch");
  assertNoSecretMarkers(config);
  ok("admin config ready");
}

async function verifyJwks(): Promise<void> {
  const jwks = await getJson<{ keys?: unknown[] }>("/.well-known/jwks.json");
  assertCondition(Array.isArray(jwks.keys) && jwks.keys.length > 0, "JWKS did not include public keys");
  assertCondition(!JSON.stringify(jwks).match(/"d"|privateKey|"private_key"\s*:|secret/i), "JWKS exposed private key material");
  ok("public JWKS");
}

async function createGatewaySessionIfAvailable(): Promise<boolean> {
  const gatewayHealth = await fetch(`${gatewayUrl}/health`).catch(() => undefined);
  if (!gatewayHealth?.ok) {
    console.log("skip - full signed gateway onboarding requires Gateway running");
    return false;
  }

  const session = await gatewayRequest<{ ok?: boolean }>("/session", { method: "POST" });
  assertCondition(session.response.ok, `Gateway session failed with ${session.response.status}`);
  gatewaySessionCookie = session.response.headers.get("set-cookie")?.split(";")[0] ?? "";
  assertCondition(Boolean(gatewaySessionCookie), "Gateway session cookie missing");
  return true;
}

async function startGatewayOnboarding(): Promise<{ response: Response; body: GatewayOnboardingBody }> {
  return gatewayRequest<GatewayOnboardingBody>("/agent-onboarding/start", {
    method: "POST",
    body: JSON.stringify({
      agentBaseUrl: baseUrl,
      expectedAgentId: agentId,
      expectedResourceSystem: profile.resourceSystem,
      expectedConnectorId: profile.connectorId
    })
  });
}

function assertOnboardingDecision(body: GatewayOnboardingBody, expectedApproved: string[], expectedBlocked: string[], label: string): void {
  const approved = body.skillDecision?.approvedActions ?? body.capabilityDecision?.approvedCapabilities ?? [];
  const blocked = body.skillDecision?.blockedActions ?? body.capabilityDecision?.blockedCapabilities ?? [];
  assertCondition(sameMembers(approved.map((item) => item.capability ?? ""), expectedApproved), `${label} approved action decision mismatch`);
  assertCondition(sameMembers(blocked.map((item) => item.capability ?? ""), expectedBlocked), `${label} blocked action decision mismatch`);
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

  if (!(await createGatewaySessionIfAvailable())) {
    return;
  }

  const gatewayOnboarding = await startGatewayOnboarding();
  assertCondition(gatewayOnboarding.response.ok, `Gateway onboarding failed with ${gatewayOnboarding.response.status}: ${JSON.stringify(gatewayOnboarding.body)}`);
  assertCondition(gatewayOnboarding.body.trustLevel === "trusted_metadata_only", "Gateway onboarding trust level mismatch");
  assertCondition(sameMembers(gatewayOnboarding.body.discoveredAgent?.agentDeclaredSkills ?? [], defaultDeclaredSkills), "Gateway onboarding missing agent-declared skills");
  assertCondition(sameMembers(gatewayOnboarding.body.discoveredAgent?.agentDeclaredCapabilities ?? [], defaultDeclaredSkills), "Gateway onboarding missing compatibility agent-declared capabilities");
  assertCondition(sameMembers(gatewayOnboarding.body.discoveredAgent?.requestedApplicationGrants ?? [], defaultRequestedApplicationGrants), "Gateway onboarding missing requested application grants");
  assertCondition(gatewayOnboarding.body.externalApplicationAttestation?.oauthApplication?.clientId === clientId, "Gateway onboarding missing external OAuth app attestation");
  assertCondition(gatewayOnboarding.body.externalApplicationAttestation?.connectorId === profile.connectorId, "Gateway onboarding missing connectorId attestation");
  assertCondition(gatewayOnboarding.body.externalApplicationAttestation?.connectorProfileUrl === `${baseUrl}/.well-known/a2a-connector-profile.json`, "Gateway onboarding missing connector profile URL attestation");
  assertCondition(typeof gatewayOnboarding.body.externalApplicationAttestation?.connectorProfileHash === "string", "Gateway onboarding missing connector profile hash attestation");
  assertCondition(typeof gatewayOnboarding.body.externalApplicationAttestation?.externalConfigHash === "string", "Gateway onboarding missing external config hash attestation");
  assertCondition(gatewayOnboarding.body.connectorProfile?.connectorId === profile.connectorId, "Gateway onboarding missing connector profile");
  assertCondition(gatewayOnboarding.body.connectorProfileVerified === true, "Gateway connector profile should be verified");
  assertCondition(gatewayOnboarding.body.connectorDecisionSource === profile.connectorId, "Gateway connector decision source mismatch");
  assertCondition(gatewayOnboarding.body.externalApplicationAttestation?.oauthApplication?.appName === profile.demoDefaults.oauthApplication.appName, "Gateway onboarding missing OAuth app name attestation");
  assertCondition(gatewayOnboarding.body.externalApplicationAttestation?.servicePrincipal?.principalId === profile.demoDefaults.servicePrincipal.principalId, "Gateway onboarding missing service principal attestation");
  assertCondition(gatewayOnboarding.body.checks?.some((check) => check.name === "connector_profile_verified" && check.status === "passed"), "Gateway onboarding did not verify connector profile");
  ok("signed gateway onboarding exchange");

  const defaultDecision = expectedDecision(profile, defaultApplicationAccessGrants, defaultEffectivePermissions, defaultDeniedPermissions);
  assertOnboardingDecision(gatewayOnboarding.body, defaultDecision.approved, defaultDecision.blocked, "default");
  assertNoSecretMarkers(gatewayOnboarding.body);
  ok("default action decision preview matches Gateway decision");

  await postJson("/admin/oauth-application", {
    appName: profile.demoDefaults.oauthApplication.appName,
    clientId,
    authorizationServerIssuer: "http://localhost:4110",
    tokenEndpointAuthMethod,
    applicationAccessGrants: [],
    grantedScopes: [],
    status: "active"
  });
  await postJson("/admin/service-principal", {
    principalType: "service_account",
    principalId: profile.demoDefaults.servicePrincipal.principalId,
    effectivePermissions: allEffectivePermissions,
    deniedPermissions: []
  });
  const noGrantOnboarding = await startGatewayOnboarding();
  assertCondition(noGrantOnboarding.response.ok, `no-grant onboarding should succeed: ${JSON.stringify(noGrantOnboarding.body)}`);
  assertOnboardingDecision(noGrantOnboarding.body, [], defaultDeclaredSkills, "no-grant");
  assertCondition((noGrantOnboarding.body.skillDecision?.blockedActions ?? noGrantOnboarding.body.capabilityDecision?.blockedCapabilities ?? []).every((item) => item.reason?.includes("missing application access grant")), "no-grant blocked reasons should mention missing application access grants");
  assertNoSecretMarkers(noGrantOnboarding.body);
  ok("no application grants block all actions without failing onboarding");

  await postJson("/admin/oauth-application", {
    appName: profile.demoDefaults.oauthApplication.appName,
    clientId,
    authorizationServerIssuer: "http://localhost:4110",
    tokenEndpointAuthMethod,
    applicationAccessGrants: allApplicationAccessGrants,
    grantedScopes: allApplicationAccessGrants,
    status: "active"
  });
  await postJson("/admin/service-principal", {
    principalType: "service_account",
    principalId: profile.demoDefaults.servicePrincipal.principalId,
    effectivePermissions: allEffectivePermissions,
    deniedPermissions: []
  });
  const fullAccessOnboarding = await startGatewayOnboarding();
  assertCondition(fullAccessOnboarding.response.ok, `full-access onboarding should succeed: ${JSON.stringify(fullAccessOnboarding.body)}`);
  assertOnboardingDecision(fullAccessOnboarding.body, defaultDeclaredSkills, [], "full-access");
  assertNoSecretMarkers(fullAccessOnboarding.body);
  ok("all grants and permissions approve all declared actions");

  const disabled = await postJson("/admin/oauth-application", {
    appName: profile.demoDefaults.oauthApplication.appName,
    clientId,
    authorizationServerIssuer: "http://localhost:4110",
    tokenEndpointAuthMethod,
    applicationAccessGrants: defaultApplicationAccessGrants,
    grantedScopes: defaultApplicationAccessGrants,
    status: "disabled"
  });
  assertCondition(disabled.response.ok, "failed to disable OAuth application for verification");

  const disabledOnboarding = await gatewayRequest<{ error?: string; details?: string[] }>("/agent-onboarding/start", {
    method: "POST",
    body: JSON.stringify({
      agentBaseUrl: baseUrl,
      expectedAgentId: agentId,
      expectedResourceSystem: profile.resourceSystem,
      expectedConnectorId: profile.connectorId
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
  const knownSkill = defaultDeclaredSkills[0] ?? profile.skillCatalog[0]?.id;
  assertCondition(knownSkill, "selected connector profile has no skill to verify");
  const unknownSkill = await postJson<{ error?: string }>("/a2a/task", {
    skillId: `${profile.connectorId}.unknown.skill`,
    message: "Diagnose connector access"
  });
  assertCondition(unknownSkill.response.status === 400 && unknownSkill.body.error === "unknown_skill", "runtime should reject unknown skill before execution");

  const missingToken = await postJson<{ error?: string }>("/a2a/task", {
    skillId: knownSkill,
    message: "Diagnose connector access"
  });
  assertCondition(missingToken.response.status === 401 && missingToken.body.error === "missing_bearer_token", "runtime should require bearer token for known skill");

  const token = process.env.RUNTIME_BEARER_TOKEN;
  if (!token) {
    console.log("skip - runtime JWT validation requires RUNTIME_BEARER_TOKEN");
    return;
  }
  const config = await getJson<{ externalConfigHash: string }>("/admin/config");

  const { response, body } = await postJson<{ status?: string }>("/a2a/task", {
    skillId: knownSkill,
    message: "Diagnose connector access",
    trustedContext: {
      externalConfigHash: config.externalConfigHash
    }
  }, {
    authorization: `Bearer ${token}`
  });

  assertCondition(response.ok, `runtime task failed with ${response.status}`);
  assertCondition(body.status === "diagnosed", "runtime response did not diagnose");
  ok("runtime A2A JWT validation");
}

async function main(): Promise<void> {
  console.log(`Verifying external agent at ${baseUrl} (${profile.connectorId})`);
  await verifyAdminConfig();
  await verifySupportedConnectors();
  const { jwksUri } = await verifyDiscovery();
  await verifyConnectorProfile();
  await verifyJwks();
  await verifyOnboarding(jwksUri);
  await verifyRuntimeIfTokenProvided();
  console.log("External agent verification passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "external agent verification failed");
  process.exitCode = 1;
});
