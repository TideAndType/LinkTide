import { chromium, type BrowserContext, type Page } from "playwright";

export type BrowserOptions = {
  profileDir: string;
  headless?: boolean;
};

export async function launchAutomationBrowser(options: BrowserOptions): Promise<BrowserContext> {
  return chromium.launchPersistentContext(options.profileDir, {
    headless: options.headless ?? false,
    viewport: { width: 1440, height: 1000 }
  });
}

export async function detectHumanCheckpoint(page: Page) {
  const body = (await page.locator("body").innerText()).toLowerCase();
  const reasons = [
    ["captcha", "captcha"],
    ["verify your email", "email_verification"],
    ["verification code", "verification_code"],
    ["payment", "payment"],
    ["credit card", "payment"],
    ["terms and conditions", "terms"],
    ["terms of service", "terms"]
  ] as const;

  for (const [needle, reason] of reasons) {
    if (body.includes(needle)) return { required: true as const, reason };
  }

  return { required: false as const };
}
