import { z } from "zod";
import { MaimemoError } from "./errors.js";
import type { Interpretation, Progress, TodayItem, Vocabulary } from "./types.js";

const progressSchema = z.object({
  finished: z.number(),
  total: z.number(),
  study_time: z.number(),
});

const todayItemSchema = z.object({
  voc_id: z.string(),
  voc_spelling: z.string(),
  order: z.number(),
  is_new: z.boolean(),
  is_finished: z.boolean(),
  first_response: z.string().nullish(),
});

const interpretationSchema = z.object({
  id: z.string(),
  interpretation: z.string(),
  tags: z.array(z.string()).nullish(),
  status: z.string(),
});

const vocabularySchema = z.object({
  id: z.string(),
  spelling: z.string(),
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

function meaningfulResponse(response: string | null | undefined): response is string {
  return typeof response === "string" && response.length > 0 && response !== "STUDY_RESPONSE_UNSPECIFIED";
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
    studyTime: parsed.data.study_time,
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
    isNew: item.is_new,
    isFinished: item.is_finished,
    ...(meaningfulResponse(item.first_response) ? { firstResponse: item.first_response ?? undefined } : {}),
  }));
}

export function parseInterpretations(body: unknown): Interpretation[] {
  const data = envelopeData(body);
  const items =
    data && typeof data === "object" ? (data as { interpretations?: unknown }).interpretations : undefined;
  const parsed = z.array(interpretationSchema).safeParse(items);
  if (!parsed.success) invalid();
  return parsed.data.map((item) => ({
    id: item.id,
    text: item.interpretation,
    tags: item.tags ?? [],
    status: item.status,
  }));
}

export function parseVocabulary(body: unknown): Vocabulary | null {
  const data = envelopeData(body);
  const voc = data && typeof data === "object" ? (data as { voc?: unknown }).voc : undefined;
  if (voc == null) return null;
  const parsed = vocabularySchema.safeParse(voc);
  if (!parsed.success) invalid();
  return { id: parsed.data.id, spelling: parsed.data.spelling };
}
