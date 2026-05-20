import type { IdentitySessionResponse } from "./authTypes";

export async function postMockDemoLogin(apiUrl: string, email: string): Promise<IdentitySessionResponse> {
  const response = await fetch(`${apiUrl}/identity/demo-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email })
  });

  if (!response.ok) {
    throw response;
  }

  return (await response.json()) as IdentitySessionResponse;
}

export async function postBearerIdentitySession(apiUrl: string, accessToken: string): Promise<IdentitySessionResponse> {
  const response = await fetch(`${apiUrl}/identity/session`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    credentials: "include"
  });

  if (!response.ok) {
    throw response;
  }

  return (await response.json()) as IdentitySessionResponse;
}

export async function postIdentityLogout(apiUrl: string): Promise<IdentitySessionResponse> {
  const response = await fetch(`${apiUrl}/identity/logout`, {
    method: "POST",
    credentials: "include"
  });

  if (!response.ok) {
    throw response;
  }

  return (await response.json()) as IdentitySessionResponse;
}
