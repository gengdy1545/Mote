#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { assertMacOS, configFilePath } from "./config.js";
import { helpText, parseArgs } from "./cli/args.js";
import { runAuth, runBookCommand, runFetch, runLookup, runReview, runStats, runSync, type IO } from "./commands/run.js";
import { MaimemoError } from "./maimemo/errors.js";
import { defaultDbPath } from "./storage/db.js";

export async function main(argv: string[], io?: Partial<IO>): Promise<number> {
  const runtime = createIO(io);
  try {
    assertMacOS();
    const parsed = parseArgs(argv);
    if ("error" in parsed) {
      runtime.stderr(parsed.error);
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
    if (parsed.command === "lookup") return await runLookup(runtime, parsed.word, parsed.token);
    if (parsed.command === "book") return runBookCommand(runtime, parsed.request);
    if (parsed.command === "fetch") return await runFetch(runtime, parsed.book);
    return await runReview(runtime, parsed.limit, parsed.token);
  } catch (error) {
    runtime.stderr(error instanceof MaimemoError ? error.message : "出现未预期的错误");
    return 1;
  }
}

function createIO(overrides: Partial<IO> | undefined): IO {
  const env = overrides?.env ?? process.env;
  return {
    fetch: overrides?.fetch ?? globalThis.fetch,
    env,
    stdout: overrides?.stdout ?? ((text) => process.stdout.write(`${text}\n`)),
    stderr: overrides?.stderr ?? ((text) => process.stderr.write(`${text}\n`)),
    now: overrides?.now ?? (() => new Date()),
    dbPath: overrides?.dbPath ?? defaultDbPath(env),
    configPath: overrides?.configPath ?? configFilePath(env),
    sleep: overrides?.sleep,
    retryDelayMs: overrides?.retryDelayMs,
    playAudio: overrides?.playAudio,
    stopAudio: overrides?.stopAudio,
    renderPractice: overrides?.renderPractice,
  };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
