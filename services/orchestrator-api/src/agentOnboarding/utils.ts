export const httpTimeoutMs = 2_000;
export const maxDiscoveryJsonBytes = 32_000;
export const maxConnectorProfileJsonBytes = 64_000;
export const maxOnboardingJsonBytes = 64_000;

export function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function externalStatus(value: unknown): "active" | "disabled" | "unknown" {
  return value === "active" || value === "disabled" ? value : "unknown";
}

function errorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorAddress(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const address = (value as { address?: unknown }).address;
  const port = (value as { port?: unknown }).port;
  if (typeof address !== "string") {
    return undefined;
  }

  return typeof port === "number" || typeof port === "string" ? `${address}:${port}` : address;
}

export function describeFetchFailure(url: string, error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return `${url} timed out after ${httpTimeoutMs}ms`;
  }

  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeCode = errorCode(cause);
    const causeAddress = errorAddress(cause);
    if (causeCode) {
      return `${url} failed with ${causeCode}${causeAddress ? ` at ${causeAddress}` : ""}`;
    }

    return `${url} failed: ${error.message}`;
  }

  return `${url} failed: unknown error`;
}

export async function fetchJsonWithLimit<T>(url: string, init: RequestInit, maxBytes: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), httpTimeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error("Redirects are not allowed during agent onboarding.");
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > maxBytes) {
      throw new Error("Response exceeded JSON size limit.");
    }
    const text = await response.text();
    if (text.length > maxBytes) {
      throw new Error("Response exceeded JSON size limit.");
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timeout);
  }
}
