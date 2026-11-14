import { DEFAULT_CONFIG, VOICE_OPTIONS, type InterviewConfig, type SavedSession, type Turn } from "@/lib/types";

export const SESSIONS_KEY = "speech-coach:sessions";
export const LAST_CONFIG_KEY = "speech-coach:last-config";
/** sessionStorage key used to hand the chosen config from the setup page to /interview. */
export const ACTIVE_CONFIG_KEY = "speech-coach:active-config";
const MAX_SESSIONS = 30;

function storage(kind: "local" | "session"): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function stripScreenshots(turns: Turn[]): Turn[] {
  return turns.map((t) => {
    if (!t.screenshot) return t;
    const { screenshot: _drop, ...rest } = t;
    return rest;
  });
}

/** Fills in any fields missing from a stored (possibly older) config. */
export function normalizeConfig(raw: unknown): InterviewConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const merged = { ...DEFAULT_CONFIG, ...(raw as Partial<InterviewConfig>) };
  if (typeof merged.mode !== "string" || typeof merged.role !== "string") return null;
  if (!Object.keys(VOICE_OPTIONS).includes(merged.cloudVoice)) merged.cloudVoice = "random";
  return merged;
}

function readSessions(): SavedSession[] {
  try {
    const raw = storage("local")?.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedSession[]).filter((s) => s && typeof s.id === "string") : [];
  } catch {
    return [];
  }
}

function writeSessions(sessions: SavedSession[]): boolean {
  const store = storage("local");
  if (!store) return false;
  let list = sessions.slice(0, MAX_SESSIONS);
  // If quota is exceeded, drop the oldest sessions until it fits.
  while (list.length > 0) {
    try {
      store.setItem(SESSIONS_KEY, JSON.stringify(list));
      return true;
    } catch {
      list = list.slice(0, list.length - 1);
    }
  }
  try {
    store.removeItem(SESSIONS_KEY);
  } catch {
    /* ignore */
  }
  return false;
}

/** Newest first. */
export function listSessions(): SavedSession[] {
  return readSessions().sort((a, b) => b.startedAt - a.startedAt);
}

export function getSession(id: string): SavedSession | null {
  return readSessions().find((s) => s.id === id) ?? null;
}

/** Inserts or replaces (by id). Screenshots are stripped. */
export function saveSession(session: SavedSession): boolean {
  const clean: SavedSession = { ...session, turns: stripScreenshots(session.turns) };
  const rest = readSessions().filter((s) => s.id !== clean.id);
  return writeSessions([clean, ...rest].sort((a, b) => b.startedAt - a.startedAt));
}

export function deleteSession(id: string): void {
  writeSessions(readSessions().filter((s) => s.id !== id));
}

export function saveLastConfig(config: InterviewConfig): void {
  try {
    storage("local")?.setItem(LAST_CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
}

export function loadLastConfig(): InterviewConfig | null {
  try {
    const raw = storage("local")?.getItem(LAST_CONFIG_KEY);
    return raw ? normalizeConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function setActiveConfig(config: InterviewConfig): void {
  try {
    storage("session")?.setItem(ACTIVE_CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
}

/** Config for the interview room: the one chosen on the setup page, else the last used one. */
export function loadActiveConfig(): InterviewConfig | null {
  try {
    const raw = storage("session")?.getItem(ACTIVE_CONFIG_KEY);
    const cfg = raw ? normalizeConfig(JSON.parse(raw)) : null;
    if (cfg) return cfg;
  } catch {
    /* fall through */
  }
  return loadLastConfig();
}
