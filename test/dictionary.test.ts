import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  DownloadFailed,
  audioKind,
  fetchAudioBytes,
  isPlayableAudioFile,
  writeAudioFile,
  youdaoAudioUrl,
} from "../src/dict/audio.js";
import { parseEnglishDictionary } from "../src/dict/english.js";
import {
  ShownFailure,
  audioDirectory,
  audioReady,
  ensureAudio,
  ensureDictWord,
  ensureGloss,
  getDictWord,
  glossReady,
} from "../src/dict/store.js";
import { emptyDictWord } from "../src/dict/types.js";
import { parseYoudaoDictionary } from "../src/dict/youdao.js";
import { openDatabase } from "../src/storage/db.js";
import { jsonResponse, replaceFetch, temporaryDirectory } from "./helpers.js";

function mp3Bytes(): Buffer {
  return Buffer.concat([Buffer.from("ID3"), Buffer.alloc(61)]);
}

function wavBytes(): Buffer {
  const bytes = Buffer.alloc(44);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WAVE", 8, "ascii");
  return bytes;
}

function youdaoBody(): unknown {
  return {
    ec: {
      word: [{
        usphone: "ˈæpəl",
        ukphone: "ˈæpəl",
        trs: [
          { tr: [{ l: { i: ["n. ", "<b>苹果</b>"] } }] },
          { tr: [{ l: { i: "vt. 使像苹果" } }] },
          { tr: [{ l: { i: "【名】阿普尔" } }] },
        ],
      }],
    },
    phrs: {
      phrs: [
        {
          phr: {
            headword: { l: { i: "apple pie" } },
            trs: { tr: { l: { i: "n. 苹果派" } } },
          },
        },
        {
          phr: {
            headword: { l: { i: "apple juice" } },
            trs: { tr: { l: { i: "苹果汁" } } },
          },
        },
        {
          phr: {
            headword: { l: { i: "ignored" } },
            trs: { tr: { l: { i: "忽略" } } },
          },
        },
      ],
    },
    blng_sents_part: {
      "sentence-pair": [
        { "sentence-eng": "I ate an apple.", "sentence-translation": "我吃了一个苹果。" },
        { "sentence-eng": "Ignored.", "sentence-translation": "忽略。" },
      ],
    },
  };
}

function englishBody(): unknown {
  return [{
    phonetic: "",
    phonetics: [
      { text: "/ˈæp.əl/", audio: "" },
      { audio: "//cdn.example/apple.mp3" },
    ],
    meanings: [
      {
        partOfSpeech: "noun",
        definitions: [
          { definition: "A round fruit.", example: "This apple is red." },
          { definition: "A technology company.", example: "Ignored example." },
          { definition: "A third definition." },
        ],
      },
    ],
  }];
}

function downloadFailure(permanent: boolean, reason?: DownloadFailed["reason"]) {
  return (error: unknown) =>
    error instanceof DownloadFailed &&
    error.permanent === permanent &&
    (reason === undefined || error.reason === reason);
}

test("parseEnglishDictionary extracts safe, limited phonetics, audio, senses, and examples", () => {
  assert.deepEqual(parseEnglishDictionary(englishBody()), {
    phonetic: "/ˈæp.əl/",
    audioUrl: "https://cdn.example/apple.mp3",
    senses: [
      { pos: "noun", gloss: "A round fruit.", lang: "en" },
      { pos: "noun", gloss: "A technology company.", lang: "en" },
    ],
    examples: [{ sentence: "This apple is red.", translation: "" }],
  });
  assert.deepEqual(parseEnglishDictionary(null), {
    phonetic: "",
    audioUrl: "",
    senses: [],
    examples: [],
  });
  assert.deepEqual(parseEnglishDictionary([null]), {
    phonetic: "",
    audioUrl: "",
    senses: [],
    examples: [],
  });
});

test("parseYoudaoDictionary strips markup, skips names, and limits phrases and examples", () => {
  assert.deepEqual(parseYoudaoDictionary(youdaoBody()), {
    phoneticUs: "ˈæpəl",
    phoneticUk: "ˈæpəl",
    senses: [
      { pos: "n.", gloss: "n. 苹果", lang: "zh" },
      { pos: "vt.", gloss: "vt. 使像苹果", lang: "zh" },
    ],
    phrases: [
      { phrase: "apple pie", meaning: "n. 苹果派" },
      { phrase: "apple juice", meaning: "苹果汁" },
    ],
    examples: [{ sentence: "I ate an apple.", translation: "我吃了一个苹果。" }],
  });
  assert.deepEqual(parseYoudaoDictionary("invalid"), {
    phoneticUs: "",
    phoneticUk: "",
    senses: [],
    phrases: [],
    examples: [],
  });
});

test("audio signatures, file validation, writing, and URL encoding are deterministic", (t) => {
  const root = temporaryDirectory(t, "dictionary-audio");
  assert.equal(audioKind(mp3Bytes()), "mp3");
  assert.equal(audioKind(Buffer.from([0xff, 0xe3, 0, 0])), "mp3");
  assert.equal(audioKind(wavBytes()), "wav");
  assert.equal(audioKind(Buffer.alloc(64)), "");

  const mp3 = join(root, "nested", "word.mp3");
  writeAudioFile(mp3, mp3Bytes());
  assert.equal(existsSync(mp3), true);
  assert.equal(isPlayableAudioFile(mp3), true);
  assert.equal(readFileSync(mp3).length, 64);

  const wav = join(root, "word.wav");
  writeFileSync(wav, wavBytes());
  assert.equal(isPlayableAudioFile(wav), true);
  assert.equal(isPlayableAudioFile(join(root, "word.mp3")), false);

  const wrongExtension = join(root, "wrong.wav");
  writeFileSync(wrongExtension, mp3Bytes());
  assert.equal(isPlayableAudioFile(wrongExtension), false);
  assert.equal(isPlayableAudioFile(join(root, "missing.mp3")), false);
  assert.equal(youdaoAudioUrl("ice cream"), "https://dict.youdao.com/dictvoice?audio=ice%20cream&type=2");
});

