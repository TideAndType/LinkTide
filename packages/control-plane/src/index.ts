import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  qualifyOpportunities,
  type OpportunityCandidate,
  type QualifiedOpportunity
} from "@linktide/classifier";
import { generateDirectoryQueries } from "@linktide/discovery";
import { createLmStudioClient, lmStudioEndpoint, openAiBaseUrl } from "@linktide/lm-studio";
import { directoryCatalogResults, importedDirectoryResults, searchGoogleVisibleForm, searchHeadlessChromium, type SearchResult } from "@linktide/search";
import { generateVaultKey } from "@linktide/vault";

export type LinkTideSettings = {
  version: 1;
  lmStudioBaseUrl: string;
  lmStudioModel: string;
  lmStudioApiKey: string;
  vaultKey: string;
  searchMaxQueries: number;
  searchResultsPerQuery: number;
};

export type PublicSettings = {
  lmStudioBaseUrl: string;
  lmStudioModel: string;
  hasLmStudioApiKey: boolean;
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
  source?: "catalog" | "chromium" | "google-form";
  manualUrls?: string[];
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
    searchMaxQueries: settings.searchMaxQueries,
    searchResultsPerQuery: settings.searchResultsPerQuery
  };
}

export function applySettingsToEnv(settings: LinkTideSettings) {
  process.env.LM_STUDIO_BASE_URL = settings.lmStudioBaseUrl;
  process.env.LM_STUDIO_MODEL = settings.lmStudioModel;
  process.env.LM_STUDIO_API_KEY = settings.lmStudioApiKey;
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

    // Preserve previous LM Studio settings and the vault key while dropping
    // the legacy paid search credential from future saved settings.
    const settings: LinkTideSettings = {
      ...base,
      lmStudioBaseUrl: typeof saved.lmStudioBaseUrl === "string"
        ? saved.lmStudioBaseUrl : base.lmStudioBaseUrl,
      lmStudioModel: typeof saved.lmStudioModel === "string"
        ? saved.lmStudioModel : base.lmStudioModel,
      lmStudioApiKey: typeof saved.lmStudioApiKey === "string"
        ? saved.lmStudioApiKey : base.lmStudioApiKey,
      vaultKey: saved.vaultKey?.trim() || base.vaultKey,
      searchMaxQueries: clampInt(saved.searchMaxQueries, 8, 1, 10),
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
    searchMaxQueries: clampInt(
      input.searchMaxQueries,
      current.searchMaxQueries,
      1,
      10
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

type CompatibleModelsResponse = {
  data?: Array<{ id?: string; type?: string }>;
};

function nativeModelsUrl(baseUrl: string) {
  return openAiBaseUrl(baseUrl).replace(/\/v1$/i, "/api/v1/models");
}

function safeResponseDetail(raw: string) {
  return /<!doctype|<html|<head|<body/i.test(raw)
    ? "HTML response received; check Cloudflare tunnel access or proxy routing."
    : raw.replace(/[\r\n\t]+/g, " ").slice(0, 180);
}

function normalizeCompatibleModels(payload: CompatibleModelsResponse): LoadedLmStudioModel[] {
  const models = Array.isArray(payload.data) ? payload.data : [];
  const seen = new Set<string>();
  return models
    .filter((model) =>
      typeof model.id === "string" &&
      model.id.trim() &&
      !/embedding|text-embed|rerank/i.test(model.type ?? model.id ?? "")
    )
    .filter((model) => {
      const id = model.id as string;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((model) => ({
      id: model.id as string,
      label: model.id as string,
      // The compatible API exposes available models, not loaded-instance counts.
      loadedInstances: 0
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function normalizeNativeModels(payload: NativeLmStudioModelsResponse): LoadedLmStudioModel[] {
  return (Array.isArray(payload.models) ? payload.models : [])
    .filter((model) =>
      model.type === "llm" &&
      typeof model.key === "string" &&
      model.key.trim()
    )
    .map((model) => ({
      id: model.key as string,
      label: model.display_name?.trim() || (model.key as string),
      loadedInstances: Array.isArray(model.loaded_instances) ? model.loaded_instances.length : 0
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Prefer OpenAI-compatible discovery, which Cloudflare tunnels commonly expose. */
export async function listLoadedLmStudioModels(input?: {
  baseUrl?: string;
  apiKey?: string;
}) {
  const baseUrl = input?.baseUrl?.trim() || process.env.LM_STUDIO_BASE_URL?.trim() || "";
  if (!baseUrl) {
    return {
      status: 400,
      body: {
        configured: false,
        models: [] as LoadedLmStudioModel[],
        error: "Enter the LM Studio server URL, e.g. http://127.0.0.1:1234/v1."
      }
    };
  }

  const apiKey = input?.apiKey?.trim() || process.env.LM_STUDIO_API_KEY?.trim() || "";
  const headers = {
    accept: "application/json",
    ...(apiKey ? { authorization: "Bearer " + apiKey } : {})
  };

  try {
    const compatibleUrl = lmStudioEndpoint(baseUrl, "models");
    const response = await fetch(compatibleUrl, {
      headers,
      signal: AbortSignal.timeout(15_000)
    });
    if (response.ok) {
      let payload: CompatibleModelsResponse;
      try {
        payload = await response.json() as CompatibleModelsResponse;
      } catch {
        throw new Error("LM Studio /v1/models returned invalid JSON; the tunnel may serve an HTML page.");
      }
      const models = normalizeCompatibleModels(payload);
      return { status: 200, body: { configured: true, models, count: models.length, source: "openai-compatible" } };
    }

    // Older/mixed configurations may expose only the native LM Studio API.
    if (response.status === 404) {
      const native = await fetch(nativeModelsUrl(baseUrl), {
        headers, signal: AbortSignal.timeout(15_000)
      });
      if (native.ok) {
        const payload = await native.json() as NativeLmStudioModelsResponse;
        const models = normalizeNativeModels(payload);
        return { status: 200, body: { configured: true, models, count: models.length, source: "native" } };
      }
      return {
        status: 502,
        body: {
          configured: true,
          models: [] as LoadedLmStudioModel[],
          error: "Neither /v1/models nor /api/v1/models is reachable (HTTP " + native.status +
            "). Confirm the LM Studio server URL and tunnel routing."
        }
      };
    }

    const detail = safeResponseDetail(await response.text());
    const hint = response.status === 401 || response.status === 403
      ? " Check the LM Studio API token or Cloudflare Access protection."
      : "";
    return {
      status: 502,
      body: {
        configured: true,
        models: [] as LoadedLmStudioModel[],
        error: "LM Studio model detection returned HTTP " + response.status + ": " + detail + hint
      }
    };
  } catch (error) {
    return {
      status: 502,
      body: {
        configured: true,
        models: [] as LoadedLmStudioModel[],
        error: "Could not reach LM Studio: " + (error instanceof Error ? error.message : "Network error") +
          ". Verify the Developer API server is running and the URL is reachable."
      }
    };
  }
}

function lmClient(input?: { baseUrl?: string; model?: string; apiKey?: string }) {
  const baseUrl = input?.baseUrl?.trim() || process.env.LM_STUDIO_BASE_URL?.trim();
  const model = input?.model?.trim() || process.env.LM_STUDIO_MODEL?.trim();
  if (!baseUrl || !model) return undefined;

  return createLmStudioClient({
    baseUrl,
    model,
    apiKey: input?.apiKey?.trim() || process.env.LM_STUDIO_API_KEY
  });
}

export async function testLmStudioConnection(input?: {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}) {
  const baseUrl = input?.baseUrl?.trim() || process.env.LM_STUDIO_BASE_URL?.trim() || "";
  const model = input?.model?.trim() || process.env.LM_STUDIO_MODEL?.trim() || "";
  if (!baseUrl || !model) {
    return {
      status: 400,
      body: {
        configured: false,
        error: "Enter your LM Studio URL and select a model before testing."
      }
    };
  }

  try {
    const client = lmClient(input);
    if (!client) throw new Error("An LM Studio URL and model are required.");
    const response = await client.chat([
      { role: "system", content: "Reply with exactly LINKTIDE_OK and nothing else." },
      { role: "user", content: "LinkTide connection test." }
    ]);

    return {
      status: 200,
      body: {
        configured: true,
        connected: true,
        model,
        endpoint: new URL(openAiBaseUrl(baseUrl)).host,
        // A model response proves the connection even if the model ignores
        // the precise probe instruction. It should be a warning, not a failure.
        warning: response.includes("LINKTIDE_OK")
          ? undefined
          : "Connected and received model output, but the model did not return the exact test phrase."
      }
    };
  } catch (error) {
    return {
      status: 502,
      body: {
        configured: true,
        error: error instanceof Error ? error.message : "LM Studio request failed."
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
  const business = body.business;
  const name = business?.name?.trim();
  const website = business?.website?.trim();
  const niches = cleanList(business?.niches, 25);
  const services = cleanList(business?.services, 40);
  const locations = cleanList(business?.locations, 40);
  const queries = cleanList(
    body.queries,
    clampInt(process.env.LINKTIDE_SEARCH_MAX_QUERIES, 8, 1, 10)
  );

  if (!name || !website) {
    return {
      status: 400,
      body: { error: "Business name and website are required." }
    };
  }

  const perQuery = clampInt(
    process.env.LINKTIDE_SEARCH_RESULTS_PER_QUERY, 10, 1, 20
  );
  const manualUrls = Array.isArray(body.manualUrls)
    ? body.manualUrls.filter((url): url is string => typeof url === "string")
        .map((url) => url.trim()).filter(Boolean).slice(0, 100)
    : [];

  let provider: "catalog" | "chromium" | "google-form" | "manual" = "catalog";
  let warning: string | undefined;
  let searchResults: { results: SearchResult[]; searchesRun: number };

  if (manualUrls.length) {
    const results = importedDirectoryResults(manualUrls);
    if (!results.length) {
      return { status: 400, body: {
        error: "No valid public HTTP(S) directory URLs were supplied."
      } };
    }
    provider = "manual";
    searchResults = { results, searchesRun: 0 };
  } else if (body.source === "google-form" && queries.length) {
    // The visible browser performs one real search-form submission per click.
    // A blocked/challenged search cannot be used to trigger automated retries.
    try {
      searchResults = await searchGoogleVisibleForm({
        query: queries[0],
        count: perQuery
      });
      provider = "google-form";
    } catch (error) {
      warning = "Google visible search could not complete (" +
        (error instanceof Error ? error.message : "unknown issue") +
        "). Showing the directory starter list instead. " +
        "No search restrictions or verification challenges were bypassed.";
      provider = "catalog";
      searchResults = {
        results: directoryCatalogResults({
          primaryCategory: business?.primaryCategory, niches, services
        }),
        searchesRun: 0
      };
    }
  } else if (body.source === "chromium" && queries.length) {
    try {
      searchResults = await searchHeadlessChromium({
        queries,
        count: perQuery,
        delayMs: clampInt(process.env.LINKTIDE_SEARCH_DELAY_MS, 2500, 1500, 10000)
      });
      provider = "chromium";
      if (!searchResults.results.length) {
        warning = "Public search returned no directory results. " +
          "Using the built-in directory starter list instead.";
        searchResults = {
          results: directoryCatalogResults({
            primaryCategory: business?.primaryCategory, niches, services
          }),
          searchesRun: searchResults.searchesRun
        };
        provider = "catalog";
      }
    } catch (error) {
      // A 403/429 or CAPTCHA is an access decision by the provider.
      // Respect it: do not retry with proxies/stealth or another endpoint.
      warning = "Public web search was unavailable (" +
        (error instanceof Error ? error.message : "unknown error") +
        "). Using LinkTide's built-in directory starter list instead. " +
        "This list is not a live search; review eligibility before submitting.";
      provider = "catalog";
      searchResults = {
        results: directoryCatalogResults({
          primaryCategory: business?.primaryCategory, niches, services
        }),
        searchesRun: 0
      };
    }
  } else {
    searchResults = {
      results: directoryCatalogResults({
        primaryCategory: business?.primaryCategory, niches, services
      }),
      searchesRun: 0
    };
    provider = "catalog";
    warning = "Showing known directory starter sites, not results from a live search. " +
      "Use your own URLs to add more opportunities.";
  }

  const siteDomain = ownDomain(website);
  const seenDomains = new Set<string>();
  const candidates: OpportunityCandidate[] = [];

  for (const result of searchResults.results) {
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
      provider,
      warning,
      aiUsed,
      searchesRun: searchResults.searchesRun,
      rawResults: searchResults.results.length,
      uniqueDomains: candidates.length,
      queued: opportunities.filter((item) => item.action === "queue").length,
      review: opportunities.filter((item) => item.action === "review").length,
      skipped: opportunities.filter((item) => item.action === "skip").length,
      opportunities
    }
  };
}
