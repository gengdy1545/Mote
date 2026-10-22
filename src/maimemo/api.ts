import { apiRequest } from "./client.js";
import { parseProgress, parseTodayItems } from "./parse.js";
import type { Progress, TodayItem } from "./types.js";

const MAX_TODAY_LIMIT = 1000;

export function createApi(token: string) {
  return {
    progress(): Promise<Progress> {
      return apiRequest(token, "/api/v1/memo/study/get_study_progress", {}).then(parseProgress);
    },
    todayItems(limit: number): Promise<{ items: TodayItem[]; truncated: boolean }> {
      const bounded = Math.min(MAX_TODAY_LIMIT, Math.max(1, Math.trunc(limit)));
      return apiRequest(token, "/api/v1/memo/study/get_today_items", { limit: bounded }).then((body) => {
        const items = parseTodayItems(body);
        return { items, truncated: bounded === MAX_TODAY_LIMIT && items.length >= MAX_TODAY_LIMIT };
      });
    },
  };
}
