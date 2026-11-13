"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScreenShareProps } from "@/lib/types";
import { isScreenShareSupported } from "@/lib/capture/frame";
import styles from "./capture.module.css";

function describeError(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "AbortError":
      return "Screen sharing was cancelled or blocked. Click “Share screen” to try again.";
    case "NotFoundError":
      return "No screen or window was available to share.";
    case "NotReadableError":
      return "Your screen couldn't be captured — another app may be blocking it.";
    default:
      return "Couldn't start screen sharing. Please try again.";
  }
}

export default function ScreenShare({ onStreamChange, compact = false }: ScreenShareProps) {
  // null = not yet known (SSR / first render) — avoids a hydration mismatch.
  const [supported, setSupported] = useState<boolean | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onChangeRef = useRef(onStreamChange);
  onChangeRef.current = onStreamChange;

  useEffect(() => setSupported(isScreenShareSupported()), []);

  const stop = useCallback(() => {
    const s = streamRef.current;
    if (!s) return;
    streamRef.current = null;
    s.getTracks().forEach((t) => t.stop());
    setStream(null);
    onChangeRef.current(null);
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current || starting) return;
    setError(null);
    setStarting(true);
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
      });
      // Fires when the user clicks the browser's own "Stop sharing" bar.
      s.getVideoTracks().forEach((t) =>
        t.addEventListener("ended", () => {
          if (streamRef.current === s) stop();
        }),
      );
      streamRef.current = s;
      setStream(s);
      onChangeRef.current(s);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setStarting(false);
    }
  }, [starting, stop]);

  // Attach the stream to the preview element.
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  // Release the capture if the component goes away mid-share.
  useEffect(() => stop, [stop]);

  if (supported === null) return <div className={styles.shareBox} aria-hidden />;

  if (!supported) {
    return (
      <p className={`panel muted small ${styles.note}`}>
        Screen sharing isn&apos;t available on this device — use the code panel to show your work.
      </p>
    );
  }

  return (
    <div className={`panel ${styles.shareBox}`}>
      <div className={styles.shareHeader}>
        {stream ? (
          <>
            <span className="chip" role="status">
              <span className={`${styles.liveDot} pulse`} aria-hidden />
              Sharing
            </span>
            <span className="spacer" />
            <button type="button" className="btn" onClick={stop}>
              Stop sharing
            </button>
          </>
        ) : (
          <>
            <span className="small muted">Let the interviewer see your screen.</span>
            <span className="spacer" />
            <button type="button" className="btn btn-primary" onClick={start} disabled={starting}>
              {starting ? "Choosing…" : "Share screen"}
            </button>
          </>
        )}
      </div>

      {stream && (
        <video
          ref={videoRef}
          className={`${styles.preview} ${compact ? styles.previewCompact : ""}`}
          autoPlay
          muted
          playsInline
          aria-label="Preview of your shared screen"
        />
      )}

      {error && (
        <p className={`small ${styles.error}`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
