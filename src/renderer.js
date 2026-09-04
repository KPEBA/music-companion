const api = window.kpebaMusic;

const YOUTUBE_IFRAME_API_URL = "https://www.youtube.com/iframe_api";
const YOUTUBE_MUSIC_URL = "https://music.youtube.com/";
const PLAYER_READY_TIMEOUT_MS = 15000;
const YOUTUBE_MUSIC_FILL_CSS = `
  html,
  body,
  ytmusic-app,
  ytmusic-app-layout {
    width: 100vw !important;
    min-width: 100vw !important;
    max-width: 100vw !important;
    height: 100vh !important;
    min-height: 100vh !important;
    background: #030303 !important;
    overflow-x: hidden !important;
  }

  ytmusic-app-layout,
  #layout,
  #content,
  #page-manager,
  ytmusic-browse-response,
  ytmusic-section-list-renderer,
  ytmusic-player-page {
    min-height: calc(100vh - 96px) !important;
  }
`;

const state = {
  config: null,
  eventSource: null,
  backgroundPlayer: null,
  requestPlayer: null,
  activeRequest: null,
  requestGeneration: 0,
  pollInFlight: false,
  statusInFlight: false,
  backgroundVideoId: null,
  youtubeMusicLoaded: false,
  youtubeMusicWasPlayingBeforeRequest: false,
  youtubeMusicTitle: "YouTube Music",
  requestFallbackMode: null,
  youtubeMusicFallbackTimer: null,
  youtubeMusicFallbackBaseUrl: "",
  youtubeMusicRequestCloseTimer: null,
  youtubeMusicRequestStartedAt: 0,
  statusTimer: null,
  pollTimer: null,
  webviewResizeTimer: null,
  lastWebviewSize: { width: 0, height: 0 },
  requestWatchdogTimer: null,
  lastPollError: "",
  youtubeApiReadyPromise: null,
  requestReadyPromise: null,
  backgroundReadyPromise: null,
  backgroundReady: false,
  requestReady: false
};

const els = {
  apiBaseUrl: document.getElementById("apiBaseUrl"),
  saveApiBase: document.getElementById("saveApiBase"),
  pairingCode: document.getElementById("pairingCode"),
  claimPairing: document.getElementById("claimPairing"),
  pairingStatus: document.getElementById("pairingStatus"),
  storageWarning: document.getElementById("storageWarning"),
  connectionBadge: document.getElementById("connectionBadge"),
  openDashboard: document.getElementById("openDashboard"),
  reconnectEvents: document.getElementById("reconnectEvents"),
  copyStatus: document.getElementById("copyStatus"),
  resetPairing: document.getElementById("resetPairing"),
  backgroundVideoId: document.getElementById("backgroundVideoId"),
  loadBackground: document.getElementById("loadBackground"),
  backgroundState: document.getElementById("backgroundState"),
  backgroundPoster: document.getElementById("backgroundPoster"),
  openYouTubeMusic: document.getElementById("openYouTubeMusic"),
  openYouTubeMusicExternal: document.getElementById("openYouTubeMusicExternal"),
  youtubeMusicPanel: document.getElementById("youtubeMusicPanel"),
  youtubeMusicHint: document.getElementById("youtubeMusicHint"),
  musicWebviewShell: document.getElementById("musicWebviewShell"),
  youtubeMusicWebview: document.getElementById("youtubeMusicWebview"),
  youtubeMusicState: document.getElementById("youtubeMusicState"),
  pauseYouTubeMusic: document.getElementById("pauseYouTubeMusic"),
  playYouTubeMusic: document.getElementById("playYouTubeMusic"),
  reloadYouTubeMusic: document.getElementById("reloadYouTubeMusic"),
  unloadYouTubeMusic: document.getElementById("unloadYouTubeMusic"),
  requestState: document.getElementById("requestState"),
  requestPoster: document.getElementById("requestPoster"),
  currentTrack: document.getElementById("currentTrack"),
  eventLog: document.getElementById("eventLog"),
  skipRequest: document.getElementById("skipRequest"),
  resumeBackground: document.getElementById("resumeBackground")
};

window.addEventListener("error", (event) => {
  log("Runtime error: " + safeMessage(event.error || event.message));
});

window.addEventListener("unhandledrejection", (event) => {
  log("Runtime error: " + safeMessage(event.reason));
});

init().catch((error) => showError(error));

async function init() {
  state.config = await api.getConfig();
  els.apiBaseUrl.value = state.config.apiBaseUrl || "https://local-ai-production.up.railway.app";
  renderStorageWarning();
  setConnection(Boolean(state.config.eventsUrl), state.config.streamer?.displayName || state.config.streamer?.twitchLogin);
  setPoster("background", parseVideoId(els.backgroundVideoId.value), "Load a background YouTube video.");
  setPoster("request", null, "Waiting for a song request.");
  unloadYouTubeMusic({ silent: true });
  setupYouTubeMusicResizeSync();
  connectEvents();
  startStatusTimer();
  startCompanionPoller();
  void ensureRequestPlayerReady().catch((error) => {
    log("Request player is not ready yet: " + safeMessage(error));
  });
}

els.saveApiBase.addEventListener("click", () => {
  void withButton(els.saveApiBase, async () => {
    const nextHost = safeHost(els.apiBaseUrl.value);
    const currentHost = safeHost(state.config?.apiBaseUrl);
    if (nextHost && currentHost && nextHost !== currentHost) {
      if (!confirm(`Change API server to ${nextHost}? This clears your current pairing and your device token - you'll need a new pairing code from that server's own dashboard. Only do this if you trust this address.`)) {
        return;
      }
    }
    state.config = await api.saveApiBase(els.apiBaseUrl.value);
    renderStorageWarning();
    setConnection(Boolean(state.config.eventsUrl), state.config.streamer?.displayName || state.config.streamer?.twitchLogin);
    connectEvents();
    startCompanionPoller();
    log("API URL saved.");
  });
});

