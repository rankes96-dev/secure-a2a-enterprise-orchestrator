import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to apply the platform schema.");
  }

  const schemaPath = join(process.cwd(), "services", "orchestrator-api", "db", "schema.sql");
  const schema = readFileSync(schemaPath, "utf8");
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });

  console.log("Applying platform schema...");
  try {
    await pool.query(schema);
  } finally {
    await pool.end();
  }
  console.log("Platform schema applied.");
}

main().catch((error) => {
  if (error instanceof Error && error.message === "DATABASE_URL is required to apply the platform schema.") {
    console.error(error.message);
  } else {
    console.error("Failed to apply platform schema.");
  }
  process.exitCode = 1;
});
