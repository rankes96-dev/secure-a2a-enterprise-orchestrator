import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from "jose";
import { createStateStoreFromEnv, InMemoryStateStore } from "@a2a/shared";
import { ClientAssertionReplayStore } from "../services/mock-identity-provider/src/security/clientAssertionReplayStore";
import { authenticateOAuthClient } from "../services/mock-identity-provider/src/security/clientAuthentication";
import type { OAuthApplicationRegistration } from "../services/mock-identity-provider/src/config/oauthApplications";

const jwtBearerAssertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

dotenv.config({ path: new URL("../services/mock-identity-provider/.env", import.meta.url), quiet: true });
dotenv.config({ path: new URL("../services/orchestrator-api/.env", import.meta.url), quiet: true });

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function verifyInMemoryStateStoreCases(): Promise<void> {
  const store = new InMemoryStateStore();

  await store.set("state:plain", { value: "stored" });
  const stored = await store.get<{ value: string }>("state:plain");
  assertCondition(stored?.value === "stored", "get should return a stored value");

  await store.del("state:plain");
  assertCondition(await store.get("state:plain") === null, "del should remove a stored value");

  assertCondition(await store.setIfNotExists("state:nx", { value: 1 }, 60), "setIfNotExists should store a missing key");
  assertCondition(!(await store.setIfNotExists("state:nx", { value: 2 }, 60)), "setIfNotExists should reject an existing key");

  await store.set("state:expired", { value: "expired" }, 0);
  assertCondition(await store.get("state:expired") === null, "get should ignore expired keys");
  assertCondition(await store.setIfNotExists("state:expired", { value: "new" }, 60), "expired keys should not block setIfNotExists");

  console.log("in-memory state store cases: ok");
}

async function verifyReplayStoreCases(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const store = new ClientAssertionReplayStore(new InMemoryStateStore());
  const jti = randomUUID();

  assertCondition((await store.checkAndStore({ clientId: "client-a", jti, expiresAtEpochSeconds: now + 60 })).ok, "first jti use should be allowed");

  const replay = await store.checkAndStore({ clientId: "client-a", jti, expiresAtEpochSeconds: now + 60 });
  assertCondition(!replay.ok && replay.reason === "replay_detected", "same client/jti replay should be blocked");

  assertCondition(
    (await store.checkAndStore({ clientId: "client-b", jti, expiresAtEpochSeconds: now + 60 })).ok,
    "same jti should be scoped by client id"
  );

  const expiringJti = randomUUID();
  assertCondition(
    (await store.checkAndStore({ clientId: "client-a", jti: expiringJti, expiresAtEpochSeconds: now - 1 })).ok,
    "expired jti should not block storing"
  );
  assertCondition(
    (await store.checkAndStore({ clientId: "client-a", jti: expiringJti, expiresAtEpochSeconds: now + 60 })).ok,
    "expired jti should be cleaned and reusable"
  );

  for (let index = 0; index < 5; index += 1) {
    assertCondition(
      (await store.checkAndStore({ clientId: "client-a", jti: randomUUID(), expiresAtEpochSeconds: now + 60 })).ok,
      "unique jtis should be allowed"
    );
  }

  console.log("replay store cases: ok");
}

async function verifyOptionalUpstashStateStoreCases(): Promise<void> {
  if (
    process.env.STATE_STORE_DRIVER !== "upstash" ||
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    console.log("upstash state store cases: skipped");
    return;
  }

  const store = createStateStoreFromEnv();
  const testId = randomUUID();
  const plainKey = `verify:state:${testId}:plain`;
  const nxKey = `verify:state:${testId}:nx`;

  await store.set(plainKey, { value: "stored" }, 60);
  const stored = await store.get<{ value: string }>(plainKey);
  assertCondition(stored?.value === "stored", "Upstash get should return a stored value");

  assertCondition(await store.setIfNotExists?.(nxKey, { value: 1 }, 60) === true, "Upstash setIfNotExists should store a missing key");
  assertCondition(await store.setIfNotExists?.(nxKey, { value: 2 }, 60) === false, "Upstash setIfNotExists should reject an existing key");

  await store.del(plainKey);
  await store.del(nxKey);
  assertCondition(await store.get(plainKey) === null, "Upstash del should remove a stored value");

  console.log("upstash state store cases: ok");
}

async function createClientAssertion(params: {
  key: KeyLike | Uint8Array;
  clientId: string;
  audience: string;
  jti: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(params.clientId)
    .setSubject(params.clientId)
    .setAudience(params.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setJti(params.jti)
    .sign(params.key);
}

async function verifyAuthenticationReplayCase(): Promise<void> {
  const clientId = `verify-client-${randomUUID()}`;
  const audience = "http://localhost:4110/oauth/token";
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = (await exportJWK(publicKey)) as JWK;
  const application: OAuthApplicationRegistration = {
    clientId,
    displayName: "Replay Verification Client",
    ownerAgentId: clientId,
    scopePolicy: "agent_card_registry",
    allowedAuthMethods: ["private_key_jwt"],
    privateKeyJwt: {
      enabled: true,
      expectedAudience: audience,
      publicJwkJson: JSON.stringify(publicJwk)
    }
  };
  const assertion = await createClientAssertion({
    key: privateKey,
    clientId,
    audience,
    jti: randomUUID()
  });
  const body = {
    client_id: clientId,
    client_assertion_type: jwtBearerAssertionType,
    client_assertion: assertion
  };

  const first = await authenticateOAuthClient({ body, application });
  assertCondition(first.ok && first.authMethod === "private_key_jwt", "first private_key_jwt assertion should authenticate");

  const second = await authenticateOAuthClient({ body, application });
  assertCondition(
    !second.ok && second.error === "invalid_client_assertion_replay" && second.authMethod === "private_key_jwt",
    "replayed private_key_jwt assertion should be rejected"
  );

  const secretFallbackApplication: OAuthApplicationRegistration = {
    clientId: "secret-client",
    clientSecret: "dev-secret",
    displayName: "Secret Verification Client",
    ownerAgentId: "secret-client",
    scopePolicy: "agent_card_registry",
    allowedAuthMethods: ["client_secret_post"]
  };
  const secretFallback = await authenticateOAuthClient({
    body: {
      client_id: "secret-client",
      client_secret: "dev-secret"
    },
    application: secretFallbackApplication
  });
  assertCondition(secretFallback.ok && secretFallback.authMethod === "client_secret_post", "client_secret_post should remain unchanged");

  console.log("private_key_jwt authentication replay case: ok");
}

async function main(): Promise<void> {
  await verifyInMemoryStateStoreCases();
  await verifyReplayStoreCases();
  await verifyOptionalUpstashStateStoreCases();
  await verifyAuthenticationReplayCase();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "private_key_jwt replay verification failed");
  process.exitCode = 1;
});
