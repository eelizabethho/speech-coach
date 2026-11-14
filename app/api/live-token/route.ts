/**
 * POST /api/live-token — mints a short-lived Gemini Live token for the browser,
 * locked to the interviewer's model and settings, so GEMINI_API_KEY never
 * leaves the server. Body: { config: InterviewConfig }. Returns LiveTokenResponse.
 */
import { EndSensitivity, GoogleGenAI, Modality, type LiveConnectConfig } from "@google/genai";
import { jsonError } from "@/lib/ai/llm";
import { buildSystemPrompt } from "@/lib/ai/scenarios";
import { parseConfig, readJsonBody, ValidationError } from "@/lib/ai/validate";
import type { InterviewMode, LiveTokenResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MODEL = "gemini-3.8-live";

/** Biases transcription toward terms people actually say in each kind of interview. */
const VOCAB: Record<InterviewMode, string[]> = {
  leetcode: ["hash map", "hash set", "two pointers", "sliding window", "BFS", "DFS", "binary search", "memoization", "O of n", "heap", "linked list"],
  technical: ["API", "REST", "SQL", "indexing", "concurrency", "mutex", "garbage collection", "TCP", "HTTP", "Kubernetes", "React"],
  "system-design": ["load balancer", "sharding", "replication", "CDN", "cache", "Redis", "Kafka", "QPS", "latency", "consistency"],
  behavioral: ["STAR", "stakeholder", "deadline", "ownership"],
  custom: [],
};

export async function POST(req: Request): Promise<Response> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return jsonError(503, {
      code: "missing_gemini_key",
      error: "Gemini Live isn't set up. Add GEMINI_API_KEY=... to .env.local and restart the dev server, or pick the Claude engine.",
    });
  }

  let config;
  try {
    config = parseConfig((await readJsonBody(req)).config);
  } catch (err) {
    if (err instanceof ValidationError) return jsonError(400, { code: "bad_request", error: err.message });
    throw err;
  }

  const model = process.env.GEMINI_LIVE_MODEL || DEFAULT_MODEL;
  const vocab = [...VOCAB[config.mode], config.company.trim()].filter(Boolean);
  const liveConfig: LiveConnectConfig = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: buildSystemPrompt({ ...config, engine: "gemini-live" }),
    // Verbatim (the default) keeps "um"/"uh" in the transcript for the filler-word metrics.
    inputAudioTranscription: vocab.length ? { customVocabulary: vocab } : {},
    outputAudioTranscription: {},
    realtimeInputConfig: {
      // Thinking pauses shouldn't end the turn; the model also decides on its own whether to answer.
      automaticActivityDetection: { endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW, silenceDurationMs: 800 },
    },
    // Without this, audio+video sessions are capped at 2 minutes.
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: {},
  };

  try {
    const ai = new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: "v1beta" } });
    const now = Date.now();
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        // The browser fetches a fresh token on every reconnect, so this only needs to cover one connection.
        expireTime: new Date(now + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        liveConnectConstraints: { model, config: liveConfig },
      },
    });
    if (!token.name) throw new Error("No token returned.");
    const body: LiveTokenResponse = { token: token.name, model, config: liveConfig };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api/live-token]", err);
    return jsonError(502, {
      code: "upstream_error",
      error: `Couldn't start a Gemini Live session: ${err instanceof Error ? err.message : "unknown error"}`,
    });
  }
}
