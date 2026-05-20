import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { buildLocalConnectorPresets } from "../apps/web-ui/src/connectorPresets";

let failed = false;

const requiredFiles = [
  "apps/web-ui/src/components/demo-guide/DemoGuideTab.tsx",
  "apps/web-ui/src/components/run-task/RunTaskTab.tsx",
  "apps/web-ui/src/components/agent-registry/AgentRegistryTab.tsx",
  "apps/web-ui/src/components/connector-test-center/ConnectorTestCenterTab.tsx",
  "apps/web-ui/src/components/layout/PageHeader.tsx"
];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    console.error(`fail - expected extracted UI component is missing: ${file}`);
    failed = true;
  }
}

const main = readFileSync("apps/web-ui/src/main.tsx", "utf8");
for (const functionName of [
  "renderDemoGuideTab",
  "renderRunTaskTab",
  "renderAgentRegistryTab",
  "renderTrustIdentityTab",
  "renderSecurityTimelineTab"
]) {
  if (new RegExp(`function\\s+${functionName}\\b`).test(main)) {
    console.error(`fail - main.tsx should not contain large tab render function: ${functionName}`);
    failed = true;
  }
}

const mainLineCount = main.split(/\r?\n/).length;
if (mainLineCount > 3000) {
  console.error(`fail - main.tsx should stay focused after extraction, found ${mainLineCount} lines`);
  failed = true;
}

if (!main.includes("buildLocalConnectorPresets(import.meta.env)")) {
  console.error("fail - Agent Registry presets should be built from frontend env, not a localhost-only inline preset list");
  failed = true;
}

for (const hardcodedPresetSource of [
  'agentBaseUrl: "http://localhost:4201"',
  'agentBaseUrl: "http://localhost:4202"',
  'agentBaseUrl: "http://localhost:4203"',
  'label: "Use local Jira reference agent"',
  'label: "Use local ServiceNow reference agent"',
  'label: "Use local GitHub reference agent"'
]) {
  if (main.includes(hardcodedPresetSource)) {
    console.error(`fail - Agent Registry preset source should not be hardcoded in main.tsx: ${hardcodedPresetSource}`);
    failed = true;
  }
}

const localPresets = buildLocalConnectorPresets({});
if (localPresets[0].agentBaseUrl !== "http://localhost:4201" || localPresets[0].label !== "Use local Jira reference agent") {
  console.error("fail - local Agent Registry presets should fall back to localhost Jira");
  failed = true;
}

const productionPresets = buildLocalConnectorPresets({
  VITE_JIRA_AGENT_URL: "https://jira-external-agent-production.up.railway.app",
  VITE_SERVICENOW_AGENT_URL: "https://servicenow-external-agent-production.up.railway.app",
  VITE_GITHUB_AGENT_URL: "https://github-external-agent-production.up.railway.app"
});
for (const [label, expectedUrl, forbiddenLabel] of [
  ["Use Jira reference agent", "https://jira-external-agent-production.up.railway.app", "Use local Jira reference agent"],
  ["Use ServiceNow reference agent", "https://servicenow-external-agent-production.up.railway.app", "Use local ServiceNow reference agent"],
  ["Use GitHub reference agent", "https://github-external-agent-production.up.railway.app", "Use local GitHub reference agent"]
] as const) {
  const preset = productionPresets.find((item) => item.label === label);
  if (!preset || preset.agentBaseUrl !== expectedUrl) {
    console.error(`fail - production Agent Registry preset should use Railway URL ${expectedUrl}`);
    failed = true;
  }
  if (productionPresets.some((item) => item.label === forbiddenLabel)) {
    console.error(`fail - production Agent Registry preset label should not say local: ${forbiddenLabel}`);
    failed = true;
  }
}

for (const componentName of ["DemoGuideTab", "RunTaskTab", "AgentRegistryTab", "ConnectorTestCenterTab", "TrustIdentityTab", "SecurityTimelineTab"]) {
  if (!main.includes(`<${componentName} ctx={screenContext} />`)) {
    console.error(`fail - main.tsx should route to extracted component: ${componentName}`);
    failed = true;
  }
}

const agentRegistryTabPath = "apps/web-ui/src/components/agent-registry/AgentRegistryTab.tsx";
const agentRegistryTab = readFileSync(agentRegistryTabPath, "utf8");
for (const forbiddenAdminFallback of [
  "?? \"http://localhost:4201/admin\"",
  "?? 'http://localhost:4201/admin'",
  "|| \"http://localhost:4201/admin\"",
  "|| 'http://localhost:4201/admin'"
]) {
  if (agentRegistryTab.includes(forbiddenAdminFallback)) {
    console.error(`fail - Agent Registry must not hardcode localhost admin fallback: ${forbiddenAdminFallback}`);
    failed = true;
  }
}
if (!agentRegistryTab.includes("const adminConsoleUrl = zeroTrustDiscovery?.discovery.adminConsoleUrl;")) {
  console.error("fail - Agent Registry admin console URL should come directly from discovery");
  failed = true;
}
if (!agentRegistryTab.includes("adminConsoleUrl ?") || !agentRegistryTab.includes("Admin console is not advertised by this connector.")) {
  console.error("fail - Agent Registry admin console link should be conditional on discovery adminConsoleUrl with a muted fallback note");
  failed = true;
}

function componentFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      return componentFiles(fullPath);
    }
    return entry.isFile() && (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) ? [fullPath] : [];
  });
}

const componentsRoot = "apps/web-ui/src/components";
const forbiddenComponentTokens = [
  "@ts-nocheck",
  "Record<string, any>",
  "[key: string]: any",
  ": any",
  "as any",
  "anys",
  "loadanys",
  "FIXME_TEMP"
];

for (const file of componentFiles(componentsRoot)) {
  const content = readFileSync(file, "utf8");
  for (const token of forbiddenComponentTokens) {
    if (content.includes(token)) {
      console.error(`fail - extracted component contains forbidden placeholder/suppression token ${token}: ${file}`);
      failed = true;
    }
  }

  for (const match of content.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const importPath = match[1];
    const absoluteImport = resolve(dirname(file), importPath);
    const candidates = [
      absoluteImport,
      `${absoluteImport}.ts`,
      `${absoluteImport}.tsx`,
      join(absoluteImport, "index.ts"),
      join(absoluteImport, "index.tsx")
    ].map((candidate) => normalize(candidate));
    if (!candidates.some((candidate) => existsSync(candidate))) {
      console.error(`fail - extracted component imports missing local module ${importPath}: ${file}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("UI component structure verification passed.");
}
