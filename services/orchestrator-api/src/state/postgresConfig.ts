export type PlatformPostgresConfig = {
  driver: "memory" | "postgres";
  databaseUrl?: string;
  ssl: boolean;
};

export function platformStateStoreDriver(): PlatformPostgresConfig["driver"] {
  const configured = process.env.PLATFORM_STATE_STORE_DRIVER?.trim() || "memory";
  if (configured === "memory" || configured === "postgres") {
    return configured;
  }
  throw new Error(`Unsupported PLATFORM_STATE_STORE_DRIVER ${configured}. Expected memory or postgres.`);
}

export function postgresConfigFromEnv(): PlatformPostgresConfig {
  const driver = platformStateStoreDriver();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const ssl = process.env.DATABASE_SSL === "true";

  if (driver === "postgres" && !databaseUrl) {
    throw new Error("PLATFORM_STATE_STORE_DRIVER=postgres requires DATABASE_URL.");
  }

  return {
    driver,
    databaseUrl,
    ssl
  };
}
