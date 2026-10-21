import { isBookName } from "../config.js";
import type { BookRequest } from "../commands/run.js";

export type ParsedArgs =
  | { command: "help" }
  | { command: "auth"; token?: string }
  | { command: "sync"; token?: string }
  | { command: "stats"; token?: string }
  | { command: "lookup"; word: string; token?: string }
  | { command: "book"; request: BookRequest }
  | { command: "fetch"; book?: string }
  | { command: "review"; limit: number | null; token?: string };

export function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  let token: string | undefined;
  let limit: number | null | undefined;
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index] ?? "";
    if (item === "--help" || item === "-h") return { command: "help" };
    if (item === "--token" || item === "-T") {
      const value = argv[index + 1];
      if (!value) return { error: "缺少 --token 的值" };
      token = value;
      index += 1;
      continue;
    }
    if (item.startsWith("--token=")) {
      token = item.slice("--token=".length);
      continue;
    }
    if (item === "--limit") {
      const parsed = parseLimit(argv[index + 1]);
      if (typeof parsed !== "number") return { error: parsed };
      limit = parsed;
      index += 1;
      continue;
    }
    if (item.startsWith("--limit=")) {
      const parsed = parseLimit(item.slice("--limit=".length));
      if (typeof parsed !== "number") return { error: parsed };
      limit = parsed;
      continue;
    }
    if (item.startsWith("-")) return { error: `未知参数：${item}` };
    positionals.push(item);
  }

  const command = positionals[0] ?? "review";
  if (limit != null && command !== "review") return { error: `${command} 不接受 --limit` };

  if (command === "help") return { command: "help" };
  if (command === "auth") {
    if (positionals.length > 1) return { error: "auth 不接受额外参数" };
    return { command: "auth", token };
  }
  if (command === "sync") {
    if (positionals.length > 1) return { error: "sync 不接受额外参数" };
    return { command: "sync", token };
  }
  if (command === "stats") {
    if (positionals.length > 1) return { error: "stats 不接受额外参数" };
    return { command: "stats", token };
  }
  if (command === "lookup") {
    const word = positionals[1];
    if (!word) return { error: "用法：mote lookup <单词>" };
    if (positionals.length > 2) return { error: "lookup 只接受一个单词" };
    return { command: "lookup", word, token };
  }
  if (command === "book") {
    const name = positionals[1];
    if (!name) return { command: "book", request: { action: "show" } };
    if (name === "add") {
      const bookName = positionals[2];
      const path = positionals[3];
      if (!bookName || !path || positionals.length > 4) return { error: "用法：mote book add travel ~/words.txt" };
      if (!isBookName(bookName)) return { error: "词本名称需要使用英文，例如 travel。" };
      return { command: "book", request: { action: "add", name: bookName, path } };
    }
    if (name === "remove") {
      const bookName = positionals[2];
      if (!bookName || positionals.length > 3) return { error: "用法：mote book remove travel" };
      if (!isBookName(bookName)) return { error: "词本名称需要使用英文，例如 travel。" };
      return { command: "book", request: { action: "remove", name: bookName } };
    }
    if (positionals.length > 2) return { error: "用法：mote book travel" };
    if (!isBookName(name)) return { error: "词本名称需要使用英文，例如 travel。" };
    return { command: "book", request: { action: "use", name } };
  }
  if (command === "fetch") {
    if (positionals.length > 2) return { error: "用法：mote fetch cet4" };
    const book = positionals[1];
    if (book && !isBookName(book)) return { error: "词本名称需要使用英文，例如 cet4 或 travel。" };
    return { command: "fetch", ...(book ? { book } : {}) };
  }
  if (command === "review") {
    if (positionals.length > 1) return { error: "review 不接受额外参数" };
    return { command: "review", limit: limit ?? null, token };
  }
  return { error: `未知命令：${command}` };
}

function parseLimit(value: string | undefined): number | string {
  if (!value || !/^\d+$/.test(value) || Number(value) < 1) return "--limit 需要正整数";
  return Number(value);
}

export function helpText(): string {
  return [
    "在终端里背单词。词本可以是墨墨今日任务，或内置的四级、六级、雅思、托福，也可以从文件导入。",
    "",
    "用法",
    "  mote                     打开当前词本，并从上次的单词继续",
    "  mote review --limit 10   本次最多练习 10 个单词",
    "  mote lookup <单词>       在墨墨词库里查询音标、释义、语块和例句",
    "  mote sync                拉取今日任务和官方进度",
    "  mote stats               分别显示官方进度和本地练习统计",
    "  mote auth                验证墨墨 API Token",
    "  mote book                显示当前词本",
    "  mote book maimemo        切换词本：maimemo、cet4、cet6、ielts、toefl，或自定义名称",
    "  mote book add travel ~/words.txt",
    "                           从文件导入词本并切换过去。一行一个单词",
    "  mote book remove travel  删除自定义词本",
    "  mote fetch               按顺序补齐当前词本里还没有的释义和读音",
    "  mote fetch cet4          补齐指定词本，例如 cet4 或 travel",
    "",
    "练习中：切到一个词就开始补齐本地没有的释义和读音。Space 显示或隐藏释义，p 播放读音。还没准备好的按钮会变浅。← → 切换单词，g 输入序号后回车跳转，q 保存并退出。",
    "这一版只适配 macOS。使用墨墨词本时，需要 ~/.config/mote.json 里的 maimemoToken。",
  ].join("\n");
}
