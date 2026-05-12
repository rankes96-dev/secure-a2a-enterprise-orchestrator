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
  "V1 demo path",
  "Connector template",
  "Installed connector agent",
  "Technical details",
  "Connector Test Center",
  "External Agent Admin",
  "AI can interpret the request, but only the Gateway can approve execution",
  "AI interprets, but Gateway approves execution",
  "Prompt injection cannot grant scopes, permissions, or Gateway approval",
  "Governed Runtime Chat",
  "Execution Gate Stack",
  "Gateway Governance",
  "OAuth Scope Gate",
  "Service Account Permission Gate",
  "Runtime Execution",
  "Adversarial prompts",
  "Return the raw runtime token",
  "Bypass Gateway policy",
  "NOT EVALUATED",
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

const chatComposerBlock = styles.match(/\.chat-composer\s*\{[\s\S]*?\}/)?.[0] ?? "";
if (/position:\s*(sticky|fixed)/.test(chatComposerBlock)) {
  console.error("fail - .chat-composer must not be sticky or fixed");
  failed = true;
}

const statusStripBlocks = [...styles.matchAll(/\.cockpit-status-strip\s*\{[\s\S]*?\}/g)].map((match) => match[0]);
if (!styles.includes("repeat(4, minmax(0, 1fr))")) {
  console.error("fail - Run Task status cards should use a stable four-column desktop grid");
  failed = true;
}

const recommendationBlock = styles.match(/\.composer-recommendation\s*\{[\s\S]*?\}/g)?.at(-1) ?? "";
if (!recommendationBlock.includes("grid-template-columns: minmax(0, 1fr) auto")) {
  console.error("fail - composer recommendation strip should not reserve a blank action block");
  failed = true;
}

const finalRunTaskStatusBlock = styles.match(/\.chat-first-cockpit\s+\.cockpit-status-strip\s*\{[\s\S]*?\}/)?.[0] ?? "";
if (!styles.includes(".chat-first-cockpit:not(.end-user-run-task) .cockpit-status-strip")) {
  console.error("fail - Run Task status grid should be scoped to technical mode");
  failed = true;
}

const finalRunTaskStatusCardBlock = styles.match(/\.chat-first-cockpit:not\(\.end-user-run-task\)\s+\.cockpit-status-strip\s+article\s*\{[\s\S]*?\}/)?.[0] ?? "";
for (const phrase of ["width: 100%", "min-height: 76px", "padding: 14px"]) {
  if (!finalRunTaskStatusCardBlock.includes(phrase)) {
    console.error(`fail - Run Task status cards need consistent compact styling: ${phrase}`);
    failed = true;
  }
}

const technicalStatusGridBlock = styles.match(/\.chat-first-cockpit:not\(\.end-user-run-task\)\s+\.cockpit-status-strip\s*\{[\s\S]*?\}/)?.[0] ?? "";
if (!technicalStatusGridBlock.includes("repeat(4, minmax(0, 1fr))")) {
  console.error("fail - technical Run Task status cards should use a stable four-column desktop grid");
  failed = true;
}

if (!styles.includes("@media (max-width: 900px)") || !styles.includes("repeat(auto-fit, minmax(180px, 1fr))")) {
  console.error("fail - technical Run Task status cards should collapse responsively");
  failed = true;
}

const finalRecommendationBlock = styles.match(/\.chat-first-cockpit\s+\.composer-recommendation\s*\{[\s\S]*?\}/)?.[0] ?? "";
const finalRecommendationButtonBlock = styles.match(/\.chat-first-cockpit\s+\.composer-recommendation\s+\.secondary-inline-button\s*\{[\s\S]*?\}/)?.[0] ?? "";
for (const phrase of ["border: 1px solid var(--border)", "background: var(--surface-soft)", "grid-template-columns: minmax(0, 1fr) auto"]) {
  if (!finalRecommendationBlock.includes(phrase)) {
    console.error(`fail - recommendation strip should render as a complete visible strip: ${phrase}`);
    failed = true;
  }
}
for (const phrase of ["min-width: 108px", "background: var(--surface)", "border: 1px solid var(--border)"]) {
  if (!finalRecommendationButtonBlock.includes(phrase)) {
    console.error(`fail - recommendation action button should be visible at rest: ${phrase}`);
    failed = true;
  }
}

