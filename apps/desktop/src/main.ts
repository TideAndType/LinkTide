import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  shell,
  type MenuItemConstructorOptions
} from "electron";
import { createServer, type Server } from "node:http";
import { existsSync, createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { extname, join, normalize, resolve } from "node:path";
import { spawn } from "node:child_process";

let mainWindow: BrowserWindow | null = null;
let staticServer: Server | null = null;
let workerClose: (() => Promise<void>) | null = null;
let dashboardUrl = "";
let quitting = false;

const dashboardPort = 4316;
const workerPort = 4317;

function mimeType(pathname: string) {
  const ext = extname(pathname).toLowerCase();
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
  };
  return types[ext] ?? "application/octet-stream";
}

async function startDashboardServer(root: string) {
  staticServer = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";

      const safePath = normalize(pathname).replace(/^([.][.][/\\])+/, "");
      const filePath = resolve(root, `.${safePath}`);

      if (!filePath.startsWith(resolve(root))) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      let target = filePath;
      let info = await stat(target).catch(() => null);

      if (info?.isDirectory()) {
        target = join(target, "index.html");
        info = await stat(target).catch(() => null);
      }

      if (!info?.isFile()) {
        const fallback = join(root, "index.html");
        if (!existsSync(fallback)) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        target = fallback;
      }

      res.writeHead(200, {
        "content-type": mimeType(target),
        "cache-control": "no-store"
      });
      createReadStream(target).pipe(res);
    } catch {
      res.writeHead(500);
      res.end("LinkTide dashboard error");
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    staticServer?.once("error", reject);
    staticServer?.listen(dashboardPort, "127.0.0.1", () => resolvePromise());
  });

  const address = staticServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start the LinkTide dashboard.");
  }

  dashboardUrl = `http://127.0.0.1:${dashboardPort}`;
  return dashboardUrl;
}

function playwrightCliPath() {
  const packageJson = require.resolve("playwright/package.json");
  return join(packageJson, "..", "cli.js");
}

async function ensureAutomationBrowser(splash?: BrowserWindow) {
  const browsersPath = join(app.getPath("userData"), "playwright-browsers");
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;

  const { chromium } = await import("playwright");
  const executable = chromium.executablePath();

  if (existsSync(executable)) return;

  splash?.webContents.send("linktide-status", "Installing browser automation engine…");

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [playwrightCliPath(), "install", "chromium"],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          PLAYWRIGHT_BROWSERS_PATH: browsersPath
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    child.stdout?.on("data", (chunk) => {
      console.log(String(chunk).trim());
    });
    child.stderr?.on("data", (chunk) => {
      console.error(String(chunk).trim());
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Chromium installation exited with code ${code}`));
    });
  });
}

function createSplash() {
  const splash = new BrowserWindow({
    width: 520,
    height: 300,
    resizable: false,
    frame: false,
    show: true,
    backgroundColor: "#07110f",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const html = encodeURIComponent(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
html,body{height:100%;margin:0;background:#07110f;color:#edf7f4;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{display:grid;place-items:center}
.wrap{text-align:center;padding:32px}
.mark{font-weight:900;letter-spacing:.22em;font-size:12px;color:#66d6b6}
h1{font-size:42px;letter-spacing:-.05em;margin:10px 0 12px}
p{color:#93a8a1;line-height:1.6;margin:0}
.dot{width:9px;height:9px;border-radius:50%;background:#62e2bc;display:inline-block;margin-right:8px;animation:p 1.1s ease-in-out infinite}
@keyframes p{50%{opacity:.3;transform:scale(.7)}}
</style>
</head>
<body><div class="wrap"><div class="mark">LINKTIDE</div><h1>Starting up</h1><p><span class="dot"></span>Preparing your local automation engine…</p></div></body>
</html>`);

  void splash.loadURL(`data:text/html;charset=utf-8,${html}`);
  return splash;
}

function createMainWindow(url: string) {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1040,
    minHeight: 720,
    title: "LinkTide",
    backgroundColor: "#07110f",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) {
      void shell.openExternal(target);
    }
    return { action: "deny" };
  });

  void window.loadURL(url);
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    mainWindow = null;
  });

  return window;
}

type GitHubRelease = {
  tag_name: string;
  html_url: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
};

function versionParts(value: string) {
  return value
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part.replace(/[^0-9].*$/, ""), 10) || 0);
}

function isNewerVersion(candidate: string, current: string) {
  const a = versionParts(candidate);
  const b = versionParts(current);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }

  return false;
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const response = await fetch(
    "https://api.github.com/repos/TideAndType/LinkTide/releases/latest",
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": `LinkTide/${app.getVersion()}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub update check failed with status ${response.status}.`);
  }

  return (await response.json()) as GitHubRelease;
}

async function downloadReleaseDmg(release: GitHubRelease) {
  const asset =
    release.assets.find((item) =>
      /LinkTide-.*-mac-universal\.dmg$/i.test(item.name)
    ) ??
    release.assets.find((item) => item.name.toLowerCase().endsWith(".dmg"));

  if (!asset) {
    throw new Error("The latest LinkTide release does not contain a DMG.");
  }

  const response = await fetch(asset.browser_download_url, {
    headers: {
      accept: "application/octet-stream",
      "user-agent": `LinkTide/${app.getVersion()}`
    }
  });

  if (!response.ok || !response.body) {
    throw new Error(`Could not download the update (${response.status}).`);
  }

  const target = join(app.getPath("downloads"), asset.name);
  const destination = createWriteStream(target);
  const readable = Readable.fromWeb(
    response.body as import("node:stream/web").ReadableStream
  );

  await new Promise<void>((resolvePromise, reject) => {
    readable.pipe(destination);
    destination.on("finish", () => resolvePromise());
    destination.on("error", reject);
    readable.on("error", reject);
  });

  return target;
}

