"use client";
// STUB — owned by Agent B (voice). Replace with real implementation.
import type { SpeakerController, VoiceMode } from "@/lib/types";

export function useSpeaker(_mode: VoiceMode): SpeakerController {
  return {
    supported: false,
    speaking: false,
    usingCloud: false,
    feed: () => {},
    flush: () => {},
    say: () => {},
    cancel: () => {},
    muted: false,
    setMuted: () => {},
  };
}
