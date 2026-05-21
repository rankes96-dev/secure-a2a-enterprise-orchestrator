import { InMemoryPlatformStateStore } from "./inMemoryPlatformStateStore.js";
import type { PlatformStateStore, PlatformStateStoreDriver } from "./platformStateStore.js";

let cachedPlatformStateStore: PlatformStateStore | undefined;

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

export function getPlatformStateStore(): PlatformStateStore {
  cachedPlatformStateStore ??= createPlatformStateStore();
  return cachedPlatformStateStore;
}

// Test/dev-only helper for isolated verification cases. Runtime modules should not call this.
export function resetPlatformStateStoreForTests(): void {
  cachedPlatformStateStore = undefined;
}
