import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const defaultMaxBodyBytes = 64 * 1024;

export interface JsonServerOptions {
  host?: string;
  allowedOrigins?: string[];
}

function readAllowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsHeaders(request?: IncomingMessage): Record<string, string> {
  const allowedOrigins = readAllowedOrigins();
  const requestOrigin = request?.headers.origin;
  const allowOrigin =
    requestOrigin && allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : allowedOrigins[0] ?? "http://localhost:5173";

  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-api-key,x-internal-service-token,authorization",
    "access-control-allow-credentials": "true",
    "vary": "origin"
  };
}

export async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  const maxBodyBytes = Number(process.env.MAX_BODY_BYTES ?? defaultMaxBodyBytes);

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;

    if (byteLength > maxBodyBytes) {
      throw new Error(`Request body exceeds ${maxBodyBytes} bytes`);
    }

    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
  request?: IncomingMessage,
  headers: Record<string, string | string[]> = {}
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    ...corsHeaders(request),
    ...headers
  });
  response.end(JSON.stringify(value));
}

export function requireClientApiKey(request: IncomingMessage, response: ServerResponse): boolean {
  const expected = process.env.ORCHESTRATOR_API_KEY;

  if (!expected) {
    sendJson(response, 503, { error: "ORCHESTRATOR_API_KEY is not configured" }, request);
    return false;
  }

  if (request.headers["x-api-key"] !== expected) {
    sendJson(response, 401, { error: "Unauthorized" }, request);
    return false;
  }

  return true;
}

export function requireInternalServiceToken(request: IncomingMessage, response: ServerResponse): boolean {
  const expected = process.env.INTERNAL_SERVICE_TOKEN;

  if (!expected) {
    sendJson(response, 503, { error: "INTERNAL_SERVICE_TOKEN is not configured" }, request);
    return false;
  }

  if (request.headers["x-internal-service-token"] !== expected) {
    sendJson(response, 401, { error: "Unauthorized" }, request);
    return false;
  }

  return true;
}

export function startJsonServer(
  port: number,
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void,
  options: JsonServerOptions = {}
): void {
  createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {}, request);
      return;
    }

    try {
      await handler(request, response);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Unknown server error"
      }, request);
    }
  }).listen(port, options.host ?? process.env.HOST ?? "127.0.0.1", () => {
    const host = options.host ?? process.env.HOST ?? "127.0.0.1";
    console.log(`Listening on http://${host}:${port}`);
  });
}

export async function postJson<TResponse>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<TResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`${url} returned ${response.status}${responseBody ? ` with body ${responseBody}` : ""}`);
  }

  return response.json() as Promise<TResponse>;
}
