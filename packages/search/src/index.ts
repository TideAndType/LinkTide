import { chromium } from "playwright";

export type SearchResult = {
  id: string;
  title: string;
  url: string;
  description: string;
  query: string;
  domain: string;
};

type RawSearchResult = {
  title: string;
  url: string;
  description: string;
};

function stableId(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return "r" + (hash >>> 0).toString(36);
}

/** Resolve DuckDuckGo's public click redirect without visiting or following it. */
export function normalizeSearchResultUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value, "https://duckduckgo.com");
    if (parsed.hostname === "duckduckgo.com" &&
        /^\/l\/?$/i.test(parsed.pathname)) {
      const destination = parsed.searchParams.get("uddg");
      if (!destination) return undefined;
      return normalizeSearchResultUrl(destination);
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    if (parsed.username || parsed.password) return undefined;

    const host = parsed.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") ||
        host === "127.0.0.1" || host === "::1" ||
        host.endsWith(".duckduckgo.com") || host === "duckduckgo.com") {
      return undefined;
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function normalizeSearchResults(
  query: string,
  raw: RawSearchResult[],
  limit: number
): SearchResult[] {
  const output: SearchResult[] = [];
  const seen = new Set<string>();
  for (const result of raw) {
    const url = normalizeSearchResultUrl(result.url);
    if (!url || !result.title?.trim()) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    output.push({
      id: stableId(query + "|" + url),
      title: result.title.trim().slice(0, 240),
      url,
      description: (result.description ?? "").trim().slice(0, 600),
      query,
      domain: new URL(url).hostname.toLowerCase().replace(/^www\./, "")
    });
    if (output.length >= limit) break;
  }
  return output;
}

const blockedPattern =
  /captcha|unusual traffic|verify you are human|verify that you are human|rate limit|too many requests|automated queries|access denied/i;

/**
 * Free public-search discovery through a short-lived headless Chromium session.
 *
 * Search is deliberately serial and throttled. CAPTCHA/anti-bot responses end
 * the search; there are no proxies, stealth plugins, retries or bypasses.
 * Submission browsing remains in its own persistent (visible) browser profile.
 */
export async function searchHeadlessChromium(input: {
  queries: string[];
  count?: number;
  delayMs?: number;
}): Promise<{ results: SearchResult[]; searchesRun: number }> {
  const queries = [...new Set(input.queries.map((q) => q.trim()).filter(Boolean))].slice(0, 10);
  const count = Math.max(1, Math.min(20, Math.floor(input.count ?? 10)));
  const delayMs = Math.max(1500, Math.min(10000, Math.floor(input.delayMs ?? 2500)));
  if (!queries.length) return { results: [], searchesRun: 0 };

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1280, height: 800 }
    });
    try {
      const page = await context.newPage();
      const results: SearchResult[] = [];
      let searchesRun = 0;

      for (const query of queries) {
        if (searchesRun > 0) await page.waitForTimeout(delayMs);

        const address = new URL("https://html.duckduckgo.com/html/");
        address.searchParams.set("q", query);
        const response = await page.goto(address.toString(), {
          waitUntil: "domcontentloaded",
          timeout: 30000
        });
        searchesRun++;

        const status = response?.status();
        if (!status || status === 403 || status === 429 || status >= 500) {
          throw new Error("Public search is blocked or unavailable (HTTP " +
            (status ?? "unknown") + "). Try fewer searches later.");
        }

        // The HTML search endpoint exposes result elements directly. Do not
        // interact with challenge controls or attempt to bypass rate limits.
        await page.locator(".result__a").first().waitFor({
          state: "attached",
          timeout: 6000
        }).catch(() => undefined);

        const raw = await page.locator(".result").evaluateAll((nodes) =>
          nodes
            .filter((node) =>
              !node.classList.contains("result--ad") &&
              !node.querySelector(".result__badge--ad")
            )
            .map((node) => {
              const anchor = node.querySelector<HTMLAnchorElement>(".result__a");
              return {
                title: (anchor?.textContent ?? "").replace(/\s+/g, " ").trim(),
                url: anchor?.getAttribute("href") ?? "",
                description: (node.querySelector(".result__snippet")?.textContent ?? "")
                  .replace(/\s+/g, " ").trim()
              };
            })
        );

        if (!raw.length) {
          const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 5000);
          if (blockedPattern.test(body)) {
            throw new Error("Public search requested human verification. " +
              "LinkTide stopped rather than bypassing it.");
          }
          if (!/no results|not found|did not match/i.test(body)) {
            throw new Error("Public search returned no recognizable results. " +
              "Its page structure may have changed or access may be restricted.");
          }
        }

        results.push(...normalizeSearchResults(query, raw, count));
      }

      return { results, searchesRun };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
