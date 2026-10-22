import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  appendBookWord,
  bookAccountKey,
  booksFolder,
  bookTitle,
  createCustomBook,
  customBookExists,
  importCustomBook,
  isLocalBook,
  isReservedBook,
  listCustomBooks,
  missingBookFiles,
  relocateBooks,
  removeCustomBook,
  wordsFor,
} from "../src/books.js";
import { MaimemoError } from "../src/maimemo/errors.js";
import { temporaryDirectory } from "./helpers.js";

function workspace(t: TestContext, name: string) {
  const root = temporaryDirectory(t, name);
  const dbPath = join(root, "data", "mote.db");
  const configPath = join(root, "mote.json");
  const booksPath = join(root, "library");
  mkdirSync(booksPath);
  writeFileSync(configPath, JSON.stringify({ booksPath }));
  return { root, dbPath, configPath, booksPath, env: { HOME: root } };
}

test("book metadata distinguishes Maimemo, bundled, and custom books", (t) => {
  const setup = workspace(t, "books-metadata");
  assert.equal(isLocalBook("maimemo"), false);
  assert.equal(isLocalBook("cet4"), true);
  assert.equal(isLocalBook("travel"), true);
  assert.equal(isReservedBook("maimemo"), true);
  assert.equal(isReservedBook("toefl"), true);
  assert.equal(isReservedBook("travel"), false);
  assert.equal(bookTitle("maimemo"), "墨墨");
  assert.equal(bookTitle("cet6"), "六级");
  assert.equal(bookTitle("travel"), "travel");
  assert.equal(bookAccountKey("travel"), "book:travel");
  assert.equal(booksFolder(setup.dbPath, setup.configPath, setup.env), setup.booksPath);
  assert.ok(wordsFor("cet4", setup.dbPath, setup.configPath, setup.env).length > 100);
});

test("custom book lifecycle keeps a sorted index and normalized unique words", (t) => {
  const setup = workspace(t, "books-lifecycle");
  const zooPath = createCustomBook(setup.dbPath, setup.configPath, "zoo", setup.env);
  const alphaPath = createCustomBook(setup.dbPath, setup.configPath, "alpha", setup.env);
  assert.equal(zooPath, join(setup.booksPath, "zoo.txt"));
  assert.equal(alphaPath, join(setup.booksPath, "alpha.txt"));
  assert.equal(readFileSync(alphaPath, "utf8"), "");
  assert.deepEqual(listCustomBooks(setup.dbPath), ["alpha", "zoo"]);
  assert.deepEqual(JSON.parse(readFileSync(join(setup.root, "data", "books.json"), "utf8")), ["alpha", "zoo"]);
  assert.equal(customBookExists(setup.dbPath, "alpha"), true);

  assert.deepEqual(appendBookWord(setup.dbPath, setup.configPath, "alpha", " Apple ", setup.env), {
    added: true,
    word: "apple",
    words: ["apple"],
  });
  assert.deepEqual(appendBookWord(setup.dbPath, setup.configPath, "alpha", "APPLE", setup.env), {
    added: false,
    word: "apple",
    words: ["apple"],
  });
  assert.deepEqual(appendBookWord(setup.dbPath, setup.configPath, "alpha", "ice cream", setup.env), {
    added: true,
    word: "ice cream",
    words: ["apple", "ice cream"],
  });
  assert.deepEqual(wordsFor("alpha", setup.dbPath, setup.configPath, setup.env), ["apple", "ice cream"]);
  assert.equal(readFileSync(alphaPath, "utf8"), "apple\nice cream\n");

  assert.throws(
    () => appendBookWord(setup.dbPath, setup.configPath, "alpha", "123", setup.env),
    (error: unknown) => error instanceof MaimemoError && error.kind === "invalid",
  );
  assert.throws(
    () => appendBookWord(setup.dbPath, setup.configPath, "cet4", "apple", setup.env),
    /内置词本不能添加单词/,
  );
  assert.throws(
    () => createCustomBook(setup.dbPath, setup.configPath, "alpha", setup.env),
    /词本已存在/,
  );
  assert.throws(
    () => createCustomBook(setup.dbPath, setup.configPath, "cet4", setup.env),
    /内置词本/,
  );

  removeCustomBook(setup.dbPath, setup.configPath, "zoo", setup.env);
  assert.equal(existsSync(zooPath), false);
  assert.deepEqual(listCustomBooks(setup.dbPath), ["alpha"]);
  assert.throws(
    () => removeCustomBook(setup.dbPath, setup.configPath, "zoo", setup.env),
    (error: unknown) => error instanceof MaimemoError && error.kind === "not_found",
  );
  assert.throws(
    () => removeCustomBook(setup.dbPath, setup.configPath, "maimemo", setup.env),
    /内置词本不能删除/,
  );
});

