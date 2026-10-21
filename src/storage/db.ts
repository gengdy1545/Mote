import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Interpretation, Progress, TodayItem } from "../maimemo/types.js";
import type { StoredSession } from "../study/practice.js";

export type Snapshot = {
  accountKey: string;
  studyDay: string;
  fetchedAt: string;
  progress: Progress;
  items: TodayItem[];
  truncated: boolean;
};

export function defaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MOTE_DB) return env.MOTE_DB;
  const base = env.XDG_DATA_HOME || join(env.HOME || homedir(), ".local", "share");
  return join(base, "mote", "mote.db");
}

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      account_key TEXT NOT NULL,
      study_day TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      progress_json TEXT NOT NULL,
      items_json TEXT NOT NULL,
      truncated INTEGER NOT NULL,
      PRIMARY KEY (account_key, study_day)
    );
    CREATE TABLE IF NOT EXISTS content_cache (
      account_key TEXT NOT NULL,
      voc_id TEXT NOT NULL,
      interpretations_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (account_key, voc_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      account_key TEXT NOT NULL,
      study_day TEXT NOT NULL,
      queue_json TEXT NOT NULL,
      card_index INTEGER NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revealed_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (account_key, study_day)
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_key TEXT NOT NULL,
      study_day TEXT NOT NULL,
      voc_id TEXT NOT NULL,
      spelling TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS feedback_day ON feedback(account_key, study_day);
    DROP TABLE IF EXISTS glosses;
    CREATE TABLE IF NOT EXISTS dict_words (
      spelling TEXT PRIMARY KEY,
      phonetic_us TEXT NOT NULL,
      phonetic_uk TEXT NOT NULL,
      audio_us_path TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      gloss_at TEXT NOT NULL DEFAULT '',
      audio_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS dict_senses (
      spelling TEXT NOT NULL,
      position INTEGER NOT NULL,
      pos TEXT NOT NULL,
      gloss TEXT NOT NULL,
      lang TEXT NOT NULL,
      PRIMARY KEY (spelling, position)
    );
    CREATE TABLE IF NOT EXISTS dict_phrases (
      spelling TEXT NOT NULL,
      position INTEGER NOT NULL,
      phrase TEXT NOT NULL,
      meaning TEXT NOT NULL,
      PRIMARY KEY (spelling, position)
    );
    CREATE TABLE IF NOT EXISTS dict_examples (
      spelling TEXT NOT NULL,
      position INTEGER NOT NULL,
      sentence TEXT NOT NULL,
      translation TEXT NOT NULL,
      PRIMARY KEY (spelling, position)
    );
  `);
  ensureRevealedColumn(db);
  ensureDictStatusColumns(db);
  return db;
}

function ensureRevealedColumn(db: DatabaseSync): void {
  const columns = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[];
  if (columns.some((column) => column.name === "revealed_json")) return;
  db.exec(`ALTER TABLE sessions ADD COLUMN revealed_json TEXT NOT NULL DEFAULT '[]'`);
}

function ensureDictStatusColumns(db: DatabaseSync): void {
  const columns = db.prepare(`PRAGMA table_info(dict_words)`).all() as { name: string }[];
  if (columns.some((column) => column.name === "gloss_at")) return;
  db.exec(`ALTER TABLE dict_words ADD COLUMN gloss_at TEXT NOT NULL DEFAULT ''`);
  db.exec(`ALTER TABLE dict_words ADD COLUMN audio_at TEXT NOT NULL DEFAULT ''`);
  db.exec(`UPDATE dict_words SET gloss_at = fetched_at WHERE gloss_at = '' AND (
    phonetic_us != '' OR phonetic_uk != '' OR spelling IN (SELECT spelling FROM dict_senses)
  )`);
  db.exec(`UPDATE dict_words SET audio_at = fetched_at WHERE audio_at = '' AND audio_us_path != ''`);
}

export function saveSnapshot(db: DatabaseSync, snapshot: Snapshot): void {
  db.prepare(
    `INSERT INTO snapshots (account_key, study_day, fetched_at, progress_json, items_json, truncated)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_key, study_day) DO UPDATE SET
       fetched_at = excluded.fetched_at,
       progress_json = excluded.progress_json,
       items_json = excluded.items_json,
       truncated = excluded.truncated`,
  ).run(
    snapshot.accountKey,
    snapshot.studyDay,
    snapshot.fetchedAt,
    JSON.stringify(snapshot.progress),
    JSON.stringify(snapshot.items),
    snapshot.truncated ? 1 : 0,
  );
}

export function getSnapshot(db: DatabaseSync, accountKey: string, studyDay: string): Snapshot | null {
  const row = db
    .prepare(
      `SELECT account_key, study_day, fetched_at, progress_json, items_json, truncated
       FROM snapshots WHERE account_key = ? AND study_day = ?`,
    )
    .get(accountKey, studyDay) as
    | {
        account_key: string;
        study_day: string;
        fetched_at: string;
        progress_json: string;
        items_json: string;
        truncated: number;
      }
    | undefined;
  if (!row) return null;
  return {
    accountKey: row.account_key,
    studyDay: row.study_day,
    fetchedAt: row.fetched_at,
    progress: JSON.parse(row.progress_json) as Progress,
    items: JSON.parse(row.items_json) as TodayItem[],
    truncated: row.truncated === 1,
  };
}

export function saveContent(
  db: DatabaseSync,
  accountKey: string,
  vocId: string,
  interpretations: Interpretation[],
  fetchedAt: string,
): void {
  db.prepare(
    `INSERT INTO content_cache (account_key, voc_id, interpretations_json, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(account_key, voc_id) DO UPDATE SET
       interpretations_json = excluded.interpretations_json,
       fetched_at = excluded.fetched_at`,
  ).run(accountKey, vocId, JSON.stringify(interpretations), fetchedAt);
}

export function getContent(db: DatabaseSync, accountKey: string, vocId: string): Interpretation[] | null {
  const row = db
    .prepare(`SELECT interpretations_json FROM content_cache WHERE account_key = ? AND voc_id = ?`)
    .get(accountKey, vocId) as { interpretations_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.interpretations_json) as Interpretation[];
}

export function contentMap(db: DatabaseSync, accountKey: string, vocIds: string[]): Record<string, Interpretation[]> {
  const map: Record<string, Interpretation[]> = {};
  for (const vocId of vocIds) {
    const content = getContent(db, accountKey, vocId);
    if (content) map[vocId] = content;
  }
  return map;
}

export function saveSession(db: DatabaseSync, session: StoredSession, updatedAt: string): void {
  db.prepare(
    `INSERT INTO sessions (account_key, study_day, queue_json, card_index, status, updated_at, revealed_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_key, study_day) DO UPDATE SET
       queue_json = excluded.queue_json,
       card_index = excluded.card_index,
       status = excluded.status,
       updated_at = excluded.updated_at,
       revealed_json = excluded.revealed_json`,
  ).run(
    session.accountKey,
    session.studyDay,
    JSON.stringify(session.queue),
    session.index,
    session.status,
    updatedAt,
    JSON.stringify(session.revealed),
  );
}

export function getSession(db: DatabaseSync, accountKey: string, studyDay: string): StoredSession | null {
  const row = db
    .prepare(
      `SELECT account_key, study_day, queue_json, card_index, status, revealed_json
       FROM sessions WHERE account_key = ? AND study_day = ?`,
    )
    .get(accountKey, studyDay) as
    | {
        account_key: string;
        study_day: string;
        queue_json: string;
        card_index: number;
        status: "active" | "completed";
        revealed_json: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    accountKey: row.account_key,
    studyDay: row.study_day,
    queue: JSON.parse(row.queue_json) as string[],
    index: row.card_index,
    status: row.status,
    revealed: JSON.parse(row.revealed_json ?? "[]") as string[],
  };
}

export function deleteSession(db: DatabaseSync, accountKey: string, studyDay: string): void {
  db.prepare(`DELETE FROM sessions WHERE account_key = ? AND study_day = ?`).run(accountKey, studyDay);
}

export function practicedCount(db: DatabaseSync, accountKey: string, studyDay: string): number {
  return practicedIds(db, accountKey, studyDay).length;
}

export function practicedIds(db: DatabaseSync, accountKey: string, studyDay: string): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT voc_id FROM feedback WHERE account_key = ? AND study_day = ?`)
    .all(accountKey, studyDay) as { voc_id: string }[];
  const session = getSession(db, accountKey, studyDay);
  return [...new Set([...rows.map((row) => row.voc_id), ...(session?.revealed ?? [])])];
}
