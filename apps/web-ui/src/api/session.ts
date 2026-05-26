import { rememberCsrfToken } from "./csrf";

export async function createBrowserSession(apiUrl: string): Promise<Response> {
  const response = await fetch(`${apiUrl}/session`, { method: "POST", credentials: "include" });
  if (response.ok) {
    const body = await response.json().catch(() => undefined) as { csrfToken?: unknown } | undefined;
    rememberCsrfToken(body?.csrfToken);
  }
  return response;
}