function safeHost(value) {
  try {
    return new URL(String(value || "")).host || null;
  } catch {
    return null;
  }
}

els.claimPairing.addEventListener("click", () => {
  void withButton(els.claimPairing, async () => {
    state.config = await api.claimPairing(els.pairingCode.value, "KPEBA Music Companion");
    els.pairingCode.value = "";
    renderStorageWarning();
    setConnection(true, state.config.streamer?.displayName || state.config.streamer?.twitchLogin);
    els.pairingStatus.textContent = "Paired. Waiting for music events.";
    connectEvents();
    startCompanionPoller();
    await sendStatus({ playbackState: "idle" });
  });
});

els.openDashboard.addEventListener("click", () => {
  const base = state.config?.apiBaseUrl || els.apiBaseUrl.value || "https://local-ai-production.up.railway.app";
  void api.openExternal(base.replace(/\/+$/, "") + "/dashboard");
});

els.reconnectEvents.addEventListener("click", () => {
  connectEvents();
  log("Reconnecting to Local AI music stream.");
});

els.copyStatus.addEventListener("click", async () => {
  const status = {
    apiBaseUrl: state.config?.apiBaseUrl,
    paired: Boolean(state.config?.eventsUrl),
    streamer: state.config?.streamer,
    connection: els.connectionBadge.textContent,
    currentTrack: els.currentTrack.textContent,
    backgroundState: els.backgroundState.textContent,
    requestState: els.requestState.textContent,
    youtubeReady: Boolean(state.backgroundReady && state.requestReady),
    tokenStorage: state.config?.tokenStorage,
    storageWarning: state.config?.storageWarning || null
  };
  await api.copyText(JSON.stringify(status, null, 2));
  log("Device status copied.");
});

els.resetPairing.addEventListener("click", async () => {
  if (!confirm("Reset pairing on this desktop app? Reconnect with a new dashboard code.")) return;
  state.config = await api.resetPairing();
  connectEvents();
  startCompanionPoller();
  setConnection(false);
  renderStorageWarning();
  els.pairingStatus.textContent = "Pairing reset. Create a new code in the dashboard.";
});

els.backgroundVideoId.addEventListener("input", () => {
  const videoId = parseVideoId(els.backgroundVideoId.value);
  setPoster("background", videoId, videoId ? "Ready to load background." : "Load a background YouTube video.");
});

els.openYouTubeMusic.addEventListener("click", () => {
  showYouTubeMusic(YOUTUBE_MUSIC_URL);
});

els.openYouTubeMusicExternal.addEventListener("click", () => {
  void api.openExternal(YOUTUBE_MUSIC_URL);
  log("Opened YouTube Music in the system browser to keep Companion lighter.");
});

els.reloadYouTubeMusic.addEventListener("click", () => {
  if (!state.youtubeMusicLoaded) {
    showYouTubeMusic(YOUTUBE_MUSIC_URL);
    return;
  }
  try {
    els.youtubeMusicWebview.reload();
    setYouTubeMusicState("reloading");
  } catch (error) {
    log("Could not reload YouTube Music: " + safeMessage(error));
  }
});

els.pauseYouTubeMusic.addEventListener("click", () => {
  void pauseYouTubeMusicBackground({ remember: false });
});

els.playYouTubeMusic.addEventListener("click", () => {
  void resumeYouTubeMusicBackground({ force: true });
});

els.unloadYouTubeMusic.addEventListener("click", () => {
  unloadYouTubeMusic();
});

els.youtubeMusicWebview.addEventListener("did-start-loading", () => setYouTubeMusicState("loading"));
els.youtubeMusicWebview.addEventListener("dom-ready", () => {
  if (!isYouTubeMusicWebviewUrl()) {
    state.youtubeMusicLoaded = false;
    setYouTubeMusicState("unloaded");
    return;
  }
  state.youtubeMusicLoaded = true;
  setYouTubeMusicState("ready");
  scheduleYouTubeMusicFillMode();
});
els.youtubeMusicWebview.addEventListener("did-stop-loading", () => {
  if (!isYouTubeMusicWebviewUrl()) {
    state.youtubeMusicLoaded = false;
    setYouTubeMusicState("unloaded");
    return;
  }
  state.youtubeMusicLoaded = true;
  setYouTubeMusicState("ready");
  syncYouTubeMusicWebviewSize();
  scheduleYouTubeMusicFillMode();
  void refreshYouTubeMusicStatus();
});
els.youtubeMusicWebview.addEventListener("did-fail-load", (event) => {
  if (event.errorCode === -3) return;
  state.youtubeMusicLoaded = false;
  setYouTubeMusicState("error");
  log("YouTube Music load failed: " + (event.errorDescription || event.errorCode));
});
els.youtubeMusicWebview.addEventListener("page-title-updated", (event) => {
  if (event.title) {
    state.youtubeMusicTitle = event.title;
    setYouTubeMusicState(event.title.slice(0, 40));
  }
});

els.loadBackground.addEventListener("click", () => {
  void withButton(els.loadBackground, async () => {
    const videoId = parseVideoId(els.backgroundVideoId.value);
    if (!videoId) {
      log("Background needs a valid YouTube video URL or ID.");
      return;
    }
    state.backgroundVideoId = videoId;
    setPoster("background", videoId, "Loading background...");
    await ensureBackgroundPlayerReady();
    state.backgroundPlayer.loadVideoById(videoId);
    state.backgroundPlayer.playVideo();
    els.backgroundState.textContent = "loading";
    log("Background loaded: " + videoId);
    await sendCurrentStatus("loading");
  });
});

