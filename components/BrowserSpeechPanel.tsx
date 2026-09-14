"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { FastForward, Pause, Play, Rewind, Square } from "lucide-react";
import type { SentenceRange } from "@/lib/sentences";
import { countWords } from "@/lib/voices";
import type { ToastData } from "./Toast";

/** Seconds moved by the back/forward skip buttons. */
const SKIP_SECONDS = 5;

/**
 * Speaking-rate model, used only to guess how long a sentence we have NOT
 * heard yet will take. Web Speech reports no timing of any kind, so there is
 * nothing to measure for sentences still in the queue. Words-or-CJK-chars per
 * minute at rate 1 is a coarse stand-in for the engines' own pacing; it only
 * has to be close enough for a 5-second skip to land on a sensible sentence.
 */
const UNITS_PER_MINUTE = 180;

function estimateSeconds(sentence: string, rate: number): number {
  return ((countWords(sentence) / UNITS_PER_MINUTE) * 60) / rate;
}

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
  // Wall-clock start of each sentence, keyed by its index in `sentences`. This
  // is the only real timing the panel can get, and it is what makes "back 5s"
  // land on the sentence the user actually heard 5 seconds ago. Entries are
  // overwritten whenever a sentence is spoken again after a jump, and stale
  // entries for skipped-over sentences are never consulted (backward only ever
  // looks at sentences at or before the active one).
  const startTimesRef = useRef<Record<number, number>>({});
  // When paused, timestamps stop meaning "listening time"; resuming shifts them
  // all forward by the pause so a long pause doesn't inflate every skip.
  const pausedAtRef = useRef<number | null>(null);
  // The sentence currently being spoken, for the skip maths. Mirrors the
  // read-along state, held in a ref so the handlers stay stable.
  const activeIndexRef = useRef<number | null>(null);

  const settle = () => {
    genRef.current++;
    window.speechSynthesis?.cancel();
    startedRef.current = false;
    activeIndexRef.current = null;
    startTimesRef.current = {};
    pausedAtRef.current = null;
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
  /**
   * Whitespace-only segments would speak as silence; skip them but keep the
   * original index so the highlight still lines up with `sentences`.
   */
  const speakableSentences = () =>
    sentences
      .map((range, index) => ({ range, index }))
      .filter(({ range }) => text.slice(range.start, range.end).trim().length > 0);

  /**
   * Speak the passage from `fromIndex` (an index into `sentences`) onwards.
   *
   * Everything already spoken is dropped rather than re-queued, which is what
   * lets the skip buttons jump: `cancel()` clears the engine's queue, and a new
   * generation id invalidates the old handlers.
   */
  const speakFrom = (fromIndex: number) => {
    if (!("speechSynthesis" in window)) {
      onNotify({
        type: "error",
        message:
          "This browser does not support the Web Speech API. Try Chrome, Edge, or Safari.",
      });
      return;
    }

    const queue = speakableSentences().filter(({ index }) => index >= fromIndex);

    if (queue.length === 0) {
      onNotify({ type: "info", message: "Type or paste some text first." });
      return;
    }

    window.speechSynthesis.cancel();
    const gen = ++genRef.current;
    setStatus("speaking");
    // A jump resumes from wherever it landed, so any pause is over.
    pausedAtRef.current = null;
    // Report speaking up front so the read-along view can swap in before the
    // first sentence starts, rather than flashing mid-sentence.
    onReadAlong?.({ active: null, speaking: true });

    let finished = 0;
    const finishOne = () => {
      if (genRef.current !== gen) return;
      finished += 1;
      // Only settle once every utterance has reported in — a mid-queue error
      // must not make the UI look idle while audio is still playing.
      if (finished >= queue.length) {
        setStatus("idle");
        activeIndexRef.current = null;
        onReadAlong?.({ active: null, speaking: false });
      }
    };

    try {
      for (const { range, index } of queue) {
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
          startTimesRef.current[index] = performance.now();
          activeIndexRef.current = index;
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

  useImperativeHandle(ref, () => ({ speak: () => speakFrom(0) }));

  const pauseOrResume = () => {
    try {
      if (status === "paused") {
        // Shifting the recorded timeline forward by the pause keeps "elapsed"
        // meaning listening time — otherwise a two-minute pause would make the
        // next "back 5s" jump two minutes.
        if (pausedAtRef.current !== null) {
          const pause = performance.now() - pausedAtRef.current;
          for (const key of Object.keys(startTimesRef.current)) {
            startTimesRef.current[Number(key)] += pause;
          }
          pausedAtRef.current = null;
        }
        window.speechSynthesis.resume();
        setStatus("speaking");
      } else {
        window.speechSynthesis.pause();
        pausedAtRef.current = performance.now();
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
    activeIndexRef.current = null;
    startTimesRef.current = {};
    pausedAtRef.current = null;
    setStatus("idle");
    onReadAlong?.({ active: null, speaking: false });
  };

  /**
   * Move roughly `SKIP_SECONDS` of listening time and resume speaking there.
   *
   * Web Speech has no timeline and cannot seek inside an utterance, so a skip
   * can only land on a sentence boundary — the queue is rebuilt from the target
   * sentence. The two directions are therefore measured differently:
   *
   * - Backwards uses the real start timestamps of sentences already heard, so
   *   the target is the sentence that began closest to 5 seconds ago. Exact.
   * - Forwards has nothing to measure, so it sums the rate-based estimate for
   *   the rest of the current sentence and the ones after it. Approximate.
   *
   * A sentence longer than the whole skip can't be split, so a jump may
   * overshoot in either direction rather than landing mid-sentence.
   */
  const skip = (deltaSeconds: number) => {
    const active = activeIndexRef.current;
    if (active === null) return;

    const queue = speakableSentences();
    if (queue.length === 0) return;
    const last = queue[queue.length - 1].index;

    let target: number;

    if (deltaSeconds < 0) {
      const want = -deltaSeconds;
      const now = performance.now();
      // The latest sentence that began at least `want` seconds ago — that is
      // the closest we can get to `want` without passing it.
      target = queue[0].index;
      for (const { index } of queue) {
        if (index > active) break;
        const startedAt = startTimesRef.current[index];
        if (startedAt !== undefined && now - startedAt >= want * 1000) {
          target = index;
        }
      }
    } else {
      const remaining = Math.max(
        0,
        estimateSeconds(
          text.slice(
            sentences[active].start,
            sentences[active].end,
          ),
          rate,
        ) - (performance.now() - (startTimesRef.current[active] ?? performance.now())) / 1000,
      );
      let acc = remaining;
      let cursor = active;
      while (acc < deltaSeconds && cursor < last) {
        cursor = queue.find((s) => s.index > cursor)?.index ?? last;
        acc += estimateSeconds(text.slice(sentences[cursor].start, sentences[cursor].end), rate);
      }
      // Never a no-op: the current sentence can't be resumed part-way, so at
      // minimum step to the next one.
      target = cursor === active ? (queue.find((s) => s.index > active)?.index ?? active) : cursor;
    }

    speakFrom(target);
  };

  /**
   * One button for play and pause. From a stopped state there is nothing to
   * resume, so it starts the whole passage again from the top.
   */
  const playPause = () => {
    if (status === "idle") {
      speakFrom(0);
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
      {/* Transport: play/stop on top, the two skips beneath. */}
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
        <button
          type="button"
          onClick={() => skip(-SKIP_SECONDS)}
          disabled={!busy}
          aria-label={`Back ${SKIP_SECONDS} seconds`}
          title={`Back ${SKIP_SECONDS}s`}
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white text-xs font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:text-stone-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:text-stone-700"
        >
          <Rewind className="h-3.5 w-3.5" aria-hidden />
          {SKIP_SECONDS}s
        </button>
        <button
          type="button"
          onClick={() => skip(SKIP_SECONDS)}
          disabled={!busy}
          aria-label={`Forward ${SKIP_SECONDS} seconds`}
          title={`Forward ${SKIP_SECONDS}s`}
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white text-xs font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:text-stone-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:text-stone-700"
        >
          <FastForward className="h-3.5 w-3.5" aria-hidden />
          {SKIP_SECONDS}s
        </button>
      </div>
    </section>
  );
}
