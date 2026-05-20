import type { IdentityProviderAdapter, IdentityProviderName } from "./identityProvider.js";
import { createAuth0IdentityProvider, type Auth0IdentityProviderConfig } from "./auth0IdentityProvider.js";
import { createMockIdentityProvider, type MockIdentityProviderConfig } from "./mockIdentityProvider.js";

const mockUserIdentityAudience = "secure-a2a-gateway";

function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function requireNonEmpty(value: string | undefined, name: string): string {
  const cleaned = cleanEnv(value);
  if (!cleaned) {
    throw new Error(`AUTH_PROVIDER=auth0 requires ${name}.`);
  }
  return cleaned;
}

function normalizeHttpsUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL.`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`${name} must be a valid HTTPS URL.`);
  }

  if (url.username || url.password) {
    throw new Error(`${name} must not include URL credentials.`);
  }

  return url.toString();
}

function auth0ClaimName(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  if (Object.prototype.hasOwnProperty.call(env, name) && !cleanEnv(env[name])) {
    throw new Error(`${name} must be non-empty when provided.`);
  }
  return cleanEnv(env[name]) ?? fallback;
}

function mockIdpUrl(env: NodeJS.ProcessEnv = process.env): string {
  return cleanEnv(env.A2A_IDP_URL) ?? "http://localhost:4110";
}

export function identityProviderName(env: NodeJS.ProcessEnv = process.env): IdentityProviderName {
  const configured = cleanEnv(env.AUTH_PROVIDER) ?? "mock";
  if (configured === "mock" || configured === "auth0") {
    return configured;
  }
  throw new Error(`Unsupported AUTH_PROVIDER ${configured}. Expected mock or auth0.`);
}

export function mockIdentityProviderConfig(env: NodeJS.ProcessEnv = process.env): MockIdentityProviderConfig {
  const issuer = cleanEnv(env.A2A_ISSUER) ?? mockIdpUrl(env);
  return {
    issuer,
    audience: mockUserIdentityAudience,
    jwksUri: cleanEnv(env.A2A_JWKS_URI) ?? `${mockIdpUrl(env)}/.well-known/jwks.json`
  };
}

export function auth0IdentityProviderConfig(env: NodeJS.ProcessEnv = process.env): Auth0IdentityProviderConfig {
  const issuer = cleanEnv(env.AUTH0_ISSUER);
  const audience = cleanEnv(env.AUTH0_AUDIENCE);
  const jwksUri = cleanEnv(env.AUTH0_JWKS_URI);
  const missing = [
    issuer ? "" : "AUTH0_ISSUER",
    audience ? "" : "AUTH0_AUDIENCE",
    jwksUri ? "" : "AUTH0_JWKS_URI"
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`AUTH_PROVIDER=auth0 requires ${missing.join(", ")}.`);
  }

  return {
    issuer: normalizeHttpsUrl(issuer!, "AUTH0_ISSUER"),
    audience: requireNonEmpty(audience, "AUTH0_AUDIENCE"),
    jwksUri: normalizeHttpsUrl(jwksUri!, "AUTH0_JWKS_URI"),
    emailClaim: auth0ClaimName(env, "AUTH0_EMAIL_CLAIM", "email"),
    rolesClaim: auth0ClaimName(env, "AUTH0_ROLES_CLAIM", "https://secure-a2a.dev/roles")
  };
}

export function createIdentityProvider(env: NodeJS.ProcessEnv = process.env): IdentityProviderAdapter {
  const provider = identityProviderName(env);
  if (provider === "mock") {
    return createMockIdentityProvider(mockIdentityProviderConfig(env));
  }
  if (provider === "auth0") {
    return createAuth0IdentityProvider(auth0IdentityProviderConfig(env));
  }
  throw new Error("Unsupported identity provider.");
}

let cachedIdentityProvider: IdentityProviderAdapter | undefined;

export function getIdentityProvider(): IdentityProviderAdapter {
  cachedIdentityProvider ??= createIdentityProvider();
  return cachedIdentityProvider;
}
