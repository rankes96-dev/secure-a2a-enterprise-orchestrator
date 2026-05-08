import { createRemoteJWKSet, jwtVerify } from "jose";
import { agentId, agentIssuer, capability, clientId, requiredScope, tokenEndpointAuthMethod } from "./config.js";

const baseUrl = agentIssuer();

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

async function verifyOnboarding(jwksUri: string): Promise<void> {
  const onboardingId = `verify-${Date.now()}`;
  const nonce = crypto.randomUUID();
  const challenge = {
    onboardingId,
    nonce,
    expectedAudience: "secure-a2a-gateway",
    expectedAgentId: agentId,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString()
  };

  const { response, body } = await postJson<{ signedTrustResponse?: string; agentId?: string }>("/onboarding/challenge", challenge);
  assertCondition(response.ok, `onboarding challenge failed with ${response.status}`);
  assertCondition(body.agentId === agentId, "onboarding response agentId mismatch");
  assertCondition(typeof body.signedTrustResponse === "string", "missing signed trust response");

  const { payload } = await jwtVerify(body.signedTrustResponse, createRemoteJWKSet(new URL(jwksUri)), {
    issuer: baseUrl,
    audience: "secure-a2a-gateway",
    subject: agentId
  });

  assertCondition(payload.typ === "agent_onboarding_response", "trust response typ mismatch");
  assertCondition(payload.onboardingId === onboardingId, "trust response onboardingId mismatch");
  assertCondition(payload.nonce === nonce, "trust response nonce mismatch");
  assertCondition(payload.agentId === agentId, "trust response agentId mismatch");
  assertCondition(payload.issuer === baseUrl, "trust response issuer mismatch");
  assertCondition(payload.clientId === clientId, "trust response clientId mismatch");
  assertCondition(payload.audience === agentId, "trust response audience mismatch");
  assertCondition(Array.isArray(payload.verifiedCapabilities) && payload.verifiedCapabilities.includes(capability), "missing verified capability");
  assertCondition(Array.isArray(payload.verifiedScopes) && payload.verifiedScopes.includes(requiredScope), "missing verified scope");
  assertCondition(payload.tokenEndpointAuthMethod === tokenEndpointAuthMethod, "trust response token auth method mismatch");
  ok("signed onboarding trust response");

  const rejected = await postJson<{ error?: string }>("/onboarding/challenge", {
    ...challenge,
    expectedAgentId: "wrong-agent"
  });
  assertCondition(rejected.response.status === 400, "wrong expectedAgentId should be rejected");
  ok("invalid onboarding challenge rejected");
}

async function verifyRuntimeIfTokenProvided(): Promise<void> {
  const token = process.env.RUNTIME_BEARER_TOKEN;
  if (!token) {
    console.log("skip - runtime JWT validation requires RUNTIME_BEARER_TOKEN");
    return;
  }

  const { response, body } = await postJson<{ status?: string }>("/a2a/task", {
    message: "Diagnose Salesforce access"
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
