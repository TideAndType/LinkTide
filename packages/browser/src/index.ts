import {
  chromium,
  type BrowserContext,
  type Locator,
  type Page
} from "playwright";

export type BrowserOptions = {
  profileDir: string;
  headless?: boolean;
};

export type HumanCheckpointReason =
  | "captcha"
  | "account_auth"
  | "email_verification"
  | "verification_code"
  | "payment"
  | "terms";

export type FormOption = {
  label: string;
  value: string;
};

export type FormFieldDescriptor = {
  key: string;
  formIndex: number;
  fieldIndex: number;
  tag: "input" | "textarea" | "select";
  type: string;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  required: boolean;
  maxLength: number | null;
  options: FormOption[];
};

export type FormDescriptor = {
  formIndex: number;
  action: string;
  method: string;
  fields: FormFieldDescriptor[];
};

export type SubmissionLinkCandidate = {
  text: string;
  url: string;
  score: number;
};

export type OpportunityInspection = {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  submissionPageUrl: string;
  submissionLink?: SubmissionLinkCandidate;
  forms: FormDescriptor[];
  checkpoints: HumanCheckpointReason[];
};

export async function launchAutomationBrowser(
  options: BrowserOptions
): Promise<BrowserContext> {
  return chromium.launchPersistentContext(options.profileDir, {
    headless: options.headless ?? false,
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: false
  });
}

function ensureHttpUrl(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs can be inspected.");
  }

  return url.toString();
}

