import { readFileSync } from "node:fs";

const runTask = readFileSync("apps/web-ui/src/components/run-task/RunTaskTab.tsx", "utf8");

let failed = false;

for (const phrase of [
  "function insertNewlineAtCursor",
  "function handleComposerKeyDown",
  'event.key !== "Enter"',
  "event.ctrlKey || event.metaKey",
  "event.shiftKey",
  "event.preventDefault()",
  "selectionStart",
  "selectionEnd",
  "setMessage(nextValue)",
  "requestAnimationFrame",
  "message.trim()",
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
if (!handler.includes("insertNewlineAtCursor(event.currentTarget, message)")) {
  console.error("fail - Ctrl+Enter should explicitly insert a newline at the cursor");
  failed = true;
}

if (handler.includes("event.ctrlKey") && handler.includes("void resolveIssue(message)") && handler.indexOf("event.ctrlKey") > handler.indexOf("void resolveIssue(message)")) {
  console.error("fail - Ctrl+Enter handling should occur before message submission");
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Chat keyboard verification passed.");
}
