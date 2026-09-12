"use client";

import { ChevronDown, Mic } from "lucide-react";
import type { Voice } from "@/lib/voices";

type Props = {
  voices: Voice[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
};

export default function VoiceSelector({
  voices,
  value,
  onChange,
  disabled,
}: Props) {
  const selected = voices.find((v) => v.id === value);
  return (
    <div className="min-w-0">
      <div className="relative">
        <Mic
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
          aria-hidden
        />
        <select
          id="voice-select"
          aria-label="Voice"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full appearance-none rounded-xl border border-stone-200 bg-white py-2.5 pl-9 pr-9 text-sm text-stone-800 shadow-sm transition focus:border-amber-600/60 focus:outline-none focus:ring-2 focus:ring-amber-600/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {voices.length === 0 && (
            <option value="">Loading voices…</option>
          )}
          {voices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.name}
              {voice.gender ? ` · ${voice.gender}` : ""}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
          aria-hidden
        />
      </div>
      {selected?.description && (
        <p className="mt-1.5 truncate text-xs text-stone-500">
          {selected.description}
        </p>
      )}
    </div>
  );
}
