import { readFileSync } from "node:fs";

const runTask = readFileSync("apps/web-ui/src/components/run-task/RunTaskTab.tsx", "utf8");

let failed = false;

for (const phrase of [
  "function handleComposerKeyDown",
  'event.key === "Enter"',
  "!event.ctrlKey",
  "!event.shiftKey",
  "event.preventDefault()",
  "void resolveIssue(message)",
  "onKeyDown={handleComposerKeyDown}",
  "Press Enter to send",
  "Ctrl+Enter for a new line"
]) {
  if (!runTask.includes(phrase)) {
    console.error(`fail - chat keyboard behavior missing: ${phrase}`);
    failed = true;
  }
}

const handler = runTask.match(/function handleComposerKeyDown[\s\S]*?\n  \}/)?.[0] ?? "";
if (handler.includes("event.ctrlKey") && !handler.includes("!event.ctrlKey")) {
  console.error("fail - Ctrl+Enter should be allowed to insert a newline, not submit");
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Chat keyboard verification passed.");
}
