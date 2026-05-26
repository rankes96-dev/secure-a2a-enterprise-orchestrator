import type { UserIdentitySummary } from "@a2a/shared";

export type IdentityProviderName = "mock" | "auth0";

export type VerifiedGatewayUserIdentity = {
  provider: IdentityProviderName;
  email: string;
  emailVerified?: boolean;
  name?: string;
  roles: string[];
  issuer: string;
  audience: string;
  subject: string;
  org_id?: string;
  organization?: string;
  orgId?: string;
};

export type IdentityProviderAdapter = {
  name: IdentityProviderName;
  issuer: string;
  audience: string;
  jwksUri: string;
  validateBearerToken(token: string): Promise<VerifiedGatewayUserIdentity>;
  publicIdentity(identity?: VerifiedGatewayUserIdentity): UserIdentitySummary;
};
