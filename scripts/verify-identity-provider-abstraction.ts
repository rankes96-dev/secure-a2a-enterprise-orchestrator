import { existsSync, readFileSync } from "node:fs";
import { createIdentityProvider } from "../services/orchestrator-api/src/identity/identityConfig";
import { mapMockUserIdentityPayload, mapOidcUserIdentityPayload } from "../services/orchestrator-api/src/identity/userIdentityMapper";
import { buildExecutionGateStack } from "../services/orchestrator-api/src/executionGateStack";
import { resolveTenantContext } from "../services/orchestrator-api/src/tenant/tenantResolution";
import type { Classification } from "../packages/shared/src";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(label: string, action: () => unknown, expected: string): void {
  try {
    action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(expected), `${label} should include "${expected}", got: ${message}`);
    return;
  }
  throw new Error(`${label} should fail closed`);
}

const mockProvider = createIdentityProvider({ AUTH_PROVIDER: "mock" });
assert(mockProvider.name === "mock", "AUTH_PROVIDER=mock should select mock identity provider");
assert(mockProvider.audience === "secure-a2a-gateway", "mock identity provider should preserve V1 audience");
assert(mockProvider.publicIdentity(undefined).authenticated === false, "mock public identity should hide unauthenticated user details");
assert(!JSON.stringify(mockProvider.publicIdentity(undefined)).includes("token"), "public identity should not expose raw token fields");

const mockIdentity = mapMockUserIdentityPayload({
  payload: {
    token_use: "user_identity",
    sub: "user:ran@company.com",
    email: "Ran@Company.com",
    name: "Ran Keselman",
    roles: ["it-support"]
  },
  issuer: mockProvider.issuer,
  audience: mockProvider.audience
});
const mockPublicIdentity = mockProvider.publicIdentity(mockIdentity);
assert(mockPublicIdentity.provider === "mock", "mock public identity should include safe provider name");
assert(!JSON.stringify(mockPublicIdentity).includes("user:ran@company.com"), "mock public identity should not expose raw subject");
assert(!JSON.stringify(mockPublicIdentity).includes("token"), "mock public identity should not expose raw token fields");

assertThrows(
  "unknown AUTH_PROVIDER",
  () => createIdentityProvider({ AUTH_PROVIDER: "github" }),
  "Unsupported AUTH_PROVIDER"
);

assertThrows(
  "incomplete Auth0 config",
  () => createIdentityProvider({ AUTH_PROVIDER: "auth0" }),
  "AUTH_PROVIDER=auth0 requires AUTH0_ISSUER, AUTH0_AUDIENCE, AUTH0_JWKS_URI"
);

assertThrows(
  "Auth0 HTTP issuer",
  () =>
    createIdentityProvider({
      AUTH_PROVIDER: "auth0",
      AUTH0_ISSUER: "http://example.auth0.com/",
      AUTH0_AUDIENCE: "secure-a2a-gateway",
      AUTH0_JWKS_URI: "https://example.auth0.com/.well-known/jwks.json"
    }),
  "AUTH0_ISSUER must be a valid HTTPS URL"
);

assertThrows(
  "Auth0 invalid JWKS URI",
  () =>
    createIdentityProvider({
      AUTH_PROVIDER: "auth0",
      AUTH0_ISSUER: "https://example.auth0.com/",
      AUTH0_AUDIENCE: "secure-a2a-gateway",
      AUTH0_JWKS_URI: "not-a-url"
    }),
  "AUTH0_JWKS_URI must be a valid HTTPS URL"
);

assertThrows(
  "Auth0 empty email claim",
  () =>
    createIdentityProvider({
      AUTH_PROVIDER: "auth0",
      AUTH0_ISSUER: "https://example.auth0.com/",
      AUTH0_AUDIENCE: "secure-a2a-gateway",
      AUTH0_JWKS_URI: "https://example.auth0.com/.well-known/jwks.json",
      AUTH0_EMAIL_CLAIM: ""
    }),
  "AUTH0_EMAIL_CLAIM must be non-empty when provided"
);

const auth0Provider = createIdentityProvider({
  AUTH_PROVIDER: "auth0",
  AUTH0_ISSUER: "https://example.auth0.com",
  AUTH0_AUDIENCE: "secure-a2a-gateway",
  AUTH0_JWKS_URI: "https://example.auth0.com/.well-known/jwks.json"
});
assert(auth0Provider.name === "auth0", "complete Auth0 config should create auth0 provider scaffold");
assert(auth0Provider.issuer === "https://example.auth0.com/", "Auth0 issuer should normalize to trailing slash");
assert(!JSON.stringify(auth0Provider.publicIdentity(undefined)).includes("token"), "Auth0 public identity should not expose raw token fields");

