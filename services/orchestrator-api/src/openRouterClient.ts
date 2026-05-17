export type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenRouterChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

export async function callOpenRouterJson(params: {
  apiKey: string;
  baseURL: string;
  model: string;
  messages: OpenRouterMessage[];
}): Promise<string | undefined> {
  const response = await fetch(`${params.baseURL.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      response_format: { type: "json_object" },
      stream: false,
      temperature: 0
    })
  });

  if (!response.ok) {
    const body = await response.text();
    const detail = body.trim().slice(0, 240) || response.statusText;
    throw new Error(`OpenRouter request failed with HTTP ${response.status}: ${detail}`);
  }

  const result = (await response.json()) as OpenRouterChatResponse;
  const content = result.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : undefined;
}
