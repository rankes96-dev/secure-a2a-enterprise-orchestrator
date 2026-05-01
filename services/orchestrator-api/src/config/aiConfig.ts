export type AiProvider = "openrouter" | "openai";

export interface AiConfig {
  provider: AiProvider;
  apiKey?: string;
  hasApiKey: boolean;
  model: string;
  baseURL?: string;
}

function readProvider(): AiProvider {
  return process.env.AI_PROVIDER === "openai" ? "openai" : "openrouter";
}

export function getAiConfig(): AiConfig {
  const provider = readProvider();

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;

    return {
      provider,
      apiKey,
      hasApiKey: Boolean(apiKey?.trim()),
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini"
    };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;

  return {
    provider,
    apiKey,
    hasApiKey: Boolean(apiKey?.trim()),
    model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    baseURL: "https://openrouter.ai/api/v1"
  };
}
