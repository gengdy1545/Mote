import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { MaimemoError } from "./maimemo/errors.js";

export type BookChoice = string;

export type MoteConfig = {
  maimemoToken?: string;
  book?: BookChoice;
  downloadLog?: string;
};

export function isBookName(value: string): boolean {
  return value.length <= 32 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
}

export function defaultDownloadLogPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_DATA_HOME || join(env.HOME || homedir(), ".local", "share");
  return join(base, "mote", "download.log");
}

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MOTE_CONFIG) return env.MOTE_CONFIG;
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
  if (!parsed || typeof parsed !== "object") return {};
  const record = parsed as { maimemoToken?: unknown; book?: unknown; downloadLog?: unknown };
  const config: MoteConfig = {};
  if (typeof record.maimemoToken === "string") config.maimemoToken = record.maimemoToken;
  if (typeof record.downloadLog === "string" && record.downloadLog.trim()) config.downloadLog = record.downloadLog.trim();
  if (typeof record.book === "string") {
    if (!isBookName(record.book)) {
      throw new MaimemoError("invalid", "配置里的 book 无效。使用小写英文，例如 maimemo 或 travel。");
    }
    config.book = record.book;
  }
  return config;
}

export function resolveDownloadLog(configPath: string, env: NodeJS.ProcessEnv = process.env): string {
  const config = readConfig(configPath);
  if (config.downloadLog) return config.downloadLog;
  const downloadLog = defaultDownloadLogPath(env);
  if (existsSync(configPath)) writeConfig(configPath, { ...config, downloadLog });
  return downloadLog;
}

export function resolveBook(path: string): BookChoice {
  const config = readConfig(path);
  if (config.book) return config.book;
  if (existsSync(path)) writeConfig(path, { ...config, book: "maimemo" });
  return "maimemo";
}

export function writeMaimemoToken(path: string, token: string): void {
  writeConfig(path, { ...readConfig(path), maimemoToken: token });
}

export function writeBook(path: string, book: BookChoice): void {
  writeConfig(path, { ...readConfig(path), book });
}

function writeConfig(path: string, config: MoteConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  const body: { maimemoToken?: string; book: BookChoice; downloadLog: string } = {
    book: config.book ?? "maimemo",
    downloadLog: config.downloadLog ?? defaultDownloadLogPath(),
  };
  if (config.maimemoToken) body.maimemoToken = config.maimemoToken;
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function resolveMaimemoToken(input: {
  flag?: string;
  env?: NodeJS.ProcessEnv;
  configPath: string;
}): string {
  if (input.flag) return input.flag;
  const envToken = input.env?.MOTE_MAIMEMO_TOKEN;
  if (envToken) return envToken;
  const fromFile = readConfig(input.configPath).maimemoToken;
  if (fromFile) return fromFile;
  throw new MaimemoError(
    "missing_token",
    "缺少墨墨 API Token。请写入 ~/.config/mote.json 的 maimemoToken，或设置 MOTE_MAIMEMO_TOKEN。",
  );
}

export function assertMacOS(platform = process.platform): void {
  if (platform !== "darwin") {
    throw new MaimemoError("invalid", "这一版只适配 macOS。");
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
