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
