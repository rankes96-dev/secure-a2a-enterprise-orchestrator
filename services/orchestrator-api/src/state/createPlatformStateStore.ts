import { InMemoryPlatformStateStore } from "./inMemoryPlatformStateStore.js";
import { platformStateStoreDriver } from "./postgresConfig.js";
import { PostgresPlatformStateStore } from "./postgresPlatformStateStore.js";
import type { PlatformStateStore, PlatformStateStoreDriver } from "./platformStateStore.js";

let cachedPlatformStateStore: PlatformStateStore | undefined;

export function createPlatformStateStore(): PlatformStateStore {
  const driver = platformStateStoreDriver() as PlatformStateStoreDriver;

  if (driver === "memory") {
    return new InMemoryPlatformStateStore();
  }

  if (driver === "postgres") {
    return new PostgresPlatformStateStore();
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

// Test/dev-only helper for verification cases that need to simulate process restart.
export async function closePlatformStateStoreForTests(): Promise<void> {
  const store = cachedPlatformStateStore;
  cachedPlatformStateStore = undefined;
  if (store?.close) {
    await store.close();
  }
}
