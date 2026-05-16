import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

type AdminAccessDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403 | 404; body: { error: string } };

export function isAdminPath(url: string | undefined): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url, "http://localhost");
    return parsed.pathname === "/admin" || parsed.pathname.startsWith("/admin/");
  } catch {
    const path = url.split(/[?#]/, 1)[0] ?? "";
    return path === "/admin" || path.startsWith("/admin/");
  }
}

function headerValue(headers: IncomingHttpHeaders, name: "x-admin-token" | "x-internal-service-token"): string | undefined {
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

export function evaluateAdminAccess(
  url: string | undefined,
  headers: IncomingHttpHeaders,
  env: NodeJS.ProcessEnv = process.env
): AdminAccessDecision {
  if (!isAdminPath(url)) {
    return { ok: true };
  }

  if (env.NODE_ENV !== "production") {
    return { ok: true };
  }

  if (env.EXTERNAL_AGENT_ADMIN_ENABLED !== "true") {
    return { ok: false, status: 404, body: { error: "not_found" } };
  }

  const expectedToken = env.EXTERNAL_AGENT_ADMIN_TOKEN?.trim();
  if (!expectedToken) {
    return { ok: false, status: 403, body: { error: "admin_token_required" } };
  }

  const providedToken = headerValue(headers, "x-admin-token") ?? headerValue(headers, "x-internal-service-token");
  if (!providedToken) {
    return { ok: false, status: 401, body: { error: "missing_admin_token" } };
  }

  if (!tokenMatches(providedToken, expectedToken)) {
    return { ok: false, status: 403, body: { error: "invalid_admin_token" } };
  }

  return { ok: true };
}
