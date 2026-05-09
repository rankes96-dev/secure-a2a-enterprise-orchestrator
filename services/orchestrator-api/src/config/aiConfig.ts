export type AiProvider = "openrouter";

export interface AiConfig {
  provider: AiProvider;
  apiKey?: string;
  hasApiKey: boolean;
  model: string;
  baseURL: string;
}

export interface SafeAiConfigSummary {
  provider: AiProvider;
  model: string;
  hasApiKey: boolean;
  expectedKeyName: "OPENROUTER_API_KEY";
  envFileHint: "services/orchestrator-api/.env";
}

export function getAiConfig(): AiConfig {
  if (process.env.AI_PROVIDER?.trim()) {
    console.warn("AI_PROVIDER is ignored; OpenRouter is the only supported provider.");
  }

  const apiKey = process.env.OPENROUTER_API_KEY;

  return {
    provider: "openrouter",
    apiKey,
    hasApiKey: Boolean(apiKey?.trim()),
    model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
  };
}

export function getSafeAiConfigSummary(): SafeAiConfigSummary {
  const config = getAiConfig();
  return {
    provider: config.provider,
    model: config.model,
    hasApiKey: config.hasApiKey,
    expectedKeyName: "OPENROUTER_API_KEY",
    envFileHint: "services/orchestrator-api/.env"
  };
}
