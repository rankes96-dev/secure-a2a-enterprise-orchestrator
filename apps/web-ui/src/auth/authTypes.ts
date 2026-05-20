export type FrontendAuthProviderName = "mock" | "auth0";

export type MockFrontendAuthConfig = {
  provider: "mock";
  isConfigured: true;
};

export type Auth0FrontendAuthConfig = {
  provider: "auth0";
  isConfigured: boolean;
  domain?: string;
  clientId?: string;
  audience?: string;
  safeError?: string;
};

export type FrontendAuthConfig = MockFrontendAuthConfig | Auth0FrontendAuthConfig;

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
