"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SpeakerController, TtsStatus, VoiceMode } from "@/lib/types";

// ---------------------------------------------------------------------------
// Sentence chunking
// ---------------------------------------------------------------------------

/** Words whose trailing "." does not end a sentence. Lowercase, no dot. */
const ABBREVIATIONS = new Set([
  "e.g", "i.e", "eg", "ie", "vs", "al", "dr", "mr", "mrs", "ms", "prof", "sr", "jr",
  "mt", "approx", "fig", "corp", "dept", "u.s", "a.m", "p.m",
]);

const MAX_CHUNK = 280; // force a split on very long run-on sentences

/** Returns the index right after the end of the first complete sentence, or -1. */
function findSentenceEnd(buf: string): number {
  for (let i = 0; i < buf.length; i++) {
    const ch = buf[i];
    if (ch === "\n") {
      if (buf.slice(0, i).trim()) return i + 1;
      continue;
    }
    if (ch !== "." && ch !== "!" && ch !== "?") continue;

    // Swallow repeated punctuation and closing quotes/brackets: `?!`, `."`, `.)`
    let j = i + 1;
    while (j < buf.length && /[.!?"'”’)\]]/.test(buf[j])) j++;
    if (j >= buf.length) return -1; // can't know yet whether more follows
    if (!/\s/.test(buf[j])) {
      i = j - 1; // e.g. "3.5", "node.js", "e.g." mid-token
      continue;
    }
    if (ch === ".") {
      const word = /([A-Za-z.]+)\.*$/.exec(buf.slice(0, i))?.[1]?.toLowerCase() ?? "";
      if (ABBREVIATIONS.has(word.replace(/\.$/, ""))) continue;
      if (/^[a-z]$/i.test(word)) continue; // initials: "J. Smith"
    }
    return j;
  }
  return -1;
}

/** Strip markdown / symbols that would be read aloud literally. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [label](url) → label
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, "") // list bullets
    .replace(/[*#`~_>]+/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pulls complete sentences off the front of `buf`. */
function drainSentences(buf: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buf;
  for (;;) {
    let end = findSentenceEnd(rest);
    if (end < 0 && rest.length > MAX_CHUNK) {
      // Run-on text: break at the last comma/semicolon, else last space.
      const window = rest.slice(0, MAX_CHUNK);
      const cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "));
      end = (cut > 40 ? cut : window.lastIndexOf(" ")) + 1;
      if (end <= 0) end = MAX_CHUNK;
    }
    if (end < 0) break;
    sentences.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  return { sentences, rest };
}

// ---------------------------------------------------------------------------
// Browser voice selection
// ---------------------------------------------------------------------------

const PREFERRED = [
  /natural/i, /neural/i, /premium/i, /enhanced/i, /google us english/i,
  /\bava\b/i, /samantha/i, /\bzoe\b/i, /\ballison\b/i, /\bjenny\b/i, /\baria\b/i, /\bguy\b/i,
  /google/i, /microsoft/i,
];
// macOS/iOS novelty voices that sound terrible for an interviewer.
const NOVELTY =
  /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|grandma|grandpa|junior|ralph|fred|kathy|eddy|flo|reed|rocko|sandy|shelley/i;

function scoreVoice(v: SpeechSynthesisVoice): number {
  const lang = v.lang.replace("_", "-").toLowerCase();
  if (!lang.startsWith("en")) return -Infinity;
  let score = lang === "en-us" ? 50 : 20;
  if (NOVELTY.test(v.name)) score -= 100;
  const idx = PREFERRED.findIndex((re) => re.test(v.name));
  if (idx >= 0) score += (PREFERRED.length - idx) * 5;
  if (v.default) score += 2;
  return score;
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;
  for (const v of voices) {
    const s = scoreVoice(v);
    if (s > bestScore) [best, bestScore] = [v, s];
  }
  return best;
}

// ---------------------------------------------------------------------------
// Audio unlocking (iOS / autoplay policies)
// ---------------------------------------------------------------------------

let sharedAudio: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;

/** One reusable element: once "blessed" by a gesture on iOS, later plays are allowed. */
function getAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = "auto";
    sharedAudio.setAttribute("playsinline", "");
  }
  return sharedAudio;
}

/** ~0.05s of silent 8kHz mono WAV, as a data URI. */
function silentWav(): string {
  const samples = 400;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true);
  v.setUint16(34, 8, true); str(36, "data"); v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128);
  let bin = "";
  new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/**
 * Call synchronously from a user gesture (e.g. the "Start interview" click).
 * iOS Safari (and some Android builds) only allow speech/audio that was first
 * started inside a gesture; this primes speechSynthesis, the shared <audio>
 * element and an AudioContext. Safe to call repeatedly and during SSR.
 */
