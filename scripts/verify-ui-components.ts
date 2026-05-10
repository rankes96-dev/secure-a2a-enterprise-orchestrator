import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";

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

function componentFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      return componentFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith(".tsx") ? [fullPath] : [];
  });
}

const componentsRoot = "apps/web-ui/src/components";
const forbiddenComponentTokens = [
  "@ts-nocheck",
  "Record<string, any>",
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
