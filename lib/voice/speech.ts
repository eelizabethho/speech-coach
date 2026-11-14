"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SpeechController, SpeechOptions } from "@/lib/types";

// ---------------------------------------------------------------------------
// Minimal Web Speech API typings (not in every lib.dom version).
// ---------------------------------------------------------------------------
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SRAlternative;
}
interface SRResultList {
  readonly length: number;
  [index: number]: SRResult;
}
interface SREvent extends Event {
  readonly resultIndex: number;
  readonly results: SRResultList;
}
interface SRErrorEvent extends Event {
  readonly error: string;
}
interface SRInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRConstructor = new () => SRInstance;

function getRecognitionCtor(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const FATAL_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone permission denied. Allow mic access in your browser settings, or type your answer.",
  "service-not-allowed": "Speech recognition is not allowed in this browser. Type your answer instead.",
  "audio-capture": "No microphone was found. Check your audio input, or type your answer.",
  "language-not-supported": "This language isn't supported for speech recognition.",
};

/** Joins a session's results. Android Chrome sometimes repeats the whole
 *  phrase-so-far as each new final result; collapse those repeats. */
function joinSegments(segments: string[]): string {
  const out: string[] = [];
  for (const raw of segments) {
    const seg = raw.trim();
    if (!seg) continue;
    const prev = out[out.length - 1];
    if (prev && seg.toLowerCase().startsWith(prev.toLowerCase())) out[out.length - 1] = seg;
    else if (prev && prev.toLowerCase().startsWith(seg.toLowerCase())) continue;
    else out.push(seg);
  }
  return out.join(" ");
}

const joinText = (...parts: string[]) => parts.map((p) => p.trim()).filter(Boolean).join(" ");

// Restart throttling: if the browser keeps ending sessions instantly, give up.
const MAX_RAPID_RESTARTS = 6;
const RAPID_WINDOW_MS = 1500;

export function useSpeechRecognition(opts: SpeechOptions): SpeechController {
  const { autoSendAfterMs = 2500, lang = "en-US" } = opts;

  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onUtteranceRef = useRef(opts.onUtterance);
  onUtteranceRef.current = opts.onUtterance;
  const autoSendRef = useRef(autoSendAfterMs);
  autoSendRef.current = autoSendAfterMs;
  const langRef = useRef(lang);
  langRef.current = lang;

  const recRef = useRef<SRInstance | null>(null);
  /** User intends to be listening (drives auto-restart). */
  const wantRef = useRef(false);
  /** Text committed from previous recognition sessions of this answer. */
  const committedRef = useRef("");
  /** Current session's final / interim text. */
  const sessionFinalRef = useRef("");
  const interimRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rapidRef = useRef({ count: 0, last: 0 });

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
  }, []);

  const clearTimers = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    silenceTimerRef.current = restartTimerRef.current = null;
  };

  const fullText = () => joinText(committedRef.current, sessionFinalRef.current, interimRef.current);

  const resetAnswer = () => {
    committedRef.current = sessionFinalRef.current = interimRef.current = "";
    setTranscript("");
  };

  /** Tear down the current recognizer without triggering a restart. */
  const teardown = () => {
    wantRef.current = false;
    clearTimers();
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onresult = rec.onerror = rec.onend = null;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
    }
    setListening(false);
  };

  // `finish` is referenced from recognizer callbacks; keep it in a ref so the
  // callbacks never see a stale version.
  const finishRef = useRef<(submit: boolean, viaPause?: boolean) => void>(() => {});
  finishRef.current = (submit: boolean, viaPause = false) => {
    if (!wantRef.current) return; // already finished (exactly-once guard)
    const text = fullText();
    teardown();
    resetAnswer();
    if (submit && text) onUtteranceRef.current(text, viaPause);
  };

  const armSilenceTimer = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
    const ms = autoSendRef.current;
    if (ms > 0 && fullText()) {
      silenceTimerRef.current = setTimeout(() => finishRef.current(true, true), ms);
    }
  };

  const startSessionRef = useRef<() => void>(() => {});
  startSessionRef.current = () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || !wantRef.current) return;

    // A fresh instance per session is the most reliable across Chrome/iOS.
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = langRef.current;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      if (recRef.current !== rec) return;
      const finals: string[] = [];
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) finals.push(t);
        else interim += t;
      }
      sessionFinalRef.current = joinSegments(finals);
      interimRef.current = interim.trim();
      rapidRef.current.count = 0; // real results: session is healthy
      setError(null); // clear transient (e.g. network) errors
      setTranscript(fullText());
      armSilenceTimer();
    };

    rec.onerror = (e) => {
      if (recRef.current !== rec) return;
      if (e.error === "no-speech" || e.error === "aborted") return; // onend will restart
      const fatal = FATAL_ERRORS[e.error];
      if (fatal) {
        setError(fatal);
        finishRef.current(true); // submit anything captured before the failure
        return;
      }
      // "network" and others: surface but keep trying via onend restart.
      setError(e.error === "network" ? "Speech recognition network error — retrying…" : `Speech recognition error: ${e.error}`);
    };

    rec.onend = () => {
      if (recRef.current !== rec) return;
      // Keep what this session recognized (iOS may end before finalizing interim).
      committedRef.current = joinText(committedRef.current, sessionFinalRef.current, interimRef.current);
      sessionFinalRef.current = interimRef.current = "";
      recRef.current = null;
      if (!wantRef.current) return;

      const now = Date.now();
      const rapid = rapidRef.current;
      rapid.count = now - rapid.last < RAPID_WINDOW_MS ? rapid.count + 1 : 0;
      rapid.last = now;
      if (rapid.count >= MAX_RAPID_RESTARTS) {
        setError("Speech recognition keeps stopping. Tap the mic to try again, or type your answer.");
        finishRef.current(true);
        return;
      }
      // Small delay: immediate restarts are flaky on iOS Safari.
      restartTimerRef.current = setTimeout(() => startSessionRef.current(), 150);
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      // InvalidStateError: already started — harmless. Anything else is fatal.
      if (!(err instanceof DOMException && err.name === "InvalidStateError")) {
        setError("Could not start speech recognition.");
        finishRef.current(true);
      }
    }
  };

  const start = useCallback(() => {
    if (!getRecognitionCtor()) {
      setError("Speech recognition isn't supported in this browser. Type your answer instead.");
      return;
    }
    if (wantRef.current) return; // guard double start
    setError(null);
    resetAnswer();
    rapidRef.current = { count: 0, last: 0 };
    wantRef.current = true;
    setListening(true);
    startSessionRef.current();
  }, []);

  const stop = useCallback(() => finishRef.current(true), []);
  const cancel = useCallback(() => finishRef.current(false), []);

  // Clean up on unmount without submitting.
  useEffect(() => () => finishRef.current(false), []);

  return { supported, listening, transcript, start, stop, cancel, error };
}