export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  try {
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch {
    /* ignore */
  }
  try {
    const audio = getAudio();
    if (audio.paused && !audio.src.startsWith("blob:")) {
      audio.src = silentWav();
      void audio.play().catch(() => {});
    }
  } catch {
    /* ignore */
  }
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      audioCtx ??= new Ctx();
      if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// useSpeaker
// ---------------------------------------------------------------------------

interface QueueItem {
  text: string;
  /** Cloud audio blob URL (null = cloud failed → use browser voice). */
  audio?: Promise<string | null>;
  abort?: AbortController;
}

const CLOUD_FAILURES_BEFORE_DISABLE = 3;
const PREFETCH_AHEAD = 2; // current + next

/** Desktop Chrome/Edge: the engines with the ~15s cutoff bug. Android treats pause() as cancel(). */
const needsKeepalive = () =>
  typeof navigator !== "undefined" &&
  /Chrome\//.test(navigator.userAgent) &&
  !/Android|Mobile/i.test(navigator.userAgent);

export function useSpeaker(mode: VoiceMode): SpeakerController {
  const [hasSynth, setHasSynth] = useState(false);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMutedState] = useState(false);

  const usingCloud = mode === "cloud" && cloudEnabled;
  const usingCloudRef = useRef(usingCloud);
  usingCloudRef.current = usingCloud;
  const mutedRef = useRef(false);

  const bufferRef = useRef("");
  const queueRef = useRef<QueueItem[]>([]);
  const playingRef = useRef(false);
  /** Bumped on cancel; async continuations from older generations are dropped. */
  const genRef = useRef(0);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  /** Hold a reference: Chrome GCs live utterances and then never fires onend. */
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const cloudFailuresRef = useRef(0);
  const timersRef = useRef<{ keepalive?: ReturnType<typeof setInterval>; watchdog?: ReturnType<typeof setTimeout> }>({});

  // --- mount: feature detection, voices, cloud status ----------------------
  useEffect(() => {
    const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
    setHasSynth(Boolean(synth));
    const loadVoices = () => (voiceRef.current = pickVoice());
    if (synth) {
      loadVoices();
      synth.addEventListener?.("voiceschanged", loadVoices);
    }

    let alive = true;
    fetch("/api/tts", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<TtsStatus>) : { cloudEnabled: false }))
      .then((s) => alive && setCloudEnabled(Boolean(s.cloudEnabled)))
      .catch(() => {});

    return () => {
      alive = false;
      synth?.removeEventListener?.("voiceschanged", loadVoices);
    };
  }, []);

  // --- playback helpers (all ref-based, so callbacks stay stable) ------------
  const clearTimers = () => {
    clearInterval(timersRef.current.keepalive);
    clearTimeout(timersRef.current.watchdog);
    timersRef.current = {};
  };

  const fetchCloud = (item: QueueItem) => {
    if (item.audio) return;
    const ctrl = new AbortController();
    item.abort = ctrl;
    item.audio = fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: item.text.slice(0, 1000) }),
      signal: ctrl.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`tts ${r.status}`);
        const blob = await r.blob();
        cloudFailuresRef.current = 0;
        return URL.createObjectURL(blob);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          if (++cloudFailuresRef.current >= CLOUD_FAILURES_BEFORE_DISABLE) setCloudEnabled(false);
        }
        return null;
      });
  };

  const prefetch = () => {
    if (!usingCloudRef.current) return;
    queueRef.current.slice(0, PREFETCH_AHEAD).forEach(fetchCloud);
  };

  const speakBrowser = (text: string, done: () => void) => {
    const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
    if (!synth) return done();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimers();
      utteranceRef.current = null;
      done();
    };
    const u = new SpeechSynthesisUtterance(text);
    voiceRef.current ??= pickVoice();
    if (voiceRef.current) {
      u.voice = voiceRef.current;
      u.lang = voiceRef.current.lang;
    } else u.lang = "en-US";
    u.rate = 1;
    u.onend = finish;
    u.onerror = finish;
    utteranceRef.current = u;
    if (synth.paused) synth.resume(); // Chrome can get stuck paused after tab switches
    synth.speak(u);
    // Chrome desktop stops long utterances after ~15s; a pause/resume tick keeps it alive.
    if (needsKeepalive()) {
      timersRef.current.keepalive = setInterval(() => {
        if (synth.speaking && !synth.paused) {
          synth.pause();
          synth.resume();
        }
      }, 10_000);
    }
    // Watchdog: some engines never fire onend. Generous budget per character.
    timersRef.current.watchdog = setTimeout(() => {
      synth.cancel();
      finish();
    }, 5_000 + text.length * 120);
  };

  const playUrl = (url: string, text: string, done: () => void) => {
    const audio = getAudio();
    let finished = false;
    const finish = (fallback: boolean) => {
      if (finished) return;
      finished = true;
      audio.onended = audio.onerror = null;
      URL.revokeObjectURL(url);
      if (fallback) speakBrowser(text, done);
      else done();
    };
    audio.onended = () => finish(false);
    audio.onerror = () => finish(true);
    audio.src = url;
    audio.play().catch(() => finish(true)); // e.g. autoplay blocked → browser voice
  };

  const playNextRef = useRef<() => void>(() => {});
  playNextRef.current = () => {
    const gen = genRef.current;
    const item = queueRef.current[0];
    if (!item) {
      playingRef.current = false;
      setSpeaking(false);
      return;
    }
    playingRef.current = true;
    const done = () => {
      if (gen !== genRef.current) return;
      queueRef.current.shift();
      playNextRef.current();
    };

    if (usingCloudRef.current || item.audio) {
      prefetch(); // ensures current + next are in flight
      if (item.audio) {
        void item.audio.then((url) => {
          if (gen !== genRef.current) {
            if (url) URL.revokeObjectURL(url);
            return;
          }
          if (url) playUrl(url, item.text, done);
          else speakBrowser(item.text, done);
        });
        return;
      }
    }
    speakBrowser(item.text, done);
  };

  const enqueue = (raw: string) => {
    const text = cleanForSpeech(raw);
    if (!text || !/[a-z0-9]/i.test(text) || mutedRef.current) return;
    queueRef.current.push({ text });
    setSpeaking(true);
    if (playingRef.current) prefetch();
    else playNextRef.current();
  };

  // --- public API ------------------------------------------------------------
  const feed = useCallback((delta: string) => {
    const { sentences, rest } = drainSentences(bufferRef.current + delta);
    bufferRef.current = rest;
    sentences.forEach(enqueue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = useCallback(() => {
    const { sentences, rest } = drainSentences(bufferRef.current);
    bufferRef.current = "";
    [...sentences, rest].forEach(enqueue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const say = useCallback((text: string) => {
    const { sentences, rest } = drainSentences(text + " ");
    [...sentences, rest].forEach(enqueue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = useCallback(() => {
    genRef.current++;
    bufferRef.current = "";
    for (const item of queueRef.current) {
      item.abort?.abort();
      void item.audio?.then((url) => url && URL.revokeObjectURL(url));
    }
    queueRef.current = [];
    playingRef.current = false;
    clearTimers();
    utteranceRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    if (sharedAudio) {
      sharedAudio.onended = sharedAudio.onerror = null;
      sharedAudio.pause();
    }
    setSpeaking(false);
  }, []);

  const setMuted = useCallback(
    (m: boolean) => {
      mutedRef.current = m;
      setMutedState(m);
      if (m) cancel();
    },
    [cancel],
  );

  useEffect(() => cancel, [cancel]); // stop audio on unmount

  return {
    supported: hasSynth || usingCloud,
    speaking,
    usingCloud,
    feed,
    flush,
    say,
    cancel,
    muted,
    setMuted,
  };
}
