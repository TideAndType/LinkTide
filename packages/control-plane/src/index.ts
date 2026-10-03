import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  qualifyOpportunities,
  type OpportunityCandidate,
  type QualifiedOpportunity
} from "@linktide/classifier";
import { generateDirectoryQueries } from "@linktide/discovery";
import { createLmStudioClient } from "@linktide/lm-studio";
import { searchBrave } from "@linktide/search";
import { generateVaultKey } from "@linktide/vault";

export type LinkTideSettings = {
  version: 1;
  lmStudioBaseUrl: string;
  lmStudioModel: string;
  lmStudioApiKey: string;
  braveSearchApiKey: string;
  vaultKey: string;
  searchMaxQueries: number;
  searchResultsPerQuery: number;
};

export type PublicSettings = {
  lmStudioBaseUrl: string;
  lmStudioModel: string;
  hasLmStudioApiKey: boolean;
  hasBraveSearchApiKey: boolean;
  searchMaxQueries: number;
  searchResultsPerQuery: number;
};

export type DiscoveryRequest = {
  name?: string;
  website?: string;
  primaryCategory?: string;
  niches?: string[];
  services?: string[];
  locations?: string[];
  description?: string;
};

export type SearchRequest = {
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

const fallbackDirectoryTypes = [
  "Local business directories",
  "Industry directories",
  "Professional associations",
  "Vendor and partner directories",
  "Chambers of commerce",
  "Resource pages"
];

function defaults(): LinkTideSettings {
  return {
    version: 1,
    lmStudioBaseUrl: process.env.LM_STUDIO_BASE_URL ?? "",
    lmStudioModel: process.env.LM_STUDIO_MODEL ?? "",
    lmStudioApiKey: process.env.LM_STUDIO_API_KEY ?? "",
    braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY ?? "",
    vaultKey: process.env.LINKTIDE_VAULT_KEY ?? generateVaultKey(),
    searchMaxQueries: Number(process.env.LINKTIDE_SEARCH_MAX_QUERIES ?? 8),
    searchResultsPerQuery: Number(
      process.env.LINKTIDE_SEARCH_RESULTS_PER_QUERY ?? 10
    )
  };
}

function settingsPath(dataDirectory: string) {
  return join(dataDirectory, "settings.json");
}

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

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function publicSettings(settings: LinkTideSettings): PublicSettings {
  return {
    lmStudioBaseUrl: settings.lmStudioBaseUrl,
    lmStudioModel: settings.lmStudioModel,
    hasLmStudioApiKey: Boolean(settings.lmStudioApiKey),
    hasBraveSearchApiKey: Boolean(settings.braveSearchApiKey),
    searchMaxQueries: settings.searchMaxQueries,
    searchResultsPerQuery: settings.searchResultsPerQuery
  };
}

export function applySettingsToEnv(settings: LinkTideSettings) {
  process.env.LM_STUDIO_BASE_URL = settings.lmStudioBaseUrl;
  process.env.LM_STUDIO_MODEL = settings.lmStudioModel;
  process.env.LM_STUDIO_API_KEY = settings.lmStudioApiKey;
  process.env.BRAVE_SEARCH_API_KEY = settings.braveSearchApiKey;
  process.env.LINKTIDE_VAULT_KEY = settings.vaultKey;
  process.env.LINKTIDE_SEARCH_MAX_QUERIES = String(settings.searchMaxQueries);
  process.env.LINKTIDE_SEARCH_RESULTS_PER_QUERY = String(
    settings.searchResultsPerQuery
  );
}

export async function loadSettings(dataDirectory: string) {
  const base = defaults();

  try {
    const raw = await readFile(settingsPath(dataDirectory), "utf8");
    const saved = JSON.parse(raw) as Partial<LinkTideSettings>;

    const settings: LinkTideSettings = {
      ...base,
      ...saved,
      version: 1,
      vaultKey: saved.vaultKey?.trim() || base.vaultKey,
      searchMaxQueries: clampInt(saved.searchMaxQueries, 8, 1, 25),
      searchResultsPerQuery: clampInt(
        saved.searchResultsPerQuery,
        10,
        1,
        20
      )
    };

    applySettingsToEnv(settings);
    return settings;
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: string }).code)
        : "";

    if (code !== "ENOENT") throw error;

    await saveSettings(dataDirectory, base);
    return base;
  }
}

export async function saveSettings(
  dataDirectory: string,
  settings: LinkTideSettings
) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(
    settingsPath(dataDirectory),
    JSON.stringify(settings, null, 2),
    { encoding: "utf8", mode: 0o600 }
  );
  applySettingsToEnv(settings);
  return settings;
}

