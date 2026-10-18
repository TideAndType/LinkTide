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

    const googleHost = /^(?:www\.)?google\.[a-z.]+$/i.test(parsed.hostname);
    if (googleHost && parsed.pathname === "/url") {
      const destination = parsed.searchParams.get("q") ?? parsed.searchParams.get("url");
      return destination ? normalizeSearchResultUrl(destination) : undefined;
    }
    if (googleHost) return undefined;

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    if (parsed.username || parsed.password) return undefined;

    const host = parsed.hostname.toLowerCase();
    const privateIpv4 = /^(?:10\.|127\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.)/.test(host);
    const privateIpv6 = host.startsWith("[") || host.includes(":");
    if (!host || privateIpv4 || privateIpv6 || parsed.port ||
        host === "localhost" || host.endsWith(".localhost") ||
        host.endsWith(".local") || host.endsWith(".internal") ||
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


/**
 * A user-initiated Google search using the visible search form.
 *
 * Exactly one query is run per invocation. No stealth browser fingerprinting,
 * proxy rotation, challenges or consent acceptance. If Google rejects a query,
 * stop and let the caller use its directory catalog/manual import instead.
 * The browser is temporary and separate from the submission browser profile.
 */
export async function searchGoogleVisibleForm(input: {
  query: string;
  count?: number;
}): Promise<{ results: SearchResult[]; searchesRun: number }> {
  const query = input.query.trim();
  if (!query) throw new Error("Choose a search query first.");
  if (query.length > 500) throw new Error("Search query is too long.");
  const count = Math.max(1, Math.min(20, Math.floor(input.count ?? 10)));

  const browser = await chromium.launch({
    headless: false
  });
  try {
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1360, height: 900 }
    });
    try {
      const page = await context.newPage();
      const home = await page.goto("https://www.google.com/", {
        waitUntil: "domcontentloaded", timeout: 30000
      });
      if (!home || home.status() === 403 || home.status() === 429) {
        throw new Error("Google denied access to the search page. " +
          "LinkTide will not attempt to bypass that restriction.");
      }

      // Interact with Google's visible input just as a browser user would:
      // focus the field, enter the query, and submit via Enter.
      const searchBox = page.locator('textarea[name="q"], input[name="q"]').first();
      try {
        await searchBox.waitFor({ state: "visible", timeout: 15000 });
      } catch {
        throw new Error(
          "Google did not show a usable search form (possibly consent or verification). " +
          "Open the site yourself if action is required."
        );
      }

      await searchBox.click();
      await searchBox.fill(query);
      await searchBox.press("Enter");

      await page.waitForURL((url) =>
        url.pathname === "/search" ||
        url.pathname.startsWith("/sorry") ||
        url.hostname === "consent.google.com",
      { timeout: 20000 }).catch(() => undefined);
      await page.locator("#search a:has(h3), #rso a:has(h3)").first()
        .waitFor({ state: "attached", timeout: 10000 })
        .catch(() => undefined);

      if (page.url().includes("/sorry") ||
          page.url().includes("consent.google.com")) {
        throw new Error(
          "Google requires verification or consent. " +
          "LinkTide stopped without interacting with the challenge."
        );
      }

      const raw = await page.locator("#search a:has(h3), #rso a:has(h3)")
        .evaluateAll((links) =>
          links.slice(0, 60).map((link) => {
            const anchor = link as HTMLAnchorElement;
            const heading = anchor.querySelector("h3");
            const result = anchor.closest(".MjjYud, [data-hveid]") ??
              anchor.parentElement?.parentElement;
            const title = (heading?.textContent ?? "").replace(/\s+/g, " ").trim();
            const description = (result?.textContent ?? "")
              .replace(/\s+/g, " ").replace(title, "").trim().slice(0, 600);
            return {
              title,
              url: anchor.href,
              description
            };
          })
        );

      const results = normalizeSearchResults(query, raw, count);
      if (!results.length) {
        const body = (await page.locator("body").innerText().catch(() => ""))
          .slice(0, 3000);
        if (blockedPattern.test(body)) {
          throw new Error("Google requested human verification or blocked automated search.");
        }
        throw new Error(
          "Google did not provide readable organic results. " +
          "Its page layout, consent flow, or access rules may have changed."
        );
      }

      return { results, searchesRun: 1 };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}


