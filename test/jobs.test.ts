import assert from "node:assert/strict";
import test from "node:test";
import { createJobQueue } from "../src/dict/jobs.js";
import { deferred, nextTurn } from "./helpers.js";

test("job queue honors its concurrency limit and starts queued work newest first", async () => {
  const queue = createJobQueue(1);
  const first = deferred();
  const second = deferred();
  const third = deferred();
  const started: string[] = [];
  const notified: string[] = [];

  queue.add("first", "apple", async () => {
    started.push("first");
    await first.promise;
  }, () => notified.push("first"));
  queue.add("second", "banana", async () => {
    started.push("second");
    await second.promise;
  }, () => notified.push("second"));
  queue.add("third", "cherry", async () => {
    started.push("third");
    await third.promise;
  }, () => notified.push("third"));
  assert.deepEqual(started, ["first"]);

  first.resolve();
  await nextTurn();
  assert.deepEqual(started, ["first", "third"]);
  assert.deepEqual(notified, ["first"]);

  third.resolve();
  await nextTurn();
  assert.deepEqual(started, ["first", "third", "second"]);
  assert.deepEqual(notified, ["first", "third"]);

  second.resolve();
  await nextTurn();
  assert.deepEqual(notified, ["first", "third", "second"]);
});

test("job queue deduplicates both running and waiting keys while notifying every subscriber", async () => {
  const queue = createJobQueue(1);
  const running = deferred();
  const waiting = deferred();
  let runningCalls = 0;
  let waitingCalls = 0;
  const notifications: string[] = [];

  queue.add("same", "apple", async () => {
    runningCalls += 1;
    await running.promise;
  }, () => notifications.push("running-1"));
  queue.add("same", "apple", async () => {
    runningCalls += 1;
  }, () => notifications.push("running-2"));
  queue.add("wait", "banana", async () => {
    waitingCalls += 1;
    await waiting.promise;
  }, () => notifications.push("waiting-1"));
  queue.add("wait", "banana", async () => {
    waitingCalls += 1;
  }, () => notifications.push("waiting-2"));

  assert.equal(runningCalls, 1);
  assert.equal(waitingCalls, 0);
  running.resolve();
  await nextTurn();
  assert.equal(waitingCalls, 1);
  assert.deepEqual(notifications, ["running-1", "running-2"]);

  waiting.resolve();
  await nextTurn();
  assert.deepEqual(notifications, ["running-1", "running-2", "waiting-1", "waiting-2"]);
});

test("keep drops unrelated waiting work without interrupting the active job", async () => {
  const queue = createJobQueue(1);
  const active = deferred();
  const kept = deferred();
  const started: string[] = [];
  const notified: string[] = [];

  queue.add("active", "apple", async () => {
    started.push("active");
    await active.promise;
  }, () => notified.push("active"));
  queue.add("kept", "banana", async () => {
    started.push("kept");
    await kept.promise;
  }, () => notified.push("kept"));
  queue.add("dropped", "cherry", async () => {
    started.push("dropped");
  }, () => notified.push("dropped"));
  queue.keep("banana");

  active.resolve();
  await nextTurn();
  assert.deepEqual(started, ["active", "kept"]);
  kept.resolve();
  await nextTurn();
  assert.deepEqual(notified, ["active", "kept"]);
});

test("a failed job still notifies subscribers and pumps the next job", async () => {
  const queue = createJobQueue(1);
  const notifications: string[] = [];
  const started: string[] = [];
  queue.add("failed", "apple", async () => {
    started.push("failed");
    throw new Error("expected");
  }, () => notifications.push("failed"));
  queue.add("next", "banana", async () => {
    started.push("next");
  }, () => notifications.push("next"));

  await nextTurn();
  await nextTurn();
  assert.deepEqual(started, ["failed", "next"]);
  assert.deepEqual(notifications, ["failed", "next"]);
});
