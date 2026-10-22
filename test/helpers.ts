import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

export function temporaryDirectory(t: TestContext, name: string): string {
  const directory = mkdtempSync(join(tmpdir(), `mote-${name}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

export function replaceFetch(
  t: TestContext,
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): void {
  const original = globalThis.fetch;
  globalThis.fetch = implementation as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

export function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
