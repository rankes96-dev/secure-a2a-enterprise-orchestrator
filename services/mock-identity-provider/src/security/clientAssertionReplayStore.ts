import { InMemoryStateStore, type StateStore } from "@a2a/shared";

export type ReplayCheckResult =
  | { ok: true }
  | { ok: false; reason: "replay_detected" };

type ReplayEntry = {
  expiresAtEpochSeconds: number;
};

export class ClientAssertionReplayStore {
  constructor(private readonly stateStore: StateStore) {}

  async checkAndStore(params: {
    clientId: string;
    jti: string;
    expiresAtEpochSeconds: number;
  }): Promise<ReplayCheckResult> {
    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = params.expiresAtEpochSeconds - now;

    if (ttlSeconds <= 0) {
      return { ok: true };
    }

    const key = this.keyFor(params.clientId, params.jti);
    const entry: ReplayEntry = {
      expiresAtEpochSeconds: params.expiresAtEpochSeconds
    };

    if (this.stateStore.setIfNotExists) {
      const stored = await this.stateStore.setIfNotExists(key, entry, ttlSeconds);
      return stored ? { ok: true } : { ok: false, reason: "replay_detected" };
    }

    const existing = await this.stateStore.get<ReplayEntry>(key);
    if (existing) {
      return { ok: false, reason: "replay_detected" };
    }

    await this.stateStore.set(key, entry, ttlSeconds);
    return { ok: true };
  }

  private keyFor(clientId: string, jti: string): string {
    return `client_assertion_jti:${clientId}:${jti}`;
  }
}

export const clientAssertionReplayStore = new ClientAssertionReplayStore(new InMemoryStateStore());
