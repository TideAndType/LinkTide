import "dotenv/config";
import { createLmStudioClient } from "@linktide/lm-studio";
import { generateDirectoryQueries } from "@linktide/discovery";

const command = process.argv[2] ?? "doctor";

async function main() {
  if (command === "doctor") {
    const baseUrl = process.env.LM_STUDIO_BASE_URL;
    const model = process.env.LM_STUDIO_MODEL;

    console.log("LinkTide worker");
    console.log("LM Studio URL:", baseUrl ? "configured" : "missing");
    console.log("LM Studio model:", model ?? "missing");

    if (!baseUrl || !model) {
      process.exitCode = 1;
      return;
    }

    const client = createLmStudioClient({
      baseUrl,
      model,
      apiKey: process.env.LM_STUDIO_API_KEY
    });

    const result = await client.chat([
      { role: "system", content: "Reply with exactly: LINKTIDE_OK" },
      { role: "user", content: "Connection test." }
    ]);

    console.log("LM Studio response:", result.trim());
    return;
  }

  if (command === "sample-queries") {
    console.log(generateDirectoryQueries({
      name: "Example Business",
      website: "https://example.com",
      niches: ["web design", "SEO"],
      locations: ["Florida"]
    }).join("\n"));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
