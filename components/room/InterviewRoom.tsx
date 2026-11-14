"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MODE_LABELS,
  type ApiError,
  type CodeLanguage,
  type FeedbackReport as Report,
  type FeedbackRequest,
  type InterviewConfig,
  type InterviewRequest,
  type SavedSession,
  type Turn,
  type TurnRole,
} from "@/lib/types";
import { WAIT_MARKER } from "@/lib/ai/scenarios";
import { useSpeechRecognition } from "@/lib/voice/speech";
import { useSpeaker } from "@/lib/voice/tts";
import { useGeminiLive } from "@/lib/voice/live";
import * as ttsModule from "@/lib/voice/tts";
import { captureFrame } from "@/lib/capture/frame";
import * as frameModule from "@/lib/capture/frame";
import ScreenShare from "@/components/capture/ScreenShare";
import CodePanel from "@/components/capture/CodePanel";
import { computeMetrics } from "@/lib/session/metrics";
import { deleteSession, saveSession, stripScreenshots } from "@/lib/session/history";
import { makeId } from "@/lib/session/id";
import Transcript from "./Transcript";
import ReportView from "./ReportView";
import ConfirmDialog from "./ConfirmDialog";
import RoomControls from "./RoomControls";
import ErrorBanner, { type RoomError } from "./ErrorBanner";
import { MODE_INFO } from "./modeInfo";
import styles from "./room.module.css";

/** Optional helpers other modules may export; checked at runtime so stubs still work. */
const optionalTts = ttsModule as unknown as { unlockAudio?: () => unknown };
const optionalFrame = frameModule as unknown as {
  framesDiffer?: (a: string, b: string) => boolean | Promise<boolean>;
};

/** A pause this long sends the answer so far; the interviewer then decides whether to step in. */
const AUTO_SEND_MS = 2500;
/** Total silence (nothing said) before the interviewer may check in, per mode. */
const IDLE_CHECK_MS: Record<InterviewConfig["mode"], number> = {
  leetcode: 60_000,
  "system-design": 45_000,
  behavioral: 20_000,
  technical: 20_000,
  custom: 20_000,
};
/** Only the most recent screenshots go to the interviewer, to keep requests small. */
const MAX_SCREENSHOTS_SENT = 2;
/** Gemini Live accepts at most ~1 frame/s; unchanged frames are skipped anyway. */
const LIVE_FRAME_MS = 2000;

type Phase = "ready" | "live" | "ending" | "done";

interface EndState {
  session: SavedSession;
  feedback: Report | null;
  loading: boolean;
  error: string | null;
  canRetry: boolean;
}

class RequestError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

async function readApiError(res: Response): Promise<RequestError> {
  try {
    const data = (await res.json()) as Partial<ApiError>;
    if (data && typeof data.error === "string") return new RequestError(data.error, data.code);
  } catch {
    /* not JSON */
  }
  return new RequestError(`Request failed (HTTP ${res.status}).`);
}

