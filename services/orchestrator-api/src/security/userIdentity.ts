import type { IncomingHttpHeaders } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";

const userIdentityAudience = "secure-a2a-gateway";

export type VerifiedUserIdentity = {
  email: string;
  name?: string;
  roles: string[];
  issuer: string;
  audience: typeof userIdentityAudience;
  subject: string;
};

export type IdentitySessionResponse = {
  authenticated: boolean;
  user: {
    email: string;
    name?: string;
    roles: string[];
  } | null;
  issuer: string;
  audience: typeof userIdentityAudience;
};

function idpUrl(): string {
  return process.env.A2A_IDP_URL ?? "http://localhost:4110";
}

export function expectedUserIdentityIssuer(): string {
  return process.env.A2A_ISSUER ?? idpUrl();
}

export function userIdentityAudienceValue(): typeof userIdentityAudience {
  return userIdentityAudience;
}

export function userIdentityJwksUri(): string {
  return process.env.A2A_JWKS_URI ?? `${idpUrl()}/.well-known/jwks.json`;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function bearerTokenFromHeaders(headers: IncomingHttpHeaders): string | undefined {
  const authorization = firstHeaderValue(headers.authorization)?.trim();
  if (!authorization) {
    return undefined;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length === value.length ? strings : undefined;
}

export function publicUserIdentity(identity?: VerifiedUserIdentity): IdentitySessionResponse {
  return {
    authenticated: Boolean(identity),
    user: identity
      ? {
          email: identity.email,
          name: identity.name,
          roles: [...identity.roles]
        }
      : null,
    issuer: expectedUserIdentityIssuer(),
    audience: userIdentityAudience
  };
}

export async function validateUserIdentityJwt(token: string): Promise<VerifiedUserIdentity> {
  const { payload } = await jwtVerify(token, createRemoteJWKSet(new URL(userIdentityJwksUri())), {
    issuer: expectedUserIdentityIssuer(),
    audience: userIdentityAudience
  });

  if (payload.token_use !== "user_identity") {
    throw new Error("User JWT token_use must be user_identity");
  }

  if (typeof payload.email !== "string" || !payload.email.trim()) {
    throw new Error("User JWT email claim is required");
  }

  const roles = toStringArray(payload.roles);
  if (!roles) {
    throw new Error("User JWT roles claim must be a string array");
  }

  if (typeof payload.sub !== "string" || !payload.sub.startsWith("user:")) {
    throw new Error("User JWT subject must identify a user");
  }

  return {
    email: payload.email.trim().toLowerCase(),
    name: typeof payload.name === "string" ? payload.name : undefined,
    roles,
    issuer: expectedUserIdentityIssuer(),
    audience: userIdentityAudience,
    subject: payload.sub
  };
}
