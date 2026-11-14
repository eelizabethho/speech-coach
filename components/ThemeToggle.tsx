"use client";

import { useEffect, useState } from "react";

const MODES = ["system", "light", "dark"] as const;
type Mode = (typeof MODES)[number];

const LABELS: Record<Mode, string> = { system: "System", light: "Light", dark: "Dark" };

const ICONS: Record<Mode, React.ReactNode> = {
  system: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
};

export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  // The inline script in layout.tsx already applied the stored choice to <html>.
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    if (t === "light" || t === "dark") setMode(t);
  }, []);

  const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];

  function cycle() {
    setMode(next);
    const root = document.documentElement;
    if (next === "system") delete root.dataset.theme;
    else root.dataset.theme = next;
    try {
      localStorage.setItem("speech-coach:theme", next);
    } catch {
      // Storage can be blocked (private mode); the choice still applies for this page.
    }
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      aria-label={`Theme: ${LABELS[mode]}. Switch to ${LABELS[next]}.`}
      title={`Theme: ${LABELS[mode]}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
        {ICONS[mode]}
      </svg>
    </button>
  );
}
