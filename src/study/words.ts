import { requireInteractiveTerminal } from "../maimemo/errors.js";

export function formatWordPage(words: readonly string[], pageIndex: number, pageSize: number): string {
  const pages = Math.max(1, Math.ceil(words.length / pageSize));
  const page = Math.min(pages - 1, Math.max(0, pageIndex));
  const start = page * pageSize;
  const body = words.length === 0
    ? ["这本词书是空的。"]
    : words.slice(start, start + pageSize).map((word, offset) => `${start + offset + 1} ${word}`);
  return [...body, "", `${page + 1}/${pages}    ← → 翻页    q 退出`].join("\n");
}

export async function browseWords(words: readonly string[], pageSize: number): Promise<void> {
  requireInteractiveTerminal();
  const { render } = await import("ink");
  const { createElement } = await import("react");
  const { WordsApp } = await import("../tui/WordsApp.js");
  const instance = render(createElement(WordsApp, { words, pageSize }));
  await instance.waitUntilExit();
}
