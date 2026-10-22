import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/maimemo/api.js";
import { apiRequest } from "../src/maimemo/client.js";
import { MaimemoError, sanitize } from "../src/maimemo/errors.js";
import { parseProgress, parseTodayItems } from "../src/maimemo/parse.js";
import { jsonResponse, replaceFetch } from "./helpers.js";

function assertMaimemoKind(kind: MaimemoError["kind"]) {
  return (error: unknown) => error instanceof MaimemoError && error.kind === kind;
}

test("parseProgress accepts wrapped and direct payloads", () => {
  assert.deepEqual(
    parseProgress({ success: true, data: { progress: { finished: 3, total: 10 } } }),
    { finished: 3, total: 10 },
  );
  assert.deepEqual(parseProgress({ progress: { finished: 0, total: 0 } }), { finished: 0, total: 0 });
});

test("parseTodayItems maps API field names and preserves order", () => {
  assert.deepEqual(
    parseTodayItems({
      data: {
        today_items: [
          { voc_id: "2", voc_spelling: "banana", order: 2 },
          { voc_id: "1", voc_spelling: "apple", order: 1 },
        ],
      },
    }),
    [
      { vocId: "2", spelling: "banana", order: 2 },
      { vocId: "1", spelling: "apple", order: 1 },
    ],
  );
  assert.deepEqual(parseTodayItems({ today_items: [] }), []);
});

test("response parsers distinguish API errors from invalid schemas", () => {
  for (const body of [
    { success: false, data: {} },
    { errors: [{ message: "failed" }], data: {} },
  ]) {
    assert.throws(() => parseProgress(body), assertMaimemoKind("api"));
  }
  for (const body of [
    null,
    "text",
    {},
    { data: { progress: { finished: "3", total: 10 } } },
    { data: { today_items: [{ voc_id: "1", voc_spelling: "apple" }] } },
  ]) {
    const parse = body && typeof body === "object" && "today_items" in (body as object)
      ? () => parseTodayItems(body)
      : () => parseProgress(body);
    assert.throws(parse, assertMaimemoKind("invalid"));
  }
  assert.throws(
    () => parseTodayItems({ data: { today_items: [{ voc_id: "1", voc_spelling: "apple" }] } }),
    assertMaimemoKind("invalid"),
  );
});

test("sanitize redacts every exact token occurrence", () => {
  assert.equal(sanitize("token=secret, again secret", "secret"), "token=[已隐藏], again [已隐藏]");
  assert.equal(sanitize("unchanged", "secret"), "unchanged");
  assert.equal(sanitize("unchanged", undefined), "unchanged");
  assert.equal(sanitize("unchanged", ""), "unchanged");
});

test("apiRequest sends the expected authenticated JSON request", async (t) => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  replaceFetch(t, async (input, init) => {
    requestUrl = input instanceof Request ? input.url : String(input);
    requestInit = init;
    return jsonResponse({ ok: true });
  });

  assert.deepEqual(await apiRequest("secret", "/api/example", { value: 1 }), { ok: true });
  assert.equal(requestUrl, "https://open.maimemo.com/open/api/example");
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.body, '{"value":1}');
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("authorization"), "Bearer secret");
  assert.equal(headers.get("accept"), "application/json");
  assert.equal(headers.get("content-type"), "application/json");
  assert.ok(requestInit?.signal instanceof AbortSignal);
});

test("apiRequest returns null for an empty successful response", async (t) => {
  replaceFetch(t, async () => new Response(null, { status: 204 }));
  assert.equal(await apiRequest("token", "empty", null), null);
});

test("apiRequest maps authentication, missing, HTTP, malformed, timeout, and network failures", async (t) => {
  const cases: Array<{
    name: string;
    response: () => Promise<Response>;
    kind: MaimemoError["kind"];
  }> = [
    { name: "auth", response: async () => jsonResponse({}, 401), kind: "auth" },
    { name: "not found", response: async () => jsonResponse({}, 404), kind: "not_found" },
    { name: "http", response: async () => jsonResponse({ message: "bad" }, 500), kind: "http" },
    { name: "invalid json", response: async () => new Response("not-json"), kind: "invalid" },
    {
      name: "timeout",
      response: async () => {
        const error = new Error("timeout");
        error.name = "TimeoutError";
        throw error;
      },
      kind: "timeout",
    },
    {
      name: "network",
      response: async () => {
        throw new Error("offline");
      },
      kind: "network",
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async (st) => {
      replaceFetch(st, item.response);
      await assert.rejects(apiRequest("secret", "/test", {}), assertMaimemoKind(item.kind));
    });
  }
});

test("apiRequest retries rate limiting once and then reports it", async (t) => {
  let calls = 0;
  replaceFetch(t, async () => {
    calls += 1;
    return jsonResponse({}, 429);
  });
  await assert.rejects(apiRequest("token", "/limited", {}), assertMaimemoKind("rate_limit"));
  assert.equal(calls, 2);
});

test("createApi parses progress and bounds today's requested item count", async (t) => {
  const bodies: unknown[] = [];
  const rawItems = Array.from({ length: 1000 }, (_, index) => ({
    voc_id: String(index),
    voc_spelling: `word ${index}`,
    order: index,
  }));
  replaceFetch(t, async (input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("get_study_progress")) {
      return jsonResponse({ data: { progress: { finished: 4, total: 1001 } } });
    }
    return jsonResponse({ data: { today_items: rawItems } });
  });

  const api = createApi("secret");
  assert.deepEqual(await api.progress(), { finished: 4, total: 1001 });
  const today = await api.todayItems(5000);
  assert.equal(today.items.length, 1000);
  assert.equal(today.items[999]?.vocId, "999");
  assert.equal(today.truncated, true);
  await api.todayItems(0);
  assert.deepEqual(bodies, [{}, { limit: 1000 }, { limit: 1 }]);
});
