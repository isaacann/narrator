"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Download, FastForward, Pause, Play, Rewind, RotateCcw } from "lucide-react";

/** Seconds moved by the back/forward skip buttons. */
const SKIP_SECONDS = 5;

type Props = {
  src: string;
  /** Increment this number to auto-play the freshly generated clip. */
  autoPlaySignal?: number;
  voiceName: string;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AudioPlayer({
  src,
  autoPlaySignal = 0,
  voiceName,
}: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);

  // Reset whenever a new clip is loaded.
  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setReady(false);
  }, [src]);

  // Chrome reports Infinity duration for some blob mp3s until it has seeked
  // once — nudge the playhead past the end, read the real duration, rewind.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onLoadedMetadata = () => {
      if (audio.duration === Infinity) {
        const onSeekSettled = () => {
          audio.removeEventListener("timeupdate", onSeekSettled);
          setDuration(audio.duration);
          audio.currentTime = 0;
        };
        audio.addEventListener("timeupdate", onSeekSettled);
        audio.currentTime = 1e101;
      } else {
        setDuration(audio.duration);
      }
    };
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    return () => audio.removeEventListener("loadedmetadata", onLoadedMetadata);
  }, [src]);

  // Auto-play each new generation (safe: fired from a user-click chain).
  const seenSignal = useRef<number | null>(null);
  useEffect(() => {
    if (seenSignal.current === null) {
      seenSignal.current = autoPlaySignal;
      return;
    }
    if (autoPlaySignal === seenSignal.current) return;
    seenSignal.current = autoPlaySignal;
    audioRef.current?.play().catch(() => {});
  }, [autoPlaySignal, src]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  const replay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }, []);

  // Nudge the playhead by whole seconds, clamped to the clip's bounds. Read
  // the duration off the element rather than state: `duration` is still 0
  // before metadata lands, and Chrome's Infinity case must stay unclamped.
  const skip = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const end = Number.isFinite(audio.duration) ? audio.duration : Infinity;
    const next = Math.min(Math.max(audio.currentTime + delta, 0), end);
    audio.currentTime = next;
    setCurrent(next);
  }, []);

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(value)) return;
    audio.currentTime = value;
    setCurrent(value);
  };

  const progress = duration > 0 ? (current / duration) * 100 : 0;
  const fileName = `vox-${voiceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}-${new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-")}.mp3`;

  return (
    <section
      aria-label="Generated audio player"
      className="rise-in rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:p-5"
    >
      <div className="flex items-center gap-3 sm:gap-4">
        <button
          type="button"
          onClick={toggle}
          disabled={!ready}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-stone-900 text-white shadow-md transition hover:bg-stone-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {playing ? (
            <Pause className="h-5 w-5" aria-hidden />
          ) : (
            <Play className="ml-0.5 h-5 w-5" aria-hidden />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div
              className={`flex h-4 items-center gap-[3px] ${playing ? "" : "eq-paused"}`}
              aria-hidden
            >
              {[0.2, 0.55, 0.35, 0.75, 0.45].map((delay, i) => (
                <span
                  key={i}
                  style={{ animationDelay: `${-delay}s` }}
                  className="eq-bar h-full w-[3px] rounded-full bg-amber-600"
                />
              ))}
            </div>
            <span className="font-mono text-xs tabular-nums text-stone-500">
              {formatTime(Math.min(current, duration || current))} /{" "}
              {ready && Number.isFinite(duration) ? formatTime(duration) : "–:––"}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.01}
            value={Math.min(current, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            disabled={!ready}
            aria-label="Seek"
            style={
              {
                "--range-progress": `${progress}%`,
              } as CSSProperties
            }
            className="mt-2 w-full"
          />
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={replay}
            disabled={!ready}
            aria-label="Replay from start"
            title="Replay"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 shadow-sm transition hover:border-stone-300 hover:text-stone-900 active:scale-95 disabled:opacity-40"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
          </button>
          <a
            href={src}
            download={fileName}
            aria-label="Download MP3"
            title="Download MP3"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 shadow-sm transition hover:border-stone-300 hover:text-stone-900 active:scale-95"
          >
            <Download className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </div>

      {/*
        Skip row. The step is a flat 5s of audio however the clip was
        generated: the provider already baked the chosen rate into the file, so
        a second of it is a second at any speed — the same behaviour as a
        podcast player's skip buttons. Reading the rate off the speed control
        would be wrong, since changing it does not re-render the clip. Two
        equal halves keep both targets thumb-sized when the layout is narrow.
      */}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => skip(-SKIP_SECONDS)}
          disabled={!ready}
          aria-label={`Back ${SKIP_SECONDS} seconds`}
          title={`Back ${SKIP_SECONDS}s`}
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white text-stone-600 shadow-sm transition hover:border-stone-300 hover:text-stone-900 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Rewind className="h-4 w-4" aria-hidden />
          <span className="text-xs font-medium tabular-nums">
            {SKIP_SECONDS}s
          </span>
        </button>
        <button
          type="button"
          onClick={() => skip(SKIP_SECONDS)}
          disabled={!ready}
          aria-label={`Forward ${SKIP_SECONDS} seconds`}
          title={`Forward ${SKIP_SECONDS}s`}
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white text-stone-600 shadow-sm transition hover:border-stone-300 hover:text-stone-900 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <FastForward className="h-4 w-4" aria-hidden />
          <span className="text-xs font-medium tabular-nums">
            {SKIP_SECONDS}s
          </span>
        </button>
      </div>

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          if (Number.isFinite(t) && t < 100_000) setCurrent(t);
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setDuration(d);
        }}
        onCanPlay={() => setReady(true)}
        onError={() => setReady(false)}
      />
    </section>
  );
}
