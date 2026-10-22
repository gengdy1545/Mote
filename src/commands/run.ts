import { createApi } from "../maimemo/api.js";
import { MaimemoError, requireInteractiveTerminal } from "../maimemo/errors.js";
import type { TodayItem } from "../maimemo/types.js";
import { appendErrorLog, isBookName, resolveBook, resolveLogPath, resolveMaimemoToken, resolvePageSize, writeBook, writeBooksPath, writeErrorLog, writeMaimemoToken } from "../config.js";
import {
  BOOK_STUDY_DAY,
  appendBookWord,
  bookAccountKey,
  bookTitle,
  booksFolder,
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
} from "../books.js";
import { playAudio, stopAudio, type PlayResult } from "../dict/audio.js";
import { createJobQueue } from "../dict/jobs.js";
import { audioReady, ensureAudio, ensureDictWord, ensureGloss, getDictWord, glossReady, ShownFailure } from "../dict/store.js";
import { dictionaryKey } from "../dict/types.js";
import type { DictWord } from "../dict/types.js";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import {
  deleteSession,
  getSession,
  getSnapshot,
  openDatabase,
  saveSession,
  saveSnapshot,
  type Snapshot,
} from "../storage/db.js";
import { accountKey } from "../study/account.js";
import { formatShanghai, studyDay } from "../study/day.js";
import {
  currentCard,
  hide as hideGloss,
  jump as jumpTo,
  move as moveCard,
  queueOf,
  reveal,
  startPractice,
  type Card,
  type PracticeState,
  type StoredSession,
} from "../study/practice.js";
import {
  EMPTY_TASK_NOTE,
  lookupText,
  officialProgressLine,
} from "../study/text.js";
import { browseWords } from "../study/words.js";
import { selectTodayItems } from "../study/today.js";
import { AUDIO_DOWNLOAD_ERROR, PLAY_FAILED_ERROR, PLAY_MISSING_ERROR, practiceNotices, type PlayFailure } from "../study/notices.js";
import type { PracticeController } from "../tui/PracticeApp.js";

export type IO = {
  env: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  now: () => Date;
  dbPath: string;
  configPath: string;
};

export async function runSync(io: IO, tokenFlag?: string): Promise<number> {
  const loaded = await loadToday(io, tokenFlag);
  try {
    io.stdout(snapshotLines(loaded.snapshot).join("\n"));
    return 0;
  } finally {
    loaded.db.close();
  }
}

export async function runStats(io: IO, tokenFlag?: string): Promise<number> {
  const token = resolveMaimemoToken({ flag: tokenFlag, configPath: io.configPath });
  const db = openDatabase(io.dbPath);
  const key = accountKey(token);
  const day = studyDay(io.now());
  const snapshot = getSnapshot(db, key, day);
  if (!snapshot) {
    db.close();
    throw new MaimemoError("not_found", "还没有今日官方快照，请先运行 mote sync");
  }
  io.stdout(snapshotLines(snapshot).join("\n"));
  db.close();
  return 0;
}

export async function runAuth(io: IO, tokenFlag?: string): Promise<number> {
  const token = resolveMaimemoToken({ flag: tokenFlag, configPath: io.configPath });
  const api = createApi(token);
  const progress = await api.progress();
  if (tokenFlag) writeMaimemoToken(io.configPath, tokenFlag);
  io.stdout(["认证有效", officialProgressLine(progress.finished, progress.total)].join("\n"));
  return 0;
}

export async function runLookup(io: IO, word: string): Promise<number> {
  requireInteractiveTerminal();
  const db = openDatabase(io.dbPath);
  const cached = getDictWord(db, word);
  const needsDownload = !glossReady(cached) || !audioReady(cached, io.dbPath);
  if (needsDownload) io.stdout("下载中");
  const entry = await ensureDictWord(
    db,
    io.dbPath,
    word,
    io.now().toISOString(),
    resolveLogPath(io.configPath, io.env),
  );
  db.close();
  const text = lookupText(word, entry);
  const audio = entry.audioUsPath;
  const audioPath = audio && audioReady(entry, io.dbPath) ? join(dirname(io.dbPath), audio) : null;
  const platform = process.platform;
  await stayForLookup(text, audioPath, (result) => reportLookupPlay(io, platform, result));
  return 0;
}

