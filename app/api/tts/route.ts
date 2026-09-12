import type { NextRequest } from "next/server";
import {
  ELEVENLABS_VOICES,
  OPENAI_VOICES,
  PROVIDER_META,
  SPEED_MAX,
  SPEED_MIN,
  type Provider,
} from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pick the TTS engine from the available API keys.
 * ElevenLabs wins when both keys exist — eleven_multilingual_v2 handles
 * mixed English + Mandarin strings most naturally. TTS_PROVIDER can pin one.
 */
function resolveProvider(): Provider | null {
  const available: Provider[] = [];
  if (process.env.ELEVENLABS_API_KEY) available.push("elevenlabs");
  if (process.env.OPENAI_API_KEY) available.push("openai");

  const requested = process.env.TTS_PROVIDER?.trim().toLowerCase();
  if (requested === "elevenlabs" || requested === "openai") {
    return available.includes(requested) ? requested : null;
  }
  return available[0] ?? null;
}

/** GET /api/tts — tells the UI which engine is live so it can adapt. */
export async function GET() {
  const provider = resolveProvider();
  return Response.json({
    provider,
    model: provider ? PROVIDER_META[provider].model : null,
  });
}

/** Pull a readable message out of an upstream provider error body. */
async function upstreamError(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json();
    if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      const detail = obj.detail ?? obj.error;
      if (typeof detail === "string") return detail;
      if (detail && typeof detail === "object" && "message" in detail) {
        const message = (detail as Record<string, unknown>).message;
        if (typeof message === "string") return message;
      }
    }
    return JSON.stringify(data).slice(0, 300);
  } catch {
    return res.statusText || "Upstream TTS provider error";
  }
}

/**
 * POST /api/tts — synthesize speech and stream the mp3 back as binary.
 * Body: { text: string, voice?: string, speed?: number }
 */
export async function POST(req: NextRequest) {
  const provider = resolveProvider();
  if (!provider) {
    return Response.json(
      {
        error:
          "No TTS provider configured. Add ELEVENLABS_API_KEY or OPENAI_API_KEY to .env.local and restart the server.",
      },
      { status: 501 },
    );
  }

  let body: { text?: unknown; voice?: unknown; speed?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json({ error: "Text is required." }, { status: 400 });
  }

  const { label, maxChars } = PROVIDER_META[provider];
  if (text.length > maxChars) {
    return Response.json(
      {
        error: `Text is too long: ${text.length.toLocaleString()} characters. The ${label} engine accepts up to ${maxChars.toLocaleString()} per request.`,
      },
      { status: 413 },
    );
  }

  // Voice: must be a known OpenAI name, or an alphanumeric ElevenLabs voice id.
  const voice = typeof body.voice === "string" ? body.voice.trim() : "";
  if (provider === "openai") {
    const openaiIds = OPENAI_VOICES.map((v) => v.id);
    if (!openaiIds.includes(voice)) {
      return Response.json(
        { error: `Unknown OpenAI voice "${voice}". Valid voices: ${openaiIds.join(", ")}.` },
        { status: 400 },
      );
    }
  } else if (!/^[A-Za-z0-9]{10,64}$/.test(voice)) {
    return Response.json(
      { error: "ElevenLabs voice must be a voice id (e.g. 21m00Tcm4TlvDq8ikWAM)." },
      { status: 400 },
    );
  }

  const rawSpeed = Number(body.speed);
  const speed = Number.isFinite(rawSpeed)
    ? Math.min(SPEED_MAX, Math.max(SPEED_MIN, rawSpeed))
    : 1;

  let upstream: Response;
  try {
    if (provider === "elevenlabs") {
      // eleven_multilingual_v2 auto-detects per-run language, so an English
      // sentence with embedded 中文 is pronounced natively by both sides.
      // ElevenLabs accepts speed 0.7–1.2; clamp the slider range into it.
      const elSpeed = Math.min(1.2, Math.max(0.7, speed));
      upstream = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": process.env.ELEVENLABS_API_KEY as string,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0,
              use_speaker_boost: true,
              speed: elSpeed,
            },
          }),
        },
      );
    } else {
      upstream = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY as string}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1-hd",
          voice,
          input: text,
          speed,
          response_format: "mp3",
        }),
      });
    }
  } catch {
    return Response.json(
      { error: `Could not reach the ${label} TTS service. Check your network and try again.` },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const message = await upstreamError(upstream);
    return Response.json(
      { error: `${label} API error (${upstream.status})${message ? `: ${message}` : ""}` },
      { status: 502 },
    );
  }

  // Stream the binary audio straight through to the client.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
      "Cache-Control": "no-store",
      "X-TTS-Provider": provider,
    },
  });
}
