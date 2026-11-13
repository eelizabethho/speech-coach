import type { SpeechMetrics, Turn } from "@/lib/types";

/** Tokens: words (with apostrophes) and sentence/clause punctuation. */
function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .match(/[a-z0-9]+(?:'[a-z]+)?|[.?!,;:]/g) ?? []
  );
}

const isWord = (t: string | undefined): t is string => !!t && /^[a-z0-9]/.test(t);
const isBoundary = (t: string | undefined) => t === undefined || /^[.?!,;:]$/.test(t);

const HESITATIONS: Record<string, string> = {
  um: "um", umm: "um", ummm: "um", uh: "uh", uhh: "uh", uhm: "um",
  er: "er", erm: "er", ah: "ah", ahh: "ah",
};
const ALWAYS_FILLER = new Set(["basically", "actually", "literally"]);

/** Words before "like" that make it a real verb/comparison, not a filler. */
const LIKE_LEGIT_BEFORE = new Set([
  "would", "i'd", "you'd", "we'd", "they'd", "he'd", "she'd", "i", "you", "we", "they",
  "feel", "feels", "felt", "look", "looks", "looked", "something", "anything", "nothing",
  "sound", "sounds", "seem", "seems", "don't", "didn't", "doesn't", "not", "really",
  "just", "much", "more", "most", "things", "stuff", "languages", "tools", "is", "be",
]);
/** Words before "kind of" / "sort of" that make it a literal noun ("a kind of tree"). */
const KIND_LEGIT_BEFORE = new Set(["a", "the", "what", "this", "that", "some", "any", "which", "every", "same", "one"]);
/** Words before "you know" that make it a real question/clause. */
const YOU_KNOW_LEGIT_BEFORE = new Set(["do", "did", "if", "don't", "didn't", "would", "will", "can", "as"]);
/** "so" opening a clause is a filler when followed by one of these (or by another filler). */
const SO_AFTER_HESITATION = new Set(["um", "uh", "er", "ah", "and", "okay", "ok", "yeah", "well", "like"]);

function add(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

/** Count filler words in one answer. Exported for testing. */
export function countFillers(text: string): Record<string, number> {
  const tokens = tokenize(text);
  const out: Record<string, number> = {};
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i];
    if (!isWord(w)) continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];

    if (HESITATIONS[w]) { add(out, HESITATIONS[w]); continue; }
    if (ALWAYS_FILLER.has(w)) { add(out, w); continue; }

    if (w === "like") {
      const legitBefore = isWord(prev) && LIKE_LEGIT_BEFORE.has(prev);
      const legitAfter = next === "to";
      if (!legitBefore && !legitAfter) add(out, "like");
      continue;
    }
    if ((w === "kind" || w === "sort") && next === "of") {
      if (!(isWord(prev) && KIND_LEGIT_BEFORE.has(prev))) add(out, `${w} of`);
      i++;
      continue;
    }
    if (w === "you" && next === "know") {
      const after = tokens[i + 2];
      const legit = (isWord(prev) && YOU_KNOW_LEGIT_BEFORE.has(prev)) || after === "how" || after === "where" || after === "why";
      if (!legit) add(out, "you know");
      i++;
      continue;
    }
    if (w === "i" && next === "mean") {
      const legit = isWord(prev) && (prev === "what" || prev === "do" || prev === "did");
      if (!legit) add(out, "i mean");
      i++;
      continue;
    }
    if (w === "so") {
      // Filler when it starts the answer/sentence or follows a hesitation, and isn't "so that"/"so far"/"so much".
      const opener = isBoundary(prev) || (isWord(prev) && SO_AFTER_HESITATION.has(prev));
      const legitAfter = next === "that" || next === "far" || next === "much" || next === "many" || next === "on" || isBoundary(next);
      if (opener && !legitAfter) add(out, "so");
      continue;
    }
    if (w === "right") {
      // Tag question ("..., right?") or a standalone "right," opener.
      if (next === "?" || (isBoundary(prev) && next === ",")) add(out, "right");
      continue;
    }
  }
  return out;
}

function countWords(text: string): number {
  return tokenize(text).filter(isWord).length;
}

/**
 * Speech metrics for the candidate's turns.
 * @param durationSec total interview length
 * @param speakingSec optional time the candidate actually had the mic; used for WPM when meaningful
 */
export function computeMetrics(turns: Turn[], durationSec: number, speakingSec?: number): SpeechMetrics {
  const answers = turns.filter((t) => t.role === "candidate" && t.text.trim());
  const fillerBreakdown: Record<string, number> = {};
  let wordCount = 0;
  for (const a of answers) {
    wordCount += countWords(a.text);
    for (const [k, v] of Object.entries(countFillers(a.text))) fillerBreakdown[k] = (fillerBreakdown[k] ?? 0) + v;
  }
  const fillerCount = Object.values(fillerBreakdown).reduce((s, n) => s + n, 0);
  // Pace is only meaningful with enough spoken time to measure; otherwise report 0 ("not measured")
  // instead of an absurd number (e.g. a typed answer sent 2 seconds in).
  const basisSec =
    speakingSec && speakingSec >= 20 && speakingSec <= durationSec + 1
      ? speakingSec
      : durationSec >= 60
        ? durationSec
        : 0;
  const wordsPerMinute = basisSec > 0 ? Math.min(400, Math.round(wordCount / (basisSec / 60))) : 0;
  return {
    wordCount,
    wordsPerMinute,
    fillerCount,
    fillerBreakdown,
    answerCount: answers.length,
    avgAnswerWords: answers.length ? Math.round(wordCount / answers.length) : 0,
  };
}
