/** A half-open [start, end) range into the source string. */
export type SentenceRange = { start: number; end: number };

type Segmenter = new (
  locale?: string,
  options?: { granularity: "sentence" },
) => { segment(input: string): Iterable<{ index: number; segment: string }> };

/**
 * Split text into sentence ranges, preserving offsets into the ORIGINAL string.
 *
 * Keeping the offsets means the same ranges drive both what gets spoken and
 * what gets highlighted, so the two can never drift apart.
 *
 * `Intl.Segmenter` is used when available because it understands CJK
 * punctuation — a regex has to special-case 。！？ and still gets mixed
 * English/中文 runs wrong.
 */
export function splitSentences(text: string): SentenceRange[] {
  if (!text) return [];

  const segmenterCtor = (Intl as unknown as { Segmenter?: Segmenter }).Segmenter;
  if (typeof segmenterCtor === "function") {
    const segmenter = new segmenterCtor(undefined, { granularity: "sentence" });
    const ranges: SentenceRange[] = [];
    for (const part of segmenter.segment(text)) {
      ranges.push({ start: part.index, end: part.index + part.segment.length });
    }
    if (ranges.length > 0) return ranges;
  }

  return fallbackSplit(text);
}

/**
 * Regex fallback for engines without `Intl.Segmenter` (Firefox before 125).
 *
 * Latin punctuation needs trailing whitespace to count as a break, but CJK
 * punctuation does not — Chinese and Japanese write 。！？ with no following
 * space, so requiring one would glue an entire Chinese paragraph into a single
 * range and the fallback would never split the app's bilingual case at all.
 */
function fallbackSplit(text: string): SentenceRange[] {
  const ranges: SentenceRange[] = [];
  const boundary = /[.!?]+["'”’)\]]*\s+|[。！？…]+["'”’)\]]*|\n+/g;
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(text)) !== null) {
    const end = match.index + match[0].length;
    ranges.push({ start, end });
    start = end;
  }
  if (start < text.length) ranges.push({ start, end: text.length });

  return ranges;
}
