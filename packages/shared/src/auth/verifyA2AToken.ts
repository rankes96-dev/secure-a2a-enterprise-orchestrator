import { createRemoteJWKSet, jwtVerify } from "jose";
import type { A2AAuthValidationResult, A2ATokenClaims } from "../index";

export type VerifyA2ATokenInput = {
  authorizationHeader?: string | string[];
  expectedIssuer: string;
  expectedAudience: string;
  requiredScope?: string;
  jwksUri: string;
};

export function scopesFromClaims(claims: A2ATokenClaims): string[] {
  const scopes = new Set<string>();

  for (const scope of claims.scope?.split(/\s+/) ?? []) {
    const trimmed = scope.trim();
    if (trimmed) {
      scopes.add(trimmed);
    }
  }

  for (const scope of claims.scp ?? []) {
    const trimmed = scope.trim();
    if (trimmed) {
      scopes.add(trimmed);
    }
  }

  return [...scopes];
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length === value.length ? strings : undefined;
}

function claimsFromPayload(payload: Record<string, unknown>): A2ATokenClaims | undefined {
  const audience = payload.aud;
  const claims = {
    iss: payload.iss,
    sub: payload.sub,
    aud: typeof audience === "string" ? audience : undefined,
    scope: payload.scope,
    scp: toStringArray(payload.scp),
    exp: payload.exp,
    iat: payload.iat,
    jti: payload.jti,
    client_id: payload.client_id,
    actor: payload.actor,
    delegated_by: payload.delegated_by,
    delegation_depth: payload.delegation_depth
  };

  if (
    typeof claims.iss !== "string" ||
    typeof claims.sub !== "string" ||
    typeof claims.aud !== "string" ||
    typeof claims.exp !== "number" ||
    typeof claims.iat !== "number" ||
    typeof claims.jti !== "string" ||
    typeof claims.client_id !== "string"
  ) {
    return undefined;
  }

  return {
    iss: claims.iss,
    sub: claims.sub,
    aud: claims.aud,
    scope: typeof claims.scope === "string" ? claims.scope : undefined,
    scp: claims.scp,
    exp: claims.exp,
    iat: claims.iat,
    jti: claims.jti,
    client_id: claims.client_id,
    actor: typeof claims.actor === "string" ? claims.actor : undefined,
    delegated_by: typeof claims.delegated_by === "string" ? claims.delegated_by : undefined,
    delegation_depth: typeof claims.delegation_depth === "number" ? claims.delegation_depth : undefined
  };
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "JWT validation failed";
}

export async function verifyA2AToken(input: VerifyA2ATokenInput): Promise<A2AAuthValidationResult> {
  const authorization = firstHeaderValue(input.authorizationHeader)?.trim();

  if (!authorization) {
    return { valid: false, reason: "Missing Authorization header" };
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { valid: false, reason: "Authorization header must use Bearer scheme" };
  }

  try {
    const jwks = createRemoteJWKSet(new URL(input.jwksUri));
    const { payload } = await jwtVerify(match[1], jwks, {
      issuer: input.expectedIssuer,
      audience: input.expectedAudience
    });
    const claims = claimsFromPayload(payload);

    if (!claims) {
      return { valid: false, reason: "Invalid A2A JWT: required claims are missing or malformed" };
    }

    if (input.requiredScope && !scopesFromClaims(claims).includes(input.requiredScope)) {
      return { valid: false, reason: `Missing required scope ${input.requiredScope}`, claims };
    }

    return { valid: true, reason: "A2A JWT validated", claims };
  } catch (error) {
    return { valid: false, reason: `Invalid A2A JWT: ${safeErrorMessage(error)}` };
  }
}
