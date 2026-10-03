import type { createLmStudioClient } from "@linktide/lm-studio";

type LmClient = ReturnType<typeof createLmStudioClient>;

export type OpportunityCandidate = {
  id: string;
  title: string;
  url: string;
  domain: string;
  description: string;
  query: string;
};

export type OpportunityQualification = {
  id: string;
  opportunityType:
    | "local_citation"
    | "industry_directory"
    | "association"
    | "partner_directory"
    | "resource_page"
    | "sponsorship"
    | "other";
  relevanceScore: number;
  spamRisk: "low" | "medium" | "high";
  submissionLikely: boolean;
  action: "queue" | "review" | "skip";
  reason: string;
};

export type QualifiedOpportunity = OpportunityCandidate &
  Omit<OpportunityQualification, "id">;

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

function normalizeQualification(
  candidate: OpportunityCandidate,
  value: Partial<OpportunityQualification> | undefined
): QualifiedOpportunity {
  const score =
    typeof value?.relevanceScore === "number"
      ? Math.max(0, Math.min(100, Math.round(value.relevanceScore)))
      : 50;

  const allowedTypes = new Set([
    "local_citation",
    "industry_directory",
    "association",
    "partner_directory",
    "resource_page",
    "sponsorship",
    "other"
  ]);

  const allowedRisks = new Set(["low", "medium", "high"]);
  const allowedActions = new Set(["queue", "review", "skip"]);

  return {
    ...candidate,
    opportunityType: allowedTypes.has(value?.opportunityType ?? "")
      ? (value?.opportunityType as QualifiedOpportunity["opportunityType"])
      : "other",
    relevanceScore: score,
    spamRisk: allowedRisks.has(value?.spamRisk ?? "")
      ? (value?.spamRisk as QualifiedOpportunity["spamRisk"])
      : "medium",
    submissionLikely: Boolean(value?.submissionLikely),
    action: allowedActions.has(value?.action ?? "")
      ? (value?.action as QualifiedOpportunity["action"])
      : "review",
    reason: typeof value?.reason === "string" ? value.reason.slice(0, 320) : "Needs review."
  };
}

export async function qualifyOpportunities(
  client: LmClient,
  business: {
    name: string;
    website: string;
    primaryCategory?: string;
    niches: string[];
    services: string[];
    locations: string[];
  },
  candidates: OpportunityCandidate[]
) {
  const results: QualifiedOpportunity[] = [];

  for (const batch of chunks(candidates, 18)) {
    const response = await client.json<{
      items?: OpportunityQualification[];
    }>([
      {
        role: "system",
        content:
          "You are LinkTide's backlink opportunity qualifier. Review search-result metadata and decide whether each result is a legitimate, relevant place where this business may earn or create a citation/backlink. Prefer real local directories, niche/industry directories, chambers, professional associations, vendor/partner directories, credible resource pages, and relevant sponsorship listings. Mark obvious scraper sites, link farms, PBNs, unrelated pages, generic SEO spam directories, and paid-link schemes as skip. A queue action means the site is worth inspecting for an actual submission path; it does NOT mean a submission should happen blindly. Return JSON only as {\"items\":[...]}. Preserve every candidate id exactly. relevanceScore must be 0-100."
      },
      {
        role: "user",
        content: JSON.stringify({
          business,
          candidates: batch
        })
      }
    ]);

    const byId = new Map(
      (response.items ?? []).map((item) => [item.id, item] as const)
    );

    for (const candidate of batch) {
      results.push(normalizeQualification(candidate, byId.get(candidate.id)));
    }
  }

  return results;
}