els.skipRequest.addEventListener("click", () => finishRequest("skipped"));
els.resumeBackground.addEventListener("click", () => {
  void resumeBackground();
});

function connectEvents() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  if (!state.config?.eventsUrl) return;
  const source = new EventSource(state.config.eventsUrl);
  state.eventSource = source;
  source.addEventListener("ready", () => {
    setConnection(true, state.config?.streamer?.displayName || state.config?.streamer?.twitchLogin);
    log("Connected to Local AI music stream.");
    void sendCurrentStatus(normalizePlaybackState(els.backgroundState.textContent));
  });
  source.addEventListener("ping", () => setConnection(true, state.config?.streamer?.displayName || state.config?.streamer?.twitchLogin));
  source.addEventListener("music.play", (event) => {
    const payload = JSON.parse(event.data);
    log("Received request: " + (payload.request?.title || payload.request?.videoId || "unknown"));
    void playRequest(payload.request);
  });
  source.addEventListener("music.skip", (event) => {
    const payload = JSON.parse(event.data);
    log("Received skip for request: " + (payload.requestId || "unknown"));
    if (!payload.requestId || payload.requestId === state.activeRequest?.id) {
      finishRequest("skipped");
    }
  });
  source.addEventListener("music.revoked", () => {
    setConnection(false);
    log("Device token was revoked from the dashboard. Pair again with a new code.");
    void api.resetPairing().then((config) => {
      state.config = config;
      renderStorageWarning();
    }).catch(() => undefined);
    source.close();
  });
  source.addEventListener("music.settings", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.settings?.backgroundVideoId) {
      els.backgroundVideoId.value = payload.settings.backgroundVideoId;
      state.backgroundVideoId = parseVideoId(payload.settings.backgroundVideoId);
      setPoster("background", state.backgroundVideoId, "Background configured from dashboard.");
    }
  });
  source.onerror = () => {
    setConnection(false);
    log("Connection interrupted. EventSource will retry automatically.");
  };
}

async function playRequest(request) {
  if (!request?.videoId) return;
  if (state.activeRequest?.id === request.id && ["loading", "buffering", "playing", "paused"].includes(String(els.requestState.textContent || "").toLowerCase())) {
    return;
  }
  // Guards against two concurrent playRequest() calls for different requests (back-to-back
  // SSE events, or the poll-recovery path racing SSE) clobbering the shared player/state:
  // each call snapshots the generation and bails after any await if a newer call started.
  const generation = ++state.requestGeneration;
  state.activeRequest = request;
  state.requestFallbackMode = null;
  els.currentTrack.textContent = `Request: ${request.title} - @${request.requester || "viewer"} - ${formatDuration(request.durationSeconds)}`;
  els.requestState.textContent = "loading";
  setPoster("request", request.videoId, "Loading request...");
  await pauseBackground();
  if (generation !== state.requestGeneration) return;
  try {
    await ensureRequestPlayerReady();
    if (generation !== state.requestGeneration) return;
    state.requestPlayer.loadVideoById(request.videoId);
    state.requestPlayer.playVideo();
    log("Request player loaded: " + request.title + ". Waiting for YouTube to start playback.");
    startRequestWatchdog(request.id);
    await sendCurrentStatus("loading");
  } catch (error) {
    if (generation !== state.requestGeneration) return;
    log("Could not start request player: " + safeMessage(error));
    finishRequest("error", safeMessage(error), "Request failed: " + safeMessage(error));
  }
}

async function pauseBackground() {
  await pauseYouTubeMusicBackground({ remember: true });
  try {
    state.backgroundPlayer?.pauseVideo();
    if (state.backgroundVideoId) els.backgroundState.textContent = "paused";
  } catch (error) {
    log("Could not pause background: " + safeMessage(error));
  }
}

async function resumeBackground() {
  if (await resumeYouTubeMusicBackground()) {
    return;
  }
  if (!state.backgroundVideoId) {
    log("No YouTube Music session or fallback video loaded.");
    return;
  }
  try {
    await ensureBackgroundPlayerReady();
    const loadedVideoId = state.backgroundPlayer.getVideoData?.().video_id;
    if (loadedVideoId !== state.backgroundVideoId) {
      state.backgroundPlayer.loadVideoById(state.backgroundVideoId);
    }
    state.backgroundPlayer.playVideo();
    els.backgroundState.textContent = "loading";
    setPoster("background", state.backgroundVideoId, "Resuming background...");
    log("Background resumed.");
  } catch (error) {
    log("Could not resume background: " + safeMessage(error));
  }
}

function finishRequest(playbackState, error, posterText) {
  state.requestGeneration += 1;
  clearTimeout(state.requestWatchdogTimer);
  clearInterval(state.youtubeMusicFallbackTimer);
  clearInterval(state.youtubeMusicRequestCloseTimer);
  state.youtubeMusicFallbackTimer = null;
  state.youtubeMusicRequestCloseTimer = null;
  const wasYouTubeMusicFallback = String(state.requestFallbackMode || "").startsWith("youtube_music");
  const wasRequestWindowFallback = state.requestFallbackMode === "youtube_music_window";
  if (!state.activeRequest) {
    try {
      state.requestPlayer?.stopVideo();
    } catch {}
    setPoster("request", null, "No active request.");
    els.requestState.textContent = playbackState === "skipped" ? "skipped" : "idle";
    void resumeBackground();
    log("No active request to skip.");
    return;
  }
  try {
    state.requestPlayer?.stopVideo();
  } catch {}
  els.requestState.textContent = playbackState;
  setPoster("request", state.activeRequest.videoId, posterText || (playbackState === "ended" ? "Request ended." : playbackState === "skipped" ? "Request skipped." : "Request stopped."));
  void sendCurrentStatus(playbackState, error).finally(() => {
    if (wasRequestWindowFallback) {
      void api.closeMusicRequestWindow?.();
    }
    state.activeRequest = null;
    state.requestFallbackMode = null;
    state.youtubeMusicFallbackBaseUrl = "";
    state.youtubeMusicRequestStartedAt = 0;
    els.currentTrack.textContent = "Nothing playing.";
    if (wasRequestWindowFallback || !wasYouTubeMusicFallback) {
      void resumeBackground();
    }
  });
}

