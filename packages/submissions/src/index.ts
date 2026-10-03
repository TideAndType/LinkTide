import {
  detectHumanCheckpoints,
  fieldLocator,
  type FormDescriptor,
  type FormFieldDescriptor,
  type HumanCheckpointReason
} from "@linktide/browser";
import type {
  BusinessField,
  BusinessSubmissionProfile,
  FieldMapping
} from "@linktide/form-mapper";
import type { Locator, Page } from "playwright";

export type FillResult = {
  filled: string[];
  skipped: Array<{ key: string; reason: string }>;
};

export type SubmissionDecision = {
  canAutoSubmit: boolean;
  reasons: string[];
  mappingConfidence: number;
  requiredUnmapped: number;
  checkpoints: HumanCheckpointReason[];
};

function valueFor(
  profile: BusinessSubmissionProfile,
  field: BusinessField
): string | undefined {
  if (field === "skip") return undefined;
  const value = profile[field];

  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function chooseSelect(
  locator: Locator,
  value: string,
  preferred?: string
) {
  const options = await locator.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => {
      const option = node as HTMLOptionElement;
      return { label: option.textContent?.trim() ?? "", value: option.value };
    })
  );

  if (preferred && options.some((option) => option.value === preferred)) {
    await locator.selectOption(preferred);
    return true;
  }

  const normalized = value.toLowerCase();
  const exact = options.find(
    (option) =>
      option.label.toLowerCase() === normalized ||
      option.value.toLowerCase() === normalized
  );

  if (exact) {
    await locator.selectOption(exact.value);
    return true;
  }

  const partial = options.find(
    (option) =>
      option.label.toLowerCase().includes(normalized) ||
      normalized.includes(option.label.toLowerCase())
  );

  if (partial) {
    await locator.selectOption(partial.value);
    return true;
  }

  return false;
}

export async function fillMappedFields(
  page: Page,
  fields: FormFieldDescriptor[],
  mappings: FieldMapping[],
  profile: BusinessSubmissionProfile
): Promise<FillResult> {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const filled: string[] = [];
  const skipped: Array<{ key: string; reason: string }> = [];

  for (const mapping of mappings) {
    if (mapping.businessField === "skip" || mapping.confidence < 0.72) continue;

    const field = byKey.get(mapping.key);
    if (!field) continue;

    const value = valueFor(profile, mapping.businessField);
    if (!value) {
      skipped.push({ key: field.key, reason: `No value for ${mapping.businessField}` });
      continue;
    }

    if (["password", "checkbox", "radio"].includes(field.type)) {
      skipped.push({ key: field.key, reason: `Unsafe field type: ${field.type}` });
      continue;
    }

    const locator = fieldLocator(page, field);

    try {
      if (field.type === "file") {
        if (mapping.businessField !== "logoPath") {
          skipped.push({ key: field.key, reason: "File field is not mapped to logoPath." });
          continue;
        }
        await locator.setInputFiles(value);
        filled.push(field.key);
        continue;
      }

      if (field.tag === "select") {
        const selected = await chooseSelect(locator, value, mapping.selectValue);
        if (!selected) {
          skipped.push({ key: field.key, reason: "No matching select option." });
          continue;
        }
        filled.push(field.key);
        continue;
      }

      const maxLength = field.maxLength && field.maxLength > 0 ? field.maxLength : undefined;
      await locator.fill(maxLength ? value.slice(0, maxLength) : value);
      filled.push(field.key);
    } catch (error) {
      skipped.push({
        key: field.key,
        reason: error instanceof Error ? error.message.slice(0, 180) : "Fill failed."
      });
    }
  }

  return { filled, skipped };
}

async function findSubmitControl(page: Page, form: FormDescriptor) {
  const formLocator = page.locator("form").nth(form.formIndex);
  const buttons = formLocator.locator(
    'button, input[type="submit"], input[type="button"]'
  );

  const candidates = await buttons.evaluateAll((nodes) =>
    nodes.map((node, index) => {
      const el = node as HTMLButtonElement | HTMLInputElement;
      return {
        index,
        text:
          (el instanceof HTMLInputElement ? el.value : el.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase()
      };
    })
  );

  const dangerous = /(pay|purchase|checkout|buy|order|subscribe|charge|donate)/i;
  const positive = /(submit|add|create|save|send|list|publish|register|continue)/i;

  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      score:
        (positive.test(candidate.text) ? 8 : 0) -
        (dangerous.test(candidate.text) ? 50 : 0)
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0) return undefined;

  return {
    locator: buttons.nth(best.index),
    text: best.text,
    dangerous: dangerous.test(best.text)
  };
}

export function decideAutoSubmit(input: {
  mappingConfidence: number;
  requiredUnmapped: number;
  checkpoints: HumanCheckpointReason[];
  requestedAutoSubmit: boolean;
}) : SubmissionDecision {
  const reasons: string[] = [];

  if (!input.requestedAutoSubmit) reasons.push("Auto-submit is disabled for this run.");
  if (input.mappingConfidence < 0.9) reasons.push("Mapping confidence is below 90%.");
  if (input.requiredUnmapped > 0) reasons.push("Required fields remain unmapped.");
  if (input.checkpoints.length) {
    reasons.push(`Human checkpoint detected: ${input.checkpoints.join(", ")}.`);
  }

  return {
    canAutoSubmit: reasons.length === 0,
    reasons,
    mappingConfidence: input.mappingConfidence,
    requiredUnmapped: input.requiredUnmapped,
    checkpoints: input.checkpoints
  };
}

export async function submitGuarded(input: {
  page: Page;
  form: FormDescriptor;
  decision: SubmissionDecision;
}) {
  if (!input.decision.canAutoSubmit) {
    return {
      status: "review_required" as const,
      submitted: false,
      reasons: input.decision.reasons
    };
  }

  const control = await findSubmitControl(input.page, input.form);

  if (!control) {
    return {
      status: "review_required" as const,
      submitted: false,
      reasons: ["No safe submit control was found."]
    };
  }

  if (control.dangerous) {
    return {
      status: "review_required" as const,
      submitted: false,
      reasons: [`Potential payment action detected: ${control.text}`]
    };
  }

  const beforeUrl = input.page.url();
  await control.locator.click();
  await input.page.waitForTimeout(1200);

  const checkpoints = await detectHumanCheckpoints(input.page);
  if (checkpoints.length) {
    return {
      status: "human_action_required" as const,
      submitted: false,
      reasons: [`Checkpoint after submit: ${checkpoints.join(", ")}`]
    };
  }

  const invalidRequired = await input.page
    .locator("form :invalid")
    .count()
    .catch(() => 0);

  if (invalidRequired > 0) {
    return {
      status: "review_required" as const,
      submitted: false,
      reasons: [`${invalidRequired} invalid form field(s) remain after submit.`]
    };
  }

  const body = (await input.page.locator("body").innerText().catch(() => "")).toLowerCase();
  const successSignal =
    /(thank you|successfully submitted|submission received|pending review|listing submitted|listing has been created|business has been added)/i.test(
      body
    );

  return {
    status: successSignal ? ("submitted" as const) : ("submitted_unverified" as const),
    submitted: true,
    beforeUrl,
    afterUrl: input.page.url(),
    submitText: control.text
  };
}
