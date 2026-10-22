import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  deleteSession,
  getSession,
  getSnapshot,
  openDatabase,
  saveSession,
  saveSnapshot,
  type Snapshot,
} from "../src/storage/db.js";
import { temporaryDirectory } from "./helpers.js";

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    accountKey: "account-a",
    studyDay: "2026-10-22",
    fetchedAt: "2026-10-22T09:00:00.000Z",
    progress: { finished: 2, total: 3 },
    items: [
      { vocId: "1", spelling: "apple", order: 1 },
      { vocId: "2", spelling: "banana", order: 2 },
    ],
    truncated: false,
    ...overrides,
  };
}

test("openDatabase creates parent directories and all data tables", (t) => {
  const root = temporaryDirectory(t, "database-open");
  const path = join(root, "nested", "mote.db");
  const db = openDatabase(path);
  t.after(() => db.close());
  assert.equal(existsSync(path), true);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
  assert.deepEqual(tables, [
    "dict_examples",
    "dict_phrases",
    "dict_senses",
    "dict_words",
    "sessions",
    "snapshots",
  ]);
});

test("snapshots round-trip, update atomically by account and day, and stay isolated", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  assert.equal(getSnapshot(db, "missing", "2026-10-22"), null);

  const first = snapshot();
  saveSnapshot(db, first);
  assert.deepEqual(getSnapshot(db, first.accountKey, first.studyDay), first);

  const updated = snapshot({
    fetchedAt: "2026-10-22T10:00:00.000Z",
    progress: { finished: 3, total: 4 },
    items: [{ vocId: "3", spelling: "cherry", order: 1 }],
    truncated: true,
  });
  saveSnapshot(db, updated);
  assert.deepEqual(getSnapshot(db, updated.accountKey, updated.studyDay), updated);

  const other = snapshot({ accountKey: "account-b", items: [] });
  saveSnapshot(db, other);
  assert.deepEqual(getSnapshot(db, "account-b", other.studyDay), other);
  assert.deepEqual(getSnapshot(db, "account-a", first.studyDay), updated);
});

test("sessions round-trip, update, isolate contexts, and delete idempotently", (t) => {
  const db = openDatabase(":memory:");
  t.after(() => db.close());
  assert.equal(getSession(db, "account", "day"), null);

  saveSession(db, {
    accountKey: "account",
    studyDay: "day",
    queue: ["1", "2"],
    index: 1,
  });
  assert.deepEqual(getSession(db, "account", "day"), {
    accountKey: "account",
    studyDay: "day",
    queue: ["1", "2"],
    index: 1,
  });

  saveSession(db, {
    accountKey: "account",
    studyDay: "day",
    queue: ["3"],
    index: 0,
  });
  saveSession(db, {
    accountKey: "other",
    studyDay: "day",
    queue: [],
    index: 0,
  });
  assert.deepEqual(getSession(db, "account", "day")?.queue, ["3"]);
  assert.deepEqual(getSession(db, "other", "day")?.queue, []);

  deleteSession(db, "account", "day");
  deleteSession(db, "account", "day");
  assert.equal(getSession(db, "account", "day"), null);
  assert.notEqual(getSession(db, "other", "day"), null);
});
