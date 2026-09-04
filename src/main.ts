import { app, BrowserWindow, clipboard, ipcMain, safeStorage, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import type { CompanionConfig, CompanionStateResult, PairingClaimResult, PlaybackStatus } from "./types";

const DEFAULT_API_BASE = "https://local-ai-production.up.railway.app";

let mainWindow: BrowserWindow | null = null;
let requestWindow: BrowserWindow | null = null;
let staticServer: Server | null = null;

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function configPath(): string {
  return join(app.getPath("userData"), "music-companion-config.json");
}

function readRawConfig(): CompanionConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), "utf8")) as CompanionConfig;
    return { ...parsed, apiBaseUrl: parsed.apiBaseUrl || DEFAULT_API_BASE };
  } catch {
    return { apiBaseUrl: DEFAULT_API_BASE };
  }
}

function readConfig(): CompanionConfig {
  const config = readRawConfig();
  const token = decryptToken(config);
  return {
    ...config,
    deviceToken: token ?? config.deviceToken,
    tokenStorage: token ? tokenStorageMode(config) : "missing",
    storageWarning: storageWarning(config)
  };
}

function publicConfig(config = readConfig()): CompanionConfig {
  const { deviceToken: _deviceToken, deviceTokenEncrypted: _deviceTokenEncrypted, ...safeConfig } = config;
  return safeConfig;
}

function writeConfig(config: CompanionConfig): CompanionConfig {
  mkdirSync(app.getPath("userData"), { recursive: true });
  const previous = readRawConfig();
  const merged = { ...previous, ...config };
  const hasExplicitToken = Object.prototype.hasOwnProperty.call(config, "deviceToken") || Object.prototype.hasOwnProperty.call(config, "deviceTokenEncrypted");
  const token = hasExplicitToken ? (config.deviceToken ?? null) : decryptToken(previous);
  const stored: CompanionConfig = { ...merged };
  delete stored.deviceToken;
  if (token) {
    const encrypted = encryptToken(token);
    if (encrypted) {
      stored.deviceTokenEncrypted = encrypted;
    } else {
      stored.deviceToken = token;
      delete stored.deviceTokenEncrypted;
    }
  } else {
    delete stored.deviceToken;
    delete stored.deviceTokenEncrypted;
  }
  writeFileSync(configPath(), JSON.stringify(stored, null, 2), "utf8");
  return publicConfig({ ...stored, deviceToken: token ?? undefined, tokenStorage: token ? tokenStorageMode(stored) : "missing", storageWarning: storageWarning(stored) });
}

function encryptToken(token: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.encryptString(token).toString("base64");
}

function decryptToken(config: CompanionConfig): string | null {
  if (config.deviceTokenEncrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(config.deviceTokenEncrypted, "base64"));
    } catch {
      return null;
    }
  }
  return config.deviceToken ?? null;
}

function tokenStorageMode(config: CompanionConfig): "safeStorage" | "plain-fallback" | "missing" {
  if (config.deviceTokenEncrypted) return "safeStorage";
  if (config.deviceToken) return "plain-fallback";
  return "missing";
}

function storageWarning(config: CompanionConfig): string | null {
  return tokenStorageMode(config) === "plain-fallback"
    ? "Windows secure storage (safeStorage) is unavailable on this profile: your device token is saved UNENCRYPTED as plain text in music-companion-config.json in this app's data folder. Anyone with access to this Windows account or that file could impersonate this Companion device on your channel. Prefer a Windows profile where safeStorage works, or keep this account locked/protected."
    : null;
}

function contentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

