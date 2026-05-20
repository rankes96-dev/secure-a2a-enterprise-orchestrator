import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(ts|tsx|css)$/u.test(path) ? [path] : [];
  });
}

const authConfig = readFileSync("apps/web-ui/src/auth/authConfig.ts", "utf8");
const auth0Client = readFileSync("apps/web-ui/src/auth/auth0Client.ts", "utf8");
const mockAuthClient = readFileSync("apps/web-ui/src/auth/mockAuthClient.ts", "utf8");
const main = readFileSync("apps/web-ui/src/main.tsx", "utf8");
const trustIdentityTab = readFileSync("apps/web-ui/src/components/trust-identity/TrustIdentityTab.tsx", "utf8");
const envExample = readFileSync("apps/web-ui/.env.example", "utf8");
const deploymentDocs = readFileSync("docs/deployment.md", "utf8");

for (const phrase of [
  'const configured = cleanEnv(value) ?? "mock"',
  'provider: "mock", isConfigured: true',
  "Auth0 login is not configured for this deployment."
]) {
  assert(authConfig.includes(phrase), `frontend auth config missing required phrase: ${phrase}`);
}

for (const phrase of [
  "VITE_AUTH_PROVIDER",
  "VITE_AUTH0_DOMAIN",
  "VITE_AUTH0_CLIENT_ID",
  "VITE_AUTH0_AUDIENCE"
]) {
  assert(authConfig.includes(phrase), `Auth0 config must use public frontend env only: ${phrase}`);
}

for (const forbidden of [
  "AUTH0_CLIENT_SECRET",
  "CLIENT_SECRET",
  "INTERNAL_SERVICE_TOKEN",
  "ORCHESTRATOR_PRIVATE_JWK_JSON",
  "OPENROUTER_API_KEY",
  "UPSTASH_REDIS_REST_TOKEN"
]) {
  assert(!authConfig.includes(forbidden), `Auth0 frontend config must not reference secret env: ${forbidden}`);
  assert(!auth0Client.includes(forbidden), `Auth0 frontend client must not reference secret env: ${forbidden}`);
}

for (const phrase of [
  "code_challenge_method",
  "authorization_code",
  "client_id: config.clientId",
  "https://${config.domain}/oauth/token",
  "return { handled: true, accessToken: body.access_token }"
]) {
  assert(auth0Client.includes(phrase), `Auth0 frontend client missing PKCE/token exchange phrase: ${phrase}`);
}

assert(mockAuthClient.includes("/identity/demo-login"), "mock login flow must still call /identity/demo-login");
assert(mockAuthClient.includes("/identity/session"), "Auth0 bearer flow must post to /identity/session");
assert(mockAuthClient.includes("authorization: `Bearer ${accessToken}`"), "Auth0 bearer flow must send token as Authorization bearer header");

for (const phrase of [
  "completeAuth0Redirect(auth0Config)",
  "postBearerIdentitySession(API_URL, result.accessToken)",
  "startAuth0LoginRedirect(frontendAuthConfig)",
  "frontendAuthConfig.provider === \"mock\"",
  "frontendAuthConfig.provider !== \"auth0\"",
  "Demo login is unavailable when Auth0 is the active identity provider."
]) {
  assert(main.includes(phrase), `main frontend auth flow missing required phrase: ${phrase}`);
}

for (const phrase of [
  "Login with Auth0",
  "Auth0 login is not configured for this deployment.",
  "loginDemoUser",
  "loginAuth0User",
  "activeIdentityProvider",
  "Raw JWT"
]) {
  assert(trustIdentityTab.includes(phrase), `identity UI missing required Auth0/mock phrase: ${phrase}`);
}

for (const forbidden of [
  "accessToken}</",
  "accessToken ??",
  "setAccessToken",
  "Auth0 access token"
]) {
  assert(!trustIdentityTab.includes(forbidden), `identity UI must not display raw Auth0 token: ${forbidden}`);
  assert(!main.includes(forbidden), `main UI state must not display/store raw Auth0 token: ${forbidden}`);
}

const frontendSource = sourceFiles("apps/web-ui/src")
  .map((path) => [path, readFileSync(path, "utf8")] as const);
for (const [path, content] of frontendSource) {
  for (const forbidden of [
    "INTERNAL_SERVICE_TOKEN",
    "ORCHESTRATOR_PRIVATE_JWK_JSON",
    "OPENROUTER_API_KEY",
    "UPSTASH_REDIS_REST_TOKEN",
    "ORCHESTRATOR_CLIENT_SECRET",
    "AUTH0_CLIENT_SECRET"
  ]) {
    assert(!content.includes(forbidden), `frontend source ${path} must not reference secret env: ${forbidden}`);
  }
}

for (const phrase of [
  "VITE_AUTH_PROVIDER=mock",
  "# VITE_AUTH_PROVIDER=auth0",
  "# VITE_AUTH0_DOMAIN=<tenant>.auth0.com",
  "# VITE_AUTH0_CLIENT_ID=<spa-client-id>",
  "# VITE_AUTH0_AUDIENCE=<api-audience>"
]) {
  assert(envExample.includes(phrase), `web UI env example missing Auth0 readiness phrase: ${phrase}`);
}

for (const phrase of [
  "VITE_AUTH_PROVIDER=auth0",
  "VITE_AUTH0_DOMAIN=<tenant>.auth0.com",
  "VITE_AUTH0_CLIENT_ID=<spa-client-id>",
  "VITE_AUTH0_AUDIENCE=<api-audience>",
  "AUTH_PROVIDER=auth0",
  "AUTH0_ISSUER=https://<tenant>.auth0.com/",
  "AUTH0_AUDIENCE=<auth0-api-audience>",
  "Mock IdP remains the A2A machine-token issuer"
]) {
  assert(deploymentDocs.includes(phrase), `deployment docs missing Auth0 frontend/backend phrase: ${phrase}`);
}

console.log("Auth0 frontend readiness verification passed.");