function reportLookupPlay(io: IO, platform: NodeJS.Platform, result: PlayResult): void {
  const message = result.kind === "missing-player"
    ? platform === "linux" ? PLAY_MISSING_ERROR : PLAY_FAILED_ERROR
    : result.kind === "failed" ? PLAY_FAILED_ERROR : "";
  if (!message) return;
  io.stderr(message);
  writeErrorLog(io.configPath, io.env, message);
}

function playLookup(audioPath: string, report: (result: PlayResult) => void): Promise<void> {
  return new Promise((resolve) => {
    playAudio(audioPath, (result) => {
      report(result);
      resolve();
    });
  });
}

async function stayForLookup(
  text: string,
  audioPath: string | null,
  report: (result: PlayResult) => void,
): Promise<void> {
  if (audioPath) void playLookup(audioPath, report);
  const { render } = await import("ink");
  const { createElement } = await import("react");
  const { LookupApp } = await import("../tui/LookupApp.js");
  const hint = audioPath ? "p 发音    q 退出" : `${AUDIO_DOWNLOAD_ERROR}    q 退出`;
  const instance = render(
    createElement(LookupApp, {
      text,
      hint,
      onPlay: () => {
        if (audioPath) void playLookup(audioPath, report);
      },
      onQuit: stopAudio,
    }),
  );
  await instance.waitUntilExit();
}

export type BookRequest =
  | { action: "show" }
  | { action: "use"; name: string }
  | { action: "add"; name: string; path: string }
  | { action: "create"; name: string }
  | { action: "append"; name?: string; word: string }
  | { action: "remove"; name: string };

