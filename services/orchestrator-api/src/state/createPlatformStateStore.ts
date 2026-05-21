import { InMemoryPlatformStateStore } from "./inMemoryPlatformStateStore.js";
import type { PlatformStateStore, PlatformStateStoreDriver } from "./platformStateStore.js";

export function createPlatformStateStore(): PlatformStateStore {
  const driver = (process.env.PLATFORM_STATE_STORE_DRIVER ?? "memory") as PlatformStateStoreDriver;

  if (driver === "memory") {
    return new InMemoryPlatformStateStore();
  }

  if (driver === "postgres") {
    throw new Error("PLATFORM_STATE_STORE_DRIVER=postgres is planned but not implemented in this checkpoint.");
  }

  throw new Error(`Unsupported PLATFORM_STATE_STORE_DRIVER ${driver}. Expected memory or postgres.`);
}
