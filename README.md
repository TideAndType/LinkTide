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

Packaged LinkTide builds use `electron-updater` with GitHub Releases. The app checks shortly after startup and every four hours while it is running. When an update finishes downloading, LinkTide offers **Restart & Update**.

macOS auto-update requires a signed application, so production releases are built with a Developer ID certificate and notarized by Apple. The release workflow intentionally refuses to publish when the signing credentials are missing.

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

Required repository secrets:

- `MAC_CSC_LINK` — Developer ID Application certificate exported as a password-protected `.p12` and encoded/supplied in electron-builder-compatible form.
- `MAC_CSC_KEY_PASSWORD` — password for the certificate.
- `APPLE_ID` — Apple ID used for notarization.
- `APPLE_APP_SPECIFIC_PASSWORD` — Apple app-specific password.
- `APPLE_TEAM_ID` — Apple Developer team ID.

The workflow builds a universal macOS application, signs it, notarizes it, publishes the DMG and updater ZIP, and publishes the update metadata to the public GitHub Release.

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
