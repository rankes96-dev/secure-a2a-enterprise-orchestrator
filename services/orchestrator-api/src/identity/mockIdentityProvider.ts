import { createRemoteJWKSet, jwtVerify } from "jose";
import type { IdentityProviderAdapter } from "./identityProvider.js";
import { mapMockUserIdentityPayload, publicIdentitySummary } from "./userIdentityMapper.js";

export type MockIdentityProviderConfig = {
  issuer: string;
  audience: string;
  jwksUri: string;
};

export function createMockIdentityProvider(config: MockIdentityProviderConfig): IdentityProviderAdapter {
  return {
    name: "mock",
    issuer: config.issuer,
    audience: config.audience,
    jwksUri: config.jwksUri,
    async validateBearerToken(token) {
      const { payload } = await jwtVerify(token, createRemoteJWKSet(new URL(config.jwksUri)), {
        issuer: config.issuer,
        audience: config.audience
      });

      return mapMockUserIdentityPayload({
        payload,
        issuer: config.issuer,
        audience: config.audience
      });
    },
    publicIdentity: publicIdentitySummary
  };
}
