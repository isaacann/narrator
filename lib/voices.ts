export type Provider = "elevenlabs" | "openai";

export type Voice = {
  /** Provider voice id (OpenAI name, ElevenLabs voice id, or browser voiceURI). */
  id: string;
  name: string;
  gender?: "Female" | "Male";
  description: string;
};

export const OPENAI_VOICES: Voice[] = [
  { id: "alloy", name: "Alloy", gender: "Female", description: "Balanced, neutral and versatile" },
  { id: "echo", name: "Echo", gender: "Male", description: "Calm and steady, great for narration" },
  { id: "fable", name: "Fable", gender: "Male", description: "Expressive storyteller with a British lilt" },
  { id: "onyx", name: "Onyx", gender: "Male", description: "Deep and authoritative" },
  { id: "nova", name: "Nova", gender: "Female", description: "Warm and energetic" },
  { id: "shimmer", name: "Shimmer", gender: "Female", description: "Soft, friendly and clear" },
];

// Preset ElevenLabs voice ids — swap in any voice id from your ElevenLabs dashboard.
export const ELEVENLABS_VOICES: Voice[] = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", gender: "Female", description: "Calm American narration voice" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", gender: "Male", description: "Deep, composed American voice" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", gender: "Male", description: "Warm, well-rounded and friendly" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", gender: "Female", description: "Soft, expressive and youthful" },
];

export const PROVIDER_META: Record<
  Provider,
  { label: string; model: string; maxChars: number }
> = {
  elevenlabs: { label: "ElevenLabs", model: "eleven_multilingual_v2", maxChars: 10_000 },
  openai: { label: "OpenAI", model: "tts-1-hd", maxChars: 4_096 },
};

/** Discrete rates offered in the UI — the only speeds a user can pick. */
export const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5] as const;

// Derived so the API's clamp bounds can never drift from the options above.
export const SPEED_MIN = SPEED_OPTIONS[0];
export const SPEED_MAX = SPEED_OPTIONS[SPEED_OPTIONS.length - 1];
export const SPEED_DEFAULT = 1;

/** Count "words" for mixed English + 中文 text: latin word runs + CJK characters. */
export function countWords(text: string): number {
  const latin = text.match(/[A-Za-z0-9'’\-]+/g)?.length ?? 0;
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g)?.length ?? 0;
  return latin + cjk;
}
