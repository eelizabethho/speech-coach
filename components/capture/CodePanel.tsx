"use client";
// STUB — owned by Agent C (capture). Replace with real implementation.
import type { CodePanelProps } from "@/lib/types";

export default function CodePanel({ value, onChange, title }: CodePanelProps) {
  return (
    <div className="panel">
      <span className="label">{title ?? "Code"}</span>
      <textarea className="textarea mono" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
