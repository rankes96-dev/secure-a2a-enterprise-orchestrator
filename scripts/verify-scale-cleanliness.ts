import { readFileSync } from "node:fs";

type Check = {
  file: string;
  description: string;
  forbidden: RegExp[];
};

const checks: Check[] = [
  {
    file: "real-external-agent/src/adminConfig.ts",
    description: "admin config should not contain connector-specific demo grants or permissions",
    forbidden: [/read:jira-work/, /create_issues/, /incident\.read/, /repo\.metadata\.read/]
  },
  {
    file: "services/orchestrator-api/src/connectorRouting.ts",
    description: "connector routing should use the reference connector catalog, not inline connector metadata",
    forbidden: [/const\s+supportedConnectors\s*=/, /jira-reference/, /servicenow-reference/, /github-reference/]
  },
  {
    file: "services/orchestrator-api/src/connectorRuntime.ts",
    description: "connector runtime should use the shared runtime safety helper",
    forbidden: [/CONNECTOR_RUNTIME_ALLOWED_ORIGINS/, /function\s+validate.*RuntimeEndpoint/, /new URL\(endpoint\)/]
  },
  {
    file: "services/orchestrator-api/src/trustedOAuthApplications.ts",
    description: "trusted OAuth binding should not use legacy seeded fake apps",
    forbidden: [/agents\.example\.com/, /salesforce-access-agent-client/, /const\s+trustedOAuthApplications\s*=/]
  },
  {
    file: "services/orchestrator-api/src/config/aiConfig.ts",
    description: "AI config should not support direct OpenAI provider selection",
    forbidden: [/OPENAI_API_KEY/, /OPENAI_MODEL/, /provider=openai/, /from\s+["']openai["']/]
  },
  {
    file: "services/orchestrator-api/src/requestInterpreter.ts",
    description: "request interpreter should not import direct OpenAI SDK",
    forbidden: [/OPENAI_API_KEY/, /OPENAI_MODEL/, /provider=openai/, /from\s+["']openai["']/]
  },
  {
    file: "services/orchestrator-api/src/aiRouter.ts",
    description: "AI router should not import direct OpenAI SDK",
    forbidden: [/OPENAI_API_KEY/, /OPENAI_MODEL/, /provider=openai/, /from\s+["']openai["']/]
  },
  {
    file: "services/orchestrator-api/src/followUpInterpreter.ts",
    description: "follow-up interpreter should not import direct OpenAI SDK",
    forbidden: [/OPENAI_API_KEY/, /OPENAI_MODEL/, /provider=openai/, /from\s+["']openai["']/]
  }
];

let failed = false;

for (const check of checks) {
  const content = readFileSync(check.file, "utf8");
  for (const pattern of check.forbidden) {
    if (pattern.test(content)) {
      console.error(`fail - ${check.description}: ${check.file} matched ${pattern}`);
      failed = true;
    }
  }
}

const routing = readFileSync("services/orchestrator-api/src/connectorRouting.ts", "utf8");
if (!routing.includes("referenceConnectorCatalog")) {
  console.error("fail - connectorRouting.ts should import referenceConnectorCatalog");
  failed = true;
}
if (!routing.includes("isConnectorRuntimeEndpointAllowed")) {
  console.error("fail - connectorRouting.ts should use shared runtime endpoint safety helper");
  failed = true;
}

const runtime = readFileSync("services/orchestrator-api/src/connectorRuntime.ts", "utf8");
if (!runtime.includes("validateConnectorRuntimeEndpoint")) {
  console.error("fail - connectorRuntime.ts should use shared runtime endpoint safety helper");
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Scale cleanliness verification passed.");
}
