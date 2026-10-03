import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FormDescriptor, FormFieldDescriptor } from "@linktide/browser";
import type { BusinessField, FieldMapping } from "@linktide/form-mapper";

export type RecipeField = {
  type: string;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  businessField: BusinessField;
  selectValue?: string;
  confidence: number;
};

export type DirectoryRecipe = {
  version: 1;
  domain: string;
  submissionUrl: string;
  formMethod: string;
  fields: RecipeField[];
  requiresAccount: boolean;
  verificationObserved: boolean;
  learnedAt: string;
  lastValidatedAt: string;
  lastSuccessfulAt?: string;
};

function normalizeDomain(value: string) {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function filename(domain: string) {
  return `${normalizeDomain(domain).replace(/[^a-z0-9.-]/g, "_")}.json`;
}

function similarity(field: FormFieldDescriptor, recipe: RecipeField) {
  let score = 0;

  if (field.type === recipe.type) score += 1;
  if (field.name && recipe.name && field.name === recipe.name) score += 5;
  if (field.id && recipe.id && field.id === recipe.id) score += 5;

  const label = normalizeText(field.label);
  const recipeLabel = normalizeText(recipe.label);
  if (label && recipeLabel && label === recipeLabel) score += 4;

  const placeholder = normalizeText(field.placeholder);
  const recipePlaceholder = normalizeText(recipe.placeholder);
  if (placeholder && recipePlaceholder && placeholder === recipePlaceholder) {
    score += 2;
  }

  return score;
}

export function buildRecipe(input: {
  domain: string;
  submissionUrl: string;
  form: FormDescriptor;
  mappings: FieldMapping[];
  requiresAccount?: boolean;
  verificationObserved?: boolean;
  existing?: DirectoryRecipe;
}) {
  const byKey = new Map(input.mappings.map((mapping) => [mapping.key, mapping]));
  const now = new Date().toISOString();

  const fields: RecipeField[] = [];

  for (const field of input.form.fields) {
    const mapping = byKey.get(field.key);
    if (!mapping || mapping.businessField === "skip") continue;

    fields.push({
      type: field.type,
      name: field.name,
      id: field.id,
      label: field.label,
      placeholder: field.placeholder,
      businessField: mapping.businessField,
      selectValue: mapping.selectValue,
      confidence: mapping.confidence
    });
  }

  return {
    version: 1,
    domain: normalizeDomain(input.domain),
    submissionUrl: input.submissionUrl,
    formMethod: input.form.method,
    fields,
    requiresAccount: input.requiresAccount ?? input.existing?.requiresAccount ?? false,
    verificationObserved:
      input.verificationObserved ?? input.existing?.verificationObserved ?? false,
    learnedAt: input.existing?.learnedAt ?? now,
    lastValidatedAt: now,
    lastSuccessfulAt: input.existing?.lastSuccessfulAt
  } satisfies DirectoryRecipe;
}

export function applyRecipe(
  fields: FormFieldDescriptor[],
  recipe: DirectoryRecipe
) {
  const used = new Set<number>();
  const mappings: FieldMapping[] = [];

  for (const field of fields) {
    let bestIndex = -1;
    let bestScore = 0;

    recipe.fields.forEach((saved, index) => {
      if (used.has(index)) return;
      const score = similarity(field, saved);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex >= 0 && bestScore >= 5) {
      const saved = recipe.fields[bestIndex];
      used.add(bestIndex);
      mappings.push({
        key: field.key,
        businessField: saved.businessField,
        confidence: Math.max(0.9, saved.confidence),
        selectValue: saved.selectValue,
        reason: "Matched learned directory recipe."
      });
    } else {
      mappings.push({
        key: field.key,
        businessField: "skip",
        confidence: 0.4,
        reason: "No recipe match."
      });
    }
  }

  return {
    mappings,
    matched: used.size,
    coverage: fields.length ? used.size / fields.length : 0
  };
}

export async function loadRecipe(input: {
  directory: string;
  domain: string;
}) {
  try {
    const raw = await readFile(join(input.directory, filename(input.domain)), "utf8");
    const parsed = JSON.parse(raw) as DirectoryRecipe;
    return parsed.version === 1 ? parsed : undefined;
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: string }).code)
        : "";

    if (code === "ENOENT") return undefined;
    throw error;
  }
}

export async function saveRecipe(input: {
  directory: string;
  recipe: DirectoryRecipe;
}) {
  await mkdir(input.directory, { recursive: true });
  const path = join(input.directory, filename(input.recipe.domain));
  await writeFile(path, JSON.stringify(input.recipe, null, 2), "utf8");
  return path;
}

export async function markRecipeSuccess(input: {
  directory: string;
  domain: string;
  verificationObserved?: boolean;
}) {
  const recipe = await loadRecipe(input);
  if (!recipe) return undefined;

  const now = new Date().toISOString();
  const updated: DirectoryRecipe = {
    ...recipe,
    lastValidatedAt: now,
    lastSuccessfulAt: now,
    verificationObserved:
      input.verificationObserved ?? recipe.verificationObserved
  };

  await saveRecipe({ directory: input.directory, recipe: updated });
  return updated;
}

export async function listRecipes(directory: string) {
  try {
    const files = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    const recipes: DirectoryRecipe[] = [];

    for (const name of files) {
      try {
        const parsed = JSON.parse(
          await readFile(join(directory, name), "utf8")
        ) as DirectoryRecipe;
        if (parsed.version === 1) recipes.push(parsed);
      } catch {
        // Ignore individual corrupted recipe files; the worker can relearn them.
      }
    }

    return recipes.sort((a, b) =>
      b.lastValidatedAt.localeCompare(a.lastValidatedAt)
    );
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "ENOENT") return [];
    throw error;
  }
}
