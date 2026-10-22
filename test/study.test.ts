import assert from "node:assert/strict";
import test from "node:test";
import { dictionaryText, phoneticLabel } from "../src/dict/format.js";
import { dictionaryKey, emptyDictWord, type DictWord } from "../src/dict/types.js";
import { accountKey } from "../src/study/account.js";
import { formatShanghai, studyDay } from "../src/study/day.js";
import {
  AUDIO_DOWNLOAD_ERROR,
  GLOSS_DOWNLOAD_ERROR,
  PLAY_FAILED_ERROR,
  PLAY_MISSING_ERROR,
  practiceNotices,
} from "../src/study/notices.js";
import {
  currentCard,
  hide,
  jump,
  move,
  queueOf,
  reveal,
  startPractice,
  type Card,
  type PracticeState,
} from "../src/study/practice.js";
import { cardBody, lookupText, officialProgressLine, practiceText } from "../src/study/text.js";
import { selectTodayItems } from "../src/study/today.js";
import { formatWordPage } from "../src/study/words.js";
import { wrapText } from "../src/study/wrap.js";

const cards: Card[] = [
  { vocId: "3", spelling: "banana", order: 2 },
  { vocId: "2", spelling: "apple", order: 1 },
  { vocId: "1", spelling: "apple", order: 1 },
];

function state(overrides: Partial<PracticeState> = {}): PracticeState {
  return {
    accountKey: "account",
    studyDay: "2026-10-22",
    cards: [
      { vocId: "1", spelling: "apple", order: 1 },
      { vocId: "2", spelling: "banana", order: 2 },
    ],
    index: 0,
    revealed: false,
    ...overrides,
  };
}

function word(overrides: Partial<DictWord> = {}): DictWord {
  return {
    ...emptyDictWord("apple"),
    phoneticUs: "ˈæpəl",
    glossAt: "2026-10-22T00:00:00.000Z",
    senses: [
      { pos: "n.", gloss: "n. 苹果；苹果树；苹果公司；苹果色；多余释义", lang: "zh" },
      { pos: "v.", gloss: "to become apple-like", lang: "en" },
    ],
    phrases: [
      { phrase: "apple pie", meaning: "n. 苹果派" },
      { phrase: "apple juice", meaning: "苹果汁" },
      { phrase: "third phrase", meaning: "ignored" },
    ],
    examples: [
      { sentence: "I ate an apple.", translation: "我吃了一个苹果。" },
      { sentence: "Ignored.", translation: "" },
    ],
    ...overrides,
  };
}

test("account keys are stable hashes that do not expose the token", () => {
  assert.equal(accountKey("secret"), "2bb80d537b1da3e3");
  assert.equal(accountKey("secret"), accountKey("secret"));
  assert.notEqual(accountKey("secret"), accountKey("other"));
  assert.doesNotMatch(accountKey("secret"), /secret/);
});

test("study dates and timestamps use Beijing time across the UTC day boundary", () => {
  assert.equal(studyDay(new Date("2026-01-01T15:59:59.000Z")), "2026-01-01");
  assert.equal(studyDay(new Date("2026-01-01T16:00:00.000Z")), "2026-01-02");
  assert.equal(formatShanghai("2026-10-22T09:05:00.000Z"), "2026-10-22 17:05");
});

test("selectTodayItems sorts deterministically without mutating input and applies a safe quota", () => {
  const items = [
    { vocId: "3", spelling: "banana", order: 2, extra: true },
    { vocId: "2", spelling: "apple", order: 1, extra: true },
    { vocId: "1", spelling: "apple", order: 1, extra: true },
  ];
  const original = structuredClone(items);
  assert.deepEqual(selectTodayItems(items, 2).map((item) => item.vocId), ["1", "2"]);
  assert.deepEqual(selectTodayItems(items, 1.9).map((item) => item.vocId), ["1"]);
  assert.deepEqual(selectTodayItems(items, -3), []);
  assert.deepEqual(selectTodayItems(items, Number.NaN).map((item) => item.vocId), ["1", "2", "3"]);
  assert.deepEqual(items, original);
});

