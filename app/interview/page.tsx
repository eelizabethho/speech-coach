"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { InterviewConfig } from "@/lib/types";
import { loadActiveConfig } from "@/lib/session/history";
import InterviewRoom from "@/components/room/InterviewRoom";

export default function InterviewPage() {
  const router = useRouter();
  const [config, setConfig] = useState<InterviewConfig | null>(null);
  const [runKey, setRunKey] = useState(0);

  // sessionStorage is only readable after hydration.
  useEffect(() => {
    const cfg = loadActiveConfig();
    if (cfg) setConfig(cfg);
    else router.replace("/");
  }, [router]);

  if (!config) {
    return (
      <main className="container" aria-busy="true">
        <p className="muted">Loading your interview…</p>
      </main>
    );
  }

  return <InterviewRoom key={runKey} config={config} onRestart={() => setRunKey((k) => k + 1)} />;
}
