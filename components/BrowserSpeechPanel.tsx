"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Pause, Play, Square } from "lucide-react";
import type { SentenceRange } from "@/lib/sentences";
import type { ToastData } from "./Toast";

export type BrowserSpeechHandle = {
  speak: () => void;
};

/** Which sentence is being spoken right now, and whether speech is running. */
export type ReadAlongState = { active: number | null; speaking: boolean };

type Props = {
  /** Raw text — the same string `sentences` index into. */
  text: string;
  sentences: SentenceRange[];
  voice: SpeechSynthesisVoice | null;
  rate: number;
  onNotify: (toast: ToastData) => void;
  onReadAlong?: (state: ReadAlongState) => void;
  ref?: Ref<BrowserSpeechHandle>;
};

type Status = "idle" | "speaking" | "paused";

/**
 * Zero-config playback path: reads the text aloud with the browser's own
 * speech engine (no mp3 to scrub or download, so just transport controls).
 */
export default function BrowserSpeechPanel({
  text,
  sentences,
  voice,
  rate,
  onNotify,
  onReadAlong,
  ref,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  // Each generation invalidates the handlers of the previous one, so a cancel()
  // or unmount never leaves stale state behind.
  const genRef = useRef(0);
  // Held in a ref so the unmount cleanup can notify without re-running.
  const readAlongRef = useRef(onReadAlong);
  readAlongRef.current = onReadAlong;
  // Set once the first sentence starts, so the watchdog below can tell a
  // stalled queue from an engine that simply hasn't begun yet.
  const startedRef = useRef(false);

  const settle = () => {
    genRef.current++;
    window.speechSynthesis?.cancel();
    startedRef.current = false;
    setStatus("idle");
    readAlongRef.current?.({ active: null, speaking: false });
  };

  useEffect(() => {
    return () => {
      genRef.current++;
      window.speechSynthesis?.cancel();
      readAlongRef.current?.({ active: null, speaking: false });
    };
  }, []);

  /**
   * Watchdog for dropped `onend` events.
   *
   * Speech is queued as many utterances, so there are many chances for one to
   * never report back. Without this the session would sit in "speaking"
   * forever — and because the read-along overlay makes the textarea's text
   * transparent, that leaves the user unable to read their own text.
   */
  useEffect(() => {
    if (status !== "speaking") return;
    const synth = window.speechSynthesis;
    if (!synth) return;

    let quietTicks = 0;
    const id = setInterval(() => {
      if (!startedRef.current) return;
      if (synth.speaking || synth.pending) {
        quietTicks = 0;
        return;
      }
      quietTicks += 1;
      if (quietTicks >= 2) settle();
    }, 600);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  /**
   * Speak one utterance per sentence and report progress from each `onstart`.
   *
   * This deliberately avoids the `boundary` event. Boundary position data is
   * unreliable — Chrome's own implementation is flagged partial, and its
   * network voices (including "Google UK English Male") never fire it at all —
   * whereas `onstart` fires for every utterance on every engine. Queuing a
   * separate utterance per sentence therefore gives exact sentence tracking on
   * any voice, at the cost of a brief pause at each sentence break.
   */
  const speak = () => {
    if (!("speechSynthesis" in window)) {
      onNotify({
        type: "error",
        message:
          "This browser does not support the Web Speech API. Try Chrome, Edge, or Safari.",
      });
      return;
    }

    // Whitespace-only segments would speak as silence; skip them but keep the
    // original index so the highlight still lines up with `sentences`.
    const speakable = sentences
      .map((range, index) => ({ range, index }))
      .filter(({ range }) => text.slice(range.start, range.end).trim().length > 0);

    if (speakable.length === 0) {
      onNotify({ type: "info", message: "Type or paste some text first." });
      return;
    }

    window.speechSynthesis.cancel();
    const gen = ++genRef.current;
    setStatus("speaking");
    // Report speaking up front so the read-along view can swap in before the
    // first sentence starts, rather than flashing mid-sentence.
    onReadAlong?.({ active: null, speaking: true });

    let finished = 0;
    const finishOne = () => {
      if (genRef.current !== gen) return;
      finished += 1;
      // Only settle once every utterance has reported in — a mid-queue error
      // must not make the UI look idle while audio is still playing.
      if (finished >= speakable.length) {
        setStatus("idle");
        onReadAlong?.({ active: null, speaking: false });
      }
    };

    try {
      for (const { range, index } of speakable) {
        const utterance = new SpeechSynthesisUtterance(
          text.slice(range.start, range.end).trim(),
        );
        if (voice) {
          utterance.voice = voice;
          utterance.lang = voice.lang;
        }
        utterance.rate = rate;

        utterance.onstart = () => {
          if (genRef.current !== gen) return;
          startedRef.current = true;
          onReadAlong?.({ active: index, speaking: true });
        };
        utterance.onend = finishOne;
        utterance.onerror = (event) => {
          if (genRef.current !== gen) return;
          if (event.error === "interrupted" || event.error === "canceled") return;
          onNotify({
            type: "error",
            message: `Browser speech failed: ${event.error}`,
          });
          finishOne();
        };

        window.speechSynthesis.speak(utterance);
      }
    } catch (error) {
      // Queuing can throw part-way (an invalidated voice, a rejected rate).
      // Without this the UI stays wedged in "speaking" with the read-along
      // overlay stuck on, and only Stop would clear it.
      genRef.current++;
      setStatus("idle");
      onReadAlong?.({ active: null, speaking: false });
      onNotify({
        type: "error",
        message: `Could not start browser speech: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
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
    onReadAlong?.({ active: null, speaking: false });
  };

  /**
   * One button for play and pause. From a stopped state there is nothing to
   * resume, so it starts the whole passage again from the top.
   */
  const playPause = () => {
    if (status === "idle") {
      speak();
      return;
    }
    pauseOrResume();
  };

  const busy = status !== "idle";

  return (
    <section
      aria-label="Browser speech controls"
      className="rise-in rounded-2xl border border-stone-200 bg-stone-50 p-3"
    >
      {/* Two transport controls, sharing one row at every width. */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={playPause}
          aria-label={status === "speaking" ? "Pause" : "Play"}
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-xs font-medium text-white shadow-sm transition hover:bg-stone-700 active:scale-95"
        >
          {status === "speaking" ? (
            <Pause className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Play className="h-3.5 w-3.5" aria-hidden />
          )}
          {status === "speaking" ? "Pause" : "Play"}
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
