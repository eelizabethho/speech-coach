"use client";

import { useState, type ReactNode } from "react";
import type { FeedbackReport as Report, SavedSession } from "@/lib/types";
import FeedbackReport, { MetricsCard, reportToText } from "./FeedbackReport";
import Transcript from "./Transcript";
import styles from "./room.module.css";

interface ReportViewProps {
  session: SavedSession;
  feedback?: Report | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Extra buttons (e.g. Practice again / New setup) */
  actions?: ReactNode;
}

export default function ReportView({ session, feedback, loading, error, onRetry, actions }: ReportViewProps) {
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const [showTranscript, setShowTranscript] = useState(false);

  async function copy() {
    const text = reportToText(session.config, session.metrics, session.durationSec, feedback);
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied("idle"), 2000);
  }

  return (
    <div className="stack" style={{ gap: 16, paddingBottom: 48 }}>
      <div className="row">
        {actions}
        {!loading && (
          <button type="button" className="btn" onClick={copy}>
            {copied === "ok" ? "Copied!" : copied === "fail" ? "Copy failed" : "Copy report"}
          </button>
        )}
      </div>
      <span aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {copied === "ok" ? "Report copied to clipboard" : ""}
      </span>

      {loading && (
        <div className="card row" role="status" style={{ gap: 16, padding: 24 }}>
          <div className={styles.spinner} aria-hidden="true" />
          <div>
            <strong>Your interviewer is writing feedback…</strong>
            <div className="muted small">This usually takes 10–30 seconds.</div>
          </div>
        </div>
      )}

      {!loading && error && (
        <div className={styles.banner} role="alert">
          <div className={styles.bannerText}>
            <strong>Couldn&apos;t get feedback.</strong> {error} Your transcript and speaking stats are saved below.
          </div>
          {onRetry && (
            <button type="button" className="btn btn-primary" onClick={onRetry}>
              Retry feedback
            </button>
          )}
        </div>
      )}

      {!loading && feedback ? (
        <FeedbackReport report={feedback} metrics={session.metrics} durationSec={session.durationSec} />
      ) : (
        !loading && <MetricsCard metrics={session.metrics} durationSec={session.durationSec} />
      )}

      <section className="card">
        <button
          type="button"
          className={styles.sectionHead}
          aria-expanded={showTranscript}
          onClick={() => setShowTranscript((v) => !v)}
          style={{ padding: 0 }}
        >
          Transcript <span className="muted small">({session.turns.length} messages)</span>
          <span className={styles.chev} aria-hidden="true">
            {showTranscript ? "−" : "+"}
          </span>
        </button>
        {showTranscript && <Transcript turns={session.turns} autoScroll={false} emptyHint="No messages were recorded." />}
      </section>
    </div>
  );
}
