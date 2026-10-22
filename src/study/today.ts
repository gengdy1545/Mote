export type OrderedItem = {
  order: number;
  spelling: string;
  vocId: string;
};

/** Keep the first dailyTotal items after sorting by official order. */
export function selectTodayItems<T extends OrderedItem>(items: T[], dailyTotal: number): T[] {
  const sorted = [...items].sort(
    (a, b) => a.order - b.order || a.spelling.localeCompare(b.spelling) || a.vocId.localeCompare(b.vocId),
  );
  const quota = Number.isFinite(dailyTotal) ? Math.max(0, Math.trunc(dailyTotal)) : sorted.length;
  return sorted.slice(0, quota);
}
