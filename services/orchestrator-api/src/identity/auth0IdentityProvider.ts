import { createRemoteJWKSet, jwtVerify } from "jose";
import type { IdentityProviderAdapter } from "./identityProvider.js";
import { mapOidcUserIdentityPayload, publicIdentitySummary } from "./userIdentityMapper.js";

export type Auth0IdentityProviderConfig = {
  issuer: string;
  audience: string;
  jwksUri: string;
  emailClaim: string;
  rolesClaim: string;
};

export function createAuth0IdentityProvider(config: Auth0IdentityProviderConfig): IdentityProviderAdapter {
  return {
    name: "auth0",
    issuer: config.issuer,
    audience: config.audience,
    jwksUri: config.jwksUri,
    async validateBearerToken(token) {
      const { payload } = await jwtVerify(token, createRemoteJWKSet(new URL(config.jwksUri)), {
        issuer: config.issuer,
        audience: config.audience
      });

      return mapOidcUserIdentityPayload({
        provider: "auth0",
        payload,
        issuer: config.issuer,
        audience: config.audience,
        emailClaim: config.emailClaim,
        rolesClaim: config.rolesClaim
      });
    },
    publicIdentity: publicIdentitySummary
  };
}
