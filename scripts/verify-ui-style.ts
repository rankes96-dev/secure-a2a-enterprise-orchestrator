import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const styles = readFileSync("apps/web-ui/src/styles.css", "utf8");

function readTsxTree(path: string): string {
  return readdirSync(path, { withFileTypes: true }).map((entry) => {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      return readTsxTree(fullPath);
    }
    return entry.isFile() && entry.name.endsWith(".tsx") ? readFileSync(fullPath, "utf8") : "";
  }).join("\n");
}

const webUi = [
  readFileSync("apps/web-ui/src/main.tsx", "utf8"),
  readTsxTree("apps/web-ui/src/components")
].join("\n");

let failed = false;

const requiredSections = [
  "Design tokens",
  "Base layout",
  "Typography",
  "Primitives",
  "Buttons",
  "Badges / status chips",
  "Forms / inputs",
  "Tabs / navigation",
  "Demo Guide",
  "Run Task",
  "Agent Registry",
  "Trust & Identity",
  "Security Timeline",
  "Responsive rules"
];

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

for (const [index, section] of requiredSections.entries()) {
  const matches = [...styles.matchAll(new RegExp(`^\\s*${escapedRegExp(section)}\\s*$`, "gm"))];
  if (matches.length !== 1) {
    console.error(`fail - styles.css should include design-system section exactly once: ${section} (found ${matches.length})`);
    failed = true;
    continue;
  }

  const nextSection = requiredSections[index + 1];
  if (nextSection) {
    const nextMatches = [...styles.matchAll(new RegExp(`^\\s*${escapedRegExp(nextSection)}\\s*$`, "gm"))];
    if (nextMatches.length === 1 && (matches[0].index ?? 0) > (nextMatches[0].index ?? 0)) {
      console.error(`fail - styles.css section order is wrong: ${section} should appear before ${nextSection}`);
      failed = true;
    }
  }
}

const requiredPrimitives = [
  ".app-shell",
  ".page",
  ".page-header",
  ".section",
  ".stack",
  ".cluster",
  ".grid-auto",
  ".grid-two",
  ".grid-three",
  ".card",
  ".card-muted",
  ".card-elevated",
  ".card-warning",
  ".card-danger",
  ".card-info",
  ".btn",
  ".btn-primary",
  ".btn-secondary",
  ".btn-tertiary",
  ".btn-danger",
  ".btn-compact",
  ".badge",
  ".badge-success",
  ".badge-warning",
  ".badge-danger",
  ".badge-info",
  ".badge-neutral",
  ".metric-card",
  ".metric-grid",
  ".truncate",
  ".monospace",
  ".hash-value",
  ".endpoint-value"
];

for (const primitive of requiredPrimitives) {
  if (!styles.includes(primitive)) {
    console.error(`fail - styles.css missing reusable primitive: ${primitive}`);
    failed = true;
  }
}

const forbiddenStyleTokens = [
  "rgba(31, 49, 82",
  "rgba(12, 20, 36",
  "rgba(16, 27, 48",
  "#bfd1f0",
  "#b1c2de",
  "#9fb5d9",
  "color: #befdd4",
  "background: rgba(28, 88, 60"
];

for (const token of forbiddenStyleTokens) {
  if (styles.includes(token)) {
    console.error(`fail - styles.css still contains dark/glass leftover: ${token}`);
    failed = true;
  }
}

const rootBlock = styles.match(/:root\s*\{[\s\S]*?\}/)?.[0] ?? "";
const stylesOutsideRoot = styles.replace(rootBlock, "");
const legacyColors = [
  "#172026",
  "#253d47",
  "#384b53",
  "#526b76",
  "#235789",
  "#14213d",
  "#d7e0e4",
  "#dbe3e8",
  "#c7d2d8",
  "#fbfcfd",
  "#f8fafb"
];

for (const color of legacyColors) {
  const count = (stylesOutsideRoot.match(new RegExp(escapedRegExp(color), "g")) ?? []).length;
  if (count > 0) {
    console.error(`fail - legacy hardcoded color should use tokens outside :root: ${color} (${count})`);
    failed = true;
  }
}

for (const className of [".status-success", ".status-warning", ".status-danger", ".status-info", ".status-neutral"]) {
  if (!styles.includes(className)) {
    console.error(`fail - styles.css missing shared status class: ${className}`);
    failed = true;
  }
}

for (const phrase of [
  "Next Action",
  "Demo path",
  "Connector template",
  "Installed connector agent",
  "Technical details",
  "Connector Test Center",
  "External Agent Admin",
  "AI can interpret the request, but only the Gateway can approve execution",
  "Suggested prompts",
  "Ask about Jira, ServiceNow, GitHub",
  "Installed agents:",
  "Runtime ready:"
]) {
  if (!webUi.includes(phrase)) {
    console.error(`fail - UI missing required phrase: ${phrase}`);
    failed = true;
  }
}

if (!webUi.includes("control-sidebar")) {
  console.error("fail - product shell should include persistent sidebar navigation");
  failed = true;
}

if (/<nav\s+className=["']product-tabs["']/.test(webUi)) {
  console.error("fail - old product tabs should not be the primary visible navigation when sidebar exists");
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("UI style verification passed.");
}