const chatPanelHeaderBlock = styles.match(/\.chat-panel-header\s*\{[\s\S]*?\}/)?.[0] ?? "";
for (const phrase of ["display: flex", "justify-content: space-between", "padding: 14px 16px"]) {
  if (!chatPanelHeaderBlock.includes(phrase)) {
    console.error(`fail - Run Task should have an in-panel conversation header: ${phrase}`);
    failed = true;
  }
}

for (const phrase of [
  ".persona-modal-backdrop",
  ".end-user-shell.control-plane-shell",
  ".end-user-run-task .chat-runtime-layout",
  ".end-user-run-task .task-transcript",
  ".task-transcript-empty",
  ".end-user-proof-drawer",
  ".technical-proof-modal-backdrop",
  ".technical-proof-modal",
  ".technical-proof-modal .governance-proof-panel"
]) {
  if (!styles.includes(phrase)) {
    console.error(`fail - persona/end-user layout style missing: ${phrase}`);
    failed = true;
  }
}

const transcriptEmptyBlock = styles.match(/\.task-transcript-empty\s*\{[\s\S]*?\}/)?.[0] ?? "";
for (const phrase of ["display: grid", "place-items: center", "min-height: 180px", "text-align: center"]) {
  if (!transcriptEmptyBlock.includes(phrase)) {
    console.error(`fail - transcript empty state should be subtle and centered: ${phrase}`);
    failed = true;
  }
}

const transcriptEmptyCombined = [
  transcriptEmptyBlock,
  styles.match(/\.task-transcript-empty\s+h3\s*\{[\s\S]*?\}/)?.[0] ?? "",
  styles.match(/\.task-transcript-empty\s+p\s*\{[\s\S]*?\}/)?.[0] ?? ""
].join("\n");

for (const forbidden of ["textarea", "input", "composer-surface", "border:"]) {
  if (transcriptEmptyCombined.includes(forbidden)) {
    console.error(`fail - transcript empty state should not use input-like styling: ${forbidden}`);
    failed = true;
  }
}

const technicalProofModalBlock = styles.match(/\.technical-proof-modal\s*\{[\s\S]*?\}/)?.[0] ?? "";
for (const phrase of ["width: min(960px", "max-height: 80vh", "overflow-y: auto"]) {
  if (!technicalProofModalBlock.includes(phrase)) {
    console.error(`fail - end-user technical proof should open in a usable modal: ${phrase}`);
    failed = true;
  }
}

const proofModalPanelBlock = styles.match(/\.technical-proof-modal\s+\.governance-proof-panel\s*\{[\s\S]*?\}/)?.[0] ?? "";
if (!proofModalPanelBlock.includes("grid-template-columns: 1fr")) {
  console.error("fail - proof modal should use a single-column layout, not narrow inline cards");
  failed = true;
}

const registrySectionPaddingBlock = styles.match(/\.agent-registry-panel\s*>\s*\.registry-section,[\s\S]*?\.agent-registry-panel\s+\.registry-overview-section\s+\.registry-section\s*\{[\s\S]*?\}/)?.[0] ?? "";
if (!registrySectionPaddingBlock.includes("padding: 18px")) {
  console.error("fail - Agent Registry sections should have at least 18px padding");
  failed = true;
}

const registryHeadingSpacingBlock = styles.match(/\.agent-registry-panel\s+\.section-heading-row,[\s\S]*?\.zero-trust-onboarding-panel\s+\.section-heading-row\s*\{[\s\S]*?\}/)?.[0] ?? "";
if (!registryHeadingSpacingBlock.includes("margin-bottom: 8px")) {
  console.error("fail - Agent Registry section headings should have bottom spacing");
  failed = true;
}

const connectorCatalogBlocks = [...styles.matchAll(/\.connector-preset-grid\s*\{[\s\S]*?\}/g)].map((match) => match[0]);
if (connectorCatalogBlocks.length === 0) {
  console.error("fail - Connector Catalog grid styles are missing");
  failed = true;
}
for (const block of connectorCatalogBlocks) {
  if (/grid-template-columns:\s*repeat\((3|4),\s*minmax\(0,\s*1fr\)\)/.test(block)) {
    console.error("fail - Connector Catalog must not use a fixed 3/4-column grid that can overflow");
    failed = true;
  }
  if (/overflow-x:\s*auto/.test(block)) {
    console.error("fail - Connector Catalog should not render as a clipped horizontal carousel");
    failed = true;
  }
}