test("startPractice sorts cards and resumes only the same account, day, and queue", () => {
  const fresh = startPractice({
    accountKey: "account",
    studyDay: "day",
    cards,
    previous: null,
  });
  assert.deepEqual(fresh.state.cards.map((card) => card.vocId), ["1", "2", "3"]);
  assert.equal(fresh.state.index, 0);
  assert.equal(fresh.state.revealed, false);
  assert.equal(fresh.queueReset, false);
  assert.deepEqual(cards.map((card) => card.vocId), ["3", "2", "1"]);

  const resumed = startPractice({
    accountKey: "account",
    studyDay: "day",
    cards,
    previous: { accountKey: "account", studyDay: "day", queue: ["1", "2", "3"], index: 99 },
  });
  assert.equal(resumed.state.index, 2);
  assert.equal(resumed.queueReset, false);

  const negative = startPractice({
    accountKey: "account",
    studyDay: "day",
    cards,
    previous: { accountKey: "account", studyDay: "day", queue: ["1", "2", "3"], index: -2 },
  });
  assert.equal(negative.state.index, 0);

  const changed = startPractice({
    accountKey: "account",
    studyDay: "day",
    cards,
    previous: { accountKey: "account", studyDay: "day", queue: ["1", "3", "2"], index: 1 },
  });
  assert.equal(changed.state.index, 0);
  assert.equal(changed.queueReset, true);

  const otherAccount = startPractice({
    accountKey: "account",
    studyDay: "day",
    cards,
    previous: { accountKey: "other", studyDay: "day", queue: ["1", "2", "3"], index: 1 },
  });
  assert.equal(otherAccount.state.index, 0);
  assert.equal(otherAccount.queueReset, false);

  const empty = startPractice({
    accountKey: "account",
    studyDay: "day",
    cards: [],
    previous: { accountKey: "account", studyDay: "day", queue: ["old"], index: 1 },
  });
  assert.deepEqual(empty.state.cards, []);
  assert.equal(empty.queueReset, false);
});

test("practice transitions enforce bounds, hide glosses on movement, and preserve identity on no-ops", () => {
  const initial = state();
  assert.deepEqual(queueOf(initial.cards), ["1", "2"]);
  assert.equal(currentCard(initial)?.spelling, "apple");
  assert.equal(currentCard(state({ cards: [] })), null);

  const shown = reveal(initial);
  assert.equal(shown.revealed, true);
  assert.equal(reveal(shown), shown);
  assert.equal(hide(initial), initial);
  const hidden = hide(shown);
  assert.equal(hidden.revealed, false);

  const second = move(shown, 1);
  assert.equal(second.index, 1);
  assert.equal(second.revealed, false);
  assert.equal(move(second, 1), second);
  assert.equal(move(initial, -1), initial);

  const jumped = jump(shown, 2);
  assert.equal(jumped.index, 1);
  assert.equal(jumped.revealed, false);
  for (const invalid of [0, 3, 1.5, Number.NaN]) {
    assert.equal(jump(initial, invalid), initial);
  }
  assert.equal(jump(initial, 1), initial);
});

test("wrapText counts CJK width, keeps blank paragraphs, and respects narrow terminals", () => {
  assert.equal(wrapText("abcdef", 3), "abc\ndef");
  assert.equal(wrapText("中文a", 4), "中文\na");
  assert.equal(wrapText("one two", 7), "one two");
  assert.equal(wrapText("one two", 6), "one\ntwo");
  assert.equal(wrapText("a\n\nb", 10), "a\n\nb");
  assert.equal(wrapText("ab", 0), "a\nb");
  assert.equal(wrapText("", 10), "");
});

