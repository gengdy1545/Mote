import { createApi, type MaimemoApi } from "../maimemo/api.js";
import { MaimemoError } from "../maimemo/errors.js";
import type { Interpretation, TodayItem } from "../maimemo/types.js";
import { isBookName, resolveBook, resolveDownloadLog, resolveMaimemoToken, writeBook, writeMaimemoToken } from "../config.js";
import {
  BOOK_STUDY_DAY,
  bookAccountKey,
  bookTitle,
  customBookExists,
  importCustomBook,
  isLocalBook,
  isReservedBook,
  listCustomBooks,
  removeCustomBook,
  wordsFor,
} from "../books.js";
import { playAudio, stopAudio } from "../dict/audio.js";
import { dictionaryText } from "../dict/format.js";
import { createJobQueue } from "../dict/jobs.js";
import { audioReady, ensureAudio, ensureDictWord, ensureGloss, getDictWord, glossReady } from "../dict/store.js";
import { dictionaryKey } from "../dict/types.js";
import type { DictWord } from "../dict/types.js";
import { dirname, join } from "node:path";
import {
  deleteSession,
  getContent,
  getSession,
  getSnapshot,
  openDatabase,
  practicedCount,
  practicedIds,
  saveContent,
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
  quit,
  reveal,
  startPractice,
  type Card,
  type PracticeState,
  type StoredSession,
} from "../study/practice.js";
import {
  EMPTY_TASK_NOTE,
  localProgressLine,
  officialProgressLine,
  UNSYNCED_LINE,
} from "../study/text.js";
import { selectTodayItems } from "../study/today.js";
import type { PracticeController } from "../tui/PracticeApp.js";

export type IO = {
  fetch: typeof fetch;
  env: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  now: () => Date;
  dbPath: string;
  configPath: string;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
  playAudio?: (path: string) => void;
  stopAudio?: () => void;
  renderPractice?: (controller: PracticeController) => Promise<void>;
};

export async function runSync(io: IO, tokenFlag?: string): Promise<number> {
  const loaded = await loadToday(io, tokenFlag);
  try {
    io.stdout(snapshotLines(loaded.snapshot, practicedCount(loaded.db, loaded.accountKey, loaded.studyDay)).join("\n"));
    return 0;
  } finally {
    loaded.db.close();
  }
}

export async function runStats(io: IO, tokenFlag?: string): Promise<number> {
  const token = resolveMaimemoToken({ flag: tokenFlag, env: io.env, configPath: io.configPath });
  const db = openDatabase(io.dbPath);
  const key = accountKey(token);
  const day = studyDay(io.now());
  const snapshot = getSnapshot(db, key, day);
  if (!snapshot) {
    db.close();
    throw new MaimemoError("not_found", "还没有今日官方快照，请先运行 mote sync");
  }
  io.stdout(snapshotLines(snapshot, practicedCount(db, key, day)).join("\n"));
  db.close();
  return 0;
}

export async function runAuth(io: IO, tokenFlag?: string): Promise<number> {
  const token = resolveMaimemoToken({ flag: tokenFlag, env: io.env, configPath: io.configPath });
  const api = createApi(io.fetch, token, { sleep: io.sleep, retryDelayMs: io.retryDelayMs });
  const progress = await api.progress();
  if (tokenFlag) writeMaimemoToken(io.configPath, tokenFlag);
  io.stdout(["认证有效", officialProgressLine(progress.finished, progress.total), UNSYNCED_LINE].join("\n"));
  return 0;
}

export async function runLookup(io: IO, word: string, tokenFlag?: string): Promise<number> {
  const token = resolveMaimemoToken({ flag: tokenFlag, env: io.env, configPath: io.configPath });
  const api = createApi(io.fetch, token, { sleep: io.sleep, retryDelayMs: io.retryDelayMs });
  const vocabulary = await api.vocabulary(word);
  if (!vocabulary) throw new MaimemoError("not_found", "单词不存在");
  const interpretations = await api.interpretations(vocabulary.id);
  const db = openDatabase(io.dbPath);
  saveContent(db, accountKey(token), vocabulary.id, interpretations, io.now().toISOString());
  const entry = await ensureDictWord(
    db,
    io.dbPath,
    io.fetch,
    vocabulary.spelling,
    io.now().toISOString(),
    resolveDownloadLog(io.configPath, io.env),
  );
  db.close();
  io.stdout([vocabulary.spelling, dictionaryText(entry, interpretations), UNSYNCED_LINE].join("\n"));
  return 0;
}

