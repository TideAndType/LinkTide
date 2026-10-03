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

export async function findSubmissionLink(
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
    ["add business", 12],
    ["add your business", 14],
    ["submit listing", 14],
    ["submit business", 14],
    ["list your business", 14],
    ["get listed", 12],
    ["add listing", 12],
    ["claim listing", 10],
    ["create listing", 10],
    ["add company", 10],
    ["submit company", 10],
    ["join directory", 9],
    ["business signup", 8],
    ["register business", 8],
    ["become a member", 6],
    ["membership", 4]
  ] as const;

  const negative = [
    "privacy",
    "terms",
    "blog",
    "news",
    "press",
    "careers",
    "login",
    "sign in",
    "forgot",
    "advertise"
  ];

  const scored = candidates
    .map((candidate) => {
      try {
        const url = new URL(candidate.href);
        if (!["http:", "https:"].includes(url.protocol)) return null;

        const haystack = `${candidate.text} ${url.pathname} ${url.search}`.toLowerCase();
        let score = url.hostname === current.hostname ? 2 : 0;

        for (const [term, weight] of positive) {
          if (haystack.includes(term)) score += weight;
        }

        for (const term of negative) {
          if (haystack.includes(term)) score -= 8;
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

  return scored[0]?.score >= 6 ? scored[0] : undefined;
}

export async function inspectOpportunity(
  context: BrowserContext,
  requestedUrl: string
): Promise<{ page: Page; inspection: OpportunityInspection }> {
  const page = await context.newPage();
  const safeUrl = ensureHttpUrl(requestedUrl);

  await page.goto(safeUrl, {
    waitUntil: "domcontentloaded",
    timeout: 35_000
  });

  let forms = await collectForms(page);
  let submissionLink: SubmissionLinkCandidate | undefined;

  const usableFields = forms.reduce((sum, form) => sum + form.fields.length, 0);

  if (usableFields < 2) {
    submissionLink = await findSubmissionLink(page);

    if (submissionLink) {
      await page.goto(submissionLink.url, {
        waitUntil: "domcontentloaded",
        timeout: 35_000
      });
      forms = await collectForms(page);
    }
  }

  const checkpoints = await detectHumanCheckpoints(page);

  return {
    page,
    inspection: {
      requestedUrl: safeUrl,
      finalUrl: page.url(),
      title: await page.title(),
      submissionPageUrl: page.url(),
      submissionLink,
      forms,
      checkpoints
    }
  };
}

export function fieldLocator(page: Page, field: FormFieldDescriptor) {
  return page
    .locator("form")
    .nth(field.formIndex)
    .locator("input, textarea, select")
    .nth(field.fieldIndex);
}
