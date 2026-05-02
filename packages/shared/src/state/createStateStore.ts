import { InMemoryStateStore } from "./InMemoryStateStore";
import type { StateStore } from "./StateStore";
import { UpstashStateStore } from "./UpstashStateStore";

export function createStateStoreFromEnv(): StateStore {
  const driver = process.env.STATE_STORE_DRIVER ?? "memory";

  if (driver === "memory") {
    return new InMemoryStateStore();
  }

  if (driver === "upstash") {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url) {
      throw new Error("UPSTASH_REDIS_REST_URL is required when STATE_STORE_DRIVER=upstash.");
    }

    if (!token) {
      throw new Error("UPSTASH_REDIS_REST_TOKEN is required when STATE_STORE_DRIVER=upstash.");
    }

    return new UpstashStateStore({
      url,
      token,
      keyPrefix: process.env.STATE_STORE_KEY_PREFIX ?? "a2a"
    });
  }

  throw new Error(`Unsupported STATE_STORE_DRIVER: ${driver}. Supported drivers are memory and upstash.`);
}
