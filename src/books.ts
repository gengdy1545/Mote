import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isBookName } from "./config.js";
import { MaimemoError } from "./maimemo/errors.js";
import { bookLists } from "./books/lists.js";

const BUNDLED = {
  cet4: "四级",
  cet6: "六级",
  ielts: "雅思",
  toefl: "托福",
} as const;

type BundledId = keyof typeof BUNDLED;

export const RESERVED_BOOKS = ["maimemo", "cet4", "cet6", "ielts", "toefl"] as const;

export const BOOK_STUDY_DAY = "book";

export function isLocalBook(book: string): boolean {
  return book !== "maimemo";
}

export function isReservedBook(book: string): boolean {
  return (RESERVED_BOOKS as readonly string[]).includes(book);
}

export function bookTitle(book: string): string {
  if (book === "maimemo") return "墨墨";
  if (isBundled(book)) return BUNDLED[book];
  return book;
}

export function bookAccountKey(book: string): string {
  return `book:${book}`;
}

export function booksDirectory(dbPath: string): string {
  return join(dirname(dbPath), "books");
}

export function wordsFor(book: string, dbPath: string): readonly string[] {
  if (isBundled(book)) return bookLists[book];
  const path = customBookPath(dbPath, book);
  if (!existsSync(path)) throw new MaimemoError("not_found", `词本不存在：${book}`);
  return readWordList(readFileSync(path, "utf8"));
}

export function listCustomBooks(dbPath: string): string[] {
  const directory = booksDirectory(dbPath);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".txt"))
    .map((name) => name.slice(0, -4))
    .filter((name) => isBookName(name) && !isReservedBook(name))
    .sort();
}

export function importCustomBook(dbPath: string, name: string, sourcePath: string): string[] {
  assertCustomName(name);
  let text: string;
  try {
    text = readFileSync(sourcePath, "utf8");
  } catch {
    throw new MaimemoError("not_found", `找不到文件：${sourcePath}`);
  }
  const words = readWordList(text);
  if (words.length === 0) throw new MaimemoError("invalid", "词本里没有可用的单词。一行一个，例如 apple。");
  const directory = booksDirectory(dbPath);
  mkdirSync(directory, { recursive: true });
  writeFileSync(customBookPath(dbPath, name), `${words.join("\n")}\n`);
  return words;
}

export function removeCustomBook(dbPath: string, name: string): void {
  if (!isBookName(name)) throw new MaimemoError("invalid", "词本名称需要使用英文，例如 travel。");
  if (isReservedBook(name)) throw new MaimemoError("invalid", "内置词本不能删除。");
  const path = customBookPath(dbPath, name);
  if (!existsSync(path)) throw new MaimemoError("not_found", `词本不存在：${name}`);
  unlinkSync(path);
}

export function customBookExists(dbPath: string, name: string): boolean {
  return existsSync(customBookPath(dbPath, name));
}

function customBookPath(dbPath: string, name: string): string {
  return join(booksDirectory(dbPath), `${name}.txt`);
}

function assertCustomName(name: string): void {
  if (!isBookName(name)) throw new MaimemoError("invalid", "词本名称需要使用英文，例如 travel。");
  if (isReservedBook(name)) throw new MaimemoError("invalid", "这个名字是内置词本，不能用来导入。");
}

function isBundled(book: string): book is BundledId {
  return Object.prototype.hasOwnProperty.call(BUNDLED, book);
}

function readWordList(text: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const word = line.trim().toLowerCase();
    if (!word || word.startsWith("#")) continue;
    if (!/^[a-z][a-z .'’-]*$/.test(word) || !/[a-z]/.test(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}
