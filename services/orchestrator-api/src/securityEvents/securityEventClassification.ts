import type { SecurityEventOutcome, SecurityEventSeverity } from "./securityEventTypes.js";

export function severityForEventType(eventType: string): SecurityEventSeverity {
  if (eventType === "user.identity.verified") {
    return "info";
  }
  if (eventType === "connector.onboarding.trusted") {
    return "medium";
  }
  if (eventType === "connector.runtime.token.issued") {
    return "info";
  }
  if (eventType === "connector.runtime.succeeded") {
    return "info";
  }
  if (eventType === "connector.runtime.failed") {
    return "medium";
  }
  if (eventType === "connector.runtime.authorization_required") {
    return "low";
  }
  if (eventType === "security.request.blocked") {
    return "high";
  }
  if (eventType === "gateway.authorization.denied") {
    return "high";
  }
  if (eventType === "gateway.authorization.evaluated") {
    return "info";
  }
  if (eventType === "tenant.access.denied") {
    return "high";
  }
  if (eventType.includes("blocked")) {
    return "high";
  }
  if (eventType.includes("failed")) {
    return "medium";
  }
  return "info";
}

export function outcomeForEventType(eventType: string): SecurityEventOutcome {
  if (eventType === "connector.runtime.failed") {
    return "failure";
  }
  if (eventType === "connector.runtime.authorization_required") {
    return "needs_action";
  }
  if (eventType === "security.request.blocked") {
    return "blocked";
  }
  if (eventType === "gateway.authorization.denied") {
    return "blocked";
  }
  if (eventType === "gateway.authorization.evaluated") {
    return "success";
  }
  if (eventType === "tenant.access.denied") {
    return "blocked";
  }
  if (eventType.includes("blocked")) {
    return "blocked";
  }
  if (eventType.includes("failed")) {
    return "failure";
  }
  return "success";
}