test("fetchAudioBytes accepts valid audio and classifies transport and content failures", async (t) => {
  await t.test("valid", async (st) => {
    replaceFetch(st, async () => new Response(Uint8Array.from(mp3Bytes())));
    assert.deepEqual(await fetchAudioBytes("https://audio.test/ok"), mp3Bytes());
  });
  await t.test("network", async (st) => {
    replaceFetch(st, async () => {
      throw new Error("offline");
    });
    await assert.rejects(fetchAudioBytes("https://audio.test/network"), downloadFailure(false, "请求失败"));
  });
  await t.test("missing", async (st) => {
    replaceFetch(st, async () => new Response(null, { status: 404 }));
    await assert.rejects(fetchAudioBytes("https://audio.test/missing"), downloadFailure(true, "没有读音"));
  });
  await t.test("server error", async (st) => {
    replaceFetch(st, async () => new Response(null, { status: 500 }));
    await assert.rejects(fetchAudioBytes("https://audio.test/error"), downloadFailure(false, "请求失败"));
  });
  await t.test("too short", async (st) => {
    replaceFetch(st, async () => new Response(Uint8Array.from(Buffer.from("ID3"))));
    await assert.rejects(fetchAudioBytes("https://audio.test/short"), downloadFailure(true, "没有读音"));
  });
  await t.test("invalid bytes", async (st) => {
    replaceFetch(st, async () => new Response(Uint8Array.from(Buffer.alloc(64))));
    await assert.rejects(fetchAudioBytes("https://audio.test/invalid"), downloadFailure(false, "文件无效"));
  });
});

test("dictionary store downloads, persists, reuses, and combines gloss and audio data", async (t) => {
  const root = temporaryDirectory(t, "dictionary-store");
  const dbPath = join(root, "data", "mote.db");
  const logPath = join(root, "mote.log");
  const db = openDatabase(dbPath);
  t.after(() => db.close());
  let calls = 0;
  replaceFetch(t, async (input) => {
    calls += 1;
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("jsonapi")) return jsonResponse(youdaoBody());
    if (url.includes("dictionaryapi.dev")) return jsonResponse(englishBody());
    if (url.includes("dictvoice")) return new Response(Uint8Array.from(mp3Bytes()));
    throw new Error(`unexpected URL: ${url}`);
  });

  assert.equal(getDictWord(db, "apple"), null);
  const gloss = await ensureGloss(db, "Apple", "2026-10-22T09:00:00.000Z", logPath);
  assert.equal(gloss.spelling, "apple");
  assert.equal(gloss.phoneticUs, "ˈæpəl");
  assert.equal(gloss.senses.length, 4);
  assert.equal(gloss.phrases.length, 2);
  assert.equal(gloss.examples[0]?.sentence, "I ate an apple.");
  assert.equal(glossReady(gloss), true);
  assert.equal(calls, 2);

  const cachedGloss = await ensureGloss(db, "APPLE", "later", logPath);
  assert.deepEqual(cachedGloss, gloss);
  assert.equal(calls, 2);

  const audio = await ensureAudio(db, dbPath, "Apple", logPath);
  assert.equal(audio.audioUsPath, join("audio", "apple-us.mp3"));
  assert.equal(audioReady(audio, dbPath), true);
  assert.equal(readFileSync(join(root, "data", audio.audioUsPath)).subarray(0, 3).toString(), "ID3");
  assert.equal(audioDirectory(dbPath), join(root, "data", "audio"));
  assert.equal(calls, 3);

  const cachedAudio = await ensureAudio(db, dbPath, "apple", logPath);
  assert.deepEqual(cachedAudio, audio);
  assert.equal(calls, 3);
  assert.deepEqual(getDictWord(db, " APPLE "), audio);
});

test("dictionary store reports visible network failures and logs non-network missing audio", async (t) => {
  const root = temporaryDirectory(t, "dictionary-failures");
  const dbPath = join(root, "mote.db");
  const logPath = join(root, "mote.log");
  const db = openDatabase(dbPath);
  t.after(() => db.close());

  replaceFetch(t, async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("dictvoice")) throw new Error("offline");
    throw new Error("offline");
  });
  await assert.rejects(
    ensureGloss(db, "offline", "2026-10-22T09:00:00.000Z", logPath),
    (error: unknown) => error instanceof ShownFailure && error.part === "gloss",
  );
  await assert.rejects(
    ensureAudio(db, dbPath, "offline", logPath),
    (error: unknown) => error instanceof ShownFailure && error.part === "audio",
  );
  const log = readFileSync(logPath, "utf8");
  assert.match(log, /释义 offline：请求失败/);
  assert.match(log, /发音 offline：请求失败/);
});

test("ensureDictWord tolerates unavailable providers and returns an empty cached shape", async (t) => {
  const root = temporaryDirectory(t, "dictionary-combined-failure");
  const dbPath = join(root, "mote.db");
  const db = openDatabase(dbPath);
  t.after(() => db.close());
  replaceFetch(t, async () => {
    throw new Error("offline");
  });
  assert.deepEqual(
    await ensureDictWord(db, dbPath, "Unknown", "2026-10-22T09:00:00.000Z", join(root, "mote.log")),
    emptyDictWord("unknown"),
  );
});
