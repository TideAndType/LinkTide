import type { FormFieldDescriptor } from "@linktide/browser";
import type { createLmStudioClient } from "@linktide/lm-studio";

type LmClient = ReturnType<typeof createLmStudioClient>;

export type BusinessField =
  | "name"
  | "website"
  | "phone"
  | "email"
  | "contactName"
  | "address1"
  | "address2"
  | "city"
  | "state"
  | "postalCode"
  | "country"
  | "primaryCategory"
  | "descriptionShort"
  | "descriptionLong"
  | "serviceAreas"
  | "services"
  | "facebook"
  | "linkedin"
  | "instagram"
  | "logoPath"
  | "skip";

export type BusinessSubmissionProfile = {
  name: string;
  website: string;
  phone?: string;
  email?: string;
  contactName?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  primaryCategory?: string;
  descriptionShort?: string;
  descriptionLong?: string;
  serviceAreas?: string[];
  services?: string[];
  facebook?: string;
  linkedin?: string;
  instagram?: string;
  logoPath?: string;
};

export type FieldMapping = {
  key: string;
  businessField: BusinessField;
  confidence: number;
  selectValue?: string;
  reason?: string;
};

const allowedFields = new Set<BusinessField>([
  "name",
  "website",
  "phone",
  "email",
  "contactName",
  "address1",
  "address2",
  "city",
  "state",
  "postalCode",
  "country",
  "primaryCategory",
  "descriptionShort",
  "descriptionLong",
  "serviceAreas",
  "services",
  "facebook",
  "linkedin",
  "instagram",
  "logoPath",
  "skip"
]);

function haystack(field: FormFieldDescriptor) {
  return `${field.name} ${field.id} ${field.label} ${field.placeholder}`
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function heuristicMapping(field: FormFieldDescriptor): FieldMapping {
  const text = haystack(field);

  if (
    field.type === "password" ||
    field.type === "checkbox" ||
    field.type === "radio" ||
    /(captcha|password|username|coupon|promo|credit card|card number|cvv|cvc)/.test(text)
  ) {
    return { key: field.key, businessField: "skip", confidence: 1 };
  }

  const candidates: Array<[RegExp, BusinessField, number]> = [
    [/(business|company|organization).*(name)|^name$|business name/, "name", 0.98],
    [/(website|homepage|web site|site url|business url|url)/, "website", 0.98],
    [/(phone|telephone|mobile)/, "phone", 0.98],
    [/(e mail|email)/, "email", 0.98],
    [/(contact).*(name)|your name|owner name|representative/, "contactName", 0.88],
    [/(address 2|address line 2|suite|unit|apt)/, "address2", 0.94],
    [/(street|address 1|address line 1|business address|^address$)/, "address1", 0.94],
    [/(city|town)/, "city", 0.97],
    [/(state|province|region)/, "state", 0.95],
    [/(zip|postal)/, "postalCode", 0.98],
    [/(country)/, "country", 0.98],
    [/(category|industry|business type|business category)/, "primaryCategory", 0.92],
    [/(short description|tagline|summary|brief description)/, "descriptionShort", 0.93],
    [/(description|about|business details|company bio|overview)/, "descriptionLong", 0.88],
    [/(service area|areas served|locations served)/, "serviceAreas", 0.9],
    [/(services|specialties|expertise)/, "services", 0.84],
    [/(facebook)/, "facebook", 0.99],
    [/(linkedin)/, "linkedin", 0.99],
    [/(instagram)/, "instagram", 0.99],
    [/(logo|brand image|business image)/, "logoPath", 0.97]
  ];

  for (const [pattern, businessField, confidence] of candidates) {
    if (pattern.test(text)) {
      return { key: field.key, businessField, confidence };
    }
  }

  return {
    key: field.key,
    businessField: "skip",
    confidence: field.required ? 0.35 : 0.65,
    reason: "No safe deterministic mapping."
  };
}

function normalizeMapping(
  field: FormFieldDescriptor,
  value: Partial<FieldMapping> | undefined
): FieldMapping {
  const businessField = allowedFields.has(value?.businessField as BusinessField)
    ? (value?.businessField as BusinessField)
    : "skip";

  return {
    key: field.key,
    businessField,
    confidence:
      typeof value?.confidence === "number"
        ? Math.max(0, Math.min(1, value.confidence))
        : 0.5,
    selectValue:
      typeof value?.selectValue === "string" ? value.selectValue.slice(0, 240) : undefined,
    reason: typeof value?.reason === "string" ? value.reason.slice(0, 300) : undefined
  };
}

export function mapFieldsHeuristically(fields: FormFieldDescriptor[]) {
  return fields.map(heuristicMapping);
}

export async function mapFieldsWithLmStudio(
  client: LmClient,
  fields: FormFieldDescriptor[],
  profile: BusinessSubmissionProfile
) {
  const response = await client.json<{ items?: FieldMapping[] }>([
    {
      role: "system",
      content:
        "You map third-party business-directory form fields to LinkTide business-profile fields. Never map passwords, CAPTCHA, payment/card fields, legal/terms consent, verification codes, or unrelated personal questions. Use skip for those. Preserve every key exactly. Confidence is 0-1. For select fields, selectValue may be one exact option value from the provided options when a clear choice exists. Return JSON only as {\"items\":[...]}. Do not invent business facts."
    },
    {
      role: "user",
      content: JSON.stringify({
        availableProfileFields: Object.keys(profile).filter(
          (key) => Boolean(profile[key as keyof BusinessSubmissionProfile])
        ),
        fields
      })
    }
  ]);

  const byKey = new Map((response.items ?? []).map((item) => [item.key, item]));

  return fields.map((field) =>
    normalizeMapping(field, byKey.get(field.key) ?? heuristicMapping(field))
  );
}

export function calculateMappingQuality(
  fields: FormFieldDescriptor[],
  mappings: FieldMapping[]
) {
  const byKey = new Map(mappings.map((mapping) => [mapping.key, mapping]));
  const useful = mappings.filter((mapping) => mapping.businessField !== "skip");
  const averageConfidence = useful.length
    ? useful.reduce((sum, mapping) => sum + mapping.confidence, 0) / useful.length
    : 0;

  const requiredUnmapped = fields.filter((field) => {
    if (!field.required) return false;
    const mapping = byKey.get(field.key);
    return !mapping || mapping.businessField === "skip" || mapping.confidence < 0.75;
  });

  return {
    averageConfidence,
    mappedCount: useful.length,
    requiredUnmapped: requiredUnmapped.map((field) => ({
      key: field.key,
      label: field.label || field.name || field.placeholder || field.type
    }))
  };
}