const connectorCatalogBlock = connectorCatalogBlocks.at(0) ?? "";
for (const phrase of [
  "grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr))",
  "max-width: 100%",
  "min-width: 0",
  "align-items: start"
]) {
  if (!connectorCatalogBlock.includes(phrase)) {
    console.error(`fail - Connector Catalog needs responsive non-overflow grid styling: ${phrase}`);
    failed = true;
  }
}

const connectorCardBlock = styles.match(/\.connector-preset-card\s*\{[\s\S]*?\}/)?.[0] ?? "";
for (const phrase of ["min-width: 0", "max-width: 100%", "overflow: hidden"]) {
  if (!connectorCardBlock.includes(phrase)) {
    console.error(`fail - Connector template cards must be bounded inside the catalog grid: ${phrase}`);
    failed = true;
  }
}

const connectorActionButtonBlock = styles.match(/\.connector-card-actions\s+\.scenario-run,[\s\S]*?\.connector-card-actions\s+\.compact-button\s*\{[\s\S]*?\}/)?.[0] ?? "";
for (const phrase of ["width: auto", "height: auto", "flex: 0 1 auto", "border-radius: 8px", "white-space: normal"]) {
  if (!connectorActionButtonBlock.includes(phrase)) {
    console.error(`fail - Connector card actions should remain normal responsive buttons: ${phrase}`);
    failed = true;
  }
}
if (/^\s*width:\s*100%/m.test(connectorActionButtonBlock) || /aspect-ratio:\s*1/.test(connectorActionButtonBlock)) {
  console.error("fail - Connector card actions must not use full-width or square/circle button sizing");
  failed = true;
}

const connectorFactsBlock = styles.match(/\.connector-template-facts\s*\{[\s\S]*?\}/)?.[0] ?? "";
const connectorFactItemBlock = styles.match(/\.connector-template-facts\s+span\s*\{[\s\S]*?\}/)?.[0] ?? "";
if (!connectorFactsBlock.includes("repeat(auto-fit, minmax(180px, 1fr))")) {
  console.error("fail - Connector template summary facts should use a compact responsive layout");
  failed = true;
}
for (const phrase of ["min-height: 0", "padding: 6px 8px", "line-height: 1.3", "overflow-wrap: break-word"]) {
  if (!connectorFactItemBlock.includes(phrase)) {
    console.error(`fail - Connector template summary facts should be compact and readable: ${phrase}`);
    failed = true;
  }
}

const templateDetailsBlock = styles.match(/\.template-details\s*\{[\s\S]*?\}/)?.[0] ?? "";
const templateDetailsRowBlock = styles.match(/\.template-details\s+>\s+div\s*\{[\s\S]*?\}/)?.[0] ?? "";
if (!templateDetailsBlock.includes("grid-template-columns: 1fr")) {
  console.error("fail - Template details should render as full-width key-value rows");
  failed = true;
}
if (!templateDetailsRowBlock.includes("minmax(150px, 190px) minmax(0, 1fr)")) {
  console.error("fail - Template details rows should use readable label/value columns");
  failed = true;
}
if (/word-break:\s*break-all/.test(templateDetailsBlock) || /word-break:\s*break-all/.test(templateDetailsRowBlock)) {
  console.error("fail - Template details must not force break-all wrapping");
  failed = true;
}

const topbarBlocks = [...styles.matchAll(/\.topbar\s*\{[\s\S]*?\}/g)].map((match) => match[0]);
if (topbarBlocks.some((block) => /position:\s*(sticky|fixed)/.test(block))) {
  console.error("fail - .topbar must not be sticky or fixed");
  failed = true;
}

const finalComposerOverride = styles.match(/\.chat-first-cockpit\s+\.chat-composer\s*\{[\s\S]*?\}/)?.[0] ?? "";
for (const phrase of ["position: static", "bottom: auto", "z-index: auto"]) {
  if (!finalComposerOverride.includes(phrase)) {
    console.error(`fail - missing final chat composer override: ${phrase}`);
    failed = true;
  }
}

const finalTopbarOverride = styles.match(/\.control-plane-shell\s+\.topbar\s*\{[\s\S]*?\}/g)?.at(-1) ?? "";
for (const phrase of ["position: static", "top: auto", "z-index: auto"]) {
  if (!finalTopbarOverride.includes(phrase)) {
    console.error(`fail - missing final topbar override: ${phrase}`);
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("UI style verification passed.");
}
