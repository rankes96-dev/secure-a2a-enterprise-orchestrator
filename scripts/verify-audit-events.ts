import { AuditEvents } from "../services/orchestrator-api/src/audit/auditEvents";

const eventValues = Object.values(AuditEvents);
const dotNotation = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
const forbiddenRuntimeTokenTerms = [
  "raw",
  "secret",
  "authorization",
  "bearer",
  "access_token",
  "refresh_token",
  "client_assertion",
  "private_key"
];

for (const eventName of eventValues) {
  if (!dotNotation.test(eventName)) {
    throw new Error(`audit event should use dot notation: ${eventName}`);
  }
  if (/\s/.test(eventName)) {
    throw new Error(`audit event should not contain spaces: ${eventName}`);
  }
}

const runtimeTokenEvents = eventValues.filter((eventName) => eventName.startsWith("connector.runtime.token."));
for (const eventName of runtimeTokenEvents) {
  for (const term of forbiddenRuntimeTokenTerms) {
    if (eventName.toLowerCase().includes(term)) {
      throw new Error(`runtime token event name implies secret exposure: ${eventName}`);
    }
  }
}

console.log("Audit event verification passed.");
