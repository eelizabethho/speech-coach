/**
 * POST /api/feedback — returns a FeedbackReport (JSON) for a finished
 * interview. See FeedbackRequest in lib/types.ts.
 */
import { getChallenge } from "@/lib/challenges";
import { errorResponse, generateJson, jsonError } from "@/lib/ai/llm";
import { parseConfig, parseMetrics, parseTurns, readJsonBody, readNumber, ValidationError } from "@/lib/ai/validate";
import {
  FEEDBACK_JSON_SCHEMA,
  MODE_LABELS,
  type BetterAnswer,
  type FeedbackCategory,
  type FeedbackReport,
  type InterviewConfig,
  type InterviewMode,
  type SpeechMetrics,
  type Turn,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** High-effort report generation can take a while. */
export const maxDuration = 300;

const FEEDBACK_MODEL = "claude-sonnet-5-5" as const;

const MODE_CATEGORIES: Record<InterviewMode, string[]> = {
  behavioral: ["STAR structure", "Ownership & impact", "Self-awareness & reflection"],
  technical: ["Technical depth", "Accuracy", "Reasoning under questioning"],
  "system-design": ["Requirements gathering", "High-level design", "Deep dives", "Tradeoffs"],
  leetcode: ["Problem solving", "Code quality", "Testing & edge cases", "Complexity analysis"],
  "ai-coding": ["Understanding the codebase", "Directing the AI", "Verifying AI output", "Testing & correctness"],
  custom: ["Persuasiveness & content", "Handling questions & objections"],
};
const CORE_CATEGORIES = ["Communication", "Structure", "Clarity & pace / filler words"];

function challengeLine(id: string): string {
  const c = getChallenge(id);
  return c ? `Codebase: ${c.repo} (${c.url})\nTask: ${c.task}\nThey worked with an AI coding assistant; judge how they directed and verified it, not just the result.` : "";
}

export async function POST(req: Request): Promise<Response> {
  let config: InterviewConfig;
  let turns: Turn[];
  let durationSec: number;
  let metrics: SpeechMetrics;
  try {
    const body = await readJsonBody(req);
    config = parseConfig(body.config);
    turns = parseTurns(body.turns);
    durationSec = readNumber(body, "durationSec", 0, 24 * 3600);
    metrics = parseMetrics(body.metrics);
  } catch (err) {
    if (err instanceof ValidationError) return jsonError(400, { code: "bad_request", error: err.message });
    return errorResponse(err);
  }

  const answers = turns.filter((t) => t.role === "candidate" && (t.text.trim() || t.code)).length;
  // Nothing to evaluate: answer locally instead of paying for a model call.
  if (answers === 0) return Response.json(emptyReport());

  try {
    const raw = await generateJson({
      model: FEEDBACK_MODEL,
      system: buildFeedbackSystem(config),
      messages: [
        { role: "user", parts: [{ type: "text", text: buildFeedbackInput(config, turns, durationSec, metrics, answers) }] },
      ],
      effort: "high",
      maxTokens: 16000,
      schema: FEEDBACK_JSON_SCHEMA as unknown as Record<string, unknown>,
      signal: req.signal,
    });
    const report = normalizeReport(raw);
    if (!report) {
      return jsonError(502, { code: "bad_model_output", error: "The AI returned an incomplete report. Please try again." });
    }
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

function buildFeedbackSystem(config: InterviewConfig): string {
  const categories = [...CORE_CATEGORIES, ...MODE_CATEGORIES[config.mode]];
  const who =
    config.mode === "custom"
      ? "an experienced coach who has run hundreds of sessions like the practice scenario described below"
      : `an experienced hiring manager who has run hundreds of ${MODE_LABELS[config.mode].toLowerCase()} interviews`;
  return `You are ${who}. You are writing a candid post-interview feedback report for the candidate so they can improve.

Be honest and specific, not generic. Ground every point in the transcript: quote the candidate's own words (short quotes) when praising or criticizing. Do not invent things they did not say. Calibrate to the role, company and difficulty: a 5 means borderline for this bar, 7 solid, 9 to 10 exceptional. Score conservatively when evidence is thin.

The transcript comes from browser speech recognition, so ignore obvious transcription errors and odd punctuation; do not penalize them. Do judge filler words and pace using the provided speech metrics (roughly 120 to 160 words per minute is comfortable for interviews; a filler rate above about 3 per 100 words is noticeable).

Fill the report fields as follows:
- overallScore: integer 1 to 10.
- verdict: the hiring recommendation you would give for this role at this bar.
- summary: 3 to 5 sentences on how it went overall.
- categories: score each of these, in this order, with an integer 1 to 10 and a 1 to 3 sentence comment citing evidence: ${categories.join("; ")}.
- strengths: 2 to 5 specific things they did well.
- improvements: 2 to 5 specific, most important things to fix.
- betterAnswers: 2 to 3 entries for their weakest answers: the interviewer's question, a one-sentence summary of what they said, and a rewritten improved answer in the candidate's own voice that they could actually say out loud (realistic, not superhuman; keep their real experience and only add structure, specifics and clarity; mark anything they would need to fill in with brackets like [metric]).
- nextSteps: 3 to 5 concrete, actionable practice steps for the next week.

If the interview was too short to judge well (for example fewer than two real answers), say so plainly in the summary, score only what you saw, and make nextSteps about doing a full-length session. Return fewer betterAnswers if there are not enough answers.`;
}

function buildFeedbackInput(
  config: InterviewConfig,
  turns: Turn[],
  durationSec: number,
  metrics: SpeechMetrics,
  answers: number,
): string {
  const fillers =
    Object.entries(metrics.fillerBreakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([w, n]) => `"${w}" x${n}`)
      .join(", ") || "none";

  const transcript = turns
    .map((t) => {
      const label = t.role === "interviewer" ? "Interviewer" : "Candidate";
      let line = `${label}: ${t.text.trim() || "(no speech)"}`;
      if (t.code) line += `\n[Candidate's code editor (${t.code.language})]\n\`\`\`${t.code.language}\n${t.code.content}\n\`\`\``;
      if (t.screenshot) line += "\n[Candidate shared their screen here; image not included]";
      return line;
    })
    .join("\n\n");

  const ctx = [
    `Interview type: ${MODE_LABELS[config.mode]}`,
    `Role: ${config.role || "not specified"}`,
    config.company && `Company: ${config.company}`,
    `Difficulty: ${config.difficulty}`,
    `Planned length: ${config.durationMin} min; actual length: ${(durationSec / 60).toFixed(1)} min`,
    config.mode === "ai-coding" && challengeLine(config.challengeId),
    config.mode === "custom" && `Scenario brief:\n<scenario>\n${config.customScenario}\n</scenario>`,
    config.jobDescription && `Job description:\n<job_description>\n${config.jobDescription}\n</job_description>`,
  ]
    .filter(Boolean)
    .join("\n");

  return `<interview_context>
${ctx}
</interview_context>

<speech_metrics>
Candidate answers: ${answers}
Words spoken: ${metrics.wordCount}
Words per minute: ${Math.round(metrics.wordsPerMinute)}
Average words per answer: ${Math.round(metrics.avgAnswerWords)}
Filler words: ${metrics.fillerCount} total (${fillers})
</speech_metrics>

<transcript>
${transcript}
</transcript>

Write the feedback report.`;
}

// ---------------------------------------------------------------------------
// Output validation
// ---------------------------------------------------------------------------

const VERDICTS = ["Strong hire", "Hire", "Lean hire", "Lean no hire", "No hire"];

const clampScore = (n: unknown) => Math.min(10, Math.max(1, Math.round(typeof n === "number" ? n : 1)));
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

/** Minimal shape check (structured outputs should already guarantee it). */
function normalizeReport(raw: unknown): FeedbackReport | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.summary !== "string" || !Array.isArray(r.categories)) return null;

  const categories: FeedbackCategory[] = r.categories
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => ({ name: String(c.name ?? ""), score: clampScore(c.score), comment: String(c.comment ?? "") }))
    .filter((c) => c.name);

  const betterAnswers: BetterAnswer[] = (Array.isArray(r.betterAnswers) ? r.betterAnswers : [])
    .filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null)
    .map((b) => ({
      question: String(b.question ?? ""),
      yourAnswerSummary: String(b.yourAnswerSummary ?? ""),
      improvedAnswer: String(b.improvedAnswer ?? ""),
    }))
    .filter((b) => b.improvedAnswer);

  return {
    overallScore: clampScore(r.overallScore),
    verdict: typeof r.verdict === "string" && VERDICTS.includes(r.verdict) ? r.verdict : "Lean no hire",
    summary: r.summary,
    categories,
    strengths: strings(r.strengths),
    improvements: strings(r.improvements),
    betterAnswers,
    nextSteps: strings(r.nextSteps),
  };
}

function emptyReport(): FeedbackReport {
  return {
    overallScore: 1,
    verdict: "No hire",
    summary:
      "This session was too short to evaluate: there were no candidate answers in the transcript. Run a longer session and answer at least a few questions to get a meaningful report.",
    categories: CORE_CATEGORIES.map((name) => ({ name, score: 1, comment: "Not enough of the interview to assess." })),
    strengths: [],
    improvements: ["Answer at least two or three questions so there is something to evaluate."],
    betterAnswers: [],
    nextSteps: [
      "Start a new session and stay for the full planned length.",
      "Check that your microphone is allowed and your answers appear in the transcript.",
    ],
  };
}
