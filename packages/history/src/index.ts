import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type SubmissionHistoryStatus =
  | "pending"
  | "verification_required"
  | "live"
  | "rejected"
  | "needs_attention"
  | "failed";

export type BacklinkRel = {
  nofollow: boolean;
  ugc: boolean;
  sponsored: boolean;
};

export type SubmissionHistoryRecord = {
  id: string;
  businessName: string;
  businessWebsite: string;
  domain: string;
  opportunityUrl: string;
  submissionUrl?: string;
  listingUrl?: string;
  status: SubmissionHistoryStatus;
  submissionStatus?: string;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt?: string;
  backlinkFound: boolean;
  backlinkUrl?: string;
  backlinkText?: string;
  backlinkRel?: BacklinkRel;
  httpStatus?: number;
  verificationNote?: string;
  reasons: string[];
};

type HistoryFile = {
  version: 1;
  records: SubmissionHistoryRecord[];
};

function emptyHistory(): HistoryFile {
  return { version: 1, records: [] };
}

async function readHistory(path: string): Promise<HistoryFile> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as HistoryFile;

    if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
      throw new Error("Unsupported LinkTide submission-history format.");
    }

    return parsed;
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: string }).code)
        : "";

    if (code === "ENOENT") return emptyHistory();
    throw error;
  }
}

async function writeHistory(path: string, file: HistoryFile) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;

  await writeFile(temp, JSON.stringify(file, null, 2), {
    encoding: "utf8",
    mode: 0o600
  });

  await rename(temp, path);
}

export async function listSubmissionHistory(path: string) {
  const file = await readHistory(path);
  return file.records
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getSubmissionHistoryRecord(path: string, id: string) {
  const file = await readHistory(path);
  return file.records.find((record) => record.id === id);
}

export async function createSubmissionHistoryRecord(input: {
  path: string;
  businessName: string;
  businessWebsite: string;
  domain: string;
  opportunityUrl: string;
  submissionUrl?: string;
  listingUrl?: string;
  status: SubmissionHistoryStatus;
  submissionStatus?: string;
  submitted?: boolean;
  reasons?: string[];
}) {
  const file = await readHistory(input.path);
  const now = new Date().toISOString();

  const record: SubmissionHistoryRecord = {
    id: randomUUID(),
    businessName: input.businessName,
    businessWebsite: input.businessWebsite,
    domain: input.domain,
    opportunityUrl: input.opportunityUrl,
    submissionUrl: input.submissionUrl,
    listingUrl: input.listingUrl,
    status: input.status,
    submissionStatus: input.submissionStatus,
    submittedAt: input.submitted ? now : undefined,
    createdAt: now,
    updatedAt: now,
    backlinkFound: false,
    reasons: input.reasons ?? []
  };

  file.records.unshift(record);
  file.records = file.records.slice(0, 2000);
  await writeHistory(input.path, file);

  return record;
}

export async function updateSubmissionHistoryRecord(
  path: string,
  id: string,
  update:
    | Partial<SubmissionHistoryRecord>
    | ((current: SubmissionHistoryRecord) => Partial<SubmissionHistoryRecord>)
) {
  const file = await readHistory(path);
  const index = file.records.findIndex((record) => record.id === id);

  if (index < 0) return undefined;

  const current = file.records[index];
  const patch = typeof update === "function" ? update(current) : update;

  const next: SubmissionHistoryRecord = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString()
  };

  file.records[index] = next;
  await writeHistory(path, file);

  return next;
}

export async function deleteSubmissionHistoryRecord(path: string, id: string) {
  const file = await readHistory(path);
  const before = file.records.length;
  file.records = file.records.filter((record) => record.id !== id);

  if (file.records.length === before) return false;

  await writeHistory(path, file);
  return true;
}