function onRequestStateChange(event) {
  if (event.data === window.YT.PlayerState.ENDED) {
    finishRequest("ended");
  } else if (event.data === window.YT.PlayerState.PLAYING) {
    clearTimeout(state.requestWatchdogTimer);
    hidePoster("request");
    els.requestState.textContent = "playing";
    void sendCurrentStatus("playing");
  } else if (event.data === window.YT.PlayerState.PAUSED) {
    els.requestState.textContent = "paused";
    void sendCurrentStatus("paused");
  } else if (event.data === window.YT.PlayerState.BUFFERING) {
    els.requestState.textContent = "buffering";
  }
}

function onRequestError(event) {
  const message = youtubeErrorMessage(event.data);
  const reason = "youtube_error_" + event.data + ": " + message;
  log("YouTube request error: " + event.data + " - " + message);
  if (shouldFallbackToYouTubeMusic(event.data)) {
    void playRequestInYouTubeMusicWindow();
    return;
  }
  finishRequest("error", reason, "Request failed: " + message);
}

function startRequestWatchdog(requestId) {
  clearTimeout(state.requestWatchdogTimer);
  state.requestWatchdogTimer = setTimeout(() => {
    if (!state.activeRequest || state.activeRequest.id !== requestId) return;
    const status = normalizePlaybackState(els.requestState.textContent);
    if (status === "playing") return;
    try {
      state.requestPlayer?.playVideo();
      log("Request player retry: forced play after startup delay.");
      void sendCurrentStatus(status === "idle" ? "loading" : status);
    } catch (error) {
      log("Request player retry failed: " + safeMessage(error));
    }
  }, 4500);
}

function onBackgroundStateChange(event) {
  if (event.data === window.YT.PlayerState.PLAYING) {
    hidePoster("background");
    els.backgroundState.textContent = "playing";
  }
  if (event.data === window.YT.PlayerState.PAUSED) els.backgroundState.textContent = "paused";
  if (event.data === window.YT.PlayerState.ENDED) els.backgroundState.textContent = "ended";
  if (event.data === window.YT.PlayerState.BUFFERING) els.backgroundState.textContent = "buffering";
}

function onBackgroundError(event) {
  log("YouTube background error: " + event.data + " - " + youtubeErrorMessage(event.data));
  setPoster("background", state.backgroundVideoId, youtubeErrorMessage(event.data));
  els.backgroundState.textContent = "error";
}

function startStatusTimer() {
  clearInterval(state.statusTimer);
  void sendCurrentStatus(normalizePlaybackState(els.backgroundState.textContent)).catch(() => undefined);
  state.statusTimer = setInterval(() => {
    const playbackState = state.activeRequest ? normalizePlaybackState(els.requestState.textContent) : normalizePlaybackState(els.backgroundState.textContent);
    void sendCurrentStatus(playbackState).catch(() => undefined);
  }, 10000);
}

async function pauseYouTubeMusicBackground(options = {}) {
  if (!state.youtubeMusicLoaded) return false;
  try {
    const result = await els.youtubeMusicWebview.executeJavaScript(`(() => {
      const media = Array.from(document.querySelectorAll("video,audio"));
      const target = media.find((item) => !item.paused && !item.ended) || media[0];
      if (!target) return { ok: false, wasPlaying: false, title: document.title || "YouTube Music" };
      const wasPlaying = !target.paused && !target.ended;
      if (wasPlaying) target.pause();
      return { ok: true, wasPlaying, title: document.title || "YouTube Music", currentTime: Math.round(target.currentTime || 0), duration: Math.round(target.duration || 0) };
    })()`, true);
    state.youtubeMusicWasPlayingBeforeRequest = Boolean(state.youtubeMusicWasPlayingBeforeRequest || (options.remember && result?.wasPlaying));
    if (result?.title) state.youtubeMusicTitle = result.title;
    if (result?.ok) {
      els.backgroundState.textContent = "paused";
      setYouTubeMusicState(result.wasPlaying ? "paused for request" : "ready");
      if (!options.silent && result.wasPlaying) log("YouTube Music paused.");
      return true;
    }
  } catch (error) {
    log("Could not pause YouTube Music: " + safeMessage(error));
  }
  return false;
}

async function resumeYouTubeMusicBackground(options = {}) {
  if (!state.youtubeMusicLoaded) return false;
  if (!options.force && !state.youtubeMusicWasPlayingBeforeRequest) return false;
  try {
    const result = await els.youtubeMusicWebview.executeJavaScript(`(() => {
      const media = Array.from(document.querySelectorAll("video,audio"));
      const target = media.find((item) => item.paused && !item.ended) || media[0];
      if (!target) return Promise.resolve({ ok: false, title: document.title || "YouTube Music" });
      return Promise.resolve(target.play()).then(
        () => ({ ok: true, title: document.title || "YouTube Music", currentTime: Math.round(target.currentTime || 0), duration: Math.round(target.duration || 0) }),
        (error) => ({ ok: false, title: document.title || "YouTube Music", error: String(error && error.message || error || "play_failed") })
      );
    })()`, true);
    if (result?.title) state.youtubeMusicTitle = result.title;
    if (result?.ok) {
      state.youtubeMusicWasPlayingBeforeRequest = false;
      els.backgroundState.textContent = "playing";
      setYouTubeMusicState("playing");
      log("YouTube Music resumed.");
      await sendCurrentStatus("playing");
      return true;
    }
    if (options.force || state.youtubeMusicWasPlayingBeforeRequest) {
      log("Could not resume YouTube Music: " + (result?.error || "no playable media"));
    }
  } catch (error) {
    log("Could not resume YouTube Music: " + safeMessage(error));
  }
  return false;
}