test("importCustomBook handles comments, CRLF, duplicates, overwrite, and invalid input", (t) => {
  const setup = workspace(t, "books-import");
  const source = join(setup.root, "words.txt");
  writeFileSync(source, "# Travel\r\n Apple \r\napple\r\nice cream\r\ncan't\r\nmother-in-law\r\n");
  assert.deepEqual(
    importCustomBook(setup.dbPath, setup.configPath, "travel", source, setup.env),
    ["apple", "ice cream", "can't", "mother-in-law"],
  );
  assert.equal(readFileSync(source, "utf8").startsWith("# Travel"), true);
  assert.equal(
    readFileSync(join(setup.booksPath, "travel.txt"), "utf8"),
    "apple\nice cream\ncan't\nmother-in-law\n",
  );
  assert.deepEqual(listCustomBooks(setup.dbPath), ["travel"]);

  writeFileSync(source, "pear\n");
  assert.deepEqual(importCustomBook(setup.dbPath, setup.configPath, "travel", source, setup.env), ["pear"]);
  assert.deepEqual(listCustomBooks(setup.dbPath), ["travel"]);
  assert.deepEqual(wordsFor("travel", setup.dbPath, setup.configPath, setup.env), ["pear"]);

  writeFileSync(source, "# comments only\n\n");
  assert.throws(
    () => importCustomBook(setup.dbPath, setup.configPath, "empty", source, setup.env),
    /词本里没有可用的单词/,
  );
  writeFileSync(source, "valid\nnot_a_word\n");
  assert.throws(
    () => importCustomBook(setup.dbPath, setup.configPath, "invalid", source, setup.env),
    /词本内容无效/,
  );
  assert.throws(
    () => importCustomBook(setup.dbPath, setup.configPath, "Bad", source, setup.env),
    /词本名称需要使用英文/,
  );
  assert.throws(
    () => importCustomBook(setup.dbPath, setup.configPath, "missing", join(setup.root, "none.txt"), setup.env),
    (error: unknown) => error instanceof MaimemoError && error.kind === "not_found",
  );
});

test("missing book files and malformed indexes are reported", (t) => {
  const setup = workspace(t, "books-missing");
  createCustomBook(setup.dbPath, setup.configPath, "beta", setup.env);
  createCustomBook(setup.dbPath, setup.configPath, "alpha", setup.env);
  unlinkSync(join(setup.booksPath, "beta.txt"));
  unlinkSync(join(setup.booksPath, "alpha.txt"));
  assert.deepEqual(missingBookFiles(setup.dbPath, setup.configPath, setup.env), [
    join(setup.booksPath, "alpha.txt"),
    join(setup.booksPath, "beta.txt"),
  ]);
  assert.throws(
    () => wordsFor("beta", setup.dbPath, setup.configPath, setup.env),
    /词本文件不存在/,
  );

  const index = join(setup.root, "data", "books.json");
  for (const invalid of ["{", "{}", '["alpha","alpha"]', '["Bad"]', '["alpha",1]']) {
    writeFileSync(index, invalid);
    assert.throws(() => listCustomBooks(setup.dbPath), /词本索引无法读取/);
  }
});

test("relocateBooks validates in preview mode and moves every indexed file on commit", (t) => {
  const setup = workspace(t, "books-relocate");
  createCustomBook(setup.dbPath, setup.configPath, "alpha", setup.env);
  createCustomBook(setup.dbPath, setup.configPath, "beta", setup.env);
  appendBookWord(setup.dbPath, setup.configPath, "alpha", "apple", setup.env);
  appendBookWord(setup.dbPath, setup.configPath, "beta", "banana", setup.env);

  const next = join(setup.root, "moved");
  assert.equal(relocateBooks(setup.dbPath, setup.configPath, next, setup.env), next);
  assert.equal(existsSync(next), false);
  assert.equal(existsSync(join(setup.booksPath, "alpha.txt")), true);

  assert.equal(relocateBooks(setup.dbPath, setup.configPath, next, setup.env, true), next);
  assert.equal(readFileSync(join(next, "alpha.txt"), "utf8"), "apple\n");
  assert.equal(readFileSync(join(next, "beta.txt"), "utf8"), "banana\n");
  assert.equal(existsSync(join(setup.booksPath, "alpha.txt")), false);

  writeFileSync(setup.configPath, JSON.stringify({ booksPath: next }));
  assert.equal(relocateBooks(setup.dbPath, setup.configPath, next, setup.env), next);
});

test("relocateBooks rejects missing parents, file destinations, conflicts, and missing sources", (t) => {
  const setup = workspace(t, "books-relocate-invalid");
  createCustomBook(setup.dbPath, setup.configPath, "alpha", setup.env);

  assert.throws(
    () => relocateBooks(setup.dbPath, setup.configPath, join(setup.root, "missing", "books"), setup.env),
    /目录不存在/,
  );

  const fileDestination = join(setup.root, "file");
  writeFileSync(fileDestination, "not a directory");
  assert.throws(
    () => relocateBooks(setup.dbPath, setup.configPath, fileDestination, setup.env),
    /文件已存在/,
  );

  const conflict = join(setup.root, "conflict");
  mkdirSync(conflict);
  writeFileSync(join(conflict, "alpha.txt"), "occupied");
  assert.throws(
    () => relocateBooks(setup.dbPath, setup.configPath, conflict, setup.env),
    /文件已存在/,
  );

  unlinkSync(join(setup.booksPath, "alpha.txt"));
  const clean = join(setup.root, "clean");
  assert.throws(
    () => relocateBooks(setup.dbPath, setup.configPath, clean, setup.env),
    /词本文件不存在/,
  );
});
