import dotenv from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { A2AAgentResponse, A2ATask, AgentTask } from "@a2a/shared";
import { formatA2AAuthTraceDetail, requireA2AAuth } from "@a2a/shared";
import { readJsonBody, sendJson, startJsonServer } from "@a2a/shared/src/http";

dotenv.config({ path: new URL("../../orchestrator-api/.env", import.meta.url) });

const port = Number(process.env.SECURITY_OAUTH_AGENT_PORT ?? 4104);
type OAuthTokenRecord = {
  app: string;
  system: string;
  currentScopes: string[];
};

const agentCard = {
  agentId: "security-oauth-agent",
  name: "Security OAuth Agent",
  description: "Security agent that evaluates OAuth, token, scope, permission and policy-sensitive actions.",
  systems: ["Security", "OAuth", "Identity"],
  endpoint: process.env.SECURITY_OAUTH_AGENT_URL ?? "http://localhost:4104/task",
  auth: { type: "mock_internal_token", audience: "security-oauth-agent" },
  skills: [
    {
      id: "security.compare_oauth_scopes",
      name: "Compare OAuth scopes",
      description: "Compare required OAuth scopes with mock token scopes.",
      capabilities: ["oauth.scope.compare", "oauth.client_auth.diagnose", "integration.auth.diagnose"],
      requestedAction: "oauth.scope.compare",
      requiredPermission: "security.scope.compare",
      priority: 60,
      owner: "Security Platform Team",
      scope: { resourceTypes: ["oauth_client", "scope", "token"] },
      riskLevel: "medium",
      requiredScopes: ["security.scope.compare"]
    },
    {
      id: "security.inspect_oauth_token",
      name: "Inspect OAuth token",
      description: "Inspect raw OAuth token posture.",
      capabilities: ["oauth.token.inspect", "security.token.inspect"],
      requestedAction: "security.token.inspect",
      requiredPermission: "security.token.inspect",
      priority: 90,
      owner: "Security Platform Team",
      scope: { resourceTypes: ["token", "credential"] },
      riskLevel: "sensitive",
      requiredScopes: ["security.token.inspect"],
      sensitive: true
    },
    {
      id: "security.evaluate_agent_action",
      name: "Evaluate agent action",
      description: "Evaluate agent action policy requirements.",
      capabilities: ["identity.permission.change"],
      requestedAction: "access.permission.grant",
      requiredPermission: "access.permission.grant",
      requiredScopes: ["access.permission.grant"],
      priority: 50,
      owner: "Security Platform Team",
      scope: { resourceTypes: ["role", "permission"] },
      riskLevel: "high"
    }
  ]
};

async function loadTokens(): Promise<OAuthTokenRecord[]> {
  const filePath = path.resolve(process.cwd(), "../../mock-data/oauth-tokens.json");
  return JSON.parse(await readFile(filePath, "utf8")) as OAuthTokenRecord[];
}

function requiredScopesFor(task: AgentTask): string[] {
  // TODO: In the production architecture, target system agents should return
  // requiredScopes/requiredPermissions in their A2A responses. This security
  // agent should compare those requirements against token, user, and app scopes
  // instead of hardcoding every system operation locally.
  if (task.classification.system === "Jira" && task.classification.operation === "create_issue") {
    return ["read:jira-work", "write:jira-work"];
  }

  return [];
}

startJsonServer(port, async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { status: "ok", agentId: "security-oauth-agent" }, request);
    return;
  }

  if (request.method === "GET" && request.url === "/agent-card") {
    sendJson(response, 200, agentCard, request);
    return;
  }

  if (request.method !== "POST" || request.url !== "/task") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const task = await readJsonBody<A2ATask | AgentTask>(request);
  const auth = await requireA2AAuth({
    request,
    task,
    agentId: agentCard.agentId,
    expectedAudience: agentCard.auth.audience
  });
  if (!auth.ok) {
    sendJson(response, auth.statusCode, auth.response, request);
    return;
  }
  if ("context" in task && auth.taskAuth) {
    task.context.auth = auth.taskAuth;
  }

  const legacyTask: AgentTask = {
    message: "userMessage" in task ? task.userMessage : task.message,
    classification: task.classification
  };
  const tokens = await loadTokens();
  const token = tokens.find((item) => item.system === task.classification.system);
  const currentScopes = token?.currentScopes ?? [];
  const requiredScopes = requiredScopesFor(legacyTask);
  const missingScopes = requiredScopes.filter((scope) => !currentScopes.includes(scope));
  const isGitHubRateLimit = task.classification.system === "GitHub" && task.classification.issueType === "RATE_LIMIT";

  if (isGitHubRateLimit) {
    const result: A2AAgentResponse = {
      agentId: "security-oauth-agent",
      status: "diagnosed",
      summary: "Security Agent did not find token posture as the primary GitHub failure signal.",
      probableCause: "Rate-limit evidence is more relevant than OAuth scope posture for this GitHub scan failure.",
      recommendedActions: ["Use GitHub Agent and API Health Agent rate-limit recommendations."],
      evidence: [
        {
          title: "GitHub token authorization posture",
          data: {
            finding: "Token permissions and SAML SSO are not the failing signal; rate-limit headers indicate exhaustion.",
            checkedSignals: ["token_type", "permissions", "saml_sso_authorization"]
          }
        }
      ],
      trace: [
        {
          agent: "security-oauth-agent",
          action: "review_github_token_posture",
          detail: "Reviewed token context after GitHub rate-limit evidence was found",
          timestamp: new Date().toISOString()
        },
        ...("context" in task && task.context.auth?.tokenValidated
          ? [
              {
                agent: "security-oauth-agent",
                action: "A2A_JWT_VALIDATED",
                detail: formatA2AAuthTraceDetail(task.context.auth),
                timestamp: new Date().toISOString()
              }
            ]
          : [])
      ]
    };

    sendJson(response, 200, result);
    return;
  }

  const result: A2AAgentResponse = {
    agentId: "security-oauth-agent",
    status: "diagnosed",
    summary: missingScopes.length > 0 ? `Security Agent found missing OAuth scopes: ${missingScopes.join(", ")}.` : "Security Agent found no missing OAuth scopes in mock token data.",
    probableCause: missingScopes.length > 0 ? `Missing OAuth scope ${missingScopes.join(", ")}.` : undefined,
    recommendedActions: missingScopes.length > 0 ? ["Add the missing scope and reauthorize the integration app."] : ["Continue with the system specialist diagnosis."],
    evidence: [
      {
        title: "OAuth token scope comparison",
        data: {
          app: token?.app ?? "unknown",
          currentScopes,
          missingScopes
        }
      }
    ],
    trace: [
      {
        agent: "security-oauth-agent",
        action: "compare_oauth_scopes",
        detail: missingScopes.length > 0 ? `Missing scopes: ${missingScopes.join(", ")}` : "No missing scopes found",
        timestamp: new Date().toISOString()
      },
      ...("context" in task && task.context.auth?.tokenValidated
        ? [
            {
              agent: "security-oauth-agent",
              action: "A2A_JWT_VALIDATED",
              detail: formatA2AAuthTraceDetail(task.context.auth),
              timestamp: new Date().toISOString()
            }
          ]
        : [])
    ]
  };

  sendJson(response, 200, result);
});
