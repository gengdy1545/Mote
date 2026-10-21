import type { DictExample, DictSense } from "./types.js";

export type EnglishDictionary = {
  phonetic: string;
  audioUrl: string;
  senses: DictSense[];
  examples: DictExample[];
};

export function parseEnglishDictionary(body: unknown): EnglishDictionary {
  const result: EnglishDictionary = { phonetic: "", audioUrl: "", senses: [], examples: [] };
  const entry = Array.isArray(body) ? body[0] : null;
  if (!entry || typeof entry !== "object") return result;
  const record = entry as { phonetic?: unknown; phonetics?: unknown[]; meanings?: unknown[] };
  result.phonetic = text(record.phonetic);
  for (const item of record.phonetics ?? []) {
    if (!item || typeof item !== "object") continue;
    const phonetic = item as { text?: unknown; audio?: unknown };
    if (!result.phonetic) result.phonetic = text(phonetic.text);
    if (!result.audioUrl && typeof phonetic.audio === "string" && phonetic.audio.trim()) {
      result.audioUrl = absoluteUrl(phonetic.audio.trim());
    }
  }
  for (const meaning of record.meanings ?? []) {
    if (!meaning || typeof meaning !== "object") continue;
    const row = meaning as { partOfSpeech?: unknown; definitions?: unknown[] };
    const pos = text(row.partOfSpeech);
    for (const definition of row.definitions ?? []) {
      if (!definition || typeof definition !== "object") continue;
      const item = definition as { definition?: unknown; example?: unknown };
      const gloss = text(item.definition);
      if (gloss) result.senses.push({ pos, gloss, lang: "en" });
      const example = text(item.example);
      if (example && result.examples.length < 1) result.examples.push({ sentence: example, translation: "" });
    }
  }
  result.senses = result.senses.slice(0, 2);
  return result;
}

function absoluteUrl(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
