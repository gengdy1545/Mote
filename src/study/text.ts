import type { DictWord } from "../dict/types.js";
import { dictionaryKey } from "../dict/types.js";
import { dictionaryText, phoneticLabel } from "../dict/format.js";
import type { PracticeState } from "./practice.js";
import { currentCard } from "./practice.js";
import { wrapText } from "./wrap.js";

export const EMPTY_TASK_NOTE = "今日没有单词。请先在墨墨 App 里打开学习，再运行 mote sync。";

export function officialProgressLine(finished: number, total: number): string {
  return `墨墨今日已完成：${finished} / ${total}`;
}

export function lookupText(spelling: string, word: DictWord | null): string {
  const phonetic = phoneticLabel(word);
  const title = phonetic ? `${spelling}  ${phonetic}` : spelling;
  return [title, "", dictionaryText(word)].join("\n");
}

export function cardBody(word: DictWord | null): string {
  return dictionaryText(word);
}

export function practiceText(input: {
  state: PracticeState;
  offline: boolean;
  words?: Readonly<Record<string, DictWord | null>>;
  columns: number;
}): string {
  // A line as wide as the terminal wraps onto an extra row and the next frame stacks.
  const columns = Math.max(1, input.columns - 1);
  const lines: string[] = [];
  if (input.offline) lines.push("未能连接墨墨，显示今日已保存的官方快照");

  const card = currentCard(input.state);
  if (!card) {
    return wrapText(lines.join("\n"), columns);
  }

  if (lines.length > 0) lines.push("");
  const word = input.state.revealed ? input.words?.[dictionaryKey(card.spelling)] ?? null : null;
  const phonetic = input.state.revealed ? phoneticLabel(word) : "";
  lines.push(phonetic ? `${card.spelling}  ${phonetic}` : card.spelling);
  if (input.state.revealed) {
    lines.push("");
    lines.push(cardBody(word));
  }
  lines.push("");
  return wrapText(lines.join("\n"), columns);
}
