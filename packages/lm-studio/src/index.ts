export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LmStudioConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
};

function normalizeBaseUrl(value: string) {
  return value.replace(/\/$/, "");
}

export function createLmStudioClient(config: LmStudioConfig) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  async function chat(messages: ChatMessage[]) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2
      })
    });

    if (!response.ok) {
      throw new Error(`LM Studio request failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("LM Studio returned an empty response.");
    return content;
  }

  async function json<T>(messages: ChatMessage[]): Promise<T> {
    const raw = await chat(messages);
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1] ?? raw;
    const firstBrace = candidate.indexOf("{");
    const firstBracket = candidate.indexOf("[");
    const start = firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket);
    if (start === -1) throw new Error("Model did not return JSON.");
    return JSON.parse(candidate.slice(start)) as T;
  }

  return { chat, json };
}
