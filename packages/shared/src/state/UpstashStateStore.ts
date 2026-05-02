import type { StateStore } from "./StateStore";

export type UpstashStateStoreOptions = {
  url: string;
  token: string;
  keyPrefix?: string;
};

type UpstashResponse = {
  result?: unknown;
  error?: string;
};

export class UpstashStateStore implements StateStore {
  private readonly url: string;
  private readonly token: string;
  private readonly keyPrefix: string;

  constructor(options: UpstashStateStoreOptions) {
    this.url = options.url.replace(/\/+$/, "");
    this.token = options.token;
    this.keyPrefix = options.keyPrefix ?? "a2a";
  }

  async get<T>(key: string): Promise<T | null> {
    const response = await this.command(["GET", this.finalKey(key)]);
    if (response.result === null || response.result === undefined) {
      return null;
    }

    if (typeof response.result !== "string") {
      throw new Error("Upstash GET returned an unexpected non-string result.");
    }

    return JSON.parse(response.result) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = this.normalizeTtl(ttlSeconds);
    if (ttlSeconds !== undefined && ttl === undefined) {
      return;
    }

    const command = ttl === undefined
      ? ["SET", this.finalKey(key), JSON.stringify(value)]
      : ["SET", this.finalKey(key), JSON.stringify(value), "EX", ttl];
    await this.command(command);
  }

  async del(key: string): Promise<void> {
    await this.command(["DEL", this.finalKey(key)]);
  }

  async setIfNotExists<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    const ttl = this.normalizeTtl(ttlSeconds);
    if (ttlSeconds !== undefined && ttl === undefined) {
      return true;
    }

    const command = ttl === undefined
      ? ["SET", this.finalKey(key), JSON.stringify(value), "NX"]
      : ["SET", this.finalKey(key), JSON.stringify(value), "EX", ttl, "NX"];
    const response = await this.command(command);
    return response.result === "OK";
  }

  private finalKey(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  private normalizeTtl(ttlSeconds?: number): number | undefined {
    if (ttlSeconds === undefined) {
      return undefined;
    }

    const ttl = Math.floor(ttlSeconds);
    return ttl > 0 ? ttl : undefined;
  }

  private async command(command: Array<string | number>): Promise<UpstashResponse> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(command)
    });
    const body = await response.json() as UpstashResponse;

    if (!response.ok || body.error) {
      throw new Error(`Upstash command failed${body.error ? `: ${body.error}` : ` with HTTP ${response.status}`}`);
    }

    return body;
  }
}
