import { applyConnectorPreset, isConnectorPresetName } from "./connectorPresetEnv.js";

const presetName = process.argv[2];
if (!isConnectorPresetName(presetName)) {
  console.error("Usage: tsx src/startConnector.ts <jira|servicenow|github>");
  process.exit(1);
}

try {
  applyConnectorPreset(presetName);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Connector preset/environment mismatch");
  process.exit(1);
}

await import("./index.js");
