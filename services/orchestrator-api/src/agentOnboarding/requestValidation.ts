import { randomUUID } from "node:crypto";
import { isAllowedLocalReferenceConnectorBaseUrl, localReferenceConnectorBaseUrls } from "../connectors/localReferenceConnectors.js";
import type { AgentOnboardingChallenge, AgentOnboardingRequest } from "./types.js";
import { cleanString } from "./utils.js";

const onboardingAllowedOriginsEnv = "EXTERNAL_AGENT_ONBOARDING_ALLOWED_ORIGINS";
const runtimeAllowedOriginsEnv = "CONNECTOR_RUNTIME_ALLOWED_ORIGINS";

function normalizeAgentBaseUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function isLocalDevelopment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production";
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase();
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

function isLocalhost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === "localhost" || normalized === "::1" || /^127\./.test(normalized);
}

function isPrivateIp(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map((part) => Number(part));
    if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [first, second] = octets;
    return (
      first === 0 ||
      first === 10 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  return (
    normalized === "::" ||
    (normalized.startsWith("fc") && normalized.includes(":")) ||
    (normalized.startsWith("fd") && normalized.includes(":")) ||
    normalized.startsWith("fe80:")
  );
}

function parseHttpsPublicOriginList(value: string | undefined): string[] {
  if (!value) return [];
  const origins: string[] = [];

  for (const item of value.split(",").map((origin) => origin.trim()).filter(Boolean)) {
    try {
      const parsed = new URL(item);
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash ||
        isLocalhost(parsed.hostname) ||
        isPrivateIp(parsed.hostname)
      ) {
        continue;
      }
      origins.push(parsed.origin);
    } catch {
      continue;
    }
  }

  return origins;
}

export function allowedExternalAgentOnboardingOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const configured = env[onboardingAllowedOriginsEnv] ?? env[runtimeAllowedOriginsEnv];
  const origins = new Set(parseHttpsPublicOriginList(configured));
  if (isLocalDevelopment(env)) {
    for (const url of localReferenceConnectorBaseUrls) {
      origins.add(url);
    }
  }
  return origins;
}

function describeAllowedOnboardingOrigins(origins: Set<string>): string {
  return origins.size > 0 ? [...origins].join(", ") : "none configured";
}

export function validateSafeExternalUrl(
  value: string,
  expectedOrigin: string,
  options: { allowLocalhost?: boolean } = {}
): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      return "URL credentials are not allowed.";
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Only HTTP localhost or HTTPS URLs are allowed.";
    }
    const allowLocalhost = options.allowLocalhost ?? true;
    if (isLocalhost(parsed.hostname) && !allowLocalhost) {
      return "Localhost agent URLs are allowed only for local development agents.";
    }
    if (isPrivateIp(parsed.hostname) && !isLocalhost(parsed.hostname)) {
      return "Private IP agent URLs are blocked except localhost development agents.";
    }
    if (parsed.protocol === "http:" && !isLocalhost(parsed.hostname)) {
      return "HTTP is allowed only for localhost development agents.";
    }
    if (parsed.origin !== expectedOrigin) {
      return "URL origin must match the allowlisted external agent base URL.";
    }
    return undefined;
  } catch {
    return "Malformed URL.";
  }
}

export function createChallenge(input: AgentOnboardingRequest): AgentOnboardingChallenge {
  return {
    onboardingId: randomUUID(),
    nonce: randomUUID(),
    agentBaseUrl: input.agentBaseUrl,
    expectedAudience: "secure-a2a-gateway",
    expectedAgentId: input.expectedAgentId,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
  };
}

export function parseOnboardingRequest(value: unknown): AgentOnboardingRequest {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  const rawAgentBaseUrl = cleanString(input.agentBaseUrl);
  return {
    agentBaseUrl: normalizeAgentBaseUrl(rawAgentBaseUrl) ?? rawAgentBaseUrl,
    expectedAgentId: cleanString(input.expectedAgentId),
    expectedResourceSystem: cleanString(input.expectedResourceSystem) || undefined,
    expectedConnectorId: cleanString(input.expectedConnectorId) || undefined
  };
}

export function validateOnboardingRequest(request: AgentOnboardingRequest): string[] {
  const details: string[] = [];
  if (!request.agentBaseUrl) details.push("agentBaseUrl is required.");
  if (!request.expectedAgentId) details.push("expectedAgentId is required.");
  if (request.agentBaseUrl) {
    const allowedOrigins = allowedExternalAgentOnboardingOrigins();
    const localReferenceAllowed = isLocalDevelopment() && isAllowedLocalReferenceConnectorBaseUrl(request.agentBaseUrl);
    const unsafe = validateSafeExternalUrl(request.agentBaseUrl, request.agentBaseUrl, { allowLocalhost: isLocalDevelopment() });
    if (unsafe) {
      details.push(unsafe);
    }
    if (!unsafe) {
      const origin = new URL(request.agentBaseUrl).origin;
      const httpsAllowlisted = new URL(request.agentBaseUrl).protocol === "https:" && allowedOrigins.has(origin);
      if (!localReferenceAllowed && !httpsAllowlisted) {
        details.push(
          `unsupported agentBaseUrl ${request.agentBaseUrl}. Agent Registry onboarding discovery allows only these origins: ${describeAllowedOnboardingOrigins(allowedOrigins)}. Configure ${onboardingAllowedOriginsEnv} for onboarding discovery fetches; if it is unset, ${runtimeAllowedOriginsEnv} is used as a fallback.`
        );
      }
    }
  }

  return details;
}
