import { existsSync, readFileSync } from "node:fs";

let failed = false;

const requiredFiles = [
  "apps/web-ui/src/components/demo-guide/DemoGuideTab.tsx",
  "apps/web-ui/src/components/run-task/RunTaskTab.tsx",
  "apps/web-ui/src/components/agent-registry/AgentRegistryTab.tsx",
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

for (const componentName of ["DemoGuideTab", "RunTaskTab", "AgentRegistryTab", "TrustIdentityTab", "SecurityTimelineTab"]) {
  if (!main.includes(`<${componentName} ctx={screenContext} />`)) {
    console.error(`fail - main.tsx should route to extracted component: ${componentName}`);
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("UI component structure verification passed.");
}
