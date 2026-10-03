import { generateDirectoryQueries } from "@linktide/discovery";
import { createLmStudioClient } from "@linktide/lm-studio";

export const runtime = "nodejs";

type DiscoveryRequest = {
  name?: string;
  website?: string;
  primaryCategory?: string;
  niches?: string[];
  services?: string[];
  locations?: string[];
  description?: string;
};

type AiExpansion = {
  additionalNiches?: string[];
  directoryTypes?: string[];
  queries?: string[];
};

const fallbackDirectoryTypes = [
  "Local business directories",
  "Industry directories",
  "Professional associations",
  "Vendor and partner directories",
  "Chambers of commerce",
  "Resource pages"
];

function cleanList(values: unknown, max = 40) {
  if (!Array.isArray(values)) return [];

  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ].slice(0, max);
}

export async function POST(request: Request) {
  let body: DiscoveryRequest;

  try {
    body = (await request.json()) as DiscoveryRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = body.name?.trim();
  const website = body.website?.trim();
  const niches = cleanList(body.niches);
  const services = cleanList(body.services);
  const locations = cleanList(body.locations);

  if (!name || !website || (!niches.length && !services.length)) {
    return Response.json(
      {
        error:
          "Business name, website, and at least one niche or service are required."
      },
      { status: 400 }
    );
  }

  const baseQueries = generateDirectoryQueries({
    name,
    website,
    niches: niches.length ? niches : services,
    services,
    locations
  });

  const baseUrl = process.env.LM_STUDIO_BASE_URL;
  const model = process.env.LM_STUDIO_MODEL;

  if (!baseUrl || !model) {
    return Response.json({
      aiUsed: false,
      additionalNiches: [],
      directoryTypes: fallbackDirectoryTypes,
      queries: [...new Set(baseQueries)].slice(0, 80)
    });
  }

  try {
    const client = createLmStudioClient({
      baseUrl,
      model,
      apiKey: process.env.LM_STUDIO_API_KEY
    });

    const expansion = await client.json<AiExpansion>([
      {
        role: "system",
        content:
          "You are the discovery planner inside LinkTide. Expand a business profile into legitimate backlink and citation opportunity searches. Focus on niche directories, local citations, professional associations, chambers, partner/vendor directories, resource pages, and relevant organization listings. Avoid mass link schemes, private blog networks, generic spam directories, paid link schemes, and searches intended to manipulate rankings. Return JSON only with keys additionalNiches, directoryTypes, and queries. Keep queries practical for web search."
      },
      {
        role: "user",
        content: JSON.stringify({
          business: name,
          website,
          primaryCategory: body.primaryCategory ?? "",
          niches,
          services,
          locations,
          description: body.description ?? ""
        })
      }
    ]);

    const aiQueries = cleanList(expansion.queries, 50);
    const additionalNiches = cleanList(expansion.additionalNiches, 20);
    const directoryTypes = cleanList(expansion.directoryTypes, 20);

    return Response.json({
      aiUsed: true,
      additionalNiches,
      directoryTypes: directoryTypes.length
        ? directoryTypes
        : fallbackDirectoryTypes,
      queries: [...new Set([...baseQueries, ...aiQueries])].slice(0, 100)
    });
  } catch (error) {
    return Response.json({
      aiUsed: false,
      additionalNiches: [],
      directoryTypes: fallbackDirectoryTypes,
      queries: [...new Set(baseQueries)].slice(0, 80),
      aiWarning:
        error instanceof Error
          ? error.message
          : "LM Studio expansion failed; using rule-based discovery."
    });
  }
}
