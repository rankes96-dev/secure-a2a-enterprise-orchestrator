const defaultAllowedOrigins = "http://localhost:4201,http://localhost:4202,http://localhost:4203";

export function allowedConnectorRuntimeOrigins(): Set<string> {
  const configured = process.env.CONNECTOR_RUNTIME_ALLOWED_ORIGINS ?? defaultAllowedOrigins;
  return new Set(configured.split(",").map((item) => item.trim()).filter(Boolean));
}

export function validateConnectorRuntimeEndpoint(endpoint: string | undefined): { ok: true; url: URL } | { ok: false; error: string } {
  if (!endpoint) {
    return { ok: false, error: "external connector runtime endpoint is not available" };
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, error: "external connector runtime endpoint is invalid" };
  }

  if (url.username || url.password) {
    return { ok: false, error: "external connector runtime endpoint must not include credentials" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "external connector runtime endpoint uses an unsafe scheme" };
  }

  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol === "http:" && !isLocalhost) {
    return { ok: false, error: "external connector runtime endpoint must use https outside localhost" };
  }

  if (!allowedConnectorRuntimeOrigins().has(url.origin)) {
    return { ok: false, error: "external connector runtime endpoint is not allowlisted" };
  }

  if (url.search || url.hash) {
    return { ok: false, error: "external connector runtime endpoint must not include query or fragment" };
  }

  return { ok: true, url };
}

export function isConnectorRuntimeEndpointAllowed(endpoint: string | undefined): boolean {
  return validateConnectorRuntimeEndpoint(endpoint).ok;
}