export async function runBookCommand(io: IO, request: BookRequest): Promise<number> {
  if (request.action === "show") {
    const current = resolveBook(io.configPath);
    writeBook(io.configPath, current);
    const custom = listCustomBooks(io.dbPath);
    const missing = missingBookFiles(io.dbPath, io.configPath, io.env);
    io.stdout(
      [
        `当前词本：${bookTitle(current)} (${current})`,
        "内置：maimemo 墨墨、cet4 四级、cet6 六级、ielts 雅思、toefl 托福",
        `自定义：${custom.length > 0 ? custom.join("、") : "无"}`,
        "切换：mote book cet4",
        "导入：mote book add travel ~/words.txt。同名时回车确认覆盖",
        "创建：mote book create travel。文件名为 travel.txt",
        "目录：mote books，或 mote books ~/books",
        "加词：mote add apple，或 mote book travel add apple",
        "单词：mote words",
        "删除：mote book remove travel。回车确认，n 取消",
      ].join("\n"),
    );
    if (missing.length === 0) return 0;
    const missingMessage = missing.map((file) => `词本文件不存在：${file}`).join("\n");
    io.stderr(missingMessage);
    writeErrorLog(io.configPath, io.env, missingMessage);
    return 1;
  }
  if (request.action === "add") {
    const destination = join(booksFolder(io.dbPath, io.configPath, io.env), `${request.name}.txt`);
    if (customBookExists(io.dbPath, request.name) || existsSync(destination)) {
      const confirm = confirmFromStdin;
      if (!(await confirm(`词书 ${request.name} 已存在，文件 ${destination}。\n是否覆盖？ [Y/n] `))) {
        io.stdout("已取消。");
        return 1;
      }
    }
    const words = importCustomBook(io.dbPath, io.configPath, request.name, request.path, io.env);
    const db = openDatabase(io.dbPath);
    const key = bookAccountKey(request.name);
    const previous = getSession(db, key, BOOK_STUDY_DAY);
    if (previous) {
      saveSession(db, { ...previous, queue: [...words], index: 0 });
    }
    db.close();
    writeBook(io.configPath, request.name);
    io.stdout(`已导入 ${request.name}，共 ${words.length} 个词，并从第一个词开始。`);
    return 0;
  }
  if (request.action === "create") {
    const destination = createCustomBook(io.dbPath, io.configPath, request.name, io.env);
    writeBook(io.configPath, request.name);
    io.stdout(`已创建 ${request.name}，文件在 ${destination}`);
    return 0;
  }
  if (request.action === "append") {
    const name = request.name ?? resolveBook(io.configPath);
    const result = appendBookWord(io.dbPath, io.configPath, name, request.word, io.env);
    if (!result.added) {
      io.stdout(`${result.word} 已经在 ${name} 里。`);
      return 0;
    }
    const db = openDatabase(io.dbPath);
    const key = bookAccountKey(name);
    const previous = getSession(db, key, BOOK_STUDY_DAY);
    if (previous) {
      saveSession(db, {
        ...previous,
        queue: result.words,
        index: Math.min(previous.index, result.words.length - 1),
      });
    }
    db.close();
    io.stdout(`已将 ${result.word} 加入 ${name}。`);
    return 0;
  }
  if (request.action === "remove") {
    if (!isBookName(request.name)) throw new MaimemoError("invalid", "词本名称需要使用英文，例如 travel。");
    if (isReservedBook(request.name)) throw new MaimemoError("invalid", "内置词本不能删除。");
    if (!customBookExists(io.dbPath, request.name)) throw new MaimemoError("not_found", `词本不存在：${request.name}`);
    const confirm = confirmFromStdin;
    const file = join(booksFolder(io.dbPath, io.configPath, io.env), `${request.name}.txt`);
    if (!(await confirm(`将删除词书 ${request.name}，文件 ${file}。\n是否继续？ [Y/n] `))) {
      io.stdout("已取消。");
      return 1;
    }
    removeCustomBook(io.dbPath, io.configPath, request.name, io.env);
    const db = openDatabase(io.dbPath);
    deleteSession(db, bookAccountKey(request.name), BOOK_STUDY_DAY);
    db.close();
    const current = resolveBook(io.configPath);
    if (current === request.name) writeBook(io.configPath, "maimemo");
    io.stdout(current === request.name ? `已删除 ${request.name}，当前词本改回 maimemo。` : `已删除 ${request.name}。`);
    return 0;
  }
  if (!isBookName(request.name)) throw new MaimemoError("invalid", "词本名称需要使用英文，例如 travel。");
  if (!isReservedBook(request.name)) {
    if (!customBookExists(io.dbPath, request.name)) throw new MaimemoError("not_found", `词本不存在：${request.name}`);
    wordsFor(request.name, io.dbPath, io.configPath, io.env);
  }
  writeBook(io.configPath, request.name);
  io.stdout(`已切换到 ${bookTitle(request.name)} (${request.name})`);
  return 0;
}

export async function runBooks(io: IO, directory?: string): Promise<number> {
  const current = booksFolder(io.dbPath, io.configPath, io.env);
  if (!directory) {
    io.stdout(`词书目录：${current}`);
    return 0;
  }
  const next = relocateBooks(io.dbPath, io.configPath, directory, io.env);
  if (next === current) {
    io.stdout(`词书目录未改变：${current}`);
    return 0;
  }
  const detail = listCustomBooks(io.dbPath).length > 0
    ? `将把词书从 ${current} 移到 ${next}。配置文件和数据库保持原位。`
    : `词书目录将改为 ${next}。配置文件和数据库保持原位。`;
  const prompt = `${detail}\n是否继续？ [Y/n] `;
  const confirm = confirmFromStdin;
  if (!(await confirm(prompt))) {
    io.stdout("已取消。");
    return 1;
  }
  const moved = relocateBooks(io.dbPath, io.configPath, directory, io.env, true);
  writeBooksPath(io.configPath, moved);
  io.stdout(`已将词书目录改为 ${moved}。`);
  return 0;
}

function confirmAnswer(answer: string): boolean | null {
  const value = answer.trim().toLowerCase();
  if (value === "" || value === "y" || value === "yes") return true;
  if (value === "n" || value === "no") return false;
  return null;
}

