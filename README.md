# LinkTide

LinkTide is an AI-assisted backlink discovery, citation management, and directory submission platform.

## V1 goals

- Store reusable business profiles for one or more websites.
- Connect to an LM Studio server through a configurable tunnel.
- Discover niche, local, and industry-specific directory opportunities.
- Classify opportunities before submission.
- Automate browser-based form completion with Playwright.
- Track submitted, pending, live, rejected, and human-action-required listings.
- Stop for CAPTCHA, payment, verification, legal agreements, or low-confidence decisions.
- Save successful site mappings as reusable directory recipes.

## Architecture

```
apps/
  dashboard/       Web UI and API
  worker/          Playwright automation worker

packages/
  browser/         Browser automation helpers
  discovery/       Search and opportunity discovery
  lm-studio/       LM Studio/OpenAI-compatible client
  classifier/      Opportunity classification
  form-mapper/     AI-assisted form field mapping
  submissions/     Submission orchestration
  database/        Shared data model

data/directories/  Learned directory recipes
```

## Core workflow

1. Add a business profile.
2. Generate niche/local search queries.
3. Discover candidate directories.
4. Ask LM Studio to classify relevance and submission potential.
5. Deduplicate and queue qualified opportunities.
6. Launch Playwright for form completion.
7. Submit automatically when confidence is high.
8. Pause for CAPTCHA, email verification, payment, or unusual terms.
9. Revisit listings to verify publication and backlink status.
10. Save successful mappings so repeat submissions become deterministic.

## Local AI

LinkTide is designed to use LM Studio through an OpenAI-compatible endpoint.

Copy `.env.example` to `.env` and configure:

```env
LM_STUDIO_BASE_URL=https://your-tunnel.example.com/v1
LM_STUDIO_MODEL=your-model-name
LM_STUDIO_API_KEY=
BRAVE_SEARCH_API_KEY=your-brave-search-key
```

Do not expose an unauthenticated LM Studio endpoint directly to the public internet.

## Live discovery

LinkTide uses a search provider to retrieve real candidate sites, then LM Studio evaluates those candidates for niche relevance, spam risk, and likely submission potential.

The first provider is Brave Search API. Keep `BRAVE_SEARCH_API_KEY` server-side in `.env`; it is never sent to the browser.

The current discovery run:

1. Takes a limited batch of generated search queries.
2. Retrieves web results.
3. Deduplicates results by domain.
4. Excludes the business's own domain.
5. Sends candidate metadata to LM Studio in batches.
6. Sorts results into `queue`, `review`, or `skip`.
7. Stores the resulting queue locally in the dashboard browser.

A queued opportunity still needs site inspection before automated submission. CAPTCHA, payment, verification, and agreements remain human checkpoints.

## Local browser worker

The browser automation worker runs on the same computer as Chromium so it can keep directory logins, open real browser tabs, upload local files, and hand control back to you when a site needs human action.

### One-command install

On macOS/Linux, clone the repo and run:

```bash
bash install.sh
```

The installer handles dependencies, Chromium, `.env` creation, the local data directory, and generation of the encrypted credential-vault key.

Then add your LM Studio and Brave Search settings to `.env` and start all of LinkTide from **one terminal**:

```bash
pnpm start
```

That one command starts both the local Playwright worker and the dashboard. Press **Ctrl+C** once to stop both.

The dashboard talks to the local worker at `http://127.0.0.1:4317` by default.

For each qualified opportunity:

- **Inspect** opens the candidate, looks for a likely Add Business / Submit Listing path, reads the form, and maps it to the saved business profile.
- **Fill & Submit** fills safe mapped fields and submits only when mapping confidence is at least 90%, all required fields are mapped, and no human checkpoint is detected.
- CAPTCHA, login/password, verification codes, required legal agreements, payment flows, or low-confidence mappings stop submission and leave the browser tab open for manual action.
- Payment/card fields, consent checkboxes, CAPTCHA, and verification-code fields are never automatically filled.
- If a directory requires an account, LinkTide can generate a unique password, encrypt it locally with AES-256-GCM, and reuse it for later logins. The encrypted vault is ignored by Git.
- If email verification is required, LinkTide records the account as unverified and leaves the browser open for human completion.
- High-confidence form mappings are saved as local directory recipes. Future runs can reuse those mappings before calling LM Studio.

Set `LINKTIDE_AUTO_CREATE_ACCOUNTS=false` to keep account creation off by default. The dashboard may explicitly request account creation for a single submission job.

Set `LINKTIDE_AUTO_SUBMIT=false` to keep global auto-submit off. The dashboard's **Fill & Submit** button explicitly requests auto-submit for that one job, but the same safety gates still apply.

## Status

Initial project scaffold.
