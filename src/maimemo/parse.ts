import { z } from "zod";
import { MaimemoError } from "./errors.js";
import type { Progress, TodayItem } from "./types.js";

const progressSchema = z.object({
  finished: z.number(),
  total: z.number(),
});

const todayItemSchema = z.object({
  voc_id: z.string(),
  voc_spelling: z.string(),
  order: z.number(),
});

function envelopeData(body: unknown): unknown {
  if (!body || typeof body !== "object") {
    throw new MaimemoError("invalid", "墨墨返回的数据无法识别");
  }
  const record = body as { success?: boolean; errors?: unknown; data?: unknown };
  if (Array.isArray(record.errors) && record.errors.length > 0) {
    throw new MaimemoError("api", "墨墨接口返回错误");
  }
  if (record.success === false) {
    throw new MaimemoError("api", "墨墨接口返回错误");
  }
  return record.data ?? body;
}

function invalid(): never {
  throw new MaimemoError("invalid", "墨墨返回的数据无法识别");
}

export function parseProgress(body: unknown): Progress {
  const data = envelopeData(body);
  const progress = data && typeof data === "object" ? (data as { progress?: unknown }).progress : undefined;
  const parsed = progressSchema.safeParse(progress);
  if (!parsed.success) invalid();
  return {
    finished: parsed.data.finished,
    total: parsed.data.total,
  };
}

export function parseTodayItems(body: unknown): TodayItem[] {
  const data = envelopeData(body);
  const items = data && typeof data === "object" ? (data as { today_items?: unknown }).today_items : undefined;
  const parsed = z.array(todayItemSchema).safeParse(items);
  if (!parsed.success) invalid();
  return parsed.data.map((item) => ({
    vocId: item.voc_id,
    spelling: item.voc_spelling,
    order: item.order,
  }));
}
