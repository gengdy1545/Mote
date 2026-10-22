import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultBooksPath, isBookName, readConfig, resolveUserPath } from "./config.js";
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

function booksDirectory(dbPath: string, configPath: string, env: NodeJS.ProcessEnv): string {
  const configured = readConfig(configPath).booksPath;
  return configured ? resolveUserPath(configured, env) : defaultBooksPath(dbPath);
}

export function booksFolder(dbPath: string, configPath: string, env: NodeJS.ProcessEnv = process.env): string {
  return booksDirectory(dbPath, configPath, env);
}

export function wordsFor(
  book: string,
  dbPath: string,
  configPath: string,
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  if (isBundled(book)) return bookLists[book];
  return readCustomWords(requireBookFile(dbPath, configPath, book, env));
}

export function listCustomBooks(dbPath: string): string[] {
  return readBookNames(dbPath).slice().sort();
}

export function missingBookFiles(dbPath: string, configPath: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const folder = booksDirectory(dbPath, configPath, env);
  return readBookNames(dbPath)
    .map((name) => bookPath(folder, name))
    .filter((file) => !existsSync(file))
    .sort();
}

export function importCustomBook(
  dbPath: string,
  configPath: string,
  name: string,
  sourcePath: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  assertCustomName(name);
  const path = resolveUserPath(sourcePath, env);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new MaimemoError("not_found", `找不到文件：${path}`);
  }
  const words = parseBook(text, path);
  if (words.length === 0) throw new MaimemoError("invalid", "词本里没有可用的单词。一行一个，例如 apple。");
  const folder = booksDirectory(dbPath, configPath, env);
  if (!existsSync(folder) || !isDirectory(folder)) throw new MaimemoError("not_found", `目录不存在：${folder}`);
  const destination = bookPath(folder, name);
  writeFileSync(destination, `${words.join("\n")}\n`);
  const names = readBookNames(dbPath);
  if (!names.includes(name)) writeBookNames(dbPath, [...names, name]);
  return words;
}

export function createCustomBook(
  dbPath: string,
  configPath: string,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  assertCustomName(name);
  if (readBookNames(dbPath).includes(name)) throw new MaimemoError("invalid", `词本已存在：${name}`);
  const folder = booksDirectory(dbPath, configPath, env);
  if (!existsSync(folder) || !isDirectory(folder)) throw new MaimemoError("not_found", `目录不存在：${folder}`);
  const destination = bookPath(folder, name);
  if (existsSync(destination)) throw new MaimemoError("invalid", `文件已存在：${destination}`);
  writeFileSync(destination, "");
  writeBookNames(dbPath, [...readBookNames(dbPath), name]);
  return destination;
}

export function appendBookWord(
  dbPath: string,
  configPath: string,
  name: string,
  spelling: string,
  env: NodeJS.ProcessEnv = process.env,
): { added: boolean; word: string; words: string[] } {
  if (isReservedBook(name)) throw new MaimemoError("invalid", "内置词本不能添加单词。");
  const word = normalizeWord(spelling);
  if (!word) throw new MaimemoError("invalid", "单词需要使用英文，例如 apple。");
  const path = requireBookFile(dbPath, configPath, name, env);
  const words = readCustomWords(path);
  if (words.includes(word)) return { added: false, word, words };
  words.push(word);
  writeFileSync(path, `${words.join("\n")}\n`);
  return { added: true, word, words };
}

export function removeCustomBook(
  dbPath: string,
  configPath: string,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isBookName(name)) throw new MaimemoError("invalid", "词本名称需要使用英文，例如 travel。");
  if (isReservedBook(name)) throw new MaimemoError("invalid", "内置词本不能删除。");
  const names = readBookNames(dbPath);
  if (!names.includes(name)) throw new MaimemoError("not_found", `词本不存在：${name}`);
  const file = bookPath(booksDirectory(dbPath, configPath, env), name);
  if (existsSync(file)) unlinkSync(file);
  writeBookNames(dbPath, names.filter((item) => item !== name));
}

