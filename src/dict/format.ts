import type { DictWord } from "./types.js";

export function phoneticLabel(word: DictWord | null): string {
  const phonetic = word?.phoneticUs || word?.phoneticUk || "";
  if (!phonetic) return "";
  return phonetic.startsWith("/") ? phonetic : `/${phonetic}/`;
}

export function dictionaryText(word: DictWord | null): string {
  if (!word) return "正在读取释义";
  const lines: string[] = [];
  const senses = senseLines(word);
  if (senses.length > 0) lines.push(...senses);

  const phrases = (word?.phrases ?? [])
    .map((phrase) => {
      const meaning = phrase.meaning.replace(/^[a-z]+\.\s*/i, "").trim();
      return meaning ? `${phrase.phrase}  ${meaning}` : phrase.phrase;
    })
    .filter(Boolean)
    .slice(0, 2);
  if (phrases.length > 0) {
    lines.push("");
    lines.push("语块");
    lines.push(...phrases);
  }

  const example = word?.examples[0];
  if (example?.sentence) {
    lines.push("");
    lines.push("例句");
    lines.push(example.sentence);
    if (example.translation) lines.push(example.translation);
  }

  return lines.some((line) => line.trim().length > 0) ? lines.join("\n") : "没有查到释义";
}

function senseLines(word: DictWord | null): string[] {
  const chinese = (word?.senses ?? []).filter((sense) => sense.lang === "zh").slice(0, 2);
  const english = (word?.senses ?? []).filter((sense) => sense.lang === "en").slice(0, 2);
  return (chinese.length > 0 ? chinese : english).map((sense) => senseLine(sense.pos, sense.gloss));
}

function senseLine(pos: string, gloss: string): string {
  const body = shortenClauses(gloss.replace(/^[a-z]+\.\s*/i, ""));
  if (!pos) return body;
  return `${pos} ${body}`;
}

function shortenClauses(gloss: string): string {
  const parts = gloss.split("；").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 4) return parts.join("；");
  return `${parts.slice(0, 4).join("；")}……`;
}
