"use client";
/**
 * Gemini Live speech-to-speech session for the interview room: streams the mic
 * to Gemini, plays its voice back, and turns both transcripts into Turns.
 * Gemini decides turn-taking itself (voice activity detection + proactive
 * audio), so a thinking pause doesn't make it jump in.
 */
import { GoogleGenAI, type LiveServerMessage, type Session } from "@google/genai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InterviewConfig, LiveTokenResponse, TurnRole } from "@/lib/types";

const IN_RATE = 16000; // Gemini wants 16-bit PCM at 16kHz in...
const OUT_RATE = 24000; // ...and sends 16-bit PCM at 24kHz back.
const MAX_RECONNECTS = 3;
const JOIN_NOTE = "[The candidate has joined the call. Begin the interview.]";

// Buffers 100ms of mic audio as 16-bit PCM and posts it to the main thread.
const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(${IN_RATE / 10}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
        this.buf = new Int16Array(${IN_RATE / 10});
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm16", Pcm16);`;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface LiveController {
  connected: boolean;
  micOn: boolean;
  speaking: boolean;
  muted: boolean;
  /** What the candidate is saying right now (not yet a turn). */
  candidateText: string;
  /** What the interviewer is saying right now (not yet a turn). */
  interviewerText: string;
  error: string | null;
  /** Call inside the Start click: audio contexts need a user gesture. */
  start: () => Promise<void>;
  /** Ends the session; flushes any half-finished turns through onTurn first. */
  stop: () => void;
  setMicOn: (on: boolean) => void;
  setMuted: (muted: boolean) => void;
  /** Text into the conversation; `respond` false = context only (code, system notes). */
  sendText: (text: string, respond: boolean) => void;
  /** A base64 JPEG of the shared screen (send at most ~1 per second). */
  sendFrame: (jpegBase64: string) => void;
}

