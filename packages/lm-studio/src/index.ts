export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LmStudioConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
};

/** Accept a server origin, /v1 base, or full compatible endpoint URL. */
export function openAiBaseUrl(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error("Enter the LM Studio server URL.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a complete LM Studio URL, such as http://127.0.0.1:1234/v1.");
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("The LM Studio URL must be HTTP(S), without embedded credentials.");
  }
  url.search = "";
  url.hash = "";

  let path = url.pathname.replace(/\/+$/, "");
  if (/\/api\/v1\/models$/i.test(path)) {
    path = path.replace(/\/api\/v1\/models$/i, "");
  } else if (/\/v1\/(?:models|chat\/completions)$/i.test(path)) {
    path = path.replace(/\/v1\/(?:models|chat\/completions)$/i, "/v1");
  }
  if (!/\/v1$/i.test(path)) path += "/v1";
  url.pathname = path || "/v1";
  return url.toString().replace(/\/$/, "");
}

export function lmStudioEndpoint(baseUrl: string, endpoint: "models" | "chat/completions") {
  return openAiBaseUrl(baseUrl) + "/" + endpoint;
}

function errorBody(text: string) {
  // Cloudflare may return an HTML login/challenge page; avoid showing HTML.
  const html = /<!doctype|<html|<head|<body/i.test(text);
  return html ? "The endpoint returned an HTML page instead of JSON (check tunnel access)." :
    text.replace(/[\r\n\t]+/g, " ").slice(0, 250);
}

export function createLmStudioClient(config: LmStudioConfig) {
  const chatUrl = lmStudioEndpoint(config.baseUrl, "chat/completions");

  async function chat(messages: ChatMessage[]) {
    let response: Response;
    try {
      response = await fetch(chatUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.apiKey ? { authorization: "Bearer " + config.apiKey } : {})
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: 0.2,
          stream: false
        }),
        // Local models can take time to load, especially on first request.
        signal: AbortSignal.timeout(120_000)
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Network request failed";
      throw new Error("Cannot reach LM Studio chat at " + new URL(chatUrl).host +
        ": " + detail + ". Check that the LM Studio server is running and the URL/tunnel is reachable.");
    }

    if (!response.ok) {
      const detail = errorBody(await response.text());
      const hint = response.status === 401 || response.status === 403
        ? " Check LM Studio API token or Cloudflare tunnel access."
        : response.status === 404
          ? " Check your LM Studio URL; the chat endpoint should end in /v1/chat/completions."
          : "";
      throw new Error("LM Studio chat returned HTTP " + response.status +
        ": " + detail + hint);
    }

    let payload: {
      choices?: Array<{ message?: { content?: string | null } }>;
      error?: { message?: string };
    };
    try {
      payload = await response.json();
    } catch {
      throw new Error("LM Studio chat returned a non-JSON response. Check the tunnel target.");
    }

    const content = payload.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new Error(payload.error?.message ??
        "LM Studio returned no assistant text. Check that the selected model supports chat.");
    }
    return content;
  }

  async function json<T>(messages: ChatMessage[]): Promise<T> {
    const raw = await chat(messages);
    const fenced = raw.match(/\x60{3}(?:json)?\s*([\s\S]*?)\x60{3}/i);
    const candidate = fenced?.[1] ?? raw;
    const firstBrace = candidate.indexOf("{");
    const firstBracket = candidate.indexOf("[");
    const start = firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket);
    if (start === -1) throw new Error("Model did not return JSON.");
    return JSON.parse(candidate.slice(start)) as T;
  }

  return { chat, json };
}
