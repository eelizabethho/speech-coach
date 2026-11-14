/**
 * POST /api/interview — streams the interviewer's next spoken reply as
 * text/plain chunks. See InterviewRequest in lib/types.ts.
 */
import { errorResponse, jsonError, streamReply, type LlmMessage, type LlmPart } from "@/lib/ai/llm";
import { buildPacingNote, buildSystemPrompt } from "@/lib/ai/scenarios";
import { parseConfig, parseTurns, readJsonBody, readNumber, ValidationError } from "@/lib/ai/validate";
import type { InterviewConfig, Turn } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOIN_MESSAGE =
  "[The candidate has joined the call. Begin the interview: greet them briefly and ask your first question.]";
const SILENT_MESSAGE = "[The candidate hasn't responded yet.]";
const REFUSAL_LINE = "Sorry, let's move on to a different question.";

export async function POST(req: Request): Promise<Response> {
  let config: InterviewConfig;
  let turns: Turn[];
  let elapsedSec: number;
  let silentSec: number | undefined;
  let mayWait: boolean;
  try {
    const body = await readJsonBody(req);
    config = parseConfig(body.config);
    turns = parseTurns(body.turns);
    elapsedSec = body.elapsedSec === undefined ? 0 : readNumber(body, "elapsedSec", 0, 24 * 3600);
    silentSec = body.silentSec === undefined ? undefined : readNumber(body, "silentSec", 0, 24 * 3600);
    mayWait = body.mayWait === true;
  } catch (err) {
    if (err instanceof ValidationError) return jsonError(400, { code: "bad_request", error: err.message });
    return errorResponse(err);
  }

  const gen = streamReply({
    model: config.model,
    system: buildSystemPrompt(config),
    messages: toMessages(turns, buildPacingNote(config, elapsedSec, { mayWait, silentSec })),
    effort: "low", // fast conversational turns
    maxTokens: 2000,
    signal: req.signal,
  });

  // Pull the first chunk before committing to a 200, so auth/rate-limit/etc.
  // errors come back as a proper JSON ApiError.
  let first: IteratorResult<string, { stopReason: string | null }>;
  try {
    first = await gen.next();
  } catch (err) {
    return errorResponse(err);
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let sentText = false;
      try {
        let step = first;
        while (!step.done) {
          controller.enqueue(encoder.encode(step.value));
          sentText = true;
          step = await gen.next();
        }
        if (step.value.stopReason === "refusal") {
          controller.enqueue(encoder.encode((sentText ? " " : "") + REFUSAL_LINE));
        }
      } catch (err) {
        // Headers are already sent; end the reply cleanly instead of erroring.
        if (!req.signal.aborted) console.error("[api/interview] stream error", err);
      } finally {
        try {
          controller.close();
        } catch {
          // already closed/cancelled
        }
      }
    },
    async cancel() {
      // Client went away: abort the upstream request.
      await gen.return({ stopReason: null });
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Turns → alternating user/assistant messages.
 * - interviewer → assistant, candidate → user; consecutive same-role turns merge.
 * - Must start (and end) with a user message.
 * - Only the most recent screenshot is sent as an image; older ones become a
 *   short placeholder to save tokens.
 * - The pacing note is appended to the final user message after a cache
 *   breakpoint, so the history prefix stays cacheable across requests.
 */
function toMessages(turns: Turn[], pacingNote: string): LlmMessage[] {
  let lastShotIdx = -1;
  turns.forEach((t, i) => {
    if (t.role === "candidate" && t.screenshot) lastShotIdx = i;
  });

  const messages: LlmMessage[] = [];
  turns.forEach((t, i) => {
    const parts = t.role === "candidate" ? candidateParts(t, i === lastShotIdx) : textParts(t.text);
    if (parts.length === 0) return;
    const role = t.role === "candidate" ? "user" : "assistant";
    const prev = messages[messages.length - 1];
    if (prev && prev.role === role) prev.parts.push(...parts);
    else messages.push({ role, parts });
  });

  if (messages.length === 0 || messages[0].role !== "user") {
    messages.unshift({ role: "user", parts: [{ type: "text", text: JOIN_MESSAGE }] });
  }
  if (messages[messages.length - 1].role !== "user") {
    // Assistant prefill is not supported; nudge the interviewer to continue.
    messages.push({ role: "user", parts: [{ type: "text", text: SILENT_MESSAGE }] });
  }

  const last = messages[messages.length - 1];
  last.cacheAfterPart = last.parts.length - 1;
  last.parts.push({ type: "text", text: pacingNote });
  return messages;
}

function textParts(text: string): LlmPart[] {
  const t = text.trim();
  return t ? [{ type: "text", text: t }] : [];
}

function candidateParts(t: Turn, includeScreenshot: boolean): LlmPart[] {
  const parts = textParts(t.text);
  if (t.code) {
    parts.push({
      type: "text",
      text: `[Candidate's code editor (${t.code.language})]\n\`\`\`${t.code.language}\n${t.code.content}\n\`\`\``,
    });
  }
  if (t.screenshot) {
    if (includeScreenshot) {
      parts.push({ type: "text", text: "[Screenshot of the candidate's shared screen]" });
      parts.push({ type: "image", base64: t.screenshot });
    } else {
      parts.push({ type: "text", text: "[earlier screenshot omitted]" });
    }
  }
  return parts;
}
