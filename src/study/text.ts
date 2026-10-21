import type { Interpretation } from "../maimemo/types.js";
import type { DictWord } from "../dict/types.js";
import { dictionaryKey } from "../dict/types.js";
import { dictionaryText } from "../dict/format.js";
import type { Card, PracticeState } from "./practice.js";
import { currentCard } from "./practice.js";
import { wrapText } from "./wrap.js";

export const UNSYNCED_LINE = "本地反馈未同步至墨墨";

export const EMPTY_TASK_NOTE =
  "今日任务列表为空。当天需要先在墨墨 App 里打开学习并完成初始化，开放接口才会返回今日单词。Mote 不会根据学习记录自行生成任务。";

export function officialProgressLine(finished: number, total: number): string {
  return `墨墨今日已完成：${finished} / ${total}`;
}

export function localProgressLine(count: number): string {
  return `本地今日已练习：${count} 个`;
}

export function cardBody(input: { interpretations: Interpretation[] | null; word: DictWord | null }): string {
  if (input.interpretations === null && input.word === null) return "正在读取释义";
  return dictionaryText(input.word, input.interpretations);
}

export function practiceText(input: {
  state: PracticeState;
  offline: boolean;
  content: Readonly<Record<string, Interpretation[]>>;
  words?: Readonly<Record<string, DictWord | null>>;
  columns: number;
}): string {
  // A line as wide as the terminal wraps onto an extra row and the next frame stacks.
  const columns = Math.max(1, input.columns - 1);
  const lines: string[] = [];
  if (input.offline) lines.push("未能连接墨墨，显示今日已保存的官方快照");

  const card = currentCard(input.state);
  if (!card || input.state.status !== "practicing") {
    return wrapText(lines.join("\n"), columns);
  }

  if (lines.length > 0) lines.push("");
  lines.push(cardHeading(card));
  if (input.state.revealed) {
    lines.push("");
    const interpretations = Object.prototype.hasOwnProperty.call(input.content, card.vocId)
      ? input.content[card.vocId] ?? []
      : null;
    const word = input.words?.[dictionaryKey(card.spelling)] ?? null;
    lines.push(cardBody({ interpretations, word }));
  }
  lines.push("");
  return wrapText(lines.join("\n"), columns);
}

function cardHeading(card: Card): string {
  const marks = [card.isNew ? "新词" : "", card.isFinished ? "墨墨今日已完成" : ""].filter(Boolean);
  return marks.length > 0 ? `${card.spelling}  ${marks.join("  ")}` : card.spelling;
}