async function refreshYouTubeMusicStatus() {
  if (!state.youtubeMusicLoaded || state.activeRequest) return null;
  try {
    const result = await getYouTubeMusicMediaStatus();
    if (result?.title) state.youtubeMusicTitle = result.title;
    if (result?.ok) {
      els.backgroundState.textContent = normalizePlaybackState(result.playbackState);
    }
    return result;
  } catch {
    return null;
  }
}

async function playRequestInYouTubeMusicWindow() {
  const request = state.activeRequest;
  if (!request?.videoId) return false;
  const generation = state.requestGeneration;
  const stillCurrent = () => generation === state.requestGeneration && state.activeRequest?.id === request.id;
  state.requestFallbackMode = "youtube_music_window";
  clearInterval(state.youtubeMusicFallbackTimer);
  clearInterval(state.youtubeMusicRequestCloseTimer);
  state.youtubeMusicFallbackTimer = null;
  state.youtubeMusicRequestCloseTimer = null;
  state.youtubeMusicRequestStartedAt = Date.now();
  els.requestState.textContent = "playing";
  setPoster("request", request.videoId, "Playing in separate YouTube Music window.");
  try {
    await pauseYouTubeMusicBackground({ remember: true });
    // Re-check after each await: a concurrent skip/new request could have moved on while
    // we were waiting, and we must not pop up audio for a request nobody wants anymore.
    if (!stillCurrent()) return false;
    await api.openMusicRequestWindow(youtubeMusicWatchUrl(request.videoId));
    if (!stillCurrent()) {
      void api.closeMusicRequestWindow?.();
      return false;
    }
    log("Opened request in a separate YouTube Music window: " + request.title);
    await sendYouTubeMusicWindowRequestStatus("playing", null);
    const durationMs = Math.max(30, Number(request.durationSeconds || 240)) * 1000 + 2500;
    state.youtubeMusicFallbackTimer = setTimeout(() => {
      if (state.activeRequest?.id === request.id && state.requestFallbackMode === "youtube_music_window") {
        finishRequest("ended", null, "Request ended in YouTube Music window.");
      }
    }, durationMs);
    state.youtubeMusicRequestCloseTimer = setInterval(() => {
      void checkRequestWindowClosed(request.id);
    }, 1500);
    return true;
  } catch (error) {
    log("Could not open YouTube Music request window: " + safeMessage(error));
    if (state.activeRequest?.id === request.id) {
      finishRequest("error", safeMessage(error), "Request failed: " + safeMessage(error));
    }
    return false;
  }
}

async function checkRequestWindowClosed(requestId) {
  if (!state.activeRequest || state.activeRequest.id !== requestId || state.requestFallbackMode !== "youtube_music_window") {
    clearInterval(state.youtubeMusicRequestCloseTimer);
    state.youtubeMusicRequestCloseTimer = null;
    return;
  }
  const result = await api.isMusicRequestWindowOpen?.().catch(() => ({ open: true }));
  if (!result?.open) {
    finishRequest("ended", null, "Request window closed.");
  }
}

async function getYouTubeMusicMediaStatus(options = {}) {
  if (!state.youtubeMusicLoaded && !isYouTubeMusicWebviewUrl()) {
    return { ok: false, playbackState: "idle", title: "YouTube Music", currentTime: 0, duration: 0, url: "" };
  }
  const tryPlay = Boolean(options.tryPlay);
  return els.youtubeMusicWebview.executeJavaScript(`(() => {
    const media = Array.from(document.querySelectorAll("video,audio"));
    const target = media.find((item) => !item.paused && !item.ended) || media[0];
    if (!target) return Promise.resolve({ ok: false, playbackState: "idle", title: document.title || "YouTube Music", currentTime: 0, duration: 0, url: location.href });
    const read = () => ({
      ok: true,
      playbackState: target.ended ? "ended" : target.paused ? "paused" : "playing",
      title: document.title || "YouTube Music",
      currentTime: Math.round(target.currentTime || 0),
      duration: Math.round(target.duration || 0),
      url: location.href
    });
    if (${tryPlay ? "true" : "false"} && target.paused && !target.ended) {
      return Promise.resolve(target.play()).then(read, read);
    }
    return Promise.resolve(read());
  })()`, true);
}

async function sendYouTubeMusicRequestStatus(playbackState, error, media) {
  const request = state.activeRequest;
  if (!request) return;
  return sendStatus({
    playbackState: normalizePlaybackState(playbackState),
    requestId: request.id,
    title: request.title,
    videoId: request.videoId,
    requester: request.requester || null,
    durationSeconds: Math.round(media?.duration || request.durationSeconds || 0),
    progressSeconds: Math.round(media?.currentTime || 0),
    backgroundTitle: "YouTube Music",
    backgroundVideoId: request.videoId,
    error: error || null
  });
}