const auth0IdentityWithoutRoles = mapOidcUserIdentityPayload({
  provider: "auth0",
  payload: {
    sub: "auth0|user-123",
    email: "User@example.com"
  },
  issuer: auth0Provider.issuer,
  audience: auth0Provider.audience,
  emailClaim: "email",
  rolesClaim: "https://secure-a2a.dev/roles"
});
assert(auth0IdentityWithoutRoles.email === "user@example.com", "Auth0 email claim should map safely");
assert(auth0Provider.publicIdentity(auth0IdentityWithoutRoles).provider === "auth0", "Auth0 public identity should include safe provider name");
assert(!JSON.stringify(auth0Provider.publicIdentity(auth0IdentityWithoutRoles)).includes("auth0|user-123"), "Auth0 public identity should not expose raw subject");
assert(auth0IdentityWithoutRoles.roles.length === 0, "missing Auth0 roles claim should map to empty roles");

const auth0OrgIdentity = mapOidcUserIdentityPayload({
  provider: "auth0",
  payload: {
    sub: "auth0|org-user-123",
    email: "OrgUser@example.com",
    org_id: "org_enterprise"
  },
  issuer: auth0Provider.issuer,
  audience: auth0Provider.audience,
  emailClaim: "email",
  rolesClaim: "https://secure-a2a.dev/roles"
});
assert(auth0OrgIdentity.org_id === "org_enterprise", "Auth0 org_id claim should be preserved on verified identity");
assert(!JSON.stringify(auth0Provider.publicIdentity(auth0OrgIdentity)).includes("org_enterprise"), "Auth0 public identity should not expose org claim");
const auth0OrgTenant = resolveTenantContext({ identity: auth0OrgIdentity, requestedTenantId: "org_enterprise" });
assert(auth0OrgTenant.tenantId === "org_enterprise", "Auth0 org identity should resolve to org tenant");
assert(auth0OrgTenant.source === "auth0_org", "Auth0 org identity should use auth0_org tenant resolution source");
assert(auth0OrgTenant.requestedTenantAccepted === true, "Auth0 org requested tenant should be accepted when it matches org_id");

assertThrows(
  "Auth0 malformed roles claim",
  () =>
    mapOidcUserIdentityPayload({
      provider: "auth0",
      payload: {
        sub: "auth0|user-123",
        email: "user@example.com",
        "https://secure-a2a.dev/roles": "admin"
      },
      issuer: auth0Provider.issuer,
      audience: auth0Provider.audience,
      emailClaim: "email",
      rolesClaim: "https://secure-a2a.dev/roles"
    }),
  "claim must be a string array when present"
);

assertThrows(
  "Auth0 missing email claim",
  () =>
    mapOidcUserIdentityPayload({
      provider: "auth0",
      payload: {
        sub: "auth0|user-123"
      },
      issuer: auth0Provider.issuer,
      audience: auth0Provider.audience,
      emailClaim: "email",
      rolesClaim: "https://secure-a2a.dev/roles"
    }),
  "email claim is required"
);

const index = readFileSync("services/orchestrator-api/src/index.ts", "utf8");
for (const phrase of [
  "const userIdentityProvider = getIdentityProvider()",
  "publicIdentitySession(userIdentityProvider",
  "userIdentityProvider.validateBearerToken",
  "demo_login_unavailable_for_identity_provider",
  "requestDemoUserToken(email)",
  "userIdentityProvider: {",
  "provider: userIdentityProvider.name",
  "issuer: userIdentityProvider.issuer",
  "audience: userIdentityProvider.audience",
  "jwksUri: safeTrustUrl(userIdentityProvider.jwksUri, adminView)",
  "rawTokenExposed: false"
]) {
  assert(index.includes(phrase), `orchestrator identity routes/trust status missing provider abstraction phrase: ${phrase}`);
}

for (const forbidden of [
  "accessToken,",
  "rawToken: accessToken",
  "token: accessToken",
  "Authorization: accessToken"
]) {
  assert(!index.includes(forbidden), `orchestrator must not expose raw user token: ${forbidden}`);
}

const auth0Source = readFileSync("services/orchestrator-api/src/identity/auth0IdentityProvider.ts", "utf8");
assert(auth0Source.includes("jwtVerify("), "Auth0 scaffold must verify JWT signature and claims");
assert(!auth0Source.includes("decodeJwt("), "Auth0 scaffold must not decode unsigned tokens");

