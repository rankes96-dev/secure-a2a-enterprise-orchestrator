import { existsSync, readFileSync } from "node:fs";

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
    description: "connector routing should use the local demo intent catalog, not inline connector metadata",
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
if (!routing.includes("localReferenceConnectorIntentCatalog")) {
  console.error("fail - connectorRouting.ts should import localReferenceConnectorIntentCatalog");
  failed = true;
}
if (!routing.includes("isConnectorRuntimeEndpointAllowed")) {
  console.error("fail - connectorRouting.ts should use shared runtime endpoint safety helper");
  failed = true;
}

const runtime = readFileSync("services/orchestrator-api/src/connectorRuntime.ts", "utf8");
if (!runtime.includes("validateTrustedConnectorRuntimeEndpoint")) {
  console.error("fail - connectorRuntime.ts should use shared runtime endpoint safety helper");
  failed = true;
}
if (!runtime.includes("trustedRuntimeEndpoint")) {
  console.error("fail - connectorRuntime.ts should validate against connectorRoute.trustedRuntimeEndpoint");
  failed = true;
}

const connectorTypes = readFileSync("services/orchestrator-api/src/connectors/types.ts", "utf8");
if (!/declaredSkills:\s*string\[\]/.test(connectorTypes) || !/declaredActions\?:\s*string\[\]/.test(connectorTypes)) {
  console.error("fail - ConnectorDecisionInput should require declaredSkills and keep declaredActions optional as compatibility alias");
  failed = true;
}

const agentOnboarding = readFileSync("services/orchestrator-api/src/agentOnboarding.ts", "utf8").trim();
if (agentOnboarding !== 'export * from "./agentOnboarding/index";') {
  console.error("fail - agentOnboarding.ts should be a compatibility re-export only");
  failed = true;
}

for (const modulePath of [
  "services/orchestrator-api/src/agentOnboarding/types.ts",
  "services/orchestrator-api/src/agentOnboarding/requestValidation.ts",
  "services/orchestrator-api/src/agentOnboarding/discovery.ts",
  "services/orchestrator-api/src/agentOnboarding/trustResponseVerifier.ts",
  "services/orchestrator-api/src/agentOnboarding/connectorProfileFetcher.ts",
  "services/orchestrator-api/src/agentOnboarding/trustedAgentStore.ts",
  "services/orchestrator-api/src/agentOnboarding/responseMapper.ts",
  "services/orchestrator-api/src/agentOnboarding/onboardingService.ts",
  "services/orchestrator-api/src/agentOnboarding/index.ts"
]) {
  if (!existsSync(modulePath)) {
    console.error(`fail - expected modular onboarding file is missing: ${modulePath}`);
    failed = true;
  }
}

const runtimeSafety = readFileSync("services/orchestrator-api/src/security/connectorRuntimeSafety.ts", "utf8");
if (!runtimeSafety.includes('const localReferenceRuntimePath = "/a2a/task"')) {
  console.error("fail - connectorRuntimeSafety should enforce the local /a2a/task runtime path");
  failed = true;
}

const requestValidation = readFileSync("services/orchestrator-api/src/agentOnboarding/requestValidation.ts", "utf8");
if (!requestValidation.includes("localReferenceConnectors")) {
  console.error("fail - onboarding request validation should import local reference connector guardrails");
  failed = true;
}
if (/http:\/\/localhost:420[123]/.test(requestValidation)) {
  console.error("fail - local demo connector URLs should live in localReferenceConnectors.ts, not requestValidation.ts");
  failed = true;
}

const adminConfig = readFileSync("real-external-agent/src/adminConfig.ts", "utf8");
if (/type\s+CapabilityDeclarationConfig/.test(adminConfig)) {
  console.error("fail - adminConfig.ts should use SkillDeclarationConfig, with capabilities only as compatibility fields");
  failed = true;
}

const externalIndex = readFileSync("real-external-agent/src/index.ts", "utf8");
if (!externalIndex.includes('request.url === "/admin/skill-declaration"')) {
  console.error("fail - real-external-agent should expose /admin/skill-declaration");
  failed = true;
}
if (!externalIndex.includes('request.url === "/admin/capability-declaration"')) {
  console.error("fail - real-external-agent should keep /admin/capability-declaration compatibility alias");
  failed = true;
}

const adminPage = readFileSync("real-external-agent/src/adminPage.ts", "utf8");
if (!adminPage.includes('post("/admin/skill-declaration"')) {
  console.error("fail - admin UI should prefer /admin/skill-declaration");
  failed = true;
}

const externalVerifyAgent = readFileSync("real-external-agent/src/verify-agent.ts", "utf8");
if (!externalVerifyAgent.includes("public connector profile exposed demoDefaults")) {
  console.error("fail - real-external-agent verification should assert public connector profile does not expose demoDefaults");
  failed = true;
}

const readme = readFileSync("README.md", "utf8");
for (const phrase of ["Connector Catalog", "Installed Connectors", "Custom Connector SDK", "zero installed connectors"]) {
  if (!readme.includes(phrase)) {
    console.error(`fail - README should describe product model phrase: ${phrase}`);
    failed = true;
  }
}

