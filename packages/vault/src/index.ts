import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type DirectoryCredential = {
  domain: string;
  email: string;
  username?: string;
  password: string;
  createdAt: string;
  updatedAt: string;
  verified: boolean;
};

type EncryptedValue = {
  iv: string;
  tag: string;
  ciphertext: string;
};

type VaultFile = {
  version: 1;
  records: Record<string, EncryptedValue>;
};

function normalizeDomain(value: string) {
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
}

function deriveKey(masterKey: string) {
  if (masterKey.trim().length < 24) {
    throw new Error(
      "LINKTIDE_VAULT_KEY must be at least 24 characters. Run pnpm worker:key to generate one."
    );
  }

  return createHash("sha256").update(masterKey).digest();
}

function encrypt(masterKey: string, value: DirectoryCredential): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(masterKey), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decrypt(
  masterKey: string,
  value: EncryptedValue
): DirectoryCredential {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(masterKey),
    Buffer.from(value.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final()
  ]);

  return JSON.parse(plaintext.toString("utf8")) as DirectoryCredential;
}

async function readVault(path: string): Promise<VaultFile> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as VaultFile;

    if (parsed.version !== 1 || !parsed.records) {
      throw new Error("Unsupported credential vault format.");
    }

    return parsed;
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: string }).code)
        : "";

    if (code === "ENOENT") {
      return { version: 1, records: {} };
    }

    throw error;
  }
}

async function writeVault(path: string, vault: VaultFile) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(vault, null, 2), {
    encoding: "utf8",
    mode: 0o600
  });
}

export function generateVaultKey() {
  return randomBytes(32).toString("base64url");
}

export function generateDirectoryPassword(length = 24) {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%*-_=+?";
  const all = lower + upper + digits + symbols;

  const chars = [
    lower[randomInt(lower.length)],
    upper[randomInt(upper.length)],
    digits[randomInt(digits.length)],
    symbols[randomInt(symbols.length)]
  ];

  while (chars.length < Math.max(length, 16)) {
    chars.push(all[randomInt(all.length)]);
  }

  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }

  return chars.join("");
}

export async function getCredential(input: {
  path: string;
  masterKey: string;
  domain: string;
}) {
  const domain = normalizeDomain(input.domain);
  const vault = await readVault(input.path);
  const encrypted = vault.records[domain];

  if (!encrypted) return undefined;
  return decrypt(input.masterKey, encrypted);
}

export async function putCredential(input: {
  path: string;
  masterKey: string;
  credential: Omit<DirectoryCredential, "createdAt" | "updatedAt"> &
    Partial<Pick<DirectoryCredential, "createdAt">>;
}) {
  const domain = normalizeDomain(input.credential.domain);
  const vault = await readVault(input.path);
  const existing = vault.records[domain]
    ? decrypt(input.masterKey, vault.records[domain])
    : undefined;
  const now = new Date().toISOString();

  const credential: DirectoryCredential = {
    ...input.credential,
    domain,
    createdAt: input.credential.createdAt ?? existing?.createdAt ?? now,
    updatedAt: now
  };

  vault.records[domain] = encrypt(input.masterKey, credential);
  await writeVault(input.path, vault);

  return credential;
}

export async function markCredentialVerified(input: {
  path: string;
  masterKey: string;
  domain: string;
  verified: boolean;
}) {
  const current = await getCredential(input);
  if (!current) return undefined;

  return putCredential({
    path: input.path,
    masterKey: input.masterKey,
    credential: {
      ...current,
      verified: input.verified
    }
  });
}

export async function credentialVaultStatus(input: {
  path: string;
  masterKey?: string;
}) {
  const vault = await readVault(input.path);
  const domains = Object.keys(vault.records);

  if (!input.masterKey) {
    return {
      configured: false,
      credentials: domains.length,
      domains
    };
  }

  const verified = domains.reduce((count, domain) => {
    try {
      return decrypt(input.masterKey as string, vault.records[domain]).verified
        ? count + 1
        : count;
    } catch {
      return count;
    }
  }, 0);

  return {
    configured: true,
    credentials: domains.length,
    verified,
    domains
  };
}
