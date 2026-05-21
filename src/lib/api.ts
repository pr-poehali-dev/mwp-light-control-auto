import func2url from "../../backend/func2url.json";

const URLS = func2url as Record<string, string>;

async function req<T>(fn: string, path = "/", options: RequestInit = {}): Promise<T> {
  const url = URLS[fn] + path;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`API ${fn}${path}: ${text}`);
  }
}

// ─── Presets ─────────────────────────────────────────────────────────────────
export interface ApiPreset {
  id: number;
  name: string;
  genre: string;
  bpm: number;
  color: string;
  channels: number[];
  created_at: string;
  updated_at: string;
}

export const presetsApi = {
  list: () => req<ApiPreset[]>("presets", "/"),
  create: (data: Omit<ApiPreset, "id" | "created_at" | "updated_at">) =>
    req<ApiPreset>("presets", "/", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: Omit<ApiPreset, "id" | "created_at" | "updated_at">) =>
    req<ApiPreset>("presets", `/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: number) =>
    req<{ ok: boolean }>("presets", `/${id}`, { method: "DELETE" }),
};

// ─── History ─────────────────────────────────────────────────────────────────
export interface ApiEvent {
  id: number;
  event_type: "ai" | "auto" | "manual";
  message: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export const historyApi = {
  list: (params?: { limit?: number; offset?: number; type?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit)  qs.set("limit",  String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    if (params?.type)   qs.set("type",   params.type);
    const q = qs.toString() ? `?${qs}` : "";
    return req<{ events: ApiEvent[]; total: number }>("history", `/${q}`);
  },
  add: (event_type: "ai" | "auto" | "manual", message: string, meta: Record<string, unknown> = {}) =>
    req<ApiEvent>("history", "/", {
      method: "POST",
      body: JSON.stringify({ event_type, message, meta }),
    }),
  clear: () => req<{ ok: boolean }>("history", "/", { method: "DELETE" }),
};

// ─── Settings ─────────────────────────────────────────────────────────────────
export type ApiSettings = Record<string, string>;

export const settingsApi = {
  get: () => req<ApiSettings>("settings", "/"),
  save: (data: Partial<ApiSettings>) =>
    req<{ ok: boolean }>("settings", "/", { method: "POST", body: JSON.stringify(data) }),
};

// ─── Art-Net ──────────────────────────────────────────────────────────────────
export interface ArtNetStatus {
  ok: boolean;
  ts: number;
  ip: string;
  channels_sent: number;
  error: string;
}

export const artnetApi = {
  status: () => req<ArtNetStatus>("artnet", "/"),
  send: (channels: number[], ip?: string, port?: number, universe?: number) =>
    req<{ ok: boolean; error?: string; bytes?: number }>("artnet", "/send", {
      method: "POST",
      body: JSON.stringify({ channels, ip, port, universe }),
    }),
  test: (ip?: string, port?: number, universe?: number) =>
    req<{ ok: boolean; error?: string }>("artnet", "/test", {
      method: "POST",
      body: JSON.stringify({ ip, port, universe }),
    }),
};
