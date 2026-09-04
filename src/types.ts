export type CompanionConfig = {
  apiBaseUrl: string;
  deviceToken?: string;
  deviceTokenEncrypted?: string;
  eventsUrl?: string;
  statusUrl?: string;
  streamer?: {
    displayName?: string | null;
    twitchLogin?: string | null;
  };
  tokenStorage?: "safeStorage" | "plain-fallback" | "missing";
  storageWarning?: string | null;
};

export type PairingClaimResult = {
  deviceToken: string;
  eventsUrl: string;
  statusUrl: string;
  streamer: CompanionConfig["streamer"];
};

export type CompanionStateResult = {
  ok: boolean;
  request?: {
    id: string;
    videoId: string;
    videoUrl: string;
    title: string;
    requester: string | null;
    durationSeconds: number;
    source: string;
    priority: number;
  } | null;
  settings?: {
    backgroundTitle: string | null;
    backgroundVideoId: string | null;
    maxDurationSeconds: number;
  };
};

export type PlaybackStatus = {
  playbackState: "idle" | "playing" | "paused" | "ended" | "skipped" | "error" | "offline";
  requestId?: string | null;
  title?: string | null;
  videoId?: string | null;
  requester?: string | null;
  durationSeconds?: number | null;
  progressSeconds?: number | null;
  backgroundTitle?: string | null;
  backgroundVideoId?: string | null;
  error?: string | null;
};
