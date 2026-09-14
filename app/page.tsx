"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ClipboardPaste, Info, Trash2 } from "lucide-react";
import BrowserSpeechPanel, {
  type BrowserSpeechHandle,
  type ReadAlongState,
} from "@/components/BrowserSpeechPanel";
import { splitSentences } from "@/lib/sentences";
import Toast, { type ToastData } from "@/components/Toast";
import VoiceSelector from "@/components/VoiceSelector";
import { SPEED_DEFAULT, SPEED_OPTIONS, type Voice } from "@/lib/voices";

// Chrome ships this voice on desktop; prefer it as the browser-mode default.
const PREFERRED_BROWSER_VOICE = "Google UK English Male";

export default function Home() {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState("");
  const [systemVoice, setSystemVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [text, setText] = useState("");
  const [speed, setSpeed] = useState(SPEED_DEFAULT);
  const [readAlong, setReadAlong] = useState<ReadAlongState>({
    active: null,
    speaking: false,
  });
  // True while an IME is mid-composition. Uncommitted candidates live only
  // inside the textarea, so the mirror would render blind without this.
  const [composing, setComposing] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);

  const speechPanelRef = useRef<BrowserSpeechHandle>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (next: ToastData) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  };

  // Enumerate system voices (loads async on most browsers). This is the app's
  // only engine — the hosted providers need API keys and are switched off.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const load = () => {
      const all = synth.getVoices();
      if (!all.length) return;
      // Prioritize English + Mandarin voices for this app's core use case.
      const preferred = all.filter((v) => /^(en|zh)/i.test(v.lang));
      const pool = preferred.length > 0 ? preferred : all;
      // First pick, or the fallback when this browser doesn't ship that voice.
      const fallback =
        pool.find(
          (v) =>
            v.name.toLowerCase() === PREFERRED_BROWSER_VOICE.toLowerCase(),
        ) ??
        pool[0] ??
        null;
      setSystemVoice(
        (prev) => pool.find((v) => v.voiceURI === prev?.voiceURI) ?? fallback,
      );
      setVoices(
        pool.map((v) => ({
          id: v.voiceURI,
          name: v.name,
          // System voices carry no blurb; the hosted providers supply their own.
          description: "",
        })),
      );
      setVoice((prev) =>
        pool.some((v) => v.voiceURI === prev) ? prev : fallback?.voiceURI ?? "",
      );
    };
    load();
    synth.addEventListener("voiceschanged", load);
    return () => synth.removeEventListener("voiceschanged", load);
  }, []);

  // Auto-resize the textarea with the content (capped so long text scrolls).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 1152)}px`;
  }, [text]);

  // Split once per edit; the same ranges drive both what is spoken and what
  // is highlighted, so they cannot disagree about sentence positions.
  const sentences = useMemo(() => splitSentences(text), [text]);
  const activeSentence =
    readAlong.speaking &&
    readAlong.active !== null &&
    readAlong.active < sentences.length
      ? readAlong.active
      : null;
  // The mirror only replaces the visible text while speech is running, so the
  // editing experience is never affected by a metrics mismatch. It also stands
  // down during IME composition, whose uncommitted candidates exist only
  // inside the textarea and would otherwise be typed blind.
  const showMirror = readAlong.speaking && text.length > 0 && !composing;

  // Pick up wherever the textarea is already scrolled to when the mirror
  // appears. Keyed on showMirror rather than done in a ref callback, which
  // would re-run on every highlight change.
  useLayoutEffect(() => {
    if (!showMirror) return;
    const mirror = mirrorRef.current;
    const textarea = textareaRef.current;
    if (mirror && textarea) mirror.scrollTop = textarea.scrollTop;
  }, [showMirror]);

  // Follow the spoken sentence. Without this the highlight runs off the bottom
  // of a long text and the feature looks broken. The mirror's nth child is the
  // nth sentence, so its offsetTop is already in scroll coordinates.
  useLayoutEffect(() => {
    if (!showMirror || activeSentence === null) return;
    const mirror = mirrorRef.current;
    const textarea = textareaRef.current;
    const span = mirror?.children[activeSentence] as HTMLElement | undefined;
    if (!mirror || !textarea || !span) return;

    const top = span.offsetTop;
    const bottom = top + span.offsetHeight;
    const viewTop = textarea.scrollTop;
    const viewBottom = viewTop + textarea.clientHeight;
    if (top < viewTop + 8 || bottom > viewBottom - 8) {
      // Instant, not smooth — the highlight advances every few seconds and a
      // smooth scroll would still be animating when the next one arrives.
      textarea.scrollTop = Math.max(0, top - textarea.clientHeight / 3);
    }
  }, [activeSentence, showMirror]);

  const voiceCount = voices.length;

  const selectVoice = (id: string) => {
    setVoice(id);
    setSystemVoice(
      window.speechSynthesis?.getVoices().find((v) => v.voiceURI === id) ?? null,
    );
  };

  const speak = () => {
    speechPanelRef.current?.speak();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      speak();
    }
  };

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[82rem] flex-col px-4 py-10 sm:py-14">
      {/*
        Two columns from `lg` up: the passage on the left, controls pinned to
        the right. With a long passage the page scrolls, and a sticky side card
        keeps voice, speed and transport reachable without scrolling back up.
        Below `lg` it collapses to one column with the controls underneath.
      */}
      <div className="grid flex-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-xl shadow-stone-900/5 sm:p-7">
        <div className="rounded-2xl border border-stone-200 bg-stone-50 transition focus-within:border-amber-600/50 focus-within:ring-2 focus-within:ring-amber-600/15">
          {/*
            The mirror is scoped to this inner box rather than the whole card,
            so `inset-0` matches the textarea exactly — the footer row below
            would otherwise add ~17px and knock the two out of step at the
            bottom of a long scroll.
          */}
          <div className="relative">
            {/*
              Read-along mirror. While speech runs, this absolutely-positioned
              layer paints the text and the textarea's own text goes
              transparent, so the highlight can move behind the words.
              Typography and box metrics must match the textarea exactly or the
              two drift apart. It is only mounted while speaking, so editing is
              never affected by any mismatch.
            */}
            {showMirror && (
              <div
                ref={mirrorRef}
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-4 py-3.5 text-[15px] leading-relaxed text-stone-800 [scrollbar-gutter:stable]"
              >
                {sentences.length === 0 ? (
                  text
                ) : (
                  sentences.map((range, index) => (
                    <span
                      key={range.start}
                      className={
                        index === activeSentence
                          ? "rounded-sm bg-amber-300/60 box-decoration-clone transition-colors duration-150"
                          : undefined
                      }
                    >
                      {text.slice(range.start, range.end)}
                    </span>
                  ))
                )}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onScroll={(e) => {
                // The textarea scrolls internally past its height cap; keep the
                // mirror's viewport locked to it.
                if (mirrorRef.current) {
                  mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
                }
              }}
              placeholder=""
              spellCheck={false}
              aria-label="Text to convert to speech"
              className={`relative z-10 block min-h-[20rem] w-full resize-none overflow-y-auto bg-transparent px-4 py-3.5 text-[15px] leading-relaxed caret-stone-800 selection:bg-amber-600/15 [scrollbar-gutter:stable] placeholder:text-stone-400 focus:outline-none ${
                showMirror ? "text-transparent" : "text-stone-800"
              }`}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 px-3 py-2">
            <div className="flex items-center gap-1">
              {/* <button
                type="button"
                onClick={clearText}
                disabled={!text}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-200/70 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Clear
              </button> */}
              {/* <button
                type="button"
                onClick={() => void pasteFromClipboard()}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-stone-200/70 hover:text-stone-900"
              >
                <ClipboardPaste className="h-3.5 w-3.5" aria-hidden />
                Paste from Clipboard
              </button> */}
            </div>
            {/* <p
              className={`font-mono text-xs tabular-nums ${
                overLimit ? "font-semibold text-red-600" : "text-stone-400"
              }`}
            >
              {text.length.toLocaleString()}
              {maxChars ? ` / ${maxChars.toLocaleString()}` : ""} chars ·{" "}
              {countWords(text).toLocaleString()} words
            </p> */}
          </div>
        </div>

      </section>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-8">
        <div className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-xl shadow-stone-900/5">
          <VoiceSelector
            voices={voices}
            value={voice}
            onChange={selectVoice}
            disabled={voiceCount === 0}
          />

          <div
            role="radiogroup"
            aria-label="Speech rate"
            className="mt-5 grid min-w-0 grid-cols-4 gap-1.5"
          >
            {SPEED_OPTIONS.map((option) => {
              const active = speed === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSpeed(option)}
                  className={`flex h-[42px] items-center justify-center rounded-xl text-xs font-medium shadow-sm transition active:scale-95 ${
                    active
                      ? "border border-stone-900 bg-stone-900 text-white"
                      : "border border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:text-stone-900"
                  }`}
                >
                  {option.toFixed(2).replace(/0$/, "")}×
                </button>
              );
            })}
          </div>

        </div>

        {/* The transport card carries its own Play button, so there is no
            separate "generate" CTA in this mode. */}
        <BrowserSpeechPanel
          ref={speechPanelRef}
          text={text}
          sentences={sentences}
          voice={systemVoice}
          rate={speed}
          onNotify={showToast}
          onReadAlong={setReadAlong}
        />
      </aside>
      </div>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </main>
  );
}