async function sendYouTubeMusicWindowRequestStatus(playbackState, error) {
  const request = state.activeRequest;
  if (!request) return;
  const duration = Math.max(0, Number(request.durationSeconds || 0));
  const elapsed = state.youtubeMusicRequestStartedAt ? Math.max(0, Math.round((Date.now() - state.youtubeMusicRequestStartedAt) / 1000)) : 0;
  return sendStatus({
    playbackState: normalizePlaybackState(playbackState),
    requestId: request.id,
    title: request.title,
    videoId: request.videoId,
    requester: request.requester || null,
    durationSeconds: duration,
    progressSeconds: playbackState === "ended" ? duration : Math.min(duration || elapsed, elapsed),
    backgroundTitle: "YouTube Music request window",
    backgroundVideoId: request.videoId,
    error: error || null
  });
}

function startCompanionPoller() {
  clearInterval(state.pollTimer);
  state.lastPollError = "";
  if (!state.config?.eventsUrl) return;
  state.pollTimer = setInterval(() => {
    void pollCompanionState();
  }, 4000);
  void pollCompanionState();
}

async function pollCompanionState() {
  if (!state.config?.eventsUrl || state.pollInFlight) return;
  state.pollInFlight = true;
  try {
    const result = await api.getCompanionState();
    state.lastPollError = "";
    setConnection(true, state.config?.streamer?.displayName || state.config?.streamer?.twitchLogin);
    if (result.settings?.backgroundVideoId && !state.backgroundVideoId) {
      state.backgroundVideoId = parseVideoId(result.settings.backgroundVideoId);
      els.backgroundVideoId.value = state.backgroundVideoId;
      setPoster("background", state.backgroundVideoId, "Background configured from dashboard.");
    }
    if (result.request?.id && state.activeRequest?.id !== result.request.id) {
      log("Recovered request from production poll: " + (result.request.title || result.request.videoId));
      await playRequest(result.request);
    }
  } catch (error) {
    const message = safeMessage(error);
    if (message !== state.lastPollError) {
      state.lastPollError = message;
      log("Production poll failed: " + message);
    }
  } finally {
    state.pollInFlight = false;
  }
}

async function sendCurrentStatus(playbackState, error) {
  const request = state.activeRequest;
  if (request && state.requestFallbackMode === "youtube_music_window") {
    return sendYouTubeMusicWindowRequestStatus(playbackState, error);
  }
  if (request && String(state.requestFallbackMode || "").startsWith("youtube_music")) {
    const media = await getYouTubeMusicMediaStatus().catch(() => null);
    return sendYouTubeMusicRequestStatus(playbackState, error, media);
  }
  const player = request ? state.requestPlayer : state.backgroundPlayer;
  const youtubeMusic = request ? null : await refreshYouTubeMusicStatus();
  if (!request && youtubeMusic?.ok) {
    return sendStatus({
      playbackState: normalizePlaybackState(youtubeMusic.playbackState),
      requestId: null,
      title: null,
      videoId: null,
      requester: null,
      durationSeconds: Math.round(youtubeMusic.duration || 0),
      progressSeconds: Math.round(youtubeMusic.currentTime || 0),
      backgroundTitle: state.youtubeMusicTitle || "YouTube Music",
      backgroundVideoId: state.backgroundVideoId,
      error: error || null
    });
  }
  return sendStatus({
    playbackState,
    requestId: request?.id || null,
    title: request?.title || null,
    videoId: request?.videoId || null,
    requester: request?.requester || null,
    durationSeconds: Math.round(player?.getDuration?.() || request?.durationSeconds || 0),
    progressSeconds: Math.round(player?.getCurrentTime?.() || 0),
    backgroundTitle: state.youtubeMusicLoaded ? state.youtubeMusicTitle || "YouTube Music" : state.backgroundVideoId ? "Background YouTube music" : null,
    backgroundVideoId: state.backgroundVideoId,
    error: error || null
  });
}

async function sendStatus(status) {
  // Every status-sending path (the 10s timer, per-state-change sends, YTM-window sends)
  // funnels through here; skipping while one is already in flight caps concurrent status
  // requests to 1 instead of letting them pile up unbounded if the backend is slow rather
  // than outright down. Status is a periodic heartbeat, not a guaranteed event delivery
  // channel (SSE covers that), so an occasional dropped tick is an acceptable trade-off.
  if (state.statusInFlight) return;
  state.statusInFlight = true;
  try {
    await api.sendStatus(status);
  } catch (error) {
    log("Status update failed: " + safeMessage(error));
  } finally {
    state.statusInFlight = false;
  }
}

async function ensureRequestPlayerReady() {
  if (state.requestReady && state.requestPlayer) return;
  if (state.requestReadyPromise) return state.requestReadyPromise;
  state.requestReadyPromise = createRequestPlayer().catch((error) => {
    state.requestReadyPromise = null;
    throw error;
  });
  return state.requestReadyPromise;
}

async function ensureBackgroundPlayerReady() {
  if (state.backgroundReady && state.backgroundPlayer) return;
  if (state.backgroundReadyPromise) return state.backgroundReadyPromise;
  state.backgroundReadyPromise = createBackgroundPlayer().catch((error) => {
    state.backgroundReadyPromise = null;
    throw error;
  });
  return state.backgroundReadyPromise;
}

async function createRequestPlayer() {
  await loadYouTubeIframeApi();
  if (state.requestReady && state.requestPlayer) return;
  await new Promise((resolve, reject) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error("YouTube request player did not become ready. Check network access to youtube.com."));
    }, PLAYER_READY_TIMEOUT_MS);

    state.requestPlayer = new window.YT.Player("requestPlayer", {
      height: "100%",
      width: "100%",
      videoId: "",
      playerVars: playerVars(),
      events: {
        onReady: () => {
          state.requestReady = true;
          if (done) return;
          done = true;
          clearTimeout(timeout);
          log("Request player ready.");
          resolve();
        },
        onStateChange: onRequestStateChange,
        onError: onRequestError
      }
    });
  });
}

