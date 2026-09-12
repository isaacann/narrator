"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Pause, Play, Square } from "lucide-react";
import type { ToastData } from "./Toast";

export type BrowserSpeechHandle = {
  speak: () => void;
};

type Props = {
  text: string;
  voice: SpeechSynthesisVoice | null;
  rate: number;
  onNotify: (toast: ToastData) => void;
  ref?: Ref<BrowserSpeechHandle>;
};

type Status = "idle" | "speaking" | "paused";

/**
 * Zero-config playback path: reads the text aloud with the browser's own
 * speech engine (no mp3 to scrub or download, so just transport controls).
 */
export default function BrowserSpeechPanel({
  text,
  voice,
  rate,
  onNotify,
  ref,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  // Each generation invalidates the onend/onerror handlers of the previous one,
  // so a cancel() or unmount never leaves stale state behind.
  const genRef = useRef(0);

  useEffect(() => {
    return () => {
      genRef.current++;
      window.speechSynthesis?.cancel();
    };
  }, []);

  const speak = () => {
    if (!("speechSynthesis" in window)) {
      onNotify({
        type: "error",
        message:
          "This browser does not support the Web Speech API. Try Chrome, Edge, or Safari.",
      });
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      onNotify({ type: "info", message: "Type or paste some text first." });
      return;
    }
    window.speechSynthesis.cancel();
    const gen = ++genRef.current;
    const utterance = new SpeechSynthesisUtterance(trimmed);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = rate;
    utterance.onend = () => {
      if (genRef.current === gen) setStatus("idle");
    };
    utterance.onerror = (event) => {
      if (genRef.current !== gen) return;
      setStatus("idle");
      if (event.error !== "interrupted" && event.error !== "canceled") {
        onNotify({
          type: "error",
          message: `Browser speech failed: ${event.error}`,
        });
      }
    };
    setStatus("speaking");
    window.speechSynthesis.speak(utterance);
  };

  useImperativeHandle(ref, () => ({ speak }));

  const pauseOrResume = () => {
    try {
      if (status === "paused") {
        window.speechSynthesis.resume();
        setStatus("speaking");
      } else {
        window.speechSynthesis.pause();
        setStatus("paused");
      }
    } catch {
      onNotify({
        type: "info",
        message: "Pause is not supported for browser speech on this device.",
      });
    }
  };

  const stop = () => {
    genRef.current++;
    window.speechSynthesis?.cancel();
    setStatus("idle");
  };

  const busy = status !== "idle";

  return (
    <section
      aria-label="Browser speech controls"
      className="rise-in rounded-2xl border border-stone-200 bg-stone-50 p-3"
    >
      {/* All three transport controls share one row at every width. */}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={speak}
          aria-label={busy ? "Restart speech" : "Speak"}
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-xs font-medium text-white shadow-sm transition hover:bg-stone-700 active:scale-95"
        >
          <Play className="h-3.5 w-3.5" aria-hidden />
          {busy ? "Restart" : "Speak"}
        </button>
        <button
          type="button"
          onClick={pauseOrResume}
          disabled={!busy}
          aria-label={status === "paused" ? "Resume" : "Pause"}
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white text-xs font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:text-stone-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:text-stone-700"
        >
          {status === "paused" ? (
            <Play className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Pause className="h-3.5 w-3.5" aria-hidden />
          )}
          {status === "paused" ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!busy}
          aria-label="Stop"
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white text-xs font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:text-stone-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:text-stone-700"
        >
          <Square className="h-3.5 w-3.5" aria-hidden />
          Stop
        </button>
      </div>
    </section>
  );
}