const executionGateStackSource = readFileSync("services/orchestrator-api/src/executionGateStack.ts", "utf8");
for (const phrase of [
  "user_identity_actor_context",
  "User Identity / Actor Context",
  "actorAttached",
  "runtimeContextIncluded",
  "identityProvider",
  "actorIssuer",
  "actorSubject",
  "rawTokenExposed: false"
]) {
  assert(executionGateStackSource.includes(phrase), `execution gate stack missing actor context proof phrase: ${phrase}`);
}

const tokenClientSource = readFileSync("services/orchestrator-api/src/security/tokenClient.ts", "utf8");
for (const phrase of [
  "actor_provider",
  "actor_issuer",
  "actor_sub",
  "actorProvider",
  "actorIssuer",
  "actorSubject"
]) {
  assert(tokenClientSource.includes(phrase), `Gateway token client missing signed actor provenance phrase: ${phrase}`);
}

const mockIdpSource = readFileSync("services/mock-identity-provider/src/index.ts", "utf8");
for (const phrase of [
  "actor_provider",
  "actor_issuer",
  "actor_sub",
  "claims.actor_provider",
  "claims.actor_issuer",
  "claims.actor_sub"
]) {
  assert(mockIdpSource.includes(phrase), `Mock IdP missing signed actor provenance phrase: ${phrase}`);
}

const externalRuntimeSource = readFileSync("real-external-agent/src/runtime.ts", "utf8");
for (const phrase of [
  "issuer: mockIdpIssuer()",
  "payload.actor_provider",
  "payload.actor_issuer",
  "payload.actor_sub",
  "actorProvider: params.actorProvider",
  "actorIssuer: params.actorIssuer",
  "actorSubject: params.actorSubject"
]) {
  assert(externalRuntimeSource.includes(phrase), `external agent runtime missing verified actor provenance phrase: ${phrase}`);
}
assert(!externalRuntimeSource.includes("AUTH0_"), "external agents must not validate Auth0 directly");

const externalConfigSource = readFileSync("real-external-agent/src/config.ts", "utf8");
assert(externalConfigSource.includes("function mockIdpIssuer"), "real external agent config should expose mockIdpIssuer");
assert(externalConfigSource.includes('env("MOCK_IDP_ISSUER", "http://localhost:4110").replace(/\\/+$/, "")'), "mockIdpIssuer should support explicit MOCK_IDP_ISSUER");

const externalProductionEnv = readFileSync("real-external-agent/.env.production.example", "utf8");
assert(externalProductionEnv.includes("MOCK_IDP_ISSUER=https://<mock-idp>.railway.app"), "external agent production env should include MOCK_IDP_ISSUER");
assert(externalProductionEnv.includes("MOCK_IDP_JWKS_URI=https://<mock-idp>.railway.app/.well-known/jwks.json"), "external agent production env should include MOCK_IDP_JWKS_URI");

const deploymentDocs = readFileSync("docs/deployment.md", "utf8");
for (const phrase of [
  "MOCK_IDP_ISSUER=https://<mock-idp>.railway.app",
  "MOCK_IDP_JWKS_URI=https://<mock-idp>.railway.app/.well-known/jwks.json",
  "must point to the same Mock IdP / A2A token issuer deployment",
  "they do not validate Auth0 directly"
]) {
  assert(deploymentDocs.includes(phrase), `deployment docs missing external runtime issuer validation phrase: ${phrase}`);
}

const frontendTimelineSource = [
  readFileSync("apps/web-ui/src/main.tsx", "utf8"),
  existsSync("apps/web-ui/src/securitySummary.ts") ? readFileSync("apps/web-ui/src/securitySummary.ts", "utf8") : ""
].join("\n");
for (const phrase of [
  "Identity provider",
  "Actor issuer",
  "Actor subject",
  "Runtime actor context",
  "Actor context attached to runtime proof",
  "Raw identity and A2A tokens stayed hidden",
  "actorProvider"
]) {
  assert(frontendTimelineSource.includes(phrase), `Security Timeline missing actor propagation proof phrase: ${phrase}`);
}

const sharedSource = readFileSync("packages/shared/src/index.ts", "utf8");
for (const phrase of [
  'provider?: string',
  'actorProvider?: string',
  'actorIssuer?: string',
  'actorSubject?: string',
  'actor_provider?: string',
  'actor_issuer?: string',
  'actor_sub?: string',
  '"user_identity_actor_context"'
]) {
  assert(sharedSource.includes(phrase), `shared public proof types missing safe actor metadata phrase: ${phrase}`);
}

