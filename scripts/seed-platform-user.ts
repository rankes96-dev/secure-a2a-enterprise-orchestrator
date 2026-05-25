import { randomUUID } from "node:crypto";
import { Pool } from "pg";

function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function envFlag(name: string, fallback = false): boolean {
  const value = cleanEnv(process.env[name])?.toLowerCase();
  if (value === undefined) {
    return fallback;
  }
  return value === "true" || value === "1" || value === "yes";
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const databaseUrl = cleanEnv(process.env.DATABASE_URL);
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to seed a platform user.");
  }

  const tenantId = cleanEnv(process.env.PLATFORM_USER_TENANT_ID) ?? "default";
  const email = cleanEnv(process.env.PLATFORM_USER_EMAIL)?.toLowerCase();
  if (!email) {
    throw new Error("PLATFORM_USER_EMAIL is required to seed a platform user.");
  }

  const displayName = cleanEnv(process.env.PLATFORM_USER_DISPLAY_NAME);
  const roles = csv(process.env.PLATFORM_USER_ROLES);
  const status = cleanEnv(process.env.PLATFORM_USER_STATUS) ?? "active";
  const provider = cleanEnv(process.env.PLATFORM_USER_PROVIDER);
  const issuer = cleanEnv(process.env.PLATFORM_USER_ISSUER);
  const subject = cleanEnv(process.env.PLATFORM_USER_SUBJECT);

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: envFlag("DATABASE_SSL") ? { rejectUnauthorized: false } : undefined
  });

  try {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into tenants (id, name, status, created_at, updated_at)
         values ($1, $2, 'active', now(), now())
         on conflict (id) do update set
           name = excluded.name,
           updated_at = now()`,
        [tenantId, tenantId]
      );

      const existing = await client.query<{ id: string }>(
        `select id
         from users
         where tenant_id = $1
           and lower(email) = lower($2)
         limit 1`,
        [tenantId, email]
      );

      if (existing.rows[0]) {
        await client.query(
          `update users
           set display_name = coalesce($3, display_name),
               roles = $4::jsonb,
               status = $5,
               provider = coalesce($6, provider),
               issuer = coalesce($7, issuer),
               subject = coalesce($8, subject),
               updated_at = now()
           where id = $1
             and tenant_id = $2`,
          [
            existing.rows[0].id,
            tenantId,
            displayName ?? null,
            JSON.stringify(roles),
            status,
            provider ?? null,
            issuer ?? null,
            subject ?? null
          ]
        );
      } else {
        await client.query(
          `insert into users (
            id, tenant_id, provider, issuer, subject, email, display_name, roles, status, created_at, updated_at
          ) values ($1, $2, $3, $4, $5, lower($6), $7, $8::jsonb, $9, now(), now())`,
          [
            randomUUID(),
            tenantId,
            provider ?? null,
            issuer ?? null,
            subject ?? null,
            email,
            displayName ?? null,
            JSON.stringify(roles),
            status
          ]
        );
      }

      await client.query("commit");
      console.log(`Seeded platform user ${email} in tenant ${tenantId}.`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Failed to seed platform user: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