async function createBackgroundPlayer() {
  await loadYouTubeIframeApi();
  if (state.backgroundReady && state.backgroundPlayer) return;
  await new Promise((resolve, reject) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error("Fallback background player did not become ready. Check network access to youtube.com."));
    }, PLAYER_READY_TIMEOUT_MS);

    state.backgroundPlayer = new window.YT.Player("backgroundPlayer", {
      height: "100%",
      width: "100%",
      videoId: "",
      playerVars: playerVars(),
      events: {
        onReady: () => {
          state.backgroundReady = true;
          if (done) return;
          done = true;
          clearTimeout(timeout);
          log("Fallback background player ready.");
          resolve();
        },
        onStateChange: onBackgroundStateChange,
        onError: onBackgroundError
      }
    });
  });
}

function loadYouTubeIframeApi() {
  if (window.YT?.Player) {
    return Promise.resolve();
  }
  if (state.youtubeApiReadyPromise) {
    return state.youtubeApiReadyPromise;
  }
  state.youtubeApiReadyPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("youtubeIframeApi");
    const timeout = setTimeout(() => reject(new Error("YouTube IFrame API load timed out.")), PLAYER_READY_TIMEOUT_MS);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      resolve();
    };
    if (existing) return;
    const script = document.createElement("script");
    script.id = "youtubeIframeApi";
    script.src = YOUTUBE_IFRAME_API_URL;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Could not load YouTube IFrame API."));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    // Unlike a bare rejected promise cached forever, clear the cache and the stuck <script>
    // tag so the next call actually retries instead of permanently failing every song
    // request for the rest of the stream after one transient load hiccup.
    state.youtubeApiReadyPromise = null;
    document.getElementById("youtubeIframeApi")?.remove();
    throw error;
  });
  return state.youtubeApiReadyPromise;
}

function playerVars() {
  const vars = { playsinline: 1, rel: 0, controls: 1, enablejsapi: 1, modestbranding: 1 };
  if (window.location.origin.startsWith("http")) {
    vars.origin = window.location.origin;
  }
  return vars;
}

async function withButton(button, fn) {
  const text = button.textContent;
  button.disabled = true;
  try {
    await fn();
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
    button.textContent = text;
  }
}

function setConnection(connected, name) {
  els.connectionBadge.textContent = connected ? `paired${name ? " - " + name : ""}` : "not paired";
  els.connectionBadge.classList.toggle("ok", connected);
}

function renderStorageWarning() {
  if (!els.storageWarning) return;
  const warning = state.config?.storageWarning;
  els.storageWarning.hidden = !warning;
  els.storageWarning.textContent = warning || "";
}

function setPoster(kind, videoId, text) {
  const poster = kind === "background" ? els.backgroundPoster : els.requestPoster;
  if (!poster) return;
  poster.hidden = false;
  poster.textContent = text || "";
  poster.style.backgroundImage = videoId ? `linear-gradient(180deg, rgba(6, 9, 13, .18), rgba(6, 9, 13, .76)), url("https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg")` : "";
}

function hidePoster(kind) {
  const poster = kind === "background" ? els.backgroundPoster : els.requestPoster;
  if (poster) poster.hidden = true;
}

function revealYouTubeMusic(options = {}) {
  els.youtubeMusicPanel.hidden = false;
  els.youtubeMusicHint.hidden = true;
  els.musicWebviewShell.classList.remove("unloaded");
  els.openYouTubeMusic.textContent = "Load YouTube Music";
  syncYouTubeMusicWebviewSize();
  if (!options.silent) log("YouTube Music opened inside Companion.");
}

function showYouTubeMusic(url, options = {}) {
  revealYouTubeMusic({ silent: true });
  const currentUrl = typeof els.youtubeMusicWebview.getURL === "function" ? els.youtubeMusicWebview.getURL() : "";
  if (!currentUrl || currentUrl === "about:blank" || currentUrl !== url) {
    els.youtubeMusicWebview.src = url;
    setYouTubeMusicState("loading");
  } else {
    setYouTubeMusicState("ready");
  }
  if (!options.silent) log("YouTube Music opened inside Companion.");
}

function unloadYouTubeMusic(options = {}) {
  state.youtubeMusicLoaded = false;
  state.youtubeMusicWasPlayingBeforeRequest = false;
  state.youtubeMusicTitle = "YouTube Music";
  els.youtubeMusicHint.hidden = false;
  els.musicWebviewShell.classList.add("unloaded");
  setYouTubeMusicState("unloaded");
  els.backgroundState.textContent = state.backgroundVideoId ? normalizePlaybackState(els.backgroundState.textContent) : "idle";
  try {
    const currentUrl = typeof els.youtubeMusicWebview.getURL === "function" ? els.youtubeMusicWebview.getURL() : els.youtubeMusicWebview.src;
    if (currentUrl && currentUrl !== "about:blank" && typeof els.youtubeMusicWebview.stop === "function") {
      els.youtubeMusicWebview.stop();
    }
    els.youtubeMusicWebview.src = "about:blank";
  } catch (error) {
    if (!options.silent) {
      log("Could not unload YouTube Music: " + safeMessage(error));
    }
  }
  if (!options.silent) {
    log("YouTube Music unloaded. Song requests still work; background pause/resume is disabled until you load it again.");
  }
}

function setYouTubeMusicState(value) {
  els.youtubeMusicState.textContent = value;
}

function isYouTubeMusicWebviewUrl() {
  try {
    const url = typeof els.youtubeMusicWebview.getURL === "function" ? els.youtubeMusicWebview.getURL() : els.youtubeMusicWebview.src;
    return String(url || "").startsWith(YOUTUBE_MUSIC_URL);
  } catch {
    return false;
  }
}

