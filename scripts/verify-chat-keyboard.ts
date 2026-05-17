import { readFileSync } from "node:fs";

const runTask = readFileSync("apps/web-ui/src/components/run-task/RunTaskTab.tsx", "utf8");

let failed = false;

for (const phrase of [
  "function insertNewlineAtCursor",
  "function submitComposerMessage",
  "function handleComposerSubmit",
  "function handleComposerKeyDown",
  'event.key !== "Enter"',
  "event.ctrlKey || event.metaKey",
  "event.shiftKey",
  "event.preventDefault()",
  "selectionStart",
  "selectionEnd",
  "setMessage(nextValue)",
  "requestAnimationFrame",
  "currentMessage.trim()",
  "void resolveIssue(currentMessage)",
  'setMessage("")',
  "onSubmit={handleComposerSubmit}",
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

if (!handler.includes("submitComposerMessage()")) {
  console.error("fail - Enter should submit through submitComposerMessage");
  failed = true;
}

const submitHelper = runTask.match(/function submitComposerMessage[\s\S]*?function handleComposerSubmit/)?.[0] ?? "";
if (submitHelper.indexOf("void resolveIssue(currentMessage)") > submitHelper.indexOf('setMessage("")')) {
  console.error("fail - submitComposerMessage should clear the textarea after submitting");
  failed = true;
}

if (submitHelper.indexOf("if (!currentMessage.trim())") > submitHelper.indexOf("void resolveIssue(currentMessage)")) {
  console.error("fail - whitespace-only messages should not be sent");
  failed = true;
}

if (handler.includes("event.ctrlKey") && handler.includes("submitComposerMessage()") && handler.indexOf("event.ctrlKey") > handler.indexOf("submitComposerMessage()")) {
  console.error("fail - Ctrl+Enter handling should occur before message submission");
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Chat keyboard verification passed.");
}
