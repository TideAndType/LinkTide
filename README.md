# LinkTide

LinkTide is a macOS desktop app for AI-assisted backlink discovery, citation management, and guarded directory submission.

## Install

End users do **not** need Node.js, pnpm, Terminal, or a shell installer.

1. Download the latest `LinkTide-<version>-mac-universal.dmg` from GitHub Releases.
2. Open the DMG.
3. Drag **LinkTide** into **Applications**.
4. Open LinkTide.

On first launch LinkTide prepares its browser automation engine automatically. In **Settings**, add:

- LM Studio server URL (recommended on the same Mac: `http://127.0.0.1:1234/v1`, or your Cloudflare tunnel)
- LM Studio model (refresh the model list, select your model, and save settings)
- LM Studio API token, only if your server requires one

Open LM Studio's **Developer** tab, start its local API server, and load a chat model before connecting. LinkTide first queries the OpenAI-compatible `/v1/models` endpoint, which also works through tunnels exposing only OpenAI-compatible paths. You can enter just the server origin or the full `/v1` URL; LinkTide normalizes both. **Test Connection** uses the values currently on screen even if you haven't saved them. After a successful test, click **Save Settings**.

If the test reports **401/403**, check your token or Cloudflare Access restrictions. **404** usually means the URL points at the wrong server/path. If it times out, check that LM Studio's server is running and the model is loaded.
- No search API key required: public search uses headless Chromium

All application settings, encrypted directory credentials, learned recipes, and browser data are stored locally on the Mac.

## Updates

LinkTide is configured for a personal-use update flow that does not require an Apple Developer account.

The app checks GitHub Releases shortly after startup and every four hours while it is running. When a newer version exists, LinkTide offers **Download Update**. It downloads the new DMG into your Downloads folder and opens it automatically. Drag the new LinkTide app over the existing copy in Applications and choose **Replace**.

Because macOS requires a properly signed app for true in-place automatic updates, this personal-use build intentionally uses an ad-hoc signature instead of Apple Developer ID signing. You may need to approve LinkTide in **System Settings → Privacy & Security** the first time macOS blocks an unsigned/unnotarized build.

## What LinkTide does

- Builds niche and location-specific backlink discovery queries.
- Searches public directory results using headless Chromium (DuckDuckGo HTML), with serial queries and delays. No Brave Search subscription is required.
- Uses your LM Studio model to qualify backlink/citation opportunities.
- Deduplicates and ranks candidate domains.
- Opens likely submission pages in Chromium.
- Maps unfamiliar forms with LM Studio and learned recipes.
- Fills safe business-profile fields.
- Creates directory accounts when appropriate and requested.
- Stores generated directory passwords in a local AES-256-GCM encrypted vault.
- Stops for CAPTCHA, payment, required legal consent, verification codes, or low-confidence form mappings.
- Can process qualified opportunities concurrently with **Run Parallel Queue** (three browser tabs by default, up to four through the local batch API).
- Shows per-directory submission attempts, attention states, verification, and existing-submission deduplication.
- Keeps bulk account creation off and never bypasses CAPTCHA, payment, consent, or verification steps.
- Learns successful directory mappings for future runs.

### Free directory discovery that does not depend on search engines

After building a discovery plan, click **Find Starter Directories**. LinkTide uses a built-in, curated starting list of known business directories, and adds relevant agency directories when your profile includes services such as web design, SEO, marketing, development or managed IT. This does **not** query a search engine. It is a starting list, **not** a claim of live search results, current open applications, available backlinks, or guaranteed free listings. Review each directory's eligibility, existing listing, terms and membership requirements.

To provide additional directory sites, paste one public HTTP(S) URL per line into **Add your own directory URLs**, then click **Qualify Pasted URLs**. This needs no search provider; LinkTide deduplicates URLs and qualifies them locally. Localhost and private-network URLs are not accepted.

**Search Google in Visible Browser** is a separate, opt-in experiment. Choose one of the planned search queries in the dropdown, then click the button. LinkTide launches a visible Chromium window, visits Google's home page, clicks the search field, fills the selected query and presses Enter. If readable organic results are returned, LinkTide qualifies them and adds unique domains from later successful searches to the same queue. You can observe the normal search UI. This remains automation, and Google may restrict it or request consent or human verification; LinkTide never bypasses an access restriction and uses the starter directory list instead if the search fails. We have not confirmed this mode against a live Google search from your Mac; the unit tests cover link parsing, not live provider availability.

**Try Public Web Search** remains an optional experimental mode. It opens a temporary headless Chromium browser and queries public DuckDuckGo HTML results serially with delays. Search engines may return HTTP 403, 429 or CAPTCHA pages, which LinkTide must respect: no proxies, stealth plugins, retry floods or CAPTCHA bypass. If web search fails, LinkTide shows a warning and uses the starter list instead. The submission browser remains separate. LM Studio improves qualification, but without it results default to human review rather than bulk auto-submit.

### Parallel queue

After a discovery search, review the qualified opportunities and select **Run Parallel Queue**. The local worker runs up to three eligible directories concurrently, while the dashboard reports progress. Directories with an existing pending, verification-required, or live listing are skipped for that business. A submitted form is recorded as an **attempt**, not proof that a backlink is live; use the history verification action to check the listing.

The local worker provides `POST /submit/batch` and `GET /submit/batch/progress`. The batch endpoint accepts `{ "business": { ... }, "items": [{ "id": "...", "url": "https://..." }], "autoSubmit": true, "concurrency": 3 }`, capped at four concurrent tabs and 150 unique directories. For forms requiring accounts or human intervention, return to the individual directory action; the bulk queue closes review tabs instead of leaving dozens of browser windows open. Each batch is initiated explicitly from LinkTide, not scheduled to run unattended.
## Developer setup

The repository remains a pnpm monorepo for development:

```bash
corepack enable
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install
pnpm typecheck
pnpm build:desktop
```

To run the dashboard/worker during development, use the project scripts. These commands are for developers only; normal LinkTide users install the DMG.

## macOS release

A version bump merged to `main` automatically triggers **GitHub Actions → Release macOS App**, builds a universal DMG, and publishes it to **GitHub Releases**. You can also use **Run workflow** manually and enter a semantic version.

No Apple Developer secrets are required for the personal-use build. GitHub Actions builds an ad-hoc signed universal DMG and publishes it to a public GitHub Release. Installed LinkTide copies use that release to detect and download newer DMGs.

## Repository layout

```
apps/
  dashboard/       Static LinkTide UI
  desktop/         Electron macOS shell
  worker/          Local automation/control-plane service

packages/
  accounts/        Directory account automation
  browser/         Playwright inspection + browser helpers
  classifier/      Opportunity qualification
  control-plane/   Settings, discovery planning, live search
  database/        Shared data types
  discovery/       Search-query generation
  form-mapper/     AI/heuristic form mapping
  lm-studio/       LM Studio client
  recipes/         Learned directory recipes
  search/          Search-provider integration
  submissions/     Guarded fill/submit logic
  vault/           Local encrypted credential vault
```