test("dictionary formatting prefers Chinese, limits detail, and handles empty entries", () => {
  const entry = word();
  assert.equal(phoneticLabel(entry), "/ˈæpəl/");
  assert.equal(phoneticLabel(word({ phoneticUs: "/ready/" })), "/ready/");
  assert.equal(phoneticLabel(null), "");
  assert.equal(dictionaryText(null), "正在读取释义");
  assert.equal(
    dictionaryText(entry),
    [
      "n. 苹果；苹果树；苹果公司；苹果色……",
      "",
      "语块",
      "apple pie  苹果派",
      "apple juice  苹果汁",
      "",
      "例句",
      "I ate an apple.",
      "我吃了一个苹果。",
    ].join("\n"),
  );
  assert.equal(
    dictionaryText(word({
      senses: [{ pos: "n.", gloss: "fruit", lang: "en" }],
      phrases: [],
      examples: [],
    })),
    "n. fruit",
  );
  assert.equal(dictionaryText(emptyDictWord("unknown")), "没有查到释义");
  assert.equal(dictionaryKey(" Apple "), "apple");
  assert.deepEqual(emptyDictWord("Apple"), {
    spelling: "Apple",
    phoneticUs: "",
    phoneticUk: "",
    audioUsPath: "",
    glossAt: "",
    senses: [],
    phrases: [],
    examples: [],
  });
});

test("lookup and practice text render hidden, revealed, offline, and empty states", () => {
  const entry = word({
    senses: [{ pos: "n.", gloss: "苹果", lang: "zh" }],
    phrases: [],
    examples: [],
  });
  assert.equal(officialProgressLine(3, 10), "墨墨今日已完成：3 / 10");
  assert.equal(lookupText("apple", entry), "apple  /ˈæpəl/\n\nn. 苹果");
  assert.equal(cardBody(entry), "n. 苹果");

  assert.equal(
    practiceText({ state: state(), offline: false, words: { apple: entry }, columns: 80 }),
    "apple\n",
  );
  assert.equal(
    practiceText({ state: state({ revealed: true }), offline: false, words: { apple: entry }, columns: 80 }),
    "apple  /ˈæpəl/\n\nn. 苹果\n",
  );
  assert.equal(
    practiceText({ state: state({ cards: [] }), offline: true, columns: 80 }),
    "未能连接墨墨，显示今日已保存的官方快照",
  );
  assert.match(
    practiceText({ state: state({ revealed: true }), offline: true, words: {}, columns: 20 }),
    /^未能连接墨墨/,
  );
});

test("practice notices select platform-specific playback guidance", () => {
  assert.deepEqual(practiceNotices({ gloss: false, audio: false, play: null, platform: "darwin" }), []);
  assert.deepEqual(practiceNotices({ gloss: true, audio: true, play: null, platform: "darwin" }), [
    GLOSS_DOWNLOAD_ERROR,
    AUDIO_DOWNLOAD_ERROR,
  ]);
  assert.deepEqual(practiceNotices({ gloss: false, audio: false, play: "missing", platform: "linux" }), [
    PLAY_MISSING_ERROR,
  ]);
  assert.deepEqual(practiceNotices({ gloss: false, audio: false, play: "missing", platform: "darwin" }), [
    PLAY_FAILED_ERROR,
  ]);
  assert.deepEqual(practiceNotices({ gloss: false, audio: false, play: "failed", platform: "linux" }), [
    PLAY_FAILED_ERROR,
  ]);
});

test("word pages clamp page indexes and number entries globally", () => {
  assert.equal(
    formatWordPage(["apple", "banana", "cherry"], 0, 2),
    "1 apple\n2 banana\n\n1/2    ← → 翻页    q 退出",
  );
  assert.equal(
    formatWordPage(["apple", "banana", "cherry"], 99, 2),
    "3 cherry\n\n2/2    ← → 翻页    q 退出",
  );
  assert.equal(
    formatWordPage(["apple", "banana"], -1, 2),
    "1 apple\n2 banana\n\n1/1    ← → 翻页    q 退出",
  );
  assert.equal(formatWordPage([], 5, 7), "这本词书是空的。\n\n1/1    ← → 翻页    q 退出");
});
