import { calculateJwkThumbprint, exportJWK, generateKeyPair, type JWK, type KeyLike } from "jose";

export type SigningKey = {
  privateKey: KeyLike;
  publicJwk: JWK;
  kid: string;
};

let signingKey: SigningKey | undefined;

export async function getSigningKey(): Promise<SigningKey> {
  if (signingKey) {
    return signingKey;
  }

  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  signingKey = {
    privateKey,
    publicJwk: {
      ...publicJwk,
      kid,
      alg: "RS256",
      use: "sig"
    },
    kid
  };
  return signingKey;
}

export async function publicJwks(): Promise<{ keys: JWK[] }> {
  const key = await getSigningKey();
  return { keys: [key.publicJwk] };
}
