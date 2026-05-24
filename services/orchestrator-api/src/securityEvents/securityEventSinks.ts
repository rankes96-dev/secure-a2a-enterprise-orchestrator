import type { SecurityEventEnvelope, SecurityEventSink } from "./securityEventTypes.js";

export class NoopSecurityEventSink implements SecurityEventSink {
  async publish(_event: SecurityEventEnvelope): Promise<void> {
    return;
  }
}

export class ConsoleSecurityEventSink implements SecurityEventSink {
  async publish(event: SecurityEventEnvelope): Promise<void> {
    console.info("[security-event]", {
      eventType: event.eventType,
      severity: event.severity,
      outcome: event.outcome,
      resourceType: event.resourceType,
      resourceId: event.resourceId
    });
  }
}

export class CompositeSecurityEventSink implements SecurityEventSink {
  constructor(private readonly sinks: SecurityEventSink[]) {}

  async publish(event: SecurityEventEnvelope): Promise<void> {
    for (const sink of this.sinks) {
      try {
        await sink.publish(event);
      } catch {
        console.warn("[security-event] sink publish failed");
      }
    }
  }
}