export function customBookExists(dbPath: string, name: string): boolean {
  return readBookNames(dbPath).includes(name);
}

export function relocateBooks(
  dbPath: string,
  configPath: string,
  directory: string,
  env: NodeJS.ProcessEnv = process.env,
  commit = false,
): string {
  const current = booksDirectory(dbPath, configPath, env);
  const next = resolveUserPath(directory, env);
  if (next === current) return current;
  if (existsSync(next) && !isDirectory(next)) throw new MaimemoError("invalid", `文件已存在：${next}`);
  if (!existsSync(next)) {
    const parent = dirname(next);
    if (!existsSync(parent) || !isDirectory(parent)) throw new MaimemoError("not_found", `目录不存在：${parent}`);
  }
  const names = readBookNames(dbPath);
  for (const name of names) {
    const from = bookPath(current, name);
    if (!existsSync(from)) throw new MaimemoError("not_found", `词本文件不存在：${from}`);
    const to = bookPath(next, name);
    if (existsSync(to)) throw new MaimemoError("invalid", `文件已存在：${to}`);
  }
  if (!commit) return next;
  if (!existsSync(next)) mkdirSync(next);
  for (const name of names) moveFile(bookPath(current, name), bookPath(next, name));
  return next;
}

function bookIndexPath(dbPath: string): string {
  return join(dirname(dbPath), "books.json");
}

function readBookNames(dbPath: string): string[] {
  const path = bookIndexPath(dbPath);
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new MaimemoError("invalid", "词本索引无法读取");
  }
  if (!Array.isArray(parsed)) throw new MaimemoError("invalid", "词本索引无法读取");
  const names: string[] = [];
  const seen = new Set<string>();
  for (const name of parsed) {
    if (typeof name !== "string" || !isBookName(name) || seen.has(name)) throw new MaimemoError("invalid", "词本索引无法读取");
    seen.add(name);
    names.push(name);
  }
  return names;
}

function writeBookNames(dbPath: string, names: string[]): void {
  const path = bookIndexPath(dbPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(names.slice().sort(), null, 2)}\n`);
}

function bookPath(folder: string, name: string): string {
  return join(folder, `${name}.txt`);
}

function requireBookFile(dbPath: string, configPath: string, name: string, env: NodeJS.ProcessEnv): string {
  if (!readBookNames(dbPath).includes(name)) throw new MaimemoError("not_found", `词本不存在：${name}`);
  const file = bookPath(booksDirectory(dbPath, configPath, env), name);
  if (!existsSync(file)) throw new MaimemoError("not_found", `词本文件不存在：${file}`);
  return file;
}

function readCustomWords(file: string): string[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new MaimemoError("invalid", `词本无法读取：${file}`);
  }
  return parseBook(text, file);
}

function parseBook(text: string, file: string): string[] {
  if (text.trim() === "") return [];
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    if (!normalizeWord(line)) throw new MaimemoError("invalid", `词本内容无效：${file}`);
  }
  return readWordList(text);
}

function moveFile(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EXDEV") throw error;
    copyFileSync(from, to);
    unlinkSync(from);
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function assertCustomName(name: string): void {
  if (!isBookName(name)) throw new MaimemoError("invalid", "词本名称需要使用英文，例如 travel。");
  if (isReservedBook(name)) throw new MaimemoError("invalid", "这个名字是内置词本。");
}

function isBundled(book: string): book is BundledId {
  return Object.prototype.hasOwnProperty.call(BUNDLED, book);
}

function readWordList(text: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const word = normalizeWord(line);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

function normalizeWord(value: string): string | null {
  const word = value.trim().toLowerCase();
  if (!word || word.startsWith("#")) return null;
  if (!/^[a-z][a-z .'’-]*$/.test(word) || !/[a-z]/.test(word)) return null;
  return word;
}
