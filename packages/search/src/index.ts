export type SearchResult = {
  id: string;
  title: string;
  url: string;
  description: string;
  query: string;
  domain: string;
};

type BraveSearchResponse = {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
    }>;
  };
};

function stableId(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `r${(hash >>> 0).toString(36)}`;
}

function normalizeDomain(value: string) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function searchBrave(input: {
  apiKey: string;
  query: string;
  count?: number;
  country?: string;
  searchLang?: string;
}): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", input.query);
  url.searchParams.set("count", String(Math.min(Math.max(input.count ?? 10, 1), 20)));
  url.searchParams.set("country", input.country ?? "US");
  url.searchParams.set("search_lang", input.searchLang ?? "en");

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "x-subscription-token": input.apiKey
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Brave Search failed for "${input.query}": ${response.status} ${detail.slice(0, 240)}`
    );
  }

  const payload = (await response.json()) as BraveSearchResponse;

  return (payload.web?.results ?? [])
    .filter((result) => result.url && result.title)
    .map((result) => {
      const resultUrl = result.url as string;

      return {
        id: stableId(`${input.query}|${resultUrl}`),
        title: result.title as string,
        url: resultUrl,
        description: result.description ?? "",
        query: input.query,
        domain: normalizeDomain(resultUrl)
      };
    })
    .filter((result) => result.domain);
}
