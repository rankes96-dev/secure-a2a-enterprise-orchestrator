import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export type InternalDebugAccessDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 404; body: { error: string } };

export function isMockIdpDebugPath(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    return new URL(url, "http://localhost").pathname === "/debug/oauth-applications";
  } catch {
    return (url.split(/[?#]/, 1)[0] ?? "") === "/debug/oauth-applications";
  }
}

function headerValue(headers: IncomingHttpHeaders, name: "x-internal-service-token"): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) {
    return value[0]?.trim();
  }

  return value?.trim();
}

function tokenMatches(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

export function evaluateInternalDebugAccess(
  url: string | undefined,
  headers: IncomingHttpHeaders,
  env: NodeJS.ProcessEnv = process.env
): InternalDebugAccessDecision {
  if (!isMockIdpDebugPath(url)) {
    return { ok: true };
  }

  if (env.NODE_ENV !== "production") {
    return { ok: true };
  }

  const expectedToken = env.INTERNAL_SERVICE_TOKEN?.trim();
  if (!expectedToken) {
    return { ok: false, status: 404, body: { error: "not_found" } };
  }

  const providedToken = headerValue(headers, "x-internal-service-token");
  if (!providedToken) {
    return { ok: false, status: 401, body: { error: "missing_internal_service_token" } };
  }

  if (!tokenMatches(providedToken, expectedToken)) {
    return { ok: false, status: 403, body: { error: "invalid_internal_service_token" } };
  }

  return { ok: true };
}
