import { exportJWK, generateKeyPair } from "jose";

async function main(): Promise<void> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const privateJwk = await exportJWK(privateKey);
  const publicJwk = await exportJWK(publicKey);

  console.log("Local demo keys only. Do not commit private keys.");
  console.log(`ORCHESTRATOR_PRIVATE_JWK_JSON='${JSON.stringify(privateJwk)}'`);
  console.log(`ORCHESTRATOR_PUBLIC_JWK_JSON='${JSON.stringify(publicJwk)}'`);
}

void main();