async function startStaticServer(): Promise<string> {
  const root = resolve(__dirname);
  staticServer?.close();
  staticServer = createServer((request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const requested = resolve(root, pathname.replace(/^\/+/, ""));
      const relativeToRoot = relative(root, requested);
      // On Windows, path.relative() across different drive letters returns the absolute
      // target unchanged (not prefixed with ".."), so a request like "/D:/secret.txt"
      // slips past a bare startsWith("..") check. isAbsolute() catches that case too.
      if (relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot) || !existsSync(requested) || !statSync(requested).isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": contentType(requested),
        "Cache-Control": "no-store"
      });
      response.end(readFileSync(requested));
    } catch {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Companion local server error");
    }
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    staticServer?.once("error", rejectListen);
    staticServer?.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = staticServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start Music Companion local UI server.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function createWindow(): Promise<void> {
  const appUrl = await startStaticServer();
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 980,
    minWidth: 980,
    minHeight: 820,
    title: "KPEBA Music Companion",
    backgroundColor: "#0b0f14",
    icon: join(__dirname, "icon.svg"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      preload: join(__dirname, "preload.js")
    }
  });

  // Defense-in-depth: pin the guest <webview>'s security-relevant preferences from the
  // main process instead of trusting the renderer-controlled HTML attributes alone, and
  // deny any popup it tries to open (the YTM webview never legitimately needs one).
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    delete (webPreferences as { preload?: string }).preload;
    delete (webPreferences as { preloadURL?: string }).preloadURL;
    if (!String(params.src || "").startsWith("https://music.youtube.com/")) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on("did-attach-webview", (_event, webContents) => {
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  });

  mainWindow.loadURL(`${appUrl}/index.html`);
  mainWindow.on("close", () => {
    // A fallback YouTube Music popup counts toward getAllWindows(); without this it can
    // outlive the main window, so window-all-closed never fires and the app is stuck
    // headless with no way to bring the UI back.
    closeRequestWindow();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function validateYouTubeMusicUrl(url: string): string {
  const parsed = new URL(String(url || ""));
  if (parsed.protocol !== "https:" || parsed.hostname !== "music.youtube.com") {
    throw new Error("Only music.youtube.com request links are supported.");
  }
  return parsed.toString();
}

function closeRequestWindow(): void {
  if (requestWindow && !requestWindow.isDestroyed()) {
    // close() is async and can be delayed/blocked by the loaded page (e.g. a beforeunload
    // prompt) - let the window's own "closed" handler null the reference so is-open queries
    // keep reflecting reality instead of lying that it already closed.
    requestWindow.close();
  }
}

app.whenReady().then(() => {
  void createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  closeRequestWindow();
  staticServer?.close();
  staticServer = null;
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("config:get", () => publicConfig());

ipcMain.handle("config:save-api-base", (_event, apiBaseUrl: string) => {
  const trimmed = String(apiBaseUrl || "").trim().replace(/\/+$/, "");
  const url = new URL(trimmed || DEFAULT_API_BASE);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("API URL must be http or https.");
  }
  const nextApiBaseUrl = url.toString().replace(/\/+$/, "");
  const previous = readRawConfig();
  const previousHost = previous.apiBaseUrl ? new URL(previous.apiBaseUrl).host : null;
  const hostChanged = Boolean(previousHost) && previousHost !== url.host;
  if (hostChanged && decryptToken(previous)) {
    // The device token authenticates this Companion to whatever host apiBaseUrl points at,
    // and status:get polls that host every few seconds with no further confirmation. Wipe
    // the pairing on a host change instead of silently carrying a real token over to an
    // address the user just typed - re-pairing requires a fresh code from that host's own
    // dashboard, so a token can never be forwarded to an untrusted host automatically.
    return writeConfig({
      apiBaseUrl: nextApiBaseUrl,
      deviceToken: undefined,
      deviceTokenEncrypted: undefined,
      eventsUrl: undefined,
      statusUrl: undefined,
      streamer: undefined
    });
  }
  return writeConfig({ apiBaseUrl: nextApiBaseUrl });
});

ipcMain.handle("pairing:claim", async (_event, code: string, deviceName: string) => {
  const config = readConfig();
  const response = await fetch(`${config.apiBaseUrl}/api/music/companion/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: String(code || "").trim().toUpperCase(), deviceName: String(deviceName || "KPEBA Music Companion").trim() }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const result = (await response.json()) as PairingClaimResult;
  return writeConfig({
    apiBaseUrl: config.apiBaseUrl,
    deviceToken: result.deviceToken,
    eventsUrl: result.eventsUrl,
    statusUrl: result.statusUrl,
    streamer: result.streamer
  });
});

ipcMain.handle("pairing:reset", () => {
  const config = readRawConfig();
  return writeConfig({
    apiBaseUrl: config.apiBaseUrl || DEFAULT_API_BASE,
    deviceToken: undefined,
    deviceTokenEncrypted: undefined,
    eventsUrl: undefined,
    statusUrl: undefined,
    streamer: undefined
  });
});

ipcMain.handle("status:send", async (_event, status: PlaybackStatus) => {
  const config = readConfig();
  if (!config.statusUrl || !config.deviceToken) {
    return { ok: false, skipped: "not paired" };
  }
  const response = await fetch(config.statusUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deviceToken}`
    },
    body: JSON.stringify(status),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
});

ipcMain.handle("state:get", async (): Promise<CompanionStateResult> => {
  const config = readConfig();
  if (!config.deviceToken) {
    return { ok: false, request: null };
  }
  const response = await fetch(`${config.apiBaseUrl}/api/music/companion/state`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.deviceToken}`
    },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<CompanionStateResult>;
});

ipcMain.handle("link:open", (_event, url: string) => {
  const parsed = new URL(String(url || ""));
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only web links are supported.");
  }
  return shell.openExternal(parsed.toString());
});

ipcMain.handle("music-request-window:open", (_event, url: string) => {
  const targetUrl = validateYouTubeMusicUrl(url);
  if (!requestWindow || requestWindow.isDestroyed()) {
    requestWindow = new BrowserWindow({
      width: 960,
      height: 640,
      minWidth: 720,
      minHeight: 420,
      title: "KPEBA Music Request",
      backgroundColor: "#030303",
      icon: join(__dirname, "icon.svg"),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: "persist:youtube-music"
      }
    });
    requestWindow.on("closed", () => {
      requestWindow = null;
    });
  }
  requestWindow.loadURL(targetUrl);
  requestWindow.show();
  requestWindow.focus();
  return { ok: true };
});

ipcMain.handle("music-request-window:close", () => {
  closeRequestWindow();
  return { ok: true };
});

ipcMain.handle("music-request-window:is-open", () => ({ open: Boolean(requestWindow && !requestWindow.isDestroyed()) }));

ipcMain.handle("clipboard:write", (_event, text: string) => {
  clipboard.writeText(String(text || ""));
});
