import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

type AppliedMigration = {
  checksum: string;
};

const migrationsDir = join(process.cwd(), "services", "orchestrator-api", "db", "migrations");

function migrationId(filename: string): string {
  return filename.split("_", 1)[0] ?? filename;
}

function checksum(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to apply platform migrations.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });

  try {
    await pool.query(`
      create table if not exists platform_schema_migrations (
        id text primary key,
        name text not null,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);

    const migrationFiles = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));

    const seenIds = new Set<string>();
    for (const name of migrationFiles) {
      const id = migrationId(name);
      if (seenIds.has(id)) {
        throw new Error(`Duplicate migration id: ${id}`);
      }
      seenIds.add(id);

      const fullPath = join(migrationsDir, name);
      const sql = readFileSync(fullPath, "utf8");
      const fileChecksum = checksum(sql);
      const applied = await pool.query<AppliedMigration>(
        "select checksum from platform_schema_migrations where id = $1",
        [id]
      );

      if (applied.rowCount && applied.rows[0]?.checksum !== fileChecksum) {
        throw new Error(`Checksum mismatch for platform migration ${id}.`);
      }

      if (applied.rowCount) {
        console.log(`Skipping already applied migration ${name}.`);
        continue;
      }

      console.log(`Applying migration ${name}...`);
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query(
          "insert into platform_schema_migrations (id, name, checksum) values ($1, $2, $3)",
          [id, name, fileChecksum]
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }

  console.log("Platform migrations applied.");
}

main().catch((error) => {
  if (error instanceof Error && error.message === "DATABASE_URL is required to apply platform migrations.") {
    console.error(error.message);
  } else if (error instanceof Error && error.message.startsWith("Checksum mismatch for platform migration")) {
    console.error(error.message);
  } else {
    console.error("Failed to apply platform migrations.");
  }
  process.exitCode = 1;
});
