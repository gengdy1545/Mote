import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test, { type TestContext } from "node:test";
import {
  BOOK_STUDY_DAY,
  bookAccountKey,
  createCustomBook,
} from "../src/books.js";
import type { IO } from "../src/commands/run.js";
import {
  runAuth,
  runBookCommand,
  runBooks,
  runFetch,
  runReview,
  runStats,
  runSync,
} from "../src/commands/run.js";
import { readConfig, writeBook } from "../src/config.js";
import { accountKey } from "../src/study/account.js";
import { studyDay } from "../src/study/day.js";
import {
  getSession,
  getSnapshot,
  openDatabase,
  saveSession,
  saveSnapshot,
} from "../src/storage/db.js";
import { jsonResponse, replaceFetch, temporaryDirectory } from "./helpers.js";

function workspace(t: TestContext, name: string) {
  const root = temporaryDirectory(t, name);
  const dbPath = join(root, "data", "mote.db");
  const configPath = join(root, "mote.json");
  const booksPath = join(root, "books");
  const logPath = join(root, "mote.log");
  mkdirSync(booksPath);
  writeFileSync(configPath, JSON.stringify({
    book: "maimemo",
    dbPath,
    logPath,
    booksPath,
    pageSize: 7,
  }));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: IO = {
    env: { HOME: root },
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    now: () => new Date("2026-10-22T09:00:00.000Z"),
    dbPath,
    configPath,
  };
  return { root, dbPath, configPath, booksPath, logPath, stdout, stderr, io };
}

test("runSync fetches, sorts, limits, persists, and prints today's official snapshot", async (t) => {
  const setup = workspace(t, "commands-sync");
  writeFileSync(setup.configPath, JSON.stringify({
    ...readConfig(setup.configPath),
    maimemoToken: "secret",
  }));
  const requestBodies: unknown[] = [];
  replaceFetch(t, async (input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("get_study_progress")) {
      return jsonResponse({ data: { progress: { finished: 1, total: 2 } } });
    }
    return jsonResponse({
      data: {
        today_items: [
          { voc_id: "3", voc_spelling: "cherry", order: 3 },
          { voc_id: "2", voc_spelling: "banana", order: 2 },
          { voc_id: "1", voc_spelling: "apple", order: 1 },
        ],
      },
    });
  });

  assert.equal(await runSync(setup.io), 0);
  assert.deepEqual(requestBodies, [{}, { limit: 2 }]);
  assert.deepEqual(setup.stdout, [
    [
      "墨墨今日已完成：1 / 2",
      "官方快照：2026-10-22 17:00",
      "今日任务：2 个",
    ].join("\n"),
  ]);

  const db = openDatabase(setup.dbPath);
  const saved = getSnapshot(db, accountKey("secret"), "2026-10-22");
  db.close();
  assert.deepEqual(saved?.items.map((item) => item.spelling), ["apple", "banana"]);
  assert.equal(saved?.fetchedAt, "2026-10-22T09:00:00.000Z");
});

test("runSync falls back to the same-day snapshot after a network failure", async (t) => {
  const setup = workspace(t, "commands-sync-offline");
  writeFileSync(setup.configPath, JSON.stringify({
    ...readConfig(setup.configPath),
    maimemoToken: "secret",
  }));
  const db = openDatabase(setup.dbPath);
  saveSnapshot(db, {
    accountKey: accountKey("secret"),
    studyDay: studyDay(setup.io.now()),
    fetchedAt: "2026-10-22T08:00:00.000Z",
    progress: { finished: 2, total: 3 },
    items: [{ vocId: "1", spelling: "apple", order: 1 }],
    truncated: false,
  });
  db.close();
  replaceFetch(t, async () => {
    throw new Error("offline");
  });

  assert.equal(await runSync(setup.io), 0);
  assert.deepEqual(setup.stdout, [
    [
      "墨墨今日已完成：2 / 3",
      "官方快照：2026-10-22 16:00",
      "今日任务：1 个",
    ].join("\n"),
  ]);
});

test("runSync prints the empty-task guidance and skips the item request when total is zero", async (t) => {
  const setup = workspace(t, "commands-sync-empty");
  writeFileSync(setup.configPath, JSON.stringify({
    ...readConfig(setup.configPath),
    maimemoToken: "secret",
  }));
  let calls = 0;
  replaceFetch(t, async () => {
    calls += 1;
    return jsonResponse({ data: { progress: { finished: 0, total: 0 } } });
  });
  assert.equal(await runSync(setup.io), 0);
  assert.equal(calls, 1);
  assert.match(setup.stdout[0] ?? "", /今日没有单词/);
  assert.doesNotMatch(setup.stdout[0] ?? "", /今日任务：/);
});

test("runStats reads only today's account snapshot and reports a missing one", async (t) => {
  const setup = workspace(t, "commands-stats");
  writeFileSync(setup.configPath, JSON.stringify({
    ...readConfig(setup.configPath),
    maimemoToken: "secret",
  }));
  await assert.rejects(runStats(setup.io), /还没有今日官方快照/);

  const db = openDatabase(setup.dbPath);
  saveSnapshot(db, {
    accountKey: accountKey("secret"),
    studyDay: "2026-10-22",
    fetchedAt: "2026-10-22T09:00:00.000Z",
    progress: { finished: 3, total: 4 },
    items: [{ vocId: "1", spelling: "apple", order: 1 }],
    truncated: true,
  });
  db.close();
  assert.equal(await runStats(setup.io), 0);
  assert.match(setup.stdout[0] ?? "", /墨墨今日已完成：3 \/ 4/);
  assert.match(setup.stdout[0] ?? "", /今日任务可能不完整/);
});

