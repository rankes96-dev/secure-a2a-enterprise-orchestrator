export type ReplayCheckResult =
  | { ok: true }
  | { ok: false; reason: "replay_detected" };

type ReplayEntry = {
  expiresAtEpochSeconds: number;
};

export class InMemoryClientAssertionReplayStore {
  private readonly entries = new Map<string, ReplayEntry>();

  checkAndStore(params: {
    clientId: string;
    jti: string;
    expiresAtEpochSeconds: number;
  }): ReplayCheckResult {
    const now = Math.floor(Date.now() / 1000);
    this.removeExpired(now);

    const key = this.keyFor(params.clientId, params.jti);
    const existing = this.entries.get(key);
    if (existing && existing.expiresAtEpochSeconds > now) {
      return { ok: false, reason: "replay_detected" };
    }

    if (params.expiresAtEpochSeconds > now) {
      this.entries.set(key, {
        expiresAtEpochSeconds: params.expiresAtEpochSeconds
      });
    }

    this.removeExpired(now);
    return { ok: true };
  }

  private keyFor(clientId: string, jti: string): string {
    return `client_assertion_jti:${clientId}:${jti}`;
  }

  private removeExpired(nowEpochSeconds: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtEpochSeconds <= nowEpochSeconds) {
        this.entries.delete(key);
      }
    }
  }
}

export const clientAssertionReplayStore = new InMemoryClientAssertionReplayStore();
