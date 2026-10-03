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
```

Do not expose an unauthenticated LM Studio endpoint directly to the public internet.

## Status

Initial project scaffold.