const envExample = readFileSync("services/orchestrator-api/.env.production.example", "utf8");
for (const phrase of [
  "AUTH_PROVIDER=mock",
  "# AUTH_PROVIDER=auth0",
  "# AUTH0_ISSUER=https://<tenant>.auth0.com/",
  "# AUTH0_AUDIENCE=<auth0-api-audience>",
  "# AUTH0_JWKS_URI=https://<tenant>.auth0.com/.well-known/jwks.json",
  "# AUTH0_EMAIL_CLAIM=email",
  "# AUTH0_ROLES_CLAIM=https://secure-a2a.dev/roles"
]) {
  assert(envExample.includes(phrase), `production env example missing Auth0 readiness phrase: ${phrase}`);
}

const classification: Classification = {
  system: "jira",
  issueType: "AUTHORIZATION_FAILURE",
  operation: "lookup issue",
  confidence: "high",
  reasoningSummary: "Identity provider verification fixture.",
  classificationSource: "rules_fallback",
  reporterType: "it_engineer",
  supportMode: "technical_integration"
};

function verifyActorGateFor(provider: "mock" | "auth0"): void {
  const stack = buildExecutionGateStack({
    userIdentity: {
      authenticated: true,
      provider,
      email: provider === "auth0" ? "auth0-user@example.com" : "ran@company.com",
      roles: provider === "auth0" ? ["support-engineer"] : ["it-support"]
    },
    connectorRouting: {
      status: "connector_skill_approved",
      connectorId: "jira-reference",
      resourceSystem: "jira",
      skillId: "jira.issue.status.lookup",
      skillLabel: "Look up Jira issue status",
      targetSystem: "jira",
      requiredApplicationGrants: ["read:jira-work"],
      requiredEffectivePermissions: ["browse_projects"],
      runtimeMode: "external_runtime_available",
      reason: "Verification fixture route.",
      recommendedNextStep: "Execute runtime."
    },
    connectorRuntime: {
      executed: true,
      runtimeMode: "external_runtime",
      connectorId: "jira-reference",
      resourceSystem: "jira",
      skillId: "jira.issue.status.lookup",
      tokenMetadata: {
        tokenIssued: true,
        audience: "external-jira-agent",
        scope: "read:jira-work",
        actor: provider === "auth0" ? "auth0-user@example.com" : "ran@company.com",
        actorRoles: provider === "auth0" ? ["support-engineer"] : ["it-support"],
        actorProvider: provider,
        actorIssuer: provider === "auth0" ? "https://example.auth0.com/" : "http://localhost:4110",
        actorSubject: provider === "auth0" ? "auth0|user-123" : "user:ran@company.com",
        rawToken: "hidden"
      },
      agentResponse: {
        agentId: "external-jira-agent",
        status: "diagnosed",
        summary: "Verification fixture runtime response."
      }
    },
    resolutionStatus: "resolved",
    classification
  });

  const actorGate = stack.gates.find((gate) => gate.id === "user_identity_actor_context");
  assert(actorGate?.status === "passed", `${provider} actor gate should pass: ${JSON.stringify(actorGate)}`);
  assert(actorGate.reason.includes(`Verified ${provider} user identity`), `${provider} actor gate should name provider: ${actorGate.reason}`);
  assert(actorGate.evidence?.actorAttached === true, `${provider} actor gate should include actorAttached=true`);
  assert(actorGate.evidence?.provider === provider, `${provider} actor gate should include provider evidence`);
  assert(actorGate.evidence?.rawTokenExposed === false, `${provider} actor gate should prove raw token is hidden`);

  const oauthGate = stack.gates.find((gate) => gate.id === "oauth_scope");
  assert(oauthGate?.evidence?.actorAttached === true, `${provider} OAuth gate should include actorAttached=true`);
  assert(oauthGate.evidence.identityProvider === provider, `${provider} OAuth gate should include identityProvider`);
  assert(typeof oauthGate.evidence.actorIssuer === "string", `${provider} OAuth gate should include actorIssuer`);
  assert(typeof oauthGate.evidence.actorSubject === "string", `${provider} OAuth gate should include actorSubject`);
  assert(JSON.stringify(stack).includes('"rawTokenExposed":false'), `${provider} proof should prove raw token is not exposed`);
  for (const forbidden of ["access_token", "Authorization", "Bearer", "Auth0 token"]) {
    assert(!JSON.stringify(stack).includes(forbidden), `${provider} actor proof must not expose ${forbidden}`);
  }
}

verifyActorGateFor("auth0");
verifyActorGateFor("mock");

async function main(): Promise<void> {
  await auth0Provider.validateBearerToken("not-a-jwt").then(
    () => {
      throw new Error("Auth0 provider scaffold must not accept unsigned or malformed tokens");
    },
    () => undefined
  );

  console.log("Identity provider abstraction verification passed.");
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
