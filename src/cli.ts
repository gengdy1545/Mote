#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { assertSupportedPlatform, configFilePath, ensureConfig, resolveDbPath, writeErrorLog } from "./config.js";
import { helpText, parseArgs } from "./cli/args.js";
import { runAuth, runBookCommand, runBooks, runFetch, runLookup, runReview, runStats, runSync, runWords, type IO } from "./commands/run.js";
import { MaimemoError } from "./maimemo/errors.js";

export async function main(argv: string[]): Promise<number> {
  const env = process.env;
  const configPath = configFilePath(env);
  try {
    const runtime = createIO();
    assertSupportedPlatform();
    ensureConfig(runtime.configPath, runtime.dbPath);
    const parsed = parseArgs(argv);
    if ("error" in parsed) {
      runtime.stderr(parsed.error);
      writeErrorLog(runtime.configPath, runtime.env, parsed.error);
      runtime.stderr(helpText());
      return 1;
    }
    if (parsed.command === "help") {
      runtime.stdout(helpText());
      return 0;
    }
    if (parsed.command === "auth") return await runAuth(runtime, parsed.token);
    if (parsed.command === "sync") return await runSync(runtime, parsed.token);
    if (parsed.command === "stats") return await runStats(runtime, parsed.token);
    if (parsed.command === "lookup") return await runLookup(runtime, parsed.word);
    if (parsed.command === "words") return await runWords(runtime);
    if (parsed.command === "add") return await runBookCommand(runtime, { action: "append", word: parsed.word });
    if (parsed.command === "book") return await runBookCommand(runtime, parsed.request);
    if (parsed.command === "books") return await runBooks(runtime, parsed.directory);
    if (parsed.command === "fetch") return await runFetch(runtime, parsed.book);
    return await runReview(runtime, parsed.token);
  } catch (error) {
    const shown = error instanceof MaimemoError ? error.message : "出现未预期的错误";
    process.stderr.write(`${shown}\n`);
    writeErrorLog(configPath, env, error instanceof MaimemoError ? shown : errorDetail(error));
    return 1;
  }
}

function errorDetail(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return "出现未预期的错误";
}

function createIO(): IO {
  const env = process.env;
  const configPath = configFilePath(env);
  return {
    env,
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    now: () => new Date(),
    dbPath: resolveDbPath(configPath, env),
    configPath,
  };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
