import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  createCsrfToken,
  createCsrfTokenForSession,
  csrfCookieHeader,
  shouldBypassCsrfForTrustedInternalRequest,
  verifyCsrfRequest,
  verifyCsrfRequestForSession
} from "../services/orchestrator-api/src/security/csrfProtection.js";
import { createSessionCookieForToken } from "../services/orchestrator-api/src/security/sessionManager.js";

let failed = false;

function fail(message: string): void {
  failed = true;
  console.error(`FAIL: ${message}`);
}

function ok(message: string): void {
  console.log(`ok - ${message}`);
}

function read(path: string): string {
  if (!existsSync(path)) {
    fail(`${path} should exist`);
    return "";
  }

  return readFileSync(path, "utf8");
}

function requireIncludes(source: string, phrase: string, context: string): void {
  if (!source.includes(phrase)) {
    fail(`${context} missing required phrase: ${phrase}`);
    return;
  }

  ok(context);
}

function routeBlock(source: string, route: string): string {
  const start = source.indexOf(`request.method === "POST" && request.url === "${route}"`);
  if (start < 0) {
    fail(`route ${route} should exist`);
    return "";
  }

  const next = source.indexOf("\n  if (request.method", start + 1);
  return source.slice(start, next > start ? next : undefined);
}

function fakeRequest(headers: IncomingMessage["headers"]): IncomingMessage {
  return { headers } as IncomingMessage;
}

const csrfSource = read("services/orchestrator-api/src/security/csrfProtection.ts");
const sessionSource = read("services/orchestrator-api/src/security/sessionManager.ts");
const indexSource = read("services/orchestrator-api/src/index.ts");
const sharedHttpSource = read("packages/shared/src/http.ts");
const fastifySource = read("services/orchestrator-api/src/http/createOgenFastifyApp.ts");
const frontendCsrfSource = read("apps/web-ui/src/api/csrf.ts");
const frontendSessionSource = read("apps/web-ui/src/api/session.ts");
const frontendMainSource = read("apps/web-ui/src/main.tsx");
const frontendAuthSource = read("apps/web-ui/src/auth/mockAuthClient.ts");
const packageJsonSource = read("package.json");
const platformDocs = read("docs/v2-platform-foundation.md");
const deploymentDocs = read("docs/deployment.md");
const productIdentityDocs = read("docs/ogen-product-identity.md");

for (const phrase of [
  'CSRF_COOKIE_NAME = "ogen_csrf"',
  'CSRF_HEADER_NAME = "x-ogen-csrf-token"',
  "randomBytes(32)",
  "createCsrfTokenForSession",
  "verifyCsrfRequestForSession",
  "sessionHash(sessionToken)",
  "createHmac(\"sha256\"",
  "CSRF_SIGNING_SECRET",
  "CSRF_TOKEN_TTL_SECONDS",
  "CSRF_COOKIE_SAMESITE",
  "SESSION_COOKIE_SAMESITE",
  "SESSION_COOKIE_SECURE",
  "timingSafeEqual",
  "function csrfCookieSameSite",
  "function csrfCookieSecure",
  "CSRF_SIGNING_SECRET is required in production",
  "verifyCsrfRequest",
  "shouldBypassCsrfForTrustedInternalRequest"
]) {
  requireIncludes(csrfSource, phrase, "CSRF protection helper exists");
}

if (csrfSource.includes("HttpOnly")) {
  fail("CSRF cookie must not be HttpOnly because the UI must echo it in a header");
} else {
  ok("CSRF cookie is not HttpOnly");
}

for (const phrase of [
  'function sameSite(): "Lax" | "Strict" | "None"',
  "SESSION_COOKIE_SAMESITE",
  'configured === "none"',
  'configured === "strict"',
  "function cookieSecure(): boolean",
  'sameSite() === "None"',
  'process.env.SESSION_COOKIE_SECURE === "true"',
  'process.env.NODE_ENV === "production"',
  '"HttpOnly"',
  "`SameSite=${sameSite()}`"
]) {
  requireIncludes(sessionSource, phrase, "session cookie helper exists");
}

