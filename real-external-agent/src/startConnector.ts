import { applyConnectorPreset, isConnectorPresetName } from "./connectorPresetEnv.js";

const presetName = process.argv[2];
if (!isConnectorPresetName(presetName)) {
  console.error("Usage: tsx src/startConnector.ts <jira|servicenow|github>");
  process.exit(1);
}

applyConnectorPreset(presetName);

await import("./index.js");
