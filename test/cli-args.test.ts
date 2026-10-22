import assert from "node:assert/strict";
import test from "node:test";
import { helpText, parseArgs } from "../src/cli/args.js";

test("parseArgs parses every documented command", async (t) => {
  const cases: Array<{ argv: string[]; expected: ReturnType<typeof parseArgs> }> = [
    { argv: [], expected: { command: "review", token: undefined } },
    { argv: ["--token", "secret"], expected: { command: "review", token: "secret" } },
    { argv: ["-T", "secret", "sync"], expected: { command: "sync", token: "secret" } },
    { argv: ["stats", "--token=secret"], expected: { command: "stats", token: "secret" } },
    { argv: ["auth"], expected: { command: "auth", token: undefined } },
    { argv: ["lookup", "apple"], expected: { command: "lookup", word: "apple" } },
    { argv: ["words"], expected: { command: "words" } },
    { argv: ["add", "apple"], expected: { command: "add", word: "apple" } },
    { argv: ["book"], expected: { command: "book", request: { action: "show" } } },
    { argv: ["book", "cet4"], expected: { command: "book", request: { action: "use", name: "cet4" } } },
    {
      argv: ["book", "create", "travel"],
      expected: { command: "book", request: { action: "create", name: "travel" } },
    },
    {
      argv: ["book", "add", "travel", "~/words.txt"],
      expected: { command: "book", request: { action: "add", name: "travel", path: "~/words.txt" } },
    },
    {
      argv: ["book", "travel", "add", "apple"],
      expected: { command: "book", request: { action: "append", name: "travel", word: "apple" } },
    },
    {
      argv: ["book", "remove", "travel"],
      expected: { command: "book", request: { action: "remove", name: "travel" } },
    },
    { argv: ["books"], expected: { command: "books" } },
    { argv: ["books", "~/books"], expected: { command: "books", directory: "~/books" } },
    { argv: ["fetch"], expected: { command: "fetch" } },
    { argv: ["fetch", "travel"], expected: { command: "fetch", book: "travel" } },
    { argv: ["help"], expected: { command: "help" } },
    { argv: ["anything", "--help"], expected: { command: "help" } },
  ];

  for (const { argv, expected } of cases) {
    await t.test(argv.length > 0 ? argv.join(" ") : "default review", () => {
      assert.deepEqual(parseArgs(argv), expected);
    });
  }
});

test("parseArgs reports invalid flags, names, arity, and commands", async (t) => {
  const cases: Array<{ argv: string[]; message: string }> = [
    { argv: ["--token"], message: "缺少 --token 的值" },
    { argv: ["--unknown"], message: "未知参数：--unknown" },
    { argv: ["auth", "extra"], message: "auth 不接受额外参数" },
    { argv: ["sync", "extra"], message: "sync 不接受额外参数" },
    { argv: ["stats", "extra"], message: "stats 不接受额外参数" },
    { argv: ["lookup"], message: "用法：mote lookup <单词>" },
    { argv: ["lookup", "one", "two"], message: "lookup 只接受一个单词" },
    { argv: ["words", "extra"], message: "words 不接受额外参数" },
    { argv: ["add"], message: "用法：mote add apple" },
    { argv: ["book", "create"], message: "用法：mote book create travel" },
    { argv: ["book", "create", "Travel"], message: "词本名称需要使用英文，例如 travel。" },
    { argv: ["book", "add", "travel"], message: "用法：mote book add travel ~/words.txt" },
    { argv: ["book", "add", "bad_name", "words.txt"], message: "词本名称需要使用英文，例如 travel。" },
    { argv: ["book", "remove"], message: "用法：mote book remove travel" },
    { argv: ["book", "bad_name", "add", "apple"], message: "词本名称需要使用英文，例如 travel。" },
    { argv: ["book", "travel", "add"], message: "用法：mote book travel add apple" },
    { argv: ["book", "travel", "extra"], message: "用法：mote book travel" },
    { argv: ["book", "Bad"], message: "词本名称需要使用英文，例如 travel。" },
    { argv: ["books", "one", "two"], message: "用法：mote books ~/books" },
    { argv: ["fetch", "one", "two"], message: "用法：mote fetch cet4" },
    { argv: ["fetch", "bad_name"], message: "词本名称需要使用英文，例如 cet4 或 travel。" },
    { argv: ["unknown"], message: "未知命令：unknown" },
  ];

  for (const { argv, message } of cases) {
    await t.test(argv.join(" "), () => {
      assert.deepEqual(parseArgs(argv), { error: message });
    });
  }
});

test("helpText documents the README command surface and controls", () => {
  const help = helpText();
  for (const command of [
    "mote lookup <单词>",
    "mote sync",
    "mote stats",
    "mote auth",
    "mote words",
    "mote book create travel",
    "mote book add travel ~/words.txt",
    "mote book travel add apple",
    "mote book remove travel",
    "mote books ~/books",
    "mote fetch cet4",
  ]) {
    assert.match(help, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(help, /Space 显示或隐藏释义/);
  assert.match(help, /墨墨 API Token/);
});
