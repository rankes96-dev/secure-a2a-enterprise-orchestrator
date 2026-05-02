import dotenv from "dotenv";
import type { AgentsHealthResponse, ResolveResponse } from "@a2a/shared";

dotenv.config({ path: new URL("../services/orchestrator-api/.env", import.meta.url), quiet: true });

type DemoAgentCard = {
  agentId: string;
  name: string;
  endpoint: string;
  auth: {
    audience: string;
  };
  skills: Array<{
    requiredScopes?: string[];
    capabilities?: string[];
  }>;
};

const orchestratorUrl = process.env.ORCHESTRATOR_API_URL ?? "http://localhost:4000";

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoRawSecrets(value: unknown): void {
  const serialized = JSON.stringify(value);
  const forbiddenPatterns = [
    /"access_token"\s*:/i,
    /"client_assertion"\s*:/i,
    /"client_secret"\s*:/i,
    /"authorization"\s*:/i,
    /"private[_-]?key"\s*:/i,
    /Bearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/
  ];

  const matched = forbiddenPatterns.find((pattern) => pattern.test(serialized));
  assertCondition(!matched, `response exposed sensitive token material matching ${matched}`);
}

function cookieFromSetCookie(headers: Headers): string {
  const setCookie = headers.get("set-cookie");
  assertCondition(Boolean(setCookie), "session response did not include Set-Cookie");
  return setCookie!.split(";")[0];
}

async function requestJson<T>(path: string, options: RequestInit & { cookie?: string } = {}): Promise<{ status: number; body: T; headers: Headers; rawBody: string }> {
  const headers = new Headers(options.headers);
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }

  const response = await fetch(`${orchestratorUrl}${path}`, {
    ...options,
    headers
  });
  const rawBody = await response.text();
  const body = (rawBody ? JSON.parse(rawBody) : {}) as T;

  return {
    status: response.status,
    body,
    headers: response.headers,
    rawBody
  };
}

async function createSession(): Promise<string> {
  const response = await requestJson<{ ok: boolean }>("/session", { method: "POST" });
  assertCondition(response.status === 200 && response.body.ok === true, `session request failed with ${response.status}`);
  console.log("session created: ok");
  return cookieFromSetCookie(response.headers);
}

async function addDemoAgent(cookie: string): Promise<DemoAgentCard> {
  const response = await requestJson<{ agentCard: DemoAgentCard; agentCards: DemoAgentCard[]; warnings: string[] }>("/demo-agent-cards", {
    method: "POST",
    cookie,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system: "Salesforce",
      diagnosisGoal: "Diagnose Salesforce login and access issues",
      agentName: "Demo Salesforce Access Agent",
      riskLevel: "low",
      resourceTypes: ["user", "account", "permission"],
      supportingHelpOptions: ["oauth_scope_compare", "api_health"]
    })
  });

  assertCondition(response.status === 200, `demo agent add failed with ${response.status}: ${response.rawBody}`);
  const card = response.body.agentCard;
  assertCondition(card.agentId.startsWith("demo-"), "generated agentId should start with demo-");
  assertCondition(card.auth.audience === card.agentId, "generated audience should equal agentId");
  assertCondition(card.skills[0]?.requiredScopes?.includes("salesforce.diagnose") === true, "generated scope should include salesforce.diagnose");
  assertCondition(
    card.skills[0]?.capabilities?.some((capability) => capability.startsWith("salesforce.") && capability.endsWith(".diagnose")) === true,
    "generated capability should be a Salesforce diagnostic capability"
  );

  console.log("demo agent added: ok");
  return card;
}

async function verifyListed(cookie: string, agentId: string): Promise<void> {
  const response = await requestJson<{ agentCards: DemoAgentCard[] }>("/demo-agent-cards", {
    method: "GET",
    cookie
  });
  assertCondition(response.status === 200, `list demo cards failed with ${response.status}: ${response.rawBody}`);
  assertCondition(response.body.agentCards.some((card) => card.agentId === agentId), "created demo agent was not listed");
}

async function verifyHealth(cookie: string, card: DemoAgentCard): Promise<void> {
  const response = await requestJson<AgentsHealthResponse>("/agents/health", {
    method: "GET",
    cookie
  });
  assertCondition(response.status === 200, `agent health failed with ${response.status}: ${response.rawBody}`);
  const agent = response.body.agents.find((item) => item.agentId === card.agentId);
  assertCondition(Boolean(agent), "created demo agent missing from health");
  assertCondition(agent!.status === "ok", "created demo agent health should be ok");
  assertCondition(agent!.endpointType === "session" || agent!.url?.startsWith("session://demo-agent/"), "created demo agent health endpoint should be session");
  assertCondition(!agent!.url || agent!.url.startsWith("session://demo-agent/"), "created demo agent health URL should be hidden or session://");
  console.log("demo agent health: ok");
}

async function verifyResolve(cookie: string, card: DemoAgentCard): Promise<void> {
  const response = await requestJson<ResolveResponse>("/resolve", {
    method: "POST",
    cookie,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "I cannot login to my Salesforce account"
    })
  });

  assertCondition(response.status === 200, `resolve failed with ${response.status}: ${response.rawBody}`);
  assertNoRawSecrets(response.body);

  assertCondition(response.body.selectedAgents.some((agent) => agent.agentId === card.agentId), "created demo agent was not selected");
  const task = response.body.a2aTasks?.find((item) => item.toAgent === card.agentId);
  assertCondition(Boolean(task), "created demo agent task missing");
  assertCondition(task!.context.targetAudience === card.auth.audience, "task targetAudience should match demo audience");
  assertCondition(task!.context.requestedScope === "salesforce.diagnose", "task requestedScope should be salesforce.diagnose");
  assertCondition(task!.context.auth?.authMode === "oauth2_client_credentials_jwt", "task auth mode should be oauth2_client_credentials_jwt");
  assertCondition(task!.context.auth?.tokenIssued === true, "task should have tokenIssued=true");
  assertCondition(task!.context.auth?.tokenAuthMethod === "private_key_jwt", "task tokenAuthMethod should be private_key_jwt");
  assertCondition(
    task!.context.auth?.validationReason?.includes("generated Agent Card metadata") === true &&
      task!.context.auth.validationReason.includes("mock runtime"),
    "task validationReason should mention generated Agent Card metadata and mock runtime"
  );

  const demoResponse = response.body.a2aResponses?.find((item) => item.agentId === card.agentId);
  assertCondition(Boolean(demoResponse), "created demo agent response missing");
  assertCondition(demoResponse!.status === "diagnosed", "happy path demo agent response should be diagnosed");
  assertCondition(!response.body.finalAnswer.includes("scoped JWT issuance failed"), "happy path final answer should not be JWT blocked");

  console.log("demo agent routing: ok");
  console.log("demo agent jwt issuance: ok");
  console.log("raw token redaction: ok");
}

async function main(): Promise<void> {
  const cookie = await createSession();
  const card = await addDemoAgent(cookie);
  await verifyListed(cookie, card.agentId);
  await verifyHealth(cookie, card);
  await verifyResolve(cookie, card);
  console.log("fail-closed case: skipped");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "session demo agent verification failed");
  process.exitCode = 1;
});
