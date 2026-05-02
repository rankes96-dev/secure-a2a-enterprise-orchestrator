import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from "jose";
import { InMemoryClientAssertionReplayStore } from "../services/mock-identity-provider/src/security/clientAssertionReplayStore";
import { authenticateOAuthClient } from "../services/mock-identity-provider/src/security/clientAuthentication";
import type { OAuthApplicationRegistration } from "../services/mock-identity-provider/src/config/oauthApplications";

const jwtBearerAssertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function verifyReplayStoreCases(): void {
  const now = Math.floor(Date.now() / 1000);
  const store = new InMemoryClientAssertionReplayStore();
  const jti = randomUUID();

  assertCondition(store.checkAndStore({ clientId: "client-a", jti, expiresAtEpochSeconds: now + 60 }).ok, "first jti use should be allowed");

  const replay = store.checkAndStore({ clientId: "client-a", jti, expiresAtEpochSeconds: now + 60 });
  assertCondition(!replay.ok && replay.reason === "replay_detected", "same client/jti replay should be blocked");

  assertCondition(
    store.checkAndStore({ clientId: "client-b", jti, expiresAtEpochSeconds: now + 60 }).ok,
    "same jti should be scoped by client id"
  );

  const expiringJti = randomUUID();
  assertCondition(
    store.checkAndStore({ clientId: "client-a", jti: expiringJti, expiresAtEpochSeconds: now - 1 }).ok,
    "expired jti should not block storing"
  );
  assertCondition(
    store.checkAndStore({ clientId: "client-a", jti: expiringJti, expiresAtEpochSeconds: now + 60 }).ok,
    "expired jti should be cleaned and reusable"
  );

  for (let index = 0; index < 5; index += 1) {
    assertCondition(
      store.checkAndStore({ clientId: "client-a", jti: randomUUID(), expiresAtEpochSeconds: now + 60 }).ok,
      "unique jtis should be allowed"
    );
  }

  console.log("replay store cases: ok");
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
  verifyReplayStoreCases();
  await verifyAuthenticationReplayCase();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "private_key_jwt replay verification failed");
  process.exitCode = 1;
});
