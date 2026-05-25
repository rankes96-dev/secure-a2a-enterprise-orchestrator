import { existsSync, readFileSync } from "node:fs";

function read(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`Missing required file: ${path}`);
  }
  return readFileSync(path, "utf8");
}

function ok(message: string): void {
  console.info(`ok - ${message}`);
}

function fail(message: string): never {
  throw new Error(message);
}

function requireIncludes(source: string, needle: string, label: string): void {
  if (!source.includes(needle)) {
    fail(`${label} missing: ${needle}`);
  }
  ok(label);
}

function requireRegex(source: string, pattern: RegExp, label: string): void {
  if (!pattern.test(source)) {
    fail(`${label} missing pattern: ${pattern}`);
  }
  ok(label);
}

function requireNotIncludes(source: string, needle: string, label: string): void {
  if (source.includes(needle)) {
    fail(`${label} should not include: ${needle}`);
  }
  ok(label);
}

function routeBlock(source: string, method: string, path: string): string {
  const marker = `request.method === "${method}" && request.url === "${path}"`;
  const start = source.indexOf(marker);
  if (start === -1) {
    fail(`route block missing: ${method} ${path}`);
  }
  const next = source.indexOf("\n  if (request.method", start + marker.length);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

function verifyFrontend(): void {
  const main = read("apps/web-ui/src/main.tsx");
  const login = read("apps/web-ui/src/components/auth/LoginScreen.tsx");
  const accessDenied = read("apps/web-ui/src/components/auth/AccessDeniedScreen.tsx");
  const auth0Client = read("apps/web-ui/src/auth/auth0Client.ts");
  const frontend = `${main}\n${login}\n${accessDenied}\n${auth0Client}`;

  for (const state of ["checking", "anonymous", "authenticated", "access_denied", "error"]) {
    requireRegex(main, new RegExp(`type\\s+AppAuthState[\\s\\S]*"${state}"`), `frontend auth state ${state}`);
  }

  requireIncludes(login, "Sign in to continue", "login screen sign-in copy");
  requireIncludes(login, "AI agent execution is blocked until your identity is verified", "login screen execution-blocked copy");
  requireIncludes(login, "Login with Auth0", "login screen Auth0 action");
  requireIncludes(login, "Use demo identity", "login screen demo action");
  requireIncludes(accessDenied, "Access denied.", "access denied title");
  requireIncludes(accessDenied, "Your user is not enabled for this gateway.", "access denied safe copy");
  requireIncludes(accessDenied, "Contact the gateway administrator.", "access denied administrator copy");

  requireRegex(main, /if \(appAuthState === "checking"\)[\s\S]*return \(/, "frontend gates checking state before main app");
  requireRegex(main, /if \(appAuthState === "anonymous" \|\| appAuthState === "error"\)[\s\S]*<LoginScreen/, "frontend gates anonymous and error states before main app");
  requireRegex(main, /if \(appAuthState === "access_denied"\)[\s\S]*<AccessDeniedScreen/, "frontend gates access denied state before main app");
  requireRegex(main, /const activePageHeader = activePageHeaders\[activeTab\];[\s\S]*return \(\s*<main className=\{`shell control-plane-shell/, "main app renders only after auth gates");

  requireRegex(main, /response\.status === 401[\s\S]*setAppAuthState\("anonymous"\)|response\.status === 401[\s\S]*transitionToAnonymous/, "frontend handles 401 as anonymous");
  requireRegex(main, /response\.status === 403[\s\S]*setAppAuthState\("access_denied"\)|response\.status === 403[\s\S]*transitionToAccessDenied/, "frontend handles 403 as access denied");
  requireIncludes(frontend, "/auth/callback", "frontend still uses Auth0 callback route");
  requireIncludes(main, "postBearerIdentitySession(API_URL, result.accessToken)", "frontend posts Auth0 token to Gateway identity session");

  const localStorageTokenPattern = /localStorage\.(?:setItem|getItem)\([^)]*(token|jwt|code|state|verifier|auth0|identity|session)/i;
  if (localStorageTokenPattern.test(frontend)) {
    fail("frontend appears to use localStorage for token or callback material");
  }
  ok("frontend does not use localStorage for token or callback material");

  for (const forbiddenDisplay of ["access_token", "code_verifier", "client_secret", "Authorization: Bearer"]) {
    if (login.includes(forbiddenDisplay) || accessDenied.includes(forbiddenDisplay)) {
      fail(`auth shell displays forbidden raw auth material marker: ${forbiddenDisplay}`);
    }
  }
  ok("auth shell does not display raw token or callback markers");
}

function verifyBackend(): void {
  const backend = read("services/orchestrator-api/src/index.ts");

  requireIncludes(backend, 'request.method === "GET" && request.url === "/identity/session"', "backend has GET /identity/session");
  requireRegex(backend, /GET" && request\.url === "\/identity\/session"[\s\S]*identity_session_required/, "backend current identity returns 401 when identity missing");
  requireRegex(backend, /GET" && request\.url === "\/identity\/session"[\s\S]*verifyUserDirectoryAccess/, "backend current identity rechecks user directory access");
  requireRegex(backend, /request\.method !== "POST" \|\| request\.url !== "\/resolve"[\s\S]*requireSessionToken/, "backend /resolve requires session");
  requireRegex(backend, /\/resolve"[\s\S]*currentUserIdentity\(sessionToken\)/, "backend /resolve requires attached identity");
  requireIncludes(backend, "function requireIdentitySession", "backend has identity-session route helper");
  requireRegex(backend, /\/agent-onboarding"[\s\S]*requireIdentity: true/, "backend agent onboarding list requires identity");
  requireRegex(backend, /\/agent-onboarding\/supported-connectors"[\s\S]*requireIdentity: true/, "backend supported connectors requires identity");
  requireRegex(backend, /\/agent-onboarding\/discover"[\s\S]*requireIdentity: true/, "backend onboarding discovery requires identity");
  requireRegex(backend, /\/agent-onboarding\/start"[\s\S]*requireIdentity: true/, "backend onboarding start requires identity");
  requireRegex(backend, /\/demo\/end-user-ready"[\s\S]*requireIdentity: true/, "backend demo preparation requires identity");

  requireIncludes(backend, "function requireIdentityOrAdminAccess", "backend has identity/admin access helper");
  const agentsHealthRoute = routeBlock(backend, "GET", "/agents/health");
  requireIncludes(agentsHealthRoute, "requireIdentityOrAdminAccess(request, response)", "backend /agents/health uses identity/admin access");
  requireNotIncludes(agentsHealthRoute, "requireClientAccess", "backend /agents/health avoids raw-session access helper");

  const debugRoute = routeBlock(backend, "GET", "/debug/ai-config");
  requireNotIncludes(debugRoute, "requireClientAccess", "backend /debug/ai-config avoids raw-session access helper");
  requireIncludes(debugRoute, "hasValidClientApiKey(request)", "backend /debug/ai-config checks API key");
  requireIncludes(debugRoute, "ALLOW_DEBUG_AI_CONFIG_WITH_IDENTITY", "backend /debug/ai-config has explicit non-production identity override");
  requireIncludes(debugRoute, "process.env.NODE_ENV !== \"production\"", "backend /debug/ai-config override is non-production only");
  requireIncludes(debugRoute, "admin_access_required", "backend /debug/ai-config denies missing admin access");

  requireNotIncludes(backend, "with body ${body}", "backend health output avoids upstream response bodies");
  requireNotIncludes(backend, "Unexpected health payload: ${body}", "backend health output avoids upstream unexpected payload body");

  requireRegex(backend, /request\.url === "\/\.well-known\/a2a-gateway\.json"[\s\S]*sendJson\(response, 200, gatewayMetadata/, "gateway metadata remains public");
  requireRegex(backend, /request\.url === "\/\.well-known\/jwks\.json"[\s\S]*sendJson\(response, 200, await gatewayPublicJwks/, "gateway JWKS remains public");
}

function verifyDocs(): void {
  const platform = read("docs/v2-platform-foundation.md");
  const deployment = read("docs/deployment.md");
  const docs = `${platform}\n${deployment}`;

  requireIncludes(platform, "Phase 2.8  Authenticated App Shell / Required Login", "platform docs include Phase 2.8");
  requireIncludes(docs, "ran@gateway.com", "docs mention seeded ran@gateway.com user");
  requireRegex(docs, /passwordless[\s\S]*(no raw token material|no token storage|not stored in `localStorage`)/i, "docs mention passwordless users table and no token storage");
  requireIncludes(deployment, "npm.cmd run db:apply-platform-schema", "deployment docs include platform schema apply");
  requireIncludes(deployment, "npm.cmd run db:seed-platform-user", "deployment docs include platform user seed");
  requireIncludes(deployment, "AUTH0_REQUIRE_USER_DIRECTORY=true", "deployment docs include Auth0 directory gate");
  requireIncludes(platform, "Browser session is not authentication", "platform docs distinguish session from authentication");
  requireIncludes(platform, "`/agents/health` requires identity/admin access", "platform docs cover health endpoint access");
  requireIncludes(platform, "`/debug/ai-config` is admin/API-key only by default", "platform docs cover debug endpoint access");
  requireIncludes(platform, "Health checks do not return upstream response bodies", "platform docs cover health body sanitization");
  requireIncludes(deployment, "ALLOW_DEBUG_AI_CONFIG_WITH_IDENTITY=false", "deployment docs include debug identity override default");
  requireIncludes(deployment, "Do not enable identity-based debug config in production", "deployment docs warn against production debug override");
}

verifyFrontend();
verifyBackend();
verifyDocs();

console.info("Authenticated app shell verification passed.");
