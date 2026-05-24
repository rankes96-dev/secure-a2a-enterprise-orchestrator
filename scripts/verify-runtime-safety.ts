import { validateConnectorRuntimeEndpoint, validateTrustedConnectorRuntimeEndpoint } from "../services/orchestrator-api/src/security/connectorRuntimeSafety";
import { parseOnboardingRequest, validateOnboardingRequest } from "../services/orchestrator-api/src/agentOnboarding/requestValidation";
import { normalizeRuntimeResponse, sanitizeConnectorRuntimeValue } from "../services/orchestrator-api/src/connectorRuntime";

function assertAllowed(endpoint: string): void {
  const result = validateConnectorRuntimeEndpoint(endpoint);
  if (!result.ok) {
    throw new Error(`expected runtime endpoint to be allowed: ${endpoint} (${result.error})`);
  }
}

function assertBlocked(endpoint: string): void {
  const result = validateConnectorRuntimeEndpoint(endpoint);
  if (result.ok) {
    throw new Error(`expected runtime endpoint to be blocked: ${endpoint}`);
  }
}

assertAllowed("http://localhost:4201/a2a/task");
assertAllowed("http://localhost:4202/a2a/task");
assertAllowed("http://localhost:4203/a2a/task");

assertBlocked("http://localhost:4201/admin");
assertBlocked("http://localhost:4201/a2a/task?x=1");
assertBlocked("http://evil.com/a2a/task");
assertBlocked("file:///tmp/a2a/task");
assertBlocked("http://user:pass@localhost:4201/a2a/task");

const trusted = validateTrustedConnectorRuntimeEndpoint({
  endpoint: "http://localhost:4201/a2a/task",
  expectedEndpoint: "http://localhost:4201/a2a/task"
});
if (!trusted.ok) {
  throw new Error(`expected trusted endpoint to pass exact validation: ${trusted.error}`);
}

const mismatch = validateTrustedConnectorRuntimeEndpoint({
  endpoint: "http://localhost:4201/a2a/task",
  expectedEndpoint: "http://localhost:4202/a2a/task"
});
if (mismatch.ok) {
  throw new Error("expected trusted endpoint mismatch to fail");
}

const missingTrusted = validateTrustedConnectorRuntimeEndpoint({
  endpoint: "http://localhost:4201/a2a/task"
});
if (!missingTrusted.ok) {
  throw new Error(`expected validation without exact trusted endpoint to remain valid: ${missingTrusted.error}`);
}

function withOnboardingEnv(env: Record<string, string | undefined>, action: () => void): void {
  const keys = ["NODE_ENV", "EXTERNAL_AGENT_ONBOARDING_ALLOWED_ORIGINS", "CONNECTOR_RUNTIME_ALLOWED_ORIGINS"] as const;
  const previous = new Map<string, string | undefined>();
  for (const key of keys) {
    previous.set(key, process.env[key]);
    const next = env[key];
    if (next === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = next;
    }
  }
  try {
    action();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function onboardingDetails(agentBaseUrl: string): string[] {
  return validateOnboardingRequest(parseOnboardingRequest({
    agentBaseUrl,
    expectedAgentId: "external-jira-agent"
  }));
}

function assertOnboardingAllowed(agentBaseUrl: string): void {
  const details = onboardingDetails(agentBaseUrl);
  if (details.length > 0) {
    throw new Error(`expected onboarding URL to be allowed: ${agentBaseUrl} (${details.join(" ")})`);
  }
}

function assertOnboardingBlocked(agentBaseUrl: string, expectedDetail: string): void {
  const details = onboardingDetails(agentBaseUrl);
  if (details.length === 0) {
    throw new Error(`expected onboarding URL to be blocked: ${agentBaseUrl}`);
  }
  if (!details.join(" ").includes(expectedDetail)) {
    throw new Error(`expected onboarding URL block for ${agentBaseUrl} to include "${expectedDetail}", got: ${details.join(" ")}`);
  }
}

withOnboardingEnv({
  NODE_ENV: "development",
  EXTERNAL_AGENT_ONBOARDING_ALLOWED_ORIGINS: undefined,
  CONNECTOR_RUNTIME_ALLOWED_ORIGINS: undefined
}, () => {
  assertOnboardingAllowed("http://localhost:4201");
  assertOnboardingAllowed("http://localhost:4202");
  assertOnboardingAllowed("http://localhost:4203");
});

withOnboardingEnv({
  NODE_ENV: "production",
  EXTERNAL_AGENT_ONBOARDING_ALLOWED_ORIGINS: "https://jira-agent.railway.app",
  CONNECTOR_RUNTIME_ALLOWED_ORIGINS: undefined
}, () => {
  assertOnboardingAllowed("https://jira-agent.railway.app");
  assertOnboardingBlocked("https://servicenow-agent.railway.app", "Agent Registry onboarding discovery allows only these origins");
  assertOnboardingBlocked("https://user:pass@jira-agent.railway.app", "URL credentials are not allowed");
  assertOnboardingBlocked("https://10.0.0.5", "Private IP agent URLs are blocked");
});

const maliciousJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2aWN0aW0ifQ.signature";
const normalizedRuntimeResponse = normalizeRuntimeResponse({
  agentId: "malicious-agent",
  status: "diagnosed",
  summary: `Leaked ${maliciousJwt}`,
  probableCause: "Authorization: Bearer secret",
  recommendedActions: ["rotate access_token immediately"],
  endUserAnswer: {
    title: "Token",
    summary: `Bearer ${maliciousJwt}`,
    nextStep: "client_secret=abc",
    safeToDisplay: true
  },
  evidence: [
    {
      title: "Runtime proof",
      data: {
        token: maliciousJwt,
        nested: {
          a2aToken: maliciousJwt,
          safeResult: "kept"
        }
      }
    }
  ],
  trace: [
    {
      agent: "malicious-agent",
      action: "Authorization",
      detail: `Bearer ${maliciousJwt}`,
      timestamp: "2026-05-24T00:00:00.000Z"
    }
  ]
});
const serializedRuntimeResponse = JSON.stringify(normalizedRuntimeResponse);
if (serializedRuntimeResponse.includes(maliciousJwt) || serializedRuntimeResponse.includes("Bearer secret") || serializedRuntimeResponse.includes("client_secret=abc")) {
  throw new Error(`normalized runtime response leaked token-like content: ${serializedRuntimeResponse}`);
}
if (!serializedRuntimeResponse.includes("hidden")) {
  throw new Error("normalized runtime response should replace token-like content with hidden");
}
const sanitizedRuntimeValue = sanitizeConnectorRuntimeValue({
  refreshToken: maliciousJwt,
  message: "safe metadata",
  rawToken: "hidden"
}) as { refreshToken?: unknown; message?: unknown; rawToken?: unknown };
if (sanitizedRuntimeValue.refreshToken !== "hidden" || sanitizedRuntimeValue.rawToken !== "hidden" || sanitizedRuntimeValue.message !== "safe metadata") {
  throw new Error(`sanitizeConnectorRuntimeValue should hide token-like keys while preserving safe values: ${JSON.stringify(sanitizedRuntimeValue)}`);
}

console.log("Runtime and onboarding URL safety verification passed.");
