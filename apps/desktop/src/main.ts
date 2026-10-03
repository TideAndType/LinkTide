import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  shell,
  type MenuItemConstructorOptions
} from "electron";
import { autoUpdater } from "electron-updater";
import { createServer, type Server } from "node:http";
import { existsSync, createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { spawn } from "node:child_process";

let mainWindow: BrowserWindow | null = null;
let staticServer: Server | null = null;
let workerClose: (() => Promise<void>) | null = null;
let dashboardUrl = "";
let quitting = false;

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
        "cache-control": app.isPackaged
          ? "public, max-age=31536000, immutable"
          : "no-store"
      });
      createReadStream(target).pipe(res);
    } catch {
      res.writeHead(500);
      res.end("LinkTide dashboard error");
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    staticServer?.once("error", reject);
    staticServer?.listen(0, "127.0.0.1", () => resolvePromise());
  });

  const address = staticServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start the LinkTide dashboard.");
  }

  dashboardUrl = `http://127.0.0.1:${address.port}`;
  return dashboardUrl;
}

function playwrightCliPath() {
  return require.resolve("playwright/cli");
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

function configureUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", async (info) => {
    const result = await dialog.showMessageBox({
      type: "info",
      title: "LinkTide Update Ready",
      message: `LinkTide ${info.version} is ready to install.`,
      detail: "Restart LinkTide now to finish updating.",
      buttons: ["Restart & Update", "Later"],
      defaultId: 0,
      cancelId: 1
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", (error) => {
    console.error("LinkTide updater:", error.message);
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
  }, 4000);

  setInterval(() => {
    void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
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
            void autoUpdater.checkForUpdatesAndNotify();
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
