import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";

function run(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(corepack, args, {
      cwd: root,
      stdio: "inherit",
      env: process.env
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Command failed: corepack ${args.join(" ")}`));
    });
  });
}

function setEnvValue(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }

  return `${content.trimEnd()}\n${line}\n`;
}

async function main() {
  console.log("\n🌊 LinkTide one-time setup\n");

  console.log("1/4 Installing workspace dependencies...");
  await run(["pnpm", "install", "--no-frozen-lockfile"]);

  console.log("\n2/4 Installing Chromium...");
  await run(["pnpm", "install:browsers"]);

  console.log("\n3/4 Preparing local configuration...");
  const envExample = resolve(root, ".env.example");
  const envFile = resolve(root, ".env");

  if (!existsSync(envFile)) {
    await copyFile(envExample, envFile);
    console.log("Created .env from .env.example");
  } else {
    console.log(".env already exists; keeping your current settings.");
  }

  let env = await readFile(envFile, "utf8");
  const currentVaultKey =
    env.match(/^LINKTIDE_VAULT_KEY=(.*)$/m)?.[1]?.trim() ?? "";

  if (!currentVaultKey) {
    const vaultKey = randomBytes(32).toString("base64url");
    env = setEnvValue(env, "LINKTIDE_VAULT_KEY", vaultKey);
    await writeFile(envFile, env, "utf8");
    console.log("Generated and saved a local credential-vault key.");
  } else {
    console.log("Existing credential-vault key found.");
  }

  await mkdir(resolve(root, "data", "directories"), { recursive: true });

  console.log("\n4/4 Setup complete.");
  console.log("\nNext:");
  console.log("  1. Open .env and add your LM Studio tunnel/model and Brave Search API key.");
  console.log("  2. Run: pnpm start");
  console.log("\nThat single start command runs both the dashboard and local worker.\n");
}

main().catch((error) => {
  console.error("\nLinkTide setup failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
