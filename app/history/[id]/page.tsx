"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MODE_LABELS, type SavedSession } from "@/lib/types";
import { deleteSession, getSession, setActiveConfig } from "@/lib/session/history";
import ReportView from "@/components/room/ReportView";

export default function HistoryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SavedSession | null | undefined>(undefined);

  useEffect(() => {
    const id = typeof params?.id === "string" ? decodeURIComponent(params.id) : "";
    setSession(id ? getSession(id) : null);
  }, [params]);

  if (session === undefined) {
    return (
      <main className="container" aria-busy="true">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (session === null) {
    return (
      <main className="container stack">
        <h1>Session not found</h1>
        <p className="muted">It may have been deleted, or saved in a different browser.</p>
        <div>
          <Link href="/" className="btn btn-primary">
            Back to setup
          </Link>
        </div>
      </main>
    );
  }

  const { config } = session;
  const when = new Date(session.startedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <main className="container stack" style={{ gap: 16 }}>
      <div>
        <Link href="/" className="small">
          ← All sessions
        </Link>
        <h1 style={{ marginTop: 8, fontSize: "1.5rem" }}>{MODE_LABELS[config.mode] ?? config.mode} interview</h1>
        <p className="muted small" style={{ margin: 0 }}>
          {[config.role, config.company, when].filter(Boolean).join(" · ")}
        </p>
      </div>
      <ReportView
        session={session}
        feedback={session.feedback ?? null}
        error={session.feedback ? null : "Feedback wasn't generated for this session."}
        actions={
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setActiveConfig(config);
                router.push("/interview");
              }}
            >
              Practice this again
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (window.confirm("Delete this session?")) {
                  deleteSession(session.id);
                  router.push("/");
                }
              }}
            >
              Delete
            </button>
          </>
        }
      />
    </main>
  );
}
