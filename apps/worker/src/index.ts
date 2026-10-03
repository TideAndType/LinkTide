import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  inspectOpportunity,
  launchAutomationBrowser,
  type BrowserContext,
  type FormFieldDescriptor
} from "@linktide/browser";
import { generateDirectoryQueries } from "@linktide/discovery";
import {
  calculateMappingQuality,
  mapFieldsHeuristically,
  mapFieldsWithLmStudio,
  type BusinessSubmissionProfile
} from "@linktide/form-mapper";
import { createLmStudioClient } from "@linktide/lm-studio";
import {
  decideAutoSubmit,
  fillMappedFields,
  submitGuarded
} from "@linktide/submissions";

const command = process.argv[2] ?? "doctor";

function envBoolean(value: string | undefined, fallback = false) {
  if (value == null) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
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

async function mapFields(
  fields: FormFieldDescriptor[],
  profile: BusinessSubmissionProfile
) {
  const client = createLmClient();

  if (!client) {
    return {
      aiUsed: false,
      mappings: mapFieldsHeuristically(fields)
    };
  }

  try {
    return {
      aiUsed: true,
      mappings: await mapFieldsWithLmStudio(client, fields, profile)
    };
  } catch (error) {
    console.warn(
      "LM Studio form mapping failed, using heuristics:",
      error instanceof Error ? error.message : error
    );

    return {
      aiUsed: false,
      mappings: mapFieldsHeuristically(fields)
    };
  }
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

async function inspectJob(input: {
  url: string;
  business: BusinessSubmissionProfile;
}) {
  const context = await getBrowser();
  const { page, inspection } = await inspectOpportunity(context, input.url);

  try {
    const form =
      inspection.forms
        .slice()
        .sort((a, b) => b.fields.length - a.fields.length)[0];

    if (!form) {
      return {
        ...inspection,
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

    const mapped = await mapFields(form.fields, input.business);
    const quality = calculateMappingQuality(form.fields, mapped.mappings);

    return {
      ...inspection,
      selectedFormIndex: form.formIndex,
      aiUsed: mapped.aiUsed,
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

async function submitJob(input: {
  url: string;
  business: BusinessSubmissionProfile;
  autoSubmit?: boolean;
}) {
  const context = await getBrowser();
  const { page, inspection } = await inspectOpportunity(context, input.url);

  try {
    const form =
      inspection.forms
        .slice()
        .sort((a, b) => b.fields.length - a.fields.length)[0];

    if (!form) {
      return {
        status: "review_required",
        submitted: false,
        inspection,
        reasons: ["No usable submission form was found."]
      };
    }

    const mapped = await mapFields(form.fields, input.business);
    const quality = calculateMappingQuality(form.fields, mapped.mappings);
    const fillResult = await fillMappedFields(
      page,
      form.fields,
      mapped.mappings,
      input.business
    );

    const decision = decideAutoSubmit({
      mappingConfidence: quality.averageConfidence,
      requiredUnmapped: quality.requiredUnmapped.length,
      checkpoints: inspection.checkpoints,
      requestedAutoSubmit:
        input.autoSubmit ?? envBoolean(process.env.LINKTIDE_AUTO_SUBMIT, false)
    });

    const submission = await submitGuarded({
      page,
      form,
      decision
    });

    return {
      ...submission,
      inspection,
      selectedFormIndex: form.formIndex,
      aiUsed: mapped.aiUsed,
      mappings: mapped.mappings,
      mappingQuality: quality,
      fillResult,
      decision
    };
  } finally {
    await page.close();
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
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;

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
      send(
        res,
        200,
        {
          ok: true,
          service: "linktide-worker",
          lmStudioConfigured: Boolean(
            process.env.LM_STUDIO_BASE_URL && process.env.LM_STUDIO_MODEL
          ),
          autoSubmitDefault: envBoolean(process.env.LINKTIDE_AUTO_SUBMIT, false),
          browserProfile:
            process.env.LINKTIDE_BROWSER_PROFILE ?? "./browser-profile"
        },
        origin
      );
      return;
    }

    if (
      req.method === "POST" &&
      (req.url === "/inspect" || req.url === "/submit")
    ) {
      if (busy) {
        send(res, 409, { error: "The LinkTide worker is already running a browser job." }, origin);
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

  console.log("LinkTide worker");
  console.log("LM Studio URL:", baseUrl ? "configured" : "missing");
  console.log("LM Studio model:", model ?? "missing");
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
