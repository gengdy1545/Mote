import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Progress, TodayItem } from "../maimemo/types.js";
import type { StoredSession } from "../study/practice.js";

export type Snapshot = {
  accountKey: string;
  studyDay: string;
  fetchedAt: string;
  progress: Progress;
  items: TodayItem[];
  truncated: boolean;
};

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
    CREATE TABLE IF NOT EXISTS sessions (
      account_key TEXT NOT NULL,
      study_day TEXT NOT NULL,
      queue_json TEXT NOT NULL,
      card_index INTEGER NOT NULL,
      PRIMARY KEY (account_key, study_day)
    );
    CREATE TABLE IF NOT EXISTS dict_words (
      spelling TEXT PRIMARY KEY,
      phonetic_us TEXT NOT NULL,
      phonetic_uk TEXT NOT NULL,
      audio_us_path TEXT NOT NULL,
      gloss_at TEXT NOT NULL DEFAULT ''
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
  return db;
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

export function saveSession(db: DatabaseSync, session: StoredSession): void {
  db.prepare(
    `INSERT INTO sessions (account_key, study_day, queue_json, card_index)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(account_key, study_day) DO UPDATE SET
       queue_json = excluded.queue_json,
       card_index = excluded.card_index`,
  ).run(session.accountKey, session.studyDay, JSON.stringify(session.queue), session.index);
}

export function getSession(db: DatabaseSync, accountKey: string, studyDay: string): StoredSession | null {
  const row = db
    .prepare(
      `SELECT account_key, study_day, queue_json, card_index
       FROM sessions WHERE account_key = ? AND study_day = ?`,
    )
    .get(accountKey, studyDay) as
    | {
        account_key: string;
        study_day: string;
        queue_json: string;
        card_index: number;
      }
    | undefined;
  if (!row) return null;
  return {
    accountKey: row.account_key,
    studyDay: row.study_day,
    queue: JSON.parse(row.queue_json) as string[],
    index: row.card_index,
  };
}

export function deleteSession(db: DatabaseSync, accountKey: string, studyDay: string): void {
  db.prepare(`DELETE FROM sessions WHERE account_key = ? AND study_day = ?`).run(accountKey, studyDay);
}