async function confirmFromStdin(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = confirmAnswer(await rl.question(prompt));
      if (answer !== null) return answer;
    }
  } finally {
    rl.close();
  }
}

export async function runWords(io: IO): Promise<number> {
  const book = resolveBook(io.configPath);
  let words: readonly string[];
  if (book === "maimemo") {
    const token = resolveMaimemoToken({ configPath: io.configPath });
    const db = openDatabase(io.dbPath);
    const snapshot = getSnapshot(db, accountKey(token), studyDay(io.now()));
    db.close();
    if (!snapshot) throw new MaimemoError("not_found", "还没有今日官方快照，请先运行 mote sync");
    words = snapshot.items.map((item) => item.spelling);
  } else {
    words = wordsFor(book, io.dbPath, io.configPath, io.env);
  }
  await browseWords(words, resolvePageSize(io.configPath));
  return 0;
}

export async function runFetch(io: IO, name?: string): Promise<number> {
  const book = name ?? resolveBook(io.configPath);
  if (!isBookName(book)) throw new MaimemoError("invalid", "词本名称需要使用英文，例如 cet4 或 travel。");
  if (book === "maimemo") {
    const loaded = await loadToday(io);
    try {
      return await fetchSpellings(io, loaded.db, loaded.snapshot.items.map((item) => item.spelling));
    } finally {
      loaded.db.close();
    }
  }
  const db = openDatabase(io.dbPath);
  try {
    return await fetchSpellings(io, db, [...wordsFor(book, io.dbPath, io.configPath, io.env)]);
  } finally {
    db.close();
  }
}

async function fetchSpellings(io: IO, db: ReturnType<typeof openDatabase>, spellings: string[]): Promise<number> {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  let skipped = 0;
  let saved = 0;
  let failed = 0;
  for (let index = 0; index < spellings.length; index += 1) {
    const spelling = spellings[index] ?? "";
    const word = getDictWord(db, spelling);
    const glossDone = glossReady(word);
    const audioDone = audioReady(word, io.dbPath);
    if (glossDone && audioDone) {
      skipped += 1;
      continue;
    }
    io.stdout(`${index + 1}/${spellings.length} ${spelling}`);
    const fetchedAt = io.now().toISOString();
    const logPath = resolveLogPath(io.configPath, io.env);
    const results = await Promise.all([
      glossDone ? true : ensureGloss(db, spelling, fetchedAt, logPath).then(() => true, () => false),
      audioDone ? true : ensureAudio(db, io.dbPath, spelling, logPath).then(() => true, () => false),
    ]);
    const ok = results.every(Boolean);
    if (ok) saved += 1;
    else failed += 1;
    await wait(ok ? 1000 : 4000);
  }
  io.stdout(`完成。跳过 ${skipped}，写入 ${saved}，未完成 ${failed}。`);
  return 0;
}

export async function runReview(io: IO, tokenFlag?: string): Promise<number> {
  const book = resolveBook(io.configPath);
  if (isLocalBook(book)) {
    const db = openDatabase(io.dbPath);
    return practiceSession(io, {
      db,
      cards: wordsFor(book, io.dbPath, io.configPath, io.env).map((spelling, order) => ({
        vocId: spelling,
        spelling,
        order,
      })),
      key: bookAccountKey(book),
      day: BOOK_STUDY_DAY,
      offline: false,
      resetMessage: "词本已更新，从第一个词重新开始。",
      emptyText: () => "这本词书是空的。",
    });
  }

  const loaded = await loadToday(io, tokenFlag);
  return practiceSession(io, {
    db: loaded.db,
    cards: toCards(loaded.snapshot.items),
    key: loaded.accountKey,
    day: loaded.studyDay,
    offline: loaded.offline,
    resetMessage: "官方今日任务已变化，从第一个词重新开始。",
    emptyText: () => snapshotLines(loaded.snapshot).join("\n"),
  });
}

