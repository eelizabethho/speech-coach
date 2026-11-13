"use client";

import { useEffect, useRef } from "react";
import type { Turn } from "@/lib/types";
import styles from "./room.module.css";

interface TranscriptProps {
  turns: Turn[];
  /** Interviewer text currently streaming in */
  liveText?: string;
  /** Waiting for the first token of the interviewer's reply */
  thinking?: boolean;
  /** Scroll to the newest message as content arrives */
  autoScroll?: boolean;
  emptyHint?: string;
}

export default function Transcript({ turns, liveText = "", thinking = false, autoScroll = true, emptyHint }: TranscriptProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastTurn = turns[turns.length - 1];
  const lastInterviewerText = [...turns].reverse().find((t) => t.role === "interviewer")?.text ?? "";

  // Re-scroll on new turns and roughly every line of streamed text.
  const liveBucket = liveText ? Math.floor(liveText.length / 80) : -1;
  useEffect(() => {
    if (!autoScroll) return;
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [autoScroll, turns.length, liveBucket, thinking]);

  return (
    <div className={styles.transcript}>
      {/* Screen readers hear each completed interviewer line once. */}
      <div aria-live="polite" style={srOnly}>
        {lastTurn?.role === "interviewer" ? `Interviewer: ${lastInterviewerText}` : ""}
      </div>

      {turns.length === 0 && !liveText && !thinking && (
        <p className={`muted small ${styles.emptyTranscript}`}>{emptyHint ?? "The conversation will appear here."}</p>
      )}

      {turns.map((t) => (
        <div key={t.id} className={`${styles.bubbleRow} ${t.role === "candidate" ? styles.bubbleRowCandidate : ""}`}>
          <span className={styles.who}>{t.role === "interviewer" ? "Interviewer" : "You"}</span>
          <div className={`${styles.bubble} ${t.role === "interviewer" ? styles.bubbleInterviewer : styles.bubbleCandidate}`}>
            {t.text}
          </div>
          {(t.code || t.screenshot) && (
            <div className={styles.attach}>
              {t.code && <span className={`chip ${styles.attachChip}`}>Code shared ({t.code.language})</span>}
              {t.screenshot && <span className={`chip ${styles.attachChip}`}>Screen shared</span>}
            </div>
          )}
        </div>
      ))}

      {(liveText || thinking) && (
        <div className={styles.bubbleRow}>
          <span className={styles.who}>Interviewer</span>
          <div className={`${styles.bubble} ${styles.bubbleInterviewer}`} aria-busy="true">
            {liveText || (
              <span className={styles.typing} aria-label="Interviewer is thinking">
                <span />
                <span />
                <span />
              </span>
            )}
          </div>
        </div>
      )}
      <div ref={endRef} className={styles.endSentinel} />
    </div>
  );
}

const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};
