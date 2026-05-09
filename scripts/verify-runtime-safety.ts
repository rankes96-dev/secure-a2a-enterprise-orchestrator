import { validateConnectorRuntimeEndpoint, validateTrustedConnectorRuntimeEndpoint } from "../services/orchestrator-api/src/security/connectorRuntimeSafety";

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

console.log("Runtime safety verification passed.");
