import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { MaimemoError, sanitize } from "./maimemo/errors.js";

export type BookChoice = string;

export type MoteConfig = {
  maimemoToken?: string;
  book?: BookChoice;
  dbPath?: string;
  logPath?: string;
  booksPath?: string;
  pageSize?: number;
};

export function isBookName(value: string): boolean {
  return value.length <= 32 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
}

function expandHome(path: string, env: NodeJS.ProcessEnv): string {
  // shortcut: only "~" and "~/...", not "~user"; upgrade if another user's home is needed
  if (path !== "~" && !path.startsWith("~/")) return path;
  const home = env.HOME || homedir();
  return path === "~" ? home : join(home, path.slice(2));
}

export function resolveUserPath(path: string, env: NodeJS.ProcessEnv = process.env): string {
  if (path.startsWith("~") && path !== "~" && !path.startsWith("~/")) {
    throw new MaimemoError("invalid", `无法解析路径：${path}`);
  }
  let expanded: string;
  try {
    expanded = expandHome(path, env);
  } catch {
    throw new MaimemoError("invalid", `无法解析路径：${path}`);
  }
  if (!expanded || expanded.startsWith("~")) throw new MaimemoError("invalid", `无法解析路径：${path}`);
  return resolve(expanded);
}

function dataHome(env: NodeJS.ProcessEnv): string {
  return join(env.HOME || homedir(), ".local", "share");
}

export function defaultLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(dataHome(env), "mote", "mote.log");
}

export function defaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(dataHome(env), "mote", "mote.db");
}

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.HOME || homedir(), ".config", "mote.json");
}

export function readConfig(path: string): MoteConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (isMissingFile(error)) return {};
    throw new MaimemoError("invalid", "配置文件无法读取");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MaimemoError("invalid", "配置文件无法读取");
  }
  const record = parsed as { maimemoToken?: unknown; book?: unknown; dbPath?: unknown; logPath?: unknown; booksPath?: unknown; pageSize?: unknown };
  const config: MoteConfig = {};
  if (typeof record.maimemoToken === "string") config.maimemoToken = record.maimemoToken;
  if (typeof record.dbPath === "string" && record.dbPath.trim()) config.dbPath = record.dbPath.trim();
  if (typeof record.logPath === "string" && record.logPath.trim()) config.logPath = record.logPath.trim();
  if (typeof record.booksPath === "string" && record.booksPath.trim()) config.booksPath = record.booksPath.trim();
  if (record.pageSize != null) {
    if (typeof record.pageSize !== "number" || !Number.isInteger(record.pageSize) || record.pageSize < 1) {
      throw new MaimemoError("invalid", "配置里的 pageSize 无效。使用正整数，例如 7。");
    }
    config.pageSize = record.pageSize;
  }
  if (typeof record.book === "string") {
    if (!isBookName(record.book)) {
      throw new MaimemoError("invalid", "配置里的 book 无效。使用小写英文，例如 maimemo 或 travel。");
    }
    config.book = record.book;
  }
  return config;
}

export function defaultBooksPath(dbPath: string): string {
  return join(dirname(dbPath), "books");
}

export function resolveDbPath(configPath: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = readConfig(configPath).dbPath;
  return configured ? resolveUserPath(configured, env) : defaultDbPath(env);
}

export function resolveLogPath(configPath: string, env: NodeJS.ProcessEnv = process.env): string {
  const configured = readConfig(configPath).logPath;
  return configured ? resolveUserPath(configured, env) : defaultLogPath(env);
}

export function appendErrorLog(logPath: string, message: string): void {
  for (const line of message.split("\n")) {
    if (!line.trim()) continue;
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, `${new Date().toISOString()}  ${line}\n`);
    } catch {
      return;
    }
  }
}

export function writeErrorLog(configPath: string, env: NodeJS.ProcessEnv, message: string): void {
  let logPath: string;
  try {
    logPath = resolveLogPath(configPath, env);
  } catch {
    return;
  }
  let text = message;
  try {
    text = sanitize(message, readConfig(configPath).maimemoToken);
  } catch {
    // The config could not be read. Keep the original message.
  }
  appendErrorLog(logPath, text);
}

export function resolveBook(path: string): BookChoice {
  return readConfig(path).book ?? "maimemo";
}

export function writeMaimemoToken(path: string, token: string): void {
  writeConfig(path, { ...readConfig(path), maimemoToken: token });
}

export function writeBook(path: string, book: BookChoice): void {
  writeConfig(path, { ...readConfig(path), book });
}

export function writeBooksPath(path: string, booksPath: string): void {
  writeConfig(path, { ...readConfig(path), booksPath });
}

export function resolvePageSize(configPath: string): number {
  return readConfig(configPath).pageSize ?? 7;
}

export function ensureConfig(configPath: string, dbPath: string): void {
  const current = readConfig(configPath);
  const booksPath = current.booksPath ?? defaultBooksPath(dbPath);
  if (!current.booksPath) mkdirSync(booksPath, { recursive: true });
  if (current.book && current.dbPath && current.logPath && current.booksPath && current.pageSize) return;
  writeConfig(configPath, {
    ...current,
    book: current.book ?? "maimemo",
    dbPath: current.dbPath ?? dbPath,
    logPath: current.logPath ?? defaultLogPath(),
    booksPath,
    pageSize: current.pageSize ?? 7,
  });
}

function writeConfig(path: string, config: MoteConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  const body: { maimemoToken?: string; book: BookChoice; dbPath: string; logPath: string; booksPath?: string; pageSize?: number } = {
    book: config.book ?? "maimemo",
    dbPath: config.dbPath ?? defaultDbPath(),
    logPath: config.logPath ?? defaultLogPath(),
  };
  if (config.maimemoToken) body.maimemoToken = config.maimemoToken;
  if (config.booksPath) body.booksPath = config.booksPath;
  if (config.pageSize) body.pageSize = config.pageSize;
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function resolveMaimemoToken(input: {
  flag?: string;
  configPath: string;
}): string {
  if (input.flag) return input.flag;
  const fromFile = readConfig(input.configPath).maimemoToken;
  if (fromFile) return fromFile;
  throw new MaimemoError(
    "missing_token",
    "缺少墨墨 API Token。请写入 ~/.config/mote.json 的 maimemoToken。",
  );
}

export function assertSupportedPlatform(): void {
  if (process.platform === "win32") throw new MaimemoError("invalid", "这一版不支持 Windows。");
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
