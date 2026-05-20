import { readFileSync } from "node:fs";
import { createIdentityProvider } from "../services/orchestrator-api/src/identity/identityConfig";

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

const auth0Provider = createIdentityProvider({
  AUTH_PROVIDER: "auth0",
  AUTH0_ISSUER: "https://example.auth0.com/",
  AUTH0_AUDIENCE: "secure-a2a-gateway",
  AUTH0_JWKS_URI: "https://example.auth0.com/.well-known/jwks.json"
});
assert(auth0Provider.name === "auth0", "complete Auth0 config should create auth0 provider scaffold");

const index = readFileSync("services/orchestrator-api/src/index.ts", "utf8");
for (const phrase of [
  "const userIdentityProvider = getIdentityProvider()",
  "userIdentityProvider.validateBearerToken",
  "userIdentityProvider.publicIdentity",
  "demo_login_unavailable_for_identity_provider",
  "userIdentityProvider: {",
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