async function practiceSession(
  io: IO,
  input: {
    db: ReturnType<typeof openDatabase>;
    cards: Card[];
    key: string;
    day: string;
    offline: boolean;
    resetMessage: string;
    emptyText: () => string;
  },
): Promise<number> {
  const { db, key, day } = input;
  try {
  const started = startPractice({
    accountKey: key,
    studyDay: day,
    cards: input.cards,
    previous: getSession(db, key, day),
  });
  if (started.state.cards.length === 0) {
    io.stdout(input.emptyText());
    return 0;
  }

  let state = started.state;
  if (started.queueReset) io.stdout(input.resetMessage);
  const persist = (next: PracticeState) => {
    state = next;
    saveSession(db, toStored(state));
    return state;
  };
  persist(state);
  const words: Record<string, DictWord | null> = {};
  const platform = process.platform;
  const failure = { gloss: false, audio: false, play: null as PlayFailure };
  const listeners = new Set<() => void>();
  let epoch = 0;
  let loggedMissingPlayer = false;
  const publish = () => {
    for (const listener of listeners) listener();
  };
  const resetErrors = () => {
    epoch += 1;
    failure.gloss = false;
    failure.audio = false;
    failure.play = null;
  };

  const jobs = createJobQueue(2);
  const remember = (spelling: string) => {
    const stored = getDictWord(db, spelling);
    if (stored) words[stored.spelling] = stored;
    return stored;
  };
  const glossAvailable = (card: Card) => glossReady(words[card.spelling.toLowerCase()] ?? remember(card.spelling));
  const audioAvailable = (card: Card) =>
    audioReady(words[card.spelling.toLowerCase()] ?? remember(card.spelling), io.dbPath);

  const playCard = (card: Card) => {
    const audio = (words[card.spelling.toLowerCase()] ?? remember(card.spelling))?.audioUsPath;
    if (!audio) return;
    const ticket = epoch;
    const logPath = resolveLogPath(io.configPath, io.env);
    playAudio(join(dirname(io.dbPath), audio), (result) => {
      if (ticket !== epoch) return;
      if (result.kind === "ok") failure.play = null;
      else if (result.kind === "missing-player") {
        failure.play = "missing";
        if (!loggedMissingPlayer) {
          loggedMissingPlayer = true;
          appendErrorLog(logPath, `播放 ${card.spelling}：未找到播放器`);
        }
      } else {
        failure.play = "failed";
        appendErrorLog(logPath, `播放 ${card.spelling}：${result.code == null ? "无法播放" : `无法播放 ${result.code}`}`);
      }
      publish();
    });
  };

  const controller: PracticeController = {
    initial: state,
    offline: input.offline,
    words,
    availability() {
      const card = currentCard(state);
      if (!card) return { gloss: false, audio: false };
      return { gloss: glossAvailable(card), audio: audioAvailable(card) };
    },
    errors() {
      return practiceNotices({ gloss: failure.gloss, audio: failure.audio, play: failure.play, platform });
    },
    watch(notify) {
      const card = currentCard(state);
      listeners.add(notify);
      if (!card) return () => listeners.delete(notify);
      jobs.keep(card.spelling);
      const ticket = epoch;
      let active = true;
      const done = () => {
        if (active && ticket === epoch) notify();
      };
      const fetchedAt = io.now().toISOString();
      const logPath = resolveLogPath(io.configPath, io.env);
      const current = () => active && ticket === epoch;
      const stored = remember(card.spelling);
      if (!glossReady(stored)) {
        jobs.add(`${card.spelling}:gloss`, card.spelling, async () => {
          try {
            const word = await ensureGloss(db, card.spelling, fetchedAt, logPath);
            if (!current()) return;
            words[dictionaryKey(card.spelling)] = word;
            failure.gloss = false;
          } catch (error) {
            if (current() && error instanceof ShownFailure) failure.gloss = true;
          }
        }, done);
      }
      if (!audioReady(stored, io.dbPath)) {
        jobs.add(`${card.spelling}:audio`, card.spelling, async () => {
          try {
            const word = await ensureAudio(db, io.dbPath, card.spelling, logPath);
            if (!current()) return;
            words[dictionaryKey(card.spelling)] = word;
            failure.audio = false;
          } catch (error) {
            if (current() && error instanceof ShownFailure) failure.audio = true;
          }
        }, done);
      }
      return () => {
        active = false;
        listeners.delete(notify);
      };
    },
    async reveal() {
      const card = currentCard(state);
      if (!card || !glossAvailable(card)) return state;
      const next = reveal(state);
      if (next !== state) state = next;
      if (audioAvailable(card)) playCard(card);
      return state;
    },
    replay() {
      const card = currentCard(state);
      if (!card || !audioAvailable(card)) return;
      playCard(card);
    },
    move(delta: -1 | 1) {
      const next = moveCard(state, delta);
      if (next === state) return state;
      stopAudio();
      resetErrors();
      return persist(next);
    },
    jump(position: number) {
      const next = jumpTo(state, position);
      if (next === state) return state;
      stopAudio();
      resetErrors();
      return persist(next);
    },
    hide() {
      stopAudio();
      return hideGloss(state);
    },
    quit() {
      stopAudio();
      return persist(state);
    },
  };

  try {
    await defaultRender(controller);
  } finally {
    stopAudio();
  }
  return 0;
  } finally {
    db.close();
  }
}