export type BookRequest =
  | { action: "show" }
  | { action: "use"; name: string }
  | { action: "add"; name: string; path: string }
  | { action: "remove"; name: string };

export function runBookCommand(io: IO, request: BookRequest): number {
  if (request.action === "show") {
    const current = resolveBook(io.configPath);
    writeBook(io.configPath, current);
    const custom = listCustomBooks(io.dbPath);
    io.stdout(
      [
        `当前词本：${bookTitle(current)} (${current})`,
        "内置：maimemo 墨墨、cet4 四级、cet6 六级、ielts 雅思、toefl 托福",
        `自定义：${custom.length > 0 ? custom.join("、") : "无"}`,
        "切换：mote book cet4",
        "导入：mote book add travel ~/words.txt",
        "删除：mote book remove travel",
      ].join("\n"),
    );
    return 0;
  }
  if (request.action === "add") {
    const words = importCustomBook(io.dbPath, request.name, request.path);
    const db = openDatabase(io.dbPath);
    const key = bookAccountKey(request.name);
    const previous = getSession(db, key, BOOK_STUDY_DAY);
    if (previous) {
      saveSession(
        db,
        { ...previous, queue: [...words], index: 0, status: "active" },
        io.now().toISOString(),
      );
    }
    db.close();
    writeBook(io.configPath, request.name);
    io.stdout(`已导入 ${request.name}，共 ${words.length} 个词，并从第一个词开始。`);
    return 0;
  }
  if (request.action === "remove") {
    removeCustomBook(io.dbPath, request.name);
    const db = openDatabase(io.dbPath);
    deleteSession(db, bookAccountKey(request.name), BOOK_STUDY_DAY);
    db.close();
    const current = resolveBook(io.configPath);
    if (current === request.name) writeBook(io.configPath, "maimemo");
    io.stdout(current === request.name ? `已删除 ${request.name}，当前词本改回 maimemo。` : `已删除 ${request.name}。`);
    return 0;
  }
  if (!isBookName(request.name)) throw new MaimemoError("invalid", "词本名称需要使用英文，例如 travel。");
  if (!isReservedBook(request.name) && !customBookExists(io.dbPath, request.name)) {
    throw new MaimemoError("not_found", `词本不存在：${request.name}`);
  }
  writeBook(io.configPath, request.name);
  io.stdout(`已切换到 ${bookTitle(request.name)} (${request.name})`);
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
    return await fetchSpellings(io, db, [...wordsFor(book, io.dbPath)]);
  } finally {
    db.close();
  }
}

async function fetchSpellings(io: IO, db: ReturnType<typeof openDatabase>, spellings: string[]): Promise<number> {
  const wait = io.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
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
    const logPath = resolveDownloadLog(io.configPath, io.env);
    const results = await Promise.all([
      glossDone ? true : ensureGloss(db, io.fetch, spelling, fetchedAt, logPath).then(() => true, () => false),
      audioDone ? true : ensureAudio(db, io.dbPath, io.fetch, spelling, fetchedAt, logPath).then(() => true, () => false),
    ]);
    const ok = results.every(Boolean);
    if (ok) saved += 1;
    else failed += 1;
    await wait(ok ? 1000 : 4000);
  }
  io.stdout(`完成。跳过 ${skipped}，写入 ${saved}，未完成 ${failed}。`);
  return 0;
}

