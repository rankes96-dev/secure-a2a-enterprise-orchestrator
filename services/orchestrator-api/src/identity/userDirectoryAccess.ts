import type { VerifiedUserIdentity } from "../security/userIdentity.js";
import { getPlatformStateStore } from "../state/createPlatformStateStore.js";
import type { PlatformStateStore, StoredPlatformUser } from "../state/platformStateStore.js";

const accessDeniedMessage = "Access denied. Your user is not enabled for this gateway.";

function cleanEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function envFlag(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const value = cleanEnv(env[name])?.toLowerCase();
  if (value === undefined) {
    return undefined;
  }
  return value === "true" || value === "1" || value === "yes";
}

function hasConfiguredAllowedEmails(env: NodeJS.ProcessEnv): boolean {
  return Boolean(cleanEnv(env.PLATFORM_ALLOWED_USER_EMAILS));
}

function platformStoreDriver(env: NodeJS.ProcessEnv): string {
  return cleanEnv(env.PLATFORM_STATE_STORE_DRIVER) ?? "memory";
}

function shouldRequireDirectory(identity: VerifiedUserIdentity, env: NodeJS.ProcessEnv): boolean {
  if (identity.provider === "mock") {
    return envFlag(env, "MOCK_REQUIRE_USER_DIRECTORY") === true;
  }

  const explicit = envFlag(env, "AUTH0_REQUIRE_USER_DIRECTORY");
  if (explicit !== undefined) {
    return explicit;
  }

  return platformStoreDriver(env) === "postgres" || hasConfiguredAllowedEmails(env);
}

function syntheticDirectoryUser(identity: VerifiedUserIdentity, tenantId: string): StoredPlatformUser {
  const now = new Date().toISOString();
  return {
    id: `${tenantId}:${identity.provider}:${identity.subject}`,
    tenantId,
    provider: identity.provider,
    issuer: identity.issuer,
    subject: identity.subject,
    email: identity.email.toLowerCase(),
    displayName: identity.name,
    roles: [...identity.roles],
    status: "active",
    createdAt: now,
    updatedAt: now
  };
}

function denied(reason: string): { ok: false; status: 403; error: string; message: string; reason: string } {
  return {
    ok: false,
    status: 403,
    error: reason,
    message: accessDeniedMessage,
    reason
  };
}

export async function verifyUserDirectoryAccess(params: {
  identity: VerifiedUserIdentity;
  tenantId: string;
  store?: PlatformStateStore;
  env?: NodeJS.ProcessEnv;
}): Promise<
  | { ok: true; user: StoredPlatformUser }
  | { ok: false; status: 403; error: string; message: string; reason: string }
> {
  const env = params.env ?? process.env;
  if (!shouldRequireDirectory(params.identity, env)) {
    return { ok: true, user: syntheticDirectoryUser(params.identity, params.tenantId) };
  }

  const email = params.identity.email.trim().toLowerCase();
  if (!email) {
    return denied("user_directory_missing_email");
  }
  if (params.identity.provider === "auth0" && params.identity.emailVerified === false) {
    return denied("user_directory_email_unverified");
  }

  const store = params.store ?? getPlatformStateStore();
  let user: StoredPlatformUser | undefined;
  try {
    user = await store.findUserByEmail({
      tenantId: params.tenantId,
      email
    });
  } catch {
    return denied("user_directory_unavailable");
  }

  if (!user) {
    return denied("user_directory_missing");
  }
  if (user.status === "disabled") {
    return denied("user_directory_disabled");
  }
  if (user.subject || user.provider || user.issuer) {
    if (user.provider !== params.identity.provider || user.issuer !== params.identity.issuer || user.subject !== params.identity.subject) {
      return denied("user_directory_subject_mismatch");
    }
    return { ok: true, user };
  }

  try {
    const bound = await store.bindUserIdentity({
      userId: user.id,
      provider: params.identity.provider,
      issuer: params.identity.issuer,
      subject: params.identity.subject,
      email,
      displayName: params.identity.name
    });
    return { ok: true, user: bound };
  } catch {
    return denied("user_directory_subject_mismatch");
  }
}
