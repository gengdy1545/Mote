import { isBookName } from "../config.js";
import type { BookRequest } from "../commands/run.js";

export type ParsedArgs =
  | { command: "help" }
  | { command: "auth"; token?: string }
  | { command: "sync"; token?: string }
  | { command: "stats"; token?: string }
  | { command: "lookup"; word: string }
  | { command: "book"; request: BookRequest }
  | { command: "books"; directory?: string }
  | { command: "add"; word: string }
  | { command: "words" }
  | { command: "fetch"; book?: string }
  | { command: "review"; token?: string };

export function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  let token: string | undefined;
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
    if (item.startsWith("-")) return { error: `未知参数：${item}` };
    positionals.push(item);
  }

  const command = positionals[0];
  if (!command) return { command: "review", token };

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
    return { command: "lookup", word };
  }
  if (command === "words") {
    if (positionals.length > 1) return { error: "words 不接受额外参数" };
    return { command: "words" };
  }
  if (command === "add") {
    const word = positionals[1];
    if (!word || positionals.length > 2) return { error: "用法：mote add apple" };
    return { command: "add", word };
  }
  if (command === "book") {
    const name = positionals[1];
    if (!name) return { command: "book", request: { action: "show" } };
    if (name === "create") {
      const bookName = positionals[2];
      if (!bookName || positionals.length > 3) return { error: "用法：mote book create travel" };
      if (!isBookName(bookName)) return { error: "词本名称需要使用英文，例如 travel。" };
      return { command: "book", request: { action: "create", name: bookName } };
    }
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
    if (positionals[2] === "add") {
      const word = positionals[3];
      if (!word || positionals.length > 4) return { error: "用法：mote book travel add apple" };
      if (!isBookName(name)) return { error: "词本名称需要使用英文，例如 travel。" };
      return { command: "book", request: { action: "append", name, word } };
    }
    if (positionals.length > 2) return { error: "用法：mote book travel" };
    if (!isBookName(name)) return { error: "词本名称需要使用英文，例如 travel。" };
    return { command: "book", request: { action: "use", name } };
  }
  if (command === "books") {
    if (positionals.length > 2) return { error: "用法：mote books ~/books" };
    const directory = positionals[1];
    return { command: "books", ...(directory ? { directory } : {}) };
  }
  if (command === "fetch") {
    if (positionals.length > 2) return { error: "用法：mote fetch cet4" };
    const book = positionals[1];
    if (book && !isBookName(book)) return { error: "词本名称需要使用英文，例如 cet4 或 travel。" };
    return { command: "fetch", ...(book ? { book } : {}) };
  }
  return { error: `未知命令：${command}` };
}

export function helpText(): string {
  return [
    "在终端里背单词。词本可以是墨墨今日任务，或内置的四级、六级、雅思、托福，也可以创建，或从文件导入。",
    "",
    "用法",
    "  mote                     打开当前词本，并从上次的单词继续",
    "  mote lookup <单词>       显示释义并播放一次。p 再次发音，q 退出",
    "  mote sync                拉取今日任务和官方进度",
    "  mote stats               显示今日官方进度",
    "  mote auth                验证墨墨 API Token",
    "  mote words               翻页查看当前词本。← → 翻页，q 退出",
    "  mote book                显示当前词本",
    "  mote book maimemo        切换词本：maimemo、cet4、cet6、ielts、toefl，或自定义名称",
    "  mote book create travel  创建空词本并切换过去。文件名为 travel.txt",
    "  mote books               显示词书目录",
    "  mote books ~/books       回车确认后，把已有词书文件移到该目录",
    "  mote add apple           把 apple 加入当前词本的末尾",
    "  mote book add travel ~/words.txt",
    "                           从文件复制进词书目录并切换过去。同名时回车确认覆盖",
    "  mote book travel add apple",
    "                           把 apple 加入 travel 的末尾，不切换当前词本",
    "  mote book remove travel  删除自定义词本。回车确认，n 取消",
    "  mote fetch               按顺序补齐当前词本里还没有的释义和读音",
    "  mote fetch cet4          补齐指定词本，例如 cet4 或 travel",
    "",
    "练习中：切到一个词就开始补齐本地没有的释义和读音。Space 显示或隐藏释义，p 播放读音。还没准备好的按钮会变浅。← → 切换单词，g 输入序号后回车跳转，Esc 取消，q 保存并退出。",
    "mote sync、mote stats、mote auth 需要墨墨 API Token。当前词本是墨墨时，练习、mote words 和 mote fetch 也需要。Token 写在 ~/.config/mote.json 的 maimemoToken。",
  ].join("\n");
}
