"use client";
// STUB — owned by Agent B (voice). Replace with real implementation.
import type { SpeechController, SpeechOptions } from "@/lib/types";

export function useSpeechRecognition(_opts: SpeechOptions): SpeechController {
  return {
    supported: false,
    listening: false,
    transcript: "",
    start: () => {},
    stop: () => {},
    cancel: () => {},
    error: null,
  };
}
