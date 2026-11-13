"use client";

import styles from "./room.module.css";

export interface RoomError {
  message: string;
  code?: string;
  retry?: () => void;
}

export default function ErrorBanner({
  error,
  onDismiss,
  onRetry,
}: {
  error: RoomError;
  onDismiss: () => void;
  onRetry?: () => void;
}) {
  let body: React.ReactNode = error.message;
  if (error.code === "missing_api_key") {
    body = (
      <>
        <strong>No API key on the server.</strong> Add <code>ANTHROPIC_API_KEY=your-key</code> to <code>.env.local</code>{" "}
        in the project folder, restart the dev server, then retry.
      </>
    );
  } else if (error.code === "rate_limited") {
    body = (
      <>
        <strong>Too many requests.</strong> Wait a few seconds, then retry.
      </>
    );
  } else if (error.code === "refused") {
    body = (
      <>
        <strong>The interviewer declined to respond.</strong> Try rephrasing your answer. {error.message}
      </>
    );
  }
  return (
    <div className={styles.banner} role="alert">
      <div className={styles.bannerText}>{body}</div>
      <div className="row" style={{ gap: 8 }}>
        {onRetry && (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Retry
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onDismiss} aria-label="Dismiss error">
          Dismiss
        </button>
      </div>
    </div>
  );
}