const webUi = readFileSync("apps/web-ui/src/main.tsx", "utf8");
const webUiStyles = readFileSync("apps/web-ui/src/styles.css", "utf8");
for (const phrase of ["Connector Catalog", "Installed Connector Agents", "Custom Connector SDK"]) {
  if (!webUi.includes(phrase)) {
    console.error(`fail - Agent Registry UI should include: ${phrase}`);
    failed = true;
  }
}
for (const phrase of ["Work Management", "ITSM", "DevOps", "Finish and view Installed Connector Agents", "Legacy Internal Demo Agents"]) {
  if (!webUi.includes(phrase)) {
    console.error(`fail - Agent Registry UI should include polish phrase: ${phrase}`);
    failed = true;
  }
}
for (const phrase of [
  "Connector templates:",
  "Installed connector agents:",
  "Runtime ready:",
  "Needs re-verification:",
  "selectedInstalledConnectorTemplateId",
  "Showing installed agents for",
  "Clear filter",
  "Multiple external agents can be installed from the same connector template",
  "Start manual connection",
  "Advanced / legacy demo only",
  "Choose a connector template from the catalog, or start a manual connection",
  "Connect another external agent",
  "View installed agents",
  "Not installed",
  "Installed agents:",
  "Show verification details",
  "Legacy internal mock agents are retained only for old demo flows"
]) {
  if (!webUi.includes(phrase)) {
    console.error(`fail - Agent Registry UI should include demo-readiness phrase: ${phrase}`);
    failed = true;
  }
}
for (const phrase of [
  "Installed Connector Agents",
  "installed agent",
  "installedAgentMatchesTemplate",
  "No approved runtime scenario available",
  "View Connector Catalog",
  "Finish and view Installed Connector Agents",
  "View Installed Connector Agents",
  "setSelectedInstalledConnectorTemplateId(undefined)"
]) {
  if (!webUi.includes(phrase)) {
    console.error(`fail - Agent Registry UI should include final wording phrase: ${phrase}`);
    failed = true;
  }
}
for (const phrase of ["Runtime ready", "Needs re-verification", "Runtime blocked"]) {
  if (!webUi.includes(phrase)) {
    console.error(`fail - Installed Connector Agents UI should include lifecycle term: ${phrase}`);
    failed = true;
  }
}
if (!/function\s+scenarioForApprovedSkill[\s\S]*agent\.approvedActions\s*\?\?\s*agent\.approvedCapabilities/.test(webUi)) {
  console.error("fail - runMatchingScenario should choose scenarios from approvedActions/approvedCapabilities");
  failed = true;
}
for (const phrase of [
  "Demo Readiness",
  "Recommended Demo Flow",
  "What this proves",
  "Raw tokens hidden",
  "Scoped A2A JWT",
  "External config hash",
  "Go to Connector Catalog",
  "Go to Installed Connector Agents"
]) {
  if (!webUi.includes(phrase)) {
    console.error(`fail - Demo Readiness UI should include phrase: ${phrase}`);
    failed = true;
  }
}
if (/reference connectors are installed by default/i.test(webUi) || /automatically trusted/i.test(webUi)) {
  console.error("fail - UI should not imply reference connectors are installed or trusted by default");
  failed = true;
}
if (/template\.category\s*\?\?\s*["']Custom["']/.test(webUi)) {
  console.error("fail - UI should not default missing connector template category to Custom");
  failed = true;
}
for (const token of ["--page-bg", "--surface", "--text", "--primary", "--success-bg", "--warning-bg", "--danger-bg", "--info-bg"]) {
  if (!webUiStyles.includes(token)) {
    console.error(`fail - light enterprise UI theme should define token: ${token}`);
    failed = true;
  }
}
for (const darkToken of [
  "radial-gradient(circle at top left, #1d2842",
  "#080c18",
  "#bfd1f0",
  "rgba(12, 20, 36, 0.72)"
]) {
  if (webUiStyles.includes(darkToken)) {
    console.error(`fail - light enterprise UI theme should not include dark/glass leftover: ${darkToken}`);
    failed = true;
  }
}

const localReferenceConnectors = readFileSync("services/orchestrator-api/src/connectors/localReferenceConnectors.ts", "utf8");
for (const field of ["category", "publisher", "authModel", "runtimeSupport", "riskLevel", "tags", "setupRequirements"]) {
  if (!localReferenceConnectors.includes(`${field}:`)) {
    console.error(`fail - ConnectorTemplate should include metadata field: ${field}`);
    failed = true;
  }
}

for (const requiredFile of [
  "services/orchestrator-api/src/audit/auditEvents.ts",
  "services/orchestrator-api/src/audit/types.ts",
  "services/orchestrator-api/src/policy/connectorPolicy.ts",
  "services/orchestrator-api/src/connectors/installedConnectorLifecycle.ts"
]) {
  if (!existsSync(requiredFile)) {
    console.error(`fail - expected product-model file is missing: ${requiredFile}`);
    failed = true;
  }
}

const auditEvents = readFileSync("services/orchestrator-api/src/audit/auditEvents.ts", "utf8");
const auditEventValues = [...auditEvents.matchAll(/:\s*"([^"]+)"/g)].map((match) => match[1]);
for (const eventName of auditEventValues) {
  if (eventName.includes("_")) {
    console.error(`fail - audit event value should not include underscores: ${eventName}`);
    failed = true;
  }
}

const connectorPolicy = readFileSync("services/orchestrator-api/src/policy/connectorPolicy.ts", "utf8");
if (connectorPolicy.includes("Default connector policy allowed this approved diagnostic skill")) {
  console.error("fail - generic connector policy allow wording should not say diagnostic skill");
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Scale cleanliness verification passed.");
}
