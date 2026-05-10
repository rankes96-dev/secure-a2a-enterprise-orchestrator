import { readFileSync } from "node:fs";

const styles = readFileSync("apps/web-ui/src/styles.css", "utf8");
const webUi = readFileSync("apps/web-ui/src/main.tsx", "utf8");

let failed = false;

const requiredSections = [
  "Design tokens",
  "Base layout",
  "Typography",
  "Buttons",
  "Badges / status chips",
  "Cards / panels",
  "Forms / inputs",
  "Tabs / navigation",
  "Demo Guide",
  "Run Task",
  "Agent Registry",
  "Trust & Identity",
  "Security Timeline",
  "Responsive rules"
];

for (const section of requiredSections) {
  if (!styles.includes(section)) {
    console.error(`fail - styles.css missing design-system section: ${section}`);
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

for (const className of [".status-success", ".status-warning", ".status-danger", ".status-info", ".status-neutral"]) {
  if (!styles.includes(className)) {
    console.error(`fail - styles.css missing shared status class: ${className}`);
    failed = true;
  }
}

for (const phrase of ["Next Action", "Demo path", "Connector template", "Installed connector agent", "Technical details"]) {
  if (!webUi.includes(phrase)) {
    console.error(`fail - UI missing required phrase: ${phrase}`);
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("UI style verification passed.");
}
