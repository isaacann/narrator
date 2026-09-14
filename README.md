# Vox — Text to Audio

Convert English & 中文 (Mandarin) text into speech from a clean, minimalist web UI.

Built with **Next.js (App Router) · React 19 · Tailwind CSS 4 · lucide-react**.

## How it speaks

The app reads text aloud with the **browser's own speech engine** (the Web Speech API) — no API key, no account, no server round trip. Voices come from your operating system, so the list you see depends on what is installed locally.

The hosted ElevenLabs / OpenAI path is **switched off**, and the UI no longer offers it. Its code is still in the repo, unreferenced, in case you want it back — see [Dormant: hosted engines](#dormant-hosted-engines).

## Setup

```bash
npm install
npm run dev
```

Open **http://localhost:6001**. No `.env.local` is needed — with no keys configured the app would have used browser mode anyway.

## Using it

1. **Type or paste text** — mix languages freely, e.g.
   `Welcome back! 今天我们要聊一聊 text-to-speech 的发展。`
2. **Pick a voice** from your system voices, and a **speed** — fixed 0.75× / 1.0× / 1.25× / 1.5×, not a free slider.
3. Hit **Play** in the transport card (or `Ctrl+Enter`) to start reading.
   - **Play / Pause** toggles. From a stopped state it starts the passage from the top.
   - **Stop** clears the queue and the read-along highlight.
   - **Back 5s / Forward 5s** move the position and keep reading. See below.
4. While speech runs, the sentence being spoken is highlighted in the textarea and scrolled into view.

### How the 5-second skips work

The Web Speech API exposes **no timeline**: no duration, no current position, and no way to seek inside an utterance. A skip can therefore only land on a **sentence boundary** — the whole queue is rebuilt from the target sentence. The two directions are measured differently:

- **Back 5s** uses the real start timestamps of sentences already heard, landing on the sentence that began closest to 5 seconds ago. Pausing shifts the recorded timeline forward so a long pause doesn't inflate the jump. This is exact.
- **Forward 5s** has nothing to measure, so it sums a rate-based estimate of the rest of the current sentence plus the ones after it. At ~180 words-or-CJK-chars per minute this is a coarse approximation of the engine's real pacing.

A sentence longer than the whole skip can't be split, so a jump may overshoot rather than landing mid-sentence — a 5s skip across 10-second sentences will move you further than 5s, because the nearest reachable boundaries are a full sentence apart. There is **no download button**: browser speech plays straight to the sound card and cannot be captured to a file by any browser API, so there is no audio to save.

## Project layout

```
app/
  api/tts/route.ts     # DORMANT — hosted provider route, unreferenced by the UI
  layout.tsx           # metadata + font stack (incl. CJK fallbacks)
  page.tsx             # main UI: textarea, voice/speed, read-along, toasts
  globals.css          # Tailwind v4 theme, slider, animations
components/
  BrowserSpeechPanel.tsx  # speechSynthesis transport: play/pause, stop, ±5s
  AudioPlayer.tsx      # DORMANT — mp3 player for the hosted path
  VoiceSelector.tsx    # voice dropdown + description line
  Toast.tsx            # error / info notifications
lib/
  voices.ts            # speed options, word counter
  sentences.ts         # sentence splitting for speech + highlighting
```

## Dormant: hosted engines

`app/api/tts/route.ts` still works and still reads `ELEVENLABS_API_KEY` / `OPENAI_API_KEY` / `TTS_PROVIDER` from `.env.local` (see `.env.example`), but nothing in the UI calls it. Its properties, for reference if you revive it:

- **Streaming:** the route pipes the provider's binary response straight through (`upstream.body → new Response(body)`), so audio starts arriving while the provider is still generating.
- **Keys stay server-side:** the browser only ever talks to `/api/tts`.
- **Character limits:** OpenAI `tts-1-hd` = 4,096 chars/request; ElevenLabs multilingual v2 = 10,000.
- **Speed:** ElevenLabs' `speed` setting only accepts 0.7–1.2; the route clamps the 0.75–1.5 range into it.
- **Bilingual:** text travels as UTF-8 JSON untouched; `eleven_multilingual_v2` auto-detects per-run language.

Reviving it means restoring the provider probe and the `AudioPlayer` mount in `app/page.tsx` (see git history), not just adding a key.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| No voices in the dropdown | The system has none installed. On Linux install `speech-dispatcher`; Chrome and Edge ship network voices on most platforms |
| No sound, but the highlight advances | The selected voice produced silence — try another voice |
| Pause does nothing | Some engines/deprecated voices ignore `pause()`; the app notifies you |
| Skipping lands in the wrong place | Expected within a sentence — Web Speech cannot seek mid-utterance, so skips snap to sentence boundaries |
