const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, Menu, shell } = require("electron");

let mainWindow;
let startedServer;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  mainWindow = createMainWindow();
  mainWindow.loadURL(loadingPage());

  try {
    startedServer = await startBundledServer();
    console.log(`Bonehawk Canvas desktop server listening on ${startedServer.url}`);
    await mainWindow.loadURL(`${startedServer.url}/index.html`);
  } catch (error) {
    console.error("Desktop startup failed", error);
    await mainWindow.loadURL(errorPage(error));
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
    if (startedServer) await mainWindow.loadURL(`${startedServer.url}/index.html`);
  }
});

app.on("before-quit", async (event) => {
  if (!startedServer) return;

  event.preventDefault();
  const server = startedServer;
  startedServer = undefined;
  await server.close().catch((error) => console.error("Server shutdown failed", error));
  app.quit();
});

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "Bonehawk Canvas",
    backgroundColor: "#050607",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isLocalAppUrl(url)) return;
    if (url.startsWith("data:text/html")) return;

    event.preventDefault();
    shell.openExternal(url);
  });

  return window;
}

function isLocalAppUrl(url) {
  if (!startedServer) return false;

  try {
    return new URL(url).origin === new URL(startedServer.url).origin;
  } catch (_error) {
    return false;
  }
}

async function startBundledServer() {
  const appPath = app.getAppPath();
  const userData = app.getPath("userData");
  process.env.CANVAS_BASE_URL ||= "https://canvas.instructure.com";
  process.env.PORT = "0";
  process.env.ALLOWED_ORIGINS ||= "http://localhost:3000,http://127.0.0.1:3000";
  process.env.TOKEN_STORE_PATH ||= path.join(userData, "canvas-oauth-tokens.json");
  process.env.IMPORT_STORE_PATH ||= path.join(userData, "imported-canvas-snapshot.json");
  process.env.SYLLABUS_STORE_PATH ||= path.join(userData, "uploaded-syllabi.json");

  const [{ startCanvasBotServer }, { loadEnv }] = await Promise.all([
    import(pathToFileURL(path.join(appPath, "dist", "src", "appRuntime.js")).href),
    import(pathToFileURL(path.join(appPath, "dist", "src", "config", "env.js")).href)
  ]);
  const env = loadEnv(process.env);

  return startCanvasBotServer({
    env,
    port: 0,
    host: "127.0.0.1",
    publicDir: path.join(appPath, "public"),
    enableScheduler: false
  });
}

function loadingPage() {
  return dataPage("Starting Bonehawk Canvas", "Opening the local workspace...");
}

function errorPage(error) {
  const message = error instanceof Error ? error.message : "The desktop app could not start.";
  return dataPage("Could not start", message);
}

function dataPage(title, message) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(title)}</title>
        <style>
          body {
            min-height: 100vh;
            margin: 0;
            display: grid;
            place-items: center;
            background: #050607;
            color: #e6f2df;
            font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
          }
          main {
            width: min(560px, calc(100vw - 40px));
            border: 1px solid rgba(152,255,182,.24);
            padding: 22px;
            background: #0e1211;
          }
          h1 {
            margin: 0 0 10px;
            color: #98ffb6;
            font-size: 18px;
            text-transform: uppercase;
          }
          p { margin: 0; color: #8a9987; }
        </style>
      </head>
      <body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
    </html>
  `)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
