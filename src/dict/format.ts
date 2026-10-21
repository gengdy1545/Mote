import type { Interpretation } from "../maimemo/types.js";
import type { DictWord } from "./types.js";

export function dictionaryText(word: DictWord | null, official: Interpretation[] | null): string {
  if (!word && official === null) return "正在读取释义";
  const lines: string[] = [];
  const phonetic = word?.phoneticUs || word?.phoneticUk || "";
  if (phonetic) lines.push(phonetic.startsWith("/") ? phonetic : `/${phonetic}/`);

  const senses = senseLines(word, official);
  if (senses.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(...senses);
  }

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

function senseLines(word: DictWord | null, official: Interpretation[] | null): string[] {
  const officialLines = (official ?? [])
    .map((item) => {
      const text = item.text.trim();
      if (!text) return "";
      const tags = item.tags.length > 0 ? ` [${item.tags.join("、")}]` : "";
      return `${text}${tags}`;
    })
    .filter(Boolean);
  if (officialLines.length > 0) return officialLines;

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
