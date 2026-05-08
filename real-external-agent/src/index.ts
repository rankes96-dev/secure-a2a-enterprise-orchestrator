import { createServer } from "node:http";
import { agentId, agentIssuer, clientId, expectedAudience, port, tokenEndpointAuthMethod } from "./config.js";
import { bearerToken, readJsonBody, sendJson } from "./http.js";
import { createSignedTrustResponse, type OnboardingChallenge } from "./onboarding.js";
import { publicJwks } from "./keys.js";
import { safeDiagnosis, validateRuntimeToken } from "./runtime.js";

function discoveryDocument() {
  const issuer = agentIssuer();
  return {
    agentId,
    issuer,
    jwksUri: `${issuer}/.well-known/jwks.json`,
    onboardingEndpoint: `${issuer}/onboarding/challenge`,
    runtimeEndpoint: `${issuer}/a2a/task`,
    auth: {
      type: "oauth2_client_credentials_jwt",
      audience: expectedAudience(),
      tokenEndpointAuthMethod
    }
  };
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { ok: true, agentId });
      return;
    }

    if (request.method === "GET" && request.url === "/.well-known/a2a-agent.json") {
      sendJson(response, 200, discoveryDocument());
      return;
    }

    if (request.method === "GET" && request.url === "/.well-known/jwks.json") {
      sendJson(response, 200, await publicJwks());
      return;
    }

    if (request.method === "POST" && request.url === "/onboarding/challenge") {
      const body = await readJsonBody<OnboardingChallenge>(request);
      try {
        sendJson(response, 200, await createSignedTrustResponse(body));
      } catch (error) {
        sendJson(response, 400, {
          error: "invalid_onboarding_challenge",
          detail: error instanceof Error ? error.message : "invalid challenge"
        });
      }
      return;
    }

    if (request.method === "POST" && request.url === "/a2a/task") {
      const token = bearerToken(request);
      if (!token) {
        sendJson(response, 401, { error: "missing_bearer_token" });
        return;
      }

      try {
        const tokenContext = await validateRuntimeToken(token);
        sendJson(response, 200, safeDiagnosis(tokenContext));
      } catch {
        sendJson(response, 401, { error: "invalid_a2a_token" });
      }
      return;
    }

    sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    sendJson(response, 500, {
      error: "internal_error",
      detail: error instanceof Error ? error.message : "unknown error"
    });
  }
});

server.listen(port(), () => {
  console.log(`[real-external-agent] listening on ${agentIssuer()} (${port()}) clientId=${clientId}`);
});
