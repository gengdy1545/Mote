import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { audioKind, DownloadFailed, fetchAudioBytes, isPlayableAudioFile, writeAudioFile, youdaoAudioUrl } from "./audio.js";
import { parseEnglishDictionary } from "./english.js";
import type { DictExample, DictPhrase, DictSense, DictWord } from "./types.js";
import { dictionaryKey, emptyDictWord } from "./types.js";
import { parseYoudaoDictionary } from "./youdao.js";

export function audioDirectory(dbPath: string): string {
  return join(dirname(dbPath), "audio");
}

export function getDictWord(db: DatabaseSync, spelling: string): DictWord | null {
  const key = dictionaryKey(spelling);
  const row = db
    .prepare(
      `SELECT spelling, phonetic_us, phonetic_uk, audio_us_path, fetched_at, gloss_at, audio_at
       FROM dict_words WHERE spelling = ?`,
    )
    .get(key) as
    | {
        spelling: string;
        phonetic_us: string;
        phonetic_uk: string;
        audio_us_path: string;
        fetched_at: string;
        gloss_at: string;
        audio_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    spelling: row.spelling,
    phoneticUs: row.phonetic_us,
    phoneticUk: row.phonetic_uk,
    audioUsPath: row.audio_us_path,
    fetchedAt: row.fetched_at,
    glossAt: row.gloss_at,
    audioAt: row.audio_at,
    senses: db
      .prepare(`SELECT pos, gloss, lang FROM dict_senses WHERE spelling = ? ORDER BY position`)
      .all(key) as DictSense[],
    phrases: db
      .prepare(`SELECT phrase, meaning FROM dict_phrases WHERE spelling = ? ORDER BY position`)
      .all(key) as DictPhrase[],
    examples: db
      .prepare(`SELECT sentence, translation FROM dict_examples WHERE spelling = ? ORDER BY position`)
      .all(key) as DictExample[],
  };
}

function saveGloss(db: DatabaseSync, word: DictWord): void {
  const key = dictionaryKey(word.spelling);
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO dict_words (spelling, phonetic_us, phonetic_uk, audio_us_path, fetched_at, gloss_at, audio_at)
       VALUES (?, ?, ?, '', ?, ?, '')
       ON CONFLICT(spelling) DO UPDATE SET
         phonetic_us = excluded.phonetic_us,
         phonetic_uk = excluded.phonetic_uk,
         fetched_at = excluded.fetched_at,
         gloss_at = excluded.gloss_at`,
    ).run(key, word.phoneticUs, word.phoneticUk, word.fetchedAt, word.glossAt);
    db.prepare(`DELETE FROM dict_senses WHERE spelling = ?`).run(key);
    db.prepare(`DELETE FROM dict_phrases WHERE spelling = ?`).run(key);
    db.prepare(`DELETE FROM dict_examples WHERE spelling = ?`).run(key);
    insertRows(db, "dict_senses", key, word.senses.map((sense) => [sense.pos, sense.gloss, sense.lang]));
    insertRows(db, "dict_phrases", key, word.phrases.map((phrase) => [phrase.phrase, phrase.meaning]));
    insertRows(db, "dict_examples", key, word.examples.map((example) => [example.sentence, example.translation]));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function saveAudio(db: DatabaseSync, word: DictWord): void {
  const key = dictionaryKey(word.spelling);
  db.prepare(
    `INSERT INTO dict_words (spelling, phonetic_us, phonetic_uk, audio_us_path, fetched_at, gloss_at, audio_at)
     VALUES (?, '', '', ?, ?, '', ?)
     ON CONFLICT(spelling) DO UPDATE SET
       audio_us_path = excluded.audio_us_path,
       audio_at = excluded.audio_at`,
  ).run(key, word.audioUsPath, word.fetchedAt, word.audioAt);
}

export function saveDictWord(db: DatabaseSync, word: DictWord): void {
  const key = dictionaryKey(word.spelling);
  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM dict_senses WHERE spelling = ?`).run(key);
    db.prepare(`DELETE FROM dict_phrases WHERE spelling = ?`).run(key);
    db.prepare(`DELETE FROM dict_examples WHERE spelling = ?`).run(key);
    db.prepare(
      `INSERT INTO dict_words (spelling, phonetic_us, phonetic_uk, audio_us_path, fetched_at, gloss_at, audio_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(spelling) DO UPDATE SET
         phonetic_us = excluded.phonetic_us,
         phonetic_uk = excluded.phonetic_uk,
         audio_us_path = excluded.audio_us_path,
         fetched_at = excluded.fetched_at,
         gloss_at = excluded.gloss_at,
         audio_at = excluded.audio_at`,
    ).run(key, word.phoneticUs, word.phoneticUk, word.audioUsPath, word.fetchedAt, word.glossAt, word.audioAt);
    insertRows(db, "dict_senses", key, word.senses.map((sense) => [sense.pos, sense.gloss, sense.lang]));
    insertRows(db, "dict_phrases", key, word.phrases.map((phrase) => [phrase.phrase, phrase.meaning]));
    insertRows(db, "dict_examples", key, word.examples.map((example) => [example.sentence, example.translation]));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function glossReady(word: DictWord | null): boolean {
  if (!word?.glossAt) return false;
  return Boolean(
    word.phoneticUs || word.phoneticUk || word.senses.some((sense) => sense.gloss) || word.phrases.length || word.examples.length,
  );
}

export function audioReady(word: DictWord | null, dbPath: string): boolean {
  if (!word?.audioUsPath) return false;
  return isPlayableAudioFile(join(dirname(dbPath), word.audioUsPath));
}

