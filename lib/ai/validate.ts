/**
 * Minimal runtime validation of request bodies for the AI routes.
 * Each validator returns the typed value or throws a ValidationError whose
 * message is safe to show to the user.
 */
import type {
  ChatModel,
  CodeLanguage,
  CodeSnapshot,
  Difficulty,
  InterviewConfig,
  InterviewMode,
  SpeechMetrics,
  Turn,
  VoiceEngine,
  VoiceMode,
} from "@/lib/types";
import { VOICE_OPTIONS } from "@/lib/types";
import { getChallenge } from "@/lib/challenges";

export class ValidationError extends Error {}

export const CHAT_MODELS: readonly ChatModel[] = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
const MODES: readonly InterviewMode[] = ["behavioral", "technical", "system-design", "leetcode", "ai-coding", "custom"];
const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];
const VOICES: readonly VoiceMode[] = ["browser", "cloud"];
const ENGINES: readonly VoiceEngine[] = ["claude", "gemini-live"];
const CLOUD_VOICES: readonly string[] = ["random", ...Object.keys(VOICE_OPTIONS)];
const LANGUAGES: readonly CodeLanguage[] = ["python", "javascript", "typescript", "java", "cpp", "go", "pseudocode"];

// Generous limits that keep a single request bounded.
const MAX_TURNS = 400;
const MAX_TEXT = 20_000;
const MAX_FIELD = 20_000;
const MAX_CODE = 50_000;
/** The API limit is 5 MB per image; base64 inflates by ~4/3. */
const MAX_SCREENSHOT_B64 = 6_500_000;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(o: Obj, key: string, max = MAX_FIELD): string {
  const v = o[key] ?? "";
  if (typeof v !== "string") throw new ValidationError(`"${key}" must be a string.`);
  if (v.length > max) throw new ValidationError(`"${key}" is too long (max ${max} characters).`);
  return v;
}

function oneOf<T extends string>(o: Obj, key: string, allowed: readonly T[]): T {
  const v = o[key];
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new ValidationError(`"${key}" must be one of: ${allowed.join(", ")}.`);
  }
  return v as T;
}

function num(o: Obj, key: string, min: number, max: number): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ValidationError(`"${key}" must be a number.`);
  return Math.min(max, Math.max(min, v));
}

export function parseConfig(v: unknown): InterviewConfig {
  if (!isObj(v)) throw new ValidationError(`"config" must be an object.`);
  const config: InterviewConfig = {
    mode: oneOf(v, "mode", MODES),
    engine: v.engine === undefined ? "claude" : oneOf(v, "engine", ENGINES),
    role: str(v, "role", 200),
    company: str(v, "company", 200),
    jobDescription: str(v, "jobDescription"),
    customScenario: str(v, "customScenario"),
    challengeId: str(v, "challengeId", 100),
    difficulty: oneOf(v, "difficulty", DIFFICULTIES),
    durationMin: num(v, "durationMin", 1, 180),
    model: oneOf(v, "model", CHAT_MODELS),
    voice: v.voice === undefined ? "browser" : oneOf(v, "voice", VOICES),
    cloudVoice: v.cloudVoice === undefined ? "random" : oneOf(v, "cloudVoice", CLOUD_VOICES),
  };
  if (config.mode === "custom" && !config.customScenario.trim()) {
    throw new ValidationError("A custom interview needs a scenario description.");
  }
  if (config.mode === "ai-coding" && !getChallenge(config.challengeId)) {
    throw new ValidationError("An AI-assisted coding interview needs a valid challenge.");
  }
  return config;
}

function parseCode(v: unknown): CodeSnapshot | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) throw new ValidationError(`"code" must be an object.`);
  const content = str(v, "content", MAX_CODE);
  if (!content.trim()) return undefined;
  return { language: oneOf(v, "language", LANGUAGES), content };
}

function parseTurn(v: unknown, i: number): Turn {
  if (!isObj(v)) throw new ValidationError(`turns[${i}] must be an object.`);
  const role = oneOf(v, "role", ["interviewer", "candidate"] as const);
  const turn: Turn = {
    id: typeof v.id === "string" ? v.id : String(i),
    role,
    text: str(v, "text", MAX_TEXT),
    at: typeof v.at === "number" && Number.isFinite(v.at) ? v.at : 0,
  };
  if (role === "candidate") {
    if (typeof v.screenshot === "string" && v.screenshot) {
      if (v.screenshot.length > MAX_SCREENSHOT_B64) throw new ValidationError("A screenshot is too large.");
      // Tolerate an accidental data: URL prefix.
      turn.screenshot = v.screenshot.replace(/^data:image\/\w+;base64,/, "");
    }
    turn.code = parseCode(v.code);
  }
  return turn;
}

export function parseTurns(v: unknown): Turn[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ValidationError(`"turns" must be an array.`);
  if (v.length > MAX_TURNS) throw new ValidationError(`Too many turns (max ${MAX_TURNS}).`);
  return v.map(parseTurn);
}

export function parseMetrics(v: unknown): SpeechMetrics {
  if (!isObj(v)) throw new ValidationError(`"metrics" must be an object.`);
  const breakdown: Record<string, number> = {};
  if (isObj(v.fillerBreakdown)) {
    for (const [k, n] of Object.entries(v.fillerBreakdown).slice(0, 50)) {
      if (typeof n === "number" && Number.isFinite(n)) breakdown[k.slice(0, 40)] = n;
    }
  }
  return {
    wordCount: num(v, "wordCount", 0, 1e6),
    wordsPerMinute: num(v, "wordsPerMinute", 0, 1000),
    fillerCount: num(v, "fillerCount", 0, 1e6),
    fillerBreakdown: breakdown,
    answerCount: num(v, "answerCount", 0, 1e5),
    avgAnswerWords: num(v, "avgAnswerWords", 0, 1e6),
  };
}

/** Reads and validates the JSON body as an object. */
export async function readJsonBody(req: Request): Promise<Obj> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
  if (!isObj(body)) throw new ValidationError("Request body must be a JSON object.");
  return body;
}

export { num as readNumber };
