"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import {
  DEFAULT_CONFIG,
  MODE_LABELS,
  MODEL_LABELS,
  VOICE_OPTIONS,
  type ChatModel,
  type Difficulty,
  type InterviewConfig,
  type SavedSession,
  type VoiceEngine,
  type VoiceMode,
} from "@/lib/types";
import { isScreenShareSupported } from "@/lib/capture/frame";
import { deleteSession, listSessions, loadLastConfig, saveLastConfig, setActiveConfig } from "@/lib/session/history";
import { pickChallenge } from "@/lib/challenges";
import { MODE_INFO, MODE_ORDER } from "./modeInfo";
import styles from "./setup.module.css";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const LENGTHS = [15, 30, 45];
const VOICES: VoiceMode[] = ["browser", "cloud"];
const ENGINES: VoiceEngine[] = ["gemini-live", "claude"];

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  render,
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (v: T) => void;
  render: (v: T) => string;
}) {
  const id = useId();
  return (
    <div>
      <span className="label" id={id}>
        {label}
      </span>
      <div className={styles.segmented} role="radiogroup" aria-labelledby={id}>
        {options.map((o) => (
          <button
            key={String(o)}
            type="button"
            role="radio"
            aria-checked={value === o}
            className={`${styles.segment} ${value === o ? styles.segmentActive : ""}`}
            onClick={() => onChange(o)}
          >
            {render(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SetupScreen() {
  const router = useRouter();
  const [config, setConfig] = useState<InterviewConfig>(DEFAULT_CONFIG);
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [screenShareOk, setScreenShareOk] = useState(true);
  const [showErrors, setShowErrors] = useState(false);
  const [starting, setStarting] = useState(false);

  // Browser-only reads happen after hydration.
  useEffect(() => {
    const last = loadLastConfig();
    if (last) setConfig(last);
    setSessions(listSessions());
    try {
      setScreenShareOk(isScreenShareSupported());
    } catch {
      setScreenShareOk(false);
    }
  }, []);

  const update = <K extends keyof InterviewConfig>(key: K, value: InterviewConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));

  const customMissing = config.mode === "custom" && !config.customScenario.trim();
  const roleMissing = !config.role.trim();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (customMissing || roleMissing) {
      setShowErrors(true);
      return;
    }
    const final: InterviewConfig = {
      ...config,
      role: config.role.trim(),
      company: config.company.trim(),
      jobDescription: config.jobDescription.trim(),
      customScenario: config.mode === "custom" ? config.customScenario.trim() : config.customScenario,
      // A fresh random codebase each start.
      challengeId: config.mode === "ai-coding" ? pickChallenge(config.difficulty, config.challengeId).id : config.challengeId,
    };
    saveLastConfig(final);
    setActiveConfig(final);
    setStarting(true);
    router.push("/interview");
  }

  function onDelete(id: string) {
    deleteSession(id);
    setSessions(listSessions());
  }

  return (
    <main className="container">
      <header className={styles.hero}>
        <div className={styles.brand}>Speech Coach</div>
        <h1>Practice interviews out loud</h1>
        <p className="muted">
          Pick a scenario, talk through your answers, and get honest feedback from an AI interviewer that can see your
          code and shared screen.
        </p>
      </header>

      <div className={styles.layout}>
        <form className="card stack" onSubmit={onSubmit} noValidate style={{ gap: 24 }}>
          <fieldset className={styles.section}>
            <legend>Interview type</legend>
            <div className={styles.modes} role="radiogroup" aria-label="Interview type">
              {MODE_ORDER.map((m, i) => {
                const active = config.mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`${styles.mode} ${active ? styles.modeActive : ""}`}
                    onClick={() => update("mode", m)}
                  >
                    <span className={styles.modeIcon} aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <span className={styles.modeTitle}>{MODE_LABELS[m]}</span>
                      <span className={styles.modeDesc}>{MODE_INFO[m].description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {config.mode === "custom" && (
            <div>
              <label className="label" htmlFor="custom-scenario">
                Your scenario
              </label>
              <textarea
                id="custom-scenario"
                className="textarea"
                rows={4}
                required
                aria-invalid={showErrors && customMissing}
                aria-describedby="custom-hint"
                placeholder="e.g. A 30-minute phone screen for a mobile dev internship. Ask about my React Native app, then one debugging question."
                value={config.customScenario}
                onChange={(e) => update("customScenario", e.target.value)}
              />
              {showErrors && customMissing ? (
                <div className={styles.error} id="custom-hint">
                  Describe the scenario you want to practice.
                </div>
              ) : (
                <div className={styles.hint} id="custom-hint">
                  Who is interviewing you, what for, and what should they focus on?
                </div>
              )}
            </div>
          )}

          <fieldset className={styles.section}>
            <legend>The role</legend>
            <div className={styles.fields}>
              <div>
                <label className="label" htmlFor="role">
                  Role
                </label>
                <input
                  id="role"
                  className="input"
                  value={config.role}
                  aria-invalid={showErrors && roleMissing}
                  onChange={(e) => update("role", e.target.value)}
                  placeholder="Software Engineer Intern"
                  autoComplete="off"
                />
                {showErrors && roleMissing && <div className={styles.error}>Enter the role you&apos;re interviewing for.</div>}
              </div>
              <div>
                <label className="label" htmlFor="company">
                  Company <span className="muted small">(optional)</span>
                </label>
                <input
                  id="company"
                  className="input"
                  value={config.company}
                  onChange={(e) => update("company", e.target.value)}
                  placeholder="e.g. Stripe"
                  autoComplete="organization"
                />
              </div>
              <details className={`${styles.details} ${styles.full}`} open={config.jobDescription.length > 0 || undefined}>
                <summary>Job description (optional)</summary>
                <label className="label" htmlFor="jd" style={{ marginTop: 4 }}>
                  Paste the posting so questions match it
                </label>
                <textarea
                  id="jd"
                  className="textarea"
                  rows={6}
                  value={config.jobDescription}
                  onChange={(e) => update("jobDescription", e.target.value)}
                  placeholder="Paste the job description here…"
                />
              </details>
            </div>
          </fieldset>

          <fieldset className={styles.section}>
            <legend>Settings</legend>
            <div className={styles.fields}>
              <Segmented
                label="Difficulty"
                options={DIFFICULTIES}
                value={config.difficulty}
                onChange={(v) => update("difficulty", v)}
                render={(v) => v[0].toUpperCase() + v.slice(1)}
              />
              <Segmented
                label="Length"
                options={LENGTHS}
                value={LENGTHS.includes(config.durationMin) ? config.durationMin : 30}
                onChange={(v) => update("durationMin", v)}
                render={(v) => `${v} min`}
              />
              <div>
                <Segmented
                  label="Interviewer engine"
                  options={ENGINES}
                  value={config.engine}
                  onChange={(v) => update("engine", v)}
                  render={(v) => (v === "gemini-live" ? "Gemini Live (natural call)" : "Claude (turn by turn)")}
                />
                <div className={styles.hint}>
                  {config.engine === "gemini-live"
                    ? "A real-time voice call: pause to think, talk over it to interrupt. Needs GEMINI_API_KEY. Claude still writes your feedback report."
                    : "Claude listens through your browser's speech recognition and replies with a synthesized voice."}
                </div>
              </div>
              <div>
                <label className="label" htmlFor="model">
                  {config.engine === "gemini-live" ? "Feedback model" : "Interviewer model"}
                </label>
                <select
                  id="model"
                  className="select"
                  value={config.model}
                  onChange={(e) => update("model", e.target.value as ChatModel)}
                >
                  {(Object.keys(MODEL_LABELS) as ChatModel[]).map((m) => (
                    <option key={m} value={m}>
                      {MODEL_LABELS[m]}
                    </option>
                  ))}
                </select>
                <div className={styles.hint}>Haiku is the cheapest and replies fastest — great for practice.</div>
              </div>
              {config.engine === "claude" && (
              <Segmented
                label="Interviewer voice"
                options={VOICES}
                value={config.voice}
                onChange={(v) => update("voice", v)}
                render={(v) => (v === "browser" ? "Browser (free)" : "Natural (cloud)")}
              />
              )}
              {config.engine === "claude" && config.voice === "cloud" && (
                <div>
                  <label className="label" htmlFor="cloud-voice">
                    Voice
                  </label>
                  <select
                    id="cloud-voice"
                    className="select"
                    value={config.cloudVoice}
                    onChange={(e) => update("cloudVoice", e.target.value)}
                  >
                    <option value="random">Random each interview</option>
                    {Object.entries(VOICE_OPTIONS).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </fieldset>

          <div className={styles.startBar}>
            <button type="submit" className="btn btn-primary btn-lg" disabled={starting}>
              {starting ? "Opening the room…" : "Start interview"}
            </button>
            <span className="muted small">You&apos;ll be asked for microphone access.</span>
          </div>
        </form>

        <aside className={`${styles.aside} stack`} style={{ gap: 16 }}>
          <section className="card stack" aria-labelledby="tips-title">
            <h2 id="tips-title" style={{ fontSize: "1.05rem", margin: 0 }}>
              Before you start
            </h2>
            <ul className={styles.tips}>
              <li>Use a quiet room and headphones so the mic doesn&apos;t pick up the interviewer.</li>
              <li>Hands-free mode lets you pause to think — the interviewer only steps in when you hand it over.</li>
              <li>The code panel works on every device; the interviewer sees it when you answer.</li>
              {screenShareOk ? (
                <li>On a laptop you can share your screen (e.g. a diagram or IDE) with the interviewer.</li>
              ) : (
                <li>Screen sharing needs a laptop or desktop browser — on this device, use the code panel instead.</li>
              )}
              <li>Speech recognition works best in Chrome or Safari. You can always type instead.</li>
            </ul>
          </section>

          <section className="card stack" aria-labelledby="past-title">
            <h2 id="past-title" style={{ fontSize: "1.05rem", margin: 0 }}>
              Past sessions
            </h2>
            {sessions.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>
                Your finished interviews and feedback will show up here.
              </p>
            ) : (
              <ul className={styles.sessions}>
                {sessions.map((s) => (
                  <li key={s.id} className={styles.sessionItem}>
                    <Link href={`/history/${encodeURIComponent(s.id)}`} className={styles.sessionLink}>
                      <span className={styles.score} aria-label={s.feedback ? `Score ${s.feedback.overallScore} of 10` : "No score"}>
                        {s.feedback ? `${s.feedback.overallScore}/10` : "—"}
                      </span>
                      <span className={styles.sessionMain}>
                        <span className={styles.sessionTitle}>
                          {MODE_LABELS[s.config.mode] ?? s.config.mode}
                          {s.config.company ? ` · ${s.config.company}` : ""}
                        </span>
                        <span className="muted small">
                          {new Date(s.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                          {Math.max(1, Math.round(s.durationSec / 60))} min
                          {s.feedback ? ` · ${s.feedback.verdict}` : ""}
                        </span>
                      </span>
                    </Link>
                    <button
                      type="button"
                      className={`btn btn-ghost ${styles.deleteBtn}`}
                      aria-label="Delete session"
                      title="Delete session"
                      onClick={() => onDelete(s.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