const bypassStart = csrfSource.indexOf("export function shouldBypassCsrfForTrustedInternalRequest");
const bypassSource = csrfSource.slice(bypassStart);
for (const phrase of [
  "configuredSecretMatches(apiKey, process.env.ORCHESTRATOR_API_KEY)",
  "configuredSecretMatches(internalServiceToken, process.env.INTERNAL_SERVICE_TOKEN)"
]) {
  requireIncludes(bypassSource, phrase, "trusted internal CSRF bypass requires configured secret match");
}
if (bypassSource.includes("authorization")) {
  fail("Authorization bearer alone must not bypass CSRF");
} else {
  ok("Authorization bearer alone does not bypass CSRF");
}

for (const phrase of [
  "createSessionToken",
  "createSessionCookieForToken",
  "createCsrfTokenForSession(existingSessionToken)",
  "createCsrfTokenForSession(sessionToken)",
  "csrfCookieHeader",
  "{ ok: true, csrfToken }",
  '"set-cookie": [createSessionCookieForToken(sessionToken), csrfCookieHeader(csrfToken)]'
]) {
  requireIncludes(indexSource, phrase, "POST /session issues CSRF token and cookie");
}

for (const phrase of [
  "const sessionToken = getSessionToken(request)",
  "verifyCsrfRequestForSession(request, sessionToken)"
]) {
  requireIncludes(indexSource, phrase, "protected browser CSRF guard uses session-bound verification");
}
if (indexSource.includes("|| verifyCsrfRequest(request)")) {
  fail("protected browser CSRF guard must not use plain cookie/header equality");
} else {
  ok("protected browser CSRF guard does not use plain cookie/header equality");
}

const sessionRoute = routeBlock(indexSource, "/session");
if (sessionRoute.includes("requireCsrfForBrowserMutation")) {
  fail("POST /session must not require CSRF because it bootstraps the CSRF token");
} else {
  ok("POST /session does not require CSRF");
}

for (const route of [
  "/identity/session",
  "/identity/demo-login",
  "/identity/logout",
  "/runtime/authorize",
  "/agent-onboarding/discover",
  "/agent-onboarding/start",
  "/demo/end-user-ready"
]) {
  requireIncludes(routeBlock(indexSource, route), "requireCsrfForBrowserMutation(request, response)", `${route} requires CSRF guard`);
}

const resolveStart = indexSource.indexOf('request.url !== "/resolve"');
const resolveBlock = indexSource.slice(resolveStart);
requireIncludes(resolveBlock, "requireCsrfForBrowserMutation(request, response)", "/resolve requires CSRF guard");

for (const phrase of [
  "x-ogen-csrf-token",
  "CSRF_HEADER_NAME",
  "csrfHeaders"
]) {
  requireIncludes(frontendCsrfSource, phrase, "frontend CSRF helper exists");
}
requireIncludes(frontendSessionSource, "rememberCsrfToken(body?.csrfToken)", "frontend session bootstrap stores CSRF token");
requireIncludes(frontendMainSource, "createBrowserSession(API_URL)", "frontend session bootstrap uses CSRF-aware session helper");
for (const phrase of ["...csrfHeaders()", "headers: csrfHeaders()"]) {
  requireIncludes(frontendMainSource, phrase, "frontend mutating requests send CSRF header");
}
for (const phrase of [
  "...csrfHeaders()",
  "headers: csrfHeaders()"
]) {
  requireIncludes(frontendAuthSource, phrase, "frontend identity mutations send CSRF header");
}

requireIncludes(sharedHttpSource, "x-ogen-csrf-token", "startJsonServer CORS allows CSRF header");
requireIncludes(fastifySource, '"x-ogen-csrf-token"', "Fastify CORS allows CSRF header");

