import {
  qualifyOpportunities,
  type OpportunityCandidate,
  type QualifiedOpportunity
} from "@linktide/classifier";
import { createLmStudioClient } from "@linktide/lm-studio";
import { searchBrave } from "@linktide/search";

export const runtime = "nodejs";
export const maxDuration = 60;

type SearchRequest = {
  business?: {
    name?: string;
    website?: string;
    primaryCategory?: string;
    niches?: string[];
    services?: string[];
    locations?: string[];
  };
  queries?: string[];
};

function cleanList(values: unknown, max: number) {
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

function ownDomain(website: string) {
  try {
    return new URL(
      website.match(/^https?:\/\//i) ? website : `https://${website}`
    )
      .hostname.toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

function fallbackQualification(candidate: OpportunityCandidate): QualifiedOpportunity {
  const haystack = `${candidate.title} ${candidate.description} ${candidate.url}`.toLowerCase();

  const relevantTerms = [
    "directory",
    "business listing",
    "businesses",
    "chamber",
    "association",
    "members",
    "partners",
    "vendors",
    "agency",
    "companies",
    "professionals"
  ];

  const spamTerms = [
    "buy backlinks",
    "guest post marketplace",
    "link farm",
    "casino",
    "adult"
  ];

  const likely = relevantTerms.some((term) => haystack.includes(term));
  const spamRisk = spamTerms.some((term) => haystack.includes(term))
    ? "high"
    : likely
      ? "medium"
      : "medium";

  return {
    ...candidate,
    opportunityType: "other",
    relevanceScore: likely ? 65 : 45,
    spamRisk,
    submissionLikely: likely,
    action: spamRisk === "high" ? "skip" : likely ? "review" : "review",
    reason: "LM Studio was unavailable, so LinkTide used a basic metadata fallback."
  };
}

export async function POST(request: Request) {
  let body: SearchRequest;

  try {
    body = (await request.json()) as SearchRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const braveApiKey = process.env.BRAVE_SEARCH_API_KEY;

  if (!braveApiKey) {
    return Response.json(
      {
        configured: false,
        error:
          "BRAVE_SEARCH_API_KEY is missing. Add it to the dashboard environment before running live discovery."
      },
      { status: 400 }
    );
  }

  const business = body.business;
  const name = business?.name?.trim();
  const website = business?.website?.trim();
  const niches = cleanList(business?.niches, 25);
  const services = cleanList(business?.services, 40);
  const locations = cleanList(business?.locations, 40);
  const queries = cleanList(
    body.queries,
    Math.max(1, Number(process.env.LINKTIDE_SEARCH_MAX_QUERIES ?? 8))
  );

  if (!name || !website || !queries.length) {
    return Response.json(
      { error: "Business name, website, and at least one search query are required." },
      { status: 400 }
    );
  }

  const perQuery = Math.min(
    Math.max(
      Number(process.env.LINKTIDE_SEARCH_RESULTS_PER_QUERY ?? 10),
      1
    ),
    20
  );

  const searchResults = (
    await Promise.all(
      queries.map((query) =>
        searchBrave({
          apiKey: braveApiKey,
          query,
          count: perQuery,
          country: "US",
          searchLang: "en"
        })
      )
    )
  ).flat();

  const siteDomain = ownDomain(website);
  const seenDomains = new Set<string>();
  const candidates: OpportunityCandidate[] = [];

  for (const result of searchResults) {
    if (!result.domain || result.domain === siteDomain) continue;
    if (seenDomains.has(result.domain)) continue;

    seenDomains.add(result.domain);
    candidates.push(result);

    if (candidates.length >= 60) break;
  }

  const lmBaseUrl = process.env.LM_STUDIO_BASE_URL;
  const lmModel = process.env.LM_STUDIO_MODEL;
  let aiUsed = false;
  let opportunities: QualifiedOpportunity[];

  if (lmBaseUrl && lmModel && candidates.length) {
    try {
      const client = createLmStudioClient({
        baseUrl: lmBaseUrl,
        model: lmModel,
        apiKey: process.env.LM_STUDIO_API_KEY
      });

      opportunities = await qualifyOpportunities(
        client,
        {
          name,
          website,
          primaryCategory: business?.primaryCategory?.trim(),
          niches,
          services,
          locations
        },
        candidates
      );
      aiUsed = true;
    } catch {
      opportunities = candidates.map(fallbackQualification);
    }
  } else {
    opportunities = candidates.map(fallbackQualification);
  }

  opportunities.sort((a, b) => {
    const actionRank = { queue: 0, review: 1, skip: 2 };
    const actionDifference = actionRank[a.action] - actionRank[b.action];

    if (actionDifference !== 0) return actionDifference;
    return b.relevanceScore - a.relevanceScore;
  });

  return Response.json({
    configured: true,
    provider: "brave",
    aiUsed,
    searchesRun: queries.length,
    rawResults: searchResults.length,
    uniqueDomains: candidates.length,
    queued: opportunities.filter((item) => item.action === "queue").length,
    review: opportunities.filter((item) => item.action === "review").length,
    skipped: opportunities.filter((item) => item.action === "skip").length,
    opportunities
  });
}
