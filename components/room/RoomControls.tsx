"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import styles from "./room.module.css";

interface RoomControlsProps {
  className?: string;
  speechSupported: boolean;
  listening: boolean;
  transcript: string;
  speechError: string | null;
  /** Interviewer audio playing */
  speaking: boolean;
  /** Interviewer text streaming in */
  streaming: boolean;
  /** Waiting for the interviewer's first token */
  thinking: boolean;
  handsFree: boolean;
  onHandsFreeChange: (v: boolean) => void;
  muted: boolean;
  onMutedChange: (v: boolean) => void;
  voiceNote?: string | null;
  onMic: () => void;
  onSendText: (text: string) => void;
  /** Gemini Live: always-open call; the mic button mutes/unmutes instead of sending. */
  live?: boolean;
}

function MicIcon({ stop }: { stop: boolean }) {
  if (stop) {
    // "Send" arrow while listening
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 12h12M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function RoomControls(p: RoomControlsProps) {
  const [draft, setDraft] = useState("");

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || p.thinking) return;
    p.onSendText(text);
    setDraft("");
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  let status: string;
  let dot = "";
  if (p.live) {
    status = p.speaking
      ? "Interviewer is speaking — just talk to interrupt"
      : p.listening
        ? "Live — talk naturally. Pausing to think is fine."
        : "Your mic is off — tap it to talk";
    dot = p.speaking ? styles.dotSpeaking : p.listening ? styles.dotListening : "";
  } else if (p.listening) {
    status = p.handsFree ? "Listening… pause to send, or tap to send now" : "Listening… tap the mic to send";
    dot = styles.dotListening;
  } else if (p.thinking) {
    status = "Interviewer is thinking…";
    dot = styles.dotThinking;
  } else if (p.speaking || p.streaming) {
    status = p.speechSupported ? "Interviewer is speaking — tap the mic to interrupt" : "Interviewer is replying…";
    dot = styles.dotSpeaking;
  } else if (!p.speechSupported) {
    status = "Type your answer below";
  } else {
    status = p.handsFree ? "Your turn — the mic opens automatically, or tap it" : "Your turn — tap the mic to answer";
  }

  const micDisabled = !p.speechSupported || p.thinking;
  const micLabel = p.live ? (p.listening ? "Turn mic off" : "Turn mic on") : p.listening ? "Send answer" : p.speaking || p.streaming ? "Interrupt and answer" : "Start answering";

  return (
    <div className={p.className}>
      <div className={styles.status} aria-live="polite">
        <span className={`${styles.dot} ${dot}`} aria-hidden="true" />
        <span>{status}</span>
      </div>

      {p.listening && (
        <div className={styles.live} aria-live="off">
          {p.transcript || <span className="muted">Start speaking…</span>}
        </div>
      )}

      <div className={styles.mainRow}>
        {p.speechSupported && (
          <button
            type="button"
            className={`${styles.mic} ${p.listening ? styles.micListening : ""}`}
            onClick={p.onMic}
            disabled={micDisabled}
            aria-label={micLabel}
            title={micLabel}
            aria-pressed={p.listening}
          >
            <MicIcon stop={p.listening && !p.live} />
          </button>
        )}
        <form className={styles.textForm} onSubmit={submit}>
          <label htmlFor="answer-text" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
            Type your answer
          </label>
          <textarea
            id="answer-text"
            className={`textarea ${styles.textInput}`}
            rows={1}
            value={draft}
            placeholder={p.speechSupported ? "Or type your answer…" : "Type your answer…"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            enterKeyHint="send"
          />
          <button type="submit" className={`btn btn-primary ${styles.sendBtn}`} disabled={!draft.trim() || p.thinking}>
            Send
          </button>
        </form>
      </div>

      <div className={styles.toggles}>
        {p.speechSupported && !p.live && (
          <button type="button" className={styles.toggle} aria-pressed={p.handsFree} onClick={() => p.onHandsFreeChange(!p.handsFree)}>
            {p.handsFree ? "Hands-free on" : "Hands-free paused"}
          </button>
        )}
        <button type="button" className={styles.toggle} aria-pressed={p.muted} onClick={() => p.onMutedChange(!p.muted)}>
          {p.muted ? "Voice muted" : "Mute voice"}
        </button>
      </div>

      {p.speechError && <p className={styles.micError} role="alert">Microphone: {p.speechError}</p>}
      {!p.speechSupported && (
        <p className={styles.note}>Voice input isn&apos;t supported in this browser — use Chrome or Safari to speak your answers.</p>
      )}
      {p.voiceNote && <p className={styles.note}>{p.voiceNote}</p>}
    </div>
  );
}
