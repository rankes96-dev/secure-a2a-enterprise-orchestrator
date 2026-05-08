import { agentDeclaredCapabilities, agentId, agentIssuer, requestedScopes, tokenEndpointAuthMethod } from "./config.js";

const baseUrl = agentIssuer();
const gatewayUrl = process.env.ORCHESTRATOR_API_URL ?? "http://127.0.0.1:4000";
let gatewaySessionCookie = "";

function ok(message: string): void {
  console.log(`ok - ${message}`);
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.json() as T;
  assertCondition(response.ok, `${path} returned ${response.status}`);
  return body;
}

async function postJson<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ response: Response; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
  return {
    response,
    body: await response.json() as T
  };
}

async function gatewayRequest<T>(path: string, init: RequestInit = {}): Promise<{ response: Response; body: T }> {
  const response = await fetch(`${gatewayUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(gatewaySessionCookie ? { cookie: gatewaySessionCookie } : {}),
      ...init.headers
    }
  });

  const text = await response.text();
  return {
    response,
    body: (text ? JSON.parse(text) : {}) as T
  };
}

async function verifyDiscovery(): Promise<{ jwksUri: string }> {
  const discovery = await getJson<{
    agentId: string;
    issuer: string;
    jwksUri: string;
    onboardingEndpoint: string;
    runtimeEndpoint: string;
    auth: {
      type: string;
      audience: string;
      tokenEndpointAuthMethod: string;
    };
  }>("/.well-known/a2a-agent.json");

  assertCondition(discovery.agentId === agentId, "discovery agentId mismatch");
  assertCondition(discovery.issuer === baseUrl, "discovery issuer mismatch");
  assertCondition(discovery.jwksUri === `${baseUrl}/.well-known/jwks.json`, "discovery jwksUri mismatch");
  assertCondition(discovery.onboardingEndpoint === `${baseUrl}/onboarding/challenge`, "discovery onboardingEndpoint mismatch");
  assertCondition(discovery.runtimeEndpoint === `${baseUrl}/a2a/task`, "discovery runtimeEndpoint mismatch");
  assertCondition(discovery.auth.audience === agentId, "discovery audience mismatch");
  assertCondition(discovery.auth.tokenEndpointAuthMethod === tokenEndpointAuthMethod, "discovery token auth method mismatch");
  assertCondition(!JSON.stringify(discovery).match(/privateKey|private_key\"|clientSecret|client_secret|access_token|Bearer/i), "discovery document exposed sensitive material");
  ok("discovery metadata");
  return { jwksUri: discovery.jwksUri };
}

async function verifyJwks(): Promise<void> {
  const jwks = await getJson<{ keys?: unknown[] }>("/.well-known/jwks.json");
  assertCondition(Array.isArray(jwks.keys) && jwks.keys.length > 0, "JWKS did not include public keys");
  assertCondition(!JSON.stringify(jwks).match(/"d"|privateKey|private_key|secret/i), "JWKS exposed private key material");
  ok("public JWKS");
}

async function verifyOnboarding(_jwksUri: string): Promise<void> {
  const onboardingId = `verify-${Date.now()}`;
  const nonce = crypto.randomUUID();
  const challenge = {
    onboardingId,
    nonce,
    expectedAgentId: agentId,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
  };

  const unsigned = await postJson<{ error?: string }>("/onboarding/challenge", { challenge });
  assertCondition(unsigned.response.status === 401, "missing gateway assertion should be rejected");
  ok("unsigned onboarding challenge rejected");

  const gatewayHealth = await fetch(`${gatewayUrl}/health`).catch(() => undefined);
  if (!gatewayHealth?.ok) {
    console.log("skip - full signed gateway onboarding requires Gateway running");
    return;
  }

  const session = await gatewayRequest<{ ok?: boolean }>("/session", { method: "POST" });
  assertCondition(session.response.ok, `Gateway session failed with ${session.response.status}`);
  gatewaySessionCookie = session.response.headers.get("set-cookie")?.split(";")[0] ?? "";
  assertCondition(Boolean(gatewaySessionCookie), "Gateway session cookie missing");

  const gatewayOnboarding = await gatewayRequest<{
    trustLevel?: string;
    discoveredAgent?: {
      agentDeclaredCapabilities?: string[];
      requestedScopes?: string[];
    };
    checks?: Array<{ name?: string; status?: string }>;
  }>("/agent-onboarding/start", {
    method: "POST",
    body: JSON.stringify({
      agentBaseUrl: baseUrl,
      expectedAgentId: agentId
    })
  });
  assertCondition(gatewayOnboarding.response.ok, `Gateway onboarding failed with ${gatewayOnboarding.response.status}: ${JSON.stringify(gatewayOnboarding.body)}`);
  assertCondition(gatewayOnboarding.body.trustLevel === "trusted_metadata_only", "Gateway onboarding trust level mismatch");
  assertCondition(gatewayOnboarding.body.discoveredAgent?.agentDeclaredCapabilities?.includes(agentDeclaredCapabilities[0] ?? ""), "Gateway onboarding missing agent-declared capabilities");
  assertCondition(gatewayOnboarding.body.discoveredAgent?.requestedScopes?.includes(requestedScopes[0] ?? ""), "Gateway onboarding missing requested scopes");
  assertCondition(gatewayOnboarding.body.checks?.some((check) => check.name === "external_agent_discovery" && check.status === "passed"), "Gateway onboarding did not fetch external discovery");
  assertCondition(gatewayOnboarding.body.checks?.some((check) => check.name === "external_agent_contacted" && check.status === "passed"), "Gateway onboarding did not contact external agent");
  assertCondition(gatewayOnboarding.body.checks?.some((check) => check.name === "signed_gateway_challenge_verified" && check.status === "passed"), "Gateway onboarding did not verify signed gateway challenge");
  ok("signed gateway onboarding exchange");

  const { body } = gatewayOnboarding;
  assertCondition(!JSON.stringify(body).match(/access_token|client_assertion|private_key|client_secret|Authorization|Bearer/i), "Gateway onboarding response exposed sensitive material");

}

async function verifyRuntimeIfTokenProvided(): Promise<void> {
  const token = process.env.RUNTIME_BEARER_TOKEN;
  if (!token) {
    console.log("skip - runtime JWT validation requires RUNTIME_BEARER_TOKEN");
    return;
  }

  const { response, body } = await postJson<{ status?: string }>("/a2a/task", {
    message: "Diagnose Jira access"
  }, {
    authorization: `Bearer ${token}`
  });

  assertCondition(response.ok, `runtime task failed with ${response.status}`);
  assertCondition(body.status === "diagnosed", "runtime response did not diagnose");
  ok("runtime A2A JWT validation");
}

async function main(): Promise<void> {
  console.log(`Verifying external agent at ${baseUrl}`);
  const { jwksUri } = await verifyDiscovery();
  await verifyJwks();
  await verifyOnboarding(jwksUri);
  await verifyRuntimeIfTokenProvided();
  console.log("External agent verification passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "external agent verification failed");
  process.exitCode = 1;
});