async function checkForPersonalUpdate(options?: { quiet?: boolean }) {
  if (!app.isPackaged) {
    if (!options?.quiet) {
      await dialog.showMessageBox({
        message: "Update checks are available in packaged LinkTide builds."
      });
    }
    return;
  }

  try {
    const release = await fetchLatestRelease();
    const current = app.getVersion();

    if (!isNewerVersion(release.tag_name, current)) {
      if (!options?.quiet) {
        await dialog.showMessageBox({
          type: "info",
          title: "LinkTide is up to date",
          message: `You’re running LinkTide ${current}.`,
          detail: "No newer GitHub release is available."
        });
      }
      return;
    }

    const result = await dialog.showMessageBox({
      type: "info",
      title: "LinkTide Update Available",
      message: `LinkTide ${release.tag_name.replace(/^v/i, "")} is available.`,
      detail:
        "LinkTide can download and open the new DMG. Drag the new LinkTide app over the old one in Applications to update.",
      buttons: ["Download Update", "Later", "View Release"],
      defaultId: 0,
      cancelId: 1
    });

    if (result.response === 2) {
      await shell.openExternal(release.html_url);
      return;
    }

    if (result.response !== 0) return;

    const progress = new BrowserWindow({
      width: 460,
      height: 190,
      resizable: false,
      minimizable: false,
      maximizable: false,
      parent: mainWindow ?? undefined,
      modal: Boolean(mainWindow),
      show: false,
      backgroundColor: "#07110f",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    const progressHtml = encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{height:100%;margin:0;background:#07110f;color:#edf7f4;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{display:grid;place-items:center}.wrap{text-align:center;padding:28px}.mark{font-weight:900;letter-spacing:.18em;font-size:11px;color:#66d6b6}
h2{margin:10px 0 8px;font-size:24px}p{margin:0;color:#93a8a1;line-height:1.5}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#62e2bc;margin-right:7px;animation:p 1s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
</style></head><body><div class="wrap"><div class="mark">LINKTIDE</div><h2>Downloading update</h2><p><span class="dot"></span>Saving the new DMG to Downloads…</p></div></body></html>`);

    await progress.loadURL(`data:text/html;charset=utf-8,${progressHtml}`);
    progress.once("ready-to-show", () => progress.show());

    try {
      const dmgPath = await downloadReleaseDmg(release);
      progress.close();
      const openError = await shell.openPath(dmgPath);

      if (openError) {
        throw new Error(openError);
      }

      await dialog.showMessageBox({
        type: "info",
        title: "Update downloaded",
        message: "The new LinkTide DMG is open.",
        detail:
          "Drag LinkTide into Applications and choose Replace. Then reopen LinkTide."
      });
    } catch (error) {
      progress.close();
      throw error;
    }
  } catch (error) {
    if (!options?.quiet) {
      await dialog.showMessageBox({
        type: "error",
        title: "Update check failed",
        message: "LinkTide could not check for updates.",
        detail: error instanceof Error ? error.message : "Unknown update error."
      });
    } else {
      console.error(
        "LinkTide update check:",
        error instanceof Error ? error.message : error
      );
    }
  }
}

function configureUpdater() {
  if (!app.isPackaged) return;

  setTimeout(() => {
    void checkForPersonalUpdate({ quiet: true });
  }, 5000);

  setInterval(() => {
    void checkForPersonalUpdate({ quiet: true });
  }, 4 * 60 * 60 * 1000);
}

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "LinkTide",
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates…",
          click: () => {
            if (!app.isPackaged) {
              void dialog.showMessageBox({
                message: "Updates are checked in packaged LinkTide builds."
              });
              return;
            }
            void checkForPersonalUpdate();
          }
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { role: "front" }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

async function startLinkTide() {
  const splash = createSplash();

  process.env.LINKTIDE_EMBEDDED = "1";
  process.env.LINKTIDE_WORKER_PORT = String(workerPort);
  process.env.LINKTIDE_DATA_DIR = join(app.getPath("userData"), "data");
  process.env.LINKTIDE_BROWSER_PROFILE = join(
    app.getPath("userData"),
    "browser-profile"
  );
  process.env.LINKTIDE_HEADLESS = "false";

  try {
    await ensureAutomationBrowser(splash);

    const worker = await import("@linktide/worker");
    const handle = await worker.startWorkerServer();
    workerClose = handle.close;

    const dashboardRoot = app.isPackaged
      ? join(process.resourcesPath, "dashboard")
      : resolve(process.cwd(), "apps/dashboard/out");

    const url = await startDashboardServer(dashboardRoot);
    mainWindow = createMainWindow(url);
    splash.destroy();

    buildMenu();
    configureUpdater();
  } catch (error) {
    splash.destroy();
    const message =
      error instanceof Error ? error.message : "LinkTide could not start.";

    await dialog.showMessageBox({
      type: "error",
      title: "LinkTide Startup Error",
      message: "LinkTide could not start.",
      detail: message
    });

    app.quit();
  }
}

app.whenReady().then(startLinkTide);

app.on("activate", () => {
  if (!mainWindow && dashboardUrl) {
    mainWindow = createMainWindow(dashboardUrl);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", (event) => {
  if (!quitting) return;

  if (workerClose || staticServer) {
    event.preventDefault();
    const closeWorker = workerClose?.() ?? Promise.resolve();
    workerClose = null;

    const closeStatic = new Promise<void>((resolvePromise) => {
      if (!staticServer) {
        resolvePromise();
        return;
      }
      staticServer.close(() => resolvePromise());
      staticServer = null;
    });

    void Promise.allSettled([closeWorker, closeStatic]).finally(() => {
      app.exit(0);
    });
  }
});