test("runAuth verifies a flag token before persisting it", async (t) => {
  const setup = workspace(t, "commands-auth");
  let authorization = "";
  replaceFetch(t, async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return jsonResponse({ data: { progress: { finished: 5, total: 8 } } });
  });

  assert.equal(await runAuth(setup.io, "new-secret"), 0);
  assert.equal(authorization, "Bearer new-secret");
  assert.equal(readConfig(setup.configPath).maimemoToken, "new-secret");
  assert.deepEqual(setup.stdout, ["认证有效\n墨墨今日已完成：5 / 8"]);
});

test("book commands create, append, select, show, and reject missing custom books", async (t) => {
  const setup = workspace(t, "commands-books");
  assert.equal(await runBookCommand(setup.io, { action: "create", name: "travel" }), 0);
  assert.equal(readConfig(setup.configPath).book, "travel");
  assert.equal(readFileSync(join(setup.booksPath, "travel.txt"), "utf8"), "");

  assert.equal(await runBookCommand(setup.io, { action: "append", word: " Apple " }), 0);
  assert.equal(await runBookCommand(setup.io, { action: "append", name: "travel", word: "apple" }), 0);
  assert.equal(readFileSync(join(setup.booksPath, "travel.txt"), "utf8"), "apple\n");
  assert.match(setup.stdout.at(-1) ?? "", /已经在 travel 里/);

  assert.equal(await runBookCommand(setup.io, { action: "use", name: "cet4" }), 0);
  assert.equal(readConfig(setup.configPath).book, "cet4");
  assert.equal(await runBookCommand(setup.io, { action: "show" }), 0);
  assert.match(setup.stdout.at(-1) ?? "", /当前词本：四级 \(cet4\)/);
  assert.match(setup.stdout.at(-1) ?? "", /自定义：travel/);
  assert.deepEqual(setup.stderr, []);

  await assert.rejects(
    runBookCommand(setup.io, { action: "use", name: "missing" }),
    /词本不存在：missing/,
  );
});

test("importing a book resets an existing local session to the new queue", async (t) => {
  const setup = workspace(t, "commands-import");
  const db = openDatabase(setup.dbPath);
  saveSession(db, {
    accountKey: bookAccountKey("travel"),
    studyDay: BOOK_STUDY_DAY,
    queue: ["old"],
    index: 7,
  });
  db.close();
  const source = join(setup.root, "words.txt");
  writeFileSync(source, "banana\napple\n");

  assert.equal(await runBookCommand(setup.io, {
    action: "add",
    name: "travel",
    path: source,
  }), 0);
  assert.equal(readConfig(setup.configPath).book, "travel");
  const reopened = openDatabase(setup.dbPath);
  assert.deepEqual(getSession(reopened, bookAccountKey("travel"), BOOK_STUDY_DAY), {
    accountKey: bookAccountKey("travel"),
    studyDay: BOOK_STUDY_DAY,
    queue: ["banana", "apple"],
    index: 0,
  });
  reopened.close();
  assert.match(setup.stdout[0] ?? "", /共 2 个词/);
});

test("books command reports the directory and avoids confirmation when unchanged", async (t) => {
  const setup = workspace(t, "commands-directory");
  assert.equal(await runBooks(setup.io), 0);
  assert.equal(setup.stdout[0], `词书目录：${setup.booksPath}`);
  assert.equal(await runBooks(setup.io, setup.booksPath), 0);
  assert.equal(setup.stdout[1], `词书目录未改变：${setup.booksPath}`);
});

test("runFetch skips complete cached local entries without network access", async (t) => {
  const setup = workspace(t, "commands-fetch");
  createCustomBook(setup.dbPath, setup.configPath, "travel", setup.io.env);
  writeFileSync(join(setup.booksPath, "travel.txt"), "apple\n");
  writeBook(setup.configPath, "travel");
  const audioPath = join(setup.root, "data", "audio", "apple-us.mp3");
  mkdirSync(join(setup.root, "data", "audio"), { recursive: true });
  writeFileSync(audioPath, Buffer.concat([Buffer.from("ID3"), Buffer.alloc(61)]));
  const db = openDatabase(setup.dbPath);
  db.prepare(
    `INSERT INTO dict_words (spelling, phonetic_us, phonetic_uk, audio_us_path, gloss_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("apple", "ˈæpəl", "", join("audio", "apple-us.mp3"), "2026-10-22T09:00:00.000Z");
  db.prepare(
    `INSERT INTO dict_senses (spelling, position, pos, gloss, lang)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("apple", 0, "n.", "苹果", "zh");
  db.close();
  replaceFetch(t, async () => {
    throw new Error("network should not be used");
  });

  assert.equal(await runFetch(setup.io), 0);
  assert.deepEqual(setup.stdout, ["完成。跳过 1，写入 0，未完成 0。"]);
});

test("runReview handles an empty local book without requiring a TTY", async (t) => {
  const setup = workspace(t, "commands-review-empty");
  createCustomBook(setup.dbPath, setup.configPath, "empty", setup.io.env);
  writeBook(setup.configPath, "empty");
  assert.equal(await runReview(setup.io), 0);
  assert.deepEqual(setup.stdout, ["这本词书是空的。"]);
});

test("CLI entrypoint exits successfully for help and fails clearly for bad arguments", (t) => {
  const home = temporaryDirectory(t, "commands-cli");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const base = {
    cwd: root,
    encoding: "utf8" as const,
    env: { ...process.env, HOME: home },
  };
  const help = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "--help"], base);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /mote sync/);
  assert.equal(readConfig(join(home, ".config", "mote.json")).book, "maimemo");

  const invalid = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "unknown"], base);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /未知命令：unknown/);
  assert.match(invalid.stderr, /用法/);
});