export function useGeminiLive(config: InterviewConfig, onTurn: (role: TurnRole, text: string) => void): LiveController {
  const [connected, setConnected] = useState(false);
  const [micOn, setMicOnState] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [candidateText, setCandidateText] = useState("");
  const [interviewerText, setInterviewerText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onTurnRef = useRef(onTurn);
  onTurnRef.current = onTurn;
  const configRef = useRef(config);
  configRef.current = config;

  const sessionRef = useRef<Session | null>(null);
  const genRef = useRef(0); // which connection is current; stale callbacks are ignored
  const handleRef = useRef<string | undefined>(undefined);
  const stoppedRef = useRef(true);
  const reconnectsRef = useRef(0);
  const micOnRef = useRef(true);

  const micStreamRef = useRef<MediaStream | null>(null);
  const inCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const playheadRef = useRef(0);

  const candRef = useRef("");
  const interRef = useRef("");

  const flushCandidate = () => {
    const t = candRef.current.trim();
    candRef.current = "";
    setCandidateText("");
    if (t) onTurnRef.current("candidate", t);
  };
  const flushInterviewer = (suffix = "") => {
    flushCandidate(); // late input transcription belongs before this reply
    const t = interRef.current.trim();
    interRef.current = "";
    setInterviewerText("");
    if (t) onTurnRef.current("interviewer", t + suffix);
  };

  const stopPlayback = () => {
    sourcesRef.current.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    });
    sourcesRef.current.clear();
    playheadRef.current = 0;
    setSpeaking(false);
  };

  const play = (b64: string) => {
    const ctx = outCtxRef.current;
    const gain = gainRef.current;
    if (!ctx || !gain) return;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
    if (!pcm.length) return;
    const buf = ctx.createBuffer(1, pcm.length, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    const at = Math.max(ctx.currentTime, playheadRef.current);
    src.start(at);
    playheadRef.current = at + buf.duration;
    sourcesRef.current.add(src);
    setSpeaking(true);
    src.onended = () => {
      sourcesRef.current.delete(src);
      if (!sourcesRef.current.size) setSpeaking(false);
    };
  };

  const onMessage = (m: LiveServerMessage) => {
    const upd = m.sessionResumptionUpdate;
    if (upd?.resumable && upd.newHandle) handleRef.current = upd.newHandle;
    if (m.goAway) void connectRef.current(); // server is about to drop this connection
    const sc = m.serverContent;
    if (!sc) return;

    const heard = sc.inputTranscription?.text;
    if (heard) {
      candRef.current += heard;
      setCandidateText(candRef.current);
    }
    let replying = false;
    for (const part of sc.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        play(part.inlineData.data);
        replying = true;
      }
    }
    const said = sc.outputTranscription?.text;
    if (said) {
      interRef.current += said;
      setInterviewerText(interRef.current);
      replying = true;
    }
    if (replying && candRef.current.trim()) flushCandidate();
    if (sc.interrupted) {
      stopPlayback();
      flushInterviewer("…");
    }
    if (sc.turnComplete) flushInterviewer();
  };

  /** (Re)connects with a fresh token, resuming the session if we have a handle. */
  const connectRef = useRef<() => Promise<void>>(async () => {});
  connectRef.current = async () => {
    const gen = ++genRef.current;
    const old = sessionRef.current;
    sessionRef.current = null;
    try {
      const res = await fetch("/api/live-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: configRef.current }),
      });
      const data = (await res.json().catch(() => null)) as (LiveTokenResponse & { error?: string }) | null;
      if (!res.ok || !data?.token) throw new Error(data?.error ?? `Couldn't start Gemini Live (HTTP ${res.status}).`);
      const resuming = !!handleRef.current;
      const ai = new GoogleGenAI({ apiKey: data.token, httpOptions: { apiVersion: "v1beta" } });
      const session = await ai.live.connect({
        model: data.model,
        config: { ...data.config, sessionResumption: { handle: handleRef.current } },
        callbacks: {
          onmessage: (m) => {
            if (gen === genRef.current) onMessage(m);
          },
          onerror: (e) => {
            if (gen === genRef.current) setError(e.message || "Gemini Live connection error.");
          },
          onclose: () => {
            if (gen !== genRef.current || stoppedRef.current) return;
            setConnected(false);
            if (++reconnectsRef.current > MAX_RECONNECTS) {
              setError("Lost the connection to Gemini Live. End the interview to keep your transcript.");
              return;
            }
            void connectRef.current();
          },
        },
      });
      try {
        old?.close();
      } catch {
        /* already closed */
      }
      if (gen !== genRef.current || stoppedRef.current) {
        session.close();
        return;
      }
      sessionRef.current = session;
      reconnectsRef.current = 0;
      setConnected(true);
      setError(null);
      if (!resuming) session.sendClientContent({ turns: [{ role: "user", parts: [{ text: JOIN_NOTE }] }], turnComplete: true });
    } catch (e) {
      if (gen === genRef.current) setError(e instanceof Error ? e.message : "Couldn't connect to Gemini Live.");
    }
  };

  const start = useCallback(async () => {
    if (!stoppedRef.current) return;
    stoppedRef.current = false;
    handleRef.current = undefined;
    // Created synchronously inside the click so the browser allows audio.
    // shortcut: a 16kHz capture context needs Chrome/Safari (Firefox rejects mixed sample rates); resample in the worklet if Firefox matters.
    const inCtx = new AudioContext({ sampleRate: IN_RATE });
    const outCtx = new AudioContext({ sampleRate: OUT_RATE });
    const gain = outCtx.createGain();
    gain.connect(outCtx.destination);
    inCtxRef.current = inCtx;
    outCtxRef.current = outCtx;
    gainRef.current = gain;
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      micStreamRef.current = mic;
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      await inCtx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(inCtx, "pcm16");
      node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (!micOnRef.current) return;
        sessionRef.current?.sendRealtimeInput({ audio: { data: toBase64(e.data), mimeType: `audio/pcm;rate=${IN_RATE}` } });
      };
      inCtx.createMediaStreamSource(mic).connect(node);
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in the browser to talk to the interviewer."
          : `Couldn't start the microphone: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    }
    if (!stoppedRef.current) await connectRef.current();
  }, []);

  const stop = useCallback(() => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    genRef.current++;
    flushInterviewer(interRef.current.trim() ? "…" : "");
    try {
      sessionRef.current?.close();
    } catch {
      /* already closed */
    }
    sessionRef.current = null;
    stopPlayback();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    void inCtxRef.current?.close().catch(() => {});
    void outCtxRef.current?.close().catch(() => {});
    inCtxRef.current = outCtxRef.current = null;
    gainRef.current = null;
    setConnected(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => stop, [stop]);

  const setMicOn = useCallback((on: boolean) => {
    micOnRef.current = on;
    setMicOnState(on);
    if (!on) sessionRef.current?.sendRealtimeInput({ audioStreamEnd: true });
  }, []);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    if (gainRef.current) gainRef.current.gain.value = m ? 0 : 1;
  }, []);

  const sendText = useCallback((text: string, respond: boolean) => {
    sessionRef.current?.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: respond });
  }, []);

  const sendFrame = useCallback((jpegBase64: string) => {
    sessionRef.current?.sendRealtimeInput({ video: { data: jpegBase64, mimeType: "image/jpeg" } });
  }, []);

  return { connected, micOn, speaking, muted, candidateText, interviewerText, error, start, stop, setMicOn, setMuted, sendText, sendFrame };
}
