"use client";

import type { CSSProperties } from "react";
import { MODE_LABELS, type FeedbackReport as Report, type InterviewConfig, type SpeechMetrics } from "@/lib/types";
import styles from "./report.module.css";

function scoreColor(score: number): string {
  if (score >= 8) return "var(--success)";
  if (score >= 6) return "var(--accent)";
  if (score >= 4) return "var(--warning)";
  return "var(--danger)";
}

const clampScore = (n: number) => Math.max(0, Math.min(10, Number.isFinite(n) ? n : 0));

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

function paceNote(wpm: number): { text: string; tone: "good" | "warn" } {
  if (wpm === 0) return { text: "Not enough speech to measure", tone: "warn" };
  if (wpm < 120) return { text: "A bit slow · ideal 120–160", tone: "warn" };
  if (wpm > 160) return { text: "A bit fast · ideal 120–160", tone: "warn" };
  return { text: "Great pace · ideal 120–160", tone: "good" };
}

export function MetricsCard({ metrics, durationSec }: { metrics: SpeechMetrics; durationSec: number }) {
  const pace = paceNote(metrics.wordsPerMinute);
  const fillerRate = metrics.wordCount ? (metrics.fillerCount / metrics.wordCount) * 100 : 0;
  const fillers = Object.entries(metrics.fillerBreakdown).sort((a, b) => b[1] - a[1]);
  return (
    <section className="card" aria-labelledby="metrics-h">
      <h2 className={styles.h} id="metrics-h">
        How you spoke
      </h2>
      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricVal}>{metrics.wordsPerMinute || "—"}</span>
          <span className={styles.metricLabel}>Words per minute</span>
          <span className={`${styles.metricHint} ${styles[pace.tone]}`}>{pace.text}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricVal}>{metrics.fillerCount}</span>
          <span className={styles.metricLabel}>Filler words</span>
          <span className={`${styles.metricHint} ${fillerRate > 4 ? styles.warn : styles.good}`}>
            {fillerRate.toFixed(1)}% of words
          </span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricVal}>{metrics.answerCount}</span>
          <span className={styles.metricLabel}>Answers</span>
          <span className={`${styles.metricHint} muted`}>~{metrics.avgAnswerWords} words each</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricVal}>{Math.max(1, Math.round(durationSec / 60))}</span>
          <span className={styles.metricLabel}>Minutes</span>
          <span className={`${styles.metricHint} muted`}>{metrics.wordCount} words total</span>
        </div>
      </div>
      {fillers.length > 0 && (
        <div className={styles.fillers} aria-label="Filler word breakdown">
          {fillers.map(([word, n]) => (
            <span key={word} className="chip">
              “{word}” × {n}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

interface FeedbackReportProps {
  report: Report;
  metrics: SpeechMetrics;
  durationSec: number;
}

export default function FeedbackReport({ report, metrics, durationSec }: FeedbackReportProps) {
  const overall = clampScore(report.overallScore);
  const ring = scoreColor(overall);
  return (
    <div className={styles.report} style={{ "--ring": ring } as CSSProperties}>
      <section className="card" aria-labelledby="overall-h">
        <div className={styles.hero}>
          <div
            className={styles.score}
            style={{ "--pct": overall * 10 } as CSSProperties}
            role="img"
            aria-label={`Overall score ${overall} out of 10`}
          >
            <div className={styles.scoreInner}>
              <div>
                <span className={styles.scoreNum}>{overall}</span>
                <span className={styles.scoreOf}>out of 10</span>
              </div>
            </div>
          </div>
          <div className={styles.heroText}>
            <h2 id="overall-h" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
              Overall result
            </h2>
            {report.verdict && <span className={styles.verdict}>{report.verdict}</span>}
            <p className={styles.summary}>{report.summary}</p>
          </div>
        </div>
      </section>

      <MetricsCard metrics={metrics} durationSec={durationSec} />

      {report.categories.length > 0 && (
        <section className="card" aria-labelledby="cats-h">
          <h2 className={styles.h} id="cats-h">
            Scores by category
          </h2>
          <div className={styles.cats}>
            {report.categories.map((c) => {
              const s = clampScore(c.score);
              return (
                <div key={c.name} style={{ "--ring": scoreColor(s) } as CSSProperties}>
                  <div className={styles.catHead}>
                    <span>{c.name}</span>
                    <span>{s}/10</span>
                  </div>
                  <div className={styles.bar} role="presentation">
                    <div className={styles.barFill} style={{ width: `${s * 10}%` }} />
                  </div>
                  {c.comment && <p className={styles.catComment}>{c.comment}</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className={styles.grid}>
        <section className="card" aria-labelledby="str-h">
          <h2 className={styles.h} id="str-h">
            What went well
          </h2>
          <ul className={styles.list}>
            {report.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="imp-h">
          <h2 className={styles.h} id="imp-h">
            What to improve
          </h2>
          <ul className={styles.list}>
            {report.improvements.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      </div>

      {report.betterAnswers.length > 0 && (
        <section className="card" aria-labelledby="better-h">
          <h2 className={styles.h} id="better-h">
            Stronger answers
          </h2>
          {report.betterAnswers.map((b, i) => (
            <details key={i} className={styles.better}>
              <summary>{b.question}</summary>
              <div className={styles.betterBody}>
                <div>
                  <span className={styles.betterLabel}>What you said</span>
                  <p>{b.yourAnswerSummary}</p>
                </div>
                <div className={styles.improved}>
                  <span className={styles.betterLabel}>A stronger version</span>
                  <p>{b.improvedAnswer}</p>
                </div>
              </div>
            </details>
          ))}
        </section>
      )}

      {report.nextSteps.length > 0 && (
        <section className="card" aria-labelledby="next-h">
          <h2 className={styles.h} id="next-h">
            Next steps
          </h2>
          <ol className={styles.list}>
            {report.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

/** Plain-text version for "Copy report". */
export function reportToText(
  config: InterviewConfig,
  metrics: SpeechMetrics,
  durationSec: number,
  report?: Report | null,
): string {
  const lines: string[] = [];
  const title = `${MODE_LABELS[config.mode] ?? config.mode} interview — ${config.role}${config.company ? ` @ ${config.company}` : ""}`;
  lines.push(title, `Duration: ${formatDuration(durationSec)} · Difficulty: ${config.difficulty}`, "");
  if (report) {
    lines.push(`Overall: ${report.overallScore}/10 — ${report.verdict}`, "", report.summary, "");
    if (report.categories.length) {
      lines.push("SCORES");
      for (const c of report.categories) lines.push(`- ${c.name}: ${c.score}/10 — ${c.comment}`);
      lines.push("");
    }
    const section = (name: string, items: string[]) => {
      if (!items.length) return;
      lines.push(name, ...items.map((s) => `- ${s}`), "");
    };
    section("STRENGTHS", report.strengths);
    section("IMPROVEMENTS", report.improvements);
    if (report.betterAnswers.length) {
      lines.push("STRONGER ANSWERS");
      for (const b of report.betterAnswers) {
        lines.push(`Q: ${b.question}`, `You: ${b.yourAnswerSummary}`, `Better: ${b.improvedAnswer}`, "");
      }
    }
    section("NEXT STEPS", report.nextSteps);
  }
  lines.push("SPEAKING");
  if (metrics.wordsPerMinute) lines.push(`- ${metrics.wordsPerMinute} words/min (ideal 120–160)`);
  lines.push(`- ${metrics.fillerCount} filler words${
    Object.keys(metrics.fillerBreakdown).length
      ? ` (${Object.entries(metrics.fillerBreakdown).map(([k, v]) => `${k} ×${v}`).join(", ")})`
      : ""
  }`);
  lines.push(`- ${metrics.answerCount} answers, ~${metrics.avgAnswerWords} words each`);
  return lines.join("\n");
}