const parsedPackageJson = JSON.parse(packageJsonSource) as { scripts?: Record<string, string> };
if (parsedPackageJson.scripts?.["verify:browser-session-csrf-guard"] !== "tsx scripts/verify-browser-session-csrf-guard.ts") {
  fail("package.json should include verify:browser-session-csrf-guard");
} else {
  ok("package.json includes verify:browser-session-csrf-guard");
}
if (!parsedPackageJson.scripts?.["verify:v2-plan"]?.includes("verify:runtime-authorization-api && npm run verify:browser-session-csrf-guard")) {
  fail("verify:v2-plan should run browser session CSRF guard after runtime authorization API");
} else {
  ok("verify:v2-plan includes browser session CSRF guard after runtime authorization API");
}

for (const phrase of [
  "Phase 2.16  Browser Session CSRF Guard",
  "Browser-session POST routes require",
  "POST /session",
  "Internal API-key/service-token calls can bypass",
  "Authorization bearer alone does not bypass",
  "GET/public routes do not require CSRF",
  "CSRF tokens are signed and session-bound",
  "CSRF tokens expire"
]) {
  requireIncludes(platformDocs, phrase, "platform docs cover browser session CSRF guard");
}
for (const phrase of [
  "CSRF cookie",
  "Secure cookie in production",
  "x-ogen-csrf-token",
  "CSRF_SIGNING_SECRET",
  "CSRF_TOKEN_TTL_SECONDS",
  "SESSION_COOKIE_SAMESITE=None",
  "session cookie becomes Secure automatically",
  "backend must be served over HTTPS",
  "signed/session-bound"
]) {
  requireIncludes(deploymentDocs, phrase, "deployment docs cover CSRF behavior");
}
requireIncludes(productIdentityDocs, "Ogen browser sessions require CSRF proof for mutating actions.", "product identity docs cover CSRF proof");
requireIncludes(productIdentityDocs, "Ogen CSRF tokens are bound to the browser session", "product identity docs cover session-bound CSRF");

const token = createCsrfToken();
if (!/^[A-Za-z0-9_-]+$/.test(token) || token.length < 32) {
  fail("CSRF token should be random and URL-safe");
} else {
  ok("CSRF token is URL-safe");
}

if (verifyCsrfRequest(fakeRequest({}))) {
  fail("CSRF verification should fail without cookie/header");
} else {
  ok("CSRF verification fails without cookie/header");
}

if (verifyCsrfRequest(fakeRequest({
  cookie: `${CSRF_COOKIE_NAME}=one`,
  [CSRF_HEADER_NAME]: "two"
}))) {
  fail("CSRF verification should fail on mismatch");
} else {
  ok("CSRF verification fails on mismatch");
}

if (!verifyCsrfRequest(fakeRequest({
  cookie: `${CSRF_COOKIE_NAME}=same-token`,
  [CSRF_HEADER_NAME]: "same-token"
}))) {
  fail("CSRF verification should pass on matching cookie/header");
} else {
  ok("CSRF verification passes on match");
}

const originalApiKey = process.env.ORCHESTRATOR_API_KEY;
const originalInternalToken = process.env.INTERNAL_SERVICE_TOKEN;
const originalNodeEnv = process.env.NODE_ENV;
const originalCsrfSecret = process.env.CSRF_SIGNING_SECRET;
const originalCsrfTtl = process.env.CSRF_TOKEN_TTL_SECONDS;
const originalCsrfCookieSameSite = process.env.CSRF_COOKIE_SAMESITE;
const originalSessionCookieSameSite = process.env.SESSION_COOKIE_SAMESITE;
const originalCsrfCookieSecure = process.env.CSRF_COOKIE_SECURE;
const originalSessionCookieSecure = process.env.SESSION_COOKIE_SECURE;
const originalDateNow = Date.now;
process.env.CSRF_SIGNING_SECRET = "expected-csrf-signing-secret";
process.env.ORCHESTRATOR_API_KEY = "expected-api-key";
process.env.INTERNAL_SERVICE_TOKEN = "expected-internal-token";

