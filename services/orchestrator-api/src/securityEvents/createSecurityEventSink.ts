import type { SecurityEventSink } from "./securityEventTypes.js";
import { ConsoleSecurityEventSink, NoopSecurityEventSink } from "./securityEventSinks.js";

let singleton: SecurityEventSink | undefined;

export function createSecurityEventSink(configured = process.env.SECURITY_EVENT_SINK ?? "noop"): SecurityEventSink {
  const sinkName = configured.trim().toLowerCase();

  if (sinkName === "noop") {
    return new NoopSecurityEventSink();
  }
  if (sinkName === "console") {
    return new ConsoleSecurityEventSink();
  }
  if (["webhook", "opentelemetry", "splunk", "sentinel", "elastic", "datadog"].includes(sinkName)) {
    throw new Error(`SECURITY_EVENT_SINK=${sinkName} is planned but not implemented in this checkpoint.`);
  }

  throw new Error(`Unsupported SECURITY_EVENT_SINK=${configured}. Supported values for this checkpoint: noop, console.`);
}

export function getSecurityEventSink(): SecurityEventSink {
  singleton ??= createSecurityEventSink();
  return singleton;
}

export function resetSecurityEventSinkForTests(): void {
  singleton = undefined;
}
