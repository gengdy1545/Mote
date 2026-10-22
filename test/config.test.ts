import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  appendErrorLog,
  configFilePath,
  defaultBooksPath,
  defaultDbPath,
  defaultLogPath,
  ensureConfig,
  isBookName,
  readConfig,
  resolveBook,
  resolveDbPath,
  resolveLogPath,
  resolveMaimemoToken,
  resolvePageSize,
  resolveUserPath,
  writeBook,
  writeBooksPath,
  writeErrorLog,
  writeMaimemoToken,
} from "../src/config.js";
import { MaimemoError } from "../src/maimemo/errors.js";
import { temporaryDirectory } from "./helpers.js";

test("book names accept lowercase slugs and reject unsafe names", () => {
  for (const name of ["a", "travel", "cet-4", "book2", "a".repeat(32)]) {
    assert.equal(isBookName(name), true, name);
  }
  for (const name of ["", "Travel", "two words", "bad_name", "-book", "book-", "a--b", "1book", "a".repeat(33)]) {
    assert.equal(isBookName(name), false, name);
  }
});

test("path helpers use HOME, expand only the current home, and resolve relative paths", () => {
  const env = { HOME: "/tmp/mote-home" };
  assert.equal(configFilePath(env), "/tmp/mote-home/.config/mote.json");
  assert.equal(defaultDbPath(env), "/tmp/mote-home/.local/share/mote/mote.db");
  assert.equal(defaultLogPath(env), "/tmp/mote-home/.local/share/mote/mote.log");
  assert.equal(defaultBooksPath("/data/mote.db"), "/data/books");
  assert.equal(resolveUserPath("~", env), "/tmp/mote-home");
  assert.equal(resolveUserPath("~/books/list.txt", env), "/tmp/mote-home/books/list.txt");
  assert.equal(resolveUserPath("relative/file", env), resolve("relative/file"));
  assert.throws(
    () => resolveUserPath("~someone/file", env),
    (error: unknown) => error instanceof MaimemoError && error.kind === "invalid" && /无法解析路径/.test(error.message),
  );
});

test("readConfig handles a missing file, trims paths, and ignores unrelated value types", (t) => {
  const root = temporaryDirectory(t, "config-read");
  const path = join(root, "mote.json");
  assert.deepEqual(readConfig(path), {});

  writeFileSync(path, JSON.stringify({
    maimemoToken: " token ",
    book: "travel",
    dbPath: "  ~/mote.db  ",
    logPath: "  ./mote.log ",
    booksPath: " /books ",
    pageSize: 9,
    ignored: true,
  }));
  assert.deepEqual(readConfig(path), {
    maimemoToken: " token ",
    book: "travel",
    dbPath: "~/mote.db",
    logPath: "./mote.log",
    booksPath: "/books",
    pageSize: 9,
  });

  writeFileSync(path, JSON.stringify({
    maimemoToken: 1,
    dbPath: " ",
    logPath: null,
    booksPath: false,
  }));
  assert.deepEqual(readConfig(path), {});
});

test("readConfig rejects malformed JSON, non-objects, invalid books, and invalid page sizes", async (t) => {
  const root = temporaryDirectory(t, "config-invalid");
  const path = join(root, "mote.json");
  const cases: Array<{ value: string; message: RegExp }> = [
    { value: "{", message: /配置文件无法读取/ },
    { value: "[]", message: /配置文件无法读取/ },
    { value: "null", message: /配置文件无法读取/ },
    { value: JSON.stringify({ book: "Bad_Name" }), message: /book 无效/ },
    { value: JSON.stringify({ pageSize: 0 }), message: /pageSize 无效/ },
    { value: JSON.stringify({ pageSize: 1.5 }), message: /pageSize 无效/ },
    { value: JSON.stringify({ pageSize: "7" }), message: /pageSize 无效/ },
  ];

  for (const [index, item] of cases.entries()) {
    await t.test(String(index), () => {
      writeFileSync(path, item.value);
      assert.throws(() => readConfig(path), item.message);
    });
  }
});

test("ensureConfig creates private defaults and writer helpers preserve existing values", (t) => {
  const root = temporaryDirectory(t, "config-write");
  const previousHome = process.env.HOME;
  process.env.HOME = root;
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  });

  const path = join(root, ".config", "mote.json");
  const dbPath = join(root, "data", "mote.db");
  ensureConfig(path, dbPath);
  assert.deepEqual(readConfig(path), {
    book: "maimemo",
    dbPath,
    logPath: join(root, ".local", "share", "mote", "mote.log"),
    booksPath: join(root, "data", "books"),
    pageSize: 7,
  });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(resolveDbPath(path, { HOME: root }), dbPath);
  assert.equal(resolveLogPath(path, { HOME: root }), join(root, ".local", "share", "mote", "mote.log"));
  assert.equal(resolveBook(path), "maimemo");
  assert.equal(resolvePageSize(path), 7);

  writeMaimemoToken(path, "secret");
  writeBook(path, "travel");
  writeBooksPath(path, "~/library");
  assert.deepEqual(readConfig(path), {
    maimemoToken: "secret",
    book: "travel",
    dbPath,
    logPath: join(root, ".local", "share", "mote", "mote.log"),
    booksPath: "~/library",
    pageSize: 7,
  });

  ensureConfig(path, join(root, "other.db"));
  assert.equal(readConfig(path).dbPath, dbPath);
});

test("token resolution gives the flag priority and reports a missing token", (t) => {
  const root = temporaryDirectory(t, "config-token");
  const path = join(root, "mote.json");
  writeFileSync(path, JSON.stringify({ maimemoToken: "from-file" }));
  assert.equal(resolveMaimemoToken({ flag: "from-flag", configPath: path }), "from-flag");
  assert.equal(resolveMaimemoToken({ configPath: path }), "from-file");

  writeFileSync(path, "{}");
  assert.throws(
    () => resolveMaimemoToken({ configPath: path }),
    (error: unknown) => error instanceof MaimemoError && error.kind === "missing_token",
  );
});

test("error logs omit blank lines and redact the configured token", (t) => {
  const root = temporaryDirectory(t, "config-log");
  const directLog = join(root, "logs", "direct.log");
  appendErrorLog(directLog, "first\n\n second");
  const direct = readFileSync(directLog, "utf8").trimEnd().split("\n");
  assert.equal(direct.length, 2);
  assert.match(direct[0] ?? "", /^\d{4}-\d{2}-\d{2}T.*  first$/);
  assert.match(direct[1] ?? "", /^\d{4}-\d{2}-\d{2}T.*   second$/);

  const configPath = join(root, "mote.json");
  const redactedLog = join(root, "redacted.log");
  writeFileSync(configPath, JSON.stringify({ maimemoToken: "top-secret", logPath: redactedLog }));
  writeErrorLog(configPath, { HOME: root }, "request top-secret failed\ntop-secret");
  const logged = readFileSync(redactedLog, "utf8");
  assert.doesNotMatch(logged, /top-secret/);
  assert.equal(logged.match(/\[已隐藏\]/g)?.length, 2);
});