async function isVisible(locator: Locator) {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

export async function detectHumanCheckpoints(
  page: Page
): Promise<HumanCheckpointReason[]> {
  const reasons = new Set<HumanCheckpointReason>();

  const captcha = page.locator(
    '.g-recaptcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [data-sitekey]'
  );
  if ((await captcha.count()) > 0) reasons.add("captcha");

  const passwords = page.locator('input[type="password"]');
  for (let index = 0; index < Math.min(await passwords.count(), 5); index += 1) {
    if (await isVisible(passwords.nth(index))) {
      reasons.add("account_auth");
      break;
    }
  }

  const paymentFields = page.locator(
    'input[autocomplete^="cc-"], input[name*="card" i], input[id*="card" i], iframe[src*="stripe" i], iframe[src*="paypal" i]'
  );
  if ((await paymentFields.count()) > 0) reasons.add("payment");

  const codeFields = page.locator(
    'input[autocomplete="one-time-code"], input[name*="verification" i], input[name*="otp" i], input[id*="verification" i], input[id*="otp" i]'
  );
  if ((await codeFields.count()) > 0) reasons.add("verification_code");

  const visibleText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  if (
    visibleText.includes("verify your email") ||
    visibleText.includes("check your email to verify")
  ) {
    reasons.add("email_verification");
  }

  const checkboxes = page.locator('input[type="checkbox"]');
  for (let index = 0; index < Math.min(await checkboxes.count(), 30); index += 1) {
    const checkbox = checkboxes.nth(index);
    const meta = await checkbox.evaluate((node) => {
      const el = node as HTMLInputElement;
      const labels = Array.from(document.querySelectorAll("label"));
      const explicit = el.id
        ? labels.find((label) => label.htmlFor === el.id)?.textContent ?? ""
        : "";
      const wrapped = el.closest("label")?.textContent ?? "";
      return {
        required: el.required,
        text: `${explicit} ${wrapped} ${el.getAttribute("aria-label") ?? ""}`.toLowerCase()
      };
    }).catch(() => ({ required: false, text: "" }));

    if (
      meta.required &&
      /(terms|agreement|privacy policy|conditions|authorize|consent)/i.test(meta.text)
    ) {
      reasons.add("terms");
      break;
    }
  }

  return [...reasons];
}

export async function collectForms(page: Page): Promise<FormDescriptor[]> {
  const formCount = Math.min(await page.locator("form").count(), 10);
  const forms: FormDescriptor[] = [];

  for (let formIndex = 0; formIndex < formCount; formIndex += 1) {
    const form = page.locator("form").nth(formIndex);
    if (!(await isVisible(form))) continue;

    const meta = await form.evaluate((node) => {
      const el = node as HTMLFormElement;
      return {
        action: el.action || location.href,
        method: (el.method || "get").toUpperCase()
      };
    });

    const rawFields = await form
      .locator("input, textarea, select")
      .evaluateAll((nodes) =>
        nodes.slice(0, 80).map((node, fieldIndex) => {
          const el = node as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
          const tag = el.tagName.toLowerCase() as "input" | "textarea" | "select";
          const type = tag === "input" ? (el as HTMLInputElement).type.toLowerCase() : tag;
          const labels = Array.from(document.querySelectorAll("label"));
          const explicit = el.id
            ? labels.find((label) => label.htmlFor === el.id)?.textContent ?? ""
            : "";
          const wrapped = el.closest("label")?.textContent ?? "";
          const aria = el.getAttribute("aria-label") ?? "";
          const options =
            tag === "select"
              ? Array.from((el as HTMLSelectElement).options)
                  .slice(0, 100)
                  .map((option) => ({
                    label: option.textContent?.trim() ?? option.value,
                    value: option.value
                  }))
              : [];

          return {
            fieldIndex,
            tag,
            type,
            name: el.getAttribute("name") ?? "",
            id: el.id ?? "",
            label: (explicit || wrapped || aria).replace(/\s+/g, " ").trim().slice(0, 240),
            placeholder: el.getAttribute("placeholder") ?? "",
            required: "required" in el ? Boolean(el.required) : false,
            maxLength:
              "maxLength" in el && typeof el.maxLength === "number" && el.maxLength > 0
                ? el.maxLength
                : null,
            options
          };
        })
      );

    const fields: FormFieldDescriptor[] = rawFields
      .filter(
        (field) =>
          !["hidden", "submit", "button", "reset", "image"].includes(field.type)
      )
      .map((field) => ({
        ...field,
        formIndex,
        key: `${formIndex}:${field.fieldIndex}`
      }));

    if (fields.length) {
      forms.push({
        formIndex,
        action: meta.action,
        method: meta.method,
        fields
      });
    }
  }

  return forms;
}


/**
 * Only consider links within the current directory's site. Organic search
 * result URLs and advertisements must not be treated as submit endpoints.
 */
export function rankSubmissionLinks(
  currentUrl: string,
  candidates: Array<{ text: string; href: string }>
): SubmissionLinkCandidate[] {
  const current = new URL(currentUrl);
  const host = current.hostname.toLowerCase().replace(/^www\./, "");
  const positive: Array<[RegExp, number]> = [
    [/(add|submit|create|post|publish)\s+(your\s+|a\s+|new\s+)?(business|company|listing|profile)/i, 22],
    [/(claim|manage|verify)\s+(your\s+|a\s+|this\s+)?(business|listing|profile)/i, 19],
    [/(list your business|get listed|free business listing|business registration)/i, 18],
    [/(add-business|add-listing|submit-business|submit-listing|claim-listing|claim-business|create-listing)/i, 18],
    [/(add|submit|claim|create|list).*(business|listing|company)/i, 12],
    [/(business center|for business|business owners)/i, 5]
  ];
  const negative = /(advertis|blog|news|careers|privacy|terms|press|affiliate|login|log in|sign in|password|checkout|pricing|payment|subscribe|contact us|search results)/i;
  const ranked: SubmissionLinkCandidate[] = [];

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.href, current);
      if (!["http:", "https:"].includes(url.protocol) || url.username ||
          url.password || url.port && url.port !== current.port) continue;
      const candidateHost = url.hostname.toLowerCase().replace(/^www\./, "");
      const sameSite =
        candidateHost === host || candidateHost.endsWith("." + host) ||
        host.endsWith("." + candidateHost);
      if (!sameSite) continue;
      if (url.toString() === current.toString()) continue;
      if (url.hash && url.pathname === current.pathname && url.search === current.search) continue;
      const haystack = [candidate.text, url.pathname.replace(/[-_]/g, " "), url.search]
        .join(" ").toLowerCase();
      let score = 0;
      for (const [pattern, points] of positive) {
        if (pattern.test(haystack)) score += points;
      }
      if (negative.test(haystack)) score -= 30;
      if (score < 10) continue;
      ranked.push({
        text: candidate.text || url.pathname,
        url: url.toString(),
        score
      });
    } catch {
      // Ignore malformed site navigation.
    }
  }
  return ranked.sort((a, b) => b.score - a.score);
}