const sessionA = "session-a";
const sessionB = "session-b";
const signedToken = createCsrfTokenForSession(sessionA);
if (!signedToken.startsWith("v1.") || signedToken.split(".").length !== 5) {
  fail("signed CSRF token should use v1 nonce sessionHash exp signature format");
} else {
  ok("signed CSRF token uses v1 format");
}
if (!verifyCsrfRequestForSession(fakeRequest({
  cookie: `${CSRF_COOKIE_NAME}=${signedToken}`,
  [CSRF_HEADER_NAME]: signedToken
}), sessionA)) {
  fail("session-bound CSRF token should verify for its session");
} else {
  ok("session-bound CSRF token verifies for its session");
}
if (verifyCsrfRequestForSession(fakeRequest({
  cookie: `${CSRF_COOKIE_NAME}=${signedToken}`,
  [CSRF_HEADER_NAME]: signedToken
}), sessionB)) {
  fail("session-bound CSRF token must not verify for another session");
} else {
  ok("session-bound CSRF token cannot be reused for another session");
}
const tamperedToken = `${signedToken.slice(0, -1)}${signedToken.endsWith("A") ? "B" : "A"}`;
if (verifyCsrfRequestForSession(fakeRequest({
  cookie: `${CSRF_COOKIE_NAME}=${tamperedToken}`,
  [CSRF_HEADER_NAME]: tamperedToken
}), sessionA)) {
  fail("tampered signed CSRF token should fail");
} else {
  ok("tampered signed CSRF token fails");
}
process.env.CSRF_TOKEN_TTL_SECONDS = "1";
Date.now = () => 1_000_000;
const expiringToken = createCsrfTokenForSession(sessionA);
Date.now = () => 3_000_000;
if (verifyCsrfRequestForSession(fakeRequest({
  cookie: `${CSRF_COOKIE_NAME}=${expiringToken}`,
  [CSRF_HEADER_NAME]: expiringToken
}), sessionA)) {
  fail("expired signed CSRF token should fail");
} else {
  ok("expired signed CSRF token fails");
}
Date.now = originalDateNow;

if (shouldBypassCsrfForTrustedInternalRequest(fakeRequest({ "x-api-key": "wrong" }))) {
  fail("wrong API key must not bypass CSRF");
} else {
  ok("wrong API key does not bypass CSRF");
}
if (!shouldBypassCsrfForTrustedInternalRequest(fakeRequest({ "x-api-key": "expected-api-key" }))) {
  fail("configured API key should bypass CSRF");
} else {
  ok("configured API key bypasses CSRF");
}
if (!shouldBypassCsrfForTrustedInternalRequest(fakeRequest({ "x-internal-service-token": "expected-internal-token" }))) {
  fail("configured internal service token should bypass CSRF");
} else {
  ok("configured internal service token bypasses CSRF");
}
if (shouldBypassCsrfForTrustedInternalRequest(fakeRequest({ authorization: "Bearer token" }))) {
  fail("Authorization bearer must not bypass CSRF");
} else {
  ok("Authorization bearer does not bypass CSRF");
}

