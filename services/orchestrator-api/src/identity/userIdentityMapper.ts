import type { JWTPayload } from "jose";
import type { UserIdentitySummary } from "@a2a/shared";
import type { IdentityProviderAdapter, IdentityProviderName, VerifiedGatewayUserIdentity } from "./identityProvider.js";

export type IdentitySessionResponse = {
  authenticated: boolean;
  user: {
    email: string;
    name?: string;
    roles: string[];
  } | null;
  issuer: string;
  audience: string;
};

export function publicIdentitySummary(identity?: VerifiedGatewayUserIdentity): UserIdentitySummary {
  return identity
    ? {
        authenticated: true,
        provider: identity.provider,
        email: identity.email,
        name: identity.name,
        roles: [...identity.roles]
      }
    : { authenticated: false };
}

export function publicIdentitySession(provider: IdentityProviderAdapter, identity?: VerifiedGatewayUserIdentity): IdentitySessionResponse {
  return {
    authenticated: Boolean(identity),
    user: identity
      ? {
          email: identity.email,
          name: identity.name,
          roles: [...identity.roles]
        }
      : null,
    issuer: provider.issuer,
    audience: provider.audience
  };
}

function claimString(payload: JWTPayload, claim: string): string | undefined {
  const value = payload[claim];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function claimStringArray(payload: JWTPayload, claim: string): string[] | undefined {
  const value = payload[claim];
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length === value.length ? strings : undefined;
}

export function mapMockUserIdentityPayload(params: {
  payload: JWTPayload;
  issuer: string;
  audience: string;
}): VerifiedGatewayUserIdentity {
  const { payload, issuer, audience } = params;
  if (payload.token_use !== "user_identity") {
    throw new Error("User JWT token_use must be user_identity");
  }

  const email = claimString(payload, "email");
  if (!email) {
    throw new Error("User JWT email claim is required");
  }

  const roles = claimStringArray(payload, "roles");
  if (!roles) {
    throw new Error("User JWT roles claim must be a string array");
  }

  const subject = claimString(payload, "sub");
  if (!subject || !subject.startsWith("user:")) {
    throw new Error("User JWT subject must identify a user");
  }

  return {
    provider: "mock",
    email: email.toLowerCase(),
    name: claimString(payload, "name"),
    roles,
    issuer,
    audience,
    subject
  };
}

export function mapOidcUserIdentityPayload(params: {
  provider: IdentityProviderName;
  payload: JWTPayload;
  issuer: string;
  audience: string;
  emailClaim: string;
  rolesClaim: string;
}): VerifiedGatewayUserIdentity {
  const { provider, payload, issuer, audience, emailClaim, rolesClaim } = params;
  const email = claimString(payload, emailClaim);
  if (!email) {
    throw new Error(`User JWT ${emailClaim} claim is required`);
  }

  const subject = claimString(payload, "sub");
  if (!subject) {
    throw new Error("User JWT sub claim is required");
  }

  const rawRoles = payload[rolesClaim];
  const roles = rawRoles === undefined ? [] : claimStringArray(payload, rolesClaim);
  if (!roles) {
    throw new Error(`User JWT ${rolesClaim} claim must be a string array when present`);
  }

  return {
    provider,
    email: email.toLowerCase(),
    name: claimString(payload, "name"),
    roles,
    issuer,
    audience,
    subject
  };
}