type DirectorySeed = RawSearchResult & {
  type: "general" | "agency";
};

/**
 * Small, review-first directory starter list. This is a known-source catalog,
 * NOT a live web search or a guarantee of free/eligible/current submission.
 * Start pages may require login, payment or separate listing verification.
 */
const DIRECTORY_SEEDS: DirectorySeed[] = [
  { title: "Google Business Profile", url: "https://www.google.com/business/",
    description: "Local business profile. Check eligibility and ownership verification.", type: "general" },
  { title: "Bing Places for Business", url: "https://www.bingplaces.com/",
    description: "Local search directory. Check existing business profile and verify ownership.", type: "general" },
  { title: "Apple Business Connect", url: "https://businessconnect.apple.com/",
    description: "Apple Maps business listing. Business verification required.", type: "general" },
  { title: "Yelp for Business", url: "https://biz.yelp.com/",
    description: "Business directory profile. Existing listing check and verification may be required.", type: "general" },
  { title: "Manta Free Business Listing", url: "https://www.manta.com/business-listings/free-business-listing",
    description: "Business directory with a free listing option; check eligibility.", type: "general" },
  { title: "Better Business Bureau", url: "https://www.bbb.org/",
    description: "Business profiles and accreditation. Different services may have different requirements.", type: "general" },
  { title: "ChamberofCommerce.com", url: "https://www.chamberofcommerce.com/",
    description: "Business directory; review listing and eligibility requirements.", type: "general" },
  { title: "Yellow Pages", url: "https://www.yellowpages.com/",
    description: "General business directory; check if a listing already exists.", type: "general" },
  { title: "Alignable", url: "https://www.alignable.com/",
    description: "Local business network; membership/account may be required.", type: "general" },
  { title: "Clutch", url: "https://clutch.co/get-listed",
    description: "Agency and B2B service-provider directory; basic profile and review process.", type: "agency" },
  { title: "DesignRush", url: "https://www.designrush.com/",
    description: "Agency directory for design, marketing and development firms.", type: "agency" },
  { title: "GoodFirms", url: "https://www.goodfirms.co/",
    description: "Agency and technology service-provider directory.", type: "agency" },
  { title: "UpCity", url: "https://upcity.com/",
    description: "B2B services marketplace and agency directory; eligibility may vary.", type: "agency" },
  { title: "Agency Spotter", url: "https://www.agencyspotter.com/",
    description: "Agency discovery and service-provider directory.", type: "agency" },
  { title: "Sortlist", url: "https://www.sortlist.com/",
    description: "Agency and digital-services directory; review account requirements.", type: "agency" }
];

export function directoryCatalogResults(profile: {
  primaryCategory?: string;
  niches?: string[];
  services?: string[];
} = {}): SearchResult[] {
  const terms = [profile.primaryCategory ?? "", ...(profile.niches ?? []),
    ...(profile.services ?? [])].join(" ").toLowerCase();
  const agencyRelated = /marketing|web|seo|design|digital|advertis|creative|agency|branding|software|developer|it support|managed service|technology|consult/i.test(terms);
  const chosen = DIRECTORY_SEEDS.filter((entry) =>
    entry.type === "general" || agencyRelated
  );
  return normalizeSearchResults(
    "curated directory starter list",
    chosen,
    chosen.length
  );
}

export function importedDirectoryResults(values: string[]): SearchResult[] {
  const manual: RawSearchResult[] = [];
  for (const value of values.slice(0, 100)) {
    const url = normalizeSearchResultUrl(value.trim());
    if (!url) continue;
    manual.push({
      title: new URL(url).hostname.replace(/^www\./, "") + " (imported)",
      url,
      description: "Directory URL you provided. Check listing relevance, rules and eligibility before submitting."
    });
  }
  return normalizeSearchResults("manually imported directory URLs", manual, 100);
}
