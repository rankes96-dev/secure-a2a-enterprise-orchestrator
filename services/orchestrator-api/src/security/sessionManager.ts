import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

interface SessionRecord {
  expiresAt: number;
}

const sessions = new Map<string, SessionRecord>();
const sessionCookieName = "a2a_session";

function sessionTtlMs(): number {
  return Number(process.env.SESSION_TTL_MS ?? 60 * 60 * 1000);
}

function cookieSecure(): boolean {
  return process.env.SESSION_COOKIE_SECURE === "true";
}

function sameSite(): string {
  return process.env.SESSION_COOKIE_SAMESITE ?? "Lax";
}

function cleanupExpiredSessions(): void {
  const now = Date.now();

  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

function sessionTokenFromRequest(request: IncomingMessage): string | undefined {
  const cookieHeader = request.headers.cookie;

  if (!cookieHeader) {
    return undefined;
  }

  const cookies = new Map(
    cookieHeader.split(";").map((cookie) => {
      const [name, ...valueParts] = cookie.trim().split("=");
      return [name, valueParts.join("=")];
    })
  );

  return cookies.get(sessionCookieName);
}

export function createSessionCookie(): string {
  cleanupExpiredSessions();
  const token = randomUUID();
  const maxAgeSeconds = Math.floor(sessionTtlMs() / 1000);
  sessions.set(token, { expiresAt: Date.now() + sessionTtlMs() });

  return [
    `${sessionCookieName}=${token}`,
    "HttpOnly",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    `SameSite=${sameSite()}`,
    cookieSecure() ? "Secure" : ""
  ]
    .filter(Boolean)
    .join("; ");
}

export function getSessionToken(request: IncomingMessage): string | undefined {
  cleanupExpiredSessions();
  const token = sessionTokenFromRequest(request);

  if (!token) {
    return undefined;
  }

  const session = sessions.get(token);

  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return undefined;
  }

  return token;
}

export function hasValidSession(request: IncomingMessage): boolean {
  return Boolean(getSessionToken(request));
}