function youtubeMusicWatchUrl(videoId) {
  const url = new URL("watch", YOUTUBE_MUSIC_URL);
  url.searchParams.set("v", videoId);
  return url.toString();
}

function shouldFallbackToYouTubeMusic(code) {
  const numeric = Number(code);
  return numeric === 5 || numeric === 101 || numeric === 150;
}

function setupYouTubeMusicResizeSync() {
  syncYouTubeMusicWebviewSize();
  window.addEventListener("resize", scheduleYouTubeMusicWebviewResize);
  if (window.ResizeObserver && els.musicWebviewShell) {
    const observer = new ResizeObserver(scheduleYouTubeMusicWebviewResize);
    observer.observe(els.musicWebviewShell);
  }
}

function scheduleYouTubeMusicWebviewResize() {
  clearTimeout(state.webviewResizeTimer);
  state.webviewResizeTimer = setTimeout(() => {
    syncYouTubeMusicWebviewSize();
    if (state.youtubeMusicLoaded) {
      scheduleYouTubeMusicFillMode();
    }
  }, 80);
}

function syncYouTubeMusicWebviewSize() {
  const shell = els.musicWebviewShell;
  const webview = els.youtubeMusicWebview;
  if (!shell || !webview) return;
  const width = Math.max(640, Math.floor(shell.clientWidth));
  const height = Math.max(360, Math.floor(shell.clientHeight));
  if (state.lastWebviewSize.width === width && state.lastWebviewSize.height === height) {
    return;
  }
  state.lastWebviewSize = { width, height };
  webview.style.display = "inline-flex";
  webview.style.width = width + "px";
  webview.style.height = height + "px";
  webview.setAttribute("width", String(width));
  webview.setAttribute("height", String(height));
  webview.setAttribute("minwidth", String(width));
  webview.setAttribute("minheight", String(height));
  webview.setAttribute("maxwidth", String(width));
  webview.setAttribute("maxheight", String(height));
  if (state.youtubeMusicLoaded) {
    void webview.executeJavaScript("window.dispatchEvent(new Event('resize'))", true).catch(() => undefined);
  }
}

function scheduleYouTubeMusicFillMode() {
  if (!state.youtubeMusicLoaded || !isYouTubeMusicWebviewUrl()) return;
  syncYouTubeMusicWebviewSize();
  void applyYouTubeMusicFillMode();
  window.setTimeout(() => void applyYouTubeMusicFillMode(), 500);
  window.setTimeout(() => void applyYouTubeMusicFillMode(), 1500);
}

async function applyYouTubeMusicFillMode() {
  syncYouTubeMusicWebviewSize();
  try {
    if (typeof els.youtubeMusicWebview.setZoomFactor === "function") {
      els.youtubeMusicWebview.setZoomFactor(1);
    }
    if (typeof els.youtubeMusicWebview.insertCSS === "function") {
      await els.youtubeMusicWebview.insertCSS(YOUTUBE_MUSIC_FILL_CSS);
    }
    await els.youtubeMusicWebview.executeJavaScript(`(() => {
      const stretch = (selector, height) => {
        document.querySelectorAll(selector).forEach((node) => {
          node.style.width = "100vw";
          node.style.minWidth = "100vw";
          node.style.maxWidth = "100vw";
          node.style.height = height;
          node.style.minHeight = height;
          node.style.background = "#030303";
          node.style.overflowX = "hidden";
        });
      };
      stretch("html, body, ytmusic-app, ytmusic-app-layout", "100vh");
      stretch("#layout, #content, #page-manager, ytmusic-browse-response, ytmusic-section-list-renderer, ytmusic-player-page", "calc(100vh - 96px)");
      window.dispatchEvent(new Event("resize"));
      return {
        ok: true,
        width: window.innerWidth,
        height: window.innerHeight,
        bodyHeight: document.body?.getBoundingClientRect?.().height || 0
      };
    })()`, true);
  } catch (error) {
    log("Could not stretch YouTube Music panel: " + safeMessage(error));
  }
}

function log(message) {
  const line = document.createElement("div");
  line.textContent = new Date().toLocaleTimeString() + " - " + message;
  els.eventLog.prepend(line);
}

function showError(error) {
  const message = safeMessage(error);
  els.pairingStatus.textContent = message;
  log("Error: " + message);
}

function safeMessage(error) {
  return String(error?.message || error || "Unknown error").slice(0, 300);
}

function parseVideoId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.hostname.includes("youtu.be")) return cleanVideoId(url.pathname.slice(1));
    const fromQuery = url.searchParams.get("v");
    if (fromQuery) return cleanVideoId(fromQuery);
    const match = url.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{6,})/);
    if (match) return cleanVideoId(match[1]);
  } catch {}
  return cleanVideoId(raw);
}

function cleanVideoId(value) {
  const cleaned = String(value || "").trim().replace(/[^\w-]/g, "");
  return cleaned.length === 11 ? cleaned : cleaned.slice(0, 32);
}

function normalizePlaybackState(value) {
  const text = String(value || "").trim().toLowerCase();
  return ["playing", "paused", "ended", "skipped", "error", "offline", "buffering", "loading"].includes(text) ? text : "idle";
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const minutes = Math.floor(total / 60);
  const remaining = String(total % 60).padStart(2, "0");
  return minutes + ":" + remaining;
}

function youtubeErrorMessage(code) {
  const numeric = Number(code);
  if (numeric === 2) return "Invalid YouTube video id.";
  if (numeric === 5) return "This video cannot play in the embedded player.";
  if (numeric === 100) return "This video is private, removed, or unavailable.";
  if (numeric === 101 || numeric === 150) return "Owner disabled embedded playback for this video.";
  if (numeric === 153) return "YouTube rejected the app origin. Reinstall the latest Companion build.";
  return "Video could not be played.";
}
