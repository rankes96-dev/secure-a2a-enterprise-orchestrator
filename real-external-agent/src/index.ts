import { createServer } from "node:http";
import { A2A_CONTENT_TYPE, buildUnsupportedA2AProtocolVersionResponse, unsupportedExplicitA2AProtocolVersion } from "@a2a/shared";
import { agentId, agentIssuer, clientId, port } from "./config.js";
import {
  publicAdminConfig,
  resetDemoConfig,
  saveCapabilityDeclaration,
  saveOAuthApplication,
  saveServicePrincipal,
  saveTrustedGateway
} from "./adminConfig.js";
import { adminPageHtml } from "./adminPage.js";
import { evaluateAdminAccess } from "./adminSecurity.js";
import { getConnectorProfile, listSupportedConnectors, publicConnectorProfile } from "./connectorProfile.js";
import { discoveryDocument } from "./discoveryDocument.js";
import { bearerToken, readJsonBody, sendJson } from "./http.js";
import { createSignedTrustResponse, OnboardingError, type OnboardingRequest } from "./onboarding.js";
import { publicJwks } from "./keys.js";
import { planOnlyRuntimeRequirement, runtimeSkillRequirement, safeDiagnosis, validatePlanOnlyTrustedConfig, validateRuntimeToken, validateRuntimeTrustedConfig, type ConnectorRuntimeTask } from "./runtime.js";
import { buildConnectorActionPlan } from "./connectors/actionPlanning.js";

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

    const adminAccess = evaluateAdminAccess(request.url, request.headers);
    if (!adminAccess.ok) {
      sendJson(response, adminAccess.status, adminAccess.body);
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

    if (request.method === "POST" && request.url === "/admin/skill-declaration") {
      sendAdminResult(response, saveCapabilityDeclaration(await readJsonBody<unknown>(request)));
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
      sendJson(response, 200, publicConnectorProfile(getConnectorProfile(publicAdminConfig().selectedConnectorId)));
      return;
    }

    if (request.method === "GET" && request.url === "/.well-known/a2a-supported-connectors.json") {
      sendJson(response, 200, listSupportedConnectors());
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
      const unsupportedVersion = unsupportedExplicitA2AProtocolVersion(request.headers);
      if (unsupportedVersion) {
        sendJson(response, 400, buildUnsupportedA2AProtocolVersionResponse(unsupportedVersion), { "content-type": A2A_CONTENT_TYPE });
        return;
      }

      const body = await readJsonBody<ConnectorRuntimeTask>(request);
      const message = typeof body.message === "string" ? body.message : "";
      const planOnly = body.mode === "plan_only" || body.runtimeMode === "connector_plan_only";
      if (planOnly) {
        const skill = planOnlyRuntimeRequirement();
        if (!skill) {
          sendJson(response, 403, { error: "runtime_not_authorized" });
          return;
        }

        const token = bearerToken(request);
        if (!token) {
          sendJson(response, 401, { error: "missing_bearer_token" });
          return;
        }

        try {
          await validateRuntimeToken(token, skill.requiredApplicationGrants, body.context?.actor);
        } catch {
          sendJson(response, 401, { error: "invalid_a2a_token" });
          return;
        }

        const configGuard = validatePlanOnlyTrustedConfig(body);
        if (!configGuard.ok) {
          sendJson(response, configGuard.status, configGuard.body);
          return;
        }

        const profile = getConnectorProfile(publicAdminConfig().selectedConnectorId);
        const actionPlan = buildConnectorActionPlan({
          connectorId: profile.connectorId,
          resourceSystem: profile.resourceSystem,
          message
        });
        if (actionPlan) {
          sendJson(response, 200, {
            agentId,
            status: "diagnosed",
            summary: "Connector returned a safe action plan.",
            actionPlan,
            trace: [
              {
                agent: agentId,
                action: "connector_plan_only",
                detail: "Returned side-effect-free connector action plan. No write action was attempted.",
                timestamp: new Date().toISOString()
              }
            ]
          });
          return;
        }

        sendJson(response, 200, {
          agentId,
          status: "needs_more_info",
          summary: "Connector could not produce a safe action plan for this request.",
          trace: [
            {
              agent: agentId,
              action: "connector_plan_only_unsupported",
              detail: "Plan-only mode completed without side effects.",
              timestamp: new Date().toISOString()
            }
          ]
        });
        return;
      }

      const skill = runtimeSkillRequirement(body.skillId);
      if (!skill) {
        sendJson(response, 400, { error: "unknown_skill" });
        return;
      }

      const token = bearerToken(request);
      if (!token) {
        sendJson(response, 401, { error: "missing_bearer_token" });
        return;
      }

      let tokenContext: Awaited<ReturnType<typeof validateRuntimeToken>>;
      try {
        tokenContext = await validateRuntimeToken(token, skill.requiredApplicationGrants, body.context?.actor);
      } catch (error) {
        sendJson(response, 401, {
          error: error instanceof Error && error.message === "missing_required_application_grant"
            ? "missing_required_application_grant"
            : "invalid_a2a_token"
        });
        return;
      }

      const configGuard = validateRuntimeTrustedConfig(body, skill);
      if (!configGuard.ok) {
        sendJson(response, configGuard.status, configGuard.body);
        return;
      }

      sendJson(response, 200, safeDiagnosis({ ...tokenContext, task: body, skill, accessEvaluation: configGuard.accessEvaluation }));
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