export async function updateSettings(
  dataDirectory: string,
  input: Partial<{
    lmStudioBaseUrl: string;
    lmStudioModel: string;
    lmStudioApiKey: string;
    braveSearchApiKey: string;
    searchMaxQueries: number;
    searchResultsPerQuery: number;
  }>
) {
  const current = await loadSettings(dataDirectory);

  const next: LinkTideSettings = {
    ...current,
    lmStudioBaseUrl:
      typeof input.lmStudioBaseUrl === "string"
        ? input.lmStudioBaseUrl.trim()
        : current.lmStudioBaseUrl,
    lmStudioModel:
      typeof input.lmStudioModel === "string"
        ? input.lmStudioModel.trim()
        : current.lmStudioModel,
    lmStudioApiKey:
      typeof input.lmStudioApiKey === "string" && input.lmStudioApiKey.length
        ? input.lmStudioApiKey.trim()
        : current.lmStudioApiKey,
    braveSearchApiKey:
      typeof input.braveSearchApiKey === "string" &&
      input.braveSearchApiKey.length
        ? input.braveSearchApiKey.trim()
        : current.braveSearchApiKey,
    searchMaxQueries: clampInt(
      input.searchMaxQueries,
      current.searchMaxQueries,
      1,
      25
    ),
    searchResultsPerQuery: clampInt(
      input.searchResultsPerQuery,
      current.searchResultsPerQuery,
      1,
      20
    )
  };

  await saveSettings(dataDirectory, next);
  return publicSettings(next);
}

export async function getPublicSettings(dataDirectory: string) {
  return publicSettings(await loadSettings(dataDirectory));
}

export type LoadedLmStudioModel = {
  id: string;
  label: string;
  loadedInstances: number;
};

type NativeLmStudioModelsResponse = {
  models?: Array<{
    key?: string;
    display_name?: string;
    type?: string;
    loaded_instances?: unknown[];
  }>;
};

function nativeModelsUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  let path = url.pathname.replace(/\/+$/, "");
  path = path.replace(/\/v1$/i, "");
  url.pathname = `${path}/api/v1/models`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function listLoadedLmStudioModels(input?: {
  baseUrl?: string;
  apiKey?: string;
}) {
  const baseUrl =
    input?.baseUrl?.trim() ||
    process.env.LM_STUDIO_BASE_URL?.trim() ||
    "";

  if (!baseUrl) {
    return {
      status: 400,
      body: {
        configured: false,
        models: [] as LoadedLmStudioModel[],
        error: "Add your LM Studio tunnel URL first."
      }
    };
  }

  const apiKey =
    input?.apiKey?.trim() ||
    process.env.LM_STUDIO_API_KEY?.trim() ||
    "";

  try {
    const response = await fetch(nativeModelsUrl(baseUrl), {
      headers: {
        accept: "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      }
    });

    if (!response.ok) {
      const detail = await response.text();
      return {
        status: 502,
        body: {
          configured: true,
          models: [] as LoadedLmStudioModel[],
          error: `LM Studio model discovery failed: ${response.status} ${detail.slice(0, 180)}`
        }
      };
    }

    const payload = (await response.json()) as NativeLmStudioModelsResponse;
    const models = (payload.models ?? [])
      .filter(
        (model) =>
          model.type === "llm" &&
          Array.isArray(model.loaded_instances) &&
          model.loaded_instances.length > 0 &&
          typeof model.key === "string" &&
          model.key.trim()
      )
      .map((model) => ({
        id: model.key as string,
        label:
          typeof model.display_name === "string" && model.display_name.trim()
            ? model.display_name
            : (model.key as string),
        loadedInstances: model.loaded_instances?.length ?? 0
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      status: 200,
      body: {
        configured: true,
        models,
        count: models.length
      }
    };
  } catch (error) {
    return {
      status: 502,
      body: {
        configured: true,
        models: [] as LoadedLmStudioModel[],
        error:
          error instanceof Error
            ? error.message
            : "Could not reach LM Studio model discovery."
      }
    };
  }
}

function lmClient() {
  const baseUrl = process.env.LM_STUDIO_BASE_URL;
  const model = process.env.LM_STUDIO_MODEL;
  if (!baseUrl || !model) return undefined;

  return createLmStudioClient({
    baseUrl,
    model,
    apiKey: process.env.LM_STUDIO_API_KEY
  });
}

export async function testLmStudioConnection() {
  const client = lmClient();
  const model = process.env.LM_STUDIO_MODEL;

  if (!client || !model) {
    return {
      status: 400,
      body: {
        configured: false,
        error: "Add your LM Studio tunnel URL and model in LinkTide Settings."
      }
    };
  }

  try {
    const response = await client.chat([
      {
        role: "system",
        content: "Reply with exactly LINKTIDE_OK and nothing else."
      },
      { role: "user", content: "LinkTide connection test." }
    ]);

    if (!response.includes("LINKTIDE_OK")) {
      return {
        status: 502,
        body: {
          configured: true,
          error: `LM Studio responded unexpectedly: ${response.slice(0, 160)}`
        }
      };
    }

    let endpoint = "configured endpoint";
    try {
      endpoint = new URL(process.env.LM_STUDIO_BASE_URL ?? "").host;
    } catch {
      // Keep safe label.
    }

    return {
      status: 200,
      body: {
        configured: true,
        connected: true,
        model,
        endpoint
      }
    };
  } catch (error) {
    return {
      status: 502,
      body: {
        configured: true,
        error:
          error instanceof Error ? error.message : "LM Studio request failed."
      }
    };
  }
}

export async function createDiscoveryPlan(body: DiscoveryRequest) {
  const name = body.name?.trim();
  const website = body.website?.trim();
  const niches = cleanList(body.niches);
  const services = cleanList(body.services);
  const locations = cleanList(body.locations);

  if (!name || !website || (!niches.length && !services.length)) {
    return {
      status: 400,
      body: {
        error:
          "Business name, website, and at least one niche or service are required."
      }
    };
  }

  const baseQueries = generateDirectoryQueries({
    name,
    website,
    niches: niches.length ? niches : services,
    services,
    locations
  });

  const client = lmClient();
  if (!client) {
    return {
      status: 200,
      body: {
        aiUsed: false,
        additionalNiches: [],
        directoryTypes: fallbackDirectoryTypes,
        queries: [...new Set(baseQueries)].slice(0, 80)
      }
    };
  }

  try {
    const expansion = await client.json<{
      additionalNiches?: string[];
      directoryTypes?: string[];
      queries?: string[];
    }>([
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

    return {
      status: 200,
      body: {
        aiUsed: true,
        additionalNiches,
        directoryTypes: directoryTypes.length
          ? directoryTypes
          : fallbackDirectoryTypes,
        queries: [...new Set([...baseQueries, ...aiQueries])].slice(0, 100)
      }
    };
  } catch (error) {
    return {
      status: 200,
      body: {
        aiUsed: false,
        additionalNiches: [],
        directoryTypes: fallbackDirectoryTypes,
        queries: [...new Set(baseQueries)].slice(0, 80),
        aiWarning:
          error instanceof Error
            ? error.message
            : "LM Studio expansion failed; using rule-based discovery."
      }
    };
  }
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

function fallbackQualification(
  candidate: OpportunityCandidate
): QualifiedOpportunity {
  const haystack =
    `${candidate.title} ${candidate.description} ${candidate.url}`.toLowerCase();

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
    : "medium";

  return {
    ...candidate,
    opportunityType: "other",
    relevanceScore: likely ? 65 : 45,
    spamRisk,
    submissionLikely: likely,
    action: spamRisk === "high" ? "skip" : "review",
    reason:
      "LM Studio was unavailable, so LinkTide used a basic metadata fallback."
  };
}

export async function runDiscoverySearch(body: SearchRequest) {
  const braveApiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!braveApiKey) {
    return {
      status: 400,
      body: {
        configured: false,
        error: "Add your Brave Search API key in LinkTide Settings."
      }
    };
  }

  const business = body.business;
  const name = business?.name?.trim();
  const website = business?.website?.trim();
  const niches = cleanList(business?.niches, 25);
  const services = cleanList(business?.services, 40);
  const locations = cleanList(business?.locations, 40);
  const queries = cleanList(
    body.queries,
    clampInt(process.env.LINKTIDE_SEARCH_MAX_QUERIES, 8, 1, 25)
  );

  if (!name || !website || !queries.length) {
    return {
      status: 400,
      body: {
        error: "Business name, website, and at least one search query are required."
      }
    };
  }

  const perQuery = clampInt(
    process.env.LINKTIDE_SEARCH_RESULTS_PER_QUERY,
    10,
    1,
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

  const client = lmClient();
  let aiUsed = false;
  let opportunities: QualifiedOpportunity[];

  if (client && candidates.length) {
    try {
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

  return {
    status: 200,
    body: {
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
    }
  };
}