export async function runReview(io: IO, limit: number | null, tokenFlag?: string): Promise<number> {
  const book = resolveBook(io.configPath);
  if (isLocalBook(book)) {
    const db = openDatabase(io.dbPath);
    return practiceSession(io, {
      db,
      cards: wordsFor(book, io.dbPath).map((spelling, order) => ({
        vocId: spelling,
        spelling,
        order,
        isNew: false,
        isFinished: false,
      })),
      key: bookAccountKey(book),
      day: BOOK_STUDY_DAY,
      limit,
      offline: false,
      resetMessage: "词本已更新，从第一个词重新开始。已揭开的词仍保留。",
      emptyText: () => "这本词书是空的。",
      loadContent: async (card, content) => {
        content[card.vocId] = [];
      },
    });
  }

  const loaded = await loadToday(io, tokenFlag);
  return practiceSession(io, {
    db: loaded.db,
    cards: toCards(loaded.snapshot.items),
    key: loaded.accountKey,
    day: loaded.studyDay,
    limit,
    offline: loaded.offline,
    resetMessage: "官方今日任务已变化，本地练习从头开始。已记录的本地反馈仍保留。",
    emptyText: () => snapshotLines(loaded.snapshot, practicedCount(loaded.db, loaded.accountKey, loaded.studyDay)).join("\n"),
    loadContent: async (card, content) => {
      if (Object.prototype.hasOwnProperty.call(content, card.vocId)) return;
      const cached = getContent(loaded.db, loaded.accountKey, card.vocId);
      content[card.vocId] = cached ?? (await loaded.api.interpretations(card.vocId));
      if (!cached) saveContent(loaded.db, loaded.accountKey, card.vocId, content[card.vocId] ?? [], io.now().toISOString());
    },
  });
}

