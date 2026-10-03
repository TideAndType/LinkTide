# LinkTide

LinkTide is a macOS desktop app for AI-assisted backlink discovery, citation management, and guarded directory submission.

## Install

End users do **not** need Node.js, pnpm, Terminal, or a shell installer.

1. Download the latest `LinkTide-<version>-mac-universal.dmg` from GitHub Releases.
2. Open the DMG.
3. Drag **LinkTide** into **Applications**.
4. Open LinkTide.

On first launch LinkTide prepares its browser automation engine automatically. In **Settings**, add:

- LM Studio tunnel URL
- LM Studio model
- LM Studio API key, if your tunnel requires one
- Brave Search API key

All application settings, encrypted directory credentials, learned recipes, and browser data are stored locally on the Mac.

## Updates

LinkTide is configured for a personal-use update flow that does not require an Apple Developer account.

The app checks GitHub Releases shortly after startup and every four hours while it is running. When a newer version exists, LinkTide offers **Download Update**. It downloads the new DMG into your Downloads folder and opens it automatically. Drag the new LinkTide app over the existing copy in Applications and choose **Replace**.

Because macOS requires a properly signed app for true in-place automatic updates, this personal-use build intentionally uses an ad-hoc signature instead of Apple Developer ID signing. You may need to approve LinkTide in **System Settings → Privacy & Security** the first time macOS blocks an unsigned/unnotarized build.

## What LinkTide does

- Builds niche and location-specific backlink discovery queries.
- Searches the web through Brave Search.
- Uses your LM Studio model to qualify backlink/citation opportunities.
- Deduplicates and ranks candidate domains.
- Opens likely submission pages in Chromium.
- Maps unfamiliar forms with LM Studio and learned recipes.
- Fills safe business-profile fields.
- Creates directory accounts when appropriate and requested.
- Stores generated directory passwords in a local AES-256-GCM encrypted vault.
- Stops for CAPTCHA, payment, required legal consent, verification codes, or low-confidence form mappings.
- Can process qualified opportunities sequentially with **Run Queue**.
- Learns successful directory mappings for future runs.

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

Releases are created from **GitHub Actions → Release macOS App → Run workflow**. Enter a semantic version such as `0.1.0`.

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
