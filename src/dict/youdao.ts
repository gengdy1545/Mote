import type { DictExample, DictPhrase, DictSense } from "./types.js";

export type YoudaoDictionary = {
  phoneticUs: string;
  phoneticUk: string;
  senses: DictSense[];
  phrases: DictPhrase[];
  examples: DictExample[];
};

export function parseYoudaoDictionary(body: unknown): YoudaoDictionary {
  const result: YoudaoDictionary = { phoneticUs: "", phoneticUk: "", senses: [], phrases: [], examples: [] };
  if (!body || typeof body !== "object") return result;
  const record = body as { ec?: { word?: unknown[] }; phrs?: { phrs?: unknown[] }; blng_sents_part?: { "sentence-pair"?: unknown[] } };
  const word = record.ec?.word?.[0];
  if (word && typeof word === "object") {
    const entry = word as { usphone?: unknown; ukphone?: unknown; trs?: unknown };
    result.phoneticUs = text(entry.usphone);
    result.phoneticUk = text(entry.ukphone);
    for (const sense of asArray(entry.trs)) {
      const gloss = text(dig(sense, ["tr", "l", "i"]));
      if (!gloss || gloss.startsWith("【名】")) continue;
      result.senses.push({ pos: posOf(gloss), gloss, lang: "zh" });
    }
  }
  for (const item of asArray(record.phrs?.phrs).slice(0, 2)) {
    const phrase = text(dig(item, ["phr", "headword", "l", "i"]));
    const meaning = text(dig(item, ["phr", "trs", "tr", "l", "i"]));
    if (phrase) result.phrases.push({ phrase, meaning });
  }
  for (const item of asArray(record.blng_sents_part?.["sentence-pair"]).slice(0, 1)) {
    if (!item || typeof item !== "object") continue;
    const pair = item as { "sentence-eng"?: unknown; "sentence-translation"?: unknown };
    const sentence = text(pair["sentence-eng"]);
    const translation = text(pair["sentence-translation"]);
    if (sentence) result.examples.push({ sentence, translation });
  }
  return result;
}

function posOf(gloss: string): string {
  const match = /^([a-z]+\.)\s+/i.exec(gloss);
  return match?.[1] ?? "";
}

function dig(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    current = first(current);
    if (!current || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function text(value: unknown): string {
  const raw = rawText(value).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return raw;
}

function rawText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(rawText).filter(Boolean).join("");
  if (value && typeof value === "object" && "i" in value) return rawText((value as { i?: unknown }).i);
  return "";
}
