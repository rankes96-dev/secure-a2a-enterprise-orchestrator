import type { Auth0FrontendAuthConfig } from "./authTypes";

const verifierKey = "secure-a2a.auth0.codeVerifier";
const stateKey = "secure-a2a.auth0.state";
const nonceKey = "secure-a2a.auth0.nonce";

type Auth0TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

function randomBase64Url(bytes = 32): string {
  const array = new Uint8Array(bytes);
  window.crypto.getRandomValues(array);
  return base64Url(array);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function redirectUri(): string {
  return window.location.origin + window.location.pathname;
}

function cleanAuth0CallbackUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function auth0AuthorizeUrl(config: Required<Pick<Auth0FrontendAuthConfig, "domain" | "clientId" | "audience">>, state: string, nonce: string, codeChallenge: string): string {
  const url = new URL(`https://${config.domain}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("audience", config.audience);
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function hasAuth0RedirectResult(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has("code") || params.has("error");
}

export function discardAuth0RedirectResult(): void {
  if (hasAuth0RedirectResult()) {
    cleanAuth0CallbackUrl();
  }
}

export async function startAuth0LoginRedirect(config: Auth0FrontendAuthConfig): Promise<void> {
  if (!config.isConfigured || !config.domain || !config.clientId || !config.audience) {
    throw new Error("Auth0 login is not configured for this deployment.");
  }

  const state = randomBase64Url();
  const nonce = randomBase64Url();
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = await sha256Base64Url(codeVerifier);

  window.sessionStorage.setItem(verifierKey, codeVerifier);
  window.sessionStorage.setItem(stateKey, state);
  window.sessionStorage.setItem(nonceKey, nonce);
  window.location.assign(auth0AuthorizeUrl(config as Required<Pick<Auth0FrontendAuthConfig, "domain" | "clientId" | "audience">>, state, nonce, codeChallenge));
}

export async function completeAuth0Redirect(config: Auth0FrontendAuthConfig): Promise<{ handled: boolean; accessToken?: string }> {
  if (!hasAuth0RedirectResult()) {
    return { handled: false };
  }
  if (!config.isConfigured || !config.domain || !config.clientId || !config.audience) {
    discardAuth0RedirectResult();
    throw new Error("Auth0 login is not configured for this deployment.");
  }

  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  if (error) {
    discardAuth0RedirectResult();
    throw new Error("Auth0 login failed.");
  }

  const code = params.get("code");
  const state = params.get("state");
  const expectedState = window.sessionStorage.getItem(stateKey);
  const codeVerifier = window.sessionStorage.getItem(verifierKey);

  window.sessionStorage.removeItem(verifierKey);
  window.sessionStorage.removeItem(stateKey);
  window.sessionStorage.removeItem(nonceKey);

  if (!code || !state || !expectedState || state !== expectedState || !codeVerifier) {
    discardAuth0RedirectResult();
    throw new Error("Auth0 login failed.");
  }

  const response = await fetch(`https://${config.domain}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: config.clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri()
    })
  });

  discardAuth0RedirectResult();

  if (!response.ok) {
    throw new Error("Auth0 login failed.");
  }

  const body = (await response.json()) as Auth0TokenResponse;
  if (!body.access_token || body.token_type?.toLowerCase() !== "bearer") {
    throw new Error("Auth0 login failed.");
  }

  return { handled: true, accessToken: body.access_token };
}
