import type { Auth0FrontendAuthConfig, FrontendAuthConfig, FrontendAuthProviderName } from "./authTypes";

const auth0SafeConfigError = "Auth0 login is not configured for this deployment.";

function cleanEnv(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function authProviderName(value: unknown): FrontendAuthProviderName | "invalid" {
  const configured = cleanEnv(value) ?? "mock";
  if (configured === "mock" || configured === "auth0") {
    return configured;
  }
  return "invalid";
}

function normalizeAuth0Domain(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const candidate = value.startsWith("https://") ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return undefined;
    }
    return url.hostname;
  } catch {
    return undefined;
  }
}

function auth0Config(env: ImportMetaEnv): Auth0FrontendAuthConfig {
  const domain = normalizeAuth0Domain(cleanEnv(env.VITE_AUTH0_DOMAIN));
  const clientId = cleanEnv(env.VITE_AUTH0_CLIENT_ID);
  const audience = cleanEnv(env.VITE_AUTH0_AUDIENCE);

  if (!domain || !clientId || !audience) {
    return {
      provider: "auth0",
      isConfigured: false,
      safeError: auth0SafeConfigError
    };
  }

  return {
    provider: "auth0",
    isConfigured: true,
    domain,
    clientId,
    audience
  };
}

export function readFrontendAuthConfig(env: ImportMetaEnv = import.meta.env): FrontendAuthConfig {
  const provider = authProviderName(env.VITE_AUTH_PROVIDER);
  if (provider === "mock") {
    return { provider: "mock", isConfigured: true };
  }
  if (provider === "auth0") {
    return auth0Config(env);
  }
  return {
    provider: "auth0",
    isConfigured: false,
    safeError: auth0SafeConfigError
  };
}

export function frontendAuthProviderLabel(config: FrontendAuthConfig): string {
  return config.provider === "auth0" ? "Auth0" : "Mock IdP";
}
