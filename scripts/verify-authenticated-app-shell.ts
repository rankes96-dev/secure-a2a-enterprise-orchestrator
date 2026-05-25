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
  const fallbackMarker = `request.method !== "${method}" || request.url !== "${path}"`;
  let start = source.indexOf(marker);
  if (start === -1) {
    start = source.indexOf(fallbackMarker);
  }
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
  requireIncludes(backend, "function requireIdentitySession", "backend has identity-session route helper");
  requireRegex(backend, /function requireIdentitySession[\s\S]*identity_session_required/, "backend identity helper returns 401 when identity missing");
  requireIncludes(backend, "async function requireFreshIdentitySession", "backend has fresh identity session helper");
  requireRegex(backend, /async function requireFreshIdentitySession[\s\S]*verifyUserDirectoryAccess/, "fresh identity helper rechecks user directory access");
  requireRegex(backend, /async function requireFreshIdentitySession[\s\S]*userIdentitiesBySession\.delete\(identitySession\.sessionToken\)/, "fresh identity helper clears denied session identity");
  requireRegex(backend, /async function requireFreshIdentitySession[\s\S]*user_directory_access_denied/, "fresh identity helper returns safe directory denial");
  requireRegex(backend, /async function requireFreshIdentitySession[\s\S]*identityWithDirectoryRoles/, "fresh identity helper merges directory roles");

  const identitySessionRoute = routeBlock(backend, "GET", "/identity/session");
  requireIncludes(identitySessionRoute, "await requireFreshIdentitySession(request, response)", "backend current identity uses fresh directory revalidation");

  const resolveRoute = routeBlock(backend, "POST", "/resolve");
  requireIncludes(resolveRoute, "await requireFreshIdentitySession(request, response)", "backend /resolve uses fresh directory revalidation");

  const trustStatusRoute = routeBlock(backend, "GET", "/identity/trust-status");
  requireIncludes(trustStatusRoute, "await requireFreshIdentitySession(request, response)", "backend /identity/trust-status non-admin path uses fresh revalidation");

  requireIncludes(backend, "async function agentCardRegistryKeyForIdentityOrAdmin", "backend has fresh registry-key helper");
  requireRegex(backend, /async function agentCardRegistryKeyForIdentityOrAdmin[\s\S]*await requireFreshIdentitySession/, "registry-key helper uses fresh directory revalidation");
  requireNotIncludes(backend, "requireIdentity: true", "protected routes do not rely on session-only registry identity option");

  for (const [method, path] of [
    ["POST", "/demo/end-user-ready"],
    ["GET", "/agent-onboarding"],
    ["GET", "/agent-onboarding/supported-connectors"],
    ["POST", "/agent-onboarding/discover"],
    ["POST", "/agent-onboarding/start"]
  ] as const) {
    requireIncludes(routeBlock(backend, method, path), "await agentCardRegistryKeyForIdentityOrAdmin(request, response)", `backend ${path} uses fresh identity/admin registry key`);
  }

  requireIncludes(backend, "function requireIdentityOrAdminAccess", "backend has identity/admin access helper");
  requireRegex(backend, /async function requireIdentityOrAdminAccess[\s\S]*await requireFreshIdentitySession/, "identity/admin helper revalidates directory for identity callers");
  const agentsHealthRoute = routeBlock(backend, "GET", "/agents/health");
  requireIncludes(agentsHealthRoute, "await requireIdentityOrAdminAccess(request, response)", "backend /agents/health uses async identity/admin access");
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
  requireIncludes(platform, "In-memory attached identity is not a permanent authorization decision", "platform docs cover stale identity revalidation");
  requireIncludes(platform, "Disabling a user in the local `users` table invalidates future protected route access", "platform docs cover disabled-user invalidation");
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
