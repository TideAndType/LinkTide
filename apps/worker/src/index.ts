import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import {
  createDirectoryAccount,
  loginWithCredential
} from "@linktide/accounts";
import {
  inspectOpportunity,
  launchAutomationBrowser,
  type BrowserContext,
  type FormFieldDescriptor,
  type OpportunityInspection
} from "@linktide/browser";
import type { Page } from "playwright";
import { generateDirectoryQueries } from "@linktide/discovery";
import {
  calculateMappingQuality,
  mapFieldsHeuristically,
  mapFieldsWithLmStudio,
  type BusinessSubmissionProfile,
  type FieldMapping
} from "@linktide/form-mapper";
import { createLmStudioClient } from "@linktide/lm-studio";
import {
  applyRecipe,
  buildRecipe,
  listRecipes,
  loadRecipe,
  markRecipeSuccess,
  saveRecipe,
  type DirectoryRecipe
} from "@linktide/recipes";
import {
  decideAutoSubmit,
  fillMappedFields,
  submitGuarded
} from "@linktide/submissions";
import {
  credentialVaultStatus,
  generateDirectoryPassword,
  generateVaultKey,
  getCredential,
  markCredentialVerified,
  putCredential,
  type DirectoryCredential
} from "@linktide/vault";

const command = process.argv[2] ?? "doctor";

