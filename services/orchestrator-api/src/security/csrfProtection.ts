import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

export const CSRF_COOKIE_NAME = "ogen_csrf";
export const CSRF_HEADER_NAME = "x-ogen-csrf-token";

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

export function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function csrfCookieHeader(token: string): string {
  return [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Lax",
    process.env.NODE_ENV === "production" ? "Secure" : ""
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

export function shouldBypassCsrfForTrustedInternalRequest(request: IncomingMessage): boolean {
  const apiKey = headerString(request.headers["x-api-key"]);
  const internalServiceToken = headerString(request.headers["x-internal-service-token"]);

  return configuredSecretMatches(apiKey, process.env.ORCHESTRATOR_API_KEY) ||
    configuredSecretMatches(internalServiceToken, process.env.INTERNAL_SERVICE_TOKEN);
}
