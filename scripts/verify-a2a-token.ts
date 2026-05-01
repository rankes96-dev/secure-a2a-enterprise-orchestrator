import { scopesFromClaims, verifyA2AToken } from "@a2a/shared";
import type { A2ATokenResponse } from "@a2a/shared";

const issuer = process.env.A2A_ISSUER ?? "http://localhost:4110";
const jwksUri = process.env.A2A_JWKS_URI ?? `${issuer}/.well-known/jwks.json`;

async function requestToken(): Promise<A2ATokenResponse> {
  const response = await fetch(`${issuer}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: process.env.ORCHESTRATOR_CLIENT_ID ?? "servicenow-orchestrator-agent",
      client_secret: process.env.ORCHESTRATOR_CLIENT_SECRET ?? "dev-secret",
      audience: "jira-agent",
      scope: "jira.diagnose"
    })
  });

  if (!response.ok) {
    throw new Error(`Token request failed with ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<A2ATokenResponse>;
}

async function main(): Promise<void> {
  const token = await requestToken();
  const authorizationHeader = `${token.token_type} ${token.access_token}`;
  const valid = await verifyA2AToken({
    authorizationHeader,
    expectedIssuer: issuer,
    expectedAudience: "jira-agent",
    requiredScope: "jira.diagnose",
    jwksUri
  });
  const wrongAudience = await verifyA2AToken({
    authorizationHeader,
    expectedIssuer: issuer,
    expectedAudience: "github-agent",
    requiredScope: "jira.diagnose",
    jwksUri
  });
  const missingScope = await verifyA2AToken({
    authorizationHeader,
    expectedIssuer: issuer,
    expectedAudience: "jira-agent",
    requiredScope: "github.diagnose",
    jwksUri
  });
  const missingHeader = await verifyA2AToken({
    expectedIssuer: issuer,
    expectedAudience: "jira-agent",
    requiredScope: "jira.diagnose",
    jwksUri
  });
  const invalidBearer = await verifyA2AToken({
    authorizationHeader: "Bearer not-a-jwt",
    expectedIssuer: issuer,
    expectedAudience: "jira-agent",
    requiredScope: "jira.diagnose",
    jwksUri
  });

  console.log(
    JSON.stringify(
      {
        valid: {
          valid: valid.valid,
          reason: valid.reason,
          claims: valid.claims
            ? {
                iss: valid.claims.iss,
                sub: valid.claims.sub,
                aud: valid.claims.aud,
                scope: valid.claims.scope,
                scopes: scopesFromClaims(valid.claims),
                exp: valid.claims.exp,
                iat: valid.claims.iat,
                jti: valid.claims.jti,
                client_id: valid.claims.client_id
              }
            : undefined
        },
        wrongAudience: {
          valid: wrongAudience.valid,
          reason: wrongAudience.reason
        },
        missingScope: {
          valid: missingScope.valid,
          reason: missingScope.reason,
          scopes: missingScope.claims ? scopesFromClaims(missingScope.claims) : undefined
        },
        missingHeader,
        invalidBearer: {
          valid: invalidBearer.valid,
          reason: invalidBearer.reason
        }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "A2A token verification script failed");
  process.exitCode = 1;
});