export async function findSubmissionLink(
  page: Page,
  visited: ReadonlySet<string> = new Set()
): Promise<SubmissionLinkCandidate | undefined> {
  const anchors = await page.locator('a[href], button[data-href], button[data-url]')
    .evaluateAll((nodes) => nodes.slice(0, 650).map((node) => {
      const el = node as HTMLElement;
      const link = el as HTMLAnchorElement;
      return {
        text: [
          el.innerText || el.textContent || "",
          el.getAttribute("aria-label") || "",
          el.getAttribute("title") || ""
        ].join(" ").replace(/\s+/g, " ").trim().slice(0, 220),
        href: link.href || el.getAttribute("data-href") ||
          el.getAttribute("data-url") || ""
      };
    }));
  return rankSubmissionLinks(page.url(), anchors)
    .find((candidate) => !visited.has(candidate.url));
}

/** Prefer genuine business-listing forms over header search, signup or newsletter forms. */
export function scoreSubmissionForm(form: FormDescriptor, pageUrl: string): number {
  const meta = (form.action + " " + pageUrl).toLowerCase();
  const inputs = form.fields.map((field) =>
    [field.name, field.id, field.label, field.placeholder].join(" ")
      .toLowerCase().replace(/[_-]/g, " ")
  );
  const all = inputs.join(" | ");
  let score = 0;
  if (/(add|submit|create|claim|edit|register|post|publish).{0,18}(listing|business|company|profile)/.test(meta)) {
    score += 5;
  }
  if (/search|query|newsletter|subscribe|log.?in|sign.?in|forgot.password/.test(meta)) score -= 12;
  if (/(business|company|organization|listing)\s*(name|title)|^name\s*$/.test(all)) score += 6;
  if (/(website|web site|site url|homepage|company url)/.test(all)) score += 5;
  if (/(phone|telephone|mobile)/.test(all)) score += 3;
  if (/(address|street|postal|zip|city|state|country)/.test(all)) score += 5;
  if (/(category|industry|business type|company type)/.test(all)) score += 4;
  if (/(description|about company|about business|services|specialties)/.test(all)) score += 4;
  if (/e.?mail/.test(all)) score += 1;
  if (/(search|query|newsletter|subscribe)/.test(all)) score -= 12;
  if (/(password|sign.?in|log.?in|username|confirm password)/.test(all) ||
      form.fields.some((field) => field.type === "password")) score -= 20;
  if (form.fields.length < 2) score -= 5;
  return score;
}

export function pickSubmissionForm(inspection: OpportunityInspection): FormDescriptor | undefined {
  const ranked = inspection.forms.map((form) => ({
    form,
    score: scoreSubmissionForm(form, inspection.submissionPageUrl)
  })).sort((a, b) => b.score - a.score || b.form.fields.length - a.form.fields.length);
  return ranked[0]?.score >= 7 ? ranked[0].form : undefined;
}

