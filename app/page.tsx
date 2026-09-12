"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ClipboardPaste,
  Info,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import AudioPlayer from "@/components/AudioPlayer";
import BrowserSpeechPanel, {
  type BrowserSpeechHandle,
} from "@/components/BrowserSpeechPanel";
import Toast, { type ToastData } from "@/components/Toast";
import VoiceSelector from "@/components/VoiceSelector";
import {
  countWords,
  ELEVENLABS_VOICES,
  OPENAI_VOICES,
  PROVIDER_META,
  SPEED_DEFAULT,
  SPEED_OPTIONS,
  type Voice,
} from "@/lib/voices";

type Engine = { provider: "elevenlabs" | "openai" | "browser" };

// Only the hosted engines get a badge; the browser fallback stays unlabelled.
const ENGINE_LABEL: Record<"elevenlabs" | "openai", string> = {
  elevenlabs: "ElevenLabs · multilingual v2",
  openai: "OpenAI · tts-1-hd",
};

// Chrome ships this voice on desktop; prefer it as the browser-mode default.
const PREFERRED_BROWSER_VOICE = "Google UK English Male";

export default function Home() {
  const [engine, setEngine] = useState<Engine | null>(null); // null while detecting
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState("");
  const [systemVoice, setSystemVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [text, setText] = useState("");
  const [speed, setSpeed] = useState(SPEED_DEFAULT);
  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [autoPlaySignal, setAutoPlaySignal] = useState(0);
  const [toast, setToast] = useState<ToastData | null>(null);

  const speechPanelRef = useRef<BrowserSpeechHandle>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioUrlRef = useRef<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (next: ToastData) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  };

  // Which engine is live? The API route answers from the server's env keys.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/tts")
      .then((res) => res.json())
      .then((data: { provider: "elevenlabs" | "openai" | null }) => {
        if (cancelled) return;
        if (data.provider) {
          setEngine({ provider: data.provider });
          const list =
            data.provider === "openai" ? OPENAI_VOICES : ELEVENLABS_VOICES;
          setVoices(list);
          setVoice(list[0].id);
        } else {
          setEngine({ provider: "browser" });
        }
      })
      .catch(() => {
        if (!cancelled) setEngine({ provider: "browser" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Browser mode: enumerate system voices (loads async on most browsers).
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

  // Release the last generated blob when the page unloads.
  useEffect(() => {
    return () => {
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  const trimmed = text.trim();
  const apiProvider =
    engine && engine.provider !== "browser" ? engine.provider : null;
  const maxChars =
    engine && engine.provider !== "browser"
      ? PROVIDER_META[engine.provider].maxChars
      : null;
  const overLimit = maxChars !== null && trimmed.length > maxChars;
  const voiceName = voices.find((v) => v.id === voice)?.name ?? "speech";

  const selectVoice = (id: string) => {
    setVoice(id);
    if (engine?.provider === "browser") {
      setSystemVoice(
        window.speechSynthesis
          ?.getVoices()
          .find((v) => v.voiceURI === id) ?? null,
      );
    }
  };

  const generate = async () => {
    if (!engine) return;

    if (engine.provider === "browser") {
      speechPanelRef.current?.speak();
      return;
    }

    if (!trimmed) {
      showToast({ type: "info", message: "Type or paste some text first." });
      textareaRef.current?.focus();
      return;
    }
    if (overLimit) {
      showToast({
        type: "error",
        message: `Text is over the ${maxChars?.toLocaleString()} character limit for this engine (${trimmed.length.toLocaleString()} so far). Trim it and try again.`,
      });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, voice, speed }),
      });
      if (!res.ok) {
        let message = `Generation failed (HTTP ${res.status}).`;
        try {
          const data: { error?: string } = await res.json();
          if (typeof data?.error === "string") message = data.error;
        } catch {
          // keep the default message
        }
        showToast({ type: "error", message });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = url;
      setAudioUrl(url);
      setAutoPlaySignal((n) => n + 1);
    } catch {
      showToast({
        type: "error",
        message: "Network error — could not reach the TTS service.",
      });
    } finally {
      setLoading(false);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip) {
        showToast({ type: "info", message: "The clipboard is empty." });
        return;
      }
      setText(clip);
      textareaRef.current?.focus();
    } catch {
      showToast({
        type: "error",
        message:
          "Clipboard access was denied by your browser. Paste manually with Ctrl+V.",
      });
    }
  };

  const clearText = () => {
    setText("");
    textareaRef.current?.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void generate();
    }
  };

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col px-4 py-10 sm:py-14">
      {apiProvider && (
        <header className="mb-8 flex flex-wrap items-center justify-end gap-3">
          <div
            className="flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 shadow-sm"
            title="Active speech engine"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            <span className="whitespace-nowrap text-xs font-medium text-stone-600">
              {ENGINE_LABEL[apiProvider]}
            </span>
          </div>
        </header>
      )}


      <section className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-xl shadow-stone-900/5 sm:p-7">
        <div className="rounded-2xl border border-stone-200 bg-stone-50 transition focus-within:border-amber-600/50 focus-within:ring-2 focus-within:ring-amber-600/15">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder=""
            spellCheck={false}
            aria-label="Text to convert to speech"
            className="block min-h-[20rem] w-full resize-none overflow-y-auto bg-transparent px-4 py-3.5 text-[15px] leading-relaxed text-stone-800 placeholder:text-stone-400 focus:outline-none"
          />
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

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <VoiceSelector
            voices={voices}
            value={voice}
            onChange={selectVoice}
            disabled={!engine || loading}
          />
          <div
            role="radiogroup"
            aria-label="Speech rate"
            className="grid min-w-0 grid-cols-4 gap-1.5"
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
                  disabled={!engine}
                  className={`flex h-[42px] items-center justify-center rounded-xl text-xs font-medium shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${
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

        {/* Browser mode speaks through the transport row below instead. */}
        {apiProvider && (
          <button
            type="button"
            onClick={() => void generate()}
            disabled={loading || !trimmed}
            aria-busy={loading}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-3.5 text-sm font-semibold text-white shadow-md transition hover:bg-stone-700 hover:shadow-lg active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-stone-900"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" aria-hidden />
                Generate Audio
              </>
            )}
          </button>
        )}


        {audioUrl && engine?.provider !== "browser" && (
          <div className="mt-6">
            <AudioPlayer
              src={audioUrl}
              autoPlaySignal={autoPlaySignal}
              voiceName={voiceName}
            />
          </div>
        )}

        {engine?.provider === "browser" && (
          <div className="mt-6">
            <BrowserSpeechPanel
              ref={speechPanelRef}
              text={trimmed}
              voice={systemVoice}
              rate={speed}
              onNotify={showToast}
            />
          </div>
        )}
      </section>


      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </main>
  );
}
