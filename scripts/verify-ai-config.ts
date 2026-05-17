import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const API_URL = process.env.ORCHESTRATOR_API_URL ?? "http://127.0.0.1:4000";
const repoRoot = process.cwd();
const disallowedProvider = "open" + "ai";
const disallowedKey = ["OPENAI", "API_KEY"].join("_");
const disallowedModel = ["OPENAI", "MODEL"].join("_");

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) as unknown : {};
}

function asRecord(value: unknown): Record<string, unknown> {
  assertCondition(typeof value === "object" && value !== null && !Array.isArray(value), `Expected object, got ${JSON.stringify(value)}`);
  return value as Record<string, unknown>;
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        return [];
      }
      return walkFiles(fullPath);
    }
    return [fullPath];
  }));
  return files.flat();
}

async function assertNoOrchestratorDirectProviderSourceReferences(): Promise<void> {
  const sourceRoots = [
    path.join(repoRoot, "services", "orchestrator-api", "src"),
    path.join(repoRoot, "packages", "shared", "src")
  ];
  const files = (await Promise.all(sourceRoots.map(walkFiles))).flat().filter((file) => /\.(ts|tsx)$/.test(file));
  const forbidden = [
    new RegExp(`from\\s+["']${disallowedProvider}["']`),
    new RegExp(disallowedKey),
    new RegExp(disallowedModel),
    new RegExp(`provider=${disallowedProvider}`),
    new RegExp(`"${disallowedProvider}"\\s*\\|`),
    new RegExp(`\\|\\s*"${disallowedProvider}"`),
    new RegExp(`callOpen${"Ai"}`)
  ];

  for (const file of files) {
    const text = await readFile(file, "utf8");
    const found = forbidden.find((pattern) => pattern.test(text));
    if (found) {
      throw new Error(`forbidden direct provider reference ${found} in ${path.relative(repoRoot, file)}`);
    }
  }
}

async function main(): Promise<void> {
  console.info(`Verifying AI config diagnostics against ${API_URL}`);

  const sessionResponse = await fetch(`${API_URL}/session`, { method: "POST" });
  const sessionBody = await readJson(sessionResponse);
  assertCondition(sessionResponse.ok, `session failed: ${JSON.stringify(sessionBody)}`);
  const cookie = sessionResponse.headers.get("set-cookie")?.split(";")[0];
  assertCondition(cookie, "session cookie missing");

  const debugResponse = await fetch(`${API_URL}/debug/ai-config`, {
    headers: { cookie }
  });
  const debugBody = await readJson(debugResponse);
  assertCondition(debugResponse.ok, `debug ai config failed: ${JSON.stringify(debugBody)}`);
  const summary = asRecord(debugBody);

  assertCondition(summary.provider === "openrouter", `provider should be openrouter: ${JSON.stringify(summary)}`);
  assertCondition(summary.expectedKeyName === "OPENROUTER_API_KEY", `expectedKeyName should be OPENROUTER_API_KEY: ${JSON.stringify(summary)}`);
  assertCondition(summary.envFileHint === "services/orchestrator-api/.env", `envFileHint mismatch: ${JSON.stringify(summary)}`);
  assertCondition(typeof summary.model === "string" && summary.model.length > 0, `model missing: ${JSON.stringify(summary)}`);
  assertCondition(typeof summary.hasApiKey === "boolean", `hasApiKey should be boolean: ${JSON.stringify(summary)}`);
  assertCondition(!JSON.stringify(summary).includes(disallowedKey), "debug response should not mention the removed direct provider key");

  await assertNoOrchestratorDirectProviderSourceReferences();
  console.info("AI config verification passed.");
}

main().catch((error) => {
  console.error(`fail - ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