export async function findAccountCreationLink(
  page: Page
): Promise<SubmissionLinkCandidate | undefined> {
  const current = new URL(page.url());

  const candidates = await page.locator("a[href]").evaluateAll((anchors) =>
    anchors.slice(0, 300).map((anchor) => {
      const el = anchor as HTMLAnchorElement;
      return {
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
        href: el.href
      };
    })
  );

  const positive = [
    ["create account", 16],
    ["sign up", 16],
    ["signup", 16],
    ["register", 14],
    ["create profile", 12],
    ["join now", 10],
    ["new account", 12],
    ["get started", 7]
  ] as const;

  const negative = [
    "login",
    "log in",
    "sign in",
    "forgot",
    "privacy",
    "terms",
    "checkout",
    "pricing",
    "subscribe"
  ];

  const scored = candidates
    .map((candidate) => {
      try {
        const url = new URL(candidate.href);
        if (!["http:", "https:"].includes(url.protocol)) return null;

        const haystack = `${candidate.text} ${url.pathname} ${url.search}`.toLowerCase();
        let score = url.hostname === current.hostname ? 3 : 0;

        for (const [term, weight] of positive) {
          if (haystack.includes(term)) score += weight;
        }

        for (const term of negative) {
          if (haystack.includes(term)) score -= 10;
        }

        return {
          text: candidate.text || url.pathname,
          url: url.toString(),
          score
        };
      } catch {
        return null;
      }
    })
    .filter((candidate): candidate is SubmissionLinkCandidate => Boolean(candidate))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score >= 8 ? scored[0] : undefined;
}


export async function inspectOpportunity(
  context: BrowserContext,
  requestedUrl: string
): Promise<{ page: Page; inspection: OpportunityInspection }> {
  const page = await context.newPage();
  const safeUrl = ensureHttpUrl(requestedUrl);
  const initialDomain = new URL(safeUrl).hostname.toLowerCase().replace(/^www\./, "");
  const visited = new Set<string>();
  const path: string[] = [];
  let submissionLink: SubmissionLinkCandidate | undefined;

  try {
    // Follow at most three directory-owned pages: site home -> get listed ->
    // add/claim listing. Do not follow unrelated external domains.
    let target = safeUrl;
    let forms: FormDescriptor[] = [];
    for (let depth = 0; depth < 3; depth++) {
      const response = await page.goto(target, {
        waitUntil: "domcontentloaded",
        timeout: 35_000
      });
      if (response && [403, 429].includes(response.status())) {
        throw new Error("Directory refused access (HTTP " + response.status() + ").");
      }
      const finalUrl = page.url();
      const currentHost = new URL(finalUrl).hostname.toLowerCase().replace(/^www\./, "");
      if (currentHost !== initialDomain &&
          !currentHost.endsWith("." + initialDomain) &&
          !initialDomain.endsWith("." + currentHost)) {
        throw new Error("Directory redirected outside its site. Manual inspection required.");
      }

      visited.add(finalUrl);
      path.push(finalUrl);
      // Some JS-driven sites render the navigation and forms after DOMContentLoaded.
      await page.locator("body").waitFor({ state: "attached", timeout: 8000 });
      await page.waitForTimeout(500);
      forms = await collectForms(page);
      const inspection: OpportunityInspection = {
        requestedUrl: safeUrl,
        finalUrl,
        title: await page.title(),
        submissionPageUrl: finalUrl,
        submissionLink,
        forms,
        checkpoints: await detectHumanCheckpoints(page)
      };
      if (inspection.checkpoints.includes("captcha") ||
          pickSubmissionForm(inspection) || depth === 2) break;

      const next = await findSubmissionLink(page, visited);
      if (!next) break;
      submissionLink = next;
      target = next.url;
      visited.add(target);
    }
    return {
      page,
      inspection: {
        requestedUrl: safeUrl,
        finalUrl: page.url(),
        title: await page.title(),
        submissionPageUrl: page.url(),
        submissionLink,
        forms,
        checkpoints: await detectHumanCheckpoints(page)
      }
    };
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

export function fieldLocator(page: Page, field: FormFieldDescriptor) {
  return page
    .locator("form")
    .nth(field.formIndex)
    .locator("input, textarea, select")
    .nth(field.fieldIndex);
}
