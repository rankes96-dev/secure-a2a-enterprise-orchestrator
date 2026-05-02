import type { StateStore } from "./StateStore";

type StateEntry = {
  value: unknown;
  expiresAtMs?: number;
};

export class InMemoryStateStore implements StateStore {
  private readonly entries = new Map<string, StateEntry>();

  async get<T>(key: string): Promise<T | null> {
    this.removeExpired();

    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.removeExpired();
    this.entries.set(key, {
      value,
      expiresAtMs: this.expiresAtMs(ttlSeconds)
    });
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async setIfNotExists<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    this.removeExpired();

    const existing = this.entries.get(key);
    if (existing && !this.isExpired(existing)) {
      return false;
    }

    if (existing) {
      this.entries.delete(key);
    }

    this.entries.set(key, {
      value,
      expiresAtMs: this.expiresAtMs(ttlSeconds)
    });
    this.removeExpired();
    return true;
  }

  private expiresAtMs(ttlSeconds?: number): number | undefined {
    return ttlSeconds === undefined ? undefined : Date.now() + Math.max(0, ttlSeconds) * 1000;
  }

  private isExpired(entry: StateEntry): boolean {
    return entry.expiresAtMs !== undefined && entry.expiresAtMs <= Date.now();
  }

  private removeExpired(): void {
    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry)) {
        this.entries.delete(key);
      }
    }
  }
}
