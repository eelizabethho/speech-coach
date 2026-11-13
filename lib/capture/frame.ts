/**
 * Screen-frame capture helpers. Browser-only at call time, but safe to import
 * during SSR (nothing touches `window`/`document` at module scope).
 */

/** Minimal typing for the ImageCapture API (not in TS's DOM lib everywhere). */
interface ImageCaptureLike {
  grabFrame(): Promise<ImageBitmap>;
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

/** True only where the page can call getDisplayMedia (desktop browsers; not iOS/Android). */
export function isScreenShareSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

// One hidden <video> per stream so repeated captures don't re-negotiate playback.
const videoCache = new WeakMap<MediaStream, HTMLVideoElement>();
let sharedCanvas: HTMLCanvasElement | null = null;

function liveVideoTrack(stream: MediaStream): MediaStreamTrack | null {
  return stream.getVideoTracks().find((t) => t.readyState === "live") ?? null;
}

async function videoFor(stream: MediaStream): Promise<HTMLVideoElement | null> {
  let video = videoCache.get(stream);
  if (!video) {
    video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    videoCache.set(stream, video);
  }
  if (video.paused) {
    try {
      await video.play();
    } catch {
      /* autoplay of a muted element should succeed; draw whatever we have */
    }
  }
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) {
    const ready = await new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer);
        video!.removeEventListener("loadeddata", onData);
        resolve(ok);
      };
      const onData = () => done(true);
      const timer = setTimeout(() => done(video!.videoWidth > 0), 1500);
      video!.addEventListener("loadeddata", onData);
    });
    if (!ready) return null;
  }
  return video;
}

function encode(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxWidth: number,
  quality: number,
): string | null {
  if (!srcW || !srcH) return null;
  const scale = Math.min(1, maxWidth / srcW);
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  sharedCanvas ??= document.createElement("canvas");
  sharedCanvas.width = w;
  sharedCanvas.height = h;
  const ctx = sharedCanvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  const url = sharedCanvas.toDataURL("image/jpeg", quality);
  const comma = url.indexOf(",");
  return comma >= 0 ? url.slice(comma + 1) : null;
}

/**
 * Grab the current frame of `stream` as a base64 JPEG (no `data:` prefix),
 * scaled to at most `maxWidth` px wide. Resolves null if there's no live video.
 */
export async function captureFrame(
  stream: MediaStream,
  maxWidth = 1280,
  quality = 0.7,
): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const track = liveVideoTrack(stream);
  if (!track) return null;

  const IC = (globalThis as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
  if (IC) {
    try {
      const bitmap = await new IC(track).grabFrame();
      try {
        return encode(bitmap, bitmap.width, bitmap.height, maxWidth, quality);
      } finally {
        bitmap.close();
      }
    } catch {
      /* grabFrame can reject (e.g. tab backgrounded) — fall back to <video> */
    }
  }

  try {
    const video = await videoFor(stream);
    if (!video || !liveVideoTrack(stream)) return null;
    return encode(video, video.videoWidth, video.videoHeight, maxWidth, quality);
  } catch {
    return null;
  }
}

/**
 * Cheap heuristic: has the screen meaningfully changed between two captures?
 * Compares lengths, then samples characters. JPEG output for an identical
 * frame is byte-identical, and most visual changes shift the encoded bytes,
 * so this catches real changes without decoding. Use it to skip re-sending
 * an unchanged screenshot.
 */
export function framesDiffer(a: string | null, b: string | null): boolean {
  if (a === b) return false;
  if (!a || !b) return true;
  const longer = Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) / longer > 0.005) return true;

  const samples = 256;
  const len = Math.min(a.length, b.length);
  const step = Math.max(1, Math.floor(len / samples));
  let mismatches = 0;
  let checked = 0;
  for (let i = 0; i < len; i += step) {
    checked++;
    if (a.charCodeAt(i) !== b.charCodeAt(i)) mismatches++;
  }
  return checked === 0 || mismatches / checked > 0.05;
}
