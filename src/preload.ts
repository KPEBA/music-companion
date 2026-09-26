import { contextBridge, ipcRenderer } from "electron";
import type { CompanionConfig, CompanionStateResult, PlaybackStatus } from "./types";

type DeepLinkClaimResult = { ok: true; config: CompanionConfig } | { ok: false; error: string };

contextBridge.exposeInMainWorld("kpebaMusic", {
  getConfig: (): Promise<CompanionConfig> => ipcRenderer.invoke("config:get"),
  saveApiBase: (apiBaseUrl: string): Promise<CompanionConfig> => ipcRenderer.invoke("config:save-api-base", apiBaseUrl),
  claimPairing: (code: string, deviceName: string): Promise<CompanionConfig> => ipcRenderer.invoke("pairing:claim", code, deviceName),
  resetPairing: (): Promise<CompanionConfig> => ipcRenderer.invoke("pairing:reset"),
  // Fired when the OS opens a kpeba-music://pair?code=... link and main.ts auto-claims it,
  // so the UI can react (refresh config / show success or error) without the user typing
  // anything. Returns an unsubscribe function.
  onDeepLinkClaimed: (callback: (result: DeepLinkClaimResult) => void): (() => void) => {
    const listener = (_event: unknown, result: DeepLinkClaimResult) => callback(result);
    ipcRenderer.on("pairing:claimed", listener);
    return () => ipcRenderer.removeListener("pairing:claimed", listener);
  },
  sendStatus: (status: PlaybackStatus): Promise<{ ok: boolean }> => ipcRenderer.invoke("status:send", status),
  getCompanionState: (): Promise<CompanionStateResult> => ipcRenderer.invoke("state:get"),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("link:open", url),
  openMusicRequestWindow: (url: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("music-request-window:open", url),
  closeMusicRequestWindow: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("music-request-window:close"),
  isMusicRequestWindowOpen: (): Promise<{ open: boolean }> => ipcRenderer.invoke("music-request-window:is-open"),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke("clipboard:write", text)
});
