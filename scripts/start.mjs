import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";
const children = new Set();
let shuttingDown = false;

function launch(label, args) {
  const child = spawn(corepack, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env
  });

  children.add(child);

  child.on("error", (error) => {
    console.error(`[${label}] failed to start:`, error.message);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    children.delete(child);

    if (shuttingDown) return;

    if (signal) {
      console.error(`[${label}] exited from signal ${signal}.`);
      shutdown(1);
      return;
    }

    if (code !== 0) {
      console.error(`[${label}] exited with code ${code ?? "unknown"}.`);
      shutdown(code ?? 1);
    }
  });

  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }

  setTimeout(() => process.exit(code), 250);
}

console.log("\n🌊 Starting LinkTide...");
console.log("Dashboard + browser worker will share this terminal.");
console.log("Press Ctrl+C once to stop both.\n");

launch("worker", ["pnpm", "worker"]);
launch("dashboard", ["pnpm", "dev"]);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
