import type { IncomingHttpHeaders } from "node:http";
import { getIdentityProvider, mockIdentityProviderConfig } from "../identity/identityConfig.js";
import { publicIdentitySession, type IdentitySessionResponse } from "../identity/userIdentityMapper.js";
import type { VerifiedGatewayUserIdentity } from "../identity/identityProvider.js";

export type VerifiedUserIdentity = VerifiedGatewayUserIdentity;
export type { IdentitySessionResponse };

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

export function expectedUserIdentityIssuer(): string {
  return getIdentityProvider().issuer;
}

export function userIdentityAudienceValue(): string {
  return getIdentityProvider().audience;
}

export function userIdentityJwksUri(): string {
  return getIdentityProvider().jwksUri;
}

export function mockIdentityIssuer(): string {
  return mockIdentityProviderConfig().issuer;
}

export function mockIdentityJwksUri(): string {
  return mockIdentityProviderConfig().jwksUri;
}

export function publicUserIdentity(identity?: VerifiedUserIdentity): IdentitySessionResponse {
  return publicIdentitySession(getIdentityProvider(), identity);
}

export async function validateUserIdentityJwt(token: string): Promise<VerifiedUserIdentity> {
  return getIdentityProvider().validateBearerToken(token);
}
