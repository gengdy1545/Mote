import { apiRequest } from "./client.js";
import { parseInterpretations, parseProgress, parseTodayItems, parseVocabulary } from "./parse.js";
import type { Interpretation, Progress, TodayItem, Vocabulary } from "./types.js";

const MAX_TODAY_LIMIT = 1000;

export type ApiOptions = {
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
};

export function createApi(fetchImpl: typeof fetch, token: string, options?: ApiOptions) {
  const call = (method: "GET" | "POST", path: string, extra?: { query?: Record<string, string>; body?: unknown }) =>
    apiRequest(fetchImpl, token, method, path, { ...options, ...extra });

  return {
    progress(): Promise<Progress> {
      return call("POST", "/api/v1/memo/study/get_study_progress", { body: {} }).then(parseProgress);
    },
    todayItems(limit: number): Promise<{ items: TodayItem[]; truncated: boolean }> {
      const bounded = Math.min(MAX_TODAY_LIMIT, Math.max(1, Math.trunc(limit)));
      return call("POST", "/api/v1/memo/study/get_today_items", { body: { limit: bounded } }).then((body) => {
        const items = parseTodayItems(body);
        return { items, truncated: bounded === MAX_TODAY_LIMIT && items.length >= MAX_TODAY_LIMIT };
      });
    },
    vocabulary(spelling: string): Promise<Vocabulary | null> {
      return call("GET", "/api/v1/memo/vocabulary", { query: { spelling } }).then(parseVocabulary);
    },
    interpretations(vocId: string): Promise<Interpretation[]> {
      return call("GET", "/api/v1/memo/interpretations", { query: { voc_id: vocId } }).then(parseInterpretations);
    },
  };
}

export type MaimemoApi = ReturnType<typeof createApi>;