async function loadToday(io: IO, tokenFlag?: string): Promise<{
  db: ReturnType<typeof openDatabase>;
  snapshot: Snapshot;
  accountKey: string;
  studyDay: string;
  offline: boolean;
}> {
  const token = resolveMaimemoToken({ flag: tokenFlag, configPath: io.configPath });
  const db = openDatabase(io.dbPath);
  const key = accountKey(token);
  const day = studyDay(io.now());
  const api = createApi(token);
  try {
    const progress = await api.progress();
    const quota = Math.min(1000, Math.max(0, Math.trunc(progress.total)));
    const today = quota === 0 ? { items: [], truncated: false } : await api.todayItems(quota);
    const snapshot: Snapshot = {
      accountKey: key,
      studyDay: day,
      fetchedAt: io.now().toISOString(),
      progress,
      items: selectTodayItems(today.items, progress.total),
      truncated: today.truncated,
    };
    saveSnapshot(db, snapshot);
    return { db, snapshot, accountKey: key, studyDay: day, offline: false };
  } catch (error) {
    if (error instanceof MaimemoError && (error.kind === "auth" || error.kind === "missing_token")) {
      db.close();
      throw error;
    }
    const cached = getSnapshot(db, key, day);
    if (!cached) {
      db.close();
      throw error;
    }
    return { db, snapshot: cached, accountKey: key, studyDay: day, offline: true };
  }
}

function snapshotLines(snapshot: Snapshot): string[] {
  const snapshotLine = `官方快照：${formatShanghai(snapshot.fetchedAt)}`;
  if (snapshot.items.length === 0) return [snapshotLine, EMPTY_TASK_NOTE];
  const lines = [
    officialProgressLine(snapshot.progress.finished, snapshot.progress.total),
    snapshotLine,
    `今日任务：${snapshot.items.length} 个`,
  ];
  if (snapshot.truncated) lines.push("今日任务可能不完整：接口单次最多返回 1000 条");
  return lines;
}

function toCards(items: TodayItem[]): Card[] {
  return items.map((item) => ({
    vocId: item.vocId,
    spelling: item.spelling,
    order: item.order,
  }));
}

function toStored(state: PracticeState): StoredSession {
  return {
    accountKey: state.accountKey,
    studyDay: state.studyDay,
    queue: queueOf(state.cards),
    index: state.index,
  };
}

async function defaultRender(controller: PracticeController): Promise<void> {
  requireInteractiveTerminal();
  const { render } = await import("ink");
  const { createElement } = await import("react");
  const { PracticeApp } = await import("../tui/PracticeApp.js");
  const instance = render(createElement(PracticeApp, { controller }));
  await instance.waitUntilExit();
}