function limitScreenshots(turns: Turn[]): Turn[] {
  let kept = 0;
  const out = [...turns];
  for (let i = out.length - 1; i >= 0; i--) {
    if (!out[i].screenshot) continue;
    if (kept < MAX_SCREENSHOTS_SENT) kept++;
    else {
      const { screenshot: _s, ...rest } = out[i];
      out[i] = rest;
    }
  }
  return out;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function isReport(x: unknown): x is Report {
  const r = x as Report;
  return !!r && typeof r.overallScore === "number" && typeof r.summary === "string" && Array.isArray(r.categories);
}

interface InterviewRoomProps {
  config: InterviewConfig;
  onRestart: () => void;
}

export default function InterviewRoom({ config, onRestart }: InterviewRoomProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("ready");
  const phaseRef = useRef<Phase>("ready");
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnsRef = useRef<Turn[]>([]);
  const [liveText, setLiveText] = useState("");
  const liveTextRef = useRef("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<RoomError | null>(null);
  const [handsFree, setHandsFree] = useState(true);
  const handsFreeRef = useRef(true);
  handsFreeRef.current = handsFree;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [endState, setEndState] = useState<EndState | null>(null);

  const [code, setCode] = useState("");
  const [language, setLanguage] = useState<CodeLanguage>("python");
  const codeRef = useRef({ code: "", language: "python" as CodeLanguage });
  codeRef.current = { code, language };
  // LeetCode is usually solved in LeetCode's own editor on the shared screen.
  const [codeOpen, setCodeOpen] = useState(false);
  const [screenOpen, setScreenOpen] = useState(config.mode !== "behavioral");
  const [sharing, setSharing] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const lastFrameRef = useRef<string | null>(null);

  const startedAtRef = useRef(0);
  const [now, setNow] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const feedbackAbortRef = useRef<AbortController | null>(null);
  const wantListenRef = useRef(false);
  /** A reply request is in flight that may still turn out to be WAIT_MARKER (mic stays on). */
  const decidingRef = useRef(false);
  const lastActivityRef = useRef(0);
  const openingRequestedRef = useRef(false);
  const listenStartRef = useRef<number | null>(null);
  const speakingMsRef = useRef(0);
  const sessionIdRef = useRef("");

  const onUtteranceRef = useRef<(text: string, viaPause: boolean) => void>(() => {});
  const handleUtterance = useCallback((text: string, viaPause: boolean) => onUtteranceRef.current(text, viaPause), []);
  const speech = useSpeechRecognition({ onUtterance: handleUtterance, autoSendAfterMs: handsFree ? AUTO_SEND_MS : 0 });
  const speaker = useSpeaker(config.voice, config.cloudVoice);
  const isLive = config.engine === "gemini-live";
  // Gemini Live hands back finished pieces of speech; consecutive pieces from one speaker are one turn.
  const live = useGeminiLive(config, (role: TurnRole, text: string) => {
    const prev = turnsRef.current[turnsRef.current.length - 1];
    if (prev?.role === role) appendTurn({ ...prev, text: `${prev.text} ${text}` }, true);
    else appendTurn({ id: makeId("t_"), role, text, at: Date.now() });
  });
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const speakerRef = useRef(speaker);
  speakerRef.current = speaker;

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const setBusyBoth = (b: boolean) => {
    busyRef.current = b;
    setBusy(b);
  };
  const setLiveBoth = (t: string) => {
    liveTextRef.current = t;
    setLiveText(t);
  };
  const appendTurn = (t: Turn, replaceLast = false) => {
    const base = replaceLast ? turnsRef.current.slice(0, -1) : turnsRef.current;
    const next = [...base, t];
    turnsRef.current = next;
    setTurns(next);
    return next;
  };
  const elapsedSec = () => (startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : 0);

  // ---------------------------------------------------------------- AI reply
  const requestReply = useCallback(
    async (history: Turn[], turn: { mayWait?: boolean; silentSec?: number } = {}) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setBusyBoth(true);
      setError(null);
      setLiveBoth("");
      let text = "";
      // Until the reply is known not to be WAIT_MARKER, nothing is shown or spoken.
      let decided = !(turn.mayWait || turn.silentSec !== undefined);
      decidingRef.current = !decided;
      const commitToSpeak = () => {
        decided = true;
        decidingRef.current = false;
        // Mic off before the voice starts, so it doesn't transcribe the interviewer.
        if (speechRef.current.listening) {
          listenStartRef.current = null; // nothing was said in this stretch
          speechRef.current.cancel();
        }
      };
      try {
        const body: InterviewRequest = {
          config,
          turns: limitScreenshots(history),
          elapsedSec: elapsedSec(),
          ...turn,
        };
        const res = await fetch("/api/interview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok) throw await readApiError(res);
        if (!res.body) throw new RequestError("The server sent an empty response.");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const delta = decoder.decode(value, { stream: true });
          if (!delta) continue;
          text += delta;
          if (!decided) {
            const head = text.trimStart();
            if (head.startsWith(WAIT_MARKER)) break;
            if (WAIT_MARKER.startsWith(head)) continue; // could still be the marker
            commitToSpeak();
            setLiveBoth(text);
            speakerRef.current.feed(text);
            continue;
          }
          setLiveBoth(text);
          speakerRef.current.feed(delta);
        }
        if (!decided) {
          // The interviewer chose to stay quiet: keep listening, show and say nothing.
          decidingRef.current = false;
          wantListenRef.current = true; // hands-free loop restarts the mic if it isn't on
          ctrl.abort();
          return;
        }
        const tail = decoder.decode();
        if (tail) {
          text += tail;
          speakerRef.current.feed(tail);
        }
        speakerRef.current.flush();
        if (!text.trim()) throw new RequestError("The interviewer returned an empty reply.");
        appendTurn({ id: makeId("t_"), role: "interviewer", text: text.trim(), at: Date.now() });
        setLiveBoth("");
        wantListenRef.current = true;
      } catch (e) {
        // Aborted by barge-in or ending: whoever aborted handles the partial text.
        if (ctrl.signal.aborted) return;
        if (!decided) commitToSpeak(); // show the error instead of waiting silently
        const err = e instanceof RequestError ? e : new RequestError(e instanceof Error ? e.message : "Network error.");
        speakerRef.current.flush();
        if (text.trim()) {
          // Stream dropped mid-reply: keep what arrived and carry on.
          appendTurn({ id: makeId("t_"), role: "interviewer", text: text.trim(), at: Date.now() });
          setLiveBoth("");
          wantListenRef.current = true;
          setError({ message: `The connection dropped mid-reply. ${err.message}`, code: err.code });
        } else {
          setLiveBoth("");
          setError({ message: err.message, code: err.code, retry: () => void requestReply(history) });
        }
      } finally {
        if (abortRef.current === ctrl) {
          abortRef.current = null;
          setBusyBoth(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config],
  );

  /** Stop the interviewer (speech + stream), keeping whatever text already arrived. */
  const interruptInterviewer = useCallback(() => {
    speakerRef.current.cancel();
    const ctrl = abortRef.current;
    if (!ctrl) return;
    abortRef.current = null;
    ctrl.abort();
    const partial = liveTextRef.current.trim();
    if (partial) appendTurn({ id: makeId("t_"), role: "interviewer", text: `${partial}…`, at: Date.now() });
    setLiveBoth("");
    setBusyBoth(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------- candidate turn
  const submitAnswer = useCallback(
    async (raw: string, viaPause = false) => {
      const text = raw.trim();
      if (!text || phaseRef.current !== "live") return;
      if (busyRef.current) interruptInterviewer();
      wantListenRef.current = false;
      setBusyBoth(true); // blocks double submits while we grab the frame
      // Keep listening while the interviewer decides whether a pause was a handoff.
      if (viaPause && handsFreeRef.current) speechRef.current.start();
      // Picking up after a pause the interviewer let pass: it's the same answer.
      const prev = turnsRef.current[turnsRef.current.length - 1];
      const resume = prev?.role === "candidate";
      const turn: Turn = resume
        ? { ...prev, text: `${prev.text} ${text}` }
        : { id: makeId("t_"), role: "candidate", text, at: Date.now() };
      const { code: c, language: lang } = codeRef.current;
      if (c.trim()) turn.code = { language: lang, content: c };
      const stream = streamRef.current;
      if (stream) {
        try {
          const frame = await captureFrame(stream);
          if (frame) {
            let changed = frame !== lastFrameRef.current;
            if (changed && lastFrameRef.current && typeof optionalFrame.framesDiffer === "function") {
              changed = await Promise.resolve(optionalFrame.framesDiffer(lastFrameRef.current, frame)).catch(() => true);
            }
            if (changed) {
              turn.screenshot = frame;
              lastFrameRef.current = frame;
            }
          }
        } catch {
          /* screenshot is best-effort */
        }
      }
      if (phaseRef.current !== "live") return;
      const next = appendTurn(turn, resume);
      void requestReply(next, { mayWait: viaPause });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [interruptInterviewer, requestReply],
  );
  useEffect(() => {
    onUtteranceRef.current = (t, viaPause) => void submitAnswer(t, viaPause);
  }, [submitAnswer]);

  // Candidate started talking again while the interviewer was deciding: drop that request.
  useEffect(() => {
    lastActivityRef.current = Date.now();
    if (!decidingRef.current || !speech.transcript.trim()) return;
    decidingRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusyBoth(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.transcript]);

  useEffect(() => {
    lastActivityRef.current = Date.now();
  }, [turns.length, speaker.speaking]);

  // Long total silence: let the interviewer decide whether to check in.
  useEffect(() => {
    if (phase !== "live" || !handsFree || busy || speaker.speaking || !speech.listening) return;
    if (speech.transcript.trim() || turns.length === 0) return;
    const t = setTimeout(() => {
      if (busyRef.current || speechRef.current.transcript.trim()) return;
      const silentSec = (Date.now() - lastActivityRef.current) / 1000;
      void requestReply(turnsRef.current, { silentSec });
    }, IDLE_CHECK_MS[config.mode]);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, handsFree, busy, speaker.speaking, speech.listening, speech.transcript, turns.length]);

  // -------------------------------------------------------- hands-free loop
  useEffect(() => {
    if (phase !== "live" || !handsFree || !speech.supported) return;
    if (busy || speaker.speaking || speech.listening || !wantListenRef.current) return;
    // Small delay so a just-flushed reply has a chance to start playing first.
    const t = setTimeout(() => {
      if (!wantListenRef.current || busyRef.current || phaseRef.current !== "live") return;
      if (speakerRef.current.speaking || speechRef.current.listening) return;
      wantListenRef.current = false;
      speechRef.current.start();
    }, 450);
    return () => clearTimeout(t);
  }, [phase, handsFree, busy, speaker.speaking, speech.listening, speech.supported, turns.length]);

  // Track time on the mic, for a fairer words-per-minute.
  useEffect(() => {
    if (speech.listening) listenStartRef.current = Date.now();
    else if (listenStartRef.current) {
      speakingMsRef.current += Date.now() - listenStartRef.current - (handsFree ? AUTO_SEND_MS : 0);
      listenStartRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.listening]);

  // Timer
  useEffect(() => {
    if (phase !== "live") return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Warn before leaving mid-interview
  useEffect(() => {
    if (phase !== "live") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [phase]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
      speakerRef.current.cancel();
      speechRef.current.cancel();
    },
    [],
  );

  // ------------------------------------------------- Gemini Live extras
  useEffect(() => {
    if (isLive && live.error) setError({ message: live.error });
  }, [isLive, live.error]);

  // Stream the shared screen as video frames.
  useEffect(() => {
    if (!isLive || phase !== "live" || !sharing) return;
    const id = setInterval(async () => {
      const stream = streamRef.current;
      if (!stream) return;
      try {
        const frame = await captureFrame(stream);
        if (!frame || frame === lastFrameRef.current) return;
        if (lastFrameRef.current && typeof optionalFrame.framesDiffer === "function") {
          if (!(await optionalFrame.framesDiffer(lastFrameRef.current, frame))) return;
        }
        lastFrameRef.current = frame;
        live.sendFrame(frame);
      } catch {
        /* frames are best-effort */
      }
    }, LIVE_FRAME_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, phase, sharing]);

  // Share the code editor as context once typing settles.
  useEffect(() => {
    if (!isLive || phase !== "live" || !code.trim()) return;
    const t = setTimeout(() => live.sendText(`[Candidate's code editor (${language})]\n${code}`, false), 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, phase, code, language]);

  // Pacing: the pipeline sends a timing note every turn; here, just the two that matter.
  const timeNotesRef = useRef({ wrap: false, over: false });
  useEffect(() => {
    if (!isLive || phase !== "live" || !startedAtRef.current) return;
    const remainingMin = config.durationMin - (Date.now() - startedAtRef.current) / 60000;
    const notes = timeNotesRef.current;
    const elapsedMin = Math.floor(config.durationMin - remainingMin);
    if (remainingMin <= 0 && !notes.over) {
      notes.over = notes.wrap = true;
      live.sendText(`[Time: ${elapsedMin} of ${config.durationMin} minutes elapsed. Time is up: close the interview at the next natural pause.]`, false);
    } else if (remainingMin <= 3 && !notes.wrap) {
      notes.wrap = true;
      live.sendText(`[Time: ${elapsedMin} of ${config.durationMin} minutes elapsed. Nearly out of time: start wrapping up.]`, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, phase, now]);

  // ------------------------------------------------------------- actions
  function start() {
    if (openingRequestedRef.current) return;
    openingRequestedRef.current = true;
    // Must run inside the click: unlocks audio playback on iOS.
    if (typeof optionalTts.unlockAudio === "function") {
      try {
        const r = optionalTts.unlockAudio();
        if (r instanceof Promise) r.catch(() => {});
      } catch {
        /* ignore */
      }
    }
    sessionIdRef.current = makeId("s_");
    startedAtRef.current = Date.now();
    setPhaseBoth("live");
    if (isLive) void live.start();
    else void requestReply([]);
  }

  function onMic() {
    if (isLive) {
      live.setMicOn(!live.micOn);
      return;
    }
    if (speech.listening) {
      const last = turnsRef.current[turnsRef.current.length - 1];
      if (!speech.transcript.trim() && last?.role === "candidate" && !busyRef.current) {
        // Interviewer let the pause pass; a tap means "I'm done, your turn".
        speech.cancel();
        void requestReply(turnsRef.current);
        return;
      }
      speech.stop(); // submits via onUtterance (a deliberate handoff)
      return;
    }
    if (speaker.speaking || abortRef.current) interruptInterviewer();
    wantListenRef.current = false;
    speech.start();
  }

  function sendText(text: string) {
    if (isLive) {
      appendTurn({ id: makeId("t_"), role: "candidate", text, at: Date.now() });
      live.sendText(text, true);
      return;
    }
    if (speech.listening) speech.cancel();
    void submitAnswer(text);
  }

  const fetchFeedback = useCallback(async (session: SavedSession) => {
    if (session.metrics.answerCount === 0) {
      setEndState({ session, feedback: null, loading: false, canRetry: false, error: "You didn't answer any questions, so there's nothing to score yet." });
      return;
    }
    const ctrl = new AbortController();
    feedbackAbortRef.current = ctrl;
    setEndState({ session, feedback: null, loading: true, error: null, canRetry: true });
    try {
      const body: FeedbackRequest = {
        config: session.config,
        turns: stripScreenshots(session.turns),
        durationSec: session.durationSec,
        metrics: session.metrics,
      };
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) throw await readApiError(res);
      const data: unknown = await res.json();
      if (!isReport(data)) throw new RequestError("The feedback came back in an unexpected format.");
      const report: Report = {
        ...data,
        strengths: data.strengths ?? [],
        improvements: data.improvements ?? [],
        betterAnswers: data.betterAnswers ?? [],
        nextSteps: data.nextSteps ?? [],
      };
      const withFeedback = { ...session, feedback: report };
      // Deleted while feedback was in flight: saving now would bring it back.
      if (ctrl.signal.aborted) return;
      saveSession(withFeedback);
      setEndState({ session: withFeedback, feedback: report, loading: false, error: null, canRetry: false });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      const msg =
        e instanceof RequestError && e.code === "missing_api_key"
          ? "The server has no Anthropic API key configured (ANTHROPIC_API_KEY)."
          : e instanceof Error
            ? e.message
            : "Network error.";
      setEndState({ session, feedback: null, loading: false, error: msg, canRetry: true });
    }
  }, []);

  function finish() {
    if (isLive) live.stop(); // flushes the half-finished turns into the transcript first
    setConfirmEnd(false);
    setConfirmLeave(false);
    wantListenRef.current = false;
    speech.cancel();
    speaker.cancel();
    abortRef.current?.abort();
    abortRef.current = null;
    setBusyBoth(false);
    setLiveBoth("");
    setError(null);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (listenStartRef.current) {
      speakingMsRef.current += Date.now() - listenStartRef.current;
      listenStartRef.current = null;
    }
    const durationSec = Math.max(1, elapsedSec());
    const finalTurns = stripScreenshots(turnsRef.current);
    const metrics = computeMetrics(finalTurns, durationSec, Math.max(0, speakingMsRef.current) / 1000);
    const session: SavedSession = {
      id: sessionIdRef.current || makeId("s_"),
      config,
      turns: finalTurns,
      startedAt: startedAtRef.current || Date.now(),
      durationSec,
      metrics,
    };
    if (metrics.answerCount > 0) saveSession(session);
    setPhaseBoth("done");
    void fetchFeedback(session);
  }

  const onStreamChange = useCallback(
    (stream: MediaStream | null) => {
      streamRef.current = stream;
      lastFrameRef.current = null;
      setSharing(!!stream);
      // Hand the interviewer the problem right away instead of waiting for the next answer.
      if (stream && config.mode === "leetcode" && phaseRef.current === "live") {
        if (!isLive) void submitAnswer("I'm sharing my screen with the problem I want to work on.");
        else
          void captureFrame(stream).then((frame) => {
            if (frame) live.sendFrame(frame);
            live.sendText("[The candidate is now sharing their screen with the problem they want to work on.]", true);
          });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.mode, submitAnswer, isLive],
  );

  // ------------------------------------------------------------- render
  const elapsed = phase === "live" && now ? Math.max(0, Math.floor((now - startedAtRef.current) / 1000)) : 0;
  const plannedSec = config.durationMin * 60;
  const timerClass =
    elapsed >= plannedSec ? styles.timerOver : elapsed >= plannedSec * 0.85 ? styles.timerWarn : "";
  const answerCount = turns.filter((t) => t.role === "candidate").length;
  const subtitle = [config.role, config.company, `${config.difficulty[0].toUpperCase()}${config.difficulty.slice(1)}`]
    .filter(Boolean)
    .join(" · ");

  const header = (
    <header className={styles.header}>
      <div className={styles.headerTitle}>
        <h1>{MODE_LABELS[config.mode]} interview</h1>
        <span className={styles.headerSub}>{subtitle}</span>
      </div>
      {phase === "live" && (
        <>
          <span className={`${styles.timer} ${timerClass}`} role="timer" aria-label={`Elapsed ${fmt(elapsed)} of ${config.durationMin} minutes`}>
            {fmt(elapsed)} / {config.durationMin}:00
          </span>
          <button type="button" className="btn btn-danger" onClick={() => setConfirmEnd(true)}>
            End interview
          </button>
        </>
      )}
      {(phase === "ready" || phase === "live") && (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => (phase === "live" && answerCount > 0 ? setConfirmLeave(true) : router.push("/"))}
        >
          Back
        </button>
      )}
    </header>
  );

  if (phase === "ready") {
    return (
      <main className={styles.page}>
        {header}
        <div className={styles.center}>
          <section className={`card stack ${styles.readyCard}`} aria-labelledby="ready-h" style={{ gap: 16 }}>
            <h2 id="ready-h" style={{ margin: 0 }}>
              Ready?
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              {MODE_INFO[config.mode].tip}
            </p>
            <ul className={`small ${styles.readyList}`}>
              <li>The interviewer speaks first — turn your volume up.</li>
              {isLive ? (
                <li>It&apos;s a live call: just talk, and pause to think whenever you need. Talk over the interviewer to interrupt.</li>
              ) : speech.supported ? (
                <li>
                  Hands-free is on: just talk. Pausing to think is fine; the interviewer steps in when you hand it
                  over. Tap the mic to say you're done, or to interrupt.
                </li>
              ) : (
                <li>Voice input isn&apos;t available in this browser, so you&apos;ll type your answers. Chrome or Safari support speaking.</li>
              )}
              <li>Headphones help stop the mic from hearing the interviewer.</li>
              <li>About {config.durationMin} minutes. End anytime to get your feedback.</li>
            </ul>
            <button type="button" className="btn btn-primary btn-lg" onClick={start} autoFocus>
              Start interview
            </button>
          </section>
        </div>
      </main>
    );
  }

  if (phase === "done" || phase === "ending") {
    return (
      <main className={styles.page}>
        {header}
        {endState && (
          <ReportView
            session={endState.session}
            feedback={endState.feedback}
            loading={endState.loading}
            error={endState.error}
            onRetry={endState.canRetry ? () => void fetchFeedback(endState.session) : undefined}
            onDelete={
              endState.session.metrics.answerCount > 0
                ? () => {
                    feedbackAbortRef.current?.abort();
                    deleteSession(endState.session.id);
                    router.push("/");
                  }
                : undefined
            }
            actions={
              <>
                <button type="button" className="btn btn-primary" onClick={onRestart}>
                  Practice again
                </button>
                <button type="button" className="btn" onClick={() => router.push("/")}>
                  New setup
                </button>
              </>
            }
          />
        )}
      </main>
    );
  }

  const thinking = !isLive && busy && !liveText;
  const cloudFallback = config.voice === "cloud" && turns.length > 0 && !speaker.usingCloud;

  return (
    <main className={`${styles.page} ${styles.pageLive}`}>
      {header}
      {error && (
        <ErrorBanner
          error={error}
          onDismiss={() => setError(null)}
          onRetry={
            error.retry
              ? () => {
                  const retry = error.retry;
                  setError(null);
                  retry?.();
                }
              : undefined
          }
        />
      )}

      <div className={styles.room}>
        <div className={styles.transcriptArea}>
          <Transcript turns={turns} liveText={isLive ? live.interviewerText : liveText} thinking={thinking} emptyHint="Connecting to your interviewer…" />
        </div>

        <aside className={styles.workspace} aria-label="Workspace">
          <section className={styles.section}>
            <button type="button" className={styles.sectionHead} aria-expanded={screenOpen} onClick={() => setScreenOpen((v) => !v)}>
              Screen share
              {sharing && <span className="chip small">Live</span>}
              <span className={styles.chev} aria-hidden="true">
                {screenOpen ? "−" : "+"}
              </span>
            </button>
            {/* Kept mounted while collapsed so an active share isn't interrupted. */}
            <div className={styles.sectionBody} hidden={!screenOpen}>
              <ScreenShare onStreamChange={onStreamChange} compact={config.mode !== "leetcode"} />
            </div>
          </section>
          <section className={styles.section}>
            <button type="button" className={styles.sectionHead} aria-expanded={codeOpen} onClick={() => setCodeOpen((v) => !v)}>
              Code panel
              {code.trim() && <span className="chip small">Shared with interviewer</span>}
              <span className={styles.chev} aria-hidden="true">
                {codeOpen ? "−" : "+"}
              </span>
            </button>
            {codeOpen && (
              <div className={styles.sectionBody}>
                <CodePanel value={code} language={language} onChange={setCode} onLanguageChange={setLanguage} />
              </div>
            )}
          </section>


          <section className={`card ${styles.tipCard}`}>
            <strong>Tip</strong>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {MODE_INFO[config.mode].tip}
            </p>
          </section>
        </aside>

        <RoomControls
          className={styles.controls}
          live={isLive}
          speechSupported={isLive || speech.supported}
          listening={isLive ? live.micOn && live.connected : speech.listening}
          transcript={isLive ? live.candidateText : speech.transcript}
          speechError={isLive ? null : speech.error}
          speaking={isLive ? live.speaking : speaker.speaking}
          streaming={!isLive && busy && !!liveText}
          thinking={thinking}
          handsFree={handsFree}
          onHandsFreeChange={(v) => {
            setHandsFree(v);
            if (v && !speech.listening && !busyRef.current && !speakerRef.current.speaking) wantListenRef.current = true;
          }}
          muted={isLive ? live.muted : speaker.muted}
          onMutedChange={(m) => (isLive ? live.setMuted(m) : speaker.setMuted(m))}
          voiceNote={!isLive && cloudFallback ? "Natural voice isn't available, so the browser voice is used." : null}
          onMic={onMic}
          onSendText={sendText}
        />
      </div>

      {confirmEnd && (
        <ConfirmDialog title="End the interview?" onCancel={() => setConfirmEnd(false)}>
          <p className="muted" style={{ margin: 0 }}>
            You&apos;ll get a feedback report on {answerCount} answer(s).
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setConfirmEnd(false)} autoFocus>
              Keep going
            </button>
            <button type="button" className="btn btn-danger" onClick={finish}>
              End &amp; get feedback
            </button>
          </div>
        </ConfirmDialog>
      )}

      {confirmLeave && (
        <ConfirmDialog title="Leave interview?" onCancel={() => setConfirmLeave(false)}>
          <p className="muted" style={{ margin: 0 }}>
            Nothing is saved until you end the interview. Leave now to discard your {answerCount} answer(s), or end it to
            get feedback.
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setConfirmLeave(false)} autoFocus>
              Keep going
            </button>
            {/* Unmounting runs the cleanup effect and ScreenShare's own stop, same as any navigation. */}
            <button type="button" className="btn btn-danger" onClick={() => router.push("/")}>
              Leave and discard
            </button>
            <button type="button" className="btn btn-primary" onClick={finish}>
              End &amp; get feedback
            </button>
          </div>
        </ConfirmDialog>
      )}
    </main>
  );
}
