import { NextResponse } from "next/server";
import { VOICE_OPTIONS, type ApiError, type TtsStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHARS = 1000;
const GOOGLE_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

function apiError(status: number, error: string, code: string) {
  return NextResponse.json<ApiError>({ error, code }, { status });
}

export async function GET() {
  return NextResponse.json<TtsStatus>({
    cloudEnabled: Boolean(process.env.GOOGLE_TTS_API_KEY),
  });
}

export async function POST(req: Request) {
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) {
    return apiError(503, "Cloud voice is not configured on this server.", "cloud_tts_disabled");
  }

  let text: unknown;
  let voice: unknown;
  try {
    ({ text, voice } = (await req.json()) as { text?: unknown; voice?: unknown });
  } catch {
    return apiError(400, "Body must be JSON: { text: string }.", "bad_request");
  }
  if (typeof text !== "string" || !text.trim()) {
    return apiError(400, "`text` must be a non-empty string.", "bad_request");
  }
  if (text.length > MAX_CHARS) {
    return apiError(400, `\`text\` must be at most ${MAX_CHARS} characters.`, "bad_request");
  }

  try {
    const upstream = await fetch(`${GOOGLE_TTS_URL}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: text.trim() },
        voice: {
          languageCode: "en-US",
          // Only allowlisted ids reach Google; anything else uses the server default.
          name:
            typeof voice === "string" && Object.keys(VOICE_OPTIONS).includes(voice)
              ? voice
              : process.env.GOOGLE_TTS_VOICE || "en-US-Neural2-F",
        },
        audioConfig: { audioEncoding: "MP3", speakingRate: 1.05 },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!upstream.ok) {
      // Log status only; the upstream body/URL could echo the key.
      console.error(`[tts] Google TTS responded ${upstream.status}`);
      const code = upstream.status === 429 ? "rate_limited" : "upstream_error";
      return apiError(502, "Cloud voice synthesis failed.", code);
    }

    const data = (await upstream.json()) as { audioContent?: string };
    if (!data.audioContent) {
      return apiError(502, "Cloud voice returned no audio.", "upstream_error");
    }

    const bytes = Buffer.from(data.audioContent, "base64");
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[tts] request failed:", err instanceof Error ? err.name : "unknown");
    return apiError(502, "Cloud voice synthesis failed.", "upstream_error");
  }
}