async function practiceSession(
  io: IO,
  input: {
    db: ReturnType<typeof openDatabase>;
    cards: Card[];
    key: string;
    day: string;
    limit: number | null;
    offline: boolean;
    resetMessage: string;
    emptyText: () => string;
    loadContent: (card: Card, content: Record<string, Interpretation[]>) => Promise<void>;
  },
): Promise<number> {
  const { db, key, day } = input;
  try {
  const started = startPractice({
    accountKey: key,
    studyDay: day,
    cards: input.cards,
    previous: getSession(db, key, day),
    revealedIds: practicedIds(db, key, day),
    limit: input.limit,
  });
  if (started.state.status === "empty") {
    io.stdout(input.emptyText());
    return 0;
  }

  let state = started.state;
  if (started.queueReset) io.stdout(input.resetMessage);
  const persist = (next: PracticeState) => {
    state = next;
    saveSession(db, toStored(state), io.now().toISOString());
    return state;
  };
  persist(state);
  const content: Record<string, Interpretation[]> = {};
  const words: Record<string, DictWord | null> = {};
  const play = io.playAudio ?? playAudio;
  const stop = io.stopAudio ?? stopAudio;

  const jobs = createJobQueue(2);
  const remember = (spelling: string) => {
    const stored = getDictWord(db, spelling);
    if (stored) words[stored.spelling] = stored;
    return stored;
  };
  const glossAvailable = (card: Card) => {
    if (!Object.prototype.hasOwnProperty.call(content, card.vocId)) {
      const cached = getContent(db, key, card.vocId);
      if (cached) content[card.vocId] = cached;
    }
    const official = content[card.vocId];
    if (official?.some((item) => item.text.trim())) return true;
    return glossReady(words[card.spelling.toLowerCase()] ?? remember(card.spelling));
  };
  const audioAvailable = (card: Card) =>
    audioReady(words[card.spelling.toLowerCase()] ?? remember(card.spelling), io.dbPath);

  const playCard = (card: Card) => {
    const audio = (words[card.spelling.toLowerCase()] ?? remember(card.spelling))?.audioUsPath;
    if (!audio) return;
    play(join(dirname(io.dbPath), audio));
  };

  const controller: PracticeController = {
    initial: state,
    offline: input.offline,
    content,
    words,
    availability() {
      const card = currentCard(state);
      if (!card) return { gloss: false, audio: false };
      return { gloss: glossAvailable(card), audio: audioAvailable(card) };
    },
    watch(notify) {
      const card = currentCard(state);
      if (!card) return () => undefined;
      jobs.keep(card.spelling);
      let active = true;
      const done = () => {
        if (active) notify();
      };
      const fetchedAt = io.now().toISOString();
      const logPath = resolveDownloadLog(io.configPath, io.env);
      if (!Object.prototype.hasOwnProperty.call(content, card.vocId)) {
        jobs.add(`${card.vocId}:official`, card.spelling, () => input.loadContent(card, content), done);
      }
      const stored = remember(card.spelling);
      if (!glossReady(stored)) {
        jobs.add(`${card.spelling}:gloss`, card.spelling, async () => {
          words[dictionaryKey(card.spelling)] = await ensureGloss(db, io.fetch, card.spelling, fetchedAt, logPath);
        }, done);
      }
      if (!audioReady(stored, io.dbPath)) {
        jobs.add(`${card.spelling}:audio`, card.spelling, async () => {
          words[dictionaryKey(card.spelling)] = await ensureAudio(db, io.dbPath, io.fetch, card.spelling, fetchedAt, logPath);
        }, done);
      }
      return () => {
        active = false;
      };
    },
    async reveal() {
      const card = currentCard(state);
      if (!card || state.status !== "practicing" || !glossAvailable(card)) return state;
      const next = reveal(state);
      if (next !== state) {
        if (next.revealedIds !== state.revealedIds) persist(next);
        else state = next;
      }
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
      stop();
      return persist(next);
    },
    jump(position: number) {
      const next = jumpTo(state, position);
      if (next === state) return state;
      stop();
      return persist(next);
    },
    hide() {
      stop();
      return hideGloss(state);
    },
    quit() {
      stop();
      return persist(quit(state));
    },
  };

  const render = io.renderPractice ?? defaultRender;
  try {
    await render(controller);
  } finally {
    stop();
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
  api: MaimemoApi;
}> {
  const token = resolveMaimemoToken({ flag: tokenFlag, env: io.env, configPath: io.configPath });
  const db = openDatabase(io.dbPath);
  const key = accountKey(token);
  const day = studyDay(io.now());
  const api = createApi(io.fetch, token, { sleep: io.sleep, retryDelayMs: io.retryDelayMs });
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
    return { db, snapshot, accountKey: key, studyDay: day, offline: false, api };
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
    return { db, snapshot: cached, accountKey: key, studyDay: day, offline: true, api };
  }
}

function snapshotLines(snapshot: Snapshot, localCount: number): string[] {
  const lines = [
    officialProgressLine(snapshot.progress.finished, snapshot.progress.total),
    localProgressLine(localCount),
    UNSYNCED_LINE,
    `官方快照：${formatShanghai(snapshot.fetchedAt)}`,
    `今日任务：${snapshot.items.length} 个`,
  ];
  if (snapshot.truncated) lines.push("今日任务可能不完整：接口单次最多返回 1000 条");
  if (snapshot.items.length === 0) lines.push(EMPTY_TASK_NOTE);
  return lines;
}

function toCards(items: TodayItem[]): Card[] {
  return items.map((item) => ({
    vocId: item.vocId,
    spelling: item.spelling,
    order: item.order,
    isNew: item.isNew,
    isFinished: item.isFinished,
    ...(item.firstResponse ? { firstResponse: item.firstResponse } : {}),
  }));
}

function toStored(state: PracticeState): StoredSession {
  return {
    accountKey: state.accountKey,
    studyDay: state.studyDay,
    queue: queueOf(state.cards),
    index: state.index,
    status: state.status === "completed" ? "completed" : "active",
    revealed: state.revealedIds,
  };
}

async function defaultRender(controller: PracticeController): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new MaimemoError("invalid", "练习界面需要交互式终端。");
  }
  const { render } = await import("ink");
  const { createElement } = await import("react");
  const { PracticeApp } = await import("../tui/PracticeApp.js");
  const instance = render(createElement(PracticeApp, { controller }));
  await instance.waitUntilExit();
}
