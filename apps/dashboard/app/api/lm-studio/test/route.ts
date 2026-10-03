import { createLmStudioClient } from "@linktide/lm-studio";

export const runtime = "nodejs";

function endpointLabel(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return "configured endpoint";
  }
}

export async function POST() {
  const baseUrl = process.env.LM_STUDIO_BASE_URL;
  const model = process.env.LM_STUDIO_MODEL;

  if (!baseUrl || !model) {
    return Response.json(
      {
        configured: false,
        error:
          "LM_STUDIO_BASE_URL and LM_STUDIO_MODEL must be set in the dashboard environment."
      },
      { status: 400 }
    );
  }

  try {
    const client = createLmStudioClient({
      baseUrl,
      model,
      apiKey: process.env.LM_STUDIO_API_KEY
    });

    const response = await client.chat([
      {
        role: "system",
        content: "Reply with exactly LINKTIDE_OK and nothing else."
      },
      { role: "user", content: "LinkTide connection test." }
    ]);

    if (!response.includes("LINKTIDE_OK")) {
      return Response.json(
        {
          configured: true,
          error: `LM Studio responded, but the health check was unexpected: ${response.slice(0, 160)}`
        },
        { status: 502 }
      );
    }

    return Response.json({
      configured: true,
      connected: true,
      model,
      endpoint: endpointLabel(baseUrl)
    });
  } catch (error) {
    return Response.json(
      {
        configured: true,
        error: error instanceof Error ? error.message : "LM Studio request failed."
      },
      { status: 502 }
    );
  }
}
