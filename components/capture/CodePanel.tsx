"use client";

import { useId, useLayoutEffect, useMemo, useRef } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import type { CodeLanguage, CodePanelProps } from "@/lib/types";
import styles from "./capture.module.css";

const INDENT = "    ";

export const CODE_LANGUAGE_LABELS: Record<CodeLanguage, string> = {
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
  java: "Java",
  cpp: "C++",
  go: "Go",
  pseudocode: "Pseudocode",
};

const PLACEHOLDERS: Record<CodeLanguage, string> = {
  python: "# Write your solution here\ndef solve():\n    pass",
  javascript: "// Write your solution here\nfunction solve() {\n}",
  typescript: "// Write your solution here\nfunction solve(): void {\n}",
  java: "// Write your solution here\nclass Solution {\n}",
  cpp: "// Write your solution here\nclass Solution {\n};",
  go: "// Write your solution here\nfunc solve() {\n}",
  pseudocode: "Describe your approach step by step…",
};

const LANGUAGES = Object.keys(CODE_LANGUAGE_LABELS) as CodeLanguage[];

type Sel = { start: number; end: number };

export default function CodePanel({
  value,
  language,
  onChange,
  onLanguageChange,
  title = "Code",
}: CodePanelProps) {
  const id = useId();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
  // Selection to restore after a fallback (non-execCommand) edit re-renders.
  const pendingSel = useRef<Sel | null>(null);
  // After Escape, the next Tab moves focus instead of indenting (keyboard a11y).
  const tabEscapes = useRef(false);

  const lineCount = useMemo(() => value.split("\n").length, [value]);
  const gutterText = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"),
    [lineCount],
  );

  useLayoutEffect(() => {
    const ta = taRef.current;
    const sel = pendingSel.current;
    if (ta && sel) {
      ta.setSelectionRange(sel.start, sel.end);
      pendingSel.current = null;
    }
    syncGutter();
  });

  function syncGutter() {
    const ta = taRef.current;
    const g = gutterRef.current;
    if (ta && g) g.style.transform = `translateY(${-ta.scrollTop}px)`;
  }

  /** Replace [start,end) with `text`, then select `sel`. Keeps native undo when possible. */
  function edit(start: number, end: number, text: string, sel: Sel) {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try {
      ok =
        typeof document.execCommand === "function" &&
        (text === ""
          ? document.execCommand("delete", false)
          : document.execCommand("insertText", false, text));
    } catch {
      ok = false;
    }
    // execCommand fires a native input event, so onChange already ran.
    if (ok && ta.value === value.slice(0, start) + text + value.slice(end)) {
      ta.setSelectionRange(sel.start, sel.end);
      return;
    }
    pendingSel.current = sel;
    onChange(value.slice(0, start) + text + value.slice(end));
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const ta = e.currentTarget;
    const { selectionStart: s, selectionEnd: t } = ta;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;

    if (e.key === "Escape") {
      tabEscapes.current = true;
      return;
    }

    if (e.key === "Tab") {
      if (tabEscapes.current) {
        tabEscapes.current = false;
        return; // let focus move
      }
      e.preventDefault();
      const multiLine = value.slice(s, t).includes("\n");
      if (!e.shiftKey && !multiLine) {
        edit(s, t, INDENT, { start: s + INDENT.length, end: s + INDENT.length });
        return;
      }
      // Indent / outdent every line touched by the selection.
      // If the selection ends right at a line start, don't touch that line.
      const effEnd = t > s && value[t - 1] === "\n" ? t - 1 : t;
      let blockEnd = value.indexOf("\n", effEnd);
      if (blockEnd === -1) blockEnd = value.length;
      const lines = value.slice(lineStart, blockEnd).split("\n");
      let firstDelta = 0;
      let totalDelta = 0;
      const next = lines.map((line, i) => {
        let out: string;
        if (e.shiftKey) {
          const m = /^( {1,4}|\t)/.exec(line);
          out = m ? line.slice(m[0].length) : line;
        } else {
          out = INDENT + line;
        }
        const d = out.length - line.length;
        if (i === 0) firstDelta = d;
        totalDelta += d;
        return out;
      });
      const newStart = Math.max(lineStart, s + firstDelta);
      edit(lineStart, blockEnd, next.join("\n"), {
        start: multiLine ? lineStart : newStart,
        end: multiLine ? blockEnd + totalDelta : Math.max(newStart, t + firstDelta),
      });
      return;
    }
    tabEscapes.current = false;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const before = value.slice(lineStart, s);
      const indent = /^[ \t]*/.exec(before)![0];
      const last = before.trimEnd().slice(-1);
      const opens = last === ":" || last === "{" || last === "[" || last === "(";
      const inner = indent + (opens ? INDENT : "");
      const closer = value.slice(t).match(/^[ \t]*([}\])])/)?.[1];
      const pairs: Record<string, string> = { "{": "}", "[": "]", "(": ")" };
      if (opens && closer && pairs[last] === closer) {
        // Cursor between a bracket pair: put the closer on its own line.
        const text = "\n" + inner + "\n" + indent;
        const caret = s + 1 + inner.length;
        edit(s, t, text, { start: caret, end: caret });
      } else {
        const text = "\n" + inner;
        edit(s, t, text, { start: s + text.length, end: s + text.length });
      }
      return;
    }

    // Backspace inside leading spaces removes back to the previous indent stop.
    if (e.key === "Backspace" && s === t && s > lineStart) {
      const before = value.slice(lineStart, s);
      if (/^ +$/.test(before)) {
        e.preventDefault();
        const remove = before.length % INDENT.length || INDENT.length;
        edit(s - remove, s, "", { start: s - remove, end: s - remove });
      }
    }
  }

  const selectId = `${id}-lang`;
  const editorId = `${id}-editor`;
  const hintId = `${id}-hint`;

  return (
    <section className={`panel ${styles.codePanel}`} aria-labelledby={`${id}-title`}>
      <header className={styles.codeHeader}>
        <h3 id={`${id}-title`} className={styles.codeTitle}>
          {title}
        </h3>
        <label htmlFor={selectId} style={srOnly}>
          Language
        </label>
        <select
          id={selectId}
          className={`select ${styles.langSelect}`}
          value={language}
          onChange={(e) => onLanguageChange(e.target.value as CodeLanguage)}
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {CODE_LANGUAGE_LABELS[l]}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <span className="small muted" aria-hidden>
          {lineCount} {lineCount === 1 ? "line" : "lines"} · {value.length}{" "}
          {value.length === 1 ? "char" : "chars"}
        </span>
      </header>

      <div className={styles.editor}>
        <div className={styles.gutter} aria-hidden>
          <pre ref={gutterRef} className={styles.gutterInner}>
            {gutterText}
          </pre>
        </div>
        <textarea
          ref={taRef}
          id={editorId}
          className={styles.code}
          aria-label={`${title} editor (${CODE_LANGUAGE_LABELS[language]})`}
          aria-describedby={hintId}
          value={value}
          placeholder={PLACEHOLDERS[language]}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={syncGutter}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          data-gramm="false"
          translate="no"
        />
      </div>
      <p id={hintId} style={srOnly}>
        Tab indents, Shift+Tab outdents. Press Escape then Tab to leave the editor.
      </p>
    </section>
  );
}

// Visually hidden but available to screen readers.
const srOnly: CSSProperties = {
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
