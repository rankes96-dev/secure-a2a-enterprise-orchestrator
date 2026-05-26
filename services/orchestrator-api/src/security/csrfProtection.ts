import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

export const CSRF_COOKIE_NAME = "ogen_csrf";
export const CSRF_HEADER_NAME = "x-ogen-csrf-token";
const CSRF_TOKEN_VERSION = "v1";
const defaultCsrfTokenTtlSeconds = 2 * 60 * 60;

function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function configuredSecretMatches(value: string | undefined, expected: string | undefined): boolean {
  return Boolean(value && expected && safeEquals(value, expected));
}

function csrfTokenTtlSeconds(): number {
  const configured = Number(process.env.CSRF_TOKEN_TTL_SECONDS ?? defaultCsrfTokenTtlSeconds);
  return Number.isFinite(configured) && configured > 0 ? configured : defaultCsrfTokenTtlSeconds;
}

function csrfSigningSecret(): string | undefined {
  const explicit = process.env.CSRF_SIGNING_SECRET?.trim();
  if (explicit) {
    return explicit;
  }

  if (process.env.NODE_ENV === "production") {
    return undefined;
  }

  return process.env.INTERNAL_SERVICE_TOKEN?.trim() || process.env.ORCHESTRATOR_API_KEY?.trim() || undefined;
}

function requireCsrfSigningSecret(): string {
  const secret = csrfSigningSecret();
  if (secret) {
    return secret;
  }

  throw new Error(process.env.NODE_ENV === "production"
    ? "CSRF_SIGNING_SECRET is required in production"
    : "CSRF_SIGNING_SECRET, INTERNAL_SERVICE_TOKEN, or ORCHESTRATOR_API_KEY is required to sign CSRF tokens");
}

function csrfCookieSameSite(): "Lax" | "Strict" | "None" {
  const configured = (process.env.CSRF_COOKIE_SAMESITE ?? process.env.SESSION_COOKIE_SAMESITE ?? "Lax").trim().toLowerCase();
  if (configured === "none") {
    return "None";
  }
  if (configured === "strict") {
    return "Strict";
  }
  return "Lax";
}

function csrfCookieSecure(sameSite: "Lax" | "Strict" | "None"): boolean {
  return sameSite === "None" ||
    process.env.CSRF_COOKIE_SECURE === "true" ||
    process.env.SESSION_COOKIE_SECURE === "true" ||
    process.env.NODE_ENV === "production";
}

function sessionHash(sessionToken: string): string {
  return createHash("sha256").update(sessionToken).digest("hex");
}

function signCsrfPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createCsrfTokenForSession(sessionToken: string): string {
  const nonce = createCsrfToken();
  const exp = String(Math.floor(Date.now() / 1000) + csrfTokenTtlSeconds());
  const payload = `${CSRF_TOKEN_VERSION}.${nonce}.${sessionHash(sessionToken)}.${exp}`;
  return `${payload}.${signCsrfPayload(payload, requireCsrfSigningSecret())}`;
}

export function csrfCookieHeader(token: string): string {
  const sameSite = csrfCookieSameSite();
  return [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `SameSite=${sameSite}`,
    csrfCookieSecure(sameSite) ? "Secure" : ""
  ]
    .filter(Boolean)
    .join("; ");
}

export function readCsrfCookie(cookieHeader: string | string[] | undefined): string | undefined {
  const header = Array.isArray(cookieHeader) ? cookieHeader.join(";") : cookieHeader;
  if (!header) {
    return undefined;
  }

  for (const cookie of header.split(";")) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name !== CSRF_COOKIE_NAME) {
      continue;
    }

    const value = valueParts.join("=");
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return undefined;
}

export function csrfHeaderValue(headers: IncomingHttpHeaders): string | undefined {
  return headerString(headers[CSRF_HEADER_NAME]);
}

export function verifyCsrfRequest(request: IncomingMessage): boolean {
  const cookieToken = readCsrfCookie(request.headers.cookie);
  const headerToken = csrfHeaderValue(request.headers);

  return Boolean(cookieToken && headerToken && safeEquals(cookieToken, headerToken));
}

export function verifyCsrfRequestForSession(request: IncomingMessage, sessionToken: string): boolean {
  if (!verifyCsrfRequest(request)) {
    return false;
  }

  const token = csrfHeaderValue(request.headers);
  const parts = token?.split(".") ?? [];
  if (parts.length !== 5) {
    return false;
  }

  const [version, nonce, tokenSessionHash, exp, signature] = parts;
  if (version !== CSRF_TOKEN_VERSION || !nonce || !tokenSessionHash || !exp || !signature) {
    return false;
  }

  const expiresAt = Number(exp);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  if (!safeEquals(tokenSessionHash, sessionHash(sessionToken))) {
    return false;
  }

  const secret = csrfSigningSecret();
  if (!secret) {
    return false;
  }

  const payload = `${version}.${nonce}.${tokenSessionHash}.${exp}`;
  return safeEquals(signature, signCsrfPayload(payload, secret));
}

export function shouldBypassCsrfForTrustedInternalRequest(request: IncomingMessage): boolean {
  const apiKey = headerString(request.headers["x-api-key"]);
  const internalServiceToken = headerString(request.headers["x-internal-service-token"]);

  return configuredSecretMatches(apiKey, process.env.ORCHESTRATOR_API_KEY) ||
    configuredSecretMatches(internalServiceToken, process.env.INTERNAL_SERVICE_TOKEN);
}
