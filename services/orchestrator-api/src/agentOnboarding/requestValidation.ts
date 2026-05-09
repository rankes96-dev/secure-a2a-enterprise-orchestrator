import { randomUUID } from "node:crypto";
import { isAllowedLocalReferenceConnectorBaseUrl, localReferenceConnectorBaseUrls } from "../connectors/localReferenceConnectors";
import type { AgentOnboardingChallenge, AgentOnboardingRequest } from "./types";
import { cleanString } from "./utils";

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

function isLocalhost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function isPrivateIp(hostname: string): boolean {
  return (
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    /^169\.254\./.test(hostname)
  );
}

export function validateSafeExternalUrl(value: string, expectedOrigin: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      return "URL credentials are not allowed.";
    }
    if (parsed.origin !== expectedOrigin) {
      return "URL origin must match the allowlisted external agent base URL.";
    }
    if (parsed.protocol === "http:" && !isLocalhost(parsed.hostname)) {
      return "HTTP is allowed only for localhost development agents.";
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Only HTTP localhost or HTTPS URLs are allowed.";
    }
    if (isPrivateIp(parsed.hostname) && !isLocalhost(parsed.hostname)) {
      return "Private IP agent URLs are blocked except localhost development agents.";
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
  if (request.agentBaseUrl && !isAllowedLocalReferenceConnectorBaseUrl(request.agentBaseUrl)) {
    details.push(`unsupported agentBaseUrl ${request.agentBaseUrl}. This phase supports local reference connectors on ${localReferenceConnectorBaseUrls.join(", ")}.`);
  }
  if (request.agentBaseUrl) {
    const unsafe = validateSafeExternalUrl(request.agentBaseUrl, request.agentBaseUrl);
    if (unsafe) {
      details.push(unsafe);
    }
  }

  return details;
}