export function logDownload(logPath: string, spelling: string, part: "gloss" | "audio", reason: string): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${new Date().toISOString()}  ${spelling}  ${part}  ${reason}\n`);
}

export async function ensureGloss(
  db: DatabaseSync,
  fetchImpl: typeof fetch,
  spelling: string,
  fetchedAt: string,
  logPath: string,
): Promise<DictWord> {
  const cached = getDictWord(db, spelling);
  if (cached && glossReady(cached)) return cached;
  const [youdao, english] = await Promise.all([
    fetchStatus(fetchImpl, `https://dict.youdao.com/jsonapi?q=${encodeURIComponent(spelling)}`),
    fetchStatus(fetchImpl, `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(spelling)}`),
  ]);
  const requestFailed = youdao.kind === "error" || english.kind === "error";
  const youdaoBody = parseYoudaoDictionary(youdao.kind === "ok" ? youdao.body : null);
  const englishBody = parseEnglishDictionary(english.kind === "ok" ? english.body : null);
  const word = cached ?? emptyDictWord(dictionaryKey(spelling), fetchedAt);
  word.phoneticUs = youdaoBody.phoneticUs || englishBody.phonetic;
  word.phoneticUk = youdaoBody.phoneticUk;
  word.senses = [...youdaoBody.senses.slice(0, 3), ...englishBody.senses.slice(0, 2)];
  word.phrases = youdaoBody.phrases.slice(0, 2);
  word.examples = youdaoBody.examples.length > 0 ? youdaoBody.examples.slice(0, 1) : englishBody.examples.slice(0, 1);
  word.glossAt = fetchedAt;
  word.fetchedAt = fetchedAt;
  if (!glossReady(word)) {
    logDownload(logPath, spelling, "gloss", requestFailed ? "请求失败" : "没有获取到释义");
    throw new Error("gloss");
  }
  saveGloss(db, word);
  return getDictWord(db, spelling) ?? word;
}

export async function ensureAudio(
  db: DatabaseSync,
  dbPath: string,
  fetchImpl: typeof fetch,
  spelling: string,
  fetchedAt: string,
  logPath: string,
): Promise<DictWord> {
  const cached = getDictWord(db, spelling);
  if (audioReady(cached, dbPath)) return cached ?? emptyDictWord(dictionaryKey(spelling), fetchedAt);
  const word = cached ?? emptyDictWord(dictionaryKey(spelling), fetchedAt);
  try {
    word.audioUsPath = await downloadPronunciation(fetchImpl, dbPath, spelling);
  } catch (error) {
    const reason = error instanceof DownloadFailed && error.permanent ? "没有读音" : "请求失败或文件无法播放";
    logDownload(logPath, spelling, "audio", reason);
    throw error;
  }
  if (!isPlayableAudioFile(join(dirname(dbPath), word.audioUsPath))) {
    logDownload(logPath, spelling, "audio", "文件无法播放");
    throw new DownloadFailed(false);
  }
  word.audioAt = fetchedAt;
  word.fetchedAt = word.fetchedAt || fetchedAt;
  saveAudio(db, word);
  return getDictWord(db, spelling) ?? word;
}

export async function ensureDictWord(
  db: DatabaseSync,
  dbPath: string,
  fetchImpl: typeof fetch,
  spelling: string,
  fetchedAt: string,
  logPath: string,
): Promise<DictWord> {
  await ensureGloss(db, fetchImpl, spelling, fetchedAt, logPath).catch(() => undefined);
  await ensureAudio(db, dbPath, fetchImpl, spelling, fetchedAt, logPath).catch(() => undefined);
  return getDictWord(db, spelling) ?? emptyDictWord(dictionaryKey(spelling), fetchedAt);
}

async function downloadPronunciation(fetchImpl: typeof fetch, dbPath: string, spelling: string): Promise<string> {
  const bytes = await loadAudioBytes(fetchImpl, spelling);
  const kind = audioKind(bytes);
  if (!kind) throw new DownloadFailed(false);
  const filename = `${audioSlug(spelling)}-us.${kind}`;
  const destination = join(audioDirectory(dbPath), filename);
  writeAudioFile(destination, bytes);
  return join("audio", filename);
}

async function loadAudioBytes(fetchImpl: typeof fetch, spelling: string): Promise<Buffer> {
  try {
    return await fetchAudioBytes(fetchImpl, youdaoAudioUrl(spelling));
  } catch (error) {
    if (!(error instanceof DownloadFailed) || !error.permanent) throw error;
  }
  const english = await fetchStatus(fetchImpl, `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(spelling)}`);
  if (english.kind === "error") throw new DownloadFailed(false);
  const audioUrl = parseEnglishDictionary(english.kind === "ok" ? english.body : null).audioUrl;
  if (!audioUrl) throw new DownloadFailed(true);
  return fetchAudioBytes(fetchImpl, audioUrl);
}

function audioSlug(spelling: string): string {
  const slug = dictionaryKey(spelling).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "word";
}

async function fetchStatus(
  fetchImpl: typeof fetch,
  url: string,
): Promise<{ kind: "ok"; body: unknown } | { kind: "missing" } | { kind: "error" }> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) return { kind: "missing" };
    if (!response.ok) return { kind: "error" };
    return { kind: "ok", body: await response.json() };
  } catch {
    return { kind: "error" };
  }
}

function insertRows(db: DatabaseSync, table: "dict_senses" | "dict_phrases" | "dict_examples", spelling: string, rows: string[][]): void {
  const columns = table === "dict_senses" ? "spelling, position, pos, gloss, lang" : table === "dict_phrases" ? "spelling, position, phrase, meaning" : "spelling, position, sentence, translation";
  const placeholders = table === "dict_senses" ? "?, ?, ?, ?, ?" : "?, ?, ?, ?";
  const statement = db.prepare(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`);
  rows.forEach((row, position) => {
    statement.run(spelling, position, ...row);
  });
}