function envBoolean(value: string | undefined, fallback = false) {
  if (value == null) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function dataDir() {
  return process.env.LINKTIDE_DATA_DIR ?? "./data";
}

function recipeDir() {
  return join(dataDir(), "directories");
}

function vaultPath() {
  return join(dataDir(), "credentials.vault.json");
}

function domainOf(value: string) {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
}

function createLmClient() {
  const baseUrl = process.env.LM_STUDIO_BASE_URL;
  const model = process.env.LM_STUDIO_MODEL;
  if (!baseUrl || !model) return undefined;

  return createLmStudioClient({
    baseUrl,
    model,
    apiKey: process.env.LM_STUDIO_API_KEY
  });
}

function mergeMappings(
  recipeMappings: FieldMapping[],
  fallbackMappings: FieldMapping[]
) {
  const fallback = new Map(
    fallbackMappings.map((mapping) => [mapping.key, mapping])
  );

  return recipeMappings.map((mapping) => {
    if (mapping.businessField !== "skip") return mapping;
    return fallback.get(mapping.key) ?? mapping;
  });
}

async function mapFields(
  fields: FormFieldDescriptor[],
  profile: BusinessSubmissionProfile,
  recipe?: DirectoryRecipe
) {
  const learned = recipe ? applyRecipe(fields, recipe) : undefined;

  if (learned && learned.coverage >= 0.8 && learned.matched >= 2) {
    return {
      aiUsed: false,
      recipeUsed: true,
      recipeCoverage: learned.coverage,
      mappings: learned.mappings
    };
  }

  const client = createLmClient();
  let fallback: FieldMapping[];
  let aiUsed = false;

  if (!client) {
    fallback = mapFieldsHeuristically(fields);
  } else {
    try {
      fallback = await mapFieldsWithLmStudio(client, fields, profile);
      aiUsed = true;
    } catch (error) {
      console.warn(
        "LM Studio form mapping failed, using heuristics:",
        error instanceof Error ? error.message : error
      );
      fallback = mapFieldsHeuristically(fields);
    }
  }

  return {
    aiUsed,
    recipeUsed: Boolean(learned && learned.matched > 0),
    recipeCoverage: learned?.coverage ?? 0,
    mappings: learned
      ? mergeMappings(learned.mappings, fallback)
      : fallback
  };
}

let browserContext: BrowserContext | undefined;

async function getBrowser() {
  if (browserContext) return browserContext;

  browserContext = await launchAutomationBrowser({
    profileDir: process.env.LINKTIDE_BROWSER_PROFILE ?? "./browser-profile",
    headless: envBoolean(process.env.LINKTIDE_HEADLESS, false)
  });

  return browserContext;
}

async function openOpportunity(
  context: BrowserContext,
  requestedUrl: string,
  recipe?: DirectoryRecipe
): Promise<{ page: Page; inspection: OpportunityInspection }> {
  if (recipe?.submissionUrl) {
    try {
      return await inspectOpportunity(context, recipe.submissionUrl);
    } catch (error) {
      console.warn(
        "Learned submission URL failed; falling back to discovered URL:",
        error instanceof Error ? error.message : error
      );
    }
  }

  return inspectOpportunity(context, requestedUrl);
}

function pickForm(inspection: OpportunityInspection) {
  return inspection.forms
    .slice()
    .sort((a, b) => b.fields.length - a.fields.length)[0];
}

async function maybeSaveRecipe(input: {
  domain: string;
  inspection: OpportunityInspection;
  form: ReturnType<typeof pickForm>;
  mappings: FieldMapping[];
  mappingConfidence: number;
  requiredUnmapped: number;
  existing?: DirectoryRecipe;
  requiresAccount: boolean;
  verificationObserved: boolean;
}) {
  if (
    !input.form ||
    input.mappingConfidence < 0.9 ||
    input.requiredUnmapped > 0
  ) {
    return { saved: false, recipe: input.existing };
  }

  const recipe = buildRecipe({
    domain: input.domain,
    submissionUrl: input.inspection.submissionPageUrl,
    form: input.form,
    mappings: input.mappings,
    requiresAccount: input.requiresAccount,
    verificationObserved: input.verificationObserved,
    existing: input.existing
  });

  await saveRecipe({
    directory: recipeDir(),
    recipe
  });

  return { saved: true, recipe };
}

async function inspectJob(input: {
  url: string;
  business: BusinessSubmissionProfile;
}) {
  const context = await getBrowser();
  const domain = domainOf(input.url);
  const recipe = await loadRecipe({
    directory: recipeDir(),
    domain
  });

  const { page, inspection } = await openOpportunity(
    context,
    input.url,
    recipe
  );

  try {
    const form = pickForm(inspection);

    if (!form) {
      return {
        ...inspection,
        recipeUsed: Boolean(recipe),
        recipeSaved: false,
        aiUsed: false,
        mappings: [],
        mappingQuality: {
          averageConfidence: 0,
          mappedCount: 0,
          requiredUnmapped: []
        },
        canPrepareSubmission: false,
        message: "No usable submission form was found."
      };
    }

    const mapped = await mapFields(form.fields, input.business, recipe);
    const quality = calculateMappingQuality(form.fields, mapped.mappings);
    const learned = await maybeSaveRecipe({
      domain,
      inspection,
      form,
      mappings: mapped.mappings,
      mappingConfidence: quality.averageConfidence,
      requiredUnmapped: quality.requiredUnmapped.length,
      existing: recipe,
      requiresAccount: inspection.checkpoints.includes("account_auth"),
      verificationObserved:
        inspection.checkpoints.includes("email_verification") ||
        inspection.checkpoints.includes("verification_code")
    });

    return {
      ...inspection,
      selectedFormIndex: form.formIndex,
      aiUsed: mapped.aiUsed,
      recipeUsed: mapped.recipeUsed,
      recipeCoverage: mapped.recipeCoverage,
      recipeSaved: learned.saved,
      mappings: mapped.mappings,
      mappingQuality: quality,
      canPrepareSubmission:
        inspection.checkpoints.length === 0 &&
        quality.mappedCount > 0
    };
  } finally {
    await page.close();
  }
}

async function resolveAccount(input: {
  page: Page;
  inspection: OpportunityInspection;
  domain: string;
  business: BusinessSubmissionProfile;
  allowCreate: boolean;
}) {
  if (!input.inspection.checkpoints.includes("account_auth")) {
    return {
      handled: false as const,
      authenticated: true as const
    };
  }

  const masterKey = process.env.LINKTIDE_VAULT_KEY;
  if (!masterKey) {
    return {
      handled: true as const,
      authenticated: false as const,
      status: "human_action_required",
      reason:
        "This directory requires an account, but LINKTIDE_VAULT_KEY is not configured.",
      checkpoints: ["account_auth"]
    };
  }

  const existing = await getCredential({
    path: vaultPath(),
    masterKey,
    domain: input.domain
  });

  if (existing) {
    const login = await loginWithCredential({
      page: input.page,
      credential: existing
    });

    if (login.status === "logged_in") {
      return {
        handled: true as const,
        authenticated: true as const,
        existingCredential: true,
        accountStatus: login.status
      };
    }

    return {
      handled: true as const,
      authenticated: false as const,
      existingCredential: true,
      status: login.status,
      reason: login.reason ?? "Stored account could not be logged in automatically.",
      checkpoints: login.checkpoints
    };
  }

  if (!input.allowCreate) {
    return {
      handled: true as const,
      authenticated: false as const,
      existingCredential: false,
      status: "human_action_required",
      reason: "This directory requires an account and auto account creation is disabled.",
      checkpoints: ["account_auth"]
    };
  }

  if (!input.business.email) {
    return {
      handled: true as const,
      authenticated: false as const,
      existingCredential: false,
      status: "human_action_required",
      reason: "A business email is required to create a directory account.",
      checkpoints: ["account_auth"]
    };
  }

  const credential: DirectoryCredential = await putCredential({
    path: vaultPath(),
    masterKey,
    credential: {
      domain: input.domain,
      email: input.business.email,
      username: input.business.email.split("@")[0],
      password: generateDirectoryPassword(),
      verified: false
    }
  });

  const created = await createDirectoryAccount({
    page: input.page,
    credential,
    contactName: input.business.contactName
  });

  if (created.status === "created") {
    await markCredentialVerified({
      path: vaultPath(),
      masterKey,
      domain: input.domain,
      verified: true
    });

    return {
      handled: true as const,
      authenticated: true as const,
      existingCredential: false,
      accountCreated: true,
      accountStatus: created.status
    };
  }

  return {
    handled: true as const,
    authenticated: false as const,
    existingCredential: false,
    accountCreated: true,
    status: created.status,
    reason: created.reason ?? "Account creation requires attention.",
    checkpoints: created.checkpoints,
    verificationPending: created.status === "verification_required"
  };
}

async function submitJob(input: {
  url: string;
  business: BusinessSubmissionProfile;
  autoSubmit?: boolean;
  autoCreateAccount?: boolean;
}) {
  const context = await getBrowser();
  const domain = domainOf(input.url);
  let recipe = await loadRecipe({
    directory: recipeDir(),
    domain
  });

  let opened = await openOpportunity(context, input.url, recipe);
  let page = opened.page;
  let inspection = opened.inspection;
  let leaveOpenForHuman = false;
  let account:
    | Awaited<ReturnType<typeof resolveAccount>>
    | undefined;

  try {
    if (inspection.checkpoints.includes("account_auth")) {
      account = await resolveAccount({
        page,
        inspection,
        domain,
        business: input.business,
        allowCreate:
          input.autoCreateAccount ??
          envBoolean(process.env.LINKTIDE_AUTO_CREATE_ACCOUNTS, false)
      });

      if (!account.authenticated) {
        leaveOpenForHuman = true;

        return {
          status:
            account.status === "verification_required"
              ? "verification_required"
              : "review_required",
          submitted: false,
          browserLeftOpen: true,
          inspection,
          account: {
            status: account.status,
            accountCreated: account.accountCreated ?? false,
            existingCredential: account.existingCredential ?? false,
            verificationPending: account.verificationPending ?? false
          },
          reasons: [account.reason ?? "Account action requires human review."],
          checkpoints: account.checkpoints ?? []
        };
      }

      await page.close();
      opened = await openOpportunity(context, input.url, recipe);
      page = opened.page;
      inspection = opened.inspection;
    }

    const form = pickForm(inspection);

    if (!form) {
      leaveOpenForHuman = true;
      return {
        status: "review_required",
        submitted: false,
        browserLeftOpen: true,
        inspection,
        account,
        reasons: ["No usable submission form was found."]
      };
    }

    const mapped = await mapFields(form.fields, input.business, recipe);
    const quality = calculateMappingQuality(form.fields, mapped.mappings);

    const learned = await maybeSaveRecipe({
      domain,
      inspection,
      form,
      mappings: mapped.mappings,
      mappingConfidence: quality.averageConfidence,
      requiredUnmapped: quality.requiredUnmapped.length,
      existing: recipe,
      requiresAccount: Boolean(account?.handled) || recipe?.requiresAccount === true,
      verificationObserved: recipe?.verificationObserved === true
    });

    if (learned.recipe) recipe = learned.recipe;

    const fillResult = await fillMappedFields(
      page,
      form.fields,
      mapped.mappings,
      input.business
    );

    const decision = decideAutoSubmit({
      mappingConfidence: quality.averageConfidence,
      requiredUnmapped: quality.requiredUnmapped.length,
      checkpoints: inspection.checkpoints.filter(
        (checkpoint) => checkpoint !== "account_auth"
      ),
      requestedAutoSubmit:
        input.autoSubmit ?? envBoolean(process.env.LINKTIDE_AUTO_SUBMIT, false)
    });

    const submission = await submitGuarded({
      page,
      form,
      decision
    });

    const verificationObserved =
      submission.status === "human_action_required" &&
      Array.isArray(submission.reasons) &&
      submission.reasons.some((reason) =>
        /email_verification|verification_code/i.test(reason)
      );

    if (submission.submitted) {
      await markRecipeSuccess({
        directory: recipeDir(),
        domain,
        verificationObserved
      });
    }

    leaveOpenForHuman = !submission.submitted;

    return {
      ...submission,
      browserLeftOpen: leaveOpenForHuman,
      inspection,
      account: account
        ? {
            status: account.accountStatus ?? "authenticated",
            accountCreated: account.accountCreated ?? false,
            existingCredential: account.existingCredential ?? false,
            verificationPending: false
          }
        : undefined,
      selectedFormIndex: form.formIndex,
      aiUsed: mapped.aiUsed,
      recipeUsed: mapped.recipeUsed,
      recipeCoverage: mapped.recipeCoverage,
      recipeSaved: learned.saved,
      mappings: mapped.mappings,
      mappingQuality: quality,
      fillResult,
      decision
    };
  } finally {
    if (!leaveOpenForHuman) {
      await page.close().catch(() => undefined);
    }
  }
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function allowedOrigin(origin: string | undefined) {
  if (!origin) return "*";
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    return origin;
  }

  const configured = process.env.LINKTIDE_DASHBOARD_ORIGIN;
  if (configured && origin === configured) return origin;

  return "";
}

function send(
  res: ServerResponse,
  status: number,
  payload: unknown,
  origin?: string
) {
  const cors = allowedOrigin(origin);

  if (cors) res.setHeader("access-control-allow-origin", cors);
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

async function serve() {
  const port = Number(process.env.LINKTIDE_WORKER_PORT ?? 4317);
  let busy = false;

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;

    if (req.method === "OPTIONS") {
      send(res, 204, {}, origin);
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      const [recipes, vault] = await Promise.all([
        listRecipes(recipeDir()),
        credentialVaultStatus({
          path: vaultPath(),
          masterKey: process.env.LINKTIDE_VAULT_KEY
        })
      ]);

      send(
        res,
        200,
        {
          ok: true,
          service: "linktide-worker",
          lmStudioConfigured: Boolean(
            process.env.LM_STUDIO_BASE_URL && process.env.LM_STUDIO_MODEL
          ),
          vaultConfigured: vault.configured,
          credentials: vault.credentials,
          recipes: recipes.length,
          autoSubmitDefault: envBoolean(
            process.env.LINKTIDE_AUTO_SUBMIT,
            false
          ),
          autoCreateAccountsDefault: envBoolean(
            process.env.LINKTIDE_AUTO_CREATE_ACCOUNTS,
            false
          ),
          browserProfile:
            process.env.LINKTIDE_BROWSER_PROFILE ?? "./browser-profile"
        },
        origin
      );
      return;
    }

    if (req.method === "GET" && req.url === "/recipes") {
      const recipes = await listRecipes(recipeDir());
      send(
        res,
        200,
        {
          count: recipes.length,
          recipes: recipes.map((recipe) => ({
            domain: recipe.domain,
            submissionUrl: recipe.submissionUrl,
            requiresAccount: recipe.requiresAccount,
            verificationObserved: recipe.verificationObserved,
            lastValidatedAt: recipe.lastValidatedAt,
            lastSuccessfulAt: recipe.lastSuccessfulAt
          }))
        },
        origin
      );
      return;
    }

    if (req.method === "GET" && req.url === "/credentials/status") {
      const vault = await credentialVaultStatus({
        path: vaultPath(),
        masterKey: process.env.LINKTIDE_VAULT_KEY
      });
      send(res, 200, vault, origin);
      return;
    }

    if (
      req.method === "POST" &&
      (req.url === "/inspect" || req.url === "/submit")
    ) {
      if (busy) {
        send(
          res,
          409,
          { error: "The LinkTide worker is already running a browser job." },
          origin
        );
        return;
      }

      const cors = allowedOrigin(origin);
      if (!cors) {
        send(res, 403, { error: "Origin is not allowed to use the local worker." });
        return;
      }

      busy = true;

      try {
        const body = await readJson(req);

        if (!body.url || !body.business?.name || !body.business?.website) {
          send(
            res,
            400,
            { error: "url, business.name, and business.website are required." },
            origin
          );
          return;
        }

        const result =
          req.url === "/inspect"
            ? await inspectJob(body)
            : await submitJob(body);

        send(res, 200, result, origin);
      } catch (error) {
        send(
          res,
          500,
          {
            error: error instanceof Error ? error.message : "Worker job failed."
          },
          origin
        );
      } finally {
        busy = false;
      }

      return;
    }

    send(res, 404, { error: "Not found." }, origin);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`LinkTide worker listening on http://127.0.0.1:${port}`);
    console.log("Browser automation stays on this machine.");
  });

  const shutdown = async () => {
    server.close();
    await browserContext?.close().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function doctor() {
  const baseUrl = process.env.LM_STUDIO_BASE_URL;
  const model = process.env.LM_STUDIO_MODEL;
  const recipes = await listRecipes(recipeDir());
  const vault = await credentialVaultStatus({
    path: vaultPath(),
    masterKey: process.env.LINKTIDE_VAULT_KEY
  });

  console.log("LinkTide worker");
  console.log("LM Studio URL:", baseUrl ? "configured" : "missing");
  console.log("LM Studio model:", model ?? "missing");
  console.log("Credential vault:", vault.configured ? "configured" : "missing key");
  console.log("Stored directory accounts:", vault.credentials);
  console.log("Learned recipes:", recipes.length);
  console.log(
    "Browser profile:",
    process.env.LINKTIDE_BROWSER_PROFILE ?? "./browser-profile"
  );

  if (!baseUrl || !model) {
    process.exitCode = 1;
    return;
  }

  const client = createLmClient();
  if (!client) return;

  const result = await client.chat([
    { role: "system", content: "Reply with exactly: LINKTIDE_OK" },
    { role: "user", content: "Connection test." }
  ]);

  console.log("LM Studio response:", result.trim());
}

async function main() {
  if (command === "serve") {
    await serve();
    return;
  }

  if (command === "doctor") {
    await doctor();
    return;
  }

  if (command === "generate-vault-key") {
    console.log(generateVaultKey());
    return;
  }

  if (command === "sample-queries") {
    console.log(
      generateDirectoryQueries({
        name: "Example Business",
        website: "https://example.com",
        niches: ["web design", "SEO"],
        locations: ["Florida"]
      }).join("\n")
    );
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
