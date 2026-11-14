"use client";

import { useId, type ReactNode } from "react";
import styles from "./room.module.css";

interface ConfirmDialogProps {
  title: string;
  /** Body and buttons; put autoFocus on the safe button. */
  children: ReactNode;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, children, onCancel }: ConfirmDialogProps) {
  const headingId = useId();
  return (
    <div
      className={styles.confirm}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <div className={`card stack ${styles.confirmCard}`}>
        <h2 id={headingId} style={{ margin: 0 }}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
