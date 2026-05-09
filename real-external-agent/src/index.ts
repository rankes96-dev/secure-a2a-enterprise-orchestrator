import { createServer } from "node:http";
import { agentId, agentIssuer, clientId, expectedAudience, port, tokenEndpointAuthMethod } from "./config.js";
import {
  adminAgentMetadata,
  publicAdminConfig,
  resetDemoConfig,
  saveCapabilityDeclaration,
  saveOAuthApplication,
  saveServicePrincipal,
  saveTrustedGateway
} from "./adminConfig.js";
import { adminPageHtml } from "./adminPage.js";
import { getConnectorProfile } from "./connectorProfile.js";
import { bearerToken, readJsonBody, sendJson } from "./http.js";
import { createSignedTrustResponse, OnboardingError, type OnboardingRequest } from "./onboarding.js";
import { publicJwks } from "./keys.js";
import { safeDiagnosis, validateRuntimeToken } from "./runtime.js";

function discoveryDocument() {
  const issuer = agentIssuer();
  const agent = adminAgentMetadata();
  return {
    agentId,
    issuer,
    resourceSystem: agent.resourceSystem,
    connectorId: agent.connectorId,
    connectorDisplayName: agent.connectorDisplayName,
    connectorProfileUrl: agent.connectorProfileUrl,
    trustAdapter: agent.trustAdapter,
    jwksUri: `${issuer}/.well-known/jwks.json`,
    onboardingEndpoint: `${issuer}/onboarding/challenge`,
    runtimeEndpoint: `${issuer}/a2a/task`,
    adminConsoleUrl: `${issuer}/admin`,
    auth: {
      type: "oauth2_client_credentials_jwt",
      audience: expectedAudience(),
      tokenEndpointAuthMethod
    },
    connectionRequirements: {
      requiresGatewayRegistration: true,
      requiresOAuthApplication: true,
      requiresServicePrincipal: true
    }
  };
}

function sendHtml(response: Parameters<typeof sendJson>[0], status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

function sendAdminResult(response: Parameters<typeof sendJson>[0], result: { ok: true; config: unknown } | { ok: false; errors: string[] }): void {
  if (result.ok) {
    sendJson(response, 200, result);
    return;
  }

  sendJson(response, 400, { error: "invalid_admin_config", errors: result.errors });
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { ok: true, agentId });
      return;
    }

    if (request.method === "GET" && request.url === "/admin") {
      sendHtml(response, 200, adminPageHtml());
      return;
    }

    if (request.method === "GET" && request.url === "/admin/config") {
      sendJson(response, 200, publicAdminConfig());
      return;
    }

    if (request.method === "POST" && request.url === "/admin/trusted-gateway") {
      sendAdminResult(response, saveTrustedGateway(await readJsonBody<unknown>(request)));
      return;
    }

    if (request.method === "POST" && request.url === "/admin/oauth-application") {
      sendAdminResult(response, saveOAuthApplication(await readJsonBody<unknown>(request)));
      return;
    }

    if (request.method === "POST" && request.url === "/admin/service-principal") {
      sendAdminResult(response, saveServicePrincipal(await readJsonBody<unknown>(request)));
      return;
    }

    if (request.method === "POST" && request.url === "/admin/capability-declaration") {
      sendAdminResult(response, saveCapabilityDeclaration(await readJsonBody<unknown>(request)));
      return;
    }

    if (request.method === "POST" && request.url === "/admin/reset-demo") {
      resetDemoConfig();
      sendJson(response, 200, publicAdminConfig());
      return;
    }

    if (request.method === "GET" && request.url === "/.well-known/a2a-agent.json") {
      sendJson(response, 200, discoveryDocument());
      return;
    }

    if (request.method === "GET" && request.url === "/.well-known/a2a-connector-profile.json") {
      sendJson(response, 200, getConnectorProfile());
      return;
    }

    if (request.method === "GET" && request.url === "/.well-known/jwks.json") {
      sendJson(response, 200, await publicJwks());
      return;
    }

    if (request.method === "POST" && request.url === "/onboarding/challenge") {
      const body = await readJsonBody<OnboardingRequest>(request);
      try {
        sendJson(response, 200, await createSignedTrustResponse(body));
      } catch (error) {
        sendJson(response, error instanceof OnboardingError ? error.status : 400, {
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
