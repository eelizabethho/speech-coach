/**
 * Server-only LLM wrapper. Do not import from client components: it reads
 * ANTHROPIC_API_KEY and holds the SDK client.
 *
 * Routes talk to the small provider-neutral interface below (`streamReply`,
 * `generateJson`, `toApiError`), so a different provider could be swapped in
 * by reimplementing this one file.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ApiError, ChatModel } from "@/lib/types";

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
// `.stream()` takes the base create params; the non-streaming variant is the exported alias of it minus `stream`.
type BetaMessageStreamParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

// ---------------------------------------------------------------------------
// Provider-neutral types
// ---------------------------------------------------------------------------

export type Effort = "low" | "medium" | "high";

export type LlmPart =
  | { type: "text"; text: string }
  /** Base64 JPEG, no "data:" prefix. */
  | { type: "image"; base64: string };

export interface LlmMessage {
  role: "user" | "assistant";
  parts: LlmPart[];
  /**
   * Mark the end of this message's stable content as a prompt-cache breakpoint.
   * Parts after `cacheAfterPart` (index) are excluded, so a volatile trailing
   * note does not break the cached prefix on the next request.
   */
  cacheAfterPart?: number;
}

export interface LlmRequest {
  model: ChatModel;
  /** Stable per-config system prompt; always cached. */
  system: string;
  messages: LlmMessage[];
  effort: Effort;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface ReplyResult {
  /** "end_turn", "max_tokens", "refusal", ... (null if unknown) */
  stopReason: string | null;
}

/** An error that already carries the HTTP status and ApiError body to return. */
export class LlmError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.error);
    this.name = "LlmError";
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new LlmError(500, {
      code: "missing_api_key",
      error:
        "The server has no Anthropic API key. Add ANTHROPIC_API_KEY=... to .env.local in the project root and restart the dev server.",
    });
  }
  // One client per server process (reads ANTHROPIC_API_KEY from env).
  client ??= new Anthropic();
  return client;
}

/** Models that accept server-side refusal fallback. Haiku 5.5 does not. */
const FALLBACK_MODELS: ReadonlySet<ChatModel> = new Set<ChatModel>([
  "claude-sonnet-5-5",
  "claude-opus-5-5",
]);

function buildParams(req: LlmRequest): BetaMessageStreamParams {
  const params: BetaMessageStreamParams = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
    messages: req.messages.map(toClaudeMessage),
    // No `thinking` (adaptive by default on these models) and no sampling
    // params (rejected by the API).
    output_config: { effort: req.effort },
  };
  if (FALLBACK_MODELS.has(req.model)) {
    // On a policy decline, the API re-runs the request on a server-chosen
    // fallback model inside the same call.
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  return params;
}

function toClaudeMessage(m: LlmMessage): BetaMessageParam {
  const content: BetaContentBlockParam[] = m.parts.map((p, i) => {
    const cache = m.cacheAfterPart === i ? { cache_control: { type: "ephemeral" as const } } : {};
    return p.type === "text"
      ? { type: "text", text: p.text, ...cache }
      : {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: p.base64 },
          ...cache,
        };
  });
  return { role: m.role, content };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Streams the reply text. Yields only visible text deltas (no thinking).
 * The generator's return value carries the stop reason. Calling `.return()`
 * early (e.g. client disconnected) aborts the upstream request.
 */
export async function* streamReply(req: LlmRequest): AsyncGenerator<string, ReplyResult, void> {
  const stream = getClient().beta.messages.stream(buildParams(req), { signal: req.signal });
  let finished = false;
  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        if (event.delta.text) yield event.delta.text;
      }
    }
    const final = await stream.finalMessage();
    finished = true;
    return { stopReason: final.stop_reason ?? null };
  } finally {
    if (!finished) stream.abort();
  }
}

/**
 * One structured-output call: the model must answer with JSON matching
 * `schema`. Returns the parsed (unvalidated) value.
 * Throws LlmError "refused" on a safety refusal and "incomplete" when the
 * output was cut off.
 */
export async function generateJson(
  req: LlmRequest & { schema: Record<string, unknown> },
): Promise<unknown> {
  const params = buildParams(req);
  params.output_config = {
    ...params.output_config,
    format: { type: "json_schema", schema: req.schema },
  };

  const final = await getClient().beta.messages.stream(params, { signal: req.signal }).finalMessage();

  if (final.stop_reason === "refusal") {
    throw new LlmError(422, {
      code: "refused",
      error: "The AI declined to generate feedback for this interview. Try again, or start a new session.",
    });
  }
  if (final.stop_reason === "max_tokens") {
    throw new LlmError(502, {
      code: "incomplete",
      error: "The feedback report was cut off before it finished. Please try again.",
    });
  }
  const text = final.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new LlmError(502, {
      code: "bad_model_output",
      error: "The AI returned a malformed report. Please try again.",
    });
  }
}

/** Maps any thrown value to an HTTP status + friendly ApiError. */
export function toApiError(err: unknown): { status: number; body: ApiError } {
  if (err instanceof LlmError) return { status: err.status, body: err.body };

  const e = (code: string, error: string, status: number) => ({ status, body: { code, error } });

  // Most specific first: several of these subclass each other.
  if (err instanceof Anthropic.APIUserAbortError) return e("aborted", "The request was cancelled.", 499);
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return e("timeout", "The AI service took too long to respond. Please try again.", 504);
  if (err instanceof Anthropic.APIConnectionError)
    return e("connection_error", "Couldn't reach the AI service. Check your internet connection and try again.", 502);
  if (err instanceof Anthropic.AuthenticationError)
    return e(
      "invalid_api_key",
      "Your ANTHROPIC_API_KEY was rejected. Check the key in .env.local and restart the dev server.",
      401,
    );
  if (err instanceof Anthropic.PermissionDeniedError)
    return e("permission_denied", "Your API key doesn't have access to this model or feature.", 403);
  if (err instanceof Anthropic.NotFoundError)
    return e("not_found", "The selected model isn't available for your API key. Try a different model.", 404);
  if (err instanceof Anthropic.RateLimitError)
    return e("rate_limited", "Too many requests to the AI service right now. Wait a few seconds and try again.", 429);
  if (err instanceof Anthropic.ContentTooLargeError)
    return e("too_large", "This interview is too large to send. Try removing screenshots or starting a new session.", 413);
  if (err instanceof Anthropic.BadRequestError)
    return e("upstream_bad_request", `The AI service rejected the request: ${err.message}`, 400);
  if (err instanceof Anthropic.OverloadedError)
    return e("overloaded", "The AI service is overloaded right now. Please try again in a moment.", 503);
  if (err instanceof Anthropic.InternalServerError)
    return e("upstream_error", "The AI service had an internal error. Please try again.", 502);
  if (err instanceof Anthropic.APIError)
    return e("upstream_error", `The AI service returned an error: ${err.message}`, err.status ?? 502);

  console.error("[ai] unexpected error", err);
  return e("internal_error", "Something went wrong on the server. Please try again.", 500);
}

/** JSON ApiError response helper for route handlers. */
export function jsonError(status: number, body: ApiError): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Convenience: toApiError + jsonError. */
export function errorResponse(err: unknown): Response {
  const { status, body } = toApiError(err);
  return jsonError(status, body);
}
