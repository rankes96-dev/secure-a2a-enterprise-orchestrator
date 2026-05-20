import { readFileSync } from "node:fs";
import { createIdentityProvider } from "../services/orchestrator-api/src/identity/identityConfig";
import { mapOidcUserIdentityPayload } from "../services/orchestrator-api/src/identity/userIdentityMapper";

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
assert(auth0IdentityWithoutRoles.roles.length === 0, "missing Auth0 roles claim should map to empty roles");

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
  "jwksUri: safeTrustUrl(userIdentityProvider.jwksUri)",
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
