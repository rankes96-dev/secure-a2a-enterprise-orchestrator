import { readFileSync } from "node:fs";

let failed = false;

function fail(message: string) {
  console.error(`fail - ${message}`);
  failed = true;
}

function requireIncludes(source: string, phrase: string, label: string) {
  if (!source.includes(phrase)) {
    fail(`${label} should include: ${phrase}`);
  }
}

const demoGuide = readFileSync("apps/web-ui/src/components/demo-guide/DemoGuideTab.tsx", "utf8");
const securityTimeline = readFileSync("apps/web-ui/src/components/security-timeline/SecurityTimelineTab.tsx", "utf8");
const combined = `${demoGuide}\n${securityTimeline}`;

for (const phrase of [
  "End user",
  "BizApps / IT",
  "Security / Audit",
  "V1 demo path",
  "Install a connector agent",
  "Run the end-user access planning flow",
  "View security proof",
  "Connector Test Center",
  "connector-published tests",
  "If the target system is clear",
  "routes to the matching installed connector",
  "If the request is unclear",
  "asks a simple follow-up",
  "Direct route example",
  "Clarification example"
]) {
  requireIncludes(demoGuide, phrase, "Demo Guide");
}

if (demoGuide.includes("User selects an installed system.")) {
  fail("Demo Guide should not present target selection as a mandatory story step");
}

for (const phrase of [
  "Security proof summary",
  "Actor",
  "Outcome",
  "Gate stopped at",
  "Token issued",
  "Runtime executed",
  "Raw tokens exposed",
  "Security intent detected",
  "Run a task to populate security proof",
  "Open Run Task",
  "Open Connector Test Center",
  "Identity",
  "AI / interpretation",
  "Gateway decision",
  "OAuth scope gate",
  "Service-account permission gate",
  "Token / runtime",
  "Audit result"
]) {
  requireIncludes(securityTimeline, phrase, "Security Timeline");
}

for (const forbidden of ["access_token", "client_secret", "private_key"]) {
  if (combined.toLowerCase().includes(forbidden)) {
    fail(`Demo readiness sections should not expose secret marker: ${forbidden}`);
  }
}

const rawTokenMatches = combined.toLowerCase().match(/raw token(?!s exposed)/g) ?? [];
if (rawTokenMatches.length > 0) {
  fail("Demo readiness sections should only mention raw tokens in the proof field label");
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Demo readiness verification passed.");
}
