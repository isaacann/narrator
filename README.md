# Vox — Text to Audio

Convert English & 中文 (Mandarin) text into natural, human-like speech from a clean, minimalist web UI.

Built with **Next.js (App Router) · React 19 · Tailwind CSS 4 · lucide-react**.

## How the audio engine is picked

| Priority | Engine | Model | Requires |
| --- | --- | --- | --- |
| 1 | ElevenLabs | `eleven_multilingual_v2` | `ELEVENLABS_API_KEY` |
| 2 | OpenAI | `tts-1-hd` | `OPENAI_API_KEY` |
| 3 | Browser (zero-config) | Web Speech API | nothing |

The app auto-detects the engine from `.env.local` on load (ElevenLabs wins when both keys exist — it renders mixed English + Mandarin most naturally). `TTS_PROVIDER=elevenlabs|openai` can pin one explicitly. With no keys at all, the app falls back to the browser's built-in `speechSynthesis` and says so via an inline notice — it stays fully usable, minus the mp3 download.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure providers (optional — browser mode works without it)
cp .env.example .env.local
#    then edit .env.local and paste at least one API key:
#      ELEVENLABS_API_KEY=…   (https://elevenlabs.io → Profile → API Keys)
#      OPENAI_API_KEY=…       (https://platform.openai.com/api-keys)

# 3. Run the dev server
npm run dev
```

Open **http://localhost:3000**.

## Testing it locally

1. **Type or paste text** — mix languages freely, e.g.
   `Welcome back! 今天我们要聊一聊 text-to-speech 的发展。`
   - Watch the char/word counter (words = latin words + CJK characters) and per-engine char limit.
2. **Pick a voice** (Alloy, Echo, Fable, Onyx, Nova, Shimmer on OpenAI; Rachel, Adam, Antoni, Bella on ElevenLabs; system voices in browser mode) and a **speed** — fixed 0.75× / 1.0× / 1.25× / 1.5×, not a free slider.
3. Hit **Generate Audio** (or `Ctrl+Enter`).
   - API mode: the button shows a spinner, then an audio player appears (play/pause, seekable scrubber with times, replay, download `.mp3`) and auto-plays.
   - Browser mode: the same button reads the text aloud with transport controls (speak / pause / resume / stop).
4. **Error paths to try:** generating with empty input, pasting a text over the engine's char limit (4,096 OpenAI / 10,000 ElevenLabs), or removing your API key and restarting (the app notifies you and switches to browser mode).

### Verifying the API from a terminal

```bash
# Which engine is live?
curl http://localhost:3000/api/tts
# → {"provider":"openai","model":"tts-1-hd"}   (or "elevenlabs", or null)

# Synthesize to a file (JSON in, mp3 stream out)
curl -X POST http://localhost:3000/api/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello 你好，world 世界!","voice":"nova","speed":1.0}' \
  -o speech.mp3
```

## Project layout

```
app/
  api/tts/route.ts     # GET engine info · POST → provider call → streamed audio
  layout.tsx           # metadata + font stack (incl. CJK fallbacks)
  page.tsx             # main UI: textarea, voice/speed, toasts
  globals.css          # Tailwind v4 theme, slider/scrubber, animations
components/
  AudioPlayer.tsx      # play/pause, seek, replay, download, eq bars
  VoiceSelector.tsx    # voice dropdown + description line
  BrowserSpeechPanel.tsx  # zero-config speechSynthesis transport
  Toast.tsx            # error / info notifications
lib/
  voices.ts            # voice catalogs, provider metadata, word counter
```

## Notes

- **Bilingual safety:** text travels as UTF-8 JSON and is passed to the engine untouched; `eleven_multilingual_v2` auto-detects per-run language, and OpenAI's voices handle inline CJK. No text preprocessing that could drop non-Latin characters.
- **Streaming:** the API route pipes the provider's binary response straight through (`upstream.body → new Response(body)`), so audio starts arriving while the provider is still generating.
- **Keys stay server-side:** the browser only ever talks to `/api/tts`.
- **Character limits:** OpenAI `tts-1-hd` = 4,096 chars/request; ElevenLabs multilingual v2 = 10,000; the UI counter enforces the active limit.
- ElevenLabs' `speed` setting only accepts 0.7–1.2; the route clamps the 0.75–1.5 range into it.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Header chip shows "Browser speech engine" | No API key found — add one to `.env.local` and **restart** `npm run dev` |
| `401` toast from the provider | Key is invalid/expired — re-check `.env.local` |
| `429` toast | Rate limit / quota exhausted on the provider account |
| No sound in browser mode | Some Linux browsers ship no system voices; pick a different voice or install `speech-dispatcher` |
| Clipboard button fails | Browsers only grant clipboard read on `localhost`/HTTPS and after permission — paste with `Ctrl+V` instead |
