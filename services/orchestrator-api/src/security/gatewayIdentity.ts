import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from "jose";

const gatewayId = "secure-a2a-gateway";
const gatewayClientId = "secure-a2a-gateway-client";

type GatewaySigningKey = {
  privateKey: KeyLike;
  publicJwk: JWK;
  kid: string;
};

let signingKeyPromise: Promise<GatewaySigningKey> | undefined;

function gatewayIssuer(): string {
  const configured = process.env.GATEWAY_ISSUER ?? process.env.ORCHESTRATOR_PUBLIC_URL;
  if (configured?.trim()) {
    return configured.trim().replace(/\/+$/, "");
  }

  return `http://localhost:${process.env.PORT ?? 4000}`;
}

function gatewayJwksUri(): string {
  return `${gatewayIssuer()}/.well-known/jwks.json`;
}

async function gatewaySigningKey(): Promise<GatewaySigningKey> {
  if (!signingKeyPromise) {
    signingKeyPromise = (async () => {
      const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
      const publicJwk = await exportJWK(publicKey);
      const kid = await calculateJwkThumbprint(publicJwk);
      return {
        privateKey,
        publicJwk: {
          ...publicJwk,
          alg: "RS256",
          kid,
          use: "sig"
        },
        kid
      };
    })();
  }

  return signingKeyPromise;
}

export function gatewayPublicIdentity() {
  return {
    issuer: gatewayIssuer(),
    clientId: gatewayClientId,
    jwksUri: gatewayJwksUri()
  };
}

export function gatewayMetadata() {
  return {
    gatewayId,
    issuer: gatewayIssuer(),
    clientId: gatewayClientId,
    jwksUri: gatewayJwksUri(),
    supportedOnboardingMethods: ["signed_gateway_challenge", "private_key_jwt"]
  };
}

export async function gatewayPublicJwks(): Promise<{ keys: JWK[] }> {
  const key = await gatewaySigningKey();
  return { keys: [key.publicJwk] };
}

export async function signGatewayOnboardingChallenge(input: {
  onboardingId: string;
  nonce: string;
  expectedAgentId: string;
  expiresAt?: string;
}): Promise<string> {
  const key = await gatewaySigningKey();
  const now = Math.floor(Date.now() / 1000);
  const parsedExpiration = input.expiresAt ? Math.floor(Date.parse(input.expiresAt) / 1000) : now + 300;
  const exp = Number.isFinite(parsedExpiration) ? Math.min(parsedExpiration, now + 300) : now + 300;

  return new SignJWT({
    typ: "gateway_onboarding_challenge",
    onboardingId: input.onboardingId,
    nonce: input.nonce,
    expectedAgentId: input.expectedAgentId
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: key.kid })
    .setIssuer(gatewayIssuer())
    .setSubject(gatewayClientId)
    .setAudience(input.expectedAgentId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(input.onboardingId)
    .sign(key.privateKey);
}