process.env.NODE_ENV = "production";
delete process.env.CSRF_SIGNING_SECRET;
delete process.env.ORCHESTRATOR_API_KEY;
delete process.env.INTERNAL_SERVICE_TOKEN;
delete process.env.CSRF_COOKIE_SAMESITE;
delete process.env.SESSION_COOKIE_SAMESITE;
delete process.env.CSRF_COOKIE_SECURE;
delete process.env.SESSION_COOKIE_SECURE;
try {
  createCsrfTokenForSession("production-session");
  fail("production CSRF token creation should fail without CSRF_SIGNING_SECRET");
} catch {
  ok("production CSRF token creation fails without CSRF_SIGNING_SECRET");
}
const productionCookie = csrfCookieHeader("cookie-token");
if (!productionCookie.includes("Secure") || productionCookie.includes("HttpOnly") || !productionCookie.includes("SameSite=Lax")) {
  fail("default production CSRF cookie should be Secure, SameSite=Lax, and readable by frontend");
} else {
  ok("default production CSRF cookie is secure and frontend-readable");
}
process.env.SESSION_COOKIE_SAMESITE = "None";
const crossSiteCookie = csrfCookieHeader("cookie-token");
if (!crossSiteCookie.includes("Secure") || crossSiteCookie.includes("HttpOnly") || !crossSiteCookie.includes("SameSite=None")) {
  fail("cross-site CSRF cookie should follow session SameSite=None, be Secure, and remain frontend-readable");
} else {
  ok("cross-site CSRF cookie follows session SameSite=None and remains frontend-readable");
}
process.env.CSRF_COOKIE_SAMESITE = "Strict";
const explicitCsrfCookie = csrfCookieHeader("cookie-token");
if (!explicitCsrfCookie.includes("SameSite=Strict")) {
  fail("explicit CSRF_COOKIE_SAMESITE should override session SameSite");
} else {
  ok("explicit CSRF_COOKIE_SAMESITE overrides session SameSite");
}
process.env.NODE_ENV = "development";
delete process.env.CSRF_COOKIE_SAMESITE;
delete process.env.CSRF_COOKIE_SECURE;
delete process.env.SESSION_COOKIE_SECURE;
process.env.SESSION_COOKIE_SAMESITE = "None";
const crossSiteSessionCookie = createSessionCookieForToken("test-session");
if (!crossSiteSessionCookie.includes("HttpOnly") || !crossSiteSessionCookie.includes("SameSite=None") || !crossSiteSessionCookie.includes("Secure")) {
  fail("cross-site session cookie should be HttpOnly, SameSite=None, and Secure");
} else {
  ok("cross-site session cookie is HttpOnly, SameSite=None, and Secure");
}
delete process.env.SESSION_COOKIE_SAMESITE;
const localSessionCookie = createSessionCookieForToken("test-session");
if (!localSessionCookie.includes("HttpOnly") || !localSessionCookie.includes("SameSite=Lax") || localSessionCookie.includes("Secure")) {
  fail("default local session cookie should be HttpOnly, SameSite=Lax, and not force Secure");
} else {
  ok("default local session cookie remains local-dev compatible");
}

if (originalApiKey === undefined) {
  delete process.env.ORCHESTRATOR_API_KEY;
} else {
  process.env.ORCHESTRATOR_API_KEY = originalApiKey;
}
if (originalInternalToken === undefined) {
  delete process.env.INTERNAL_SERVICE_TOKEN;
} else {
  process.env.INTERNAL_SERVICE_TOKEN = originalInternalToken;
}
if (originalCsrfSecret === undefined) {
  delete process.env.CSRF_SIGNING_SECRET;
} else {
  process.env.CSRF_SIGNING_SECRET = originalCsrfSecret;
}
if (originalCsrfTtl === undefined) {
  delete process.env.CSRF_TOKEN_TTL_SECONDS;
} else {
  process.env.CSRF_TOKEN_TTL_SECONDS = originalCsrfTtl;
}
if (originalCsrfCookieSameSite === undefined) {
  delete process.env.CSRF_COOKIE_SAMESITE;
} else {
  process.env.CSRF_COOKIE_SAMESITE = originalCsrfCookieSameSite;
}
if (originalSessionCookieSameSite === undefined) {
  delete process.env.SESSION_COOKIE_SAMESITE;
} else {
  process.env.SESSION_COOKIE_SAMESITE = originalSessionCookieSameSite;
}
if (originalCsrfCookieSecure === undefined) {
  delete process.env.CSRF_COOKIE_SECURE;
} else {
  process.env.CSRF_COOKIE_SECURE = originalCsrfCookieSecure;
}
if (originalSessionCookieSecure === undefined) {
  delete process.env.SESSION_COOKIE_SECURE;
} else {
  process.env.SESSION_COOKIE_SECURE = originalSessionCookieSecure;
}
if (originalNodeEnv === undefined) {
  delete process.env.NODE_ENV;
} else {
  process.env.NODE_ENV = originalNodeEnv;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Browser session CSRF guard verification passed.");
}
